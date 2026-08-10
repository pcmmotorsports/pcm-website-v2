-- 20260811020000_m4b_storefront_277_vehicle_taxonomy_effective_view.sql
-- backlog #277:車輛下拉補上 inherited fitment(純推導子款目前選不到)
--
-- ⚠️⚠️ 本片是**主視窗裁的 B1 案,Sean 睡覺中、待晨間追認**。
--      行為改變(見 §3)。否決的回退成本 = 單支 migration DROP + app 層單一 commit revert。
--
-- ══ 1. 這支在解什麼(數字為 2026-08-11 正式庫唯讀實查)══════════════════════════
--
--   direct 層(product_fitments)                    2,196 組(moto_brand, model_code)
--   effective 層(inherited 展開後)                 2,390 組
--   只在 effective、direct 查無 → 客人在下拉選不到    **198 組 = 8.3%**
--
-- 不是冷門車:MT-07 ABS / Ninja 400 SE / CB650R Neo Sports Cafe / GL 1800 Gold Wing Tour /
-- 790 Duke L / Norden 901 Expedition …(KTM 24、Kawasaki 24、Yamaha 23、Honda 17 台)。
-- 🔴 它躺了一個月的原因就寫在 backlog #277 原文:「MT-09 SP 因有 74 件 direct 仍在下拉、未擋 S1 驗收」
--    —— 那正是這個 bug 的偽裝:熱門車碰巧有 direct 標記,所以驗收時看起來是好的;
--    壞掉的是只靠繼承才對應得上的衍生車型,而**客人不會回報**,他只會以為我們沒賣他的車。
--
-- ══ 2. 🔴 為什麼是 definer rights(`security_invoker = false`)—— 這是本片最該被審的一行 ══
--
-- 我原本寫的是 `security_invoker = true`(與 products_public 等慣例一致)。**那個版本會逾時。**
-- `security_invoker = true` ⇒ 底表 `product_fitments_effective` 的 RLS 述詞
--   `EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.delisted_at IS NULL)`
-- 會被套進查詢 ⇒ 就是下表量到的 3,047ms 那個形狀。
--
-- EXPLAIN (ANALYZE, BUFFERS) 實測,三種形狀、全部 shared hit 零 read:
--
--   DISTINCT + EXISTS(母商品未下架)        3,047 ms   ❌
--   DISTINCT + NOT EXISTS(母商品已下架)    3,141 ms   ❌
--   DISTINCT 四欄、不看下架                  **52 ms**  ✅
--
-- 🔴 **`anon` 的 statement_timeout = 3s**(實查 `pg_roles.rolconfig`;8s 那個是
--    `authenticated` / `authenticator`,別再引錯角色)⇒ 前兩種形狀對客人**必定逾時**。
--
-- 差別的原因:底表已有 `ix_pfe_lookup (moto_brand, model_code, year_start, year_end)`。
-- 不碰 `product_id` ⇒ **Index Only Scan、Heap Fetches: 0、544 buffers ⇒ 52ms**;
-- 只要為了下架過濾去碰 `product_id`,那支窄索引就用不上,退化成 3 秒。
-- ⇒ 成本在**掃描與 join**,不在 RLS。(所以「改 SECURITY DEFINER 函式」也救不了 ——
--    只要它一樣要排除下架,它一樣 3 秒。這點是本片實測推翻的一個既有假設。)
--
-- **本 view 曝露什麼**:只有四欄「廠牌 / 車型 / 年份範圍」,**零 product_id、零價格、零供應商**。
-- 繞過 RLS 之後多看到的東西 = 「只出現在已下架商品上的車款名稱」——那是世界上存在的機車型號,
-- 不是本站的商業資訊。這是刻意的取捨,不是疏忽。
-- ⛔ **不要因此往這支 view 加欄位**。加 `product_id` 或任何商品欄 = 把它變成一條繞過 RLS 的
--    商品查詢路徑,那就是真的洩漏。要加欄位請先回到 §2 重讀一次為什麼它是 definer。
--
-- ══ 3. 🔴 行為改變與失效條件(不要只讀「今天只有 1 台」就當它安全)═══════════════
--
-- 今天的 taxonomy 走 `products_public`(RLS 藏下架)⇒ **現況是排除下架的**。本片改成不看下架。
--
-- 🔴 **代價的數字被我量錯過一次,更正記在這裡**(codex 對抗審查 must-fix,已實查更正):
--   第一版我用 `(moto_brand, model_code)` 兩欄對帳,得到「今天只有 **1** 組幽靈」——
--   **粒度錯了**。本 view 的唯一性是**四欄**,兩欄對帳會讓「同一車型只要還有任一未下架年份」
--   就整個車型算成 live,**漏掉幽靈的年份區間**。
--   四欄實測:13,133 組 vs 未下架 13,096 組 ⇒ **今天是 37 組幽靈,不是 1 組**(0.28%)。
--   ⚠️ 那 37 組裡只有 1 組是「整個車型都沒有未下架商品」,其餘 36 組是**車型還在、但某個年份區間
--   點進去 0 結果**。客人感受不同:前者選不到差別不大,後者是「選得到卻空手」。
--
-- ⚠️ **37 是時點觀察,不是結構保證。** 失效條件:
--   **哪天大量下架(換供應商、清目錄),幽靈數會跟著長,而症狀是「客人選得到、結果 0 筆」——
--   客人看得到、系統不會叫、測試也不會紅。**
-- ⇒ 對帳查詢寫在下面(**四欄版**),任何人都可以跑;數字明顯變大就該把 #389(matview 正解)排上來。
--
--   -- #277 幽靈車型對帳(2026-08-11 基準 = 37;明顯變大 ⇒ 排 #389)
--   -- 🔴 粒度必須是四欄,與 view 的唯一性一致;只比兩欄會漏掉幽靈年份區間(codex 抓到的那個錯)。
--   -- 這是維運對帳、不走 anon,3s 限制不適用。
--   WITH all_t AS (
--     SELECT DISTINCT moto_brand, model_code, year_start, year_end
--     FROM product_fitments_effective),
--        live_t AS (
--     SELECT DISTINCT e.moto_brand, e.model_code, e.year_start, e.year_end
--     FROM product_fitments_effective e
--     JOIN products p ON p.id = e.product_id
--     WHERE p.delisted_at IS NULL)
--   SELECT (SELECT count(*) FROM all_t) - (SELECT count(*) FROM live_t) AS ghost_tuples;
--
-- **正解是 #389**(materialized view 存正確的 join 版、由 ingest 鏈 refresh;refresh 歸屬跨 repo=
-- 報價單側)。本片是「198 台熱門車今晚就看得到」與「等跨 repo 協調」之間的取捨,主視窗裁 B1。
--
-- ══ 4. rollback ═══════════════════════════════════════════════════════════════
--
-- 純新增物件、零資料面:`DROP VIEW IF EXISTS public.vehicle_taxonomy_public;`
-- ⚠️ 收割面(主視窗 2026-08-11 交辦):本片進 dev 後 migrations 目錄尾端會動
--    ⇒ w7 家族 LINE_TIP 與 b2s2b NEWEST_TS 需重釘;**revert 時尾端回退、那些釘值要同步**。

CREATE OR REPLACE VIEW public.vehicle_taxonomy_public
  WITH (security_invoker = false) AS
SELECT DISTINCT
  moto_brand,
  model_code,
  year_start,
  year_end
FROM public.product_fitments_effective;

GRANT SELECT ON public.vehicle_taxonomy_public TO anon, authenticated;

COMMENT ON VIEW public.vehicle_taxonomy_public IS
  '車輛下拉用的 DISTINCT 投影(#277):moto_brand / model_code / year_start / year_end 四欄,'
  '來源 product_fitments_effective(含 inherited 展開)。2026-08-11 實測 149,015 列 → DISTINCT 13,133 列。'
  '🔴 存在理由=direct 層漏掉 198 組(8.3%)純推導子款,客人在下拉選不到自己的車(MT-07 ABS / Ninja 400 SE / CB650R / Gold Wing Tour…)。'
  '🔴 security_invoker=false 是刻意的:invoker 版會套底表 RLS 的下架 join ⇒ 實測 3,047ms,而 anon 的 statement_timeout 只有 3s ⇒ 必定逾時;'
  '不碰 product_id 才走得到 ix_pfe_lookup 的 Index Only Scan(52ms)。成本在掃描不在 RLS。'
  '⛔ 不得加 product_id 或任何商品欄——那會讓本 view 變成繞過 RLS 的商品查詢路徑。'
  '⚠️ 行為改變:本 view 不排除下架商品的車款 ⇒ 會出現「選得到但 0 結果」的幽靈項(2026-08-11 實測 **37 組四欄組合**,'
  '其中僅 1 組是整個車型、其餘 36 組是車型還在但某年份區間空手;第一版誤用兩欄對帳報成 1 組,已由 codex 抓出並更正)。'
  '🔴 失效條件:大量下架時幽靈車型數會成長,症狀是客人選得到、結果 0 筆——客人看得到、系統不會叫、測試不會紅。'
  '對帳查詢寫在本 migration 檔 §3;正解=#389(matview + ingest 鏈 refresh)。'
  '主視窗 2026-08-11 裁 B1,待 Sean 晨間追認。';
