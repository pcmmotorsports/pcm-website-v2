-- ============================================================
-- M-4b E10 B2 · W7d-1:出貨側三支 writer 補 40P01 有界重試
--                  + 共用轉譯層補登三條 + unvoid 的 C9 方向覆寫
--
-- plan = docs/specs/2026-08-08-e10-b2-w7d1-ship-deadlock-and-translator-direction-plan.md(v3)
-- 派令 = B-215-A ②-① / B-219-A ② 佇列 2 / B-220-A MF-1 / B-223-A(findings #3)/ B-224-A MF-6
-- 審查 = R1 codex gpt-5.6-sol xhigh(FAIL 15 must-fix)+ R2 Fable 框架角度(FAIL 1 must-fix + 3 consider + 2 nit)
--
-- ══ 🔴 為什麼要有這個重試:跨表反序是**固有**的 ═══════════════
--   環有四段(全部親讀,不是推論):
--     ① add 鎖 order_items       …w4b….sql:173-176   ORDER BY oi.id FOR NO KEY UPDATE
--     ② add INSERT shipment_items → BEFORE trigger 鎖 shipments
--                                  …s1b_shipment_items.sql:156-160  FOR NO KEY UPDATE
--     ③ ship/void/unvoid UPDATE shipments(該列列鎖)
--     ④ → AFTER trigger 對箱內每個品項呼重算 helper 鎖 order_items
--                                  …s2b….sql:335-344 + helper :198
--                                  trigger 定義 …s2b….sql:436 = AFTER UPDATE OF shipped_at, deleted_at
--   ①→② 與 ③→④ **方向相反、共用同一組資源** = 真死結環。
--
--   逐一排除過的候選緩解(別再重問):
--     · `lock_timeout = '5s'` **擋不到** —— deadlock_timeout 預設約 1s **先**發火
--       ⇒ 出的是 40P01 不是 55P03。(全 repo 只有 scripts/a8c1-verify.sh:697,709 動過該參數,測試內。)
--     · 「一次一箱」單列 UPDATE 契約無關 —— 環只需要一列。
--     · 前緣守門有 TOCTOU 窗。
--
-- ══ 🔴🔴 誠實邊界(不得讀成更強)═══════════════════════════════
--   本檔的重試**沒有被真併發演示過**。既有五支併發 harness
--   (w6a / w6b1 / w6b2 / w6b3 / w7b)**沒有任何一支測 `add × ship` 這一對**(親查)。
--   ⇒ 這個環在本 repo 內只被**論證**過、從未被**演示**過。
--     scripts/w7d1-verify.sh 用「恆拋 40P01 的注入樁」證的是**重試邏輯本身會迴圈**,
--     **不是**「真死結會被吸收」。真併發演示 = W6 形狀(…w3c3….sql:48 逐字),**目前無人認領**,已立欠款。
--
-- ══ 🔴 零退避是刻意的 —— 不要好心補 sleep(R2-nit1)═══════════
--   40P01 受害者的 subtransaction 回滾會釋放它在迴圈內取的**全部**鎖;
--   重試那句 UPDATE 會**天然阻塞**在倖存者仍持有的鎖上,直到對方 commit —— **阻塞本身就是退避**。
--   前提(親驗):三支在迴圈**外**不持任何環上的鎖 —— 前緣全是裸 SELECT、
--   idem 鍵表不在環上 ⇒ 無 livelock。
--   🔴 反過來,加 `pg_sleep` 退避是**有害**的:受害者的**外層**交易還活著、還持有迴圈外取得的資源
--      (冪等鍵那一列的列鎖、以及整個交易的快照),睡越久就佔越久,而倖存者的處境並不會因此變好。
--      🔴 **不要寫成「sleep 會吃掉 lock_timeout 預算」**(關卡2 nit 更正):`lock_timeout` 是
--      **每次開始等鎖時才起算**的,sleep 不會預先扣掉那 5 秒 —— 理由是佔用時間,不是逾時預算。
--
-- ══ 🔴 根治法(讓 add 先預鎖 parent)本片不採,理由寫在這裡 ═══
--   根治 = 讓 add 在鎖 order_items **之前**先 `FOR NO KEY UPDATE` 預鎖 parent shipment
--   ⇒ 全線 shipments→order_items 同序、環**類**根除,重試降回真第二道。
--   **不採的理由**:①要重貼**已 apply** 的 pcm_b2_add_items_impl(forward-only 的成本)
--   ②同序法只擋得住**已知**的環,對未來新增路徑沒有韌性;重試對未知的環仍然有效。
--   ⇒ 後人不要照抄檔頭那兩個字「固有」就不再質疑 —— 它是**現行取鎖序下**的固有,不是宇宙真理。
--
-- ══ 🔴 idem_claim 留在迴圈外 = 合約,不是偏好 ═════════════════
--   …w2….sql:343 COMMENT 逐字:「必須在**任何業務寫入之前**呼叫,
--   且**絕不得被搬進 W3 的產號重試迴圈裡**」。本檔遵守;harness 有結構錨釘住。
--
-- ══ 🔴 迭代次數的觀察點 = RAISE NOTICE,不是表計數 ════════════
--   子交易回滾會吃掉迴圈內**任何**寫入(GUC 賦值、temp table 皆然)⇒ 表計數物理上量不到。
--   NOTICE 送出即不可撤回 ⇒ harness 數 'W7D1-RETRY|' 出現次數 = 真實迭代數。
--   環境風險方向安全:client_min_messages 被調高只會讓格子**誤紅**,不會假綠。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- 🔴 本檔**寫檔不 apply**,進下一個 apply 批(B-219-A ③)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘 ────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_human_error(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_mark_shipment_shipped(text,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_void_shipment(text,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_unvoid_shipment(text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'W7d-1 前置閘失敗 — W3c-1/W3c-2/W3-3 的 writer 或 W2 冪等層不在。'
      USING ERRCODE = 'P2B20';
  END IF;
  -- 🔴 重算 trigger 必須在**且真的啟用**:本檔的整個死結論證建立在它身上。
  -- 🔴 只比 `tgname` 不夠(關卡2 must-fix):同名 trigger 可以掛在別張表上、也可以是 disabled(`tgenabled='D'`)
  --    ⇒ 三件一起綁:**綁到 public.shipments 這張表** + **非 internal** + **tgenabled IN ('O','A')**。
  --    (`'D'` = disabled、`'R'` = replica-only 正常寫入不觸發 —— 兩者都等於論證前提不成立。)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgname = 'shipments_summary_recompute_ac'
                    AND t.tgrelid = 'public.shipments'::regclass
                    AND NOT t.tgisinternal
                    AND t.tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'W7d-1 前置閘失敗 — public.shipments 上的 shipments_summary_recompute_ac 不在或未啟用(本檔的死結面論證依賴它)。'
      USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── 1. 共用轉譯層:同簽章 CREATE OR REPLACE、純加法 ──────────
-- 🔴 **簽章刻意不動**(R2 must-fix-1):v2 曾打算改成三參 (p_op, p_sqlstate, p_conname),已撤回。
--    撤回理由 = 需要方向感知的只有 **unvoid 一個呼叫端、兩個 conname、且只在 TOCTOU 窗內**:
--      · add_items **打不到 C9** —— 重算 trigger 只掛 shipments;…s2b….sql:314-315 逐字
--        「**只有這一支**(Sean 08-05 Q1=A)。**shipment_items 上刻意不掛**」。
--      · void 方向的 C9 不可達(作廢只讓 shipped 變少)。
--      · unvoid 的前緣 …w3c2….sql:139-146 已經有方向正確的 P2B27 訊息。
--    而改簽章要付:DROP+CREATE、REVOKE/OWNER/COMMENT 三件套重做、w6b1:277 與 w6b2:120,332,410,454
--    的字面連動、薄 wrapper 重貼、rollback 的 catalog 手術、**op 值域的第四份枚舉抄本**。不成比例。
-- 🔴 `CREATE OR REPLACE` **保留既有 ACL 與 owner**(不像 DROP+CREATE 會退回 PUBLIC 預設)
--    ⇒ 不需要也**不得**在這裡重做 REVOKE。
-- 🔴🔴 **極性**(關卡2 must-fix,本檔初版這段寫反過):W3-3 當初下過 REVOKE ⇒ 正確狀態是
--    **`proacl` 非 NULL**(裡面只剩 owner 一筆)。`proacl IS NULL` 代表的是
--    **PostgreSQL 的預設 = PUBLIC 有 EXECUTE**,那是壞掉、不是好的。
--    harness 有一格**實測**複驗「非 NULL + 零非 owner grantee + owner 仍是 postgres」三件,不靠推論。
-- 🔴 回傳 NULL = **不認得** ⇒ 呼叫端必須 `RAISE;` 原封拋回。這個形狀是刻意的(W3-3 立)。
-- 🔴 **本層說「哪裡壞了」;「接下來怎麼辦」屬於呼叫端** —— 補救動作依操作而異,
--    unvoid 的補救與預設相反,由它自己在 handler 內覆寫(見 §3)。新增呼叫端請照這個分工。
CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(
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
    -- 🔴 W7d-1 補登(findings #3 MF-3):carrier_code 在前緣讀取之後被改動的 TOCTOU
    --    ⇒ 撞 s1a1:161 的 CHECK。原本表內沒有這條 ⇒ 裸噴 23514 給員工。
    --    人話只給下一步、不編造原因(我們並不知道是誰改的)。
    WHEN p_sqlstate = '23514' AND p_conname = 'shipments_shipped_needs_tracking' THEN
      '這箱的快遞商需要貨運單號才能出貨(剛剛快遞商可能被別人改過)。請填上貨運單號後再送一次。'
    -- 🔴 W7d-1 補登(findings #3 MF-5 / B-224-A MF-6):…s1b….sql:169 的 parent guard。
    --    併發作廢先提交 ⇒ 掛品項時撞它 ⇒ 原本裸噴 P0001。
    WHEN p_sqlstate = 'P0001' AND p_conname = 'shipment_items_parent_open' THEN
      '這個包裹剛剛被作廢了(可能是別人同時按了作廢),不能再加品項。要出這批貨請開一張新的包裹。'
    -- 🔴 X1(`shipments_items_presence`)**刻意不列**:它是 DEFERRABLE INITIALLY DEFERRED,
    --    錯誤在 commit 當下才拋,任何 plpgsql handler 都攔不到 ⇒ 列了也是死碼(跨模型審查 F2)。
    --    空箱由前緣的 `pcm_b2_w3c3_no_items` 擋。
    -- 🔴 F7:真併發雙擊會落在 X2 的 write-once 上(前緣讀到時 shipped_at 還是 NULL)。
    --    不轉譯的話員工會看到「write-once / 請走作廢」——那會把他導去**作廢一個剛正確出貨的箱**。
    WHEN p_sqlstate = 'P0001' AND p_conname = 'shipments_write_once' THEN
      '這個包裹剛剛已經被出貨了(可能是別人同時按了出貨)。不需要再出一次,也**不要**去作廢它——請重新整理畫面確認。'
    -- 🔴 W7d-1 拆分(findings #3 MF-4):原本 write_once 與 frozen_after_ship **共用上面那一句**,
    --    但 …s1a2_shipments_guards.sql:135-136 那道守門**自己的訊息**逐字寫著
    --    「選錯快遞商的補救 = **作廢重開新包裹**」⇒ 兩份字面直接矛盾,教錯動作家族第三例。
    -- 🔴 **失效條件(不可達 ≠ 恆真,依 memory feedback_withdrawal-reason-needs-expiry-condition)**:
    --    今天本線四個呼叫端**都打不到**這個 conname —— mark_shipped 的 UPDATE 只動
    --    shipped_at / tracking_number,不動 recipient_snapshot / carrier_code / carrier_note。
    --    ⇒ 拆分是為了消除互相矛盾的字面,**不是**宣稱這條路可達;
    --      harness **刻意不對它下可達性斷言**(對不可達路徑斷言 = 恆真格)。
    --    ⇒ **哪天有 writer 改得到那三欄,這一句就要重新檢查**,而且那時它會第一次真的被員工看到。
    WHEN p_sqlstate = 'P0001' AND p_conname = 'shipments_frozen_after_ship' THEN
      E'這個包裹已經寄出或已作廢,收件資料與快遞商不能再改。\n'
      '要換快遞商或改收件資料,請作廢這個包裹、再照這箱內容開一張新的。'
    WHEN p_sqlstate = '23505' AND p_conname = 'shipment_items_shipment_order_item_unique' THEN
      '這個品項已經在這箱裡了,不能重複加。要改數量請作廢整箱重開(裝箱數量打錯的唯一補救)。'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_human_error(text, text) IS
  'B2 出貨線的**共用轉譯層**(W3-3 立;W7d-1 補登三條)。回 NULL = **不認得** ⇒ 呼叫端必須 RAISE; 原封拋回,'
  '**不得吞掉未知碼**:轉譯層對未知碼給泛泛的話,等於新守門上線那天員工看到誤導的舊人話而不是一個看得出來的錯。'
  '🔴 **分工**:本層說「哪裡壞了」;「接下來怎麼辦」屬於**呼叫端** —— 補救動作依操作而異。'
  'admin_unvoid_shipment 撞 C9 時的補救與預設**相反**,由它在自己的 handler 內覆寫(W7d-1)。'
  '🔴 W7d-1 新增:23514 shipments_shipped_needs_tracking / P0001 shipment_items_parent_open;'
  'P0001 shipments_frozen_after_ship 從 write_once 那句**拆出來**(該守門自己的訊息說補救就是作廢重開,原本相反)。'
  '🔴 frozen_after_ship 今天四個呼叫端都打不到(失效條件寫在函式體註解裡)。'
  '🔴 零 GRANT、owner-only;本次用 CREATE OR REPLACE ⇒ ACL 與 owner 沿用,未重做 REVOKE。'
  '由 admin_mark_shipment_shipped / admin_void_shipment / admin_unvoid_shipment / admin_add_shipment_items 共用。';

-- ── 2. 出貨 writer:補 40P01 有界重試 ────────────────────────
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

  -- ── 出貨 + 轉譯(🔴 W7d-1:包在 40P01 有界重試裡)────────────
  LOOP
    v_try := v_try + 1;
    BEGIN
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

COMMENT ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) IS
  'B2 出貨 writer(W3-3;W7d-1 補 40P01 有界重試)。前緣人話 → 單列 UPDATE shipments(觸發 S2b 重算)→ 轉譯 → 同交易回填。'
  '🔴 W7d-1:UPDATE 包在 deadlock_detected 有界重試裡(上限 3、耗盡碼 P2B28 pcm_b2_w3c3_deadlock_exhausted)。'
  '重試**只包寫入不包前緣讀取**(不重讀 ⇒ 孤兒列不影響重試,B-295-STOP ⑦);'
  '**零退避是刻意的**(受害者回滾後重試會天然阻塞在倖存者鎖上 = 阻塞本身就是退避;加 sleep 只是讓外層交易多佔資源,對倖存者毫無幫助)。'
  '迭代數的觀察點 = RAISE NOTICE 的 W7D1-RETRY 行(子交易回滾吃不掉 NOTICE)。'
  '🔴 交棒 2 的引導訊息由 pcm_b2_shipping_human_error 產。'
  '🔴 交棒 10:本 RPC **一次只動一箱**,多列 UPDATE 的風險面在應用路徑上被消滅;'
  '但那是**契約不是 DB 守門**(owner 直接下多列 UPDATE 照樣做得到),行為層守門在 W4。';

-- ── 3. 作廢 writer:補 40P01 有界重試 ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_void_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_void_reason     text
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
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  v_replay := public.pcm_b2_shipping_idem_claim(
    'void', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('void', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'void_reason', p_void_reason)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話(迴圈外、只跑一次;理由同 W3-3)──────────────
  -- 🔴 理由非空白是 `shipments_void_pair` 的一半(`…s1a1.sql:149-151`);這裡是訊息層。
  IF public.pcm_b2_is_blank(p_void_reason) THEN
    RAISE EXCEPTION '作廢包裹:一定要填作廢原因(這是要留給日後查帳看的)。'
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_reason_required';
  END IF;
  SELECT s.id, s.shipment_reference, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '作廢包裹:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_shipment_missing';
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    -- 🔴 **刻意不做成 no-op**(理由見 W3c-1 檔頭):第二次帶的是另一個理由,吞掉等於丟稽核資訊。
    RAISE EXCEPTION '作廢包裹:包裹 % 已經作廢過了(可能是別人剛作廢的)。不需要再作廢一次。', v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_already_voided';
  END IF;

  -- ── 作廢(這一句同時觸發 S2b 的退量重算)────────────────
  -- 🔴 `deleted_at` 與 `void_reason` **必須同時寫**(X7 是雙向配對)。
  -- 🔴 WHERE 帶上 `deleted_at IS NULL`(W3-3 的 F6 教訓:只有 `id=` 會有 TOCTOU)。
  LOOP
    v_try := v_try + 1;
    BEGIN
      UPDATE public.shipments
         SET deleted_at = now(), void_reason = p_void_reason
       WHERE id = p_shipment_id
         AND deleted_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '作廢包裹:這個包裹的狀態剛剛被別人改過(可能已經被作廢了),這次沒有作廢成功。請重新整理畫面確認。(改到 % 列)', v_n
          USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3c1_rowcount';
      END IF;
      EXIT;
    EXCEPTION
      WHEN deadlock_detected THEN
        RAISE NOTICE 'W7D1-RETRY|%|%', 'void', v_try;
        IF v_try >= c_max_deadlock_tries THEN
          RAISE EXCEPTION '作廢包裹:連續 % 次都遇到資料庫死結,已放棄。請稍後再試一次;若持續發生請回報工程。', c_max_deadlock_tries
            USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_w3c1_deadlock_exhausted';
        END IF;
      WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
        v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
        IF v_msg IS NULL THEN RAISE; END IF;   -- 🔴 不認得就原封拋回(W3-3 立的規矩)
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c1_translated';
    END;
  END LOOP;

  -- 🔴 `to_jsonb` 同源(W3-1 立的構造性形狀,W3-2/W3-3 照抄,本片續抄)
  SELECT pg_catalog.jsonb_build_object(
           'id',                 j -> 'id',
           'shipment_reference', j -> 'shipment_reference',
           'customer_user_id',   j -> 'customer_user_id')
    INTO v_snap
    FROM (SELECT pg_catalog.to_jsonb(s.*) AS j FROM public.shipments s WHERE s.id = p_shipment_id) t;

  RETURN public.pcm_b2_shipping_idem_record('void', p_idempotency_key, p_shipment_id, v_snap);
END
$fn$;

COMMENT ON FUNCTION public.admin_void_shipment(text, uuid, text) IS
  'B2 作廢 writer(W3c-1;W7d-1 補 40P01 有界重試)。前緣人話 → 單列 UPDATE(deleted_at + void_reason 同時寫)→ 轉譯 → 同交易回填。'
  '🔴 W7d-1:UPDATE 包在 deadlock_detected 有界重試裡(上限 3、耗盡碼 P2B28 pcm_b2_w3c1_deadlock_exhausted);'
  '零退避與只包寫入的理由見 migration 檔頭。'
  '🔴 **退量不在本函式裡** —— 它由 S2b 的 shipments AFTER UPDATE OF deleted_at 重算完成'
  '(SHIPPED-TRUTH 只認 shipped_at IS NOT NULL AND deleted_at IS NULL)。本片做的是觸發它。'
  '🔴 **已出貨的箱可以作廢**:s1a2:170 逐字「撤銷出貨的唯一路徑 = 作廢」,擋掉等於砍了唯一補救路。'
  '🔴 「已作廢再作廢」刻意**不做成 no-op**:第二次帶的是另一個理由,吞掉等於丟稽核資訊。';

-- ── 4. 復原 writer:補 40P01 有界重試 + C9 方向覆寫 ──────────
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

COMMENT ON FUNCTION public.admin_unvoid_shipment(text, uuid) IS
  'B2 復原 writer(W3c-2)+ **M4 順序前緣守門**;W7d-1 補 40P01 有界重試 + C9 方向覆寫。'
  '🔴 M4:作廢退量 → 採購下修 instock → 復原回加 ⇒ shipped > instock 撞 C9。**這條不需要併發**,順序做完就到。'
  '🔴 守門只在 shipped_at IS NOT NULL 時算(草稿箱復原回草稿、數量沒動過)。'
  '🔴 X8/X2 都不卡 unvoid(前者只凍收件三欄、後者只凍 shipped_at)。'
  '🔴 但**數量那一維有 C9 兜底**(繞過本函式直寫也會被擋);沒有第二道的是**訊息**與非數量原因的復原正當性。'
  '🔴 交棒 2 的引導在本方向是反過來的:箱子已作廢,改成「改回到貨數量」或「照這箱內容開新的」。'
  '🔴 W7d-1(B-220-A MF-1):共用轉譯層對 C9 給的是出貨方向的話,本函式在 handler 內**覆寫**成復原方向;'
  '該路徑**只在 TOCTOU 窗內可達**(前緣 P2B27 會先擋)。覆寫字面與前緣那句同族但不逐字相同,改一處要想到另一處。'
  '🔴 W7d-1:UPDATE 包在 deadlock_detected 有界重試裡(上限 3、耗盡碼 P2B28 pcm_b2_w3c2_deadlock_exhausted)。';

-- ── 5. 檔內 fail-closed 斷言 ─────────────────────────────────
DO $$
DECLARE v_bad text := ''; v_def text;
BEGIN
  -- ① 三支 writer 都真的有 deadlock handler 與有界重試
  FOR v_def IN
    SELECT pg_catalog.pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
  LOOP
    IF pg_catalog.strpos(v_def, 'WHEN deadlock_detected THEN') = 0 THEN
      v_bad := v_bad || ' 缺 deadlock handler;';
    END IF;
    IF pg_catalog.strpos(v_def, 'c_max_deadlock_tries constant int := 3;') = 0 THEN
      v_bad := v_bad || ' 缺重試上限常數;';
    END IF;
    IF pg_catalog.strpos(v_def, 'P2B28') = 0 THEN
      v_bad := v_bad || ' 缺耗盡碼 P2B28;';
    END IF;
    IF pg_catalog.strpos(v_def, 'W7D1-RETRY') = 0 THEN
      v_bad := v_bad || ' 缺 NOTICE 觀察點;';
    END IF;
    -- 🔴 零退避結構錨:任何 sleep 都只是讓外層交易多佔資源(理由見檔頭「零退避是刻意的」那段;
    --    🔴 **不是**「吃掉 lock_timeout 預算」—— 那個說法已在檔頭被更正,不要再寫回來)。
    -- 🔴 比對 `pg_sleep(` **含左括號**:比 `pg_sleep` 三個字會被**函式體內的註解**命中
    --    (本檔的註解就寫著「不要加 pg_sleep」)⇒ 初版真的誤紅了。
    --    這與 w-line 矩陣文件記過的「有人寫個 TODO 註解就誤紅」是同一個形狀。
    IF pg_catalog.strpos(v_def, 'pg_sleep(') <> 0 THEN
      v_bad := v_bad || ' 出現 pg_sleep( 呼叫(零退避契約破);';
    END IF;
  END LOOP;

  -- ② 🔴 idem_claim 必須排在 LOOP **之前**(…w2….sql:343 合約)
  FOR v_def IN
    SELECT pg_catalog.pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
  LOOP
    -- 🔴 兩個位置都必須 > 0 才比得下去:任一為 0 時 `<` 會給出**看起來合理但無意義**的答案
    --    (position 查無回 0 ⇒ 0 < n 恆真 ⇒ 斷言恆綠)。這是本線 psql 家族同源的「比錯東西」。
    IF pg_catalog.strpos(v_def, 'pcm_b2_shipping_idem_claim') = 0
       OR pg_catalog.strpos(v_def, 'LOOP') = 0
       OR pg_catalog.strpos(v_def, 'pcm_b2_shipping_idem_claim')
          >= pg_catalog.strpos(v_def, 'LOOP') THEN
      v_bad := v_bad || ' idem_claim 不在 LOOP 之前(或其一查無);';
    END IF;
  END LOOP;

  -- ③ 轉譯層:CREATE OR REPLACE 之後 ACL 與 owner 必須沿用(零 GRANT、owner-only)
  -- 🔴🔴 **極性別寫反**:`proacl IS NULL` = **預設 EXECUTE to PUBLIC** = 壞掉,**不是**好的。
  --    w3c3:252-256 逐字立過這條。本檔初版把它寫成「IS NOT NULL 就報錯」,
  --    那會讓這道守門在函式**對 PUBLIC 全開時恰好變綠** —— 被自己的 fail-closed 斷言當場抓到。
  -- 🔴 **兩道都要**:`aclexplode(NULL)` 回零列 ⇒ 只數 grantee 那道在 proacl IS NULL 時**恆過**
  --    (w3c3:252 逐字警告過同一件事)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pcm_b2_shipping_human_error'
                AND p.proacl IS NULL) THEN
    v_bad := v_bad || ' 轉譯層 proacl 是 NULL(= 預設 EXECUTE to PUBLIC,CREATE OR REPLACE 沒保住 REVOKE);';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace, pg_catalog.aclexplode(p.proacl) a
       WHERE n.nspname = 'public' AND p.proname = 'pcm_b2_shipping_human_error'
         AND a.grantee <> p.proowner) > 0 THEN
    v_bad := v_bad || ' 轉譯層被 GRANT 了;';
  END IF;

  -- ④ 轉譯層:三條補登/拆分確實在
  v_def := pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_human_error(text,text)'::regprocedure);
  IF pg_catalog.strpos(v_def, 'shipments_shipped_needs_tracking') = 0 THEN
    v_bad := v_bad || ' 轉譯表缺 shipped_needs_tracking;';
  END IF;
  IF pg_catalog.strpos(v_def, 'shipment_items_parent_open') = 0 THEN
    v_bad := v_bad || ' 轉譯表缺 parent_open;';
  END IF;
  -- 🔴 MF-4:兩碼必須各自成句 —— 舊版是 `IN ('shipments_write_once','shipments_frozen_after_ship')`
  IF pg_catalog.strpos(pg_catalog.replace(v_def, ' ', ''),
                       '''shipments_write_once'',''shipments_frozen_after_ship''') <> 0 THEN
    v_bad := v_bad || ' write_once 與 frozen_after_ship 仍共用同一分支;';
  END IF;

  -- ⑤ unvoid 的 C9 覆寫在,且 **ship / void 兩支沒有**(防止誤套到共用路徑)
  -- 🔴 本檔一律用 `pg_catalog.strpos(string, substring)`,**不用** `position(sub IN str)`:
  --    ① `position(... IN ...)` 是文法糖,**不能加 schema 限定**(`pg_catalog.position(x IN y)` 是語法錯誤,
  --       本檔初版真的踩到);② 不加限定就依賴 search_path;③ `strpos` 的參數順序寫死在名字裡,
  --       而 `position` 的兩參函式版 `position(string, substring)` 與 IN 形式**順序相反** —— 寫錯會靜默恆 0。
  v_def := pg_catalog.pg_get_functiondef('public.admin_unvoid_shipment(text,uuid)'::regprocedure);
  IF pg_catalog.strpos(v_def, 'oiqs_cancelled_shipped_le_quantity') = 0
     OR pg_catalog.strpos(v_def, '它現在就是作廢狀態') = 0 THEN
    v_bad := v_bad || ' unvoid 缺 C9 方向覆寫;';
  END IF;
  v_def := pg_catalog.pg_get_functiondef('public.admin_mark_shipment_shipped(text,uuid,text)'::regprocedure);
  IF pg_catalog.strpos(v_def, '它現在就是作廢狀態') <> 0 THEN
    v_bad := v_bad || ' ship 也被套上 C9 覆寫(共用路徑被誤改);';
  END IF;
  v_def := pg_catalog.pg_get_functiondef('public.admin_void_shipment(text,uuid,text)'::regprocedure);
  IF pg_catalog.strpos(v_def, '它現在就是作廢狀態') <> 0 THEN
    v_bad := v_bad || ' void 也被套上 C9 覆寫(共用路徑被誤改);';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'W7d-1 斷言失敗:%', v_bad USING ERRCODE = 'P2B20';
  END IF;
END
$$;

COMMIT;
