-- ═══════════════════════════════════════════════════════════════════════════
--  B2-seed · 把三個真人塞進 admin_user_staff_map
--
--  🔴🔴 這是【草稿】,而且它比 B1-b 那支更不能直接跑 ——
--     **下面三個 uuid 是佔位符,必須換成 Sean 在 Supabase 後台開完帳號後貼回來的真值。**
--     沒換就跑 = 前提斷言會擋下來(那正是它存在的目的)。
--
--  · 規格:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §2「三列資料誰塞、什麼時候塞」
--  · 前置:B1-b 那支已 apply(表與 trigger 存在)
--  · 為什麼不能併進 B1-b:auth_user_id 要等 Sean 開完帳號才存在,
--    而 B1-b 是在那之前跑的 ⇒ 建表時那張表必然是空的。
--  · apply 管道:MCP apply_migration,【需要 Sean 在場】
--
--  🔴 這支是「寫入端唯一入口」(規格 §2 (c) 案)。
--     日後加人 = 再一支這種 migration + 一支 ALTER 改 CHECK 白名單,
--     **同一支檔、同一次 review** —— 那就是白名單方案的代價與價值。
--  🔴 Sean 2026-08-16 拍板:代號永不重用。新人拿新代號(staff_3…),不撿空出來的。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_precheck$
DECLARE
  -- 🔴 換成真值再跑。三個都要換。
  v_sean    uuid := '00000000-0000-0000-0000-000000000001';
  v_staff_1 uuid := '00000000-0000-0000-0000-000000000002';
  v_staff_2 uuid := '00000000-0000-0000-0000-000000000003';
  v_missing text;
  v_existing bigint;
BEGIN
  -- 0.1 B1-b 必須已經跑過
  IF to_regclass('public.admin_user_staff_map') IS NULL THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:找不到 public.admin_user_staff_map。\n'
      '   ⇒ B1-b 那支還沒 apply,或你連到了錯的資料庫。';
  END IF;

  -- 0.2 🔴 佔位符沒換就停 —— 這一道的存在就是為了擋「照抄草稿直接跑」
  IF v_sean::text LIKE '00000000-0000-0000-0000-%' THEN
    RAISE EXCEPTION E'B2-seed:三個 uuid 還是草稿裡的佔位符,沒有換成真值。\n'
      '   ⇒ 先請 Sean 在 Supabase 後台開三個帳號,把 auth.users.id 貼回來,再改這支檔。';
  END IF;

  -- 0.3 三個 uuid 都必須真的存在於 auth.users
  --     🔴 不靠 FK 報錯 —— FK 的訊息不會告訴你「是哪一個人的帳號沒開」
  SELECT string_agg(x.id::text, ', ') INTO v_missing
    FROM (VALUES (v_sean), (v_staff_1), (v_staff_2)) AS x(id)
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed:這些 uuid 在 auth.users 裡找不到:%\n'
      '   ⇒ 那個帳號可能還沒開,或 uuid 貼錯了。', v_missing;
  END IF;

  -- 0.4 三個必須互不相同(貼錯時最容易發生的錯:同一個 uuid 貼了兩次)
  IF v_sean IN (v_staff_1, v_staff_2) OR v_staff_1 = v_staff_2 THEN
    RAISE EXCEPTION 'B2-seed:三個 uuid 有重複 —— 貼的時候複製到同一個了。拒繼續。';
  END IF;

  -- 0.5 🔴 這張表必須是空的。非空 = 有人已經塞過,而本支是「唯一入口」
  --     ⇒ 重跑會撞 PK/UNIQUE,但那個錯訊不會說明「你在重複做一件只該做一次的事」
  SELECT count(*) INTO v_existing FROM public.admin_user_staff_map;
  IF v_existing <> 0 THEN
    RAISE EXCEPTION E'B2-seed:admin_user_staff_map 已經有 % 列,不是空的。\n'
      '   ⇒ 本支是【只該跑一次】的 seeding。要加人請另寫一支,不要重跑這支。', v_existing;
  END IF;

  RAISE NOTICE 'B2-seed 前提斷言通過:表在、三個 uuid 存在且互異、表為空。';
END
$seed_precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 三列
--     🔴 uuid 與上面 DECLARE 的三個必須一致 —— 改的時候【六個地方都要改】
--        (上面三個是斷言用的、下面三個是真的寫入)
--     ⚠️ 這個重複是刻意的:斷言若共用同一個變數,它就變成「驗自己」。
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_user_staff_map (auth_user_id, staff_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sean'),
  ('00000000-0000-0000-0000-000000000002', 'staff_1'),
  ('00000000-0000-0000-0000-000000000003', 'staff_2');

-- ───────────────────────────────────────────────────────────────────────────
--  2. 落地斷言 —— 驗【結果】不是驗「INSERT 執行了」
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_verify$
DECLARE
  v_n bigint;
  v_ids text;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_user_staff_map;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'B2-seed 落地斷言:預期 3 列,實際 % 列。', v_n;
  END IF;

  SELECT string_agg(staff_id, ',' ORDER BY staff_id) INTO v_ids
    FROM public.admin_user_staff_map;
  IF v_ids <> 'sean,staff_1,staff_2' THEN
    RAISE EXCEPTION 'B2-seed 落地斷言:staff_id 集合是 %,預期 sean,staff_1,staff_2。', v_ids;
  END IF;

  -- 🔴 系統帳號與 test_01 不該在裡面 —— CHECK 白名單擋得住,而這一道是【明說我檢查過】
  IF EXISTS (SELECT 1 FROM public.admin_user_staff_map
              WHERE staff_id IN ('op4_backfill', 'payment_confirmer', 'test_01')) THEN
    RAISE EXCEPTION 'B2-seed 落地斷言:表裡出現了不該登入的帳號。';
  END IF;

  RAISE NOTICE '✅ B2-seed 落地斷言通過:3 列、集合正確、無不該登入的帳號。';
END
$seed_verify$;

COMMIT;
