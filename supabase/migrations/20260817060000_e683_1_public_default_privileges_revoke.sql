-- 20260817060000_e683_1_public_default_privileges_revoke.sql
-- `E683-1`:收掉 `public` schema 對 `anon` / `authenticated` 的**預設**授權
--
-- 鐵則 8 + 12③(權限面 + DDL)。Sean 2026-08-17 批「可以做」;主視窗改派施工給 B 窗。
-- 規格來源(自足、逐字):`~/pcm-mailbox/E-701-B窗兩份可施工規格-心跳表甲prime與E683-1-20260817.md` §①
-- 🔴 **寫/驗分離**:B 窗寫、**E 窗驗**。本檔作者不驗自己的產出。
--
-- ══ 1. 在修什麼 ══════════════════════════════════════════════════════════════
--
-- 現況(E 窗 2026-08-17 以 `pcm_audit_ro` 唯讀實測,逐字):
--   postgres → {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}
--                                   ^^^^ D = TRUNCATE
-- 目標:
--   postgres → {postgres=arwdDxtm, service_role=arwdDxtm}
--
-- 🔴 **`D`(TRUNCATE)是這條的重點,而 RLS 管不到它。**
--    一張開了 RLS、零 policy 的新表,`anon` 仍然 TRUNCATE 得掉它。
-- 🔴 **新物件【出生】就帶這組權限** ⇒ 這不是「某張表忘了收」,是**產生器**問題。
--    ⇒ repo 內**零 `GRANT` 字面可掃、三綠不會紅**(詳 `docs/patterns/revoking-function-execute-in-supabase.md`)。
--
-- ══ 2. 只動 `FOR ROLE postgres` 那一份 ═══════════════════════════════════════
--
-- `FOR ROLE supabase_admin` 那一份**動不了**:`postgres` 非 superuser。
--   數法(E 窗 2026-08-17 實測):`SELECT rolsuper FROM pg_roles WHERE rolname='postgres'` ⇒ `f`
-- 🔴 **不要試,也不要在本檔留一條做不到的 SQL 給下一個人試。**
-- ⚠️ **連帶的誠實缺口**:由 `supabase_admin` 建的物件**仍會自帶預設授權**
--    ⇒ **本片不宣稱把這條路關死。**
--
-- ══ 3. 本片【不涵蓋】(明寫,不要讀成關死了)═══════════════════════════════════
--   · `supabase_admin` grantor 那一份（動不了，見上）
--   · 既有 46 張表的殘留授權（E 窗實測 anon 寫權限全為 0，不需要）
--   · 函式的 EXECUTE 預設授權（另議，不混進來）
--   · 欄級授權（另一軸；🔴 `has_table_privilege` 看不到欄級，會少報）
--
-- ══ 4. 驗收怎麼跑(🔴 先看負向對照兩發,再看斷言)═══════════════════════════════
--   E 窗規格 §1-4 逐字:「該綠的餵一發必須綠,該紅的餵一發必須紅。兩發都表演得出來,
--   才可以看斷言的結果。」
--   🔴 **若「該紅的那一發」沒有紅 ⇒ 停下來回報,不要繼續** ——
--      那表示斷言在**現況**下就已經通過 ⇒ 它量的不是你以為的東西。
--   本檔實跑紀錄見同批 commit body 與交件宣告(含該紅那發印出的錯誤字面)。

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- 驗收斷言:fail-closed。成功時零輸出 ⇒ 🔴 `exit 0` 不等於這條跑到了,要靠上面那兩發對照。
--
-- 🔴🔴 **由「排除兩個具名角色」改成【閉世界】**(codex 2026-08-17 `must-fix`):
--    舊版只問「還有沒有 anon / authenticated」⇒ **`PUBLIC` 或任何第三個角色留在那裡,它照樣全綠。**
--    ⇒ 改成「**只准剩 owner 與 `service_role`,出現任何別人就紅**」。
--    📎 形狀 = 「枚舉的集合比世界窄」:黑名單擋得住你想得到的,擋不住你沒想到的。
DO $$ DECLARE v text; BEGIN
  SELECT string_agg(format('%s=%s', coalesce(a.grantee::regrole::text,'PUBLIC'), a.privilege_type), ', ')
    INTO v
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND d.defaclrole = 'postgres'::regrole
     AND coalesce(a.grantee, 0) NOT IN ('postgres'::regrole::oid, 'service_role'::regrole::oid);
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'E683:postgres 的 public 表預設 ACL 出現 owner/service_role 以外的授權(%)', v;
  END IF;
END $$;

-- ══ 4b. 新物件收權斷言:本檔【沒有新建任何物件】,依樣板規定【明示】不留空 ═════════
-- 🔴 空清單 + 全綠 = 假綠燈 ⇒ 樣板有分母閘,要作者明說「真的沒建」。
DO $newobj_guard$
DECLARE
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := true;   -- 本檔只改預設授權，零新物件
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION '新物件收權斷言:兩份清單都是空的而未明示。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;
END
$newobj_guard$;

-- ══ 4c. 🔴 兩支【不是】同一個交易(codex 2026-08-17 `must-fix`)═══════════════════
--   本檔與 `20260817070000_m4b_231_3_sweeper_heartbeat.sql` 是**兩支各自的 migration、各自的交易**,
--   **不是一批原子操作**。
--   ⇒ 若心跳表先成功而本檔後失敗:**那張表是安全的(它自己有 REVOKE),而【未來的新表】仍然裸露。**
--   ⇒ 🔴 **驗收口徑**:**不得**把「其中一支成功」寫成「整案完成」。兩支各自要有自己的落地證據。

-- ══ 5. Rollback ══════════════════════════════════════════════════════════════
-- 🔴 **不提供「還原成有 anon 權限」的 rollback SQL** —— 那等於把洞重新打開。
--    真的要退,反向指令是
--      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
--    **而它不放在本檔**:放在檔內就會有人在半夜照著貼。要退 ⇒ Sean 在場、當場現寫。

COMMIT;
