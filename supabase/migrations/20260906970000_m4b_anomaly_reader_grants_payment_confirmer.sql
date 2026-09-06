-- ⟦f3-ALERTSAMELINE1⟧ / ⟦b4-CRON6⟧ 的**現行事故**:告警器每天叫一次, 而它每次都拿 42501。
--
-- ══ 病灶(不是「忘了 GRANT」, 是一句寫在 migration 裡的【錯的假設】)═══════════
-- ⛔ `20260905170000:110` 逐字(**這一句是錯的, 而它當時看起來完全正確**):
--   ⛔ ~~`-- 🔵 只給 service_role SELECT —— 告警端要讀它。**不給整包。**`~~
-- ✅ 訂正:**告警端不是 `service_role`, 是 `payment_confirmer`。**
-- 🛑 **而那支檔【不改】** —— 它已經貼進正式庫、帳本記著它的 sha,
--    改一個字就會讓部署順序閘把一支**已貼的**報成 PENDING。
--    ⇒ 📌 **訂正住在【這裡】, 而下一個讀那一行的人不會被帶到這裡來** ——
--      那是這種訂正法的**已知代價**, 不是疏漏。板列 ⟦f3-ALERTSAMELINE1⟧ 是第二個落點。
-- 而**它的上一行**逐字:
--   `REVOKE ALL ON public.pcm_acl_drift_status FROM payment_confirmer;`
-- 🛑 **那支 migration 把「告警端」認成 `service_role`, 於是親手收掉了真正會來讀它的那個角色。**
--    告警讀取器 `PgAnomalyAlertReaderAdapter.ts` 檔頭逐字「**server-only + payment_confirmer 窄權**…
--    持 `PAYMENT_CONFIRMER_DB_URL`」⇒ 它連進來的身分是 `payment_confirmer`, 從來不是 service_role。
-- 三支健康度函式(09-04 / 09-05 同一批)是**同一個假設**:只 `GRANT … TO service_role`。
--
-- ══ 後果(而它今天正在發生)═══════════════════════════════════════════════
-- 2026-09-06 01:00 UTC 那一發 `GET /api/cron/anomaly-alert` 回 **503**, 路由自己印四行 `42501`。
-- 🔬 `public.sweeper_heartbeat` 唯讀實量:`pcm-anomaly-alert`
--    `last_success_at` = 2026-09-05 01:00 · `last_failure_at` = 2026-09-06 01:00 · `consecutive_failures` = 1
--    ⇒ **告警器本人 37 小時沒有成功過。**
-- 🔴 而那個 503 是**對的** —— 路由的四個出口逐字寫著「讀不到 ⇒ 那一格是【查不到】不是【沒有事故】」。
--    📌 **它沒有壞掉, 它在照著設計拒絕替一個它沒量到的世界背書。**
-- 🛑 **而 `cron.job_run_details` 那一側同一時刻印 `status = succeeded`** —— 那是 fire-and-forget,
--    它證的是「請求送出去了」不是「路由做完了」⇒ **兩把尺方向相反, 只有紅的那把是對的。**
--
-- ══ 🔬 分母(不是 log 印的那四支 —— log 只印到它短路之前碰到的那些)═════════
-- 告警讀取器碰的物件逐個問過 `has_function_privilege` / `has_table_privilege`:
--   ⛔ ~~16 支函式裡 13 支早就叫得動~~ 🔴 **[codex 2026-09-06 nit① 訂正]** ⇒ 正確是 **17 支函式 + 1 個 view**,
--      其中 **14 支** `payment_confirmer` 早就叫得動 ⇒ **這就是既有慣例, 本支不是在開新路。**
--   · 少的剛好 **3 支** + **1 個 view** ⇒ 與 log 印的四個**一個不多一個不少**(**這個結論沒有變**)。
--   🔬 我漏掉的那一支是 `get_supplier_sync_stale_counts(integer)`(`20260906340000:208` 已授權該角色)。
--   🔴🔴 **而我漏掉它的方式是今晚第三把死掉的尺, 形狀是新的**:
--      我用 `grep -oE "SELECT public\.[a-z_]+\("` 去數 adapter 碰哪些函式,
--      而那支的名字**住在一個常數裡**(`PgAnomalyAlertReaderAdapter.ts:53`
--      逐字 `const RPC_SYNC_STALE = 'get_supplier_sync_stale_counts';`)⇒ 呼叫點是內插, 沒有那個字面。
--      ⇒ 📌 **一個把名字放進變數的呼叫, 對「比對呼叫點字面」的尺是隱形的** ——
--        而那把尺**不會少印一個警告, 它會少印一整支**, 印出來的 16 看起來像一個完整的分母。
--   🟢 正對照 `get_cancelled_mixed_rail_gap_counts()` ⇒ t · 🔵 負對照 `pcm_acl_approve_latest(text)` ⇒ f
-- ⚠️ **第一發我量錯了, 寫在這裡**:我用 `'name()'` 組零參數簽章去問 `to_regprocedure`,
--    **七支帶參數的函式全印「不存在」** —— 那是**尺死了**不是查無。改成查 `pg_proc.proname` 才拿到真的。
--    📌 而我的正對照**沒有救到我**, 因為**它自己就是零參數的** ⇒ **正對照要與受測對象同形狀才有效。**
--
-- ══ 🛑 這【不是】放寬權限 ═══════════════════════════════════════════════
-- 那三支是 `SECURITY DEFINER` 函式、那一個是 definer view(`security_invoker` 沒開, `20260905170000:51` 明寫刻意)
-- ⇒ **它們正是這個角色被允許的唯一窗口形狀**, 而 13/16 已經這樣做了。
-- 🔴 而本支**一個字都不碰 `anon` / `authenticated` / `PUBLIC`** —— 下面 ④ 逐個斷言它們仍然關著。

BEGIN;

-- ── ① 前置閘:四個物件都要在(不在 ⇒ 停, 不要靜靜跳過)────────────
DO $gate$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_pcm_incident_health()',
    'public.get_search_log_health()',
    'public.get_settle_retry_gaveup_health()'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '前置閘:找不到 % ⇒ 它的 migration 還沒貼, 先貼那支', v_fn;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_views
     WHERE schemaname = 'public' AND viewname = 'pcm_acl_drift_status')
  THEN
    RAISE EXCEPTION '前置閘:找不到 view public.pcm_acl_drift_status ⇒ 20260905170000 還沒貼';
  END IF;
END
$gate$;

-- ── ② 三支健康度函式:給 payment_confirmer EXECUTE ────────────────
GRANT EXECUTE ON FUNCTION public.get_pcm_incident_health()        TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_search_log_health()          TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_settle_retry_gaveup_health() TO payment_confirmer;

-- ── ③ 那個 definer view:給 payment_confirmer SELECT(**只給 SELECT, 不給整包**)──
--    🔵 體例照 `20260905270000` 的教訓:要給某個角色權限的物件, **先 REVOKE ALL 再 GRANT**,
--       否則物件出生自帶的 `Dxtm`(TRUNCATE / REFERENCES / TRIGGER / MAINTAIN)一次都不會被收掉。
REVOKE ALL ON public.pcm_acl_drift_status FROM payment_confirmer;
GRANT SELECT ON public.pcm_acl_drift_status TO payment_confirmer;

-- ── ④ 事後斷言 ────────────────────────────────────────────────
DO $assert$
DECLARE
  v_fn   text;
  v_role text;
BEGIN
  -- ④a 正向:四個都要叫得動 / 讀得到
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_pcm_incident_health()',
    'public.get_search_log_health()',
    'public.get_settle_retry_gaveup_health()'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言④a:payment_confirmer 仍然叫不動 % ⇒ 告警器還是會 42501', v_fn;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
           'payment_confirmer', 'public.pcm_acl_drift_status', 'SELECT') THEN
    RAISE EXCEPTION '斷言④a:payment_confirmer 仍然讀不到 pcm_acl_drift_status';
  END IF;

  -- ④b 🔴 反向 —— **本支最重要的一格**:三個公開角色一個都不准被順手帶進來。
  --     📌 一個「修好了」的 GRANT 與一個「修好了而且多開了一扇門」的 GRANT, 在正向那一格上長得一樣。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_fn IN ARRAY ARRAY[
      'public.get_pcm_incident_health()',
      'public.get_search_log_health()',
      'public.get_settle_retry_gaveup_health()'
    ] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '斷言④b:% 竟然叫得動 % ⇒ 本支不該碰它, 拒繼續', v_role, v_fn;
      END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege(v_role, 'public.pcm_acl_drift_status', 'SELECT') THEN
      RAISE EXCEPTION '斷言④b:% 竟然讀得到 pcm_acl_drift_status ⇒ 拒繼續', v_role;
    END IF;
  END LOOP;

  -- ④c 🔵 而 PUBLIC 那一份要**另外**問 —— `has_*_privilege(<具名角色>, …)` 已經涵蓋它
  --     (具名角色會繼承 PUBLIC 那份)⇒ ④b 若過了, PUBLIC 那份也是關的。
  --     🛑 **這一句是推論不是量測**, 明寫在這裡, 不假裝它是第三格斷言。

  -- ④d 🔵 對照組:證明 ④a 那把尺【不是恆真】—— 一支明確收掉 payment_confirmer 的函式必須回 false。
  IF pg_catalog.has_function_privilege(
       'payment_confirmer', 'public.pcm_acl_approve_latest(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '斷言④d 對照組失敗:pcm_acl_approve_latest 竟然叫得動 ⇒ 那把尺量錯了東西, 拒繼續';
  END IF;
END
$assert$;

COMMIT;

-- ⚠️ 本支證不到什麼(寫在這裡, 不藏):
--   ① `has_table_privilege` **看不到欄級授權**(`revoking-function-execute-in-supabase.md` §3.3)
--      ⇒ ④b 那個 f 對「某個角色只被授了某一欄」這種世界是盲的。今天那張 view 沒有欄級授權, 而**那是我沒查的**。
--   ② 它**證不到告警器下一次會成功** —— 那支路由還有另外三個失敗出口(其中一個是「零管道」)。
--      ⇒ 真正的驗收是**明天 01:00 UTC 那一發之後**, `sweeper_heartbeat` 的 `last_success_at` 有沒有往前跳。
--   ③ 它答不出「這四個之外還有沒有第五個」在**未來**成立 —— 今天那個分母是**這一刻**的。
--   ④ **[codex nit② 補]** **ACL 全綠不代表物件本體與預期一致** —— 前置閘驗的是「存在與部分種類」,
--      不是「正式庫那支的定義與本 repo 這支相同」。同簽章而本體不同 / owner 不同 / 不是 SECDEF /
--      `search_path` 不同 / 那個 view 被改成 `security_invoker = true` —— **四格 ACL 照樣全綠, 而實際查詢會失敗。**
--      🔵 間接路徑也不在斷言裡:`SET ROLE` 切到別的角色、以及**繼承來的**額外權限, 這兩行都清不掉。
--   ⑤ **[codex nit③ 訂正]** ⛔ ~~「那支路由還有另外三個失敗出口」~~ —— **少算了**。
--      現行 route 的 503 分支還有心跳未知、各寄信缺口未知、起始線非法等多個。
--      ⇒ 📌 **補齊這四個權限之後它仍然可能 503, 而那不是本支沒生效。**
