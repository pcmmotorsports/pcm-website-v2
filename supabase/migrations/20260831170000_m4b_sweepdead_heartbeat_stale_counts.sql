-- 20260831170000_m4b_sweepdead_heartbeat_stale_counts.sql
-- 板 ⟦b4-SWEEPDEAD1⟧ 片2/4 · 線【出貨】-1e · 2026-08-31
--
-- 🔴🔴 **先讀這三句, 讀錯會做壞事**
--   ① **這支函式【不知道任何門檻】** —— 門檻由呼叫端用 `p_jobs` 傳進來。
--      那是刻意的:門檻的唯一來源是 `packages/domain/src/ops/cron-jobs.ts`,
--      而**在這裡再寫一份 ⇒ 兩份會漂, 而漂開時兩邊都不會紅**
--      (儀表板說正常、告警器說異常, 而沒有任何測試同時看得到兩邊)。
--      主視窗 `-24` 2026-08-31 裁 `Q1=甲` / `Q2=甲`(判準與儀表板逐格相同)。
--   ② **判準要與儀表板【逐格相同】** —— 儀表板那一側是
--      `abnormal = stale || future || failing`(`cron-heartbeat-read.ts`),
--      而本函式逐條照抄那個形狀。**改這裡不改那裡 = 兩個畫面對同一支排程說不同的話。**
--   ③ 🛑 **它回的是【計數與名單】, 不回「要不要叫」** —— 那個判斷在告警器,
--      因為「叫不叫」還要看別的訊號與 env, 而那些這裡看不到。
--
-- 🔴 **為什麼要一支函式, 而不是直接讀表**(2026-08-31 對正式庫唯讀量的):
--   告警器走 `payment_confirmer`(`PAYMENT_CONFIRMER_DB_URL`), 而
--     · 它直接有 SELECT 的【表】 ⇒ **0**
--     · 它有 EXECUTE 的【函式】 ⇒ **30**
--     · 它繼承任何角色嗎 ⇒ **沒有**
--     · 🟢 正對照 `service_role` 直接有 SELECT 的表 ⇒ **65**(尺會動)
--     · 🟢 負對照 現造角色 ⇒ **0**(尺不亂報)
--   ⇒ **它是【只能呼叫函式】的角色, 這是設計不是漏。**
--   ⇒ 📌 **所以【任何】新資料要進告警器, 都必然是一支新函式 + 一次 GRANT。**
--
-- 🔴🔴 **具名缺口之二(codex R3 must-fix#3;我判定【這一側修不了】)**:
--   **本函式證明不了「呼叫端餵的是完整的六支」。** 一個合法但少一支的陣列會完整通過,
--   而**被漏掉的那支死亡排程完全隱形** —— `checked` 只證明「收到幾條就跑幾條」。
--   🛑 **而這是設計換來的**:門檻與名單的唯一來源刻意在 TS(否則兩份會漂),
--      ⇒ **DB 這一側【沒有】可以拿來對帳的權威名單**, 它照定義不知道應該有幾支。
--   ⇒ 📌 **所以那道保護必須長在呼叫端**:片3 要有一格測試釘住
--      「adapter 傳進去的就是 `CRON_JOB_WHITELIST` 全部, 沒有被過濾過」。
--   ⚠️ **在那格測試寫出來之前, 這個缺口是開著的。**寫在這裡, 不要讓它只活在 plan 裡。
--
-- 🔵 **回傳形狀的用法約束(codex R3 consider)**:`stale` / `future` / `failing` /
--   `never_beat` / `no_success_ts` **不是互斥集合** —— 同一支 job 可以同時出現在兩個裡。
--   ⇒ **要數「幾支不正常」只能讀 `abnormal_count`**, 把各陣列長度相加會重複計數。
--
-- 🔴🔴 **一個【具名的、沒有修掉的】缺口(codex R1 F4;我判定為【記下來】不是【修掉】)**:
--   本檔的 DO 斷言**驗不到「`>` 有沒有被改成 `>=`」** —— 要驗它需要 `minutes_ago` **恰好等於**門檻,
--   而本函式用 `clock_timestamp()`(牆上時鐘, F1 要求的)⇒ **在 SQL 這一側構造不出「恰好相等」。**
--   🔵 **而那一格在 TS 那一側被釘住了**:`cron-heartbeat-read.test.ts:180` 逐字測
--      「剛好等於門檻 ⇒ 不得亮」—— 改成 `>=` 那一格會紅。
--   🛑 **所以正確的字面是「這一側驗不到, 而另一側驗得到」, 不是「已經驗過了」。**
--      `future` / `failing` 亦然:世界測涵蓋它們的**兩側**, 不涵蓋**邊界值本身**。
--   📌 **⇒ 下一個人若把判準從 TS 搬回 SQL, 這道保護就沒了, 而它不會紅。**
--
-- ⚠️ **儀表板有一格本函式【故意沒有】**:`consecutiveFailuresUnreadable`。
--   那一格防的是「JS 拿到的值不是數字(欄位型別漂了)」——
--   而在 SQL 這一側 `consecutive_failures` 是 `integer NOT NULL`, **那個世界不存在**。
--   🛑 **這不是判準不一致, 是同一個判準在兩個型別系統下的形狀不同。**
--      (寫在這裡, 免得下一個人比對兩側時把它當成漂移。)

-- 🔴 **裸 `CREATE`, 不是 `CREATE OR REPLACE`**(migration 靜態守門 ①):這是新物件,
--    撞名要當場紅。`OR REPLACE` 會把撞名【靜靜蓋掉】, 而 REVOKE 與斷言照樣綠
--    ⇒ 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
--    🔵 而它同時解掉 codex R3 那條「`OR REPLACE` 保留舊 ACL」—— 裸 CREATE 沒有舊 ACL 可繼承。
CREATE FUNCTION public.get_cron_heartbeat_stale_counts(p_jobs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
-- 🔴 **VOLATILE 不是 STABLE**(codex R2 must-fix):`STABLE` 向 planner 承諾
--    「同一個 statement 內同樣輸入回同樣結果」, 而本函式用 `clock_timestamp()`(牆上時鐘)
--    ⇒ 那個承諾是假的, 而 planner 可以據此快取/摺疊呼叫。
--    📌 **F1 把 `now()` 換成 `clock_timestamp()` 修好了「時間不準」, 卻讓這個標記變成謊話** ——
--       一個修法在別的地方開了洞, 而兩處都看起來正常。
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 **`clock_timestamp()` 不是 `now()`**(codex R1 F1 must-fix):`now()` 是【交易起點】,
  --    交易 12:00 開始、12:10 才呼叫 ⇒ 心跳實際 189 分前、門檻 180, 而它用 12:00 去減 ⇒ 回「正常」,
  --    **而儀表板那一側用的是真實時間 ⇒ 同一支排程兩個畫面說相反的話。**
  --    ⇒ 量「多久沒成功」要用**牆上時鐘**, 不是交易時鐘。
  v_now       timestamptz := pg_catalog.clock_timestamp();
  v_result    jsonb;
  v_checked   integer;
BEGIN
  -- 🔴🔴 **fail-closed 三道, 而三道各擋一種【會靜默回 0】的輸入**
  --    回 0 = 「沒有排程過期」= 不告警 ⇒ **壞掉的輸入與健康的世界印同一個東西**。
  IF p_jobs IS NULL THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 不得為 NULL(NULL ⇒ 展開 0 列 ⇒ 恆回 0 = 靜默不告警)';
  END IF;
  IF pg_catalog.jsonb_typeof(p_jobs) <> 'array' THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 必須是 JSON 陣列(收到 %)', pg_catalog.jsonb_typeof(p_jobs);
  END IF;
  IF pg_catalog.jsonb_array_length(p_jobs) = 0 THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 是空陣列 ⇒ 沒有任何排程被檢查 ⇒ 恆回 0 = 靜默不告警';
  END IF;

  WITH want AS (
    SELECT
      j.job_name,
      j.stale_minutes,
      -- 🔴 **這一鍵【必填】, 不預設**(codex R1 F3 must-fix)。
      --    ⛔ ~~原本缺鍵預設 true, 理由寫「保守方向是多叫不是少叫」~~
      --    而那句話對, 結論卻錯:B 對 `pcm-expire-unpaid-orders` 判「失敗計數無意義」,
      --    ⇒ 缺鍵預設 true ⇒ **A 說異常而 B 說正常** ⇒ 那正是 Q2「逐格相同」要消滅的世界。
      --    📌 **一個「安全方向」的預設, 在【要求兩側一致】的需求下是一個不一致。**
      j.failures_meaningful
    FROM pg_catalog.jsonb_to_recordset(p_jobs)
      AS j(job_name text, stale_minutes numeric, failures_meaningful boolean)
  ),
  -- 🔴 每一列都先算出【它為什麼不正常】, 而不是只算一個布林 ——
  --    告警信裡要寫得出「哪一支、為什麼」, 而一個 count 寫不出來。
  judged AS (
    SELECT
      w.job_name,
      h.job_name IS NULL                                   AS never_beat,
      h.last_success_at IS NULL                            AS no_success_ts,
      -- 🔵 用 `date_part` 不用 `EXTRACT(… FROM …)`:後者的關鍵字語法**不吃 schema 限定**
      --    (`pg_catalog.extract(epoch FROM …)` ⇒ syntax error), 而 `search_path=''` 下必須限定。
      --    ⚠️ 這一格是實跑撞出來的, 不是讀出來的 —— 靜態看那一行完全正常。
      CASE WHEN h.last_success_at IS NULL THEN NULL
      -- 🔵 轉 numeric:`date_part` 回 double precision, 而 `round(x, 1)` 只有 numeric 版
      --    (`pg_catalog.round(double precision, integer) does not exist` —— 又一格實跑撞出來的)。
           ELSE (pg_catalog.date_part('epoch', (v_now - h.last_success_at)) / 60.0)::numeric
      END                                                  AS minutes_ago,
      w.stale_minutes,
      w.failures_meaningful,
      h.consecutive_failures
    FROM want w
    LEFT JOIN public.sweeper_heartbeat h ON h.job_name = w.job_name
  ),
  flagged AS (
    SELECT
      job_name,
      never_beat,
      no_success_ts,
      -- 🔴 **嚴格大於**, 與儀表板 `minutesAgo > w.staleMinutes` 逐字相同。
      --    (那一側有一格測試 `:180` 就是釘「剛好等於門檻 ⇒ 不亮」—— 改成 >= 會讓它紅。)
      COALESCE(minutes_ago > stale_minutes, false)         AS stale,
      -- 🔴 未來時間也算不正常(儀表板 `future = minutesAgo < 0`)——
      --    時鐘歪掉或有人寫錯值時, 它與「剛剛才成功」在只看 stale 的尺下【長得一樣】。
      COALESCE(minutes_ago < 0, false)                     AS future,
      COALESCE(failures_meaningful AND consecutive_failures > 0, false) AS failing,
      minutes_ago,
      stale_minutes,
      consecutive_failures
    FROM judged
  )
  SELECT pg_catalog.jsonb_build_object(
    'checked',        (SELECT pg_catalog.count(*) FROM flagged),
    'abnormal_count', (SELECT pg_catalog.count(*) FROM flagged
                       WHERE never_beat OR no_success_ts OR stale OR future OR failing),
    'never_beat',     COALESCE((SELECT pg_catalog.jsonb_agg(job_name ORDER BY job_name)
                                FROM flagged WHERE never_beat), '[]'::jsonb),
    'no_success_ts',  COALESCE((SELECT pg_catalog.jsonb_agg(job_name ORDER BY job_name)
                                FROM flagged WHERE no_success_ts AND NOT never_beat), '[]'::jsonb),
    'stale',          COALESCE((SELECT pg_catalog.jsonb_agg(
                                  pg_catalog.jsonb_build_object(
                                    'job_name', job_name,
                                    'minutes_ago', pg_catalog.round(minutes_ago, 1),
                                    'threshold_minutes', stale_minutes)
                                  ORDER BY job_name)
                                FROM flagged WHERE stale), '[]'::jsonb),
    'future',         COALESCE((SELECT pg_catalog.jsonb_agg(job_name ORDER BY job_name)
                                FROM flagged WHERE future), '[]'::jsonb),
    'failing',        COALESCE((SELECT pg_catalog.jsonb_agg(
                                  pg_catalog.jsonb_build_object(
                                    'job_name', job_name,
                                    'consecutive_failures', consecutive_failures)
                                  ORDER BY job_name)
                                FROM flagged WHERE failing), '[]'::jsonb)
  ) INTO v_result;

  SELECT (v_result ->> 'checked')::integer INTO v_checked;
  -- 🔴 **回頭核一次:餵幾條 vs 檢查幾支**(鐵則 11 那條套在本函式上)。
  --    `jsonb_to_recordset` 對一個形狀不對的元素會安靜地給 NULL 欄位, 而那一列照樣被算進 checked。
  --    ⇒ 這一道只擋【數量對不上】, 擋不了【欄位是 NULL】—— 後者由下面那道擋。
  IF v_checked <> pg_catalog.jsonb_array_length(p_jobs) THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:餵進 % 條而只檢查了 % 支 ⇒ 拒回傳',
      pg_catalog.jsonb_array_length(p_jobs), v_checked;
  END IF;
  -- 🔴 **任何一條的 job_name 或 stale_minutes 是 NULL ⇒ 那一條【沒有判別力】** ——
  --    它會安靜地永遠不亮(NULL 比較 = UNKNOWN ⇒ COALESCE 成 false)。
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_jobs)
               AS j(job_name text, stale_minutes numeric)
             WHERE j.job_name IS NULL OR j.stale_minutes IS NULL) THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 有元素缺 job_name 或 stale_minutes ⇒ 那一支會永遠不亮 ⇒ 拒回傳';
  END IF;
  -- 🔴 **值域守門**(codex R3 consider ⇒ 我接受):`stale_minutes <= 0` 會讓那一支【每一輪都亮】
  --    (告警風暴 ⇒ 而「天天叫的告警等於沒有告警」, 片1 自己寫過這句);
  --    荒謬的大值則讓它**永遠不亮** ⇒ 兩個方向都是失效, 而兩個都不會紅。
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_jobs)
               AS j(stale_minutes numeric)
             WHERE j.stale_minutes <= 0 OR j.stale_minutes > 43200) THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:stale_minutes 必須在 (0, 43200] 分之間(上限 30 天)⇒ 拒回傳';
  END IF;

  -- 🔴 `failures_meaningful` 同樣必填(codex R1 F3):缺它就無法與 B 逐格相同, 而那個不一致【不會紅】。
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_jobs)
               AS j(failures_meaningful boolean)
             WHERE j.failures_meaningful IS NULL) THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 有元素缺 failures_meaningful ⇒ 判準會與後台儀表板不一致 ⇒ 拒回傳';
  END IF;
  -- 🔵 **順序是有意義的(codex R2 抓到, 而我的新負對照當場複現了它)**:
  --    欄位缺漏那三道要排在【重複偵測】之前 —— 否則 `job_name` 是 NULL 時
  --    `count(DISTINCT job_name)` 會算成 0 ⇒ **先撞到重複那道** ⇒ 錯誤訊息指錯地方,
  --    而修的人會去找一個不存在的重複。**兩道都紅, 而紅的順序決定了他往哪裡看。**
  -- 🔴🔴 **上面那道【數量】核對擋不住重複**(codex R1 F2 must-fix)。
  --    餵同一支健康的 job 六次、而真正的六支裡有五支死了 ⇒ `checked = 6` ⇒ 數量對得上
  --    ⇒ **回 `abnormal_count = 0`, 而世界上有五支排程死著。**
  --    📌 **「我餵幾條 vs 它跑幾支」相同, 不等於「它檢查的是我要的那幾支」** ——
  --       那是鐵則 11 那條的下一層:分母的【數量】對了, 而分母的【成員】沒被檢查。
  IF (SELECT pg_catalog.count(DISTINCT j.job_name)
        FROM pg_catalog.jsonb_to_recordset(p_jobs) AS j(job_name text))
     <> pg_catalog.jsonb_array_length(p_jobs) THEN
    RAISE EXCEPTION 'get_cron_heartbeat_stale_counts:p_jobs 有重複的 job_name ⇒ 實際被檢查的排程比你以為的少 ⇒ 拒回傳';
  END IF;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_cron_heartbeat_stale_counts(jsonb) IS
  '排程心跳過期計數(板 b4-SWEEPDEAD1 片2)。門檻由呼叫端傳入 —— 唯一來源是 packages/domain/src/ops/cron-jobs.ts;'
  '本函式不知道任何門檻, 也不判斷要不要告警。判準與後台儀表板 cron-heartbeat-read.ts 逐格相同'
  '(stale 用嚴格大於 / future = 負數 / failing 看 failures_meaningful)。'
  '授權只給 payment_confirmer —— 那個角色零表權限、只能呼叫函式。';

-- ── 收權:兩道 REVOKE 缺一不可 ────────────────────────────────────────────
-- 🔴 第一道擋 PUBLIC(新函式出生自帶 PUBLIC EXECUTE);
--    第二道擋 Supabase 那三個具名角色 —— 它們的權限【不是】只經 PUBLIC 來的,
--    只做第一道的話 anon 仍然叫得動(2026-08-31 本線在拋棄式 PG 上量過那個不對稱)。
REVOKE ALL ON FUNCTION public.get_cron_heartbeat_stale_counts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cron_heartbeat_stale_counts(jsonb)
  FROM anon, authenticated, service_role;
-- 🔵 **第三道:連【被授權者本人】也先收掉**(codex R3 must-fix)。
--    ⚠️ **改成裸 `CREATE` 之後, 這一道的原始理由已經不成立了**(沒有舊 ACL 可繼承)——
--    留著是因為它零成本、且擋住「有人日後把它改回 `OR REPLACE`」那一天。**理由變了, 字面留著。**
--    原始理由:`CREATE OR REPLACE` **保留既有 owner 與 ACL** ⇒ 若前一版曾把
--    `payment_confirmer` 授成 `WITH GRANT OPTION`, 上面兩道都清不到它
--    ⇒ 它可以把這支函式**再轉授給別人**, 而 proacl 上只看得到一個預期中的名字。
--    ⇒ 先 REVOKE 再 GRANT ⇒ 授權從一個【已知的空狀態】長出來, 不是疊在歷史上。
REVOKE ALL ON FUNCTION public.get_cron_heartbeat_stale_counts(jsonb)
  FROM payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_cron_heartbeat_stale_counts(jsonb)
  TO payment_confirmer;

-- ── 斷言:apply 當下就要紅, 不留給下一個人發現 ──────────────────────────
DO $assert$
DECLARE
  -- 🔵 用 `v_functions text[]` 這個形狀是**守門要求的**(migration 靜態守門 ③ 只認它):
  --    它比對「可授權物件數」與「斷言清單長度」⇒ 清單漏列一個, 那個物件的收權就沒有人在看,
  --    而**那道斷言只檢查你列出來的東西 —— 它防「忘記收權」, 不防「忘記列」**。
  v_functions text[] := ARRAY['public.get_cron_heartbeat_stale_counts(jsonb)']::text[];
  r        text := 'public.get_cron_heartbeat_stale_counts(jsonb)';
  v_acl    text;
  v_extra  text;
  v_shape  jsonb;
  v_owner  text;
  v_raised boolean;
  v_msg    text;
  v_case   record;
BEGIN
  IF pg_catalog.to_regprocedure(r) IS NULL THEN
    RAISE EXCEPTION '心跳計數斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
  END IF;

  SELECT pg_catalog.array_to_string(p.proacl, ', ') INTO v_acl
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '心跳計數斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
  END IF;

  -- 🔴 白名單不是黑名單:問「有沒有多」而不是「是不是那幾個壞的」。
  -- 🔵 **排除的是【這支函式的 owner】, 不是寫死 'postgres'** —— owner 本來就隱含有 EXECUTE。
  --    ⚠️ 這一格是實跑撞出來的:本機拋棄式 PG 的 superuser 叫 `seanhung` 而不是 `postgres`
  --    ⇒ 寫死 'postgres' 的版本在正式庫過、在本機紅, 而**那個紅不是缺陷、是環境差**。
  --    🛑 而【動態排除 owner】自己開了一個洞(codex R1 F5 must-fix):
  --       若這支函式被一個**非預期的 owner** 建起來, ACL 就只有「那個 owner + payment_confirmer」
  --       ⇒ 本斷言照樣通過, 而之後每一次呼叫都用**那個錯的 owner 的權限**執行(SECDEF)。
  --       ⇒ 所以下面補一道:**owner 必須是 superuser**。
  --       📌 這道擋的是「被某個應用角色擁有」那一種, 而它在兩個環境都成立 —— 寫死 'postgres' 不行。
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.pg_get_userbyid(a.grantee), ', ') INTO v_extra
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = pg_catalog.to_regprocedure(r)
     AND a.privilege_type = 'EXECUTE'
     AND a.grantee <> p.proowner
     AND pg_catalog.pg_get_userbyid(a.grantee) <> 'payment_confirmer';
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '心跳計數斷言失敗:% 的 EXECUTE 多出非預期角色(%)—— 只應有 payment_confirmer;拒繼續', r, v_extra;
  END IF;

  -- 🔴 owner 必須是 superuser(codex R1 F5)—— SECDEF 是拿 owner 的權限跑的,
  --    owner 是誰決定了這支函式【實際能碰到什麼】, 而 proacl 完全看不出那件事。
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
  -- 🔴🔴 **不靠【名字】判, 靠【權限屬性】判**(codex R2 must-fix 打掉我上一版)。
  --    我上一版寫 `rolsuper OR rolname = 'postgres'` —— 那個 OR 是一個**以名字為準的後門**。
  --    🔵 **而它不能單純刪掉**:2026-08-31 對正式庫唯讀量到
  --       `postgres rolsuper=false rolbypassrls=true`(Supabase 的 `postgres` **不是** superuser;
  --       真 superuser 是 `supabase_admin`)⇒ **只寫 `rolsuper` 會在正式庫上紅, 而函式是對的。**
  --    ⇒ 判準改成:**owner 必須是特權角色(superuser 或 BYPASSRLS), 且不得是任何一個前台/應用角色**。
  --       正式庫 `postgres`(bypassrls=true)過;本機 superuser 過;
  --       `payment_confirmer`(兩者皆 false)擋掉;`service_role`(bypassrls=true)由下面那張清單擋掉。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles ro
                  WHERE ro.rolname = v_owner
                    AND (ro.rolsuper OR ro.rolbypassrls)
                    AND ro.rolname NOT IN ('anon', 'authenticated', 'service_role', 'payment_confirmer')) THEN
    RAISE EXCEPTION '心跳計數斷言失敗:% 的 owner 是 [%] —— 它不是特權角色, 或它是應用角色 ⇒ SECDEF 會用它的權限跑 ⇒ 拒繼續', r, v_owner;
  END IF;

  -- 🔴 第三個方向:有對的人、沒有多的人, **而他還是可能把它送出去**(codex R3 must-fix)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
              WHERE p.oid = pg_catalog.to_regprocedure(r) AND a.is_grantable) THEN
    RAISE EXCEPTION '心跳計數斷言失敗:% 有 WITH GRANT OPTION ⇒ 被授權者可以再轉授 ⇒ 拒繼續(收到 %)', r, v_acl;
  END IF;

  -- 🔴 反方向那一道:上面問「有沒有多」, 這道問「有沒有少」。只做一邊會各漏一種。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                  WHERE p.oid = pg_catalog.to_regprocedure(r)
                    AND a.privilege_type = 'EXECUTE'
                    AND pg_catalog.pg_get_userbyid(a.grantee) = 'payment_confirmer') THEN
    RAISE EXCEPTION '心跳計數斷言失敗:% 對 payment_confirmer 沒有 EXECUTE ⇒ 告警讀不到(收到 %)', r, v_acl;
  END IF;

  -- 🔴🔴 **proacl 看不到【成員關係】**(codex R3 must-fix)。
  --    任何角色只要是 `payment_confirmer` 的 member, 就能靠 INHERIT / SET ROLE 執行這支函式,
  --    而 `v_extra` 那道白名單**完全看不到它** —— 它只讀 ACL, 不讀 `pg_auth_members`。
  --    📌 **⇒ 一道正確的白名單, 在一個它看不到的維度上是全盲的。**
  --    ⚠️ 正式庫預期 `payment_confirmer` 的成員只有 `postgres`(Supabase 慣例)。
  --       多出任何一個 ⇒ 停下人工判斷, **不要自己把它加進白名單**。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members am
              WHERE am.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer')
                AND pg_catalog.pg_get_userbyid(am.member) <> 'postgres') THEN
    RAISE EXCEPTION '心跳計數斷言失敗:payment_confirmer 有預期外的成員 [%] ⇒ 它們繼承得到本函式而 proacl 看不出來 ⇒ 拒繼續',
      (SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(am.member), ',' ORDER BY 1)
         FROM pg_catalog.pg_auth_members am
        WHERE am.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer')
          AND pg_catalog.pg_get_userbyid(am.member) <> 'postgres');
  END IF;

  -- 形狀自檢:餵一支不存在的排程 ⇒ 它必須算成 never_beat, 而不是安靜地不算。
  SELECT public.get_cron_heartbeat_stale_counts(
    '[{"job_name":"zzq-nosuch-job-8831","stale_minutes":5,"failures_meaningful":true}]'::jsonb
  ) INTO v_shape;
  IF v_shape IS NULL
     OR (v_shape ->> 'checked')::integer <> 1
     OR (v_shape ->> 'abnormal_count')::integer <> 1
     OR pg_catalog.jsonb_array_length(v_shape -> 'never_beat') <> 1 THEN
    RAISE EXCEPTION '心跳計數形狀自檢失敗:不存在的排程沒有被算成 never_beat(收到 %)⇒ 拒繼續', v_shape;
  END IF;

  -- 🟢🟢 **負對照:每一道 fail-closed 都要【因為它自己】而擋**(codex R2 must-fix 打掉我上一版)。
  --    ⛔ ~~上一版用 `WHEN others` 只問「有沒有拋」~~ —— 而那會**通過得不對**:
  --       餵 `[{"stale_minutes":5}]`(缺 job_name)⇒ `count(DISTINCT job_name)` 是 0、陣列長度是 1
  --       ⇒ **先撞到【重複 job_name】那道**, 而我上一版把那個紅讀成「缺 job_name 那道有效」。
  --    📌 **⇒ 一個守門【紅了】不等於【是你要的那個守門紅了】** ——
  --       而兩者在 `WHEN others` 底下印同一個東西。
  --    ⇒ 所以下面每一格都比對 `SQLERRM` 的特徵字, 不只問有沒有拋。
  FOR v_case IN
    SELECT * FROM (VALUES
      (NULL::jsonb,                                                   '不得為 NULL'),
      ('{}'::jsonb,                                                   '必須是 JSON 陣列'),
      ('[]'::jsonb,                                                   '空陣列'),
      ('[{"job_name":"a","stale_minutes":1,"failures_meaningful":true},
         {"job_name":"a","stale_minutes":1,"failures_meaningful":true}]'::jsonb, '重複的 job_name'),
      ('[{"stale_minutes":5,"failures_meaningful":true}]'::jsonb,     '缺 job_name 或 stale_minutes'),
      ('[{"job_name":"a","failures_meaningful":true}]'::jsonb,        '缺 job_name 或 stale_minutes'),
      ('[{"job_name":"a","stale_minutes":5}]'::jsonb,                 '缺 failures_meaningful')
    -- 🔵 別名清單**不能帶型別**(`AS t(payload jsonb, …)` ⇒ syntax error);
    --    型別由 VALUES 第一列的 `NULL::jsonb` / 字面字串決定。又一格實跑撞出來的。
    ) AS t(payload, want)
  LOOP
    v_raised := false; v_msg := '(沒有拋)';
    BEGIN
      PERFORM public.get_cron_heartbeat_stale_counts(v_case.payload);
    EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '心跳計數負對照失敗:輸入 % 竟然沒有 RAISE ⇒ 那道 fail-closed 不在了', COALESCE(v_case.payload::text, 'NULL');
    END IF;
    -- 🔴 **第三次撞到同一個形狀**:`position(x IN y)` 與 `extract(f FROM x)` 一樣是
    --    **關鍵字語法, 不能加 schema 限定** ⇒ `pg_catalog.position(… IN …)` = syntax error。
    --    ⇒ 要限定就得換成一般函式形式 —— 這裡用 `strpos(haystack, needle)`。
    --    📌 今天這支檔撞了三次同族(`extract` / `round` 型別 / `position`),
    --       而**三次都是靜態讀不出來、餵給 psql 才會說話的**。
    IF pg_catalog.strpos(v_msg, v_case.want) = 0 THEN
      RAISE EXCEPTION '心跳計數負對照失敗:輸入 % 拋了, 但【拋的不是我要驗的那道】—— 期望訊息含 [%], 實得 [%]',
        COALESCE(v_case.payload::text, 'NULL'), v_case.want, v_msg;
    END IF;
  END LOOP;

  -- 🟢 **正對照:合法輸入必須【通過】** —— 少了這一格, 上面七格全紅也會被讀成成功
  --    (一個恆拋的函式會讓那七格全過, 而它對真實輸入毫無用處)。
  SELECT public.get_cron_heartbeat_stale_counts(
    '[{"job_name":"zzq-nosuch-job-8831","stale_minutes":5,"failures_meaningful":true}]'::jsonb
  ) INTO v_shape;
  IF v_shape IS NULL OR (v_shape ->> 'checked')::integer <> 1 THEN
    RAISE EXCEPTION '心跳計數正對照失敗:合法輸入竟然沒有正常回傳(收到 %)⇒ 上面那七格的紅沒有意義', v_shape;
  END IF;
END
$assert$;
