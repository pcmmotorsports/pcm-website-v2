import { describe, it, expect } from 'vitest';
import type { Product } from './types';
import { toMoneyAmount } from '../shared/types';
import { computeEffectivePrice } from './pricing';

/**
 * Helper: 建 fake Product entity(本檔 inline 用、對齊
 * packages/adapters/src/in-memory/InMemoryProductRepository.test.ts createFakeProduct 慣例)。
 *
 * 預設值:store=38000、general=45000、premiumStore=36000(僅用作 priceByTier 完整性、
 * `premiumStore` 顯示價由 computeEffectivePrice 動態算、不吃 priceByTier.premiumStore 字面;
 * 對齊 supabase-schema-design.md §5.1)。
 */
function createFakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-001',
    productCode: 'AKRA-EX-01', // M-1-16c-4b:Product.productCode 必填
    name: 'Akrapovič 鈦合金全段排氣管',
    brand: { id: 'b-akrapovic', name: 'Akrapovič', slug: 'akrapovic', premium_extra_pct: 0 },
    category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] },
    fitments: [
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2024 },
    ],
    priceByTier: {
      general: { amount: toMoneyAmount(45000), currency: 'TWD' },
      store: { amount: toMoneyAmount(38000), currency: 'TWD' },
      premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
    },
    description: '全段鈦合金、輕量化 35%、原廠 ECU 相容',
    highlights: [], // A/#270:Product.highlights 必填(本 factory 不測賣點 → 空陣列)
    manuals: [], // #270:Product.manuals 必填(本 factory 不測安裝資源 → 空陣列)
    soundClips: [], // 附件線 3b:Product.soundClips 必填且恆非 null(本 factory 不測聲音檔 → 空陣列)
    images: ['https://example.com/img1.jpg'],
    availability: 'in-stock',
    handle: 'akrapovic-titanium-full-exhaust',
    subtitle: '適用 Panigale V4 / 2018-2024 / 輕量化 35%',
    variants: [], // M-1-16a:variants 必填、本 factory 不測變體 → 空陣列
    variantCount: 0, // 2026-08-08 必填:本 factory 不測變體 ⇒ 填 0(給不出真值就明填、不用 optional 逃避)
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('computeEffectivePrice', () => {
  describe('三 tier 基本回值', () => {
    it('general tier 返 priceByTier.general', () => {
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'general');
      expect(result).toEqual({ amount: toMoneyAmount(45000), currency: 'TWD' });
    });

    it('store tier 返 priceByTier.store', () => {
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'store');
      expect(result).toEqual({ amount: toMoneyAmount(38000), currency: 'TWD' });
    });

    it('premiumStore tier 動態算、不吃 priceByTier.premiumStore 字面', () => {
      // 即使 priceByTier.premiumStore = 36000、computeEffectivePrice 仍從 store + premium_extra_pct 算
      // brand.premium_extra_pct = 0 → 結果應 = store(38000)、不是 priceByTier.premiumStore(36000)
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
      expect(result.amount).not.toBe(toMoneyAmount(36000));
    });
  });

  describe('premiumStore 公式 + premium_extra_pct 邊界', () => {
    it('premium_extra_pct = 5 → store × 0.95、Math.round', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
        priceByTier: {
          general: { amount: toMoneyAmount(45000), currency: 'TWD' },
          store: { amount: toMoneyAmount(38000), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
        },
      });
      // 38000 * 0.95 = 36100、整數無 round
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(36100));
      expect(result.currency).toBe('TWD');
    });

    it('premium_extra_pct = 30 上限邊界(對齊 brands.premium_extra_pct CHECK 0-30)', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 30 },
      });
      // 38000 * 0.7 = 26600
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(26600));
    });

    it('premium_extra_pct = 0 → fallback effect、回 store 價', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 0 },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('Math.round 行為:非整數結果 round 到最近整數', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
        priceByTier: {
          general: { amount: toMoneyAmount(45000), currency: 'TWD' },
          store: { amount: toMoneyAmount(38001), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
        },
      });
      // 38001 * 0.95 = 36100.95 → Math.round = 36101
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(36101));
    });
  });

  /**
   * 為何用 `as unknown as number`:
   * Brand.premium_extra_pct 型別已強制 number、TS 不允許直接賦 null / string;
   * test 需偽造 corrupt data 驗 runtime guard、繞過 type system 是必要 trade-off
   * (對齊 simp-17「雙重 type+runtime 防護」教訓)
   */
  describe('premium_extra_pct 非 number 邊界 fallback 0%', () => {
    it('premium_extra_pct = null → fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: null as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('premium_extra_pct = undefined → fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: undefined as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('premium_extra_pct = 字串(corrupt data)→ fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: 'abc' as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });
  });

  // 🔴 這一族釘的是【浮點少算一元】那個回歸(2026-09-02 `-0e`;Sean 拍「那就修好啊」)。
  //    舊寫法 `Math.round(amount * (1 - pct / 100))` 在這幾組會少算一元;
  //    ⇒ **把 pricing.ts 那一行改回舊形狀, 這一族必須紅。**
  //    實例來源:金額 1..300,000 × pct 0..30 逐組與 BigInt 比對, 舊寫法 5,870 組不同。
  describe('🔴 浮點回歸:恰好落在 .5 的那幾組必須逢半進位', () => {
    // [store 價, pct, 正確答案] —— 三組都是舊寫法會少算一元的
    const CASES: ReadonlyArray<readonly [number, number, number]> = [
      [1075, 6, 1011], // 1075 × 0.94 = 1010.5 ⇒ 舊寫法給 1010
      [2175, 6, 2045],
      [4275, 6, 4019],
    ];
    for (const [store, pct, want] of CASES) {
      it(`store=${store} pct=${pct}% ⇒ ${want}(舊寫法會給 ${want - 1})`, () => {
        const product = createFakeProduct({
          priceByTier: {
            general: { amount: toMoneyAmount(store), currency: 'TWD' },
            store: { amount: toMoneyAmount(store), currency: 'TWD' },
            // premiumStore 這一格【不會被讀到】—— computeEffectivePrice 是自己算的,
            // 不是取這個值。放一個明顯錯的數字, 讓「它其實有被讀」變成看得見的紅。
            premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
          },
          brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: pct },
        });
        expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(want));
      });
    }

    // 🔴 codex R1 #1/#2/#4:上面三組都是 pct=6 且恰好 .5 ⇒ 辨識力不夠。
    //    補「剛低於 / 剛高於 .5」「不同 pct」「amount=0」與兩個【前提被破壞】的世界。
    const MORE: ReadonlyArray<readonly [number, number, number, string]> = [
      [1000, 10, 900, '整除 ⇒ 沒有小數可爭'],
      [1001, 10, 901, '900.9 ⇒ 進位'],
      [1005, 10, 905, '904.5 ⇒ 恰好 .5 ⇒ 逢半進位'],
      [1004, 10, 904, '903.6 ⇒ 進位'],
      [1002, 10, 902, '901.8 ⇒ 進位'],
      [333, 3, 323, '323.01 ⇒ 剛高於整數 ⇒ 捨去'],
      [0, 30, 0, 'amount=0 ⇒ 0(不能因為守門而回別的東西)'],
      [1, 30, 1, '最小非零金額 ⇒ 0.7 ⇒ 進位成 1'],
      // 🔴 codex R2 #3:上面沒有一格的餘數是 **49** ⇒ 把 `+ 50` 突變成 `+ 51` 抓不到。
      //    51 × 99 = 5049 ⇒ +50 = 5099 ⇒ /100 floor = **50**(而 +51 會給 51)。
      [51, 1, 50, '餘數 49 ⇒ 剛低於 .5 ⇒ 捨去(這一格釘住 `+ 50` 那個常數)'],
    ];
    for (const [store, pct, want, why] of MORE) {
      it(`store=${store} pct=${pct}% ⇒ ${want}(${why})`, () => {
        const product = createFakeProduct({
          priceByTier: {
            general: { amount: toMoneyAmount(store), currency: 'TWD' },
            store: { amount: toMoneyAmount(store), currency: 'TWD' },
            premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
          },
          brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: pct },
        });
        expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(want));
      });
    }

    // 🔴 前提被破壞的世界(codex R1 #1/#3)——【不 throw、退回 store 原價】。
    //    而它們的存在理由:DB CHECK 只擋 DB 那一側,mock / fixture / 外部來源進得來。
    const BAD: ReadonlyArray<readonly [unknown, string]> = [
      [16.4, '非整數 pct ⇒ 100−16.4 本身是浮點, 會算出 313 而正確是 314'],
      // 🔴 16.4 那一格【不是被整數守門接住的】—— 突變實測(拿掉整數守門)它仍然綠,
      //    因為 375×83.6 = 31349.999999999996 ⇒ 被 **safe-integer 守門** 擋下,是運氣。
      //    ⇒ 而 16.8 會滑過去:375×83.2 = 31200 **剛好是整數** ⇒ safe-integer 接不住
      //    ⇒ ⇒ 所以那一格只有【整數守門】接得住 ⇒ 它在下面單獨立一個 it()。
      [16.8, '非整數 pct 而乘積剛好是整數 ⇒ 只有整數守門接得住'],
      [-10, '負 pct ⇒ 會變成【加價】'],
      [151, '>100 ⇒ 會算出負金額, 而 toMoneyAmount 才 throw(太晚)'],
      [31, '超出 DB CHECK 上限 30'],
      ['6', '字串 ⇒ 型別是 unknown 進得來'],
    ];
    for (const [pct, why] of BAD) {
      it(`🔴 pct=${String(pct)} ⇒ 退回 store 原價 375(${why})`, () => {
        const product = createFakeProduct({
          priceByTier: {
            general: { amount: toMoneyAmount(375), currency: 'TWD' },
            store: { amount: toMoneyAmount(375), currency: 'TWD' },
            premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
          },
          brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: pct as number },
        });
        expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(375));
      });
    }

    // 🔴 codex R2 #2:上面沒有一格命中【safe-integer 守門】⇒ 單獨刪掉那兩行, 29 格仍全綠。
    //    ⇒ 這兩格各釘一道。金額用 MAX_SAFE_INTEGER 附近的值 —— 現實不會有,
    //      而守門的存在理由就是「型別擋不住的那個世界」。
    it('🔴 amount 超出 safe integer ⇒ 退回 store 原價(釘 isSafeInteger(amount))', () => {
      const huge = Number.MAX_SAFE_INTEGER; // 9007199254740991
      const product = createFakeProduct({
        priceByTier: {
          general: { amount: toMoneyAmount(huge), currency: 'TWD' },
          store: { amount: toMoneyAmount(huge), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
        },
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 6 },
      });
      // huge 本身是 safe;而 huge × 94 遠超過 2^53 ⇒ 由第二道(numerator)擋下
      expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(huge));
    });

    it('🟢 對照組:剛好落在 safe 範圍內的大金額 ⇒ 正常算(證明上面那格不是「大就擋」)', () => {
      // 90000000000000 × 94 = 8.46e15 < 2^53(9.007e15)⇒ 兩道守門都過
      const big = 90000000000000;
      const product = createFakeProduct({
        priceByTier: {
          general: { amount: toMoneyAmount(big), currency: 'TWD' },
          store: { amount: toMoneyAmount(big), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
        },
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 6 },
      });
      expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(84600000000000));
    });

    // 🟢 對照組:一組【舊寫法也會對】的 —— 否則上面全紅時分不出
    //    「修法壞了」與「這一族本來就該紅」。
    it('🟢 對照組:store=1000 pct=10% ⇒ 900(新舊寫法都對 ⇒ 它不該因本次改動而變)', () => {
      const product = createFakeProduct({
        priceByTier: {
          general: { amount: toMoneyAmount(1000), currency: 'TWD' },
          store: { amount: toMoneyAmount(1000), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(999999), currency: 'TWD' },
        },
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 10 },
      });
      expect(computeEffectivePrice(product, 'premiumStore').amount).toBe(toMoneyAmount(900));
    });
  });

  describe('currency 對齊 store tier', () => {
    it('premiumStore 返 Money.currency 從 store tier 拿', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.currency).toBe('TWD');
    });
  });
});
