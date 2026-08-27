-- ============================================================
-- M-4b E10 第 2 批 B2 · W3c-1:`admin_void_shipment`(作廢)
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2)§2 W3c 列 / §1e M4。
-- 開工令 = 主視窗 `B-199-A` ⑤。上游 = W0b/W1/W2 + W3-1/W3-2/W3-3(含共用轉譯層)。
-- 驗收 harness = `scripts/w3c1-verify.sh`。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` 不吃 `.sql`。證據只有 harness 實跑。
--
-- ══ 🔴 **W3c 當場再拆**(鐵則 4;plan §7 **N3** 逐字預告「W3c 也是同型低估」)═══
--   plan 的 W3c 列 = 作廢 + unvoid **兩個 writer** + M4 的順序前緣守門 + 引導訊息。
--   兩支的性質差很遠:
--     · **作廢**(本片)= 直白的狀態轉換 + 退量,難點在「什麼時候不准作廢」。
--     · **unvoid**(W3c-2)= 扛著**整個 M4**:作廢退量 → 採購改量下修 `instock` → unvoid 回加
--       ⇒ `shipped > instock` 撞 C9。那條要前緣守門 + 引導訊息,是本線最後一個未設計的併發面。
--   ⇒ **拆兩片,本片是第一片**。🔴 **縮片界、不縮範圍**:W3c-2 的內容一項未減,STOP 逐項列。
--
-- ══ 🔴 作廢的資料形狀(實查,不是我記得的)═════════════════════
--   `shipments_void_pair`(`…s1a1.sql:149-151`)逐字:`(deleted_at IS NULL) = (void_reason IS NULL)`
--   **且** `void_reason` 非純空白 ⇒ **作廢與理由是雙向配對**:兩個一起設、一起清。
--   ⇒ 本片的 UPDATE 一定同時寫兩欄;unvoid(W3c-2)一定同時清兩欄。
--
-- ══ 🔴 作廢會做兩件事,第二件是**自動的、我沒寫任何一行**═══════
--   ① `deleted_at` / `void_reason` 落到 `shipments`
--   ② **退量**:`shipments AFTER UPDATE OF shipped_at, deleted_at` 的重算 trigger
--      (`…s2b:362`)會把這箱的品項重算 —— 而 SHIPPED-TRUTH 只認 `shipped_at IS NOT NULL AND deleted_at IS NULL`
--      (`…s2b:288-293`)⇒ 作廢之後這箱**不再算已出貨**,數量自動退回。
--   🔴 **這是 Sean 08-05 Q3=A 拍板的「作廢退量」的實作處** —— 它不在本片的程式碼裡,
--      在 S2b 的重算裡。**本片不得宣稱自己實作了退量**;本片做的是「觸發它」。
--      harness 有格量退量真的發生(不是量我寫了什麼)。
--
-- ══ 🔴 什麼時候**不准**作廢 ═══════════════════════════════════
--   · 已作廢 ⇒ 人話(不是 no-op —— 見下)
--   · 找不到 ⇒ 人話
--   🔴 **已出貨的箱<u>可以</u>作廢** —— 這是刻意的,不是漏掉:
--      `…s1a2.sql:170` 逐字「**撤銷出貨的唯一路徑 = deleted_at 作廢**(留 void_reason 稽核)」,
--      而 X2 的 write-once 讓 `shipped_at` 永遠清不掉。⇒ 出貨後發現裝錯,唯一補救就是作廢。
--      **擋掉它等於把唯一的補救路砍了。**
--
-- ══ 🔴 「已作廢再作廢」為什麼**不做成 no-op**(本片拍板)═══════
--   狀態收斂式的 no-op(「反正結果一樣」)在這裡是錯的:第二次作廢帶的是**另一個理由**,
--   靜默吞掉等於**丟掉稽核資訊**,而作廢理由正是 Q3=A 要留的東西。
--   ⇒ 一律人話拒絕,由員工決定要不要改理由(改理由是另一個動作,本線沒有它 ⇒ W3c-2 的 STOP 列為問題)。
--   🔴 **同鍵重放不受影響**:那條在 claim 就轉重放了,走不到這裡。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_human_error(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'W3c-1 前置閘失敗 — W3-3 的轉譯層或 W2 的冪等層不在。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_void_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_void_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
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

  -- ── 前緣人話 ────────────────────────────────────────────
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
    -- 🔴 **刻意不做成 no-op**(理由見檔頭):第二次帶的是另一個理由,吞掉等於丟稽核資訊。
    RAISE EXCEPTION '作廢包裹:包裹 % 已經作廢過了(可能是別人剛作廢的)。不需要再作廢一次。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_already_voided';
  END IF;

  -- ── 作廢(這一句同時觸發 S2b 的退量重算)────────────────
  -- 🔴 `deleted_at` 與 `void_reason` **必須同時寫**(X7 是雙向配對)。
  -- 🔴 WHERE 帶上 `deleted_at IS NULL`(W3-3 的 F6 教訓:只有 `id=` 會有 TOCTOU)。
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
  EXCEPTION
    WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
      IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c1_translated';
  END;

  -- 🔴 `to_jsonb` 同源(W3-1 立的構造性形狀,W3-2/W3-3 照抄,本片續抄)
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('void', p_idempotency_key, p_shipment_id, v_snap);
END
$fn$;

COMMENT ON FUNCTION public.admin_void_shipment(text, uuid, text) IS
  'B2 作廢 writer(W3c-1)。前緣人話 → 單列 UPDATE(deleted_at + void_reason 同時寫)→ 轉譯 → 同交易回填。'
  '🔴 **退量不在本函式裡** —— 它由 S2b 的 shipments AFTER UPDATE OF deleted_at 重算完成'
  '(SHIPPED-TRUTH 只認 shipped_at IS NOT NULL AND deleted_at IS NULL)。本片做的是觸發它。'
  '🔴 **已出貨的箱可以作廢**:s1a2:170 逐字「撤銷出貨的唯一路徑 = 作廢」,擋掉等於砍了唯一補救路。'
  '🔴 「已作廢再作廢」刻意**不做成 no-op**:第二次帶的是另一個理由,吞掉等於丟稽核資訊。';

-- ── 檔內 fail-closed 斷言 ────────────────────────────────────
DO $$
DECLARE v_n bigint; v_bad text := '';
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_shipment';
  IF v_n <> 1 THEN v_bad := v_bad || 'signature 數 = ' || v_n || '(期望 1)'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_void_shipment(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_void_shipment(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_void_shipment(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticator', 'public.admin_void_shipment(text,uuid,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'ACL 漂了 ';
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'W3c-1 斷言失敗:%', v_bad USING ERRCODE = 'P2B20'; END IF;
  RAISE NOTICE 'W3c-1 斷言通過:作廢單一 signature + ACL 未漂';
END
$$;

COMMIT;
