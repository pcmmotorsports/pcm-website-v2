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

const { getUserMock, customerSingleMock, walletLedgerMock, redirectMock, walletQuery } = vi.hoisted(() => ({
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
  /**
   * 🔴 **這一發查詢【真的帶了什麼參數】的記錄器。**
   *
   * 上一版的鏈式 mock 每一段都 `() => chain` —— **實參被丟掉**
   * ⇒ 拿掉 `count: 'exact'` / 拿掉 `.eq('customer_user_id', …)` / 把 `.limit(20)` 改成 2000,
   *   **四件都不會紅**。而那四件正是上一輪對抗審查 must-fix 的產物
   *   ⇒ **守門守不住自己**(code-reviewer R1、2026-08-26 記在 `c1aef746` commit body)。
   * ⇒ 每一段把實參收下來,下面 `查詢參數` 那個 describe 逐格斷言。
   */
  walletQuery: {
    select: [] as unknown[][],
    eq: [] as unknown[][],
    order: [] as unknown[][],
    limit: [] as unknown[][],
  },
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
      select: (...selectArgs: unknown[]) => {
        if (table === 'customer_wallet_ledger') {
          // 鏈式:每一段都回自己,最後 `.limit()` 才吐值 —— 對齊 page.tsx 實際呼叫的形狀。
          // 🔴 **而每一段都把實參收進 `walletQuery`** —— 見它的 docstring:丟掉實參的 mock
          //    對「參數被拿掉了」與「參數還在」印同一個綠。
          walletQuery.select.push(selectArgs);
          const chain = {
            eq: (...a: unknown[]) => {
              walletQuery.eq.push(a);
              return chain;
            },
            order: (...a: unknown[]) => {
              walletQuery.order.push(a);
              return chain;
            },
            limit: (...a: unknown[]) => {
              walletQuery.limit.push(a);
              return walletLedgerMock();
            },
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
  // `vi.clearAllMocks()` 清得到 vi.fn(),**清不到純物件** ⇒ 不清的話跨格累積、筆數斷言全錯。
  walletQuery.select.length = 0;
  walletQuery.eq.length = 0;
  walletQuery.order.length = 0;
  walletQuery.limit.length = 0;
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

/* ══ 🔴 這一發查詢【真的帶著】那四個 must-fix 的參數 ═══════════════════════════
 *
 * 上面那個 describe 驗的是【回傳怎麼被處理】—— 它把查詢本身當成黑箱。
 * ⇒ 拿掉 `count: 'exact'`(總筆數變成當頁筆數)、拿掉 `.eq('customer_user_id', …)`
 *   (**別人的明細會出現在這個客人的畫面上**)、把 `.limit(20)` 改成 2000
 *   (超過 PostgREST `db-max-rows` 會被靜默截斷),上面每一格照樣全綠。
 * 📌 **那四件正是上一輪 must-fix 的產物** ⇒ 守門守不住自己。
 * ⇒ 本 describe 對【送出去的參數】斷言,而不是對回傳。
 * ══════════════════════════════════════════════════════════════════════════ */

describe('/account server route · 🔴 儲值金那一發查詢送出去的參數', () => {
  /** 三筆真 row(欄位齊、含 signed 負數與 `related_order_id: null` 兩種邊界)。 */
  const ROWS = [
    {
      id: 'w-3',
      customer_user_id: 'user-test',
      entry_date: '2026-08-20',
      entry_type: 'use',
      amount: -1200,
      note: '結帳折抵',
      related_order_id: 'ord-9',
      created_at: '2026-08-20T10:00:00Z',
    },
    {
      id: 'w-2',
      customer_user_id: 'user-test',
      entry_date: '2026-08-10',
      entry_type: 'refund',
      amount: 300,
      note: '退款',
      related_order_id: null,
      created_at: '2026-08-10T10:00:00Z',
    },
    {
      id: 'w-1',
      customer_user_id: 'user-test',
      entry_date: '2026-08-01',
      entry_type: 'deposit',
      amount: 5000,
      note: '首次儲值',
      related_order_id: null,
      created_at: '2026-08-01T10:00:00Z',
    },
  ];

  async function route() {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-test', email: 'm@example.com', user_metadata: { name: '測試會員' } } },
    });
    customerSingleMock.mockResolvedValue({
      data: { name: '測試會員', phone: '', birthday: null, tier: 'general', wallet_balance: 4100 },
      error: null,
    });
    walletLedgerMock.mockResolvedValue({ data: ROWS, error: null, count: 57 });
    return AccountRoute();
  }

  it('🔴 前提:記錄器真的收到了那一發(它若是空的,下面每一格都是【對空陣列斷言】= 恆真)', async () => {
    await route();
    expect(walletQuery.select).toHaveLength(1);
    expect(walletQuery.limit).toHaveLength(1);
  });

  it('🔴 `count: \'exact\'` 有送出去(沒有它,「共 N 筆」會是【這一頁的筆數】假扮成總數)', async () => {
    await route();
    expect(walletQuery.select[0]?.[1]).toEqual({ count: 'exact' });
  });

  it('🔴🔴 有 `.eq(\'customer_user_id\', user.id)`(沒有它 = 別人的明細出現在這個客人畫面上)', async () => {
    await route();
    expect(walletQuery.eq).toEqual([['customer_user_id', 'user-test']]);
    // 🔴 用 `toEqual` 整個陣列而不是 `toContainEqual` —— 後者對**多送一個 `.eq()`** 失明
    //    (誤加篩選、或把別的查詢的條件貼過來),而多一個篩選會讓客人少看到自己的交易。
  });

  it('🔴 `.select()` 的第一個實參 —— 欄位清單逐欄都在(mapper 讀得到的那八欄)', async () => {
    // 🔴 **這一格是 R1 抓到的那一半**:記錄器【收下了】欄位清單而沒有任何一格斷言它
    //    ⇒ 把 `.select('id, …, created_at', …)` 改成 `.select('*', …)`,或砍掉其中一欄,
    //      **本檔全部 15 格照樣綠**(mapper 那格餵的是 mock 的完整 ROWS,與真正送出去的清單無關)。
    //    📌 **一個收下了證據而沒有人去讀它的量具,與沒有那個量具是同一個東西。**
    await route();
    const columns = String(walletQuery.select[0]?.[0])
      .split(',')
      .map((c) => c.trim());
    expect(columns).toEqual([
      'id',
      'customer_user_id',
      'entry_date',
      'entry_type',
      'amount',
      'note',
      'related_order_id',
      'created_at',
    ]);
  });

  it('🔴 `.limit()` 送的是 20,而且【嚴格小於】PostgREST 的 db-max-rows 1000', async () => {
    // 嚴格小於的理由見 `docs/patterns/pagination-loop-review.md` 第一條:
    // 等於上限時分不出「剛好這麼多」與「被截斷了」。
    await route();
    expect(walletQuery.limit[0]?.[0]).toBe(20);
    expect(walletQuery.limit[0]?.[0] as number).toBeLessThan(1000);
  });

  it('🔴 排序三段都在、而且最後一段是唯一鍵 `id`(同分那幾筆的順序才定義得出來)', async () => {
    await route();
    expect(walletQuery.order).toEqual([
      ['entry_date', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('🔴 mapper 真的接對欄位(接錯只會讓金額或日期變成別的,畫面照樣顯示得出東西)', async () => {
    const el = await route();
    expect(el.props.walletEntryTotal).toBe(57);
    expect(el.props.walletEntries).toEqual([
      {
        id: 'w-3',
        customerUserId: 'user-test',
        entryDate: '2026-08-20',
        entryType: 'use',
        amount: -1200,
        note: '結帳折抵',
        relatedOrderId: 'ord-9',
        createdAt: '2026-08-20T10:00:00Z',
      },
      {
        id: 'w-2',
        customerUserId: 'user-test',
        entryDate: '2026-08-10',
        entryType: 'refund',
        amount: 300,
        note: '退款',
        relatedOrderId: null,
        createdAt: '2026-08-10T10:00:00Z',
      },
      {
        id: 'w-1',
        customerUserId: 'user-test',
        entryDate: '2026-08-01',
        entryType: 'deposit',
        amount: 5000,
        note: '首次儲值',
        relatedOrderId: null,
        createdAt: '2026-08-01T10:00:00Z',
      },
    ]);
  });
});
