-- 20260929010000_m4b_01c_correct_verdict_actor_gate.sql
-- M-4b-01 補強(接 20260927020000):admin_correct_order_refund_verdict(更正人工退款判定)補「操作人必須是在職員工」。
-- Sean 2026-09-28 Q3 甲:退款、儲值金、改等級維持所有員工都能做, 只補停用帳號不能操作。
-- 計畫(主視窗 2026-09-29 批准, Fable R1 PASS):~/pcm-mailbox/計畫-退款判定更正補在職檢查-20260929.md
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- 在 G2(操作人格式)之後、G3(輸入檢查)之前插入一段 G2b:staff 那一列 is_active 才放行, 否則 RAISE '無權執行此操作'(P0001)。
-- 其餘本體一字不動。誰能做不變:在職管理者與一般員工照舊能更正。
--
-- ══ 基準 ═══════════════════════════════════════════════════
-- 🔴 本體逐字取自【正式庫現行定義】(2026-09-29 唯讀 pg_get_functiondef;prosrc md5 = 3144726e319de2d79d28b156418db513)。
--    不抄 repo 最新一代 20260905440000:501(09-27 那片量過:重播出來的本體與正式庫可能不同)⇒ 前置閘釘正式庫 md5。
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ header 逐字保留 SECURITY DEFINER 與 SET search_path TO ''(本支沒有 lock_timeout)。
-- 🔴 ACL 不動(CREATE OR REPLACE 保留);後置閘再驗 anon/authenticated 不能 EXECUTE、service_role 能。
-- ⚠️ 鎖:新增 staff FOR SHARE, 順序 staff → orders → order_refunds, 與已上線的 admin_initiate_order_refund 同序;
--    停用員工的寫入路(admin_staff_set_active、apps/admin staff-repository.ts)不碰 orders / order_refunds ⇒ 不成環。
-- ⚠️ scripts/473b1-concurrency-probe.sh 用 probe_actor 呼叫本函式:貼上之後要先在拋棄式 PG 的 staff 放一列在職的 probe_actor 才跑得動。
-- 🔵 後台對應:apps/admin/src/lib/payment/refund-correction-repository.ts 只把「P0001 + 無權執行此操作」認成沒有權限
--    (本支 G4 另有兩句無 ERRCODE 的 P0001「找不到退款」「order_id 在鎖前後不一致」, 那兩句照舊當系統異常)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260929010000-rollback.sql:貼回正式庫原版整支(前置閘釘本檔新版 md5 4b3a1af6d01dac3d9d12fb871a5e5fe0)。回滾不動資料。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘一:public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text) 不在 ⇒ 簽章不是我以為的';
  END IF;
  IF v_src LIKE '%無權執行此操作%' THEN
    RAISE EXCEPTION '前置閘二:已含操作人檢查 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF pg_catalog.md5(v_src) <> '3144726e319de2d79d28b156418db513' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:本體 md5 不是 3144726e319de2d79d28b156418db513(實得 ' || pg_catalog.md5(v_src) || ')⇒ 有人動過它, 本檔抄本基準已失效, 停下人工對齊';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘四:staff.is_active 不在或可為 NULL';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_correct_order_refund_verdict(p_refund_id uuid, p_expected_correction_id uuid, p_actor text, p_reason text, p_corrected_to text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE
  v_actor   text;
  v_reason  text;
  v_req     text;
  v_locked  uuid;
  v_status  text;
  v_freason text;
  v_order   uuid;
  v_cur_id  uuid;
  v_seq     integer;
  v_new_id  uuid;
  v_dup     uuid;
  v_dup_refund uuid;
  v_pre_order  uuid;   -- 片③:鎖序用的路由鍵(無鎖預讀;刻意與 v_order 分開, 否則一致性檢查恆真)
  v_n       integer;
BEGIN
  -- ── G1 隔離閘(排最前)──────────────────────────────────────────────────
  -- 本支的「最新一筆說了算 + CAS」靠的是「父列鎖 + 鎖後重讀看得到兄弟已提交的列」。
  -- REPEATABLE READ 下取得鎖之後快照**仍看不到**兄弟剛提交的更正 ⇒ CAS 拿舊值比對而放行
  -- ⇒ 兩筆更正互相沖掉。本 repo 對這個形狀有實測案底(A2b1 的 P2B02)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:必須在 read committed 下呼叫(實際=%)⇒ '
                    'RR 快照看不到兄弟已提交的更正,CAS 會失效',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01', CONSTRAINT = 'pcm_rmc_isolation';
  END IF;

  -- ── G2 actor:排在**任何資料讀取之前**(身分錯的呼叫拿不到任何帳本資訊)──────
  v_actor := pg_catalog.btrim(coalesce(p_actor, ''));
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:經手人代號格式不符(需 ^[a-z0-9_]{1,64}$)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_actor_invalid';
  END IF;

  -- ── G2b 在職檢查(20260929010000 補;Sean 2026-09-28 Q3 甲:誰能做不變, 只擋停用帳號)──
  -- 🔴 寫法與訊息逐字照 20260927020000:544-546(admin_initiate_order_refund)。排在任何退款資料讀取之前。
  -- 🔴 SQLSTATE 是預設 P0001;後台 refund-correction-repository.ts 只把「P0001 + 無權執行此操作」認成沒有權限。
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- ── G3 輸入驗 ────────────────────────────────────────────────────────────
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款識別碼必填'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_identity_missing';
  END IF;
  -- 🔴 值域在這裡具名拒一次(CHECK 也會擋,但那是縱深;這裡才講得清楚是哪個參數錯)。
  IF p_corrected_to IS NULL OR p_corrected_to NOT IN ('money_moved', 'no_money_moved') THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:新判定必須是 money_moved 或 no_money_moved(收到 [%])',
                    coalesce(p_corrected_to, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_verdict_invalid';
  END IF;
  -- 🔴 字集必須明列(codex 關卡2):`btrim(x)` 只剝一般空格 ⇒ 只送換行/Tab 會被當成有效理由。
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''), E' \t\r\n');
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:修改理由必填'
                    '(錢帳上「為什麼把判定改掉」是稽核第一個問題)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_reason_required';
  END IF;
  v_req := pg_catalog.btrim(coalesce(p_request_id, ''), E' \t\r\n');
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id 必填(手滑連按兩次的冪等鍵)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_request_id_required';
  END IF;

  -- ── G4 鎖父列(序列化點)──────────────────────────────────────────────────
  -- 🔴 **必須 FOR NO KEY UPDATE**:本表對 order_refunds 有 FK ⇒ 下面的 INSERT 會取父列
  --    KEY SHARE;FOR UPDATE 與 KEY SHARE 是 A2b1 已實測過的 40P01 死結形狀
  --    (memory `project_m4b-a2b1-guard-decisions`)。
  -- 🔴🔴 **片③ 鎖序三步**(理由同 admin_void_manual_refund;本函式原本也先鎖子表)。
  --    ⚠️ 預讀刻意用**另一個變數** `v_pre_order` —— 兩邊都用 `v_order` 的話,
  --      下面那道一致性檢查會**恆真**(第二次讀把第一次的值蓋掉了)。
  SELECT r.order_id INTO v_pre_order FROM public.order_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:找不到退款(%)', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_pre_order FOR NO KEY UPDATE;

  SELECT r.id, r.status, r.failed_reason, r.order_id
    INTO v_locked, v_status, v_freason, v_order
    FROM public.order_refunds r
   WHERE r.id = p_refund_id
     FOR NO KEY UPDATE;
  IF FOUND AND v_order IS DISTINCT FROM v_pre_order THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款 % 的 order_id 在鎖前後不一致(% ⇒ %)⇒ 資料異常, 停下', p_refund_id, v_pre_order, v_order;
  END IF;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:找不到退款(%)⇒ 取不到序列化點,拒絕寫入',
                    p_refund_id
      USING ERRCODE = 'P8C03', CONSTRAINT = 'pcm_rmc_parent_row_required';
  END IF;

  -- ── G5 鎖後重讀:只有「卡住的人工判定列」可以被更正 ─────────────────────────
  -- 值域權威 = `20260803150000:760`(RW4 出口 `SET status='failed', failed_reason='manual_failed'`)。
  IF v_status <> 'failed' OR v_freason IS DISTINCT FROM 'manual_failed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款 % 現況 status=% / failed_reason=% ⇒ '
                    '本支只更正人工判定(failed + manual_failed);其他狀態要改請走對帳流程',
                    p_refund_id, v_status, coalesce(v_freason, '(NULL)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_target_not_manual_failed';
  END IF;

  -- ── G6a 冪等:同一 request_id 已寫過 ⇒ 回 DUPLICATE,不當成錯誤 ──────────────
  -- 已持父列鎖 ⇒ 這個讀取看得到兄弟已提交的列(G1 保證 read committed)。
  -- UNIQUE(request_id) 是後盾;這裡先答是為了讓「手滑連按兩次」拿到人話而不是 23505。
  -- 🔴 **必須連 refund_id 一起核**(codex 關卡2 must-fix,我認同):`request_id` 是**全域唯一**,
  --    只比對 token 的話,同一個 token 被誤用在**另一筆退款**上時,本支會回一個
  --    「DUPLICATE_REQUEST + 別筆退款的 correction_id」—— 呼叫端會把它讀成「這筆已經更正成功了」,
  --    而事實是這筆**一個字都沒寫**。那是靜默的假成功,比報錯嚴重。
  SELECT c.id, c.refund_id INTO v_dup, v_dup_refund
    FROM public.order_refund_manual_corrections c
   WHERE c.request_id = v_req;

  IF v_dup IS NOT NULL AND v_dup_refund = p_refund_id THEN
    -- 真的是同一筆的重播 ⇒ 冪等回應
    -- 🔴 **片③(關卡2 R1):重放這條路【也要同步】** —— 舊版做完而沒同步的更正,
    --    重放時若直接 RETURN, 那張單的 payment_status 永遠停在 stale。
    PERFORM public.pcm_sync_order_refund_payment_status(v_order);
    RETURN pg_catalog.jsonb_build_object(
      'result', 'DUPLICATE_REQUEST', 'refund_id', p_refund_id, 'correction_id', v_dup);
  END IF;
  IF v_dup IS NOT NULL THEN
    -- token 撞到別筆退款 ⇒ **拒絕**,不假裝成功(fail-closed)
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id [%] 已被退款 % 用過,'
                    '不能再用於退款 % ⇒ 拒絕(冪等鍵全域唯一;請換一把新的)',
                    v_req, v_dup_refund, p_refund_id
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_request_id_reused';
  END IF;
  -- ⚠️ **誠實邊界**:本檢查在父列鎖之下,但 `request_id` 的唯一性是**全域**的、不受該鎖序列化。
  --    兩個交易對**不同** refund 同時用同一把 token 時,兩邊都查無重複 ⇒ 後到者撞 UNIQUE 得 23505。
  --    方向是 fail-closed(不會寫壞、不會假成功),呼叫端把 23505 +
  --    `order_refund_manual_corrections_request_id_key` 當成「換一把 token 重試」處理。

  -- ── G6b CAS:現行有效更正 ≠ 呼叫端看到的那筆 ⇒ 拒(併發正確性的本體)────────
  -- 🔴 `p_expected_correction_id` **可為 NULL**,語意 = 「我看到的是尚未被更正過」。
  --    ⇒ 必須用 IS DISTINCT FROM;用 <> 的話 NULL 比較回 NULL、整個 IF 不成立 = 這道閘失效。
  SELECT v.correction_id INTO v_cur_id
    FROM public.order_refund_effective_verdict v
   WHERE v.refund_id = p_refund_id;

  IF v_cur_id IS DISTINCT FROM p_expected_correction_id THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:你看到的更正(%)已經不是現行更正(%)⇒ '
                    '期間有人改過,請重新讀取後再送出',
                    coalesce(p_expected_correction_id::text, '(尚未更正)'),
                    coalesce(v_cur_id::text, '(尚未更正)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_cas_mismatch';
  END IF;

  -- ── G7 寫入一列 + row_count 守 ────────────────────────────────────────────
  -- 姊妹線寫兩列(沖銷 + 新判定)是因為它的舊列會擋唯一索引;本片舊列本來就不動,
  -- **一列就夠**,不為了對稱而多寫一列。
  SELECT coalesce(pg_catalog.max(c.seq), 0) INTO v_seq
    FROM public.order_refund_manual_corrections c
   WHERE c.refund_id = p_refund_id;

  INSERT INTO public.order_refund_manual_corrections
         (refund_id, seq, corrected_to, reason, actor, request_id)
  VALUES (p_refund_id, v_seq + 1, p_corrected_to, v_reason, v_actor, v_req)
  RETURNING id INTO v_new_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:更正列落 % 列(期望恰 1)⇒ '
                    '可能有 BEFORE INSERT trigger 把它吃掉了', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count';
  END IF;

  -- ── G8 同交易稽核(after 取自實際寫入值,不是參數)──────────────────────────
  INSERT INTO public.admin_audit_log
         (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.correct_verdict', 'order:' || v_order::text,
          pg_catalog.jsonb_build_object('effective_correction_id', v_cur_id),
          pg_catalog.jsonb_build_object('refund_id', p_refund_id,
                                        'correction_id', v_new_id,
                                        'seq', v_seq + 1,
                                        'corrected_to', p_corrected_to),
          v_reason, v_req, 'admin');

  -- 🔴 稽核也要 row_count 守(codex 關卡2 must-fix;G7 有、G8 漏了就是不對稱):
  --    `admin_audit_log` 上若有 BEFORE INSERT trigger 把列吃掉,更正照樣提交而**稽核憑空消失** ——
  --    金流帳上「誰改的」不見了,而畫面完全正常。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:稽核列落 % 列(期望恰 1)⇒ '
                    '更正不得在沒有稽核的情況下成立,整筆回滾', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count_audit';
  END IF;

  -- 🔴🔴 **片③:更正判定會改變「錢有沒有動」⇒ 狀態要跟著重算。**
  --    `corrected_to='money_moved'` 讓一筆 failed 的卡退變成「錢出去了」,
  --    而反向的更正讓它變回「沒出去」⇒ **兩個方向都要同步**, 不是只有一邊。
  PERFORM public.pcm_sync_order_refund_payment_status(v_order);

  RETURN pg_catalog.jsonb_build_object(
    'result',        'CORRECTED',
    'refund_id',     p_refund_id,
    'correction_id', v_new_id,
    'seq',           v_seq + 1,
    'corrected_to',  p_corrected_to);
END
$function$;

DO $post$
DECLARE
  v_src text; v_config text[]; v_secdef boolean;
BEGIN
  SELECT p.prosrc, p.proconfig, p.prosecdef INTO v_src, v_config, v_secdef
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '後置閘一:admin_correct_order_refund_verdict 不存在';
  END IF;
  IF v_src NOT LIKE '%無權執行此操作%' OR v_src NOT LIKE '%20260929010000%' THEN
    RAISE EXCEPTION '後置閘二:本體沒有本檔的在職檢查';
  END IF;
  IF pg_catalog.md5(v_src) <> '4b3a1af6d01dac3d9d12fb871a5e5fe0' THEN
    RAISE EXCEPTION '後置閘三:本體 md5 不是本檔產出的 4b3a1af6d01dac3d9d12fb871a5e5fe0(實得 %)', pg_catalog.md5(v_src);
  END IF;
  IF NOT v_secdef OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '後置閘四:不是 SECURITY DEFINER 或 SET 子句被換掉(實得 %)', v_config;
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘五:對 anon/authenticated 開著 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘六:service_role 不能 EXECUTE ⇒ 後台接線斷了';
  END IF;
  -- 後置閘七:真的呼叫一次(做法照 20260814190000:558-573)。不存在的操作人 ⇒ 期望被新檢查擋下(P0001 無權執行此操作),
  -- 證明它排在 G4(取父列, P8C03)之前而且真的會執行。被擋在讀任何退款資料之前 ⇒ 不寫資料。
  BEGIN
    PERFORM public.admin_correct_order_refund_verdict(
      '00000000-0000-0000-0000-000000000000'::uuid, NULL,
      'no_such_staff_20260929010000', 'apply 自檢', 'no_money_moved', 'apply_selftest_20260929010000');
    RAISE EXCEPTION '後置閘七:不存在的操作人竟然沒被擋' USING ERRCODE = 'P8Z01';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM <> '無權執行此操作' THEN
        RAISE EXCEPTION '後置閘七:被擋的原因不是在職檢查(實得 %)', SQLERRM;
      END IF;
  END;
END
$post$;

COMMIT;
