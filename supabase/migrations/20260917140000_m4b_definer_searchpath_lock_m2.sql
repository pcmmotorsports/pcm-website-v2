-- ═══════════════════════════════════════════════════════════════════════════
-- M2 —— 把【剩下 12 支】SECURITY DEFINER 函式的 search_path 鎖成空字串
-- ═══════════════════════════════════════════════════════════════════════════
-- pcm:idempotent: yes
-- 🔴 **上面那一行的字面是「yes」, 而它的【真正意思是「重跑是安全的」, 不是「重跑是 no-op」。**
--    ⇒ 本片重跑會【報錯中止】, 不會靜靜做第二次。主視窗 2026-09-18 10:0x 貼前實查三件:
--      ① 本檔自包交易(`:59 BEGIN;` / `:296 COMMIT;`)⇒ 中途任何一步炸掉全數退回, 不留半套。
--      ② 回滾表是裸 `CREATE TABLE`(`:148`)【沒有 IF NOT EXISTS】⇒ 第二次跑當場撞名失敗。
--      ③ 快照斷言逐字要求「回滾帳恰好 12 列」⇒ 就算 ② 被繞過, 24 列也會 `RAISE EXCEPTION` 拒 COMMIT。
--    ⇒ 🎯 **兩道各自獨立的停法, 而兩道都是 fail-closed。** 頂層那兩支 INSERT:
--      `:68` 進的是 `ON COMMIT DROP` 的 TEMP 表(每次交易都是新的, 本來就不累積);
--      `:198` 進的是 ② 那張表, 由 ②③ 兜住。
--    🔵 貼前正式庫實查(負對照 + 正對照, 證明那把尺會動):
--      `to_regclass('public.pcm_definer_searchpath_rollback_20260917140000')` ⇒ **NULL(還沒貼)**
--      `to_regclass('public.pcm_definer_searchpath_rollback_20260905100000')` ⇒ **在(M1a 那片的, 貼過)**
--
-- Plan:docs/plans/2026-09-17-definer-searchpath-m2-plan.md(窗 B 寫,179 行,名單與證據都在裡面)
-- Sean 2026-09-17:Q7 甲(要做)· Q3 甲(排下一批 = 現在)· Q4 甲(一支板全收 12 支,不拆)
-- 前例:supabase/migrations/20260905100000_m4b_definer_searchpath_lock_m1a.sql(M1a 那 3 支)
--
-- 🔴🔴 **本片【不動 body】** —— 只改 proconfig 的 search_path 那一項。
--    事後斷言比對每支 md5(prosrc):改前改後必須一模一樣。
--    📌 md5(pg_get_functiondef) 【不能用】:它含 SET 子句, 本片本來就會讓它變。
--
-- 🔴🔴 **不可以用 CREATE OR REPLACE** —— 它會把 SET 子句【整組換掉】,
--    而這 12 支裡有 **6 支帶著 lock_timeout=5s**(#2 #3 #4 #5 #7 #11)⇒ 會靜靜消失。
--    ⇒ 🛑 **而我不靠這句話擔保** —— 事後斷言③ 直接量那 6 支事後仍含 lock_timeout=5s。
--
-- 🔵 **「鎖成空字串」不等於「pg_temp 被拿掉了」**(對抗審查 R1 的 N3):
--    PG 文件:`pg_temp` **沒有明列在 search_path 時, 它被【最先】搜尋**(比 pg_catalog 還前面),
--    只對 relation 與型別名有效。⇒ 本片是把 pg_temp 從「明列在最後」換成「隱含在最前」。
--    🟢 今天零影響 —— 12 支 body 全名(下面那段實查)。
--    🛑 **而它改變的是【以後寫錯時的失敗形狀】**:哪天有人在某支 body 裡加一個裸表名,
--       失敗可能不是乾淨的 `relation does not exist`, 而是**吃到 temp table**
--       ⇒ 📌 **全名是承重的, 不是風格。**
--    ⚠️ **這一段是讀文件推的, 本窗【沒有在 PG 上實跑驗證】** —— 要當結論用之前先自己跑一發。
--
-- 🔵 **危險性要用對的說法**(總表 B.4 那句要更正,plan §4 有完整實查):
--    ⛔ ~~「public 可寫 ⇒ SECDEF 提權標準路徑」~~ —— **現在不成立**:
--       has_schema_privilege 對 public 的 CREATE:anon f · authenticated f · authenticator f ·
--       service_role f · **postgres t**(正對照 ⇒ 那把尺印得出兩種值)。
--    ✅ 真正的理由 = **縱深防禦**(哪天有人 GRANT CREATE 就當天變破口)+ 與另外 193 支一致 + 成本極低。
--    🛑 **本片不是在修一個正在被利用的洞, 也不擋上線。** 不要把它讀成那樣。
--
-- 🔬 **開工前實查(本窗 2026-09-17 自己跑,不是抄 plan)**:
--    12 支全部在、prosecdef 全 t、search_path 全部精確等於 `public, pg_temp`、
--    12 支 md5(prosrc) 與 plan §2 那張表**逐支相符**;其中 6 支帶 lock_timeout=5s。
--    🔵 **正對照(證明 proconfig 那一欄印得出多種值,不是量壞的)**:同一發查詢
--       public schema 的 proconfig 分佈印出 **12 種不同的值**,其中 search_path="" 有 **193** 支(152 SECDEF)。
--
-- 🛑 **靜態全綠不代表沒事**(09-05 那片踩過):ALTER ... SET search_path = 空字串
--    在【下的當下零警告零錯誤】,body 裡若有裸引用, 要等到**有人真的呼叫**才炸。
--    ⇒ plan §3 已逐支查過三類裸引用(表 / 型別 / 函式)全 0,而**真正的驗收是貼完之後有人走一遍後台**。
--    ⇒ 🔴 這 12 支裡 **10 支是 trigger**, 掛在錢的表上(order_refunds 3 / order_item_procurement 系列 4 /
--      order_cancellations 2 / shipments 1)⇒ 改壞的樣子是「**後台員工登到貨 / 登退款 / 建箱 / 取消單會噴錯**」,
--      客人端不受影響(前台不寫這幾張表)。
--    🔵 **而 plan §2 第 1 列那句「後台直接 .rpc() 叫」與正式庫不符**(對抗審查 R1 的 N4;本窗重查確認):
--       `admin_update_order_item_workflow` 今天的 `proacl` 逐字 `{postgres=X/postgres}`
--       —— EXECUTE 已於 `20260807120000_m4b_e10_a9v_nine_code_writer_revoke.sql` 收回
--       ⇒ **service_role 現在根本叫不動它**。⇒ 風險比 plan 寫的**更低**, 而真的會噴的是另外 10 支 trigger。
--       🛑 plan 那一列還沒改(那是別窗的檔)⇒ 已回報主視窗。
--
-- ↩️ Rollback:public.pcm_definer_searchpath_rollback_20260917140000 存了每支的原值(含整個 proconfig 陣列)。
--    還原檔:supabase/rollbacks/20260917140000-rollback.sql
--    🔴 **寫回去要用【不加引號的清單形式】**:
--        ALTER FUNCTION public.<簽名> SET search_path = public, pg_temp;
--    ⛔ ~~SET search_path = 單引號包住的 'public, pg_temp'~~ 存進去會變成【帶雙引號的】
--       "public, pg_temp",與原字面不是同一個東西 ⇒ 函式行為會對, 而 acl-snapshot 的
--       FNCFG 族會叫,而那個叫聲會被讀成「有人動了權限」。(09-05 拋棄式 PG 實測)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- sig 是【帶參數名】的形式(pg_get_function_identity_arguments)——
-- 🔴 不可以改用 to_regprocedure(sig):它只吃型別, 會對「p_actor text」丟 invalid type name。
--    (09-05 那片是拋棄式 PG 實跑才炸出來的, 靜態看不出來。)
CREATE TEMP TABLE pcm_m2_targets(
  sig               text PRIMARY KEY,
  body_md5          text NOT NULL,
  has_lock_timeout  boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO pcm_m2_targets(sig, body_md5, has_lock_timeout) VALUES
  ('admin_update_order_item_workflow(p_item_id uuid, p_expected_version integer, p_patch jsonb, p_actor text, p_request_id text)', '65e18437e755789c57fd0c002bdca77b', false),
  ('pcm_a2b1_procurement_allocation_guard()', '9134bce6f547eb6c26c0cae2b11f2626', true),
  ('pcm_a4a_cancellation_summary_recompute()', 'fc05eb19535cc68469a8b6396add9385', true),
  ('pcm_a4a_procurement_summary_recompute()', '1e02c103106d16a0464023104af71238', true),
  ('pcm_a4a_receipts_received_sync()', '4f6e8ea6e68f31dcb002458eb69b981b', true),
  ('pcm_a4a_received_quantity_guard()', '74ed8fa699ca145dcb660cf4547b497f', false),
  ('pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)', '463a9b96bf2c3736fce0f0497614d400', true),
  ('pcm_a7c_refund_immutable_guard()', '589c44d20e6048dd0f3bd6855f17dee5', false),
  ('pcm_a7c_refund_insert_guard()', '4f2d60495256f6577e4fb5f4a49f21f8', false),
  ('pcm_assert_cancellation_has_items()', '9356c3ecc4484b2340b8ac5b9bf0d766', false),
  ('pcm_b2_shipments_items_presence()', '32383cb7c210e2b9984eb343b5f5e828', true),
  ('pcm_order_refund_cap_guard()', '65f0e2baaedbe44ab03f5df1d916d93a', false);

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_oid oid; v_sp text; v_lt text; v_md5 text; v_secdef boolean; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m2_targets LOOP
    SELECT p.oid INTO v_oid
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = r.sig;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘①:找不到 public.% —— 簽名打錯或它不在了。拒繼續。', r.sig;
    END IF;
    SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'),
           (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'lock_timeout=%'),
           pg_catalog.md5(prosrc), prosecdef
      INTO v_sp, v_lt, v_md5, v_secdef
      FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF NOT v_secdef THEN
      RAISE EXCEPTION '前置閘②:public.% 不是 SECURITY DEFINER ⇒ 它不在本片的射程裡, 拒繼續。', r.sig;
    END IF;
    IF v_sp IS DISTINCT FROM 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION '前置閘③:public.% 現在的 search_path 是 %,不是我量到的 public, pg_temp ⇒ 正式庫已經變了, 拒繼續。', r.sig, COALESCE(v_sp,'(未設)');
    END IF;
    IF v_md5 <> r.body_md5 THEN
      RAISE EXCEPTION '前置閘④:public.% 的 body 已經被改過(md5 % 不等於我量到的 %)⇒ 我釘的前提不成立, 拒繼續。', r.sig, v_md5, r.body_md5;
    END IF;
    -- 🔴 lock_timeout 的【有無】也要在貼之前對上 —— 否則事後斷言③ 拿的是一個沒對過的前提,
    --    而那會讓「本來就沒有」與「被我弄丟了」印同一個結果。
    IF r.has_lock_timeout AND v_lt IS DISTINCT FROM 'lock_timeout=5s' THEN
      RAISE EXCEPTION '前置閘⑤:public.% 我記著它有 lock_timeout=5s, 而現在是 % ⇒ 前提變了, 拒繼續。', r.sig, COALESCE(v_lt,'(沒有)');
    END IF;
    IF (NOT r.has_lock_timeout) AND v_lt IS NOT NULL THEN
      RAISE EXCEPTION '前置閘⑥:public.% 我記著它沒有 lock_timeout, 而現在有 % ⇒ 前提變了, 拒繼續。', r.sig, v_lt;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  -- 🔴 **硬釘支數** —— 只防 v_n=0 擋不住【清單少列一支】:那時前後兩閘讀的是同一張少了一列的表
  --    ⇒ 一切自洽、全綠, 而那一支沒被鎖。(09-05 codex must-fix)
  IF v_n <> 12 THEN
    RAISE EXCEPTION '前置閘⑦:檢查數是 %,不是我釘的 12 ⇒ 清單被動過或有函式不見了, 拒繼續。', v_n;
  END IF;
  -- 🔵 同理釘住「帶 lock_timeout 的有幾支」—— 6 這個數字是量到的, 改清單要同時改它。
  IF (SELECT count(*) FROM pcm_m2_targets WHERE has_lock_timeout) <> 6 THEN
    RAISE EXCEPTION '前置閘⑧:帶 lock_timeout 的支數不是我釘的 6 ⇒ 清單被動過, 拒繼續。';
  END IF;
  -- 🔴🔴 **前置閘⑨ —— 對抗審查 R1 的 N2:上面 ⑦⑧ 讀的是【我自己那張清單】**
  --    ⇒ 它們答的是「我的清單被人改過沒」, **答不了「我的清單是不是全集」**。
  --    第 13 支(例如有人在 dashboard 手改回 public, pg_temp)會【靜靜不在射程裡】,
  --    而檔頭逐字宣稱「剩下 12 支」⇒ 那件事會被記成做完而其實沒有。
  --    ⇒ ✅ 這一格改成問【資料庫】,不是問我的清單。
  --    🔬 本窗 2026-09-17 唯讀實查:正好 12 支、沒有第 13 支;
  --       🔵 正對照(證明這把尺會動):同一句改成數 search_path="" 的 SECDEF ⇒ **172** 支。
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
             = 'search_path=public, pg_temp') <> 12 THEN
    RAISE EXCEPTION '前置閘⑨:public 底下停在 public, pg_temp 的 SECDEF 不是 12 支 ⇒ 我的清單不是全集(有人新增/改回了一支), 拒繼續。';
  END IF;
  RAISE NOTICE '✅ 前置閘:% 支都在、全是 SECDEF、search_path 是預期值、body 未被改動、lock_timeout 有無也對得上', v_n;
END $$;

-- ── 前態快照(rollback 唯一的依據)──────────────────────────────────────
-- 🔴 存【整個 proconfig 陣列】而不只是 search_path 那一項 —— 還原的人要看得到
--    它原本還帶了什麼(例如 lock_timeout=5s), 否則還原會變成另一種資料遺失。
CREATE TABLE public.pcm_definer_searchpath_rollback_20260917140000 (
  sig                text PRIMARY KEY,
  search_path_before text NOT NULL,
  proconfig_before   text[] NOT NULL,
  body_md5_before    text NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pcm_definer_searchpath_rollback_20260917140000 IS
  '退場:本片上線滿一週且後台走過一遍(登到貨 / 登退款 / 建箱 / 取消單)⇒ DROP。在那之前它是唯一能寫回原值的東西。';
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260917140000 FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260917140000 FROM anon, authenticated;
-- 🔴🔴 上面兩道收不到【具名的 service_role】—— Supabase 的 default privileges 可能讓新表
--    自帶 service_role 的 ALL(含 TRUNCATE), 🛑 **而 RLS 不管 TRUNCATE**
--    ⇒ 開了 RLS 也擋不住它把這張回滾帳清空。一句明文 REVOKE 不依賴那個設定維持不變, 而它免費。
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260917140000 FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_definer_searchpath_rollback_20260917140000 ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_definer_searchpath_rollback_20260917140000 -- 只給 postgres 用的回滾帳;四個應用角色(anon/authenticated/service_role/payment_confirmer)四道 REVOKE 全收,沒有任何後台路徑會讀它 ⇒ 補 policy 反而是給它一條不存在的用途。退場:上線滿一週且後台走過一遍 ⇒ DROP。

-- static-checks:no-grant-needed 這張回滾帳【刻意零 GRANT】—— 它只給 postgres 用,
--   四個應用角色四道 REVOKE 全收。給它 GRANT 等於給它一條不存在的用途。

-- ── 收權斷言(GRANT/REVOKE 是我寫的動作, 這一段是量到的結果)──────────
DO $$
DECLARE
  v_relations text[] := ARRAY['public.pcm_definer_searchpath_rollback_20260917140000']::text[];
  r text; v_role text; v_priv text; v_oid oid; v_bad int := 0; v_checked int := 0;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '收權斷言:找不到 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','payment_confirmer'] LOOP
      -- 🔴 **TRUNCATE 一定要在清單裡** —— RLS 不管它。
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_oid, v_priv) THEN
          v_bad := v_bad + 1;
          RAISE WARNING '收權斷言:% 上 % 仍有 %', r, v_role, v_priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF v_checked = 0 THEN
    RAISE EXCEPTION '收權斷言:檢查數為 0 —— 這個斷言沒有分母, 不算通過。';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '收權斷言失敗:% 項權限沒收乾淨 ⇒ 拒 COMMIT', v_bad;
  END IF;
  RAISE NOTICE '✅ 收權斷言:% 張表 × 4 角色 × 5 種權限, 全部為 0', v_checked;
END $$;

INSERT INTO public.pcm_definer_searchpath_rollback_20260917140000 (sig, search_path_before, proconfig_before, body_md5_before)
SELECT t.sig, 'public, pg_temp', p.proconfig, t.body_md5
  FROM pcm_m2_targets t
  JOIN pg_catalog.pg_proc p ON p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = t.sig
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';

-- 🔴 快照沒存滿 12 列 ⇒ 還原檔會少那幾支, 而它要到災難當下才會被發現。
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.pcm_definer_searchpath_rollback_20260917140000;
  IF v_n <> 12 THEN
    RAISE EXCEPTION '快照斷言:回滾帳只有 % 列, 不是 12 ⇒ 有簽名沒對上, 拒 COMMIT', v_n;
  END IF;
  RAISE NOTICE '✅ 快照斷言:回滾帳 12 列, 含整個 proconfig 陣列';
END $$;

-- ── 主路徑 ────────────────────────────────────────────────────────────────
-- 🔴 %L 給的是空字串 ⇒ 存進去是 search_path=""。
--    ⛔ 不可以寫成 SET search_path = 'public, pg_temp' 那種單引號包整串的寫法。
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m2_targets LOOP
    EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', r.sig, '');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '✅ 已鎖 % 支', v_n;
END $$;

-- ── 事後斷言 ──────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_oid oid; v_sp text; v_lt text; v_md5 text; v_n int := 0; v_lt_kept int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m2_targets LOOP
    SELECT p.oid INTO v_oid
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = r.sig;
    SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'),
           (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'lock_timeout=%'),
           pg_catalog.md5(prosrc)
      INTO v_sp, v_lt, v_md5 FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_sp IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後斷言①:public.% 鎖完是 %,不是空字串 ⇒ 拒 COMMIT', r.sig, COALESCE(v_sp,'(未設)');
    END IF;
    IF v_md5 <> r.body_md5 THEN
      RAISE EXCEPTION '事後斷言②:public.% 的 body 被動到了(md5 % 不等於 %)⇒ 本片只該改 proconfig, 拒 COMMIT', r.sig, v_md5, r.body_md5;
    END IF;
    -- 🔴🔴 **這一格就是「ALTER 只動 search_path 那一項」的實證** —— 不是我用記憶擔保的。
    --    CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 真走錯路的話這裡當場紅。
    IF r.has_lock_timeout THEN
      IF v_lt IS DISTINCT FROM 'lock_timeout=5s' THEN
        RAISE EXCEPTION '事後斷言③:public.% 的 lock_timeout 不見了(現在是 %)⇒ SET 子句被整組換掉, 拒 COMMIT', r.sig, COALESCE(v_lt,'(沒有)');
      END IF;
      v_lt_kept := v_lt_kept + 1;
    ELSE
      -- 🔵 反方向也要守:本來沒有的不該冒出來(那表示我動到了不該動的東西)。
      IF v_lt IS NOT NULL THEN
        RAISE EXCEPTION '事後斷言④:public.% 本來沒有 lock_timeout, 現在冒出 % ⇒ 拒 COMMIT', r.sig, v_lt;
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 12 THEN RAISE EXCEPTION '事後斷言⑤:檢查數是 %,不是釘住的 12, 拒 COMMIT', v_n; END IF;
  IF v_lt_kept <> 6 THEN RAISE EXCEPTION '事後斷言⑥:保住 lock_timeout 的是 % 支,不是 6, 拒 COMMIT', v_lt_kept; END IF;

  -- 🔵 負對照:同一把尺對一支【本片沒動】的函式要印【非空】——
  --    否則「全部都是空字串」的成因可能是這把尺對什麼都印空字串。
  -- 🔴 先斷言對照組【存在】再比值:函式不存在時 v_sp = NULL, 而
  --    `NULL IS DISTINCT FROM '...'` 是 true ⇒ **負對照在「對照組根本不存在」的世界裡照樣通過**,
  --    而那正是它最該叫的那個世界。(09-05 codex must-fix)
  v_oid := to_regprocedure('public.rls_auto_enable()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '🔴 負對照的對照組 rls_auto_enable() 不存在 ⇒ 這一格證不到任何事, 拒 COMMIT';
  END IF;
  SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%') INTO v_sp
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_sp = 'search_path=pg_catalog' THEN
    RAISE NOTICE '🔵 負對照通過:未動的 rls_auto_enable 仍是 % ⇒ 上面那些空字串是本片做的', v_sp;
  ELSE
    RAISE EXCEPTION '🔴 負對照失敗:rls_auto_enable 的 search_path 是 %,不是我釘的 search_path=pg_catalog ⇒ 對照組本身被動過, 上面的斷言沒有判別力, 拒 COMMIT', COALESCE(v_sp,'(未設)');
  END IF;
  -- 🔴 **與前置閘⑨ 同一把尺,事後要等於 0** —— 這一格才是「真的收乾淨了」的實證:
  --    它不繞著我的清單轉, 它問的是資料庫「還有沒有人停在 public, pg_temp」。
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
             = 'search_path=public, pg_temp') <> 0 THEN
    RAISE EXCEPTION '事後斷言⑦:鎖完之後 public 底下【還有】SECDEF 停在 public, pg_temp ⇒ 沒收乾淨, 拒 COMMIT';
  END IF;

  RAISE NOTICE '✅ 事後斷言:12 支全鎖成空字串、6 支的 lock_timeout 都還在、body 一支都沒動、全庫 SECDEF 已無人停在 public, pg_temp';
END $$;

COMMIT;
