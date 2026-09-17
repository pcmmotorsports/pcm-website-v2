-- 20260917120000_m4b_delete_item_receipt_reason.sql
-- 撤銷到貨要留「為什麼」—— `admin_delete_item_receipt` 加一個【選填】的 `p_reason`。
--
-- plan:`docs/plans/2026-09-17-receipt-undo-reason-plan.md`(Sean 2026-09-17 早上拍「丙 = 你們覺得對就做」)
--
-- ══ 🔴 這支函式在【活的庫】是什麼樣子 —— 我是這樣拿到的,不是從 migration 抄的 ══════════
--   printf '%s\n' "SELECT pg_catalog.pg_get_functiondef(
--     'public.admin_delete_item_receipt(uuid,text,text)'::regprocedure);" > /tmp/q.sql
--   bash scripts/readonly-prod-sql.sh /tmp/q.sql
--   ⇒ prosecdef = t · proconfig = {"search_path=\"\""} · 3 個參數
--
-- 🔴🔴 **`SET search_path = ''`,不是 `public, pg_temp`** ——
--    `20260810233000:288`(這支的唯一一代)寫的是 `public, pg_temp`,而**活的庫不是**。
--    2026-09-05 的 `M1a`/`M1b` 用
--      `EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', r.sig, '')`
--    把 20 支 SECURITY DEFINER 鎖成空字串(Sean 2026-09-05 批「甲」)。
--    ⇒ 函式名在**執行期**才長出來 ⇒ `scripts/latest-definition-of.sh` **在結構上看不見那次改動**。
--    🛑 **所以照 migration 抄 + `CREATE OR REPLACE` = 靜靜把那次資安加固解開**,
--       而 diff 看起來只是「照抄舊定義」。本檔 plan §3② 原本就是這樣寫錯的, 已更正。
--    ⇒ 📌 **本檔的函式本體是 `pg_get_functiondef` 撈下來的原文**, 只動了下面那四處。
--
-- ══ 🔵 我動了哪四處(其餘逐字未改)══════════════════════════════════════════════
--   ① 簽章加 `p_reason text DEFAULT NULL`
--   ② DECLARE 加 `v_reason text;`
--   ③ `v_req` 正規化之後,用**同一組字元集**正規化 `p_reason`(空 ⇒ NULL、超過 500 字截斷)
--   ④ 稽核 INSERT 的第 6 欄 `reason`:硬寫死的 `NULL` ⇒ `v_reason`
--
-- ══ 🔴 為什麼是 `DEFAULT NULL` ═══════════════════════════════════════════════
--   CLAUDE.md〈Git〉逐字:「改既有函式的簽章(加/減參數)⇒ **兩個方向都有空窗**:
--   板先貼 ⇒ 舊碼叫不動(PGRST202);碼先推 ⇒ 新碼叫不動。」
--   ⇒ `DEFAULT NULL` 讓**舊碼不送這個參數也叫得動** ⇒ 板可以先貼。
--   ⚠️ 它只避開空窗,**不免除**「板與碼當同一次動作、中間時間壓到最短」那條。
--
-- ══ 🛑 貼這支的人 ══════════════════════════════════════════════════════════
--   **施工窗不貼板。** 要 Sean 給編號,由主視窗貼。還原檔:`supabase/rollbacks/20260917120000-rollback.sql`。
--   ⚠️ **絕不對正式庫跑還原檔** —— 演練走拋棄式 PG。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:確認我要改的就是我抄的那一版 ────────────────────────────────
DO $pre$
DECLARE v_def text; v_oid oid;
BEGIN
  -- 🔴 用【3 個參數】那個簽章找 —— 找得到就代表本片還沒貼過。
  v_oid := pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 admin_delete_item_receipt(uuid,text,text) ⇒ 不是庫不對, 就是本片已經貼過 ⇒ 停下';
  END IF;

  -- 🔴🔴 **這一格是本片最承重的一格**:確認活的庫真的是 `search_path=''`。
  --    若它是 `public, pg_temp`, 代表 09-05 那次鎖【不在這個庫】⇒ 我下面整支帶著 `''` 重貼
  --    會把一個沒有被加固過的庫**變成加固過的**, 而那是另一件事、要另外拍板。
  -- 🔴 那個字面是 `search_path=""`(**帶兩個雙引號**), 不是 `search_path=`。
  --    本檔第一版寫成不帶引號 ⇒ **這一格會恆紅、整支永遠貼不上**。
  --    實測(唯讀正式庫):`proconfig @> ARRAY['search_path=""']` ⇒ t;`ARRAY['search_path=']` ⇒ f;
  --    原值印出來是 `search_path=""`。📌 **字面要量, 不要照記得的寫。**
  IF NOT (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '前置閘:活的庫的 search_path 不是空字串(實際 = %) ⇒ 與我抄的那一版不符 ⇒ 停下',
      (SELECT pg_catalog.array_to_string(proconfig, ' | ') FROM pg_catalog.pg_proc WHERE oid = v_oid);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '前置閘:活的庫這支不是 SECURITY DEFINER ⇒ 與我抄的那一版不符 ⇒ 停下';
  END IF;

  v_def := pg_catalog.pg_get_functiondef(v_oid);
  -- 🔴 **正對照**:舊那行硬寫死的 NULL 必須【在】—— 不在就代表有人已經動過。
  -- 🔴 錨帶換行 + 縮排:`pg_get_functiondef` **會把註解一起吐回來**, 裸字串會比到我自己寫的說明
  --    (那個教訓是 `20260916210000` 事後閘②當場抓到的, 這裡直接套用)。
  IF pg_catalog.strpos(v_def, E'\n    NULL, NULL, v_req, ''admin'');') = 0 THEN
    RAISE EXCEPTION '前置閘:稽核 INSERT 那行不是我抄的那一版(找不到硬寫死的 reason=NULL)⇒ 有人先動過 ⇒ 停下, 不要盲蓋';
  END IF;
  -- 🔴 再釘一格:`v_ws` 那組字元集在 ⇒ 證明我抄的是【帶正規化的那一代】不是更早的。
  IF pg_catalog.strpos(v_def, 'v_ws constant text') = 0 THEN
    RAISE EXCEPTION '前置閘:現行定義裡沒有 v_ws 字元集 ⇒ 庫裡是更早的一代 ⇒ 停下';
  END IF;
END
$pre$;

-- ── 2. 函式(整支重貼;本體是 pg_get_functiondef 的原文, 只動檔頭列的那四處)──────
CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(
  p_receipt_id uuid,
  p_actor      text,
  p_request_id text,
  -- 🔴 **`DEFAULT NULL` 是唯一避得開部署空窗的寫法**(CLAUDE.md〈Git〉逐字:改簽章兩個方向都有空窗)。
  --    舊碼不送這個參數照樣叫得動 ⇒ 板可以先貼。⚠️ 它只避開空窗,不免除「板與碼當同一次動作」。
  p_reason     text DEFAULT NULL
)
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
  v_reason   text;
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

  -- 🔵 **`p_reason` 是【選填】的**(2026-09-17;而後台稽核頁上線的文案自己寫著「『為什麼』是選填的」
  --    ⇒ 改成必填會與已經見客的字面矛盾)。⇒ **不填 ⇒ NULL,不是空字串。**
  -- 🔴 正規化與上面兩欄**逐字同一組字元集** —— 不同的正規化會讓同一個字串在兩支得到相反結論
  --    (那正是 `v_ws`/`v_zw` 當初被抄過來的理由,寫在本檔 DECLARE 區)。
  -- 🔴 **純空白 / 純零寬 ⇒ 去掉之後是空 ⇒ 存 NULL**:稽核頁把 NULL 印成「—」,
  --    而存一個空字串會讓那一欄印出「什麼都沒有」而不是「沒有填」—— 那是兩件事。
  -- 🔴 **不要寫 `pg_catalog.coalesce(...)`** —— `COALESCE` 是 SQL **語法**不是函式,
  --    加了 schema 前綴會 `function pg_catalog.coalesce(text, unknown) does not exist`。
  --    (2026-09-17 拋棄式 PG 首跑當場炸;同一族的還有 `position(x in y)` / `substring(x from a)`。)
  --    ⇒ 這裡根本不需要 coalesce:`btrim(NULL, …)` 本來就回 NULL。
  v_reason := pg_catalog.btrim(p_reason, v_ws || v_zw);
  IF v_reason IS NULL OR v_reason = '' THEN
    v_reason := NULL;
  ELSIF pg_catalog.char_length(v_reason) > 500 THEN
    -- 🛑 **截斷,不是拒收**:理由欄是選填的輔助資訊,不該讓一段太長的字把整個撤銷擋掉。
    --    500 與 `admin_audit_log.reason` 無關(該欄無長度限制)—— 它是【畫面可讀】的上限。
    v_reason := pg_catalog.substr(v_reason, 1, 500);
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
    -- 🔴 第 5 欄 `after` 仍是 NULL(刪除沒有 after-image);**第 6 欄 `reason` 從硬寫死的 NULL
    --    換成 `v_reason`** —— 那一欄從 2026-07-12 建表就在, 而這條路一直送 NULL。
    NULL, v_reason, v_req, 'admin');

  RETURN 'DELETED';
END
$function$;

-- ── 3. 🔴 把舊的三參數版 DROP 掉 ────────────────────────────────────────────
-- 🔴🔴 **這一段不是我一開始就寫的 —— 是事後閘②在拋棄式 PG 上【當場抓到的】。**
--    我原本以為「加一個帶 DEFAULT 的參數」是 `CREATE OR REPLACE` 同一支;
--    **實際上簽章不同 = PostgreSQL 當成另一支** ⇒ 貼完之後【兩支並存】
--    ⇒ 用三個參數呼叫會 **ambiguous** ⇒ 後台整條撤銷路當場斷掉。
--    ⇒ 📌 **而它在 diff 上完全看不出來** —— 我只多寫了一個參數。
-- 🔵 **DROP 掉舊的不會害舊碼叫不動**:新版第四個參數有 `DEFAULT NULL`
--    ⇒ 只送三個參數照樣命中新版。那正是 `DEFAULT` 買到的東西。
-- ⚠️ 順序:先建新的、再刪舊的,而且在**同一個交易**裡 ⇒ 外面看不到中間那個兩支並存的瞬間。
DROP FUNCTION IF EXISTS public.admin_delete_item_receipt(uuid, text, text);

-- ── 4. 權限:換簽章 = 一支【新函式】, 它出生自帶 anon EXECUTE ──────────────────
--    做法見 `docs/patterns/revoking-function-execute-in-supabase.md`。
--    🔴 兩道都要:先 REVOKE PUBLIC(ACL 為 NULL 時 PUBLIC 看不見, 所以一定要明寫), 再 GRANT。
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_item_receipt(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_item_receipt(uuid, text, text, text) TO service_role;

-- ── 5. 事後閘:貼完之後【自己證明】它變成我要的樣子 ──────────────────────────
DO $post$
DECLARE v_oid oid; v_def text; v_old oid;
BEGIN
  -- ① 新簽章存在
  v_oid := pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '事後閘①:四參數版不存在 ⇒ 沒貼成功';
  END IF;

  -- ② 🔴 **舊的三參數版【必須不見】** —— `CREATE OR REPLACE` 加了 `DEFAULT` 參數是
  --    **改同一支**還是**多出一支**, 取決於 PostgreSQL 怎麼判 ⇒ 這裡不推, 直接量。
  --    🛑 若兩支同時在, 呼叫 `admin_delete_item_receipt(uuid,text,text)` 會 ambiguous ⇒ 整條路斷掉。
  --    🔴 **這一格【真的叫過一次】**(2026-09-17 拋棄式 PG 首跑)—— 它就是上面第 3 段存在的理由。
  v_old := pg_catalog.to_regprocedure('public.admin_delete_item_receipt(uuid,text,text)');
  IF v_old IS NOT NULL AND v_old <> v_oid THEN
    RAISE EXCEPTION '事後閘②:舊的三參數版還在, 而且與新版不是同一支 ⇒ 兩支並存會 ambiguous ⇒ 這個交易要 rollback';
  END IF;

  -- ③ 🔴 search_path 仍是空字串(本片最怕的失敗:順手把加固解開)
  IF NOT (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '事後閘③:貼完之後 search_path 不是空字串(實際 = %) ⇒ 09-05 的加固被解開了',
      (SELECT pg_catalog.array_to_string(proconfig, ' | ') FROM pg_catalog.pg_proc WHERE oid = v_oid);
  END IF;

  -- ④ 仍是 SECURITY DEFINER
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '事後閘④:貼完之後不是 SECURITY DEFINER 了';
  END IF;

  -- ⑤ 稽核 INSERT 真的在寫 v_reason(而不是我改了簽章卻忘了接上)
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_def, E'\n    NULL, v_reason, v_req, ''admin'');') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:稽核 INSERT 沒有在寫 v_reason ⇒ 參數收了卻沒落地 = 做了等於沒做';
  END IF;

  -- ⑥ 🔴 **反面**:硬寫死的那行必須【不在了】。少這一格的話, 一支「兩行都在」的
  --    畸形定義會讓⑤通過(⑤只證明新行在, 不證明舊行不在)。
  IF pg_catalog.strpos(v_def, E'\n    NULL, NULL, v_req, ''admin'');') > 0 THEN
    RAISE EXCEPTION '事後閘⑥:硬寫死 reason=NULL 那行還在 ⇒ 舊行沒被換掉';
  END IF;

  -- ⑦ anon / authenticated 不得有 EXECUTE
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑦:anon 或 authenticated 還拿得到 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑦:service_role 拿不到 EXECUTE ⇒ 後台會整條路壞掉';
  END IF;
END
$post$;

COMMIT;

-- ⚠️ 貼完之後主視窗順手跑一次 `pcm_acl_approve_latest`(Sean 2026-09-14 拍甲)。
-- ⚠️ 而 PostgREST 的 schema cache 要刷新才看得到新簽章:`NOTIFY pgrst, 'reload schema'`。
