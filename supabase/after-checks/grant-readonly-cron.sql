-- ══════════════════════════════════════════════════════════════════════════
-- 🔵 **本檔進版控的理由與位置**(2026-09-05 線【DB】`-db`;主視窗 `-f8` 派「進版控」)
-- ══════════════════════════════════════════════════════════════════════════
--   放這裡而**不是** `supabase/migrations/`, 是 2026-09-05 codex 對抗審查的 must-fix:
--   🔴 `cron.job.command` 那一欄**可能含 `Authorization` 標頭或金鑰**;
--      若把這三條寫進會被**自動重播**的 migration, 那麼任何一個裝了 `pg_cron` 的新庫
--      都會**自動**把那一欄開給一個唯讀角色 —— 而那不是任何人要求的。
--   ⇒ 📌 `supabase/after-checks/` 是本 repo 放「**給人貼的授權**」的地方
--      (同目錄的 `grant-readonly-select-search-refunds.sql` 是同一個慣例)。
--
--   🔬 **而它今天已經是【紀錄】不是【待辦】** —— 2026-09-05 唯讀實測正式庫:
--        has_schema_privilege('pcm_readonly','cron','USAGE')            ⇒ **t**
--        has_table_privilege('pcm_readonly','cron.job','SELECT')        ⇒ **t**
--        has_table_privilege('pcm_readonly','cron.job_run_details',…)   ⇒ **t**
--      正對照 `orders` SELECT = t · 負對照 `orders` INSERT = f(尺是活的)
--   ⇒ ✅ **不用再貼**。留在版控是為了讓下一個人查得到「那三格是怎麼來的」。
--   ⚠️ 而下面那段檔頭是**貼之前**寫的, 它逐字說「Sean 貼了沒我證不出來」——
--      🔵 **今天證出來了:生效了。** 舊字面保留, 讓讀到那句的人同一發撞到這個訂正。
-- ══════════════════════════════════════════════════════════════════════════

-- 🔴🔴 **[2026-09-05 11:4x · 訂正我自己 40 分鐘前貼在這裡的『作廢』]**
--    ⛔ ~~作廢:postgres 不是 cron schema 擁有者的成員, 貼了 rc 也是拒~~ —— **那句話是錯的。**
--    ✅ **這支可以貼, 而且會成功。** 當場量到(唯讀正式庫, aclexplode 逐筆展開):
--       postgres 對 schema cron 的 USAGE            ⇒ is_grantable = **t**(ACL 原文 `postgres=U*/supabase_admin`, 那個 `*` 就是它)
--       postgres 對 cron.job / job_run_details 的 SELECT ⇒ is_grantable = **t**
--    🔴 **我錯在哪**:我拿「`pg_has_role('postgres','supabase_admin','MEMBER') = f`」推出「postgres 不能授權」。
--       那條推理對 **storage** 那次是對的(那裡的 grantor 沒有給轉授權),
--       而**轉授權(grant option)是一條獨立的路** —— 不是成員也可以轉授, 只要對方給了 `*`。
--       📌 **一個【相關而錯】的先例, 比沒有先例更容易關掉我的懷疑** —— 那條 memory 我今天才引用過兩次。
--    🔵 而 `pcm_readonly` 今天的實況:`USAGE = f` · `SELECT = t`(SELECT 是 **PUBLIC** 給的, 不是我們給的)
--       ⇒ **它差的只有 schema 的 USAGE 那一行**;下面兩行 GRANT SELECT 是多餘的(貼了也不會錯)。
--    🛑 而「Sean 貼了沒」我證不出來 —— 只證得出**現在沒有生效**。
-- ──────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- 給 `pcm_readonly` 讀 `cron` 的最小權限
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **這是一個【授權】,不是一個修正 —— 只有 Sean 貼。**
--    任何 session 都不得代跑。唯讀查證與 apply 是兩個授權,而這一支是後者。
--
-- 為什麼要它:2026-09-05 06:1x 唯讀實測 —— `pcm_readonly` 問 `cron.job` 得到
--   `ERROR: permission denied for schema cron`,而 `cron` 的 ACL 是
--   `{supabase_admin=UC/supabase_admin, postgres=U*/supabase_admin}` ⇒ 只有那兩個角色。
--   ⇒ 🛑 **「六條排程各跑幾次 / 有沒有 failed」這個問題,唯讀角色結構上答不了。**
--   📌 而它印的是 `permission denied` **不是 `0`** —— 兩者在報告上很容易被壓成同一句
--      (「排程沒問題」)。這一片讓那個問題有答案。
--
-- 🛑 **範圍(逐字)**:`USAGE` 一個 schema + `SELECT` 兩張表,給**一個**角色。
--    · **不給** INSERT / UPDATE / DELETE ⇒ 它**不能**排新工作、不能改排程、不能刪紀錄。
--    · **不給** `cron.schedule()` / `cron.unschedule()` 的 EXECUTE。
--    · ⚠️ 而 `pcm_readonly` **帶 `BYPASSRLS`**(2026-09-05 實測)——
--      `cron` 那兩張表本來就沒有 RLS,所以這一格不影響;寫出來是因為**下一個人會問**。
--    · 🔴 `cron.job.command` 那一欄**可能含 `Authorization` 標頭或金鑰**
--      ⇒ 給了 SELECT 就是**給看得到那一欄**。**這是這一片真正的代價,不是那三行 SQL。**
--        ⇒ 讀它的人不得把 `command` 原文印進對話或報告(既有紀律,這裡重申)。
--
-- ✅ 貼完怎麼驗(兩個世界,不是只看「不再報錯」):
--      貼前 `SELECT has_schema_privilege('pcm_readonly','cron','USAGE');`   ⇒ f
--      貼後 同一句                                                          ⇒ t
--    ⚠️ 只看「不再報錯」不夠 —— 那在「schema 被刪掉」的世界裡也不報錯。
--
-- ↩️ Rollback(兩行,貼下去就回到原狀):
--      REVOKE SELECT ON cron.job, cron.job_run_details FROM pcm_readonly;
--      REVOKE USAGE ON SCHEMA cron FROM pcm_readonly;
--    ⚠️ 順序:先收表再收 schema。反過來也行,而先收 schema 會讓第二行**看起來**成功
--      (它收的是一個你已經看不到的東西)⇒ 照上面的順序,兩行都有意義。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '角色 pcm_readonly 不存在 ⇒ 拒繼續(名字打錯要在這裡就停)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron') THEN
    RAISE EXCEPTION 'schema cron 不存在 ⇒ 這個庫沒有 pg_cron, 拒繼續';
  END IF;
END $$;

GRANT USAGE ON SCHEMA cron TO pcm_readonly;
GRANT SELECT ON cron.job              TO pcm_readonly;
GRANT SELECT ON cron.job_run_details  TO pcm_readonly;

-- ── 事後斷言(GRANT 是我寫的動作, 這一段是量到的結果)──────────────────
DO $$
DECLARE v_u boolean; v_j boolean; v_d boolean;
BEGIN
  v_u := pg_catalog.has_schema_privilege('pcm_readonly','cron','USAGE');
  v_j := pg_catalog.has_table_privilege('pcm_readonly','cron.job','SELECT');
  v_d := pg_catalog.has_table_privilege('pcm_readonly','cron.job_run_details','SELECT');
  IF NOT (v_u AND v_j AND v_d) THEN
    RAISE EXCEPTION '事後斷言失敗:USAGE=% job=% run_details=% ⇒ 拒 COMMIT', v_u, v_j, v_d;
  END IF;
  -- 🔵 負對照:同一把尺對【本片沒給的】要印 f —— 否則三個 t 可能是這把尺對什麼都印 t。
  IF pg_catalog.has_table_privilege('pcm_readonly','cron.job','INSERT') THEN
    RAISE EXCEPTION '🔴 負對照失敗:pcm_readonly 竟然可以 INSERT cron.job ⇒ 本片只該給 SELECT, 拒 COMMIT';
  END IF;
  RAISE NOTICE '✅ USAGE + 兩張表的 SELECT 都到位, 而 INSERT 沒有被順手給出去';
END $$;

COMMIT;
