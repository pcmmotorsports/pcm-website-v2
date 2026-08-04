// brand-url.ts — 品牌相關的三個網址(D2e-1 從 BrandPageHeader.tsx 抽出;2026-08-04)
//
// 抽出的理由與 `lib/brand-asset.ts` 同款(那支是 D2c-2 抽的):**第二個消費端出現時就抽**。
// D2e-1 的分類 chips 與品牌磚牆都要用,留在 `BrandPageHeader.tsx` 的話兩支元件會為了
// 一個一行的字串函式 import 整支 Header(連帶 next/link、BrandRichText、parser)。
// D3 建 `/brands/[slug]` route 時也會用到 `brandIntroUrl`,同樣不該去 import 一個元件。
//
// 三個都是純字串函式、零依賴 ⇒ server / client 兩邊都能用。
// D3b 起檔尾多一個常數 `BRAND_PRODUCT_SLOTS`,落點理由寫在它自己的 doc(同樣是為了零依賴)。

/**
 * 商品目錄(依品牌篩選,可再帶一個分類)。與設計稿 `brand-content-data.js:1187` 的
 * `PCM_catalogueUrl = (slug, category = "") => ...` 逐字同式(含「空字串不加 key」那條)。
 *
 * 🔴 `category` 這個第二參數是 D2e-1 的分類 chips 加的,不是本來就有 ——
 *    正式站的讀取端 `products-url-state.tsx:63` 吃的是**分類名稱**(raw_path、人類可讀),
 *    與設計稿傳的 `categories[][0]` 同一種東西 ⇒ 網址形狀這一半零改動(計畫 §2 的契約表)。
 * 🔴 **但比對不到時是靜默的**:`products-url-state.tsx:66-72` 的 `parseCategoryFromUrl`
 *    對 catalog taxonomy 走 `c.name === raw || c.id === raw`,**miss 就 `return null`**
 *    —— 客人按了 chip 會看到「該品牌全部商品」,和沒篩選長得一模一樣、零錯誤訊息。
 *    這 12 個分類名在正式目錄裡撈不撈得到,屬 D3 接線的驗收項 ⇒ **backlog #315**。
 */
export const brandCatalogueUrl = (slug: string, category = ''): string =>
  `/products?pbrand=${encodeURIComponent(slug)}${category ? `&category=${encodeURIComponent(category)}` : ''}`;

/**
 * 「只看我的車能裝的」= 品牌篩選 + 落地就把選車打開。
 *
 * 🔴 設計稿寫的是 `{catalogue}#finder`(brand-page.html:1648),但**正式站沒有這個錨點**
 *    —— `#vehicle-finder` 只存在於首頁,`/products` 的選車入口是桌機 CascadeFilterTop
 *    與手機 MobileVehicleSheet。對應到正式站的正確寫法是 A2 建的 `?pick=vehicle`
 *    (桌機聚焦廠牌欄 / 手機自動開選車面板)。
 *    這是 route adaptation、不是 design 偏離 —— 同 Header「品牌」navItem 當初把
 *    不存在的 `/brands` 改指 `/products` 的處理(Header.tsx 該列註解)。
 */
export const brandVehiclePickUrl = (slug: string): string =>
  `${brandCatalogueUrl(slug)}&pick=vehicle`;

/**
 * 品牌介紹頁本身(磚牆每一磚、以及 D3 的 route 目的地)。
 *
 * 🔴 **對照基準是 `brand-page.html:1606` 的區域 `intro()`,不是 `brand-content-data.js:1188`
 *    的 `PCM_introUrl`**(D2e-1 關卡2 R1 must-fix 更正:我原本引後者)。理由 = 實查:
 *      · `PCM_introUrl` 在 `brand-page.html` **零引用**(grep 命中 0 次),它產的
 *        `brand-page.html?pbrand=X` 是原型自己的檔名、不是網址契約。
 *      · 真正在跑的是 `:1606` 的 `` (s) => `${catalogue(s)}#brand-about` `` ⇒
 *        設計稿的契約 = **`/products?pbrand=X#brand-about`**,而 :1604-1605 的註解逐字說
 *        它「是正式站的網址契約」。計畫 §3(spec:84)也是這樣寫的。
 *
 * 本函式回 `/brands/<slug>` = 計畫 §3 推薦的 **A 案**(新 route + 舊字面靠 redirect 保住)。
 * ✅ **A 案的配套債(#314)已於 D3c-5 還清**:計畫 §3 逐字要求 `/products?pbrand=X#brand-about`
 *    要轉去品牌介紹頁,否則設計稿字面連結(以及任何已經散出去的舊連結)會落在商品目錄、
 *    `#brand-about` 沒有錨點 = 停在頁首。
 *    **D3a 實查結論:hash 永遠不送到 server ⇒ 只能做 client 側**(信箱 C-25-Q Q1 → C-26-A 核可)
 *    ⇒ 實作在 `components/brand/BrandAboutRedirect.tsx`,行為邊界逐條寫在該檔檔頭。
 * ✅ **`/brands/<slug>` 自 D3a 起是活的**(`app/brands/[slug]/page.tsx`)—— 本行原本寫
 *    「D3 落地前是死連結」,那個前提已消失(關卡2 R2 must-fix 6)。
 * ✅ **`/brands` 總覽自 D3c-3 起也是活的**(`app/brands/page.tsx`)—— 本行原本寫「仍是死連結」,
 *    那個前提也已消失。
 *    · `BrandPageHeader.tsx` 的麵包屑第二段本來就指 `/brands`,route 落地後**不改一行就活了**
 *      (D3c-5 真瀏覽器實測點得進去)。
 *    ⚠️ **但 `ProductBreadcrumb.tsx` 的 `from=brand` 分支不算**(關卡2 R1 must-fix 更正:
 *      我原本把兩支一起宣稱「自動活了」):它的 href 字面是對的,可是全 `src` **零產生端**
 *      —— 沒有任何地方產出 `?from=brand&sourceId=<slug>` 的商品頁連結(唯一命中是它自己的
 *      測試),品牌頁的商品卡走的是乾淨的 `/products/<slug>`。**字面對 ≠ 有人走得到**。
 *      ⚠️ 精確一點(關卡2 R2 nit):那個分支**不是不可達** —— 手打或外部連結帶上
 *      `?from=brand&sourceId=akrapovic` 就會走到(它讀的是 `useSearchParams`);
 *      不可達的是「站內有東西產生它」。兩者差在「壞了誰會發現」:今天沒有人會。
 *      「品牌頁點進商品後麵包屑要不要帶品牌來源」是另一個題目,不在本線範圍。
 */
export const brandIntroUrl = (slug: string): string => `/brands/${encodeURIComponent(slug)}`;

/**
 * 品牌介紹頁商品區的格數(D3b)。設計稿 `brand-page.html:727` 的 `.bp-grid` 是 `repeat(5, 1fr)`、
 * 骨架也畫 5 個槽(`:1481-1485`)⇒ 這個 5 同時是「撈幾筆」與「排幾欄」。
 *
 * 🔴 **為什麼放這支檔**:它要同時被 `lib/brand-products.ts`(server,會 import `server-only`)
 *    與 jsdom 測試 import。放在前者的話,測試一 import 就把 `server-only` 拖進 client 環境、
 *    整支測試載入即爆(實測 `This module cannot be imported from a Client Component module.`)。
 *    本檔本來就是「零依賴、品牌專屬、server/client 兩邊都能用」的落點,不必為它另開一支檔
 *    (關卡2 R1 nit 7)。
 * ⚠️ 窄螢幕是**隱藏**多出來的格(≤1180 剩 3、≤620 剩 2),不是換行 ⇒ 撈的筆數固定 5、
 *    由 CSS 決定看得到幾個。改這個數字要**同時**改 `styles/brand-page.css` 的 `.bp-grid` 欄數
 *    與那兩條 `:nth-child`(`styles/brand-page.test.ts` 有字面守門會轉紅提醒)。
 */
export const BRAND_PRODUCT_SLOTS = 5;
