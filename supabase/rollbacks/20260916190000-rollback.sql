-- 20260916190000-rollback.sql —— 退回 20260916190000_m4b_shipment_audit_actor.sql
--
-- 做什麼:DROP 那五支【帶 p_actor / p_request_id】的新簽章,用**貼板前的舊本體逐字**重建五支舊簽章,並還原授權。
-- 🔴 **退之前要先退程式**:TS 那一顆 commit 帶著 `p_actor` 呼叫,舊簽章收不到那兩個參數 ⇒ 會 PGRST202。
--    順序:revert TS commit 並部署 ⇒ 再跑本檔。(與貼板時相反:那時是板先貼、碼後推。)
-- 🔵 **已經寫進去的稽核列不刪** —— `admin_audit_log` 是 append-only,留著無害而且那是真的發生過的事。
-- 🔴 退完同批跑 `pcm_acl_approve_latest`(p_note 帶 20260916190000 與「rollback」):五支又 DROP+重建一次。
-- 🔵 舊本體來源:2026-09-16 從探針庫(= 正式庫 schema dump 起跳)`pg_get_functiondef` 原樣匯出,
--    逐支與正式庫 `md5(prosrc)` 比對過一致(0855… / 84d7… / 2b24… / ed02… / ec87…)。
--    ⇒ 退完可以自己驗:五支的 md5 應該回到那五個值。

SET LOCAL lock_timeout = '5s';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  -- 前置閘:必須是 20260916190000 那一代(釘新 md5;2026-09-16 在探針庫實際套用後量到的)
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_create_shipment(text,uuid,jsonb,text,text,text,text)'))
     IS DISTINCT FROM 'a549141df885f2aac684a7e76eeb9070' THEN
    RAISE EXCEPTION '退回前置閘①:admin_create_shipment 不是 20260916190000 那一代 ⇒ 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_add_shipment_items(text,uuid,jsonb,text,text)'))
     IS DISTINCT FROM '5da388b9144bf23aa8fec8d9a08a6b42' THEN
    RAISE EXCEPTION '退回前置閘②:admin_add_shipment_items 不是 20260916190000 那一代 ⇒ 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_mark_shipment_shipped(text,uuid,text,text,text)'))
     IS DISTINCT FROM 'ba309767a2eb68c255dd4216ba7eab4c' THEN
    RAISE EXCEPTION '退回前置閘③:admin_mark_shipment_shipped 不是 20260916190000 那一代 ⇒ 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_void_shipment(text,uuid,text,text,text)'))
     IS DISTINCT FROM '03e1ad9ff5ffb1f4957c321998ea5d26' THEN
    RAISE EXCEPTION '退回前置閘④:admin_void_shipment 不是 20260916190000 那一代 ⇒ 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_unvoid_shipment(text,uuid,text,text)'))
     IS DISTINCT FROM '4c3f088e1fca54e9f99f5b1459b2f622' THEN
    RAISE EXCEPTION '退回前置閘⑤:admin_unvoid_shipment 不是 20260916190000 那一代 ⇒ 停下對齊';
  END IF;
END
$pre$;

-- ① admin_create_shipment ⇒ 回舊簽章舊本體
DROP FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text, text, text);

CREATE FUNCTION public.admin_create_shipment(p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_max_tries constant int := 5;   -- 🔴 上界 5 照 N3b(`20260730120100:12` 逐字「包在上限 5 次的重試迴圈裡」)
  v_replay  jsonb;
  v_row     jsonb;
  v_snap    jsonb;
  v_con     text;
  v_ref     text;
  v_id      uuid;
  v_try     int := 0;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_create_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- ── 冪等層(W2)。🔴 **必須在任何業務寫入之前**,且**絕不得被搬進下面的重試迴圈**
  --    (plan §1c 面 4:第二圈會撞到自己上一圈寫的鍵列 ⇒ 誤判成併發 ⇒ 轉重放 ⇒ 回半成品)。
  v_replay := public.pcm_b2_shipping_idem_claim(
    'create_shipment', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object(
      'customer_user_id',   p_customer_user_id,
      'recipient_snapshot', p_recipient_snapshot,
      'carrier_code',       p_carrier_code,
      'carrier_note',       p_carrier_note)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話驗證(訊息層)────────────────────────────────
  -- 🔴 這一段**不是正確性層** —— 真正擋住壞資料的是 `shipments` 上的 CHECK 與 FK。
  --    它存在的理由只有一個:讓員工看到「哪個欄位、要怎麼改」,而不是一句 raw 23514。
  --    ⇒ 拿掉這段資料仍然進不去(harness 有格證這件事),但訊息會退化。
  IF p_carrier_code IS NULL OR p_carrier_code NOT IN ('hct', 'sf', 'other') THEN
    RAISE EXCEPTION '建立包裹:快遞商代號只能是 hct(新竹物流)/ sf(順豐)/ other(其他),收到的是 %',
                    coalesce(p_carrier_code, '(空白)')
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_code_domain';
  END IF;
  IF (p_carrier_code = 'other') <> (NOT public.pcm_b2_is_blank(p_carrier_note)) THEN
    IF p_carrier_code = 'other' THEN
      RAISE EXCEPTION '建立包裹:快遞商選「其他」時必須填快遞商說明'
        USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_note_pair';
    ELSE
      RAISE EXCEPTION '建立包裹:快遞商是 % 時不可填快遞商說明(說明只給「其他」用)', p_carrier_code
        USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_note_pair';
    END IF;
  END IF;
  -- 🔴 跨模型審查(Fable):檔頭宣稱「業務拒絕講清楚哪個欄位」,但收件資料為 NULL 會噴 raw 23502、
  --    形狀錯會噴 raw `shipments_recipient_snapshot_shape`(23514)—— 正是檔頭說不該出現的東西。
  --    ⇒ 補這一道。真正的權威仍是 s1a1 的 CHECK(本段拿掉資料照樣進不去)。
  IF p_recipient_snapshot IS NULL
     OR pg_catalog.jsonb_typeof(p_recipient_snapshot) <> 'object'
     OR NOT (p_recipient_snapshot ?& ARRAY['name','phone','line'])
     OR (p_recipient_snapshot - ARRAY['name','phone','line']) <> '{}'::jsonb THEN
    RAISE EXCEPTION '建立包裹:收件資料必須是**恰好**含 name / phone / line 三個欄位的物件(收到的是 %)',
                    coalesce(p_recipient_snapshot::text, '(空)')
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_recipient_shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = p_customer_user_id) THEN
    RAISE EXCEPTION '建立包裹:找不到這位客人(user_id=%),請確認是從客人頁面進來的', p_customer_user_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_customer_missing';
  END IF;

  -- ── 產號 + INSERT,包在重試迴圈裡(W0 三件之一)──────────
  -- 🔴 迴圈**必須包住 INSERT** —— 產號器產的只是**候選值**,唯一性由 UNIQUE 約束強制
  --    ⇒ 撞號只有在 INSERT 當下才觀察得到(這正是 W1 把三件推到本片的理由)。
  LOOP
    v_try := v_try + 1;
    v_ref := public.pcm_generate_display_id();
    BEGIN
      INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, carrier_note)
      VALUES (v_ref, p_customer_user_id, p_recipient_snapshot, p_carrier_code,
              CASE WHEN p_carrier_code = 'other' THEN p_carrier_note ELSE NULL END)
      RETURNING pg_catalog.to_jsonb(shipments.*) INTO v_row;
      EXIT;                                   -- 成功 ⇒ 離開迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      -- 🔴 三面全覆蓋(開工令 ③)。`IS DISTINCT FROM`、不得用 `<>`(NULL 會被靜默吞掉)。
      IF v_con IS DISTINCT FROM 'shipments_reference_unique' THEN
        RAISE;   -- pkey / hct_request_id_key / 未知面 ⇒ 原封拋回,不得當成撞號重產
      END IF;
      IF v_try >= c_max_tries THEN
        -- 🔴 耗盡要有自己的碼、不得靜默回一般失敗(W0 三件之三)
        RAISE EXCEPTION '建立包裹:連續 % 次都撞到重複的包裹單號,已放棄。這通常表示單號空間異常,請回報工程。', c_max_tries
          USING ERRCODE = 'P2B21', CONSTRAINT = 'pcm_b2_w3a_reference_exhausted';
      END IF;
      -- 否則:下一圈重產號重試
    END;
  END LOOP;

  -- ── 快照 + 回填(§1c 面 3:同一交易)──────────────────────
  -- 🔴 **構造性的 `to_jsonb` 同源**(開工令 ②):三個值全部**直接取自 `v_row`**,
  --    程式裡沒有任何一處自己把值轉成字串 ⇒ 重放比對必然相等,不靠任何人記得這條契約。
  v_snap := pg_catalog.jsonb_build_object(
    'id',                 v_row -> 'id',
    'shipment_reference', v_row -> 'shipment_reference',
    'customer_user_id',   v_row -> 'customer_user_id');
  v_id := (v_row ->> 'id')::uuid;

  -- 🔴 回傳值由 `record()` 產(W2 的 R1-F4 契約):首次成功與重放**逐鍵相同、只差 idempotent 旗標**。
  RETURN public.pcm_b2_shipping_idem_record('create_shipment', p_idempotency_key, v_id, v_snap);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) TO service_role;

-- ② admin_add_shipment_items
DROP FUNCTION public.admin_add_shipment_items(text, uuid, jsonb, text, text);

CREATE FUNCTION public.admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE v_msg text; v_state text; v_con text;
BEGIN
  RETURN public.pcm_b2_add_items_impl(p_idempotency_key, p_shipment_id, p_items);
EXCEPTION
  WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
    v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
    -- 🔴 不認得就原封拋回(W3-3 立的規矩:轉譯層不得吞掉它不認識的東西)
    IF v_msg IS NULL THEN RAISE; END IF;
    RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w4b_translated';
END
$function$;

REVOKE ALL ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb) TO service_role;

-- ③ admin_mark_shipment_shipped
DROP FUNCTION public.admin_mark_shipment_shipped(text, uuid, text, text, text);

CREATE FUNCTION public.admin_mark_shipment_shipped(p_idempotency_key text, p_shipment_id uuid, p_tracking_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_try    int := 0;
  v_replay jsonb;
  v_ship   record;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
  v_orders  integer;
  v_blocked text;
  v_dispatched timestamptz;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_shipment_shipped:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- 🔴 冪等認領在**任何業務寫入之前**,而且**在重試迴圈之外**(…w2….sql:343 合約逐字)。
  v_replay := public.pcm_b2_shipping_idem_claim(
    'ship', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('ship', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(🔴 **在迴圈外、只跑一次**)────────────────────
  -- 🔴 W7d-1 設計決策:重試迴圈**只包寫入、不包這一段**。
  --    ①迴避 B-295-STOP ⑦ 的前置提醒(replica 繞 FK ⇒ 孤兒列讓「重試一次就好」失效)——
  --      那條提醒的前提是「重試會重讀資料」,本設計**不重讀**。刻意迴避,不是忘記。
  --    ②寫入自帶守門(WHERE 含 deleted_at IS NULL AND shipped_at IS NULL)
  --      ⇒ 併發改態時是 0 列、走既有 rowcount 閘,不需要靠重讀保護。
  SELECT s.id, s.shipment_reference, s.carrier_code, s.shipped_at, s.deleted_at, s.hct_dispatched_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '出貨:包裹 % 已作廢,不能出貨。要出這批貨請開一張新的包裹。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_shipment_voided';
  END IF;
  IF v_ship.shipped_at IS NOT NULL THEN
    -- 🔴 這條走到的**只有異鍵**(同鍵同 payload 早在 claim 就轉重放了)⇒ 是「兩個人各按一次」的情境。
    RAISE EXCEPTION '出貨:包裹 % 已經寄出了(可能是別人剛按過)。不需要再出一次。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_already_shipped';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM public.shipment_items si WHERE si.shipment_id = p_shipment_id;
  IF v_n = 0 THEN
    -- 真正的守門是 S1b 的 X1 `shipments_items_presence`(AFTER constraint trigger);這裡是訊息層。
    RAISE EXCEPTION '出貨:包裹 % 裡還沒有任何品項,不能出貨。請先把要寄的品項加進來。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_no_items';
  END IF;
  -- 🔴 單號要求照 s1a1 的 `shipments_shipped_needs_tracking`:`other` 以外都要單號(這裡是訊息層)
  IF v_ship.carrier_code <> 'other' AND public.pcm_b2_is_blank(p_tracking_number) THEN
    RAISE EXCEPTION '出貨:快遞商是 % 時必須填貨運單號才能出貨。', v_ship.carrier_code
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_tracking_required';
  END IF;

  -- ── 出貨 + 轉譯(🔴 W7d-1:包在 40P01 有界重試裡)────────────
  LOOP
    v_try := v_try + 1;
    BEGIN
      -- 🔴 P0-1 §3.2:新竹回成功或管理者確認交貨(hct_dispatched_at 有值,write-once)= 貨已交出 ⇒ 標出貨是補記事實, 不套判準;
      --    資格證明在叫車 claim 當下已寫。其餘(沒走新竹、叫車沒送出 / 被拒 / 未知)⇒ 鎖序 shipments → orders 後判準, 通過才寫證明。
      --    鎖在子交易裡:40P01 回捲會放掉本圈的鎖與證明列, 下一圈同序重拿。
      -- 🔴 hct_dispatched_at 要【先鎖箱再讀】(codex 1b R1 should-fix):write-once 只保證讀到的非 NULL 不會變回 NULL,
      --    不保證 NULL 不會變成有值 —— 管理者確認交貨(持箱 FOR UPDATE)正在提交時, 鎖前讀到的舊 NULL 會把該放行的補記擋掉。
      SELECT s.hct_dispatched_at INTO v_dispatched
        FROM public.shipments s WHERE s.id = p_shipment_id
         FOR NO KEY UPDATE;
      IF v_dispatched IS NULL THEN
        SELECT b.order_count, b.blocked INTO v_orders, v_blocked
          FROM public.pcm_p01_lock_box_orders(p_shipment_id, NULL) b;
        IF v_blocked IS NOT NULL THEN
          RAISE EXCEPTION '出貨:包裹 % 裡有不能再出貨的訂單:%。已取消或刷卡已全額退款的單不能出貨, 請先作廢這一箱。', v_ship.shipment_reference, v_blocked
            USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_order_ship_blocked';
        END IF;
        PERFORM public.pcm_p01_write_clearances(p_shipment_id, 'mark_shipped');
      END IF;

      -- 🔴 **一次只動一箱**(交棒 10 的契約):`WHERE id = p_shipment_id` 是單列。
      --    這一句會觸發 S2b 的重算 trigger ⇒ C9 家族的 23514 就是在這裡冒出來的,
      --    而那發 trigger 會去鎖 order_items ⇒ **與掛品項路徑反向,這就是 40P01 的來源**。
      -- 🔴 **F6(跨模型審查):WHERE 只有 `id=` 會有作廢×出貨的 TOCTOU。**
      --    ⇒ 條件寫進 WHERE:輸了就是 0 列,直接走下面既有的 rowcount 閘。
      UPDATE public.shipments
         SET shipped_at = now(), tracking_number = p_tracking_number
       WHERE id = p_shipment_id
         AND deleted_at IS NULL
         AND shipped_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        -- 🔴 0 列的成因有二:①真的沒這箱 ②**併發**把它作廢或出貨了(F6 的 WHERE 條件輸掉)。
        RAISE EXCEPTION '出貨:這個包裹的狀態剛剛被別人改過(可能已被作廢或已出貨),這次沒有出貨成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        -- 🔴 觀察點:NOTICE 送出即不可撤回,子交易回滾吃不掉它 ⇒ 這是唯一量得到迭代數的東西。
        RAISE NOTICE 'W7D1-RETRY|%|%', 'ship', v_try;
        -- 🔴 零退避是刻意的(檔頭有完整理由)。**不要加 pg_sleep。**
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '出貨:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c3_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        -- 🔴 `P2B26`(上面 rowcount 那條)**不會**被這裡攔到:raise_exception = P0001,P2B26 是自訂碼。
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        -- 🔴 **不認得就原封拋回**,不得吞掉(見轉譯層 COMMENT)。
        IF v_msg IS NULL THEN RAISE; END IF;
        RAISE EXCEPTION '%', v_msg
          USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c3_translated';
    END;
  END LOOP;

  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('ship', p_idempotency_key, p_shipment_id, v_snap);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) TO service_role;

-- ④ admin_void_shipment
DROP FUNCTION public.admin_void_shipment(text, uuid, text, text, text);

CREATE FUNCTION public.admin_void_shipment(p_idempotency_key text, p_shipment_id uuid, p_void_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_try    int := 0;
  v_replay jsonb;
  v_ship   record;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'void', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('void', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'void_reason', p_void_reason)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(迴圈外、只跑一次;理由同 W3-3)──────────────
  -- 🔴 理由非空白是 `shipments_void_pair` 的一半(`…s1a1.sql:149-151`);這裡是訊息層。
  IF public.pcm_b2_is_blank(p_void_reason) THEN
    RAISE EXCEPTION '作廢包裹:一定要填作廢原因(這是要留給日後查帳看的)。'
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_reason_required';
  END IF;
  SELECT s.id, s.shipment_reference, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '作廢包裹:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    -- 🔴 **刻意不做成 no-op**(理由見 W3c-1 檔頭):第二次帶的是另一個理由,吞掉等於丟稽核資訊。
    RAISE EXCEPTION '作廢包裹:包裹 % 已經作廢過了(可能是別人剛作廢的)。不需要再作廢一次。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_already_voided';
  END IF;

  -- ── 作廢(這一句同時觸發 S2b 的退量重算)────────────────
  -- 🔴 `deleted_at` 與 `void_reason` **必須同時寫**(X7 是雙向配對)。
  -- 🔴 WHERE 帶上 `deleted_at IS NULL`(W3-3 的 F6 教訓:只有 `id=` 會有 TOCTOU)。
  LOOP
    v_try := v_try + 1;
    BEGIN
      UPDATE public.shipments
         SET deleted_at = now(), void_reason = p_void_reason
       WHERE id = p_shipment_id
         AND deleted_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '作廢包裹:這個包裹的狀態剛剛被別人改過(可能已經被作廢了),這次沒有作廢成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        RAISE NOTICE 'W7D1-RETRY|%|%', 'void', v_try;
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '作廢包裹:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c1_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c1_translated';
    END;
  END LOOP;

  -- 🔴 `to_jsonb` 同源(W3-1 立的構造性形狀,W3-2/W3-3 照抄,本片續抄)
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('void', p_idempotency_key, p_shipment_id, v_snap);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_void_shipment(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_shipment(text, uuid, text) TO service_role;

-- ⑤ admin_unvoid_shipment
DROP FUNCTION public.admin_unvoid_shipment(text, uuid, text, text);

CREATE FUNCTION public.admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_try    int := 0;
  v_replay jsonb;
  v_ship   record;
  v_bad    text;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
  v_orders  integer;
  v_blocked text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_unvoid_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'unvoid', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('unvoid', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(迴圈外、只跑一次)────────────────────────────
  SELECT s.id, s.shipment_reference, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '復原包裹:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NULL THEN
    RAISE EXCEPTION '復原包裹:包裹 % 本來就沒有作廢,不需要復原。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_not_voided';
  END IF;

  -- ── 🔴 **M4 順序前緣守門**(W3c-2 的核心)────────────────────
  --    🔴 `shipped_at IS NOT NULL` 是**正確性條件**:草稿箱的 shipment_items 數量非零
  --       但不進 SHIPPED-TRUTH ⇒ 少了這個條件會**誤擋安全的草稿復原**。不是省算。
  IF v_ship.shipped_at IS NOT NULL THEN
    SELECT pg_catalog.string_agg(
             '品項 ' || w.oi::text || ':這箱要回加 ' || w.qty::text || ' 件,'
             || '但現在到貨只有 ' || w.instock::text || ' 件、已經出掉 ' || w.shipped::text || ' 件'
             || '(還能放 ' || (w.instock - w.shipped)::text || ' 件)', E'\n' ORDER BY w.oi)
      INTO v_bad
      FROM (
        SELECT si.order_item_id AS oi,
               si.shipped_quantity AS qty,
               coalesce(q.instock_quantity, 0) AS instock,
               coalesce(q.shipped_quantity, 0) AS shipped
          FROM public.shipment_items si
          -- 🔴 惰性建列 ⇒ **LEFT JOIN + COALESCE**(`…s2b.sql:484` 立的讀取契約;W3-2 在這裡被打過)
          LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = si.order_item_id
         WHERE si.shipment_id = p_shipment_id
      ) w
     WHERE w.shipped + w.qty > w.instock;
    IF v_bad IS NOT NULL THEN
      -- 🔴 **交棒 2 的引導在這條路上是反過來的**:箱子已經是作廢狀態,叫人「先作廢」是廢話。
      RAISE EXCEPTION E'復原包裹:這箱復原之後,出貨數量會超過現在的到貨數量,所以不能復原。\n%\n'
                      '接下來可以這樣處理:①去採購頁把到貨數量改回正確的,再回來復原;'
                      '或 ②不要復原,改用「照這箱內容開一張新的包裹」**並把數量調整成放得下的**。', v_bad
        USING ERRCODE = 'P2B27', CONSTRAINT = 'pcm_b2_w3c2_unvoid_exceeds_instock';
    END IF;
  END IF;

  -- ── 復原(清空 deleted_at + void_reason;X7 是雙向配對,兩欄一起清)────
  -- 🔴 WHERE 帶上 `deleted_at IS NOT NULL`(W3-3 F6 的 TOCTOU 教訓,本線第三次用)。
  LOOP
    v_try := v_try + 1;
    BEGIN
      -- 🔴 P0-1 §3.1:箱裡有已取消或刷卡已全額退款的訂單 ⇒ 不准復原。鎖序 shipments → orders, 鎖在子交易裡(40P01 回捲會放掉)。
      SELECT b.order_count, b.blocked INTO v_orders, v_blocked
        FROM public.pcm_p01_lock_box_orders(p_shipment_id, NULL) b;
      IF v_blocked IS NOT NULL THEN
        RAISE EXCEPTION '復原包裹:包裹 % 裡有不能再出貨的訂單:%。已取消或刷卡已全額退款的單不能復原出貨, 請開一張新的包裹只裝還能出的品項。', v_ship.shipment_reference, v_blocked
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_order_ship_blocked';
      END IF;

      UPDATE public.shipments
         SET deleted_at = NULL, void_reason = NULL
       WHERE id = p_shipment_id
         AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '復原包裹:這個包裹的狀態剛剛被別人改過,這次沒有復原成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        RAISE NOTICE 'W7D1-RETRY|%|%', 'unvoid', v_try;
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '復原包裹:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c2_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
        -- 🔴🔴 **W7d-1(B-220-A MF-1):C9 的補救方向在復原這條路上是相反的。**
        --    共用轉譯層那兩句逐字說「①先作廢這個包裹」,但走到這裡時**那箱本來就是作廢態**
        --    (復原失敗 ⇒ deleted_at 沒被清掉)⇒ 照抄等於叫人去作廢一個已經作廢的箱子。
        --    ⇒ 補救知識屬於**呼叫端**:轉譯層說「哪裡壞了」,這裡說「接下來怎麼辦」。
        -- 🔴 可達性(誠實邊界):上面的 M4 前緣守門會先擋掉絕大多數 ⇒ **這裡只在 TOCTOU 窗內走得到**
        --    (前緣通過後、UPDATE 之前,併發改變了到貨或出貨量)。不是常態路徑,但錯字面就是錯字面。
        -- 🔴 與前緣那句**刻意不逐字相同**(逐字複製 = 第三份同義字面 = 本線的復發病),
        --    但指向同一組動作;兩處同族,改一處要想到另一處。
        -- 🔴 兩個 conname 的**補救動作不一樣**,不得共用一句(關卡2 must-fix):
        --    · `oiqs_shipped_le_instock`      = 出貨量 > 到貨量 ⇒ 要動的是**到貨數量**(採購頁)。
        --    · `oiqs_cancelled_shipped_le_quantity` = 取消+出貨 > 訂購量 ⇒ 這條**與到貨量無關**,
        --      叫人去採購頁改到貨數量照做也復原不了。要看的是**取消紀錄**。
        IF v_state = '23514' AND v_con = 'oiqs_shipped_le_instock' THEN
          v_msg := '復原包裹:這箱復原之後,出貨數量會超過到貨數量(剛剛數字被別人改過),所以不能復原。'
                || '請去採購頁確認到貨數量後再復原;或不要復原,改用「照這箱內容開一張新的包裹」並調整數量。'
                || '**不要**再去作廢它 —— 它現在就是作廢狀態。';
        ELSIF v_state = '23514' AND v_con = 'oiqs_cancelled_shipped_le_quantity' THEN
          v_msg := '復原包裹:這箱復原之後,「已取消 + 已出貨」會超過客人訂購的數量,所以不能復原。'
                || '請先確認這張訂單的取消紀錄(不是到貨數量);或不要復原,改用「照這箱內容開一張新的包裹」並調整數量。'
                || '**不要**再去作廢它 —— 它現在就是作廢狀態。';
        END IF;
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c2_translated';
    END;
  END LOOP;

  -- 🔴 `to_jsonb` 同源(W3-1 立的構造性形狀,本線第五次照抄)
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('unvoid', p_idempotency_key, p_shipment_id, v_snap);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_unvoid_shipment(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unvoid_shipment(text, uuid) TO service_role;

-- 後置閘:五支舊簽章回來了、新簽章不見了、權限與 search_path 還原
DO $post$
DECLARE
  v_sig text;
  v_old constant text[] := ARRAY[
    'public.admin_create_shipment(text,uuid,jsonb,text,text)',
    'public.admin_add_shipment_items(text,uuid,jsonb)',
    'public.admin_mark_shipment_shipped(text,uuid,text)',
    'public.admin_void_shipment(text,uuid,text)',
    'public.admin_unvoid_shipment(text,uuid)'
  ];
  v_new constant text[] := ARRAY[
    'public.admin_create_shipment(text,uuid,jsonb,text,text,text,text)',
    'public.admin_add_shipment_items(text,uuid,jsonb,text,text)',
    'public.admin_mark_shipment_shipped(text,uuid,text,text,text)',
    'public.admin_void_shipment(text,uuid,text,text,text)',
    'public.admin_unvoid_shipment(text,uuid,text,text)'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_old LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION '退回後置閘①:% 沒回來', v_sig;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) THEN
      RAISE EXCEPTION '退回後置閘②:% 不是 SECURITY DEFINER', v_sig;
    END IF;
    -- 🔵 字面是 `search_path=""`(帶兩個引號),不是 `search_path=`(2026-09-16 實測)
    IF NOT ((SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig))
            @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '退回後置閘③:% 的 search_path 不是空字串', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(v_sig), 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(v_sig), 'EXECUTE') THEN
      RAISE EXCEPTION '退回後置閘④:% 對 anon / authenticated 開著 EXECUTE', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(v_sig), 'EXECUTE') THEN
      RAISE EXCEPTION '退回後置閘⑤:% 的 service_role 沒有 EXECUTE', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_new LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NOT NULL THEN
      RAISE EXCEPTION '退回後置閘⑥:新簽章 % 還在 ⇒ 沒退乾淨', v_sig;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
