-- 20260928040000_m4b_products_category_lock.sql —— 商品頁乙 C1:員工改過的分類,每日同步不改回去
-- pcm:idempotent: no
--   ↑ forward-only:欄與 trigger 已存在就由前置閘拒重跑(同樣板 20260902190000)。
--     拋棄式 PG 實跑:套用 → 回滾(三欄留著)→ 再套用【被前置閘①拒絕,這是預期】→ 手動拿掉三欄後再套用成功(見 commit message)。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md(M1、片 C1)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-09-28 Q3 乙:批次動作第一版就要有「改分類」。而每日同步每天都會把 products.category_id 寫回供應商的分類
-- (scripts/rpm-transform.ts:740)⇒ 員工改了,隔天就被改回去。
-- 做法逐段照抄已上線的說明鎖(20260902190000_m4b_quotedesclock_bc.sql):記號三欄 + BEFORE UPDATE trigger 保留舊值,
-- 後台寫入時帶交易級通行設定。同步程式不用改,送出的欄位不變。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- ① products 加三欄:category_locked boolean NOT NULL DEFAULT false / category_locked_at timestamptz / category_locked_by text FK → staff
-- ② CHECK products_category_lock_pair:鎖了就一定有時間;沒鎖時間與人都是空的
-- ③ 部分索引 products_category_locked_idx(給後台「分類由員工設定」篩選)
-- ④ trigger trg_products_category_lock(BEFORE UPDATE):OLD.category_locked 為 true 且沒有 SET LOCAL pcm.allow_locked_category_write = 'on'
--    ⇒ NEW.category_id := OLD.category_id。看的是【寫入前】的鎖定狀態:同一句 UPDATE 同時清旗標又改分類,分類照樣被保留。
--    🔴 名稱刻意排在 trg_products_z_content_changed 之前(PG 同時機 trigger 依名稱排序;那支刻意最後跑,20260915220000:85–90)。
--       排錯的話:被鎖商品每天同步送供應商分類時,content_changed_at 會先被判「變了」再被本支還原 ⇒ sitemap 更新時間每天被推新。
-- 🔴 這道 trigger 防的是【忘記】(每日同步不會設那個通行設定),不是防惡意:任何拿得到寫入權的人都設得起來,
--    刻意把鎖清掉的腳本、刪掉商品重建,都擋不住。不要把它寫成安全機制。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · LOCK TABLE products ACCESS EXCLUSIVE 到 COMMIT;ADD CONSTRAINT 要掃一次全表驗 CHECK。
--   避開每日同步(rpm-sync.yml,台灣 12:30 起約 10–15 分)與客人多的時段。lock_timeout 5s。
-- · 顧客站不用改;後台改分類的函式是下一支(M2)。
-- · 回滾:supabase/rollbacks/20260928040000-rollback.sql —— 拿掉 trigger 與函式;三欄刻意留著(惰性)。
--   ⚠️ 退回之後,員工設過的分類會在下一次同步被供應商分類蓋掉(= 退回等於放棄那些分類)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE;

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.products'::regclass
                AND attname = 'category_locked' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:products.category_locked 已存在 ⇒ forward-only, 拒重跑';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.products'::regclass
                    AND attname = 'category_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘②:找不到 products.category_id';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_category_lock') THEN
    RAISE EXCEPTION '前置閘③:trigger 已存在 ⇒ forward-only, 拒重跑';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 public.staff ⇒ category_locked_by 的 FK 目標不在';
  END IF;
  -- 前置閘⑤:排序前提 —— content_changed 那支必須存在,而且名稱排在本支之後
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_z_content_changed') THEN
    RAISE EXCEPTION '前置閘⑤:找不到 trg_products_z_content_changed(20260915220000 未套用)';
  END IF;
END
$pre$;

ALTER TABLE public.products
  ADD COLUMN category_locked    boolean     NOT NULL DEFAULT false,
  ADD COLUMN category_locked_at timestamptz,
  ADD COLUMN category_locked_by text REFERENCES public.staff(id) ON DELETE RESTRICT;

ALTER TABLE public.products
  ADD CONSTRAINT products_category_lock_pair
    CHECK (
      (category_locked      AND category_locked_at IS NOT NULL)
      OR
      (NOT category_locked  AND category_locked_at IS NULL
                            AND category_locked_by IS NULL)
    );

CREATE INDEX products_category_locked_idx
  ON public.products (id) WHERE category_locked;

COMMENT ON COLUMN public.products.category_locked IS
  'true = 這一列的 category_id 是員工設的,每日同步不可改回供應商的分類(商品頁乙 20260928040000)。
怎麼擋的:trg_products_category_lock(BEFORE UPDATE)在寫入前 category_locked 為 true 時把 NEW.category_id 換回 OLD.category_id。
INSERT … ON CONFLICT DO UPDATE 也會觸發(同說明鎖 20260902190000 實跑)。
後台改分類帶 SET LOCAL pcm.allow_locked_category_write = ''on''。這道 trigger 防的是忘記,不是防惡意,不要把它寫成安全機制。';
COMMENT ON COLUMN public.products.category_locked_at IS '這一列的分類被員工設定(鎖住)的時間。';
COMMENT ON COLUMN public.products.category_locked_by IS '是哪位員工設定的(FK → public.staff.id)。';

CREATE FUNCTION public.products_category_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- 🔴 讀 OLD 不讀 NEW:讀 NEW 的話,同一句 UPDATE 只要把 category_locked 設成 false 就繞過去了。
  IF OLD.category_locked
     AND coalesce(pg_catalog.current_setting('pcm.allow_locked_category_write', true), 'off') <> 'on'
  THEN
    NEW.category_id := OLD.category_id;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.products_category_lock_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_category_lock_guard() FROM anon, authenticated;

CREATE TRIGGER trg_products_category_lock
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_category_lock_guard();

DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.products_category_lock_guard()'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
  END LOOP;
END
$grant_assert$;

DO $post$
DECLARE
  v_type text; v_notnull boolean; v_default text; v_cfg text[];
  v_tgenabled "char"; v_tgtype smallint; v_tgfoid oid;
  v_condef text; v_idxdef text;
BEGIN
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.products'::regclass
     AND a.attname = 'category_locked' AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'boolean' OR NOT v_notnull OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '事後閘①:欄形狀不對(型別 % / notnull % / 預設 %)', v_type, v_notnull, v_default;
  END IF;

  SELECT t.tgenabled, t.tgtype, t.tgfoid
    INTO v_tgenabled, v_tgtype, v_tgfoid
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.products'::regclass
     AND t.tgname = 'trg_products_category_lock' AND NOT t.tgisinternal;
  IF v_tgenabled IS NULL OR v_tgenabled <> 'O' THEN
    RAISE EXCEPTION '事後閘②:trigger 沒建成或不是啟用中(tgenabled=%)', v_tgenabled;
  END IF;
  IF v_tgtype <> 19 THEN
    RAISE EXCEPTION '事後閘②:trigger 不是剛好 ROW+BEFORE+UPDATE(tgtype=% 而要 19)', v_tgtype;
  END IF;
  IF v_tgfoid IS DISTINCT FROM 'public.products_category_lock_guard()'::regprocedure THEN
    RAISE EXCEPTION '事後閘②:trigger 指向的不是 public.products_category_lock_guard()';
  END IF;
  IF NOT ('trg_products_category_lock' < 'trg_products_z_content_changed' COLLATE "C") THEN
    RAISE EXCEPTION '事後閘③:本支 trigger 名稱沒有排在 trg_products_z_content_changed 之前';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_condef
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.products'::regclass
     AND c.conname = 'products_category_lock_pair' AND c.contype = 'c';
  IF v_condef IS NULL
     OR pg_catalog.strpos(v_condef, 'category_locked_at IS NOT NULL') = 0
     OR pg_catalog.strpos(v_condef, 'category_locked_at IS NULL') = 0
     OR pg_catalog.strpos(v_condef, 'category_locked_by IS NULL') = 0 THEN
    RAISE EXCEPTION '事後閘④:一致性 CHECK 不見了或定義不對(實際 %)', v_condef;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  JOIN pg_catalog.pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attname = 'category_locked_by'
                 WHERE c.conrelid = 'public.products'::regclass
                   AND c.contype = 'f' AND a.attnum = ANY (c.conkey)
                   AND c.confrelid = 'public.staff'::regclass) THEN
    RAISE EXCEPTION '事後閘④b:category_locked_by 沒有指向 public.staff 的 FK';
  END IF;
  SELECT pg_catalog.pg_get_indexdef(i.oid) INTO v_idxdef
    FROM pg_catalog.pg_class i
   WHERE i.relname = 'products_category_locked_idx' AND i.relkind = 'i';
  IF v_idxdef IS NULL OR pg_catalog.strpos(v_idxdef, 'WHERE category_locked') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:部分索引不見了或述詞不對(實際 %)', v_idxdef;
  END IF;

  SELECT p.proconfig INTO v_cfg FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'products_category_lock_guard';
  IF v_cfg IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_cfg) e
                     WHERE e IN ('search_path=', 'search_path=""')) THEN
    RAISE EXCEPTION '事後閘⑥:trigger 函式沒有 SET search_path = ''''(實際 %)', v_cfg;
  END IF;

  RAISE NOTICE '✅ 20260928040000 事後閘通過:欄形狀、trigger(啟用中、tgtype 19、指向本函式、排在 z_content_changed 之前)、CHECK、FK、部分索引、search_path。不驗行為 —— 行為在拋棄式 PG 實跑(見 commit message)。';
END
$post$;

COMMIT;
