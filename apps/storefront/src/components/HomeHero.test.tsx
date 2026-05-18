// @vitest-environment jsdom
//
// HomeHero smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeHero } from './HomeHero';

afterEach(cleanup);

describe('HomeHero', () => {
  it('should render the hero section without crashing', () => {
    render(<HomeHero />);
    expect(screen.getByText('2026 SPRING EDITORIAL')).toBeDefined();
    expect(screen.getByText('Discover the collection')).toBeDefined();
  });
});
