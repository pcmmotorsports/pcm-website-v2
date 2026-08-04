// @vitest-environment node
//
// /brands route test — D3c-3(2026-08-05)
//
// 慣例與 `app/brands/[slug]/page.test.tsx` 同一套(直接呼叫 server component、真的 render 成
// HTML、只 stub `<Header>`)。這支補的是那支已經有、而總覽頁本來零守門的那一面:
// **metadata 的字面**(關卡2 R1 nit:TITLE 的全形直豎線、description、canonical)
// 與 **per-page 頁尾標語**(設計稿 `brand-directory.html:143`,「標語每頁不同」是 Sean 的拍板)。

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/Header', () => ({
  Header: function Header({ currentPage }: { currentPage?: string }) {
    return <div data-stub="site-header" data-current-page={currentPage} />;
  },
}));
// 🔴 必須 mock:`lib/brand-products` → `lib/products` → `server-only`,在 vitest 載入即 throw;
//    而且不 mock 會打真 DB。真資料那一面由 `lib/brand-products.test.ts` 與真瀏覽器量測負責。
const { availableRef } = vi.hoisted(() => ({
  availableRef: { current: null as ReadonlySet<string> | null },
}));
vi.mock('@/lib/brand-products', () => ({
  fetchBrandsWithProducts: () => Promise.resolve(availableRef.current ?? new Set()),
}));

const { default: BrandDirectoryPage, generateMetadata } = await import('./page');
const { BRAND_CONTENT } = await import('@/data/brand-content');

const ALL: ReadonlySet<string> = new Set(BRAND_CONTENT.map((b) => b.slug));

async function html(available: ReadonlySet<string>) {
  availableRef.current = available;
  return renderToStaticMarkup(await BrandDirectoryPage());
}

describe('/brands · metadata', () => {
  it('🔴 標題與描述 = 設計稿 `brand-directory.html:6-7` 逐字(含全形直豎線)', async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe('PCM MOTOR PARTS LTD.｜品牌總覽');
    // 半形 | 會讓這條紅 —— 那正是「看起來一樣、其實不是設計稿字面」的形狀。
    expect(String(meta.title)).toContain('｜');
    expect(String(meta.title)).not.toContain('|');
    expect(meta.description).toBe('依品牌找部品，直接查看 PCM MOTOR PARTS LTD. 各品牌商品。');
  });

  it('🔴 OG 與 canonical 用同一組字面(不是各寫一份)', async () => {
    const meta = await generateMetadata();
    expect(meta.openGraph?.title).toBe(meta.title);
    expect(meta.openGraph?.description).toBe(meta.description);
    // canonical 依 `resolveSiteUrl()`:設得出來就必須是 `/brands`,設不出來則兩邊都不出現。
    const canonical = meta.alternates?.canonical;
    if (canonical) {
      expect(String(canonical)).toMatch(/\/brands$/);
      expect(String(meta.openGraph?.url)).toBe(String(canonical));
    } else {
      expect(meta.openGraph?.url).toBeUndefined();
    }
  });
});

describe('/brands · route 輸出', () => {
  it('🔴 HTML 真的帶 `.bd-page` scope(漏掉的話整頁色票沉默降級)', async () => {
    expect(await html(ALL)).toContain('class="bd-page"');
  });

  it('🔴 `<Header>` 收到 `currentPage="brands"`(設計稿 :103 把「品牌」標成 is-active)', async () => {
    expect(await html(ALL)).toContain('data-current-page="brands"');
  });

  it('🔴 頁尾標語 = 這一頁自己那句(設計稿 :143;`HomeFooter` 的預設是別頁的)', async () => {
    const out = await html(ALL);
    expect(out).toContain('為每一趟騎乘，');
    expect(out).toContain('找到對的部品。');
  });

  it('🔴 20 張卡都在;空集合(fail-closed)⇒ 零商品連結', async () => {
    const all = await html(ALL);
    // 🔴 比**完整的 class 屬性值**:裸 `bd-brand-about` 會連 `bd-brand-about-label` 一起數到
    //    (實測 20 → 40),那是「量到別的東西卻看起來很對」的形狀。
    expect(all.match(/class="bd-brand-about"/g) ?? []).toHaveLength(BRAND_CONTENT.length);
    // 前提:全有商品時,商品入口真的是 `<a>`(否則下一條的「零」是恆真)
    expect(all).toContain('<a class="bd-brand-products"');

    const none = await html(new Set());
    expect(none).not.toContain('<a class="bd-brand-products"');
    expect(none.match(/bd-brand is-empty/g) ?? []).toHaveLength(BRAND_CONTENT.length);
  });
});
