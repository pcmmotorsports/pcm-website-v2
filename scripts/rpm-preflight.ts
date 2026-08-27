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

// ── M2:首灌群數指紋(Codex R1 2026-07-19 must-fix M2)──
/**
 * W1 抓取完整性 gate 的結構性盲區:它比的是「target 現存上架 − 本次 source」的差集,
 * **首灌(target active=0)分母為 0 → shrinkRatio 恆 0 → 恆過**。此時來源只抓到 500/648
 * 也照灌,顧客站首日就少 148 群、且沒有任何基線可事後察覺(缺的東西從沒存在過)。
 *
 * 補法=呼叫端帶「預期群數指紋」當外部基線(乾跑當下實查、寫進 .command/runbook),
 * 寫入模式下:首灌**必須**帶(不帶=fail-closed abort)、帶了不符即停。
 * 非首灌不強制(W1 差集本身已有分母、能量出缺口)。
 *
 * 刻意不設容差:指紋是「這一批就是這麼多群」的快照,來源真的變了就重跑乾跑、改數字再來
 * ——這道摩擦正是它的價值(自動放寬 = 又變成恆過的閘)。
 */
export interface GroupCountGateReport {
  sourceGroupCount: number;
  expectedGroupCount: number | null;
  isFirstLoad: boolean; // target 該供應商 active=0
  required: boolean; // 本次是否強制要指紋(寫入 + 首灌)
  aborted: boolean;
  abortReason?: string;
}

export function checkGroupCountGate(params: {
  sourceGroupCount: number;
  expectedGroupCount: number | null;
  targetActiveCount: number;
  isWrite: boolean;
}): GroupCountGateReport {
  const { sourceGroupCount, expectedGroupCount, targetActiveCount, isWrite } = params;
  const isFirstLoad = targetActiveCount === 0;
  const required = isWrite && isFirstLoad;
  const base = { sourceGroupCount, expectedGroupCount, isFirstLoad, required };

  if (expectedGroupCount === null) {
    return required
      ? {
          ...base,
          aborted: true,
          abortReason:
            `首灌(target 現存上架=0)必須帶 --expect-groups=<乾跑實查群數> 當基線:` +
            `W1 縮水閘在首灌恆過(分母 0)、來源殘缺無從察覺。本次來源 ${sourceGroupCount} 群,` +
            `確認屬實後帶 --expect-groups=${sourceGroupCount} 重跑`,
        }
      : { ...base, aborted: false };
  }
  if (sourceGroupCount !== expectedGroupCount) {
    return {
      ...base,
      aborted: true,
      abortReason:
        `群數指紋不符:來源 ${sourceGroupCount} 群 ≠ 預期 ${expectedGroupCount} 群` +
        `(差 ${sourceGroupCount - expectedGroupCount});疑來源殘缺/截斷或來源真的變了。` +
        `先重跑乾跑確認全貌,屬實再改 --expect-groups(不設容差=刻意的摩擦)`,
    };
  }
  return { ...base, aborted: false };
}

export function printGroupCountGate(r: GroupCountGateReport): void {
  console.log('\n=== 群數指紋 gate(M2、首灌基線)===');
  if (r.aborted) {
    console.error(`🔴 ALERT 群數指紋 abort、不寫:${r.abortReason}`);
    return;
  }
  if (r.expectedGroupCount !== null) {
    console.log(`✅ 來源 ${r.sourceGroupCount} 群 = 預期指紋 ${r.expectedGroupCount} 群`);
  } else {
    console.log(
      `(未帶 --expect-groups;來源 ${r.sourceGroupCount} 群、${r.isFirstLoad ? '首灌' : '非首灌'}` +
        `${r.isFirstLoad ? '、寫入模式將強制要求指紋' : '、W1 差集已有基線、不強制'})`,
    );
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
    // console.warn(非 error):真正寫入 abort 由 rpm-import #261 null-category 硬 gate 發(已落地、findNullCategoryProducts)。
    console.warn(
      '⚠️ 以下 major_category_zh 未對上 categories.raw_path(新大類漏 seed 或來源改名);' +
        '🔴 寫入模式由 #261 硬 gate abort 不進 upsert(products.category_id NOT NULL;dry-run 僅列報告):',
    );
    console.table(s.unmapped.slice(0, 30));
    if (s.unmapped.length > 30) console.log(`(另有 ${s.unmapped.length - 30} 種未列)`);
  } else {
    console.log('✅ 全部 per-group 分類皆對上 categories.raw_path');
  }
}

// ── #789 分類語意 gate(名字 vs 分類麵包屑)────────────────────────────────
/**
 * #789:匯入端既有的只有「category_id=null」硬 gate,而 v2 解析恆有未分類 fallback
 * ⇒ 那道 gate 對「掛錯分類」零判別力(rpm-import.ts 該段註解逐字:「categoryId 恆非 null」)。
 * 掛錯的商品在前後台都【正常顯示】:有名字、有價格、有圖、買得下去;唯一的錯是客人在正確
 * 分類底下找不到它 —— 而那個失敗發生在客人的瀏覽器裡,沒有任何一格會紅。
 *
 * 本 gate 斷言的是【語意】不是【接線】:名字已經明說是哪一種濾芯的商品,不得落進相剋的分類。
 * 規則出處 = 來源匯出自己寫過的警告逐字:「機油濾芯跟進氣無關,客人點進氣系統看到機油濾芯是錯的」。
 *
 * 🔴 中英雙語是必要的,不是保險:ProductRow.title = product_name_zh || product_name(中文優先)。
 *    2026-08-21 實測 dna 787 筆【全部】有中文名 ⇒ 只寫英文 pattern 的話這道 gate 掃到 0 列、恆綠。
 *    反過來只寫中文也不行:同日實測「英文有 air filter 而中文沒有『空氣濾』」有 165 筆。
 *
 * ⚠️ 規則刻意窄:只認名字裡明說的那兩種。名字沒明說的一律不管
 *    ⇒ 它會【少報】不會【誤報】,而少報是可接受的失敗方向。要擴就加進 CATEGORY_SEMANTIC_RULES。
 *
 * 📌 上線當天不會紅(2026-08-21 對 dna 787 筆實測):違規 0 筆。
 *    而【那個 0 本身沒有判別力】—— 同一次量測裡規則一掃到 34 列、規則二掃到 548 列,
 *    ⇒ 0 是「掃到了而沒有違規」,不是「什麼都沒掃到」。判別力在 rpm-preflight.test.ts 的負對照。
 *
 * 🔴 射程(2026-08-21 R1 審查標,不是缺陷、是那兩個數字證不到的那一半):
 *    「規則一掃到 34 / 規則二掃到 548」是 **namePattern** 的命中數 —— 它證明的是 AND 的【一半】。
 *    「掃到了」被證明了;「掃到了 **而且 rawPath 比對到了正確的分類字面**」**沒有**。
 *    forbiddenPathPrefix 的分隔符若與 categories.raw_path 實際值不一致(全形/半形/空格數),
 *    startsWith 會永遠不成立 ⇒ 該規則恆綠,而 namePattern 的命中數【看起來一模一樣】。
 *    ⚠️ 審查側已查:兩個 prefix 字面在 migration 裡逐字存在(含那個 `·`)⇒ 這一發沒被打破。
 *       但那證的是「字面在 migration 裡存在」,不是「真實 categories.raw_path 欄位的值長那樣」。
 *    ⇒ 要收掉這個射程只有一條路:**第一次真的跑匯入時,核對下方報告印出的兩個數字**(見 print 函式)。
 */
export const CATEGORY_SEMANTIC_RULES = [
  {
    rule: 'oil-filter-must-not-be-intake',
    namePattern: /oil ?filters?|機油濾/i,
    forbiddenPathPrefix: '進氣系統',
    why: '機油濾芯跟進氣無關,客人點進氣系統看到機油濾芯是錯的',
  },
  {
    rule: 'air-filter-must-not-be-oil-category',
    namePattern: /air ?filters?|空氣濾/i,
    forbiddenPathPrefix: '引擎與冷卻 · 機油與濾芯',
    why: '空氣濾芯掛進機油分類,客人在空氣濾芯底下找不到它',
  },
] as const;

export type CategorySemanticRow = { external_id: string; title: string; rawPath: string };
export type CategorySemanticMismatch = CategorySemanticRow & { rule: string; why: string };

/**
 * 回傳違反語意規則的列。空陣列 = 沒有違規(呼叫端寫入模式 abort、乾跑僅列報告)。
 * rawPath 空字串(未對上 v2 pair)一律略過 —— 那一格由 #261 的未分類 fallback 與彙整報告負責,
 * 本 gate 不重複管,也不要因為「沒有麵包屑」就報一個沒有依據的違規。
 */
export function findCategorySemanticMismatches(rows: CategorySemanticRow[]): CategorySemanticMismatch[] {
  const out: CategorySemanticMismatch[] = [];
  for (const r of rows) {
    if (!r.rawPath) continue;
    for (const rule of CATEGORY_SEMANTIC_RULES) {
      if (rule.namePattern.test(r.title) && r.rawPath.startsWith(rule.forbiddenPathPrefix)) {
        out.push({ ...r, rule: rule.rule, why: rule.why });
        break; // 一列只報第一條命中的規則,避免同一筆重複洗版
      }
    }
  }
  return out;
}

/**
 * 🔴 收【列陣列】而不是收一個 number:R1 審查的 DN-1 是呼叫端把「全部的列數」當成「實際掃描列數」傳進來,
 *    而括號裡那句「rawPath 為空者不列入」是對的 ⇒ **話對、數字錯,而畫面上分不出來**。
 *    修法不是把那個數字算對,是**讓呼叫端沒有機會傳錯** —— 兩個數都由本函式從同一份 rows 算出來。
 * 🔴 兩個數都印,差距本身就是資訊:總數 == 實掃 ⇒ 每一列都被看過;
 *    實掃遠小於總數 ⇒ 大部分列連進判別式都沒進去,那個「0 違規」不代表什麼。
 */
export function printCategorySemanticReport(rows: CategorySemanticRow[], mismatches: CategorySemanticMismatch[]): void {
  const totalRows = rows.length;
  const scannedRows = rows.filter((r) => r.rawPath).length; // 與 findCategorySemanticMismatches 的 `if (!r.rawPath) continue` 同一個條件
  const denom = `總 ${totalRows} 列 / 實際掃描 ${scannedRows} 列(rawPath 為空的 ${totalRows - scannedRows} 列未進判別式)`;
  console.log('\n=== #789 分類語意 gate(名字 vs 分類麵包屑)===');
  if (!mismatches.length) {
    // 🔴 把分母印出來:沒有分母的「0 違規」與「gate 根本沒跑」在畫面上長得一樣。
    console.log(`✅ 語意違規 0 筆(${denom})`);
    return;
  }
  console.warn(`⚠️ 語意違規 ${mismatches.length} 筆(${denom})—— 寫入模式將 abort:`);
  console.table(mismatches.slice(0, 30).map((m) => ({ external_id: m.external_id, title: m.title, rawPath: m.rawPath, rule: m.rule })));
  if (mismatches.length > 30) console.log(`(另有 ${mismatches.length - 30} 筆未列)`);
}
