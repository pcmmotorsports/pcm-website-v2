-- 20260902050000_m4b_rlsharden_bypassrls_watch.sql
-- ⟦b9-RLSHARDEN⟧ 甲:一支【會出聲的量具】—— service_role 還帶不帶 BYPASSRLS。
--
-- ══ 這一片為什麼存在(Sean 2026-09-02 上午第七批批准)════════════════════════
-- Sean 那一題的選項字面逐字含「**要新建一支資料庫函式**」⇒ 他看到那一格才點的頭。
-- 板 ⟦b9-RLSHARDEN⟧ 的威脅模型**不是攻擊者**,是【一個善意的、看起來完全正確的改動】:
-- 有人做一次安全強化(收 BYPASSRLS / RLS 嚴格化 / 換 service_role 用法)。
--   ⇒ 他改完打開後台 ⇒ **畫面有客戶、有列、有數字** ⇒ 看起來完全正常
--   ⇒ ⇒ 而每個人的訂單數是 **0**
-- 🔴 **空白會被發現, 而「有資料但全是 0」不會。**
--
-- ══ 🔴🔴 先讀這一段, 否則你會把本片讀成【已經被否決過的東西】═══════════════
-- `20260819160000_m4a_e2b_email_sweep_pgcron.sql:263` 逐字:
--   「**而我【不】為此加一道 `rolbypassrls` 的 RAISE**(R2 建議過、我一度加了、W6 R3 打掉)」
-- ⇒ 一個 grep `rolbypassrls` 的人**會先撞到那句**, 然後停手。
-- 🎯 **而它打掉的是另一種東西。三條理由【全部】只針對 apply-time 的 RAISE:**
--   · 「若 postgres 其實沒有它, 那道 RAISE 會讓一個【完全健康的系統】apply 失敗」
--   · 「拿一個 nice-to-have 去擋一支正在修『正式庫零封信』的檔, 是壞交易」
--   · 前例:「讓檢查【不依賴】那個屬性, 不是【要求】它成立」
-- 📌 **⇒ 三條講的都是【擋】的代價。而本片不擋任何東西 —— 它只看一眼然後說話。**
-- 📌 **⇒ 一道會中止部署的閘, 與一支會出聲的量具, 是兩種東西。**
-- 🔵 而它當年的第一條理由(「該屬性未查證」)**今天不成立了**:2026-09-02 線 `-0e` 唯讀實測
--    ⇒ 帶 BYPASSRLS 的角色 **6 個**(pcm_readonly / postgres / service_role / supabase_admin
--    / supabase_etl_admin / supabase_read_only_user);🟢 正對照 `pg_roles` 總數 **35**
--    (結果集不是空的);🔵 負對照 現造角色名 ⇒ **0 列**。
--
-- ══ 🛑 它證不到什麼(這一節與修法一樣重要, 不要只讀上面)═══════════════════
-- 本函式答:**「service_role 還帶不帶 BYPASSRLS」**
-- 本函式**不答**:**「哪些表會安靜回 0」** —— 那是另一個數字, 而它比較大。
--   ⛔ ~~40 張~~ ⇒ **45 張**開了 RLS 的表沒有給 service_role 一條可用的 SELECT 政策
--   (共 **54 張**開了 RLS;**2026-09-01 唯讀實測**。舊的 40/47 是 repo 內靜態估算、不是正式庫)。
--   ⚠️ **數字帶時點與分母跟著走** —— 要現值重跑 `docs/probes/2026-08-26-q15-rls-service-role-audit.sql`,
--      **不要抄這裡的數字**。全文 `docs/patterns/revoking-function-execute-in-supabase.md` 檔頭。
-- 📌 **⇒ 沒有這一節, 收到告警的人會以為「沒叫 = 沒事」, 而地板還是濕的。**
--
-- ══ 🔴 SECURITY INVOKER —— 而我第一版寫成 DEFINER, codex 2026-09-02 打掉(must-fix)══
-- ⛔ ~~我原本寫「`pg_roles` 一般是 world-readable, 而那個『一般是』我沒在本專案正式庫量過
--    ⇒ 照慣例走 SECDEF」~~ —— **那個理由站不住, 而它錯在【往取更多權限的方向】。**
-- ✅ codex 指出 `pg_roles` 是 **PostgreSQL 官方明定的公開可讀 view**
--    (https://www.postgresql.org/docs/16/view-pg-roles.html)⇒ 那是**三來源律的來源②(官方文件)**,
--    不是「我沒量過」。⇒ **我把一個查得到的事實當成了未知, 然後為那個未知多拿了權限。**
-- 🎯 **而 INVOKER 在這裡不只是權限小 —— 它的失敗模式【更正確】**:
--    真的讀不到 `pg_roles` 時它會**明確報錯**, 而呼叫端照本 repo 慣例把錯誤讀成
--    【查不到】(log + 503), 不是【沒事】。**SECDEF 會用建立者的權限把那個訊號蓋掉。**
-- 📌 **⇒ 一支專門偵測「有人多拿/少給權限」的量具, 自己不該多拿權限。**

BEGIN;

-- 🔴 **裸 `CREATE`, 不是 `CREATE OR REPLACE`**(同 `20260831170000:54` 的理由):這是新物件,
--    撞名要當場紅。`OR REPLACE` 會把撞名【靜靜蓋掉】, 而 REVOKE 與斷言照樣綠。
--    🔵 它同時解掉「`OR REPLACE` 保留舊 ACL」—— 裸 CREATE 沒有舊 ACL 可繼承。
-- 🔴 **整支包在一個 transaction 裡(codex must-fix)**:`CREATE FUNCTION` 出生就帶
--    **PUBLIC EXECUTE**, 而下面的 REVOKE 在它之後。若 Sean 的 SQL Editor 把每一段各自
--    autocommit ⇒ **CREATE 與 REVOKE 之間有一個任何角色都叫得到它的窗口**。
--    PostgreSQL 官方明文要求兩者同一個 transaction。⇒ `BEGIN; … COMMIT;`
CREATE FUNCTION public.get_privileged_role_bypassrls_state()
RETURNS jsonb
LANGUAGE sql
-- 🔵 **STABLE 不是 VOLATILE**:只讀 `pg_catalog.pg_roles`, 不碰牆上時鐘、不寫任何東西
--    ⇒ 「同一個 statement 內同樣輸入回同樣結果」這個承諾**是真的**(codex 複核:正確)。
--    (對照 `20260831170000:60` 那支被 codex 打成 VOLATILE 的 —— 它用了 `clock_timestamp()`,
--     而 STABLE 在那裡是一句謊話。**兩支的標記不同不是漂移, 是兩件不同的事實。**)
STABLE
-- 🔴 INVOKER(理由見檔頭那一節)。`search_path` 仍然清空, 且下面每個物件都全限定。
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    -- 🔴 本片唯一承重的那一格。三態要一起讀:
    --      true  ⇒ 屬性還在(今天的正常態)
    --      false ⇒ **屬性被收掉了** ⇒ 這就是要叫的那一格
    --      NULL  ⇒ `service_role` 這個角色不存在 ⇒ 【查不到】不是【沒事】
    'service_role_bypassrls',
      (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role'),
    -- 🔵 今天總共有幾個角色帶著它。基線 2026-09-02 = 6。
    'privileged_role_count',
      (SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.rolbypassrls),
    -- 🔵 `pg_roles` 總數(基線 2026-09-02 = 35)。**它是合理性分母, 不是判準。**
    -- ⛔ ~~我第一版寫「兩個 count 都是 0 ⇒ 尺沒接上」~~ —— **codex 打掉, 而它是對的**:
    --    讀不到 `pg_roles` 時整個 `SELECT` **會報錯**, 不會回一個帶 0 的 JSON;
    --    而一個健康的 PostgreSQL 至少存在【當下這個執行角色】⇒ `total_role_count = 0`
    --    **不是一個到得了的世界**。
    -- 🎯 ⇒ **所以「量不到」這件事根本不在回傳值裡, 它是一個 RPC error** ——
    --    呼叫端必須接住錯誤並記成【查不到】(本 repo anomaly-alert route 的既有慣例:
    --    log + 503), **不得等一個永遠不會出現的 0**。
    'total_role_count',
      (SELECT count(*) FROM pg_catalog.pg_roles)
  );
$fn$;

COMMENT ON FUNCTION public.get_privileged_role_bypassrls_state() IS
  '⟦b9-RLSHARDEN⟧ 甲:回報 service_role 還帶不帶 BYPASSRLS,給 anomaly-alert cron 當一道會出聲的量具。'
  '🔴 **它答的是【那個屬性還在不在】,不答【哪些表會安靜回 0】** —— 後者 2026-09-01 唯讀實測為 '
  '**45 張**(共 54 張開了 RLS);數字帶時點,要現值重跑 docs/probes/2026-08-26-q15-rls-service-role-audit.sql。'
  '🔴 `service_role_bypassrls` 三態:true=屬性還在 / false=**被收掉了,要叫** / NULL=該角色不存在=【查不到】。'
  '🔴 **而【量不到】不在回傳值裡** —— 讀不到 pg_roles 時整支 SELECT 會報錯,不會回一個帶 0 的 JSON;'
  '呼叫端必須接住 RPC error 並記成【查不到】(log + 503),**不得等一個永遠不會出現的 0**。'
  '🛑 為什麼這支存在而 20260819160000:263 說「不加 rolbypassrls 的 RAISE」:那句打掉的是 '
  '**apply-time 會中止部署的 RAISE**,三條理由全部只針對【擋】的代價;本支不擋任何東西。'
  '一道會中止部署的閘,與一支會出聲的量具,是兩種東西。';

-- ── 三道 REVOKE:授權從一個【已知的空狀態】長出來,不是疊在歷史上 ──────────────
-- 📎 判準與為什麼「少一道都是開的」見 docs/patterns/revoking-function-execute-in-supabase.md §1。
REVOKE ALL ON FUNCTION public.get_privileged_role_bypassrls_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_privileged_role_bypassrls_state()
  FROM anon, authenticated, service_role;
-- 🔵 第三道:連【被授權者本人】也先收掉(同 `20260831170000:229` 的理由)。
--    ⚠️ 裸 `CREATE` 之下它沒有舊 ACL 可繼承 ⇒ **原始理由不成立, 留著是因為它零成本、
--    且擋住「有人日後把它改回 `OR REPLACE`」那一天。理由變了, 字面留著。**
-- 🛑 **前置條件(codex nit)**:`payment_confirmer` 必須存在, 否則這一行就會中止整支
--    —— 那是 fail-closed、可接受, 而**寫出來比讓下一個人自己推好**。
--    (本 repo 71 支 migration 引用該角色 ⇒ 它不存在的世界代表環境本身不對。)
REVOKE ALL ON FUNCTION public.get_privileged_role_bypassrls_state()
  FROM payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_privileged_role_bypassrls_state()
  TO payment_confirmer;

-- ── 🔴 收權斷言(codex must-fix)——【不看 ACL 字面, 直接問 has_function_privilege】────
-- 為什麼需要它:上面四行只處理「直接授權」。**它們碰不到兩條路**:
--   ① `ALTER DEFAULT PRIVILEGES` 可能已經替別的角色留下明確 EXECUTE
--   ② `anon` / `authenticated` 若是 `payment_confirmer`(或其他被授權者)的成員
--      ⇒ 可透過**繼承或 SET ROLE** 執行得到
-- 📌 **⇒ 「我收了四道」與「他們真的執行不到」是兩個宣稱, 而只有後者是我要的。**
-- 🔵 形狀沿用 `20260902040000:116` 那一段(同一夜、同一個作者、已過 codex)。
-- 🔴 **物件用【具名清單陣列】列出來, 不要 inline**(靜態閘 ③ 擋下我第一版):
--    那道閘比對「本檔可授權物件數」vs「斷言清單長度」, 而它逐字寫著
--    「收權斷言**只檢查你列出來的物件**:它防【忘記收權】, 不防【忘記列】」。
--    ⇒ 我第一版把單一物件 inline 進 `to_regprocedure(...)` ⇒ 功能一樣, 而**閘數到 0**
--    ⇒ 📌 **一個「我只有一個物件所以不用陣列」的簡化, 把那道閘的分母變成空的。**
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.get_privileged_role_bypassrls_state()'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 仍有 EXECUTE ⇒ 可能來自 ALTER DEFAULT PRIVILEGES 或角色成員關係(三道 REVOKE 收不到)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 仍有 EXECUTE(本支刻意只給 payment_confirmer)⇒ 拒繼續', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收太多)⇒ 呼叫端會被 42501 擋掉 ⇒ 拒繼續', r;
    END IF;
  END LOOP;
END
$grant_assert$;

COMMIT;
