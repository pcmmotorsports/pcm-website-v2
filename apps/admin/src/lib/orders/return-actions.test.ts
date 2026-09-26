import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  registerReturn: vi.fn(),
  receiveReturn: vi.fn(),
  voidReturn: vi.fn(),
  revalidateOrderViews: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('./order-revalidate', () => ({ revalidateOrderViews: mocks.revalidateOrderViews }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('./return-repository', () => ({
  registerReturn: mocks.registerReturn,
  receiveReturn: mocks.receiveReturn,
  voidReturn: mocks.voidReturn,
}));

import { receiveReturnAction, registerReturnAction, voidReturnAction } from './return-actions';
import {
  RETURN_ID_FIELD,
  RETURN_ORDER_ID_FIELD,
  RETURN_REASON_CODE_FIELD,
  RETURN_REASON_DETAIL_FIELD,
  RETURN_REQUEST_TOKEN_FIELD,
  RETURN_VOID_REASON_FIELD,
  returnConditionField,
  returnQtyField,
  type ReturnActionState,
} from './return-action-state';

const ORDER = '11111111-2222-3333-4444-555555555555';
const RET = '22222222-3333-4444-5555-666666666666';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';
const I1 = '33333333-4444-5555-6666-777777777777';
const I2 = '44444444-5555-6666-7777-888888888888';
const IDLE: ReturnActionState = { status: 'idle', requestToken: TOKEN };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid', actorId: 'staff_01' });
  mocks.getRequestId.mockResolvedValue('req-1');
});

describe('registerReturnAction', () => {
  const base = { [RETURN_ORDER_ID_FIELD]: ORDER, [RETURN_REQUEST_TOKEN_FIELD]: TOKEN, [RETURN_REASON_CODE_FIELD]: 'defective' };

  it('沒有登入 ⇒ denied, 不呼叫資料庫', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const out = await registerReturnAction(IDLE, form({ ...base, [returnQtyField(I1)]: '1' }));
    expect(out).toMatchObject({ status: 'failed', code: 'denied' });
    expect(mocks.registerReturn).not.toHaveBeenCalled();
  });

  it('只送數量大於 0 的品項, 帶操作人員與送出編號, 成功後轉回訂單頁並帶結果碼', async () => {
    mocks.registerReturn.mockResolvedValue({ ok: true, returnId: RET, idempotent: false });
    await expect(
      registerReturnAction(IDLE, form({ ...base, [returnQtyField(I1)]: '2', [returnQtyField(I2)]: '0' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.registerReturn).toHaveBeenCalledWith({
      orderId: ORDER, requestId: TOKEN, actor: 'staff_01', reasonCode: 'defective', reasonDetail: null,
      note: null, trackingNumber: null, items: [{ orderItemId: I1, quantity: 2 }],
    });
    expect(mocks.redirect.mock.calls[0]![0]).toContain('r=return_registered');
  });

  it('每個品項都是 0 ⇒ invalid, 不呼叫資料庫', async () => {
    const out = await registerReturnAction(IDLE, form({ ...base, [returnQtyField(I1)]: '0' }));
    expect(out).toMatchObject({ status: 'failed', code: 'invalid' });
    expect(mocks.registerReturn).not.toHaveBeenCalled();
  });

  it('原因「其他」沒填說明 ⇒ invalid', async () => {
    const out = await registerReturnAction(
      IDLE,
      form({ ...base, [RETURN_REASON_CODE_FIELD]: 'other', [RETURN_REASON_DETAIL_FIELD]: '  ', [returnQtyField(I1)]: '1' }),
    );
    expect(out).toMatchObject({ status: 'failed', code: 'invalid' });
  });

  it('資料庫擋下 ⇒ 顯示資料庫那句話, 沿用同一個送出編號', async () => {
    mocks.registerReturn.mockResolvedValue({
      ok: false, code: 'rejected', sqlstate: 'P0001', logMessage: 'x', staffMessage: '登記退貨:有品項的退貨數量超過可退數量。',
    });
    const out = await registerReturnAction(IDLE, form({ ...base, [returnQtyField(I1)]: '9' }));
    expect(out).toEqual({ status: 'failed', code: 'rejected', message: '登記退貨:有品項的退貨數量超過可退數量。', requestToken: TOKEN });
  });
});

describe('receiveReturnAction', () => {
  const base = { [RETURN_ORDER_ID_FIELD]: ORDER, [RETURN_ID_FIELD]: RET, [RETURN_REQUEST_TOKEN_FIELD]: TOKEN };

  it('有收到的品項沒選狀況 ⇒ invalid', async () => {
    const out = await receiveReturnAction(IDLE, form({ ...base, [returnQtyField(I1)]: '1' }));
    expect(out).toMatchObject({ status: 'failed', code: 'invalid' });
    expect(mocks.receiveReturn).not.toHaveBeenCalled();
  });

  it('實收 0 件的品項也要送(狀況給 null), 成功轉回訂單頁', async () => {
    mocks.receiveReturn.mockResolvedValue({ ok: true, returnId: RET, idempotent: false });
    await expect(
      receiveReturnAction(
        IDLE,
        form({ ...base, [returnQtyField(I1)]: '1', [returnConditionField(I1)]: 'damaged', [returnQtyField(I2)]: '0' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.receiveReturn).toHaveBeenCalledWith({
      returnId: RET, requestId: TOKEN, actor: 'staff_01', note: null,
      items: [
        { orderItemId: I1, receivedQuantity: 1, condition: 'damaged' },
        { orderItemId: I2, receivedQuantity: 0, condition: null },
      ],
    });
    expect(mocks.redirect.mock.calls[0]![0]).toContain('r=return_received');
  });
});

describe('voidReturnAction', () => {
  const base = { [RETURN_ORDER_ID_FIELD]: ORDER, [RETURN_ID_FIELD]: RET, [RETURN_REQUEST_TOKEN_FIELD]: TOKEN };

  it('沒填作廢原因 ⇒ invalid', async () => {
    const out = await voidReturnAction(IDLE, form({ ...base, [RETURN_VOID_REASON_FIELD]: ' ' }));
    expect(out).toMatchObject({ status: 'failed', code: 'invalid' });
  });

  it('成功轉回訂單頁並帶結果碼', async () => {
    mocks.voidReturn.mockResolvedValue({ ok: true, returnId: RET, idempotent: false });
    await expect(voidReturnAction(IDLE, form({ ...base, [RETURN_VOID_REASON_FIELD]: '客人沒寄回' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.voidReturn).toHaveBeenCalledWith({ returnId: RET, requestId: TOKEN, actor: 'staff_01', voidReason: '客人沒寄回' });
    expect(mocks.redirect.mock.calls[0]![0]).toContain('r=return_voided');
  });
});
