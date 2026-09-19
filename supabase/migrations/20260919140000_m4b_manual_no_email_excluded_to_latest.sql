-- 20260919140000_m4b_manual_no_email_excluded_to_latest.sql
-- M-4b · 板 217(板號與版本號皆由主視窗指定)· 窗B(worktree pcm-ops)
-- plan:docs/plans/2026-09-19-20260905210000-view-drift-from-prod-plan.md
--   🛑 **敘事在 plan,不在這裡**(docs/patterns/where-migration-narrative-goes.md)——
--      為什麼這樣決定 / 量過什麼 / 審查抓到什麼,全部在那份 plan。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════
-- 把 `public.pcm_manual_no_email_excluded` 從**舊定義**帶到 repo 最新版
-- (`20260905210000` 那一版;那支已貼,而它的後續七輪修改從來沒上線)。
-- 🔴 **這是正確性修正,不是整理**:舊版只判「手動 + 信箱留白」,
--    把**未付款 / 兩信箱皆空 / 已有 outbox** 的單也算進去 ⇒ **統計虛高**。
--
-- ══ 🛑 為什麼是 DROP + CREATE,不是 CREATE OR REPLACE ═════════════════════
-- 新版**欄位變了**(6 欄 ⇒ 6 欄但名稱與語意都換:多 `surface` / `shipment_id` /
-- `corrected_at_key`,少 `created_at` / `cancelled_at` / `payment_status`)
-- ⇒ `CREATE OR REPLACE VIEW` 不允許改欄名/型別/順序 ⇒ 只能 DROP 再 CREATE。
--
-- ══ 🔴 而 DROP VIEW 會把授權一起帶走 —— 本片最容易出錯的一格 ════════════
-- 🔬 貼前實查:`{postgres=arwdDxtm/postgres,service_role=rDxtm/postgres}`
-- 🛑 而 `20260905210000` 的 ACL 段只寫 `GRANT SELECT … TO service_role`
--    ⇒ **照抄它 = 把 service_role 從 `rDxtm` 安靜收窄成 `r`**,而那是**沒有人要求的改動**。
--    📌 今天收權限是因為 Sean 裁了,不是順手。⇒ **本片還原成【貼前那一組】。**
-- ✅ 後置比的是 `aclexplode` 展開後的**集合**,不是 `relacl::text` ——
--    收掉再給回來會讓那一項排到尾端,**比字串會假紅**(2026-09-18 實測)。
--
-- ══ 🔴 新版會讀 `order_cancellations` —— 而那是今天剛收掉的五張之一 ═══════
-- ⛔ ~~2026-09-19 早我回報過「那支 view 與今天收掉的五張【無交集】」~~
-- 🔴 **那句只對【舊版】。** 舊版只依賴 `orders`;**新版依賴七張,其中一張就是它。**
-- 🎯 **而錯的形狀值得記**:**我量了現況,回答了一個關於未來的問題。**
-- ✅ **而影響是零 —— 實查不是推**:
--      `service_role` 讀得到 `order_cancellations` ⇒ t   (view 的讀者之一)
--      `postgres`(owner)                          ⇒ t
--      ⚪ `pcm_readonly`                            ⇒ f   (今天收掉的,對照組成立)
--      而 `pcm_readonly` **本來就讀不到這支 view**   ⇒ f
--    ⇒ view 是 `security_invoker` ⇒ **兩個讀者都還讀得到底表 ⇒ 不會壞。**
--
-- ══ ⚪ 這支 view 是誰的、為誰服務 ═══════════════════════════════════════════
-- 讀者**只有 `postgres` 與 `service_role`**(2026-09-19 實查)——
-- 唯讀查帳帳號 `pcm_readonly` 進不來。⇒ 📌 **要看這張稽核面,得拿一把更大的鑰匙。**
-- (那件事本身是 plan §3-2 / §5 的待決題,**本片不處理**。)
--
-- ══ 🛑 本片刻意【不做】的 ═══════════════════════════════════════════════════
-- · **不加守「執行者不是 postgres」的閘** —— 貼法是 SQL Editor = `postgres` = owner,
--   那種閘的邊際安全是 0(2026-09-19 板 216 四輪的結論)。
--   ✅ **本片的風險在【view 的定義對不對】,閘就對準那個。**
-- · 不碰那四支 pending view、不碰 `20260905210000`(已貼檔是凍結的歷史)。
--
-- 還原:`supabase/rollbacks/20260919140000-rollback.sql`(DROP + 建回舊定義 + 還原 ACL)

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ───────────────────────────────────────────────────────────────
DO $pre$
-- 🔴 **這份清單是本片的收權斷言清單(靜態閘規則③ 會數它)。**
--   為什麼需要它:本片是**裸 `CREATE VIEW`**(不是 `OR REPLACE`)⇒ **`DROP` 會把 ACL 帶走**
--   ⇒ 建完必須重新確立權限, 而這份清單就是「哪幾個物件的 ACL 我負責還原」的宣告。
--   ⚪ 它**不是裝飾**:前置用它撈基準、後置用它逐一比對(見下面 ⑤ 與後置④)。
DECLARE
  -- 🔵 變數名用 `v_relations` 是 **repo 的慣例**, 不是隨手取的 ——
  --    `scripts/migration-static-checks.sh:714` 的規則③ 就是抓這個名字 + `]::text[]` 收尾。
  --    📌 取別的名字 ⇒ 那道閘數到 0 ⇒ 它會說「有漏列」, 而清單其實在那裡。
  v_relations text[] := ARRAY['public.pcm_manual_no_email_excluded']::text[];
  v_missing text; n_cols int; v_acl text; v_o text;
BEGIN
  -- ① view 在, 而且【是舊定義】—— 貼過一次也會走到這裡
  IF pg_catalog.to_regclass('public.pcm_manual_no_email_excluded') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.pcm_manual_no_email_excluded 不存在 ⇒ 停下(本片是換定義, 不是新建)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid='public.pcm_manual_no_email_excluded'::pg_catalog.regclass
                AND a.attname='surface' AND a.attnum>0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘①:那支 view 已經有 surface 欄 ⇒ 它已經是新定義了 ⇒ 本片貼過一次 ⇒ 停下來看';
  END IF;

  -- ② 🔴 新定義要用的【四支函式】都在, 而且簽章相符
  --    少一支 ⇒ CREATE VIEW 會炸在中途, 而錯誤訊息只會說某個函式不存在。
  SELECT pg_catalog.string_agg(x.f, ', ') INTO v_missing FROM (VALUES
    ('public.pcm_js_trim_whitespace()'),
    ('public.pcm_shipped_email_dedup_key(uuid, uuid)'),
    ('public.pcm_tracking_corrected_at_key(timestamptz)'),
    ('public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)')
  ) x(f) WHERE pg_catalog.to_regprocedure(x.f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:新定義要用的函式不存在(或簽章不同)⇒ %', v_missing;
  END IF;

  -- ③ 🔴 新定義要用的【七張表】都在
  --    其中 public.order_cancellations 是 2026-09-19 收掉 pcm_readonly SELECT 的五張之一,
  --    而本片的讀者(postgres / service_role)仍讀得到它 ⇒ 見檔頭。
  SELECT pg_catalog.string_agg(x.t, ', ') INTO v_missing FROM (VALUES
    ('public.customers'),('public.email_outbox'),('public.order_cancellations'),
    ('public.order_items'),('public.orders'),('public.shipment_items'),('public.shipments')
  ) x(t) WHERE pg_catalog.to_regclass(x.t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:新定義要用的表不存在 ⇒ %', v_missing;
  END IF;

  -- ④ 🔴 沒有別的物件依賴這支 view —— 有的話 DROP 會連帶或被擋
  --    🔬 2026-09-19 實查:0 個。這道閘把那個讀數變成一個會擋的條件。
  -- 🔴 **`DISTINCT` 不可以拿掉**:`pg_depend` 對一支 view **每一欄各一列** ⇒
  --    一個依賴者會被數成 6。🔬 實燒(2026-09-19):掛一支 view 上去 ⇒ 不加 DISTINCT 印「6 個物件」,
  --    而實際是 **1 個**。📌 **數字與實體脫鉤 —— 訊息會叫,而它報的數量是假的。**
  SELECT pg_catalog.count(DISTINCT dep.oid)::int INTO n_cols
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class dep ON dep.oid = r.ev_class
   WHERE d.refobjid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND dep.relname <> 'pcm_manual_no_email_excluded';
  IF n_cols <> 0 THEN
    RAISE EXCEPTION '前置閘④:有 % 個物件依賴這支 view ⇒ DROP 會連帶動到它們 ⇒ 停下(2026-09-19 實查為 0)', n_cols;
  END IF;

  -- ⑤ 🔴 把【貼前的 ACL】存起來 —— 後置要還原成這一組, 不是 repo 那兩行
  --    存的是 aclexplode 展開排序後的集合字串(不是 relacl::text ——
  --    收掉再給回來會讓那一項排到尾端, 比字串會假紅)。
  IF pg_catalog.array_length(v_relations, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '前置閘⑤:收權斷言清單不是 1 個 ⇒ 本片的範圍被改過而清單沒跟著改 ⇒ 停下';
  END IF;
  v_acl := '';
  FOREACH v_o IN ARRAY v_relations LOOP
    SELECT v_acl || v_o || '=' || COALESCE(pg_catalog.string_agg(
             g.grantee::text||':'||g.privilege_type, ',' ORDER BY g.grantee::text, g.privilege_type), '') || ';'
      INTO v_acl
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
     WHERE c.oid = v_o::pg_catalog.regclass;
  END LOOP;
  IF v_acl IS NULL OR v_acl = '' THEN
    RAISE EXCEPTION '前置閘⑤:撈不到 ACL(relacl 是 NULL?)⇒ 停下, 本片的還原斷言會沒有比對對象';
  END IF;
  PERFORM pg_catalog.set_config('pcm.v217_acl_pre', v_acl, true);
  RAISE NOTICE '🔬 貼前 ACL(集合):%', v_acl;

  RAISE NOTICE '✅ 前置閘全過:view 在且是舊定義 · 4 支函式在 · 7 張表在 · 零物件依賴它 · ACL 已存';
END $pre$;

-- ── 2. 動作 ─────────────────────────────────────────────────────────────────
DROP VIEW public.pcm_manual_no_email_excluded;

CREATE VIEW public.pcm_manual_no_email_excluded
  WITH (security_invoker = true) AS
WITH manual_blank AS (
  -- 🔴 **這是本檔第五份、也是最後一份值域** —— `notification-fallback-sql-parity.test.ts`
  --    把它與 TS 那份綁在一起(codex R2 ②)。
  SELECT o.id AS order_id
    FROM public.orders o
   WHERE o.order_source IN ('manual_phone', 'manual_line', 'manual_other')
     AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL
)
-- ① 本來會進 pcm_order_created_email_pending 的
SELECT
  'order_created'::text AS surface,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.order_source        AS order_source,
  NULL::text            AS shipment_id,
  NULL::text            AS corrected_at_key
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL

UNION ALL

-- ② 本來會進 pcm_shipped_email_pending 的(一批出貨一列, 不是一張單一列)
SELECT DISTINCT
  'order_shipped'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  NULL::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))

UNION ALL

-- ③ 本來會進 pcm_tracking_corrected_email_pending 的
SELECT DISTINCT
  'shipment_tracking_corrected'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at)::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
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
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at))

UNION ALL

-- ④ 本來會進 pcm_unpaid_cancelled_email_pending 的
SELECT
  'order_unpaid_cancelled'::text,
  o.id,
  o.display_id,
  o.order_source,
  NULL::text,
  NULL::text
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
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
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
;

-- ── 3. 還原 ACL ─────────────────────────────────────────────────────────────
-- 🔴 **還原成【貼前那一組】, 不是 repo 那兩行** —— 見檔頭。
--    貼前實查:{postgres=arwdDxtm/postgres, service_role=rDxtm/postgres}
--    · postgres 是 owner ⇒ 它那一組 CREATE VIEW 時自動就有, 不用寫。
--    · service_role 的 rDxtm = SELECT / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN。
-- 🛑 anon / authenticated / PUBLIC 貼前就沒有 ⇒ 本片也不給(DROP 之後它們本來就是空的)。
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.pcm_manual_no_email_excluded TO service_role;

-- ── 4. 後置斷言 ─────────────────────────────────────────────────────────────
DO $post$
-- 🛑 **與前置同一份清單** —— 兩邊不一致就不是在比同一組東西。
DECLARE
  v_relations text[] := ARRAY['public.pcm_manual_no_email_excluded']::text[];
  v_acl_pre text; v_acl_now text; v_cols text; n_src int; v_o text;
BEGIN
  -- ⓪ 讀得到前置存的值 —— 讀不到 = 沒跑在同一個 transaction 裡
  v_acl_pre := NULLIF(pg_catalog.current_setting('pcm.v217_acl_pre', true), '');
  IF v_acl_pre IS NULL THEN
    RAISE EXCEPTION '後置閘⓪:讀不到前置存的 ACL 基準 ⇒ 本檔沒跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;

  -- ① 🎯 **定義真的換了** —— 本片唯一要做的事。欄位逐字比對。
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_manual_no_email_excluded'::pg_catalog.regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'surface,order_id,display_id,order_source,shipment_id,corrected_at_key' THEN
    RAISE EXCEPTION '後置閘①:欄位不是新定義那一組 ⇒ 實得【%】⇒ 拒 COMMIT', v_cols;
  END IF;

  -- ② 🔴 **四塊 surface 都在** —— 欄名對不保證內容對(少一塊 UNION 欄名一樣)。
  --    這一格問的是【定義本文】, 與 ① 是兩把不同的尺。
  SELECT (SELECT pg_catalog.count(*)::int FROM (VALUES
            ('order_created'),('order_shipped'),('shipment_tracking_corrected'),('order_unpaid_cancelled')
          ) s(k)
          WHERE pg_catalog.pg_get_viewdef('public.pcm_manual_no_email_excluded'::pg_catalog.regclass, true)
                LIKE '%''' || s.k || '''%')
    INTO n_src;
  IF n_src <> 4 THEN
    RAISE EXCEPTION '後置閘②:定義本文裡只找到 % 塊 surface(應為 4)⇒ 貼進去的不是完整那一版 ⇒ 拒 COMMIT', n_src;
  END IF;

  -- ③ 🔴 **它是 security_invoker** —— 少了這個, 讀者會用 owner 的身分讀, 射程整個變了。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid='public.pcm_manual_no_email_excluded'::pg_catalog.regclass
       AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '後置閘③:那支 view 不是 security_invoker ⇒ 讀者會用 owner 的身分讀 ⇒ 拒 COMMIT';
  END IF;

  -- ④ 🔴 **ACL 與貼前【一模一樣】** —— DROP VIEW 會帶走授權, 這一格是本片最容易出錯的地方。
  --    比的是 aclexplode 展開排序後的集合, 不是 relacl::text(順序會變 ⇒ 比字串會假紅)。
  v_acl_now := '';
  FOREACH v_o IN ARRAY v_relations LOOP
    SELECT v_acl_now || v_o || '=' || COALESCE(pg_catalog.string_agg(
             g.grantee::text||':'||g.privilege_type, ',' ORDER BY g.grantee::text, g.privilege_type), '') || ';'
      INTO v_acl_now
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) g
     WHERE c.oid = v_o::pg_catalog.regclass;
  END LOOP;
  IF v_acl_now IS DISTINCT FROM v_acl_pre THEN
    RAISE EXCEPTION '後置閘④:ACL 與貼前不同 ⇒ 貼前【%】· 現在【%】⇒ 拒 COMMIT(DROP VIEW 會帶走授權, 這一格就是在守它)', v_acl_pre, v_acl_now;
  END IF;

  -- ⑤ 🔴 **`security_invoker` ⇒ body 裡那四支函式用【呼叫者】的權限跑。**
  --    ⇒ 若某個讀者的 EXECUTE 被收掉過, **view 建得起來、靜態全綠, 而查它的人一次錯一次。**
  --    🛑 這道斷言是 `scripts/invoker-view-execute-gate.py` 叫出來的, 而它叫得對。
  --    🔬 2026-09-19 正式庫實查:四支對 `service_role` 與 `postgres` 皆 **t**
  --       ⚪ 判別力對照:同一把尺問 `anon` ⇒ **f**(所以不是對誰都回 t)
  --    🔵 而 `pcm_js_trim_whitespace` **舊定義就在用**(實查)⇒ 那條路今天已經在跑。
  --    ⚠️ **那道閘自己說它不驗「斷言問對了角色」** ⇒ 這裡問的是**這支 view 真正的兩個讀者**
  --       (`postgres` 與 `service_role`, 2026-09-19 實查的 ACL)—— 不是隨便挑一個角色來湊。
  -- 🛑 **寫成【字面】不是迴圈 —— 這不是囉嗦, 是刻意的。**
  --    `scripts/invoker-view-execute-gate.py` 是**字面尺**, 而它自己列的盲區逐字:
  --      「函式名放在字串/變數裡, 字面尺【撈不到它】」
  --    🔬 我第一版用 `FOREACH v_o IN ARRAY ARRAY[…]` ⇒ **那道閘照樣說「沒有一條事後斷言」**
  --    ⇒ 📌 **一個更聰明的寫法, 讓一道守門看不見它要守的東西。**
  --    ⚪ 而人也一樣:字面寫出來, `grep` 得到「這支 view 斷言了哪四支函式」。
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('postgres', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:postgres 叫不動 public.pcm_js_trim_whitespace() ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_shipped_email_dedup_key(uuid,uuid) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('postgres', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:postgres 叫不動 public.pcm_shipped_email_dedup_key(uuid,uuid) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('postgres', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:postgres 叫不動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:service_role 叫不動 public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;
  IF NOT pg_catalog.has_function_privilege('postgres', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:postgres 叫不動 public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) ⇒ 這支 view 是 security_invoker, 它會【建得起來而查不動】⇒ 拒 COMMIT';
  END IF;

  -- ⑥ ⚪ 它讀得出來 —— 定義語法對 ≠ 跑得動(欄型別不合、函式簽章不合都在這裡才炸)。
  PERFORM 1 FROM public.pcm_manual_no_email_excluded LIMIT 1;

  RAISE NOTICE '✅ 後置閘:欄位 = 新定義那六個 · 四塊 surface 都在 · security_invoker · ACL 與貼前一字不差 · 兩個讀者都叫得動那四支函式 · 查得動';
  RAISE NOTICE '⏳ 貼完請跑:SELECT public.pcm_acl_digest_record(); 再 pcm_acl_approve_latest(理由帶版本號); 再 pcm_acl_drift_status —— 順序不能反。';
END $post$;

COMMIT;
