// brand-logo.ts — 品牌 logo 的檔案路徑對照表(單一定義點)
//
// 🔴 **為什麼需要一張表, 不能用字串拼**:`public/brands/<slug>/logo.*` 的副檔名**每家不同**
//    (2026-09-03 實查:png 13 家 · svg 3 家 · webp 2 家 · avif 1 家)⇒ `` `/brands/${slug}/logo.png` ``
//    對其中 6 家是 404, 而 404 在卡片上長得像「這家沒有 logo」。
//
// 🔴 **兩套 logo, 而【沒有一套涵蓋全部】**(2026-09-03 量):
//    · `public/brands/<slug>/logo.*`  19 家 · 原色 · ⛔ ~~🔴 **缺 wrs、缺 kineo**~~
//      🔴 **2026-09-04 訂正**:`brands/wrs/logo.png` **在**(14,335 bytes, `-auth` 線自
//      `brand-assets/assets/brands-trim/wrs.png` 複製、逐位元組相同)⇒ 那半已補。
//      ⚠️ 而**這一行與同一支檔 `:54` / `:72` 已經有的 `kineo:` / `wrs:` 兩列本來就自相矛盾**
//      ⇒ 📌 **一支檔可以在檔頭說自己缺某樣東西, 而那樣東西就在它自己下面 30 行處** ——
//        兩邊都不會紅, 因為沒有任何機制在比它們。(code-reviewer 2026-09-04 N5 抓到。)
//      🟢 **`kineo` 那半我也量了**(本來想標「未複查」, 而它只要一行):`brands/kineo/logo.png`
//      **在**(16,128 bytes)⇒ 🎯 **兩家都不缺, 整句「缺 wrs、缺 kineo」今天是假的。**
//      🔬 當場數法:`ls -d apps/storefront/public/brands/*/ | wc -l` ⇒ **21** 個目錄(不是 19)。
//      📌 **⇒ 而「19 家」那個數字也一起過期了。不要引用本行的數字, 當場跑上面那條。**
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
  // 🔵 kineo 與 wrs 同一批補上(2026-09-04):同樣是我初版漏掉的 —— `public/brands/` 底下沒有它們的目錄,
  //    而 `brand-assets/assets/brands-trim/` 兩家都在。照同一個做法複製。
  kineo: '/brands/kineo/logo.png',
  lightech: '/brands/lightech/logo.png',
  materya: '/brands/materya/logo.png',
  motogadget: '/brands/motogadget/logo.svg',
  rizoma: '/brands/rizoma/logo.png',
  'rpm-carbon': '/brands/rpm-carbon/logo.avif',
  samco: '/brands/samco/logo.png',
  // 🔴 **wrs 這一格改過兩次, 而第一次是【我掃的範圍不夠】**(2026-09-04):
  //    ⛔ ~~初版:「wrs 刻意不在這張表裡 —— 它只有 `brands-dark/wrs.png`, 那是給深色背景的淺色版,
  //       放在淺色卡片上看不見 ⇒ 退回站內佔位圖」~~
  //    🛑 **那個推理沒錯, 錯的是前提** —— 我只看了 `public/brands/` 與 `public/brands-dark/` 兩個目錄。
  //    🔬 別條線 `find -iname '*wrs*'` 撈到**四個位置**, 其中兩份是**原色深字版**:
  //       `design-reference/assets/logos/wrs.png` · `public/brand-assets/assets/brands-trim/wrs.png`
  //    ✅ 而 `brands-trim/<slug>.png` 正是**其他家 logo 的來源**(rizoma / dbk / gilles 三家實測:
  //       `brands-trim/<slug>.png` 與 `brands/<slug>/logo.png` **逐位元組相同**)
  //       ⇒ 照同一個做法複製一份到 `public/brands/wrs/logo.png` ⇒ 這一格與其他 19 家再無差別。
  //    📌 **⇒ 教訓不是「要多找幾個目錄」, 是【查一個路徑不等於查那個東西】** ——
  //       `ls public/brands/` 回「沒有 wrs」與「wrs 沒有 logo」讀起來一模一樣, 而它們差很多。
  wrs: '/brands/wrs/logo.png',
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
