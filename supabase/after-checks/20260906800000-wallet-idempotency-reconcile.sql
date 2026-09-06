\set ON_ERROR_STOP on
\echo === ⟦b4-WALLETDEDUPE⟧ 對帳(唯讀;貼前跑一次、貼後跑一次)===

\echo --- 0. 先證尺接上了:那支函式找到幾支(期望 1)---
-- 🔴 這一格的判定**由結果決定**, 不是無條件印(2026-09-06 板 53 踩過:一句寫死的
--    「不是 1 ⇒ 不可信」在計數正常時照樣印, 就印在那張表下面)。
SELECT p.proname, count(*) AS 同名幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet'
 GROUP BY p.proname;
DO $lbl$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '🔴 第 0 格:同名 % 支(期望 1)⇒ 下面每一節不論印什麼都不可信。', v_n;
  END IF;
  RAISE NOTICE '🟢 第 0 格 = 1 ⇒ 下面的表可信。';
END
$lbl$;

\echo --- 1. 🔴 四個維度一起看(只比 body 會漏掉三個)---
-- 🛑 `md5(prosrc)` **只涵蓋 body**。`search_path` 住在 `proconfig`、權限住在 `proacl`、
--    說明住在 COMMENT —— 那三個都可能被 `CREATE OR REPLACE` 換掉而 body md5 完全不動。
SELECT pg_catalog.md5(p.prosrc)                                             AS body_md5,
       coalesce(p.proconfig::text, '(NULL)')                                 AS proconfig,
       p.prosecdef                                                           AS 是SECDEF,
       pg_catalog.md5(coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'(無)')) AS comment_md5,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')   AS sr叫得動,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon叫得動
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';
\echo 貼前期望 body=ad55861bb449dfc98ae6630dceea546f comment=c12448e69f8ac5b8a6fd2a8a3adb40a7
\echo 貼後期望 body=ae2567393ca47e550ebe501644234d8a comment=2c3abd8cf084d7b5e08bc7cc97ce610f
\echo 兩個世界都期望:proconfig 欄印出來要是 search_path 等於一對空的雙引號(psql 的 echo 吃不了跳脫字元, 所以這裡用講的)· 是SECDEF=t · sr叫得動=t · anon叫得動=f

\echo --- 2. 欄位與索引在不在(貼後才有)---
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='customer_wallet_ledger'
           AND column_name='request_id')                        AS 有request_id欄,
       (SELECT coalesce(max(indexdef),'(無)') FROM pg_catalog.pg_indexes
         WHERE schemaname='public' AND tablename='customer_wallet_ledger'
           AND indexname='customer_wallet_ledger_idempotency_uidx') AS 索引定義;

\echo --- 3+4. 🔴 只有【貼後】才問得出來的兩節(貼前這一欄根本不存在)---
-- 🛑 這支對帳要在**兩個世界都跑得動** —— 貼前 `request_id` 欄不存在,
--    直接寫 `WHERE request_id …` 會當場 `column does not exist`(第一版就是這樣紅的)。
-- ⇒ ✅ 用動態 SQL, 而**沒有那一欄時明說「這一節跳過」, 不要印一個 0 假裝問過了**。
DO $obs$
DECLARE
  v_has integer;
  v_keyed bigint; v_null bigint; v_all bigint; v_dup bigint;
BEGIN
  SELECT count(*) INTO v_has FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customer_wallet_ledger' AND column_name='request_id';
  IF v_has = 0 THEN
    RAISE NOTICE '⏭️ 第 3+4 節【跳過】:request_id 欄還不存在 ⇒ 這是【貼前】世界。';
    RAISE NOTICE '   🛑 這裡沒有印 0 —— 因為「沒有那一欄」與「有欄而是 0」是兩件事。';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FILTER (WHERE request_id IS NOT NULL),
                  count(*) FILTER (WHERE request_id IS NULL),
                  count(*) FROM public.customer_wallet_ledger'
     INTO v_keyed, v_null, v_all;
  RAISE NOTICE '第 3 節:有冪等鍵的列 = % / 舊列或直插的列 = % / 全部 = %', v_keyed, v_null, v_all;
  RAISE NOTICE '   🛑 有鍵的列數就是分母 —— 它是 0 的時候, 「沒有重複入帳」這句話【沒有分母】。';

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.customer_wallet_ledger
             WHERE request_id IS NOT NULL
             GROUP BY customer_user_id, request_id HAVING count(*) > 1) t'
     INTO v_dup;
  IF v_dup <> 0 THEN
    RAISE EXCEPTION '第 4 節:同一位客人 + 同一把鍵有 % 組出現多列 ⇒ 唯一索引沒有生效, 停下來看。', v_dup;
  END IF;
  RAISE NOTICE '第 4 節:同客人同鍵重複 = 0 組。';
  IF v_keyed = 0 THEN
    RAISE NOTICE '   ⚠️ 而**上面那個 0 沒有判別力** —— 有鍵的列是 0, 這一節構造不出反例。';
  ELSE
    RAISE NOTICE '   🟢 有 % 列帶著鍵 ⇒ 這個 0 是有分母的。', v_keyed;
  END IF;
END
$obs$;

\echo --- 5. 機械判定:【四個】世界相關維度必須整組在同一邊 ---
DO $rc$
DECLARE v_body text; v_cmt text; v_cfg text; v_col integer; v_idx integer;
BEGIN
  SELECT pg_catalog.md5(p.prosrc),
         pg_catalog.md5(coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'(無)')),
         coalesce(p.proconfig::text,'(NULL)')
    INTO v_body, v_cmt, v_cfg
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';

  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customer_wallet_ledger' AND column_name='request_id';
  -- 🔴 codex #9:原本只數**名稱** ⇒ 換一個同名而定義錯的索引照樣算 1。
  --    ⇒ 改成把 `indexdef` 撈出來, 下面逐字比 `UNIQUE` 與那個 predicate。
  SELECT count(*) INTO v_idx FROM pg_catalog.pg_indexes
   WHERE schemaname='public' AND tablename='customer_wallet_ledger'
     AND indexname='customer_wallet_ledger_idempotency_uidx'
     AND indexdef LIKE '%UNIQUE INDEX%'
     -- 🔴 **欄位也要比**(codex R2 ①):只比 UNIQUE 與 predicate 的話,
     --    一個**同名而建在 `id` 上**的索引照樣算數 —— 而 RPC 的衝突目標就用不到它了
     --    ⇒ `ON CONFLICT` 會在**執行期**炸, 而這支對帳說「一切正常」。
     AND indexdef LIKE '%(customer_user_id, request_id)%'
     AND indexdef LIKE '%WHERE (request_id IS NOT NULL)%';

  -- 🔴 codex #9:這一節原本只問 body/COMMENT/欄/索引 ⇒ **撤掉 service_role 權限、
  --    或把函式改成 SECURITY INVOKER, 它照樣說「在貼後世界」**。⇒ 補這三格。
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='admin_adjust_wallet') THEN
    RAISE EXCEPTION '對帳④a:admin_adjust_wallet 不再是 SECURITY DEFINER ⇒ 有人動過它。';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
        'public.admin_adjust_wallet(uuid,text,integer,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '對帳④b:service_role 叫不動 admin_adjust_wallet ⇒ 後台會整條壞掉。';
  END IF;
  IF pg_catalog.has_function_privilege('anon',
        'public.admin_adjust_wallet(uuid,text,integer,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '對帳④c:anon 叫得動 admin_adjust_wallet ⇒ 動錢的 RPC 對未登入者開著。';
  END IF;

  -- 🔴 這一格獨立於世界:`search_path` 在**兩個世界都該是空字串**。
  --    它若被打回 `public, pg_temp`, 上面的 body md5 仍可能對 —— 那正是本片最怕的那個假綠。
  IF v_cfg IS DISTINCT FROM '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '對帳⑤:proconfig = %(兩個世界都期望 {"search_path=\"\""})⇒ 有人把 20260905110000 那道強化打回去了。', v_cfg;
  END IF;

  IF v_body = 'ad55861bb449dfc98ae6630dceea546f'
     AND v_cmt = 'c12448e69f8ac5b8a6fd2a8a3adb40a7'
     AND v_col = 0 AND v_idx = 0 THEN
    RAISE NOTICE '對帳⑤:四個世界維度(body / COMMENT / 欄 / 索引)整組在【貼前】那個世界(20260716210000)。';
  ELSIF v_body = 'ae2567393ca47e550ebe501644234d8a'
     AND v_cmt = '2c3abd8cf084d7b5e08bc7cc97ce610f'
     AND v_col = 1 AND v_idx = 1 THEN
    RAISE NOTICE '對帳⑤:四個世界維度(body / COMMENT / 欄 / 索引)整組在【貼後】那個世界(20260906800000)。';
  ELSE
    -- 🔵 **數字訂正**(R2 nit 7):這個 IF 比的是 **4** 個世界相關維度;
    --    另外那幾格(SECDEF / service_role / anon / proconfig)在上面**各自 RAISE**,
    --    而它們**不隨世界改變** ⇒ 不屬於「哪一邊」這個判斷。⛔ ~~原本寫「六個維度」~~。
    RAISE EXCEPTION '對帳⑤:**不在同一個世界**(body=% / comment=% / 欄=% / 索引=%)⇒ 貼到一半, 停下來看。',
      v_body, v_cmt, v_col, v_idx;
  END IF;
END
$rc$;
