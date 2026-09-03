-- M-4b · ⟦b4-NORECIPIENTWINDOW⟧ 片1:未付款取消信線的「找不到收件人」計數
-- ============================================================
-- 為什麼有這一片:
--   `enqueueOrderUnpaidCancelledEmails` 撈到一張兩個信箱都空的單 ⇒ 跳過 ⇒
--   **不在 outbox 留任何痕跡** ⇒ 下一輪又撈到同一列 ⇒ 永久佔住 `ENQUEUE_LIMIT`(50)的名額
--   ⇒ 累積 50 筆之後,後面真正該寄的取消信**安靜地永遠排不進來**。
--
-- 🔴🔴 **而這一片不是發明一個新機制 —— 付款信線【早就有】這支儀器, 我只是補上第三條線。**
--    `get_order_created_gap_counts` → `no_recipient_count`(`20260831030000`)
--    → `PgAnomalyAlertReaderAdapter` → `check-anomaly-alerts` 的 `shouldAlert`
--    → 每天台北 09:00 推 LINE / Email。
--    📌 **⇒ 我原本在 use-case 註解裡寫「兩條線共病」, 而那句話讓人以為兩條線都看不見。**
--      🔴 **對的那半**:兩條線的【碼的形狀】確實一樣(都安靜跳過、都不留痕)。
--      🔴 **錯的那半**:付款信線【看得見】—— 它每天早上會叫。
--      🎯 **成因**:我開檔驗了對方的【迴圈】, 而我下的結論是【那條線看不看得見】——
--        而「看得見」那一半住在別的包、別的 cron、別的檔, 我沒有去讀。
--        ⇒ 📌 **我驗的是一層, 我斷言的是另一層。**
--        ⇒ ⇒ 而它往【更嚴重】的方向錯 ⇒ **沒有人會回頭查一個聽起來更該修的結論。**
--
-- 🔵 **這個痕跡活多久**(f0 指定 plan 要答的那一行):**不會過期。**
--    它不是被【存起來】的, 是每天從 `orders` 【重算】的 ⇒ 那張單不修好, 它明天照樣叫。
--    ⚠️ 對照組:`net._http_response` 只有 **6h** TTL
--    (`20260723120000_m3_s2_settle_sweep_pgcron.sql:37` 逐字「6h TTL 只管 net._http_response」)
--    ⇒ 比「累積到 50 筆」還短 ⇒ 那條路答不了這個問題。
--    📌 **⇒ 不需要新表, 因為 `orders` 就是那個表** —— 狀態本來就持久, 缺的是沒有人去看。
--
-- 🛑 **本片刻意【另開一支】而不擴充 `get_order_created_gap_counts`**(f0 2026-09-03 拍):
--    那不只是保守 —— **不要在一支【正在承重的儀器】上動手**:
--    它壞掉的時候, 你會以為是新東西壞了。
--
-- 🛑 射程(寫出來, 免得被讀成「取消信的健康度都在這裡」):
--   · 它答的是「**現在有幾張單因為沒有信箱而卡著**」——【現況】不是【歷史】。
--   · 🔴 它答不出「enqueue 一直失敗」那一種:那些單每一輪都會被重撈,
--     在本函式眼中與「還沒輪到」**一模一樣**(與姊妹那支同一個限制、同樣不在本片)。
--   · 🔴 **本訊號在 `B4_DEPLOY_CUTOFF` 還沒設好之前是【安靜的】** ——
--     ⛔ ~~原本這裡寫 `B5_UNPAID_CANCEL_CUTOFF`~~ **那顆 env 不存在, 是我編的**(codex 2026-09-03 抓)
--     ⇒ 🔴 **照那句去設定的人, 會設一顆沒有人在讀的 env, 而訊號繼續安靜** ——
--       📌 而他會以為自己上膛了。舊字面留刪除線, 讓搜它的人同一發撞到訂正。
--     ✅ 真值:寄信端三條線與本訊號**共用** `B4_DEPLOY_CUTOFF`(`email-sweep/route.ts` 的 `CUTOFF_ENV`)。
--     adapter 那條路回 `null` ⇒ `?? 0` ⇒ 不叫。**那是刻意的**(還沒上膛的線不該每天寄信),
--     🛑 而「安靜」必須與「壞掉」分得開 ⇒ **route 要印得出那個 Unknown 狀態**,
--       否則它與「這道告警根本沒裝上」是同一個畫面。
--
-- ── 🔴 兩個【已知而本片不修】的缺口(codex 2026-09-03 MF4 / MF5)────────────────
--
-- ① **空白字集缺 U+202F(窄不斷行空格)與 U+205F(中數學空格)**
--    ⇒ 兩個信箱都只有這兩碼的單:JS `trim()` 判空 ⇒ **不 enqueue**;
--      而 `pcm_js_trim_whitespace()` 判非空 ⇒ **`no_recipient_count = 0`**
--      ⇒ 🔴 **永久卡位而不告警** —— 正是本訊號要抓的那個病, 從它的盲區溜過去。
--    🛑 **本片不加寬, 而理由不是懶**:那是**共用** helper, `20260901070000` 檔頭逐字
--      「加寬對 `no_recipient_count` 是多叫、對 `stuck_count` 是少叫。**兩支一起看。**」
--      ⇒ 📌 我這一片只看得到兩支中的一支 ⇒ **在這裡加寬 = 用一半的視野改一個共用件。**
--    ⚠️ **而那個字集本來就自稱是「收窄的近似」** ⇒ 這不是新缺陷, 是**已知缺口又多兩個成員**。
--
-- ② **`!inner` 與本函式的 `EXISTS` 在【資料可見性】上可能分岔**
--    scanner 走 PostgREST(`service_role`), 本函式是 `SECURITY DEFINER`(owner = postgres)。
--    `order_cancellations` 今天**零 policy** ⇒ 若哪天 `service_role` 不再帶 `BYPASSRLS`,
--    PostgREST 那側 `!inner` 回**零單**, 而本函式照樣看得到 ⇒ 🔴 **告警說有、而信真的沒寄。**
--    🛑🛑 **而「今天為什麼安全」這句話的前提【本身就是未確認的】**:
--      `service_role` 的 `BYPASSRLS` 是**平台角色屬性**, `STATUS.md:34` 逐字
--      「**平台角色、repo 內無法驗證,標未確認**」⇒ ⇒ 📌 **我不能寫「今天是安全的」**,
--      只能寫:**今天沒有爆, 而沒有人證得出它為什麼不會爆。**
--    ⚠️ 現實觸發不是 Supabase 改掉它, 是**我們自己做一次安全強化**(同 `⟦b9-RLSHARDEN⟧`)。
-- ============================================================

BEGIN;

-- ── 1. 函式 ──
-- 🛑 刻意【不用】`CREATE OR REPLACE` —— 這是新物件;`OR REPLACE` 會把「撞名」
--    從報錯變成靜靜跳過,而跳過之後下面的 REVOKE 與斷言會對著一個我沒看過的物件跑。
CREATE FUNCTION public.get_order_unpaid_cancelled_gap_counts(
  p_cutoff timestamptz
)
RETURNS jsonb
-- 🔴 `plpgsql` 而不是 `sql`:純 SQL 函式沒辦法 RAISE ⇒ NULL 參數只能被安靜吞掉,
--    而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**, 而 0 正是「一切正常」的樣子。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 **單一來源** —— 不在這裡寫第三份空白字集。
  --    `20260901070000` 那片的產出逐字是「解法不是加寬那一份, 是**讓只剩一份**」
  --    ⇒ 我手寫一份 = 製造它剛消滅掉的東西。
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_unpaid_cancelled_gap_counts:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **脈絡, 不是告警**:未付款、已被員工取消、在起始線之後, 而取消信那一列還沒被建出來。
    --    🛑 **這個數 > 0 是【正常】的** —— 下一輪 scanner 就會把它們排進去。
    --    它存在的理由是:沒有它, 下面那個 `no_recipient` 的 0 在
    --    「一切正常」與「這裡根本沒有取消單」之間分不出來。
    'pending_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          AND o.created_at >= p_cutoff
          -- 🔴 **身分判準 = 那一列存在**, 不讀任何欄位的【值】。
          --    理由:員工七值裡的 `other` 後面接的是**員工自己打的一段字**
          --    ⇒ 拿 `cancelled_reason` 當身分 = 讓一個人打什麼字決定另一批客人收不收得到信。
          --    ⚠️ 而這個判準有它自己的脆弱點, 全文在
          --      `packages/ports/src/IUnpaidCancelledOrderScanner.ts` 檔頭。
          AND EXISTS (
                SELECT 1 FROM public.order_cancellations oc
                 WHERE oc.order_id = o.id)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled')),

    -- 🔴🔴 **這一個才是告警的主詞**:上面那一群裡, **兩個信箱都空**的。
    --    ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
    --    ⇒ 📌 **它不會自己好** —— 那張單沒有信箱, 下一輪、下下輪都一樣
    --    ⇒ ✅ 所以「有一封就叫」套在這一格上不會變噪音。
    -- ⚠️ 兩個候選信箱的順序與 adapter 一致:`orders.notification_email` 優先,
    --    退回 `customers.email`(LEFT JOIN ⇒ 沒有 customer 也算「空」)。
    -- 🔴 `NULLIF` 不加 `pg_catalog.` 前綴, 而那不是漏寫 —— 它是**SQL 文法構造**不是函式,
    --    不受 `search_path = ''` 影響、也不能加 schema 前綴(`btrim` / `count` 是真函式 ⇒ 要加)。
    --    📌 姊妹那支的作者踩過這一格, 而抓到它的是【真的餵給 psql】不是靜態檢查。
    'no_recipient_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND EXISTS (
                SELECT 1 FROM public.order_cancellations oc
                 WHERE oc.order_id = o.id)
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled')),

    -- 🔴 **分母**:沒有它, 上面兩個 0 在「一切正常」與「這裡根本沒有訂單資料 / 讀不到」
    --    之間分不出來。
    -- ⚠️ **用途寫在它旁邊, 免得下一個人拿它去算比率**:它是**全域訂單數**,
    --    含已付款、含起始線以前的。它答的是「**這裡到底有沒有訂單資料**」,
    --    **不是**「這個告警視窗裡有幾筆」。
    'orders_total_count',
      (SELECT pg_catalog.count(*) FROM public.orders)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_order_unpaid_cancelled_gap_counts(timestamptz) OWNER TO postgres;

COMMENT ON FUNCTION public.get_order_unpaid_cancelled_gap_counts(timestamptz) IS
$c$回 jsonb{pending_count, no_recipient_count, orders_total_count}。
🔴 告警的主詞是 no_recipient_count(兩個信箱都空 ⇒ 那一桶不會自己好);
pending_count > 0 是正常的(下一輪 scanner 就排掉), 不要拿它當判準 —— 那會變成「有生意就叫」。
🔵 身分判準 = order_cancellations 那一列存在, 不讀 cancelled_reason 的值
   (`other` 那一格是員工自由文字 ⇒ 拿值當身分 = 讓打字的人決定誰收得到信)。
🛑 它答的是【現況】不是【歷史】, 也答不出「enqueue 一直失敗」那一種。
🛑 空白定義走 public.pcm_js_trim_whitespace() 單一來源 —— 不要在這裡寫第二份。$c$;

-- ── 2. ACL(兩道 REVOKE 是物理擋, 不是慣例)──
-- 🔴 新物件**出生就自帶權限**, 而 repo 內零 `GRANT` 字面可掃、三綠不紅。
--    (`docs/patterns/revoking-function-execute-in-supabase.md`:「兩道 REVOKE, 少一道都是開的」)
-- 🛑 **`anon` 那一行不得刪。** 而我要誠實標明這一段的來源:
--    ⚠️ **那份四臂實測是【別人 2026-08-16 在拋棄式 PG 17.10 量的】, 不是我今天量的**
--    (`docs/patterns/revoking-function-execute-in-supabase.md:124-131` 那張表)。
--    結論逐字:只 `FROM anon, authenticated` ⇒ **洞還在**;只 `FROM PUBLIC` ⇒ 洞還在;
--    **兩道都下** ⇒ 直接路徑才關上。
--    📌 而姊妹那支的作者另外記了一格:在**拋棄式** PG 上把第二道拿掉, 突變**殺不掉**
--      —— 因為那個世界裡 anon 的權限只經 PUBLIC ⇒ **第一道就蓋掉它了**
--      ⇒ 🛑 **「這裡量不到判別力」與「它是多餘的」是兩個結論** ——
--        Supabase 正式庫有【直接授權給具名角色】那一層, 在那裡第二道是活的。
--      ⇒ ⇒ 📌 **一個在錯的世界裡跑的負對照, 會給你一個看起來像好消息的 `rc=0`。**
REVOKE ALL ON FUNCTION public.get_order_unpaid_cancelled_gap_counts(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_unpaid_cancelled_gap_counts(timestamptz)
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_unpaid_cancelled_gap_counts(timestamptz)
  TO payment_confirmer;

-- ── 3. 斷言(fail-closed:對不上就 RAISE, 整支 migration 回捲)──
-- 🔴 刻意【不用】`has_function_privilege` —— 姊妹那支記過它會說謊:
--    它只答**該物件自己的 ACL**, 不看它 body 裡呼叫的東西。
--    ⇒ 這裡直接讀 `pg_proc.proacl` 比對【完整集合】, 不問「某某有沒有權限」。
-- 🔴 清單那一行【必須自己一行】—— 靜態閘取清單的 awk 錨 `^[[:space:]]*v_functions`。
--    📌 收權斷言【只檢查你列出來的物件】:它防「忘記收權」, **不防「忘記列」**。
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_order_unpaid_cancelled_gap_counts(timestamptz)']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    -- 🔴 鎖 `oid`, 不比 `nspname || '.' || proname` —— 正式庫若有同名不同參數的 overload,
    --    那個 `SELECT … INTO` 會命中多列而任取一列 ⇒ 可能檢查到【別支函式】的 ACL。
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);

    IF v_oid IS NULL THEN
      RAISE EXCEPTION '取消信收件人訊號 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;

    IF v_acl IS NULL THEN
      -- 🔴 `proacl` 是 NULL = **套用預設** = PUBLIC 看得見 ⇒ 那正是兩道 REVOKE 要擋的世界。
      RAISE EXCEPTION '取消信收件人訊號 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;

    -- 🔴 **白名單, 不是黑名單** —— 黑名單在跟【下一個沒想到的角色】賽跑。
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     -- `CURRENT_USER` 是關鍵字不是函式(寫成 `pg_catalog.current_user` 會被當成欄名)。
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);

    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '取消信收件人訊號 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 payment_confirmer;拒繼續', r, v_extra;
    END IF;

    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '取消信收件人訊號 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔵 **形狀自檢**:真的呼叫它一次(STABLE、唯讀、只回三個整數)。
  --    🔴 少了這一格, 一支「建成了、權限也對、而回傳缺一個鍵」的函式會全綠通過 ——
  --    而下游讀到 `undefined` 之後 `?? 0`, **那個 0 與健康的 0 一模一樣**。
  v_shape := public.get_order_unpaid_cancelled_gap_counts(pg_catalog.now());
  IF v_shape IS NULL
     OR NOT (v_shape ? 'pending_count')
     OR NOT (v_shape ? 'no_recipient_count')
     OR NOT (v_shape ? 'orders_total_count') THEN
    RAISE EXCEPTION '取消信收件人訊號 形狀自檢失敗:回傳缺鍵或為 NULL ⇒ 拒繼續(收到 %)', v_shape;
  END IF;

  -- 🔴 **負對照**:NULL 參數必須 RAISE。少了這一格, 一支把那道閘刪掉的版本會全綠通過。
  BEGIN
    -- 🔴 `NULL` 一定要加型別轉換 —— 裸 `NULL` 的型別是 `unknown`,
    --    正式庫若存在同名 overload ⇒ `function …(unknown) is not unique`
    --    ⇒ 整支 migration 死在【負對照這一行】, 而錯誤訊息講的是型別、不是那道閘。
    PERFORM public.get_order_unpaid_cancelled_gap_counts(NULL::timestamptz);
    RAISE EXCEPTION '取消信收件人訊號 負對照失敗:p_cutoff = NULL 竟然沒有 RAISE ⇒ 那道 fail-closed 不在了';
  EXCEPTION
    WHEN raise_exception THEN
      -- 🛑 這裡要分辨【是它自己的閘叫的】還是【上面那句我自己的 RAISE】——
      --    否則這個負對照會把自己的失敗訊息當成「通過」。
      IF SQLERRM LIKE '%取消信收件人訊號 負對照失敗%' THEN
        RAISE;
      END IF;
  END;
END
$assert$;

COMMIT;
