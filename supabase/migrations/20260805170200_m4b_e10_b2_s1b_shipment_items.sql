-- ============================================================
-- M-4b E10 第 2 批 B2 · S1b:出貨品項表 + parent guard + X1
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md`(v5.3)§2/§3。
-- 本片 = `public.shipment_items` + append-only + parent guard(X3+A7 合一支)
--        + **X1(離開草稿態必有品項,掛在 `shipments` 上)** + ACL/RLS。
--
-- 🔴 **X1 為什麼在本片而不是 S1a-2**:它的函式要 `SELECT … FROM public.shipment_items`,
--    而那張表本片才建。實測:`CREATE FUNCTION` 引用不存在的表**會建成功**,錯誤要到執行時
--    才以 `42P01 relation does not exist` 爆出來 ⇒ 放 S1a-2 的話,該片的 X1 負測會紅在
--    「缺表」而不是「守門」(測到的東西不是要測的東西)。K1 R3-Fable must-fix。
--
-- 🔴 本片交付後仍**零 writer**:兩表對 service_role 只有 SELECT,出貨 owner RPC 在 MP §5.2 項 2。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 前置閘:pin S1a-2 的產物(forward-only、拒亂序與重跑)。
-- 🔴 v5.4(codex K2 #14):改具名集合 + 啟用狀態雙向,不再只數 trigger 數量。
-- 🔴 v5.4(codex K2 #2):**加 anti-join 掃既有列**。理由見下方大段。
DO $gate$
DECLARE
  v_actual text[];
  v_bad    integer;
BEGIN
  SELECT array_agg(tgname || ':' || tgenabled::text ORDER BY tgname) INTO v_actual
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal;
  IF v_actual IS DISTINCT FROM ARRAY[
       'shipments_block_delete_bd:O','shipments_block_truncate_bt:O',
       'shipments_frozen_after_ship_bu:O','shipments_immutable_guard_bu:O',
       'shipments_touch_updated_at_bu:O','shipments_write_once_bu:O'] THEN
    RAISE EXCEPTION 'S1b 前置閘:shipments 的 trigger 集合/啟用狀態不符(應為 S1a-1+S1a-2 的 6 支全啟用),實際 = %;拒繼續', v_actual;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class
              WHERE relname = 'shipment_items' AND relnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'S1b 前置閘:本片產物已存在 —— 不得重跑;拒繼續';
  END IF;

  -- 🔴🔴 **anti-join:X1 只守事件,不回頭掃既有列**(codex K2 #2,夜跑實測確認)。
  --    X1 是 DEFERRABLE constraint trigger ⇒ **只對 INSERT/UPDATE 事件發火**。
  --    實測:在 X1 不存在的期間寫一筆「已出貨 + submitted + 零品項」列,之後把 X1 建起來、
  --    再 `SET CONSTRAINTS ALL IMMEDIATE`,那筆壞列**原封不動存活**(`BAD_ROW_SURVIVES_X1=1`),
  --    而 v5.3 的前置閘只數 trigger 數 ⇒ 完全沒注意到。
  --    ⇒ S1a-2 與 S1b 之間存在一個「X1 尚未生效」的窗口(apply 非原子,§8 cut point ②)。
  --
  -- 🔴 **誠實邊界**:本批兩表**零應用 writer**(service_role 只有 SELECT)⇒ 今天沒有任何應用路徑
  --    能在那個窗口寫進壞列 ⇒ 這道閘**不是在修一個今天可觸發的漏洞**,是在「未來 writer 落地前
  --    就先站好的哨」。它的成本是一次 count,值得。
  SELECT count(*) INTO v_bad
    FROM public.shipments s
   WHERE (s.shipped_at IS NOT NULL OR s.hct_status <> 'draft');
  IF v_bad > 0 THEN
    -- 本片建表前 shipment_items 還不存在 ⇒ 任何「已離開草稿態」的列必然零品項。
    RAISE EXCEPTION 'S1b 前置閘:發現 % 筆「已離開草稿態」的既有包裹,而 shipment_items 尚未建立 '
                    '⇒ 它們必然零品項、且 X1 建立後也不會回頭抓(X1 只對事件發火)。'
                    '請先人工處置這些列再套本片;拒繼續', v_bad;
  END IF;
END;
$gate$;

-- ── 1. 品項表 ────────────────────────────────────────────────
CREATE TABLE public.shipment_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      uuid        NOT NULL REFERENCES public.shipments(id)   ON DELETE RESTRICT,
  order_item_id    uuid        NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  shipped_quantity integer     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shipment_items_quantity_positive CHECK (shipped_quantity > 0),

  -- 🔴 唯一鍵只鎖「同一箱內同一品項不得重複」——**刻意不鎖跨箱**:
  --    同一個 order_item 可以出現在多張包裹(分批出貨),也**必須**能在原箱作廢後進新箱
  --    (Sean 2026-08-05 Q-a=C 的補救路徑「作廢重開」全靠這件事成立)。
  CONSTRAINT shipment_items_shipment_order_item_unique UNIQUE (shipment_id, order_item_id)
);

COMMENT ON TABLE public.shipment_items IS
  'M-4b E10 第 2 批:包裹內容(B2 停損版 S1b)。append-only —— 入箱後不可改、不可刪(A6)。'
  '🔴 Sean 2026-08-05 Q-a=C 知情拍板:**裝箱數量打錯的唯一補救 = 整箱作廢重開**,'
  '資料庫刻意不放寬;補救的便利性做在出貨畫面的「照這箱內容開一張新的」按鈕(MP §5.2 項 3 DoD)。'
  '🔴 本表的 append-only 同時是 X1 的承重件:X1 只掛 shipments,靠「品項數單調不減」才夠用 —— '
  '若未來開放刪品項,X1 必須同時改成雙支(子表那支要含 DELETE),否則「送單後把品項刪光」不會被擋。';

COMMENT ON COLUMN public.shipment_items.shipped_quantity IS
  '本箱出貨數量。🔴 本批**不強制 shipped ≤ instock**(摘要欄與重算都不在本批);'
  '強制點未定案 —— Sean 2026-08-05 已拍 Q1=A 走摘要表 CHECK(C9),由 S2 那片落地。';

-- 重算 shipped 時要按 order_item 聚合;PG 不會自動為 FK 來源端建索引。
CREATE INDEX shipment_items_order_item_id_idx ON public.shipment_items (order_item_id);

-- ── 2. A6:append-only(不可改、不可刪、不可 TRUNCATE)──────────
CREATE FUNCTION public.pcm_b2_shipment_items_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION
    '包裹內容 append-only:入箱後不可改也不可刪(TG_OP=%)。'
    '裝箱打錯的補救 = 整箱作廢重開(Sean 2026-08-05 Q-a=C)', TG_OP
    USING ERRCODE = 'P0001', CONSTRAINT = 'shipment_items_append_only';
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipment_items_append_only() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipment_items_block_delete_bd
  BEFORE DELETE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipment_items_append_only();

CREATE TRIGGER shipment_items_block_update_bu
  BEFORE UPDATE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipment_items_append_only();

-- 🔴 TRUNCATE 不觸發列觸發器 ⇒ 另掛 statement 級。
CREATE TRIGGER shipment_items_block_truncate_bt
  BEFORE TRUNCATE ON public.shipment_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_b2_shipment_items_append_only();

-- ── 3. parent guard:X3(已寄出/已作廢禁加品項)+ A7(併箱同客人)─────
-- 🔴 **一支 trigger、一次鎖、兩段判斷、兩個 CONSTRAINT 名歸因**:
--    兩條守門都要鎖同一個 parent,分成兩支等於**對同一列多取一次鎖**。
--    🔴 v5.4(codex K2 nit 2):原文寫「多一個死結面」—— **那句沒有 wait-graph 證據支撐**,
--    降級為可驗證的字面:「少一次鎖」。(兩支都取同型 `FOR NO KEY UPDATE`、且順序相同時,
--    是否真的多出一個死結面要看實際的鎖序圖,本批沒做那個分析 ⇒ 不宣稱。)
-- 🔴 鎖原語 `FOR NO KEY UPDATE`(A4a `20260803140000:20` 的契約):
--    `FOR UPDATE` 與 FK RI 的 KEY SHARE 會死結(40P01 實測)。
-- 🔴 **這把 NKU 同時是未來 shipped 重算的承重件**(K1 R3 F8「未具名承重件」——這裡具名):
--    改成非鎖讀法會讓 S2 的 shipped 靜默少算。宣告用途是「禁事後加貨」,但它撐的不只那個。
-- 🔴 **必須 NOT DEFERRABLE**:若 INITIALLY DEFERRED,合法主流程「加品項 → 設 shipped_at → commit」
--    會在 commit 當下看到 parent 已寄出而**誤殺**(本機實測重現)。
-- SECURITY DEFINER:兩張表是 zero-grant + RLS zero-policy ⇒ 要以 owner 身分才讀得到
--    (前提:函式 owner = 表 owner 且兩表**未** FORCE RLS;S1a-1 的 DO 已釘住後者)。
CREATE FUNCTION public.pcm_b2_shipment_items_parent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_shipped   timestamptz;
  v_deleted   timestamptz;
  v_ship_cust uuid;
  v_ref       text;
  v_item_cust uuid;
BEGIN
  SELECT s.shipped_at, s.deleted_at, s.customer_user_id, s.shipment_reference
    INTO v_shipped, v_deleted, v_ship_cust, v_ref
    FROM public.shipments s
   WHERE s.id = NEW.shipment_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- 防衛枝:FK RESTRICT 應已先擋,走到這裡代表 FK 被拿掉或關掉了。
    RAISE EXCEPTION 'B2 防衛枝:shipments % 不存在(FK 應已先擋)', NEW.shipment_id;
  END IF;

  IF v_shipped IS NOT NULL OR v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      '包裹已寄出或已作廢,不可再加品項(shipment=%)', v_ref
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipment_items_parent_open';
  END IF;

  SELECT o.customer_user_id INTO v_item_cust
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.id = NEW.order_item_id;
  IF v_item_cust IS DISTINCT FROM v_ship_cust THEN
    RAISE EXCEPTION
      '併箱只認同一位客人(shipment=%):該品項屬於別的客人', v_ref
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipment_items_same_customer';
  END IF;

  RETURN NULL;   -- AFTER trigger 的回傳值被忽略;此處非 BEFORE、不會吞掉寫入
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipment_items_parent_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER shipment_items_parent_guard_ac
  AFTER INSERT ON public.shipment_items
  NOT DEFERRABLE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipment_items_parent_guard();

-- ── 4. X1:離開草稿態的包裹必有品項(掛 shipments、DEFERRED)────────
-- 🔴 `AFTER INSERT OR UPDATE`(**兩個事件面都要**):只掛 UPDATE 的話,
--    一筆 INSERT 直接帶 shipped_at 就繞過去了(K1 R3 F12)。
-- 🔴 條件是 `hct_status <> 'draft'` **不是** `= 'submitted'`:
--    `failed` 面同樣可達(草稿直接改 failed),漏掉它等於留著 F2 那族缺口的一半。
-- 🔴 **必須 DEFERRED**:建包裹與加品項是不同語句,IMMEDIATE 會誤擋合法流程。
-- 🔴 函式**重讀該列現況、不信 NEW**:`WHEN` 在列操作當下求值、檢查卻在 commit 才跑
--    ⇒ 同一交易內「暫時設 submitted 再改回 draft、零品項」是**合法終態**,
--    信 NEW 的寫法會把它誤殺(形狀抄 A7-t `20260730140000:167-177` 的重讀 + CONTINUE)。
CREATE FUNCTION public.pcm_b2_shipments_items_presence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_shipped timestamptz;
  v_status  text;
  v_ref     text;
  v_cnt     integer;
BEGIN
  SELECT s.shipped_at, s.hct_status, s.shipment_reference
    INTO v_shipped, v_status, v_ref
    FROM public.shipments s
   WHERE s.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;   -- 同交易內已被刪(本批無刪除路徑,防衛用)⇒ 無不變式可驗
  END IF;

  -- 重讀後若已回到草稿態,本次事件的觸發條件已不成立 ⇒ 放行。
  IF v_shipped IS NULL AND v_status = 'draft' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.shipment_items si
   WHERE si.shipment_id = NEW.id;

  IF v_cnt = 0 THEN
    RAISE EXCEPTION
      '包裹已離開草稿態(已寄出或已送新竹)但沒有任何品項(shipment=%)', v_ref
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_items_presence';
  END IF;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_items_presence() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER shipments_items_presence_ac
  AFTER INSERT OR UPDATE ON public.shipments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.shipped_at IS NOT NULL OR NEW.hct_status <> 'draft')
  EXECUTE FUNCTION public.pcm_b2_shipments_items_presence();

-- ── 5. RLS zero-policy + 表級 ACL ────────────────────────────
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipment_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shipment_items TO service_role;

-- ── 6. 結構驗收 ──────────────────────────────────────────────
-- 🔴 v5.4 全面改寫(codex K2 #4/#12/#13):
--   #12 v5.3 用 `IF (SELECT … FROM pg_trigger WHERE tgname=…) THEN` —— 物件不存在時 subquery = NULL,
--       `IF NULL` **不進 THEN、不 RAISE**(夜跑實測 `SILENTLY_PASSED`)⇒ 消融該 trigger 後驗收照樣過。
--       全部改成 `NOT EXISTS(… AND <條件>)`:「不存在」與「存在但形狀錯」**兩種都會紅**。
--   #13 v5.3 完全沒驗 shipment_items 的約束集合 / 兩支 FK / quantity CHECK / unique 形狀 / index 欄位。
DO $verify$
DECLARE
  v_cnt      integer;
  v_actual   text[];
  v_name     text;
  v_owner    oid;
  v_pair     text[];
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.shipment_items'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — shipment_items 應 5 欄,實 %;拒繼續', v_cnt;
  END IF;

  -- ① 具名約束集合雙向(排除 contype='t':parent guard 是 constraint trigger,形狀另驗)
  SELECT array_agg(conname ORDER BY conname) INTO v_actual
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.shipment_items'::regclass AND contype IN ('p','u','f','c');
  IF v_actual IS DISTINCT FROM ARRAY[
       'shipment_items_order_item_id_fkey',
       'shipment_items_pkey',
       'shipment_items_quantity_positive',
       'shipment_items_shipment_id_fkey',
       'shipment_items_shipment_order_item_unique'] THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — shipment_items 約束集合不符,實際 = %;拒繼續', v_actual;
  END IF;

  -- ② 兩支 FK 的**定義逐字**(含 ON DELETE RESTRICT —— 改成 CASCADE 會讓 append-only 形同虛設)
  FOREACH v_name IN ARRAY ARRAY[
      'shipment_items_shipment_id_fkey|FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT',
      'shipment_items_order_item_id_fkey|FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT'] LOOP
    v_pair := string_to_array(v_name, '|');
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conrelid = 'public.shipment_items'::regclass
                      AND conname = v_pair[1]
                      AND pg_catalog.pg_get_constraintdef(oid) = v_pair[2]) THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — FK % 不存在或定義不符(期望 %);拒繼續', v_pair[1], v_pair[2];
    END IF;
  END LOOP;

  -- ③ quantity CHECK 定義逐字
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.shipment_items'::regclass
                    AND conname = 'shipment_items_quantity_positive'
                    AND pg_catalog.pg_get_constraintdef(oid) = 'CHECK ((shipped_quantity > 0))') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — quantity CHECK 不存在或定義不符;拒繼續';
  END IF;

  -- ④ 三個索引定義全等(欄位 + 唯一性一次釘死)
  FOREACH v_name IN ARRAY ARRAY[
      'public.shipment_items_pkey|CREATE UNIQUE INDEX shipment_items_pkey ON public.shipment_items USING btree (id)',
      'public.shipment_items_shipment_order_item_unique|CREATE UNIQUE INDEX shipment_items_shipment_order_item_unique ON public.shipment_items USING btree (shipment_id, order_item_id)',
      'public.shipment_items_order_item_id_idx|CREATE INDEX shipment_items_order_item_id_idx ON public.shipment_items USING btree (order_item_id)'] LOOP
    v_pair := string_to_array(v_name, '|');
    IF pg_catalog.pg_get_indexdef(v_pair[1]::regclass) <> v_pair[2] THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — 索引 % 定義不符,實際 = %;拒繼續',
        v_pair[1], pg_catalog.pg_get_indexdef(v_pair[1]::regclass);
    END IF;
  END LOOP;

  -- ⑤ 品項表 4 支 trigger,具名 + 啟用狀態雙向
  SELECT array_agg(tgname || ':' || tgenabled::text ORDER BY tgname) INTO v_actual
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipment_items'::regclass AND NOT tgisinternal;
  IF v_actual IS DISTINCT FROM ARRAY[
       'shipment_items_block_delete_bd:O','shipment_items_block_truncate_bt:O',
       'shipment_items_block_update_bu:O','shipment_items_parent_guard_ac:O'] THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — shipment_items trigger 集合/啟用狀態不符,實際 = %;拒繼續', v_actual;
  END IF;

  -- ⑥ parent guard 必須 NOT DEFERRABLE(NULL-safe:不存在也要紅)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.shipment_items'::regclass
                    AND tgname = 'shipment_items_parent_guard_ac'
                    AND NOT tgdeferrable) THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — parent guard 不存在、或不是 NOT DEFERRABLE'
                    '(誤設 DEFERRED 會誤殺「加品項→設 shipped_at→commit」的合法主流程);拒繼續';
  END IF;

  -- ⑦ X1:存在 + DEFERRABLE INITIALLY DEFERRED + 事件面含 INSERT 與 UPDATE(NULL-safe)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.shipments'::regclass
                    AND tgname = 'shipments_items_presence_ac'
                    AND tgdeferrable AND tginitdeferred
                    AND (tgtype & 4) <> 0 AND (tgtype & 16) <> 0) THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — X1 不存在、或不是 DEFERRABLE INITIALLY DEFERRED、'
                    '或事件面沒有同時含 INSERT 與 UPDATE(只有 UPDATE 會被一筆帶 shipped_at 的 INSERT 繞過);拒繼續';
  END IF;

  -- ⑧ X1 的 WHEN 必須用 `<> ''draft''`(NULL-safe:trigger 不存在時 NOT EXISTS 直接紅)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.shipments'::regclass
                    AND t.tgname = 'shipments_items_presence_ac'
                    AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%hct_status <> ''draft''%') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — X1 的 WHEN 條件必須是 hct_status <> ''draft'''
                    '(用 = ''submitted'' 會漏掉 failed 面);拒繼續';
  END IF;

  -- ⑨ X1 函式必須「重讀現況」(NULL-safe)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                  WHERE oid = 'public.pcm_b2_shipments_items_presence()'::regprocedure
                    AND prosrc LIKE '%FROM public.shipments%') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — X1 函式不存在、或未重讀 shipments 現況列(只信 NEW 會誤殺暫態);拒繼續';
  END IF;

  -- ⑩ 名稱序契約的**反身性**:本片在 shipments 上加了 X1 ⇒ 重跑 S1a-2 立的名稱序斷言
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO v_name
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal
     AND (tgtype & 16) <> 0 AND (tgtype & 2) <> 0;
  IF v_name <> 'shipments_frozen_after_ship_bu,shipments_immutable_guard_bu,'
               || 'shipments_touch_updated_at_bu,shipments_write_once_bu' THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — S1a-2 的名稱序契約被本片破壞,實際序 = %;拒繼續', v_name;
  END IF;

  -- ⑪ RLS / 表 ACL
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.shipment_items'::regclass) THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — RLS 未啟用;拒繼續';
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.shipment_items'::regclass) THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — 不得 FORCE RLS(owner 守門會讀不到);拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policy WHERE polrelid = 'public.shipment_items'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — 應為 zero-policy,實 % 條;拒繼續', v_cnt;
  END IF;
  IF NOT has_table_privilege('service_role', 'public.shipment_items', 'SELECT') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — service_role 應有 SELECT;拒繼續';
  END IF;
  IF has_table_privilege('service_role', 'public.shipment_items', 'INSERT')
     OR has_table_privilege('service_role', 'public.shipment_items', 'UPDATE')
     OR has_table_privilege('service_role', 'public.shipment_items', 'DELETE')
     OR has_table_privilege('service_role', 'public.shipment_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — service_role 只應有 SELECT(本批零 writer);拒繼續';
  END IF;
  IF has_table_privilege('anon', 'public.shipment_items', 'SELECT')
     OR has_table_privilege('authenticated', 'public.shipment_items', 'SELECT') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — client 角色不應直接讀得到包裹內容;拒繼續';
  END IF;

  -- ⑫ 🔴 三支函式面合約:regprocedure 為鍵,owner / prosecdef / proconfig 逐字 / 零非 owner grantee
  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = 'public.shipment_items'::regclass;
  FOREACH v_name IN ARRAY ARRAY[
      'public.pcm_b2_shipment_items_append_only()|f|search_path=pg_catalog, public',
      'public.pcm_b2_shipment_items_parent_guard()|t|search_path=public, pg_temp',
      'public.pcm_b2_shipments_items_presence()|t|search_path=public, pg_temp'] LOOP
    v_pair := string_to_array(v_name, '|');
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_pair[1]::regprocedure) THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — 函式 % 不存在;拒繼續', v_pair[1];
    END IF;
    IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_pair[1]::regprocedure) <> v_owner THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — % 的 owner 與表 owner 不一致'
                      '(SECURITY DEFINER 以 owner 身分起跑 ⇒ 這條是承重的);拒繼續', v_pair[1];
    END IF;
    IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_pair[1]::regprocedure) <> (v_pair[2] = 't') THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — % 的 SECURITY DEFINER 狀態不符(期望 %);拒繼續', v_pair[1], v_pair[2];
    END IF;
    -- proconfig:第一段必須逐字相符(SECDEF 兩支另有 lock_timeout,單獨驗)
    IF (SELECT proconfig[1] FROM pg_catalog.pg_proc WHERE oid = v_pair[1]::regprocedure)
       IS DISTINCT FROM v_pair[3] THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — % 的 search_path 應恰為 %,實 %;拒繼續',
        v_pair[1], v_pair[3], (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_pair[1]::regprocedure);
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc pr, aclexplode(pr.proacl) a
     WHERE pr.oid = v_pair[1]::regprocedure AND a.grantee <> pr.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — % 除 owner 外仍有 % 個 grantee;拒繼續', v_pair[1], v_cnt;
    END IF;
  END LOOP;

  -- ⑬ 兩支 SECDEF 必須釘 lock_timeout(避免守門把 parent 鎖住不放)
  FOREACH v_name IN ARRAY ARRAY['public.pcm_b2_shipment_items_parent_guard()',
                                'public.pcm_b2_shipments_items_presence()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                    WHERE oid = v_name::regprocedure
                      AND 'lock_timeout=5s' = ANY(proconfig)) THEN
      RAISE EXCEPTION 'S1b 驗收失敗 — % 必須釘 lock_timeout=5s;拒繼續', v_name;
    END IF;
  END LOOP;

  -- ⑭ parent guard 的鎖原語字面錨(plan §4 項 21b 的承重件;改普通 SELECT 會讓 S2 的重算靜默少算)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                  WHERE oid = 'public.pcm_b2_shipment_items_parent_guard()'::regprocedure
                    AND prosrc LIKE '%FOR NO KEY UPDATE%') THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — parent guard 必須以 FOR NO KEY UPDATE 鎖 parent'
                    '(改普通 SELECT 會讓併箱與出貨的競態放行,且 S2 的 shipped 重算會靜默少算);拒繼續';
  END IF;

  -- ⑮ 本批零 writer 的自我證明
  SELECT count(*) INTO v_cnt FROM public.shipment_items;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 驗收失敗 — 本片不 seed 任何列,實 % 列;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'B2 S1b 結構驗收全數通過(5 欄 / 5 具名約束雙向 / 2 FK 定義逐字 / quantity CHECK / 3 索引定義全等 / 4 trigger 具名+啟用 / parent guard NOT DEFERRABLE / X1 DEFERRED+雙事件面+<>draft+重讀 / 名稱序反身性 / RLS+ACL 正反面 / 3 函式 owner+secdef+search_path+零 grantee / lock_timeout / NKU 字面錨 / 0 列)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(反向序 **S1b** → S1a-2 → S1a-1):
--   ① DROP TRIGGER shipment_items_block_delete_bd / _block_update_bu / _block_truncate_bt
--      / shipment_items_parent_guard_ac
--   ② 🔴 **DROP TRIGGER shipments_items_presence_ac ON public.shipments**
--      —— X1 屬本片,卻**掛在另一張表上**,是最容易漏掉的一支
--   ③ DROP FUNCTION pcm_b2_shipment_items_append_only / pcm_b2_shipment_items_parent_guard
--      / pcm_b2_shipments_items_presence(DROP TABLE 不帶走獨立函式)
--   ④ DROP TABLE public.shipment_items(index 隨表走)
--   ⑤ 重 gen database.types.ts
-- ============================================================
