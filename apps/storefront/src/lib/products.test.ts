// @vitest-environment node
//
// products.test.ts — toUIProduct 經銷價 strip「最後一哩」回歸守門(2026-06-05 安全稽核 M-11)。
//
// toUIProduct 是 domain Product(含完整 priceByTier 三 tier)→ MockProduct(只帶單一 price number)
// 的最終 strip 閘,是「經銷價不進 client bundle」最高鐵則(鐵則 12)的最後一道執行點。稽核發現此函式
// 原本零直接單元測試:若日後被改壞(誤帶 priceByTier 進回傳物件、或 as any 逃逸型別守門),CI 不會紅燈。
// 本測試把現況不變式釘成回歸網:
//   - 建帶「真實非零經銷價」(商品 + 變體 store/premiumStore)的 domain Product;
//   - 斷言 toUIProduct 回傳物件 JSON.stringify 後不含任何非 general 經銷價數值 / priceByTier 結構鍵;
//   - 斷言變體只剩 {sku,spec,price,images}、price === priceByTier.general.amount;
//   - 斷言 tier dispatch 正確(store tier price === store amount)但仍只吐單一數字、不吐整個 priceByTier 結構。
//
// node env + mock 'server-only':products.ts 檔頭 import 'server-only' + `typeof window` guard,
//   node 環境無 window、mock server-only 避免 import throw(@pcm/adapters 傳遞鏈亦含 server-only)。
//
// canary 數值刻意挑「彼此非子字串」(避免如 '38000' 含 '8000' 造成 not.toContain 誤判):
//   顯示值 = 45000(general)/ 38000(store 顯示)/ 12000(變體 general);
//   禁現值 = 36111(premiumStore 永不顯)/ 79222(變體 store)/ 79333(變體 premiumStore)。

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { toMoneyAmount } from '@pcm/domain';
import type { Product, ProductVariant } from '@pcm/domain';
import { toUIProduct } from './products';

const GENERAL = 45000;
const DEALER_STORE = 38000;
const DEALER_PREMIUM = 36111; // canary:premiumStore 字面、computeEffectivePrice 永不顯此值
const VARIANT_GENERAL = 12000;
const VARIANT_STORE = 79222; // canary:變體 store
const VARIANT_PREMIUM = 79333; // canary:變體 premiumStore

// toUIProduct 對外輸出絕不可出現的經銷結構鍵名
const FORBIDDEN_KEYS = ['priceByTier', 'price_store', 'premiumStore', 'cost', 'shopee'];

function fakeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v-001',
    sku: 'AKRA-EX-01-A',
    spec: { weave: '3K', finish: 'Glossy' },
    priceByTier: {
      general: { amount: toMoneyAmount(VARIANT_GENERAL), currency: 'TWD' },
      store: { amount: toMoneyAmount(VARIANT_STORE), currency: 'TWD' },
      premiumStore: { amount: toMoneyAmount(VARIANT_PREMIUM), currency: 'TWD' },
    },
    availability: 'in-stock',
    images: ['https://example.com/v1.jpg'],
    sortOrder: 0,
    ...overrides,
  };
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-001',
    productCode: 'AKRA-EX-01',
    name: 'Akrapovič 鈦合金全段排氣管',
    brand: { id: 'b-akra', name: 'Akrapovič', slug: 'akrapovic', premium_extra_pct: 0 },
    category: { raw: '碳纖維部品', segments: ['碳纖維部品'] },
    fitments: [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2024 }],
    priceByTier: {
      general: { amount: toMoneyAmount(GENERAL), currency: 'TWD' },
      store: { amount: toMoneyAmount(DEALER_STORE), currency: 'TWD' },
      premiumStore: { amount: toMoneyAmount(DEALER_PREMIUM), currency: 'TWD' },
    },
    description: '全段鈦合金、輕量化 35%',
    highlights: [],
    manuals: [],
    images: ['https://example.com/img1.jpg'],
    availability: 'in-stock',
    handle: 'akrapovic-titanium-full-exhaust',
    subtitle: '適用 Panigale V4',
    variants: [fakeVariant()],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toUIProduct — 經銷價 strip 最後一哩(M-11 安全回歸)', () => {
  it('general tier:輸出 JSON 不含任何經銷價數值或 priceByTier 結構鍵', () => {
    const ui = toUIProduct(fakeProduct(), 'general');
    const json = JSON.stringify(ui);

    expect(ui.price).toBe(GENERAL);
    // P0-C:brandSlug ← domain brand.slug plumb 到 UI(前台碳纖維段守門用、≠ brand 顯示名);F1 回歸守門。
    expect(ui.brandSlug).toBe('akrapovic');
    // 商品 + 變體的所有非 general 經銷價數值皆不得出現
    for (const amt of [DEALER_STORE, DEALER_PREMIUM, VARIANT_STORE, VARIANT_PREMIUM]) {
      expect(json).not.toContain(String(amt));
    }
    // 經銷結構鍵名皆不得出現
    for (const key of FORBIDDEN_KEYS) {
      expect(json).not.toContain(key);
    }
  });

  it('變體只剩 {id,sku,spec,price,images}、price === priceByTier.general.amount(不帶 priceByTier)', () => {
    const ui = toUIProduct(fakeProduct(), 'general');
    expect(ui.variants).toHaveLength(1);
    const v = ui.variants![0]!;
    // 🔴 經銷價防護白名單:M-3-S2-b2-c 多帶 id(uuid join key、cart variant_id 來源、非敏感),
    //   仍嚴格只此 5 欄、絕不含 priceByTier / store / premiumStore(白名單守門不被加 id 削弱)。
    expect(Object.keys(v).sort()).toEqual(['id', 'images', 'price', 'sku', 'spec']);
    expect(v.id).toBe('v-001'); // id ← domain ProductVariant.id plumb 到 UI(cart 線契約來源)
    expect(v.price).toBe(VARIANT_GENERAL);
    expect(v).not.toHaveProperty('priceByTier');
  });

  it('store tier:price 正確 dispatch 為 store 價、但仍只吐單一數字不吐整個 priceByTier 結構', () => {
    const ui = toUIProduct(fakeProduct(), 'store');
    const json = JSON.stringify(ui);

    // dispatch 正確:商品價 = store amount(computeEffectivePrice store 分支)
    expect(ui.price).toBe(DEALER_STORE);
    expect(ui.tierLabel).toBe('店價');
    // 但「未被選中的其他 tier」經銷價 + priceByTier 結構鍵 仍絕不可外洩
    // (變體價恆取 general、故變體 store/premiumStore canary 永不顯)
    for (const amt of [DEALER_PREMIUM, VARIANT_STORE, VARIANT_PREMIUM]) {
      expect(json).not.toContain(String(amt));
    }
    for (const key of FORBIDDEN_KEYS) {
      expect(json).not.toContain(key);
    }
  });

  // 反向健全測(code-reviewer NIT 1):證明上方 not.toContain 偵測邏輯「抓得到」真洩漏,
  //   防回歸網自身退化成 vacuous(不會失敗的測試 = 無用)。模擬一個「被改壞的 toUIProduct」
  //   誤把 priceByTier 結構帶進回傳物件 → 斷言偵測邏輯確實亮紅(JSON.stringify 有把洩漏 surface 出來)。
  it('反向健全:輸出若誤帶 priceByTier 經銷結構,回歸網偵測得到(非 vacuous)', () => {
    const leaked = {
      ...toUIProduct(fakeProduct(), 'general'),
      priceByTier: { store: { amount: DEALER_STORE }, premiumStore: { amount: DEALER_PREMIUM } },
    };
    const json = JSON.stringify(leaked);
    // 偵測機制有效:洩漏的結構鍵與經銷價數值都被 JSON.stringify surface 出來、會被上方 not.toContain 抓到
    expect(json).toContain('priceByTier');
    expect(json).toContain(String(DEALER_STORE));
    expect(json).toContain(String(DEALER_PREMIUM));
  });

  // #270 安裝資源:manuals / videoUrl 透傳 domain → UIProduct(InstallResources 消費)
  it('#270:manuals / videoUrl 透傳至 UIProduct', () => {
    const ui = toUIProduct(
      fakeProduct({ manuals: [{ label: '安裝說明書', url: 'https://x/a.pdf' }], videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
      'general',
    );
    expect(ui.manuals).toEqual([{ label: '安裝說明書', url: 'https://x/a.pdf' }]);
    expect(ui.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
  });
});
