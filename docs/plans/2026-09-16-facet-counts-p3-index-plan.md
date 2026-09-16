# 2026-09-16 · 側欄件數偶爾 503(P3 續)—— 索引 / 改寫 plan

> A 窗寫。主視窗 b7 派:0916 前台走查撞到 `/api/catalog/facet-counts` 第一發 503 ⇒ 要排,但碰索引 = 碰 schema ⇒ 鐵則 8,本檔先寫、等 Sean 批,**本檔零 migration**。
> 站上有真客人 ⇒ **加索引一律 `CREATE INDEX CONCURRENTLY`,而且避開白天尖峰**(見 §5)。
> 前情:`docs/plans/2026-09-15-catalog-timeout-db-plan.md` §P3(那時的結論是「不是計畫問題,是爭用,交給 P1」)。**本檔要更正那個結論的一半** —— 板 193 之後這支函式的工作量變大了。
>
> **v2(2026-09-16):55 窗唯讀挑過,改了三處** —— ① P3a 原本寫得太省、有**雙算洞**(§3-1 補上逐塊 WHERE)② 「與 `cand` 同形」只對一半(§3-1 註)③ 「靠 LANGUAGE sql 走 generic plan」的理由是錯的(§3-3)。
> 🔴 **而 55 提的「更簡單的路:加 `unstable_cache`」前提不成立** —— 那支快取**早就有了**(§0)。本檔把它改寫成「快取還能怎麼調」。

## 0. 先更正一個前提:快取**已經有了**

- `apps/storefront/src/lib/vehicle-facet-counts.ts:161-196`(`origin/main` 實查)已經包 `unstable_cache`:
  key `['catalog-facet-counts-v2']`、`revalidate: CATALOG_REVALIDATE_SECONDS`(= **60 秒**)、`tags: ['catalog']`,
  外面還有 process 內 `inFlight` single-flight(`:196`)與 `withFanoutSlot`(同時最多 3 發)。
- ⇒ **「route 現在每個客人每次都打 DB」是錯的。** 正確說法:**命中同一個 key 的 60 秒內不打 DB;而 key 很細** ——
  key = 車(廠 / 型 / 年)+ 分類 key 清單 + 品牌 slug 清單 + **已選分類** + **已選品牌**
  ⇒ 858 個車型 × 年份 × 使用者點的組合 ⇒ **多數真實請求是冷 key,還是會打 DB**,走查那一發 503 就是冷 key。
- ⚠️ **新增任何一支 `unstable_cache` 會讓 `apps/storefront/src/lib/catalog-tier-all-paths.test.ts` 的清冊紅**
  (`EXPECTED_UNSTABLE_CACHE`,逐檔數個數)⇒ 那是刻意的閘:多一支就要先回答「這份快取裡有沒有經銷價」。改動要同批更新清冊並寫答案。

## 1. 白話

- 客人選了車以後,左邊那排「每個分類 / 品牌各幾件」偶爾整排讀不到(畫面顯示讀取失敗;商品列表本身正常,不影響下單)。
- 原因:那支查詢現在**每次都要掃完整張商品表**(26,491 列、12 萬個 buffer)。平常 0.2 秒,資料庫一忙就超過匿名查詢的 3 秒上限 ⇒ 整排件數消失。
- 為什麼變重:板 193(Q8「選車也列通用款」)給它加了 `OR 通用款` 這個條件 ⇒ 原本可以只看「這台車的商品」,現在必須看全部商品。
- 三條路,**由淺到深**:
  1. **P3-0 調快取**(零 migration、零 schema):現在已經有 60 秒快取,但 key 太細 ⇒ 多數請求是冷 key。把冷 key 變少、或失敗時回上一份,503 就會變少。
  2. **P3a 改寫函式**(不碰 schema):把 `OR` 拆成分塊,選車時不再掃全表。
  3. **P3b 補覆蓋索引**(碰 schema):省掉「只選車廠」那一形的回表。

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

## 3. 改什麼(三片,可分開批;建議順序 P3-0 → 量一輪 → 再決定 P3a / P3b)

### P3-0(**零 migration、零 schema**,建議先做):讓冷 key 變少 / 失敗不要變 503
現況見 §0:快取在,60 秒,key 很細。四個可各自獨立做的調整:
- **(a) 通用款那一塊與「選哪台車」無關** ⇒ 可以整塊算一次、單獨快取重用(55 窗指出,這半我同意)。
  ⚠️ 新增一支 `unstable_cache` ⇒ 要同批更新 `EXPECTED_UNSTABLE_CACHE` 清冊並回答「有沒有經銷價」(答案:只有件數,沒有價格欄)。
- **(b) 粗化 key**:已選分類 / 已選品牌**已經**排序後才進 key(`vehicle-facet-counts.ts:213-216`),但「車 + 年」仍各自成 key。
  ⚠️ 粗化 = 少一維就少一份精準度 ⇒ **會改變客人看到的數字**(例如把年份併掉)⇒ 這一項要 Sean 裁,不能工程自己決定。
- **(c) 拉長 TTL**:🔴 `CATALOG_REVALIDATE_SECONDS` **同時餵七支快取**(`products.ts:155-170` 逐字列著),含 `catalog-page-v4`
  ⇒ 拉長它 = 商品列表價格也跟著晚 ⇒ **不能直接改那個常數**;要做就是把 facet 這支**分家成自己的秒數**(照 `VEHICLE_TAXONOMY_REVALIDATE_SECONDS` 的前例)。時長是 Sean 的題。
- **(d) 失敗回上一份而不是 503**:現在 `fetchFacetCounts` 失敗回 `null` ⇒ route 回 503 ⇒ 側欄整排消失。
  可改成「有舊值就先用舊值」(同 `singleFlightStale` 的形狀)。⚠️ 代價:客人可能看到最多 N 秒前的件數,而**不知道它是舊的** ⇒ 也要 Sean 裁(現行設計是「寧可不顯示,也不顯示錯的」,#306 的原則)。
- 🔬 先做 (a)(d) 這兩個不改數字定義的,量一輪 edge_logs 5xx 再決定 (b)(c)。


### P3a(**不碰 schema**,建議先做):把 `OR` 拆成兩塊 `UNION ALL`
- 現在:`WHERE p_brand IS NULL OR p.id IN (SELECT product_id FROM matched) OR p.fitments = '[]'::jsonb`
- 改成 `g` 由三塊 `UNION ALL` 組,**每一塊都要自己帶條件**(55 窗挑出的雙算洞 —— 少一個 `p_brand IS NOT NULL`,沒選車時通用款會同時落進 ① 與 ③,件數灌水;現行單一 `OR` 一次掃描每件只數一次,所以這是改寫**獨有的新洞**):
  - ① 沒選車:`WHERE p_brand IS NULL`(整表)
  - ② 選車 · 專用:`WHERE p_brand IS NOT NULL` **且** `JOIN public.products_list_public p ON p.id = m.product_id`
    🔴 一定要 JOIN 目錄投影 —— `matched` 可能指到**不在目錄**的商品(下架 / 沒品牌 / 沒分類),直接數 `matched` 會多算。
  - ③ 選車 · 通用款:`WHERE p_brand IS NOT NULL AND p.fitments = '[]'::jsonb AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = p.id)`
  - 🔴 `matched` **維持 `UNION` 不可改 `UNION ALL`**:pf 與 pfe 會有同一個商品,改了就重複計數。
- ⚠️ **「與 `cand` 同形」只對一半**(55 窗訂正):`cand` 的 ②③ 互斥寫法(`NOT EXISTS matched`)確實同形,但 **`cand` 沒有「沒選車」那一塊** —— 列表那支是 plpgsql,用 `IF p_brand IS NULL` 走**另一支**查詢。①那一塊**沒有前例可抄**,要自己寫、自己驗。
- 預期:選車時不再 `Seq Scan on products` 全表(②只碰命中的商品、③只碰 5,657 件通用款)⇒ 12 萬 buffer 掉到約 **1–2 萬**。
- 🔴 **為什麼分塊不會反而變慢(理由訂正)**:⛔ ~~「因為是 `LANGUAGE sql` 走 generic plan」~~ —— 那是錯的。
  正確的理由:每塊的條件**只看參數、不看列**(`p_brand IS NULL`)⇒ 執行器把它當 `One-Time Filter`,不符的那塊整塊跳過;
  這在 **custom 與 generic 兩種 plan 都成立,與 `LANGUAGE sql` 無關**。
  📌 出處:**55 窗已在拋棄式 PG 實跑**(`force_generic_plan` 下每塊拿到 `One-Time Filter: ($1 IS NULL)`、不符的印 `never executed`;custom plan 則整個摺掉分支)—— 證據在 55 窗的回報,**A 窗未親見**。
  ⚠️ 而**別人跑過不等於我們這支新版跑過** ⇒ 驗收那格照留(§7)。
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
- 🔴 **雙算專門一格**:沒選車時,通用款商品在結果裡**恰好出現一次**(把 ①③ 的件數分開數,總和 = 目錄總件數)。
- 🔴 **計畫形狀**:新版 `EXPLAIN` 要看得到 `One-Time Filter`,而**不符的分支印 `never executed`**(generic 與 custom 兩種 plan_cache_mode 各跑一次)。
- P3-0:量 edge_logs `catalog_facet_counts` 的**冷 key 比例**與 5xx 次數(改前 45 分鐘 4 發 1 次 5xx)。
- 正式庫唯讀 EXPLAIN:916+2026 與車廠-only 兩形的 buffers 與時間,對照本檔 §2。
- 上線後 24h:edge_logs `catalog_facet_counts` 的 5xx 次數與 p90(現況:45 分鐘 4 發 1 次 5xx、最慢 3,040ms)。

## 8. 效度限制
- §2 全部是**唯讀、熱快取、generic plan** 的讀數;客人撞到的那一發是**冷 + 忙**,本檔沒有重現那個狀態(不在正式庫做壓測)。
- P3b 的改善幅度**未量**(正式庫不建索引);批准後才在拋棄式 PG 量。
- F7 的 `idx_scan` 是累計值,不是今天的。
