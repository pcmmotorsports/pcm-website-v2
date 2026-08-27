-- ============================================================
-- M-4b E10 第 2 批 B2 · W4-2:掛品項 body 抽 helper + 23505 接線 + **禁批次機制版**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2)§2 W4 列 / §1 Q3=A。
-- 開工令 = 主視窗 `B-204-A` ⑤(四件)。驗收 harness = `scripts/w4b-verify.sh`。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` 不吃 `.sql`。證據只有 harness 實跑。
-- 🔴 開工令 `B-204-A` ⑤ 的字面:「出貨線 DB 面最後一片施工片」。
-- 🔴 **那是當時的範圍宣稱、不是本檔的常在斷言**(R3 F6:寫下即過期、零格在守)—— 下一片落檔它就默默變假。
--
-- ══ 本片交付什麼 ═════════════════════════════════════════════
--   ① `admin_add_shipment_items` 的 body 抽成 `pcm_b2_add_items_impl`,RPC 變成**薄封裝 + 轉譯 handler**
--      ⇒ 接上 W3-3 早就備好的 **23505 轉譯**(裁定 `B-197-A` ②-2;W3-3 當時申報偏離、說要在 W4 做)。
--   ② **禁批次改成機制版**(裁定 `B-204-A` ②-1):`shipments` 掛 STATEMENT 級 AFTER UPDATE,
--      transition table 列數 > 1 就 `RAISE`,**GUC 旗標放行 break-glass**。
--   ③ 三個釘值檔同批重釘(`b2s2b` / `w5` / `w6a`)。
--
-- ══ 🔴 ① body 抽取:**程式抽、不手抄** ═══════════════════════════
--   W3-3 當初不接 23505 的理由逐字:「plpgsql 沒有『呼叫原本那支』的機制 ⇒ 只能 `CREATE OR REPLACE`
--   並**逐字複製整個 body** ⇒ 兩份字面、各自演化不會有人紅」。
--   ⇒ 本片的解法是**抽成 helper**:body 只剩一份(在 impl 裡),RPC 是薄封裝。
--   🔴 本檔的 impl body 是**用程式從 `…w3b2…sql` 抽出來**貼進來的,不是我手打的
--      —— 手打 200 行必然漂,而漂了不會有人紅。
--   🔴 **一次性複製的誠實邊界**:抽取只發生在本次落檔;此後 W3-2 那支的 body 是**歷史**,
--      真權威在本檔的 impl。**W3-2 的檔頭沒有辦法自動知道這件事** ⇒ harness 有格比對兩者、
--      並在本檔留指標;要改邏輯請改 impl。
--
-- ══ 🔴 ② 禁批次機制版(取代 W4-1 的 harness 版)═══════════════════
--   W4-1 把守門做在 harness,理由是「DB trigger 會擋掉 break-glass」。
--   🔴 跨模型審查打掉那個理由、主視窗裁定改機制版:**本 repo 已有 GUC 旗標制前例**
--      (A4a 的 `pcm_a4a.received_sync`,`…a4a…sql:201-210`)⇒ 機制與逃生口可以兼得。
--      而 harness 版**只在 CI 在場時守**;真的多列 UPDATE 會發生在 prod psql 或後續 writer,那時只有 DB 層在。
--   ⇒ 旗標 = `pcm_b2.batch_shipments`(txn-local)。合法路徑:`SET LOCAL` 之後才准多列。
--   🔴 **兩個 A4a 實測踩過的眉角照抄**(不是我自己想的):
--      · `nullif(current_setting(…, true), '')` —— txn 結束後 `current_setting` 回**空字串**不是 NULL。
--        🔴 **誠實更正(跨模型審查 F8)**:在本檔 `= '1'` 的判定式下 `nullif` **不承重**
--        (`''` 與 `'0'` 都 ≠ `'1'`,有無 nullif 逐字同行為)⇒ 它是**形狀對齊 A4a**,不是「必要」。
--        別再往下一片抄「必要」二字。
--      · `NULLIF` / `COALESCE` 是 **SQL 語法構件不是函式**,加 `pg_catalog.` 前綴會 42883(A4a 實測)。
--   🔴 **誠實邊界(W4-1 那條要分兩面看)**:W4-1 的檔頭與 harness 寫著「DB 層**沒有**執行期機制在擋批次」。
--      · **harness 面(w4a-verify)不改** —— 它前綴重放到 W4-1 為止,本片不在那一疊,那句在它的世界裡仍是真的。
--      · 🔴 **catalog 面必須改**(跨模型審查 F2):W4-1 把那句話寫進了三支 RPC 的 `COMMENT ON FUNCTION`,
--        而 catalog 註解**沒有前綴、只有尖端一份** ⇒ 本片掛上 trigger 之後它在真 DB 裡是**假的**。
--        ⇒ 本檔末尾重下那三條 COMMENT(**逐字保留原文、只換最後那個子句**;
--        W4-1 曾因為「重打整段」弄丟既有內容被打回,契約是追加不是重寫)。
--      ⇒「現在 DB 擋得住了」的證據 = 本片的 `W4B-NO-BATCH-BLOCKED` + 線級 w5 的 `LINE-NOBATCH-TRIGGER`。
--      🔴 我一度以為連 harness 面也要跨片去改(動手改了 w3c3 的同型格)——
--         **那次的紅是我連 `PREFIX_TS` 一起動了**(把本片拉進 w3c3 的前綴 ⇒ 重套 W3-3 時
--         `CREATE FUNCTION pcm_b2_shipping_human_error` 撞 42723 ⇒ 紅在 DDL-SYNTAX);
--         只改期望值字串的話只會紅在該格。**前綴重放的界線就是「當時那一疊」**,跨片去改別人的期望值是搞錯了面。
--   🔴 **仍然擋不住的**:`ALTER TABLE … DISABLE TRIGGER`、`session_replication_role='replica'`(本發已 ENABLE ALWAYS)、
--      以及 owner 直接 `DROP TRIGGER`。DB 層擋不住 owner —— 與本線一路的誠實邊界同一條。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_human_error(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_add_shipment_items(text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'W4-2 前置閘失敗 — W3-3 的轉譯層或 W3-2 的掛品項不在。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── ① body → impl(內容由程式從 W3-2 抽出,未手打)────────────
CREATE FUNCTION public.pcm_b2_add_items_impl(
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
$impl$;

COMMENT ON FUNCTION public.pcm_b2_add_items_impl(text, uuid, jsonb) IS
  'B2 掛品項的**實作本體**(W4-2 從 W3-2 的 RPC body 抽出,程式抽取非手抄)。'
  '🔴 真權威在這裡 —— `admin_add_shipment_items` 從此是薄封裝,只多一層轉譯 handler。要改邏輯改這支。'
  '🔴 零 GRANT、owner-only;由 admin_add_shipment_items(SECURITY DEFINER、以 owner 執行)呼叫。';

-- ── RPC 變薄封裝:唯一新增的是轉譯 handler ────────────────────
-- 🔴 簽章一字不動(W1 凍結;帶 DEFAULT 的參數改一個字就變 overload = a9h 事故形狀)。
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
DECLARE v_msg text; v_state text; v_con text;
BEGIN
  RETURN public.pcm_b2_add_items_impl(p_idempotency_key, p_shipment_id, p_items);
EXCEPTION
  WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
    v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
    -- 🔴 不認得就原封拋回(W3-3 立的規矩:轉譯層不得吞掉它不認識的東西)
    IF v_msg IS NULL THEN RAISE; END IF;
    RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w4b_translated';
END
$fn$;

-- ── ② 禁批次機制版 ──────────────────────────────────────────
CREATE FUNCTION public.pcm_b2_shipments_no_batch_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_n bigint;
BEGIN
  -- 🔴 旗標判定照 A4a 的字面(`…a4a…sql:201-210`):
  --    `nullif(…,'')` 必要(txn 結束後回空字串非 NULL);NULLIF/COALESCE **不可**加 pg_catalog 前綴(42883)。
  IF COALESCE(nullif(pg_catalog.current_setting('pcm_b2.batch_shipments', true), ''), '0') = '1' THEN
    RETURN NULL;   -- break-glass:旗標在,放行
  END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM changed;
  IF v_n > 1 THEN
    -- 🔴 **R3 F1**:訊息只寫「先 SET LOCAL」會害死災難日的人 —— `SET LOCAL` **在顯式交易之外是 no-op**
    --    (只發 WARNING 25P01)⇒ 互動式 psql 逐句、Supabase SQL Editor 逐句都不會生效,
    --    他照訊息做一次、又被擋一次、訊息又教他做同一件事 = 死循環。⇒ 逐字寫出 BEGIN/COMMIT。
    RAISE EXCEPTION 'B2:一句 UPDATE 不得改多列 shipments(本次 % 列)。逐列發火的取鎖順序等於該語句的列序、無排序保證 ⇒ 併發可能真死結。'
                    '要批次修資料請用 break-glass,**必須與 UPDATE 在同一個顯式交易裡**:'
                    'BEGIN; SET LOCAL pcm_b2.batch_shipments = ''1''; UPDATE …; COMMIT;'
                    '🔴 少了 BEGIN/COMMIT 的話 SET LOCAL 是 no-op(只發 WARNING)、你會再被擋一次。'
                    '修資料的 migration 檔同理要自包 BEGIN。', v_n
      USING ERRCODE = 'P2B30', CONSTRAINT = 'pcm_b2_shipments_no_batch_update';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipments_no_batch_update() IS
  'B2 禁批次守門(W4-2;Q3=A 的機制版,取代 W4-1 的 harness 版)。STATEMENT 級、用 transition table 數列數。'
  '🔴 break-glass = txn-local GUC `pcm_b2.batch_shipments = ''1''`(形狀照 A4a 的 pcm_a4a.received_sync)。'
  '🔴 **用法(R3 F1;寫在這裡是因為災難日的人會來查 catalog)**:旗標必須與 UPDATE 在**同一個顯式交易**裡 —— '
  'BEGIN; SET LOCAL pcm_b2.batch_shipments = ''1''; UPDATE …; COMMIT;。'
  '**顯式交易之外的 SET LOCAL 是 no-op、只發 WARNING**(互動式 psql 逐句、Supabase SQL Editor 逐句都中)。'
  '🔴 **哪扇門配哪把鑰匙(R3 F2;本旗標只開這一扇)**:本旗標只放行「一句改多列」這個 STATEMENT 級閘。'
  '已出貨列的 recipient 三欄與 shipped_at 另有 row 級守門(shipments_write_once / shipments_frozen_after_ship,'
  '見 s1a2 的 shipments guards),**它們沒有 GUC 鑰匙**;真要動要靠 owner 的 session_replication_role/DISABLE TRIGGER。'
  '🔴 **PostgREST 路徑下不了 SET LOCAL**(R3 F4)⇒ 未來的批次 writer(例如 HCT 一次 5 筆的批次出貨)'
  '要嘛逐列發單列 UPDATE、要嘛在 RPC 內用 set_config(''pcm_b2.batch_shipments'',''1'',true)。'
  '🔴 擋不住的:DISABLE TRIGGER / DROP TRIGGER / owner —— 與本線一路的誠實邊界同一條。';

CREATE TRIGGER shipments_no_batch_update_as
  AFTER UPDATE ON public.shipments
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_b2_shipments_no_batch_update();

-- 🔴 照 W0b F5 的實測:不 ENABLE ALWAYS 的話,`session_replication_role='replica'` 一句就全繞過。
ALTER TABLE public.shipments ENABLE ALWAYS TRIGGER shipments_no_batch_update_as;

REVOKE ALL ON FUNCTION public.pcm_b2_add_items_impl(text, uuid, jsonb)   FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipments_no_batch_update()         FROM PUBLIC, anon, authenticated, authenticator, service_role;
ALTER FUNCTION public.pcm_b2_add_items_impl(text, uuid, jsonb)   OWNER TO postgres;
ALTER FUNCTION public.pcm_b2_shipments_no_batch_update()         OWNER TO postgres;

-- ── 🔴 ②-b catalog 面的同步(跨模型審查 F2)────────────────────
-- W4-1 把「DB 層**沒有**任何執行期機制在擋批次」寫進了三支 RPC 的 COMMENT。catalog 註解**沒有前綴、只有尖端一份**
-- ⇒ 上面那發 trigger 掛上之後,那句話在真 DB 裡就是假的,而本專案把 migration/catalog 註解當契約權威。
-- 🔴 下面三條由**程式**從 `…w4a…sql` 的原文抽出、**只換最後那個子句**(W4-1 曾因為重打整段弄丟既有內容被打回;
--    契約是追加不是重寫)。原文其餘每一句逐字保留。
COMMENT ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) IS
  'B2 出貨 writer(W3-3)。前緣人話 → 單列 UPDATE shipments(觸發 S2b 重算)→ 轉譯 → 同交易回填。'
  '🔴 交棒 2 的引導訊息(先作廢 → 改到貨 → 重新出貨)由 pcm_b2_shipping_human_error 產。'
  '🔴 **Q3=A 禁批次契約(W4-1)**:本函式一次只處理一個 shipment_id,'
  '**禁止一句 UPDATE 改多列 shipments** —— 那種語句會逐列發火、跨 shipment 取鎖順序等於該 UPDATE 的列序、無排序保證。'
  '🔴 **契約只管應用路徑**(plan §1 Q3 的 F7 更正):owner / break-glass 走多列 UPDATE 仍然逐列亂序,'
  '擋它的是本契約 + scripts/w4a-verify.sh 的行為格。'
  '🔴 **W4-2 起 DB 層有執行期機制**(本句取代 W4-1 的「DB 層無執行期機制」):shipments 掛 STATEMENT 級 AFTER UPDATE '
  '= pcm_b2_shipments_no_batch_update(ENABLE ALWAYS),一句改多列即 P2B30;'
  'break-glass = txn-local GUC pcm_b2.batch_shipments = ''1''(帶旗標時仍逐列亂序 —— 那正是 Q3=A 說不管的那一面)。'
  '🔴 仍擋不住 owner 的 DISABLE TRIGGER / DROP TRIGGER。'
  '證據 = scripts/w4b-verify.sh 的 W4B-NO-BATCH-BLOCKED / W4B-BREAKGLASS + scripts/w5-line-verify.sh 的 LINE-NOBATCH-TRIGGER。';

COMMENT ON FUNCTION public.admin_void_shipment(text, uuid, text) IS
  'B2 作廢 writer(W3c-1)。前緣人話 → 單列 UPDATE(deleted_at + void_reason 同時寫)→ 轉譯 → 同交易回填。'
  '🔴 **退量不在本函式裡** —— 它由 S2b 的 shipments AFTER UPDATE OF deleted_at 重算完成'
  '(SHIPPED-TRUTH 只認 shipped_at IS NOT NULL AND deleted_at IS NULL)。本片做的是觸發它。'
  '🔴 **已出貨的箱可以作廢**:s1a2:170 逐字「撤銷出貨的唯一路徑 = 作廢」,擋掉等於砍了唯一補救路。'
  '🔴 「已作廢再作廢」刻意**不做成 no-op**:第二次帶的是另一個理由,吞掉等於丟稽核資訊。'
  '🔴 **Q3=A 禁批次契約(W4-1 追加)**:一次只處理一個 shipment_id,禁止一句 UPDATE 改多列 shipments;'
  '**契約只管應用路徑**(F7 更正),owner / break-glass 多列 UPDATE 仍逐列亂序。'
  '🔴 **W4-2 起 DB 層有執行期機制**(本句取代 W4-1 的「DB 層無執行期機制」):shipments 掛 STATEMENT 級 AFTER UPDATE '
  '= pcm_b2_shipments_no_batch_update(ENABLE ALWAYS),一句改多列即 P2B30;'
  'break-glass = txn-local GUC pcm_b2.batch_shipments = ''1''(帶旗標時仍逐列亂序 —— 那正是 Q3=A 說不管的那一面)。'
  '🔴 仍擋不住 owner 的 DISABLE TRIGGER / DROP TRIGGER。'
  '證據 = scripts/w4b-verify.sh 的 W4B-NO-BATCH-BLOCKED / W4B-BREAKGLASS + scripts/w5-line-verify.sh 的 LINE-NOBATCH-TRIGGER。';

COMMENT ON FUNCTION public.admin_unvoid_shipment(text, uuid) IS
  'B2 復原 writer(W3c-2)+ **M4 順序前緣守門**。'
  '🔴 M4:作廢退量 → 採購下修 instock → 復原回加 ⇒ shipped > instock 撞 C9。**這條不需要併發**,順序做完就到。'
  '🔴 守門只在 shipped_at IS NOT NULL 時算(草稿箱的 shipment_items 數量非零但不進 SHIPPED-TRUTH,'
  '少了這個條件會**誤擋安全的草稿復原** ⇒ 它是正確性條件、不是省算)。'
  '🔴 X8/X2 都不卡 unvoid(前者只凍收件三欄、後者只凍 shipped_at)。'
  '🔴 但**數量那一維有 C9 兜底**(繞過本函式直寫也會被擋);沒有第二道的是**訊息**與非數量原因的復原正當性。'
  '🔴 交棒 2 的引導在本方向是反過來的:箱子已作廢,改成「改回到貨數量」或「照這箱內容開新的並調整數量」。'
  '🔴 **Q3=A 禁批次契約(W4-1 追加)**:一次只處理一個 shipment_id;契約只管應用路徑。'
  '🔴 **W4-2 起 DB 層有執行期機制**(本句取代 W4-1 的「DB 層無執行期機制」):shipments 掛 STATEMENT 級 AFTER UPDATE '
  '= pcm_b2_shipments_no_batch_update(ENABLE ALWAYS),一句改多列即 P2B30;'
  'break-glass = txn-local GUC pcm_b2.batch_shipments = ''1''(帶旗標時仍逐列亂序 —— 那正是 Q3=A 說不管的那一面)。'
  '🔴 仍擋不住 owner 的 DISABLE TRIGGER / DROP TRIGGER。'
  '證據 = scripts/w4b-verify.sh 的 W4B-NO-BATCH-BLOCKED / W4B-BREAKGLASS + scripts/w5-line-verify.sh 的 LINE-NOBATCH-TRIGGER。';

-- ── ③ 檔內 fail-closed 斷言 ──────────────────────────────────
DO $$
DECLARE v_bad text := ''; v_n bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_add_shipment_items';
  IF v_n <> 1 THEN v_bad := v_bad || 'add_items signature 數 = ' || v_n || ' '; END IF;
  -- 禁批次那發必須在、且 ENABLE ALWAYS(否則 replica 模式一句就繞過)
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.shipments'::pg_catalog.regclass
     AND t.tgname = 'shipments_no_batch_update_as' AND NOT t.tgisinternal AND t.tgenabled = 'A';
  IF v_n <> 1 THEN v_bad := v_bad || '禁批次 trigger 不在或非 ALWAYS '; END IF;
  -- 兩支新 helper 零 GRANT 且 proacl 非 NULL(`aclexplode(NULL)` 回零列 ⇒ 只數 grantee 全盲)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('pcm_b2_add_items_impl','pcm_b2_shipments_no_batch_update')
                AND (p.proacl IS NULL
                     OR (SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) > 0)) THEN
    v_bad := v_bad || '新 helper 的 ACL 不對 ';
  END IF;
  -- 🔴 F2:三支 RPC 的 catalog 註解都必須已被本片更新過(W4-1 那句「DB 層無執行期機制」在本片之後是假的)
  -- 🔴 **用正向標記、不用負向字串**:三支舊尾句的字面**各不相同**
  --    (mark_shipped =「…執行期機制在擋它」/ void 與 unvoid =「…DB 層無執行期機制」)
  --    ⇒ 拿任何一個舊字面當否定式都會是 2/3 恆真;而新文字裡又逐字引用了舊句(「本句取代 W4-1 的『DB 層無執行期機制』」)
  --    ⇒ 否定式在這裡怎麼寫都不成立。正向標記三支一致、少一支就紅。
  -- 🔴 R2 nit-4:`count(*)` 會被 overload 湊到 3(同名多簽章各帶一次字串)⇒ 數**相異函式名**。
  SELECT pg_catalog.count(DISTINCT p.proname) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
     AND pg_catalog.obj_description(p.oid, 'pg_proc') LIKE '%W4-2 起 DB 層有執行期機制%';
  IF v_n <> 3 THEN v_bad := v_bad || 'catalog 註解只有 ' || v_n || '/3 支帶上 W4-2 的機制字面 '; END IF;
  -- 🔴 **實測非恆真**:把 unvoid 那條 COMMENT 從本檔刪掉後用 W4BMIG 餵給 w4b-verify
  --    ⇒ 整檔 ROLLBACK、DDL-SYNTAX 紅在「catalog 註解只有 2/3 支帶上 W4-2 的機制字面」。
  IF v_bad <> '' THEN RAISE EXCEPTION 'W4-2 斷言失敗:%', v_bad USING ERRCODE = 'P2B20'; END IF;
  RAISE NOTICE 'W4-2 斷言通過:薄封裝無 overload + 禁批次 trigger ALWAYS + 新 helper 零 GRANT';
END
$$;

COMMIT;
