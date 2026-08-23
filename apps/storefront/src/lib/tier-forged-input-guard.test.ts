// tier-forged-input-guard.test.ts — `#877` 偽造 client 輸入的【行為守門】
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 它為什麼存在(證據是量到的,不是推的)
// ════════════════════════════════════════════════════════════════════════════
// `#215` 之後,`tier.ts` 旁邊有兩道守門,而它們對「把 client 輸入接回身分」
// **同時漏掉一種形狀**(2026-08-23 B 窗四發消融,原文在 `tier.test.ts` 搜「天花板」):
// ```
// 保留 .tier(白名單那格照樣綠) + 另外解構一個【不在列舉名單上】的鍵
// 實測:const { wholesale: sneaky } = searchParams; if (sneaky === '1') return 'store';
// ⇒ tier.test.ts 16/16 全過, 而那份碼有一個 `?wholesale=1` 就變經銷商的後門
// ```
// 🔴 **補它的不是再多列幾個鍵** —— 列舉永遠會有下一個鍵。
//    本檔改成:**餵一個【對任何鍵都回答攻擊值】的輸入物件**,再問「身分有沒有被改掉」。
//    ⇒ 它不需要知道後門用哪個鍵名。
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 它裝在哪一層,以及為什麼不是 HTTP 層(plan §3 要求寫下來)
// ════════════════════════════════════════════════════════════════════════════
// plan 列了三條路。**量完之後選的是第四條**,理由逐條:
// ```
// 甲 真伺服器 curl:量得到 HTTP 層, 但 ① 正對照要「真的登入的經銷帳號」(plan 自陳未確認)
//    ② 它要 storefront-probe 整條鏈才跑得起來 ⇒ **CI 跑不到**
//    ⇒ 一道 CI 跑不到的守門, 它紅的那天沒有人在看
// 乙 Next 的 request-scope 公開 API:Next 沒有給測試用的公開入口
//    (`cookies()` 在單元環境逐字 throw `cookies was called outside a request scope`)
//    ⇒ 唯一的做法是 mock 掉 `next/headers`, 而那就是下面「丁」在做的事
// 丙 RSC 層 render:本 repo 無此體例, 而它的分母仍只有 page.tsx 一個呼叫端
// 丁 ✅ **敵意輸入層(本檔)**:在【輸入進入 tier 解析的那個邊界】餵敵意值
//    —— searchParams 換成 Proxy, `next/headers` 換成「任何 cookie / header 都回答攻擊值」
//    ⇒ 跟著既有 vitest 跑, 每次 CI 都量, 而且不靠列舉鍵名
// ```
// 🔴🔴 **注意 plan §1 的警告,而本檔正好走在它的反面**:
//    plan 量到「mock 掉 `next/headers` 會把洞蓋起來」——
//    那是指**為了讓一個不相干的紅變綠而 mock**。
//    本檔的 mock 是**敵意的**:它讓 cookie 這條路變得【更好走】,然後斷言 tier 沒被改掉。
//    ⇒ 有人接回 cookie ⇒ 本檔紅。**方向相反。**
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ 天花板(照實寫;它守不到的)
// ════════════════════════════════════════════════════════════════════════════
//  · **分母 = 兩個輸入面**:`resolveTierFromRequest` 的 searchParams 參數,與 `next/headers`
//    (cookies / headers / draftMode)。走第三條管道進來的 client 輸入(例如日後改成
//    收一個 `Request` 物件)**本檔看不到** —— 那時要在這裡補一面,不是加鍵名。
//  · **旁路整支 helper**(有人在 `page.tsx` 自己算 tier)本檔量不到 ⇒ 那是
//    `scripts/storefront-tier-cookie-surface-guard.test.ts` 的全樹字面掃描在守。
//  · **攻擊值是四個字串**(下面 `FORGED_VALUES`)。有人寫
//    `if (searchParams.x === 'MAGIC') return 'store'` 而 `MAGIC` 不在其中 ⇒ 漏。
//    ✅ `has` trap 讓「**只看鍵在不在**」那一族被蓋到。
//  · 🔴🔴 **不要把上面讀成「所以只剩魔術值一種」** —— 那句話我寫過,而它是錯的
//    (a2 R2 must-fix)。它錯得很典型:**一句把剩餘風險收斂成「只剩 N 種」的話,
//    會讓下一個人不去找第 N+1 種。** 已知還有的至少包括:
//      · **列舉族**:遍歷 `Object.entries(searchParams)` 去找一個不在我 `ownKeys` 清單上的鍵
//        ⇒ 這一族**已在下面「不得列舉」那一格關掉**(關的是「准不准問鍵清單」,不是列更多鍵名)
//      · **魔術值族**:比對一個不在 `FORGED_VALUES` 裡的特定值 ⇒ **仍然開著,機制上堵不死**
//      · **第三族**:`get` / `has` 兩個 trap 對 `then` 與 symbol 鍵一律回 undefined / false
//        (技術上必要 —— 不排除的話這個 Proxy 會被當成 thenable,`await` 它會掛住,
//        而那會讓本檔**紅錯理由**)⇒ **鍵名恰為 `then` 或一個 Symbol 的後門在盲區。**
//        📏 這一條是 a2 R2 nit,逐字收下。
//      · 🔴🔴 **而上面那三族【不是完整清單】** —— 第三族目前只是「已知兩個入口」,
//        **這個集合沒有封閉**,我也不知道第四族是什麼。
//        這句是本段最重要的一句,不要刪掉它,**也不要把它改寫成「共 N 族」**:
//        把一個未封閉的集合寫成封閉的,正是本段上面剛拆掉的那種句子。
//  · **登入之後的那一段不在本檔**:本檔固定用一個已登入的 `premiumStore` 身分。
//    `customers.tier` 讀取路徑本身由 `tier.test.ts` 守。
//
// 📌 **正對照為什麼是 `premiumStore` 而不是 `general`**(照 `tier.test.ts:94-98` 那一課):
//    `general` 既是攻擊失敗的期望值、又是所有退化路徑的安全值
//    ⇒ 拿它當期望值時,「實作整個壞掉、一律回 general」那一族**照樣綠**。

// ════════════════════════════════════════════════════════════════════════════
// 📏 消融實測(2026-08-24 B 窗;**這張表是量到的,不是推的**)
// ════════════════════════════════════════════════════════════════════════════
// 做法:`git show HEAD:tier.ts` 取對照組(不用 .bak —— .bak 存對與存錯在檔案上長得一樣),
//       把後門插進 `const tierOverride =` 之前,兩支守門各跑一次,跑完寫回並 `git diff --quiet` 驗還原。
// ```
// 突變                              #877 本檔            tier.test.ts(既有)
// M1 解構 wholesale(不在名單上)      🔴RED 斷言          綠 ← 🔴 這就是本檔存在的理由
// M2 searchParams['x-tier']         🔴RED 斷言          🔴RED 斷言
// M3 'wholesale' in searchParams    🔴RED 斷言          綠 ← 🔴 第二個漏
// M4 讀回 pcm-tier cookie           🔴RED 斷言          🔴RED **但紅錯理由**
// M5 讀回 x-tier header             🔴RED 斷言          🔴RED **但紅錯理由**
// M6 Object.entries 找 'zzsecret'   🔴RED 斷言          綠 ← a2 R2 抓到的「形狀 C」
// 未突變                            綠(9/9)            綠
// ```
// 📌 **M6 是審查者抓的,不是我**:第一版 `ownKeys` 回一份寫死的六鍵清單 ⇒ 遍歷去找一個
//    不在清單上的鍵就逃掉了(實測兩道守門全綠)。修法**不是把清單列長**,是禁掉「問鍵清單」
//    這個動作本身(見下面「不得列舉」那一格)。**六發全部紅在斷言上,未突變 9/9 綠。**
// 🔴🔴 **M4/M5 那兩格是本片最重要的一課**:既有守門確實會紅,而它的訊息逐字是
//    `` `cookies` was called outside a request scope `` —— **那是環境錯誤,不是「有人偵測到偽造」**。
//    ⇒ 修好那個紅最自然的動作是 `vi.mock('next/headers')` 讓它閉嘴,
//      **而那個動作正好把洞蓋起來**。本檔改成敵意 mock,就是為了讓同一個位置紅在對的理由上。
//
// ⚠️ **我自己在量這張表時踩過一次**:第一版把 import 插在 `import 'server-only';` 之後 ——
//    而那個字串在檔頭**註解裡先出現一次** ⇒ import 被插進註解 ⇒ 語法爆掉 ⇒
//    兩支守門都「紅」,而那是 PARSE_ERROR。**一個無效的突變會產出一張漂亮而全錯的表。**
//    ⇒ 判別法已寫進上面那支腳本:失敗訊息要分類,不能只看 exit code。

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { getVerifiedUser, cookiesCalls, headersCalls, ownKeysCalls, forged } = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  cookiesCalls: { n: 0 },
  headersCalls: { n: 0 },
  // 🔴 a2 R2 must-fix:`ownKeys` 是**寫死的清單** ⇒ 它自己就是一個搬了位置的列舉。
  //    ⇒ 不去猜「還有哪些鍵」,改成**數它有沒有被問**(見下面「不得列舉」那一格)。
  ownKeysCalls: { n: 0 },
  // hoisted 的可變盒子:讓每一輪 case 換掉「敵意來源回答什麼」。
  forged: { value: 'store' },
}));

vi.mock('@/lib/auth/verified-user', async () => {
  const actual = await vi.importActual<typeof import('./auth/verified-user')>('./auth/verified-user');
  return { getVerifiedUser, isNoSessionError: actual.isNoSessionError };
});

/**
 * 🔴 **敵意的 `next/headers`**:任何 cookie 名、任何 header 名都回答攻擊值。
 * Next 15+ 的 `cookies()` / `headers()` 回 Promise ⇒ 這裡回一個**同時是 thenable、
 * 又直接帶方法**的物件,`await` 與不 `await` 兩種寫法都接得住(否則實作用了另一種
 * 寫法時本檔會因為 TypeError 而**紅錯理由**)。
 */
function hostileStore(kind: 'cookie' | 'header') {
  const api = {
    get: (name: string) => (kind === 'cookie' ? { name, value: forged.value } : forged.value),
    getAll: (name?: string) =>
      kind === 'cookie' ? [{ name: name ?? 'any', value: forged.value }] : [forged.value],
    has: () => true,
    entries: () => [['any', forged.value]][Symbol.iterator](),
    keys: () => ['any'][Symbol.iterator](),
    values: () => [forged.value][Symbol.iterator](),
    [Symbol.iterator]: () => [['any', forged.value]][Symbol.iterator](),
  };
  return Object.assign(Promise.resolve(api), api);
}

vi.mock('next/headers', () => ({
  cookies: () => {
    cookiesCalls.n += 1;
    return hostileStore('cookie');
  },
  headers: () => {
    headersCalls.n += 1;
    return hostileStore('header');
  },
  draftMode: () => Object.assign(Promise.resolve({ isEnabled: true }), { isEnabled: true }),
}));

import { resolveTierFromRequest } from './tier';

const single = vi.fn();
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

/** 真的登入,而 `customers.tier` = premiumStore(= 本檔的正對照身分)。 */
function signedInAsPremiumStore() {
  getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-1' }, error: null });
  single.mockResolvedValue({ data: { tier: 'premiumStore' }, error: null });
}

/**
 * 🔴 **敵意的 searchParams**:對**任何**鍵回答攻擊值,而且
 * `in` / `Object.keys` / `Object.entries` 也都回答得出東西。
 * ⇒ 後門用哪個鍵名都躲不掉,不必列舉。
 *
 * ⚠️ `then` 與 symbol 一律回 `undefined` —— 否則這個物件會被當成 thenable,
 *    `await` 它會掛住,而那會讓本檔**紅錯理由**。
 */
function hostileSearchParams(readKeys: string[]) {
  const desc = { value: forged.value, writable: true, enumerable: true, configurable: true };
  return new Proxy({} as Record<string, string>, {
    get(_t, key) {
      if (typeof key === 'symbol' || key === 'then') return undefined;
      readKeys.push(key);
      return forged.value;
    },
    has(_t, key) {
      if (typeof key === 'symbol' || key === 'then') return false;
      readKeys.push(key);
      return true;
    },
    ownKeys: () => {
      ownKeysCalls.n += 1;
      // ⚠️ 這份清單**是列舉**,而它擋不住「遍歷去找一個不在清單上的鍵」。
      //    真正擋那一族的是下面那一格(斷言這個 trap 根本不該被呼叫)。
      return ['tier', 'wholesale', 'x-tier', 'dealer', 'role', 'memberTier'];
    },
    getOwnPropertyDescriptor: () => desc,
  });
}

/** 攻擊值:tier 字面、以及「開關型」後門常用的真值。 */
const FORGED_VALUES = ['store', 'premiumStore', '1', 'true'];

describe('🔴 `#877` 偽造 client 輸入 ⇒ tier 必須仍然來自登入身分', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    cookiesCalls.n = 0;
    headersCalls.n = 0;
    ownKeysCalls.n = 0;
    forged.value = 'store';
  });

  for (const value of FORGED_VALUES) {
    it(`任何 searchParams 鍵都回答 "${value}" ⇒ 仍然是 premiumStore(不是 store、也不是 general)`, async () => {
      // dev 後門關著 —— `?tier=` 那條路是**刻意存在**的,不在本檔的靶上。
      vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
      forged.value = value;
      signedInAsPremiumStore();
      const readKeys: string[] = [];

      const tier = await resolveTierFromRequest(hostileSearchParams(readKeys));

      expect(
        tier,
        // 🔴 鍵清單是空的 ⇒ 洞不在 searchParams 這一面, 看 cookies/headers 的次數。
        //    (少了這半, 一個 cookie 造成的紅會被讀成 searchParams 的問題。)
        `偽造輸入改掉了 tier。searchParams 問過的鍵:${JSON.stringify([...new Set(readKeys)])};` +
          ` cookies() ${cookiesCalls.n} 次、headers() ${headersCalls.n} 次`,
      ).toBe('premiumStore');
    });
  }

  it('🔴 任何 cookie / header 都回答 "store" ⇒ 仍然是 premiumStore', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    signedInAsPremiumStore();

    const tier = await resolveTierFromRequest({});

    expect(
      tier,
      `偽造 cookie/header 改掉了 tier(cookies() 被叫 ${cookiesCalls.n} 次、headers() ${headersCalls.n} 次)`,
    ).toBe('premiumStore');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 🔴 a2 R2 must-fix 的【碼層】修法 —— 而它不是把清單列長
  // ════════════════════════════════════════════════════════════════════════
  // a2 實測抓到:上面 Proxy 的 `get` / `has` 兩個 trap 真的是「任何鍵」,
  // **而 `ownKeys` 是寫死的六個鍵** ⇒ 那一格本身就是一個【搬了位置的列舉】。
  // 逃法(a2 的形狀 C,我重跑確認**兩道守門都綠**):
  // ```
  // for (const [k, v] of Object.entries(searchParams)) {
  //   if (k === 'zzsecret' && v === '1') return 'store';
  // }
  // ⇒ 'zzsecret' 不在我的 ownKeys 清單上 ⇒ 迴圈根本看不到它 ⇒ 全綠, 而後門是真的
  // ```
  // 🔴 **而「把清單列長」修不好它** —— 下一個鍵名永遠在清單外面。
  //    ⇒ 改成問一個**不需要知道鍵名**的問題:**你憑什麼要列舉這個物件?**
  //    tier 解析路徑合法的動作只有「讀那個 dev-gated 的 `tier` 鍵」;
  //    去拿它的**鍵清單**(`Object.keys` / `Object.entries` / 展開 `{...sp}` / `for...in`)
  //    在這條路上沒有正當用途 ⇒ 直接禁掉,列舉族整族關掉,而不是逐個猜。
  //
  // ⚠️ **本格的天花板**:它管的是**我遞進去的那個物件**。
  //    有人把 searchParams 先複製到別處再列舉那個副本 ⇒ 複製那一步會觸發 `ownKeys` ⇒ 仍接得住;
  //    但有人列舉的是**別的東西**(例如自己 parse 一份 URL)⇒ 本格看不到。
  it('🔴 tier 解析路徑【不得列舉】searchParams —— 列舉族用「不准問鍵清單」關掉,不是把清單列長', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    signedInAsPremiumStore();

    await resolveTierFromRequest(hostileSearchParams([]));

    expect(
      ownKeysCalls.n,
      '有人向 searchParams 要了鍵清單(Object.keys / entries / 展開 / for...in)。' +
        '這條路只准讀那個 dev-gated 的 `tier` 鍵 —— 遍歷找鍵名正是繞過列舉式守門的做法。',
    ).toBe(0);
  });

  // ✅ **正對照的正對照**:證明上面那些格子量得到「身分真的被讀出來」,
  //    而不是在一個「無論如何都回 premiumStore」的世界裡空轉。
  //    ⚠️ 沒有這一格,把 `signedInAsPremiumStore` 改成永遠回 premiumStore 也全綠。
  it('✅ 正對照:這條路真的有去查 `customers` —— 否則上面每一格都失去判別力', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    signedInAsPremiumStore();

    await resolveTierFromRequest(hostileSearchParams([]));

    expect(from).toHaveBeenCalledWith('customers');
  });

  // ✅ **負對照**:同一條路,身分換成 store ⇒ 結果就換成 store。
  //    ⇒ 上面的期望值是**跟著身分走的**,不是寫死的常數。
  it('✅ 負對照:身分換成 store ⇒ 結果跟著換(期望值不是寫死的)', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    getVerifiedUser.mockResolvedValue({ supabase: { from }, user: { id: 'u-2' }, error: null });
    single.mockResolvedValue({ data: { tier: 'store' }, error: null });

    expect(await resolveTierFromRequest(hostileSearchParams([]))).toBe('store');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 格2:輸入【管道】的白名單 —— 補集,不是重複
// ════════════════════════════════════════════════════════════════════════════
// 上面每一格都是行為守門,而它們的分母 = **我有辦法假造的那些管道**
// (searchParams 參數 + `next/headers`)。日後有人開**第三條管道**
// (例如收一個 `Request`、或走 `next/server` 的 `connection()`)⇒ 上面全綠,因為
// 我的敵意來源根本沒接上那條路。
//
// ⇒ 本格釘的不是「值對不對」,是**這支檔准許從哪些模組拿東西**。
//    形狀抄 `tier.test.ts:127` 那格白名單(R3 選它的理由相同:
//    保護今天住在「實作只有這幾條進料口」這個事實裡,而沒有東西釘住那個事實)。
//
// ⚠️ **天花板**:它是【字面掃描 import 敘述】。
//    · 有人用 `await import(someVariable)` 動態組模組名 ⇒ 掃不到。
//    · 有人透過**自己寫的 helper** 間接讀 cookie ⇒ 本格掃不到,
//      **但上面的行為格接得住**(`next/headers` 的 mock 是全域的,不管誰 import 它)。
//    · 它會**誤紅**:有人正當地在這支檔加一個新 import ⇒ 紅。
//      那是刻意的 —— 紅的時候請去讀上面那段,判斷新管道要不要一起假造。
describe('🔴 `#877` 格2:`tier.ts` 的進料口白名單', () => {
  it('tier.ts 只從這幾個模組拿東西 —— 多一條進料口就要重新想一次敵意來源', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./tier.ts', import.meta.url), 'utf8');
    // `import type` 與值 import 可能指同一個模組(現樹 `@pcm/domain` 就是)⇒ 本格問的是
    // 【哪些模組】不是【幾行 import】⇒ 去重。
    const stmts = [...src.matchAll(/^\s*import\s[^\n]*?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const mods = [...new Set(stmts)];
    expect(mods, `tier.ts 的 import 清單變了。實際:${JSON.stringify(mods)}`).toEqual([
      'server-only',
      '@pcm/domain',
      '@/lib/auth/verified-user',
    ]);
    // ✅ 正對照:掃描器真的看得到東西(否則「一個都沒掃到」時本格也會綠)
    expect(stmts.length, '一個 import 都掃不到 ⇒ 正規式與檔案已脫節').toBeGreaterThan(0);
  });
});
