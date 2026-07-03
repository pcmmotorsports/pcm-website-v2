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
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { readActiveExternalIds } from './rpm-reconcile';

const FETCH_SHRINK_ABORT = 0.05; // 商品消失率 >5% 疑截斷硬 abort(比 S4 下架 10% 嚴、專抓 5–10% 靜默截斷帶)

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
