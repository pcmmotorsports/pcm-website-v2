import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { receiveReturn, registerReturn, voidReturn } from './return-repository';

const ORDER = '11111111-2222-3333-4444-555555555555';
const RET = '22222222-3333-4444-5555-666666666666';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';
const ITEM = '33333333-4444-5555-6666-777777777777';

const raise = (code: string, message = '訊息') => ({ data: null, error: { code, message } });

beforeEach(() => mocks.rpc.mockReset());

describe('registerReturn', () => {
  it('照資料庫函式的參數名稱送出, 成功回 returnId', async () => {
    mocks.rpc.mockResolvedValue({ data: { return_id: RET, idempotent: false }, error: null });
    const out = await registerReturn({
      orderId: ORDER, requestId: TOKEN, actor: 'staff_01', reasonCode: 'other', reasonDetail: '客人說尺寸不合',
      note: null, trackingNumber: '1234', items: [{ orderItemId: ITEM, quantity: 2 }],
    });
    expect(out).toEqual({ ok: true, returnId: RET, idempotent: false });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_register_return', {
      p_order_id: ORDER, p_idempotency_key: TOKEN, p_actor: 'staff_01', p_reason_code: 'other',
      p_reason_detail: '客人說尺寸不合', p_note: null, p_tracking_number: '1234',
      p_items: [{ order_item_id: ITEM, quantity: 2 }],
    });
  });

  it('P0001 = 資料庫函式的業務訊息 ⇒ rejected, 原句給員工看', async () => {
    mocks.rpc.mockResolvedValue(raise('P0001', '登記退貨:有品項的退貨數量超過可退數量(已出貨 2 件、已登記退貨 2 件, 這次要退 1 件)。'));
    const out = await registerReturn({
      orderId: ORDER, requestId: TOKEN, actor: 's', reasonCode: 'defective', reasonDetail: null,
      note: null, trackingNumber: null, items: [{ orderItemId: ITEM, quantity: 1 }],
    });
    expect(out).toMatchObject({ ok: false, code: 'rejected', staffMessage: expect.stringContaining('超過可退數量') });
  });

  it('權限被撤(42501)⇒ bug, 不把原始訊息給員工', async () => {
    mocks.rpc.mockResolvedValue(raise('42501', 'permission denied for function admin_register_return'));
    const out = await registerReturn({
      orderId: ORDER, requestId: TOKEN, actor: 's', reasonCode: 'defective', reasonDetail: null,
      note: null, trackingNumber: null, items: [{ orderItemId: ITEM, quantity: 1 }],
    });
    expect(out).toMatchObject({ ok: false, code: 'bug', staffMessage: null });
  });

  it('回傳形狀不對 ⇒ bug(不假裝成功)', async () => {
    mocks.rpc.mockResolvedValue({ data: { return_id: 'not-a-uuid', idempotent: false }, error: null });
    const out = await registerReturn({
      orderId: ORDER, requestId: TOKEN, actor: 's', reasonCode: 'defective', reasonDetail: null,
      note: null, trackingNumber: null, items: [{ orderItemId: ITEM, quantity: 1 }],
    });
    expect(out).toMatchObject({ ok: false, code: 'bug' });
  });
});

describe('receiveReturn / voidReturn', () => {
  it('確認收到:實收 0 件的品項 condition 送 null', async () => {
    mocks.rpc.mockResolvedValue({ data: { return_id: RET, idempotent: false }, error: null });
    await receiveReturn({
      returnId: RET, requestId: TOKEN, actor: 's', note: null,
      items: [{ orderItemId: ITEM, receivedQuantity: 0, condition: null }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_receive_return', {
      p_return_id: RET, p_request_id: TOKEN, p_actor: 's', p_note: null,
      p_items: [{ order_item_id: ITEM, received_quantity: 0, condition: null }],
    });
  });

  it('作廢:照參數名稱送出', async () => {
    mocks.rpc.mockResolvedValue({ data: { return_id: RET, idempotent: true }, error: null });
    const out = await voidReturn({ returnId: RET, requestId: TOKEN, actor: 's', voidReason: '客人沒寄回' });
    expect(out).toEqual({ ok: true, returnId: RET, idempotent: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_void_return', {
      p_return_id: RET, p_request_id: TOKEN, p_actor: 's', p_void_reason: '客人沒寄回',
    });
  });
});
