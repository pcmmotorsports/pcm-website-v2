-- 20260904220000 · M-4b ⟦5b-TRACKNUMGAP1⟧ 片 C-①:email_outbox 加第五個事件型別。
--
-- 🛑🛑 **草稿。未 commit、未 apply。**
-- 🔴 **它自己是惰性的** —— 沒有掃描器就不會有這個型別的列。
--    而**單獨落地沒有意義**:掃描器與模板不在 dev 之前, 這個值一列都不會被用到,
--    卻會佔掉 Sean 貼板佇列一個位子。⇒ **三件一起落。**
--
-- 🔴🔴 **而「一起落」不是我的判斷, 是 repo 的既有規矩**:
--    `packages/use-cases/src/enqueue-order-shipped-emails.ts:8-12` 逐字 ——
--    「掛上去的話, 列會排進佇列、每 5 分鐘被認領一次、每次 throw、燒掉 attempts 進死信,
--     **然後每天發告警**。**模板與掛 route 必須是同一片。**」
--
-- 📎 形狀逐格抄 `20260903040000`(`_v3`)與 `20260902120000`(`_v2`)—— 本支是 `_v4`。
--    🔴 **不用 `DROP` 再 `ADD`**:那會在驗證期間鎖表;先例走的是
--    `ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME`。

BEGIN;

DO $$
DECLARE
  v_def    text;
  v_others text;
BEGIN
  -- 前置閘①:那條 CHECK 要在(否則下面炸的訊息不會告訴你現況是什麼)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_event_type_check ⇒ 部署態與預期不符,停下人工確認';
  END IF;

  -- 前置閘②:forward-only —— 已經有第五個值就拒絕重跑
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') > 0 THEN
    RAISE EXCEPTION '前置閘②:shipment_tracking_corrected 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前四個值都要在 —— 本片是【加一個】, 不是【重寫白名單】。
  --   少了任何一個 ⇒ 現況不是我以為的那一版 ⇒ 我這支的 IN(...) 會把它悄悄刪掉。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的四值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
  END IF;

  -- 前置閘④:這一欄上不該掛著別的 CHECK / FK(含 whole-row 寫法)
  --   ⚠️ 刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中(形狀抄 20260903040000 前置閘④)。
  SELECT string_agg(c.conname, ', ') INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.contype IN ('c', 'f')
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:event_type 這一欄上還掛著別的 CHECK 或 FOREIGN KEY(%)⇒ 放寬了也可能被它擋', v_others;
  END IF;
END
$$;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v4
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v4;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v4 TO email_outbox_event_type_check;

COMMENT ON COLUMN public.email_outbox.event_type IS
  '事件型別(CHECK 白名單;**新增事件 = 新 migration**)。5 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的取消)/
order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)/
🔴 shipment_tracking_corrected(2026-09-04 新增:已出貨的箱【更正貨運單號】之後的更正信。
   Sean 2026-09-04 逐字「甲 = 做, 改完自動再寄一封對的信給客人」)。
🔴 **dedup_key = 箱 + 單號** ⇒ 同一個單號值只寄一次;連改兩次(A→B→C)只寄到 C ——
   拍板理由逐字:**客人要的是「哪一個號碼是對的」, 不是「你改過幾次」。**';

DO $$
DECLARE v_def text;
BEGIN
  -- 事後閘①:改名之後找得到
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名後找不到 email_outbox_event_type_check';
  END IF;
  -- 事後閘②:新值在
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '事後閘②:新值不在 ⇒ 這一支沒有做到它宣稱的事';
  END IF;
  -- 🔴 事後閘③:**舊的四個一個都沒少** —— 一個把清單換掉的世界會通過事後閘②。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '事後閘③:舊的事件型別不見了(實得 %)⇒ 我把白名單換掉了, 不是加一個', v_def;
  END IF;
END
$$;

-- ══════════════════════════════════════════════════════════════════
-- ⟦5b-TRACKNUMGAP1⟧ 片 C-② · 掃描器要的那個訊號
-- ══════════════════════════════════════════════════════════════════
--
-- 🔴🔴 **為什麼需要一個新欄位 —— 而不是去翻稽核表**(主視窗 2026-09-04 拍【乙+】):
--    掃描器要算的差集是「這個單號**還沒寄過更正信**」, 而它必須先排除
--    **第一次出貨那個號碼**(否則客人剛出貨就收到一封「先前那個有誤」, 而他沒收過錯的)。
--    ⇒ 我需要知道「出貨信當初寄的是哪個號碼」——
--    🛑 **而 `OrderShippedEmailPayload` 【刻意】不存追蹤碼**(該型別註解逐字:
--       「追蹤碼不行, 存了會過期」)⇒ 📌 **一個當初正確的設計決定, 讓這個差集算不出來。**
--    ⇒ ⛔ 而「去翻 `admin_audit_log`」被否決了:那張表的存在理由是**證據**不是**狀態**;
--       哪天有人清稽核、或改了 action 字面, 這條掃描會**安靜地停止產出**。
--    ✅ ⇒ 給它一個**自己的欄位**。

-- ── 前置閘:live 的那支 RPC 必須是【第一代】(不是「不存在」)────────────
-- 🔴 `20260904190000` **Sean 2026-09-04 夜已貼、線上活著**(本窗唯讀實測:
--    `pg_get_function_arguments` ⇒ 「p_idempotency_key text, p_shipment_id uuid,
--     p_tracking_number text, p_actor text, p_request_id text」逐字相符)。
--    ⇒ 📌 **所以這裡驗的是「它在、而且還沒被我改成第二代」, 不是「它不存在」。**
DO $$
DECLARE v_src text; v_args text;
BEGIN
  SELECT p.prosrc, pg_get_function_arguments(p.oid) INTO v_src, v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_update_shipment_tracking';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘⑤:admin_update_shipment_tracking 不在 ⇒ 20260904190000 還沒貼, 先貼那一支';
  END IF;
  IF v_args <> 'p_idempotency_key text, p_shipment_id uuid, p_tracking_number text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION '前置閘⑥:live 那支的簽章不是我預期的那一版(實得 %)⇒ 停下人工確認', v_args;
  END IF;
  -- 🔴 forward-only:第二代自己會寫 tracking_corrected_at ⇒ 它出現在 prosrc 裡就代表跑過了。
  IF pg_catalog.strpos(v_src, 'tracking_corrected_at') > 0 THEN
    RAISE EXCEPTION '前置閘⑦:live 已經是第二代(prosrc 含 tracking_corrected_at)⇒ forward-only, 拒重跑';
  END IF;
END
$$;

-- ── 1. 加欄 ───────────────────────────────────────────────────────
-- 🔵 **只由 RPC 寫** —— 表級 REVOKE 照舊(新欄繼承表的 ACL, 不另開授權)。
-- 🔴 而它**不在 X8 的凍結清單裡**, 那是刻意的:凍結清單擋的是「出貨後不准改的欄」,
--    而這一欄的語意就是「出貨後被改過」⇒ 它必須改得動。
ALTER TABLE public.shipments ADD COLUMN tracking_corrected_at timestamptz;

COMMENT ON COLUMN public.shipments.tracking_corrected_at IS
  '⟦5b-TRACKNUMGAP1⟧ 片 C:這一箱的貨運單號【被更正過】的最後時點(NULL = 從來沒被更正過)。
🔴 **只由 admin_update_shipment_tracking 寫**, 而它存在的唯一理由是讓更正信的掃描器
分得出「這個號碼是第一次出貨那個」與「這個號碼是後來改的」——
而那個分辨【不能】從 email_outbox 算出來:order_shipped 的 payload 刻意不存追蹤碼
(理由逐字「追蹤碼不行, 存了會過期」)。
🛑 **它不是稽核** —— 每一次更正的 before/after 在 admin_audit_log;本欄只回答「有沒有被改過」。';

-- ── 2. RPC 第二代:順手寫那一欄 ───────────────────────────────────
-- 🔴 **整段重寫、屬性一個都不省**(SECURITY DEFINER / search_path / lock_timeout /
--    兩道 REVOKE / OWNER)—— `CREATE OR REPLACE` **不繼承**你沒寫的那些。
CREATE OR REPLACE FUNCTION public.admin_update_shipment_tracking(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_tracking_number text,
  p_actor           text,
  p_request_id      text
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
  v_rows   bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_update_shipment_tracking:需在 READ COMMITTED 下執行(現為 %)',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'trackfix', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('trackfix', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT s.id, s.shipment_reference, s.carrier_code, s.tracking_number, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '更正單號:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '更正單號:包裹 % 已作廢,它的單號不會再被任何人看到,不需要更正。',
      v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_shipment_voided';
  END IF;
  IF v_ship.shipped_at IS NULL THEN
    RAISE EXCEPTION '更正單號:包裹 % 還沒出貨。單號請在按「出貨」的那一步填,不必走更正。',
      v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_not_shipped_yet';
  END IF;
  IF v_ship.carrier_code <> 'other' AND public.pcm_b2_is_blank(p_tracking_number) THEN
    RAISE EXCEPTION '更正單號:快遞商是 % 時不能把單號清空。要改成沒有單號請作廢這一箱。',
      v_ship.carrier_code
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_blank_not_allowed';
  END IF;

  IF v_ship.tracking_number IS NOT DISTINCT FROM p_tracking_number THEN
    RETURN public.pcm_b2_shipping_idem_record('trackfix', p_idempotency_key, p_shipment_id,
      pg_catalog.jsonb_build_object(
        'shipment_id', p_shipment_id,
        'shipment_reference', v_ship.shipment_reference,
        'changed', false));
  END IF;

  -- 🔴 **第二代唯一的行為差異:順手蓋上 `tracking_corrected_at`。**
  --    它與 `tracking_number` **在同一發 UPDATE 裡** ⇒ 兩者不可能分岔
  --    (分兩步的話, 中間掛掉會留下「號碼改了而沒有人知道它被改過」)。
  UPDATE public.shipments
     SET tracking_number = p_tracking_number,
         -- 🔴 `clock_timestamp()` 不是 `now()`:`now()` 是**交易開始時刻**
         --    ⇒ 同一個交易裡連改兩次會拿到**同一個時點** ⇒ 兩次的 dedup_key 相同
         --    ⇒ 第二封安靜地不寄。而 dedup_key 現在就是用這個時點組的。
         tracking_corrected_at = pg_catalog.clock_timestamp()
   WHERE id = p_shipment_id
     AND deleted_at IS NULL
     AND shipped_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_shipment_tracking:更新列數異常(%)', v_rows
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_rowcount';
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'shipment.tracking.update',
    'shipment:' || p_shipment_id::text,
    pg_catalog.jsonb_build_object('tracking_number', v_ship.tracking_number),
    pg_catalog.jsonb_build_object('tracking_number', p_tracking_number),
    p_request_id,
    'admin'
  );

  RETURN public.pcm_b2_shipping_idem_record('trackfix', p_idempotency_key, p_shipment_id,
    pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'shipment_reference', v_ship.shipment_reference,
      'changed', true));
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text)
  TO service_role;
ALTER FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text) OWNER TO postgres;

-- ══════════════════════════════════════════════════════════════════
-- ⟦5b-TRACKNUMGAP1⟧ 片 C-③ · 掃描面(一個 view + 一支 dedup 函式, 零寫入)
-- ══════════════════════════════════════════════════════════════════
--
-- 🔵 形狀整支照 `20260822010000`(order_shipped 那條)—— **刻意照抄結構**:
--    同一套差集、同一套 `security_invoker`、同一套兩道 REVOKE、同一套字面釘樁。
--    ⇒ 下一個人只要讀懂那一支, 就讀得懂這一支。

-- ── dedup_key 產生器(SQL 側單一事實來源)──────────────────────────
-- 🔴 **兩份實作**:這裡一份、`SupabaseEmailOutboxAdapter` 的 `composeEvent` 一份。
--    兩份漂掉的症狀**不是報錯, 是同一封信寄兩次** —— 而三綠不會紅。
-- 🔴 **而它與 order_shipped 那支【故意不同形】**:那支是 `箱:單`, 這支是 `箱:單:更正時點`。
--    🎯 **理由是【每一次更正都該是一封新的信】** —— 把「哪一次更正」放進鍵裡,
--      這件事就由唯一鍵保證, 不必有人記得。
--    ⛔ **舊字面留痕:本檔在同一夜換過兩次鍵。**
--      ~~`箱:號碼`~~ ⇒ codex R1 抓到它擋不住**改回一個用過的號碼**(A→B、B→C、再改回 B);
--      ~~`箱:更正時點`~~ ⇒ codex R2 抓到它擋不住**一箱多單**(同箱兩張單算出同一把鑰匙,
--      第二張那封 `enqueue` 回 `duplicate` ⇒ 安靜地不寄)。
--    📌 **兩次都是「這把鑰匙的單位比它該有的粗一級」** —— 而兩次的症狀都是**少寄一封, 零訊號**。
-- 🔴🔴 **把一個更正【時點】算成一個固定寬度、零歧義的字串。**
--    ⇒ 這一支存在的唯一理由是:**這個字串在 SQL 與 TS 兩邊必須逐位元相同**,
--      而**兩邊各自把時間格式化一次**是最容易漂的做法(時區、小數位、`T` 與空白、偏移寫法)。
--    ✅ **解法:只有 SQL 格式化。** view 把這個字串當成**一個欄位**回給 TS,
--      TS 只負責在前面接上箱 id —— 它從來不碰時間。
--    🔵 `YYYYMMDDHH24MISSUS` = 20 個數字、UTC、到微秒。沒有分隔符 ⇒ 沒有東西可以漂。
CREATE FUNCTION public.pcm_tracking_corrected_at_key(p_corrected_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.to_char(p_corrected_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');
$$;

-- 🔴🔴 **鍵含 `order_id`, 而那是 codex R2 抓的**(must-fix #2):
--    一箱**可以裝多張訂單**(`shipments` 刻意沒有 order_id), 而出貨信那條的拍板是
--    **一箱兩單就寄兩封, 一封講一張訂單**(Sean 2026-08-17)。
--    ⇒ 🛑 少了 order_id, 同一箱的兩張單會算出**同一把鑰匙** ⇒ 第二張單那封**安靜地不寄**
--      (`enqueue` 回 `duplicate`, 不報錯)。⇒ 那個客人有一張訂單永遠拿著錯號碼。
--    📌 而**今天實測「裝了超過一張單的箱 = 0」** ⇒ 這條路**沒有真實流量會走到**
--      ⇒ 它壞掉時不會有人發現。**所以它必須在鍵的形狀上就對, 不能靠流量去驗。**
CREATE FUNCTION public.pcm_tracking_corrected_dedup_key(
  p_shipment_id  uuid,
  p_order_id     uuid,
  p_corrected_at timestamptz
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_shipment_id::text || ':' || p_order_id::text || ':'
      || public.pcm_tracking_corrected_at_key(p_corrected_at);
$$;

COMMENT ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) IS
  'shipment_tracking_corrected 的 email_outbox.dedup_key。形狀 = 箱 id : 訂單 id : 更正時點的 20 位數字串。
🔴 主視窗 2026-09-04 拍【Q1 甲】:鍵用【時點】不用【號碼】。
⛔ 舊字面留痕:原本是「箱 id 接冒號接單號」, 而 codex 對抗審查抓到它的漏 ——
   A 改成 B(寄過)、B 改成 C(寄過)、再【改回 B】⇒ 舊的 B 鍵還在 ⇒ 最新那封永遠不寄,
   而客人手上那封說的是 C。原拍板的理由「客人要的是哪一個號碼是對的」在 A→B→C 完全成立,
   它沒涵蓋【改回去】。
🔵 連改多次不會變成一串信:寄送當下有一道閘比對即時值, 不符的落 skipped 並退休鍵
   (packages/use-cases/src/sweep-email-outbox.ts 的 markSkippedTrackingSuperseded)。
🔴 TS 側 SupabaseEmailOutboxAdapter.composeEvent 有第二份實作 —— 兩份漂掉會【重複寄信】不是報錯;
   而 TS 那份【不碰時間】, 它拿 view 回的 corrected_at_key 直接接。跨層對帳在
   packages/adapters/src/email/tracking-corrected-dedup-contract.test.ts。';

REVOKE ALL ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) TO service_role;

-- ── 字面釘樁(apply 期就紅, 不等到有人寄錯信)───────────────────
DO $$
DECLARE v text;
BEGIN
  v := public.pcm_tracking_corrected_dedup_key(
         '00000000-0000-0000-0000-0000000000ab'::uuid,
         '00000000-0000-0000-0000-0000000000cd'::uuid,
         '2026-09-04T10:11:12.131415Z'::timestamptz);
  IF v <> '00000000-0000-0000-0000-0000000000ab:00000000-0000-0000-0000-0000000000cd:20260904101112131415' THEN
    RAISE EXCEPTION 'dedup_key 字面漂了(實得 %)⇒ TS 那一份會與它不一致 ⇒ 重複寄信', v;
  END IF;
END
$$;

-- ── 掃描 view ────────────────────────────────────────────────────
CREATE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                    AS shipment_id,
  s.shipment_reference    AS shipment_reference,
  s.tracking_number       AS tracking_number,
  s.carrier_code          AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  -- 🔴 **TS 拿這一欄去組 dedup_key, 它自己不格式化任何時間。** 見上面那支函式的說明。
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                    AS order_id,
  o.display_id            AS display_id,
  o.notification_email    AS notification_email,
  c.email                 AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  -- 🔴 這一格就是「這個號碼不是第一次出貨那個」。
  AND s.tracking_corrected_at IS NOT NULL
  -- 🔴🔴 **空白定義走 `pcm_js_trim_whitespace()` 單一來源, 不用預設的 `btrim`**
  --    (codex 2026-09-04 must-fix #1)。⛔ 我第一版寫裸 `btrim(x)` —— 它**只吃空格**,
  --    而本片的計數面(`20260904280000`)用的是 `btrim(x, JS_WS)`(含 tab / 換行)
  --    ⇒ 🛑 **一個只有 tab 的信箱:view 判「有收件人」而計數判「沒有」⇒ 【兩邊都算到它】。**
  --    ⇒ 📌 那兩支宣稱是**互補集**, 而互補集的定義若在兩邊各寫一份, 它們遲早不互補。
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴🔴 **這一句是本 view 最重要的一格 —— 而它不在任何人的驗收條件裡, 是我加的。**
  --    這封信的內容是「**先前**通知您的單號有誤」⇒ 🎯 **它的前提是客人【真的收過】那個錯號碼。**
  --    🛑 而有兩個世界會讓那個前提不成立, 兩個都是**真實會發生**的:
  --      ① **出貨信被 cutoff 擋掉 / 永久 failed** ⇒ 客人一個號碼都沒收過
  --      ② **出貨信還排在佇列裡(pending)時號碼就被改了** ⇒ 送信當下讀的是【live】追蹤碼
  --         (`OrderShippedEmailPayload` 刻意不存號碼)⇒ 那封出貨信本身帶的就是**改過的號碼**
  --         ⇒ 客人收到「您的單號是 B」, 而下一封告訴他「先前那個有誤, 是 B」。
  --    ⇒ ✅ 所以判準不是「出貨信寄了沒」, 是 **「出貨信在【更正之前】就寄出去了」**。
  --      `sent_at < tracking_corrected_at` 這一個比較同時擋掉上面兩個世界。
  --    ⚠️ **它答不出的**:同一箱被更正**兩次**, 而 `tracking_corrected_at` 只留最後一次
  --      ⇒ 兩次之間的時序分不出來。今天不會錯(鍵含號碼 ⇒ 每次更正各一封),
  --      而**若哪天要按次數對帳, 這一欄不夠** —— 那時要去 admin_audit_log。
  AND EXISTS (
        SELECT 1
          FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status     = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at
      )
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
      );

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
  '「已出貨、未作廢、單號被更正過、而且客人【真的收過那個錯號碼】、還沒排過更正信」的 (箱, 單) 配對。一列 = 一封信。
🔴 最重要的一格是 sent_at 早於 tracking_corrected_at 那個 EXISTS ——
這封信說的是「先前通知您的單號有誤」, 而它的前提是客人真的收過。
出貨信被 cutoff 擋掉、或還在 pending 時號碼就被改了(送信當下讀 live 追蹤碼)⇒ 兩種都不該寄。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它不自帶 cutoff —— 呼叫端要不要加起始線由呼叫端決定;而上面那道 EXISTS 已經
把「功能上線第一秒集合等於歷史全部」那個病擋掉了(歷史上的箱沒有 tracking_corrected_at)。
🔴 部署順序:模板與 enqueue 接線必須同一次 deploy —— 差集不分 status, 一列 failed 就永久排除那個 (箱,號碼)。';

REVOKE ALL ON public.pcm_tracking_corrected_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_tracking_corrected_email_pending TO service_role;

-- ── 🔴🔴 view 的【兩個判斷】字面釘樁 —— 而它們是 TS 那一側【碰不到】的半邊 ──
--    這兩個條件決定「哪些箱該收到更正信」, 而它們**只存在於 SQL**:
--      ① `tracking_corrected_at IS NOT NULL` = 這個號碼不是第一次出貨那個
--      ② `sent_at < tracking_corrected_at`   = 客人【真的收過】那個錯號碼
--    🛑 **刪掉任一條, 三綠全綠、TS 每一格測試照樣通過** —— 因為 TS 拿到的是 view 已經篩過的列
--      ⇒ 假 scanner 餵幾列就是幾列, 它結構上量不到「哪些列不該進來」。
--    ⇒ ✅ 所以釘樁放在**它們住的那一層**:apply 當下讀 `pg_get_viewdef` 回核。
--    ⚠️ **射程 —— 三件它證不到的事(codex R2 must-fix #6 逼我寫清楚)**:
--      ① 它證的是**那個字面在 view 定義裡**, **不證**那個條件在真資料上篩對了。
--      ② 它用 `strpos` 找字面 ⇒ 有人在條件後面加 `OR TRUE`、或把那串字挪到一個
--        **不影響篩選的位置**(例如某個 COMMENT 或無效的子句), 它照樣過。
--        ⇒ 📌 **它防的是【漂移】不是【對手】** —— 那個分界要寫出來, 否則下一個人會把它當成後者。
--      ③ 🔴 **它只在【本檔 apply 的那一刻】成立。** 之後任何一支 migration 重建這個 view,
--        本釘樁**完全不會知道** ⇒ 那條保護就沒了, 而**沒有東西會叫**。
--        ⇒ 要接住那個世界得在**重建 view 的那一支**再釘一次, 或改成一道排程檢查。**今天兩者都沒有。**
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'tracking_corrected_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '釘樁①:view 裡找不到「tracking_corrected_at IS NOT NULL」⇒ 沒改過號碼的箱會收到更正信';
  END IF;
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '釘樁②:view 裡找不到「sent_at < s.tracking_corrected_at」⇒ 沒收過錯號碼的客人會收到一封「先前那個有誤」';
  END IF;
  -- 🟢 正對照:這把尺在【該找到東西】時真的找得到(否則上面兩格恆綠)。
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面兩格的通過不算數';
  END IF;
END
$$;

-- ── 事後閘 ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:anon 讀得到那個含 email 的 view'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:authenticated 讀得到那個含 email 的 view'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘(正對照):service_role 讀不到 ⇒ 掃描器會拿到空集合而它長得像沒有信要寄'; END IF;
END
$$;

-- ── 新物件收權斷言(整段照抄 `20260817070000` 的標準區塊, 只換兩個清單)──
-- 🔴 它防的是「忘記收權」, **不防「忘記列」** —— 而`scripts/migration-static-checks.sh` 第③格
--    就是補那一半的:它數本檔建了幾個可授權物件, 與下面清單的長度對一次。
--    📌 而本檔第一版**真的漏了**(閘印「可授權物件 2 個, 斷言清單列了 0 個」)⇒ 那道閘不是裝飾。
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.pcm_tracking_corrected_email_pending'
  ]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_tracking_corrected_at_key(timestamptz)',
    'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'
  ]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

COMMIT;
