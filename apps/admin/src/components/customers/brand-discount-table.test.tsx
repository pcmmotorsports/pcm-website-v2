// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const save = vi.fn();
vi.mock('../../lib/customers/brand-discount-actions', () => ({ saveBrandDiscountsAction: (a: unknown) => save(a) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BrandDiscountTable, type BrandDiscountRowView } from './brand-discount-table';

afterEach(() => {
  cleanup();
  save.mockReset();
});

const rows: BrandDiscountRowView[] = [
  { brandId: 'b1', brandName: 'ARROW', current: { percent: 5, below_cost_reason: '', updated_at: 't1', updatedAtText: '2026/09/25', updatedByLabel: '阿祥' } },
  { brandId: 'b2', brandName: 'RIZOMA', current: null },
  { brandId: 'b3', brandName: 'OHLINS', current: null },
];

describe('經銷品牌折扣表(片 E3)', () => {
  it('🔴 非管理者 ⇒ 儲存鈕寫「只有管理者可以修改」而且不能按', () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave={false} />);
    const btn = screen.getByRole('button', { name: '只有管理者可以修改' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('顯示「折扣 5%」與「＝經銷價的 95%」;搜尋與只看有設定的', () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    expect(screen.getByText('折扣 5%')).toBeTruthy();
    expect(screen.getAllByText('＝經銷價的 95%').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('搜尋品牌'), { target: { value: 'riz' } });
    expect(screen.queryByText('ARROW')).toBeNull();
    fireEvent.change(screen.getByLabelText('搜尋品牌'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('只看有設定的'));
    expect(screen.queryByText('RIZOMA')).toBeNull();
    expect(screen.getByText('ARROW')).toBeTruthy();
  });

  it('勾選多個品牌套用同一個折扣 ⇒ 差異確認列出兩個品牌', () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.click(screen.getByLabelText('選取 RIZOMA'));
    fireEvent.click(screen.getByLabelText('選取 OHLINS'));
    fireEvent.change(screen.getByLabelText('批次折扣 %'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: '套用到已選品牌' }));
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（2 個品牌）' }));
    const review = screen.getByRole('region', { name: '儲存前確認' });
    expect(review.textContent).toContain('RIZOMA');
    expect(review.textContent).toContain('OHLINS');
    expect(review.textContent).toContain('折扣 7.5%');
  });

  it('🔴 超過 20% ⇒ 那一列標黃, 沒勾確認不能存;勾了送出 overCapConfirmed', async () => {
    save.mockResolvedValue({ kind: 'saved' });
    const { container } = render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（1 個品牌）' }));
    expect(container.querySelector("[data-over-cap='true']")).not.toBeNull();
    const confirm = screen.getByRole('button', { name: '確認儲存' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('我確認這個折扣超過 20%'));
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(save).toHaveBeenCalledWith({
      customerId: 'c1',
      changes: [{ brand_id: 'b1', percent: 25, below_cost_reason: '' }],
      expected: { b1: { percent: 5, below_cost_reason: '', updated_at: 't1' } },
      overCapConfirmed: true,
    });
  });

  it('🔴 超過一位小數 ⇒ 格子旁提示, 不能檢查變更', () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '7.55' } });
    expect(screen.getByText('折扣最多到小數點後一位。')).toBeTruthy();
    expect((screen.getByRole('button', { name: /檢查變更/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 確認期間表格鎖住:不能改格子、不能批次套用;送出的是確認畫面上那一批', async () => {
    save.mockResolvedValue({ kind: 'saved' });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（1 個品牌）' }));
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('選取 OHLINS') as HTMLInputElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '確認儲存' }));
    });
    expect(save.mock.calls[0]![0].changes).toEqual([{ brand_id: 'b2', percent: 10, below_cost_reason: '' }]);
  });

  it('🔴 返回修改後, 上一批的 20% 確認不會沿用', () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（1 個品牌）' }));
    fireEvent.click(screen.getByLabelText('我確認這個折扣超過 20%'));
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（1 個品牌）' }));
    expect((screen.getByLabelText('我確認這個折扣超過 20%') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認儲存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 儲存回應沒收到(丟例外)⇒ 顯示無法確認, 修改留著', async () => {
    save.mockRejectedValue(new Error('network'));
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查變更（1 個品牌）' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '確認儲存' }));
    });
    expect(screen.getByRole('status').textContent).toContain('無法確認是否已經儲存');
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).value).toBe('10');
  });
});
