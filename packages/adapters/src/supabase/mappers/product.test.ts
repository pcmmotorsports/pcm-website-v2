import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeEffectivePrice } from '@pcm/domain';
import {
  mapDomainProductToSupabase,
  mapSupabaseProductToDomain,
  mapVariantRow,
  type SupabaseProductRow,
  type SupabaseVariantRow,
} from './product';

// ─────────────────────────────────────────────────────────────
// M-1-16c-2 變體資料層 mapper 單測(backlog #203)
//   - mapVariantRow:wire variant row → domain ProductVariant
//   - mapSupabaseProductToDomain 變體整合:embed → variants(sortOrder 排序)/ list 路徑 → []
// 🔴 經銷價防護 contract(working-style 第 35 條):
//   - SupabaseVariantRow 型別本就無 price_store / metadata(view 物理排除)
//   - mapVariantRow 輸出 store / premiumStore = dummy 0(非 price_general)、不洩經銷價
// ─────────────────────────────────────────────────────────────

const baseVariantRow: SupabaseVariantRow = {
  id: 'var-1',
  sku: 'BMS1K2KR03-G-F',
  spec: { weave: 'Forged', finish: 'Glossy' },
  price_general: 8400,
  availability: 'in-stock',
  images: ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg'],
  sort_order: 0,
};

const baseProductRow: SupabaseProductRow = {
  id: 'prod-1',
  external_id: 'prod-1',
  title: '單座蓋',
  subtitle: 'Aprilia RSV4 · 碳纖維',
  description: '<p>desc</p>',
  highlights: [],
  manuals: [],
  video_url: null,
  handle: 'rpm-bms1k2kr03',
  price_general: 6800,
  fitments: [],
  images: ['https://cdn.shopify.com/group.jpg'],
  availability: 'in-stock',
  brand_id: 'brand-1',
  category_id: 'cat-1',
  metadata: {},
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T01:00:00Z',
  brands: {
    id: 'brand-1',
    name: 'RPM CARBON',
    slug: 'rpm-carbon',
    description: null,
    logo_url: null,
    premium_extra_pct: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
  categories: {
    id: 'cat-1',
    parent_category_id: null,
    name: '碳纖維部品',
    raw_path: '碳纖維部品',
    segments: ['碳纖維部品'],
    sort_order: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
};

describe('mapVariantRow', () => {
  it('happy path:還原 sku / spec / availability / sortOrder / images + general 價', () => {
    const v = mapVariantRow(baseVariantRow);
    expect(v.id).toBe('var-1');
    expect(v.sku).toBe('BMS1K2KR03-G-F');
    expect(v.spec).toEqual({ weave: 'Forged', finish: 'Glossy' });
    expect(v.availability).toBe('in-stock');
    expect(v.sortOrder).toBe(0);
    expect(v.images).toEqual([
      'https://cdn.shopify.com/a.jpg',
      'https://cdn.shopify.com/b.jpg',
    ]);
    expect(v.priceByTier.general.amount).toBe(8400);
    expect(v.priceByTier.general.currency).toBe('TWD');
  });

  it('🔴 經銷價防護:store / premiumStore = dummy 0(非 price_general)、不洩經銷價', () => {
    const v = mapVariantRow({ ...baseVariantRow, price_general: 8400 });
    expect(v.priceByTier.store.amount).toBe(0);
    expect(v.priceByTier.premiumStore.amount).toBe(0);
    // 確認 dummy 不是把 general 灌進去(若誤把 price_general 當經銷價會等於 8400)
    expect(v.priceByTier.store.amount).not.toBe(8400);
    expect(v.priceByTier.premiumStore.amount).not.toBe(8400);
  });

  // ────────────────────────────────────────────────────────────
  // 🔴 D-4 引信(2026-08-29 線D;主視窗指定「只裝引信、不改行為」)
  //
  // **上面那格守的是「今天不洩經銷價」。這一組守的是【接通的那一天】。**
  // 📌 差別:上面那格在有人接上真價的那天會紅,**而最自然的修法是把 `0` 改成真值** ——
  //    改完它就綠了,**而畫面上仍然顯示 0,沒有任何東西會再紅一次。**
  //
  // 🔴 **為什麼「顯示 0」比「不顯示」危險**:一個顯示 0 的價格**看起來像免費**。
  //
  // 🔴🔴 **這道引信的天花板 —— 先讀這段,不然你會高估它**(code-reviewer 2026-08-29 C3):
  //    `product.ts` 的 TODO 逐字寫著真價要「改走 **server-side pricing endpoint**
  //    (讀 base 表 `price_store` / `price_by_tier`)、本 dummy 退場」
  //    ⇒ **照那條路接通的話,新碼根本不會落在這兩支 mapper 裡 ⇒ 本引信全程綠。**
  //    📌 **⇒ 它守的是【這支檔這條路】,不是「有沒有人接上經銷價」。**
  //       這一格綠 **不等於** 沒有人接 —— 而那兩句話讀起來幾乎一樣。
  //    ⇒ 真正的覆蓋要在 D-1/D-2 那兩片各自裝,見 `~/pcm-mailbox/線D-plan-經銷價接過來-v2-20260829.md`。
  //
  // ⚠️ **這一組【不改任何行為】** —— 只是讓「有人走這條路接上了」發得出聲音。
  //    真正的修法(顯示路徑)是 D-4 那片,而那片動的是價格 ⇒ 鐵則 12 ①,不在這裡順手做。
  describe('🔴 D-4 引信:有人【從這兩支 mapper】接上經銷價時要發得出聲音', () => {
    const SRC = readFileSync(new URL('./product.ts', import.meta.url), 'utf8');

    /**
     * 🔴 **只取【讀取方向】兩支函式的本體,而且剝掉整行註解。**
     *
     * 第一版的尺是 `SRC.includes('price_store')` ⇒ **一裝就紅**,而紅的理由全是假的:
     * 它咬到 ①`SupabaseVariantRow` 的型別欄宣告(`product.ts:98`)②**八處**講
     * 「view 物理排除 price_store」之類的註解 ③`mapDomainProductToSupabase` 的**寫入**方向
     * (`:398`)。📌 **尺的射程比它的宣稱寬 —— 而寬的那一版看起來更嚴格,所以不會有人懷疑它。**
     *
     * 🔴 **`i < 0` 一定要 throw**(code-reviewer C1):`indexOf` 找不到會回 `-1`,
     * 而 `SRC.slice(-1, j)` 回**空字串** ⇒ **F1 安靜地變成半盲而且照樣綠**。
     * 觸發條件很日常:改名,或改寫成 `export const mapVariantRow = (...) =>`。
     * 📌 **一把切歪的尺與一把沒東西可咬的尺,印出來的是同一個綠。**
     */
    const sliceOf = (fn: string) => {
      const i = SRC.indexOf(`export function ${fn}`);
      if (i < 0) throw new Error(`切不到 ${fn} —— 函式改名或改寫成 const 了,這把尺已失效`);
      const j = SRC.indexOf('\nexport ', i + 1);
      return SRC.slice(i, j === -1 ? undefined : j)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/[^\n]*$/gm, ''); // 🔴 只剝【整行】註解:行尾的 `//`(例如網址)不吃
    };
    const readPaths = [sliceOf('mapSupabaseProductToDomain'), sliceOf('mapVariantRow')].join('\n');

    /** 🔴 禁字集含 `price_by_tier` —— 上面天花板那段點名的第二個來源(實測今天讀取切片內 0 命中)。 */
    const BANNED = ['price_store', 'price_by_tier'] as const;

    it('[F1] 讀取方向今天【讀 price_general、不碰經銷價欄】—— 接上的那天這格必紅', () => {
      // 🔴 正對照先跑:證明我切出來的是一段【非空、而且真的是那兩支】的碼,
      //    不是在對空字串下斷言(「排除」形狀的守門在清單空掉時恆真 ——
      //    `docs/patterns/guard-and-instrument-traps.md`)。
      expect(readPaths).toContain('price_general');
      expect(readPaths).toContain('priceByTier');
      // 🔴 負對照:剝註解真的有效。
      //    ⚠️ 第一版用 `view 物理排除` ⇒ **恆真格** —— 那兩處(`product.ts:119`/`:132`)
      //    都在切片起點(`:178`)【之前】,本來就不在切片裡(code-reviewer C2 實測:
      //    把 strip 換成恆等函式,那格照樣通過)。改用**切片內真的有的**那句。
      expect(SRC).toContain('本 dummy 退場'); // 那句註解確實存在於檔內
      expect(readPaths, '剝註解沒生效 ⇒ F1 會被註解裡的 price_store 誤觸').not.toContain(
        '本 dummy 退場',
      );
      for (const w of BANNED) {
        // 🔴 怎麼會紅:有人把經銷價欄接進讀取方向 ⇒ 這裡紅。
        //    **那正是我們要的** —— 它會把人帶到上面那段天花板,而那段會告訴他顯示路徑還沒做。
        expect(
          readPaths.includes(w),
          `有人把 ${w} 接進讀取方向了 ⇒ 顯示路徑(D-4)必須同時做,否則畫面會顯示 0 而它看起來像免費`,
        ).toBe(false);
      }
    });

    it('[F2] premiumStore 的折數公式今天【算得對,而它算的是 0】—— 真而空', () => {
      // 🔴 **這一格的敘事被 code-reviewer C4 改過,原版指錯了病灶。**
      //    `product.ts` 那句「真值由 computeEffectivePrice 在 storefront dispatch 時覆蓋」
      //    **掛在 `premiumStore` 上,不是 `store` 上**,而 `computeEffectivePrice` 對 premiumStore
      //    **確實有算**(`round(store × (1 - pct/100))`)⇒ **那句註解不是假的,它是【真而空】** ——
      //    公式沒壞,壞的是餵給它的輸入(`store` 是硬寫的 0)。
      // 📌 **這個分別很貴**:寫成「註解是假的」會讓下一個人去修 `computeEffectivePrice`,
      //    **而那支沒壞。** 要修的是輸入,不是公式。
      const p = mapSupabaseProductToDomain({ ...baseProductRow, price_general: 8400 });
      // 🔴 用一個【非 0 的折數】,不然 store=0 與 pct=0 兩個原因都會印 0,分不出是哪個。
      const withPct = { ...p, brand: { ...p.brand, premium_extra_pct: 20 } };
      expect(computeEffectivePrice(withPct, 'premiumStore').amount).toBe(0);
      // 🔴 正對照:同一條公式餵一個【非 0 的 store】⇒ 它會真的打折 ⇒ 證明公式是活的、
      //    上面那個 0 是輸入造成的,不是公式壞了。怎麼會紅:把折數公式拿掉 ⇒ 這裡變 8400。
      const wired = { ...withPct, priceByTier: { ...withPct.priceByTier, store: { amount: 8400 as never, currency: 'TWD' as const } } };
      expect(computeEffectivePrice(wired, 'premiumStore').amount).toBe(6720);
      // 🔴 而 general 那條路不是 0 ⇒ 這把尺量得到差別,不是三格都印 0。
      expect(computeEffectivePrice(p, 'general').amount).not.toBe(0);
    });
  });

  it('special 第三維 spec 還原(weave × finish × special)', () => {
    const v = mapVariantRow({
      ...baseVariantRow,
      spec: { weave: 'Plain', finish: 'Glossy', special: '12K' },
    });
    expect(v.spec).toEqual({ weave: 'Plain', finish: 'Glossy', special: '12K' });
  });

  it('空 images [] 合法(16c fallback 商品圖)', () => {
    const v = mapVariantRow({ ...baseVariantRow, images: [] });
    expect(v.images).toEqual([]);
  });

  it('price_general null → throw(16b 應已定價)', () => {
    expect(() => mapVariantRow({ ...baseVariantRow, price_general: null })).toThrow(
      /price_general/,
    );
  });

  it('runtime guard:spec 非 string 值 → throw(防 import 錯 shape 進 client)', () => {
    expect(() =>
      mapVariantRow({
        ...baseVariantRow,
        spec: { weave: 'Forged', finish: 123 as unknown as string },
      }),
    ).toThrow(/spec\.finish 非 string/);
  });

  it('runtime guard:images 非 string 元素 → throw', () => {
    expect(() =>
      mapVariantRow({
        ...baseVariantRow,
        images: ['ok.jpg', { url: 'x' } as unknown as string],
      }),
    ).toThrow(/images\[1\] 非 string/);
  });

  // #264:jsonb 來源 spec/images 可為 null(試點 spec=NULL 未經 rpm-transform ?? {} 轉、或歷史列);
  //   舊版 Object.entries(null)/null.map() 會 throw → 整個商品詳情頁 adapter 層 500。harden 後視為空、不 throw。
  it('#264:spec=null → 空 spec、不 throw(防商品頁整頁 500)', () => {
    const v = mapVariantRow({ ...baseVariantRow, spec: null });
    expect(v.spec).toEqual({});
    expect(v.sku).toBe(baseVariantRow.sku); // 其餘欄位正常映射
  });

  it('#264:images=null → 空陣列、不 throw(靠 16c 商品代表圖 fallback)', () => {
    const v = mapVariantRow({ ...baseVariantRow, images: null });
    expect(v.images).toEqual([]);
  });

  it('#264:spec 與 images 同時 null → 兩者空、不 throw', () => {
    const v = mapVariantRow({ ...baseVariantRow, spec: null, images: null });
    expect(v.spec).toEqual({});
    expect(v.images).toEqual([]);
  });
});

describe('mapSupabaseProductToDomain 變體整合', () => {
  it('detail 路徑(embed product_variants_public)→ variants 填真 + 依 sortOrder 穩定排序', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { ...baseVariantRow, id: 'v2', sku: 'B-2', sort_order: 2 },
        { ...baseVariantRow, id: 'v0', sku: 'B-0', sort_order: 0 },
        { ...baseVariantRow, id: 'v1', sku: 'B-1', sort_order: 1 },
      ],
    });
    expect(p.variants.map((v) => v.sortOrder)).toEqual([0, 1, 2]);
    expect(p.variants.map((v) => v.sku)).toEqual(['B-0', 'B-1', 'B-2']);
  });

  it('list 路徑(無 embed key)→ variants 空陣列(避 N+1)', () => {
    const p = mapSupabaseProductToDomain(baseProductRow);
    expect(p.variants).toEqual([]);
    expect(p.variantCount).toBe(0);
  });

  it('🔴 經銷價防護:product-level priceByTier.store / premiumStore = dummy 0(非 price_general)', () => {
    // 🔴 本格守的是【檔頭 product.ts:172 那個宣稱】(「product mapper 的 priceByTier.store
    //    走 dummy」)—— 在此格之前只有 mapVariantRow 的 dummy 被斷(:86-92),product-level
    //    零覆蓋(2026-08-18 突變普查:把 :216 改成 leak price_general ⇒ 全套照綠)。
    // ⚠️ 本格【不是】防真經銷價外洩 —— 那由 view 排除守(SupabaseProductAdapter.test.ts 的
    //    SELECT 投射不含 price_store)。兩道防線各自有格,別拆錯那一道:這格拆了 = 檔頭宣稱失守;
    //    view 排除拆了 = 真經銷價才會進 row。
    const p = mapSupabaseProductToDomain({ ...baseProductRow, price_general: 8400 });
    expect(p.priceByTier.store.amount).toBe(0);
    expect(p.priceByTier.premiumStore.amount).toBe(0);
    expect(p.priceByTier.store.amount).not.toBe(8400);
    expect(p.priceByTier.premiumStore.amount).not.toBe(8400);
  });

  // ── 2026-08-08 Q28:list 投射改 embed `product_variants_public(id)`(只一欄,為了數 variantCount)──
  //
  // 🔴 這族守的是一條真實踩過的坑:列表卡片分不出「這款真的沒變體」與「有變體但沒帶下來」,
  //    於是把有變體商品加成幽靈品項(購物車 fail-closed 丟掉那行、客人卻看到加購成功)。
  //    修法是讓 list 也帶得回一個**數量**,但**不讓精簡形狀變成假變體**。

  it('list 路徑(embed 只有 id)→ variantCount 數得出來', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [{ id: 'v0' }, { id: 'v1' }, { id: 'v2' }],
    });
    expect(p.variantCount).toBe(3);
  });

  // 🔴 零回歸的關鍵:精簡形狀**不得**進 variants —— 餵給 mapVariantRow 會做出 sku 為空字串的
  //    垃圾變體,而 sku 會一路進購物車行(`app/cart/actions.ts:167`)。
  // 突變:拿掉 `.filter(isFullVariantRow)` ⇒ 只紅這條
  it('🔴 list 路徑(embed 只有 id)→ variants 仍為空(精簡形狀不得變成假變體)', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [{ id: 'v0' }, { id: 'v1' }],
    });
    expect(p.variants).toEqual([]);
  });

  // detail 路徑:兩者同一真相。突變:variantCount 改寫死 0 ⇒ 只紅這條與上面 list 那條
  it('detail 路徑 → variantCount 與 variants.length 一致', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { ...baseVariantRow, id: 'v0', sku: 'B-0', sort_order: 0 },
        { ...baseVariantRow, id: 'v1', sku: 'B-1', sort_order: 1 },
      ],
    });
    expect(p.variantCount).toBe(2);
    expect(p.variantCount).toBe(p.variants.length);
  });

  // 混合形狀(理論上不會發生、但判別函式必須逐筆判而不是看第一筆決定整批)。
  // 突變:把 filter 改成「看 [0] 決定整批」⇒ 只紅這條
  it('混合形狀 → 逐筆判別:完整的進 variants、精簡的只算數', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { id: 'lite' },
        { ...baseVariantRow, id: 'full', sku: 'B-FULL', sort_order: 0 },
      ],
    });
    expect(p.variantCount).toBe(2);
    expect(p.variants.map((v) => v.sku)).toEqual(['B-FULL']);
  });

  // M-1-16c-4b:productCode read/write round-trip(codex 關卡1 must-fix 2 + consider 5)
  it('read:productCode ← wire external_id(非 UUID id)', () => {
    const p = mapSupabaseProductToDomain({ ...baseProductRow, external_id: 'RPM-DCC01' });
    expect(p.productCode).toBe('RPM-DCC01');
    expect(p.productCode).not.toBe(p.id);
  });

  it('write:external_id ← domain.productCode(round-trip、非 domain.id placeholder)', () => {
    const domain = mapSupabaseProductToDomain({ ...baseProductRow, external_id: 'RPM-DCC01' });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.external_id).toBe('RPM-DCC01');
    expect(wire.external_id).not.toBe(domain.id);
  });

  it('sortOrder 並列(DB DEFAULT 0)→ sku tie-breaker 保確定性排序(codex 關卡2 consider 1)', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { ...baseVariantRow, id: 'vc', sku: 'SKU-C', sort_order: 0 },
        { ...baseVariantRow, id: 'va', sku: 'SKU-A', sort_order: 0 },
        { ...baseVariantRow, id: 'vb', sku: 'SKU-B', sort_order: 0 },
      ],
    });
    expect(p.variants.map((v) => v.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);
  });

  // A/#270:highlights guard — jsonb 來源 shape 不保證 → mapper 收斂為乾淨 string[](擋髒資料進 client)
  it('read:highlights 正常字串陣列 → 原樣還原', () => {
    const p = mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['G5 鈦合金', 'DLC 塗層'] });
    expect(p.highlights).toEqual(['G5 鈦合金', 'DLC 塗層']);
  });

  it('read:highlights = null / 非陣列 / 混非字串 → guard 收斂(恆 string[])', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, highlights: null }).highlights).toEqual([]);
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, highlights: { a: 1 } as unknown as unknown[] }).highlights,
    ).toEqual([]); // 非陣列 jsonb(object)→ []
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['乾淨', 123, null, { x: 1 }] as unknown[] })
        .highlights,
    ).toEqual(['乾淨']); // 混入非字串 → 只留 string
  });

  it('write:highlights round-trip(save mapper 持久化 domain.highlights)', () => {
    const domain = mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['賣點一', '賣點二'] });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.highlights).toEqual(['賣點一', '賣點二']);
  });

  // #270:manuals/video_url guard — jsonb 元素 shape 不保證 → 收斂為乾淨 ProductManual[] / optional string(擋髒資料進 client)
  it('read:manuals 正常物件陣列 → 原樣還原(sizeKB 為 number 才留)', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      manuals: [
        { label: '安裝說明書', url: 'https://x/a.pdf' },
        { label: '接線圖', url: 'https://x/b.pdf', sizeKB: 1200 },
      ],
    });
    expect(p.manuals).toEqual([
      { label: '安裝說明書', url: 'https://x/a.pdf' },
      { label: '接線圖', url: 'https://x/b.pdf', sizeKB: 1200 },
    ]);
  });

  it('read:manuals 髒項(缺 label/url、非物件、sizeKB 非 number)→ guard 濾除(恆 ProductManual[])', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, manuals: null }).manuals).toEqual([]);
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, manuals: { a: 1 } as unknown as unknown[] }).manuals,
    ).toEqual([]); // 非陣列 jsonb(object)→ []
    expect(
      mapSupabaseProductToDomain({
        ...baseProductRow,
        manuals: [
          { label: '有效', url: 'https://x/ok.pdf' },
          { label: '缺 url' }, // 缺 url → 濾
          { url: 'https://x/no-label.pdf' }, // 缺 label → 濾
          'not-an-object', // 非物件 → 濾
          { label: '壞大小', url: 'https://x/c.pdf', sizeKB: '1200' }, // sizeKB 非 number → 丟 sizeKB 保 label+url
        ] as unknown[],
      }).manuals,
    ).toEqual([
      { label: '有效', url: 'https://x/ok.pdf' },
      { label: '壞大小', url: 'https://x/c.pdf' },
    ]);
  });

  it('read:video_url 字串 → passthrough;null / 純空白 → undefined', () => {
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, video_url: 'https://youtu.be/dQw4w9WgXcQ' }).videoUrl,
    ).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(mapSupabaseProductToDomain({ ...baseProductRow, video_url: null }).videoUrl).toBeUndefined();
    expect(mapSupabaseProductToDomain({ ...baseProductRow, video_url: '   ' }).videoUrl).toBeUndefined();
  });

  it('write:manuals/video_url round-trip(save mapper 持久化;videoUrl undefined→null)', () => {
    const domain = mapSupabaseProductToDomain({
      ...baseProductRow,
      manuals: [{ label: '安裝說明書', url: 'https://x/a.pdf' }],
      video_url: 'https://youtu.be/dQw4w9WgXcQ',
    });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.manuals).toEqual([{ label: '安裝說明書', url: 'https://x/a.pdf' }]);
    expect(wire.video_url).toBe('https://youtu.be/dQw4w9WgXcQ');
    const noVideo = mapDomainProductToSupabase({ ...domain, videoUrl: undefined }, { brandId: 'b-1', categoryId: 'c-1' });
    expect(noVideo.video_url).toBeNull(); // videoUrl undefined → null 持久化(對齊 products.video_url nullable)
  });
});

describe('mapSupabaseProductToDomain card_image_trim(trim 線 S4a)', () => {
  const trim = { l: 0.1, t: 0.2, w: 0.5, h: 0.6, nw: 1200, nh: 900 };

  it('合法 trim jsonb → domain cardImageTrim(parseImageTrim 收斂)', () => {
    const product = mapSupabaseProductToDomain({ ...baseProductRow, card_image_trim: trim });
    expect(product.cardImageTrim).toEqual(trim);
  });

  it('缺鍵(save 路徑 base 表回讀;僅 row 物件層——adapter 請求層 42703 另屬部署順序依賴)→ undefined', () => {
    expect(mapSupabaseProductToDomain(baseProductRow).cardImageTrim).toBeUndefined();
  });

  it('髒數據(超界 / 非物件)→ undefined(cover fallback、不 throw)', () => {
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, card_image_trim: { ...trim, l: 1.5 } })
        .cardImageTrim,
    ).toBeUndefined();
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, card_image_trim: 'junk' }).cardImageTrim,
    ).toBeUndefined();
  });
});

// ── 附件線 3b:排氣聲浪音檔(products.sound_clips)────────────────────────────
//
// 🔴 這族守的是「讀取端逐列原樣透傳、只擋髒數據」。標題**不在這裡中文化**
//    (Q25=A:DB 存英文原文、中文化在顯示層;資料層烤標籤正是片 2 doc_type 遺失的成因)。
describe('mapSupabaseProductToDomain · soundClips', () => {
  const clips = [
    { title: 'Stock', url: 'https://cdn.example/s.wav' },
    { title: null, url: 'https://cdn.example/n.wav' },
  ];

  it('🔴 逐列原樣透傳(title 保留英文原文與 null,不在資料層翻譯)', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, sound_clips: clips }).soundClips).toEqual(
      clips,
    );
  });

  it('🔴 null(14 家供應商恆 null)/ 整欄缺 / 非陣列 → 空陣列,不 throw', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, sound_clips: null }).soundClips).toEqual([]);
    expect(mapSupabaseProductToDomain(baseProductRow).soundClips).toEqual([]);
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, sound_clips: 'junk' as unknown as unknown[] })
        .soundClips,
    ).toEqual([]);
  });

  it('🔴 髒數據逐項擋掉:url 非字串 / 空字串 / 元素非物件 → 丟該項,其餘保留', () => {
    const dirty = [
      { title: 'ok', url: 'https://cdn.example/ok.wav' },
      { title: 'no url', url: 123 },
      { title: 'empty', url: '   ' },
      'junk',
      null,
    ] as unknown[];
    expect(mapSupabaseProductToDomain({ ...baseProductRow, sound_clips: dirty }).soundClips).toEqual([
      { title: 'ok', url: 'https://cdn.example/ok.wav' },
    ]);
  });

  it('🔴 title 是髒值(數字/物件)→ 收斂成 null,不讓它被當標題印到畫面上', () => {
    const dirty = [{ title: 123, url: 'https://cdn.example/a.wav' }] as unknown[];
    expect(mapSupabaseProductToDomain({ ...baseProductRow, sound_clips: dirty }).soundClips).toEqual([
      { title: null, url: 'https://cdn.example/a.wav' },
    ]);
  });
});
