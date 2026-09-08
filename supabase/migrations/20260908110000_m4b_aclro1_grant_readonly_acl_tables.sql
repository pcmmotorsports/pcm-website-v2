-- ═══ 貼板 105:讓唯讀帳號讀得到那兩張 ACL 稽核物件 ═══
-- 🔴🔴 **版本號 2026-09-08 換過一次:⛔ ~~20260908100000~~ ⇒ ✅ 20260908110000**
--   原因:`20260908100000` 在 `dev` 與 `agent/line-auth` 上**已經被 `…_customers_email_update_grant.sql` 用掉了**。
--   🛑 而我本地那兩道版本號閘**都印綠** —— 它們證明的是別的東西:
--     `migration-version-collision-gate.py` 只看【本 worktree 的 index/樹】, 而 dev 那支不在我這棵
--     `migration-version-dup-across-lines.sh` 掃的是【ref】, 而我這支還沒 commit ⇒ 那個綠 = 「還沒進 ref」
--   ⇒ 📌 **兩個綠都是真的, 而它們回答的都不是我要問的那一題。**
--   ✅ 自己複量的做法(97 個 ref 逐個問):
--     `for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do`
--     `  git ls-tree -r --name-only "$r" supabase/migrations/ | grep -c '<版本號>'; done`
--     ⇒ `20260908110000` 在 97 個 ref 上**零命中**。🔴 **而 commit 之後要再跑一次 dup-across-lines。**
-- 出板:線【DB】-db, 2026-09-08。Sean 拍 Q3=A, 逐字:
--   「A = 開。它只能看不能改, 而開了之後上面兩件就答得出來」
--
-- 🔴 只給 SELECT。不動 service_role、不給 USAGE 以外的任何東西、不碰 auth schema。
--    (auth schema 那一格是【另一件】—— 它是 Supabase 的系統 schema, 風險不同級,
--     我拆出去讓 Sean 分開拍。見 ~/pcm-mailbox/端Sean-auth-schema-唯讀-db-20260908.md)
--
-- 🔴🔴 **貼之前要知道的一件(而它不是這一支造成的)**:
--    `pcm_readonly` 的 `rolbypassrls = t`(2026-09-08 唯讀實查)
--    ⇒ 📌 **給它 SELECT = 它看得到那張表的【每一列】, RLS 擋不住它。**
--    對這兩個物件而言那正是要的(它們就是稽核用的全量快照), 而**這句要寫在這裡**,
--    因為下一個人拿這支當範本去 GRANT 別張表時, 那個前提仍然成立。
--
-- 🔬 現況(2026-09-08 唯讀實查, 判準用 has_table_privilege 不用 ACL 字面):
--    pcm_acl_drift_status     pcm_readonly SELECT = f
--    pcm_acl_snapshot_digest  pcm_readonly SELECT = f
--    🟢 正對照 public.orders                      = t(不該被本支影響)
--    ⚪ 負對照 dbk_external_id_rename_20260904     = f(不該被本支影響)
--    分母:public 的 96 張表/view 裡, pcm_readonly 讀不到 26 張
--    ⛔ 主視窗轉述的「兩者現況都是 service_role=r / payment_confirmer=r」**只有前一張成立** ——
--       `pcm_acl_snapshot_digest` 的 ACL 裡**只有 postgres**, 兩個都沒有。舊字面留在這裡。
--
-- 🛑 這一支【不盲貼】:前置閘先問現況, 已經有權限就停下(不重複 GRANT)。

BEGIN;

DO $gate$
DECLARE v_miss text;
BEGIN
  -- 前置閘① 角色在
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '貼板105 前置閘①:角色 pcm_readonly 不存在 ⇒ 停';
  END IF;

  -- 前置閘② 兩個物件都在
  SELECT string_agg(x, ', ') INTO v_miss FROM (
    SELECT 'public.pcm_acl_drift_status' AS x
     WHERE to_regclass('public.pcm_acl_drift_status') IS NULL
    UNION ALL
    SELECT 'public.pcm_acl_snapshot_digest'
     WHERE to_regclass('public.pcm_acl_snapshot_digest') IS NULL
  ) t;
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '貼板105 前置閘②:這些物件不存在 ⇒ 停:%', v_miss;
  END IF;

  -- 前置閘③ 現在【還沒有】權限 —— 已經有了就停(不重複 GRANT, 也避免蓋掉別人剛做的事)
  IF has_table_privilege('pcm_readonly','public.pcm_acl_drift_status','SELECT')
     OR has_table_privilege('pcm_readonly','public.pcm_acl_snapshot_digest','SELECT') THEN
    RAISE EXCEPTION '貼板105 前置閘③:pcm_readonly 已經讀得到其中至少一個 ⇒ 停, 先去確認是誰給的';
  END IF;

  -- 前置閘③b 🔴🔴 **不再逐項列舉權限 —— 改成把 `pcm_readonly` 的【全量授權】拍一張快照。**
  --   codex 兩輪共 11 條 must-fix, 而 R2 那 6 條【全部落在同一個維度】:
  --     欄級授權(`attacl`)· `WITH GRANT OPTION`(`is_grantable`)· 別的 schema。
  --   ⇒ 📌 **逐項列舉是在跟「下一個我沒想到的維度」賽跑** —— 那是黑名單。
  --   ⇒ ✅ 改成白名單:**拍前後兩張全量快照, 斷言差集【剛好等於】我要給的那兩列。**
  --     多一列少一列都紅, 而它不需要知道那一列是哪一種權限。
  CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
    SELECT n.nspname AS sch, c.relname AS rel, NULL::text AS col,
           a.privilege_type AS priv, a.is_grantable AS grantable,
           a.grantor::regrole::text AS grantor
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(coalesce(c.relacl,
             acldefault(CASE c.relkind WHEN 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a
     WHERE a.grantee = 'pcm_readonly'::regrole
    UNION ALL
    SELECT n.nspname, c.relname, at.attname,
           a.privilege_type, a.is_grantable, a.grantor::regrole::text
      FROM pg_attribute at
      JOIN pg_class c ON c.oid = at.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(at.attacl) a
     WHERE at.attnum > 0 AND NOT at.attisdropped
       AND a.grantee = 'pcm_readonly'::regrole;
  -- 🔵 這個 NOTICE 印的是【貼的當下】的 runtime 值, 不是下面那個 2026-09-08 的讀數。
  --    兩者不同是正常的(中間有人動過權限)⇒ 不要把它讀成出事。
  RAISE NOTICE '貼板105 前置閘③b:pcm_readonly 貼前共有 % 筆授權(表級+欄級, 全 schema;2026-09-08 唯讀實查時是 81)',
    (SELECT count(*) FROM _acl_before);

  -- 前置閘③c 🔴 **那兩個目標物件上, 貼前必須【一筆授權都沒有】**(表級或欄級都算)。
  --   理由是還原檔:它下的是整個物件的 `REVOKE ALL`
  --   ⇒ 若貼前已有【別人給的欄級授權】, 還原會把那一份也收掉 ⇒ 📌 我們會刪掉不是我們給的東西。
  --   🔬 2026-09-08 唯讀實查(那一刻的值, 不是恆值):`pcm_readonly` 全庫已有 **9 筆欄級授權**(在別的物件上),
  --     而那兩個目標物件上是 **0 筆** ⇒ 今天這道閘不會擋。
  --     ⚠️ 而它明天可能會 —— 那正是它存在的理由。
  IF EXISTS (SELECT 1 FROM _acl_before
              WHERE sch = 'public'
                AND rel IN ('pcm_acl_drift_status','pcm_acl_snapshot_digest')) THEN
    RAISE EXCEPTION '貼板105 前置閘③c:那兩個目標物件上 pcm_readonly 已有授權(表級或欄級)⇒ 停 —— 還原檔的 REVOKE ALL 會把它一起收掉';
  END IF;

  -- 前置閘③d 🔴 **角色繼承那條路**(codex R3 must-fix ②):
  --   ACL 的 grantee 可能是【上游角色】而不是 pcm_readonly 本人 ⇒ 直接 ACL 快照看不到它,
  --   而 pcm_readonly 仍然讀得到。⇒ 📌 那張 81 筆的快照是【直接授權】不是【有效權限】。
  --   ✅ 而今天它成立的理由是量到的:pcm_readonly **不是任何角色的成員**
  --     (⚪ 尺自檢:同法問 postgres ⇒ 印出一長串 ⇒ 那把尺會動)。
  --   ⇒ 🔴 **這道閘把那個前提釘住** —— 哪天有人把它加進某個角色, 這一支會停下來。
  IF EXISTS (SELECT 1 FROM pg_auth_members m
              WHERE m.member = 'pcm_readonly'::regrole) THEN
    RAISE EXCEPTION '貼板105 前置閘③d:pcm_readonly 是某個角色的成員 ⇒ 直接 ACL 快照不再等於有效權限 ⇒ 停';
  END IF;

  -- 前置閘③e 🔴🔴 **有權限 ≠ 讀得到列**(codex R3 must-fix ③):
  --   🔬 實查(2026-09-08, 唯讀連線):`pcm_acl_snapshot_digest` 的 **RLS 開著而 policy 數 = 0**
  --     ⇒ PostgreSQL 的 default-deny ⇒ **一個 NOBYPASSRLS 的角色會讀到零列**,
  --       而 `has_table_privilege` 照樣回 t、本支每一道閘照樣綠。
  --   ⇒ 📌 **本支今天有用, 只因為 pcm_readonly 帶 BYPASSRLS。**
  --     ⚠️ 而**現在有一條線正在做 RLS 收緊** —— 那天若把 BYPASSRLS 收掉,
  --     這個授權會【安靜地變成零列】, 而沒有任何一道尺會叫。
  --   ⇒ ✅ 這道閘把那個前提也釘住, 並且 105b 另外做一次【真的讀一列】。
  --   ⚠️ **射程只涵蓋 `pcm_acl_snapshot_digest`**(code-reviewer 抓到我原句過寬):
  --     `pcm_acl_drift_status` 是 **definer view**(`security_invoker` 未開)⇒ 它以 owner 身分讀底表
  --     ⇒ **收掉 BYPASSRLS 它照樣讀得到列。** 這道閘那天會把還能用的那一半一起擋掉,
  --     而那是**刻意往安全那邊倒**:寧可整支停下來讓人判, 不要留一半能用一半安靜空的。
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='pcm_readonly') THEN
    RAISE EXCEPTION '貼板105 前置閘③e:pcm_readonly 沒有 BYPASSRLS, 而 pcm_acl_snapshot_digest 的 RLS 開著且零 policy ⇒ 那張【表】給了 SELECT 也讀不到列(view 那半不受影響)⇒ 停, 先補 policy';
  END IF;

  -- 前置閘④ 🟢 正對照 —— 這把尺要能印出 t, 否則上面那三個 f 不算數
  IF NOT has_table_privilege('pcm_readonly','public.orders','SELECT') THEN
    RAISE EXCEPTION '貼板105 前置閘④:正對照失敗(pcm_readonly 對 public.orders 應為 t)⇒ 這把尺沒接上, 停';
  END IF;

  RAISE NOTICE '貼板105 前置閘四道全過:角色在 · 物件在 · 尚無權限 · 正對照 t';
END
$gate$;

GRANT SELECT ON public.pcm_acl_drift_status    TO pcm_readonly;
GRANT SELECT ON public.pcm_acl_snapshot_digest TO pcm_readonly;

DO $post$
BEGIN
  -- 事後閘① 兩個都要翻成 t
  IF NOT has_table_privilege('pcm_readonly','public.pcm_acl_drift_status','SELECT') THEN
    RAISE EXCEPTION '貼板105 事後閘①:pcm_acl_drift_status 仍讀不到 ⇒ 回滾';
  END IF;
  IF NOT has_table_privilege('pcm_readonly','public.pcm_acl_snapshot_digest','SELECT') THEN
    RAISE EXCEPTION '貼板105 事後閘①:pcm_acl_snapshot_digest 仍讀不到 ⇒ 回滾';
  END IF;

  -- 事後閘② 🟢 正對照不得被影響
  IF NOT has_table_privilege('pcm_readonly','public.orders','SELECT') THEN
    RAISE EXCEPTION '貼板105 事後閘②:正對照 public.orders 變成讀不到 ⇒ 本支動到了不該動的東西 ⇒ 回滾';
  END IF;

  -- 事後閘③ ⚪ 負對照不得被影響 —— 少了它,「兩個翻 t」與「全部都翻 t」分不開
  IF has_table_privilege('pcm_readonly','public.dbk_external_id_rename_20260904','SELECT') THEN
    RAISE EXCEPTION '貼板105 事後閘③:負對照也變成讀得到 ⇒ 本支給的範圍比兩個物件大 ⇒ 回滾';
  END IF;

  -- 事後閘④ 🔴🔴 **差集必須【剛好】是我要給的那兩列** —— 白名單, 不是黑名單。
  --   它一次蓋掉 codex R2 那六條的整個維度:欄級 / `WITH GRANT OPTION` / 別的 schema /
  --   誤開第三個物件 / 誤收既有授權。
  --   🛑 **而射程要寫準**(code-reviewer 抓到我原句寫成「任何一種」):
  --     快照只含 `grantee = pcm_readonly` 的【表級與欄級】ACL ⇒ **不在分母裡的有**:
  --     `GRANT … TO PUBLIC` · schema 的 `USAGE` · 函式 `EXECUTE` · default privileges · 角色成員關係。
  --     本支只有兩行 `GRANT` ⇒ **今天不會發生**;而**下一個把這段當範本拿走的人會**。
  IF EXISTS (
    WITH after AS (
      SELECT n.nspname AS sch, c.relname AS rel, NULL::text AS col,
             a.privilege_type AS priv, a.is_grantable AS grantable,
             a.grantor::regrole::text AS grantor
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             LATERAL aclexplode(coalesce(c.relacl,
               acldefault(CASE c.relkind WHEN 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a
       WHERE a.grantee = 'pcm_readonly'::regrole
      UNION ALL
      SELECT n.nspname, c.relname, at.attname, a.privilege_type, a.is_grantable,
             a.grantor::regrole::text
        FROM pg_attribute at JOIN pg_class c ON c.oid = at.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace,
             LATERAL aclexplode(at.attacl) a
       WHERE at.attnum > 0 AND NOT at.attisdropped
         AND a.grantee = 'pcm_readonly'::regrole
    ), expected AS (
      -- 🔴 grantor 取【物件 owner】不取 `current_user`(code-reviewer nit):
      --   PG 的 `select_best_grantor` —— 授出者是 superuser 而非 owner 時, ACL 記的是 **owner**。
      --   ⚠️ **我沒有在正式庫實測這一格 ⇒ 標未確認。** 而它的錯法是 fail-closed
      --   (猜錯 ⇒ 差集不等於預期 ⇒ 回滾), 所以取 owner 是往安全那邊倒的那個猜法。
      SELECT 'public'::name, 'pcm_acl_drift_status'::name, NULL::text, 'SELECT'::text, false,
             (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.pcm_acl_drift_status'::regclass)
      UNION ALL
      SELECT 'public', 'pcm_acl_snapshot_digest', NULL::text, 'SELECT', false,
             (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.pcm_acl_snapshot_digest'::regclass)
    ), gained AS (
      SELECT * FROM after EXCEPT SELECT * FROM _acl_before
    ), lost AS (
      SELECT * FROM _acl_before EXCEPT SELECT * FROM after
    )
    SELECT 1 FROM lost
    UNION ALL
    SELECT 1 FROM (SELECT * FROM gained EXCEPT SELECT * FROM expected) x
    UNION ALL
    SELECT 1 FROM (SELECT * FROM expected EXCEPT SELECT * FROM gained) y
  ) THEN
    RAISE EXCEPTION '貼板105 事後閘④:pcm_readonly 的授權差集【不等於】那兩列 SELECT ⇒ 多給了、少給了、或收掉了別人的 ⇒ 回滾';
  END IF;

  RAISE NOTICE '貼板105 事後閘四道全過:兩個翻 t · 正對照仍 t · 負對照仍 f · 零寫入權';
END
$post$;

-- 🔴🔴 **本支【刻意不碰 `COMMENT ON`】**(codex R3 must-fix ⑤ 之後的修法):
--   第一版我在這裡改註解, 而還原檔寫回【建表那支的歷史原文】。
--   ⇒ 🛑 `COMMENT` 只存一份, 新值取代舊值 ⇒ **中間若有人更新過那句操作契約,**
--     **正向會蓋掉它, 而還原會寫回一個更舊的版本 —— 兩個方向都不可逆地抹掉他寫的東西。**
--   ⇒ ✅ 最小爆炸半徑的修法不是「先去複驗現值」, 是**根本不要碰它** ——
--     這一片要做的事是 GRANT, 註解不是它的職責。
--   📌 那句「pcm_readonly 有 SELECT」要留紀錄的話, 留在**這支 migration 自己**與貼板檔裡就夠了。

COMMIT;
