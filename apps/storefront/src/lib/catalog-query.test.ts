import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, CATALOG_SORT_VALUES } from './catalog-query';
import { SORT_OPTIONS } from './sort-options';

function params(input: string) {
  return new URLSearchParams(input);
}

describe('parseCatalogQuery', () => {
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
      priceMin: 3000,
      priceMax: 10000,
      vehicle: 'yamaha:mt-09-sp:2021',
    });
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
    expect(
      parseCatalogQuery(
        params('page=-1&per=999&sort=new&pbrand=GB%20RACING&pbrand=gb-racing&pmin=-1&pmax=NaN&vehicle=javascript:alert(1)'),
      ),
    ).toEqual({
      page: 1,
      perPage: 50,
      sort: 'recommend',
      brandSlugs: ['gb-racing'],
    });
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
  //    #269-b(RPC 投影帶 created_at)落地時把 'new' 加進白名單,**這個集合就要歸零**。
  const KNOWN_FAKE_SORT_VALUES: readonly string[] = ['new'];

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
    expect(stale, '這些值已經被 server 支援了 ⇒ 從 KNOWN_FAKE_SORT_VALUES 移除(#269-b 落地後應歸零)').toEqual([]);
  });

  // 前提:兩份清單都還在、且非空。前提沒了,上面兩條會變成「比較兩個空集合」的恆真斷言。
  it('前提 — 兩份清單都非空(空集合會讓上面兩條恆真)', () => {
    expect(SORT_OPTIONS.length).toBeGreaterThan(0);
    expect(CATALOG_SORT_VALUES.length).toBeGreaterThan(0);
  });
});
