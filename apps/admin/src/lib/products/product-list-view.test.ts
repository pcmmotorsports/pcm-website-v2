import { describe, expect, it } from 'vitest';
import {
  buildProductListHref,
  buildProductListHrefResetPage,
  parseProductKeyword,
  parseProductListParams,
  parseProductPage,
  parseProductSetBy,
  type AdminProductFilter,
} from './product-list-view';

// product-list-view.test.ts — `#661`。
//
// 🔴 **本檔存在的理由不是「補測試」,是這一頁【今天就在流血】**:
//    改版前 `app/products/page.tsx:106` 逐字
//    `` buildHref={(p) => (p <= 1 ? '/products' : `/products?page=${p}`)} ``
//    ⇒ 按「手動」再按「下一頁」⇒ `set_by` 蒸發、回到全部商品。
//    ⇒ 下面「每一軸都要活過翻頁」那一組,守的是那個 bug,不是新功能。

const NONE: AdminProductFilter = { setBy: undefined, keyword: undefined };

describe('parseProductPage', () => {
  it('只收正整數;其餘一律回 1', () => {
    expect(parseProductPage('3')).toBe(3);
    expect(parseProductPage('1')).toBe(1);
    expect(parseProductPage(undefined)).toBe(1);
    expect(parseProductPage('0')).toBe(1);
    expect(parseProductPage('-2')).toBe(1);
    expect(parseProductPage('2.5')).toBe(1);
    expect(parseProductPage('abc')).toBe(1);
    // 🔴 `?page=a&page=b` 會被 Next 解析成陣列 ⇒ 當作沒給,不是拿第一個。
    expect(parseProductPage(['2', '3'])).toBe(1);
  });
});

describe('parseProductSetBy', () => {
  it('白名單:只認得 staff / sync', () => {
    expect(parseProductSetBy('staff')).toBe('staff');
    expect(parseProductSetBy('sync')).toBe('sync');
  });
  it('🔴 認不得的值回 undefined(= 不篩),不是報錯 —— 這個值會進 .eq 條件', () => {
    expect(parseProductSetBy('DROP')).toBeUndefined();
    expect(parseProductSetBy(undefined)).toBeUndefined();
    expect(parseProductSetBy(['staff', 'sync'])).toBeUndefined();
  });
});

describe('parseProductKeyword', () => {
  it('trim 之後有東西才算搜尋', () => {
    expect(parseProductKeyword('brembo')).toBe('brembo');
    expect(parseProductKeyword('  brembo  ')).toBe('brembo');
  });

  it('🔴 空白字串 ⇒ undefined(沒搜尋),不是「搜尋空字串」', () => {
    // 為什麼這一格重要:空字串若被當搜尋詞送進 ilike '%%',它會**比對到每一列**
    // ⇒ 畫面與「沒搜尋」一模一樣、連「共 N 件」都一樣
    // ⇒ 兩個世界印同一張畫面,於是「搜尋沒生效」永遠不會被發現。
    expect(parseProductKeyword('')).toBeUndefined();
    expect(parseProductKeyword('   ')).toBeUndefined();
    expect(parseProductKeyword(undefined)).toBeUndefined();
    expect(parseProductKeyword(['a', 'b'])).toBeUndefined();
  });

  it('超過 100 字元截斷(不報錯)', () => {
    const long = 'x'.repeat(150);
    expect(parseProductKeyword(long)).toHaveLength(100);
  });

  it('🔴 截斷走 code point,不得切斷 emoji 的 surrogate pair', () => {
    // 99 個 ASCII + 一個 emoji ⇒ 第 100 個「字」是那個 emoji。
    // 用 slice(0,100) 切會只留下它的前半個 code unit ⇒ 孤兒 surrogate
    // ⇒ encodeURIComponent 對它會 throw ⇒ 整頁 500。
    const withEmoji = 'x'.repeat(99) + '🔧';
    const out = parseProductKeyword(withEmoji);
    expect(out).toBe(withEmoji);
    // 決定性的那一格:編碼不能炸(孤兒 surrogate 會在這裡 throw)。
    expect(() => encodeURIComponent(out ?? '')).not.toThrow();
    // 負向對照:證明上面那格不是恆真 —— 孤兒 surrogate 真的會讓它炸。
    expect(() => encodeURIComponent('\uD83D')).toThrow();
  });
});

describe('buildProductListHref', () => {
  it('全空 + 第 1 頁 ⇒ 乾淨的 /products', () => {
    expect(buildProductListHref(NONE, 1)).toBe('/products');
  });

  it('第 1 頁不寫 page=1', () => {
    expect(buildProductListHref({ setBy: 'staff', keyword: undefined }, 1)).toBe(
      '/products?set_by=staff',
    );
  });

  it('🔴🔴 每一軸都要活過翻頁 —— 這一格守的是改版前那個真 bug', () => {
    // 改版前:分頁連結只帶 page ⇒ set_by 蒸發。
    expect(buildProductListHref({ setBy: 'staff', keyword: undefined }, 2)).toBe(
      '/products?set_by=staff&page=2',
    );
    // `#661` 新增的那一軸,同樣要活過翻頁。
    expect(buildProductListHref({ setBy: undefined, keyword: 'brembo' }, 3)).toBe(
      '/products?q=brembo&page=3',
    );
    // 兩軸同時。
    expect(buildProductListHref({ setBy: 'sync', keyword: 'brembo' }, 2)).toBe(
      '/products?set_by=sync&q=brembo&page=2',
    );
  });

  it('搜尋詞含特殊字元 ⇒ 網址要編碼(不是原樣塞進去)', () => {
    const href = buildProductListHref({ setBy: undefined, keyword: 'a b&c' }, 1);
    expect(href).toBe('/products?q=a+b%26c');
    // 🔴 反向:解回來要拿到原字串,否則「編碼對了但解不回來」也是壞的。
    const back = new URL(href, 'https://x.invalid').searchParams.get('q');
    expect(back).toBe('a b&c');
  });

  it('中文搜尋詞可往返', () => {
    const href = buildProductListHref({ setBy: undefined, keyword: '煞車皮' }, 1);
    const back = new URL(href, 'https://x.invalid').searchParams.get('q');
    expect(back).toBe('煞車皮');
  });
});

describe('buildProductListHrefResetPage', () => {
  it('🔴 換條件一律回第 1 頁 —— 停在第 3 頁常常直接看到空白,而那看起來像「查無結果」', () => {
    expect(buildProductListHrefResetPage({ setBy: 'staff', keyword: 'brembo' })).toBe(
      '/products?set_by=staff&q=brembo',
    );
  });
});

describe('往返(parse ↔ build)', () => {
  it('build 出來的網址,parse 回去要拿到同一組狀態', () => {
    const cases: readonly AdminProductFilter[] = [
      NONE,
      { setBy: 'staff', keyword: undefined },
      { setBy: undefined, keyword: 'brembo' },
      { setBy: 'sync', keyword: '煞車皮' },
    ];
    for (const filter of cases) {
      for (const page of [1, 2, 7]) {
        const href = buildProductListHref(filter, page);
        const sp = new URL(href, 'https://x.invalid').searchParams;
        const raw = Object.fromEntries(sp.entries());
        const parsed = parseProductListParams(raw);
        expect(parsed.filter).toEqual(filter);
        expect(parsed.page).toBe(page);
      }
    }
  });
});
