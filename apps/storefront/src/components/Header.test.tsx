// @vitest-environment jsdom
//
// Header smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「desktop / mobile 兩變體 render 不報錯」。
// useRouter 走 per-file vi.mock;Header useEffect 用 window.matchMedia、
// jsdom 無此 API → beforeAll 補 polyfill stub。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { Header } from './Header';

beforeAll(() => {
  // jsdom 不實作 matchMedia、Header useEffect 會呼叫 → 補最小 stub
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(cleanup);

describe('Header', () => {
  it('should render the desktop header without crashing', () => {
    render(<Header isMobile={false} />);
    expect(screen.getByText('PCM MOTORSPORTS')).toBeDefined();
    expect(screen.getByText('商品目錄')).toBeDefined();
  });

  it('should render the mobile header without crashing', () => {
    render(<Header isMobile />);
    expect(screen.getByText('PCM')).toBeDefined();
    expect(screen.getByLabelText('cart')).toBeDefined();
  });
});
