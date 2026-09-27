-- 20260928050000_m4b_admin_set_product_category.sql —— 商品頁乙 C2:後台改分類(一件或整批)的唯一入口
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。拋棄式 PG 實跑:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,前置閘之前本庫查無此名。
-- ACL-GATE-EXEMPT: public.admin_set_product_category -- SECURITY DEFINER RPC,只給 service_role EXECUTE(後台 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260927060000 admin_set_product_override)。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md(M2 的規則、片 C2)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-09-28 Q3 乙:批次動作第一版就要有「改分類」。20260928040000 已經讓「鎖住的分類」不被每日同步改回去;
-- 本支是員工設定分類與解鎖的入口(寫分類 + 鎖住 + 稽核,同一個交易)。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_set_product_category(p_product_ids uuid[], p_category_id uuid, p_unlock boolean, p_actor text, p_request_id text)
--   RETURNS TABLE(product_id uuid, outcome text)   outcome = UPDATED / NO_CHANGE / NOT_FOUND
-- · 參數不合法 ⇒ 整批不寫、RAISE:空清單、清單有空值、去重後超過 200 件、p_unlock 卻帶分類、設定卻沒帶分類、分類不存在。
-- · 操作人必須是在職員工(staff.is_active FOR SHARE;錯誤字面同 20260927060000 ⇒ 後台對應到「無權執行此操作」)。
-- · 不等鎖:一句 SELECT … ORDER BY id FOR UPDATE NOWAIT 把這批一次鎖好;任何一件正被別人(例如每日同步)鎖著 ⇒
--   整批不做,RAISE '商品正在更新,請稍後再試'。商品列的鎖一律 NOWAIT(只有在職員工檢查那一句 FOR SHARE 會等 staff 列)
--   ⇒ 不會和同步形成互相等待。
-- · 判斷有沒有變:同時比「分類」和「鎖定狀態」。
--     設定(p_unlock = false):分類相同而且已鎖 ⇒ NO_CHANGE;否則寫分類、鎖住、記時間與人。
--     解鎖(p_unlock = true):沒鎖 ⇒ NO_CHANGE;否則解鎖並清掉時間與人,分類本身不動
--       (之後同步成功跑到這件、而且來源還有這件時,才會寫回供應商的分類)。
-- · 逐件寫 admin_audit_log('product.category.change'),before / after 都記分類與鎖定狀態;全部在同一個交易,稽核失敗整批退回。
-- · 寫分類前 SET LOCAL pcm.allow_locked_category_write = 'on'(20260928040000 的通行設定;交易結束自動失效)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 前置:20260928040000 已套用(前置閘會擋)。只建一支函式,不動表 ⇒ 任何時段都可以貼。
-- · 後台改分類那幾片(C3–C5)要在本支貼完之後才推:碼先上 ⇒ RPC 不存在 ⇒ 員工按儲存看到「儲存失敗」,不會寫壞資料。
-- · 回滾:supabase/rollbacks/20260928050000-rollback.sql(DROP FUNCTION;要先退後台碼)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_category_lock') THEN
    RAISE EXCEPTION '前置閘失敗 — 分類鎖 trigger 不存在(20260928040000 未套用)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — staff.is_active 不存在(在職員工檢查需要它)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_set_product_category(
  p_product_ids uuid[],
  p_category_id uuid,
  p_unlock      boolean,
  p_actor       text,
  p_request_id  text
)
RETURNS TABLE(product_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_unlock  boolean := COALESCE(p_unlock, false);
  v_ids     uuid[];
  v_id      uuid;
  v_before  record;
  v_found   uuid[];
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析,缺 ⇒ 拒)
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_set_product_category: 缺 actor';
  END IF;
  -- 🔴 操作人必須是【在職】員工;錯誤字面同 20260927060000 ⇒ 後台對應到同一句話。
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_set_product_category: 缺 request_id';
  END IF;

  -- 1b. 清單:不得空、不得有空值;去重後照 id 排序;最多 200 件
  IF p_product_ids IS NULL OR pg_catalog.cardinality(p_product_ids) = 0 THEN
    RAISE EXCEPTION 'admin_set_product_category: 沒有選商品';
  END IF;
  IF pg_catalog.array_position(p_product_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'admin_set_product_category: 商品清單有空值';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM pg_catalog.unnest(p_product_ids) AS t(x);
  IF pg_catalog.cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'admin_set_product_category: 一次最多 200 件';
  END IF;

  -- 1c. 分類:設定要帶、解鎖不帶;要帶的必須存在
  IF v_unlock THEN
    IF p_category_id IS NOT NULL THEN
      RAISE EXCEPTION 'admin_set_product_category: 解鎖不帶分類';
    END IF;
  ELSE
    IF p_category_id IS NULL THEN
      RAISE EXCEPTION 'admin_set_product_category: 沒有選分類';
    END IF;
    PERFORM 1 FROM public.categories c WHERE c.id = p_category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'admin_set_product_category: 分類不存在';
    END IF;
  END IF;

  -- 2. 一次鎖好,不等別人的鎖(與每日同步不會互相等待)
  BEGIN
    SELECT pg_catalog.array_agg(p.id ORDER BY p.id) INTO v_found
      FROM (SELECT pr.id FROM public.products pr WHERE pr.id = ANY (v_ids) ORDER BY pr.id FOR UPDATE NOWAIT) p;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '商品正在更新,請稍後再試';
  END;

  PERFORM pg_catalog.set_config('pcm.allow_locked_category_write', 'on', true);

  -- 3. 逐件(照 id 順序)
  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_found IS NULL OR NOT (v_id = ANY (v_found)) THEN
      product_id := v_id; outcome := 'NOT_FOUND'; RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pr.category_id, pr.category_locked INTO v_before
      FROM public.products pr WHERE pr.id = v_id;

    IF v_unlock THEN
      IF NOT v_before.category_locked THEN
        product_id := v_id; outcome := 'NO_CHANGE'; RETURN NEXT;
        CONTINUE;
      END IF;
      UPDATE public.products
         SET category_locked = false, category_locked_at = NULL, category_locked_by = NULL, updated_at = pg_catalog.now()
       WHERE id = v_id;
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
      VALUES (p_actor, 'product.category.change', 'product:' || v_id::text,
              pg_catalog.jsonb_build_object('category_id', v_before.category_id, 'locked', true),
              pg_catalog.jsonb_build_object('category_id', v_before.category_id, 'locked', false),
              NULL, p_request_id, 'admin');
    ELSE
      IF v_before.category_locked AND v_before.category_id = p_category_id THEN
        product_id := v_id; outcome := 'NO_CHANGE'; RETURN NEXT;
        CONTINUE;
      END IF;
      UPDATE public.products
         SET category_id = p_category_id,
             category_locked = true, category_locked_at = pg_catalog.now(), category_locked_by = p_actor,
             updated_at = pg_catalog.now()
       WHERE id = v_id;
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
      VALUES (p_actor, 'product.category.change', 'product:' || v_id::text,
              pg_catalog.jsonb_build_object('category_id', v_before.category_id, 'locked', v_before.category_locked),
              pg_catalog.jsonb_build_object('category_id', p_category_id, 'locked', true),
              NULL, p_request_id, 'admin');
    END IF;
    product_id := v_id; outcome := 'UPDATED'; RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.admin_set_product_category(uuid[], uuid, boolean, text, text) IS
  '商品頁乙 C2(20260928050000):後台改分類(一件或整批,最多 200 件)與「改回由同步決定」的唯一入口。在職員工才能用;'
  'FOR UPDATE NOWAIT 一次鎖好(被鎖 ⇒ 商品正在更新,請稍後再試);同時比分類與鎖定狀態,相同回 NO_CHANGE 不寫;'
  '逐件寫 admin_audit_log(product.category.change)。SECURITY DEFINER,search_path 空字串;EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_set_product_category(uuid[], uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_category(uuid[], uuid, boolean, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_set_product_category(uuid[], uuid, boolean, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_set_product_category:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_product_category:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_product_category:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'admin_set_product_category:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  RAISE NOTICE '✅ admin_set_product_category:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
