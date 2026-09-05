import { SORT_VALUES as CLIENT_SORT_VALUES } from '@/components/products-url-parsers';
import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, CATALOG_SORT_VALUES } from './catalog-query';
import { SEARCH_MAX_QUERY_LENGTH } from './search-shape';
import { SORT_OPTIONS } from './sort-options';

function params(input: string) {
  return new URLSearchParams(input);
}

describe('parseCatalogQuery', () => {
  // ── ⟦M-4b 多顆分類膠囊⟧ Sean 2026-09-04 拍甲(聯集)——「魚雷管要同時列全段+尾段」──
  it('🔴 ?categories=a,b ⇒ 兩顆都收下(單鍵逗號, 形狀跟 pbrands 走)', () => {
    expect(parseCatalogQuery(params('categories=全段排氣管,尾段排氣管(Slip-On)')).categories)
      .toEqual(['全段排氣管', '尾段排氣管(Slip-On)']);
  });

  it('🔵 舊的 ?category= 繼續讀得懂, 而且【被收進聯集】不是被丟掉(客人的舊連結)', () => {
    const q = parseCatalogQuery(params('category=全段排氣管'));
    expect(q.category).toBe('全段排氣管');
    expect(q.categories).toEqual(['全段排氣管']);
  });

  it('🔵 兩種同時出現 ⇒ 併起來去重, 舊值不掉', () => {
    expect(parseCatalogQuery(params('categories=A,B&category=B')).categories).toEqual(['A', 'B']);
  });

  // 🔴 **驗收⑤ 逐字**:壞的那一顆只丟那一顆, 不整組失效。
  //    而「壞」的定義來自 `isSafeCategoryValue`(本檔 :88-95):`%` `_` 與控制字元 ——
  //    因為 RPC 那側是 `category_raw LIKE vc || ' · %'` **未跳脫** ⇒ 一顆帶 `%` 會污染整組。
  it('🔴 負對照:一顆帶 % 的 ⇒ 只丟那一顆, 好的那顆照樣在', () => {
    expect(parseCatalogQuery(params('categories=全段排氣管,壞%的')).categories).toEqual(['全段排氣管']);
  });

  it('🔵 空字串 / 多餘逗號不會變成一顆空的分類', () => {
    expect(parseCatalogQuery(params('categories=,,A,')).categories).toEqual(['A']);
  });

  it('normalizes valid page, sort, brands, price range, and vehicle parameters', () => {
    expect(
      parseCatalogQuery(
        params('page=3&per=50&sort=price-desc&category=%E8%BB%8A%E8%BA%AB%E5%A5%97%E4%BB%B6&pbrand=gb-racing&pbrand=cnc-racing&pmin=3000&pmax=10000&vehicle=yamaha:mt-09-sp:2021'),
      ),
    ).toEqual({
      page: 3,
      perPage: 50,
      sort: 'price-desc',
      category: '車身套件',
      brandSlugs: ['cnc-racing', 'gb-racing'],
      // 🔴 這一格【不是形狀改動】—— 舊的 ?category= 現在會被收進聯集, 而那正是本片要的。
      categories: ['車身套件'],
      priceMin: 3000,
      priceMax: 10000,
      vehicle: 'yamaha:mt-09-sp:2021',
    });
  });

  it('#287 server 端對新舊兩種品牌格式產出**相同**的 brandSlugs', () => {
    // 🔴 這一格是 #287 的 server 側合約:客人已分享的舊連結不能因為前台改格式就篩不到東西。
    //    新舊各跑一次比同一個期望值,不是只驗新格式跑得動。
    const expected = ['cnc-racing', 'gb-racing'];
    expect(parseCatalogQuery(params('pbrands=gb-racing,cnc-racing')).brandSlugs).toEqual(expected);
    expect(parseCatalogQuery(params('pbrand=gb-racing&pbrand=cnc-racing')).brandSlugs).toEqual(expected);
    // 混雜(手打才產得出來)取聯集;不合形狀的 slug 照舊被 SAFE_SLUG 擋掉 —— 新格式不是繞過它的後門。
    expect(parseCatalogQuery(params('pbrands=gb-racing&pbrand=cnc-racing')).brandSlugs).toEqual(expected);
    expect(parseCatalogQuery(params('pbrands=GB%20RACING,gb-racing')).brandSlugs).toEqual(['gb-racing']);
    expect(parseCatalogQuery(params('pbrands=')).brandSlugs).toEqual([]);
  });

  it('omits price bounds entirely when no price params are present (P4 回歸:缺 pmax 不可變成 priceMax=0)', () => {
    // 根因:Number(null) === 0 且 0 >= 0,parseNonNegativeInteger(null) 誤回 0 → priceMax:0
    //   → RPC 過濾 price_general<=0 → 整頁 0 筆。缺價格參數時 priceMin/priceMax 必須「不存在」。
    const result = parseCatalogQuery(params('sort=price-asc'));
    expect(result).toEqual({
      page: 1,
      perPage: 50,
      sort: 'price-asc',
      brandSlugs: [],
      // ⟦M-4b 多顆分類膠囊⟧ 新增的必填欄:整個物件比對的格子要跟著帶。
      categories: [],
    });
    expect(result).not.toHaveProperty('priceMax');
    expect(result).not.toHaveProperty('priceMin');
  });

  it('treats empty / whitespace price params as absent (Number(""|" "|"+")===0 footgun)', () => {
    // ?pmin=&pmax= 與 ?pmax=%20(解碼為空白)皆不可變成 priceMax=0;+ 也解碼為空白。
    for (const q of ['pmin=&pmax=', 'pmax=%20', 'pmax=+', 'pmax=%09']) {
      const result = parseCatalogQuery(params(q));
      expect(result, q).not.toHaveProperty('priceMax');
      expect(result, q).not.toHaveProperty('priceMin');
    }
  });

  it('fails closed to defaults for malformed, unsupported, or unsafe query values', () => {
    // 🔴 這裡的 `sort=` 必須是**真的不被支援**的值。原本寫 `sort=new`,而 2026-08-11 #269-b
    //    段二把 `new` 做成真的之後,這一格**開始量錯東西** —— 它會變成在驗「支援的值有沒有被保留」,
    //    而不是它宣稱的「不支援的值有沒有 fail closed」。改用 `bogus-sort`(永遠不會被支援)。
    //    ⚠️ 當時若順手把期望值從 recommend 改成 new 就過關了,這格的判別力會**靜默歸零**。
    expect(
      parseCatalogQuery(
        params('page=-1&per=999&sort=bogus-sort&pbrand=GB%20RACING&pbrand=gb-racing&pmin=-1&pmax=NaN&vehicle=javascript:alert(1)&filter=bogus-filter'),
      ),
    ).toEqual({
      page: 1,
      perPage: 50,
      sort: 'recommend',
      brandSlugs: ['gb-racing'],
      categories: [],
    });
  });

  it('#269-b:認得的 ?filter=new;不認得的 filter 值一律丟掉(不回退成某個篩選)', () => {
    expect(parseCatalogQuery(params('filter=new')).filter).toBe('new');
    expect(parseCatalogQuery(params('filter=sale')).filter).toBeUndefined();
    expect(parseCatalogQuery(params('filter=')).filter).toBeUndefined();
    expect(parseCatalogQuery(params('')).filter).toBeUndefined();
  });

  it('#269-b:sort=new 現在是真的被支援(不再靜默回退成 recommend)', () => {
    expect(
      parseCatalogQuery(params('sort=new')).sort,
      'new 已進 CATALOG_SORT_VALUES(migration 20260811040000 讓 RPC 支援 p_sort=new)',
    ).toBe('new');
  });
});

// ── #391:UI 排序清單 × server 白名單的對帳守門 ─────────────────────────────
//
// 🔴 **為什麼需要這一格**(2026-08-11 #269-a 實錘):`SORT_OPTIONS`(UI 下拉要顯示什麼)
//    與 `CATALOG_SORT_VALUES`(server 端 `parseCatalogQuery` 認什麼)是**兩份清單**,
//    而它們之間**過去沒有任何守門在比對**。
//    後果:列在 UI、卻不在白名單裡的值會被 `parseCatalogQuery` **靜默回退成 recommend**
//    ⇒ 客人選了那個排序,畫面完全沒變、也沒有任何錯誤訊息。
//    發現當下五個選項裡**有兩個**是這種假的:`sale`(折扣優先,已於 #269-a 移除)
//    與 `new`(最新上架,等 #269-b 做成真的)。
//
// ⚠️ 這一格**不禁止**「暫時是假的」那種選項 —— 有時就是要先放 UI、後補 server
//    (`new` 正是如此)。它要求的是:**假的必須被顯式登記**,不能只是「剛好沒人發現」。
describe('#391 排序清單對帳(SORT_OPTIONS × CATALOG_SORT_VALUES)', () => {
  // 🔴 顯式登記「今天在 UI 上是假的」那些 value。
  //    ✅ **2026-08-11 #269-b 段二落地後已歸零** —— 這正是下面第二格(反向守門)逼出來的:
  //    'new' 一進白名單,那格就紅,不清不能過。逃生清單沒有爛成「永久的謊」。
  const KNOWN_FAKE_SORT_VALUES: readonly string[] = [];

  it('🔴 每個 UI 排序選項,不是 server 認得的,就必須在「已知是假的」清單裡', () => {
    const whitelisted = new Set<string>(CATALOG_SORT_VALUES);
    const unaccounted = SORT_OPTIONS.map((o) => o.value).filter(
      (v) => !whitelisted.has(v) && !KNOWN_FAKE_SORT_VALUES.includes(v),
    );
    expect(
      unaccounted,
      '有排序選項既不在 server 白名單、也沒登記成已知假選項 ⇒ 客人選了會靜默回退成 recommend',
    ).toEqual([]);
  });

  // 🔴 反向:登記表本身會過期。少了這條,#269-b 把 'new' 做成真的之後,
  //    這裡仍寫著「new 是假的」而沒有人會發現 —— 逃生清單就從「暫時的例外」爛成「永久的謊」。
  it('🔴 「已知是假的」清單不得殘留:登記的值必須真的不在白名單裡', () => {
    const whitelisted = new Set<string>(CATALOG_SORT_VALUES);
    const stale = KNOWN_FAKE_SORT_VALUES.filter((v) => whitelisted.has(v));
    expect(stale, '這些值已經被 server 支援了 ⇒ 從 KNOWN_FAKE_SORT_VALUES 移除').toEqual([]);
  });

  // 🔴🔴 上面那格在清單**空的時候會變成恆真**(`[].filter(...)` 恆為 `[]`)——
  //    也就是說 #269-b 清空登記表的同時,**順手把那道守門變成了 no-op**。
  //    (這是主視窗 2026-08-11 交辦時點名要防的:「清空的那格要留『空集合也有判別力』的形狀」。)
  //    這一格就是補那個洞:直接斷言「債已清乾淨」。
  //    ⇒ 之後若有人**又**要放一個「先上 UI、server 還沒做」的排序,這格會紅,
  //      逼他當場說明為什麼要再開逃生門,而不是靜悄悄加一筆登記。
  it('🔴 逃生清單目前必須是空的(#269-b 已清;要再開逃生門必須是有意識的決定)', () => {
    expect(
      KNOWN_FAKE_SORT_VALUES,
      '又有假排序選項被登記了。這不是禁止,但要有人明確決定並更新本格與 backlog,不可靜默新增',
    ).toEqual([]);
  });

  // 前提:兩份清單都還在、且非空。前提沒了,上面兩條會變成「比較兩個空集合」的恆真斷言。
  it('前提 — 兩份清單都非空(空集合會讓上面兩條恆真)', () => {
    expect(SORT_OPTIONS.length).toBeGreaterThan(0);
    expect(CATALOG_SORT_VALUES.length).toBeGreaterThan(0);
  });
});

// ── #269-b 段二補洞:排序清單其實有**三份**,#391 只比了兩份 ──────────────
//
// 🔴 codex 段二審查 MF-9 實錘:`components/products-url-parsers.ts` 有**第三份** `SORT_VALUES`
//    (client 端 URL 解析用),而且直到 2026-08-11 段二為止還殘留著 `'sale'` ——
//    它早在 #269-a 就從 `SORT_OPTIONS` 移除了。後果:舊書籤 `?sort=sale`
//    ⇒ **client 認為排序是 sale、server 回退成 recommend**,而 `<select>` 裡沒有那個選項。
//    ⚠️ 這也證明我在 #391 寫的「假選項歸零」是**過頭的宣稱**:那格只比對三份裡的兩份。
describe('#269-b:排序清單三份一致(補 #391 只比兩份的洞)', () => {
  it('🔴 client URL 解析的白名單必須與 server 白名單完全相同', () => {
    expect(
      [...CLIENT_SORT_VALUES].sort(),
      'client 與 server 各認一套 ⇒ 同一個 ?sort= 兩邊解讀不同(sale 就是這樣殘留了三個月)',
    ).toEqual([...CATALOG_SORT_VALUES].sort());
  });

  it('🔴 UI 下拉選項也必須全部在 client 白名單裡', () => {
    const clientSet = new Set<string>(CLIENT_SORT_VALUES);
    expect(SORT_OPTIONS.map((o) => o.value).filter((v) => !clientSet.has(v))).toEqual([]);
  });
});

// ── ⟦搜尋-落點換 /products⟧ 2026-09-03 ──────────────────────────────────────
describe('parseCatalogQuery — ?search= 關鍵字', () => {
  it('🔵 一般關鍵字原樣進 query', () => {
    expect(parseCatalogQuery(params('search=akrapovic')).search).toBe('akrapovic');
  });

  // 🔴🔴 **這一格擋的是主視窗點名「絕對不准」的那個失敗態。**
  //    `?search=%20`(只打空白送出)若被當成有值 ⇒ route 走關鍵字路
  //    ⇒ ILIKE `%%` ⇒ **撈回整張 view = 靜靜地給客人全站兩萬多件**。
  //    ⇒ 📌 而畫面上完全正常 —— 標題、件數、卡片全都在, 只是那不是他搜的東西。
  it.each([
    ['空字串', 'search='],
    ['純空白', 'search=%20%20'],
    ['tab', 'search=%09'],
  ])('🔴 %s ⇒ undefined(**不是**空字串)⇒ route 走原本的目錄路', (_label, qs) => {
    expect(parseCatalogQuery(params(qs)).search).toBeUndefined();
  });

  it('🔵 負對照:沒有 search 這個參數時,query 裡不長出這個鍵', () => {
    // 🎯 `undefined` 與「鍵不存在」對 `JSON.stringify` **不同** —— 而那份 JSON 是
    //    `unstable_cache` 的鍵(見 `products.ts`)⇒ 憑空多一個鍵 = 舊快取全失效。
    expect('search' in parseCatalogQuery(params('page=2'))).toBe(false);
  });

  it('🔵 前後空白剪掉(客人從別處貼過來常常帶空白)', () => {
    expect(parseCatalogQuery(params('search=%20mt07%20')).search).toBe('mt07');
  });

  // 🔴🔴 **自審 2026-09-03 抓到的:顯示的字串 ≠ 查的字串。**
  //    膠囊印的是本函式回的值, 而截斷原本只發生在更下游的 `searchProducts`
  //    ⇒ 搜 150 個字 ⇒ 膠囊印 150 個字而實際只查前 100 個
  //    ⇒ 📌 `search-shape.ts:28-31` 逐字預言過, 判別句:
  //      **「顯示用的字串與實際查詢的字串, 只要不是同一個運算式, 它們就會分岔。」**
  it('🔴 超過上限 ⇒ 這裡就截斷(顯示端與查詢端必須是同一個字串)', () => {
    const long = 'a'.repeat(SEARCH_MAX_QUERY_LENGTH + 50);
    const got = parseCatalogQuery(params(`search=${long}`)).search;
    // 🎯 寫算式不寫結果 —— 抄一個 100 進來的話, 改常數就再也不會紅。
    expect(got).toHaveLength(SEARCH_MAX_QUERY_LENGTH);
    expect(got).toBe(long.slice(0, SEARCH_MAX_QUERY_LENGTH));
  });

  it('🔵 負對照:剛好等於上限 ⇒ 一個字都不砍', () => {
    const exact = 'b'.repeat(SEARCH_MAX_QUERY_LENGTH);
    expect(parseCatalogQuery(params(`search=${exact}`)).search).toBe(exact);
  });
});
