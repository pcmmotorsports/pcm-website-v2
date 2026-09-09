// app/sitemap.ts — /sitemap.xml(Next App Router metadata route)。GEO P0「地圖」。
//
// 商品來源 = fetchCatalogHandles()(匿名 client、走 products_public view →
// 經銷價零外洩、已分頁繞 `db-max-rows` 上限(~~1000~~ ⇒ 2026-08-18 實測 2000,V 窗量、未自驗))。
// 撈**全目錄**(不綁分類)→ sitemap 天然涵蓋所有品類、多品牌(#212)上架後不再靜默漏頁(補上舊
// category-scoped 漏其他品類的**覆蓋缺口**、即 #247 主痛點)。
//
// 🔵 **[2026-09-08 · 投影縮成 `id, handle` —— 而【不是】「#247 的效能結案了」]**
//   🛑 **本片證得到的只有:投影變窄 ⇒ 每一趟往返的資料量下降。**
//   🔴 **證不到 build 會在 60 秒內做完** —— 那有 27 趟循序往返, 而往返成本不是本片動得到的。
//     ⇒ **真正的驗收是【下一次 production build 成功】。** 在那之前不要把本段讀成「修好了」。
//   ⛔ ~~「C4/#205 後 fetchCatalogProducts 改 listAllProducts()」~~
//   ⛔ ~~「🔴 #247 效能治本仍未結:此處仍撈 detail 全欄僅為取 handle,
//        輕量 listAllHandlesPublic(products_list_public 只取 id+handle)… 待 #247」~~
//   ✅ 現在走 `fetchCatalogHandles()` → `adapter.listAllHandles()`(只投影 `id, handle`)。
//   🎯 **而這一格值得記**:上面那句 TODO **早就把修法寫對了**(連名字都幾乎一樣:
//     它寫 `listAllHandlesPublic`, 實作叫 `listAllHandles`)—— **而它在檔頭躺著, 沒有人做。**
//     ⇒ 📌 直到 2026-09-08 顧客站 production build 連 3 次在本 route 逾時(每次 60 秒)、
//       部署失敗 33 小時, 才有人回來讀這一段。
//   ⛔ ~~「`<lastmod>` 那一半仍未做 —— 那不在本片範圍, #247 那一格還開著」~~
//
// 🛑 **[2026-09-09 · `<lastmod>` 【決定不做】—— 而這不是「還沒排到」,是量完之後的結論]**
//   ⚠️ 上面那句舊 TODO 讀起來像個待辦 ⇒ 下一個人會照著去做。**留這一段就是為了讓他不用再走一次。**
//
//   🔵 **效能不是阻力**(唯讀對正式庫 `explain analyze` 實測,2026-09-09):
//     全量 26,425 列 `id, handle` = **12.761 ms**;加 `updated_at` = **15.615 ms**(+2.9ms)。
//     兩者**執行計畫相同**(`Index Scan using products_pkey`),只有 row width 34 → 42 bytes。
//     ⇒ 而 2026-09-08 那三次 60 秒逾時的成因是**往返趟數**(舊路每列撈 detail 全欄 + embed),
//       加一個欄位**不多一趟往返** ⇒ 這一片不會把那次的修法吃掉。
//     ⇒ `products_public` **有** `updated_at`(timestamptz),不用改 view。
//
//   🔴🔴 **擋住這一片的是【資料源不可信】:`updated_at` 被批次整片翻新,它不是「內容改了」。**
//     逐日:`2026-09-09` → **25,430** 列(全表 26,425 ⇒ 96%);次高的一天只有 3 列。
//     同一秒內的最大群集:`09:18:17` → **4,566** 列、`09:09:39` → 3,637 列 —— 那是批次的指紋。
//     全表只有 **1** 列的 `updated_at` 等於 `created_at`(從沒被改過)。
//     🟢 正對照:同一張表的 `created_at` 逐月是 3,637 / 2,606 / 18,774 / 1,408 ⇒ 分佈得開,尺是活的。
//     ⚠️ 「那 25,430 列是同步引擎寫的」**吻合但未證實**(從批次指紋推的,沒讀同步引擎的碼)——
//       而**它是不是同步引擎寫的,不改變這個結論**。
//
//   ⇒ 📌 拿它當 `<lastmod>`,等於每次同步跑完就對 Google 說「這 25,430 頁今天全改了」。
//     後果有兩個:① Google 學會不信我們的 lastmod(那等於白做);
//     ② 它回頭重爬 25,000 頁沒變的東西,**把 crawl budget 燒在原地**。
//   ⇒ 🛑 **沒有 lastmod 只是少一個提示;有一個假的 lastmod 是主動給錯訊號。**
//
//   ✅ **要做這一格,先要有一個「內容真的變了」的來源**(例如對 title / price / description
//     算 hash、只有 hash 變才動時間戳)。那要動資料層與同步引擎 ⇒ 碰 schema ⇒ 走 plan + Sean。
//   ⛔ 「只給靜態頁與品牌頁 lastmod」也不做:那只覆蓋 24 條中的 21 條,對 25,843 個商品頁零幫助。
//
// 快取:每日 revalidate,避免每個爬蟲請求都全量打 DB。
// 休眠:base undefined(prod 未設 NEXT_PUBLIC_SITE_URL)→ 回空、省一次 DB 撈(見 lib/seo.ts 檔頭 🔴)。

import type { MetadataRoute } from 'next';
import { resolveSiteUrl } from '@/lib/site-url';
import { fetchCatalogHandles } from '@/lib/products';
import { buildSitemapEntries } from '@/lib/seo';
// D3c-4:品牌總覽與 20 個品牌介紹頁進地圖。來源是**靜態內容檔**(不是 DB)⇒ 不多一次撈。
import { BRAND_CONTENT } from '@/data/brand-content';

// 🔶 2026-08-06 第2批決定:**`/coming-soon` `/stores` `/install` `/logout` 四條新路由都不進 sitemap。**
//   `/coming-soon` 與 `/logout` 本來就 `noindex`(見各自 page 的 metadata)。
//   `/stores` `/install` **刻意可索引**(設計端 `coming-soon-handoff.md` §三:功能版是站內頁、
//   不該 noindex),但它們現在只是「新功能即將上線」佔位頁、內容極薄 ⇒ 主動送進 sitemap
//   等於請 Google 優先收錄兩頁沒有內容的頁。**等切回完整的 stores / install 頁再收進來**
//   (切回點寫在那兩支 page.tsx 的檔頭)。這是一個決定,不是漏掉。
export const revalidate = 86400; // 1 天

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = resolveSiteUrl();
  if (!base) return []; // 休眠:未設正式網域不產 sitemap(與 buildSitemapEntries 一致、且省 DB 撈)。
  // 🔴 2026-09-08:改走 `fetchCatalogHandles()` —— 舊路 `fetchCatalogProducts()` 對每一列
  //   投影 detail 全欄 + 一個 embed, 而這裡只用得到 handle。
  //   ⛔ ~~`const { products } = await fetchCatalogProducts(); products.map((p) => p.slug)`~~
  //   📌 那條路讓 production build 連 3 次在本 route 逾時(每次 60 秒)。
  const { handles } = await fetchCatalogHandles();
  return buildSitemapEntries(handles, base, BRAND_CONTENT.map((b) => b.slug));
}
