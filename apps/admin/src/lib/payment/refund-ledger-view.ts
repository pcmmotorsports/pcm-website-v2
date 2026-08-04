// refund-ledger-view.ts — M-3 A7c RW3:退款帳本「顯示層」純函式(零 IO;供訂單頁帳本區塊
// 與異常清單頁共用字面 —— 兩處各養一份 label 就是下一個漂移點)。
//
// 🔴🔴 措辭鐵律(關卡1 codex F25 + remaining 函式 COMMENT 逐字):
//    `pcm_order_refundable_remaining` 只反映**本系統帳本**(processing+confirmed 佔額),
//    Sean 直接在 TapPay Portal 退的錢完全不在其中 ⇒ 真實剩餘可退額 ≤ 此值。
//    UI 措辭必須是「**帳本未登記額**」,**不得**寫「還能退」「剩餘可退」——
//    值班照著錯的名字按下去 = 同一筆錢退兩次。測試對這條掛負向格。

/** 帳本列狀態 → 員工字面(語意=值班該做什麼,不是技術狀態名)。 */
export const REFUND_STATUS_LABEL: Record<string, string> = {
  processing: '處理中(勿重複發起)',
  confirmed: '已受理(不等於已入帳,入帳以對帳為準)',
  deferred: '尚未請款、本筆已作廢(請款完成後可重新發起)',
  failed: '失敗(錢沒有動)',
};

/** failed_reason 機器碼 → 員工字面(值域=RPC G6 allowlist;未知碼原樣顯示、不猜)。 */
export const REFUND_FAILED_REASON_LABEL: Record<string, string> = {
  rejected_out_of_range: 'TapPay 拒絕:金額超出可退範圍(先對帳再重新發起)',
  not_sent: '請求未送出(參數未通過檢查)',
  manual_failed: '人工判定失敗(RW4 對帳結案)',
};

/** 狀態字面(未知狀態=S6 allowlist 之外的未來值,原樣顯示——顯示層不猜語意)。
 *  Object.hasOwn:值域雖受 DB CHECK 限制,`obj[key]` 吃原型鏈是本 repo 記過的同型事故
 *  (result-banner 五頁全中,memory reference_js-index-lookup-hits-prototype-chain)。 */
export function refundStatusLabel(status: string): string {
  return Object.hasOwn(REFUND_STATUS_LABEL, status) ? REFUND_STATUS_LABEL[status]! : status;
}

export function refundFailedReasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return Object.hasOwn(REFUND_FAILED_REASON_LABEL, reason)
    ? REFUND_FAILED_REASON_LABEL[reason]!
    : reason;
}

/**
 * 異常滯留閾值(plan §4-1 逐字:30 分 = 保守異常閾;同步流程正常 = 秒級)。
 * 🔴 異常清單頁的 DB 查詢與訂單頁的列級警示都吃本常數 —— 兩處各寫一個 30 就會漂。
 */
export const REFUND_EXCEPTION_STALL_MS = 30 * 60 * 1000;

/**
 * 這列是否屬於異常清單(plan §4-1):processing 且(滯留逾閾 或 已有受理證據)。
 * 🔴 evidence 非空 = G7-hold(TapPay 已受理但金額不符)= **當下已知異常、不等 30 分**(fable N4)。
 */
export function isRefundException(
  row: { status: string; createdAt: string; providerEvidence: string | null },
  nowMs: number,
): boolean {
  if (row.status !== 'processing') return false;
  if (row.providerEvidence !== null) return true;
  const created = Date.parse(row.createdAt);
  // 時間戳解析不出來 = 資料異常;fail-closed 進清單讓人看,不靜默藏起來。
  if (Number.isNaN(created)) return true;
  return nowMs - created > REFUND_EXCEPTION_STALL_MS;
}
