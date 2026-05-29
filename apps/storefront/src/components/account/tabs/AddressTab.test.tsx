// @vitest-environment jsdom
//
// AddressTab smoke(g-5a 唯讀列表 + g-5b 新增表單)— 前台 regression 安全網。
//
// 驗:
// - 標題「收件地址」+ acc-section 殼(data-tab="address")+「＋ 新增地址」鈕(g-5b)
// - 有地址 → 渲染 .acc-addr 卡(name/phone/line);isDefault → 顯「預設」標籤、非預設不顯
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增地址 — 新增後結帳可直接帶入。」
// - g-5b:點「＋ 新增地址」→ 開 InlineAddressForm(.acc-inline-form);仍無編輯/刪除鈕(.acc-addr-actions、g-5c)
// - g-5b:新增表單預填會員姓名(defaultName、對齊 design L628)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)
//
// mock '@/app/account/address/actions'(AddressTab 改 import addAddressAction server action、transitively
// 拉 server-only 在 jsdom 爆、同 RegisterPage.test 處置)+ next/navigation(InlineAddressForm useRouter)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

describe('AddressTab(g-5a 唯讀列表 + g-5b 新增)', () => {
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

  it('g-5b 仍無編輯/刪除 action 鈕(.acc-addr-actions、留 g-5c)', () => {
    const { container } = renderTab([makeAddr()]);
    expect(container.querySelector('.acc-addr-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull();
  });

  it('純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)', () => {
    const { container } = renderTab([]);
    expect(container.querySelectorAll('.acc-addr').length).toBe(0);
  });
});
