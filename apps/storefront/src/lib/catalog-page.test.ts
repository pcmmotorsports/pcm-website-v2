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

describe('🔴 catalogRowToUIProduct 不得偽造價格(Sean 2026-08-25 兩板)', () => {
  const base = {
    id: 'p1', title: 'T', subtitle: null, handle: 'h', availability: 'in-stock',
    price_general: 100, card_image: null, fits: '通用款', brand_name: 'B',
    brand_slug: 'b', category_raw: 'C',
  };

  // ── 為什麼這一格必須在【資料層】而不是元件層 ────────────────────────────
  // `Price.tsx` 已經有一道「拿不到價格就印 —」的閘(`fc42c4ff`)。
  // 🔴 而【只驗元件層看不見這一格有沒有做】—— 因為在拿掉 `?? 0` 之前,
  //    `null` 在資料層就已經被換成 `0` 了,元件層**永遠收不到 null**,兩發都會綠。
  // ⇒ 判別力只有從這一層餵才有。
  it('price_general = null ⇒ price 必須是 null,不得變成 0', () => {
    const out = catalogRowToUIProduct({ ...base, price_general: null });
    // 🔴 只留這一句:`toBeNull()` 已經嚴格排除 `0`(`expect(0).toBeNull()` 會失敗),
    //   再補一句 `not.toBe(0)` 是**恆真的**, 它讀起來像多守了一層而實際上零判別力(codex R1 nit)。
    expect(out.price).toBeNull();
  });

  it('price_general = 0(贈品)⇒ price 必須是 0,不得被吃成 null', () => {
    // Sean 2026-08-25 拍「乙:會, 偶爾有」(贈品 / 買一送一的那個「送」/ 試用品)
    // ⇒ 0 是合法價格。這一格與上一格是同一把尺的兩個方向,少一個就分不出 null 與 0。
    expect(catalogRowToUIProduct({ ...base, price_general: 0 }).price).toBe(0);
  });

  it('正對照:price_general = 6800 ⇒ price = 6800(證明這把尺會動)', () => {
    expect(catalogRowToUIProduct({ ...base, price_general: 6800 }).price).toBe(6800);
  });
});

// ─────────────────────────────────────────────────────────────
// ⟦fc-SUPPLIERPLACEHOLDER⟧ 目錄頁 RPC 這條路 —— **它不經過 adapter mapper。**
//
// 🔴 `/products` 與品牌頁走 RPC `search_catalog_by_vehicle` ⇒ 直接吃 `row.card_image`
//    (view 的 `p.images ->> 0`, **未濾**)⇒ 只修 mapper 那一半, 客人最常去的那一頁照樣看到爛圖。
// 📌 而它是 code-reviewer 2026-09-02 從 diff 讀出來的 —— **我原本的註解逐字寫著
//    「storefront 五條讀取路徑全部經過 mapper」, 而那句話是假的。**
// ─────────────────────────────────────────────────────────────
describe('⟦fc-SUPPLIERPLACEHOLDER⟧ 目錄頁 RPC 路徑', () => {
  const base = {
    id: 'p1', title: 'T', subtitle: null, handle: 'h', availability: 'in-stock',
    price_general: 100, card_image: null, fits: '通用款', brand_name: 'B',
    brand_slug: 'b', category_raw: 'C',
  };
  const G = 'https://www.gillestooling.com/media/01/e4/ac/1711800467/';
  const trim = { l: 0.1, t: 0.2, w: 0.5, h: 0.6, nw: 1200, nh: 900 };

  it.each([
    `${G}spareparts-mit-tesxt.png`,
    `${G}bild-schraube-gilles-tooling.png`,
    'https://www.extreme-components.com/components/com_virtuemart/assets/images/vmgeneral/noimage.jpg',
  ])('🔴 供應商佔位圖 ⇒ image = null(下游改顯 PCM 站內卡):%s', (url) => {
    expect(catalogRowToUIProduct({ ...base, card_image: url }).image).toBeNull();
  });

  it('🟢 負對照:PCM 自己的卡【不得】被濾掉', () => {
    const pcm = 'https://quote.pcmmotorsports.com/no-photo.png';
    expect(catalogRowToUIProduct({ ...base, card_image: pcm }).image).toBe(pcm);
  });

  // 🔵 附帶行為變化, 而它沒有被任何一格釘住(code-reviewer R2 nit):
  //    `card_image === ''` 從前給 `''`(⇒ `<img src="">`, 那是壞的), 現在短路成 `null`。
  //    方向是改善, 但**改回 `row.card_image !== null && !isSupplier…` 不會紅** ⇒ 補這一格釘它。
  it('🔵 card_image 是空字串 ⇒ null(不得產生 <img src="">)', () => {
    expect(catalogRowToUIProduct({ ...base, card_image: '' }).image).toBeNull();
  });

  it('🟢 正對照:真商品照留著(證明這把尺不是恆真)', () => {
    const real = `${G}carbon-tank-pad.jpg`;
    expect(catalogRowToUIProduct({ ...base, card_image: real }).image).toBe(real);
  });

  // 🔴 trim bbox 釘在【那張被丟掉的圖】⇒ 留著它會套到後面換上來的圖。
  //    拿掉 imageTrim 那個判斷 ⇒ 這一格紅。
  it('🔴 首圖是佔位圖 ⇒ imageTrim 一起丟掉', () => {
    const r = catalogRowToUIProduct({ ...base, card_image: `${G}spareparts-mit-tesxt.png`, card_image_trim: trim });
    expect(r.imageTrim).toBeUndefined();
  });

  // 🔵 本片不得改「本來就沒圖」那條既有行為(第一版我寫寬了, 當場弄紅一格既有測試)。
  it('🟢 負對照:card_image 本來就是 null ⇒ trim 照既有行為解析, 不受本片影響', () => {
    expect(catalogRowToUIProduct({ ...base, card_image: null, card_image_trim: trim }).imageTrim).toEqual(trim);
  });

  it('🟢 正對照:真圖 ⇒ trim 保留', () => {
    const r = catalogRowToUIProduct({ ...base, card_image: `${G}real.jpg`, card_image_trim: trim });
    expect(r.imageTrim).toEqual(trim);
  });
});
