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
import { dropSupplierPlaceholders, isSupplierPlaceholder } from './supplier-placeholder';

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

describe('dropSupplierPlaceholders', () => {
  it('🔴 混在一起時只濾掉該濾的, 順序不變', () => {
    const real1 = `${G}carbon-a.jpg`;
    const real2 = `${G}carbon-b.jpg`;
    expect(
      dropSupplierPlaceholders([real1, `${G}spareparts-mit-tesxt.png`, real2]),
    ).toEqual([real1, real2]);
  });

  it('🔴 全部是佔位圖 ⇒ 回空陣列(下游據此顯站內卡)', () => {
    expect(dropSupplierPlaceholders([`${G}spareparts-mit-tesxt.png`, `${X}noimage.jpg`])).toEqual([]);
  });

  it('🟢 正對照:全部是真圖 ⇒ 原封不動(證明這把尺不是恆真)', () => {
    const imgs = [`${G}a.jpg`, 'https://quote.pcmmotorsports.com/no-photo.png'];
    expect(dropSupplierPlaceholders(imgs)).toEqual(imgs);
  });

  it('🔵 空陣列 ⇒ 空陣列(不得 throw)', () => {
    expect(dropSupplierPlaceholders([])).toEqual([]);
  });
});
