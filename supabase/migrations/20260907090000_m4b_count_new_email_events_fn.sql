-- ⟦b4-EMAILTRIAGE⟧ 甲-3 ①:排信閘的分母 —— **問一個數, 不問一堆列。**
--
-- ══ 為什麼要有這支函式(它取代的東西, 錯在哪)═══════════════════════════════
-- 排信前要擋「一次寄太多」, 分母必須是「會變成新的一列」的數量。
-- ⛔ ~~第一版:用掃描回來的列數~~ —— codex `gpt-6-astra` 2026-09-07 12⑤ 打掉:
--    掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回 `duplicate` 的舊列
--    ⇒ 20 張撞鍵的舊單會把 1 封真的該寄的信一起擋掉 ⇒ **防止多寄的閘變成永久少寄**。
-- ⛔ ~~第二版:在 PostgREST 上查「這些鍵哪些存在」~~ —— 同一位審查員 R2 再打掉:
--    🔴 **`.limit(n)` 跨不過伺服器端的 `db-max-rows`**。若那個值是 10, 一發問 50 把鍵
--    而其中 49 把已存在, 也只回 10 列 ⇒ 新事件 1 被算成 **40** ⇒ 又是誤擋。
--    而**分批只降低機率, 沒有解掉它**;`db-max-rows` 我也沒有一個有判別力的量法讀得到
--    (SQL session 問 `current_setting('pgrst.db_max_rows', true)` 回空,
--     🔵 而同一發的負對照問一個現造的設定名**也回空** ⇒ 那個讀數沒有判別力)。
-- ✅ **第三版(本支)**:改問一個**整數**。一列回來 ⇒ 📌 **`db-max-rows` 與 URL 長度
--    兩個問題同時消失**(RPC 走 POST body, 鍵不進查詢字串)。
--
-- ══ 🛑 這支函式證不到什麼 ═══════════════════════════════════════════════════
-- ① 它答的是**呼叫的那一刻**。閘是「> N 就擋」⇒ 兩個方向的後果是:
--    · **多報**(這個數比實際大)⇒ **誤擋**, 那一種信本輪 0 排。
--      來源:有人插進同一把鍵 · 既有列被改成候選鍵 · 快照看不到稍後提交的 INSERT ·
--      RLS 隱藏既有列 · 讀到落後副本。🔵 要一直卡住需要【持續】多報, 單次競態下一輪就好。
--    · **少報**(這個數比實際小)⇒ **漏擋**, 可能超排。
--      來源:那一列被刪(`revoke_manual_cancel_notice`, `20260906930000:122` 逐字 DELETE)·
--      🔴 那一列的鍵被【退休】(`markSkippedShipmentVoided` / `markSkippedTrackingSuperseded`
--      把舊鍵改成 `…:voided:` / `…:superseded:` ⇒ 原鍵釋放)
--      ⇒ 數的時候「20 新 + 1 舊 = 20」放行, 而那把舊鍵退休之後實際插進去 **21** 列。
--    ⚠️ **這兩句 2026-09-07 訂正過**:⛔ ~~多報 = 該擋而沒擋~~ —— 我把後果寫反了(codex 抓到)。
--    ⇒ 📌 **快照數對, 不等於實際新增量有保證。**冪等仍然只由唯一鍵 `(event_type, dedup_key)` 守。
-- ② 它**不看** `status` —— 任何狀態的列都算「已存在」, 因為唯一鍵不分狀態。
-- ③ 它**不驗**那些鍵是不是照 `composeEvent` 算出來的 —— 那是呼叫端的責任(adapter 保證)。

BEGIN;

-- ── 前置閘:目標表要在(不在 ⇒ 停)────────────────────────────────
DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'email_outbox' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION '前置閘:public.email_outbox 不存在 ⇒ 本支沒有對象, 拒繼續';
  END IF;
END
$gate$;

-- 🔵 **SECURITY INVOKER(預設), 刻意不用 DEFINER**:唯一的呼叫端是 service_role,
--    它本來就讀得到 `email_outbox`。用 DEFINER 會**多給一條繞過 RLS 的路**, 而那條路
--    本片一格都不需要。⇒ 需求最小的那個形狀。
-- 🔵 `STABLE` 不是 `IMMUTABLE`:它讀表, 同一組參數在不同時刻會回不同的值。
-- 🔴 **裸 `CREATE`, 不是 `CREATE OR REPLACE`** —— 它是新物件, 撞名要【當場紅】。
--    `OR REPLACE` 會把一個我不知道存在的同名函式靜靜蓋掉, 而我的 REVOKE 與斷言照樣綠。
CREATE FUNCTION public.pcm_count_new_email_events(
  p_event_type text,
  p_keys text[]
) RETURNS integer
LANGUAGE sql
STABLE
AS $fn$
  -- 🔴 **先去重再數** —— 同一批裡若有重複的鍵, 不去重會把同一把鍵算成兩個新事件,
  --    而那會讓排信閘看到的候選比實際多 ⇒ 擋太多。
  --    (`SELECT DISTINCT` 那一層就是它;拿掉 ⇒ 拋棄式 PG 的突變格會紅。)
  WITH wanted AS (
    SELECT DISTINCT k AS dedup_key
      FROM pg_catalog.unnest(COALESCE(p_keys, ARRAY[]::text[])) AS k
     WHERE k IS NOT NULL
  )
  SELECT COALESCE(pg_catalog.count(*), 0)::integer
    FROM wanted w
   WHERE NOT EXISTS (
     SELECT 1 FROM public.email_outbox e
      WHERE e.event_type = p_event_type
        AND e.dedup_key = w.dedup_key
   );
$fn$;

COMMENT ON FUNCTION public.pcm_count_new_email_events(text, text[]) IS
  '⟦b4-EMAILTRIAGE⟧ 甲-3:這批 (event_type, dedup_key) 裡有幾個【還不存在】。'
  '排信批次上限閘的分母。回一個整數 ⇒ 不受 PostgREST db-max-rows 與 URL 長度影響。'
  '🛑 它答的是呼叫的那一刻;冪等仍只由唯一鍵守。';

-- ── 收權:只有 service_role 叫得動 ──────────────────────────────
-- 🔴 **新物件出生就自帶 PUBLIC EXECUTE** ⇒ 不 REVOKE 的話 anon 也叫得動,
--    而那會讓一個沒登入的人**問得出「這張單排過信沒有」**(存在性洩漏)。
REVOKE ALL ON FUNCTION public.pcm_count_new_email_events(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_count_new_email_events(text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_count_new_email_events(text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_count_new_email_events(text, text[]) TO service_role;

-- ── 事後斷言:三個角色逐一問(正一格 + 反兩格)────────────────────
-- 🛑 斷言問的是【量到的結果】, 不是「我上面寫了 GRANT」——
--    `GRANT` 打錯簽名一樣是綠的, 而那時這支函式的權限是預設值。
DO $acl$
DECLARE
  -- 🔵 **宣告式清單**(`scripts/migration-static-checks.sh` 檢查③ 要的那一份):
  --    本支新建的可授權物件逐個列出來。少列一個 ⇒ 那道閘會叫「有漏列」——
  --    它防的是「忘記收權」, 而**它只檢查你列出來的**, 所以也防不到「忘記列」。
  v_functions text[] := ARRAY[
    'public.pcm_count_new_email_events(text, text[])'
  ]::text[];
BEGIN
  IF pg_catalog.array_length(v_functions, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '斷言:本支只該新建 1 支函式, 清單卻有 % 個 ⇒ 清單與實作分岔',
      pg_catalog.array_length(v_functions, 1);
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role',
           'public.pcm_count_new_email_events(text, text[])'::pg_catalog.regprocedure,
           'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 pcm_count_new_email_events ⇒ 排信閘會在執行期才錯, 拒繼續';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon',
       'public.pcm_count_new_email_events(text, text[])'::pg_catalog.regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 pcm_count_new_email_events ⇒ 存在性洩漏, 拒繼續';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'public.pcm_count_new_email_events(text, text[])'::pg_catalog.regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):authenticated 竟然叫得動 pcm_count_new_email_events ⇒ 存在性洩漏, 拒繼續';
  END IF;
END
$acl$;

COMMIT;
