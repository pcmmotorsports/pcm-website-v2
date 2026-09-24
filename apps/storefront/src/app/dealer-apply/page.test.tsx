// @vitest-environment jsdom
// 片 C:經銷商申請頁「已開通」狀態要有一顆前往經銷站的按鈕(計畫 §9.4)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const { tier } = vi.hoisted(() => ({ tier: { value: 'store' } }));
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({
    user: { id: 'u1', email: 'a@x.tw' },
    supabase: { rpc: async () => ({ data: [], error: null }) },
  }),
}));
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTierStrict: async () => ({ ok: true, tier: tier.value }) }));
vi.mock('@/components/dealer-apply/DealerApplyForm', () => ({ DealerApplyForm: () => null }));

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
});
