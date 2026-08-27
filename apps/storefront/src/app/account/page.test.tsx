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
  // 🔴 `listSummariesByCustomer` 不是 `listByCustomer` —— 抓到這個名字寫錯的是
  //    `it('🔴 對照組:合法 tier 不得留下那行 log …')` 那一格。
  //    少了它, 這個 mock 缺口會讓 `it('🔴 DB 給一個本版不認得的 tier ⇒ 退成 general …')`
  //    的「有 log」被【另一個錯誤的 log】滿足 ⇒ 假綠。
  //
  // 🔴 **2026-08-27:原文寫「下面第 4 格」與「第 2 格」, 已改成【格名】。**
  //    理由:位置會因為「有人在中間插一格」而變, 而插一格是每天都在做的事
  //    —— 本檔 2026-08-27 就從 15 格變成 16 格。
  //    📌 **一個宣稱要可查, 前提是它指的東西有一個【不會因為正常工作而改變】的名字。**
  getOrderRepo: async () => ({ listSummariesByCustomer: async () => [] }),
  getFavoritesRepo: async () => ({ listByCustomer: async () => [] }),
}));

vi.mock('@/lib/products', () => ({
  fetchFeaturedProducts: async () => [],
  fetchVehicleTaxonomy: async () => [],
}));

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import AccountRoute from './page';
import { ACCOUNT_TAB_IDS } from '@/components/account/account-nav';

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

describe('🔴 client/server 邊界(2026-08-27 真瀏覽器抓到的,而【這一族測試當時全綠】)', () => {
  // 🔴🔴 **這一格存在的理由,是它抓不到的那一次:**
  //    我原本把 `ACCOUNT_TAB_IDS` export 在 `AccountView.tsx`(有 `'use client'`)裡,
  //    讓 server component `page.tsx` import 它 —— 想確保「合法分頁清單只有一份」。
  //    ⇒ **單元測試 20 格全綠,而真瀏覽器一開就 500**:
  //      `ACCOUNT_TAB_IDS.includes is not a function`
  //      —— 從 server component import 一支 `'use client'` 模組的普通 export,
  //      拿到的不是那個陣列,是 React 的 client reference。
  //    📌 **vitest 直接 import 那支模組,它的世界裡【沒有 RSC 邊界】。**
  //       那把尺量得到邏輯,量不到「這段碼會跑在哪一側」—— 而畫面壞在後者。
  //
  // ⚠️ **本格是【文字層】守門,不是真的 RSC 測試** —— 它證不到「跑起來不會炸」,
  //    只證得到「那條會炸的接線形狀沒有回來」。要證前者只有真瀏覽器。**不要把它讀成前者。**
  // 🔴 **從本檔自己的位置推,不從 `process.cwd()` 推**(第一版就是那樣寫,而它 ENOENT):
  //    cwd 是「vitest 從哪裡被叫起來」= repo 根,不是這支檔在哪。
  //    📌 而那個紅是【我的尺錯了】不是碼錯了 —— 兩者都印一個紅,要開錯訊才分得出。
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

  it('🔴 `account-nav.ts` 不得帶 `use client` —— 它要兩側都 import 得到', () => {
    // 🔴 **只看【第一個非空白、非註解】的敘述,不掃全檔**(第一版就是掃全檔而它紅了):
    //    `account-nav.ts` 的檔頭有兩句在【解釋】為什麼不能帶 `'use client'`
    //    ⇒ 掃字面會數到那兩句 ⇒ **紅的是我的尺,不是碼。**
    //    ⚠️ 而 `'use client'` 的語意本來就是**必須是檔案第一個敘述** ⇒ 只看第一句才是對的量法。
    const firstStatement = (src: string) =>
      src
        // 🔴 **先把塊註解整段拿掉**(code-reviewer 2026-08-27 nit):
        //    原版逐行跳過 `//` 與 `*` 開頭 ⇒ 一段【開頭不帶 `*`】的 `/* … */`
        //    會讓下一行中文被當成 firstStatement ⇒ 後面真的 `'use client'` 看不到、**綠**。
        //    ⇒ 那正是這道守門在防的東西, 而它自己有一條路穿過去。
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')) ?? '';

    expect(
      firstStatement(read('components/account/account-nav.ts')),
      'account-nav.ts 變成 client 模組 ⇒ server 端會拿到 client reference 而不是陣列',
    ).not.toContain('use client');
    // 正對照:同一把尺對著一支**真的**帶 use client 的檔要看得到 —— 否則它是恆真的。
    expect(
      firstStatement(read('components/account/AccountView.tsx')),
      '正對照失效:這把尺連真的 use client 都看不到',
    ).toContain('use client');
  });

  it('🔴 `page.tsx`(server)不得從 `AccountView` 拿分頁清單', () => {
    const src = read('app/account/page.tsx');
    // 那條會炸的形狀:從 AccountView 帶出 ACCOUNT_TAB_IDS
    // 🔴🔴 **2026-08-27 code-reviewer 訂正(主視窗在 node 裡跑三個世界複驗,兩把都餵過)**:
    //    ~~原改成 `[\s\S]*?`,理由寫「多行 import 裡有分號以外的換行,`[^;]*` 照樣過」~~
    //    ⇒ **那句理由是錯的**:`[^;]` 是【否定字元類】,它本來就吃 `\n` ——
    //      多行壞形狀 `[^;]*` 實測 **true**(抓得到),不需要換。
    //    🔴 而換成 `[\s\S]*?` 引進一個【假紅】:兩行 import 對調(**完全合法**)⇒
    //      `[\s\S]*?` **true**(誤判違規)/ `[^;]*` **false**(正確放行)。
    //    ⇒ ⇒ 那會變成一把【依賴 import 順序】的尺 —— prettier 排一次就紅,而碼是對的,
    //         **而下一個人會去改守門**。⇒ 改回 `[^;]*`。
    const BAD = /ACCOUNT_TAB_IDS[^;]*from '@\/components\/account\/AccountView'/;
    expect(BAD.test(src), 'page.tsx 又從 AccountView 拿分頁清單了 ⇒ server 端會拿到 client reference').toBe(false);
    // 🔴 **正對照:這把尺從來沒被證明抓得到東西**(nit)—— 餵一段手寫的壞字串, 它必須抓到。
    //    少了這一行, 把 regex 打錯成永不匹配也會全綠。
    expect(
      BAD.test("import { ACCOUNT_TAB_IDS } from '@/components/account/AccountView';"),
      '正對照失效:這把尺連寫死的壞形狀都抓不到',
    ).toBe(true);
    // 而它必須從 account-nav 拿 —— 少了這一行,上面那格在「兩邊都沒有」時也會綠。
    expect(src).toContain("from '@/components/account/account-nav'");
  });
});

describe('/account server route · `?tab=` deep-link(2026-08-27,Sean 拍 B)', () => {
  // 🔴 **這一族守的是 `cf` 那份 probe 的三個世界**(真瀏覽器量到的):
  //    A 明細頁按返回鈕 / B 直接開 `/account?tab=orders` / C 瀏覽器上一頁。
  //    ⚠️ **本檔只證得了 server 端解析那一半** —— A/B/C 是**畫面**的事,
  //       而畫面要真瀏覽器才算數。**這裡綠不等於那三個世界修好了。**
  async function routeWithTab(tab?: string) {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-test', email: 'member@example.com', user_metadata: { name: '測試會員' } } },
    });
    customerSingleMock.mockResolvedValue({
      data: { name: '測試會員', phone: '', birthday: null, tier: 'general', wallet_balance: 0 },
      error: null,
    });
    return AccountRoute(tab === undefined ? undefined : { searchParams: Promise.resolve({ tab }) });
  }

  it('🔴 `?tab=orders` ⇒ server 解出 initialTab=\'orders\'(標題刻意窄:本格證不到「首屏亮」, 那要真瀏覽器)', async () => {
    expect((await routeWithTab('orders')).props.initialTab).toBe('orders');
  });

  it('🔴 沒給 `?tab=` ⇒ 仍然落總覽(防回歸;這一格【修之前就是綠的】)', async () => {
    // ⚠️ 而「本來就綠」的格子最容易在重構時失去判別力 ——
    //    它與上面那格用同一支 helper、同一條路徑,差別只有參數 ⇒ 兩格一起才分得出兩個世界。
    expect((await routeWithTab()).props.initialTab).toBeUndefined();
  });

  it('🔴 `?tab=zzz`(打錯的分頁名)⇒ 安靜落總覽,不報錯(Sean 2026-08-27 Q1 拍甲)', async () => {
    // 🔴 **代價寫在 `page.tsx` 的 `tabFromSearchParams` docstring** —— 舊書籤會安靜落總覽而沒人回報。
    //    那是他讀過代價之後選的,不是我們沒想到。
    expect((await routeWithTab('zzz')).props.initialTab).toBeUndefined();
    // 負對照:合法值不得被同一條路收斂掉 —— 少了這一行,`return undefined` 也會讓上面全綠。
    expect((await routeWithTab('wallet')).props.initialTab).toBe('wallet');
  });

  it('🔴 `page.tsx` 不得再自己打一份清單 —— 而本格【近乎恆真】, 真正承重的是 toBe(7) 與 zzz/wallet 那對負對照', async () => {
    // 🔴 不在這裡再打一份七個字串:兩份會漂, 而漂掉的那天新分頁會被判成不合法、安靜落總覽。
    for (const id of ACCOUNT_TAB_IDS) {
      expect((await routeWithTab(id)).props.initialTab, `合法分頁 ${id} 被判成不合法`).toBe(id);
    }
    expect(ACCOUNT_TAB_IDS.length, '分頁數變了 ⇒ 回去看 page.tsx 那段代價註解').toBe(7);
  });
});

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
    //      **本檔【當時】全部 15 格照樣綠**(mapper 那格餵的是 mock 的完整 ROWS,與真正送出去的清單無關)。
    //    ⚠️ **那個 15 是在【補這一格之前】量的, 而補上去的動作把它變成 16。**
    //       ⇒ 這句話錨在 commit `c1aef746`(本格尚未存在的那一版), **不是永久事實**。
    //       📌 一個描述【我出生之前的世界】的數字, 會被我的出生改掉 —— 而那句話留在原地。
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
