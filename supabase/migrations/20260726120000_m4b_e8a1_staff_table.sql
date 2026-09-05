-- ============================================================
-- M-4b E8-A1:staff 名單由資料庫提供(僅名單資料,不驗證操作者身分)
-- ============================================================
-- 本片只建立可讀取的 staff 名單與角色旗標;新增/編輯/停用 UI 留 E8-A2。
-- actor 仍由使用者自行從下拉選單挑選,不是登入 / 授權邊界。
-- 既有 admin_audit_log.actor 為 text,故 seed id 必須維持 sean / staff_1 / staff_2。
-- ============================================================

BEGIN;

-- ── 1. staff 主表─────────────────────────────────────────────
CREATE TABLE public.staff (
  id          text        PRIMARY KEY,
  label       text        NOT NULL,
  is_manager  boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_id_nonempty    CHECK (id <> ''),
  CONSTRAINT staff_id_format      CHECK (id ~ '^[a-z0-9_]{1,64}$'),
  -- btrim:純空白 label 會變成下拉選單裡「看似空白卻可授權」的 active actor(對齊既有 RPC 的 btrim 慣例)。
  CONSTRAINT staff_label_nonempty CHECK (pg_catalog.btrim(label) <> '')
);

COMMENT ON TABLE public.staff IS
  'M-4b E8-A1 後台 staff 名單。id 是寫入 admin_audit_log.actor 的穩定 slug;停用走 is_active=false、不物理刪除。本表只提供名單,不驗證目前操作者身分。';
COMMENT ON COLUMN public.staff.is_manager IS
  '⚠️ 本欄目前無任何程式讀取、不強制任何權限;成本遮蔽於後續片才實作。看到此欄不代表權限已生效。';

-- ── 2. seed(維持既有 audit actor id 與 UI label 字面)──────────
INSERT INTO public.staff (id, label, is_manager)
VALUES
  ('sean',    'Sean(老闆)',   true),
  ('staff_1', '員工 1(占位)', false),
  ('staff_2', '員工 2(占位)', false);

-- ── 3. updated_at 自動維護(欄位不能說謊)───────────────────────
-- 沒有 trigger 的 updated_at 會永遠停在建立日 = 一個會說謊的欄位。
-- SECURITY INVOKER(預設):純寫 NEW 欄位、不需提權。REVOKE PUBLIC EXECUTE 對齊 repo 慣例
-- (trigger 觸發不檢查 EXECUTE、只在 CREATE TRIGGER 當下檢查,故建完再撤安全)。
CREATE FUNCTION public.pcm_staff_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_staff_touch_updated_at() FROM PUBLIC;

CREATE TRIGGER staff_touch_updated_at
  BEFORE UPDATE ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_staff_touch_updated_at();

-- ── 4. RLS zero-policy + table ACL(client 全鎖、server 最小權限)──
-- RLS enable + 零 policy:anon/authenticated 即使誤 grant 也無 policy 可讀(縱深)。
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- 先撤 Supabase 對新表的 default-privilege re-grant(含 service_role),再精準補 server 權限。
REVOKE ALL ON TABLE public.staff FROM PUBLIC, anon, authenticated, service_role;

-- admin server 可讀名單;E8-A2 可新增/停用/改顯示名。
-- 🔴 UPDATE 走**欄級 grant**、刻意排除 id:`admin_audit_log.actor` 是 text 無 FK,
--    改 id 會讓歷史稽核列變孤兒 —— 與「不給 DELETE」是同一個目的(保稽核軌)。
--    created_at/updated_at 亦排除:前者是事實、後者由 trigger 專屬(呼叫端不得竄改)。
GRANT SELECT, INSERT ON TABLE public.staff TO service_role;
GRANT UPDATE (label, is_manager, is_active) ON TABLE public.staff TO service_role;

-- ── 5. fail-closed 斷言:schema / RLS / ACL / 欄級權限 / trigger / seed / CHECK 終態───
DO $$
DECLARE
  v_role       text;
  v_priv       text;
  v_cnt        integer;
  v_match_cnt  integer;
  v_rls        boolean;
BEGIN
  -- 4a. 表存在、恰 6 欄且型別 / NOT NULL 正確。
  IF to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION 'staff schema 異常 — public.staff 不存在;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'staff';
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'staff schema 異常 — 應恰 6 欄,實 % 欄;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'staff'
     AND (
       (column_name = 'id'         AND data_type = 'text'                     AND is_nullable = 'NO') OR
       (column_name = 'label'      AND data_type = 'text'                     AND is_nullable = 'NO') OR
       (column_name = 'is_manager' AND data_type = 'boolean'                  AND is_nullable = 'NO') OR
       (column_name = 'is_active'  AND data_type = 'boolean'                  AND is_nullable = 'NO') OR
       (column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO') OR
       (column_name = 'updated_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
     );
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'staff schema 異常 — 欄名 / 型別 / NOT NULL 未符合 6 欄合約(實 % 欄符合);拒繼續', v_cnt;
  END IF;

  -- 4b. RLS 必須啟用且 policy 恰為 0。
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'staff';
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff RLS 異常 — relrowsecurity 應為 true;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'staff';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'staff RLS 異常 — 應為 zero-policy,實 % 條 policy;拒繼續', v_cnt;
  END IF;

  -- 4c. anon / authenticated 對**全部 7 種**表權限皆為 false。
  -- 🔴 只驗 4 種是不夠的:TRUNCATE 是獨立權限,可整表清空、繞過「不給 DELETE」的保護
  --    (對齊 admin_audit_log migration 的 7 權限斷言標準)。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.staff', v_priv) THEN
        RAISE EXCEPTION 'staff ACL 異常 — client 角色 % 不應有 % 權限;拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 4d. service_role 只該有 SELECT/INSERT;DELETE/TRUNCATE/REFERENCES/TRIGGER 全不得有。
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.staff', v_priv) THEN
      RAISE EXCEPTION 'staff ACL 異常 — service_role 應有 % 權限;拒繼續', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.staff', v_priv) THEN
      RAISE EXCEPTION 'staff ACL 異常 — service_role 不得有 %(停用須走 is_active=false、且不得整表清空);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4d-2. 欄級 UPDATE:只能改 label/is_manager/is_active;id/created_at/updated_at 必須鎖死。
  -- 🔴 改 id = 歷史 admin_audit_log.actor 變孤兒,與 DELETE 同級的稽核軌破壞。
  FOREACH v_priv IN ARRAY ARRAY['label', 'is_manager', 'is_active'] LOOP
    IF NOT has_column_privilege('service_role', 'public.staff', v_priv, 'UPDATE') THEN
      RAISE EXCEPTION 'staff ACL 異常 — service_role 應可 UPDATE 欄 %;拒繼續', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['id', 'created_at', 'updated_at'] LOOP
    IF has_column_privilege('service_role', 'public.staff', v_priv, 'UPDATE') THEN
      RAISE EXCEPTION 'staff ACL 異常 — service_role 不得 UPDATE 欄 %(id 改名會斷稽核軌;時間欄非呼叫端可寫);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4d-3. updated_at trigger 必須存在且啟用;trigger 函式不得保留 PUBLIC EXECUTE。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgrelid = 'public.staff'::regclass
     AND tgname = 'staff_touch_updated_at'
     AND NOT tgisinternal
     AND tgenabled = 'O';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'staff trigger 異常 — staff_touch_updated_at 應存在且啟用(實 % 個);拒繼續', v_cnt;
  END IF;
  IF has_function_privilege('public', 'public.pcm_staff_touch_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'staff trigger 異常 — pcm_staff_touch_updated_at 不得保留 PUBLIC EXECUTE;拒繼續';
  END IF;

  -- 4e. seed 恰 3 列,且 id 集合恰為 sean / staff_1 / staff_2。
  SELECT
    count(*),
    count(*) FILTER (WHERE id IN ('sean', 'staff_1', 'staff_2'))
    INTO v_cnt, v_match_cnt
    FROM public.staff;
  IF v_cnt <> 3 OR v_match_cnt <> 3 THEN
    RAISE EXCEPTION 'staff seed 異常 — 應恰為 {sean,staff_1,staff_2},實總列數 %、命中列數 %;拒繼續',
      v_cnt, v_match_cnt;
  END IF;

  -- 4f. 3 個 CHECK 必須齊全,且未驗證數必須為 0。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.staff'::regclass
     AND contype = 'c';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'staff CHECK 異常 — 應恰有 3 個 CHECK,實 % 個;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.staff'::regclass
     AND contype = 'c'
     AND NOT convalidated;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'staff CHECK 異常 — 未驗證 CHECK 應為 0,實 % 個;拒繼續', v_cnt;
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP TRIGGER IF EXISTS staff_touch_updated_at ON public.staff;
--   DROP FUNCTION IF EXISTS public.pcm_staff_touch_updated_at();
--   DROP TABLE public.staff;
-- ============================================================
