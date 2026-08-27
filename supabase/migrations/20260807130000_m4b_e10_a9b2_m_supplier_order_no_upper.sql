-- ============================================================
-- M-4b E10 · A9b2-M:供應商單號大小寫不敏感搜尋鍵(產生欄 + 索引)
-- ============================================================
-- 片級 plan:docs/specs/2026-08-07-e10-a9b2-m-supplier-order-no-upper-plan.md
-- 真權威 = A2 migration 20260729020000:150-155 逐字:
--   「🔴 A9b2 的搜尋語意在此定死:**對 upper(trim(輸入)) 做等值比對**。
--     供應商單號常被抄成大小寫不一(有人打 so-123、有人打 SO-123),只做原值等值會漏單;
--     改用 ILIKE/contains 又會全表掃。⇒ 建 upper() 函式索引,搜尋端照同一個表達式查。」
--
-- 🔴 **本片不是新決策,是執行既有拍板。** 母 plan :431(row 39)要求 A9b2「走 adapter 投影、
--    不開 DB RPC」,而 PostgREST 的 filter **無法對欄位套函式**(寫不出 `upper(col) = X`)
--    ⇒ A2 已拍死的語意在 adapter 上只剩三條路,兩條有硬傷:
--      · `.eq(supplier_order_no, X)`  → 區分大小寫 = **正是 A2 說會漏單的行為**,且原值等值
--                                        用不到建在 upper() 上的函式索引。
--      · `.ilike(supplier_order_no, X)` → 大小寫對了,但 🔴 **PostgREST 沒有 ESCAPE 機制**,
--                                        輸入裡的 `_` / `%` 會被當萬用字元 ⇒ 搜尋 **fail-open**。
--                                        而這畫面的用途是「到貨登錄靠它找單」= 貨登記到別人訂單上的入口。
--      · **產生欄 + 一般索引 + `.eq()`(本片)** → 唯一同時滿足三個條件的寫法。
--    片界與路線 = 主視窗 E-136-A 裁定(A9b2 拆 M〔本片〕→ A;A10c2 UI 第三片)。
--
-- ── 🔴 為什麼表達式是 upper(x) 而**不是** upper(btrim(x))────────────
--    A2 的字面是「upper(**trim(輸入)**)」—— trim 是**輸入側**的事,不是欄側。
--    儲存值已由 CHECK `order_item_procurement_supplier_order_no_nonempty`(A2 :95-102)保證
--    **前後零空白、且不含 U+200B/200C/200D/FEFF 零寬字元** ⇒ 欄側再 trim 是冗餘。
--    🔴 **trim 的責任因此明確落在 A9b2-A 的 `normalizeSupplierOrderNoSearch`**(domain 單一來源,
--    照 A9b1 的 `normalizeOrderNumberSearch` 形狀)。**這一欄不會幫呼叫端 trim。**
--
-- ── 🔴🔴 A9b2-A 的硬前置:JS `toUpperCase()` ≠ PG `upper()`(階段 C MF3)──────
--    本欄的大寫化由 **PG 的 `upper()`** 做;A9b2-A 的輸入側大寫化會由 **JS** 做。兩者不保證等價:
--      · JS 恆做 full case mapping(`'ß'.toUpperCase()` = `'SS'`、`'ﬁ'` → `'FI'`);
--      · PG 的 `upper()` 隨 collation provider 而異(libc 多為逐字元、ICU 才做 full mapping)。
--    而本欄的來源 CHECK(A2 :95-102)**只擋前後空白與四個零寬字元、不限 ASCII**
--    ⇒ 含這類字元的單號真的存得進來,屆時輸入側算出的鍵與欄裡的值不同 ⇒ `.eq()` **靜默回零筆**
--    = A2 :151 指名要防的「漏單」本身。
--    🔴 **A9b2-A 必須照 A9b1 的做法先擋非 ASCII 再 `toUpperCase()`**
--    (`packages/domain/src/order/order-number-search.ts:72-77` 逐字理由:`'ß' → 'SS'` 會把搜尋詞
--     靜默改寫成**另一張真實訂單的單號**)。差別在 A9b1 的兩種格式天生只含 ASCII、擋掉零損失,
--    而供應商單號**沒有格式限制** ⇒ A9b2-A 擋掉非 ASCII 時要一併決定「這種單號怎麼搜」,
--    不能默默回 invalid 就算了。**本片只負責把這條合約寫在欄的 COMMENT 裡,不在此解。**
--
-- ── 前置(實查,附行號)──────────────────────────────────────
--   · 舊函式索引 `…_supplier_order_no_upper_idx`(A2 :154)的**唯一**其他引用 = S1b :79/:91
--     的 DO 斷言,而 S1b 版本號較小、重播時排在本片**之前** ⇒ DROP 它不會打壞重播。
--   · 表級 `GRANT SELECT ON TABLE order_item_procurement TO service_role`(A2 :168)——
--     表級授權涵蓋日後新增的欄。**但這是慣例不是保證,4e 當場量**(誠實界見 4e 註解)。
--   · 全樹對本表的 INSERT / UPDATE **一律帶明確欄位清單**(A2 :398 起、A4a :308/:379、
--     A5a :354/:383、A9h-M :386/:415),且 A5a 的 `v_before` 是 `%ROWTYPE`(A9h-M :130)、
--     稽核走 `jsonb_build_object` 逐欄列舉(A9h-M :465/:473)非整列 serialize
--     ⇒ 加一個產生欄不會打壞任何既有寫入路徑,也不會意外進稽核 payload(產生欄本來就不可被 SET)。
--
-- 🔴 誠實邊界:**檔內 DO 只做結構驗、不放行為探針 —— 這是本片的判斷,不是既有慣例。**
--    ⚠️ **原本這裡寫「照 A4a :666 立下的慣例」,那句是錯的**(階段 C MF2):A4a :645 逐字是
--    「行為探針(條件式,**照 A2/D0 慣例**:無合適品項時 NOTICE 略過)」,:671-697 真的 INSERT
--    一列採購 + receipts 再刪掉;被我引用的「行為證據由 scripts/a4a-verify.sh 提供」在 :667、
--    而且只在**無合適資料時的略過分支**裡。⇒ **PCM 的慣例其實是「有檔內探針」,我引反了。**
--    本片仍選擇不放,理由是本片自己的成本效益:為了驗一個 `upper()`,不值得讓 apply 在正式站
--    插一列真採購列、觸發 A2b1 配額守門與 A4a 重算再刪掉。**這是取捨,不是先例。**
--    「產生欄真的算 upper」的**行為證據**由施工端在拋棄式 PG17 叢集實測、記在 plan §4-2 與 STOP:
--      ① INSERT 'so-123'  → 欄 = 'SO-123'
--      ② UPDATE 'ab/9_x'  → 欄 = 'AB/9_X'(🔴 `_` 原樣保留 = ILIKE 萬用字元洞的反面)
--      ③ UPDATE NULL      → 欄 = NULL
--    4b 的字面斷言之所以夠強,是因為**產生欄的表達式就是引擎逐字執行的東西**,
--    中間沒有「宣告」與「行為」的接線層 —— 這點與應用層的字面守門不同,不要照抄那邊的結論。
--    ⚠️ **但只在寫入當下成立**:STORED 的既有列值**不會**隨 collation / ICU 版本升級重算
--    (舊的 `upper()` 函式索引同族風險、非本片新增)。跨版升級後若大寫規則變了,
--    要重算的是**資料**,不是這條斷言 —— 4b 對那種漂移全盲。
--
-- 🔴 本片零資料寫入、零函式/trigger 改動。`supplier_order_no` 原欄不動;它的 nonempty CHECK
--    有「定義逐字未被弱化」的斷言(原欄本身存在與否**不另設斷言** —— 在本檔內恆真,見 4g)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 大小寫不敏感搜尋鍵(STORED 產生欄)────────────────────
-- 🔴 ADD COLUMN … STORED 會**整表重寫**並取 ACCESS EXCLUSIVE 鎖。本表列數以千計
--    (訂單量 100-300 筆/月)⇒ 重寫時間可忽略;lock_timeout 搶不到鎖就整支回滾、不卡線上。
ALTER TABLE public.order_item_procurement
  ADD COLUMN supplier_order_no_upper text
    GENERATED ALWAYS AS (pg_catalog.upper(supplier_order_no)) STORED;

COMMENT ON COLUMN public.order_item_procurement.supplier_order_no_upper IS
  'A9b2 跨單搜尋鍵:supplier_order_no 的大寫形(STORED 產生欄、不可手寫)。搜尋端一律對本欄做等值比對(A9b2-A 的 adapter .eq()),不要對 supplier_order_no 做 .eq(會漏大小寫不同的單)、也不要用 .ilike(PostgREST 無 ESCAPE、輸入的 _ 與 % 會變萬用字元 = 搜尋 fail-open)。🔴 本欄**不 trim** —— 儲存值的前後空白與零寬字元已由 order_item_procurement_supplier_order_no_nonempty CHECK 擋掉;輸入側的 trim 責任在 A9b2-A 的 normalizeSupplierOrderNoSearch。🔴🔴 呼叫端合約:本欄的大寫化是 **PG 的 upper()**,而輸入側是 **JS 的 toUpperCase()** —— 兩者不保證等價(JS 恆做 full case mapping,ß→SS、ﬁ→FI;PG 隨 collation provider 而異),而來源 CHECK 不限 ASCII ⇒ 這類單號存得進來。A9b2-A 必須照 A9b1 的 normalizeOrderNumberSearch(packages/domain/src/order/order-number-search.ts:72-77)先擋非 ASCII 再 toUpperCase,否則 .eq() 會靜默回零筆 = A2:151 指名要防的漏單。';

-- ── 2. 新索引(取代舊的函式索引)──────────────────────────
CREATE INDEX order_item_procurement_supplier_order_no_upper_col_idx
  ON public.order_item_procurement (supplier_order_no_upper)
  WHERE supplier_order_no_upper IS NOT NULL;

-- ── 3. 🔴 DROP 舊函式索引 ────────────────────────────────
-- 它與上面那支覆蓋**同一組值**(upper(NULL) = NULL ⇒ 兩個 partial 條件等價),留著是
-- 重複的寫入維護成本 + 「到底哪一支才是搜尋路徑」的歧義。實查零其他消費端(見檔頭前置)。
DROP INDEX public.order_item_procurement_supplier_order_no_upper_idx;

-- ── 4. 檔內 fail-closed 結構驗收(任一不符則整支回滾)────────
DO $verify$
DECLARE
  v_rel  oid := 'public.order_item_procurement'::regclass;
  v_gen  "char";
  v_txt  text;
  v_zw   text;
  v_cnt  integer;
BEGIN
  -- 4a. 欄存在**且真的是 STORED 產生欄**('s')。
  --     只驗「欄在」會被一個普通 text 欄騙過(那種欄不會自己跟著 supplier_order_no 變)。
  SELECT a.attgenerated INTO v_gen
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_rel AND a.attname = 'supplier_order_no_upper' AND NOT a.attisdropped;
  IF v_gen IS NULL THEN
    RAISE EXCEPTION 'A9b2-M 異常 — supplier_order_no_upper 欄不存在;拒繼續';
  END IF;
  IF v_gen <> 's' THEN
    RAISE EXCEPTION 'A9b2-M 異常 — supplier_order_no_upper 不是 STORED 產生欄(attgenerated=[%];普通欄不會跟著原欄變、搜尋會查到舊值);拒繼續', v_gen;
  END IF;

  -- 4b. 🔴 **生成表達式逐字**。這條是「大小寫真的被歸一」的觀察面 —— 4a 對「表達式寫成 lower()」
  --     或「寫成 supplier_order_no 原值」完全全盲(那些一樣是 attgenerated='s')。
  --     字面 = 當場量自 PG17 的 pg_get_expr 輸出(deparse 會拿掉 pg_catalog. 前綴),非憑記憶。
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_txt
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = v_rel AND a.attname = 'supplier_order_no_upper';
  IF v_txt IS DISTINCT FROM 'upper(supplier_order_no)' THEN
    RAISE EXCEPTION 'A9b2-M 異常 — 生成表達式應為 upper(supplier_order_no),實 [%];拒繼續', coalesce(v_txt, '(無)');
  END IF;

  -- 4c. 新索引定義逐字(字面量自當場 pg_get_indexdef)。
  --     🔴 **先查存在、再取定義**:`'…'::regclass` 在索引不存在時會**自己先炸**
  --     (`relation does not exist`)⇒ 整支照樣 fail-closed,但紅的是 PG 的裸錯誤、
  --     我這條斷言連開口的機會都沒有。突變 M3 實測到這點後才改成兩段式。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'i'   -- 階段 C nit:不濾 relkind 的話,同名的表/序列也會讓本條綠、訊息指錯方向
     AND c.relname = 'order_item_procurement_supplier_order_no_upper_col_idx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A9b2-M 異常 — 新索引 …_supplier_order_no_upper_col_idx 不存在(搜尋會全表掃);拒繼續';
  END IF;
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_txt
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = 'public.order_item_procurement_supplier_order_no_upper_col_idx'::regclass;
  IF v_txt IS DISTINCT FROM 'CREATE INDEX order_item_procurement_supplier_order_no_upper_col_idx ON public.order_item_procurement USING btree (supplier_order_no_upper) WHERE (supplier_order_no_upper IS NOT NULL)' THEN
    RAISE EXCEPTION 'A9b2-M 異常 — 新索引定義不符,實 [%];拒繼續', coalesce(v_txt, '(不存在)');
  END IF;

  -- 4d. 舊函式索引已消失(§3 的 DROP 真的生效;留著 = 重複維護 + 路徑歧義)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'order_item_procurement_supplier_order_no_upper_idx';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A9b2-M 異常 — 舊函式索引 …_supplier_order_no_upper_idx 仍在(應已 DROP);拒繼續';
  END IF;

  -- 4e. 🔴 service_role 對**新欄**要有 SELECT —— 沒有的話 A9b2-A 的 .eq() 直接死在 PostgREST。
  --     ⚠️ **誠實界(突變 M5 實測後改寫)**:這條抓得到的是「service_role 對本表根本沒有 SELECT」,
  --        **抓不到**「表級 GRANT 沒涵蓋到新欄」—— 後者在 PostgreSQL 裡構造不出來:
  --        欄級 `REVOKE SELECT (col)` **撤不掉表級授權**(實測:撤了之後本條仍綠)。
  --        ⇒ 別把它當成「已驗證表級涵蓋新欄」的證據;它是**日後有人把 A2 :168 那句表級 GRANT
  --        改成欄級**時才會紅的守門。「涵蓋新欄」這件事的真證據是上面那句實測本身。
  IF NOT pg_catalog.has_column_privilege('service_role', v_rel, 'supplier_order_no_upper', 'SELECT') THEN
    RAISE EXCEPTION 'A9b2-M 異常 — service_role 對 supplier_order_no_upper 無 SELECT(A9b2-A 的搜尋會直接死);拒繼續';
  END IF;

  -- 4f. 🔴🔴 anon / authenticated 對新欄**零 SELECT**。本欄是供應商單號的衍生值,
  --     洩漏面與原欄等價 —— A2 表 COMMENT 逐字:「service_role only:供應商名稱與單號絕不進
  --     orders / order_items(那兩張表對登入客人整表開放 SELECT,洩漏上游等於讓客人繞過 PCM)」。
  --     不能因為「只是個索引鍵」就漏掉這道。
  IF pg_catalog.has_column_privilege('anon', v_rel, 'supplier_order_no_upper', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', v_rel, 'supplier_order_no_upper', 'SELECT') THEN
    RAISE EXCEPTION 'A9b2-M 異常 — anon/authenticated 讀得到 supplier_order_no_upper(供應商單號洩漏面);拒繼續';
  END IF;

  -- 4g. 原欄的 nonempty CHECK **定義未被弱化** —— 它是本欄「不必 trim」這個前提的唯一支撐。
  --     🔴 只驗「同名 CHECK 存在」擋不住「同名但被弱化成 CHECK (true)」(關卡2 codex nit 1)——
  --        那種情況下前後空白會進得了庫,而本欄不 trim ⇒ `' SO-123 '` 永遠搜不到,且本片仍全綠。
  --     🔴 比對前先 `translate` 掉四個零寬字元:CHECK 本體含 U+200B/200C/200D/FEFF 的字面,
  --        直接寫進本檔會讓原始碼帶隱形字。**但正規化本身有盲點** —— 只改那段零寬字面的突變
  --        正規化後字串相同 ⇒ 另加逐字元計數把那個洞補起來。
  --
  --     ⚠️ **這裡拿掉了兩條原本有的斷言,理由與 :193 那條 `convalidated` 同一族**(階段 C MF1/nit):
  --       · 「`supplier_order_no` 原欄存在」——**在本檔內恆真**::71 的 `GENERATED ALWAYS AS
  --         (upper(supplier_order_no))` 沒有原欄根本建不起來,DO 在同交易之後才跑
  --         ⇒ 寫不出只紅它的負測。
  --       · 「同名 CHECK 存在」—— 被下面的逐字比對**嚴格蘊含**(約束缺席時 `v_txt = NULL`,
  --         `IS DISTINCT FROM` 一樣紅)。
  --       留著會讓人以為多守了兩層。標準與本檔其他地方一致:恆真或被蘊含的,刪。
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_txt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = v_rel AND contype = 'c'
     AND conname = 'order_item_procurement_supplier_order_no_nonempty';
  -- 🔴 **逐字元各驗一次、不驗總數**(階段 C nit):只數「四字元集合的出現次數 = 4」的話,
  --    把 CHECK 改成 `translate(x, U&'\200B\200B\200B\200B', '')` 照樣是 4、剝零寬後字串也相同
  --    ⇒ 兩條都綠,但 200C/200D/FEFF 已經不再被擋。
  FOREACH v_zw IN ARRAY ARRAY[U&'\200B', U&'\200C', U&'\200D', U&'\FEFF'] LOOP
    IF pg_catalog.length(v_txt) - pg_catalog.length(pg_catalog.replace(v_txt, v_zw, '')) <> 1 THEN
      RAISE EXCEPTION 'A9b2-M 異常 — nonempty CHECK 裡 U+% 的出現次數不是 1(該零寬字元已不被擋,混它的單號會入庫且搜不到);拒繼續',
        pg_catalog.upper(pg_catalog.to_hex(pg_catalog.ascii(v_zw)));
    END IF;
  END LOOP;
  IF pg_catalog.translate(v_txt, U&'\200B\200C\200D\FEFF', '') IS DISTINCT FROM
     'CHECK (((supplier_order_no IS NULL) OR ((supplier_order_no ~ ''^[^[:space:]]([^[:space:]]|.*[^[:space:]])?$''::text) AND (translate(supplier_order_no, ''''::text, ''''::text) = supplier_order_no))))' THEN
    RAISE EXCEPTION 'A9b2-M 異常 — nonempty CHECK 定義被改過(剝零寬後實 [%]);本欄「不必 trim」的前提沒了;拒繼續', pg_catalog.translate(v_txt, U&'\200B\200C\200D\FEFF', '');
  END IF;
  -- 🔴 **這裡原本還有一條 `convalidated` 斷言,實測後拿掉了**(關卡2 codex nit 1 的另一半):
  --    `pg_get_constraintdef` 對 NOT VALID 的 CHECK 會**在尾巴補上 ' NOT VALID'**
  --    (實測:`d2 = d || ' NOT VALID'` 為 true)⇒ 上面那條逐字比對**已經嚴格蘊含**它,
  --    寫不出「只紅 convalidated、不紅逐字比對」的負測 = 那條是 no-op。
  --    (memory `feedback_unconstructible-negative-test-means-noop-guard`:被嚴格蘊含的守門,
  --     唯一症狀就是構造不出只紅它的負測 —— 留著只會讓人以為多守了一層。)

  RAISE NOTICE 'A9b2-M 結構驗收全數通過(STORED 產生欄 + 生成表達式逐字 upper(supplier_order_no) / 新索引定義全等 + 舊函式索引已撤 / service_role 對新欄有 SELECT + anon·authenticated 零 SELECT / nonempty CHECK 定義逐字未弱化 + 四個零寬字元逐字元各恰 1 次)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(另立版本號更大的 down migration;Supabase forward-only):
--
--   BEGIN;
--   CREATE INDEX order_item_procurement_supplier_order_no_upper_idx
--     ON public.order_item_procurement (pg_catalog.upper(supplier_order_no))
--     WHERE supplier_order_no IS NOT NULL;
--   DROP INDEX public.order_item_procurement_supplier_order_no_upper_col_idx;
--   ALTER TABLE public.order_item_procurement DROP COLUMN supplier_order_no_upper;
--   COMMIT;
--
--   🔴 **序不可顛倒**:先把舊函式索引種回去、再撤新的,中間不留「一支索引都沒有」的窗口。
--   🔴 DROP COLUMN 會讓 A9b2-A 的 `.eq()` 回到 PostgREST 42703 ⇒ **回滾前先關 feature flag**
--      (A9b2-A / A10c2 一律掛 flag 預設 off,照 A10c1 前例;E-136-A:3)。
--   🔴 本片零資料寫入 ⇒ down 無資料面代價(產生欄的值全部可由原欄重算)。
--
-- 🔴 apply 併入 **E 線批**(A9h-M 20260806200000 + A9v 20260807120000 + 本片 20260807130000,
--    apply 序照時間戳;E-136-A:4)。apply 後才可重生 database.types.ts 並開 flag。
-- ============================================================
