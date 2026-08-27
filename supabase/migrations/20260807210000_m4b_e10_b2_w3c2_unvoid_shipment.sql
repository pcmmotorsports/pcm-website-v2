-- ============================================================
-- M-4b E10 第 2 批 B2 · W3c-2:`admin_unvoid_shipment`(復原)+ **M4 順序前緣守門**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2)§2 W3c 列 / §1e **M4** / §0.3 交棒 2。
-- 開工令 = 主視窗 `B-200-A` ④。上游 = W0b/W1/W2 + W3-1/2/3 + W3c-1(作廢)。
-- 驗收 harness = `scripts/w3c2-verify.sh`;🔴 同批重釘 `scripts/w5-line-verify.sh`(尾端閘 + unvoid 端到端)。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` 不吃 `.sql`。證據只有 harness 實跑。
--
-- ══ 🔴 **M4 是什麼**(plan §1e;v2 的 W3c 只寫了併發 barrier、順序路徑一字未提)═══
--   `作廢退量` → `採購改量下修 instock` → `unvoid 回加 shipped` ⇒ **`shipped > instock` 撞 C9**。
--   🔴 **這條不需要併發** —— 三個動作按順序做完就到了。plan 逐字:「**W3c 必須有 unvoid 的前緣守門
--   + 引導訊息**,不能只靠 C9 擋(那會紅在 unvoid 這一筆、訊息不指路)」。
--
-- ══ 🔴 為什麼「復原」會讓數量回加(先講清楚,免得看不懂守門在守什麼)═══
--   SHIPPED-TRUTH(`…s2b.sql:288-293`)逐字 = `shipped_at IS NOT NULL AND deleted_at IS NULL`。
--   ⇒ **一箱只有在「已出貨且未作廢」時才算已出貨。**
--     · 已出貨 → 作廢:`deleted_at` 有值 ⇒ 不再算 ⇒ **退量**(W3c-1 的那一格量到 3 → 0)
--     · 作廢 → 復原:`deleted_at` 清掉 ⇒ **又算了** ⇒ **回加**
--   🔴 ⇒ **只有「曾經出過貨」的箱復原時才有 M4 風險**;草稿態作廢的箱復原回草稿,數量從頭到尾沒動過。
--   🔴🔴 **`shipped_at IS NOT NULL` 這個條件是<u>正確性條件</u>,不是省算**(跨模型審查 F2 打掉我原本的說法):
--      草稿箱的 `shipment_items.shipped_quantity` 在掛品項時就非零(`…s1b.sql:74`),但它**不進 SHIPPED-TRUTH**。
--      拿掉這個條件 ⇒ 守門會拿那個非零的量去比 instock ⇒
--      「草稿箱掛 2 件 → 作廢 → 到貨下修到 1 → 復原」會被**誤擋**,而那個復原完全安全(它不回加任何已出貨量)。
--      🔴 我原本寫「它省的是無謂計算不是正確性」,**是我從一個沒有判別力的突變 fixture(instock 5 ≥ qty 2)
--         讀出了錯的結論** —— 觀察值沒變不等於那個條件沒作用。harness 的突變 fixture 已改成 instock < qty。
--
-- ══ 🔴 前緣守門怎麼算(這一段是本片的核心)═══════════════════
--   對這箱的每個品項:`目前已出貨(不含本箱,因為本箱還在作廢中) + 本箱要回加的量 ≤ 到貨量`
--   · 「目前已出貨」= 摘要的 `shipped_quantity`(它現在**不含本箱** —— 本箱 `deleted_at` 有值)
--   · 「本箱要回加的量」= `shipment_items.shipped_quantity`
--   · 「到貨量」= 摘要的 `instock_quantity`
--   🔴 **`LEFT JOIN` + `COALESCE`**:摘要是**惰性建列**(`…s2b.sql:484` 逐字「無列 = 四個 0,
--      讀取端必須 LEFT JOIN + COALESCE」)—— W3-2 就是在這裡被打過一次(R1-F1),本片照抄那個修法。
--
-- ══ 🔴 引導訊息(交棒 2)在本片是**反過來的** ═══════════════════
--   交棒 2 的原句是「被 C9 擋時 → 先作廢包裹 → 改到貨 → 重新出貨」。
--   但在 unvoid 這條路上,**箱子已經是作廢狀態了** ⇒ 叫人「先作廢」是廢話。
--   ⇒ 本片的引導改成對稱的那一半:**把到貨數量改回來,或改用「照這箱內容開一張新的」**。
--      🔴 出路②要補半句「**並調整數量**」(跨模型審查 F8):同內容的新箱在到貨未改回前照樣出不了貨,
--         它成立靠的是「新草稿箱的數量可以改」。
--      (後者是 Sean 2026-08-05 Q-a=C 拍板要在出貨畫面提供的按鈕,`…s1a2.sql:136` 逐字。)
--   🔴 **這是對交棒 2 字面的偏離**:同一個引導在 void 方向與 unvoid 方向的內容不一樣。
--      理由:字面照抄會產生一句對員工沒有意義的話。STOP 申報。
--
-- ══ 🔴 X8 / X2 都**不卡** unvoid(我親驗,不是引用審查者)═══════
--   · X8 `shipments_frozen_after_ship`(`…s1a2.sql:130-133`)只比
--     `recipient_snapshot` / `carrier_code` / `carrier_note` 三欄 ⇒ **不含 `deleted_at`/`void_reason`**。
--   · X2 `shipments_write_once`(`…s1a2.sql:177`)只比 `shipped_at` ⇒ unvoid 不動它。
--   ⇒ 復原**清空 `deleted_at` + `void_reason`** 這件事本身,DB 層沒有東西擋。
--   🔴🔴 **但「沒有第二道」這句我原本寫太強了**(跨模型審查 F1;我自己的 harness 就打臉它):
--      **數量那一維有第二道** —— 繞過本片直寫清 `deleted_at`,重算照樣把 shipped 推上去、**C9 會擋**
--      (`scripts/w3c2-verify.sh` 的 `W3C2-C9-BACKSTOP` 實測)。母 plan `:698`(C4)也逐字寫著
--      「前緣守門 = **為訊息、非為正確性**」。
--   ⇒ 精確的說法是:**數量正確性有 C9 兜底;沒有第二道的是「訊息」與「非數量原因的復原正當性」。**
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_human_error(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_payload_hash(text,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'W3c-2 前置閘失敗 — W2 冪等層或 W3-3 轉譯層有缺。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

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
  v_replay jsonb;
  v_ship   record;
  v_bad    text;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
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

  -- ── 前緣人話 ────────────────────────────────────────────
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

  -- ── 🔴 **M4 順序前緣守門**(本片的核心)────────────────────
  --    🔴 `shipped_at IS NOT NULL` 是**正確性條件**(檔頭有詳述):草稿箱的 shipment_items 數量非零
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
      -- 🔴 **交棒 2 的引導在這條路上是反過來的**(檔頭已申報):箱子已經是作廢狀態,
      --    叫人「先作廢」是廢話 ⇒ 改成對稱的那一半。
      RAISE EXCEPTION E'復原包裹:這箱復原之後,出貨數量會超過現在的到貨數量,所以不能復原。\n%\n'
                      '接下來可以這樣處理:①去採購頁把到貨數量改回正確的,再回來復原;'
                      '或 ②不要復原,改用「照這箱內容開一張新的包裹」**並把數量調整成放得下的**。', v_bad
        USING ERRCODE = 'P2B27', CONSTRAINT = 'pcm_b2_w3c2_unvoid_exceeds_instock';
    END IF;
  END IF;

  -- ── 復原(清空 deleted_at + void_reason;X7 是雙向配對,兩欄一起清)────
  -- 🔴 WHERE 帶上 `deleted_at IS NOT NULL`(W3-3 F6 的 TOCTOU 教訓,本線第三次用)。
  BEGIN
    UPDATE public.shipments
       SET deleted_at = NULL, void_reason = NULL
     WHERE id = p_shipment_id
       AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '復原包裹:這個包裹的狀態剛剛被別人改過,這次沒有復原成功。請重新整理畫面確認。(改到 % 列)', v_n
        USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c2_rowcount';
    END IF;
  EXCEPTION
    WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
      IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c2_translated';
  END;

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

COMMENT ON FUNCTION public.admin_unvoid_shipment(text, uuid) IS
  'B2 復原 writer(W3c-2)+ **M4 順序前緣守門**。'
  '🔴 M4:作廢退量 → 採購下修 instock → 復原回加 ⇒ shipped > instock 撞 C9。**這條不需要併發**,順序做完就到。'
  '🔴 守門只在 shipped_at IS NOT NULL 時算(草稿箱復原回草稿、數量沒動過)。'
  '🔴 X8/X2 都不卡 unvoid(前者只凍收件三欄、後者只凍 shipped_at)。'
  '🔴 但**數量那一維有 C9 兜底**(繞過本函式直寫也會被擋);沒有第二道的是**訊息**與非數量原因的復原正當性。'
  '🔴 交棒 2 的引導在本方向是反過來的:箱子已作廢,改成「改回到貨數量」或「照這箱內容開新的」。';

-- ── 檔內 fail-closed 斷言 ────────────────────────────────────
DO $$
DECLARE v_n bigint; v_bad text := '';
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_unvoid_shipment';
  IF v_n <> 1 THEN v_bad := v_bad || 'signature 數 = ' || v_n || '(期望 1)'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_unvoid_shipment(text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_unvoid_shipment(text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_unvoid_shipment(text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticator', 'public.admin_unvoid_shipment(text,uuid)', 'EXECUTE') THEN
    v_bad := v_bad || 'ACL 漂了 ';
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'W3c-2 斷言失敗:%', v_bad USING ERRCODE = 'P2B20'; END IF;
  RAISE NOTICE 'W3c-2 斷言通過:復原單一 signature + ACL 未漂';
END
$$;

COMMIT;
