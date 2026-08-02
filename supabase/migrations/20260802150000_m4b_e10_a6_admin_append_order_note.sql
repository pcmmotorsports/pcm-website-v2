-- ============================================================
-- M-4b E10 A6:訂單備註寫入 RPC(`public.admin_append_order_note`)
-- ============================================================
-- 片級 plan = docs/specs/2026-08-02-e10-notes-line-plan.md **v4**(關卡1 四輪收斂:
--   codex R1 35 + R2 折入稽核+23 + Fable R3 10 + R4 確認輪 GO;獨立條目 68 全折、駁回 0)。
-- 前置:20260729030000(A3 `order_notes` 表;service_role 只有 SELECT ⇒ 寫入路徑到本片才存在)
--       20260712210000(admin_audit_log;service_role 只有 INSERT)。
-- 形狀樣板 = 20260801160000 admin_upsert_supplier。
--
-- 🔴 為什麼是 owner RPC:A3 對 service_role 只開 SELECT。開 INSERT 就能繞過同交易稽核
--    ⇒ 寫入唯一路 = 本 RPC(Sean 2026-08-02 Q1=A:同交易寫 admin_audit_log)。
--
-- 唯一動作 = 單列 INSERT(append-only 的 writer 面):
--   不做 UPDATE / DELETE;更正 = 再 append 一筆帶 p_corrects_note_id 的新列(A3 更正鏈)。
--
-- 回傳固定碼 14 碼(呼叫端 A9d2-1 必須斷言 ∈ 全集,未知碼 = 呼叫端 bug):
--   'APPENDED' / 'ORDER_NOT_FOUND' / 'INVALID_INPUT' / 'INVALID_TYPE' / 'INVALID_CHANNEL' /
--   'CONTACT_FIELDS_REQUIRED' / 'INTERNAL_FIELDS_FORBIDDEN' / 'OCCURRED_AT_OUT_OF_RANGE' /
--   'OCCURRED_AT_IN_FUTURE' / 'INVALID_BODY' / 'BODY_TOO_LONG' / 'DUPLICATE_REQUEST' /
--   'CORRECTS_NOT_FOUND' / 'ALREADY_CORRECTED'
--   🔴 `DUPLICATE_REQUEST` 是 14 碼中唯一「操作其實已成功」的碼(同 request_id 已寫入過)
--      ⇒ A9d2-1 必須**按成功處理**(PRG 導向同一結果頁);顯示成錯誤會誘發員工換 request_id
--      重送 = 冪等設計反而製造重複備註(plan v4 F3)。
--
-- 🔴 檢查順序(plan §4.2,先命中先回傳;順序是驗收對象,harness C 區逐對突變):
--   1 actor/request_id(RAISE 面:剝空白→非空→≤200→零控制字元→actor slug regex)
--   2 order_id NULL → 3 note_type → 4 channel → 5 配對 → 6 occurred 界外 → 7 occurred 未來
--   8 body 空(正規化後) → 9 body 過長 → 10 鎖單 FOR UPDATE + 存在性 → 11 重複 request
--   12 corrects(①同單查無 ②已被更正) → 13 單列 INSERT + 同交易稽核
--   🔴 步 11 的 DUPLICATE_REQUEST **不是**「audit 有同鍵列就算成功」(關卡2 R1 [1][2]):
--     必須同時滿足 ①該 audit 列的 note_id 指向的備註**活著且在本單** ②內容 body_sha256 相符,
--     才回 DUPLICATE_REQUEST(= 真的重送、可安全當成功)。同鍵但無對應備註(稽核遭偽造 ——
--     service_role 對 audit 有 INSERT)或內容不符(request_id 被重用裝不同內容)= RAISE fail-loud,
--     絕不謊報成功。⇒ **RAISE 面 = 步 1(caller 供參數)+ 步 11 異常路**,窮盡宣稱以此為界。
--   🔴 步 7 用 clock_timestamp() 非 now()(關卡2 R1 [18]):now() 是交易起始時間,
--     長交易內以「現在」呼叫會被誤判未來;clock_timestamp() 才是呼叫當下。
--
-- 🔴 A3 指名交給本片的三條契約債(plan §3.2):
--   D1 「不得晚於現在」= 步 7(now()+5min 寬限:裝置時鐘偏移不該拒掉「現在」;plan F7)
--   D2 body 正規化 + 拒收 = 步 8(A3 CHECK 只擋四種零寬;本片加 U+2800/U+3164/U+00AD)
--   D3 「一次只准 INSERT 一列」= 本體恰一句單列 INSERT(禁多列 VALUES / INSERT…SELECT /
--      動態 SQL / LOOP;harness E 區文字層計數 + D 區行為面「恰 +1」承重)。
--      成環需要單一 statement 插 ≥2 互指列(A3 `:186-196`);序列單列 INSERT 下
--      a←b 與 b←a 必有一筆在對方不存在時送出 → FK 23503 ⇒ 單列紀律成立即環不可達。
--
-- 🔴 鎖序(plan §6 R7,F10 更正後的完整持有者清單;`20260624120006:15-16` 的
--    「全庫唯一 orders FOR UPDATE 持有者 = confirm_order_payment」**已過時**,勿再引用):
--    confirm_order_payment(orders-only)/ markFailed(attempt→orders)/
--    改單 workflow ×2(`20260714130000:113`、`20260716130000:268`,orders first)/
--    A7c trigger(orders FOR SHARE→refunds,同向)/ **本 RPC(orders 單列→note 列,同向)**。
--    無任何路徑先鎖 note/refund 列再鎖 orders ⇒ 無反向鎖序。
--    ⚠️ 「無死結」限定「每交易單次呼叫」(關卡2 R1 [16]):同一外層交易對多張單多次呼叫,
--    兩交易以相反單序呼叫仍可互鎖(PG 會偵測並殺一方)。A9d2-1 一請求一呼叫 ⇒ 實務面成立,
--    但不得把這句讀成「任何呼叫模式都無死結」。
--    FOR UPDATE 非 FOR SHARE 是刻意的(plan [39]):同單 append 全序列化,
--    是步 11 dedup 與步 12 已更正 pre-check 免競態的前提(corrects 目標必同單,複合 FK 強制)。
--
-- 🔴 誠實邊界(harness §D 會再印一次):
--   · owner / superuser 仍可改 order_notes **與** admin_audit_log(A3 `:21-27`)⇒
--     兩表分離降低的是**單點竄改**,不是「不可竄改」。不得對外說「備註不可竄改」。
--   · audit 記 body_sha256 + body_length、**不記全文**:PII 最小化 + audit 的讀取面未來會開
--     (稽核檢視器 slice 將 GRANT SELECT;現況 service_role 對 audit 只有 INSERT、無 SELECT,
--     `20260712210000:85-89`)。同長度替換只改 order_notes 一表 ⇒ hash 不符可證(plan [41])。
--   · `DUPLICATE_REQUEST` 的冪等只在**同單**重送下免競態(步 10 序列化);
--     **跨單併發重送不擋**(兩張單鎖不同列;audit 無 (action,request_id) unique ——
--     加它要動已 apply 共用表 = 另一片的決定)。已知洞、非忽略(plan §4.3)。
--   · author 來自自選 picker cookie(actor.ts 自陳非授權邊界)⇒ 保證「有一個合法 slug」,
--     不是「真的是那個人」。真身分屬 E8-B。
--   · RPC 執行期沒有 lock_timeout(檔頭 SET LOCAL 只保護 apply 那一刻)⇒ 撞上殘留 owner
--     交易時 FOR UPDATE 會掛住而非快速失敗(同 S2 既有邊界)。
--   · 併發「兩連線同時 append 同單」的行為面本檔不測(單連線 harness);序列化論證
--     依 FOR UPDATE 語意,同 S2 的 FOR UPDATE 為文字層+邏輯論證,非 barrier 實測。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. admin_append_order_note ───────────────────────────────
CREATE FUNCTION public.admin_append_order_note(
  p_order_id        uuid,
  p_note_type       text,
  p_body            text,
  p_channel         text,
  p_occurred_at     timestamptz,
  p_corrects_note_id uuid,
  p_actor           text,
  p_request_id      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 S2 / tier RPC 的 v_ws;31 字元自檢在下)
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';

  -- body 判空用的「肉眼全白但不屬 [[:space:]]」碼位(plan D2;A3 CHECK 只擋前四種零寬,
  -- 本片加 U+2800 盲文空白 / U+3164 Hangul filler / U+00AD 軟連字號)。7 字元自檢在下。
  -- ⚠️ 這是「已知形狀」清單、**不宣稱窮盡**(A3 `:95-98` 同語)。
  v_body_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  -- body 上限 4000 **Unicode 碼位**(char_length 語意、非 byte;量原文、零寬計入)。
  -- 量級依據:LINE 單則訊息上限 5000 字,4000 夠貼整段聯絡摘要(plan [16][43])。
  v_body_max constant integer := 4000;

  v_actor   text;
  v_req     text;
  v_note_id uuid;
  v_after   jsonb;
BEGIN
  -- 0. 常數自檢(字面漂移 ⇒ 全函式拒用、fail-loud)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_append_order_note: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_body_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_append_order_note: v_body_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 1. actor / request_id(RAISE 面 = caller bug,非固定碼;先剝、後驗,照 S2)
  -- 🔴 actor 另須 slug regex(plan F1):鏡像 order_notes_author_nonempty(A3 `:111-112`),
  --    否則大寫或 65-200 字元 actor 會通過此步、在 INSERT 撞 raw 23514 ——「任一輸入必落
  --    14 碼或步 1 RAISE」的窮盡宣稱就被證偽。staff 表的同 regex(`20260726120000:21`)
  --    只護 A9d2-1 路徑,不護「service_role 直呼本 RPC」的契約面。
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_append_order_note: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_append_order_note: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_append_order_note: actor 非法';
  END IF;
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_append_order_note: actor 非法(須為 staff slug,鏡像 order_notes_author_nonempty)';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_append_order_note: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_append_order_note: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_append_order_note: request_id 非法';
  END IF;

  -- 步 2-12:固定碼面。先命中先回傳;每步一行(或一個緊鄰塊),順序即合約(harness C 區)。
  IF p_order_id IS NULL THEN RETURN 'INVALID_INPUT'; END IF;
  IF p_note_type IS NULL OR p_note_type NOT IN ('internal', 'contact_log', 'customer_notified') THEN RETURN 'INVALID_TYPE'; END IF;
  IF p_channel IS NOT NULL AND p_channel NOT IN ('line', 'phone', 'email', 'in_person', 'other') THEN RETURN 'INVALID_CHANNEL'; END IF;
  IF p_note_type = 'internal' AND (p_channel IS NOT NULL OR p_occurred_at IS NOT NULL) THEN RETURN 'INTERNAL_FIELDS_FORBIDDEN'; END IF;
  IF p_note_type <> 'internal' AND (p_channel IS NULL OR p_occurred_at IS NULL) THEN RETURN 'CONTACT_FIELDS_REQUIRED'; END IF;
  IF p_occurred_at IS NOT NULL AND NOT (p_occurred_at > TIMESTAMPTZ '2020-01-01' AND p_occurred_at < TIMESTAMPTZ '2100-01-01') THEN RETURN 'OCCURRED_AT_OUT_OF_RANGE'; END IF;
  IF p_occurred_at IS NOT NULL AND p_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' THEN RETURN 'OCCURRED_AT_IN_FUTURE'; END IF;
  IF p_body IS NULL OR pg_catalog.regexp_replace(pg_catalog.translate(p_body, v_body_zw, ''), '[[:space:]]', '', 'g') = '' THEN RETURN 'INVALID_BODY'; END IF;
  IF pg_catalog.char_length(p_body) > v_body_max THEN RETURN 'BODY_TOO_LONG'; END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ORDER_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log al WHERE al.action = 'order_note.append' AND al.request_id = v_req) THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log al JOIN public.order_notes n ON n.id::text = al.after->>'note_id' AND n.order_id = p_order_id WHERE al.action = 'order_note.append' AND al.request_id = v_req AND al.after->>'body_sha256' = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body, 'UTF8')), 'hex')) THEN RETURN 'DUPLICATE_REQUEST'; END IF;
    RAISE EXCEPTION 'admin_append_order_note: request_id 已被使用但無對應備註或內容不符(重用或稽核遭偽造)';
  END IF;
  IF p_corrects_note_id IS NOT NULL THEN
    PERFORM 1 FROM public.order_notes WHERE id = p_corrects_note_id AND order_id = p_order_id;
    IF NOT FOUND THEN RETURN 'CORRECTS_NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM public.order_notes WHERE corrects_note_id = p_corrects_note_id) THEN RETURN 'ALREADY_CORRECTED'; END IF;
  END IF;

  -- 步 13. 單列 INSERT(D3;本體唯一一句寫 order_notes)+ 同交易稽核(Q1=A)。
  -- body 入庫存**原文**(顯示保真;判空用的是正規化後的值)。author = 剝驗後的 actor。
  INSERT INTO public.order_notes (order_id, note_type, body, channel, occurred_at, author, corrects_note_id)
  VALUES (p_order_id, p_note_type, p_body, p_channel, p_occurred_at, v_actor, p_corrects_note_id)
  RETURNING id INTO v_note_id;

  v_after := pg_catalog.jsonb_build_object(
    'note_id', v_note_id,
    'note_type', p_note_type,
    'channel', p_channel,
    'occurred_at', p_occurred_at,
    'corrects_note_id', p_corrects_note_id,
    'body_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body, 'UTF8')), 'hex'),
    'body_length', pg_catalog.char_length(p_body));

  -- 🔴 audit INSERT **不包任何 EXCEPTION handler**(plan [40]):失敗必往上拋 ⇒ 整筆
  --    rollback、note 不落地。吞掉它 = note 落地而稽核靜默漏筆。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_note.append', 'order:' || p_order_id::text, NULL, v_after, NULL, v_req, 'admin');

  RETURN 'APPENDED';
END;
$fn$;

COMMENT ON FUNCTION public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text) IS
  'M-4b E10 A6 訂單備註寫入 RPC(Sean 2026-08-02 Q1=A 同交易稽核 / plan v4 關卡1 四輪收斂)。'
  'order_notes 對 service_role 只開 SELECT ⇒ 本函式是 service_role 路徑的唯一寫入口;'
  '唯一動作 = 單列 INSERT(append-only writer;更正 = 帶 p_corrects_note_id 再 append 一筆,不做 UPDATE/DELETE)。'
  '同交易寫 admin_audit_log(action=order_note.append;after 含 note_id / body_sha256 / body_length,不含 body 全文 = PII 最小化)。'
  '回傳 14 固定碼:APPENDED / ORDER_NOT_FOUND / INVALID_INPUT / INVALID_TYPE / INVALID_CHANNEL / '
  'CONTACT_FIELDS_REQUIRED / INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_OUT_OF_RANGE / OCCURRED_AT_IN_FUTURE / '
  'INVALID_BODY / BODY_TOO_LONG / DUPLICATE_REQUEST / CORRECTS_NOT_FOUND / ALREADY_CORRECTED。'
  '🔴 DUPLICATE_REQUEST = 該 request 已寫入過**且經查驗**(同 request_id 的稽核列指向的備註活著、在本單、body_sha256 相符)⇒ 呼叫端必須按成功處理、不得顯示成錯誤;同 request_id 但查驗不過(稽核遭偽造 / request_id 重用裝不同內容)= RAISE fail-loud。'
  '輸入:body ≤4000 碼位、正規化(空白+零寬+U+2800/U+3164/U+00AD)後不得為空、入庫存原文;'
  'occurred_at ∈ (2020-01-01, 2100-01-01) 且不得晚於 now()+5min;actor 須為 staff slug(^[a-z0-9_]{1,64}$)。'
  '鎖序 = orders 單列 FOR UPDATE → note 列(同向,無反向持有者)。EXECUTE 僅 service_role。'
  '誠實邊界:owner/superuser 仍可改兩表(降低單點竄改、非不可竄改);跨單併發重送 request_id 不擋;'
  'author 是自陳身分(E8-B 前非驗證);RPC 執行期無 lock_timeout(撞殘留 owner 交易會掛住);'
  '兩連線併發行為未經 barrier 實測(FOR UPDATE 序列化為邏輯論證);[[:space:]]/[[:cntrl:]] 邊界隨 DB locale。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role ──
REVOKE ALL ON FUNCTION public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text)
  TO service_role;

-- ── 3. 檔內 fail-closed 驗收(任一不符則整支 migration 回滾;照 S2 5a-5g 形狀)──
DO $verify$
DECLARE
  v_oid oid := 'public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)'::regprocedure;
  v_cnt integer;
  v_txt text;
BEGIN
  -- 3a. SECURITY DEFINER + search_path 釘死
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 應為 SECURITY DEFINER;拒繼續';
  END IF;
  SELECT pg_catalog.array_to_string(proconfig, ',') INTO v_txt
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_txt IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — proconfig 應為 search_path=public, pg_temp,實 [%];拒繼續', v_txt;
  END IF;

  -- 3b. 參數簽章逐字(含參數名;多任何一個入口這條就紅)
  --     🔴 identity_arguments 回**全稱** timestamp with time zone、不是 timestamptz(本片實測
  --     被本閘自己擋下;S2 5b 當年同型踩過「名稱 型別」)。
  SELECT pg_catalog.pg_get_function_identity_arguments(v_oid) INTO v_txt;
  IF v_txt <> 'p_order_id uuid, p_note_type text, p_body text, p_channel text, p_occurred_at timestamp with time zone, p_corrects_note_id uuid, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 參數簽章為 [%],與宣告不符;拒繼續', v_txt;
  END IF;

  -- 3c. proacl 非 NULL 前置(NULL = EXECUTE TO PUBLIC 預設,下面每條 ACL 斷言都會假綠)
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'admin_append_order_note ACL 異常 — proacl 為 NULL(= EXECUTE TO PUBLIC 預設);拒繼續';
  END IF;

  -- 3c-2. owner = order_notes 表 owner(SECURITY DEFINER 的全部安全語意 = 以 owner 身分跑)
  IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid)
     <> (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.order_notes'::regclass) THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 函式 owner 與 order_notes 表 owner 不同;拒繼續';
  END IF;

  -- 3d. 函式 ACL 攤平(含 is_grantable)恰 service_role:EXECUTE:false
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_proc pr
            CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
           WHERE pr.oid = v_oid AND a.grantee <> pr.proowner) x;
  IF v_txt <> 'service_role:EXECUTE:false' THEN
    RAISE EXCEPTION 'admin_append_order_note ACL 異常 — 非 owner 授權應恰為 service_role:EXECUTE:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 3e. PUBLIC(grantee=0)零授權(縱深第二層,紅點歸 3d;S2 5e 同語)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc pr
    CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
   WHERE pr.oid = v_oid AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_append_order_note ACL 異常 — PUBLIC 應零授權,實 % 筆;拒繼續', v_cnt;
  END IF;

  -- 3f. order_notes 表級 ACL 不得被放寬(仍恰 service_role:SELECT:false;含 is_grantable)
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.order_notes'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'order_notes ACL 異常 — 應仍恰為 service_role:SELECT:false(寫入唯一路 = 本 RPC),實 [%];拒繼續', v_txt;
  END IF;

  -- 3f-2. 欄級 ACL = 0(relacl 只放表級;欄級 GRANT 是攤平比對看不到的後門)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_notes'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'order_notes ACL 異常 — 有 % 個欄位帶欄級 ACL;拒繼續', v_cnt;
  END IF;

  -- 3f-3. RLS on + 零 policy(A3 既有終態,本片不得動搖)
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.order_notes'::regclass) THEN
    RAISE EXCEPTION 'order_notes 異常 — RLS 應為啟用;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'order_notes';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'order_notes 異常 — 應零 policy,實 % 條;拒繼續', v_cnt;
  END IF;
  -- 3f-4. 🔴 FORCE RLS 必須關(關卡2 R1 [5]):zero-policy + FORCE = 連 owner 都被擋
  --       ⇒ 本 SECURITY DEFINER RPC 的第一筆 INSERT 就 42501,而「RLS on + 零 policy」照樣全綠。
  IF (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.order_notes'::regclass) THEN
    RAISE EXCEPTION 'order_notes 異常 — relforcerowsecurity 應為 false(FORCE + 零 policy 會擋掉 owner RPC);拒繼續';
  END IF;

  -- 3g. admin_audit_log:本函式寫入的八欄仍在
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.admin_audit_log'::regclass
     AND NOT attisdropped AND attnum > 0
     AND attname IN ('actor','action','target','before','after','reason','request_id','source_app');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'admin_audit_log 異常 — 本 RPC 寫入的 8 欄應全部存在,實命中 %;拒繼續', v_cnt;
  END IF;

  -- 3g-2. 函式 owner 對 admin_audit_log 有 INSERT(否則上線首呼叫 42501)
  IF NOT has_table_privilege(
       (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid),
       'public.admin_audit_log'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 函式 owner 對 admin_audit_log 無 INSERT;拒繼續';
  END IF;

  -- 3g-3. 🔴 函式 owner 對 admin_audit_log 有 SELECT(plan F2:步 11 的 DUPLICATE_REQUEST
  --       dedup 查詢是本片**新增**的依賴;只驗 INSERT 的話,audit owner 漂移 + 只補 INSERT
  --       grant 會讓本 migration 全綠、正式站每一次呼叫在步 11 炸 42501)
  IF NOT has_table_privilege(
       (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid),
       'public.admin_audit_log'::regclass, 'SELECT') THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 函式 owner 對 admin_audit_log 無 SELECT(步 11 dedup 查詢的新依賴);拒繼續';
  END IF;

  -- 3g-4. 🔴🔴 函式 owner 必須**就是** admin_audit_log 的 owner(關卡2 R1 [3][4]):
  --       audit 是 RLS on + 零 policy 的表 ⇒ 非 owner 就算拿到表級 GRANT,
  --       SELECT 會靜默看不到列(dedup 永遠不命中)、INSERT 直接 42501 ——
  --       而 3g-2/3g-3 的 has_table_privilege **看不出這件事**(權限≠RLS 穿透;
  --       且對 superuser owner 恆 true = 零判別力,正式站 owner 屬性本輪未 read-back、標未確認)。
  --       穿透 zero-policy 的唯一不靠 policy 的合法姿勢 = 表 owner(FORCE off 時 owner 繞過 RLS)。
  IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid)
     <> (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — 函式 owner 與 admin_audit_log 表 owner 不同(zero-policy RLS 下非 owner 讀不到寫不進);拒繼續';
  END IF;

  -- 3g-5. audit 側 FORCE RLS 也必須關(同 3f-4 的理由,套在稽核表)
  IF (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN
    RAISE EXCEPTION 'admin_audit_log 異常 — relforcerowsecurity 應為 false(FORCE + 零 policy 連 owner 都擋);拒繼續';
  END IF;

  -- 3h. COMMENT 合約存在且含 14 碼全集(plan [18];缺任一碼 = introspection 合約不完整)
  SELECT pg_catalog.obj_description(v_oid, 'pg_proc') INTO v_txt;
  IF v_txt IS NULL THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — COMMENT ON FUNCTION 不存在;拒繼續';
  END IF;
  IF NOT (v_txt LIKE '%APPENDED%' AND v_txt LIKE '%ORDER_NOT_FOUND%' AND v_txt LIKE '%INVALID_INPUT%'
      AND v_txt LIKE '%INVALID_TYPE%' AND v_txt LIKE '%INVALID_CHANNEL%'
      AND v_txt LIKE '%CONTACT_FIELDS_REQUIRED%' AND v_txt LIKE '%INTERNAL_FIELDS_FORBIDDEN%'
      AND v_txt LIKE '%OCCURRED_AT_OUT_OF_RANGE%' AND v_txt LIKE '%OCCURRED_AT_IN_FUTURE%'
      AND v_txt LIKE '%INVALID_BODY%' AND v_txt LIKE '%BODY_TOO_LONG%' AND v_txt LIKE '%DUPLICATE_REQUEST%'
      AND v_txt LIKE '%CORRECTS_NOT_FOUND%' AND v_txt LIKE '%ALREADY_CORRECTED%') THEN
    RAISE EXCEPTION 'admin_append_order_note 異常 — COMMENT 未含 14 碼全集;拒繼續';
  END IF;

  RAISE NOTICE 'A6 結構驗收全數通過(SECDEF / search_path / 簽章 / 函式 ACL / order_notes ACL 未放寬 / RLS / audit 欄位 + INSERT + SELECT / COMMENT 14 碼)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(plan §8):另立版本號更大的 down migration(forward-only 慣例)
--
--   DROP FUNCTION IF EXISTS public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text);
--
-- 🔴 「migration 可逆,營運效果不可逆」:員工開始寫備註後,DROP 函式不會回到 A6 前的狀態
--    (既有 note 列 + 對 orders 的 ON DELETE RESTRICT 引用都留著、會擋刪單)。
-- 🔴 撤除順序固定:A10a → A9d2-1 → A9a-1 → 最後才 DROP 本函式(先 DROP 會讓線上 action
--    呼叫不存在的 RPC —— 呼叫層症狀為 PostgREST 404/PGRST202,不臆測狀態碼)。
-- 🔴 已寫進 admin_audit_log 的稽核列 = 正常營運資料,不隨 down 回收。
-- ============================================================
