-- 20260918050000-rollback.sql —— 退回 20260918050000_m4b_pcm_readonly_grants_into_vc.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑🛑 **本檔【刻意什麼都不做】。它一句 REVOKE 都沒有, 而那是這一片最重要的決定。**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🎯 **推論(三步, 而第三步是關鍵)**:
--   ① 正片是 **no-op** —— 實測:把已經有的權限再 GRANT 一次, `relacl` **逐字相同**。
--   ② 那 64 條(以及整個 81 條)**在正片之前就存在**。
--      🔵 **64 不是 65** —— `admin_saved_order_views` 由 Sean 2026-09-18(R2 MF2)拍甲決定
--      **不寫進正片**, 所以它也不在本檔的斷言清單裡。**而它今天仍然在正式庫上**,
--      要收它是另一片的事。📌 **本檔只管「退回正片之前」, 不管「那條該不該存在」。**
--   ③ ⇒ 「**退回到正片之前**」= **現況** ⇒ **正確的還原動作是【不動】。**
--
-- 🛑 **所以一支去 `REVOKE` 那 81 條的還原檔, 做的【不是】「退回這一片」** ——
--    它做的是**刪掉本片之前就存在的權限**。那是一個**新的破壞動作**, 不是還原。
--    🔴 而它還會順手毀掉那 **9 個欄級授權**(`pcm_settle_retry_attempts` 4 欄 /
--       `supplier_sync_runs` 5 欄)—— 那 9 條**不是本片給的**。
--       🔬 依據(2026-09-18 為板 207 實測):**表級 `REVOKE` 會連帶收掉欄級**,
--          連那個角色**從來沒有表級權限**時也照收。
--       ⇒ 📌 **GRANT 不蓋欄級、REVOKE 會收欄級 —— 同一對動作, 一邊安全一邊毀東西。**
--
-- ══ 🔴 那「我就是要收掉 pcm_readonly 的權限」怎麼辦 ═══════════════════════
-- **那是另一件事, 不是退這一片。** 要做請**另開一片**, 而且動手前先讀:
--   · 上面那條「表級 REVOKE 會連帶收掉欄級」的實測 —— 你會需要決定那 9 條要不要一起收;
--   · `supabase/rollbacks/20260917010000-rollback.sql` 的檔頭(板 207 的還原檔)——
--     那支示範了「收 pcm_readonly 的權限」要帶哪兩道閘, 以及它為什麼要求「零欄級」。
--
-- ══ 🔵 那為什麼還要有這支檔 ═══════════════════════════════════════════════
-- **因為「刻意不動」與「忘了寫」在檔案清單上長得一模一樣。**
-- 一支沒有還原檔的 migration, 下一個人看不出那是判斷過的還是漏掉的。
-- ⇒ 📌 **這支檔存在的價值, 就是把那個判斷寫下來。**
--
-- 🔵 **不用先退碼** —— 本片沒有任何碼(整支只有 GRANT)。
--    🔴 那一顆 commit 的 hash 由 **follow-up commit** 補在這裡, **不要 `--amend`**
--       (amend 會換掉 hash ⇒ 這裡釘的那一顆就不存在了)。
--    ⇒ HASH_PLACEHOLDER
--
-- 🔵 `pcm_acl_approve_latest`:**退完不用跑** —— 本檔零權限語句, ACL 一個位元都不會動。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $rb$
DECLARE v_bad text; n_tbl int; n_col int;
BEGIN
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '退回前置閘①:pcm_readonly 不存在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  -- 🔵 斷言現況 —— 本檔不改變任何東西, 它只確認「現在長得跟正片貼完之後一樣」。
  --    ⚠️ 而這道**會叫**:若有人已經手動收掉其中幾條, 那表示現況不是本檔以為的樣子
  --       ⇒ 停下讓人看, 而不是印一句「已還原」然後走掉。
  SELECT string_agg(x.o, ', ') INTO v_bad
    FROM (VALUES
  ('cron.job'),
  ('cron.job_run_details'),
  ('public.admin_audit_log'),
  ('public.admin_coupon_list_blocks_v'),
  ('public.admin_coupon_list_v'),
  ('public.admin_sso_login_events'),
  ('public.auth_callback_events'),
  ('public.brands'),
  ('public.categories'),
  ('public.coupon_redemptions'),
  ('public.coupons'),
  ('public.customer_addresses'),
  ('public.customer_favorites'),
  ('public.customer_vehicles'),
  ('public.customer_wallet_balance_check'),
  ('public.customer_wallet_ledger'),
  ('public.customers'),
  ('public.email_outbox'),
  ('public.legal_terms_versions'),
  ('public.order_cancellation_items'),
  ('public.order_cancellations'),
  ('public.order_item_procurement'),
  ('public.order_item_procurement_receipts'),
  ('public.order_item_procurement_void_requests'),
  ('public.order_item_quantity_summary'),
  ('public.order_item_receipt_requests'),
  ('public.order_items'),
  ('public.order_legal_consents'),
  ('public.order_manual_refunds'),
  ('public.order_notes'),
  ('public.order_paid_totals_v'),
  ('public.order_payments'),
  ('public.order_refund_effective_verdict'),
  ('public.order_refund_items'),
  ('public.order_refund_job_items'),
  ('public.order_refund_jobs'),
  ('public.order_refund_manual_corrections'),
  ('public.order_refunds'),
  ('public.order_status_options'),
  ('public.orders'),
  ('public.payment_charge_attempts'),
  ('public.payment_double_charge_anomalies'),
  ('public.payment_double_charge_anomaly_events'),
  ('public.payment_refund_effective_terminal'),
  ('public.payment_refund_events'),
  ('public.payment_refunds'),
  ('public.payment_webhook_events'),
  ('public.pcm_b2_shipping_idempotency'),
  ('public.pcm_shipped_email_pending'),
  ('public.pcm_shipped_email_unsendable'),
  ('public.pending_invoices'),
  ('public.product_fitments'),
  ('public.product_image_trim'),
  ('public.product_variants'),
  ('public.product_variants_public'),
  ('public.products'),
  ('public.products_list_public'),
  ('public.products_public'),
  ('public.shipment_items'),
  ('public.shipments'),
  ('public.staff'),
  ('public.suppliers'),
  ('public.sweeper_heartbeat'),
  ('public.vehicle_taxonomy_public')
         ) x(o)
   -- 🔴 R1 F8:⛔ ~~原本用 `has_table_privilege`~~ —— 那把尺在這裡沒有判別力
   --    (PUBLIC 授權或角色繼承都會讓它回 true)⇒ 有人手動收掉一條而該表對 PUBLIC 開著,
   --    它會印「什麼都沒動」而現況其實不是它斷言的樣子。改成直接問 acl 那一列。
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid = x.o::pg_catalog.regclass
        AND a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type='SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '退回斷言①:這幾條【已經不在了】⇒ 現況不是正片貼完的樣子 ⇒ 停下讓人看(本檔不會幫你補, 那是正片的事):%', v_bad;
  END IF;

  SELECT string_agg(y.t||'.'||y.c, ', ') INTO v_bad
    FROM (VALUES
  ('pcm_settle_retry_attempts','attempts'),
  ('pcm_settle_retry_attempts','gave_up_at'),
  ('pcm_settle_retry_attempts','last_attempt_at'),
  ('pcm_settle_retry_attempts','order_id'),
  ('supplier_sync_runs','completed_at'),
  ('supplier_sync_runs','id'),
  ('supplier_sync_runs','outcome'),
  ('supplier_sync_runs','started_at'),
  ('supplier_sync_runs','supplier_slug')
         ) y(t,c)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute a, LATERAL pg_catalog.aclexplode(a.attacl) g
      WHERE a.attrelid = ('public.'||y.t)::pg_catalog.regclass AND a.attname = y.c
        AND g.grantee = pg_catalog.to_regrole('pcm_readonly') AND g.privilege_type='SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '退回斷言②:這幾個【欄級】授權已經不在 ⇒ 停下讓人看:%', v_bad;
  END IF;

  SELECT count(*) INTO n_tbl FROM (
    SELECT DISTINCT c.oid FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE a.grantee = pg_catalog.to_regrole('pcm_readonly')) s;
  SELECT count(*) INTO n_col FROM pg_catalog.pg_attribute a, LATERAL pg_catalog.aclexplode(a.attacl) g
   WHERE g.grantee = pg_catalog.to_regrole('pcm_readonly');

  RAISE NOTICE '⚠️ 本檔【刻意什麼都沒做】—— 現況:pcm_readonly 有 % 個物件、% 個欄級授權, 一個都沒動。', n_tbl, n_col;
  RAISE NOTICE '   理由:那些權限【在正片之前就存在】⇒ 退回正片之前就是現況。要收掉它們是【另一件事】, 見本檔頭。';
END
$rb$;

COMMIT;
