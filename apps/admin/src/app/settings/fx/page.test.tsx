// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import type { FxRateRow } from '@/lib/fx/fx-rate-view';

const state = vi.hoisted(() => ({
  rows: [] as FxRateRow[],
  loadError: null as Error | null,
  actorId: 'boss' as string | null,
  staff: [
    { id: 'boss', label: '老闆', is_manager: true, is_active: true },
    { id: 'clerk', label: '員工', is_manager: false, is_active: true },
  ],
}));

vi.mock('@/lib/fx/fx-rate-repository', () => ({
  listFxRateRows: vi.fn(async () => { if (state.loadError) throw state.loadError; return state.rows; }),
}));
vi.mock('@/lib/fx/fx-rate-actions', () => ({ setFxRateAction: vi.fn() }));
vi.mock('@/lib/session/actor', () => ({ getSessionActorIdWithSource: vi.fn(async () => ({ id: state.actorId, source: 'cookie' })) }));
vi.mock('@/lib/staff-repository', () => ({ listStaffRows: vi.fn(async () => state.staff) }));

import FxRateSettingsPage from './page';

async function renderPage(params: Record<string, string> = {}) {
  const ui = await FxRateSettingsPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

describe('/settings/fx', () => {
  beforeEach(() => {
    state.rows = [
      { id: 2, currency_code: 'USD', rate_to_twd: '31', effective_from: '2026-09-10T00:00:00Z', created_by: 'boss', created_at: '2026-09-10T00:00:00Z' },
      { id: 1, currency_code: 'USD', rate_to_twd: '32.5', effective_from: '2026-09-01T00:00:00Z', created_by: 'boss', created_at: '2026-09-01T00:00:00Z' },
    ];
    state.loadError = null;
    state.actorId = 'boss';
  });
  afterEach(() => cleanup());

  it('老闆:十列、USD 現在 31、有輸入格;TWD 固定 1 沒有輸入格', async () => {
    const { getByTestId, getAllByRole } = await renderPage();
    expect(getAllByRole('row').filter((r) => r.getAttribute('data-testid')?.startsWith('fx-row-'))).toHaveLength(10);
    const usd = within(getByTestId('fx-row-USD'));
    expect(usd.getByText('31')).toBeTruthy();
    expect(usd.getByLabelText('USD 新匯率')).toBeTruthy();
    const twd = within(getByTestId('fx-row-TWD'));
    expect(twd.getByText('固定 1,不可改')).toBeTruthy();
    expect(twd.queryByRole('textbox')).toBeNull();
    // 沒設過的
    expect(within(getByTestId('fx-row-EUR')).getByText('還沒設')).toBeTruthy();
  });

  it('員工:只能看,零輸入格,有那句話', async () => {
    state.actorId = 'clerk';
    const { queryAllByRole, getByRole } = await renderPage();
    expect(queryAllByRole('textbox')).toHaveLength(0);
    expect(getByRole('status').textContent).toContain('只有管理者可以改匯率');
  });

  it('讀不到:錯誤塊,不是「還沒設」', async () => {
    state.loadError = new Error('boom');
    const { getByText, queryByText } = await renderPage();
    expect(getByText(/無法載入匯率資料/)).toBeTruthy();
    expect(queryByText('還沒設')).toBeNull();
  });

  it('?r=saved 顯示結果條;未知碼不顯示', async () => {
    const a = await renderPage({ r: 'saved' });
    expect(a.getByText(/匯率已存成新的一列/)).toBeTruthy();
    cleanup();
    const b = await renderPage({ r: 'bogus' });
    expect(b.queryByText(/匯率已存成新的一列/)).toBeNull();
  });
});
