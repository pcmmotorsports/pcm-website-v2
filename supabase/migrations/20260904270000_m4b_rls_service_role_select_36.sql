-- 20260904270000 · M-4b · 補 40 張表的 service_role SELECT policy(+ 缺的表層 GRANT)
--
-- ⚠️ 檔名寫 `_36` 是【第一版的數字】, 而實際是 **40**(codex R1 must-fix ⑤ 之後修正)。
--    檔名不改:migration 檔名是不可變歷史, 改名會讓引用它的每一處對不上。⇒ 以本註解為準。
--
-- ═══ 這支在做什麼, 以及它【不】做什麼 ══════════════════════════════════════════
-- Sean 2026-09-04 `Q-RLS` 拍甲, 逐字:
--   「甲 = 收 (推薦) —— 先把 43 張表的後台讀取政策補完, 補完才收;現在開工」
-- ⇒ 「收」= 拿掉 `service_role` 的 `BYPASSRLS`。**那是【另一支】migration, 不在本支。**
--
-- ═══ 🔴🔴 本支的驗收有一個【結構性盲區】, 寫在最前面 ═══════════════════════════
-- 實測 `pg_roles`:**`service_role` 自己就有 `rolbypassrls = t`**
-- ⇒ 本支跑的當下, `SET ROLE service_role` 讀得到任何表 —— **它根本不看 policy。**
-- ⇒ 🛑 **「建了 40 條 policy」與「一條都沒建」, 對那發 SET ROLE 測試印【同一個答案】。**
-- ⇒ 所以格⑨ 只證「表層 GRANT 那一半通了」, **證不到 policy 寫對沒有。**
-- ⇒ ✅ policy 真的生效由 `scripts/rls-service-role-select-verify.sh` 驗:替身角色
--    `pcm_verify_norls`(**NOBYPASSRLS**, 而是 service_role 的成員)+ **形狀從本檔抽出來**,
--    再加兩發突變(`USING(false)` / `RESTRICTIVE`)證明它會翻面。
--
-- ═══ 🔴 為什麼是 40 不是 36(codex R1 must-fix ⑤;主視窗 2026-09-04 拍甲)══════
-- 第一版的判準是「有沒有一條 service_role 讀得到的 SELECT policy」⇒ 36 張。
-- 而那個判準**把帶過濾的 policy 也算成已覆蓋**。收窄成
--   「PERMISSIVE 且 `qual` 是 `true`/NULL」⇒ **40 張**, 多出來的 4 張是目錄表:
--     `products`                     現有 policy `TO PUBLIC USING (delisted_at IS NULL)`
--     `product_variants` / `product_fitments` / `product_fitments_effective`
--                                    現有 policy `TO PUBLIC USING (EXISTS(… delisted_at IS NULL))`
-- 🎯 **它們「有 policy」是真的, 而那條 policy 會把【下架商品】濾掉。**
-- 🔬 規模(2026-09-04 唯讀量):**已下架 559 筆**商品(在架 24,479 / 全部 25,038);
--    掛在下架商品底下的 `product_variants` **721** 筆、`product_fitments` **1,277** 筆。
-- 🛑 ⇒ **下一支收掉 BYPASSRLS 的那一刻, 後台會看不到那 559 筆下架商品與它們的規格/車型對應** ——
--    **而那不會報錯, 清單少幾筆沒有東西會叫。**(後台要看得到下架的, 否則改不回上架。)
-- ⇒ 本支給那 4 張補的是**不帶過濾**的 `service_role` policy, 與既有的 PUBLIC 那條**並存**
--    (PERMISSIVE 之間是 OR ⇒ 不會影響 anon 看到的東西)。
--
-- ═══ 名單怎麼來 ═══════════════════════════════════════════════════════════════
-- 🔴 **當場從 catalog 產, 不寫死。** 而 **鎖的是【名單身分】不只是張數**(codex must-fix ①):
--
-- ═══ 🛑🛑 名單對不上時, 【不要把新名單抄上去重貼】(主視窗 2026-09-05 釘)═══════
--   期望名單是一個**快照**, 它一定會過期 —— 而過期時最省事的動作是「照著新的抄一份再貼」。
--   🔴 **那個動作會讓這道閘從【擋住未盤過的表】變成【幫你確認你剛剛看到什麼】。**
--   ⇒ 正確流程:**停下, 叫 `-db` 用唯讀連線核那幾張**(閘會印出多了誰 / 少了誰), **由人判**,
--     判完才改 `PCM-EXPECTED-BLOCK`, 並在 commit body 寫下判了什麼。
--   📌 一般化:**一個要人手動同步的常數, 天生就長著一條繞過它的捷徑。**
--   ⚠️ ⛔ ~~用排序名單的 md5~~ 已作廢(codex R2 must-fix ⑤):md5 擋得住漂移, 而**讀的人
--      看不出是哪一張被換進來** ⇒ 沒有東西可以判 ⇒ 只剩下抄新值那條路。改成逐字名單 + 印差集。
--
-- ═══ ⏱ SQL Editor 60 秒上限(codex 附帶指出)═══════════════════════════════════
-- Supabase Dashboard 的 SQL Editor 有 **60 秒**上限, 檔內寫 120s 不代表它讓你跑 120s。
-- ⇒ `statement_timeout` 設 **55s**, 讓**本檔自己先喊停**, 而不是被 Dashboard 砍在不知道哪裡。
--
-- ═══ 冪等(codex must-fix ④)═══════════════════════════════════════════════════
-- 🔴 第一版寫「重跑安全」而閘③ 在重跑時【必定 exception】(跑成功後目標變 0)——
--    宣稱與行為矛盾, 而 SQL Editor 回應不明時人就不敢重試。
-- ✅ 改成:**目標為 0 且那 40 張都已覆蓋 ⇒ 判定為【已套用過】, 印 NOTICE 正常結束。**
--    ⇒ 「重跑安全」現在是真的, 而它有一個可檢查的前提。

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '55s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ①:這個庫看起來是我對著做的那個(orders 在, 且我是它 owner 的成員)
--   🔴 R3 F3:**這一格證不到那 40 張** —— 它排在 targets 之前, 結構上只看得到 orders 一張。
--      Dashboard 建的表 owner 有時是 supabase_admin ⇒ 那種表要到迴圈裡才炸。
--      ⇒ 逐張那一格搬到 targets 建好之後(前置閘⑥), 這裡只留「庫對不對」的粗篩。
-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ②:角色在不在(名字打錯會安靜地建出一條沒有人的 policy)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION '前置閘②:角色 service_role 不存在 ⇒ 停';
  END IF;
  -- 🔴 三個角色都要問, 不是兩個:本支後面 `REVOKE ALL … FROM anon, authenticated`,
  --    少一個就整支 ERROR。而它是【我自己新加的相依】—— 加了用它的敘述, 就要加問它的閘。
  --    🔬 抓到這一條的是我自己的 harness:本機世界沒建 authenticated ⇒ 格⑪ 當場紅。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION '前置閘②:角色 anon 不存在 ⇒ 停(後面的負對照與 REVOKE 要用它)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '前置閘②:角色 authenticated 不存在 ⇒ 停(前置閘③ 與快照表的 REVOKE 要用它)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ③(codex must-fix ⑥):anon / authenticated **不得是 service_role 的成員**
--   🔴 RLS policy 套用一般角色繼承規則 ⇒ 若有繼承, 本支給 service_role 的 policy + GRANT
--      會讓 anon 也讀得到, 而本支的負對照(只看 policy 的 TO 子句)**看不到那條路**。
--   🔬 2026-09-04 唯讀實測:兩個都是 f ⇒ 目前沒有那條路。
--      **而「現在沒有」不是「不會有」** ⇒ 寫成閘, 不寫成註解。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO v_bad
    FROM pg_catalog.pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated')
     AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'MEMBER');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:% 是 service_role 的成員 ⇒ 本支給 service_role 的讀路會【繼承】給它們。
  ⇒ 先處理角色繼承, 再貼本支。', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 目標名單:當場從 catalog 產
--   🔴 判準收窄(codex must-fix ⑤):只有 **PERMISSIVE 且 qual 是 true/NULL** 的 SELECT policy
--      才算「已經讀得到」。帶過濾的(例如 `delisted_at IS NULL`)**不算** ——
--      那正是上面 559 筆那件事。
-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- 排除名單:**單一來源**(codex R2 must-fix ⑦)
--   🔴 前一版把這 7 個名字寫了【三份】:目標查詢的 NOT IN · 事後斷言⑧ · 清單檔。
--      而 parity 測試只守前者與清單檔 ⇒ **等量替換一個排除項時, 斷言⑧ 還是舊決定而七格全綠。**
--   ⇒ 改成建一張暫存表, 目標查詢與斷言⑧ 都讀它。**一份, 不是三份。**
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE pcm_rls_exclusions(relname text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO pcm_rls_exclusions(relname) VALUES
  -- 🔴 與 supabase/rls-service-role-select-exclusions.txt 逐字相同(理由寫在那支檔)。
  --    平行測試靠下面這對錨定位, 而它會驗【錨只出現一次】且【包在這個 VALUES 裡】。
  -- PCM-EXCLUSIONS-BLOCK-BEGIN
  ('admin_sso_login_events'),
  ('order_legal_consents'),
  ('payment_double_charge_anomaly_events'),
  ('payment_refund_events'),
  ('payment_webhook_events'),
  ('pcm_b2_shipping_idempotency'),
  ('dbk_external_id_rename_20260904'),
  ('pcm_rls_rollback_20260904270000')
  -- PCM-EXCLUSIONS-BLOCK-END
  ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ④(codex R2 must-fix ③):**RESTRICTIVE policy 會被 AND 起來**
--   🔴 PERMISSIVE 之間是 OR, 而 RESTRICTIVE 是 AND ⇒ 我補一條 `USING (true)` 的 PERMISSIVE,
--      若同一張表另有一條適用於 service_role/PUBLIC 的 RESTRICTIVE 過濾 policy,
--      實際結果是 `true AND <那個過濾>` ⇒ **收 BYPASSRLS 之後照樣少資料, 而我的斷言全綠。**
--   🔬 2026-09-04 唯讀實測:public 底下這種 RESTRICTIVE policy **0 條** ⇒ 今天不成立。
--      **而「今天是 0」不是「判準可以是錯的」** ⇒ 寫成閘。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(c.relname || '(' || p.polname || ')', ', ') INTO v_bad
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT p.polpermissive
     AND p.polcmd IN ('r','*')
     -- 🔴 R3 F10:PG 套 policy 用的是【角色繼承】不是名字相等
     --    ⇒ RESTRICTIVE policy 若下在 service_role 的某個父角色上, 名字比對抓不到。
     AND EXISTS (SELECT 1 FROM unnest(p.polroles) AS pr(oid)
                  WHERE pr.oid = 0 OR pg_catalog.pg_has_role('service_role', pr.oid, 'USAGE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:有 RESTRICTIVE 的 SELECT policy 會套用到 service_role ⇒ %
  ⇒ 我補的 PERMISSIVE USING(true) 會被它 AND 掉, 而本支的斷言看不出來。
  ⇒ 停下, 先決定那條 RESTRICTIVE 要不要留, 再貼本支。', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 目標名單:當場從 catalog 產
--   判準 = 【沒有無條件 PERMISSIVE 讀路】**或**【沒有表層 SELECT】
--   🔴 codex R2 must-fix ①:前一版只問前者 ⇒ **「policy 對而缺 GRANT」那種表不會進名單**,
--      本支與每一條事後斷言都跳過它 ⇒ 收 BYPASSRLS 之後直接 permission denied。
--      🔬 2026-09-04 唯讀實測:那種表目前 **0 張**(所以張數仍是 40)——
--         **而它是 0 不代表判準可以少問一半。**
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE pcm_rls_targets ON COMMIT DROP AS
WITH covered AS (
  SELECT c.oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
        WHERE p.polrelid = c.oid AND p.polcmd IN ('r','*') AND p.polpermissive
          AND ( p.polqual IS NULL
                OR pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN ('true','(true)') )
          AND ( p.polroles = '{0}'::oid[]
                OR 'service_role' = ANY (SELECT r.rolname FROM pg_catalog.pg_roles r
                                          WHERE r.oid = ANY (p.polroles)) ))
)
SELECT c.oid AS reloid, c.relname::text AS relname,
       -- 🔴 回滾要用的【前態】:本支動手【之前】它有沒有表層 SELECT(R1 must-fix ⑧)
       pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') AS had_grant_before,
       -- 🔴 R3 F4:**policy 的前態也要留** —— 判準的另一半是「policy 對而缺 GRANT」,
       --    那種表會進名單而迴圈【跳過建 policy】⇒ 回滾若對全體產 DROP POLICY,
       --    會刪掉一條【本支沒有建】的 policy。R1 只修了 GRANT 那半, 這是同型的另一半。
       EXISTS (SELECT 1 FROM pg_catalog.pg_policy p0
                WHERE p0.polrelid = c.oid
                  AND p0.polname = c.relname || '_select_service_role') AS had_policy_before
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   AND c.relname NOT IN (SELECT relname FROM pcm_rls_exclusions)
   AND ( c.oid NOT IN (SELECT oid FROM covered)
         OR NOT pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') );

-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ⑥(R3 F3):**逐張**驗我是不是 owner 的成員 —— 不是只驗 orders 一張
--   🔴 少了這一格, owner 不同的那張會在迴圈中途才炸:整筆照樣回滾(沒有傷害),
--      而錯誤訊息會是 raw 的 permission denied, 讀的人不知道是【權限】不是【邏輯】。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(t.relname || '(owner=' || c.relowner::regrole::text || ')', ', ' ORDER BY t.relname)
    INTO v_bad
    FROM pcm_rls_targets t JOIN pg_catalog.pg_class c ON c.oid = t.reloid
   WHERE NOT pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑥:這幾張的 owner 我不是成員 ⇒ CREATE POLICY 會被拒 ⇒ %
  ⇒ 請用它們的 owner(或其成員)貼本支。', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 期望名單:**逐字寫出來**(codex R2 must-fix ⑤)
--   🔴 前一版只有一個 md5 常數 ⇒ 對不上時, 讀的人**看不出是哪一張被換進來**,
--      而最省事的動作是把新 md5 抄上去 ⇒ 那道閘就變成「幫你確認你剛剛看到什麼」。
--   ⇒ 名字寫出來, 對不上時**印差集**(多了誰 / 少了誰), 讓人有東西可以判。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE pcm_rls_expected(relname text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO pcm_rls_expected(relname) VALUES
  -- PCM-EXPECTED-BLOCK-BEGIN  (2026-09-04 唯讀正式庫盤點, 40 張)
  ('admin_audit_log'),
  ('admin_saved_order_views'),
  ('coupon_redemptions'),
  ('coupons'),
  ('customer_addresses'),
  ('customer_favorites'),
  ('customer_vehicles'),
  ('customer_wallet_ledger'),
  ('customers'),
  ('legal_terms_versions'),
  ('order_cancellation_items'),
  ('order_cancellations'),
  ('order_item_procurement'),
  ('order_item_procurement_receipts'),
  ('order_item_procurement_void_requests'),
  ('order_item_quantity_summary'),
  ('order_item_receipt_requests'),
  ('order_items'),
  ('order_manual_refunds'),
  ('order_notes'),
  ('order_payments'),
  ('order_refund_items'),
  ('order_refund_job_items'),
  ('order_refund_jobs'),
  ('order_refund_manual_corrections'),
  ('order_refunds'),
  ('order_status_options'),
  ('orders'),
  ('payment_charge_attempts'),
  ('payment_double_charge_anomalies'),
  ('payment_refunds'),
  ('pending_invoices'),
  ('product_fitments'),
  ('product_fitments_effective'),
  ('product_fitments_effective_staging'),
  ('product_fitments_effective_sync_log'),
  ('product_variants'),
  ('products'),
  ('staff'),
  ('suppliers')
  -- PCM-EXPECTED-BLOCK-END
  ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 前置閘 ⑤:目標名單必須【逐字等於】期望名單
--   🔴 codex R2 must-fix ②:前一版「目標 0 張 ⇒ 正常結束」是 **fail-open** ——
--      判準寫壞、RLS 被整批關掉、或首次執行時 policy 已有而 GRANT 缺失, 全都印同一個
--      「已套用」然後放行。NOTICE 只提醒, 不會擋。
--   ✅ 0 張時**也要證明它是「已套用」**:那 40 張逐張要有正確 policy + GRANT, 證不出來就擋。
--   🔴 codex R2 must-fix ⑤:對不上時印【差集】(多了誰 / 少了誰), 不是只印一個不透明的 md5。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n int; v_extra text; v_missing text; v_broken text;
BEGIN
  SELECT count(*) INTO v_n FROM pcm_rls_targets;

  IF v_n = 0 THEN
    SELECT string_agg(e.relname, ', ' ORDER BY e.relname) INTO v_broken
      FROM pcm_rls_expected e
      LEFT JOIN pg_catalog.pg_class c
        ON c.relname = e.relname
       AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     WHERE c.oid IS NULL
        OR NOT c.relrowsecurity          -- 🔴 R3 F6:成因句寫了「RLS 被關掉」而檢查沒問它
        OR NOT pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')
        OR NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_policy p
              WHERE p.polrelid = c.oid AND p.polcmd IN ('r','*') AND p.polpermissive
                AND ( p.polqual IS NULL
                      OR pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN ('true','(true)') )
                AND ( p.polroles = '{0}'::oid[]
                      OR 'service_role' = ANY (SELECT ro.rolname FROM pg_catalog.pg_roles ro
                                                WHERE ro.oid = ANY (p.polroles)) ) );
    IF v_broken IS NOT NULL THEN
      RAISE EXCEPTION '前置閘⑤:目標 0 張, **而那不是「已套用」** ——
  這幾張期望中的表, 沒有正確的 policy 或沒有表層 GRANT ⇒ %
  ⇒ 成因可能是:判準被改寬了 / RLS 被關掉了 / 表被改名或刪掉了。
  🛑 「目標 0」與「已經做完」是兩件事, 而它們印同一個數字。', v_broken;
    END IF;
    RAISE NOTICE '本支已套用過:目標 0 張, 而那 40 張【逐張驗過】policy 與 GRANT 都在 ⇒ 正常結束。';
    RETURN;
  END IF;

  SELECT string_agg(t.relname, ', ' ORDER BY t.relname) INTO v_extra
    FROM pcm_rls_targets t WHERE t.relname NOT IN (SELECT relname FROM pcm_rls_expected);
  SELECT string_agg(e.relname, ', ' ORDER BY e.relname) INTO v_missing
    FROM pcm_rls_expected e WHERE e.relname NOT IN (SELECT relname FROM pcm_rls_targets);

  IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑤:目標名單與 2026-09-04 盤點的期望名單不符。
  目標 % 張(期望 40 張)
  🔺 多出來的(期望名單沒有, 而現在符合判準):%
  🔻 少掉的(期望名單有, 而現在不符合判準):%
  ⇒ 這【不是】bug, 是世界動了。
  🛑 **不要把新名單抄上去重貼** —— 停下, 叫 -db 用唯讀連線核那幾張:
     多出來的該不該補?少掉的是誰先補了、補得對不對?
     判完才改 PCM-EXPECTED-BLOCK, 並在 commit body 寫下判了什麼。
     (直接抄新名單, 會讓這道閘從「擋住未盤過的表」變成「幫你確認你剛剛看到什麼」。)',
      v_n, COALESCE(v_extra,'(無)'), COALESCE(v_missing,'(無)');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 動手:兩道門一起開
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_pol text; v_made int := 0; v_skip int := 0; v_granted int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pcm_rls_targets) THEN RETURN; END IF;   -- 重跑
  FOR r IN SELECT reloid, relname, had_grant_before FROM pcm_rls_targets ORDER BY relname LOOP
    v_pol := r.relname || '_select_service_role';
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                WHERE p.polrelid = r.reloid AND p.polname = v_pol) THEN
      v_skip := v_skip + 1;
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO service_role USING (true)',
                     v_pol, r.relname);
      v_made := v_made + 1;
    END IF;
    IF NOT r.had_grant_before THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname);
      v_granted := v_granted + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '建了 % 條 policy(跳過 % 條同名已存在);補了 % 張的表層 GRANT SELECT',
    v_made, v_skip, v_granted;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 事後斷言 ⑤(codex must-fix ②):policy 的【內容】也要驗
--   🔴 第一版只驗「有一條 SELECT policy 且角色含 service_role」——
--      把它改成 `USING (false)` 或 `AS RESTRICTIVE`, 那個斷言【仍然綠】。
--      而 policy 的內容正是本支唯一要交付的東西。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pcm_rls_targets) THEN RETURN; END IF;
  SELECT string_agg(t.relname || '(' ||
                    COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '<null>') ||
                    CASE WHEN p.polpermissive THEN '' ELSE ' RESTRICTIVE' END || ')', ', ')
    INTO v_bad
    FROM pcm_rls_targets t
    LEFT JOIN pg_catalog.pg_policy p
      ON p.polrelid = t.reloid AND p.polname = t.relname || '_select_service_role'
   WHERE p.oid IS NULL
      OR p.polcmd NOT IN ('r','*')
      OR NOT p.polpermissive
      OR pg_catalog.pg_get_expr(p.polqual, p.polrelid) NOT IN ('true','(true)')
      OR NOT ('service_role' = ANY (SELECT ro.rolname FROM pg_catalog.pg_roles ro
                                     WHERE ro.oid = ANY (p.polroles)));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後斷言⑤:這幾張的 policy 不是「PERMISSIVE · SELECT · TO service_role · USING (true)」⇒ %', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 事後斷言 ⑥:表層 GRANT 也都到位
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pcm_rls_targets) THEN RETURN; END IF;
  SELECT string_agg(t.relname, ', ' ORDER BY t.relname) INTO v_bad
    FROM pcm_rls_targets t
   WHERE NOT pg_catalog.has_table_privilege('service_role', t.reloid, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後斷言⑥:這幾張 service_role 仍無表層 SELECT ⇒ %', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 事後斷言 ⑦ 負對照:anon / authenticated / PUBLIC 不准因為本支多拿到東西
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pcm_rls_targets) THEN RETURN; END IF;
  SELECT string_agg(t.relname || '(' || p.polname || ')', ', ') INTO v_bad
    FROM pcm_rls_targets t
    JOIN pg_catalog.pg_policy p ON p.polrelid = t.reloid
   WHERE p.polname = t.relname || '_select_service_role'
     AND ( p.polroles = '{0}'::oid[]
           OR 'anon'          = ANY (SELECT ro.rolname FROM pg_catalog.pg_roles ro
                                      WHERE ro.oid = ANY (p.polroles))
           OR 'authenticated' = ANY (SELECT ro.rolname FROM pg_catalog.pg_roles ro
                                      WHERE ro.oid = ANY (p.polroles)) );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後斷言⑦:本支建的 policy 把 anon/authenticated/PUBLIC 也放進來了 ⇒ %', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 事後斷言 ⑧(codex must-fix ⑦):排除的那 7 張, 驗的是**有沒有讀路**, 不是**有沒有那個名字**
--   🔴 第一版驗「有沒有叫 <表>_select_service_role 的 policy」⇒ 換個名字建就過了。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(c.relname || '(' || p.polname || ')', ', ') INTO v_bad
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relname IN (SELECT relname FROM pcm_rls_exclusions)  -- 🔴 單一來源(R2 must-fix ⑦)
     AND p.polcmd IN ('r','*')
     AND p.polpermissive
     AND ( p.polqual IS NULL
           OR pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN ('true','(true)') )
     AND ( p.polroles = '{0}'::oid[]
           OR 'service_role' = ANY (SELECT ro.rolname FROM pg_catalog.pg_roles ro
                                     WHERE ro.oid = ANY (p.polroles)) );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後斷言⑧:排除清單上的表取得了 service_role 的無條件讀路 ⇒ %
  (排除是決定, 不是遺漏。要改請先改 supabase/rls-service-role-select-exclusions.txt)', v_bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔵 格⑨:`SET LOCAL ROLE service_role` 實際讀一張
--   🛑 **只證表層 GRANT 那一半通了。** service_role 有 BYPASSRLS ⇒ 它讀得到與 policy 無關。
--   🔴 nit ⑩:檢查的是 **USAGE**(能不能 SET ROLE)不是 MEMBER ——
--      membership 的 SET option = false 時, MEMBER 為真而 `SET ROLE` 仍會炸, 整筆 rollback。
--   🔴 nit ⑪:用完**切回呼叫前那個角色**, 不用 `RESET ROLE` ——
--      `RESET ROLE` 回的是【連線預設角色】, 不是呼叫前那個(它是 session 語意, 不是區域變數)。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_t text; v_ok boolean; v_prev text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pcm_rls_targets) THEN RETURN; END IF;
  -- 🔴 codex R2 must-fix ④:R1 我把 MEMBER 改成 USAGE —— **改錯了**。
  --    PG 的 `USAGE` 是「不必 SET ROLE 就用得到那個角色的權限」(INHERIT);
  --    「能不能切過去」要問 `SET`。INHERIT=true 而 SET=false 時 USAGE 為真,
  --    而 `SET LOCAL ROLE` 仍會炸, 並把【整筆交易】帶走。
  IF NOT pg_catalog.pg_has_role(current_user, 'service_role', 'SET') THEN
    RAISE NOTICE '格⑨ 跳過:執行身分 % 不能 SET ROLE service_role ⇒ 這【不是通過】, 是沒驗。', current_user;
    RETURN;
  END IF;
  v_prev := current_user;
  SELECT relname INTO v_t FROM pcm_rls_targets ORDER BY relname LIMIT 1;
  EXECUTE format('SET LOCAL ROLE %I', 'service_role');
  -- 🔴 R3 F2:**不做 count(*)** —— 這一格排在 40 條 CREATE POLICY 之後、COMMIT 之前,
  --    那些 DDL 的排他鎖還握著;一發全表掃描會把鎖窗口拉長一整個 seq scan,
  --    而它若撞到 55s 的 statement_timeout, **整支 40 條會為了一個自認「證不到 policy」的探針回滾。**
  --    要證的只是「沒有 permission denied」⇒ EXISTS + LIMIT 1 就夠, O(1)。
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', v_t) INTO v_ok;
  EXECUTE format('SET LOCAL ROLE %I', v_prev);
  RAISE NOTICE '格⑨(只證 GRANT):以 service_role 讀 public.% ⇒ 讀得到(有無資料 = %), 沒有 permission denied。
  ⚠️ 它【證不到】policy 生效 —— service_role 有 BYPASSRLS。那由拋棄式 PG 的替身角色驗。', v_t, v_ok;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴🔴 回滾前態:**落成一張持久表**, 不是只印 NOTICE(R3 must-fix F1)
--   病灶:前一版把回滾 SQL 與 `had_grant_before` / `had_policy_before` 只寫進 `RAISE NOTICE`。
--   🔬 而本 repo 的兩條套用路徑**都不會把 NOTICE 交到人手上**:
--        · Supabase SQL Editor —— 只顯示最後一個 result grid
--        · MCP `apply_migration` —— 只回 success / error
--   ⇒ 🛑 **成功 COMMIT 的那個世界裡, 那份唯一的前態當場消失** ——
--     而本支自己的註解寫著「貼完之後 catalog 就重建不出來了」。
--   📌 一般化:**一份只存在於【輸出】裡的資料, 在輸出被吞掉的路徑上等於沒有產生過。**
--     ⇒ 要留的東西寫進**表**;NOTICE 只是給站在畫面前的人看的副本。
--   ⚠️ **未確認**:SQL Editor 到底吞不吞 NOTICE —— 缺的那一道檢查是
--     在 Dashboard 跑一次 `DO $$ BEGIN RAISE NOTICE 'x'; END $$;` 看畫面有沒有 x。
--     **而這支不賭那個答案**:兩種世界都成立的做法就是寫進表。
-- ─────────────────────────────────────────────────────────────────────────────
-- static-checks:no-grant-needed 本表刻意不給任何角色 GRANT —— 它的讀者是【人在回滾那一刻】(owner 身分),
--   不是後台也不是 service_role。給了等於開一條沒有人走的路, 而那正是本支在修的那個病的反面。
--
-- 🔴 **不用 `CREATE TABLE IF NOT EXISTS`**(migration-static-checks ① 擋下來的, 而它是對的):
--    撞名時 `IF NOT EXISTS` **靜靜跳過** ⇒ 下面的 REVOKE 與收權斷言會對著【那個既有物件】跑,
--    而且很可能通過 ⇒ **拿到綠燈, 而本支什麼都沒建。**
-- ✅ 改成明確分岔:不在就建;已在就**驗它是不是我認得的那一張**, 不是就當場炸。
--    (重跑時走「已在」那條, 而它有判準 —— 不是「跳過」。)
DO $$
DECLARE v_cols int;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_rls_rollback_20260904270000') IS NULL THEN
    CREATE TABLE public.pcm_rls_rollback_20260904270000 (
      relname            text PRIMARY KEY,
      had_grant_before   boolean NOT NULL,
      had_policy_before  boolean NOT NULL,
      captured_at        timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    SELECT count(*) INTO v_cols
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.pcm_rls_rollback_20260904270000'::regclass
       AND attnum > 0 AND NOT attisdropped
       AND attname IN ('relname','had_grant_before','had_policy_before','captured_at');
    IF v_cols <> 4 THEN
      RAISE EXCEPTION '撞名:public.pcm_rls_rollback_20260904270000 已存在, 而它【不是】本支認得的那張
  (期望四欄 relname/had_grant_before/had_policy_before/captured_at, 實際命中 % 欄)
  ⇒ 停下。不要讓後面的 REVOKE 與收權斷言對著一個不是我建的東西跑。', v_cols;
    END IF;
    RAISE NOTICE '前態快照表已存在且欄位對得上 ⇒ 沿用它(重跑;第一次那份前態才是真的, 下面 ON CONFLICT DO NOTHING)。';
  END IF;
END $$;

ALTER TABLE public.pcm_rls_rollback_20260904270000 ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_rls_rollback_20260904270000 -- 誰會讀它:【沒有人透過後台讀】。它是本支動手前的
--   前態快照, 只在【回滾時】由貼 SQL 的人(owner 身分)直接查, 而回滾 SQL 本支已經當成
--   最後一個 result grid 印出來了。後台沒有任何一頁讀它 ⇒ 補 service_role 政策等於開一條沒有人走的路。
--   🔴 而這正是本支要修的那個病的【同款】—— 所以這一行不是省事, 是一個要說得出理由的決定:
--      理由 = 這張表的讀者是【人在回滾那一刻】, 不是後台。
--   🔵 退場:收掉 service_role 的 BYPASSRLS 那一片之後 DROP 它(在那之前不要刪, 它是唯一一份前態)。
--      同款:dbk_external_id_rename_20260904。

-- ─────────────────────────────────────────────────────────────────────────────
-- 收權斷言:那張快照表【真的】對 anon / authenticated / PUBLIC 關著嗎
--   🔴 上面兩行 REVOKE 是【我寫的動作】, 這一段是【量到的結果】—— 兩個宣稱。
--      新物件在 Supabase 出生就自帶 anon 權限, 而 repo 內零 `GRANT` 字面可掃、三綠也不紅
--      ⇒ 只有回頭問 catalog 才知道收乾淨沒有。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_relations text[] := ARRAY['pcm_rls_rollback_20260904270000']::text[];
  v_rel text; v_bad text := '';
BEGIN
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', ('public.' || v_rel)::regclass, 'SELECT') THEN
      v_bad := v_bad || v_rel || '(anon 讀得到) ';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', ('public.' || v_rel)::regclass, 'SELECT') THEN
      v_bad := v_bad || v_rel || '(authenticated 讀得到) ';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                WHERE c.oid = ('public.' || v_rel)::regclass AND NOT c.relrowsecurity) THEN
      v_bad := v_bad || v_rel || '(RLS 沒開) ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '收權斷言:前態快照表沒有關乾淨 ⇒ %', v_bad;
  END IF;
END $$;

INSERT INTO public.pcm_rls_rollback_20260904270000(relname, had_grant_before, had_policy_before)
SELECT relname, had_grant_before, had_policy_before FROM pcm_rls_targets
ON CONFLICT (relname) DO NOTHING;   -- 重跑時不覆蓋第一次的前態(第一次那份才是真的)

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔵 回滾 SQL:當場產, 而且**當成最後一個 result grid 回出去**(不只 NOTICE)
--   🔴 R3 F4:`DROP POLICY` 只對【本支真的建了的】那些產 —— `had_policy_before` 為真的
--      表是「policy 對而缺 GRANT」那一種, 迴圈跳過沒建, 回滾去 DROP 它會刪掉不是我建的東西。
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COALESCE((SELECT string_agg(format('DROP POLICY IF EXISTS %I ON public.%I;',
                                     relname || '_select_service_role', relname), E'\n' ORDER BY relname)
              FROM public.pcm_rls_rollback_20260904270000 WHERE NOT had_policy_before),
           '(本支沒有建任何 policy)') AS 回滾_先跑這段,
  COALESCE((SELECT string_agg(format('REVOKE SELECT ON TABLE public.%I FROM service_role;', relname),
                              E'\n' ORDER BY relname)
              FROM public.pcm_rls_rollback_20260904270000 WHERE NOT had_grant_before),
           '(本支沒有補任何 GRANT)') AS 回滾_再跑這段,
  '前態已存進 public.pcm_rls_rollback_20260904270000;上面兩段也可以之後從那張表重新產出來。'
    AS 這份東西住在哪;

COMMIT;
