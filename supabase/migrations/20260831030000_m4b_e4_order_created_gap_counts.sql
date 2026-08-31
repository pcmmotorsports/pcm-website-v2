-- ============================================================
-- M-4b 訊號 4:「訂單已付款而【通知信那一列根本沒被建出來】」的計數 RPC
--
-- 🔴 **這一片只讓數字讀得到。它不寄任何客人的信,也不改任何寄信條件。**
--
-- ── Sean 2026-08-31 拍板 5️⃣「甲 有一封就叫 —— 最吵但不漏」──
-- 🔴🔴 **而他答的是【門檻】,不是【主詞】** —— 主詞由 plan
--   `docs/plans/2026-08-31-email-signal4-never-created-alert.md` 定,理由寫在那裡:
--   scanner 每 5 分鐘掃「已付款而沒有信」的單,**然後當輪就把它們排進去**
--   ⇒ 📌 **`scanned > 0` 本身是【正常】的 ⇒ 拿它當判準 = 有生意就叫,那不是告警。**
--   ⇒ ✅ 「一封就叫」有一個**正好對得上**的主詞:`no_recipient_count`
--      —— 兩個信箱都空 ⇒ 那一桶**不會自己好** ⇒ 叫一次就是一件真的待辦。
--
-- 🔵 **為什麼要一支 SQL 函式而不是在 TS 裡再查一次**:
--   那個 anti-join 已經存在於 `SupabasePaidOrderScannerAdapter.ts`(每 5 分鐘在跑),
--   而告警端在**另一條 cron、另一個行程**(`pcm-anomaly-alert`,每日 01:00)
--   ⇒ 讀不到 scanner 那一輪的記憶體變數。
--   ⇒ 兩份各自寫一次查詢 ⇒ **它們會漂**。收成一支函式,兩邊共用同一份述詞。
--   (成例:`20260831020000` 的 `get_shipped_email_gap_counts`。)
--
-- 🔴 **而它順手解掉一個既有的失真**:TS 那條路帶 `ENQUEUE_LIMIT = 50`
--   ⇒ `scanned` 實際是 `min(真缺口, 50)`,**缺口 5,000 時它印 50,而 50 看起來很正常**
--   (2026-08-31 `code-reviewer` F3)。本函式**不帶 limit** ⇒ 它回的是真的 count。
--
-- ⚠️ **它答不出什麼**(寫在這裡,不是寫在交件檔):
--   · 它答不出「起始線【以前】的訂單有沒有漏信」—— 那是刻意的,與呼叫端同一條起始線。
--   · 它答不出「那封信寄出去了沒」—— 它只數「**有沒有被排進佇列**」。
--   · 🔴 它答不出「enqueue 一直失敗」那一種:那些單**每一輪都會被重撈**
--     ⇒ 在本函式眼中它們與「還沒輪到」**一模一樣**。
--     ⇒ 那一格需要跨輪狀態,**不在本片**(plan §5 具名記錄,板上另開一列)。
-- ============================================================

BEGIN;

-- ── 1. 函式 ──
-- 🛑 刻意【不用】`CREATE OR REPLACE` —— 這是新物件;`OR REPLACE` 會把「撞名」
--    從報錯變成靜靜跳過,而跳過之後下面的 REVOKE 與斷言會對著一個我沒看過的物件跑。
CREATE FUNCTION public.get_order_created_gap_counts(
  p_cutoff timestamptz
)
RETURNS jsonb
-- 🔴 `plpgsql` 而不是 `sql`,而那不是風格:純 SQL 函式**沒有辦法 RAISE**
--    ⇒ `p_cutoff` 是 NULL 時只能被安靜地吞掉,而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**
--    ⇒ 📌 **而 0 正是「一切正常」的樣子。** 照 `20260831020000` 的成例 fail-closed。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result jsonb;
  /**
   * 🔴 **`btrim(x)` 預設【只吃半形空白】,而 JS 的 `trim()` 吃一整族**
   * (codex 2026-08-31 R1 must-fix;拋棄式 PG 複現在下方註解)。
   * ⇒ 一個值是 `E'\t'` 的信箱:use-case 判它是空 ⇒ 落 `noRecipient` 桶、排不進去;
   *   而本函式若用預設 `btrim` 會判它【非空】⇒ **漏報那一筆**。
   * 📌 **⇒ 兩邊對「空」的定義不同 ⇒ 告警與實際行為分岔, 而分岔的方向是【漏】。**
   * ⚠️ 涵蓋 JS `trim()` 的常見成員:空白 / \t / \n / \r / \f / \v / NBSP(U+00A0) / BOM(U+FEFF)。
   * 🛑 **它不是 JS 的完整集合**(Unicode 還有 U+2000-200A 等)—— 這是**收窄了的近似**,
   *   而**未涵蓋的那些方向是「本函式判非空、JS 判空」⇒ 仍是【漏報】不是誤報**。**未數。**
   */
  JS_WS constant text := E' \t\n\r\f\v' || U&'\00a0' || U&'\feff';
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_created_gap_counts:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **脈絡,不是告警**:已付款、未取消、在起始線之後,而通知信那一列還沒被建出來。
    --    🛑 **這個數 > 0 是【正常】的** —— 下一輪 scanner 就會把它們排進去。
    --    它存在的理由是:沒有它,下面那個 `no_recipient` 的 0 在
    --    「一切正常」與「這裡根本沒有訂單」之間分不出來。
    'paid_no_email_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created')),

    -- 🔴🔴 **這一個才是告警的主詞**:上面那一群裡,**兩個信箱都空**的。
    --    ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
    --    ⇒ 📌 **它不會自己好** —— 那張單沒有信箱,下一輪、下下輪都一樣。
    --    ⇒ ✅ 所以 Sean 的「有一封就叫」套在這一格上不會變噪音。
    -- ⚠️ 兩個候選信箱的順序與 adapter 一致:`orders.notification_email` 優先,
    --    退回 `customers.email`(LEFT JOIN ⇒ 沒有 customer 也算「空」)。
    -- 🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,而那不是漏寫** —— 我第一版寫了,
    --    拋棄式 PG 17.10 實跑 ⇒ `ERROR: function pg_catalog.nullif(text, unknown) does not exist`。
    --    成因:`NULLIF` / `COALESCE` / `CASE` 是**SQL 文法構造**,不是 `pg_catalog` 裡的函式,
    --    所以它們**不受 `search_path = ''` 影響**、也不能加 schema 前綴。
    --    (`btrim` / `count` / `now` 是真的函式 ⇒ 那些要加。)
    -- 📌 **⇒ 而五道靜態檢查全綠、我讀了兩遍也沒看出來 —— 抓到它的是【真的餵給 psql】。**
    'no_recipient_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created')),

    -- 🔴 **分母**(照 `20260831020000` 的成例):沒有它,上面兩個 0 在
    --    「一切正常」與「這裡根本沒有訂單資料 / 讀不到」之間分不出來。
    -- ⚠️ **用途寫在它旁邊,免得下一個人拿它去算比率**:它是**全域訂單數**,
    --    含未付款、含起始線以前的。它答的是「**這裡到底有沒有訂單資料**」,
    --    **不是**「這個告警視窗裡有幾筆」。
    -- 🔵 `orders` 沒有 `deleted_at` 欄(2026-08-31 查 `information_schema` 確認)⇒ 不濾。
    'orders_total_count',
      (SELECT pg_catalog.count(*) FROM public.orders)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_order_created_gap_counts(timestamptz) OWNER TO postgres;

COMMENT ON FUNCTION public.get_order_created_gap_counts(timestamptz) IS
  'M-4b 訊號 4:訂單已付款而 order_created 那一列根本沒被建出來的計數(Sean 2026-08-31 拍 5-甲)。'
  'owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零信箱/零 id)。'
  '回 jsonb{paid_no_email_count, no_recipient_count, orders_total_count}。'
  '🔴 告警的主詞是 no_recipient_count(兩個信箱都空 ⇒ 那一桶不會自己好);'
  'paid_no_email_count > 0 是【正常】的 —— 下一輪 scanner 就會排進去,不得拿它當告警判準。'
  '述詞與 SupabasePaidOrderScannerAdapter 對齊:paid + cancelled_at IS NULL + paid_at/created_at 皆 >= cutoff。'
  '本函式不帶 limit ⇒ 回真的 count,而 TS 那條路帶 ENQUEUE_LIMIT=50 ⇒ 那邊是 min(真缺口,50)。'
  '🔴 已知盲區:enqueue 一直失敗的單每輪重撈 ⇒ 在本函式眼中與「還沒輪到」相同,'
  '要分開需要跨輪狀態,不在本片(plan 具名記錄)。';

-- ── 2. ACL(兩道 REVOKE 是物理擋,不是慣例)──
-- 🔴 新物件**出生就自帶權限**,而 repo 內零 `GRANT` 字面可掃、三綠不紅。
--    (`docs/patterns/revoking-function-execute-in-supabase.md`:「兩道 REVOKE,少一道都是開的」)
-- 🛑 **`anon` 那一行不得刪** —— `20260831020000` 檔內記過一次實測:在拋棄式 PG 上刪掉它
--    `rc=0` 一聲不吭(那裡 anon 的權限經 PUBLIC 而來),**而 Supabase 有直接授權那一層**
--    ⇒ 📌 一個在錯的世界裡跑的負對照,會給你一個看起來像好消息的 rc=0。
REVOKE ALL ON FUNCTION public.get_order_created_gap_counts(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_created_gap_counts(timestamptz)
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_created_gap_counts(timestamptz)
  TO payment_confirmer;

-- ── 3. 斷言(fail-closed:對不上就 RAISE,整支 migration 回捲)──
-- 🔴🔴 **刻意【不用】`has_function_privilege`** —— 2026-08-31 本線量到它會說謊:
--    `has_table_privilege('public.pcm_shipped_email_pending','SELECT')` 印 **t**,
--    而實際 `select` ⇒ `permission denied for function pcm_shipped_email_dedup_key`
--    (那把尺只答**該物件自己的 ACL**,不看它 body 裡呼叫的東西)。
--    ⇒ 📌 **這裡直接讀 `pg_proc.proacl` 比對【完整集合】,不問「某某有沒有權限」。**
--    (條目:`docs/patterns/traps-inbox/G-20260831e-授權齊全的view沒有人讀得了…md`)
-- 🔴 清單那一行【必須自己一行】—— 靜態閘取清單的 awk 錨 `^[[:space:]]*v_functions`。
--    而它不是裝飾:下面的迴圈就是吃它,漏列一個 ⇒ 那個物件不會被檢查到。
--    📌 收權斷言【只檢查你列出來的物件】:它防「忘記收權」,**不防「忘記列」**。
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_order_created_gap_counts(timestamptz)']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    -- 🔴🔴 **鎖 `oid`,不比 `nspname || '.' || proname`**(codex 2026-08-31 R1 must-fix)。
    --    ⛔ ~~舊寫法用 schema+名字比對~~ —— 正式庫若存在**同名不同參數的 overload**,
    --    那個 `SELECT … INTO` 會命中多列而**任取一列** ⇒ 可能檢查到【別支函式】的 ACL
    --    ⇒ 誤放行, 或對著一支我沒建的函式誤回捲。
    -- 🛑 而 `to_regprocedure` 吃的是**完整簽名**;查無回 NULL(不 throw)⇒ 下面那格接得住。
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);

    IF v_oid IS NULL THEN
      RAISE EXCEPTION '訊號4 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;

    IF v_acl IS NULL THEN
      -- 🔴 `proacl` 是 NULL = **套用預設** = PUBLIC 看得見 ⇒ 那正是兩道 REVOKE 要擋的世界。
      RAISE EXCEPTION '訊號4 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;

    -- 🔴🔴 **白名單,不是黑名單**(codex 2026-08-31 R1 must-fix)。
    --    ⛔ ~~舊寫法只問 anon / authenticated / service_role 在不在~~
    --    ⇒ 哪天 default privileges 或別人的 migration 授給**第四個角色**, 它一個字都不會說。
    --    📌 **黑名單在跟【下一個沒想到的角色】賽跑**(同 CLAUDE.md Git 紀律那條 token 前綴)。
    --    ✅ 改成:把授權清單攤開, 只要出現**不在允許集合裡**的就炸。
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
      RAISE EXCEPTION '訊號4 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 payment_confirmer;拒繼續', r, v_extra;
    END IF;

    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '訊號4 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔵 **形狀自檢**:真的呼叫它一次(STABLE、唯讀、只回三個整數)。
  --    🔴 少了這一格,一支「建成了、權限也對、而回傳缺一個鍵」的函式會全綠通過 ——
  --    而下游讀到 `undefined` 之後 `?? 0`,**那個 0 與健康的 0 一模一樣**。
  v_shape := public.get_order_created_gap_counts(pg_catalog.now());
  IF v_shape IS NULL
     OR NOT (v_shape ? 'paid_no_email_count')
     OR NOT (v_shape ? 'no_recipient_count')
     OR NOT (v_shape ? 'orders_total_count') THEN
    RAISE EXCEPTION '訊號4 形狀自檢失敗:回傳缺鍵或為 NULL ⇒ 拒繼續(收到 %)', v_shape;
  END IF;

  -- 🔴 **負對照**:NULL 參數必須 RAISE。少了這一格,一支把那道閘刪掉的版本會全綠通過。
  BEGIN
    -- 🔴 **`NULL` 一定要加型別轉換** —— 裸 `NULL` 的型別是 `unknown`,
    --    正式庫若存在同名 overload ⇒ `ERROR: function …(unknown) is not unique`
    --    ⇒ 整支 migration 死在【負對照這一行】, 而錯誤訊息講的是型別、不是那道閘。
    --    (2026-08-31 拋棄式 PG 實測:先建一支 `(int)` overload 再跑 ⇒ 逐字複現。)
    PERFORM public.get_order_created_gap_counts(NULL::timestamptz);
    RAISE EXCEPTION '訊號4 負對照失敗:p_cutoff = NULL 竟然沒有 RAISE ⇒ 那道 fail-closed 不在了';
  EXCEPTION
    WHEN raise_exception THEN
      -- 🛑 這裡要分辨【是它自己的閘叫的】還是【上面那句我自己的 RAISE】——
      --    否則這個負對照會把自己的失敗訊息當成「通過」。
      IF SQLERRM LIKE '%訊號4 負對照失敗%' THEN
        RAISE;
      END IF;
  END;
END
$assert$;

COMMIT;
