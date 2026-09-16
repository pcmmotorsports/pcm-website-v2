# 2026-09-16 · 側欄件數偶爾 503(P3 續)—— 索引 / 改寫 plan

> A 窗寫。主視窗 b7 派:0916 前台走查撞到 `/api/catalog/facet-counts` 第一發 503 ⇒ 要排,但碰索引 = 碰 schema ⇒ 鐵則 8,本檔先寫、等 Sean 批,**本檔零 migration**。
> 站上有真客人 ⇒ **加索引一律 `CREATE INDEX CONCURRENTLY`,而且避開白天尖峰**(見 §5)。
> 前情:`docs/plans/2026-09-15-catalog-timeout-db-plan.md` §P3(那時的結論是「不是計畫問題,是爭用,交給 P1」)。**本檔要更正那個結論的一半** —— 板 193 之後這支函式的工作量變大了。

## 1. 白話

- 客人選了車以後,左邊那排「每個分類 / 品牌各幾件」偶爾整排讀不到(畫面顯示讀取失敗;商品列表本身正常,不影響下單)。
- 原因:那支查詢現在**每次都要掃完整張商品表**(26,491 列、12 萬個 buffer)。平常 0.2 秒,資料庫一忙就超過匿名查詢的 3 秒上限 ⇒ 整排件數消失。
- 為什麼變重:板 193(Q8「選車也列通用款」)給它加了 `OR 通用款` 這個條件 ⇒ 原本可以只看「這台車的商品」,現在必須看全部商品。
- 兩條路:**改寫那支函式**(把 OR 拆成兩塊,主因)+ **補一個覆蓋索引**(次因,省掉查車型時的回表)。

## 2. 量到的(正式庫唯讀,每發帶 `statement_timeout = 10s`;2026-09-16 08:1x 台灣)

| # | 事實 | 出處 |
|---|---|---|
| F1 | 走查實撞:`/api/catalog/facet-counts?vehicle=ducati:916:2026` 第一發 **503(3.3s)**,同一網址重試兩次 200(1.86s / 0.44s) | 0916 前台走查 |
| F2 | edge_logs 45 分鐘內該 RPC 4 發、**1 發 5xx**、最慢 **3,040ms** ⇒ 撞 anon 3s | Supabase edge_logs |
| F3 | 🔴 **現行函式(板 193 版)的計畫:`Seq Scan on products`**,`Filter: ($3 IS NULL) OR (ANY (id = (hashed SubPlan 1).col1)) OR (fitments = '[]'::jsonb)`,**shared hit 120,430** | 正式庫唯讀 EXPLAIN(ANALYZE, BUFFERS),generic plan |
| F4 | 熱快取執行時間:916 + 2026 = **155.5ms**;只選車廠 Ducati = **278.7ms**(另計時 224.6 / 317.5ms) | 同上 |
| F5 | 只選車廠時,`matched` 的 195k 列排序**溢到磁碟 3,824kB**(external merge) | 同上 |
| F6 | `matched` 單獨跑:916 + 2026 = **0.68ms**;只選車廠 Ducati **5,475ms**(冷,read=2,092)⇒ 車廠-only 的成本在 `matched`,車型+年份的成本**不在** matched | 正式庫唯讀 EXPLAIN |
| F7 | 索引現況:`ix_pf_lookup` 3,416 kB(idx_scan 5.37 億)· `ix_pfe_lookup` 6,808 kB(80,440)· `ix_pfe_product` 7,040 kB(11,466)· `ux_pfe_row` · `product_fitments_pkey` 12 MB **idx_scan = 0** | `pg_stat_user_indexes` |
| F8 | 車廠-only 的 pfe 掃描走 `ux_pfe_row` index-only(Heap Fetches 0,6,158 buffers);而 pf 走 `ix_pf_product` + Filter,**Rows Removed by Filter 119,135**、26k buffers | 正式庫唯讀 EXPLAIN |

⇒ **兩個不同的成本**:
- (甲)**全表掃**:板 193 的 `OR fitments = '[]'` 讓每一形都掃完 products(F3,12 萬 buffer)。這是 155–318ms 的主體,也是忙的時候撞 3s 的主因。
- (乙)**車廠-only 的 matched**:195k 列取聯集 + 排序溢碟(F5、F6)。冷的時候 5.5 秒(F6)。

## 3. 改什麼(兩片,可分開批)

### P3a(**不碰 schema**,建議先做):把 `OR` 拆成兩塊 `UNION ALL`
- 現在:`WHERE p_brand IS NULL OR p.id IN (SELECT product_id FROM matched) OR p.fitments = '[]'::jsonb`
- 改成 `g` 由三塊 `UNION ALL` 組:①沒選車(`p_brand IS NULL`)整表 ②選車:`JOIN matched` ③選車:通用款(`fitments = '[]'` 且不在 matched)——與 `search_catalog_by_vehicle` 的 `cand` 同形。
- 預期:選車時不再 `Seq Scan on products` 全表(②只碰命中的商品、③只碰 5,657 件通用款)⇒ 12 萬 buffer 掉到約 **1–2 萬**。
- 🔴 這支是 `LANGUAGE sql` ⇒ PG17 走 generic plan(P3 F2 已證),`UNION ALL` 不會掉進 plpgsql custom plan 那個坑。
- 版本號待主視窗指定;`CREATE OR REPLACE FUNCTION`,不動表、不鎖表。

### P3b(**碰 schema**,要 Sean 批):`product_fitments_effective` 覆蓋索引
- `CREATE INDEX CONCURRENTLY ix_pfe_lookup_cover ON public.product_fitments_effective (moto_brand, model_code, year_start, year_end) INCLUDE (product_id);`
- 為什麼:車廠-only 的 `matched` 現在靠 `ux_pfe_row`(6 欄唯一索引)硬掃(F8);帶 `INCLUDE (product_id)` 之後那一段可以純索引取值。
- 預期:(乙)那條冷掃 5.5 秒的路變短;**幅度未量**(正式庫不建物件)⇒ 批准後先在拋棄式 PG 用同量級合成資料量,再決定要不要真的上。
- 代價:多 ~7 MB 索引;每日同步換表時多維護一份索引。
- ⚠️ `product_fitments_pkey` 12 MB 而 `idx_scan = 0`(F7)⇒ 另一個可討論的題(拿掉能省寫入成本),**本檔不提議動它**,只記下來。

### 不做
- 放寬 anon 的 `statement_timeout`:那只是把「讀不到」變成「更久才讀到」,而且占住連線(P3 §已記)。
- 把側欄件數拿掉 / 改前端算:會回到 2026-09-12 之前那個「面板數字與點進去不一致」的病。

## 4. 影響範圍
- 讀取面:`/api/catalog/facet-counts`(目錄頁側欄);列表、搜尋、商品頁不受影響。
- P3a:只換函式本體,回傳形狀不變 ⇒ TS 不用改。
- P3b:只加索引,不改任何查詢語意;查詢計畫可能改走新索引(要在拋棄式 PG 先看計畫)。

## 5. 鎖與時段(🔴 站上有真客人)
- **索引一律 `CREATE INDEX CONCURRENTLY`**:不拿 ACCESS EXCLUSIVE、不擋讀寫;代價是**不能包在交易裡**(⇒ 這一片的 migration 不能用 `BEGIN; … COMMIT;` 那個慣例,要單獨一支、失敗時可能留下 INVALID 索引,退回就是 `DROP INDEX CONCURRENTLY`)。
- **避開白天尖峰**:貼板時段照 memory `0915-site-launched`(鎖表的板避開客人多的時段);建議台灣時間深夜。
- 每日 16:10 UTC 的 `product_fitments_effective` 同步會整表換 ⇒ **不要在同步前後 30 分鐘內建索引**。
- P3a 換函式:`CREATE OR REPLACE FUNCTION` 只拿函式鎖,PostgREST reload 前可能一瞬 PGRST202(route 已有 fail-safe:回 503 顯示「件數讀不到」,不會印錯數字)。

## 6. Rollback
- P3a:`supabase/rollbacks/<版本>-rollback.sql` 把函式換回板 193 那一代(md5 釘)。
- P3b:`DROP INDEX CONCURRENTLY IF EXISTS public.ix_pfe_lookup_cover;`(同樣不能包交易)。
- 兩片互相獨立,可各自退。

## 7. 驗收(批准後)
- 拋棄式 PG:schema dump + 板 178–194 + 本片;側欄件數**逐格與改前相同**(只准變快,不准變數字)。
- 正式庫唯讀 EXPLAIN:916+2026 與車廠-only 兩形的 buffers 與時間,對照本檔 §2。
- 上線後 24h:edge_logs `catalog_facet_counts` 的 5xx 次數與 p90(現況:45 分鐘 4 發 1 次 5xx、最慢 3,040ms)。

## 8. 效度限制
- §2 全部是**唯讀、熱快取、generic plan** 的讀數;客人撞到的那一發是**冷 + 忙**,本檔沒有重現那個狀態(不在正式庫做壓測)。
- P3b 的改善幅度**未量**(正式庫不建索引);批准後才在拋棄式 PG 量。
- F7 的 `idx_scan` 是累計值,不是今天的。
