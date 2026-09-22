// item-swap-state.ts — 後台「換商品」的結果代碼與提示文字(plan `docs/plans/2026-09-22-admin-order-item-swap-plan.md`)。
//
// 資料庫函式 `admin_swap_order_item` 拒絕時回【代碼】不回中文;這裡把代碼換成固定的提示文字(白名單)。
// 不把 DB 的字放進網址:放進網址等於讓任何人改網址就能在後台畫面上顯示任意文字。

/** 資料庫函式回的拒絕代碼 —— 與 migration 20260922100000 檔頭那張清單逐字一致。 */
export const ITEM_SWAP_REJECT_REASONS = [
  'request_reused',
  'item_not_found',
  'order_cancelled',
  'item_processed',
  'item_in_shipment',
  'item_cancelled',
  'item_amount_requested',
  'order_refunded',
  'source_variant_missing',
  'target_not_found',
  'target_delisted',
  'price_missing',
  'price_mismatch',
  'item_has_relations',
  'catalog_busy',
] as const;
export type ItemSwapRejectReason = (typeof ITEM_SWAP_REJECT_REASONS)[number];

export function isItemSwapRejectReason(v: unknown): v is ItemSwapRejectReason {
  return typeof v === 'string' && (ITEM_SWAP_REJECT_REASONS as readonly string[]).includes(v);
}

/** 導頁結果碼(`?r=`)。拒絕原因各有一碼, 前綴 `item_swap_`。 */
export type ItemSwapResultCode =
  | 'item_swapped'
  | 'item_swap_noop'
  | 'item_swap_conflict'
  | 'item_swap_denied'
  | 'item_swap_invalid'
  | 'item_swap_error'
  | `item_swap_${ItemSwapRejectReason}`;

export function itemSwapRejectResultCode(reason: ItemSwapRejectReason): ItemSwapResultCode {
  return `item_swap_${reason}`;
}

type Message = { text: string; tone: 'ok' | 'warn' | 'error' };

/** 「請取消這個品項後重新建立」是換不了時唯一的替代做法(Sean 選甲:已處理的品項照舊取消重建)。 */
const CANCEL_AND_RECREATE = '請取消這個品項後重新建立。';

export const ITEM_SWAP_MESSAGES: Readonly<Record<ItemSwapResultCode, Message>> = Object.freeze({
  item_swapped: { text: '商品已更換。訂單金額沒有變動，更換紀錄已登記在操作紀錄。', tone: 'ok' },
  item_swap_noop: { text: '選擇的商品和原本相同，沒有變更。', tone: 'ok' },
  item_swap_conflict: {
    text: '這張訂單剛被其他人修改，商品沒有更換。畫面已更新為最新資料，請核對後再換一次。',
    tone: 'warn',
  },
  item_swap_denied: { text: '登入已過期或沒有權限，商品沒有更換。請重新登入後再試。', tone: 'error' },
  item_swap_invalid: { text: '表單內容不完整，商品沒有更換。請重新整理頁面後再試。', tone: 'warn' },
  item_swap_error: {
    text: '系統異常，尚未確認商品是否已更換。請重新整理頁面，查看品項是否已經是新商品，再決定是否重新操作。若持續異常，請聯絡系統管理員。',
    tone: 'error',
  },
  item_swap_request_reused: { text: '這次操作的編號已經用過，商品沒有更換。請重新整理頁面後再換一次。', tone: 'warn' },
  item_swap_item_not_found: {
    text: '這張訂單裡找不到這個品項，可能已經被更換或取消。請重新整理頁面確認。',
    tone: 'warn',
  },
  item_swap_order_cancelled: { text: '這張訂單已經取消，不能換商品。', tone: 'warn' },
  item_swap_item_processed: {
    text: `這個品項已經向廠商訂貨、到貨或出貨，不能直接換。${CANCEL_AND_RECREATE}`,
    tone: 'warn',
  },
  item_swap_item_in_shipment: { text: `這個品項已經排進出貨，不能直接換。${CANCEL_AND_RECREATE}`, tone: 'warn' },
  item_swap_item_cancelled: { text: `這個品項有取消紀錄，不能直接換。${CANCEL_AND_RECREATE}`, tone: 'warn' },
  item_swap_item_amount_requested: {
    text: `這個品項申請過修改單價，不能直接換。${CANCEL_AND_RECREATE}`,
    tone: 'warn',
  },
  item_swap_order_refunded: { text: `這張訂單有退款紀錄，不能直接換商品。${CANCEL_AND_RECREATE}`, tone: 'warn' },
  item_swap_source_variant_missing: {
    text: `原本的商品已從商品資料中刪除，無法確認價格，不能直接換。${CANCEL_AND_RECREATE}`,
    tone: 'warn',
  },
  item_swap_target_not_found: { text: '找不到要換成的商品，商品沒有更換。請重新搜尋料號。', tone: 'warn' },
  item_swap_target_delisted: { text: '要換成的商品已經下架，商品沒有更換。請選擇其他商品。', tone: 'warn' },
  item_swap_price_missing: {
    text: '其中一個商品目前沒有價格，無法確認是否同價，商品沒有更換。請先確認商品價格。',
    tone: 'warn',
  },
  item_swap_price_mismatch: {
    text: `兩個商品的目錄價不同，商品沒有更換。${CANCEL_AND_RECREATE}`,
    tone: 'warn',
  },
  item_swap_item_has_relations: {
    text: `這個品項還有其他相關紀錄，不能直接換。${CANCEL_AND_RECREATE}`,
    tone: 'warn',
  },
  item_swap_catalog_busy: { text: '商品資料正在更新，商品沒有更換。請稍等一分鐘後再換一次。', tone: 'warn' },
});
