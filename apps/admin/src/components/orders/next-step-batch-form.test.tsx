// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../../lib/orders/next-step-batch-actions', () => ({ submitNextStepBatchAction: h.submit }));

import { NextStepBatchForm } from './next-step-batch-form';
import { useBatchRow } from './next-step-batch-context';
import { batchFieldName } from '../../lib/orders/next-step-batch';

// next-step-batch-form.test.tsx — 一張表單多列一次送的外殼(B9-b)。
const A = 'aaaaaaaa-1111-4111-8111-111111111111';

function Row({ id }: { id: string }) {
  const b = useBatchRow();
  const o = b?.outcomeOf(id) ?? null;
  if (o?.ok) return <p data-testid={`ok-${id}`}>✓ {o.text}</p>;
  return (
    <div data-testid={`row-${id}`}>
      {o !== null && !o.ok && <p role='alert'>{o.message}</p>}
      <input name={batchFieldName(id, 'quantity')} defaultValue='3' />
      <input type='hidden' name={batchFieldName(id, 'submitted_at_local')} value='2026-09-14T10:30' />
      <input type='hidden' name={batchFieldName(id, 'submitted_at_original')} value='' />
    </div>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('NextStepBatchForm', () => {
  it('送出:整張表單一發、帶 batch_kind;下訂那條每列合成 submitted_at(保秒那支)、拿掉 _original;結局逐列進 context', async () => {
    h.submit.mockResolvedValue({ status: 'done', rows: { [A]: { ok: true, text: '已下訂(新增採購)' } }, okCount: 1, failCount: 0, halted: false });
    const { container } = render(
      <NextStepBatchForm kind='order'>
        <Row id={A} />
      </NextStepBatchForm>,
    );
    expect(screen.getByTestId('batch-note').textContent).toContain('每一列各自寫入');
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const fd = h.submit.mock.calls[0]![1] as FormData;
    expect(fd.get('batch_kind')).toBe('order');
    expect(fd.get(batchFieldName(A, 'quantity'))).toBe('3');
    expect(fd.get(batchFieldName(A, 'submitted_at'))).toMatch(/^2026-09-14T10:30/);
    expect(fd.has(batchFieldName(A, 'submitted_at_original'))).toBe(false);
    await waitFor(() => expect(screen.getByTestId(`ok-${A}`).textContent).toContain('已下訂'));
    expect(screen.getByTestId('batch-summary').textContent).toContain('這一發成功 1 列');
    // 成功的列不再渲染欄位 ⇒ 再送一次不會帶它。
    expect(container.querySelector(`input[name="${batchFieldName(A, 'quantity')}"]`)).toBeNull();
  });

  it('失敗的列留著、印原因;rejected 印整批那句', async () => {
    h.submit.mockResolvedValueOnce({ status: 'done', rows: { [A]: { ok: false, message: '超過還能登錄的件數' } }, okCount: 0, failCount: 1, halted: false });
    const { container } = render(
      <NextStepBatchForm kind='receipt'>
        <Row id={A} />
      </NextStepBatchForm>,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('超過'));
    expect(screen.getByTestId('batch-summary').textContent).toContain('失敗 1 列');
    expect(container.querySelector(`input[name="${batchFieldName(A, 'quantity')}"]`)).not.toBeNull();
    h.submit.mockResolvedValueOnce({ status: 'rejected', message: '一次最多 50 列' });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(container.textContent).toContain('一次最多 50 列'));
  });

  it('🔴 codex R1 must-fix ①:成功的列跨次累積 —— 第一次 A ✓ B ✗,第二次只送 B,A 仍是 ✓、第三次仍不會送 A;全部成功後再按(rejected)也不清', async () => {
    const B = 'bbbbbbbb-2222-4222-8222-222222222222';
    h.submit
      .mockResolvedValueOnce({ status: 'done', rows: { [A]: { ok: true, text: '已登記到貨' }, [B]: { ok: false, message: '超過' } }, okCount: 1, failCount: 1, halted: false })
      .mockResolvedValueOnce({ status: 'done', rows: { [B]: { ok: true, text: '已登記到貨' } }, okCount: 1, failCount: 0, halted: false })
      .mockResolvedValueOnce({ status: 'rejected', message: '沒有可送的列。' });
    const { container } = render(
      <NextStepBatchForm kind='receipt'>
        <Row id={A} />
        <Row id={B} />
      </NextStepBatchForm>,
    );
    const sent = () => [...(h.submit.mock.calls.at(-1)![1] as FormData).keys()].filter((k) => k.endsWith('.quantity'));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId(`ok-${A}`)).toBeDefined());
    expect(sent()).toEqual([batchFieldName(A, 'quantity'), batchFieldName(B, 'quantity')]);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2));
    expect(sent(), '第二次只送 B').toEqual([batchFieldName(B, 'quantity')]);
    await waitFor(() => expect(screen.getByTestId(`ok-${B}`)).toBeDefined());
    expect(screen.getByTestId(`ok-${A}`), '第二發回來只有 B,A 的打勾不可以消失').toBeDefined();
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(3));
    expect(sent(), '第三次一列都不送(兩列都打過勾)').toEqual([]);
    await waitFor(() => expect(container.textContent).toContain('沒有可送的列'));
    expect(screen.getByTestId(`ok-${A}`)).toBeDefined();
    expect(screen.getByTestId(`ok-${B}`)).toBeDefined();
  });

  it('中途被拒(halted)⇒ 摘要講明前面打勾的已寫進去', async () => {
    h.submit.mockResolvedValueOnce({ status: 'done', rows: { [A]: { ok: true, text: '已登記到貨' } }, okCount: 1, failCount: 1, halted: true });
    const { container } = render(
      <NextStepBatchForm kind='receipt'>
        <Row id={A} />
      </NextStepBatchForm>,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('中途被拒'));
    expect(screen.getByTestId('batch-summary').textContent).toContain('前面打勾的已經寫進去了');
  });

  it('到貨那條不動 submitted_at(只有下訂要合成)', async () => {
    h.submit.mockResolvedValue({ status: 'done', rows: {}, okCount: 0, failCount: 0, halted: false });
    const { container } = render(
      <NextStepBatchForm kind='receipt'>
        <Row id={A} />
      </NextStepBatchForm>,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const fd = h.submit.mock.calls[0]![1] as FormData;
    expect(fd.has(batchFieldName(A, 'submitted_at'))).toBe(false);
    expect(fd.has(batchFieldName(A, 'submitted_at_original'))).toBe(true);
  });
});
