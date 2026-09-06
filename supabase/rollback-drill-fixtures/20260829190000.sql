-- 資料相依演練的測資:一列 source_app='ops'
--
-- 🔴 **測資是我造的 ⇒ 它會長成我要的形狀** ——(memory `feedback_my-fixture-drifts-toward-my-conclusion`)
--   所以每一行都要指得出它對應正式碼的哪一行:
--   · `source_app = 'ops'` ⇒ 對應 `supabase/migrations/20260829190000_...sql:34`
--       逐字 `CHECK (source_app IN ('admin', 'quote', 'ops'));` —— 'ops' 就是本支放行的那個新值。
--   · 欄位清單 ⇒ 對應同檔 `:72` 的 INSERT 逐字 `(actor, action, request_id, source_app)`。
INSERT INTO public.admin_audit_log (actor, action, request_id, source_app)
VALUES ('rollback-drill', 'drill-probe', gen_random_uuid()::text, 'ops');
