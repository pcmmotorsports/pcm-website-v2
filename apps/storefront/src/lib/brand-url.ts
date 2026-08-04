// brand-url.ts — 品牌相關的三個網址(D2e-1 從 BrandPageHeader.tsx 抽出;2026-08-04)
//
// 抽出的理由與 `lib/brand-asset.ts` 同款(那支是 D2c-2 抽的):**第二個消費端出現時就抽**。
// D2e-1 的分類 chips 與品牌磚牆都要用,留在 `BrandPageHeader.tsx` 的話兩支元件會為了
// 一個一行的字串函式 import 整支 Header(連帶 next/link、BrandRichText、parser)。
// D3 建 `/brands/[slug]` route 時也會用到 `brandIntroUrl`,同樣不該去 import 一個元件。
//
// 三個都是純字串函式、零依賴 ⇒ server / client 兩邊都能用。

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
 * 🔴 **A 案有一條配套債本片沒做**:計畫 §3 逐字要求 `/products?pbrand=X#brand-about` 加一條
 *    `redirect()`,否則設計稿字面連結(以及任何已經散出去的舊連結)會落在商品目錄、
 *    `#brand-about` 沒有錨點 = 停在頁首。**那條 redirect 屬 D3**,見 backlog #314。
 * 🔴 **D3 落地前 `/brands/<slug>` 是死連結**,與 D2b 的麵包屑 `/brands`
 *    及既有 `ProductBreadcrumb.tsx:57,60` 同一批。D3 若改採 §3 的 B 案,改這一個函式即可。
 */
export const brandIntroUrl = (slug: string): string => `/brands/${encodeURIComponent(slug)}`;
