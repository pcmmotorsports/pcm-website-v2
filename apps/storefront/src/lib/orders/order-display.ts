// order-display.ts — 會員訂單列表「顯示層」工具(M-3 OrdersTab / OverviewTab 共用)
//
// L1/L2 文案 + 純顯示格式化,放 app(UI)層;domain OrderListItem 攜原始資料(ISO 日期 + 雙軸 enum),
// 由此處轉成畫面字串。非 paid 文案為 Sean 2026-06-20 拍板定稿(Q2=A);paid 分支自 2026-08-03 依
// E10 master plan v2 §5.1 row47(Q12=B + R7)固定「處理中」(理由見 orderStatusLabel JSDoc)。

import type { PaymentStatus, FulfillmentStatus } from '@pcm/domain';

/**
 * orderStatusLabel:付款 × 出貨雙軸 → 單一中文狀態字串。
 *
 * | payment | fulfillment | 顯示 |
 * |---|---|---|
 * | refunded | (任意) | 已退款 |
 * | unpaid | (任意) | 待付款 |
 * | partiallyPaid | (任意) | 已收訂金 |
 * | partiallyRefunded | (任意) | 已退部分 |
 * | paid | (任意) | 處理中 |
 *
 * 🔴 A9f(E10 master plan v2 §5.1 row47、Q12=B + R7):paid 原依 `PAID_FULFILLMENT_LABEL[fulfillment]`
 * 細分出貨階段,但 `fulfillment_status` 是 stale 出貨軸(admin 端已停止維護、顯示端 A9e 下架)⇒
 * 第 1 批 paid 一律固定「處理中」、不再讀出貨軸。
 * 🔴 **2026-08-18 Sean 拍 Q06=甲,`partiallyPaid` 由 ~~「付款確認中」~~ 改「已收訂金」——
 *    這一條【推翻】了 2026-06-20 Q2=A 那句「其餘四值一字不動」。** 原字面描述的是另一個狀態:
 *    客人讀「付款確認中」= 系統在驗我的付款、我不用做事;實際語意 = 訂金收了、尾款還欠。
 *    其餘三值(已退款 / 待付款 / 已退部分)仍沿用 06-20 拍板、一字不動。
 *    🔴🔴 **這個字面【斷言了一件狀態本身不保證的事】,而那正是它取代的那句的病** ——
 *    codex 關卡2 抓到:`partiallyPaid` 只表示「收了一部分」,不保證那一部分的性質是【訂金】。
 *    反例:訂單原已付清、之後沖銷其中一筆收款而落回 partiallyPaid ⇒ 剩下的不是訂金;一般不足額付款同理。
 *    ⇒ **本字面成立的前提 = 寫入端保證「凡 partiallyPaid 必為已收訂金」。** 那個不變條件**今天還不存在**。
 *    📌 而今天不會出事,因為**沒有任何東西寫得出這個狀態**(可重跑:
 *       `grep -rn partially_captured supabase/migrations/ apps/ packages/ --include='*.sql' --include='*.ts' | grep -v '\.test\.'`
 *       ⇒ **1 命中,而那一筆是 packages/domain/src/order/types.ts:26 的型別對照註解、不是寫入**;
 *       正向對照 `grep -c "SET payment_status" ... 'paid'` ⇒ 5 ⇒ 這把 grep 抓得到寫入。)
 *    🔴 **所以這是一張欠條,不是一個已驗證的字面**:Sean 08-12 要的尾款流程
 *       (收款→採購→到貨→尾款→出貨)一旦開工,**做那條線的人要嘛保證上面那個不變條件、
 *       要嘛把這個字面換成中性的「已收部分款」**。兩條路都行,不能兩條都不走。
 *    ⚠️ 測試那張 20 組 table 證的是「付款狀態不受出貨軸影響」,**證不了**上面那個不變條件 —— 它沒有那個維度。
 *    ⚠️ 後台那半是**另一份字面**(`apps/admin/src/lib/orders/order-list-view.ts`,無 import 關係、
 *    改一邊不會動到另一邊)。Sean 這一板兩邊同字,而 `paid` 仍刻意兩邊不同字(後台「已付款」/ 客人「處理中」)。
 * 簽章保留雙參數(消費端 OrdersTab/OverviewTab 零改動;`fulfillmentStatus` 契約收縮 = A9s 片、
 * 依 DAG 在本片之後 —— 先砍型別會讓仍在讀的 TSX 編譯斷)。
 * 🔴 contract 債:第 2 批接回包裹真相(master plan §5.2)後,paid 顯示由包裹投影重建。
 *
 * 🔴 `partiallyRefunded`(M-3 RF2a)比照 `refunded`/`unpaid`/`partiallyPaid`:**付款軸壓過出貨軸**、
 * 不細分 fulfillment。誠實限制:部分退款後訂單仍有保留品項在跑出貨流程,單一「已退部分」字串
 * **看不出剩餘品項進度** —— 該顯示屬 RF6(後台退款 UI)範圍,本片不處理、也不假裝已處理。
 *
 * exhaustive:switch 覆蓋全 5 PaymentStatus + `never` 守門(新增 enum 值未處理 → 編譯期紅);
 * `partiallyPaid` 顯式回「已收訂金」、絕不 fall-through 成空字串(codex M1)。
 *
 * TODO(L2→L3 升級):狀態文案未來移後台 CMS;現 hardcode 為拍板定稿值。
 */
export function orderStatusLabel(
  payment: PaymentStatus,
  _fulfillment: FulfillmentStatus,
): string {
  switch (payment) {
    case 'refunded':
      return '已退款';
    case 'unpaid':
      return '待付款';
    case 'partiallyPaid':
      return '已收訂金';
    case 'partiallyRefunded':
      return '已退部分';
    case 'paid':
      return '處理中';
    default: {
      const _exhaustive: never = payment;
      return _exhaustive;
    }
  }
}

/**
 * formatOrderDate:ISO timestamptz → `YYYY-MM-DD`(對齊 design 訂單 meta 顯示)。
 *
 * 用 `en-CA` locale(其日期格式即 `YYYY-MM-DD`)+ `timeZone: 'Asia/Taipei'`:DB created_at 為 UTC
 * timestamptz,在台灣時區呈現,避免 UTC 邊界(如 16:00Z = 隔日 00:00 台灣)被截成前一天的 off-by-one。
 */
export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}
