// @vitest-environment jsdom
//
// CategoryGrid smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoryGrid } from './CategoryGrid';

afterEach(cleanup);

describe('CategoryGrid', () => {
  it('should render the category grid without crashing', () => {
    render(<CategoryGrid />);
    expect(screen.getByText('Categories · 部品分類')).toBeDefined();
    expect(screen.getByText('排氣管')).toBeDefined();
  });
});
