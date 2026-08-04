// @vitest-environment node
//
// /brands/[slug] route test — D3a(2026-08-04)
//
// 走 repo 既有的 route 測試慣例(`app/checkout/callback/page.test.tsx`):直接呼叫 server component、
// 不靠 Next.js runtime。差別是這裡**真的 render 成 HTML** —— 因為要驗的就是「route 輸出的 HTML
// 含 `.bp-page`」(backlog #314 的「`.bp-page` scope 上機制、不靠人記」那條前置,
// `docs/phase-1-backlog.md:8403`)。只 stub `<Header>`:它是 client 元件、吃 CartContext,
// 與本檔要驗的東西無關,留著只會讓失敗訊息指向錯的地方。
//
// 🔴 `<HomeFooter>` **不 stub** —— 頁尾標語(per-brand slogan)的接線正是本片新加的東西,
//    stub 掉就只剩「有傳 prop」這種形狀斷言,證不到「那句話真的出現在頁面上」。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/components/Header', () => ({
  Header: function Header() {
    return <div data-stub="site-header" />;
  },
}));

import BrandPage, { generateMetadata, generateStaticParams } from './page';
import { BRAND_CONTENT } from '@/data/brand-content';
import { brandRichTextToPlain, parseBrandRichText } from '@/lib/brand-rich-text';

afterEach(() => {
  vi.clearAllMocks();
});

/** React 的 SSR 逸出集合(`renderToStaticMarkup` 會做的那五個);中文本身不逸出。 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const params = (slug: string) => Promise.resolve({ slug });
const markupFor = async (slug: string) => renderToStaticMarkup(await BrandPage({ params: params(slug) }));

describe('/brands/[slug] · 前提', () => {
  it('🔴 20 家真資料;`slogan` 每家都非空(頁尾標語的資料來源,空的話下面那條會恆真)', () => {
    expect(BRAND_CONTENT).toHaveLength(20);
    for (const brand of BRAND_CONTENT) {
      expect(brandRichTextToPlain(brand.slogan).trim(), brand.slug).not.toBe('');
      expect(brandRichTextToPlain(brand.lede).trim(), brand.slug).not.toBe('');
    }
  });
});

describe('/brands/[slug] · generateStaticParams', () => {
  it('20 家全列,且與 BRAND_CONTENT 同一份 slug', () => {
    expect(generateStaticParams()).toEqual(BRAND_CONTENT.map((b) => ({ slug: b.slug })));
  });
});

describe('/brands/[slug] · 找不到的 slug', () => {
  it('未知 slug → notFound()', async () => {
    await expect(markupFor('does-not-exist')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  // 🔴 `BRAND_BY_SLUG` 是 `Object.fromEntries` 產的普通物件 ⇒ 原型鏈上的 key 取得到且 truthy。
  //    用 `if (!brand)` 這種守門的話,`/brands/constructor` 會渲染出一頁 `class="… undefined"` 的空框
  //    而不是 404(memory `reference_js-index-lookup-hits-prototype-chain`:本 repo 五個頁面真的中過)。
  //    這四個字串是**刻意**餵的,不是湊數。
  it('🔴 原型鏈 key(constructor / __proto__ / toString / valueOf)→ 一律 notFound()', async () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
      await expect(markupFor(key), key).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('/brands/[slug] · metadata', () => {
  it('🔴 title 字面 = 設計稿 `brand-page.html:1615` 的 document.title(全形直豎線)', async () => {
    for (const brand of BRAND_CONTENT) {
      const meta = await generateMetadata({ params: params(brand.slug) });
      expect(meta.title, brand.slug).toBe(`${brand.name} 品牌介紹｜PCM MOTOR PARTS LTD.`);
      // 半形 | 是最容易手滑寫成的版本,釘住它
      expect(String(meta.title), brand.slug).not.toContain('|');
    }
  });

  it('🔴 description = lede 的純文字 —— 不得殘留 `<strong>` / `<br>` 之類的標記', async () => {
    for (const brand of BRAND_CONTENT) {
      const meta = await generateMetadata({ params: params(brand.slug) });
      expect(meta.description, brand.slug).toBe(brandRichTextToPlain(brand.lede));
      expect(meta.description, brand.slug).not.toMatch(/<[a-z/]/i);
    }
  });

  it('canonical / OG url 指向自己這條 route,OG 圖是該品牌的橫幅照', async () => {
    // test 環境 NODE_ENV != production 且未設 NEXT_PUBLIC_SITE_URL ⇒ resolveSiteUrl() = localhost:3000
    // (`lib/site-url.ts` 檔頭逐字)。這裡驗的是「組出來的路徑對」,不是驗那個 base 值。
    const brand = BRAND_CONTENT.find((b) => b.band)!;
    const meta = await generateMetadata({ params: params(brand.slug) });
    expect(meta.alternates?.canonical).toBe(`http://localhost:3000/brands/${brand.slug}`);
    expect(meta.openGraph?.url).toBe(`http://localhost:3000/brands/${brand.slug}`);
    expect(JSON.stringify(meta.openGraph?.images)).toContain(`/brand-assets/${brand.band!.src}`);
  });

  it('未知 slug 的 metadata 不 throw、回可辨識的標題(Next 會先呼 generateMetadata 再 render)', async () => {
    expect((await generateMetadata({ params: params('does-not-exist') })).title).toBe(
      '品牌不存在 — PCM Motorsports',
    );
  });
});

describe('/brands/[slug] · 輸出的 HTML', () => {
  it('🔴 含 `.bp-page`(#314 的 `.bp-page` scope 前置:漏掛時整頁色票沉默降級,沒有任何東西會紅)', async () => {
    for (const brand of BRAND_CONTENT) {
      expect(await markupFor(brand.slug), brand.slug).toContain('class="bp-page"');
    }
  });

  it('掛了站台 Header 與站台頁尾(設計稿 `brand-page.html:1327` / `:1506` 本來就有)', async () => {
    const html = await markupFor(BRAND_CONTENT[0]!.slug);
    expect(html).toContain('data-stub="site-header"');
    expect(html).toContain('ed-footer');
  });

  it('🔴 頁尾標語 = 這家品牌自己那一句,不是首頁那句(設計稿 `:1510-1512` + `:2029`)', async () => {
    // 🔴 關卡2 R1 nit 9 修:原本只跑前 3 家,而且拿**已解碼**的純文字去比對**原始 HTML** ——
    //    哪天某家 slogan 的第一行含 `<strong>` 或實體,那條會靜默失效(當時是意外通過)。
    //    改成:逐段取 `parseBrandRichText` 的文字節點、各自轉成 HTML 逸出後的形態再比對,20 家全跑。
    for (const brand of BRAND_CONTENT) {
      const html = await markupFor(brand.slug);
      const segments = parseBrandRichText(brand.slogan)
        .filter((node) => node.kind !== 'break')
        .map((node) => escapeHtml('text' in node ? node.text : ''))
        .filter((text) => text.trim() !== '');
      expect(segments.length, `${brand.slug}:slogan 拆不出文字段 ⇒ 這條會恆真`).toBeGreaterThan(0);
      for (const segment of segments) {
        expect(html, `${brand.slug}:頁尾找不到 slogan 片段「${segment}」`).toContain(segment);
      }
      expect(html, `${brand.slug}:頁尾還是首頁那句預設標語 ⇒ tagline prop 沒接上`).not.toContain(
        '改裝不只是升級配件',
      );
    }
  });

  it('外層 wrapper 帶 `data-screen-label="品牌頁"`(設計稿 `:1325` 字面、全站慣例)', async () => {
    expect(await markupFor(BRAND_CONTENT[0]!.slug)).toContain('data-screen-label="品牌頁"');
  });

  it('🔴 有 `main` landmark(設計稿 `:1354` 的 `<main>`;整站每頁都有一個)', async () => {
    const html = await markupFor(BRAND_CONTENT[0]!.slug);
    expect(html).toContain('<main class="bp-page">');
    expect(html.match(/<main[\s>]/g) ?? [], '一頁只能有一個 main').toHaveLength(1);
  });
});
