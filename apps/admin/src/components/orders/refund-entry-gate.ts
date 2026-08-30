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
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **反向指標:migration 那邊寫了一句【字面為真、而會誤導你】的話**(2026-08-20 W3)
// ══════════════════════════════════════════════════════════════════════════
//   `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:48` 與 `:430` 逐字:
//     「`pcm_order_refundable_remaining()` 是**顯示用函式**,沒有任何 trigger 讀它。」
//     「🔴🔴 **這不是守門**(拍板⑤)。沒有任何 trigger 呼叫它。」
//
//   **那兩句沒有說錯** —— DB 層確實沒有 trigger 讀它,拍板⑤「不做防止超退的守門」也仍然成立。
//   🔴 **而它答的是「有沒有 trigger」,讀的人問的是「有沒有東西依賴它」** ——
//      本檔上面那段(`:5-8`)就是答案:**每一張訂單**都對它的可用性有一條 **fail-closed 依賴**。
//   ⇒ 打算改動 / 刪除 / 換簽章那支函式的人:**先讀本檔,不要只讀那支 migration。**
//     目前已知的消費者(**會過期,發現不對就當場改這份清單**):
//       · `apps/admin/src/lib/payment/refund-read.ts:106`            實際 `.rpc()` 呼叫點
//       · `apps/admin/src/components/orders/refund-entry-gate.ts`    本檔(fail-closed 閘)
//       · `apps/admin/src/components/orders/order-detail-route.tsx:202`
//       · `packages/domain/src/order/refund-remaining-single-source.test.ts` 單一真相守門
//
//   ⚠️ **為什麼不去改那支 migration 的註解**:它**已 apply 且不可變** ——
//      `supabase/APPLIED.tsv` 記著它的 sha256(`9f222ea0…`,2026-08-20 實測與現檔相符),
//      而 `scripts/b2s2a-verify.sh:475` 逐字寫著「改 migration 裡的 COMMENT 會先撞上 sha256 閘」。
//      ⇒ **已 apply 的 migration 連註解都不能動;更正只能寫在會被一起 grep 到的地方,也就是這裡。**

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
  /**
   * 🔴 帳本列被截斷 —— **這一格沒有預設值,是刻意的。**
   *
   * 給它 `= false` 會讓「還沒接線」與「接了而這張單沒截斷」在型別上、在畫面上、在測試上
   * **全部長得一樣**,而漏接的那一刻**沒有任何東西會紅**。
   * ⇒ 必填 ⇒ 新的呼叫端不傳就是編譯錯誤。
   *
   * 語意:`true` = 這一頁**看不出這張單退過多少**(`refund-ledger-section.tsx:94` 那一區塊
   * 為此**一列都不顯示**,並逐字寫著「也不要在這個狀態下發起退款」)。
   */
  refundsTruncated: boolean;
  /**
   * 🔴 帳本裡有「**人工判定為沒有動到錢**」而卡住的列(`isStuckManualVerdict`)。
   * **同樣沒有預設值,理由同上一格。**
   *
   * 為什麼它比 `processing` 危險(2026-08-24 SUB2-009,兩題都答「危險」):
   *   Q1 這一頁算得出退過多少嗎 ⇒ **算不準,而且錯在不安全的方向**:那一列是 `failed`
   *      ⇒ **不佔額** ⇒ 未登記額被**高估** ⇒ 看起來「還能再退」。
   *      而那個判定**本來就可能錯**(`refund-ledger-view.ts` 逐字:「這是人工判定,
   *      不是系統確認」;`#473` 的存在前提就是它會錯)。
   *   Q2 server 端擋得住嗎 ⇒ **擋不住**:`S5` 只認 `processing`(`refund-actions.ts:297`),
   *      而 `REFUND_EXCEEDS_REMAINING` **吃的正是那個被高估的數字**。
   * ⇒ 與 `processing` 的處置**刻意相反**:那一格按下去會拿到具名訊息、錢是安全的 ⇒ 不藏;
   *   這一格按下去**會真的送出**去 ⇒ 藏。
   *
   * 🔴 **而藏起來只修掉一半** —— 那個被高估的數字**沒有動**,不經過這個畫面的路徑一樣會撞到。
   *   ⇒ backlog `#890`。**看到入口不見了,不要讀成「這件事處理過了」。**
   *
   * 🔵🔵 **2026-08-30 更正(`#890` 片4;只加不刪,舊字面留著讓搜舊句的人同一發撞到)**
   *   ① **上面那句「server 端擋不住」今天不成立了** —— `refund-actions.ts` 的 ④-b 就是那道
   *      server 閘(判準與這裡共用 `isBlockingStuckVerdict`)。⇒ 現在**兩端都擋**。
   *   ② **而 `hasStuckRefundVerdict` 的語意變了**:它不再是「有沒有卡住的列」,
   *      是「**有沒有卡住而且還沒有人擔保過的列**」——
   *      已被更正為 `no_money_moved` 的列**不再擋**(Sean 2026-08-30 拍板)。
   *   ③ ⚠️ **上面那段「未登記額被高估」只對【未更正】的列成立** ——
   *      `20260820100000:231-248` 的第二段**會扣掉** `corrected_to='money_moved'` 的 failed 列。
   *      (我在片4 一度以為它不扣,而那是**只讀了算式的一半**。)
   */
  hasStuckRefundVerdict: boolean;
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
    // 🔴 截斷 = 帳本列超過本頁上限 ⇒ 那一區塊**一列都不顯示**(`refund-ledger-section.tsx:94`),
    //    並逐字對值班說「**也不要在這個狀態下發起退款**」⇒ 入口不能還亮著。
    //    這一條與上面那條負值是**同一個判準的兩個觸發源**(上面那段註解就是它的出處),
    //    而它在 2026-08-24 之前不在這份輸入裡 —— 不是沒想到:`order-detail.tsx` 已經寫下
    //    「截斷與收款讀不到不在閘的輸入裡」,只是那句話被拿去回答**紅標題該不該變**,
    //    沒有人拿它問**入口該不該暗掉**。
    // ⚠️ **刻意不含** `manualRefundsFailed` / `manualRefundsTruncated`:那兩格的紅字講的是
    //    **非卡退款登記**那另一個入口(「勿在此期間重複登記」),它們該不該關掉 **TapPay**
    //    入口是一個要有人判的問題,不是順手擴進來的事。⇒ 已列 backlog,見交件檔。
    !input.refundsTruncated &&
    // 🔴 卡住的人工判定(見上方該格的兩題):那一列的字面逐字說「**這裡沒有可以改的動作**」,
    //    而入口若還亮著、按下去**還真的會送出** ⇒ 那不是矛盾,是一句會被照著相信的假話。
    !input.hasStuckRefundVerdict &&
    // channel 閘(R1 N5)= 顯示層:轉帳/現金單不該看到「線上退款(TapPay)」紅框。
    input.paymentChannel === 'tappay' &&
    REFUND_ENTRY_STATUSES.includes(input.paymentStatus)
  );
}
