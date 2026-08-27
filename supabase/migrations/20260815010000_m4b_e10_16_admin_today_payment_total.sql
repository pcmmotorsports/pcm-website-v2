-- M-4b E10 `#16`:今日對帳「實收」那格的唯讀 RPC(`admin_today_payment_total`)。
--
-- ══ 為什麼需要這支(不是偏好,是實查出來的硬限制)══════════════════════════
-- `order_payments` 對 **service_role 零表權**:
--   `20260810100000_m4b_e10_op1_order_payments_m.sql:410` 逐字
--   `REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;`
-- 而全 repo `grep "GRANT" | grep order_payments` 的命中**全是** COMMENT 字串 / RAISE 訊息 / 函式 EXECUTE,
-- **零一句表級 GRANT**(同表既有 RPC 的 COMMENT `20260811090000:123` 逐字:
-- 「order_payments 對每個非 owner 角色的 SELECT 都是 false(零表權、零 RLS policy)⇒ **不經本支讀不到**」)。
-- ⇒ 首頁那格若直接 `.from('order_payments')`,上線後**每次都 42501**,而全 mock 的單測照樣全綠。
--
-- 🔴 **不能改成對表補 GRANT**:同檔 `:690-701` 有 apply-time 閘 —— 掃 `pg_class.relacl`,
--    出現 owner 以外的 grantee 就 `RAISE`(`P2B20` / `pcm_op1_acl_extra_grantee`)
--    ⇒ 補一句表級 GRANT 會讓**那份既有 migration 下次 apply 整份炸掉**。
--    本支開的是**函式 EXECUTE**、不碰 table 的 `relacl` ⇒ 那道閘不會被觸發。
--
-- ══ 口徑:必須與 TS 端 `sumReceived` 完全一致 ═══════════════════════════════
-- 承重不變式「已收 = SUM(amount)」(`20260810100000:197`;同檔 `:82` 舉 `500-500+500=500`)。
-- 沖銷列帶負值(`:199` `CHECK (amount <> 0)`)、沖銷之沖銷可為正
-- ⇒ **直接加總、不得過濾負列、不得 ABS、不得只算非沖銷列**。
--    一邊算一邊不算 = 兩個數字都對不起來,而且沒有任何錯誤訊號。
--
-- 🔴 **`COALESCE(SUM(...), 0)`**:SQL 的 `SUM()` 在**零列**時回 **NULL 不是 0**,
--    而「今天還沒有任何收款」是**每天早上的常態**、不是邊角案例。
--    少了它,呼叫端拿到 `null` ⇒ 回歸掉 `#16` 驗收條件⑥(零資料顯示 0、無 NaN/undefined),
--    而 mock 一定餵得出數字 ⇒ 單測**照樣全綠**。
--    house 既有同形:`20260523034911:129`、`20260725130100:218`、`20260803150000:776`。
--
-- ══ 為什麼 RPC 不知道「今天」是什麼 ═════════════════════════════════════════
-- 台北日界換算的唯一真相在 `apps/admin/src/lib/dashboard/today-view.ts`。
-- 本支只收一個**半開區間** `[p_from, p_to)` ⇒ SQL 端不會長出第二份日界規格。
-- 兩份規格遲早分岔,而分岔的症狀是**金額對不起來卻沒有任何錯誤**。
--
-- ══ 🔴🔴 授權:`REVOKE FROM PUBLIC` **收不掉 anon** ═══════════════════════════
-- 本庫 `public` schema 對 function 的 `pg_default_acl` 有兩筆(`20260811090000:17-24` 實查紀錄):
-- 函式一建出來,**anon 與 authenticated 就自動持有 EXECUTE**,而 `REVOKE ... FROM PUBLIC`
-- 收不掉它們(PUBLIC ≠ 明確持有 grant 的角色)。
-- ⇒ 下方 REVOKE **逐個點名**四個角色,且檔尾用多層斷言驗,不靠「記得要 REVOKE」。
--
-- ⚠️ `authenticator` 是 NOINHERIT ⇒ 不隱式繼承 service_role 的 EXECUTE,必須 `SET ROLE`
--    (那正是 PostgREST 的正常路徑)⇒ 檔尾對它斷言「無有效 EXECUTE」是過得了的。
--
-- ══ 🔴🔴 為什麼一定要 `STRICT`(adversarial-reviewer 2026-08-15 must-fix,**已實測**)══
-- 少了它:任一參數傳 NULL ⇒ `WHERE` 恆 UNKNOWN ⇒ 零列 ⇒ **`COALESCE` 把它變成「一列 total=0」**
-- ⇒ 呼叫端(`today-read.ts`)只把「回不出列」當失敗 ⇒ **拿到一列 0 就照顯示**
-- ⇒ **畫面「今日實收 NT$ 0」、零錯誤、零告警。**
-- 🔴 那正是本檔 `:193-195` 自己標為「最毒失敗形狀」的同一個形狀,而**閘 ⑤ 守不到參數這條路徑**
--    (它只守 owner 漂移 / FORCE RLS)。
--
-- ✅ **實測**(2026-08-15,本機拋棄式叢集 initdb + PG **17.10**,與正式站同大版;測完即銷毀):
--    同一支函式兩版、同一組測資(500 / -500 / 500):
--      正向對照  正常區間          ⇒ 回 1 列、total = **500**(沖銷照加)
--      無 STRICT `p_from = NULL`   ⇒ 🔴 **回 1 列、total = 0**(= 上面那個災難)
--      有 STRICT `p_from = NULL`   ⇒ ✅ **回 0 列**(呼叫端「回不出列 = 失敗」抓得到)
--    ⚠️ reviewer 自標「只有文件記憶、沒實測」的那一條 ⇒ **現在有實測了。**
--
-- ⚠️ **`STRICT` 救不了「區間顛倒」(`p_from > p_to`)** —— 同一次實測:
--    **兩版都回 1 列、total = 0**。⇒ 那條**不能**靠本函式解
--    (在 `WHERE` 加 `AND p_from < p_to` 也沒用:空集合仍被 `COALESCE` 收成一列 0;
--     要在 SQL 端擋就得換 `LANGUAGE plpgsql` + `RAISE`,**而那會撞檔尾閘 ④ 的 `lanname = 'sql'` 斷言**)。
--    ⇒ **現況靠呼叫端保證**:`today-view.ts` 的 `todayTaipeiRange` 由「日界 / 日界 + 1 天」構造,
--      結構上 `from < to`。**那是一條沒有守門的保證** —— 列為誠實缺口,見下。
--
-- ══ 誠實邊界 ═══════════════════════════════════════════════════════════════
-- 🔴 **本檔零正式庫驗證。** 已做到 / 仍不證,分開講 —— 不要把兩者讀成同一句:
--    ✅ **已在丟棄式 PG 17.10 叢集把整支 apply 過,檔尾五道閘全過**(同 `:50-55` 那組實測,測完即銷毀)。
--       突變對照:把 `STRICT` 註解掉重跑 ⇒ **新閘當場紅、訊息就是預期那條**
--       ⇒ **「apply 得過」與「閘會紅」都不再是從字面推的。**
--    🔴 **仍不證**:正式庫的 owner / ACL / 既有資料下也過;**不證 `42501` 真的消失**。
--       要 100% 確定只需一句
--       `select has_table_privilege('service_role','public.order_payments','SELECT');`
--       —— 那要正式庫連線,施工端沒有。⇒ 出口是 `#502` 那份 apply 清單,不是本檔。
--    ⚠️ **本段原本寫「施工端無 DB 連線 ⇒ 不證 apply 得過」** —— 前半是環境事實、**後半是假的推論**:
--       引擎行為(STRICT 語意 / 閘會不會誤紅)本機測得到,真做不到的只有正式庫的**狀態**。
--       **兩者被我當成同一句話用了一整晚**,地圖見 `~/pcm-mailbox/A-043-STOP.md`。
-- ⚠️ 檔尾各閘只在 **apply 當下**跑;事後才被改動的情況它看不到。
--
-- ══ rollback ═══════════════════════════════════════════════════════════════
-- 還沒 apply ⇒ 刪檔 + `git revert`,DB 一個位元組沒動。
-- 已 apply 要退 ⇒ `DROP FUNCTION IF EXISTS public.admin_today_payment_total(timestamptz, timestamptz);`
--    🔴 但**先退應用層再 DROP**:呼叫端已改走 `.rpc(...)`,先 DROP 會讓首頁那格變 42883。
--    (完整說明見 `docs/specs/2026-08-15-e10-16-payment-total-rpc-plan.md` §5a)

CREATE FUNCTION public.admin_today_payment_total(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (total bigint, row_count bigint)
LANGUAGE sql
STABLE                      -- 讀表 ⇒ 不得 IMMUTABLE(會被折成過期常數)、不得 VOLATILE(表示會寫)
STRICT                      -- 🔴🔴 見下方「為什麼一定要 STRICT」
SECURITY DEFINER
SET search_path = ''        -- 逐字存成 `search_path=""`;檔尾照這個字面比
AS $fn$
  SELECT COALESCE(SUM(p.amount), 0)::bigint AS total,
         count(*)::bigint                   AS row_count
    FROM public.order_payments p
   WHERE p.received_at >= p_from
     AND p.received_at <  p_to
$fn$;

COMMENT ON FUNCTION public.admin_today_payment_total(timestamptz, timestamptz) IS
  'M-4b E10 #16 今日實收加總(唯讀、零寫入、SECURITY DEFINER、search_path='''')。'
  '存在理由:order_payments 對 service_role 零表權(20260810100000:410)⇒ 不經本支讀不到;'
  '而對表補 GRANT 會觸發同檔 :690-701 的 apply-time 閘、把那份 migration 炸掉。'
  '🔴 口徑:直接 SUM,沖銷列(負)與沖銷之沖銷(正)都照加 —— 與 TS 端 sumReceived 同口徑,'
  '不得過濾負列、不得 ABS。改動任一端都要同時改另一端,否則兩個數字都對不起來且零訊號。'
  '🔴 零列回 0 不回 NULL(COALESCE)—— 「今天還沒收到錢」是每天早上的常態,不是邊角案例。'
  '🔴 區間是半開 [p_from, p_to);「今天」的定義**不在本支**,在 today-view.ts(避免第二份日界規格)。'
  '🔴 日窗語意(adversarial-reviewer F3):沖銷列的 received_at 跟著**被沖的那一筆**(20260812150000:492)'
  '⇒ 今天沖掉昨天的誤登,**今天這格一毛不動、被改寫的是昨天**;'
  '且「今天 18:00 看到的今日實收」與「明天回頭看同一天」可能不同。這是口徑的性質,不是 bug。'
  '(此段原本只寫在 today-view.ts —— 而用 \df+ 讀 DB 的人只看得到本 COMMENT。)'
  '🔴 依 received_at(實際收到錢的時點,20260810100000:427 COLUMN COMMENT 逐字「對帳看這欄」),不是 created_at。'
  'row_count 用途:呼叫端記錄筆數 + 作為本支真的跑過的證據;它**不是**截斷旗標(SQL 端加總無 max-rows 問題)。'
  '授權粒度誠實話:讀路徑只有全域登入閘、無角色檢查 ⇒ 任何登入後台者可讀今日收款總額。';

-- ── ACL:逐個點名 REVOKE(PUBLIC 收不掉 anon,見檔頭)────────────────────────
REVOKE ALL ON FUNCTION public.admin_today_payment_total(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_today_payment_total(timestamptz, timestamptz) TO service_role;

-- ── 結構斷言(同一交易內;任一紅 = 整片回滾、不留半套)──────────────────────
DO $gate$
DECLARE
  v_fn  oid := 'public.admin_today_payment_total(timestamptz, timestamptz)'::regprocedure;
  v_bad text;
BEGIN
  -- ① proacl 不得是 NULL。
  --    🔴 這是**地基**不是多餘一層:REVOKE 沒執行過時 proacl 是 NULL,而 `aclexplode(NULL)` 回**零列**
  --    ⇒ 下面 ② 的閉世界斷言會**直接通過**,但那正是「預設 PUBLIC 可 EXECUTE」的狀態。
  --    少了這條,② 是恆真格。(照抄 `20260811090000:142-149` 的理由。)
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION '#16:proacl 是 NULL ⇒ REVOKE 沒執行過,函式預設 PUBLIC 可 EXECUTE'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_proacl_null';
  END IF;

  -- ② EXECUTE 閉世界:只准 {owner, service_role},且**不得帶 WITH GRANT OPTION**
  --    (`is_grantable` 那半不能少 —— 允許集合內的角色帶了它就能再轉授出去)。
  SELECT pg_catalog.string_agg(y.grantee, ', ' ORDER BY y.grantee) INTO v_bad
    FROM (
      SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid = v_fn
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              OR g.is_grantable)
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#16 EXECUTE 閉世界被打破(%)⇒ ①出現 {owner, service_role} 以外的 grantee '
                    '②或允許集合內的角色帶了 WITH GRANT OPTION', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_execute_closed_world';
  END IF;

  -- ③ 有效權限實測 —— ①② 只看 ACL 字面,這層才擋得住「透過成員關係間接拿到」。
  SELECT pg_catalog.string_agg(x.r, ', ' ORDER BY x.r) INTO v_bad
    FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r, v_fn, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#16:這些角色有效拿得到 EXECUTE(%)⇒ 登出訪客可讀今日收款總額', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_execute_too_wide';
  END IF;

  -- ③b 🔴 `has_function_privilege` **只驗立即可用的權限**,驗不到「`SET ROLE` 之後才拿到」那條路
  --     (PG16+ `GRANT … WITH SET TRUE`)。`20260811090000:190-197` 實查正式站:
  --     `pg_has_role('authenticator','service_role','SET')` = true 而 `has_function_privilege` = false
  --     ⇒ ③ 對 authenticator 是**盲的**,只是它那條路是 PostgREST 的正常路徑、刻意允許。
  --     🔴 **不只擋「達得到 service_role」,也擋「達得到 owner」** —— owner 是 SECDEF 的執行身分,
  --        達得到 owner 等於拿到的比 service_role 更多;而 authenticator 的豁免**只豁免 service_role**。
  SELECT pg_catalog.string_agg(y.msg, '; ' ORDER BY y.msg) INTO v_bad
    FROM (
      SELECT x.r || '→service_role' AS msg
        FROM unnest(ARRAY['anon','authenticated']) x(r)
       WHERE pg_catalog.pg_has_role(x.r, 'service_role', 'SET')
          OR pg_catalog.pg_has_role(x.r, 'service_role', 'USAGE')
      UNION ALL
      SELECT x.r || '→owner(' || pg_catalog.pg_get_userbyid(p.proowner) || ')' AS msg
        FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
        CROSS JOIN pg_catalog.pg_proc p
       WHERE p.oid = v_fn
         AND (pg_catalog.pg_has_role(x.r, p.proowner, 'SET')
              OR pg_catalog.pg_has_role(x.r, p.proowner, 'USAGE'))
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#16:這些角色取得得到更高身分(%)⇒ SET ROLE 之後就讀得到今日收款總額,'
                    '而 has_function_privilege 看不到這條路', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_role_reachable';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '#16:service_role 拿不到 EXECUTE ⇒ 呼叫端整條死路(首頁那格永遠是失敗卡)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_service_role_blocked';
  END IF;

  -- ④ 函式屬性:SECDEF / search_path / 唯讀 / 語言。「DDL 裡寫了」不等於「它會一直是」。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION '#16:不是 SECURITY DEFINER ⇒ 零表權的呼叫端讀不到任何列'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_not_secdef';
  END IF;
  -- 🔴🔴 `STRICT`(= `proisstrict`)—— **少了它,NULL 參數會靜默回「一列 0」**(見檔頭實測)。
  --    這一格存在的理由是「STRICT 後來被拔掉一樣沒人守」:DDL 寫了不等於它會一直是。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.proisstrict) THEN
    RAISE EXCEPTION '#16:不是 STRICT ⇒ 任一參數為 NULL 時會回「一列 total=0」而非零列,'
                    '呼叫端會把它當成「今天沒收到錢」照顯示(零錯誤、零告警)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_not_strict';
  END IF;
  -- 🔴 逐字比 `search_path=""`(**含雙引號**)—— 那是 PG 對 `SET search_path = ''` 的實際存法。
  --    `20260811030000:270-272` 記過:寫成 `search_path=` 會讓自己的閘在拋棄庫當場紅。
  SELECT pg_catalog.array_to_string(p.proconfig, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '#16 proconfig 是 [%],期望逐字 [%]', coalesce(v_bad,'(NULL)'), 'search_path=""'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_search_path';
  END IF;
  -- 🔴 **只接受 STABLE**:本支讀表 ⇒ IMMUTABLE 會讓 planner 有權把結果折成常數
  --    ⇒ **今天的實收可能回一份過期的數字,而畫面看起來完全正常**;VOLATILE 則表示有人讓它會寫東西。
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) <> 's' THEN
    RAISE EXCEPTION '#16:provolatile 不是 STABLE ⇒ VOLATILE 表示會寫、IMMUTABLE 表示讀表結果可被折成過期常數'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_not_readonly';
  END IF;
  -- LANGUAGE sql:plpgsql 有程序控制流(迴圈/條件/動態 SQL),可以繞過本支「只回兩個純量」的形狀。
  IF (SELECT l.lanname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_fn) <> 'sql' THEN
    RAISE EXCEPTION '#16:不是 LANGUAGE sql ⇒ 程序控制流可繞過本支的形狀前提'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_not_sql_lang';
  END IF;

  -- ⑤ 🔴🔴 SECDEF fail-open 面(同 `20260811090000:254-270`)。
  --    失敗形狀:表 owner 與函式 owner 不對齊、或表被開 FORCE RLS ⇒ 查詢**靜默回空**
  --    ⇒ `COALESCE` 把它變成 **0** ⇒ 畫面顯示「今日實收 NT$ 0」而**沒有任何錯誤**。
  --    🔴 這正是本支最毒的失敗形狀,而且比姊妹函式更毒:它回 `[]`(看得出是空),
  --       本支回 `0`(**看起來就是一個正常的、今天還沒收到錢的早上**)。
  --    ⚠️ 前提照抄實測(`20260811090000:256-266`,PG17):owner 若 `rolbypassrls=true`
  --       (正式站的 postgres 就是)則連 FORCE RLS 也一起繞過 ⇒ 這一半守的是
  --       「owner 換成沒有 BYPASSRLS 的角色」那個未來。本閘只在 apply 當下跑。
  --    ⚠️ 只檢 `order_payments` 一張表 —— 本支不 join `orders`(姊妹函式才需要)。
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.order_payments'::regclass
     AND (c.relowner <> (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
          OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#16 SECDEF fail-open 面 — [%] owner 不對齊或開了 FORCE RLS ⇒ '
                    '查詢會靜默回空、COALESCE 把它變成 0,畫面會顯示「今日實收 NT$ 0」而零錯誤', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_16_secdef_fail_open';
  END IF;
END
$gate$;
