-- ============================================================
-- M-3 3DS 乙路 R1b1a:雙扣 anomaly 主表 + append-only event 表 + constraints + 兩表 RLS/table ACL
-- ============================================================
-- 真權威:docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md(過 prd_review、codex K1 round3 = PASS 0 must-fix)§2/§4/§8
--          + docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1b1a(行 155-164、逐字)+ §3 + §7 + §9 第 4 片 + §14 步 13。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;PRD 經 codex K1 round1→3、round3 PASS;本片 = §14 唯一 45 步序之步 13(R1 migration bundle 第四片)。
-- 依賴:20260604120000(orders.id uuid PK / orders.total integer / payment_status enum)、20260612150000(payment_charge_attempts.id uuid PK)、20260611120000(payment_confirmer 角色 NOLOGIN-非-super)。
--       🔴 **本片只建兩表 + 約束 + 兩表安全;claim/resolve RPC = R1b1b、markCharged genesis(寫入 anomaly)= R1b1c —— 皆非本片。**
-- 鐵則 8(動 schema:2 新表 + RLS + REVOKE)由 canonical/PRD 滿足;鐵則 12(payment / 雙扣 / 退款稽核 / 表層安全 / GRANT)→ codex K2 + Codex Packet。L3(退款營運資料)→ 過 prd_review 才實作(✅ 已過)。
--
-- 🔴 設計(PRD §2/§4 + canonical §4 R1b1a):
--   ① 主表 payment_double_charge_anomalies = released→charged late success「雙扣明確化」留痕點(genesis 寫入在 R1b1c)。
--      id uuid PK / old_attempt_id uuid UNIQUE NOT NULL(FK attempt;UNIQUE 只防重複 anomaly row)/ old_order_id(FK order)/
--      user_id / cart_session_id / rec_trade_id / refund_target_rec_trade_id(固定 = 舊 attempt rec、建立後不可改、絕不指向新單;immutability 由 R1b1b RPC 守)/
--      released_at(取自 attempt 欄)/ charged_at / amount integer CHECK>=0(取 orders.total 整數快照、禁浮點)/ status 4 態 + 6 稽核欄 / created_at。
--   ② status CHECK = open|refunding|refunded|dismissed;refunded/dismissed 不可逆終態(轉移 guard 在 R1b1b RPC)。
--      4 態一致性 CHECK(round8 二:reopen note 移 event 表後主表 open 維持乾淨):
--        open       → claimed/resolved/note/provider 皆 NULL
--        refunding  → claimed 非 NULL、resolved NULL
--        refunded   → claimed + resolved 非 NULL、refund_target 非 NULL、provider 非空
--        dismissed  → resolved + note 非 NULL、provider NULL
--   ③ append-only event 表 payment_double_charge_anomaly_events:每個狀態操作 / 退款結果同交易寫對應 event(s)
--      (reopen 寫 refund_not_executed + reopened 兩筆);event_type 6 值 allowlist;actor_session_role 寫 session_user(DB role、非真人 staff)。
--      🔴 **append-only = RPC 路徑 + ACL 層級保證:不提供 UPDATE/DELETE RPC(R1b1b 只 INSERT)+ table ACL 全 REVOKE → 無角色可直接改/刪;owner/postgres 物理上仍可改、非 DB 強制不可竄改(canonical line 162)。**
--   ④ 兩表 RLS zero-policy(無 policy = 非 owner/postgres 全拒)+ REVOKE ALL ON TABLE 5 角色(PUBLIC/anon/authenticated/service_role/payment_confirmer)。
--      payment_confirmer 維持零 table/column 權限(本片不寫 RPC;R1b1b/R1b1c SECDEF RPC 才以 owner 身分寫)。W1 報表 + 退款走 owner/postgres、不開 service_role 直讀(故 service_role 亦零、與 0a 保 SELECT 不同)。
--      fail-closed assert:has_table_privilege 矩陣(4 負向角色 × 7 權限全 false)+ role_table_grants=0 + role_column_grants=0(坐實「零 table/column 權」、PRD §4.1 codex should-fix)。
--   ⑤ 🔴 誠實(canonical §4 R1b1a line 164 / §7):old_attempt_id UNIQUE 只防重複 anomaly row;CAS(R1b1b)只序列化系統內退款工作,
--      **無法物理阻止 Sean 在 TapPay Dashboard 手動點兩次退款**(防呆 = claim CAS + runbook + 狀態查證 + 不確定 fail-closed 保持 refunding)。**不得寫成「CAS 完全防止 Dashboard 重複退款」。**
--
-- ⚠️ 守線:本片只新增 1 migration 檔 + MCP 模擬(零留痕);不 db push(= §14 步 21 Sean、連帶 S2b=live)、不 push/merge、不開 flag(TAPPAY_3DS_ENABLED false)。
--   begin / R1a1-a3 既有物件本片不動(純新建兩表 + index + 安全;無 RPC、無 ALTER 既有表)。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block:本片完整 DDL → 引用 prod 既有 order/attempt id 滿足 FK(唯讀引用、anomaly 插入皆在 DO block 內 rollback)→ 行為測 → 末端 RAISE 強制 rollback、零留痕、跑後 catalog residue=0):
--   - catalog:兩表存在、逐欄型別/NOT NULL、PK、old_attempt_id UNIQUE、3 FK、amount/status/event_type/4 態一致性 CHECK、RLS enabled。
--   - ACL 矩陣:has_table_privilege 兩表 × {anon,authenticated,service_role,payment_confirmer} × 7 權限全 false;role_table_grants/role_column_grants 4 角色 = 0。
--   - 行為:① 合法 open 落地 ② open 帶 claimed → 一致性 CHECK 否決 ③ 合法 refunding ④ refunding 帶 resolved → 否決 ⑤ 合法 refunded(provider 非空)⑥ refunded provider 空字串 → 否決 ⑦ 合法 dismissed ⑧ dismissed 帶 provider → 否決 ⑨ amount<0 → 否決 ⑩ old_attempt_id 重複 → UNIQUE 否決 ⑪ 壞 FK(attempt/order 不存在)→ FK 否決 ⑫ event 合法落地 ⑬ event_type 非 allowlist → 否決 ⑭ event anomaly_id 壞 FK → 否決。
--   結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. 主表 payment_double_charge_anomalies ──
CREATE TABLE public.payment_double_charge_anomalies (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  old_attempt_id              uuid        NOT NULL UNIQUE REFERENCES public.payment_charge_attempts(id),  -- UNIQUE 只防重複 anomaly row
  old_order_id                uuid        NOT NULL REFERENCES public.orders(id),
  user_id                     uuid        NOT NULL,
  cart_session_id             uuid        NOT NULL,
  rec_trade_id                text        NOT NULL,
  refund_target_rec_trade_id  text        NOT NULL,   -- 固定 = 舊 attempt rec、建立後不可改(R1b1b RPC 守)、絕不指向新單
  released_at                 timestamptz NOT NULL,   -- 取自 attempt.released_at
  charged_at                  timestamptz NOT NULL,
  amount                      integer     NOT NULL CHECK (amount >= 0),   -- 取 orders.total 整數快照、禁浮點
  status                      text        NOT NULL DEFAULT 'open',
  refund_claimed_at           timestamptz,
  refund_claimed_by           text,
  resolved_at                 timestamptz,
  resolved_by                 text,
  resolution_note             text,
  refund_provider_reference   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_double_charge_anomalies_status_check
    CHECK (status IN ('open', 'refunding', 'refunded', 'dismissed')),

  -- 4 態一致性(canonical §4 R1b1a line 159、round8 二):依 status 鎖稽核欄 NULL/非 NULL 形態
  CONSTRAINT payment_double_charge_anomalies_status_consistency_check CHECK (
    CASE status
      WHEN 'open' THEN
            refund_claimed_at IS NULL AND refund_claimed_by IS NULL
        AND resolved_at IS NULL AND resolved_by IS NULL
        AND resolution_note IS NULL AND refund_provider_reference IS NULL
      WHEN 'refunding' THEN
            refund_claimed_at IS NOT NULL AND refund_claimed_by IS NOT NULL
        AND resolved_at IS NULL AND resolved_by IS NULL
      WHEN 'refunded' THEN
            refund_claimed_at IS NOT NULL AND refund_claimed_by IS NOT NULL
        AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND refund_target_rec_trade_id IS NOT NULL
        AND refund_provider_reference IS NOT NULL
        AND pg_catalog.btrim(refund_provider_reference) <> ''
      WHEN 'dismissed' THEN
            resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL
        AND refund_provider_reference IS NULL
      ELSE false   -- unreachable(status_check 已限 4 值);fail-closed
    END
  )
);

COMMENT ON TABLE public.payment_double_charge_anomalies IS
  'M-3 3DS R1b1a 雙扣 anomaly 主表(PRD §2.1 + canonical §4 R1b1a)。released→charged late success 雙扣明確化留痕(genesis 寫入在 R1b1c markCharged 同交易)。old_attempt_id UNIQUE 只防重複 row(非防 Dashboard 重複退);refund_target_rec_trade_id 固定舊 attempt rec、絕不指向新單、建立後不可改;amount 取 orders.total 整數禁浮點。status open|refunding|refunded|dismissed(refunded/dismissed 不可逆、轉移在 R1b1b RPC);4 態一致性 CHECK 鎖稽核欄形態。RLS zero-policy + table ACL 5 角色全零(payment_confirmer 零表權)、寫入唯 R1b1c/R1b1b SECDEF owner RPC。';

COMMENT ON COLUMN public.payment_double_charge_anomalies.refund_target_rec_trade_id IS
  '退款目標 = released→charged 舊 attempt 的 rec_trade_id(絕不指向重刷新單);建立後不可被 claim/resolve 修改(R1b1b RPC 守 immutability)。';


-- ── 2. append-only 稽核 event 表 payment_double_charge_anomaly_events ──
CREATE TABLE public.payment_double_charge_anomaly_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id          uuid        NOT NULL REFERENCES public.payment_double_charge_anomalies(id),
  event_type          text        NOT NULL,
  from_status         text,
  to_status           text,
  actor_session_role  text        NOT NULL,   -- 寫 session_user(R1b1b RPC)、記 DB session role、非真人 staff ID
  note                text        NOT NULL,
  provider_reference  text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_double_charge_anomaly_events_event_type_check
    CHECK (event_type IN ('claim', 'refund_confirmed', 'refund_not_executed', 'refund_uncertain', 'reopened', 'dismissed'))
);

-- 依 anomaly 查稽核時序(W1 報表 / 稽核軌)
CREATE INDEX payment_double_charge_anomaly_events_anomaly_idx
  ON public.payment_double_charge_anomaly_events (anomaly_id, created_at);

COMMENT ON TABLE public.payment_double_charge_anomaly_events IS
  'M-3 3DS R1b1a append-only 稽核 event 表(PRD §2.2 + canonical §4 R1b1a line 160-162)。anomaly 每個狀態操作 / 退款結果同交易寫對應 event(s)(reopen 寫 refund_not_executed + reopened 兩筆)。event_type 6 值 allowlist;actor_session_role 寫 session_user(DB session role、非真人 staff)。🔴 append-only = RPC 路徑 + ACL 層級:無 UPDATE/DELETE RPC(R1b1b 只 INSERT)+ table ACL 全 REVOKE → 無角色可直接改/刪;owner/postgres 物理仍可改、非 DB 強制不可竄改。';


-- ── 3. 兩表 RLS zero-policy + table ACL(canonical §4 R1b1a line 163;PRD §4.1)──
-- RLS enable + 零 policy:非 owner/postgres 直查全拒。寫入唯 R1b1c/R1b1b SECDEF owner RPC。
ALTER TABLE public.payment_double_charge_anomalies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_double_charge_anomaly_events   ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL ON TABLE 5 角色(撤 Supabase 對新表的 default-privilege re-grant;service_role 亦撤、不開直讀)
REVOKE ALL ON TABLE public.payment_double_charge_anomalies      FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
REVOKE ALL ON TABLE public.payment_double_charge_anomaly_events FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

-- 🔴 fail-closed assert:兩表表層 ACL 終態(4 負向角色 × 7 權限全零)+ role_table_grants=0 + role_column_grants=0(坐實零 table/column 權、PRD §4.1)
DO $$
DECLARE
  v_tbl  text;
  v_role text;
  v_priv text;
  v_cnt  integer;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['public.payment_double_charge_anomalies', 'public.payment_double_charge_anomaly_events'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'payment_confirmer'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'anomaly 表層 ACL 異常 — % 不應有 % 之 % 權限(應 anon/authenticated/service_role/payment_confirmer 全零);拒繼續', v_role, v_tbl, v_priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- role_table_grants 顯式 grant 零(canonical line 163)
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('payment_double_charge_anomalies', 'payment_double_charge_anomaly_events')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'payment_confirmer');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'anomaly 兩表 role_table_grants 非零(% 筆)— 應 4 角色零 table 顯式 grant;拒繼續', v_cnt;
  END IF;

  -- role_column_grants 零(坐實「零 column 權限」字面、PRD §4.1 codex should-fix)
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_column_grants
   WHERE table_schema = 'public'
     AND table_name IN ('payment_double_charge_anomalies', 'payment_double_charge_anomaly_events')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'payment_confirmer');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'anomaly 兩表 role_column_grants 非零(% 筆)— 應 4 角色零 column 權;拒繼續', v_cnt;
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP TABLE IF EXISTS public.payment_double_charge_anomaly_events;
--   DROP TABLE IF EXISTS public.payment_double_charge_anomalies;
-- ============================================================
