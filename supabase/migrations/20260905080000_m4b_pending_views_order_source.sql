-- ⟦f3-MAILFALLBACKVSRULING⟧ 片 A —— 四個 pending view 各多帶一欄 `order_source`。
--
-- ══ 這一支在解什麼 ══════════════════════════════════════════════════════════
-- Sean 拍過:手動建單「**可以不填 = 不寄**」。而今天做不到 ——
-- 四支寄信 use-case 一律 `firstNonEmpty(notification_email, customers.email)`
-- ⇒ 手動單的 `notification_email` 恆 NULL(表單根本沒有那個欄位)
-- ⇒ 🔴 **客人一定收到信, 而員工沒有任何方法阻止。**
--
-- 而要分流就得知道**這張單是哪來的**。`orders.order_source` 早就有了
-- (`'web' | 'manual_phone' | 'manual_line' | 'manual_other'`, CHECK 在 20260712203000),
-- 🔴 **而四個 pending view 都沒有把它帶出來**(2026-09-05 唯讀庫實查:0 / 0 / 0 / 0)
-- ⇒ 掃描那一層**結構上看不到來源** ⇒ 本支就是把那一欄接出去。
--
-- ══ 🟢 本支【不改任何行為】—— 而那是刻意的 ═════════════════════════════════
-- 只在 SELECT 清單尾端多一欄, **WHERE 一個字都沒動**。
-- 🔴🔴 **而「WHERE 沒動 ⇒ 同一批列」這個理由對 `SELECT DISTINCT` 【不成立】**(R1-F6):
--    ②`pcm_shipped_email_pending` 與 ③`pcm_tracking_corrected_email_pending` 是 `SELECT DISTINCT`
--    ⇒ **加一欄就是改 distinct key** ⇒ 原本會被摺疊的兩列可能不再摺疊。
--    ✅ 這一片仍然安全, 而**理由是另一個**:`o.order_source` **函數相依於已經在清單裡的 `o.id`**
--    ⇒ 同一個 `order_id` 的兩列, 新欄的值必然相同 ⇒ 摺疊結果不變。
--    🛑 **⇒ 下一個照「WHERE 沒動」這句話加欄的人會出事** —— 例如加 `s.tracking_number`
--       —— ⛔ ~~例如加 `s.tracking_number`~~ **那個反例不成立**(codex 2026-09-05 nit:
--       清單裡已經有 `s.id`, 而 tracking_number 同樣函數相依於它)。
--       ✅ 真正的反例是**被摺疊掉的那一側**:`oi.id` / `si.order_item_id` ——
--       一次出貨有多個品項, 而它們**不在** SELECT 清單裡, 正是 DISTINCT 在摺的東西
--       ⇒ 把它加進來會讓「一次出貨」變成「一個品項一列」, 而三綠與探針都不會叫。
--    🔬 探針格 2b/6b 造了「同一張單、同一次出貨、兩個品項」⇒ 底層 2 列、view 1 列,
--       貼前貼後都是 1 ⇒ **那是這件事唯一會現形的形狀。**
-- 分流的判斷寫在 use-case 那一片(片 C), 它要等 Sean 那一題。
-- ⇒ 📌 **所以這一支貼上去之後, 寄信行為與貼之前【逐字相同】。**
--
-- ══ ⚠️ 本支【不解】的 ═══════════════════════════════════════════════════════
-- · 不動 `admin_create_manual_order`(片 D)、不動表單(片 E)、不動 use-case(片 C)。
-- · 🔴 `order_source` 是 `text` 而 CHECK 在 orders 上 —— **view 不重述那個 CHECK**。
--   讀的人要知道值域, 去看 `packages/domain/src/order/types.ts` 的 `OrderSource`。
--   ⇒ 這是刻意的:**同一個值域寫兩份, 下一個加來源的人只會改到一份。**
--
-- ══ 🛑 `CREATE OR REPLACE VIEW` 的硬限制(不是風格, 是 PostgreSQL 規則)══════
-- 新欄只能加在**最尾端**, 既有欄的**名稱 / 型別 / 順序都不准動**。
-- 四個 view 現在的最後一欄都是 `customer_email` ⇒ 新欄接在它後面。
-- 🔵 定義本體是 2026-09-05 從**正式庫 `pg_get_viewdef`** 抄回來的(不是從 repo 拼的)——
--    因為 REPLACE 要對得上的是**現在正在跑的那一版**, 不是 repo 裡最新那一支。
-- ⚠️ 而 ACL 不會被 REPLACE 重設;下面仍然重述一次 REVOKE/GRANT ——
--    **那是防漂移, 不是必要**(重述無害, 而少了它我們就沒有一份「它該長怎樣」的字面)。

-- ══ 🔴🔴 部署順序:**這一支要先貼, 碼才能上**(R1-F3)═══════════════════════
-- 片 B 的四支 adapter 會在 `.select()` 裡要 `order_source`。
-- ⇒ **碼先上而這一支沒貼** ⇒ PostgREST 回 **42703 undefined_column** ⇒ `ScanQueryError`
--   ⇒ 🛑 **四條通知線整段停**(`apps/storefront/src/app/api/cron/email-sweep/route.ts` 回 503)。
-- ⇒ 📌 而 `dev` 是 pcm-admin 的 production 分支、push 即部署
--   ⇒ **「本支不改行為」那句話, 在【碼先上】那個世界裡是假的。**
-- ✅ 順序:**這一支 apply 進正式庫 ⇒ 才推片 B 的碼**。(片 A 與片 B 在同一顆 commit 裡,
--    所以真正的閘是 **Sean 貼這一支的時刻 vs 主視窗 push 的時刻** —— 兩者不能顛倒。)

BEGIN;

-- ── 前置閘:四個 view 都要已經存在, 而且 order_source 欄要還沒有 ──────────
DO $$
DECLARE
  v_missing text;
  v_already text;
BEGIN
  SELECT pg_catalog.string_agg(x.n, ', ')
    INTO v_missing
    FROM (VALUES ('pcm_order_created_email_pending'),
                 ('pcm_shipped_email_pending'),
                 ('pcm_tracking_corrected_email_pending'),
                 ('pcm_unpaid_cancelled_email_pending')) AS x(n)
   WHERE pg_catalog.to_regclass('public.' || x.n) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:這些 view 不存在 ⇒ %  (先貼建它們的那幾支)', v_missing;
  END IF;

  -- 🔴 這一格擋的是【重複貼】—— 而它同時是本支的冪等性宣告:
  --    已經有那一欄就直接失敗, 不要靜靜地「成功」一次什麼都沒做。
  SELECT pg_catalog.string_agg(c.relname, ', ')
    INTO v_already
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND a.attname = 'order_source'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:這些 view 已經有 order_source 欄 ⇒ %  (本支貼過了)', v_already;
  END IF;
END $$;

-- ══ ① order_created ═══════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.pcm_order_created_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.paid_at            AS paid_at,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  -- ⚠️ `nullif` 不加 `pg_catalog.` 前綴 —— 它是 SQL【語法】不是函式(原檔的坑, 逐字保留)
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ══ ② shipped ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id));

-- ══ ③ tracking_corrected ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                  AS shipment_id,
  s.shipment_reference  AS shipment_reference,
  s.tracking_number     AS tracking_number,
  s.carrier_code        AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.notification_email  AS notification_email,
  c.email               AS customer_email,
  o.order_source        AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND EXISTS (
        SELECT 1 FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at));

-- ══ ④ unpaid_cancelled ═════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.pcm_unpaid_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ── ACL 重述(防漂移;REPLACE 本身不重設 ACL)──────────────────────
REVOKE ALL ON public.pcm_order_created_email_pending      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_shipped_email_pending            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_tracking_corrected_email_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_unpaid_cancelled_email_pending   FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_order_created_email_pending      TO service_role;
GRANT SELECT ON public.pcm_shipped_email_pending            TO service_role;
GRANT SELECT ON public.pcm_tracking_corrected_email_pending TO service_role;
GRANT SELECT ON public.pcm_unpaid_cancelled_email_pending   TO service_role;
-- 🔴 security_invoker ⇒ view 內的函式用【呼叫者】權限跑 ⇒ 這幾行不是順手加的
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 貼上去當場自證:四個 view 都要有那一欄, 而且它要在【最後一欄】 ────────
DO $$
DECLARE
  v_n   integer;
  v_bad text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND a.attname = 'order_source' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '自證①:應該有 4 個 view 帶 order_source, 實得 %', v_n;
  END IF;

  -- 🛑 **這一格在【本檔】可達的世界裡永遠不會紅**(R1-F8, 對抗審查抓到, 我原本的理由是錯的):
  --    把新欄插在中間 ⇒ `CREATE OR REPLACE VIEW` 自己就會擋下
  --    (`cannot change name of view column "customer_email" to "order_source"`)
  --    ⇒ 交易當場中止 ⇒ **走不到這裡**。探針格 10 實測就是那一句。
  -- ✅ **它仍然留著, 而它守的是【別的東西】**:未來有人把這種改法寫成 `DROP VIEW` + `CREATE VIEW`
  --    (回退腳本就是那個形狀)⇒ 那條路沒有欄序保護 ⇒ **那時是這一格接住。**
  SELECT pg_catalog.string_agg(t.relname, ', ') INTO v_bad
    FROM (
      SELECT c.relname,
             pg_catalog.max(a.attnum)                                        AS last_num,
             pg_catalog.max(a.attnum) FILTER (WHERE a.attname='order_source') AS os_num
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname='public' AND c.relkind='v'
         AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                           'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
         AND a.attnum > 0 AND NOT a.attisdropped
       GROUP BY c.relname) t
   WHERE t.os_num IS DISTINCT FROM t.last_num;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '自證②:order_source 不在最後一欄 ⇒ %', v_bad;
  END IF;

  -- 🔴🔴 invoker view 的 EXECUTE 事後斷言(pre-commit 的 invoker-view-execute-gate 逼出來的)。
  --    這四個 view 是 `security_invoker = true` ⇒ **body 裡的函式用【呼叫者】的權限跑**。
  --    ⇒ 上面那行 GRANT 是【我寫的動作】; 下面這一格是【量到的結果】—— 兩者不是同一件事。
  --    ⚠️ 而 GRANT 只涵蓋 pcm_js_trim_whitespace();另外三支從來沒被 REVOKE 過,
  --       所以它們今天是靠 PUBLIC 的預設 EXECUTE 在跑 —— 🛑 **那是一個沒有人寫下來的依賴**,
  --       哪天有人照 `revoking-function-execute-in-supabase.md` 收緊它們, 這四個 view 會【查一次錯一次】
  --       而 view 本身建得起來、靜態全綠。⇒ 所以四支都要斷言, 不是只斷言我 GRANT 的那一支。
  -- 🛑 **四條逐字寫開, 不用迴圈** —— 我第一版把函式名放進 ARRAY 再跑 FOREACH,
  --    而 `invoker-view-execute-gate.py` 的字面尺是 `has_function_privilege( … '<fn>' … )`
  --    ⇒ 名字在變數裡它【撈不到】⇒ 閘照樣紅。而那正是它自己檔頭寫著的已知缺口。
  --    📌 一個「人讀得懂而尺讀不到」的寫法, 對這道閘等於沒寫 —— 而下一個讀碼的人也要 grep。
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這四個 invoker view 會查一次錯一次';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_shipped_email_dedup_key() ⇒ shipped / tracking 兩個 view 會查一次錯一次';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_tracking_corrected_at_key() ⇒ tracking view 會查一次錯一次';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_tracking_corrected_dedup_key() ⇒ tracking view 會查一次錯一次';
  END IF;

  -- 🔴🔴 **而「service_role 叫得動」只答了一半** —— codex 2026-09-05 MF1:
  --    另一半是「**anon 叫不動**」。這四支函式若經 PUBLIC 讓 anon 執行, 那是一條沒人看著的路。
  --    🔬 **正式庫 2026-09-05 唯讀實查:四支 anon 全 f、service_role 全 t** ⇒ 下面四格今天成立,
  --       它們釘的是【現況】, 不是一個願望。
  --    ⚠️ 而本支【沒有動任何 GRANT/REVOKE 去讓它成立】—— 它本來就是那樣。
  --       ⇒ 📌 這幾行的作用是:**哪天有人放寬了它, 下一支 migration 會在這裡紅。**
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_js_trim_whitespace() ⇒ invoker view 的函式對外開著';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_shipped_email_dedup_key() ⇒ invoker view 的函式對外開著';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_tracking_corrected_at_key() ⇒ invoker view 的函式對外開著';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_tracking_corrected_dedup_key() ⇒ invoker view 的函式對外開著';
  END IF;

  -- 🔴 而真正的曝露邊界是【view 本身】—— 函式叫不叫得動, 只有在他先看得到 view 時才有意義。
  --    🔬 正式庫實查:四個 view 對 anon 皆 f。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND (pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '自證⑥:有 % 個 view 對 anon/authenticated 開著 SELECT(它們含 PII 兩個 email 欄)', v_n;
  END IF;

  -- 🔵 負對照:一個現造的欄名必須【零】命中 —— 沒有這一格, 上面那個 4 可能來自一把恆真的尺。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname='public' AND c.relkind='v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND a.attname = 'zzz_never_a_column';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何欄名都印命中 ⇒ 上面那個 4 不算數';
  END IF;
END $$;

COMMIT;

-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════
-- 把四個 view 各自 CREATE OR REPLACE 回「沒有 order_source」那一版。
-- 🔴 而 CREATE OR REPLACE **不能減少欄位** ⇒ 回退要先 DROP VIEW 再 CREATE。
--    ⚠️ DROP 會把 ACL 一起帶走 ⇒ 回退腳本必須把上面那組 REVOKE/GRANT 一起重跑。
-- ✅ **回退腳本已經寫好而且【跑過】**:`scripts/20260905080000-down.sql`(220 行)。
--    ⛔ ~~逐字定義:本檔上面那四段, 各自刪掉那一行即可~~ —— codex 2026-09-05 MF2:
--    **一份要人手工拼四段註解的回退指示, 在急著回退的那一刻等於沒有。**
-- 🔴 `DROP VIEW` 帶走的不只 ACL, 還有四段 `COMMENT ON VIEW`(裡面住著 Sean 的拍板、
--    ⟦b4-JSWSNARROWER⟧ 的已知缺口、「與 gap_counts 是互補集」那句)⇒ down.sql 逐字貼回。
--    四段是**機械抄的**(regex 抓整段), 來源逐段標在 down.sql 裡:
--       order_created      ⇒ 20260905020000_m4b_e4_order_created_pending_view.sql
--       shipped            ⇒ 20260905040000_m4b_e4_shipped_email_js_whitespace.sql
--                            (⚠️ 20260822010000 也有一份【舊的】)
--       tracking_corrected ⇒ 20260904220000_m4b_outbox_shipment_tracking_corrected_event.sql
--                            (⛔ ~~20260904280000~~ 指錯檔, R2-M1 抓到)
--       unpaid_cancelled   ⇒ 20260905030000_m4b_e4_unpaid_cancelled_pending_view.sql
-- 🔬 探針格14/15 **真的跑了它一次** —— rc=0 且回退後 order_source 欄數回到 0。
--    📌 一支從來沒被執行過的回退腳本, 與一段回退【說明】是同一個東西:
--       都要在最需要它的那一刻才第一次被讀。
-- ⚠️ `DROP VIEW` 不加 CASCADE:2026-09-05 查過沒有其他 view 依賴這四支
--    (三支 gap_counts 是 plpgsql, 不建 catalog 相依)⇒ DROP 不會被擋。
--    這句話會在有人加 view 那天變假。
