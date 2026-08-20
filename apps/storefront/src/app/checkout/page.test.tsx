import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getUserMock, customerSingleMock, listByCustomerMock, redirectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  customerSingleMock: vi.fn(),
  listByCustomerMock: vi.fn(),
  // 真 redirect() 會 throw NEXT_REDIRECT;mock 也必須 throw,否則後面的 user.email 會先炸、測到的是別的東西。
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({ single: customerSingleMock }),
      }),
    }),
  }),
}));

vi.mock('@/lib/auth/composition', () => ({
  getAddressRepo: async () => ({ listByCustomer: listByCustomerMock }),
}));

import CheckoutRoute from './page';

const ORIGINAL = process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL === undefined) delete process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;
  else process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = ORIGINAL;
});

async function renderRoute(email: string) {
  getUserMock.mockResolvedValue({
    data: { user: { id: 'user-test', email, user_metadata: { name: '測試會員' } } },
  });
  customerSingleMock.mockResolvedValue({ data: { name: '測試會員', tier: 'general' }, error: null });
  listByCustomerMock.mockResolvedValue([]);
  return CheckoutRoute();
}

describe('/checkout server route 登入守門', () => {
  it('未登入 → redirect(/login?next=/checkout),不是裸 /login', async () => {
    // 🔴 #190:少了 next,客人登入完落在首頁、整條結帳要重走一次(2026-08-21 W11 正式站實測)。
    //    逐字全等 —— 寫成 toContain('/login') 的話,next 掉光時照樣綠 = 恆真。
    getUserMock.mockResolvedValue({ data: { user: null } });
    const expected = `/login?next=${encodeURIComponent('/checkout')}`;
    await expect(CheckoutRoute()).rejects.toThrow(`NEXT_REDIRECT:${expected}`);
    expect(redirectMock).toHaveBeenCalledWith(expected);
  });
});

describe('/checkout server route Email gate', () => {
  it('flag off 時不預填，也明確把 false 傳給 client', async () => {
    delete process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;
    const element = await renderRoute('member@example.com');

    expect(element.props.notificationEmailEnabled).toBe(false);
    expect(element.props.initialNotificationEmail).toBe('');
  });

  it('flag on 時只把 canonical 真 Email 預填給 client', async () => {
    process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = 'true';
    const element = await renderRoute('Member@EXAMPLE.COM');

    expect(element.props.notificationEmailEnabled).toBe(true);
    expect(element.props.initialNotificationEmail).toBe('Member@example.com');
  });

  it('flag on 也不把 LINE 合成 Email 顯示給 client', async () => {
    process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = 'true';
    const element = await renderRoute('line_test@line.pcmmotorsports.local');

    expect(element.props.notificationEmailEnabled).toBe(true);
    expect(element.props.initialNotificationEmail).toBe('');
  });
});
