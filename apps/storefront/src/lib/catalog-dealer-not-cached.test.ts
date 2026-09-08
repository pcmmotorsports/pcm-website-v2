// @vitest-environment node
//
// ⟦front-CATALOGPRICEGENERALONLY⟧ 的承重守門 —— **經銷客人的目錄結果【不得進共用快取】。**
//
// 🔴🔴 **它守的是什麼(一句)**:`fetchCatalogPage` 的快取鍵是
//    `(serializedQuery, vehicleBrand, vehicleModel, vehicleYear)` —— **裡面沒有身分**。
//    ⇒ 📌 經銷會員的結果若進了那個快取, **下一個一般會員打同一個網址就會拿到它**
//      ⇒ 🛑 `CLAUDE.md` Server 端鐵則逐字:**「經銷價絕不傳到一般會員瀏覽器」**。
//
// 🎯 **而修法是【結構性】的, 不是紀律性的**(Sean 2026-09-08 拍乙):
//    經銷客人**整條繞過快取** ⇒ 走快取的那條路**永遠不會**叫經銷 RPC。
//    ⛔ ~~快取鍵加上 tier~~ 也對, 而它把「別漏掉 tier」變成一個**永遠要記得**的東西。
//
// 🛑 **本檔的世界要與 `products.test.ts` 分開**:那支把 `unstable_cache` mock 成【直通】
//    ⇒ 它的世界裡**根本沒有快取** ⇒ 它結構上驗不到「什麼東西進了快取」。
//    ⇒ 本檔照 `catalog-error-not-cached.test.ts` 的做法, mock 成**真的會記住**。
//    ⚠️ 那支檔是本檔的**姊妹**(同一個快取、不同的宣稱):它守「失敗不得進快取」,
//       本檔守「經銷的結果不得進快取」。**兩件事各自有各自的守門, 不要合成一格。**

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/** 一個【真的會記住】的 unstable_cache —— 而它就是本檔的世界。 */
const cacheStore = new Map<string, unknown>();
/** anon client 被建了幾次 = 走公開那條路真的去打了幾次 DB。 */
let anonClients = 0;
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const out = await fn(...args);
      cacheStore.set(key, out);
      return out;
    },
}));

/** 公開那條路的 client。 */
const anonRpc = vi.fn();
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  return {
    ...real,
    createSupabaseAnonClient: () => {
      anonClients += 1;
      return { rpc: anonRpc } as never;
    },
  };
});

/**
 * 經銷那條路的 client。
 *
 * 🛑🛑 **[codex 2026-09-08 nit:「帶 session」這件事本檔【證不到】]**
 *   這個 mock 沒有身分閘 ⇒ 它**永遠成功**。而正式那支 RPC 開頭是
 *   `auth.uid()` ⇒ 查 `customers.tier` ⇒ 非 `store` 就 `RAISE`。
 *   ⇒ 📌 **SSR 的 cookie 接線若漏掉 access token, 本檔照樣全綠, 而正式站每一頁都會錯誤狀態。**
 *   ⚠️ **本檔驗得到的只有「有沒有去拿那個 client、打的是哪一支 RPC、結果有沒有進快取」** ——
 *     **驗不到「那個 client 真的帶著 JWT」。** 那要真的連上一個有身分閘的 DB 才問得出來
 *     ⇒ 拋棄式 PG 或正式庫, 不是這一層。
 *   🔴 **⇒ 這是一個【已知的空白】, 不是一個被守住的格子。** 別因為本檔全綠就以為接線驗過了。
 * 🔴 **它與 anon 那個【刻意是兩個不同的 mock】** —— 合成一個的話,
 *    「經銷客人被用 anon client 送去打經銷 RPC」這個世界會**看不見**,
 *    而那正是那支 RPC 身分閘會 RAISE 的那一種。
 */
const dealerRpc = vi.fn();
let verifiedUserCalls = 0;
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => {
    verifiedUserCalls += 1;
    return { supabase: { rpc: dealerRpc }, user: { id: 'u1' }, error: null };
  },
  isNoSessionError: () => false,
}));

const { fetchCatalogPage } = await import('./products');
const { parseCatalogQuery } = await import('./catalog-query');

// 🔴 query 用【真的 parseCatalogQuery】造, 不是手打一個物件(姊妹檔記過那個坑:
//    手打的 `{ page: 1 }` 會在 `query.brandSlugs.length` 當場 TypeError,
//    ⇒ 那一發變成【另一種失敗】, 而斷言仍然可能綠)。
const q = (page: number) =>
  parseCatalogQuery({ get: (k: string) => (k === 'page' ? String(page) : null) } as never);

/** 兩支 RPC 都回「成功而空清單」—— 空清單也是成功, 而它不必造假商品。 */
const bothOk = () => {
  anonRpc.mockResolvedValue({ data: [], error: null });
  dealerRpc.mockResolvedValue({ data: [], error: null });
};

beforeEach(() => {
  cacheStore.clear();
  anonClients = 0;
  verifiedUserCalls = 0;
  anonRpc.mockReset();
  dealerRpc.mockReset();
});

describe('⟦front-CATALOGPRICEGENERALONLY⟧ 經銷的目錄結果不得進共用快取', () => {
  it('🟢 正對照:一般會員【要】被快取住 —— 否則下面每一格都在一個沒有快取的世界裡', async () => {
    // 🛑 少了這一格,「經銷沒進快取」與「這個 mock 根本沒在記東西」印同一個綠。
    bothOk();
    await fetchCatalogPage(q(2), null, 'general');
    await fetchCatalogPage(q(2), null, 'general');
    expect(
      anonClients,
      '一般會員也沒被快取 ⇒ 這個 mock 沒有在記東西 ⇒ 本檔其餘各格零判別力',
    ).toBe(1);
  });

  // ⚠️ 標題刻意寫「去拿了」而不是「帶著 JWT」—— 後者本檔證不到(理由見上面 dealerRpc 那段)。
  it('🔴 經銷會員 ⇒ 打的是【經銷那支 RPC】, 而且【去拿了】那個要帶 session 的 client', async () => {
    bothOk();
    await fetchCatalogPage(q(1), null, 'store');
    expect(dealerRpc, '沒有打經銷 RPC ⇒ 篩選與排序仍然用一般價算').toHaveBeenCalled();
    expect(
      dealerRpc.mock.calls[0]?.[0],
      'RPC 名字不對 ⇒ 它會打到公開那支, 而公開那支讀的是 products_list_public',
    ).toBe('search_catalog_by_vehicle_dealer');
    expect(verifiedUserCalls, '沒有去拿那個 client ⇒ 它會用 anon 打經銷 RPC(而那一定 RAISE)').toBe(1);
    // 🔴 而 anon 那條路一次都不該被碰 —— 用 anon client 打經銷 RPC 會撞身分閘。
    expect(anonClients, '經銷路徑建了 anon client ⇒ 那支 RPC 的 auth.uid() 會是 NULL ⇒ RAISE').toBe(0);
    expect(anonRpc).not.toHaveBeenCalled();
  });

  it('🔴 經銷會員 ⇒ 結果【不進快取】:連打兩次要真的打兩次 DB', async () => {
    bothOk();
    await fetchCatalogPage(q(1), null, 'store');
    await fetchCatalogPage(q(1), null, 'store');
    expect(
      dealerRpc.mock.calls.length,
      '第二發沒有真的去打 ⇒ 經銷的結果被記住了 ⇒ 它會被餵給下一個人',
    ).toBe(2);
    expect(cacheStore.size, '經銷那條路在共用快取裡留下了東西').toBe(0);
  });

  it('🔴🔴 **外洩那一格**:經銷先打過, 一般會員打【同一個網址】不得拿到他的結果', async () => {
    /**
     * 🎯 **這一格是整片的存在理由**, 而它需要**兩個人**才會發生
     * ⇒ 📌 **本機一個人怎麼點都點不出來** ⇒ 只有這種測試問得到它。
     * 🔵 用「回傳列數不同」當可分辨的印記:經銷那支回 1 列、公開那支回 0 列。
     *    ⇒ 一般會員若拿到 1 列 = 他吃到了經銷那一份。
     */
    dealerRpc.mockResolvedValue({
      data: [{ item: { id: 'p1', title: '經銷才看得到的那一份', price_general: 4800 }, total: 1 }],
      error: null,
    });
    anonRpc.mockResolvedValue({ data: [], error: null });

    const dealerView = await fetchCatalogPage(q(1), null, 'store');
    expect(dealerView.total, '⚪ 正對照:經銷那一發真的拿到了東西, 否則下一行的 0 沒有意義').toBe(1);

    const generalView = await fetchCatalogPage(q(1), null, 'general');
    expect(
      generalView.total,
      '🛑 一般會員拿到了經銷那一份 ⇒ 批發價外洩(CLAUDE.md Server 端鐵則)',
    ).toBe(0);
    expect(anonRpc, '一般會員那一發根本沒去打公開 RPC ⇒ 他吃的是快取裡的東西').toHaveBeenCalled();
  });

  it('🔴 經銷 RPC 失敗 ⇒ 回 error, 而【不得】退回公開那支', async () => {
    // 🛑 靜默退回長什麼樣:經銷客人打「5,000–10,000」, 系統拿【一般價】去篩,
    //    他看到的清單少了他買得起的東西 —— 而畫面上完全正常。
    //    ⇒ 紀律抄隔壁 `lib/tier-prices.ts:74` 逐字「不 catch 成空 —— 靜默退 general 是錢錯而它不會紅」。
    dealerRpc.mockRejectedValue(new Error('模擬:經銷 RPC 掛了(例如還沒貼進正式庫 ⇒ 42883)'));
    anonRpc.mockResolvedValue({ data: [], error: null });
    const out = await fetchCatalogPage(q(1), null, 'store');
    expect(out.error, '沒有回錯誤狀態 ⇒ 那一發失敗被吞掉了').toBe(true);
    expect(anonRpc, '🛑 退回公開那支了 ⇒ 拿一般價替經銷客人篩選, 而畫面上看不出來').not.toHaveBeenCalled();
  });

  it('🔵 不給 tier ⇒ 走公開那條(預設值要是【最不敏感】的那一個)', async () => {
    // 🛑 少了這一格,「預設走經銷」的實作在上面各格都不會紅 ——
    //    而那會讓每一個訪客都去撞經銷 RPC 的身分閘。
    bothOk();
    await fetchCatalogPage(q(3), null);
    expect(anonRpc, '不給身分時沒有走公開那條').toHaveBeenCalled();
    expect(dealerRpc, '不給身分時竟然走了經銷那條 ⇒ 預設值選錯邊了').not.toHaveBeenCalled();
  });
});
