-- ⟦b9-ACLDRIFT5⟧ 收尾:把 pcm_acl_drift_status 上 service_role 多出來的四種收掉
-- 板列 docs/launch-todo.md ⟦b9-ACLDRIFT5⟧ · 派工:主視窗 -f8 2026-09-05 拍甲
-- 前置:20260905170000(那支建了這個 view)
--
-- ══ 病灶:我自己寫的 17 那支, 照 plan 寫了「只給 SELECT」而它沒有成立 ═══════
--   plan `docs/plans/2026-09-05-acl-drift-runtime-detector-plan.md` §2c 逐字:
--     「讀取端若是 service_role, 那就【只給它 SELECT】, 不要給整包」
--   而 2026-09-05 唯讀實量:
--     public.pcm_acl_drift_status ⇒ service_role = MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE
--
--   🔬 **那四種不是 GRANT 來的, 是物件【出生時】就帶著的**:
--     `pg_default_acl` 對「postgres 在 public 建的表/view」逐字是
--       postgres=arwdDxtm/postgres | service_role=Dxtm/postgres
--     而 `Dxtm` = TRUNCATE(D)· REFERENCES(x)· TRIGGER(t)· MAINTAIN(m)
--   🔴 而 17 那支的 REVOKE 名單是 PUBLIC / anon / authenticated / payment_confirmer
--     —— **刻意沒有 service_role**(因為要給它 SELECT)⇒ 那四種【一次都沒被收過】。
--
--   ⇒ 📌 **要給某個角色 SELECT 的物件, REVOKE 名單裡【不可以】把它排除掉。**
--      正確順序是:**先對它 `REVOKE ALL`, 再 `GRANT SELECT`** —— 兩行, 而少了第一行差四種權限。
--   🟢 **同一片的【表】是乾淨的**(`pcm_acl_snapshot_digest` 只有 postgres)——
--      因為它四道 REVOKE 裡有 service_role。⇒ **差別只在名單有沒有它。**
--
-- ══ 🛑 這一支證不到什麼 ═══════════════════════════════════════════════════
--   · ⛔ ~~**今天沒有實害**:那是一支 view —— TRUNCATE 對 view 無效, TRIGGER/REFERENCES 也掛不上去~~
--     🔴🔴 **[codex must-fix F]那句是錯的, 而它是我【沒查就寫下的安心話】(今天第三次同型)**:
--       · `TRIGGER` 在 view 上**做得了事** —— PostgreSQL 允許在 view 上建 `INSTEAD OF` trigger,
--         🛑 **而那正好讓一支唯讀 view 變成可寫的。** 唯讀實量:
--         `has_table_privilege('service_role','public.pcm_acl_drift_status','TRIGGER')` ⇒ **t**
--       · `MAINTAIN` 取得的是 `ACCESS EXCLUSIVE` 級的鎖, 鎖 view 時會遞迴鎖到底表。
--     ⇒ 📌 **所以這一片修的不只是形狀** —— 它拿掉的是「把這支 view 變成可寫」的那條路。
--     🔵 而**今天沒有人在用它**(沒有任何 trigger 掛在那支 view 上)—— 那是【現況】, 不是【不可能】。
--   · 🔴 而它不修那個【機制】—— 下一個 postgres 在 public 建的物件, 照樣自帶 `service_role=Dxtm`。
--     ⇒ 那要動 `ALTER DEFAULT PRIVILEGES`, 而那是另一片、另一個授權。
--     🔵 codex 說得對:**「機制沒修」這件事本身是【量得出來】的** —— `pg_default_acl` 逐字寫著
--       `postgres` 在 `public` 的 TABLES 預設是 `postgres=arwdDxtm | service_role=Dxtm`。
--   · ⛔ ~~它證不到「別的物件沒有同樣的殘留」—— 全庫普查不在本片射程~~
--     🔴 **[codex nit F]那是【可以量而我寫成免責】的一格。量了(2026-09-05 唯讀)**:
--       public schema 裡 service_role 帶著那四種其中之一、而它不是 owner 的物件:
--         **表 16 支 · view 13 支 = 29 個**
--       其中【只有那四種、連 SELECT 都沒有】(= 純殘留, 沒有人真的在用它)的:**表 1 支**
--     ⇒ 📌 **本片修的是那 29 個裡的 1 個。** 其餘 28 個要自己的一片 ——
--       而**現在它有一個數字了**, 不是一句「不在射程」。板列已記。
--
-- ══ ↩️ rollback(裝回貼前那個確切狀態)══════════════════════════════════════
--   BEGIN;
--     GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.pcm_acl_drift_status TO service_role;
--   COMMIT;
--   ⚠️ 那正是本片要收的東西。退之前先問「為什麼要退」。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_txt text;
  v_n   integer;
BEGIN
  -- ⓪ 角色與物件都要在(has_table_privilege 對不存在的角色會拋錯)
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:這台庫沒有 service_role ⇒ 本片的對象是 Supabase 那種形狀的庫';
  END IF;
  -- 🔴 **[codex MF D]** `to_regclass` 只證「有一個同名的 relation」——
  --    同名的 table / materialized view 也會通過, 而本片會去改【那個東西】的 ACL。
  --    ⇒ 形狀要一起釘:必須是 ordinary view(relkind='v')且 owner 是 postgres。
  SELECT pg_catalog.string_agg(c.relkind::text || '/' || c.relowner::regrole::text, ',') INTO v_txt
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:找不到 public.pcm_acl_drift_status ⇒ 先貼 20260905170000';
  END IF;
  IF v_txt <> 'v/postgres' THEN
    RAISE EXCEPTION '前置閘⓪b:public.pcm_acl_drift_status 的 relkind/owner 是「%」, 期望逐字 v/postgres ⇒ 這不是 20260905170000 建的那支, 停下人工對齊', v_txt;
  END IF;

  -- ① 貼前:service_role 在它上面應該【不只有 SELECT】(否則本片貼過了 / 形狀變了)
  SELECT pg_catalog.string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) INTO v_txt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('service_role');
  -- 🔴 **[codex MF D]** 舊版只判「非空且不等於 SELECT 就繼續」——
  --    ⇒ 一個「只有 TRIGGER、沒有 SELECT」的世界也會通過, 而本片會**幫它新增 SELECT**(反而放寬)。
  --    ✅ 改成白名單:只接受【已知那兩種形狀】, 其餘一律停。
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '前置閘①:service_role 在那支 view 上一格權限都沒有 ⇒ 本片會幫它【新增】SELECT, 那不是收權是放寬 ⇒ 停下人工對齊';
  ELSIF v_txt = 'SELECT' THEN
    RAISE NOTICE '[20260905270000] 🔵 service_role 已經只剩 SELECT —— 本片貼過了, 或這台庫本來就乾淨。本檔冪等, 照跑。';
  ELSIF v_txt = 'MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE' THEN
    RAISE NOTICE '[20260905270000] 前置閘:貼前 service_role 的權限集合 = %(與 2026-09-05 唯讀實量逐字相同)', v_txt;
  ELSE
    RAISE EXCEPTION '前置閘①:service_role 的權限集合是「%」—— 既不是貼前那五種、也不是貼後的 SELECT ⇒ 有人動過它, 而本片的修法沒有評估過那個形狀 ⇒ 停下人工看', v_txt;
  END IF;

  -- ② 🟢 正對照:同一把尺問 postgres ⇒ 必須是八種(證明這把 ACL 尺讀得到東西)
  SELECT pg_catalog.count(DISTINCT a.privilege_type) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('postgres');
  IF v_n <> 8 THEN
    RAISE EXCEPTION '正對照失敗:owner(postgres)只數到 % 種權限(期望 8)⇒ 上面那個集合沒有判別力', v_n;
  END IF;
END $$;

-- ══ 本體:先全收, 再給回唯一該有的那一種 ═══════════════════════════════════
-- 🔴 順序是重點:少了第一行, 出生時帶的 Dxtm 一次都不會被收。
REVOKE ALL ON public.pcm_acl_drift_status FROM service_role;
-- ACL-GATE-EXEMPT: public.pcm_acl_drift_status -- 告警端(service_role)靠這支 definer view 讀漂移狀態;本片只收多餘的四種、SELECT 原樣留著(20260905270000, 2026-09-05 -f8 拍甲)
GRANT SELECT ON public.pcm_acl_drift_status TO service_role;

-- ══ 事後斷言 ═════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_txt text;
  v_n   integer;
BEGIN
  -- ⓐ service_role 的權限集合必須【恰好是 SELECT】, 且不得帶 GRANT OPTION
  SELECT pg_catalog.string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type)
         || CASE WHEN pg_catalog.bool_or(a.is_grantable) THEN '(帶 GRANT OPTION)' ELSE '' END
    INTO v_txt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('service_role');
  IF v_txt IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION '斷言ⓐ失敗:service_role 的權限集合是「%」, 期望恰好 SELECT', COALESCE(v_txt, '(一格都沒有)');
  END IF;

  -- ⓐ2 🔴 **[codex MF B]** ⓐ 只讀【直接授權】的 ACL ——
  --    service_role 若從某個成員角色繼承到 SELECT WITH GRANT OPTION, ⓐ 照樣綠。
  --    ⇒ 補一格:它不得是【任何角色】的成員(2026-09-05 唯讀實量:anon/authenticated/
  --      payment_confirmer/pcm_readonly 對 service_role 的 USAGE 與 MEMBER 皆為 f, 反向也要顧)。
  SELECT pg_catalog.string_agg(m.roleid::regrole::text, ', ') INTO v_txt
    FROM pg_catalog.pg_auth_members m
   WHERE m.member = pg_catalog.to_regrole('service_role')
     AND (m.inherit_option OR m.set_option);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '斷言ⓐ2失敗:service_role 是這些角色的成員 ⇒ % ⇒ 它可能從那裡繼承到本片以為已經收掉的權限, 而 ⓐ 只讀直接授權、看不到這條路', v_txt;
  END IF;

  -- ⓑ 🟢 有效權限那把尺也要同意(ACL 字面與有效權限是兩把尺)
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_acl_drift_status', 'SELECT') THEN
    RAISE EXCEPTION '斷言ⓑ失敗:service_role 讀不到那支 view ⇒ 告警端拿不到漂移狀態';
  END IF;
  SELECT pg_catalog.string_agg(p.priv, ',') INTO v_txt
    FROM (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.has_table_privilege('service_role', 'public.pcm_acl_drift_status', p.priv);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '斷言ⓑ2失敗:service_role 還有寫類權限 ⇒ %', v_txt;
  END IF;

  -- ⓒ 沒動到別人:owner 仍八種 · 四個應用角色仍是零(17 那支收的那幾道還在)
  SELECT pg_catalog.count(DISTINCT a.privilege_type) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('postgres');
  IF v_n <> 8 THEN
    RAISE EXCEPTION '斷言ⓒ失敗:owner 的權限變成 % 種(期望 8)⇒ 我收到不該收的', v_n;
  END IF;

  SELECT pg_catalog.string_agg(r.rn || '=' || COALESCE(x.privs, '(無)'), ', ') INTO v_txt
    FROM (VALUES ('anon'),('authenticated'),('payment_confirmer')) r(rn)
    LEFT JOIN LATERAL (
      SELECT pg_catalog.string_agg(DISTINCT a.privilege_type, ',') AS privs
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
       WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
         AND pg_catalog.to_regrole(r.rn) IS NOT NULL
         AND a.grantee = pg_catalog.to_regrole(r.rn)
    ) x ON TRUE
   WHERE x.privs IS NOT NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '斷言ⓒ2失敗:四個應用角色裡有人拿回權限(ACL 字面)⇒ %', v_txt;
  END IF;
  -- ⓒ3 🔴 **[codex MF A/B]** 上面那格只量【直接 ACL】——
  --    一個角色若繼承得到 service_role, 它照樣 SELECT 得到, 而 ACL 上一格都看不到。
  --    ⇒ 這一格用【有效權限】再問一次。(2026-09-05 唯讀實量:四個角色對 service_role 的
  --      USAGE 與 MEMBER 都是 f ⇒ 今天為零;而**今天為零不等於明天為零**, 所以它留在這裡。)
  SELECT pg_catalog.string_agg(r.rn || '/' || p.priv, ', ') INTO v_txt
    FROM (VALUES ('anon'),('authenticated'),('payment_confirmer')) r(rn)
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                       ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.to_regrole(r.rn) IS NOT NULL
     AND pg_catalog.has_table_privilege(r.rn, 'public.pcm_acl_drift_status', p.priv);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '斷言ⓒ3失敗:有應用角色【有效地】拿得到權限(可能是繼承來的)⇒ %', v_txt;
  END IF;

  -- ⓓ 🔵 PUBLIC 仍是 0
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status' AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言ⓓ失敗:PUBLIC 有 % 筆授權', v_n;
  END IF;

  RAISE NOTICE '[20260905270000] 事後斷言全過。🔵 會動的一格:ⓐ service_role 五種⇒恰 SELECT。⚪ 不變量(貼前就是這個值):ⓑ 有效 SELECT 仍在 · ⓒ owner 八種 · ⓒ2 四個應用角色仍零 · ⓓ PUBLIC 零。';
END $$;

COMMIT;
