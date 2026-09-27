-- 20260927100000-rollback.sql —— 退回 20260927100000_m4b_product_redirects.sql
--
-- 🔴 順序:先 revert 顧客站讀轉址的那一片,再跑本檔。反過來 ⇒ 顧客站查 view 失敗(程式當作查無轉址、顯示 404,不壞頁)。
-- 🔴 ⚠️ 轉址列會一起刪掉 ⇒ 合卡後的舊網址全部回到 404。要保留的話先匯出 product_redirects。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260927100000 與「rollback」)。
-- 🔵 可重跑:全部 IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS public.product_redirects_live_v;
DROP TABLE IF EXISTS public.product_redirects;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.product_redirects') IS NOT NULL
     OR pg_catalog.to_regclass('public.product_redirects_live_v') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘一:表或 view 還在';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
