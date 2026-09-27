-- 20260927100000_m4b_product_redirects.sql
-- M-4b · 商品舊網址轉址(Ilmberger 合卡配套;研究 ~/pcm-mailbox/研究-爬蟲流程與Ilmberger合併賣場-20260927.md §2.2 第 1 點)
-- 計畫:~/pcm-mailbox/計畫-商品舊網址轉址與舊卡下架-20260927.md
-- pcm:idempotent: no
--   理由:建新表與新 view。重貼 ⇒ 前置閘一 RAISE(已存在)。要重來先跑 rollback。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- ① product_redirects:舊 handle → 新商品 id。合卡後舊卡下架,舊網址 /products/<舊 handle> 靠它 308 到新卡。
--    · 記新商品 id 不記新 handle ⇒ 新卡之後再改 handle 也轉得對。
--    · 寫入只給 service_role(一次性腳本;沒有後台畫面)。
-- ② product_redirects_live_v:顧客站以 anon 讀。只露 old_handle / new_handle,
--    只給新卡上架中的列(新卡下架 ⇒ 舊網址回到 404,不把人轉去看不到的卡),並排除轉到自己。
--
-- ══ 權限形狀(照 20260916150000 home_banners_live_v 的前例)════════════════
-- product_redirects ⇒ anon / authenticated 零權限;service_role SELECT / INSERT / DELETE;RLS 開 + service_role SELECT 政策
-- product_redirects_live_v ⇒ security_invoker = false(view owner 讀表)+ security_barrier;anon / authenticated / service_role SELECT
--   · 選 view 而不是表開 anon 政策:ACL 快照只看表級權限(同 20260916150000 檔頭 R1 C3 的理由)
--   · view 讀 products 走 owner 權限 ⇒ 露出的只有「上架中商品的 handle」,那本來就在 products_public
--
-- ══ 貼板必附 ═══════════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260927100000):新增 1 表 + 1 view
-- 🔴 本檔先貼,顧客站那一片才合 dev(新 view ⇒ 部署時序閘會擋)
-- 🔴 貼完先驗 anon 真的讀得到 view(拋棄式 PG 是 superuser,這點沒證):
--    插一筆測試列(新商品 id 用任一上架中的商品)⇒ SET ROLE anon; SELECT * FROM public.product_redirects_live_v; ⇒ 讀得到 ⇒ 刪掉測試列
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- supabase/rollbacks/20260927100000-rollback.sql:DROP view、DROP 表(轉址列一起消失)。先 revert 顧客站那一片再跑。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.product_redirects') IS NOT NULL
     OR pg_catalog.to_regclass('public.product_redirects_live_v') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:product_redirects / product_redirects_live_v 已存在 ⇒ 貼過了或撞名, 停下(要重來先跑 rollback)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.products'::regclass AND attname IN ('handle', 'delisted_at') AND NOT attisdropped
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION '前置閘二:products.handle / delisted_at 不在';
  END IF;
END
$pre$;

-- ── 1. 表 ────────────────────────────────────────────────────────────
CREATE TABLE public.product_redirects (
  old_handle     text        PRIMARY KEY CHECK (pg_catalog.btrim(old_handle) <> '' AND pg_catalog.length(old_handle) <= 300),
  new_product_id uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_product_id uuid        REFERENCES public.products(id) ON DELETE SET NULL,
  reason         text        NOT NULL CHECK (pg_catalog.btrim(reason) <> ''),
  created_by     text        NOT NULL CHECK (pg_catalog.btrim(created_by) <> ''),
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX product_redirects_new_product_idx ON public.product_redirects (new_product_id);

COMMENT ON TABLE public.product_redirects IS
  '商品舊網址轉址(20260927100000;Ilmberger 合卡配套)。舊 handle → 新商品 id;顧客站找不到商品時經 product_redirects_live_v 查,查到就 308。寫入只給 service_role(一次性腳本)。';

ALTER TABLE public.product_redirects ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_redirects_service_role_select ON public.product_redirects
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.product_redirects FROM PUBLIC, anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.product_redirects -- 新表, 一次性合卡腳本(service_role)寫入與還原(20260927100000, Ilmberger 合卡配套)
GRANT SELECT, INSERT, DELETE ON TABLE public.product_redirects TO service_role;

-- ── 2. 前台讀的 view ────────────────────────────────────────────────
CREATE VIEW public.product_redirects_live_v WITH (security_invoker = false, security_barrier = true) AS
SELECT r.old_handle, p.handle AS new_handle
  FROM public.product_redirects r
  JOIN public.products p ON p.id = r.new_product_id
 WHERE p.delisted_at IS NULL
   AND p.handle <> r.old_handle;

ALTER VIEW public.product_redirects_live_v OWNER TO postgres;
COMMENT ON VIEW public.product_redirects_live_v IS
  '顧客站查商品舊網址要轉去哪(20260927100000)。security_invoker = false:anon 對表零權限;只露 old_handle / new_handle,只給新卡上架中的列。';

REVOKE ALL ON TABLE public.product_redirects_live_v FROM PUBLIC, anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.product_redirects_live_v -- 顧客站商品頁以 anon 讀轉址(同 home_banners_live_v 形狀)(20260927100000, Ilmberger 合卡配套)
GRANT SELECT ON TABLE public.product_redirects_live_v TO anon, authenticated, service_role;

-- ── 3. 後置閘 ────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_relations text[] := ARRAY['public.product_redirects', 'public.product_redirects_live_v']::text[];
  v_obj  text;
  v_role text;
  v_priv text;
BEGIN
  FOREACH v_obj IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(v_obj) IS NULL THEN
      RAISE EXCEPTION '後置閘零:% 沒建出來', v_obj;
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, 'public.product_redirects', v_priv) THEN
        RAISE EXCEPTION '後置閘一:% 對 product_redirects 有 %', v_role, v_priv;
      END IF;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, 'public.product_redirects', v_priv) THEN
        RAISE EXCEPTION '後置閘二:% 對 product_redirects 有欄級 %', v_role, v_priv;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_table_privilege(v_role, 'public.product_redirects_live_v', 'SELECT') THEN
      RAISE EXCEPTION '後置閘三:% 讀不到 product_redirects_live_v', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF pg_catalog.has_table_privilege(v_role, 'public.product_redirects_live_v', v_priv) THEN
        RAISE EXCEPTION '後置閘四:% 對 view 有 %', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', 'public.product_redirects', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.product_redirects', 'TRUNCATE') THEN
    RAISE EXCEPTION '後置閘五:service_role 對 product_redirects 有 UPDATE / TRUNCATE';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.product_redirects'::regclass) THEN
    RAISE EXCEPTION '後置閘六:RLS 沒開';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
