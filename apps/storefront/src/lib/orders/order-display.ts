// order-display.ts — 會員訂單列表「顯示層」工具(M-3 OrdersTab / OverviewTab 共用)
//
// L1/L2 文案 + 純顯示格式化,放 app(UI)層;domain OrderListItem 攜原始資料(ISO 日期 + 雙軸 enum),
// 由此處轉成畫面字串。狀態文案為 Sean 2026-06-20 拍板定稿(Q2=A),非待決。

import type { PaymentStatus, FulfillmentStatus } from '@pcm/domain';

/**
 * 已付款(paid)時的出貨階段 → 中文(Q2=A 逐字)。
 * 抽成 Record 確保 4 個 FulfillmentStatus 全覆蓋(漏 key → 編譯期紅)。
 */
const PAID_FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  notOrdered: '已付款 訂單處理中',
  ordered: '訂單處理中',
  inStock: '備貨完成‧待出貨',
  shipped: '商品寄出',
};

/**
 * orderStatusLabel:付款 × 出貨雙軸 → 單一中文狀態字串(Sean 2026-06-20 拍板 Q2=A;2026-06-21 微調:
 * paid+notOrdered「處理中」→「已付款 訂單處理中」消歧義〔避免誤讀成「付款處理中」〕、ordered→「訂單處理中」、
 * shipped→「商品寄出」)。
 *
 * | payment | fulfillment | 顯示 |
 * |---|---|---|
 * | refunded | (任意) | 已退款 |
 * | unpaid | (任意) | 待付款 |
 * | partiallyPaid | (任意) | 付款確認中 |
 * | paid | notOrdered | 已付款 訂單處理中 |
 * | paid | ordered | 訂單處理中 |
 * | paid | inStock | 備貨完成‧待出貨 |
 * | paid | shipped | 商品寄出 |
 *
 * exhaustive:switch 覆蓋全 4 PaymentStatus + `never` 守門(新增 enum 值未處理 → 編譯期紅);
 * `partiallyPaid` 顯式回「付款確認中」、絕不 fall-through 成空字串(codex M1)。
 * 終態用「商品寄出」;design mock 的「已完成」無後台對應狀態(fulfillment 終態僅 shipped)→ 不產「已完成」。
 *
 * TODO(L2→L3 升級):狀態文案未來移後台 CMS;現 hardcode 為拍板定稿值。
 */
export function orderStatusLabel(
  payment: PaymentStatus,
  fulfillment: FulfillmentStatus,
): string {
  switch (payment) {
    case 'refunded':
      return '已退款';
    case 'unpaid':
      return '待付款';
    case 'partiallyPaid':
      return '付款確認中';
    case 'paid':
      return PAID_FULFILLMENT_LABEL[fulfillment];
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
