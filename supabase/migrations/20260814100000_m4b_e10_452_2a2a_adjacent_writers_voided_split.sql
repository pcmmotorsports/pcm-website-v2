-- ============================================================
-- #452 片 2a-2「甲」:兩個相鄰 writer 的 voided 分流
--   (A5a admin_upsert_item_procurement / admin_record_item_receipt)
-- ============================================================
-- 上游 plan = docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md(C 案瘦身版 v3)
-- 前一片 = 2a-1 schema `20260813120000`(已 apply 正式庫;台帳 supabase/APPLIED.tsv:187)
--
-- 🔴 **這支必須排在「乙」(void RPC)之【前】apply,順序承重、不是偏好。**
--   理由(plan §3.3 R1 MF-8):`supabase db push` 一次送多支,但**每支各自 commit**。
--   若 void RPC 先 commit、本支後 commit,中間就是「已經有 voided 列、而相鄰 writer 不認得」的
--   **真實存在的洞**(不是理論窗口)。
--   反過來安全的原因:在還沒有任何 voided 列之前,本支的兩個分流是**惰性的、零行為改變**
--   (2a-1 收工驗收 6e 觀察到全表 voided_at 皆為 NULL)⇒ 先上零風險。
--   ⇒ 「乙」那支的前置閘會偵測本支的字面,偵測不到就 RAISE 拒 apply。**那道閘是順序被遵守的唯一證明。**
--
-- 🔴 **應用層要比本支更早上線**(plan §3.1;這【不】違反 memory
--   `feedback_app-layer-must-not-ship-before-migration-apply`,請逐字讀完再改):
--   那條 memory 講的是「app 呼叫一個還不存在的東西」(08-07 A9h 正式站壞約 8 小時)。三種形狀要分開:
--     ① 後上的那半還不存在、先上的那半會**呼叫**它            → 先上的壞(= A9h)
--     ② 先上的那半**改變了**後上那半正在讀的形狀              → 後上的壞
--     ③ 先上的那半只是「**多接受一種輸入**」,而此刻沒有人會產生那種輸入 → 零風險(= 本例)
--   ⇒ 判準不是「哪一層」,是「**誰依賴誰還不存在的東西**」。
--   本例 app 只是放寬它接受的碼集,在 RPC 還不會吐 `PROCUREMENT_VOIDED` 之前**完全惰性**;
--   反過來(migration 先上)⇒ RPC 開始吐新碼、app 不認得
--   ⇒ 走 receipt-repository.ts 的「回傳非預期碼」⇒ **員工看到「系統狀態異常」**。
--
-- ── 本支改什麼(兩處,各一行實質變更)────────────────────
--   1. A5a 的存在性查詢加 `AND voided_at IS NULL`
--      ⇒ 已作廢列**視同不存在**、走新建路徑(Sean 2026-08-14 Q-S1=A 逐字:
--        「當成全新的一筆收下來,舊的作廢紀錄留著查帳」)。
--      ⇒ 撞鍵靠 partial unique index(`WHERE voided_at IS NULL`,20260813120000:377-381)。
--      🔴 **回傳碼零變動**:走新建 = `CREATED`,**已在既有 17 碼窮盡集裡**
--        (apps/admin/src/lib/orders/procurement-repository.ts:17)⇒ A5a 側應用層零改動。
--   2. `admin_record_item_receipt` 加「已作廢不得登錄到貨」,新碼 `PROCUREMENT_VOIDED`。
--      🔴 位置排在**冪等快篩之後**(該函式 :118-126 自己立的規則逐字:
--        「凡是讀『會在兩次呼叫之間改變的狀態』的守門,都必須排在冪等判斷之後」)。
--      🔴 **不得依賴 C5(oiqs_instock_le_ordered)兜底** —— C5 比的是品項層聚合,
--        兄弟採購列撐著 ordered 時**不會發作** ⇒ 那筆到貨靜默掛在已作廢的採購上。
--        **會撞的至少會停下來,不會撞的是靜默的壞資料。**
--
-- ── 🔴 為什麼函式體是「程式抽取 + 程式改寫」而不是手抄 ──────
--   兩支函式體合計約 680 行。手抄無法用肉眼驗 byte-equal,而抄錯一個字元就是靜默的行為改變。
--   做法:`pg_get_functiondef` 抽現行定義 → 腳本做外科替換(錨點**必須恰命中 1 次**否則中止)
--         → `diff` 證明只動了預期那幾行 → 貼進本檔。
--   ⇒ 本檔的函式體與 apply 前的正式庫定義,除了下列**四處**之外逐字相同:
--       ① A5a 存在性查詢 +`AND voided_at IS NULL`(含說明註解)
--       ② receipt 步 6b 的作廢分流(含說明註解)
--       ③ A5a `unique_violation` 分支的**註解**:原句「本表無 DELETE writer ⇒ 不會再空手」
--          在邏輯刪除之後是假的,已改寫成真話(**只動註解,邏輯未變**)
--       ④ A5a 防衛枝的 **RAISE 訊息**:拿掉「請重新送出」(與 UI 的「不要重複按送出」矛盾)
--          + 補「為什麼不給可重試碼」的註解(Q-D5=A)
--   ⚠️ **原句寫「除了上面標註的【兩處】之外逐字相同」—— 那是假的**(codex R2 nit,對):
--      ③④ 是我折 R1 時改的,改完沒回來更新這一句。**「宣稱大於事實」在同一份檔裡第二次。**
--
-- ── 誠實邊界 ────────────────────────────────────────────
--   · 本檔的前置閘 P3 釘 `md5(pg_get_functiondef(...))` 指紋。
--     ⚠️ `pg_get_functiondef` 的輸出格式**理論上**可能隨 PG 版本異 ⇒ 指紋可能非真漂移而紅
--     (plan §7 G5;本機只有 PG 17.10 一個版本,構造不出第二個版本的輸出)。
--     紅了先比對 `pg_get_functiondef` 全文再判,不要直接改指紋。
--   · 🔴🔴 **本檔【有】「零筆被作廢」前置閘 = P5(見下方 P5 段),而且它是刻意的。**
--     **撞到 P5 的 RAISE ⇒ 停下回報 Sean。不要刪它、不要繞過它。**
--
--     ⚠️ **本行原本寫的是相反的話**(「本檔不設那道閘 … 設了只會在最需要修的時候擋住修」),
--        而下方 P5 又真的設了 ⇒ **同一份檔自相矛盾,且方向會害值班的人主動刪掉一道真的閘**
--        (`code-reviewer` 2026-08-14 M1,對;可達性 = 讀檔即達)。**已改到同向。**
--     🔴 兩者的差別是**方向,不是嚴重度**:
--       - 「設閘會擋住修」那句對的是 **down(回退)** —— 2a-2 的回退零資料損失,
--         在那裡設「零 voided 列」閘 = 出事時關不掉功能(plan §4.2 的 fail-DANGEROUS 段,**仍然成立**)。
--       - 本檔是 **forward(前推)**,P5 擋的是**另一件事**:R3 抓到的「編輯表單用作廢資料
--         覆寫生效列」那條路徑,其**不可達性的唯一支柱**就是「正式庫零 voided 列」。
--     ⇒ **前推設、回退不設。** 這不是不一致,是兩個方向的代價相反。
--   · CREATE OR REPLACE **保留既有 ACL**(不同於 DROP+CREATE)⇒ **本檔(前推)**不重發 GRANT,改成**斷言**。
--     🔴 **但回退不適用**:A5a 的前身是 `CREATE FUNCTION`(`20260806200000:79`)、不是 `OR REPLACE`
--        ⇒ **回退是 DROP+CREATE ⇒ ACL 不會保留** ⇒ 回退腳本**必須一併帶 GRANT**
--        (`code-reviewer` 2026-08-14 nit 5 抓到的非顯然點)。見 `scripts/452a-down.sql`。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 前置閘(任一不符 ⇒ 整支回滾)────────────────────────
DO $gate$
DECLARE
  v_cnt integer;
  v_def text;
BEGIN
  -- P1. 2a-1 已 apply:兩個作廢欄在
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND attname IN ('voided_at', 'void_reason')
     AND NOT attisdropped;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P1:order_item_procurement 應有 voided_at + void_reason 兩欄(實 % 欄)⇒ 2a-1 未 apply 或已回退;拒繼續', v_cnt;
  END IF;

  -- P2. 業務鍵已是 **partial** unique index(2a-1 換的形狀)
  --     🔴 這道閘同時是 A5a 新述詞的正當性:沒有 partial 述詞,作廢列與新列就不能同鍵共存,
  --        「視同不存在、走新建」會當場撞 23505。
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.order_item_procurement'::regclass
     AND c.relname  = 'order_item_procurement_business_key'
     AND i.indisunique;
  -- 🔴 **逐字全等比對,不是子字串**(codex 2026-08-14 對抗審查 must-fix,對):
  --    只查子字串的話,`WHERE (voided_at IS NULL AND false)` 這種**恆假**述詞也會通過
  --    ⇒ 該索引等於不存在 ⇒ 同鍵可以有多筆 active 列 ⇒ A5a 的 `FOR UPDATE` 會隨機鎖到其中一筆、
  --      而 `SELECT * INTO` 只吃第一列 ⇒ 靜默改錯列。**這道閘是新述詞正當性的唯一來源,必須從嚴。**
  IF v_def IS DISTINCT FROM
     'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_id) WHERE (voided_at IS NULL)' THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P2:業務鍵索引定義與預期不【逐字】相符,實 [%];拒繼續',
      coalesce(v_def, '<不存在>');
  END IF;

  -- P3. 兩支相鄰 writer 的指紋 = apply 前的預期版本(有人在中間改過 ⇒ 停)
  IF md5(pg_catalog.pg_get_functiondef(
        'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure))
     <> 'a857c2816ec94c9786d2389814e8328c' THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P3a:A5a 現行定義指紋與預期不符(有人在 2a-1 之後改過它)⇒ 先比對 pg_get_functiondef 全文再判,不要直接改指紋;拒繼續';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef(
        'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure))
     <> '0505808ae60571ef8cd238283f32b210' THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P3b:admin_record_item_receipt 現行定義指紋與預期不符 ⇒ 同上;拒繼續';
  END IF;

  -- P4. void RPC **尚未**存在(本支必須先上;乙那支的前置閘會反過來偵測本支)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P4:偵測到 admin_void_item_procurement 已存在(% 支)⇒ 乙先於甲上線 = 順序被違反,中間有「已有 voided 列而相鄰 writer 不認得」的洞;拒繼續', v_cnt;
  END IF;

  -- P5. 🔴🔴 **正式庫必須零 voided 列** —— 這道閘不是形式,它是一條【資料損壞路徑不可達】的唯一支柱。
  --
  --   路徑(R3 換模型換角度抓到,2026-08-14;主視窗已開檔複核兩處):
  --     Q-S1=A 允許同鍵兩列(一作廢一生效)
  --     × `SupabaseOrderAdapter.ts` 的 ADMIN_ORDER_DETAIL_SELECT **沒有投影 voided_at、無 filter 無 order**
  --     × `procurement-view.ts` 的 hydrateFormValues = `find(p => p.supplierId === …)` **取第一筆**
  --     ⇒ 員工開該供應商的採購編輯表單,可能 hydrate 出**作廢那列**的舊值,按儲存後
  --        A5a(本片改的)會跳過作廢列、命中**生效列** ⇒ **把舊資料寫進新列**。
  --        零錯誤、零固定碼、稽核看起來正常 = **靜默資料損壞**。
  --
  --   🔴 本片之所以**仍可安全上線**,唯一理由是「正式庫零 voided 列 ⇒ find() 只可能命中一列」。
  --      而那句話**今天成立不代表 apply 當天成立**(人工 SQL 改過資料就有;
  --      memory `project_0812-sean-order-ui-workflow-and-undo-needs` 逐字:採購撤銷現行唯一救濟 = 手動 SQL)。
  --   ⇒ 這道閘把「不可達」從**假設**變成 **apply 當天的觀察**。
  --   ⚠️ **查到非 0 ⇒ 停下回報 Sean,不得自行判斷「應該沒關係」** —— 非 0 代表上面那條路徑此刻已可達。
  --   ⚠️ 這道閘只在**前推**方向設;down 腳本**不設**(2a-2 的回退零資料損失,
  --      在那裡設同一道閘 = 出事時關不掉功能,見 plan §4.2 的 fail-DANGEROUS 段)。
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement WHERE voided_at IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 前置閘 P5:本表已有 % 筆 voided 列。本片的安全性依賴「零 voided 列」(否則採購編輯表單會用作廢資料覆寫生效資料,見上方註解)⇒ 停下回報 Sean,不要自行放行;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE '452-2a2甲 前置閘 P1-P5 全過(P5:正式庫零 voided 列,= 編輯表單覆寫路徑不可達的觀察)。';
END
$gate$;

-- ── 1. A5a:存在性查詢加 voided 分流 ──────────────────────
-- 🔴 以下函式體 = apply 前正式庫定義的逐字複製,唯一變更 = 標了 `#452 片 2a-2` 的那段註解
--    與 `AND voided_at IS NULL` 一行。抽取與改寫皆由程式完成(見檔頭)。
CREATE OR REPLACE FUNCTION public.admin_upsert_item_procurement(p_order_item_id uuid, p_supplier_id uuid, p_allocated_quantity integer, p_reply_status text, p_contact_channel text, p_submitted_at timestamp with time zone, p_supplier_order_no text, p_exception_reason text, p_expected_arrival_date date, p_actor text, p_request_id text, p_preserve_optional_fields boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 S2 / A6 / tier RPC 的 v_ws;31 字元自檢在下)
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';

  -- 「肉眼全白但不屬 [[:space:]]」碼位(A6 v_body_zw 同一組;7 字元自檢在下)。
  -- A2 的單號 CHECK 只擋前四種(20260729020000:100)⇒ 本片對三個文字欄一律擋七種。
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  -- 上限:單號/管道對齊 S2 的 actor 級距;異常原因是敘述欄、給 500。
  -- 沒有上限的話 text 塞得下 MB 級字串,列表與稽核 log 一起遭殃。
  v_text_max   constant integer := 200;
  v_reason_max constant integer := 500;

  v_actor    text;
  v_req      text;
  v_channel  text;
  v_order_no text;
  v_reason   text;

  -- A9h-M:那四欄「本次實際會寫入的值」。單一來源 —— 同值比較 / 更新 / 新建 / 稽核四處共用。
  v_eff_submitted_at  timestamptz;
  v_eff_order_no      text;
  v_eff_reason        text;
  v_eff_expected_date date;

  v_before   public.order_item_procurement%ROWTYPE;
  v_exists   boolean;
  v_active   boolean;
  v_row_id   uuid;
  v_stamp    timestamptz;
  v_result   text;
  v_retry    boolean;
  v_con      text;
  v_try      integer;
BEGIN
  -- 0. 常數自檢(字面漂移 ⇒ 全函式拒用、fail-loud;S2/A6 同款)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: v_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 0. 隔離閘:非 read committed 一律拒收(理由見基底檔頭)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A5a 隔離閘:本 RPC 僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a5a_isolation_read_committed_only';
  END IF;

  -- 步 0b. 把兩支 constraint trigger 拉回 immediate(理由與兩個副作用見基底檔頭)
  SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac,
                  public.order_item_procurement_summary_recompute_zc IMMEDIATE;

  -- 步 1. actor / request_id(RAISE 面;先剝、後驗 —— 與下方文字欄同一順序,照 S2 R3 修正)
  -- 🔴 寫進稽核的是**剝過空白**的值:正因為有剝,'alice ' 與 'alice' 才會收斂成同一個 actor;
  --    不剝才會分裂成兩個操作者、'req-1 ' 與 'req-1' 拆成兩條追蹤鏈。
  -- 🔴 剝的字元集 = v_ws || v_zw:v_ws 不含 U+2800 / U+3164 / U+00AD ⇒ 只用 v_ws 的話
  --    「肉眼看起來是空白」的 actor 進得了稽核表。
  -- 🔴 不加 staff slug regex(與 A6 不同):本片寫入的採購表沒有 actor 欄,稽核表只有 nonempty
  --    CHECK(20260712210000:55)⇒ 加了會宣稱大於事實。
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws || v_zw);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > v_text_max OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: actor 非法';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws || v_zw);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > v_text_max OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: request_id 非法';
  END IF;

  -- 步 1n. A9h-M:保留旗標本身不得為 NULL(RAISE 面)。
  -- 🔴 **三值邏輯的靜默降級**(SOP 階段 C code-reviewer MF1):旗標為 NULL 時
  --    下方步 1p 的 `NULL AND (…)` 與步 11p 的 `NULL AND v_exists` **都不成立**
  --    ⇒ 矛盾閘不發火、又走 ELSE 枝取參數 ⇒ 批次送的四個 NULL 直接把現值清掉,
  --    **零錯誤、零固定碼、稽核 after 記 NULL 與資料列一致 = 完全靜默**
  --    —— 本片要修的病原樣復發,只是換一個觸發方式。
  -- 🔴 本函式對每一個可為 NULL 的入口都 fail-closed(actor / 兩個鍵 / allocated / reply)
  --    ⇒ 這支旗標沒有理由例外。今日 TS 端型別是必填 boolean,但 A9h-2 coordinator 尚未寫、
  --    且 PostgREST 直呼構造得出來 ⇒ 不靠呼叫端自律。
  IF p_preserve_optional_fields IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 保留旗標不得為 NULL(三值邏輯會讓它靜默降級成不保留、清掉現值)';
  END IF;

  -- 步 1p. A9h-M:preserve 矛盾意圖(RAISE 面;Sean 2026-08-06 Q1=A)。
  -- 🔴 preserve=true 的語意 = 「本次呼叫**沒有**那四欄的入口」(A9h 批次)。
  --    同時又送值 = 呼叫端自相矛盾。靜默丟棄會變成「送了值沒寫入、稽核也看不到」
  --    ⇒ 與「靠參數 NULL 分流的 upsert RPC 會靜默降級」同族 ⇒ fail-loud、不新增固定碼。
  -- 🔴 比對**原始參數**而非正規化後的值(正規化在步 5-7、排在本步之後):刻意從嚴,
  --    理由見檔頭誠實邊界。
  -- 🔴 排在鍵/數量檢查之前:RAISE 面比固定碼面更響,呼叫端 bug 要當場可見。
  IF p_preserve_optional_fields
     AND (p_submitted_at IS NOT NULL
          OR p_supplier_order_no IS NOT NULL
          OR p_exception_reason IS NOT NULL
          OR p_expected_arrival_date IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 保留模式下不得同時提供 submitted_at / supplier_order_no / exception_reason / expected_arrival_date(呼叫端矛盾意圖)';
  END IF;

  -- 步 2. 兩個鍵
  IF p_order_item_id IS NULL OR p_supplier_id IS NULL THEN
    RETURN 'INVALID_INPUT';
  END IF;

  -- 步 3. 訂購數量(鏡像 A2 的 allocated_range;NULL 不默認)
  IF p_allocated_quantity IS NULL
     OR p_allocated_quantity < 1 OR p_allocated_quantity > 100000 THEN
    RETURN 'INVALID_ALLOCATED';
  END IF;

  -- 步 4. 回覆狀態(鏡像 A2 的 allowlist;NULL 不默認成 no_reply —— 呼叫端漏送欄位要當場可見)
  IF p_reply_status IS NULL
     OR p_reply_status NOT IN ('no_reply', 'confirmed', 'price_changed', 'out_of_stock', 'partial') THEN
    RETURN 'INVALID_REPLY_STATUS';
  END IF;

  -- 步 5-7. 三個文字欄:先正規化(剝 v_ws → 肉眼全空即 NULL)、再驗。
  -- 🔴 三欄都要剝:單號有 A2 的 regex CHECK 當後盾(漏剝會紅),管道與異常原因只有
  --    `btrim(x) <> ''`(對 ' LINE ' 放行)⇒ 漏剝時 DB 不會紅,但乾淨值重放會被判成「有差異」
  --    ⇒ 回 UPDATED 而非 NO_CHANGE = A9h 冪等靜默破功。
  v_channel := pg_catalog.btrim(p_contact_channel, v_ws);
  IF v_channel IS NOT NULL
     AND pg_catalog.regexp_replace(pg_catalog.translate(v_channel, v_zw, ''), '[[:space:]]', '', 'g') = '' THEN
    v_channel := NULL;
  END IF;
  IF v_channel IS NOT NULL
     AND (pg_catalog.char_length(v_channel) > v_text_max OR v_channel ~ '[[:cntrl:]]') THEN
    RETURN 'INVALID_CONTACT_CHANNEL';
  END IF;

  -- 步 5p. A9h-M:保留模式下**聯絡管道必填**(Sean 2026-08-06 拍板,推翻本檔原案)。
  -- 🔴 為什麼要在 DB 層擋(而不是只靠批次 UI 必填):`contact_channel` 刻意**不在**保留集合裡
  --    (它是批次共用欄、員工會選)⇒ 批次漏送它就會**靜默清掉各列既有的管道**
  --    —— 與本片要修的那四欄是**同一種病、只是換一欄**。UI 必填擋不住 PostgREST 直呼與
  --    日後的 coordinator bug,而症狀同樣是零錯誤零固定碼。
  -- 🔴 位置在**正規化之後**(不同於步 1p 比對原始參數):拍板字面是「正規化後 NULL ⇒ RAISE」
  --    ⇒ 送 '   ' 這種肉眼全空的字串在這裡已收斂成 NULL、照樣擋下。
  -- 🔴 只在 preserve=true 下成立:單列表單(preserve=false)本來就可以把管道清空,不受影響。
  IF p_preserve_optional_fields AND v_channel IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_item_procurement: 保留模式下聯絡管道必填(留空會靜默清掉各列既有管道)';
  END IF;

  v_order_no := pg_catalog.btrim(p_supplier_order_no, v_ws);
  IF v_order_no IS NOT NULL
     AND pg_catalog.regexp_replace(pg_catalog.translate(v_order_no, v_zw, ''), '[[:space:]]', '', 'g') = '' THEN
    v_order_no := NULL;
  END IF;
  -- 逐條鏡像 A2 的 supplier_order_no CHECK(20260729020000:95-102)+ 擴充到七種隱形字:
  -- 這一欄的等值搜尋是 A9b2 的讀取路徑,混一個看不見的字元就查不到單。
  IF v_order_no IS NOT NULL
     AND (pg_catalog.char_length(v_order_no) > v_text_max
          OR v_order_no ~ '[[:cntrl:]]'
          OR v_order_no !~ '^[^[:space:]]([^[:space:]]|.*[^[:space:]])?$'
          OR pg_catalog.translate(v_order_no, v_zw, '') <> v_order_no) THEN
    RETURN 'INVALID_SUPPLIER_ORDER_NO';
  END IF;

  v_reason := pg_catalog.btrim(p_exception_reason, v_ws);
  IF v_reason IS NOT NULL
     AND pg_catalog.regexp_replace(pg_catalog.translate(v_reason, v_zw, ''), '[[:space:]]', '', 'g') = '' THEN
    v_reason := NULL;
  END IF;
  IF v_reason IS NOT NULL
     AND (pg_catalog.char_length(v_reason) > v_reason_max OR v_reason ~ '[[:cntrl:]]') THEN
    RETURN 'INVALID_EXCEPTION_REASON';
  END IF;

  -- 步 8. 送出供應商的時間:兩端皆開區間;未來判定用 clock_timestamp()(交易起始時間在長交易內
  --       會把「現在」誤判成未來)。5 分鐘寬限給裝置時鐘偏移。
  -- 🔴 界的字面**必須帶時區偏移**:不帶偏移的 `TIMESTAMPTZ '2020-01-01'` 是用呼叫端 session 的
  --    TimeZone 解讀 ⇒ 同一個輸入在不同 session 會得到不同判定(本片實測、由 harness I21 逼出來)。
  IF p_submitted_at IS NOT NULL THEN
    IF NOT (p_submitted_at > TIMESTAMPTZ '2020-01-01 00:00:00+00'
            AND p_submitted_at < TIMESTAMPTZ '2100-01-01 00:00:00+00') THEN
      RETURN 'SUBMITTED_AT_OUT_OF_RANGE';
    END IF;
    IF p_submitted_at > pg_catalog.clock_timestamp() + interval '5 minutes' THEN
      RETURN 'SUBMITTED_AT_IN_FUTURE';
    END IF;
  END IF;

  -- 步 9. 預計到貨日:閉區間(date 語意);**未來合法** —— 它就是預期。
  IF p_expected_arrival_date IS NOT NULL
     AND NOT (p_expected_arrival_date >= DATE '2020-01-01' AND p_expected_arrival_date <= DATE '2100-01-01') THEN
    RETURN 'EXPECTED_ARRIVAL_OUT_OF_RANGE';
  END IF;

  -- 步 10. 品項存在性:**普通 SELECT、刻意不鎖**(理由見基底檔頭鎖面段)。
  --        殘餘競態 = 併發刪單;今日零 order_items 刪除 writer、D1c 有零引用前置,
  --        真滑過也只是下方 INSERT 紅在 FK 23503(fail-closed)。
  PERFORM 1 FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RETURN 'ORDER_ITEM_NOT_FOUND';
  END IF;

  -- 步 11. upsert 本體。兩圈:第二圈只在「兄弟交易剛併發首建」時才會走到。
  FOR v_try IN 1..2 LOOP
    -- 🔴 #452 片 2a-2(Sean 2026-08-14 Q-S1=A:「當成全新的一筆收下來,舊的作廢紀錄留著查帳」):
    --    **已作廢的列視同不存在** ⇒ 走新建路徑,不去 UPDATE 一筆已作廢的採購。
    --    不加這個述詞的話:員工對已作廢的供應商重下單 ⇒ 走 UPDATE 路徑改掉那筆【仍是作廢狀態】的列
    --    ⇒ A2b1 因調降/持平早退不守、A4a 的 ordered 軸又已把作廢列扣掉
    --    ⇒ **他以為下了單,訂購數卻一動不動 ⇒ 會一直重下**(2a-1 已觀察,scripts/452-verify.sh B5 格)。
    -- 🔴 撞鍵靠 `order_item_procurement_business_key` 的 **partial** unique index
    --    (`WHERE voided_at IS NULL`,20260813120000:377-381)⇒ 作廢列與新列可以同鍵共存。
    -- 🔴 **這裡刻意【不】取 advisory lock。** 2a-2 曾設計 C1 advisory 來擋 `unvoid × A5a` 的死結,
    --    但 Sean 2026-08-14 拍 Q-452-換路=C(只做作廢、不做取消作廢)⇒ 那條死結的一條邊不存在。
    --    已實測:docs/probes/452-2a2-void-lockprobe.sh 跑四次結果相同(最後一次為現行版本)——
    --    發⓪ 正向對照(unvoid 形狀)40P01=1、發④/發⑤(void × A5a 兩個方向)皆 40P01=0,
    --    且④⑤各有 1 個 session 實卡在 wait_event_type='Lock'(證明真的併發過、不是假綠)。
    SELECT * INTO v_before
      FROM public.order_item_procurement
     WHERE order_item_id = p_order_item_id
       AND supplier_id   = p_supplier_id
       AND voided_at IS NULL
     FOR UPDATE;
    v_exists := FOUND;

    -- 步 11p. A9h-M:那四欄「本次實際會寫入的值」。
    -- 🔴 **單一來源**:底下的同值比較(11a)、更新(11b)、新建(11c)、稽核(12)一律讀這四個
    --    變數 —— 四處各自枚舉參數正是關卡1 F1「漏掉一欄」那條的病根。
    -- 🔴 走 ELSE 枝的兩種情形:preserve=false(= 基底行為,逐字不變),
    --    或列不存在(新建路徑沒有舊值可保留;步 1p 已保證此時那四個參數皆為 NULL)。
    IF p_preserve_optional_fields AND v_exists THEN
      v_eff_submitted_at  := v_before.submitted_at;
      v_eff_order_no      := v_before.supplier_order_no;
      v_eff_reason        := v_before.exception_reason;
      v_eff_expected_date := v_before.expected_arrival_date;
    ELSE
      v_eff_submitted_at  := p_submitted_at;
      v_eff_order_no      := v_order_no;
      v_eff_reason        := v_reason;
      v_eff_expected_date := p_expected_arrival_date;
    END IF;

    -- 步 11a. 同值 no-op:零寫入、零稽核、不動兩個時間戳。
    -- 🔴 位置在供應商閘**之前**:重放一筆已提交的事實是零 DML,供應商後來被停用不改變
    --    「什麼都不寫」的安全性;放在閘之後會讓「建立 → 供應商停用 → A9h 批次重送」
    --    回 SUPPLIER_INACTIVE ⇒ 冪等被狀態轉換擊破。
    -- 🔴 A9h-M M2:比較基準 = effective 值。preserve=true 時那四項退化成自己比自己(恆真)
    --    ⇒ 只有 allocated / reply / channel 的真差異才會讓本次判成「有變更」,
    --    這正是「保留」該有的語意 —— 而不是先判有變更、再把舊值寫回去(那會白推時間戳)。
    IF v_exists
       AND v_before.allocated_quantity    IS NOT DISTINCT FROM p_allocated_quantity
       AND v_before.reply_status          IS NOT DISTINCT FROM p_reply_status
       AND v_before.contact_channel       IS NOT DISTINCT FROM v_channel
       AND v_before.submitted_at          IS NOT DISTINCT FROM v_eff_submitted_at
       AND v_before.supplier_order_no     IS NOT DISTINCT FROM v_eff_order_no
       AND v_before.exception_reason      IS NOT DISTINCT FROM v_eff_reason
       AND v_before.expected_arrival_date IS NOT DISTINCT FROM v_eff_expected_date THEN
      RETURN 'NO_CHANGE';
    END IF;

    -- 步 11g. 供應商閘(Sean Q1=A):**單一落點** —— 走到這裡代表必有寫入企圖。
    --   擋:①新建 ②既有列調升 allocated(兩者皆屬「向停用供應商下新單」)。
    --   放行:既有列的事實記錄欄更新(停用後往往正是要密集記錄「這家怎麼了」的時候)。
    --   🔴 單一落點是刻意的:分散成兩處會讓其中一處被寫成普通 SELECT(TOCTOU)而
    --      B7/B20 這類只跑首建路徑的測試照樣全綠;結構驗收的字面錨釘死「恰一次」。
    IF (NOT v_exists) OR (p_allocated_quantity > v_before.allocated_quantity) THEN
      SELECT s.is_active INTO v_active
        FROM public.suppliers s
       WHERE s.id = p_supplier_id
       FOR SHARE;
      IF NOT FOUND THEN
        -- 有列時 FK 保證供應商存在(RESTRICT + 主檔不可刪)⇒ 本枝實際只有新建路徑可達。
        RETURN 'SUPPLIER_NOT_FOUND';
      END IF;
      IF NOT v_active THEN
        RETURN 'SUPPLIER_INACTIVE';
      END IF;
    END IF;

    IF v_exists THEN
      -- 步 11b. 更新路徑。
      -- 🔴 調降到低於已到貨累計會撞 A2 的 received_range(raw 23514)⇒ 鎖下預檢、給固定碼。
      --    上方取得的採購列鎖與 A4a 的 receipts sync(對同列取較弱的列鎖)互斥
      --    ⇒ 預檢讀到的是鎖下最新提交值,無 TOCTOU。
      IF p_allocated_quantity < v_before.received_quantity THEN
        RETURN 'ALLOCATED_BELOW_RECEIVED';
      END IF;

      v_stamp := pg_catalog.clock_timestamp();
      BEGIN
        UPDATE public.order_item_procurement
           SET allocated_quantity    = p_allocated_quantity,
               reply_status          = p_reply_status,
               contact_channel       = v_channel,
               submitted_at          = v_eff_submitted_at,
               supplier_order_no     = v_eff_order_no,
               exception_reason      = v_eff_reason,
               expected_arrival_date = v_eff_expected_date,
               status_changed_at     = v_stamp
         WHERE id = v_before.id;
      EXCEPTION WHEN SQLSTATE 'P2B01' THEN
        -- 🔴 用 IS DISTINCT FROM 不用 <>:CONSTRAINT_NAME 為 NULL 時 `<>` 判定是 NULL
        --    ⇒ IF 不成立 ⇒ 非目標錯誤被靜默吞成 OVER_ALLOCATION。
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'a2b1_allocation_within_orderable' THEN
          RAISE;
        END IF;
        RETURN 'OVER_ALLOCATION';
      END;

      v_row_id := v_before.id;   -- 稽核 target 不得落 NULL
      v_result := 'UPDATED';
      EXIT;
    END IF;

    -- 步 11c. 新建路徑。
    v_stamp := pg_catalog.clock_timestamp();
    v_retry := false;
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_id, allocated_quantity, reply_status, contact_channel,
         submitted_at, supplier_order_no, exception_reason, expected_arrival_date,
         first_ordered_at, status_changed_at)
      VALUES
        (p_order_item_id, p_supplier_id, p_allocated_quantity, p_reply_status, v_channel,
         v_eff_submitted_at, v_eff_order_no, v_eff_reason, v_eff_expected_date,
         v_stamp, v_stamp)
      RETURNING id INTO v_row_id;
    EXCEPTION
      WHEN SQLSTATE 'P2B01' THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'a2b1_allocation_within_orderable' THEN
          RAISE;
        END IF;
        RETURN 'OVER_ALLOCATION';
      WHEN unique_violation THEN
        -- 兄弟交易併發首建:23505 只會在對方 COMMIT 之後才拋 ⇒ 第二圈的列鎖查詢
        -- 通常看得到那筆已提交的列,走 11a/11b。
        -- 🔴🔴 **#452 片 2a-2 更正:原句「本表無 DELETE writer ⇒ 不會再空手」現在是【假的】。**
        --    (codex 2026-08-14 對抗審查 must-fix,對。)
        --    2a-1 之後 `voided_at` 是一種**邏輯刪除**:列還在,但它離開了 partial unique index
        --    的可見集合 ⇒ 第二圈那條帶 `AND voided_at IS NULL` 的查詢**可以**空手。
        --    可達的交錯(需三個並行動作,罕見但真實):
        --      ①本交易 INSERT 撞 23505(同鍵已有 active 列 R)
        --      ②R 被作廢並提交 ⇒ 第二圈查不到 R
        --      ③另一支 A5a 搶先為同鍵建了新的 active 列並提交
        --      ⇒ 第二圈 INSERT 再撞 23505 ⇒ v_retry := true ⇒ 兩圈用盡 ⇒ 落到下方防衛枝 RAISE。
        --    **為什麼接受、不擴迴圈**:失敗方向是 **fail-closed**(RAISE ⇒ 整筆 rollback,
        --    零錯誤寫入、零資料損失);擴成 N 圈只是把窗口變窄、消滅不了它,
        --    還要重新論證「N 圈夠不夠」。⇒ 維持兩圈,但把真話寫在這裡。
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN
          RAISE;
        END IF;
        v_retry := true;
    END;

    IF v_retry THEN
      CONTINUE;
    END IF;

    v_result := 'CREATED';
    EXIT;
  END LOOP;

  IF v_result IS NULL THEN
    -- 防衛枝:兩圈都沒收斂。
    -- 🔴 **#452 片 2a-2 更正:不再宣稱「理論不可達」** —— 邏輯刪除(voided_at)讓它變成
    --    可達但罕見的三方交錯(見上方 unique_violation 分支的逐條交錯)。fail-closed。
    -- 🔴 **訊息刻意【不】寫「請重新送出」**(Q-D5=A,2026-08-14 主視窗裁;codex R2 抓到的矛盾):
    --    本枝走 `P0001` ⇒ 應用層 `procurement-repository.ts` 把它歸類成 **caller bug**,
    --    UI 對員工說的是「不要重複按送出」。DB 訊息若寫「請重新送出」⇒ **兩句當場打架**,
    --    而員工只會看到 UI 那句。⇒ 訊息只陳述事實,不給與 UI 衝突的指示。
    -- 🔴 **為什麼不給一個可重試的新固定碼**(下一個人看到 P0001 會以為是漏掉,所以寫在這裡):
    --    ①它要再動一次**已凍結的窮盡碼集**(`procurement-repository.ts` 17 碼 + 編譯期守門)
    --    ②開一個新碼只為服務一個**三方競態**,成本與風險大於收益
    --    ③失敗方向是 fail-closed(整筆 rollback、零寫入)⇒ 員工重按一次就會過。
    --    ⇒ 若日後這條在正式站真的出現得夠頻繁,再開碼;屆時 backlog 從本註解起。
    RAISE EXCEPTION 'A5a 防衛枝:upsert 兩圈未收斂(品項 % / 供應商 %)。'
                    '罕見三方交錯:撞鍵→該列被作廢→他人搶先新建。本次未寫入任何東西。',
      p_order_item_id, p_supplier_id;
  END IF;

  -- 步 12. 同交易稽核(恰一句;失敗必往上拋 ⇒ 整筆 rollback,不存在「寫了但沒稽核」)。
  -- 🔴 A9h-M M3:after 記的是 **effective 值**、不是參數 —— 記參數的話,preserve 之後
  --    資料列留著舊值而稽核寫 NULL,兩者當場矛盾(稽核從此不能拿來重建歷史)。
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor,
    CASE WHEN v_result = 'CREATED' THEN 'procurement.create' ELSE 'procurement.update' END,
    'procurement:' || v_row_id::text,
    CASE WHEN v_result = 'CREATED' THEN NULL ELSE pg_catalog.jsonb_build_object(
      'allocated_quantity',    v_before.allocated_quantity,
      'reply_status',          v_before.reply_status,
      'contact_channel',       v_before.contact_channel,
      'submitted_at',          v_before.submitted_at,
      'supplier_order_no',     v_before.supplier_order_no,
      'exception_reason',      v_before.exception_reason,
      'expected_arrival_date', v_before.expected_arrival_date) END,
    pg_catalog.jsonb_build_object(
      'order_item_id',         p_order_item_id,
      'supplier_id',           p_supplier_id,
      'allocated_quantity',    p_allocated_quantity,
      'reply_status',          p_reply_status,
      'contact_channel',       v_channel,
      'submitted_at',          v_eff_submitted_at,
      'supplier_order_no',     v_eff_order_no,
      'exception_reason',      v_eff_reason,
      'expected_arrival_date', v_eff_expected_date),
    NULL,
    v_req,
    'admin'
  );

  RETURN v_result;
END;
$function$

;

-- ── 2. admin_record_item_receipt:已作廢不得登錄到貨(新碼 PROCUREMENT_VOIDED)──
-- 🔴 同上:逐字複製 + 程式外科替換,唯一變更 = 步 6b 那一段。
CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamp with time zone, p_note text, p_actor text, p_request_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- 步 6b. 🔴 #452 片 2a-2:**已作廢的採購不得登錄到貨**。
  --   🔴 位置承重 —— 必須排在步 6 冪等快篩【之後】,理由就是上面那條規則逐字:
  --      「凡是讀『會在兩次呼叫之間改變的狀態』的守門,都必須排在冪等判斷之後」。
  --      `voided_at` 正是那種狀態 ⇒ 排前面的話,「登錄成功 → 採購被作廢 → 合法重放」
  --      會回 PROCUREMENT_VOIDED 而不是 DUPLICATE_REQUEST(= 冪等被狀態轉換擊破)。
  --   🔴 **必須是直接斷言,不得依賴 C5 兜底**:C5(oiqs_instock_le_ordered)比的是【品項層聚合】,
  --      若同品項還有兄弟採購列撐著 ordered,對已作廢列收貨【不會】撞 C5
  --      ⇒ 那筆到貨就靜默掛在一筆已作廢的採購上,沒有任何人擋。
  --      **會撞的至少會停下來,不會撞的是靜默的壞資料** ⇒ 這裡不靠 CHECK 偶然接住。
  --   🔴 讀的是步 5 鎖下的 v_proc(不是重查)⇒ 無 TOCTOU。
  IF v_proc.voided_at IS NOT NULL THEN
    RETURN 'PROCUREMENT_VOIDED';
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
$function$

;

-- ── 3. COMMENT 更新(追加式,冪等)──────────────────────
-- 🔴 用 DO + format 追加而不是重打整段:兩支的 COMMENT 各有 20+ 行,手抄一次就是一次漂移機會。
--    追加前先查子字串 ⇒ 重跑不會疊兩次。
DO $cmt$
DECLARE
  v_a5a_sig  constant text := 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)';
  v_rcp_sig  constant text := 'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)';
  v_old text;
  v_add text;
BEGIN
  -- A5a
  v_add := ' 🔴 #452 片 2a-2(Sean 2026-08-14 Q-S1=A):存在性查詢帶 `AND voided_at IS NULL`'
        || ' ⇒ **已作廢的列視同不存在、走新建路徑**,舊作廢紀錄留著查帳;'
        || '同一家供應商因此可能看到兩列(一列已作廢、一列生效中),撞鍵靠業務鍵的 partial unique index'
        || '(WHERE voided_at IS NULL)。回傳碼**零新增**(走新建 = CREATED,已在既有 17 碼集內)。'
        || ' 🔴 本 RPC 刻意不取 advisory lock:C 案(只做作廢、不做取消作廢)下 void × A5a 已實測不死結'
        || '(docs/probes/452-2a2-void-lockprobe.sh,正向對照 40P01=1 / 本案兩向皆 0)。';
  SELECT pg_catalog.obj_description(v_a5a_sig::regprocedure, 'pg_proc') INTO v_old;
  IF v_old IS NULL THEN
    RAISE EXCEPTION '452-2a2甲:A5a 竟無 COMMENT ⇒ 上游狀態與預期不符;拒繼續';
  END IF;
  IF pg_catalog.strpos(v_old, '#452 片 2a-2') = 0 THEN
    EXECUTE pg_catalog.format('COMMENT ON FUNCTION %s IS %L', v_a5a_sig, v_old || v_add);
  END IF;

  -- receipt
  v_add := ' 🔴 #452 片 2a-2:新增固定碼 **PROCUREMENT_VOIDED** —— 已作廢的採購不得登錄到貨。'
        || '該守門排在**冪等快篩之後**(voided_at 是「會在兩次呼叫之間改變的狀態」;'
        || '排前面會讓「登錄成功 → 採購被作廢 → 合法重放」回錯碼而不是 DUPLICATE_REQUEST)。'
        || '🔴 它是**直接斷言**,不靠 C5(oiqs_instock_le_ordered)兜底 —— C5 比品項層聚合,'
        || '兄弟採購列撐著 ordered 時不會發作,那筆到貨會靜默掛在已作廢的採購上。'
        || '撤到貨的出口 = admin_delete_item_receipt(uuid,text,text);'
        || '⚠️ 撤完之後那批貨在系統裡沒有去處 = 已立案的 #462,本片不做。';
  SELECT pg_catalog.obj_description(v_rcp_sig::regprocedure, 'pg_proc') INTO v_old;
  IF v_old IS NULL THEN
    RAISE EXCEPTION '452-2a2甲:admin_record_item_receipt 竟無 COMMENT;拒繼續';
  END IF;
  IF pg_catalog.strpos(v_old, 'PROCUREMENT_VOIDED') = 0 THEN
    EXECUTE pg_catalog.format('COMMENT ON FUNCTION %s IS %L', v_rcp_sig, v_old || v_add);
  END IF;
END
$cmt$;

-- ── 4. 檔內 fail-closed 驗收 ─────────────────────────────
DO $verify$
DECLARE
  v_a5a_oid  constant regprocedure := 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure;
  v_rcp_oid  constant regprocedure := 'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure;
  v_src   text;
  v_cnt   integer;
  v_i     integer;
  v_j     integer;
  v_cfg   text[];
BEGIN
  -- ══════════════════════════════════════════════════════════════
  -- 🔴🔴 本段一律對「**剝掉 `--` 註解的 prosrc**」比對,不對 pg_get_functiondef 比。
  --
  --   為什麼(這是本檔踩過的坑,codex 2026-08-14 對抗審查 must-fix 兩條):
  --   ① `pg_get_functiondef` / `prosrc` **都含註解** ⇒ `strpos` 分不出程式與註解。
  --      本檔首版三個靶全中招:`voided_at is null` / `advisory` / `procurement_voided`
  --      各自被自己的說明註解灌水,一個誤紅、兩個會誤綠。
  --   ② 更毒的是**註解掉真述詞**這一招:把 `AND voided_at IS NULL` 前面加 `--`,
  --      字面還在 ⇒ 只看字面的靶**照樣全綠**,而守門實際上已經沒了。
  --      ⇒ 剝註解之後那一行連同字面一起消失 ⇒ 計數掉到 0 ⇒ **紅**。這才是有鑑別力的量法。
  --
  --   🔴 這個剝法**不是我發明的,repo 早就有**(`20260810233000:528-537` 逐字,含同一個踩坑紀錄)。
  --      我第一版沒去找既有樣板、自己重造了一個較弱的版本 —— 記在這裡。
  --   ⚠️ 誠實邊界(沿用原檔):剝法用 `--` 到行尾,**字串字面裡的 `--` 也會被剝掉**。
  --      對「找錨點」可接受(錨點都不含 `--`),但不可拿它當通用 SQL parser。
  --   ⚠️ 誠實邊界二:字面比對**不是控制流分析** —— 等價重構會合法誤紅。
  --      行為證據在 `scripts/452b-verify.sh`,不在這裡。這裡只是 tripwire。
  -- ══════════════════════════════════════════════════════════════

  -- ══ A5a ══
  -- 🔴 **兩段剝**:先剝 `/* … */` 區塊註解,再剝 `--` 行註解。
  --    只剝 `--` 的版本可以被 `/* AND voided_at IS NULL */` 直接騙過(codex R2 must-fix,對)。
  --    ⚠️ 這個兩段式**不是我發明的**,`scripts/452-verify.sh` 的 S7/S7b 格早就這樣寫。
  --      我第一次只抄了一半、被 R1 抓;修的時候又只抄了一半、被 R2 抓。**同一個錯連犯兩輪。**
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc WHERE oid =v_a5a_oid;

  -- (A1) 本片新增的 voided 分流:恰一次
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'AND voided_at IS NULL', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A1:A5a 的 `AND voided_at IS NULL` 應恰 1 次(剝註解後實 % 次)—— 0 = 守門被拿掉或被註解掉;>1 = 別處也加了分流,語意要人看;拒繼續', v_cnt;
  END IF;
  -- (A1b) 而且它必須在**採購列那條 FOR UPDATE 查詢之內**(不是隨便某處)
  IF v_src !~ 'FROM public\.order_item_procurement[^;]*AND voided_at IS NULL[^;]*FOR UPDATE' THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A1b:voided 述詞必須落在採購列 FOR UPDATE 那條查詢【之內】;拒繼續';
  END IF;

  -- (A2-A5) 🔴 以下全部是 `20260806200000:721-808` 的原有結構錨。
  --   CREATE OR REPLACE 會換掉整個函式體 ⇒ **不搬過來,2a-1 之前建立的保證就隨這次改寫靜默消失**
  --   (codex must-fix:「任一處抄壞,現有 DO block 仍可全綠」)。
  IF pg_catalog.strpos(v_src, 'FOR NO KEY UPDATE') <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A2:A5a 不得顯式取 order_items 的 NKU 鎖(取鎖序反轉);拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_item_quantity_summary') <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A3:A5a 竟引用摘要表(職責重複);拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'pcm_a4a_recompute') <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A4:A5a 竟直呼 A4a 重算 helper;拒繼續';
  END IF;
  IF v_src ~* '(^|[^_[:alnum:]])execute[[:space:]]' THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A5:A5a 出現動態 SQL(EXECUTE),字面錨全部失效;拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'pg_advisory') <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A5b:A5a 竟取 advisory lock —— C 案下 void × A5a 已實測不死結,無法證明的防護不該留;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'FOR UPDATE', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A6:A5a 的 FOR UPDATE 應恰 1 次(採購列鎖),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'FOR SHARE', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A7:A5a 的 FOR SHARE 應恰 1 次(供應商閘單一落點;多處 = 有一處會被寫成普通 SELECT 而 TOCTOU),實 % 次;拒繼續', v_cnt;
  END IF;
  -- 🔴 **`FROM public.suppliers s` 必須恰一次**(逐字搬回 `20260806200000:753/786-789`;
  --    codex R2 must-fix:我上一版只證「有一處帶 FOR SHARE」⇒ **多一個普通 SELECT 照樣全綠**,
  --    而供應商閘的整個安全性建立在「單一落點」上 —— 多出來的那一處就是 TOCTOU 的入口)。
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'FROM public\.suppliers s', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A8:`FROM public.suppliers s` 應恰 1 次(供應商閘單一落點;多一處會被寫成普通 SELECT 而 TOCTOU),實 % 次;拒繼續', v_cnt;
  END IF;
  IF NOT (v_src ~ 'FROM public\.suppliers s[^;]*FOR SHARE') THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A8b:兩把鎖必須各自綁對表(suppliers 那次查詢必須是 FOR SHARE);對調會讓無環論證失效;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'first_ordered_at', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A9:first_ordered_at 應恰 1 次(僅新建欄清單;出現在 SET 清單 = 首寫語意被破壞),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'received_quantity', 'g');
  SELECT count(*) INTO v_i   FROM pg_catalog.regexp_matches(v_src, 'v_before\.received_quantity', 'g');
  IF v_i < 1 OR v_cnt <> v_i THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A10:received_quantity 出現 % 次、其中讀取形式 % 次(應相等且 >=1:本 RPC 只准讀不准寫該欄,A4a P4A01);拒繼續', v_cnt, v_i;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'SET CONSTRAINTS', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A11:A5a 的 SET CONSTRAINTS 應恰 1 次(入口拉回 immediate),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'INSERT INTO public\.order_item_procurement', 'g');
  SELECT count(*) INTO v_i   FROM pg_catalog.regexp_matches(v_src, 'UPDATE public\.order_item_procurement', 'g');
  IF v_cnt <> 1 OR v_i <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A12:採購表 INSERT/UPDATE 各應恰 1 次,實 %/% 次;拒繼續', v_cnt, v_i;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'INSERT INTO public\.admin_audit_log', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A13:稽核 INSERT 應恰 1 次(每次寫入恰一筆稽核),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'clock_timestamp\(\)', 'g');
  IF v_cnt < 3 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A14:clock_timestamp() 應 >=3 次(未來判定 + 兩條寫入路徑戳記),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'now\(\)', 'g');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A15:函式體不得使用交易起始時間函式(戳記與未來判定一律 clock_timestamp),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'v_con IS DISTINCT FROM', 'g');
  IF v_cnt < 2 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A16:兩處 catch 的 constraint 比對必須用 v_con IS DISTINCT FROM(`<>` 在 NULL 時靜默吞錯誤),實 % 次;拒繼續', v_cnt;
  END IF;
  -- A9h-M 的三條保留語意錨(preserve 模式;抄壞會讓批次靜默清掉現值 —— 那正是該片要修的病)
  IF pg_catalog.strpos(v_src, 'p_preserve_optional_fields AND v_exists') = 0
     OR pg_catalog.strpos(v_src, 'v_eff_submitted_at') = 0
     OR pg_catalog.strpos(v_src, 'p_preserve_optional_fields AND v_channel IS NULL') = 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 A17:A9h-M 的 preserve 三錨(分流 / effective 單一來源 / 保留模式管道必填)缺一;抄壞會讓批次靜默清掉現值;拒繼續';
  END IF;

  -- ══ receipt ══
  -- 🔴 **兩段剝**:先剝 `/* … */` 區塊註解,再剝 `--` 行註解。
  --    只剝 `--` 的版本可以被 `/* AND voided_at IS NULL */` 直接騙過(codex R2 must-fix,對)。
  --    ⚠️ 這個兩段式**不是我發明的**,`scripts/452-verify.sh` 的 S7/S7b 格早就這樣寫。
  --      我第一次只抄了一半、被 R1 抓;修的時候又只抄了一半、被 R2 抓。**同一個錯連犯兩輪。**
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc WHERE oid =v_rcp_oid;

  -- (R1) 本片新增的作廢分流:恰一次,且讀的是鎖下的 v_proc(重查 = TOCTOU)
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'RETURN ''PROCUREMENT_VOIDED''', 'g');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R1:receipt 的 RETURN ''PROCUREMENT_VOIDED'' 應恰 1 次(剝註解後實 % 次);拒繼續', v_cnt;
  END IF;
  IF pg_catalog.strpos(v_src, 'v_proc.voided_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R2:作廢分流必須讀步 5 鎖下的 v_proc.voided_at(重查會產生 TOCTOU);拒繼續';
  END IF;

  -- (R3) 🔴 位置斷言:作廢分流必須排在冪等快篩【之後】。
  --   把它搬到冪等之前的實作,行為測試(B-idem / MUT-IDEM)照樣全綠 ⇒ 只有位置斷言抓得到。
  v_i := pg_catalog.strpos(v_src, 'FROM public.order_item_receipt_requests l');
  v_j := pg_catalog.strpos(v_src, 'v_proc.voided_at IS NOT NULL');
  IF v_i = 0 OR v_j = 0 OR v_i >= v_j THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R3:作廢分流必須排在冪等快篩之後(冪等表 % / 作廢守門 %);排前面會讓「登錄成功 → 採購被作廢 → 合法重放」回錯碼而不是 DUPLICATE_REQUEST;拒繼續', v_i, v_j;
  END IF;

  -- (R4-R7) 🔴 `20260810233000:540-575` 的原有錨,逐條搬過來(理由同 A2-A5)
  v_i := pg_catalog.strpos(v_src, 'FROM public.order_item_procurement');
  v_j := pg_catalog.strpos(v_src, 'FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE');
  IF v_i = 0 OR v_j = 0 OR v_i >= v_j THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R4:record 的取鎖序必須是 procurement → order_items(i=% j=%);拒繼續', v_i, v_j;
  END IF;
  IF pg_catalog.strpos(v_src, 'SET CONSTRAINTS') <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R5:record 不該有 SET CONSTRAINTS(它的守門讀 procurement 列、那一跳 NOT DEFERRABLE);拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.regexp_matches(v_src, 'IS NOT DISTINCT FROM', 'g');
  IF v_cnt <> 12 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R6:record 的冪等比對應恰 12 次 IS NOT DISTINCT FROM(= 6 個不可變 payload 欄 × 2 處:步 6 快篩 + 步 8 撞鍵處理;兩處必須逐字相同,數字不符 = 只改了一處 = 比對面分岔),實 % 次;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass AND contype = 'f';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 R7:冪等帳長出了 % 條外鍵 —— #352 plan §4 的鎖序論證要重跑;拒繼續', v_cnt;
  END IF;

  -- ══ 兩支的函式屬性(prosrc 看不到,必須查 pg_proc)══
  FOR v_i IN
    SELECT 1 FROM pg_catalog.pg_proc
     WHERE oid IN (v_a5a_oid, v_rcp_oid) AND NOT prosecdef
  LOOP
    RAISE EXCEPTION '452-2a2甲 驗收 SEC1:兩支必須維持 SECURITY DEFINER;拒繼續';
  END LOOP;
  FOR v_cfg IN SELECT proconfig FROM pg_catalog.pg_proc WHERE oid IN (v_a5a_oid, v_rcp_oid)
  LOOP
    IF v_cfg IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_cfg)) THEN
      RAISE EXCEPTION '452-2a2甲 驗收 SEC2:兩支的 proconfig 必須含 search_path=public, pg_temp(實 %);SECDEF 少了它就是可劫持;拒繼續',
        coalesce(v_cfg::text, '<null>');
    END IF;
  END LOOP;
  -- A5a 的 preserve 參數預設值不得被改掉(改成 true 會讓既有單列表單呼叫靜默變成保留模式)
  IF pg_catalog.pg_get_function_arguments(v_a5a_oid) NOT LIKE '%p_preserve_optional_fields boolean DEFAULT false%' THEN
    RAISE EXCEPTION '452-2a2甲 驗收 SEC3:A5a 的 p_preserve_optional_fields 預設值必須維持 false;拒繼續';
  END IF;

  -- ══ ACL 未被 CREATE OR REPLACE 影響 ══
  -- 🔴 **逐字搬回 `20260810233000:503-523` 的精確錨,不是 `has_function_privilege` 的弱版**
  --    (codex R2 must-fix,對)。弱版的兩個洞:
  --      ①`has_function_privilege('public', …)` 只答「有沒有」,答不出「**還有誰**」
  --        ⇒ 多一個 grantee(例如某個新 role)照樣全綠。
  --      ②它**看不到 `WITH GRANT OPTION`** ⇒ `service_role` 被改成可轉授也全綠,
  --        而那等於 service_role 可以再把 SECDEF 函式發給別人。原檔 `:502` 逐字記著這個教訓。
  --    ⇒ 改成走 `aclexplode` 做**窮舉**:owner 以外**只准**有 service_role 的**不可轉授** EXECUTE。
  FOR v_i IN SELECT unnest(ARRAY[0, 1]) LOOP
    DECLARE v_oid regprocedure := CASE v_i WHEN 0 THEN v_a5a_oid ELSE v_rcp_oid END;
    BEGIN
      SELECT count(*) INTO v_cnt
        FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid = v_oid
         AND a.grantee <> p.proowner
         AND NOT (a.grantee = 'service_role'::regrole::oid
                  AND a.privilege_type = 'EXECUTE'
                  AND a.is_grantable = false);
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION '452-2a2甲 驗收 ACL1:% 的 ACL 有 % 項是「owner 以外、且非 service_role 的不可轉授 EXECUTE」(多餘 grantee 或 WITH GRANT OPTION);拒繼續', v_oid, v_cnt;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid = v_oid
         AND a.grantee = 'service_role'::regrole::oid
         AND a.privilege_type = 'EXECUTE' AND a.is_grantable = false;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '452-2a2甲 驗收 ACL2:% 缺 service_role 的【不可轉授】EXECUTE(實 % 項);拒繼續', v_oid, v_cnt;
      END IF;
    END;
  END LOOP;

  -- ══ 兩支仍各自恰一個多載(避免 PostgREST 具名呼叫歧義)══
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_upsert_item_procurement', 'admin_record_item_receipt');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '452-2a2甲 驗收 OVL:兩支各應恰 1 個多載(實計 %);拒繼續', v_cnt;
  END IF;

  RAISE NOTICE '452-2a2甲 驗收全過:A5a 二十條 + receipt 七條(含位置斷言)+ 屬性三條 + ACL 兩條 + 多載一條,全部對【剝註解後的 prosrc】比對。';
  RAISE NOTICE '452-2a2甲 ⚠️ 字面錨只是 tripwire,不是控制流分析 —— 行為證據在 scripts/452b-verify.sh。';
END
$verify$;

COMMIT;
