/**
 * rpm-preflight — S5 W1 抓取完整性安全 gate(無人值守誤下架前置防線、商品維度差集)
 *
 * 背景(fallback 對抗審查 W1-1/W1-2/W1-4、Sean 拍 A):rpm-fetch 逐頁累加、若某頁無 error 但回少量列
 *   (非預期截斷)→ fetch「成功」回殘缺集合;殘缺尾端的商品會被 S4 reconcile 誤軟下架。無人值守 cron
 *   無 Sean 看 dry-run、必須有自動防線。
 *
 * 機制(對齊 S4 維度、growth-immune、active-based):
 *   - 比「target 現存上架(active、delisted_at IS NULL)RPM 商品」中、**不在本次 source main_sku 集合**者
 *     (= 差集 missing),非淨筆數(新品上架蓋不掉缺口)。維度=商品/群(與 S4 reconcile 同、非變體;
 *     fallback W1-1:變體維度量錯、一群均 ~8 變體大小不一、變體縮水率 ≠ 商品下架率)。
 *   - missing/active 縮水 > FETCH_SHRINK_ABORT(5%、**比 S4 下架 10% 嚴**)→ 硬 abort、抓 5–10% 靜默截斷
 *     (S4 的 10% gate 擋不到此帶);除非 --allow-fetch-shrink 顯式放行真實大縮編。
 *   - 首灌(active=0)不擋。唯讀 external_id key(不取金額/敏感)。
 *
 * ⚠️ 殘留缺口(誠實標、Sean A 留 backlog):**<5% 的靜默截斷**本 gate 抓不到(與「日常 <5% 合法下架」
 *   無法用單次快照區分)。根治需「持久化上次成功 fetch 基線」逐次比對 → backlog（見 docs/phase-1-backlog.md）。
 *   現況靠本 gate(5–10%)+ S4 reconcile(>10%)兩道、且日常增量同步幅度遠小於 5%。
 *
 * 與 S4 下架 gate 互補:本 gate 在 fetch 後、寫入前(pre-write、5%);S4 在 reconcile(post-upsert、10%)。
 *
 * P0-A-4a(多供應商去碳後補寫入前安全 gate、同屬 pre-write 家族):
 *   - F3 `assertBypassFlagsExclusive`:禁同帶兩個 `--allow-*` bypass 旗標(不變式 5)。
 *   - F4 `preflightHandles` + `readHandleOwners`:handle charset 白名單 + 批內重複 + target 全域唯一(不變式 6),
 *     撞鍵/髒字元 → issue 清單(寫入模式 abort 不進 upsert、避免中途撞 products_handle_key 造成部分寫髒中間態)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { readActiveExternalIds } from './rpm-reconcile';

const FETCH_SHRINK_ABORT = 0.05; // 商品消失率 >5% 疑截斷硬 abort(比 S4 下架 10% 嚴、專抓 5–10% 靜默截斷帶)
const HANDLE_READ_BATCH = 300; // handle 全域唯一查詢分批(避免大 .in() 撞 GET URL 上限、對齊 rpm-delta READ_BATCH)

export interface FetchIntegrityReport {
  sourceProductCount: number; // 來源不重複 main_sku 群數
  sourceVariantCount: number; // 來源變體列數(資訊、非 gate 依據)
  targetActiveCount: number; // target 現存上架(active)RPM 商品數
  missingCount: number; // target active 中不在 source 的商品數(差集、growth-immune)
  shrinkRatio: number; // missingCount / targetActiveCount
  aborted: boolean;
  abortReason?: string;
}

/**
 * 抓取完整性 gate:target active RPM 商品 − 本次 source main_sku 集合(差集 missing)。
 * missing/active > FETCH_SHRINK_ABORT 且非首灌 → aborted(除非 allowFetchShrink)。唯讀 external_id。
 */
export async function checkFetchIntegrity(
  tgt: SupabaseClient,
  supplierSlug: string,
  sourceMainSkus: Set<string>,
  sourceVariantCount: number,
  opts: { allowFetchShrink?: boolean } = {},
): Promise<FetchIntegrityReport> {
  const active = await readActiveExternalIds(tgt, supplierSlug); // target 現存 active 該供應商商品 external_id(= main_sku)
  const missing = active.filter((id) => !sourceMainSkus.has(id)); // 差集:active 中 source 沒有的(新品蓋不掉)
  const targetActiveCount = active.length;
  const shrinkRatio = targetActiveCount > 0 ? missing.length / targetActiveCount : 0;

  let aborted = false;
  let abortReason: string | undefined;
  if (targetActiveCount > 0 && shrinkRatio > FETCH_SHRINK_ABORT && !opts.allowFetchShrink) {
    aborted = true;
    abortReason = `來源缺少 ${missing.length}/${targetActiveCount} 個現存上架商品(${(shrinkRatio * 100).toFixed(1)}% > ${FETCH_SHRINK_ABORT * 100}% 上限、疑 fetch 截斷/來源殘缺);確認屬實後帶 --allow-fetch-shrink`;
  }
  return {
    sourceProductCount: sourceMainSkus.size,
    sourceVariantCount,
    targetActiveCount,
    missingCount: missing.length,
    shrinkRatio,
    aborted,
    abortReason,
  };
}

export function printFetchIntegrityReport(r: FetchIntegrityReport): void {
  console.log('\n=== 抓取完整性 gate(S5 W1、商品維度差集)===');
  console.log(
    `來源商品(群): ${r.sourceProductCount} / 變體: ${r.sourceVariantCount} / target 現存上架: ${r.targetActiveCount} / 來源缺少: ${r.missingCount}(${(r.shrinkRatio * 100).toFixed(1)}%)`,
  );
  if (r.aborted) {
    console.error(`🔴 ALERT 抓取完整性 abort、不寫不下架:${r.abortReason}`);
  } else if (r.missingCount > 0) {
    console.log(
      `✅ 缺少在容許範圍(≤ ${FETCH_SHRINK_ABORT * 100}%、屬日常下架);⚠️ <${FETCH_SHRINK_ABORT * 100}% 靜默截斷殘留缺口靠持久基線(backlog)`,
    );
  } else {
    console.log('✅ target 現存上架商品全在來源(零缺少)');
  }
}

// ── F3:bypass 旗標互斥護欄(不變式 5)──
/**
 * 禁同時帶 `--allow-fetch-shrink` + `--allow-large-delist`:兩道防誤殺 bypass 同開 = 盲寫,
 * 且連續 abort 通常是 supplier scope bug(漏帶/傳錯 supplierSlug 令來源/現存對不上)、非真大改。
 * 命中 → throw(fail-closed):先逐一確認來源完整、單獨帶其一,不硬推穿兩道 gate。
 */
export function assertBypassFlagsExclusive(allowFetchShrink: boolean, allowLargeDelist: boolean): void {
  if (allowFetchShrink && allowLargeDelist) {
    throw new Error(
      'F3 護欄:禁同帶 --allow-fetch-shrink + --allow-large-delist(兩道防誤殺 bypass 同開 = 盲寫);' +
        '連續 abort 先當 supplier scope bug 查(確認 supplierSlug 貫穿無誤),確認來源完整後單獨帶其一。',
    );
  }
}

// ── F4:handle preflight(charset 白名單 + 全域唯一;不變式 6)──
// 小寫英數 + 單一 hyphen/底線分隔(handle = `${prefix}-${sku.toLowerCase()}`)。
// 🔴 底線放行:底線為 URL 合法字元(RFC 3986 unreserved)、bonamici sku 用底線(PU_001),2026-07-03 Sean 拍 A;
//   仍禁前後/連續分隔符、空白、slash、大寫等 URL 危險字元(底線僅作分隔符、非自由字元)。
const HANDLE_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface HandleIssue {
  handle: string;
  externalId: string;
  reason: 'charset' | 'batch-duplicate' | 'target-collision';
  detail: string;
}

/**
 * 讀 target 現存 handle 的擁有者(supplier_slug, external_id)。products.handle 全域唯一 → 用於判斷本批 handle
 * 是否已被「別的商品」佔用(同一商品 re-upsert 不算撞)。分批 .in()、唯讀非敏感欄。
 */
export async function readHandleOwners(
  tgt: SupabaseClient,
  handles: string[],
): Promise<Map<string, { supplier_slug: string; external_id: string }>> {
  const out = new Map<string, { supplier_slug: string; external_id: string }>();
  for (let i = 0; i < handles.length; i += HANDLE_READ_BATCH) {
    const batch = handles.slice(i, i + HANDLE_READ_BATCH);
    const { data, error } = await tgt
      .from('products')
      .select('handle, supplier_slug, external_id')
      .in('handle', batch);
    if (error) throw new Error(`readHandleOwners@${i}: ${error.message}`);
    for (const r of (data ?? []) as { handle: string; supplier_slug: string; external_id: string }[]) {
      out.set(r.handle, { supplier_slug: r.supplier_slug, external_id: r.external_id });
    }
  }
  return out;
}

/**
 * handle preflight(對齊 pv_spec preflight 前例):
 *   1. charset 白名單(HANDLE_RE)—— 髒字元(空白/slash/大寫/前後或連續 hyphen)→ URL 危險 / 破 SEO key;
 *   2. 批內重複 —— 兩群產出同 handle(理論上 mainSku 唯一、防呆);
 *   3. target 全域唯一 —— handle 已被「別的 (supplier_slug, external_id)」佔用(同商品 re-upsert 不算)。
 * 回 issue 清單;呼叫端:寫入模式 abort 不進 upsert(避免中途撞 products_handle_key 部分寫髒)、dry-run 列報告。
 */
export function preflightHandles(
  productRows: { handle: string; external_id: string; supplier_slug: string }[],
  existingOwners: Map<string, { supplier_slug: string; external_id: string }>,
): HandleIssue[] {
  const issues: HandleIssue[] = [];
  const seen = new Map<string, string>(); // handle → 首見的 external_id
  for (const p of productRows) {
    if (!HANDLE_RE.test(p.handle)) {
      issues.push({ handle: p.handle, externalId: p.external_id, reason: 'charset', detail: '非 [a-z0-9] + 單一 hyphen/底線分隔(含空白/slash/大寫/前後或連續分隔符)' });
    }
    const prev = seen.get(p.handle);
    if (prev !== undefined) {
      issues.push({ handle: p.handle, externalId: p.external_id, reason: 'batch-duplicate', detail: `與同批群 ${prev} 產出同 handle` });
    } else {
      seen.set(p.handle, p.external_id);
    }
    const owner = existingOwners.get(p.handle);
    if (owner && !(owner.supplier_slug === p.supplier_slug && owner.external_id === p.external_id)) {
      issues.push({ handle: p.handle, externalId: p.external_id, reason: 'target-collision', detail: `已被 ${owner.supplier_slug}/${owner.external_id} 佔用(products.handle 全域唯一)` });
    }
  }
  return issues;
}

export function printHandlePreflightReport(issues: HandleIssue[], productCount: number): void {
  console.log('\n=== handle preflight(F4、charset + 全域唯一)===');
  if (!issues.length) {
    console.log(`✅ ${productCount} 群 handle 全部合法且唯一(charset 白名單 + 批內 + target 零撞)`);
    return;
  }
  const byReason = (r: HandleIssue['reason']): number => issues.filter((i) => i.reason === r).length;
  // console.warn(非 error):本函式僅列報告、真正 abort 由 rpm-import 寫入模式 throw 發出(dry-run 不該顯紅字錯誤)。
  console.warn(
    `🔴 handle preflight 發現 ${issues.length} 筆問題(charset ${byReason('charset')} / 批內重複 ${byReason('batch-duplicate')} / target 撞 ${byReason('target-collision')})、寫入模式將 abort:`,
  );
  console.table(issues.slice(0, 50));
  if (issues.length > 50) console.log(`(另有 ${issues.length - 50} 筆未列;修髒 handle 源頭 sku 後重跑)`);
}

// ── #261:per-group 分類解析彙整(乾跑診斷)──
export interface CategoryResolutionSummary {
  mappedGroupCount: number; // categoryId 對上的群數
  unmappedGroupCount: number; // categoryId=null 的群數
  unmapped: { majorCategoryZh: string; groupCount: number }[]; // 未對上 major_category_zh × 群數(群數降冪、同數 zh 升冪)
}

/**
 * 彙整 per-group 分類解析結果(#261):把「未對上 categories.raw_path」的 major_category_zh 依群數聚合。
 * fixed 策略(rpm)不呼叫此(records 空、無 per-group 解析)。
 */
export function summarizeCategoryResolution(
  records: { majorCategoryZh: string; categoryId: string | null }[],
): CategoryResolutionSummary {
  const unmappedCounts = new Map<string, number>();
  let mappedGroupCount = 0;
  for (const r of records) {
    if (r.categoryId === null) {
      const key = r.majorCategoryZh || '(空 major_category_zh)';
      unmappedCounts.set(key, (unmappedCounts.get(key) ?? 0) + 1);
    } else {
      mappedGroupCount++;
    }
  }
  const unmapped = [...unmappedCounts.entries()]
    .map(([majorCategoryZh, groupCount]) => ({ majorCategoryZh, groupCount }))
    .sort((a, b) => b.groupCount - a.groupCount || (a.majorCategoryZh < b.majorCategoryZh ? -1 : 1));
  const unmappedGroupCount = unmapped.reduce((s, u) => s + u.groupCount, 0);
  return { mappedGroupCount, unmappedGroupCount, unmapped };
}

/**
 * #261 寫入前硬 gate 資料源:找出 category_id=null 的商品(products.category_id NOT NULL、
 * null 進 upsert = 23502、該 500 列批全敗)。呼叫端:dry-run 列清單不 throw(配合 summarizeCategoryResolution
 * 彙整報告);寫入模式 abort 不進 upsert。fixed 策略(rpm)category_id 恆非 null → 回 []、gate 空過。
 */
export function findNullCategoryProducts<T extends { category_id: string | null }>(productRows: T[]): T[] {
  return productRows.filter((p) => p.category_id === null);
}

export function printCategoryResolutionReport(s: CategoryResolutionSummary): void {
  console.log('\n=== per-group 分類解析彙整(#261 乾跑診斷)===');
  console.log(
    `已對上: ${s.mappedGroupCount} 群 / 未對上: ${s.unmappedGroupCount} 群(${s.unmapped.length} 種 major_category_zh)`,
  );
  if (s.unmapped.length) {
    // console.warn(非 error):P0-B seed 前預期全未對上;真正寫入 abort 由 #261 null-category gate 發(尚未落地)。
    console.warn(
      '⚠️ 以下 major_category_zh 未對上 categories.raw_path(P0-B seed 前預期;seed 後仍未對上 = 該類漏 seed);' +
        '🔴 寫入模式 null-category 會撞 products.category_id NOT NULL(#261 硬 gate 待補、Phase 1 試點寫入前):',
    );
    console.table(s.unmapped.slice(0, 30));
    if (s.unmapped.length > 30) console.log(`(另有 ${s.unmapped.length - 30} 種未列)`);
  } else {
    console.log('✅ 全部 per-group 分類皆對上 categories.raw_path');
  }
}
