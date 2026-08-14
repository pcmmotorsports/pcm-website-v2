-- ============================================================
-- #452 片 2a-2「甲」· 回退腳本(forward-only 之下的手動 down)
-- ============================================================
-- 標的 = supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql
-- 用法 = psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/452a-down.sql
--
-- 🔴 **本片沒有可單獨回退的路,是 `code-reviewer` 2026-08-14 nit 5 抓到的**:
--    `scripts/452-down.sql`(2a-1 的)對這兩支 writer **零命中** ⇒ 甲片一旦 apply 就退不掉。
--    ⇒ 本檔補上。**回退腳本未就緒前,甲片不得排 apply**(主視窗 2026-08-14 釘死)。
--
-- ── 這支做什麼 ──────────────────────────────────────────
--   把兩支相鄰 writer 還原成 2a-2 甲【之前】的定義(逐字,由程式從正式庫抽出後凍結在本檔)。
--   ⚠️ 它**不動** `voided_at` / `void_reason` 兩欄與業務鍵索引 —— 那是 2a-1 的東西,
--      要退那些請走 `scripts/452-down.sql`,且**必須在本檔之後**(逆序)。
--
-- ── 🔴 ACL:reviewer 提出「回退會掉 ACL」,我實測後採【不同做法】,理由寫在這 ──
--   reviewer 的依據 = A5a 的前身是 `CREATE FUNCTION`(`20260806200000:79`)不是 `OR REPLACE`
--   ⇒ 推論「回退是 DROP+CREATE ⇒ ACL 不保留 ⇒ 必須一併 GRANT」。
--   **那個推論對「換簽章」的情形成立**(20260806200000 確實先 DROP 再 CREATE,因為它加了第 12 個參數)。
--   **但本檔的回退【不換簽章】** ⇒ 可以用 `CREATE OR REPLACE` ⇒ **不需要 DROP、ACL 原封保留**。
--   🔴 我沒有拿這個推論當結論 —— 本檔**下方有 ACL 後置斷言**,退完當場驗:
--      owner 以外只准 service_role 的不可轉授 EXECUTE,且恰 1 項。
--      **若哪天有人把本檔改成 DROP+CREATE,那道斷言會當場紅**,而不是靜默掉權限。
--   ⚠️ 也就是說:reviewer 指出的風險是真的,我用**斷言**接它、不是用**多發一次 GRANT** 接它
--      —— 因為多發 GRANT 會讓「ACL 掉了」這件事**永遠不會被發現**。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 前置閘 ──────────────────────────────────────────────
DO $gate$
DECLARE v_cnt integer; v_src text;
BEGIN
  -- D1. 甲片確實在(不在 ⇒ 沒 apply 過或已退過 ⇒ 不要重跑)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure
     AND pg_catalog.strpos(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
             '--[^' || chr(10) || ']*', '', 'g'),
           'AND voided_at IS NULL') > 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452a-down D1:A5a 沒有 voided 分流 ⇒ 甲片沒 apply 過或已退過;拒繼續(不要重跑)';
  END IF;

  -- D2. 🔴 乙(void RPC)【不得】還在 —— 它會引用本片的分流語意
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452a-down D2:偵測到 admin_void_item_procurement 仍存在(% 支)⇒ 必須先逆序退掉乙,否則退掉甲會留下「會產生 voided 列、但相鄰 writer 不認得」的洞;拒繼續', v_cnt;
  END IF;

  -- D3. 🔴 **不設「零筆被作廢」閘** —— 與前推的 P5 方向相反,這是刻意的。
  --     本檔零資料損失;在這裡設那道閘 = 已經有作廢列之後就再也退不掉甲片,
  --     而那正是最需要退的時刻(plan §4.2 的 fail-DANGEROUS 段)。
  --     ⚠️ 但要知道:**退掉甲片之後,若庫裡已有 voided 列,相鄰 writer 就不再認得它們**
  --     ⇒ 退完請立刻確認 voided 列數;非 0 就是人工處置的範圍,回報 Sean。
  RAISE NOTICE '452a-down 前置閘 D1-D2 通過(D3 刻意不設,理由見註解)。';
END
$gate$;

-- ── 還原兩支 writer 成 2a-2 甲【之前】的定義(逐字凍結)──────
-- 🔴 用 CREATE OR REPLACE、**不 DROP**:簽章未變 ⇒ ACL 原封保留(下方有斷言驗它)。
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
$function$

;

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

-- ── 後置斷言(任一不符 ⇒ 整支回滾)──────────────────────
DO $verify$
DECLARE
  v_a5a constant regprocedure := 'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure;
  v_rcp constant regprocedure := 'public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'::regprocedure;
  v_src text; v_cnt integer; v_oid regprocedure;
BEGIN
  -- 1. 甲片的兩處分流都不見了(剝註解後比,理由同 migration)
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc WHERE oid = v_a5a;
  IF pg_catalog.strpos(v_src, 'AND voided_at IS NULL') <> 0 THEN
    RAISE EXCEPTION '452a-down 後置 1:A5a 的 voided 分流還在 ⇒ 還原沒生效;拒繼續';
  END IF;
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc WHERE oid = v_rcp;
  IF pg_catalog.strpos(v_src, 'PROCUREMENT_VOIDED') <> 0 THEN
    RAISE EXCEPTION '452a-down 後置 2:receipt 的作廢分流還在 ⇒ 還原沒生效;拒繼續';
  END IF;

  -- 2. 🔴 ACL 斷言 —— reviewer nit 5 指出的風險用這道接,不是用「多發一次 GRANT」接。
  --    多發 GRANT 會讓「ACL 掉了」永遠不被發現;斷言會讓它當場紅。
  FOR v_cnt IN SELECT unnest(ARRAY[0, 1]) LOOP
    v_oid := CASE v_cnt WHEN 0 THEN v_a5a ELSE v_rcp END;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner
       AND NOT (a.grantee = 'service_role'::regrole::oid
                AND a.privilege_type = 'EXECUTE' AND a.is_grantable = false);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '452a-down 後置 ACL1:% 的 ACL 有 % 項是「owner 以外、非 service_role 不可轉授 EXECUTE」;拒繼續', v_oid, v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_oid AND a.grantee = 'service_role'::regrole::oid
       AND a.privilege_type = 'EXECUTE' AND a.is_grantable = false;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '452a-down 後置 ACL2:% 掉了 service_role 的不可轉授 EXECUTE(實 % 項)—— 若你剛把本檔改成 DROP+CREATE,這就是原因;拒繼續', v_oid, v_cnt;
    END IF;
  END LOOP;

  -- 3. 屬性未被還原動作弄壞
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc
   WHERE oid IN (v_a5a, v_rcp) AND prosecdef
     AND 'search_path=public, pg_temp' = ANY(proconfig);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '452a-down 後置 3:兩支的 SECDEF / search_path 不完整(實 %);拒繼續', v_cnt;
  END IF;

  -- 4. 🔴 退完的現況觀察(不擋,但要印出來讓值班的人看到)
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement WHERE voided_at IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE WARNING '452a-down ⚠️ 庫裡有 % 筆已作廢的採購,而相鄰 writer 現在【不再認得它們】⇒ 人工處置範圍,請回報 Sean(不要自行清資料)', v_cnt;
  END IF;

  RAISE NOTICE '452a-down 後置斷言全過(分流已移除 / ACL 原封 / SECDEF+search_path 完整;voided 列數 = %)。', v_cnt;
END
$verify$;

COMMIT;

-- ============================================================
-- 🔴 forward-only 紀律:回退不會拿掉 supabase_migrations.schema_migrations 那一列
--    ⇒ 回退當天必須在 supabase/APPLIED.tsv 與當日 handoff 寫明「已回退」
--    (沿用 docs/runbooks/2026-08-13-452-procurement-void-rollback.md:119-123)。
-- 🔴 逆序:本檔(甲)必須在 scripts/452-down.sql(2a-1)【之前】跑。
-- ============================================================
