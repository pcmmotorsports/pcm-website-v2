# Plan · 客人搜尋在 RLS 之下用得到索引(搜尋逾時治本 v2)

> **一句話**:客人(`anon`)搜尋時要守 RLS,而搜尋條件全部不是 leakproof ⇒ **一支索引都用不上,每個詞整張掃**。
> 把搜尋函式改成「以擁有者身分執行、函式裡自己過濾下架商品」,客人那條路一發從 108~186 ms 降到 0.75~35 ms(拋棄式 PG、假資料),結果逐列不變。
>
> · 🛑 **本 plan 一個字都還沒動到碼 / 資料庫。** Sean 本人還沒看過。
> · 這是**權限變更**(一支會繞過 RLS 的函式)⇒ 鐵則 8(先 plan)+ 鐵則 12「權限」類(migration 要審)。
> · 前一份:`docs/plans/2026-09-11-search-rpc-timeout-root-cause-plan.md`(§7 是它自己的更正,本份接著寫)。
> · 寫的人:窗 A,2026-09-11,基底 `285925cf4`。
> · ⚠️ 更正一格(主視窗):已 commit 的「撞 57014 重試一次」(`7ce1ce56b`)**還沒到客人那邊** —— 客人站跑 `main`,`main` 停在 09-10 晚上。

---

## 0. Sean 之前拍的甲,前提變在哪

| | 上一份 plan 說的 | 實際 |
|---|---|---|
| 慢在哪 | 變體料號那段整張掃(78%) | 那是**繞過 RLS 的帳號**量到的;**客人**是「每個詞把商品表整張掃、四欄 ILIKE」+ 變體表整張掃 |
| 甲(改寫 + 加兩支索引) | 快 67~99% | **客人那條路只快 7~15%**:RLS 之下新舊索引都用不上 |
| 要不要動權限 | 不用 | **要**:得讓函式在 RLS 外面做比對,才用得到索引 |

量測用的 `pcm_readonly` 是 `rolbypassrls = t`、拋棄式 PG 的 `postgres` 是 superuser ⇒ **兩把尺都繞過 RLS,量到的不是客人的數字**。

## 1. 客人身分實測:舊版 vs v3(拋棄式 PG,`SET ROLE anon`)

**環境**:本機 PostgreSQL 17.10(正式庫 17.6)、`shared_buffers=256MB`、假資料 brands 25 / products 26,460 / variants 61,193(**零正式庫資料**)。
RLS 照正式庫 `pg_policies` 逐字建(三條 `{public}` policy,見 §2 對照表)、兩支 view `security_invoker=true`、`CREATE ROLE anon`。
另外**刻意下架 202 件**,其中兩件是「會被搜到的」:料號 `PET52R` 那件、含 `APR-1-FIRE` 變體的母商品 —— 讓「下架過濾對不對」有判別力。

**v3 = 甲 + 權限改法**:
- `STABLE SECURITY DEFINER` + `SET search_path TO ''`(house 規則,`scripts/definer-search-path-gate.py` 擋非空字串)
- 讀底表 `public.products` / `public.product_variants`(不再經過 `*_public` view)
- 每個分支照 policy 原文自己寫過濾(7 處,見 §2)
- 變體料號那段 `CASE WHEN` 拆成兩個 `UNION ALL`(同上一份 §6)+ 兩支運算式索引(btree 給 `=`、GIN trigram 給 `LIKE '%…%'`)

| 詞 | 舊版(anon) | **v3(anon)** | 舊 buffer → v3 |
|---|---|---|---|
| `DBK SPECIAL` | 148.1 ms | **23.6 ms** | 40,706 → 27,362 |
| `PET52R` | 125.7 | **22.5** | 4,377 → 1,396 |
| `3-BLK` | 149.8 | **32.8** | 7,801 → 5,801 |
| `FIRE` | 108.2 | **0.75** | 3,105 → 80 |
| `APR-1-FIRE` | 186.0 | **35.4** | 4,429 → 1,444 |
| `排氣管`(中文) | 31.6 | **39.8(慢 8 ms)** | 1,267 → 1,534 |

**v3 裡面用了哪些索引**(DEFINER 函式不會被內聯 ⇒ 用 `auto_explain` `log_nested_statements` 印內部計畫,`DBK SPECIAL`):
```
-> Bitmap Index Scan on products_title_trgm_idx        (actual time=0.018..0.018 rows=0 loops=2)
-> Bitmap Index Scan on products_description_trgm_idx  (actual time=0.011..0.011 rows=16 loops=2)
-> Bitmap Index Scan on products_external_id_trgm_idx  (actual time=0.097..0.097 rows=1332 loops=2)
-> Bitmap Index Scan on idx_products_brand_id          (actual time=0.081..0.081 rows=2658 loops=2)
-> Bitmap Index Scan on pv_sku_norm_btree              (actual time=0.004..0.004 rows=0 loops=1)
```
`PET52R` 用到 `pv_sku_norm_trgm`;**還在整張掃的只剩 ③ 料號前綴那段**(`Seq Scan on products p_2 rows=26258`,含數字的詞才跑)。

**結果集**(anon 身分,六組詞):
```
詞            舊版   v3   拿掉過濾的突變版   舊==v3(逐列+順序)   v3 回傳的下架商品
DBK SPECIAL   2626  2626      2648             t                   0
PET52R           2     2         3             t                   0
3-BLK          264   264       265             t                   0
FIRE             0     0         0             t                   0
APR-1-FIRE       4     4         5             t                   0
排氣管         2616  2616      2646             t                   0
```
⇒ v3 與舊版**逐列相同**;突變版(同一支 v3 拿掉 7 處過濾)會多出下架商品 ⇒ **這個比對抓得到漏網的,不是恆真。**

⚠️ 限制:假資料的文字分布不是正式庫的 ⇒ **毫秒只能看比例**。正式庫的客人數字**量不到**(唯讀帳號繞過 RLS);貼完之後要用 `anon` 身分量(方法見 §4 驗收)。
⚠️ 中文詞在 v3 慢 8 ms:trigram 對 3 個中文字選擇性差(命中 2,616 件),走索引反而比整張掃慢一點。量級小,記下。

## 2. 權限面

**正式庫事實**(唯讀,2026-09-11):
```
storefront_search_product_ids(text[])  owner = postgres · prosecdef = f · proconfig = (無)
                                        EXECUTE:anon t · authenticated t · service_role t
postgres        rolsuper = f · rolbypassrls = t      ⇒ DEFINER 以它執行 = 不受 RLS 管
products / product_variants / brands   owner = postgres · relforcerowsecurity = f
呼叫端:SupabaseProductAdapter.ts:1042(anon / authenticated)· search_catalog_by_vehicle(INVOKER)· search_catalog_by_vehicle_dealer(已是 DEFINER)
         apps/admin 零呼叫(grep 過)
```

**改成**:
```sql
-- 函式頭
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
-- 權限(docs/patterns/revoking-function-execute-in-supabase.md §1:兩道 REVOKE 少一道都是開的)
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;
```
- **為什麼仍然給 anon**:這是客人搜尋本身,`search_catalog_by_vehicle`(INVOKER)以 anon 身分在函式裡叫它 ⇒ 收掉 anon 等於關掉搜尋。
- **擁有者維持 `postgres`**:§3.5 那條「owner 那條路不是 REVOKE 關得掉的」—— owner 不是 anon/authenticated,不構成繞路。
- 拋棄式 PG 驗過:`prosecdef = t`、`proconfig = {search_path=""}`、`proacl = {postgres=X, anon=X, authenticated=X, service_role=X}`(**沒有 PUBLIC 那份**)。
- 貼完的驗收要照 §3.5:**枚舉所有角色**問 `has_function_privilege`,外加 `pg_has_role(…, 'SET')` 看有沒有角色切換的繞路。

**函式內自己寫的過濾,與 RLS policy 逐字對照**:

| policy(正式庫 `pg_policies` 原文) | v3 函式內 | 出現處 |
|---|---|---|
| `products_select_public` `{public}` `USING (delisted_at IS NULL)` | `WHERE p.delisted_at IS NULL` | ① 四欄 ILIKE · ② 品牌 · ③ 料號前綴 · `is_exact` 的 `p2` |
| `product_variants_select_public` `{public}` `USING (EXISTS (SELECT 1 FROM products p WHERE ((p.id = product_variants.product_id) AND (p.delisted_at IS NULL))))` | `WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)` | ④ 兩支 · `is_exact` 的 `pv2` |
| `brands_select_public` `{public}` `USING (true)` | (不加) | `bh` |

🔴 **對照的前提**:policy 是 `{public}`(所有角色同一條)⇒ anon 與 authenticated 看到的列本來就一樣,函式裡寫一份就對得上兩個角色。
🔴 **service_role 行為會變**:它有 `USING (true)` 的 policy,今天經 RLS 看得到下架商品;v3 之後一律看不到。repo 裡 service_role 沒有呼叫這支(admin 零呼叫),**正式庫其他呼叫者未確認**。

## 3. 漏資料風險:DEFINER 繞過 RLS,可能多漏什麼、怎麼證明沒漏

| 可能漏的 | 為什麼不會 / 怎麼證明 |
|---|---|
| **下架商品的 id** | 7 處過濾 = policy 原文;§1 突變版證明比對有判別力(拿掉過濾就多 22 / 1 / 1 / 1 / 30 件),v3 下架外洩 0 |
| **看不到的欄位** | 回傳型別只有 `(id uuid, is_exact boolean)`;比對用到的欄位 title / subtitle / description / external_id / brand_id / sku / brands.name **本來就在 `products_public` / `product_variants_public` 裡對 anon 公開** ⇒ 沒有拿「anon 讀不到的欄位」當條件(不碰 price_store / metadata / price_by_tier) |
| **拿條件探下架商品內容**(打一個只有下架商品才有的字,看回不回來) | 下架列在比對之前就被過濾 ⇒ 回傳一定是 0;時間差理論上存在(下架列仍被掃到),量級是毫秒,**未量** |
| **search_path 劫持** | `SET search_path TO ''` + 全部 `public.` 限定;內建函式在 `pg_catalog`(永遠隱含在最前) |
| **之後有人改這支函式** | migration 的事後閘釘住:`RETURNS TABLE(id uuid, is_exact boolean)`、`prosecdef`、`search_path=""`、7 處過濾都在、剝註解後不得出現 `price_store` / `metadata` / `price_by_tier`,再加一道行為閘(下架商品搜不到) |
| **慢查詢打爆** | DEFINER 不改 `statement_timeout`(那是 anon 的設定,前一份 §2 乙已實測函式層改不動它)⇒ 一發仍然 3 秒上限,而且變快 |

## 4. rollback 與驗收

**rollback**(`supabase/rollbacks/<ver>-rollback.sql`):
```sql
-- 重貼 20260910070000 那一版(INVOKER、無 SET 子句、讀 *_public view)
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉(reference_create-or-replace-resets-set-clause)
--    ⇒ 舊版沒有 SET ⇒ 退回之後 search_path 設定跟著消失 = 正確;SECURITY DEFINER 也要寫回 INVOKER
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[]) ... SECURITY INVOKER ... ;
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;
DROP INDEX IF EXISTS public.<btree 那支>;
DROP INDEX IF EXISTS public.<trgm 那支>;
```
- 退回之後的狀態 = 今天(慢,但對)。**不會漏資料**:INVOKER 回到 RLS 管。

**驗收**(貼完):
```
🟢 正式庫 has_function_privilege 枚舉:只有 postgres / anon / authenticated / service_role 有 EXECUTE;PUBLIC 那份不在 proacl
🟢 prosecdef = t · proconfig = {search_path=""}
🟢 下架商品搜不到:挑一件正式庫已下架、而且標題有獨特字的商品,用它的字搜 ⇒ 0 筆
🟢 結果不變:貼之前用 anon 身分(PostgREST)存「DBK SPECIAL / PET52R / 排氣管」三組的 id 清單,貼之後逐列比對
🟢 快了:同三組在正式站 /search 的伺服器 log `[searchByKeyword] path=rpc … rpc=XXms` 前後對照(anon 真值只能這樣量)
🛑 做完的定義:Sean 在正式站搜「DBK SPECIAL」與一個料號,都有結果、沒有「搜尋暫時無法使用」
```

## 5. Fable 5.1 研究:除了 SECURITY DEFINER 還有哪些路

(Sean 2026-09-11 逐字「記得用fable 研究看有沒有更好的方式」;子代理唯讀,結論原文附在下面)

子代理自己起拋棄式 PG 17.10 實驗(角色照正式庫:`postgres` NOSUPERUSER + BYPASSRLS 擁有三張表,`anon` 無 bypass,policy 逐字),
做完已停掉刪除;它的腳本與輸出在窗 A scratchpad(`e1-e3.*`、`e5.*`、`e6.*`,session 結束會消失)。**以下為結論原文**(只把 HTML 跳脫字元還原):

> **先講機制(實測)**
> - 基線 E0(舊函式、anon):products / product_variants 全 Seq Scan,DBK SPECIAL 159.5 ms、FIRE 107.1 ms。同一句 `title ILIKE '%DBK%'` anon 走 Seq Scan、postgres 走 `products_title_trgm_idx` ⇒ 擋索引的是 RLS 本身,不是索引缺。
> - 只要 policy 變成 `USING (true)`,anon 就用得到 trigram 索引。policy 現在的 `delisted_at IS NULL` 已經是 leakproof 形狀(NullTest)仍擋 ⇒ 擋的不是「policy 是否 leakproof」,而是「user qual 的 security level 高於 policy qual」(這句是我對 `restriction_is_securely_promotable` 的理解,未逐行對原始碼,標未確認)。
> - 正式庫 proleakproof 實查(同 PG 17):`texteq t、text_lt/le/gt/ge t、starts_with(^@) t`;`textlike f、texticlike f、upper f、regexp_replace f、similarity_op f、ts_match_vq f`。
>
> **(a) 自訂 IMMUTABLE LEAKPROOF 正規化函式** —— 非 superuser 做不到:`SET ROLE postgres; CREATE FUNCTION ... LEAKPROOF` ⇒ `ERROR: only superuser can define a leakproof function`。Supabase 的 `postgres` 不是 superuser ⇒ 這條在正式庫走不通。即便 superuser 幫忙:plpgsql 版 `norm_lp2(sku) = 'APR1FIRE'` 才走 btree,而 `LIKE '%3BLK%'` 照樣 Seq Scan ⇒ **ILIKE/LIKE 分支一律救不到**,只救 `=`。風險:把會因輸入報錯的函式標 leakproof 是拿錯誤訊息當側通道。⇒ 死路。已實測。
>
> **(b) generated column STORED + `=`** —— anon、RLS 下:`sku_norm = X` 走索引;`sku_norm ^@ 'PET52R'`(starts_with 是 leakproof)配 `COLLATE "C"` btree 走 Index Scan;範圍寫法 `>= X AND < X+1` 走索引;**`LIKE 'X%'` Seq Scan、`LIKE '%X%'` Seq Scan、`title ILIKE` Seq Scan**。⇒ 救得到:變體 sku 純字母 `=`、external_id/sku 前綴(要把 LIKE 改成 `^@`)。救不到:title/subtitle/description/external_id 四欄 ILIKE 與含數字詞的 sku `%X%` —— 這兩個正是最貴的分支。風險:無 bypass,最乾淨。要 migration(ADD COLUMN ×2、索引 ×3、函式改 `^@`)。已實測(單句,沒跑整支函式)。
>
> **(c) 另開搜尋表 / MV(只放公開欄、不放下架)** —— 沒 RLS 或 RLS `USING (true)` 都走 trigram ⇒ 全部分支都能用索引。風險:同步器漏一條(下架未刪、非公開欄誤入)= 下架品或內部欄位見客;`TRUNCATE`/批次匯入不觸發 row trigger 是常見漏洞。維護最高。只測了「能不能用索引」,沒做同步器。
>
> **(d) 改 policy 形狀** —— 只有 `USING (true)` 能讓索引回來;現行 policy 已是 leakproof 形狀仍擋;partial index `WHERE delisted_at IS NULL` 也不救。`USING (true)` = 下架品對 anon 直讀全開,不能接受。已實測。
>
> **(e) 其他** —— e1 **definer view**:兩支 `*_public` 改 `security_invoker=false` + 把 policy 條件寫進 view 的 WHERE,函式維持 INVOKER。products 四支 trgm 索引全部用上;六組結果與 v3 逐列相同、nofilter 突變版多 17 列;anon 直讀 view 看不到下架品。**但** product_variants 仍 Seq Scan —— 要拆成 v3 那兩個 UNION ALL 分支才行。時間 92.9 / 94.6 / 119.8 / 65.9 / 138.6 / 38.5 ms。改成 `security_barrier=true` 立刻退回全掃 168 ms。風險:Supabase advisor 會標 `security_definer_view`;非 barrier view 對 anon 直打 PostgREST 任意 filter 開放,理論上可用報錯側通道摸下架品欄位(推論,未實測);而且改的是所有讀 view 的人,不只搜尋。e2 `ALTER ROLE anon BYPASSRLS` / `row_security=off`:前者要 superuser 且全開;後者對 anon 是報錯不是繞過。死路(依文件,未實測)。e3 把 definer view 放到 PostgREST 不曝光的 schema:零件比 v3 多且函式一樣要改(推論,未實測)。
>
> **推薦:維持 v3(SECURITY DEFINER + 自寫 delisted 過濾 + 兩支運算式索引)**。理由一句:RLS 下 ILIKE/LIKE 這幾個最貴的分支**沒有任何不繞過 RLS 的寫法能用索引**(a/b/d 實測全掛),而 v3 是繞過面最小的那一種 —— 只在一支函式內、輸出只有 id 與 is_exact、下架過濾有突變測試證明有判別力。
> v3 與推薦的差異:**零改動**。附兩點驗收建議:(1) migration 驗證段加 nofilter 突變比對;(2) `EXECUTE` 必須留給 anon(它就是客人的搜尋),防線是 `SET search_path TO ''` + 函式體自寫過濾 + 回傳欄只有 id。若日後要再快,(b) 的 `^@` 前綴寫法可疊在 v3 上,非必要。

**窗 A 對 Fable 那兩點的處理**:
- (1) 收下:正式 migration 的事後閘要有一格「下架商品搜不到」的行為閘(§3 最後一列);拋棄式 PG 驗收照 §1 保留 nofilter 突變比對。
- (2) 措辭訂正:§2 那兩道 REVOKE **仍然要下** —— 收的是 PUBLIC 那份(預設給所有角色),再**具名** GRANT 回 anon / authenticated / service_role;anon 保留 EXECUTE 是刻意的。兩者不衝突。

## 6. 推薦

**v3(SECURITY DEFINER + 函式內照 policy 原文過濾 + 拆 CASE + 兩支運算式索引)。**
理由:客人那條路今天每個詞整張掃;能讓最貴的 ILIKE / LIKE 分支在客人身分下用到索引的,只有「在 RLS 外面比對」這一類,
而 v3 是其中繞過面最小的(一支函式、只回 id、過濾照 policy 原文而且有突變比對證明)。Fable 獨立實測後同樣推薦 v3。
其他四條:(a) 做不到、(b) 救不到最貴那段、(c) 同步器是新的漏資料來源、(d) 等於全開。

## 7. 給 Sean 的題目

```
Q:搜尋變快那件,你上次拍了甲「把搜尋改聰明一點」。後來發現一件事:我們之前量速度用的帳號有「特權」,
   它不受「下架商品藏起來」那套規則管;客人沒有這個特權,所以客人那邊的搜尋其實是每次都把全部商品翻一遍,
   上次的甲對客人幾乎沒幫助(只快 7~15%)。要真的變快,得讓搜尋自己在裡面把下架商品濾掉,換成有特權的身分去查。
   另外請 Fable 獨立研究了四種別的做法,都行不通或更危險,它也推薦這個。怎麼做?
A: 甲 = 照新做法改(推薦)。客人搜尋預計快 4~100 倍(測試資料量的),結果跟今天一模一樣,下架商品一樣搜不到;
       代價是這支搜尋改用有特權的身分跑,所以要先審、要多幾道檢查,貼錯可以整包退回。
   乙 = 先不改,只靠已經寫好的「慢了自動再試一次」(那一顆還沒上到客人站,要等 main 更新)。
```

## 8. 下一步(Sean 拍甲之後)

- 正式 migration:版本號大於 repo 最大那支;基底 = 正式庫 `pg_get_functiondef`(與 `20260910070000` 逐字相同,2026-09-11 比對過);
  前置閘(md5 釘住基底)+ 事後閘(`prosecdef` / `search_path=""` / 回傳型別 / 7 處過濾 / 禁止出現 `price_store` 等欄位 / 下架商品行為閘)+ ACL 枚舉斷言。
- `supabase/rollbacks/<ver>-rollback.sql`(§4)。
- 拋棄式 PG 正向跑 + 退回跑 + anon 身分結果集比對 + nofilter 突變。
- 鐵則 12:Fable 5.1 唯讀審一輪(權限類)。貼正式庫由主視窗要編號授權。
