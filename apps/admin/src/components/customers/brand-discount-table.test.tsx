// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const save = vi.fn();
const below = vi.fn();
const copy = vi.fn();
const preview = vi.fn();
vi.mock('../../lib/customers/brand-discount-actions', () => ({
  saveBrandDiscountsAction: (a: unknown) => save(a),
  checkBelowCostAction: (a: unknown) => below(a),
  loadCopyDiscountsAction: (a: unknown) => copy(a),
  previewBrandAction: (a: unknown) => preview(a),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BrandDiscountTable, type BrandDiscountRowView } from './brand-discount-table';

afterEach(() => {
  cleanup();
  save.mockReset();
  below.mockReset();
  copy.mockReset();
  preview.mockReset();
});
beforeEach(() => {
  below.mockResolvedValue({ kind: 'ok', belowCost: [] });
});
/** 進入確認畫面(會等 server 的低於成本檢查回來)。 */
async function review(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

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

  it('勾選多個品牌套用同一個折扣 ⇒ 差異確認列出兩個品牌', async () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.click(screen.getByLabelText('選取 RIZOMA'));
    fireEvent.click(screen.getByLabelText('選取 OHLINS'));
    fireEvent.change(screen.getByLabelText('批次折扣 %'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: '套用到已選品牌' }));
    await review('檢查變更（2 個品牌）');
    const panel = screen.getByRole('region', { name: '儲存前確認' });
    expect(panel.textContent).toContain('RIZOMA');
    expect(panel.textContent).toContain('OHLINS');
    expect(panel.textContent).toContain('折扣 7.5%');
  });

  it('🔴 超過 20% ⇒ 那一列標黃, 沒勾確認不能存;勾了送出 overCapConfirmed', async () => {
    save.mockResolvedValue({ kind: 'saved' });
    const { container } = render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '25' } });
    await review('檢查變更（1 個品牌）');
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
    await review('檢查變更（1 個品牌）');
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('選取 OHLINS') as HTMLInputElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '確認儲存' }));
    });
    expect(save.mock.calls[0]![0].changes).toEqual([{ brand_id: 'b2', percent: 10, below_cost_reason: '' }]);
  });

  it('🔴 返回修改後, 上一批的 20% 確認不會沿用', async () => {
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '25' } });
    await review('檢查變更（1 個品牌）');
    fireEvent.click(screen.getByLabelText('我確認這個折扣超過 20%'));
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '90' } });
    await review('檢查變更（1 個品牌）');
    expect((screen.getByLabelText('我確認這個折扣超過 20%') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認儲存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 儲存回應沒收到(丟例外)⇒ 顯示無法確認, 修改留著', async () => {
    save.mockRejectedValue(new Error('network'));
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '10' } });
    await review('檢查變更（1 個品牌）');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '確認儲存' }));
    });
    expect(screen.getByRole('status').textContent).toContain('無法確認是否已經儲存');
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).value).toBe('10');
  });

  it('🔴 片 E4:折扣後低於成本 ⇒ 那一列標紅, 要填原因才能存;原因跟著送出', async () => {
    below.mockResolvedValue({ kind: 'ok', belowCost: ['b2'] });
    save.mockResolvedValue({ kind: 'saved' });
    const { container } = render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '15' } });
    await review('檢查變更（1 個品牌）');
    expect(below).toHaveBeenCalledWith({ percents: { b2: 15 } });
    expect(container.querySelector("[data-under-margin='true']")).not.toBeNull();
    const confirm = screen.getByRole('button', { name: '確認儲存' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('RIZOMA 低於成本的原因'), { target: { value: '清庫存' } });
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(save.mock.calls[0]![0].changes).toEqual([{ brand_id: 'b2', percent: 15, below_cost_reason: '清庫存' }]);
  });

  it('🔴 片 E4:低於成本檢查讀不到 ⇒ 不能存', async () => {
    below.mockResolvedValue({ kind: 'failed' });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '15' } });
    await review('檢查變更（1 個品牌）');
    expect(screen.getByText(/成本資料讀取失敗/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '確認儲存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('片 E4:複製另一位會員的設定 ⇒ 表格變成跟對方一樣(對方沒設定的清成不打折), 尚未儲存', async () => {
    copy.mockResolvedValue({ kind: 'ok', percents: { b2: 8 } });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave copySources={[{ id: 's2', label: '阿華車行' }]} />);
    fireEvent.change(screen.getByLabelText('複製來源'), { target: { value: 's2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶入設定' }));
    });
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('ARROW 折扣 %') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/尚未儲存/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('片 E4:預覽用這一列目前的 %;沒有成本欄時不顯示成本那一欄', async () => {
    preview.mockResolvedValue({ kind: 'ok', items: [{ title: '排氣管', generalPrice: 1100, dealerPrice: 1000 }] });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽 ARROW' }));
    });
    const panel = screen.getByRole('region', { name: '價格預覽' });
    expect(panel.textContent).toContain('950');
    expect(panel.textContent).not.toContain('成本');
  });

  it('🔴 Codex E4 R1:返回修改之後, 上一批慢回來的低於成本結果不會蓋掉新的確認畫面', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    below.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    below.mockResolvedValueOnce({ kind: 'ok', belowCost: ['b2'] });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('RIZOMA 折扣 %'), { target: { value: '15' } });
    await review('檢查變更（1 個品牌）');
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    await review('檢查變更（1 個品牌）');
    fireEvent.change(screen.getByLabelText('RIZOMA 低於成本的原因'), { target: { value: '清庫存' } });
    await act(async () => {
      resolveFirst({ kind: 'ok', belowCost: [] });
    });
    expect(screen.getByLabelText('RIZOMA 低於成本的原因')).toBeTruthy();
  });

  it('🔴 Codex E4 R1/R2:帶入設定期間表格鎖住、「檢查變更」不能按;回來後才帶入', async () => {
    let resolveCopy: (v: unknown) => void = () => {};
    copy.mockImplementationOnce(() => new Promise((r) => (resolveCopy = r)));
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave copySources={[{ id: 's2', label: '阿華車行' }]} />);
    // 先有一筆有效變更, 證明「檢查變更」本來按得下去(Codex E4 R3 nit:否則下面那條斷言恆真)
    fireEvent.change(screen.getByLabelText('OHLINS 折扣 %'), { target: { value: '3' } });
    expect((screen.getByRole('button', { name: /檢查變更/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('複製來源'), { target: { value: 's2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶入設定' }));
    });
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /檢查變更/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveCopy({ kind: 'ok', percents: { b2: 8 } });
    });
    expect((screen.getByLabelText('RIZOMA 折扣 %') as HTMLInputElement).value).toBe('8');
  });

  it('預覽:這一列的折扣格式不對 ⇒ 提示修正, 不顯示成不打折', async () => {
    preview.mockResolvedValue({ kind: 'ok', items: [{ title: '排氣管', generalPrice: 1100, dealerPrice: 1000 }] });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    fireEvent.change(screen.getByLabelText('ARROW 折扣 %'), { target: { value: '7.55' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽 ARROW' }));
    });
    expect(screen.getByRole('region', { name: '價格預覽' }).textContent).toContain('格式不對');
  });

  it('🔴 Codex E4 R2:連續預覽兩個品牌, 先按的那個晚回來也不會把畫面切回去;關閉後晚到的回應不再打開', async () => {
    let resolveArrow: (v: unknown) => void = () => {};
    preview.mockImplementationOnce(() => new Promise((r) => (resolveArrow = r)));
    preview.mockResolvedValueOnce({ kind: 'ok', items: [{ title: 'R 商品', generalPrice: 100, dealerPrice: 90 }] });
    render(<BrandDiscountTable customerId='c1' rows={rows} canSave />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽 ARROW' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽 RIZOMA' }));
    });
    await act(async () => {
      resolveArrow({ kind: 'ok', items: [{ title: 'A 商品', generalPrice: 100, dealerPrice: 90 }] });
    });
    const panel = screen.getByRole('region', { name: '價格預覽' });
    expect(panel.textContent).toContain('RIZOMA');
    expect(panel.textContent).not.toContain('A 商品');

    let resolveLate: (v: unknown) => void = () => {};
    preview.mockImplementationOnce(() => new Promise((r) => (resolveLate = r)));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽 OHLINS' }));
    });
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await act(async () => {
      resolveLate({ kind: 'ok', items: [] });
    });
    expect(screen.queryByRole('region', { name: '價格預覽' })).toBeNull();
  });
});
