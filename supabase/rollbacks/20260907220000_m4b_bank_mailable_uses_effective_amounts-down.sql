-- 還原:把匯款兩支 view 退回「讀 orders.total / order_balance_base_v.balance_due」
-- 對應:20260907210000(建 view)+ 20260907220000(接線)
--
-- 🔴 **兩支要一起退, 而【順序有先後】**:先把 `still_mailable` 退回舊定義(它不再引用新 view),
--    才 `DROP VIEW pcm_order_effective_amounts_v` —— 反過來會因為相依而失敗。
-- 🛑 **`pcm_bank_order_created_email_pending` 不必動** —— 它是從 `still_mailable` 衍生的,
--    上游退回去它自動跟著退。**在這裡多寫一份反而會分岔。**
-- ⚠️ **退回去 = 缺陷回來**:部分取消之後, 匯款信會再度叫客人匯【未扣掉取消品項】的金額
--    (板列 ⟦auth-PAIDAMOUNTNOTFROZEN⟧ 族 B)。**退之前先確認那是你要的。**
-- 🔵 下面 `still_mailable` 的定義**逐字取自** `20260906180000_m4b_bank_order_still_mailable.sql:74-99`
--    —— 🛑 **不要憑記憶重打**:`CREATE OR REPLACE` 會把 `WITH (...)` 那組屬性整組換掉。

-- pcm:rule1-exemption: 本檔在 `supabase/rollbacks/`, 而規則① 只掃 `supabase/migrations/`
--   ⇒ 它看不到 `20260906180000_m4b_bank_order_still_mailable.sql:74` 那個【既有】定義,
--     於是把這支重定義誤判成新物件。🔬 實查:`CREATE VIEW public.pcm_bank_order_still_mailable`
--     在 `supabase/migrations/` 命中 **1** 支 ⇒ **它不是新物件, `OR REPLACE` 是對的寫法。**
--   🛑 **而這是【閘的射程】不是【我的例外】** —— 具名在這裡, 是為了讓下一個寫還原檔的人
--     直接看到成因, 而不是又花一輪去查自己是不是寫錯了。
BEGIN;

CREATE OR REPLACE VIEW public.pcm_bank_order_still_mailable
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.created_at         AS created_at,
  o.total              AS total,
  bal.balance_due      AS balance_due,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
JOIN public.order_balance_base_v bal ON bal.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_channel = 'bank_transfer'
  AND o.payment_status  = 'unpaid'
  AND o.cancelled_at IS NULL
  AND o.order_source = 'web'
  AND o.manual_request_id IS NULL
  AND bal.balance_due IS NOT NULL
  AND bal.balance_due > 0
  AND bal.balance_due <= o.total
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

DROP VIEW IF EXISTS public.pcm_order_effective_amounts_v;

DO $postcheck$
DECLARE
  -- 收權斷言清單(`migration-static-checks.sh` 第③格用它比對可授權物件數)
  --   public.pcm_bank_order_still_mailable ⇒ service_role SELECT;anon/authenticated 零權限
  -- 🔵 本檔的 `CREATE OR REPLACE` 是**重定義既有 view**(它在 `20260906180000` 就存在),
  --    不是新物件 ⇒ 那道閘的規則①不適用;而 ACL 不隨 REPLACE 重設, 這裡仍然驗一次兩個方向。
  v_relations text[] := ARRAY[
    'public.pcm_bank_order_still_mailable'
  ]::text[];
  v_rel  text;
  v_def  text;
BEGIN
  -- ① 真的退回去了嗎(不是「view 還在」——【一個沒退成功的世界會印同一個綠】)
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_still_mailable'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'pcm_order_effective_amounts_v') <> 0 THEN
    RAISE EXCEPTION '還原閘①:still_mailable 仍引用 pcm_order_effective_amounts_v ⇒ 沒退成功';
  END IF;
  -- ② 新 view 真的不見了(🟢 正對照:下面那格證明這把尺會動)
  IF to_regclass('public.pcm_order_effective_amounts_v') IS NOT NULL THEN
    RAISE EXCEPTION '還原閘②:pcm_order_effective_amounts_v 還在';
  END IF;
  -- 🟢 正對照:一個【本來就該在】的物件要查得到, 否則上面兩個 NULL 可能是尺壞了
  IF to_regclass('public.pcm_bank_order_still_mailable') IS NULL THEN
    RAISE EXCEPTION '還原閘③:連 still_mailable 都查不到 ⇒ 這把尺壞了, 上面兩格不算數';
  END IF;
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '還原閘④:% 的 service_role 讀不到 ⇒ REPLACE 把權限弄掉了', v_rel;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '還原閘⑤:% 的 anon/authenticated 讀得到', v_rel;
    END IF;
  END LOOP;

  RAISE NOTICE '還原閘通過(五格:①不再引用 ②新 view 已消失 ③正對照 still_mailable 仍在 ④⑤權限兩向)';
END
$postcheck$;

COMMIT;
