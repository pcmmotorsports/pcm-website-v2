import type { OrderShipmentGroup } from '../shipping/order-shipments';

// cancel-shipment-warning.ts — 取消一張【已經有貨在路上】的單之前,擋下來問一次。
//
// 🔵 Sean 2026-09-03 拍甲(plan `~/pcm-mailbox/plan-取消已出貨單擋一次-20260903.md`)。
//
// 🔴🔴 **它防的是什麼**:今天實查 —— 取消那條路對出貨**三層都零**
//    (`cancel-view.ts` 唯一 shipment 命中是註解 · `a8c1_begin_cancel_guard.sql` 0 ·
//     `a8a1_admin_cancel_order.sql` 0;🟢 正對照:同一支 `cancel-view.ts` 的
//     `payment_status` 命中 15 ⇒ 尺會動, 那個 0 是真的)。
//    ⇒ 一張已出貨的單被取消 ⇒ 自動退款照跑 ⇒ **客人拿回錢, 而貨照樣送到他家。**
//    ⇒ 🎯 而我們對新竹**零呼叫** ⇒ **唯一的攔截路徑本來就是【人】**
//      ⇒ ⇒ 而在這一片之前, **我們沒有在那個人按下去之前提醒他。**
//
// 🛑 **它【不是】禁止** —— 是擋下來、印出後果、讓他確認過再取消。

/** 這一格判準用哪一欄, 以及為什麼不用另一欄。 */
//
// ⛔ ~~`hct_status`~~ **不能用**:實測它**永遠停在 `'draft'`** —— 寫它的應用碼是 0
//    (唯一命中 `components/orders/shipment-section.tsx:305` 是一句**註解**在轉述值域)。
//    ⇒ 📌 一個永遠是同一個值的欄位, 對「叫過車沒有」**零判別力**。
// ✅ `shippedAt` 非 null = 員工按過「已出貨」= 貨確定交出去了。
// ✅ `trackingNumber` 有值 = 有託運單號(員工手打)= **可能**已交出去。
// ⛔ ~~`voidedAt` 非 null = 那張箱單**已作廢** ⇒ **不算**。~~
// 🔴🔴 **Sean 2026-09-03 拍甲:作廢的箱【也要】跳警告。**
//    ⇒ 而**原本那個決定不是判錯 —— 是當時少一格資訊**:
//      「作廢」撤銷的是**我們系統裡的紀錄**, 而**我們對貨運零呼叫**
//      ⇒ 它不會讓那件貨自己回來。⇒ 📌 **箱被作廢 ≠ 貨被攔下來。**
//      (那一格是 2026-09-03 codex 對抗審查指出的, 原作者 `-db` 當時沒有它。)
//    ⚠️ **代價 Sean 知道並接受**:作廢過的單每次取消都要多按一次(誤擋變多)。
//    ⇒ 🛑 **那與「已知風險」不同 —— 有人看過它並選了這一邊, 而那個人是 Sean。**
//
// 🔴🔴 **取【聯集】而不是只取 `shippedAt`, 理由是代價不對稱**:
//    誤擋的代價 = 多按一次;漏擋的代價 = **錢退了而貨照樣送到客人家**。
//    ⇒ 而兩者說的**不是同一件事** ⇒ 所以那句話跟著分岔(見 {@link CancelShipmentWarning})。

/**
 * `trackingNumber` 有沒有值。
 *
 * 🔴🔴 **空字串在這張表上是【合法值】, 不是髒資料** —— 所以不可以只判 `!== null`:
 *    DB 那道 `shipments_shipped_needs_tracking`
 *    (`20260805170000_m4b_e10_b2_s1a1_shipments.sql:161-164`)**只在 `shipped_at IS NOT NULL` 時生效**
 *    ⇒ **一張還沒出貨的箱, `tracking_number` 可以是 `''` 或全空白, 沒有任何約束擋。**
 *    ⇒ 📌 只判 null 的話, 那種箱會觸發一個**假的警示** —— 而假警示會被人學會忽略。
 *    (同一個形狀今天早上才修過一次:`??` 接不住空字串, 而 `customers.phone` 的預設就是 `''`。)
 *
 * ⚠️ **我不宣稱它與 DB 那支 `pcm_b2_is_blank` 等價**:那支列了 7 種空白字元
 *    (`:56-70`),而 JS 的 `trim()` 是**另一個集合**(它還會吃掉 `﻿` 等)。
 *    ⇒ 兩者的差集是幾個罕見字元, 而**本格是警示不是資料閘** ⇒ 判為可接受。
 *    🛑 **若哪天要把這個判準搬去 DB 側或拿它擋寫入, 這一句就不成立了, 要回來重對。**
 */
function hasTracking(trackingNumber: string | null): boolean {
  return trackingNumber !== null && trackingNumber.trim() !== '';
}

export type CancelShipmentWarning =
  | { readonly blocked: false }
  | {
      readonly blocked: true;
      /** `shipped` 已按過出貨 · `tracking_only` 只有單號 · `unreadable` 讀不到 */
      readonly kind: 'shipped' | 'tracking_only' | 'unreadable';
      /** 給人看的那句話。**三種各不同, 而三種都會印。** */
      readonly message: string;
    };

/**
 * 那句話。
 *
 * 🔴🔴 **字面刻意寫「我們不會自動通知新竹攔件」, 而【不是】「貨不會被攔下來」** ——
 *    這是線 `-ship` 2026-09-03 訂正的, 而理由有兩層, 第二層才是重點:
 * ```
 * 🔬 -ship 用測試帳號打過新竹正式主機(唯讀):
 *    https://Hctrt.hct.com.tw/EDI_WebService2/Service1.asmx ⇒ 200 · 伺服器自列 24 支操作
 *    🔴 其中【有】TransDataCancel_Json(取消託運)⇒ 新竹【攔得了】, 是我們沒接線
 *
 * ① 「攔不了」把一個【暫時的缺口】寫成一個【永久的物理性質】
 *    ⇒ 接線做完那天, 沒有任何東西會提醒任何人回來改這句話
 * ② 🔴 而它改變【員工當下的動作】:
 *    讀成「我們沒通知, 但你可以自己打電話」⇒ 他【還來得及攔】
 *    讀成「攔不了」                      ⇒ 他【不會去試】
 * ⇒ ⇒ 一句寫太滿的話, 讓一件做得到的事變成沒有人去做。
 * ```
 * ⚠️ 那 24 支是 **`-ship` 量的, 不是本片量的** —— 我沒有打過那台主機。
 */
const NO_AUTO_INTERCEPT = '我們不會自動通知新竹攔件 —— 要攔的話請自己打電話給貨運。';

export const CANCEL_SHIPMENT_MESSAGE = {
  shipped: `這張單已經出貨。取消會退款, 而${NO_AUTO_INTERCEPT}`,
  tracking_only: `這張單已經有託運單號, 可能已經交給貨運。取消會退款, 而${NO_AUTO_INTERCEPT}`,
  unreadable: `讀不到這張單的出貨狀態。取消會退款, 而我不能保證貨沒有出去, 也${NO_AUTO_INTERCEPT}`,
} as const;

/**
 * 這張單取消前要不要擋下來問一次。
 *
 * 🔴🔴 **`null` 走【擋】那一側 —— 這是本函式最重要的一格。**
 *    `loadOrderShipments` 在品項列數超過上限時回 `null`
 *    (`lib/shipping/order-shipments.ts:48`,該檔逐字「**`null` = 這批【可能不完整】,
 *    不是『沒有箱』**」)⇒ 那是**量不到**, 不是**沒有出貨**。
 *    ⇒ 🛑 **一個讀不到時安靜放行的閘, 正好會在最亂的那張單上放行。** fail-closed。
 *    ⇒ 📌 而它印的話也不同(「讀不到」而不是「已經出貨」)——
 *      **在三個世界印三個不同的東西, 而三個都會印。**
 */
export function cancelShipmentWarning(
  groups: readonly OrderShipmentGroup[] | null,
): CancelShipmentWarning {
  if (groups === null) {
    return { blocked: true, kind: 'unreadable', message: CANCEL_SHIPMENT_MESSAGE.unreadable };
  }
  // ⛔ ~~已作廢的箱先剔掉 —— 它不再代表任何一件在路上的貨。~~
  // 🔴 **Sean 2026-09-03 拍甲:不剔了** —— 作廢只撤我們的紀錄, 貨可能仍在路上。
  //    ⇒ 🧪 守門:同檔測試「箱已作廢 ⇒ 仍要擋」。把 `.filter(voidedAt === null)` 加回來 ⇒ 那一格紅。
  const live = groups;
  if (live.some((g) => g.shipment.shippedAt !== null)) {
    return { blocked: true, kind: 'shipped', message: CANCEL_SHIPMENT_MESSAGE.shipped };
  }
  if (live.some((g) => hasTracking(g.shipment.trackingNumber))) {
    return { blocked: true, kind: 'tracking_only', message: CANCEL_SHIPMENT_MESSAGE.tracking_only };
  }
  return { blocked: false };
}
