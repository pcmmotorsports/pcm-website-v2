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

async function renderRoute(email: string, tier: unknown = 'general') {
  getUserMock.mockResolvedValue({
    data: { user: { id: 'user-test', email, user_metadata: { name: '測試會員' } } },
  });
  customerSingleMock.mockResolvedValue({ data: { name: '測試會員', tier }, error: null });
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

describe('/checkout server route · `#873` DB 多一個會員等級', () => {
  // 🔴 這一組守的是一個**量到的**缺陷,不是型別潔癖:
  //    2026-08-24 實測 `components/CheckoutSummaryAside.test.tsx` ⇒ 未知 tier 走進去
  //    `TypeError: schemaTierToDesign: unreachable tier …` **在 render 當下丟出** ⇒ 客人結不了帳。
  //    而 `as MemberTier` 裸 cast **編譯是綠的** ⇒ 只有這一層測得到。
  it('🔴 DB 給一個本版不認得的 tier ⇒ 退成 general(不是 crash、也不是靜默當經銷商)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const element = await renderRoute('member@example.com', 'platinumDealer');
      expect(element.props.memberTier).toBe('general');
      // 🔴 **降級方向對,但它不該安靜**(逐字同 `lib/tier.ts` 的既有拍板)
      //    ⇒ 沒有這一格的話,「退成 general」與「靜靜把經銷會員降級」在畫面上是同一件事。
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain('不認得');
    } finally {
      spy.mockRestore();
    }
  });

  it('🔴 對照組:三個合法 tier 原樣傳下去(證明上面那格不是「一律回 general」)', async () => {
    for (const t of ['general', 'store', 'premiumStore']) {
      const element = await renderRoute('member@example.com', t);
      expect(element.props.memberTier).toBe(t);
    }
  });

  it('🔴 對照組:合法 tier 不得留下那行 log(否則上面那格的 log 斷言是恆真的)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 🔴 **三個值都要跑** —— 只餵 premiumStore 的話,哪天【只有 store 那條路】誤 log,
      //    這一格照樣綠。(code-reviewer nit;而它是「只驗一處/只驗一個值」這個病的第三次。)
      for (const t of ['general', 'store', 'premiumStore']) {
        await renderRoute('member@example.com', t);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
