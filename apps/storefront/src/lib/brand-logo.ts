// brand-logo.ts — 品牌 logo 的檔案路徑對照表(單一定義點)
//
// 🔴 **為什麼需要一張表, 不能用字串拼**:`public/brands/<slug>/logo.*` 的副檔名**每家不同**
//    (2026-09-03 實查:png 13 家 · svg 3 家 · webp 2 家 · avif 1 家)⇒ `` `/brands/${slug}/logo.png` ``
//    對其中 6 家是 404, 而 404 在卡片上長得像「這家沒有 logo」。
//
// 🔴 **兩套 logo, 而【沒有一套涵蓋全部】**(2026-09-03 量):
//    · `public/brands/<slug>/logo.*`  19 家 · 原色 · 🔴 **缺 wrs、缺 kineo**
//    · `public/brands-dark/<slug>.png` 20 檔 · 統一 png · 🔴 **缺 dna** · ⚠️ **深色版(給深色背景用的淺色 logo)**
//    ⇒ 🎯 **兩套盲區互補** ⇒ 本表**只收 `brands/`(原色)那一套**。
//    🔴 **而「缺的那家就拿 brands-dark 補上」是錯的** —— 那一套是**給深色背景用的淺色 logo**,
//       放在淺色卡片上看不見(實測見下方 wrs 那段)⇒ **兩套不是「同一張圖的兩個檔」, 是兩種用途。**
//
// ✅ **這張表不靠紀律維護** —— `brand-logo.test.ts` 雙向釘住:
//    ① 表裡每一個路徑**在磁碟上真的存在**(檔案改名/搬走 ⇒ 紅)
//    ② `supplier-config.ts` 裡每一個 `writeAllowed` 品牌**都在表裡**(新增品牌忘了補表 ⇒ 紅)
// 🔴 **而②的分母換過兩次, 前兩個都抓不到真正的缺陷**:
//    ⛔ ~~`readdirSync('public/brands')` 的目錄名~~ ⇒ 與 key 不同命名空間, 19 家裡 18 家碰巧相同,
//       **而剛好分岔的那一家(k-speed)正是壞掉的那一家** ⇒ 它替錯的那一行背書
//    ⛔ ~~`mock-brands.ts` 的 17 家~~ ⇒ **不含 k-speed** ⇒ 實測:把 key 改回壞掉的 `kspeed` **仍然全綠**
//    ✅ 現在用 `SUPPLIER_CONFIGS` 的 `writeAllowed` 品牌 ⇒ 同一發突變 **1 紅**
//    ⇒ 📌 **判別句:換了尺之後, 先拿【原本那個缺陷】餵它一次 —— 它必須紅。**
// ⚠️ **射程**:②只涵蓋 `supplier-config` 裡的品牌;`wrs` / `kineo` 還沒進去 ⇒ 它們不在②的分母裡
//    (它們「沒有可用 logo」由 `brandLogoSrc` 那組測試單獨釘住)。

/**
 * 品牌 slug → logo 檔路徑(public/ 底下的絕對路徑)。
 *
 * 🔴🔴 **key = 【品牌 slug】(`MockProduct.brandSlug` ← DB `brands.slug`), 不是【目錄名】。**
 *    19 家裡 18 家兩者碰巧相同, **而剛好分岔的那一家(k-speed / 目錄 kspeed)就是會壞的那一家**
 *    ⇒ 🎯 **「照目錄名填 key」today 有 18/19 是對的, 而那 18 個對的會讓人以為規則是「照目錄名」。**
 */
export const BRAND_LOGO_SRC: Readonly<Record<string, string>> = {
  akrapovic: '/brands/akrapovic/logo.svg',
  bonamici: '/brands/bonamici/logo.webp',
  'cnc-racing': '/brands/cnc-racing/logo.png',
  dbk: '/brands/dbk/logo.png',
  dna: '/brands/dna/logo.png',
  'eazi-grip': '/brands/eazi-grip/logo.png',
  ebc: '/brands/ebc/logo.svg',
  evotech: '/brands/evotech/logo.png',
  extreme: '/brands/extreme/logo.png',
  front3d: '/brands/front3d/logo.png',
  'gb-racing': '/brands/gb-racing/logo.webp',
  gilles: '/brands/gilles/logo.png',
  // 🔴🔴 **key 是【品牌 slug】, 而目錄名是【供應商 slug】—— 這一家是唯一分岔的**:
  //    `supabase/migrations/20260724140000_seed_kspeed_brand.sql:3` 逐字「網站顯示名 'K-SPEED'、brand slug 'k-speed';
  //    報價單側 supplier_slug 仍為 'kspeed'」;`scripts/supplier-config.ts:296` 逐字「勿填成 kspeed」。
  //    而 `catalog-page.ts:75` 填進卡片的是 `row.brand_slug` = `k-speed`。
  //    ⇒ 🛑 **key 寫成 `kspeed` 的話, K-SPEED 商品永遠拿不到 logo** —— 而它是真的在賣的供應商。
  'k-speed': '/brands/kspeed/logo.png',
  lightech: '/brands/lightech/logo.png',
  materya: '/brands/materya/logo.png',
  motogadget: '/brands/motogadget/logo.svg',
  rizoma: '/brands/rizoma/logo.png',
  'rpm-carbon': '/brands/rpm-carbon/logo.avif',
  samco: '/brands/samco/logo.png',
  // 🛑 **wrs 刻意【不在】這張表裡, 而它【有】一個 logo 檔** —— 這一行是為了擋掉「補上去」這個很自然的動作。
  //    🔬 2026-09-03 我開圖看了:`public/brands-dark/wrs.png` 是**接近白色的淺灰字**(給深色背景用的版本),
  //       而卡片無真照片時的底是**淺色漸層**(`ProductImage.tsx` 的 PALETTES 六色全是淺色)
  //       ⇒ 🎯 **放上去等於看不見。**
  //    ⇒ 🛑 **一個看不見的 logo 比退回站內佔位圖【更糟】** —— 佔位圖至少講得出「暫無照片」,
  //       而一片空白會被讀成「這張卡壞了」。⇒ 查無 ⇒ 回 null ⇒ 退回站內佔位圖(= 今天的行為, 零退步)。
  //    ✅ **解除條件**:有人補上原色版 `public/brands/wrs/logo.*` ⇒ 那時候下面那格測試會要求把它加進來。
  //    (⚠️ 對照組:`brands/lightech/logo.png` 是深色+黃, 在淺底上清楚 —— 兩套的差別是【設計給哪種底】, 不是新舊。)
};

/**
 * 取某品牌的 logo 路徑;**查無回 `null`**(呼叫端要有純文字退路, 不得硬拼路徑)。
 *
 * 🛑 **fail-closed 的方向**:查無時回 `null` 而不是猜一個路徑 ——
 *    猜出來的路徑會 404, 而**卡片上的破圖比「只有文字」難看, 也難查**。
 */
export function brandLogoSrc(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return BRAND_LOGO_SRC[slug] ?? null;
}
