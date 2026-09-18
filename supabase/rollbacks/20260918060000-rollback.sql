-- 20260918060000-rollback.sql —— 退回 20260918060000_m4b_revoke_pcm_readonly_saved_order_views.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ═══ 本檔做什麼 ═════════════════════════════════════════════════════════════
-- **把那一條 GRANT 加回去。** 正片收掉了它,本檔還原它。
--
-- 🔵 **與前一片(`20260918050000-rollback.sql`)【剛好相反】,不要照抄** ——
--    那一片的正片是 no-op ⇒ 它的還原檔**刻意什麼都不做**。
--    **本片的正片真的改了 ACL ⇒ 本檔真的要動手。**
--    📌 判別句:**還原檔該不該動手,看的是【正片有沒有改變狀態】,不是「它是不是 migration」。**
--
-- ═══ 🔴 還原【不是免費的】—— 它把那個洞打回來 ═══════════════════════════════
-- 正片收的是一條**沒人決定過、查不到誰加的**授權,而 `20260828080000` 逐字寫著
-- 「本表**刻意零 GRANT**」(在 **`:189`** —— ⚠️ R1 N1 更正:我原本把它歸給 `:194-197`,
-- 那一段是另一句)與「**私有性是 trust boundary,不簡化**」(`:197`)。
-- ⇒ 🛑 **跑本檔 = 知情地把那條授權放回去。** 只有在「真的有人在用它、而現在壞了」時才跑。
-- ⇒ 📌 判別句:**還原是為了「止血」,不是為了「回到熟悉的樣子」。**
--
-- ═══ 為什麼這一句是安全的 ═══════════════════════════════════════════════════
-- 🔬 2026-09-18 拋棄式 PG 17.10 實測:**把已經有的權限再 GRANT 一次,`relacl` 逐字相同**
--    ⇒ 本檔**重複跑是 no-op**,不會越補越多。
--
-- 🔴🔴 **而「還原之後 = 原狀」這句話,只對【權限集合】成立,對【relacl 字串】不成立。**
--    🔬 2026-09-18 拋棄式 PG 實測,同一張表跑「正片 ⇒ 本檔」之後:
--      貼之前 `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--      還原後 `{postgres=arwdDxtm/postgres,service_role=r/postgres,pcm_readonly=r/postgres}`
--      ⇒ **同樣三條權限,而 `pcm_readonly` 被排到最後** —— PostgreSQL 的 `relacl` 是**陣列**,
--        收掉再給回來,那一項會**接在尾端**,不會回到原本的位置。
--    ⇒ 🛑 **任何拿 `relacl::text` 逐字比對的漂移偵測,還原之後【會叫】,而那個紅是【假的】。**
--      ✅ 要比就比 `aclexplode` 展開後的集合(本檔的斷言就是這樣寫的),不要比字串。
--    ⇒ 📌 **判別句:「一模一樣」要先講清楚是【哪一個層次】的一模一樣。**
--      我原本在 plan 裡寫「還原之後的 acl 會與貼之前逐字相同」—— **那句話是我自己量出來假的。**
-- 🔵 **會**回到原狀的:`is_grantable`(原本是 `r` 不是 `r*`)與 `grantor`
--    (superuser 執行 GRANT 視同 owner 執行 ⇒ 仍是 `/postgres`;⚠️ 前提是今天那一列確實是 `/postgres`
--     —— 2026-09-18 正式庫實查的 relacl 是這樣寫的)。
-- 🛑 **不會**回到原狀的另一樣:**欄級授權** —— 表級 REVOKE 會連帶收掉同一個 grantee 的欄級,
--    而本檔**只補表級**。正片前置閘⑤ 把「本表有欄級授權」擋在門外(2026-09-18 實查 0 列),
--    所以那個世界走不到這裡 ⇒ **它在射程外, 不是被處理了。**
-- 🔬 而 `GRANT` 對目標表**零筆鎖**(同一輪實測)⇒ 止血可以馬上跑,不必等離峰。
--
-- ═══ 🛑 本檔【不】還原 `service_role` 的任何東西 ════════════════════════════
-- 正片沒碰它(正片前置閘④ + 後置閘② 兩邊都證過)⇒ 本檔也不碰。
-- 📌 **還原檔的射程 = 正片的射程。** 正片沒改的,本檔不准「順便修一下」。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '還原前置閘:角色 pcm_readonly 不存在 ⇒ 沒有東西可以還原給它 ⇒ 停下';
  END IF;
  IF pg_catalog.to_regclass('public.admin_saved_order_views') IS NULL THEN
    RAISE EXCEPTION '還原前置閘:public.admin_saved_order_views 不存在 ⇒ 停下(要還原的不只是一條權限了)';
  END IF;

  -- 🔵 已經在了 ⇒ 印出來,而**不擋**。
  --    理由:重複 GRANT 是 no-op(實測 relacl 逐字相同)⇒ 讓它跑完比擋下來安全,
  --    而「它本來就在」這件事讀的人要知道 —— 否則他會以為是本檔補回來的。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT') THEN
    RAISE NOTICE '🔵 那條授權【本來就在】—— 本檔這一發是 no-op(正片沒貼, 或已經被別人還原過)。';
  END IF;
END $pre$;

GRANT SELECT ON TABLE public.admin_saved_order_views TO pcm_readonly;

DO $post$
DECLARE v_acl text;
BEGIN
  -- 🎯 斷言:那一列【真的回來了】。
  -- 🛑 用 `aclexplode(relacl)`,**不要用 `has_table_privilege`** ——
  --    後者在 PUBLIC 授權或角色繼承下會回 true ⇒ 它會在「什麼都沒補回來」的世界裡照樣印綠。
  --    (板 050000 的 R2 MF1 就是栽在這把尺上。)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT') THEN
    RAISE EXCEPTION '還原後置閘:GRANT 跑完了, 而 acl 裡【還是沒有】pcm_readonly 的那一列 ⇒ 拒 COMMIT';
  END IF;

  SELECT COALESCE(c.relacl::text, '<NULL>') INTO v_acl
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass;

  RAISE NOTICE '✅ 已還原:pcm_readonly 的 SELECT 回到 acl 裡。';
  RAISE NOTICE '🔬 還原之後的 relacl 逐字:%', v_acl;
  RAISE NOTICE '🛑 而那個【刻意零 GRANT】的設計現在又破著 —— 請把「為什麼需要還原」寫下來, 不要讓它變成下一個查不到出處的孤兒。';
END $post$;

COMMIT;
