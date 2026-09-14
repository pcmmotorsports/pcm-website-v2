-- 20260914100000_m4b_pcm_incident_kind_add_line_forward_failed.sql
-- M-4b · LINE webhook 轉發失敗 ⇒ 留痕 pcm_incident, 進 Sean 的早上摘要(主視窗 2026-09-14 派;B 窗 09-14 收工檔「剩什麼 ①」)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- www 接下 LINE webhook 後把原始 bytes 轉給報價單(20260914 `5e27f7ee4`, 1+3 次退避);四次都失敗 = 客人那則 LINE 訊息
-- 靜默消失(LINE 拿到我們的 200 就不重送)。今天只有 Vercel log 看得到 ⇒ 沒有人知道。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① `pcm_incident_kind_check` 加 `line_forward_failed`(第 4 代 CHECK;上一代 20260914060000 四種)。
-- ② 新窄門 `pcm_incident_log_line_forward_failed(text)`:kind 寫死、detail 截 500、GRANT EXECUTE 只給 service_role。
--    🔴 不開 `pcm_incident_log(text,uuid,text)` 給 service_role —— 那支 kind 是參數, 開了 = service_role 能寫任何 kind。
--    window 端(apps/storefront/src/lib/line/incident-repository.ts)用 service client 呼叫這支。
-- 讀出口零改動:`get_pcm_incident_health()` 逐 kind 計數 ⇒ 新 kind 自動進 `open_by_kind`;TS 白名單同片跟上。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260914100000-rollback.sql`:DROP 窄門 + CHECK 縮回四種(表裡有新 kind 的列 ⇒ 拒退)。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- codex R2 must-fix:前置閘讀 CHECK 與下面 ALTER 之間要同一把鎖, 否則中間有人加了第六種 kind 會被靜靜砍掉。表很小、5s 鎖不到就放棄。
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘一:pcm_incident_kind_check 不在 ⇒ 小事故表的形狀不是我以為的';
  END IF;
  -- 🔴 釘上一代【逐字】(codex R1 must-fix:只查「四種都在」擋不住中間有人多加一種 ⇒ 本檔的 IN(...) 會靜靜砍掉它)。
  --    字串 = 拋棄式 PG 2026-09-14 貼完 20260914060000 後 pg_get_constraintdef 實得。
  IF v_def LIKE '%line_forward_failed%' THEN
    RAISE EXCEPTION '前置閘二:line_forward_failed 已在 CHECK 裡 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF v_def <> 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text])))' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:CHECK 不是 20260914060000 那一代逐字(實得 ' || v_def || ')⇒ 有人加了別種 kind, 本檔的 IN(...) 會砍掉它, 停下人工對齊';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_incident_log_line_forward_failed(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:pcm_incident_log_line_forward_failed(text) 已經在 ⇒ 貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_incident_log(text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘五:pcm_incident_log(text,uuid,text) 不在 ⇒ 本檔要呼叫的東西還沒貼';
  END IF;
END
$pre$;

-- ── ① 小事故 kind 加一種 ───────────────────────────────────────
ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed', 'line_forward_failed'));

-- ── ② 窄門(新物件 ⇒ 裸 CREATE) ─────────────────────────────────
CREATE FUNCTION public.pcm_incident_log_line_forward_failed(p_detail text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- subject_id 沒有:這件事不掛在任何一張單上。detail 由呼叫端組(原因 + 事件 id), 不含 userId / body。
  SELECT public.pcm_incident_log('line_forward_failed', NULL, pg_catalog.left(COALESCE(p_detail, '(無)'), 500));
$fn$;
COMMENT ON FUNCTION public.pcm_incident_log_line_forward_failed(text) IS
  'LINE webhook 轉發報價單失敗(1+3 次退避燒完)⇒ 留痕 pcm_incident kind=line_forward_failed(20260914100000)。只給 service_role(www webhook route);kind 寫死, detail 截 500。';

ALTER FUNCTION public.pcm_incident_log_line_forward_failed(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_incident_log_line_forward_failed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_incident_log_line_forward_failed(text) FROM anon, authenticated, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.pcm_incident_log_line_forward_failed(text) TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1 = 窄門)
  v_functions text[] := ARRAY[
    'public.pcm_incident_log_line_forward_failed(text)'
  ]::text[];
  r text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '後置閘一:% 不存在', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘二:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘三:% service_role 不能 EXECUTE ⇒ www 寫不進來', r;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
