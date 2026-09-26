// 退貨收回(第 2 片):後台畫面用的型別、名稱與「還能退幾件」的計算。
// 計畫:docs/plans/2026-09-27-order-returns.md。資料庫:20260927010000(order_returns / order_return_items)。
// 🔴 這裡算的可退數量只給畫面當輸入上限與提示用;真正擋的是 admin_register_return(鎖單之後重算)。

export type ReturnStatus = 'registered' | 'received' | 'voided';
export type ReturnReasonCode = 'defective' | 'wrong_item' | 'changed_mind' | 'other';
export type ReturnCondition = 'good' | 'damaged';

export type OrderReturnItemRow = {
  orderItemId: string;
  quantity: number;
  receivedQuantity: number | null;
  condition: ReturnCondition | null;
};

export type OrderReturnRow = {
  id: string;
  status: ReturnStatus;
  reasonCode: ReturnReasonCode;
  reasonDetail: string | null;
  note: string | null;
  trackingNumber: string | null;
  registeredBy: string;
  registeredAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  receiveNote: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  items: OrderReturnItemRow[];
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  registered: '退貨中（等商品寄回）',
  received: '已收回',
  voided: '已作廢',
};

export const RETURN_REASON_LABEL: Record<ReturnReasonCode, string> = {
  defective: '商品瑕疵',
  wrong_item: '寄錯商品',
  changed_mind: '客人不要了',
  other: '其他',
};
export const RETURN_REASON_CODES = Object.keys(RETURN_REASON_LABEL) as ReturnReasonCode[];

export const RETURN_CONDITION_LABEL: Record<ReturnCondition, string> = {
  good: '良好',
  damaged: '有損傷',
};

/** 沒作廢的退貨占用的數量:已收回算實收數量、退貨中算登記數量(同 admin_register_return)。 */
function takenBy(r: OrderReturnRow, item: OrderReturnItemRow): number {
  if (r.status === 'voided') return 0;
  if (r.status === 'received') return item.receivedQuantity ?? 0;
  return item.quantity;
}

/**
 * 每個品項:已出貨、已占用、還能退幾件。
 * 可退數量可能是負的(審查 C1:退貨登記之後那個包裹又被作廢出貨)⇒ 原樣回傳, 讓畫面標出來。
 */
export function returnableByItem(
  items: readonly { id: string; shippedQuantity: number }[],
  returns: readonly OrderReturnRow[],
): Map<string, { shipped: number; taken: number; returnable: number }> {
  const out = new Map<string, { shipped: number; taken: number; returnable: number }>();
  for (const it of items) {
    let taken = 0;
    for (const r of returns) for (const ri of r.items) if (ri.orderItemId === it.id) taken += takenBy(r, ri);
    out.set(it.id, { shipped: it.shippedQuantity, taken, returnable: it.shippedQuantity - taken });
  }
  return out;
}

export type ReturnRefundSuggestion = {
  /** 建議退款金額(整數元) */
  amount: number;
  /** true ⇒ 至少一個品項的數量被「現在的已出貨數量」壓低了(審查 C1), 畫面要說明 */
  capped: boolean;
  lines: { orderItemId: string; quantity: number; unitPrice: number; capped: boolean }[];
};

/**
 * 退貨收回第 3 片(Sean 2026-09-27 Q2 甲):「為這筆退貨登記退款」的建議金額 = 實收數量 × 當初成交單價, 員工可以改。
 * 審查 C1:數量上限用【現在】的已出貨數量再算 —— 扣掉其他沒作廢的退貨占用之後, 不能超過剩下的量
 *   (包裹在退貨登記之後被作廢出貨時, 不讓建議金額比實際出過的貨還多)。
 * 🔴 只是預填:不含運費(公司吸收, 08-13 §0-I)、不攤訂單折扣;能退多少仍由既有退款流程的上限檢查決定。
 * 只有 received 才給建議;其他狀態回 null。
 */
export function suggestReturnRefund(
  r: OrderReturnRow,
  items: readonly { id: string; shippedQuantity: number; unitPrice: number }[],
  allReturns: readonly OrderReturnRow[],
): ReturnRefundSuggestion | null {
  if (r.status !== 'received') return null;
  const lines: ReturnRefundSuggestion['lines'] = [];
  for (const ri of r.items) {
    const received = ri.receivedQuantity ?? 0;
    const item = items.find((it) => it.id === ri.orderItemId);
    if (received <= 0 || !item) continue;
    let others = 0;
    for (const o of allReturns) {
      if (o.id === r.id) continue;
      for (const oi of o.items) if (oi.orderItemId === ri.orderItemId) others += takenBy(o, oi);
    }
    const quantity = Math.max(0, Math.min(received, item.shippedQuantity - others));
    lines.push({ orderItemId: ri.orderItemId, quantity, unitPrice: item.unitPrice, capped: quantity < received });
  }
  return {
    amount: lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    capped: lines.some((l) => l.capped),
    lines,
  };
}
