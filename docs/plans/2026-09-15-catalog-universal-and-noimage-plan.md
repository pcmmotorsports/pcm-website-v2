# 2026-09-15 · 目錄頁:選車也列通用款(Q8)+ 無圖排最後(Q9)—— plan v2(實作 + 驗證結果)

> A 窗寫。主視窗 b7 轉 Sean 22:4x 拍板:**Q8 甲**(客人選了車,也列出通用款)、**Q9 甲**(沒有圖片的商品排到最後)。
> 版本號 **20260916120000**(主視窗指定)。動 schema / 函式 ⇒ 鐵則 8,本檔先寫,實作跟在同分支。
> 🔴 不碰 `storefront_search_product_ids`(施工窗 110000)。

## 1. 白話

- **Q8**:今天客人選了「Ducati Panigale V4」,列表只出現標了這台車的商品;沒綁任何車型的「通用款」(後照鏡、手套、清潔用品…)一件都不會出現。
  改完:**先列這台車專用的,後面接通用款**。
- **Q9**:今天沒有照片的商品(顯示「暫無照片」那張灰圖)跟有照片的混在一起。
  改完:**同一個排序裡,有照片的都排在沒照片的前面**。
- 客人看得到的副作用:選了車以後「共 N 件」會變大(多出通用款,最多約 5,657 件);第一頁仍是這台車專用的。

## 2. 現況(唯讀量,出處在後)

| # | 事實 | 出處 |
|---|---|---|
| H1 | 列表函式 `search_catalog_by_vehicle` 最新一代 `20260909070000:266`;經銷版 `_dealer` 同檔 `:705`,差別只有 SECURITY DEFINER + tier 閘 + 讀 `products_list_dealer` | `bash scripts/latest-definition-of.sh …`、兩段本體 diff |
| H2 | 選車分支:`matched` = `product_fitments` ∪ `product_fitments_effective`,再 `JOIN matched` ⇒ 只剩有車型列的商品;沒選車分支不看 fitments | 同上 |
| H3 | 「通用款」既有定義 = `products.fitments = '[]'`(`IProductRepository.listGeneral`、`fitment-queries.ts:90`;Sean 2026-07-08:fitments 非空但元素髒的 9 筆 gbracing **不算**通用)。正式庫 **5,657** 件 | 正式庫唯讀 count |
| H4 | 兩種定義不完全重疊:`fitments='[]'` 但**有**車型列 21 件;`fitments` 非空但**沒有**車型列 58 件 | 同上 |
| H5 | 「沒有真圖」既有判準 = `packages/domain/src/catalog/supplier-placeholder.ts` 的 `hasNoRealImage(card_image)`:null / 空白、`quote.pcmmotorsports.com/no-photo.png`、7 組供應商佔位圖(host + 檔名前綴)。目錄頁在 TS 端換成站內佔位圖(`catalog-page.ts:166`) | repo |
| H6 | 正式庫卡片首圖:null/空白 1、PCM no-photo 638、供應商佔位圖 651 ⇒ **約 1,290 件**會被排到後面 | 正式庫唯讀 count(SQL 仿 TS 規則) |
| H7 | 側欄件數 `catalog_facet_counts`(`20260912010000`)的 `matched` 是從列表**抄**的;`facet-predicate-parity.test.ts` 釘兩支同一段字面 | repo |

## 3. 改什麼(預設值;§5 待決題答了會改)

### 3-1 列表兩支(公開 + 經銷,同一組改動)
- **選車分支** `filtered` 改成兩塊 `UNION ALL`:
  - 專用塊:`JOIN matched`,`fit_rank = 0`
  - 通用塊:`p.fitments = '[]'::jsonb AND NOT EXISTS (matched 裡有它)`,`fit_rank = 1`(H4 那 21 件只算一次,算在專用)
  - 🔴 **不用 `p.id IN (matched) OR p.fitments = '[]'`**:plpgsql 的 `RETURN QUERY` 走 plan cache,前幾次是 custom plan;P3 量過同形的 OR + IN 在 custom plan 下 Ducati > 60 秒(catalog-timeout plan §P3 F7)。
- **兩個分支都加** `no_img`(0 = 有真圖、1 = 沒有),用新 helper `public.pcm_card_image_is_placeholder(text)`(IMMUTABLE,本體 = H5 規則的 SQL 版)。
- **排序鍵順序**(內層 `paged` 與外層 SELECT 都要一樣,20260909070000 事後閘②b 那一課):
  1. 關鍵字完全命中(既有,只在 recommend + 有關鍵字)
  2. `fit_rank`(只在選車分支)
  3. `no_img`
  4. 既有的 recommend / price-asc / price-desc / new 鍵
  5. `id`
- `total` 照舊 `count(*) OVER ()` ⇒ 含通用款。

### 3-2 側欄件數 `catalog_facet_counts`
- 選車時也算通用款:`WHERE p_brand IS NULL OR p.id IN (matched) OR p.fitments = '[]'`。
  - 這支是 LANGUAGE sql ⇒ PG17 走 generic plan(P3 F2 證實)⇒ hashed SubPlan,OR 不會掉進 custom plan 那個坑。
  - ⚠️ PG18 天花板同 P3 §7。
- 無圖不影響件數(只影響排序)。

### 3-3 helper 與測試
- `pcm_card_image_is_placeholder(text)`:新物件 ⇒ 兩道 REVOKE + GRANT EXECUTE anon / authenticated / service_role(公開那支是 INVOKER,呼叫者要叫得動它;pattern §3.1)。
- 新測試:讀 migration 裡 helper 的規則表,與 `SUPPLIER_PLACEHOLDERS` + `PCM_OWN_NO_PHOTO_CARD` 逐組比對 ⇒ TS 那份加一組而 SQL 沒加 ⇒ 紅。
- `facet-predicate-parity.test.ts`:SHARED 加一段「通用款」字面,兩支都要有。

## 4. 驗證
- 拋棄式 PG:schema dump + 板 178–191 + 本檔;種子含專用 / 通用 / 21 件那種兩邊都算 / 無圖 / 供應商佔位圖。
- 改前改後逐列比對:沒選車時**集合相同**(只有順序因無圖改變);選車時 = 改前集合 ∪ 通用款;每頁內順序符合 §3-1 鍵序;側欄件數 = 點進去的 total。
- 正式庫唯讀 EXPLAIN(10s 上限、generic 形):Ducati / Yamaha / 沒車 × recommend / price-asc。
- adversarial-reviewer(opus;缺 codex 那一路)。

## 5. 待決題 —— ✅ Sean 2026-09-15 三題全答甲(主視窗轉逐字:「A: 甲 = 是」「A: 甲 = 是」「A: 甲 = 算」),與實作預設相同

```
Q8-1:選了車,用「價格低到高 / 高到低 / 最新」排序時,通用款也要排在專用的後面嗎?
A: 甲(推薦)是 —— 任何排序都是「專用在前、通用在後」,各自內部照價格 / 新舊排
A: 乙 不要 —— 只有「推薦」排序分前後;按價格排時通用款跟專用混在一起比價格
```

```
Q9-1:沒照片的商品,在「價格排序」「最新」也排最後嗎?
A: 甲(推薦)是 —— 所有排序都是有照片的在前
A: 乙 只有「推薦」排序才把沒照片的放後面
```

```
Q8-2:選了車,「共 N 件」要不要把通用款算進去?
A: 甲(推薦)算 —— 側欄件數、分頁、「共 N 件」都含通用款,跟點進去看到的一致
A: 乙 不算 —— 只算專用的(要另外改分頁邏輯,通用款接在最後一頁後面)
```

## 4-1 驗證結果(2026-09-15 晚)
- 抽出的三支原本體 prosrc md5 = 正式庫(`1757ca8b…` 公開 / `eaee6f2f…` 經銷 / `aae85942…` 件數)⇒ 退回檔還原的就是正式庫現況。
- 拋棄式 PG a130(dump + 板 178–191,187 已知前置閘紅)+ 合成種子(26,491 商品、2,967 通用款、24 件 fitments=[] 但有車型列、5,568 件無真圖):
  - 貼上事後閘全過(行為格:車 Ducati/M11 total 7,957 = 專用∪通用款 = 側欄品牌件數總和)
  - 重貼被前置閘一擋;還原後三支 md5 回原值、helper 消失;還原可重跑;還原後可重貼
  - 突變「經銷那支漏一個 `pg.no_img ASC`」⇒ 事後閘③c 擋、整支回滾
- 改前 / 改後逐項:沒選車 total 26,491 → 26,491;側欄件數(沒選車)140 列逐列相同;選車 Ducati 4,995 → 7,957(+2,962 = 通用款 2,967 − 已在 matched 5);第一頁鍵序 fit_rank → no_img 正確、群內價格序正確;沒選車 price-asc 名次 20,824–20,923 無圖 0 件、20,924 起是無圖;Ducati price-asc 尾頁 50 件全是通用款 + 無圖。
- vitest:`card-image-placeholder-sql-parity.test.ts`(新)+ `facet-predicate-parity.test.ts`(加一格)50 綠。
- 正式庫唯讀 EXPLAIN(10s 上限;kw CTE 換空集合,因唯讀角色無 `storefront_search_product_ids` 執行權,量的是不帶關鍵字):

| 形 | 舊 | 新 |
|---|---|---|
| Ducati recommend(熱,generic / custom) | 413 / 391ms | 670 / 651ms |
| Ducati price-asc(熱,generic) | 569ms | 916–948ms |
| Ducati recommend 冷快取第一發(generic) | —(未量) | 3,900ms,其中 matched 3,427ms(舊就有的那段) |
| Yamaha recommend(generic / custom) | — | 1,047 / 512ms |
| Honda new(generic / custom) | — | 623 / 468ms |

  ⇒ 熱快取多 250–380ms(多 5.6k 列進排序,排序溢到磁碟 5.6MB);最大車廠仍約 3 倍在 anon 3s 內。冷快取的 3.4s 是 matched(舊就有,P3 同一段)。

## 4-2 審查(adversarial-reviewer opus;缺 codex 那一路)
- **R1 FAIL,三條 must-fix 已修**:
  1. `sort_rn` 的 `PARTITION BY` 沒含 `fit_rank` / `no_img` ⇒ 推薦排序「各大類輪流上第一頁」會被打亂 ⇒ 8 處分區前面加 `f.fit_rank, f.no_img`。驗:第一頁相異大類數改前 = 改後(七種形)。
  2. helper 用 `concat`(STABLE)⇒ 不 inline ⇒ 改成只用 `IS NULL` / `~` / `~*`。驗:`EXPLAIN VERBOSE` 輸出不含 helper 名。
  3. 事後閘④a 裸寫 `fitments='[]' OR p.id IN (…)`(P3 F7 同形)⇒ 改兩塊 id `UNION` 再 count。
  - nits 已處理:退回檔加前置閘(釘 120000 那一代 md5 ⇒ 不能重跑);空白判斷改 `~ '^[[:space:]]*$'`。
- **效能再修**:helper 從「substring × 2 + regexp_replace + lower × 2」改成**一條不分大小寫的整網址 regex**(本機 118,807 組網址兩種寫法答案全同;拋棄式 PG 兩版 dump 1,081 列逐列相同)。
  正式庫唯讀 generic 形、熱快取:沒選車推薦 舊 443–452ms → 三步版 877–892 → **單一 regex 版 734–744ms**;Ducati 推薦 舊 493–542 → **653–663ms**。
- **R2 PASS**(無 must-fix)。nits:
  - 單一 regex 與 TS `new URL()` 仍有邊角差(前後空白、反斜線、`https:host`、`%61` 編碼 host、非數字 port…)⇒ 只影響那種網址的**排序位置**,不少商品不錯價;正式庫有沒有這種資料未查。
  - 事後閘④b 原本用 `fitments='[]'` 判第一名是不是通用款 ⇒ 會被 H4 那 21 件誤報 ⇒ **已改成看車型列**。正式庫唯讀:閘選到的車(Yamaha YZF-R1)H4 件數 0。
  - 事後閘④c 品牌件數加總算不到 brand_slug NULL ⇒ 正式庫唯讀 0 件 ⇒ 不會誤報。
- 三綠 + `pnpm test` 999 檔 / 18,665 格綠(含 `scripts/sql-ts-literal-binding.test.ts` P6:照檔內程序加候選 + live、UNION 切法收窄到 matched CTE)。

## 6. 影響 / rollback
- 影響:`/products`、品牌頁、搜尋結果頁(同一支 RPC);經銷會員同步。首頁「最新商品」那排已在 TS 端挑有圖的,不受影響。
- 鎖:三支 `CREATE OR REPLACE FUNCTION` + 一支新 helper,不動表。
- Rollback:`supabase/rollbacks/20260916120000-rollback.sql` = 三支函式回 20260909070000 / 20260912010000 本體 + DROP helper(順序:先換回函式再 DROP helper)。
