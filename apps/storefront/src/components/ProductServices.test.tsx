// @vitest-environment jsdom
//
// ProductServices smoke test — 前台 regression 安全網(M-1-13f-1)。
// 驗「4 卡 label + desc 字面渲染」(對齊鐵則 1「直接搬」、字面是合約)。
// 純 presentational server component、無 hooks / props、不需 router / matchMedia stub。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductServices } from './ProductServices';

afterEach(cleanup);

describe('ProductServices', () => {
  it('renders 4 service labels (滿額免運 / 專業安裝 / 泰國原廠 / LINE 諮詢)', () => {
    render(<ProductServices />);
    expect(screen.getByText('滿額免運')).toBeDefined();
    expect(screen.getByText('專業安裝')).toBeDefined();
    expect(screen.getByText('泰國原廠')).toBeDefined();
    expect(screen.getByText('LINE 諮詢')).toBeDefined();
  });

  it('renders 4 service descriptions matching OD 模板字面', () => {
    render(<ProductServices />);
    // OD-5:字面直接搬 OD product-detail-rpm-template.html(免運門檻仍 5,000、對齊 Sean 永久拍板)
    expect(screen.getByText('NT$ 5,000 以上免運費')).toBeDefined();
    expect(screen.getByText('全台合作店家')).toBeDefined();
    expect(screen.getByText('RPM Carbon 授權代理')).toBeDefined();
    expect(screen.getByText('下單前先聊聊確認貨況')).toBeDefined();
  });

  it('renders exactly 4 .pd-service cards inside a full-width .pd-services-strip section', () => {
    render(<ProductServices />);
    // OD-5:元件改吐完整 section.pd-services-strip(全寬橫條外殼由本元件擁有)
    const strip = document.querySelector('section.pd-services-strip');
    expect(strip).not.toBeNull();
    const cards = document.querySelectorAll('.pd-service');
    expect(cards.length).toBe(4);
  });
});
