-- ============================================================
-- M-3 3DS-0a:②-⑥ webhook durable inbox — payment_webhook_events 表 + record RPC
-- ============================================================
-- 真權威:docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md v5 §2(3DS-0a)/§3(webhook 規格)。
-- 依賴:20260611120000(payment_confirmer 角色、S2-c)。本片不依賴 charge_attempts(獨立新表)。
-- 鐵則 8(新表 + 新 RPC + GRANT)+ 鐵則 12(payment / 對帳 / 未驗證寫入口)。
--
-- 🔴 設計(master plan v5 §3):
--   ① durable inbox 先寫再回 200(codex r1 #4):webhook route 收 TapPay notify → record_webhook_event
--      INSERT ON CONFLICT(rec_trade_id) DO NOTHING(去重、at-least-once、TapPay 重送 1/2/4/8/16 分鐘×5)
--      → 先 durable 落 DB 再回 HTTP 200 → 背景 settleCharge;背景失敗留本表 processed=false 給 sweeper retry(非死信)。
--   ② 🔴 白名單存欄 + raw hash、不存原文(codex r1 #8):notify payload 含 pay_info.masked_credit_card_number /
--      card_identifier(token)→ 只存 rec_trade_id/order_number/reported_status/amount/bank_transaction_id/
--      transaction_time_millis + raw_body 的 sha256 hex(供事後鑑識、不落 PII)。
--   ③ notify 不可信(無簽章、WebFetch 官方核實):本表只記「收到動靜」、reported_status 僅稽核;成交權威
--      = settleCharge 內 Record API 反查(record_status=1+is_captured)、非本表欄位。
--   ④ 權限:寫入唯 SECURITY DEFINER record_webhook_event(只 GRANT payment_confirmer;webhook route 走
--      PAYMENT_CONFIRMER_DB_URL、零新密鑰)；表零直接權限(RLS enable 零 policy);service_role 寫權 REVOKE
--      保 SELECT(對齊 charge_attempts 紀律);🔴 payment_confirmer 顯式 REVOKE 表層 + role-hygiene 回歸 assert
--      (codex 關卡2 r1 must-fix、守 S2-c「payment_confirmer 零 table 權限」模型);RPC EXECUTE 全 REVOKE 再
--      精準 GRANT;全矩陣 fail-closed assert。
--   ⑤ sweeper(3DS-4)retry 索引:partial index(processed=false)供掃未處理 + next_retry_at 退避。
--   ⑥ 🔴 公開未驗證入口縱深防禦(codex 關卡2 r1 consider + r2):rec_trade_id/order_number/bank_transaction_id
--      加長度 CHECK(1-128;真值 <30 字)+ RPC 入口涵蓋欄 CHECK 拒絕集(三欄 btrim 空 OR >128;r2:bank 補空
--      字串、避空 bank 漏入口落表層 CHECK 露內部錯)→ 通用 RAISE 不洩內部、防 route 漏檢時儲存膨脹面。
--
-- ⚠️ 誠實揭示:
--   - 主軌 record RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/S2-d 已多次重現、環境限制)
--     → 等價證據 = has_function_privilege 矩陣 + owner 身分實跑行為 + search_path='' 函式屬性 caller 一致;
--     真連線 round-trip 由 3DS-2 webhook route 對 session pooler 真連線實測補。
--   - 端點未驗證寫入口加固(自定祕密路徑段 + rate-limit)在 3DS-2 route 層做(本 migration 不涉及)。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + 本 migration DDL + synthetic + DO 斷言 + ROLLBACK、零留痕;
--   project bmpnplmnldofgaohnaok PG17、2026-06-13;codex 關卡2 r1+r2 修正後重跑、整段零錯跑完 = 全 assert/行為測通過):PASS
--   - DDL 套用無誤(表 + 2 index + record_webhook_event RPC);in-migration 表層 ACL assert + RPC EXECUTE 矩陣
--     assert 全靜默通過(anon/authenticated 表全 false;service_role 表 SELECT=true、INSERT/UPDATE/DELETE/
--     TRUNCATE/REFERENCES/TRIGGER 全 false;🔴 payment_confirmer 表層 7 權限全 false〔r1 must-fix 補〕;
--     record_webhook_event EXECUTE 唯 payment_confirmer=true、其餘 false)。
--   - 行為(owner 身分實跑;SET ROLE payment_confirmer literal 受 pooled MCP 斷線限制、以 has_function_privilege
--     矩陣等價覆蓋、真連線 round-trip 由 3DS-2 webhook route 補):① 首見 record → true ② 重送同 rec_trade_id →
--     false(ON CONFLICT dedup)③ 白名單欄位落地 + processed=false + dedup 保 1 列 ④ null rec_trade_id → 通用 RAISE
--     ⑤ 非法 raw_hash → 通用 RAISE ⑥ partial unprocessed index 命中(processed=false)⑦ 超長 rec_trade_id(>128)
--     → 通用 RAISE〔r1 consider 長度防線〕⑧ 空字串 bank_transaction_id → 通用 RAISE〔r2 修點:入口擋、不落表層
--     CHECK〕⑨ 合法 bank_transaction_id 正常落地 → true。
--   - ROLLBACK 後複查:residue_table=null / residue_func=null / residue_idx=0 = 零留痕。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. payment_webhook_events 表(durable inbox;master plan v5 §3)──
CREATE TABLE public.payment_webhook_events (
  -- TapPay rec_trade_id = 去重主鍵(at-least-once 重送同筆 → ON CONFLICT DO NOTHING)
  -- 🔴 長度上限(codex r1 consider):公開未驗證入口 → 上限防儲存膨脹面(真值 <30 字、128 給 4x 餘裕)
  rec_trade_id           text PRIMARY KEY CHECK (length(rec_trade_id) BETWEEN 1 AND 128),
  -- 我方 order_number(= orderId;settleCharge 以此對本機單)
  order_number           text NOT NULL CHECK (length(order_number) BETWEEN 1 AND 128),
  -- notify 回報的交易狀態(🔴 不可信、僅稽核;成交權威走 Record API)
  reported_status        integer,
  amount                 integer,
  bank_transaction_id    text CHECK (bank_transaction_id IS NULL OR length(bank_transaction_id) BETWEEN 1 AND 128),
  transaction_time_millis bigint,
  -- raw body 的 sha256 hex(鑑識用;🔴 不存原文 = 不落 masked_credit_card_number / card_identifier PII)
  raw_hash               text NOT NULL CHECK (raw_hash ~ '^[0-9a-f]{64}$'),
  -- 背景 settleCharge 處理狀態(sweeper retry worker 用、非死信)
  processed              boolean NOT NULL DEFAULT false,
  attempt_count          integer NOT NULL DEFAULT 0,
  last_error             text,
  next_retry_at          timestamptz,
  received_at            timestamptz NOT NULL DEFAULT now(),
  processed_at           timestamptz
);

-- sweeper(3DS-4)掃未處理事件 + next_retry_at 退避
CREATE INDEX payment_webhook_events_unprocessed_idx
  ON public.payment_webhook_events (next_retry_at) WHERE processed = false;
-- 以 order_number 對單(settleCharge / 對帳)
CREATE INDEX payment_webhook_events_order_idx
  ON public.payment_webhook_events (order_number);

COMMENT ON TABLE public.payment_webhook_events IS
  'M-3 3DS-0a ②-⑥ webhook durable inbox(master plan v5 §3)。TapPay notify 落地點:rec_trade_id 去重主鍵、白名單欄位 + raw sha256 hash(不存原文=不落 PII)、processed/attempt_count/next_retry_at 供 sweeper retry(非死信)。notify 不可信(無簽章)、reported_status 僅稽核、成交權威走 settleCharge 內 Record API 反查。寫入唯 SECURITY DEFINER record_webhook_event(payment_confirmer)；表零直接權限(RLS 零 policy)。';

-- RLS enable、零 policy(非 owner 直查全拒;寫入唯 SECURITY DEFINER owner)
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

-- 表層權限終態:anon/authenticated 全零;service_role 寫權收、保 SELECT(對齊 charge_attempts 紀律)
-- 🔴 payment_confirmer 顯式 REVOKE(codex r1 must-fix):本表寫入唯 SECURITY DEFINER record_webhook_event
--    (owner 身分)、payment_confirmer 不得有任何「表層」直接權限 → 守 S2-c「payment_confirmer 零 table 權限」模型。
REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_webhook_events FROM service_role;
REVOKE ALL ON TABLE public.payment_webhook_events FROM payment_confirmer;
GRANT SELECT ON TABLE public.payment_webhook_events TO service_role;

-- fail-closed assert:表層 ACL 終態(Supabase default-privilege re-grant 漂移防線)
-- + payment_confirmer 表層零權限 role-hygiene 回歸(codex r1 must-fix、對齊 S2-d L471 慣例)
DO $$
BEGIN
  IF has_table_privilege('anon',          'public.payment_webhook_events', 'SELECT')
     OR has_table_privilege('anon',          'public.payment_webhook_events', 'INSERT')
     OR has_table_privilege('anon',          'public.payment_webhook_events', 'UPDATE')
     OR has_table_privilege('anon',          'public.payment_webhook_events', 'DELETE')
     OR has_table_privilege('authenticated', 'public.payment_webhook_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_webhook_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payment_webhook_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payment_webhook_events', 'DELETE')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'INSERT')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'UPDATE')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'DELETE')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'TRUNCATE')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'REFERENCES')
     OR has_table_privilege('service_role',  'public.payment_webhook_events', 'TRIGGER')
     OR NOT has_table_privilege('service_role', 'public.payment_webhook_events', 'SELECT')
     -- payment_confirmer 表層零權限(寫入唯 SECURITY DEFINER RPC;S2-c「零 table 權限」模型不破)
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'INSERT')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'UPDATE')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'DELETE')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'TRUNCATE')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'REFERENCES')
     OR has_table_privilege('payment_confirmer', 'public.payment_webhook_events', 'TRIGGER') THEN
    RAISE EXCEPTION 'payment_webhook_events 表層 ACL 異常 — 應 anon/authenticated/payment_confirmer 全零、service_role 唯 SELECT;拒繼續';
  END IF;
END
$$;


-- ── 2. record_webhook_event(durable inbox 去重落地;master plan v5 §3.2)──
-- webhook route 收 notify → 呼此 → INSERT ON CONFLICT DO NOTHING(去重)→ 回 inserted(true=首見、false=重送)。
-- 🔴 不採信 notify 任何欄位做成交判斷;本 RPC 只負責「durable 記錄收到了」。SECURITY DEFINER + search_path=''
-- + 全識別子 schema-qualified;只 GRANT payment_confirmer(webhook route 走 PAYMENT_CONFIRMER_DB_URL)。
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_rec_trade_id           text,
  p_order_number           text,
  p_raw_hash               text,
  p_reported_status        integer DEFAULT NULL,
  p_amount                 integer DEFAULT NULL,
  p_bank_transaction_id    text    DEFAULT NULL,
  p_transaction_time_millis bigint DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_generic_msg constant text := 'record_webhook_event: 無法記錄';  -- 通用訊息(不洩內部)
  v_inserted boolean;
BEGIN
  -- 入口 fail-closed:必要欄非空 + 長度上限(codex r1 consider、與欄 CHECK 同界、通用 RAISE 不洩內部)
  -- + raw_hash 格式(防垃圾灌入)
  -- 入口 fail-closed 涵蓋欄 CHECK 全部拒絕集 + 額外擋純空白(codex r2:bank 入口原只擋 >128 漏空字串 → 三欄
  -- 一致 btrim 空 OR >128;rec/order 必填、bank 可 null 但非 null 時同檢;通用 RAISE 不洩內部、不落表層 CHECK 錯)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 128
     OR p_order_number IS NULL OR pg_catalog.btrim(p_order_number) = '' OR pg_catalog.length(p_order_number) > 128
     OR (p_bank_transaction_id IS NOT NULL
         AND (pg_catalog.btrim(p_bank_transaction_id) = '' OR pg_catalog.length(p_bank_transaction_id) > 128))
     OR p_raw_hash IS NULL OR p_raw_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  INSERT INTO public.payment_webhook_events
    (rec_trade_id, order_number, raw_hash, reported_status, amount, bank_transaction_id, transaction_time_millis)
  VALUES
    (p_rec_trade_id, p_order_number, p_raw_hash, p_reported_status, p_amount, p_bank_transaction_id, p_transaction_time_millis)
  ON CONFLICT (rec_trade_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;  -- true=首見(需排程 settleCharge)/ false=重送(已存、no-op)
END
$fn$;

COMMENT ON FUNCTION public.record_webhook_event(text, text, text, integer, integer, text, bigint) IS
  'M-3 3DS-0a:②-⑥ webhook durable inbox 去重落地。INSERT ON CONFLICT(rec_trade_id) DO NOTHING、回 inserted。notify 不可信、本 RPC 不做成交判斷(權威走 settleCharge Record API)。只 payment_confirmer 可呼。';

-- RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer(Supabase 對新函式預設給 service_role EXECUTE → 顯式 REVOKE)
REVOKE ALL ON FUNCTION public.record_webhook_event(text, text, text, integer, integer, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, integer, integer, text, bigint)
  TO payment_confirmer;

-- fail-closed assert:RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false)
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.record_webhook_event(text, text, text, integer, integer, text, bigint)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.record_webhook_event(text, text, text, integer, integer, text, bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_webhook_event(text, text, text, integer, integer, text, bigint)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_webhook_event(text, text, text, integer, integer, text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_webhook_event EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動):
--   DROP FUNCTION IF EXISTS public.record_webhook_event(text, text, text, integer, integer, text, bigint);
--   DROP TABLE IF EXISTS public.payment_webhook_events;
-- ============================================================
