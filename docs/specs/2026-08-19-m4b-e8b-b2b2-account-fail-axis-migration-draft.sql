-- ═══════════════════════════════════════════════════════════════════════════
--  B2-b-2 · 失敗計數加【帳號軸】—— login_attempts 加欄 + 兩支函式改簽章
--
--  🔴🔴 這是【草稿】,不是可以直接 apply 的東西。
--     · 目標庫:報價單(project dllwkkfanaebrsuyuedy),不是 A 庫
--     · apply 管道:MCP apply_migration,【需要 Sean 在場】
--       (報價單 repo 明文禁 supabase db push)
--     · 🔴 **刻意不放進報價單 repo 的 `supabase/migrations/`**(主視窗 2026-08-19 裁定):
--       放進去的每一支都在下一發 `db push` 的射程內;而同夜已被坐實 ——
--       `20260819010000` 躺在那個目錄裡、根本 apply 不了,擋了整晚的 push。
--     · 前置:B2-a 的 code 已上線(9d79f34);本支【不依賴】admin_user_staff_map
--
--  ── 本支做什麼 ─────────────────────────────────────────────────────────
--  1. login_attempts 加 account_key text(可為 NULL)
--     🔴 存的是 sha256 十六進位,【不是信箱原文】:
--        · 這張表 service_role 讀得到 ⇒ 存原文等於讓限速帳本變成一份員工名單
--        · 而「某個帳號被打了幾次」仍查得到 —— 拿已知帳號算出雜湊再查即可
--        · 與 app 端 lib/account-bucket.ts 的桶鍵【共用同一個雜湊來源】(單一真相)
--  2. 部分索引,形狀照既有的 login_attempts_ip_at_idx(2026-08-19 實查該索引存在)
--  3. login_fail_window / check_and_record_login_fail 兩支加 p_account_key
--     🔴 用 DROP + CREATE 不用 CREATE OR REPLACE:
--        · 改簽章時 OR REPLACE 會【新增一個多載】而不是取代 ⇒ 兩個並存 ⇒ PostgREST 選誰不確定
--        · check_and_record_login_fail 還改了回傳型別,OR REPLACE 本來就不允許
--        · DROP 不帶 IF EXISTS ⇒ 物件不在時【當場紅】,不靜默跳過
--        · 兩者在【同一個交易內】⇒ 不存在「函式消失」的窗口
--  4. 🔴 多一道 advisory lock:現有那道只鎖 (ip|stage)。
--     50 個不同 IP 同時打【同一個帳號】⇒ 全部讀到舊計數、一起放行
--     —— 那正是當初加 IP 鎖要修的同一個病,只是換到新的軸上。
--     兩道鎖【固定順序:先 ip 後 account】⇒ 不會死鎖。
--
--  ── 🔴 出事怎麼退(反向,照順序)───────────────────────────────────────
--    BEGIN;
--    DROP FUNCTION public.check_and_record_login_fail(inet, text, text, integer, text);
--    DROP FUNCTION public.login_fail_window(inet, text, timestamptz, text);
--    -- 然後把改動前的原文貼回去 CREATE(原文為 2026-08-19 實查 pg_get_functiondef)
--    -- 🔴 **貼回去之後 ACL 一樣要重裝**(DROP 帶走 ACL 是雙向的):
--    --    REVOKE ALL ON FUNCTION <舊簽章> FROM PUBLIC;  GRANT EXECUTE … TO service_role;  兩支都要
--    DROP INDEX public.login_attempts_account_at_idx;
--    ALTER TABLE public.login_attempts DROP COLUMN account_key;
--    COMMIT;
--    ⚠️ 退掉欄位會【丟掉已記的帳號軸資料】。若只是要停用本功能,app 端不傳 p_account_key 即可
--       (兩支函式的新參數都有 DEFAULT NULL ⇒ 舊呼叫形狀原封可用)⇒ **優先走這條,不要先 DROP COLUMN。**
--
--  ⚠️ 前提:所有語句在同一個 session。statement-mode pooler 下 BEGIN 無效且零警告。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 前置斷言(fail-closed;世界不是我以為的樣子就當場停)──────────────────
DO $$
BEGIN
  IF to_regclass('public.login_attempts') IS NULL THEN
    RAISE EXCEPTION '前置不成立:public.login_attempts 不存在';
  END IF;

  -- 🔴 冪等閘【必須排在形狀閘之前】(2026-08-19 拋棄式 PG 負向對照抓到):
  --   排在後面的話,重跑一次會先撞上「欄數不是 6(實際 7)」——
  --   而【已經 apply 過】與【別人加了一欄】會印出【一模一樣的訊息】,操作者分不出是哪一種。
  --   本閘不只是多一道檢查,它是讓那兩個世界說出不同的話的唯一一行。
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='login_attempts'
                AND column_name='account_key') THEN
    RAISE EXCEPTION '本支疑似已 apply:account_key 已存在 ⇒ 不要重跑,先確認上一次的落地斷言有沒有過';
  END IF;

  -- 形狀閘:改動前應為 6 欄(id/at/ip/ua/stage/outcome);多一欄少一欄都表示世界變了
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='login_attempts') <> 6 THEN
    RAISE EXCEPTION '前置不成立:login_attempts 欄數不是 6(實際 %),本支的假設已過期',
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='login_attempts');
  END IF;

  -- 兩支函式必須是【改動前那個簽章】才動得下去
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='login_fail_window'
       AND pg_get_function_arguments(p.oid) = 'p_ip inet, p_stage text, p_since timestamp with time zone'
  ) THEN
    RAISE EXCEPTION '前置不成立:login_fail_window 的簽章不是預期的三參數版';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='check_and_record_login_fail'
       AND pg_get_function_arguments(p.oid) = 'p_ip inet, p_ua text, p_stage text, p_window_seconds integer'
  ) THEN
    RAISE EXCEPTION '前置不成立:check_and_record_login_fail 的簽章不是預期的四參數版';
  END IF;
END $$;

-- ── 1. 加欄 ────────────────────────────────────────────────────────────────
ALTER TABLE public.login_attempts ADD COLUMN account_key text;

COMMENT ON COLUMN public.login_attempts.account_key IS
  '具名登入嘗試的帳號軸鍵 = sha256(正規化後的信箱) 的十六進位前 32 字元;'
  '共用密碼(備援)登入與本欄無關 ⇒ 那些列一律 NULL。'
  '🔴 刻意不存信箱原文:本表 service_role 讀得到,存原文會讓限速帳本變成一份員工名單。'
  '要查「某個帳號被打了幾次」仍然可以 —— 拿已知帳號算出同一個雜湊再查。'
  '🔴 雜湊的唯一真相在 app 端 lib/account-bucket.ts;改那裡的算法會讓本欄的歷史值對不起來,'
  '   而【沒有任何東西會紅】(舊列仍在、只是再也匹配不到)。';

-- ── 2. 索引(形狀照既有 login_attempts_ip_at_idx)────────────────────────────
CREATE INDEX login_attempts_account_at_idx
  ON public.login_attempts (account_key, at DESC)
  WHERE outcome = 'fail';

-- ── 3. login_fail_window:加 p_account_key ─────────────────────────────────
DROP FUNCTION public.login_fail_window(inet, text, timestamptz);

CREATE FUNCTION public.login_fail_window(
  p_ip          inet,
  p_stage       text,
  p_since       timestamptz,
  p_account_key text DEFAULT NULL
)
RETURNS TABLE(fail_count bigint, last_fail_at timestamptz)
LANGUAGE sql
SET search_path TO ''
AS $function$
  select count(*)::bigint, max(at)
  from public.login_attempts
  where (p_ip is null or ip = p_ip)
    and (p_account_key is null or account_key = p_account_key)
    and stage = p_stage and outcome = 'fail' and at > p_since;
$function$;

-- ── 4. check_and_record_login_fail:加 p_account_key + 多回一個帳號軸計數 ────
DROP FUNCTION public.check_and_record_login_fail(inet, text, text, integer);

CREATE FUNCTION public.check_and_record_login_fail(
  p_ip             inet,
  p_ua             text,
  p_stage          text,
  p_window_seconds integer,
  p_account_key    text DEFAULT NULL
)
RETURNS TABLE(
  fail_count           bigint,      -- per-IP 窗內失敗數(原有語意,不變)
  last_fail_at         timestamptz, -- 同上
  account_fail_count   bigint,      -- 🆕 帳號軸窗內失敗數;p_account_key 為 NULL 時回 0
  account_last_fail_at timestamptz  -- 🆕 同上;為 NULL 時回 NULL
)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
begin
  -- 🔴 兩道 advisory lock,【固定順序:先 ip 後 account】。
  --   順序固定是唯一防死鎖的東西 —— 兩個交易若一個先鎖 ip、另一個先鎖 account,就會互等。
  --   只鎖 ip 不夠:50 個不同 IP 同時打同一個帳號會全部讀到舊計數一起放行
  --   (= 當初加 ip 鎖要修的同一個病,換到新的軸上)。
  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(host(p_ip), '') || '|' || coalesce(p_stage, ''), 0)
  );
  if p_account_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('acct|' || p_account_key || '|' || coalesce(p_stage, ''), 0)
    );
  end if;

  insert into public.login_attempts (ip, ua, stage, outcome, account_key)
  values (
    p_ip,
    case when p_ua is null then null else left(p_ua, 300) end,
    p_stage,
    'fail',
    p_account_key
  );

  return query
    select
      -- per-IP(原有語意逐字不變)
      (select count(*)::bigint from public.login_attempts
        where (p_ip is null or ip = p_ip)
          and stage = p_stage and outcome = 'fail'
          and at > now() - make_interval(secs => p_window_seconds)),
      (select max(at) from public.login_attempts
        where (p_ip is null or ip = p_ip)
          and stage = p_stage and outcome = 'fail'
          and at > now() - make_interval(secs => p_window_seconds)),
      -- 🆕 帳號軸。🔴 p_account_key 為 NULL 時【回 0 不回全庫總數】——
      --   回全庫總數會讓備援登入吃到別人的帳號軸鎖(「量了 A 拿去答 B」)。
      case when p_account_key is null then 0::bigint else
        (select count(*)::bigint from public.login_attempts
          where account_key = p_account_key
            and stage = p_stage and outcome = 'fail'
            and at > now() - make_interval(secs => p_window_seconds)) end,
      case when p_account_key is null then null::timestamptz else
        (select max(at) from public.login_attempts
          where account_key = p_account_key
            and stage = p_stage and outcome = 'fail'
            and at > now() - make_interval(secs => p_window_seconds)) end;
end;
$function$;

-- ── 5. 🔴🔴 把 ACL 裝回去(W6-059 M1)────────────────────────────────────────
--  **`DROP FUNCTION` 刪的是函式【與它的 ACL】。`CREATE` 出來的新函式吃預設,
--    而 PG 對函式的預設是 `EXECUTE TO PUBLIC`。**
--  ⇒ 不裝回去的話, 一道【有人刻意寫下的】縱深防線會在沒有人察覺的情況下消失。
--
--  🔴 **而為什麼拋棄式 PG 測不出來**(這一格比修法本身值錢):
--     鑽機裡只有 `postgres` 一個角色, 而它是 owner ⇒ 不論 ACL 怎樣它都叫得動
--     ⇒ **「應用層照常會動」在兩個世界裡長得一模一樣。**
--
--  正式庫實測(2026-08-19, MCP `pg_proc.proacl`), 這就是要還原的目標:
--     login_fail_window / check_and_record_login_fail 皆為
--       postgres=X/postgres, service_role=X/postgres      ⇒ **PUBLIC 沒有條目**
--  ⚠️ **今天的爆炸半徑**(W6 說他沒量, 本窗補量):兩支都【不是】SECURITY DEFINER ⇒ 以 caller 身分跑;
--     而 `login_attempts` 的表 ACL = postgres / service_role 兩個、RLS 開、
--     `has_table_privilege('anon', …, 'INSERT'/'SELECT')` ⇒ 皆 f
--     ⇒ **anon 就算叫得動函式, 也會被表權限擋下。**
--     ⇒ 所以這一條【今天不會爆】—— 而它是縱深, 縱深的意義就是「不靠另一層剛好還在」。
REVOKE ALL ON FUNCTION public.login_fail_window(inet, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_fail_window(inet, text, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.check_and_record_login_fail(inet, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_record_login_fail(inet, text, text, integer, text) TO service_role;

-- ── 落地斷言(fail-closed;做完的世界不是預期的樣子就整支回滾)───────────────
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='login_attempts'
                    AND column_name='account_key' AND data_type='text'
                    AND is_nullable='YES') THEN
    RAISE EXCEPTION '落地斷言失敗:account_key 不存在或型別/可空性不符';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='login_attempts_account_at_idx') THEN
    RAISE EXCEPTION '落地斷言失敗:login_attempts_account_at_idx 不存在';
  END IF;

  -- 🔴 恰一支:多載沒清乾淨的話 PostgREST 選誰是不確定的
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='login_fail_window') <> 1 THEN
    RAISE EXCEPTION '落地斷言失敗:login_fail_window 不是恰一支(實際 %)',
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='login_fail_window');
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='check_and_record_login_fail') <> 1 THEN
    RAISE EXCEPTION '落地斷言失敗:check_and_record_login_fail 不是恰一支(實際 %)',
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_and_record_login_fail');
  END IF;

  -- 新簽章逐字對(只數「有一支」擋不住「改成了別的形狀」)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='login_fail_window'
       AND pg_get_function_arguments(p.oid)
           = 'p_ip inet, p_stage text, p_since timestamp with time zone, p_account_key text DEFAULT NULL::text'
  ) THEN
    RAISE EXCEPTION '落地斷言失敗:login_fail_window 的新簽章不符(實際 %)',
      (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='login_fail_window');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='check_and_record_login_fail'
       AND pg_get_function_arguments(p.oid)
           = 'p_ip inet, p_ua text, p_stage text, p_window_seconds integer, p_account_key text DEFAULT NULL::text'
  ) THEN
    RAISE EXCEPTION '落地斷言失敗:check_and_record_login_fail 的新簽章不符(實際 %)',
      (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_and_record_login_fail');
  END IF;

  -- 🔴🔴 ACL allowlist 斷言(W6-059 M1)。兩支各驗兩件, 缺一不可:
  --   ① proacl **不得是 NULL** —— NULL = 預設 = EXECUTE TO PUBLIC。
  --      🔴 而 `aclexplode(NULL)` 回【零列】⇒ 只寫下面那道 EXISTS 的話,
  --         **最壞的那個世界(全開)會讓斷言【靜靜地通過】。** 這一行是那道檢查的前提, 不是贅句。
  --   ② 受贈者只准 {owner, service_role}; grantee = 0 就是 PUBLIC。
  FOR r IN
    SELECT 'public.login_fail_window(inet,text,timestamptz,text)'::regprocedure AS oid
    UNION ALL
    SELECT 'public.check_and_record_login_fail(inet,text,text,integer,text)'::regprocedure
  LOOP
    IF (SELECT proacl FROM pg_proc WHERE oid = r.oid) IS NULL THEN
      RAISE EXCEPTION '落地斷言失敗:% 的 proacl 是 NULL(= 預設 EXECUTE TO PUBLIC),REVOKE/GRANT 沒生效', r.oid;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = r.oid
         AND (a.grantee = 0 OR a.grantee NOT IN (p.proowner, 'service_role'::regrole::oid))
    ) THEN
      RAISE EXCEPTION '落地斷言失敗:% 的 ACL 有白名單外的受贈者(實際 %)',
        r.oid, (SELECT array_to_string(proacl, ' | ') FROM pg_proc WHERE oid = r.oid);
    END IF;
  END LOOP;
END $$;

COMMIT;
