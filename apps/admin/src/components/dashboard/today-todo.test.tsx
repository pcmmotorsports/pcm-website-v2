// @vitest-environment jsdom
// Sean 2026-09-27 G1 甲:首頁「今天要做的事」加一格「改價待審」。
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/order-repository', () => ({ getAdminOrderRepository: () => ({}) }));
import { cleanup, render, screen } from '@testing-library/react';
import { TodayTodo } from './today-todo';
import { unreadableTodoLists } from '../../lib/dashboard/today-todo-read';

afterEach(cleanup);

describe('改價待審那一格', () => {
  it('顯示待審件數, 點進去是改價待審清單', () => {
    render(<TodayTodo summary={null} lists={unreadableTodoLists()} amountRequests={{ count: 3, truncated: false }} />);
    const card = screen.getByRole('link', { name: /改價待審 3 筆/ }) as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe('/orders/amount-requests');
  });

  it('讀不到:顯示讀取失敗, 不印成 0', () => {
    render(<TodayTodo summary={null} lists={unreadableTodoLists()} amountRequests={null} />);
    expect(screen.getByRole('link', { name: /改價待審 讀取失敗/ })).toBeTruthy();
  });

  it('超過上限:數字黏 + 表示實際可能更多', () => {
    render(<TodayTodo summary={null} lists={unreadableTodoLists()} amountRequests={{ count: 200, truncated: true }} />);
    expect(screen.getByRole('link', { name: /改價待審/ }).textContent).toContain('200+');
  });
});
