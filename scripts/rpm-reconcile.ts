/**
 * rpm-reconcile — S4 下架對賬(源頭消失 → 軟下架、不硬刪避免撞訂單/歷史)
 *
 * 雙向 lifecycle:
 *   - 復架(re-list):presence=active 由 rpm-transform ProductRow 帶 `delisted_at: null`、
 *     upsert 時自動還原(商品回到 source view → 復上架);本檔不處理復架、只處理下架。
 *   - 下架(delist):target 現存「未下架」RPM 商品中、不在本次 source external_id 集合者 → 設 delisted_at=now。
 *     變體無 delisted_at 欄、靠 S1 RLS(parent 未下架 EXISTS)連動隱藏、不個別下架。
 *
 * 🔴 安全紅線(下架=會藏整列、destructive-ish、防呆從嚴):
 *   - source 集合為空 → 硬 abort(疑 fetch 失敗、絕不下架全部、不可 bypass)。
 *   - 待下架比例 > DELIST_RATIO_ABORT(疑來源殘缺、批次部分抓)→ abort 除非顯式 --allow-large-delist。
 *   - 只在 FULL 模式跑(無 --group/--limit;篩選下 source 不完整、跑了會誤殺全站)→ 由 rpm-import 把關。
 *   - applyDelist 一律 scope supplier_slug='rpm'(rollback 反向也須此 scope)+ delisted_at IS NULL(冪等、不覆寫既有時戳)。
 *
 * 全程唯讀比對 + 只在 confirm-write 才 UPDATE;唯讀 SELECT 只取 external_id(不取金額/敏感欄)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const SUPPLIER = 'rpm';
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
export async function readActiveExternalIds(tgt: SupabaseClient): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('products')
      .select('external_id')
      .eq('supplier_slug', SUPPLIER)
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
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): Promise<ReconcileReport> {
  const active = await readActiveExternalIds(tgt);
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
 * 執行軟下架:UPDATE delisted_at=now WHERE supplier_slug='rpm' AND external_id IN batch AND delisted_at IS NULL。
 * 回實際下架列數(.select 計);冪等(再跑不重複設、IS NULL 過濾)。
 */
export async function applyDelist(tgt: SupabaseClient, externalIds: string[], now: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < externalIds.length; i += WRITE_BATCH) {
    const batch = externalIds.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('products')
      .update({ delisted_at: now })
      .eq('supplier_slug', SUPPLIER) // 🔴 scope rpm(rollback 反向也須此 scope)
      .is('delisted_at', null) // 冪等:只動現未下架、不覆寫既有下架時戳
      .in('external_id', batch)
      .select('external_id');
    if (error) throw new Error(`applyDelist batch@${i}: ${error.message}`);
    n += (data ?? []).length;
    console.log(`  下架 delisted: ${Math.min(i + WRITE_BATCH, externalIds.length)}/${externalIds.length}`);
  }
  return n;
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
