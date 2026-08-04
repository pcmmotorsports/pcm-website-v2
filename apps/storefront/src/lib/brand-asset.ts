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
