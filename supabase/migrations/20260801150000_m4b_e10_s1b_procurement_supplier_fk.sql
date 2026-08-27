-- ============================================================
-- M-4b E10 S1b:`order_item_procurement` 供應商欄改指向主檔
-- ============================================================
-- 前身 = S1a(20260801140000)建 `public.suppliers` + seed 26 家。
-- 本片把採購真相表的供應商身分從「兩個文字欄」換成「一個指向主檔的 FK」:
--     supplier_name(text) + supplier_canonical_key(text)  →  supplier_id(uuid FK)
--
-- 為什麼是現在:2026-08-01 唯讀實查正式站 `order_item_procurement` **0 列**、
-- 且該表零 INSERT/UPDATE GRANT(A2 只給 service_role SELECT)、A5a 寫入 RPC 尚未存在
-- ⇒ **零資料、零 writer = 改形狀成本最低的窗口**。等 A10b 採購表單上線後再改就要搬資料。
--
-- 🔴 A5b(canonical key SQL 函式)與 A5c(相似度比對)已於同日作廢:
--    供應商改「主檔 + 下拉選單」後,同一家供應商在 DB 裡就是同一個 uuid,
--    「兩種寫法指向同一家」這個問題**在形狀層消失**,不需要任何名稱歸一算法。
--    拍板全集 = memory `project_m4b-supplier-master-decisions`;片級 plan =
--    `docs/specs/2026-08-01-e10-supplier-master-plan.md` §3.2 / §4。
--
-- 🔴 本片**不含**:owner 寫入 RPC(S2)、讀模型(S3a)、後台設定頁(S3b)、
--    `database.types.ts` 重 gen(型別由**正式站**產生 ⇒ 只有 apply 之後才做得了,見檔尾)。
--
-- 內容分級:純 schema、零 trigger、零函式、零資料列寫入。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘(fail-closed;先取鎖再查,不留競速窗)────────────
-- 🔴 順序有意義:若先 count 再 ALTER,兩者之間別的連線仍可 INSERT
--    ⇒ 先把表鎖成 ACCESS EXCLUSIVE(反正下面的 ALTER 也要這把),再做 0 列斷言。
--    (現況該表零寫入 GRANT、無 writer,這把鎖是把「現況為真」變成「當下為真」。)
LOCK TABLE public.order_item_procurement IN ACCESS EXCLUSIVE MODE;

DO $gate$
DECLARE
  v_cnt bigint;
BEGIN
  IF to_regclass('public.suppliers') IS NULL THEN
    RAISE EXCEPTION 'S1b 前置未滿足 — public.suppliers 不存在。本片的 FK 指向它,S1a(20260801140000)必須先套;拒繼續';
  END IF;

  -- 🔴 這道閘防的是**資料遺失**,不是形狀正確:supplier_name 一旦 DROP 就回不來,
  --    而本片沒有任何「文字名 → 主檔 uuid」的對照邏輯(刻意不寫:0 列時寫它等於寫死碼)。
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 前置未滿足 — order_item_procurement 實有 % 列,而本片會 DROP supplier_name(資料無法還原)。'
                    '有資料時正確做法是先寫一支「文字名對映到 suppliers.id」的資料搬遷 migration;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM public.order_item_procurement_receipts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 前置未滿足 — order_item_procurement_receipts 實有 % 列(明細指向的父列即將改形狀);拒繼續', v_cnt;
  END IF;
END;
$gate$;

-- ── 1. 拆掉舊形狀 ────────────────────────────────────────────
-- 🔴 DROP 之前先鎖死「相依物就是我實查過的那組」(關卡2 #11)。
--    `DROP COLUMN` 會**靜默**連帶刪掉引用該欄的索引、並遞迴到繼承子表;
--    我的實查是 2026-08-01 做的,而 apply 是 Sean 之後手動跑的 ——
--    中間任何人多開一個索引或一張子表,事後的 §4 驗收**看不出來它被刪了**
--    (它只驗「該在的在、不該在的不在」,不驗「消失的東西只有我打算刪的那些」)。
DO $predrop$
DECLARE
  v_txt text;
  v_cnt integer;
BEGIN
  -- 🔴 比**定義全文**不比名字(關卡2 R2):同名索引若被改成別的用途,只比名字會放行,
  --    然後下面照樣把它刪掉。
  -- 🔴 不用 `indexrelid::regclass::text`(關卡2 R2 實測):它的輸出隨 search_path 變化
  --    —— public 不在路徑時是 `public.x`、在路徑時是 `x` ⇒ 同一組索引在正式站可能被誤擋。
  --    `pg_get_indexdef()` 的輸出實測與 search_path 無關,用它當比較基準。
  SELECT count(*) INTO v_cnt FROM (
    (SELECT unnest(ARRAY[
       'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_canonical_key)',
       'CREATE INDEX order_item_procurement_canonical_key_idx ON public.order_item_procurement USING btree (supplier_canonical_key)',
       'CREATE UNIQUE INDEX order_item_procurement_pkey ON public.order_item_procurement USING btree (id)',
       'CREATE INDEX order_item_procurement_supplier_order_no_upper_idx ON public.order_item_procurement USING btree (upper(supplier_order_no)) WHERE (supplier_order_no IS NOT NULL)'])
     EXCEPT
     SELECT pg_catalog.pg_get_indexdef(indexrelid) FROM pg_catalog.pg_index
      WHERE indrelid = 'public.order_item_procurement'::regclass)
    UNION ALL
    (SELECT pg_catalog.pg_get_indexdef(indexrelid) FROM pg_catalog.pg_index
      WHERE indrelid = 'public.order_item_procurement'::regclass
     EXCEPT
     SELECT unnest(ARRAY[
       'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_canonical_key)',
       'CREATE INDEX order_item_procurement_canonical_key_idx ON public.order_item_procurement USING btree (supplier_canonical_key)',
       'CREATE UNIQUE INDEX order_item_procurement_pkey ON public.order_item_procurement USING btree (id)',
       'CREATE INDEX order_item_procurement_supplier_order_no_upper_idx ON public.order_item_procurement USING btree (upper(supplier_order_no)) WHERE (supplier_order_no IS NOT NULL)']))
  ) d;
  IF v_cnt <> 0 THEN
    SELECT string_agg(pg_catalog.pg_get_indexdef(indexrelid), E'\n' ORDER BY pg_catalog.pg_get_indexdef(indexrelid))
      INTO v_txt FROM pg_catalog.pg_index WHERE indrelid = 'public.order_item_procurement'::regclass;
    RAISE EXCEPTION 'S1b 前置未滿足 — 採購表索引定義與 2026-08-01 實查的對稱差為 % 筆。實際:%。'
                    '本片會 DROP 引用供應商欄的索引,未知或被改寫過的索引會被連帶靜默刪除;拒繼續', v_cnt, v_txt;
  END IF;

  -- 繼承子表:DROP COLUMN 會遞迴下去改子表,而子表不在本片的驗收視野內
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = 'public.order_item_procurement'::regclass) THEN
    RAISE EXCEPTION 'S1b 前置未滿足 — 採購表出現繼承子表,DROP COLUMN 會遞迴改它們;拒繼續';
  END IF;

  -- 欄級 ACL:DROP COLUMN 一併帶走,還原時無從得知原本授過什麼
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.order_item_procurement'::regclass
                AND NOT attisdropped AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'S1b 前置未滿足 — 採購表有欄級 ACL,會隨 DROP COLUMN 消失且無法還原;拒繼續';
  END IF;
END;
$predrop$;

-- 🔴 具名 DROP,不靠 DROP COLUMN 的連帶效果:名稱是 2026-08-01 從正式站
--    pg_constraint / pg_indexes 實查來的,不是猜的。
ALTER TABLE public.order_item_procurement
  DROP CONSTRAINT order_item_procurement_business_key;

DROP INDEX public.order_item_procurement_canonical_key_idx;

ALTER TABLE public.order_item_procurement
  DROP COLUMN supplier_name,
  DROP COLUMN supplier_canonical_key;

-- 🔴 以下三項**連帶自動消失**,不是漏寫(已實查:兩條 CHECK 各自只引用被刪的那一欄,
--    COMMENT 依附於欄):
--    · CONSTRAINT order_item_procurement_supplier_name_nonempty
--    · CONSTRAINT order_item_procurement_canonical_key_nonempty
--    · COLUMN COMMENT on supplier_canonical_key(A2 20260729020000:120-121)
--    下方 §3 的驗收會逐條斷言它們真的不在了 —— 「應該會連帶消失」不算證據。

-- ── 2. 換上新形狀 ────────────────────────────────────────────
-- ON DELETE RESTRICT:採購紀錄指著誰,那家就不能消失(與 S1a「不可刪除」同向)。
-- ON UPDATE RESTRICT:主檔的 id 是永久身分,改名只改 label、id 不得變動。
-- 🔴 FK 名稱不顯式指定 = 沿用 PG 的 <table>_<col>_fkey,與同表既有的
--    order_item_procurement_order_item_id_fkey 一致;驗收會釘死這個名字。
ALTER TABLE public.order_item_procurement
  ADD COLUMN supplier_id uuid NOT NULL
    REFERENCES public.suppliers(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 沿用原名:對外(A5a 冪等 upsert、既有文件)的鍵名不變,只換第二欄的語意載體。
ALTER TABLE public.order_item_procurement
  ADD CONSTRAINT order_item_procurement_business_key UNIQUE (order_item_id, supplier_id);

-- 🔴 這條索引不是「順手加的」:新 business key 以 order_item_id 開頭,
--    對「這家供應商有哪些採購」這個維度(到貨登錄畫面依供應商分組)完全用不上
--    —— 舊的 canonical_key 單欄索引正是幹這件事的,DROP 掉就得補回等價物。
CREATE INDEX order_item_procurement_supplier_id_idx
  ON public.order_item_procurement (supplier_id);

-- ── 3. COMMENT 同步(🔴 舊字面零殘留)────────────────────────
-- 🔴 TABLE COMMENT 是**整段覆蓋**,不是追加 ⇒ 必須把 A1(20260730150000:170-174)
--    當時修正過的內容一起帶過來,否則這次改一句話會把上一次的修正靜默刪掉。
--    (這正是 memory `feedback_claimed-sync-but-only-patched-touched-lines` 那類事故的形狀。)
COMMENT ON TABLE public.order_item_procurement IS
  'M-4b E10 A2:向供應商採購的真相表(每個 order_item 可有多列 = 同一品項拆給多家供應商)。'
  '🔴 2026-07-31(A1)起:摘要值 ordered_quantity / instock_quantity 落在 **public.order_item_quantity_summary**'
  '(員工專用表),不在 order_items —— 由本表明細推導(A4a trigger),不得手填。'
  '🔴 2026-08-01(S1b)起:供應商身分 = **supplier_id → public.suppliers(id)** 的 FK(主檔 + 下拉選單),'
  '本表不存任何供應商名稱文字;顯示名一律 JOIN suppliers.label 取得。'
  '(換形狀的來龍去脈與被結案的合約債,記在 order_item_procurement_business_key 的約束註解裡 ——'
  '註解本身不重複已死的欄位名,否則它會變成下一次 grep 的假陽性。)'
  '🔴 service_role only:供應商名稱與單號絕不進 orders / order_items'
  '(那兩張表對登入客人整表開放 SELECT,洩漏上游等於讓客人繞過 PCM)。';

COMMENT ON COLUMN public.order_item_procurement.supplier_id IS
  '向哪一家供應商下的單 → public.suppliers(id)。'
  '🔴 顯示名不快照:改名後**所有歷史採購都會顯示新名字**(Sean 2026-08-01 Q1=A 知情選擇)'
  ' —— 代價是翻舊帳時名字與當時單據不一致;日後若要快照需另加欄並回填。'
  '🔴 FK 只驗「這家存在」、不驗「這家可用」:指向 is_active=false 的供應商在 DB 層是合法的,'
  '拒收停用供應商是寫入端(A5a RPC)的契約。';

COMMENT ON CONSTRAINT order_item_procurement_business_key ON public.order_item_procurement IS
  'upsert 業務鍵(同一品項同一家供應商只有一列;A5a 的冪等重放靠它)。'
  '🔴 2026-08-01 明文結案 A2(20260729020000:123-126)登記的合約債 ①'
  '「DB 尚未強制 supplier_canonical_key = A5b 函式對 supplier_name 的輸出」——'
  '**該債隨形狀改變而消滅,不是被忽略**:canonical key 欄已移除、A5b/A5c 已作廢,'
  '供應商身分改由主檔 uuid 決定 ⇒ 「同一列的 key 與 name 會不一致」這個具體風險不再存在。'
  '🔴 結案範圍僅止於此,**不等於「重複供應商不可能」**:主檔裡仍可能被人建出 '
  'Eazi-Grip 與 Eazi Grip 兩筆(兩個 uuid、label UNIQUE 擋不住),本鍵也允許同品項各指一筆。'
  '防線是新增畫面的 typeahead(人眼)—— 這是 Sean 2026-08-01 明知並選擇的做法,不是漏洞。'
  '🔴 另換來一筆等價新債:本鍵只保證同一 uuid 不重複,'
  '**不阻止採購指向已停用(is_active=false)的供應商** ⇒ 見 supplier_id 欄註解與 A5a 驗收條件。';

-- ── 4. 檔內結構驗收(fail-closed;任一不符則整支 migration 回滾)──
DO $verify$
DECLARE
  v_cnt integer;
  v_txt text;
BEGIN
  -- 4.1 舊兩欄零殘留(NOT attisdropped:DROP COLUMN 會留下 attisdropped=true 的殘骸列)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND NOT attisdropped
     AND attname IN ('supplier_name', 'supplier_canonical_key');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 形狀異常 — 舊供應商文字欄仍在(% 欄);拒繼續', v_cnt;
  END IF;

  -- 4.2 supplier_id:存在、uuid、NOT NULL
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND NOT attisdropped
     AND attname = 'supplier_id'
     AND atttypid = 'uuid'::regtype
     AND attnotnull;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'S1b 形狀異常 — supplier_id 應為 uuid NOT NULL 且恰一欄,實命中 %;拒繼續', v_cnt;
  END IF;

  -- 4.3 FK:具名、指向 suppliers、兩個 RESTRICT、**且已驗證**
  -- 🔴 convalidated(關卡2 #12):同一支 FK 加 NOT VALID 也擋得住「新插入」的壞列,
  --    行為負測會照樣全綠,但既有列從未被檢查 ⇒ schema 狀態已漂移而無人察覺。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname = 'order_item_procurement_supplier_id_fkey'
     AND contype = 'f'
     AND confrelid = 'public.suppliers'::regclass
     AND confdeltype = 'r'
     AND confupdtype = 'r'
     AND convalidated;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'S1b FK 異常 — order_item_procurement_supplier_id_fkey 應存在、指向 suppliers、ON DELETE/UPDATE 皆 RESTRICT 且 convalidated;拒繼續';
  END IF;

  -- 4.4 business key 的定義逐字(只驗名字會漏掉「名字對、欄位錯」)
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname = 'order_item_procurement_business_key';
  IF v_txt IS DISTINCT FROM 'UNIQUE (order_item_id, supplier_id)' THEN
    RAISE EXCEPTION 'S1b business key 異常 — 定義應為 UNIQUE (order_item_id, supplier_id),實為 %;拒繼續', coalesce(v_txt, '<不存在>');
  END IF;

  -- 4.5 供應商維度索引在、舊 canonical 索引不在
  IF to_regclass('public.order_item_procurement_supplier_id_idx') IS NULL THEN
    RAISE EXCEPTION 'S1b 索引異常 — supplier_id 索引不存在;拒繼續';
  END IF;
  SELECT pg_catalog.pg_get_indexdef('public.order_item_procurement_supplier_id_idx'::regclass) INTO v_txt;
  IF v_txt IS DISTINCT FROM
     'CREATE INDEX order_item_procurement_supplier_id_idx ON public.order_item_procurement USING btree (supplier_id)' THEN
    RAISE EXCEPTION 'S1b 索引異常 — supplier_id 索引定義不符,實為 %;拒繼續', coalesce(v_txt, '<不存在>');
  END IF;
  IF to_regclass('public.order_item_procurement_canonical_key_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'S1b 索引異常 — 舊 canonical_key 索引仍在;拒繼續';
  END IF;

  -- 4.6 約束**雙向集合相等**(關卡2 #13:原本只寫了 NOT IN 那一半 =「不得有多的」,
  --     拿掉 PK / order_item FK / 任一 range CHECK 照樣 v_cnt=0 全綠。
  --     這正是 S1a commit body 自稱修掉、我卻在本片重犯的同一個錯。)
  SELECT count(*) INTO v_cnt
    FROM (
      (SELECT unnest(ARRAY[
         'order_item_procurement_pkey',
         'order_item_procurement_order_item_id_fkey',
         'order_item_procurement_supplier_id_fkey',
         'order_item_procurement_business_key',
         'order_item_procurement_allocated_range',
         'order_item_procurement_received_range',
         'order_item_procurement_reply_status_check',
         'order_item_procurement_contact_channel_nonempty',
         'order_item_procurement_exception_reason_nonempty',
         'order_item_procurement_supplier_order_no_nonempty'])
       EXCEPT
       SELECT conname FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.order_item_procurement'::regclass AND contype IN ('c','u','p','f'))
      UNION ALL
      (SELECT conname FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.order_item_procurement'::regclass AND contype IN ('c','u','p','f')
       EXCEPT
       SELECT unnest(ARRAY[
         'order_item_procurement_pkey',
         'order_item_procurement_order_item_id_fkey',
         'order_item_procurement_supplier_id_fkey',
         'order_item_procurement_business_key',
         'order_item_procurement_allocated_range',
         'order_item_procurement_received_range',
         'order_item_procurement_reply_status_check',
         'order_item_procurement_contact_channel_nonempty',
         'order_item_procurement_exception_reason_nonempty',
         'order_item_procurement_supplier_order_no_nonempty']))
    ) AS symmetric_diff;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 約束異常 — 約束集合與預期的對稱差為 % 筆(少了或多了都算);拒繼續', v_cnt;
  END IF;

  -- 兩條依附舊欄的 CHECK 必須已隨欄消失(明文斷言「連帶效果真的發生了」)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname IN ('order_item_procurement_supplier_name_nonempty',
                     'order_item_procurement_canonical_key_nonempty');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 約束異常 — 舊供應商 CHECK 仍在(% 條);拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND contype = 'c' AND NOT convalidated;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 約束異常 — 未驗證 CHECK 應為 0,實 %;拒繼續', v_cnt;
  END IF;

  -- 4.7 COMMENT 兩個方向都要驗(關卡2 #14:只驗「禁字不存在」的話,
  --     把三段 COMMENT 整個省略不下,舊 A1 表註解原封留著,這裡照樣全綠)。
  -- 🔴 classoid 不可省(關卡2 #15):pg_description 的鍵是 (objoid, classoid, objsubid),
  --    只比 objoid 會撈到「別的 catalog 裡剛好同 OID」的註解 ⇒ 誤判並讓整支 migration 回滾。
  --
  -- (a) 禁字方向:表 + 全欄
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_description d
   WHERE d.objoid = 'public.order_item_procurement'::regclass
     AND d.classoid = 'pg_catalog.pg_class'::regclass
     AND (d.description LIKE '%canonical%' OR d.description LIKE '%supplier_name%');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b COMMENT 異常 — 仍有 % 處表/欄註解提到已不存在的 canonical key / supplier_name;拒繼續', v_cnt;
  END IF;
  -- 唯一允許提到舊欄名的地方 = business key 的註解(它的工作就是記載那筆債結案了)。
  -- 🔴 用「白名單一個具名約束」而不是「訊息裡有沒有『結案』兩個字」——
  --    後者是拿措辭當守門,任何人在別條註解裡寫上那兩個字就能靜默穿過。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_description d
    JOIN pg_catalog.pg_constraint c ON c.oid = d.objoid
   WHERE d.classoid = 'pg_catalog.pg_constraint'::regclass
     AND c.conrelid = 'public.order_item_procurement'::regclass
     AND (d.description LIKE '%canonical%' OR d.description LIKE '%supplier_name%')
     AND c.conname <> 'order_item_procurement_business_key';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b COMMENT 異常 — % 條約束註解仍提到已不存在的 canonical key / supplier_name;拒繼續', v_cnt;
  END IF;

  -- (b) 必要內容方向:三段註解必須真的存在、且帶上它們各自負責記住的那件事
  SELECT d.description INTO v_txt
    FROM pg_catalog.pg_description d
   WHERE d.objoid = 'public.order_item_procurement'::regclass
     AND d.classoid = 'pg_catalog.pg_class'::regclass AND d.objsubid = 0;
  IF v_txt IS NULL OR v_txt NOT LIKE '%S1b%' OR v_txt NOT LIKE '%suppliers%'
     OR v_txt NOT LIKE '%order_item_quantity_summary%' THEN
    RAISE EXCEPTION 'S1b COMMENT 異常 — 表註解必須同時保留 A1 的 order_item_quantity_summary 更正與本片的 suppliers/S1b 說明,實為 [%];拒繼續',
                    coalesce(left(v_txt, 80), '<不存在>');
  END IF;

  SELECT d.description INTO v_txt
    FROM pg_catalog.pg_description d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
   WHERE d.objoid = 'public.order_item_procurement'::regclass
     AND d.classoid = 'pg_catalog.pg_class'::regclass AND a.attname = 'supplier_id';
  IF v_txt IS NULL OR v_txt NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'S1b COMMENT 異常 — supplier_id 欄註解必須存在且載明「FK 不驗 is_active」這筆新債,實為 [%];拒繼續',
                    coalesce(left(v_txt, 80), '<不存在>');
  END IF;

  SELECT d.description INTO v_txt
    FROM pg_catalog.pg_description d
    JOIN pg_catalog.pg_constraint c ON c.oid = d.objoid
   WHERE d.classoid = 'pg_catalog.pg_constraint'::regclass
     AND c.conrelid = 'public.order_item_procurement'::regclass
     AND c.conname = 'order_item_procurement_business_key';
  IF v_txt IS NULL OR v_txt NOT LIKE '%123-126%' OR v_txt NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'S1b COMMENT 異常 — business key 註解必須同時載明 A2:123-126 舊債結案與 inactive 新債,實為 [%];拒繼續',
                    coalesce(left(v_txt, 80), '<不存在>');
  END IF;

  -- 4.8 本片零資料寫入(改形狀不是搬資料)
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 異常 — 本片不應產生任何列,實 %;拒繼續', v_cnt;
  END IF;

  -- 4.9 回歸:本片不得動到 A2 已定的 RLS / ACL
  -- 🔴 關卡2 #17:原本只點名 4 種權限 + 1 個角色 ⇒ 授 anon SELECT、或給 service_role
  --    REFERENCES / TRIGGER / MAINTAIN(PG17 新增)都會靜默通過。改成整張 ACL 攤平比對:
  --    「(grantee, privilege) 的集合恰等於 {(owner, 全部), (service_role, SELECT)}」。
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.order_item_procurement'::regclass) THEN
    RAISE EXCEPTION 'S1b 回歸異常 — RLS 被關掉了;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.order_item_procurement'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 回歸異常 — 採購表應為 zero-policy,實 % 條;拒繼續', v_cnt;
  END IF;
  -- relacl 為 NULL 代表「預設權限」,整組 ACL 斷言會變成假綠(a7bt-acl 那次的教訓)
  IF (SELECT relacl FROM pg_catalog.pg_class WHERE oid = 'public.order_item_procurement'::regclass) IS NULL THEN
    RAISE EXCEPTION 'S1b 回歸異常 — 採購表 relacl 為 NULL,ACL 斷言不成立;拒繼續';
  END IF;
  -- 🔴 兩處關卡2 R2 修正:
  --    ① 帶 `is_grantable` —— 實測 `GRANT SELECT … WITH GRANT OPTION` 攤平後與普通 SELECT
  --       **字串完全相同**,不帶這一欄等於放行「service_role 可以把讀權轉授給別人」。
  --    ② owner 用 **OID** 比(`a.grantee <> c.relowner`),不用渲染後的名字 ——
  --       需要引號的角色名(含大寫或特殊字元)會被 pg_get_userbyid 加上引號而比不中。
  SELECT string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p) INTO v_txt
    FROM (
      SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p,
             a.is_grantable::text AS gr
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
       WHERE c.oid = 'public.order_item_procurement'::regclass
         AND a.grantee <> c.relowner
    ) x;
  IF v_txt IS DISTINCT FROM 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'S1b 回歸異常 — 採購表非 owner 的授權應恰為 service_role:SELECT:false(不可轉授),實為 [%];拒繼續',
                    coalesce(v_txt, '<無>');
  END IF;
  -- PUBLIC(grantee = 0)單獨再確認一次:它不會出現在上面的使用者名稱比對裡
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_item_procurement'::regclass AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 回歸異常 — 採購表對 PUBLIC 有 % 筆授權;拒繼續', v_cnt;
  END IF;
  -- 新欄不得帶欄級 ACL(表級收斂了、欄級照樣能開後門)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S1b 回歸異常 — 採購表有 % 個欄位帶欄級 ACL;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'S1b 結構驗收全數通過(舊兩欄已除 / supplier_id FK 雙 RESTRICT / business key 換軸 / 供應商索引補回 / COMMENT 零殘留 / 0 列 / ACL 未動)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 apply 之後的硬前置(本檔做不到,不得當成已完成):
--    `packages/adapters/src/supabase/database.types.ts` 必須重 gen ——
--    它現在仍宣稱 order_item_procurement 有 supplier_name / supplier_canonical_key。
--    型別由**正式站** schema 產生 ⇒ 只有 Sean `supabase db push` 之後才做得了。
--    🔴 重 gen 會沖掉檔內三處人工校正(create_order.Args 的 p_client_ip / p_client_ua /
--       p_notification_email 的 `| null`,PostgREST 表達不了「必填但可為 null」),
--       重 gen 後必須貼回、以 typecheck 轉綠為證(已復發過一次,見 STATUS 2026-08-01 早)。
--
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only,對齊 A2 檔尾慣例),
--    **不刪 migration ledger 列**。down 必須逐項還原,不是一句「加回兩欄」:
--      ① DROP CONSTRAINT order_item_procurement_business_key
--         + DROP INDEX order_item_procurement_supplier_id_idx
--         + DROP COLUMN supplier_id(FK 隨欄消失)
--      ② ADD COLUMN supplier_name / supplier_canonical_key(兩者原為 NOT NULL;
--         0 列時可直接 NOT NULL,非 0 列則無從還原內容 —— 那正是 §0 閘存在的理由)
--      ③ 加回兩條 *_nonempty CHECK(**具名**,匿名 ADD CHECK 會產生別的名字 ⇒ schema diff 漂移)
--      ④ 加回 **具名** CONSTRAINT order_item_procurement_business_key
--         UNIQUE (order_item_id, supplier_canonical_key)
--      ⑤ 加回 INDEX order_item_procurement_canonical_key_idx ON (supplier_canonical_key)
--      ⑥ 逐字還原 A2 的 supplier_canonical_key COLUMN COMMENT 與 A1 的 TABLE COMMENT
--         (兩者的原文在 20260729020000:120-121 與 20260730150000:170-174)
--      ⑦ 重 gen database.types.ts(否則 TS 仍宣稱 supplier_id)
--    🔴 down migration 自己要有結構斷言 —— 0 列閘只防業務資料遺失,
--       證明不了「還原到 prior state」。
--
--    ✅ **①-⑤ 的 DDL 序列已實測**(2026-08-01,拋棄式 PG17、單一交易內跑完再 ROLLBACK):
--       可執行,且 business key 定義字面、canonical 索引存在、supplier_id 已消失三條斷言成立;
--       ROLLBACK 後主庫結構零留痕(複驗過)。
--    🔴 **⑥⑦ 未測**:COMMENT 還原與型別重 gen 沒跑過 ⇒ 上句只涵蓋 DDL 形狀。
--       ⑥ 的兩段原文必須從 20260729020000:120-121 與 20260730150000:170-174 逐字取回,不得憑記憶重寫。
--
--    🔴🔴 **這份 rollback 只在採購表仍為 0 列時成立**(關卡2 #20)。一旦 S2/A5a 開始寫入:
--       · 舊兩個 NOT NULL 文字欄**沒有值可以補** —— uuid 反查得到 label,但 canonical key 是
--         A5b 的產物而 A5b 已作廢、函式不存在 ⇒ 要嘛先建臨時欄再回填、要嘛放棄還原那一欄。
--       · 下游必須**逆序**先撤:S3b 設定頁 → S3a 讀模型 → S2 的 owner RPC → 才輪到本片。
--       ⇒ **有資料之後這份 rollback 不可照抄**,必須重寫成含資料反向對映的版本。
-- ============================================================
