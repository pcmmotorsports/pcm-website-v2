import { describe, expect, it } from 'vitest';
import {
  buildProductListHref,
  buildProductListHrefResetPage,
  parseProductKeyword,
  parseProductListParams,
  parseProductPage,
  parseProductSetBy,
  parseProductBrandId,
  parseProductCategoryPath,
  type AdminProductFilter,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  PAGE_SIZE_OPTIONS,
  parseProductPageSize,
  type AdminProductView,
} from './product-list-view';

/** 既有斷言只在乎 `page` 這一軸 ⇒ `size` 一律給預設(預設不寫進網址 ⇒ 那些網址字面**維持原樣**)。 */
const V = (page: number): AdminProductView => ({ page, size: DEFAULT_PAGE_SIZE });

// product-list-view.test.ts — `#661`。
//
// 🔴 **本檔存在的理由不是「補測試」,是這一頁【今天就在流血】**:
//    改版前 `app/products/page.tsx:106` 逐字
//    `` buildHref={(p) => (p <= 1 ? '/products' : `/products?page=${p}`)} ``
//    ⇒ 按「手動」再按「下一頁」⇒ `set_by` 蒸發、回到全部商品。
//    ⇒ 下面「每一軸都要活過翻頁」那一組,守的是那個 bug,不是新功能。

const NONE: AdminProductFilter = {
  setBy: undefined,
  keyword: undefined,
  brandId: undefined,
  categoryPath: undefined,
      skus: undefined,
};

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
    expect(buildProductListHref(NONE, V(1))).toBe('/products');
  });

  it('第 1 頁不寫 page=1', () => {
    expect(buildProductListHref({ ...NONE, setBy: 'staff', keyword: undefined }, V(1))).toBe(
      '/products?set_by=staff',
    );
  });

  it('🔴🔴 每一軸都要活過翻頁 —— 這一格守的是改版前那個真 bug', () => {
    // 改版前:分頁連結只帶 page ⇒ set_by 蒸發。
    expect(buildProductListHref({ ...NONE, setBy: 'staff', keyword: undefined }, V(2))).toBe(
      '/products?set_by=staff&page=2',
    );
    // `#661` 新增的那一軸,同樣要活過翻頁。
    expect(buildProductListHref({ ...NONE, setBy: undefined, keyword: 'brembo' }, V(3))).toBe(
      '/products?q=brembo&page=3',
    );
    // 兩軸同時。
    expect(buildProductListHref({ ...NONE, setBy: 'sync', keyword: 'brembo' }, V(2))).toBe(
      '/products?set_by=sync&q=brembo&page=2',
    );
  });

  it('搜尋詞含特殊字元 ⇒ 網址要編碼(不是原樣塞進去)', () => {
    const href = buildProductListHref({ ...NONE, setBy: undefined, keyword: 'a b&c' }, V(1));
    expect(href).toBe('/products?q=a+b%26c');
    // 🔴 反向:解回來要拿到原字串,否則「編碼對了但解不回來」也是壞的。
    const back = new URL(href, 'https://x.invalid').searchParams.get('q');
    expect(back).toBe('a b&c');
  });

  it('中文搜尋詞可往返', () => {
    const href = buildProductListHref({ ...NONE, setBy: undefined, keyword: '煞車皮' }, V(1));
    const back = new URL(href, 'https://x.invalid').searchParams.get('q');
    expect(back).toBe('煞車皮');
  });
});

describe('buildProductListHrefResetPage', () => {
  it('🔴 換條件一律回第 1 頁 —— 停在第 3 頁常常直接看到空白,而那看起來像「查無結果」', () => {
    expect(buildProductListHrefResetPage({ ...NONE, setBy: 'staff', keyword: 'brembo' }, DEFAULT_PAGE_SIZE)).toBe(
      '/products?set_by=staff&q=brembo',
    );
  });
});

describe('往返(parse ↔ build)', () => {
  it('build 出來的網址,parse 回去要拿到同一組狀態', () => {
    const cases: readonly AdminProductFilter[] = [
      NONE,
      { ...NONE, setBy: 'staff', keyword: undefined },
      { ...NONE, setBy: undefined, keyword: 'brembo' },
      { ...NONE, setBy: 'sync', keyword: '煞車皮' },
    ];
    for (const filter of cases) {
      for (const page of [1, 2, 7]) for (const size of PAGE_SIZE_OPTIONS) {
        const href = buildProductListHref(filter, { page, size });
        const sp = new URL(href, 'https://x.invalid').searchParams;
        const raw = Object.fromEntries(sp.entries());
        const parsed = parseProductListParams(raw);
        expect(parsed.filter).toEqual(filter);
        expect(parsed.view).toEqual({ page, size });
      }
    }
  });
});

// ─────────────── 商品分頁片(2026-08-19)

describe('parseProductPageSize', () => {
  it('白名單內的值原樣收下', () => {
    for (const n of PAGE_SIZE_OPTIONS) {
      expect(parseProductPageSize(String(n))).toBe(n);
    }
  });

  it('🔴 白名單外的數字 ⇒ 回預設(不是原樣送進 .range())', () => {
    // 3000 > db-max-rows(量到 2000)⇒ 收下它等於保證截斷
    expect(parseProductPageSize('3000')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize('999999')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize('-200')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize('201')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('非數字 / 陣列 / 缺 ⇒ 回預設,不報錯(網址是使用者可以手改的)', () => {
    expect(parseProductPageSize('abc')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize('')).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseProductPageSize(['200', '500'])).toBe(DEFAULT_PAGE_SIZE);
  });

  it('🔴 上限就是 1000 —— 白名單裡不得出現 2000(零餘裕,見常數旁的理由)', () => {
    expect(Math.max(...PAGE_SIZE_OPTIONS)).toBe(1000);
    expect((PAGE_SIZE_OPTIONS as readonly number[]).includes(2000)).toBe(false);
  });

  it('預設值 200 落在 Sean 講的「200-500 以上」範圍的下緣', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(200);
    expect((PAGE_SIZE_OPTIONS as readonly number[]).includes(DEFAULT_PAGE_SIZE)).toBe(true);
  });
});

describe('size 這一軸要活過每一種換頁 / 換條件', () => {
  it('預設筆數不寫進網址(沒選過與選了預設值 ⇒ 同一個網址)', () => {
    expect(buildProductListHref(NONE, { page: 1, size: DEFAULT_PAGE_SIZE })).toBe('/products');
  });

  it('非預設筆數要寫進網址', () => {
    expect(buildProductListHref(NONE, { page: 1, size: 500 })).toBe('/products?size=500');
  });

  it('🔴 翻頁要帶著 size —— 否則第 2 頁就跳回預設筆數', () => {
    expect(buildProductListHref({ ...NONE, setBy: 'staff', keyword: 'brembo' }, { page: 87, size: 500 })).toBe(
      '/products?set_by=staff&q=brembo&page=87&size=500',
    );
  });

  it('🔴🔴 換篩選 ⇒ page 回 1、而 size 原封不動', () => {
    // 這一條守的是 AdminProductView 檔頭理由 ②:
    // 員工把每頁調成 500,按一下「手動」不該跳回 200。
    expect(buildProductListHrefResetPage({ ...NONE, setBy: 'staff', keyword: undefined }, 500)).toBe(
      '/products?set_by=staff&size=500',
    );
  });

  it('換篩選時 size 是預設 ⇒ 網址仍然乾淨', () => {
    expect(buildProductListHrefResetPage({ ...NONE, setBy: 'sync', keyword: undefined }, DEFAULT_PAGE_SIZE)).toBe(
      '/products?set_by=sync',
    );
  });
});


// ─────────────── 2026-08-19 審查(R1)must-fix:`?page=` 的上界

describe('🔴 parseProductPage 的上界 —— 審查 must-fix', () => {
  it('🔴 ?page=1e21 不得原樣通過(Number.isInteger(1e21) 是 true)', () => {
    // 未修前:1e21 過關 ⇒ offset = (1e21-1)*200 ⇒ postgrest 用樣板字串送出 ⇒ "2e+23"
    // ⇒ 伺服器不收 ⇒ 畫面變成「商品列表載入失敗」,而員工只是把頁碼多打了幾個 0
    expect(Number.isInteger(1e21)).toBe(true); // ← 這就是原本那個判斷放它過的原因
    expect(parseProductPage('1e21')).toBe(MAX_PAGE);
  });

  it('🔴 clamp 之後的 offset 不得進入 JS 的指數形字串範圍', () => {
    // 這一條才是真正要守的東西:上界多少不重要,重要的是 String(offset) 長什麼樣
    const worstOffset = (MAX_PAGE - 1) * Math.max(...PAGE_SIZE_OPTIONS);
    expect(String(worstOffset)).not.toMatch(/e\+/);
    expect(worstOffset).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('超界但合理的頁碼是 clamp、不是歸 1(既有的空頁行為要留著)', () => {
    // ?page=999 而總共 102 頁 ⇒ 既有行為 = 顯示空頁 + 可退回,不是跳回第 1 頁
    expect(parseProductPage('999')).toBe(999);
    expect(parseProductPage(String(MAX_PAGE))).toBe(MAX_PAGE);
    expect(parseProductPage(String(MAX_PAGE + 1))).toBe(MAX_PAGE);
  });

  it('✅ 負向對照:既有的下界與非法值行為一個都沒被改動', () => {
    expect(parseProductPage('0')).toBe(1);
    expect(parseProductPage('-2')).toBe(1);
    expect(parseProductPage('2.5')).toBe(1);
    expect(parseProductPage('abc')).toBe(1);
    expect(parseProductPage(undefined)).toBe(1);
    expect(parseProductPage(['1', '2'])).toBe(1);
    expect(parseProductPage('3')).toBe(3);
  });
});

// ─────────────── 2026-08-19 品牌 / 分類篩選片 ───────────────

const BRAND_UUID = '61b119af-c0ea-462f-a389-094ba4e31110';

describe('parseProductBrandId', () => {
  it('🔴🔴 這一格守的是【一個量到的 400】,不是防禦性寫法', () => {
    // 2026-08-19 對本機真 PostgREST 14.16 實測:
    //   GET /products?brand_id=eq.notauuid
    //   ⇒ {"code":"22P02", … invalid input syntax for type uuid: "notauuid"} / HTTP 400
    // ⇒ 沒擋的話,員工把網址的品牌 id 改壞 = 整頁「商品列表載入失敗」。
    // ⇒ 與分頁片那個 must-fix(`?page=1e21` 變錯誤頁)是同一個病的第二個入口。
    expect(parseProductBrandId('notauuid')).toBeUndefined();
    expect(parseProductBrandId("' or 1=1--")).toBeUndefined();
    expect(parseProductBrandId('')).toBeUndefined();
  });

  it('合法 uuid 原樣通過(大小寫都收)', () => {
    expect(parseProductBrandId(BRAND_UUID)).toBe(BRAND_UUID);
    expect(parseProductBrandId(BRAND_UUID.toUpperCase())).toBe(BRAND_UUID.toUpperCase());
  });

  it('✅ 負向對照:陣列 / 缺 ⇒ undefined(= 不篩,不是報錯)', () => {
    expect(parseProductBrandId(undefined)).toBeUndefined();
    expect(parseProductBrandId([BRAND_UUID, BRAND_UUID])).toBeUndefined();
  });

  it('🔴 形狀像 uuid 但不是真 uuid 的,這一層【放行】—— 而那是刻意的', () => {
    // 格式對、DB 裡不存在 ⇒ 查到 0 件。查無結果與錯誤頁是兩件事,
    // 而「這個品牌沒有商品」本來就是一個合法的答案。
    expect(parseProductBrandId('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });
});

describe('parseProductCategoryPath', () => {
  it('trim;空 / 陣列 / 缺 ⇒ undefined', () => {
    expect(parseProductCategoryPath('  引擎部品 · 排氣管  ')).toBe('引擎部品 · 排氣管');
    expect(parseProductCategoryPath('   ')).toBeUndefined();
    expect(parseProductCategoryPath(undefined)).toBeUndefined();
    expect(parseProductCategoryPath(['a', 'b'])).toBeUndefined();
  });

  it('🔴 超長截斷而不報錯;而切法要切得斷 code point、不是 code unit', () => {
    expect(parseProductCategoryPath('字'.repeat(300))).toHaveLength(200);
    // 🔴 200 的邊界剛好落在一個 surrogate pair 上:`slice` 會產出孤兒 surrogate,
    //    而 `encodeURIComponent` 對孤兒 surrogate 會 throw ⇒ 整頁 500。
    //    (同 `parseProductKeyword` 的 `#661` R1 nit-1。)
    const withEmoji = 'a'.repeat(199) + '😀' + 'b'.repeat(50);
    const out = parseProductCategoryPath(withEmoji);
    expect(out).toBeDefined();
    expect(() => encodeURIComponent(out as string)).not.toThrow();
    expect(Array.from(out as string)).toHaveLength(200);
  });
});

describe('🔴🔴 子分類優先 —— 零 JS 表單會【同時送出】大類與子分類兩個欄位', () => {
  it('兩個都送 ⇒ 以子分類為準', () => {
    const { filter } = parseProductListParams({
      category: '引擎部品',
      subcategory: '引擎部品 · 排氣管',
    });
    expect(filter.categoryPath).toBe('引擎部品 · 排氣管');
  });

  it('子分類選「全部子分類」(送空字串)⇒ 落回大類', () => {
    const { filter } = parseProductListParams({ category: '引擎部品', subcategory: '' });
    expect(filter.categoryPath).toBe('引擎部品');
  });

  it('🔴🔴 R1 must-fix:【換大類】時,還留在表單裡的舊子類不得蓋過去', () => {
    // 失敗情境(零 JS 下真的會發生):網址是 ?category=引擎部品 · 排氣管(選中子類)
    // ⇒ 子分類下拉的值就是它。員工把「分類」改成別的大類按套用 ——
    // 子分類欄位【原封送出】⇒ ?category=服務與其他&subcategory=引擎部品 · 排氣管
    // ⇒ 舊的 `??` 讓子類勝 ⇒ 清單一筆沒變,而大類下拉又跳回引擎部品。
    // 那正是本檔檔頭反覆宣稱要防的病,只是方向相反:不是「被洗掉」,是「蓋過去」。
    const { filter } = parseProductListParams({
      category: '服務與其他',
      subcategory: '引擎部品 · 排氣管',
    });
    expect(filter.categoryPath).toBe('服務與其他');
  });

  it('🔴🔴 R1 must-fix:選中子類時,「分類→全部分類」要清得掉', () => {
    // 同一個病的第二個症狀:清不掉的篩選。
    const { filter } = parseProductListParams({
      category: '',
      subcategory: '引擎部品 · 排氣管',
    });
    expect(filter.categoryPath).toBeUndefined();
  });

  it('✅ 負向對照:只有大類 ⇒ 就是大類;兩個都沒有 ⇒ undefined', () => {
    expect(parseProductListParams({ category: '引擎部品' }).filter.categoryPath).toBe('引擎部品');
    expect(parseProductListParams({}).filter.categoryPath).toBeUndefined();
  });

  it('🔴 而【產生】連結時永遠只寫 category —— 網址只有一種正規寫法', () => {
    const href = buildProductListHref(
      { ...NONE, categoryPath: '引擎部品 · 排氣管' },
      V(1),
    );
    expect(href).not.toContain('subcategory');
    const back = new URL(href, 'https://x.invalid').searchParams;
    expect(back.get('category')).toBe('引擎部品 · 排氣管');
  });
});

describe('🔴 新增的兩軸也要活過翻頁(與 set_by 那個真 bug 同一條守則)', () => {
  it('品牌 + 分類 + 翻頁 ⇒ 三軸都還在', () => {
    const href = buildProductListHref(
      { ...NONE, brandId: BRAND_UUID, categoryPath: '引擎部品 · 排氣管' },
      V(4),
    );
    const p = new URL(href, 'https://x.invalid').searchParams;
    expect(p.get('brand')).toBe(BRAND_UUID);
    expect(p.get('category')).toBe('引擎部品 · 排氣管');
    expect(p.get('page')).toBe('4');
  });

  it('🔴 換 chip(reset page)不得把品牌/分類洗掉,而 page 要回 1', () => {
    const href = buildProductListHrefResetPage(
      { ...NONE, setBy: 'staff', brandId: BRAND_UUID, categoryPath: '引擎部品' },
      DEFAULT_PAGE_SIZE,
    );
    const p = new URL(href, 'https://x.invalid').searchParams;
    expect(p.get('brand')).toBe(BRAND_UUID);
    expect(p.get('category')).toBe('引擎部品');
    expect(p.get('page')).toBeNull();
  });

  it('🔴🔴 往返:build 出來的網址 parse 回去,四軸逐一相等', () => {
    const cases: readonly AdminProductFilter[] = [
      { ...NONE, brandId: BRAND_UUID },
      { ...NONE, categoryPath: '引擎部品 · 排氣管' },
      { ...NONE, setBy: 'staff', keyword: '煞車皮', brandId: BRAND_UUID, categoryPath: '引擎部品' },
    ];
    for (const filter of cases) {
      for (const page of [1, 3]) {
        const href = buildProductListHref(filter, { page, size: DEFAULT_PAGE_SIZE });
        const raw = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
        expect(parseProductListParams(raw).filter).toEqual(filter);
      }
    }
  });
});
