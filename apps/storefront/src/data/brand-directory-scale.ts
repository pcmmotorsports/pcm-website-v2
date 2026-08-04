// brand-directory-scale.ts — `/brands` 總覽卡片的 logo 光學校正(D3c-3;2026-08-05)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-directory.html:172-175` 的 `BRANDS` 陣列
// 第 5 欄(鐵則 1 例外 = Sean 2026-08-03 拍 Q1=B,本線真權威在 OD)。
//
// 🔴 **為什麼不沿用 `BrandContent.logoScale`**(這是本片動手前實查出來的,不是偏好):
//    那個欄位是**品牌介紹頁磚牆**的校正值(`.bp-others-logo`:高 58px、寬 92%),
//    本頁的卡片是 `.bd-brand-logo`:高 54px、寬 86%,而且底色不同(paper-2 vs paper)。
//    2026-08-05 逐家比對:**20 家有 19 家的值不一樣**(例如 kineo 磚牆 0.88 / 這裡 1.18、
//    evotech 磚牆 0.9 / 這裡 1.22)⇒ 沿用等於把 19 家的 logo 目視大小做錯。
//    ⚠️ 「新增品牌要目視加一次,不是套公式」這句的出處是
//       `pcm-home-redesign/brand-page-integration.md:168`,而且它講的是**磚牆那份**
//       (7 家 0.88-1.08),不是本表(關卡2 R1 nit 更正:第一版寫成「設計稿自己也逐字寫過」,
//       像是在講本表)。引用成立、但對象要寫清楚:本表是我從 `brand-directory.html`
//       的 `BRANDS` 陣列第 5 欄逐家抄下來的,同樣是人手校正、同樣不能套公式。
//
// 🔴 **為什麼放獨立一支檔、不加進 `BrandContent`**:這是**這一頁**的呈現參數,
//    不是品牌的內容。塞進 `brand-content.ts` 會讓那份內容模型多背一個「某頁面版面」的欄位,
//    而下一個版面(例如 D5 首頁重排若也放 logo)就會再多一個。
//    ⚠️ 代價寫清楚:新增第 21 家品牌時**這裡要一起加**,漏加會靜默吃預設值 1
//    ⇒ `brand-directory.test.ts` 有一條守門會紅(鍵集合必須與 `BRAND_CONTENT` 完全一致)。

/** slug → 卡片 logo 的 `--logo-scale`。預設 1(= 設計稿對 samco 的值)。 */
export const BRAND_DIRECTORY_LOGO_SCALE: Readonly<Record<string, number>> = {
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
