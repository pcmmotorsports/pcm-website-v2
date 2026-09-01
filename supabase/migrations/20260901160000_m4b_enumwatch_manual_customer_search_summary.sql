-- ⟦b9-ENUMWATCH⟧ · 讓告警器看得到客戶搜尋的稽核紀錄
--
-- ── 這一支存在的理由(不是「多一個指標」)────────────────────────────────
-- Sean 2026-09-01 對 ⟦b4-ENUM3⟧ 拍「限速不做」,而他的理由第二句逐字是
--   「員工是信得過的, 而且②已經看得出來了」
-- 🔴 而②現在只做到【寫進表】, 還沒做到【有人會看到】——
--    `admin_audit_log` 今天唯一的讀者是後台 `settings/audit/page.tsx`, **人要自己開**。
--    (2026-09-01 `-a0` 實量:`check-anomaly-alerts.ts` 提 `searched` / `admin_audit_log`
--     / `manual_customer` ⇒ 皆 0;🟢 正對照 `anomaly` ⇒ 11 ⇒ 尺是活的;🔵 負對照 ⇒ 0。
--     storefront `api/cron/` 底下 route 讀 `admin_audit_log` ⇒ 0 / 10。)
-- ⇒ **那個拍板的前提現在只成立一半。本支補的是那一半。**
-- 🛑 而這不是在推翻他的拍板 —— 他拍的是對的, 而我們欠他那一半。
--
-- ── 🔴 為什麼是【新開一支】, 不是把 key 加進 get_payment_anomaly_alert_summary ──
-- repo 已經決定過**兩次**, 兩次都說不要:
--   · `20260819130000:27` 逐字標題「為什麼是【新增一支】,而不是把單號加進
--     `get_payment_anomaly_alert_summary`」
--   · 同檔 `:208` 逐字「本函式【不動】summary RPC 一個字 —— **那支有四代定義分散在
--     四支 migration, 重貼整支會安靜倒退兩代**」
--   · `20260824040000:9` 同一句話又寫了一次
-- 🔵 而我是**被工具的射程救的**:`scripts/latest-definition-of.sh` 回 `newest=20260810220000`,
--    而 port 上有 2026-08-31 才加的兩顆 cutoff 參數 ⇒ **對不上** ⇒ 我沒照它抄, 改直接 grep
--    ⇒ 才撞到上面那兩段。**它的輸出印著自己的盲區, 而那一行今天真的有用。**
--
-- ── 🔴 裸 CREATE、不用 OR REPLACE(抄 `20260824040000:45`)────────────────
-- 這是**新物件**, 撞名要當場紅。OR REPLACE 會把撞名靜靜蓋掉, 而 REVOKE 與斷言照樣綠
-- ⇒ 拿到綠燈, 卻蓋掉了不知道存在的東西。
--
-- ── 回傳只有計數(而【不是】絕對零 PII —— 見下面那一格)────────────────────
-- 本函式**只回計數**:總筆數 + 相異 actor 數。
-- 🛑 **不回 actor 姓名、不回 target、不回 before/after、不回 queryDigits** ——
--    `admin_audit_log` 的 `before`/`after` 可含經銷價與 PII(建表 COMMENT 逐字),
--    而告警訊息會被轉發截圖(`20260819130000:208` 記著這個代價)。
-- 🔵 **為什麼相異 actor 數值得多回一格**:50 次由 1 個人做, 與 50 次由 6 個人做,
--    是兩種完全不同的東西 —— 而只回總數的話, 它們印同一個數字。
-- 🔴🔴 **而「零 PII」這個詞我第一版用得太滿(codex R1 must-fix)**:
--    `manual_customer_search_actors = 1` 時, **在單人值班或已知班表的情境下,
--    那個行為可以被連回唯一一個員工** ⇒ 那不是姓名, 而它在那個分母下等價於姓名。
--    ⇒ 正確的字面是:**本函式不回任何識別字元, 而【計數本身在小樣本下仍可能可再識別】。**
--    ⇒ 而我們接受它, 理由是收件者是內部告警管道、且替代方案(不回 actors)會讓
--      「50 次由 1 個人做」與「50 次由 6 個人做」印同一個數字 —— **那正是這一格的用途。**
--    ⚠️ 這一格若日後要外送(對外報表 / 客服看得到的畫面)⇒ **要重新判**, 不得沿用本註解。
--
-- ── 🛑 而本支【不設門檻、不進 shouldAlert】(2026-09-01 `-6f` 裁甲)──────────
-- 板上 `⟦b4-ENUM3⟧` 自己寫死了判準:「**門檻不要用猜的**」——
-- 沒有基線, 猜低=擋到員工(客服一個下午查幾十次)、猜高=永遠不叫 = 裝飾, **而兩種失敗都不會叫**。
-- ⇒ 本支產生的正是那個基線。門檻是**下一片**, 而那一片要拿真數字去談。
-- 🔴🔴 **而這一格是本檔最重要的一句(codex R2 must-fix,而它說對了)**:
--    ⛔ ~~「它把『要有人想到去開後台』變成『下次寄信時會經過眼前』」~~
--    **那句話【現在為假】** —— 本支落地的當下, **全 repo 沒有任何一個正式消費者呼叫它**
--    (唯一的呼叫在本檔自己的 apply 期斷言裡)⇒ **告警器仍然看不到那些紀錄。**
--    ⇒ 📌 **⇒ 而那正是 `⟦b9-ENUMWATCH⟧` 這一列本身的病:一個沒有人在讀的東西。**
--       **我差一點用同一個病去修那個病, 而且在註解裡寫了一句讓它讀起來像已經解掉了。**
--    ✅ **正確的字面**:本支只做出【資料來源】。**接線(port → adapter → use-case → 信尾那一行)
--       是下一片**, 而在那一片落地之前, 這一支對世界的作用是 **0**。
--    ⚠️ 而下一片落地之後, 天花板仍然是:**那封信只在別的異常觸發時才寄** ⇒ 一整週沒有別的異常
--       ⇒ 這個數字一次都不會被看到 ⇒ **往前一格, 不是解決。**

CREATE FUNCTION public.get_manual_customer_search_summary(
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'manual_customer_search_count',   COUNT(*),
    'manual_customer_search_actors',  COUNT(DISTINCT l.actor)
  )
  FROM public.admin_audit_log AS l
  WHERE l.action = 'admin.manual_customer.searched'
    AND l.created_at >= pg_catalog.now()
                        - pg_catalog.make_interval(secs => GREATEST(p_window_seconds, 0));
$fn$;

COMMENT ON FUNCTION public.get_manual_customer_search_summary(integer) IS
  '⟦b9-ENUMWATCH⟧ 客戶搜尋稽核計數(owner-defined SECDEF 受控窗;payment_confirmer cron 唯讀)。回 jsonb 兩鍵 manual_customer_search_count / manual_customer_search_actors,窗口 = 近 p_window_seconds 秒。🔴 只回計數,不回 actor 姓名 / target / before / after / queryDigits —— 而【計數本身在小樣本下仍可能可再識別】(actors=1 + 已知班表 ⇒ 連得回唯一員工),不得宣稱絕對零 PII;要外送到內部告警管道以外時重新判 —— admin_audit_log 的 before/after 可含經銷價與 PII(建表 COMMENT),而告警訊息會被轉發截圖。🔴 action 字面 admin.manual_customer.searched 與應用層匯出常數 MANUAL_CUSTOMER_SEARCH_ACTION(apps/admin/src/lib/customers/manual-customer.ts:16)【同源】—— 改任一邊必須同時改另一邊,而跨檔守門測試釘著它(改一邊會紅)。🛑 本函式不設門檻、不進 shouldAlert:它產生的是【基線】,門檻是下一片(板 ⟦b4-ENUM3⟧ 逐字「門檻不要用猜的」)。⚠️ p_window_seconds 為負時夾成 0(回當下這一刻的筆數,不回全歷史)—— fail-closed 方向是【少報】不是【全報】。除 owner(postgres)與 superuser 外,僅 payment_confirmer 可執行。';

-- ── 🔴 兩道 ACL,缺一不可 ────────────────────────────────────────────
-- 新函式**出生就自帶 PUBLIC EXECUTE**,而 repo 內零 GRANT 字面可掃、三綠不紅。
-- 先對所有可能的持有者 REVOKE,再只 GRANT 給 payment_confirmer。
REVOKE ALL ON FUNCTION public.get_manual_customer_search_summary(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_manual_customer_search_summary(integer)
  TO payment_confirmer;

-- ── apply 期斷言(失敗即整支 rollback)──────────────────────────────
-- 🔴🔴 **本段第一版被 codex R1 擊破 7 條(2026-09-01),而【每一條的形狀都是同一個】**:
--    我寫的是**黑名單**(「這幾個角色不可以有」),而黑名單在跟下一個沒想到的角色賽跑。
--    ⇒ 改成**白名單**:釘住【允許的完整形狀】,任何多出來的東西都紅。
--    (同一句話 CLAUDE.md 的 Git 紀律那一段也寫過:「黑名單在跟下一個沒想到的前綴賽跑」。)
DO $assert$
DECLARE
  -- 🔴 **收權斷言清單** —— `scripts/migration-static-checks.sh` 的第 ③ 道靠這個變數名數長度
  --    (`:561` 的 awk 只認 `v_relations|v_functions … text[] :=` 這個形狀)。
  --    ⛔ 我第一版沒有它 ⇒ 那道印「可授權物件 1 個,斷言清單列了 0 個 ⇒ 有漏列」而擋下 commit。
  --    🔵 **而它不是為了討好那道閘** —— 下面 FOREACH 真的走它:名字打錯 ⇒ `::regprocedure` 當場炸,
  --       不是靜靜跳過。**清單是承重的,不是裝飾。**
  v_functions text[] := ARRAY[
    'public.get_manual_customer_search_summary(integer)'
  ]::text[];
  v_fn     text;
  v_oid    oid;
  v_owner  oid;
  v_extra  text;
  v_def    text;
  v_keys   text[];
BEGIN
 FOREACH v_fn IN ARRAY v_functions LOOP
  -- 🔴 用 regprocedure 釘住【簽章】,不是只釘名字(codex must-fix #4):
  --    只鎖 proname 時,若日後有人加一支同名 overload,A 可能驗到別支、B 可能任取一列。
  v_oid := v_fn::regprocedure;

  -- A. SECDEF + search_path 釘死(那一支,不是任何一支)
  --    🔴 兩種字面都收:PG 實際存的是 `search_path=""`(帶雙引號),而 `search_path=`
  --       這個寫法在 repo 裡也出現過。**我第一版只寫了不帶引號那個 ⇒ 拋棄式 PG 當場紅**
  --       ⇒ 而那正是這道斷言該有的行為(它抓到了我)。抄的是 repo 既有的防守形狀。
  SELECT p.proowner INTO v_owner FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = v_oid
       AND p.prosecdef
       AND ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig))
  ) THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 A 失敗:非 SECDEF / search_path 未釘死';
  END IF;

  -- B. ACL = 白名單。允許的完整形狀 **只有兩筆**:owner 自己 + payment_confirmer,
  --    且**兩筆都不得帶 WITH GRANT OPTION**(codex must-fix #3:`=X*` 可再轉授而 LIKE 比對全綠)。
  --    🔴 `proacl` 為 NULL(從沒被 GRANT/REVOKE 動過)⇒ aclexplode 回零列 ⇒ 那會讓
  --       「零命中 = 通過」而其實是**出生自帶 PUBLIC**。所以先擋 NULL。
  --    🔴 **不對 pg_roles 做 INNER JOIN** —— PUBLIC 的 grantee 是 oid `0`,而 pg_roles 沒有 0
  --       ⇒ join 會把它**靜靜丟掉**(memory `aclexplode給PUBLIC的grantee是oid0`)。
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) IS NULL THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 B 失敗:proacl 是 NULL = ACL 從沒被動過 = 出生自帶 PUBLIC';
  END IF;
  SELECT string_agg(
           format('grantee=%s priv=%s grantable=%s',
                  a.grantee, a.privilege_type, a.is_grantable), ', ' ORDER BY a.grantee)
    INTO v_extra
    FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(p.proacl) AS a
   WHERE p.oid = v_oid
     AND NOT (
       a.privilege_type = 'EXECUTE'
       AND a.is_grantable = false
       AND a.grantee IN (v_owner, 'payment_confirmer'::regrole::oid)
     );
  IF v_extra IS NOT NULL THEN
    -- 🔵 `RAISE` 的佔位符是 `%`, **不是 `%s`** —— 我第一版寫 `%s` ⇒ 訊息印出「grantable=fs」
    --    (值印完之後多一個裸的 s)。不影響判紅, 而**它會讓讀訊息的人以為欄位叫 fs**。
    RAISE EXCEPTION 'ENUMWATCH 斷言 B 失敗:ACL 有白名單以外的授與(%)。白名單 = owner 與 payment_confirmer 各一筆 EXECUTE 且不可轉授', v_extra;
  END IF;
  -- 🔴 **owner 本身要鎖**(codex R2):owner 若是 anon/authenticated/service_role/payment_confirmer
  --    之一, 上面那個白名單會把它當成合法的一筆放行 —— 而 SECDEF 是【用 owner 的權限跑】
  --    ⇒ owner 是誰, 決定這支函式能碰到什麼。
  IF v_owner::regrole::text IN ('anon','authenticated','service_role','payment_confirmer') THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 B 失敗:函式 owner 是 % —— SECDEF 用 owner 的權限跑, owner 不得是這幾個角色', v_owner::regrole::text;
  END IF;

  -- 🔴 **成員資格**(codex R2):ACL 只講【直接授與】。任何能 `SET ROLE payment_confirmer`
  --    的角色照樣執行得到, 而白名單一格都不會紅。
  --
  -- ⛔ ~~第一版:斷言 payment_confirmer 【沒有任何成員】~~ —— **那個判準寫窄了, 而它把 Sean 擋下來**
  --    (2026-09-01 正式庫實貼 ⇒ P0001 ⇒ 整支 rollback、零改動)。
  --    🔴 而它紅的理由不是一個真的洩漏:正式庫的成員是 `postgres`(= 本函式的 owner)
  --       與 `cli_login_postgres`, 而後者的鏈是 `cli_login_postgres → postgres → payment_confirmer`
  --       ⇒ **它到得了 payment_confirmer, 是因為它已經到得了 owner。**
  --    📌 **⇒ 而 SECDEF 是用 owner 的權限跑的 ⇒ 任何到得了 owner 的角色, 本來就做得到這一切。**
  --       ⇒ 把它們算成「多出來的成員」= 用一個更嚴的判準去禁止一件它已經能做的事。
  --
  -- ✅ **現行判準:除了【到得了 owner 的角色】之外, 零成員。**
  --    ⇒ 它仍然抓得到真正要防的那件事:**有人日後 `GRANT payment_confirmer TO <別的角色>`。**
  --    🛑 **不要放寬成「不檢查」** —— 這一格抓到的是一個真實的事實, 錯的只是判準的邊界。
  --
  -- ⚠️ **天花板與未確認, 照寫:**
  --    · superuser 無視這一切;而 `pg_has_role` 對 superuser 一律回 true
  --      ⇒ 一個 superuser 成員會被本格排除。**那是刻意的**(superuser 在天花板之上)。
  --    · ⚠️ **未確認**:`cli_login_postgres` 的 `rolinherit=f`(不自動繼承, 要明確 `SET ROLE`)——
  --      **本片沒有驗這一格**, 它由別的窗以唯讀連線量到並標為未確認。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
     WHERE m.roleid = 'payment_confirmer'::regrole::oid
       AND NOT pg_catalog.pg_has_role(m.member, v_owner, 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 B 失敗:payment_confirmer 有【到不了 owner 的】成員 ⇒ 那些角色 SET ROLE 之後就執行得到, 而直接 ACL 一格都不會紅';
  END IF;

  -- 而白名單那兩筆**必須都在**(只有「沒有多的」不夠 —— 一筆都沒有也會通過上面那格)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) AS a
     WHERE p.oid = v_oid AND a.grantee = 'payment_confirmer'::regrole::oid
       AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 B 失敗:payment_confirmer 沒拿到 EXECUTE';
  END IF;

 END LOOP;

  -- C. 🟢 正對照:它跑得動,而且**兩個鍵都在**(codex must-fix #6:只驗 count 的話,
  --    刪掉或改名 actors 那個鍵仍然全綠)。期望值是**算出來的**:對回傳自己取 keys。
  SELECT ARRAY(SELECT jsonb_object_keys(public.get_manual_customer_search_summary(86400)) ORDER BY 1)
    INTO v_keys;
  IF v_keys IS DISTINCT FROM ARRAY['manual_customer_search_actors','manual_customer_search_count'] THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 C 失敗:回傳鍵不是預期的兩個(實得 %)', v_keys;
  END IF;

  -- D. 🛑🛑 **這一道【證不到窗口邏輯對不對】, 而我把它寫實, 不假裝。**
  --    ⛔ ~~原本比「0 秒的筆數 <= 24h 的筆數」~~ —— codex R2 擊破兩次, 而兩次都對:
  --      ① `86400 + 0 * COALESCE(p_window_seconds,0)` 這種寫法「提到參數但忽略它的值」⇒ 過關
  --      ② 🔴 **資料為空時兩邊都是 0 ⇒ `0 > 0` 為假 ⇒ 就算窗口方向寫反也過關**
  --         而**空資料不是邊緣情況, 它是現況**。
  --         🔵 **而【為什麼是空的】有錨, 不要讓下一個人自己去猜**:`⟦b4-PURGE1⟧` ——
  --            2026-09-01 11:0x Sean 本人執行(他拍甲、三次確認), 清空正式庫四張表:
  --            `orders` / `order_refunds` / `email_outbox` / `payment_double_charge_anomalies`。
  --            🛑 **⇒ 之後任何「查無 / 0 筆」的結論, 引用前先問:那個 0 的分母是不是這幾張表?**
  --            ⚠️ 而我寫下這一段時**只知道『它是空的』, 不知道為什麼** —— 錨是 2026-09-01 17:0x
  --               由哨兵與主視窗各自獨立告知後補上的。**一個正確的觀察, 而它的成因住在別的地方。**
  --    📌 **⇒ apply 期斷言【沒有測試資料】, 所以它結構上量不到「窗口算得對不對」。**
  --       而一道量不到卻宣稱量到的斷言, **比沒有那道斷言更糟** —— 它讓人停止查證。
  --    ✅ **⇒ 這裡只留一件它真的證得到的事:參數名出現在【函式體】裡(不是簽章裡)。**
  --       ⚠️ 而它擋不住上面那個 `0 * p` 的寫法 —— **明寫, 不要讓下一個人以為擋得住。**
  --    🎯 **⇒ 「窗口算得對不對」由【有資料的地方】驗**:拋棄式 PG 三筆假稽核列 + 突變
  --       (把 `GREATEST(p_window_seconds,0)` 換成硬寫 86400 ⇒ 2026-09-01 實測 rc=3 紅)。
  --       落點寫在這裡, 因為下一個改這支函式的人會讀這一段, 而不會讀我的交件檔。
  SELECT p.prosrc INTO v_def FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF position('p_window_seconds' in v_def) = 0 THEN
    RAISE EXCEPTION 'ENUMWATCH 斷言 D 失敗:函式【體】裡沒有提到 p_window_seconds = 窗口參數被忽略';
  END IF;

  RAISE NOTICE 'ENUMWATCH OK(A-D 全過):SECDEF+search_path 釘死(簽章鎖 integer)/ ACL 白名單恰兩筆且不可轉授 / 回傳鍵恰兩個 / 函式體有【提到】p_window_seconds(而窗口算得對不對, apply 期證不到 —— 見 D 那一段)';
END
$assert$;
