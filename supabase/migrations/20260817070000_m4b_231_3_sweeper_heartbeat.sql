-- 20260817070000_m4b_231_3_sweeper_heartbeat.sql
-- `#231` ③:sweeper **靜默死亡**偵測 —— 心跳表(甲′ = 單列三值 upsert)
--
-- 鐵則 8 + 12③(權限面 + DDL)。Sean 2026-08-17 批「可以做」;主視窗改派施工給 B 窗。
-- 規格來源(自足、逐字):`~/pcm-mailbox/E-701-B窗兩份可施工規格-心跳表甲prime與E683-1-20260817.md` §②
-- 🔴 **寫/驗分離**:B 窗寫、**E 窗驗**。本檔作者不驗自己的產出。
--
-- 🔴🔴 **本檔對 E 窗規格有三處【刻意偏離】,理由都是 repo 自己的守門要求(不是我改主意)**:
--   ① 規格寫 `CREATE TABLE IF NOT EXISTS` ⇒ **改成裸 `CREATE TABLE`**。
--      `scripts/migration-static-checks.sh` ① 明文禁 `IF NOT EXISTS`,理由逐字:
--      「撞名要當場紅,不要靜靜跳過。跳過之後,你的 REVOKE 與斷言會對著那個既有物件跑
--        而且很可能通過 —— 拿到綠燈,而這支 migration 什麼都沒建。」
--   ② 規格沒有 `BEGIN;` / `COMMIT;` ⇒ **補上**(同守門 ②:檔頭 BEGIN、檔尾 COMMIT、中間不得結束交易)。
--   ③ 規格的 REVOKE 只收具名角色 ⇒ **加上 `FROM PUBLIC`**。
--      `docs/patterns/revoking-function-execute-in-supabase.md` 與 E-684 樣板都寫「兩道都要下:
--      `FROM PUBLIC` 收不到具名授權,`FROM 具名` 收不到 `PUBLIC` 授權」。
--   ⇒ **三處已回報 E 窗**(它是驗收方,規格是它寫的)。
--
-- ══ 1. 為什麼要這張表 —— 這是【偵測缺口】,不是正在燒 ═══════════════════════════
--
-- `#231` ③ 自己寫的後果逐字:**「sweeper 死了沒人發現」**。它成立,而成因有兩層:
--
-- 🔴 **層一:告警的觸發條件,全部要靠 sweeper【活著】才會成立。**
--    `checkAnomalyAlerts` 的條件是 `open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0`
--    —— **沒有一條是「sweeper 沒跑」**。而 `attemptManualReview` 要靠 sweeper 活著才會被推上去
--    (轉人工發生在 `attempt_count >= 8`)
--    ⇒ **sweeper 死掉 ⇒ 沒東西遞增 ⇒ 沒東西達 ceiling ⇒ 那個計數停在 `0` ⇒ 不告警。**
--    ⇒ **死掉的 sweeper,在【正好用來報告它的那個計數器】上產生沉默。**
--
-- **層二:告警與被監控者共用同一套基礎設施**(同一支 migration / 同一個 wrapper
--    `pcm_cron.invoke_cron_route` / 同一組 vault secret)⇒ 任一壞掉兩個一起停,
--    而停掉的正是要來通知你的那個。
--    ⚠️ **本片【繞過】層二,沒有拆掉共用** —— 明寫,不假裝解決了。
--
-- ══ 2. 為什麼是新表,而不是拿現成欄位當心跳(三個都排除過)═══════════════════════
--
--   `payment_charge_attempts.last_*_at`  → **per-row**,不是 job 級
--   `payment_webhook_events.processed_at`→ 🔴 **最像而最危險**:sweeper**健康但沒事做**時它不前進,
--                                          **與 sweeper 死掉一模一樣** ⇒ 兩個世界同值,不可當心跳
--   `net._http_response`                 → TTL 僅 6h,且 `anon` 有 TRUNCATE/DELETE(`E686-1`)
--                                          ⇒ **可被抹掉的軌跡不能當健康來源**
--
-- ══ 3. 甲′ = 單列三值 upsert,**不是**每輪 append 一列 ═════════════════════════
--
-- 🔴 **Sean 批的是甲′。** plan 正本(`docs/specs/2026-08-17-sweeper-heartbeat-plan.md`)§1a
--    寫的是 append 型 `sweeper_run_log`,**那節已被取代,不要照它做**。
--    append 型每 2 分鐘 +1 列 ⇒ 約 720 列/日、26 萬列/年,不決定保留策略會無限長大;
--    甲′ 直接把那個問題消掉(**每個 job 一列**,PK = `job_name`)⇒ **不需要保留策略**。
--    ⚠️ 不是「永遠一列」(codex `nit`):job 多了列就多,只是**不隨時間成長**。
-- ⚠️ **代價:甲′ 沒有歷史** —— 查不到「過去 24 小時失敗過幾次」,只知道當下三個值。
--    本片**接受**這個代價:要的是「它還活著嗎」,不是趨勢分析。

BEGIN;

CREATE TABLE public.sweeper_heartbeat (
  job_name             text        PRIMARY KEY,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  consecutive_failures integer     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sweeper_heartbeat IS
  'sweeper 存活心跳（甲′＝單列三值 upsert，每個 job 一列）。'
  '存在理由：告警的觸發條件全部要靠 sweeper 活著才成立 ⇒ sweeper 死掉時，'
  '正好用來報告它的那個計數器會停在 0 而不告警。'
  '零 PII／零金額／零訂單編號／零 rec_trade_id。'
  '無歷史（刻意）：只答「它還活著嗎」，不答趨勢。';

-- ══ 4. 🔴🔴 出生自帶的預設授權,當場收掉 ══════════════════════════════════════
--
-- **本表就是 `E683-1` 描述的那個受害者**:新表出生自帶 `anon` 的 `Dxtm`(含 TRUNCATE)。
-- 🔴 **即使 `E683-1` 先 apply,這幾行也【不能】省。** 理由(E 窗規格 §⓪-2 逐字):
--    `ALTER DEFAULT PRIVILEGES` **只作用於之後建的物件**,而「之後」是相對於 **apply 時刻**,
--    **不是相對於你寫 migration 的時刻** —— 兩支的 apply 順序若被誰換過,省掉的那道就沒了。
-- 🔴 **兩道都要下**:`FROM PUBLIC` 收不到具名授權,`FROM 具名` 收不到 `PUBLIC` 授權。
REVOKE ALL ON public.sweeper_heartbeat FROM PUBLIC;
REVOKE ALL ON public.sweeper_heartbeat FROM anon;
REVOKE ALL ON public.sweeper_heartbeat FROM authenticated;

-- 縱深防禦:開 RLS 且**不建任何 policy**。
-- ⚠️ **「`service_role` 走 BYPASSRLS 所以不受影響」是【引用來的前提,本輪未驗】**
--    (codex 2026-08-17 兩輪點名)。缺的那一道 = 正式庫查 `pg_roles.rolbypassrls` 與角色關係。
--    🔴 **若那個前提不成立,零 policy 的 RLS 會把 `service_role` 自己也擋在外面** ——
--       症狀是寫入端與健康端點讀不到,而 migration 全綠。**這一格由 E 窗在正式庫驗。**
-- ⚠️ **RLS 不是上面那幾行 REVOKE 的替代品** —— 🔴 **`TRUNCATE` 不受 RLS 管**,
--    所以「開了 RLS」不能推論「anon 動不了這張表」。兩道各管一件事。
ALTER TABLE public.sweeper_heartbeat ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
--  新物件收權 fail-closed 斷言(樣板逐字出自 `~/pcm-mailbox/E-684-新物件收權斷言樣板.md` §2)
--  🔴 **沒有自己手寫一份** —— 那份樣板已被 B 窗打穿過一次並修好(欄級授權那一圈),
--     自己重寫等於把它修好的那個洞重新打開。
-- ═══════════════════════════════════════════════════════════════════════════
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.sweeper_heartbeat'
  ]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- ══ 5. 本片自己的兩條斷言(上面那支樣板不管這兩件)═══════════════════════════════
DO $hb_guard$
BEGIN
  -- ① RLS 開著(樣板不查 RLS —— 它查的是 ACL)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sweeper_heartbeat'::regclass) THEN
    RAISE EXCEPTION 'HB:RLS 未啟用';
  END IF;

  -- ② **這張表的 ACL 被動過**(射程就這麼寬,標題以前寫「REVOKE 真的執行過」是寫大了)
  --    🔴🔴 **它證得出來的,只有「`relacl` 不是預設值」這一件事。**
  --    **不證**「那三行 REVOKE 都跑了」——**任何**一個 ACL 操作都能把 `relacl` 具體化。
  --    **不證**「表是安全的」—— 安全由上面那支樣板負責(它查 anon 現在有沒有權限)。
  --    **不證**「表不安全」—— `relacl IS NULL` 在 `E683-1` 已 apply 的世界其實是安全的。
  --    ⇒ **它是流程代理值,不是安全事實。**(codex 2026-08-17 兩輪連續點名,第二輪判前一版仍寫大。)
  --    ⇒ 留著它的理由只有一個:**E 窗的硬要求「REVOKE 不論兩支誰先 apply 都不能省」**
  --      需要一個機械訊號,而這是最便宜的那個。**它不是安全斷言,不要拿它當安全斷言引用。**
  IF (SELECT relacl FROM pg_class WHERE oid = 'public.sweeper_heartbeat'::regclass) IS NULL THEN
    RAISE EXCEPTION 'HB:relacl 為 NULL ⇒ 本表的 ACL 從未被動過。'
      '(NULL = 沿用預設值。它安不安全取決於 E683-1 apply 了沒 —— '
      '而本要求是「不論兩支誰先 apply,REVOKE 都不能省」,見 §4。)';
  END IF;
END
$hb_guard$;

-- ══ 6. 🔴 負向對照怎麼餵(這一段是驗收的重點,不是附錄)═══════════════════════════
--
-- **規則:該綠的餵一發必須綠,該紅的餵一發必須紅。兩發都表演得出來,才輪到看斷言。**
-- 🔴 每一發都在**拋棄式叢集或交易內**做,做完 `ROLLBACK`。**不要在正式庫留痕。**
-- 🔴 **若「該紅的那一發」沒有紅 ⇒ 停下來回報 E 窗,不要繼續。**
--
-- ── 2026-08-17 B 窗本機實跑紀錄(拋棄式 PG 17.10,port 55511;逐發都 ROLLBACK)──
--   🔴 **本機預設【沒有】那組 anon 權限 ⇒ 必須先把病構造出來,否則負向對照是假的。**
--      構造式:`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;`
--      構造後驗:新表出生即帶 `anon=INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN`
--   該紅①(沒跑 REVOKE)  ⇒ 🔴 紅,印出 `HB:anon/authenticated 仍持有本表權限(… anon=TRUNCATE …)`
--                            (那一版斷言後來換成 E-684 樣板,樣板的訊息是
--                             `❌ 新物件收權斷言失敗:… 仍持有 N 項權限`)
--   該紅②(沒開 RLS)     ⇒ 🔴 紅,印出 `HB:RLS 未啟用`
--   該綠 (本檔全文)      ⇒ ✅ 走到底、零 RAISE
--   零留痕               ⇒ `to_regclass('public.sweeper_heartbeat')` ⇒ 不存在
--
--   🔴 **`MAINTAIN` 那條的專屬對照(codex `must-fix` 折完後補跑,2026-08-17)**:
--     同一張新表、同一個 anon,兩種數法並排:
--       推導版(`acldefault` 推出來)  ⇒ **8**
--       手寫七項版(E-684 樣板原文)   ⇒ **7**
--     ⇒ **差的那一項就是 `MAINTAIN`** —— 樣板掃不到本檔自己舉的那個例子。
--     ⇒ 這一發是**兩個實作並排印不同的數**,不是「我改完覺得比較好」。
--
--   §5-② 那條**單獨做過雙向對照**(它是 B 窗自己加的,不在 E 窗規格內):
--     世界 A:有跑過 ACL 操作 ⇒ `relacl` 非 NULL ⇒ ✅ 綠
--     世界 B:完全沒動過 ACL ⇒ `relacl` NULL   ⇒ 🔴 紅
--     ⇒ **兩個世界印不同的東西 ⇒ 有判別力,不是恆綠格。**
--     🔴 **而它證得出來的只有「這張表的 ACL 被動過」**(codex `must-fix`)——
--        **不證「三行 REVOKE 都跑了」**(任何一個 ACL 操作都能讓 relacl 非 NULL),
--        **也不證「anon 不可達」**(那是上面那支樣板的事)。**射程就到這裡,不要外推。**
--
--   ⚠️ **本機效度限制(不要當成 Supabase 上也驗過;codex 2026-08-17 逐條點名)**:
--     · 本機的預設 ACL 是**手動構造**的,不是 Supabase 平台給的
--     · `service_role` 是本機 `CREATE ROLE` 造的 ⇒ 🔴 **「`service_role` 走 BYPASSRLS」這句
--       完全沒有被本機對照支撐**,它是**引用來的前提,不是本輪量到的**。
--       缺的那一道 = 正式庫查 `pg_roles.rolbypassrls` 與角色關係。
--     · 🔴 **沒跑過的四種負向對照**(⇒ 「anon 權限 0」**不能**外推成「完整不可達」):
--         `PUBLIC`-only 授權 / `MAINTAIN`-only 授權 / `SET ROLE` 繞路 / 陌生第三 grantee
--     · **未在任何真實 DB apply**;Supabase 端等 Sean 在場
--
--   🔴 **本檔沒有顯式 `GRANT` 給 `service_role`**(codex `must-fix`,**B 窗刻意不自行補**):
--     現在靠的是平台的預設授權。**ADP 若漂移,這支 migration 仍然全綠,而寫入端與健康端點會失效。**
--     ⇒ 要不要加一行顯式 `GRANT SELECT, INSERT, UPDATE ON … TO service_role` + 對應斷言,
--       **是授權面的設計決定,不是施工細節** ⇒ **已列為問題送回 E 窗(規格作者兼驗收方)。**
--
-- ══ 7. 本片【不涵蓋】(誠實標明監控鏈的最後一環)═════════════════════════════════
--   · 寫入端（`settle-sweep` route 的 upsert）與公開健康端點 ⇒ **另一片,本檔只建表**
--   · `anomaly-alert` 自己死掉的偵測（同形狀、同修法，不在本片）
--   · 層二根治:告警與被監控者共用 migration / wrapper / vault secret —— 本片**繞過**它
--   · 外部巡邏本身死掉的偵測 ⇒ 🔴 **監控鏈總有最後一環沒人監控**,這裡它是 Sean 的雲端 routine
--     ⚠️ 「巡邏跑在雲端、與被監控者零共用基礎設施」= **主視窗轉述,E 窗未親讀該 routine ⇒ 未確認。**
--        若成立則層二也一併解掉;**若不成立,層一仍由本片解掉。** 不要寫成已確認。
--
-- ══ 8. Rollback ══════════════════════════════════════════════════════════════
--   DROP TABLE IF EXISTS public.sweeper_heartbeat;
--   ⚠️ 這張表零業務資料(只有 job 名與時間戳)⇒ drop 不會失去任何客戶/金額資料。
--   🔴 但 drop 之後**偵測缺口就回來了**,而它的症狀是「什麼都沒發生」。

COMMIT;
