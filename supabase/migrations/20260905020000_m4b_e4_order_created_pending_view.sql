-- ⟦b4-NORECIPIENTWINDOW⟧ 甲 · 第一條線(order_created)——
-- **把「永遠不會好」的那些單移出掃描面, 而不是在掃描面裡數它們。**
--
-- ══ 這一支在解什麼 ══════════════════════════════════════════════════════════
-- `SupabasePaidOrderScannerAdapter` 掃「已付款而還沒排過通知信」的單。
-- 而**兩個信箱都空**的那些單:掃到 ⇒ use-case 算成 `noRecipient` ⇒ `continue`
-- ⇒ 🔴 **不寫任何 outbox 列** ⇒ 下一輪再撈一次, **永遠**。
-- ⇒ 🛑 而掃描一輪有上限(route 端 `ENQUEUE_LIMIT`)⇒ 累積夠多就**把名額佔滿**,
--    而真的要寄的信**擠不進來** —— 不報錯、不進死信、心跳照綠。
--
-- 🟢 **出貨線 2026-08-22 就解掉了, 而修法不必發明**:它把那些配對放進另一個 view
--    (`pcm_shipped_email_unsendable`)⇒ **它們不在 pending view 裡** ⇒ 連被撈的機會都沒有。
--    ⇒ 📌 **本支就是把同一個形狀搬到 order_created 這條線。**
--
-- ══ 🔴 為什麼非得走 view 不可(而不是在 PostgREST 上加一個 filter)═══════════
-- `customers.email` 是**第二發查詢**才拿到的(`SupabasePaidOrderScannerAdapter` 先撈 orders、
-- 再用那些 `customer_user_id` 去撈 customers)⇒ 🎯 **掃描那一發【結構上看不到】客人信箱。**
-- ⇒ 所以「至少一個信箱非空」這個條件, **在 PostgREST 那一層寫不出來**。
--
-- ══ 🛑 本支【不建】unsendable view, 而那是刻意的 ═════════════════════════════
-- 出貨線當初要另一個 view 是為了**看得見**。而這條線**已經看得見**:
-- `get_order_created_gap_counts` 的 `no_recipient_count`(`20260901070000` 那一代)
-- 2026-09-03 就接進 `check-anomaly-alerts` 的 `shouldAlert` 了。
-- ⇒ 📌 **它們缺的只有「離開掃描面」這一半。**
--
-- ══ ⚠️ 本支【不解】的那一格(明寫, 不假裝)══════════════════════════════════
-- `⟦b4-JSWSNARROWER⟧`:`pcm_js_trim_whitespace()` 與 JS 的 `.trim()` 差**兩個碼位**
-- (`U+202F` 窄不換行空格 / `U+205F` 中數學空格)⇒ 一個**只有那兩種字元**的信箱
-- **SQL 判「非空」而 TS 判「空」** ⇒ 它會進本 view、而 use-case 仍落 `noRecipient`
-- ⇒ 🔴 **那一筆照舊每輪重撈。本片不解它。**(而它是**兩個碼位**, 不是「一整族」——
--    我 2026-09-05 一度把那個缺口寫得大很多, 已在板列訂正。)

BEGIN;

-- ── 前置閘:那支單一來源函式在不在 ────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_js_trim_whitespace() ⇒ 20260901070000 還沒貼, 先貼那一支';
  END IF;
END
$$;

CREATE VIEW public.pcm_order_created_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.paid_at            AS paid_at,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  -- 🔴 `payment_status='paid'` **不代表沒被取消** —— 取消不改 payment_status, 只補 cancelled_at
  --    (adapter 那側 2026-08-20 W3-G 抓到的;這裡逐字搬過來, 不是新判斷)。
  AND o.cancelled_at IS NULL
  -- 🔴🔴 **本 view 【不含 cutoff】** —— 那是呼叫端的參數(`paid_at` / `created_at` 兩個都要),
  --    而它每次不同 ⇒ 烤不進 view。⇒ 兩欄都 select 出來讓呼叫端自己篩。
  --    ⚠️ **兩個都要**:少了 `created_at >= cutoff` 那一半, **晚翻 paid 的舊單會被誤寄**
  --    (PRD §5 R3;adapter 那側逐字寫著)。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  -- 🔴🔴 **本支唯一【新增】的條件 —— 而它就是這一片。**
  --    兩個信箱都空的單, **不會自己好** ⇒ 讓它連被撈的機會都沒有。
  --    🛑 空白定義走 `pcm_js_trim_whitespace()` **單一來源**, 不在這裡寫第二份
  --    (`get_order_created_gap_counts` 的 `no_recipient_count` 用的是同一支
  --     ⇒ 📌 **兩者是互補集, 而互補集的定義只能有一份。**)
  -- ⚠️ **`nullif` 不加 `pg_catalog.` 前綴** —— 它是 SQL【語法】不是函式
  --    (加了會 `function pg_catalog.nullif(text, unknown) does not exist`)。
  --    📌 同一個坑 2026-09-04 在 `20260904220000` 上踩過一次, 這是第二次 ⇒ 寫進檔裡。
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_order_created_email_pending IS
$c$「已付款、未取消、還沒排過 order_created 通知信、而且【至少一個信箱非空】」的訂單。一列 = 一封要寄的信。
🔴 最後那個條件是本 view 存在的理由:兩個信箱都空的單不會自己好, 而留在掃描面上會被每一輪重撈,
累積到上限就把名額佔滿, 讓真的要寄的信擠不進來 —— 而它不報錯、不進死信、心跳照綠。
🟢 那些被排除的單【仍然看得見】:get_order_created_gap_counts 的 no_recipient_count 在數它們,
而那個計數 2026-09-03 就接進每日告警的 shouldAlert 了。⇒ 本 view 只負責讓它們離開掃描面。
🛑 本 view 不含 cutoff —— paid_at 與 created_at 兩欄都回出去, 由呼叫端篩。
兩個都要:少了 created_at 那一半, 晚翻 paid 的舊單會被誤寄(PRD §5 R3)。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧:U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空
⇒ 只有那兩種字元的信箱仍會進來、仍會每輪重撈。$c$;

REVOKE ALL ON public.pcm_order_created_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_order_created_email_pending TO service_role;

-- 🔴🔴 **這一行不是順手加的 —— 少了它, 這條線【每一輪都失敗】而一封信都排不進去。**
--    (codex 2026-09-05 對抗審查 must-fix #1)
-- 本 view 是 `security_invoker = true` ⇒ 它裡面呼叫的函式**用【呼叫者】的權限執行**,
-- 而 `20260901070000:64-65` 把 `pcm_js_trim_whitespace()` 的 EXECUTE **從所有人身上收掉了**
-- (那時它的呼叫端全是 `SECURITY DEFINER` 函式 ⇒ 以 owner 身分跑 ⇒ 不需要)。
-- ⇒ 🎯 **而那支檔 `:69` 逐字寫著:「而那是一個【依賴】:若將來有非 DEFINER 的呼叫端, 這裡要補 GRANT。」**
--   ⇒ 📌 **我就是那個呼叫端, 而那句警告是四天前寫的。**
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 字面釘樁:那個新條件被拿掉時, apply 期就要紅 ──────────────────
-- ⚠️ 射程與 20260904220000 那支同款:它證的是**那個字面在 view 定義裡**,
--    **不證**它在真資料上篩對了;`strpos` 也擋不住有人加 `OR TRUE`;
--    而它**只在本檔 apply 的那一刻成立** —— 之後有人重建這個 view, 本釘樁不會知道。
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_order_created_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
    RAISE EXCEPTION '釘樁①:view 裡找不到 pcm_js_trim_whitespace ⇒ 收件人條件不見了或改寫了 ⇒ 兩個信箱都空的單會回到掃描面';
  END IF;
  IF pg_catalog.strpos(v_def, 'cancelled_at IS NULL') = 0 THEN
    RAISE EXCEPTION '釘樁②:view 裡找不到 cancelled_at IS NULL ⇒ 剛被取消的單會收到「訂單成立」';
  END IF;
  -- 🟢 正對照:這把尺在該找到東西時真的找得到(否則上面兩格恆綠)。
  IF pg_catalog.strpos(v_def, 'order_created') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面兩格的通過不算數';
  END IF;
END
$$;

-- ── 新物件收權斷言(整段照抄 `20260817070000` 的標準區塊, 只換清單)──
-- 🔴 它防「忘記收權」, **不防「忘記列」** —— 而 `migration-static-checks.sh` 第③格補那一半:
--    📌 **而本檔第一版真的漏了**(閘印「可授權物件 1 個, 斷言清單列了 0 個」)⇒ 那道閘不是裝飾。
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.pcm_order_created_email_pending'
  ]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- ── 事後閘 ────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 🔴🔴 **這一格是本檔最重要的事後閘**(codex must-fix #1):
  --    `security_invoker` 的 view 會用**呼叫者**的權限去執行它裡面的函式
  --    ⇒ service_role 少了那支 helper 的 EXECUTE ⇒ **每一次掃描都權限錯誤**
  --    ⇒ 🛑 **每輪 503、零新信排入** —— 而 view 本身「建得起來」, 靜態檢查也全綠。
  IF NOT pg_catalog.has_function_privilege(
            'service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN
    RAISE EXCEPTION '事後閘:service_role 對 pcm_js_trim_whitespace() 沒有 EXECUTE ⇒ 這個 security_invoker view 查一次錯一次 ⇒ order_created 那條線每輪 503、一封信都排不進去';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_order_created_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:anon 讀得到那個含 email 的 view'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_order_created_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:authenticated 讀得到那個含 email 的 view'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_order_created_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘(正對照):service_role 讀不到 ⇒ 掃描器會拿到空集合, 而那長得像「沒有信要寄」'; END IF;
END
$$;

COMMIT;
