-- ============================================================
-- M-4b E10 第 2 批 B2 · W3-3:`admin_mark_shipment_shipped` + **共用轉譯層**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2)§2 W3 列 / §1e Q8=A / §0.3 交棒 2・交棒 10。
-- 開工令 = 主視窗 `B-197-A` ④;轉譯範圍的三條裁定在 `B-197-A` ②。
-- 上游 = W0b/W1/W2(冪等層)+ W3-1(建箱)+ W3-2(掛品項)。
-- 驗收 harness = `scripts/w3c3-verify.sh`。
-- 🔴 開工令要我改 `w3b2-verify.sh` 的 `W3B2-M3-WINDOW-RAW` **期望值**,檢查後**沒有改、也不該改**:
--    那格走的是**繞過 RPC 的直寫**、量的是裸 DB 面,而轉譯掛在 RPC 的執行路徑上 ⇒ 那面本來就該是 raw。
--    本批只在該格加了註解說明兩面不互相冒領;RPC 路徑的轉譯由 `W3C3-TRANSLATE-C9` 驗。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` 不吃 `.sql`。證據只有 harness 實跑。
--
-- ══ 本片交付什麼 ═════════════════════════════════════════════
--   ① `admin_mark_shipment_shipped` 本體(前緣人話 → `UPDATE shipments` → 轉譯 → 回填)
--   ② **共用轉譯層** `pcm_b2_shipping_human_error(sqlstate, conname)`:把 raw SQLSTATE 轉成
--      員工看得懂、**帶下一步動作**的話。🔴 涵蓋裁定 `B-197-A` ② 的三條,
--      但**尚未接到 `admin_add_shipment_items` 的執行路徑上** —— 偏離申報見 §3。
--   ③ **交棒 2 的引導訊息**:被 C9 擋時 → 「先作廢包裹 → 改到貨 → 重新出貨」
--   ④ **交棒 10 的批次面契約**:本 RPC 一次只動一箱(見下)
--
-- ══ 🔴 轉譯範圍(三條都是主視窗 `B-197-A` ② 的裁定,不是我自己挑的)═══
--   | 情境 | 原始 | 轉成 |
--   |---|---|---|
--   | 出貨數量超過到貨數量 | `23514 oiqs_shipped_le_instock` | 人話 + **交棒 2 引導** |
--   | 取消+出貨超過訂購量 | `23514 oiqs_cancelled_shipped_le_quantity` | 人話(同族,一起收) |
--   | ~~已離開草稿態卻沒品項~~ | `P0001 shipments_items_presence` | 🔴 **不可達,已刪** —— X1 是
--     `DEFERRABLE INITIALLY DEFERRED`(`…s1b.sql:246`)⇒ 錯誤在 **COMMIT 當下**才拋、函式早已返回,
--     plpgsql 的 handler **物理上攔不到**。留著它是一條**永久死碼**(跨模型審查抓到)。
--     ⇒ 空箱那條由**前緣人話** `pcm_b2_w3c3_no_items` 負責(它在 UPDATE 之前就擋)。 |
--   | **同箱補掛**(裁定 ⑦-2) | `23505 shipment_items_shipment_order_item_unique` | 人話「這個品項已經在這箱裡了」 |
--   | **鎖逾時**(裁定 ⑦-3) | `55P03` | **通用**「系統忙碌,請稍後重試」——環境性錯誤,不逐箱解釋 |
--   🔴 **不認得的碼一律 `RAISE;` 原封拋回** —— 轉譯層**不得吞掉它不認識的東西**。
--      (若吞掉,一個新守門上線後員工會看到一句誤導的舊人話,而不是一個看得出來的錯。)
--
-- ══ 🔴 交棒 10 的批次面(`B-159-A` 裁「併進本片、不拆」)═══════
--   交棒 10 的風險是「**一句 `UPDATE shipments … WHERE <多列>`** 會逐列發火,跨 shipment 的取鎖順序
--   = 該 UPDATE 的列序、無排序保證 ⇒ 兩句併發即可能真 40P01」。
--   ⇒ **本 RPC 的契約:一次只動一箱**(`WHERE id = p_shipment_id`,單列)。
--     風險面因此**在應用路徑上被消滅**:沒有任何 writer 會發出多列的 `UPDATE shipments`。
--   🔴 **誠實邊界**:這是「應用層不製造那種語句」的契約,**不是 DB 層擋住它** ——
--      owner 直接下一句多列 UPDATE 照樣做得到。本片不假裝擋得住;
--      「禁批次」的**行為層守門**是 **W4** 的範圍(plan §2 W4 列逐字)。harness 有格把這條邊界釘成可觀察事實。
--
-- ══ 🔴 跨表反序是**固有**的(W3-2 交接 ⑦-4,本片申報)═══════════
--   掛品項路徑 = `order_items → shipments`(前緣取鎖後才碰 parent);
--   出貨路徑 = `shipments → order_items`(重算 trigger 由 shipments 觸發、helper 再鎖 order_items)。
--   ⇒ **同箱同品項的 `add × ship` 併發可達真 40P01**,而這**不是排序寫錯**,是兩條路的自然方向相反。
--   ⇒ 重試在這裡是**承重件**、不是第二道。**真併發證據是 W6 的範圍**,本片只申報並留格說明。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_add_shipment_items(text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'W3-3 前置閘失敗 — W2 冪等層或 W3-2 的掛品項不在。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── 1. 共用轉譯層 ────────────────────────────────────────────
-- 🔴 回傳 NULL = **不認得** ⇒ 呼叫端必須 `RAISE;` 原封拋回。
--    這個「不認得就說不認得」的形狀是刻意的:轉譯層若對未知碼給一句泛泛的話,
--    新守門上線那天員工會看到**誤導的舊人話**,而不是一個看得出來的錯。
CREATE FUNCTION public.pcm_b2_shipping_human_error(
  p_sqlstate text,
  p_conname  text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_sqlstate = '55P03' THEN
      '系統忙碌(有別的操作正在改同一批資料),請稍後再送一次。若持續發生請回報工程。'
    WHEN p_sqlstate = '23514' AND p_conname = 'oiqs_shipped_le_instock' THEN
      E'這箱的出貨數量超過了實際到貨的數量,無法出貨。\n'
      '接下來請照這個順序處理:①先作廢這個包裹 ②去採購頁把到貨數量改成正確的 ③再重新開一張包裹出貨。'
    WHEN p_sqlstate = '23514' AND p_conname = 'oiqs_cancelled_shipped_le_quantity' THEN
      E'這箱的「已取消 + 已出貨」數量加起來超過了客人訂購的數量,無法出貨。\n'
      '接下來請照這個順序處理:①先作廢這個包裹 ②確認這張訂單的取消紀錄 ③再重新開一張包裹出貨。'
    -- 🔴 X1(`shipments_items_presence`)**刻意不列**:它是 DEFERRABLE INITIALLY DEFERRED,
    --    錯誤在 commit 當下才拋,任何 plpgsql handler 都攔不到 ⇒ 列了也是死碼(跨模型審查 F2)。
    --    空箱由前緣的 `pcm_b2_w3c3_no_items` 擋。
    -- 🔴 F7:真併發雙擊會落在 X2 的 write-once 上(前緣讀到時 shipped_at 還是 NULL)。
    --    不轉譯的話員工會看到「write-once / 請走作廢」——那會把他導去**作廢一個剛正確出貨的箱**。
    WHEN p_sqlstate = 'P0001' AND p_conname IN ('shipments_write_once','shipments_frozen_after_ship') THEN
      '這個包裹剛剛已經被出貨了(可能是別人同時按了出貨)。不需要再出一次,也**不要**去作廢它——請重新整理畫面確認。'
    WHEN p_sqlstate = '23505' AND p_conname = 'shipment_items_shipment_order_item_unique' THEN
      '這個品項已經在這箱裡了,不能重複加。要改數量請作廢整箱重開(裝箱數量打錯的唯一補救)。'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_human_error(text, text) IS
  'B2 出貨線的**共用轉譯層**(W3-3;Q8=A + 主視窗 B-197-A ② 的三條裁定)。'
  '回 NULL = **不認得** ⇒ 呼叫端必須 RAISE; 原封拋回,**不得吞掉未知碼**:'
  '轉譯層對未知碼給泛泛的話,等於新守門上線那天員工看到誤導的舊人話而不是一個看得出來的錯。'
  '🔴 零 GRANT、owner-only。由 admin_mark_shipment_shipped 與 admin_add_shipment_items 共用。';

-- ── 2. 出貨 ──────────────────────────────────────────────────
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
  v_replay jsonb;
  v_ship   record;
  v_msg    text;
  v_state  text;
  v_con    text;
  v_n      bigint;
  v_snap   jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_shipment_shipped:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'ship', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('ship', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話 ────────────────────────────────────────────
  SELECT s.id, s.shipment_reference, s.carrier_code, s.shipped_at, s.deleted_at
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

  -- ── 出貨 + 轉譯 ─────────────────────────────────────────
  -- 🔴 **一次只動一箱**(交棒 10 的契約):`WHERE id = p_shipment_id` 是單列。
  --    這一句會觸發 S2b 的重算 trigger ⇒ C9 家族的 23514 就是在這裡冒出來的。
  BEGIN
    -- 🔴 **F6(跨模型審查):WHERE 只有 `id=` 會有作廢×出貨的 TOCTOU。**
    --    前緣讀到 `deleted_at IS NULL` 之後、這句之前,若併發的作廢先 commit:
    --    X8 不發火(改的欄不在它的凍結集)、X2 不發火(OLD.shipped_at 仍 NULL)
    --    ⇒ **已作廢的箱被標成已出貨、而且回成功信封**,按出貨的員工會把作廢箱交寄。
    --    量不會壞(S2b 的重算過濾 deleted_at),但**紀錄與實體動作對不上**。
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
  EXCEPTION
    WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
      -- 🔴 **不認得就原封拋回**,不得吞掉(見轉譯層 COMMENT)。
      IF v_msg IS NULL THEN RAISE; END IF;
      RAISE EXCEPTION '%', v_msg
        USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c3_translated';
  END;

  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('ship', p_idempotency_key, p_shipment_id, v_snap);
END
$fn$;

COMMENT ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) IS
  'B2 出貨 writer(W3-3)。前緣人話 → 單列 UPDATE shipments(觸發 S2b 重算)→ 轉譯 → 同交易回填。'
  '🔴 交棒 2 的引導訊息(先作廢 → 改到貨 → 重新出貨)由 pcm_b2_shipping_human_error 產。'
  '🔴 交棒 10:本 RPC **一次只動一箱**,多列 UPDATE 的風險面在應用路徑上被消滅;'
  '但那是**契約不是 DB 守門**(owner 直接下多列 UPDATE 照樣做得到),行為層守門在 W4。';

-- ── 3. 🔴 對裁定 `B-197-A` ②-2 的**偏離申報** ────────────────
-- 裁定要我把「同箱補掛的 `23505`」納入 W3-3 的轉譯範圍。
-- **做到的**:轉譯層(§1)已涵蓋 `23505 shipment_items_shipment_order_item_unique`,人話已寫好。
-- **沒做到的**:**沒有把它接到 `admin_add_shipment_items` 的執行路徑上** ——
--   那個 23505 是在掛品項時冒出來的,要接就得在那支的 body 外面包一層 handler,
--   而 plpgsql 沒有「呼叫原本那支」的機制 ⇒ 只能 `CREATE OR REPLACE` 並**逐字複製 W3-2 的整個 body**。
-- 🔴 **代價**:W3-2 的 body 會有兩份字面(W3-2 檔一份、本檔一份),**兩邊各自演化不會有人紅**
--    —— 那正是本線一路在殺的「枚舉寫下即過期」。我判斷這個代價高於「早一片轉譯」的收益。
-- ⇒ **本片的處置**:轉譯層先建好並涵蓋該碼;`scripts/w3c3-verify.sh` 有一格
--    (`W3C3-ADDITEMS-23505-STILL-RAW`)把「這條路今天仍是 raw」釘成**可觀察事實**,
--    接上去的那天那格會紅、逼人回來改期望值 —— 與 `W3B2-M3-WINDOW-RAW` 同一個形狀。
-- 🔴 **建議的接法**(STOP 列為決策題):W4 或 W8 動到掛品項時,把它的 body 抽成 helper、
--    由薄封裝呼叫並掛 handler。那是重構,不在本片範圍。

-- ── 4. 轉譯層 ACL:零 GRANT ──────────────────────────────────
-- 🔴 **必須排在下面那段斷言之前** —— 斷言有一道在驗 `proacl IS NULL`,
--    REVOKE 若排在斷言之後,新函式的 proacl 還是 NULL、那道會紅在自己身上。
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_human_error(text, text) FROM PUBLIC, anon, authenticated, authenticator, service_role;
ALTER FUNCTION public.pcm_b2_shipping_human_error(text, text) OWNER TO postgres;

-- ── 5. 檔內 fail-closed 斷言 ─────────────────────────────────
DO $$
DECLARE v_n bigint; v_bad text := '';
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_mark_shipment_shipped';
  IF v_n <> 1 THEN v_bad := v_bad || 'signature 數 = ' || v_n || '(期望 1)'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_mark_shipment_shipped(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_mark_shipment_shipped(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_mark_shipment_shipped(text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticator', 'public.admin_mark_shipment_shipped(text,uuid,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'ACL 漂了 ';
  END IF;
  -- 🔴 轉譯層零 GRANT(含 proacl IS NULL 那面 —— aclexplode(NULL) 回零列,只數 grantee 會恆過)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_human_error' AND p.proacl IS NULL) THEN
    v_bad := v_bad || '轉譯層 proacl 是 NULL(= 預設 EXECUTE to PUBLIC) ';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace, pg_catalog.aclexplode(p.proacl) a
       WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_human_error' AND a.grantee <> p.proowner) > 0 THEN
    v_bad := v_bad || '轉譯層被 GRANT 了 ';
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'W3-3 斷言失敗:%', v_bad USING ERRCODE = 'P2B20'; END IF;
  RAISE NOTICE 'W3-3 斷言通過:出貨單一 signature + ACL 未漂 + 轉譯層零 GRANT';
END
$$;

COMMIT;
