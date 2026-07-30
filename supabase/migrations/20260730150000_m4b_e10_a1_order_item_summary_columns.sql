-- ============================================================
-- M-4b · E10 訂單閉環第 1 批 · A1:訂單品項數量摘要表(員工專用)
-- ============================================================
-- 片級 plan = docs/specs/2026-07-30-e10-a1-order-item-summary-columns-plan.md(**v2**)
-- 真權威 = docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1c(四條不變式)+ §1 原則 2/3/4
-- 🔴 **§5.1 row 26 的落點字面(「order_items 加三欄」)已被 Sean 2026-07-31 拍板推翻**;
--    master plan 該列同 commit 更新。決策全文 = memory project_m4b-a1-summary-columns-decisions。
-- 片型 = 高風險片(鐵則 12 ③ DB 結構 + 動 live order_items)。
--
-- ── 這片在做什麼 ────────────────────────────────────────────
-- 建一張**只有員工看得到**的摘要表,一個訂單品項最多一列,存三個數量:
--   ordered_quantity   已向供應商訂了幾件   ← A2 order_item_procurement.allocated_quantity 之和
--   instock_quantity   已到貨幾件           ← A2 逐批到貨明細 received_quantity 之和
--   cancelled_quantity 已取消幾件           ← A7 order_cancellation_items
--
-- 🔴 本片只挖格子、不接線:表建完是**空的**,repo 內沒有任何路徑會寫它。
--    唯一 writer = A4a 重算 trigger(尚未施工)。本片零 trigger、零函式、零 RPC 改動。
--
-- ── 🔴 為什麼是新表而不是加在 order_items(原設計已作廢)────
-- order_items 對登入客人有**表級 SELECT**(20260604120000:191 逐字
-- `GRANT SELECT ON TABLE order_items TO authenticated`)+ own-order RLS(:197-203),
-- 而 public schema 經 Data API 對外曝露
-- ⇒ 加在那張表上,**apply 當下客人打 API 就讀得到「已訂購/已到貨」**,
--    與前台有沒有寫渲染程式碼**完全無關**。
-- 而 Sean 2026-07-31 逐字要求「我不會讓客人知道進度,只會有狀態顯示」。
-- ⇒ 改放本表(客人零權限 + RLS zero-policy)⇒ **「客人看不到」從約定升級為物理保證**。
-- 🔴 原設計還把「前台不得顯示」寫進欄註解並自稱「機制」——
--    COMMENT 沒有任何強制力,那是留言不是機制。真正的機制是下面 §3 的 ACL。
--
-- ── 為什麼 quantity 要複製一份進來 ──────────────────────────
-- 四條不變式全都要跟「客人買了幾件」比,而 quantity 在 order_items。
-- 若不複製,「instock + cancelled <= quantity」就跨表、CHECK 表達不了,
-- 只能改用 A7-t 那種 DEFERRED CONSTRAINT TRIGGER ⇒ 直接繼承 backlog #307 的併發漏洞。
-- ⇒ 複製一份、用**複合 FK (order_item_id, quantity) → order_items(id, quantity) 釘死**,
--    兩邊不一致就沒有對應父列、FK 直接拒絕 ⇒ **不是兩份真相,是 FK 保證的投影**。
--    同款手法先例:A7 order_cancellation_items 的兩道複合 FK(20260730130000)。
--
-- ── 為什麼摘要列惰性建立、不回填 ────────────────────────────
-- 若要求「每個 order_item 都有一列」,create_order 就得多插一列 = **改動金流路徑的 RPC**。
-- 改成惰性(有採購或取消活動才建列)⇒ create_order **零改動**、**無回填**、
-- **不對 order_items 跑任何 UPDATE**(歷史凍結欄不可能被動到)。
-- 🔴 代價(誠實寫下):**「無列 = 三個 0」這個約定沒有 DB 強制力**,靠讀取端 LEFT JOIN + COALESCE。
--    ⇒ 契約債,承接者 = A4a(建列)/ A9c、A11a-c(讀取端必須 COALESCE)。見下方 COMMENT。
--
-- ── 依賴 ────────────────────────────────────────────────────
-- 20260604120000(order_items 表、quantity 欄與其 CHECK quantity > 0)
-- 20260725130100:76-77(既有 order_items_order_id_id_key = UNIQUE (order_id, id)
--   —— 🔴 **欄組不同、不能給本片的 FK 用**,故本片另加 UNIQUE (id, quantity))
-- 🔴 依賴關係的精確講法(R2 nit 更正):**新表結構**不依賴 A2 / A7(七條 CHECK 只引用本表自己的欄),
--    但**本檔整體依賴 A2 已存在** —— §4b 對 `order_item_procurement` 下了 COMMENT,A2 不存在會直接失敗。
--    依 migration 版本序(A2 = 20260729020000 早於本檔)這在正常流程必然成立。
--
-- ── 🔴 rollout 前置(不是本檔能保證的,寫給執行 apply 的人)──
-- 正式庫 migration ledger 目前停在 20260730130000 ⇒ 推本檔時會**連 A7-t(20260730140000)一起套**。
-- ⇒ A7-t 應先單獨 apply 並完成 read-back;否則須按「兩片聯合套用」重寫驗證與回滾程序。
-- ⇒ 另:本檔為顯式單一交易,中途失敗 = 整批 rollback,**不會留下半套用 schema**;
--    repo 真正發生過的風險是「COMMIT 成功但 CLI ledger 未登記」(見 20260716120000:42-43)
--    ⇒ apply 後必須三方回讀(schema / 資料 / supabase migration list),不得盲目重跑。
-- ============================================================

BEGIN;

-- 🔴 lock_timeout 限制的是**本 migration 等鎖**,不限制結帳交易等待本 migration。
--    下面第 1 步的 ADD CONSTRAINT 會取 ACCESS EXCLUSIVE 並**持有到 COMMIT**。
--    現況 order_items 列數為十位數級 ⇒ 唯一索引建構毫秒級;
--    列數若成長到萬級,apply 前必須重新評估(plan §3.3 的 row-count gate)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ══ 1. order_items:為複合 FK 加唯一約束(本片對 live 表的唯一改動)═══════════
-- 🔴 純加唯一索引:不改資料、不改既有約束語意、不影響 create_order。
--    既有的 order_items_order_id_id_key 是 (order_id, id),欄組不同 ⇒ 不能重用。
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_id_quantity_key UNIQUE (id, quantity);


-- ══ 2. 摘要表 ════════════════════════════════════════════════════════════════
CREATE TABLE public.order_item_quantity_summary (
  order_item_id      uuid    PRIMARY KEY,

  -- 🔴 去正規化欄。存在的唯一理由 = 讓下方四條「跟 quantity 比」的 CHECK 成為同表 CHECK。
  --    值的正確性由複合 FK 物理保證,不靠任何程式自律。
  quantity           integer NOT NULL,

  ordered_quantity   integer NOT NULL DEFAULT 0,
  instock_quantity   integer NOT NULL DEFAULT 0,
  cancelled_quantity integer NOT NULL DEFAULT 0,

  -- ── 複合 FK:釘死 quantity 與品項歸屬 ──
  CONSTRAINT order_item_quantity_summary_item_fk
    FOREIGN KEY (order_item_id, quantity)
    REFERENCES public.order_items (id, quantity)
    ON DELETE CASCADE,

  -- ── 七條 CHECK(名稱凍結:probe / 結構斷言 / rollback 三處引用同一組)──
  --
  -- 🔴 獨立性誠實標記(plan §4.1;本片主動承認、非被抓到才改):
  --    C1 被 C2+C5 蘊含(ordered >= instock >= 0)
  --    C6 被 C2+C7 蘊含(cancelled <= instock + cancelled <= quantity)
  --    ⇒ C1 / C6 在行為層**物理上無法單獨觸發**,本片**不宣稱**它們有行為獨立性,
  --      只做結構存在性與定義逐字比對。保留理由 = master plan §5.1c 四條字面完整 + 可讀性。
  CONSTRAINT oiqs_ordered_nonneg   CHECK (ordered_quantity   >= 0),   -- C1 🟡 冗餘
  CONSTRAINT oiqs_instock_nonneg   CHECK (instock_quantity   >= 0),   -- C2 ✅
  CONSTRAINT oiqs_cancelled_nonneg CHECK (cancelled_quantity >= 0),   -- C3 ✅

  -- §5.1c 第一條:訂購數不超過客人買的數量。
  CONSTRAINT oiqs_ordered_le_quantity CHECK (ordered_quantity <= quantity),   -- C4 ✅

  -- §5.1c 第二條:到貨數不超過訂購數 —— 語意 = **沒下單就不可能到貨**。
  -- 🔴 若日後出現「上游主動多送 / 未經採購紀錄的到貨」,這條會擋住。
  --    正解是**連同 A2 的來源模型一起改不變式**,不是繞過它、也不是手填欄位。
  CONSTRAINT oiqs_instock_le_ordered CHECK (instock_quantity <= ordered_quantity),   -- C5 ✅

  -- §5.1c 第三條:取消數不超過客人買的數量。
  CONSTRAINT oiqs_cancelled_le_quantity CHECK (cancelled_quantity <= quantity),   -- C6 🟡 冗餘

  -- §5.1c 第四條:已到貨 + 已取消 不超過總量。
  -- 成立前提 = Sean 2026-07-28 拍 Q17=B「已到貨不可取消、只能走退貨」。
  -- 🔴 **這條不是前六條的推論**:instock=2 / cancelled=2 / quantity=3 三者各自合法、相加違規。
  -- 🔴 **::bigint 不是裝飾**:兩個 integer 相加會先溢位成 SQLSTATE 22003,
  --    根本到不了這條具名 CHECK ⇒ 負向測試會「紅在錯的地方」而被誤判成通過。
  CONSTRAINT oiqs_instock_cancelled_le_quantity
    CHECK (instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint)   -- C7 ✅
);


-- ══ 3. ACL:service_role only + RLS zero-policy(本片真正的安全機制)═══════════
-- 樣板 = A2/A3/A7(20260730130000:197-202)。寫入一律走 owner RPC / owner trigger
-- (SECURITY DEFINER 由表擁有者執行、不需要 role 權限)。
-- 🔴 這一段就是「客人看不到採購進度」的物理保證。它不是註解、不是約定,是權限。
ALTER TABLE public.order_item_quantity_summary ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_item_quantity_summary
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_item_quantity_summary TO service_role;


-- ══ 4. 註解 ══════════════════════════════════════════════════════════════════
COMMENT ON TABLE public.order_item_quantity_summary IS
  'E10 A1:訂單品項的數量摘要(衍生值,非真相)。真相在 A2 採購表與 A7 取消明細;本表存在的理由是「列 300 筆訂單時不要每次重算」(master plan Q9=B)。🔴 員工專用:anon/authenticated 零權限 + RLS zero-policy —— Sean 2026-07-31 拍板「不讓客人知道進度、只有狀態顯示」。🔴 任何人不得手填,唯一 writer = A4a 重算 trigger。🔴 惰性建列:無列 = 三個 0,讀取端必須 LEFT JOIN + COALESCE(此約定無 DB 強制力,見欄註解的契約債)。';

COMMENT ON COLUMN public.order_item_quantity_summary.quantity IS
  '🔴 去正規化自 order_items.quantity,由複合 FK (order_item_id, quantity) → order_items(id, quantity) 物理釘死。存在的唯一理由 = 讓四條「跟 quantity 比」的不變式成為同表 CHECK(否則跨表、只能用 trigger 補、繼承 #307 併發債)。不得單獨更新。';
COMMENT ON COLUMN public.order_item_quantity_summary.ordered_quantity IS
  '已向供應商訂購的件數。來源 = order_item_procurement.allocated_quantity 之和;維護者 = A4a,任何人不得手填。';
COMMENT ON COLUMN public.order_item_quantity_summary.instock_quantity IS
  '已到貨的件數。來源 = order_item_procurement_receipts 逐批明細的 SUM;維護者 = A4a,任何人不得手填。CHECK instock <= ordered 的語意 = 沒下單就不可能到貨。';
COMMENT ON COLUMN public.order_item_quantity_summary.cancelled_quantity IS
  '已取消的件數。來源 = order_cancellation_items;維護者 = A4a,任何人不得手填。🔴 master plan 允許 cancelled > ordered(還沒跟上游下單就被客人取消)⇒ 不得加 cancelled <= ordered 這條約束。';

-- 🔴 契約債 ①:第 2 批建包裹模型時必須回頭改。
--    現況 shipped_quantity 欄不存在 ⇒ 完整式 `cancelled <= quantity - shipped` 退化為 C6。
--    第 2 批的**同一片**必須:① 加 shipped_quantity ② 納入 C6/C7 ③ 同步改 A8a1/A8a2 可取消量守門。
--    🔴 本註解沒有強制力 ⇒ 同一條債**必須同時寫進 master plan §5.1 的 A8a1/A8a2 兩列**,
--       否則等於不存在(A7 Q2=A 的機制優先律先例)。
COMMENT ON CONSTRAINT oiqs_instock_cancelled_le_quantity ON public.order_item_quantity_summary IS
  '§5.1c 第四條。🔴 契約債:第 2 批建包裹模型時,同一片必須把 shipped_quantity 納入本條與 oiqs_cancelled_le_quantity,並同步改 A8a1/A8a2 可取消量守門。現況 shipped 欄不存在 ⇒ 完整式退化,不是不需要。';

-- 🔴 契約債 ②:惰性建列的「無列 = 全 0」約定無 DB 強制力。
COMMENT ON CONSTRAINT order_item_quantity_summary_item_fk ON public.order_item_quantity_summary IS
  '釘死 quantity 與品項歸屬。🔴 契約債:本表惰性建列,「order_item 沒有對應列 = 三個數量皆 0」這個約定**沒有 DB 強制力** ⇒ A4a 負責建列、A9c/A11a-c 等讀取端一律 LEFT JOIN + COALESCE(…, 0),不得假設列必然存在。';


-- ══ 4b. 向前修正 A2 的欄註解(不修改已套用的 migration 檔)═══════════════════
-- 🔴 A2(20260729020000)已 apply 到正式站,它的註解逐字寫「order_items 的 ordered_quantity /
--    instock_quantity 由本表明細推導」—— 那兩個欄在本片之後**不存在於 order_items**。
--    已套用的 migration 檔一個 byte 都不改(改了也不會重跑);正解是在這裡下新的 COMMENT 覆蓋。
--    (codex 關卡2 must-fix)
COMMENT ON TABLE public.order_item_procurement IS
  'M-4b E10 A2:向供應商採購的真相表(每個 order_item 可有多列 = 同一品項拆給多家供應商)。🔴 2026-07-31(A1)起:摘要值 ordered_quantity / instock_quantity 落在 **public.order_item_quantity_summary**(員工專用表),不在 order_items —— 由本表明細推導(A4a trigger),不得手填。🔴 service_role only:供應商名稱與單號絕不進 orders / order_items(那兩張表對登入客人整表開放 SELECT,洩漏上游等於讓客人繞過 PCM)。';

COMMENT ON COLUMN public.order_item_procurement.received_quantity IS
  '這筆採購實際到貨幾件(累計)。🔴 2026-07-31(A1)起:它推導的目標是 **order_item_quantity_summary.instock_quantity**,不是 order_items.instock_quantity(該欄從未存在於 order_items,落點已於 A1 改為員工專用表)。少了這一欄,到貨數就無從推導(R3/R4 兩次抓到的漏)。🔴 2026-07-29 起本欄的真相來源 = order_item_procurement_receipts 逐批明細的 SUM(quantity);維護責任在 A4a 重算 trigger,寫入端(A4b)只准 INSERT 明細、不准直接寫本欄。';


-- ══ 5. 結構驗收(fail-closed;任一條不成立 = 整片回滾)═════════════════════════
-- 🔴 每條斷言帶**機器可辨識 ID**(A1-xxx),突變測試據此判定「紅在指定的那條」,
--    而不是「反正紅了就算抓到」(A7-t 教訓:所有突變都紅在同一條 = 判別力歸零而 FAIL 數仍 0)。
-- 🔴 本段只驗結構/定義字面/ACL —— 這些在任何環境都成立,無條件略過分支(fail-open 假綠來源)。
--    需要真實資料的行為驗證全在 scripts/a1-behavior-probe.sql。
DO $$
DECLARE
  v_cnt  integer;
  v_txt  text;
  v_role text;
  v_priv text;
BEGIN
  -- ── 5a. 表存在 + RLS 開 + zero policy ──
  IF to_regclass('public.order_item_quantity_summary') IS NULL THEN
    RAISE EXCEPTION 'A1-TABLE-MISSING:order_item_quantity_summary 不存在';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.order_item_quantity_summary'::regclass) THEN
    RAISE EXCEPTION 'A1-RLS-OFF:RLS 未啟用';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_policy
   WHERE polrelid = 'public.order_item_quantity_summary'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-RLS-POLICY:本表應為 zero-policy,實查 % 條', v_cnt;
  END IF;

  -- ── 5b. 完整 ACL 矩陣(不是抽查)──
  -- 期望:anon / authenticated 對八種表級權限全 false;service_role 只有 SELECT。
  --
  -- 🔴 **PUBLIC 直接授權必須先驗**(codex 關卡2 must-fix):`GRANT ... TO PUBLIC` 會讓
  --    anon / authenticated 因繼承而 has_table_privilege = true ⇒ 若排在角色矩陣後面,
  --    第一個轉紅的會是 `A1-ACL:anon.SELECT`,而**把 PUBLIC 這條斷言整個刪掉仍然全綠**
  --    (真正的守門者從未被證明)。順序在這裡是正確性的一部分,不是風格。
  SELECT count(*) INTO v_cnt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.order_item_quantity_summary'::regclass AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-ACL:PUBLIC 直接授權應為 0,實查 % 筆', v_cnt;
  END IF;

  -- 🔴 **八種**,不是七種:PG17 新增了 MAINTAIN(VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH MATVIEW)。
  --    實測(2026-07-31 本機 PG17.10):`GRANT MAINTAIN ... TO authenticated` 之後
  --    has_table_privilege(...,'SELECT') **仍為 false** ⇒ 七格矩陣對它完全無感 = 假綠。
  --    正式站亦為 PG17 ⇒ 這個缺口在正式站同樣存在。(codex 關卡2 must-fix)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(v_role, 'public.order_item_quantity_summary', v_priv)
         <> (v_role = 'service_role' AND v_priv = 'SELECT') THEN
        RAISE EXCEPTION 'A1-ACL:%.% 權限不符期望', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 自訂 grantee:除了 owner 與 service_role,不得有第三個被授權者。
  SELECT string_agg(DISTINCT a.grantee::regrole::text, ', ') INTO v_txt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.order_item_quantity_summary'::regclass
     AND a.grantee <> 0
     AND a.grantee::regrole::text NOT IN ('service_role', c.relowner::regrole::text);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'A1-ACL:出現非預期 grantee(%)', v_txt;
  END IF;

  -- column 級授權:一律不得存在(表級 REVOKE 擋不住 column grant)。
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_item_quantity_summary'::regclass AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-ACL-COLUMN:出現 % 個 column 級授權', v_cnt;
  END IF;

  -- ── 5c. 五個欄的型別 / NOT NULL / DEFAULT(逐欄各驗一次)──
  FOREACH v_role IN ARRAY ARRAY['ordered_quantity','instock_quantity','cancelled_quantity'] LOOP
    SELECT format('%s/%s/%s', data_type, is_nullable, COALESCE(column_default, 'NULL'))
      INTO v_txt
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_item_quantity_summary'
       AND column_name = v_role;
    IF v_txt IS DISTINCT FROM 'integer/NO/0' THEN
      RAISE EXCEPTION 'A1-COL:% 應為 integer/NOT NULL/DEFAULT 0,實為 %', v_role, COALESCE(v_txt, '(欄不存在)');
    END IF;
  END LOOP;

  SELECT format('%s/%s/%s', data_type, is_nullable, COALESCE(column_default, 'NULL')) INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'order_item_quantity_summary'
     AND column_name = 'quantity';
  IF v_txt IS DISTINCT FROM 'integer/NO/NULL' THEN
    RAISE EXCEPTION 'A1-COL:quantity 應為 integer/NOT NULL/無 DEFAULT,實為 %', COALESCE(v_txt, '(欄不存在)');
  END IF;

  -- 🔴 order_item_id + PRIMARY KEY(R2 must-fix:原本完全沒驗 —— 把 PK 拿掉,
  --    56 條驗收仍會全綠,而「一個品項最多一列」這條保證當場消失)。
  SELECT format('%s/%s/%s', data_type, is_nullable, COALESCE(column_default, 'NULL')) INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'order_item_quantity_summary'
     AND column_name = 'order_item_id';
  IF v_txt IS DISTINCT FROM 'uuid/NO/NULL' THEN
    RAISE EXCEPTION 'A1-COL:order_item_id 應為 uuid/NOT NULL/無 DEFAULT,實為 %', COALESCE(v_txt, '(欄不存在)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_txt
    FROM pg_constraint
   WHERE conrelid = 'public.order_item_quantity_summary'::regclass AND contype = 'p';
  IF v_txt IS DISTINCT FROM 'PRIMARY KEY (order_item_id)' THEN
    RAISE EXCEPTION 'A1-PK:主鍵應為 PRIMARY KEY (order_item_id),實為 %', COALESCE(v_txt, '(不存在)');
  END IF;

  -- 欄集合精確:不多不少五欄。
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'order_item_quantity_summary';
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'A1-COL-SET:本表應恰為 5 欄,實查 %', v_cnt;
  END IF;

  -- ── 5d. 七條 CHECK:存在 + 已驗證 + **定義逐字比對** ──
  -- 🔴 只驗「名字在」抓不到「保留關鍵字但邏輯反了」(A7 關卡2 教訓)。
  FOR v_role, v_txt IN
    SELECT * FROM (VALUES
      ('oiqs_ordered_nonneg',                 'CHECK ((ordered_quantity >= 0))'),
      ('oiqs_instock_nonneg',                 'CHECK ((instock_quantity >= 0))'),
      ('oiqs_cancelled_nonneg',               'CHECK ((cancelled_quantity >= 0))'),
      ('oiqs_ordered_le_quantity',            'CHECK ((ordered_quantity <= quantity))'),
      ('oiqs_instock_le_ordered',             'CHECK ((instock_quantity <= ordered_quantity))'),
      ('oiqs_cancelled_le_quantity',          'CHECK ((cancelled_quantity <= quantity))'),
      ('oiqs_instock_cancelled_le_quantity',
       'CHECK ((((instock_quantity)::bigint + (cancelled_quantity)::bigint) <= (quantity)::bigint))')
    ) AS t(name, def)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_priv
      FROM pg_constraint c
     WHERE c.conrelid = 'public.order_item_quantity_summary'::regclass
       AND c.conname = v_role AND c.contype = 'c' AND c.convalidated;
    IF v_priv IS NULL THEN
      RAISE EXCEPTION 'A1-C-MISSING:%(缺漏或未 validated)', v_role;
    END IF;
    IF v_priv <> v_txt THEN
      RAISE EXCEPTION 'A1-C-DEF-MISMATCH:% 定義不符 — 期望「%」實為「%」', v_role, v_txt, v_priv;
    END IF;
  END LOOP;

  -- CHECK 集合精確:恰七條,不得有第八條(恆真的或過度限制的都算異常)。
  -- 🔴 NOT NULL 在 PG17 不列入 pg_constraint 的 contype='c',故此處恰為七。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_item_quantity_summary'::regclass AND contype = 'c';
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'A1-C-EXTRA:本表 CHECK 應恰為 7 條,實查 %', v_cnt;
  END IF;

  -- ── 5e. 複合 FK:欄組正確 + ON DELETE CASCADE ──
  SELECT pg_get_constraintdef(oid) INTO v_txt
    FROM pg_constraint
   WHERE conrelid = 'public.order_item_quantity_summary'::regclass
     AND conname = 'order_item_quantity_summary_item_fk' AND contype = 'f';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION 'A1-FK-MISSING:複合 FK 不存在';
  END IF;
  IF v_txt <> 'FOREIGN KEY (order_item_id, quantity) REFERENCES order_items(id, quantity) ON DELETE CASCADE' THEN
    RAISE EXCEPTION 'A1-FK-SHAPE:FK 形狀不符 — 實為「%」', v_txt;
  END IF;

  -- 🔴 逐字比對不夠(codex 關卡2 must-fix):pg_get_constraintdef 把被參照表印成**未加 schema 的**
  --    `order_items` ⇒ 若 FK 指到別的 schema 底下同名的表,渲染出的字串會**一模一樣**。
  --    ⇒ 再用 OID + 欄序 + 刪除規則做一次不依賴字串的斷言。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.order_item_quantity_summary'::regclass
       AND conname  = 'order_item_quantity_summary_item_fk'
       AND contype  = 'f'
       AND confrelid = 'public.order_items'::regclass
       AND confdeltype = 'c'                                   -- ON DELETE CASCADE
       AND conkey = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.order_item_quantity_summary'::regclass AND attname = 'order_item_id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.order_item_quantity_summary'::regclass AND attname = 'quantity')]::smallint[]
       AND confkey = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.order_items'::regclass AND attname = 'id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.order_items'::regclass AND attname = 'quantity')]::smallint[]
  ) THEN
    RAISE EXCEPTION 'A1-FK-SHAPE:FK 的 OID / 欄序 / 刪除規則不符期望(字串比對過了但實體不對)';
  END IF;

  -- ── 5f. 新表零列、零 trigger ──
  -- 🔴 「本片零新函式」**不在這裡驗**(codex 關卡2 must-fix):migration 內部拿不到「套用前」的
  --    pg_proc 基準,只查 trigger 數的話,新增一支**沒掛 trigger 的**函式會全綠。
  --    ⇒ 該斷言改由外層 harness 以 apply 前後的 pg_proc 差集做(scripts/a1-verify.sh 步驟 3),
  --      並配一條「在 migration 裡偷加函式」的突變證明它抓得到。此處不再自稱驗過。
  SELECT count(*) INTO v_cnt FROM public.order_item_quantity_summary;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-ROWS:新表應為空,實查 % 列', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgrelid = 'public.order_item_quantity_summary'::regclass AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-TRIGGER:新表不應有任何 user trigger,實查 %', v_cnt;
  END IF;

  -- ── 5g. order_items:新唯一約束在,且既有約束未被動到 ──
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.order_items'::regclass
       AND conname = 'order_items_id_quantity_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'A1-OI-UNIQUE-MISSING:order_items_id_quantity_key 不存在';
  END IF;

  -- 既有那把 (order_id, id) 必須原封不動(本片不得取代它)。
  SELECT pg_get_constraintdef(oid) INTO v_txt
    FROM pg_constraint
   WHERE conrelid = 'public.order_items'::regclass AND conname = 'order_items_order_id_id_key';
  IF v_txt IS DISTINCT FROM 'UNIQUE (order_id, id)' THEN
    RAISE EXCEPTION 'A1-OI-CONSTRAINT-DRIFT:既有 order_items_order_id_id_key 被動到 — 實為 %',
      COALESCE(v_txt, '(不存在)');
  END IF;

  -- order_items 不應有任何 user trigger(20260604120000 起從未加過;A1 也不加)。
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgrelid = 'public.order_items'::regclass AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1-OI-TRIGGER-DRIFT:order_items 出現 % 支 user trigger', v_cnt;
  END IF;

  RAISE NOTICE 'A1 結構驗收全數通過';
END
$$;

COMMIT;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行)
-- 🔴 **只允許在 A4a 之前使用**。A4a 上線後本表有真實資料,
--    DROP 會讓累積的訂購/到貨/取消數一起消失 ⇒ 屆時必須改寫成 forward repair migration,
--    不得照抄本段。
-- 🔴 **不加 CASCADE**:若有東西依賴本表,寧可讓 DROP 失敗、人工看清楚,不要靜默連帶刪除。
-- 🔴 執行前先跑 dependency preflight:
--    SELECT * FROM pg_depend WHERE refobjid = 'public.order_item_quantity_summary'::regclass;
-- ------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.order_item_quantity_summary;   -- 連帶七條 CHECK 與複合 FK
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_id_quantity_key;
-- COMMIT;
-- ============================================================
