import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import {
  TRANSFER_MATCH_AMOUNT_PARAM,
  TRANSFER_MATCH_REF_PARAM,
  matchTransferOrders,
  parseTransferAmount,
  parseTransferRef,
  readPayPrefill,
  withTransferMatchParams,
} from './transfer-match';

// 匯款對帳小工具(2026-09-30 Sean 批研究 Q2 乙;研究 `~/pcm-mailbox/研究-後台訂單好用度-20260930.md` 第三節 C)。
// 🔴 本組釘三件事:①只列「收款欄可以點、而且還差金額剛好等於入帳金額」的單 ②點下去的網址帶著金額與末五碼
//    ③網址上的預填值讀不懂就不填(不猜)。工具不寫入 —— 寫入仍是員工在收款彈窗勾「我已核對」後送出。

function line(cancelled = 0): AdminOrderLine {
  return {
    id: 'l-1',
    variantSku: 'SKU-001',
    title: '排氣管',
    brand: 'Akrapovic',
    quantity: 1,
    unitPrice: { amount: toMoneyAmount(10000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(10000), currency: 'TWD' },
    workflowStatus: null,
    version: 1,
    vehicle: null,
    quantitySummary: {
      quantity: 1,
      orderedQuantity: 0,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: cancelled,
      cancellableQuantity: 1 - cancelled,
    },
  };
}

function order(over: Partial<AdminOrderSummary>): AdminOrderSummary {
  return {
    id: 'ord-1',
    itemsTruncated: false,
    displayId: 'PCM-0001',
    createdAt: '2026-09-30T02:00:00.000Z',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'bank_transfer',
    total: { amount: toMoneyAmount(10000), currency: 'TWD' },
    taxTotal: { amount: toMoneyAmount(0), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '台北市' },
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    invoiceRequested: true,
    balanceDue: 10000,
    cancelledAt: null,
    displayPosition: null,
    lines: [line()],
    ...over,
  };
}

describe('parseTransferAmount', () => {
  it('正整數才算;逗號與空白先拿掉', () => {
    expect(parseTransferAmount('12,300')).toBe(12300);
    expect(parseTransferAmount(' 7000 ')).toBe(7000);
    // Fable R1 N1:中文輸入法常打出全形數字與逗號。
    expect(parseTransferAmount('１２，３００')).toBe(12300);
  });
  it('空白、0、負數、小數、非數字、陣列 ⇒ null', () => {
    for (const raw of ['', '0', '-5', '12.5', 'abc', '1e3', undefined, ['100']]) {
      expect(parseTransferAmount(raw)).toBeNull();
    }
  });
});

describe('parseTransferRef', () => {
  it('去頭尾空白;空的或太長 ⇒ null', () => {
    expect(parseTransferRef(' 12345 ')).toBe('12345');
    expect(parseTransferRef('   ')).toBeNull();
    expect(parseTransferRef('x'.repeat(41))).toBeNull();
    expect(parseTransferRef(undefined)).toBeNull();
  });
});

describe('matchTransferOrders', () => {
  it('只列還差金額剛好相符的單(未付款與待尾款都算)', () => {
    const got = matchTransferOrders(
      [
        order({ id: 'a', balanceDue: 7000 }),
        order({ id: 'b', paymentStatus: 'partiallyPaid', balanceDue: 7000 }),
        order({ id: 'c', balanceDue: 7001 }),
      ],
      7000,
    );
    expect(got.map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('收款欄不能點的單不列:取消過、有品項取消、算不出來、已收足、多收', () => {
    const got = matchTransferOrders(
      [
        order({ id: 'cancelled', balanceDue: 7000, cancelledAt: '2026-09-29T00:00:00.000Z' }),
        order({ id: 'line-cancelled', balanceDue: 7000, lines: [line(1)] }),
        order({ id: 'unknown', balanceDue: null }),
        order({ id: 'settled', balanceDue: 0 }),
        order({ id: 'over', balanceDue: -7000 }),
      ],
      7000,
    );
    expect(got).toEqual([]);
  });
  it('同一張單出現兩次只列一次', () => {
    const a = order({ id: 'a', balanceDue: 7000 });
    expect(matchTransferOrders([a, a], 7000)).toHaveLength(1);
  });
});

describe('withTransferMatchParams / readPayPrefill', () => {
  it('收款網址帶著金額與末五碼, 收款彈窗讀得回來', () => {
    const href = withTransferMatchParams('/orders?todo=unpaid-transfer&pay=ord-1', 7000, '12345');
    const params = new URL(href, 'http://x').searchParams;
    expect(params.get(TRANSFER_MATCH_AMOUNT_PARAM)).toBe('7000');
    expect(params.get(TRANSFER_MATCH_REF_PARAM)).toBe('12345');
    expect(readPayPrefill(Object.fromEntries(params))).toEqual({ amount: '7000', bankReference: '12345' });
  });
  it('沒有末五碼 ⇒ 只帶金額', () => {
    const href = withTransferMatchParams('/orders?pay=ord-1', 7000, null);
    expect(new URL(href, 'http://x').searchParams.has(TRANSFER_MATCH_REF_PARAM)).toBe(false);
  });
  it('讀不懂的值不填(不猜)', () => {
    expect(readPayPrefill({ [TRANSFER_MATCH_AMOUNT_PARAM]: 'abc', [TRANSFER_MATCH_REF_PARAM]: '  ' })).toEqual({
      amount: '',
      bankReference: '',
    });
    expect(readPayPrefill({})).toBeNull();
  });
});
