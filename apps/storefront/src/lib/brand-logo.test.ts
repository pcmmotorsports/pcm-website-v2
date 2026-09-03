// brand-logo.test.ts — 雙向釘住 BRAND_LOGO_SRC 與磁碟的一致性。
//
// 🔴 **為什麼要【雙向】**:單向只擋得住一半, 而漏掉的那一半沒有任何訊號 ——
//    · 只驗「表→磁碟」⇒ 新增品牌忘了補表 ⇒ 卡片顯示純文字, **而測試全綠**
//    · 只驗「磁碟→表」⇒ 檔案改名/搬走 ⇒ 卡片破圖, **而測試全綠**
//    ⇒ 🎯 兩個方向的失敗都是「客人看得到、我們看不到」, 所以兩邊都要有格子。

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// 🔴 分母的權威 = `scripts/supplier-config.ts` 的 `brandSlug` —— 那是【同步真的會寫進去】的品牌集合,
//    而 `mock-brands.ts` 只有 17 家、**不含 k-speed**(實測:拿它當分母時, 把 key 改回壞掉的 `kspeed` 仍然全綠)。
import { SUPPLIER_CONFIGS } from '../../../../scripts/supplier-config';
import { BRAND_LOGO_SRC, brandLogoSrc } from './brand-logo';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const BRANDS_DIR = join(PUBLIC_DIR, 'brands');

describe('BRAND_LOGO_SRC ↔ 磁碟(雙向)', () => {
  it('🟢 正對照:這把尺量得到東西(表非空, 且 public/brands 讀得到)', () => {
    // 🔴 少了這一格, 下面那組 it.each 在「表是空的」時會【零格執行】而全綠。
    expect(Object.keys(BRAND_LOGO_SRC).length).toBeGreaterThan(10);
    expect(readdirSync(BRANDS_DIR).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(BRAND_LOGO_SRC))(
    '① 表→磁碟:%s 的 logo 檔真的在(%s)',
    (_slug, src) => {
      expect(existsSync(join(PUBLIC_DIR, src.replace(/^\//, '')))).toBe(true);
    },
  );

  // 🔴🔴 方向② **改用【品牌 slug】當分母, 不是 readdirSync 的目錄名**(2026-09-03 R1 Critical)。
  //    ⛔ ~~原本比的是 `public/brands/` 的目錄名~~ —— 而 key 是品牌 slug, 兩個命名空間
  //       19 家裡 18 家碰巧相同 ⇒ 那一格對 18 家印綠, **而唯一分岔的那一家(kspeed/k-speed)正是壞掉的那一家**
  //    ⇒ 🛑 **它不只是漏 —— 它替錯的那一行背書。**
  //    📌 判別句:我這把尺的分母, 與被測對象的 key **是不是同一個命名空間**?
  // 🔵 `wrs` / `kineo` 不在這個分母裡(它們還沒進 supplier-config)⇒ 例外清單目前是空的。
  //    它們「沒有可用 logo」那件事由 brandLogoSrc 那組測試釘住(見下)。
  const KNOWN_NO_LOGO: readonly string[] = [];

  it('② 品牌→表:每一個在賣的品牌都有 logo, 例外只有明列的那幾家', () => {
    // 🔴 只算 `writeAllowed` 的 —— `__gated_canary__` 是永久 guard 測試靶(非真供應商,
    //    `supplier-config.ts:380-385`:writeAllowed 永久 false、brandSlug 是假值、不入每日 matrix)。
    //    🛑 用 `writeAllowed` 濾而不是用名字濾:名字會變, 而「會不會被寫進 DB」才是我要問的那件事。
    const brandIds = [
      ...new Set(
        Object.values(SUPPLIER_CONFIGS)
          .filter((c) => c.writeAllowed)
          .map((c) => c.brandSlug),
      ),
    ].sort();
    expect(brandIds.length).toBeGreaterThan(10); // 正對照:分母不是空的
    const missing = brandIds.filter((id) => !(id in BRAND_LOGO_SRC)).sort();
    // 🔵 用「集合相等」而不是「差集為空」—— 這樣**兩個方向都會叫**:
    //    新增品牌忘了補表 ⇒ missing 多一個 ⇒ 紅;
    //    某家補上 logo 卻忘了把它從例外清單移除 ⇒ missing 少一個 ⇒ 也紅。
    expect(missing, `缺 logo 的品牌變了(例外清單要跟著改): ${missing.join(', ')}`)
      .toEqual([...KNOWN_NO_LOGO].sort());
  });

  it('③ 例外清單是空的 —— 加任何一家進去之前, 先在 brand-logo.ts 寫下理由', () => {
    // 這一格擋的是「為了讓②變綠, 順手把缺的那家加進例外清單」。
    expect(KNOWN_NO_LOGO).toHaveLength(0);
  });
});

describe('brandLogoSrc', () => {
  it('🛑 查無 ⇒ null(不得猜一個路徑出來 —— 猜的會 404, 而破圖比純文字難查)', () => {
    expect(brandLogoSrc('這個品牌不存在')).toBeNull();
    expect(brandLogoSrc(null)).toBeNull();
    expect(brandLogoSrc(undefined)).toBeNull();
    expect(brandLogoSrc('')).toBeNull();
  });

  it('🟢 正對照:認得的品牌回得出路徑(證明上面那組 null 不是恆真)', () => {
    expect(brandLogoSrc('lightech')).toBe('/brands/lightech/logo.png');
  });

  it('🛑 wrs ⇒ null(它有 brands-dark 檔, 而那是【淺色 logo】, 放淺底卡片上看不見)', () => {
    // 🔴 這一格擋的是一個很自然的「順手補上」:`public/brands-dark/wrs.png` 就在那裡, 拿來用一行就好。
    //    而它是給深色背景的版本 ⇒ 卡片底是淺色漸層 ⇒ 看不見 ⇒ 比退回站內佔位圖更糟。
    //    ✅ 解除條件:補上原色版 `public/brands/wrs/logo.*`, 屆時把 wrs 加進表、改這一格。
    expect(brandLogoSrc('wrs')).toBeNull();
    // 🔴 kineo 同一種情況(brands/ 沒有它、brands-dark 有)—— 先前這裡只寫在註解裡而沒有格子,
    //    ⇒ 宣稱比證據寬一家。補上。
    expect(brandLogoSrc('kineo')).toBeNull();
  });
});
