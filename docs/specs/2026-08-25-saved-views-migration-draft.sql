-- ============================================================================
-- 🛑🛑 這是【草稿】,不是 migration。**不要移進 supabase/migrations/。**
-- ============================================================================
-- 檔名刻意不帶時間戳前綴 ⇒ 任何「把 pending migration 套上去」的動作掃不到它。
-- 🔴 理由(2026-08-28 主視窗逐字):今晚有前例 —— 一支帶著未折 findings 的 migration
--    進了版控,而任何「把 pending migration 套上去」的動作都會掃到它,**禁令只寫在註解裡**。
--    ⇒ 所以本片的禁令不寫在註解裡,寫在【檔案放在哪】。註解只是說明。
--
-- 來源規格 docs/specs/2026-08-25-saved-views-plan.md
--   權威 = 該檔 §14-Z「現行設計事實表」。本檔任何一格與它不合 ⇒ **以它為準,回來改本檔**。
-- 擋門:🔴 **B-0 已於 2026-08-28 三態全綠**(plan 定稿 / Sean `Q34 = 批` / code 落地)。
--   落地實情(當場量的):`apps/admin/src/lib/staff-actions.ts:105/:156/:222` 三個呼叫端;
--   定義在 `apps/admin/src/lib/staff.ts:194` `row?.is_active === true && row.is_manager === true`。
--   ⚠️ 而**本片仍不得 apply**:`Q34` 批的是【線B 的 plan】, 不是本片的;
--      本片的鐵則 8 從來沒有端過 ⇒ **技術面沒東西擋著, 流程面還沒有人說可以動。**
--   🔴 而這一行的前一版寫「上游還沒定案」—— 那句在 B-0 落地之後就過期了,
--      **而它不會自己說一聲**。(2026-08-28 我是因為一發突變打到這行才發現的。)
--
-- 拍板保真(主視窗 2026-08-28 指示:寫題號要附當下答案字面,今晚兩次保真出事都是題號還在而內容變了):
--   Q-檢視-1  = 乙  「自己的 + 共用的都有」            (Sean)
--   Q-檢視-2  = 甲  「存相對日期、多存一欄」          🔴 **主視窗 -5b 決定,Sean 沒被問過**
--   Q-檢視-3  = 乙  「共用一份【沒有主人】的」        (Sean)
--   Q-檢視-9  = 甲  「不限制數量」                     (Sean;零程式碼)
--   Q-檢視-10 = 丙  「各人各排」⇒ 順序住不進本表 ⇒ 另開片1b
--   Q-檢視-13 = 甲  「離職員工的私人檢視藏起來、資料留著」⇒ 零表格改動
--   q17       = 甲  「owner 照現況 postgres」          (Sean 逐字)
--   q31       = 甲  「後改的贏 —— 存進去,而畫面告訴他【有人剛改過】」(Sean 逐字)
--   Q-檢視-8  / Q-檢視-12  🛑 **仍未答** ⇒ 擋片3 / 片2,**不擋本片**
-- ============================================================================

BEGIN;

-- ── 1. 表 ────────────────────────────────────────────────────────────────────
CREATE TABLE public.admin_saved_order_views (
  -- 🔴 id 用 identity 不用 uuid,而理由不是主鍵形式(§14-13 R2-2):
  --    sequence 的 nextval **不受交易回滾影響** ⇒ 對一個【應該被拒絕】的呼叫比對前後 last_value:
  --      閘在寫入之前 ⇒ INSERT 沒跑過 ⇒ last_value 不動
  --      閘在寫入之後 ⇒ INSERT 跑過了 ⇒ last_value +1(而交易照樣回滾)
  --    ⇒ **它是本片唯一一個熬得過回滾、證明得了執行順序的觀察點。**
  --    ⚠️ 換回 uuid ⇒ 那個觀察點消失,而**測試不會紅**(它只是從此證不到東西)。
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Q-檢視-3 = 乙「共用一份沒有主人的」⇒ NULL = 共用,不是資料缺漏。
  -- ⚠️ ON DELETE 不設 CASCADE:staff 停用走 is_active=false、不物理刪除(staff 表註解 :27)。
  staff_id      text        REFERENCES public.staff(id),

  -- §14-18 S-2 挑了這一種(不用獨立 boolean 欄):它算出來的,寫不進去,
  -- ⇒ 「staff_id 有主人而 is_shared=true」這種自相矛盾的列**構造不出來**。
  -- ✅ 2026-08-28 拋棄式 PG 17.10 實測(§14-20):可單獨索引 / 可進部分唯一索引 / 可當部分索引的條件;
  --    而 INSERT 與 UPDATE 各一發都 ERROR ⇒ 「它寫不進去」是量到的,不是讀來的。
  is_shared     boolean     GENERATED ALWAYS AS (staff_id IS NULL) STORED,

  label         text        NOT NULL,
  query         text        NOT NULL,          -- 那段 query string(不含 `?`)

  -- Q-檢視-2 = 甲「存相對日期」⇒ 存 preset 的 key(例 'this_week'),讀回來當天重算。
  -- 🔴 這一格的作者是主視窗 -5b,**不是 Sean 的拍板**(他逐字「我看不懂,你決定」)。
  --    ⚠️ 而 Q-檢視-12(固定期間 / 每次算最新)**仍未答** ⇒ 那題會決定這一欄的語意,
  --       但不會決定這一欄存不存在 ⇒ 所以它擋片2、不擋本片。
  date_preset   text,

  -- create 的重播判定用。全域唯一即可(client 產的 uuid),不綁 staff_id
  -- ⇒ 避開 staff_id 可為 NULL 帶來的 NULLS DISTINCT 問題。
  idempotency_key text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saved_view_label_nonempty CHECK (pg_catalog.btrim(label) <> ''),
  CONSTRAINT saved_view_label_len      CHECK (pg_catalog.char_length(label) <= 40),
  CONSTRAINT saved_view_label_noctrl   CHECK (label !~ '[[:cntrl:]]'),
  CONSTRAINT saved_view_query_len      CHECK (pg_catalog.char_length(query) <= 2048),
  CONSTRAINT saved_view_preset_len     CHECK (date_preset IS NULL
                                              OR pg_catalog.char_length(date_preset) <= 64)
);

COMMENT ON TABLE public.admin_saved_order_views IS
  'M-4b 後台訂單「儲存的檢視」。staff_id IS NULL = 共用(Q-檢視-3=乙);is_shared 是算出來的、寫不進去。讀寫唯一路 = 四支 SECURITY DEFINER RPC;本表零 GRANT。';

-- 🔴 兩個【部分】唯一索引,不是一個 (staff_id, label)。
--    成因:staff_id 可為 NULL,而 Postgres 預設 NULLS DISTINCT ⇒ 多個 NULL 互不相等
--    ⇒ 單一複合唯一索引**擋不住兩張同名的共用檢視**。
--    ✅ §14-20 實測:換成兩個部分唯一索引之後,§7-5 那條「NULLS DISTINCT」的難題不成題了
--       —— 它不是被解決的,是被換一個形狀之後消失的。
CREATE UNIQUE INDEX admin_saved_order_views_private_label_idx
  ON public.admin_saved_order_views (staff_id, pg_catalog.btrim(label))
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX admin_saved_order_views_shared_label_idx
  ON public.admin_saved_order_views (pg_catalog.btrim(label))
  WHERE staff_id IS NULL;

CREATE UNIQUE INDEX admin_saved_order_views_idem_idx
  ON public.admin_saved_order_views (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX admin_saved_order_views_owner_idx
  ON public.admin_saved_order_views (staff_id);

-- ── 2. updated_at touch trigger ──────────────────────────────────────────────
-- 🔴 它的身分是【功能交付物】,不是防護(§14-19 MF-5)。
--    沒有它 ⇒ update 那支永遠比不出「有人在你之前改過」⇒ **那句提示永遠不會出現**。
--    📌 而【永遠不會出現的提示】與【沒有人改過】在畫面上是同一件事
--       ⇒ 它不會壞掉、不會報錯、不會有人回報 —— 它只是安靜地從來不亮。
CREATE OR REPLACE FUNCTION public.admin_saved_order_views_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 🔴 clock_timestamp() 不是 now() —— 而這不是風格選擇:
  --    `now()` = **交易開始時刻**, 在同一個交易裡是常數
  --    ⇒ 同一交易內改兩次, 兩次的 updated_at 【完全相同】
  --    ⇒ 「有人剛改過」這個比較恆為 false ⇒ **UPDATED_OVERWROTE 永遠不會出現。**
  --    📌 而 §14-19 已經寫過這一格的形狀:【永遠不會出現的提示】與【沒有人改過】
  --       在畫面上是同一件事 —— 換 now() 回去不會有任何東西紅, 它只會安靜地從此不亮。
  --    ⚠️ 2026-08-28 寫測試時撞到:T9-② 期望 UPDATED_OVERWROTE 實得 UPDATED。
  --       而**若當時把兩發改動拆成兩個交易, now() 會過** ⇒ 那個洞會留到線上、
  --       只在「一個請求裡改兩次」時發作, 而那時沒有人在看。
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_saved_order_views_set_updated_at
  BEFORE UPDATE ON public.admin_saved_order_views
  FOR EACH ROW EXECUTE FUNCTION public.admin_saved_order_views_touch_updated_at();

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_saved_order_views ENABLE ROW LEVEL SECURITY;
-- 🔴 兩層各擋各的一半,寫死免得下一個人把它們合併:
--    RLS   擋【直連 DB 的 anon / authenticated】
--    GRANT 擋【service_role】—— 它有 BYPASSRLS ⇒ **RLS 對它零判別力**
--    ⇒ 不要以為 ENABLE ROW LEVEL SECURITY 就把 service_role 也擋住了。
--    📌 一道閘可以正確運作,而把流量推向自己的盲區。
-- 不建任何 policy(deny-all)。讀寫唯一路 = 下面四支 SECURITY DEFINER RPC。

-- ── 4. 表權限:零 GRANT ──────────────────────────────────────────────────────
-- ⚠️ 新物件出生就自帶 anon / authenticated / service_role 的完整預設權限
--    (2026-08-14 正式庫實測 pg_default_acl:四個角色各 arwdDxtm)
--    ⇒ repo 內零 GRANT 字面可掃、三綠不會紅 ⇒ **REVOKE 是必要的,不是保險。**
REVOKE ALL ON TABLE public.admin_saved_order_views
  FROM PUBLIC, anon, authenticated, service_role;
-- 🔴 這裡【不 GRANT 任何表權限給任何角色】,連 service_role 的 SELECT 都不給(§14-12-h)。
--    理由:給了裸 SELECT ⇒ 誰讀得到別人的私人檢視由【app 記不記得加 where】決定
--         ⇒ **那不是閘,是過濾** —— 而過濾漏一次私有性就沒了,**而畫面不會告訴任何人**。
--    代價:後台任何地方要讀檢視都得經過 RPC,多一層。**接受**(私有性是 trust boundary,不簡化)。

-- ============================================================================
-- 5. 四支 RPC(§14-15 換路:建與改分家;寫入形狀抄 20260717010000 的 FOR UPDATE 鎖列)
-- ============================================================================
-- 🔴 換路的理由不是「那個形狀比較好」,是我連兩輪都在同一個位置犯錯:
--    我一直在【設計一個新的寫入形狀】,而這個 repo 已經有一個被 51 支 migration 磨過的形狀。
-- ❌ 作廢:INSERT … ON CONFLICT (staff_id, label) DO UPDATE —— 那是發明的,不得復活。
--
-- 授權形狀(§14-12-d,而閘表已隨換路分家):
--   Sean 拍的「只有管理者」**只管共用檢視** ⇒ 私人檢視是每個員工自己的,不歸管理者管。
-- 🔴 UI 層【不做授權閘】(§14-12-e B-9)⇒ 授權只住在這四支裡。
--    日後若有人加 UI 層閘,它**不得**變成第二個權威 —— 只能是「先擋一次省一趟往返」,
--    **RPC 那道照樣要跑。**
--
-- 🔴🔴 `is_manager` 這一欄現在【同時背兩個語意】 ⇒ backlog ⟦b4-MGR0-SEM⟧(線B 2026-08-28 指出)
--    它出生是為了【成本遮蔽】(建表 migration `20260726120000_m4b_e8a1_staff_table.sql:28-29` 逐字),
--    而那一片還沒做;線B 的管理者寫入閘把它改嫁成【權限閘】⇒ 兩個語意綁同一顆布林。
--    ⇒ 成本遮蔽片動工時可能決定【拆成兩欄】⇒ 那一天這四支 RPC 與線B 的閘**要一起改**,
--      而它們現在沒有任何東西把彼此綁著。
--    📌 這一行就是那條繩子。拆欄的人搜 ⟦b4-MGR0-SEM⟧ 才找得到兩邊。
--
-- ⚠️ 而這四支讀到的 `is_manager`,**不保證是經過線B 那道閘寫進去的**:
--    Sean `Q15 = 甲`「不鎖 DB 層」⇒ `staff_table.sql:72` 的
--    `GRANT UPDATE (label, is_manager, is_active) ... TO service_role` **留著**
--    ⇒ 任何人寫一支腳本仍改得動那一欄。**他讀過這個代價後選擇不鎖。**
--    ⇒ 對本片的意義:我們的授權**上限**就是那一欄的可信度, 而它不是我們控制的。
--
-- 🔴 update / delete 兩支的【執行順序】目前沒有任何測試證明得了(§14-Z 殘餘風險 ②)——
--    identity sequence 那個熬過回滾的觀察點,只有 create 那支會 nextval。
--    那兩支靠的是:position 碼錨(絆線,防手滑重排)+ 人審。
--    📌 **而 create 那支【是】證得了的 ⇒ 三支沒有 ≠ 四支都沒有。**
--    ⚠️ 我**不加**「為了測試而 PERFORM nextval」的東西 —— 那是為了量具改產品碼。
--    🛑 這一格是殘餘風險,**不由線C 自宣接受**;主視窗要看見它。

-- ── 5a. list ────────────────────────────────────────────────────────────────
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
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active
  ) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 內容閘:自己的 + 共用的(Q-檢視-1 = 乙)。
  -- 🔴 Q-檢視-13 = 甲「離職員工的私人檢視藏起來、資料留著」⇒ 靠 v.staff_id = p_actor 這一句自然成立:
  --    離職者不再是 actor ⇒ 沒有人的 p_actor 等於他 ⇒ 他的私人檢視誰都看不到,而列還在。
  RETURN QUERY
    SELECT v.id, v.staff_id, v.is_shared, v.label, v.query, v.date_preset,
           v.created_at, v.updated_at
      FROM public.admin_saved_order_views v
     -- ⚠️ 這一句【不需要】COALESCE(與 update/delete 那兩道不同):staff_id IS NULL 時
     --    is_shared 必為 true ⇒ `NULL OR true` = true ⇒ 共用列照樣看得到;
     --    而別人的私人列是 false OR false = false ⇒ 濾掉。**同一個 NULL, 在 WHERE 與 IF 裡下場不同。**
     WHERE v.staff_id = p_actor OR v.is_shared
     ORDER BY v.is_shared, pg_catalog.btrim(v.label), v.id;
END;
$$;

-- ── 5b. create ──────────────────────────────────────────────────────────────
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
  v_is_manager boolean;
  v_label      text;
  v_id         bigint;
BEGIN
  -- 身分閘(碼錨 A 的字面就是下面這一句 WHERE)。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
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
    -- 撞【重播鍵】= 同一個請求送了兩次 ⇒ 冪等回應,不是錯誤。
    IF SQLERRM LIKE '%admin_saved_order_views_idem_idx%' THEN
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
    IF SQLERRM LIKE '%admin_saved_order_views_private_label_idx%'
       OR SQLERRM LIKE '%admin_saved_order_views_shared_label_idx%' THEN
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

-- ── 5c. update ──────────────────────────────────────────────────────────────
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
  v_is_manager boolean;
  v_before     public.admin_saved_order_views%ROWTYPE;
  v_label      text;
  v_code       text;
BEGIN
  -- 身分閘(碼錨 A)。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
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

  UPDATE public.admin_saved_order_views
     SET label       = v_label,
         query       = COALESCE(p_query, query),
         date_preset = COALESCE(p_date_preset, date_preset)
   WHERE id = p_view_id;

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

-- ── 5d. delete ──────────────────────────────────────────────────────────────
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
  v_is_manager boolean;
  v_before     public.admin_saved_order_views%ROWTYPE;
BEGIN
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
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

-- ── 6. owner + EXECUTE 權限 ─────────────────────────────────────────────────
-- 🔴 q17 = 甲 —— owner 照現況 postgres。而**代價 Sean 讀過**,所以它寫在這裡不是只寫在 plan:
--    選 owner = postgres 不是【沒問題】,是【這個風險整個 repo 一起承擔,不是這一片自己解】。
--    函式體內任何未來的錯誤,爆炸半徑是整個資料庫。與 repo 既有 18 處一致。
-- 📌 一個被接受的風險,與一個沒有人看見的風險,在碼上是同一行 —— 差別只在這段註解在不在。
ALTER TABLE public.admin_saved_order_views OWNER TO postgres;
ALTER FUNCTION public.admin_list_saved_order_views(text) OWNER TO postgres;
ALTER FUNCTION public.admin_create_saved_order_view(text, text, text, text, boolean, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.admin_delete_saved_order_view(text, bigint, text) OWNER TO postgres;
ALTER FUNCTION public.admin_saved_order_views_touch_updated_at() OWNER TO postgres;

-- ⚠️ 函式的 EXECUTE 預設會給 PUBLIC,而 Supabase 的 default ACL 另外給 service_role
--    ⇒ **兩道 REVOKE 都要下**(memory reference_supabase-service-role-execute-default-grant)。
REVOKE ALL ON FUNCTION public.admin_list_saved_order_views(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_saved_order_view(text, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_saved_order_view(text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_saved_order_views_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_list_saved_order_views(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_saved_order_view(text, text, text, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_saved_order_view(text, bigint, text) TO service_role;
-- ⚠️ touch trigger 那支**不 GRANT** —— trigger 由 owner 身分執行,呼叫端不需要 EXECUTE。

-- ============================================================================
-- 7. 斷言區(同交易;任何一條不成立 ⇒ RAISE ⇒ 整支回滾)
-- ============================================================================
DO $assert$
DECLARE
  v_def   text;
  v_pa    integer;
  v_pb    integer;
  v_n     integer;
  v_sig   text;
  v_write text;
  r       record;
BEGIN
  -- 7a. search_path:四支 + trigger 各自都要有,§14-1 的通則不會自動套上(F7)。
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_list_saved_order_views','admin_create_saved_order_view',
                       'admin_update_saved_order_view','admin_delete_saved_order_view',
                       'admin_saved_order_views_touch_updated_at')
     AND p.proconfig @> ARRAY['search_path=public, pg_temp'];
  IF v_n <> 5 THEN
    RAISE EXCEPTION '斷言 7a:search_path 逐支設定不足(期望 5,實得 %)', v_n;
  END IF;

  -- 7b. 🔴 而 search_path = public, pg_temp 的**安全前提**要驗,不是只比字面(R2-8)。
  --     它只有在 public 對不受信任角色【不可寫】時才安全 —— 否則攻擊者在 public 建一個同名物件,
  --     SECURITY DEFINER 就以 owner 的身分去執行它。
  --     📌 我原本只比對了 proconfig 的字面。**字面對了,而它成立的前提沒有人驗。**
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '斷言 7b:anon/authenticated 對 public schema 有 CREATE;search_path 前提不成立';
  END IF;

  -- 7c. 表權限必須是零。
  --     🔴 has_table_privilege 看不到【純欄級】授權(R2-6)⇒ 兩種都要問。
  FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role']) AS role LOOP
    IF has_table_privilege(r.role, 'public.admin_saved_order_views', 'SELECT')
       OR has_table_privilege(r.role, 'public.admin_saved_order_views', 'INSERT')
       OR has_table_privilege(r.role, 'public.admin_saved_order_views', 'UPDATE')
       OR has_table_privilege(r.role, 'public.admin_saved_order_views', 'DELETE') THEN
      RAISE EXCEPTION '斷言 7c-1:% 對本表有表級權限', r.role;
    END IF;
    IF has_any_column_privilege(r.role, 'public.admin_saved_order_views', 'SELECT')
       OR has_any_column_privilege(r.role, 'public.admin_saved_order_views', 'INSERT')
       OR has_any_column_privilege(r.role, 'public.admin_saved_order_views', 'UPDATE') THEN
      RAISE EXCEPTION '斷言 7c-2:% 對本表有欄級權限', r.role;
    END IF;
  END LOOP;

  -- 7d. RLS 開著 + 零 policy。
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.admin_saved_order_views'::regclass) THEN
    RAISE EXCEPTION '斷言 7d-1:RLS 未啟用';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'admin_saved_order_views';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言 7d-2:本表不應有任何 policy,實得 %', v_n;
  END IF;

  -- 7e. EXECUTE:四支只給 service_role。
  FOR r IN
    SELECT unnest(ARRAY[
      'public.admin_list_saved_order_views(text)',
      'public.admin_create_saved_order_view(text, text, text, text, boolean, text, text)',
      'public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text)',
      'public.admin_delete_saved_order_view(text, bigint, text)']) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE')
       OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言 7e-1:anon/authenticated 對 % 有 EXECUTE', r.sig;
    END IF;
    IF NOT has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言 7e-2:service_role 對 % 沒有 EXECUTE(app 會全 permission denied)', r.sig;
    END IF;
  END LOOP;

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

  -- 7g. list 那支沒有寫入語句 ⇒ 它的錨只有身分閘那一格。
  v_def := pg_get_functiondef('public.admin_list_saved_order_views(text)'::regprocedure);
  IF position('WHERE s.id = p_actor AND s.is_active' in v_def) = 0 THEN
    RAISE EXCEPTION '碼錨 A:list 的 actor 身分閘字面缺失;拒繼續';
  END IF;
  IF position('v.staff_id = p_actor OR v.is_shared' in v_def) = 0 THEN
    RAISE EXCEPTION '碼錨 內容閘:list 的私有性過濾字面缺失;拒繼續';
  END IF;

  -- 7h. 四支各真的被呼叫一次(§14-12 驗收條)。
  --     用一個【一定不存在】的 actor 呼叫 ⇒ 四支都必須 RAISE 通用拒絕。
  --     🔴 這一格有雙向判別力:沒 RAISE ⇒ 身分閘沒接上;RAISE 別的訊息 ⇒ 函式本身壞了。
  FOR r IN
    SELECT * FROM (VALUES
      ('SELECT * FROM public.admin_list_saved_order_views($1)'),
      ('SELECT public.admin_create_saved_order_view($1, ''x'', '''', NULL, false, NULL, NULL)'),
      ('SELECT public.admin_update_saved_order_view($1, 0, ''x'', '''', NULL, NULL, NULL)'),
      ('SELECT public.admin_delete_saved_order_view($1, 0, NULL)')
    ) AS t(stmt)
  LOOP
    BEGIN
      EXECUTE r.stmt USING '__no_such_actor_zzz__';
      RAISE EXCEPTION '斷言 7h:% 對不存在的 actor 沒有拒絕', r.stmt;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> '無權執行此操作' THEN
        RAISE EXCEPTION '斷言 7h:% 拒絕了,而訊息不是通用拒絕(實得 %)', r.stmt, SQLERRM;
      END IF;
    END;
  END LOOP;

  RAISE NOTICE '本片斷言全過(7a-7h)';
END;
$assert$;

COMMIT;

-- ============================================================================
-- Rollback(Supabase forward-only、僅供參考、手動執行)
-- ============================================================================
-- 🔴 **而本片這一段與 repo 其餘 100 支不同:它被【真的執行過】。**
--    2026-08-28 線C 量到:222 支 migration 裡檔名帶 down/rollback/revert 的 = **0**;
--    而 137 支帶 `DROP` 的裡面, **100 支的 DROP 只出現在註解裡** —— 那是刻意的慣例
--    (逐字「Rollback(Supabase forward-only、僅供參考、手動執行)」)。
--    📌 ⇒ **回退是以【文字】的形式存在的, 而文字沒有人執行過。**
--       forward 這一側跑過幾十次, down 這一側【零次】。
--    ✅ 本段有一支跑得起來的驗收:`docs/specs/2026-08-25-saved-views-rollback-test.sh`
--       它比三個 schema 快照(before / after-up / after-down):
--       **before 必須 = after-down;而 after-up 必須與它們不同**
--       (少了後面那道 ⇒ 一支根本沒生效的 up 會讓「回得去」印一個很好看的綠)
--    ✅ 三發突變實跑過:漏 DROP TABLE / 漏 touch 函式 / up 換成 no-op ⇒ 各紅在指定那一格
--
-- ⚠️ 順序有意義:先函式、再 trigger、再 trigger 用的函式、最後才是表。
--    (RB2 實測:漏掉 touch 那支 ⇒ 表沒了而**函式留在庫裡**, 一個沒有主人的孤兒物件。)
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
--   DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
--   DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
--   DROP TRIGGER  IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
--   DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
--   DROP TABLE    IF EXISTS public.admin_saved_order_views;
-- COMMIT;
--
-- 🔴 而**資料是不可逆的那一半**:上面這段刪表 = 所有已存的檢視一起沒了。
--    §14-12-i 的分階段:從 D 回退【只推回舊 app、不 drop】;真要 drop 才走這一段。
--    ⇒ **「入口關掉」與「資料刪掉」是兩題, 一題可逆一題不可逆, 不要綁在一起。**
--    僅關入口(可逆):REVOKE EXECUTE ON FUNCTION <四支> FROM service_role;
--    ⚠️ 而重新上線前要記得 `GRANT EXECUTE` ×4 ——
--       漏了的症狀是【四支全 permission denied】, 那看起來像權限設錯, **不像「沒部署」**。
