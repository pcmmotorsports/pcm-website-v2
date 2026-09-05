-- 貼板對帳:20260905270000 ⟦b9-ACLDRIFT5⟧ 收尾(SQL Editor 版, 零 psql meta-command)
-- 🔴 本檔會【紅】, 不是只印數字。成功 = 沒有紅色 + 最後一行 NOTICE。
-- 🔬 貼前實量(2026-09-05 唯讀):service_role 在 pcm_acl_drift_status 上
--    = MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE(五種)⇒ 貼後應為恰好 SELECT。
-- 🛑 證不到:別的物件有沒有同樣的殘留(全庫普查不在本片射程);
--    也證不到那個【機制】修好了 —— 下一個 postgres 在 public 建的物件照樣自帶 Dxtm。
DO $$
DECLARE
  v_txt text;
  v_n   integer;
BEGIN
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '① 這台庫沒有 service_role ⇒ 本檔的對象不是這台庫';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_acl_drift_status') IS NULL THEN
    RAISE EXCEPTION '② 找不到 public.pcm_acl_drift_status ⇒ 20260905170000 沒貼';
  END IF;

  -- ⓐ service_role 恰好 SELECT, 且不得帶 GRANT OPTION
  SELECT pg_catalog.string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type)
         || CASE WHEN pg_catalog.bool_or(a.is_grantable) THEN '(帶 GRANT OPTION)' ELSE '' END
    INTO v_txt
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('service_role');
  IF v_txt IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'ⓐ 失敗:service_role 的權限集合是「%」, 期望恰好 SELECT(貼前是五種)', COALESCE(v_txt,'(一格都沒有)');
  END IF;

  -- ⓑ 有效權限那把尺:SELECT 在, 七種寫權全不在
  IF NOT pg_catalog.has_table_privilege('service_role','public.pcm_acl_drift_status','SELECT') THEN
    RAISE EXCEPTION 'ⓑ 失敗:service_role 讀不到 ⇒ 告警端拿不到漂移狀態';
  END IF;
  SELECT pg_catalog.string_agg(p.priv, ',') INTO v_txt
    FROM (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.has_table_privilege('service_role','public.pcm_acl_drift_status',p.priv);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ⓑ2 失敗:service_role 還有寫類權限 ⇒ %', v_txt;
  END IF;

  -- ⓒ 🟢 正對照:同一把尺問 owner ⇒ 必須八種(少了它, 一把「對誰都回空」的壞尺會讓 ⓐ 通過)
  SELECT pg_catalog.count(DISTINCT a.privilege_type) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND a.grantee = pg_catalog.to_regrole('postgres');
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'ⓒ 正對照失敗:owner 只數到 % 種(期望 8)⇒ 上面那些結論沒有判別力', v_n;
  END IF;

  -- ⓓ 四個應用角色 + PUBLIC 仍是零(17 那支收的那幾道還在)
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status'
     AND (a.grantee = 0
          OR a.grantee IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'),
                           pg_catalog.to_regrole('payment_confirmer')));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ⓓ 失敗:PUBLIC / anon / authenticated / payment_confirmer 上有 % 筆授權', v_n;
  END IF;

  -- ⓔ 底下那張表仍只有 owner(本片一個字都沒動它 —— 這一格是「我有沒有動到不該動的」)
  SELECT pg_catalog.string_agg(a.grantee::regrole::text, ',') INTO v_txt
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_snapshot_digest'
     AND a.grantee <> pg_catalog.to_regrole('postgres');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ⓔ 失敗:底表 pcm_acl_snapshot_digest 上出現 owner 以外的 grantee ⇒ %', v_txt;
  END IF;

  RAISE NOTICE '✅ 270000 對帳全過(ⓐ service_role 恰 SELECT ⓑ/ⓑ2 有效權限雙向 ⓒ 正對照 owner=8 ⓓ 四角色+PUBLIC 零 ⓔ 底表未被動到)';
END $$;
