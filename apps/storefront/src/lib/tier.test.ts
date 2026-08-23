// tier.test.ts — `resolveTierFromRequest` / `resolveAuthenticatedTier` 單元測試
//   (M-1-13e-pre-1;`#215` 2026-08-23 認證化後重寫;codex R2 後再修 fixture)
//
// vi.mock('server-only') 防 vitest 載 tier.ts 時撞 server-only 模組 throw。
//
// 🔴🔴 **本檔最重要的一課(codex R2 M1)**:第一版的「訪客」fixture 餵的是
//    `{ data: { user: null } }`(無 error)—— **而真實的 supabase 不長那樣**。
//    📏 量到的:`@supabase/auth-js@2.105.3` 的 `getUser()` 在沒有 access_token 時逐字回
//    `{ data: { user: null }, error: new AuthSessionMissingError() }`。
//    ⇒ 我為了「兩個世界要印不同的東西」而設計的那個分辨機制,
//      **它的兩個世界是我自己 mock 出來的** ⇒ 真實世界裡每個訪客都會被記成故障。
//    **⇒ 本檔的訪客 fixture 一律帶 `AuthSessionMissingError`,不要退回無 error 的版本。**

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

// `vi.mock` 的 factory 會被提升到檔案最上面 ⇒ 它不能參照普通的 top-level const
// (實測 `ReferenceError: Cannot access 'getVerifiedUser' before initialization`)。
// `vi.hoisted` 就是為這件事存在的。
const { getVerifiedUser } = vi.hoisted(() => ({ getVerifiedUser: vi.fn() }));
vi.mock('@/lib/auth/verified-user', async () => {
  const actual = await vi.importActual<typeof import('./auth/verified-user')>('./auth/verified-user');
  return { getVerifiedUser, isNoSessionError: actual.isNoSessionError };
});

import { resolveTierFromRequest, resolveAuthenticatedTier } from './tier';

const single = vi.fn();
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

/** 未登入 —— **真實形狀**:user null **且** 帶 `AuthSessionMissingError`(見檔頭)。 */
function anonymous() {
  const err = Object.assign(new Error('Auth session missing!'), {
    name: 'AuthSessionMissingError',
    __isAuthError: true,
  });
  getVerifiedUser.mockResolvedValue({ supabase: { from }, user: null, error: err });
}
/** 認證那一層真的壞了(不是訪客):user null,而錯誤【不是】session missing。 */
function authFaulted() {
  const err = Object.assign(new Error('boom'), { name: 'AuthRetryableFetchError', __isAuthError: true });
  getVerifiedUser.mockResolvedValue({ supabase: { from }, user: null, error: err });
}
/** 登入,而 `customers.tier` 是 `tier`。 */
function signedInWith(tier: string) {
  getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-1' }, error: null });
  single.mockResolvedValue({ data: { tier }, error: null });
}

describe('resolveTierFromRequest — dev override(prod 硬閘)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('PCM_DEV_TIER_OVERRIDE=1 + ?tier=store → store', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    anonymous();
    expect(await resolveTierFromRequest({ tier: 'store' })).toBe('store');
  });

  it('🔴 prod 硬閘:NODE_ENV=production + flag=1 + ?tier=store + 未登入 → general', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    anonymous();
    expect(await resolveTierFromRequest({ tier: 'store' })).toBe('general');
  });

  // 🔴 正對照,不可省:上面那格單獨看,對「production 一律回 general、根本不查身分」也會過。
  it('🔴 prod 硬閘只殺 override、不吞身分:production + flag=1 + ?tier=general + 登入 store → store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    signedInWith('store');
    expect(await resolveTierFromRequest({ tier: 'general' })).toBe('store');
  });

  it('flag 關 + ?tier=store → 不走 override、走身分', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    signedInWith('premiumStore');
    expect(await resolveTierFromRequest({ tier: 'store' })).toBe('premiumStore');
  });

  // 🔴 **codex 2026-08-23 批 B must-fix 1**:我用「加一個 `?x-tier=store` 後門 ⇒ 14/14 全綠」
  //    證明了**舊**守門守不到 —— 而**修完之後那個後門還是不會紅**。
  //    ⇒ 我證明了病,而沒有證明藥。**這兩件事在交件上長得一樣。** 本格補藥。
  // ⚠️ **天花板**:下面那組鍵是**我列舉的**,不是窮舉。用一個我沒想到的鍵名開後門仍掃不到。
  //    ⇒ 結構那一半在 `scripts/storefront-tier-cookie-surface-guard.test.ts`(全樹字面),
  //      真請求層那一半在 backlog `#877`。**三道各有天花板,不要把任一道讀成完整。**
  it('🔴 除了 dev-gated 的 `?tier=` 之外,searchParams 的任何鍵都不得影響 tier', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', ''); // dev 後門關著
    // 🔴 **身分刻意用 `premiumStore`,不是 `general`(R3 must-fix)**:
    //    `general` 既是這一格的**輸入正常值**、又是所有退化路徑的**安全值**
    //    ⇒ 用它當期望值時,「實作整個壞掉、一律回 general」那一族**照樣綠**。
    //    ⇒ 換成 `premiumStore` 之後,六個壞鍵的判別力一格不減,而**多蓋那一族**。
    //    📌 形狀:**安全值正好是降級目標 ⇒ 這一族在這支檔特別容易長出來。**
    signedInWith('premiumStore');
    const clientBag = {
      'x-tier': 'store',
      tier: 'store',
      memberTier: 'general',
      pcm_tier: 'store',
      role: 'store',
      dealer: '1',
    };
    expect(await resolveTierFromRequest(clientBag)).toBe('premiumStore');
  });

  // 🔴 **乙:白名單(R3 選這條,而它釘的是承重點)**
  //    R3 量到:「任何鍵都不得影響 tier」這個保護,**今天住在「實作只讀一個鍵」這個事實裡**,
  //    不住在上面那六個鍵的列舉裡 —— 而**沒有任何東西釘住那個事實**。
  //    有人日後加第二處取用,上面那格只在新鍵剛好在名單內時才紅。
  // ⚠️ **天花板 —— 🔴 這一段是【量出來的】,不是我想出來的。**
  //    (原句寫「動態鍵與解構都掃不到」⇒ **兩個都錯**,R3 指出後我逐發消融,結果如下。)
  //    ```
  //    ① searchParams['x-tier']      ⇒ 🔴 抓得到(regex 的 `[` 那一支 ⇒ `<動態鍵>` ⇒ 本格紅)
  //    ② 整支改成解構(不再有 .tier)⇒ 🔴 抓得到(取用數掉到 0 ⇒ 正對照那格紅)
  //    ③ 保留 .tier + 解構一個【在列舉名單上】的鍵(dealer)⇒ 本格漏,而**列舉那格接住**
  //    ④ 保留 .tier + 解構一個【不在名單上】的鍵(wholesale)⇒ 🔴🔴 **兩格全綠**
  //       實測:`?wholesale=1` 就變經銷商,而 `tier.test.ts` **16/16 全過**
  //    ```
  //    ⇒ **真正的洞只有 ④ 一種**,而它需要同時避開兩道守門。
  //    ⇒ 補它的是 `#877`(真請求層行為守門),不是再多列幾個鍵 —— 見該 plan。
  //    📌 重跑法:把上面 ④ 那段插進 `tier.ts` 的 `const tierOverride =` 之前,跑本檔,看它是不是 16 passed。
  it('🔴 白名單:`tier.ts` 對 searchParams 的【取用】恰好一處,而且就是那個 dev-gated 的鍵', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./tier.ts', import.meta.url), 'utf8');
    // 只算「取值」:`searchParams.<鍵>` 或 `searchParams[...]`。型別宣告與 JSDoc 的 `searchParams` 不算。
    const reads = [...src.matchAll(/searchParams\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[)/g)];
    const keys = [...new Set(reads.map((m) => m[1] ?? '<動態鍵>'))];
    expect(keys, `對 searchParams 的取用不是只有 tier 一個。實際:${JSON.stringify(keys)}`).toEqual([
      'tier',
    ]);
    // ✅ 正對照:掃描器真的看得到東西(否則上面那格在「一個都沒掃到」時也會綠)
    expect(reads.length, '一處取用都掃不到 ⇒ 正規式與檔案已脫節').toBeGreaterThan(0);
  });

  it('override 值不合法("xyz")→ 不 throw、退 general', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    anonymous();
    expect(await resolveTierFromRequest({ tier: 'xyz' })).toBe('general');
  });
});

describe('🔴 `#215`:tier 只來自登入身分', () => {
  afterEach(() => vi.clearAllMocks());

  it('世界一:真的登入而 customers.tier=store → store(正對照,不可省)', async () => {
    signedInWith('store');
    expect(await resolveAuthenticatedTier()).toBe('store');
  });

  it('世界二:未登入(真實形狀:user null + AuthSessionMissingError)→ general', async () => {
    anonymous();
    expect(await resolveAuthenticatedTier()).toBe('general');
  });

  it('未登入時【不查 customers】—— 而正對照證明這把尺量得到「有查」', async () => {
    anonymous();
    await resolveAuthenticatedTier();
    expect(from).not.toHaveBeenCalled();

    vi.clearAllMocks();
    signedInWith('store');
    await resolveAuthenticatedTier();
    expect(from).toHaveBeenCalledWith('customers');
  });
});

describe('🔴 退化路徑:值相同(general),而【留下的痕】必須不同', () => {
  afterEach(() => vi.clearAllMocks());

  it('🔴 一般訪客【不留】錯誤日誌 —— 而 fixture 是真實形狀,不是「無 error」', async () => {
    anonymous();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveAuthenticatedTier()).toBe('general');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // 🔴 codex R5 must-fix 1:`user` **有值**而 `error` **也有值** —— 沒有人想過的那個世界。
  //    舊寫法先問 `!user` ⇒ 這種被錯誤污染的 user 會被當成已驗證、拿去查 tier、回 `store`。
  it('🔴 user 有值【而且】error 也有值(被污染的 user)⇒ 仍退 general,不得回經銷 tier', async () => {
    const err = Object.assign(new Error('boom'), {
      name: 'AuthRetryableFetchError',
      __isAuthError: true,
    });
    getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-1' }, error: err });
    single.mockResolvedValue({ data: { tier: 'store' }, error: null }); // DB 說他是經銷商
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveAuthenticatedTier()).toBe('general');
    expect(spy).toHaveBeenCalled();
    // 🔴 正對照:它是「先擋下來」而不是「查了之後才降級」⇒ customers 根本不該被查
    expect(from).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('認證層故障(非 session-missing)→ general **而且留 log**', async () => {
    authFaulted();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveAuthenticatedTier()).toBe('general');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('customers 查詢回 error(PGRST116 / RLS)→ general **而且留 log**(codex R2 M5)', async () => {
    getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-1' }, error: null });
    single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveAuthenticatedTier()).toBe('general');
    // 🔴 少了這一行,把整個 `if (error)` 刪掉本格仍會綠(data:null 會由下一行退 general)。
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 DB 回本版不認得的 tier → general **而且留 log**(靜默降級=無聲把經銷會員降級)', async () => {
    signedInWith('platinum_dealer');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resolveAuthenticatedTier()).toBe('general');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('🔴 例外不得往上拋(codex R2 M4:三個不同的位置各 reject 一次)', () => {
  afterEach(() => vi.clearAllMocks());

  // ⚠️ 這一族只證明「`resolveAuthenticatedTier` 不 reject」——
  //    **它沒有 render 首頁**,所以不宣稱「首頁不 500」(第一輪的過寬宣稱,R2 nit 抓到)。
  it('getVerifiedUser 整支 reject(factory / 網路 / 逾時)→ resolve 成 general + 留 log', async () => {
    getVerifiedUser.mockRejectedValue(new Error('factory 掛了'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveAuthenticatedTier()).resolves.toBe('general');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('customers 查詢自己 reject(不是回 error 物件)→ resolve 成 general + 留 log', async () => {
    getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-1' }, error: null });
    single.mockRejectedValue(new Error('連線逾時'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveAuthenticatedTier()).resolves.toBe('general');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
