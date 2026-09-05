-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback:20260905350000_m4b_adp_revoke_service_role_residual_on_tables
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔵 **這一支的還原比大多數片單純, 而【單純不等於該做】** ——
--    它只改一列預設權限, 不碰任何既有物件 ⇒ 還原也只是把那一列加回去。
-- 🛑 而「加回去」= **讓此後新建的表與 view 重新自帶 TRUNCATE/REFERENCES/TRIGGER/MAINTAIN**。
--    那是 Sean 2026-09-05 拍「甲」要關掉的東西 ⇒ 🔴 **還原它等於推翻那個拍板。**
--    ⇒ §0 攔截器在下面, 不是形式:要跑這一支, 先確認那個拍板被推翻了。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §0 攔截器(可執行)──────────────────────────────────────────────────
DO $$
BEGIN
  RAISE EXCEPTION '20260905350000 的 rollback 不可自動執行。還原它 = 讓新建的表與 view 重新自帶那四種權限, 而那正是 Sean 2026-09-05 拍甲要關掉的。先確認拍板被推翻, 再手動把 §0 註解掉。';
END $$;

-- ── §R 還原(註解;取消註解前先讀上面那段)──────────────────────────────
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO service_role;
--
-- ⚠️ **順序與射程**:`FOR ROLE postgres` 不可省 —— 不寫的話它改的是【執行者自己】的預設權限,
--    而執行者若不是 postgres, 這一行會建出一列**新的**而不是還原那一列
--    ⇒ 📌 那個世界裡它會【成功】而什麼都沒還原, 而下一個人會以為還原過了。
--
-- 🔵 **既有物件不需要任何動作** —— 本片零追溯, 它一個既有物件都沒改過。

-- ── §V 量現況(唯讀, 零副作用;那一列不存在也不會 throw)──────────────────
SELECT
  -- 🔴 那一列可能【整個不存在】(PG 在只剩 owner 內建預設時會刪掉整列)⇒ 用左外接, 不用直接查
  COALESCE((
    SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
      FROM pg_catalog.pg_default_acl d
      JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace,
           LATERAL pg_catalog.aclexplode(d.defaclacl) a
     WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
       AND d.defaclrole = to_regrole('postgres')
       AND a.grantee = to_regrole('service_role')
  ), '(沒有 —— 本片已生效, 或那一列從來沒有過)')                       AS service_role在預設裡拿到什麼,
  -- 正對照:postgres 自己那格(它不該被本片動到;可能因 PG 省略而回「(省略)」)
  COALESCE((
    SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
      FROM pg_catalog.pg_default_acl d
      JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace,
           LATERAL pg_catalog.aclexplode(d.defaclacl) a
     WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
       AND d.defaclrole = to_regrole('postgres')
       AND a.grantee = to_regrole('postgres')
  ), '(省略 —— PG 對等於內建值的 owner 條目不印, 這是合法的)')          AS 正對照_postgres那格,
  -- 🔴 全域那條路(不綁 schema)—— 它若在給那四種, 本片與本還原【都是無效的】
  (SELECT count(*) FROM pg_catalog.pg_default_acl d,
          LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE d.defaclnamespace = 0 AND d.defaclobjtype = 'r'
      AND a.grantee = to_regrole('service_role')
      AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))  AS 全域那條路必0,
  -- 負對照:既有物件仍帶著那四種的個數(本片零追溯 ⇒ 這個數不該因本片而變)
  (SELECT count(*) FROM (
     SELECT c.oid FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
            LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
        AND a.grantee = to_regrole('service_role')
        AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
      GROUP BY c.oid) t)                                                       AS 既有仍帶著的個數;
-- ⚠️ 讀法:第一欄是「(沒有…)」⇒ 本片已生效**或**它從來沒有過 —— 這兩個世界這一句分不開,
--    要分開請看 `supabase/APPLIED.tsv` 有沒有 20260905350000 那一列。
