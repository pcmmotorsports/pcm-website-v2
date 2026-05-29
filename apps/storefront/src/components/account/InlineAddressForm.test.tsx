// @vitest-environment jsdom
//
// InlineAddressForm smoke(g-5b:新增/編輯地址表單)— 前台 regression 安全網。
//
// 驗:
// - render 基本欄(收件人/手機/地址)+ 設預設勾選 + 發票三 tab(個人/公司(三聯式)/捐贈)
// - tab 切換顯對應欄(personal→手機載具 / company→公司抬頭+統一編號 / donate→愛心碼)
// - submit → onSubmit 收正確 shape { isDefault, name, phone, line, invoice:{type,...} }
// - 設預設勾選 → submit payload isDefault=true
// - #181:server 回 fieldErrors.invoice.taxId → 統一編號欄 .auth-field-err 紅字;name 錯 → 收件人欄紅字
// - ok=true → router.refresh() + onClose() 被呼叫(g-4c pattern:清單即時刷新 + 收合)
// - 純 onSubmit 驅動(不寫 design localStorage mock)
//
// mock next/navigation(useRouter().refresh、jsdom 無 router);onSubmit/onClose 由 test 傳 vi.fn()。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { InlineAddressForm, type InlineAddressFormProps } from './InlineAddressForm';
import type { AddAddressActionResult } from '@/app/account/address/actions';

beforeEach(() => mockRefresh.mockReset());
afterEach(cleanup);

function renderForm(
  opts: { addr?: InlineAddressFormProps['addr']; result?: AddAddressActionResult } = {},
) {
  const onSubmit = vi
    .fn<InlineAddressFormProps['onSubmit']>()
    .mockResolvedValue(opts.result ?? { ok: true });
  const onClose = vi.fn<() => void>();
  render(<InlineAddressForm addr={opts.addr ?? { isDefault: false }} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}

// 填必填欄(收件人/地址),使原生 required 驗證放行、form onSubmit 觸發(jsdom 對 required 空欄會擋送出)。
// server zod 仍為權威驗證,required 是 client 層 UX(對齊 design L714/L716);下列 #181/ok 測試驗的是
// 「server 回應 → 渲染」與 ok 流程,不依賴空欄送出,故先填必填欄讓 submit 真的觸發。
function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
  fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北市' } });
}

describe('InlineAddressForm(g-5b 新增表單)', () => {
  it('render 基本欄 + 設預設 + 發票三 tab + heading「新增地址」', () => {
    renderForm();
    expect(screen.getByText('新增地址')).toBeTruthy();
    expect(screen.getByPlaceholderText('王小明')).toBeTruthy();
    expect(screen.getByPlaceholderText('0912 345 678')).toBeTruthy();
    expect(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓')).toBeTruthy();
    expect(screen.getByText('設為預設地址')).toBeTruthy();
    expect(screen.getByRole('button', { name: '個人' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '公司(三聯式)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '捐贈' })).toBeTruthy();
    // 預設 personal tab:手機載具欄在場;公司/捐贈欄不在
    expect(screen.getByPlaceholderText('/ABCD123')).toBeTruthy();
    expect(screen.queryByPlaceholderText('8 碼數字')).toBeNull();
  });

  it('edit 模式(addr.id)→ heading「編輯地址」', () => {
    renderForm({ addr: { id: 'a1', isDefault: true, name: '王', phone: '09', line: '台北' } });
    expect(screen.getByText('編輯地址')).toBeTruthy();
  });

  it('發票 tab 切換顯對應欄(company→抬頭+統編 / donate→愛心碼)', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    expect(screen.getByPlaceholderText('例:賓士機車有限公司')).toBeTruthy();
    expect(screen.getByPlaceholderText('8 碼數字')).toBeTruthy();
    expect(screen.queryByPlaceholderText('/ABCD123')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '捐贈' }));
    expect(screen.getByPlaceholderText('例:8585(罕病)、925(伊甸)')).toBeTruthy();
    expect(screen.queryByPlaceholderText('8 碼數字')).toBeNull();
  });

  it('submit → onSubmit 收正確 shape(personal)', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '陳大文' } });
    fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0911222333' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北市信義區' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      isDefault: false,
      name: '陳大文',
      phone: '0911222333',
      line: '台北市信義區',
      invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    });
  });

  it('勾設預設 + company tab → onSubmit payload isDefault=true + invoice.type=company', async () => {
    const { onSubmit } = renderForm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    fireEvent.change(screen.getByPlaceholderText('例:賓士機車有限公司'), { target: { value: '賓士機車' } });
    fireEvent.change(screen.getByPlaceholderText('8 碼數字'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '甲' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      isDefault: true,
      name: '甲',
      phone: '',
      line: '台北',
      invoice: { type: 'company', carrier: '', title: '賓士機車', taxId: '12345678', donateCode: '' },
    });
  });

  it('#181 server 回 fieldErrors.invoice.taxId → 統一編號欄 .auth-field-err 紅字(巢狀)', async () => {
    renderForm({ result: { fieldErrors: { invoice: { taxId: '統編需 8 碼數字' } } } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('統編需 8 碼數字');
    expect(err.classList.contains('auth-field-err')).toBe(true);
  });

  it('#181 server 回 fieldErrors.name → 收件人欄紅字(頂層)', async () => {
    renderForm({ result: { fieldErrors: { name: '請填寫收件人' } } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('請填寫收件人');
    expect(err.classList.contains('auth-field-err')).toBe(true);
  });

  it('#181 server 回 formError → 頂部 .auth-err、不呼叫 router.refresh / onClose', async () => {
    const { onClose } = renderForm({ result: { formError: '儲存失敗,請稍後再試' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('儲存失敗,請稍後再試');
    expect(err.classList.contains('auth-err')).toBe(true);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ok=true → router.refresh() + onClose() 被呼叫(g-4c pattern)', async () => {
    const { onClose } = renderForm({ result: { ok: true } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('取消鈕 → onClose()(不 submit)', () => {
    const { onSubmit, onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
