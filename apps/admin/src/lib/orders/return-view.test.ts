import { describe, expect, it } from 'vitest';
import { returnableByItem, RETURN_STATUS_LABEL, type OrderReturnRow } from './return-view';

const ret = (over: Partial<OrderReturnRow> & Pick<OrderReturnRow, 'status' | 'items'>): OrderReturnRow => ({
  id: 'r1',
  reasonCode: 'defective',
  reasonDetail: null,
  note: null,
  trackingNumber: null,
  registeredBy: 'staff',
  registeredAt: '2026-09-27T01:00:00Z',
  receivedBy: null,
  receivedAt: null,
  receiveNote: null,
  voidedBy: null,
  voidedAt: null,
  voidReason: null,
  ...over,
});

describe('returnableByItem:每個品項還能退幾件', () => {
  it('已出貨減掉沒作廢的退貨:退貨中算登記數量、已收回算實收數量、已作廢不算', () => {
    const out = returnableByItem(
      [{ id: 'i1', shippedQuantity: 5 }],
      [
        ret({ status: 'registered', items: [{ orderItemId: 'i1', quantity: 2, receivedQuantity: null, condition: null }] }),
        ret({ status: 'received', items: [{ orderItemId: 'i1', quantity: 2, receivedQuantity: 1, condition: 'good' }] }),
        ret({ status: 'voided', items: [{ orderItemId: 'i1', quantity: 3, receivedQuantity: null, condition: null }] }),
      ],
    );
    expect(out.get('i1')).toEqual({ shipped: 5, taken: 3, returnable: 2 });
  });

  it('審查 C1:包裹作廢後已出貨變少 ⇒ 可退數量會是負的, 原樣回傳讓畫面標出來', () => {
    const out = returnableByItem(
      [{ id: 'i1', shippedQuantity: 0 }],
      [ret({ status: 'registered', items: [{ orderItemId: 'i1', quantity: 1, receivedQuantity: null, condition: null }] })],
    );
    expect(out.get('i1')?.returnable).toBe(-1);
  });

  it('沒有退貨紀錄的品項:可退 = 已出貨', () => {
    expect(returnableByItem([{ id: 'i2', shippedQuantity: 3 }], []).get('i2')).toEqual({ shipped: 3, taken: 0, returnable: 3 });
  });
});

describe('狀態名稱', () => {
  it('三個狀態都有中文, 退貨中要說明在等商品寄回', () => {
    expect(RETURN_STATUS_LABEL).toEqual({ registered: '退貨中（等商品寄回）', received: '已收回', voided: '已作廢' });
  });
});
