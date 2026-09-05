-- 貼後驗收 · `20260905230000`(貼板 25 號 · 重建 `admin_order_list_v`)
--
-- 🔴🔴 **誰跑、用什麼跑**(缺任何一格, 這就不是驗收條件, 只是一句話):
--    · 誰    :線 `-account`(**不是 Sean**)—— 他只負責【貼】那一支 migration
--    · 身分  :唯讀角色(`PCM_READONLY_DATABASE_URL`)
--    · 工具  :`bash scripts/readonly-prod-sql.sh supabase/after-checks/230000-after.sql`
--    · 何時  :Sean 回報「25 號貼好了」之後
-- 🟢 **全程唯讀、零寫入** —— 本檔只有 SELECT。
--
-- ═══ 怎麼讀結果 ═══
--   每一格都印【一列】, 而那一列有一個 `結果` 欄。**四格全 `✅` 才算過。**
--   🔴 任何一格印 `🔴` ⇒ **不要放行 `agent/line-account-csvtax`** ⇒ 貼回來我判。
--
-- ═══ 🛑 這份驗收【證不到】什麼(照實寫)═══
--   · 它證得到 **view 的形狀**, 證不到 **CSV 那半的碼跑起來對不對** —— 那要合了之後打真的匯出。
--   · 它**不驗 PostgREST 的 schema cache** —— 那一格 SQL 這側看不到。
--     (migration 尾端有 `NOTIFY pgrst, 'reload schema'`;真訊號是後台訂單列表打得開。)
--   · 欄數 41 是**貼之前量到的 `orders` 表欄數**。若期間有人給表加欄 ⇒ 這個 41 會過期
--     ⇒ 🔵 所以第 ② 格【同時印表的欄數】, 兩個數一起看, 不要只看 41。

-- ═══ 🔬 這把尺【貼之前】跑過一發, 而那一發就是它的自檢 ═══
--   2026-09-05 15:3x, 25 號**還沒貼**的世界, 唯讀跑一次:
--     ① 🔴 view 沒有 tax_total   (正對照 `id`=t / 負對照 `zzz_not_real`=f ⇒ 尺會動且不亂命中)
--     ② 🔴 view 37 欄 vs 表 41 欄(與我 09-05 稍早量到的一致)
--     ③ ✅ security_invoker=true
--     ④ ✅ pcm_readonly 讀得到
--   ⇒ ✅ ①② **在該紅的世界紅了** ⇒ 那兩格是活的。
--
-- 🔴🔴 **而 ③④ 在【貼之前】就是綠的** —— 那不是它們壞了, 是它們在回答**另一個問題**:
--    ①② 答「**貼了沒**」· ③④ 答「**貼壞了沒**」(DROP 有沒有帶走 security_invoker 與 ACL)。
-- 🛑 **⇒ 不可以拿「四格全綠」當成「25 號貼成功了」的證據** ——
--    ③④ 在兩個世界印同一個東西, 它們對「貼了沒」**零判別力**。
--    **判「貼了沒」的只有 ①②。**

\pset pager off

\echo ''
\echo '=== ① admin_order_list_v 有沒有 tax_total(帶正負對照)==='
SELECT
  CASE WHEN bool_or(c.column_name = 'tax_total') THEN '✅ view 有 tax_total'
       ELSE '🔴 view 沒有 tax_total —— 25 號沒貼成功, 不要放行' END AS 結果,
  -- 🔬 正對照:一個【一定在】的欄。它若也是 f ⇒ 這把尺根本沒讀到那支 view。
  bool_or(c.column_name = 'id')          AS 正對照_id必須為t,
  -- 🔬 負對照:一個【一定不在】的欄。它若是 t ⇒ 這把尺會亂命中。
  bool_or(c.column_name = 'zzz_not_real') AS 負對照_必須為f
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'admin_order_list_v';

\echo ''
\echo '=== ② view 的欄數 vs orders 表的欄數(兩個數一起看)==='
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_order_list_v') AS view欄數,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders')             AS 表欄數,
  CASE WHEN (SELECT count(*) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='admin_order_list_v')
          = (SELECT count(*) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='orders')
       THEN '✅ 兩邊一樣多 —— view 追上表了'
       ELSE '🔴 兩邊不一樣 —— view 又落後了(或表被加了欄), 貼回來我判' END AS 結果;

\echo ''
\echo '=== ③ security_invoker 有沒有留著(RLS 用呼叫者身分判)==='
-- 🛑 這一格若掉了, view 會用【建它的人】的身分讀 ⇒ RLS 形同虛設。
SELECT
  CASE WHEN c.reloptions::text LIKE '%security_invoker=true%' THEN '✅ security_invoker=true'
       ELSE '🔴 security_invoker 不見了 —— 這是權限問題, 立刻停下' END AS 結果,
  c.reloptions AS 實際值
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname='admin_order_list_v';

\echo ''
\echo '=== ④ 唯讀角色還讀得到這支 view 嗎(DROP+CREATE 會帶走 ACL)==='
-- 🔬 正對照:同一把尺去問一支我知道它讀得到的表。兩格都 f ⇒ 是尺壞了, 不是權限掉了。
SELECT
  CASE WHEN pg_catalog.has_table_privilege('pcm_readonly','public.admin_order_list_v','SELECT')
       THEN '✅ pcm_readonly 讀得到' ELSE '🔴 ACL 掉了 —— DROP 帶走的沒補回來' END AS 結果,
  pg_catalog.has_table_privilege('pcm_readonly','public.orders','SELECT') AS 正對照_orders必須為t;

\echo ''
\echo '🛑 四格全 ✅ 才算過。任一格 🔴 ⇒ 不要放行 agent/line-account-csvtax, 貼回來我判。'
