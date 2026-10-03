-- 20261003230000-rollback.sql —— 拿掉 20261003230000 加的兩個「品牌 + 商品編號」索引
-- 只拿掉索引, 不動任何資料;拿掉之後 Ducati 只選品牌的列表回到原本的查法(會慢, 不會錯)。
-- 🔴 DROP INDEX CONCURRENTLY 不能在交易裡跑 ⇒ 貼法同 migration 檔頭:psql -X -v ON_ERROR_STOP=1 -f <本檔>, 不加 -1。
-- 也用來清掉「貼到一半失敗留下的失效索引」:IF EXISTS ⇒ 只有其中一個存在也能跑。
-- 🔴 定義用 pg_get_indexdef(to_regclass(...)) 讀, 不用 '...'::regclass —— 後者在索引不存在時會先被求值而報錯(拋棄式 PG 實撞)。
-- 前置閘:同名索引若存在, 定義必須是 20261003230000 建的那一個 ⇒ 不會誤刪別人後來建的同名索引。
-- txn-wrap-gate:exempt DROP INDEX CONCURRENTLY 不能在交易裡跑

-- 🔵 lock_timeout 5 秒(session 級, 檔案沒有交易不能用 SET LOCAL):DROP INDEX CONCURRENTLY 等既有交易超過 5 秒會失敗,
--    索引可能被標成失效 ⇒ 直接再跑一次本檔即可(IF EXISTS + 定義相符都已成立)。
--    migration 那支【不加】:CREATE INDEX CONCURRENTLY 也要等舊快照, 碰上報價單同步(最長 300 秒)會被 5 秒打斷而留下失效索引。
SET statement_timeout = '10min';
SET lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.ix_pf_brand_product') IS NOT NULL
     AND pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.ix_pf_brand_product'))
         <> 'CREATE INDEX ix_pf_brand_product ON public.product_fitments USING btree (moto_brand, product_id)' THEN
    RAISE EXCEPTION '前置閘①:ix_pf_brand_product 的定義不是 20261003230000 建的那一個 ⇒ 停';
  END IF;
  IF pg_catalog.to_regclass('public.ix_pfe_brand_product') IS NOT NULL
     AND pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.ix_pfe_brand_product'))
         <> 'CREATE INDEX ix_pfe_brand_product ON public.product_fitments_effective USING btree (moto_brand, product_id)' THEN
    RAISE EXCEPTION '前置閘②:ix_pfe_brand_product 的定義不是 20261003230000 建的那一個 ⇒ 停';
  END IF;
END
$pre$;

DROP INDEX CONCURRENTLY IF EXISTS public.ix_pf_brand_product;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_pfe_brand_product;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.ix_pf_brand_product') IS NOT NULL
     OR pg_catalog.to_regclass('public.ix_pfe_brand_product') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:索引還在 ⇒ 停下來看';
  END IF;
END
$post$;
