import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './catalog-query';
import { buildCatalogIndexing } from './catalog-canonical';

const BASE = 'https://www.pcmmotorsports.com';

function canonicalOf(query: string): string | undefined {
  return buildCatalogIndexing(parseCatalogQuery(new URLSearchParams(query)), BASE).canonical;
}
function noindexOf(query: string): boolean {
  return buildCatalogIndexing(parseCatalogQuery(new URLSearchParams(query)), BASE).noindex;
}

describe('buildCatalogIndexing', () => {
  it('🔴 sort / per 只換排列, 不進 canonical(它們是同一份商品集合)', () => {
    const plain = canonicalOf('');
    expect(canonicalOf('sort=price-asc')).toBe(plain);
    expect(canonicalOf('sort=price-desc&per=100')).toBe(plain);
    expect(plain).toBe(`${BASE}/products`);
  });

  // 🔴 這一格是主視窗點名的陷阱:`?filter=new` 是**真篩選**(近 7 天),`?sort=new` 只是排序。
  //    兩個長得像而語意不同 —— 一律洗掉參數的寫法會把它們併成同一頁,那是錯的。
  it('🔴 filter=new 與 sort=new 的 canonical 不同', () => {
    expect(canonicalOf('filter=new')).toBe(`${BASE}/products?filter=new`);
    expect(canonicalOf('sort=new')).toBe(`${BASE}/products`);
  });

  it('🔵 ?categories=b,a 與 ?categories=a,b 收斂到同一個 canonical', () => {
    expect(canonicalOf('categories=尾段排氣管,全段排氣管')).toBe(
      canonicalOf('categories=全段排氣管,尾段排氣管'),
    );
  });

  // 舊格式(`?category=` 單值 / `?pbrand=` 重複鍵)讀得懂, 而寫出端只產新格式 ⇒ 兩種網址收斂成一個。
  it('🔵 舊格式 ?category= 與 ?pbrand= canonical 到新格式', () => {
    expect(canonicalOf('category=全段排氣管')).toBe(canonicalOf('categories=全段排氣管'));
    expect(canonicalOf('pbrand=akrapovic')).toBe(canonicalOf('pbrands=akrapovic'));
  });

  it('🔴 價格區間與自由關鍵字 ⇒ noindex(組合無限 / 內容與整頁不同, 不用 canonical 假裝)', () => {
    expect(noindexOf('pmin=3000&pmax=10000')).toBe(true);
    expect(noindexOf('price=NT$ 3,000 – 10,000')).toBe(true);
    expect(noindexOf('search=拉桿')).toBe(true);
    expect(noindexOf('categories=全段排氣管&sort=new&page=2')).toBe(false);
  });

  // 🔴 noindex 與「指去別頁的 canonical」同時出現 ⇒ Google 會把 noindex 沿 canonical 傳給
  //    `/products` 本身。守這一格,不是守風格。
  it('🔴 noindex 的頁不產 canonical(不把 noindex 沿著 canonical 傳給 /products)', () => {
    expect(canonicalOf('pmin=3000&pmax=10000')).toBeUndefined();
    expect(canonicalOf('search=拉桿')).toBeUndefined();
  });

  it('🔵 page 留在 canonical、不折回第 1 頁;第 1 頁不帶 page', () => {
    expect(canonicalOf('page=2')).toBe(`${BASE}/products?page=2`);
    expect(canonicalOf('page=1')).toBe(`${BASE}/products`);
  });

  it('🔵 認不得的參數天然消失(白名單只有 parseCatalogQuery 一份)', () => {
    expect(canonicalOf('from=catalog&utm_source=line')).toBe(`${BASE}/products`);
  });

  // 🔴 prod 未設 NEXT_PUBLIC_SITE_URL ⇒ 整個省略 canonical(絕不吐 localhost),但 noindex 照算。
  it('🔴 base 未設 ⇒ 不產 canonical, 而 noindex 仍然有效', () => {
    const r = buildCatalogIndexing(parseCatalogQuery(new URLSearchParams('search=拉桿')), undefined);
    expect(r.canonical).toBeUndefined();
    expect(r.noindex).toBe(true);
  });
});
