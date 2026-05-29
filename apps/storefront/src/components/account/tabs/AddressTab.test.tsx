// @vitest-environment jsdom
//
// AddressTab smoke(g-5a:唯讀地址列表)— 前台 regression 安全網。
//
// 驗:
// - 標題「收件地址」+ acc-section 殼(data-tab="address")
// - 有地址 → 渲染 .acc-addr 卡(name/phone/line);isDefault → 顯「預設」標籤、非預設不顯
// - 多筆全渲染
// - 空清單 → design 空狀態字面「尚未新增地址 — 新增後結帳可直接帶入。」(design L651)
// - g-5a 唯讀:不渲染「＋ 新增地址」/「編輯」/「刪除」action 鈕(寫入留 g-5b/c)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)
//
// AddressTab 為純 presentational(無 hooks / 無 server action import)、直接 render with props、無需 mock。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('AddressTab(g-5a 唯讀列表)', () => {
  it('標題「收件地址」+ acc-section 殼', () => {
    const { container } = render(<AddressTab addresses={[]} />);
    expect(screen.getByText('收件地址')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="address"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('有地址 → 渲染卡 name/phone/line', () => {
    const { container } = render(<AddressTab addresses={[makeAddr()]} />);
    expect(container.querySelector('.acc-addr')).toBeTruthy();
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText('0912345678')).toBeTruthy();
    expect(screen.getByText('台北市信義區市府路 1 號')).toBeTruthy();
  });

  it('isDefault → 顯「預設」標籤;非預設不顯', () => {
    const { container, rerender } = render(<AddressTab addresses={[makeAddr({ isDefault: true })]} />);
    expect(container.querySelector('.acc-addr-tag')).toBeTruthy();
    expect(screen.getByText('預設')).toBeTruthy();
    rerender(<AddressTab addresses={[makeAddr({ isDefault: false })]} />);
    expect(screen.queryByText('預設')).toBeNull();
  });

  it('多筆地址全渲染', () => {
    const { container } = render(
      <AddressTab addresses={[makeAddr({ id: 'a1', name: '甲' }), makeAddr({ id: 'a2', name: '乙' })]} />,
    );
    expect(container.querySelectorAll('.acc-addr').length).toBe(2);
    expect(screen.getByText('甲')).toBeTruthy();
    expect(screen.getByText('乙')).toBeTruthy();
  });

  it('空清單 → design 空狀態字面', () => {
    const { container } = render(<AddressTab addresses={[]} />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('尚未新增地址 — 新增後結帳可直接帶入。')).toBeTruthy();
    expect(container.querySelector('.acc-addr')).toBeNull();
  });

  it('g-5a 唯讀:不渲染新增/編輯/刪除 action 鈕(留 g-5b/c)', () => {
    const { container } = render(<AddressTab addresses={[makeAddr()]} />);
    expect(container.querySelector('.acc-add')).toBeNull();
    expect(container.querySelector('.acc-addr-actions')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('＋ 新增地址')).toBeNull();
  });

  it('純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)', () => {
    const { container } = render(<AddressTab addresses={[]} />);
    expect(container.querySelectorAll('.acc-addr').length).toBe(0);
  });
});
