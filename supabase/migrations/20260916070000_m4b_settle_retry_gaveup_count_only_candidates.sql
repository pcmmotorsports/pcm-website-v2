-- 20260916070000 · 重試放棄章在單已處理後不會消失 —— 健康檢查只數還在重試範圍的章
-- plan:docs/plans/2026-09-15-settle-retry-gaveup-stale-stamp-plan.md(v3, 84e4da08e;Sean「甲、甲、甲」;主視窗核過開工)。
--
-- 做兩件事(同一個交易,零寫入資料):
--   ① 新增 pcm_settle_retry_still_candidate(uuid):單現在是不是排程的重試候選(條件 = 排程候選查詢的【單那一半】,
--      逐字對齊 20260916060000:420-432;去掉 LEFT JOIN attempts 一行與 attempts / 24 小時條件含註解四行)。owner postgres、四道 REVOKE、零 GRANT。
--   ② get_settle_retry_gaveup_health:放棄計數六鍵只數「還在候選」的章;鍵名鍵數不變、tracked_total 不變。
--      單被員工補登 / 沖銷 / 取消 / supersede 處理掉之後,章留在表裡,而告警不再算它(Sean Q1 甲)。
-- 🔴 排程不動。新函式是排程候選條件的複本 ⇒ 前置閘釘排程 md5,別窗改了排程候選條件就擋下(plan R2 C1)。
-- 🔴 事故表不動(Sean Q2 甲):settle_retry_gave_up 那筆紀錄照留。
-- ⚠️ 已知上限(plan G4):候選但 OP6a 判 overpaid / needs_human 的單章不會被拿掉 ⇒ 仍算進放棄段(現金單那是唯一出口,留著是對的)。
--
-- ══ 貼板必附 ════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916070000;Sean 0914 拍甲):每日 ACL 摘要會把 public 每支函式的 EXECUTE 算進去
--    (20260909060000:136-143),本檔新增一支 ⇒ 不核准就會轉紅。
-- 🔴 上線順序(plan R1 MF1):本檔先貼 + APPLIED.tsv 同顆 commit ⇒ 才合告警文案那一顆(文案不能早於本檔生效)。
--    本檔進 dev 到記帳之間 anomaly-alert-key-contract 的帳本格會紅(預期)。
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- supabase/rollbacks/20260916070000-rollback.sql(健康檢查回 20260916060000 那一代 ⇒ DROP 新函式;退完同批再跑 pcm_acl_approve_latest;先 revert 告警文案那一顆)。
-- 手動在 psql 貼退回步驟時,上面那句 lock_timeout 要先下(rollback 檔第一句也帶了),否則卡在鎖上會無限等。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  f   record;
  v_n integer;
BEGIN
  -- 前置閘一:要覆蓋的健康檢查、與新函式複本來源的排程,都是 2026-09-15 對正式庫量到的那一代(plan §4、R2 C1)。
  FOR f IN
    SELECT * FROM (VALUES
      ('get_settle_retry_gaveup_health', 'public.get_settle_retry_gaveup_health()', '77690bb08e3aea51714ec53251ca296c', '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}'),
      ('pcm_settle_retry_sweep',         'public.pcm_settle_retry_sweep()',         '92eb9d8c534804dc74776b9dbad5adb0', '{postgres=X/postgres}')
    ) AS t(name, sig, md5, acl)
  LOOP
    SELECT pg_catalog.count(*) INTO v_n
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f.name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '前置閘一:% 有 % 支同名(期望 1)⇒ 出現 overload 或不存在, 停下', f.name, v_n;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure(f.sig)
         AND pg_catalog.md5(p.prosrc) = f.md5
         AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=""']
         AND p.proacl::text = f.acl
    ) THEN
      RAISE EXCEPTION '前置閘一:% 不是 20260916060000 那一代(md5 %、owner postgres、definer、search_path 空、ACL %)⇒ 有人改過, 停下重抄',
        f.sig, f.md5, f.acl;
    END IF;
  END LOOP;

  -- 前置閘二:新函式按名字 0 支(不只查 (uuid) 簽名)。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_settle_retry_still_candidate';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘二:public.pcm_settle_retry_still_candidate 已有 % 支 ⇒ 這支貼過了或有人先建了同名, 停下', v_n;
  END IF;
END
$pre$;

-- ── ① 還在不在重試候選 ──────────────────────────────────────────
-- 🔴 條件逐字對齊排程 pcm_settle_retry_sweep 的候選查詢(20260916060000:420-432),只拿掉 LEFT JOIN attempts 一行與 attempts / 24 小時條件含註解四行。
--    改排程候選條件時要一起改這支(前置閘釘了排程 md5,驗收世界 13 逐張比兩者)。
-- 單不存在 ⇒ EXISTS 回 false(不回 NULL)。
CREATE FUNCTION public.pcm_settle_retry_still_candidate(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $cand$
  SELECT EXISTS (
    SELECT 1
      FROM public.orders o
      CROSS JOIN LATERAL (
        SELECT coalesce(pg_catalog.sum(p.amount), 0) AS received
          FROM public.order_payments p WHERE p.order_id = o.id
      ) pay
     WHERE o.id = p_order_id
       AND o.payment_channel IN ('bank_transfer', 'cash')
       AND o.cancelled_at IS NULL
       AND ((o.payment_status = 'unpaid'::public.payment_status AND pay.received > 0)
         OR (o.payment_status = 'partiallyPaid'::public.payment_status AND pay.received >= o.total))
       AND NOT EXISTS (SELECT 1 FROM public.order_manual_refunds m
                        WHERE m.order_id = o.id AND m.voided_at IS NULL)
  );
$cand$;

-- 房規:新物件出生自帶 anon 權限(20260905290000:136)⇒ 四道 REVOKE、一個 GRANT 都不給。
-- 唯一呼叫端 get_settle_retry_gaveup_health 是 SECURITY DEFINER、owner postgres ⇒ 以 owner 身分叫得到。
ALTER FUNCTION public.pcm_settle_retry_still_candidate(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_still_candidate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_still_candidate(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_still_candidate(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_still_candidate(uuid) FROM service_role, payment_confirmer;

-- ── ② 放棄健康檢查只數還在候選的章 ──────────────────────────────
-- 🔴 CREATE OR REPLACE 會整組換掉 SET 子句 ⇒ search_path 照寫;ACL / owner 保留(事後閘逐角色核)。
CREATE OR REPLACE FUNCTION public.get_settle_retry_gaveup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 每個 key 獨佔一行、逗號結尾(anomaly-alert-key-contract.test.ts 用 ^\s*'key',\s*$ 抽 key)。
    -- 🔴 20260916070000:六個放棄計數鍵只數【還在重試候選】的章(pcm_settle_retry_still_candidate)——
    --    單被處理掉之後章留著而不再算(Sean Q1 甲)。sample 的過濾在子查詢 x 裡、LIMIT 5 之前(寫在外層會先截再濾 ⇒ 少列)。
    -- 舊三鍵只數匯款、新三鍵數現金(20260916060000 起);join 不到 orders 的列兩邊都不算。
    'gave_up_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'
        AND public.pcm_settle_retry_still_candidate(a.order_id)),
    'oldest_gave_up',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'
        AND public.pcm_settle_retry_still_candidate(a.order_id)),
    'sample_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'
                AND public.pcm_settle_retry_still_candidate(a.order_id)
              ORDER BY a.gave_up_at LIMIT 5) x),
    'gave_up_cash_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'
        AND public.pcm_settle_retry_still_candidate(a.order_id)),
    'oldest_gave_up_cash',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'
        AND public.pcm_settle_retry_still_candidate(a.order_id)),
    'sample_cash_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'
                AND public.pcm_settle_retry_still_candidate(a.order_id)
              ORDER BY a.gave_up_at LIMIT 5) x),
    'tracked_total',
    -- 分母:全表列數(語意不變,不過濾)⇒ adapter 的 gave_up_count <= tracked_total 恆成立。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts)
  );
$fn$;

-- ── 事後閘(只看 catalog)────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1 = pcm_settle_retry_still_candidate,零 GRANT)
  v_functions text[] := ARRAY[
    'public.pcm_settle_retry_still_candidate(uuid)'
  ]::text[];
  r      text;
  v_oid  regprocedure;
  v_leak integer;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘:% 不存在', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_oid
                      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.prosecdef
                      AND p.provolatile = 's'
                      AND p.proconfig = ARRAY['search_path=""']
                      AND p.proacl::text = '{postgres=X/postgres}') THEN
      RAISE EXCEPTION '事後閘:% 不是 owner postgres + definer + STABLE + search_path 空 + ACL {postgres=X/postgres}', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('payment_confirmer', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘:% 對 anon / authenticated / service_role / payment_confirmer 開著 EXECUTE(應零 GRANT)', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
       AND pg_catalog.has_function_privilege('pcm_readonly', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘:% 對 pcm_readonly 開著 EXECUTE', r;
    END IF;
    -- docs/patterns/revoking-function-execute-in-supabase.md §3.5:anon 切得過去、且可執行的角色要零列
    SELECT pg_catalog.count(*) INTO v_leak
      FROM pg_catalog.pg_roles ro
     WHERE pg_catalog.pg_has_role('anon', ro.oid, 'SET')
       AND pg_catalog.has_function_privilege(ro.oid, v_oid, 'EXECUTE');
    IF v_leak <> 0 THEN
      RAISE EXCEPTION '事後閘:% 有 % 個 anon 切得過去的角色可執行(SET ROLE 繞路)', r, v_leak;
    END IF;
  END LOOP;

  -- 健康檢查:ACL / owner / definer / search_path 與改之前相同,本體接上新函式。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.get_settle_retry_gaveup_health()')
                    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=""']
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}'
                    AND pg_catalog.strpos(p.prosrc, 'pcm_settle_retry_still_candidate') > 0) THEN
    RAISE EXCEPTION '事後閘:get_settle_retry_gaveup_health 的 owner / definer / search_path / ACL 變了, 或本體沒接上 pcm_settle_retry_still_candidate';
  END IF;

  -- 排程本檔沒有碰:md5 仍是 20260916060000 那一代。
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_settle_retry_sweep()'))
     IS DISTINCT FROM '92eb9d8c534804dc74776b9dbad5adb0' THEN
    RAISE EXCEPTION '事後閘:pcm_settle_retry_sweep 的本體變了 ⇒ 本檔不該碰排程';
  END IF;
END
$post$;

COMMIT;
