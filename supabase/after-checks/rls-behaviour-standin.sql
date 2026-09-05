-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 **本檔【刻意不加】 `\set ON_ERROR_STOP on`**(2026-09-05 線【身分】`-auth`;
--    主視窗派的是「四支都加」, 而我逐支看過之後判這兩支不加, 理由如下)
-- ══════════════════════════════════════════════════════════════════════════
--   🔬 **量到的**:本檔的 psql meta 指令(以 `\` 開頭的行)= **0**;
--      而同目錄的 `270000-after.sql` = 12、`0905010000b-after.sql` = 13。
--      ⇒ 📌 **那兩支是寫給 `psql -f` 的, 而本檔是【純 SQL】—— 它被設計成可以【貼】。**
--   🔴 `\set` 是 **psql 的 meta 指令, 不是 SQL** ⇒ 貼進 Supabase SQL Editor 會**在第一行就錯**。
--      而 Sean 的工作方式是**貼 SQL Editor**(專案慣例), 本檔內文也寫著貼前/貼後怎麼驗。
--   ⇒ 🎯 **加了它 = 為了讓「psql 跑的人」看得到紅, 而把「貼的人」擋在第一行。**
--   ✅ **要在 psql 裡跑本檔而且要它遇錯就停 ⇒ 在【命令列】給,不要寫進檔案**:
--      `psql -v ON_ERROR_STOP=1 -f <本檔>`
--      📌 那一版兩種消費者都活得下來 —— 而寫進檔案的版本只服務其中一種。
-- ═══════════════════════════════════════════════════════════════════════════
-- RLS 行為驗證:用一個【NOBYPASSRLS 替身角色】逐張驗 20260904270000 那 40 條 policy
-- ═══════════════════════════════════════════════════════════════════════════
-- 為什麼需要替身:`service_role` 帶 `rolbypassrls = t` ⇒ 拿它去 `SET ROLE` 驗 policy
--   【零判別力】—— policy 在與不在, 它都讀得到全部。
--   ⇒ 替身必須 ① `NOBYPASSRLS` ② **是 `service_role` 的成員**(否則 `TO service_role`
--     的 policy 對它不適用, 每張都讀 0, 而那會被讀成「policy 全壞了」)。
--
-- 🔴 唯一的寫入是 `CREATE ROLE`, 而整支包在 BEGIN…ROLLBACK 裡 ⇒ **零殘留**。
--    ⚠️ 若你的 SQL 編輯器【每句自動 commit】(ROLLBACK 會失敗或無效), 手動收尾:
--        DROP ROLE IF EXISTS pcm_rls_standin;
--
-- 🛑 這一支【證不到什麼】:
--    · 它只數 `count(*)` —— 兩邊一樣多**不代表是同一批列**(policy 若寫成奇怪的
--      `USING` 而恰好篩掉 N 列又放進 N 列, 這把尺看不出來)。本批 policy 是
--      `USING (true)` ⇒ 今天成立;**改過 policy 之後這句話要重新問一次**。
--    · 它不驗 INSERT / UPDATE / DELETE —— 本批只建 SELECT policy。
--    · 空表(0 列)在「policy 生效」與「policy 沒生效」兩個世界【都印 0 = 0】
--      ⇒ 那種列本支標 `⚠ 空表:零判別力`, **不要把它算進通過數**。
--
-- ✅ 拋棄式 PG(17.10)實測四個世界, 2026-09-05 —— 這把尺【該紅的時候會紅】:
--    A  policy 都在              ⇒ 有列的表 5=5 ✅ · 正對照讀 0 而 service_role 讀 3 ✅ · 空表標「零判別力」✅
--    B  拔掉一張的 policy        ⇒ 那張變 0 vs 5, 判定轉 🔴, 統計格「紅」從 0 變 1 ✅
--    C  替身改成 BYPASSRLS       ⇒ 前置斷言擋下, 整支不跑 ✅
--    D  替身不是 service_role 成員 ⇒ 前置斷言擋下 ✅(這一格擋的是【每張都讀 0 而被誤讀成 policy 全壞】)
--    零殘留:ROLLBACK 之後 `SELECT count(*) FROM pg_roles WHERE rolname='pcm_rls_standin'` = 0 ✅
--
-- 🔴 而 C 與 D 是【前置斷言】不是驗收項 —— 它們擋的是「這支探針自己失效而畫面看起來很正常」。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 替身:NOBYPASSRLS + service_role 成員 ───────────────────────────────
DROP ROLE IF EXISTS pcm_rls_standin;
CREATE ROLE pcm_rls_standin NOLOGIN NOBYPASSRLS IN ROLE service_role;

-- ── ② 替身本身要先過三格, 否則下面每個數字都沒有意義 ─────────────────────
DO $$
DECLARE v_bypass boolean; v_member boolean;
BEGIN
  SELECT rolbypassrls INTO v_bypass FROM pg_catalog.pg_roles WHERE rolname = 'pcm_rls_standin';
  IF v_bypass IS NULL THEN RAISE EXCEPTION '替身沒建成 ⇒ 拒繼續'; END IF;
  IF v_bypass THEN RAISE EXCEPTION '替身帶 BYPASSRLS ⇒ 它與 service_role 一樣沒有判別力, 拒繼續'; END IF;
  SELECT pg_catalog.pg_has_role('pcm_rls_standin', 'service_role', 'MEMBER') INTO v_member;
  IF NOT v_member THEN
    RAISE EXCEPTION '替身不是 service_role 的成員 ⇒ TO service_role 的 policy 對它不適用, 每張都會讀 0 而那不是缺陷, 拒繼續';
  END IF;
  RAISE NOTICE '✅ 替身三格通過:存在 / NOBYPASSRLS / 是 service_role 成員';
END $$;

CREATE TEMP TABLE pcm_standin_result(
  表名 text, 分類 text, 替身讀到 bigint, service_role讀到 bigint, 判定 text
) ON COMMIT DROP;

-- ── ③ 逐張數:替身 vs service_role ────────────────────────────────────────
DO $$
DECLARE
  r text; v_standin bigint; v_sr bigint; v_class text; v_verdict text;
  v_targets text[] := ARRAY[
    'admin_audit_log',
    'admin_saved_order_views',
    'coupon_redemptions',
    'coupons',
    'customer_addresses',
    'customer_favorites',
    'customer_vehicles',
    'customer_wallet_ledger',
    'customers',
    'legal_terms_versions',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_procurement',
    'order_item_procurement_receipts',
    'order_item_procurement_void_requests',
    'order_item_quantity_summary',
    'order_item_receipt_requests',
    'order_items',
    'order_manual_refunds',
    'order_notes',
    'order_payments',
    'order_refund_items',
    'order_refund_job_items',
    'order_refund_jobs',
    'order_refund_manual_corrections',
    'order_refunds',
    'order_status_options',
    'orders',
    'payment_charge_attempts',
    'payment_double_charge_anomalies',
    'payment_refunds',
    'pending_invoices',
    'product_fitments',
    'product_fitments_effective',
    'product_fitments_effective_staging',
    'product_fitments_effective_sync_log',
    'product_variants',
    'products',
    'staff',
    'suppliers'
  ];
  -- 🟢 正對照:這 8 張是本批【刻意排除】的 ⇒ 它們沒有 service_role SELECT policy
  --    ⇒ 替身在它們身上【必須讀到 0 而 service_role 讀到 N】。
  --    🔴 少了這一格, 「40 張全部相等」也可能是【RLS 根本沒在管替身】——
  --       那兩個世界在上面那張表裡逐字相同。
  v_controls text[] := ARRAY[
    'admin_sso_login_events',
    'dbk_external_id_rename_20260904',
    'order_legal_consents',
    'payment_double_charge_anomaly_events',
    'payment_refund_events',
    'payment_webhook_events',
    'pcm_b2_shipping_idempotency',
    'pcm_rls_rollback_20260904270000'
  ];
BEGIN
  FOREACH r IN ARRAY (v_targets || v_controls) LOOP
    v_class := CASE WHEN r = ANY(v_targets) THEN '本批 40 張' ELSE '🟢 正對照(刻意排除)' END;

    EXECUTE 'SET LOCAL ROLE pcm_rls_standin';
    EXECUTE format('SELECT count(*) FROM public.%I', r) INTO v_standin;
    EXECUTE 'RESET ROLE';
    EXECUTE format('SELECT count(*) FROM public.%I', r) INTO v_sr;

    v_verdict :=
      CASE
        WHEN v_sr = 0                                   THEN '⚠ 空表:零判別力(兩個世界都印 0)'
        WHEN v_class = '本批 40 張' AND v_standin = v_sr THEN '✅ 相等 ⇒ policy 生效'
        WHEN v_class = '本批 40 張'                      THEN '🔴 不相等 ⇒ policy 沒生效或被別條 RESTRICTIVE 收窄'
        WHEN v_standin = 0                               THEN '✅ 讀到 0 ⇒ 尺會動(這正是正對照要的)'
        ELSE '🔴 正對照居然讀得到 ⇒ 替身身上的 RLS 沒在管, 上面那些相等【全部作廢】'
      END;

    INSERT INTO pcm_standin_result VALUES (r, v_class, v_standin, v_sr, v_verdict);
  END LOOP;
END $$;

-- ── ④ 結果 ───────────────────────────────────────────────────────────────
SELECT * FROM pcm_standin_result ORDER BY 分類, 表名;

SELECT
  count(*) FILTER (WHERE 判定 LIKE '✅%')                      AS 通過,
  count(*) FILTER (WHERE 判定 LIKE '🔴%')                      AS 紅,
  count(*) FILTER (WHERE 判定 LIKE '⚠%')                       AS 空表_零判別力,
  count(*) FILTER (WHERE 分類 = '🟢 正對照(刻意排除)' AND 判定 LIKE '✅%') AS 正對照通過_期望非0,
  count(*)                                                     AS 總數_期望48
FROM pcm_standin_result;

-- 🔴 判讀順序【不可顛倒】:先看「正對照通過」那一格。
--    它若是 0, 上面所有的「✅ 相等」都不算數 —— 因為那時「相等」的成因可能是
--    RLS 根本沒有在管替身, 而不是 policy 生效。

ROLLBACK;
