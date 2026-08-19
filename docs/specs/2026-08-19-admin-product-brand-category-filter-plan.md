# 後台商品列表:品牌 / 分類 / 子分類篩選(plan,鐵則 8)

> **狀態**:待批准。**未動任何 code。**
> **來源**:Sean 2026-08-19 逐字「有看到商品的搜尋功能了,接下來就是篩選,要有品牌、分類、子分類等等」。
> **主視窗裁定(2026-08-19)**:①列表要不要顯示品牌欄 = **不問 Sean,一起做**(標準後台功能 + 他 08-18 常設令「不准做一半」)
> ②**本片排在 G3 的分頁片之後**(同一批檔) ③視覺真權威 = `docs/design/admin-design-system.md`(BMW M),而**最近的參照是現有 chips**。

---

## §0 ✅ 兩格都量到了(2026-08-19,Sean 本人在正式庫跑)

> 🔴 **不劃掉、把答案留著** —— 下一個人會想知道當時量到什麼,而「已解決」三個字答不出來。

```
第一發(填充率與基數)
   總數 20341 / 有品牌 20341 / 品牌數 16 / 有分類 20341 / 商品用到的分類數 81
   ⇒ ✅ **填充率 100%、零 NULL** —— 不是「幾乎空的下拉」,是滿的
   ⇒ ✅ 16 個品牌 ⇒ 下拉剛好(不必做搜尋式選擇器)

第二發(分類結構)
   分類總數 107 / 大類 29 / 子類 78 / **最深層數 = 2**
   ⇒ ✅ 兩層確認 ⇒ 大類 → 子類連動成立,**不做遞迴**
   ⇒ 🔴 而 107 − 81 = **26 個分類一件商品都沒有**(見 §0-d)
```
⚠️ **量測範圍**:正式庫、2026-08-19 上午、Sean 於 Supabase SQL Editor 執行並貼回。
   這些數字**會隨每日同步變動** —— 引用時帶著這一行,不要把它們當常數。

### §0-d 🔴 26 個空分類 ⇒ 下拉不列它們(主視窗 2026-08-19 裁定)

```
一個點下去是空的篩選選項,比沒有那個選項更糟 ——
它會讓員工以為「這個分類的商品不見了」,而那是一次假警報。
大類同理:底下子類全空且自身也沒商品 ⇒ 大類本身也不出現。
🔴 而那個集合【不得寫死】:今天 81,明天同步跑完可能是 83 ⇒ 一律從資料算。
```
· 落地:`product-taxonomy-options.ts` 的 `buildCategoryOptions(rows, idsWithProducts)`
  ——`idsWithProducts` 是**參數不是常數**,由呼叫端查。
· ⚠️ **效能未量**:那是每次開頁都要算的東西。若量出來慢 ⇒ **回報,不自己加快取**
  (快取是另一片、另一個失效面)。

📌 **而當時我寫的是**:「現有 migration 裡看得到的字面全是兩層,**而那是樣本不是全集**」——
⇒ ✅ 量完是 2,**猜對了**。而**猜對不等於量到**:在數字回來之前,§3 的 UI 那格確實不能定案。

⚠️ 另記一條**過期註解**(不在本片範圍,只標明):
`apps/storefront/src/lib/category-taxonomy.ts:10-11` 逐字「目前真分類為**單層**
(16 大類 + 碳纖維部品、parentId 全 null、**無子類**)」—— 那是 2026-07 的字面,**現在 78 個子類**。
而它就在「怎麼建分類樹」那支檔的檔頭 ⇒ **下一個做分類的人一定會讀到。**

---

## §0-c 🔴 而 backlog 有一條【看起來否決本片】的紀錄 —— 而它可能已經過期

```
docs/phase-1-backlog.md:4474(`#152` 狀態欄)逐字:
   「**category 部分仍 ⏳**(單一分類「碳纖維部品」、分類樹無意義、多分類上架 #212 後再議)」
```
🔴 **若照它字面讀,這片不該開** —— 分類樹沒意義,做篩選器等於做一個只有一格的下拉。

⚠️ **而那句寫於【只有一家供應商上架】的時候**(RPM Carbon,`categoryStrategy=fixed '碳纖維部品'`)。
現在量到的:
```
scripts/supplier-config.ts:  grep -c 'brandSlug:'          ⇒ **17 家**
                             categoryStrategy kind 分布    ⇒ fixed **2** / per-group **16**
   而 per-group 的定義(`:32` 逐字)=「逐群依來源 major_category_zh 對應 **16 大類**」
```
⇒ 📌 **17 家裡有 16 家是「依來源分類逐群對應」** ⇒ 那句「單一分類」在設定層面上已經不成立。

🔴 **而「設定層不成立」≠「資料層有值」** —— 設定寫了不代表跑過、跑了不代表填滿。
⇒ ⇒ **這正是 §0-a 那發查詢要答的**,而現在多一個具體的判準:
```
若 count(distinct category_id) 仍是 1 或 2  ⇒ #152 那句仍然成立 ⇒ **這片不該開**
若明顯多於供應商數                          ⇒ #152 那句已過期 ⇒ **回頭把那條 backlog 修掉**
```
⚠️ 而**不論結果如何,`#152:4474` 那一行都要被處理** —— 它現在是一條會讓下一個人
直接放棄這件事的紀錄,而**沒有人會知道它是哪一年的**。

---

## §1 為什麼(動機)

- 商品列表目前**只有兩種收斂手段**:三顆 chips(全部/手動/自動)與關鍵字搜尋。
  ⇒ 數法:`apps/admin/src/lib/products/product-list-view.ts:29-34` 的 `AdminProductFilter` **只有兩個欄位**
     (`setBy` / `keyword`)—— 那個 interface 就是這一頁全部的篩選軸。
  ⚠️ 「20,341 件」這個數字**我沒有量過** —— 它是 `product-repository.ts:220` **註解裡的字面**(註解會過期)。
     真值等 §0-a 那發查詢。
- 品牌與分類是**員工找一批商品時最自然的兩個軸**(「Akrapovic 的全部」/「排氣管的全部」),
  而那兩個欄位**在 DB 裡已經是一級公民**(見 §2)。
- 🔴 **這不是新功能設計,是搬運**:顧客站已經把同一件事做完並走過同一條坑
  (client 過濾 → 下推 DB),見 §2-c。

## §2 現況(每條附 `檔案:行號`;**未量到的在 §0 與 §7,不在本節**)

### 2-a 資料層 —— 欄位在,索引在,階層在
```
supabase/migrations/20260507004826_init_products.sql:35-36
   brand_id     uuid REFERENCES brands(id)     ON DELETE RESTRICT
   category_id  uuid REFERENCES categories(id) ON DELETE RESTRICT
:59-60  idx_products_brand_id / idx_products_category_id

supabase/migrations/20260505130758_init_brands_categories.sql:38-47
   parent_category_id uuid REFERENCES categories(id)      ← 自參照(樹)
   raw_path  text UNIQUE   例 '引擎部品 · 排氣管'(註解逐字:「design 字面」)
   segments  jsonb         例 ["引擎部品","排氣管"]
   sort_order integer
:121 idx_categories_parent_category_id
```
⇒ 🔴 **`raw_path` 一個欄位就同時表達得了「大類」與「大類+子類」** ⇒ 後台不必自己遞迴建樹。

### 2-b 後台已經在 DB 端篩(所以加軸是同一個 pattern)
```
apps/admin/src/lib/products/product-repository.ts:215-222
   if (setBy)   q = q.eq('listing_set_by', setBy);
   if (keyword) q = q.or(buildProductKeywordOrFilter(keyword));
:211 檔頭逐字:「🔴 篩選一定要走 DB,不能在頁面上過濾陣列」
   (理由同段寫著:`.range()` 是先分頁再回列 ⇒ client 過濾只會過濾「這一頁」,
    而 count 仍是全表數 ⇒ 「共 20,341 件」配一頁 3 筆)
```
```
apps/admin/src/lib/products/product-repository.ts:289-305
   getProductTaxonomyNames() 已經在讀 brands / categories 兩張表(逐筆 .eq('id', …))
   ⇒ 下拉選項的資料來源【已經有現成函式】,只要從「單筆」擴成「撈全表」
```
```
apps/admin/src/lib/products/product-repository.ts:55-56
   PRODUCT_LIST_COLUMNS = 'id, title, external_id, price_general, delisted_at,
                           listing_set_by, source_missing_at'
   🔴 **列表現在沒有撈品牌名/分類名** ⇒ 要顯示就要加(見 §3-③)
```

### 2-c 顧客站的先例(這片是「照著再做一次」的依據)
```
apps/storefront/src/components/products-filter-logic.ts:76-113
   filterProducts 的全部條件 = category / brand / inStock / isNew / isSale / colors / price
   ⇒ 🔴 **沒有一條需要前端狀態、算出來的欄位或跨表 join** ⇒ 全部翻得成 SQL
:92-97 逐字:「vehicle 不再 client 過濾 —— 車款篩選已下推 DB」
   ⇒ 🔴 **顧客站自己走過這條路**:同樣的「client 過濾只過濾當頁」問題,他們的解法是下推
:18 CATEGORY_PATH_SEP = ' · ';:63-74 matchesCategory
   子類 ⇒ 比對 `${main} · ${sub}` 全等;大類 ⇒ 比對前綴 `${main} · `
```
⚠️ **而顧客站那支 RPC 不能直接拿來用**:
`apps/storefront/src/lib/vehicle-facet-counts.ts:197` 叫的 `search_catalog_by_vehicle`
(`supabase/migrations/20260719150000_catalog_product_image_trim.sql:73-84`,已收
`p_category` / `p_brand_slugs` / 價格 / 排序 / 分頁 / `total`,且 `:204` GRANT 給 `service_role`)
**讀的是公開 view `products_list_public`** ⇒ 後台要看的是**含已下架的全部**。
🔴 **拿它當捷徑,後台會看不到下架商品,而且不會報錯。** ⇒ 可重用的是**形狀**,不是那支函式。

### 2-d 現有 UI 的語言(新元件要跟它同語言,不自創)
```
apps/admin/src/components/products/product-filter-chips.tsx:11-19 檔頭逐字三件:
   ①`.fchip` 樣式類別 ②零 JS 的 `<Link>` ③**選中態靠網址不靠 state**
:20 `page` 固定回 1(換篩選卻停在第 3 頁會直接看到空白頁)
:29 文案為 Sean 2026-08-15 拍板字面,不得自行改寫
⇒ 而它同段還寫了一句要繼承的紀律:**「不是重用元件,是照抄做法」**(避免為兩顆 chip 抽共用元件)
```

---

## §3 要改什麼(逐支)

> **前置**:本片**接在 G3 的商品頁分頁片之後**。兩片動同一批檔(`product-repository.ts` 的 `.range()`、
> `products-table.tsx`)⇒ 🔴 **不並行**。G3 收工後我從它的 HEAD 起手。

| # | 檔案 | 改什麼 | 驗收(可 yes/no) |
|---|---|---|---|
| ① | `apps/admin/src/lib/products/product-repository.ts` | `listProductsForAdmin` 加兩個選填參數 `brandId?` / `categoryPath?`;照 `:215` 的 pattern 加 `q.eq('brand_id', …)`;分類走 `categories` 的 `raw_path` → 先解出 id 集合再 `q.in('category_id', …)`(大類 = 前綴命中多個子類) | 帶 brandId 查 ⇒ 回傳列全部同品牌;帶大類 ⇒ 子類商品也在內;`total` 是**篩選後**的數不是全表數 |
| ② | 同上 | `getProductTaxonomyNames` 旁新增 `listBrandOptions()` / `listCategoryOptions()`(撈全表 `id, name` / `id, raw_path, parent_category_id`,依 `sort_order`) | 兩支各自回非空陣列;分類依 `sort_order` 排 |
| ③ | 同上 `:55-56` | `PRODUCT_LIST_COLUMNS` 加品牌/分類名 —— **走 PostgREST 關聯選取**(`brands(name), categories(raw_path)`),不做第二發 N+1 查詢 | 列表一列拿得到品牌名;查詢發數**不隨列數增加**(讀 code 可判) |
| ④ | `apps/admin/src/components/products/products-table.tsx` | 加「品牌」欄(位置與寬度照 `admin-design-system.md`) | 表頭有品牌;空值顯示為 `—` 不是空白 |
| ⑤ | 新檔 `apps/admin/src/components/products/product-taxonomy-filter.tsx` | 兩顆下拉(品牌 / 分類);分類選了大類 ⇒ 子類下拉才出現。**照 2-d 三件**:`.fchip` 同語言、零 JS `<Link>`(下拉用原生 `<select>` + form GET,或 Link 列表)、選中態靠網址、`page` 回 1 | 不用 JS 也能操作;重新整理後選中態還在;換篩選後在第 1 頁 |
| ⑥ | `apps/admin/src/app/products/page.tsx` | `searchParams` 解出兩個新參數並傳給 repo(照 `:35-44` 現有 `filter` 的做法);零結果文案照 `:98-100` 的句型延伸 | 網址帶參數直接開得起來;零結果時文案講得出「哪個條件沒東西」 |
| ⑦ | `apps/admin/src/lib/products/product-list-view.ts` | `AdminProductFilter` 加兩欄;`buildProductListHrefResetPage` 帶上新參數 | 換 chips 不會把品牌/分類選擇弄丟 |
| ⑧ | 測試 | ①②③ 各補單元測試;⑤⑥ 補 smoke test(`*.test.tsx`) | `TURBO_FORCE=1 pnpm test` 綠 |

## §4 預期影響面

```
· 只動 apps/admin —— 顧客站零改動(不共用元件、不改 packages/ui)
· 零 migration、零 schema 改動、零 RLS 改動 —— 欄位與索引都已存在
· 讀取路徑用的是既有 service client(`createSupabaseServiceClient`),不新增權限面
· 🔴 鐵則 12 逐條核:①錢 ✗ ②權限 ✗ ③DB 結構/大量寫入 ✗(純讀)④平台設定 ✗
  ⑤對外不可回收 ✗ ⑥packages/ui 行為 ✗  ⇒ **不觸發強制對抗審查**
  ⚠️ 而**標準片**(動 3+ 檔)⇒ 走 9 步 SOP、code-reviewer 必跑
· 效能:`brand_id` / `category_id` 都有索引;分類大類命中要先解 id 集合 ⇒ 多一發小查詢
  (categories 表是小表;若量到慢再考慮用 `raw_path` 前綴直接 join)
```

## §5 Rollback

```
· 純前端/查詢層改動,無資料遷移 ⇒ rollback = revert 那一顆 commit
· 而【部分失敗】的形狀要先想清楚:若只回退 ⑤⑥(UI)而留下 ①②③,
  後台仍可用網址參數篩選 ⇒ 不會壞,只是沒有入口
· 🔴 而③(加欄位到 select)若回退,④的品牌欄會拿到 undefined ⇒ **③④要一起 revert**
```

## §6 這片【不做】什麼(避免範圍擴張)

```
· 不做價格區間 / 上下架狀態以外的軸(顧客站有 colors / isNew / isSale,後台沒要求)
· 不抽共用篩選元件到 packages/ui(YAGNI;理由同 2-d 檔頭那段)
· 不動顧客站
· 不碰 search_catalog_by_vehicle(見 2-c 的警告)
· 🔴 **不做「每個分類旁邊顯示件數」** —— 那是 facet counts(顧客站有,而它是另一個量級)
  ⇒ 明寫在這裡,免得下一輪有人以為漏了。**「只列有商品的」與「顯示件數」是兩件事。**
```

## §7 未確認清單(**開工前要關掉的,不是可以帶著上路的**)

```
✅ ① 填充率 —— 已量(§0),100% 零 NULL
✅ ② 分類層數 —— 已量(§0),2 層
✅ ③ 品牌基數 —— 已量(§0),16 個 ⇒ 下拉即可
⏳ ④ G3 分頁片的收工 HEAD —— **仍在等**,本片從那裡起手
⏳ ⑤ 🔴 **「有商品的分類」怎麼查、以及它多慢** —— 未量。
   候選:PostgREST 嵌入式聚合 `categories?select=…,products(count)` 一發解決,
   **而 repo 內零先例**(`git grep '(count)'` 只撈到 `count: 'exact', head: true` 那種)
   ⇒ 🔴 **那是「我以為它支援」,不是量到的** ⇒ 接線前要實跑一次才算數
```
