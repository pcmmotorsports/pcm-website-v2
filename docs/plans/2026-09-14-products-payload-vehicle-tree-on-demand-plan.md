# plan · `/products` 每一發 HTML 680KB —— 車款樹別整棵塞進頁面 —— 2026-09-14

> 主視窗 2026-09-14 派(A 窗量到:HTML 680KB / gz 84KB,其中 464KB 是整棵車款樹;瀏覽器整頁 1.2-1.45s 卡在這)。`⟦search-TAXONOMY2MB⟧` / `⟦search-TAXONOMYPERREQ⟧` 同族。**只寫 plan 不動碼。** 不碰 schema、不碰 RPC ⇒ 沒有 migration;碰 `/products` 頁 + 一支新 GET 端點(唯讀、無密鑰)⇒ 鐵則 8 走 plan。

## 0. 一句話
今天 server 把 **66 個牌子 × 3,824 個車款 × 12,335 列年份**整棵當 prop 塞給 client component ⇒ 它被序列化進 HTML 的 RSC payload。客人第一屏只需要**牌子清單(66 個,≈3KB)**;車款與年份**選了牌子才需要,而且一次只需要一個牌子的**。⇒ 首屏只帶牌子 + 網址上已選那個牌子的子樹;其他牌子點了再抓(新 GET 端點,吃同一份 3600s 快取)。

## 1. 樹從哪裡進 payload(逐檔核過)
| 步 | 檔案:行號 | 做什麼 |
|---|---|---|
| ① 撈 | `apps/storefront/src/lib/products.ts:1053` `getVehicleTaxonomyCached` = `unstable_cache(rpc('get_vehicle_taxonomy'))`,TTL `:176` `VEHICLE_TAXONOMY_REVALIDATE_SECONDS = 3600`(0911 Q1 乙那顆) | server 端拿整棵,**這一步不是問題**(有快取) |
| ② 建樹 | `products.ts:1284` `buildVehicleTaxonomy` ⇒ `MockMotoBrand[]`(`data/mock-moto-brands.ts:6-16`:brand{id,name,models[{id,name,years[]}]}) | server 端 |
| ③ 進頁 | `apps/storefront/src/app/products/page.tsx:146` `mark('tax', tryVehicleTaxonomy())` → `:177` `motoBrands` → `:653` `<ProductsPage … motoBrands>` | 🔴 **`ProductsPage` 是 `'use client'`(`components/ProductsPage.tsx:40`)⇒ 整棵被序列化進 HTML 的 `self.__next_f`** —— 464KB 就是這一步 |
| ④ server 自己也用 | `page.tsx:293` `parseVehicleFromUrl(sp, motoBrands)`、`:226` `parseSearchFacets(search, {motoBrands…})`(關鍵字裡認車名) | server 端,整棵**留著不動**(它有快取,不進 payload) |

## 2. client 真的需要哪一層(四個消費點逐一看)
| 消費點 | 需要 |
|---|---|
| `VehicleFinder.tsx:50-52` 三層下拉 | 牌子清單;**選了牌子**才要它的 models;選了車款才要 years ⇒ 一次一個牌子 |
| `use-vehicle-url-sync.tsx:60` `resolveVehicleForUrl(vehicle, motoBrands)` | 已選那台車**所在牌子**的子樹 |
| `use-deep-link-restore.tsx:74,78` `parseVehicleFromUrl` / `vehicleFromContext(motoBrands)`(`lib/vehicle-url.ts:101-115`,來源 = 車庫 / localStorage 的 brandId+modelId) | 🔴 那個牌子 **server 不知道**(client-only 狀態)⇒ 要能在 client 端**補抓**一個牌子 |
| `ProductsPage.tsx:512` 反查 slug | 已選牌子的子樹 |
⇒ **契約:client 手上永遠是「全部牌子(淺)+ 至多幾個牌子的完整子樹(深)」,缺的按需抓。** 沒有任何消費點需要同時看到兩個以上牌子的車款。

## 3. 量(2026-09-14 唯讀查正式庫 `vehicle_taxonomy_public`,`scripts/readonly-prod-sql.sh`)
```
rows 12,335 · brands 66 · brand+model 3,824
JSON 全列 496,498 B · 只牌子 669 B(加 id 約 3KB)· 牌子+車款(無年份) 115,420 B
最大一個牌子 2,001 列 / 463 車款(≈ 80KB 子樹);其餘 65 個牌子平均 ≈ 160 列(≈ 6KB)
```
**前後預估**(HTML 未壓):今天 680KB ⇒ 首屏無 `?vehicle=` **≈ 216KB**(−464KB);有 `?vehicle=` 再加那一個牌子 6-80KB。gz:84KB ⇒ **約 40KB**(樹那段壓縮率高,這格是估的、未實測;P3 驗收要量)。

## 4. 最短路(選這條;另兩條為什麼不選在 §4-b)
- **prop 改形**:`motoBrands` 仍是 `MockMotoBrand[]`,但 **models 只在「已選牌子」上填、其餘牌子 `models: []`** + 一個旗標 `modelsLoaded: boolean`(型別加一個可選欄,`mock-moto-brands.ts:12-16`)。已選牌子 = `page.tsx:293` 已算出的 `vehicle`(server 早知道)。
- **按需抓**:新 GET `apps/storefront/src/app/api/catalog/vehicle-models/route.ts?brand=<id>` ⇒ 回那個牌子的 `models[]`。形狀抄同目錄 `facet-counts/route.ts`(`force-dynamic`、參數不合 400、字典讀不到 503、`fetchVehicleTaxonomy()` 同一份 3600s 快取切一個牌子出來 ⇒ **零新 DB 查詢**)。回應 `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` ⇒ Vercel CDN 再擋一層(66 個 URL)。
- **client**:一支 `useBrandModels(brandId)`(fetch + 記在 context 的 `motoBrands` 裡,抓過不再抓);`VehicleFinder` 選牌子時觸發;`use-deep-link-restore` 的 `vehicleFromContext` 路:brandId 有、models 沒載 ⇒ 先抓再解析(抓失敗 ⇒ 當作沒有車庫預設,走既有 `VehicleTaxonomyNotice` 那扇門,不靜默)。
- **不衝突 0911 Q1 乙 / Q2 甲**:資料還是那一份 `getVehicleTaxonomyCached`、TTL 還是 3600、隔天生效不變;本 plan 只改「送多少到瀏覽器」,不改「多久更新一次」。CDN 那層 s-maxage 也是 3600,對齊。
- 首頁 `app/page.tsx:140` 同一棵樹進 `VehicleFinder` ⇒ 同一招可套(P4,量完 /products 再決定要不要)。`/products/[slug]` 與 `/cart` 各自的用法另量,不在本 plan。

### 4-b 不選的
- **靜態 JSON 走 CDN**(build 時吐 66 個檔):要 build step + 資料更新得重 build,與「一天一次、拉快取就好」那條拍板反著走。
- **整棵改用 `fetch` 在 client 抓一次**:仍是 464KB,只是從 HTML 搬到第二個請求,首屏沒變快。

## 5. 分片(每片 ≤45 分、獨立三綠、獨立 commit)
| 片 | 內容 | 驗收 |
|---|---|---|
| P1 端點 | `api/catalog/vehicle-models/route.ts` + `route.test.ts`(牌子不存在 404、字典掛 503、回形狀 = `MockMotoModel[]`);**這片先合對任何畫面零影響** | 三綠;`curl` 本機 probe:`?brand=honda` 回 models、回應頭有 s-maxage |
| P2 server 瘦身 + client 補抓 | `page.tsx` 只填已選牌子;`mock-moto-brands.ts` 加 `modelsLoaded?`;`useBrandModels`;`VehicleFinder` / `use-deep-link-restore` / `use-vehicle-url-sync` 接上;既有測試 `vehicle-url.test.ts` / `search-facets.test.ts` 綠 | 三綠;storefront probe 量 `/products` HTML 大小前後(`curl -s -o /dev/null -w '%{size_download}'`,gz 用 `-H 'Accept-Encoding: gzip'`)寫進 commit body;三條路各走一次:①直進選牌子→車款→年份 ②帶 `?vehicle=honda:cbr1000rr:2021` 進 ③車庫有車、無 `?vehicle=` 進(deep-link 補抓那條) |
| P3 Sean 走 | 正式站 dev 部署後 Sean 手機 + 桌機各走一次上面三條;A 窗重量整頁時間 | 1.2-1.45s 那格要掉;沒掉 ⇒ 卡的不是這裡,本 plan 收手 |
| P4(選)首頁同招 | `app/page.tsx:140` | 同 P2 |

## 6. Rollback
- P2 `git revert` 一顆 ⇒ prop 回整棵;端點留著沒人叫也無害。P1 單獨 revert ⇒ 端點消失,**P2 若還在會讓選牌子壞掉** ⇒ 順序:先退 P2 再退 P1。
- 沒有 DB、沒有 env、沒有 vercel.json 變更;CDN 快取最多殘留 3600s 的舊 models(內容與今天一樣,不算退步)。

## 7. 要 Sean 拍的
沒有品味題。一題規模:
```
Q:先做 /products 一頁量到數字,首頁(同一棵樹)要不要一起做?
A:甲 先 /products,量到有效再做首頁(推薦,兩片各自可退) | 乙 兩頁一起
```
