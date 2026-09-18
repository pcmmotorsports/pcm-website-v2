-- 20260918060000-rollback.sql —— 退回 20260918060000_m4b_revoke_pcm_readonly_five_tables.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ⛔ ~~本檔原本退的是【一張表】(`..._saved_order_views.sql`)~~
-- 🔴 **2026-09-18 夜, 正片範圍從一張擴成五張(Sean Q1 / Q2 拍甲)⇒ 本檔跟著擴。**
--    **舊字面留著不刪** —— 下一個人要看得出它被擴過。
--
-- ═══ 本檔做什麼 ═════════════════════════════════════════════════════════════
-- **把那【五條】GRANT 加回去。** 正片收掉了它們, 本檔還原它們。
--   `admin_saved_order_views` · `order_cancellation_items` · `order_cancellations`
--   `order_item_costs` · `payment_charge_attempts`
--
-- 🔵 **與前一片(`20260918050000-rollback.sql`)【剛好相反】, 不要照抄** ——
--    那一片的正片是 no-op ⇒ 它的還原檔**刻意什麼都不做**。
--    **本片的正片真的改了 ACL ⇒ 本檔真的要動手。**
--    📌 判別句:**還原檔該不該動手, 看的是【正片有沒有改變狀態】, 不是「它是不是 migration」。**
--
-- ═══ 🔴 還原【不是免費的】—— 它把那些洞打回來 ═══════════════════════════════
-- 🔴 **而五張的「洞」不是同一種, 分開講**:
--
--  ① `admin_saved_order_views`:正片收的是一條**沒人決定過、查不到誰加的**授權,
--     而 `20260828080000` 逐字寫著「本表**刻意零 GRANT**」(在 **`:189`** —— ⚠️ R1 N1 更正:
--     我原本把它歸給 `:194-197`, 那一段是另一句)與「**私有性是 trust boundary, 不簡化**」(`:197`)。
--     ⇒ 還原它 = **知情地把那條授權放回去**。
--
--  ② `payment_charge_attempts` / `order_cancellations` / `order_cancellation_items`:
--     🔴 這三張上面**還有一道會叫的守門**:`scripts/a9g2-charge-attempts-grant-guard.test.ts`
--     守「全庫 migration 裡提到這三張的 GRANT 只准那一句 `TO service_role`」。
--     ⇒ 🛑 **本檔的那三句 `GRANT … TO pcm_readonly` 落在 `supabase/rollbacks/`,**
--        **而那道守門只掃 `supabase/migrations/` ⇒ 它【掃不到本檔】。**
--        📌 **所以本檔跑下去, 不會有任何測試變紅。** 照實寫, 不要以為有人在守。
--     🔴 而那三張 RLS enable + 對 `pcm_readonly` **零 policy** ⇒ 還原之後, 哪天有人拿掉
--        `pcm_readonly` 的 `BYPASSRLS`, 它就**讀到空陣列且不報錯**(fail-open)。
--        ⇒ **還原 = 把那條「離洞只有一個角色屬性」的路重新接上。**
--
--  ③ `order_item_costs`:正片收它是**推翻** 2026-09-14 的一個決定(`20260914010000:109`)。
--     ⇒ 🔴 **還原它 = 再推翻一次**, 回到「查帳唯讀帳號讀得到進貨成本」的狀態,
--       而那與「成本只給老闆看」(`is_manager` 閘)是矛盾的。
--     ⇒ 🛑 跑本檔之前, 這一條要單獨想一次:**你要止的血, 真的包含這一張嗎?**
--       本檔**沒有**提供「只還原其中幾張」的開關 —— 要那樣做請手動只跑你要的那幾句 GRANT,
--       並且**把下面的斷言一起改掉**(它斷言五條全回來)。
--
-- ⇒ 🛑 **跑本檔 = 知情地把那五條授權放回去。** 只有在「真的有人在用、而現在壞了」時才跑。
-- ⇒ 📌 判別句:**還原是為了「止血」, 不是為了「回到熟悉的樣子」。**
--
-- ═══ 為什麼這些句子是安全的 ═════════════════════════════════════════════════
-- 🔬 2026-09-18 拋棄式 PG 17.10 實測:**把已經有的權限再 GRANT 一次, `relacl` 逐字相同**
--    ⇒ 本檔**重複跑是 no-op**, 不會越補越多。
--
-- 🔴🔴 **而「還原之後 = 原狀」這句話, 只對【權限集合】成立, 對【relacl 字串】不成立。**
--    🔬 2026-09-18 拋棄式 PG 實測, 同一張表跑「正片 ⇒ 本檔」之後:
--      貼之前 `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--      還原後 `{postgres=arwdDxtm/postgres,service_role=r/postgres,pcm_readonly=r/postgres}`
--      ⇒ **同樣三條權限, 而 `pcm_readonly` 被排到最後** —— PostgreSQL 的 `relacl` 是**陣列**,
--        收掉再給回來, 那一項會**接在尾端**, 不會回到原本的位置。
--    ⇒ 🛑 **任何拿 `relacl::text` 逐字比對的漂移偵測, 還原之後【會叫】, 而那個紅是【假的】。**
--      ✅ 要比就比 `aclexplode` 展開後的集合(本檔的斷言就是這樣寫的), 不要比字串。
--    ⇒ 📌 **判別句:「一模一樣」要先講清楚是【哪一個層次】的一模一樣。**
--      我原本在 plan 裡寫「還原之後的 acl 會與貼之前逐字相同」—— **那句話是我自己量出來假的。**
--    🔵 **而今夜實查給了這句話一個獨立佐證**:五張今天的 relacl 裡,
--      `admin_saved_order_views` 是 `…,pcm_readonly=r,service_role=r`,
--      另外四張是 `…,service_role=r,pcm_readonly=r` —— **同樣的權限, 兩種排序。**
--      ⇒ 📌 **順序本來就不是語意的一部分, 而字串比對會把它當成語意。**
-- 🔵 **會**回到原狀的:`is_grantable`(原本是 `r` 不是 `r*`)與 `grantor`
--    (superuser 執行 GRANT 視同 owner 執行 ⇒ 仍是 `/postgres`;⚠️ 前提是今天那五列確實是 `/postgres`
--     —— 2026-09-18 夜正式庫實查:五張的 `pcm_readonly` 與 `service_role` 兩列 grantor 皆 `postgres`)。
-- 🛑 **不會**回到原狀的另一樣:**欄級授權** —— 表級 REVOKE 會連帶收掉同一個 grantee 的欄級,
--    而本檔**只補表級**。正片前置閘④-d 把「本表有欄級授權」擋在門外(2026-09-18 夜實查五張皆 0 欄),
--    所以那個世界走不到這裡 ⇒ **它在射程外, 不是被處理了。**
-- 🔬 而 `GRANT` 對目標表**零筆鎖**(同一輪實測)⇒ 止血可以馬上跑, 不必等離峰。
--
-- ═══ 🛑 本檔【不】還原 `service_role` 的任何東西 ════════════════════════════
-- 正片沒碰它(正片前置閘④-c + 後置【沒連累·格1】兩邊都證過)⇒ 本檔也不碰。
-- 📌 **還原檔的射程 = 正片的射程。** 正片沒改的, 本檔不准「順便修一下」。
--
-- ═══ 🔵 跑完之後要做的 ══════════════════════════════════════════════════════
-- 正片的 ACL 變更會進 `pcm_acl_digest` ⇒ **還原也會**。跑完同樣要:
--   SELECT public.pcm_acl_digest_record();
--   SELECT public.pcm_acl_approve_latest('跑了 20260918060000-rollback:把 pcm_readonly 在那五張的表級 SELECT 加回去, 理由:<寫下來>');
--   SELECT * FROM public.pcm_acl_drift_status;
-- 🛑 **順序不能反**(理由與正片同)。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_tables text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t text; v_reg oid; n_checked int := 0; n_present int := 0;
BEGIN
  IF pg_catalog.array_length(v_tables, 1) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '還原前置閘:名單不是 5 個 ⇒ 本檔與正片的範圍對不上 ⇒ 停下';
  END IF;
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '還原前置閘:角色 pcm_readonly 不存在 ⇒ 沒有東西可以還原給它 ⇒ 停下';
  END IF;

  FOREACH v_t IN ARRAY v_tables LOOP
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    IF v_reg IS NULL THEN
      RAISE EXCEPTION '還原前置閘[%]:public.% 不存在 ⇒ 停下(要還原的不只是一條權限了)', v_t, v_t;
    END IF;

    -- 🔵 已經在了 ⇒ 數起來、印出來, 而**不擋**。
    --    理由:重複 GRANT 是 no-op(實測 relacl 逐字相同)⇒ 讓它跑完比擋下來安全,
    --    而「它本來就在」這件事讀的人要知道 —— 否則他會以為是本檔補回來的。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT') THEN
      n_present := n_present + 1;
      RAISE NOTICE '🔵 % 那條授權【本來就在】—— 這一張本檔是 no-op(正片沒貼, 或已經被別人還原過)。', v_t;
    END IF;
    n_checked := n_checked + 1;
  END LOOP;

  IF n_checked <> 5 THEN
    RAISE EXCEPTION '還原前置閘:逐表只跑了 % 圈(應該是 5)⇒ 停下', n_checked;
  END IF;
  -- 🔴 **五張全都已經在 ⇒ 本檔整支是 no-op。照實印, 不要讓人以為他止到血了。**
  IF n_present = 5 THEN
    RAISE NOTICE '🔴 五張的授權【全部本來就在】⇒ 本檔整支是 no-op。你要止的血【不是這一片造成的】⇒ 停下來重新判斷。';
  END IF;
END $pre$;

-- 🔴 五句, 寫死不用迴圈 EXECUTE —— 動作要一眼看得到。
GRANT SELECT ON TABLE public.admin_saved_order_views  TO pcm_readonly;
GRANT SELECT ON TABLE public.order_cancellation_items TO pcm_readonly;
GRANT SELECT ON TABLE public.order_cancellations      TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_costs         TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_charge_attempts  TO pcm_readonly;

DO $post$
DECLARE
  v_tables text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t text; v_reg oid; v_acl text; n_checked int := 0;
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    -- 🎯 斷言:那一列【真的回來了】。
    -- 🛑 用 `aclexplode(relacl)`, **不要用 `has_table_privilege`** ——
    --    後者在 PUBLIC 授權或角色繼承下會回 true ⇒ 它會在「什麼都沒補回來」的世界裡照樣印綠。
    --    (板 050000 的 R2 MF1 就是栽在這把尺上。)
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT') THEN
      RAISE EXCEPTION '還原後置閘[%]:GRANT 跑完了, 而 % 的 acl 裡【還是沒有】pcm_readonly 的那一列 ⇒ 拒 COMMIT', v_t, v_t;
    END IF;

    SELECT COALESCE(c.relacl::text, '<NULL>') INTO v_acl
      FROM pg_catalog.pg_class c WHERE c.oid = v_reg;
    RAISE NOTICE '🔬 % 還原之後的 relacl 逐字:%', v_t, v_acl;
    n_checked := n_checked + 1;
  END LOOP;

  IF n_checked <> 5 THEN
    RAISE EXCEPTION '還原後置閘:逐表只跑了 % 圈(應該是 5)⇒ 有表被跳過 ⇒ 拒 COMMIT', n_checked;
  END IF;

  RAISE NOTICE '✅ 已還原:pcm_readonly 的 SELECT 在五張表的 acl 裡都回來了。';
  RAISE NOTICE '🛑 而那些設計現在又破著 —— 請把「為什麼需要還原」寫下來, 不要讓它們變成下一批查不到出處的孤兒。';
  RAISE NOTICE '🛑 別忘了 pcm_acl_digest_record() → pcm_acl_approve_latest(…) → pcm_acl_drift_status, 順序不能反。';
END $post$;

COMMIT;
