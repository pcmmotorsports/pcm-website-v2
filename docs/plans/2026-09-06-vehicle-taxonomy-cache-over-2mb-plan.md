# Plan · ⟦search-TAXONOMY2MB⟧ 車輛對照表塞不進快取 ⇒ 每發重撈 12,197 列

> 線 `-f3` · 2026-09-06 · **plan 階段,一行 source 都沒動。**
> 鐵則 8:動 `/products` 的 server 資料層 = **所有客人**的路徑 ⇒ 提 plan 等批。
> 主視窗裁 B(先開列再寫 plan);②③ 各自開列,本檔只做 ①。

---

## 🔴🔴 檔頭訂正(2026-09-09 · `shop`)—— **本檔的【檔名與 §0】建在一個不是它的數字上**

⛔ ~~那份資料 **2.68 MB** > Next data cache 的 2 MB 上限~~
✅ **那 2.68 MB 是【商品清單頁】的, 不是車輛對照表的。**
```
量法  那行警告訊息自己帶著【被拒絕的 cache key】
      get_runtime_logs · production · query="items over 2MB can not be cached"
      近 7 天全站只有 2 個部署印過它;HYRP 那 3 筆逐字讀了, key 全部是
        /products?per=100&vehicle=ducati:…   (2682433 / 3927985 bytes)
🟢 而車輛對照表自己  wrs 2026-09-08 全撈序列化 = 1,062,838 bytes ≈ 1.01 MB ⇒ 在 2 MB 之內
⚠️ 我只讀了 7 筆裡的 3 筆(另一個部署的 4 筆讀不到, 換三個窗都逾時)
   ⇒ 我說得出「我讀到的三筆都不是它」, 說不出「七筆都不是」
```
📌 **⇒ 那 2.68 MB 是 `⟦search-CATALOGPAGE2MB⟧` 的, 而那一列 2026-09-09 已經判 `done`**(正式站 3.29/4.48 MB ⇒ 0.68/0.60 MB)。

⛔ ~~`/products` 每一次請求都重撈~~ ⇒ **09-06 就被本檔 §8.2 推翻**(43 發 / 5 筆 cold);
今天正式站三發 `[catalogRoute]` 逐字 `tax=36ms` / `45ms` / `37ms` ⇒ **都是命中快取的。**

### 🛑 所以本檔還剩什麼
```
⛔ 檔名「cache-over-2mb」    ⇒ 誤導。而【不改檔名】—— 改了之後所有指到它的連結會斷,
                              而「舊路徑查無」與「這份 plan 不存在」印同一個東西
⛔ §0 §3 §5 §6.3 §6.4      ⇒ 全部作廢(§7 §8 取代)
✅ 還站著的只有 §10 的 c′  ⇒ 而它的理由與 2 MB 無關:
   cold 的時候要 0.86-1.2 秒, 而那 130 次是【客人進站第一眼】(§10.1)
🔴 而 c′ 的【好處】仍然證不到(§10.6b:首頁六件並行, 等的是最慢那一件)
```
🔵 **本檔 §9 那張「要重量的前提」表, 到今天為止被自己推翻了三格**(#5 呼叫端 · #9 另一列 · 以及本節)。
　📌 **那不是那張表寫壞了 —— 那是那張表在做它該做的事。**

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


---

## 7 · 🔴🔴 量完了 —— **而它推翻了本檔【自己的標題】**(2026-09-06,唯讀 SQL)

`bash scripts/readonly-prod-sql.sh`,對正式庫,零寫入。

### 7.1 三個數(主視窗指定的那三個)

```
分母                          rows_total                 12,197
三層節點(去重後)             brands 67 · models 3,816 · year_nodes_expanded 24,464
                              (若年份【不展開】只存區間 ⇒ 12,197 筆)
同形樹 bytes(展開年份)       365,774            ← 0.36 MB
分片後最大一片(按品牌)       Honda 46,480 · Ducati 40,005 · Yamaha 38,677 · KTM 29,614 · Kawasaki 27,435
```
⚠️ **射程**:第 2、4 兩個數是**我用 SQL 重建同一個形狀**量的,**不是 JS 那一棵**
(`id` 在 JS 是 `slugify(name)` + 去重後綴,我用 `name` 代;其餘欄位逐一對齊)。
🔴 §3(年份改存區間那一版)**SQL 寫錯了、報 `column "node" does not exist`** ⇒ **那個數字我沒有**,不補猜。

### 7.2 🛑 所以本檔的標題是錯的:**那棵樹【不是】 2.68 MB,是 0.36 MB**

⇒ ⛔ ~~「車輛對照表 2.68 MB 塞不進 Next data cache」~~ —— **它塞得進去,差 7 倍有餘。**
⇒ ⛔ ~~候選 a′(把年份改成區間)~~ —— **零意義**:已經遠低於 2 MB,省那 100 KB 不改變任何事。
⇒ ⛔ ~~候選 b′(分片快取)~~ —— **零意義**:最大一片才 46 KB,而**整棵**都已經合格。

### 7.3 🎯 那 2,679,379 bytes 是【別人的】—— 我把兩行 log 綁成同一件事

那一行完整長這樣:
```
Failed to set Next.js data cache for unstable_cache
  /products?_rsc=…&per=100&vehicle=ducati:scrambler-800:2023 <hash>,
  items over 2MB can not be cached (2679379 bytes)
```
🔵 鍵裡帶著 `per=100&vehicle=…` ⇒ 那是**商品清單**那一支(`getCatalogPageCached`,`products.ts:528`),
**不是**車款樹(`getVehicleTaxonomyCached`,`:786`)。
📌 **兩行 log 在畫面上前後相鄰,而我把它們讀成因果。**

### 7.4 而【仍然成立】的是什麼(不要連好的一起丟)

· ✅ **時間確實花在 `fetchVehicleTaxonomy`** —— 那七發 `ms=2973…5695` 是它自己印的,沒有被推翻。
· ✅ **它每一發都是 `cold`** —— 也是它自己印的字。
· 🔴 **而現在多了一個【更好的問題】**:
  > **那棵樹只有 0.36 MB、完全合格,那它為什麼每一發都 cold?**
  候選(**都沒查**):`revalidate: CATALOG_REVALIDATE_SECONDS = 60` 太短而請求分散 /
  部署後快取被清 / `unstable_cache` 在這條路上根本沒生效 / 並行 cold request 各自打(codex ⑤)。
· ✅ **codex 那六條 must-fix 一條都沒被推翻** —— 它們講的是方法,而方法的問題與資料無關。

### 7.5 下一步(取代 §6.4)

1. 🔬 **先查「為什麼 cold」** —— 這是新的主線,而 §6.3 三個候選**全部作廢**。
2. **另開一列**給 `getCatalogPageCached` 的 2.68 MB(那是**真的**超限,而它是商品清單那一支)。
3. 🛑 **在 1 有答案之前,不要動任何一行碼** —— 本檔前六節提的每一個修法都建立在一個**被量測推翻的前提**上。


---

## 8 · 「cold」那個字是**有條件的** —— 而查它的時候我撞到自己的第三個錯

主視窗問:那行 log 的 `cold` 是**只在 miss 時印**,還是**無條件印**(本 repo 記過 `labels-that-print-regardless`)?

### 8.1 答案:**有條件**,而條件是「它在快取的 producer 裡面」

```
products.ts:786   const getVehicleTaxonomyCached = unstable_cache(
products.ts:787     async (): Promise<MockMotoBrand[]> => {        ← producer 從這裡開始
products.ts:959       console.info(`[vehicleTaxonomy] cold pages=…`)  ← 它在 producer 【裡面】
products.ts:980       return buildVehicleTaxonomy([{ fitments }]);
products.ts:985   ['vehicle-taxonomy-v3'],
```
🔵 **`unstable_cache` 的 producer 只在【沒命中】時才執行** ⇒ 那一行**出現**就代表那一發真的 miss 了。
⇒ ✅ **它不是恆真標籤,主視窗這一問的答案是「沒問題」。**
⚠️ 而 `cold` 這個字**本身是寫死的字面**(不是由某個 `isHit` 算出來的)——
　 它成立**只因為它站的位置**。⇒ 📌 **有人把這行 log 搬出 producer,它就會變成恆真標籤而沒有東西會叫。**

### 8.2 🔴 而它同時推翻我另一句話:**「每一發都 cold」是我看漏的**

那一行**只在 miss 時印** ⇒ **命中的那些請求【什麼都不印】**。
🔬 而同一個時間窗:`group_by=requestPath` 印 **`/products` 23 筆**,
而我抓回的那批 log 裡**只有 7 筆帶 `[vehicleTaxonomy]` 那一行**。
⇒ 🎯 **⛔ ~~每一發都 cold~~ ⇒ 那一窗至少有一部分是【命中的】。**
⚠️ **射程**:我那一發 log 查詢帶了 `limit`,所以「7」是**我抓回來的**不是**那一窗全部的**
　 ⇒ **精確比例我沒有**,能斷言的只有「**不是每一發**」。

### 8.3 📌 這是今晚同一個母題的第三次

| # | 我做了什麼 | 形狀 |
|---|---|---|
| 1 | `rows=12197` 讀成「快取了 12,197 列」 | 把**它撈了多少**接到**它存了多少** |
| 2 | `2679379 bytes` 那行接到車款樹 | 把**相鄰**讀成**因果** |
| 3 | 「每一發都 cold」 | 把**印出來的那些**讀成**全部** |
⇒ 🎯 **三次都是:一個真的讀數 + 一個我沒有察覺自己做了的接線。**
⇒ 🛑 **而三次的方向都朝著「我當時正在找的那個故事」。**

### 8.4 ⇒ 主線問題要重寫(這一節取代 §7.5 第 1 點)

⛔ ~~「0.36 MB 完全合格,那它為什麼**每一發**都 cold?」~~
✅ **快取是會命中的。真正剩下的問題比較小、也比較誠實**:
> **miss 的時候要 3–5.7 秒,而那筆帳記在【客人那一下點擊】上。**
候選(**都沒查**):`revalidate = 60` 太短(`products.ts:143`)/ 部署後清空 /
並行 miss 各自打 13 頁(codex ⑤)/ **c′:根本不該在 `/products` 的關鍵路徑上**。
🔵 **`c′` 現在是唯一還站著的候選** —— 它不在乎快取命不命中,它把這件事移出客人那一下。


---

## 9 · 🔴 開工前要重量的前提清單(shop 窗 2026-09-09 01:54 · **只列,一個都沒有量**)

> 主視窗 2026-09-09 指派:本 plan 等 Sean 批,而**批下來之後的第 1 步就是這一張表**。
> 🛑 **本節不含任何新讀數** —— 每一格寫的是「要量什麼」與「為什麼它可能過期」。
> 📌 為什麼要有這一節:本檔前八節**已經自己推翻過三次**(§6.1 · §7.2 · §8.2),
> 而三次的成因一樣 —— **一個真的讀數 + 一個沒察覺的接線**。⇒ 第四次最可能來自**時間**。

| # | 要重量的前提 | 本檔寫的值 | 為什麼可能過期 |
|---|---|---|---|
| 1 | `vehicle_taxonomy_public` 列數 | 12,197(09-06) | 板列 `⟦search-TAXONOMY2MB⟧` 自己 09-08 量到 **12,326** ⇒ 表在長, 而方向對本片是**變糟** |
| 2 | `[vehicleTaxonomy] cold … ms=` 的分布 | 2973–5695 ms(09-06 · `branch=main`) | **main 在 2026-09-09 00:29 走了 113 顆**(含 sitemap 那片動 `packages/ports` 與 adapter)⇒ 那七發是在**另一個 main** 上量的 |
| 3 | 那棵樹的實際 bytes | 0.36 MB(§7.1) | ①它是**用 SQL 重建同形狀**量的, 不是 JS 那一棵(§7.1 射程自己標了)②表長了(見 #1) |
| 4 | 命中率 | 「不是每一發都 cold」(§8.2) | 精確比例**從來沒有拿到** —— 那一發 log 查詢帶了筆數上限 ⇒ 只斷言得了「不是每一發」 |
| 5 | `fetchVehicleTaxonomy` 的四個呼叫端 | 「零改動」已被 codex ④ 降級為**未核** | 到今天仍**未核**:`/cart` · `/account` · `/api/catalog/facet-counts` · `/api/search` ⇒ 動手前逐一開檔 |
| 6 | `revalidate` 的值 | `CATALOG_REVALIDATE_SECONDS = 60`(`products.ts:143`) | 那個座標是 09-06 的;而「60 秒是不是 miss 頻繁的原因」本檔列為候選、**沒查** |
| 7 | 並行 cold request 各自打 13 頁(single-flight) | codex ⑤ 提出, **沒量** | 本檔自己標它「與 `⟦search-TAXONOMYTIMEOUT⟧` 的 `57014` 可能是同一件事」⇒ 兩列可能是一件事 |
| 8 | `page.tsx:41` 還是不是 `force-dynamic` | codex ③ 引的座標 | 它決定**驗收要看哪一行** —— 不是 `cache=MISS`(恆 MISS、零判別力), 是 `[vehicleTaxonomy] cold` 那行有沒有消失 |
| 9 | §7.5 第 2 點交代的「另開一列給 `getCatalogPageCached` 的 2.68 MB」 | ✅ **2026-09-09 查了:開了, 而且已經 `done`** | 錨 `⟦search-CATALOGPAGE2MB⟧`(`docs/launch-todo.md:2462`)。shop 窗 09-09 量到正式站 3.3/4.5 MB ⇒ 0.68/0.60 MB, 且 `items over 2MB` 在現行兩個 production 部署上 **0 筆**(舊部署 7 筆 = 反方向對照)⇒ **那一支比本列先關掉了。** |

### 🛑 而讀這份 plan 的人最容易踩的一格

**§3 / §5 / §6.3 / §6.4 全部已被 §7 與 §8 取代, 而它們仍然寫在前面。**
⇒ 📌 **只讀到 §6 就開工的人, 會去實作三個【已經作廢】的候選(a / a′ / b′)。**
⇒ ✅ **今天唯一還站著的候選是 c′**(把車款樹移出 `/products` 的關鍵路徑)——
　 而它成立的理由與快取無關:**miss 的時候那 3–5.7 秒記在客人那一下點擊上。**

### ⚪ 我沒做什麼

- **一個數字都沒量**(主視窗交代:只列,不要開始)。
- 沒有判 c′ 對不對 —— 那要 #2 #4 #7 有讀數之後才談得上。
- 沒有動任何一行碼, 也沒有改本檔前八節的任何字面。
- 🔴 **而我寫這一節的時候踩過一次**:第一版用沒加引號的 heredoc 寫檔 ⇒ **反引號被 shell 當命令執行**
  ⇒ 表格裡的識別字被吃掉, 其中一格還被塞進 `cputime unlimited`(那是 shell 內建 `limit` 的輸出)。
  已 `git checkout -- <那一支>` 還原重寫。📌 **一份被寫壞的文件, 與一份寫得不好的文件, 在 diff 上長得一樣。**

---

## 10 · c′ 寫成可執行的(shop 2026-09-09 08:40 · **plan 階段, 一行 source 都沒動**)

> 🔴 **§3 / §5 / §6.3 / §6.4 全部已被 §7 §8 取代;§9 是要重量的前提。本節接在 §8.4 後面。**
> 🛑 鐵則 8:動 `/products` 與首頁的 server 資料層 = **所有客人**的路徑 ⇒ **提 plan 等批。**

### 10.1 今天的讀數(§9 那幾格量完了, 而它把受詞換掉)

量於 **今天 00:29 那一版 main**(`dpl_FQ9jtmbuM1R1o41JJ8c92qTTra59`), 16:30Z 起約 3 小時,
⚠️ **[09-09 08:5x 補]** 之後 production 又換過版(`dpl_D1eFSbUizHnLTLSBLS6RDqJ6VfGe`;同窗 `catalogRoute` 304 vs 51)
⇒ 🛑 **下面這組數是【那一版】上的, 不是現在線上那一版** —— 要當基線比對前先在現行部署上重跑一發。
Vercel `get_runtime_logs`:
```
[vehicleTaxonomy] cold 依 requestPath
  /                 130 次   ← 🔴 最大宗, 而它是客人進站的第一眼
  /products          14 次
  /products/[slug]   ~126 個網址, 各 1-2 次
首頁每發 0.86-1.2 秒 · 商品詳情頁 1.4-3.2 秒
🔴 單一請求印出 8-10 行 cold ⇒ single-flight 缺失(codex ⑤ 三天前預測過而沒有人量過)
🔴 兩個離群:53,896 ms(54 秒)· 592,962 ms(9 分 53 秒)
   ⚠️ 後者【未判】—— 可能是 serverless 行程凍結被算進 performance.now()
```
🛑 **分母未量** ⇒「每 ~84 秒一次」是**事件頻率**不是**多少比例的客人受影響**。**兩句不合成一句。**
🛑 而 84 與 `CATALOG_REVALIDATE_SECONDS = 60`(`products.ts:146`)接近 —— **接近不是因果**。

### 10.2 ⇒ 受詞換了:它不是「切分類慢」, 是【進站第一眼】

⛔ ~~本 plan 與 `search-CATSWITCHSLOW` 都把它描述成切分類~~
✅ **`/` 佔 130 / `/products` 佔 14** ⇒ 修法要對的是**首頁**那條路。
⚠️ **而「只改首頁」不夠 —— 見 10.3 訂正**(購物車也在等)。

### 10.3 c′ 具體是什麼 —— 🔴 **先訂正:呼叫點不是 3 個, 是 7 個**

⛔ ~~我第一版在本節寫了 3 個呼叫點, 而其中一個還寫成 `page.tsx:32`(那是 import 不是呼叫)~~
✅ 當場 grep 全 `apps/storefront/src`(排除 `.test.`)的結果, 逐條:

```
直接呼叫 tryVehicleTaxonomy()
  ① app/page.tsx:122                     首頁          ← 🔴 讀數 130 次那一格
  ② app/products/page.tsx:104            /products     ← 讀數 14 次
  ③ app/products/[slug]/page.tsx:217     商品詳情頁    ← 【有條件】hasVehicleParam || hasFitments 才叫
  ④ app/cart/page.tsx:29                 購物車        ← 🔴 我第一版整個漏掉
經 fetchVehicleTaxonomy()(它就是 tryVehicleTaxonomy 丟掉 failed, products.ts:1190-1192)
  ⑤ app/api/catalog/facet-counts/route.ts:69
  ⑥ app/account/vehicle/actions.ts:44    要登入
  ⑦ app/account/page.tsx:400             要登入
```

🛑 **而這一發也順手推翻了本檔 §9 #5 那一格** —— 它寫的四個呼叫端是
`/cart` · `/account` · `/api/catalog/facet-counts` · `/api/search`;
實查:**`/api/search` 一個字都沒有呼叫它**(`app/api/search/route.test.tsx:68` 的
`expect(tryVehicleTaxonomy).not.toHaveBeenCalled()` 是【前瞻守門】, 不是既有接線),
而 §9 #5 **漏掉了 `account/vehicle/actions.ts` 與 `products/[slug]`**。
📌 ⇒ **一份「要重量的前提」清單, 自己就是一個要重量的前提。**

### 10.3b ⇒ 修法的形狀跟著換

```
⛔ ~~「首頁不等它」~~ —— 那只治 ①, 而 ④ 購物車一樣在等
✅ c′ = 【把它從 server 端的 await 移到客人真的要用的時候】
   ①②④ 三個都是「渲染前先 await, 結果餵給車款下拉」⇒ 同一個形狀 ⇒ 一起改
   ③ 已經有條件了 ⇒ 先不動
   ⑤⑥⑦ 不在客人進站第一眼上(API / 要登入)⇒ 本片不碰
🛑 而【怎麼改】還沒定 —— 三個候選都沒查:
   甲 客戶端 fetch(開下拉才打)· 乙 Suspense 串流 · 丙 把那棵樹做成靜態產物
   ⇒ 這一題要 Sean 批了本節之後才開始查, 不在 plan 階段猜
```


### 10.4 影響面 / rollback

```
影響面  首頁 + /products + 購物車 的【載入時序】(=10.3 的 ①②④);車款下拉的載入時機
        ⚪ 不碰 ③ 商品詳情頁(已有條件)· ⑤⑥⑦(API / 要登入)
        ⚠️ 動 apps/storefront 的 server 資料層 ⇒ 鐵則 8;不動 packages/* ⇒ admin 不受影響
rollback  單顆 revert;無 DB、無 env、無對外副作用
代價     第一個打開車款下拉的客人要等(今天是【每一個】客人替他等)
```

### 10.5 驗收的尺(這一格照 §6.4 第 3 點, 不要換)

🔴 看 `[vehicleTaxonomy] cold` 那一行**在首頁的 requestPath 上有沒有消失/變少**,
**不是**看 `cache=MISS` —— `products/page.tsx:44` 仍是 `force-dynamic`(§9 #8 已確認)
⇒ 📌 **那格恆 MISS、零判別力。**
🟢 修前基線就是 10.1 那組數(帶量測環境與時點)。

#### 10.5b 🛑 而【不要】拿「57014 逾時有沒有變少」當驗收(2026-09-09 補, 而它是量到的)

同一族的兩支查詢(車款樹 / 推薦引擎)在 2026-09-02~09-06 各自噴 `57014` 然後**自己停了**,
而**推薦引擎那支從頭到尾沒有人改過碼**(`rule-based-engine.ts` 最後一次動 2026-08-18)。
`sync` 另量到那支查詢是 `Parallel Hash Anti Join · Workers Planned: 1`,
而 `max_parallel_workers = 2` ⇒ **平行 worker 拿不到就退化成序列跑** ⇒ 同碼同資料, 有時快有時不。
```
⇒ 一個「修後 0 筆」可以來自三個地方:①真的修好 ②worker 剛好夠 ③那條路沒被走到
⇒ 📌 修前修後各量一發比次數, 在【好】與【壞】兩個世界會印一樣的字
```
✅ **所以 10.5 那把尺要的是【結構性消失】不是【次數變少】**:
c′ 做完之後, 首頁的 requestPath 上**根本不應該再出現** `[vehicleTaxonomy] cold` ——
那不是機率問題, 是**那段碼不在那條路上了**。**次數從 130 掉到 0, 而不是掉到 40。**
📎 病史與三個候選 → 板列 `⟦search-TAXONOMYTIMEOUT⟧` / `⟦front-RECOENGINESTOPPED⟧`。

### 10.6 而 single-flight 是【另一件】, 不要合成一件

「單一請求印 8-10 行 cold」與「每 84 秒一次」是兩個病:
前者是**同一個請求內重複撈**, 後者是**快取過期頻率**。
🛑 **c′ 只治後者的暴露面(把它移出關鍵路徑), 不治前者。** 前者要 single-flight, 而那是另一片。

### 10.6b 🔴🔴 **而 c′ 的【好處】我證不到 —— 這一格要在 Sean 看到問題【之前】讀到**

開檔看首頁怎麼叫它(`apps/storefront/src/app/page.tsx:114-122`):
```
const [tier, featured, vehicleTax, categoryTax, garage, brandsWithProducts] =
  await Promise.all([ … tryVehicleTaxonomy() … ])   ← 六件並行
```
🛑 **`Promise.all` 等的是【最慢的那一件】, 不是總和** ⇒ 📌 **把車款樹拿掉, 只有在它就是最慢那一件的時候才省得到時間。**
⇒ 🔴 **而「它是不是最慢那一件」沒有人量過, 我也量不到** —— 首頁**沒有**逐項計時的儀器
　(`git grep 'homeRoute'` ⇒ 0;`/products` 那支 `[catalogRoute]` 是那一頁專有的)。

**🔵 而我手上唯一相關的讀數, 方向對 c′ 不利**:`/products` 那支儀器印過
```
tax=26  cats=11  brands=12  garage=2  page=3081  total=3107
```
⇒ 在那一頁, **車款樹是 26 毫秒, 而最慢的是 `page=` 的 3,081 毫秒** —— **它遠遠不是長桿。**
⚠️ **射程**:那是**快取命中**的那一發, 而 c′ 針對的是 **cold 的那 130 次**(862-1215 ms);
　 **cold 的時候別的五件多久, 一樣沒有人量過。**

**🛑 ⇒ 誠實的結論**:
```
✅ c′ 的【驗收尺】站得住 —— 結構性:cold 那一行會從首頁的 requestPath 消失(130 ⇒ 0)
   而它同時自帶反方向對照:那一行會改出現在【新的那條路】上, 不是整個不見
🔴 c′ 的【好處】站不住 —— 「客人會不會比較快」我答不了, 而它可能是【零】
🛑 兩件不可以合起來講:一個做得完、驗得到、而【可能沒有用】的修法, 仍然是可能沒有用
```
**⇒ 先決條件(比 §10.3b 那三個候選更前面)**:要嘛首頁補一支跟 `[catalogRoute]` 同形狀的逐項計時,
要嘛拿 Vercel 的 function duration 去對 cold / 非 cold 兩群。**兩件我都沒做, 而它們是【量】不是【修】。**

### 10.7 我沒做什麼

· **一行 source 都沒動。**
· **沒有查為什麼慢**(沒有 EXPLAIN, 也沒有正式庫存取)。
· 那 592,962 ms **未判** —— 要分辨得對照 Vercel 的 function duration, 我沒查。
· `/` 的請求數分母**未量** ⇒ 上面每一個「每 N 秒」都是事件頻率, 不是受影響比例。
· 🔴 **最重要的一件**:我**沒有**證明 c′ 會讓客人比較快(見 10.6b)——
　 端這一題給 Sean 的人**必須把 10.6b 一起端**, 否則他會以為這是一個「做了就會變快」的修法。

