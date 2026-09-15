-- 20260916040000-rollback.sql —— 退回 20260916040000_m4b_admin_list_pcm_incidents.sql
--
-- 🔴 順序:先 revert 後台「事故紀錄」那片(它呼叫本函式),再跑本檔。反過來的話頁面會先顯示讀取失敗區塊
--    (不壞站,但員工會看到錯誤)。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916040000 與「rollback」):每日 ACL 摘要會因為少一支函式再變一次(20260909060000:136-143)。
-- ⚠️ 表 public.pcm_incident 與既有函式本檔一個字都不動 ⇒ 不需要其他步驟。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_list_pcm_incidents(integer, boolean)') IS NULL THEN
    RAISE NOTICE '退回前置閘:admin_list_pcm_incidents(integer, boolean) 不存在 ⇒ 已經退過, 下面的 DROP IF EXISTS 是冪等的';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.admin_list_pcm_incidents(integer, boolean);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_list_pcm_incidents(integer, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘:admin_list_pcm_incidents(integer, boolean) 還在';
  END IF;
END
$post$;

COMMIT;
