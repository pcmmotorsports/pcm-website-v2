-- ============================================================
-- M-4b E10 · #352-a2:到貨登錄的兩支 writer RPC(登錄 / 刪除)
-- ============================================================
-- 規格:docs/specs/2026-08-10-352-receipt-recording-plan-v3.md(v3.3)§3
-- 前置:#352-a1(`20260810230000`)—— 溢收欄 + 冪等帳 + 「店內現貨」種子列
-- 片型 T。**鐵則 12 ③**(新寫入面 + ACL)⇒ 對抗審查不降級。
--
-- 🔴 這一片把 A2 的契約債 ④ 與那句「更正機制留給第 2 批」一起結清:
--    A2 `20260729020000:180-181` 逐字「登錄錯了的更正機制 = 第 2 批批次到貨 UI 落地時才設計,
--    本片不預先發明語意」⇒ **本片就是那一刻**。
--
-- 🔴🔴 **與 a1 驗收 6.9 的絆線關係(先講清楚,免得有人以為是衝突)**:
--    a1 的結構驗收裡有一格,把 receipts 的表註解**逐字釘成「還沒有刪除能力」的舊字面**。
--    本片 §1 會把那段字面改掉 —— 兩者**不衝突,而且是刻意配對的**:
--      · a1 的斷言只在 **a1 自己 apply 的那一刻**執行(那時舊字面仍為真)⇒ 順序上永遠先於本片。
--      · 它真正擋的是「**有人在 a2 之外偷偷把那句話改掉**」—— 那種人會在 a1 重放時當場紅。
--    ⇒ 改那段字面的**唯一合法時機就是這裡**(與刪除 RPC 同一支 migration)。
--
-- 🔴 誠實邊界(不宣稱過頭;沿用 A2/A5a 同款字面):
--    · `p_actor` 是**自陳身分**(cookie 承載、非授權邊界,A5a `:94-95`)⇒ 保證「有一個合法非空
--      actor 字串」,**不保證那是真的操作者**。真身分屬 E8-B。
--    · 「唯一寫入口」限定 **service_role 應用路徑**:owner / SECURITY DEFINER / 持 owner 憑證的
--      服務仍可直寫表(A5a `:90-91` 同界)⇒ 不得說「繞過稽核的路徑不存在」。
--    · 稽核**不能反證真寫入**:service_role 對 `admin_audit_log` 有 INSERT
--      ⇒ 可不碰 receipts 就寫假稽核。本片保證「經本 RPC 的寫入一定留稽核」,不是反過來。
--    · 三個文字欄的隱形字清單是**已知形狀、不宣稱窮盡**(A2 `:213-215` 同語)。
--    · RPC 執行期沒有 `lock_timeout`(檔頭 `SET LOCAL` 只保護 apply 那一刻)
--      ⇒ 撞上殘留 owner 交易會掛住而不是快速失敗(A5a `:96-97` 同界)。
--
-- 🔴 **偏離 plan 的一處,寫在最前面**(plan §3.2 **原本**寫的簽章是 `(uuid, text)`;
--    該處已於 2026-08-11 折面時同步成三參數並記錄本偏離 —— codex 關卡2 C9:兩邊字面本來互相矛盾):
--    刪除 RPC **加收 `p_request_id`**。理由 = `admin_audit_log.request_id` 是 **NOT NULL**
--    (`20260712210000:52`),而稽核的整個用途就是**貫穿同一個 admin 請求**做 correlation
--    (該欄 COMMENT 逐字)⇒ 用 receipt id 合成一個假的 correlation id 會讓稽核鏈斷在這裡。
--    ⚠️ plan 當初寫「刻意不收」的理由是「**刪除天然冪等、不需要冪等鍵**」——
--    那個理由**只反對把它當冪等鍵**,不反對拿它做稽核 correlation。⇒ 收,但**不用它做冪等判斷**。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 結清 A2 的 append-only 字面(plan §2.5;逐字改,不是加註)────
COMMENT ON TABLE public.order_item_procurement_receipts IS
  'M-4b E10 A2(Sean 2026-07-29 拍板 A2-1=A 擴充):逐批到貨明細。一筆採購分幾批到貨就有幾列。'
  '🔴 2026-08-10 #352-a2 起:**不再是 append-only** —— 提供受守門的刪除(admin_delete_item_receipt),'
  '守門只有一條:刪掉之後 instock 不得低於「已出貨 + 已裝進未出貨包裹」的量。**仍然沒有 UPDATE 路徑**。'
  '🔴 order_item_procurement.received_quantity 的真相來源 = 本表 SUM(quantity);那條等式由 A4a 重算 '
  'trigger 維護。🔴 service_role only:供應商到貨資訊是內部資料,絕不對客。';

-- ── 2. admin_record_item_receipt(plan §3.1)──────────────────
CREATE FUNCTION public.admin_record_item_receipt(
  p_procurement_id   uuid,
  p_quantity         integer,
  p_surplus_quantity integer,
  p_received_at      timestamptz,
  p_note             text,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 A5a `:127-133` 的 v_ws;31 字元自檢在下)
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  -- 「肉眼全白但不屬 [[:space:]]」碼位(A5a `:137-138` 同一組;7 字元自檢在下)
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  v_actor      text;
  v_req        text;
  v_note       text;
  v_proc       public.order_item_procurement%ROWTYPE;
  v_receipt_id uuid;
  v_same       boolean;
BEGIN
  -- 步 0. 常數自檢(字面漂移 ⇒ 全函式拒用、fail-loud;A5a `:162-167` 同款)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_record_item_receipt: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_record_item_receipt: v_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 1. 隔離閘(逐字沿用 A5a `:170-174`)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_record_item_receipt 隔離閘:本 RPC 僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a352a2_isolation_read_committed_only';
  END IF;

  -- 🔴 步 2.(plan §3.1-2)**本支刻意【不】下 `SET CONSTRAINTS … IMMEDIATE`**。
  --    本支的守門(**本檔編號的步 7** —— 超收前置拒絕,`:212`)讀的是
  --    **procurement 列的 `received_quantity`**,
  --    ⚠️ 這裡原本寫「步 6」= plan 的舊編號(Fable R3 N2:冪等前移把步序推移、註解沒跟)。
  --       **本檔一律用本檔的編號**;plan §3.1 的編號另見該處。
  --    而供給它的第一跳 trigger `order_item_procurement_receipts_received_sync_ac` 是
  --    **NOT DEFERRABLE**(`20260803140000:415-417`)⇒ 恆為即時值、延後不了 ⇒ **不需要**。
  --    `SET CONSTRAINTS` 會提前引爆外層 pending 的 deferred 事件、且永久改掉該交易的 deferred 模式
  --    ⇒ 沒有需要就不付這個副作用。(harness 有一格證明「DEFERRED 下本支行為不變」。)

  -- 步 3. actor / request_id —— **caller bug 面,RAISE 不給固定碼**(A5a `:32` 逐字慣例)
  IF p_actor IS NULL OR p_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_record_item_receipt: p_actor 缺失或非法(需 ^[a-z0-9_]{1,64}$)';
  END IF;
  v_actor := p_actor;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_record_item_receipt: p_request_id 不可為 NULL';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_record_item_receipt: p_request_id 去空白後為空';
  END IF;
  -- 🔴 與 a1 的 CHECK 對齊:可列印 ASCII、無空白、強制小寫、≤200。
  --    **不靜默 lower()**:靜默正規化會讓「送出的鍵」與「表裡的鍵」不同字面、日後對不起帳,
  --    而本欄是 PK ⇒ 大小寫兩形會繞過重複門。fail-loud 優於 fail-quiet。
  IF v_req !~ '^[!-~]+$' OR v_req <> pg_catalog.lower(v_req) OR pg_catalog.char_length(v_req) > 200 THEN
    RAISE EXCEPTION 'admin_record_item_receipt: p_request_id 形狀非法(需可列印 ASCII、無空白、全小寫、≤200)';
  END IF;

  -- 步 4. 其餘輸入 —— **業務/輸入結果面,回代碼字串**(A5a `:279` 同款)
  IF p_quantity IS NULL OR p_surplus_quantity IS NULL
     OR p_quantity < 0 OR p_surplus_quantity < 0
     OR (p_quantity::bigint + p_surplus_quantity::bigint) NOT BETWEEN 1 AND 100000 THEN
    RETURN 'INVALID_QUANTITY';
  END IF;

  IF p_received_at IS NULL THEN
    RETURN 'RECEIVED_AT_REQUIRED';
  END IF;
  -- 🔴 界的字面**必須帶時區偏移**(A5a `:271-275` 逐字:不帶偏移是用**呼叫端 session 的 TimeZone**
  --    解讀;本函式是 runtime 求值 ⇒ 必須自己釘死)。
  IF NOT (p_received_at > TIMESTAMPTZ '2020-01-01 00:00:00+00'
          AND p_received_at < TIMESTAMPTZ '2100-01-01 00:00:00+00') THEN
    RETURN 'RECEIVED_AT_OUT_OF_RANGE';
  END IF;
  -- 🔴 `clock_timestamp()` 不是 `now()`(後者是交易起始時間,長交易內會把「現在」誤判成未來);
  --    5 分鐘寬限給裝置時鐘偏移 —— 逐字沿用 A5a `:269`(理由)/ `:281`(實作)。
  IF p_received_at > pg_catalog.clock_timestamp() + interval '5 minutes' THEN
    RETURN 'RECEIVED_AT_IN_FUTURE';
  END IF;

  v_note := p_note;
  IF v_note IS NOT NULL THEN
    v_note := pg_catalog.btrim(v_note, v_ws || v_zw);
    IF v_note = '' THEN
      v_note := NULL;   -- 全空白備註 = 沒有備註(不製造「看起來有、其實沒有」的假資料)
    ELSIF pg_catalog.char_length(v_note) > 500 THEN
      RETURN 'NOTE_TOO_LONG';
    END IF;
  END IF;

  -- 步 5. 鎖 procurement 列 + 存在性(plan §3.1-4;鎖序見 §6 註解)
  -- 🔴 A5a `:57` 逐字:`FOR UPDATE` 對**不存在的列不留任何鎖** ⇒ 不得靠「鎖住了就安全」的直覺,
  --    查無一律明確回代碼。
  SELECT * INTO v_proc
    FROM public.order_item_procurement
   WHERE id = p_procurement_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 'PROCUREMENT_NOT_FOUND';
  END IF;

  -- 步 6. 🔴🔴 **冪等快篩必須排在任何「狀態相依」守門之前**(本片實作時實測抓到的真 bug)
  --
  --   病灶:原本的序是「先超收守門、再冪等」。第一次登錄**成功之後** `received_quantity` 就變了,
  --         於是**同鍵同 payload 的合法重放**會先撞上超收守門、回 `QUANTITY_EXCEEDS_ALLOCATED`,
  --         **永遠到不了冪等那一步** ⇒ 冪等在最常見的重放路徑上等於不存在。
  --   來源:那個順序是我折 codex 關卡1 R2 時搬過來的(為了讓超收能用 RETURN 而不必為回滾 ledger 而 RAISE),
  --         當時只論證了「冪等的正確性不靠取鎖順序」——**那句話對鎖成立,對這條狀態相依守門不成立**。
  --   規則(寫給下一個動這段順序的人):**凡是讀「會在兩次呼叫之間改變的狀態」的守門,
  --         都必須排在冪等判斷之後**;否則成功一次就會把自己的重放擋在門外。
  --   🔴 規則的界(Fable 線 F5 打出來的,原字面寫「會被本 RPC 自己改掉的狀態」= **太窄**):
  --         「誰改的」不是判準,**「重放時還一不一樣」才是**。步 5 的 `PROCUREMENT_NOT_FOUND`
  --         讀的是採購列存在性 = **外部**可變狀態,同樣排在快篩之前 ⇒ 一旦日後長出「刪採購列」的面,
  --         「登錄成功 → 採購列被刪 → 合法重放」會回 `PROCUREMENT_NOT_FOUND` 而不是 `DUPLICATE_REQUEST`。
  --         **現在不動它**:①目前全 repo 沒有任何刪採購列的路徑(A5a `:80-84` 的 owner 清理不走應用面)
  --         ②失敗方向是 fail-safe(拒收,不是重複寫入)。**動到採購列刪除面的那一片必須回來重排這一步。**
  --
  --   併發為什麼仍然安全(不必把 ledger 提前寫):
  --     · 同 request_id **同一列採購** ⇒ 兩者都要先取步 5 的 proc 列 NKU ⇒ **序列化**
  --       ⇒ 後者的快篩讀得到前者已提交的帳。
  --     · 同 request_id **不同採購列** ⇒ 不序列化,但那是 caller 重用鍵的 bug,
  --       步 8 的 `unique_violation` 會接住、且 payload 必然不符 ⇒ 明確 RAISE。
  SELECT (l.procurement_id   IS NOT DISTINCT FROM p_procurement_id
          AND l.quantity         IS NOT DISTINCT FROM p_quantity
          AND l.surplus_quantity IS NOT DISTINCT FROM p_surplus_quantity
          AND l.received_at      IS NOT DISTINCT FROM p_received_at
          AND l.note             IS NOT DISTINCT FROM v_note
          AND l.actor            IS NOT DISTINCT FROM v_actor)
    INTO v_same
    FROM public.order_item_receipt_requests l
   WHERE l.request_id = v_req;
  IF FOUND THEN
    -- 查驗式冪等:**看到鍵在 ≠ 產物存在且屬本目標**
    -- (memory `feedback_idempotency-key-must-be-verified-not-just-present`)
    -- 🔴 產物可能已被刪(ledger 列不可刪)⇒ 一樣回 DUPLICATE、**不重新 INSERT** ⇒ 復活路徑不存在。
    IF v_same THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    RAISE EXCEPTION '這個提交編號先前已經用過,但內容不一樣。請重新整理頁面再送一次。';
  END IF;

  -- 步 7. 超收前置拒絕(plan §3.1-5)—— 現在排在冪等之後
  -- ⚠️ 本步在 proc 列鎖之內 ⇒ 併發登錄會序列化,第二者讀得到第一者提交後的 received(READ COMMITTED)。
  -- 🔴 **不靠 A2 的 `received_range` CHECK 兜底**:那條吐 raw 23514、員工看不懂
  --    (A4a COMMENT `:319` 逐字)。⚠️ 那條 CHECK **仍然留著、它才是權威**;本步只把失敗時機提前。
  -- ✅ 此時尚未寫入任何東西 ⇒ 可以用 RETURN,不必為了回滾而 RAISE。
  IF p_quantity > (v_proc.allocated_quantity - v_proc.received_quantity) THEN
    RETURN 'QUANTITY_EXCEEDS_ALLOCATED';
  END IF;

  -- 步 8. 冪等帳(plan §2.4)——**先產 receipt uuid、當場寫進帳**,不回填
  v_receipt_id := gen_random_uuid();
  BEGIN
    INSERT INTO public.order_item_receipt_requests
      (request_id, procurement_id, quantity, surplus_quantity, received_at, note, actor, receipt_id)
    VALUES (v_req, p_procurement_id, p_quantity, p_surplus_quantity, p_received_at, v_note, v_actor, v_receipt_id);
  EXCEPTION WHEN unique_violation THEN
    -- 只有「同鍵、不同採購列」的併發才到得了這裡(同列已被步 5 的鎖序列化、走步 6 快篩)。
    -- 比對面與步 6 **逐字相同**,不得分岔。
    SELECT (l.procurement_id   IS NOT DISTINCT FROM p_procurement_id
            AND l.quantity         IS NOT DISTINCT FROM p_quantity
            AND l.surplus_quantity IS NOT DISTINCT FROM p_surplus_quantity
            AND l.received_at      IS NOT DISTINCT FROM p_received_at
            AND l.note             IS NOT DISTINCT FROM v_note
            AND l.actor            IS NOT DISTINCT FROM v_actor)
      INTO v_same
      FROM public.order_item_receipt_requests l
     WHERE l.request_id = v_req;
    IF v_same THEN
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    RAISE EXCEPTION '這個提交編號先前已經用過,但內容不一樣。請重新整理頁面再送一次。';
  END;

  -- 步 9. 寫到貨明細(用步 8 產的 id)→ A4a 級聯重算 received / instock
  INSERT INTO public.order_item_procurement_receipts
    (id, procurement_id, quantity, surplus_quantity, received_at, received_by, note)
  VALUES (v_receipt_id, p_procurement_id, p_quantity, p_surplus_quantity, p_received_at, v_actor, v_note);

  -- 步 10. 稽核
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor, 'procurement_receipt.create', 'receipt:' || v_receipt_id::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'procurement_id',   p_procurement_id,
      'quantity',         p_quantity,
      'surplus_quantity', p_surplus_quantity,
      'received_at',      p_received_at,
      'has_note',         (v_note IS NOT NULL)),
    NULL, v_req, 'admin');

  RETURN 'RECORDED';
END
$fn$;

COMMENT ON FUNCTION public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text) IS
  'M-4b E10 #352-a2:登錄一批到貨。回 RECORDED / DUPLICATE_REQUEST / PROCUREMENT_NOT_FOUND / '
  'QUANTITY_EXCEEDS_ALLOCATED / INVALID_QUANTITY / NOTE_TOO_LONG / RECEIVED_AT_*(輸入與業務結果回代碼字串,'
  '對齊 A5a 慣例);actor / request_id 缺失或非法 = caller bug ⇒ RAISE 不給固定碼(A5a :32)。'
  '🔴 冪等:先寫 order_item_receipt_requests(PK=request_id、跨全表),撞鍵則查驗全部不可變 payload'
  '(一律 IS NOT DISTINCT FROM;note 可為 NULL,用 = 會讓空備註的合法重放被誤判)。'
  '🔴 本支【不】下 SET CONSTRAINTS:守門讀 procurement 列,那一跳的 trigger 是 NOT DEFERRABLE。';

-- ── 3. admin_delete_item_receipt(plan §3.2)─────────────────
CREATE FUNCTION public.admin_delete_item_receipt(
  p_receipt_id uuid,
  p_actor      text,
  p_request_id text            -- 🔴 plan 簽章外加收(理由見檔頭);**不用於冪等判斷**
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- 🔴 與登錄那支**逐字相同**的兩組字元集(codex 關卡2 C1)。
  --    原本這支只做預設 `btrim`(僅 ASCII 空白)+ 形狀閘,我在註解裡宣稱「與登錄同一條形狀閘」——
  --    **那句是假的**:形狀閘同,但**正規化不同** ⇒ 前置 `U+200B` 的 request_id
  --    在登錄被剝乾淨後收下、在刪除卻直接被形狀閘拒絕,同一個字串兩支結論相反。
  --    ⇒ 兩組常數照抄過來(含 31/7 自檢),讓兩支的**正規化 + 形狀**完全一致。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  v_actor    text;
  v_req      text;
  v_rec      public.order_item_procurement_receipts%ROWTYPE;
  v_item     uuid;
  v_instock  integer;
  v_shipped  integer;
  v_pending  bigint;
  v_rows     integer;
  v_boxes    text;
BEGIN
  -- 步 1. 隔離閘
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_delete_item_receipt 隔離閘:本 RPC 僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a352a2_isolation_read_committed_only';
  END IF;

  IF p_actor IS NULL OR p_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: p_actor 缺失或非法(需 ^[a-z0-9_]{1,64}$)';
  END IF;
  v_actor := p_actor;
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: v_zw 字元集長度異常(預期 7)';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: p_request_id 不可為 NULL(稽核 correlation 需要)';
  END IF;
  -- 🔴 **正規化 + 形狀閘都與登錄那支逐字相同**(Fable F2 / opus nit10 起、codex 關卡2 C1 收尾)。
  --    `admin_audit_log.request_id` 只有 NOT NULL + `<> ''`(`20260712210000:51,57`)⇒ DB 攔不住;
  --    而這欄的**唯一用途**就是把同一個 admin 請求串起來,收進大寫/控制字元/純零寬會讓 correlation 對不上。
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: p_request_id 去空白後為空(稽核 correlation 需要)';
  END IF;
  IF v_req !~ '^[!-~]+$' OR v_req <> pg_catalog.lower(v_req) OR pg_catalog.char_length(v_req) > 200 THEN
    RAISE EXCEPTION 'admin_delete_item_receipt: p_request_id 形狀非法(需可列印 ASCII、無空白、全小寫、≤200)';
  END IF;

  -- 步 2. 找 receipt;查無 ⇒ 用冪等帳分辨「刪過了」與「從來不存在」
  SELECT * INTO v_rec FROM public.order_item_procurement_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    -- 🔴 這一枝就是 a1 把 ledger.receipt_id 做成 NOT NULL + UNIQUE + **永不清空**的理由:
    --    清空的話這裡分不出兩者,只能對任何亂數 uuid 都回「成功」。
    IF EXISTS (SELECT 1 FROM public.order_item_receipt_requests WHERE receipt_id = p_receipt_id) THEN
      RETURN 'ALREADY_DELETED';
    END IF;
    RETURN 'RECEIPT_NOT_FOUND';
  END IF;

  -- 🔴 步 3.(plan §3.3)**本支需要** `SET CONSTRAINTS … IMMEDIATE`:
  --    步 6 的守門讀 `order_item_quantity_summary`,而供給它的**第二跳** trigger
  --    `order_item_procurement_summary_recompute_zc` 是 **DEFERRABLE INITIALLY IMMEDIATE**
  --    (`20260803140000:409-411`)⇒ 呼叫端若先 `SET CONSTRAINTS … DEFERRED`,
  --    守門會讀到**刪除前的舊摘要**而放行。拉回 IMMEDIATE(照抄 A5a `:176-178` 的做法)。
  --    ⚠️ 副作用(照 A5a 檔頭認列):會**提前引爆外層交易已 pending 的 deferred 事件**,
  --       且**永久改掉該交易的 deferred 模式**。本支付得起這個代價,登錄那支付不起也不需要。
  -- 🔴 **為什麼排在存在性檢查【之後】**(opus nit11:原本無條件先跑):
  --    副作用是**永久**的,而 `RECEIPT_NOT_FOUND` / `ALREADY_DELETED` 兩枝是**完全 no-op 的呼叫** ——
  --    讓一個什麼都沒做的呼叫改掉呼叫端整個交易的 deferred 模式,是白付代價。
  --    ⚠️ 正確性不受影響:唯一需要 IMMEDIATE 的是**步 6 讀摘要**,而步 2-5 都不讀摘要;
  --       本步仍在 DELETE(步 5)之前 ⇒ 重算事件照樣在守門讀值前結清。
  SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc IMMEDIATE;

  -- 步 4. 取鎖:procurement → order_items(canonical 序,見 §6)
  PERFORM 1 FROM public.order_item_procurement WHERE id = v_rec.procurement_id FOR NO KEY UPDATE;
  SELECT p.order_item_id INTO v_item
    FROM public.order_item_procurement p WHERE p.id = v_rec.procurement_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'admin_delete_item_receipt 防衛枝:receipt % 的採購列不見了(FK RESTRICT 應已先擋)', p_receipt_id;
  END IF;
  PERFORM 1 FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE;

  -- 步 5. 刪 —— 🔴 **看 rowcount**:併發雙刪時兩者都在步 2 看得到那列,
  --      取鎖序列化後第二者的 DELETE 影響 0 列;不看 rowcount 就會拿著已失效的舊值往下走、
  --      還去跑後置守門並宣稱刪除成功。
  --      ⚠️ 判準**只有** `ROW_COUNT`;原本多寫的 `RETURNING id INTO v_deleted` 是死賦值
  --      (opus nit13:賦值後從未被讀)⇒ 已移除,免得下一個人以為那才是判準。
  DELETE FROM public.order_item_procurement_receipts
   WHERE id = p_receipt_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN 'ALREADY_DELETED';
  END IF;

  -- 步 6. 唯一的業務守門(後置、讀 A4a 重算後的權威值;fail-closed)
  -- 🔴 **後置而非預測**:讀重算後的真值,不自己算 `instock − N`
  --    (自己算 = 在 RPC 裡複製重算規則 = 第二真相)。
  SELECT q.instock_quantity, q.shipped_quantity INTO v_instock, v_shipped
    FROM public.order_item_quantity_summary q
   WHERE q.order_item_id = v_item;
  -- 🔴 **fail-closed**:NULL 讓比較式不成立而靜默放行正是要防的形狀
  --    (`types.ts:638-660` 立過「讀不到就不放行」的契約)。
  -- ⚠️ 誠實邊界(Fable F7 更正;字面向 harness E5 `:285-289` 對齊):
  --    **這一枝在正常路徑上構造不出來** —— 有 receipt 就必定先有過 procurement 的 INSERT,
  --    `_zc` 必定建過摘要列 ⇒ 走到這裡摘要列不會缺。原本寫「A4a 惰性建列 ⇒ 缺列真的會發生」
  --    是把**登錄那支**的前提搬到刪除路徑,對本支不成立。
  --    保留它的理由是 trigger 壞掉/有人直寫 DB 的世界,**不是**它會在正常路徑上被觸發。
  IF NOT FOUND OR v_instock IS NULL OR v_shipped IS NULL THEN
    RAISE EXCEPTION 'admin_delete_item_receipt:讀不到品項 % 的數量摘要,無法確認刪除後是否仍夠出貨 —— 拒絕刪除', v_item
      USING ERRCODE = 'P4A03', CONSTRAINT = 'a352a2_delete_below_shipped';
  END IF;

  -- `pending` 逐字對齊 w3b2 `20260807180000:244-250` 的 LEFT JOIN LATERAL(兩個 NULL 條件都要)
  SELECT coalesce(pg_catalog.sum(si.shipped_quantity), 0) INTO v_pending
    FROM public.shipment_items si
    JOIN public.shipments sh ON sh.id = si.shipment_id
   WHERE si.order_item_id = v_item
     AND sh.shipped_at IS NULL AND sh.deleted_at IS NULL;

  IF v_instock::bigint < v_shipped::bigint + v_pending THEN
    -- 訊息**列出全部相關包裹**(不是只講一個);依包裹編號升冪、每箱一行 + 白話出路
    SELECT pg_catalog.string_agg(
             '  ' || sh.shipment_reference || ':' || si.shipped_quantity::text || ' 件',
             E'\n' ORDER BY sh.shipment_reference)
      INTO v_boxes
      FROM public.shipment_items si
      JOIN public.shipments sh ON sh.id = si.shipment_id
     WHERE si.order_item_id = v_item
       AND sh.shipped_at IS NULL AND sh.deleted_at IS NULL;
    RAISE EXCEPTION E'刪不掉這筆到貨紀錄:刪掉之後這個品項的可出數量會不夠。\n'
      '已出貨 % 件、已裝進尚未出貨的包裹 % 件,而刪除後只剩 % 件。\n'
      '尚未出貨的包裹:\n%\n'
      '要先把那些包裹作廢、或從包裹裡移除這個品項,才能刪掉這筆到貨紀錄。',
      v_shipped, v_pending, v_instock, coalesce(v_boxes, '  (無)')
      USING ERRCODE = 'P4A03', CONSTRAINT = 'a352a2_delete_below_shipped';
  END IF;

  -- 步 7. 稽核(記完整內容 —— **刪掉之後就查不到了**)
  -- ⚠️ before-image **不含 `note`**(Fable F8):不是漏,是不需要 ——
  --    `note` 由冪等帳 `order_item_receipt_requests.note` 永久保存(該表零 UPDATE 零 DELETE),
  --    刪 receipt 不會讓它滅失 ⇒ 查得到。
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor, 'procurement_receipt.delete', 'receipt:' || p_receipt_id::text,
    pg_catalog.jsonb_build_object(
      'procurement_id',   v_rec.procurement_id,
      'quantity',         v_rec.quantity,
      'surplus_quantity', v_rec.surplus_quantity,
      'received_at',      v_rec.received_at,
      'received_by',      v_rec.received_by),
    NULL, NULL, v_req, 'admin');

  RETURN 'DELETED';
END
$fn$;

COMMENT ON FUNCTION public.admin_delete_item_receipt(uuid,text,text) IS
  'M-4b E10 #352-a2(Sean 2026-08-10 Q3=A「做一個可以刪除到貨紀錄的方式」):刪掉一筆到貨。'
  '回 DELETED / ALREADY_DELETED / RECEIPT_NOT_FOUND。🔴 唯一守門 = 刪除後 instock 不得低於'
  '「已出貨 + 已裝進未出貨包裹」;不成立回 P4A03 並列出全部相關包裹。'
  '🔴 後置守門讀 A4a 重算後的權威值,且缺摘要列/NULL 一律 fail-closed(不靜默放行)。'
  '🔴 DELETE 看 rowcount:併發雙刪的第二者回 ALREADY_DELETED,不會拿舊值往下走。'
  '🔴 p_request_id 只作稽核 correlation(admin_audit_log.request_id NOT NULL),**不參與冪等判斷**。';

-- ── 4. ACL:REVOKE 全部後只給 service_role ────────────────────
-- 新建 function 預設 GRANT EXECUTE TO PUBLIC ⇒ 全數 REVOKE 再精準補(A5a 同款)。
REVOKE ALL ON FUNCTION public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_item_receipt(uuid,text,text)
  TO service_role;

-- ── 5. 結構驗收(fail-closed;任一條不成立 = 整片回滾)────────
DO $verify$
DECLARE
  v_cnt  integer;
  v_txt  text;
  v_src  text;
  v_i    integer;
  v_j    integer;
BEGIN
  -- 5.1 兩支都在、都是 SECDEF、search_path 逐字
  FOR v_txt IN SELECT unnest(ARRAY[
      'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)',
      'public.admin_delete_item_receipt(uuid,text,text)'])
  LOOP
    SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc
     WHERE oid = v_txt::regprocedure AND prosecdef;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '#352-a2 驗收:% 不存在或非 SECURITY DEFINER', v_txt;
    END IF;
    SELECT pg_catalog.array_to_string(proconfig, ',') INTO v_src
      FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure;
    IF v_src IS DISTINCT FROM 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION '#352-a2 驗收:% 的 proconfig = %(預期 search_path=public, pg_temp)',
        v_txt, coalesce(v_src, '(NULL)');
    END IF;

    -- 5.2 EXECUTE 權:owner 以外恰 service_role,且**不可轉授**
    --     🔴 a1 的教訓:只驗「有 EXECUTE」會漏掉 WITH GRANT OPTION。
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_txt::regprocedure
       AND a.grantee <> p.proowner
       AND NOT (a.grantee = 'service_role'::regrole::oid
                AND a.privilege_type = 'EXECUTE'
                AND a.is_grantable = false);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '#352-a2 驗收:% 的 ACL 有 % 項是「owner 以外、且非 service_role 的不可轉授 EXECUTE」',
        v_txt, v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_txt::regprocedure
       AND a.grantee = 'service_role'::regrole::oid
       AND a.privilege_type = 'EXECUTE' AND a.is_grantable = false;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '#352-a2 驗收:% 缺 service_role 的不可轉授 EXECUTE', v_txt;
    END IF;
  END LOOP;

  -- 5.3 🔴 取鎖序錨(plan §4 失效條件①):delete 的函式體裡,
  --     procurement 的 FOR NO KEY UPDATE 必須出現在 order_items 的 FOR NO KEY UPDATE **之前**。
  --     兩行對調 ⇒ 本格必紅。
  --
  -- 🔴🔴 **一律對「剝掉註解的函式體」比,不是對 raw `prosrc` 比**(本片實作時當場踩到):
  --    `prosrc` **包含註解**。本檔步 2 的說明註解裡就寫著「本支刻意【不】下 SET CONSTRAINTS」,
  --    拿 raw prosrc 找 'SET CONSTRAINTS' 會命中**自己的註解**、把正確的實作判成違規
  --    (第一次跑就紅在這裡)。同型:`IS NOT DISTINCT FROM` 的次數也會被註解灌水。
  --    ⇒ 這與 OP5 驗收「對剝掉註解的函式體比,不是對 prosrc 首次命中」是同一條紀律。
  --    ⚠️ 誠實邊界:這個剝法用 `--` 到行尾,**字串字面裡的 `--` 也會被剝掉** ——
  --       對「找錨點」這個用途可接受(錨點都不含 `--`),但不可拿它當通用的 SQL parser。
  SELECT pg_catalog.regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.admin_delete_item_receipt(uuid,text,text)'::regprocedure;
  v_i := pg_catalog.strpos(v_src, 'FROM public.order_item_procurement WHERE id = v_rec.procurement_id FOR NO KEY UPDATE');
  v_j := pg_catalog.strpos(v_src, 'FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE');
  IF v_i = 0 OR v_j = 0 THEN
    RAISE EXCEPTION '#352-a2 驗收:delete 的兩個取鎖錨找不到(i=% j=%)—— 錨點字面被改過就要重審鎖序', v_i, v_j;
  END IF;
  IF v_i >= v_j THEN
    RAISE EXCEPTION '#352-a2 驗收:取鎖序反了(procurement 必須在 order_items 之前;i=% j=%)', v_i, v_j;
  END IF;

  -- 5.4 🔴 `SET CONSTRAINTS` **只准出現在 delete 那支**(plan §3.1-2)
  IF pg_catalog.strpos(v_src, 'SET CONSTRAINTS') = 0 THEN
    RAISE EXCEPTION '#352-a2 驗收:delete 少了 SET CONSTRAINTS … IMMEDIATE(deferred 呼叫端會讀到舊摘要)';
  END IF;
  SELECT pg_catalog.regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'SET CONSTRAINTS') <> 0 THEN
    RAISE EXCEPTION '#352-a2 驗收:record 不該有 SET CONSTRAINTS(它的守門讀 procurement 列、那一跳 NOT DEFERRABLE;'
      '加了只是白付「提前引爆 deferred + 永久改交易模式」的副作用)';
  END IF;

  -- 5.5 🔴 冪等比對必須是 IS NOT DISTINCT FROM,不得是 `=`(Fable R3-F1:空備註的合法重放會被誤判)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.regexp_matches(v_src, 'IS NOT DISTINCT FROM', 'g');
  -- 🔴 12 = 6 個不可變 payload 欄 × 2 處(步 6 快篩 + 步 8 撞鍵處理)。
  --    兩處**必須逐字相同**;數字對不上代表有人只改了其中一處 = 比對面分岔。
  IF v_cnt <> 12 THEN
    RAISE EXCEPTION '#352-a2 驗收:record 的冪等比對用了 % 次 IS NOT DISTINCT FROM(預期 12 = 6 欄 × 2 處)', v_cnt;
  END IF;

  -- 5.6 ledger 仍為零 FK(plan §4 失效條件②:有人補 FK ⇒ 整段鎖序論證要重跑)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass AND contype = 'f';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#352-a2 驗收:冪等帳長出了 % 條外鍵 —— plan §4 的鎖序論證與 A5a owner 清理路都要重估', v_cnt;
  END IF;

  -- 5.7 §1 的 COMMENT 已改(且不再是舊的 append-only 宣稱)
  SELECT pg_catalog.obj_description('public.order_item_procurement_receipts'::regclass, 'pg_class') INTO v_txt;
  IF v_txt IS NULL OR v_txt NOT LIKE '%不再是 append-only%' OR v_txt NOT LIKE '%仍然沒有 UPDATE 路徑%' THEN
    RAISE EXCEPTION '#352-a2 驗收:receipts 的表註解沒有兌現 A2 契約債(應同時說明「不再 append-only」與「仍無 UPDATE 路徑」)= %',
      coalesce(v_txt, '(無)');
  END IF;

  RAISE NOTICE '#352-a2 結構驗收通過:兩支 SECDEF+search_path+不可轉授 EXECUTE、取鎖序錨、SET CONSTRAINTS 只在 delete、冪等 12 次 IS NOT DISTINCT FROM(6 欄 × 2 處)、ledger 零 FK、A2 契約債字面已結清';
END
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
--   本片**可逆**(與 a1 不同):
--     BEGIN;
--     SET LOCAL lock_timeout = '5s';
--     DROP FUNCTION public.admin_delete_item_receipt(uuid,text,text);
--     DROP FUNCTION public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text);
--     COMMENT ON TABLE public.order_item_procurement_receipts IS <a1 之前那段舊字面>;
--     COMMIT;
--
--   ⚠️ **但已經寫進去的到貨紀錄不會消失,也不該消失** —— 那是既成事實。
--      回滾只是把「員工能不能經由 RPC 寫/刪」收回去,不動資料。
--   ⚠️ 還原 COMMENT 那一行要用 **a1 驗收 6.9 釘住的那段逐字**,否則 a1 重放會紅
--      (那道絆線就是為了讓「字面被偷改」在重放時現形)。
-- ============================================================
