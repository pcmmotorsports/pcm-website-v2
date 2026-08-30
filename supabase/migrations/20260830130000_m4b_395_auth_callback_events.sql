-- ============================================================
-- 板 :395 登入回呼可查性 — auth_callback_events 表 + record_auth_callback_event RPC
-- ============================================================
-- plan:~/pcm-mailbox/R3-plan-登入回呼可查性-板395-20260830.md(-0b 擬、主視窗 PASS)
-- 前手交接:~/pcm-mailbox/交接-線C-b4-板395登入回呼可查性-20260830.md
-- 鐵則 8(新表 + 新 RPC + GRANT)+ 鐵則 12②(權限)+ 12③(新 DB 物件)。
-- 審查:codex R1 FAIL(11)→ 修 → codex R2 FAIL(7)→ 修 → fable R3 FAIL(3,換角度打交互作用)→ 本版。
--
-- 🔴 為什麼:storefront `api/auth/line/callback` 今天【零落痕】。
--   2026-08-30 本窗獨立量(route 本體 + 它 import 的三支 lib):
--     console. / .insert( / .rpc( ⇒ 三個字集在四支檔上全數 0
--     正對照(尺是活的):同檔 redirect ⇒ 7、sanitizeNextParam ⇒ 4;
--                       storefront 全樹 createSupabaseServiceClient ⇒ 7 支檔
--   ⇒ 「查不到」同時代表【沒有人打過】與【全部都成功】,而那兩件事要分得開。
--   唯一的既有紀錄是 Vercel runtime log:保存 1 小時 + 要面板權限 ⇒ 當不了帳。
--
-- 🔴🔴 **本片【不含 admin sso 那一半】,而 plan 寫了** —— plan 那句在寫的時候是對的,
--   而 `ede72879`(B5-a 接線)之後就不是了。admin 側今天已經有一本留得住的帳:
--     表      public.admin_sso_login_events(20260818190000,APPLIED.tsv:259)
--     身分欄  20260824030000(APPLIED.tsv:288)
--     寫入點  apps/admin/src/lib/sso/login-event.ts:209 真 INSERT,不是 console
--     成功    apps/admin/src/app/api/sso/callback/route.ts:282;失敗六處 :115 :125 :131 :157 :199 :221
--   ⇒ 📌 **所以 `provider` 的 CHECK 裡【刻意沒有 'sso'】** —— 不是漏掉,是**擋住雙寫**。
--
-- ══ 🔴🔴 這張表【每天最多 18 列】,而那是三輪審查打出來的形狀 ═══════════════
--
--   前三版都有一個 `state_sha256` 欄,而它是**鍵的一部分**。三輪各打掉一層:
--   ```
--   前手版：NOT NULL + coalesce(state,'') ⇒ 沒帶 state 的呼叫全雜湊成同一值
--           ⇒ ON CONFLICT DO NOTHING ⇒ 第一發之後【永遠不再留下任何一列】
--   我 R1： 改 NULL-able + 鍵加 outcome/reason + hits 計數 ⇒ 修好了「沒帶 state」那一半
--   codex R2：而【同一顆鍵的另一半】沒修 —— 攻擊者不帶 cookie、每次送不同 state
--           ⇒ 每發雜湊不同 ⇒ 每發新增一列 ⇒ hits 那個「有界」保證完全沒有參與
--   我 R2 修：只有 safeEqual 通過之後才帶 state ⇒ 我宣稱這樣就有界
--   fable R3：🔴【那句話是假的】—— `api/auth/line/start` 無認證、每一發 GET 就鑄一組
--           新的 state + cookie ⇒ 攻擊者兩發換一列(先 /start 拿票、再拿它過 safeEqual)
--           ⇒ **無界照舊,我修的是放大率不是有界性。**
--   ```
--   🔴 **而 R3 同時證明了那一欄【已經買不到任何東西】**:
--     它原本的用途是「同一次回呼被重送只留一列 / 重放看得見」——
--     而 cookie 在**第一發 GET 就被刪掉**(`callback/route.ts` 用後即刪,那是對的、不動它)
--     ⇒ 重放一律走 `missing_state_cookie`、根本進不了 safeEqual
--     ⇒ **「同一個 state 反覆出現」那種列,構造不出來。**
--   ⇒ ⇒ 📌 **所以修法不是替它加一道上限,是把它整欄拿掉。**
--     一個【買不到東西、又讓攻擊者決定我們鍵空間】的欄位,正確的數量是零。
--
--   ⇒ 新的鍵 = `(provider, outcome, reason_code, event_day)`
--     provider 1 × outcome 2 × reason 9(success 時 NULL)⇒ **每天上限 10 列**(9 失敗 + 1 成功)。
--   🔵🔵 **codex R4(must-fix):~~我寫的是「結構上有界,不需要 retention」~~ —— 那句話又寫大了。**
--      **有上限的是【每天】,不是【總表】** ⇒ N 天之後就是 10N 列,對時間仍然是**線性成長**。
--      ⇒ 誠實的說法:**每天 ≤10 列 ⇒ 每年 ≤3,650 列** ——
--        那個量級不需要 retention(它十年也才三萬多列,一個索引掃過去毫無壓力),
--        **而「不需要」的理由是【速率夠低】,不是【它不會長】。**
--      ⚠️ 差別在哪:速率上限是**攻擊者拿不走的**(他打一百萬次也只推得動那十列的 `hits`),
--        而那正是這個設計買到的東西 —— **不是「不成長」,是「成長速度與攻擊量無關」。**
--   📌 **這是我在這一片上第三次把「有界」寫大** —— 前手版、我 R1、我 R2 各一次,
--      而三次都是同一個形狀:**我把「我剛剛擋住的那條路」講成「所有的路」。**
--   ⚠️ **代價寫出來,不藏**:失去「哪一次登入」的粒度。而那個粒度今天**沒有人用得到** ——
--     本表零 PII、零 request_id ⇒ 本來就對不回任何一次具體的登入。
--     ⇒ 值班要問的三件事照樣答得出:
--       「有沒有人在打我們」⇒ `missing_state_cookie` / `missing_state_param` 那幾列的 hits
--       「是不是我們自己壞了」⇒ `upstream_error` / `session_verify_failed` 的 hits
--       「今天有多少人登入成功」⇒ `success` 那一列的 hits
--     而 `event_day` 讓上面每一個都變成**時間序列**,不是一個累積到天荒地老的總數。
--
-- 🔴 與 payment_webhook_events 的關係:**照它的形狀,不借它的表、不動它的 ACL**
--   (plan 明列的最大岔路:不放寬錢域 GRANT)。同一句話也適用 admin_sso_login_events:
--   **不動一個已 apply 的 admin 物件**去服務 storefront。
--
-- 🔴 fail-open:**記錄失敗【不得擋登入】** —— 觀測不是閘。tappay 那條 fail-closed 因為它守的是錢;
--   本片守的是「事後查得到」,而一個查不到的登入 << 一個登不進去的客人。
--
-- 🔴 **本表刻意【零 PII】**:不存 IP、不存 UA、不存 email、不存 LINE sub,現在連 state 的雜湊都不存。
--   ⇒ 這裡是**客人**的登入,而客人有資料權(docs/runbooks/data-rights-sop.md)。
--     不收 PII ⇒ 這張表不必進「查我的資料 / 刪掉我的資料」的分母。**少收一格,少一整條 SOP。**
--
-- 🛑 **本表答不出的兩件,寫在這裡讓下一個人不要對它期待錯**(fable R3-F6):
--   ① **分不出「一個人打十萬次」與「十萬個人各打一次」** —— 那要 IP,而 IP 是 PII(刻意不收)。
--   ② **「記錄那一支自己壞了」與「今天沒有人登入」印同一張空表** —— fail-open 的必然代價,
--      後備只有 console(保存 1 小時)。⇒ 判別法是**比對兩邊**,不是等某個告警。
--   ③ **答不出「同一個人的那一次嘗試」**(codex R4 nit):同一天有一列 failure 一列 success 時,
--      分不出是「同一個客人失敗後重試成功」還是「兩個無關的請求」
--      ⇒ **算不出每次嘗試的轉換率、也還原不出重試序列**。那要 per-attempt 的列,
--      而 per-attempt 正是上面整段推翻掉的東西。**這是這個設計換來的,不是漏掉的。**
--
-- ══ 🔴 熱列爭用:重新判過的,不是沿用 R2-6 那三格 ═════════════════════════
--   codex R2-6 提過「洪水全撞同一列 ⇒ DO UPDATE 排隊」,而我當時的三格理由裡有一格是
--   「合法登入各自不同鍵、不進那條隊」—— 🔴 **那一格現在【不成立】**:
--   拿掉 state 之後,**同一天所有成功登入都撞同一列** ⇒ 爭用比前一版**更高**,不是更低。
--   ⇒ 📌 **一個被撤回的前提,不會自動撤回它支撐過的每一個決定** —— 所以這裡重寫,不留舊的。
--
--   **重新判的結論:仍然接受,而理由換過了。**
--   ① 那是一次**單列 UPDATE**(索引直查 + 一個 `bigint` 加一),持有鎖的時間是次毫秒級
--      ⇒ 序列化的天花板遠高於本站的登入量級(PCM 是一家車行,不是社群網站)。
--   ② 登入本身 **fail-open + 1.5 秒硬逾時** ⇒ 就算真的排到隊,**客人不會因此登不進來**,
--      代價是那幾發少記(而少記的那幾發,就是 hits 這個計數本來要數的東西 —— 誠實寫在這裡)。
--   ③ 前一版「每發一列」的替代方案是**無界**,而無界要靠 retention 排程去救
--      ⇒ 那是一個**要有人記得**的機制;結構上界不需要任何人記得。
--   ⇒ 🛑 **它是被決定接受的,不是沒看到。** 真的撞到天花板時的上游解法是邊緣層 rate limit,
--     不是這張表;而**判斷該不該做的依據就是這張表自己的 `hits`**。
--
-- rollback(forward-only 家法):反向 = DROP FUNCTION + DROP TABLE,
--   🔴 **僅在表為空時成立** —— 有列之後 DROP 會毀掉稽核紀錄,那時要另開一片談保存。
-- ============================================================

-- ── 1. 表 ───────────────────────────────────────────────────
-- 🔵 **codex R1-1:裸 CREATE,禁 `IF NOT EXISTS`。**
--   `IF NOT EXISTS` 在「正式庫已有同名但不同結構的物件」那個世界裡**靜默跳過**,
--   而下面的 ACL 斷言會對**錯的物件**全綠 ⇒ 它印的綠與真的綠長得一樣。
--   家法:`20260803140000:138` 逐字「裸 CREATE(禁 OR REPLACE,A7-t 教訓)」。
CREATE TABLE public.auth_callback_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 🔴 只有 'line'。'sso' 刻意不在集合裡 —— 見檔頭:它有自己的表,加進來就是雙寫。
  provider     text        NOT NULL CHECK (provider IN ('line')),
  outcome      text        NOT NULL CHECK (outcome  IN ('success', 'failure')),
  -- 🔵 **codex R1-9:reason_code 是【列舉】不是「合形狀就好」。**
  --   ~~原本只驗 `^[a-z0-9_]{1,64}$`~~ ⇒ DB 會收下任何新造的碼,而 TS 那邊的封閉集與 DB
  --   漂開時**沒有任何東西會紅**,稽核分類靜默污染。
  --   🔴 這九個與 `apps/storefront/src/lib/auth/callback-event.ts` 的 `LineCallbackReason`
  --     **必須逐字相同**,而那件事由 `callback-event.reason-codes.test.ts` 兩側交叉核釘住
  --     (fable R3-F1:光靠「DB 會擋」不夠 —— 呼叫端是 fail-open 的,被擋的後果是**安靜零列**)。
  reason_code  text        NULL CHECK (reason_code IN (
                             'missing_code',
                             'missing_state_param',
                             'missing_state_cookie',
                             'missing_nonce_cookie',
                             'state_mismatch',
                             'invalid_sub',
                             'collision_not_line',
                             'session_verify_failed',
                             'upstream_error'
                           )),
  -- 🔴 分桶的粒度 = 一天。它同時是【每日上限的來源】與【時間序列的來源】(見檔頭)。
  -- 🔵🔵 **codex R4(must-fix):~~原本是 `DEFAULT current_date`,而註解宣稱它是 UTC~~ —— 兩句都錯。**
  --    `current_date` 取的是**這個 session 的 `TimeZone`**,不是 UTC:
  --    session 設 `Asia/Taipei`、UTC 時間 08-29 16:30 ⇒ 它寫 **08-30**。
  --    ⇒ 📌 一個「哪一天」的欄位,如果它的答案取決於**誰來呼叫它**,那它不是一個日期,是一個巧合。
  -- ⇒ 修法:**明寫時區、不吃 session**。而選 `Asia/Taipei` 不是隨手 ——
  --    這一欄是給**值班的人**讀的(「今天有多少人登入」「昨天被打幾次」),
  --    而那個人在台灣。用 UTC 的話,台灣時間每天早上八點才換日,值班會對不上自己的一天。
  -- ⚠️ `created_at` / `last_seen_at` 仍是 `timestamptz`(照慣例存 UTC)——
  --    **只有這個「business day」標籤是台北的**,兩者不要混為一談。
  event_day    date        NOT NULL DEFAULT ((pg_catalog.now() AT TIME ZONE 'Asia/Taipei')::date),
  -- 🔵 **codex R1-5/6 + R2-7**:撞到不是丟掉、是計數;而型別是 `bigint` 不是 `integer` ——
  --   `integer` 撞到 2147483647 之後再撞一次就 `out of range`
  --   ⇒ **那一組從此再也記不了任何一次,而它正是【被打最兇的那一組】。**
  --   📌 一個溢位的計數器不是「數字停住」,是那條觀測線在被攻擊時剛好失效。
  hits         bigint      NOT NULL DEFAULT 1 CHECK (hits > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- 🔵 **codex R1-9:outcome 與 reason_code 的【配對】也要 CHECK。**
  --   兩欄各自合法就過的話,DB 收得下 `success + upstream_error` 與 `failure + NULL`,
  --   而那兩種列在報表上會安靜地把成敗算錯。家法:`20260824030000` 的配對 CHECK。
  CONSTRAINT auth_callback_events_outcome_reason_pair CHECK (
    (outcome = 'success' AND reason_code IS NULL)
    OR (outcome = 'failure' AND reason_code IS NOT NULL)
  )
);

COMMENT ON TABLE  public.auth_callback_events IS
  '顧客站登入回呼的每日計數(板 :395)。每天最多 10 列(1 成功 + 9 失敗原因),結構上有界。只記「有沒有被打過、成敗、我方 reason code、當天幾次」,零 PII、不存 state、不存原始 error。admin SSO 有自己的 admin_sso_login_events,不要雙寫。';
COMMENT ON COLUMN public.auth_callback_events.provider IS
  '目前只有 line。sso 刻意不在 CHECK 集合裡:它已有 admin_sso_login_events,加進來就是兩本帳。';
COMMENT ON COLUMN public.auth_callback_events.reason_code IS
  '我方封閉集的失敗原因碼(九個,逐字對齊 callback-event.ts 的 LineCallbackReason;交叉核在 callback-event.reason-codes.test.ts)。success 時必為 NULL。刻意不存上游原始訊息。';
COMMENT ON COLUMN public.auth_callback_events.event_day IS
  '事件日,**台北時區**((now() AT TIME ZONE ''Asia/Taipei'')::date,不吃 session 的 TimeZone)。它是鍵的一部分:每天最多 10 列,同時讓每個計數變成時間序列而不是一個永遠累加的總數。⚠️ created_at / last_seen_at 是 timestamptz(UTC),只有這一欄是台北的business day。';
COMMENT ON COLUMN public.auth_callback_events.hits IS
  '🔴 這一天這一格發生了幾次。值班讀法:missing_state_cookie / missing_state_param 衝高 = 有人在打這個 endpoint;upstream_error / session_verify_failed 衝高 = 我們自己或 LINE 那側壞了;success 就是當天登入成功數。⚠️ 它分不出「一個人打十萬次」與「十萬個人各打一次」—— 那要 IP,而 IP 是 PII,本表刻意不收。';
COMMENT ON COLUMN public.auth_callback_events.last_seen_at IS
  '這一天這一格最後一次發生的時刻(與 created_at 一起看得出當天的頭尾;更細的分布本表答不出)。';

CREATE UNIQUE INDEX auth_callback_events_dedup_uq
  ON public.auth_callback_events (provider, outcome, coalesce(reason_code, ''), event_day);
CREATE INDEX auth_callback_events_event_day_idx
  ON public.auth_callback_events (event_day DESC);

-- ── 2. 表層權限:零直接寫入權,service_role 只准讀 ──────────────
ALTER TABLE public.auth_callback_events ENABLE ROW LEVEL SECURITY;

-- 🔵🔵 **這條政策是 repo 的 RLS 守門擋下來之後補的,而它比我原本的做法【對】。**
--    ~~原本我讓這張表【零 policy】,再加一道「service_role 必須有 BYPASSRLS」的斷言~~
--    ⇒ 那是把「讀得到」這件事**押在一個平台角色屬性上**,而那不是我們寫的東西。
--    🔴 拿掉 BYPASSRLS 的那一天:`has_table_privilege` **仍然回 true**(它答的是 GRANT),
--      而查詢**回零列** ⇒ 📌 **後台會讀到一張空表,而空表看起來像正常資料 —— 沒有人會叫。**
--      (那正是這整張表要修的病:「查不到」被讀成「沒有人登入」。它差點長在它自己身上。)
--    ⇒ 明寫政策 ⇒ **不再依賴 BYPASSRLS**,而 anon / authenticated 照樣讀不到
--      (它們連 `GRANT SELECT` 都沒有 —— policy 只在有表權之後才輪得到它說話)。
--    ⚠️ 守門逐字:「正式庫現在已經有 42 張這樣的表」⇒ 本表不再加第 43 張。
CREATE POLICY auth_callback_events_select_service_role
  ON public.auth_callback_events
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.auth_callback_events FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_callback_events FROM anon, authenticated, service_role;
-- 🔴 只給 SELECT,而它不是 YAGNI 的例外:這張表存在的用途就是【被查】,
--   而唯一查得動它的伺服器身分就是 service_role。它同時是下面正對照的量具。
GRANT SELECT ON TABLE public.auth_callback_events TO service_role;

-- 🔵 **codex R1-2:identity sequence 是【另一種物件】,REVOKE 表權收不到它。**
--   `has_table_privilege` 根本看不到 sequence ⇒ 漏掉它,下面的斷言會全綠而 anon 叫得動 `nextval`。
--   家法逐字照 `20260828080000_m4b_b4views1_saved_order_views.sql:182-188`。
DO $seq$
DECLARE
  v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('public.auth_callback_events', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION ':395 identity sequence 找不到 —— id 欄可能不是 identity;拒繼續';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
END;
$seq$;

-- ── 3. RPC:唯一的寫入口 ────────────────────────────────────
-- 🔵 **codex R1-1:裸 `CREATE FUNCTION`,禁 `OR REPLACE`。**
CREATE FUNCTION public.record_auth_callback_event(
  p_provider    text,
  p_outcome     text,
  p_reason_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔵🔵 **codex R2-3:`public` 不在 search_path 裡,而順序是承重的。**
--    ~~原本是 `public, pg_catalog, pg_temp`~~ ⇒ **`public` 排在 `pg_catalog` 前面**
--    ⇒ 任何拿得到 `CREATE ON SCHEMA public` 的角色可以建一支 `public.now()`
--      ⇒ 本函式以 **definer 權限**執行那支冒牌貨。
--    ⇒ `public` 整個拿掉、本體內每一個跨 schema 名稱都寫全。
--    📌 `COALESCE` / `NULLIF` / `CASE` 是 SQL 語法不是可覆寫的函式,不需要限定。
--    🔴 而這一行本身由下面 `own_guard` 的 `proconfig` 斷言釘住 ——
--       只是「改對了」不夠:改回去不會有任何東西紅(突變實測 rc=0)。
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO public.auth_callback_events (provider, outcome, reason_code)
  VALUES (p_provider, p_outcome, NULLIF(p_reason_code, ''))
  -- 🔴 衝突目標必須與唯一索引的運算式**逐字相同**,否則 PG 找不到那個索引會直接報錯。
  --   `event_day` 不出現在 VALUES 裡(走欄位 DEFAULT `current_date`),但**要出現在鍵裡**。
  ON CONFLICT (provider, outcome, coalesce(reason_code, ''), event_day)
  DO UPDATE SET
    hits         = public.auth_callback_events.hits + 1,
    last_seen_at = pg_catalog.now();
END
$$;

COMMENT ON FUNCTION public.record_auth_callback_event(text, text, text) IS
  '顧客站登入回呼可查性的唯一寫入口(板 :395)。同一天、同一個 (provider,outcome,reason) 只有一列,重複發生 hits+1。呼叫端 fail-open,記錄失敗不得擋登入。';

-- ── 4. RPC 權限:兩道 REVOKE(照 docs/patterns/revoking-function-execute-in-supabase.md)──
--   🔴 一道不夠:只 FROM PUBLIC 收不到具名授權;只 FROM anon,authenticated 收不到 PUBLIC 那份。
REVOKE ALL ON FUNCTION public.record_auth_callback_event(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_auth_callback_event(text, text, text) FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_auth_callback_event(text, text, text) TO service_role;

-- ── 5. 🔴 收權斷言:走【repo 樣板】,不自己手寫 ────────────────────
-- 🔴🔴 **它排在【所有物件都建完、權限都收完】之後,而那不是排版問題。**
--    我第一版把它排在建完表、還沒建 RPC 的位置 ⇒ 拋棄式 PG 上第一發就紅:
--      「新物件收權斷言:找不到函式 public.record_auth_callback_event(...)」
--    ⇒ ✅ **那是樣板在做它該做的事**(找不到就拒繼續,不是安靜略過)——
--      而**如果它當初是安靜略過的,我這一版就會帶著一個從不檢查 RPC 的斷言上線,而且全綠。**
--    📌 一道 fail-closed 的守門,第一次幫到你的時候看起來像它壞了。
--
-- 🔵 **codex R1-3**:~~我原本手寫一串 `has_table_privilege(...)`~~,而它有兩個洞:
--   ① 權限型別**手寫** ⇒ PG 17 有八種,少數的那幾種永遠不會被查;
--   ② **欄級授權查不到** ⇒ anon 讀得到部分欄位而「全零」斷言照樣綠(`revoking-…md` §3.6)。
--   ⇒ 改用 repo 樣板(`20260817070000_m4b_231_3_sweeper_heartbeat.sql:145-238` 逐字搬):
--     權限型別由 `acldefault()` **從伺服器推導**,並且**逐欄**再問一次。
--   📌 **我寫得出那兩個洞的名字,是因為它們早就被寫在 repo 裡了 —— 我只是沒有先去找。**
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.auth_callback_events'
  ]::text[];
  v_functions text[] := ARRAY[
    'public.record_auth_callback_event(text, text, text)'
  ]::text[];
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
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件,請把 v_declares_nothing 設成 true(明示),不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件,略過(已留痕)。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(樣板出處 codex 2026-08-17 must-fix)。
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
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母,不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ :395 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限(第一個:%)。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權,FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ :395 新物件收權斷言通過:檢查 % 個物件,anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- 🔴 樣板不管的幾件,本片自己補(它查的是 anon/authenticated 的 ACL)。
DO $own_guard$
DECLARE
  v_seq text;
  r     record;
BEGIN
  -- ① 【正對照】:service_role 對本表應該有 SELECT ⇒ 必須 true。
  --    沒有這一發,上面那組「全零」在【尺壞掉】與【真的全零】印同一個綠。
  IF NOT has_table_privilege('service_role', 'public.auth_callback_events', 'SELECT') THEN
    RAISE EXCEPTION ':395 斷言的【正對照】失敗 —— service_role 對 auth_callback_events 沒有 SELECT。'
      ' 這代表上面的 GRANT 沒生效,或這把尺本身壞了;拒繼續';
  END IF;
  IF NOT has_function_privilege('service_role',
        'public.record_auth_callback_event(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION ':395 RPC 斷言的【正對照】失敗 —— service_role 執行不到 record_auth_callback_event;拒繼續';
  END IF;

  -- ② service_role 只准讀:寫入口只有那支 SECURITY DEFINER RPC。
  IF has_table_privilege('service_role', 'public.auth_callback_events', 'INSERT')
     OR has_table_privilege('service_role', 'public.auth_callback_events', 'UPDATE')
     OR has_table_privilege('service_role', 'public.auth_callback_events', 'DELETE')
     OR has_table_privilege('service_role', 'public.auth_callback_events', 'TRUNCATE') THEN
    RAISE EXCEPTION ':395 service_role 不該有寫入權 —— 寫入口只有 record_auth_callback_event;拒繼續';
  END IF;

  -- ③ 🔵 **codex R1-2 的斷言那一半**(照 `20260828080000:644-658`)。
  v_seq := pg_get_serial_sequence('public.auth_callback_events', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION ':395 斷言 sequence:找不到 identity sequence(id 欄不是 identity?)';
  END IF;
  FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role']) AS role LOOP
    IF has_sequence_privilege(r.role, v_seq, 'USAGE')
       OR has_sequence_privilege(r.role, v_seq, 'SELECT')
       OR has_sequence_privilege(r.role, v_seq, 'UPDATE') THEN
      RAISE EXCEPTION ':395 斷言 sequence:% 對 identity sequence(%)仍有權限', r.role, v_seq;
    END IF;
  END LOOP;

  -- ④ RLS 真的開著(樣板查的是 ACL,不查 RLS)。
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_callback_events'::regclass) THEN
    RAISE EXCEPTION ':395 RLS 未啟用';
  END IF;

  -- ⑤ 🔵 **codex R2-1:角色成員身分 —— 「直接權限是零」不等於「進不來」。**
  --    `GRANT service_role TO anon` 之後(**即使 anon 是 NOINHERIT**,那正是 Supabase 的實況),
  --    anon 可以 `SET ROLE service_role` ⇒ 上面每一格 `has_*_privilege('anon', …)`
  --    **全部照樣回 false** ⇒ 整組斷言全綠而門是開的。
  --    ⇒ 📌 這正是 `revoking-…md` §3.5 說「兩道 REVOKE 是必要基線、不是已經關上的證明」的那條路。
  --      ~~我原本只把它寫成「涵蓋不到的射程」~~ —— **而它其實查得到,只是要問對表。**
  --    ⚠️ 用遞移閉包(`pg_auth_members` 可以多層),不是只看直接一層。
  --    🔵 **codex R4(must-fix):分母裡不只有 `service_role`,還有【owner】。**
  --      ~~原本只查 service_role 成員~~ ⇒ 而 `GRANT <owner> TO anon` 之後,
  --      anon `SET ROLE` 成 owner ⇒ 那支 SECURITY DEFINER 函式**連改都改得動**,
  --      而上面每一格照樣綠。⇒ owner 是比 service_role **更大**的那把鑰匙,不能不在分母裡。
  IF EXISTS (
    WITH RECURSIVE m AS (
      SELECT roleid, member FROM pg_catalog.pg_auth_members
      UNION
      SELECT a.roleid, m.member FROM pg_catalog.pg_auth_members a JOIN m ON a.member = m.roleid
    )
    SELECT 1 FROM m
     WHERE m.roleid IN (
             'service_role'::regrole,
             (SELECT c.relowner::regrole FROM pg_catalog.pg_class c
               WHERE c.oid = 'public.auth_callback_events'::regclass)
           )
       AND m.member IN ('anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION ':395 anon/authenticated 是 service_role 或本表 owner 的成員 —— 它們 SET ROLE 之後就繞過上面每一格;拒繼續';
  END IF;

  -- ⑥ 🔵 **codex R2-3 的守門那一半**:`search_path` 本身也要釘。
  --    ~~我只是把它改對了~~ ⇒ 而**改回 `public, pg_catalog` 不會有任何東西紅**
  --    (突變實測 rc=0)⇒ 那個修法沒有回歸守門,下一個人加一句 `public` 就退回去了。
  IF (SELECT pg_catalog.array_to_string(p.proconfig, ',') FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.record_auth_callback_event(text, text, text)'::regprocedure)
     IS DISTINCT FROM 'search_path=pg_catalog, pg_temp' THEN
    RAISE EXCEPTION ':395 RPC 的 search_path 不是 `pg_catalog, pg_temp` —— public 在路徑上就可能被劫持(SECURITY DEFINER);拒繼續';
  END IF;

  -- ⑦ 🔵 **codex R2-2:`SECURITY DEFINER` 與 owner 本身也要斷言。**
  --    拿掉 `SECURITY DEFINER`(或函式 owner 與表 owner 不同)⇒ **上面每一格照樣綠**,
  --    而正式呼叫那天才會因為沒有寫入權失敗 —— 而那條路是 fail-open 的 ⇒ **它會安靜地一列都不寫。**
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
           WHERE p.oid = 'public.record_auth_callback_event(text, text, text)'::regprocedure) THEN
    RAISE EXCEPTION ':395 record_auth_callback_event 不是 SECURITY DEFINER —— 它會以呼叫者身分跑而呼叫者沒有寫入權;拒繼續';
  END IF;
  IF (SELECT p.proowner FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.record_auth_callback_event(text, text, text)'::regprocedure)
     <> (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.auth_callback_events'::regclass) THEN
    RAISE EXCEPTION ':395 RPC 的 owner 與表的 owner 不同 —— definer 身分不保證寫得進那張表;拒繼續';
  END IF;

  -- ⑧ 🔵 **codex R2-8 的修法【換過了】,而換的理由值得留著。**
  --    codex 指出:零 policy + RLS 開著 ⇒ service_role 讀得到全靠 BYPASSRLS,
  --    而 `has_table_privilege` 答的是 GRANT、不是 RLS ⇒ 拿掉 BYPASSRLS 那天,
  --    斷言全綠而查詢回零列 ⇒ **後台讀到一張空表,而空表看起來像正常資料。**
  --    ~~我第一版的修法是斷言「service_role 必須有 BYPASSRLS」~~
  --    ⇒ 🔴 而 repo 的 `rls-service-role-policy-gate` 在 commit 當下把我擋下來,並指出**更好的那條**:
  --      **不要去斷言那個屬性,直接把政策寫出來** ⇒ 讀得到這件事就不再押在平台屬性上。
  --    📌 **一道守門的價值不只是擋錯,是它知道一條我不知道的路。**
  --    ⇒ 所以這裡改成斷言【那條政策存在且形狀對】,不再問 BYPASSRLS。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy pol
     WHERE pol.polrelid = 'public.auth_callback_events'::regclass
       AND pol.polname  = 'auth_callback_events_select_service_role'
       AND pol.polcmd   = 'r'                                        -- r = SELECT
       AND 'service_role'::regrole = ANY (pol.polroles)
  ) THEN
    RAISE EXCEPTION ':395 找不到 service_role 的 SELECT 政策 —— 沒有它,讀得到就只剩 BYPASSRLS 這個平台屬性;拒繼續';
  END IF;
END
$own_guard$;

-- ── 6. 🔴 讓那支 RPC 【當場表演一次】,再把痕跡清掉 ──────────────────
-- 🔵 **fable R3-F1**:上面每一道都在問「權限對不對」,而**沒有一道問過「它跑不跑得起來」**。
--   plpgsql 的本體**第一次被呼叫時才 parse** ⇒ 一個打錯的欄名、一個對不上唯一索引的
--   `ON CONFLICT` 目標,**apply 當下完全不會紅**,而呼叫端是 fail-open 的
--   ⇒ 📌 **它會在正式庫上安靜地一列都不寫,而所有的綠都還在。**
-- ⇒ 這一段跑三發:寫一列、再撞一次(hits 必須變 2)、負對照(自創 reason 必須被擋),
--   然後把這三發的痕跡**刪乾淨**(本表此刻必為空,所以 DELETE 是安全的)。
DO $smoke$
DECLARE
  v_hits bigint;
  v_rows int;
BEGIN
  PERFORM public.record_auth_callback_event('line', 'failure', 'upstream_error');
  PERFORM public.record_auth_callback_event('line', 'failure', 'upstream_error');
  SELECT hits INTO v_hits FROM public.auth_callback_events
   WHERE provider = 'line' AND outcome = 'failure' AND reason_code = 'upstream_error'
     AND event_day = current_date;
  IF v_hits IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION ':395 冒煙測試:同一格撞兩次之後 hits 應為 2,實際 % —— ON CONFLICT 沒接上唯一索引', v_hits;
  END IF;

  -- 負對照:自創的 reason 必須被 CHECK 擋下來。沒有這一發,上面那個 2 也可能來自一張什麼都收的表。
  BEGIN
    PERFORM public.record_auth_callback_event('line', 'failure', 'zzz_not_a_real_reason');
    RAISE EXCEPTION ':395 冒煙測試:自創 reason_code 竟然寫得進去 ⇒ 那個列舉 CHECK 是恆真的';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- ✅ 這就是要的
  END;

  DELETE FROM public.auth_callback_events;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION ':395 冒煙測試:清痕跡時刪了 % 列(預期 1)—— 這張表在 apply 當下不該有別的列', v_rows;
  END IF;
  RAISE NOTICE '✅ :395 冒煙測試通過(寫入 / hits+1 / 列舉 CHECK 三發),痕跡已清乾淨。';
END
$smoke$;
