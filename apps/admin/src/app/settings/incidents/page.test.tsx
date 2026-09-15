// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';

const { listRecentIncidents } = vi.hoisted(() => ({ listRecentIncidents: vi.fn() }));

vi.mock('../../../lib/incidents/incident-repository', () => ({ listRecentIncidents }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import IncidentsPage from './page';

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const ROWS = [
  {
    id: '2',
    kind: 'auto_cancel_failed',
    subjectId: ORDER_ID,
    detail: '自動標取消失敗 P0001 某個錯誤',
    createdAt: '2026-09-15T08:00:00+00:00',
    resolvedAt: null,
  },
  {
    id: '1',
    kind: 'line_forward_failed',
    subjectId: null,
    detail: 'http_503 x4 events=abc',
    createdAt: '2026-09-15T07:00:00+00:00',
    resolvedAt: null,
  },
];

async function renderPage(search: { all?: string } = {}) {
  const ui = await IncidentsPage({ searchParams: Promise.resolve(search) });
  return render(ui);
}

describe('P2-7 /settings/incidents:三種狀態長得不一樣', () => {
  beforeEach(() => {
    listRecentIncidents.mockReset();
  });
  afterEach(cleanup);

  it('有資料 ⇒ 中文種類、訂單連結、NULL 訂單印「—」、錯誤全文都在(Sean「都可以看」:不遮)', async () => {
    listRecentIncidents.mockResolvedValue(ROWS);
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('自動取消失敗');
    expect(text).toContain('LINE 轉發失敗');
    expect(text).toContain('自動標取消失敗 P0001 某個錯誤');
    // AdminDataTable 同時畫桌機表格與手機卡片 ⇒ 同一個連結會出現兩次,所以不數個數,改斷言「每一個都指向那張單」。
    const orderLinks = [...container.querySelectorAll('a[href^="/orders/"]')];
    expect(orderLinks.length).toBeGreaterThan(0);
    // line_forward_failed 那一列(subject_id NULL)沒有訂單連結 ⇒ 不會出現第二個 href
    expect(new Set(orderLinks.map((a) => a.getAttribute('href')))).toEqual(new Set([`/orders/${ORDER_ID}`]));
    expect(text).toContain('—');
  });

  it('🔴 沒有資料 ⇒ 空狀態,而且不得出現失敗字樣', async () => {
    listRecentIncidents.mockResolvedValue([]);
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('目前沒有未處理的事故');
    expect(text).not.toContain('載入失敗');
  });

  it('🔴🔴 讀取失敗 ⇒ 失敗字樣,而且不得出現空狀態字樣(讀不到 ≠ 沒有事故)', async () => {
    listRecentIncidents.mockRejectedValue(new Error('42501'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('目前沒有');
    errSpy.mockRestore();
  });

  it('預設只看未處理;?all=1 ⇒ 看全部(openOnly = false)', async () => {
    listRecentIncidents.mockResolvedValue([]);
    await renderPage();
    expect(listRecentIncidents).toHaveBeenLastCalledWith(50, true);
    cleanup();
    await renderPage({ all: '1' });
    expect(listRecentIncidents).toHaveBeenLastCalledWith(50, false);
  });
});
