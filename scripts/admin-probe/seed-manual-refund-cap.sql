-- ⟦c7-LEDGERGATEREFUSES⟧ 條① 真瀏覽器驗收用的**補充種子**(2026-09-08, 線【退款】)。
--
-- 🔴 **為什麼另開一支而不改 `seed.sql`**:runbook 逐字「不要改 seed.sql —— 它全窗共用,
--    多幾筆可能動到別片的期望值」。(形狀抄 `seed-manual-order-walkthrough.sql`, 不自創。)
--
-- 🔴 **為什麼需要它**:`up.sh` 起完自己印「這台機器有 44 / 58 張表是空的」, 而
--    `order_refunds` 與 `order_manual_refunds` 都在那串裡
--    ⇒ 📌 **畫面會印「沒有資料」, 而那與「功能壞了」長得一樣** ⇒ 那一發是【零判別力】。
--
-- 🔵 **判準來源**(`20260824010000:117-134`, 逐字讀過不是猜):
--      pcm_manual_refund_rail_cap = 【現金+匯款收款總額】−【未作廢的人工退款總額】
--    ⇒ 要造負數 ⇒ **退得比收得多**;要造 NULL ⇒ **兩邊都零列**(SUM 回 NULL 前 COALESCE 為 0…
--      🔴 而它兩段都 COALESCE(…,0) ⇒ **這支函式回不了 NULL**)
--      ⇒ 📌 所以 UI 那個「railCap 為 null」的狀態, 【不是這支函式產生的】——
--         它來自呼叫端拿不到值(查詢失敗 / 沒有那張單)。**種子造不出它, 本檔不宣稱造得出。**
--
-- 🔴 `actor` 有 FK 指向 `staff` ⇒ 用【既有的 slug】不新增員工(當場查:staff_1;那張表的欄是 `id` 不是 `slug`)。
-- 🔵 單號用 `PCM-2026-90xx` ⇒ 合乎 `orders_display_id_format` 且與既有種子不撞。

-- ── 三張單, 覆蓋三個狀態(正負對照在同一發裡)──────────────────────
--
-- 🔴 **複製一張既有的單, 不自己組欄位** —— `orders` 有 10 個必填欄。
--    📌 我第一版自己列欄位, 當場撞 `column "status" does not exist`
--       —— 而 `ON_ERROR_STOP=1` 讓它【停下來】而不是灌一半。**那一行是這支種子能信的理由。**
DO $seed$
DECLARE src public.orders%ROWTYPE; i int;
BEGIN
  SELECT * INTO src FROM public.orders
   WHERE display_id NOT LIKE 'PCM-2026-90%' ORDER BY created_at LIMIT 1;
  IF src.id IS NULL THEN RAISE EXCEPTION '種子失敗:這台探針一張單都沒有 ⇒ 先跑 up.sh'; END IF;
  FOR i IN 1..3 LOOP
    -- 🔴 **插新列, 不改既有那張的 id** —— 我第二版用 UPDATE 改 id,
    --    當場撞 order_items_order_id_fkey(那張單有明細在指它)
    --    ⇒ 📌 「複製一張單」與「把一張單改名」是兩件事, 而後者會扯到它的下游
    src.id         := ('cab00000-0000-4000-8000-00000000000' || i)::uuid;
    src.display_id := 'PCM-2026-90' || lpad(i::text, 2, '0');
    INSERT INTO public.orders VALUES (src.*) ON CONFLICT (id) DO NOTHING;
  END LOOP;
END
$seed$;

-- ── 三張單各收 1000 現金 ────────────────────────────────────────────
-- 🔴 `cash` 需要 `request_id` —— CHECK `order_payments_rail_fields` 逐字(當場讀出來的):
--    cash ⇒ rec_trade_id IS NULL AND bank_reference IS NULL AND **request_id IS NOT NULL**
-- 🛑 **這裡刻意不寫 `ON CONFLICT`** —— 重跑會撞主鍵而【大聲失敗】, 那是對的。
INSERT INTO public.order_payments (id, order_id, rail, amount, request_id, received_at, created_at, actor)
SELECT ('cab10000-0000-4000-8000-00000000000' || n)::uuid,
       ('cab00000-0000-4000-8000-00000000000' || n)::uuid,
       'cash', 1000,
       ('cab30000-0000-4000-8000-00000000000' || n)::uuid,
       now(), now(), 'staff_1'
FROM generate_series(1,3) AS g(n);

-- ① 9001 退 1500 > 收 1000 ⇒ railCap = **-500** ⇒ 🔴 那條紅【應該】出現
INSERT INTO public.order_manual_refunds (id, order_id, rail, refund_amount, reason, actor, occurred_at)
VALUES ('cab20000-0000-4000-8000-000000000001'::uuid,
        'cab00000-0000-4000-8000-000000000001'::uuid,
        'cash', 1500, '探針種子:刻意退超過收款額', 'staff_1', now());

-- ② 9002 退 400 < 收 1000 ⇒ railCap = **600** ⇒ 🟢 正向對照:那條紅【不該】出現
INSERT INTO public.order_manual_refunds (id, order_id, rail, refund_amount, reason, actor, occurred_at)
VALUES ('cab20000-0000-4000-8000-000000000002'::uuid,
        'cab00000-0000-4000-8000-000000000002'::uuid,
        'cash', 400, '探針種子:正常範圍內', 'staff_1', now());

-- ③ 9003 退 1500 【而已作廢】⇒ 不計入 ⇒ railCap = **1000** ⇒ ⚪ 負向對照
--    🎯 它與 ① 的唯一差別是 voided_at ⇒ 那一格證明「作廢真的把額度還回來了」
INSERT INTO public.order_manual_refunds (id, order_id, rail, refund_amount, reason, actor, occurred_at, voided_at, void_reason, voided_by)
VALUES ('cab20000-0000-4000-8000-000000000003'::uuid,
        'cab00000-0000-4000-8000-000000000003'::uuid,
        'cash', 1500, '探針種子:退超額而已作廢', 'staff_1', now(), now(), '探針種子:測作廢還額度', 'staff_1');


-- ── 🔬 自己印讀數:三張單各自的 railCap, 而期望值寫在旁邊 ────────────
SELECT o.display_id,
       public.pcm_manual_refund_rail_cap(o.id) AS rail_cap,
       CASE o.display_id
         WHEN 'PCM-2026-9001' THEN '退1500>收1000 ⇒ 期望 -500 ⇒ 🔴 那條紅【要】出現'
         WHEN 'PCM-2026-9002' THEN '退 400<收1000 ⇒ 期望  600 ⇒ 🟢 正向對照:紅【不該】出現'
         WHEN 'PCM-2026-9003' THEN '退1500而已作廢 ⇒ 期望 1000 ⇒ ⚪ 作廢還額度'
       END AS expect
  FROM public.orders o
 WHERE o.display_id LIKE 'PCM-2026-90%'
 ORDER BY o.display_id;
