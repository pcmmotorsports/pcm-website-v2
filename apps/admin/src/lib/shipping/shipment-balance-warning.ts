// shipment-balance-warning.ts —— 建箱彈窗裡那句「尾款 X 元未收」。
//
// ═══ 它是誰的字 ═══
// Sean 2026-09-04 兩次拍板, 原話逐字(落點 `~/pcm-mailbox/Sean拍板-20260904-七題.md`):
//   ① 「甲 可以 —— 但那個框裡要**明顯**寫『尾款 X 元未收』」
//   ② 「甲 也要顯示 —— **那條路要去拿到金額**」(訂單列表勾單出貨那條路)
// ⇒ 未收尾款**可以**出貨, 而**兩個入口**的彈窗都要印那句話。出貨是不可逆的對外動作。
//
// ═══ 🔴 為什麼它從元件檔搬到這裡(2026-09-04 同日第二次改) ═══
// 第一版把它放在 `components/orders/shipment-section.tsx`, 由**訂單詳情頁**算好、
// 用 prop 一路傳進彈窗。而那個形狀有一個結構性的洞, codex 對抗審查(MF7)點出來、Sean 接著拍了②:
//   🔴 **兩個入口共用同一個彈窗, 而只有一個入口在傳** ——
//      `OrderShipButton`(詳情頁)有傳;`shipping-selection.tsx`(列表勾單)沒傳。
//      ⇒ **同一張未收尾款的訂單有一條沒有警告的繞道。**
// ✅ 修法**不是**「讓列表那條路也算一次」—— 那會變成**兩個生產者**, 而兩份會各自漂。
//    ⇒ 改成:**兩個入口本來就都走 `fetchShipmentCandidates`** ⇒ 把這句話算進**那一份回傳**裡。
//    ⇒ 📌 **一個生產者、兩個入口** —— 而「列表那條路沒有 payments」這個障礙就消失了,
//       因為算它的地方從 client 那一端搬到了 server(`loadShipmentCandidates`)。
//
// ═══ 🔴 第一引數為什麼寫成 `detail.total.amount` 而不是收一個 `amountDue: number` ═══
// `payment-amount-due-single-source.test.ts` 那道跨檔守門在盯「**尾款/已收的第一個引數只有一個來源**」,
// 它認得的形狀只有 `detail.total.amount` 與 `amountDue`(而後者另有一格驗它的 **JSX prop 鏈**源頭)。
// ⇒ 🛑 若本函式改收 `amountDue: number`, 它會落進「認得但沒有人驗它從哪來」的縫裡
//    —— **那道閘會照樣綠, 而不變式其實鬆了。** 所以刻意收整包 `detail`。
// 🟢 實測過它在守:把本函式的內容突變成自己手算 ⇒ 那支守門當場 **2 紅**(呼叫端 4 ⇒ 3)。

import type { AdminOrderDetail } from '@pcm/domain';

import { formatOrderAmount } from '../orders/order-list-view';
import { toPaymentSummary, type OrderPaymentRow } from '../orders/payment-list-view';

/** 與 `components/orders/payment-list.tsx` 的 `PaymentListData` 同構的最小輸入。 */
export type BalancePayments =
  | { status: 'ok'; rows: readonly OrderPaymentRow[] }
  | { status: 'order_not_found' }
  | { status: 'unreadable' };

/**
 * 回傳要印在彈窗裡的那一句;`null` = **什麼都不印**。
 *
 * 🔴 **走與訂單詳情頁那格 `ShipmentBalanceNote` 同一支 `toPaymentSummary`, 不自己減。**
 *   自己算 = 第二個「尾款」的定義, 而兩份會各自漂。
 *
 * 🔴 **`settled` / `over` 回 `null` 是刻意的, 而理由不是「沒事」**:
 *   📌 **一個恆常出現的提示等於沒有提示** —— 它會讓下一個人以為「這裡有在提醒」
 *      而不去查它有沒有在**該叫的時候**叫。
 *   ⚠️ 而**頁面上**那一格照舊印「款項已收足」—— 那是**看板**, 本函式是**警告**,
 *      兩者的空白意義不同, 不要拿去對齊。
 *
 * ⚠️🔴 **`unknown` 也回一句, 而那是【實作者的判斷不是 Sean 的字】** —— 明寫讓它可以被推翻:
 *   他說的是「尾款 X 元未收」, 而 `unknown` 沒有 X。仍然讓它出聲的理由逐字抄自
 *   `ShipmentBalanceNote` 的檔頭:「讀不到明細時算出來的『已收』**必然是假的**」,
 *   而在**出貨鈕旁邊**印一片空白會讓員工以為已收足。
 *   ⇒ 要拿掉這一態, 刪那個 `if`, 測試會紅並指到這裡。
 */
export function shipmentBalanceWarning(
  detail: AdminOrderDetail,
  payments: BalancePayments,
): string | null {
  const summary = toPaymentSummary(
    detail.total.amount,
    payments.status === 'ok' ? payments.rows : null,
  );
  // 🔴 Sean 的字面是「尾款 X 元未收」—— **帶「元」**。
  //    ⚠️ 而**頁面上**那一格逐字是「尾款 N 未收」(設計稿 08-17 `:349` 畫的那種、不帶「元」)
  //    ⇒ 兩處**刻意不同**:稿管看板那一格, 他管彈窗這一格。**不要拿去統一。**
  if (summary.kind === 'short') return `尾款 ${formatOrderAmount(summary.gap)} 元未收`;
  if (summary.kind === 'unknown') {
    // 🔴 **codex 2026-09-04 MF2 訂正**:⛔ ~~收尾只寫「出貨前請先確認」~~ ——
    //   它逐字指出 `unknown` 是「無法判定」不是「仍有尾款」, 而**這句話可以被讀向兩個相反的方向**
    //   (已付清而讀取失敗 ⇒ 員工白停件;或反過來被讀成「那就是還沒收」而其實可以出)。
    //   ⇒ 📌 **一句在兩個世界都成立的提醒, 不會幫人做決定。**
    //   ✅ 修法不是把話講死(我們真的不知道), 是**告訴他去哪裡看一眼** —— 讓那句話可以被結束。
    return '尾款未知(收款明細沒載入)—— 不是「已收足」,也不是「還沒收到錢」。出貨前請到「收款 · 退款」分頁看一眼。';
  }
  return null;
}
