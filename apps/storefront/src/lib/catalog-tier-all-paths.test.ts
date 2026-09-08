// @vitest-environment node
//
// ⟦front-CATALOGPRICEGENERALONLY⟧ **N 條路對同一個身分要給同一個答案。**
//
// 🔴🔴 **為什麼有這一支(病史, 不是設想)**:2026-09-08 那一片修了目錄頁,
//    而**同一個 `fetchCatalogPage` 有第二個呼叫端** —— `lib/brand-products.ts`(品牌頁)——
//    它**沒有傳身分** ⇒ 📌 **經銷會員在 `/products` 看到經銷價, 在 `/brands/<x>` 看到牌價**,
//    而**沒有任何東西會紅**:那時 `tier` 是 optional。
//    🎯 ⇒ **驗收要問的不是「每一條路各自對嗎」, 是「這 N 條路對同一個輸入給同一個答案嗎」。**
//
// 本檔兩層, **刻意分開**:
//   §A **行為層** — 已知的每一條路, 餵 `'store'` 要真的走到經銷 RPC。
//   §B **清冊層** — 有沒有**第 N+1 條路**悄悄長出來。
//   🛑 §A 對「明天新增的那條路」**零判別力** —— 它只認得它自己列出來的那幾條。
//      這正是 2026-09-08 漏掉品牌頁的形狀 ⇒ 所以 §B 不是錦上添花, 它守的是**分母**。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

// 直通快取:本檔問的是「打了哪一支 RPC」, 不問「有沒有被記住」(那是 catalog-dealer-not-cached.test.ts)。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

const anonRpc = vi.fn();
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  return { ...real, createSupabaseAnonClient: () => ({ rpc: anonRpc }) as never };
});

const dealerRpc = vi.fn();
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({ supabase: { rpc: dealerRpc }, user: { id: 'u1' }, error: null }),
  isNoSessionError: () => false,
}));

const { fetchCatalogPage } = await import('./products');
const { fetchBrandTopProducts } = await import('./brand-products');
const { parseCatalogQuery } = await import('./catalog-query');

const q = () => parseCatalogQuery({ get: () => null } as never);

beforeEach(() => {
  anonRpc.mockReset();
  dealerRpc.mockReset();
  anonRpc.mockResolvedValue({ data: [], error: null });
  dealerRpc.mockResolvedValue({ data: [], error: null });
});

/**
 * §A 的受測清單。**加一條路就在這裡加一行** —— 而 §B 會在你忘記加的時候紅。
 * `run(tier)` = 用那條路真正的入口函式跑一次。
 */
const PATHS: ReadonlyArray<{ name: string; run: (tier: 'general' | 'store') => Promise<unknown> }> = [
  { name: '路① 目錄頁 /products (fetchCatalogPage)', run: (t) => fetchCatalogPage(q(), null, t) },
  { name: '路③ 品牌頁 /brands/[slug] (fetchBrandTopProducts)', run: (t) => fetchBrandTopProducts('akrapovic', t) },
];

describe('§A 同一個身分, 每一條路走同一支 RPC', () => {
  it.each(PATHS)("🔴 $name · tier='store' ⇒ 走經銷 RPC", async ({ run }) => {
    await run('store');
    expect(dealerRpc, '這條路沒有去打經銷 RPC ⇒ 經銷會員在這一頁看到的是牌價').toHaveBeenCalled();
    expect(anonRpc, '這條路把經銷會員送去打公開 RPC ⇒ 拿牌價替他篩選排序, 而畫面完全正常').not.toHaveBeenCalled();
  });

  // 🟢 正對照:少了這一格,「每一條路都寫死走經銷」的壞實作在上面全綠。
  it.each(PATHS)("🟢 $name · tier='general' ⇒ 走公開 RPC", async ({ run }) => {
    await run('general');
    expect(anonRpc, '一般會員沒有走公開那條').toHaveBeenCalled();
    expect(dealerRpc, '一般會員被送去打經銷 RPC ⇒ 那支的身分閘會 RAISE, 每一頁都錯誤狀態').not.toHaveBeenCalled();
  });
});


// ────────────────────────────────────────────────────────────────────────────
// §C `premiumStore` —— **它走公開那條是【範圍選擇】, 不是缺口**
// ────────────────────────────────────────────────────────────────────────────
//
// 📎 出處:`docs/specs/2026-09-06-m2-08-dealer-tier-pricing-plan.md` §C 逐字
//   「⛔ 不做 `premiumStore`(**範圍選擇, 不是資料阻塞** —— 見事實 11)」。
//   ⇒ 📌 **`MemberTier` 的 union 裡有這個值, 不等於這一片承諾支援它的經銷價。**
//
// 🔴🔴 **這一格擋的不是「它拿牌價」, 是【有人好心把它接到經銷 RPC 上】**:
//   那支 RPC 的閘只認 `'store'`(`…_dealer_catalog_rpc.sql:158` 逐字 `IF v_tier IS DISTINCT FROM 'store' THEN RAISE`)
//   ⇒ 接上去 ⇒ **整頁錯誤狀態**, 比按範圍走公開價更糟。
//   ⇒ 🎯 **所以這一格的價值在【擋一個看起來像修好的改動】。**
//
// 🔵 **要真的支援 `premiumStore` 的人**:前端這個 if **不是**入口 —— 先動 DB 那一側
//   (RPC 的閘 + `products_list_dealer` 按 tier 給價), 那時這一格會紅, **而那時它該紅**。
//
// 🛑 **[病史 · 三輪審查在這一格互相打架, 留著免得重演]**
//   codex R2 把它列為 must-fix ⇒ 我加了一句每次都印的 `console.error`。
//   codex R3(換模型、問框架)打掉那個動作, 而我開檔核了上面那行 §C ⇒ **R3 對**:
//   **一個按計畫走的降級, 每次都印 error ⇒ 正常與故障混進同一個訊號。**
//   ⇒ ⛔ ~~一格「它必須出聲」的斷言~~ 已移除;behaviour 這兩格留著。
describe('§C premiumStore 的今天(範圍選擇, 有出處)', () => {
  it('🔴 premiumStore ⇒ 走【公開】RPC(按 M-2-08 §C 的範圍)', async () => {
    await fetchCatalogPage(q(), null, 'premiumStore');
    expect(anonRpc, '沒走公開那條 ⇒ 有人改了路由 ⇒ 先確認 DB 那一側的閘也改了').toHaveBeenCalled();
    expect(
      dealerRpc,
      '送 premiumStore 進經銷 RPC ⇒ 它的閘會 RAISE ⇒ 整頁錯誤狀態, 比按範圍走公開價更糟',
    ).not.toHaveBeenCalled();
  });

  // 🟢 正對照:少了這一格,「不管什麼 tier 都走公開」的實作在上面全綠 —— 而那會把 store 也弄壞。
  it('🟢 而 store 仍然走經銷那條(證明上面那格不是因為「全部都走公開」才綠)', async () => {
    await fetchCatalogPage(q(), null, 'store');
    expect(dealerRpc, 'store 也走公開了 ⇒ 上面那格的綠沒有判別力').toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §B 清冊層 —— **分母守門**
// ────────────────────────────────────────────────────────────────────────────
//
// ⚠️ **這把尺是【文字層】的, 它的限制寫在這裡, 不要讀寬**:
//    · 它只認**逐字** `fetchCatalogPage(` / `fetchBrandTopProducts(`。
//    · 改名匯入(`import { fetchCatalogPage as f }`)、`products.fetchCatalogPage(` 這種
//      成員存取, 它**看不見** ⇒ 🔴 **本節紅 = 一定有事;本節綠 ≠ 一定沒事。**
//    · 🔴 **第三種漏法, 而它與 2026-09-08 漏掉品牌頁是【同一個形狀換一層】**(reviewer 抓到):
//      §B 的分母是**檔**, 不是**呼叫點** ⇒ 在**已經列進 EXPECTED 的那三支檔裡面**新增一個
//      寫死 `'general'` 的 wrapper 給新 route 用 ⇒ **§B 恆綠, 而 §A 也看不到那條新路。**
//      ⇒ 📌 **一張列到檔為止的清單, 擋不住一個長在檔【裡面】的新入口。**
//    · 那個空白今天沒有更便宜的補法(要 AST)⇒ **明寫, 不假裝守到了。**

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** 掃到的**非測試**檔(相對 `src/`), 依 needle 逐字命中。 */
function filesCalling(needle: string): string[] {
  return walk(SRC)
    .filter((p) => readFileSync(p, 'utf8').includes(needle))
    .map((p) => p.slice(SRC.length + 1))
    .sort();
}

/**
 * 🔴 **已知的呼叫端清冊。每一行後面那句是「這條路的經銷會員看到哪個價」的答案。**
 * 加檔進來 ⇒ 你必須先回答那個問題, 才改得動這張表。
 */
const EXPECTED_FETCH_CATALOG_PAGE = [
  // 轉呼叫層:自己不決定身分, 由它的呼叫端給(見下一張表)。
  'lib/brand-products.ts',
  // /products:`resolveAuthenticatedTierStrict()` 解析後傳入。
  'app/products/page.tsx',
  // 🔵 定義處本身 —— 不是一條路。文字層的尺分不出「定義」與「呼叫」, 所以它留在表上。
  'lib/products.ts',
].sort();

const EXPECTED_FETCH_BRAND_TOP = [
  // 正式品牌頁:`resolveAuthenticatedTierStrict()` 解析後傳入。
  'app/brands/[slug]/page.tsx',
  // dev-preview 裸頁:寫死 'general'(量版面用, 不是客人動線;理由寫在那一行旁邊)。
  'app/dev-preview/brand-page/[slug]/page.tsx',
  // 定義處自己也含這個字面。
  'lib/brand-products.ts',
].sort();

describe('§B 有沒有第 N+1 條路悄悄長出來', () => {
  it('🟢 量具自檢:掃得到檔, 而假識別字回 0', () => {
    const scanned = walk(SRC);
    // 正對照:分母不是 0(掃錯目錄 / glob 打錯, 都在這裡露餡)。
    expect(scanned.length, '一支非測試檔都沒掃到 ⇒ 掃的不是 src/').toBeGreaterThan(100);
    // 負對照:現造的識別字(repo 裡不存在)必須回 0。
    expect(filesCalling('fetchCatalogPageZQ7X('), '假識別字有命中 ⇒ 這把尺在亂認').toEqual([]);
  });

  it('🔴 fetchCatalogPage 的呼叫端清冊沒有變', () => {
    expect(
      filesCalling('fetchCatalogPage('),
      '多出來的檔 = 一條【新的路】。先回答「這條路的經銷會員看到哪個價」, 再把它加進 EXPECTED。'
        + ' 少掉的檔 = 那條路被拿掉或改名了 ⇒ 順手把這張表改小。',
    ).toEqual(EXPECTED_FETCH_CATALOG_PAGE);
  });

  it('🔴 fetchBrandTopProducts 的呼叫端清冊沒有變', () => {
    expect(filesCalling('fetchBrandTopProducts('), '同上').toEqual(EXPECTED_FETCH_BRAND_TOP);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 🛑 **本檔【證不到】的四件事 —— 明寫, 免得它的綠被讀寬**
//   (⛔ ~~「三件事」~~ —— codex R2 抓到:標題寫三件而下面列五件。現在是四件, 因為
//    原本的 ③ `premiumStore` 已經從「證不到」升級成 §C 的兩格【釘住】+ 一格正對照。)
//   ① **關鍵字那條路**(`lib/search.ts` 的 `searchProducts`)**不在本檔**:
//      它今天沒有經銷版本, 篩選與排序仍吃牌價(`app/products/page.tsx` 那段註解逐字寫著),
//      而 `/search` 與搜尋疊層連疊價都沒有 ⇒ 🔴 **那是【已知缺口】, 不是本檔漏掉。**
//   ② 🔴🔴 **首頁與會員中心那兩條路也不在本檔**(2026-09-08 reviewer 抓到, 我複量過):
//      `lib/products.ts:343` 的 `fetchFeaturedProducts()` **釘死 general、不收 `tier` 參數**
//      (`app/account/page.tsx:347` 逐字寫著那是 perf/P3 的取捨:走 `unstable_cache` 60s)
//      ⇒ 呼叫端 `app/page.tsx:118`(首頁精選)與 `app/account/page.tsx:349`(會員中心「為你推薦」)
//      ⇒ 📌 **經銷會員在那兩頁看到的是牌價。**
//      🛑 **本片沒有修它** —— 它是一個**有理由的取捨**(拿掉 pin 就要處理快取分裂), 不是遺漏。
//      ⛔ ~~「有沒有被稱過, 是 Sean 的題」(= 還在等他)~~
//      🟢 **2026-09-08 Sean 已拍 `B` = 先不修, 落板記著**(主視窗 A 端;
//        板列 `docs/launch-todo.md` 的 `⟦front-FEATUREDRAILGENERALPRICE⟧`, 態 `parked`;
//        memory `project_0908-featured-shows-general-price-not-fixed`)。
//        **理由不是省事**:B2B 子網域做完之後這個問題會自己消失
//        ⇒ 📌 現在拆快取 = 修一個很快會被拆掉的地方。
//   ③ **那個 client 有沒有真的帶著 JWT** —— mock 沒有身分閘 ⇒ 本檔永遠成功
//      (姊妹檔 `catalog-dealer-not-cached.test.ts` 已逐字記過這個空白)。
//   ④ **畫面上印出來的數字** —— 本檔停在「打了哪一支 RPC」。
//
// 🔵 **而 `premiumStore` 從這一節【搬走了】** —— 它現在有 §C 三格(兩格釘住今天的行為 + 一格正對照)。
//   ⚠️ **搬走不等於修好**:§C 釘的是**今天的行為**, 而那個行為是錯的。
//   詳細與「為什麼不能只改前端」寫在 §C 的檔頭與 `lib/products.ts` 的 `premiumStore` 那一段。
// ────────────────────────────────────────────────────────────────────────────
