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

## 3 · ⛔ 三個候選 —— **本節【已被 codex R1 打穿】,訂正在 §6。先讀 §6 再讀本節。**

> 🔴🔴 **§3a(推薦案)【是現況】** —— 我以為快取的是 12,197 列原料,而**碼裡快取的本來就是成品樹**。
> 舊字面全部留著不刪,讓拿「只快取算完的樹」去搜的人同一發撞到訂正。

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


---

## 6 · 🔴🔴 codex R1 訂正(2026-09-06,`FAIL` + 6 條 must-fix)

### 6.1 最硬的那一條:**案 a 已經是現況**

codex 逐字:「現碼的 `unstable_cache` producer 已在最後 `return buildVehicleTaxonomy(...)`,
快取的本來就是成品樹,不是 12,197 列原料」。
🟢 **我開檔核了,它是對的**:`products.ts:980` 逐字 `return buildVehicleTaxonomy([{ fitments }]);`
⇒ 📌 **那 2,679,379 bytes【就是那棵樹】。**
⇒ ⛔ ~~§3a「只快取算完的樹」~~ **零實作差異,整案作廢。**

🎯 **而我為什麼會寫錯**:我讀到 log 印 `rows=12197`,就把「撈了 12,197 列」推成「快取了 12,197 列」。
📌 **`rows=` 是【它撈了多少】,不是【它存了多少】** —— 兩個數字被我當成同一個。

### 6.2 其餘五條(全部收下,逐條寫進下面的新候選)

| # | codex 說什麼 | 我的處置 |
|---|---|---|
| ② | `JSON.stringify(x).length` 是 **UTF-16 碼元**不是 **UTF-8 bytes**;中文會**低估** | §6.4 第 1 步改用 `Buffer.byteLength(JSON.stringify(x), 'utf8')` |
| ③ | `page.tsx:41` 是 `force-dynamic` ⇒ **`/products` 的 `cache=MISS` 證不了內層 `unstable_cache` 有沒有命中**;修好之後該看的是 **`[vehicleTaxonomy] cold…` 這一行【消失】**,不是數值下降 | 驗收改寫,見 §6.4 |
| ④ | 「呼叫端零改動」只在我讀過的 `/products` 成立,`/cart` `/account` 兩支 API **沒核過** | 降級成「**未核**」,動手前逐一開檔 |
| ⑤ | 漏列 **single-flight**:部署後第一批**並行** cold request 會**各自**打 13 頁 ⇒ 瞬間放大 DB 壓力 | 進 §6.3 的風險欄;而它與 ⟦search-TAXONOMYTIMEOUT⟧ 那個 `57014` **可能是同一件事** |
| ⑥ | 「先 a 再評估 b」不成立(因為 a 是現況)⇒ **先精確量那棵樹,超限就直接評估分片或按需載入** | 順序照改 |

### 6.3 換上來的候選(取代舊 §3)

| 案 | 做什麼 | 為什麼可能成立 | 已知代價 |
|---|---|---|---|
| **a′** | **把樹本身變小** —— 年份改存**區間**而不是逐年展開;丟掉畫面不用的欄位 | 12,197 列裡大量是「同車型不同年份」各一列;樹若逐年展開,體積就是這樣來的 | 要動 `buildVehicleTaxonomy` 的輸出形狀 ⇒ **它有 4 個消費端**(`:978` 註解自己寫的)⇒ 影響面比原 a 大 |
| **b′** | **分片快取** —— 按品牌切成 N 條 cache entry,每條遠小於 2 MB | 2 MB 是**單條**上限,不是總量上限 | 讀取端要合併;`revalidate` 與 `tags` 的語意變成 N 份 |
| **c′** | **`/products` 不要它** —— 車款下拉改按需載入(進到 VehicleFinder 才撈) | 切分類根本用不到車款樹 ⇒ 這條把成本**移出關鍵路徑** | 動 `/products` 資料流 + `VehicleFinder` 載入時機;而首次開下拉的人要等 |

🛑 **三案都沒有量過,而 a′ 的前提(「逐年展開才是體積來源」)是【推論】。**

### 6.4 動手順序(第 1 步就是把 a′ 的前提變成數字)

1. 🔬 **精確量那棵樹**:`Buffer.byteLength(JSON.stringify(tree), 'utf8')`(**不是 `.length`**);
   同時印**逐年展開前後**兩個數 ⇒ 這一步同時回答「a′ 有沒有搞頭」。
2. 依讀數選案。**超限而年份不是主因 ⇒ 直接走 b′ 或 c′,不要再試 a′。**
3. 驗收的尺 = **`[vehicleTaxonomy] cold pages=… ms=` 這一行【在正式站 log 消失】**
   (🔴 不是看 `/products` 的 `cache=MISS` —— 那一格因為 `force-dynamic` 恆 MISS,**零判別力**)。
4. 動手前逐一開檔核 `/cart` · `/account` · `/api/catalog/facet-counts` · `/api/search` 四個呼叫端。

### 6.5 而 codex 這一輪的成本要誠實記

log **79,736 bytes**;兩把尺:`must-fix` 字面 **26** vs 帶 `檔案:行號` **14**。
⇒ 尺A > 尺B ⇒ 那份 log **有一半是它讀到的東西**,不是它寫出來的結論。
🟢 **而它產出的 6 條全部是真的**(第 1 條我開檔複驗、其餘逐條可讀)⇒ **這一發值得。**
