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

describe('待尾款那一格(Sean 2026-09-30 批三格;主視窗 Q2 甲)', () => {
  it('排在「待收款(匯款)」後面, 數字與連結照 lists.partiallyPaid', () => {
    const lists = unreadableTodoLists(new Date('2026-09-13T04:00:00Z'));
    lists.partiallyPaid = { ...lists.partiallyPaid, count: 2 };
    render(<TodayTodo summary={null} lists={lists} amountRequests={null} />);
    const card = screen.getByRole('link', { name: /待尾款 2 筆/ }) as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe(
      '/orders?payment_status=partiallyPaid&pending=1&date_from=2026-03-13&date_to=2026-09-13&todo=partial-paid',
    );
    const labels = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(labels.indexOf('待尾款')).toBe(labels.indexOf('待收款(匯款)') + 1);
  });

  it('讀不到:顯示讀取失敗, 不印成 0', () => {
    render(<TodayTodo summary={null} lists={unreadableTodoLists()} amountRequests={null} />);
    expect(screen.getByRole('link', { name: /待尾款 讀取失敗/ })).toBeTruthy();
  });
});

describe('兩排:錢一排、貨一排(plan §2-1;2026-09-30)', () => {
  it('第一排 = 新單 / 待收款(匯款) / 待尾款 / 退款待處理 / 改價待審;第二排 = 待訂貨 / 有貨可先出 / 到貨待出貨', () => {
    render(<TodayTodo summary={null} lists={unreadableTodoLists()} amountRequests={null} />);
    const rows = [...document.querySelectorAll('[data-testid="today-todo"] [data-todo-row]')];
    expect(rows.map((r) => r.getAttribute('data-todo-row'))).toEqual(['money', 'goods']);
    const labels = rows.map((r) => [...r.querySelectorAll('h4')].map((h) => h.textContent));
    expect(labels).toEqual([
      ['新單', '待收款(匯款)', '待尾款', '退款待處理', '改價待審'],
      ['待訂貨', '有貨可先出', '到貨待出貨'],
    ]);
  });
});
