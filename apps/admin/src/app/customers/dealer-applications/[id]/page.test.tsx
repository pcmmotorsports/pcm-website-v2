// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const load = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/customers/dealer-application-repository', () => ({
  loadDealerApplication: (id: string) => load(id),
}));
const staff = vi.fn(async () => [{ id: 'staff-1', label: '阿明' }]);
vi.mock('../../../../lib/staff', () => ({ listAllStaff: () => staff() }));
vi.mock('../../../../lib/customers/dealer-application-actions', () => ({ decideDealerApplicationAction: vi.fn() }));

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
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    for (const t of ['〇〇車業', '12345678', '小明車行', '臺北市', '王小明', '0912345678', 'owner@x.tw', '主要賣 Rizoma', '審核中', '會員']) {
      expect(body).toContain(t);
    }
  });

  it('等級是 store ⇒ 顯示 Sean 定的名稱「車行」', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: { tier: 'store', created_at: '2026-09-01T00:00:00Z', email: 'l@x.tw', name: null } } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(document.body.textContent ?? '').toContain('車行');
  });

  it('已婉拒 ⇒ 顯示婉拒原因與決定的人(員工看得到)', async () => {
    load.mockResolvedValue({
      ok: true,
      detail: { app: { ...app, status: 'rejected', decided_by: 'staff-1', decided_at: '2026-09-26T00:00:00Z', decide_note: '同地區已有經銷商' }, customer: null },
    });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('同地區已有經銷商');
    expect(body).toContain('阿明');
    expect(body).not.toContain('staff-1');
  });

  it('找不到 ⇒ 說找不到這筆申請;編號格式不對 ⇒ 不去查', async () => {
    load.mockResolvedValue({ ok: true, detail: null });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(document.body.textContent ?? '').toContain('找不到這筆經銷商申請');
    cleanup();
    load.mockReset();
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id: 'abc' }), searchParams: Promise.resolve({}) }));
    expect(load).not.toHaveBeenCalled();
    expect(document.body.textContent ?? '').toContain('找不到這筆經銷商申請');
  });

  it('🔴 讀取失敗 ⇒ 載入失敗, 不是「找不到」', async () => {
    load.mockResolvedValue({ ok: false });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(document.body.textContent ?? '').toContain('經銷商申請載入失敗');
  });

  it('審核中 ⇒ 有核准 / 婉拒按鈕;讀不到帳號 ⇒ 不給按鈕並說明', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: { tier: 'general', created_at: '2026-09-01T00:00:00Z', email: 'l@x.tw', name: null } } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(document.body.textContent ?? '').toContain('核准申請');
    cleanup();
    load.mockResolvedValue({ ok: true, detail: { app, customer: null } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('核准申請');
    expect(body).toContain('暫時不能審核');
  });

  it('🔴 結果不明 ⇒ 說「無法確認是否已經儲存」, 不寫成失敗;亂填的 r 不顯示', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: null } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ r: 'unknown' }) }));
    expect(document.body.textContent ?? '').toContain('無法確認是否已經儲存');
    cleanup();
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ r: 'toString' }) }));
    expect(document.querySelector('[role=status]')).toBeNull();
  });

  it('🔴 網址寫 approved 而申請還在審核中 ⇒ 不顯示「已核准」;找不到申請 ⇒ 也不顯示', async () => {
    load.mockResolvedValue({ ok: true, detail: { app, customer: null } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ r: 'approved' }) }));
    expect(document.body.textContent ?? '').not.toContain('已核准');
    cleanup();
    load.mockResolvedValue({ ok: true, detail: { app: { ...app, status: 'approved' }, customer: null } });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ r: 'approved' }) }));
    expect(document.body.textContent ?? '').toContain('已核准。');
    cleanup();
    load.mockResolvedValue({ ok: true, detail: null });
    render(await DealerApplicationDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ r: 'approved' }) }));
    expect(document.querySelector('[role=status]')).toBeNull();
  });
});
