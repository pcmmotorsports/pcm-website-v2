-- 20260915030000-rollback.sql
--
-- 把 `orders_total_balances` 換回 B1(`20260828100000:278-281`)那條字面等式,然後刪掉 `pcm_order_total()`。
--
-- 🔵 不動任何一列資料:兩邊是同一條等式 ⇒ 沒有一張單的 total 需要改。全表再驗證一次(鎖 orders,與正向同量級)。
-- 🔴 順序不能反:先 DROP FUNCTION 會被 CHECK 的依賴擋下(那是正向那支刻意要的),所以先換 CHECK 再刪函式。
-- 🔴 P2(三支 RPC 改呼叫 pcm_order_total)若已貼 ⇒ **先退 P2 那支**,不然 RPC 呼叫一個不存在的函式 ⇒ 建單 / 改價全炸。
--    本支自己有前置閘擋這件事(還有東西依賴函式 ⇒ 停)。
-- 🔴🔴 **券片 D(20260915100000)貼下去之後是【三層】, 從最新往回退**(2026-09-15 補):
--    ① `supabase/rollbacks/20260915100000-rollback.sql`(create_order 退回 P2 那一代)
--    ② `supabase/rollbacks/20260915060000-rollback.sql`(三支 RPC 退回不叫 pcm_order_total 的那一代)
--    ③ 本支。
--    ⛔ ~~只寫「先退 P2」~~:D 在的時候 P2 的回退前置閘會因 create_order md5 對不上而拒跑 ⇒ 被指去一支擋不住的檔。
-- 🔴 TS 那半(total.test.ts 的 parity 格)在函式不在時會明確 skip,不會紅。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';  -- 同正向:lock_timeout 只管等鎖,掃描時間另夾

DO $gate_pre$
DECLARE
  v_n int;
  v_callers text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'pcm_order_total') THEN
    RAISE EXCEPTION '回退前置閘①:pcm_order_total 不在 ⇒ 正向那支沒貼過或已退過,停';
  END IF;
  -- 除了 orders_total_balances 這一條 CHECK 以外,還有別的東西(RPC 的 body 不算依賴;這裡抓的是 pg_depend 硬依賴)
  -- 依賴函式 ⇒ 停下人工看是誰
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid AND d.refclassid = 'pg_catalog.pg_proc'::regclass
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_total'
     AND d.deptype = 'n'
     AND NOT (d.classid = 'pg_catalog.pg_constraint'::regclass
              AND d.objid = (SELECT c.oid FROM pg_catalog.pg_constraint c
                              WHERE c.conname = 'orders_total_balances' AND c.conrelid = 'public.orders'::regclass));
  IF v_n > 0 THEN
    RAISE EXCEPTION '回退前置閘②:還有 % 個物件依賴 pcm_order_total(不是那條 CHECK)⇒ 先退它們', v_n;
  END IF;
  -- 🔴 前置閘③(codex R1 must-fix):plpgsql / sql 函式【本體】呼叫 pcm_order_total 不會進 pg_depend ⇒
  --    P2 那三支 RPC 改叫它之後,上面那一格仍是 0。所以直接掃 prosrc:任何一支函式本體提到它 ⇒ 先退 P2,本支拒跑。
  -- 掃【所有 schema】(codex R2 #3:別的 schema 的函式也可能叫 public.pcm_order_total),只用 OID 排除自己
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_callers
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid <> 'public.pcm_order_total(integer,integer,integer,integer)'::regprocedure
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ILIKE '%pcm_order_total%';
  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION '回退前置閘③:這些函式的本體還在呼叫 pcm_order_total:% ⇒ 從最新往回退:20260915100000(若已貼)→ 20260915060000 → 本支,不然建單 / 改價會炸', v_callers;
  END IF;
END
$gate_pre$;

-- ① CHECK 換回字面等式(= 20260828100000:278-281 逐字)
-- ⚠️ 字面等式是 integer 算術(B1 當時就是):一列若 subtotal + shipping_fee 中間值超過 int 上限而最終 total 合法,
--    新 CHECK(bigint)收、這一句會 22003 ⇒ 回退失敗整包回滾(codex R1 #2)。今天沒有任何 RPC 造得出這種列
--    (三支都先驗 > 2147483647 才寫);真撞到 ⇒ 不是改這一句,是那一列本身要先處理。回退 = 回到 B1 原狀,不開第二種字面。
ALTER TABLE public.orders DROP CONSTRAINT orders_total_balances;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_balances
  CHECK (total = subtotal + shipping_fee - discount_total + tax_total);

-- ② 依賴解開之後才刪得掉
DROP FUNCTION public.pcm_order_total(integer, integer, integer, integer);

DO $gate_post$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conname = 'orders_total_balances' AND c.conrelid = 'public.orders'::regclass;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'pcm_order_total') > 0 OR pg_catalog.strpos(v_def, 'tax_total') = 0 THEN
    RAISE EXCEPTION '回退事後閘:CHECK 不是 B1 那一代字面(現在是 %)', v_def;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'pcm_order_total') THEN
    RAISE EXCEPTION '回退事後閘:pcm_order_total 還在';
  END IF;
END
$gate_post$;

COMMIT;
