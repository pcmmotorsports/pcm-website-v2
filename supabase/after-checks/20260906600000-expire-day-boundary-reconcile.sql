\set ON_ERROR_STOP on
\echo === expire_unpaid_orders 日界對帳(唯讀;貼前跑一次、貼後跑一次, 比同樣這幾格)===
-- 🔴🔴 **第 0 格是 codex R1 #8 逼出來的**:第一版只有下面那一張表, 而它建在一個 CTE 上
--    ⇒ **函式不存在時 CTE 回零列 ⇒ 查詢照樣成功、五格一格都不印**,
--      而「印了五個 f」與「什麼都沒印」在快速掃過去時長得像同一件事。
--    ⇒ ✅ 先問「找到幾支」, 它**永遠印一列**;同名多載也會在這裡露餡。
\echo --- 0. 先證尺接上了:那支函式找到幾支(期望 1)---
-- 🔴 codex R2 新 #4:第一版只數精確 `(integer)` 那一支 ⇒ **新增了別的簽章時它照樣印 1**。
--    ⇒ 兩個數都要:全部同名幾支 / 其中 `(integer)` 幾支。
SELECT count(*)                                                            AS 同名共幾支,
       count(*) FILTER (WHERE p.pronargs = 1
                          AND p.proargtypes[0]::regtype::text = 'integer') AS 其中integer幾支,
       (count(*) = 1) AS 期望為t
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
-- 🔵 為什麼不用 `::regprocedure`:那個轉型要 `pcm_cron` 的 USAGE, 而唯讀角色沒有
--    (2026-09-06 實測 `ERROR: permission denied for schema pcm_cron`)⇒ 改用 catalog join + 參數型別。

\echo --- 1. 五格對帳 ---
WITH s AS (
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') AS src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders'
     AND p.pronargs = 1 AND p.proargtypes[0]::regtype::text = 'integer'
), f AS (
  SELECT src, pg_catalog.regexp_replace(src, '\s+', '', 'g') AS flat FROM s
)
SELECT
  (pg_catalog.strpos(src,  'Asia/Taipei') > 0)                                        AS a_日界在,
  (pg_catalog.strpos(flat, 'pg_catalog.date_trunc(''day''') > 0)                       AS b_截日在,
  (pg_catalog.strpos(flat, 'o.created_at<pg_catalog.now()-CASEo.payment_channel') > 0) AS c_舊述詞還在,
  (pg_catalog.strpos(src,  '5 days') > 0)                                             AS d_五天還在,
  pg_catalog.md5(flat)                                                                AS e_正規化md5
FROM f;
\echo 貼前期望: a=f b=f c=t d=t e=3a21a5aa1fa0d0f7b8b075c1cacfe85f (e 是 md5 字串, 不是 t/f)
\echo 貼後期望: a=t b=t c=f d=t e=2c4bbe9c55646f5cb9b4fb5347d87b26 (同上)
\echo 🔴 第 0 格【同名共幾支】不是 1, 上面那張表不論印什麼都不可信。

\echo --- 2. 🔴 觀測:剛剛有幾張被逾期取消(codex R3 #5:值班的人要能回答這一題)---
-- 🔴 前兩節答的是「函式長什麼樣」, 而半夜三點值班的人要問的是「**剛剛發生了什麼**」。
--    ⇒ 這一節答:最近 6 小時被 `payment_expired` 取消的單, 按通道分組。
--    🟢 正對照 = 同一張表印「總共有幾張 payment_expired 單(不限時間)」⇒ 兩個數同時為 0
--       才可能是「這張表是空的」, 只有第一個是 0 = 「最近沒發生」。
SELECT o.payment_channel,
       count(*) FILTER (WHERE o.cancelled_at > pg_catalog.now() - interval '6 hours') AS 最近6小時,
       count(*)                                                                       AS 歷來全部,
       max(o.cancelled_at)                                                            AS 最後一張
  FROM public.orders o
 WHERE o.cancelled_reason = 'payment_expired'
 GROUP BY o.payment_channel
 ORDER BY 2 DESC, 3 DESC;
\echo 🔵 兩欄都是 0 ⇒ 可能是「這張表本來就沒有這種單」;只有第一欄是 0 ⇒ 最近沒發生。

\echo --- 3. 🔴 機械判定:形狀必須是【貼前】或【貼後】其中一個世界, 不能是第三種 ---
-- 🔴 codex R3 #6:前面兩節是**印給人看**的 —— 而「印了一張怪表」與「印了一張對的表」
--    在 `rc` 上是同一個 0 ⇒ 📌 **那一格綠是免費的。**
--    ⇒ ✅ 這一段會在**兩個已知世界都不符**時 RAISE, 讓 `rc` 帶訊息。
DO $rc$
DECLARE v_raw text; v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '對帳③:同名函式 % 支(期望 1)⇒ 上面兩節不論印什麼都不可信。', v_n;
  END IF;
  SELECT p.prosrc INTO v_raw
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders'
     AND p.pronargs = 1 AND p.proargtypes[0]::regtype::text = 'integer';
  IF pg_catalog.md5(v_raw) = 'b91dc97700d43dd1015dd31ff6eacdfa' THEN
    RAISE NOTICE '對帳③:線上 = 【貼前】那個世界(20260904230000)。';
  ELSIF pg_catalog.md5(v_raw) = '7e1e6764def6738440a1012cbea44f05' THEN
    RAISE NOTICE '對帳③:線上 = 【貼後】那個世界(20260906600000 日界版)。';
  ELSE
    RAISE EXCEPTION '對帳③:線上是【第三種】世界 —— 原始 md5 = %(既不是 b91dc977… 也不是 7e1e6764…)⇒ 有人改過那支函式, 停下來看。', pg_catalog.md5(v_raw);
  END IF;
END
$rc$;
