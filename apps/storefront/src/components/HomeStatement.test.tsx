// @vitest-environment jsdom
//
// HomeStatement smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeStatement } from './HomeStatement';

afterEach(cleanup);

describe('HomeStatement', () => {
  it('should render the service statement section without crashing', () => {
    render(<HomeStatement />);
    expect(screen.getByText('N°04 · Service')).toBeDefined(); // D5a:編號隨位置(原 N°05)
    expect(screen.getByText('原廠授權')).toBeDefined();
  });
});
