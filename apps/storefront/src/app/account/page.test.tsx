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

const { getUserMock, customerSingleMock, walletLedgerMock, redirectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  customerSingleMock: vi.fn(),
  // 真 redirect() 會 throw NEXT_REDIRECT;mock 也必須 throw(理由同 checkout/page.test.tsx)。
  /**
   * 儲值金明細那一發的回傳。預設 = 成功且空(`count: 0`)。
   * 🔴 三種失敗要測得出來:`error` 有值 / `data` 是 null / `count` 是 null。
   */
  // 🔴 **型別要明寫,不能讓它從預設值窄推** —— 預設是 `{ data: [], error: null, count: 0 }`,
  //    推出來的型別會變成 `never[] / null / number` ⇒ 下面三格失敗模式(`data: null`、
  //    `error: {...}`、`count: null`)**連編譯都過不了**,而那不是它們錯,是量具的型別太窄。
  walletLedgerMock: vi.fn<
    () => Promise<{ data: unknown[] | null; error: { message: string } | null; count: number | null }>
  >(async () => ({ data: [], error: null, count: 0 })),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

// 🔴 **這個 mock 現在有【兩條路】** —— `customers` 走 `.eq().single()`,
//    而 `customer_wallet_ledger`(#202 解凍第一片)走 `.eq().order().order().order().limit()`。
//    ⚠️ **上一版只支援前者** ⇒ 加了明細那一發之後,本檔四格全部
//       `TypeError: …eq(...).order is not a function`(對抗審查 must-fix 抓到、我實跑複驗)。
//    📌 **而那四格紅【不是被我的測試抓到的】** —— 我當時只跑了 WalletTab 與 AccountView,
//       沒跑這一支。**「我跑的那些綠」與「動到的都綠」是兩件事。**
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({
      select: () => {
        if (table === 'customer_wallet_ledger') {
          // 鏈式:每一段都回自己,最後 `.limit()` 才吐值 —— 對齊 page.tsx 實際呼叫的形狀。
          const chain = {
            eq: () => chain,
            order: () => chain,
            limit: () => walletLedgerMock(),
          };
          return chain;
        }
        return { eq: () => ({ single: customerSingleMock }) };
      },
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

/* ══ #202 解凍第一片:儲值金明細的三種失敗(對抗審查 must-fix 的守門)══════════ */

describe('/account server route · 🔴 儲值金明細「讀不到」不得變成「沒有交易」', () => {
  async function route() {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-test', email: 'm@example.com', user_metadata: { name: '測試會員' } } },
    });
    customerSingleMock.mockResolvedValue({
      data: { name: '測試會員', phone: '', birthday: null, tier: 'general', wallet_balance: 5000 },
      error: null,
    });
    return AccountRoute();
  }

  it('🔴 前提:成功且真的沒交易 ⇒ 【不】掛失敗旗標(它若不成立,下面三格都沒有判別力)', async () => {
    walletLedgerMock.mockResolvedValue({ data: [], error: null, count: 0 });
    const el = await route();
    expect(el.props.walletEntriesFailed).toBe(false);
    expect(el.props.walletEntries).toEqual([]);
    expect(el.props.walletEntryTotal).toBe(0);
  });

  it('① error 有值 ⇒ 掛失敗旗標', async () => {
    walletLedgerMock.mockResolvedValue({ data: null, error: { message: 'boom' }, count: null });
    expect((await route()).props.walletEntriesFailed).toBe(true);
  });

  it('🔴 ② data 是 null 而 error 也是 null ⇒ 仍然是失敗', async () => {
    // 這一格是對抗審查抓到的那個縫:上一版用 `data ?? []`
    // ⇒ 這組會被吃成「他真的沒交易」, 而畫面會對客人說「尚無交易紀錄」。
    walletLedgerMock.mockResolvedValue({ data: null, error: null, count: 0 });
    const el = await route();
    expect(el.props.walletEntriesFailed).toBe(true);
    expect(el.props.walletEntries).toEqual([]);
  });

  it('🔴 ③ count 沒回來 ⇒ 也是失敗(「共 N 筆」是這個畫面的地基)', async () => {
    // 靜默轉 0 會印出「顯示 20 筆 / 共 0 筆」。理由抄自 SupabaseWalletAdapter.listEntries。
    walletLedgerMock.mockResolvedValue({ data: [], error: null, count: null });
    const el = await route();
    expect(el.props.walletEntriesFailed).toBe(true);
    expect(el.props.walletEntryTotal).toBeNull();
  });

  it('🔴 餘額讀不到而明細成功 ⇒ 餘額掛失敗旗標, 明細照常帶上去', async () => {
    // 兩發獨立查詢, 一發失敗不該把另一發帶走;而餘額退化成 0 卻不說, 就是顯示錯的金額。
    customerSingleMock.mockResolvedValue({ data: null, error: { message: 'PGRST116' } });
    walletLedgerMock.mockResolvedValue({ data: [], error: null, count: 0 });
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-test', email: 'm@example.com', user_metadata: { name: '測試會員' } } },
    });
    const el = await AccountRoute();
    expect(el.props.walletBalanceFailed).toBe(true);
    expect(el.props.walletEntriesFailed).toBe(false);
  });
});
