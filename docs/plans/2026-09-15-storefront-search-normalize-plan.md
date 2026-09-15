# Plan · 前台搜尋:車款代號與變音符號「折成同一個形狀」再比

> **一句話**:客人打 `MT07` 只找到 30 件、實際有 154 件;打 `AKRAPOVIČ` 只找到 194 件、實際 670 件。
> 原因是搜尋函式只做「字面子字串」,而資料寫 `MT-07`、`S 1000 RR`、`Akrapovic`。
> 修法:比對前把兩邊的空白、連字號、點、變音符號都去掉(`MT07 = MT-07 = MT 07`),再加一支索引讓它不變慢。
>
> - 🛑 **本 plan 一個字都還沒動碼、沒動資料庫。** Sean 還沒看過。
> - 這是**改資料庫函式 + 新索引**:鐵則 8(先 plan)+ 鐵則 12(migration 要審)。
> - 寫的人:施工窗,2026-09-15 晚,基底 origin/dev `25ccd7681`。
> - 前情:`~/pcm-mailbox/搜尋抽查-0915.md`(20 詞抽查)。

---

## 要 Sean 答的題(答案會改方向的排前面)

```
Q1:搜尋「折成同一個形狀再比」這份 plan 批不批?
A: 甲(推薦)批 —— 照 §1–§6 做,migration 過審查、拋棄式 PG 驗 20 詞,再挑客人少的時段貼
   乙 先不做 —— 維持現況(MT07 / S1000RR / AKRAPOVIČ 這類詞繼續少找到七到八成)

Q2:搜尋結果要不要照「像不像」排前面?(§3,可以跟 Q1 分開答)
A: 甲 維持現況 —— 料號完全相符的置頂,其餘順序等於隨機
   乙(推薦)加分級 —— 料號完全相符 > 整串吻合商品名 > 品牌名吻合 > 商品名吻合 > 副標 / 描述吻合
   丙 用相似度分數排 —— 最準,但每次搜尋都要算分數,慢,先不建議

Q3:「阿卡」要不要當 Akrapovic 的暱稱收進搜尋字典?
A: 甲 收 —— 字典加一列(只改前台一支資料檔),打「阿卡」就列 Akrapovic 全品牌
   乙(推薦)先不收 —— 先請客服確認台灣車友真的這樣叫,再收
```

---

## 1. 改什麼

### 1-1 現況(正式庫唯讀讀出來的)
- 函式 `public.storefront_search_product_ids(p_terms text[])`,正式庫定義與 repo 最後一代 `20260911150000_m4b_search_ids_definer_uses_indexes.sql` 相同。
- 比對方式:每個詞做 `ILIKE %詞%`,**每個詞都要中**(AND)。
- 比的欄位有五組:
  - title / subtitle / description / external_id
  - 品牌名
  - 料號去符號後的前綴
  - 變體 sku 去符號後包含(含數字的詞)
  - 變體 sku 去符號後相等(不含數字的詞)
- 正式庫 extension:`pg_trgm 1.6` 已裝;`unaccent 1.1` 可裝未裝;`pgroonga 3.2.5` 可裝未裝。
- products 上已有的索引:title / subtitle / description / external_id 的 trigram GIN,external_id 去符號 btree;變體 sku 去符號 btree + trigram GIN。

### 1-2 新增三樣東西(函式簽章不變)
1. **一支折疊函式** `public.pcm_search_fold(text) RETURNS text IMMUTABLE`:
   `lower(regexp_replace(translate(coalesce($1,''), <變音字元表>, <對應 ASCII>), '[[:space:]._/·-]+', '', 'g'))`
   - 去掉空白、點、底線、斜線、`·`、連字號,轉小寫,Č→C、Ö→O…
   - 🔴 **不剝中文**:regexp 只拿掉那幾種符號,`排氣管` 折完還是 `排氣管`。
     前例是 `search-terms-fold.ts` 檔頭記過的坑:剝光中文 ⇒ 空字串 ⇒ `LIKE '%%'` 命中全表。
   - **用 `translate` 不用 `unaccent`**:`unaccent()` 是 STABLE,不能直接放進索引運算式,要包 wrapper;還要多裝一個 extension。
     `translate` 是 IMMUTABLE,字表寫死、看得見。
     代價:只折表上列出來的字元。字表先涵蓋西歐常見的 Àá…Čč Šš Žž Ññ Öö Üü,品牌名裡的都在內。
2. **一支索引** `products_search_fold_trgm_idx`:
   `GIN (pcm_search_fold(coalesce(title,'') || ' ' || coalesce(subtitle,'')) gin_trgm_ops)`
3. **函式本體改兩件**:
   - **(a) 新比對分支**:詞含英文或數字時,`pcm_search_fold(title || ' ' || subtitle) LIKE '%' || pcm_search_fold(詞) || '%'`。
     品牌名同樣折疊比(品牌表很小,不需要索引)。
     純中文的詞**不走這條**:折疊對它沒有差別,走既有 title trigram 索引,不多付成本。
   - **(b) 整串優先**:客人打了兩個詞以上時,先把整串折成一個詞比一次(`S 1000 RR` ⇒ `s1000rr`)。
     - 整串有中 ⇒ 只回整串中的那批。
     - 整串沒中 ⇒ 照舊逐詞 AND。
     - 例:`Z900 腳踏後移` 整串不會中,退回兩詞 AND,行為不變。
4. **守門照舊、加一條**:詞折完變空字串(例如只打 `-` 或 `.`)⇒ 丟掉那個詞。
   跟既有 `btrim(term) <> ''` 同理,不然 `%%` 會命中全表。

### 1-3 不改的
- 回傳型別 `(id uuid, is_exact boolean)`、SECURITY DEFINER、`SET search_path TO ''`、下架過濾(7 處)、權限名單。
- 料號 / 變體 sku 那三個分支原封不動。
- 前台 TS 一行都不用改:`searchByKeyword` 傳的還是同一個 `p_terms`。

## 2. 速度(先量才選)

### 2-1 正式庫唯讀 `EXPLAIN (ANALYZE, BUFFERS)`(pcm_readonly;函式本體改寫成查詢跑,5 詞)

| 詞 | 現行函式 | 折疊版(沒有新索引,全表掃) | 折疊版件數 |
|---|---|---|---|
| MT07 | 99.7 ms | 467.2 ms | 149 |
| S1000RR | 95.8 ms | 467.2 ms | 517 |
| AKRAPOVIČ | 9.0 ms | 489.8 ms | 651 |
| 排氣管 | 9.8 ms | 466.4 ms | 893 |
| RZ-127-182 | 116.4 ms | (料號分支不變,不量) | — |

- 現行函式快,是因為走 title / subtitle / description / external_id 的 trigram 索引。
- 還在全表掃的是料號前綴那段(`Seq Scan on products p_2`,20–30 ms)。
- **折疊版沒有索引時,每個詞 +約 470 ms**(26,491 列全掃)。
  而 `/products?search=` 那條路也會呼叫同一支函式,等於在 A 窗正在處理的型錄逾時上**再加半秒** ⇒ **不能不加索引就上。**
- ⚠️ `pcm_readonly` 是 `rolbypassrls = t`。函式是 SECURITY DEFINER(同樣不受 RLS 管),所以這組數字與客人那條路可比。

### 2-2 加索引之後(拋棄式 PG,**假資料**)
- 正式庫唯讀 session `default_transaction_read_only = on`,建不了索引 ⇒ 改在拋棄式 PG 量。
  用 `~/pcm-mailbox/schema-dump-20260915/up.sh`(正式庫 schema、零資料)建一張 25,402 列的假表。

| 詞 | 無新索引(全掃) | 有 `products_search_fold_trgm_idx` |
|---|---|---|
| mt07 | 73.8 ms | **9.7 ms**(Bitmap Index Scan on products_search_fold_trgm_idx) |
| s1000rr | — | **10.5 ms** |
| akrapovic | — | **6.9 ms** |
| 排氣管 | 76.0 ms | 76.0 ms(沒用到索引,見下方射程) |

索引大小 2,184 kB,表 2,720 kB(假資料)。

**射程(不要讀寬)**:
- 假資料每詞命中 2,000–3,000 列,正式庫是 149–651 列 ⇒ 毫秒只看「有索引 vs 全掃」的比例。
- 拋棄式 PG 是 `locale C`,trigram 認不得中文字 ⇒ `排氣管` 那列不代表正式庫。正式庫 `en_US.UTF-8`,既有 title trigram 索引對中文有效(§2-1 `排氣管` 走索引 9.8 ms)。§1-2 (a) 刻意讓純中文詞不走折疊分支。
- **貼上正式庫之後要再量一次**:同 5 詞 `EXPLAIN ANALYZE`,驗 (1) 用到新索引 (2) 每詞 < 現行 + 30 ms。

### 2-3 建索引的鎖
- 26k 列,一般 `CREATE INDEX`(migration 在交易裡,不能 CONCURRENTLY)會擋 products 寫入幾秒。
- ⇒ 避開客人多的時段,也避開供應商同步(每天約 09:31–09:53 UTC,A 窗量的)。
- migration 帶 `SET LOCAL lock_timeout = '5s'`,拿不到鎖就失敗,不排隊擋站。

## 3. 相關度排序(選配;Q2 要 Sean 答)
- 現況:`ORDER BY is_exact DESC, h.id` ⇒ 料號完全相符的置頂,其餘照 uuid 排 = 等於隨機(抽查 `排氣管` 第一筆是 DBK 品牌名下的 Termignoni 尾段)。
- 選項:
  - **甲 維持**。
  - **乙 分級**(推薦):同一支函式多回一欄 `rank smallint`:料號完全相符 1 > 整串折疊吻合 title 2 > 品牌名吻合 3 > title 吻合 4 > subtitle / description 吻合 5,再照 id。
    都是已經算過的條件,多幾個 CASE,不多掃表。
  - **丙 相似度**:`similarity()` 分數排序。每列算分數,`count: 'exact'` 那發會跟著變重,先不建議。
- 🔴 **乙會改回傳型別**(多一欄)⇒ 要 DROP + CREATE ⇒ GRANT 全掉要重下。
  而 `/products?search=` 那條路的排序是 `search_catalog_by_vehicle` 自己排的(`20260909070000` 把 is_exact 置頂搬進去)⇒ **要一起改那支,那是 A 窗的函式。**
  ⇒ 建議 Q2 批了也**排在 §1 之後、A 窗逾時那片之後**,另一個 migration。

## 4. 影響

### 4-1 誰會吃到
| 呼叫端 | 路徑 | 影響 |
|---|---|---|
| `/search` 結果頁 | `app/search/page.tsx:55` → `searchProducts` → `searchByKeyword` → 本函式 | 件數變多(該中的中了) |
| 搜尋框疊層 | `app/api/search/route.ts:124` → 同上 | 同上;車款膠囊不變 |
| `/products?search=`(型錄關鍵字) | `fetchCatalogPage` → `search_catalog_by_vehicle(p_terms)` → 委給本函式(`20260909010000`) | 件數變多;型錄那支的排序 / 篩選不變 |
| 經銷型錄關鍵字 | `search_catalog_by_vehicle_dealer(p_terms)` → 委給本函式(`20260909040000`) | 同上 |
| facet 件數 `catalog_facet_counts` | 不吃 `p_terms`(`20260912010000` 零命中) | 不受影響 |
| 變體料號退路 `searchByVariantSku` | 另一條查詢 | 不受影響 |

### 4-2 20 詞抽查預估:正確 12 ⇒ 18
| 詞 | 現在 | 預估 | 依據 |
|---|---|---|---|
| AKRAPOVIČ | 194 | 670 | 折完 = `akrapovic`,品牌名折疊比中 |
| MT07 | 30 | 154 | 正式庫折疊查詢 title+subtitle 149 + 料號 |
| S1000RR | 172 | 525 | 同上 517 + 料號 |
| S 1000 RR | 872(太寬) | 525 | 整串優先 |
| R1250GS | 6 | 48 | 抽查時折疊查詢 48 |
| Öhlins | 13 | 61 | 抽查時去變音查詢 61 |
| 阿卡 | 0 | 0 | 字典題(Q3),本 plan 不處理 |
| akrapovik | 0 | 0 | 錯字;今天已有品牌建議,本 plan 不處理 |

其餘 12 詞行為不變(折疊不影響中文與已經中的英文)。預估數字是唯讀查詢估的,**貼上後在正式站重打同 20 詞核對**。

## 5. 回滾
- 函式:`CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])`,本體逐字抄 `20260911150000_m4b_search_ids_definer_uses_indexes.sql`(正式庫現行代)。
- 索引:`DROP INDEX IF EXISTS public.products_search_fold_trgm_idx;`
- 折疊函式:`DROP FUNCTION IF EXISTS public.pcm_search_fold(text);`(要在回滾函式本體之後,不然現行函式還引用它)。
- 回滾檔寫 `supabase/rollbacks/<新版本號>-rollback.sql`,同 `20260911150000-rollback.sql` 的形狀。
- 回滾不動資料、不動權限;前台 TS 零改動,不用重部署。

## 6. 怎麼做(批了之後)
1. **版本號**:`20260916070000`(A 窗)、`080000`(設計窗)已占,開工時跟主視窗領號,不自己挑。
2. **前置閘**(migration 開頭):
   - 正式庫現行 `prosrc` md5 = `20260911150000` 那代的值,不符就停,不蓋掉別人改過的版本。
   - `pg_trgm` 在;`pcm_search_fold` / 新索引還不存在。
3. **拋棄式 PG 驗收**(`schema-dump-20260915/up.sh`,假資料):
   - 抽查那 20 詞在舊 / 新函式各跑一次:只有 §4-2 那幾格變,其餘結果集逐列相同。
   - 空字串 / 只有符號的詞 ⇒ 0 列(不是全表)。
   - 下架商品一件都不回。
4. migration 靜態閘(規則 ① 新物件 bare CREATE、③ `v_functions` 斷言清單)、三綠;鐵則 12 審(codex 額度到 09-20 12:12,期間走 adversarial-reviewer)。
5. 貼板時段:客人少、非 09:31–09:53 UTC。
6. 貼上之後:§2-2 那 5 詞在正式庫唯讀重量;正式站重打 20 詞核對 §4-2。

## 7. 與 A 窗的分工
- A 窗在查型錄逾時(`~/pcm-mailbox/進度-A窗.md`):`search_catalog_by_vehicle` / facet counts / 逐分類 HEAD count。
- 本 plan **只動** `storefront_search_product_ids` 本體 + 一支新 IMMUTABLE 函式 + 一支新索引;**不動** `search_catalog_by_vehicle(_dealer)` 與 `catalog_facet_counts`,也不改簽章,那兩支不用 DROP / 重 GRANT。
- 但 `/products?search=` 會透過委派吃到本片 ⇒ 兩件事的時序:
  - (a) 本片的新索引讓折疊分支不增加延遲(§2-2 目標:每詞 < 現行 + 30 ms)⇒ **不應該讓 A 窗的逾時變糟**。
  - (b) 貼之前把預計時段告訴 A 窗;A 窗若同一天要改 `search_catalog_by_vehicle`,**先貼 A 窗那片**,本片之後貼,貼完各自重量一次。
  - (c) §3 乙(相關度)要動 `search_catalog_by_vehicle` 的排序 ⇒ 那一片由 A 窗或在 A 窗那片合進之後再開,不在本 plan 範圍。

## 8. 另外發現(本 plan 不處理,列出來)
1. **車款表裡有 3 列 Ducati「車型」其實是商品名**:
   - 資料:`OHLINS MONSTER 696/796/1100 STEERING SHOCK MOUNT KIT`
   - 來源:`product_fitments`(`product_fitments_effective` 也各 3 列),掛在供應商 **WRS** 的 3 件「防甩頭固定座組」上。
   - `vehicle_taxonomy_public` 是這兩張表的 view ⇒ 搜尋膠囊把「Öhlins」當成 Ducati 的暱稱。
   - 🔴 這是 Sean 2026-09-09 拍乙「WRS 46 列假車款先擱著、推完顧客站再修源頭」的同一族(memory `project_0909-wrs-fake-models-deferred`)。
     該記憶記著「刪列會被每天同步原封寫回,只能修源頭」(轉述,未重驗)。
   - **來源是供應商同步,不是報價單同步** ⇒ 要不要現在修由主視窗 / Sean 決定。
2. **DBK SPECIAL PARTS 品牌下有 113 件(共 1,954 件)標題是 Termignoni**(例:料號 `001IO` 「Termignoni 不鏽鋼頭段」)。要請人確認品牌歸屬。
3. **「阿卡」要不要進字典** ⇒ Q3。
4. `pgroonga`(可裝未裝)是上線 checklist E「中文分詞」的另一個候選(`pg_jieba` 在 Supabase 裝不起來)。本 plan 不處理,留給 E 重新拍板時看。
