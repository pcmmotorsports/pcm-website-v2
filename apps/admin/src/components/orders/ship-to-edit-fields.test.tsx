// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShipToEditFields } from './ship-to-edit-fields';

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  return render(<form><ShipToEditFields name='測試收件人' phone='0900000000' line='測試市測試路1號' /></form>);
}

describe('收件資料複製', () => {
  it('未編輯也能複製整組，而且不送出表單、不把收件欄位送入 FormData', async () => {
    const { container } = setup();
    const form = container.querySelector('form')!;
    const submit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener('submit', submit);
    fireEvent.click(screen.getByRole('button', { name: '複製收件資料' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('測試收件人,0900000000,測試市測試路1號'));
    expect(submit).not.toHaveBeenCalled();
    expect(new FormData(form).has('ship_to_name')).toBe(false);
    expect(new FormData(form).has('ship_to_phone')).toBe(false);
    expect(new FormData(form).has('ship_to_line')).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('已複製');
  });

  it('唯讀文字可單欄複製；拖曳選取後的 click 不改剪貼簿', async () => {
    setup();
    const btn = screen.getByRole('button', { name: '複製電話' });
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('0900000000'));
    writeText.mockClear();
    const range = document.createRange();
    range.selectNodeContents(btn);
    window.getSelection()!.addRange(range);
    fireEvent.click(btn, { detail: 1 });
    expect(writeText).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
  });

  it('編輯中複製目前輸入值，關閉編輯後複製已儲存值', async () => {
    const { container } = setup();
    fireEvent.click(screen.getByTestId('ship-to-edit-toggle'));
    fireEvent.change(container.querySelector('input[name="ship_to_name"]')!, { target: { value: '修改中姓名' } });
    fireEvent.click(screen.getByRole('button', { name: '複製收件資料' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('修改中姓名,0900000000,測試市測試路1號'));
    expect(screen.getByText('複製目前輸入的資料（尚未儲存）')).toBeDefined();
    expect(new FormData(container.querySelector('form')!).get('ship_to_name')).toBe('修改中姓名');
    fireEvent.click(screen.getByTestId('ship-to-edit-toggle'));
    fireEvent.click(screen.getByRole('button', { name: '複製收件資料' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('測試收件人,0900000000,測試市測試路1號'));
  });

  it('缺值保留空欄，剪貼簿失敗不報成功', async () => {
    render(<ShipToEditFields name='測試收件人' phone='' line='測試地址' />);
    writeText.mockRejectedValue(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: '複製收件資料' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('測試收件人,,測試地址'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('複製失敗'));
    expect(screen.getByRole('status').textContent).not.toContain('已複製');
  });
});
