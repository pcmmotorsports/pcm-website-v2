// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 `app/orders/page.test.tsx` 紀律)。
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
/** `#525` 搜尋詞住 httpOnly cookie ⇒ 每格自己決定「這次有沒有在搜尋」。 */
const cookieState = vi.hoisted(() => ({ keyword: undefined as string | undefined }));
// 🔴 **逐鍵比對 `get(name)`,不做「不分鍵一律回值」的替身** ——
//    那種替身會讓「讀錯 cookie 名」這個突變照樣綠(訂單側 `orders/page.test.tsx:35` 同一條紀律)。
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'admin_customer_keyword' && cookieState.keyword !== undefined
        ? { value: cookieState.keyword }
        : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock('../../lib/customers/customer-repository', () => ({
  getAdminCustomerRepository: () => ({ listCustomerSummariesForAdmin: mocks.list }),
}));
vi.mock('server-only', () => ({}));

import CustomersPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cookieState.keyword = undefined;
});

// 🔴 `result` 可覆寫,而且**只在呼叫端沒設過時才套預設** ——
//    上一版這裡是**無條件** `mockResolvedValue`,會把每一格自己 arrange 的回傳**靜默洗掉**。
//    ⚠️ 那個 bug 的可怕之處不是「有一格紅了」,是**另外兩格照樣綠** ——
//    它們綠是因為條件被洗回預設值,不是因為邏輯對。**恆綠格就是這樣長出來的。**
async function renderPage(
  search: Record<string, string> = {},
  result?: Record<string, unknown>,
) {
  if (result !== undefined || mocks.list.mock.results.length === 0) {
    mocks.list.mockResolvedValue(
      result ?? { items: [], total: 0, keywordTruncated: false, keywordMatchCount: null },
    );
  }
  return render(await CustomersPage({ searchParams: Promise.resolve(search) }));
}

// #365:儲值金 / 會員等級的失敗出口寫死 redirect('/customers?r=…')(wallet-actions.ts:33/:39、
// tier-actions.ts:35/:41)⇒ 所有 denied / invalid 都落在這一頁。這頁先前沒有橫幅 = 員工零交代。
describe('/customers 結果橫幅(#365)', () => {
  it('🔴 ?r=invalid → 畫面出現員工看得懂的中文,不是靜默', async () => {
    const { getByRole } = await renderPage({ r: 'invalid' });
    expect(getByRole('status').textContent).toContain('表單內容不正確');
  });

  it('🔴 ?r=denied → 同樣有交代(權限失敗也走這條路)', async () => {
    const { getByRole } = await renderPage({ r: 'denied' });
    expect(getByRole('status').textContent).not.toBe('');
  });

  // 🔴 負向對照:沒有這一格,上面兩條對「橫幅恆亮」也會是綠的 ⇒ 證不出 `?r=` 真的在驅動它。
  it('沒有 r 參數 → 不渲染橫幅(證明橫幅不是恆亮)', async () => {
    const { queryByRole } = await renderPage();
    expect(queryByRole('status')).toBeNull();
  });

  it('未知碼 → 不渲染橫幅(ResultBanner 的 Object.hasOwn 守門,#332-2)', async () => {
    const { queryByRole } = await renderPage({ r: '__proto__' });
    expect(queryByRole('status')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LINE 合成位址不顯示原字串 —— **頁級**證據(Sean 2026-08-16 拍板乙)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **為什麼函式級補不到這裡**:`customerEmailDisplay()` 算得對,**不代表這一頁接了它**。
//    有人把 `customers-table.tsx` 那格改回 `cell: (c) => c.email`,單測那族**一格都不會紅**。
//    這一格釘的是「這個畫面用的是哪一個來源」。
describe('/customers 列表:LINE 合成位址不外顯', () => {
  const row = (email: string) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: '測試客戶',
    email,
    phone: null,
    tier: 'general' as const,
    createdAt: '2026-08-01T00:00:00Z',
    // 🔴 這三欄是 void-readers 那條線加的(`AdminCustomerListRow` 必填),
    //    而本 fixture 寫於它們存在之前 ⇒ 2026-08-16 收割時 `formatOrderAmount(undefined)` 當場炸。
    //    ⚠️ 補的是 fixture 的完整性,**兩格的斷言一個字沒動**(合成位址不外顯 / 真 Email 正向對照)。
    activeOrderCount: 0,
    activeSpendTotal: 0,
    lastActiveOrderedAt: null,
  });

  it('🔴 合成位址 → 畫面顯示替代字面,原字串不出現', async () => {
    mocks.list.mockResolvedValue({
      items: [row('line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local')],
      total: 1,
    });
    const { container } = render(await CustomersPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toContain('LINE 帳號登入,無 Email');
    expect(container.textContent).not.toContain('line_u');
    expect(container.textContent).not.toContain('pcmmotorsports.local');
  });

  // 正向對照:真 Email 照樣顯示 ⇒ 上一格不是因為「這頁根本不顯示 Email」而過。
  it('真 Email 仍原樣顯示(正向對照)', async () => {
    mocks.list.mockResolvedValue({ items: [row('sean@example.com')], total: 1 });
    const { container } = render(await CustomersPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toContain('sean@example.com');
  });
});

// ── `#525` 客戶關鍵字搜尋:畫面層守門 ──
//
// 🔴 **為什麼這幾格住在 page 而不是元件檔**:元件單測證的是「餵它 `truncated=true` 它會畫」,
//    而真正會壞的是**page 沒把 `truncated` 餵下去**(或餵了 `false`)。
//    「共用元件測過了」不等於「這一頁測過了」—— 中間那一跳沒有人守。
describe('#525 客戶關鍵字搜尋(畫面層)', () => {
  const hits = (n: number, truncated: boolean) => ({
    items: [],
    total: 0,
    keywordTruncated: truncated,
    keywordMatchCount: n,
  });

  it('🔴 沒在搜尋 ⇒ 不出現 chip,也不對員工說「命中 0 位」', async () => {
    const { container } = await renderPage();
    // `null`(沒查)與 `0`(查了、沒人)不可互換:這格釘住前者不得被畫成後者。
    expect(container.textContent).not.toContain('目前搜尋');
    expect(container.textContent).not.toContain('關鍵字命中');
  });

  it('🔴 有搜尋詞 ⇒ 搜尋詞【看得見】而且【有清除入口】(cookie 跨分頁缺陷的唯一緩解)', async () => {
    cookieState.keyword = '王小明';
    const { container, getByRole } = await renderPage({}, hits(3, false));
    // 搜尋詞既不在 URL、cookie 又是 httpOnly ⇒ 畫面沒有它的話,
    // 另一個分頁的員工只會看到「客戶怎麼少了一堆」而完全無從得知原因。
    expect(container.textContent).toContain('目前搜尋:王小明');
    expect(getByRole('button', { name: '清除搜尋' })).toBeTruthy();
  });

  it('🔴🔴 截斷 + 畫面【零筆】⇒ 警語仍然出現(migration COMMENT 的合約,最容易被漏的那一格)', async () => {
    cookieState.keyword = '陳';
    // 🔴 **這裡的數字是刻意的,codex 對抗審查 2026-08-16 訂正過一次**:
    //    上一版寫 `hits(0, true)` = 「RPC 命中 0 人、又說被截斷」——
    //    **那個狀態在 RPC 合約下構造不出來**(截斷的前提就是命中超過 100)。
    //    ⚠️ 那格會綠,但它綠的是**一個不會發生的世界** ⇒ **零實戰判別力,而外觀完好。**
    // ✅ **真正會發生的形狀是這個**:RPC 命中 100(截斷),再被會員等級篩選砍到畫面 0 筆
    //    ⇒ 員工看到「共 0 位」,而真相是「符合的人整批落在那 100 筆之外」。
    const { container } = await renderPage({}, {
      items: [],
      total: 0,
      keywordTruncated: true,
      keywordMatchCount: 100,
    });
    expect(container.textContent).toContain('共 0 位');
    expect(container.textContent).toContain('結果太多');
  });

  it('沒截斷 ⇒ 不出現警語(否則上一格會因為「警語永遠都在」而恆真)', async () => {
    cookieState.keyword = '陳';
    const { container } = await renderPage({}, hits(5, false));
    expect(container.textContent).not.toContain('結果太多');
  });

  it('🔴 搜尋詞【真的送進 repository】(fail-open:畫面說在搜、列表其實是全部)', async () => {
    cookieState.keyword = '0912';
    await renderPage({}, hits(1, false));
    // 這格守的是最毒的那個形狀:chip 寫著「目前搜尋:0912」而查詢根本沒帶 keyword。
    expect(mocks.list.mock.calls[0]?.[0]).toMatchObject({ keyword: '0912' });
  });

  it('沒搜尋詞 ⇒ filter【不帶】keyword 欄(`undefined` 與 `\'\'` 在 adapter 是兩條路)', async () => {
    await renderPage();
    expect(mocks.list.mock.calls[0]?.[0]).not.toHaveProperty('keyword');
  });
});
