-- ============================================================
-- M-4a 寄信死人開關:告警用的計數 RPC(片 1「查得到」)
-- 回**五個訊號計數 + 一個分母**,共六個數字(前一版標題寫「四個計數」= 錯,codex nit)。
--
-- 🔴 **這一片【只讓數字讀得到】,不改任何對外行為** —— 沒有人會因為它收到或收不到通知。
--    把兩個 count 接進 shouldAlert 是【另一片】(片 3),而那一片命中鐵則 12 ⑤。
--
-- 🔴 **為什麼需要一支 RPC,而不是直接查表**(2026-08-29 線D,codex R1 抓到):
--    `email_outbox` 的 SELECT **只授權 service_role**(`20260717020000` 的 GRANT),
--    而告警那條路跑在 `payment_confirmer`(對這張表**零表權**)
--    ⇒ 直接查表 ⇒ `42501 permission denied`。
--    ⇒ 唯一的路 = **owner-defined SECDEF 受控窗**,照 `20260701120000` 的範式。
--    ⚠️ **而「抄了先例」不等於「權限就對了」**(codex 逐字:「這證明 SECDEF 能解,
--       但不是【加一支 RPC】自然就解」)⇒ 本檔第 3 段當場斷言有效權限,不假設。
--
-- 🔴 **它回四個訊號,而訊號 4 刻意【不在】這裡**:
--    訊號 4 =「訂單已 paid 而 outbox 列**根本沒建**」⇒ 它的失敗形狀是**資料不存在**,
--    而**本函式所有的 count 都只數存在的東西** ⇒ 它要拿 `orders` 當分母(anti-join)= 另一片。
--    📌 **一個只數存在的東西的量具,對「東西沒被建出來」永遠印 0,而那個 0 看起來像正常。**
--
-- 權威訊號表 = `20260717020000_m4a_email_outbox.sql` 頭註 §⑦ §⑨ §⑩。
-- 決策與被打掉的兩版 plan = `~/pcm-mailbox/線D-決策題-告警片要拆-20260829.md`
--   (R1 18 條 / R2 判定「已解 6、僅承認未解 8、解錯方向 4」的原文也在那裡)。
--
-- @see supabase/migrations/20260701120000_m3_250_anomaly_alert_summary.sql(ACL/assert 範式)
-- @see supabase/migrations/20260717020000_m4a_email_outbox.sql(訊號表權威)
-- ============================================================


-- ── 1. SECDEF 聚合 RPC(唯讀、只回計數;零 PII、零 id、零信箱)──
--
-- 參數(**刻意吃參數,不寫死**;codex R2:lease 真值住在 `email-sweep/route.ts` 的
--   `LEASE_SECONDS`,本檔若自己抄一份 3600 ⇒ 兩邊日後漂移 ⇒ 誤報或漏報而**沒有訊號**):
--   p_stale_sending_seconds  — 訊號 3 的 lease(NULL → 3600;clamp [60, 30d])
--   p_signal1_grace_seconds  — 訊號 1 的寬限(NULL → 3600;clamp [60, 30d])
--   🔴 **呼叫端必須從 sweeper 那一側的真值餵進來,不得自己取值。**
--   ⚠️ **而「參數沒給時不要炸」是假的**(codex 2026-08-29):本簽章**沒有 `DEFAULT`**
--      ⇒ **省略參數不是傳 NULL,是【找不到相符的函式簽章】** ⇒ 直接錯誤。
--      `COALESCE` 只在**明確傳 NULL** 時生效。**兩件事,不要混。**
--   🔴 而 `p_signal1_grace_seconds` **在 sweeper 那側【沒有對應的真值】**(codex 抓到):
--      lease 有(`MIN_LEASE_SECONDS`),grace **沒有** ⇒ **片 3 接線時仍要另外造一個來源**,
--      而那是個**未決的營運參數**,不是可以順手填的東西。**不要假設它已經存在。**
-- 🔴 **裸 `CREATE`,不是 `CREATE OR REPLACE`**(codex R1+R2 換來的,而中間繞了一圈):
--    `CREATE OR REPLACE` 撞到既有同簽章時**不會叫**,還會**沿用既有的 owner 與 ACL**
--    ⇒ 一支別人建的同名函式會被安靜換掉本體、而權限用它的。
--    ⚠️ **而我第一版的修法是「先用 `DO` 查它在不在,在就 RAISE」—— 那個修法是錯的**:
--       查存在與建立是**兩個 statement**,並發者可以在中間建進來 ⇒ **競態窗還在**,
--       而它看起來已經被擋住了。⇒ 已刪掉那段 `DO`,改用裸 `CREATE` 讓 PG **原子地**撞名。
--    📌 **一個把檢查與動作分成兩步的防護,擋住的是【慢的那種撞】,不是【並發那種】** ——
--       而它讀起來與真的擋住了一樣。
--    ⇒ 本 migration **刻意非冪等**:已套用的不該靠重跑覆寫
--      (`docs/patterns/revoking-function-execute-in-supabase.md` 的新物件規則)。
CREATE FUNCTION public.get_email_outbox_deadman_counts(
  p_stale_sending_seconds integer,
  p_signal1_grace_seconds integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 訊號 1:該重試而沒有人重試(§⑨ 修正述詞:非單看列齡,而是「已到 next_retry_at 且逾寬限」)。
    -- ⚠️ **這裡曾經有一個 `last_error_code NOT IN (...)`,而它有兩個問題,兩個都已拿掉**:
    --    ① NULL 不安全:`last_error_code` **可以是 NULL**(`20260717020000` 的 CHECK 逐字
    --       `last_error_code IS NULL OR ...`)⇒ `NULL NOT IN (...)` = **UNKNOWN** ⇒ 那一列被漏掉,
    --       而被漏掉的正是【一般 pending、還沒有錯誤碼】的逾期列 = 訊號 1 的主力。
    --    ② 而更根本的是:**那個排除本身就是多餘的**(見下面那段)。
    --    📌 **留這幾行,是因為「這裡沒有條件」與「這裡的條件被拿掉了」在程式上長得一樣** ——
    --       而下一個人很可能會想把它加回來。
    'signal1_overdue_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox
        WHERE status IN ('pending', 'failed')
          AND attempts < max_attempts
          AND next_retry_at <= pg_catalog.now()
                -- ⚠️ 用 `* INTERVAL '1 second'` 而不是 `make_interval(secs => ...)`:
                --    具名參數那個寫法在【本函式被 PL/pgSQL 的 DO 區塊呼叫】時會被解析成型別修飾詞
                --    ⇒ `ERROR: type modifier cannot have parameter name`(2026-08-29 實跑撞到)。
                --    📌 而它在**直接 SELECT** 時完全正常 ⇒ **同一段 SQL 在兩種呼叫路徑下不一樣。**
                -- 🔴 下限 **300** 不是 60(codex R2 新抓到):sweeper 的排程是 `*/5`
                --    (`20260819160000_m4a_e2b_email_sweep_pgcron.sql`)= **每 5 分鐘一輪**
                --    ⇒ 一列剛到 `next_retry_at`、正**合法等下一輪**,寬限 60 秒會把它算成逾期
                --    ⇒ **誤報「排程死」**。clamp 的下限至少要一個排程週期。
                -- ⚠️ **而 300 只是【下限】,不是「夠用」** —— codex 逐字:即使固定 3600,
                --    也只是在目前每日 10-30 封、每輪 50 的量級下**看起來**充足,
                --    **本檔沒有證明 backlog 不會超過一小時的吞吐量**。
                --    ⇒ **呼叫端要餵一個有根據的值,而那個根據不在這支檔裡。**
                - (LEAST(GREATEST(COALESCE(p_signal1_grace_seconds, 3600), 300), 2592000)
                   * INTERVAL '1 second')
          -- 🔴🔴 **這裡【沒有】排除任何錯誤碼 —— 而前一版有,那是錯的**(codex 2026-08-29 抓到)。
          --    §⑨ 的訊號 1 修正逐字是:
          --      「修正述詞 = **已到 `next_retry_at` 且逾寬限仍未處理**(非單看列齡);
          --        **或等價地**:訊號 1 排除 `last_error_code IN (額度兩碼)` 的列。」
          --    🔴 **「或等價地」= 兩案擇一,不是兩個都做。** 而前一版**兩個都做了** ⇒ 過度抑制。
          --    ⇒ 本函式採**前案**(時間述詞):額度列在合法睡的那 24h 內,
          --      `next_retry_at` 在未來 ⇒ **時間述詞自己就擋掉了**,不需要再看碼。
          -- 🔴 **而「兩個都做」的具體損害,不是多餘而已**:
          --    額度列睡滿 24h **到期之後仍然沒有人處理** ⇒ 那是**真的**排程死
          --    ⇒ 而碼式排除會讓它**永遠不進訊號 1** ⇒ **漏報,而且是無聲的。**
          --    📌 **一個為了防誤報而加的條件,在它的前提被另一個修法解決之後,就只剩下漏報。**
          -- ⚠️ **連帶作廢**:前一版因此還多排除了 `http_429`(理由:它也吃 quota_24h 退避)
          --    ⇒ 那個理由是對的**而它服務的那個排除本身是多餘的** ⇒ 一起拿掉。
          --    ⇒ 而那也讓「SQL 那份清單 vs TS 推導」的跨語言漂移風險**整個消失** ——
          --      **不是把守門做得更好,是把需要守的東西拿掉了。**
          ),

    -- 訊號 2:死信(耗盡 attempts)。§⑦ 逐字:終態界線在 attempts >= max_attempts,不在 status。
    'signal2_dead_letter_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox
        WHERE status IN ('pending', 'failed')
          AND attempts >= max_attempts),

    -- 訊號 3:認領後程序死 ⇒ 永久卡 sending。§⑦ 逐字:前兩個訊號都不命中 = 靜默死亡。
    'signal3_stuck_sending_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox
        WHERE status = 'sending'
          AND claimed_at < pg_catalog.now()
                - (
                    -- 🔴 下限 3600 不是 60(codex 2026-08-29):`sweep-email-outbox.ts` 的
                    --    `MIN_LEASE_SECONDS = 3600` 是 sweeper 的**硬下限**
                    --    ⇒ 餵一個比它小的值,會把【仍在合法執行中】的工作報成卡死。
                    --    📌 clamp 的下限要對齊【被觀察那一側的真實下限】,不是一個看起來安全的小數字。
                    LEAST(GREATEST(COALESCE(p_stale_sending_seconds, 3600), 3600), 2592000)
                    * INTERVAL '1 second')),

    -- 訊號 5-a:**確診**額度耗盡(§⑨ 的兩碼字面)。
    'signal5_quota_confirmed_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox
        WHERE status = 'failed'
          -- 🔴 `attempts < max_attempts` 不可省(codex 2026-08-29):§⑨ 逐字宣告
          --    「與訊號 2(dead letter)**不重疊**:訊號 2 抓『已耗盡 attempts』,
          --      訊號 5 抓『**尚未**耗盡但正在撞額度』= 早期徵兆」。
          --    ⇒ 少了它,`failed@max` 會**同時**被訊號 2 與訊號 5 數到 ⇒ 那個宣告變成假的。
          AND attempts < max_attempts
          AND last_error_code IN ('quota_daily_exceeded', 'quota_monthly_exceeded')),

    -- 訊號 5-b:**疑似**額度(`http_429`)。
    -- 🔴 **為什麼分開數,而不是併進 5-a**(codex R2;線D 據此收回自己前一版的決定):
    --    `http_429` **可能只是瞬時限流**,不一定是額度耗盡
    --    ⇒ 併進去 = 用「額度用盡、請升級」的文案報一個**未知原因** = **把未知報成確診**。
    --    📌 **一個報錯原因的告警,會把人送去修錯的東西 —— 那比不叫更糟。**
    -- ⚠️ 而它**仍然要被數**:`IEmailOutbox.ts` 的 `http_429` JSDoc 逐字
    --    「若實際不含 `name` → **所有 429 都落本格**」⇒ 額度爆掉**很可能**長這樣。
    --    ⇒ 漏報的代價 = 信永久消失而沒有人知道;誤報的代價 = 多說一句「可能」。
    'signal5_quota_suspected_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox
        WHERE status = 'failed'
          AND attempts < max_attempts   -- 同 5-a:與訊號 2 不重疊(§⑨ 明文)
          AND last_error_code = 'http_429'),

    -- 🔴 **分母**。沒有它,上面五個 0 在「一切正常」與「這張表是空的」之間**分不出來**。
    'total_count',
      (SELECT pg_catalog.count(*) FROM public.email_outbox)
  );
$fn$;

COMMENT ON FUNCTION public.get_email_outbox_deadman_counts(integer, integer) IS
  'M-4a 寄信死人開關告警計數(片 1):owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零信箱/零 id)。回 jsonb{signal1_overdue_count, signal2_dead_letter_count, signal3_stuck_sending_count, signal5_quota_confirmed_count, signal5_quota_suspected_count, total_count}。訊號 4(列根本沒建)不在本函式:它要 orders 當分母、是另一片。5-a 確診 / 5-b 疑似刻意分開:http_429 可能只是瞬時限流,併進確診會把未知報成確診。兩個秒數參數必須明確傳(本簽章無 DEFAULT,省略 = 找不到相符簽章);傳 NULL 才走預設,而預設不是權威。⚠️ lease 在 sweeper 那側有真值(MIN_LEASE_SECONDS),而 signal1 的 grace **沒有** —— 呼叫端要另造來源,那是未決的營運參數。不動 email_outbox 的 grant。ACL 斷言**只點名 anon/authenticated/service_role/payment_confirmer 四個角色** ⇒ 額外角色拿到 EXECUTE、或 NOINHERIT 角色經 SET ROLE 呼叫,**本斷言不會叫**(要無條件版本得掃 proacl,那是另一片)。';


-- ── 1b. 釘 owner + 驗「它真的讀得到那張表」──
-- 🔴 **SECDEF 跑的是 owner 的權限,而前一版【沒有釘 owner、也沒驗它讀不讀得到】**
--    (codex 2026-08-29)⇒ owner 若不是表 owner 又沒有 BYPASSRLS,
--    **六個數字會【靜默全零】** —— 而全零看起來就像「一切正常」。
--    📌 **一個讀不到資料的計數器,與一個一切正常的系統,印同一組 0。**
ALTER FUNCTION public.get_email_outbox_deadman_counts(integer, integer) OWNER TO postgres;

DO $$
DECLARE v jsonb; v_fn oid; v_tbl oid; v_forced boolean;
BEGIN
  v := public.get_email_outbox_deadman_counts(3600, 3600);
  IF v IS NULL OR NOT (v ? 'total_count') THEN
    RAISE EXCEPTION 'M-4a get_email_outbox_deadman_counts 自檢失敗 — 回傳形狀不對;拒繼續';
  END IF;

  -- 🔴🔴 **形狀對【不代表看得到資料】—— 這一段是 2026-08-29 實測逼出來的。**
  --    `email_outbox` 是 **ENABLE ROW LEVEL SECURITY** 的(`20260717020000` 逐字)。
  --    拋棄式 PG 實測:把 owner 換成一個**有 SELECT 權但不是表 owner** 的角色
  --    ⇒ **六個數字全部回 0、rc=0、零錯誤訊息。**
  --    📌 **一個讀不到資料的計數器,與一個一切正常的系統,印同一組 0。**
  --    ⚠️ 而**上面那個形狀自檢完全通過** —— 它問的是「有沒有 total_count 這個鍵」,
  --       而那個鍵在兩個世界裡都在。**它不是壞了,是它問的不是這件事。**
  --    ⇒ 所以要問一個**兩個世界會不同**的問題:**函式 owner 是不是表 owner。**
  --      (表 owner 預設豁免 RLS;`FORCE ROW LEVEL SECURITY` 會連 owner 一起管 ⇒ 一併擋。)
  SELECT p.proowner INTO v_fn FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_email_outbox_deadman_counts(integer,integer)'::regprocedure;
  SELECT c.relowner, c.relforcerowsecurity INTO v_tbl, v_forced FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.email_outbox'::regclass;
  IF v_fn IS DISTINCT FROM v_tbl THEN
    RAISE EXCEPTION 'M-4a 函式 owner(%) 不是 email_outbox 的 owner(%) — RLS 會讓六個數字【靜默全零】;拒繼續',
      v_fn::regrole, v_tbl::regrole;
  END IF;
  IF v_forced THEN
    RAISE EXCEPTION 'M-4a email_outbox 設了 FORCE ROW LEVEL SECURITY — owner 也會被 RLS 過濾 ⇒ 靜默全零;拒繼續';
  END IF;

  -- ⚠️ **這幾發證明「讀得到、形狀對、不會被 RLS 靜默清空」,【不證明數字對】** ——
  --    數字對不對由拋棄式 PG 的實跑守(2026-08-29 已跑:12 列、六個數字逐格對過,
  --    含「額度列睡飽了還沒人處理 ⇒ 訊號 1 該算」與「failed@max ⇒ 訊號 5 不該算」兩格)。
  --    **兩件事不要混。**
END
$$;


-- 🔴 **本段之上的兩處 COMMENT 曾經比正文樂觀,那不是筆誤,是一種形狀**(codex R2 抓到兩次):
--    正文的行內註解**老老實實寫了射程**(assert 只點四角色 / grace 沒有 sweeper 真值),
--    而 `COMMENT ON FUNCTION` 仍寫著「只 payment_confirmer 可呼」「兩參數由 sweeper 真值餵入」。
--    📌 **`COMMENT` 是 `\df+` 與工具會印出來的那一份 —— 它比行內註解【更常被讀到】,
--       而它是我寫得最不小心的那一份。**
--    ⇒ 已同步。**改正文的射程時,一定要回頭改 COMMENT。**
--
-- ── 2. ACL(REVOKE 5 角色含 payment_confirmer 再精準 GRANT;對齊 20260701120000 範式)──
-- 🔴 新物件**出生就自帶 anon 權限**,而 repo 內零 `GRANT` 字面可掃、三綠不紅
--    ⇒ 兩道 REVOKE 是物理擋,不是慣例(見 docs/patterns/revoking-function-execute-in-supabase.md)。
REVOKE ALL ON FUNCTION public.get_email_outbox_deadman_counts(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_email_outbox_deadman_counts(integer, integer)
  TO payment_confirmer;


-- ── 3. fail-closed assert:收權斷言(**清單驅動 + proacl 掃描**)──
--
-- 🔴 **這一段換過形狀,而換的理由有兩個,都不是我先想到的**:
--    ① `scripts/migration-static-checks.sh` 第 ③ 道守門要求「可授權物件數 = 斷言清單長度」,
--       而它認的是 `v_functions text[] := ARRAY[...]::text[]` 那個**宣告式清單**。
--       我第一版手寫 `has_function_privilege(...)` ⇒ 守門數到 **1 個物件 vs 0 個清單** ⇒ 擋下。
--       📌 **那道守門防的不是「忘記收權」,是「忘記把物件列進清單」** ——
--          它自己的訊息逐字寫著這句,而我原本沒有讀懂它在數什麼。
--    ② 而抄過來之後**順便關掉了 codex R2 的第 6 條**:我原本只點名四個角色,
--       ⇒ 「日後有人建 `ops_reader` 並授權」那一格**不會叫**,我當時只把它寫成射程。
--       這個範式多一段 **`proacl` 掃描** ⇒ **無條件列出所有 grantee,不在白名單就炸**
--       ⇒ **從「點名清單」升級成「無條件對照」。**
--    📌 **⇒ 我把一個【明寫的射程】換成了【沒有那個射程】** ——
--       而做得到這件事,是因為別人已經寫過那個形狀,不是因為我更小心。
DO $newobj_guard$
DECLARE
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.get_email_outbox_deadman_counts(integer,integer)'
  ]::text[];
  v_fn    oid;
  r       text;
  v_extra text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'M-4a 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('public', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M-4a 收權斷言失敗:% 對 PUBLIC/anon/authenticated/service_role 還開著 EXECUTE(REVOKE 少了一個角色?或 proacl 是 NULL = 套用預設)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M-4a 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE ⇒ 告警讀不到寄信計數', r;
    END IF;
  END LOOP;

  -- 🔴 **無條件掃 `proacl`** —— 這一段才是「只有 payment_confirmer」那句話的實體。
  --    上面的 `has_function_privilege` 只問**我點名的那幾個**;這一段問**還有誰**。
  SELECT pg_catalog.string_agg(g.grantee, ', ')
    INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
        FROM pg_catalog.pg_proc p
        -- 🔴🔴 **鎖 `oid`,不比字串** —— 而這一行是實測換來的,不是品味。
        --    我抄的那支範式用的是
        --      `AND pg_get_function_identity_arguments(p.oid) = ''`
        --    那對**零參數**的函式是對的;而本函式有兩個參數,
        --    `pg_get_function_identity_arguments` 實際回的是
        --      `p_stale_sending_seconds integer, p_signal1_grace_seconds integer`
        --    ⇒ **它含參數【名】** ⇒ 我照抄成 `'integer, integer'` ⇒ **永遠不匹配**
        --    ⇒ **整段 proacl 掃描恆綠**:2026-08-29 實測授權給一個 `ops_reader`,
        --      而 `proacl` 裡明明有它,這道斷言 **rc=0、一聲不吭**。
        --    📌 **範式的【形狀】可以抄,它的【常數】不行** ——
        --       而那個常數在原處是對的,所以它不會看起來可疑。
        --    ⇒ 改用 `to_regprocedure` 比 oid:精確、與參數命名和格式無關。
        WHERE p.oid = pg_catalog.to_regprocedure('public.get_email_outbox_deadman_counts(integer,integer)')
    ) g
   -- 🔴 `CURRENT_USER` 是關鍵字不是函式,不可寫成 `pg_catalog.current_user`(會被當成欄名)。
   --    排除它:owner 自己的 EXECUTE 是 CREATE FUNCTION 天生給的,不是額外授權。
   WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'M-4a 寄信死人開關計數:EXECUTE 授權清單多出非預期角色(%) — 只應有 payment_confirmer;拒繼續', v_extra;
  END IF;
END
$newobj_guard$;
