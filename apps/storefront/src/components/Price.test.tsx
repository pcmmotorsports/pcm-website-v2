// @vitest-environment jsdom
//
// Price smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「三條價格分支(純價 / retail discount / isMember)render 不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Price } from './Price';

afterEach(cleanup);

describe('Price', () => {
  it('should render a plain price without crashing', () => {
    render(<Price price={12800} />);
    expect(screen.getByText('NT$ 12,800')).toBeDefined();
  });

  it('should render the retail discount branch with a struck-through original price', () => {
    render(<Price price={5800} originalPrice={7200} />);
    expect(screen.getByText('NT$ 7,200')).toBeDefined();
    expect(screen.getByText('NT$ 5,800')).toBeDefined();
  });

  it('should render the dealer branch with a tier label', () => {
    render(<Price price={4800} originalPrice={6000} tierLabel="P價" />);
    expect(screen.getByText('P價')).toBeDefined();
  });
});
