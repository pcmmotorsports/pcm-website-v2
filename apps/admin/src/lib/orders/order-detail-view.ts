// order-detail-view.ts — 後台訂單明細「顯示層」純工具(M-4a Slice B)。
// 明細專屬:id 形狀守門 / 開票**需求型式**·出貨標籤 / 日期時間格式化。列表共用標籤
// (付款/出貨/來源/管道,**A11a-5 起加開票紀錄狀態 `INVOICE_STATUS_LABEL`**)在 order-list-view.ts、
// 本檔不重定義。無 server-only、無 @/ → 可單測。

import type { InvoiceStatus } from '@pcm/domain';

/** UUID 形狀守門(路由 [id];非法直接 404、不打 DB)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(raw: string): boolean {
  return UUID_RE.test(raw);
}

/** 開票紀錄狀態標籤(orders.invoice_status 三值)。 */
// 🔴 `INVOICE_STATUS_LABEL` **已於 A11a-5(2026-08-06)搬到 `order-list-view.ts`** ——
// 它自 A11a-5 起是明細與列表**共用**的標籤,而本檔檔頭宣告的慣例逐字是「列表共用標籤仍在
// order-list-view.ts、本檔不重定義」⇒ 照那條慣例搬,不是改掉慣例來遷就 import 方向。

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

/**
 * 客人明細入口的網址(OD 片 3 用;需求檔 §0-J J-4「按 1 下,用 iframe 嵌既有那份」)。
 *
 * 🔴 **為什麼這個函式要存在 —— 機制優先律**(R2 important①,2026-08-13):
 *    上一版我把 `customerUserId` 宣告成 `string | null`,並在 docstring 寫「型別會逼消費端處理」。
 *    **那句實測不成立**:TS 的樣板字串**接受 `null`**,而本 repo 的 `eslint.config.js` 沒開
 *    `@typescript-eslint/restrict-template-expressions`(未開任何 type-checked rule set)
 *    ⇒ `` `/customers/${detail.customerUserId}` `` **typecheck 綠、lint 綠**,產出 `/customers/null`。
 *    也就是說 codex 擔心的 `/customers/undefined` 只是被**改名**成 `/customers/null`,壞法一模一樣,
 *    而 fail-closed 只活在註解裡 —— 那不算防護,那叫叮嚀。
 *
 * ⇒ 拼網址這件事收斂到**這一個地方**:拼不出來就回 `null`,呼叫端拿到 `null` 只能選擇不渲染入口,
 *    **語法上就沒有把壞路徑拼出來的機會**(消費端不再碰裸 id)。
 *
 * ⚠️ 放在 admin 的 view 層、**不放 `packages/domain`** —— 這是我對 reviewer 建議的一處偏離,
 *    理由:`/customers/[id]` 是 **admin 的路由**,而 `packages/domain` 同時被 storefront 用,
 *    storefront 沒有這個頁面。把 admin 路由寫進共用 domain 型別會讓兩邊耦合到一條只有一邊存在的路徑。
 *    機制強度不變(仍是單一決定點),變的只是它住哪一層。
 */
export function customerDetailHref(customerUserId: string | null): string | null {
  return customerUserId === null || customerUserId === '' ? null : `/customers/${customerUserId}`;
}
