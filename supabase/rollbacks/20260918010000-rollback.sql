-- ═══════════════════════════════════════════════════════════════════════════
-- ↩️ 還原 `20260918010000_m4b_definer_searchpath_lock_m3.sql`(板 211)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 把三支的 `search_path` 寫回本片動它之前的值:
--   public.pcm_op2b_reversal_amount()                  →  pg_catalog, public
--   public.record_auth_callback_event(text,text,text)  →  pg_catalog, pg_temp
--   public.rls_auto_enable()                           →  pg_catalog
--
-- 🔵 **為什麼原值是寫死的字面,而不是從一張還原表讀**(與 M1a / M1b / M2 不同):
--    那三片要存 12 支的完整 proconfig 陣列(含 lock_timeout)⇒ 需要一張表。
--    本片只有 3 支、每支只有一項、值都是短字串 ⇒ 寫在這裡就夠,**少一張沒人會刪的孤兒表**
--    (M1a / M1b 的還原表 COMMENT 逐字寫「滿一週 ⇒ DROP」,2026-09-18 第 12 天還在,實績 0/2)。
--
-- ⚠️ **代價寫清楚**:這三個值是**我寫檔當下(2026-09-17 唯讀實查)**量到的,不是貼板當下的。
--    ⇒ 所以下面有一道閘:退回去之前先確認現值**是空字串**。
--      · 是空字串 ⇒ 那就是本片造成的 ⇒ 退得回去。
--      · 不是 ⇒ **停**。可能本片沒貼成、或貼完之後又有人動過 ⇒ 這時候寫回去會蓋掉別人的東西。
--
-- 🔴 **順序**:本檔只退本片那三支。**不要**拿它去退 M2 的 12 支 —— 那支有自己的還原檔
--    (`supabase/rollbacks/20260917140000-rollback.sql`,它從還原表讀原值)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 閘:三支現在都必須是空字串(= 確實是本片造成的)═══════════════════════
DO $$
DECLARE
  sigs text[] := ARRAY[
    'public.pcm_op2b_reversal_amount()',
    'public.record_auth_callback_event(text,text,text)',
    'public.rls_auto_enable()'
  ];
  i int; v_oid oid; v_sp text; v_n int;
BEGIN
  FOR i IN 1 .. array_length(sigs, 1) LOOP
    v_oid := pg_catalog.to_regprocedure(sigs[i]);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '還原閘a:% 不存在 ⇒ 停(本檔只退 search_path, 不建函式)。', sigs[i];
    END IF;
    SELECT COALESCE(pg_catalog.array_length(p.proconfig, 1), 0), COALESCE(p.proconfig[1], '(未設)')
      INTO v_n, v_sp
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_sp <> 'search_path=""' THEN
      RAISE EXCEPTION
        E'還原閘b:% 的 search_path 現在是 %,不是空字串。\n'
        '⇒ 要嘛本片沒貼成, 要嘛貼完之後又有人動過。\n'
        '🛑 這時候寫回舊值會蓋掉別人的東西 ⇒ 停下回報, 不要改這道閘讓它過。', sigs[i], v_sp;
    END IF;
    -- 🔴 多一項就停:本檔的 ALTER 只寫 search_path, 而我要確認沒有別的 SET 被連帶影響過
    IF v_n <> 1 THEN
      RAISE EXCEPTION '還原閘c:% 的 proconfig 有 % 項(期望 1)⇒ 現況與本片貼完時不同, 停。', sigs[i], v_n;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 還原閘:三支都是 search_path="" 且 proconfig 只有 1 項 ⇒ 可以退';
END $$;

-- ══ 寫回原值 ═══════════════════════════════════════════════════════════════
-- 🔴 **不加單引號包住整串** —— `SET search_path = 'pg_catalog, public'` 會被存成
--    **帶雙引號的一個識別字**(`search_path="pg_catalog, public"`),與原值不逐字相同。
--    ⇒ 寫成裸的逗號分隔清單,與 `ALTER FUNCTION … SET search_path = public, pg_temp` 同一種寫法。
ALTER FUNCTION public.pcm_op2b_reversal_amount()                   SET search_path = pg_catalog, public;
ALTER FUNCTION public.record_auth_callback_event(text, text, text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.rls_auto_enable()                            SET search_path = pg_catalog;

-- ══ 事後斷言:三支都回到原值,逐字相符 ═════════════════════════════════════
DO $$
DECLARE
  expect text[][] := ARRAY[
    ARRAY['public.pcm_op2b_reversal_amount()',                 'search_path=pg_catalog, public'],
    ARRAY['public.record_auth_callback_event(text,text,text)', 'search_path=pg_catalog, pg_temp'],
    ARRAY['public.rls_auto_enable()',                          'search_path=pg_catalog']
  ];
  i int; v_sp text;
BEGIN
  FOR i IN 1 .. array_length(expect, 1) LOOP
    SELECT COALESCE(p.proconfig[1], '(未設)') INTO v_sp
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(expect[i][1]);
    IF v_sp <> expect[i][2] THEN
      RAISE EXCEPTION
        '還原事後斷言:% 退成 %,而期望 % ⇒ 整筆回捲。'
        '(若差別只在引號, 看本檔上面那段 🔴 —— 那是單引號包整串造成的)', expect[i][1], v_sp, expect[i][2];
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 還原事後斷言:三支都逐字退回原值';
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑 本檔證不到什麼
-- ① 它退的是 `search_path` 那一項,**不退 body / owner / ACL** —— 本片本來也沒動那些。
-- ② 退回去之後那三支**跑不跑得動**,本檔一樣證不到 —— 那要真的走一次那條路。
--    🔵 不過退回去的方向是**放寬** search_path ⇒ 比鎖緊安全:鎖緊會讓裸表名解析不到,放寬不會。
-- ═══════════════════════════════════════════════════════════════════════════
