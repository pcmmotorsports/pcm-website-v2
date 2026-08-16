-- ═══════════════════════════════════════════════════════════════════════════
--  B2-seed · 把三個真人塞進 admin_user_staff_map
--
--  🔴🔴 這是【草稿】,而且它比 B1-b 那支更不能直接跑 ——
--     **2026-08-16 已填入真值(兩個,不是三個 —— 見 §0 DECLARE 那段的理由)。**
--     ⚠️ 下一次要加人時複製本檔,**記得換 uuid**;檔內有一道斷言會擋住忘記換的情況。
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
--
--  ── 🔴🔴 出事怎麼退 —— **這支的退場被【B1-b 自己建的保護】擋著** ──────────
--     `DELETE` 會被 `admin_user_staff_map_no_delete_trg` 擋下,而 service_role 也沒有 DELETE 權。
--     要退 seed,照這個順序(每一步都要有人看著):
--       1. ALTER TABLE public.admin_user_staff_map DISABLE TRIGGER admin_user_staff_map_no_delete_trg;
--       2. DELETE FROM public.admin_user_staff_map WHERE staff_id IN ('sean','staff_2');
--       3. ALTER TABLE public.admin_user_staff_map ENABLE  TRIGGER admin_user_staff_map_no_delete_trg;
--     🔴 **第 3 步不可省** —— 忘了它,那張表從此沒有保護,而【沒有任何東西會提醒你】。
--     ⚠️ 這個退場成本是作者刻意造的(禁 DELETE 是為了擋重綁),**不是意外**。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 固定 search_path(同 B1-b)
SET LOCAL search_path = pg_catalog, public, auth;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_precheck$
DECLARE
  -- ✅ 2026-08-16 已填入真值(Sean 貼回 auth.users 的 id)。
  --    🔴 **兩列不是三列** —— 現實只有兩個帳號,而它們都是 Sean 本人:
  --       sean@pcmmotorsports.com  → 'sean'    (管理者身分)
  --       shopee1@partscheaper.net → 'staff_2' (一般員工權限測試,label 已在 B1-a 更正)
  --    ⚠️ `staff_1` **不綁** —— 它有 17 筆舊紀錄,而那些紀錄產生於「操作者可自選」的時代
  --       (見 A 庫 staff 表的 COMMENT)。選一個零紀錄的代號,不需要靠任何人的記憶。
  --    ⚠️ 真的有第二個員工進來時,他拿【新代號 staff_3】,那時再補一支這種 migration。
  v_sean    uuid := 'f5fb22ee-29f8-4af9-83b8-7fc9121eb533';  -- sean@pcmmotorsports.com
  v_staff_2 uuid := '63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f';  -- shopee1@partscheaper.net
  v_missing text;
  v_existing bigint;
BEGIN
  -- 0.1 B1-b 必須已經跑過,**而且那張表還是 B1-b 建出來的那個版本**
  --     🔴 關卡2 [中] finding:只驗「同名 relation 存在」不夠 ——
  --        兩支之間若有人改了 CHECK / trigger / RLS,B2 仍會成功寫入,而 S1-S4 看不到那個漂移。
  IF to_regclass('public.admin_user_staff_map') IS NULL THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:找不到 public.admin_user_staff_map。\n'
      '   ⇒ B1-b 那支還沒 apply,或你連到了錯的資料庫。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('public.admin_user_staff_map')
                    AND conname  = 'admin_user_staff_map_staff_whitelist') THEN
    RAISE EXCEPTION 'B2-seed 前提斷言:CHECK 白名單約束不見了。表被改過,拒繼續。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.admin_user_staff_map')
                    AND tgname  = 'admin_user_staff_map_no_delete_trg'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'B2-seed 前提斷言:禁 DELETE 的 trigger 不見了。表被改過,拒繼續。';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.admin_user_staff_map')) THEN
    RAISE EXCEPTION 'B2-seed 前提斷言:RLS 沒開。表被改過,拒繼續。';
  END IF;

  -- 0.2 🔴 佔位符沒換就停 —— 這一道的存在就是為了擋「照抄草稿直接跑」
  --     ⚠️ 這道現在【應該不會觸發】(2026-08-16 已填真值),但**不移除** ——
  --        它是給「下一次要加人時複製這支檔」的人的,而那個人最可能忘記換。
  IF v_sean::text    LIKE '00000000-0000-0000-0000-%'
  OR v_staff_2::text LIKE '00000000-0000-0000-0000-%' THEN
    RAISE EXCEPTION E'B2-seed:uuid 還是草稿裡的佔位符,沒有換成真值。\n'
      '   ⇒ 先在 Supabase 後台開帳號,把 auth.users.id 貼回來,再改這支檔。';
  END IF;

  -- 0.3 兩個 uuid 都必須真的存在於 auth.users
  --     🔴 不靠 FK 報錯 —— FK 的訊息不會告訴你「是哪一個人的帳號沒開」
  SELECT string_agg(x.id::text, ', ') INTO v_missing
    FROM (VALUES (v_sean), (v_staff_2)) AS x(id)
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed:這些 uuid 在 auth.users 裡找不到:%\n'
      '   ⇒ 那個帳號可能還沒開,或 uuid 貼錯了。', v_missing;
  END IF;

  -- 0.4 兩個必須互不相同(貼錯時最容易發生的錯:同一個 uuid 貼了兩次)
  --     ⚠️ 這兩個帳號【是同一個人的兩個信箱】,但 uuid 必須不同 ——
  --        它們是兩個不同的 auth user,只是背後是同一個人。
  IF v_sean = v_staff_2 THEN
    RAISE EXCEPTION 'B2-seed:兩個 uuid 相同 —— 貼的時候複製到同一個了。拒繼續。';
  END IF;

  -- 0.5 🔴 這張表必須是空的。非空 = 有人已經塞過,而本支是「唯一入口」
  --     ⇒ 重跑會撞 PK/UNIQUE,但那個錯訊不會說明「你在重複做一件只該做一次的事」
  SELECT count(*) INTO v_existing FROM public.admin_user_staff_map;
  IF v_existing <> 0 THEN
    RAISE EXCEPTION E'B2-seed:admin_user_staff_map 已經有 % 列,不是空的。\n'
      '   ⇒ 本支是【只該跑一次】的 seeding。要加人請另寫一支,不要重跑這支。', v_existing;
  END IF;

  RAISE NOTICE 'B2-seed 前提斷言通過:表在且形狀正確、兩個 uuid 存在且互異、表為空。';
END
$seed_precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 兩列
--     🔴 uuid 在本檔出現【三段各兩處,共六處】,改的時候六處都要改:
--        ① §0 DECLARE(斷言用)② 下面 INSERT(真的寫入)③ 落地斷言的精確配對字串
--        量法(🔴 必須剝註解,否則【這一行自己會被數進去】—— 偵測字串自命中):
--          sed 's/--.*$//' <本檔> | grep -c '<其中一個 uuid>'   ⇒ 每個 uuid 各 3 次
--        ⚠️ 漏改③ ⇒ 拿真 uuid 比舊字面 ⇒ **會紅**,方向是安全的,
--           但你會看到一個看起來像「配對錯了」的錯誤,而真因是你漏改了斷言。
--     📎 這個重複是刻意的:斷言若與 INSERT 共用同一個變數,它就變成「驗自己」。
--     ⚠️ 這個重複是刻意的:斷言若共用同一個變數,它就變成「驗自己」。
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_user_staff_map (auth_user_id, staff_id) VALUES
  ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean'),      -- sean@pcmmotorsports.com
  ('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'staff_2');   -- shopee1@partscheaper.net

-- ───────────────────────────────────────────────────────────────────────────
--  2. 落地斷言 —— 驗【結果】不是驗「INSERT 執行了」
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_verify$
DECLARE
  v_n bigint;
  v_ids text;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_user_staff_map;
  IF v_n <> 2 THEN
    RAISE EXCEPTION E'B2-seed 落地斷言:預期 2 列,實際 % 列。\n'
      '   ⚠️ 是 2 不是 3 —— 現實只有兩個 Auth 帳號,而 staff_1 刻意不綁(見檔頭)。', v_n;
  END IF;

  -- 🔴🔴 關卡2 [高] finding:只驗 staff_id 的【集合】不夠 ——
  --    兩個 uuid 對調之後,集合一樣是 sean,staff_2,**驗收仍全綠**,
  --    而每個人拿到的是【別人的身分】。⇒ 必須驗【精確配對】。
  --    ⚠️ 本例兩個帳號都是 Sean 本人 ⇒ 對調的後果是「管理者與一般員工權限對調」,
  --       那正好會讓他測不出他想測的東西,而且不會有任何東西紅。
  SELECT string_agg(auth_user_id::text || '=' || staff_id, ',' ORDER BY staff_id) INTO v_ids
    FROM public.admin_user_staff_map;
  IF v_ids <> ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533=sean,'
             ||'63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f=staff_2') THEN
    RAISE EXCEPTION E'B2-seed 落地斷言:配對不符。\n   實際:%\n'
      '   ⇒ 最可能的原因是兩個 uuid 貼的順序跟人對不起來(對調)。\n'
      '   🔴 這一條驗的是【誰對到誰】,不是【有哪幾個人】—— 後者對調之後仍然會過。', v_ids;
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
