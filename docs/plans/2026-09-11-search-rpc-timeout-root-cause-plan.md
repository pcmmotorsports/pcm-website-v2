# Plan · 關鍵字搜尋離 3 秒逾時遠一點(治本)

> 🔴🔴 **[2026-09-11 窗 A 更正 —— 本 plan §1、§2 甲、§6 的量測前提錯了,先讀 §7]**
> 我在正式庫量測用的 `pcm_readonly` **繞過 RLS**(`rolbypassrls = t`),拋棄式 PG 用的是 superuser —— 兩個都不是客人。
> 客人走 `anon`(要守 RLS)⇒ 照正式庫 policy 逐字重建後實測:**一支索引都用不上**,甲對客人只快 7~15%。
> ⇒ **甲照原設計寫成 migration 對客人幾乎沒用。** 下面原文留著(刪除線式保留),結論以 §7 為準。

> **一句話(原文,前提已被 §7 推翻)**:客人搜尋時,資料庫有 3 秒上限(anon `statement_timeout=3s`)。今天熱的時候一發 0.25~0.66 秒,
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

## 6. 附件:甲在拋棄式 PG 上先做一次(2026-09-11,證據,不是實作)

> 🛑 **沒碰正式庫、沒進 `supabase/migrations/`。** 草稿與原始輸出在窗 A 的 session scratchpad
> (`bench-schema.sql` / `old-func-clean.sql` / `new-func.sql` / `bench-run.sql` / `bench-out.txt`),session 結束會消失;
> 下面是它們的結論。拋棄式 PG 已停掉並刪除。

**環境**:本機 PostgreSQL 17.10(正式庫 17.6,同一主版),`shared_buffers=256MB`(與正式庫 `SHOW shared_buffers` 同值)。
**假資料**(形狀照正式庫 EXPLAIN 看到的表與索引,筆數同級,**零正式庫資料**):
brands 25 · products 26,460(DBK 約 7%)· product_variants 61,193;
products 上照正式庫建四支 trigram(title / subtitle / description / external_id)+ `idx_products_brand_id`;
`products_public` / `product_variants_public` 做成直接落底表的 view(正式庫 EXPLAIN 也是直接落底表、沒有額外 Filter)。

**舊版**:正式庫 `pg_get_functiondef` 抽出來、只拿掉整行註解。**甲**:只改變體料號那一段 ——
`CASE WHEN t.term ~ '[0-9]' THEN … LIKE '%…%' ELSE … = … END` 拆成兩個 `UNION ALL` 分支
(`t.term ~ '[0-9]'` 走 LIKE、`t.term !~ '[0-9]'` 走 `=`),前面四道閘逐字照抄兩份;`diff` 只有這一段。
加兩支索引:
```sql
CREATE INDEX pv_sku_norm_btree ON product_variants ((upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))));
CREATE INDEX pv_sku_norm_trgm  ON product_variants USING gin ((upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))) extensions.gin_trgm_ops);
```

**量法**:每組詞先跑一次暖身,再 `EXPLAIN (ANALYZE, BUFFERS)` 取那一次。舊版在「還沒加索引」時量(= 今天正式庫),
甲在加完索引後量;另外把舊版在「有索引」時再量一次當對照。

| 詞 | 舊版 | 甲 | 舊版 + 有索引(對照) | 甲用到新索引 |
|---|---|---|---|---|
| `DBK SPECIAL`(純字母 + 品牌) | 90.2 ms / 20,099 buf | **23.2 ms** / 19,529 | 89.2 ms(仍 Seq Scan) | btree |
| `PET52R`(字母 + 數字) | 92.5 ms / 1,869 | **18.7 ms** / 1,307 | 90.9 ms | trgm |
| `3-BLK`(含數字,包含式) | 113.3 ms / 3,498 | **30.3 ms** / 3,160 | 112.0 ms | trgm |
| `FIRE`(純字母,非品牌) | 79.0 ms / 587 | **0.08 ms** / 17 | 65.2 ms | btree |
| `APR-1-FIRE`(長料號) | 131.7 ms / 1,913 | **32.5 ms** / 1,355 | 132.4 ms | trgm |
| `排氣管`(中文,對照組) | 40.0 ms / 1,465 | 40.5 ms / 1,465 | 39.7 ms | —(變體那段本來就不跑) |

**結果集**:六組詞,舊版與甲回傳的 `(id, is_exact)` **逐列相同、順序相同**
(`array_agg(… ORDER BY ordinality)` 比對六組都是 `t`;筆數 2648 / 3 / 274 / 0 / 5 / 2646)。

**讀法**:
- 甲把變體料號那段從「整張 61,193 列掃」變成索引查,**時間砍掉 67~99%**;中文詞不受影響(對照組持平)。
- **「舊版 + 有索引」一樣慢** ⇒ 證明是 `CASE WHEN` 擋住索引,光加索引不改寫沒有用。
- buffer 數在 `DBK SPECIAL` 只從 20,099 降到 19,529 —— 時間省的是 6 萬次 `regexp_replace` 的 CPU,不是讀頁。
  剩下的 buffer 主要是排序用的 `is_exact`(對 2,648 列逐列子查詢)與品牌那一塊。
- 甲之後含數字的詞還剩 18~32 ms,幾乎都在 **③ 料號前綴那段**(`Seq Scan on products` 26,460 列 + `regexp_replace`)。
  同一種修法(正規化 `external_id` 的運算式索引)可以再砍,**不在本 plan 的甲裡**,要做另寫。
- ⚠️ 限制:假資料的文字分布不是正式庫的(例如說明欄長度、品牌件數),**毫秒數只能看前後比例,不能直接當正式庫的值**;
  正式庫的數字要照 §5 貼完再用唯讀 `EXPLAIN` 量。

## 7. 🔴 更正:前面的量測都繞過了 RLS,而客人不會(2026-09-11,寫 migration 前發現)

**發現經過**:主視窗叫我照 §2 甲寫正式 migration。動手前我想到:RLS 之下,**不是 leakproof 的條件不能當索引條件**
(PostgreSQL `restriction_is_securely_promotable`:user qual 的 security level 高於 policy qual 時,只有 leakproof 的才能推進 index scan)。
而搜尋用到的全部不是 leakproof。

**正式庫唯讀讀到的前提**(`scripts/readonly-prod-sql.sh`):
```
pcm_readonly           rolbypassrls = t          ⇒ §1 的 0.25~0.66 s 是【沒有 RLS】的世界
products / product_variants / brands   relrowsecurity = t
products_select_public          {public}  USING (delisted_at IS NULL)
product_variants_select_public  {public}  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND p.delisted_at IS NULL))
brands_select_public            {public}  USING (true)
products_public / product_variants_public   reloptions = {security_invoker=true}
proleakproof:texteq t · textlike f · texticlike f · upper f · regexp_replace f
```

**拋棄式 PG 重測**(同 §6 的假資料 + 上面三條 policy 逐字建 + `security_invoker` + `CREATE ROLE anon`,`SET ROLE anon` 跑):

| 詞 | superuser 舊 → 甲 | **anon 舊 → 甲** | anon 用到的索引 |
|---|---|---|---|
| `DBK SPECIAL` | 90.3 → 23.7 ms | **156.7 → 145.3 ms**(buffer 40,573 → 40,573) | **無**(products 與 product_variants 都 Seq Scan) |
| `PET52R` | 93.0 → 19.5 | **128.1 → 113.6** | 無 |
| `3-BLK` | 113.2 → 28.1 | **152.2 → 138.4** | 無 |
| `FIRE` | 65.7 → 0.14 | **103.6 → 98.1** | 無 |
| `APR-1-FIRE` | 134.4 → 33.2 | **184.0 → 157.4** | 無 |
| `排氣管` | 40.4 → 40.5 | **31.3 → 31.6** | 無 |

結果集:anon 下六組舊與甲仍逐列相同(甲**不會改壞**東西,只是**幾乎沒幫到客人**)。

**讀法**:
- 客人那條路上,**連既有的四支 trigram 索引(title / subtitle / description / external_id)也用不到** ⇒ 每個詞把 `products` 整張掃一次做四欄 `ILIKE`,
  再加上 `product_variants` 整張掃 + 每列一個 RLS 子查詢。buffer 是繞過 RLS 時的 **兩倍**(40,573 對 20,125)。
- ⇒ 📌 **這很可能才是 E2E 撞 3 秒的主因**:正式庫 26,460 件、說明欄是真文字,anon 每個詞都在整張掃。**未證實**(量不到 anon 在正式庫的真值:唯讀帳號繞過 RLS,拿不到客人的計畫)。
- ⇒ `cc8a79188` 那一批「中文搜尋 243 ms → 走 trigram」一類的讀數,**若也是用繞過 RLS 的帳號量的,同樣不代表客人**(未逐條查)。

**所以甲要改成什麼(方向,不是本 plan 的決定)**:
- 讓搜尋函式**不在 RLS 之下做比對** —— 例:`SECURITY DEFINER`(以擁有者身分執行)+ 函式內**自己寫** `delisted_at IS NULL`(把兩條 policy 的意思照抄)+ `SET search_path` + 收緊 `EXECUTE` 權限。
  這樣 §6 的兩支索引與既有四支 trigram 才用得到。
- 🛑 **這是權限變更**(繞過 RLS 的函式)⇒ 鐵則 12「權限」類 + 要重寫 plan + **要 Sean 重新拍**:他拍的甲是「把搜尋改聰明一點」,而原本的甲對客人沒效。
- 本次**沒有寫任何 migration**;§6 與本節的草稿都在窗 A scratchpad(`bench-rls.sql` / `bench-run-rls.sql` / `bench-rls-out.txt`)。

