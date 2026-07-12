import { describe, expect, it } from 'vitest';
import { catalogRowToUIProduct } from './catalog-page';

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
});
