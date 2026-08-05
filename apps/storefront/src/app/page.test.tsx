// @vitest-environment node
//
// 首頁區塊順序守門 — D5a(2026-08-05)
//
// 🔴 這支存在的理由:D5a 開工前實查,`app/` 底下**查無 `page.test.tsx`**
//    ⇒ 首頁 9 個元件的渲染順序**完全沒有守門**,把它們重排、對調、甚至刪掉一個,
//    既有測試(各元件自己的 smoke test)全部照樣綠。而 D5 這一整條線做的就是「重排」。
//    先寫這支、先證明它對**改動前的錯順序**會紅,再動 `page.tsx`(主視窗 C-74-A 指定的作法)。
//
// 慣例照 `app/brands/page.test.tsx` / `app/brands/[slug]/page.test.tsx`:
// node 環境、直接 await 呼叫 server component、`renderToStaticMarkup` 出真 HTML,
// 只 stub 掉會打真 DB / 需要 `server-only` 的東西。
// ⇒ 斷言的是**真的渲染出來的 DOM 順序**,不是 `page.tsx` 原始碼的文字順序。
//   (文字層守門擋不住「JSX 順序沒動、但某個元件內部改成條件不渲染」。)

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/Header', () => ({
  Header: function Header({ currentPage }: { currentPage?: string }) {
    return <div data-stub="site-header" data-current-page={currentPage} />;
  },
}));

// 🔴 必須 mock:這些模組會鏈到 `server-only` / 真 Supabase,vitest 載入即 throw 或打真 DB。
//    真資料那一面由各自的 lib 測試與真瀏覽器量測負責,本支只管「順序」。
// 🔴 `fetchCategories` **不能回空陣列**:`CategoryGrid.tsx:36` 是 `if (cats.length === 0) return null`
//    ⇒ 空 fixture 會讓 N°03 整段不渲染,順序斷言就變成在比一個少一格的陣列 = 弱斷言。
//    (第一版就是這樣、被本支自己的「八個都在」前提斷言抓出來,留著這段避免下一個人重踩。)
//    這正是 memory `feedback_fixture-value-makes-guard-vacuous` 那一族。
vi.mock('@/lib/products', () => ({
  fetchFeaturedProducts: () => Promise.resolve({ products: [], error: false }),
  fetchVehicleTaxonomy: () => Promise.resolve([]),
  fetchCategories: () =>
    Promise.resolve([
      { id: 'exhaust', name: '排氣系統', count: 12, children: [] },
      { id: 'brake', name: '煞車系統', count: 8, children: [] },
    ]),
}));
vi.mock('@/lib/brand-products', () => ({
  fetchBrandsWithProducts: () => Promise.resolve(new Set<string>()),
}));
vi.mock('@/lib/tier', () => ({ resolveTierFromRequest: () => Promise.resolve('general') }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
}));
vi.mock('@/lib/auth/composition', () => ({
  getVehicleRepo: () => Promise.resolve({ listByCustomer: () => Promise.resolve([]) }),
}));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(new Map()) }));
// `VehicleFinder` 是 client component、呼叫 `useRouter()`;在 server render 下沒有掛載 app router
// 會直接 throw `invariant expected app router to be mounted`。
// 🔴 這個 mock 是必要的:少了它,本支會**因為錯誤的理由變紅** —— 而「紅」正是我用來
//    證明守門有效的訊號,紅錯理由等於證明不成立(第一版就踩到,留著這段避免下一個人重踩)。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
// ⚠️ 這個 mock 的盲點(R2 nit,寫明邊界):它把整個 `next/navigation` 換掉 ⇒
//    本支對「導航行為」完全沒有判別力 —— 有人把 `router.push` 改成別的東西、或某元件開始依賴
//    `usePathname()` 的真值,這裡照樣綠。本支只負責**區塊順序與版面編號**,導航面由各元件自己的
//    測試(如 `VehicleFinder.test.tsx` 用 per-file mock 斷言 push 的 URL)與真瀏覽器負責。

import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_FOCUS, BRAND_FOCUS_PIN } from '@/data/brand-focus';
import { resolveBrandFocus } from '@/lib/brand-focus';

const { default: HomePage } = await import('./page');

async function homeHtml(): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));
}

/**
 * 各 section 的 root class(實查自各元件,2026-08-05):
 * 用 class 而不是文字內容當錨 —— 文字會因為 D5b-D5f 的字面統一一直變,class 是結構。
 */
const SECTION_CLASS = {
  hero: 'ed-hero',
  finder: 'ed-finder',
  editorial: 'ed-feature',
  cats: 'ed-cats',
  select: 'ed-select',
  statement: 'ed-statement',
  brands: 'ed-brands',
  footer: 'ed-footer',
} as const;

/** 依各 root class 在 HTML 裡的出現位置排序,得到實際 DOM 順序。 */
function renderedOrder(html: string): string[] {
  return Object.entries(SECTION_CLASS)
    .map(([key, cls]) => {
      // 比 `className="ed-hero"` 這種完整字面,避免 `ed-hero-inner` 之類子元素誤命中
      const idx = html.indexOf(`class="${cls}"`);
      return { key, idx };
    })
    .filter((s) => s.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => s.key);
}

describe('首頁 · 區塊順序(D5a)', () => {
  it('🔴 八個 section 全部有渲染出來(少一個 = 下面的順序斷言會變成弱斷言)', async () => {
    const html = await homeHtml();
    const order = renderedOrder(html);
    // 前提斷言:順序斷言只有在「八個都在」時才有意義。
    // 少了任何一個,`toEqual` 比的就是一個較短的陣列 —— 那不是「順序對」,是「東西不見了」。
    expect(order, `渲染出來的 section 少了:${
      Object.keys(SECTION_CLASS).filter((k) => !order.includes(k)).join(', ') || '(無)'
    }`).toHaveLength(8);
  });

  it('🔴 順序 = OD README「區塊順序(第 7 步之後)」定案', async () => {
    const html = await homeHtml();
    // README 定案:N°01 Hero+選車器 / N°02 最新商品 / N°03 部品分類 /
    //              N°04 服務宣言 / N°05 本月聚焦 / N°06 授權代理 / 頁尾
    // 節奏 = 白/白/深/白/淺灰白/深,沒有任何兩塊深色相鄰。
    expect(renderedOrder(html)).toEqual([
      'hero',
      'finder',
      'select', // N°02 最新商品(D5a 由第 5 上移)
      'cats', // N°03 部品分類
      'statement', // N°04 服務宣言(深)
      'editorial', // N°05 本月聚焦(D5a 由第 3 下移)
      'brands', // N°06 授權代理(淺灰白)
      'footer', // 頁尾(深;回石墨屬 D7)
    ]);
  });

  // 🔴 D5a code-reviewer R1 抓到的真回歸:我把區塊搬了位置,卻**沒有搬版面上看得見的 N° 編號**
  //    ⇒ 首頁一路讀下來變成 01 → 04 → 03 → 05 → 02 → 06。Sean 肉眼驗第一眼就會看到。
  //    OD `README.md` 逐字:「編號是**位置標記不是內容 id**,聚焦與服務對調後編號跟著位置走」。
  //    這條守的就是「順序搬了、編號沒跟上」——原本**零守門**,所以我改壞了也全綠。
  it('🔴 版面上看得見的 N° 編號 = 單調遞增 01..06(編號跟著位置走,不是跟著內容)', async () => {
    const html = await homeHtml();
    // 只取 `N°0X` 這種版面編號(finder 自己的 `01 ·` 是另一套、brief 問題 6 的撞號,不在本片範圍)
    const nums = [...html.matchAll(/N°(\d{2})/g)].map((m) => m[1]!);
    expect(nums, `抓到的編號序列 = ${nums.join(',')}`).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  // 🔴 D5d R3 的盲點修正:Q1=B 的不變量是「**首頁**對外不報品牌家數」,
  //    但我第一版把守門畫在「HomeStatement 這個元件的 textContent」上 —— 圈畫在
  //    「看到實例的那個檔」,不是畫在「不變量成立的那個面」。兩個具體後果:
  //    ① **attribute 全盲**:`alt` / `aria-label` / `title` 裡的家數宣稱報讀器與爬蟲都唸得到,
  //       一樣是對外宣稱,而 `textContent` 讀不到。D5f(Q2=A 已拍、下一片)要給 BrandIndex
  //       加 20 顆 logo `<img>`,最自然的寫法就是 `alt="20 家授權品牌"`。
  //    ② **元件面窄於決策面**:D5e 改 FeatureEditorial、D5f 改 BrandIndex,兩片都在圈外。
  //    ⇒ 這條掛在**整頁渲染出來的 HTML 字串**上(含 attribute),涵蓋八個 section。
  //    元件層那條(`HomeStatement.test.tsx`)保留:它會指出是「第 01 格」壞的、訊息更精準。
  it('🔴 整頁(含 attribute)不得出現未經查證的品牌家數宣稱(Q1=B 不報數;廣告不實風險)', async () => {
    const html = await homeHtml();
    // 前提斷言:HTML 真的渲染出來了,否則下面的負向斷言恆真
    expect(html.length, '整頁沒渲染出來 ⇒ 負向斷言恆真').toBeGreaterThan(1000);
    // 🔴 唯一豁免 = 服務宣言第 02 格那句「全台 9 家合作店家」——**不在 Sean 被問的 Q1 範圍內**、
    //    本片刻意未動(施工端不代刪事實宣稱)。這個豁免是承重的:那句字面一改,這條就會為它紅,
    //    屆時該做的是回頭問 Sean,**不是**把豁免字串跟著改。
    const EXEMPT = '全台 9 家合作店家';
    expect(html, `豁免字面「${EXEMPT}」不在了 ⇒ 第 02 格被改過,回頭確認是誰改的`).toContain(EXEMPT);
    // 比對整份 HTML(含屬性值)。pattern 不綁「品牌」二字,所以
    // `20 家國際品牌` / `20 多家品牌` / `20 家授權` 這類插修飾語或換詞的寫法都收。
    // ⚠️ 它擋不住什麼:國字數字(「八大品牌」「數十家」)、以及只存在於 client 端後續渲染的字。
    expect(
      html.replace(EXEMPT, ''),
      '首頁出現了家數宣稱 ⇒ 無可查證來源、屬廣告不實風險,要先問 Sean(Q1=B 是「不報數」)',
    ).not.toMatch(/[0-9０-９]+\s*[多餘]?\s*[大家個]/);
  });

  // 🔴 D5e-1 R2 must-fix:本月聚焦的**呼叫點**(`page.tsx` 那顆 `resolveBrandFocus({...})`)
  //    全 repo 只有一個,而它以前零斷言覆蓋。具體失敗情境:把 `override: BRAND_FOCUS_PIN`
  //    刪掉、或 `overlays` 誤傳 `{}` ⇒ 首頁改顯 AKRAPOVIČ、標題退成品牌名、`photo` 變 null
  //    ⇒ **整個媒體欄不渲染**(版位少一半),而 `lib/brand-focus.test.ts` 全綠(它自己傳參數)、
  //    上面那條「八個 section」也全綠(少的是 section **內部**的媒體欄,不是 section 本身)。
  //    ⇒ 這條驗的是「頁面真的把 PIN 與 overlays 接進去了」。
  it('🔴 本月聚焦的接線正確:頁面吃到的 = 同一顆 resolveBrandFocus 算出來的(含覆蓋層)', async () => {
    const html = await homeHtml();
    // 🔴 期望值**用同一顆決策函式現算**,不寫死 `RIZOMA` / `工藝之鏡`(R3 F3):
    //    寫死的話,D5e-2 把 PIN 改成 undefined 之後這支會變成**每 3 天自己轉紅**的時鐘依賴斷言,
    //    而急著修的人多半會把它弱化成「有 ed-feature 就好」= 這條就白寫了。
    //    現算之後,這條驗的是「頁面真的把 PIN 與 overlays 接進去了」,與今天是第幾期無關。
    const expected = resolveBrandFocus({
      brands: BRAND_CONTENT,
      overlays: BRAND_FOCUS,
      now: new Date(),
      override: BRAND_FOCUS_PIN,
    })!;
    // 🔴 切界要收到下一個 section 為止(R3 F5):切到文件尾會把 BrandIndex 圈進來,
    //    而 `BrandIndex` 每一列也是 `/products?brand=<slug>` ⇒ 那家一有商品,CTA 那條斷言
    //    就會改由 BrandIndex 滿足、對本元件失去判別力。
    const start = html.indexOf('class="ed-feature"');
    const end = html.indexOf('class="ed-brands"');
    expect(start, '找不到 ed-feature 區塊').toBeGreaterThanOrEqual(0);
    expect(end, '找不到 ed-brands(切界抓不到下界)').toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section.length, '切出來的區塊短得不像一個 section').toBeGreaterThan(200);

    expect(section, '標題沒有帶當期品牌名 ⇒ PIN 沒接上').toContain(`${expected.name}.`);
    expect(section, 'CTA 沒指向當期品牌').toContain(`/products?brand=${expected.slug}`);
    // 🔴 覆蓋層真的被吃到:退回 fallback 的話 title 會等於品牌名
    expect(expected.title, '前提:當期這一家真的有 overlay(否則下一條零判別力)').not.toBe(expected.name);
    expect(section, '標題退化成品牌名 ⇒ overlays 沒接上').toContain(expected.title);
    // 🔴 媒體欄要在:photo 解不出來時整欄不渲染,而那正是接線錯的主要症狀
    expect(section, '媒體欄不見了 ⇒ photo 解不出來(overlays 沒接上?)').toContain('ed-feature-media');
  });

  it('🔴 兩塊深色不相鄰(README「配色的三條規則」的節奏前提)', async () => {
    const html = await homeHtml();
    const order = renderedOrder(html);
    // 深色場 = hero(照片深)/ statement(石墨)/ footer(石墨)。
    // 這條擋的是「順序看起來對、但有人把某塊深色搬到另一塊深色旁邊」——
    // 那會讓整頁下半段連成一大片深色(README 第 7 步「深色減重」處理掉的正是這個)。
    const DARK = new Set(['hero', 'statement', 'footer']);
    for (let i = 0; i < order.length - 1; i += 1) {
      const a = order[i]!;
      const b = order[i + 1]!;
      expect(DARK.has(a) && DARK.has(b), `${a} 與 ${b} 兩塊深色相鄰`).toBe(false);
    }
  });
});
