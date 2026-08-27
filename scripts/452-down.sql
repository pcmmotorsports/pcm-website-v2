-- #452 片 2a-1 回退(災難當天用;Supabase forward-only ⇒ 這是「另立 down」的內容)
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ══ 步 0. 前置閘 ═══════════════════════════════════════════
DO $g$
DECLARE v_n bigint;
BEGIN
  IF pg_catalog.to_regclass('public.order_item_procurement') IS NULL THEN
    RAISE EXCEPTION '452-down 步0:看不到 order_item_procurement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid='public.order_item_procurement'::regclass
                    AND attname='voided_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '452-down 步0:作廢欄不存在 ⇒ 2a-1 沒 apply 過或已回退,不要重跑';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.order_item_procurement WHERE voided_at IS NOT NULL' INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '452-down 步0:有 % 筆已被作廢 ⇒ 停。刪欄會讓那些作廢事實與理由永久消失,且步2的 ADD CONSTRAINT 可能撞重複鍵。先決定那幾列怎麼處置。', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
              WHERE pronamespace='public'::regnamespace
                AND proname IN ('admin_void_item_procurement','admin_unvoid_item_procurement')) THEN
    RAISE EXCEPTION '452-down 步0:偵測到 2a-2 的 void/unvoid RPC ⇒ **必須先回退 2a-2**(逆序),否則它們會引用已刪的欄位';
  END IF;
END $g$;

-- ══ 步 1. 🔴 先還原兩支函式(必須在刪欄之前)══════════════════
-- 為什麼順序不能反:欄位刪掉但函式還引用它 ⇒ 下一次 trigger 發火當場炸。
-- (同型前例:docs/runbooks/2026-07-30-a7-rollback.md 檔頭 v2 擴列③「DROP 後 42P01 寫入炸彈」)
CREATE OR REPLACE FUNCTION public.pcm_a2b1_procurement_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 三個變數全 bigint:危險在變數宣告不在表達式
  v_alloc     bigint;   --    (SUM(integer) 本回 bigint;窄化任一個 = B10 紅在 22003)
  v_cancelled bigint;
BEGIN
  -- ① 隔離閘(Q1=A + Q3=A gate-first):非 read committed 一律拒收。
  --    RR 下等鎖後 SUM 用交易快照、看不到兄弟提交 ⇒ 守門會雙雙放行(實測);
  --    SERIALIZABLE 拍板不信任 SSI、一律拒。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A2b1 隔離閘:守門僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a2b1_isolation_read_committed_only';
  END IF;

  -- ② skip:同 parent 且未調升 ⇒ 不守(row 28 delta 語意:調降/持平放行;
  --    判定只用 OLD/NEW 實體值、不依賴快照)。
  IF TG_OP = 'UPDATE'
     AND NEW.order_item_id = OLD.order_item_id
     AND NEW.allocated_quantity <= OLD.allocated_quantity THEN
    RETURN NULL;
  END IF;

  -- ③ 鎖 parent(NKU;守門互斥的承重)。
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = NEW.order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- 防衛枝:FK RI trigger 依名序先發火(23503),本枝不可構造 ⇒ 不列守門計數、
    -- 無負測、無突變格(plan §3.6;A6 [38] 死守門教訓的誠實寫法)。
    RAISE EXCEPTION 'A2b1 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      NEW.order_item_id;
  END IF;

  -- ④ 真相表重算(AFTER ⇒ 採購 SUM 已含 NEW 列)。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_alloc
    FROM public.order_item_procurement p
   WHERE p.order_item_id = NEW.order_item_id;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = NEW.order_item_id;

  -- ⑤ 總量守門:恰好用滿合法(>,不是 >=)。
  IF v_alloc > v_qty - v_cancelled THEN
    RAISE EXCEPTION 'A2b1 超量:品項 % 採購合計 % 超過可訂購 %(quantity=% − 已取消=%)',
      NEW.order_item_id, v_alloc, v_qty - v_cancelled, v_qty, v_cancelled
      USING ERRCODE = 'P2B01', CONSTRAINT = 'a2b1_allocation_within_orderable';
  END IF;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 全 bigint:危險在變數宣告(SUM(integer) 本回 bigint);
  v_ordered   bigint;   --    寫回 integer 欄的指派在 quantity=INT_MAX 病理邊界可 22003,
  v_instock   bigint;   --    誠實列界(harness R15 釘形狀)。
  v_cancelled bigint;
  v_shipped   bigint;   -- 🔴 B2-S2b 第四軸
BEGIN
  -- 鎖 parent(NKU;與 A2b1 同一把 ⇒ 重算彼此互斥、也與守門互斥)。
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- 防衛枝:三張來源表對 order_items 全 FK RESTRICT ⇒ 事件存在時 parent 必在;
    -- 不列守門計數、無負測、無突變格(A2b1 §3.6 同紀律)。
    RAISE EXCEPTION 'A4a 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      p_order_item_id;
  END IF;

  -- 三軸真相直讀(instock 走 receipts JOIN,不經累計欄 —— 該欄有 bug 摘要仍對)。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_ordered
    FROM public.order_item_procurement p
   WHERE p.order_item_id = p_order_item_id;

  SELECT COALESCE(sum(r.quantity), 0) INTO v_instock
    FROM public.order_item_procurement_receipts r
    JOIN public.order_item_procurement p2 ON p2.id = r.procurement_id
   WHERE p2.order_item_id = p_order_item_id;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = p_order_item_id;

  -- 🔴 第四軸真相式(plan §1)。本區塊是**五處同步守門**的第 1 處(唯一 writer)。
  -- 標記區內含關聯述詞那一行;本體 md5 比對時才把述詞行扣掉(plan §1.1,守門由 S2b-3a 建)。
  -- SHIPPED-TRUTH-BEGIN
  SELECT COALESCE(sum(si.shipped_quantity), 0) INTO v_shipped
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE si.order_item_id = p_order_item_id
     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算
  -- SHIPPED-TRUTH-END

  -- 惰性建列 + 冪等 upsert(quantity 由鎖下讀值寫入,複合 FK 物理釘死)。
  INSERT INTO public.order_item_quantity_summary
    (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
  VALUES (p_order_item_id, v_qty, v_ordered, v_instock, v_cancelled, v_shipped)
  ON CONFLICT (order_item_id) DO UPDATE
    SET quantity           = EXCLUDED.quantity,
        ordered_quantity   = EXCLUDED.ordered_quantity,
        instock_quantity   = EXCLUDED.instock_quantity,
        cancelled_quantity = EXCLUDED.cancelled_quantity,
        shipped_quantity   = EXCLUDED.shipped_quantity;
END
$$;

-- ══ 步 2. 業務鍵:同名 partial unique index → 回表約束 ════════
DROP INDEX public.order_item_procurement_business_key;
ALTER TABLE public.order_item_procurement
  ADD CONSTRAINT order_item_procurement_business_key UNIQUE (order_item_id, supplier_id);
COMMENT ON CONSTRAINT order_item_procurement_business_key ON public.order_item_procurement IS
  'upsert 業務鍵(同一品項同一家供應商只有一列;A5a 的冪等重放靠它)。'
  '🔴 2026-08-01 明文結案 A2(20260729020000:123-126)登記的合約債 ①'
  '「DB 尚未強制 supplier_canonical_key = A5b 函式對 supplier_name 的輸出」——'
  '**該債隨形狀改變而消滅,不是被忽略**:canonical key 欄已移除、A5b/A5c 已作廢,'
  '供應商身分改由主檔 uuid 決定 ⇒ 「同一列的 key 與 name 會不一致」這個具體風險不再存在。'
  '🔴 結案範圍僅止於此,**不等於「重複供應商不可能」**:主檔裡仍可能被人建出 '
  'Eazi-Grip 與 Eazi Grip 兩筆(兩個 uuid、label UNIQUE 擋不住),本鍵也允許同品項各指一筆。'
  '防線是新增畫面的 typeahead(人眼)—— 這是 Sean 2026-08-01 明知並選擇的做法,不是漏洞。'
  '🔴 另換來一筆等價新債:本鍵只保證同一 uuid 不重複,'
  '**不阻止採購指向已停用(is_active=false)的供應商** ⇒ 見 supplier_id 欄註解與 A5a 驗收條件。';

-- ══ 步 3. 配對 CHECK 與兩欄 ═════════════════════════════════
ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_void_pair;
ALTER TABLE public.order_item_procurement DROP COLUMN void_reason, DROP COLUMN voided_at;

-- ══ 步 4. 後置斷言(任一不成立=整支回滾)═══════════════════
DO $v$
DECLARE v_a text; v_b text; v_cnt int;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pcm_a2b1_procurement_allocation_guard()'::regprocedure)) INTO v_a;
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure)) INTO v_b;
  IF v_a <> '39b9c3a446ad043c9681b0317f3e1961' THEN RAISE EXCEPTION '452-down 步4:A2b1 沒回到 452 之前(實得 %)', v_a; END IF;
  IF v_b <> '4ac2989a58985beae91a491a816086f7' THEN RAISE EXCEPTION '452-down 步4:A4a 沒回到 452 之前(實得 %)', v_b; END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped
     AND attname IN ('voided_at','void_reason');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '452-down 步4:作廢欄還在(% 個)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid='public.order_item_procurement'::regclass
     AND conname='order_item_procurement_business_key' AND contype='u';
  IF v_cnt <> 1 THEN RAISE EXCEPTION '452-down 步4:業務鍵沒回成表約束'; END IF;
  RAISE NOTICE '452-down 全部還原完成:兩支函式指紋回到 452 之前 / 作廢欄已刪 / 業務鍵回表約束';
END $v$;

COMMIT;
