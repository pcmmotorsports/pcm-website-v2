-- ============================================================
-- M-4b · L5b-2 片 2c:退款帳本的欄與 CHECK 三件
-- 依據:docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§2 片表 2c、§2f-1~3
-- 鐵則 12:③DB 結構(動已上線的退款帳本 schema)
--
-- 三件(全部是**純加法**:加一欄 + 加三條 CHECK,零 DROP、零改型別、零改既有約束):
--   ① `payment_refunds.rec_trade_id`(nullable text + 形狀 CHECK)      §2f-1
--   ② `payment_refunds.strong_key` 的**值域** CHECK(前綴強制)         §2f-2
--   ③ `payment_refund_events` 的 `manual` 事件必須帶可判讀的 verdict  §2f-3
--
-- ── 🔴 開工前照本線自己的 §2a-X 七條逐條重問(不照抄 2a)──────────────
-- 那張表是 Fable R3 逼出來的,目的就是防「把 2a 的前提當通則搬過來」。逐條結果:
--   1. **pre-image 指紋的對象要換**:2a 釘的是函式的 `pg_get_functiondef`;本片一支函式都不動,
--      釘那個沒有意義。本片改釘**表的形狀**(欄集合 + 既有 CHECK 名稱集合),見下方前置閘。
--   2. **`pg_depend`**:2a 問的是「DROP 會不會連坐」;本片零 DROP ⇒ 不適用。
--      但**加 CHECK 會驗既有列** ⇒ 換成問「表現在有幾列」(見前置閘④)。
--   3. **ACL allowlist**:本片不動任何函式 ACL ⇒ 不適用。改確認**加欄沒有改變表的可達面**(前置閘⑤)。
--   4. **owner 承重論證**:那條壓在「函式 owner 是 postgres」上;本片不動函式 ⇒ 不適用。
--   5. **併發實測結論**:2a 那條是關於 `DROP FUNCTION` 的鎖行為;本片是 `ALTER TABLE` ⇒ **不可沿用**,
--      本片自己的鎖面寫在下方「apply 當下的鎖」。
--   6. **成組回退閘**:那是 2e/2f/2g 的義務;本片不在那個批次裡 ⇒ 不適用。
--   7. **`DROP`+重建非預設**:本片零 DROP ✅。
--
-- ── 🔴 單位對齊(plan §核心點 2 指名的硬前置,**本片必須定死、不得靠推論**)────
-- 問題:`payment_refunds.amount` 註解逐字「整數**元**(全庫慣例,非分)」(`20260810140000:82`),
--       而母 plan 標 `record.amount` 的單位「本檔未確認」⇒ 兩邊差 100 倍的 bug 在測試裡只長成「數字不一樣」。
-- **定案(本片據以施工):`record.amount` = 整數元,與本表 `amount` 同尺度,寫入端不做換算。**
-- ⚠️ 措辭刻意不寫成無條件的「零換算」(對抗審查 R3=N2:原字面比下方誠實邊界強半步)——
--    下面 ⑤ 是 sandbox 觀測、④ 是生產行為背書,兩者都不是「正式站一筆真 Record 並排比對」。
--    ⇒ 這是**依現有證據做的定案**,不是已證明的恆等式;證據升級前它就是本片的施工前提。
-- 依據鏈(每節都有座標):
--   ① `packages/domain/src/shared/types.ts:23-24` 逐字:「單位為最小貨幣單位 — **TWD: 元位整數**
--      (例:NT$ 4,000 → amount: 4000)」⇒ 本 repo 的「最小貨幣單位」對 TWD **就是元**,不是分。
--   ② `20260604120000:25` 逐字:「金額一律 integer **元位**(禁浮點)」;`:104` `total integer NOT NULL`。
--   ③ `packages/adapters/src/tappay/TapPayChargeAdapter.ts:104`:送給 TapPay 的 `amount`
--      **就是**那個 MoneyAmount(註解逐字「server 權威 total」)⇒ 我們送出去的整數是元。
--   ④ 同檔 `:153`:TapPay **回應**的 `amount` 被直接餵進 `toMoneyAmount()` 當權威金額 ——
--      這條路徑**正在收真實信用卡款**;若回應尺度是分,現行生產程式早就差 100 倍炸開。
--      ⇒ 回應側同尺度**由生產行為背書**,不只是推論。
--   ⑤ 🔴 **直接觀測一筆真 Record 的 `amount`**(對抗審查 R2 指出 ④ 引的是 charge 回應、
--      不是待證的 Record 回應 —— 兩支 API 若尺度不同,④ 那條論證會整條誤判)。
--      `docs/reference/tappay-reference.md:116` 逐字:交易 `D202607314b3cIL`(**本金 6 元**)
--      `query` 回 `amount=6` / `refunded_amount=0`;同檔 `:167` 退 1 之後
--      `amount 6→5`、`refunded_amount 0→1`。
--      ⇒ Record 的 `amount` 對一筆 6 元交易讀到 6(不是 600)= **本片要的那個尺度被直接量到**,
--        而且是在「退款前後」兩個時點各量一次,不是單點巧合。
-- ⚠️ **誠實邊界**(R2 之後已收窄,但**沒有消失**):
--    ⑤ 是 **sandbox** 的觀測,不是正式商戶的一筆單;⑤ 比對的是「本金 6 元 ↔ amount=6」,
--    **不是** `orders.total` 與 Record `amount` 在同一張真實訂單上並排。
--    ⇒ 現在的依據結構是:**正式尺度靠 ④(生產行為)、Record API 尺度靠 ⑤(直接觀測)**,兩節各補一半。
--    取得一筆**正式站**的 Record 實例後,應回頭把 ⑤ 升級成正式站觀測。
--    佐證(**非權威、不作為依據**):主視窗 2026-08-11 於正式庫觀察
--    `payment_webhook_events.amount` 7 張單逐字等於 `orders.total`。
--
-- ── apply 當下的鎖(本片自己的,不沿用 2a)────────────────────────────
-- `ADD COLUMN`(nullable、無 DEFAULT)= 只改 catalog、**不重寫表**(對齊 `20260809230000:78` 的同款判斷)。
-- `ADD CONSTRAINT … CHECK`(未加 NOT VALID)會**掃描既有列**驗證 ⇒ 兩者都取 `ACCESS EXCLUSIVE`,
-- 但本表列數極少(前置閘④ 會印出來)⇒ 持鎖時間以毫秒計。`lock_timeout` 5s 兜底。
-- ============================================================


BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── 0. 前置閘(fail-closed)────────────────────────────────────────────────
DO $l5b2_2c_preflight$
DECLARE
  v_cols text;
  v_cons text;
  v_rows bigint;
  c_cols constant text :=
    'amount,attempt_id,created_at,currency,id,idempotency_key,lease_token,strong_key,supersedes_refund_id';
  -- 🔴 這個集合是**跟 catalog 要的**,不是從建表檔用眼睛數的。
  --    我第一版憑 grep 結果推,多寫了一個不存在的 `order_id`(建表檔那兩行剛好落在我的正規式之外)
  --    ⇒ 前置閘當場擋下我自己。這正是它存在的理由:**枚舉型常數必須來自權威來源**,
  --    而「我讀過那個檔」不是權威來源(memory `feedback_assert-scope-only-after-reading-source-file`)。
  c_cons constant text :=
    'pr_amount_positive_chk,pr_currency_domain_chk,pr_idem_key_shape_chk,pr_lease_token_nonneg_chk,'
    || 'pr_not_self_chk,pr_strong_key_nonblank_chk';
BEGIN
  -- ① 兩張表都要在(L5b 帳本 20260810140000 已 apply)
  IF pg_catalog.to_regclass('public.payment_refunds') IS NULL
     OR pg_catalog.to_regclass('public.payment_refund_events') IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refunds / payment_refund_events 不存在 ⇒ 20260810140000 未 apply,停下';
  END IF;

  -- ② 🔴 **本片的 pre-image = 表的形狀**(§2a-X 第 1 條:指紋對象要換,不是抄 2a 的函式指紋)
  --    釘「欄名集合」而不是欄型別的完整快照:本片只加欄,若有人在我取樣之後也加了欄,
  --    我要停下來看一眼(可能是併行的片),而不是安靜地疊上去。
  -- 🔴 `COALESCE(..., '(空)')`:`string_agg` 對空集合回 **NULL**,而 `NULL <> c_cols` 求值為 NULL
  --    ⇒ IF 不發火 ⇒ 「整張表的欄都不見了」這種極端情形會**靜靜通過**(對抗審查 R1,同一個三值邏輯族)。
  SELECT COALESCE(pg_catalog.string_agg(a.attname, ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refunds'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM c_cols THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refunds 的欄集合與 pre-image 不符。實際=[%] 期望=[%]。'
                    '⇒ 有別的片動過這張表,停下人工對齊(本片是純加法,疊上去會蓋掉那個變動的脈絡)', v_cols, c_cols;
  END IF;

  -- ③ 既有 CHECK 名稱集合也釘住:本片新增三條,**不得順手改動或取代既有任何一條**
  SELECT COALESCE(pg_catalog.string_agg(c.conname, ',' ORDER BY c.conname), '(空)') INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refunds'::regclass AND c.contype = 'c';
  IF v_cons IS DISTINCT FROM c_cons THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refunds 的 CHECK 名稱集合與 pre-image 不符。實際=[%] 期望=[%]', v_cons, c_cons;
  END IF;

  -- ③b 🔴 **只釘名字不夠**(對抗審查 R1,成立):同名之下把 `amount` 改型別、把 `strong_key` 的
  --    NOT NULL 撤掉、或把某條既有 CHECK 的定義換成 `CHECK (true)`,上面兩道**一條都不會紅**。
  --    ⇒ 連 **型別 + notnull + 約束定義本身** 一起釘。用 `pg_get_constraintdef` 的字面。
  -- 🔴 **我原本寫「比較兩端都在同一台伺服器上 ⇒ 跨版本格式風險不成立」,那句是錯的**
  --    (對抗審查 R2,成立):左端是伺服器重組的字串沒錯,但**右端是寫死在本檔裡的常數** ——
  --    它是我在本機 17.10 量出來的,正式庫是 17.6。兩端根本不在同一台。
  --    ⇒ 正確的說法是:**風險存在,但方向是安全的** —— 若 17.6 的重組格式不同,這道閘會
  --      **擋下 apply**(fail-closed),不會放行。擋下時的處置是人去看一眼是格式差異還是真漂移,
  --      **不是**把常數改成現況(那等於把偵測器關掉)。
  SELECT COALESCE(pg_catalog.string_agg(
           a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull::text,
           ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refunds'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'amount:integer:true,attempt_id:uuid:true,created_at:timestamp with time zone:true,'
     || 'currency:text:true,id:uuid:true,idempotency_key:text:true,lease_token:integer:true,'
     || 'strong_key:text:true,supersedes_refund_id:uuid:false' THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refunds 的**欄型別/NOT NULL** 與 pre-image 不符。實際=[%]', v_cols;
  END IF;

  SELECT COALESCE(pg_catalog.string_agg(
           c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '(空)')
    INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refunds'::regclass AND c.contype = 'c';
  -- 🔴🔴 **原本這裡是 `strpos(v_cons, 'CHECK (true)')`,那是個只擋一種寫法的守門**
  --    (對抗審查 R2 抓到,我自己複讀時也獨立命中;**已在 17.10 實測**):
  --      `CHECK (1=1)`            → `pg_get_constraintdef` 回 `CHECK ((1 = 1))`
  --      `CHECK (true IS NOT FALSE)` → 回 `CHECK ((true IS NOT FALSE))`
  --    兩者都**不含**子字串 `CHECK (true)` ⇒ 把任一條既有守門換成這種等價恆真式,原本的閘全盲。
  --    ⇒ 修法不是再列舉幾種恆真寫法(**那是打地鼠,等價式寫得出無限多種**),
  --      是**改成正面表列**:把六條既有 CHECK 的定義**逐字釘死**,任何一條被改動都紅。
  --    下面這個常數是 2026-08-11 在本機 PG17.10 對 `20260810140000` 的基線**實查**得到的,
  --    不是照建表檔用眼睛抄的(`pg_get_constraintdef` 會重組:`IN (...)` 會變成 `= ANY (ARRAY[...])`)。
  IF v_cons IS DISTINCT FROM
     'pr_amount_positive_chk=CHECK ((amount > 0))'
     || ' | pr_currency_domain_chk=CHECK ((currency = ''TWD''::text))'
     || ' | pr_idem_key_shape_chk=CHECK ((idempotency_key ~ ''^[A-Za-z0-9_-]{1,20}$''::text))'
     || ' | pr_lease_token_nonneg_chk=CHECK ((lease_token >= 0))'
     || ' | pr_not_self_chk=CHECK ((supersedes_refund_id IS DISTINCT FROM id))'
     || ' | pr_strong_key_nonblank_chk=CHECK ((btrim(strong_key) <> ''''::text))' THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refunds 既有 CHECK 的**定義**與 pre-image 不符 '
                    '(名字對得上不代表守門還活著:恆真等價式、值域放寬都在這裡才看得到)。實際=[%]', v_cons;
  END IF;

  -- ③c 🔴 **子表的 pre-image 完全沒釘**(對抗審查 R1)——本片要往子表加一條 CHECK,
  --    而子表若已被別的片動過(加欄/改事件型別值域),我應該停下來看,不是安靜地疊上去。
  -- 🔴 **R1 我只釘了子表的「名字」,而 R2 指出那正是我在 ③b 才剛承認不夠的那件事**
  --    —— 同一個病在同一支 migration 裡修了父表、漏了子表。
  --    子表這裡漏掉還多一層後果(R2 的具體構造,**已在 17.10 實測**):
  --      `event_type` 若被撤掉 NOT NULL,插入 `event_type=NULL, record_snapshot=NULL` 時
  --      舊的 `pre_event_type_chk`(`= ANY (ARRAY[...])`)求值 **NULL**、
  --      本片新加的那條也求值 **NULL** ⇒ **兩條一起放行**(CHECK 只擋 FALSE)。
  --    ⇒ 子表要釘的不只是 CHECK 定義,**還有欄的 NOT NULL** —— 它是那兩條 CHECK 有效力的前提。
  SELECT COALESCE(pg_catalog.string_agg(
           c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '(空)')
    INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.contype = 'c';
  IF v_cons IS DISTINCT FROM
     'pre_event_type_chk=CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
     || ' ''result_failed''::text, ''result_unknown''::text, ''reconcile''::text, ''manual''::text])))'
     || ' | pre_lease_token_nonneg_chk=CHECK ((lease_token >= 0))'
     || ' | pre_seq_positive_chk=CHECK ((seq > 0))' THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refund_events 既有 CHECK 的**定義**與 pre-image 不符。實際=[%]', v_cons;
  END IF;

  SELECT COALESCE(pg_catalog.string_agg(
           a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull::text,
           ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refund_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'created_at:timestamp with time zone:true,event_type:text:true,id:uuid:true,'
     || 'lease_token:integer:true,record_snapshot:jsonb:false,refund_id:uuid:true,seq:integer:true' THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:payment_refund_events 的**欄型別/NOT NULL** 與 pre-image 不符 '
                    '(特別是 event_type 的 NOT NULL —— 它一旦沒了,本片新加的 CHECK 與既有的 '
                    'pre_event_type_chk 會在 event_type IS NULL 時**一起求值成 NULL 而放行**)。實際=[%]', v_cols;
  END IF;

  -- ④ 🔴 列數(§2a-X 第 2 條在本片的變體):`ADD CONSTRAINT … CHECK` 會**掃描既有列**。
  --    表若已有資料,新 CHECK 可能當場失敗(那是正確的 fail-closed),但要先知道規模與風險。
  --    這裡**不擋非空**(非空不等於有問題),只把數字印出來,讓 apply 當下的人看得到。
  SELECT count(*) INTO v_rows FROM public.payment_refunds;
  RAISE NOTICE 'L5b-2-2c 前置:payment_refunds 現有 % 列(新 CHECK 會逐列驗證;失敗=既有資料不符新值域,停下人工判斷)', v_rows;
  SELECT count(*) INTO v_rows FROM public.payment_refund_events;
  RAISE NOTICE 'L5b-2-2c 前置:payment_refund_events 現有 % 列', v_rows;

  -- ⑤ 🔴 零直權表的可達面必須維持(§2a-X 第 3 條在本片的變體)
  --    本表刻意零 GRANT ⇒ **應用角色**(anon/authenticated/service_role/authenticator/payment_confirmer)
--    進不去,寫入一律走 SECDEF RPC。
--    ⚠️ **不要寫成「只有 owner 進得去」**(對抗審查 R1 nit,成立):`pg_read_all_data` /
--    `pg_write_all_data` 以及 Supabase 的平台角色仍有有效存取。本片保證的是**零直接 GRANT**,
--    不是「除了 owner 沒有任何人讀得到」。
  --    `ADD COLUMN` 不會改表級 ACL,但**欄級 ACL 是另一本帳**(memory
  --    `reference_pg-table-acl-flatten-blind-to-column-grants`:relacl 看不到 attacl)⇒ 兩本都查。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:退款帳本兩表出現**表級**非 owner grantee ⇒ 零直權前提已被打破,停下';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND att.attnum > 0 AND NOT att.attisdropped
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c 前置閘:退款帳本兩表出現**欄級** GRANT ⇒ 表級 ACL 攤平看不到它,停下人工判斷';
  END IF;
END
$l5b2_2c_preflight$;


-- ── 1. §2f-1:`rec_trade_id`(純加法;nullable + 形狀)──────────────────────
-- 🔴 **先加 nullable、不加 NOT NULL**:表現在是空的,加 NOT NULL 技術上可行 ——
--   但那會把「舊列回填」這個選項**永久關掉**,而本欄的值來源(attempt 的 rec)在極少數
--   弱識別情境**可能不存在**(plan §核心點 2 條件 9)。
--   ⇒ NOT NULL 由 **2g 的 writer RPC 保證**(必填),schema 這層留 nullable + 形狀 CHECK。
-- 形制照 A7c 的先例(`20260801120000:190-191` 給 order_refunds 加的那支),語意同 `:193-194` 逐字:
--   「INSERT 當下綁定…之後不可變…是**快照**不是外鍵」。
ALTER TABLE public.payment_refunds
  ADD COLUMN rec_trade_id text;

COMMENT ON COLUMN public.payment_refunds.rec_trade_id IS
  'L5b-2 片2c:INSERT 當下綁定的 TapPay rec_trade_id **快照**(不是外鍵、之後不可變)。'
  '用途有兩個,不要只記得一個:①跨線共同否決條件的 join 鍵(plan §3a-5)②OP6 對帳的 join 鍵。'
  '🔴 schema 這層刻意 nullable —— NOT NULL 由 2g 的 writer RPC 保證;'
  '在此加 NOT NULL 會永久關掉「舊列回填」的選項,而弱識別情境下這個值可能不存在(plan §核心點 2 條件 9)。';

-- 🔴 **`btrim()` 只去空白,不去 tab / 換行**(對抗審查 R1,正式 17.6 已確認:
--   `btrim(E'\t') <> ''` 為 **true** ⇒ 一個 tab 字元原封放行)。那不是可用的 TapPay rec 形狀,
--   而它會**污染 OP6 的 join**(join 得到空結果卻看不出原因)。⇒ 改成明確禁空白與控制字元。
-- ⚠️ **`[:space:]` / `[:cntrl:]` 的射程是「ASCII 空白與控制字元」,不是「所有看起來像空白的字元」**
--   (對抗審查 R2;**已在本機 17.10 實測**,該叢集 `datctype=C`):
--     `'rec:A' || chr(160) || 'B'`(U+00A0 不斷行空格)⇒ **通過**;ASCII 空格與 tab ⇒ 正確擋下。
--   字元分類本來就跟 `LC_CTYPE` / collation 走(PG17 官方 9.7.3 明載非 ASCII 分類跨 locale 會變)。
--   ⇒ 本條保證的是「**沒有 ASCII 空白與控制字元**」,**不是**「沒有任何 Unicode 空白」。
--   刻意**不**去逐個補 U+00A0 / U+200B 這類字元:那是打地鼠(補不完),而唯一能由構造保證的寫法是
--   改成 ASCII 正面表列(例如 `[!-~]`),那會比 adapter 收得更緊 ⇒ 回到本片一開始就拒絕的那個錯誤
--   (誤擋一筆合法退款比多收一點雜訊貴)。**這是知情接受的邊界,不是漏掉的守門。**
--
-- ── 🔴 C1(對抗審查 R3 的 consider,主視窗裁「由 P 判」)——**我判維持不放寬,與建議方向相反** ──
-- R3 的顧慮:2c 禁內部空白、而寫 rec 進 attempts 的 DB 層 RPC 閘不禁 ⇒ 壞值 charge 照收、
--   退款記帳才 23514 = 守門畫錯面,且會逼 2g 寫 `trim()` 繞路(trim 後的值 ≠ attempts 的值 ⇒ OP6 join 靜默落空)。
-- 前半我實查後**確認成立**:`payment_charge_attempts.rec_trade_id`(`20260612150000:93`)是裸 text,
--   RPC 閘(`:256`/`:369`)只擋 `btrim(...)=''` 與 `length>64` ⇒ **內部空白進得來**;
--   而扣款回應的解析(`TapPayChargeAdapter.ts:145-148`)**只檢查 rec 存不存在、不檢查形狀**。
-- 但結論反過來,因為還有一條 R3 與我先前都沒開的檔:
--   **退款送出前那道 adapter 閘會先擋** —— `TapPayChargeAdapter.ts:267` 對 `transactionId` 跑
--   `/^\S{1,20}$/`(`:66`),不合就丟 `TapPayRefundNotSentError`、**未送出**。
--   ⇒ 一顆帶空白的 rec **根本走不到「錢已經動了、卻寫不進帳本」那個狀態**:退款在送出前就失敗了。
--   ⇒ 2c 這條(`[^space/cntrl]{1,128}`)比那道 adapter 閘(`\S{1,20}`)**寬**,
--     擋不掉任何一筆我們自己送得出去的退款 ⇒ 「逼 2g 繞路」的前提在現行路徑上不成立。
-- ⚠️ **殘餘風險(具名,不是掃掉)**:TapPay Portal 人工退款是繞過我方 adapter 的 —— 那條路上錢真的動了,
--   若該單的 rec 恰好帶空白,2g 就會卡在本條 CHECK。發生機率極低(TapPay rec 實務上是英數),
--   而且卡住時「停下來看一眼」比「把髒值寫進對帳 join 鍵」好。**放寬會讓髒值直接進帳本,那是不可逆的。**
-- ⇒ 真正的缺口在**入站**不在本片:扣款路徑從頭到尾沒有人驗 rec 的形狀。那是金流路徑、2c 射程外
--   ⇒ **立 backlog(見 commit body;需主視窗配號)**,不在此片順手改。
-- 🔴🔴 **上界 128 是我自選的值,不是「對齊先例」**(對抗審查 R3=F1,唯一 must-fix,成立)。
--   我原本寫「對齊 `20260624120000:55` 給 attempts 的 `CHECK (length(rec_trade_id) BETWEEN 1 AND 128)`」——
--   **那個座標是假的**:`20260624120000:55` 是 `released_closed_at` 欄宣告,該檔 `BETWEEN 1 AND 128` 零命中;
--   而 `payment_charge_attempts.rec_trade_id`(真正宣告在 `20260612150000:93`)是**裸 text、根本沒有長度 CHECK**。
--   本 repo 對 rec 形狀其實有**三個互不相同**的界(全部實查):
--     · `20260613120000:55`/`:61` `payment_webhook_events` = `BETWEEN 1 AND 128`(全 repo 唯一的 128)
--     · DB 層 RPC 閘 `20260612150000:256`/`:369` 等 = `length > 64` 即拒
--     · `20260731120000:219` `order_refund_jobs` = `BETWEEN 1 AND 20`(退款線最近的先例)
--   ⇒ 沒有「那個先例」可對齊。128 = 我在三者中**挑最寬的那個**,理由是本片一貫的取捨:
--     這是金流路徑,**誤擋一筆合法退款比多收一點雜訊貴**;收緊要有真實例撐,現在沒有。
--   ⚠️ 這條寫錯的引文**撐過了 R1 與 R2 兩輪**。病根不是引錯檔,是
--     **帶著檔號行號的引文長得像已驗事實** —— 座標的精確外觀不是可信度,座標本身就是要開檔驗的字面。
--   ⚠️ 刻意**不**收到 TapPay 文件的 String(20):比 adapter 收得更緊 = 有可能誤擋一筆**合法退款**,
--   而在金流路徑上「誤擋」比「多收一點雜訊」貴。收緊要有真實例撐,現在沒有。
-- ⚠️ `rec_trade_id IS NULL` 放行是**刻意**的(弱識別情境本欄可能不存在,plan §核心點 2 條件 9);
--   它與上面 manual 那條的 NULL 洞**不同**:這裡 NULL 是合法值域的一部分,不是求值意外。
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT pr_rec_trade_id_shape_chk
  CHECK (rec_trade_id IS NULL OR rec_trade_id ~ '^[^[:space:][:cntrl:]]{1,128}$');


-- ── 2. §2f-2:`strong_key` 值域(前綴強制)──────────────────────────────────
-- 現況只有 `pr_strong_key_nonblank_chk`(非空白,`20260810140000:109`),**值域從未被定義**。
-- 🔴 直接後果不是「文件缺口」,是**兩條准退條件可能塌成同一條**(plan 核心點 2 的關卡1 R1 `:114`):
--   條件 4「rec 等於目標」與條件 9「強識別可得」若指同一件事,一發突變證不了兩個守門。
-- **定案**:`strong_key` = `'rec:' || rec_trade_id` 或 `'bank:' || bank_transaction_id` 二選一,
--   前綴強制,與母 plan §5-5「強識別 = rec 或 bank_txn 其中之一」逐字對齊。
-- 🔴 值域定了之後,plan §核心點 2 的**蘊含檢查已重跑**(那是 §2f-2 明列的義務,不是可選):
--   走 `rec:` 時條件 4 **確實**蘊含條件 9 ⇒ 兩條的分工改述為:
--     · 條件 9 驗「**強識別存在且形狀合法**」——負測 = 弱識別(rec 與 bank_txn 皆無);
--     · 條件 4 驗「**它指到的 rec 等於目標**」——負測 = 強識別存在但指錯單。
--   這兩個負測**互不蘊含** ⇒ 判別力成立,兩條不是同一條。(此段結論同批寫回 plan §2f-2。)
-- ⚠️ 上限 128:`strong_key` 不是 TapPay 欄位、無官方長度規範。128 **是我自選的**
--   (取自 `20260613120000:55`/`:61` `payment_webhook_events` —— 本 repo 三個界裡最寬的那個,
--   詳上方 §2f-1 那段;**不是**「對齊先例」,repo 裡沒有單一先例可對齊)。日後遇到更長的識別碼要放寬這裡。
--   🔴 這兩行原本寫的是「上限 64」—— 那是**被我自己下面那段撤掉的第一版**留下的殘句,
--   與同段 DDL 的 `{1,128}` 直接打架。它撐過了 R1,是我 R2 前重讀時自己抓到的。
--   (同族教訓:memory `feedback_line-numbers-go-stale-from-your-own-later-edits` 的變形 ——
--    **撤回了實作卻沒改宣稱它的註解**,而註解看起來完全正常。)
-- 🔴 **值域改過**(對抗審查 R1,成立):我第一版寫 `[A-Za-z0-9_-]{1,64}`,兩頭都比現實緊 ——
--   ① 字元類:本 repo 既有 CHECK 對 rec/bank 兩欄**不限字元類**(`20260613120000:55`/`:61`
--      逐字 `length(...) BETWEEN 1 AND 128`,無字元類限制);
--      而 **退款送出**那道 adapter 閘 `TapPayChargeAdapter.ts:66` `/^\S{1,20}$/`(用在 `:267`)
--      收的是「20 字內、非空、無空白」——**含標點**。我那個 `[A-Za-z0-9_-]` 會擋掉它收得下的值
--      ⇒ 我那個字元類會**擋掉 adapter 收得下的合法值** = 誤擋一筆真退款。
--   ② 長度:64 是我自己挑的數字(當時已誠實標註),先例是 128。
--   ⇒ 改成「前綴強制 + 後綴 1..128 非空白非控制字元」:**前綴是本條真正的目的**(分辨 rec / bank),
--     字元與長度一律跟既有先例走,只多禁空白與控制字元(那一種是雜訊不是識別碼)。
-- ⚠️ PG 的 `$` **不吃尾端換行**(實測:`E'rec:ABC\n' ~ '…$'` 為 false)⇒ 無錨點洞。
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT pr_strong_key_domain_chk
  CHECK (strong_key ~ '^(rec|bank):[^[:space:][:cntrl:]]{1,128}$');


-- ── 3. §2f-3:`manual` 事件必須可判讀 ──────────────────────────────────────
-- `manual` 是**人寫的終局**,但它對「已退金額 R」的貢獻從未定義 ⇒ plan §3b 的表只能寫「不得自行解讀」。
-- 🔴 一個沒有語意的終局比沒有終局更糟:它會讓對帳程式面對「有人處理過了,但不知道錢有沒有出去」。
-- **定案**:`manual` 必須帶 `record_snapshot`,且其中要能讀出「人當時判定錢**有沒有**退出去」。
--   ⇒ 之後 plan §3b 可以把 manual 寫成:`refunded=true` 計入 R、`false` 貢獻 0,不再是「不得解讀」。
-- ⚠️ 本條**只保證可判讀,不保證判得對** —— 人填錯 `refunded` 這件事 schema 擋不住。
-- 🔴 **而且「填錯就補一筆沖銷事件」目前是一句沒有東西保證的話**(對抗審查 R1,成立,已撤回):
--   ①`20260810140000:137` 的**單一 terminal 唯一索引**會擋掉第二筆 manual ⇒ 補不進去;
--   ②就算補得進去,**「沖銷事件」的計算語意目前不存在** —— 沒有任何地方定義它如何抵銷前一筆。
--   ⇒ 現況的真話是:**manual 填錯目前沒有修正路徑**,要靠 owner 直接改資料(那繞過 append-only)。
--   這是本片**知情接受的缺口**,不是已解決的問題;修法屬 2k(對帳 RPC)或另開片,不在本片射程。
-- 🔴🔴 **這條 CHECK 被打穿兩次,兩次都是同一個病:PG 的 CHECK 只擋 FALSE、NULL 一律放行。**
--   ① plan §2f-3 給的原版 `record_snapshot ? 'refunded' AND …`:snapshot 為 SQL NULL 時
--      `NULL ? 'refunded'` 回 **NULL** ⇒ 整條 NULL ⇒ 放行。(我照抄,被自己的行為格抓到。)
--   ② 我補了 `record_snapshot IS NOT NULL AND …` 之後**仍被打穿**(對抗審查 R1,正式 PG 17.6 已重現):
--      `record_snapshot = '["refunded"]'`(**JSON 陣列**,不是物件)⇒ `?` 對陣列是「元素存在嗎」= **true**,
--      而 `-> 'refunded'` 對陣列回 **SQL NULL** ⇒ `jsonb_typeof(NULL)` = NULL ⇒ 整條又是 NULL ⇒ 放行。
--   ⇒ **修法不是再列一個 NULL 來源**(那是打地鼠,第三個來源還會有)。
--     改成**由構造保證非 NULL**:整條包 `COALESCE(…, false)` —— 任何求值成 NULL 的路徑一律落成 false=擋。
--     這樣同時涵蓋:snapshot 為 NULL / 為陣列 / 為純量 / 缺鍵 / 鍵值非 boolean,**五種一起**。
--   ⚠️ `?` 與 `IS NOT NULL` 因此都不需要了 —— 留著只會讓下一個人以為那兩項是承重的。
--   🔴 **第三次同族**(對抗審查 R2):左半的 `event_type <> 'manual'` **自己也會傳染 NULL**。
--     `event_type` 現在是 NOT NULL,所以「現在」構造不出來 —— 但那是**別人維持的前提**,
--     不是本條的構造保證。撤掉那個 NOT NULL,本條與既有 `pre_event_type_chk` 會**一起**變 NULL 而放行
--     (已在 17.10 實測兩條同時放行)。前置閘已把子表的 NOT NULL 釘住(apply 當下),
--     但 apply 之後沒有人再守 ⇒ **兩半都包 COALESCE,由構造保證**,不依賴任何欄的 NOT NULL 還在。
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_manual_needs_verdict_chk
  CHECK (COALESCE(event_type <> 'manual', false)
         OR COALESCE(pg_catalog.jsonb_typeof(record_snapshot -> 'refunded') = 'boolean', false));


-- ── 4. 斷言(post-image;每一道都對應一個可構造的失效)──────────────────────
DO $l5b2_2c_asserts$
DECLARE
  v_n integer;
BEGIN
  -- ① 欄在、型別對、**且 nullable**(加成 NOT NULL 會永久關掉回填,必須紅)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.payment_refunds'::regclass
       AND a.attname = 'rec_trade_id' AND NOT a.attisdropped
       AND a.atttypid = 'text'::regtype
       AND a.attnotnull = false
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c assert:rec_trade_id 不存在、型別不是 text、或被加成 NOT NULL(後者會永久關掉舊列回填)';
  END IF;

  -- ② 三條新 CHECK 都在,**而且是 validated 的**
  -- 🔴 `convalidated` 這一半不可省:`ADD CONSTRAINT … NOT VALID` 之下約束照樣存在、名字照樣查得到,
  --    但**既有列不受約束** ⇒ 只查存在性的斷言對「加了但沒生效」全盲
  --    (memory `feedback_guard-checks-existence-not-effect`)。
  -- 🔴 **必須鎖 `conrelid`**(對抗審查 R1):約束名在 PG 只對「同一張表」唯一,
  --    全庫計數時別的表用同名約束就會讓這道斷言誤紅(或在別處誤綠)。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
   WHERE c.contype = 'c' AND c.convalidated
     AND ( (c.conrelid = 'public.payment_refunds'::regclass
            AND c.conname IN ('pr_rec_trade_id_shape_chk', 'pr_strong_key_domain_chk'))
        OR (c.conrelid = 'public.payment_refund_events'::regclass
            AND c.conname = 'pre_manual_needs_verdict_chk') );
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'L5b-2-2c assert:三條新 CHECK 中只有 % 條存在且 validated(期望 3)', v_n;
  END IF;

  -- ③ 🔴 既有約束一條都不能少(本片是純加法;「順手取代掉一條舊的」是最容易發生的偏離)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refunds'::regclass AND c.contype = 'c';
  IF v_n <> 8 THEN   -- 6 條既有 + 2 條本片新增(第三條在子表)
    RAISE EXCEPTION 'L5b-2-2c assert:payment_refunds 的 CHECK 共 % 條(期望 8 = 既有 6 + 本片 2)⇒ 有既有約束被動到', v_n;
  END IF;

  -- ④ 零直權面未變(前置閘查過一次;這裡是 post-image,防本片自己弄髒)
  -- 🔴 **表級與欄級兩本帳都要查**(對抗審查 R1:我前置閘查了兩本、post-image 只查了表級)。
  --    `GRANT SELECT(amount) TO authenticated` 只進 `attacl`,`relacl` 可以維持空的
  --    ⇒ 只查表級的斷言會宣告「零權限」而事實上有一個欄級後門
  --    (memory `reference_pg-table-acl-flatten-blind-to-column-grants`)。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c assert:退款帳本兩表出現**表級**非 owner grantee ⇒ 本片弄髒了零直權面';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND att.attnum > 0 AND NOT att.attisdropped
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c assert:退款帳本兩表出現**欄級** GRANT ⇒ 表級 ACL 攤平看不到它';
  END IF;

  -- ⑤ COMMENT 在(ACL 四件裡最容易漏的那一件在 2a 被抓過;這裡是同族的欄註解)
  IF pg_catalog.col_description('public.payment_refunds'::regclass,
       (SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.payment_refunds'::regclass AND a.attname = 'rec_trade_id')) IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2c assert:rec_trade_id 的欄註解不見了(它記著「快照不是外鍵」與「為何刻意 nullable」)';
  END IF;
END
$l5b2_2c_asserts$;

COMMIT;


-- ============================================================
-- Rollback → `scripts/l5b2-2c-rollback.sql`(獨立、單一交易、可直接執行)
--
-- 🔴 為什麼同樣做成獨立檔(2a 的教訓,不重蹈):
--   2a 第一版把 rollback 寫成檔尾註解裡的座標 + 省略號,宣稱「可執行」而實際照著跑會死在中途。
--   本片雖然只是 DROP 三條 CHECK + DROP 一欄(比 2a 單純很多),仍照同一形制 ——
--   **理由不是複雜度,是「宣稱可執行的東西必須真的可執行」**。
--
-- ⚠️ 回退的**不可逆邊界**:`DROP COLUMN rec_trade_id` 會**永久刪掉該欄已寫入的資料**。
--   一旦 2g 開始寫入,回退就不再是無損操作 ⇒ 回退腳本自己有列數閘,非空時要人明示。
-- 🔴 原本這裡寫「本片 apply 當下表是空的」—— **那句沒有任何機械保證**(對抗審查 R2,成立):
--   前置閘④ 只 `RAISE NOTICE` 印列數,**不擋**。正確的說法是:
--   · 表若已有列,`ADD CONSTRAINT … CHECK` 會**逐列驗證**;有列不符新值域(例如既有
--     `strong_key='foo'` 沒有 `rec:`/`bank:` 前綴)⇒ **整支 migration 當場失敗並回滾**。
--   · 那個方向是安全的(不會靜默收進壞資料),但**部署會中止** ——
--     所以 apply 的人要先看前置閘印的那兩個列數,不是 apply 完才發現。
-- ============================================================
