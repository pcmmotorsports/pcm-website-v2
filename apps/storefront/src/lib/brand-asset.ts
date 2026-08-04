// brand-asset.ts — 品牌內容資產路徑的前綴(D2c-2 從 BrandPageHeader 抽出;2026-08-04)
//
// 設計側資產保留 Open Design 的扁平佈局(信箱 C-01-A Q1=A):
// 資料層的 `assets/...` 路徑一字不改,渲染時補這個前綴;磁碟位置 =
// `apps/storefront/public/brand-assets/assets/...`(守門 = `data/brand-assets.test.ts`)。
//
// 🔴 為什麼要從 `BrandPageHeader.tsx` 抽出來:D2c-2 的 `BrandPageMedia` 是 client 元件,
//    而 client 元件 import 誰,誰就整包進 client bundle。留在 Header 裡的話,
//    這兩行會把整支 BrandPageHeader(含 next/link、BrandRichText、parser)一起拖進去。

const ASSET_BASE = '/brand-assets/';

export const brandAsset = (path: string): string => `${ASSET_BASE}${path}`;

/**
 * 淺色底 logo(`assets/brands-trim/`)的資產路徑,**由 slug 求出、不在資料層**。
 * 與資料層的 `bandLogo`(深色底 `assets/brands-dark/`,而且逐家副檔名不同、samco 還在
 * 另一個資料夾)是**不同的東西**,不要拿錯 —— 三組資產的用途對照見 `BrandPageBrandWall.tsx` 檔頭。
 *
 * 🔴 D3c-3 從 `BrandPageBrandWall.tsx` 搬來這裡,理由與本檔當初被抽出時相同
 *    (**第二個消費端出現時就抽**):`/brands` 總覽的卡片也要它,留在元件裡的話
 *    總覽頁會為了一個一行的字串函式 import 整支磚牆(連帶 next/link 與 BRAND_CONTENT)。
 */
export const brandTrimLogo = (slug: string): string => brandAsset(`assets/brands-trim/${slug}.png`);
