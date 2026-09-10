-- 回退 20260909120000_m4b_hct_record_submit_grant.sql
-- ⟦ship-HCTSUBMITNOGRANT⟧
--
-- 🔵 **退回去的後果是明確的**:後台那顆「送新竹」回到 2026-09-10 早上的樣子 ——
--    按了印 `permission denied for function admin_record_hct_submit`、**零 HTTP**。
-- ⇒ 📌 **那不是資料壞掉, 是回到一個【擋住】的狀態**, 而擋住的方向是安全的那一側。
-- 🛑 而它**不會**讓任何一箱卡住:擋點在佔位列【之前】⇒ 不會產生 `hct_status=unknown` 的箱。
-- ⚠️ **而上面那兩句只涵蓋【還沒開始】的請求**(codex R1 nit ⑥ 訂正):
--    🔴 **一個【已經寫好 unknown 佔位、正在等新竹回應】的請求, 在這一刻被撤權**
--    ⇒ HTTP 已經送出去了, 而結果**寫不回來** ⇒ 📌 **那一箱會留在 `unknown`。**
--    ⇒ 🛑 **所以退之前要先確認沒有在途的請求** —— 停送、等一輪、再退。
--    ⚠️ 而「零 HTTP」也只對【送出】那條路成立:`unknown` 的箱走的是查詢(`QueryEDELNO_Json`),
--      **它不先寫佔位** ⇒ 那條路不受這道 GRANT 影響, 也不保證零 HTTP。

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  -- ① 目標在不在
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '回退前置閘①:找不到那支函式 ⇒ 簽章不對, 拒繼續';
  END IF;

  -- ② 🔴 **現在真的有那個 GRANT 才退** —— 否則這一發是空跑, 而執行的人會以為自己退了
  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_record_hct_submit(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '回退前置閘②:service_role 本來就叫不動 ⇒ 不必退, 拒空跑';
  END IF;
END
$pre$;

REVOKE EXECUTE ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb)
  FROM service_role;

-- ── 退後斷言 ──────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
BEGIN
  IF pg_catalog.has_function_privilege(
       'service_role', 'public.admin_record_hct_submit(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '回退後斷言①:service_role 還是叫得動 ⇒ 這一發沒有生效';
  END IF;

  -- 🔵 正對照:那把尺不是恆回 false —— 兄弟那支不該被這一發碰到。
  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_hct_reset_unknown_to_draft(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '回退後斷言②(正對照):兄弟那支也叫不動了 ⇒ 這一發退過頭了, 或這把尺壞了';
  END IF;

  -- 🔴🔴 **本體 md5 只【印出來】, 不 RAISE**(codex R1 must-fix ③)。
  -- ⛔ ~~原版:md5 不符 ⇒ RAISE EXCEPTION~~
  -- 🛑 **那個寫法會讓 rollback 在最需要它的時候失效**:
  --    GRANT 貼了之後有人**合法**改過那支函式(哪怕只是在本體裡補一個空白行)
  --    ⇒ md5 不符 ⇒ RAISE ⇒ **整筆交易回滾** ⇒ 📌 **`REVOKE` 也跟著被取消, `service_role` 保留 EXECUTE。**
  --    ⇒ 🎯 **它把「本體早就改過」誤判成「這次 rollback 動到了本體」** —— 兩件事完全不同,
  --      而它用一個會擋住撤權的方式表達 ⇒ **一道為了安全而寫的閘, 在災難當下擋住逃生門。**
  -- ✅ **改法**:歷史版本比對降成 `NOTICE`(給人看), 而**撤權本身不受它影響**。
  --    📌 本檔要保證的是【撤得掉】; 「本體是不是還是那一版」是另一個問題, 而它答不出來就不該否決撤權。
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)');
  IF pg_catalog.md5(v_src) <> 'd88b332249d3a72ff4b3dd9306f0c2ce' THEN
    RAISE NOTICE
      '⚠️ 提醒(不擋):函式體 md5 已不是 2026-09-10 那一版(實得 %)—— 撤權照做了, 而那支函式在這段期間被改過, 請去看一眼。',
      pg_catalog.md5(v_src);
  END IF;

  RAISE NOTICE '回退完成:service_role 不再叫得動 admin_record_hct_submit ⇒ 後台那顆「送新竹」回到擋住的狀態(零 HTTP)。';
END
$post$;

COMMIT;
