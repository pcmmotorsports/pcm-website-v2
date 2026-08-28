-- ============================================================================
-- M-4b 片1a:**修上一支的 bug** —— 三支寫入 RPC 缺 `p_request_id` 閘
-- ============================================================================
-- 🛑 **上一支 `20260828080000_m4b_b4views1_saved_order_views.sql` 已經在正式庫上**
--    (Sean 2026-08-28 11:1x 自己在 SQL Editor 貼的)⇒ **不改它, 往前修這一支。**
-- 🛑 **本支同樣【不由任何窗 apply】** —— apply 是他的手。
--
-- ## 那條 bug
-- `admin_audit_log.request_id` 是 **NOT NULL + CHECK (<> '')**
-- (`20260712210000_m4a_admin_audit_log.sql` 的 `CREATE TABLE public.admin_audit_log`)。
-- 而上一支把 `p_request_id` **原樣**塞進去 ⇒ 呼叫端傳 NULL/'' ⇒ 23502/23514
-- ⇒ 🔴 **那張檢視根本沒存進去**, 而畫面拿到一串英文。create / update / delete 三支全中。
--
-- ## 🔴 而它為什麼躲過了三輪對抗審查 —— 這一格比 bug 本身重要
-- 測試 fixture 把那一欄建成 `request_id text`(可空、零 CHECK)—— **比真表寬**;
-- 而 39 格測試有 9 格傳 NULL ⇒ 它在 **30 發突變 + 39 格 + 22 道碼錨底下恆綠**。
-- 📌 **對抗審查沒有自己的世界 —— 它看的是我給它的那個。**
--    ⇒ **三輪不是三個獨立的證據, 是【同一個前提被檢查了三次】。**
-- ✅ fixture 已抽成共用檔並【照真表逐字抄】:`docs/specs/2026-08-25-saved-views-fixture.sql`
--    換上去之後, 那 39 格**全掛在第 1 格**(ok 39 ⇒ 0)
--    ⇒ 📌 **一個假世界不是讓你少測到幾格, 是讓你連【那個功能能不能用】都沒測過。**
--
-- ## 本支做什麼
-- `CREATE OR REPLACE` 三支寫入 RPC(list 不寫稽核, 不動它),各加一道:
--   `p_request_id IS NULL` ⇒ RAISE · `btrim(空白+零寬)` 後為空 ⇒ RAISE · 稽核寫正規化後的 `v_req`
-- 形狀逐字抄 `20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql`,不自創措辭。
--
-- ⚠️ 本支**不重複**上一支的建表 / 索引 / trigger / RLS / GRANT —— 那些已經在庫上。
--    而斷言區只驗【本支動到的那幾格】。
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_create_saved_order_view(
  p_actor           text,
  p_label           text,
  p_query           text,
  p_date_preset     text,
  p_is_shared       boolean,
  p_idempotency_key text,
  p_request_id      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 `20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql`
  -- 那支的 `v_ws` / `v_zw`)。⚠️ **抄過來的常數要自己驗長度** ——
  -- 📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同。
  --    ⇒ 斷言區有一格逐字數它(31 / 7)。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';
  v_req        text;
  v_is_manager boolean;
  v_label      text;
  v_id         bigint;
  v_constraint text;
BEGIN
  -- 身分閘(碼錨 A 的字面就是下面這一句 WHERE)。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 🔴🔴 `p_request_id` 閘(2026-08-28 補;上一支已 apply 而缺這道)
  --    `admin_audit_log.request_id` 是 **NOT NULL + CHECK (<> '')**
  --    ⇒ 原樣塞 NULL 進去 ⇒ 23502 ⇒ **那張檢視根本沒存進去**, 而畫面拿到一串英文。
  --    ⚠️ 它躲過 codex 三輪 + 30 發突變 + 22 道碼錨 —— 因為測試 fixture 把那一欄建得比真表寬。
  --       📌 **對抗審查沒有自己的世界, 它看的是我給它的那個。**
  --    🔴 **為什麼是 RAISE 不是回一個碼**(與同片 `NAME_TAKEN` 的裁定理由【相反】):
  --       `NAME_TAKEN` 的觸發者是【使用者做得到的事】⇒ 回碼, 他要知道下一步;
  --       本條的觸發者是【呼叫端沒傳】⇒ **程式錯誤, 而程式錯誤就該大聲、就該難看。**
  --       📌 一串英文會讓人去修;一個溫和的錯誤碼會讓人**繞過去**。
  -- 🔴 抄過來的常數自己驗長度(前例 `20260810233000` 也這樣做)——
  --    📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同
  --       ⇒ 它會安靜地少擋一種字元。
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'v_ws 字元集長度異常(預期 31,實得 %)', pg_catalog.char_length(v_ws);
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'v_zw 字元集長度異常(預期 7,實得 %)', pg_catalog.char_length(v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_create_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)';
  END IF;

  -- 內容閘:建【共用】檢視要管理者(Q-檢視-7)。建私人檢視不用。
  -- 🔴 create 這支的授權只依【傳入的新值】—— 沒有既有列,所以 R1-F3 那個
  --    「新值與舊值要看聯集」的洞在這支**構造不出來**。那正是建與改分家的收穫。
  IF COALESCE(p_is_shared, false) AND NOT v_is_manager THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  v_label := pg_catalog.btrim(COALESCE(p_label, ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'admin_create_saved_order_view: 名稱必填';
  END IF;

  BEGIN
    INSERT INTO public.admin_saved_order_views
      (staff_id, label, query, date_preset, idempotency_key)
    VALUES
      (CASE WHEN COALESCE(p_is_shared, false) THEN NULL ELSE p_actor END,
       v_label, COALESCE(p_query, ''), p_date_preset, p_idempotency_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- 🔴 **不靠「哪一個索引先報」**(codex 關卡2 F2, 2026-08-28)——
    --    一發重播可以【同時】違反重播鍵與同名索引(同一個請求送兩次, 名字當然也一樣),
    --    而 PostgreSQL 先報哪一個**不保證** ⇒ 舊寫法(比對 SQLERRM 字面)會在那時回 `NAME_TAKEN`
    --    ⇒ 📌 **一發正常的重播, 被回報成「名字重複」** —— 而使用者會去改名字, 然後真的建出第二張。
    --    ✅ 改成【回頭查】:那把鑰匙已經有列了嗎? 有 ⇒ 就是重播, 與哪個索引先報無關。
    IF p_idempotency_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.admin_saved_order_views
       WHERE idempotency_key = p_idempotency_key
    ) THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    -- 撞【同名】= 使用者取了一個已經有人用的名字。
    -- 🔴 這是第五個碼 `NAME_TAKEN`,而它的授權強度要寫清楚:
    --    **這是主視窗 2026-08-28 裁的,Sean 沒有看過這個碼。**
    --    不是「他選了」,是「主視窗決定,而他沒有被問」。
    -- 理由(主視窗逐字):一個 DB 例外冒到畫面 = 員工看到一串英文,
    --   而【他做錯的事其實很簡單】(名字重複了)
    --   ⇒ 那不是「還沒做錯誤處理」,是**把一個可預期的使用者行為當成系統故障**。
    -- 📌 它與 CONFLICT 那格是同一條:回傳碼合約要涵蓋【使用者做得到的每一種事】,
    --    而「取一個已經有人用的名字」是使用者做得到的。
    -- 🔴 用 `CONSTRAINT_NAME` 不用 `SQLERRM` 字面 —— 錯誤訊息會隨 PG 版本與語系變,
    --    而約束名是我們自己取的。(同族:不要拿【給人看的字串】當【給機器判的依據】。)
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IN ('admin_saved_order_views_private_label_idx',
                        'admin_saved_order_views_shared_label_idx') THEN
      RETURN 'NAME_TAKEN';
    END IF;
    RAISE;
  END;

  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor, 'order.saved_view.create', 'saved_order_view:' || v_id::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'label', v_label, 'query', COALESCE(p_query, ''),
      'date_preset', p_date_preset, 'is_shared', COALESCE(p_is_shared, false)),
    NULL, v_req, 'admin'
  );

  RETURN 'CREATED';
END;
$$;

-- 🔴 下面這幾行區段標記與片1 的【逐字相同】, 而它們不是裝飾:
--    突變產生器用它們切函式邊界(`in_fn`)。少了它們, 針對這三支的突變會安靜地
--    改去打片1 那份【已經被本支蓋掉】的定義 ⇒ 22 發同時變成 no-op(2026-08-28 實測)。
-- ── 5c.
CREATE OR REPLACE FUNCTION public.admin_update_saved_order_view(
  p_actor               text,
  p_view_id             bigint,
  p_label               text,
  p_query               text,
  p_date_preset         text,
  p_expected_updated_at timestamptz,
  p_request_id          text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 `20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql`
  -- 那支的 `v_ws` / `v_zw`)。⚠️ **抄過來的常數要自己驗長度** ——
  -- 📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同。
  --    ⇒ 斷言區有一格逐字數它(31 / 7)。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';
  v_req        text;
  v_is_manager boolean;
  v_before     public.admin_saved_order_views%ROWTYPE;
  v_label      text;
  v_code       text;
  v_constraint text;
BEGIN
  -- 身分閘(碼錨 A)。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 🔴🔴 `p_request_id` 閘(2026-08-28 補;上一支已 apply 而缺這道)
  --    `admin_audit_log.request_id` 是 **NOT NULL + CHECK (<> '')**
  --    ⇒ 原樣塞 NULL 進去 ⇒ 23502 ⇒ **那張檢視根本沒存進去**, 而畫面拿到一串英文。
  --    ⚠️ 它躲過 codex 三輪 + 30 發突變 + 22 道碼錨 —— 因為測試 fixture 把那一欄建得比真表寬。
  --       📌 **對抗審查沒有自己的世界, 它看的是我給它的那個。**
  --    🔴 **為什麼是 RAISE 不是回一個碼**(與同片 `NAME_TAKEN` 的裁定理由【相反】):
  --       `NAME_TAKEN` 的觸發者是【使用者做得到的事】⇒ 回碼, 他要知道下一步;
  --       本條的觸發者是【呼叫端沒傳】⇒ **程式錯誤, 而程式錯誤就該大聲、就該難看。**
  --       📌 一串英文會讓人去修;一個溫和的錯誤碼會讓人**繞過去**。
  -- 🔴 抄過來的常數自己驗長度(前例 `20260810233000` 也這樣做)——
  --    📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同
  --       ⇒ 它會安靜地少擋一種字元。
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'v_ws 字元集長度異常(預期 31,實得 %)', pg_catalog.char_length(v_ws);
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'v_zw 字元集長度異常(預期 7,實得 %)', pg_catalog.char_length(v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)';
  END IF;

  -- 🔴 鎖列之後才讀、才判 —— R2-3 的 TOCTOU 就是死在「先讀出來再拿它去判」。
  SELECT * INTO v_before
    FROM public.admin_saved_order_views
   WHERE id = p_view_id
     FOR UPDATE;

  -- 🔴 「你看不到的」與「不存在的」回同一個碼(R3 IMP-8)⇒ NOT_FOUND 不洩漏任何東西。
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- 🔴🔴 COALESCE 不是防禦性寫法, 它是這道閘的【本體】。
  --    共用檢視的 staff_id IS NULL ⇒ `NULL = p_actor` 是 NULL(不是 false)
  --    ⇒ `NULL OR false` = NULL ⇒ `NOT NULL` = NULL ⇒ **IF 不成立 ⇒ 直接放行。**
  --    📌 一道寫得完全正確、讀起來也正確的閘, 對【共用檢視】整個不生效 ——
  --       而共用檢視正是 Sean 唯一要求「只有管理者」的那一種。
  --    ⚠️ 這是 2026-08-28 寫測試時第一發就撞到的(T7:clerk 改共用 ⇒ 實得 UPDATED)。
  --       它在斷言、碼錨、三綠、四輪人審底下【全部是綠的】—— 只有真的餵一發才看得見。
  IF NOT (COALESCE(v_before.staff_id = p_actor, false)
          OR (v_before.is_shared AND v_is_manager)) THEN
    RETURN 'NOT_FOUND';
  END IF;

  v_label := pg_catalog.btrim(COALESCE(p_label, v_before.label));
  IF v_label = '' THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: 名稱必填';
  END IF;

  -- ⚠️ 本支【不改】staff_id 與 is_shared ——「把私人翻成共用」不是 update 的職責。
  --    那是 R1-F3 那個洞的來源;拿掉這個能力,洞就構造不出來。
  --    (要換擁有權 ⇒ 未來另開一支,不從這裡長出來。)
  IF v_label       IS NOT DISTINCT FROM v_before.label
     AND COALESCE(p_query, v_before.query)             IS NOT DISTINCT FROM v_before.query
     AND COALESCE(p_date_preset, v_before.date_preset) IS NOT DISTINCT FROM v_before.date_preset
  THEN
    RETURN 'NO_CHANGE';
  END IF;

  -- q31 = 甲「後改的贏 —— 存進去,而畫面告訴他【有人剛改過】」。
  -- 🔴 UPDATED_OVERWROTE,**不得沿用 CONFLICT**:CONFLICT 的舊語意是「我拒絕了你的寫入」,
  --    新語意是「我寫了,而你蓋掉了比你新的」⇒ 兩個完全不同的合約共用一個碼名時,
  --    **舊的呼叫端不會壞掉,它只會理解錯**(以為沒寫進去 ⇒ 叫使用者重打 ⇒ 而東西早就存了)。
  IF p_expected_updated_at IS NOT NULL
     AND v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    v_code := 'UPDATED_OVERWROTE';
  ELSE
    v_code := 'UPDATED';
  END IF;

  -- 🔴 改名可能撞到同擁有者(或共用區)已存在的名字(codex 關卡2 F3, 2026-08-28)。
  --    舊寫法 ⇒ 唯一索引的例外**直接冒到畫面** ⇒ 員工看到一串英文,
  --    而他做錯的事其實很簡單(名字重複了)—— 與 `create` 那一格同一條理由。
  --    ⇒ 📌 **`NAME_TAKEN` 原本【只有 create 產得出來】, 而 update 也做得到那件事。**
  --       回傳碼合約要涵蓋【使用者做得到的每一種事】, 而不是【我寫到哪一支時想到的】。
  BEGIN
    UPDATE public.admin_saved_order_views
       SET label       = v_label,
           query       = COALESCE(p_query, query),
           date_preset = COALESCE(p_date_preset, date_preset)
     WHERE id = p_view_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IN ('admin_saved_order_views_private_label_idx',
                        'admin_saved_order_views_shared_label_idx') THEN
      RETURN 'NAME_TAKEN';
    END IF;
    RAISE;   -- 其餘唯一違規 = 真故障, 不吞
  END;

  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor, 'order.saved_view.update', 'saved_order_view:' || p_view_id::text,
    pg_catalog.jsonb_build_object('label', v_before.label, 'query', v_before.query,
                                  'date_preset', v_before.date_preset),
    pg_catalog.jsonb_build_object('label', v_label,
                                  'query', COALESCE(p_query, v_before.query),
                                  'date_preset', COALESCE(p_date_preset, v_before.date_preset)),
    v_code, v_req, 'admin'
  );

  RETURN v_code;
END;
$$;

-- ── 5d.
CREATE OR REPLACE FUNCTION public.admin_delete_saved_order_view(
  p_actor      text,
  p_view_id    bigint,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 `20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql`
  -- 那支的 `v_ws` / `v_zw`)。⚠️ **抄過來的常數要自己驗長度** ——
  -- 📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同。
  --    ⇒ 斷言區有一格逐字數它(31 / 7)。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';
  v_req        text;
  v_is_manager boolean;
  v_before     public.admin_saved_order_views%ROWTYPE;
BEGIN
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 🔴🔴 `p_request_id` 閘(2026-08-28 補;上一支已 apply 而缺這道)
  --    `admin_audit_log.request_id` 是 **NOT NULL + CHECK (<> '')**
  --    ⇒ 原樣塞 NULL 進去 ⇒ 23502 ⇒ **那張檢視根本沒存進去**, 而畫面拿到一串英文。
  --    ⚠️ 它躲過 codex 三輪 + 30 發突變 + 22 道碼錨 —— 因為測試 fixture 把那一欄建得比真表寬。
  --       📌 **對抗審查沒有自己的世界, 它看的是我給它的那個。**
  --    🔴 **為什麼是 RAISE 不是回一個碼**(與同片 `NAME_TAKEN` 的裁定理由【相反】):
  --       `NAME_TAKEN` 的觸發者是【使用者做得到的事】⇒ 回碼, 他要知道下一步;
  --       本條的觸發者是【呼叫端沒傳】⇒ **程式錯誤, 而程式錯誤就該大聲、就該難看。**
  --       📌 一串英文會讓人去修;一個溫和的錯誤碼會讓人**繞過去**。
  -- 🔴 抄過來的常數自己驗長度(前例 `20260810233000` 也這樣做)——
  --    📌 一個少了一個碼位的白名單, 與完整的那份, 對大多數輸入的 `btrim` 結果都相同
  --       ⇒ 它會安靜地少擋一種字元。
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'v_ws 字元集長度異常(預期 31,實得 %)', pg_catalog.char_length(v_ws);
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'v_zw 字元集長度異常(預期 7,實得 %)', pg_catalog.char_length(v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_delete_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_delete_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)';
  END IF;

  SELECT * INTO v_before
    FROM public.admin_saved_order_views
   WHERE id = p_view_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- 🔴🔴 COALESCE 不是防禦性寫法, 它是這道閘的【本體】。
  --    共用檢視的 staff_id IS NULL ⇒ `NULL = p_actor` 是 NULL(不是 false)
  --    ⇒ `NULL OR false` = NULL ⇒ `NOT NULL` = NULL ⇒ **IF 不成立 ⇒ 直接放行。**
  --    📌 一道寫得完全正確、讀起來也正確的閘, 對【共用檢視】整個不生效 ——
  --       而共用檢視正是 Sean 唯一要求「只有管理者」的那一種。
  --    ⚠️ 這是 2026-08-28 寫測試時第一發就撞到的(T7:clerk 改共用 ⇒ 實得 UPDATED)。
  --       它在斷言、碼錨、三綠、四輪人審底下【全部是綠的】—— 只有真的餵一發才看得見。
  IF NOT (COALESCE(v_before.staff_id = p_actor, false)
          OR (v_before.is_shared AND v_is_manager)) THEN
    RETURN 'NOT_FOUND';
  END IF;

  DELETE FROM public.admin_saved_order_views
   WHERE id = p_view_id;

  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor, 'order.saved_view.delete', 'saved_order_view:' || p_view_id::text,
    pg_catalog.jsonb_build_object('label', v_before.label, 'query', v_before.query,
                                  'date_preset', v_before.date_preset,
                                  'is_shared', v_before.is_shared),
    NULL, NULL, v_req, 'admin'
  );

  RETURN 'DELETED';
END;
$$;
-- ── 6.
-- ── 斷言(同交易;只驗本支動到的)──────────────────────────────────────────
DO $assert$
DECLARE
  v_def   text;
  v_n     integer;
  v_pa    integer;
  v_pb    integer;
  v_sig   text;
  v_write text;
  r       record;
BEGIN
  -- A. 三支都真的帶上那道閘(碼錨:字面在, 而它只是絆線不是證據)
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_create_saved_order_view(text, text, text, text, boolean, text, text)',
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)']) AS sig
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    IF position('p_request_id IS NULL' in v_def) = 0 THEN
      RAISE EXCEPTION '碼錨:% 沒有 p_request_id 的 NULL 閘;拒繼續', r.sig;
    END IF;
    -- 🔴 而【稽核那句真的改用 v_req 了嗎】要單獨驗 —— 只加閘而仍塞 p_request_id
    --    會讓「去空白後為空」那半白做(它擋得住 NULL, 擋不住全形空白)。
    IF position('v_req, ''admin''' in v_def) = 0 THEN
      RAISE EXCEPTION '碼錨:% 的稽核仍寫 p_request_id 而不是正規化後的 v_req;拒繼續', r.sig;
    END IF;
    IF position('p_request_id, ''admin''' in v_def) <> 0 THEN
      RAISE EXCEPTION '碼錨:% 還留著原樣的 p_request_id 進稽核;拒繼續', r.sig;
    END IF;
  END LOOP;

  -- B. search_path 沒有在 CREATE OR REPLACE 時掉了(它是逐支設定的, 不會自動繼承)
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_create_saved_order_view','admin_update_saved_order_view',
                       'admin_delete_saved_order_view')
     AND p.proconfig @> ARRAY['search_path=public, pg_temp'];
  IF v_n <> 3 THEN
    RAISE EXCEPTION '斷言 B:search_path 逐支設定不足(期望 3,實得 %)', v_n;
  END IF;

  -- C. EXECUTE 權限沒有因為 CREATE OR REPLACE 而重置
  --    🔴 CREATE OR REPLACE **保留**既有 ACL, 而【新建】會套用 default ACL ——
  --       所以這一格在「函式本來就在」與「它其實是新建的」兩個世界會印不同的東西。
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_create_saved_order_view(text, text, text, text, boolean, text, text)',
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)']) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE')
       OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言 C:anon/authenticated 對 % 有 EXECUTE', r.sig;
    END IF;
    IF NOT has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言 C:service_role 對 % 沒有 EXECUTE(app 會 permission denied)', r.sig;
    END IF;
  END LOOP;

  -- C-2. 🔴 `search_path = public, pg_temp` 的**安全前提**也要重驗 ——
  --    本支重建了三支 SECURITY DEFINER 函式 ⇒ 那個前提對【新的這三支】同樣要成立,
  --    而片1 的 7b 驗的是片1 apply 當下的世界。
  --    ⚠️ 2026-08-28 實測:突變 MA4(給 anon `CREATE ON SCHEMA public`)在補這一段之前,
  --       打在本支上是**恆綠**的 —— 因為片1 的 7b 早就跑完了。
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '斷言 C-2:anon/authenticated 對 public schema 有 CREATE;search_path 前提不成立';
  END IF;

  -- D. 🔴🔴 **把片1 的碼錨【重跑一次】** —— 本支 `CREATE OR REPLACE` 了三支函式,
  --    而片1 的那些錨是在**片1 apply 當下**跑的 ⇒ 它們驗到的是【被本支蓋掉之前】那一版。
  --    📌 **一支後來的 migration 重建了函式, 而前一支的守門不會再看它一眼** ——
  --       那些錨仍然「跑過了」, 只是跑的是另一個版本。
  --    ⚠️ 2026-08-28 實測:突變 M21(拿掉 update 的 FOR UPDATE)在補這一段之前是**恆綠**的。
  -- 7f. 碼錨:授權閘的字面必須在寫入語句【之前】,且寫入語句只准一句。
  --     🔴 錨只證【字面順序】,不證執行順序(F6)—— 它是絆線,不是證據。
  --        把字面塞進死分支 / 字串 / 註解 ⇒ 照樣全綠。這一格知道自己證不到什麼。
  FOR r IN
    SELECT * FROM (VALUES
      ('public.admin_create_saved_order_view(text, text, text, text, boolean, text, text)',
       'INSERT INTO public.admin_saved_order_views'),
      ('public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
       'UPDATE public.admin_saved_order_views'),
      ('public.admin_delete_saved_order_view(text, bigint, text)',
       'DELETE FROM public.admin_saved_order_views')
    ) AS t(sig, write_stmt)
  LOOP
    v_sig   := r.sig;
    v_write := r.write_stmt;
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_pa := position('WHERE s.id = p_actor AND s.is_active' in v_def);
    v_pb := position(v_write in v_def);
    IF v_pa = 0 THEN
      RAISE EXCEPTION '碼錨 A:% 的 actor 身分閘字面缺失;拒繼續', v_sig;
    END IF;
    IF v_pb = 0 THEN
      RAISE EXCEPTION '碼錨 B:% 的寫入語句字面缺失;拒繼續', v_sig;
    END IF;
    IF v_pa >= v_pb THEN
      RAISE EXCEPTION '碼錨 順序:% 的授權閘不在寫入之前;拒繼續', v_sig;
    END IF;
    -- 寫入語句只准一句:拆成兩句 ⇒ 錨只蓋得住一句,閘挪到另一句之後【照樣綠】。
    v_n := (pg_catalog.length(v_def)
            - pg_catalog.length(pg_catalog.replace(v_def, v_write, '')))
           / pg_catalog.length(v_write);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '碼錨 唯一性:% 的寫入語句出現 % 次(只准 1)', v_sig, v_n;
    END IF;
  END LOOP;

  -- 7f-2. 🔴 鎖列錨 —— update / delete 兩支必須有 `FOR UPDATE`。
  --   ⚠️ 這一格是 2026-08-28 突變 M21 逼出來的:把 `FOR UPDATE` 整個拿掉 ⇒ **16 發突變全綠、
  --      32 格測試全過**。因為鎖是【並發】性質, 而單一 session 的測試看不見它。
  --   📌 **一個東西可以是這一片最重要的設計決定(§14-15 換路的核心), 而零覆蓋。**
  --   🔴 而它只是【絆線】不是證據 —— 它防的是手滑刪掉那兩個字, 防不了「鎖了而判斷在鎖外面」。
  --      要真的證明, 需要兩個 session 的並發測試 ⇒ 那不在本片射程, 已列 §14-Z ②。
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)']) AS sig
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    IF position('FOR UPDATE' in v_def) = 0 THEN
      RAISE EXCEPTION '碼錨 鎖列:% 沒有 FOR UPDATE;換路的核心不見了, 拒繼續', r.sig;
    END IF;
    IF position('FOR UPDATE' in v_def)
       >= position(CASE WHEN r.sig LIKE '%update%' THEN 'UPDATE public.admin_saved_order_views'
                        ELSE 'DELETE FROM public.admin_saved_order_views' END in v_def) THEN
      RAISE EXCEPTION '碼錨 鎖列順序:% 的 FOR UPDATE 不在寫入之前;拒繼續', r.sig;
    END IF;
  END LOOP;


  -- D-2. 鎖列錨(同上, 片1 有而本支重建之後沒有人再驗)
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)']) AS sig
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    IF position('FOR UPDATE' in v_def) = 0 THEN
      RAISE EXCEPTION '碼錨 鎖列:% 沒有 FOR UPDATE;換路的核心不見了, 拒繼續', r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE '片1a 斷言全過(A/B/C/D)';
END;
$assert$;

COMMIT;
