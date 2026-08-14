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
  // 🏁 **2026-08-14 換口徑(Sean 在正式站退了兩筆真錢之後回報)**:舊字面是
  //    「已受理(不等於已入帳,入帳以對帳為準)」。理由不是措辭偏好,是**我們手上已經有憑證**——
  //    `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:337-339` 的 UPDATE 守門
  //    **本體**(`IF NEW.status = 'confirmed' AND NEW.tappay_refund_id IS NULL THEN RAISE`,
  //    `ERRCODE = 'P7C09'`、constraint `a7c_confirm_requires_tappay_refund_id`)
  //    ⇒ **能走到 `confirmed` 的列必然帶著 TapPay 退款憑證**
  //    (**結構保證**,不是「那兩筆剛好有」的歸納)。把已知的事寫成未知 = 員工以為還要再追一次。
  //    ⚠️ 括號那句**不准寫死鐘點**:入帳依各家銀行而定,寫死一個時間就是對員工說謊。
  //    ⚠️ **只換這一態** —— 下一行 `processing` 的「已受理」是準確的,一個字都不要動。
  confirmed: '退款完成(客人入帳時間依照各家銀行而定)',
  deferred: '尚未請款、本筆已作廢(請款完成後可重新發起)',
  failed: '失敗(錢沒有動)',
};

/** failed_reason 機器碼 → 員工字面(值域=RPC G6 allowlist;未知碼原樣顯示、不猜)。 */
export const REFUND_FAILED_REASON_LABEL: Record<string, string> = {
  rejected_out_of_range: 'TapPay 拒絕:金額超出可退範圍(先對帳再重新發起)',
  not_sent: '請求未送出(參數未通過檢查)',
  // 🔴 措辭刻意寫成「**人工判定為**」而不是「錢沒有動」(#473b-2 兩關同抓):
  //    另兩碼是結構保證(`not_sent`=根本沒送出、`rejected_out_of_range`=TapPay 當場拒絕),
  //    **本碼是人看 Record 數字下的判斷、可能判錯** —— 而 `#473` 的整個存在前提就是它會錯。
  //    把待查的判定寫成金流事實,員工就不會再去追 TapPay。
  manual_failed: '人工判定為沒有動到錢(RW4 對帳結案;這是人工判定,不是系統確認)',
};

/** 狀態字面(未知狀態=S6 allowlist 之外的未來值,原樣顯示——顯示層不猜語意)。
 *  Object.hasOwn:值域雖受 DB CHECK 限制,`obj[key]` 吃原型鏈是本 repo 記過的同型事故
 *  (result-banner 曾六頁中招、2026-08-06 #332-2 已全數硬化,
 *  memory reference_js-index-lookup-hits-prototype-chain 有時間軸)。 */
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
 * 🔴 異常清單頁的 DB 查詢(**可處理那支**)與訂單頁的列級警示都吃本常數 —— 兩處各寫一個 30 就會漂。
 * ⚠️ 「卡住」那半(`isStuckManualVerdict`)**不吃本常數**:它與滯留時間無關,改本值不影響它。
 */
export const REFUND_EXCEPTION_STALL_MS = 30 * 60 * 1000;

/**
 * 「卡住的人工判定列」的機器碼(backlog `#473`)。
 * 🔴 DB 側權威 = `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:760` 的
 *    `SET status='failed', failed_reason='manual_failed'`(RW4 出口);
 *    `failed_reason` 的值域 = 同檔 `:181`(該欄 COMMENT 逐字列出三碼:
 *    `rejected_out_of_range` / `not_sent` / `manual_failed`)。
 *    ⚠️ 兩關都提了「值域權威應該是 `:656`/`:809` 的 allowlist」—— **開檔核過:那是 `outcome`
 *       參數的 6 碼 allowlist,不是 `failed_reason` 的值域**,兩者是不同的東西(`outcome` 還含
 *       `accepted` / `deferred_not_captured` / `recovered_confirmed`)。⇒ 此條**不採納**,維持 `:181`。
 * 🔴 **字面只寫一次**:異常清單的查詢述詞與顯示判定共用本常數 ——
 *    上面 `REFUND_FAILED_REASON_LABEL` 的 key 是**顯示字典**、不是述詞來源,兩者不得互相當真相。
 */
export const STUCK_MANUAL_VERDICT_FAILED_REASON = 'manual_failed';

/**
 * 這列是否為「已結案、但判定本身沒有更正入口」的卡住列(backlog `#473`)。
 *
 * 🔴 **與 `isRefundException` 是兩個判準,刻意不合併**:
 *  - `isRefundException` 鏡射的是 **RW4 動作閘**(`refund-recovery-actions.ts:87` 只吃 `processing`)——
 *    它回 true 代表「這列可以按對帳判定」。
 *  - 本函式回 true 代表「這列**沒有任何動作可按**,但員工仍必須看得見它」。
 *  把兩者併成一個 boolean 會讓畫面對這兩種列長得一樣 —— 而它們該做的事完全相反。
 * ⚠️ 本函式**不代表出口存在** —— **更正入口到今天仍然不存在**。
 *    已做的只有「看得見」兩片(`#473b-2` 清單 + `#483` 訂單頁徽章);
 *    真正的出口是 `473b-1`(新 RPC),**尚未實作、plan 等 Sean 批**。
 *    (命名易混:`#473b-2` 已 commit ≠ 出口做好了。)
 */
export function isStuckManualVerdict(row: {
  status: string;
  failedReason: string | null;
}): boolean {
  return row.status === 'failed' && row.failedReason === STUCK_MANUAL_VERDICT_FAILED_REASON;
}

/**
 * 這列是否屬於異常清單的**可處理**那半(plan §4-1):processing 且(滯留逾閾 或 已有受理證據)。
 * 🔴 evidence 非空 = G7-hold(TapPay 已受理但金額不符)= **當下已知異常、不等 30 分**(fable N4)。
 * ⚠️ 清單的**成員資格**已不等於本函式 —— `isStuckManualVerdict` 那半也會進清單(`#473`)。
 *    本函式維持 processing-only 是刻意的:它鏡射動作閘,不是清單述詞。
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
