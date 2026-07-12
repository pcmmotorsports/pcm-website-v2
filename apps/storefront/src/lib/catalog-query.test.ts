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
