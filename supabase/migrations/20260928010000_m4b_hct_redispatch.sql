-- 20260928010000_m4b_hct_redispatch.sql —— 新竹「重新叫車」(出貨流程乙第 8 項)
--
-- 計畫:~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第二節第 8 項、第五節(資料庫那一列)。
-- 審查:計畫 R1 Codex → R2 Fable → R3 Codex → R4 Fable → R5 Codex(本檔對應的必修都已改入計畫);Sean 09-27 23:25 批。
-- 🛑 本檔【只寫不貼】—— 貼正式庫由主視窗 / Sean 做。要先貼本檔、再推用到它的程式(新函式, 順序反了畫面會壞)。
--
-- 為什麼不是「清掉 shipments.hct_dispatch_attempted_at 再叫一次」:
--   那一欄有 write-once 觸發器(20260910130000:109-125), 寫下後不能改也不能清 —— 它就是「不准再按」的保護。
--   ⇒ 第一次叫車照舊記在 shipments;之後每一次「重新叫車」記在新表 shipment_hct_dispatch_attempts, 一次一列。
--
-- 防兩台車的條件(全部在 admin_claim_hct_redispatch 同一個交易裡、鎖住那一箱之後判):
--   ① 箱內訂單仍然可以出(已取消 / 刷卡全退 ⇒ 拒)(Fable R2 必修 1)
--   ② 叫過車、還沒叫到、還沒出貨、沒作廢、hct_status = submitted、貨號對得上
--   ③ 最後一次叫車 = GREATEST(shipments 的佔位時間, 新表這一箱最大的佔位時間), 要早於 now() − 10 分鐘(Fable R2 必修 2)
--      —— 叫車 action 送出前有 30 秒期限、頁面執行上限 60 秒 ⇒ 10 分鐘前的那一次一定已經結束
--   ④ 畫面上看到的「最後一次是第幾次」要對得上(兩個人同時按 ⇒ 只有一個成功;(箱, 第幾次) 另有唯一鍵)
-- 另補:既有 admin_claim_hct_dispatch(第一次叫車)補「還沒出貨」(Codex R1 必修 3), 參數與回傳型別都不變、
--       設定只保留原本的 SET search_path = ''(20260916000000:608-617)。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.shipments';
  END IF;
  IF pg_catalog.to_regclass('public.shipment_hct_dispatch_attempts') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:shipment_hct_dispatch_attempts 已存在 ⇒ 本檔已套用過';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_claim_hct_redispatch(text,text,integer,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_record_hct_redispatch(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:那兩支新函式之一已存在 ⇒ 本檔已套用過';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_claim_hct_dispatch(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_p01_lock_box_orders(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 admin_claim_hct_dispatch 或 pcm_p01_lock_box_orders ⇒ 20260916000000 還沒貼';
  END IF;
  -- 🔴 要補的那一條還沒在(否則是別人已經改過 ⇒ 停下來看)
  IF pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.admin_claim_hct_dispatch(text,text)'))
       LIKE '%AND shipped_at IS NULL%' THEN
    RAISE EXCEPTION '前置閘⑤:admin_claim_hct_dispatch 已經有「還沒出貨」條件 ⇒ 有人先改過, 停下來對一下';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzz_never_a_function(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘(負對照):現造函式名竟然命中 ⇒ 這把尺壞了';
  END IF;
END
$pre$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. 新表:每次「重新叫車」一列(第一次叫車照舊在 shipments 上, 不搬)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.shipment_hct_dispatch_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   uuid        NOT NULL REFERENCES public.shipments(id),
  -- 第一次叫車(shipments 上那一次)算第 1 次 ⇒ 本表從 2 開始
  attempt_no    integer     NOT NULL CHECK (attempt_no >= 2),
  claimed_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  actor         text        NOT NULL CHECK (actor ~ '^[a-z0-9_]{1,64}$'),
  -- 結果欄:只能由空值寫入一次(觸發器守), 只有 admin_record_hct_redispatch 會寫
  outcome       text        CHECK (outcome IN ('dispatched')),
  edelno        text,
  recorded_at   timestamptz,
  CONSTRAINT shipment_hct_dispatch_attempts_uniq UNIQUE (shipment_id, attempt_no),
  CONSTRAINT shipment_hct_dispatch_attempts_result_together
    CHECK ((outcome IS NULL AND recorded_at IS NULL) OR (outcome IS NOT NULL AND recorded_at IS NOT NULL))
);

COMMENT ON TABLE public.shipment_hct_dispatch_attempts IS
  '新竹「重新叫車」的紀錄(20260928010000)。一次一列;第一次叫車記在 shipments.hct_dispatch_attempted_at。'
  ' 身分、次數、佔位時間、操作人員永遠不能改;結果欄只能由空值寫入一次;整列不能刪。'
  ' 只經 admin_claim_hct_redispatch / admin_record_hct_redispatch 寫入。';

-- 不可改、不可刪(結果欄由空寫入一次除外)
CREATE FUNCTION public.pcm_hct_dispatch_attempts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '叫車紀錄不可刪除(attempt=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
     OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
     OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
     OR NEW.actor IS DISTINCT FROM OLD.actor THEN
    RAISE EXCEPTION '叫車紀錄的身分、次數、佔位時間、操作人員不可改(attempt=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.outcome IS NOT NULL
     AND (NEW.outcome IS DISTINCT FROM OLD.outcome
          OR NEW.edelno IS DISTINCT FROM OLD.edelno
          OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at) THEN
    RAISE EXCEPTION '叫車結果只能寫一次(attempt=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pcm_hct_dispatch_attempts_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipment_hct_dispatch_attempts_guard_bud
  BEFORE UPDATE OR DELETE ON public.shipment_hct_dispatch_attempts
  FOR EACH ROW EXECUTE FUNCTION public.pcm_hct_dispatch_attempts_guard();

ALTER TABLE public.shipment_hct_dispatch_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipment_hct_dispatch_attempts FROM PUBLIC, anon, authenticated, service_role;
-- 畫面要讀次數與時間 ⇒ 後台伺服器只給 SELECT;新增 / 改只走下面兩支 SECURITY DEFINER 函式。
GRANT SELECT ON TABLE public.shipment_hct_dispatch_attempts TO service_role;
-- 政策明寫, 不靠 service_role 的 BYPASSRLS(rls-service-role-policy-gate):後台伺服器要讀次數與時間。
CREATE POLICY shipment_hct_dispatch_attempts_select_service_role ON public.shipment_hct_dispatch_attempts
  FOR SELECT TO service_role USING (true);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. 重新叫車的佔位
-- ══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_claim_hct_redispatch(
  p_shipment_reference text,
  p_edelno             text,
  p_expected_attempt_no integer,
  p_actor              text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ship_id    uuid;
  v_status     text;
  v_deleted    timestamptz;
  v_shipped    timestamptz;
  v_attempted  timestamptz;
  v_dispatched timestamptz;
  v_edelno     text;
  v_orders     integer;
  v_blocked    text;
  v_last_no    integer;
  v_last_at    timestamptz;
  v_id         uuid;
BEGIN
  SELECT id INTO v_ship_id FROM public.shipments WHERE shipment_reference = p_shipment_reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_claim_hct_redispatch:查無這張出貨單(%)', p_shipment_reference USING ERRCODE = 'P0001';
  END IF;

  -- ① 鎖序照所有出貨守門:shipments → orders(pcm_p01_lock_box_orders 先鎖箱再鎖訂單), 鎖後判準。
  SELECT b.order_count, b.blocked INTO v_orders, v_blocked
    FROM public.pcm_p01_lock_box_orders(v_ship_id, NULL) b;
  IF v_orders = 0 THEN
    RAISE EXCEPTION 'admin_claim_hct_redispatch:這一箱 % 沒有任何品項, 不得叫車', p_shipment_reference USING ERRCODE = 'P0001';
  END IF;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'admin_claim_hct_redispatch:這一箱 % 裡有不能再出貨的訂單(%), 不得重新叫車', p_shipment_reference, v_blocked
      USING ERRCODE = 'P0001';
  END IF;

  -- ② 鎖住之後才讀這一箱
  SELECT hct_status, deleted_at, shipped_at, hct_dispatch_attempted_at, hct_dispatched_at, hct_request_id
    INTO v_status, v_deleted, v_shipped, v_attempted, v_dispatched, v_edelno
    FROM public.shipments WHERE id = v_ship_id;
  IF v_deleted IS NOT NULL OR v_shipped IS NOT NULL OR v_dispatched IS NOT NULL
     OR v_attempted IS NULL OR v_status IS DISTINCT FROM 'submitted' OR v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_claim_hct_redispatch:這一箱 % 不是「叫車結果未確認」的狀態(作廢 / 已出貨 / 已叫到 / 沒叫過 / 狀態或貨號不符), 不得重新叫車',
      p_shipment_reference USING ERRCODE = 'P0001';
  END IF;

  -- ③ 最後一次叫車時間 = GREATEST(第一次, 新表最大的那一次);只跟資料庫的 now() 比
  SELECT COALESCE(MAX(a.attempt_no), 1), GREATEST(v_attempted, MAX(a.claimed_at))
    INTO v_last_no, v_last_at
    FROM public.shipment_hct_dispatch_attempts a WHERE a.shipment_id = v_ship_id;
  IF v_last_at > pg_catalog.now() - interval '10 minutes' THEN
    RAISE EXCEPTION
      'admin_claim_hct_redispatch:這一箱 % 上一次叫車在 %, 還不到 10 分鐘, 上一次可能還在處理', p_shipment_reference, v_last_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ④ 畫面看到的最後一次要對得上(另有 (箱, 第幾次) 唯一鍵兜底)
  IF v_last_no IS DISTINCT FROM p_expected_attempt_no THEN
    RAISE EXCEPTION
      'admin_claim_hct_redispatch:這一箱 % 的叫車次數已經變了(畫面上是第 % 次, 現在是第 % 次), 請重新整理', p_shipment_reference,
      p_expected_attempt_no, v_last_no USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.shipment_hct_dispatch_attempts (shipment_id, attempt_no, actor)
  VALUES (v_ship_id, v_last_no + 1, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;
ALTER FUNCTION public.admin_claim_hct_redispatch(text,text,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_claim_hct_redispatch(text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_hct_redispatch(text,text,integer,text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. 重新叫車的結果(只記「叫到了」;不確定 / 被拒 ⇒ 不寫, 那一列維持空結果, 10 分鐘後可以再叫)
-- ══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_record_hct_redispatch(
  p_attempt_id uuid,
  p_edelno     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ship_id  uuid;
  v_no       integer;
  v_outcome  text;
  v_edelno   text;
  v_latest   integer;
BEGIN
  SELECT shipment_id, attempt_no, outcome, edelno INTO v_ship_id, v_no, v_outcome, v_edelno
    FROM public.shipment_hct_dispatch_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_redispatch:查無這次叫車(%)', p_attempt_id USING ERRCODE = 'P0001';
  END IF;

  -- 先鎖箱(與既有 admin_record_hct_dispatch 同樣先鎖再判)
  PERFORM 1 FROM public.shipments WHERE id = v_ship_id FOR NO KEY UPDATE;

  -- 同一個結果重送 ⇒ 直接成功(冪等)
  IF v_outcome = 'dispatched' AND v_edelno IS NOT DISTINCT FROM p_edelno THEN
    RETURN;
  END IF;
  IF v_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'admin_record_hct_redispatch:這次叫車已經記過不同的結果(%)', p_attempt_id USING ERRCODE = 'P0001';
  END IF;

  SELECT MAX(attempt_no) INTO v_latest FROM public.shipment_hct_dispatch_attempts WHERE shipment_id = v_ship_id;
  IF v_latest IS DISTINCT FROM v_no THEN
    RAISE EXCEPTION 'admin_record_hct_redispatch:這不是這一箱最新的一次叫車(第 % 次, 最新是第 % 次), 遲到的結果不記', v_no, v_latest
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.shipment_hct_dispatch_attempts
     SET outcome = 'dispatched', edelno = p_edelno, recorded_at = pg_catalog.now()
   WHERE id = p_attempt_id;
  -- 已有值就不動(管理者可能已「確認已交貨」寫過;覆寫會撞 write-once 讓整支失敗)
  UPDATE public.shipments
     SET hct_dispatched_at = COALESCE(hct_dispatched_at, pg_catalog.now())
   WHERE id = v_ship_id;
END
$fn$;
ALTER FUNCTION public.admin_record_hct_redispatch(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_hct_redispatch(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_hct_redispatch(uuid,text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. 第一次叫車的佔位補「還沒出貨」(Codex R1 必修 3)—— 參數、回傳型別不變;其餘逐字照 20260916000000:608
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_claim_hct_dispatch(
  p_shipment_reference text,
  p_edelno             text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status     text;
  v_deleted    timestamptz;
  v_attempted  timestamptz;
  v_edelno     text;
  v_n          int;
  v_ship_id    uuid;
  v_orders     integer;
  v_blocked    text;
  v_shipped    timestamptz;
BEGIN
  SELECT id, hct_status, deleted_at, hct_dispatch_attempted_at, hct_request_id, shipped_at
    INTO v_ship_id, v_status, v_deleted, v_attempted, v_edelno, v_shipped
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_claim_hct_dispatch:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張出貨單已作廢(%), 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 20260928010000:已出貨的箱不得叫車(Codex R1 必修 3)。判準仍以下面那句 UPDATE 的 WHERE 為準。
  IF v_shipped IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張出貨單已經出貨(%), 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張單的新竹狀態是 %(要 submitted 才叫得動車), shipment=%',
      COALESCE(v_status, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:貨號對不上(這一箱是 %, 而送來的是 %), shipment=%',
      COALESCE(v_edelno, '(空)'), COALESCE(p_edelno, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  SELECT b.order_count, b.blocked INTO v_orders, v_blocked
    FROM public.pcm_p01_lock_box_orders(v_ship_id, NULL) b;
  IF v_orders = 0 THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 沒有任何品項, 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 裡有不能再出貨的訂單(%), 不得叫車。請先作廢這一箱', p_shipment_reference, v_blocked
      USING ERRCODE = 'P0001';
  END IF;

  -- 佔位:資格條件【全部】住在這一句的 WHERE 裡(20260916000000 那一代的理由照舊);本代多「還沒出貨」。
  UPDATE public.shipments
     SET hct_dispatch_attempted_at = pg_catalog.now()
   WHERE shipment_reference = p_shipment_reference
     AND hct_dispatch_attempted_at IS NULL
     AND deleted_at IS NULL
     AND shipped_at IS NULL
     AND hct_status = 'submitted'
     AND hct_request_id IS NOT DISTINCT FROM p_edelno;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 佔不到位。三種可能:'
      ' ①它已經在 % 開始叫車了(可能叫到車, 也可能叫到一半掛掉)'
      ' ②它剛剛被別人作廢或改了狀態'
      ' ③它剛剛被標記出貨。'
      ' 都不准自動再打一發 ⇒ 請人看一眼。',
      p_shipment_reference, COALESCE(v_attempted, pg_catalog.now())
      USING ERRCODE = 'P0001';
  END IF;
END
$fn$;

-- ── 後置閘 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  r record;
  -- 收權斷言清單(migration-static-checks ③):本檔新建的每一個可授權物件都要列進來。
  v_relations text[] := ARRAY['public.shipment_hct_dispatch_attempts']::text[];
  v_functions text[] := ARRAY[
    'public.pcm_hct_dispatch_attempts_guard()',
    'public.admin_claim_hct_redispatch(text,text,integer,text)',
    'public.admin_record_hct_redispatch(uuid,text)'
  ]::text[];
  v_obj text;
BEGIN
  -- anon / authenticated 對本檔新建的物件一個權限都不能有
  FOREACH v_obj IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', v_obj, 'SELECT,INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege('authenticated', v_obj, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '後置閘:% 對 anon / authenticated 沒有收乾淨', v_obj;
    END IF;
  END LOOP;
  FOREACH v_obj IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_obj, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘:% 對 anon / authenticated 沒有收乾淨', v_obj;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.admin_claim_hct_redispatch(text,text,integer,text)'),
    ('public.admin_record_hct_redispatch(uuid,text)'),
    ('public.admin_claim_hct_dispatch(text,text)')
  ) v(sig) LOOP
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig)) THEN
      RAISE EXCEPTION '後置閘:% 不是 SECURITY DEFINER', r.sig;
    END IF;
    IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig))
       IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '後置閘:% 的設定不是恰好 search_path=""', r.sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r.sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r.sig, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘:% 的執行權不對(只該給 service_role)', r.sig;
    END IF;
  END LOOP;
  IF pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.admin_claim_hct_dispatch(text,text)'))
       NOT LIKE '%AND shipped_at IS NULL%' THEN
    RAISE EXCEPTION '後置閘:admin_claim_hct_dispatch 沒有補上「還沒出貨」';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.shipment_hct_dispatch_attempts'::regclass) THEN
    RAISE EXCEPTION '後置閘:shipment_hct_dispatch_attempts 沒開 RLS';
  END IF;
  IF pg_catalog.has_table_privilege('service_role', 'public.shipment_hct_dispatch_attempts', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.shipment_hct_dispatch_attempts', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.shipment_hct_dispatch_attempts', 'SELECT') THEN
    RAISE EXCEPTION '後置閘:shipment_hct_dispatch_attempts 的權限不對(service_role 只該有 SELECT)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'shipment_hct_dispatch_attempts'
                    AND policyname = 'shipment_hct_dispatch_attempts_select_service_role') THEN
    RAISE EXCEPTION '後置閘:shipment_hct_dispatch_attempts 沒有 service_role 的 SELECT 政策';
  END IF;
  RAISE NOTICE '✅ 20260928010000 後置閘全過';
END
$post$;

COMMIT;
