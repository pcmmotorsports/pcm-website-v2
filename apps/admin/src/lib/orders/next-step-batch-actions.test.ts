import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  proc: vi.fn(),
  rcpt: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: h.authorize }));
vi.mock('./procurement-actions', () => ({ upsertItemProcurementAction: h.proc }));
vi.mock('./receipt-actions', () => ({ recordItemReceiptAction: h.rcpt }));

import { submitNextStepBatchAction } from './next-step-batch-actions';
import { BATCH_KIND_FIELD, BATCH_ROWS_MAX, batchFieldName } from './next-step-batch';

// next-step-batch-actions.test.ts — 批次逐列送(B9-b)。
// 🔴 承重的三格:① 每一列**走既有單列 action**、帶 inline=1、拿到的是去前綴的那份;② 逐列不回滾:第 1 列失敗第 2 列照跑;
//    ③ denied ⇒ 整批停、後面的列一列都沒跑。

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

function form(kind: string, rows: readonly string[]) {
  const fd = new FormData();
  fd.set(BATCH_KIND_FIELD, kind);
  for (const id of rows) {
    fd.append(batchFieldName(id, 'quantity'), '1');
    fd.append(batchFieldName(id, 'procurement_id'), id);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.authorize.mockResolvedValue({ sid: 's', actorId: 'alice' });
});

describe('submitNextStepBatchAction', () => {
  it('到貨:逐列呼叫 recordItemReceiptAction,每列拿去前綴的欄位 + inline=1;第 1 列失敗第 2 列照跑;結局以列 id 為鍵', async () => {
    h.rcpt
      .mockResolvedValueOnce({ status: 'failed', code: 'QUANTITY_EXCEEDS_ALLOCATED', message: '超過', procurementId: A, values: {} })
      .mockResolvedValueOnce({ status: 'recorded_inline', outcome: 'recorded', procurementId: B });
    const st = await submitNextStepBatchAction({ status: 'idle' }, form('receipt', [A, B]));
    expect(h.rcpt).toHaveBeenCalledTimes(2);
    const first = h.rcpt.mock.calls[0]![1] as FormData;
    expect(first.get('quantity')).toBe('1');
    expect(first.get('procurement_id')).toBe(A);
    expect(first.get('inline')).toBe('1');
    expect([...first.keys()].some((k) => k.startsWith('r.'))).toBe(false);
    expect(st).toEqual({
      status: 'done',
      rows: { [A]: { ok: false, message: '超過' }, [B]: { ok: true, text: '已登記到貨' } },
      okCount: 1,
      failCount: 1,
      halted: false,
    });
    expect(h.proc).not.toHaveBeenCalled();
  });

  it('下訂:走 upsertItemProcurementAction,saved_inline 三種碼各有人話', async () => {
    h.proc
      .mockResolvedValueOnce({ status: 'saved_inline', outcome: 'CREATED', orderItemId: A })
      .mockResolvedValueOnce({ status: 'saved_inline', outcome: 'NO_CHANGE', orderItemId: B });
    const st = await submitNextStepBatchAction({ status: 'idle' }, form('order', [A, B]));
    expect(h.proc.mock.calls[0]![1].get('inline')).toBe('1');
    expect(st).toMatchObject({ status: 'done', okCount: 2, failCount: 0 });
    expect((st as { rows: Record<string, { text?: string }> }).rows[A]!.text).toContain('新增');
    expect((st as { rows: Record<string, { text?: string }> }).rows[B]!.text).toContain('沒有變更');
  });

  it('🔴 中途 denied(A 已寫進去、B 才過期)⇒ 停,A 的成功留著、B 印原因、C 印「沒有送出」;C 一次都沒跑', async () => {
    const C = 'cccccccc-3333-4333-8333-333333333333';
    h.rcpt
      .mockResolvedValueOnce({ status: 'recorded_inline', outcome: 'recorded', procurementId: A })
      .mockResolvedValueOnce({ status: 'failed', code: 'denied', message: '沒權限', procurementId: null, values: {} });
    const st = await submitNextStepBatchAction({ status: 'idle' }, form('receipt', [A, B, C]));
    expect(h.rcpt).toHaveBeenCalledTimes(2);
    expect(st).toMatchObject({ status: 'done', okCount: 1, failCount: 2, halted: true });
    const rows = (st as { rows: Record<string, { ok: boolean; message?: string }> }).rows;
    expect(rows[A]!.ok, 'A 已經寫進去了,不可以說整批沒送').toBe(true);
    expect(rows[B]).toEqual({ ok: false, message: '沒權限' });
    expect(rows[C]!.ok).toBe(false);
    expect(rows[C]!.message).toContain('沒有送出');
  });

  it('🔴 入口授權閘:沒權限 ⇒ rejected,一列都沒跑(單列 action 一次都沒被呼叫)', async () => {
    h.authorize.mockResolvedValue(null);
    const st = await submitNextStepBatchAction({ status: 'idle' }, form('receipt', [A, B]));
    expect(st.status).toBe('rejected');
    expect(h.rcpt).not.toHaveBeenCalled();
  });

  it('kind 不對 / 沒有列 / 超過 50 列 ⇒ rejected,單列 action 一次都沒被呼叫', async () => {
    expect((await submitNextStepBatchAction({ status: 'idle' }, form('ship', [A]))).status).toBe('rejected');
    expect((await submitNextStepBatchAction({ status: 'idle' }, form('receipt', []))).status).toBe('rejected');
    const many = Array.from({ length: BATCH_ROWS_MAX + 1 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    expect((await submitNextStepBatchAction({ status: 'idle' }, form('receipt', many))).status).toBe('rejected');
    expect(h.rcpt).not.toHaveBeenCalled();
    expect(h.proc).not.toHaveBeenCalled();
  });
});
