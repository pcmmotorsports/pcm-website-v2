import type { AdminOrderDetail } from '@pcm/domain';

// refund-entry-gate.ts — #445a-3:退款入口「該不該渲染」的純判斷。
//
// 🔴 **抽成獨立檔的理由 = 讓這個閘有一個「條件級」的 oracle,而且不必 mock `server-only`。**
//    445a-3 刪掉 `order-detail-route.tsx` 裡「有帳本列才查未登記額」的短路 ⇒
//    **每一張訂單**都新增一條對 `pcm_order_refundable_remaining` 可用性的
//    fail-closed 依賴(以前零帳本列時根本不呼叫、不可能失敗)。
//
// ⚠️ **更正(關卡2 codex nit,2026-08-14)**:我原本在這裡寫「這個閘在本片之前**零測試覆蓋**」,
//    量法是 `grep -rln "refundUnregisteredFailed" --include="*.test.tsx"` = 零命中。
//    **那句是假的** —— `app/orders/[id]/refund-wiring.test.tsx:293-309` 早就用**整頁渲染**
//    覆蓋了「未登記額讀取失敗 ⇒ 入口 fail-closed」,只是它的字面是
//    `getLedgerUnregisteredAmount.mockRejectedValue` + `hasRefundEntry()`,**我的 grep 掃不到**。
//    ⇒ 正確說法:**頁級行為早有 oracle;缺的是條件級的窮舉**(本檔的測試補這一層,
//    例如「0 是合法值不該關」「null 不等於失敗」這種單一條件的邊界)。
//    🔴 這是同日第三次「掃描字集比宣稱窄」,記在這裡當實例。
//
// ⚠️ 放在 `order-detail.tsx` 裡也能測,但要 `vi.mock('server-only')` ——
//    那是在測試裡替生產模組換掉一個依賴。純判斷不該需要那種手術,故獨立成檔。
//
// 🔴 **邏輯逐字照搬自 `order-detail.tsx` 原本的 JSX 條件,一個條件都沒有改。**

// 這裡只決定「入口值不值得渲染」,判錯的後果 = 員工按了拿到 action 的具名失敗訊息,不是繞過。
// 型別釘 enum(R1 N4):日後 payment status 改名時這裡編譯紅,而不是入口靜默消失。
export const REFUND_ENTRY_STATUSES: readonly AdminOrderDetail['paymentStatus'][] = [
  'paid',
  'partiallyRefunded',
];

export function shouldShowRefundEntry(input: {
  refundEnabled: boolean;
  refundsFailed: boolean;
  /** 🔴 445a-3 起這個 true **變成可達的** —— 以前零帳本列時不呼叫該 RPC。 */
  refundUnregisteredFailed: boolean;
  /** `null` = 查無(不是失敗,失敗有自己的旗標);負值 = 對帳異常。 */
  refundUnregisteredAmount: number | null;
  paymentChannel: AdminOrderDetail['paymentChannel'];
  paymentStatus: AdminOrderDetail['paymentStatus'];
}): boolean {
  return (
    input.refundEnabled &&
    !input.refundsFailed &&
    !input.refundUnregisteredFailed &&
    // 負值 = 帳本登記已超過訂單總額(對帳異常)⇒ 區塊明寫「勿再發起」,入口不能還亮著:
    // 同一頁「文字叫你別按、按鈕還亮著」就是自打嘴巴。
    !(input.refundUnregisteredAmount !== null && input.refundUnregisteredAmount < 0) &&
    // channel 閘(R1 N5)= 顯示層:轉帳/現金單不該看到「線上退款(TapPay)」紅框。
    input.paymentChannel === 'tappay' &&
    REFUND_ENTRY_STATUSES.includes(input.paymentStatus)
  );
}
