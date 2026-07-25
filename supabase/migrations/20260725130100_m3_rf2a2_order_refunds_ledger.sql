-- M-3 RF2a-2:退款帳本(order_refunds + order_refund_items)
--
-- 目的:退刷線 RF2b(退款 RPC)/ RF5(server action)/ RF6(後台 UI)/ RF8(隔日覆核)的落帳基礎。
-- 拍板:Sean 2026-07-25 Q2=A(同片改 TS)/ Q3=A(拆兩支 migration + preview branch 實測)/ Q4=B(不拆片)。
--       上位 PRD = docs/specs/2026-07-24-refund-automation-line-prd.md §0b/§4(D1=B 部分退、D2=A 冪等、D4=B 隔日覆核)。
--       plan 真權威 = docs/specs/2026-07-25-m3-rf2a-refund-ledger-plan.md(v3;codex 關卡1 R1+R2 折入)。
-- 依賴:20260604120000(orders / order_items / payment_status enum)、20260712210000(admin_audit_log = ACL 樣板)、
--       20260717020000(email_outbox = aclexplode/attacl 斷言樣板,:448-475)、20260725130000(RF2a-1 enum 加值)。
-- 鐵則:12 ①錢 + ③DB 結構(新表 + 動既有 live 表 order_items 加 UNIQUE)。高風險片、審查不降級。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 本檔自帶顯式 BEGIN/COMMIT(與 RF2a-1 相反)
-- ────────────────────────────────────────────────────────────────────────────
-- 本檔不含 ALTER TYPE ... ADD VALUE ⇒ 不受「新值不能在同交易使用」的限制,可包交易。
-- 必須包的理由(codex 關卡1 R1):若 CREATE TABLE 成功而後續 REVOKE / RLS / 斷言失敗,
-- 會留下「表已建、但 Supabase 對新表的 default privileges 仍在」的直寫面 = 半套用的安全破口。
-- 🔴 本 repo 已實證 migration 檔**不保證**跑在單一交易內(SET LOCAL 是 no-op、RF2a-0 Fable F1 實錘)
--    ⇒ 原子性只能靠本檔自己包。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 刻意偏離既有先例:本表加 CONSTRAINT TRIGGER 驗「header 金額 = Σ 明細」
-- ────────────────────────────────────────────────────────────────────────────
-- 20260604120000 檔尾對 orders.subtotal = Σ(order_items.line_total) 的**既有決定**逐字為:
--   「由 create_order RPC 單一寫入者保證 + S2-b 交易測試覆蓋。不加 deferrable trigger(RPC 權威已足、避免複雜度)。」
-- 本檔**不跟隨**該先例,理由=其前提在此不成立:
--   ① 那條先例成立於「唯一寫入者 create_order RPC 已存在且已驗證」;
--   ② 本片交付後帳本**零寫入端**(RF2b RPC 尚未存在),沒有任何 RPC 權威可倚賴;
--   ③ codex 關卡1 兩輪均判定:缺此防線時 header 與明細可各自合法卻互相矛盾(金流帳本不可接受)。
-- ⇒ 加 trigger 為刻意決定、非疏忽;若日後 RF2b 落地後認為重複,移除需另片評估(不可順手砍)。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 本檔**不做**、留給後續片的防線(誠實揭示,不得宣稱帳本已完備)
-- ────────────────────────────────────────────────────────────────────────────
-- ① **跨次累積超退**:同一品項用兩個不同 bank_refund_id 各退一次,本檔擋不住。
--    (單次超量有擋 = 驗證函式第 ③ 段;跨次需「原始數量 − 已退總量 ≥ 本次」的跨列聚合 + FOR UPDATE 鎖,
--     鎖順序必須與 RF2b 的 admin_refund_order_items RPC 同片設計,分開做兩邊鎖策略會打架。)
--    ⇒ 防線歸屬 RF2b,見 plan §6.6 / §12.2。
-- ② **運費欄與 orders 的綁定**:shipping_fee_before/after 只有值域上界,未與該單實際運費對照。
--    ⇒ 權威驗證歸屬 RF2b(同交易 JOIN orders + RF2a-0 凍結欄重算),見 plan §6.3-3。

BEGIN;

-- ══ 0. 前置斷言:order_items 現況符合預期 ════════════════════════════════════
DO $$
DECLARE
  v_cnt integer;
BEGIN
  -- 0a. order_items 的 PK 必須是單欄 id(複合 FK 設計建立在此之上)。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.order_items'::regclass
     AND contype = 'p'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'public.order_items'::regclass AND attname = 'id')];
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'RF2a-2 前置失敗 — order_items 的 PK 不是單欄 id(實 % 筆符合);複合 FK 設計前提不成立,拒繼續', v_cnt;
  END IF;

  -- 0b. (order_id, id) 現況無重複(加 UNIQUE 前的安全確認;id 為 PK 時理應恆成立,仍顯式驗)。
  SELECT count(*) INTO v_cnt
    FROM (SELECT order_id, id FROM public.order_items GROUP BY order_id, id HAVING count(*) > 1) d;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RF2a-2 前置失敗 — order_items(order_id, id) 有 % 組重複,無法加 UNIQUE;拒繼續', v_cnt;
  END IF;
END $$;

-- ══ 1. order_items 加複合唯一鍵(供 order_refund_items 的複合 FK 引用)══════════
-- 🔴 lock_timeout(codex 關卡2):ADD CONSTRAINT UNIQUE 需 ACCESS EXCLUSIVE lock。
--    若 apply 當下有未結束的結帳交易持有該表的鎖,ALTER 會無限等待,
--    並讓其後所有 order_items INSERT 排在它後面 = db push 演變成結帳阻塞。
--    ⇒ 5 秒等不到就放棄整支 migration(交易回滾),改挑離峰重跑,不賭。
SET LOCAL lock_timeout = '5s';
-- 🔴 動既有 live 表:純加唯一索引,不改資料、不改既有約束語意、不影響 create_order。
-- 目的:讓「退款明細的品項必須屬於該退款 header 的訂單」成為 **DB 層**強制,而非 RPC 自律。
--       (單靠兩個獨立 FK 做不到:order A 的 header 可以掛 order B 的品項,兩個 FK 各自都合法。)
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_id_key UNIQUE (order_id, id);

-- ══ 2. order_refunds:退款請求層級(一次退款請求 = 一列)════════════════════════
CREATE TABLE public.order_refunds (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid        NOT NULL REFERENCES public.orders(id),

  -- 冪等鍵:TapPay Refund API 的 bank_refund_id(官方 String(20)、不可重複)。
  -- 見 docs/reference/tappay-reference.md:94。D2=A 冪等的核心。
  bank_refund_id      text        NOT NULL,
  -- TapPay 回傳的 refund_id;送出成功前為 NULL。
  tappay_refund_id    text,

  items_amount        integer     NOT NULL CHECK (items_amount > 0),
  shipping_fee_before integer     NOT NULL CHECK (shipping_fee_before >= 0),
  shipping_fee_after  integer     NOT NULL CHECK (shipping_fee_after  >= 0),
  shipping_delta      integer     NOT NULL,
  refund_amount       integer     NOT NULL CHECK (refund_amount > 0),

  status              text        NOT NULL CHECK (status IN ('processing', 'confirmed', 'failed')),
  reason              text        NOT NULL CHECK (btrim(reason) <> ''),
  actor               text        NOT NULL CHECK (btrim(actor) <> ''),
  request_id          text        NOT NULL CHECK (btrim(request_id) <> ''),
  failed_reason       text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,

  -- 供 order_refund_items 複合 FK 反向引用(強制明細與 header 同一張訂單)。
  CONSTRAINT order_refunds_id_order_id_key UNIQUE (id, order_id),

  CONSTRAINT order_refunds_bank_refund_id_key UNIQUE (bank_refund_id),
  CONSTRAINT order_refunds_bank_refund_id_len
    CHECK (char_length(bank_refund_id) BETWEEN 1 AND 20),

  -- 🔴 RF1 公式釘在 DB 層:退款額 = 退品項金額 −(新運費 − 舊運費)。
  --    對照 Sean 範例:items 3000 / before 0 / after 100 / delta 100 → refund 2900。
  CONSTRAINT order_refunds_amount_balances
    CHECK (refund_amount = items_amount - shipping_delta),
  CONSTRAINT order_refunds_shipping_delta_balances
    CHECK (shipping_delta = shipping_fee_after - shipping_fee_before),

  -- 運費絕對上界:只擋荒謬值(例如 before=10000 讓 refund 被灌大)。
  -- ⚠️ 這**不是**與 orders 實際運費的綁定 —— 真正的權威驗證在 RF2b RPC(見檔頭「本檔不做」②)。
  CONSTRAINT order_refunds_shipping_fee_sane
    CHECK (shipping_fee_before <= 100000 AND shipping_fee_after <= 100000),

  -- 狀態與時間戳/失敗原因的單列自洽。
  CONSTRAINT order_refunds_confirmed_consistency
    CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CONSTRAINT order_refunds_failed_consistency
    CHECK ((status = 'failed') = (failed_reason IS NOT NULL AND btrim(failed_reason) <> '')),
  CONSTRAINT order_refunds_processing_clean
    CHECK (status <> 'processing' OR (confirmed_at IS NULL AND failed_reason IS NULL))
);

-- tappay_refund_id 非 NULL 時不得重複(NULL 不受限 ⇒ 多筆 processing 可並存)。
CREATE UNIQUE INDEX order_refunds_tappay_refund_id_key
  ON public.order_refunds (tappay_refund_id)
  WHERE tappay_refund_id IS NOT NULL;

CREATE INDEX order_refunds_order_idx ON public.order_refunds (order_id);
-- RF8 隔日覆核只掃 processing ⇒ 部分索引。
CREATE INDEX order_refunds_processing_idx ON public.order_refunds (status) WHERE status = 'processing';

-- ══ 3. order_refund_items:品項明細 ═══════════════════════════════════════════
CREATE TABLE public.order_refund_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id     uuid    NOT NULL,
  -- 冗餘欄,存在的唯一理由 = 讓下方兩道複合 FK 能夾住「明細品項 ∈ header 訂單」。
  order_id      uuid    NOT NULL,
  order_item_id uuid    NOT NULL,

  quantity      integer NOT NULL CHECK (quantity > 0),
  unit_price    integer NOT NULL CHECK (unit_price >= 0),
  line_amount   integer NOT NULL CHECK (line_amount > 0),

  CONSTRAINT order_refund_items_line_balances
    CHECK (line_amount = unit_price * quantity),

  -- 🔴 兩道複合 FK 合力封死跨單串接:
  --    refund_id 決定 order_id(來自 header)、order_id 又必須與 order_item_id 同屬一單。
  --    ⇒ order A 的退款 header 無法掛 order B 的品項。
  CONSTRAINT order_refund_items_refund_fk
    FOREIGN KEY (refund_id, order_id)
    REFERENCES public.order_refunds (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT order_refund_items_order_item_fk
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id) ON DELETE RESTRICT,

  -- 同一次退款不得重複列同一品項(跨次不受此限,見檔頭「本檔不做」①)。
  CONSTRAINT order_refund_items_refund_item_key UNIQUE (refund_id, order_item_id)
);

-- RF2b 算「剩餘可退數量」要對單一品項跨退款聚合。
CREATE INDEX order_refund_items_order_item_idx ON public.order_refund_items (order_item_id);

-- ⚠️ 刪除 orders 時的實際擋點(codex 關卡2 nit:原註解因果不精確,已更正):
--    一旦某訂單有退款帳,`DELETE FROM orders` 會失敗,但**第一個擋下它的通常是
--    `order_refunds.order_id → orders(id)` 這條 FK 的預設 NO ACTION**(header 直接參照 orders),
--    而不是「cascade 到 order_items 之後才由本表 RESTRICT 擋」。
--    兩層都在,事故判讀時別把錯誤來源歸錯層。
--    效果不變:帳本反過來保護訂單不被誤刪(金流紅線本就禁止硬刪已扣款訂單)。

-- ══ 4. 主從一致性:兩個 DEFERRED CONSTRAINT TRIGGER ═══════════════════════════
-- 🔴 為何是「兩個」(codex 關卡1 R2 抓到、v2 原設計是錯的):
--    只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件** ⇒ 空 header 完全擋不住。
--    ⇒ header 表必須自己有一個 AFTER INSERT;子表那個則必須含 DELETE(刪明細後 sum 會失衡)。
CREATE OR REPLACE FUNCTION public.pcm_assert_refund_ledger_consistent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids           uuid[];
  v_refund_id     uuid;
  v_items_amount  integer;
  v_sum           integer;
  v_cnt           integer;
  v_bad           integer;
BEGIN
  -- 依觸發來源決定「要驗哪些 refund」。
  -- 🔴 UPDATE 必須同時驗 OLD 與 NEW(codex 關卡2 抓到):把某列明細從 refund A 改掛到 B 時,
  --    若只驗 NEW(B),A 可能因此變成零明細卻無人檢查 —— B 的合計仍正確、整筆交易照樣 COMMIT。
  IF TG_TABLE_NAME = 'order_refunds' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.refund_id];
  ELSIF TG_OP = 'UPDATE' THEN
    v_ids := ARRAY[OLD.refund_id, NEW.refund_id];
  ELSE
    v_ids := ARRAY[NEW.refund_id];
  END IF;

  FOREACH v_refund_id IN ARRAY v_ids LOOP
    -- header 已不存在(整筆退款於同交易內被刪)⇒ 該 id 無不變式可驗,跳過。
    SELECT items_amount INTO v_items_amount
      FROM public.order_refunds WHERE id = v_refund_id;
    CONTINUE WHEN NOT FOUND;

    SELECT count(*), COALESCE(SUM(line_amount), 0)
      INTO v_cnt, v_sum
      FROM public.order_refund_items WHERE refund_id = v_refund_id;

    -- ① 至少一列明細(這條只有 header 表那個 trigger 抓得到)。
    IF v_cnt = 0 THEN
      RAISE EXCEPTION 'order_refunds 不變式違反 — 退款 % 沒有任何品項明細;拒繼續', v_refund_id;
    END IF;

    -- ② header 金額 = Σ 明細。
    IF v_sum <> v_items_amount THEN
      RAISE EXCEPTION 'order_refunds 不變式違反 — 退款 % 的 items_amount(%)與明細合計(%)不符;拒繼續',
        v_refund_id, v_items_amount, v_sum;
    END IF;

    -- ③ 每列明細對照 order_items 本體:不得超過原始數量、單價須與訂單快照一致。
    --    ⚠️ 只擋「單次」超量;跨次累積超退不在此(見檔頭「本檔不做」①)。
    SELECT count(*) INTO v_bad
      FROM public.order_refund_items ri
      JOIN public.order_items oi ON oi.id = ri.order_item_id
     WHERE ri.refund_id = v_refund_id
       AND (ri.quantity > oi.quantity OR ri.unit_price <> oi.unit_price);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'order_refunds 不變式違反 — 退款 % 有 % 列明細超過原始數量或單價與訂單不符;拒繼續',
        v_refund_id, v_bad;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 🔴 row-level trigger 對 TRUNCATE 完全不觸發(codex 關卡2):owner 若 TRUNCATE 明細表,
--    所有 header 會保留、明細歸零,上述不變式靜默失效。⇒ 兩表皆加 statement-level 攔截。
--    (service_role 已無 TRUNCATE 權限〔§7 斷言〕,本段是對 owner 誤操作的縱深防護。)
CREATE OR REPLACE FUNCTION public.pcm_refund_ledger_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '退款帳本禁止 TRUNCATE(%)—— 會讓 header/明細不變式靜默失效;如確需清理請逐列 DELETE 並讓 trigger 逐筆驗證', TG_TABLE_NAME;
END;
$$;

COMMENT ON FUNCTION public.pcm_assert_refund_ledger_consistent() IS
  'RF2a 退款帳本跨表不變式(DEFERRED 至 COMMIT 才驗):①至少一列明細 ②header items_amount = Σ line_amount ③每列不超原始數量且單價相符。由 order_refunds 與 order_refund_items 兩個 CONSTRAINT TRIGGER 共用 —— 🔴 兩個都必要:只掛子表則「零明細 header」永不觸發。';

-- DEFERRED 是必要的:RPC 會先插 header 再插明細,IMMEDIATE 會誤擋合法流程。
CREATE CONSTRAINT TRIGGER order_refunds_ledger_consistency_ac
  AFTER INSERT OR UPDATE ON public.order_refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_refund_ledger_consistent();

CREATE CONSTRAINT TRIGGER order_refund_items_ledger_consistency_ac
  AFTER INSERT OR UPDATE OR DELETE ON public.order_refund_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_refund_ledger_consistent();

CREATE TRIGGER order_refunds_block_truncate_bt
  BEFORE TRUNCATE ON public.order_refunds
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_refund_ledger_block_truncate();

CREATE TRIGGER order_refund_items_block_truncate_bt
  BEFORE TRUNCATE ON public.order_refund_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_refund_ledger_block_truncate();

-- ══ 5. 狀態轉移硬防線 ═══════════════════════════════════════════════════════
-- 單列 CHECK 只驗自洽,擋不住「已 confirmed 被改回 failed」——
-- RF8 覆核一旦有 bug,會把銀行端已成功的退款覆寫成失敗,並據以錯誤回滾訂單狀態。
CREATE OR REPLACE FUNCTION public.pcm_order_refund_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;                                  -- 同值冪等重寫
  END IF;
  IF OLD.status = 'processing' AND NEW.status IN ('confirmed', 'failed') THEN
    RETURN NEW;                                  -- 唯二合法轉移
  END IF;
  RAISE EXCEPTION 'order_refunds 狀態轉移非法 — % → %(confirmed/failed 為終態);拒繼續',
    OLD.status, NEW.status;
END;
$$;

COMMENT ON FUNCTION public.pcm_order_refund_status_transition() IS
  'RF2a 退款狀態機:僅允許 processing → confirmed / processing → failed / 同值冪等;confirmed 與 failed 皆為終態,轉出一律 RAISE。DB 層硬防線,不依賴 RF8 自律。';

CREATE TRIGGER order_refunds_status_transition_bu
  BEFORE UPDATE OF status ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_order_refund_status_transition();

-- ══ 6. RLS zero-policy + table ACL ═══════════════════════════════════════════
-- 樣板 = 20260712210000 admin_audit_log(RLS 縱深 + 全 REVOKE + 精準 GRANT)。
-- 🔴 偏離 audit_log 的 INSERT-only:本表 service_role 只給 **SELECT**。
--    寫入(INSERT/UPDATE)全走 RF2b 的 SECURITY DEFINER owner RPC,對齊 orders/order_items 現況
--    (20260714130000:251 註解:「orders 對 service_role 已 REVOKE 直寫」)。
--    admin 只需讀帳本做顯示(RF6)。
ALTER TABLE public.order_refunds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refund_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_refunds      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.order_refund_items FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.order_refunds      TO service_role;
GRANT SELECT ON TABLE public.order_refund_items TO service_role;

-- 🔴 函式 EXECUTE 收斂(codex 關卡2):PostgreSQL 新建 function **預設 GRANT EXECUTE TO PUBLIC**。
--    兩支 trigger 函式都是 SECURITY DEFINER,PUBLIC 可執行 = 多一個以 owner 權限起跑的入口
--    (直接呼叫會因缺 trigger context 而失敗,但任何能在自有 table 上建 trigger 的 role
--     都能把它掛上去、以 definer 身分執行)。service_role 無表寫權**不能**消除這個面。
--    ⇒ 全數 REVOKE;trigger 由表擁有者觸發、不需要任何 role 的 EXECUTE 權限。
REVOKE ALL ON FUNCTION public.pcm_assert_refund_ledger_consistent()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_order_refund_status_transition()   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_refund_ledger_block_truncate()     FROM PUBLIC, anon, authenticated, service_role;

-- ══ 7. fail-closed 斷言(樣板 = 20260717020000 email_outbox:448-475)═══════════
DO $$
DECLARE
  v_tbl  text;
  v_role text;
  v_priv text;
  v_cnt  integer;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['order_refunds', 'order_refund_items'] LOOP

    -- 7a. client 角色 7 權限全零。
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(v_role, 'public.' || v_tbl, v_priv) THEN
          RAISE EXCEPTION '% ACL 異常 — client 角色 % 不應有 % 權限(帳本 client 全鎖);拒繼續', v_tbl, v_role, v_priv;
        END IF;
      END LOOP;
    END LOOP;

    -- 7b. service_role 必須有 SELECT(RF6 後台顯示路徑;缺了 runtime 42501)。
    IF NOT has_table_privilege('service_role', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION '% ACL 異常 — service_role 應有 SELECT(RF6 顯示路徑);拒繼續', v_tbl;
    END IF;

    -- 7c. 🔴 service_role 其餘 6 權限全零 —— 寫入只走 RF2b SECURITY DEFINER RPC。
    --     (codex 關卡1 R1:只數「恰 1 筆」不證明那筆是 SELECT;此段逐項驗種類。)
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('service_role', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION '% ACL 異常 — service_role 不應有 %(帳本寫入須走 SECURITY DEFINER RPC);拒繼續', v_tbl, v_priv;
      END IF;
    END LOOP;

    -- 7d. role_table_grants 顯式 grant 筆數(輔助訊號)。
    --     ⚠️ 非 PUBLIC 的權威驗證(role_table_grants 對 PUBLIC 的可見性隨 grantor 而異)→ 權威在 7e。
    SELECT count(*) INTO v_cnt
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_tbl
       AND grantee IN ('anon', 'authenticated', 'PUBLIC');
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '% role_table_grants 異常 — anon/authenticated/PUBLIC 應零顯式 grant(實 % 筆);拒繼續', v_tbl, v_cnt;
    END IF;

    SELECT count(*) INTO v_cnt
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_tbl
       AND grantee = 'service_role';
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '% role_table_grants 異常 — service_role 應恰 1 筆(SELECT),實 % 筆;拒繼續', v_tbl, v_cnt;
    END IF;

    -- 7e. 🔴 relacl 全 allowlist:問「到底有誰」,不在 {owner, service_role} 就炸。
    --     涵蓋第三方角色與 PUBLIC(aclexplode 中 grantee = 0)。
    --     ⚠️ 精確範圍:這是「直接 relacl allowlist」,不等於有效權限窮舉
    --        (證明不了 role inheritance / superuser / BYPASSRLS —— 那不是本表層級能防的)。
    SELECT count(*) INTO v_cnt
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE c.oid = ('public.' || v_tbl)::regclass
       AND a.grantee <> c.relowner
       AND a.grantee <> 'service_role'::regrole::oid;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '% ACL 異常 — relacl 出現 owner/service_role 以外的 grantee(含 PUBLIC=oid 0)共 % 筆;拒繼續', v_tbl, v_cnt;
    END IF;

    -- 7f. 欄級 ACL 必須全空(表級 allowlist 過了,仍可能有人只對單欄開 grant;
    --     has_table_privilege 與 relacl 都看不到)。
    SELECT count(*) INTO v_cnt
      FROM pg_attribute
     WHERE attrelid = ('public.' || v_tbl)::regclass
       AND attnum > 0 AND NOT attisdropped
       AND attacl IS NOT NULL;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '% ACL 異常 — 不應有任何欄級 grant(attacl 非空 % 欄);拒繼續', v_tbl, v_cnt;
    END IF;

    -- 7g. RLS 終態納入同一 fail-closed DO。
    SELECT count(*) INTO v_cnt
      FROM pg_class
     WHERE oid = ('public.' || v_tbl)::regclass AND relrowsecurity;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '% RLS 異常 — 應為 enabled(zero-policy 縱深);拒繼續', v_tbl;
    END IF;

  END LOOP;

  -- 7h. 兩個一致性 trigger 都必須存在(缺任一 = 不變式有洞;尤其缺 header 那個 = 空明細擋不住)。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname IN ('order_refunds_ledger_consistency_ac', 'order_refund_items_ledger_consistency_ac')
     AND NOT tgisinternal;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'RF2a-2 斷言失敗 — 一致性 CONSTRAINT TRIGGER 應恰 2 個(header + items),實 % 個;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname = 'order_refunds_status_transition_bu' AND NOT tgisinternal;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'RF2a-2 斷言失敗 — 狀態轉移 trigger 應存在;拒繼續';
  END IF;

  -- 7i. TRUNCATE 攔截 trigger 兩支都在(row-level trigger 對 TRUNCATE 不觸發,少了就是靜默破口)。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname IN ('order_refunds_block_truncate_bt', 'order_refund_items_block_truncate_bt')
     AND NOT tgisinternal;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'RF2a-2 斷言失敗 — TRUNCATE 攔截 trigger 應恰 2 個,實 % 個;拒繼續', v_cnt;
  END IF;

  -- 7j. 三支函式的 EXECUTE 必須零外授(SECURITY DEFINER + PUBLIC EXECUTE = 以 owner 權限起跑的入口)。
  --     proacl IS NULL 代表「只有 owner 的預設權限」= 已被 REVOKE 乾淨。
  SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_assert_refund_ledger_consistent',
                       'pcm_order_refund_status_transition',
                       'pcm_refund_ledger_block_truncate')
     AND p.proacl IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM aclexplode(p.proacl) AS a
        WHERE a.grantee <> p.proowner
     );
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RF2a-2 斷言失敗 — trigger 函式仍有 owner 以外的 EXECUTE 授權(% 支);拒繼續', v_cnt;
  END IF;
END $$;

-- ══ 8. COMMENT ══════════════════════════════════════════════════════════════
COMMENT ON TABLE public.order_refunds IS
  'M-3 RF2a 退款帳本(請求層級,一次退款請求一列)。冪等鍵 = bank_refund_id(TapPay String(20) 不可重複)。金額守恆 CHECK 釘住 RF1 公式:refund_amount = items_amount − shipping_delta。狀態 processing→confirmed/failed 由 trigger 強制、終態不可轉出。🔴 寫入只走 RF2b SECURITY DEFINER RPC(service_role 僅 SELECT)。🔴 未擋跨次累積超退、運費欄未與 orders 綁定 —— 兩者防線在 RF2b,見 plan §6.6/§6.3-3。';

COMMENT ON COLUMN public.order_refunds.bank_refund_id IS
  '商戶自訂退款識別碼,送 TapPay Refund API 用;官方 String(20)、不可重複 = D2=A 冪等鍵。';
COMMENT ON COLUMN public.order_refunds.shipping_delta IS
  '新運費 − 舊運費。正=退款需扣回補收的運費(退貨後剩餘小計跌破免運門檻);負=運費回退給客人。';
COMMENT ON COLUMN public.order_refunds.refund_amount IS
  '實退金額(已扣運費差)。Sean 範例:5500 單退 3000 品項 → 剩 2500 跌破 5000 門檻 → 新運費 100 → 實退 2900。';
COMMENT ON COLUMN public.order_refunds.actor IS
  '操作者具名身分,對齊 admin_audit_log.actor;非空。';
COMMENT ON COLUMN public.order_refunds.request_id IS
  'correlation id,貫穿 admin 寫入→帳本→TapPay→log,對齊 admin_audit_log.request_id;非空。';

COMMENT ON TABLE public.order_refund_items IS
  'M-3 RF2a 退款明細(品項 × 數量)。order_id 為冗餘欄,存在的唯一理由是與 refund_id / order_item_id 組成兩道複合 FK,在 DB 層強制「明細品項必屬於該退款的訂單」。單次超量與單價不符由 pcm_assert_refund_ledger_consistent 擋;🔴 跨次累積超退不擋(防線在 RF2b)。';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- rollback(forward-only;不貼 SQL Editor,需另開 migration):
--   DROP TABLE IF EXISTS public.order_refund_items;   -- 連帶 FK / UNIQUE / index
--   DROP TABLE IF EXISTS public.order_refunds;        -- 連帶 CHECK / index / trigger
--   DROP FUNCTION IF EXISTS public.pcm_assert_refund_ledger_consistent();
--   DROP FUNCTION IF EXISTS public.pcm_order_refund_status_transition();
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_id_key;
-- ⚠️ 前一支 20260725130000 的 enum 加值**無法** rollback(PG 不支援移除 enum 值)。
-- ────────────────────────────────────────────────────────────────────────────
