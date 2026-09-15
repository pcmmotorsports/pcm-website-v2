# 2026-09-15 · 顧客站型錄頁逾時 —— 成因與 DB 端 plan(v1)

> A 窗寫。主視窗 pcm-website-v2-b7 派工:「先唯讀診斷, TS 能解就修, 要索引 / 函式 / schema 的只寫 plan」。
> **本檔只是 plan,零 migration。** P1–P3 會新增 / 改函式或索引 ⇒ 鐵則 8,等主視窗核、需要時端 Sean。
> TS 端已修的那一刀(逐分類 count 限流)在同一分支另一顆 commit,本檔 §3 記它的射程。

## 1. 白話

- 客人偶爾看到:車款下拉空、篩選件數讀不到、商品頁「推薦」空白、列表頁某區塊空。
- **主因不是某一支查詢慢,是「排隊」**:網站跟資料庫之間有一層 PostgREST,它手上的連線有限(量到 21 條)。
  側欄那棵分類樹要算 117 個分類各有幾件商品,**原本一次同時丟 117 個問題過去**,而且每分鐘左右就重來一輪。
  ⇒ 那一瞬間連線被塞滿,其他型錄查詢排在後面,等到網站那端 15 秒放棄 ⇒ 客人看到空的那一格。
- 已先在程式端改成「一次最多問 6 個」(不改任何資料庫)。治本是讓資料庫一次算完 117 個分類(P1)。
- 另外三支查詢本身也偏慢、會在忙的時候超過匿名查詢的 3 秒上限(P2–P4)。

## 2. 證據(全部唯讀)

| # | 事實 | 出處 |
|---|---|---|
| E1 | TS 型錄 client fetch 逾時 15 秒;DB 端 anon `statement_timeout=3s`、authenticated 8s | `apps/storefront/src/lib/catalog-anon-client.ts` `CATALOG_FETCH_TIMEOUT_MS`;正式庫 `pg_roles.rolconfig` |
| E2 | Vercel runtime errors 24h 多數是 `TimeoutError: The operation was aborted due to timeout`(= 等了 15 秒),少數 57014 | Vercel get_runtime_errors(pcm-website-v2) |
| E3 | ⇒ 單支語句最多跑 3 秒,而請求等了 15 秒 ⇒ **在 PostgREST 排隊** | E1 × E2 推論 |
| E4 | postgrest_logs「Warp server error: Thread killed by timeout manager」24h 每分鐘常見 8–29 次;09-15 04:45:31 同秒 6 筆(同秒 Vercel PDP / fitments / 推薦逾時成群) | Supabase query_logs |
| E5 | PostgREST 14.5 持 21 條連線;max_connections=60 | `pg_stat_activity` |
| E6 | 🔴 **edge_logs 24h 以總耗時排序第一名**:`HEAD /rest/v1/products_public?select=id&category_id=eq.<id>` **51,261 次、平均 353ms、合計 18,112 秒**;第二名 products_public GET 1,328 秒、`search_catalog_by_vehicle` 1,241 秒、`catalog_brand_counts` 647 秒、`get_vehicle_taxonomy` 473 秒 | Supabase query_logs(edge_logs) |
| E7 | 那一形每小時 115–6,325 次、每輪固定 115 個相異分類 ⇒ 最忙時一小時 ~55 輪 | 同上,按小時分組 |
| E8 | 來源 = `listCategories`(`packages/adapters/src/supabase/helpers/category-queries.ts`):先撈 117 個分類,再 `Promise.all` 逐分類 `count: 'exact', head: true`;函式自己的 `@TODO #51 / #247` 已寫「改 server-side 聚合」 | repo |
| E9 | 呼叫端 `getCategoryTreeCached`(unstable_cache 60s)+ `singleFlightStale` 60s;`/`、`/products`、facet-counts route 都會用到 | `apps/storefront/src/lib/products.ts` |
| E10 | ~~`vehicle_taxonomy_public` 全掃 1,199ms ⇒ 變慢~~ ⛔ **更正(§P2 v2)**:那發是忙時量的;同一計畫同一 buffer 數(shared hit 115,281)晚上重量 199–228ms,與函式 COMMENT 的 211ms 相同 ⇒ **沒有退化** | 正式庫 EXPLAIN;`20260906400000:100` COMMENT |
| E11 | `catalog_facet_counts` 只選品牌(未選車型 / 年)最壞 3,959.8ms > anon 3s;edge_logs 24h 133 次、7 次 5xx | `20260912010000` 檔內自量;edge_logs |
| E12 | `search_catalog_by_vehicle` edge_logs 24h 2,160 次、平均 575ms、最大 7.7s、12 次 5xx;根因已有 plan(變體 SKU seq scan 佔 78%) | edge_logs;`docs/plans/2026-09-11-search-rpc-timeout-root-cause-plan.md` |
| E13 | 推薦 `listByFitment` 187ms、`listGeneral` 1ms;800 列品牌池 JSON ~1.6MB、215ms —— 推薦本身不慢,是排在隊伍後面 | 正式庫 EXPLAIN |
| E14 | 排程(pg_cron)36h 全部 < 1s;供應商同步每天一次約 09:31–09:53 UTC —— 都不是主因 | `cron.job_run_details`、`supplier_sync_runs` |

## 3. 每一組逾時的成因與處置

| 組 | 成因 | 處置 |
|---|---|---|
| A `get_vehicle_taxonomy` TimeoutError | 排隊(E3–E6)。~~次:view 變慢到 1.2s(E10)~~ ⛔ §P2 v2 更正:沒變慢 | TS 限流(§3-1)緩解排隊;P1 治本;§P2 不改 DB。客人面:背景重建失敗會留舊值(unstable_cache + singleFlightStale),多數人看到舊資料不是空白 |
| B `catalog_facet_counts` 57014 → 503 | 主:只選品牌那一形本身 > 3s(E11);次:排隊 | ⇒ **P3**。客人面:側欄件數顯示讀不到的提示(`vehicle-facet-display.tsx` 已處理 503) |
| C 推薦 timeout | 排隊(E13 單發不慢) | TS 限流緩解;⚠️ 推薦失敗時空結果會被快取 60 秒 ⇒ §4 待決 |
| D 背景重建逾時(brand-taxonomy / category-tree / catalog-page / pdp-by-handle) | 排隊;`category-tree` 本身就是 E6 的來源 | TS 限流;P1 治本 |
| E `search_catalog_by_vehicle` 57014 | 查詢本身慢(E12)+ 排隊 | ⇒ **P4 = 既有 plan 2026-09-11**,本檔不重寫 |

### 3-1 已做的 TS 修(同分支 commit,不需 DB)
- `listCategories` 逐分類 count 從「一次全送 117 發」改成「同時最多 6 發」,順序與數字不變;加一格測試釘上限。
- 射程:**不減少總發數**,只把尖峰攤平;一輪會變慢(117 ÷ 6 × 每發約 0.1–0.35 秒 ≈ 2–7 秒),而它跑在背景重建與單飛之後,客人前景通常拿快取。
- 上線後要看的:edge_logs 那一形的每分鐘最大並發應降、postgrest「Thread killed」次數應降。

## 4. DB 端 plan(待核)

### P1 分類件數改一支 GROUP BY 函式(治本 E6–E8)
- 新增 `public.catalog_category_counts()`:`LANGUAGE sql STABLE SECURITY INVOKER`、`SET search_path = public, pg_temp`,
  `SELECT category_id, count(*) FROM public.products_list_public GROUP BY category_id`(形狀照既有 `catalog_brand_counts`,`20260712183000:111`)。
  - 權限照 `catalog_brand_counts`:REVOKE PUBLIC,GRANT EXECUTE 給 anon / authenticated / service_role(它本來就是公開上架計數;依房規新物件出生帶 anon 權限 ⇒ 四道 REVOKE 後只補這三個)。
  - 基底量:`products_list_public` 全表 group by 唯讀 EXPLAIN ≈ 8k buffers(比 117 發各自掃便宜很多)。
- adapter `listCategories` 改成:撈分類 + 一發 `rpc('catalog_category_counts')`,缺的分類補 0;經銷價防護不變(函式只回 id 與件數)。
- 影響:每輪 117 發 ⇒ 1 發;edge_logs 那一形 18,112 秒/天 應接近歸零。
- 部署順序:函式先貼(記帳)⇒ adapter 才合(`.rpc(` 新函式,部署時序閘會擋)。
- Rollback:revert adapter ⇒ `DROP FUNCTION public.catalog_category_counts()`。
- 驗收:拋棄式 PG 逐分類件數與舊法逐發 count 相同(含 0 件、未上架不算);adapter 測試改釘「只打一發 rpc」;上線後 edge_logs 那一形消失。

### P2 `vehicle_taxonomy_public`「211ms → 1.2s」—— v2 2026-09-15 晚量完:**不是退化,不改 DB**

**結論(白話)**:車款下拉那支查詢**沒有變慢**。早上量到 1.2 秒那一發,是在資料庫最忙的時候量的;
晚上用同一句、同一個計畫、同一個工作量重量,是 0.2 秒,跟 09-06 寫下的 211ms 一樣。
客人那邊偶爾拿不到車款清單,原因是 P1 那個排隊(請求等了 15 秒被網站放棄),不是這支本身慢。

**證據(全部唯讀,每發 10s 上限)**

| # | 事實 | 出處 |
|---|---|---|
| G1 | 沒有人改寫過:view 最後一代 `20260811100000`、函式只有一代 `20260906400000`(211ms 就是這一代的 COMMENT) | `bash scripts/latest-definition-of.sh get_vehicle_taxonomy` / `vehicle_taxonomy_public` |
| G2 | 同一句 `EXPLAIN (ANALYZE, BUFFERS)` 全掃:早上 1,199ms、**shared hit 115k**;晚上 **228ms**(TIMING OFF 199ms)、**shared hit 115,281**、12,404 列 ⇒ 計畫與工作量相同、全部在記憶體(沒有 read)⇒ 早上那 1 秒是 CPU / 連線爭用 | 正式庫唯讀 EXPLAIN,兩次 |
| G3 | 函式本體等價句(`jsonb_agg … ORDER BY`)牆鐘 295 / 297 / 300ms,同連線 `SELECT 1` 基線 68–71ms ⇒ 查詢本身 ≈ 225ms | 正式庫唯讀 `\timing` |
| G4 | 資料量:`product_fitments_effective` 在 09-06 06:55 UTC 從 168,796 列跳到 280,397,之後穩在 279k–285k;`product_fitments` 193,014 列;view 輸出 12,197 → 12,404 列(+1.7%) | `product_fitments_effective_sync_log`、`pg_stat_user_tables` |
| G5 | 統計是新的:pfe autoanalyze / autovacuum 09-14 23:06 UTC(每日同步後);pf autoanalyze 09-14 10:23、自上次 analyze 改動 5,752 列(3%) | `pg_stat_user_tables` |
| G6 | 真實呼叫 24h:`/rest/v1/rpc/get_vehicle_taxonomy` **0 次 5xx**;忙時段(01–07 UTC,每小時 39–218 發)p50 349–373ms;冷時段(08–13 UTC,每小時 <10 發)p50 0.8–1.4s、最大 2.3s | Supabase edge_logs 按小時 |
| G7 | Vercel 那 6 次 `get_vehicle_taxonomy` TimeoutError = client 等滿 15 秒(`CATALOG_FETCH_TIMEOUT_MS`),DB 側同期 0 次 5xx ⇒ 卡在 PostgREST 排隊(§2 E3–E6) | Vercel runtime errors 7 天、edge_logs |

**處置**
- ✅ **不改 DB、不寫 migration**。P2 的客人面症狀交給 P1(板 191)。
- 旁註(不修):冷時段 p50 ~1s(G6)吻合「共用記憶體 256MB 裝不下 fitments 兩張表 + 索引(pf 42MB、pfe 140MB)」,未證實;客人前景讀的是 1 小時快取(`VEHICLE_TAXONOMY_REVALIDATE_SECONDS = 3600`),不是每次打 DB。
- ⛔ 撤回 v1 列的三個候選(補索引 / 改寫 view / 快照表):前提「變慢了」不成立。
- 🔎 可選的最小改善(**不是 migration,是維運動作;要做由主視窗 / Sean 決定**):晚上那發 `product_fitments` 的 index-only scan 有 **Heap Fetches 65,904**(同表 dead tuples 13,134、上次 autovacuum 09-14 10:23 UTC)⇒ 可見性地圖不全,「只讀索引」其實回表了;pf 兩處各約 57k buffer hits 大多來自這裡。
  `VACUUM (ANALYZE) public.product_fitments;` 預期把兩次 pf 掃描變成真的 index-only(估計全掃可再省一半,**未量**)。
  代價:VACUUM 不擋讀寫(只拿 SHARE UPDATE EXCLUSIVE),會吃 IO;自動 vacuum 也會做到同一件事,只是時間不定。rollback:無(不改資料)。

### P3 `catalog_facet_counts` 只選車廠 > 3s(E11)—— v2 2026-09-15 晚量完:**不改 DB**

> 「只選品牌」= 只選**車廠**(`p_brand` 有值、`p_model` / `p_year` 空,例 `?vehicle=ducati`)。主視窗派工版本號 20260916120000 **未使用**。

**結論(白話)**:這個查詢在資料庫「不忙」的時候只要 0.2–0.3 秒,離 3 秒上限還有 10 倍以上。
客人碰到的那 7 次失敗,全都發生在資料庫被 P1 那 117 發塞滿的同一個小時。⇒ **修 P1 就是修 P3**;改這支函式最多快 20%,不值得動。

**證據(全部唯讀)**

| # | 事實 | 出處 |
|---|---|---|
| F1 | 正式庫是 PG 17.6;`work_mem` = 3500kB | 正式庫 `select version()` / `show work_mem` |
| F2 | **PG17 的 SQL 函式走 generic plan**:實際呼叫函式時 matched 的條件印成 `moto_brand = $3`、`hashed SubPlan 1` | 拋棄式 PG(dump + 178–190 + 100000 + 合成資料)`auto_explain` log_nested_statements |
| F3 | 同一句用 generic plan、Ducati(fitments 195,036 列 → 5,619 商品,全庫最大):**熱 264ms**、shared hit 118k、195k 列排序溢到磁碟 3.8MB;Yamaha 130ms、Kawasaki 146ms、BMW 128ms、Jawa 101ms、沒車 120ms | 正式庫唯讀 `PREPARE` + `plan_cache_mode=force_generic_plan` + EXPLAIN (ANALYZE, BUFFERS) |
| F4 | 冷快取時光 matched 就 5,978ms(`product_fitments_effective` 索引讀盤 6,131 頁)| 正式庫唯讀 EXPLAIN ANALYZE,當晚第一發 |
| F5 | edge_logs 24h:169 發,各小時 p50 68–763ms;**7 發失敗全部卡在 3,023–3,110ms**(= anon 3s 上限) | Supabase edge_logs `/rest/v1/rpc/catalog_facet_counts` 按小時 |
| F6 | 同 24h postgres_logs「statement timeout」按小時:04:00 UTC 14 次(那小時 facet 失敗 3 發)、02:00 3 次、07:00 4 次、13:00 3 次 ⇒ 失敗與全庫逾時潮同時出現 | Supabase postgres_logs |
| F7 | 🔴 同一句若走 **custom plan**(參數代入字面 'Ducati'):IN 變成**不 hash 的 SubPlan**、估計成本 1.7 億 ⇒ 正式庫實跑 **> 60 秒**被砍(三發)| 正式庫唯讀 EXPLAIN / 實跑(10s 上限之前那三發是 60s 上限)|

**試過的改法(正式庫唯讀、Ducati、generic、熱)**

| 改法 | 時間 | 為什麼不採 |
|---|---|---|
| 原樣 | 253–268ms | — |
| matched `UNION` → `UNION ALL`(IN 語意不變,去掉 195k 列排序) | 216–230ms(-20%) | 省 50ms 換一次 CREATE OR REPLACE;而且 `apps/storefront/src/lib/facet-predicate-parity.test.ts` 釘住兩支函式要逐字同一段 `… UNION SELECT …`,改一邊就紅,要連列表那支一起改(那支正在施工窗手上) |
| 函式層 `SET work_mem = '16MB'`(排序留在記憶體) | 246–264ms | 沒有變快 |
| g 拆兩支 `UNION ALL`(去掉 OR) | 272ms | 沒有變快 |
| 覆蓋索引 `(moto_brand, model_code, year_start, year_end) INCLUDE (product_id)` | 未量(正式庫不建物件;合成資料的 heap 分布不像正式庫,量了也不代表) | 建索引拿 SHARE 鎖擋 fitments 寫入(供應商同步),效益未證 |

**處置**
- ✅ **不寫 migration**。P3 的 7 次失敗交給 P1(20260916100000,板 191)解;P1 上線後重看 F5 那張表,失敗仍在才回來考慮 `UNION ALL`(兩支一起改)或覆蓋索引。
- 🔴 **已知天花板(記下來,現在不修)**:F7 那條 custom plan 今天走不到,是因為 PG17 的 SQL 函式不用 plan cache(F2)。**PG18 起 SQL 函式改走 plan cache(依 PG18 release notes;本窗未在 PG18 實測),plan cache 前幾次會用 custom plan** ⇒ Supabase 若把專案升到 PG18,「只選 Ducati」**可能**變成 60 秒以上、503。升級前要先改寫 matched(例如 `p.id IN (…)` 拆出 OR,候選見上表第 4 列)並在 PG18 拋棄式 PG 上量。
- ⚠️ 量測本身的代價(照實寫):F7 的三發 60 秒查詢是唯讀,但在正式庫上吃了約 3 分鐘 CPU / IO(2026-09-15 約 13:2x UTC,精確時刻未記);之後的實驗都加 10 秒上限。

### P4 `search_catalog_by_vehicle` 57014
- 照 `docs/plans/2026-09-11-search-rpc-timeout-root-cause-plan.md`(變體 SKU seq scan)走,本檔不重寫。

## 5. 待主視窗 / Sean 決定(TS 端,但會改客人看到的新鮮度或行為)

```
Q1:分類樹 / 品牌件數的快取從 60 秒拉長(例如 10 分鐘)?
A: 甲 拉長 —— 每輪重建次數降 10 倍;代價:分類件數最多晚 10 分鐘(價格 / 庫存不受影響, 那是另一支快取)
A: 乙(推薦)先不動 —— 先看限流 + P1 上線後的量, 不夠再談
```

```
Q2:推薦失敗時的空結果會被快取 60 秒(客人一分鐘內看到沒有推薦)。要不要改成失敗不快取?
A: 甲 改 —— 失敗不進快取;代價:資料庫忙的時候每一頁都會重試推薦查詢, 反而加重排隊
A: 乙(推薦)等 P1 上線、排隊消了再決定 —— 現在改會在最忙的時候放大負載
```

## 6. 效度限制(照實寫)
- pg_stat_statements 唯讀角色讀不到 ⇒ 沒有逐語句的歷史耗時,耗時來自 edge_logs 的 origin_time(含 PostgREST 排隊時間)。
- 唯讀角色對 `get_vehicle_taxonomy` / `catalog_facet_counts` 無 EXECUTE ⇒ 只能 EXPLAIN 底層 view / 近似查詢。
- 「117 發同時送塞滿連線」是由 E5–E8 推得;沒有在正式站做並發壓測(不做)。

## 7. 已知風險
- 🔴 **PG18 升級**:`catalog_facet_counts` 只選車廠(例 Ducati)的同一句,若走 custom plan(參數代入字面)正式庫實跑 > 60 秒(§P3 F7)。
  今天 PG17 的 SQL 函式走 generic plan 所以走不到(§P3 F2,拋棄式 PG auto_explain 證實)。
  PG18 起 SQL 函式改用 plan cache(依 release notes,本窗未在 PG18 實測)⇒ **升級後可能每次 503**。
  ⇒ Supabase 升 PG18 之前:先在 PG18 拋棄式 PG 量這一形,必要時改寫 matched(拆掉 `$3 IS NULL OR p.id IN (…)` 的 OR),與 `search_catalog_by_vehicle` 一起改(parity 測試釘兩支同形)。
