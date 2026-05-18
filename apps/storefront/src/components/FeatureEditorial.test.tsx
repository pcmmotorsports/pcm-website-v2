// @vitest-environment jsdom
//
// FeatureEditorial smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FeatureEditorial } from './FeatureEditorial';

afterEach(cleanup);

describe('FeatureEditorial', () => {
  it('should render the monthly feature section without crashing', () => {
    render(<FeatureEditorial />);
    expect(screen.getByText('This month · 本月聚焦')).toBeDefined();
    expect(screen.getByText('工藝之鏡')).toBeDefined();
  });
});
