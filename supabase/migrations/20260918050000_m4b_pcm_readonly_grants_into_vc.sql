-- 20260918050000_m4b_pcm_readonly_grants_into_vc.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· 版本號由主視窗 pcm-website-v2-71 指定
-- Sean 2026-09-18 **Q1 拍甲**(補一支把現況寫進版控)+ **Q2 拍甲**(登入紀錄那條留著、寫明理由)
-- plan: docs/plans/2026-09-18-pcm-readonly-grants-into-version-control-plan.md(主視窗批)
--
-- ══ 🛑 這片【不是】什麼 ═══════════════════════════════════════════════════
-- · **不是**收掉誰的權限 —— 它一句 REVOKE 都沒有。
-- · **不是**安全事故處置 —— 那 81 條**全部只有 SELECT**、`is_grantable` 全 false
--   ⇒ 那個角色讀得到, 而**寫不了、也不能把權限轉給別人**。
-- · **不是**「這個角色不該讀錢的表」—— 它**就是拿來查帳的唯讀角色**。
-- 🔴 **真正的問題只有一個:沒有地方記著「誰決定給的」, 而現有的漂移尺看不到它。**
--
-- ══ 🎯 本片是 no-op —— 而那正是它最危險的地方 ═══════════════════════════
-- 🔬 拋棄式 PG 17.10 實測:**把已經有的權限再 GRANT 一次, relacl 逐字相同**(no-op)。
-- ⇒ 📌 **所以「貼完之後那 61 條都在」這個斷言【恆真】** ——
--    它在「本檔真的寫了 61 句」與「本檔是空的」兩個世界印同一個東西。
-- ⇒ ✅ 所以驗收**一定要有會叫的負對照**:拋棄式 PG 上先 REVOKE 掉一條再貼, 它必須補回來。
--    🔴 **而欄級要【單獨再做一次】**(主視窗點名這是本片最重要的驗收):
--       「只寫表級」與「表級+欄級都寫」在貼完之後的 `relacl` 上**看起來差不多**,
--       差別只在 `attacl` ⇒ **沒有那一發, 本片可能少寫 9 條而全綠。**
--
-- ══ 🔴 那 9 個欄級【必須具名寫】, 而這是實測證的 ═══════════════════════════
-- 🔬 只給欄級 `a` ⇒ 再下**表級** GRANT ⇒ 欄 `a` 的 `attacl` **原封不動**
-- ⇒ 📌 **表級 GRANT 不涵蓋欄級** ⇒ 少寫那 9 句, 它們**不會**被寫進去,
--    而**下一個人會以為寫完了**。
-- 🎯 **而它與 REVOKE 是不對稱的**(同一天為板 207 量的):
--       GRANT  **不蓋**欄級  ✅
--       REVOKE **會收**欄級  🔴(連那個角色從來沒有表級權限時也照收)
--    ⇒ **同一對動作, 一個方向安全、另一個方向會毀掉別人的東西。** 本片走的是安全那個方向。
--
-- ══ 🔵 鎖:量過了, 而且量法有對照組 ═════════════════════════════════════════
-- 🔬 拋棄式 PG 17.10, 同一發四種動作四個答案 ⇒ **尺是準的, 不是對什麼都回同一句**:
--       GRANT        ⇒ **目標表零筆鎖**(它只碰 pg_class 與其索引)
--       COMMENT ON   ⇒ ShareUpdateExclusiveLock
--       ALTER TABLE  ⇒ AccessExclusiveLock
--       SELECT       ⇒ AccessShareLock
-- 🛑 **而我沒有停在「查 pg_locks 沒看到」** —— 那句話可能只是「我查錯地方」。
--    ⇒ 行為測試:一條連線 `BEGIN; GRANT …;` 掛著不 COMMIT, 另一條去動那張表
--      ⇒ **讀得到、也寫得進去**。
--    ⚪ 而對照組:同一招換成 `ALTER TABLE ADD COLUMN` ⇒ **當場被擋(逾時)**
--      ⇒ 📌 **沒有那一格, 上面兩個「不擋」分不出【真的不擋】與【我的測法對什麼都說不擋】。**
-- ⇒ ✅ **本片不會擋到線上任何查詢或寫入** ⇒ 貼板時機不是問題。
--
-- ══ 🔴 兩條在 `cron` schema, 而 postgres 不是它們的 owner —— 查過才寫 ═══════
-- `cron.job` / `cron.job_run_details` 的 owner 是 **`supabase_admin`**,
-- 而 `pg_has_role('postgres','supabase_admin','MEMBER')` = **f**、`rolsuper` = **f**。
-- 🔬 **而 postgres 對它們有【轉授權】**:`is_grantable = t`(由 supabase_admin 給的)
--    ⇒ **GRANT 得動。** 下面前置閘⑤ 會在貼之前再確認一次。
-- 🟢 正對照:同一把尺問 postgres **自己擁有**的 `order_payments` ⇒ `is_grantable = f`
--    (擁有者不需要轉授權)⇒ **那一欄真的有意義, 不是恆 t。**
-- 🛑 **而這與 2026-09-05 那件 storage 的事【正好相反】** —— 那次 postgres 對
--    `storage.*` **零權限**, 三行 REVOKE 一行都收不掉。
--    ⇒ 📌 **不是所有平台管的表都一樣。每一張都要自己問一次。**
--
-- ══ 範圍:那 65 條裡【寫下 61 條】 ═══════════════════════════════════════════
-- 🔴 **「沒有版控出處」的是 65 條**(2026-09-18 正式庫實查, Sean Q1 拍甲 = 只寫這 65)。
-- 🔴 **而本片實際只寫 61 句** —— `admin_saved_order_views` 由 **Sean 2026-09-18 R2 MF2 拍甲**
--    決定**不寫**(理由整段在下面第 2 節那一行原本的位置, 不在檔頭 ——
--    📌 **更正與決定要落在讀者會走到的地方**)。
--    ⇒ 🛑 **「沒寫進來」不等於「線上沒有」** —— 那條授權今天仍然在正式庫裡,
--      要收它是**另一片**的事(REVOKE ⇒ 鐵則 8 ⇒ 先 plan 等 Sean 批)。
-- 🔴 **不寫 81 條全集**(Sean Q1 拍甲)。理由:
--    寫全集會造出**兩份會各自漂移的副本** —— 哪天有人用別的片收掉那 16 條之一,
--    這份清冊還寫著它。📌 **今天所有的病都是「同一件事有兩份副本」造成的,
--    不要在治它的那一片裡再造一份。**
--
-- ⛔ ~~另外那 **17** 條~~ 🔴🔴 **2026-09-19 更正:是 16,不是 17。舊字面留著不刪。**
--   🔬 **錯在哪**:檔頭原本寫「沒有版控出處的是 65 條」+「另外那 17 條」= **82**,
--     而線上表級 SELECT 是 **81** ⇒ **那個算術差 1,而它寫在檔頭四個月沒人算過。**
--     (窗A 2026-09-19 獨立核板 050000 時發現;我複核並補了第三把尺。)
--   ✅ **三把獨立的尺,三把都給 16**:
--     ① **算術**:81 − (61 寫下 + 4 刻意不寫) = **16**
--     ② **repo 實 grep**(排除本片)⇒ 相異物件 **16 個**
--     ③ 🔵 **而這一把才是讓那個加法【合法】的** ——
--        本片寫下的 61 個 ∩ 另外那 16 個 = **0**(交集為空)
--        📌 **沒有③, 「61 + 16」只是兩個數字湊得起來;有了它, 那個加法才成立。**
--   ⚠️ 窗A 自己標了「**兩把尺同意不等於證明**」—— 對, 而它們同意的是【總數】;
--     ③ 問的是【能不能相加】。**那是兩個不同的問題。**
--
-- 🔵 **那 16 個是哪些(2026-09-19 實 grep, 排除本片)—— 名字寫出來, 不要只留一個數字**:
--    `admin_order_list_v` · `fx_rates` · `home_banners` · `order_amount_requests`
--    `order_item_costs` · `order_pending_refunds` · `orders_deleted_log`
--    `pcm_acl_drift_status` · `pcm_acl_snapshot_digest` · `pcm_net_exposure_snapshot`
--    `product_fitments_effective` · `product_fitments_effective_staging`
--    `product_fitments_effective_sync_log` · `search_queries`
--    `shipment_order_ship_clearances` · `supplier_inbound_emails`
--    🛑 **寫名字不寫數字, 是因為【一個沒有出處的數字換成另一個沒有出處的數字】,**
--    **下一個人一樣不敢用。** 上面這串可以當場 grep 回去核。
--    🔵 `order_item_costs` 在裡面 ⇒ 與「它有出處、所以不在本片那 65 條裡」一致。
-- 🔴🔴 **而「完整現況」的真相源是【正式庫本身】, 不是任何一個檔** ——
--    要看完整的, **查庫, 不要查檔**。任何檔都只是某一次的快照。
--
-- ══ 🔴 還原:本檔的還原是【什麼都不做】, 而那是刻意的 ═══════════════════════
-- `supabase/rollbacks/20260918050000-rollback.sql` —— 它只斷言現況然後結束, 一句 REVOKE 都沒有。
-- 理由(推論寫在那支檔頭, 這裡只放結論):本片是 no-op、那 81 條**在本片之前就存在**
-- ⇒ 「退回本片之前」**就是現況** ⇒ 正確的還原動作是**不動**。
-- 🛑 一支去 REVOKE 那 81 條的還原檔, 做的**不是**「退回本片」,
--    是**刪掉本片之前就存在的權限** —— 那是一個新的破壞動作, 而且會順手毀掉那 9 個欄級。
--
-- ══ pcm_acl_approve_latest ═════════════════════════════════════════════════
-- 🔴 **本片【要跑】** —— 它是本檔頭第一個與別片不同的地方:前幾片都零權限語句,
--    而**本片整支都是 GRANT**。⇒ 貼完同批跑 `pcm_acl_approve_latest`(p_note 帶本支版本號)。
--    ⚠️ 而實際上 ACL **一個位元都不會變**(no-op)⇒ 摘要那一側**本來就不會叫**;
--       跑它是照房規、不是因為有漂移。**這兩件事不一樣, 寫清楚。**

-- ══ 🔴 一條判別句, 本片自己踩過兩次 ═══════════════════════════════════════
-- **同一支檔裡兩道閘用【不同嚴格度】, 本身就是該停下來看的訊號。**
-- 🔬 本片的實例(R1 F6):後置② 我用 `aclexplode(attacl)` 直接問 acl 那一列,
--    並在旁邊寫明「`has_column_privilege` 在這裡沒有判別力(表級權限也會讓它回 true)」——
--    **而同一支檔的後置① 我用的就是 `has_table_privilege`**(PUBLIC 授權或角色繼承都會讓它回 true)。
--    ⇒ 📌 **我在同一支檔裡親手否定過的毛病, 隔 60 行自己犯了一次。**
-- 🔴 **而上面那句原本寫的是「已改成同一把尺」—— 那句當時是【假的】**:
--    R1 只改了後置①, 而**前置閘④(`:272` 一帶)還留著 `has_table_privilege`**,
--    也就是**這一輪新加的那道 fail-closed 閘的【入口】用的仍是被判死的尺**。
--    R2(MF1)抓到才補。⇒ 📌 **「已改成 X」這種完成式, 本身就要當成一個待驗的宣稱。**
-- 🔵 同族:2026-09-18 板 213 的「同一支檔五道用 `IS DISTINCT FROM`、第六道換 `NOT IN`」。
--
-- ══ 🔴🔴 為什麼那 20 格拋棄式 PG【證不到】MF1 —— 今天新的一種形狀 ═══════════
-- **測試世界比真實世界【乾淨】, 所以兩把尺的差別在那裡消失。**
--   拋棄式 PG 上沒有 PUBLIC 授權、沒有角色繼承 ⇒ `has_table_privilege` 與 acl 尺
--   **答案永遠一樣** ⇒ 那一發**沒有判別力**, 它恆綠, 而恆綠看起來跟通過一模一樣。
-- 🔵 同一天的近親(同族第二次):拋棄式 PG 沒有複製出 `cron` 那兩張表的 owner 形狀
--   (正式庫 owner 是 `supabase_admin`, postgres 靠轉授權才 GRANT 得動)⇒ 前置閘⑤ 的
--   真實失敗模式在測試世界裡構造不出來。
-- ⇒ 📌 **判別句:這一格如果在正式庫上會不一樣, 那我在拋棄式 PG 上量到的是什麼?**
--    ⇒ 凡是量【權限可見性】或【owner / 轉授權形狀】的格子, 一律在旁邊標
--      「這一格在拋棄式 PG 上恆綠, 它證不到真實庫的形狀」, 不要讓它算進通過的分子。
--
-- ══ ⚠️ 本檔必須【整支在同一個 transaction 裡】跑(R1 F9)═══════════════════
-- 後置閘用 `current_setting(..., true)` 讀前置閘用 `set_config(..., true)` 存的值,
-- 而那個 `true` 是 **transaction-local**。
-- ⇒ 🔴 若有人把 `BEGIN` / `COMMIT` 剝掉、逐句 autocommit 地跑, 兩道閘會壞在**相反的方向**
--    ——(R2 C1:原本這裡只寫了「誤擋」那半, 那句**不完整**):
--    · 閘③(`pcm.svc_pre`)讀到 NULL ⇒ **誤擋** ⇒ fail-closed, 吵但安全。
--    · 🔴 **閘④ 那道 regrant 閘讀到 NULL ⇒ 【不擋】** —— 它第一個條件就是 `IS NOT NULL`,
--      NULL 直接短路 ⇒ **靜靜放行**。而 autocommit 下 GRANT 已經逐句 commit 掉、**回不去**,
--      最後停在閘③ 那句 service_role 的訊息 ⇒ 📌 **錯誤訊息會指向錯的地方。**
-- ⇒ ✅ 整檔貼進 SQL Editor(本 repo 的貼板方式)沒有這個問題。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE v_missing text;
BEGIN
  -- ① 角色在
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '前置閘①:pcm_readonly 這個角色不存在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  -- ② 🔴 **本片要 GRANT 的 61 個物件都還在** —— 少一個, 貼到一半會炸而前面已經生效。
  SELECT string_agg(x.o, ', ') INTO v_missing
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
   WHERE pg_catalog.to_regclass(x.o) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:這幾個物件不存在了 ⇒ %', v_missing;
  END IF;

  -- ③ 🔴 欄級要 GRANT 的 9 欄都還在(欄被 drop / rename 會讓那 2 句炸)
  SELECT string_agg(y.t||'.'||y.c, ', ') INTO v_missing
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
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = ('public.'||y.t)::pg_catalog.regclass
                        AND a.attname = y.c AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:這幾欄不存在了(被 drop 或 rename)⇒ %', v_missing;
  END IF;

  -- ④ 🔵 本片是 no-op 的前提:那 61 條【現在就已經給過了】。
  --    ⚠️ 這一道**刻意只印 NOTICE 不擋** —— 因為「其中一條被收掉了」正是
  --       本片應該把它補回來的情況(也是驗收用的負對照)。擋下來就測不到了。
  SELECT string_agg(x.o, ', ') INTO v_missing
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
   -- 🔴 R2 MF1:原本這裡是 `has_table_privilege('pcm_readonly', x.o, 'SELECT')`
   --    —— 而**同一支檔 §「一條判別句」那一段, 我親手把這把尺判死過**
   --    (PUBLIC 授權或角色繼承都會讓它回 true), 然後隔 190 行在【這一輪新加的那道閘的入口】
   --    自己又用了一次。⇒ 📌 **本片對這個毛病, 一支檔裡犯了兩次。**
   --    破壞路徑:某張表對 PUBLIC 開著 ⇒ 有人把 pcm_readonly 的表級 SELECT 收掉
   --      ⇒ 這道閘仍回 true ⇒ `pcm.regrant_missing` 是空的 ⇒ 本片**靜靜補回去**
   --      ⇒ 後置①(acl 尺)因為剛補完所以綠 ⇒ **COMMIT, 而檔頭仍宣稱 no-op**。
   --    ✅ 改成與後置① 逐字同一段 acl 尺:GRANT 改變的就是 acl 那一列, 量它才對得上「no-op」這個宣稱。
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid = x.o::pg_catalog.regclass
        AND a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type='SELECT');
  IF v_missing IS NOT NULL THEN
    -- 🔴 R1 F4:原本只印 NOTICE ⇒ 那是一道 **fail-open 的權限閘**。
    --    貼板當下若有任何一條【已經被人收掉】, 本片會**靜靜補回去**,
    --    而唯一的告知是 NOTICE —— 而 repo 對這條通道**早有結論**:
    --      板 51 `20260906380000:57` 逐字「**本片刻意不靠 RAISE NOTICE**」;
    --      `20260826150000:547` 逐字「SQL Editor 這條路上…**NOTICE 至少不在可複製的那半**」。
    --    ⇒ 🔴 而檔頭逐字宣稱「ACL 一個位元都不會變」——
    --       **那句話只在「中間沒人動過」時為真, 而原本的設計恰恰是「動過也照跑」。**
    --    ✅ 改法:照舊不擋(負對照才測得到), 但把清單交給後置, 由後置決定要不要擋。
    PERFORM pg_catalog.set_config('pcm.regrant_missing', v_missing, true);
    RAISE NOTICE '🔵 這幾條現在【沒有】:%  ⇒ 要讓本片補回去, 請先 SET pcm.allow_regrant = %L', v_missing, 'yes';
  ELSE
    RAISE NOTICE '✅ 前置閘④:那 61 條現在都已經給過了 ⇒ 本片是 no-op(預期結果)。';
  END IF;

  -- ⑤ 🔴 `cron` 那兩張的 owner 是 supabase_admin, 而 postgres 靠【轉授權】才 GRANT 得動。
  --    轉授權若被收走 ⇒ 那兩句會在貼到一半時炸 ⇒ 先擋。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
                        LATERAL pg_catalog.aclexplode(c.relacl) a
                  WHERE n.nspname='cron' AND c.relname IN ('job','job_run_details')
                    AND a.grantee = pg_catalog.to_regrole('postgres')
                    AND a.privilege_type='SELECT' AND a.is_grantable
                  GROUP BY 1 HAVING count(DISTINCT c.relname) = 2) THEN
    -- 🔴 R1 F5:原本只問了 `job` 一張, 而註解與成功訊息都寫「那【兩張】」
    --    ⇒ 📌 **那道閘沒有做它宣稱的事。** 現在兩張都要有, 數到 2 才過。
    RAISE EXCEPTION '前置閘⑤:postgres 對 cron.job / cron.job_run_details 【兩張都要】有可轉授的 SELECT, 而現在不是 ⇒ 下面那兩句 GRANT 會炸 ⇒ 停下';
  END IF;

  -- ⑥ 🔵 把 service_role 貼前的物件數存起來 ⇒ 後置比同一個數(量的才是【本片有沒有越界】)
  PERFORM pg_catalog.set_config('pcm.svc_pre',
    (SELECT count(*)::text FROM (
       SELECT DISTINCT c.oid FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
        WHERE a.grantee = pg_catalog.to_regrole('service_role')) s), true);

  RAISE NOTICE '✅ 前置閘全過:角色在 · 61 個物件在 · 9 欄在 · cron 轉授權在';
END
$pre$;

-- ── 2. 動作:把現況原樣寫下來(61 句表級 —— 65 減掉刻意不寫的 4 張:`admin_saved_order_views` + 下面那三張)────────────────────────
-- 🔵 理由**照族寫, 不一條一句** —— 一條一句會產出一份沒有人讀得完的東西。
--    共用的理由是:**這是一個查帳用的唯讀角色, 這些是它查帳時要看的東西。**

-- ── 排程與系統(4 條)─────────────────────────────────────────────
--    查帳的人要答「那支排程今天到底有沒有跑」—— 那個答案只在 cron 這兩張與心跳表裡。
GRANT SELECT ON TABLE cron.job TO pcm_readonly;
GRANT SELECT ON TABLE cron.job_run_details TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_b2_shipping_idempotency TO pcm_readonly;
GRANT SELECT ON TABLE public.sweeper_heartbeat TO pcm_readonly;

-- ── 訂單主幹(11 條 —— 原 13, 減掉下面那兩張取消表)─────────────────────────────────────────────
--    查帳的起點。一張單的品項、取消、採購、到貨、備註都在這一族。
--
-- ── 🔴🔴 這三張【刻意不在這裡】(Sean 2026-09-18 夜 Q1 拍甲)──────────────────
-- ⛔ ~~本片原本有這三句:~~
-- ⛔ ~~`GRANT SELECT ON TABLE public.order_cancellation_items TO pcm_readonly;`~~
-- ⛔ ~~`GRANT SELECT ON TABLE public.order_cancellations TO pcm_readonly;`~~
-- ⛔ ~~`GRANT SELECT ON TABLE public.payment_charge_attempts TO pcm_readonly;`~~
--    **舊字面留著不刪**(本檔對 `admin_saved_order_views` 用的是同一個規矩)。
--
-- 🎯 **為什麼拿掉 —— 與 `admin_saved_order_views` 是【同一個形狀的第二次】**:
--    **補出處, 就是給理由。** 把它們寫進版控, 就等於把「查帳帳號讀得到付款扣款紀錄與訂單取消」
--    追認成**有理由、被批准**的事。⇒ 📌 **而這一次有人先停下來問了。**
--
-- 🔬 **是一道【測試】把它叫出來的, 不是有人想到**:
--    `scripts/a9g2-charge-attempts-grant-guard.test.ts` —— 它守的不變量是
--    「這三張表在全庫 migration 裡只准有**那一句** `TO service_role` 的 GRANT」。
--    本片把第二句寫進去 ⇒ 三格當場紅。
--    🛑 **而它是【跨檔清冊型】測試** ⇒ 本窗只跑自己動到的檔的三綠**全綠**,
--       主視窗合起來跑 `pnpm test` 才叫(鐵則 11)。
--
-- 🔴 **那道守門為什麼不是誤報 —— 它是【提早一步】叫的**(2026-09-18 唯讀正式庫實查):
--      這三張表 RLS enable + **對 `pcm_readonly` 適用的 policy 是 0 條**
--      (那 1 條是 `TO service_role`)。
--      · 今天 `pcm_readonly` `rolbypassrls = t` ⇒ **讀得到真的列** ⇒ 今天沒有 fail-open。
--        ⚪ 判別力對照:`anon` = f / `authenticated` = f ⇒ **那把尺會動, 不是對誰都回 t**。
--      · 🔴 **而哪天拿掉它的 BYPASSRLS, 它當場讀到【空陣列且不報錯】** ——
--        而「拿掉 BYPASSRLS」正是這條線在做的事(`20260904270000` 檔頭逐字)。
--    ⇒ 📌 **這條授權離那個洞只有一個角色屬性。**
--
-- 🛑 **「沒寫進來」不等於「線上沒有」** —— 這三條授權今天仍然在正式庫裡。
--    要收它們是**另一片**的事:`20260918060000`(REVOKE 片)⇒ 鐵則 8 ⇒ plan + Sean 批了才貼。
--
-- 🔵 **而第四張 `order_item_costs`(Sean 同夜 Q2 拍甲也要收)【不在本片的範圍裡】** ——
--    本片寫的是「**沒有版控出處**」的那 65 條, 而 `order_item_costs` 的那條授權
--    **有出處**:`20260914010000_m4b_order_item_costs.sql:109` 逐字
--    `GRANT SELECT ON TABLE public.order_item_costs TO pcm_readonly;`
--    (帳本 `supabase/APPLIED.tsv:644`, 2026-09-14 已貼)。
--    ⇒ 📌 **所以它在本片裡【本來就沒有東西可以拿掉】** —— 它只會出現在 REVOKE 片。
--    🛑 不要因為 Sean 說「四張」就以為本片少改了一張。**四張裡本片碰得到的只有三張。**
--
GRANT SELECT ON TABLE public.order_item_procurement TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_procurement_receipts TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_procurement_void_requests TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_quantity_summary TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_receipt_requests TO pcm_readonly;
GRANT SELECT ON TABLE public.order_items TO pcm_readonly;
GRANT SELECT ON TABLE public.order_legal_consents TO pcm_readonly;
GRANT SELECT ON TABLE public.order_notes TO pcm_readonly;
GRANT SELECT ON TABLE public.order_paid_totals_v TO pcm_readonly;
GRANT SELECT ON TABLE public.order_status_options TO pcm_readonly;
GRANT SELECT ON TABLE public.orders TO pcm_readonly;

-- ── 收款 / 退款(15 條 —— 原 16, 減掉 `payment_charge_attempts`)─────────────────────────────────────────────
--    錢本身。「收了多少 / 退了多少 / 哪一筆卡住」全部要跨這幾張對。
GRANT SELECT ON TABLE public.order_manual_refunds TO pcm_readonly;
GRANT SELECT ON TABLE public.order_payments TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refund_effective_verdict TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refund_items TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refund_job_items TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refund_jobs TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refund_manual_corrections TO pcm_readonly;
GRANT SELECT ON TABLE public.order_refunds TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_double_charge_anomalies TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_double_charge_anomaly_events TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_refund_effective_terminal TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_refund_events TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_refunds TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_webhook_events TO pcm_readonly;
GRANT SELECT ON TABLE public.pending_invoices TO pcm_readonly;

-- ── 出貨(4 條)─────────────────────────────────────────────
--    「錢收了而東西出了沒」要對得起來, 以及出貨信寄了沒。
GRANT SELECT ON TABLE public.pcm_shipped_email_pending TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_shipped_email_unsendable TO pcm_readonly;
GRANT SELECT ON TABLE public.shipment_items TO pcm_readonly;
GRANT SELECT ON TABLE public.shipments TO pcm_readonly;

-- ── 商品 / 分類(11 條)─────────────────────────────────────────────
--    訂單上的品項要對得回商品與品牌, 否則查出來的是一串料號。
GRANT SELECT ON TABLE public.brands TO pcm_readonly;
GRANT SELECT ON TABLE public.categories TO pcm_readonly;
GRANT SELECT ON TABLE public.product_fitments TO pcm_readonly;
GRANT SELECT ON TABLE public.product_image_trim TO pcm_readonly;
GRANT SELECT ON TABLE public.product_variants TO pcm_readonly;
GRANT SELECT ON TABLE public.product_variants_public TO pcm_readonly;
GRANT SELECT ON TABLE public.products TO pcm_readonly;
GRANT SELECT ON TABLE public.products_list_public TO pcm_readonly;
GRANT SELECT ON TABLE public.products_public TO pcm_readonly;
GRANT SELECT ON TABLE public.suppliers TO pcm_readonly;
GRANT SELECT ON TABLE public.vehicle_taxonomy_public TO pcm_readonly;

-- ── 客人 / 券 / 儲值金(11 條)─────────────────────────────────────────────
--    「這筆錢是誰的、用了什麼券、儲值金動過沒」—— 對帳必經。
GRANT SELECT ON TABLE public.admin_coupon_list_blocks_v TO pcm_readonly;
GRANT SELECT ON TABLE public.admin_coupon_list_v TO pcm_readonly;
GRANT SELECT ON TABLE public.coupon_redemptions TO pcm_readonly;
GRANT SELECT ON TABLE public.coupons TO pcm_readonly;
GRANT SELECT ON TABLE public.customer_addresses TO pcm_readonly;
--    ⬇️ 🔴 **這一條的理由【不在上面那一句】** —— 它與 `customers` 是**同一則推翻舊拍板的決定**,
--       整段寫在下面(R2 C2:原本那段宣稱「這三條」而三條裡有兩條在它【上面】
--       ⇒ 違反本檔自己訂的「更正與決定要落在讀者會走到的地方」)。**往下讀到 `customers` 那一段。**
GRANT SELECT ON TABLE public.customer_favorites TO pcm_readonly;
GRANT SELECT ON TABLE public.customer_vehicles TO pcm_readonly;
--    ⬇️ 🔴 同上 —— 這一條的理由在下面 `customers` 那一整段。
GRANT SELECT ON TABLE public.customer_wallet_balance_check TO pcm_readonly;
GRANT SELECT ON TABLE public.customer_wallet_ledger TO pcm_readonly;
--
--    🔴🔴 **這三條(customers / customer_addresses / customer_vehicles)是【推翻一個舊拍板】,
--       不是補一條出處。下一個人請把這一整段讀完再動它。**
--
--    🎯 **先講這一段為什麼存在**:
--       **補出處, 就是給理由。** 一件【被記下來、刻意沒關】的事, 寫進版控就變成
--       【有理由、被批准】的事。⇒ 📌 **而這一次它是被批准的, 因為有人停下來問了。**
--       沒有那一停, 它會以「對帳必經」四個字滑過去。
--
--    ① **2026-09-01 的舊拍板, 逐字引用**(`20260901230000:8-11`):
--       > 2026-09-01 端他的題逐字:「那個唯讀帳號 pcm_readonly **讀得到全體客人的生日**,
--       > 要留著嗎?」他答:**收掉**。
--
--    ② **而那一片【只做了一半】** —— 它收的是一張 view, 底表沒收。
--       🔬 同檔 `:41-42` 逐字:「② **不收其他 67 張表** … 本支只收 1 張。
--          剩下 67 張的清單, 本支會印出來, 而**不會動它們**。」
--       🔬 2026-09-18 唯讀正式庫實查, 兩個讀數:
--            `has_table_privilege('pcm_readonly','public.admin_customer_list_v','SELECT')` ⇒ **f** ✅
--            `has_table_privilege('pcm_readonly','public.customers','SELECT')`             ⇒ **t** 🔴
--       ⇒ 📌 **他說「收掉」, 而生日今天仍然讀得到。那一片關的是窗戶, 門還開著。**
--
--    ③ **2026-09-18 Sean 重新拍【乙】—— 這是【推翻】, 不是【補充】。**
--       他逐字:「乙 留著, 而我把「為什麼要留」寫進版控**(生日那件等於改變 09-01 的決定)**」
--       🔴 **括號裡那句是他自己加的** ⇒ **他知道這等於改變 09-01 那個決定, 不是沒看到。**
--       📌 照今天全線的標準:「他拍了乙」與「他拍板時知不知道自己在推翻什麼」是兩件事 ——
--          **而這一次他自己在括號裡寫出來了**, 所以那句括號原樣進檔。
--
--    ④ **留著的理由(逐字)**:
--       > 查帳要對得出【這筆錢是誰的】—— 只看金額與單號對不出人,
--       > 所以唯讀帳號需要讀得到客人姓名與地址。
--       > 而 09-01 說的「收掉」指的是生日那件;2026-09-18 重新判定:
--       > **底表留著, 代價是生日也一起讀得到。**
--
--    ⑤ 🛑 **這句理由是誰寫的, 標清楚**(2026-09-18 全線的標準):
--       · 這段理由由**主視窗擬稿**, Sean 2026-09-18 18:3x 逐字「**甲 就照這句寫**」確認。
--       · 🔴 而他**先前那則答覆自己加了括號**:「**(生日那件等於改變 09-01 的決定)**」
--         ⇒ **他是【知情下推翻】, 不是沒看到 09-01 那個拍板。**
--       📌 今天已經證明過:「他拍了 X」與「他拍板時知不知道自己在推翻什麼」是兩件事。
--          **而這次證據就在他自己的括號裡** ⇒ 那句括號原樣留在上面 ③。
--
--    ⑥ 🔵 **而這一段能存在, 靠的是一個【動作】不是一個直覺** ——
--       寫這片之前我 `grep` 了 `20260901230000` 與「生日」, 發現整支檔 **0 命中**。
--       ⇒ 📌 **不是「我覺得怪」, 是「我去查了它有沒有提」。**
--       ⇒ ✅ **規矩**:寫「把現況補進版控」那種片子之前, **先 grep 一次那些物件在 repo 裡
--          有沒有【被討論過】的紀錄。有 ⇒ 讀它。**
--
GRANT SELECT ON TABLE public.customers TO pcm_readonly;
GRANT SELECT ON TABLE public.legal_terms_versions TO pcm_readonly;

-- ── 稽核 / 登入 / 信件(5 條)─────────────────────────────────────────────
--    出事時要答「誰在什麼時候做了什麼」。
GRANT SELECT ON TABLE public.admin_audit_log TO pcm_readonly;
--
-- ── 🔴🔴 `admin_saved_order_views` 【刻意不在這裡】(R2 MF2 · Sean 2026-09-18 拍甲)──
-- ⛔ ~~本片原本有一句 `GRANT SELECT ON TABLE public.admin_saved_order_views TO pcm_readonly;`~~
--    **舊字面留著不刪。** 為什麼拿掉:
--
-- 🎯 **補出處, 就是給理由** —— 一件「被記下來、刻意沒關」的事,
--    寫進版控就變成「**有理由、被批准**」的事。
--
-- 🔴 **而這張表特別在哪裡**:`20260828080000:189-197` 逐字寫過
--      「本表**刻意零 GRANT**」
--      「這裡【**不 GRANT 任何表權限給任何角色**】, 連 service_role 的 SELECT 都不給」
--      「**私有性是 trust boundary, 不簡化**」
--    ⇒ 📌 **把它的授權補進版控 = 把一個破洞【追認成設計】。**
--
-- 🔬 2026-09-18 正式庫唯讀實查, 那張表今天的 relacl 逐字:
--      `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--    對照 `20260828080000:189-191` 記的 2026-08-28 讀數 `postgres=arwdDxtm/postgres`
--    ⇒ 🔴 **那句「設計在庫上成立」今天是假的, 而且破在【兩】條, 不是一條**
--      ( `pcm_readonly=r` 與 **`service_role=r`** —— 後者連本片都沒碰過、也不在那 81 條裡)。
--    ⇒ 🔴 連帶:`20260828080000:155-156` 逐字「今天就沒有任何一條路是靠 BYPASSRLS 讀它的」
--      **也已經是假的** —— `pcm_readonly` 今天 `rolbypassrls = t`(2026-09-18 實查)。
--      **那不是貼下去才變假的, 是量到的時候就已經假了。**
--
-- ⛔ ~~✅ **Sean 2026-09-18 拍【甲】:兩條都補回去, 恢復 08-28 的設計。**~~
-- ⛔ ~~⇒ 📌 所以在那一片貼之前, **這兩條授權今天仍然在線上** —— 本片不讓任何人以為它們沒了。~~
--
-- 🔴🔴 **上面那兩句作廢(2026-09-18 稍晚, 同日更正)。舊字面留著不刪 ——**
--    **改寫會讓錯的字面從歷史裡消失, 而下一個人就學不到我們是怎麼把**
--    **「沒出處」與「沒查到出處」講混的。**
--
-- 🔬 **錯在哪**:上面寫「破在【兩】條」, 而那句話**沒說哪一條有人決定過**。
--    它被讀成(也被轉述成)「**兩條都是沒人決定過的漂移**」—— 而那是假的:
--
--    🟢 **`service_role=r` 那條【有出處、有拍板、在版控裡】**:
--       `20260904270000_m4b_rls_service_role_select_36.sql:231` 把本表列進那份 40 張名單,
--       `:350` 逐字 `EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname)`,
--       帳本 `APPLIED.tsv:515` 已貼(2026-09-05 記帳)。
--       該檔檔頭 `:7-9` 引 **Sean 2026-09-04 `Q-RLS` 拍甲**逐字:
--         「甲 = 收 (推薦) —— 先把 43 張表的後台讀取政策補完, 補完才收;現在開工」
--       `:9` 再逐字:「⇒「收」= 拿掉 `service_role` 的 `BYPASSRLS`。**那是【另一支】migration**」
--       ⇒ 📌 **那條 GRANT 的用途, 白紙黑字就是「為了之後收掉特權」** ——
--         它今天零呼叫是**預期的**, 不是它沒用。**收掉它 = 把 09-04 拍甲做到一半的事推倒。**
--
--    🔴 **`pcm_readonly=r` 那條才是孤兒**:repo 全庫零 `GRANT … TO pcm_readonly` 提到本表,
--       且 2026-09-18 實查 `pg_default_acl` —— **`pcm_readonly` 不在任何一筆預設權限裡**
--       ⇒ **不是自動發的, 是有人手動下的, 而【查不到】是誰、什麼時候。**
--       🛑 照實寫「查不到」, 不寫「沒有」。
--
-- ✅ **⇒ Sean 2026-09-18(重問之後)改拍【甲】, 逐字:**
--      「甲 = 只收 pcm_readonly(孤兒);service_role 留著,
--        改掉 08-28 檔案裡那句已經被你自己推翻的話」
--    ⇒ 本片照舊把 `admin_saved_order_views` 這一行拿掉(**本片只負責不追認, 不負責收**)。
--    ⇒ 🛑 **REVOKE 只收 `pcm_readonly` 那一條, `service_role` 那條不碰。**
--      那是【動正式庫權限】⇒ 鐵則 8 ⇒ 另開一片、先寫 plan、Sean 批了才貼。
--    ⇒ 📌 所以在那一片貼之前, **這兩條授權今天都仍然在線上** —— 本片不讓任何人以為它們沒了。
--
-- 🎯 **這一格的教訓, 比這張表本身重要**:
--    **「沒出處」與「沒查到出處」是兩件事, 而它們寫出來長得一模一樣。**
--    ⇒ 📌 **「查出處」不是行政手續 —— 它會【推翻題目本身】。**
--      本片就是實例:去查「這條是誰、什麼時候加的」, 查出來的東西讓拍板重來一次。
--    ⇒ 🔵 而 **寫在錯的前提上的 plan, 比沒有 plan 更貴。**
--
--    🔴🔴 **這一條是 Sean 2026-09-18 【Q2 拍甲】明確決定要留的, 理由寫在這裡而不是檔頭**
--       (更正與決定要落在讀者會走到的地方)。
--    🔬 那張表的表說明**逐字**:「🔴 **這張表要防的人包含拿到 `service_role` 金鑰的人**」;
--       `ip` 欄逐字「🔴 **PII**」, 另有 `user_agent`。
--    🔵 **而 `pcm_readonly` 是另一個角色** ⇒ 給它 SELECT **並沒有推翻那道防線**。
--    🔴 **但它是一張自己標著 PII、存在理由就是鑑識的表** ⇒ 它需要一個【明確的決定】,
--       而 Sean 2026-09-18 拍甲**就是那個決定:留著**。
--    📌 寫在這裡, 是為了讓下一個看到它的人**不用再問一次**。
GRANT SELECT ON TABLE public.admin_sso_login_events TO pcm_readonly;
GRANT SELECT ON TABLE public.auth_callback_events TO pcm_readonly;
GRANT SELECT ON TABLE public.email_outbox TO pcm_readonly;
GRANT SELECT ON TABLE public.staff TO pcm_readonly;

-- ── 2b. 🔴 那 9 個欄級【刻意不寫在這裡】—— 它們已經有出處 ──────────────────
-- ⛔ ~~本片原本有兩句 `GRANT SELECT (…) ON … TO pcm_readonly`~~
-- 🔴 **R1 F2 打掉:那 9 欄的出處在 `20260906380000:147-151`(貼板 51, 2026-09-06 已貼)。**
--    ⇒ 寫在這裡就是**第二份副本** —— 而 plan §⑤ Sean 拍甲的判準逐字是
--      **「只寫【沒有出處的】」**、反對全寫的理由逐字是**「造出兩份會各自漂移的副本」**。
--
-- 🎯 **而我當時是怎麼讓它走過那道範圍閘的, 這一格比那 9 條本身重要**:
--    我用的理由是「**表級 GRANT 不涵蓋欄級**」—— 而**那句話是對的 PG 行為**(實測過),
--    **它只是不是【有沒有出處】那個判準**。
--    ⇒ 📌 **兩個判準被換掉了, 而兩個都成立 ⇒ 沒有任何東西會叫。**
--    ⇒ 🛑 **下一個人會想把那兩句加回來**(理由仍然聽起來很對)——
--       **這一段是唯一擋得住他的東西。要加之前先問:我現在用的是哪一個判準?**
--
-- ✅ **而下面兩道斷言【留著】**(前置③ 驗那 9 欄還在、後置② 驗那 9 個授權還在):
--    本片不給它們, 但本片**依賴它們還在** —— 它們若不見了, 表示板 51 被人動過,
--    那時應該**停下來看**, 而不是由本片靜靜補回去。
--    🔵 要改那份白名單 ⇒ **改 `20260906380000` 那一支**, 不要改本片。

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
DO $post$
DECLARE v_bad text; n_service int;
BEGIN
  -- ① 61 條表級都在
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
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid = x.o::pg_catalog.regclass
        AND a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type='SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '後置閘①:這幾條貼完之後【acl 裡沒有 pcm_readonly 的那一列】⇒ %', v_bad;
  END IF;

  -- 🔴 R1 F4 的後半:閘④ 發現有缺, 而沒人明示允許補 ⇒ 擋。
  --    📌 「本片是 no-op」這個宣稱, 只有在【中間沒人動過】時才成立。
  IF pg_catalog.current_setting('pcm.regrant_missing', true) IS NOT NULL
     AND pg_catalog.current_setting('pcm.regrant_missing', true) <> ''
     AND COALESCE(pg_catalog.current_setting('pcm.allow_regrant', true),'') <> 'yes' THEN
    RAISE EXCEPTION '🔴 本片【不是 no-op】:貼板當下這幾條已經被人收掉, 而本片剛把它們補了回去 ⇒ %  ⇒ 拒 COMMIT。要刻意補請先 SET pcm.allow_regrant = %L 再跑。',
      pg_catalog.current_setting('pcm.regrant_missing', true), 'yes';
  END IF;

  -- ② 🔴 9 個欄級都在 —— **這一格是本片最重要的斷言**
  --    「只寫表級」與「表級+欄級都寫」在 relacl 上看起來差不多, 差別只在 attacl。
  --    ⚠️ 而 `has_column_privilege` **表級權限也會讓它回 true** ⇒ 它在這裡**沒有判別力**
  --       ⇒ 所以這裡問的是 **attacl 這一欄本身有沒有那一列**。
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
    RAISE EXCEPTION '後置閘②:這幾個【欄級】授權不在 attacl 裡 ⇒ 本片少寫了它們 ⇒ %', v_bad;
  END IF;

  -- ③ ⚪ 負對照:本片不該碰別的角色。service_role 的物件數必須與貼前相同。
  SELECT count(*) INTO n_service FROM (
    SELECT DISTINCT c.oid FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE a.grantee = pg_catalog.to_regrole('service_role')) s;
  IF n_service::text IS DISTINCT FROM pg_catalog.current_setting('pcm.svc_pre', true) THEN
    RAISE EXCEPTION '🔴 負對照失敗:service_role 的物件數從 % 變成 % ⇒ 本片不該碰別的角色 ⇒ 拒 COMMIT',
      pg_catalog.current_setting('pcm.svc_pre', true), n_service;
  END IF;

  -- 🔴 R1 F7:⛔ ~~原本印「service_role 一個字沒變」~~ —— 那句話講過頭:
  --    ③ 比的只有**DISTINCT 物件數**, 等量互換(收一個、給另一個)它會回綠。
  --    ⇒ 訊息只說量得到的那句。
  RAISE NOTICE '✅ 後置閘:61 條表級都在(acl 實查)· 9 條欄級斷言過(出處在板 51, 本片不給)· service_role 的【物件數】與貼前相同';
END
$post$;

COMMIT;
