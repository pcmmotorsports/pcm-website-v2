// customer-detail-view.ts — 後台客戶明細「顯示層」純工具(M-4a 客戶明細-a)。
// 明細專屬:id 形狀守門 / 儲值金類型標籤 / 金額格式化。列表共用(tier 標籤/日期)仍在
// customer-list-view.ts、本檔不重定義。無 server-only、無 @/ → 可單測。

import type { WalletEntryType } from '@pcm/domain';

/** UUID 形狀守門(路由 [id];非法直接 404、不打 DB;鏡像 order-detail-view isOrderId)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCustomerId(raw: string): boolean {
  return UUID_RE.test(raw);
}

/**
 * 儲值金交易類型標籤(wallet_entry_type 三值;對齊 domain WalletEntryType JSDoc 語意字面,
 * 非自創業務詞:deposit 儲值 / use 消費折抵 / refund 退款返還)。
 */
export const WALLET_ENTRY_LABEL: Record<WalletEntryType, string> = {
  deposit: '儲值',
  use: '消費折抵',
  refund: '退款返還',
};

/**
 * 儲值金流水金額字面(signed integer;+ 顯「+NT$ 1,000」/ − 顯「−NT$ 1,000」)。
 * 千分位對齊 formatOrderAmount(en-US);U+2212 MINUS SIGN 與正號等寬、表格對齊不跳動。
 * 🔴 金額恆整數(DB integer + CHECK 守);本函式純顯示、不運算。
 */
export function formatWalletEntryAmount(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US');
  return amount < 0 ? `−NT$ ${abs}` : `+NT$ ${abs}`;
}

/** 儲值金餘額/累積字面(無正負號;負餘額〔理論上不應發生〕仍誠實顯示 −)。 */
export function formatWalletBalance(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US');
  return amount < 0 ? `−NT$ ${abs}` : `NT$ ${abs}`;
}
