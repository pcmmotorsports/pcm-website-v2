-- ============================================================
-- M-4b E10 第 2 批 B2 · S1a-1:出貨包裹主表(`public.shipments`)
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md`(v5.3,停損版)。
-- 本片 = 該 plan 的 S1a-1:**只建表 + 全部恆時 CHECK + block 刪除 + ACL/RLS**。
--
-- 🔴 本批是「停損版」:v4 原本要一併把 shipped 併進 `order_item_quantity_summary`,
--    K1 R3 證明「shipped 該在哪一層被強制」的三代分析全被證偽(§0.1)⇒ 整層退回未定案、
--    本批只交付兩張表。**做完員工一件事都不能做**(完成地圖第 8-11 項全部維持 ❌)。
--
-- 🔴 本片刻意不含(每一項都有承接者,不是忘了):
--   · `shipment_items` 與 parent guard、X1 presence         = S1b(同批下一支)
--   · `shipments` 的可變性守門(X2/X8/A2)與 touch          = S1a-2(同批下一支)
--   · 摘要表 `shipped_quantity`、C6/C7、A4a 重算第四軸      = 下一線(S2;Sean 08-05 已拍 Q1=A 走 C9)
--   · 出貨 owner RPC / 出貨 UI / 出貨通知                    = MP §5.2 項 2/3/6
--   ⇒ **本片交付後零「應用」writer**:service_role 只有 SELECT ⇒ 走 PostgREST/應用連線的路徑
--     無任何 INSERT 入口。🔴 **但 table owner 仍可直寫**(codex K2 #1):owner 不受表級 ACL 限制,
--     且本表**刻意不 FORCE RLS** ⇒ owner 連 zero-policy 都豁免。本檔所有 harness 正是以 owner
--     身分寫入的 —— 這不是漏洞,是「DB 層擋不住 owner」的事實(同 A6 的誠實邊界)。
--     **不得把「零 writer」讀成「沒有任何東西寫得進去」。**
--
-- 已拍板約束(逐條落在下方欄位或 CHECK):
--   U1 併箱(本表**無 order_id**)/ Q1=B 只認同一位客人、收件資料以本表快照為準 /
--   Q10=A 獨立編號 / Q19=A 無後綴 / U7 **無 delivered** / Q2=A 單號可改 /
--   Q3=A 作廢退量(soft delete、可 unvoid)/ Q4=C 快遞固定三選 + 其他 /
--   Sean 08-05 無直送 / Q-a=C 與 Q-b=A(2026-08-05,見 plan §5.1)。
--
-- 內容分級:出貨資料由員工每日產生 ⇒ L3,走後台 CRUD(本片先落資料層)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 空白判定 helper(A3 / X4 / X7 / A8 四條守門共用)────────
-- 🔴 **為什麼不用 `btrim`**(codex K2 #6,夜跑視窗實測確認):
--    `btrim(x)` 預設只移除 **ASCII 空格 U+0020**。實測 `length(btrim(E'\t')) = 1`
--    ⇒ 一個 tab 就能冒充「非空白」,把 A3 / X7 / A8 三條守門**同時**繞過去
--    (實測:tab 當 `carrier_note` 餵 A3 → **放行**)。
-- 🔴 **也不只用 `regexp_replace(x,'\s','','g')`**:PG 的 `\s` 涵蓋 tab/換行/CR/VT/FF,
--    但**不含** U+00A0(nbsp)與 **U+3000(全形空格)**(本機實測兩者長度皆仍為 1)。
--    本專案的後台是繁體中文輸入環境,**全形空格是可預期的真實輸入** ⇒ 只擋 `\s`
--    等於留一個 CJK 使用者最容易踩到的洞(memory `feedback_control-named-beyond-its-actual-power`:
--    防護不得被命名成超出它實際能力的樣子)。
-- ⇒ 做法 = `translate` 把七種空白字元一律正規化成 ASCII 空格,再 `btrim`。
--
-- 🔴 **誠實邊界(明文,不是預設)**:本 helper 涵蓋的空白集合 =
--    TAB / LF / CR / VT / FF / U+00A0 / U+3000 這 **7 種**。Unicode 還有其他空白
--    (U+2000-U+200A 等排版空格、U+200B 零寬空格)**不在集合內** —— 它們不是繁中鍵盤或
--    常見 IME 打得出來的字元,擋它們的成本高於價值。**未來若真的遇到,加進 translate 的來源字串即可**,
--    不需要改四條 CHECK。
-- 🔴 `STRICT` 不可加:加了之後 `pcm_b2_is_blank(NULL)` 會回 **NULL** 而非 `true`,
--    而 CHECK **對 NULL 放行** ⇒ `('other', NULL)` 會直接寫得進去(這正是 v5.3 用 `COALESCE`
--    在擋的那個 NULL 坑,K1 R2 踩過一次)。本函式明文以 `true` 承接 NULL。
CREATE FUNCTION public.pcm_b2_is_blank(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT pg_catalog.btrim(
           pg_catalog.translate(
             COALESCE(t, ''),
             E'\t\n\r\v\f' || U&'\00A0' || U&'\3000',
             '       '
           )
         ) = ''
$fn$;

COMMENT ON FUNCTION public.pcm_b2_is_blank(text) IS
  'B2 空白判定:NULL 或「僅由 7 種空白字元組成」皆回 true。'
  'A3 / X4 / X7 / A8 四條 CHECK 共用 —— 改這支等於同時改那四條守門的語意,'
  '🔴 改動後既有列不會被自動重驗(PG 不會因函式改版而重跑 CHECK),要重驗必須 VALIDATE 或重建約束。';

REVOKE ALL ON FUNCTION public.pcm_b2_is_blank(text) FROM PUBLIC, anon, authenticated, service_role;

-- ── 1. 主表 ──────────────────────────────────────────────────
CREATE TABLE public.shipments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_reference text        NOT NULL,
  customer_user_id   uuid        NOT NULL REFERENCES public.customers(user_id) ON DELETE RESTRICT,
  recipient_snapshot jsonb       NOT NULL,
  carrier_code       text        NOT NULL,
  carrier_note       text,
  tracking_number    text,
  shipped_at         timestamptz,
  deleted_at         timestamptz,
  void_reason        text,
  hct_request_id     text,
  hct_raw_response   jsonb,
  hct_status         text        NOT NULL DEFAULT 'draft',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A1:產號合約(MP §5.4a)。字母表已排除 0/O/1/I/L/A/E/U(人眼易混與粗話規避),6 碼。
  CONSTRAINT shipments_reference_format
    CHECK (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$'),
  CONSTRAINT shipments_reference_unique UNIQUE (shipment_reference),

  -- A3:快遞三選(Sean 2026-07-26 Q4=C)。
  CONSTRAINT shipments_carrier_domain
    CHECK (carrier_code IN ('hct', 'sf', 'other')),

  -- 🔴 A3 的雙向配對:`other` 必須說明送法、非 other 不得留說明。
  --    NULL 坑由 `pcm_b2_is_blank` 內建的 `COALESCE` 承接(該函式**刻意不 STRICT**):
  --    少了它,`carrier_note IS NULL` 會讓整式為 NULL,而 CHECK **對 NULL 放行**
  --    ⇒ `('other', NULL)` 直接寫得進去(本機 PG17.10 實測 `INSERT 0 1`)。
  --    這與 X7 的 `void_reason` 是同型 NULL 坑,K1 R2 已在那裡踩過一次。
  --    🔴 v5.4(codex K2 #6):原用 `btrim`,只擋 ASCII 空格 ⇒ 一個 tab 即可繞過(實測放行)。
  CONSTRAINT shipments_carrier_note_pair
    CHECK ((carrier_code = 'other') = (NOT public.pcm_b2_is_blank(carrier_note))),

  -- A4:收件快照的鍵集合恰等 {name, phone, line} 且值皆 string。
  -- 🔴 **逐字照抄 `orders_ship_addr_whitelist`(`20260604120000:125-130`)的四段形狀**,不自己發明:
  --    ①typeof=object ②`?&` 三鍵都在 ③`- array[...] = '{}'` 沒有多餘鍵 ④helper 驗值皆 string。
  --    第 ④ 段必須用既有 helper(`m3_jsonb_values_all_string`,IMMUTABLE)——
  --    **CHECK 內不得有子查詢**,所以「逐鍵取 jsonb_typeof」那種寫法在 PG 是寫不出來的。
  CONSTRAINT shipments_recipient_snapshot_shape
    CHECK (
      jsonb_typeof(recipient_snapshot) = 'object'
      AND recipient_snapshot ?& ARRAY['name', 'phone', 'line']
      AND (recipient_snapshot - ARRAY['name', 'phone', 'line']) = '{}'::jsonb
      AND m3_jsonb_values_all_string(recipient_snapshot)
    ),

  -- A9:hct_status 值域。🔴 U7 拍板**沒有 delivered** —— 我們拿不到「已送達」的可靠訊號,
  --     有這個值會讓後台顯示一個永遠不會變綠的狀態。
  CONSTRAINT shipments_hct_status_domain
    CHECK (hct_status IN ('draft', 'submitted', 'failed')),

  -- X4:submitted 必須有請求識別值(UX §4 #17)。R1 抓過、v3 沒真解:
  --     舊寫法只配對 request_id 與 carrier,沒管 hct_status 本身 ⇒ `hct + submitted + 全 NULL` 仍過。
  -- 🔴 v5.4(codex K2 #7,夜跑實測):`IS NOT NULL` 不夠 —— `''` 與 `'   '` 都能讓 submitted 合法
  --    (實測 `INSERTED_EMPTY=1`、`INSERTED_BLANK=1`)⇒ 併入非空白判斷,與 A3/X7/A8 同一支 helper。
  CONSTRAINT shipments_hct_submitted_evidence
    CHECK (hct_status <> 'submitted' OR NOT public.pcm_b2_is_blank(hct_request_id)),

  -- X5:只有新竹會有 submitted/failed(順豐自填單號、其他無 API)。
  CONSTRAINT shipments_hct_status_carrier
    CHECK (hct_status = 'draft' OR carrier_code = 'hct'),

  -- X6:非新竹不得帶新竹的證據欄。
  CONSTRAINT shipments_hct_evidence_carrier
    CHECK (carrier_code = 'hct' OR (hct_request_id IS NULL AND hct_raw_response IS NULL)),

  -- X7:作廢與理由雙向配對,且理由不得是純空白(K1 R2 抓:'   ' 通過舊的 null-pair 寫法)。
  CONSTRAINT shipments_void_pair
    CHECK ((deleted_at IS NULL) = (void_reason IS NULL)
           AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason))),

  -- 🔴 A8:已出貨且非 other ⇒ 追蹤號必須非空白。
  --    **前提(明文列出,不是預設)**:單號在交寄當下已存在 —— 標籤先印才交寄。
  --    前提倒了的症狀 = 員工當天出不了貨(loud,不是靜默放行);
  --    承接改法 = 改 DEFERRED **或** 加 `no_tracking_reason` 欄,**不得靠刪掉這條 CHECK**。
  --    為什麼要有這條:`order_shipped` 已在 email outbox 的 allowlist(`20260717020000:315`),
  --    E4 補上模板那天,「已出貨但沒有單號」會變成一封寄給客人的到貨通知裡的空白欄。
  --    (寄送端今日仍 fail-closed throw,`packages/use-cases/src/sweep-email-outbox.ts:113`
  --     ⇒ 今天寄不出去,**風險窗從 E4 落地那一刻開始**。)
  CONSTRAINT shipments_shipped_needs_tracking
    CHECK (shipped_at IS NULL
           OR carrier_code = 'other'
           OR NOT public.pcm_b2_is_blank(tracking_number))
);

COMMENT ON TABLE public.shipments IS
  'M-4b E10 第 2 批:出貨包裹主表(B2 停損版 S1a-1)。一單多包 + 多單併一箱(U1);'
  '**本表刻意沒有 order_id** —— 一箱可含多張訂單,關聯走 shipment_items。'
  '🔴 本片落地時**零應用 writer**:service_role 只有 SELECT,出貨 owner RPC 在 MP §5.2 項 2;'
  '**table owner 直寫不受此限**(非 FORCE RLS + owner 豁免表級 ACL),明文列為未擋。'
  '永不硬刪(Q3=A soft delete + 兩支 block trigger);可 unvoid。'
  '🔴 「已寄出必有品項」(X1)由 S1b 建立 —— 本片單獨落地時該不變式尚未生效,'
  '但因為零 writer、且 shipment_items 尚不存在,實務上構造不出違反它的資料。';

COMMENT ON COLUMN public.shipments.shipment_reference IS
  '包裹編號(Q10=A 獨立編號、Q19=A 無後綴)。字母表 23456789BCDFGHJKMNPQRSTVWXYZ、6 碼。'
  '🔴 **刪除後永不重用**(MP §8.5)—— 這個保證由「本表永不硬刪」承擔;'
  '一旦 DROP TABLE,該保證即不成立(見檔尾回滾說明)。產號 helper = N3a,不在本片。';

COMMENT ON COLUMN public.shipments.recipient_snapshot IS
  '本包裹實際寄達的收件資料。🔴 **可與該包裹所含訂單的 orders.shipping_address_snapshot 不一致** —— '
  'Sean 2026-08-05 Q1=B 知情選擇(併箱只守「同一位客人」,收件逐字比對**不做**)。'
  '鍵集合恰等 {name, phone, line} 且值皆 string。';

COMMENT ON COLUMN public.shipments.carrier_code IS
  '快遞商(Sean 2026-07-26 Q4=C 三選):hct 新竹(串 API)/ sf 順豐(自填單號)/ other 其他(carrier_note 說明)。'
  '🔴 **出貨或作廢後凍結**(X8,S1a-2)。選錯的補救路徑 = **作廢重開新包裹**,留 void_reason 稽核;'
  '不得為了改快遞商而拆掉 X8。Sean 2026-08-05 Q-a=C:資料庫維持嚴格,補救做成出貨畫面的'
  '「照這箱內容開一張新的」按鈕(MP §5.2 項 3 DoD)。';

COMMENT ON COLUMN public.shipments.tracking_number IS
  '追蹤號。Q2=A **隨時可改**(打錯、新竹重開單都要能修)⇒ 不在 X8 的凍結集內。'
  '🔴 A8 保證:已出貨且 carrier_code <> other ⇒ 本欄必須非空白 ⇒ '
  '🔴 **已出貨的列**之中,`tracking_number IS NULL` 只可能發生在 `other`(自取/自送,carrier_note 有說明)。'
  '(codex K2 nit 3:少了「已出貨」這個限定詞就是假的 —— draft 的 hct/sf 包裹本來就可以還沒有單號。)'
  'E4 的 order_shipped 模板必須依此分流,不得寄出「已出貨但無單號」的通用信。';

COMMENT ON COLUMN public.shipments.shipped_at IS
  '交寄時間。🔴 **write-once**(X2,S1a-2):一旦設值永不清空、也不可改成別的時間。'
  '撤銷出貨的唯一路徑 = deleted_at 作廢(留 void_reason)。';

COMMENT ON COLUMN public.shipments.deleted_at IS
  '作廢時間(Q3=A soft delete;**任何狀態都可作廢**,含已送新竹與已出貨 —— Sean 明確不要「已送新竹不可作廢」限制)。'
  '🔴 **可 unvoid**(清回 NULL,需同時清 void_reason)。'
  '🔴 **流程風險 DB 層擋不住**:員工可在貨已實際寄出後於系統內作廢包裹。Sean 知情選擇;'
  'void_reason + 稽核是唯一事後追溯手段。**不得宣稱「作廢有防呆」。**';

COMMENT ON COLUMN public.shipments.hct_status IS
  '新竹送單狀態三段(UX §4 #17):draft 未送 / submitted 已送(必有 hct_request_id)/ failed 送單失敗待重送。'
  '🔴 **沒有 delivered**(U7 拍板)—— 我們拿不到可靠的送達訊號。'
  '🔴 已出貨後本欄**仍可寫**(不在 X8 凍結集):已出貨 + 送單失敗必須能重送,'
  '凍結它等於讓資料永遠停在 failed 這個謊。Sean 2026-08-05 Q-b=A:只保留最新一次,不留歷次。';

COMMENT ON COLUMN public.shipments.hct_raw_response IS
  '新竹 API 原始回覆(UX §4 #17 要求留存)。🔴 Q-b=A:重送會**覆蓋**前一次,只保留最新一次;'
  '若未來要留歷次,承接方案見 plan §5.1 Q-b 的備選②③(本批不做)。';

-- ── 2. 索引 ─────────────────────────────────────────────────
-- A5:hct_request_id partial unique —— 同一個請求識別值不得對應兩個包裹(重複送單的偵測點)。
-- 🔴 必須 partial:未送新竹的包裹該欄全是 NULL,普通 UNIQUE 在 PG 允許多個 NULL 所以也可以,
--    但 partial 讓「索引只含真正有值的列」這件事變成明文契約、也省空間。
CREATE UNIQUE INDEX shipments_hct_request_id_key
  ON public.shipments (hct_request_id)
  WHERE hct_request_id IS NOT NULL;

-- FK RESTRICT 的檢查與未來「按客人查包裹」都要掃這一欄;PG 不會自動為 FK 來源端建索引。
CREATE INDEX shipments_customer_user_id_idx
  ON public.shipments (customer_user_id);

-- ── 3. 永不硬刪(A6 的 shipments 半邊)────────────────────────
-- 🔴 真實範圍 = 應用程式路徑絕對不可刪;**表擁有者手動操作仍可繞過**(照抄 suppliers 的誠實邊界,
--    `20260801140000:96-100`)。任何 DB 層控制都擋不住表的擁有者 —— 這裡不假裝做得到,
--    只把成本拉高到「必須刻意繞」。
-- 🔴 不掛 SECURITY DEFINER:本函式不讀任何表,掛了不會得到任何東西,卻多一個以 owner
--    權限起跑的入口(對齊 suppliers 先例 `20260801140000:101-105`)。
CREATE FUNCTION public.pcm_b2_shipments_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '包裹永不硬刪 —— 要撤銷請走作廢(deleted_at + void_reason),否則包裹編號的「永不重用」保證會破'
    USING ERRCODE = 'P0001';
END;
$fn$;

-- 🔴 v5.4(codex K2 #3,夜跑實測):只 `FROM PUBLIC` **不夠**。Supabase shim 對
--    `anon` / `authenticated` / `service_role` 有 function 的 default privileges
--    ⇒ 實查 `aclexplode(proacl)`,這三個角色**全部**仍持有 `EXECUTE`。
--    (誠實邊界:trigger 函式在 PG **無法被直呼** —— `SET ROLE anon; SELECT …()` 紅在
--     `trigger functions can only be called as triggers` ⇒ 該 grant **不構成可利用路徑**。
--     修它的理由是「讓檔內那句 ACL 宣稱變成真的」,不是堵一個今天可觸發的漏洞。)
REVOKE ALL ON FUNCTION public.pcm_b2_shipments_block_delete() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipments_block_delete_bd
  BEFORE DELETE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_b2_shipments_block_delete();

-- 🔴 TRUNCATE 不觸發列觸發器 ⇒ 必須另掛 statement 級(suppliers 實測 ④ 就是這樣被穿過去的)。
CREATE TRIGGER shipments_block_truncate_bt
  BEFORE TRUNCATE ON public.shipments
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.pcm_b2_shipments_block_delete();

-- ── 4. RLS zero-policy + 表級 ACL ────────────────────────────
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- 🔴 **不加 FORCE**:加了 FORCE 連表擁有者都要過 policy,而本表是 zero-policy
--    ⇒ S1b 的守門函式(SECURITY DEFINER,owner 身分)會讀到零列、把合法包裹判成無品項。
--    本機實測:非 superuser owner 之下,FORCE 開啟後同一筆合法寫入紅在 `42501`(loud)。
--    ⇒ 下方 DO 有 `relforcerowsecurity = false` 的斷言把這件事釘住。
REVOKE ALL ON TABLE public.shipments FROM PUBLIC, anon, authenticated, service_role;

-- service_role 只給 SELECT:寫入一律走 owner RPC(對齊 suppliers `20260801140000:131-133`)。
GRANT SELECT ON TABLE public.shipments TO service_role;

-- ── 5. 結構驗收(apply 當下自我證明;不符即整支交易回滾)──────
-- 🔴 v5.4 全面改寫(codex K2 #4/#10/#11/#12):v5.3 的四類斷言都被實測證明沒有判別力 ——
--    ①約束只驗「這 12 條都在」、沒驗「不得有多餘」⇒ 丟掉 FK 仍過(實測 `FK_DROPPED_STILL_12=12`)
--    ②索引只驗名稱與 is-partial ⇒ 改建在**完全錯的欄位**上仍全過(實測)
--    ③函式只按 `proname` 數 ⇒ owner 換成任意角色、`search_path` 改成 `pg_temp` 皆不紅(實測)
--    ④`IF (SELECT …) NOT LIKE '%X%'` 在物件不存在時 subquery = NULL ⇒ **靜默通過**(實測)
DO $verify$
DECLARE
  v_cnt      integer;
  v_actual   text[];
  v_expected text[];
  v_txt      text;
  v_owner    oid;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.shipments'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 15 THEN
    RAISE EXCEPTION 'shipments 欄數異常 — 應 15 欄,實 %;拒繼續', v_cnt;
  END IF;

  -- ① 具名約束集合**真雙向**:用陣列全等,多一條或少一條都紅。
  -- 🔴 只取 contype IN ('p','u','f','c') —— **刻意排除 't'(constraint trigger)**:
  --    S1b 的 X1 是 constraint trigger,會在 `pg_constraint` 多出一列
  --    (實查 `shipments_items_presence_ac`|t)。不排除的話本斷言會在 S1b apply 後
  --    由綠轉紅,而那不是缺陷、是別片的合法產物(X1 的形狀由 S1b 自己的驗收釘)。
  SELECT array_agg(conname ORDER BY conname) INTO v_actual
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.shipments'::regclass AND contype IN ('p','u','f','c');
  v_expected := ARRAY[
    'shipments_carrier_domain',
    'shipments_carrier_note_pair',
    'shipments_customer_user_id_fkey',
    'shipments_hct_evidence_carrier',
    'shipments_hct_status_carrier',
    'shipments_hct_status_domain',
    'shipments_hct_submitted_evidence',
    'shipments_pkey',
    'shipments_recipient_snapshot_shape',
    'shipments_reference_format',
    'shipments_reference_unique',
    'shipments_shipped_needs_tracking',
    'shipments_void_pair'
  ];
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'shipments 約束集合不符(雙向比對)— 實際 = %,期望 = %;拒繼續', v_actual, v_expected;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.shipments'::regclass AND contype = 'c';
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION 'shipments 約束異常 — CHECK 應恰 10 條,實 %;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.shipments'::regclass AND contype = 'c' AND NOT convalidated;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'shipments 約束異常 — 未驗證 CHECK 應為 0,實 %;拒繼續', v_cnt;
  END IF;

  -- ② 空白判定的字面錨:四條守門都必須走 `pcm_b2_is_blank`,不得退回 `btrim`。
  -- 🔴 寫成 `NOT EXISTS(… AND def LIKE …)` 而不是 `IF (SELECT def) NOT LIKE …`:
  --    後者在約束被刪掉時 subquery = NULL、`NULL NOT LIKE` = NULL ⇒ `IF` 不進 THEN、**靜默放行**
  --    (夜跑實測 `SILENTLY_PASSED`)。前者在「約束不存在」與「約束在但寫錯」兩種情況**都會紅**。
  FOREACH v_txt IN ARRAY ARRAY['shipments_carrier_note_pair',
                               'shipments_hct_submitted_evidence',
                               'shipments_void_pair',
                               'shipments_shipped_needs_tracking'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.shipments'::regclass
         AND conname = v_txt
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%pcm_b2_is_blank%'
    ) THEN
      RAISE EXCEPTION 'shipments 空白判定異常 — 約束 % 不存在、或未走 pcm_b2_is_blank'
                      '(退回 btrim 會讓一個 tab 繞過整條守門);拒繼續', v_txt;
    END IF;
  END LOOP;

  -- ③ 兩個索引:用 `pg_get_indexdef` 全等,一次釘死「欄位 + 唯一性 + partial 條件」。
  --    v5.3 只驗名稱與 `indpred IS NOT NULL` ⇒ 索引改建在 shipment_reference 上仍全過(實測)。
  v_txt := pg_catalog.pg_get_indexdef('public.shipments_hct_request_id_key'::regclass);
  IF v_txt <> 'CREATE UNIQUE INDEX shipments_hct_request_id_key ON public.shipments USING btree (hct_request_id) WHERE (hct_request_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'shipments A5 索引定義不符 — 實際 = %;拒繼續', v_txt;
  END IF;
  v_txt := pg_catalog.pg_get_indexdef('public.shipments_customer_user_id_idx'::regclass);
  IF v_txt <> 'CREATE INDEX shipments_customer_user_id_idx ON public.shipments USING btree (customer_user_id)' THEN
    RAISE EXCEPTION 'shipments customer 索引定義不符 — 實際 = %;拒繼續', v_txt;
  END IF;

  -- ④ RLS:啟用 / zero-policy / **不 FORCE**
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.shipments'::regclass) THEN
    RAISE EXCEPTION 'shipments RLS 異常 — relrowsecurity 應為 true;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policy WHERE polrelid = 'public.shipments'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'shipments RLS 異常 — 應為 zero-policy,實 % 條;拒繼續', v_cnt;
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.shipments'::regclass) THEN
    RAISE EXCEPTION 'shipments RLS 異常 — 不得 FORCE(會讓 S1b 的 owner 守門讀到零列、誤殺合法包裹);拒繼續';
  END IF;

  -- ⑤ 兩支 block trigger 且啟用(具名雙向,不只數量)
  SELECT array_agg(tgname ORDER BY tgname) INTO v_actual
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal AND tgenabled = 'O';
  IF v_actual IS DISTINCT FROM ARRAY['shipments_block_delete_bd','shipments_block_truncate_bt'] THEN
    RAISE EXCEPTION 'shipments trigger 集合不符 — 實際 = %;拒繼續', v_actual;
  END IF;

  -- ⑥ 表級 ACL
  IF NOT has_table_privilege('service_role', 'public.shipments', 'SELECT') THEN
    RAISE EXCEPTION 'shipments ACL 異常 — service_role 應有 SELECT;拒繼續';
  END IF;
  IF has_table_privilege('service_role', 'public.shipments', 'INSERT')
     OR has_table_privilege('service_role', 'public.shipments', 'UPDATE')
     OR has_table_privilege('service_role', 'public.shipments', 'DELETE')
     OR has_table_privilege('service_role', 'public.shipments', 'TRUNCATE') THEN
    RAISE EXCEPTION 'shipments ACL 異常 — service_role 只應有 SELECT(寫入走 owner RPC);拒繼續';
  END IF;
  IF has_table_privilege('anon', 'public.shipments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.shipments', 'SELECT') THEN
    RAISE EXCEPTION 'shipments ACL 異常 — client 角色不應直接讀得到包裹;拒繼續';
  END IF;

  -- ⑦ 🔴 函式面合約(plan §4 項 18;v5.3 只按 proname 數 prosecdef ⇒ 判別力不足)
  --    以 **`regprocedure`(schema + 精確簽章)** 為鍵,逐支釘 owner / prosecdef / proconfig 逐字 / 零非 owner grantee。
  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = 'public.shipments'::regclass;

  -- 🔴 兩支的 `SET search_path` 本來就不同(`is_blank` 只需 pg_catalog;block_delete 沿用
  --    pg_catalog, public)⇒ 期望值必須逐支給,不能共用一個字串(否則斷言本身就是錯的)。
  FOREACH v_txt IN ARRAY ARRAY['public.pcm_b2_is_blank(text)|search_path=pg_catalog',
                               'public.pcm_b2_shipments_block_delete()|search_path=pg_catalog, public'] LOOP
    v_expected := string_to_array(v_txt, '|');
    v_txt := v_expected[1];
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure) THEN
      RAISE EXCEPTION 'shipments 函式異常 — % 不存在;拒繼續', v_txt;
    END IF;
    -- owner 必須與表 owner 一致(SECDEF 與 RLS 前提都掛在這上面;實測換 owner 零斷言會紅)
    IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure) <> v_owner THEN
      RAISE EXCEPTION 'shipments 函式異常 — % 的 owner 與表 owner 不一致;拒繼續', v_txt;
    END IF;
    -- 本片兩支都**不得**是 SECURITY DEFINER(都不讀別的表)
    IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure) THEN
      RAISE EXCEPTION 'shipments 函式異常 — % 不該是 SECURITY DEFINER;拒繼續', v_txt;
    END IF;
    -- 🔴 proconfig **逐字**比對,不是「有 search_path= 前綴就算」:
    --    實測把 search_path 改成 pg_temp,前綴式斷言照樣過(4/4)。
    IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure)
       IS DISTINCT FROM ARRAY[v_expected[2]] THEN
      RAISE EXCEPTION 'shipments 函式異常 — % 的 proconfig 應恰為 {%},實 %;拒繼續',
        v_txt, v_expected[2], (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_txt::regprocedure);
    END IF;
    -- 🔴 除 owner 外零 grantee(REVOKE FROM PUBLIC 擋不掉 shim 的具名 default grant)
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc pr, aclexplode(pr.proacl) a
     WHERE pr.oid = v_txt::regprocedure AND a.grantee <> pr.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'shipments 函式 ACL 異常 — % 除 owner 外仍有 % 個 grantee;拒繼續', v_txt, v_cnt;
    END IF;
  END LOOP;

  -- ⑧ 本片零 writer 的自我證明:表必須是空的
  SELECT count(*) INTO v_cnt FROM public.shipments;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'shipments 異常 — 本片不 seed 任何列,實 % 列;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'B2 S1a-1 結構驗收全數通過(15 欄 / 13 具名約束雙向含 FK / 10 CHECK / 四條走 pcm_b2_is_blank / 2 索引定義全等 / RLS zero-policy 不 FORCE / 2 trigger 具名 / 表 ACL / 2 函式 owner+proconfig+零 grantee / 0 列)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
-- 反向順序 = S1b → S1a-2 → **S1a-1(本片,最後)**;本片的 down 必須逐項:
--   ① DROP TRIGGER shipments_block_delete_bd / shipments_block_truncate_bt
--   ② **DROP FUNCTION public.pcm_b2_shipments_block_delete()**
--      —— `DROP TABLE` 只帶走 trigger、**不帶走獨立函式**(K1 R3 抓:v5 原文在本片這行漏了這步)
--   ③ DROP TABLE public.shipments(兩個索引隨表走)
--   ③b 🔴 **DROP FUNCTION public.pcm_b2_is_blank(text)**(v5.4 新增的空白判定 helper;
--       必須排在 DROP TABLE **之後** —— 四條 CHECK 相依於它,表還在時 DROP 會紅在 2BP01)
--   ④ 重 gen database.types.ts
--
-- 🔴 **一旦有真實包裹就不要 DROP**:`shipment_reference` 的「永不重用」保證由本表的存在承擔,
--    DROP 之後該保證不成立。真要 DROP,必須把舊編號**持久化進留存表**並讓產號重試迴圈實際查它
--    —— 匯出成檔案沒有約束力(沒有任何程式會去讀那個檔)。
-- ============================================================
