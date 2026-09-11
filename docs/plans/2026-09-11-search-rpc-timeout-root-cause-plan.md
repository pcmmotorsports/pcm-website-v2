# Plan · 關鍵字搜尋離 3 秒逾時遠一點(治本)

> **一句話**:客人搜尋時,資料庫有 3 秒上限(anon `statement_timeout=3s`)。今天熱的時候一發 0.25~0.66 秒,
> 而**其中 78% 花在一段「整張掃 6 萬列、最後 0 筆」的變體料號比對**。把那段改成用得到索引,就能離 3 秒遠很多。
>
> · 🛑 **本 plan 一個字都還沒動到碼 / 資料庫。** Sean 本人還沒看過。
> · 動 SQL 函式 + 加索引 ⇒ 鐵則 8(先 plan)+ 鐵則 12(migration 要審)。
> · 寫的人:窗 A,2026-09-11,基底 `e4b3679fa`。已上線的第二道網:`7ce1ce56b`(撞 57014 重試一次)。

---

## 0. 先更正一個前提

主視窗交辦寫的是 `search_catalog_by_vehicle`(`20260909070000:266`)。**真正貴的是它裡面叫的那一支**
`storefront_search_product_ids(p_terms)`(repo 最後一代 `20260910070000:56`,`latest-definition-of.sh` 讀到 newest = live):

- `/search` 頁與搜尋框建議 ⇒ 直接叫 `storefront_search_product_ids`(E2E 逾時就是這一發,run 34564927156)
- `/products?search=` ⇒ `search_catalog_by_vehicle`,它在函式內**叫兩次** `storefront_search_product_ids`
  (`20260909070000` 函式體相對第 78、260 行)

⇒ **修 `storefront_search_product_ids` 一支,三條路一起受惠**;`search_catalog_by_vehicle` 本身不用動。

## 1. 為什麼一次碰 ~23.8k 個 buffer(正式庫唯讀實測)

做法:`pg_get_functiondef` 抽出正式庫那支的本體,把 `p_terms` 換成 `ARRAY['DBK','SPECIAL']`,
包在 `BEGIN READ ONLY` 裡跑兩次 `EXPLAIN (ANALYZE, BUFFERS)`(`scripts/readonly-prod-sql.sh`;唯讀帳號叫不了函式本身,只能跑本體)。

| 那一段 | 第 1 次 | 第 2 次(熱) | buffer |
|---|---|---|---|
| 全部 | **663.7 ms** | **254.8 ms** | 23,831(全部 shared hit,0 次讀磁碟) |
| ④ 變體料號比對:`Seq Scan on product_variants` 61,193 列 + 每列 `regexp_replace` | 221.1 ms | **199.6 ms(78%)** | 5,051 |
| ① 商品名/副標/說明/料號 ILIKE(trigram 索引)× 2 詞 | 381.0 ms | 5.0 ms | 860 |
| ② 品牌名 → 該品牌全部商品 | 7.7 ms | 5.3 ms | 3,966 |
| 排序用的 `is_exact`(對 1,943 列各跑一次子查詢) | 約 37 ms | 約 37 ms | 13,940 |

**最貴的那一段,計畫原文(第 2 次):**
```
->  Nested Loop  (cost=0.00..8263.68 rows=30596 width=24) (actual time=199.607..199.608 rows=0 loops=1)
      Join Filter: CASE WHEN (t_4.term ~ '[0-9]'::text) THEN (upper(regexp_replace(product_variants.sku, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)) ~~ ...
      Rows Removed by Join Filter: 61193
      ->  Seq Scan on product_variants  (cost=0.00..5662.93 rows=61193 width=27) (actual time=0.015..20.795 rows=61193 loops=1)
```
**對應的碼**:`supabase/migrations/20260910070000_m4b_widen_variant_sku_gate.sql:213-217`(`AND CASE WHEN t.term ~ '[0-9]' THEN … LIKE '%…%' ELSE … = … END`)。

**為什麼整張掃**:
- 條件寫在 `CASE WHEN … END` 裡 ⇒ 資料庫沒辦法拿任何索引去對它。
- `product_variants` 上**沒有**「正規化料號」的索引(repo 只有 `product_id` / `availability` / `supplier_slug` 三支,`20260531142533:75-76`、`20260602135934:38`)。
- 搜「DBK」這種純字母詞 ⇒ 走 `= 相等` 那支 ⇒ 仍然每一列都算一次 `regexp_replace` 再比 ⇒ 6 萬次,0 筆。

⚠️ **沒量到的**:第 1 次的 ① 381 ms 對第 2 次 5 ms,buffer 數相同(都是 hit),**差在哪裡未證實**。
「冷」我造不出來(正式庫不能清快取);E2E 那一發超過 3 秒的真因也**未證實**(可能是資料不在記憶體 / E2E 並發)。

## 2. 兩個做法

### 甲 · 讓變體料號那段用得到索引(改寫 + 加兩支索引)

- **改什麼**(一支 migration):
  1. `product_variants` 加兩支**運算式索引**,運算式與函式裡**逐字相同**:
     - btree `(upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g')))` ⇒ 給純字母的 `=`
     - GIN trigram `(upper(regexp_replace(sku, …)) extensions.gin_trgm_ops)` ⇒ 給含數字的 `LIKE '%…%'`
  2. `CREATE OR REPLACE storefront_search_product_ids`:把 `CASE WHEN` 拆成兩個 `UNION ALL` 分支
     (含數字 ⇒ `LIKE`、純字母 ⇒ `=`),**行為逐字不變**,只是讓兩支索引各自用得到。
     基底用正式庫 `pg_get_functiondef`(不是 repo 抄本),照 `revoking-function-execute-in-supabase.md` 還原 GRANT。
- **要不要 migration**:要。
- **對其他呼叫端**:`search_catalog_by_vehicle` / `_dealer` 內部叫它 ⇒ 自動變快,**不用改**;回傳欄位 `(id, is_exact)` 不變 ⇒ adapter 不用改。
  代價:供應商同步寫 `product_variants` 時多維護兩支索引(6 萬列,量級小,**未量**)。建索引時 `product_variants` 短暫擋寫入(6 萬列預估 < 數秒,**未量**)。
- **預期**:那 199.6 ms 變成幾毫秒(**未證實**);要在本機造 6 萬列假資料先量一次,貼完再用唯讀 `EXPLAIN` 量正式庫。
- **rollback**:`DROP INDEX` 兩支 + 重貼 `20260910070000` 那一版函式(`supabase/rollbacks/` 附檔)。

### 乙 · 放寬匿名客人的 3 秒上限

- 🔴 **主視窗舉的「只對這支函式放寬」(`ALTER FUNCTION … SET statement_timeout`)實測沒有用**:
  本機 PostgreSQL 17.10(正式庫 17.6,同一主版)拋棄式實測 ——
  ```
  函式 SET statement_timeout='10s',外層 1s ⇒ SQL 函式:ERROR canceling statement due to statement timeout
                                            ⇒ plpgsql 函式:同一句 ERROR
  對照:外層 5s ⇒ 跑完回 1
  ```
  ⇒ 計時器在**外層那句一開始**就起跑,函式裡改設定改不到它。
- ⇒ 能用的只剩 **`ALTER ROLE anon SET statement_timeout = '6s'`**(整個匿名角色)。
- **對其他呼叫端**:**所有**沒登入的查詢都變成 6 秒上限 —— 包含任何人都能打的公開 RPC ⇒ 有人故意送慢查詢時,資料庫被佔住的時間變兩倍。
- PostgREST 什麼時候吃到新值(新連線 / 每個請求)**未證實**。
- **rollback**:`ALTER ROLE anon SET statement_timeout = '3s'`。
- 客人感受:慢的那一發**不會變快**,只是從「3 秒後報錯」變成「多等幾秒拿到結果」。

## 3. 推薦

**甲。** 熱的時候 78% 的時間花在一段「掃 6 萬列、0 筆」的比對,修掉它等於直接把一發搜尋砍到剩四分之一;
乙只是讓慢查詢跑更久,而且放寬的是所有匿名查詢。

## 4. 給 Sean 的題目

```
Q:客人搜尋有時候會超過資料庫的 3 秒上限,畫面就寫「搜尋暫時無法使用」(今天已經加了自動重試一次)。要怎麼治本?
A: 甲 = 把最慢的那一段改寫成用得到索引(推薦)。一發搜尋預計快很多;要改資料庫、先審再貼,貼錯可以整包退回。
   乙 = 把「沒登入客人」的查詢上限從 3 秒放寬到 6 秒。改一行設定就好;可是慢的還是慢,而且所有沒登入的查詢都放寬,有人惡意狂查時資料庫更容易被拖住。
```

## 5. 驗收(甲;選乙另寫)

```
🟢 修好了:貼完之後正式庫唯讀 EXPLAIN 同一發(DBK SPECIAL)⇒ 變體料號那段不再是 Seq Scan on product_variants,整發 < 100 ms(熱)
         且 1,943 筆結果、排序(is_exact 在前)與貼之前逐筆相同(先把貼前的 id 清單存檔再比)
🔴 沒修好:仍是 Seq Scan / 結果筆數或順序變了
🛑 做完的定義:Sean 在正式站搜「DBK SPECIAL」與一個純數字料號,都有結果
```
