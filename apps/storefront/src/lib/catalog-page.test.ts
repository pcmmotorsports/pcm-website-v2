import { describe, expect, it } from 'vitest';
import { catalogRowToUIProduct, toCardFitments } from './catalog-page';

describe('catalogRowToUIProduct', () => {
  it('maps the safe list projection to exactly the ProductCard UI shape', () => {
    expect(
      catalogRowToUIProduct({
        id: 'product-1',
        title: '引擎護蓋',
        subtitle: 'Yamaha 專用',
        handle: 'engine-cover',
        availability: 'in-stock',
        price_general: 6800,
        card_image: 'https://cdn.example.test/cover.webp',
        fits: 'Yamaha MT-09',
        brand_name: 'GB RACING',
        brand_slug: 'gb-racing',
        category_raw: '車身套件 · 引擎護蓋',
      }),
    ).toMatchObject({
      slug: 'engine-cover',
      brand: 'GB RACING',
      brandSlug: 'gb-racing',
      name: '引擎護蓋',
      fits: 'Yamaha MT-09',
      price: 6800,
      category: '車身套件 · 引擎護蓋',
      image: 'https://cdn.example.test/cover.webp',
      inStock: true,
    });
  });

  it('S4:白名單收 RPC fitments jsonb → UIFitment 四欄、yearEnd 三態忠實', () => {
    expect(
      toCardFitments([
        { motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2018, yearEnd: 2024, matchSource: 'direct' },
        { motoBrand: 'YAMAHA', modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: null },
        { motoBrand: 'HONDA', modelCode: 'CB650R', yearStart: 2019 },
      ]),
    ).toEqual([
      { motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2018, yearEnd: 2024 },
      { motoBrand: 'YAMAHA', modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: null },
      { motoBrand: 'HONDA', modelCode: 'CB650R', yearStart: 2019 },
    ]);
  });

  it('S4:非陣列 / 空 / 車款名皆空元素 → undefined 或丟棄(防禦)', () => {
    expect(toCardFitments(null)).toBeUndefined();
    expect(toCardFitments('nope')).toBeUndefined();
    expect(toCardFitments([])).toBeUndefined();
    expect(toCardFitments([{ motoBrand: '', modelCode: '' }, 42, null])).toBeUndefined();
  });

  it('S4:yearStart/yearEnd 非 number(如字串)→ 忽略年份、仍保留車款(防禦性強制)', () => {
    expect(
      toCardFitments([{ motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: '2018', yearEnd: '2024' }]),
    ).toEqual([{ motoBrand: 'YAMAHA', modelCode: 'MT-09' }]);
  });

  it('S4:catalogRowToUIProduct 透傳 fitments、缺欄 → undefined', () => {
    expect(
      catalogRowToUIProduct({
        id: 'p2', title: 't', subtitle: null, handle: 'h', availability: 'in-stock',
        price_general: 100, card_image: null, fits: 'YAMAHA MT-09', brand_name: 'B',
        brand_slug: 'b', category_raw: 'c', fitments: [{ motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2020 }],
      }).fitments,
    ).toEqual([{ motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2020 }]);

    expect(
      catalogRowToUIProduct({
        id: 'p3', title: 't', subtitle: null, handle: 'h', availability: 'in-stock',
        price_general: 100, card_image: null, fits: '通用款', brand_name: 'B',
        brand_slug: 'b', category_raw: 'c',
      }).fitments,
    ).toBeUndefined();
  });
});

describe('catalogRowToUIProduct card_image_trim(trim 線 S4a)', () => {
  const base = {
    id: 'p1', title: 'T', subtitle: null, handle: 'h', availability: 'in-stock',
    price_general: 100, card_image: null, fits: '通用款', brand_name: 'B',
    brand_slug: 'b', category_raw: 'C',
  };
  const trim = { l: 0.1, t: 0.2, w: 0.5, h: 0.6, nw: 1200, nh: 900 };

  it('RPC 第 13 鍵合法 → imageTrim(與 adapter 同一顆 parseImageTrim)', () => {
    expect(catalogRowToUIProduct({ ...base, card_image_trim: trim }).imageTrim).toEqual(trim);
  });

  it('缺鍵(apply 前)/ 髒數據 → undefined(cover fallback)', () => {
    expect(catalogRowToUIProduct(base).imageTrim).toBeUndefined();
    expect(
      catalogRowToUIProduct({ ...base, card_image_trim: { ...trim, w: 0 } }).imageTrim,
    ).toBeUndefined();
  });
});
