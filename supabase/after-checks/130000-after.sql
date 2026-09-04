\pset pager off
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
BEGIN;
  SELECT (public.admin_create_manual_order(
            (SELECT id FROM public.customers LIMIT 1),
            pg_catalog.gen_random_uuid(),
            (SELECT id FROM public.staff WHERE is_active LIMIT 1),
            'manual_phone', 'bank_transfer', 'home',
            '{"name":"對帳用","phone":"0900000000","address":"對帳用"}'::jsonb,
            '{"type":"none"}'::jsonb, 0,
            '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
            E'  a@b.co\n'
          ) ->> 'order_id')::uuid AS 建出來的單;
  SELECT o.notification_email AS trimmed
    FROM public.orders o
   ORDER BY o.created_at DESC LIMIT 1;
ROLLBACK;

\echo '=== ⑤ 負對照:留白那一發要進 NULL, 不是空字串 ==='
\echo '    blank_is_null 那一格要印 t。若印 f ⇒ CHECK orders_notification_email_valid 會擋掉整張單'
BEGIN;
  SELECT (public.admin_create_manual_order(
            (SELECT id FROM public.customers LIMIT 1),
            pg_catalog.gen_random_uuid(),
            (SELECT id FROM public.staff WHERE is_active LIMIT 1),
            'manual_phone', 'bank_transfer', 'home',
            '{"name":"對帳用","phone":"0900000000","address":"對帳用"}'::jsonb,
            '{"type":"none"}'::jsonb, 0,
            '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK2","unit_price":1,"quantity":1,"spec":{}}]'::jsonb,
            '   '
          ) ->> 'order_id') IS NOT NULL AS 建得出來;
  SELECT (o.notification_email IS NULL) AS blank_is_null
    FROM public.orders o ORDER BY o.created_at DESC LIMIT 1;
ROLLBACK;

\echo '=== 🛑 這份對帳【證不到】什麼 ==='
\echo '  · ④⑤ 走 ROLLBACK ⇒ 證得到函式跑得動, 證不到 trigger 與下游收得到'
\echo '  · 它沒有驗 email 格式(本函式刻意不驗, 由 CHECK 擋;錯字的訊息會是約束名 —— 已知)'
\echo '  · ③ 是字面尺 ⇒ 對「換一種寫錯的方式」失明, 例如把 NULLIF 拼成另一個不存在的名字'
\echo '  · 它答不出片 E 送過來的形狀對不對 —— 那要等 E 上線後另外量'
