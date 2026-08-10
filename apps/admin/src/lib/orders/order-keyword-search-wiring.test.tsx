// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MAX_ORDER_KEYWORD_LENGTH } from '@pcm/domain';
import {
  ORDER_KEYWORD_COOKIE,
  ORDER_KEYWORD_FIELD,
  ORDER_KEYWORD_RETURN_TO_FIELD,
  encodeOrderKeywordCookie,
  readOrderKeywordCookie,
} from './order-keyword-cookie';

// order-keyword-search-wiring.test.tsx — #347-2b 守門。
//
// 🔴 本片的壞法**全都沒有執行期訊號**:搜尋詞漏進 URL(PII 外洩)、翻頁把搜尋詞弄丟
//    (列表靜默變回全部訂單)、截斷提示沒出來(員工得到「查無此單」的錯誤結論)、
//    chip 不見(員工不知道自己在搜什麼)—— 沒有一個會丟錯。

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  redirect: vi.fn((to: string) => {
    // 🔴 真的 `redirect()` 是**擲 NEXT_REDIRECT**;替身也必須擲,否則 action 會繼續往下跑,
    //    測試就量不到「redirect 之後不該再發生的事」,也證不了它真的中止了流程。
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  listOrderSummariesForAdmin: vi.fn(),
  authorizeAdminMutation: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
    get: mocks.cookieGet,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  // 守門 4 會渲染整個列表頁,裡面的 client island(勾選列 / 篩選列)用得到這幾支。
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));
// 🔴 授權替身:預設**已登入**。下面有一格把它翻成 `null`,證明未授權時 cookie 一個字都不會寫
//    —— 沒有那格的話,這個 mock 就只是「讓測試跑得動」,而不是在守什麼。
vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('./order-repository', () => ({
  getAdminOrderRepository: () => ({
    listOrderSummariesForAdmin: mocks.listOrderSummariesForAdmin,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'actor-1' });
});
afterEach(() => cleanup());

// ── 1. cookie 讀取 fail-closed(主視窗 2026-08-10 裁決條件③)────────────────────
describe('#347-2b 守門 1:cookie 壞值一律當作沒搜尋', () => {
  it('正常值 → 還原得回來(含中文與空白:本軸刻意沒有字元集守門)', () => {
    expect(readOrderKeywordCookie(encodeOrderKeywordCookie('王小明 A1-B2'))).toBe('王小明 A1-B2');
  });

  it('🔴 壞的百分號編碼 → null(突變:拿掉 try/catch ⇒ 這格變成擲錯,整個訂單列表打不開)', () => {
    expect(readOrderKeywordCookie('%')).toBeNull();
    expect(readOrderKeywordCookie('%E0%A4%A')).toBeNull();
  });

  it('🔴 超長值 → null(剛好越界,不自己猜數字)', () => {
    const tooLong = 'a'.repeat(MAX_ORDER_KEYWORD_LENGTH + 1);
    expect(readOrderKeywordCookie(encodeOrderKeywordCookie(tooLong))).toBeNull();
    // 正向對照:剛好等於上限要**過**,否則這條閘可能是「永遠回 null」的假貨。
    const atLimit = 'a'.repeat(MAX_ORDER_KEYWORD_LENGTH);
    expect(readOrderKeywordCookie(encodeOrderKeywordCookie(atLimit))).toBe(atLimit);
  });

  it('空字串 / undefined / 只有空白 → null', () => {
    expect(readOrderKeywordCookie(undefined)).toBeNull();
    expect(readOrderKeywordCookie('')).toBeNull();
    expect(readOrderKeywordCookie(encodeOrderKeywordCookie('   '))).toBeNull();
  });
});

// ── 2. action:POST + PRG,搜尋詞不進 URL ──────────────────────────────────────
describe('#347-2b 守門 2:action 寫 cookie、PRG,且**搜尋詞絕不進 URL**', () => {
  const load = async () => await import('./keyword-search-action');

  it('有效搜尋詞 → 寫 httpOnly session cookie', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, '王小明');
    fd.set(ORDER_KEYWORD_RETURN_TO_FIELD, '/orders?payment_status=paid');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
    // 🔴 `!` 而不是 `?.`:上一行已經斷言呼叫過一次;若沒有,這裡就**應該**當場炸,
    //    而不是靜默拿到 undefined 讓下面幾條斷言變成在比對空氣。
    const [name, value, opts] = mocks.cookieSet.mock.calls[0]!;
    expect(name).toBe(ORDER_KEYWORD_COOKIE);
    expect(readOrderKeywordCookie(value)).toBe('王小明');
    // 🔴 httpOnly:搜尋詞是 PII,不給 client JS 讀。突變:拿掉這個旗標 ⇒ 紅。
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    // 🔴 session cookie:**不得**有 max-age / expires(關瀏覽器就該消失)。
    expect(opts.maxAge).toBeUndefined();
    expect(opts.expires).toBeUndefined();
  });

  it('🔴🔴 redirect 目標**不含搜尋詞**(這條是紅線:PII 不進 URL)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, '王小明');
    fd.set(ORDER_KEYWORD_RETURN_TO_FIELD, '/orders?payment_status=paid');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');

    const to = mocks.redirect.mock.calls[0]![0];
    // 突變:action 改成 `redirect(\`/orders?q=${keyword}\`)` ⇒ 這格紅。
    expect(to).not.toContain('王小明');
    expect(to).not.toContain('q=');
    // 其他篩選軸要**原樣保留**(否則搜尋一次就把篩選洗掉,是同一族的 fail-open)。
    expect(to).toBe('/orders?payment_status=paid');
  });

  it('空字串(= ✕ 清除)→ 刪 cookie,而且走**同一條 PRG**', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, '');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cookieDelete).toHaveBeenCalledWith(ORDER_KEYWORD_COOKIE);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('超長 / 不合法 → 也刪 cookie(不留一個查不動的舊詞讓 chip 與列表說不同的話)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, 'a'.repeat(MAX_ORDER_KEYWORD_LENGTH + 1));
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cookieDelete).toHaveBeenCalledWith(ORDER_KEYWORD_COOKIE);
  });

  it('🔴 未授權 → 一個字都不寫、直接導回列表(縱深防禦,不只靠 proxy 登入閘)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, '王小明');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
    // 突變:拿掉那道授權閘 ⇒ 這兩條紅(未登入者也能寫 cookie)。
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it('🔴 return_to 站外 / 換行 → fail-closed 退回 /orders(open-redirect)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    for (const evil of ['//evil.example', 'https://evil.example/orders', '/orders\n/x', '/customers']) {
      vi.clearAllMocks();
      const fd = new FormData();
      fd.set(ORDER_KEYWORD_FIELD, 'x');
      fd.set(ORDER_KEYWORD_RETURN_TO_FIELD, evil);
      await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
      expect(mocks.redirect.mock.calls[0]![0], `return_to=${evil} 應退回 /orders`).toBe('/orders');
    }
  });

  // ── #365 片②:兩欄都走「getAll 恰一筆」 ──────────────────────────────────────
  it('🔴 搜尋詞送兩份 → 刪 cookie(不拿其中一份去查)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.append(ORDER_KEYWORD_FIELD, '王小明');
    fd.append(ORDER_KEYWORD_FIELD, '李小華');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
    // 讀不出一個明確的搜尋詞 ⇒ 走與「員工清空搜尋框」同一個出口:chip 消失、列表回全部。
    // 突變:改回 `formData.get()` ⇒ 這格紅(會拿 '王小明' 去寫 cookie)。
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith(ORDER_KEYWORD_COOKIE);
  });

  it('🔴 return_to 送兩份 → 退回 /orders(不採第一筆)', async () => {
    const { applyOrderKeywordSearchAction } = await load();
    const fd = new FormData();
    fd.set(ORDER_KEYWORD_FIELD, '王小明');
    fd.append(ORDER_KEYWORD_RETURN_TO_FIELD, '/orders?payment_status=paid');
    fd.append(ORDER_KEYWORD_RETURN_TO_FIELD, '/orders?payment_status=unpaid');
    await expect(applyOrderKeywordSearchAction(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect.mock.calls[0]![0]).toBe('/orders');
    // 正向對照在上方「redirect 目標不含搜尋詞」那格:只送一份時會逐字保留 `?payment_status=paid`。
  });
});

// ── 3. 畫面:chip 常駐 + 清除入口 + 截斷提示 ────────────────────────────────────
describe('#347-2b 守門 3:搜尋狀態必須看得見、關得掉', () => {
  const renderSearch = async (
    keyword: string | null,
    matchCount: number | null = null,
    truncated = false,
  ) => {
    const { OrderKeywordSearch } = await import('../../components/orders/order-keyword-search');
    return render(
      <OrderKeywordSearch
        keyword={keyword}
        listHref='/orders'
        matchCount={matchCount}
        truncated={truncated}
      />,
    );
  };

  it('🔴 有搜尋詞 → 畫面看得到它,而且有清除入口', async () => {
    // A 案(cookie 載體)的成立前提:URL 不帶、cookie httpOnly ⇒ 沒有 chip 的話,
    // 員工只看到「列表怎麼少了一堆單」而完全不知道自己正在搜什麼。
    const { container } = await renderSearch('王小明');
    expect(container.textContent).toContain('王小明');
    expect(container.textContent).toContain('清除搜尋');
  });

  it('沒搜尋詞 → 不顯示 chip(不要在沒搜的時候掛一個空殼)', async () => {
    const { container } = await renderSearch(null);
    expect(container.textContent).not.toContain('目前搜尋');
    expect(container.textContent).not.toContain('清除搜尋');
  });

  it('🔴 命中筆數 0 與 null 不可互換', async () => {
    const zero = await renderSearch('王小明', 0);
    expect(zero.container.textContent).toContain('關鍵字命中 0 筆');
    cleanup();
    const never = await renderSearch('王小明', null);
    expect(never.container.textContent).not.toContain('關鍵字命中');
  });
});

// ── 4. 列表頁:cookie → 查詢 → 翻頁,整條 ─────────────────────────────────────
describe('#347-2b 守門 4:搜尋詞真的進查詢、而且**翻頁帶得走、URL 帶不走**', () => {
  const KEYWORD = '王小明';
  const renderPage = async (extra: Partial<{ keywordTruncated: boolean; items: unknown[]; total: number }> = {}) => {
    mocks.cookieGet.mockReturnValue({ value: encodeOrderKeywordCookie(KEYWORD) });
    mocks.listOrderSummariesForAdmin.mockResolvedValue({
      items: [],
      total: 0,
      keywordTruncated: false,
      keywordMatchCount: 0,
      ...extra,
    });
    const OrdersPage = (await import('../../app/orders/page')).default;
    const ui = await OrdersPage({ searchParams: Promise.resolve({ payment_status: 'paid' }) });
    return render(ui as React.ReactElement);
  };

  it('🔴 讀 cookie 用的是 ORDER_KEYWORD_COOKIE 這個名字(不是任何別的字串)', async () => {
    // code-reviewer(2026-08-10)擊破:`cookieGet` 對**任何** key 都回同一個值,
    // 而全檔沒有一條斷言 key ⇒ 把 page 的 `get(ORDER_KEYWORD_COOKIE)` 改成別的字串,16 格全綠。
    // 那正好推翻 `order-keyword-cookie.ts` 檔頭「把兩端釘在本常數上」的字面(當時只釘了寫端)。
    await renderPage();
    expect(mocks.cookieGet).toHaveBeenCalledWith(ORDER_KEYWORD_COOKIE);
  });

  it('🔴 cookie 的搜尋詞真的餵進 repository 的 filter', async () => {
    await renderPage();
    // 突變:page 不把 cookie 合進 filter ⇒ 這格紅(而畫面上完全看不出差別:列表只是變成全部訂單)。
    expect(mocks.listOrderSummariesForAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.listOrderSummariesForAdmin.mock.calls[0]![0]).toMatchObject({
      keyword: KEYWORD,
      paymentStatus: 'paid',
    });
  });

  it('🔴🔴 畫面上所有 /orders 連結(含分頁與清除)都**不含搜尋詞** —— PII 不進 URL', async () => {
    const { container } = await renderPage({ total: 100 });
    const hrefs = [...container.querySelectorAll('a[href], input[type=hidden]')].map(
      (el) => el.getAttribute('href') ?? el.getAttribute('value') ?? '',
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h, `連結不得帶搜尋詞:${h}`).not.toContain(KEYWORD);
      expect(h).not.toContain(encodeURIComponent(KEYWORD));
    }
  });

  it('🔴 頁面真的把三個 prop 接對(chip 看得見、return_to 帶著篩選)', async () => {
    // code-reviewer(2026-08-10)擊破:守門 3 是拿手寫 prop 直接 render 元件、守門 4 從不看 chip
    // ⇒ page 把 `keyword={null}` / `matchCount={null}` / `listHref='/orders'` 寫死三發**全綠**,
    //    而第三發正是 action 檔自己警告的「搜尋一次把六個篩選軸全洗掉」。
    const { container } = await renderPage();
    expect(container.textContent).toContain(KEYWORD);
    const returnTo = [...container.querySelectorAll('input[type=hidden]')]
      .filter((el) => el.getAttribute('name') === 'return_to')
      .map((el) => el.getAttribute('value'));
    expect(returnTo.length).toBeGreaterThan(0);
    // page 已把 `page` 歸 1(搜尋換條件不該停在第 3 頁),但**篩選軸要原樣帶著**。
    // 🔴 **#347-3c-2 起這條不能再比整串**:頁層開了「未選預設近半年」⇒ `return_to` 會多帶
    //    `date_from`/`date_to`(那是本片刻意的行為變更,不是回歸)。改成逐軸斷言 ——
    //    比整串會讓「新增任何一軸」都紅在這裡,而它要守的其實只有「篩選軸沒被洗掉」那一件事。
    // 🔴 舊斷言含**路徑**那一半,改成解 query 時別把它弄丟(R1 指出)。
    expect(returnTo[0]).toMatch(/^\/orders\?/);
    const qs = new URLSearchParams((returnTo[0] ?? '').split('?')[1] ?? '');
    expect(qs.get('payment_status'), '篩選軸被搜尋洗掉了').toBe('paid');
    expect(qs.get('page'), '搜尋換條件應回第 1 頁(不帶 page)').toBeNull();
    // 正向對照:預設日期確實跟著走(否則「多帶兩軸」這句是空話)。
    expect(qs.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('🔴🔴 keywordTruncated=true ⇒ 截斷提示一定出現,**包含 0 筆的情況**', async () => {
    // 這一格是本片最重要的一條:RPC 先取全域最新 100 筆命中才與其他篩選取交集
    // ⇒ 要找的單可能整張落在那 100 筆之外、畫面顯示 0 筆。
    // 0 筆 + 沒有提示 = 員工得到「查無此單」的錯誤結論,正是合約要禁的形狀。
    // 突變:給提示加上 `orders.length > 0` 條件 ⇒ 這格紅。
    const { container } = await renderPage({ keywordTruncated: true, items: [], total: 0 });
    expect(container.textContent).toContain('超過 100 筆');
  });

  it('keywordTruncated=false ⇒ 不出現截斷提示(正向對照,證明上一格不是恆真)', async () => {
    const { container } = await renderPage({ keywordTruncated: false });
    expect(container.textContent).not.toContain('超過 100 筆');
  });
});
