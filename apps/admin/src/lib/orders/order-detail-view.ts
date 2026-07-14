// order-detail-view.ts — 後台訂單明細「顯示層」純工具(M-4a Slice B)。
// 明細專屬:id 形狀守門 / 發票·出貨標籤 / 日期時間格式化。列表共用標籤(付款/出貨/來源/管道)
// 仍在 order-list-view.ts、本檔不重定義。無 server-only、無 @/ → 可單測。

import type { InvoiceStatus } from '@pcm/domain';

/** UUID 形狀守門(路由 [id];非法直接 404、不打 DB)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(raw: string): boolean {
  return UUID_RE.test(raw);
}

/** 開票紀錄狀態標籤(orders.invoice_status 三值)。 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  not_issued: '未開立',
  issued: '已開立',
  voided: '已作廢',
};

/** 結帳開票需求型式標籤(invoice jsonb.type;未知值原樣顯示、不編造)。 */
export function invoiceTypeLabel(type: string | null): string | null {
  if (type === null) return null;
  if (type === 'personal') return '個人(二聯)';
  if (type === 'company') return '公司(三聯)';
  return type;
}

/** 出貨方式標籤(既有欄、結帳現值 'home';未知值原樣顯示,Slice C 起 admin 可改)。 */
export function shippingMethodLabel(method: string): string {
  return method === 'home' ? '宅配' : method;
}

/**
 * formatOrderDateTime:ISO timestamptz → `YYYY-MM-DD HH:mm`(Asia/Taipei;明細頁要看到時分,
 * 與列表 formatOrderDate〔只到日〕互補)。en-CA locale 天然 YYYY-MM-DD、24 小時制。
 */
export function formatOrderDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const time = date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} ${time}`;
}
