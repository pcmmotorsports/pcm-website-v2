import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { listOrderPayments, PaymentListShapeError } from './payment-repository';

// payment-repository.test.ts — #15-B2-a。
//
// 🔴 本檔守的是**三態不可混為一談**與**形狀 fail-closed**。
//    這兩件事一旦壞掉,症狀都是「畫面說沒有收款」,而員工會照著再登一次 ⇒ 重複入帳。
//    ⚠️ 誠實邊界:mock 證不了 RPC 真的回什麼 —— 它只證「回這個形狀時我們怎麼處理」。
//    090000 **已 apply**,但本檔對它**零真實往返**;真契約要等 B2-b 接上畫面、真的讀一次才驗得到。

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  createSupabaseServiceClient.mockReturnValue({ rpc });
  return rpc;
}

const ROW = {
  id: 'p1',
  rail: 'cash',
  amount: 100,
  received_at: '2026-08-01T02:00:00+00:00',
  created_at: '2026-08-01T02:00:00+00:00',
  actor: 'staff:sean',
  bank_reference: null,
  rec_trade_id: null,
  payer_note: null,
  reverses_payment_id: null,
  reversal_reason: null,
  is_reversal: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 🔴 每一支 mock 都要進這個清單:漏一支 ⇒ 呼叫次數跨測試累加,
  //    症狀長得像被測程式多跑一次,而你會去修一個不存在的 bug(四代教訓)。
  createSupabaseServiceClient.mockReset();
});

describe('三態必須分得開', () => {
  it('SQL NULL ⇒ null(訂單不存在),**不得**收斂成空陣列', async () => {
    makeClient({ data: null, error: null });
    await expect(listOrderPayments('o1')).resolves.toBeNull();
  });

  it('空陣列 ⇒ [](訂單在、還沒收款)', async () => {
    makeClient({ data: [], error: null });
    await expect(listOrderPayments('o1')).resolves.toEqual([]);
  });

  it('error ⇒ 拋(讀取失敗),**不得**回空陣列', async () => {
    makeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listOrderPayments('o1')).rejects.toThrow(/42501/);
  });

  // 突變靶:把 `if (data === null) return null` 改成 `return []` ⇒ 第一格轉紅、其餘不動。
  it('null 與 [] 的回傳值本身不相等(這兩態在下游要能分辨)', async () => {
    makeClient({ data: null, error: null });
    const notFound = await listOrderPayments('o1');
    makeClient({ data: [], error: null });
    const empty = await listOrderPayments('o1');
    expect(notFound).not.toEqual(empty);
  });
});

describe('形狀 fail-closed(錢的帳不寬容)', () => {
  it('正常列解析成 camelCase', async () => {
    makeClient({ data: [ROW], error: null });
    const rows = await listOrderPayments('o1');
    expect(rows?.[0]).toMatchObject({ id: 'p1', rail: 'cash', amount: 100, isReversal: false });
  });

  it('amount 是浮點 ⇒ 拋(欄位是 int4 整數元,浮點代表管線壞了)', async () => {
    makeClient({ data: [{ ...ROW, amount: 100.5 }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('amount 是字串 ⇒ 拋(不得靠 JS 隱式轉型矇混)', async () => {
    makeClient({ data: [{ ...ROW, amount: '100' }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('🔴 is_reversal 不是 boolean ⇒ 拋 —— 它是「不准看金額正負」那條規則的唯一依據', async () => {
    makeClient({ data: [{ ...ROW, is_reversal: 'true' }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('少一個必填欄 ⇒ 拋(不得靜默補預設值)', async () => {
    const { actor: _actor, ...noActor } = ROW;
    makeClient({ data: [noActor], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('回傳既不是陣列也不是 null ⇒ 拋', async () => {
    makeClient({ data: { rows: [] }, error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('🔴 nullable 欄位的**鍵不存在** ⇒ 拋(那是欄位沒回來,不是「這筆沒填」)', async () => {
    const { payer_note: _note, ...noNote } = ROW;
    makeClient({ data: [noNote], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('nullable 欄位收 null(正常),收數字則拋', async () => {
    makeClient({ data: [{ ...ROW, payer_note: null }], error: null });
    await expect(listOrderPayments('o1')).resolves.not.toBeNull();
    makeClient({ data: [{ ...ROW, payer_note: 123 }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });
});

describe('呼叫面', () => {
  it('用具名參數 p_order_id 呼叫那支 RPC', async () => {
    const rpc = makeClient({ data: [], error: null });
    await listOrderPayments('order-42');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('admin_list_order_payments', { p_order_id: 'order-42' });
  });
});
