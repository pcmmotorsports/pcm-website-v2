// account/page.test.tsx — `#873`:會員中心的 tier 邊界解析
//
// 🔴 **這支檔存在的理由,是一句我差點沒寫的話。**
//    `account/page.tsx` 與 `checkout/page.tsx` 的修法是【同樣的兩行】,而我原本只驗了 checkout。
//    ⇒ 「反正一樣」這句話,在【一樣】與【不一樣】兩個世界長得完全相同 ——
//      它們若真的一樣, 驗第二處是零成本;它們若不一樣, **那正是唯一會出事的地方**。
//
// 📏 缺陷是量到的(2026-08-24,`components/CheckoutSummaryAside.test.tsx`):
//    未知 tier 走進 `TierBadge` ⇒ `TypeError: schemaTierToDesign: unreachable tier …` 在 render 當下丟出。
//    而 account 這條路一樣走得到那裡:`AccountView` → `tabs/OverviewTab.tsx:25` 也 render `TierBadge`。

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getUserMock, customerSingleMock, redirectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  customerSingleMock: vi.fn(),
  // 真 redirect() 會 throw NEXT_REDIRECT;mock 也必須 throw(理由同 checkout/page.test.tsx)。
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
  getAddressRepo: async () => ({ listByCustomer: async () => [] }),
  getVehicleRepo: async () => ({ listByCustomer: async () => [] }),
  // 🔴 `listSummariesByCustomer` 不是 `listByCustomer` —— 抓到這個名字寫錯的是下面第 4 格
  //    (「合法 tier 不得留下那行 log」)。少了那一格,這個 mock 缺口會讓第 2 格的
  //    「有 log」被【另一個錯誤的 log】滿足 ⇒ 假綠。
  getOrderRepo: async () => ({ listSummariesByCustomer: async () => [] }),
  getFavoritesRepo: async () => ({ listByCustomer: async () => [] }),
}));

vi.mock('@/lib/products', () => ({
  fetchFeaturedProducts: async () => [],
  fetchVehicleTaxonomy: async () => [],
}));

import AccountRoute from './page';

afterEach(() => {
  vi.clearAllMocks();
});

async function renderRoute(tier: unknown) {
  getUserMock.mockResolvedValue({
    data: { user: { id: 'user-test', email: 'member@example.com', user_metadata: { name: '測試會員' } } },
  });
  customerSingleMock.mockResolvedValue({
    data: { name: '測試會員', phone: '', birthday: null, tier, wallet_balance: 0 },
    error: null,
  });
  return AccountRoute();
}

describe('/account server route · `#873` DB 多一個會員等級', () => {
  it('🔴 前提:這支路由在合法 tier 下真的跑得完(它若不成立,下面每一格都沒有判別力)', async () => {
    const element = await renderRoute('general');
    expect(element.props.stats.tier).toBe('general');
  });

  it('🔴 DB 給一個本版不認得的 tier ⇒ 退成 general(不是 crash、也不是靜默當經銷商)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const element = await renderRoute('platinumDealer');
      expect(element.props.stats.tier).toBe('general');
      // 🔴 降級方向對,但它不該安靜(逐字同 `lib/tier.ts` 的既有拍板)。
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain('不認得');
    } finally {
      spy.mockRestore();
    }
  });

  it('🔴 對照組:三個合法 tier 原樣傳下去(擋「一律回 general」)', async () => {
    for (const t of ['general', 'store', 'premiumStore']) {
      const element = await renderRoute(t);
      expect(element.props.stats.tier).toBe(t);
    }
  });

  it('🔴 對照組:合法 tier 不得留下那行 log(否則上面那格的 log 斷言是恆真的)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 🔴 **三個值都要跑** —— 只餵 premiumStore 的話,哪天【只有 store 那條路】誤 log,
      //    這一格照樣綠。(code-reviewer nit;而它是「只驗一處/只驗一個值」這個病的第三次。)
      for (const t of ['general', 'store', 'premiumStore']) {
        await renderRoute(t);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
