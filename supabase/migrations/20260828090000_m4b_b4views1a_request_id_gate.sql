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
-- ## 🔴🔴 本片的母題(2026-08-28 全陣同一天在三個不同的層各撞一次)
-- 📌 **「乾淨」與「從來沒被設定過」印同一個答案。**
--    · 測試層:空集合上的 `bool_and` 恆真 ⇒ **沒有資料**與**全部合格**印同一個 t
--    · 帳本層:一個沒有意見的人, 與一個說了「沒有」的人, 在統計上是同一格
--    · 權限層(本片 F6):`relacl IS NULL` 時 PUBLIC 在那一欄裡**看不見**
--      ⇒ 一把只問「ACL 裡有沒有壞東西」的尺, 對「這一格根本沒被設定過」**完全失明**
-- ⇒ 三個完全不同的層, **同一個形狀**。判別句:
--   **一把尺如果只認得【壞的那個世界】, 它就會把【還沒有世界】判成好的。**
-- ⇒ 本片的作法:斷言 E 先分開那兩個世界, 再談乾不乾淨;而**兩個世界各配一發突變**
--   (MG6 有壞東西 / MG7 整格 NULL)—— 只跑前者的話, NULL 那條分支**永遠沒有被執行過**。
--
-- ## 本支做什麼
-- `CREATE OR REPLACE` **四支** RPC。三支寫入的各加一道:
--   `p_request_id IS NULL` ⇒ RAISE · `btrim(空白+零寬)` 後為空 ⇒ RAISE · 🔴 稽核寫【原值】`p_request_id`
--   ⚠️ ~~原字面「稽核寫正規化後的 v_req」~~ 作廢(codex 關卡2 F5)—— 見下方 `v_req` 那一段的理由。
-- 第四支 `list` **不寫稽核、不加這道閘**, 而它**仍然被重建了**(5e:拿掉 `FOR SHARE`)。
-- 🔴 ~~原字面「三支寫入 RPC(list 不寫稽核, 不動它)」~~ **作廢**(R3 格5, 2026-08-28):
--    折 codex F3 時 5e 接管了 list, 而**這句檔頭沒跟著改** ⇒ 檔頭與檔身互相矛盾,
--    而 Sean 貼這支之前讀到的第一句就是它。
--    📌 **一個 `CREATE OR REPLACE` 會讓所有引用「我們沒動那支」的舊字面同時變成假的** ——
--       它們不會報錯, 它們會安靜地留在檔頭當作介紹。
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
  -- 🔴 **長度不是集合** —— ~~原本只驗 `char_length` 是 31 / 7~~ 作廢(codex 關卡2 nit-C, 2026-08-28):
  --    兩個碼位**互換**之後長度不變 ⇒ 白名單已經錯了而斷言照樣過。
  --    📌 **一把只數個數的尺, 對「換掉一個成員」完全失明 —— 而那正是抄錯常數最可能的形狀。**
  --    ⇒ 改成釘住**整個集合的雜湊**;長度仍一起印, 因為它說得出「差在哪個方向」。
  IF pg_catalog.char_length(v_ws) <> 31 OR pg_catalog.char_length(v_zw) <> 7
     OR pg_catalog.md5(v_ws || v_zw) <> '006aaa7db32b350462cd99625d9c466c' THEN
    RAISE EXCEPTION '斷言 字元集:不是預期那一份(v_ws 長 %,v_zw 長 %,md5 %)',
      pg_catalog.char_length(v_ws), pg_catalog.char_length(v_zw), pg_catalog.md5(v_ws || v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  -- 🔴🔴 **`v_req` 只用來【判斷是不是全空白】, 不拿它去寫稽核**
  --    (codex 關卡2 F5, 2026-08-28;原本三支的稽核欄位都塞正規化後的那個變數, 作廢)
  --    🔴 **這句話刻意【不寫出那個舊字面】** —— 下方碼錨用字面比對來抓它,
  --       而一句描述它的註解會被那道錨數進去 ⇒ 實測 apply 直接紅在這裡。
  --       📌 **記錄缺口的註解, 會被偵測缺口的量具當成缺口本身。**
  --    `request_id` 是**上游給的 correlation key, 對我們是不透明的**。`btrim` 不是驗證, 是**改寫**:
  --    它會吃掉合法地位於頭尾的 ZWJ / ZWNJ / soft hyphen / U+2800 盲文空白。
  --    ⇒ 上游 log 記 `req-1<ZWJ>`、我們稽核寫 `req-1` ⇒ **兩邊對不起來**;
  --      更糟的是 `req-1<ZWJ>` 與 `req-1` 會被**摺成同一個值** ⇒ 兩筆不同的請求在稽核上變成同一筆。
  --    📌 **一道為了擋髒東西而裝的閘, 順手改寫了它本來只該檢查的東西。**
  --       而改寫在資料上看不出來 —— 稽核欄位裡躺著一個「乾淨」的值, 沒有任何訊號說它被動過。
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
    NULL, p_request_id, 'admin'
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
  -- 🔴 **長度不是集合** —— ~~原本只驗 `char_length` 是 31 / 7~~ 作廢(codex 關卡2 nit-C, 2026-08-28):
  --    兩個碼位**互換**之後長度不變 ⇒ 白名單已經錯了而斷言照樣過。
  --    📌 **一把只數個數的尺, 對「換掉一個成員」完全失明 —— 而那正是抄錯常數最可能的形狀。**
  --    ⇒ 改成釘住**整個集合的雜湊**;長度仍一起印, 因為它說得出「差在哪個方向」。
  IF pg_catalog.char_length(v_ws) <> 31 OR pg_catalog.char_length(v_zw) <> 7
     OR pg_catalog.md5(v_ws || v_zw) <> '006aaa7db32b350462cd99625d9c466c' THEN
    RAISE EXCEPTION '斷言 字元集:不是預期那一份(v_ws 長 %,v_zw 長 %,md5 %)',
      pg_catalog.char_length(v_ws), pg_catalog.char_length(v_zw), pg_catalog.md5(v_ws || v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_update_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  -- 🔴🔴 **`v_req` 只用來【判斷是不是全空白】, 不拿它去寫稽核**
  --    (codex 關卡2 F5, 2026-08-28;原本三支的稽核欄位都塞正規化後的那個變數, 作廢)
  --    🔴 **這句話刻意【不寫出那個舊字面】** —— 下方碼錨用字面比對來抓它,
  --       而一句描述它的註解會被那道錨數進去 ⇒ 實測 apply 直接紅在這裡。
  --       📌 **記錄缺口的註解, 會被偵測缺口的量具當成缺口本身。**
  --    `request_id` 是**上游給的 correlation key, 對我們是不透明的**。`btrim` 不是驗證, 是**改寫**:
  --    它會吃掉合法地位於頭尾的 ZWJ / ZWNJ / soft hyphen / U+2800 盲文空白。
  --    ⇒ 上游 log 記 `req-1<ZWJ>`、我們稽核寫 `req-1` ⇒ **兩邊對不起來**;
  --      更糟的是 `req-1<ZWJ>` 與 `req-1` 會被**摺成同一個值** ⇒ 兩筆不同的請求在稽核上變成同一筆。
  --    📌 **一道為了擋髒東西而裝的閘, 順手改寫了它本來只該檢查的東西。**
  --       而改寫在資料上看不出來 —— 稽核欄位裡躺著一個「乾淨」的值, 沒有任何訊號說它被動過。
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
    v_code, p_request_id, 'admin'
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
  -- 🔴 **長度不是集合** —— ~~原本只驗 `char_length` 是 31 / 7~~ 作廢(codex 關卡2 nit-C, 2026-08-28):
  --    兩個碼位**互換**之後長度不變 ⇒ 白名單已經錯了而斷言照樣過。
  --    📌 **一把只數個數的尺, 對「換掉一個成員」完全失明 —— 而那正是抄錯常數最可能的形狀。**
  --    ⇒ 改成釘住**整個集合的雜湊**;長度仍一起印, 因為它說得出「差在哪個方向」。
  IF pg_catalog.char_length(v_ws) <> 31 OR pg_catalog.char_length(v_zw) <> 7
     OR pg_catalog.md5(v_ws || v_zw) <> '006aaa7db32b350462cd99625d9c466c' THEN
    RAISE EXCEPTION '斷言 字元集:不是預期那一份(v_ws 長 %,v_zw 長 %,md5 %)',
      pg_catalog.char_length(v_ws), pg_catalog.char_length(v_zw), pg_catalog.md5(v_ws || v_zw);
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_delete_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  -- 🔴🔴 **`v_req` 只用來【判斷是不是全空白】, 不拿它去寫稽核**
  --    (codex 關卡2 F5, 2026-08-28;原本三支的稽核欄位都塞正規化後的那個變數, 作廢)
  --    🔴 **這句話刻意【不寫出那個舊字面】** —— 下方碼錨用字面比對來抓它,
  --       而一句描述它的註解會被那道錨數進去 ⇒ 實測 apply 直接紅在這裡。
  --       📌 **記錄缺口的註解, 會被偵測缺口的量具當成缺口本身。**
  --    `request_id` 是**上游給的 correlation key, 對我們是不透明的**。`btrim` 不是驗證, 是**改寫**:
  --    它會吃掉合法地位於頭尾的 ZWJ / ZWNJ / soft hyphen / U+2800 盲文空白。
  --    ⇒ 上游 log 記 `req-1<ZWJ>`、我們稽核寫 `req-1` ⇒ **兩邊對不起來**;
  --      更糟的是 `req-1<ZWJ>` 與 `req-1` 會被**摺成同一個值** ⇒ 兩筆不同的請求在稽核上變成同一筆。
  --    📌 **一道為了擋髒東西而裝的閘, 順手改寫了它本來只該檢查的東西。**
  --       而改寫在資料上看不出來 —— 稽核欄位裡躺著一個「乾淨」的值, 沒有任何訊號說它被動過。
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
    NULL, NULL, p_request_id, 'admin'
  );

  RETURN 'DELETED';
END;
$$;
-- ── 5e. list ── 🔴🔴 **把 `FOR SHARE` 從唯讀路徑上拿掉**(codex 關卡2 F3+F4, 2026-08-28)
-- ~~片1 為了補 TOCTOU 在 `list` 也加了 `SELECT … FOR SHARE`~~ **作廢, 而它是【修錯了問題】**:
--   ① 取列鎖需要可寫交易 ⇒ **唯讀交易呼叫 list 會直接報錯**(不是慢, 是不能用)
--   ② list 是最常被呼叫的那一支, 它一鎖住 staff 那一列, **停用/降級某個員工就得排隊等它**
--   ③ 寫入路徑是 staff→view, 而任何 view→staff 的路徑碰上 list 就構成反向鎖序 ⇒ 死結面
-- 📌 **原本要修的是「看到舊身分」, 而我拿了一個【寫入路徑】的工具去修一條【讀取路徑】。**
--    那個工具在寫入路徑上是對的 —— 它只是不屬於這裡。
-- ✅ 改法:身分閘**不取鎖**;而把「他現在還是 active 嗎」**塞進同一句內容查詢**裡 ——
--    單一 SQL 語句 = 單一 snapshot ⇒ 身分與內容再也不會來自兩個不同的時點。
--    ⚠️ 殘餘行為要寫明、不要藏:閘與查詢之間被停用 ⇒ 他拿到的是**空清單**, 不是例外。
--       ⇒ **不再外洩**(原本的病), 而「例外 vs 空清單」這個差別只在那個微秒窗內看得到。
-- 🔴🔴 **而上面那句【寫得比事實窄】, 這一段是 codex R2-2 逼出來的更正**:
--    「同一句 = 同一 snapshot」只保證**這一句內部**一致, **不保證那個 snapshot 是最新的**。
--    ⇒ `REPEATABLE READ` / `SERIALIZABLE` 的長交易先取得 snapshot ⇒ 管理者停用並提交
--      ⇒ 那個舊交易之後呼叫 `list`, **身分閘與 EXISTS 兩邊都看得到「他還是 active」** ⇒ 照樣回傳。
--    ⇒ **殘餘風險不是「微秒窗」, 是「那個交易活多久」** —— 兩者差幾個數量級。
--    📌 **我把一個【隔離層級決定的窗】寫成了一個【時間長度決定的窗】** ——
--       而寫窄的殘餘風險比不寫更糟:它讓下一個人以為這一格已經被想過了。
--    ✅ 現況接受這個殘餘。
--    🔴 **而「後台呼叫端是短交易的 READ COMMITTED、不開長交易」是【推出來的, 不是量到的】**
--       (R5 2026-08-28;照 `00-work-rules` §6-b 第 3 條標「未確認」並附**缺哪一道檢查**)。
--       · 缺的那道 = **沒有人量過呼叫端的隔離層級與交易長度**。
--       · 而它現在量不到的理由很直白:**repo 內目前零個 TS 呼叫端**
--         (R5 grep 過 `apps/` 與 `packages/`)—— 這幾支 RPC 還沒接到任何畫面上。
--       ⇒ 📌 **這句話今天為真的理由是「沒有呼叫端」, 不是「呼叫端很乖」** ——
--          而接上去的那一刻, 它就變成一個沒有人驗過的假設。
--       ⇒ 接呼叫端的那一片要**重新量這一格**, 不得沿用本句。
--       若哪天要求「停用立即生效」, 那不是這一支能解的, 要另設撤權協定(session 失效 / token 版本號)。
CREATE OR REPLACE FUNCTION public.admin_list_saved_order_views(p_actor text)
RETURNS TABLE (
  id bigint, staff_id text, is_shared boolean,
  label text, query text, date_preset text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 身分閘。通用拒絕訊息:不區分「沒這個人」與「停用了」,兩者印同一句。
  -- ⚠️ **這裡沒有 FOR SHARE, 而那是刻意的** —— 見本節開頭。
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 內容閘:自己的 + 共用的(Q-檢視-1 = 乙)。
  -- 🔴 `EXISTS` 那一句與外層在**同一個語句**裡 ⇒ 同一 snapshot ⇒ 身分不會比內容舊。
  RETURN QUERY
    SELECT v.id, v.staff_id, v.is_shared, v.label, v.query, v.date_preset,
           v.created_at, v.updated_at
      FROM public.admin_saved_order_views v
     -- ⚠️ 這一句【不需要】COALESCE(與 update/delete 那兩道不同):staff_id IS NULL 時
     --    is_shared 必為 true ⇒ `NULL OR true` = true ⇒ 共用列照樣看得到;
     --    而別人的私人列是 false OR false = false ⇒ 濾掉。**同一個 NULL, 在 WHERE 與 IF 裡下場不同。**
     WHERE (v.staff_id = p_actor OR v.is_shared)
       AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active)
     ORDER BY v.is_shared, pg_catalog.btrim(v.label), v.id;
END;
$$;

-- ── 6.
-- ── 斷言(同交易;只驗本支動到的)──────────────────────────────────────────
DO $assert$
DECLARE
  v_def   text;
  -- 🔴🔴 **碼錨要量【碼】, 不要量註解**(2026-08-28 折 codex F3/F5 時連踩兩次)——
  --    `pg_get_functiondef` 回的是**含註解的全文**;而我在函式體裡寫一句
  --    「這裡沒有 XXX, 那是刻意的」, 那道「XXX 不得出現」的錨就咬住了那句話本身。
  --    兩次都紅在 apply、兩次都是**我寫的解釋**被我自己的尺讀成了缺陷。
  --    📌 **記錄缺口的註解, 會被偵測缺口的量具當成缺口本身** —— 而它印的紅與真的缺陷一模一樣。
  --    ⇒ 根治不是「換句話說」(那要每次都記得), 是**把註解從量測對象裡剝掉**。
  --    ⚠️ 剝法的射程要寫明(R5 2026-08-28 補了漏掉的那一半):
  --       · 它只剝 `--` 行註解, **不剝 `/* */`** —— 本片沒有用到後者。
  --       · 🔴 **也不分辨【字串常值裡的 `--`】** —— 一個字面值裡出現 `--`
  --         會讓**同一行後半從 `v_code` 消失**。
  --       ⇒ 而本段有兩個【負向】錨(`稽核不得正規化` 要求某字面**不得出現**、
  --         `list無鎖` 要求 `FOR SHARE` **不得出現**)⇒ 少看到東西 = **靜默轉綠**。
  --       📌 **正向錨壞掉會吵(它找不到就叫), 負向錨壞掉會安靜 —— 同一個 bug, 兩個方向。**
  --       ✅ R5 掃過本片, **今天零命中**;而這是「現在沒有」不是「不會有」
  --         ⇒ 哪天有人在字面值裡寫 `--`, 這兩道錨會安靜地放行。
  v_code  text;
  v_n     integer;
  v_pa    integer;
  v_pb    integer;
  v_sig   text;
  v_write text;
  v_seq   text;
  v_acl   aclitem[];
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
    v_code := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
    IF position('p_request_id IS NULL' in v_code) = 0 THEN
      RAISE EXCEPTION '碼錨 NULL閘:% 沒有 p_request_id 的 NULL 閘;拒繼續', r.sig;
    END IF;
    -- 🔴🔴 **這兩道的方向在 codex 關卡2 F5 之後【對調了】, 不是微調** ——
    --    ~~原本:稽核必須寫 `v_req`(正規化後), 且不得留著原樣的 `p_request_id`~~ **作廢**。
    --    現在:**稽核必須寫原值 `p_request_id`**, 而 `v_req` 只准出現在判空那一句。
    --    📌 **一組寫得很嚴謹的斷言, 可以把一個錯的方向鎖得死死的** ——
    --       它們原本每一發突變都咬得住, 而咬住的是「有沒有照我想的做」, 不是「這樣做對不對」。
    IF position('p_request_id, ''admin''' in v_code) = 0 THEN
      RAISE EXCEPTION '碼錨 稽核原值:% 的稽核沒有寫原值 p_request_id(F5 之後方向反過來);拒繼續', r.sig;
    END IF;
    IF position('v_req, ''admin''' in v_code) <> 0 THEN
      RAISE EXCEPTION '碼錨 稽核不得正規化:% 的稽核還寫著正規化後的值(會摺掉合法的 correlation key);拒繼續', r.sig;
    END IF;
    -- 而「判空那一句還在不在」也要單獨驗:只留原值而把閘刪掉 ⇒ 全空白照樣寫進 NOT NULL 欄位。
    IF position('去空白後為空' in v_code) = 0 THEN
      RAISE EXCEPTION '碼錨 判空閘:% 少了「去空白後為空」那道閘;拒繼續', r.sig;
    END IF;
    -- 字元集雜湊釘住(nit-C):長度換成雜湊之後, 碼錨也要跟著改, 否則它還在錨舊字面。
    IF position('006aaa7db32b350462cd99625d9c466c' in v_code) = 0 THEN
      RAISE EXCEPTION '碼錨 字元集錨:% 沒有釘住字元集雜湊;拒繼續', r.sig;
    END IF;
  END LOOP;

  -- E. 🔴🔴 **釘住 identity sequence 的 ACL**(codex 關卡2 F6;主視窗 2026-08-28 裁「降級成偵測」)
  --    codex 要的根治是 `ALTER DEFAULT PRIVILEGES … ON SEQUENCES` ——
  --    而那會影響 public schema 底下**所有人之後建的東西** ⇒ 跨線、跨窗 ⇒ 不是這一片能拍的。
  --    ✅ 裁決:**不改 schema 預設, 改裝一道會叫的尺**。
  --       風險的真實形狀是「以後有人重建那顆 sequence ⇒ 權限鬆回去, **而沒有人會知道**」
  --       ⇒ 📌 **那是一個偵測問題, 不是一個授權問題。**
  --    🔴 **根因仍在, 這一格只是讓它不再安靜** —— 板列已開,不得標成「已解決」。
  v_seq := pg_get_serial_sequence('public.admin_saved_order_views', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION '斷言 seqACL:找不到 identity sequence(id 欄不是 identity?);拒繼續';
  END IF;
  SELECT c.relacl INTO v_acl FROM pg_class c WHERE c.oid = v_seq::regclass;
  -- 🔴🔴 **`relacl` 是 NULL 時 PUBLIC 在這一欄裡【看不見】**
  --    (照 `docs/patterns/revoking-function-execute-in-supabase.md`)——
  --    NULL 代表「這一格從來沒被明確設定過, 套用的是內建預設」, 而它與「我 REVOKE 乾淨了」
  --    在「壞東西在不在 ACL 裡」這個問法下**印同一個答案**。
  --    📌 **一把只會問「有沒有壞東西」的尺, 對【這一格根本沒被設定過】完全失明。**
  --    ⇒ 先分開這兩個世界, 再談乾不乾淨。
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '斷言 seqACL:% 的 relacl 是 NULL —— 分不出「乾淨」與「從來沒被設定過」;拒繼續', v_seq;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_acl) a WHERE a::text LIKE '=%') THEN
    RAISE EXCEPTION '斷言 seqACL:% 對 PUBLIC 有授權(ACL %);拒繼續', v_seq, v_acl::text;
  END IF;
  FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role']) AS who LOOP
    IF has_sequence_privilege(r.who, v_seq, 'USAGE')
       OR has_sequence_privilege(r.who, v_seq, 'SELECT')
       OR has_sequence_privilege(r.who, v_seq, 'UPDATE') THEN
      RAISE EXCEPTION '斷言 seqACL:% 對 % 還有權限(ACL %);拒繼續', v_seq, r.who, v_acl::text;
    END IF;
  END LOOP;

  -- A-2. 🔴 list 身上**不得**再有 FOR SHARE(codex F3)——
  --    這一格的存在理由:改法是「拿掉一句」, 而**拿掉的東西不會在 diff 以外的任何地方留下形狀**。
  --    ⇒ 下一個人為了修某個 race 再把它加回來時, 只有這道錨會叫。
  v_def := pg_get_functiondef('public.admin_list_saved_order_views(text)'::regprocedure);
  v_code := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
  IF position('FOR SHARE' in v_code) <> 0 THEN
    RAISE EXCEPTION '碼錨 list無鎖:list 又出現 FOR SHARE(唯讀路徑不得取列鎖;見 5e 節);拒繼續';
  END IF;
  IF position('AND EXISTS (SELECT 1 FROM public.staff' in v_code) = 0 THEN
    RAISE EXCEPTION '碼錨 list同源:list 少了同一 snapshot 的 EXISTS 身分條件;拒繼續';
  END IF;

  -- B. search_path 沒有在 CREATE OR REPLACE 時掉了(它是逐支設定的, 不會自動繼承)
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_create_saved_order_view','admin_update_saved_order_view',
                       'admin_delete_saved_order_view','admin_list_saved_order_views')
     AND p.proconfig @> ARRAY['search_path=public, pg_temp'];
  IF v_n <> 4 THEN
    RAISE EXCEPTION '斷言 B:search_path 逐支設定不足(期望 4,實得 %)', v_n;
  END IF;

  -- C. EXECUTE 權限沒有因為 CREATE OR REPLACE 而重置
  --    🔴 CREATE OR REPLACE **保留**既有 ACL, 而【新建】會套用 default ACL ——
  --       所以這一格在「函式本來就在」與「它其實是新建的」兩個世界會印不同的東西。
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_create_saved_order_view(text, text, text, text, boolean, text, text)',
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)',
      'public.admin_list_saved_order_views(text)']) AS sig
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
  --    本支重建了**四支** SECURITY DEFINER 函式(含 5e 的 list)⇒ 那個前提對四支都要成立,
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
    v_code := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
    v_pa := position('WHERE s.id = p_actor AND s.is_active' in v_code);
    v_pb := position(v_write in v_code);
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
    -- 🔴 這裡數的是 `v_code`(剝掉註解)不是 `v_def`(R3 nit, 2026-08-28)——
    -- 本段開頭立的規矩就是「碼錨要量碼不量註解」, 而**同一個迴圈裡只套了一半**:
    -- 位置判定改用 v_code 了, 計數這一格還在數含註解的全文
    -- ⇒ 一句提到 `INSERT INTO public.admin_saved_order_views` 的解釋會讓它數成 2。
    -- 📌 **一課學了一半, 在 diff 上與學完了長得一樣。**(現況是假紅方向, 吵、不啞。)
    v_n := (pg_catalog.length(v_code)
            - pg_catalog.length(pg_catalog.replace(v_code, v_write, '')))
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
    v_code := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
    IF position('FOR UPDATE' in v_code) = 0 THEN
      RAISE EXCEPTION '碼錨 鎖列:% 沒有 FOR UPDATE;換路的核心不見了, 拒繼續', r.sig;
    END IF;
    IF position('FOR UPDATE' in v_code)
       >= position(CASE WHEN r.sig LIKE '%update%' THEN 'UPDATE public.admin_saved_order_views'
                        ELSE 'DELETE FROM public.admin_saved_order_views' END in v_code) THEN
      RAISE EXCEPTION '碼錨 鎖列順序:% 的 FOR UPDATE 不在寫入之前;拒繼續', r.sig;
    END IF;
  END LOOP;


  -- 🔴 ~~原本這裡還有一段 `D-2. 鎖列錨`~~ —— **刪掉了**(R3 nit, 2026-08-28)。
  --    它與上面的 7f-2 是**同一道錨貼了兩次**, 而 7f-2 還多驗了順序 ⇒ D-2 是真子集。
  --    📌 **兩份一模一樣的守門, 不會多擋住任何東西, 只會讓「共有幾道」這個數字變假。**
  --    (突變 M21 仍由 7f-2 抓到, 訊息字面不變 ⇒ runner 的 want 不用改。)

  -- 🔴 這一行列的是【實際執行序】, 不是字母序(R5 nit, 2026-08-28)——
  -- 原本寫 A/A-2/B/C/C-2/D/E, 而 E 其實排在 A 之後、A-2 之前, 且 7f / 7f-2 根本沒列名。
  -- 📌 **一行「全過」的清單少列兩道, 讀的人會以為那兩道不存在** —— 而它們正在守著。
  RAISE NOTICE '片1a 斷言全過(A → E → A-2 → B → C → C-2 → D/7f → 7f-2)';
END;
$assert$;

COMMIT;
