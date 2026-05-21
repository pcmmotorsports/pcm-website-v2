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
  it('renders 4 service labels (滿額免運 / 專業安裝 / 原廠保固 / LINE 諮詢)', () => {
    render(<ProductServices />);
    expect(screen.getByText('滿額免運')).toBeDefined();
    expect(screen.getByText('專業安裝')).toBeDefined();
    expect(screen.getByText('原廠保固')).toBeDefined();
    expect(screen.getByText('LINE 諮詢')).toBeDefined();
  });

  it('renders 4 service descriptions matching design字面', () => {
    render(<ProductServices />);
    // 免運門檻 NT$ 5,000(backlog #161、storefront 統一字面、design 寫 NT$ 3,000)
    expect(screen.getByText('NT$ 5,000 以上')).toBeDefined();
    expect(screen.getByText('全台合作店家')).toBeDefined();
    expect(screen.getByText('原廠授權代理')).toBeDefined();
    expect(screen.getByText('30 分鐘內回覆')).toBeDefined();
  });

  it('renders exactly 4 .pd-service cards', () => {
    render(<ProductServices />);
    const cards = document.querySelectorAll('.pd-service');
    expect(cards.length).toBe(4);
  });
});
