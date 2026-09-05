# Plan · ⟦search-TAXONOMY2MB⟧ 車輛對照表塞不進快取 ⇒ 每發重撈 12,197 列

> 線 `-f3` · 2026-09-06 · **plan 階段,一行 source 都沒動。**
> 鐵則 8:動 `/products` 的 server 資料層 = **所有客人**的路徑 ⇒ 提 plan 等批。
> 主視窗裁 B(先開列再寫 plan);②③ 各自開列,本檔只做 ①。

---

## 0 · 一句白話

`/products` 每一次請求都重撈**車輛對照表 12,197 列 / 13 頁**,吃掉 **3–6 秒**。
**不是查詢慢,是那份資料 2.68 MB > Next data cache 的 2 MB 上限 ⇒ 快取寫入【每次都失敗】。**

---

## 1 · 量到的(正本 `~/pcm-mailbox/量-切分類為什麼慢-20260906.md`)

正式站**自己就印著**(不是新加的 instrument),2026-09-06 16:47–16:49Z,`branch=main`:
```
[vehicleTaxonomy] cold pages=13 rows=12197 batch=4 first=531ms restAvg=205ms ms=2989
同窗七發 ms = 2973 · 2989 · 4674 · 4938 · 5086 · 5676 · 5695
Failed to set Next.js data cache for unstable_cache /products?_rsc=…
  items over 2MB can not be cached (2679379 bytes)
```
· 同窗 client 端網址落地 `3371 · 3378 · 5487 · 6259 ms` ⇒ 這一段佔 **88–95%**。
· ⚠️ **兩邊不是逐發配對**(log 無 request id)⇒ 那個百分比是**兩組分布的比較**。
· 那一窗**每行 `/products` 都 `cache=MISS`**,而 log 自己印的字是 **`cold`**。

## 1.1 🔴 而這件事**碼裡早就寫著**,只是寫的時候它還是真的

`apps/storefront/src/lib/products.ts:367-373` —— `fetchCatalogProducts` 的**快取豁免**註解:
> 「全目錄 general 投影 JSON 為 **3,816,327 bytes**,超過 Next data cache 單條 2MB 上限,寫入被拒…
> **其餘三函式(featured/categories/taxonomy)實測皆 <30KB、快取有效**」

⛔ ~~taxonomy <30KB~~ ⇒ 🔴 **今天它是 2,679,379 bytes(2.68 MB),差 89 倍。**
📌 **那句話 2026-07-08 寫的時候是對的** —— 資料長大了,而**沒有任何東西在看著那個數字**。
⇒ 🎯 **這正是本片要順手補的第二件事:一個會叫的量具(見 §5)。**

---

## 2 · 現況座標(每一個都開檔核過)

| 東西 | 落點 |
|---|---|
| 快取包裝 | `products.ts:786` `getVehicleTaxonomyCached = unstable_cache(…, ['vehicle-taxonomy-v3'], { revalidate, tags:['catalog'] })` |
| 翻頁迴圈 | `products.ts:~880-960`(`PAGE_SIZE=1000`、`MAX_PAGES=50`、`batch=4`) |
| 失敗包裝 | `products.ts:994-1004` `tryVehicleTaxonomy`(catch ⇒ `{motoBrands:[], failed:true}`) |
| 對外 | `products.ts:1006-1009` `fetchVehicleTaxonomy`(**刻意丟掉 `failed`**) |
| `/products` 呼叫 | `apps/storefront/src/app/products/page.tsx:79-83`(在 `Promise.all` 裡) |

🔵 **形狀重點**:撈回來的 12,197 列**不是拿去畫畫面的** —— `products.ts` 內部緊接著把它
**壓成一棵去重的「品牌 → 車型 → 年份」樹**。⇒ 📌 **快取的是原料,而畫面只要成品。**

---

## 3 · 三個候選(主視窗指定 a / b / c,逐案寫影響面 + rollback + 怎麼量)

### 案 a · 只快取【算完的樹】,不快取 12,197 列原料 —— 🟢 **推薦**
把去重成樹那一段搬進 `unstable_cache` **裡面**,快取的值換成那棵樹。
· **為什麼會小**:12,197 列 × 4 欄的原始 row 有大量重複(同一車型不同年份各一列);
  樹是去重後的。⚠️ **而「會小到 2 MB 以下」目前是【推論不是量到】** ⇒ **§5 第 1 步就是去量它。**
· **影響面**:`products.ts` 內部;對外簽章 `fetchVehicleTaxonomy(): MockMotoBrand[]` **不變**
  ⇒ 呼叫端(`/products`、`/cart`、`/account`、`/api/catalog/facet-counts`、`/api/search`)**零改動**。
· **rollback**:單顆 `git revert`;無 DB、無 env、無對外副作用。
· **量**:修前 / 修後跑**同一把尺** —— 正式站 log 的 `[vehicleTaxonomy] … ms=` 與 `cache=MISS|HIT`,
  加上「`Failed to set … can not be cached` **這一行有沒有消失**」。
  🔴 **後者是判別力最高的那一格**:它在「還是太大」與「已經夠小」兩個世界印**不同**的東西。

### 案 b · 把對照表從 `/products` 的 RSC 拆出去(切分類時不重跑)
· ⚠️ **今天的行為不是「切分類重跑」** —— 是**每一次 `/products` 請求都跑**(含首次進站)。
  ⇒ 拆出去只把成本從「切分類」搬到別的時刻,**沒有消除它**;而快取仍然存不進去。
· ⇒ 🛑 **單獨做 b 不會讓 `ms=` 下降** —— 它治的是「阻塞在哪」不是「花多久」。
· **影響面**:動 `/products` 的資料流與 `VehicleFinder` 的載入時機 ⇒ **比 a 大很多**,而收益要 a 先成立。

### 案 c · 兩者都做
⇒ **順序不可反**:先 a(讓快取真的生效),量到 `ms=` 下降之後,再評估 b 值不值得。
📌 **本 plan 建議:先只做 a,而 b 留在列上等 a 的讀數。**

---

## 4 · 🔴 這份 plan 答不出什麼

· **「樹會不會小於 2 MB」沒有量** —— §3a 那句是推論。§5 第 1 步就是把它變成數字;
  **量出來還是 >2 MB ⇒ a 整案不成立**,那時要走的是「只快取畫面真的要用的欄位」或分片快取。
· **`statement timeout`(§3③ 那一列)不在本片** —— 它今天靜默降級成殘缺下拉。
· **那 12,197 列為什麼要 3–6 秒** —— `EXPLAIN ANALYZE` 沒跑(第 3 層沒做)。
  ⇒ 就算 a 成功,**冷啟動的第一發仍然要付這個錢**。
· **preview 沒量** —— 本次三層只查了正式站。

---

## 5 · 動手順序(順序本身是判準的一部分)

1. 🔬 **先量那棵樹的 bytes**(不改任何行為):本機或一次性 script 把樹 `JSON.stringify().length` 印出來。
   ✅ 這一步的產出是**一個數字**,而它決定 a 成不成立。
2. 只有 1 過了才動 a。
3. **順手補一個會叫的量具** —— §1.1 那句話爛掉時沒有人知道。
   形狀:在 `unstable_cache` 的 producer 裡量 payload bytes,超過門檻(例如 1.5 MB)`console.warn`。
   🔵 **它兩個世界印不同的東西**,而今天那個 `Failed to set…` 只在**已經失敗之後**才出現。
4. 驗收:修前修後同一把尺(§3a),外加 `pnpm test` 動到的檔。
