-- ============================================================
-- M-4b · L5b-2 片 2d:`result_confirmed` 事件 —— 把「已受理」與「已確認」拆成兩個終局
-- ============================================================
-- 依據:docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md §2 片表 2d、§4b(甲案)
-- 前綴號:主視窗集中發號(P-372-A);下一號 120000。
-- 鐵則 12③:動**已上正式庫**的 CHECK 與唯一索引(`20260810140000` 帳本 + `20260811080000` 片 2c)。
--
-- 三件:
--   ① `pre_event_type_chk` 的值域**新增** `result_confirmed`
--   ② `pre_one_terminal_uniq` 的部分索引述詞:terminal 集合改成
--      `result_confirmed / result_failed / manual`(**`result_success` 退出 terminal**)
--   ③ 🔴 **新增** `pre_one_success_uniq`(每顆 refund 至多一筆 `result_success`)
--
-- ── 🔴🔴 ③ 為什麼在這片(超出母 plan §4b 甲案的兩件字面,apply 停點要看見)────────
-- ②把 `result_success` 移出 terminal 集合的**副作用**是:舊索引順帶提供的「每顆 refund 至多一筆
-- `result_success`」保證**一併消失**,而沒有東西接手 —— 子表另外兩個唯一索引是 `id` 主鍵與
-- `pre_refund_seq_uniq(refund_id, seq)`(`20260810140000` 建表段)⇒ 同一顆 refund 換個 `seq`
-- 就能落**兩筆已受理**。失敗情境:2g writer 落 `result_success` 後 crash、重試用新 seq 再落一筆
-- ⇒ 錢的帳本上兩筆互異的「已受理」證據並存,全鏈零紅。
-- 一顆 refund = 一把 TapPay 冪等鍵 = **至多一次受理** ⇒ 這個唯一性語意上仍然成立,只是原本靠②在守。
-- ⇒ ③ **不是新增保證,是接住本片會弄丟的既有保證**(R3-Fable F2;主視窗 P-507-A 裁 A、
--    配套=apply 檢查表明列本索引與「超出甲案字面」的說明,Sean 在 apply 停點親自拍板)。
--
-- ── 🔴 為什麼要拆(§4b,關卡1 R2 `:283`/`:328`/`:430` 逼出來的)────────────
-- `20260810140000:137-138` 把 `result_success` 當 terminal ⇒ **「已受理但尚未確認完成」這個狀態
-- 在現行 schema 裡沒有位置可以表達**。而 TapPay 退款「隔日生效」,受理成功 ≠ 錢真的退了。
-- 連鎖後果(母 plan 列三條,都成立):2e 的排除條件一見 `result_success` 就把 attempt 移出人工佇列
-- ⇒ 隔日真的沒退成時**訊號已經提前消失**;rollback 的人工佇列只涵蓋「未結案」⇒ 已受理未確認那族漏出。
--
-- ⚠️ 本片**只動 schema 的表達能力**,不含判定邏輯。母 plan §4b 定死的三個數字/述詞
-- (N=3 日曆日、確認述詞=Record `refunded_amount` 較 `sent` 前 baseline 增加 ≥ 本 refund 的 `amount`、
--  逾 N 日未確認落 `manual` 且不自動重試)**屬 2e/2f/2g 的實作**,不在本片射程。
--
-- ── 🔴🔴 回退順序依賴(本片最重要的一段,災難當天會用到)──────────────────
-- 正確順序是 **先退 2d、再退 2c**(`scripts/l5b2-2d-rollback.sql` → `scripts/l5b2-2c-rollback.sql`)。
--
-- 🔴 **v1 的這段寫錯過,而且錯法值得留著**:原字面說「2c 的**回退自驗**把子表 CHECK 定義逐字釘死,
--    2d 還在時直接跑 2c 回退會當場 abort」。實跑(2026-08-11 PG17.10 拋棄式叢集)三步全推翻:
--      E1 `psql -f scripts/l5b2-2c-rollback.sql` 在 2d 還在時 → **rc=0、完成**,沒有 abort;
--      E3 接著跑 2d 回退 → 紅在自驗(`l5b2-2d-rollback.sql` ④「回退後自驗」那段的 CHECK 集合比對,它釘的 pre-image 含 2c 那條 CHECK);
--      E4 想把 2c 補回去 → 紅在 **2c migration 的前置閘**(`20260811080000:167-178` 釘死子表六值 pre-image 那段)。⇒ 退進死角。
--    那句 abort 訊息**真的存在**,但它的執行者是 **2c migration 的前置閘**(擋 re-apply),
--    不是 2c 的回退自驗 —— **訊息字面抄對了、主詞認錯了**。
--    `l5b2-2c-rollback.sql` 逐字釘死 CHECK 集合的那段(`:155-159`)`WHERE conrelid = 'payment_refunds'`,
--    是**父表**;子表在那支檔裡只被檢查「`pre_manual_needs_verdict_chk` 在不在」與欄型別。
--
-- ⇒ **順序依賴的真實機制**:`l5b2-2d-rollback.sql` 的回退自驗釘死子表 CHECK 集合,
--    而那份 pre-image **含 2c 的 `pre_manual_needs_verdict_chk`** ⇒ 2c 先退掉,2d 就退不掉。
-- ⇒ **保護在哪**:2026-08-11 主視窗裁定 A 之後,`scripts/l5b2-2c-rollback.sql` 的前置閘加了一道
--    「子表還帶 `result_confirmed` ⇒ 拒退並指路先跑 2d 回退」。**在那道閘之前,錯序不會被擋** ——
--    這一段的歷史留著,是因為「檔頭有寫」被實測證明擋不住任何東西。
-- ⚠️ 因此本片的前置閘**必須**把 2c 加的 `pre_manual_needs_verdict_chk` 算進 pre-image ——
--    漏掉它,本片在已 apply 2c 的庫上會誤紅。
--
-- ── apply 當下的鎖 ────────────────────────────────────────────────────
-- `DROP CONSTRAINT` + `ADD CONSTRAINT … CHECK` 取 ACCESS EXCLUSIVE;新值域是**嚴格放寬**
-- (只加一個允許值)⇒ 對既有列的驗證**不可能失敗**。
-- `DROP INDEX` + `CREATE UNIQUE INDEX`(非 CONCURRENTLY)同樣取 ACCESS EXCLUSIVE。
-- 🔴 新索引述詞**不是**舊述詞的超集(`result_success` 被移出)⇒ 對既有列**可能**失敗:
--    若某顆 refund 已同時有 `result_confirmed`/`result_failed`/`manual` 其中兩筆,建索引會撞唯一性。
--    那是 fail-closed、方向安全(整片回滾),但 apply 的人要先看前置閘印的列數。
-- ============================================================


BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── 0. 前置閘(fail-closed)────────────────────────────────────────────────
DO $l5b2_2d_preflight$
DECLARE
  v_cons text;
  v_cols text;
  v_pred text;
  v_rows bigint;
  v_dup  bigint;
  v_dup_ok bigint;
BEGIN
  -- ① 表要在
  IF pg_catalog.to_regclass('public.payment_refund_events') IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:payment_refund_events 不存在 ⇒ 20260810140000 未 apply,停下';
  END IF;

  -- ② pre-image:子表四條 CHECK 的**定義**逐字釘死
  -- 🔴 **含 2c 的 `pre_manual_needs_verdict_chk`**:本片跑在已 apply 2c 的庫上,
  --    漏掉它 = 前置閘在正確的庫上誤紅(見檔頭「回退順序依賴」那段)。
  -- 🔴 釘定義不是釘名字:同名之下把值域改寬/改成恆真,只比名字一條都不會紅
  --    (片 2c 的 R2 實測:`CHECK (1=1)` 的 `pg_get_constraintdef` 是 `CHECK ((1 = 1))`,
  --     用子字串比對 `CHECK (true)` 完全抓不到)。
  SELECT COALESCE(pg_catalog.string_agg(
           c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '(空)')
    INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.contype = 'c';
  IF v_cons IS DISTINCT FROM
     'pre_event_type_chk=CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
     || ' ''result_failed''::text, ''result_unknown''::text, ''reconcile''::text, ''manual''::text])))'
     || ' | pre_lease_token_nonneg_chk=CHECK ((lease_token >= 0))'
     || ' | pre_manual_needs_verdict_chk=CHECK ((COALESCE((event_type <> ''manual''::text), false)'
     || ' OR COALESCE((jsonb_typeof((record_snapshot -> ''refunded''::text)) = ''boolean''::text), false)))'
     || ' | pre_seq_positive_chk=CHECK ((seq > 0))' THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:payment_refund_events 的 CHECK **定義**與 pre-image 不符。實際=[%]。'
                    '⇒ 三種可能,先分辨是哪一種:①**本片已經 apply 過**(值域裡看得到 result_confirmed;'
                    '本片不支援冪等重跑,要重來請先跑 scripts/l5b2-2d-rollback.sql)'
                    '②有別的片動過這張表 ③2c 未 apply 或已被回退。停下人工對齊', v_cons;
  END IF;

  -- ③ 欄型別/NOT NULL 也釘:`event_type` 的 NOT NULL 是本片兩個守門有效力的前提
  --    (2c 的 R2 實測:撤掉它,`pre_event_type_chk` 與 2c 那條會**一起**求值 NULL 而放行)。
  SELECT COALESCE(pg_catalog.string_agg(
           a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull::text,
           ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refund_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'created_at:timestamp with time zone:true,event_type:text:true,id:uuid:true,'
     || 'lease_token:integer:true,record_snapshot:jsonb:false,refund_id:uuid:true,seq:integer:true' THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:payment_refund_events 的欄型別/NOT NULL 與 pre-image 不符。實際=[%]', v_cols;
  END IF;

  -- ④ 舊索引的**述詞**釘死(只釘名字的話,別人先改過述詞我會安靜疊上去)
  -- 🔴 `to_regclass` 不用 `::regclass`(對抗審查 R1 nit,成立):索引缺席時 `::regclass` 直接丟 42P01,
  --    下面那句「索引不存在」的人話**永遠印不出來** —— 災難當天拿到的會是一句 catalog 錯誤。
  SELECT COALESCE(pg_catalog.pg_get_indexdef(i.indexrelid), '(空)') INTO v_pred
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq');
  IF v_pred IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:pre_one_terminal_uniq 不存在 ⇒ 舊 terminal 唯一性此刻沒有任何東西在守,'
                    '本片不該在這種狀態下疊上去。停下人工判斷';
  END IF;
  -- 🔴 **invalid 索引要留痕**(對抗審查 R1 nit,成立):`pg_get_indexdef` 對 invalid 索引印**一樣的字面**
  --    ⇒ 上面的逐字比對看不出來。而 invalid = 那段期間唯一性**根本沒被執行**。
  --    這裡刻意**不擋**(擋了就換⑤ 抓不到重複資料、也擋掉合法的修復流程),但一定要印出來,
  --    否則本片會安靜地 DROP 掉一顆沒在守的索引、建一顆 valid 的,沒人知道中間破過洞。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                  WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq') AND i.indisvalid) THEN
    RAISE NOTICE 'L5b-2-2d 前置:🔴 pre_one_terminal_uniq 目前 **invalid** ⇒ 舊 terminal 唯一性在這段期間沒有被執行,'
                 '既有資料可能已有重複終局事件。下面第⑤ 條會用**新**集合實際去算';
  END IF;
  IF v_pred IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ANY (ARRAY[''result_success''::text, ''result_failed''::text, ''manual''::text]))' THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:pre_one_terminal_uniq 的定義與 pre-image 不符。實際=[%]', v_pred;
  END IF;

  -- ⑤ 🔴 新述詞對既有列可能失敗(不是超集)⇒ 先算出來,別讓它在 CREATE INDEX 才炸
  SELECT count(*) INTO v_rows FROM public.payment_refund_events;
  SELECT COALESCE(count(*), 0) INTO v_dup FROM (
    SELECT refund_id FROM public.payment_refund_events
     WHERE event_type IN ('result_confirmed','result_failed','manual')
     GROUP BY refund_id HAVING count(*) > 1
  ) d;
  -- ⑤-b 🔴 ③ 的新索引同樣可能對既有列失敗:每顆 refund 至多一筆 result_success。
  --    ⚠️ 誠實邊界:在④ 通過(舊索引述詞含 result_success 且 **valid**)的前提下,這個數**恆為 0**
  --    —— 舊索引本來就在守它。它抓得到的只有「舊索引曾經 invalid、期間漏進重複列」那一族,
  --    與⑤ 同一條逃逸路徑。留著是因為那一族真的存在,而且**建索引時才炸的錯誤訊息看不出是哪一族**。
  SELECT COALESCE(count(*), 0) INTO v_dup_ok FROM (
    SELECT refund_id FROM public.payment_refund_events
     WHERE event_type = 'result_success'
     GROUP BY refund_id HAVING count(*) > 1
  ) d2;
  RAISE NOTICE 'L5b-2-2d 前置:payment_refund_events 現有 % 列;以**新** terminal 集合計有 % 顆會撞唯一性;'
               '有 % 顆 refund 已存在重複 result_success',
               v_rows, v_dup, v_dup_ok;
  IF v_dup_ok > 0 THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:有 % 顆 refund 已經有多筆 result_success ⇒ pre_one_success_uniq 建不起來。'
                    '這代表帳本上同一把冪等鍵被記了兩次「已受理」,**要人看過再決定留哪一筆**,'
                    '不是本 migration 能自動處理的', v_dup_ok;
  END IF;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'L5b-2-2d 前置閘:有 % 顆 refund 在新 terminal 集合下已有多筆終局事件 ⇒ '
                    '建唯一索引會失敗。這代表資料層面已有兩個終局並存,**要人看過再決定留哪一筆**,'
                    '不是本 migration 能自動處理的', v_dup;
  END IF;
END
$l5b2_2d_preflight$;


-- ── 1. §4b①:值域新增 `result_confirmed` ────────────────────────────────
-- 🔴 CHECK 不能 ALTER,只能 DROP+ADD。兩者在同一交易內 ⇒ 中間沒有「值域消失」的可見窗口。
-- 🔴 這是**嚴格放寬**(只加一個允許值)⇒ 既有列驗證不可能失敗。
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk;
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_confirmed','result_failed','result_unknown','reconcile','manual'));

COMMENT ON CONSTRAINT pre_event_type_chk ON public.payment_refund_events IS
  'L5b-2 片2d:值域加入 result_confirmed。**受理(result_success)與確認(result_confirmed)是兩件事** —— '
  'TapPay 退款隔日生效,受理成功不代表錢已經退出去。判定用的 N 與述詞見母 plan §4b,屬 2e/2f/2g 實作。';


-- ── 2. §4b②:terminal 集合換人(`result_success` 退出)──────────────────
-- 🔴 這是本片**唯一可能對既有資料失敗**的一步(新述詞不是舊述詞的超集)⇒ 前置閘⑤ 已先算過。
-- 🔴 語意:`result_success` 之後**不再是終局** ⇒ 一顆 refund 可以先有 `result_success`(已受理)、
--    再有 `result_confirmed`(隔日確認)。唯一性只約束後者那一族。
DROP INDEX public.pre_one_terminal_uniq;
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_confirmed','result_failed','manual');

COMMENT ON INDEX public.pre_one_terminal_uniq IS
  'L5b-2 片2d:terminal 集合 = result_confirmed / result_failed / manual。'
  'result_success 已退出 terminal(它只表示「TapPay 受理了」)。'
  '🔴 2e 的排除條件必須認 result_confirmed 而不是 result_success,否則訊號會提前消失(母 plan §4b)。';


-- ── 2b. 🔴 ③:把②弄丟的「每顆 refund 至多一筆 result_success」接住 ──────────
-- 🔴 純加法(新物件、不動既有);**非** CONCURRENTLY ⇒ 與本片其餘 DDL 同一交易,失敗即整片回滾。
CREATE UNIQUE INDEX pre_one_success_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type = 'result_success';

COMMENT ON INDEX public.pre_one_success_uniq IS
  'L5b-2 片2d:每顆 refund 至多一筆 result_success(=至多一次「TapPay 受理」)。'
  '🔴 這條原本由舊的 pre_one_terminal_uniq **順帶**提供;本片把 result_success 移出 terminal 之後,'
  '若不補這顆索引,同一顆 refund 換個 seq 就能落兩筆已受理(2g writer crash 重試即可構造)。'
  '一顆 refund = 一把 TapPay 冪等鍵 = 至多一次受理(R3-Fable F2;主視窗 P-507-A 裁 A)。';


-- ── 3. 斷言(post-image;每一道對應一個可構造的失效)──────────────────────
DO $l5b2_2d_asserts$
DECLARE
  v_def  text;
  v_pred text;
  v_n    integer;
BEGIN
  -- ① 新值域確實含 result_confirmed,且**舊的六個值一個都沒掉**
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.conname = 'pre_event_type_chk';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2d assert:pre_event_type_chk 不見了(DROP 之後沒 ADD 回來?)';
  END IF;
  IF pg_catalog.strpos(v_def, 'result_confirmed') = 0 THEN
    RAISE EXCEPTION 'L5b-2-2d assert:新值域裡沒有 result_confirmed。實際=[%]', v_def;
  END IF;
  -- 🔴 逐個檢查舊值:DROP+ADD 最容易發生的偏離是「順手漏抄一個」,而那要等有人寫入才會發現。
  FOREACH v_pred IN ARRAY ARRAY['sent','result_success','result_failed','result_unknown','reconcile','manual'] LOOP
    IF pg_catalog.strpos(v_def, '''' || v_pred || '''') = 0 THEN
      RAISE EXCEPTION 'L5b-2-2d assert:重建 pre_event_type_chk 時把既有值 [%] 弄丟了。實際=[%]', v_pred, v_def;
    END IF;
  END LOOP;

  -- 🔴 **catch-all:逐字比對**(對抗審查 R1 must-fix,成立)。放在具體檢查**之後**:
  --    具體那幾條講的是人話(「漏抄了 reconcile」),這條收它們看不見的殘餘 ——
  --    最典型是**多**一個值(打錯字的第八值),舊值一個沒少、`result_confirmed` 也在,
  --    上面每一條都放行。⚠️ 順序不能顛倒:逐字比對放前面會把所有具體訊息蓋掉,
  --    負測就只剩「不符」三個字、分不出是哪一種偏離(本片實測踩過:M1-M3 三格同時錯位)。
  IF v_def IS DISTINCT FROM
     'CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
     || ' ''result_confirmed''::text, ''result_failed''::text, ''result_unknown''::text,'
     || ' ''reconcile''::text, ''manual''::text])))' THEN
    RAISE EXCEPTION 'L5b-2-2d assert:值域與 post-image **逐字不符**(多值/寫法變了都算)。實際=[%]', v_def;
  END IF;

  -- ② 索引述詞換成新集合,且 `result_success` **確實退出**
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_pred
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq');
  IF v_pred IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2d assert:pre_one_terminal_uniq 不見了';
  END IF;
  IF pg_catalog.strpos(v_pred, 'result_confirmed') = 0 THEN
    RAISE EXCEPTION 'L5b-2-2d assert:索引述詞沒有 result_confirmed。實際=[%]', v_pred;
  END IF;
  -- 🔴 這一半才是本片的重點:光「加了 result_confirmed」不夠,`result_success` 必須**離開**。
  --    它還在的話,「已受理」仍會佔掉唯一的終局名額 ⇒ 隔日確認寫不進去,本片等於沒做。
  IF pg_catalog.strpos(v_pred, 'result_success') > 0 THEN
    RAISE EXCEPTION 'L5b-2-2d assert:result_success 還在 terminal 集合裡 ⇒ 「已受理」仍會佔掉終局名額,'
                    '隔日的 result_confirmed 會撞唯一性。實際=[%]', v_pred;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
     WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq') AND i.indisunique AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'L5b-2-2d assert:pre_one_terminal_uniq 不是 valid 的唯一索引';
  END IF;

  -- 🔴 catch-all(同上,放在具體檢查之後):述詞多塞一個 event_type、欄位順序變了都算。
  IF v_pred IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ANY (ARRAY[''result_confirmed''::text, ''result_failed''::text, ''manual''::text]))' THEN
    RAISE EXCEPTION 'L5b-2-2d assert:索引定義與 post-image **逐字不符**。實際=[%]', v_pred;
  END IF;

  -- ②-b 🔴 新索引 pre_one_success_uniq:存在 + 唯一 + valid + 述詞逐字
  SELECT COALESCE(pg_catalog.pg_get_indexdef(i.indexrelid), '(無)') INTO v_pred
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_success_uniq');
  IF v_pred IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_success_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ''result_success''::text)' THEN
    RAISE EXCEPTION 'L5b-2-2d assert:pre_one_success_uniq 不存在或定義不符 ⇒ 「每顆 refund 至多一筆 result_success」'
                    '這個保證在本片之後就沒有東西在守了。實際=[%]', v_pred;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
     WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_success_uniq') AND i.indisunique AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'L5b-2-2d assert:pre_one_success_uniq 不是 valid 的唯一索引';
  END IF;

  -- ③ 其餘三條 CHECK 一條都不能少(本片只該動一條)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.contype = 'c';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'L5b-2-2d assert:子表 CHECK 共 % 條(期望 4)⇒ 有別的約束被動到', v_n;
  END IF;

  -- ④ 零直權面未變(表級 + 欄級兩本帳;`relacl` 看不到 `attacl`)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.payment_refund_events'::regclass AND a.grantee <> c.relowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
     WHERE c.oid = 'public.payment_refund_events'::regclass
       AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2d assert:payment_refund_events 出現非 owner grantee ⇒ 本片弄髒了零直權面';
  END IF;

  RAISE NOTICE 'L5b-2-2d 完成:result_confirmed 已入值域;terminal = result_confirmed/result_failed/manual';
END
$l5b2_2d_asserts$;

COMMIT;


-- ============================================================
-- Rollback → `scripts/l5b2-2d-rollback.sql`(獨立、單一交易、可直接執行)
--
-- 🔴🔴 **順序**:本片必須**先於** 2c 回退(`l5b2-2d-rollback.sql` → `l5b2-2c-rollback.sql`)。
--   機制=2d 回退的自驗釘死的 pre-image 含 2c 那條 CHECK ⇒ 2c 先退掉,2d 就退不掉(實測見檔頭)。
--   擋錯序的閘在 `l5b2-2c-rollback.sql` 的前置閘(2026-08-11 補;在它之前錯序完全不會被擋)。
--
-- ⚠️ **回退的資料前提**:退回舊 terminal 集合時,`result_success` 會**重新**變成 terminal
--   ⇒ 若期間已寫入「同一顆 refund 既有 result_success 又有 result_confirmed」的列(那正是本片解鎖的形狀),
--     舊索引建不回去。回退腳本自己有閘會先算,非零就拒絕並要人決定。
-- ============================================================
