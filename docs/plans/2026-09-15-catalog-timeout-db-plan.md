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
| E10 | `vehicle_taxonomy_public` 全掃 EXPLAIN ANALYZE 1,199ms、shared hit 115k;函式 COMMENT 寫當年全掃 211ms;列數 12,197 ⇒ 12,404(幾乎沒變)⇒ 變慢的是 view 內反向比對(`product_fitments_effective` 284k 列) | 正式庫 EXPLAIN;`20260906400000:100` COMMENT |
| E11 | `catalog_facet_counts` 只選品牌(未選車型 / 年)最壞 3,959.8ms > anon 3s;edge_logs 24h 133 次、7 次 5xx | `20260912010000` 檔內自量;edge_logs |
| E12 | `search_catalog_by_vehicle` edge_logs 24h 2,160 次、平均 575ms、最大 7.7s、12 次 5xx;根因已有 plan(變體 SKU seq scan 佔 78%) | edge_logs;`docs/plans/2026-09-11-search-rpc-timeout-root-cause-plan.md` |
| E13 | 推薦 `listByFitment` 187ms、`listGeneral` 1ms;800 列品牌池 JSON ~1.6MB、215ms —— 推薦本身不慢,是排在隊伍後面 | 正式庫 EXPLAIN |
| E14 | 排程(pg_cron)36h 全部 < 1s;供應商同步每天一次約 09:31–09:53 UTC —— 都不是主因 | `cron.job_run_details`、`supplier_sync_runs` |

## 3. 每一組逾時的成因與處置

| 組 | 成因 | 處置 |
|---|---|---|
| A `get_vehicle_taxonomy` TimeoutError | 主:排隊(E3–E6);次:view 變慢到 1.2s(E10) | TS 限流(§3-1)緩解排隊;view 變慢 ⇒ **P2**。客人面:背景重建失敗會留舊值(unstable_cache + singleFlightStale),多數人看到舊資料不是空白 |
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

### P2 `vehicle_taxonomy_public` 從 211ms 變 1.2s(E10)
- 先量再改:唯讀 EXPLAIN 找出反向比對(anti-join 對 `product_fitments_effective`)實際走的計畫,核對 `product_fitments_effective` 有沒有 `(moto_brand, model_code)` 可用索引、`product_fitments_effective_staging` 0 列而佔 61MB 是否拖到統計。
- 候選(量完擇一,不預設):① 補索引 ② view 改寫 ③ 同步完寫一份快照表、函式讀快照。
- 影響:車款下拉冷重建時間;客人前景多半讀快取。
- Rollback:① DROP INDEX ② / ③ 回舊 view / 函式定義。

### P3 `catalog_facet_counts` 只選品牌 > 3s(E11)
- 候選:① 補索引讓品牌-only 那一形不必掃 `product_fitments ∪ product_fitments_effective` ② 品牌-only 走預先聚合 ③ 改 SECURITY DEFINER 並 `SET statement_timeout` 放寬(**不推薦**:只是讓它慢而不失敗,反而更佔連線)。
- 先唯讀 EXPLAIN 那一形(Ducati、未選 model/year)再定。

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
