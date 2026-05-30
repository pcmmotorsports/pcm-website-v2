// @vitest-environment jsdom
//
// AddressTab smoke(g-5a 唯讀列表 + g-5b 新增表單 + g-5c 編輯/刪除)— 前台 regression 安全網。
//
// 驗:
// - 標題「收件地址」+ acc-section 殼(data-tab="address")+「＋ 新增地址」鈕(g-5b)
// - 有地址 → 渲染 .acc-addr 卡(name/phone/line);isDefault → 顯「預設」標籤、非預設不顯
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增地址 — 新增後結帳可直接帶入。」
// - g-5b:點「＋ 新增地址」→ 開 InlineAddressForm(.acc-inline-form);新增表單預填會員姓名(defaultName)
// - g-5c:每卡 .acc-addr-actions「編輯/刪除」鈕;點編輯 → 開 InlineAddressForm 編輯模式(heading「編輯地址」+ 帶入既有值)
// - g-5c:編輯 submit → updateAddressAction(該筆 id, payload);點刪除 → confirm 確認後 deleteAddressAction(該筆 id)、confirm 取消則不刪(對齊 design L362-363)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)
//
// mock '@/app/account/address/actions'(AddressTab import server action、transitively 拉 server-only 在 jsdom 爆、
// 同 RegisterPage.test 處置)+ next/navigation(InlineAddressForm / AddressTab useRouter)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUpdateAddressAction, mockDeleteAddressAction } = vi.hoisted(() => ({
  mockUpdateAddressAction: vi.fn(),
  mockDeleteAddressAction: vi.fn(),
}));
vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: vi.fn(),
  updateAddressAction: mockUpdateAddressAction,
  deleteAddressAction: mockDeleteAddressAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// jsdom 不實作 scrollIntoView(g-5c inline-form 包裹層 ref 觸發會爆);本 repo 無全域 setupFiles、就地補。
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  mockUpdateAddressAction.mockReset().mockResolvedValue({ ok: true });
  mockDeleteAddressAction.mockReset().mockResolvedValue({ ok: true });
  // jsdom confirm 預設回 false(且未實作);預設放行、單一測試 mockReturnValueOnce(false) 覆寫驗取消。
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

import { AddressTab } from './AddressTab';
import type { CustomerAddress } from '@pcm/domain';

afterEach(cleanup);

function makeAddr(over: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: 'a1',
    customerUserId: 'u1',
    isDefault: false,
    name: '王小明',
    phone: '0912345678',
    line: '台北市信義區市府路 1 號',
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function renderTab(addresses: CustomerAddress[], defaultName = '') {
  return render(<AddressTab addresses={addresses} defaultName={defaultName} />);
}

describe('AddressTab(g-5a 唯讀列表 + g-5b 新增 + g-5c 編輯/刪除)', () => {
  it('標題「收件地址」+ acc-section 殼 +「＋ 新增地址」鈕', () => {
    const { container } = renderTab([]);
    expect(screen.getByText('收件地址')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="address"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
    expect(container.querySelector('.acc-add')).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 新增地址' })).toBeTruthy();
  });

  it('有地址 → 渲染卡 name/phone/line', () => {
    const { container } = renderTab([makeAddr()]);
    expect(container.querySelector('.acc-addr')).toBeTruthy();
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText('0912345678')).toBeTruthy();
    expect(screen.getByText('台北市信義區市府路 1 號')).toBeTruthy();
  });

  it('isDefault → 顯「預設」標籤;非預設不顯', () => {
    const { container, rerender } = renderTab([makeAddr({ isDefault: true })]);
    expect(container.querySelector('.acc-addr-tag')).toBeTruthy();
    expect(screen.getByText('預設')).toBeTruthy();
    rerender(<AddressTab addresses={[makeAddr({ isDefault: false })]} defaultName="" />);
    expect(screen.queryByText('預設')).toBeNull();
  });

  it('多筆地址全渲染', () => {
    const { container } = renderTab([makeAddr({ id: 'a1', name: '甲' }), makeAddr({ id: 'a2', name: '乙' })]);
    expect(container.querySelectorAll('.acc-addr').length).toBe(2);
    expect(screen.getByText('甲')).toBeTruthy();
    expect(screen.getByText('乙')).toBeTruthy();
  });

  it('空清單 → design 空狀態字面(表單未開時)', () => {
    const { container } = renderTab([]);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('尚未新增地址 — 新增後結帳可直接帶入。')).toBeTruthy();
    expect(container.querySelector('.acc-addr')).toBeNull();
  });

  it('g-5b:點「＋ 新增地址」→ 開 InlineAddressForm(.acc-inline-form);空清單時空狀態與表單並存(對齊 design L650-657)', () => {
    const { container } = renderTab([]);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    expect(screen.getByText('新增地址')).toBeTruthy();
    expect(screen.getByRole('button', { name: '儲存' })).toBeTruthy();
    // design L650-657:空狀態與新增表單獨立條件、空清單開表單時兩者並存(不收起空狀態)。
    expect(screen.getByText('尚未新增地址 — 新增後結帳可直接帶入。')).toBeTruthy();
    expect(container.querySelector('.acc-empty')).toBeTruthy();
  });

  it('g-5b:新增表單預填會員姓名(defaultName、對齊 design L628)', () => {
    renderTab([], '王大明');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect((screen.getByPlaceholderText('王小明') as HTMLInputElement).value).toBe('王大明');
  });

  it('g-5c 每卡渲染 .acc-addr-actions「編輯/刪除」鈕(design L638-641)', () => {
    const { container } = renderTab([makeAddr()]);
    expect(container.querySelector('.acc-addr-actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刪除' })).toBeTruthy();
  });

  it('g-5c 點「編輯」→ 開 InlineAddressForm 編輯模式(heading「編輯地址」+ 帶入既有值)', () => {
    const { container } = renderTab([
      makeAddr({ name: '陳大文', phone: '0911222333', line: '台北市信義區松壽路 9 號' }),
    ]);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    // 編輯模式 heading(非「新增地址」)
    expect(screen.getByText('編輯地址')).toBeTruthy();
    expect(screen.queryByText('新增地址')).toBeNull();
    // 既有值帶入(收件人/手機/地址)
    expect((screen.getByPlaceholderText('王小明') as HTMLInputElement).value).toBe('陳大文');
    expect((screen.getByPlaceholderText('0912 345 678') as HTMLInputElement).value).toBe('0911222333');
    expect((screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓') as HTMLInputElement).value).toBe(
      '台北市信義區松壽路 9 號',
    );
  });

  it('g-5c 編輯 toggle:再點同卡「編輯」收合表單', () => {
    const { container } = renderTab([makeAddr()]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeNull();
  });

  it('g-5c 編輯 submit → updateAddressAction(該筆 id, payload)(id 綁 parent closure)', async () => {
    renderTab([makeAddr({ id: 'a-99', name: '陳大文', line: '台北市信義區松壽路 9 號' })]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    // 既有值已帶入(name/line 必填已滿足)、直接送出
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mockUpdateAddressAction).toHaveBeenCalledTimes(1));
    const [addressId, payload] = mockUpdateAddressAction.mock.calls[0]!;
    expect(addressId).toBe('a-99');
    expect(payload).toMatchObject({ name: '陳大文', line: '台北市信義區松壽路 9 號' });
  });

  it('g-5c 點「刪除」→ confirm 確認後 deleteAddressAction(該筆 id)(對齊 design L362-363)', async () => {
    renderTab([makeAddr({ id: 'a-77' })]);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(mockDeleteAddressAction).toHaveBeenCalledTimes(1));
    expect(mockDeleteAddressAction).toHaveBeenCalledWith('a-77');
  });

  it('g-5c 刪除 confirm 取消(回 false)→ 不呼叫 deleteAddressAction(對齊 design L363)', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    renderTab([makeAddr({ id: 'a-77' })]);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(mockDeleteAddressAction).not.toHaveBeenCalled();
  });

  it('g-5c 同一時間只開一個表單:開新增後點編輯 → 切換為編輯(新增表單收合)', () => {
    const { container } = renderTab([makeAddr()]);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect(screen.getByText('新增地址')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    // 單一 addrEdit state:切到編輯、新增 heading 消失、只剩一個 inline form
    expect(screen.queryByText('新增地址')).toBeNull();
    expect(screen.getByText('編輯地址')).toBeTruthy();
    expect(container.querySelectorAll('.acc-inline-form').length).toBe(1);
  });

  it('純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)', () => {
    const { container } = renderTab([]);
    expect(container.querySelectorAll('.acc-addr').length).toBe(0);
  });
});
