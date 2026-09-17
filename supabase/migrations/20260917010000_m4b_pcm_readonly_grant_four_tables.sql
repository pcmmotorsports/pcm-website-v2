-- 🛑🛑 **本支【不要貼】—— 等 Sean 拍 supplier_inbound_emails 那一題** 🛑🛑
--   對抗審查 R1 FAIL(4 must-fix)。M1 / M3 / M4 已修;**M2 要 Sean 拍板**:
--   🔴 `supplier_inbound_emails` 的 `sender`(≤320)/ `subject`(≤500 自由文字)/ `extracted`(≤16KB jsonb)
--      是**外人寫得進來的** —— `status` 的合法值含 `skipped_sender` / `skipped_auth`
--      (`20260916150000:97` 逐字)⇒ **寄件人不在白名單、驗證沒過, 照樣留一列。**
--   ⇒ 📌 任何人寄一封信到那個收件匣 ⇒ 一列進表 ⇒ 之後有人用 readonly-prod-sql.sh 撈稽核
--     ⇒ **外人寫的字直接進到讀的人眼前**。那與貼板 51 擋掉 `last_error` / `note` / `run_ref`
--     是**同一個形狀**, 而本檔原本那段 🛑 一個字都沒提到它。
--   ⇒ 🎯 Q:這張要整張給, 還是照貼板 51 只給欄級?
--        甲|只給 id / gmail_message_id / received_at / auth_passed / status / error_code / created_at
--          (不給 sender / subject / extracted;error_code 有 `^[a-z0-9_]{1,64}$` CHECK 擋著)
--        乙|整張給, 而檔頭明寫「同一把尺這次為什麼不套」
--   ⚠️ **他拍甲 ⇒ 這一張要從本檔的四張改成欄級寫法**, 本檔現況是乙的形狀。
--
-- ═══ 讓唯讀帳號 `pcm_readonly` 讀得到那四張表 ═══
-- 出板:線【設計】設計窗 `11`, 2026-09-17。Sean 拍 **Q14 = 甲**(主視窗 `a5` 轉達),逐字「依照建議」。
-- plan:`docs/plans/2026-09-17-pcm-readonly-seven-tables-grant-plan.md`
--
-- ═══ 為什麼 ═══════════════════════════════════════════════════════════════
-- 「首頁現在掛的是哪一張大圖」目前**沒有唯讀稽核路徑**:`scripts/readonly-prod-sql.sh` 直接
-- `permission denied`,只好改走 Supabase 管理 API 的 SELECT(權限比唯讀角色大很多)才看得到那一列。
-- 📌 **一件「只是要看一眼」的事,逼人去用一把更大的鑰匙。** 那個習慣本身是風險。
--
-- ═══ 🛑🛑 為什麼【另外三張不做】—— 這一段不要刪,也不要「順手補上」 ═══════════
--   `pcm_settle_retry_attempts` · `supplier_sync_runs` · `pcm_incident` **本片刻意不動。**
--
--   🔴 **2026-09-06 ⟦貼板 51⟧(`20260906380000_m4b_pcm_readonly_column_grants.sql`)已經審過三輪**
--     (codex R1 FAIL 8 → R2 FAIL 6+3 → opus adversarial R3 FAIL 4+5+3),**Sean 回「甲」才貼**,
--     結論是:那兩張**只給欄級**,而**刻意不給**這三個自由文字欄 ——
--       `pcm_settle_retry_attempts.last_error`(錯誤原文,掛在金流路徑上)
--       `supplier_sync_runs.note` · `run_ref`(自由文字,誰都可以往裡面寫任何東西)
--     而 `pcm_incident` 由 `20260905290000…:146` 的 `static-checks:no-grant-needed` 標記
--     明文「**本表刻意對每一個角色都隱形**」,並由 `scripts/migration-static-checks.sh` 執行。
--   ⇒ 🔴 **一行 `GRANT SELECT ON TABLE` 會把那三欄一起交出去** —— 那正是別人特地留下不給的。
--   ⇒ **2026-09-17 重新確認,維持不變。🛑 下一個人不要「順手補上」。**
--     要那三張的數字 ⇒ `pcm_incident` 走既有 definer 函式 `get_pcm_incident_health()`;
--     另兩張要加欄 ⇒ **照貼板 51 的欄級做法,而且要 Sean 重新拍**(那等於重開一個拍過的決定)。
--
-- ═══ 🔴 一把會騙人的尺(寫在這裡,因為下一個人會拿本檔當範本)═══════════════
--   `has_table_privilege` 對**欄級**授權**少報** —— 表級問它回 `f`,而那個 `f`
--   **不代表那個角色讀不到任何東西**(貼板 51 檔頭 `:40-43` 已記過)。
--   🔬 2026-09-17 我就是被它騙的:我量到「11 張讀不到」而去提議全部補上,
--     用 `has_column_privilege` 逐欄重量才看到真相 ——
--     **9 張真的一欄都讀不到 + 2 張其實已經給了一半**,而那 2 張正是上面那兩張。
--   ⇒ ✅ **本片的 4 張是用逐欄那把尺確認過「一欄都沒有」的。**
--
-- ═══ 🔴 `rolbypassrls = t` 這個前提(不是本片造成的,而本片依賴它)═══════════
--   `pcm_readonly` 繞得過 RLS ⇒ 📌 **給它表級 SELECT = 它看得到那張表的【每一列】。**
--   對這四張而言那正是要的(稽核要看全量),而**這句要寫在這裡**,因為下一個人
--   拿本檔當範本去 GRANT 別張表時,那個前提仍然成立 **而那時可能不是他要的**。
--   🔴🔴 **而反方向更要緊(R1 M4)**:四張的 RLS 都開著,policy 全是 `TO service_role`,
--     `pcm_net_exposure_snapshot` 更是**零 policy** ⇒ **今天讀得到列,只靠 `rolbypassrls`。**
--     哪天那條 RLS 收緊的線把 BYPASSRLS 收掉 ⇒ **四張同時變成零列**,
--     而 `has_table_privilege` 照樣回 `t`、本檔**沒有一道尺會叫**、
--     稽核腳本會**回空而不是 permission denied** —— 📌 **空比 denied 更難認出是壞的。**
--   ⇒ 🎯 **所以貼完一定要做下面〈貼完要做的事〉那一步**,catalog 綠不算貼完。
--
-- ═══ 🔬 貼完要做的事(不做這一步不算貼完)═══════════════════════════════
--   本檔十二道閘**全在 catalog 層** —— 它們證的是「權限這個欄位變了」,
--   **不證「那個角色真的撈得到列」**。(貼板 105 對同一個坑另做了 105b「真的讀一列」。)
--   ⇒ 用 `bash scripts/readonly-prod-sql.sh <一支 .sql>` 對四張各撈一次 `count(*)`,
--     **四張都回得出數字才算貼完**;任何一張回 0 列而表上其實有列 ⇒ 那就是上面講的那個坑。
--
-- ═══ 🔬 現況(2026-09-17 正式庫唯讀實查;判準用 has_table_privilege / has_column_privilege)═══
--   四張目標:存在 4/4 · 表級 SELECT 全 `f` · 欄級授權 **0 筆**
--   `pcm_readonly`:`rolbypassrls = t` · 不是任何角色的成員(`pg_auth_members` 0 筆)
--   🟢 正對照 `public.orders` = `t`(尺會動,而本片不該影響它)
--   ⚪ 負對照 `public.pcm_incident` = `f`(本片不該讓它變 `t`)
--   分母:`public` 72 張表,表級讀不到 11 張(= 9 真的全不給 + 2 給了一半)
--
-- 🛑 **本片不盲貼**:前置閘先問現況,已經有權限就停下(不重複 GRANT)。
-- 🛑 **單獨貼,不要跟別的 SQL 同批**(R1 N8):被包在外層交易裡跑時,開頭的 `BEGIN;` 只印 WARNING,
--    而檔尾的 `COMMIT;` 會提交【外層】那個交易 ⇒ **本檔想要的原子性在那個模式下是假的。**
-- ⚠️ **挑離峰貼**(R1 N7):`home_banners` 是正式站首頁經 `home_banners_live_v` 正在讀的表,
--    09-15 起有真客人。`GRANT` 會對目標表取鎖,`lock_timeout='5s'` 期間排在它後面的讀也會等。
--    ⚠️ **我沒有實測 PG 對 `GRANT` 取的鎖等級 ⇒ 標未確認**;而挑離峰的成本是零。
-- 🛑 **本片刻意不碰 `COMMENT ON`**(貼板 105 codex R3 must-fix ⑤ 的裁決,原樣沿用):
--    `COMMENT` 只存一份、新值取代舊值 ⇒ 中間若有人更新過那句操作契約,
--    正向會蓋掉它、還原會寫回更舊的版本 —— **兩個方向都不可逆地抹掉他寫的東西。**
--    ⇒ 那句「`pcm_readonly` 有 SELECT」要留紀錄的話,留在**本檔**與 plan 裡就夠了。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $gate$
DECLARE v_miss text;
BEGIN
  -- 前置閘① 角色在
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '前置閘①:角色 pcm_readonly 不存在 ⇒ 停';
  END IF;

  -- 前置閘② 四張都在(🔴 逐張具名 —— 名字打錯一張 = 靜默漏一張, 而不會有東西叫)
  SELECT string_agg(x, ', ') INTO v_miss FROM (
    SELECT t AS x FROM (VALUES
      ('public.home_banners'), ('public.supplier_inbound_emails'),
      ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')
    ) v(t) WHERE pg_catalog.to_regclass(t) IS NULL
  ) s;
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:這些物件不存在 ⇒ 停:%', v_miss;
  END IF;

  -- 前置閘③ 現在【還沒有】權限 —— 已經有了就停(不重複 GRANT, 也避免蓋掉別人剛做的事)
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.home_banners'), ('public.supplier_inbound_emails'),
      ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')
    ) v(t) WHERE has_table_privilege('pcm_readonly', v.t, 'SELECT')
  ) THEN
    RAISE EXCEPTION '前置閘③:pcm_readonly 已經讀得到其中至少一張 ⇒ 停, 先去確認是誰給的';
  END IF;

  -- 前置閘④ 🔴 **全量授權快照**(白名單, 不是黑名單 —— 貼板 105 codex R2 那六條的整個維度)。
  --   含表級與欄級、全 schema。事後閘拿它比差集 ⇒ 多一列少一列都紅,
  --   而它不需要事先知道那一列會是哪一種權限。
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

  -- 前置閘⑤ 🔴 **四張目標上貼前必須【一筆授權都沒有】**(表級或欄級都算)。
  --   理由是還原檔下的是整張的 REVOKE ⇒ 貼前若已有別人給的欄級授權, 還原會把那一份也收掉
  --   ⇒ 📌 我們會刪掉不是我們給的東西。
  --   🔬 2026-09-17 實查:pcm_readonly 全庫有 9 筆欄級授權, 而【那 9 筆全部在本片不碰的那兩張上】
  --     ⇒ 四張目標上是 0 筆 ⇒ 今天這道閘不會擋。⚠️ 而它明天可能會, 那正是它存在的理由。
  IF EXISTS (SELECT 1 FROM _acl_before
              WHERE sch = 'public'
                AND rel IN ('home_banners','supplier_inbound_emails',
                            'pcm_net_exposure_snapshot','shipment_order_ship_clearances')) THEN
    RAISE EXCEPTION '前置閘⑤:四張目標上 pcm_readonly 已有授權(表級或欄級)⇒ 停 —— 還原會把它一起收掉';
  END IF;

  -- 前置閘⑤b 🔴 **事後閘③ 要點名的那三張, 也要先確認它們【在】**(R1 N3)。
  --   不然哪天 pcm_incident 改名 ⇒ has_table_privilege 丟 undefined table ⇒ 整支為【不相干的原因】紅掉,
  --   而訊息會被讀成「刻意不給的表出事了」。📌 一道閘為錯的理由紅, 跟它不紅一樣糟。
  SELECT string_agg(x, ', ') INTO v_miss FROM (
    SELECT t AS x FROM (VALUES
      ('public.pcm_settle_retry_attempts'), ('public.supplier_sync_runs'), ('public.pcm_incident')
    ) v(t) WHERE pg_catalog.to_regclass(t) IS NULL
  ) s;
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑤b:事後閘③要點名的表不存在 ⇒ 停(不是它出事, 是它被改名或刪了):%', v_miss;
  END IF;

  -- 前置閘⑥ 🔴 **角色繼承那條路**:ACL 的 grantee 可能是【上游角色】而不是 pcm_readonly 本人
  --   ⇒ 直接 ACL 快照看不到它, 而 pcm_readonly 仍然讀得到。
  --   📌 那張快照是【直接授權】不是【有效權限】⇒ 這道閘把「它不是任何角色的成員」這個前提釘住。
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'pcm_readonly'::regrole) THEN
    RAISE EXCEPTION '前置閘⑥:pcm_readonly 是某個角色的成員 ⇒ 直接 ACL 快照不再等於有效權限 ⇒ 停';
  END IF;

  -- 前置閘⑦ 🔴 **有權限 ≠ 讀得到列**:四張的 RLS 都開著(2026-09-17 實查 7/7 含本片不碰的三張)。
  --   一個 NOBYPASSRLS 的角色在零 policy 之下會讀到【零列】, 而 has_table_privilege 照樣回 t
  --   ⇒ 那時本片的授權會【安靜地變成零列】, 而沒有任何一道尺會叫。
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '前置閘⑦:pcm_readonly 沒有 BYPASSRLS ⇒ 給了 SELECT 也可能讀到零列 ⇒ 停, 先確認 policy';
  END IF;

  -- 前置閘⑧ 🟢 正對照 —— 這把尺要能印出 t, 否則上面那幾個 f 不算數
  IF NOT has_table_privilege('pcm_readonly', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION '前置閘⑧:正對照失敗(pcm_readonly 對 public.orders 應為 t)⇒ 這把尺沒接上, 停';
  END IF;

  -- 🔵 這個 NOTICE 印的是【貼的當下】的 runtime 值, 不是檔頭那個 2026-09-17 的讀數。
  --   兩者不同是正常的(中間有人動過權限)⇒ 不要把它讀成出事。
  --   📌 而它是【快照到底抓到東西了沒】唯一的人眼證據 —— 印 0 就表示上面那個差集在拿空集合比。
  RAISE NOTICE '前置閘全過。pcm_readonly 貼前共有 % 筆直接授權(表級+欄級, 全 schema;2026-09-17 唯讀實查時是 86)',
    (SELECT count(*) FROM _acl_before);
END
$gate$;

GRANT SELECT ON TABLE public.home_banners                   TO pcm_readonly;
GRANT SELECT ON TABLE public.supplier_inbound_emails        TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_net_exposure_snapshot      TO pcm_readonly;
GRANT SELECT ON TABLE public.shipment_order_ship_clearances TO pcm_readonly;

DO $post$
DECLARE v_bad text;
BEGIN
  -- 事後閘① 四張都要翻成 t
  SELECT string_agg(v.t, ', ') INTO v_bad FROM (VALUES
    ('public.home_banners'), ('public.supplier_inbound_emails'),
    ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')
  ) v(t) WHERE NOT has_table_privilege('pcm_readonly', v.t, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①:這幾張仍讀不到 ⇒ 回滾:%', v_bad;
  END IF;

  -- 事後閘② 🟢 正對照不得被影響
  IF NOT has_table_privilege('pcm_readonly', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②:正對照 public.orders 變成讀不到 ⇒ 本片動到了不該動的東西 ⇒ 回滾';
  END IF;

  -- 事後閘③ 🔴🔴 **那三張刻意不給的, 表級不得變成 t** —— 本片最重要的一道。
  --   ⚠️ 少了它,「四張翻 t」與「全部都翻 t」分不開;
  --   而寫成 GRANT … ON ALL TABLES IN SCHEMA public 的話, 事後閘①照樣綠。
  SELECT string_agg(v.t, ', ') INTO v_bad FROM (VALUES
    ('public.pcm_settle_retry_attempts'), ('public.supplier_sync_runs'), ('public.pcm_incident')
  ) v(t) WHERE has_table_privilege('pcm_readonly', v.t, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘③:2026-09-06 刻意不給的表變成讀得到 ⇒ 本片推翻了一個拍過的決定 ⇒ 回滾:%', v_bad;
  END IF;

  -- 🔴 **這裡原本有一道「欄級授權必須仍是 9 筆」的閘, R1 M3 裁掉了, 理由留著**:
  --   ⛔ ~~IF (…count(attacl) where grantee=pcm_readonly…) <> 9 THEN RAISE~~
  --   ① **count ≠ 組成**:未來有人拿掉 supplier_sync_runs 某一欄、補上 .note 那一欄
  --      ⇒ **仍然是 9 筆 ⇒ 那道閘綠**, 而它宣稱的「貼板 51 原封不動」已經不成立。
  --      📌 一個保證不住在它宣稱的那個東西上, 那個保證是假的。
  --   ② **而下面的事後閘④(差集)已經完全涵蓋它** —— lost/gained 會抓到本片有沒有動到欄級。
  --   ③ **它還是一個未來假紅的定時器**:任何一支合法的未來 migration 多給一欄
  --      ⇒ 本支從此貼不動, 而訊息會把操作者指到錯的地方(本片只有四行【表級】GRANT,
  --        **不可能改 attacl**)。
  -- 事後閘④ 🔴🔴 **差集必須【剛好】是那四列** —— 白名單。
  --   它一次蓋掉整個維度:欄級 / WITH GRANT OPTION / 別的 schema / 誤開第五張 / 誤收既有授權。
  --   🛑 **射程寫準**:快照只含 grantee = pcm_readonly 的【表級與欄級】ACL ⇒ **不在分母裡的有**:
  --     `GRANT … TO PUBLIC` · schema 的 USAGE · 函式 / 程序 EXECUTE · default privileges ·
  --     角色成員關係 · database 層(CONNECT / TEMP / CREATE)· 型別與 domain 的 USAGE ·
  --     語言 USAGE · FDW 與 foreign server · `pg_parameter_acl`(PG15+)· large object。
  --     🔴 **這份清單是我想得到的那些, 而它不保證完整** —— 拿本段當範本的人要自己再想一輪。
  --     本片只有四行 GRANT ⇒ 今天不會發生;而**下一個把這段當範本拿走的人會**。
  --   🔵 grantor 取【物件 owner】不取 current_user:PG 的 select_best_grantor —— 授出者是
  --     superuser 而非 owner 時 ACL 記的是 owner。猜錯的話差集不等於預期 ⇒ 回滾(fail-closed)。
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
      SELECT 'public'::name AS sch, v.t::name AS rel, NULL::text AS col,
             'SELECT'::text AS priv, false AS grantable,
             (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid = ('public.'||v.t)::regclass) AS grantor
        FROM (VALUES ('home_banners'), ('supplier_inbound_emails'),
                     ('pcm_net_exposure_snapshot'), ('shipment_order_ship_clearances')) v(t)
    ), gained AS (SELECT * FROM after EXCEPT SELECT * FROM _acl_before
    ), lost   AS (SELECT * FROM _acl_before EXCEPT SELECT * FROM after)
    SELECT 1 FROM lost
    UNION ALL SELECT 1 FROM (SELECT * FROM gained EXCEPT SELECT * FROM expected) x
    UNION ALL SELECT 1 FROM (SELECT * FROM expected EXCEPT SELECT * FROM gained) y
  ) THEN
    RAISE EXCEPTION '事後閘④:pcm_readonly 的授權差集【不等於】那四列 SELECT ⇒ 多給了、少給了、或收掉了別人的 ⇒ 回滾';
  END IF;

  -- 🔵 **NOTICE 只印有判別力的那兩道**(R1 N2):①(GRANT 完不可能是 f)與
  --   ②(四行表級 GRANT 不可能影響 orders)在本檔的形狀下**恆綠** ——
  --   它們是給【未來改這四行的人】的絆線, 而**把零資訊的格子算進「全過」是在灌水**。
  RAISE NOTICE '事後閘(有判別力的兩道)全過:刻意不給的三張仍讀不到 · 授權差集剛好是那四列';
END
$post$;

-- ═══ rollback ═══════════════════════════════════════════════════════════
-- 🔴🔴 **還原【也要帶閘】**(R1 M1)—— 第一版這裡是四行裸 REVOKE, 而它兩個方向都會安靜做錯事:
--
--   ① **可能多收**:貼完之後若有人給了 `home_banners(title)` 這種【欄級】SELECT,
--      一行表級 `REVOKE SELECT` 會不會連帶把該表的欄級也收掉?
--      ⚠️ **審查者說會(PG 的 REVOKE 語意), 而我查不到權威出處也沒有實測 ⇒ 逐字標【未核】。**
--      🟢 **而下面的修法【不依賴這一題的答案】** —— 前置閘要求「四張上剛好只有本片那四列、
--        零欄級」, 不是就停 ⇒ **會不會連帶, 都不會刪到不是我們給的東西。**
--
--   ② **可能少收而看起來成功**:還原由【非 owner、非 superuser、但持 grant option】的角色跑
--      ⇒ grantor 不吻合 ⇒ **什麼都收不到**, 而 PG 只印 `WARNING: no privileges could be revoked`、
--      離開碼 0 ⇒ 📌 **操作者記成「已還原」而權限還在。** ⇒ 事後閘抓這一個。
--
--   🟢 可逆、零資料風險:GRANT / REVOKE 只改 catalog, 不動任何一列。
--   ⚠️ 還原之後 `readonly-prod-sql.sh` 會回到本片之前的狀態(permission denied),
--      而**不會壞掉任何在跑的東西** —— 本片之前沒有任何程式用 pcm_readonly 讀這四張。
--   🛑 **只 REVOKE 本片給的那四張**;不要寫成 `REVOKE ALL`, 也不要掃 `ALL TABLES`
--      —— 那會把貼板 51 在【別張表】上留下的 9 筆欄級授權一起收掉。
--
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--
--   DO $rb$
--   DECLARE v_bad text;
--   BEGIN
--     -- 還原前置閘 🔴 四張上 pcm_readonly 的直接授權必須【剛好】是那四列表級 SELECT、零欄級
--     IF (SELECT count(*) FROM pg_catalog.pg_class c
--           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
--                LATERAL aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
--          WHERE n.nspname = 'public'
--            AND c.relname IN ('home_banners','supplier_inbound_emails',
--                              'pcm_net_exposure_snapshot','shipment_order_ship_clearances')
--            AND a.grantee = 'pcm_readonly'::regrole
--            AND a.privilege_type = 'SELECT' AND NOT a.is_grantable) <> 4
--        OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute at
--                     JOIN pg_catalog.pg_class c ON c.oid = at.attrelid
--                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
--                          LATERAL aclexplode(at.attacl) a
--                    WHERE n.nspname = 'public'
--                      AND c.relname IN ('home_banners','supplier_inbound_emails',
--                                        'pcm_net_exposure_snapshot','shipment_order_ship_clearances')
--                      AND at.attnum > 0 AND NOT at.attisdropped
--                      AND a.grantee = 'pcm_readonly'::regrole)
--     THEN
--       RAISE EXCEPTION '還原前置閘:四張上的授權不是【剛好本片那四列】⇒ 停 —— 中間有人動過, 還原會刪到不是我們給的東西';
--     END IF;
--   END
--   $rb$;
--
--   REVOKE SELECT ON TABLE public.home_banners                   FROM pcm_readonly;
--   REVOKE SELECT ON TABLE public.supplier_inbound_emails        FROM pcm_readonly;
--   REVOKE SELECT ON TABLE public.pcm_net_exposure_snapshot      FROM pcm_readonly;
--   REVOKE SELECT ON TABLE public.shipment_order_ship_clearances FROM pcm_readonly;
--
--   DO $rbp$
--   DECLARE v_bad text;
--   BEGIN
--     -- 還原事後閘 🔴 四張都要變回讀不到 —— 這一道抓的是上面②那個【靜默無效】
--     SELECT string_agg(v.t, ', ') INTO v_bad FROM (VALUES
--       ('public.home_banners'), ('public.supplier_inbound_emails'),
--       ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')
--     ) v(t) WHERE has_table_privilege('pcm_readonly', v.t, 'SELECT');
--     IF v_bad IS NOT NULL THEN
--       RAISE EXCEPTION '還原事後閘:這幾張還是讀得到 ⇒ REVOKE 沒有生效(多半是 grantor 不吻合)⇒ 回滾:%', v_bad;
--     END IF;
--     -- 🟢 正對照:orders 不該被這一發影響
--     IF NOT has_table_privilege('pcm_readonly', 'public.orders', 'SELECT') THEN
--       RAISE EXCEPTION '還原事後閘:正對照 public.orders 也被收掉了 ⇒ 還原動到了不該動的東西 ⇒ 回滾';
--     END IF;
--   END
--   $rbp$;
--
--   COMMIT;

COMMIT;
