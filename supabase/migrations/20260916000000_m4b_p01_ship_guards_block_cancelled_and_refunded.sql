-- 20260916000000_m4b_p01_ship_guards_block_cancelled_and_refunded.sql
-- M-4b · P0-1 片 1b:出貨五道守門 + 寫出貨資格證明(plan docs/plans/2026-09-15-card-refund-cancel-blocks-shipping-plan.md §3.1 §3.2 §4 片 1)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 刷卡全額退款自動取消後, 裝箱 / 叫車 / 標出貨 / 復原作廢 / 送新竹建單都不看訂單狀態(plan §1)⇒ 錢退了、貨也走了。
-- Sean 拍板:Q2 甲(已出貨全退不取消)、Q-A 乙(叫過車未出貨 ⇒ 補記事實)、Q-B 甲 + B3 甲(刷卡單全退 ⇒ 剩下不准出, 含卡退 + 人工退合計)。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 判準 pcm_order_ship_blocked(order_id):cancelled_at 有值 ⇒ 'cancelled';tappay 且 payment_status = refunded ⇒ 'card_fully_refunded'。
-- ② pcm_p01_lock_box_orders(shipment_id, 額外品項):鎖序 shipments(NKU)→ orders(依 id 排序 FOR SHARE), 回 (訂單數, 被擋清單)。
--    先鎖箱:parent guard 要同一列 NKU ⇒ 持鎖期間別人加不進品項 ⇒ 集合凍結(codex plan R1 ②)。
--    FOR SHARE 與取消的 FOR UPDATE、退款匯流點的 FOR NO KEY UPDATE 互斥 ⇒ 判準讀到的是提交後的值。
-- ③ pcm_p01_write_clearances(shipment_id, via):持鎖、判準通過後寫 shipment_order_ship_clearances(片 1a 的表)。
-- ④ 五道守門(CREATE OR REPLACE, 簽章與 SET 整組照抄線上那一代, 前置閘釘 md5):
--    pcm_b2_add_items_impl       鎖序改 shipments → orders → order_items(原本 order_items 先 ⇒ 與取消反向);被擋 ⇒ 拒;叫過車 ⇒ 拒
--    pcm_b2_shipment_items_parent_guard  叫過車的箱不准再加品項(真判準;codex plan R2 B2)
--    admin_mark_shipment_shipped hct_dispatched_at 有值 ⇒ 補記不判(§3.2);否則判 + 寫 clearance(via mark_shipped)
--    admin_claim_hct_dispatch    判 + 佔位成功後寫 clearance(via claim);空箱拒
--    admin_unvoid_shipment       判
--    admin_record_hct_submit     只在 draft / failed(新的一次送單佔位)判;unknown → * 補記不判(codex plan R1 ⑨)
-- 不改:admin_create_shipment(沒有訂單可看)、admin_record_hct_dispatch(補記事實)、admin_void_shipment(作廢永遠可以做)。
--
-- ══ 部署 ═══════════════════════════════════════════════════
-- 🔴 與 20260915230000(片 1a)同一次連續貼, 中間不隔天(plan §6)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260916000000-rollback.sql:五道守門回線上那一代逐字(由 prosrc 匯出程式產生)+ DROP 三支 helper。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  r record;
BEGIN
  IF pg_catalog.to_regclass('public.shipment_order_ship_clearances') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_confirm_hct_handover(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘一:片 1a(20260915230000)還沒貼 ⇒ 先貼 1a';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_ship_blocked(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘二:pcm_order_ship_blocked 已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  -- 釘線上那一代的本體(2026-09-15 正式庫 schema dump 實量;repo newest 逐字相同)
  FOR r IN SELECT * FROM (VALUES
      ('public.pcm_b2_add_items_impl(text,uuid,jsonb)',          '00cde79a05658e0b4e82c25f191b0bd9'),
      ('public.pcm_b2_shipment_items_parent_guard()',            '4bd6d13b66f91fb648a14d4174271f2a'),
      ('public.admin_mark_shipment_shipped(text,uuid,text)',     'c329068a2a8649bc9641ade705ba9a5d'),
      ('public.admin_claim_hct_dispatch(text,text)',             'e3c37e7b032cf749ef05dd2e43320c55'),
      ('public.admin_unvoid_shipment(text,uuid)',                '246cb3b45f39c434daa1e25dda21ceba'),
      ('public.admin_record_hct_submit(text,text,text,jsonb)',   'd88b332249d3a72ff4b3dd9306f0c2ce')
    ) AS v(sig, want) LOOP
    IF pg_catalog.to_regprocedure(r.sig) IS NULL THEN
      RAISE EXCEPTION '前置閘三:% 不存在', r.sig;
    END IF;
    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig)) <> r.want THEN
      RAISE EXCEPTION '前置閘三:% 的本體不是釘住的那一代(有人在中間又改了)⇒ 停下, 重新抄最新一代', r.sig;
    END IF;
  END LOOP;
END
$pre$;

-- ── ① 判準 ────────────────────────────────────────────────────
CREATE FUNCTION public.pcm_order_ship_blocked(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v record;
BEGIN
  SELECT o.cancelled_at, o.payment_method, o.payment_status::text AS payment_status
    INTO v
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    -- 查不到不可以當成「可以出」
    RAISE EXCEPTION 'pcm_order_ship_blocked:訂單 % 不存在', p_order_id;
  END IF;
  IF v.cancelled_at IS NOT NULL THEN
    RETURN 'cancelled';
  END IF;
  -- Sean Q-B 甲 + B3 甲:刷卡單全額退款(payment_status 由 pcm_sync_order_refund_payment_status 依帳本算, 含人工軌)⇒ 剩下不准出。
  -- 退款被作廢時 payment_status 會降回 ⇒ 這一條自己解開。
  IF v.payment_method = 'tappay' AND v.payment_status = 'refunded' THEN
    RETURN 'card_fully_refunded';
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION public.pcm_order_ship_blocked(uuid) IS
  'P0-1 §3.1(20260916000000):這張單能不能【開始】出貨。NULL = 可以;cancelled / card_fully_refunded = 不行。'
  '只由出貨守門(definer)呼叫, 零 GRANT。叫過車而新竹回成功 / 管理者確認交貨的箱子標出貨是補記, 不套本判準(§3.2)。';
ALTER FUNCTION public.pcm_order_ship_blocked(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_order_ship_blocked(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── ② 鎖箱與它的訂單 ──────────────────────────────────────────
CREATE FUNCTION public.pcm_p01_lock_box_orders(p_shipment_id uuid, p_extra_order_item_ids uuid[])
RETURNS TABLE (order_count integer, blocked text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ids uuid[];
BEGIN
  -- 鎖序第一段:箱子。與 pcm_b2_shipment_items_parent_guard 同一把 NKU ⇒ 持鎖期間箱內品項集合不會變。
  PERFORM 1 FROM public.shipments s WHERE s.id = p_shipment_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_p01_lock_box_orders:找不到包裹(shipment_id=%)', p_shipment_id;
  END IF;

  -- 集合 = 箱內既有品項的訂單 ∪ 這次要加的品項的訂單(空箱加品項也鎖得到輸入那幾張)
  SELECT pg_catalog.array_agg(x.order_id ORDER BY x.order_id) INTO v_ids
    FROM (SELECT oi.order_id
            FROM public.shipment_items si
            JOIN public.order_items oi ON oi.id = si.order_item_id
           WHERE si.shipment_id = p_shipment_id
          UNION
          SELECT oi.order_id
            FROM public.order_items oi
           WHERE oi.id = ANY (COALESCE(p_extra_order_item_ids, '{}'::uuid[]))) x;

  IF v_ids IS NULL THEN
    order_count := 0;
    blocked := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 鎖序第二段:訂單, 依 id 排序。之後的判準讀的是鎖後的提交值。
  PERFORM 1 FROM public.orders o WHERE o.id = ANY (v_ids) ORDER BY o.id FOR SHARE;

  order_count := pg_catalog.array_length(v_ids, 1);
  SELECT pg_catalog.string_agg(
           b.display_id || '(' || CASE b.reason WHEN 'cancelled' THEN '已取消' ELSE '刷卡已全額退款' END || ')',
           '、' ORDER BY b.display_id)
    INTO blocked
    FROM (SELECT o.display_id, public.pcm_order_ship_blocked(o.id) AS reason
            FROM public.orders o
           WHERE o.id = ANY (v_ids)) b
   WHERE b.reason IS NOT NULL;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION public.pcm_p01_lock_box_orders(uuid, uuid[]) IS
  'P0-1 §4(20260916000000):鎖箱(NKU)→ 鎖箱內與輸入品項的訂單(依 id FOR SHARE)→ 回 (訂單數, 被擋的訂單清單)。'
  '所有出貨守門的共用鎖序:shipments → orders → order_items。零 GRANT。';
ALTER FUNCTION public.pcm_p01_lock_box_orders(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_p01_lock_box_orders(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- ── ③ 寫出貨資格證明 ──────────────────────────────────────────
CREATE FUNCTION public.pcm_p01_write_clearances(p_shipment_id uuid, p_via text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- 呼叫端必須先呼 pcm_p01_lock_box_orders 並確認沒有被擋的訂單(同一個交易)。
  INSERT INTO public.shipment_order_ship_clearances (shipment_id, order_id, cleared_via)
  SELECT DISTINCT p_shipment_id, oi.order_id, p_via
    FROM public.shipment_items si
    JOIN public.order_items oi ON oi.id = si.order_item_id
   WHERE si.shipment_id = p_shipment_id
  ON CONFLICT (shipment_id, order_id) DO NOTHING;
$fn$;
COMMENT ON FUNCTION public.pcm_p01_write_clearances(uuid, text) IS
  'P0-1 §3.3(20260916000000):持訂單鎖、判準通過後, 把箱內每張訂單寫進 shipment_order_ship_clearances。'
  '只由 admin_claim_hct_dispatch / admin_mark_shipment_shipped 呼叫, 零 GRANT。';
ALTER FUNCTION public.pcm_p01_write_clearances(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_p01_write_clearances(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── ④-a 掛品項 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_b2_add_items_impl(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $impl$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_replay jsonb;
  v_ship   record;
  v_bad    text;
  v_n      bigint;
  v_cnt    bigint;
  v_snap   jsonb;
  v_try    int := 0;
  v_orders integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_add_shipment_items:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- ── 冪等層(W2):在**任何業務寫入之前**,且不得被搬進下面的重試迴圈 ──
  v_replay := public.pcm_b2_shipping_idem_claim(
    'add_items', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('add_items', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'items',       p_items)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 形狀契約(理由見檔頭)────────────────────────────────
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '掛品項:品項清單必須是**非空的陣列**(收到的是 %)', coalesce(pg_catalog.jsonb_typeof(p_items), 'NULL')
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_items_shape';
  END IF;
  SELECT pg_catalog.string_agg(DISTINCT x.why, '、') INTO v_bad
    FROM (
      SELECT CASE
               WHEN pg_catalog.jsonb_typeof(e.value) <> 'object' THEN '每個元素都要是物件'
               WHEN NOT (e.value ?& ARRAY['order_item_id','quantity'])
                 OR (e.value - ARRAY['order_item_id','quantity']) <> '{}'::jsonb
                 THEN '每個元素只能有 order_item_id 與 quantity 兩個欄位(多送或少送都不行)'
               -- 🔴 F3(Fable):`?&` 只驗**鍵存在**,不驗值。`{"order_item_id": null}` 會一路穿過
               --    取鎖/歸屬/前緣三段(`string_agg` 跳 NULL ⇒ 比對恆無違規),落到 INSERT 才 raw 23502;
               --    非 uuid 字串則在取鎖那句 raw 22P02。⇒ 值的型別要在入口驗。
               WHEN pg_catalog.jsonb_typeof(e.value -> 'order_item_id') <> 'string'
                 OR (e.value ->> 'order_item_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                 THEN 'order_item_id 必須是 uuid 字串'
               WHEN pg_catalog.jsonb_typeof(e.value -> 'quantity') <> 'number'
                 OR (e.value ->> 'quantity')::numeric <= 0
                 OR (e.value ->> 'quantity')::numeric <> pg_catalog.floor((e.value ->> 'quantity')::numeric)
                 -- 🔴 F4(Fable):`1e10` 過得了「正整數 numeric」,卻在後面的 `::int` 爆 raw 22003
                 --    ⇒ 入口就要有上界。1 萬件對單一品項是荒謬值,拿它當業務上界。
                 OR (e.value ->> 'quantity')::numeric > 10000
                 THEN 'quantity 必須是 1 到 10000 之間的整數'
               ELSE NULL END AS why
        FROM pg_catalog.jsonb_array_elements(p_items) e
    ) x
   WHERE x.why IS NOT NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '掛品項:品項清單格式不對(%)', v_bad
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_items_shape';
  END IF;
  -- 🔴 同一次呼叫裡同一個 order_item_id 不得重複(理由見檔頭)
  -- 🔴 R2-F-M1:uuid 正規式允許大小寫,而首版**用原始文字分組** ⇒ 送 `BBBB…-0001` 與 `bbbb…-0001`
  --    是同一個 uuid 卻穿過這道門,落到 INSERT 撞 S1b 的 UNIQUE ⇒ **raw 23505** ——
  --    正是檔頭說這道門要防的東西,被大小寫繞掉。⇒ 依 `::uuid` 正規化後再分組。
  SELECT pg_catalog.count(*) INTO v_n FROM (
    SELECT (e.value ->> 'order_item_id')::uuid AS oi
      FROM pg_catalog.jsonb_array_elements(p_items) e
     GROUP BY 1 HAVING pg_catalog.count(*) > 1) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION '掛品項:同一份清單裡有 % 個品項重複了。請把同一個品項的數量合併成一筆再送。', v_n
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_items_duplicate';
  END IF;

  -- ── 包裹狀態的人話前緣(真正的守門是 S1b 的 parent guard X3/A7)──
  SELECT s.id, s.customer_user_id, s.shipped_at, s.deleted_at, s.shipment_reference
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '掛品項:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '掛品項:包裹 % 已作廢,不能再加品項。要重新出這批貨請開一張新的包裹。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_shipment_voided';
  END IF;
  IF v_ship.shipped_at IS NOT NULL THEN
    RAISE EXCEPTION '掛品項:包裹 % 已經寄出,不能再加品項。要補寄請開一張新的包裹。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_shipment_shipped';
  END IF;

  -- ── 取鎖 → 前緣拒絕 → 寫入(包在 40P01 重試裡)────────────
  LOOP
    v_try := v_try + 1;
    BEGIN
      -- 🔴 P0-1 §4:鎖序 shipments → orders → order_items。原本先鎖 order_items、INSERT 時才由 parent guard 鎖箱
      --    ⇒ 與取消(orders → order_items)反向。鎖放在子交易裡:40P01 回捲會放掉本圈的鎖, 下一圈同序重拿。
      SELECT b.order_count, b.blocked INTO v_orders, v_bad
        FROM public.pcm_p01_lock_box_orders(
               p_shipment_id,
               ARRAY(SELECT (e.value ->> 'order_item_id')::uuid FROM pg_catalog.jsonb_array_elements(p_items) e)) b;
      IF EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = p_shipment_id AND s.hct_dispatch_attempted_at IS NOT NULL) THEN
        -- 真判準在 parent guard;這裡是訊息層。
        RAISE EXCEPTION '掛品項:包裹 % 已經叫過新竹, 不能再加品項。要補寄請開一張新的包裹。', v_ship.shipment_reference
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_box_dispatch_claimed';
      END IF;
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION '掛品項:這些訂單不能再出貨:%。已取消或刷卡已全額退款的單不能裝箱;箱裡已經有這種單的話, 請先作廢這一箱。', v_bad
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_order_ship_blocked';
      END IF;

      -- 🔴 **依 order_item_id 排序取鎖**(交棒 1 後半;與 a8a2 的 `ORDER BY oi.id` 同序)。
      --    `FOR NO KEY UPDATE` 而非 `FOR UPDATE`:後者與 FK 的 KEY SHARE 會死結(A2b1 實測 40P01)。
      PERFORM 1 FROM public.order_items oi
       WHERE oi.id IN (SELECT (e.value ->> 'order_item_id')::uuid FROM pg_catalog.jsonb_array_elements(p_items) e)
       ORDER BY oi.id
         FOR NO KEY UPDATE;

      -- 🔴 品項存在 + 同客人(真正的守門是 S1b 的 A7;這裡是訊息層)
      -- 🔴 欄名是 `orders.customer_user_id`,**不是** `user_id` —— 首版寫錯,而 plpgsql **惰性編譯**
      --    ⇒ `DDL-SYNTAX` 那格照樣綠,要到真的呼叫才會炸。harness 的成功路徑格才是抓到它的東西。
      SELECT pg_catalog.string_agg(w.oi::text, ', ' ORDER BY w.oi) INTO v_bad
        FROM (SELECT (e.value ->> 'order_item_id')::uuid AS oi
                FROM pg_catalog.jsonb_array_elements(p_items) e) w
       WHERE NOT EXISTS (
               SELECT 1 FROM public.order_items oi
                 JOIN public.orders o ON o.id = oi.order_id
                WHERE oi.id = w.oi AND o.customer_user_id = v_ship.customer_user_id);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION '掛品項:這些品項不存在、或不屬於這個包裹的客人(%)。同一箱只能裝同一位客人的東西。', v_bad
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_item_not_customers';
      END IF;

      -- 🔴 **交棒 1 的前緣拒絕**:增量 ≤ instock − shipped。
      --    🔴 這不是「只有訊息」的一段(檔頭有實證):重算 trigger 不掛 shipment_items
      --       ⇒ 掛品項當下 C9 不發火,**這裡是唯一擋住「超量的箱子被裝起來」的地方**。
      -- 🔴🔴 **兩條 HIGH(跨模型審查 Fable)在這一段,兩條都不是併發問題、順序操作就達得到**:
      --   **F1 惰性建列**:摘要表**沒有採購紀錄就沒有列**(A4a 的 trigger 只掛 procurement/receipts/
      --     cancellation,`20260803140000:404-420`;s2b `:484` COMMENT 逐字「無列 = 四個 0,
      --     **讀取端必須 LEFT JOIN + COALESCE**」)。首版用 `JOIN`(INNER)⇒ 那種品項直接**掉出比對**、
      --     前緣**靜默放行**,一個「可出 0 件」的品項零錯誤裝進箱。⇒ 改 `LEFT JOIN` + `COALESCE(...,0)`。
      --   **F2 跨呼叫累加**:摘要的 `shipped_quantity` **只計已出貨的箱**
      --     (s2b `:288-293` SHIPPED-TRUTH 逐字 `sh.shipped_at IS NOT NULL`)⇒
      --     **已裝箱但還沒出貨的量不在算式的任何一項**。instock 5:箱 A 掛 3、箱 B 掛 3 兩次都過,
      --     合計 6 > 5,出第二箱時 raw 23514 = 整箱重做。
      --     🔴 **這是對 plan §0.3 交棒 1 字面公式(`增量 ≤ instock − shipped`)的偏離**:
      --        我把「已佔用」從「已出貨」擴成「**已出貨 + 已裝箱未出貨**」。
      --        理由:交棒 1 要防的失敗就是「箱子超量」,而字面公式沒有預期到「未出貨的箱也佔量」;
      --        照字面寫,本片自稱要擋的那件事**順序操作就繞得過**。
      --        方向是**只拒更多、不放更多**(保守側),但**它改變了 RPC 會接受什麼** ⇒ STOP 列為可否決項。
      SELECT pg_catalog.string_agg(
               '品項 ' || w.oi::text || ':可出 ' || w.avail::text
               -- 🔴 R2-F-C3:pending **含本箱自己** ⇒ 不得說「別的」包裹,那與事實不符。
               || ' 件(其中已裝在尚未出貨的包裹裡 ' || w.pending::text || ' 件,含本箱)'
               || ',你要出 ' || w.qty::text || ' 件', E'\n' ORDER BY w.oi)
        INTO v_bad
        FROM (
          SELECT r.oi, r.qty,
                 coalesce(q.instock_quantity, 0) - coalesce(q.shipped_quantity, 0) - coalesce(pnd.n, 0) AS avail,
                 coalesce(pnd.n, 0) AS pending
            FROM (SELECT (e.value ->> 'order_item_id')::uuid AS oi,
                         -- 🔴 R2-F-M2:`{"quantity": 1.0}` 過得了形狀閘(number、1.0 = floor(1.0)、≤10000),
                     --    但 jsonb **保留 scale** ⇒ 文字是 '1.0',`::int` 的 int4in 不收小數點 ⇒ raw 22P02。
                     --    ⇒ 一律 `::numeric::int`(形狀閘已保證它是整數值)。
                     (e.value ->> 'quantity')::numeric::int AS qty
                    FROM pg_catalog.jsonb_array_elements(p_items) e) r
            -- 🔴 F1:LEFT JOIN,無摘要列 = 四個 0(照 s2b:484 立的讀取契約)
            LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = r.oi
            -- 🔴 F2:已裝箱但**還沒出貨、也沒作廢**的量。**本包裹自己的也算在內**
            --    ⇒ 同一箱用不同冪等鍵再掛同一品項時,pending 已含前一次的量(保守側)。
            --    🔴 **已知窗口(R2-F-C3)**:那種「同箱補掛」若數量仍在 avail 內會穿過前緣、
            --       撞 S1b 的 UNIQUE ⇒ **raw 23505**,本片不轉譯。harness 有格把它釘成可觀察事實。
            LEFT JOIN LATERAL (
              SELECT pg_catalog.sum(si.shipped_quantity) AS n
                FROM public.shipment_items si
                JOIN public.shipments sh ON sh.id = si.shipment_id
               WHERE si.order_item_id = r.oi
                 AND sh.shipped_at IS NULL AND sh.deleted_at IS NULL
            ) pnd ON true
        ) w
       WHERE w.qty > w.avail;
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION E'掛品項:有品項的出貨數量超過現有可出數量。\n%\n若數量不對,請先確認到貨數量,或改成可出的數量。', v_bad
          USING ERRCODE = 'P2B27', CONSTRAINT = 'pcm_b2_w3b2_exceeds_instock';
      END IF;

      -- 🔴 寫入依 `order_item_id` 排序(排序契約要一路貫穿到 INSERT,不只在取鎖那句)
      INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity)
      SELECT p_shipment_id, w.oi, w.qty
        FROM (SELECT (e.value ->> 'order_item_id')::uuid AS oi,
                     -- 🔴 R2-F-M2:`{"quantity": 1.0}` 過得了形狀閘(number、1.0 = floor(1.0)、≤10000),
                     --    但 jsonb **保留 scale** ⇒ 文字是 '1.0',`::int` 的 int4in 不收小數點 ⇒ raw 22P02。
                     --    ⇒ 一律 `::numeric::int`(形狀閘已保證它是整數值)。
                     (e.value ->> 'quantity')::numeric::int AS qty
                FROM pg_catalog.jsonb_array_elements(p_items) e) w
       ORDER BY w.oi;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_cnt := pg_catalog.jsonb_array_length(p_items);
      -- 🔴 BEFORE trigger 抑制單列會讓「部分掛上」冒充「全部掛上」⇒ 筆數必須逐字對(A8a1 步9 同型)
      IF v_n <> v_cnt THEN
        RAISE EXCEPTION '掛品項:實際寫入 % 筆、清單有 % 筆,不一致 ⇒ 整筆取消,不留半箱。', v_n, v_cnt
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3b2_rowcount';
      END IF;
      EXIT;
    EXCEPTION WHEN deadlock_detected THEN
      -- 🔴 排序對了就不該走到這裡;它防的是「別的路徑沒照排序」。耗盡要有自己的碼、不靜默。
      IF v_try >= c_max_deadlock_tries THEN
        RAISE EXCEPTION '掛品項:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
          USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3b2_deadlock_exhausted';
      END IF;
    END;
  END LOOP;

  -- ── 快照 + 回填 ────────────────────────────────────────────
  -- 🔴 **`to_jsonb` 同源**(開工令 ②,形狀照 W3-1):三個值直接取自 `to_jsonb(shipments.*)`,
  --    程式裡沒有任何一處自己把值轉成字串。W2 的白名單只收這三欄。
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('add_items', p_idempotency_key, p_shipment_id, v_snap);
END
$impl$;

-- ── ④-b parent guard:叫過車的箱不准再加品項 ─────────────────
CREATE OR REPLACE FUNCTION public.pcm_b2_shipment_items_parent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- 原本是 `public, pg_temp`:pg_catalog 沒明列時仍會隱含最先搜尋, 但 public 可寫、會排在其餘解析之前(definer-search-path-gate 擋下)。
-- 本體裡的物件本來就全部寫全名 ⇒ 改成空字串不改行為(codex 1b R1 nit:上一版註解把搜尋順序講錯了)。
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_shipped   timestamptz;
  v_deleted   timestamptz;
  v_ship_cust uuid;
  v_ref       text;
  v_item_cust uuid;
  v_attempted timestamptz;
BEGIN
  SELECT s.shipped_at, s.deleted_at, s.customer_user_id, s.shipment_reference, s.hct_dispatch_attempted_at
    INTO v_shipped, v_deleted, v_ship_cust, v_ref, v_attempted
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

  -- P0-1(codex plan R2 B2):叫過新竹的箱, 叫車當時的資格檢查不可以替之後加進來的訂單放行 ⇒ 不准再加。
  IF v_attempted IS NOT NULL THEN
    RAISE EXCEPTION
      '包裹已叫過新竹,不可再加品項(shipment=%)', v_ref
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipment_items_parent_dispatch_claimed';
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

-- ── ④-c 標已出貨 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_shipment_shipped(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_tracking_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_try    int := 0;
  v_replay jsonb;
  v_ship   record;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
  v_orders  integer;
  v_blocked text;
  v_dispatched timestamptz;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_shipment_shipped:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- 🔴 冪等認領在**任何業務寫入之前**,而且**在重試迴圈之外**(…w2….sql:343 合約逐字)。
  v_replay := public.pcm_b2_shipping_idem_claim(
    'ship', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('ship', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(🔴 **在迴圈外、只跑一次**)────────────────────
  -- 🔴 W7d-1 設計決策:重試迴圈**只包寫入、不包這一段**。
  --    ①迴避 B-295-STOP ⑦ 的前置提醒(replica 繞 FK ⇒ 孤兒列讓「重試一次就好」失效)——
  --      那條提醒的前提是「重試會重讀資料」,本設計**不重讀**。刻意迴避,不是忘記。
  --    ②寫入自帶守門(WHERE 含 deleted_at IS NULL AND shipped_at IS NULL)
  --      ⇒ 併發改態時是 0 列、走既有 rowcount 閘,不需要靠重讀保護。
  SELECT s.id, s.shipment_reference, s.carrier_code, s.shipped_at, s.deleted_at, s.hct_dispatched_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '出貨:包裹 % 已作廢,不能出貨。要出這批貨請開一張新的包裹。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_shipment_voided';
  END IF;
  IF v_ship.shipped_at IS NOT NULL THEN
    -- 🔴 這條走到的**只有異鍵**(同鍵同 payload 早在 claim 就轉重放了)⇒ 是「兩個人各按一次」的情境。
    RAISE EXCEPTION '出貨:包裹 % 已經寄出了(可能是別人剛按過)。不需要再出一次。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_already_shipped';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM public.shipment_items si WHERE si.shipment_id = p_shipment_id;
  IF v_n = 0 THEN
    -- 真正的守門是 S1b 的 X1 `shipments_items_presence`(AFTER constraint trigger);這裡是訊息層。
    RAISE EXCEPTION '出貨:包裹 % 裡還沒有任何品項,不能出貨。請先把要寄的品項加進來。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_no_items';
  END IF;
  -- 🔴 單號要求照 s1a1 的 `shipments_shipped_needs_tracking`:`other` 以外都要單號(這裡是訊息層)
  IF v_ship.carrier_code <> 'other' AND public.pcm_b2_is_blank(p_tracking_number) THEN
    RAISE EXCEPTION '出貨:快遞商是 % 時必須填貨運單號才能出貨。', v_ship.carrier_code
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_tracking_required';
  END IF;

  -- ── 出貨 + 轉譯(🔴 W7d-1:包在 40P01 有界重試裡)────────────
  LOOP
    v_try := v_try + 1;
    BEGIN
      -- 🔴 P0-1 §3.2:新竹回成功或管理者確認交貨(hct_dispatched_at 有值,write-once)= 貨已交出 ⇒ 標出貨是補記事實, 不套判準;
      --    資格證明在叫車 claim 當下已寫。其餘(沒走新竹、叫車沒送出 / 被拒 / 未知)⇒ 鎖序 shipments → orders 後判準, 通過才寫證明。
      --    鎖在子交易裡:40P01 回捲會放掉本圈的鎖與證明列, 下一圈同序重拿。
      -- 🔴 hct_dispatched_at 要【先鎖箱再讀】(codex 1b R1 should-fix):write-once 只保證讀到的非 NULL 不會變回 NULL,
      --    不保證 NULL 不會變成有值 —— 管理者確認交貨(持箱 FOR UPDATE)正在提交時, 鎖前讀到的舊 NULL 會把該放行的補記擋掉。
      SELECT s.hct_dispatched_at INTO v_dispatched
        FROM public.shipments s WHERE s.id = p_shipment_id
         FOR NO KEY UPDATE;
      IF v_dispatched IS NULL THEN
        SELECT b.order_count, b.blocked INTO v_orders, v_blocked
          FROM public.pcm_p01_lock_box_orders(p_shipment_id, NULL) b;
        IF v_blocked IS NOT NULL THEN
          RAISE EXCEPTION '出貨:包裹 % 裡有不能再出貨的訂單:%。已取消或刷卡已全額退款的單不能出貨, 請先作廢這一箱。', v_ship.shipment_reference, v_blocked
            USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_order_ship_blocked';
        END IF;
        PERFORM public.pcm_p01_write_clearances(p_shipment_id, 'mark_shipped');
      END IF;

      -- 🔴 **一次只動一箱**(交棒 10 的契約):`WHERE id = p_shipment_id` 是單列。
      --    這一句會觸發 S2b 的重算 trigger ⇒ C9 家族的 23514 就是在這裡冒出來的,
      --    而那發 trigger 會去鎖 order_items ⇒ **與掛品項路徑反向,這就是 40P01 的來源**。
      -- 🔴 **F6(跨模型審查):WHERE 只有 `id=` 會有作廢×出貨的 TOCTOU。**
      --    ⇒ 條件寫進 WHERE:輸了就是 0 列,直接走下面既有的 rowcount 閘。
      UPDATE public.shipments
         SET shipped_at = now(), tracking_number = p_tracking_number
       WHERE id = p_shipment_id
         AND deleted_at IS NULL
         AND shipped_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        -- 🔴 0 列的成因有二:①真的沒這箱 ②**併發**把它作廢或出貨了(F6 的 WHERE 條件輸掉)。
        RAISE EXCEPTION '出貨:這個包裹的狀態剛剛被別人改過(可能已被作廢或已出貨),這次沒有出貨成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c3_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        -- 🔴 觀察點:NOTICE 送出即不可撤回,子交易回滾吃不掉它 ⇒ 這是唯一量得到迭代數的東西。
        RAISE NOTICE 'W7D1-RETRY|%|%', 'ship', v_try;
        -- 🔴 零退避是刻意的(檔頭有完整理由)。**不要加 pg_sleep。**
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '出貨:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c3_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        -- 🔴 `P2B26`(上面 rowcount 那條)**不會**被這裡攔到:raise_exception = P0001,P2B26 是自訂碼。
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        -- 🔴 **不認得就原封拋回**,不得吞掉(見轉譯層 COMMENT)。
        IF v_msg IS NULL THEN RAISE; END IF;
        RAISE EXCEPTION '%', v_msg
          USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c3_translated';
    END;
  END LOOP;

  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('ship', p_idempotency_key, p_shipment_id, v_snap);
END
$fn$;

-- ── ④-d 叫車 claim ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_claim_hct_dispatch(
  p_shipment_reference text,
  p_edelno             text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status     text;
  v_deleted    timestamptz;
  v_attempted  timestamptz;
  v_edelno     text;
  v_n          int;
  v_ship_id    uuid;
  v_orders     integer;
  v_blocked    text;
BEGIN
  SELECT id, hct_status, deleted_at, hct_dispatch_attempted_at, hct_request_id
    INTO v_ship_id, v_status, v_deleted, v_attempted, v_edelno
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_claim_hct_dispatch:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 **已作廢的箱不准【開始】叫車** —— 這一格屬於 claim, 不屬於 record(codex R1 must-fix 三)。
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張出貨單已作廢(%), 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張單的新竹狀態是 %(要 submitted 才叫得動車), shipment=%',
      COALESCE(v_status, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:貨號對不上(這一箱是 %, 而送來的是 %), shipment=%',
      COALESCE(v_edelno, '(空)'), COALESCE(p_edelno, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 P0-1 §4:叫車是真正的閘(§3.2)。鎖序 shipments → orders, 鎖後判準;被擋 ⇒ 不佔位。
  SELECT b.order_count, b.blocked INTO v_orders, v_blocked
    FROM public.pcm_p01_lock_box_orders(v_ship_id, NULL) b;
  IF v_orders = 0 THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 沒有任何品項, 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 裡有不能再出貨的訂單(%), 不得叫車。請先作廢這一箱', p_shipment_reference, v_blocked
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 **佔位:資格條件【全部】住在這一句的 WHERE 裡**(codex R2 must-fix)。
  --    ⛔ ~~上面那幾個 IF 擋完就 `UPDATE … WHERE 箱號 AND 佔位 IS NULL`~~
  --    ⇒ 出事時序:B 寫了 `deleted_at` **還沒提交** ⇒ A 的 `SELECT` 讀到舊版「未作廢」而過關
  --      ⇒ A 的 UPDATE 卡在 B 的列鎖 ⇒ B 提交 ⇒ 📌 **PostgreSQL 在 READ COMMITTED 下**
  --      **只重驗【這一句的 WHERE】, 不會重跑上面那幾個 IF** ⇒ WHERE 仍成立 ⇒ 放行
  --      ⇒ 🛑 **一個已作廢的箱叫到了車。**
  --    ✅ ⇒ **上面那幾個 IF 從此只負責【講一句人看得懂的話】, 判準在這一句。**
  --      📌 兩者不一致時以這一句為準 —— 它是唯一在鎖之後還會被重新檢查的東西。
  UPDATE public.shipments
     SET hct_dispatch_attempted_at = pg_catalog.now()
   WHERE shipment_reference = p_shipment_reference
     AND hct_dispatch_attempted_at IS NULL
     AND deleted_at IS NULL
     AND hct_status = 'submitted'
     AND hct_request_id IS NOT DISTINCT FROM p_edelno;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 1 THEN
    -- 🛑 這裡的訊息要說得出【兩個世界】:上一次叫成功了、或上一次叫到一半掛了。
    --    兩者都不准自動再打一發 —— 重複派遣的行為 V15 §8 沒寫, 我們也沒問過。
    -- ⚠️ 而它也可能是**剛剛才被別人作廢 / 改狀態**(上面的 IF 過了而這一句沒過)
    --    ⇒ 訊息把兩種都講出來, 不要只說一種讓人找錯方向。
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 佔不到位。兩種可能:'
      ' ①它已經在 % 開始叫車了(可能叫到車, 也可能叫到一半掛掉)'
      ' ②它剛剛被別人作廢或改了狀態。'
      ' 兩種都不准自動再打一發 —— 再叫一次會怎樣新竹沒有寫、我們沒問過 ⇒ 請人看一眼。',
      p_shipment_reference, COALESCE(v_attempted, pg_catalog.now())
      USING ERRCODE = 'P0001';
  END IF;

  -- P0-1 §3.3:佔位成功 = 這一刻持訂單鎖、判準通過 ⇒ 寫出貨資格證明。之後 parent guard 不准再加品項, 集合不會變。
  PERFORM public.pcm_p01_write_clearances(v_ship_id, 'claim');
END
$fn$;

-- ── ④-e 復原作廢 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_try    int := 0;
  v_replay jsonb;
  v_ship   record;
  v_bad    text;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
  v_orders  integer;
  v_blocked text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_unvoid_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'unvoid', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('unvoid', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(迴圈外、只跑一次)────────────────────────────
  SELECT s.id, s.shipment_reference, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '復原包裹:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NULL THEN
    RAISE EXCEPTION '復原包裹:包裹 % 本來就沒有作廢,不需要復原。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_not_voided';
  END IF;

  -- ── 🔴 **M4 順序前緣守門**(W3c-2 的核心)────────────────────
  --    🔴 `shipped_at IS NOT NULL` 是**正確性條件**:草稿箱的 shipment_items 數量非零
  --       但不進 SHIPPED-TRUTH ⇒ 少了這個條件會**誤擋安全的草稿復原**。不是省算。
  IF v_ship.shipped_at IS NOT NULL THEN
    SELECT pg_catalog.string_agg(
             '品項 ' || w.oi::text || ':這箱要回加 ' || w.qty::text || ' 件,'
             || '但現在到貨只有 ' || w.instock::text || ' 件、已經出掉 ' || w.shipped::text || ' 件'
             || '(還能放 ' || (w.instock - w.shipped)::text || ' 件)', E'\n' ORDER BY w.oi)
      INTO v_bad
      FROM (
        SELECT si.order_item_id AS oi,
               si.shipped_quantity AS qty,
               coalesce(q.instock_quantity, 0) AS instock,
               coalesce(q.shipped_quantity, 0) AS shipped
          FROM public.shipment_items si
          -- 🔴 惰性建列 ⇒ **LEFT JOIN + COALESCE**(`…s2b.sql:484` 立的讀取契約;W3-2 在這裡被打過)
          LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = si.order_item_id
         WHERE si.shipment_id = p_shipment_id
      ) w
     WHERE w.shipped + w.qty > w.instock;
    IF v_bad IS NOT NULL THEN
      -- 🔴 **交棒 2 的引導在這條路上是反過來的**:箱子已經是作廢狀態,叫人「先作廢」是廢話。
      RAISE EXCEPTION E'復原包裹:這箱復原之後,出貨數量會超過現在的到貨數量,所以不能復原。\n%\n'
                      '接下來可以這樣處理:①去採購頁把到貨數量改回正確的,再回來復原;'
                      '或 ②不要復原,改用「照這箱內容開一張新的包裹」**並把數量調整成放得下的**。', v_bad
        USING ERRCODE = 'P2B27', CONSTRAINT = 'pcm_b2_w3c2_unvoid_exceeds_instock';
    END IF;
  END IF;

  -- ── 復原(清空 deleted_at + void_reason;X7 是雙向配對,兩欄一起清)────
  -- 🔴 WHERE 帶上 `deleted_at IS NOT NULL`(W3-3 F6 的 TOCTOU 教訓,本線第三次用)。
  LOOP
    v_try := v_try + 1;
    BEGIN
      -- 🔴 P0-1 §3.1:箱裡有已取消或刷卡已全額退款的訂單 ⇒ 不准復原。鎖序 shipments → orders, 鎖在子交易裡(40P01 回捲會放掉)。
      SELECT b.order_count, b.blocked INTO v_orders, v_blocked
        FROM public.pcm_p01_lock_box_orders(p_shipment_id, NULL) b;
      IF v_blocked IS NOT NULL THEN
        RAISE EXCEPTION '復原包裹:包裹 % 裡有不能再出貨的訂單:%。已取消或刷卡已全額退款的單不能復原出貨, 請開一張新的包裹只裝還能出的品項。', v_ship.shipment_reference, v_blocked
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_p01_order_ship_blocked';
      END IF;

      UPDATE public.shipments
         SET deleted_at = NULL, void_reason = NULL
       WHERE id = p_shipment_id
         AND deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '復原包裹:這個包裹的狀態剛剛被別人改過,這次沒有復原成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        RAISE NOTICE 'W7D1-RETRY|%|%', 'unvoid', v_try;
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '復原包裹:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c2_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
        -- 🔴🔴 **W7d-1(B-220-A MF-1):C9 的補救方向在復原這條路上是相反的。**
        --    共用轉譯層那兩句逐字說「①先作廢這個包裹」,但走到這裡時**那箱本來就是作廢態**
        --    (復原失敗 ⇒ deleted_at 沒被清掉)⇒ 照抄等於叫人去作廢一個已經作廢的箱子。
        --    ⇒ 補救知識屬於**呼叫端**:轉譯層說「哪裡壞了」,這裡說「接下來怎麼辦」。
        -- 🔴 可達性(誠實邊界):上面的 M4 前緣守門會先擋掉絕大多數 ⇒ **這裡只在 TOCTOU 窗內走得到**
        --    (前緣通過後、UPDATE 之前,併發改變了到貨或出貨量)。不是常態路徑,但錯字面就是錯字面。
        -- 🔴 與前緣那句**刻意不逐字相同**(逐字複製 = 第三份同義字面 = 本線的復發病),
        --    但指向同一組動作;兩處同族,改一處要想到另一處。
        -- 🔴 兩個 conname 的**補救動作不一樣**,不得共用一句(關卡2 must-fix):
        --    · `oiqs_shipped_le_instock`      = 出貨量 > 到貨量 ⇒ 要動的是**到貨數量**(採購頁)。
        --    · `oiqs_cancelled_shipped_le_quantity` = 取消+出貨 > 訂購量 ⇒ 這條**與到貨量無關**,
        --      叫人去採購頁改到貨數量照做也復原不了。要看的是**取消紀錄**。
        IF v_state = '23514' AND v_con = 'oiqs_shipped_le_instock' THEN
          v_msg := '復原包裹:這箱復原之後,出貨數量會超過到貨數量(剛剛數字被別人改過),所以不能復原。'
                || '請去採購頁確認到貨數量後再復原;或不要復原,改用「照這箱內容開一張新的包裹」並調整數量。'
                || '**不要**再去作廢它 —— 它現在就是作廢狀態。';
        ELSIF v_state = '23514' AND v_con = 'oiqs_cancelled_shipped_le_quantity' THEN
          v_msg := '復原包裹:這箱復原之後,「已取消 + 已出貨」會超過客人訂購的數量,所以不能復原。'
                || '請先確認這張訂單的取消紀錄(不是到貨數量);或不要復原,改用「照這箱內容開一張新的包裹」並調整數量。'
                || '**不要**再去作廢它 —— 它現在就是作廢狀態。';
        END IF;
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c2_translated';
    END;
  END LOOP;

  -- 🔴 `to_jsonb` 同源(W3-1 立的構造性形狀,本線第五次照抄)
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('unvoid', p_idempotency_key, p_shipment_id, v_snap);
END
$fn$;

-- ── ④-f 送新竹建單 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_record_hct_submit(
  p_shipment_reference text,
  p_status             text,
  p_request_id         text,
  p_raw                jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_old_status text;
  v_deleted    timestamptz;
  v_ship_id    uuid;
  v_orders     integer;
  v_blocked    text;
BEGIN
  IF p_status NOT IN ('submitted', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'admin_record_hct_submit:狀態只收 submitted / failed / unknown(收到 %)', p_status;
  END IF;

  SELECT id, hct_status, deleted_at INTO v_ship_id, v_old_status, v_deleted
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_submit:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 **已作廢的箱不得再寫新竹欄位。**
  --    作廢的意思是「這張箱單在我們系統裡撤銷了」, 而**我們對貨運零呼叫**
  --    ⇒ 對它記一筆「送出去了」會讓紀錄與現實各說各話。
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張出貨單已作廢(%), 不得再寫新竹狀態', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 **重送規則。而它擋的不是「重複呼叫」, 是【對一個不該再送的世界送出】。**
  --    · submitted ⇒ 已經成立。再送在新竹那端是【更正】, 那是另一個動作。
  --    · unknown   ⇒ 🛑 **絕不自動重送。**「查無」有兩個世界(真的沒進去 / 新竹查詢與建單不同步),
  --      而**我們分不出來** ⇒ 📌 **在分不出來的時候重送, 等於用一個我們沒有的知識**
  --      **去做一個不可回收的動作。** 唯一出路 = 先查(`QueryEDELNO`), 查到才補寫。
  --    ✅ 而 `unknown ⇒ submitted` 是**允許**的 —— 那不是重送, 是**補記一個已經發生的事實**。
  IF v_old_status = 'submitted' THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張單已經是 submitted(%), 不得再寫。'
      ' 要改內容 = 新竹那端的【更正】流程(帶新竹貨號重送), 不是再送一次。', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_old_status = 'unknown' AND p_status = 'unknown' THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張單已經是 unknown(%), 再寫一次 unknown 不會讓我們更知道。'
      ' 先跑 QueryEDELNO:查到貨號 ⇒ 補寫 submitted;查無 ⇒ 停下來給人看, 不要自動重送。',
      p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 P0-1(codex plan R1 ⑨):draft / failed ⇒ 這是【新的一次送單】(TS 在 HTTP 之前寫 unknown 佔位)⇒ 判準。
  --    unknown → *(查詢補記 / 結果補記)是記錄已發生的事, 不判。鎖序:上面已 FOR UPDATE 箱子 ⇒ 再鎖訂單。
  IF v_old_status IN ('draft', 'failed') THEN
    SELECT b.order_count, b.blocked INTO v_orders, v_blocked
      FROM public.pcm_p01_lock_box_orders(v_ship_id, NULL) b;
    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION
        'admin_record_hct_submit:這一箱 % 裡有不能再出貨的訂單(%), 不得送新竹建單。請先作廢這一箱', p_shipment_reference, v_blocked
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.shipments
     SET hct_status       = p_status,
         hct_request_id   = COALESCE(p_request_id, hct_request_id),
         hct_raw_response = p_raw
   WHERE shipment_reference = p_shipment_reference;
END
$fn$;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列)
  v_functions text[] := ARRAY[
    'public.pcm_order_ship_blocked(uuid)',
    'public.pcm_p01_lock_box_orders(uuid,uuid[])',
    'public.pcm_p01_write_clearances(uuid,text)',
    'public.pcm_b2_add_items_impl(text,uuid,jsonb)',
    'public.pcm_b2_shipment_items_parent_guard()',
    'public.admin_mark_shipment_shipped(text,uuid,text)',
    'public.admin_claim_hct_dispatch(text,text)',
    'public.admin_unvoid_shipment(text,uuid)',
    'public.admin_record_hct_submit(text,text,text,jsonb)'
  ]::text[];
  r record;
  v_bad text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- sig, service_role 應不應該能執行, proconfig 應是什麼, 本體應含的字面
      ('public.pcm_order_ship_blocked(uuid)',                  false, ARRAY['search_path=""'],                               'card_fully_refunded'),
      ('public.pcm_p01_lock_box_orders(uuid,uuid[])',          false, ARRAY['search_path=""', 'lock_timeout=5s'],            'FOR SHARE'),
      ('public.pcm_p01_write_clearances(uuid,text)',           false, ARRAY['search_path=""'],                               'shipment_order_ship_clearances'),
      ('public.pcm_b2_add_items_impl(text,uuid,jsonb)',        false, ARRAY['search_path=""', 'lock_timeout=5s'],            'pcm_p01_lock_box_orders'),
      ('public.pcm_b2_shipment_items_parent_guard()',          false, ARRAY['search_path=""', 'lock_timeout=5s'],            'shipment_items_parent_dispatch_claimed'),
      ('public.admin_mark_shipment_shipped(text,uuid,text)',   true,  ARRAY['search_path=""', 'lock_timeout=5s'],            'pcm_p01_write_clearances(p_shipment_id, ''mark_shipped'')'),
      ('public.admin_claim_hct_dispatch(text,text)',           true,  ARRAY['search_path=""'],                               'pcm_p01_write_clearances(v_ship_id, ''claim'')'),
      ('public.admin_unvoid_shipment(text,uuid)',              true,  ARRAY['search_path=""', 'lock_timeout=5s'],            'pcm_p01_lock_box_orders'),
      ('public.admin_record_hct_submit(text,text,text,jsonb)', true,  ARRAY['search_path=""'],                               'pcm_p01_lock_box_orders')
    ) AS v(sig, svc, cfg, marker) LOOP
    IF pg_catalog.to_regprocedure(r.sig) IS NULL THEN
      RAISE EXCEPTION '後置閘:% 不存在', r.sig;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = pg_catalog.split_part(pg_catalog.split_part(r.sig, '.', 2), '(', 1)) <> 1 THEN
      v_bad := v_bad || r.sig || ' 簽章不是恰好 1 支;';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig)) THEN
      v_bad := v_bad || r.sig || ' 不是 SECURITY DEFINER;';
    END IF;
    IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig)) IS DISTINCT FROM r.cfg THEN
      v_bad := v_bad || r.sig || ' proconfig 漂了;';
    END IF;
    IF pg_catalog.pg_get_userbyid((SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig))) <> 'postgres' THEN
      v_bad := v_bad || r.sig || ' owner 不是 postgres;';
    END IF;
    IF pg_catalog.has_function_privilege('anon', r.sig, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      v_bad := v_bad || r.sig || ' 對 anon/authenticated 開著;';
    END IF;
    IF pg_catalog.has_function_privilege('service_role', r.sig, 'EXECUTE') IS DISTINCT FROM r.svc THEN
      v_bad := v_bad || r.sig || ' service_role EXECUTE 應為 ' || r.svc::text || ';';
    END IF;
    IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r.sig)), r.marker) = 0 THEN
      v_bad := v_bad || r.sig || ' 本體沒有「' || r.marker || '」;';
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_functions, 1) <> 9 THEN
    v_bad := v_bad || '收權清單不是 9 支;';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '後置閘失敗:%', v_bad;
  END IF;
  RAISE NOTICE '✅ 20260916000000 後置閘全過:9 支函式的 SECURITY DEFINER / proconfig / owner / ACL / 本體字面';
END
$post$;

COMMIT;
