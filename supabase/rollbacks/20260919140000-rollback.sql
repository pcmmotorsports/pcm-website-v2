-- 20260919140000-rollback.sql —— 退回 20260919140000_m4b_manual_no_email_excluded_to_latest.sql
-- M-4b · 板 217 · 窗B(worktree pcm-ops)
-- plan:docs/plans/2026-09-19-20260905210000-view-drift-from-prod-plan.md
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════
-- 把 `public.pcm_manual_no_email_excluded` 建回**舊定義**(= 2026-09-19 貼板 217 之前,
-- 正式庫上跑了四個多月的那一版;逐字取自 `20260905210000` 的 `a5eadca43` 那一版)。
--
-- ══ 🔴 還原【不是免費的】—— 它把「統計虛高」放回去 ════════════════════════
-- 舊版只判「手動 + 信箱留白」, 把**未付款 / 兩信箱皆空 / 已有 outbox** 的單也算進去。
-- ⇒ 🛑 **跑本檔 = 知情地讓那張稽核面再度多報。** 只有在「新版真的壞了」時才跑,
--    而**「為什麼要還原」要寫下來** —— 否則下一個人只會看到它又變回舊的。
-- 🔵 而它是稽核面、沒有任何碼在讀(2026-09-19 實查)⇒ 還原不會弄壞功能, 只會弄壞數字。
--
-- ══ ⚠️ 射程:本檔【不擴張】正片的射程 ═══════════════════════════════════════
-- 正片動的是「定義 + 那支 view 自己的 ACL」⇒ 本檔也只動這兩樣。
-- 🛑 正片沒碰的(四支 pending view、`20260905210000` 那支已貼檔、底表的權限)本檔一律不碰。
--
-- ══ 🔴 一樣要還原 ACL ═══════════════════════════════════════════════════════
-- `DROP VIEW` 同樣會帶走授權 ⇒ 本檔一樣「貼前撈、建完給回去、比集合」。
-- 🛑 比的是 `aclexplode` 的集合, **不是 `relacl::text`**(順序會變 ⇒ 比字串會假紅)。
--
-- ══ 🔵 跑完之後 ═════════════════════════════════════════════════════════════
--   SELECT public.pcm_acl_digest_record();
--   SELECT public.pcm_acl_approve_latest('跑了 20260919140000-rollback:把那支 view 建回舊定義, 理由:<寫下來>');
--   SELECT * FROM public.pcm_acl_drift_status;
-- 🛑 順序不能反。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_acl text;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_manual_no_email_excluded') IS NULL THEN
    RAISE EXCEPTION '還原前置閘:那支 view 不存在 ⇒ 停下(本檔是換回舊定義, 不是新建)';
  END IF;
  -- 🔴 它現在必須是【新定義】—— 不是的話, 本檔沒有東西可以退
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid='public.pcm_manual_no_email_excluded'::pg_catalog.regclass
                    AND a.attname='surface' AND a.attnum>0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '還原前置閘:那支 view 沒有 surface 欄 ⇒ 它已經是舊定義了 ⇒ 正片沒貼, 或已經退過 ⇒ 停下來看';
  END IF;
  SELECT pg_catalog.string_agg(g.grantee::text||':'||g.privilege_type, ',' ORDER BY g.grantee::text, g.privilege_type)
    INTO v_acl
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass;
  IF v_acl IS NULL OR v_acl = '' THEN
    RAISE EXCEPTION '還原前置閘:撈不到 ACL ⇒ 停下, 還原斷言會沒有比對對象';
  END IF;
  PERFORM pg_catalog.set_config('pcm.v217rb_acl_pre', v_acl, true);
  RAISE NOTICE '🔬 退之前 ACL(集合):%', v_acl;
END $pre$;

DROP VIEW public.pcm_manual_no_email_excluded;

-- 🔵 裸 `CREATE`(R1 nit8):前一句剛 `DROP` 過 ⇒ `OR REPLACE` 在這裡是死字,
--    而死字會讓下一個人以為「這裡可能已經有一支」。
CREATE VIEW public.pcm_manual_no_email_excluded
  WITH (security_invoker = true) AS
SELECT
  o.id           AS order_id,
  o.display_id   AS display_id,
  o.order_source AS order_source,
  o.created_at   AS created_at,
  o.cancelled_at AS cancelled_at,
  o.payment_status AS payment_status
FROM public.orders o
WHERE o.order_source IN ('manual_phone', 'manual_line', 'manual_other')
  AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL;

-- ══ 🔴🔴 還原 ACL —— 而本檔【只還原定義, 不還原那四種殘留】═══════════
-- ⛔ ~~GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN … TO service_role;~~
-- 🔬 **第一版那樣寫, 而它【自己的斷言當場紅】**(我實跑抓到的):
--    本檔的後置原本斷言「ACL 與**退之前**一樣」, 而退之前是 `r`(板 217 貼完的樣子),
--    動作卻給回 `rDxtm` ⇒ **動作與斷言互相矛盾** ⇒ 拒 COMMIT。
--    📌 **一支還原檔的動作與它自己的斷言打架 —— 那是設計沒想清楚, 不是斷言太嚴。**
--
-- 🎯 **想清楚之後的答案:本檔【不】把 `Dxtm` 給回去。** 理由:
--   · 那四種**不是板 217 拿掉的** —— 它們是**出生自帶的殘留**,
--     而板 217 `DROP`+`CREATE` 之後那支 view 是新建的 ⇒ 依 Sean 09-05 拍甲**本來就不該再有**。
--   · 本檔同樣是 `DROP`+`CREATE` ⇒ **它建的也是新的** ⇒ 同一句拍板照樣適用。
--   ⇒ 🛑 **把殘留給回去, 才是那個「沒有人要求的改動」。**
-- ⚠️ **而代價要講明:本檔【不是】逐位元組回到貼 217 之前。**
--    定義回去了, 而 `service_role` 停在 `SELECT`(= 09-05 之後任何新物件的樣子)。
--    📌 **「還原」= 撤銷這一片做的事;而那四種不是這一片做的。**
GRANT SELECT ON public.pcm_manual_no_email_excluded TO service_role;

DO $post$
DECLARE v_acl_pre text; v_acl_now text; v_cols text;
BEGIN
  v_acl_pre := NULLIF(pg_catalog.current_setting('pcm.v217rb_acl_pre', true), '');
  IF v_acl_pre IS NULL THEN
    RAISE EXCEPTION '還原後置閘:讀不到退之前的 ACL 基準 ⇒ 沒跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;

  -- ① 真的換回舊定義了
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'order_id,display_id,order_source,created_at,cancelled_at,payment_status' THEN
    RAISE EXCEPTION '還原後置閘:欄位不是舊定義那一組 ⇒ 實得【%】⇒ 拒 COMMIT', v_cols;
  END IF;

  -- ② 🔴 ACL 是【09-05 拍甲之後新物件該有的樣子】—— **與正片同一把尺**。
  --    ⛔ ~~原本斷言「與退之前一模一樣」—— 而那與本檔的動作互相矛盾(見上面那一節)。~~
  SELECT COALESCE(pg_catalog.string_agg(g.privilege_type, ',' ORDER BY g.privilege_type), '<無>')
    INTO v_acl_now
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND g.grantee = pg_catalog.to_regrole('service_role');
  IF v_acl_now IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION '還原後置閘:service_role 的權限應該【恰好只有 SELECT】, 而實得【%】⇒ 拒 COMMIT', v_acl_now;
  END IF;

  SELECT COALESCE(pg_catalog.string_agg(
           COALESCE(g.grantee::pg_catalog.regrole::text, 'PUBLIC')||':'||g.privilege_type, ', '
           ORDER BY COALESCE(g.grantee::pg_catalog.regrole::text,'PUBLIC'), g.privilege_type), '')
    INTO v_acl_pre
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND (g.grantee = 0
          OR g.grantee = pg_catalog.to_regrole('anon')
          OR g.grantee = pg_catalog.to_regrole('authenticated'));
  IF v_acl_pre <> '' THEN
    RAISE EXCEPTION '還原後置閘:anon / authenticated / PUBLIC 不該有任何權限, 而實得【%】⇒ 拒 COMMIT', v_acl_pre;
  END IF;

  -- ③ ⚪ 它讀得出來
  PERFORM 1 FROM public.pcm_manual_no_email_excluded LIMIT 1;

  RAISE NOTICE '✅ 已退回舊定義(6 欄) · ACL 與退之前一字不差 · 查得動。';
  RAISE NOTICE '🛑 而「統計虛高」現在又回來了 —— 請把【為什麼要還原】寫下來。';
  RAISE NOTICE '🛑 別忘了 pcm_acl_digest_record() → pcm_acl_approve_latest(…) → pcm_acl_drift_status, 順序不能反。';
END $post$;

COMMIT;
