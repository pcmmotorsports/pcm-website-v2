-- ============================================================
-- #352 甲片:到貨登錄補「品項層額度」守門 —— 取消後貨才到不再吐 raw 23514
-- ============================================================
-- 背景(實測,不是推論):a2(`20260810233000`)apply 後,
--   未付款單**全量取消**成功 → 供應商的貨到了 → `admin_record_item_receipt`
--   ⇒ `SQLSTATE 23514` / `violates check constraint "oiqs_instock_cancelled_le_quantity"`
--   員工看到的是一句他完全看不懂的英文 constraint 名,而 a2 自己的步 7 註解才剛寫過
--   「不靠 CHECK 兜底:那條吐 raw 23514、員工看不懂」。⇒ **同一個病,a2 只修了超收那一半。**
--
-- Sean 2026-08-11 **Q9=A**:已取消單的貨到了 ⇒ **不讓登錄到這張單**,
--   畫面導向「現貨入庫」(貨變自家庫存,對齊 #352「現貨=虛擬供應商」拍板)。
--   UI 導向本身 = backlog **#386**(現貨入庫入口做出來後才接得上),不在本片。
--
-- 🔴 **為什麼另開一支、不就地改 `20260810233000`**(關卡1 must-fix 7):
--   「正式庫還沒 apply」只是**一個環境**的事實。任何持久環境(preview / 誰的本機庫)
--   只要已登記過該版本號,之後就**不會再重跑它** ⇒ 形成**同 migration 版本號、不同函式內容**,
--   而那是一旦發生極難查的事故形。⇒ 233000 保持凍結字面不動,修法走本支。
--   ⚠️ 因此本支**必須排在 233000 之後**;兩支同批 apply(批二 = a1 + a2 + 本支)。
--
-- 片型:鐵則 12③(動 DB 寫入面)。驗收 = `scripts/352a2-verify.sh`(同一份,擴充)。
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(
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
  v_item       uuid;
  v_room       bigint;
  v_cancelled  bigint;
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

  -- 步 7b. 🔴 **品項層額度**(#352 甲片;Sean 2026-08-11 Q9=A)
  --   為什麼需要它:步 7 擋的是**採購列層**(allocated − received),而 C7
  --   (`20260730150000:123-124` `instock + cancelled <= quantity`)是**品項層**不變式 ——
  --   **兩個不同的軸**。取消吃掉的額度步 7 完全看不見 ⇒ 「單子取消後貨才到」會直接撞 C7、
  --   吐 **raw 23514** 給員工,而本檔步 7 的註解才剛說過「不靠 CHECK 兜底、員工看不懂」。
  --
  --   🔴🔴 **讀真相表,不讀摘要**(關卡1 must-fix 1/2/4):
  --     `order_item_quantity_summary` 是**衍生**的,而且供給它的兩跳時機**不對稱** ——
  --     `…summary_recompute_zc` 是唯一 DEFERRABLE(`20260803140000:409-413`)、
  --     `…received_sync_ac` 是 NOT DEFERRABLE。呼叫端若先 `SET CONSTRAINTS … DEFERRED`,
  --     摘要可能**偏舊任一方向**:偏小 ⇒ 放行後被 C7 擋(醜但安全);
  --     **偏大 ⇒ 直接誤拒合法登錄,而 C7 根本不出場**(既不放行也不觸發 C7 的第三結局)。
  --     ⇒ 改讀 C7 算式的**來源本身**:取消明細與到貨明細。順帶解掉「摘要列不存在時 NULL
  --     讓比較式不成立而 fail-open」那個坑 —— `sum` 配 `coalesce(…,0)`,而「沒有取消列 = 沒取消過」
  --     是**真相**、不是約定。
  --     ⚠️ **字面更正(opus 線 ④)**:不可寫成「這兩張表沒有 deferred trigger 夾在中間」——
  --        `…presence_ac` 確實是 DEFERRABLE。正確的說法是:**夾在中間的 deferred trigger 只做驗證、
  --        不寫這兩張表的內容** ⇒ 它們的**值**在本交易內恆為即時值,判斷不受 deferral 影響。
  --
  --   🔴 **鎖**:讀真相表前先鎖 `order_items`(NKU),序 = `proc → order_items`,
  --     ⚠️ **這把鎖同時是「與取消序列化」的機制,不只是鎖序合規**(opus 線升級成字面):
  --        取消 RPC 鎖的是**同一列** `order_items`(`20260805100000:367-370`)⇒ 取消與本支
  --        **在該列上序列化**,不會出現「讀到取消一半」的中間態。這是**字面**(兩處鎖同一列),
  --        不是推論;但**真併發交錯仍未實測**(需兩條連線 rendezvous),見 harness 收尾缺口段。
  --     與 `admin_delete_item_receipt` 的 canonical 序**逐字相同** ⇒ 見 plan §4 第四版無環論證。
  --     (`FOR NO KEY UPDATE`:`FOR UPDATE` 與 FK 的 `KEY SHARE` 死結,A2b1 實測。)
  SELECT p.order_item_id INTO v_item
    FROM public.order_item_procurement p WHERE p.id = p_procurement_id;
  IF v_item IS NULL THEN
    -- 步 5 已鎖住該列且確認存在 ⇒ 這裡讀不到 = 不變式壞掉,fail-loud 不 fail-open
    RAISE EXCEPTION 'admin_record_item_receipt 防衛枝:採購列 % 的 order_item_id 讀不到', p_procurement_id;
  END IF;
  PERFORM 1 FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE;

  SELECT coalesce(pg_catalog.sum(ci.cancelled_quantity)::bigint, 0) INTO v_cancelled
    FROM public.order_cancellation_items ci WHERE ci.order_item_id = v_item;
  -- ⚠️ 只看 `quantity`(真到貨)不看 `surplus_quantity` —— C7 的左邊是 `instock`,
  --    而 `instock` 的來源 sum 只算 `quantity`(溢收列 quantity=0 ⇒ 不佔額度)。
  SELECT oi.quantity::bigint - v_cancelled
         - coalesce((SELECT pg_catalog.sum(r.quantity)::bigint
                       FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = v_item), 0)
    INTO v_room
    FROM public.order_items oi WHERE oi.id = v_item;
  IF v_room IS NULL THEN
    RAISE EXCEPTION 'admin_record_item_receipt 防衛枝:品項 % 的可登錄額度算不出來', v_item;
  END IF;
  IF p_quantity::bigint > v_room THEN
    -- 🔴 **碼面不得假設「全單取消」**(codex 關卡2 C1:原碼名 `ORDER_CANCELLED_USE_SPOT_STOCK`
    --    在**部分取消**時是假話 —— 取消 2/3 的單根本沒有「已取消」)。
    --    現名 `EXCEEDS_ROOM_AFTER_CANCELLATION` 對部分與全取消**都是真話**;
    --    app 端文案由主視窗定:「這張單已取消 N 件、剩餘可登錄 X 件;多的請改走現貨入庫」
    --    ⇒ 動作仍是 Sean Q9=A(擋下 + 導向現貨入庫),變的只是句子不再假設全單取消。
    --    ⚠️ 仍然**只有 `v_cancelled > 0` 才回它**;`= 0` 走下面的 fail-loud(碼名提到 cancellation,
    --    沒取消卻回它一樣是說謊)。
    IF v_cancelled > 0 THEN
      RETURN 'EXCEEDS_ROOM_AFTER_CANCELLATION';
    END IF;
    -- 🔴 `v_cancelled = 0` 卻超出品項額度 = **A2b1 的不變式壞了**,不是業務情況:
    --    A2b1 保證 `SUM(allocated) <= quantity - SUM(cancelled)`(`20260803130000:16` 逐字),
    --    配上步 7 的 `p_quantity <= allocated - received`,在 cancelled=0 時兩式相接即得
    --    `p_quantity <= v_room` ⇒ 這一枝**不可達**。走到這裡要 fail-loud,不要靜默回業務碼。
    RAISE EXCEPTION 'admin_record_item_receipt 不變式破損:品項 % 無取消卻超出額度(room=%,要記 %)',
      v_item, v_room, p_quantity;
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
  'M-4b E10 #352-a2 + 甲片:登錄一批到貨。回 RECORDED / DUPLICATE_REQUEST / PROCUREMENT_NOT_FOUND / '
  'QUANTITY_EXCEEDS_ALLOCATED / EXCEEDS_ROOM_AFTER_CANCELLATION / INVALID_QUANTITY / NOTE_TOO_LONG / '
  'RECEIVED_AT_*(輸入與業務結果回代碼字串,對齊 A5a 慣例);'
  'actor / request_id 缺失或非法 = caller bug ⇒ RAISE 不給固定碼(A5a :32)。'
  '🔴 冪等:先寫 order_item_receipt_requests(PK=request_id、跨全表),撞鍵則查驗全部不可變 payload'
  '(一律 IS NOT DISTINCT FROM;note 可為 NULL,用 = 會讓空備註的合法重放被誤判)。'
  '🔴 本支【不】下 SET CONSTRAINTS:兩道守門讀的都是【真相表】(procurement 列 / order_cancellation_items '
  '+ order_item_procurement_receipts),不讀衍生的 order_item_quantity_summary ⇒ 不受 deferred 時機影響。'
  '🔴 守門 precedence:採購列層(QUANTITY_EXCEEDS_ALLOCATED)先判、品項層(EXCEEDS_ROOM_AFTER_CANCELLATION)後判。';

-- ══ 結構驗收(本支自己的;行為證據在 scripts/352a2-verify.sh)══════
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT pg_catalog.regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc
   WHERE oid = 'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '甲片驗收:record RPC 不在';
  END IF;

  -- ① 新守門在、且回的是 Q9=A 的碼
  IF pg_catalog.strpos(v_src, 'EXCEEDS_ROOM_AFTER_CANCELLATION') = 0 THEN
    RAISE EXCEPTION '甲片驗收:品項層額度守門不在';
  END IF;

  -- ② 讀的是【真相表】不是摘要(關卡1 must-fix 1/2/4 的承重點)
  IF pg_catalog.strpos(v_src, 'order_cancellation_items') = 0
     OR pg_catalog.strpos(v_src, 'order_item_procurement_receipts') = 0 THEN
    RAISE EXCEPTION '甲片驗收:新守門沒有讀真相表';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_item_quantity_summary') <> 0 THEN
    RAISE EXCEPTION '甲片驗收:record 竟然讀了衍生的摘要表 —— 那正是本片要拿掉的東西';
  END IF;

  -- ③ 仍然【不】下 SET CONSTRAINTS(a2 的決定不被本片翻掉)
  IF pg_catalog.strpos(v_src, 'SET CONSTRAINTS') <> 0 THEN
    RAISE EXCEPTION '甲片驗收:record 長出了 SET CONSTRAINTS';
  END IF;

  -- ④ precedence:採購層在品項層【之前】
  IF pg_catalog.strpos(v_src, 'QUANTITY_EXCEEDS_ALLOCATED')
     >= pg_catalog.strpos(v_src, 'EXCEEDS_ROOM_AFTER_CANCELLATION') THEN
    RAISE EXCEPTION '甲片驗收:守門 precedence 反了(採購層必須排在品項層之前)';
  END IF;

  -- ⑤ 取鎖序:proc 的 NKU 仍在 order_items 的 NKU 【之前】(plan §4 第四版無環論證的前提)
  IF pg_catalog.strpos(v_src, 'FROM public.order_item_procurement' || chr(10)) = 0 THEN
    RAISE EXCEPTION '甲片驗收:proc 鎖的錨點不見了';
  END IF;
  IF pg_catalog.strpos(v_src, 'FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE') = 0 THEN
    RAISE EXCEPTION '甲片驗收:order_items 的 NKU 鎖不在';
  END IF;
  IF pg_catalog.strpos(v_src, 'FOR NO KEY UPDATE')
     >= pg_catalog.strpos(v_src, 'FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE') THEN
    RAISE EXCEPTION '甲片驗收:取鎖序不對(proc 必須在 order_items 之前)';
  END IF;

  -- ⑥ 品項層守門排在冪等判斷【之後】(本檔既有規則:讀會變的狀態的守門一律在冪等後)
  IF pg_catalog.strpos(v_src, 'DUPLICATE_REQUEST')
     >= pg_catalog.strpos(v_src, 'EXCEEDS_ROOM_AFTER_CANCELLATION') THEN
    RAISE EXCEPTION '甲片驗收:品項層守門跑到冪等之前了';
  END IF;

  RAISE NOTICE '#352 甲片 結構驗收通過:品項層額度守門在、讀真相表不讀摘要、無 SET CONSTRAINTS、precedence 正確、取鎖序 proc→order_items、守門在冪等之後';
END
$verify$;
