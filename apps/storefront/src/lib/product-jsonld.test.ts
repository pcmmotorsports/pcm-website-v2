// product-jsonld 單測 — schema.org/Product JSON-LD builder(M-1-16c-4c SEO/AI 友善)
//
// 重點守 🔴 鐵則 12 經銷洩漏:builder 逐欄白名單 + 序列化結果絕不含經銷字串/值。
// 涵蓋審查 session MUST-FIX 1(image 絕對URL guard)/ MUST-FIX 2(escape <)/
//   CONSIDER 4(注入髒值白名單防漏)/ CONSIDER 7(空 subtitle fallback、offerCount 精確)。

import { describe, expect, it } from 'vitest';

import { buildProductJsonLd, serializeProductJsonLd } from './product-jsonld';
import { MOCK_PRODUCTS, type MockProduct, type UIVariant } from '../data/mock-products';

// 乾淨 general-only fixture(對齊 toUIProduct 真路徑產出)
const base: MockProduct = {
  ...MOCK_PRODUCTS[0]!,
  name: 'RPM 碳纖維卡鉗散熱導風管',
  brand: 'RPM CARBON',
  price: 8400,
  category: '碳纖維部品',
  subtitle: undefined,
  productCode: 'RPM-DCC01',
  image: 'https://cdn.example.com/main.jpg',
  images: ['https://cdn.example.com/main.jpg'],
  variants: undefined,
};

const v = (price: number, sku = `SKU-${price}`): UIVariant => ({
  id: `v-${sku}`,
  sku,
  spec: {},
  price,
  images: [],
});

const ALLOWED_KEYS = new Set([
  '@context',
  '@type',
  'name',
  'image',
  'description',
  'sku',
  'brand',
  'category',
  'offers',
  'url',
]);

describe('buildProductJsonLd — 基本結構', () => {
  it('輸出 schema.org Product 基本欄位', () => {
    const r = buildProductJsonLd(base);
    expect(r['@context']).toBe('https://schema.org');
    expect(r['@type']).toBe('Product');
    expect(r.name).toBe(base.name);
    expect(r.brand).toEqual({ '@type': 'Brand', name: 'RPM CARBON' });
    expect(r.category).toBe('碳纖維部品');
  });

  it('sku ← productCode、無則省略(不用 slug 冒充)', () => {
    expect(buildProductJsonLd({ ...base, productCode: 'RPM-DCC01' }).sku).toBe('RPM-DCC01');
    expect(buildProductJsonLd({ ...base, productCode: undefined }).sku).toBeUndefined();
  });

  it('url 僅 opts.url 給時放(prod 未設 base 則省略)', () => {
    expect(buildProductJsonLd(base).url).toBeUndefined();
    expect(buildProductJsonLd(base, { url: 'https://x.com/products/y' }).url).toBe(
      'https://x.com/products/y',
    );
  });
});

describe('buildProductJsonLd — description fallback(CONSIDER 7)', () => {
  it('有 subtitle → 用 subtitle', () => {
    expect(buildProductJsonLd({ ...base, subtitle: 'Ducati Panigale · 碳纖維' }).description).toBe(
      'Ducati Panigale · 碳纖維',
    );
  });

  it('subtitle 全空白 → fallback product.name(非空字串)', () => {
    const d = buildProductJsonLd({ ...base, subtitle: '   ' }).description as string;
    expect(d).toBe(base.name);
    expect(d.length).toBeGreaterThan(0);
  });

  it('subtitle undefined → fallback product.name', () => {
    expect(buildProductJsonLd({ ...base, subtitle: undefined }).description).toBe(base.name);
  });
});

describe('buildProductJsonLd — image 絕對 URL guard(MUST-FIX 1)', () => {
  it('相對路徑 placeholder → 不進 image、欄位省略', () => {
    const r = buildProductJsonLd({ ...base, image: '/placeholder-product.png', images: ['/placeholder-product.png'] });
    expect(r.image).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('placeholder-product.png');
  });

  it('混合 → 只留絕對 http(s) URL、過濾相對/bare-key', () => {
    const r = buildProductJsonLd({
      ...base,
      images: ['/placeholder-product.png', 'https://cdn.example.com/a.jpg', 'bare-key', 'relative/x.png', 'http://cdn.example.com/b.jpg'],
    });
    expect(r.image).toEqual(['https://cdn.example.com/a.jpg', 'http://cdn.example.com/b.jpg']);
    const j = JSON.stringify(r);
    expect(j).not.toContain('placeholder-product.png');
    expect(j).not.toContain('bare-key');
    expect(j).not.toContain('relative/x.png');
  });

  it('無 images 欄 → image 省略、不爆', () => {
    expect(buildProductJsonLd({ ...base, images: undefined }).image).toBeUndefined();
  });
});

describe('buildProductJsonLd — offers(general only)', () => {
  it('多變體價有高低 → AggregateOffer lowPrice/highPrice/offerCount 精確', () => {
    const r = buildProductJsonLd({ ...base, variants: [v(8400), v(6800), v(8400)] });
    const o = r.offers as Record<string, unknown>;
    expect(o['@type']).toBe('AggregateOffer');
    expect(o.priceCurrency).toBe('TWD');
    expect(o.lowPrice).toBe(6800);
    expect(o.highPrice).toBe(8400);
    expect(o.offerCount).toBe(3);
  });

  it('變體同價 → 單 Offer', () => {
    const r = buildProductJsonLd({ ...base, variants: [v(6800), v(6800)] });
    const o = r.offers as Record<string, unknown>;
    expect(o['@type']).toBe('Offer');
    expect(o.price).toBe(6800);
  });

  it('無變體 → 單 Offer 用 product.price', () => {
    const r = buildProductJsonLd({ ...base, price: 12800, variants: undefined });
    const o = r.offers as Record<string, unknown>;
    expect(o['@type']).toBe('Offer');
    expect(o.price).toBe(12800);
  });

  // ⛔ ~~it('不放 availability 欄(Q3=A、#161 不顯庫存)')~~ —— 2026-09-09 Sean 親自拍乙取代。
  //    現在放 availability,而**全站同一個值** ⇒ 舊拍板要的「不顯庫存」仍然成立(Google 看不出
  //    誰缺貨),被換掉的只有做法。下面三條是新拍板的守門。
  describe('offers 三欄(Sean 2026-09-09 拍乙)', () => {
    const offersOf = (p: MockProduct, now?: Date) =>
      buildProductJsonLd(p, now ? { now } : undefined).offers as Record<string, unknown>;

    it('🔴 三個欄位在【每一種 offers 形狀】上都有(單 Offer / 同價 / AggregateOffer)', () => {
      const shapes: Array<[string, MockProduct]> = [
        ['無變體 → 單 Offer', base],
        ['變體同價 → 單 Offer', { ...base, variants: [v(8400), v(8400)] }],
        ['變體有價差 → AggregateOffer', { ...base, variants: [v(8400), v(6800)] }],
      ];
      for (const [label, product] of shapes) {
        const o = offersOf(product);
        expect(o.availability, label).toBe('https://schema.org/BackOrder');
        expect(o.itemCondition, label).toBe('https://schema.org/NewCondition');
        expect(o.priceValidUntil, label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // 正對照:確實產出了三種【不同】形狀,不是同一顆測三遍。
      expect(offersOf(shapes[2]![1])['@type']).toBe('AggregateOffer');
      expect(offersOf(shapes[0]![1])['@type']).toBe('Offer');
    });

    // 🔴 Sean 逐字「不要讓他知道缺貨」⇒ availability **不得隨庫存欄變**。
    //    而 builder 收的是 MockProduct(`inStock: boolean`)⇒ 兩種都餵一次。
    it('🔴 availability 不隨庫存變 —— 有貨與缺貨都吐 BackOrder', () => {
      expect(offersOf({ ...base, inStock: true }).availability).toBe('https://schema.org/BackOrder');
      expect(offersOf({ ...base, inStock: false }).availability).toBe(
        'https://schema.org/BackOrder',
      );
    });

    // 🔴 priceValidUntil 若寫死字面,會過期而且不會有東西叫 ⇒ 守它是【算出來】的。
    it('🔴 priceValidUntil 是動態算的(兩個不同的今天 ⇒ 兩個不同的日期,且相隔一年)', () => {
      const a = offersOf(base, new Date('2026-01-01T00:00:00Z')).priceValidUntil;
      const b = offersOf(base, new Date('2026-06-15T00:00:00Z')).priceValidUntil;
      expect(a).toBe('2027-01-01');
      expect(b).toBe('2027-06-15');
      expect(a).not.toBe(b);
    });
  });
});

describe('buildProductJsonLd — 🔴 鐵則 12 經銷洩漏白名單(CONSIDER 4)', () => {
  it('注入經銷髒值(as any)→ 序列化結果不含任何經銷欄/值', () => {
    const dirty = {
      ...base,
      price: 8400,
      priceByTier: { store: { amount: 99999 }, premiumStore: { amount: 77777 } },
      price_store: 88888,
      cost: 55555,
      originalPrice: 44444,
      tierLabel: '店價',
    } as unknown as MockProduct;

    const r = buildProductJsonLd(dirty);
    const j = JSON.stringify(r);
    for (const forbidden of [
      '99999',
      '88888',
      '77777',
      '55555',
      '44444',
      'priceByTier',
      'price_store',
      'premiumStore',
      'cost',
      'tierLabel',
      'originalPrice',
      'dealer',
      '經銷',
      'shopee',
    ]) {
      expect(j).not.toContain(forbidden);
    }
  });

  it('正向白名單:result keys ⊆ 允許集(防新欄位悄悄洩漏)', () => {
    const r = buildProductJsonLd({ ...base, variants: [v(8400), v(6800)] }, { url: 'https://x.com/p/y' });
    for (const k of Object.keys(r)) {
      expect(ALLOWED_KEYS.has(k)).toBe(true);
    }
  });

  it('offers 價 === general(無變體用 product.price、多變體 low/high 取 variants[].price)', () => {
    expect((buildProductJsonLd(base).offers as Record<string, unknown>).price).toBe(base.price);
    const agg = buildProductJsonLd({ ...base, variants: [v(8400), v(6800)] }).offers as Record<
      string,
      unknown
    >;
    expect(agg.lowPrice).toBe(6800);
    expect(agg.highPrice).toBe(8400);
  });
});

describe('serializeProductJsonLd — escape(MUST-FIX 2)', () => {
  it('< 轉成字面 \\u003c、無未轉義 </script> breakout', () => {
    const s = serializeProductJsonLd({ ...base, name: 'X </script><script>alert(1)</script>' });
    expect(s).toContain('\\u003c'); // 字面 6 bytes backslash-u-003c
    expect(s).not.toContain('</script>');
    expect(s).not.toContain('<script>');
  });

  it('序列化字串不含經銷字串(注入髒值)', () => {
    const dirty = {
      ...base,
      price_store: 88888,
      priceByTier: { store: { amount: 99999 } },
    } as unknown as MockProduct;
    const s = serializeProductJsonLd(dirty);
    for (const f of ['88888', '99999', 'price_store', 'priceByTier', 'premiumStore', 'cost', 'shopee', 'dealer', '經銷']) {
      expect(s).not.toContain(f);
    }
  });
});
