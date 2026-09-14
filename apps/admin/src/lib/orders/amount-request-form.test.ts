import { describe, expect, it } from 'vitest';
import { AMOUNT_REQUEST_ID_FIELD, AMOUNT_REQUEST_REASON_FIELD, parseAmountRequestForm } from './amount-request-form';

// M-4b-03 B:申請表單解析 = parseAmountForm 六格 + 原因 + 冪等 id。底層那六格的邊界由 amount-form.test.ts 守, 這裡只守多出來的兩格。
const U = '11111111-2222-4333-8444-555555555555';
const R = '22222222-2222-4333-8444-555555555555';
function form(entries: Array<[string, string]>) {
  const m = new Map<string, string[]>();
  for (const [k, v] of entries) m.set(k, [...(m.get(k) ?? []), v]);
  return { getAll: (k: string) => m.get(k) ?? [] } as unknown as Parameters<typeof parseAmountRequestForm>[0];
}
const base = (over: Array<[string, string]> = []) =>
  form([['order_id', U], ['order_item_id', U], ['version', '3'], ['unit_price', '5000'], ['return_to', `/orders?open=${U}`], [AMOUNT_REQUEST_REASON_FIELD, ' 老客 '], [AMOUNT_REQUEST_ID_FIELD, R], ...over]);

describe('parseAmountRequestForm', () => {
  it('基準表單過:原因去頭尾空白、id 轉小寫', () => {
    const r = parseAmountRequestForm(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reason).toBe('老客');
      expect(r.requestId).toBe(R);
      expect(r.patch.unitPrice).toBe(5000);
    }
  });
  it('🔴 原因空 / 超過 500 字 / 缺 ⇒ invalid(帶 orderId 導回明細頁)', () => {
    expect(parseAmountRequestForm(base([[AMOUNT_REQUEST_REASON_FIELD, '   ']]))).toMatchObject({ ok: false, orderId: U });
    expect(parseAmountRequestForm(base([[AMOUNT_REQUEST_REASON_FIELD, 'x'.repeat(501)]]))).toMatchObject({ ok: false });
    const noReason = form([['order_id', U], ['order_item_id', U], ['version', '3'], ['unit_price', '5000'], ['return_to', '/orders'], [AMOUNT_REQUEST_ID_FIELD, R]]);
    expect(parseAmountRequestForm(noReason)).toMatchObject({ ok: false, orderId: U });
  });
  it('🔴 冪等 id 不是 UUID / 缺 ⇒ invalid', () => {
    expect(parseAmountRequestForm(base([[AMOUNT_REQUEST_ID_FIELD, 'nope']]))).toMatchObject({ ok: false });
  });
  it('底層那六格的規則照舊:0 元沒理由 ⇒ invalid', () => {
    expect(parseAmountRequestForm(base([['unit_price', '0']]))).toMatchObject({ ok: false });
  });
});
