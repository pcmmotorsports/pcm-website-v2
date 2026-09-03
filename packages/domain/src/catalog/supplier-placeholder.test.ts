// supplier-placeholder.test.ts — ⟦fc-SUPPLIERPLACEHOLDER⟧ 規則本體的守門。
//
// 🔴🔴 **這支檔存在的理由是 code-reviewer R2 抓到的**:
//    本片買的保險就是「**單一定義點**」—— 兩條讀取路徑共用同一份 `SUPPLIER_PLACEHOLDERS`。
//    而在補這支檔之前, **那個定義點自己沒有守門**:測它的 15 格全部住在
//    `@pcm/adapters` 與 `apps/storefront` ⇒ 🎯 **改壞 `supplier-placeholder.ts` 之後,
//    跑 `@pcm/domain` 那一包的測試會【恆綠】。**
// 📌 ⇒ 而 `packages/domain/src/catalog/` 底下三支非型別檔(`image-trim` / `pricing` / `year-range`)
//    **3/3 都有 sibling test** ⇒ 這支檔缺它是違反既有慣例, 不是風格選擇。

import { describe, expect, it } from 'vitest';
import {
  dropImagesWithoutRealPhoto,
  hasNoRealImage,
  isSupplierPlaceholder,
  SUPPLIER_PLACEHOLDERS,
} from './supplier-placeholder';

const G = 'https://www.gillestooling.com/media/01/e4/ac/1711800467/';
const G2 = 'https://www.gillestooling.com/media/7d/cb/33/1740757593/'; // 🔴 另一個目錄段(目錄是 hash 化的)
const X = 'https://www.extreme-components.com/components/com_virtuemart/assets/images/vmgeneral/';

describe('isSupplierPlaceholder', () => {
  // 🟢 四條規則各一格。改壞任何一條 ⇒ 對應那格紅。
  it.each([
    ['spareparts-mit-tesxt', `${G}spareparts-mit-tesxt.png`],
    ['bild-schraube-', `${G}bild-schraube-gilles-tooling.png`],
    ['bild-folgt-in-kurze-', `${G}bild-folgt-in-kurze-gilles-tooling-motorrad.png`],
    ['noimage.jpg', `${X}noimage.jpg`],
  ])('🔴 認得出供應商佔位圖:%s', (_rule, url) => {
    expect(isSupplierPlaceholder(url)).toBe(true);
  });

  // 🔴 目錄段是 hash 化的(2026-09-02 正式庫實量 33 個不同目錄)⇒ 規則不得綁路徑。
  it('🔴 換一個目錄段仍然認得出來(規則綁的是網域+檔名, 不是路徑)', () => {
    expect(isSupplierPlaceholder(`${G2}bild-schraube-gilles-toolingpi82encvzt4bx.png`)).toBe(true);
  });

  // 🔴 CDN 把同一張圖切成 28 個 hash 檔名 ⇒ 比對必須是前綴。
  it.each([
    `${G}spareparts-mit-tesxt01954.png`,
    `${G}spareparts-mit-tesxt59119dc4380460194e.png`,
  ])('🔴 hash 尾巴的變體(前綴比對, 不是完整檔名):%s', (url) => {
    expect(isSupplierPlaceholder(url)).toBe(true);
  });

  it('🔵 大寫檔名也要認得出來', () => {
    expect(isSupplierPlaceholder(`${G}SPAREPARTS-MIT-TESXT.PNG`)).toBe(true);
  });

  // 🔴🔴 負對照群 —— 每一格對應一發會讓規則變寬的突變。
  it.each([
    ['PCM 自己的「暫無照片」卡', 'https://quote.pcmmotorsports.com/no-photo.png'],
    ['同檔名但不是那個網域(規則釘住網域)', 'https://cdn.example.com/vmgeneral/noimage.jpg'],
    ['bild- 併成一條會誤傷這張真商品照', `${G}bild-carbon-tank-pad.jpg`],
    ['includes 取代 startsWith 會誤傷這張', `${G}photo-of-spareparts-mit-tesxt-shown.jpg`],
    ['一般真商品照', `${G}carbon-tank-pad.jpg`],
  ])('🟢 負對照:%s ⇒ 不是佔位圖', (_why, url) => {
    expect(isSupplierPlaceholder(url)).toBe(false);
  });

  // 🔵 fail-open:解析不了 ⇒ 不當成佔位圖 ⇒ 留著。
  //    兩個方向都會錯, 而留著是比較輕的那一邊:客人看到供應商佔位圖 = 今天的現況;
  //    濾掉可能蓋住一張真照片, 而**那沒有人會回報**。
  it.each(['not-a-url', '', 'ftp://x/y.png'])('🔵 解析不了/非 http ⇒ false(fail-open):%s', (url) => {
    expect(isSupplierPlaceholder(url)).toBe(false);
  });
});

describe('dropImagesWithoutRealPhoto', () => {
  it('🔴 混在一起時只濾掉該濾的, 順序不變', () => {
    const real1 = `${G}carbon-a.jpg`;
    const real2 = `${G}carbon-b.jpg`;
    expect(
      dropImagesWithoutRealPhoto([real1, `${G}spareparts-mit-tesxt.png`, real2]),
    ).toEqual([real1, real2]);
  });

  it('🔴 全部是佔位圖 ⇒ 回空陣列(下游據此顯站內卡)', () => {
    expect(dropImagesWithoutRealPhoto([`${G}spareparts-mit-tesxt.png`, `${X}noimage.jpg`])).toEqual([]);
  });

  it('🟢 正對照:全部是真圖 ⇒ 原封不動(證明這把尺不是恆真)', () => {
    const imgs = [`${G}a.jpg`, `${G}b.jpg`];
    expect(dropImagesWithoutRealPhoto(imgs)).toEqual(imgs);
  });

  it('🔴🔴 PCM 自己的卡【現在也濾】—— 2026-09-04 推翻先前拍板', () => {
    // ⛔ ~~舊版這一格把 PCM 的卡放進「正對照:全部是真圖」的陣列裡, 斷言它原封不動~~。
    //    當時的理由:「濾掉只是換成另一張 PCM 卡, 零收益」—— 🟢 **那在當時是對的**。
    // 🔴 而兩件事讓那個前提不成立(全文在 supplier-placeholder.ts 該函式的 docstring):
    //    ① Sean 拍「無真照片 ⇒ 品牌 logo」⇒ 濾掉之後看到的是品牌 logo, 收益不再是零
    //    ② product.images 有兩個【對外】消費端(JSON-LD / OG)不呼叫 hasNoRealImage
    //       ⇒ 那張卡會被報給 Google 並被快取 ⇒ 在顯示層逐處補判斷救不了
    // 🎯 ⇒ 判斷要住在【資料出口】, 不是住在【每一個畫面】。
    expect(dropImagesWithoutRealPhoto(['https://quote.pcmmotorsports.com/no-photo.png'])).toEqual([]);
  });

  it('🔵 空陣列 ⇒ 空陣列(不得 throw)', () => {
    expect(dropImagesWithoutRealPhoto([])).toEqual([]);
  });
});

describe('hasNoRealImage — 「這一筆沒有真照片」(與 isSupplierPlaceholder 是兩個謂詞)', () => {
  const PCM_CARD = 'https://quote.pcmmotorsports.com/no-photo.png';

  // 🔴🔴 這一組【由 SUPPLIER_PLACEHOLDERS 那張表驅動】—— 表加第五條, 這裡自動涵蓋。
  //    而它擋的是:有人把 hasNoRealImage 改成「自己重打一份判斷」⇒ 兩份會分岔, 而分岔不會紅。
  //    實測突變(重打一份、少一條規則)⇒ 這一組會紅。
  it.each(SUPPLIER_PLACEHOLDERS)(
    '🔴 供應商佔位圖規則 [%s / %s] ⇒ hasNoRealImage 必為 true(不得與 isSupplierPlaceholder 分岔)',
    (host, prefix) => {
      const url = `https://${host}/x/${prefix}whatever.jpg`;
      expect(isSupplierPlaceholder(url)).toBe(true);
      expect(hasNoRealImage(url)).toBe(true);
    },
  );

  // 🔴🔴 **真實網址逐字**(2026-09-04 `SELECT DISTINCT` 從報價庫 `storefront_catalog_v` 撈回來貼上)。
  //    ⇒ 這一組存在的理由:上面那組 `it.each(SUPPLIER_PLACEHOLDERS)` 是**拿表自己組 URL**
  //      ⇒ 🛑 **對「表裡的字面填錯」零判別力**(host 少一個 `www.`、前綴打錯字, 它照樣全綠)。
  //    ✅ 而這一組是**外部事實**:表填錯 ⇒ 這裡紅。兩組合起來才蓋得住。
  //    ⚠️ 射程:這是**那一天**的讀數。供應商換 CDN ⇒ 這裡不會自己更新, 而它也不該 ——
  //       它紅的時候要去問「是表過期了, 還是來源變了」, 兩個修法不同。
  const REAL_URLS_FROM_DB: ReadonlyArray<readonly [string, string]> = [
    ['PCM 自己的卡 (882 列)', 'https://quote.pcmmotorsports.com/no-photo.png'],
    ['extreme (80 列)', 'https://www.extreme-components.com/components/com_virtuemart/assets/images/vmgeneral/noimage.jpg'],
    ['rpm (27 列) — 🔴 沒有 www.', 'https://rpmcarbon.com/cdn/shopifycloud/storefront/assets/no-image-2048-a2addb12_600x600_crop_center.gif'],
    ['gbracing (8 列)', 'https://www.gbracing.eu/templates/GBRacing/Images/no-image-300x300.jpg'],
    ['motogadget (4 列)', 'https://www.motogadget.com/cdn/shopifycloud/storefront/assets/no-image-2048-a2addb12_grande.gif'],
  ];

  it.each(REAL_URLS_FROM_DB)(
    '🔴 正式資料撈回來的網址 [%s] ⇒ hasNoRealImage 必為 true',
    (_label, url) => {
      expect(hasNoRealImage(url)).toBe(true);
    },
  );

  it('🟢 PCM 自己的卡:isSupplierPlaceholder=false(不濾)而 hasNoRealImage=true(沒有真照片)', () => {
    // 🎯 這一格就是「兩個謂詞回答兩個不同問題」的本體。任一邊被寫成另一邊, 這裡都會紅。
    expect(isSupplierPlaceholder(PCM_CARD)).toBe(false);
    expect(hasNoRealImage(PCM_CARD)).toBe(true);
  });

  it('🔴🔴 負對照:PCM 網域上的【真商品圖】⇒ false(規則不得寬到整個網域)', () => {
    // 🛑 這一格是這一片唯一一個「改壞了不會有任何東西紅, 而後果會流到 Google」的位置:
    //    `hasNoRealImage` 拿掉 `&& file === 'no-photo.png'`(= 整個 quote.pcmmotorsports.com
    //    都判成沒照片)⇒ **補這一格之前是全綠的**(全 repo 用該網域的測試字面只有 no-photo.png)。
    // 🔴 而爆炸半徑在 2026-09-04 翻面之後【變大了】:
    //    以前規則寫太寬只影響顯示層一支元件;現在會從 `product.images` 整個刪掉真照片,
    //    連 `product-jsonld.ts`(Google)與 OG 一起沒 —— 而外部會快取。
    // 📌 原本守這個方向的三份「PCM 卡不得被濾掉」負對照, 在同一顆 commit 裡全被翻面
    //    ⇒ **翻面時風險變大而守門變少** ⇒ 這一格是把那半補回來。
    expect(hasNoRealImage('https://quote.pcmmotorsports.com/real-product-01.jpg')).toBe(false);
  });

  it.each([null, undefined, '', '   '])('沒有網址(%s)⇒ 沒有真照片', (v) => {
    expect(hasNoRealImage(v as string | null | undefined)).toBe(true);
  });

  it('🟢 正對照:一張真圖 ⇒ false(證明這把尺不是恆真)', () => {
    expect(hasNoRealImage('https://www.gillestooling.com/img/real-product-01.jpg')).toBe(false);
  });

  it('🛑 解析不了的網址 ⇒ false(fail-open, 刻意)', () => {
    // 回 true 會讓畫面拿品牌 logo 蓋掉一張真照片 ⇒ 這個謂詞的誤報成本比漏報高。
    expect(hasNoRealImage('not a url')).toBe(false);
  });

  it('🔵 大寫檔名的 PCM 卡照樣算(與 isSupplierPlaceholder 的大小寫處理一致)', () => {
    expect(hasNoRealImage('https://quote.pcmmotorsports.com/NO-PHOTO.PNG')).toBe(true);
  });
});
