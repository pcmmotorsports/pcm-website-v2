-- ============================================================
-- M-4b E10 · A9h-M:A5a 加 preserve 模式(`p_preserve_optional_fields`)
-- ============================================================
-- 片級 plan:docs/specs/2026-08-06-e10-a9h-m-a5a-preserve-plan.md(v4 現行)。
-- 上游拍板 = Sean `E-124-A:3`(Q4=A);本片兩題 = Sean 2026-08-06 `E-127-A`:
--   Q1=A 矛盾意圖走既有 caller-bug 面 P0001(**不新增第 18 碼**);
--   Q2=A 批次聯絡管道必填 ⇒ **12 參簽章一次定案**、`contact_channel` 不進 preserve 集合。
-- 基底 = 20260803160000(A5a)。本檔 DROP 舊 11 參簽章、重建為 12 參。
--
-- 🔴 關卡1 = `adversarial-reviewer`(model:fable)R1+R2 兩輪、findings 逐字在
--    docs/reviews/2026-08-06-e10-a9h-k1-codex.md。**codex 跨模型背書仍欠**
--    (新帳號撞用量牆、恢復 2026-09-05 18:33)⇒ 打擊面清單在 plan §8,apply 前補跑或由 Sean 知情放行。
--
-- ── 病灶 ────────────────────────────────────────────────────
-- A5a 的 UPDATE 分支(20260803160000:354-361)**無條件**用參數覆寫選填欄。
-- A9h 批次(Q1=A)只有「每列訂多少」的入口,那四欄根本沒有欄位可填 ⇒ 逐列呼叫時只能送 NULL
-- ⇒ **把員工先前在明細頁填好的供應商單號 / 預計到貨日 / 異常原因 / 送出時間清掉**。
-- 動線很正常:先在明細頁記,之後那張單被批次掃到。
-- 關卡1 裁定逐字:「警告不能把資料損失變可接受」⇒ 必須在 DB 層解決。
--
-- ── 選型 ────────────────────────────────────────────────────
-- `p_preserve_optional_fields boolean DEFAULT false`:
--   true  ⇒ UPDATE 分支的**那四欄**保留現值;
--   false ⇒ **現行行為逐字不變**(明細頁單列表單照舊送 false ⇒ 員工想清空某欄照樣清得掉,
--           這是 Sean 拍 A 時的硬約束)。
-- 🔴 不用 COALESCE:COALESCE 是「永遠不能清空」;顯式旗標是「只在呼叫端明說自己沒有那四欄時才保留」。
-- 🔴 不做窄版 patch RPC:窄版仍必須寫 allocated_quantity ⇒ 必然複製 A2b1 的 P2B01 catch、
--    併發首建重試圈、供應商閘、同交易稽核 ⇒ 兩份守門必然漂移,而「批次路徑少了一道單列路徑有的守門」
--    正是本 repo 反覆踩的坑。**一支 RPC 一個守門面。**
--
-- ── 相對基底的行為差異(只有這四項)────────────────────────
--   M1 UPDATE 分支那四欄改讀 effective 值(preserve 時 = 現值)。
--   M2 同值 no-op 的比較基準改成 effective 值(與 M1 共用同一份欄位來源 ——
--      四處各自枚舉參數正是關卡1 F1「漏掉 contact_channel」那條的病根)。
--   M3 稽核 after 改記 effective 值(否則 preserve 後資料列留舊值、稽核記 NULL = 兩者矛盾)。
--   M4 preserve=true 而那四個參數任一非 NULL ⇒ **fail-loud RAISE**(Q1=A);
--      旗標本身為 NULL 亦 RAISE(三值邏輯會讓它靜默降級成不保留 —— 見步 1n);
--      preserve=true 而 channel 正規化後為 NULL 亦 RAISE(Sean 2026-08-06 拍板 —— 見步 5p)。
--   ⇒ `p_preserve_optional_fields = false` 時,17 個固定碼與全部副作用**逐字不變**。
--
-- 🔴 檢查順序(相對基底只插入 1p / 11p 兩步,**既有步號不重新編號**):
--   0 隔離閘 → 0b 拉回 IMMEDIATE → 1 actor/request → **1n 旗標非 NULL → 1p preserve 矛盾意圖** → 2 鍵 NULL →
--   3 allocated → 4 reply → 5 channel →(**5p 保留模式下 channel 必填**)→ 6 單號 → 7 異常原因 → 8 送出時間 → 9 預計到貨 →
--   10 品項存在 → 11 鎖列 →(**11p effective 值**)→(11a 同值 no-op)→(11g 供應商閘)→
--   (11b 更新 / 11c 新建)→ 12 稽核。
--
-- 🔴 RAISE 面(= caller bug,非固定碼)新增一項:
--   actor/request_id 缺失或非法 + **保留旗標為 NULL** + **preserve 矛盾意圖** + **保留模式下 channel 留空**
--   + 隔離閘 P2B02 + 防衛枝。
--   前者與後者同為 P0001 ⇒ 呼叫端 `procurement-repository.ts` 的判別式**不需改**(只看 code)。
--
-- 🔴 誠實邊界(基底的六條全部續存,不重複抄;本片新增兩條):
--   · M4 比對的是**原始參數**、不是正規化後的值 —— 送 '   ' 這種肉眼全空的字串 + preserve=true
--     一樣 RAISE。刻意從嚴:合法呼叫端(批次送 NULL 字面、單列送 false)構造不出這個面。
--   · **`contact_channel` 不進保留集合、但在保留模式下必填**(步 5p)—— 兩者不衝突:
--     不保留 = 批次送什麼就寫什麼(員工可整批改管道);必填 = 不准不送(不送會清空)。
--   · ⚠️ **步 5p 的響度順序與步 1p 不同,是刻意的**(關卡2 N2):1p 排在固定碼**之前**
--     (RAISE 面比固定碼更響),5p 卻排在步 2-5 的固定碼**之後** —— 因為拍板字面是
--     「**正規化後** NULL ⇒ RAISE」,而正規化就發生在步 5,擺前面就沒有正規化值可比。
--     代價:批次同時漏 channel 又送壞 allocated 時,呼叫端先看到 `INVALID_ALLOCATED`、
--     修完重送才撞這道 RAISE(**兩段式發現**)。全程零寫入、零資料損失 ⇒ 接受;
--     寫在這裡是為了日後 debug 不把它誤當成 bug。
--   · preserve=true 對**新建路徑**無效(沒有舊值可保留)。步 1p 已保證此時那四個參數皆為 NULL
--     ⇒ 新列插 NULL,與基底行為一致。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 先拆舊 11 參簽章 ──────────────────────────────────────
-- 🔴 加參數 = **新簽章**,不 DROP 的話兩個多載並存 ⇒ PostgREST 具名呼叫歧義(A8a1/A8a2 前例)。
-- 🔴 刻意不寫 IF EXISTS:舊簽章不在 = 狀態與預期不符,本句的 error 就是那道前置斷言。
DROP FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text);

-- ── 2. 重建為 12 參 ─────────────────────────────────────────
CREATE FUNCTION public.admin_upsert_item_procurement(
  p_order_item_id            uuid,
  p_supplier_id              uuid,
  p_allocated_quantity       integer,
  p_reply_status             text,
  p_contact_channel          text,
  p_submitted_at             timestamptz,
  p_supplier_order_no        text,
  p_exception_reason         text,
  p_expected_arrival_date    date,
  p_actor                    text,
  p_request_id               text,
  p_preserve_optional_fields boolean DEFAULT false
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
    SELECT * INTO v_before
      FROM public.order_item_procurement
     WHERE order_item_id = p_order_item_id
       AND supplier_id   = p_supplier_id
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
$fn$;

COMMENT ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) IS
  'M-4b E10 A5a 採購 upsert RPC + A9h-M preserve 模式(Sean 2026-08-03 Q1=A;2026-08-06 A9h-M Q1=A/Q2=A)。'
  'order_item_procurement 對 service_role 只開 SELECT ⇒ 本函式是 **service_role 應用路徑**的唯一寫入口 '
  '(owner / SECURITY DEFINER / pg_cron / 持 owner 憑證的服務不受限 —— 不得說「繞過稽核的路徑不存在」);'
  '同交易寫 admin_audit_log(procurement.create / procurement.update)。'
  'upsert 鍵 =(order_item_id, supplier_id);create/update 由列存在性分流(非參數 NULL 分流)。'
  '🔴 payload 語意由 p_preserve_optional_fields 分兩種(A9h-M):'
  'false(預設、明細頁單列表單)= 全量 payload —— 選填欄 NULL = 寫成 NULL(員工清得掉某一欄);'
  'true(A9h 批次;那四欄在批次畫面沒有入口)= submitted_at / supplier_order_no / exception_reason / '
  'expected_arrival_date 保留該列現值,同值比較與稽核 after 一律以實際寫入值為準。'
  'true 時再提供那四欄任一非 NULL = 呼叫端矛盾意圖 ⇒ RAISE(P0001,非固定碼);旗標本身為 NULL 亦 RAISE。'
  'contact_channel **不在**保留集合內(它是批次共用欄、員工會選 ⇒ 保留會打壞批次改管道),'
  '但 true 時它**必填** —— 正規化後為 NULL ⇒ RAISE(留空會靜默清掉各列既有管道;Sean 2026-08-06 拍板)。'
  '同 payload 重放 = NO_CHANGE(零寫入零稽核不動日期),**且不受供應商事後停用影響**。'
  '回 17 固定碼:CREATED / UPDATED / NO_CHANGE / ORDER_ITEM_NOT_FOUND / SUPPLIER_NOT_FOUND / '
  'SUPPLIER_INACTIVE / OVER_ALLOCATION / ALLOCATED_BELOW_RECEIVED / INVALID_INPUT / INVALID_ALLOCATED / '
  'INVALID_REPLY_STATUS / INVALID_CONTACT_CHANNEL / INVALID_SUPPLIER_ORDER_NO / INVALID_EXCEPTION_REASON / '
  'SUBMITTED_AT_OUT_OF_RANGE / SUBMITTED_AT_IN_FUTURE / EXPECTED_ARRIVAL_OUT_OF_RANGE。'
  '停用供應商(Q1=A):擋新建與 allocated 調升,事實記錄欄更新照常。'
  'first_ordered_at 僅首寫、status_changed_at 每次真更新(皆 clock_timestamp,非交易起始時間)。'
  'received_quantity 不由本 RPC 寫(A4a 的 P4A01 守門);摘要重算在 A4a、跨列總量守門在 A2b1。'
  '鎖序 = procurement 列 FOR UPDATE → suppliers FOR SHARE → (trigger) order_items NKU;'
  '「無環」限定每交易單次呼叫且不與 admin_upsert_supplier 混呼同交易。'
  '呼叫端契約:斷言回傳碼 ∈ 17 碼全集;preserve=false 時表單全欄 hydrate 自最新列;'
  'submitted_at 的 offset 由 server 補 Asia/Taipei。EXECUTE 僅 service_role。';

-- ── 3. EXECUTE 權限重建 ─────────────────────────────────────
-- 🔴 DROP FUNCTION 會**一併帶走舊簽章的 ACL**(基底檔 :809-814 自己載明)⇒ 這裡是重建不是補強。
-- 🔴 函式預設 ACL 是 EXECUTE TO PUBLIC ⇒ 只 GRANT 不 REVOKE = 開後門(SECURITY DEFINER 尤甚)。
REVOKE ALL ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean)
  TO service_role;

-- ── 4. 檔內 fail-closed 驗收(任一不符則整支 migration 回滾)────
-- 基底 20260803160000:485-793 的 3a-3k 照抄並依 12 參更新,再加 A9h-M 專屬的 3l。
DO $verify$
DECLARE
  v_oid   oid := 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure;
  v_owner oid;
  v_cnt   integer;
  v_txt   text;
  v_def   text;
BEGIN
  -- 3z. 🔴 A9h-M M5 後半:同名函式必須**恰一支** —— 舊 11 參簽章沒被拆掉的話
  --     PostgREST 具名呼叫會撞多載歧義,而上面每一條斷言都只看 v_oid、對此全盲。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_upsert_item_procurement';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A9h-M 異常 — admin_upsert_item_procurement 應恰 1 支多載(實 % 支;舊簽章殘留 = PostgREST 歧義);拒繼續', v_cnt;
  END IF;

  -- 3a. SECURITY DEFINER + search_path 釘死
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'A5a 異常 — 應為 SECURITY DEFINER;拒繼續';
  END IF;
  SELECT pg_catalog.array_to_string(proconfig, ',') INTO v_txt
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_txt IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'A5a 異常 — proconfig 應為 search_path=public, pg_temp,實 [%];拒繼續', v_txt;
  END IF;

  -- 3b. 參數簽章逐字(含參數名;多任何一個入口這條就紅)。
  --     🔴 identity_arguments 回**全稱** timestamp with time zone(A6 3b 實測踩過)、
  --        且**不含 DEFAULT 值**(第 12 參只出現型別)—— 期望字面沿用基底 :507 已實測通過的
  --        形狀,只在尾端接上第 12 參。DEFAULT 的釘死交給下方 3l。
  SELECT pg_catalog.pg_get_function_identity_arguments(v_oid) INTO v_txt;
  IF v_txt <> 'p_order_item_id uuid, p_supplier_id uuid, p_allocated_quantity integer, p_reply_status text, p_contact_channel text, p_submitted_at timestamp with time zone, p_supplier_order_no text, p_exception_reason text, p_expected_arrival_date date, p_actor text, p_request_id text, p_preserve_optional_fields boolean' THEN
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

  -- 3e-2. 🔴 有效權限:3d/3e 攤的是**直接授權**,role 繼承(某天有人 `GRANT service_role TO anon`)
  --       在 proacl 裡看不見 ⇒ 兩條照樣綠而 anon 已能呼叫。
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

  -- 3f. owner 對齊**四張表**:SECURITY DEFINER 的全部安全語意 = 以 owner 身分跑;
  --     四張表都是 zero-policy RLS,非 owner 的 SELECT 會靜默回空、INSERT 直接 42501。
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

  -- 3g-3. suppliers 表級 ACL 同樣不得被本片放寬
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

  -- 3i. 上游前置物件在位(逐支釘 表 × 函式 × enabled 三元組)
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
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname = 'order_item_procurement_received_quantity_guard_bt' AND NOT t.tgisinternal
     AND t.tgrelid = 'public.order_item_procurement'::regclass
     AND t.tgenabled = 'O';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A5a 異常 — A4a 的 received 直寫守門(P4A01)不在或被停用(實命中 %);拒繼續', v_cnt;
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname  = 'order_item_procurement_business_key';
  IF v_txt IS DISTINCT FROM 'UNIQUE (order_item_id, supplier_id)' THEN
    RAISE EXCEPTION 'A5a 異常 — business key 應為 UNIQUE (order_item_id, supplier_id),實 [%];拒繼續',
      coalesce(v_txt, '<不存在>');
  END IF;

  -- 3j. 函式定義字面錨(以 lower() 比對免大小寫繞過;誠實界同基底 ——
  --     文字比對不是控制流分析,等價重構會合法誤紅、行為證據在 scripts/a5a-verify.sh)。
  v_def := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid));

  -- (a) 摘要快取表零出現(重算是 A4a 的職責;守門與寫入都不得讀它)
  IF pg_catalog.strpos(v_def, 'order_item_quantity_summary') <> 0 THEN
    RAISE EXCEPTION 'A5a 異常 — 本 RPC 竟引用摘要表(A1 row C1 禁令 / 職責重複);拒繼續';
  END IF;
  -- (a2) 不得直呼 A4a 的重算 helper(同一筆寫入被重算兩次,值一樣但白做且多一次 parent 鎖)
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
    -- 交易起始時間 ⇒ 同交易兩次真更新會拿到相同 status_changed_at ⇒ 整支函式禁用該函式名。
    IF n_now <> 0 THEN
      RAISE EXCEPTION 'A5a 錨異常 — 函式體不得使用交易起始時間函式(戳記與未來判定一律 clock_timestamp),實 % 次;拒繼續', n_now;
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
  -- 🔴 A9h-M M8:COMMENT 的 payload 語意字面必須跟上行為 —— 基底寫的是無條件
  --    「選填欄 NULL = 寫成 NULL」,在 preserve=true 下不再恆真。
  IF v_txt NOT LIKE '%p_preserve_optional_fields%' THEN
    RAISE EXCEPTION 'A9h-M 異常 — COMMENT 未載明 preserve 模式(契約註解落後於行為);拒繼續';
  END IF;

  -- 3l. 🔴 A9h-M 專屬:preserve 的四項結構事實(M1/M2/M3/M4 + DEFAULT)。
  --     每一條都對應一個真實可犯的錯,且都能被「把該處改回參數」這個突變殺掉。
  DECLARE
    -- 第 12 參的存在與 DEFAULT:pronargs / pronargdefaults 是 catalog 事實;
    -- DEFAULT 的**值**釘在 functiondef 字面(寫成 true ⇒ 明細頁單列表單靜默失去清空能力,
    -- 而且沒有任何行為測試會紅 —— 這條是承重的)。
    n_args     integer := (SELECT pronargs        FROM pg_catalog.pg_proc WHERE oid = v_oid);
    n_defs     integer := (SELECT pronargdefaults FROM pg_catalog.pg_proc WHERE oid = v_oid);
    -- 旗標恰 5 次 = 簽章 1 + 步 1n NULL 閘 1 + 步 1p 矛盾閘 1 + 步 5p channel 必填閘 1 + 步 11p 分流 1。
    -- 拿掉其中任一道都會掉到 4 ⇒ 紅。
    -- ⚠️ 誠實界(關卡2 F6):這是**存在性**計數,對「保留選擇器、改壞值」型突變是盲的
    --    (例如把步 11p 的條件反轉、或把 v_eff_* 交叉指派)—— 那一族由
    --    scripts/a5a-verify.sh 的 P 區行為格 + M9/M10 常駐突變格承重,不是這裡。
    -- ⚠️ 反向代價:在**函式體註解**裡寫出這個參數全名會讓計數變 4 ⇒ 合法編輯被誤紅、擋住 apply。
    --    方向是 fail-loud、可接受;真要提它就寫「保留旗標」而不要寫全名。
    n_pres     integer := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'p_preserve_optional_fields', '')))
                          / pg_catalog.length('p_preserve_optional_fields');
    -- M1:UPDATE 的 SET 清單四欄必須接 effective 變數(改回參數 ⇒ 保留失效)
    n_m1 integer := CASE
      WHEN v_def ~ 'submitted_at[[:space:]]*=[[:space:]]*v_eff_submitted_at'
       AND v_def ~ 'supplier_order_no[[:space:]]*=[[:space:]]*v_eff_order_no'
       AND v_def ~ 'exception_reason[[:space:]]*=[[:space:]]*v_eff_reason'
       AND v_def ~ 'expected_arrival_date[[:space:]]*=[[:space:]]*v_eff_expected_date' THEN 1 ELSE 0 END;
    -- M2:同值 no-op 的比較基準必須是 effective 值(改回參數 ⇒ preserve 時每次都判成有變更、
    --     白推 status_changed_at 且多寫一筆稽核)
    n_m2 integer := CASE
      WHEN v_def ~ 'v_before\.submitted_at[[:space:]]*is not distinct from[[:space:]]*v_eff_submitted_at'
       AND v_def ~ 'v_before\.supplier_order_no[[:space:]]*is not distinct from[[:space:]]*v_eff_order_no'
       AND v_def ~ 'v_before\.exception_reason[[:space:]]*is not distinct from[[:space:]]*v_eff_reason'
       AND v_def ~ 'v_before\.expected_arrival_date[[:space:]]*is not distinct from[[:space:]]*v_eff_expected_date' THEN 1 ELSE 0 END;
    -- M3:稽核 after 必須記 effective 值(改回參數 ⇒ 列留舊值而稽核記 NULL,兩者矛盾)
    n_m3 integer := CASE
      WHEN v_def ~ '''submitted_at'',[[:space:]]*v_eff_submitted_at'
       AND v_def ~ '''supplier_order_no'',[[:space:]]*v_eff_order_no'
       AND v_def ~ '''exception_reason'',[[:space:]]*v_eff_reason'
       AND v_def ~ '''expected_arrival_date'',[[:space:]]*v_eff_expected_date' THEN 1 ELSE 0 END;
  BEGIN
    IF n_args <> 12 THEN
      RAISE EXCEPTION 'A9h-M 異常 — 參數應 12 個(基底 11 + preserve 旗標),實 %;拒繼續', n_args;
    END IF;
    IF n_defs <> 1 THEN
      RAISE EXCEPTION 'A9h-M 異常 — 帶預設值的參數應恰 1 個(僅 preserve 旗標;多一個 = 有欄位變成可省略、漏送不再是型別紅),實 %;拒繼續', n_defs;
    END IF;
    IF pg_catalog.strpos(v_def, 'p_preserve_optional_fields boolean default false') = 0 THEN
      RAISE EXCEPTION 'A9h-M 異常 — preserve 旗標的預設值必須逐字為 false(寫成 true ⇒ 明細頁單列表單靜默失去清空能力、零測試會紅);拒繼續';
    END IF;
    IF n_pres <> 5 THEN
      RAISE EXCEPTION 'A9h-M 錨異常 — p_preserve_optional_fields 應恰 5 次(簽章 / 步 1n NULL 閘 / 步 1p 矛盾閘 / 步 5p channel 必填閘 / 步 11p 分流),實 % 次;少一次 = 其中一道被拿掉;拒繼續', n_pres;
    END IF;
    IF n_m1 <> 1 THEN
      RAISE EXCEPTION 'A9h-M 錨異常 — UPDATE 的四個選填欄必須寫入 v_eff_* (M1);拒繼續';
    END IF;
    IF n_m2 <> 1 THEN
      RAISE EXCEPTION 'A9h-M 錨異常 — 同值 no-op 的四個選填欄必須比對 v_eff_* (M2;比對參數會讓 preserve 每次都判成有變更);拒繼續';
    END IF;
    IF n_m3 <> 1 THEN
      RAISE EXCEPTION 'A9h-M 錨異常 — 稽核 after 的四個選填欄必須記 v_eff_* (M3;記參數會讓稽核與資料列矛盾);拒繼續';
    END IF;
  END;

  RAISE NOTICE 'A9h-M 結構驗收全數通過(單一多載 / SECDEF / search_path / 12 參簽章 / DEFAULT false / 函式 ACL / 四表 owner 對齊 + FORCE RLS off / 兩表 ACL 未放寬 / 稽核八欄 + INSERT / 上游 trigger 與 business key / 12 條基底字面錨 + 4 條 preserve 錨 / COMMENT 17 碼 + preserve 語意)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 apply 之後的硬前置(本檔做不到,不得當成已完成):
--    `packages/adapters/src/supabase/database.types.ts` 重 gen ——
--    本片改了 RPC 簽章 ⇒ Functions 區塊的 Args 會多一項,而該檔由**正式站** schema 產生。
--    🔴 重 gen 會沖掉檔內的人工校正 ⇒ 重 gen 後必須**照該檔檔頭宣告的計數**逐處貼回、
--       以 typecheck 轉綠為證(該檔 :1-4 明訂計數的唯一權威在檔頭,下游不得複述數字)。
--    🔴 並且需 `NOTIFY pgrst, 'reload schema'` + 具名參數 smoke(12 參與 11 參形態各一次),
--       確認 PostgREST cache 已重載且 DEFAULT 參數向後相容。
--
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)——
--    **不是** DROP 掉本片就好:DROP 12 參簽章會讓函式整個消失(基底的 11 參版已在本檔被拆)。
--    正確 down 的**第一句必須是** `DROP FUNCTION public.admin_upsert_item_procurement(
--      uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean);`
--    🔴🔴 **漏掉這句會造出雙多載**(關卡2 F2 實錘):基底 `20260803160000:107` 是裸的
--    `CREATE FUNCTION`(它是首建、自己沒有 DROP 句)⇒ 在 12 參仍在時照抄基底,
--    會變成 11 參與 12 參**並存**,PostgREST 具名呼叫當場歧義 —— 正是本檔 3z 存在的理由,
--    而基底自己的驗收 DO 只看 11 參那個 oid、**對多載完全看不見** ⇒ 災難當天才紅。
--    DROP 之後再套基底的 CREATE FUNCTION + COMMENT + REVOKE/GRANT 全段,並重跑「同名恰一支」斷言。
--    🔴 且**下游先撤**:A9h-2 批次 coordinator(未建)→ A9d1 server actions → A10b UI;
--       先回滾會讓送 12 參的呼叫端撞 PostgREST 找不到多載。
--
-- 🔴 A2b1 / A4a 單獨回滾時,本 RPC **必須同停**(兩檔已載明)。
--    停法 = docs/runbooks/a4a-summary-rollback.md 步驟①(REVOKE + drain 斷言)——
--    該檔的簽章字面已隨本片同 commit 更新為 12 參。
-- ============================================================
