-- ═══════════════════════════════════════════════════════════════════════════
-- M3 · 最後 3 支 SECURITY DEFINER 的 `search_path` 鎖成空字串
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔵 版本 `20260918010000` · **板號 211**(主視窗 2026-09-18 給號,不是我自己挑的)。
--
-- ══ ⛔⛔ **本片【不貼】—— Sean 2026-09-18 拍甲。檔案留著當紀錄。寫這支的人就是我。** ══════
--    ⛔ ~~「本片【建議不貼】,等 Sean 拍板」~~ ⇒ **2026-09-18 已拍:不貼。**
--    🛑 **要貼等於推翻【兩次】決定**(09-05 的 parked + 09-18 的拍甲)⇒ 要 Sean 再明說一次。
--    ⛔ ~~原本這裡寫「貼板順序寫死:板 209 先、本片後」,讀起來像本片一定會貼~~ —— **那個前提沒站住。**
--
--    🔴 **① 這三支在 2026-09-05 就被決定緩做,而我寫本片之前沒查到那個決定。**
--       `docs/plans/2026-09-05-definer-search-path-lock-plan.md` §1 把它們分成堆 D / B / C,逐字:
--         「B/C/D 三支不是同一種風險:`pg_catalog` 不是使用者可寫的 schema ⇒ 它們**現在就已經安全**。
--          真正的風險全在堆 A 的 `public` 那一段。⇒ **B/C/D 可以緩,不要為了『數字歸零』一起動。**」
--       同檔 §3 逐字:「**M3 堆 B/C/D 3 支 —— 標 `parked`,收益低風險高**」。
--       📌 **本片就是那句「為了數字歸零一起動」。**
--
--    🔴 **② Sean 2026-09-17 拍的甲不含這三支。** 窗A 的 M2 plan `:190` 逐字「**Sean 拍的是那 12 支**」;
--       同檔 `:104` 說那 12 支是「M1a+M1b 那批**沒掃到的漏網**,**不是刻意留的例外**」
--       ⇒ **而這三支正是「刻意留的例外」那一邊。**
--
--    🔬 **③ 那個「已經安全」我實測確認【成立】**(2026-09-18 唯讀正式庫;09-05 plan 把這題列給 codex 而沒有答案):
--       `has_schema_privilege(<角色>, 'pg_catalog', 'CREATE')` 對 anon / authenticated / service_role /
--       payment_confirmer / **postgres** ⇒ **全部 `f`**;`public` 的 CREATE 也是除了 postgres 之外全 `f`。
--       `pg_catalog` 的 ACL 原文 `{supabase_admin=UC/supabase_admin,=U/supabase_admin}`
--       ⇒ **沒有任何角色能在那兩個 schema 建東西 ⇒ 這三支的 search_path 沒有可被劫持的一格。**
--       ⇒ 📌 **本片的收益接近 0(只剩 defense-in-depth),而成本包含動到下面那支【壞掉是安靜的】`rls_auto_enable`。**
--
--    🔵 **一件我不同意那份 plan、而它不改變結論的**:plan 說「鎖成 `''` 要連 builtin 都補前綴」——
--       那句不成立(`pg_catalog` 永遠隱含在搜尋路徑裡,而 plan 自己 §2 就寫過相反的話)。
--       ⇒ 「成本高」那半被高估了;**結論靠的是「收益低」那半,那半我實測過。**
--
--    ⇒ 🛑 **要貼本片 = 推翻 09-05 的 parked ⇒ 要 Sean 明說「我要數字歸零」。**
--    ⇒ 🔵 **板 209(M2)不受影響,照常** —— 那 12 支是漏網不是例外,Sean 拍過。
--    ⇒ 🔴 **若兩支都要貼,順序仍然寫死:板 209 先、本片後**(理由見下一段,前置閘②會自己擋)。
--
-- 🎯 把這三支的 `search_path` 從現值改成空字串,**一個字都不動函式本體**:
--    ① public.pcm_op2b_reversal_amount()                      現值 search_path=pg_catalog, public
--    ② public.record_auth_callback_event(text,text,text)       現值 search_path=pg_catalog, pg_temp
--    ③ public.rls_auto_enable()                                現值 search_path=pg_catalog
--
-- 🔬 **這三支是怎麼來的**(2026-09-17 唯讀實查,報告 ~/pcm-mailbox/ACL-28格逐格核-20260917.md):
--    正式庫 `public` 底下 SECURITY DEFINER 共 187 支,其中 `search_path` 不是空字串的 **15 支**。
--    窗A 的 `20260917140000`(M2)收 12 支(現值全是 `public, pg_temp`)⇒ **15 − 12 = 這 3 支**。
--    📌 它們落在 M2 的母體外面,是因為**現值不是 `public, pg_temp`**,不是誰漏掉。
--
-- ══ 🔴🔴 **貼的順序:本片必須在 M2 【之後】** ══════════════════════════════
--    **M2 拿 `rls_auto_enable()` 當它的負對照**(`20260917140000:272-281` 逐字):
--      `RAISE EXCEPTION '🔴 負對照失敗:rls_auto_enable 的 search_path 是 %,不是我釘的`
--      `search_path=pg_catalog ⇒ 對照組本身被動過, 上面的斷言沒有判別力, 拒 COMMIT'`
--    ⇒ 🛑 **本片先貼 ⇒ M2 會拒絕 COMMIT。** 而它拒絕的方向是對的(fail-closed),
--       代價是「M2 貼不進去」不是「靜靜蓋掉東西」。
--    ⇒ ✅ **所以本片自己擋住這個順序** —— 前置閘② 要求 M2 已經生效,否則整支回捲。
--    📌 一個「請記得先貼 M2」的註解擋不住任何人;一道會 RAISE 的閘擋得住。
--
-- ══ 🔴 **不可以用 `CREATE OR REPLACE`** ═══════════════════════════════════
--    它會把 `SET` 子句【整組換掉】(memory: create-or-replace-resets-set-clause)。
--    🔵 而這三支**目前每一支的 `proconfig` 都只有 `search_path` 一項**(2026-09-17 唯讀實查),
--       **沒有 `lock_timeout=5s`** —— 那是 M2 那 12 支裡 6 支才有的東西。
--    🛑 **而我不靠這句話擔保**:前置閘① 直接比 `array_length(proconfig,1) = 1`,
--       多一項就停 ⇒ 若在我寫檔到貼板之間有人加了別的 SET,本片不會把它吃掉。
--
-- ══ ↩️ **還原**:`supabase/rollbacks/20260918010000-rollback.sql` ══════════
--    🔵 **本片刻意【不建還原表】** —— 與 M1a / M1b / M2 的做法不同,理由寫在這裡:
--      · 那三片各建一張 `pcm_definer_searchpath_rollback_*` 表存原值,因為它們要存 12 支
--        的完整 `proconfig` 陣列(含 lock_timeout),寫不進一個檔頭。
--      · 🔴 而 M1a / M1b 那兩張表的 COMMENT 逐字寫「滿一週 ⇒ DROP」,**2026-09-18 第 12 天還在,
--        實績 0/2**(本佇列第 ③ 件就是查這個)⇒ **再加一張的期望值是「它也不會被刪」。**
--      · ✅ 本片只有 3 支、每支的原值都是一個短字串 ⇒ **原值直接逐字寫進還原檔**,
--        不需要一張表。⇒ **少一張沒人會刪的孤兒表。**
--    ⚠️ 代價寫清楚:還原檔靠的是**我寫檔當下量到的原值**,不是貼板當下的。
--       ⇒ 所以還原檔自己也有一道閘:退回去之前先確認現值是空字串(= 確實是本片造成的)。
--
-- 🛑 **靜態全綠不代表沒事**:`ALTER … SET search_path = ''` 語法本來就合法,
--    出事的地方在**執行期**(函式體裡用了裸表名 ⇒ 空 search_path 之下解析不到)。
--    ⇒ 事後斷言只證 proconfig 改成了什麼,**證不到那三支函式跑起來還會不會動**(見檔尾)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘① 三支都在、都是 SECURITY DEFINER、owner 是 postgres、proconfig 恰好一項 ══
DO $$
DECLARE
  r        record;
  v_oid    oid;
  v_n      int;
  expect   text[][] := ARRAY[
    ARRAY['public.pcm_op2b_reversal_amount()',                'search_path=pg_catalog, public'],
    ARRAY['public.record_auth_callback_event(text,text,text)', 'search_path=pg_catalog, pg_temp'],
    ARRAY['public.rls_auto_enable()',                          'search_path=pg_catalog']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(expect, 1) LOOP
    v_oid := pg_catalog.to_regprocedure(expect[i][1]);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘①a:% 不存在 ⇒ 停。', expect[i][1];
    END IF;
    SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner)::text,
           COALESCE(pg_catalog.array_length(p.proconfig, 1), 0),
           COALESCE(p.proconfig[1], '(未設)')
      INTO r
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

    IF NOT r.prosecdef THEN
      RAISE EXCEPTION '前置閘①b:% 不是 SECURITY DEFINER ⇒ 本片的前提不成立, 停。', expect[i][1];
    END IF;
    IF r.pg_get_userbyid <> 'postgres' THEN
      RAISE EXCEPTION '前置閘①c:% 的 owner 是 %(期望 postgres)⇒ 停。', expect[i][1], r.pg_get_userbyid;
    END IF;
    -- 🔴 這一格就是「不要把別的 SET 吃掉」那道保險:多一項就停,不猜它是什麼
    IF r.array_length <> 1 THEN
      RAISE EXCEPTION
        '前置閘①d:% 的 proconfig 有 % 項(期望恰好 1 項)⇒ 我寫這一片時它只有 search_path, '
        '現在多出別的 SET(例如 lock_timeout)⇒ 停下來讓人看, 不要讓本片決定怎麼處理它。',
        expect[i][1], r.array_length;
    END IF;
    IF r.array_length IS DISTINCT FROM 1 OR r.coalesce <> expect[i][2] THEN
      RAISE EXCEPTION
        '前置閘①e:% 的 search_path 現在是 %,而本片寫的時候是 % ⇒ 有人動過, 停。',
        expect[i][1], r.coalesce, expect[i][2];
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 前置閘①:三支都在 · 都是 DEFINER · owner=postgres · proconfig 各恰好 1 項且值與預期相符';
END $$;

-- ══ 🔴 前置閘② M2(20260917140000)必須【已經生效】 ════════════════════════
--    理由見檔頭:M2 拿 rls_auto_enable 當負對照, 本片先貼會讓 M2 拒絕 COMMIT。
--    判準不看帳本(帳本答的是「有人記了嗎」不是「東西在不在」)—— **直接量那 12 支的現況**。
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.proconfig IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp');

  IF v_left > 0 THEN
    RAISE EXCEPTION
      E'前置閘②:還有 % 支 SECURITY DEFINER 的 search_path 是 "public, pg_temp"\n'
      '⇒ 20260917140000(M2)還沒貼。\n'
      '🔴 本片【必須在 M2 之後】:M2 拿 rls_auto_enable() 當負對照, 釘它仍是 search_path=pg_catalog;\n'
      '   本片先貼會把那一格改掉 ⇒ M2 會拒絕 COMMIT。\n'
      '⇒ 先貼 20260917140000, 再貼本片。', v_left;
  END IF;
  RAISE NOTICE '✅ 前置閘②:0 支 search_path=public, pg_temp 的 DEFINER ⇒ M2 已生效, 順序正確';
END $$;

-- ══ 🔵 前置閘③ 負對照的對照組本身要在、而且是我釘的值 ═══════════════════════
--    沒有這一格, 下面事後斷言那個「未動的仍是舊值」可能只是因為對照組早就被動過。
DO $$
DECLARE v_oid oid; v_sp text;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.orders_freeze_shipping_snapshot()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘③:負對照的對照組 orders_freeze_shipping_snapshot() 不存在 ⇒ 事後那一格證不到任何事, 停。';
  END IF;
  SELECT COALESCE(p.proconfig[1], '(未設)') INTO v_sp FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_sp <> 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION '前置閘③:對照組的 search_path 是 %,不是我釘的 search_path=pg_catalog, public ⇒ 它被動過, 停。', v_sp;
  END IF;
  RAISE NOTICE '✅ 前置閘③:對照組 orders_freeze_shipping_snapshot() 在, 且仍是 search_path=pg_catalog, public';
END $$;

-- ══ 改這三支(只動 proconfig 的 search_path 那一項,不碰 body)═══════════════
ALTER FUNCTION public.pcm_op2b_reversal_amount()                       SET search_path = '';
ALTER FUNCTION public.record_auth_callback_event(text, text, text)     SET search_path = '';
ALTER FUNCTION public.rls_auto_enable()                                SET search_path = '';

-- ══ 事後斷言① 三支都變成空字串,而且 proconfig 仍然只有一項 ═══════════════
DO $$
DECLARE
  sigs text[] := ARRAY[
    'public.pcm_op2b_reversal_amount()',
    'public.record_auth_callback_event(text,text,text)',
    'public.rls_auto_enable()'
  ];
  i int; v_oid oid; v_n int; v_sp text;
BEGIN
  FOR i IN 1 .. array_length(sigs, 1) LOOP
    v_oid := pg_catalog.to_regprocedure(sigs[i]);
    SELECT COALESCE(pg_catalog.array_length(p.proconfig, 1), 0), COALESCE(p.proconfig[1], '(未設)')
      INTO v_n, v_sp
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_sp <> 'search_path=""' THEN
      RAISE EXCEPTION '事後斷言①a:% 的 search_path 是 %,不是空字串 ⇒ 整筆回捲。', sigs[i], v_sp;
    END IF;
    -- 🔴 這一格證的是「我沒有把別的 SET 吃掉」—— 只驗 search_path 驗不到那件事
    IF v_n <> 1 THEN
      RAISE EXCEPTION '事後斷言①b:% 的 proconfig 有 % 項(期望 1)⇒ 我動到了別的東西, 整筆回捲。', sigs[i], v_n;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 事後斷言①:三支都是 search_path="" 且 proconfig 仍只有 1 項';
END $$;

-- ══ 🔵 事後斷言② 負對照:沒動的那支必須【還是舊值】════════════════════════
--    🔴 沒有這一格, 上面那三個 `search_path=""` 可能是「全庫本來就都是空字串」——
--       那時候斷言會過, 而本片什麼都沒做。
DO $$
DECLARE v_sp text;
BEGIN
  SELECT COALESCE(p.proconfig[1], '(未設)') INTO v_sp
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.orders_freeze_shipping_snapshot()');
  IF v_sp <> 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION
      '事後斷言②:未動的 orders_freeze_shipping_snapshot() 竟然變成 % ⇒ 本片動到了它不該動的東西, 整筆回捲。', v_sp;
  END IF;
  RAISE NOTICE '🔵 事後斷言②(負對照):未動的 orders_freeze_shipping_snapshot() 仍是 % ⇒ 上面三個空字串是本片做的', v_sp;
END $$;

-- ══ 🔵 事後斷言③ 分母:全庫還剩幾支 DEFINER 的 search_path 不是空字串 ═══════
--    期望 0。這一格把「本片做完之後這件事結案了沒」印出來,而不是靠人回頭再查一次。
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND (p.proconfig IS NULL
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""'));
  RAISE NOTICE '🔵 事後分母:public 底下 SECURITY DEFINER 而 search_path 不是空字串的 ⇒ 還剩 % 支', v_left;
  IF v_left <> 0 THEN
    RAISE EXCEPTION
      '事後斷言③:還剩 % 支 ⇒ 15 − 12(M2)− 3(本片)應該是 0。'
      '要嘛 09-17 之後有人新建了帶 search_path 的 DEFINER, 要嘛我的分母算錯 ⇒ 停下來讓人看。', v_left;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑 本片【證不到】什麼 —— 讀輸出的人要知道
-- ═══════════════════════════════════════════════════════════════════════════
-- ① **證不到那三支跑起來還會不會動。** 空 search_path 之下,函式體裡任何**裸表名 / 裸函式名**
--    都解析不到 ⇒ 執行期才會炸,而本片的斷言只看 `proconfig`。
--    🔬 **而我讀了那三支的函式體(2026-09-17 唯讀 `pg_get_functiondef`),三支【全部帶 schema 前綴】**:
--      · `pcm_op2b_reversal_amount()`          →  `FROM public.order_payments`              ✅ 有前綴
--      · `record_auth_callback_event(...)`     →  `INSERT INTO public.auth_callback_events` ✅ 有前綴
--      · `rls_auto_enable()`                   →  只用 `pg_event_trigger_ddl_commands()` 與 `format()`
--         (兩者都在 `pg_catalog`)+ `EXECUTE format('alter table if exists %s …', cmd.object_identity)`,
--         而 `object_identity` 是**事件觸發器給的完整限定名** ✅
--      🔵 `pg_catalog` **永遠隱含在搜尋路徑裡**(就算 search_path 是空字串)⇒ 內建函式不受影響。
--    ⇒ 📌 **所以「鎖了會炸」的那條路,在這三支上我找不到。** 而這是**讀出來的**,仍然不是跑出來的。
--    🔴🔴 **`rls_auto_enable` 有一個【安靜壞掉】的形狀,要特別講**:
--       它的 `EXECUTE` 包在 `EXCEPTION WHEN OTHERS THEN RAISE LOG` 裡
--       ⇒ **它壞掉不會讓任何一支 `CREATE TABLE` 失敗**,只會讓新建的表**靜靜地沒開 RLS**。
--       ⇒ 貼完之後下一次有人建表時,**要去確認那張新表的 `relrowsecurity` 是 true**,
--          不能靠「建表沒報錯」判斷它還活著。
--    🔬 另外兩支貼完要走一次真實路徑:後台登一筆沖正 / 走一次登入 callback。
-- ② 證不到 `ALTER FUNCTION` 之外的漂移:owner / ACL / body 都不在本片動的範圍,
--    前置閘只在**貼的那一刻**量過一次。
-- ③ 事後分母那個 0 只涵蓋 `public` schema 與 `prosecdef = true`,別的 schema 不在分母裡。
-- ═══════════════════════════════════════════════════════════════════════════
