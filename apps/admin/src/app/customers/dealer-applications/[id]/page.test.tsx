// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const load = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/customers/dealer-application-repository', () => ({
  loadDealerApplication: (id: string) => load(id),
}));

import DealerApplicationDetailPage from './page';

afterEach(() => {
  cleanup();
  load.mockReset();
});

const id = '11111111-1111-4111-8111-111111111111';
const app = {
  id, user_id: 'u1', company_name: '〇〇車業', tax_id: '12345678', store_name: '小明車行', region: '臺北市',
  contact_name: '王小明', contact_phone: '0912345678', contact_email: 'owner@x.tw', note: '主要賣 Rizoma',
  status: 'pending', decided_by: null, decided_at: null, decide_note: '',
  created_at: '2026-09-25T01:00:00Z', updated_at: '2026-09-25T01:00:00Z',
};

describe('後台經銷商申請明細(片 D1)', () => {
  it('八個欄位全部顯示, 加上帳號現在的等級(後台名稱)與註冊日期', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: { tier: 'general', created_at: '2026-09-01T00:00:00Z', email: 'login@x.tw', name: '王' } } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }) }));
    const body = document.body.textContent ?? '';
    for (const t of ['〇〇車業', '12345678', '小明車行', '臺北市', '王小明', '0912345678', 'owner@x.tw', '主要賣 Rizoma', '審核中', '會員']) {
      expect(body).toContain(t);
    }
  });

  it('等級是 store ⇒ 顯示 Sean 定的名稱「車行」', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: { tier: 'store', created_at: '2026-09-01T00:00:00Z', email: 'l@x.tw', name: null } } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }) }));
    expect(document.body.textContent ?? '').toContain('車行');
  });

  it('已婉拒 ⇒ 顯示婉拒原因與決定的人(員工看得到)', async () => {
    load.mockResolvedValue({
      ok: true,
      detail: { app: { ...app, status: 'rejected', decided_by: '阿明', decided_at: '2026-09-26T00:00:00Z', decide_note: '同地區已有經銷商' }, customer: null },
    });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }) }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('同地區已有經銷商');
    expect(body).toContain('阿明');
  });

  it('找不到 ⇒ 說找不到這筆申請;編號格式不對 ⇒ 不去查', async () => {
    load.mockResolvedValue({ ok: true, detail: null });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }) }));
    expect(document.body.textContent ?? '').toContain('找不到這筆經銷商申請');
    cleanup();
    load.mockReset();
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id: 'abc' }) }));
    expect(load).not.toHaveBeenCalled();
    expect(document.body.textContent ?? '').toContain('找不到這筆經銷商申請');
  });

  it('🔴 讀取失敗 ⇒ 載入失敗, 不是「找不到」', async () => {
    load.mockResolvedValue({ ok: false });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }) }));
    expect(document.body.textContent ?? '').toContain('經銷商申請載入失敗');
  });
});
