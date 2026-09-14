-- 20260915030000 · M-4b #953 · 訂單總額那條等式在 DB 只住一處:`public.pcm_order_total()`,CHECK 改呼叫它。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
-- plan:`docs/plans/2026-09-14-953-order-total-equation-single-source-plan.md` P1(Sean 2026-09-14 批 Q1 甲)。
-- 版本號:`scripts/migration-version-free.sh 20260915030000` 2026-09-14 掃兩次(116 ref / 8 worktree 沒人用);貼的當天重掃。
--
-- ═══════════════════════════════════════════════════════════════
-- 為什麼(#953 一句)
-- ═══════════════════════════════════════════════════════════════
-- `total = subtotal + shipping_fee - discount_total + tax_total` 這一句在 repo 裡有 9 份會執行的拷貝
-- (SQL 4:CHECK / create_order / admin_create_manual_order / admin_update_order_item_amount;TS 5),
-- 彼此不知道對方存在。#957 實測:對不上時 DB 是 check_violation 整筆回捲(吵),不是靜靜算錯 ——
-- 所以問題不是「會算錯錢」,是「下一個寫第 10 份的人抄到舊式子 ⇒ 他的功能在有稅的單上整個壞掉,
-- 而錯誤看起來像他自己弄壞的」。⇒ 等式只寫一次,CHECK 與三支 RPC 都呼叫它(P2 改 RPC,本支只做函式 + CHECK)。
--
-- 🔴 函式體【逐字】`SELECT p_subtotal::bigint + p_shipping_fee - p_discount_total + p_tax_total` ——
--    四項同序、無括號、無乘法。TS 那半(`packages/domain/src/order/total.test.ts`,A 窗 a7f671f2b)
--    會把這個函式體 tokenize 之後與 `orderTotal()` 逐 token 比;別的形狀會被判不等,**那是設計**。
--    形狀抄 repo 唯一「CHECK 裡呼叫函式」的前例 `m3_jsonb_values_all_string`(`20260604120000:73-87`):
--    `LANGUAGE sql IMMUTABLE SET search_path = ''`。
--
-- ═══════════════════════════════════════════════════════════════
-- 行為:一個位元都不變
-- ═══════════════════════════════════════════════════════════════
-- 新 CHECK 與舊 CHECK 是同一條等式 ⇒ 既有每一列都通過(B1 `20260828100000:276-281` 當時證過:四欄
-- integer NOT NULL、舊 CHECK 建表就 validated ⇒ NULL / 負數 / 型別三路都封死)。
-- 🔴 `ADD CONSTRAINT` 會鎖 `orders` 做全表驗證(與 B1 同量級,B1 貼過一次);夾 `lock_timeout` 不卡別人。
-- 🔴 `DROP FUNCTION pcm_order_total` 之後會被 CHECK 擋住(依賴)—— **要的**:等式那一份被刪 ⇒ 資料庫拒絕,
--    不會像 `20260828100000:468` 記的那個反方向(先刪欄 ⇒ CHECK 被靜靜連帶刪掉)。
--
-- 冪等:無頂層 DML。重跑 ⇒ 前置閘②(函式已存在 ⇒ RAISE)。forward-only。同一個 BEGIN…COMMIT,任一道炸整包回滾。
-- 回退:`supabase/rollbacks/20260915030000-rollback.sql`(CHECK 換回字面等式 → DROP 函式;順序反了會被依賴擋,那是設計)。
-- SET LOCAL lock_timeout = '5s';  ← 回退那支自己也夾這一行(全表再驗證一次會鎖 orders)。
-- 驗收腳本(拋棄式 PG 跑,含「把稅拿掉 ⇒ 必須紅」的突變格):`supabase/after-checks/20260915030000-pcm-order-total.sql`。
--
-- 🔵 pgTAP:本機與 repo 都沒有裝 pgtap extension(`pg_extension` 0 列、brew 無),plan 寫的 pgTAP 改成同目錄慣例的
--    psql DO-block 斷言腳本(`after-checks/`),斷言內容一樣、多一格突變證明。

BEGIN;

-- DROP / ADD CONSTRAINT 取 ACCESS EXCLUSIVE(讀寫都排隊),全表驗證做完才放(codex R1 #3 訂正:不是 SHARE ROW EXCLUSIVE)。
-- lock_timeout 只管【等鎖】多久;拿到鎖之後掃多久要另外夾 statement_timeout —— orders 今天幾百列,掃描是毫秒級,30s 是天花板不是預期。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $gate_pre$
DECLARE
  v_def text;
BEGIN
  -- 前置閘①:現行 CHECK 是 B1 那一代(字面等式含 tax_total),還沒改成呼叫函式
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'orders' AND c.conname = 'orders_total_balances';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:orders_total_balances 不存在 ⇒ 基線對不上,停';
  END IF;
  IF pg_catalog.strpos(v_def, 'tax_total') = 0 THEN
    RAISE EXCEPTION '前置閘①:現行 CHECK 沒有 tax_total(%)⇒ B1 20260828100000 還沒貼,先貼它', v_def;
  END IF;
  IF pg_catalog.strpos(v_def, 'pcm_order_total') > 0 THEN
    RAISE EXCEPTION '前置閘①:現行 CHECK 已經呼叫 pcm_order_total ⇒ 本支貼過了,停(不重複貼)';
  END IF;
  -- 前置閘②:函式還不在(任何簽章)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pcm_order_total') THEN
    RAISE EXCEPTION '前置閘②:public.pcm_order_total 已存在 ⇒ 本支貼過了或有人先建了,停下人工對齊';
  END IF;
  -- 正對照:strpos 這把尺今天是活的(找得到一定在的字)
  IF pg_catalog.strpos(v_def, 'subtotal') = 0 THEN
    RAISE EXCEPTION '前置閘(正對照):連 subtotal 都找不到 ⇒ 這把尺是死的 ⇒ 上面每一閘都不算數';
  END IF;
  -- 負對照:現造字面必須找不到
  IF pg_catalog.strpos(v_def, 'zzq_nope_literal_20260915') > 0 THEN
    RAISE EXCEPTION '前置閘(負對照):現造字面竟然找得到 ⇒ 這把尺恆真 ⇒ 停';
  END IF;
END
$gate_pre$;

-- ══ ① 等式只寫一次 ══════════════════════════════════════════════
-- 回 bigint:三支 RPC 今天都用 bigint 中間值再自己驗 > 2147483647 才 ::integer ⇒ 溢位閘留在各 RPC 原位不動。
-- STRICT:四欄都 NOT NULL,永遠不會餵 NULL;寫它只為 planner 常數摺疊。`total integer NOT NULL` 另擋 NULL,STRICT 不開洞。
CREATE FUNCTION public.pcm_order_total(
  p_subtotal integer,
  p_shipping_fee integer,
  p_discount_total integer,
  p_tax_total integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$ SELECT p_subtotal::bigint + p_shipping_fee - p_discount_total + p_tax_total $$;

COMMENT ON FUNCTION public.pcm_order_total(integer, integer, integer, integer) IS
  '#953 訂單總額那條等式的【唯一】DB 定義:subtotal + shipping_fee - discount_total + tax_total(回 bigint,溢位閘在呼叫端)。'
  'orders_total_balances CHECK 與 create_order / admin_create_manual_order / admin_update_order_item_amount 都呼叫它;'
  '要改等式只改這裡 —— 而 CREATE OR REPLACE 換函式體【不會】讓既有列重驗(IMMUTABLE 不禁止換體);改等式的那支 migration 要 '
  'DROP + ADD CHECK 一次做全表驗證,不然不合新規則的舊單會在下一次 UPDATE 才 23514。TS 那一份是 packages/domain/src/order/total.ts,'
  'total.test.ts 會逐 token 比對本函式體 ⇒ 兩邊一起改。'
  '20260915030000。';

-- 沒有任何角色需要直接呼叫 ⇒ 只 REVOKE,不 GRANT。
-- 🔴 CHECK 裡的函式是以【當下執行角色】查 EXECUTE(codex R1 #6 訂正,不是表擁有者):寫 orders 的路只有
--    postgres 擁有的 SECURITY DEFINER RPC(拋棄式 PG 實查:所有 prosrc 含 update/insert public.orders 的函式 owner 都是 postgres、
--    prosecdef=t;orders 對 service_role 直寫早已 REVOKE)⇒ 執行角色恆為 postgres,而 owner 永遠有 EXECUTE(proacl `postgres=X`)。
--    after-check ② 釘這一格:postgres 有、三個 API 角色沒有。
-- 🔴 service_role 也收:postgres 的 default ACL 會給每一支新函式 `service_role=X`(拋棄式 PG `pg_default_acl` 實查,
--    `defaclobjtype = 'f'`),只 REVOKE FROM PUBLIC 收不到它 ⇒ 兩句都要。
REVOKE ALL ON FUNCTION public.pcm_order_total(integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_order_total(integer, integer, integer, integer) FROM service_role;

-- ══ ② CHECK 改呼叫它(同一條等式 ⇒ 既有列全數通過)══════════════
ALTER TABLE public.orders DROP CONSTRAINT orders_total_balances;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_balances
  CHECK (total = public.pcm_order_total(subtotal, shipping_fee, discount_total, tax_total));

-- ══ 事後閘 ══════════════════════════════════════════════════════
DO $gate_post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1 = 1 函式)
  v_functions text[] := ARRAY[
    'public.pcm_order_total(pg_catalog.int4, pg_catalog.int4, pg_catalog.int4, pg_catalog.int4)'
  ]::text[];
  r text;
  v_def text;
  v_vol "char";
BEGIN
  -- 事後閘⓪:收權 —— 三個 API 角色都不需要叫它(寫 orders 的路只有 postgres 擁有的 DEFINER RPC,執行角色恆為 postgres)
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:% 不存在', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⓪:% 對 anon/authenticated/service_role 開著 EXECUTE(REVOKE FROM PUBLIC 沒生效?)', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = pg_catalog.to_regprocedure(r) AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '事後閘⓪:% 的 search_path 不是空字串', r;
    END IF;
  END LOOP;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'orders' AND c.conname = 'orders_total_balances';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'pcm_order_total(') = 0 THEN
    RAISE EXCEPTION '事後閘①:CHECK 沒有換成呼叫 pcm_order_total(現在是 %)', v_def;
  END IF;
  SELECT p.provolatile INTO v_vol
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_total';
  IF v_vol IS DISTINCT FROM 'i' THEN
    RAISE EXCEPTION '事後閘②:pcm_order_total 不是 IMMUTABLE(provolatile=%)⇒ CHECK 不該接受它', v_vol;
  END IF;
  -- 事後閘③:四組值(含稅 / 免稅 / 有券 / 全零)—— 等式若少一項,這裡先紅
  -- IS DISTINCT FROM 不是 <>:函式若被改成回 NULL,`<>` 全部變 NULL ⇒ 不進 IF ⇒ 假綠(codex R2 #1)
  IF public.pcm_order_total(1000, 100, 0, 55) IS DISTINCT FROM 1155
     OR public.pcm_order_total(1000, 100, 0, 0) IS DISTINCT FROM 1100
     OR public.pcm_order_total(1000, 100, 200, 45) IS DISTINCT FROM 945
     OR public.pcm_order_total(0, 0, 0, 0) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '事後閘③:pcm_order_total 算出來的值不對 ⇒ 函式體被改過,停';
  END IF;
  -- 事後閘④:溢位不在函式裡炸(回 bigint)
  IF public.pcm_order_total(2147483647, 2147483647, 0, 2147483647) IS DISTINCT FROM 6442450941 THEN
    RAISE EXCEPTION '事後閘④:回傳型別不是 bigint(三個 int 上限相加要得 6442450941)';
  END IF;
END
$gate_post$;

COMMIT;
