import { describe, expect, it } from 'vitest';
import { parseRefundForm } from './refund-form';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  generateRefundRequestToken,
  isRefundRequestToken,
} from './refund-action-state';

// refund-form.test.ts — RW2c 解析器。每條規則至少一紅一綠;
// 互斥矩陣(kind × amount)逐格,不取代表值。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
// 🔴 v4 小寫(鏡像 RPC regex;版本位=4、variant 位=a)
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';

function form(over: Record<string, string> = {}, omit: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [REFUND_ORDER_ID_FIELD]: ORDER_ID,
    [REFUND_REQUEST_TOKEN_FIELD]: TOKEN,
    [REFUND_KIND_FIELD]: 'partial',
    [REFUND_AMOUNT_FIELD]: '500',
    [REFUND_CONFIRM_FIELD]: '1234',
    [REFUND_REASON_FIELD]: '客人取消訂單,依約定退款',
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (!omit.includes(name)) data.set(name, value);
  }
  return data;
}

describe('parseRefundForm — 通過形', () => {
  it('partial:amount 為員工輸入的正整數', () => {
    const parsed = parseRefundForm(form());
    expect(parsed).toEqual({
      ok: true,
      orderId: ORDER_ID,
      kind: 'partial',
      amount: 500,
      confirmCode: '1234',
      reason: '客人取消訂單,依約定退款',
      requestToken: TOKEN,
    });
  });

  it('full:amount 欄可缺、可空字串;解析結果 amount 一律 null(凍結額在 RPC 取 Record)', () => {
    const missing = parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full' }, [REFUND_AMOUNT_FIELD]));
    expect(missing).toMatchObject({ ok: true, kind: 'full', amount: null });
    const empty = parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full', [REFUND_AMOUNT_FIELD]: '' }));
    expect(empty).toMatchObject({ ok: true, kind: 'full', amount: null });
  });

  it('reason 送 trim 後值(RPC btrim 語意,兩層看到同一個字串)', () => {
    const parsed = parseRefundForm(form({ [REFUND_REASON_FIELD]: '  重複下單  ' }));
    expect(parsed).toMatchObject({ ok: true, reason: '重複下單' });
  });
});

describe('parseRefundForm — kind × amount 互斥矩陣(逐格)', () => {
  it('🔴 full 帶了非空金額 = 擋(殘值放行會在 RPC 端 RAISE 成 bug 畫面)', () => {
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full', [REFUND_AMOUNT_FIELD]: '500' }))).toEqual({ ok: false });
  });
  it('partial 缺金額 / 空金額 = 擋', () => {
    expect(parseRefundForm(form({}, [REFUND_AMOUNT_FIELD]))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: '' }))).toEqual({ ok: false });
  });
  it('kind 缺 / 非法值 = 擋(不預設任何一種 —— 預設成 full 就是意外全額退)', () => {
    expect(parseRefundForm(form({}, [REFUND_KIND_FIELD]))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'FULL' }))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'all' }))).toEqual({ ok: false });
  });
});

describe('parseRefundForm — 金額形狀', () => {
  const bad = ['0', '-1', '1.5', '01', '1e3', ' 500', '500 ', 'NaN', '五百', '2147483648'];
  for (const value of bad) {
    it(`拒收:「${value}」`, () => {
      expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: value }))).toEqual({ ok: false });
    });
  }
  it('上限恰 2147483647(PG integer;RPC 端鏡像)', () => {
    expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: '2147483647' }))).toMatchObject({
      ok: true,
      amount: 2_147_483_647,
    });
  });
});

describe('parseRefundForm — token(嚴格 v4 小寫,鏡像 RPC regex)', () => {
  it('🔴 大寫 / 非 v4 / req_ 前綴 / 缺 = 全擋(寬收只會把形狀錯往後推成 P0001 bug 畫面)', () => {
    for (const token of [
      TOKEN.toUpperCase(),
      '9f8e7d6c-5b4a-1321-a987-654321fedcba', // 版本位=1
      '9f8e7d6c-5b4a-4321-c987-654321fedcba', // variant 位=c
      `req_${TOKEN}`,
      '',
    ]) {
      expect(parseRefundForm(form({ [REFUND_REQUEST_TOKEN_FIELD]: token }))).toEqual({ ok: false });
    }
    expect(parseRefundForm(form({}, [REFUND_REQUEST_TOKEN_FIELD]))).toEqual({ ok: false });
  });

  it('產生器產物必過驗證器(同源;`crypto.randomUUID` = v4 小寫)', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(isRefundRequestToken(generateRefundRequestToken())).toBe(true);
    }
  });
});

describe('parseRefundForm — 確認碼 / 訂單 id / reason', () => {
  it('確認碼必須恰 4 個英數', () => {
    for (const code of ['123', '12345', '12 4', '12#4', '']) {
      expect(parseRefundForm(form({ [REFUND_CONFIRM_FIELD]: code }))).toEqual({ ok: false });
    }
    expect(parseRefundForm(form({ [REFUND_CONFIRM_FIELD]: 'A9b3' }))).toMatchObject({ ok: true });
  });

  it('orderId 非 uuid = 擋', () => {
    expect(parseRefundForm(form({ [REFUND_ORDER_ID_FIELD]: '123456' }))).toEqual({ ok: false });
  });

  it('reason:空 / 全空白 / 含控制字元 = 擋', () => {
    for (const reason of ['', '   ', '換貨\u0000退款', 'a\tb', 'x\u007fy', '換貨\n退款']) {
      expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: reason }))).toEqual({ ok: false });
    }
  });

  it('🔴 reason 長度用碼位不用 UTF-16 units(emoji 讓兩者分岔;RPC char_length 是碼位)', () => {
    // 150 個 🏍(每個 2 UTF-16 units):碼位 150 ≤ 200 必須過;
    // 若實作誤用 `.length`(=300 > 200)這格轉紅 —— 有判別力的那格。
    const bikes = '🏍'.repeat(150);
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: bikes }))).toMatchObject({ ok: true });
    // 201 / 200 碼位坐邊界
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: '字'.repeat(201) }))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: '字'.repeat(200) }))).toMatchObject({ ok: true });
  });
});
