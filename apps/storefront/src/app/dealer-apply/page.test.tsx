// @vitest-environment jsdom
// 片 C:經銷商申請頁「已開通」狀態要有一顆前往經銷站的按鈕(計畫 §9.4)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const { tier, mineRows } = vi.hoisted(() => ({
  tier: { value: 'store' },
  mineRows: { value: [] as Array<Record<string, unknown>> },
}));
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({
    user: { id: 'u1', email: 'a@x.tw' },
    supabase: { rpc: async () => ({ data: mineRows.value, error: null }) },
  }),
}));
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTierStrict: async () => ({ ok: true, tier: tier.value }) }));
const { formProps } = vi.hoisted(() => ({ formProps: [] as Array<Record<string, unknown>> }));
vi.mock('@/components/dealer-apply/DealerApplyForm', () => ({
  DealerApplyForm: (p: Record<string, unknown>) => {
    formProps.push(p);
    return null;
  },
}));
vi.mock('@/components/Header', () => ({
  Header: ({ currentPage }: { currentPage?: string }) => <div data-stub="site-header" data-page={currentPage} />,
}));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-stub="site-footer" /> }));

import DealerApplyPage from './page';

afterEach(cleanup);

describe('經銷商申請頁(片 C)', () => {
  it('🔴 已經是經銷(車行)⇒ 顯示已開通, 按鈕「前往 b2b.pcmmotorsports.com」連到經銷站登入頁', async () => {
    tier.value = 'store';
    render(await DealerApplyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: '您的經銷商資格已開通' })).toBeTruthy();
    const link = screen.getByRole('link', { name: '前往 b2b.pcmmotorsports.com' });
    expect(link.getAttribute('href')).toBe('https://b2b.pcmmotorsports.com/login');
  });

  it('一般會員、沒申請過 ⇒ 申請表, 沒有前往經銷站的按鈕', async () => {
    tier.value = 'general';
    render(await DealerApplyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: '申請成為 PCM 經銷商' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '前往 b2b.pcmmotorsports.com' })).toBeNull();
  });

  it('🔴 申請表拿到的是【登入帳號】的 Email(2026-09-25:Sean 用 A 帳號申請、聯絡信箱填 B, 核准後升級的是 A)', async () => {
    tier.value = 'general';
    formProps.length = 0;
    render(await DealerApplyPage({ searchParams: Promise.resolve({}) }));
    expect(formProps.at(-1)?.accountEmail).toBe('a@x.tw');
  });

  it('🔴 Q9 甲:核准過、但現在是一般會員 ⇒ 標題「您的經銷資格目前沒有啟用」, 附重新提出申請的表單(帶入上次資料)', async () => {
    tier.value = 'general';
    mineRows.value = [{
      id: 'a1', company_name: '〇〇車業', tax_id: '12345678', store_name: '', region: '臺北市',
      contact_name: '王', contact_phone: '0912345678', contact_email: 'b@x.tw', note: '',
      status: 'approved', decided_at: '2026-09-25T01:00:00Z',
      created_at: '2026-09-24T01:00:00Z', updated_at: '2026-09-24T01:00:00Z',
    }];
    formProps.length = 0;
    render(await DealerApplyPage({ searchParams: Promise.resolve({}) }));
    mineRows.value = [];
    expect(screen.getByRole('heading', { name: '您的經銷資格目前沒有啟用' })).toBeTruthy();
    const p = formProps.at(-1);
    expect(p?.submitLabel).toBe('重新提出申請');
    expect((p?.initial as { companyName: string }).companyName).toBe('〇〇車業');
    expect(p?.editId).toBeUndefined();
    expect(p?.accountEmail).toBe('a@x.tw');
    expect(screen.getByRole('link', { name: '回到會員中心' }).getAttribute('href')).toBe('/account');
  });

  // Sean 2026-09-25 截圖:這一頁沒有上方選單和頁尾, 回不到網站。
  it.each([
    ['一般會員(申請表)', 'general'],
    ['已開通經銷', 'store'],
  ])('🔴 %s ⇒ 有網站上方選單、頁尾, 以及「回到會員中心」連到 /account', async (_label, t) => {
    tier.value = t;
    const { container } = render(await DealerApplyPage({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector('[data-stub="site-header"]')?.getAttribute('data-page')).toBe('account');
    expect(container.querySelector('[data-stub="site-footer"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: '回到會員中心' }).getAttribute('href')).toBe('/account');
  });
});
