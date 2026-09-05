-- ═══════════════════════════════════════════════════════════════════════════
-- ⟦b4-SEQACL1⟧:`supplier_sync_runs_id_seq` 明寫一發 `REVOKE ALL`
--   起因:`scripts/public-sequence-acl.test.ts` 在第 32 批的鏈上紅 2 格 ——
--         我的 `20260906340000` 建了一張 IDENTITY 表, 而**沒有任何 migration 文字收過它的序列**。
--   派工 主視窗 `-f8` 2026-09-06(處置逐字:「不放寬尺」)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 這一片在解什麼 —— 🔴 **而它解的是【尺看不到】, 不是【線上不安全】**
--   🔬 線上實測(2026-09-06 唯讀):`supplier_sync_runs_id_seq` 的 `anon`
--      USAGE / UPDATE / SELECT **三個都是 f** ⇒ **今天它是安全的。**
--   ⇒ 那為什麼還要這一支?因為那把尺是**靜態掃 migration 字面 + 一份釘住的名單**,
--     而 📌 **它不知道 `20260905430000` 那道 ADP**(那才是讓新序列出生不帶 `anon` 的東西)。
--   ⇒ 🛑 **而「放寬那把尺」是錯的解**:它今天對這一支會誤報,而**它守的是所有未來的 IDENTITY 表** ——
--     那些表的作者不會知道有 ADP、也不該依賴它。
--     ⇒ 🎯 **ADP 是【預設】, 而這一發是【明寫】。兩者不互相取代:**
--       **預設會被下一個改 ADP 的人動掉,而明寫的那一行留在檔案裡。**
--
-- ■ 段二 · 🔴 為什麼【沒有】GRANT 給 `service_role` —— 派工單建議的那一句我沒有照做
--   派工逐字建議「`+ GRANT USAGE,SELECT TO service_role`(與線上現況一致 ⇒ 冪等)」。
--   🔬 **而我先量了線上現況, 它不是那樣**:
--        `supplier_sync_runs_id_seq` 的 acl = `{postgres=rwU/postgres, service_role=w/postgres}`
--        `service_role` ⇒ USAGE **f** · SELECT **f** · UPDATE **t**
--   ⇒ 📌 **那個 `w`(UPDATE)是 `postgres` 那條 ADP 給的**(我在 `20260905430000` 只收了
--     `anon` / `authenticated`,`service_role` 那格**刻意留著**)。
--   ⇒ 🛑 **所以 `GRANT USAGE, SELECT` 不是「與線上一致」,它會【多給兩種現在沒有的權限】**
--     ⇒ **那不是冪等,是擴權。** ⇒ ✅ **本片不下那一句。**
--   🔵 **而它也不需要**:`id` 是 `GENERATED ALWAYS AS IDENTITY`,
--     `INSERT` **不需要**序列的 USAGE/SELECT(那是 `serial` 那一族才要的)。
--     🔬 佐證:`20260906340000` 貼進去之後,同步程式那半還沒跑過 ⇒ 這一格**尚未被真實寫入驗證過**,
--        所以上面那句寫成「不需要」是**依 PostgreSQL 的定義**,不是「我看它跑過」。**兩者證據等級不同。**
--   ⚠️ **而 `service_role=w` 該不該收,是另一題**:其餘既有 IDENTITY 序列
--     (`pcm_incident_id_seq` / `search_queries_id_seq` / `auth_callback_events_id_seq`)
--     今天都是 `{postgres=rwU/postgres}` **一格 service_role 都沒有** ⇒ 本支不一致。
--     ⇒ 🛑 **本片不動它** —— 收 `service_role` 是改一條【還在生效的 ADP 的產物】,
--       要自己一片、自己一輪審。**寫在這裡,不讓它靜靜留著。**
--
-- ■ 段三 · 貼進去會發生什麼
--   **零改動**(那三個角色今天本來就沒有那些權限)⇒ 🛑 **貼完畫面零變化,那是預期,不是驗收通過。**
--   驗收看事後閘印的數字。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 前置閘:角色與物件都要在(不然下面每一格都假綠)──
DO $g0$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION '前置閘:anon / authenticated 角色不存在 ⇒ 下面的斷言會恆真, 拒繼續';
  END IF;
  IF to_regclass('public.supplier_sync_runs_id_seq') IS NULL THEN
    RAISE EXCEPTION '前置閘:public.supplier_sync_runs_id_seq 不存在 ⇒ 20260906340000 還沒貼?拒繼續';
  END IF;
END $g0$;

-- ── 1. 明寫收權 ────────────────────────────────────────────────────────
-- 🔴 **`REVOKE ALL`, 不挑單項** —— 兩個理由:
--    ① 列舉會跟下一個沒想到的權限名賽跑(`⟦b9-PUBLICVIEWALL⟧` 用一次漏報換到的)
--    ② `scripts/public-sequence-acl.test.ts:144-150` **只認 `REVOKE ALL`**,
--       它逐字寫著「一發 `REVOKE SELECT … FROM anon` 不該算『收過了』」——
--       ⇒ 📌 那道尺與上面那個理由**是同一件事**, 不是它比較挑剔。
REVOKE ALL ON SEQUENCE public.supplier_sync_runs_id_seq
  FROM PUBLIC, anon, authenticated;

-- ── 2. 事後閘:三個角色的【有效權限】都要是 0 ────────────────────────
-- 🔴 用 `has_sequence_privilege`(**有效權限**)不用 `aclexplode` —— 後者只看得到具名的直接授權,
--    對 `PUBLIC` 與角色繼承失明(`20260905430000` 那一片被 codex 抓過同一格)。
DO $after$
DECLARE
  v_bad     integer;
  v_owner   boolean;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(nm)
     CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) p(pv)
     WHERE pg_catalog.has_sequence_privilege(r.nm, 'public.supplier_sync_runs_id_seq', p.pv)
  ) t;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '事後閘:anon/authenticated 在該序列上仍有 % 格有效權限 ⇒ REVOKE 沒生效, 拒 COMMIT', v_bad;
  END IF;

  -- 🔴🔴 **負對照:這把尺【在該回 true 的時候】會不會回 true**
  --    owner(`postgres`)對它一定拿得到 UPDATE。回不出來 ⇒ 尺沒接上 ⇒ 上面那個 0 不算數。
  --    ⇒ 📌 **一個沒有負對照的 0, 與一把壞掉的尺, 印同一個東西。**
  v_owner := pg_catalog.has_sequence_privilege('postgres', 'public.supplier_sync_runs_id_seq', 'UPDATE');
  IF NOT v_owner THEN
    RAISE EXCEPTION '事後閘負對照:postgres 對該序列量不到 UPDATE ⇒ has_sequence_privilege 沒接上 ⇒ 上面那個 0 不算數, 拒 COMMIT';
  END IF;

  RAISE NOTICE '✅ 事後閘:anon/authenticated 在 supplier_sync_runs_id_seq 上有效權限 = 0 格 · 🟢 負對照 postgres UPDATE = t(尺有接上)';
  RAISE NOTICE '🔵 service_role 那一格【刻意未動】—— 它的 UPDATE 來自 postgres 的序列 ADP;收不收是另一片(理由見檔頭段二)。';
END $after$;

COMMIT;
