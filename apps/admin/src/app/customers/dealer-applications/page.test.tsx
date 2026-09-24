// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const load = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../../lib/customers/dealer-application-repository', () => ({
  loadDealerApplications: (f: string) => load(f),
  DEALER_APP_LIST_LIMIT: 200,
}));

import DealerApplicationsPage from './page';

afterEach(() => {
  cleanup();
  load.mockReset();
});

const row = {
  id: '11111111-1111-4111-8111-111111111111', user_id: 'u1', company_name: '〇〇車業', tax_id: '12345678',
  store_name: '小明車行', region: '臺北市', contact_name: '王小明', contact_phone: '0912345678',
  contact_email: 'a@x.tw', note: '', status: 'pending', decided_by: null, decided_at: null, decide_note: '',
  created_at: '2026-09-25T01:00:00Z', updated_at: '2026-09-25T01:00:00Z',
};

describe('後台經銷商申請列表(片 D1)', () => {
  it('預設讀審核中, 列出公司名稱、統編、地區、聯絡人、狀態, 公司名稱連到明細', async () => {
    load.mockResolvedValue({ ok: true, rows: [row] });
    render(await DealerApplicationsPage({ searchParams: Promise.resolve({}) }));
    expect(load).toHaveBeenCalledWith('pending');
    const body = document.body.textContent ?? '';
    for (const t of ['〇〇車業', '12345678', '臺北市', '王小明', '審核中']) expect(body).toContain(t);
    expect(screen.getAllByRole('link', { name: '〇〇車業' })[0]!.getAttribute('href')).toBe(`/customers/dealer-applications/${row.id}`);
  });

  it('🔴 讀取失敗 ⇒ 顯示載入失敗, 不是「目前沒有申請」', async () => {
    load.mockResolvedValue({ ok: false });
    render(await DealerApplicationsPage({ searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('經銷商申請載入失敗');
    expect(body).not.toContain('目前沒有');
  });

  it('沒有資料 ⇒ 說目前沒有這個狀態的申請', async () => {
    load.mockResolvedValue({ ok: true, rows: [] });
    render(await DealerApplicationsPage({ searchParams: Promise.resolve({ status: 'rejected' }) }));
    expect(load).toHaveBeenCalledWith('rejected');
    expect(document.body.textContent ?? '').toContain('目前沒有「已婉拒」的申請。');
  });
});
