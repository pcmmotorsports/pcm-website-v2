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
  CONSTRAINT staff_label_nonempty CHECK (label <> '')
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

-- ── 3. RLS zero-policy + table ACL(client 全鎖、server 最小權限)──
-- RLS enable + 零 policy:anon/authenticated 即使誤 grant 也無 policy 可讀(縱深)。
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- 先撤 Supabase 對新表的 default-privilege re-grant(含 service_role),再精準補 server 權限。
REVOKE ALL ON TABLE public.staff FROM PUBLIC, anon, authenticated, service_role;

-- admin server 可讀名單;E8-A2 可新增/編輯/停用。刻意不給 DELETE,停用一律 is_active=false。
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff TO service_role;

-- ── 4. fail-closed 斷言:schema / RLS / ACL / seed / CHECK 終態───
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

  -- 4c. anon / authenticated 對 SELECT/INSERT/UPDATE/DELETE 全為 false。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'public.staff', v_priv) THEN
        RAISE EXCEPTION 'staff ACL 異常 — client 角色 % 不應有 % 權限;拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 4d. service_role 必須有 SELECT/INSERT/UPDATE,且不得有 DELETE。
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.staff', v_priv) THEN
      RAISE EXCEPTION 'staff ACL 異常 — service_role 應有 % 權限;拒繼續', v_priv;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.staff', 'DELETE') THEN
    RAISE EXCEPTION 'staff ACL 異常 — service_role 不得有 DELETE(停用須走 is_active=false);拒繼續';
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
--   DROP TABLE public.staff;
-- ============================================================
