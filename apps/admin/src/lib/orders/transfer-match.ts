import type { AdminOrderSummary } from '@pcm/domain';
import { orderPayActionable, orderPayAmbiguous } from './order-list-view';

// transfer-match.ts — 匯款對帳小工具(2026-09-30 Sean 批研究 Q2 乙;研究 `~/pcm-mailbox/研究-後台訂單好用度-20260930.md` 第三節 C)。
// 員工輸入銀行入帳金額(和末五碼)⇒ 列出「還差金額剛好相符」的單 ⇒ 點「新增收款」開列表既有的收款彈窗, 金額與末五碼已填好。
// 🛑 本工具零寫入:收款仍由員工在彈窗勾「我已核對」後送出, 走明細頁同一支 action。

/** 待辦清單上那張小表單送出的兩個鍵;收款彈窗(`?pay=`)也讀同樣兩個鍵來預填。 */
export const TRANSFER_MATCH_AMOUNT_PARAM = 'match_amt';
export const TRANSFER_MATCH_REF_PARAM = 'match_ref';

/** 末五碼那格實際上是「銀行單號 / 末五碼」;超過這個長度不像是單號, 當沒填。 */
const REF_MAX = 40;

/** 入帳金額:正整數(整數元);逗號與空白先拿掉。讀不懂 ⇒ `null`。 */
export function parseTransferAmount(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  // 全形數字先轉半形(中文輸入法常打出「７０００」);半形與全形逗號、空白拿掉。
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseTransferRef(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s === '' || s.length > REF_MAX ? null : s;
}

/**
 * 還差金額剛好等於入帳金額的單。
 * 🔴 判準與收款欄「可不可以點」同一支(`orderPayActionable`):取消過 / 算不出來 / 已收足 / 多收的單,
 *    列表上沒有收款入口, 這裡也不列 —— 不然工具會把員工帶進一個列表刻意不給入口的單。
 */
export function matchTransferOrders(orders: readonly AdminOrderSummary[], amount: number): AdminOrderSummary[] {
  const seen = new Set<string>();
  return orders.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return orderPayActionable(o.balanceDue, orderPayAmbiguous(o)) && o.balanceDue === amount;
  });
}

/** 網址再帶上金額與末五碼:「新增收款」連結(預填)與收款彈窗的關閉連結(關掉後對帳結果還在)都用它。 */
export function withTransferMatchParams(href: string, amount: number, ref: string | null): string {
  const url = new URL(href, 'http://localhost');
  url.searchParams.set(TRANSFER_MATCH_AMOUNT_PARAM, String(amount));
  if (ref !== null) url.searchParams.set(TRANSFER_MATCH_REF_PARAM, ref);
  return `${url.pathname}${url.search}`;
}

/** 收款表單的預填值;網址沒帶這兩個鍵 ⇒ `null`(表單照舊是空的)。讀不懂的那一格留空, 不猜。 */
export function readPayPrefill(
  raw: Record<string, string | string[] | undefined>,
): { amount: string; bankReference: string } | null {
  const a = raw[TRANSFER_MATCH_AMOUNT_PARAM];
  const r = raw[TRANSFER_MATCH_REF_PARAM];
  if (a === undefined && r === undefined) return null;
  const amount = parseTransferAmount(a);
  return { amount: amount === null ? '' : String(amount), bankReference: parseTransferRef(r) ?? '' };
}
