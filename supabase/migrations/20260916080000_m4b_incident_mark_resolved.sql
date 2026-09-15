-- 20260916080000_m4b_incident_mark_resolved.sql
-- M-4b · 後台事故紀錄頁「標記已處理 / 取消已處理」的 DB 片(主視窗 pcm-website-v2-b7 派;plan 核過 f8c68389c)
-- plan:docs/plans/2026-09-15-incident-mark-resolved-plan.md(adversarial-reviewer R2 PASS)
--
-- 🔴🔴 貼板時段:避開客人多的時候。
--    本檔 ALTER TABLE public.pcm_incident 拿 ACCESS EXCLUSIVE,一路握到 COMMIT;
--    這張表的寫入端在收款 / 退款交易裡(pcm_noncard_settle_recompute / pcm_sync_order_refund_payment_status /
--    pcm_auto_cancel_on_full_card_refund / pcm_settle_retry_sweep;另有 20260910210000 券退回、20260911170000 退款單一來源、
--    20260914100000 LINE 轉發失敗)⇒ 卡鎖時那些交易會跟著等(lock_timeout 5s)。
--
-- ══ Sean 2026-09-15 三答(主視窗轉述逐字)═══════════════════════
-- Q1「乙 = 所有在職員工」⇒ 身分閘只查 staff.is_active,不查 is_manager(後置閘釘住)
-- Q2「乙 = 可以不寫」    ⇒ 標記已處理的說明選填
-- Q3「甲 = 可以。權限一樣, 要寫原因; 如果系統已經又記了一筆新的, 就不讓取消」
--    ⇒ 取消已處理原因必填;同 kind + subject_id = + id > 本列 的列存在(不論已不已處理)⇒ superseded
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① pcm_incident 加 resolved_by / resolution_note 兩欄 + 兩條具名 CHECK(一句 ALTER)
--    · 可重貼:兩欄都不在 ⇒ ALTER;兩欄與兩條 CHECK 都在(= rollback 過)⇒ 驗定義後跳過;只在一半 ⇒ 停
--    · 兩欄都不在時先驗「沒有任何 resolved_at IS NOT NULL」(有 ⇒ 有人手動 UPDATE 過,停)
-- ② public.admin_resolve_pcm_incident(bigint, text, text, text)  標記已處理
-- ③ public.admin_reopen_pcm_incident(bigint, text, text, text)   取消已處理
--    兩支都:SECURITY DEFINER、search_path 釘空、EXECUTE 只給 service_role、FOR UPDATE、重按冪等不寫第二筆稽核、
--    同交易寫 admin_audit_log(incident.resolve / incident.reopen,target 'incident:<id>')
-- ④ admin_list_pcm_incidents 換一代:多回 resolved_by / resolution_note(RETURNS TABLE 改形 ⇒ DROP + 裸 CREATE + ACL 逐字搬)
--    ⚠️ ALTER 必須在它之前:LANGUAGE sql 在 CREATE 當下就驗欄位
-- ⑤ NOTIFY pgrst(交易內,COMMIT 時才送)
--
-- ══ 刻意不做(plan §2-2)════════════════════════════════════
-- · 寫入端一行不改:既有去重都已帶 resolved_at IS NULL(20260907140000 為這顆鈕補的)
-- · 與寫入端的競態(多算一筆 / 毫秒級靜音)只接受不修;不用 partial unique index
--   (refund_over_total 那句 PERFORM 沒包 EXCEPTION,撞 unique 會把整筆退款交易回滾)
-- · 不驗「問題真的修好了沒」
-- · actor 是自陳身分(ADMIN_REQUIRE_REAL_IDENTITY 正式站值未確認);依 Q1 乙,冒名只影響稽核寫的是誰,不多開權限
--
-- ══ 貼板必附 ════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916080000):新增 2 支 public 函式 + 讀取函式換一代
-- 🔴 上線順序:本檔先貼 + APPLIED.tsv 同顆 commit,後台片才合 dev
--    (舊後台配新讀取函式:多出來的兩欄不影響;新後台配舊函式:形狀檢查 throw ⇒ 整頁讀取失敗)
-- ⚠️ DROP + CREATE 之後、PostgREST reload 之前,事故頁可能短暫 PGRST202(頁面走讀取失敗區塊)
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句,rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916080000-rollback.sql:DROP 兩支寫入函式 + 讀取函式還原 6 欄;兩欄與兩條 CHECK 留著(可重貼)。
-- 先退後台片與告警信文字那顆,再跑退回檔;退完同批跑 pcm_acl_approve_latest。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- ACCESS EXCLUSIVE 一路握到 COMMIT(含後置閘實打)⇒ 每一句給 30s 上界(同 20260914110000:24)
SET LOCAL statement_timeout = '30s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_cols integer;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_incident') IS NULL THEN
    RAISE EXCEPTION '前置閘一:public.pcm_incident 不存在';
  END IF;
  -- definer 讀寫得到的前提(同 20260916040000 前置閘三)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = 'public.pcm_incident'::regclass
                    AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
                    AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '前置閘二:public.pcm_incident 的 owner 不是 postgres, 或被 FORCE ROW LEVEL SECURITY';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘三:public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘四:public.staff.is_active 不在';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_resolve_pcm_incident(bigint, text, text, text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_reopen_pcm_incident(bigint, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘五:寫入函式已存在 ⇒ 本檔貼過了且沒退, 停下人工對齊';
  END IF;
  -- 讀取函式必須是 20260916040000 那一代的 6 欄形狀才准 DROP(字面由拋棄式 PG 實際讀出)
  IF pg_catalog.to_regprocedure('public.admin_list_pcm_incidents(integer, boolean)') IS NULL THEN
    RAISE EXCEPTION '前置閘六:admin_list_pcm_incidents(integer, boolean) 不存在 ⇒ 20260916040000 還沒貼';
  END IF;
  IF pg_catalog.pg_get_function_result('public.admin_list_pcm_incidents(integer, boolean)'::regprocedure)
     IS DISTINCT FROM 'TABLE(id bigint, kind text, subject_id uuid, detail text, created_at timestamp with time zone, resolved_at timestamp with time zone)' THEN
    RAISE EXCEPTION '前置閘七:admin_list_pcm_incidents 不是 20260916040000 的 6 欄形狀 ⇒ 有人改過, 停';
  END IF;
  SELECT pg_catalog.count(*) INTO v_cols
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_incident'::regclass
     AND attname IN ('resolved_by', 'resolution_note') AND NOT attisdropped;
  IF v_cols = 1 THEN
    RAISE EXCEPTION '前置閘八:resolved_by / resolution_note 只在一個 ⇒ 半套狀態, 停下人工對齊';
  END IF;
  IF v_cols = 0 AND EXISTS (SELECT 1 FROM public.pcm_incident WHERE resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION '前置閘九:已有 resolved_at 非空的事故列 ⇒ resolved_at 原本沒有寫入端, 有人手動 UPDATE 過, 停';
  END IF;
END
$pre$;

-- ── ① 兩欄 + 兩條具名 CHECK(可重貼)───────────────────────────
DO $cols$
DECLARE
  v_cols integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_cols
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_incident'::regclass
     AND attname IN ('resolved_by', 'resolution_note') AND NOT attisdropped;

  IF v_cols = 0 THEN
    ALTER TABLE public.pcm_incident
      ADD COLUMN resolved_by     text,
      ADD COLUMN resolution_note text,
      ADD CONSTRAINT pcm_incident_resolved_by_consistent CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
      ADD CONSTRAINT pcm_incident_note_requires_resolved CHECK (resolved_at IS NOT NULL OR resolution_note IS NULL);
  ELSE
    -- 已退回過:兩欄與兩條 CHECK 都要逐字對得上才跳過(期望字面由拋棄式 PG 的 pg_get_constraintdef 實際讀出)
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public.pcm_incident'::regclass
           AND attname IN ('resolved_by', 'resolution_note') AND NOT attisdropped
           AND atttypid = 'text'::regtype) <> 2 THEN
      RAISE EXCEPTION '重貼閘一:resolved_by / resolution_note 型別不是 text';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conrelid = 'public.pcm_incident'::regclass
                      AND conname = 'pcm_incident_resolved_by_consistent' AND convalidated
                      AND pg_catalog.pg_get_constraintdef(oid) = 'CHECK (((resolved_at IS NULL) = (resolved_by IS NULL)))')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                       WHERE conrelid = 'public.pcm_incident'::regclass
                         AND conname = 'pcm_incident_note_requires_resolved' AND convalidated
                         AND pg_catalog.pg_get_constraintdef(oid) = 'CHECK (((resolved_at IS NOT NULL) OR (resolution_note IS NULL)))') THEN
      RAISE EXCEPTION '重貼閘二:兩欄在而兩條 CHECK 不在或定義不同 ⇒ 半套狀態, 停下人工對齊';
    END IF;
    RAISE NOTICE '兩欄與兩條 CHECK 已在(rollback 過)⇒ 跳過 ALTER';
  END IF;
END
$cols$;

COMMENT ON COLUMN public.pcm_incident.resolved_by IS
  '標記已處理的員工 staff.id(20260916080000)。只由 admin_resolve_pcm_incident 寫;取消已處理時清回 NULL。自陳身分, 見該函式註解。';
COMMENT ON COLUMN public.pcm_incident.resolution_note IS
  '標記已處理時員工寫的說明(選填, Sean Q2 乙;20260916080000)。未處理時必為 NULL(CHECK)。不進告警信 / LINE。';

-- ── ② 標記已處理(新物件 ⇒ 裸 CREATE)────────────────────────────
CREATE FUNCTION public.admin_resolve_pcm_incident(
  p_id         bigint,
  p_actor      text,
  p_request_id text,
  p_note       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- Unicode 空白 + 零寬 / 格式字全集(逐字沿用 20260915180000 admin_upsert_supplier 的 v_ws)
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  -- ponytail:說明上限 500 字元(plan §4-A②);一句「做了什麼」夠用,真不夠再改這個常數
  v_note_max constant integer := 500;
  v_actor text;
  v_req   text;
  v_note  text;
  v_row   public.pcm_incident%ROWTYPE;
  v_now   timestamptz;
BEGIN
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: v_ws 字元集長度異常(預期 31)';
  END IF;

  -- actor:先剝、後驗(同 admin_upsert_supplier)。🔴 自陳身分:保證稽核有非空 actor, 不保證是真的操作者
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: actor 非法';
  END IF;

  -- 🔴 身分閘(Sean Q1 乙:所有在職員工)。只查在職, 刻意不查管理者旗標(後置閘釘住本體不含那個欄名)。
  --    DB 這一層要有:後台 key 是 service_role, PostgREST 直打不經 TS 那道 authorizeAdminMutation。
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: request_id 非法';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'admin_resolve_pcm_incident: 缺 id';
  END IF;

  -- 說明選填(Sean Q2 乙):空白等同沒寫 ⇒ NULL;有值才驗
  IF p_note IS NOT NULL THEN
    v_note := pg_catalog.btrim(p_note, v_ws);
    IF v_note = '' THEN
      v_note := NULL;
    ELSIF pg_catalog.char_length(v_note) > v_note_max OR v_note ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_resolve_pcm_incident: 說明非法';
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.pcm_incident WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;
  -- 重按冪等:已經是已處理 ⇒ 不寫、不寫第二筆稽核
  IF v_row.resolved_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'already');
  END IF;

  v_now := pg_catalog.now();
  UPDATE public.pcm_incident
     SET resolved_at = v_now, resolved_by = v_actor, resolution_note = v_note
   WHERE id = p_id;

  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor,
    'incident.resolve',
    'incident:' || p_id::text,
    pg_catalog.jsonb_build_object('resolved_at', NULL::timestamptz, 'kind', v_row.kind, 'subject_id', v_row.subject_id),
    pg_catalog.jsonb_build_object('resolved_at', v_now, 'resolved_by', v_actor, 'kind', v_row.kind, 'subject_id', v_row.subject_id),
    v_note,
    v_req,
    'admin'
  );

  RETURN pg_catalog.jsonb_build_object('result', 'resolved');
END;
$fn$;
COMMENT ON FUNCTION public.admin_resolve_pcm_incident(bigint, text, text, text) IS
  '後台事故紀錄頁「標記已處理」(20260916080000)。在職員工皆可(Sean Q1 乙);說明選填(Q2 乙)。'
  ' 回 {"result": resolved | already | not_found};身分不符 RAISE 無權執行此操作。同交易寫 admin_audit_log incident.resolve。'
  ' EXECUTE 只給 service_role。';

-- ── ③ 取消已處理(新物件 ⇒ 裸 CREATE)────────────────────────────
CREATE FUNCTION public.admin_reopen_pcm_incident(
  p_id         bigint,
  p_actor      text,
  p_request_id text,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_reason_max constant integer := 500;
  v_actor  text;
  v_req    text;
  v_reason text;
  v_row    public.pcm_incident%ROWTYPE;
BEGIN
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: v_ws 字元集長度異常(預期 31)';
  END IF;

  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: actor 非法';
  END IF;

  -- 🔴 身分閘同標記已處理(Sean Q3「權限一樣」):只查在職
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: request_id 非法';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺 id';
  END IF;

  -- 原因必填(Sean Q3「要寫原因」)
  v_reason := pg_catalog.btrim(p_reason, v_ws);
  IF v_reason IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 缺原因';
  END IF;
  IF pg_catalog.char_length(v_reason) > v_reason_max OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_reopen_pcm_incident: 原因非法';
  END IF;

  SELECT * INTO v_row FROM public.pcm_incident WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;
  IF v_row.resolved_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'already_open');
  END IF;

  -- 🔴 Sean Q3「如果系統已經又記了一筆新的, 就不讓取消」:
  --    同 kind、subject_id 用 = 比(NULL 比不到 ⇒ line_forward_failed 永不擋)、id 比本列大 ⇒ 擋;
  --    較新那列已經處理過也照樣擋;比本列舊的列不擋。
  --    ⚠️ 兩種看不到的情況都算 plan §2-2「多算」, 接受:
  --       · 號碼比本列小、卻比本列晚 commit 的重複列 ⇒ 被當成舊列不擋
  --       · 號碼比本列大、但還沒 commit 的新列 ⇒ 這裡看不到 ⇒ 照樣打開, 結果兩筆未處理
  IF EXISTS (SELECT 1 FROM public.pcm_incident n
              WHERE n.kind = v_row.kind
                AND n.subject_id = v_row.subject_id
                AND n.id > v_row.id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'superseded');
  END IF;

  UPDATE public.pcm_incident
     SET resolved_at = NULL, resolved_by = NULL, resolution_note = NULL
   WHERE id = p_id;

  -- before 帶舊處理人與說明:欄位清掉之後只剩稽核留得住
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor,
    'incident.reopen',
    'incident:' || p_id::text,
    pg_catalog.jsonb_build_object('resolved_at', v_row.resolved_at, 'resolved_by', v_row.resolved_by,
                                  'resolution_note', v_row.resolution_note,
                                  'kind', v_row.kind, 'subject_id', v_row.subject_id),
    pg_catalog.jsonb_build_object('resolved_at', NULL::timestamptz, 'kind', v_row.kind, 'subject_id', v_row.subject_id),
    v_reason,
    v_req,
    'admin'
  );

  RETURN pg_catalog.jsonb_build_object('result', 'reopened');
END;
$fn$;
COMMENT ON FUNCTION public.admin_reopen_pcm_incident(bigint, text, text, text) IS
  '後台事故紀錄頁「取消已處理」(20260916080000)。權限同標記已處理(在職員工);原因必填(Sean Q3 甲)。'
  ' 同 kind + subject_id 有比本列新的事故列 ⇒ superseded 不動。回 {"result": reopened | already_open | superseded | not_found}。'
  ' 同交易寫 admin_audit_log incident.reopen。EXECUTE 只給 service_role。';

-- ── ④ 讀取函式換一代(RETURNS TABLE 改形 ⇒ DROP + 裸 CREATE)──────────
DROP FUNCTION public.admin_list_pcm_incidents(integer, boolean);

CREATE FUNCTION public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)
RETURNS TABLE (
  id              bigint,
  kind            text,
  subject_id      uuid,
  detail          text,
  created_at      timestamptz,
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT i.id, i.kind, i.subject_id, i.detail, i.created_at, i.resolved_at, i.resolved_by, i.resolution_note
    FROM public.pcm_incident i
   WHERE NOT COALESCE(p_open_only, true)
      OR i.resolved_at IS NULL
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$fn$;
COMMENT ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) IS
  '後台事故紀錄頁的唯讀窄門(20260916040000 第 1 代;20260916080000 第 2 代多回 resolved_by / resolution_note)。'
  ' p_limit NULL⇒50 夾 1..200、p_open_only NULL⇒true。EXECUTE 只給 service_role;表本身仍對所有角色 0 權限。';

-- ── ACL ─────────────────────────────────────────────────────
ALTER FUNCTION public.admin_resolve_pcm_incident(bigint, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_resolve_pcm_incident(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_pcm_incident(bigint, text, text, text) FROM anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_resolve_pcm_incident(bigint, text, text, text) TO service_role;

ALTER FUNCTION public.admin_reopen_pcm_incident(bigint, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_reopen_pcm_incident(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reopen_pcm_incident(bigint, text, text, text) FROM anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_reopen_pcm_incident(bigint, text, text, text) TO service_role;

ALTER FUNCTION public.admin_list_pcm_incidents(integer, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;裸 CREATE FUNCTION 3 支)
  v_functions text[] := ARRAY[
    'public.admin_resolve_pcm_incident(bigint, text, text, text)',
    'public.admin_reopen_pcm_incident(bigint, text, text, text)',
    'public.admin_list_pcm_incidents(integer, boolean)'
  ]::text[];
  r      text;
  v_oid  regprocedure;
  v_leak integer;
  v_msg  text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '後置閘一:% 不存在', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_oid
                      AND p.prosecdef
                      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '後置閘二:% 不是 owner=postgres + SECURITY DEFINER + search_path 釘空', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('payment_confirmer', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘三:% 對 anon / authenticated / payment_confirmer 開著 EXECUTE', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
       AND pg_catalog.has_function_privilege('pcm_readonly', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 pcm_readonly 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘五:% service_role 不能 EXECUTE ⇒ 後台叫不動', r;
    END IF;
    -- docs/patterns/revoking-function-execute-in-supabase.md §3.5
    SELECT pg_catalog.count(*) INTO v_leak
      FROM pg_catalog.pg_roles ro
     WHERE pg_catalog.pg_has_role('anon', ro.oid, 'SET')
       AND pg_catalog.has_function_privilege(ro.oid, v_oid, 'EXECUTE');
    IF v_leak <> 0 THEN
      RAISE EXCEPTION '後置閘六:% 有 % 個 anon 切得過去的角色可執行(SET ROLE 繞路)', r, v_leak;
    END IF;
  END LOOP;

  IF pg_catalog.has_any_column_privilege('service_role', 'public.pcm_incident', 'SELECT')
     OR pg_catalog.has_any_column_privilege('service_role', 'public.pcm_incident', 'UPDATE') THEN
    RAISE EXCEPTION '後置閘七:service_role 對 public.pcm_incident 有 SELECT / UPDATE ⇒ 表的窄門被打開了';
  END IF;

  IF pg_catalog.pg_get_function_result('public.admin_list_pcm_incidents(integer, boolean)'::regprocedure)
     IS DISTINCT FROM 'TABLE(id bigint, kind text, subject_id uuid, detail text, created_at timestamp with time zone, resolved_at timestamp with time zone, resolved_by text, resolution_note text)' THEN
    RAISE EXCEPTION '後置閘八:admin_list_pcm_incidents 不是 8 欄形狀';
  END IF;

  -- Sean Q1 乙:兩支寫入函式本體不准出現管理者旗標(防被抄成管理者閘)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              WHERE p.oid IN ('public.admin_resolve_pcm_incident(bigint, text, text, text)'::regprocedure,
                              'public.admin_reopen_pcm_incident(bigint, text, text, text)'::regprocedure)
                AND pg_catalog.strpos(p.prosrc, 'is_manager') > 0) THEN
    RAISE EXCEPTION '後置閘九:寫入函式本體出現 is_manager ⇒ 與 Sean Q1 乙(所有在職員工)不符';
  END IF;

  -- 實打:不存在的 actor ⇒ 無權執行此操作(兩支都在寫入之前就擋, 不留任何資料)
  --   只接 raise_exception;簽章錯 / 函式不存在是 42883, 不接 ⇒ 整支失敗。
  --   v_msg 先設 NULL:沒丟錯就維持 NULL, 在 handler 外面判(不在 handler 裡 RAISE 自己的「沒被擋」)。
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_resolve_pcm_incident(0, 'zzq-no-such-staff-20260916080000', 'post-gate', NULL);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM '無權執行此操作' THEN
    RAISE EXCEPTION '後置閘十:不存在的 actor 應回「無權執行此操作」(resolve), 實得 %', coalesce(v_msg, '<沒被擋>');
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_reopen_pcm_incident(0, 'zzq-no-such-staff-20260916080000', 'post-gate', 'post-gate');
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM '無權執行此操作' THEN
    RAISE EXCEPTION '後置閘十一:不存在的 actor 應回「無權執行此操作」(reopen), 實得 %', coalesce(v_msg, '<沒被擋>');
  END IF;
END
$post$;

-- PostgREST 重讀 schema(交易內 ⇒ COMMIT 時才送)
NOTIFY pgrst, 'reload schema';

COMMIT;
