// brand-trim-logo-scale.ts — 淺色底 trim logo 展示格的光學校正(D3c-3 建;D5f 起兩個消費端)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-directory.html:172-175` 的 `BRANDS` 陣列
// 第 5 欄(鐵則 1 例外 = Sean 2026-08-03 拍 Q1=B,本線真權威在 OD)。
//
// 🔴 **2026-08-06(D5f)改名的理由 —— 這張表不是 `/brands` 專屬的**:
//    首頁 N°06 磚牆的 20 條 `--logo-scale`(`direction-b-layout-01-graphite-ember.html:518-537`)
//    與本表**逐家實測 20/20 完全相同**(比對方法:兩邊各抽 slug→值、排序後逐列比,零差異),
//    而且兩邊的展示格幾何也一樣:
//      · `/brands` 卡片 `.bd-brand-logo` = 高 54px、寬 86%
//      · 首頁磚牆 `.b-brand-logo`(OD 端是 `a::before`,:487-492)= 高 54px、寬 86%
//    ⇒ 同一份校正、兩個消費端;複製第二份等於讓這 20 個數字有兩個真相。
//    原名 `BRAND_DIRECTORY_LOGO_SCALE` 會讓首頁那個消費端看起來像在借用別頁的東西。
//
// 🔴 **為什麼不沿用 `BrandContent.logoScale`**(D3c-3 動手前實查出來的,不是偏好):
//    那個欄位是**品牌介紹頁磚牆**的校正值(`.bp-others-logo`:高 58px、寬 92%),
//    幾何與底色都不同。2026-08-05 逐家比對:**20 家有 19 家的值不一樣**(例如 kineo
//    磚牆 0.88 / 本表 1.18、evotech 磚牆 0.9 / 本表 1.22)⇒ 沿用等於把 19 家的目視大小做錯。
//    ⚠️ 「新增品牌要目視加一次,不是套公式」這句的出處是
//       `pcm-home-redesign/brand-page-integration.md:168`,而且它講的是**磚牆那份**
//       (7 家 0.88-1.08),不是本表。引用成立、但對象要寫清楚:本表是從
//       `brand-directory.html` 的 `BRANDS` 陣列第 5 欄逐家抄下來的,同樣是人手校正、不能套公式。
//
// 🔴 **為什麼放獨立一支檔、不加進 `BrandContent`**:這是**呈現參數**、不是品牌的內容。
//    塞進 `brand-content.ts` 會讓那份內容模型多背一個「某個版面」的欄位。
//    ⚠️ 代價寫清楚:新增第 21 家品牌時**這裡要一起加**,漏加會靜默吃預設值 1
//    ⇒ `BrandDirectoryRoot.test.tsx` 與 `BrandIndex.test.tsx` 各有一條守門會紅
//      (鍵集合必須與 `BRAND_CONTENT` 完全一致)。

/** slug → 淺色底 trim logo 的 `--logo-scale`。預設 1(= 設計稿對 samco 的值)。 */
export const BRAND_TRIM_LOGO_SCALE: Readonly<Record<string, number>> = {
  akrapovic: 0.86,
  bonamici: 0.96,
  'cnc-racing': 1.1,
  dbk: 0.84,
  'eazi-grip': 0.9,
  ebc: 1.04,
  evotech: 1.22,
  extreme: 1.08,
  front3d: 0.84,
  'gb-racing': 1.12,
  gilles: 0.92,
  'k-speed': 1.18,
  kineo: 1.18,
  lightech: 0.96,
  materya: 1.1,
  motogadget: 1.1,
  rizoma: 1.12,
  'rpm-carbon': 0.94,
  samco: 1,
  wrs: 0.84,
};
