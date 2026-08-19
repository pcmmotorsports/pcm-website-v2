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

/**
 * 出貨方式標籤(既有欄;未知值**原樣顯示、不編造**,Slice C 起 admin 可改)。
 *
 * 🔴 **`'store'` → 「自取」是 Sean 2026-08-17 拍的**(`Q3`,逐字「甲＝自取」)。
 *    在此之前這裡只認得 `'home'`,而 `create_order` RPC 的白名單是 **`home` / `store` 兩個**
 *    (`20260630120000:144-145`)⇒ **合法寫進來的 `store` 會在後台原樣印出英文。**
 *
 * ⚠️ **不要把這個「自取」與出貨通知信裡的「自取」收成同一個常數**(Sean 同日 `Q1`/`Q2`:
 *    信裡的字面走**包裹的貨運商欄** + 既有的「自送」)。**兩處都叫自取是巧合般的一致,
 *    不是同一個資料來源** —— 合併成常數之後,改其中一邊會靜靜地改到另一邊。
 *
 * 🔴🔴 **`'store'` 這個字在本 repo 有【兩個完全不同的意思】,不要全域取代**:
 *    ① 這裡 = `orders.shipping_method` 的「自取」
 *    ② `MemberTier` 的 `'general' | 'store' | 'premiumStore'`(= 店家會員等級,經銷價那條線)
 *    數法:`git grep -n "'store'" -- apps packages | grep -v '\.test\.'` ⇒ 命中裡**多數是 ②**。
 *    ⇒ 對 `'store'` 下 sed 會把經銷價體系一起改掉,而型別不一定會紅。
 *
 * ⚠️ **未知值仍然原樣顯示,那是刻意的**。
 *    ~~而它現在有一個真實的來源:後台改單的「出貨方式」是自由文字輸入…本片不動它~~
 *    🔴 **2026-08-19 片15 已經把那個來源關掉**:改單那一欄換成 `<select>`,
 *    而**白名單擋在 `workflow-form.ts` 的 parser**(畫面只是 UX、一發 POST 就繞過去)。
 *    ⇒ 今天**寫不進**非白名單值。**但這裡的原樣顯示要留著** ——
 *      該欄**沒有表 CHECK**(`20260604120000…:105` 逐字「不加表 CHECK」)⇒ 歷史值與
 *      繞過應用層的寫入(直接 SQL / 未來的新路徑)仍可能塞進別的字串,
 *      **而那時我們寧可看到那個字串,也不要看到一個假的「宅配」。**
 *
 * ═══ 🔴🔴 白名單的**唯一**副本住在這裡(2026-08-19 片15 R2,W5 must-fix 2)═══
 *    收斂之前它有**三份可執行的副本**:本檔的兩個 `if`、`order-edit-form.tsx` 的兩個 `<option>`、
 *    `workflow-form.ts` 的 `raw !== 'home' && raw !== 'store'`。
 *    🔴 **而那正是這一欄一開始出事的形狀** —— 白名單寫在下單 RPC 裡,
 *       而**改單那條路不知道它的存在**。多一份副本 = 多一個不知道的人。
 *    📎 判別句:**能消除重複就不要去偵測不一致。**
 *    ⇒ 要加第三種送法,只改下面這一個物件;畫面與 parser 都跟著走,**不會有人漏改。**
 */
export const SHIPPING_METHOD_LABELS = {
  home: '宅配',
  store: '自取',
} as const;

/** 這個字串是不是白名單值(parser 的守門用這一支,不要各自寫 `!==`)。 */
export function isShippingMethod(v: string): boolean {
  // 🔴 用 `Object.hasOwn` 不用 `in` —— `'toString' in obj` 會是 true(原型鏈),
  //    而那會讓 `toString` / `constructor` 這種字串通過白名單。
  return Object.hasOwn(SHIPPING_METHOD_LABELS, v);
}

export function shippingMethodLabel(method: string): string {
  return isShippingMethod(method)
    ? SHIPPING_METHOD_LABELS[method as keyof typeof SHIPPING_METHOD_LABELS]
    : method;
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
