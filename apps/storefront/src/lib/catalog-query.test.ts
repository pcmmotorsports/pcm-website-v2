import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './catalog-query';

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
      perPage: 25,
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
      perPage: 25,
      sort: 'recommend',
      brandSlugs: ['gb-racing'],
    });
  });
});
