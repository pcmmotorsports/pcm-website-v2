-- 20260918030000-rollback.sql —— 退回 20260918030000_m4b_home_banner_orphaned_mail_draft_guard.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ══ 退什麼 ═══════════════════════════════════════════════════════════════════
-- 把 `supplier_inbound_emails_purge_expired()` 換回**貼之前那一版**(無條件整列刪)。
-- 🔴 下面那段本體是【貼之前】從**正式庫 `pg_get_functiondef` 撈下來的**, 不是從 repo 抄的;
--    md5 `dc395ba506b330616a03fb4e43de0e6a`(2026-09-18 唯讀實查), 退完後置閘會再比一次。
--
-- ══ 🛑🛑 **先讀這一段再決定要不要退** ═══════════════════════════════════════
-- 🔴🔴 **先看這一句, 它會改變你的決定**(R1 consider 4):
--    **如果新版已經跑過至少一輪, 退回去不是「把洞打開」, 是【當場踩下去】** ——
--    · 那幾封被清過內容的信, 下一輪**舊版會把整列刪掉** ⇒ 閘**當場**失效, 不是哪天才失效;
--    · 而被清掉的四欄(subject / extracted / gmail_thread_id / error_code)**救不回來**
--      —— 本檔只退函式與三則說明, **退不回資料**。
--    ⇒ 📌 所以「退回去」在跑過之後是**不可逆的一半 + 立即生效的另一半**。
--
-- 退回去 = **把那個洞打開**:一張信件來的草稿放過 90 天之後, 兩道
-- (表上 CHECK `home_banners_mail_published_needs_match` + `admin_home_banner_publish` 裡那段)
-- 以「`source_email_id` 非空」為前提的閘會**同時失效** ⇒ 勾個授權就發得上首頁。
-- 🔬 而那不是推論, 是**複現過的**(2026-09-18 拋棄式 PG):跑舊版清理之後
--    B 閘從「擋」變「放行」、A 閘從 f 變 t、`UPDATE … SET status='published'` ⇒ **UPDATE 1**。
--
-- ✅ **該跑它的世界**:
--    · 貼錯庫
--    · 新版本身寫錯(例如把不該刪的刪了、或把該清的欄清錯)
--    · 新版造成效能問題(那兩個 EXISTS 在大表上)
-- ❌ **不該跑它的世界**:
--    · 「這片看起來沒必要」—— 退掉會把一個**已經複現過**的洞打開
--    · 「新版的事實被證明是錯的」⇒ 📌 **那一種多半該【往前修】不是【往後退】**, 先問人。
--
-- 🔵 **不用先退碼** —— 本片**沒有任何碼**跟著它:簽章、回傳型別、回傳值的意思都沒變
--    (`database.types.ts` 那一列 `Returns: number` 一個字不用動)。
--    🔴 那一顆 commit 的 hash 由 **follow-up commit** 補在這裡, **不要 `--amend`**
--       (amend 會當場換掉 hash ⇒ 這裡釘的那一顆就不存在了)。
--    ⇒ 那一顆 = `2d20307d1`(分支 `agent/ops-17-receipt`)。自己核:`git show --stat 2d20307d1`
--       ⇒ 3 files changed:本檔 + migration + `docs/reference/order-state-gates.md` **一行**
--         (那一行是 pre-commit 的 state-gates-freshness-gate.sh 擋下來要求補的, 不是我主動加的)。
--       ⚠️ 這個 hash 是用 **follow-up commit** 補的, **不是 `--amend`** —— amend 會當場換掉 hash
--          ⇒ 這裡釘的那一顆就不存在了。
--
-- 🔵 `pcm_acl_approve_latest`:**退完也不用跑** —— `CREATE OR REPLACE` 保留既有 ACL,
--    本檔零 GRANT / 零 REVOKE / 零 ALTER OWNER / 零新物件。而退回後置閘**有把 proacl 釘住**,
--    所以「ACL 沒變」不是用講的。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:現在真的是【本片貼上去】的那一版嗎 ────────────────────────────
DO $pre$
DECLARE v_md5 text;
BEGIN
  IF pg_catalog.to_regprocedure('public.supplier_inbound_emails_purge_expired()') IS NULL THEN
    RAISE EXCEPTION '退回前置閘①:public.supplier_inbound_emails_purge_expired() 不存在 ⇒ 停下';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure;

  IF v_md5 = '5f4d90bcfc0f73cce65ac141a87fa11b' THEN
    RAISE NOTICE '✅ 退回前置閘:函式與三則 COMMENT 都是 20260918030000 換上去的那一版 ⇒ 可以退。';
  ELSIF v_md5 = 'dc395ba506b330616a03fb4e43de0e6a' THEN
    RAISE EXCEPTION '退回前置閘②:現值【已經是貼之前那一版】了 ⇒ 這片沒貼, 或已經被退過 ⇒ 不重複退, 停下。';
  ELSE
    RAISE EXCEPTION '退回前置閘③:現值 md5 是 %, 既不是本片寫的 5f4d90bc… 也不是貼前的 dc395ba5… ⇒ 中間有人改成第三版 ⇒ 退下去會把【他的】東西蓋掉 ⇒ 拒退, 交給人判。', COALESCE(v_md5, '(查不到)');
  END IF;

  -- 🔴🔴 **這三格【必須排在上面那個 md5 三岔之後】, 而第一版排在前面 —— 那是個真的 bug。**
  --    可判定情境:**退過一次之後再跑一次**(或這片根本沒貼就跑)⇒ 函式與三則 COMMENT 都是貼前那版
  --    ⇒ 若這三格在前面, 第一個叫的會是「②a:…中間有人改過 ⇒ 退下去會蓋掉他的」
  --       ⇒ **叫操作的人去找一個不存在的第三者**, 而上面那句為這個情境寫好的正確台詞
  --         (「現值已經是貼之前那一版了 ⇒ 這片沒貼, 或已經被退過」)**再也跑不到, 變成死碼**。
  --    📌 **這正是正片為「A 閘 md5 要搬到前置」寫下的同一個理由:訊息會指錯人。**
  --       同一個道理對退回這一側一字不差地成立, 而上一輪只做了正片那一邊。
  --    ⚠️ fail-closed 沒有破(兩種排法都擋得住), 壞的是**診斷**—— 而半夜看那句話的人只有診斷。
  --    ↓ 三則 COMMENT:走到這裡表示函式確定是本片那一版 ⇒ 底下只可能是「COMMENT 被別人改過」。
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure,'pg_proc')))
     IS DISTINCT FROM '843626564416935d388d17af3e2e6fea' THEN
    RAISE EXCEPTION '退回前置閘②a:那支函式的 COMMENT 不是 20260918030000 寫上去的那一則 ⇒ 中間有人改過 ⇒ 退下去會蓋掉他的 ⇒ 拒退';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM '671129a8fa196bc6bb2b1e29c63fdeed' THEN
    RAISE EXCEPTION '退回前置閘②b:home_banners 的表 COMMENT 不是 20260918030000 寫上去的那一則 ⇒ 拒退';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM '36db3a9ee2e8df8d12ac16b68bf23098' THEN
    RAISE EXCEPTION '退回前置閘②c:supplier_inbound_emails 的表 COMMENT 不是 20260918030000 寫上去的那一則 ⇒ 拒退';
  END IF;


END
$pre$;

-- ── 2. 動作 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_inbound_emails_purge_expired()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 天數寫死 90,不收參數:呼叫端傳錯一個數字就會多刪
  -- ⚠️ 大圖的 source_email_id 由 FK 設 NULL(不寫稽核、不動 updated_at);與發布同時跑理論上可能 40P01,PG 會自己解
  DELETE FROM public.supplier_inbound_emails e
   WHERE e.created_at < pg_catalog.now() - interval '90 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;
-- ── 2b. 三則說明也要退回去 ───────────────────────────────────────────────
-- 🔴 **不退這三句的話, 會犯下【與正片 MF1 一模一樣的病, 只是鏡像】**:
--    函式退回舊行為了, 而庫裡留著描述新行為的說明 ⇒ 說明又變成假的。
COMMENT ON FUNCTION public.supplier_inbound_emails_purge_expired() IS '刪掉 90 天前讀過的廠商信紀錄(20260916150000;Sean Q8 甲),回刪除筆數。大圖的 source_email_id 由 FK 設成 NULL。EXECUTE 只給 service_role。';

COMMENT ON TABLE public.home_banners IS '首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙;20260918020000 更正三處過期字面)。draft ⇒ published ⇒ archived(單列不回頭;要重做走 admin_home_banner_duplicate 開一張新草稿,舊那列原封不動)。【函式寫入】五支,各寫 admin_audit_log,都是 SECURITY DEFINER、search_path 空字串、EXECUTE 只給 service_role:admin_home_banner_save_draft / _publish / _archive / _duplicate,以及 system_supplier_mail_record(20260916170000;廠商新品信那條路,actor 固定 system:mail-draft、rights_confirmed 寫死 false)。🔴【非函式寫入】還有一條:home_banners_source_email_id_fkey 是 ON DELETE SET NULL ⇒ supplier_inbound_emails_purge_expired() 90 天清信時,本表的 source_email_id 會被設成 NULL,而且不寫稽核、不動 updated_at ⇒ 去 admin_audit_log 查不到那一次變更是正常的,不是資料損毀也不是有人手動改庫。發布與下架 / 封存都 = 所有在職員工;發布要帶預覽時的 updated_at、要勾授權、預設 14 天下架。已發布的連結一定要是站內 /products… 或 /brands…;信件來的草稿(source_email_id 非空)另外要配到商品且連結指到 /products…。首頁可以同時掛多張(排序由前台決定:starts_at DESC 後 id DESC;輪播最多 HOME_BANNER_MAX_SLIDES = 4 張,而那個上限只在碼裡、DB 端沒有任何閘)。anon / authenticated 零權限;前台讀 home_banners_live_v。⛔ 20260918020000 更正的三句舊字面(留著不刪):① 「寫入只走 admin_home_banner_save_draft / _publish / _archive」⇒ 漏了 _duplicate(20260916250000)與 system_supplier_mail_record(20260916170000)⇒ 函式是五支不是三支;② 「前台目前只顯示最近上架的一張,多張輪播還沒做」⇒ 輪播已經上線(顧客站 main 實查);③ 舊字面把「寫入」寫成只有函式一種 ⇒ 漏掉上面那條 FK 連帶,而那一條不寫稽核。';
COMMENT ON TABLE public.supplier_inbound_emails IS '讀過的廠商新品信(20260916150000;PRD §3.3,Sean Q8 甲)。只存必要欄位、不存信件內文;90 天後由 supplier_inbound_emails_purge_expired() 刪。anon / authenticated 零權限;service_role 讀 + 新增。';

-- ── 3. 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE v_md5 text; v_cfg text; v_acl text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc), p.proconfig::text, p.proacl::text
    INTO v_md5, v_cfg, v_acl
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure;

  IF v_md5 IS DISTINCT FROM 'dc395ba506b330616a03fb4e43de0e6a' THEN
    RAISE EXCEPTION '退回後置閘①:退完之後 md5 是 %, 不是貼前的 dc395ba506b330616a03fb4e43de0e6a ⇒ 沒有退乾淨 ⇒ 拒 COMMIT', v_md5;
  END IF;
  -- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 退回這一側也要驗
  IF v_cfg IS DISTINCT FROM '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '退回後置閘②:proconfig 變成 % ⇒ search_path 沒保住 ⇒ 拒 COMMIT', COALESCE(v_cfg, '(NULL)');
  END IF;
  -- 🔵 ACL 當【集合】比, 不當字串比(proacl 順序不保證)
  IF NOT (v_acl IS NOT NULL
          AND (SELECT count(*) FROM unnest(v_acl::text[]) a) = 2
          AND v_acl::text[] @> ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]) THEN
    RAISE EXCEPTION '退回後置閘③:proacl 變成 % ⇒ 退回不該動到權限 ⇒ 拒 COMMIT', COALESCE(v_acl, '(NULL)');
  END IF;

  -- ④ 三則說明也逐字退回去了(釘 md5)
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure,'pg_proc')))
     IS DISTINCT FROM 'd41b4be6913cd333418168740b9e2f2b' THEN
    RAISE EXCEPTION '退回後置閘④a:函式 COMMENT 沒有退回貼前那一則 ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM 'dcfda5c8c15f666c930524db42c32684' THEN
    RAISE EXCEPTION '退回後置閘④b:home_banners 表 COMMENT 沒有退回 20260918020000 那一則 ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM '1436fe0fb622744f718be6c0ed84946b' THEN
    RAISE EXCEPTION '退回後置閘④c:supplier_inbound_emails 表 COMMENT 沒有退回 20260916150000 那一則 ⇒ 拒 COMMIT';
  END IF;

  RAISE NOTICE '⚠️ 已退回貼前那一版(md5 %) —— 那個洞現在是【開著】的, 見本檔頭。', v_md5;
END
$post$;

COMMIT;
