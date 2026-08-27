-- ============================================================
-- M-4b E10 第 1 批 · A5a:採購 upsert owner RPC(`public.admin_upsert_item_procurement`)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 row 32(`:379`,
--       含 2026-08-03 Q1=A 同日字面修訂)。
-- 片級 plan:docs/specs/2026-08-03-e10-a5a-item-procurement-upsert-plan.md(v4 現行)。
-- 關卡1:codex gpt-5.6-sol xhigh R1(21)/R2(9)+ adversarial-reviewer Fable R3 換角度(4+3)
--       共 34 must-fix、駁回 0、閉環 PASS;findings 逐字 = docs/reviews/2026-08-03-e10-a5a-k1-codex.md。
-- 🔴 Sean 2026-08-03 晚拍板 Q1=A:停用供應商 ⇒ 擋新建 + 擋 allocated 調升;
--    事實記錄欄(回覆狀態/單號/異常原因/預計到貨/聯絡管道/送出時間)更新照常;
--    同 payload 重放(零寫入)不受停用影響。master plan `:379` 同日同 commit 修訂。
-- 形狀樣板 = 20260801160000 S2 + 20260802150000 A6。前置 = A2/S1a/S1b/A2b1/A4a/admin_audit_log。
--
-- 職責(row 32):`order_item_procurement` 的**唯一 service_role 應用寫入口**。
--   upsert 鍵 =(order_item_id, supplier_id)= 約束 order_item_procurement_business_key;
--   同 payload 重放 = no-op(A9h 批次重送靠這層冪等);同交易寫 admin_audit_log。
--   🔴 摘要重算在 A4a trigger、跨列總量守門在 A2b1 —— **本片不重複實作**,只翻譯錯誤面。
--
-- 🔴 全量 payload 語意(非 patch):選填欄 NULL = 該欄寫成 NULL。
--    create/update 由**列存在性**分流,不由參數 NULL 分流
--    ⇒ S2 的「弄丟 id 的改名靜默降級成新增」形狀在本片結構上不存在。
--    ⚠️ 代價 = lost-update:兩員工並發編輯、後送者用舊畫面值會靜默蓋掉前者
--    ⇒ 呼叫端契約:表單必**全欄 hydrate 自最新列、先讀後送**(A9d1/A10b;plan §9 債②)。
--    月 100-300 單、多人共用後台 ⇒ 不得以「量小」論證忽略(Sean 07-26 拍板已禁該論證)。
--
-- 🔴 17 個固定碼(呼叫端必須斷言 ∈ 全集,未知碼 = 呼叫端 bug):
--   CREATED / UPDATED / NO_CHANGE / ORDER_ITEM_NOT_FOUND / SUPPLIER_NOT_FOUND / SUPPLIER_INACTIVE /
--   OVER_ALLOCATION / ALLOCATED_BELOW_RECEIVED / INVALID_INPUT / INVALID_ALLOCATED /
--   INVALID_REPLY_STATUS / INVALID_CONTACT_CHANNEL / INVALID_SUPPLIER_ORDER_NO /
--   INVALID_EXCEPTION_REASON / SUBMITTED_AT_OUT_OF_RANGE / SUBMITTED_AT_IN_FUTURE /
--   EXPECTED_ARRIVAL_OUT_OF_RANGE
--   RAISE 面(= caller bug,非固定碼)= actor/request_id 缺失或非法 + 隔離閘 P2B02 + 防衛枝。
--
-- 🔴 檢查順序即合約(plan §3.3;harness C 區以相鄰對衝突輸入逐格承重):
--   0 隔離閘 → 0b 拉回 IMMEDIATE → 1 actor/request → 2 鍵 NULL → 3 allocated → 4 reply →
--   5 channel → 6 單號 → 7 異常原因 → 8 送出時間 → 9 預計到貨 → 10 品項存在 →
--   11 鎖列 →(11a 同值 no-op)→(11g 供應商閘)→(11b 更新 / 11c 新建)→ 12 稽核。
--
-- 🔴 隔離閘(P2B02;A2b1 Q1=A 先例、tag 分名保錯誤歸因):
--   A2b1/A4a 的閘只護 trigger 的 SUM 健全性、且只在真的有寫入時發火;本 RPC 自己還有兩段
--   read-decide-write(no-op 比對、供應商狀態判定)在 RR 下會拿交易快照決策 ⇒ 自備一道。
--   呼叫端只有 PostgREST(預設 read committed)⇒ 拒收零成本。
--
-- 🔴 步 0b `SET CONSTRAINTS … IMMEDIATE`(關卡1 R1-2):
--   A2b1 guard 是 DEFERRABLE INITIALLY IMMEDIATE(20260803130000:176-179)⇒ 呼叫端先 defer 的話
--   P2B01 會在 COMMIT 才發火、**逃出本函式的 catch** ⇒ OVER_ALLOCATION 合約當場失效。
--   入口強制拉回 immediate,把發火點鎖在本函式的 statement 內。
--   ⚠️ 副作用一:外層交易若已有 pending 事件,本句會讓它立刻發火成 raw P2B01/23514 ——
--      那是**先前寫入**的違規,歸因正確、fail-loud,故意不翻譯(翻了會把別人的錯講成這次的錯)。
--   ⚠️ 副作用二(plan §9 債⑥,R3-F6):SET CONSTRAINTS 是**交易域、本函式 RETURN 後不回復** ——
--      同交易呼叫端自己設的 DEFERRED 模式會被靜默撤銷到交易結束。呼叫紀律(一請求一呼叫)下
--      無實害,寫在這裡是為了日後 A9h debug 不誤歸因。
--   ⇒「先超後補」的 defer 編排屬 A9h 編排層,**不得經由本 RPC**(plan §9 債①)。
--
-- 🔴 鎖面與死結(plan §3.5;🔀 關卡2 MF3 更正 —— 舊字面「單一全序 procurement → suppliers」**是錯的**,
--   新建路徑實際相反、非調升更新根本不碰 suppliers。誠實改成逐路徑列表 + 重新論證):
--   路徑① 新建:procurement 查無列(FOR UPDATE 對不存在的列**不留任何鎖**)→ suppliers SHARE
--            → INSERT procurement(取新 tuple 鎖 / 撞既有 tuple 時等 unique)
--   路徑② 更新且調升:procurement 列鎖(FOR UPDATE)→ suppliers SHARE
--   路徑③ 更新非調升:procurement 列鎖 → **完全不碰 suppliers**
--   路徑④ 同值 no-op:procurement 列鎖 → 立即 RETURN
--   之後才是 [A2b1/A4a trigger 內:order_items FOR NO KEY UPDATE]。
--   ⇒ ①與② 的取鎖序**確實相反**(這是 upsert 的本質:要先知道列在不在才知道該不該問供應商)。
--   **無環仍成立,但理由不是「同序」而是「supplier 端用的是共享鎖」**:
--     · 兩個 A5a 交易之間:supplier 鎖皆為 SHARE、彼此相容 ⇒ 不可能互等 supplier
--       ⇒ 反向序不產生環(環要求雙方各持對方要的**互斥**鎖)。
--     · A5a × S2:S2 只鎖 suppliers(FOR UPDATE)、從不碰 procurement ⇒ 等待關係單向。
--     · A5a × A4a receipts sync:sync 走 procurement 列鎖 → order_items,不碰 suppliers ⇒ 單向。
--   ⚠️ 這條無環論證的前提 = **本 RPC 對 suppliers 只取共享鎖**。日後若有人把它升成 FOR UPDATE
--      (例如想順手改 supplier 欄位),①②的反向序立刻變成真環 —— 結構驗收的 `for share` 錨會擋。
--   ⚠️ 「無環」另限定**每交易單次呼叫本 RPC、且同交易不混呼 admin_upsert_supplier**(A6 `:52-54` 同款界):
--      同交易先呼本 RPC(持 supplier SHARE)再呼 S2(同 supplier 升 FOR UPDATE)可與另一等待者成環
--      ⇒ PG 偵測 40P01、fail-closed 可重試,但呼叫端契約寫死「A9d1 一請求一呼叫;A9h 逐 statement」。
--   ⚠️ 本片**不顯式鎖 order_items**(存在性查詢是普通 SELECT):鎖了會反轉 A2b1 定的
--      procurement → order_items 取鎖序、自毀它的無環分析(20260803130000:32-36)。
--   ⚠️ 供應商用 SHARE 而非讓 FK RI 的 KEY SHARE 代勞:KEY SHARE 與 NO KEY UPDATE 相容
--      ⇒ 擋不住「裸的非鍵欄 UPDATE」(is_active 正是非鍵欄)。S2 目前先取 FOR UPDATE、KEY SHARE
--      也擋得住它,但 SHARE 額外擋的是**還沒出生的 writer**(plan §9 債⑤)。
--
-- 🔴 本片刻意不做(不是忘記):
--   · 不做 DELETE(採購事實不刪;改派供應商 = 另建一列。⚠️ qty=1 的品項指錯供應商後,
--     正確那家會永遠 OVER_ALLOCATION —— **當日出路 = owner 手動
--     `DELETE FROM public.order_item_procurement WHERE id = …`**(A4a trigger 會自動重算摘要;
--     receipts 的 FK RESTRICT 會擋住有到貨紀錄的誤刪)。根治歸第 3 批採購退貨線;plan §9 債④。
--   · 不寫 `received_quantity`(A4a 的 BT guard 以 P4A01 擋直寫,值寫對也擋)。
--   · 不做批次(A9h 是 server 端編排,逐列呼本 RPC)。
--   · 不回傳列 id(呼叫端重讀清單即可;真需要再加 OUT 參數)。
--
-- 🔴 誠實邊界:
--   · 「唯一寫入口」限定 **service_role 應用路徑**:owner / SECURITY DEFINER / 持 owner 憑證的服務
--     / pg_cron job 仍可直寫表(A4a 的 guard 只擋 received 欄)⇒ 不得說「繞過稽核的路徑不存在」。
--   · 稽核不能反證真寫入:service_role 對 admin_audit_log 有 INSERT ⇒ 可不碰採購表就寫假稽核。
--     本片保證「經本 RPC 的寫入一定留稽核」,**不是**「稽核列一定對應一次真寫入」。
--   · actor 是自陳身分(`apps/admin/src/lib/session/actor.ts:6-7` 逐字:cookie 承載、非授權邊界)
--     ⇒ 保證「稽核有一個合法非空 actor 字串」,不保證那是真的操作者。真身分屬 E8-B。
--   · RPC 執行期沒有 lock_timeout(檔頭 SET LOCAL 只保護 apply 那一刻)⇒ 撞上殘留 owner 交易
--     會掛住而不是快速失敗(S2/A6 同界)。
--   · 三個文字欄的隱形字清單是**已知形狀、不宣稱窮盡**(A2 `:210-211` 同語)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. admin_upsert_item_procurement ─────────────────────────
CREATE FUNCTION public.admin_upsert_item_procurement(
  p_order_item_id         uuid,
  p_supplier_id           uuid,
  p_allocated_quantity    integer,
  p_reply_status          text,
  p_contact_channel       text,
  p_submitted_at          timestamptz,
  p_supplier_order_no     text,
  p_exception_reason      text,
  p_expected_arrival_date date,
  p_actor                 text,
  p_request_id            text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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

  -- 步 0. 隔離閘:非 read committed 一律拒收(理由見檔頭)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A5a 隔離閘:本 RPC 僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a5a_isolation_read_committed_only';
  END IF;

  -- 步 0b. 把兩支 constraint trigger 拉回 immediate(理由與兩個副作用見檔頭)
  SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac,
                  public.order_item_procurement_summary_recompute_zc IMMEDIATE;

  -- 步 1. actor / request_id(RAISE 面;先剝、後驗 —— 與下方文字欄同一順序,照 S2 R3 修正)
  -- 🔴 寫進稽核的是**剝過空白**的值(🔀 關卡2 n8 更正字面:上一版把因果寫反了 ——
  --    正因為有剝,'alice ' 與 'alice' 才會**收斂成同一個** actor;不剝才會分裂成兩個操作者、
  --    'req-1 ' 與 'req-1' 拆成兩條追蹤鏈)。稽核的用途正是「同一個人／同一次請求做了什麼」。
  -- 🔴 剝的字元集 = v_ws || v_zw(🔀 關卡2 n7):v_ws 不含 U+2800 / U+3164 / U+00AD ⇒ 只用 v_ws 的話
  --    「肉眼看起來是空白」的 actor 進得了稽核表(A6 的 body 判空已處理同一族碼位,這裡補上)。
  -- 🔴 不加 staff slug regex(與 A6 不同):A6 的 regex 是鏡像 order_notes.author 的欄位 CHECK,
  --    本片寫入的採購表沒有 actor 欄,稽核表只有 nonempty CHECK(20260712210000:55)⇒ 加了會
  --    宣稱大於事實(本 RPC 擋不住的東西不該假裝擋得住)。
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
  -- 🔴 三欄都要剝(關卡1 R3-F4):單號有 A2 的 regex CHECK 當後盾(漏剝會紅),
  --    管道與異常原因只有 `btrim(x) <> ''`(對 ' LINE ' 放行)⇒ 漏剝時 DB 不會紅,
  --    但乾淨值重放會被判成「有差異」⇒ 回 UPDATED 而非 NO_CHANGE = A9h 冪等靜默破功。
  v_channel := pg_catalog.btrim(p_contact_channel, v_ws);
  IF v_channel IS NOT NULL
     AND pg_catalog.regexp_replace(pg_catalog.translate(v_channel, v_zw, ''), '[[:space:]]', '', 'g') = '' THEN
    v_channel := NULL;
  END IF;
  IF v_channel IS NOT NULL
     AND (pg_catalog.char_length(v_channel) > v_text_max OR v_channel ~ '[[:cntrl:]]') THEN
    RETURN 'INVALID_CONTACT_CHANNEL';
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

  -- 步 8. 送出供應商的時間:兩端皆開區間(鏡像 A2 receipts 的 received_at_sane 形式);
  --       未來判定用 clock_timestamp():交易起始時間(另一個常見寫法)在長交易內會把
  --       「現在」誤判成未來(A6 `:35-36` 同一條)。5 分鐘寬限給裝置時鐘偏移。
  -- 🔴 界的字面**必須帶時區偏移**(本片實測、關卡1/2 皆未抓到,由 harness I21 逼出來):
  --    不帶偏移的 `TIMESTAMPTZ '2020-01-01'` 是用**呼叫端 session 的 TimeZone** 解讀
  --    ⇒ 同一個輸入在 UTC session 與 Asia/Taipei session 會得到不同判定(本機 TimeZone=Asia/Taipei
  --    時 `'2020-01-01 00:00:00+00'` 竟通過下界)。這與 A7b D9 的「date_trunc 隨 TimeZone 走」同族。
  --    A2 的 receipts CHECK 用不帶偏移的寫法沒事,是因為 CHECK 在 DDL 當下就綁定了資料庫預設時區;
  --    本函式是 runtime 求值 ⇒ 必須自己釘死。
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

  -- 步 10. 品項存在性:**普通 SELECT、刻意不鎖**(理由見檔頭鎖面段)。
  --        殘餘競態 = 併發刪單;今日零 order_items 刪除 writer、D1c 有零引用前置,
  --        真滑過也只是下方 INSERT 紅在 FK 23503(fail-closed)。
  PERFORM 1 FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RETURN 'ORDER_ITEM_NOT_FOUND';
  END IF;

  -- 步 11. upsert 本體。兩圈:第二圈只在「兄弟交易剛併發首建」時才會走到。
  FOR v_try IN 1..2 LOOP
    SELECT * INTO v_before
      FROM public.order_item_procurement
     WHERE order_item_id = p_order_item_id
       AND supplier_id   = p_supplier_id
     FOR UPDATE;
    v_exists := FOUND;

    -- 步 11a. 同值 no-op:零寫入、零稽核、不動兩個時間戳。
    -- 🔴 位置在供應商閘**之前**(關卡1 R1-3):重放一筆已提交的事實是零 DML,
    --    供應商後來被停用不改變「什麼都不寫」的安全性;放在閘之後會讓
    --    「建立 → 供應商停用 → A9h 批次重送」回 SUPPLIER_INACTIVE ⇒ 冪等被狀態轉換擊破。
    IF v_exists
       AND v_before.allocated_quantity    IS NOT DISTINCT FROM p_allocated_quantity
       AND v_before.reply_status          IS NOT DISTINCT FROM p_reply_status
       AND v_before.contact_channel       IS NOT DISTINCT FROM v_channel
       AND v_before.submitted_at          IS NOT DISTINCT FROM p_submitted_at
       AND v_before.supplier_order_no     IS NOT DISTINCT FROM v_order_no
       AND v_before.exception_reason      IS NOT DISTINCT FROM v_reason
       AND v_before.expected_arrival_date IS NOT DISTINCT FROM p_expected_arrival_date THEN
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
               submitted_at          = p_submitted_at,
               supplier_order_no     = v_order_no,
               exception_reason      = v_reason,
               expected_arrival_date = p_expected_arrival_date,
               status_changed_at     = v_stamp
         WHERE id = v_before.id;
      EXCEPTION WHEN SQLSTATE 'P2B01' THEN
        -- 🔴 用 IS DISTINCT FROM 不用 <>(關卡1 R1-15):CONSTRAINT_NAME 為 NULL 時
        --    `<>` 判定是 NULL ⇒ IF 不成立 ⇒ 非目標錯誤被靜默吞成 OVER_ALLOCATION。
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'a2b1_allocation_within_orderable' THEN
          RAISE;
        END IF;
        RETURN 'OVER_ALLOCATION';
      END;

      v_row_id := v_before.id;   -- 稽核 target 不得落 NULL(關卡1 R1-11)
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
         p_submitted_at, v_order_no, v_reason, p_expected_arrival_date,
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
        -- 必定看得到那筆已提交的列,走 11a/11b;本表無 DELETE writer ⇒ 不會再空手。
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
    -- 防衛枝:兩圈都沒收斂 = 上面的推理被推翻(例如有人加了 DELETE writer)。
    -- 不列守門計數、無負測、無突變格(A2b1 §3.6 / A4a 同紀律)。
    RAISE EXCEPTION 'A5a 防衛枝:upsert 兩圈未收斂(品項 % / 供應商 %;理論不可達)',
      p_order_item_id, p_supplier_id;
  END IF;

  -- 步 12. 同交易稽核(恰一句;失敗必往上拋 ⇒ 整筆 rollback,不存在「寫了但沒稽核」)。
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
      'submitted_at',          p_submitted_at,
      'supplier_order_no',     v_order_no,
      'exception_reason',      v_reason,
      'expected_arrival_date', p_expected_arrival_date),
    NULL,
    v_req,
    'admin'
  );

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text) IS
  'M-4b E10 A5a 採購 upsert RPC(Sean 2026-08-03 拍板 Q1=A;plan v4 關卡1 三輪 34 must-fix 收斂)。'
  'order_item_procurement 對 service_role 只開 SELECT ⇒ 本函式是 **service_role 應用路徑**的唯一寫入口 '
  '(owner / SECURITY DEFINER / pg_cron / 持 owner 憑證的服務不受限 —— 不得說「繞過稽核的路徑不存在」);'
  '同交易寫 admin_audit_log(procurement.create / procurement.update)。'
  'upsert 鍵 =(order_item_id, supplier_id);全量 payload 語意 —— 選填欄 NULL = 寫成 NULL、'
  'create/update 由列存在性分流(非參數 NULL 分流)。同 payload 重放 = NO_CHANGE(零寫入零稽核不動日期),'
  '**且不受供應商事後停用影響**(A9h 批次重送的冪等靠這條)。'
  '回 17 固定碼:CREATED / UPDATED / NO_CHANGE / ORDER_ITEM_NOT_FOUND / SUPPLIER_NOT_FOUND / '
  'SUPPLIER_INACTIVE / OVER_ALLOCATION / ALLOCATED_BELOW_RECEIVED / INVALID_INPUT / INVALID_ALLOCATED / '
  'INVALID_REPLY_STATUS / INVALID_CONTACT_CHANNEL / INVALID_SUPPLIER_ORDER_NO / INVALID_EXCEPTION_REASON / '
  'SUBMITTED_AT_OUT_OF_RANGE / SUBMITTED_AT_IN_FUTURE / EXPECTED_ARRIVAL_OUT_OF_RANGE。'
  '停用供應商(Q1=A):擋新建與 allocated 調升,事實記錄欄更新照常。'
  'first_ordered_at 僅首寫、status_changed_at 每次真更新(皆 clock_timestamp,非 now)。'
  'received_quantity 不由本 RPC 寫(A4a 的 P4A01 守門);摘要重算在 A4a、跨列總量守門在 A2b1 —— 本片只翻譯 P2B01。'
  '鎖序 = procurement 列 FOR UPDATE → suppliers FOR SHARE → (trigger) order_items NKU;'
  '「無環」限定每交易單次呼叫且不與 admin_upsert_supplier 混呼同交易。'
  '呼叫端契約:斷言回傳碼 ∈ 17 碼全集;表單全欄 hydrate 自最新列(全量 payload ⇒ 並發編輯會互蓋);'
  'submitted_at 的 offset 由 server 補 Asia/Taipei。EXECUTE 僅 service_role。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role ──
-- 🔴 函式預設 ACL 是 EXECUTE TO PUBLIC ⇒ 不 REVOKE 的話 anon 也叫得到這支 owner RPC。
REVOKE ALL ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text)
  TO service_role;

-- ── 3. 檔內 fail-closed 驗收(任一不符則整支 migration 回滾;照 S2 5a-5g + A6 3a-3h 形狀)──
DO $verify$
DECLARE
  v_oid   oid := 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text)'::regprocedure;
  v_owner oid;
  v_cnt   integer;
  v_txt   text;
  v_def   text;
BEGIN
  -- 3a. SECURITY DEFINER + search_path 釘死
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'A5a 異常 — 應為 SECURITY DEFINER;拒繼續';
  END IF;
  SELECT pg_catalog.array_to_string(proconfig, ',') INTO v_txt
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_txt IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'A5a 異常 — proconfig 應為 search_path=public, pg_temp,實 [%];拒繼續', v_txt;
  END IF;

  -- 3b. 參數簽章逐字(含參數名;多任何一個入口這條就紅 —— 例如有人補一個 p_received_quantity)
  --     🔴 identity_arguments 回**全稱** timestamp with time zone(A6 3b 實測踩過)。
  SELECT pg_catalog.pg_get_function_identity_arguments(v_oid) INTO v_txt;
  IF v_txt <> 'p_order_item_id uuid, p_supplier_id uuid, p_allocated_quantity integer, p_reply_status text, p_contact_channel text, p_submitted_at timestamp with time zone, p_supplier_order_no text, p_exception_reason text, p_expected_arrival_date date, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION 'A5a 異常 — 參數簽章為 [%],與宣告不符;拒繼續', v_txt;
  END IF;

  -- 3c. proacl 非 NULL 前置(NULL = EXECUTE TO PUBLIC 預設,下面每條 ACL 斷言都會假綠)
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'A5a ACL 異常 — proacl 為 NULL(= EXECUTE TO PUBLIC 預設);拒繼續';
  END IF;

  -- 3d. 函式 ACL 攤平(含 is_grantable)恰 service_role:EXECUTE:false
  --     🔴 is_grantable 不可省:GRANT … WITH GRANT OPTION 攤平後與普通 EXECUTE 字串相同(S1b 實測)。
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_proc pr
            CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
           WHERE pr.oid = v_oid AND a.grantee <> pr.proowner) x;
  IF v_txt <> 'service_role:EXECUTE:false' THEN
    RAISE EXCEPTION 'A5a ACL 異常 — 非 owner 授權應恰為 service_role:EXECUTE:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 3e. PUBLIC(grantee=0)零授權(縱深第二層;紅點本來就會落在 3d)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc pr
    CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
   WHERE pr.oid = v_oid AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A5a ACL 異常 — PUBLIC 應零授權,實 % 筆;拒繼續', v_cnt;
  END IF;

  -- 3e-2. 🔴 有效權限(關卡2 MF5):3d/3e 攤的是**直接授權**,role 繼承(某天有人
  --       `GRANT service_role TO anon`)在 proacl 裡看不見 ⇒ 兩條照樣綠而 anon 已能呼叫。
  --       has_function_privilege 算的是繼承後的有效權限,補上這一層。
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'A5a ACL 異常 — anon/authenticated 具有效 EXECUTE(直接授權或 role 繼承);拒繼續';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'A5a ACL 異常 — service_role 竟無 EXECUTE(唯一應用寫入口叫不動);拒繼續';
  END IF;
  -- 客戶端 role 對兩張表也不得有任何有效權限(繼承面同理)
  IF pg_catalog.has_table_privilege('anon', 'public.order_item_procurement'::regclass, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.order_item_procurement'::regclass, 'SELECT') THEN
    RAISE EXCEPTION 'A5a ACL 異常 — 客人 role 可讀採購表(供應商資料外洩;A2 原則 3 破口);拒繼續';
  END IF;

  -- 3f. owner 對齊**四張表**(關卡1 R1-14 補 order_items):
  --     SECURITY DEFINER 的全部安全語意 = 以 owner 身分跑;四張表都是 zero-policy RLS,
  --     非 owner 的 SELECT 會靜默回空(⇒ 假的 ORDER_ITEM_NOT_FOUND)、INSERT 直接 42501。
  SELECT proowner INTO v_owner FROM pg_catalog.pg_proc WHERE oid = v_oid;
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_item_procurement'::regclass,
                 'public.suppliers'::regclass,
                 'public.order_items'::regclass,
                 'public.admin_audit_log'::regclass)
     AND relowner <> v_owner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 函式 owner 與 % 張讀寫表的 owner 不對齊(zero-policy RLS 下非 owner 讀不到寫不進);拒繼續', v_cnt;
  END IF;

  -- 3f-2. 四張表都不得開 FORCE RLS(FORCE + 零 policy 連 owner 都擋 ⇒ 首次呼叫就死)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_item_procurement'::regclass,
                 'public.suppliers'::regclass,
                 'public.order_items'::regclass,
                 'public.admin_audit_log'::regclass)
     AND relforcerowsecurity;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — % 張表開了 FORCE ROW LEVEL SECURITY(definer 會被自己擋死);拒繼續', v_cnt;
  END IF;

  -- 3g. 🔴 本片**不得**放寬採購表的表級 ACL:service_role 仍必須只有 SELECT。
  --     若有人「順手」給了 INSERT/UPDATE,本 RPC 就不再是唯一寫入口、同交易稽核也不再強制。
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.order_item_procurement'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'A5a 異常 — 採購表非 owner 授權應仍恰為 service_role:SELECT:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 3g-2. 欄級 ACL = 0(relacl 只放表級;欄級 GRANT 是攤平比對看不到的後門)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 採購表有 % 個欄位帶欄級 ACL(表級收斂擋不住欄級後門);拒繼續', v_cnt;
  END IF;

  -- 3g-3. suppliers 表級 ACL 同樣不得被本片放寬(S2 的 5f 對應項)
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.suppliers'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'A5a 異常 — suppliers 非 owner 授權應仍恰為 service_role:SELECT:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 3h. admin_audit_log:本 RPC 寫入的八欄仍在 + owner 寫得進去
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.admin_audit_log'::regclass
     AND NOT attisdropped AND attnum > 0
     AND attname IN ('actor','action','target','before','after','reason','request_id','source_app');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'A5a 異常 — 稽核表的 8 欄應全部存在,實命中 %;拒繼續', v_cnt;
  END IF;
  IF NOT has_table_privilege(v_owner, 'public.admin_audit_log'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'A5a 異常 — 函式 owner 對 admin_audit_log 無 INSERT;上線後每次呼叫都 42501;拒繼續';
  END IF;

  -- 3i. 上游前置物件在位(缺任一支,本 RPC 的錯誤翻譯與摘要連動都會靜默失效)。
  --     🔴 關卡2 MF4:只驗「同名 trigger 存在」不夠 —— 被 DISABLE、掛錯表、或指到別的函式時
  --        本 DO 照樣綠,而 OVER_ALLOCATION 翻譯與摘要重算都已實質失效。改成逐支釘
  --        (表 × 函式 × enabled)三元組,且同名必須全庫唯一(SET CONSTRAINTS 依名字作用)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname = 'order_item_procurement_allocation_guard_ac' AND NOT t.tgisinternal
     AND t.tgrelid = 'public.order_item_procurement'::regclass
     AND t.tgfoid  = 'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure
     AND t.tgenabled = 'O';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A5a 異常 — A2b1 守門 trigger 應恰 1 支、掛 order_item_procurement、指 pcm_a2b1_procurement_allocation_guard、enabled=O(實命中 %);本 RPC 的 OVER_ALLOCATION 依賴它;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname = 'order_item_procurement_summary_recompute_zc' AND NOT t.tgisinternal
     AND t.tgrelid = 'public.order_item_procurement'::regclass
     AND t.tgfoid  = 'public.pcm_a4a_procurement_summary_recompute()'::regprocedure
     AND t.tgenabled = 'O';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A5a 異常 — A4a 重算 trigger 應恰 1 支、掛 order_item_procurement、指 pcm_a4a_procurement_summary_recompute、enabled=O(實命中 %);步 0b 的 SET CONSTRAINTS 依賴它;拒繼續', v_cnt;
  END IF;
  -- received 直寫守門也必須在(本 RPC 的「不寫 received」是靠它兌現,不是靠自律)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname = 'order_item_procurement_received_quantity_guard_bt' AND NOT t.tgisinternal
     AND t.tgrelid = 'public.order_item_procurement'::regclass
     AND t.tgenabled = 'O';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A5a 異常 — A4a 的 received 直寫守門(P4A01)不在或被停用(實命中 %);拒繼續', v_cnt;
  END IF;
  -- business key 定義逐字(upsert 冪等與 23505 收斂路徑押在它身上)
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname  = 'order_item_procurement_business_key';
  IF v_txt IS DISTINCT FROM 'UNIQUE (order_item_id, supplier_id)' THEN
    RAISE EXCEPTION 'A5a 異常 — business key 應為 UNIQUE (order_item_id, supplier_id),實 [%];拒繼續',
      coalesce(v_txt, '<不存在>');
  END IF;

  -- 3j. 函式定義字面錨(以 lower() 比對免大小寫繞過;誠實界同 A2b1 3f ——
  --     文字比對不是控制流分析,等價重構會合法誤紅、行為證據在 scripts/a5a-verify.sh)。
  v_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid));

  -- (a) 摘要快取表零出現(重算是 A4a 的職責;守門與寫入都不得讀它)
  IF pg_catalog.strpos(v_def, 'order_item_quantity_summary') <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 本 RPC 竟引用摘要表(A1 row C1 禁令 / 職責重複);拒繼續';
  END IF;
  -- (a2) 🔴 關卡2 n1:不得直呼 A4a 的重算 helper —— 只禁摘要表字面的話,
  --      `PERFORM pcm_a4a_recompute_order_item_summary(...)` 可以讓同一筆寫入被重算兩次,
  --      而結構 DO 與「最終值正確」的 harness 都看不出來(值一樣、白做一次且多一次 parent 鎖)。
  IF pg_catalog.strpos(v_def, 'pcm_a4a_recompute') <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 本 RPC 竟直呼 A4a 重算 helper(重算是 trigger 的職責,呼叫 = 重複實作);拒繼續';
  END IF;
  -- (b) 不得自己鎖 order_items(會反轉 A2b1 定的取鎖序)
  IF pg_catalog.strpos(v_def, 'for no key update') <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 本 RPC 不得顯式取 order_items 的 NKU 鎖(取鎖序反轉);拒繼續';
  END IF;
  -- (c) 零動態 SQL(EXECUTE 會讓上面所有字面錨失效)
  IF v_def ~ '(^|[^_[:alnum:]])execute[[:space:]]' THEN
    RAISE EXCEPTION 'A5a 異常 — 函式體出現動態 SQL(EXECUTE),字面錨全部失效;拒繼續';
  END IF;
  -- (d) 逐錨次數:每條都是一個可被突變殺掉的結構事實。
  --     ⚠️ 關卡2 n3 誠實界:下面的 received 錨**綁死 `v_before` 這個 record 變數名** ——
  --        等價重構(改用 scalar 變數或把 record 更名)的正確實作會被本錨誤紅。
  --        這是刻意的取捨:錨要能區分「讀」與「寫」就只能認形狀;真要改名時同步改這裡。
  --     🔴 received_quantity 只准以 v_before.received_quantity 的讀取形式出現(關卡1 R2-1):
  --        寫成「0 次」會與 ALLOCATED_BELOW_RECEIVED 的鎖下預檢自相矛盾(正確函式被自己的驗收拒絕);
  --        兩個計數相等 ⇒ 它永遠不是賦值目標。
  DECLARE
    n_recv_all  integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'received_quantity', '')))
                           / pg_catalog.length('received_quantity');
    n_recv_read integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'v_before.received_quantity', '')))
                           / pg_catalog.length('v_before.received_quantity');
    n_first     integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'first_ordered_at', '')))
                           / pg_catalog.length('first_ordered_at');
    n_share     integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'for share', '')))
                           / pg_catalog.length('for share');
    n_fupd      integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'for update', '')))
                           / pg_catalog.length('for update');
    -- 🔴 關卡2 n2:只數總次數的話,把兩把鎖對調(suppliers 取 FOR UPDATE、procurement 取 FOR SHARE)
    --    次數完全不變、檔內 DO 照樣綠,而 §3.5 的無環論證(supplier 端必須是共享鎖)當場失效。
    --    ⇒ 各自綁到它該鎖的表:suppliers 那句必須是 SHARE、procurement 那句必須是 FOR UPDATE。
    n_share_sup integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'from public.suppliers s', '')))
                           / pg_catalog.length('from public.suppliers s');
    n_lock_pair integer := CASE
      WHEN v_def ~ 'from public\.suppliers s[^;]*for share'
       AND v_def ~ 'from public\.order_item_procurement[^;]*for update' THEN 1 ELSE 0 END;
    n_setcon    integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'set constraints', '')))
                           / pg_catalog.length('set constraints');
    n_ins_proc  integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'insert into public.order_item_procurement', '')))
                           / pg_catalog.length('insert into public.order_item_procurement');
    n_upd_proc  integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'update public.order_item_procurement', '')))
                           / pg_catalog.length('update public.order_item_procurement');
    n_ins_audit integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'insert into public.admin_audit_log', '')))
                           / pg_catalog.length('insert into public.admin_audit_log');
    n_clock     integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'clock_timestamp()', '')))
                           / pg_catalog.length('clock_timestamp()');
    n_isdist    integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'v_con is distinct from', '')))
                           / pg_catalog.length('v_con is distinct from');
    n_now       integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'now()', '')))
                           / pg_catalog.length('now()');
  BEGIN
    IF n_recv_read < 1 OR n_recv_all <> n_recv_read THEN
      RAISE EXCEPTION 'A5a 錨異常 — received_quantity 出現 % 次、其中讀取形式 % 次(應相等且 ≥1:本 RPC 只准讀不准寫該欄,A4a P4A01);拒繼續',
        n_recv_all, n_recv_read;
    END IF;
    IF n_first <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — first_ordered_at 應恰 1 次(僅新建欄清單;出現在 SET 清單 = 首寫語意被破壞),實 % 次;拒繼續', n_first;
    END IF;
    IF n_share <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — FOR SHARE 應恰 1 次(供應商閘單一落點;多處 = 有一處會被寫成普通 SELECT 而 TOCTOU),實 % 次;拒繼續', n_share;
    END IF;
    IF n_fupd <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — FOR UPDATE 應恰 1 次(採購列鎖),實 % 次;拒繼續', n_fupd;
    END IF;
    IF n_share_sup <> 1 OR n_lock_pair <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 兩把鎖必須各自綁對表:suppliers 查詢恰 1 次(實 %)且必須是 FOR SHARE、採購列查詢必須是 FOR UPDATE(配對檢查 %);對調會讓無環論證失效;拒繼續',
        n_share_sup, n_lock_pair;
    END IF;
    IF n_setcon <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — SET CONSTRAINTS 應恰 1 次(入口拉回 immediate),實 % 次;拒繼續', n_setcon;
    END IF;
    IF n_ins_proc <> 1 OR n_upd_proc <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 採購表 INSERT/UPDATE 各應恰 1 次,實 %/% 次;拒繼續', n_ins_proc, n_upd_proc;
    END IF;
    IF n_ins_audit <> 1 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 稽核 INSERT 應恰 1 次(每次寫入恰一筆稽核),實 % 次;拒繼續', n_ins_audit;
    END IF;
    IF n_clock < 3 THEN
      RAISE EXCEPTION 'A5a 錨異常 — clock_timestamp() 應 ≥3 次(未來判定 + 兩條寫入路徑的戳記),實 % 次;拒繼續', n_clock;
    END IF;
    -- now() 是交易起始時間 ⇒ 同交易兩次真更新會拿到相同 status_changed_at(關卡1 R1-6)。
    -- clock_timestamp() 字面含 now?否 —— 但 pg_catalog.now() 會命中,故整支函式禁用。
    IF n_now <> 0 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 函式體不得使用 now()(交易起始時間;戳記與未來判定一律 clock_timestamp),實 % 次;拒繼續', n_now;
    END IF;
    IF n_isdist < 2 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 兩處 catch 的 constraint 比對必須用 v_con IS DISTINCT FROM(<> 在 NULL 時靜默吞錯誤),實 % 次;拒繼續', n_isdist;
    END IF;
  END;

  -- 3k. COMMENT 合約存在且含 17 碼全集(缺任一碼 = introspection 合約不完整)
  SELECT pg_catalog.obj_description(v_oid, 'pg_proc') INTO v_txt;
  IF v_txt IS NULL THEN
    RAISE EXCEPTION 'A5a 異常 — COMMENT ON FUNCTION 不存在;拒繼續';
  END IF;
  IF NOT (v_txt LIKE '%CREATED%' AND v_txt LIKE '%UPDATED%' AND v_txt LIKE '%NO_CHANGE%'
      AND v_txt LIKE '%ORDER_ITEM_NOT_FOUND%' AND v_txt LIKE '%SUPPLIER_NOT_FOUND%'
      AND v_txt LIKE '%SUPPLIER_INACTIVE%' AND v_txt LIKE '%OVER_ALLOCATION%'
      AND v_txt LIKE '%ALLOCATED_BELOW_RECEIVED%' AND v_txt LIKE '%INVALID_INPUT%'
      AND v_txt LIKE '%INVALID_ALLOCATED%' AND v_txt LIKE '%INVALID_REPLY_STATUS%'
      AND v_txt LIKE '%INVALID_CONTACT_CHANNEL%' AND v_txt LIKE '%INVALID_SUPPLIER_ORDER_NO%'
      AND v_txt LIKE '%INVALID_EXCEPTION_REASON%' AND v_txt LIKE '%SUBMITTED_AT_OUT_OF_RANGE%'
      AND v_txt LIKE '%SUBMITTED_AT_IN_FUTURE%' AND v_txt LIKE '%EXPECTED_ARRIVAL_OUT_OF_RANGE%') THEN
    RAISE EXCEPTION 'A5a 異常 — COMMENT 未含 17 碼全集;拒繼續';
  END IF;

  RAISE NOTICE 'A5a 結構驗收全數通過(SECDEF / search_path / 11 參數簽章 / 函式 ACL / 四表 owner 對齊 + FORCE RLS off / 兩表 ACL 未放寬 / 稽核八欄 + INSERT / 上游 trigger 與 business key / 12 條字面錨 / COMMENT 17 碼)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 apply 之後的硬前置(本檔做不到,不得當成已完成):
--    `packages/adapters/src/supabase/database.types.ts` 重 gen ——
--    本片新增一支 RPC ⇒ Functions 區塊會多一項,而該檔由**正式站** schema 產生。
--    🔴 重 gen 會沖掉檔內三處人工校正(create_order.Args 的 p_client_ip / p_client_ua /
--       p_notification_email 的 `| null`),重 gen 後必須貼回、以 typecheck 轉綠為證
--       (已復發過一次,見 STATUS 2026-08-01 早)。A9d1 要用 typed .rpc() ⇒ 這是它的硬前置。
--
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only,對齊 S2 / A6 慣例):
--
--   DROP FUNCTION IF EXISTS public.admin_upsert_item_procurement(
--     uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text);
--
--   本片零表結構改動、零**表級** ACL 放寬、零資料寫入 ⇒ down 乾淨。
--   (🔀 關卡2 n9:本片確實新增了一項函式級授權 —— `GRANT EXECUTE … TO service_role`,
--    DROP FUNCTION 會一併帶走它;說「零 ACL 放寬」是字面大於事實。)
--   🔴 但**下游先撤**:A9d1 server actions → A9h 批次 coordinator → A10b UI(今日皆未建);
--      先 DROP 會讓線上呼叫找不到函式(PostgREST 回 404/PGRST202;不臆測狀態碼)。
--   🔴 「migration 可逆,營運效果不可逆」:員工開始登記採購後,DROP 函式不會回到 A5a 前 ——
--      既有採購列與稽核列都留著,且採購列對 order_items 的 RESTRICT 引用會擋刪單(D1c 前置)。
--
-- 🔴 A2b1 / A4a 單獨回滾時,本 RPC **必須同停**(兩檔已載明:回滾後採購寫入會失去總量守門
--    與摘要重算)。停法 = docs/runbooks/a4a-summary-rollback.md 步驟①(REVOKE + drain 斷言)。
-- ============================================================
