// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';

const { listRecentIncidents } = vi.hoisted(() => ({ listRecentIncidents: vi.fn() }));

vi.mock('../../../lib/incidents/incident-repository', () => ({ listRecentIncidents }));
// server action 帶 'use server' 與 server-only 鏈 ⇒ 頁面測試只需要它是一個函式
vi.mock('../../../lib/incidents/incident-actions', () => ({
  resolveIncidentAction: vi.fn(),
  reopenIncidentAction: vi.fn(),
}));
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
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: '1',
    kind: 'line_forward_failed',
    subjectId: null,
    detail: 'http_503 x4 events=abc',
    createdAt: '2026-09-15T07:00:00+00:00',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
];
const RESOLVED = {
  ...ROWS[0]!,
  id: '3',
  resolvedAt: '2026-09-15T09:00:00+00:00',
  resolvedBy: 'amy',
  resolutionNote: '已打給客人',
};

async function renderPage(search: { all?: string; r?: string } = {}) {
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

describe('標記已處理 / 取消已處理(plan 2026-09-15-incident-mark-resolved §4-B)', () => {
  beforeEach(() => {
    listRecentIncidents.mockReset();
  });
  afterEach(cleanup);

  it('未處理那一列:有「標記已處理」表單,說明欄選填(不是 required),帶 incident_id', async () => {
    listRecentIncidents.mockResolvedValue([ROWS[0]]);
    const { container } = await renderPage();
    expect(container.textContent).toContain('標記已處理');
    expect(container.textContent).not.toContain('取消已處理');
    const note = container.querySelector('input[name="note"]') as HTMLInputElement;
    expect(note).not.toBeNull();
    expect(note.required).toBe(false);
    expect(note.maxLength).toBe(500);
    expect((container.querySelector('input[name="incident_id"]') as HTMLInputElement).value).toBe('2');
  });

  it('🔴 已處理那一列:印「已處理 · 誰」、處理說明;「取消已處理」的原因欄 required(Sean Q3 要寫原因)', async () => {
    listRecentIncidents.mockResolvedValue([RESOLVED]);
    const { container } = await renderPage({ all: '1' });
    const text = container.textContent ?? '';
    expect(text).toContain('已處理 · amy');
    expect(text).toContain('處理說明:已打給客人');
    expect(text).toContain('取消已處理');
    const reason = container.querySelector('input[name="reason"]') as HTMLInputElement;
    expect(reason).not.toBeNull();
    expect(reason.required).toBe(true);
    expect(container.querySelector('input[name="note"]')).toBeNull();
  });

  it('🔴 「全部」檢視的表單帶 view=all;「未處理」檢視不帶(按完導回同一個檢視)', async () => {
    listRecentIncidents.mockResolvedValue([ROWS[0]]);
    const { container } = await renderPage({ all: '1' });
    const views = [...container.querySelectorAll('input[name="view"]')].map((i) => (i as HTMLInputElement).value);
    expect(views.length).toBeGreaterThan(0);
    expect(new Set(views)).toEqual(new Set(['all']));
    cleanup();
    const again = await renderPage();
    expect(again.container.querySelector('input[name="view"]')).toBeNull();
  });

  it('?r=<碼> ⇒ 顯示那一句;不認得的碼(含原型鏈字)⇒ 什麼都不顯示', async () => {
    listRecentIncidents.mockResolvedValue([]);
    const { container } = await renderPage({ r: 'superseded' });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('系統在這一筆之後已經又記了同一件事的新紀錄');
    cleanup();
    const unknown = await renderPage({ r: '__proto__' });
    expect(unknown.container.querySelector('[role="status"]')).toBeNull();
  });
});
