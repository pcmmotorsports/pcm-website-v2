-- ============================================================
-- M-4b E10 第 2 批 B2 · W3-2:`admin_add_shipment_items`(掛品項)
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2 定稿)§2 W3 列 / §0.3 交棒 1 / §1e M3。
-- 開工令 = 主視窗 `B-196-A` ④(範圍)+ `B-195-A` ③(四條硬前置)+ `B-196-A` ② 的附帶格。
-- 上游 = W0b/W1/W2(冪等層)+ W3-1(建箱)+ S1b(`shipment_items`)+ S2a/S2b(摘要與重算)。
-- 驗收 harness = `scripts/w3b2-verify.sh`。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` **不吃 `.sql`**。證據只有 harness 實跑。
--
-- ══ 本片交付什麼 ═════════════════════════════════════════════
--   ① `admin_add_shipment_items` 本體:解析 `p_items` → 取鎖(**依 `order_item_id` 排序**)
--      → 前緣拒絕(交棒 1)→ `INSERT shipment_items` → 回填快照
--   ② **交棒 1** 的 `增量 ≤ instock − shipped` **訊息層前緣拒絕**(哪個品項、可出多少、你要多少)
--   ③ **多品項取鎖序** `ORDER BY order_item_id` + `40P01` 重試(交棒 1 的後半)
--   ④ `p_items` 的**形狀契約**(plan 未規定 ⇒ 本片拍板並申報)
--
-- ══ 🔴 本片**刻意不含** ═══════════════════════════════════════
--   · **Q8=A 的 23514 攔截轉譯** = **W3-3**(主視窗 `B-196-A` ② 裁定)。
--     理由逐字:W 線是 pending 批、**全齊才同批 apply** ⇒ 正式站永遠不會出現「W3-2 上了而 W3-3 沒上」
--     的窗口;M3 在掛品項路徑的 raw 23514 裸露**只存在於開發序、不存在於生產**。集中在 W3-3 = 單一實作點。
--     🔴 **附帶條件(同令)**:本片 harness 要有一格**證明那個窗口存在** ——
--        前緣拒絕被繞過(併發下修 `instock`)時 **raw 23514 真的會冒出來**。
--        那格現在**期望裸錯**;W3-3 落地後它的期望值改成「轉譯後的人話」= W3-3 的驗收之一。
--        ⇒ 「窗口存在」這件事本身被釘住,**不靠人記得**。
--   · 出貨 / 作廢 / unvoid、禁批次契約守門(W4)、真併發證據(W6a-c)
--
-- ══ 🔴 `p_items` 的形狀契約(**本片拍板**,plan 未規定;grep `p_items` 零命中規格)═══
--   `[{"order_item_id": "<uuid>", "quantity": <正整數>}, …]`,**非空陣列**、每個元素**恰好**這兩個鍵。
--   🔴 **為什麼要「恰好」而不是「至少」**:多餘的鍵會**默默進指紋**(W2 的 payload_hash 吃整個 jsonb)
--      ⇒ 呼叫端多送一個無害欄位,同一個業務意圖的重試會被判 `P2B22` payload 不符 ⇒ 合法重試被擋。
--      ⇒ 形狀收緊在**入口**,讓那種呼叫當場被拒(訊息說得出是哪個鍵),而不是變成冪等層的怪病。
--   🔴 **同一個 `order_item_id` 在同一次呼叫裡不得重複** —— 重複會讓「增量」的算法有兩種讀法
--      (逐筆比 vs 合計比),而 `shipment_items` 的 UNIQUE(shipment_id, order_item_id) 只會讓第二筆撞 23505。
--      ⇒ 入口就擋,不留給下游解釋。
--   🔴 **誠實邊界**:陣列**保序** ⇒ 同一批品項換個順序送 = 不同指紋 = 合法重試被判 `P2B22`
--      (W2 檔頭已立此邊界)。**W8 契約必須寫死「送出前依 `order_item_id` 排序」**。本片不假裝 DB 有正規化它。
--
-- ══ 🔴🔴 交棒 1 的前緣拒絕:**它比我原本以為的更重要**(施工中實證推翻)═══
--   我原本照 W3-1 的形狀寫成「這只是訊息層、拿掉資料仍然進不去」。**那句話是錯的**,實查推翻:
--   🔴 **摘要重算 trigger 只掛在 `shipments AFTER UPDATE OF shipped_at, deleted_at`**
--      (`…s2b_shipped_recompute_wire.sql:362`,該檔 COMMENT 逐字:「shipment_items 上**刻意不掛**,
--      因為 append-only 三支擋住了改/刪已寄出箱品項 ⇒ 出貨真值的變動一律經 UPDATE shipments」)。
--   ⇒ **掛品項當下 C9 `oiqs_shipped_le_instock` 根本不會發火** —— 超量的 `shipment_items` **寫得進去**,
--     要到**出貨那一刻**(W3-3 設 `shipped_at`)才炸,而且是 raw 23514。
--   ⇒ 本片這一段**不是「只有訊息」**:在 add 時刻**沒有別的檢查**,它是唯一在看數量的地方。
--   🔴 **但「擋住」這個詞一度過強**(跨模型審查打掉):首版的算式有兩條**不需要併發**的繞過路
--      (F1 惰性建列走 INNER JOIN 掉出、F2 跨呼叫累加不計 pending),順序操作就繞得過。
--      兩條都已修在下方算式裡;**現在的算式擋得住的是「我想到的那些」**,不是「所有的」。
--     拿掉它 ⇒ 員工會把箱子裝好、貼上單、然後在**出貨那一刻**才被擋,
--     補救路徑是交棒 2 的「先作廢包裹 → 改到貨 → 重新出貨」= **整箱重做**。
--   🔴 **誠實邊界(方向要說對)**:C9 仍然是正確性的最終強制點、資料不會被寫壞;
--      本片守的是**失敗發生的時機**(裝箱時 vs 出貨時),那是成本差異,不是正確性差異。
--   🔴 §1e **M3** 因此在本片的形狀是:前緣通過 → 之後 `instock` 被下修 → **出貨時**才噴 raw 23514。
--      **那是已知窗口、本片不假裝關掉它**;關它的是 W3-3 的攔截轉譯。
--      harness 的 `W3B2-M3-WINDOW-RAW` 把「那個窗口存在」釘成可觀察事實(現在期望裸錯,W3-3 落地後改期望值)。
--
-- ══ 🔴 取鎖序(交棒 1 後半 + 交棒 6)═════════════════════════
--   多品項在**同一交易**內取 `order_items` 的鎖,**一律 `ORDER BY order_item_id`**。
--   🔴 這是**死結預防**,不是死結修復:a8a2(多品項取消)也釘了 `ORDER BY oi.id`(交棒 6 未驗)。
--   🔴 `FOR NO KEY UPDATE`(不是 `FOR UPDATE`)—— `FOR UPDATE` 與 FK 的 `KEY SHARE` 會死結,
--      本線 A2b1 已實測 40P01(memory `project_m4b-a2b1-guard-decisions`)。
--   🔴 `40P01` 重試是**第二道**:排序對了就不該發生;它防的是「別的路徑沒照排序」。
--      上限 3,**耗盡有自己的碼**(不靜默)。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NULL
     OR pg_catalog.to_regclass('public.shipment_items') IS NULL
     OR pg_catalog.to_regclass('public.order_item_quantity_summary') IS NULL THEN
    RAISE EXCEPTION 'W3-2 前置閘失敗 — W2 冪等層 / shipment_items / 摘要表 有缺。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_deadlock_tries constant int := 3;
  v_replay jsonb;
  v_ship   record;
  v_bad    text;
  v_n      bigint;
  v_cnt    bigint;
  v_snap   jsonb;
  v_try    int := 0;
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
$fn$;

COMMENT ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb) IS
  'B2 掛品項 writer(W3-2)。冪等層在最前;取鎖與寫入一律 ORDER BY order_item_id;40P01 重試上限 3(耗盡碼 P2B28)。'
  '🔴 交棒 1 的「增量 ≤ instock − shipped」是**訊息層**(P2B27),正確性強制點是摘要表的 C9 oiqs_shipped_le_instock。'
  '🔴 §1e M3 的窗口(前緣檢查後、寫入前被下修 instock ⇒ raw 23514)**本片不關**,由 W3-3 的攔截轉譯關;'
  'scripts/w3b2-verify.sh 有一格把「那個窗口存在」釘成可觀察事實,W3-3 落地後改該格期望值。'
  '🔴 p_items 形狀契約:非空陣列、每元素恰含 order_item_id 與 quantity、不得重複 order_item_id;'
  '陣列保序 ⇒ **W8 送出前必須依 order_item_id 排序**,否則同一批品項換序會被判 P2B22。';

-- ── 檔內 fail-closed 斷言 ────────────────────────────────────
DO $$
DECLARE v_n bigint; v_bad text := '';
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_add_shipment_items';
  IF v_n <> 1 THEN v_bad := v_bad || 'signature 數 = ' || v_n || '(期望 1)'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_add_shipment_items(text,uuid,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_add_shipment_items(text,uuid,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_add_shipment_items(text,uuid,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticator', 'public.admin_add_shipment_items(text,uuid,jsonb)', 'EXECUTE') THEN
    v_bad := v_bad || 'ACL 漂了 ';
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'W3-2 斷言失敗:%', v_bad USING ERRCODE = 'P2B20'; END IF;
  RAISE NOTICE 'W3-2 斷言通過:掛品項單一 signature + ACL 未漂';
END
$$;

COMMIT;
