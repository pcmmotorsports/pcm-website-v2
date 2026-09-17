-- supabase/rollbacks/20260917120000-rollback.sql
-- 還原 `20260917120000_m4b_delete_item_receipt_reason.sql`:把 `admin_delete_item_receipt`
-- 退回【三參數、沒有 reason】那一版。
--
-- 🛑🛑 **絕對不要對正式庫跑這支。** 演練只在拋棄式 PG(`scripts/migrations-replay-from-zero.sh --keep-db`)。
--
-- 🔴 **退之前先退碼**:後台送四個參數而函式只剩三個 ⇒ PGRST202,撤銷整條路斷掉。
--    順序 = 先退碼、再跑本檔(與貼板時相反)。
--
-- 🔴 **本檔嵌的是【貼之前】那一版的原文** —— `pg_get_functiondef` 從正式庫撈下來的,
--    不是從 `20260810233000` 抄的。那兩份**不一樣**:migration 檔寫
--    `SET search_path = public, pg_temp`,而活的庫是 `SET search_path TO ''`
--    (2026-09-05 M1a/M1b 鎖的,Sean 批甲)⇒ **照 migration 抄就是把加固解開。**

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:確認現在真的是【貼過本片】的狀態 ────────────────────────────
DO $pre$
DECLARE v_oid oid;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '還原前置閘:找不到四參數版 ⇒ 本片沒貼過(或已經還原過)⇒ 停下, 不要亂動';
  END IF;
  IF NOT (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '還原前置閘:現行 search_path 不是空字串 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;
END
$pre$;

-- ── 2. 先建回三參數版(原文;它自己帶 SET search_path TO '')────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(p_receipt_id uuid, p_actor text, p_request_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ── 3. 再把四參數版刪掉(順序:先建回、再刪新的 ⇒ 中間不會有一刻叫不到函式)──
DROP FUNCTION IF EXISTS public.admin_delete_item_receipt(uuid, text, text, text);

-- ── 4. 權限:重建的是一支【新函式】, 出生自帶 anon EXECUTE ⇒ 兩道都要 ────────
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_item_receipt(uuid, text, text) TO service_role;

-- ── 5. 事後閘 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE v_oid oid;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '還原事後閘:三參數版沒建回來';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:四參數版還在 ⇒ 兩支並存會 ambiguous';
  END IF;
  -- 🔴 這一格守的是本檔最怕的失敗:還原順手把 09-05 的加固解開
  IF NOT (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '還原事後閘:search_path 不是空字串(實際 = %) ⇒ 加固被解開了',
      (SELECT pg_catalog.array_to_string(proconfig, ' | ') FROM pg_catalog.pg_proc WHERE oid = v_oid);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '還原事後閘:不是 SECURITY DEFINER 了';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原事後閘:anon 拿得到 EXECUTE';
  END IF;
END
$post$;

COMMIT;
