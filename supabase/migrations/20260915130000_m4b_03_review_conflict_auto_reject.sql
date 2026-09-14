-- 20260915130000_m4b_03_review_conflict_auto_reject.sql —— M-4b-03 改金額審核:管理者核准撞「單子被改過」⇒ 申請自動退回(第 2 代)
--
-- 🛑 未貼(寫好不貼;貼是 Sean 一次一個編號)。主視窗 2026-09-14 跨片 workflow 審查 confirmed high, 派工改。
--
-- ══ 病 ═════════════════════════════════════════════════════════════════
-- 第 1 代(20260915050000)approve 時帶「提案當下的 version」呼改價 RPC;單子在提案後被任何人動過(改收件、改發票、改別的品項…)
-- ⇒ 改價 RPC 回 CONFLICT ⇒ 第 1 代 RAISE ⇒ 整筆回滾、申請【留 pending】。
-- 而員工去重提會撞「一品項一條 pending」部分唯一索引 ⇒ 被拒「先請管理者處理那一條」;管理者畫面卻叫「請員工重提」⇒ 兩句話互指。
-- (出得去:管理者手動按「退回」。但畫面那句把人指向錯的動作。)
-- 🔴 而且這是【實作偏離 plan】:docs/plans/2026-09-14-m4b-03-amount-review-plan.md §1 逐字
--    「單子中間被改 ⇒ 改價 RPC 回 CONFLICT ⇒ 申請自動退回『單子變了, 請重提』」—— 第 1 代寫成了 RAISE。
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- · admin_review_order_item_amount 第 2 代 = 第 1 代本體【逐字】+ 只改 approve 那一段:
--     CONFLICT ⇒ status = rejected、review_note = '單子在提案後被改過, 請重提'、正常寫 audit、回 result = 'stale_rejected' ⇒ pending 放掉, 員工能重提。
--     NOOP 那句的「或請員工重提」一併拿掉(pending 還在時員工提不了)⇒ 改成「按『退回』把它結掉」。
-- · 🔴 為什麼 commit 是安全的:改價 RPC(現行 20260915060000 那一代)回 'CONFLICT' 那一行在它【任何 INSERT / UPDATE 之前】
--   ⇒ 自動退回這一發 commit 出去的只有「申請列標 rejected + 一筆審核稽核」, 沒有半套改價。
-- · 不動表、不動員工那支 RPC、不動改價 RPC。
-- ══ 形狀 ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE(簽章不變);🔴 它會把 SET 子句整組換掉 ⇒ 本支照寫 SET search_path = '';ACL 由第 1 代設、本支重發一次基準並事後斷言。
-- 前置閘:md5(prosrc) = 第 1 代(bdc7659cab80858b7766c8ebfa101837)⇒ 升第 2 代;= 第 2 代(abccd1c3c6c5d44824cc027542cef72c)⇒ 冪等重跑;其他 ⇒ 不認得的一代, 停(codex R1:不用字串判代)。
-- 回滾:supabase/rollbacks/20260915130000_down.sql = 貼回第 1 代本體(逐字)。已被自動退回的申請留著(那是真的發生過的)。
-- TS 半(同 commit):repository 多讀 result、action 認 stale_rejected ⇒ 新結果碼 amount_review_stale;
--   🔵 推薦【TS 先上、再貼本板】:TS 先 ⇒ 第 1 代照舊 RAISE ⇒ refused(那句已改成「按退回把它結掉」)。
--      貼板先也不壞資料, 但過渡期舊 TS 看到 status = rejected 會印「退回了, 員工看得到你的理由」—— 管理者按的是核准、理由是系統的, 歸因不準(codex R1 nit)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_oid oid;
  v_cfg text[];
  v_src text;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.admin_review_order_item_amount(uuid,text,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:admin_review_order_item_amount 不在 ⇒ 20260915050000 還沒貼, 先貼它';
  END IF;
  SELECT p.proconfig, p.prosrc INTO v_cfg, v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT ('search_path=""' = ANY (v_cfg) OR 'search_path=' = ANY (v_cfg)) THEN
    RAISE EXCEPTION '前置閘⓪:search_path 不是空字串(%)⇒ 不認得的一代, 拒繼續', v_cfg;
  END IF;
  IF pg_catalog.md5(v_src) = 'bdc7659cab80858b7766c8ebfa101837' THEN
    RAISE NOTICE '前置閘⓪:第 1 代在(md5 相符)⇒ 升第 2 代';
  ELSIF pg_catalog.md5(v_src) = 'abccd1c3c6c5d44824cc027542cef72c' THEN
    RAISE NOTICE '前置閘⓪:已是第 2 代(md5 相符)⇒ CREATE OR REPLACE 照樣重跑(冪等)';
  ELSE
    -- 🔴 codex R1 must-fix:⛔ ~~有 stale_rejected 就當第 2 代~~ —— 之後的修正版會保留那個字、另加檢查,
    --    用字判會讓本支重跑時把那些檢查【蓋掉】而事後閘看不出來。⇒ 兩代都用精確 md5, 其他一律停。
    RAISE EXCEPTION '前置閘⓪:md5(prosrc) = % 既不是第 1 代也不是第 2 代 ⇒ 有人改過這支, 停下來看', pg_catalog.md5(v_src);
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 7 參的 admin_update_order_item_amount';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.order_amount_requests'::regclass
                  AND c.contype = 'c' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%rejected%') THEN
    RAISE EXCEPTION '前置閘②:order_amount_requests 的狀態 CHECK 找不到 rejected ⇒ 自動退回會被擋';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260915130000(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_review_order_item_amount(
  p_request_row_id uuid,
  p_decision text,
  p_review_note text,
  p_actor text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_req        public.order_amount_requests%ROWTYPE;
  v_order_id   uuid;
  v_ord        RECORD;
  v_note       text := NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '');
  v_outcome    text;
  v_status     text;
  v_result     text := 'ok';
  v_n          integer;
BEGIN
  -- G1 輸入
  IF p_request_row_id IS NULL THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: request_row_id 必填';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: p_request_id 不可為空';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: decision 要是 approve 或 reject(收到 %)', COALESCE(p_decision, '(缺)');
  END IF;
  IF p_decision = 'reject' AND v_note IS NULL THEN
    RAISE EXCEPTION '退回要寫理由';
  END IF;
  IF v_note IS NOT NULL AND pg_catalog.length(v_note) > 500 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 理由最多 500 字';
  END IF;
  -- G2 管理者閘(mgr0 §12-3 形狀;actor 不存在 / 停用 ⇒ NOT FOUND ⇒ 擋)
  SELECT s.is_manager INTO v_is_manager FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  -- G3 鎖序(codex R1 must-fix ①):先不加鎖取 order_id ⇒ 鎖 orders FOR NO KEY UPDATE(與既有改價 RPC 同一種鎖, 同單兩條申請同時核會【排隊】不會死鎖)
  --    ⇒ 再 FOR UPDATE 鎖申請列、重讀狀態。⛔ ~~先 FOR SHARE 再讓改價 RPC 升級成 NO KEY UPDATE~~ 那是鎖升級, 兩邊互等。
  SELECT r.order_id INTO v_order_id FROM public.order_amount_requests r WHERE r.id = p_request_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 找不到這條申請';
  END IF;
  SELECT o.id, o.cancelled_at INTO v_ord FROM public.orders o WHERE o.id = v_order_id FOR NO KEY UPDATE;
  SELECT * INTO v_req FROM public.order_amount_requests r WHERE r.id = p_request_row_id FOR UPDATE;
  IF NOT FOUND OR v_req.order_id IS DISTINCT FROM v_order_id THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 找不到這條申請';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION '這條申請已經是「%」, 不能再處理', v_req.status;
  END IF;
  -- G4 單子還在不在:已取消 ⇒ 標 superseded(帶 reviewed_*), 回 superseded 讓管理者知道
  IF v_ord.id IS NULL OR v_ord.cancelled_at IS NOT NULL THEN
    UPDATE public.order_amount_requests
       SET status = 'superseded', reviewed_by = p_actor, reviewed_at = pg_catalog.now(), review_note = '單已取消, 申請作廢'
     WHERE id = v_req.id AND status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: 申請列沒標成 superseded(% 列)', v_n;
    END IF;
    INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
    VALUES (p_actor, 'order.item.amount.review', 'order_item:' || v_req.order_item_id::text, p_request_id,
            pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'pending'),
            pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'superseded', 'decision', p_decision,
              'from_unit_price', v_req.from_unit_price, 'to_unit_price', v_req.to_unit_price, 'requested_by', v_req.requested_by),
            '單已取消, 申請作廢', 'admin');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: superseded 稽核落 % 列', v_n;
    END IF;
    RETURN pg_catalog.jsonb_build_object('result', 'superseded', 'request_row_id', v_req.id, 'status', 'superseded', 'order_id', v_req.order_id);
  END IF;
  -- G5 核 / 退
  IF p_decision = 'approve' THEN
    -- 🔴 改價走【既有】那支, 一字不改:actor = 管理者、version = 提案時的(樂觀鎖)。
    --    第 2 代(20260915130000):CONFLICT ⇒ 不 RAISE, 照 plan §1 自動退回(見下);NOOP / 其他非 OK ⇒ 仍 RAISE 整筆回滾、申請留 pending。
    SELECT public.admin_update_order_item_amount(
             v_req.order_id, v_req.order_item_id, v_req.to_unit_price, v_req.expected_version,
             p_actor, p_request_id, v_req.zero_price_reason)
      INTO v_outcome;
    IF v_outcome = 'CONFLICT' THEN
      -- 🔴 第 2 代:單子在提案後被改過 ⇒ 沒改價, 申請【自動退回】並正常 commit。
      --    第 1 代 RAISE 留 pending 會卡死:員工重提撞「一品項一條 pending」、管理者畫面叫「請員工重提」⇒ 兩句話互指。
      --    改價 RPC 回 CONFLICT 之前一筆都沒寫(版本比對在它任何 INSERT / UPDATE 之前)⇒ 這裡 commit 不會帶出半套改價。
      v_status := 'rejected';
      v_note   := '單子在提案後被改過, 請重提';
      v_result := 'stale_rejected';
    ELSIF v_outcome = 'NOOP' THEN
      RAISE EXCEPTION '單價已經是 % 了, 這條申請沒有東西可改;按「退回」把它結掉', v_req.to_unit_price;
    ELSIF v_outcome IS DISTINCT FROM 'OK' THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: 改價回了「%」, 沒有改價', COALESCE(v_outcome, '(NULL)');
    ELSE
      v_status := 'approved';
    END IF;
  ELSE
    v_status := 'rejected';
  END IF;
  UPDATE public.order_amount_requests
     SET status = v_status, reviewed_by = p_actor, reviewed_at = pg_catalog.now(), review_note = v_note
   WHERE id = v_req.id AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 申請列沒更新到(% 列)', v_n;
  END IF;
  -- G6 稽核(改價本身的那一筆由 admin_update_order_item_amount 自己寫, 本筆記「誰核 / 退了什麼」)
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.item.amount.review', 'order_item:' || v_req.order_item_id::text, p_request_id,
          pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'pending'),
          pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', v_status, 'decision', p_decision,
            'from_unit_price', v_req.from_unit_price, 'to_unit_price', v_req.to_unit_price,
            'requested_by', v_req.requested_by, 'review_note', v_note),
          v_note, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 稽核落 % 列 ⇒ 核退與留紀錄必須同生共死', v_n;
  END IF;
  -- order_id 一起回(codex C 片 must-fix:action 用它綁導頁, 不信表單那顆 return_to 裡的 open=)。
  RETURN pg_catalog.jsonb_build_object('result', v_result, 'request_row_id', v_req.id, 'status', v_status, 'order_id', v_req.order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) TO service_role;
ALTER FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) IS
  'M-4b-03 管理者核 / 退「改品項單價」申請(SECDEF, service_role only;管理者限定 ''無權執行此操作'')。第 2 代 20260915130000。'
  ' approve ⇒ 同交易呼既有 admin_update_order_item_amount(actor = 管理者, version = 提案時的);'
  ' 回 CONFLICT ⇒ 不改價、申請自動 rejected(result = stale_rejected);NOOP / 其他非 OK ⇒ 整筆回滾申請留 pending;'
  ' reject ⇒ note 必填;單已取消 ⇒ 標 superseded。同交易寫 audit order.item.amount.review。';

DO $post$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure('public.admin_review_order_item_amount(uuid,text,text,text,text)');
  v_src text;
  v_bad text;
  v_state text;
  v_msg text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '事後閘⓪:函式不見了';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid AND p.prosecdef
                  AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
    RAISE EXCEPTION '事後閘①:不是 SECURITY DEFINER / search_path 空字串 / owner postgres';
  END IF;
  SELECT pg_catalog.string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = v_oid
     AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘②:非白名單 grantee:%;拒繼續', v_bad;
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②:EXECUTE 應只給 service_role';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF pg_catalog.strpos(v_src, 'stale_rejected') = 0 OR pg_catalog.strpos(v_src, '單子在提案後被改過, 請重提') = 0 THEN
    RAISE EXCEPTION '事後閘③:函式體沒有自動退回那一段 ⇒ 貼到的不是第 2 代';
  END IF;
  IF pg_catalog.strpos(v_src, '請員工重新提一次') > 0 OR pg_catalog.strpos(v_src, '退回它或請員工重提') > 0 THEN
    RAISE EXCEPTION '事後閘③:第 1 代那兩句互指的話還在';
  END IF;
  IF pg_catalog.strpos(v_src, '無權執行此操作') = 0 OR pg_catalog.strpos(v_src, 'superseded') = 0
     OR pg_catalog.strpos(v_src, 'FOR NO KEY UPDATE') = 0 OR pg_catalog.strpos(v_src, '''order_id'', v_req.order_id') = 0 THEN
    RAISE EXCEPTION '事後閘③:第 1 代的管理者閘 / superseded / 鎖序 / order_id 少了一樣 ⇒ 聯集漏了';
  END IF;
  IF pg_catalog.strpos(v_src, 'P9Z99_20260915130000') <> 0 THEN
    RAISE EXCEPTION '事後閘③b(負對照):現造的字串居然在定義裡 ⇒ 這把尺壞了';
  END IF;
  -- ④ 活體:不存在的 actor ⇒ 管理者閘要擋(證明函式真的跑得起來, 且閘在第一道)。子交易吃掉例外, 不影響本 migration。
  BEGIN
    PERFORM public.admin_review_order_item_amount(
      '00000000-0000-4000-8000-000000000000'::uuid, 'approve', NULL, 'postgate-nobody-20260915130000', 'postgate');
    RAISE EXCEPTION '事後閘④:不存在的 actor 居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_msg <> '無權執行此操作' THEN
      RAISE EXCEPTION '事後閘④:應回「無權執行此操作」, 回了 %(%)', v_msg, v_state;
    END IF;
  END;
  RAISE NOTICE '20260915130000 貼好了:admin_review_order_item_amount 第 2 代(CONFLICT ⇒ 自動退回)。';
END
$post$;

COMMIT;
