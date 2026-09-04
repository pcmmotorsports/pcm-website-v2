\pset pager off
-- 🔴🔴 **`ON_ERROR_STOP` 不可省**(codex 2026-09-05 finding 3):沒有它, ④ 炸了之後
--    psql 會**繼續往下跑並且回傳成功狀態** ⇒ 🛑 **這份對帳最重要的那一格失敗, 而整體印綠。**
--    📌 那正是本片一路撞的同一個形狀:**一份會叫的檢查, 沒有人聽它叫。**
\set ON_ERROR_STOP on
--
-- ═══ 🔴🔴 誰跑這支、用什麼身分(R3 2026-09-05 抓到:原本【沒有人跑得動】)═══
--   · 函式的 EXECUTE **只給 `service_role`** ⇒ 🛑 用唯讀角色 `pcm_readonly`
--     (`~/pcm-mailbox/0905查證/run.sh`)跑 ④⑤⑥ 會拿到 **42501**,
--     而那**不是**「函式壞了」—— 它是「這條連線沒有權限」。**兩者印不同的碼, 不要讀混。**
--   · Supabase 的 SQL Editor **吃不了 `\pset` / `\set` / `\echo`**(那是 psql 的東西)
--     ⇒ 🛑 **這支檔不能貼進 SQL Editor。**
--   ✅ **正確跑法**:有 `service_role` 或函式 owner 身分的 `psql`:
--       `psql "<連線字串>" -f supabase/after-checks/130000-after.sql`
--     ⇒ **而那條連線字串本窗沒有** —— 這一步要交給拿得到的人跑。
--   📌 **R3 的原話值得留**:「貼完必須跑它」那句寫在 migration 裡, 而**沒有人能執行它**
--     ⇒ **一個寫得很清楚的驗收條件, 與沒有驗收條件, 在結果上是同一件事。**
--
-- 🔴 **另一格 R3 抓到的**:④⑤⑥ 原本送 `'{"type":"none"}'`, 而 G5 只收
--    `personal / company / donate`(那支 migration 的 G5 段)⇒ **每一發在 G5 就 RAISE**,
--    連 email 那一行都走不到。⇒ 已改 `personal`(4 處)。
--    📌 **這是本檔檔頭自己講的那個病【第二次】發生**:一把在更前面就被擋下的尺,
--       印出來的是那個更前面的錯 —— 而 codex R1 只修了 `user_id`/`line`, 沒看到 `type`。
--
-- 🔴 唯讀。`20260905130000`(片 D:`admin_create_manual_order` 第 11 參)貼後對帳。
--
-- 🛑🛑 **這支檔存在的理由, 是那支 migration 的五道自我斷言【全部是 catalog 形狀】**
--    (to_regprocedure / count / has_function_privilege / obj_description)
--    ⇒ 它們答得出「函式在不在、有幾支、誰能執行、有沒有 comment」,
--    ⇒ 🔴 **答不出「它跑得動嗎」** —— plpgsql 到【被呼叫】才解析函式名稱。
--    🔬 實錘:第一版把 `NULLIF` 寫成 `pg_catalog.nullif(...)`(那不是函式, 是 SQL 語法構造)
--       ⇒ **apply rc=0、五道斷言全過**, 而每一發建單都會炸
--       `ERROR: function pg_catalog.nullif(text, unknown) does not exist`。
--       (code-reviewer 2026-09-05 must-fix 1 抓到;而那支 migration 自己 `:245-247`
--        逐字警告過這一格 —— **一段正確的警告沒有阻止寫它的人再犯一次。**)
--    ⇒ 📌 **所以「有沒有跑過一發真的呼叫」是這一片的驗收條件, 不是加分題。**

\echo '=== ① 前提:恰好一支(不是「至少一支」)==='
\echo '    這一格要印 1。若印 2 ⇒ 有人用了 CREATE OR REPLACE 加參數 ⇒ 呼叫端會拿到 function is not unique'
SELECT pg_catalog.count(*) AS 幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_create_manual_order';

\echo '=== ② 前提:參數 11 個、其中 1 個有預設 ==='
\echo '    這兩格要印 11 與 1'
SELECT p.pronargs AS 參數數, p.pronargdefaults AS 預設數
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_create_manual_order';

\echo '=== ③ 判準:函式體裡那一行【不含】壞前綴, 而且【含】對的寫法 ==='
\echo '    左格要印 0、右格要印 1。而這是一把【字面尺】—— 它只答得出碼長什麼樣, 答不出跑不跑得動, 那要 ④'
-- 🔴🔴 **判別字面必須含【賦值那一半】`v_notification_email :=`, 不可以只打 `pg_catalog.nullif`。**
--    🔬 實測(拋棄式 PG 17.10):裸打 `pg_catalog.nullif` 對修好的函式回 **4**, 不是 0 ——
--       那 4 次全在**註解裡**(migration `:245`/`:247`/`:446`/`:448` 都在講這個坑),
--       而 `pg_get_functiondef` 把註解一起吐出來。
--    ⇒ 📌 **一把用來防某個錯的尺, 會被【解釋那個錯的文字】觸發** ——
--       而它印出來的是**假警報**, 那比漏報更會動員人去查不存在的洞。
--    ✅ 帶賦值的形狀實測:壞的 **0** / 對的 **1**。
SELECT (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(p.oid), 'v_notification_email := pg_catalog\.nullif', 'g')) AS 壞前綴幾次,
       (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(p.oid), 'v_notification_email := NULLIF', 'g')) AS 對的寫法幾次
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_create_manual_order';

\echo '=== ④ 🔴🔴 唯一有判別力的那一格:【真的呼叫它一次】 ==='
\echo '    做法:BEGIN → 呼叫 → 讀回那一列的 notification_email → ROLLBACK(零留痕)'
\echo '    trimmed 那一格要印 a@b.co —— 前後空白與尾端換行都要被剝掉'
\echo '    🛑 若這一格印出 function ... does not exist ⇒ 上面 ①②③ 全綠也不算通過'
-- 🔴 **三處輸入是 codex finding 1 訂正的, 而它們原本【走不到 email 那一行】**:
--    · `customers` 的主鍵是 **`user_id`**, 不是 `id`(`20260523034911:15` 逐字)
--    · `p_ship_to` 要的鍵是 **`line`**, 不是 `address`(migration `:241`/`:247`)
--    ⇒ 📌 **一把在更前面就被擋下的尺, 印出來的是【那個更前面的錯】, 而它讀起來像失敗**
--      —— 我原本會以為是 email 那半壞了, 而真正的原因是我根本沒送對參數。
-- 🔴 **回查那一列要綁函式回傳的 `order_id`**(finding 2)——
--    原本用 `ORDER BY created_at DESC LIMIT 1` 撈「最新一張」⇒ 並行建單時會讀到別人的單
--    ⇒ **假綠與假紅都可能**, 而兩者都不會說出自己讀錯了列。
BEGIN;
  CREATE TEMP TABLE _chk ON COMMIT DROP AS
  SELECT ((public.admin_create_manual_order(
            (SELECT c.user_id FROM public.customers c LIMIT 1),
            pg_catalog.gen_random_uuid(),
            (SELECT s.id FROM public.staff s WHERE s.is_active LIMIT 1),
            'manual_phone', 'bank_transfer', 'home',
            '{"name":"對帳用","phone":"0900000000","line":"對帳用地址"}'::jsonb,
            '{"type":"personal"}'::jsonb, 0,
            '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
            E'  a@b.co\n'
          )) ->> 'order_id')::uuid AS oid;
  SELECT o.notification_email AS trimmed
    FROM public.orders o JOIN _chk k ON k.oid = o.id;
ROLLBACK;

\echo '=== ⑤ 負對照:留白那一發要進 NULL, 不是空字串 ==='
\echo '    blank_is_null 那一格要印 t。若印 f ⇒ CHECK orders_notification_email_valid 會擋掉整張單'
BEGIN;
  CREATE TEMP TABLE _chk2 ON COMMIT DROP AS
  SELECT ((public.admin_create_manual_order(
            (SELECT c.user_id FROM public.customers c LIMIT 1),
            pg_catalog.gen_random_uuid(),
            (SELECT s.id FROM public.staff s WHERE s.is_active LIMIT 1),
            'manual_phone', 'bank_transfer', 'home',
            '{"name":"對帳用","phone":"0900000000","line":"對帳用地址"}'::jsonb,
            '{"type":"personal"}'::jsonb, 0,
            '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK2","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
            '   '
          )) ->> 'order_id')::uuid AS oid;
  SELECT (o.notification_email IS NULL) AS blank_is_null
    FROM public.orders o JOIN _chk2 k ON k.oid = o.id;
ROLLBACK;

\echo '=== ⑥ 🔴 指紋那一格:同一把冪等鍵、只改 email ⇒ 必須被判 P858B ==='
\echo '    這一格要印 t。若印 f ⇒ 第 11 參【沒有進指紋】, 而那代表員工改好的 email 會被安靜丟掉'
\echo '    🛑 codex finding 5:拿掉 v_canonical 裡那一行, 上面每一格都照樣綠 —— 只有這一格會紅'
BEGIN;
  CREATE TEMP TABLE _k ON COMMIT DROP AS SELECT pg_catalog.gen_random_uuid() AS rid;
  SELECT public.admin_create_manual_order(
           (SELECT c.user_id FROM public.customers c LIMIT 1), (SELECT rid FROM _k),
           (SELECT s.id FROM public.staff s WHERE s.is_active LIMIT 1),
           'manual_phone', 'bank_transfer', 'home',
           '{"name":"對帳用","phone":"0900000000","line":"對帳用地址"}'::jsonb,
           '{"type":"personal"}'::jsonb, 0,
           '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK3","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
           'first@b.co') IS NOT NULL AS 第一次建得出來;
  DO $chk$
  DECLARE v_sqlstate text;
  BEGIN
    BEGIN
      PERFORM public.admin_create_manual_order(
        (SELECT c.user_id FROM public.customers c LIMIT 1), (SELECT rid FROM _k),
        (SELECT s.id FROM public.staff s WHERE s.is_active LIMIT 1),
        'manual_phone', 'bank_transfer', 'home',
        '{"name":"對帳用","phone":"0900000000","line":"對帳用地址"}'::jsonb,
        '{"type":"personal"}'::jsonb, 0,
        '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK3","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
        'second@b.co');
      RAISE EXCEPTION '⑥ 失敗:同鍵只改 email 竟然沒被擋 ⇒ 第 11 參沒有進指紋';
    EXCEPTION WHEN SQLSTATE 'P858B' THEN
      RAISE NOTICE '⑥ 通過:同鍵不同 email 被判 P858B = t';
    END;
  END
  $chk$;
ROLLBACK;

\echo '=== 🛑 這份對帳【證不到】什麼 ==='
\echo '  · ④⑤ 走 ROLLBACK ⇒ 證得到函式跑得動, 證不到 trigger 與下游收得到'
\echo '  · 它沒有驗 email 格式(本函式刻意不驗, 由 CHECK 擋;錯字的訊息會是約束名 —— 已知)'
\echo '  · ③ 是字面尺 ⇒ 對「換一種寫錯的方式」失明, 例如把 NULLIF 拼成另一個不存在的名字'
\echo '  · 它答不出片 E 送過來的形狀對不對 —— 那要等 E 上線後另外量'
\echo '  · ④⑤⑥ 要 service_role 或 owner 身分;唯讀角色會拿到 42501, 那不是函式壞了'
\echo '  · 它【不驗 PostgREST 快取重載了沒】—— 那一格 SQL 這一側看不到, 要打真的 API 才知道'
\echo '  · ⑥ 的 P858B 是【錯誤碼】不是文案;錯誤訊息換了字它照樣過, 而那是刻意的'
