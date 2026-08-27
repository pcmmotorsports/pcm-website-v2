-- ============================================================
-- M-4b E10 · #352-a1:到貨登錄的 schema 地基(溢收欄 + 冪等帳 + 現貨供應商種子)
-- ============================================================
-- 規格:docs/specs/2026-08-10-352-receipt-recording-plan-v3.md(v3.3)§2
-- 審查鏈:關卡1 三輪 —— codex R1(12MF+2nit)→ R2(8MF+2nit,全打在折法上)→ Fable R3(2MF+4consider+4nit),
--         32 條零重複全折。片型 M。**鐵則 12 ③**(DB 結構改動 + 新表 + ACL)⇒ 對抗審查不降級。
--
-- 🔴 這一片為什麼存在(白話,給日後翻到這裡的人):
--    `order_item_procurement_receipts` 從 2026-07-29 建表起就**零寫入路徑**
--    (ACL = REVOKE ALL + 只 GRANT SELECT,`20260729020000:237-238`)
--    🔴 **精確的支撐句(雙線審 MF2 更正,原句錯了 39 倍)**:全樹 `INSERT INTO … _receipts` 共 **78 筆**
--    (migrations 11 筆 + `scripts/` 24 支 harness 67 筆),但 **`apps/` 與 `packages/` 是 0 筆**
--    ⇒ 「零 writer」成立的理由是**生產路徑零命中 + ACL 只有 SELECT**,
--    **不是**「全樹只有兩處」。原句把 A2 單一檔案內的探針數當成全樹數,是把範圍講大。
--    🔴🔴 **這句話能證到哪裡為止(關卡2 MF1 再收窄一次)**:上面兩件事合起來只證明
--    **「已知的應用程式直接寫入路徑為零」**。它**證不到**「正式庫那張表一定是空的」——
--    owner / SECURITY DEFINER / 動態 SQL / 有人手動連上去下 SQL / 歷史測試殘留,字面掃描全都看不到。
--    ⇒ **apply preflight 必跑一條**(寫進 §9 檢查表,不是靠記得):
--      `SELECT count(*), pg_total_relation_size('public.order_item_procurement_receipts') FROM public.order_item_procurement_receipts;`
--      非 0 就**停下來看那些列是什麼**再決定,不要直接套。
--    ⇒ `instock_quantity` 恆 0 ⇒ 出貨可出量 `instock − shipped − pending`(`20260807180000:230`)恆 0
--    ⇒ **正式站一件都出不了貨**。Sean 2026-08-09 實測問的「沒進貨就不能出貨嗎?」就是這件事。
--    #352 原本被寫成「現貨補記」的一顆小鈕,但它踩到的地基(登錄到貨)根本還沒蓋。
--    本片只蓋地基;兩支 writer RPC 在 a2、畫面在 b。
--
-- 🔴 **本片刻意【零 writer】**,但 **apply 之後【不是】「完全零可見改變」**
--    (雙線審 MF1 兩線各自獨立抓到的頭槌;原字面是假的,以下是實測後的正確說法):
--    · 種子供應商落 `is_active = false` ⇒ **不進「採購」下拉** ——
--      那條路是 `listSuppliers()`(`apps/admin/src/lib/supplier.ts:29` 逐字 `rows.filter((row) => row.is_active)`)。
--      ⇒ 員工不會在「登錄到貨」還不存在時就在採購區塊選到它、被領進死路。**這一半成立。**
--    · 🔴 **但「設定 → 供應商」頁看得到它,而且有啟用開關**:
--      `listSuppliersForSettings()`(`supplier.ts:69`)**刻意不濾 `is_active`**
--      (該函式 `:65-66` 逐字說明:停用的列必須回得來,否則 S3b-3 做不到「撞到已停用同名時
--       定位到那一列 + 讓員工自己按啟用」,Sean Q2=A)。
--      ⇒ **a1 落地後那一列在設定頁是看得見、且一鍵可被啟用的**;被啟用就會進採購下拉 = 那條死路又開了。
--      ⇒ **紀律(要進 STATUS 素材、不是只寫在這裡)**:**a2/b 落地前不要動那一列的啟用狀態**。
--      原字面寫「S3a/S3b 只列啟用中」**把 S3b 講反了**,已更正。
--      翻成 true 是 **b 片**的事(那時登錄到貨的 UI 才真的存在)。
--    · receipts 的 `append-only` COMMENT **本片不動**(改在 a2、與刪除 RPC 同一支)——
--      刪除 RPC 到 a2 才存在,本片就改字面等於讓 DB 契約宣稱一個還不存在的能力。
--    (這兩條都是 codex R2 打回來的:v3.1 原本種子落 true、COMMENT 也放本片,
--     而那時檔頭還寫著「對應用層零行為改變」—— 那句話當時是假的。)
--
-- 🔴 **正式庫 DDL 的鎖代價(關卡2 MF2;本片只在 from-zero 拋棄式 PG 驗過)**:
--    · `ADD COLUMN … NOT NULL DEFAULT 0` 在 PG 11+ 是**常數預設 ⇒ 不需整表 rewrite**。
--    · 但 `DROP CONSTRAINT` + 三條 `ADD CONSTRAINT` 會對該表取 **ACCESS EXCLUSIVE**,
--      且 `ADD CONSTRAINT` 要**驗既有列**,鎖**持有到 COMMIT** 為止。
--    · ⚠️ `SET LOCAL lock_timeout = '5s'` 只限制**等鎖**的時間,**不限制持鎖**的時間 ——
--      不要把它讀成「最多鎖 5 秒」。
--    ⇒ 依 preflight 的列數決定:接近 0 列(預期值)⇒ 驗證瞬間完成、風險可忽略;
--      若真的有量,先評估要不要拆成「先建 NOT VALID、再 VALIDATE」的兩段式。寫進 §9 檢查表。
--
-- 🔴 誠實邊界(照 A2/A5a 同款,不宣稱過頭):
--    · service_role 具 BYPASSRLS ⇒ RLS 在這些表**擋不住 service_role**,真正的防線是 ACL(只有 SELECT)。
--      RLS 的價值是縱深:日後有人誤 GRANT 給 anon/authenticated 時 zero-policy 仍全拒。
--    · table owner / SECURITY DEFINER / 持 owner 憑證的服務仍可直寫 ⇒ 不得說「繞過稽核的路徑不存在」。
--    · 本片的驗收 DO 是**結構層**斷言;行為層(CHECK 真的擋得住什麼)歸 a2 的 harness。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 溢收欄(plan §2.1)────────────────────────────────────
-- 「乙(溢收)」= 供應商送來、但這張單裝不下的件數(Sean 2026-08-10 Q1=A 甲+乙)。
-- 🔴 **A4a 只 SUM `quantity`,不看本欄** ⇒ 不進 `received_quantity`、不進 `instock_quantity`、
--    不碰 C7(`instock + cancelled <= quantity`)⇒ **A4a 完全不必改**。
--    這是本設計能只動 schema 的關鍵:溢收與「這張單收了幾件」是兩個獨立的數。
ALTER TABLE public.order_item_procurement_receipts
  ADD COLUMN surplus_quantity integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.order_item_procurement_receipts.surplus_quantity IS
  '這一批裡「多出來、進店內」的件數(#352 乙案)。🔴 **不計入** order_item_procurement.received_quantity,'
  '也不計入 order_item_quantity_summary.instock_quantity —— A4a 的重算只 SUM quantity 欄。'
  '⚠️ 它是「記得住」不是「用得到」:本欄的件數**不會**自動變成可出別張單的庫存,'
  '那需要「不掛訂單的庫存」模型(backlog #374、Phase 2、Sean 定調簡化版 ERP 且要與報價單整合)。'
  '本欄屆時是 #374 的資料來源之一。';

-- ── 2. 數量 CHECK 換三條(plan §2.2)──────────────────────────
-- 舊:quantity BETWEEN 1 AND 100000(`20260729020000:197-198`)
-- 🔴 為什麼要放寬到 0:訂單已收滿之後才到的貨 = `quantity=0 / surplus=N`,
--    舊 CHECK 會把它整筆擋掉,而那正是 Sean Q2=B 要求「後到的貨必須記得進去」的那一批。
-- 🔴 「登錄一筆 0 件」仍然無意義 ⇒ 擋在第三條(兩者和至少 1)。
-- 🔴 `::bigint` 不是裝飾:兩個 integer 相加會先溢位成 SQLSTATE 22003,
--    根本到不了這條具名 CHECK ⇒ 負向測試會「紅在錯的地方」而被誤判成通過。
--    (理由與 A1 的 C7 逐字同源,`20260730150000:122-124`。)
-- ⚠️ `ADD CONSTRAINT` 預設會驗既有列 ⇒ 若正式庫已有列違反新條件,本片**當場失敗回滾**(fail-closed,要的)。
ALTER TABLE public.order_item_procurement_receipts
  DROP CONSTRAINT order_item_procurement_receipts_quantity_range;

ALTER TABLE public.order_item_procurement_receipts
  ADD CONSTRAINT order_item_procurement_receipts_quantity_range
    CHECK (quantity BETWEEN 0 AND 100000),
  ADD CONSTRAINT order_item_procurement_receipts_surplus_range
    CHECK (surplus_quantity BETWEEN 0 AND 100000),
  ADD CONSTRAINT order_item_procurement_receipts_total_positive
    CHECK (quantity::bigint + surplus_quantity::bigint BETWEEN 1 AND 100000);

-- ── 3. 冪等帳(plan §2.4)────────────────────────────────────
-- A2 契約債 ④(`20260729020000:137-143`)逐字把「發明冪等鍵的形狀」留給 writer:
--   「本片刻意不先發明那個鍵的形狀(欄位不得早於它的模型 —— 批次到貨 UI 在第 2 批)」
-- ⇒ **本片就是那一刻**,這條債在此關閉。
--
-- 🔴 **真 append-only:零 UPDATE、零 DELETE 路徑**(Fable R3-F3)。
--    `receipt_id` 由 a2 的 RPC 在 INSERT 之前先 gen_random_uuid() 產好、當場寫進來,
--    **不是**「先寫 NULL、寫完 receipt 再回填」;「這筆被刪了沒」也改用推導
--    (本表有列、而 receipts 查不到那個 id ⇒ 已被刪)。⇒ 本表沒有任何欄需要事後修改。
--
-- 🔴 **兩個 uuid 欄刻意【不建 FK】**。決策不變,但**理由只剩一條**
--    (雙線審 MF3:原本寫三條,其中兩條在 plan v3.3 把「存在性檢查 + 取鎖」移到 ledger INSERT
--     **之前**以後就**已經不可達**了 —— 我沿用了改序前寫的舊理由):
--   ① ✅ **仍然成立、而且是唯一承重的那條**:FK RESTRICT 會**凍結一條既有的合法出路**。
--      A5a `:80-84` 逐字寫明「qty=1 的品項指錯供應商後,當日出路 = owner 手動
--      `DELETE FROM public.order_item_procurement WHERE id = …`」。
--      本表若對 procurement 建 FK,**即使那筆 receipt 已經被刪,這筆帳仍永久擋住那條清理路** ⇒ 淨損失。
--   ② ❌ ~~FK 會先吐 raw 23503,到不了具名訊息~~ —— **不可達**:a2 的守門序是
--      「先鎖 + 驗 procurement 存在(不存在就 RETURN 具名碼)→ 才 INSERT ledger」
--      ⇒ 走到 INSERT 時那一列必定存在且被本交易鎖著,FK 永遠不會發火。
--   ③ ❌ ~~FK 的隱式 KEY SHARE 會破壞鎖序論證~~ —— **不咬**:本交易此時已對該列持有
--      `FOR NO KEY UPDATE`(比 KEY SHARE 強),FK 要的鎖是**自持**的,不產生新的等待邊。
-- 🔴 **這正是 plan §4 自己寫過的那條警語**(「順序改了,論證要跟著改而不是沿用,免得日後有人
--    引用一句過期的理由」)—— **同一片裡我在 §4 清了、在這裡沒清**。留著這段對照,不是為了自責,
--    是因為下一個人最可能犯的就是「看到三條理由,以為拿掉任何一條都還有兩條撐著」。**只有 ① 撐著。**
-- ⇒ 兩欄的語意是**歷史指標**、不是活引用。
--    **代價認列**:DB 層不保證它們指得到現存的列 ⇒ **不能拿本表反推現況**,它只做冪等與稽核。
CREATE TABLE public.order_item_receipt_requests (
  -- 冪等鍵。PK 的唯一性是**跨全表**的 ⇒ 併發的同鍵請求不管掛在哪一列採購上都會撞在這裡,
  -- 序列化不依賴任何一把列鎖(codex R1 抓到的競態就是「只靠 procurement 列鎖擋不住跨列同鍵」)。
  request_id         text        PRIMARY KEY,

  -- 🔴 無 FK(見上)。這一批到貨掛在哪一列採購。
  procurement_id     uuid        NOT NULL,

  -- 以下五欄 + procurement_id = **不可變 payload**,重放時逐欄比對。
  -- 🔴 a2 比對時**必須用 `IS NOT DISTINCT FROM`、不得用 `=`**:`note` 可為 NULL,
  --    而 `NULL = NULL` 得 NULL(不是 TRUE)⇒ 會走「不符」枝
  --    ⇒ **空備註(最常見的情形)的合法重放會被當成 caller bug 打回**。(Fable R3-F1。)
  quantity           integer     NOT NULL,
  surplus_quantity   integer     NOT NULL,
  received_at        timestamptz NOT NULL,
  note               text,
  actor              text        NOT NULL,

  -- 🔴 無 FK、INSERT 當下就填、此後永不改。
  --    UNIQUE 有兩個作用:①a2 的刪除路徑要用它反查「這個 receipt 是哪個請求產的」,
  --    才分得出「已經刪過了」與「這個 id 從來不存在」(後者不可以也回成功);
  --    ②防兩筆帳宣稱同一個 receipt。
  receipt_id         uuid        NOT NULL UNIQUE,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- 🔴 **形狀 = 可列印 ASCII、不含空白**(關卡2 MF4 之後改成這個寫法)。
  --    原本寫 `btrim(x) = x AND x !~ '[[:cntrl:]]'` 並宣稱「沿用 A5a 慣例」——**那是宣稱大於事實**:
  --    `btrim` 預設**只剝 U+0020**,擋不掉全形空白 U+3000、NBSP U+00A0、零寬 U+200B…
  --    ⇒ 一個「肉眼看不見卻不是 ASCII 空格」的字元可以混進 **PK**,製造兩個看起來一樣的鍵。
  --    A5a 是用 31 字元的 `v_ws` 全集處理的(`20260803160000:127-138`),CHECK 裡複製那一坨既醜又會漂。
  --    ⇒ 改用**白名單**:`^[!-~]+$` = ASCII 0x21–0x7E,**一次擋掉所有空白類與所有非 ASCII**,
  --      而 UUID / nanoid / ULID 這些應用端真正會產的形狀全在範圍內。比黑名單短、也不會漏列。
  --    ⚠️ 誠實邊界:這條擋的是**形狀**;a2 的 RPC 仍要做自己的正規化與長度檢查(它才是完整守門)。
  CONSTRAINT order_item_receipt_requests_request_id_shape
    CHECK (request_id = pg_catalog.lower(request_id)
           AND request_id ~ '^[!-~]+$'
           AND pg_catalog.char_length(request_id) BETWEEN 1 AND 200),
  CONSTRAINT order_item_receipt_requests_quantity_range
    CHECK (quantity BETWEEN 0 AND 100000),
  CONSTRAINT order_item_receipt_requests_surplus_range
    CHECK (surplus_quantity BETWEEN 0 AND 100000),
  CONSTRAINT order_item_receipt_requests_actor_shape
    CHECK (actor ~ '^[a-z0-9_]{1,64}$')
);

COMMENT ON TABLE public.order_item_receipt_requests IS
  'M-4b E10 #352-a1:到貨登錄的冪等帳。**append-only —— 零 UPDATE、零 DELETE 路徑**。'
  '每一次成功的到貨登錄留一列。重送同一個 request_id 時:**payload 相同**才回 DUPLICATE_REQUEST'
  '(不再產生第二筆到貨);**payload 不同**是 caller bug ⇒ a2 的 RPC RAISE(鍵被重用)。'
  '⚠️ 原字面寫「一律回 DUPLICATE_REQUEST」與規格不符,關卡2 已更正。'
  '🔴 即使那筆到貨後來被刪掉,本表這一列**仍然留著** ⇒ 舊請求延遲重送不會把它「復活」。'
  '🔴 procurement_id / receipt_id **刻意無 FK**(理由見建表註解)⇒ 它們是歷史指標、不是活引用,'
  '不得拿本表反推現況。🔴 service_role only:到貨與供應商資訊是內部資料,絕不對客。';

COMMENT ON COLUMN public.order_item_receipt_requests.request_id IS
  '冪等鍵,由應用端一次性產生並隨表單送出(不是每次 render 重產,否則重送會變成新請求)。'
  '🔴 形狀沿用 A5a 的 request_id 慣例(非空、≤200、無控制字元),**刻意不套 ^[a-z0-9_]+$** —— '
  '那會拒掉帶連字號的 UUID,而 UUID 正是應用端最可能產的形狀。'
  '🔴 但**強制小寫**:本欄是 PK,大小寫兩形會繞過重複門(同型先例已判)。'
  'a2 的 RPC 對非小寫一律拒收、**不靜默 lower() 正規化**(靜默正規化會讓送出的鍵與表裡的鍵不同字面、日後對不起帳)。';

COMMENT ON COLUMN public.order_item_receipt_requests.receipt_id IS
  '這個請求產生的那一筆 order_item_procurement_receipts.id。🔴 INSERT 當下就填、此後永不改。'
  '查得到本列但 receipts 查不到這個 id = 那筆到貨已被刪除(a2 的 ALREADY_DELETED 靠這個推導,'
  '而不是靠一個會被清空的欄位)。';

-- ── 4. 冪等帳的 RLS + ACL(樣板 = A2 `:235-238`)────────────
ALTER TABLE public.order_item_receipt_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_item_receipt_requests
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_item_receipt_requests TO service_role;

-- ── 5. 「店內現貨」供應商種子(plan §2.3)────────────────────
-- Sean 2026-08-10 拍 A:建一個固定的虛擬供應商,之後所有現貨補記到貨都掛它
-- (B「員工當場選」/ C「無採購列不給按」否決)。
-- 🔴 **固定 UUID、不用 label 查**:label 是可以改名的(改名只改 label、id 不得變動,
--    `20260801140000` 表 COMMENT 逐字),拿 label 當識別會在改名當天全部斷掉。
-- 🔴 **不用 `ON CONFLICT DO NOTHING`**:`suppliers_label_unique`(`20260801140000:45`)
--    會讓「同名但不同 id」的既有列**靜默降級成不建列**,之後 a2/b 拿固定 UUID 卻查不到
--    —— 那是最難查的一種壞法。⇒ 改成**明確驗 id 與 label 一致,不一致就 fail**。
-- 🔴 `is_active = false`:見檔頭。b 片再翻 true。
DO $seed$
DECLARE
  -- 🔴 這個字面同時出現在應用層常數與 a2/b 的斷言裡;改它要同步五處(plan §2.3)。
  v_id    constant uuid := '00000000-0000-4000-8000-000000000352';
  v_label constant text := '店內現貨';
  v_row   public.suppliers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.suppliers WHERE id = v_id;

  IF FOUND THEN
    -- 已經有這個 id:label 必須一致,否則有人改過而我們的假設過期了。
    IF v_row.label <> v_label THEN
      RAISE EXCEPTION '#352-a1 種子:id % 已存在但 label 是 %(預期 %)—— 拒絕靜默沿用',
        v_id, v_row.label, v_label;
    END IF;
  ELSE
    -- 沒有這個 id:label 也不可以被別人佔走(UNIQUE 會擋,但我們要一個看得懂的訊息)。
    IF EXISTS (SELECT 1 FROM public.suppliers WHERE label = v_label) THEN
      RAISE EXCEPTION '#352-a1 種子:label % 已被另一個 id 佔用 —— 拒絕建立同名第二列',
        v_label;
    END IF;
    INSERT INTO public.suppliers (id, label, is_active) VALUES (v_id, v_label, false);
  END IF;
END
$seed$;

-- ── 6. 檔內結構驗收(fail-closed;任一條不成立 = 整片回滾)────
-- ⚠️ 本段是**結構層**:它證明「東西長對了」,不證明「守門擋得住什麼」——後者是 a2 harness 的事。
--    (不把行為斷言塞進這裡,是因為本片零 writer、構造不出有意義的行為前提。)
DO $verify$
DECLARE
  v_cnt  integer;
  v_txt  text;
  v_bool boolean;
BEGIN
  -- 6.1 溢收欄:存在 / NOT NULL / 預設 0
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement_receipts'::regclass
     AND attname = 'surplus_quantity' AND attnum > 0 AND NOT attisdropped
     AND attnotnull;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#352-a1 驗收:surplus_quantity 欄缺失或可為 NULL(count=%)', v_cnt;
  END IF;

  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_txt
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.order_item_procurement_receipts'::regclass
     AND a.attname = 'surplus_quantity';
  IF v_txt IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION '#352-a1 驗收:surplus_quantity 預設值為 %(預期 0)', coalesce(v_txt, '(無)');
  END IF;

  -- 6.2 三條 CHECK 的**定義逐字**(只驗「存在」會對「還在但語意被改壞」全盲)
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement_receipts'::regclass
     AND conname = 'order_item_procurement_receipts_quantity_range';
  IF v_txt IS DISTINCT FROM 'CHECK (((quantity >= 0) AND (quantity <= 100000)))' THEN
    RAISE EXCEPTION '#352-a1 驗收:quantity_range 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement_receipts'::regclass
     AND conname = 'order_item_procurement_receipts_surplus_range';
  IF v_txt IS DISTINCT FROM 'CHECK (((surplus_quantity >= 0) AND (surplus_quantity <= 100000)))' THEN
    RAISE EXCEPTION '#352-a1 驗收:surplus_range 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  -- 🔴 **逐字比,不用 LIKE '%::bigint%'**(雙線審 MF6):只驗有沒有那個 cast 的話,
  --    把 `BETWEEN 1 AND 100000` 的界值改壞(例如改成 0)照樣恆綠 ——
  --    而本段 6.2 開頭自己就寫著「只驗『存在』會對『還在但語意被改壞』全盲」,前後不一致。
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement_receipts'::regclass
     AND conname = 'order_item_procurement_receipts_total_positive';
  -- ⚠️ 這串是 PG 的 **deparse 輸出逐字**(不是我照著 DDL 手打的)——手打會漏括號層級,
  --    我第一版就少了一層外括號、當場誤紅。日後若 PG 版本改變 deparse 格式,這格會紅在「定義非預期」,
  --    **那時要先確認是格式變了還是語意變了**,不要直接把期望值改成新輸出。
  IF v_txt IS DISTINCT FROM
     'CHECK (((((quantity)::bigint + (surplus_quantity)::bigint) >= 1) AND (((quantity)::bigint + (surplus_quantity)::bigint) <= 100000)))' THEN
    RAISE EXCEPTION '#352-a1 驗收:total_positive 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  -- 6.2b 🔴 冪等帳的四條 CHECK 也要逐字釘(雙線審 MF5:原本它們**零結構錨**,
  --      包括我自己在 COMMENT 裡稱為承重的「強制小寫」那條 —— 被改壞不會有任何訊號)。
  --      逐條具名比對(不用迴圈:具名才擋得住「某一條整個不見了」)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass AND contype = 'c';
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳 CHECK 條數 %(預期 4)—— 少一條或多一條都要看得見', v_cnt;
  END IF;

  -- 🔴 逐字(關卡2 MF5:子字串 LIKE 驗不到運算子、界值與邏輯關係 ——
  --    例如把 `AND` 改成 `OR`、把 `200` 改成 `20000`,四個 LIKE 全都還在、照樣綠)。
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND conname = 'order_item_receipt_requests_request_id_shape';
  -- ⚠️ 逐字取自 PG 實際 deparse 輸出(`BETWEEN` 會展開成自己的括號群)。**手打必錯,我已錯兩次。**
  IF v_txt IS DISTINCT FROM
     'CHECK (((request_id = lower(request_id)) AND (request_id ~ ''^[!-~]+$''::text) AND ((char_length(request_id) >= 1) AND (char_length(request_id) <= 200))))' THEN
    RAISE EXCEPTION '#352-a1 驗收:request_id_shape 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND conname = 'order_item_receipt_requests_quantity_range';
  IF v_txt IS DISTINCT FROM 'CHECK (((quantity >= 0) AND (quantity <= 100000)))' THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳 quantity_range 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND conname = 'order_item_receipt_requests_surplus_range';
  IF v_txt IS DISTINCT FROM 'CHECK (((surplus_quantity >= 0) AND (surplus_quantity <= 100000)))' THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳 surplus_range 定義非預期 = %', coalesce(v_txt, '(不存在)');
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND conname = 'order_item_receipt_requests_actor_shape';
  IF v_txt IS DISTINCT FROM 'CHECK ((actor ~ ''^[a-z0-9_]{1,64}$''::text))' THEN
    RAISE EXCEPTION '#352-a1 驗收:actor_shape 定義非預期(應逐字鏡像 received_by)= %',
      coalesce(v_txt, '(不存在)');
  END IF;

  -- 6.3 冪等帳:**逐欄驗名稱 + 型別 + NOT NULL**(關卡2 MF6:只數欄數的話,
  --      把 `quantity` / `actor` / `receipt_id` 的 NOT NULL 拿掉照樣全綠;
  --      而 `receipt_id` 一旦可為 NULL,它的 UNIQUE 就**允許多列 NULL** ⇒ 一對一保證消失)。
  SELECT pg_catalog.string_agg(
           a.attname || ':' || pg_catalog.format_type(a.atttypid, NULL) ||
           CASE WHEN a.attnotnull THEN '!' ELSE '' END, ',' ORDER BY a.attnum)
    INTO v_txt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_item_receipt_requests'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_txt IS DISTINCT FROM
     'request_id:text!,procurement_id:uuid!,quantity:integer!,surplus_quantity:integer!,'
     || 'received_at:timestamp with time zone!,note:text,actor:text!,receipt_id:uuid!,'
     || 'created_at:timestamp with time zone!' THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳欄位集合/型別/NOT NULL 非預期 = %', coalesce(v_txt, '(空)');
  END IF;

  -- created_at 的預設要在(少了它,append-only 帳就沒有可信的時間軸)
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_txt
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.order_item_receipt_requests'::regclass AND a.attname = 'created_at';
  IF v_txt IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳 created_at 預設為 %(預期 now())', coalesce(v_txt, '(無)');
  END IF;

  -- 6.4 🔴 冪等帳**零外鍵**(plan §2.4 的三條理由全押在這上面;補 FK ⇒ 本格紅)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass AND contype = 'f';
  IF v_cnt <> 0 THEN
    -- 🔴 訊息只留**唯一還成立**的那條理由(關卡2 MF10):
    --    我在上面的區塊註解把 ②raw 23503 / ③KEY SHARE 標成不可達了,**卻沒同步改這句 RAISE**
    --    —— 又是「只改碰到的那幾行」。同一片第三次同型,留著這行註解當紀錄。
    RAISE EXCEPTION '#352-a1 驗收:冪等帳有 % 條外鍵(預期 0)—— FK RESTRICT 會永久凍結 '
      'A5a :80-84 明載的 owner 手動清理採購列那條出路', v_cnt;
  END IF;

  -- 6.5 PK 在 request_id、UNIQUE 在 receipt_id
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND contype = 'p'
     AND pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (request_id)';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳 PK 非 (request_id)';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_receipt_requests'::regclass
     AND contype = 'u'
     AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (receipt_id)';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳缺 UNIQUE (receipt_id) —— '
      'a2 分不出「已刪過」與「這個 id 從來不存在」';
  END IF;

  -- 6.6 RLS 開且零 policy
  SELECT relrowsecurity INTO v_bool
    FROM pg_catalog.pg_class WHERE oid = 'public.order_item_receipt_requests'::regclass;
  IF NOT coalesce(v_bool, false) THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳未啟用 RLS';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_policy WHERE polrelid = 'public.order_item_receipt_requests'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳有 % 條 policy(預期 zero-policy)', v_cnt;
  END IF;

  -- 6.7 ACL:表級除了 owner 自己以外,恰只有 service_role 的 SELECT。
  -- 🔴 **必須排除 owner**:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`
  --    **不會**撤掉表擁有者自己的權限,owner 的 8 項(arwdDxtm)本來就留在 `relacl` 裡。
  --    (這一條是本片自跑驗收當場紅出來的 —— 第一版漏了 owner、把正常狀態判成違規。)
  --    對齊本 repo 既有說法「relacl 零**外部** grantee」(OP1/OP5 同款)。
  -- 🔴 **正反兩面都要驗**:只數「多餘的」會讓「什麼都沒授」也過關 ⇒ 另一半明確要求那顆 SELECT 在。
  -- 🔴 **欄級也要查**:`relacl` 只放表級,欄級 GRANT 住在 `pg_attribute.attacl`
  --    ⇒ 只攤平 relacl 會讓欄級後門隱形(本 repo 判過同型)。
  -- ⚠️ **本斷言的天花板(誠實列出,照 A2 `:257-258` 同語)**:role 繼承(某 role 被加進 service_role)
  --    與 `pg_read_all_data` 這類叢集層授權**不在 relacl 裡**,表層斷言物理上看不到。
  -- 🔴 **`is_grantable` 也要驗(關卡2 MF7)**:帶 `WITH GRANT OPTION` 的 SELECT 一樣是「SELECT」,
  --    正反兩格都會通過,但持有者可以**把內部資料再轉授給別人** ⇒ 必須釘死不可轉授。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c,
         LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE c.oid = 'public.order_item_receipt_requests'::regclass
     AND a.grantee <> c.relowner
     AND NOT (a.grantee = 'service_role'::regrole::oid
              AND a.privilege_type = 'SELECT'
              AND a.is_grantable = false);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳表級 ACL 有 % 項是「owner 以外、且非『service_role 的不可轉授 SELECT』」', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c,
         LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE c.oid = 'public.order_item_receipt_requests'::regclass
     AND a.grantee = 'service_role'::regrole::oid
     AND a.privilege_type = 'SELECT'
     AND a.is_grantable = false;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳缺「service_role 的不可轉授 SELECT」(count=%)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute at,
         LATERAL pg_catalog.aclexplode(at.attacl) a
   WHERE at.attrelid = 'public.order_item_receipt_requests'::regclass
     AND at.attnum > 0 AND NOT at.attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#352-a1 驗收:冪等帳有 % 項欄級 GRANT(預期 0)', v_cnt;
  END IF;

  -- 6.8 種子列:id + label 一致且**停用中**
  SELECT count(*) INTO v_cnt
    FROM public.suppliers
   WHERE id = '00000000-0000-4000-8000-000000000352'::uuid
     AND label = '店內現貨'
     AND is_active = false;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#352-a1 驗收:「店內現貨」種子列不符(固定 id + label + is_active=false)';
  END IF;

  -- 6.9 🔴 **中間態斷言**:本片**不得**動 receipts 的 append-only 字面。
  --     那個更正屬於 a2(與刪除 RPC 同一支)——本片就改,等於讓 DB 契約
  --     在「刪除能力還不存在」的期間宣稱它存在(codex R2 打回的字面 vs 事實偏離)。
  -- 🔴 **逐字比整段,不是找子字串(關卡2 MF8)**:只檢查「含有 append-only」的話,
  --    把它改成「已**非** append-only」或「append-only,但可刪」照樣含那五個字、照樣全綠。
  --    ⇒ 釘死 A2 `:224` 當下那一整段字面;a2 要改它時本格會紅,那正是提醒「連同本格一起更新」。
  SELECT pg_catalog.obj_description('public.order_item_procurement_receipts'::regclass, 'pg_class')
    INTO v_txt;
  IF v_txt IS DISTINCT FROM
     'M-4b E10 A2(Sean 2026-07-29 拍板 A2-1=A 擴充):逐批到貨明細,append-only。一筆採購分幾批到貨就有幾列。🔴 order_item_procurement.received_quantity 的真相來源 = 本表 SUM(quantity);那條等式由 A4a 重算 trigger 維護,本片(M 型、零 trigger)沒有 DB 層強制。🔴 service_role only:供應商到貨資訊是內部資料,絕不對客。' THEN
    RAISE EXCEPTION '#352-a1 驗收:receipts 的表註解已被改動 —— '
      '那句話要到 a2(刪除 RPC 落地)才准改;本片改它 = 契約宣稱一個還不存在的能力。實際值 = %',
      coalesce(v_txt, '(無)');
  END IF;

  RAISE NOTICE '#352-a1 結構驗收通過:溢收欄 + 三條 CHECK + 冪等帳(逐欄型別/NOT NULL、零 FK、RLS、不可轉授 ACL)+ 種子列(停用中)+ 中間態註解逐字';
END
$verify$;

-- ── 7. 行為探針(關卡2 MF9;樣板 = A2 自己的 `20260729020000:505-520`)────
-- 🔴 **為什麼要有這一段**:plan §7-a1 第 1 條要求證明「`0+5` 寫得進、`0+0` 被擋」,
--    而原本我用「本片零 writer、構造不出前提」為由完全不測 —— 那是**把 owner 能做的事說成做不到**:
--    migration 是 owner 身分,`SAVEPOINT` + `ROLLBACK TO` 就能在**不留任何列**的前提下真的寫一次。
--    先前那些行為證據只存在於我的信裡,**別人重跑不出來**;放進 migration 才是每次 apply 都會自證。
-- 🔴 **零留痕**:整段做完一律拋 PC001 自我回滾 + 收尾斷言三張表列數不變。
-- ⚠️ **這段是「資料條件式」的,誠實講清楚它什麼時候真的跑**:
--    · **from-zero 拋棄式 PG**:migration 跑在 seed **之前** ⇒ `order_items` 是空的
--      ⇒ 探針**必定走「已略過」那一枝**。所以在 from-zero 環境裡,它**不構成**任何行為證據。
--    · **正式庫 apply**:`order_items` 有資料 ⇒ 探針會真的跑。
--    · ⇒ 為了證明它不是「恆略過的裝飾」,施工時**另外對已 seed 的庫實跑過整段**:
--      41 個合格品項、五格全過、三張表列數不變(結果附在 D-448-STOP)。
--    · 🔴 「略過」一律 `RAISE NOTICE` 印出來 —— **不可以讓「沒跑」看起來像「跑過了」**。
--      (第一版的前提查詢用 INNER JOIN 摘要表,而摘要列是 A4a 惰性建立的
--       ⇒ 「從沒被採購過」的品項根本沒有摘要列 ⇒ 候選集合恆空。就是這句 NOTICE 讓我當場看見。)
DO $probe$
DECLARE
  v_item  uuid;
  v_qty   integer;
  v_proc  uuid := gen_random_uuid();
  v_before_receipts bigint;
  v_before_ledger   bigint;
  v_con   text;
BEGIN
  SELECT count(*) INTO v_before_receipts FROM public.order_item_procurement_receipts;
  SELECT count(*) INTO v_before_ledger   FROM public.order_item_receipt_requests;

  -- 前提:要有一個可用的 order_item。正式庫/測試庫都可能沒有 ⇒ **沒有就誠實略過**,
  -- 但**略過這件事本身要印出來**(NOTICE),不可以讓「沒跑」看起來像「跑過了」。
  -- 🔴 **必須 LEFT JOIN**:A4a 的摘要列是**惰性建立**的 ⇒ 一個「從沒被採購過」的品項
  --    (正是我們要的前提)**根本沒有摘要列** ⇒ 用 INNER JOIN 會把候選集合清空、
  --    探針每次都走「已略過」那一枝 = **恆不執行的假綠**。
  --    (第一版就是 INNER JOIN,靠上面那句「略過也要印出來」的 NOTICE 才當場看見。)
  SELECT oi.id, oi.quantity INTO v_item, v_qty
    FROM public.order_items oi
    LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = oi.id
   WHERE oi.quantity >= 1
     AND coalesce(q.ordered_quantity, 0) = 0
     AND coalesce(q.cancelled_quantity, 0) = 0
     AND coalesce(q.instock_quantity, 0) = 0
   ORDER BY oi.id
   LIMIT 1;

  IF v_item IS NULL THEN
    RAISE NOTICE '#352-a1 行為探針:**已略過**(找不到「未被採購過」的 order_item 當前提)。'
      '結構驗收不受影響;CHECK 的行為證據這一次沒有取得。';
  ELSE
   -- 🔴 回滾手法 = **`RAISE … PC001` 再自己接住**,逐字沿用 A2 `:499-504` 的樣板。
   --    (PL/pgSQL **不支援** `SAVEPOINT` / `ROLLBACK TO` —— 我第一版就是這樣寫、當場 syntax error。
   --     plpgsql 的 `BEGIN…EXCEPTION` 本身就是用內部 savepoint 實作的,拋例外即回滾該區塊。)
   BEGIN
    INSERT INTO public.order_item_procurement
      (id, order_item_id, allocated_quantity, supplier_id, reply_status)
    VALUES (v_proc, v_item, v_qty, '00000000-0000-4000-8000-000000000352'::uuid, 'confirmed');

    -- P1 正向:一般到貨 ⇒ A4a 級聯把 instock 推上去
    INSERT INTO public.order_item_procurement_receipts
      (procurement_id, quantity, surplus_quantity, received_at, received_by)
    VALUES (v_proc, v_qty, 0, now() - interval '1 hour', 'migration_probe');

    -- P2 🔴 本片的重點:訂單收滿後才到的貨 = quantity 0 + surplus N(**舊 CHECK 會擋掉**)
    INSERT INTO public.order_item_procurement_receipts
      (procurement_id, quantity, surplus_quantity, received_at, received_by)
    VALUES (v_proc, 0, 5, now() - interval '30 minutes', 'migration_probe');

    -- P2 斷言:溢收**不得**影響 received / instock(這是「A4a 零改動」的直接證據)
    IF (SELECT received_quantity FROM public.order_item_procurement WHERE id = v_proc) <> v_qty THEN
      RAISE EXCEPTION '#352-a1 行為探針 P2:溢收竟然改變了 received_quantity';
    END IF;
    IF (SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id = v_item) <> v_qty THEN
      RAISE EXCEPTION '#352-a1 行為探針 P2:溢收竟然改變了 instock_quantity';
    END IF;

    -- P3 負向:0/0 必須被擋,**而且要紅在 total_positive**(紅在別條 = 我們沒證明到想證明的事)
    BEGIN
      INSERT INTO public.order_item_procurement_receipts
        (procurement_id, quantity, surplus_quantity, received_at, received_by)
      VALUES (v_proc, 0, 0, now(), 'migration_probe');
      RAISE EXCEPTION '#352-a1 行為探針 P3:0/0 竟然寫得進去';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'order_item_procurement_receipts_total_positive' THEN
        RAISE EXCEPTION '#352-a1 行為探針 P3:被擋了但紅在 %(預期 total_positive)', coalesce(v_con, '(NULL)');
      END IF;
    END;

    -- P4 負向:大寫 request_id 必須被 PK 形狀擋(「強制小寫」不是空話)
    BEGIN
      INSERT INTO public.order_item_receipt_requests
        (request_id, procurement_id, quantity, surplus_quantity, received_at, actor, receipt_id)
      VALUES ('ABC-UPPER', v_proc, 1, 0, now(), 'migration_probe', gen_random_uuid());
      RAISE EXCEPTION '#352-a1 行為探針 P4:大寫 request_id 竟然寫得進去';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'order_item_receipt_requests_request_id_shape' THEN
        RAISE EXCEPTION '#352-a1 行為探針 P4:被擋了但紅在 %', coalesce(v_con, '(NULL)');
      END IF;
    END;

    -- P5 正向:帶連字號的小寫 UUID(a2 最可能產的形狀)必須收得下
    INSERT INTO public.order_item_receipt_requests
      (request_id, procurement_id, quantity, surplus_quantity, received_at, actor, receipt_id)
    VALUES ('7f3a1c2e-0b44-4d8e-9a11-0c2d3e4f5a6b', v_proc, 1, 0, now(), 'migration_probe', gen_random_uuid());

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
   EXCEPTION
     -- 正向那幾筆若被守門擋下 = 我們把合法操作寫死了,要看得懂地紅
     WHEN check_violation OR foreign_key_violation OR not_null_violation OR unique_violation THEN
       RAISE EXCEPTION '#352-a1 行為探針:合法的到貨/溢收/小寫 UUID 竟被拒(%)', SQLERRM;
     WHEN SQLSTATE 'PC001' THEN
       NULL;  -- 預期路徑:探針做完,整段回滾
   END;
   RAISE NOTICE '#352-a1 行為探針通過:P1 一般到貨 / P2 溢收 0+5 可寫且【不動】received·instock / '
     'P3 0+0 紅在 total_positive / P4 大寫 request_id 被擋 / P5 帶連字號小寫 UUID 收得下(全部已回滾)';
  END IF;

  -- 收尾零留痕斷言(不論走哪一枝都要成立)
  IF (SELECT count(*) FROM public.order_item_procurement_receipts) <> v_before_receipts
     OR (SELECT count(*) FROM public.order_item_receipt_requests) <> v_before_ledger THEN
    RAISE EXCEPTION '#352-a1 行為探針:探針留下了列 —— 零留痕契約破裂';
  END IF;
END
$probe$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
-- ⚠️ **本片不可完全還原**,三件必須先處置(plan §9;這是**回滾的前置決策點,不是執行細節**):
--
--   ① 🔴 `quantity` 的舊 CHECK(`BETWEEN 1`)在已經有 `quantity = 0` 的溢收列時**還原不回去**。
--      「先匯出 surplus」**不能**讓 `ADD CONSTRAINT` 成功 —— 擋住的是那些列本身。
--      ⇒ 回滾前必須先拍板那些列怎麼辦(轉成 quantity=1?封存後刪?還是接受舊 CHECK 不還原?)。
--      **沒拍板就不准跑回滾。**
--
--   ② 種子供應商列**刪不掉**(`suppliers` 有兩支 block-delete trigger,`20260801140000:101-123`)
--      ⇒ 回滾只能維持 `is_active = false`。
--
--   ③ `DROP COLUMN surplus_quantity` = **溢收數字永久遺失**;
--      `DROP TABLE order_item_receipt_requests` = 冪等保護消失(重送會產生第二筆到貨)。
--      ⇒ 兩者都要**先匯出留存**。
--
--   🔴 **整段必須包在單一交易裡(關卡2 MF12)**:原本的草稿是裸指令序列,
--      後段失敗會留下「表已 DROP、舊 CHECK 卻還沒建回來」的**半套狀態** —— 回滾自己需要能回滾。
--   🔴 **「先匯出」不會讓守門自己通過(關卡2 MF12 後半)**:下面三道 `RAISE` 是**強制停下來做決定**,
--      不是「匯出完就會自動放行」。要真的往下走,執行者必須依 ① 的拍板結果**明確選一條**:
--        (a) 轉換:`UPDATE … SET quantity = 1 WHERE quantity = 0`(改變事實,要拍板)
--        (b) 清除:把那些列搬進封存表後刪除(要拍板)
--        (c) 不還原舊 CHECK:只 DROP 新增的兩條,`quantity BETWEEN 0` 保留(**推薦**,零資料損失)
--      —— 選 (c) 的話下面「還原舊 CHECK」那兩行就整段不要執行。
--
--     BEGIN;
--     SET LOCAL lock_timeout = '5s';
--     DO $$ BEGIN
--       IF EXISTS (SELECT 1 FROM public.order_item_procurement_receipts WHERE quantity = 0) THEN
--         RAISE EXCEPTION '有 quantity=0 的溢收列,舊 CHECK 還原不回去 — 先依 ①(a)/(b)/(c) 拍板,拒絕執行';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.order_item_procurement_receipts WHERE surplus_quantity <> 0) THEN
--         RAISE EXCEPTION '有溢收數字,DROP COLUMN 會永久遺失 — 先匯出【並確認匯出檔可讀】,拒絕執行';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.order_item_receipt_requests) THEN
--         RAISE EXCEPTION '冪等帳非空,DROP 會讓既有請求可被重放 — 先匯出,拒絕執行';
--       END IF;
--     END $$;
--     DROP TABLE public.order_item_receipt_requests;
--     ALTER TABLE public.order_item_procurement_receipts
--       DROP CONSTRAINT order_item_procurement_receipts_total_positive,
--       DROP CONSTRAINT order_item_procurement_receipts_surplus_range,
--       DROP COLUMN surplus_quantity;
--     -- ⚠️ 只有選 (a)/(b) 才執行這兩段(選 (c) 整段跳過):
--     ALTER TABLE public.order_item_procurement_receipts
--       DROP CONSTRAINT order_item_procurement_receipts_quantity_range;
--     ALTER TABLE public.order_item_procurement_receipts
--       ADD CONSTRAINT order_item_procurement_receipts_quantity_range
--         CHECK (quantity BETWEEN 1 AND 100000);
--     UPDATE public.suppliers SET is_active = false
--      WHERE id = '00000000-0000-4000-8000-000000000352'::uuid;
--     COMMIT;
-- ============================================================
