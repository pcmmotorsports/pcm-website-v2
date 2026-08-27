-- ============================================================
-- M-3 3DS 乙路 R1a3:mark_charge_attempt_released_for_user(server-only release CAS RPC)+ ACL
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1a3(逐字)+ §2.2/§2.3/§2.5 + §3 + §9 第 3 片 + §14 步 10。
-- canonical 經 Codex round4→round11 共 8 輪對抗審查、round11 PASS;本片 = §14 唯一 45 步序之步 10(R1 migration bundle 第三片)。
-- 依賴:20260612150000(payment_charge_attempts 表 + customer_user_id 反正規化)、20260613130000(orders.cart_session_id)、
--       20260615120001(settle_attempt_count/next_settle_at/needs_manual_review 欄)、**R1a1**(released 狀態 + released_at/
--       released_manual_review_at 欄;本片 UPDATE 寫入這些 → R1 bundle 必 R1a1 先於 R1a3 apply、模擬亦先套 R1a1 DDL)。
-- 鐵則 8(動 schema:新 SECDEF RPC + GRANT)由 canonical plan 滿足;鐵則 12(payment / 雙扣 / GRANT)→ codex K2 + Codex Packet。
--
-- 🔴 設計(canonical §2.2/§2.3/§2.5 + §4 R1a3 + §3):
--   ① 用途:立即重刷 preflight 在 settleCharge(existingOrderId) 確認 Record `auth_or_pending(4)` 後,由 server-only CAS
--      把客人放棄的舊 attempt 從 pending 轉 released → 退出「去重 / in-flight 鎖」讓立即重刷;真失敗未定、留對帳集 + per-order 唯一直到 terminal。
--   ② **server-only**:只 GRANT payment_confirmer(PgReleaseSiblingAdapter 用 payment_confirmer client、server-only 模組、絕不進 browser bundle)。
--      不信任 client 傳的 attempt/order/取消訊號 → 歸屬由 DB CAS **四閘**鎖死(§3):
--        a.id=p_attempt_id  AND  a.customer_user_id=p_user_id  AND  a.status='pending'
--        AND order(o.id=a.order_id).cart_session_id=p_cart_session_id  AND  order.payment_status='unpaid'
--      任一不符 → rowcount=0、status 不變(錯 user / 錯 cart / 已付款 / 非 pending 全否決)。
--   ③ release CAS 同交易重置(§2.5):status='released'、released_at=COALESCE(released_at,now())〔**write-once 不覆蓋**〕、
--      settle_attempt_count=0、needs_manual_review=false、released_manual_review_at=NULL、next_settle_at=now()+低頻
--      〔= 5 分鐘,對齊既有 sweeper lease/claim cadence(20260615120001 L142)、released 持續低頻對帳〕。
--   ④ 回 jsonb `{released: rowcount=1}`(true=成功 release / false=四閘任一否決;呼叫端據此 proceed 重刷 vs 重 settle/hold)。
--   ⑤ ACL(§4 R1a3 + §3):REVOKE PUBLIC/anon/authenticated/service_role + GRANT payment_confirmer;矩陣僅 payment_confirmer=true。
--      嵌入 has_function_privilege fail-closed assert。SECURITY DEFINER + search_path='' + 全識別子 schema-qualified。
--
-- ⚠️ 安全 / 守線:本片只寫 migration 檔 + MCP 模擬(零留痕);不 db push(= §14 步 21 Sean)、不 push/merge、不開 flag(TAPPAY_3DS_ENABLED false)。
--   begin / R1a1·R1a2 既有物件本片不動;失敗終態下界由 settleCharge/sweeper 治、anomaly=R1b1*、人工 close=R1c3 為後續片。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block 先套 R1a1 DDL
--   + 本片 RPC + 末端 RAISE 強制 rollback;模擬 R-CAS happy + 四閘否決四路 rowcount=0 + released_at write-once + ACL 矩陣;
--   payment_confirmer EXECUTE 走 has_function_privilege 等價〔SET ROLE payment_confirmer LOGIN + SECDEF 斷 pooled MCP、沿用 20260612150000 先例〕;
--   跑後 catalog 複查零留痕):結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考):DROP FUNCTION IF EXISTS public.mark_charge_attempt_released_for_user(uuid, uuid, uuid);
-- ============================================================


-- ── mark_charge_attempt_released_for_user(server-only payment_confirmer release CAS)──
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_released_for_user(
  p_attempt_id      uuid,
  p_user_id         uuid,
  p_cart_session_id uuid
)
RETURNS jsonb  -- {released: boolean}(true=CAS 成功 pending→released / false=四閘任一否決)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- 四閘 CAS:歸屬(user)+ 同 cart(order.cart_session_id)+ 未付款(order.payment_status=unpaid)+ 仍 pending
  UPDATE public.payment_charge_attempts a
     SET status                    = 'released',
         released_at               = COALESCE(a.released_at, pg_catalog.now()),  -- write-once、不覆蓋
         settle_attempt_count      = 0,
         needs_manual_review       = false,
         released_manual_review_at = NULL,
         next_settle_at            = pg_catalog.now() + interval '5 minutes'      -- 低頻、對齊 sweeper lease cadence
   WHERE a.id               = p_attempt_id
     AND a.customer_user_id = p_user_id
     AND a.status           = 'pending'
     AND EXISTS (
       SELECT 1
         FROM public.orders o
        WHERE o.id              = a.order_id
          AND o.cart_session_id = p_cart_session_id
          AND o.payment_status  = 'unpaid'::public.payment_status
     );

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('released', v_n = 1);
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_released_for_user(uuid, uuid, uuid) IS
  'M-3 3DS R1a3 server-only release CAS(payment_confirmer、SECDEF、search_path='''')。pending→released、退出去重/in-flight 鎖讓立即重刷。歸屬四閘 = id + customer_user_id + status=pending + order(同 cart_session_id + payment_status=unpaid),任一不符 rowcount=0 否決(錯 user/錯 cart/已付款/非 pending)。同交易重置 released_at(write-once COALESCE)/settle_attempt_count=0/needs_manual_review=false/released_manual_review_at=NULL/next_settle_at=now()+5min(低頻)。回 {released: rowcount=1}。只 payment_confirmer 可呼。';


-- ── ACL(canonical §4 R1a3 + §3:REVOKE PUBLIC/anon/authenticated/service_role、GRANT payment_confirmer)──
REVOKE ALL ON FUNCTION public.mark_charge_attempt_released_for_user(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_charge_attempt_released_for_user(uuid, uuid, uuid) TO payment_confirmer;

-- 🔴 函式權限矩陣 fail-closed assert(僅 payment_confirmer;任一不符 → 擋 db push)
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.mark_charge_attempt_released_for_user(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_charge_attempt_released_for_user(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.mark_charge_attempt_released_for_user(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.mark_charge_attempt_released_for_user(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mark_charge_attempt_released_for_user EXECUTE 權限矩陣異常 — 應僅 payment_confirmer(canonical §4 R1a3 ACL);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.mark_charge_attempt_released_for_user(uuid, uuid, uuid);
-- ============================================================
