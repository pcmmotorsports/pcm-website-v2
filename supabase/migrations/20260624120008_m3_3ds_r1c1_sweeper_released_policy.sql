-- ============================================================
-- M-3 3DS R1c1:sweeper released 專用 policy — claim 繞 ceiling 含 released + mark_retry 不誤標 + 12h 人工標記
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §4 R1c1(行190-191、point 14)+ §2.5 + §9 表(行304)。
-- 依賴(功能):20260612150000(payment_charge_attempts 表)、20260615120001(4a-2:settle_attempt_count/next_settle_at/
--   needs_manual_review/last_settle_error 4 欄 + 4 sweeper RPC〔本片 CREATE OR REPLACE 其中 2 支〕)、
--   **R1a1**(20260624120000:status 加 'released' + released_at/released_manual_review_at 欄 + per-order index 含 released;
--   本片 claim/mark_retry 讀寫 released 狀態 + released_at/released_manual_review_at 欄 → R1 bundle 必 R1a1 先於 R1c1 apply)。
-- 鐵則 8(改既有 payment 對帳 RPC 行為)+ 鐵則 12(payment / 對帳 sweeper、窄權、零 PII、fail-closed)。
--
-- 🔴 設計(canonical §4 R1c1 point 14 + §2.5,逐字):
--   sweeper(claim/expire/flag/mark_retry)納 released 專用 policy。本片只 CREATE OR REPLACE **2 支**(claim/mark_retry);
--   expire / flag **不改本體**(理由見下〔E〕〔F〕),由模擬回歸 assert 證 released 不被其碰。
--   ① **claim_stuck_unsettled_attempts**:released 繞 manual/ceiling 閘被 claim(§2.5「持續低頻對帳直到 terminal」);
--      pending/charged 維持既有 manual/ceiling 閘;**unpaid + lease/throttle + age-gate 對所有狀態保留**。released claim
--      仍 settle_attempt_count++(token、不當 ceiling 用)+ 5min lease(沿用既有 UPDATE 本體、不改)。
--   ② **mark_attempt_settle_retry**:status 集加 released;**ceiling→needs_manual_review 僅 pending/charged**(released 繞
--      ceiling、**不誤標 needs_manual_review**、§2.5);released 達 12h(released_at <= now()-12h)仍非 paid →
--      **標 released_manual_review_at(獨立欄、write-once COALESCE、≠ 停止對帳;sweeper 仍持續低頻對帳)**;退避公式
--      指數加 cap 16 防 int4 溢位〔G〕(released 繞 ceiling 後 count 無界、見下〔G〕);token guard / last_settle_error
--      allowlist / order-unpaid 閘 / 不 ++ 全沿用基線不改。
--
-- 🔴 對 plan §4 R1c1 的 2 處「實作判斷揭示」〔E〕〔F〕(動手前 adversarial timeline 自審逮、下方模擬實證;審查側請逐條核):
--   〔E〕**expire_stuck_attempts_at_ceiling 不改本體** — plan「expire 不碰 released」由既有 predicate
--        `a.status IN ('pending','charged')` 天然排除 released → 零改動即滿足。本片不 REPLACE expire(零漂移)、由模擬
--        SWEEP-6 assert「released 不被 expire 標」。
--   〔F〕**flag_non_unpaid_active_attempts 不改本體 + released-on-non-unpaid 前瞻盲點(單一根因兩面、adversarial F2+F3
--        triage 合併)** — plan point 14 對 flag **未列任何 released 專屬行為**(parenthetical 僅列舉 sweeper 4 支);flag 既有
--        predicate `a.status IN ('pending','charged')` 已排除 released → 沿用 status quo = 最小漂移、不自行發明 spec 外行為。
--        **前瞻盲點(誠實揭示、Phase 1 不可達、非本片治)**:released 之 order 若變 refunded/partiallyPaid,則同一根因衍生
--        **兩面**:① flag 不收 released(status 閘)② mark_retry 的 order-unpaid 閘使其永不 fire → **12h released_manual_review_at
--        marker 永不寫**(marker 唯一寫者=mark_retry)→ 該 released 完全隱形不對帳、不掛人工。Phase 1 released 僅由 R1a3
--        CAS(order unpaid)產生、其 order 無正常路徑變 refunded/partiallyPaid(雙扣明確化走 R1b1c released→charged、已非
--        released;Phase 1 無退款流程)→ 兩面皆不可達。屬 forward note,**Phase II 開退款前置**須一併處理(flag 納 released
--        + 12h marker 脫鉤 unpaid 閘,入 R2/Phase II 候選、單一 backlog 條目串兩面),**本片不擴 scope**。
--   〔G〕**退避指數 cap 16 防 int4 溢位(adversarial F4 triage 升級為必修)** — 基線 4a-2 退避 `power(2, count-1)::integer`
--        對 pending/charged 安全僅因 claim 的 `count<8` ceiling 隱含上界(指數 ≤7、2^7=128 < int4 max);released 繞 ceiling 後
--        settle_attempt_count **無界**,count 達 32(~7.5h 持續對帳、每 claim+1)→ `power(2,31)::integer`=2147483648 超 int4 max
--        2147483647 → **22003 整數溢位 → mark_retry 整句 throw** → 該 released 退避失效(回退 claim 5min lease=Record spam)
--        + 12h marker 永不寫(throw 在 SET 套用前)= **defeats 本片人工兜底**。reachable 在開 flag 後(R2a+released row 存在)。
--        修=指數先 `LEAST(...,16)` 再 power:2^4=16 已達分鐘 cap、指數 cap 任意 >=4 對所有 count(含 pending/charged)行為
--        **完全等價**、純防溢位 → pending/charged backoff 行為不變(但該行非 byte-equivalent、見零漂移聲明)。模擬 M6 證。
--   〔H〕**現行 app tree(R2a 接線前)released 經 record_unreachable 退避、非本片乾淨 released 路徑(adversarial F1 triage、字面
--        vs 事實)** — 現行 `parseActiveAttempt`(PgChargeAttemptAdapter)對 status∉{pending,charged} throw → settleCharge
--        inner catch(settle-charge.ts findActive)轉 `{kind:'pending', reason:'record_unreachable'}` → sweep markSettleRetry
--        仍被呼(故 mark_retry 對 released **會** fire、〔G〕溢位**因此**reachable;〔F〕12h marker 在 unpaid 單上**會**寫)。
--        本片 mark_retry 的 released 專屬分支(ceiling 繞過 / 12h marker)在 **R2a parser 接線(canonical §14 步23)** 後才走乾淨
--        路徑。**producer-gating 中和**:Phase 1 零 release CAS app caller(多方 grep) + `TAPPAY_3DS_ENABLED` flag off →
--        無 released row 產生 → 上述全部路徑 Phase 1 不可達;本片=前瞻正確 DB 基建,db-push 留 §14 步21、flag 全程 false。
--
-- 🔴 零漂移聲明:claim/mark_retry **僅改 released policy 相關行**(下方逐行標),pending/charged 對基線(20260615120001
--   4a-2)**行為等價**;其中 claim 全行 + mark_retry 除「退避指數 cap〔G〕」外 **byte-equivalent**,**唯一非 byte-equiv 改 =
--   mark_retry 退避指數加 `LEAST(...,16)`〔G〕**(pending/charged 行為仍完全等價=2^4 已達分鐘 cap、純防溢位)。ACL **沿用基線**
--   (CREATE OR REPLACE 不重置既有 GRANT/REVOKE、簽名未變 → payment_confirmer EXECUTE 持續;本片無 ALTER / 無新欄 /
--   無 REVOKE/GRANT、僅末端 fail-closed 矩陣 + role-hygiene 回歸 assert)。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d/0a/1b/4a-1/4a-2/s2b 多次
--   重現)→ 等價證據 = has_function_privilege 矩陣 + owner 身分行為矩陣 + search_path='' caller 一致 + 全域 grants=0。
--   真連線 round-trip 由 3DS-4c route(payment_confirmer 鑰、session pooler)補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、單一 atomic DO block 套 R1a1 DDL + 本片 2 函式 REPLACE + synthetic
--   orders/attempts + DO 斷言 + 末端 RAISE 強制 rollback、零留痕;見 commit body 摘要):
--   SWEEP-1 pending+unpaid+manual=F+count<8 → claim;SWEEP-2 pending+manual=T → 不 claim;SWEEP-3 charged+count>=8 →
--   不 claim;SWEEP-4 released+manual=T+count>=8 → 仍 claim(繞 manual/ceiling、count++);SWEEP-5 released+order paid →
--   不 claim(unpaid 閘);SWEEP-6 released(ceiling)→ expire 不碰(needs_manual_review 維持 false);SWEEP-7 released+
--   throttle 未到期 → 不 claim、到期 → claim;observed-retry:released mark_retry 不設 needs_manual_review + 達 12h
--   標 released_manual_review_at(write-once、重放不覆蓋)+ <12h 不標;released count=32(M6)mark_retry 不溢位、退避 cap
--   16min、12h marker 正常〔G〕;pending ceiling→manual 控制組;stale token no-op;flag 不碰 released;has_function_privilege
--   矩陣唯 payment_confirmer + 全域 role-hygiene grants=0。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 還原 20260615120001 4a-2 claim/mark_retry 兩函式
--   本體(見該檔 §3/§5);本片無 schema 變更、無欄、無 ACL 變更。
-- ============================================================


-- ── 1. claim_stuck_unsettled_attempts:released 繞 manual/ceiling 被 claim(其餘閘對所有狀態保留)──
-- 🔴 唯一改動 = WHERE 的 status/manual/ceiling 三閘重構為「(pending/charged 受 manual/ceiling)OR released」;
--    o.payment_status='unpaid' + lease/throttle + p_age_seconds + age-gate 三閘對所有狀態保留;UPDATE 本體(count++ +
--    5min lease)逐字不改。released 仍 ++ settle_attempt_count(token、released 不受 ceiling<8 擋)。
CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(
  p_age_seconds integer,
  p_limit       integer
)
RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE (
             ( a.status IN ('pending', 'charged')
               AND a.needs_manual_review = false
               AND a.settle_attempt_count < 8 )       -- pending/charged 維持既有 manual/ceiling 閘
             OR a.status = 'released'                  -- 🔴 released 繞 manual/ceiling(§2.5、持續低頻對帳直到 terminal)
           )
       AND o.payment_status = 'unpaid'::public.payment_status               -- 對所有狀態保留
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now()) -- lease/throttle、對所有狀態保留
       AND p_age_seconds >= 0
       AND a.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_age_seconds) -- age-gate、對所有狀態保留
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  UPDATE public.payment_charge_attempts a
     SET settle_attempt_count = a.settle_attempt_count + 1,
         next_settle_at = pg_catalog.now() + interval '5 minutes'
    FROM claimed
   WHERE a.id = claimed.id
  RETURNING a.id AS attempt_id, a.order_id AS order_id, a.settle_attempt_count AS settle_attempt_count;
$fn$;

COMMENT ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) IS
  'M-3 3DS-4a-2 + R1c1:原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT)。settle_attempt_count++(claim token)+ 5min lease;濾 ((status IN(pending,charged) AND 非 manual AND settle_attempt_count<8) OR status=released〔R1c1:released 繞 manual/ceiling、持續低頻對帳直到 terminal〕) AND order unpaid(含 charged-unpaid 群1)AND lease 到期 AND created_at < now()-p_age_seconds(p_age_seconds<0/NULL→空、fail-closed)。回 attempt_id/order_id/settle_attempt_count。只 payment_confirmer 可呼。';


-- ── 2. mark_attempt_settle_retry:released 不誤標 needs_manual_review + 達 12h 標 released_manual_review_at ──
-- 🔴 四處改動(下方逐行標),其餘(last_settle_error allowlist / token guard / order-unpaid 閘 / 不 ++)逐字不改:
--    (a) needs_manual_review 的 ceiling 觸發加 `status IN(pending,charged)` 限定 → released 繞 ceiling、永不誤標 manual;
--    (b) 新增 released_manual_review_at = released 達 12h(released_at <= now()-12h)write-once COALESCE、非 released 不動;
--    (c) WHERE status 集加 released;
--    (d) 退避指數 cap 16 防 int4 溢位〔G〕(adversarial F4 triage 升級:released 繞 ceiling 後 count 無界、count=32 →
--        power(2,31)::integer 溢位;pending/charged 對基線**行為等價非 byte-equivalent**=本片唯一非 byte-equiv 改、防溢位)。
CREATE OR REPLACE FUNCTION public.mark_attempt_settle_retry(
  p_attempt_id    uuid,
  p_claimed_count integer,
  p_reason_code   text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET next_settle_at = pg_catalog.now()
             -- 🔴(d)退避指數先 cap 16 再 power 防 int4 溢位〔G〕:released 繞 ceiling → settle_attempt_count 無界
             --       (基線 pending/charged 受 count<8 隱含上界、不溢位;released 移除該上界後 count 達 32 →
             --       power(2,31)::integer 超 int4 max 22003 → mark_retry throw → 退避/12h marker 全失效)。
             --       2^4=16 已達分鐘 cap → 指數 cap 任意 >=4 對所有 count 行為等價、純防溢位(行為不變、模擬 M6 證)。
             + pg_catalog.make_interval(mins =>
                 LEAST(pg_catalog.power(2, LEAST(GREATEST(a.settle_attempt_count - 1, 0), 16))::integer, 16)),
           last_settle_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'auth_or_pending')
               THEN p_reason_code ELSE 'unknown' END,
           -- 🔴(a)ceiling→manual 僅 pending/charged;released 繞 ceiling、不誤標 needs_manual_review(§2.5)
           needs_manual_review = (a.needs_manual_review
                                  OR (a.status IN ('pending', 'charged') AND a.settle_attempt_count >= 8)),
           -- 🔴(b)released 達 12h 仍非 paid → 標 released_manual_review_at(獨立欄、write-once COALESCE、≠ 停止對帳;§2.5 / §4 R1c1)
           released_manual_review_at = CASE
             WHEN a.status = 'released'
               AND a.released_at IS NOT NULL
               AND a.released_at <= pg_catalog.now() - interval '12 hours'
               THEN COALESCE(a.released_manual_review_at, pg_catalog.now())
             ELSE a.released_manual_review_at END
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.id = p_attempt_id
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.status IN ('pending', 'charged', 'released')   -- 🔴(c)status 集加 released
       AND a.settle_attempt_count = p_claimed_count
       AND a.needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) IS
  'M-3 3DS-4a-2 + R1c1:pending outcome 退避 retry。next_settle_at=2^(settle_attempt_count-1) 封頂 16min;**ceiling(>=8)→needs_manual_review 僅 pending/charged**(R1c1:released 繞 ceiling、不誤標 manual);**released 達 12h(released_at<=now()-12h)→ released_manual_review_at write-once COALESCE(獨立欄、≠ 停止對帳)**;last_settle_error 固定錯誤碼集(零 PII)。token guard(settle_attempt_count=p_claimed_count + needs_manual_review=false + order unpaid + status IN(pending,charged,released))防 stale/late mark/平行已付款單。不 ++(遞增唯一在 claim)。回 affected(1=已退避、0=no-op)。只 payment_confirmer 可呼。';


-- ── 3. fail-closed assert:本片 REPLACE 的 2 RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false;ACL 沿用基線、回歸驗)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R1c1 sweeper released-policy RPC EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 4. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(本片無 ALTER、回歸驗不退步;對齊 4a-2 §8 / s2b §5)──
DO $$
DECLARE
  v_tbl_grants integer;
  v_col_grants integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_tbl_grants
    FROM information_schema.role_table_grants
   WHERE grantee = 'payment_confirmer';
  SELECT pg_catalog.count(*) INTO v_col_grants
    FROM information_schema.role_column_grants
   WHERE grantee = 'payment_confirmer';
  IF v_tbl_grants <> 0 OR v_col_grants <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動、還原 20260615120001 4a-2 本體):
--   CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) ... (4a-2 §3 原 WHERE:status IN
--     (pending,charged) AND unpaid AND 非 manual AND count<8 AND lease AND age-gate;UPDATE count++ + 5min lease)
--   CREATE OR REPLACE FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) ... (4a-2 §5 原 SET:退避 +
--     last_settle_error + needs_manual_review=(manual OR count>=8);WHERE status IN(pending,charged))
--   -- 本片無 schema/欄/ACL 變更,rollback 僅還原 2 函式本體。
-- ============================================================
