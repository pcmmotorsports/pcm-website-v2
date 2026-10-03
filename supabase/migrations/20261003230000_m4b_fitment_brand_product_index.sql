-- 20261003230000_m4b_fitment_brand_product_index.sql —— 兩張適用車款表加「品牌 + 商品編號」索引
-- Sean 2026-10-03 23:4x 經主視窗答 Q2 甲。計畫:~/Projects/pcm-mailbox/計畫-車款與商品查詢逾時-20261004.md 改法 A。
--
-- 量到的(2026-10-03 正式庫唯讀, pcm_readonly 會略過資料列權限, 件數含已下架):
--   只選 Ducati 品牌的商品列表 24 小時 3 次全部超過 3 秒、2 次客人看到錯誤(search_catalog_by_vehicle 57014)。
--   Ducati 在 product_fitments_effective 127,195 列(全表 307,484 的 41%), product_fitments 76,539 列。
--   函式第一步 `matched` 把兩張表的 product_id 合併去重:Ducati 走 Merge Append ——
--   ix_pf_product 整個掃完再逐列過濾品牌 + ux_pfe_row(51 MB, 品牌是第二欄)整個掃完 ⇒ 冷 7,273 ms / 熱 1,295 ms;
--   Kawasaki 走品牌索引 + HashAggregate ⇒ 112 ms。catalog_facet_counts 有同一段合併。
-- 改什麼:只加兩個索引。不改資料、不改函式、不改權限。
--   有了 (moto_brand, product_id), Ducati 只讀自己那段索引項目, 而且已經依 product_id 排好 ⇒ Merge Append 不必掃全索引。
--
-- 🔴🔴 貼法(CREATE INDEX CONCURRENTLY 不能在交易裡跑):
--   ① 本檔【沒有】BEGIN/COMMIT, 也【不能】用 scripts/apply-paste-board.sh 貼 ——
--      那支對沒有 BEGIN 的檔會加 `-1` ⇒ 第一句 CREATE INDEX CONCURRENTLY 報
--      「cannot run inside a transaction block」⇒ 整支退回, 庫不變(拋棄式 PG 驗過, 不會貼壞, 只是貼不上)。
--   ② 用 psql 直接跑、不加 -1:psql "$PCM_WRITE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f <本檔>
--      連線要直連資料庫(session 模式, 5432), 不要用交易模式連線池(6543):後者不保留 session 級的 statement_timeout。
--      不要用 Supabase SQL Editor:整檔送出會被包成同一個交易;一句一句送則會把 statement_timeout=10min 留在它的連線池上。
--   ③ 貼完記帳(apply-paste-board 平常替你做的那兩件):
--      supabase migration repair --linked --status applied 20261003230000
--      APPLIED.tsv 加一列(版本、本檔 sha256、日期、備註)。
--   ④ 時段:避開 03:00–07:30(排程寫入)與報價單同步寫入(pfe_sync_commit, 10-03 是 11:04)。
--      CONCURRENTLY 不擋客人讀寫, 但要等手上已經開著的交易結束才會完成。
--   ⑤ 中途失敗會留下「失效(INVALID)」的索引 ⇒ 先跑 supabase/rollbacks/20261003230000-rollback.sql 清掉, 再貼一次。
--      再貼時前置閘會擋「索引已存在」, 不會在失效索引上安靜跳過。
-- 影響:兩個索引估計共 10–15 MB(同表雙欄索引 ix_pf_lookup 3.6 MB、ix_pfe_lookup 7.1 MB);報價單同步寫入時多維護兩個索引。
-- 還原:supabase/rollbacks/20261003230000-rollback.sql(DROP INDEX CONCURRENTLY, 同樣不能在交易裡跑)。
-- 驗證:scripts/20261003230000-verify.sh(拋棄式 PG, 非 superuser 貼, Ducati 占 41% 的資料量, 貼前 Merge Append 掃全索引 ⇒ 貼後走新索引)。
-- txn-wrap-gate:exempt CREATE INDEX CONCURRENTLY 不能在交易裡跑

SET statement_timeout = '10min';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.product_fitments') IS NULL
     OR pg_catalog.to_regclass('public.product_fitments_effective') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:product_fitments 或 product_fitments_effective 不存在 ⇒ 停';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid IN ('public.product_fitments'::regclass, 'public.product_fitments_effective'::regclass)
         AND ((a.attname = 'moto_brand' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype))
         AND NOT a.attisdropped) <> 4 THEN
    RAISE EXCEPTION '前置閘①:兩張表的 moto_brand(text)/ product_id(uuid)型別與 2026-10-03 正式庫不同 ⇒ 停';
  END IF;
  IF pg_catalog.to_regclass('public.ix_pf_brand_product') IS NOT NULL
     OR pg_catalog.to_regclass('public.ix_pfe_brand_product') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:ix_pf_brand_product 或 ix_pfe_brand_product 已存在(可能是上次失敗留下的失效索引)⇒ 先跑 rollback 再貼';
  END IF;
END
$pre$;

CREATE INDEX CONCURRENTLY ix_pf_brand_product ON public.product_fitments (moto_brand, product_id);
CREATE INDEX CONCURRENTLY ix_pfe_brand_product ON public.product_fitments_effective (moto_brand, product_id);

DO $post$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_catalog.pg_index i
   WHERE i.indexrelid IN (pg_catalog.to_regclass('public.ix_pf_brand_product'), pg_catalog.to_regclass('public.ix_pfe_brand_product'))
     AND i.indisvalid AND i.indisready;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘①:兩個新索引不是都有效(有效 % 個)⇒ 跑 rollback 清掉再貼', v_n;
  END IF;
  IF pg_catalog.pg_get_indexdef('public.ix_pf_brand_product'::regclass)
       <> 'CREATE INDEX ix_pf_brand_product ON public.product_fitments USING btree (moto_brand, product_id)'
     OR pg_catalog.pg_get_indexdef('public.ix_pfe_brand_product'::regclass)
       <> 'CREATE INDEX ix_pfe_brand_product ON public.product_fitments_effective USING btree (moto_brand, product_id)' THEN
    RAISE EXCEPTION '事後閘②:索引定義與預期不同 ⇒ 停下來看';
  END IF;
END
$post$;
