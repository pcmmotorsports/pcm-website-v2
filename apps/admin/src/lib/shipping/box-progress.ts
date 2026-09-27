// 箱子進度(2026-09-27 出貨流程甲;報告 ~/pcm-mailbox/後台出貨流程審視-20260927.md 第四節)。
// 🔴 訂單列表的「下一步」與出貨清單的「狀態」都讀這一支 ⇒ 兩頁對同一箱永遠講同一句話
//    (報告問題 4:同一箱在訂單列表是「未收現貨」、在出貨清單是「新竹已收單」, 對不起來)。
// 只讀資料、不寫入;欄位都是 `shipments` 本來就有的。

export type BoxProgressRow = {
  shipmentId: string;
  carrierCode: string;
  hctStatus: string;
  hctDispatchAttemptedAt: string | null;
  hctDispatchedAt: string | null;
  shippedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
};

export type BoxProgress =
  | 'voided'
  | 'shipped'
  | 'dispatch_uncertain'
  | 'dispatched'
  | 'number_uncertain'
  | 'ready_to_dispatch'
  | 'needs_number'
  | 'needs_tracking';

/** 出貨清單「狀態」那一格的字(員工看的)。 */
export const BOX_PROGRESS_LABEL: Record<BoxProgress, string> = {
  voided: '已作廢',
  shipped: '已出貨',
  dispatch_uncertain: '叫車結果未確認',
  dispatched: '已叫車',
  number_uncertain: '要號結果未確認',
  ready_to_dispatch: '已取得託運單號，還沒叫車',
  needs_number: '還沒要託運單號',
  needs_tracking: '已建立',
};

const has = (v: string | null): boolean => v !== null && v !== '';

export function boxProgress(r: BoxProgressRow): BoxProgress {
  // 🔴 作廢排第一:作廢的箱也可能有 shipped_at(同 shipment-list-view.ts `shipmentListStatus` 的順序)。
  if (has(r.voidedAt)) return 'voided';
  if (has(r.shippedAt)) return 'shipped';
  if (r.carrierCode !== 'hct') return 'needs_tracking';
  // 叫車佔位寫了而沒記到叫到車 ⇒ 車可能已經在路上(hct-dispatch-flow.ts `dispatchButton` 同一個判準)。
  if (has(r.hctDispatchAttemptedAt)) return has(r.hctDispatchedAt) ? 'dispatched' : 'dispatch_uncertain';
  if (r.hctStatus === 'submitted') return 'ready_to_dispatch';
  if (r.hctStatus === 'unknown') return 'number_uncertain';
  return 'needs_number';
}

export type PendingBox = { progress: BoxProgress; shipmentId: string; createdAt: string };

/** 需要人去確認的排最前;作廢與已出貨的箱不算。 */
const PRIORITY: readonly BoxProgress[] = [
  'dispatch_uncertain',
  'dispatched',
  'number_uncertain',
  'ready_to_dispatch',
  'needs_number',
  'needs_tracking',
];

/** 一張單的箱子裡, 「下一步」要看的那一箱;沒有還沒出貨的箱 ⇒ null。 */
export function pendingBox(rows: readonly BoxProgressRow[]): PendingBox | null {
  let best: PendingBox | null = null;
  for (const r of rows) {
    const progress = boxProgress(r);
    const rank = PRIORITY.indexOf(progress);
    if (rank === -1) continue;
    if (best === null || rank < PRIORITY.indexOf(best.progress)) {
      best = { progress, shipmentId: r.shipmentId, createdAt: r.createdAt };
    }
  }
  return best;
}
