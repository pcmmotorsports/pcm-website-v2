-- ============================================================
-- L5b-2 片 2c · **回退腳本**(可直接執行,不是座標清單)
-- ============================================================
-- 標的:supabase/migrations/20260811080000_m4b_lifecycle_l5b2_2c_refund_ledger_columns_checks.sql
-- 作用:撤掉 2c 加的一欄 + 三條 CHECK,回到 L5b 帳本(20260810140000)的形狀。
--
-- 用法(整份跑,不要只跑其中幾句):
--   psql "$DSN" -v ON_ERROR_STOP=1 -f scripts/l5b2-2c-rollback.sql
--
-- 🔴 **誰跑、用哪條 DSN**:
--   · **誰**  = 主視窗(施工窗碰不到正式 DSN);正式庫回退**需 Sean 拍板**,與 apply 同一停點層級。
--   · **DSN** = 與 apply 同一條(`supabase db push` 用的那條)。本檔要 `ALTER TABLE` ⇒ 必須是表 owner 或更高權。
--   · 取法照既有紀律 grep 單顆,**絕不 `source .env.local`**(memory `reference_never-source-env-local-use-grep`)。
--
-- 🔴🔴 **為什麼是獨立檔而不是 migration 檔尾的註解**(2a 的教訓,不重蹈):
--   2a 第一版把 rollback 寫成檔尾座標 + 省略號、卻宣稱「可執行」,照著跑會死在中途。
--   本片雖然單純很多,仍照同一形制 —— **理由不是複雜度,是「宣稱可執行的東西必須真的可執行」**。
--
-- 🔴 **它不是死檔**:`scripts/l5b2-2c-verify.sh` 的每一次 reset 都跑這一支 ⇒ 每輪被實跑十幾次。
--
-- ⚠️⚠️ **不可逆邊界(本片最重要的一段)**:
--   `DROP COLUMN rec_trade_id` 會**永久刪掉該欄已寫入的全部資料**,而那個值是
--   「這筆退款對到哪一筆 TapPay 交易」的快照 —— 沒有它,對帳只能靠人翻。
--   ⇒ 本檔有**列數閘**:`payment_refunds` 中 **`rec_trade_id` 非 NULL 的列數 > 0** 時拒絕執行,
--     除非明示 `-v force_nonempty=1`(只認字面 `1`)。
--   ⚠️ 措辭刻意精確(對抗審查 R1 指出我原本寫「表非空即拒絕」與實作不符):
--     表有列但該欄全 NULL ⇒ **DROP COLUMN 不會丟掉任何資訊** ⇒ 放行是對的,不需要 force。
--   2c apply 當下表是空的;一旦 2g 開始寫入,回退就不再是無損操作。
-- ============================================================

\if :{?force_nonempty}
\else
  \set force_nonempty 0
\endif

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- 🔴 psql 的 `:var` **不會在 dollar-quoted 區塊內展開**(我第一版直接在 DO 裡寫 `:force_nonempty`,
--    當場 syntax error)⇒ 先在區塊外把它塞進交易本地 GUC,DO 裡用 `current_setting(..., true)` 讀。
SELECT pg_catalog.set_config('l5b2_2c.force_nonempty', :'force_nonempty', true);

-- ① 前置閘:確認要撤的東西真的在(且是 2c 加的那三條),以及資料損失的規模
DO $rb_2c_guard$
DECLARE
  v_n     integer;
  v_rows  bigint;
  v_deps  text;
  -- 🔴 **只認字面 `1`**(對抗審查 R1):第一版寫 `<> '0'` ⇒ `false`、空字串、打錯的任何值
  --    **通通變成「強制放行」** —— 一道破壞性閘的預設方向恰好反了。白名單而不是黑名單。
  v_force boolean := COALESCE(pg_catalog.current_setting('l5b2_2c.force_nonempty', true), '0') = '1';
BEGIN
  -- 🔴 鎖 `conrelid`:約束名只對同一張表唯一,全庫計數會被別表的同名約束干擾(對抗審查 R1)。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_constraint c
   WHERE c.contype = 'c'
     AND ( (c.conrelid = 'public.payment_refunds'::regclass
            AND c.conname IN ('pr_rec_trade_id_shape_chk', 'pr_strong_key_domain_chk'))
        OR (c.conrelid = 'public.payment_refund_events'::regclass
            AND c.conname = 'pre_manual_needs_verdict_chk') );
  IF v_n = 0 AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_refunds'::regclass
       AND attname = 'rec_trade_id' AND NOT attisdropped
  ) THEN
    RAISE NOTICE 'L5b-2-2c rollback:2c 的產物都已不在 ⇒ 本次為冪等重跑,無事可做但仍會跑自驗';
  ELSIF v_n <> 3 THEN
    -- 🔴 部分存在 = 有人手動撤過一部分,或別的片動過。盲目往下 DROP 會把狀態弄得更難查。
    RAISE EXCEPTION 'L5b-2-2c rollback:三條 CHECK 只找到 % 條(期望 3 或 0)⇒ 狀態不完整,停下人工判斷', v_n;
  END IF;

  -- 🔴 資料損失閘:非空時要人明示
  -- ⚠️ 這裡**必須動態查**:本檔要冪等(harness 每輪跑好幾次)。第二次跑時欄早已被撤掉,
  --    直接寫 `WHERE rec_trade_id IS NOT NULL` 會當場 42703 ⇒ 回退腳本自己壞掉。
  --    (我第一版就是這樣寫的,被 harness 的第二輪 reset 抓到。)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_refunds'::regclass
       AND attname = 'rec_trade_id' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.payment_refunds WHERE rec_trade_id IS NOT NULL' INTO v_rows;
  ELSE
    v_rows := 0;
  END IF;
  IF v_rows > 0 AND NOT v_force THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:payment_refunds 有 % 列的 rec_trade_id 非空,DROP COLUMN 會**永久刪掉**它們'
                    '(那是「這筆退款對到哪筆 TapPay 交易」的唯一快照)。'
                    '確認要丟就重跑並帶 `-v force_nonempty=1`;不確定就先把那 % 列匯出留底', v_rows, v_rows;
  END IF;
  IF v_rows > 0 THEN
    RAISE WARNING 'L5b-2-2c rollback:已被明示放行,即將刪掉 % 列的 rec_trade_id 快照', v_rows;
  END IF;

  -- ── 🔴 下游守門(對抗審查 R2:§2a-X 第 6 條「成組回退閘」對本片**不是完全不適用**)──
  -- 我原本判「本片不在 2e/2f/2g 那個批次裡 ⇒ 不適用」。R2 給的反例成立:
  --   2g 的 writer 已部署、但**還沒寫進任何一列**(`rec_trade_id` 全 NULL)時,
  --   上面的列數閘會**放行** ⇒ 欄被撤掉,而 writer 還留在庫裡,
  --   下次它被呼叫時才因為缺欄炸開(42703),而且是炸在**退款路徑**上。
  --   ⇒ 列數閘擋的是「資料損失」,擋不到「**還有人依賴這個欄**」。那是兩件事。
  -- 判準用**釘住的基線集合**,不用模糊述詞:`rec_trade_id` 這個名字在
  -- `payment_charge_attempts` 上也有(`20260612150000:93`;R3=F1 更正,我原本引 `20260624120000:55`,
  -- 那是另一支 migration 的 `released_closed_at` 欄宣告)⇒ 全庫 18 支函式的本體提到它,
  -- 光比名字會恆紅。改成比「同時提到 `payment_refunds` 與 `rec_trade_id` 的函式集合」,
  -- 其 pre-image = 恰好一支 `admin_compute_order_settlement`(2026-08-11 於本機 17.10 實查;
  -- 它 `:89` 讀 `public.payment_refunds`、另處用 attempts 側的 rec,**不依賴本片這個欄**)。
  -- ⚠️ 這是**變動偵測**不是語意分析:集合一變就停下來給人看。可能誤報,方向是 fail-closed。
  SELECT COALESCE(pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname), '(空)') INTO v_deps
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc LIKE '%payment_refunds%'
     AND p.prosrc LIKE '%rec_trade_id%';
  IF v_deps IS DISTINCT FROM 'admin_compute_order_settlement' THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:同時提到 payment_refunds 與 rec_trade_id 的函式集合已變 '
                    '(實際=[%] 期望=[admin_compute_order_settlement])。'
                    '最可能的原因是 **2g 的 writer 已經在庫裡** ⇒ 現在撤欄會讓它在下次退款時炸掉。'
                    '⇒ 先撤 2g(或確認新成員不依賴 payment_refunds.rec_trade_id)再回頭跑本檔。'
                    '⛔ 不要把上面那個期望值改成現況 —— 那是把偵測器關掉。', v_deps;
  END IF;
END
$rb_2c_guard$;

-- ② 撤三條 CHECK(IF EXISTS ⇒ 冪等)
ALTER TABLE public.payment_refunds       DROP CONSTRAINT IF EXISTS pr_rec_trade_id_shape_chk;
ALTER TABLE public.payment_refunds       DROP CONSTRAINT IF EXISTS pr_strong_key_domain_chk;
ALTER TABLE public.payment_refund_events DROP CONSTRAINT IF EXISTS pre_manual_needs_verdict_chk;

-- ③ 撤欄(連同它的 COMMENT 一起消失,不需另外處理)
ALTER TABLE public.payment_refunds DROP COLUMN IF EXISTS rec_trade_id;

-- ④ 回退後自驗(fail-closed;沒有這段,「回退成功」只是「沒報錯」)
DO $rb_2c_verify$
DECLARE
  v_cols text;
  v_cons text;
  c_cols constant text :=
    'amount,attempt_id,created_at,currency,id,idempotency_key,lease_token,strong_key,supersedes_refund_id';
  c_cons constant text :=
    'pr_amount_positive_chk,pr_currency_domain_chk,pr_idem_key_shape_chk,pr_lease_token_nonneg_chk,'
    || 'pr_not_self_chk,pr_strong_key_nonblank_chk';
BEGIN
  -- 🔴 `COALESCE` + `IS DISTINCT FROM`:空集合時 `string_agg` 回 NULL,`NULL <> x` 求值為 NULL
  --    ⇒ 閘不發火、回退仍宣稱「已回到 pre-image」(對抗審查 R1,與 migration 同族同修)。
  SELECT COALESCE(pg_catalog.string_agg(a.attname, ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refunds'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM c_cols THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:欄集合沒回到 pre-image。實際=[%] 期望=[%]', v_cols, c_cols;
  END IF;

  SELECT COALESCE(pg_catalog.string_agg(c.conname, ',' ORDER BY c.conname), '(空)') INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refunds'::regclass AND c.contype = 'c';
  IF v_cons IS DISTINCT FROM c_cons THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:CHECK 集合沒回到 pre-image。實際=[%] 期望=[%]', v_cons, c_cons;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conname = 'pre_manual_needs_verdict_chk' AND contype = 'c'
       AND conrelid = 'public.payment_refund_events'::regclass
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:子表的 manual verdict CHECK 還在 ⇒ 回退不完整';
  END IF;

  -- 🔴 N1(對抗審查 R3):migration 的前置閘釘了子表的欄型別/NOT NULL,回退自驗卻沒複驗 ——
  --    **不對稱的守門會讓「回退後的形狀」比「apply 前的形狀」少一道檢查**。
  --    子表的 event_type NOT NULL 尤其承重:它一旦沒了,回退後看起來乾淨、但下一次 apply 的
  --    前置閘才會紅,而那時人已經走了。
  SELECT COALESCE(pg_catalog.string_agg(
           a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull::text,
           ',' ORDER BY a.attname), '(空)') INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.payment_refund_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'created_at:timestamp with time zone:true,event_type:text:true,id:uuid:true,'
     || 'lease_token:integer:true,record_snapshot:jsonb:false,refund_id:uuid:true,seq:integer:true' THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:payment_refund_events 的欄型別/NOT NULL 與 pre-image 不符。實際=[%]', v_cols;
  END IF;

  -- 🔴 零直權面:回退不得順手改變可達面。**表級與欄級兩本帳都查**(對抗審查 R1:
  --    `GRANT SELECT(amount)` 只進 attacl,relacl 可以維持空的 ⇒ 只查表級會宣告零權限而事實上有後門)。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:退款帳本出現**表級**非 owner grantee ⇒ 回退弄髒了零直權面';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass)
       AND att.attnum > 0 AND NOT att.attisdropped
       AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2c rollback:退款帳本出現**欄級** GRANT ⇒ 表級 ACL 攤平看不到它';
  END IF;

  RAISE NOTICE 'L5b-2-2c rollback 完成:一欄三 CHECK 已撤,欄集合與 CHECK 集合皆回到 20260810140000 的形狀';
END
$rb_2c_verify$;

COMMIT;
