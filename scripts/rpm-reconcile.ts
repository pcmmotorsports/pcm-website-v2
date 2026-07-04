/**
 * rpm-reconcile — S4 下架對賬(源頭消失 → 軟下架、不硬刪避免撞訂單/歷史)+ V1 變體級對賬
 *
 * 雙向 lifecycle:
 *   - 復架(re-list):presence=active 由 rpm-transform ProductRow 帶 `delisted_at: null`、
 *     upsert 時自動還原(商品回到 source view → 復上架);本檔不處理復架、只處理下架。
 *   - 下架(delist):target 現存「未下架」RPM 商品中、不在本次 source external_id 集合者 → 設 delisted_at=now。
 *     變體無 delisted_at 欄、靠 S1 RLS(parent 未下架 EXISTS)連動隱藏、不個別下架。
 *   - 🔴 變體級對賬(V1、2026-07-05 雙跨模型審查 must-fix F1-F3):群(main_sku)還在、但群內某
 *     variant sku 從來源消失 → 該變體殘留 DB + 前台選項可見 + create_order 可下單(凍結舊價)=
 *     客人買到停產色。修:computeVariantOrphans 差集(scope=本次要寫的群)→ 寫入模式 applyVariantDelete
 *     **硬刪**(order_items.variant_id FK ON DELETE SET NULL、migration 20260604120000:143 註明
 *     「變體刪不破歷史」;order_items 自帶 sku/spec/價快照欄、cart stale variantId 已有 found:false 路徑)。
 *     刪除在 products upsert 後、variants upsert **前**(變體改名同 spec 時先清舊列、免撞 pv_spec_unique 23505=F3)。
 *
 * 🔴 安全紅線(下架=會藏整列、destructive-ish、防呆從嚴):
 *   - source 集合為空 → 硬 abort(疑 fetch 失敗、絕不下架全部、不可 bypass)。
 *   - 待下架比例 > DELIST_RATIO_ABORT(疑來源殘缺、批次部分抓)→ abort 除非顯式 --allow-large-delist。
 *   - 只在 FULL 模式跑(無 --group/--limit;篩選下 source 不完整、跑了會誤殺全站)→ 由 rpm-import 把關。
 *   - applyDelist 一律 scope supplier_slug=<呼叫端 supplierSlug>(每家自成一輪、rollback 反向也須此 scope)+ delisted_at IS NULL(冪等、不覆寫既有時戳)。
 *
 * 全程唯讀比對 + 只在 confirm-write 才 UPDATE;唯讀 SELECT 只取 external_id(不取金額/敏感欄)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const READ_BATCH = 1000;
const WRITE_BATCH = 500;
const DELIST_RATIO_ABORT = 0.1; // 單次下架比例硬上限(>10% 疑來源殘缺、防誤殺;確認後 --allow-large-delist 放行)

export interface ReconcileReport {
  targetActive: number; // target 現存未下架 RPM 商品數
  sourcePresent: number; // 本次 source 出現的 external_id 數
  toDelist: string[]; // target 有、source 無 → 待下架 external_id
  ratio: number; // toDelist / targetActive
  aborted: boolean; // 安全 gate 觸發(不可下架)
  abortReason?: string;
  largeDelistBypassed: boolean; // ratio 超限但 --allow-large-delist 顯式放行(loud log 提醒、留 audit trail)
}

/** 分批讀 target 現存「未下架」RPM 商品 external_id(只取 key、不取金額/敏感;S5 W1 共用) */
export async function readActiveExternalIds(tgt: SupabaseClient, supplierSlug: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('products')
      .select('external_id')
      .eq('supplier_slug', supplierSlug)
      .is('delisted_at', null)
      .order('external_id')
      .range(from, from + READ_BATCH - 1);
    if (error) throw new Error(`readActiveExternalIds@${from}: ${error.message}`);
    const rows = (data ?? []) as { external_id: string }[];
    out.push(...rows.map((r) => r.external_id));
    if (rows.length < READ_BATCH) break;
  }
  return out;
}

/**
 * 算待下架:target 未下架 RPM 商品 − 本次 source external_id 集合。
 * 套用安全 gate(source 空 / 比例超限)、回報告(不寫)。
 */
export async function computeDelist(
  tgt: SupabaseClient,
  supplierSlug: string,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): Promise<ReconcileReport> {
  const active = await readActiveExternalIds(tgt, supplierSlug);
  const toDelist = active.filter((id) => !sourceExternalIds.has(id));
  const ratio = active.length > 0 ? toDelist.length / active.length : 0;

  const largeDelist = toDelist.length > 0 && ratio > DELIST_RATIO_ABORT;
  let aborted = false;
  let abortReason: string | undefined;
  let largeDelistBypassed = false;
  if (sourceExternalIds.size === 0) {
    aborted = true;
    abortReason = '來源 external_id 集合為空(疑 fetch 失敗)、絕不下架全部、硬 abort(不可 bypass)';
  } else if (largeDelist && !opts.allowLargeDelist) {
    aborted = true;
    abortReason = `待下架比例 ${(ratio * 100).toFixed(1)}% 超上限 ${DELIST_RATIO_ABORT * 100}%(疑來源殘缺/部分抓);確認屬實後帶 --allow-large-delist`;
  } else if (largeDelist) {
    largeDelistBypassed = true; // ratio 超限但顯式 --allow-large-delist 放行 → printReconcileReport loud log + audit
  }
  return {
    targetActive: active.length,
    sourcePresent: sourceExternalIds.size,
    toDelist,
    ratio,
    aborted,
    abortReason,
    largeDelistBypassed,
  };
}

/**
 * 執行軟下架:UPDATE delisted_at=now WHERE supplier_slug=supplierSlug AND external_id IN batch AND delisted_at IS NULL。
 * 回實際下架列數(.select 計);冪等(再跑不重複設、IS NULL 過濾)。
 */
export async function applyDelist(tgt: SupabaseClient, supplierSlug: string, externalIds: string[], now: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < externalIds.length; i += WRITE_BATCH) {
    const batch = externalIds.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('products')
      .update({ delisted_at: now })
      .eq('supplier_slug', supplierSlug) // 🔴 scope 該供應商(rollback 反向也須此 scope)
      .is('delisted_at', null) // 冪等:只動現未下架、不覆寫既有下架時戳
      .in('external_id', batch)
      .select('external_id');
    if (error) throw new Error(`applyDelist batch@${i}: ${error.message}`);
    n += (data ?? []).length;
    console.log(`  下架 delisted: ${Math.min(i + WRITE_BATCH, externalIds.length)}/${externalIds.length}`);
  }
  return n;
}

// ── V1:變體級對賬(孤兒變體=群在、變體 sku 從來源消失;2026-07-05 雙跨模型審查 must-fix)──

const VARIANT_DELETE_RATIO_ABORT = 0.1; // 單次孤兒刪除比例硬上限(對齊商品下架 10%;疑來源變體殘缺、防誤刪)

export interface VariantOrphan {
  sku: string;
  externalId: string; // 所屬群 main_sku(報告用、客訴可回查)
}

export interface VariantOrphanReport {
  targetInScope: number; // target 現存、parent 在本次 source 群集合內的變體數(比例分母)
  sourceSkuCount: number; // 本次 source 變體 sku 數
  orphans: VariantOrphan[]; // target 有、source 無 → 待硬刪
  ratio: number; // orphans / targetInScope
  aborted: boolean; // 安全 gate 觸發(不可刪)
  abortReason?: string;
  largeDeleteBypassed: boolean; // ratio 超限但 --allow-large-delist 顯式放行(loud log、audit trail)
}

/**
 * 純分類(可測):target 變體(sku+所屬群 externalId)vs 本次 source。
 * 孤兒判定 = parent 群在本次 source 集合內(該群變體集完整、差集可信)且 sku 不在 source sku 集合。
 * parent 不在 source → 交給商品級 delist 路徑(RLS 連動隱藏)、不在此刪(復架時由下一輪對賬收斂)。
 * 安全 gate(fail-closed、對齊商品級):source sku 集合空 → 硬 abort(疑 transform 失敗、絕不刪全部);
 * 比例 > 10% → abort 除非 allowLargeDelist(顯式放行留 audit)。
 */
export function classifyVariantOrphans(
  targetVariants: VariantOrphan[],
  sourceSkus: Set<string>,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): VariantOrphanReport {
  const inScope = targetVariants.filter((v) => sourceExternalIds.has(v.externalId));
  const orphans = inScope.filter((v) => !sourceSkus.has(v.sku));
  const ratio = inScope.length > 0 ? orphans.length / inScope.length : 0;

  const largeDelete = orphans.length > 0 && ratio > VARIANT_DELETE_RATIO_ABORT;
  let aborted = false;
  let abortReason: string | undefined;
  let largeDeleteBypassed = false;
  if (sourceSkus.size === 0 && inScope.length > 0) {
    aborted = true;
    abortReason = '來源變體 sku 集合為空(疑 transform 失敗)、絕不刪全部變體、硬 abort(不可 bypass)';
  } else if (largeDelete && !opts.allowLargeDelist) {
    aborted = true;
    abortReason = `孤兒變體比例 ${(ratio * 100).toFixed(1)}% 超上限 ${VARIANT_DELETE_RATIO_ABORT * 100}%(疑來源變體殘缺);確認屬實後帶 --allow-large-delist`;
  } else if (largeDelete) {
    largeDeleteBypassed = true;
  }
  return {
    targetInScope: inScope.length,
    sourceSkuCount: sourceSkus.size,
    orphans,
    ratio,
    aborted,
    abortReason,
    largeDeleteBypassed,
  };
}

/**
 * 讀 target 該供應商全部變體(sku + 所屬群 external_id;embed parent、唯讀非敏感欄)+ 純分類。
 * 全模式可跑:fetch 永遠全量 → 本次要寫的每一群其 source 變體集完整,--group/--limit 篩選下
 * scope 亦只縮到被寫的群(sourceExternalIds 即 productRows 集合)、不會拿殘缺集合誤刪別群變體。
 */
export async function computeVariantOrphans(
  tgt: SupabaseClient,
  supplierSlug: string,
  sourceSkus: Set<string>,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): Promise<VariantOrphanReport> {
  const targetVariants: VariantOrphan[] = [];
  for (let from = 0; ; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('product_variants')
      .select('sku, products!inner(external_id)')
      .eq('supplier_slug', supplierSlug)
      .order('sku')
      .range(from, from + READ_BATCH - 1);
    if (error) throw new Error(`computeVariantOrphans@${from}: ${error.message}`);
    // supabase-js 動態 embed select 回型別無法靜態推 → 雙 cast escape hatch(同 rpm-delta/readExistingPrices)
    const rows = (data ?? []) as unknown as { sku: string; products: { external_id: string } }[];
    targetVariants.push(...rows.map((r) => ({ sku: r.sku, externalId: r.products.external_id })));
    if (rows.length < READ_BATCH) break;
  }
  return classifyVariantOrphans(targetVariants, sourceSkus, sourceExternalIds, opts);
}

/**
 * 執行孤兒變體硬刪:DELETE WHERE supplier_slug=<scope> AND sku IN batch。
 * 冪等(再跑查無列)。order_items.variant_id FK ON DELETE SET NULL → 訂單歷史不破(自帶快照欄)。
 */
export async function applyVariantDelete(tgt: SupabaseClient, supplierSlug: string, skus: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < skus.length; i += WRITE_BATCH) {
    const batch = skus.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('product_variants')
      .delete()
      .eq('supplier_slug', supplierSlug) // 🔴 scope 該供應商(不變式 1)
      .in('sku', batch)
      .select('sku');
    if (error) throw new Error(`applyVariantDelete batch@${i}: ${error.message}`);
    n += (data ?? []).length;
    console.log(`  孤兒變體 deleted: ${Math.min(i + WRITE_BATCH, skus.length)}/${skus.length}`);
  }
  return n;
}

export function printVariantOrphanReport(r: VariantOrphanReport, opts: { full?: boolean } = {}): void {
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  console.log('\n=== 變體級對賬(V1、孤兒變體=群在但變體從來源消失)===');
  console.log(
    `target 變體(本次群範圍): ${r.targetInScope} / source 變體 sku: ${r.sourceSkuCount} / 孤兒(待硬刪): ${r.orphans.length}(${(r.ratio * 100).toFixed(1)}%)`,
  );
  if (r.orphans.length) {
    console.log(`孤兒變體清單(${opts.full ? '全量' : '前 50'};寫入模式將刪除、dry-run 僅列):`);
    console.table(r.orphans.slice(0, cap));
  } else {
    console.log('✅ 無孤兒變體(target 變體全在 source)');
  }
  if (r.largeDeleteBypassed) {
    console.warn(
      `⚠️ 大比例孤兒刪除 ${(r.ratio * 100).toFixed(1)}%(${r.orphans.length} 變體)經 --allow-large-delist 放行 — 請確認來源變體完整、非殘缺誤刪`,
    );
  }
  if (r.aborted) {
    console.error(`🔴 ALERT 變體對賬 abort、不刪:${r.abortReason}`);
  }
}

export function printReconcileReport(r: ReconcileReport, opts: { full?: boolean } = {}): void {
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  console.log('\n=== 下架對賬(S4)===');
  console.log(
    `target 現存上架 RPM: ${r.targetActive} / source 出現: ${r.sourcePresent} / 待下架(source 消失): ${r.toDelist.length}(${(r.ratio * 100).toFixed(1)}%)`,
  );
  if (r.toDelist.length) {
    console.log(`待下架 external_id(${opts.full ? '全量' : '前 50'}):`);
    console.table(r.toDelist.slice(0, cap).map((id) => ({ external_id: id })));
  } else {
    console.log('✅ 無待下架(target 上架商品全在 source、零孤兒)');
  }
  if (r.largeDelistBypassed) {
    console.warn(
      `⚠️ 大比例下架 ${(r.ratio * 100).toFixed(1)}%(${r.toDelist.length} 商品)經 --allow-large-delist 放行 — 請確認來源完整、非殘缺誤殺`,
    );
  }
  if (r.aborted) {
    console.error(`🔴 ALERT 下架對賬 abort、不下架:${r.abortReason}`);
  }
}
