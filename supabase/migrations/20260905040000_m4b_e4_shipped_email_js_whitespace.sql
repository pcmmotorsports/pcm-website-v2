-- ══════════════════════════════════════════════════════════════════════════════
-- ⟦b4-SHIPPEDBTRIMNARROW⟧ 出貨信那兩支 view 改用 `pcm_js_trim_whitespace()`
--
-- 🛑 **病**:同一種信箱, 四支寄信掃描 view 判出兩種答案。
--    `pcm_shipped_email_pending` / `pcm_shipped_email_unsendable` 用的是
--    **沒帶字元集的 `pg_catalog.btrim()`** —— 那只剝【半形空白】;
--    而 `order_created` / `unpaid_cancelled` / `tracking_corrected` 三支用
--    `public.pcm_js_trim_whitespace()`(認得 NBSP、全形空白、BOM、U+2000–200A…)。
--    ⇒ 🔴 **一個只有 NBSP(U+00A0)的信箱**:
--      出貨信那條線判它【有收件人】⇒ 撈出來 ⇒ 寄不出去 ⇒ **每輪重撈, 佔住名額**;
--      另外三條線判它【沒有收件人】⇒ 排除並計數。
--    ⇒ 📌 **而那個重撈不報錯、不進死信、心跳照綠。**
--
-- 🔵 **方向由主視窗 2026-09-05 拍**:統一到 JS 那一組(與另外三支對齊)。
--    ⚠️ **代價明寫**:這會讓「只有 NBSP 信箱」的單**離開出貨信的掃描面**
--    ⇒ 它從「一直被撈、一直寄不出去」變成「不被撈, 而由 unsendable 那支計數看得見」。
--    ⇒ 🎯 **它不會讓任何一個【本來收得到信的人】收不到** —— 那些信箱本來就寄不出去。
--
-- ── 🔴🔴 為什麼動【兩支】而不是主視窗指名的那一支 ────────────────────────
--    `pcm_shipped_email_unsendable` 是 `pcm_shipped_email_pending` 的**補集**,
--    而那支 view 自己的 COMMENT 逐字寫著:
--      「它是 pcm_shipped_email_pending 的補集,兩支的其餘條件逐字相同 —— **改一支必須改另一支**。」
--    ⇒ 🛑 **只改一支的後果**:一張「只有 NBSP 信箱」的單會**同時不在兩支裡** ——
--      不在掃描面(不會被寄), 也不在 unsendable(不會被數)
--      ⇒ 📌 **它會從我們的視野裡整個消失, 而消失與「沒有這種單」印同一個 0。**
--    ⇒ 而 `get_shipped_email_gap_counts` 的兩個計數**分別從這兩支數**
--      (`20260831020000:79-80` 與 `:89-90`)⇒ 補集破掉 = 那支函式開始漏報。
--
-- ── 🛑 射程 ────────────────────────────────────────────────────────────────
--    · 它**解不掉** `⟦b4-JSWSNARROWER⟧`:`pcm_js_trim_whitespace()` 自己仍少
--      **U+202F / U+205F** 兩個碼位(SQL 判非空而 JS 判空)。本片是把四支對齊到
--      **同一個(仍不完整的)定義**, 不是把定義補完整。
--    · 它不動 `tracking_number` 的空白判定(那支已經用 JS 版了)。
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 前置閘:兩支 view 都要在(不在 ⇒ 這一支貼錯順序了)────────────────
DO $$
BEGIN
  IF to_regclass('public.pcm_shipped_email_pending') IS NULL
     OR to_regclass('public.pcm_shipped_email_unsendable') IS NULL THEN
    RAISE EXCEPTION '前置閘:pcm_shipped_email_pending / pcm_shipped_email_unsendable 有一支不在 ⇒ 先貼 20260822010000';
  END IF;
  IF to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:pcm_js_trim_whitespace() 不在 ⇒ 先貼 20260901070000';
  END IF;
END
$$;

-- ── ① 掃描面 ──────────────────────────────────────────────────────────
--    🔴 用 `CREATE OR REPLACE`(不是 DROP + CREATE)—— 它**保留既有 ACL**,
--       而 DROP 會把 `GRANT SELECT ... TO service_role` 一起帶走,
--       ⇒ 📌 那會讓掃描器拿到「權限不足」, 而 view 本身「建得起來」。
CREATE OR REPLACE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  -- ⚠️ `nullif` 不加 `pg_catalog.` 前綴 —— 它是 SQL【語法】不是函式。
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
      );

-- ── ② 補集(看得見那些寄不出去的)──────────────────────────────────
CREATE OR REPLACE VIEW public.pcm_shipped_email_unsendable
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NULL
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
      );

COMMENT ON VIEW public.pcm_shipped_email_pending IS
$c$「已出貨、未作廢、還沒排過 order_shipped、而且至少一個信箱非空」的 (箱, 單) 配對。一列 = 一封要寄的信。
🔴 空白定義走 public.pcm_js_trim_whitespace() 單一來源(2026-09-05 ⟦b4-SHIPPEDBTRIMNARROW⟧ 從裸 btrim 改過來)
—— 四支寄信掃描 view 從此對同一個信箱給同一個答案。
🔴 pcm_shipped_email_unsendable 是本 view 的補集,兩支的其餘條件逐字相同 —— **改一支必須改另一支**,
而 get_shipped_email_gap_counts 的兩個計數分別從這兩支數 ⇒ 補集破掉那支函式就開始漏報。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧:U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空。$c$;

COMMENT ON VIEW public.pcm_shipped_email_unsendable IS
$c$已出貨、未作廢、還沒排過信,而**兩個信箱候選都是空的**的 (箱, 單) 配對 = 這幾位客人收不到出貨通知。
🔴 它是 pcm_shipped_email_pending 的補集,兩支的其餘條件逐字相同 —— **改一支必須改另一支**。
🔴 空白定義走 public.pcm_js_trim_whitespace() 單一來源(2026-09-05 ⟦b4-SHIPPEDBTRIMNARROW⟧ 同時改的)。
⚠️ 本 view 不含 email 欄(它們本來就是空的),所以不含 PII;仍然只授權 service_role,
因為它會洩漏「哪些單出貨了」。
查法(唯讀):select count(*), min(shipped_at) from public.pcm_shipped_email_unsendable;$c$;

-- 🔴 兩支都是 security_invoker ⇒ **呼叫者**要有那支 helper 的 EXECUTE。
--    `20260901070000:64-65` 把它從所有人身上收掉過, 而 `GRANT` 是冪等的
--    ⇒ 這裡再下一次, 本支就不必依賴別的檔先貼。
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;
-- 🔴🔴 **同一個形狀的第二支函式 —— codex 2026-09-05 must-fix**:
--    這兩支 view 的 `NOT EXISTS` 裡呼叫 `pcm_shipped_email_dedup_key(uuid,uuid)`,
--    而 `security_invoker` ⇒ **它也是用呼叫者的權限跑的**。
--    ⇒ 📌 **我只想到我這一片新引進的那支 helper, 而這一支是【本來就在裡面】的** ——
--      拿「這一片新增了什麼」當分母, 而閘的分母是「這支 view 會執行什麼」。
--      (同一個分母錯誤 2026-09-05 稍早在 `20260905030000` 上被 codex 抓過一次。)
--    ✅ `20260822010000:196` 已經授過, 而 GRANT 冪等 ⇒ 這裡再下一次, 本支自己站得住。
GRANT EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid, uuid) TO service_role;

-- ── 字面釘樁:改回裸 btrim 或把條件拿掉時, apply 期就要紅 ────────────
-- ⚠️ 射程同族:它證的是**字面在定義裡**, 不證它在真資料上篩對了, 也擋不住 `OR TRUE`。
--    🟢 **而那一半現在有人守了** —— `scripts/view-behaviour-fixtures.sql` 拿真資料跑這兩支。
DO $$
DECLARE v text; v_def text;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.pcm_shipped_email_pending',
                           'public.pcm_shipped_email_unsendable'] LOOP
    v_def := pg_catalog.pg_get_viewdef(v::regclass, true);
    IF pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
      RAISE EXCEPTION '釘樁①:% 裡找不到 pcm_js_trim_whitespace ⇒ 它退回裸 btrim 了 ⇒ 四支 view 又對同一個信箱給兩種答案', v;
    END IF;
    -- 🔴 反向那一半:**舊的裸形式必須【消失】**。少了這一格, 一支同時含兩種寫法的 view
    --    會通過上面那格 —— 而「有 JS 版的字面」與「JS 版是實際生效的那個」是兩件事。
    -- ⛔ ~~原本比的是 `strpos(v_def,'btrim(o.notification_email)')`~~
    -- 🔴 **codex 2026-09-05 打穿:那個字面綁在【別名】上。** 有人把 `o` 改成 `ord`
    --    ⇒ 寫回裸 `btrim(ord.notification_email)`, 而這一格**完全漏掉**。
    -- ✅ 改成與別名無關的守恆式:**這支 view 裡每一個 `btrim(` 都必須帶字元集** ——
    --    而「帶字元集」在這兩支 view 裡只有一個來源, 所以兩個計數必須相等。
    IF pg_catalog.regexp_count(v_def, 'btrim\(')
       <> pg_catalog.regexp_count(v_def, 'pcm_js_trim_whitespace') THEN
      RAISE EXCEPTION '釘樁②:% 裡 btrim 出現 % 次而 pcm_js_trim_whitespace 只出現 % 次 ⇒ 有一處的 btrim 沒帶字元集 ⇒ 那一處仍然只剝半形空白',
        v, pg_catalog.regexp_count(v_def, 'btrim\('), pg_catalog.regexp_count(v_def, 'pcm_js_trim_whitespace');
    END IF;
    -- 🟢 正對照:這把尺在該找到東西時真的找得到(否則上面兩格恆綠)。
    IF pg_catalog.strpos(v_def, 'notification_email') = 0 THEN
      RAISE EXCEPTION '釘樁正對照:% 裡連 notification_email 都找不到 ⇒ 這把尺沒接上, 上面兩格的通過不算數', v;
    END IF;
  END LOOP;
END
$$;

-- ── 事後閘 ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
            'service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN
    RAISE EXCEPTION '事後閘:service_role 對 pcm_js_trim_whitespace() 沒有 EXECUTE ⇒ 這兩個 security_invoker view 查一次錯一次 ⇒ 出貨信那條線每輪 503、一封信都排不進去';
  END IF;
  -- 🔴 `CREATE OR REPLACE` 保留 ACL, 而「保留」是一個**宣稱**, 不是我量到的東西 ⇒ 量一次。
  -- 🔴🔴 **codex must-fix**:這兩支 view 的 NOT EXISTS 會執行 `pcm_shipped_email_dedup_key`,
  --    而 `security_invoker` ⇒ 用呼叫者的權限。少了它:**每一次掃描都 permission denied**。
  IF NOT pg_catalog.has_function_privilege(
            'service_role', 'public.pcm_shipped_email_dedup_key(uuid, uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION '事後閘:service_role 對 pcm_shipped_email_dedup_key(uuid,uuid) 沒有 EXECUTE ⇒ 這兩個 security_invoker view 查一次錯一次(本支上面就有那道 GRANT ⇒ 走到這裡代表它被別的東西收回去了)';
  END IF;
  -- ⛔ ~~「掃描器會拿到空集合, 而那長得像沒有信要寄」~~
  -- 🔴 **codex nit 訂正:那個故障方向是錯的。** 少了 SELECT, 查詢會**丟權限錯誤**,
  --    不是回空集合;而 gap-count 那支是 SECURITY DEFINER, 也不會因此恆回 0。
  --    ⇒ 📌 **一個描述錯故障方向的訊息, 會把讀它的人送去查一個不存在的症狀。**
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_shipped_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘(正對照):service_role 讀不到 pcm_shipped_email_pending ⇒ 掃描器每一輪都會拿到【權限錯誤】(不是空集合)⇒ 一封出貨信都排不進去'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_shipped_email_unsendable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘(正對照):service_role 讀不到 pcm_shipped_email_unsendable ⇒ 讀它的呼叫端會拿到權限錯誤'; END IF;
  -- 🔴🔴 **欄級授權必須另外問 —— codex must-fix**:
  --    `has_table_privilege` 對【只有欄級授權】的情況回 **false**
  --    ⇒ 一個舊的 `GRANT SELECT (display_id) ON ... TO authenticated` 會在
  --      `CREATE OR REPLACE` 之後**原封保留**, 而上面那六格全綠。
  --    ⇒ 📌 **本 repo 的標準收權斷言區塊本來就有這一半**(`20260905020000:183-184`),
  --      而我這一支手寫事後閘時把它漏掉了 —— **漏的是我已經有的東西。**
  DECLARE v_rel text; v_col text; v_role text; v_priv text;
  BEGIN
    FOREACH v_rel IN ARRAY ARRAY['public.pcm_shipped_email_pending',
                                 'public.pcm_shipped_email_unsendable'] LOOP
      FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel, 'SELECT') THEN
          RAISE EXCEPTION '事後閘:% 讀得到 %(表級)', v_role, v_rel;
        END IF;
        FOR v_col IN
          SELECT a.attname FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = v_rel::regclass AND a.attnum > 0 AND NOT a.attisdropped
        LOOP
          FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
            IF pg_catalog.has_column_privilege(v_role, v_rel::regclass, v_col, v_priv) THEN
              RAISE EXCEPTION '事後閘:% 對 %.% 仍有【欄級】% ⇒ CREATE OR REPLACE 把它原封留下來了, 而表級那一格看不到它',
                v_role, v_rel, v_col, v_priv;
            END IF;
          END LOOP;
        END LOOP;
      END LOOP;
    END LOOP;
  END;
  -- 🔵 底表那幾格照 invoker view 閘的既定形狀:既有底表印警告不擋
  --    (理由三條:正式庫實測為 true / 拋棄式 PG 的 bootstrap 是環境缺件 /
  --     apply 期的硬閘擋不到「有人後來把權限收掉」—— 那要排程檢查)。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.shipments', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 shipments ⇒ 這兩支 view 在正式環境會查一次錯一次(本機拋棄式 PG 出現此訊息屬預期)'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.orders', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 orders ⇒ 同上'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.customers', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 customers ⇒ 同上'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_outbox', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 email_outbox ⇒ 同上(而它是 anti-join 那一半)'; END IF;
  -- ⚠️ 這幾格**證不到 RLS 可見性**:BYPASSRLS 若被收掉, 它們照樣綠而 view 靜靜回零,
  --    而「零列」與「今天沒有信要寄」印同一個東西。本檔守不到, 留作已知邊界。
END
$$;

COMMIT;
