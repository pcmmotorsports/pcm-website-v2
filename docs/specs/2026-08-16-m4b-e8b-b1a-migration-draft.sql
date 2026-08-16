-- ═══════════════════════════════════════════════════════════════════════════
--  B1-a · 停用 test_01(A 庫 `pcm-website-v2`)
--
--  🔴 這是【草稿】。最終落點 = 本 repo 的 supabase/migrations/,搬過去時改成該目錄的時間戳命名。
--  · 規格:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §3
--  · 🔴 **這一支在【A 庫】,不是報價單庫。** B1-b / B2 在報價單庫。
--    v1 規格曾把兩個庫混在一起寫,被關卡1 抓到 ⇒ 檔頭第一句就講清楚在哪。
--
--  ── 為什麼要做 ────────────────────────────────────────────────────────────
--  `test_01` 是【主管且啟用】,而 Sean 2026-08-16 逐字:
--      「昨天開給你測試用得帳號…結果好像沒用到…」
--      「原先以為是要設定好帳號給你才可以登入使用,結果最後你開網頁我手動登入就好」
--  ⇒ 為了讓 AI 登入而開,而那個需求最後不存在。確定無用途。
--
--  ⚠️ **順序上它【不是】B1-b 的前置**(規格 §1 更正):
--     `test_01` 不在 B1-b 的 CHECK 白名單裡 ⇒ B1-b 本來就給不了它登入資格。
--     它該做,但不因 B1-b 而急。**這支可以獨立 apply。**
--
--  ── 🔴 為什麼是 is_active=false 而不是 DELETE ────────────────────────────
--  `admin_audit_log.actor` 是 **text 欄不是 FK**
--  (supabase/migrations/20260712210000_m4a_admin_audit_log.sql:45)
--  ⇒ 刪掉它、若它寫過紀錄,就製造一筆孤兒。
--  **目前孤兒 = 0**(2026-08-16 Sean 實查)——
--  **刪它是唯一會弄壞這個 0 的動作,而 is_active 可逆、DELETE 不可逆。**
--
--  ── 🔴 開工前置(還沒做)──────────────────────────────────────────────────
--  跑一次:select distinct actor from public.admin_audit_log order by 1;
--  ⇒ 確認 test_01 有沒有寫過紀錄。
--  **有寫過** ⇒ 本支照跑(停用不影響既有紀錄),但要知道它的名字會留在稽核軌裡。
--  **沒寫過** ⇒ 同樣照跑。
--  ⚠️ 那一句【還沒跑】。它不改變本支的動作,但它改變我們對「這個帳號是什麼」的理解
--     —— 所以列為前置而不是可選。
--
--  ── 出事怎麼退 ────────────────────────────────────────────────────────────
--      UPDATE public.staff SET is_active = true, updated_at = now() WHERE id = 'test_01';
--  **完全可逆,零資料損失。** 這是本片刻意選 is_active 而非 DELETE 的直接好處。
--
--  ⚠️ 前提:所有語句在同一個 session。statement-mode pooler 下 BEGIN 無效且零警告。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL search_path = pg_catalog, public;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言
-- ───────────────────────────────────────────────────────────────────────────
DO $precheck$
DECLARE
  v_active    boolean;
  v_manager   boolean;
  v_total     bigint;
BEGIN
  -- 0.1 🔴 庫別自證 —— 跑錯庫要當場紅,不要靜靜改到別的東西
  --     報價單庫沒有 public.staff;A 庫沒有 public.auth_state。
  IF to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION E'B1-a 前提斷言:找不到 public.staff。\n'
      '   ⇒ 你可能連到了【報價單庫】。本支屬 A 庫(pcm-website-v2)。';
  END IF;
  IF to_regclass('public.auth_state') IS NOT NULL THEN
    RAISE EXCEPTION E'B1-a 前提斷言:這個庫有 public.auth_state ⇒ 它是【報價單庫】。\n'
      '   ⇒ 本支屬 A 庫,拒繼續。';
  END IF;

  -- 0.2 test_01 必須存在,而且【現在確實是啟用中的主管】
  --     🔴 若它已經被別人停用了,本支就沒事可做 ——
  --        而「沒事可做卻回報成功」是本 repo 反覆踩過的形狀 ⇒ 明確紅。
  SELECT is_active, is_manager INTO v_active, v_manager
    FROM public.staff WHERE id = 'test_01';
  IF NOT FOUND THEN
    RAISE EXCEPTION E'B1-a 前提斷言:staff 表裡沒有 test_01。\n'
      '   ⇒ 它可能已經被刪除(而那是規格明文禁止的動作)⇒ 停下回報,不要繼續。';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION E'B1-a 前提斷言:test_01 已經是停用狀態,本支沒有事情可做。\n'
      '   ⇒ 這不是失敗,是【已經有人做過了】。確認是誰做的、為什麼,再決定要不要跳過本支。';
  END IF;

  -- 0.3 分母閘:staff 表不該是空的
  SELECT count(*) INTO v_total FROM public.staff;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'B1-a 前提斷言:staff 表是空的 ⇒ 這個庫的狀態不對,拒繼續。';
  END IF;

  RAISE NOTICE 'B1-a 前提斷言通過:A 庫、test_01 存在且啟用中(is_manager=%),staff 共 % 列。',
    v_manager, v_total;
END
$precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 停用
--     🔴 只動 is_active 與 updated_at。**不動 is_manager** ——
--        保留它原本的樣子,是為了讓將來翻紀錄的人看得出「這個帳號當時的權限有多大」。
--        把它一起降級會抹掉那個事實。
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.staff
   SET is_active  = false,
       updated_at = now()
 WHERE id = 'test_01';

-- ───────────────────────────────────────────────────────────────────────────
--  1b. 把 staff_2 指派給 Sean 的一般員工權限測試帳號
--
--  🔴 **這是「指派一個從未被使用的佔位代號」,不是「重用」** ——
--     `staff_2` 在 admin_audit_log 裡【零筆紀錄】(2026-08-16 Sean 實查:只有 sean 48 筆、staff_1 17 筆)
--     ⇒ 沒有任何歷史紀錄的解讀會因為改它的 label 而改變。
--     Sean 拍的「永不重用」講的是**不要重新指派真人用過的代號**;佔位代號存在的目的就是被指派。
--
--  ⚠️ 為什麼不用 staff_1(它有 17 筆):那 17 筆據 Sean 說是他自己測試時挑的,
--     **但那是口頭回答,而 label 是永久且靜默的** —— 錯了不會有任何東西紅。
--     ⇒ 選一個【不需要那個回答就成立】的代號。
--
--  📌 之後真的有第二個員工進來時,他拿【新代號 staff_3】。
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.staff
   SET label      = 'Sean 測試帳號(一般員工權限,非真員工)',
       updated_at = now()
 WHERE id = 'staff_2';

COMMENT ON TABLE public.staff IS
  '後台操作者名冊。🔴 id 為永久識別碼、永不重用(Sean 2026-08-16 拍板):'
  '離職 = is_active=false,不是 DELETE;新人拿新代號,不撿空出來的。'
  '原因:admin_audit_log.actor 是 text 欄不是 FK,重用代號會讓歷史稽核紀錄改變解讀。'
  ' '
  '🔴 給要查舊稽核紀錄的人(2026-08-16 補):真登入線上線【之前】的 actor 值,'
  '是使用者自己從下拉選單挑的、系統不驗證(apps/admin/src/lib/session/actor.ts 自陳非授權邊界)'
  '⇒ 那些紀錄【不識別任何人】。不要拿它們當「某個人做過什麼」的證據。'
  '具體:staff_1 的 17 筆與 sean 的 48 筆皆屬此列(2026-08-16 實查)。'
  '真正能對應到人的紀錄,從真登入線上線那一刻才開始。';

-- ───────────────────────────────────────────────────────────────────────────
--  2. 落地斷言 —— 驗【結果】不是驗「UPDATE 執行了」
-- ───────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_active   boolean;
  v_still    boolean;
  v_others   bigint;
BEGIN
  SELECT is_active INTO v_active FROM public.staff WHERE id = 'test_01';
  IF v_active IS NULL THEN
    RAISE EXCEPTION 'B1-a 落地斷言:test_01 不見了 —— 本支只該 UPDATE,不該讓它消失。';
  END IF;
  IF v_active THEN
    RAISE EXCEPTION 'B1-a 落地斷言:test_01 仍是 is_active=true,停用沒有生效。';
  END IF;

  -- 🔴 那一列還在(不是被刪掉),這是本片與「DELETE 掉」的分水嶺
  SELECT EXISTS(SELECT 1 FROM public.staff WHERE id = 'test_01') INTO v_still;
  IF NOT v_still THEN
    RAISE EXCEPTION 'B1-a 落地斷言:test_01 那一列不見了。';
  END IF;

  -- 🔴 對照組:本支【只該動一列】。其餘 staff 的 is_active 不得被改到。
  --    2026-08-16 Sean 實查:sean/staff_1/staff_2 啟用、op4_backfill/payment_confirmer 停用。
  --    ⇒ 啟用中的應為 3 列(test_01 停用之後)。
  SELECT count(*) INTO v_others FROM public.staff WHERE is_active;
  IF v_others <> 3 THEN
    RAISE EXCEPTION E'B1-a 落地斷言:啟用中的 staff 是 % 列,預期 3(sean/staff_1/staff_2)。\n'
      '   ⇒ 要嘛我動到了不該動的列,要嘛這個庫的 staff 現況已經跟 2026-08-16 的實查不同。\n'
      '   ⇒ 兩種都要停下來看,不要當成通過。', v_others;
  END IF;

  -- 🔴 staff_2 的 label 必須真的改到,而且不得再含「員工 2」那種會被誤讀成真員工的字
  DECLARE v_label text; v_s1 text;
  BEGIN
    SELECT label INTO v_label FROM public.staff WHERE id = 'staff_2';
    IF v_label <> 'Sean 測試帳號(一般員工權限,非真員工)' THEN
      RAISE EXCEPTION 'B1-a 落地斷言:staff_2 的 label 是「%」,指派沒有生效。', v_label;
    END IF;
    -- 對照組:staff_1 的 label【不得】被動到(本支刻意不碰它)
    SELECT label INTO v_s1 FROM public.staff WHERE id = 'staff_1';
    IF v_s1 <> '員工 1(占位)' THEN
      RAISE EXCEPTION E'B1-a 落地斷言:staff_1 的 label 變成「%」——本支不該碰它。\n'
        '   ⇒ 要嘛我動錯列,要嘛它已經被別人改過。兩種都停下來看。', v_s1;
    END IF;
  END;

  RAISE NOTICE '✅ B1-a 落地斷言通過:test_01 已停用且該列仍在、staff_2 已指派、staff_1 未被動到、啟用中的 staff 共 3 列。';
END
$verify$;

COMMIT;
