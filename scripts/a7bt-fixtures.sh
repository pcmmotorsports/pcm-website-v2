#!/usr/bin/env bash
# ============================================================
# A7b-T 共用 harness 原語 + SQL 片段(T2 正向鏈 / T3a 狀態機負測共用)
# ============================================================
# 🔴 本檔**只定義函式與常數、不執行任何動作** ⇒ 可以安全 source。
#    (`d1t2-rehearsal.sh` 的「被 source 時不跑 dispatch」是同一個紀律。)
#
# 🔴 為什麼要有這一檔:T3a 的負測必須用**與正向鏈完全相同的合法 edge**來造 fixture
#    (plan §7.3:「所有 fixture 必須經合法 edge 構造」)。把片段複製一份到第二個檔案
#    = 第二個會漂移的真相:哪天 T1 的 E5 backoff 公式改了,正向鏈轉紅、負測卻繼續
#    用舊形狀造 fixture 而全綠。⇒ 一份、兩邊 source。
#
# 🔴 `T2-` 前綴的 NOTICE 標記是歷史命名(這些片段原生於 T2),兩支 harness 共用同一組標記;
#    因為每支 harness 各自解析自己那次 psql 的輸出,不會互相汙染。
#
# 誠實邊界:本檔不證明任何事,它只是把「怎麼合法地把一筆退款 job 推到某個狀態」寫成
# 可重複執行的 SQL。證明在兩支 harness 各自的斷言裡。
# ============================================================

PORT=54329
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }
die() { printf '  🔴🔴 當場中止:%s\n' "$1"; exit 1; }

# workdir 身分閘(呼叫端會 rm -rf 它)
guard_workdir() {  # $1=workdir
  case "$(cd / && printf '%s' "$1")" in
    /tmp/?*) : ;;
    *) echo "🔴 workdir 必須在 /tmp 底下(收到:$1)"; exit 2 ;;
  esac
  case "$1" in *..*) echo "🔴 workdir 不得含 ..(收到:$1)"; exit 2 ;; esac
}

runsql() { psql "$URL" -qtA -c "$1" 2>&1; }

# 🔴 `all` 模式 rm -rf workdir **之前**必須先停掉還佔著 54329 的舊 cluster。
#    2026-07-31 T3a 實測踩到:舊 postmaster 還活著 ⇒ `rm -rf` 把它的 pgdata 刪掉,
#    新的 initdb 完成後 `pg_ctl start` 直接 `Address already in use` ⇒ provision 失敗。
#    這與 memory `feedback_prove-the-page-loaded-your-asset-before-measuring` 同型:
#    量測前先確認自己連到的是**這一輪**建的那台。
stop_stale_cluster() {  # $1=workdir
  local pgbin
  pgbin="$(dirname "$(command -v pg_ctl 2>/dev/null || echo /usr/bin/pg_ctl)")"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
  [ -d "$1/pgdata" ] && "$pgbin/pg_ctl" -D "$1/pgdata" stop -m fast >/dev/null 2>&1
  sleep 1
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "🔴 埠 $PORT 仍被佔用,而它不是 $1/pgdata 這台 ⇒ 停下(硬跑會 initdb 成功但 start 失敗)"
    exit 1
  fi
}

# 🔴 fail-closed 快照(A1 的教訓:查詢自己語法錯誤時 base 與 after 會是同一則 ERROR ⇒
#    diff 為空 ⇒ 判成「零漂移」。三道:退出碼 / stderr 空 / 補 sentinel)。
snapshot() {  # $1=SQL $2=輸出檔 $3=用途
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1" > "$2" 2>"$2.err"
  local rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$2.err" ]; then
    echo "🔴 快照查詢失敗($3,rc=$rc):$(head -1 "$2.err" 2>/dev/null)"; exit 1
  fi
  printf 'SNAPSHOT-OK\n' >> "$2"
}

# ── 結構快照:harness 自己的比對基準(**不是** T1 §9.x 的斷言,不冒充它)──
#    用途只有一個:證明跑完整套鏈與注入之後,catalog 一個 byte 都沒被動到。
STRUCT_SQL="SELECT md5(concat(
  (SELECT coalesce(string_agg(pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, E'\n' ORDER BY t.tgname), '')
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refund_jobs','order_refund_job_items') AND NOT t.tgisinternal),
  (SELECT coalesce(string_agg(p.proname || '|' || md5(p.prosrc) || '|' || p.prosecdef::text || '|'
            || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || pg_get_userbyid(p.proowner) || '|'
            || coalesce(p.proacl::text, '(null)'), E'\n' ORDER BY p.proname), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'pcm\\_a7bt\\_%'),
  (SELECT coalesce(string_agg(c.relname || '.' || con.conname || '=' || pg_get_constraintdef(con.oid), E'\n'
            ORDER BY c.relname, con.conname), '')
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')),
  (SELECT coalesce(string_agg(indexdef, E'\n' ORDER BY indexdef), '')
     FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('order_refund_jobs','order_refund_job_items')),
  (SELECT coalesce(string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text
            || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), E'\n' ORDER BY a.attnum), '')
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.order_refund_jobs'::regclass AND a.attnum > 0 AND NOT a.attisdropped)))"

# ══════════════════════════════════════════════════════════════
# SQL 片段產生器(全部用 quoted heredoc:零 shell 展開、零引號地獄)
# ══════════════════════════════════════════════════════════════

sql_head() { cat <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  -- 🔴 IS NOT TRUE(不是 = false):條件為 NULL(例如查無列)也算失敗 = fail-closed。
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 斷言失敗:%', p_msg;
  END IF;
END
$fn$;

CREATE FUNCTION pg_temp.mark(p_edge text, p_job uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_status text;
BEGIN
  -- 🔴 每一步都重驗:注入用的 replica 模式若忘了還原,後面每一步都是「守門關著」跑出來的假綠。
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'T2:session_replication_role = %(守門是關的)⇒ 本步的綠毫無意義',
      current_setting('session_replication_role');
  END IF;
  SELECT status INTO v_status FROM public.order_refund_jobs WHERE id = p_job;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T2 mark:job % 不存在', p_job;
  END IF;
  RAISE NOTICE 'T2-STEP|%|%', p_edge, v_status;
END
$fn$;

-- 🔴 時間注入原語(T2 檔頭已逐條說明為什麼非有不可)。只動六個時間欄、只往回移。
CREATE FUNCTION pg_temp.advance(p_job uuid, p_shift interval) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_before jsonb; v_after jsonb; v_keys text;
BEGIN
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'T2 advance:呼叫端必須先 SET LOCAL session_replication_role = replica';
  END IF;
  SELECT to_jsonb(j) INTO v_before FROM public.order_refund_jobs j WHERE id = p_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'T2 advance:job % 不存在', p_job; END IF;
  UPDATE public.order_refund_jobs
     SET claimed_at               = claimed_at               - p_shift,
         claim_expires_at         = claim_expires_at         - p_shift,
         next_retry_at            = next_retry_at            - p_shift,
         next_check_at            = next_check_at            - p_shift,
         refund_call_attempted_at = refund_call_attempted_at - p_shift,
         last_refund_call_at      = last_refund_call_at      - p_shift
   WHERE id = p_job;
  SELECT to_jsonb(j) INTO v_after FROM public.order_refund_jobs j WHERE id = p_job;
  SELECT string_agg(b.key, ',' ORDER BY b.key) INTO v_keys
    FROM jsonb_each(v_before) b
   WHERE b.value IS DISTINCT FROM (v_after -> b.key);
  RAISE NOTICE 'T2-ADVANCE|%|%', p_shift, coalesce(v_keys, '(無)');
END
$fn$;

CREATE TEMP TABLE lrc_hist (rnd integer PRIMARY KEY, before_val timestamptz, after_val timestamptz)
  ON COMMIT DROP;

-- ── fixture:T1 明文沒有證明「一筆合法的列進得去」,所以這是本片的第一件事 ──
--    A7-t 的 DEFERRED presence trigger 要求 order_cancellations 至少一列明細
--    ⇒ header + 明細必須同交易寫齊(交易結尾的 SET CONSTRAINTS ALL IMMEDIATE 會驗它)。
-- 🔴 挑「同一張訂單裡有**另一個同單價品項**」的那一筆(T3a 新增的條件):
--    後代 item set 負測需要一個「金額完全相同、但品項不同」的替換品
--    —— 金額若不同,會先紅在「後代 payload 逐欄等於前代」而測不到 item set 那條。
--    T2 只用到第一個品項,對它而言這只是換一張訂單、語意不變(回歸實跑 34/0 為證)。
CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT oi.order_id,
       oi.id             AS order_item_id,
       sib.id            AS order_item2_id,
       oi.unit_price     AS unit_price,
       1                 AS qty,
       oi.unit_price     AS amount,
       gen_random_uuid() AS cancellation_id,
       gen_random_uuid() AS cancellation2_id,
       gen_random_uuid() AS job_id,
       gen_random_uuid() AS job2_id,
       gen_random_uuid() AS job3_id,
       gen_random_uuid() AS led_id,
       'sean'::text      AS staff_a,
       'staff_1'::text   AS staff_b
  FROM public.order_items oi
  JOIN public.order_items sib
    ON sib.order_id = oi.order_id
   AND sib.id <> oi.id
   AND sib.unit_price = oi.unit_price
   AND sib.quantity >= 1
 WHERE oi.unit_price > 0
   AND oi.quantity >= 1
 ORDER BY oi.order_id, oi.id, sib.id
 LIMIT 1;

SELECT pg_temp.assert((SELECT count(*) FROM fx) = 1,
                      'fixture:找不到「同訂單內有另一個同單價品項」的 order_item');
SELECT pg_temp.assert((SELECT count(*) FROM public.staff WHERE id IN ('sean','staff_1')) = 2,
                      'fixture:staff 種子缺 sean / staff_1(E14 的兩人簽核需要兩個不同 staff.id)');

INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
SELECT cancellation_id, order_id, 'customer_request', gen_random_uuid(), repeat('a', 64), staff_a FROM fx;

INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT cancellation_id, order_id, order_item_id, qty FROM fx;

INSERT INTO public.order_refund_jobs
  (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
   refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
   reason, actor, request_id)
SELECT job_id, cancellation_id, order_id,
       rpad('RECT2', 20, '0'), rpad('BRFT2', 20, '0'), repeat('b', 64),
       amount, amount, 0, 0, 0,
       '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t2-0001'
  FROM fx;

INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT job_id, order_id, order_item_id, qty, unit_price, amount FROM fx;

SELECT pg_temp.mark('INSERT', (SELECT job_id FROM fx));
SQL
}

sql_tail() { cat <<'SQL'
-- 🔴 沒有這一行,四支 DEFERRED constraint trigger(C1-C4 / 後代 item set / job↔ledger)
--    在 ROLLBACK 的交易裡**一次都不會跑** ⇒ 整條鏈的綠只證明了 BEFORE 那半邊。
--    T2 harness 自我測試 ② 專門證明這一行真的會讓它們當場觸發。
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.assert(current_setting('session_replication_role') = 'origin',
                      '收尾:session_replication_role 未還原成 origin');
DO $ok$ BEGIN RAISE NOTICE 'T2-CHAIN-OK'; END $ok$;
ROLLBACK;
SQL
}

# ── 個別 edge 的 SQL(全部相對於 fx.job_id,無參數 ⇒ 可重複串接)──────────
sql_e1() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'processing', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_retry_at = NULL
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E1', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT next_retry_at IS NULL AND claim_token IS NOT NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'E1:next_retry_at 未清空或 claim_token 未寫入');
SQL
}

sql_e2() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET refunded_before = 0, refunded_target = refund_amount
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E2', (SELECT job_id FROM fx));
SQL
}

sql_e2b() { cat <<'SQL'
INSERT INTO lrc_hist (rnd, before_val)
SELECT coalesce((SELECT max(rnd) FROM lrc_hist), 0) + 1, last_refund_call_at
  FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx);
UPDATE public.order_refund_jobs
   SET refund_call_attempted_at = now(), last_refund_call_at = now()
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E2b', (SELECT job_id FROM fx));
UPDATE lrc_hist
   SET after_val = (SELECT last_refund_call_at FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx))
 WHERE rnd = (SELECT max(rnd) FROM lrc_hist);
SQL
}

sql_e5() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       refund_call_attempted_at = NULL,
       failed_reason = 'TapPay 明確拒絕(T2 正向鏈 C)',
       retry_count = retry_count + 1,
       next_retry_at = now() + interval '5 minutes' * (1 << retry_count)
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E5', (SELECT job_id FROM fx));
-- 🔴 斷言用的是 plan §3.1 的字面式子 `5min × 2^(n-1)`(numeric 冪、轉整數 ⇒ 無浮點),
--    **不是**實作用的 `1 << (n-1)`。兩者若哪天分家,這裡會轉紅。
SELECT pg_temp.assert((SELECT refund_call_attempted_at IS NULL
                          AND next_retry_at = now() + interval '5 minutes' * (2 ^ (retry_count - 1))::integer
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'E5:戳記未清空,或 next_retry_at 不等於 now() + 5min × 2^(retry_count-1)');
SQL
}

sql_e6() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'queued', failed_reason = NULL
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E6', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT failed_reason IS NULL AND next_retry_at IS NOT NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'E6:failed_reason 未清空,或 next_retry_at 被順手清掉了(E6 只准保留)');
SQL
}

sql_ledger_and_e9() { cat <<'SQL'
-- 帳本列逐欄從 job 複製 ⇒ 本鏈證明的是「**相等時放行**」(含 tappay_refund_id 兩邊皆 NULL
-- 的 NULL-safe 格),**不證明**「不等時擋下」—— 那是 T3b 的負測。
INSERT INTO public.order_refunds
  (id, order_id, bank_refund_id, tappay_refund_id, items_amount,
   shipping_fee_before, shipping_fee_after, shipping_delta, refund_amount,
   status, reason, actor, request_id, confirmed_at)
SELECT (SELECT led_id FROM fx), j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
       j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
       'confirmed', j.reason, j.actor, j.request_id, now()
  FROM public.order_refund_jobs j WHERE j.id = (SELECT job_id FROM fx);

INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT (SELECT led_id FROM fx), ji.order_id, ji.order_item_id, ji.quantity, ji.unit_price, ji.line_amount
  FROM public.order_refund_job_items ji WHERE ji.job_id = (SELECT job_id FROM fx);

UPDATE public.order_refund_jobs
   SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E9', (SELECT job_id FROM fx));
SQL
}

# 🔴 時間注入(唯一的 fixture 例外;理由見 a7bt-verify.sh 檔頭「時間注入」整節)。
sql_advance() {  # $1=interval 字面(例 '10 minutes')
cat <<SQL
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '${1:?sql_advance 需要 interval}');
SET LOCAL session_replication_role = origin;
SQL
}

sql_e3b() {  # $1=next_check_at 距今多久(預設 1 day;必須跨台北日界)
cat <<SQL
UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '${1:-1 day}'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3b', (SELECT job_id FROM fx));
SQL
}

sql_e4() {  # $1=tappay_refund_id(唯一可首寫該欄的 edge)
cat <<SQL
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = now() + interval '1 day', tappay_refund_id = '${1:?sql_e4 需要 tappay id}'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E4', (SELECT job_id FROM fx));
SQL
}

sql_e8() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E8', (SELECT job_id FROM fx));
SQL
}

sql_e10() {  # $1=check_fail_count 的新值運算式(0 = 查到未達標;+1 = 查詢異常)
cat <<SQL
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = next_check_at + interval '1 day',
       check_fail_count = ${1:-0}
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E10', (SELECT job_id FROM fx));
SQL
}

sql_e11() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E11', (SELECT job_id FROM fx));
SQL
}

sql_e12() {  # $1=dead_reason $2=check_fail_count 運算式
cat <<SQL
UPDATE public.order_refund_jobs
   SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = NULL, dead_reason = '${1:?sql_e12 需要 dead_reason}',
       manual_review_required = true, check_fail_count = ${2:-check_fail_count}
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E12', (SELECT job_id FROM fx));
SQL
}

# E13 三種 resolution。retry_authorized 另受 D7 + D9a/b/d;另兩種**證據兩欄必須為 NULL**(D9a)。
sql_e13_auth() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
       resolution = 'retry_authorized',
       retry_auth_recorded_refunded = refunded_before,
       retry_auth_checked_at = now()
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E13', (SELECT job_id FROM fx));
SQL
}

sql_e13_plain() {  # $1 = external_refund_confirmed | over_refund_writeoff
cat <<SQL
UPDATE public.order_refund_jobs
   SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
       resolution = '${1:?sql_e13_plain 需要 resolution}'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E13', (SELECT job_id FROM fx));
SQL
}

sql_e14_auth() { cat <<'SQL'
UPDATE public.order_refund_jobs
   SET resolution = 'retry_authorized',
       retry_auth_recorded_refunded = refunded_before,
       retry_auth_checked_at = now(),
       corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
       correction_reason = '原結案人選錯 resolution,實為授權重試(A7b-T 正向鏈 G)'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E14', (SELECT job_id FROM fx));
SQL
}

# ── 重試迴圈(= 正向鏈 C;B / G 以它為前綴)────────────────────────────
sql_c_round1() { cat <<'SQL'
SQL
  sql_e1
  cat <<'SQL'
-- 🔴 **刻意偏離 plan §7.4 的 C 字面**:C 鏈第 1 輪在 E1 與 E2 之間插一段 E3,
--    用來吃掉 §7.4「另補(R5 nit 2)」要求的「正向鏈需至少一條經過 E3(lease 過期但未打款的重領)」。
--    E3 對 baseline / 戳記零影響(白名單只有 lease 三欄),不改變 C 鏈其餘部分的語意。
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;
UPDATE public.order_refund_jobs
   SET claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3', (SELECT job_id FROM fx));
SQL
  sql_e2
  sql_e2b
  sql_e5
  sql_e6
}

sql_c_round() { cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '90 minutes');
SET LOCAL session_replication_role = origin;
SQL
  sql_e1
  sql_e2b
  sql_e5
  sql_e6
}

sql_c_round6() { cat <<'SQL'
-- 🔴 用 1 day(不是剛好夠的 90 分鐘):第 5 輪的 backoff 已是 now()+80min,
--    90 分鐘只剩 10 分鐘餘裕 ⇒ backoff 常數一改,C 鏈會因為非實質原因整條紅。
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '1 day');
SET LOCAL session_replication_role = origin;
SQL
  sql_e1
  sql_e2b
  cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       refund_call_attempted_at = NULL, next_retry_at = NULL,
       failed_reason = '第六次明確失敗(T2 正向鏈 C)',
       retry_count = retry_count + 1,
       dead_reason = 'retry_exhausted', manual_review_required = true
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E5b', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT retry_count = 6 AND dead_reason = 'retry_exhausted'
                          AND manual_review_required AND next_retry_at IS NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'C:E5b 後的 dead 形狀不符');
SQL
}

sql_retry_loop() {
  sql_c_round1
  sql_c_round
  sql_c_round
  sql_c_round
  sql_c_round
  sql_c_round6
  cat <<'SQL'
-- 🔴🔴 **plan §7.4 C 鏈的「last_refund_call_at 每輪嚴格遞增」,本片證明不了,不假裝證明過。**
--    now() = transaction_timestamp,在同一交易內恆定 ⇒ 六輪 E2b 寫進去的都是**同一個值**,
--    跨輪的絕對遞增在單一 session 內物理上不可觀察。
--    🔴 我一度寫成「等價可觀察形狀 = 每輪 after > before」——**那是偷換概念**:
--       `advance()` 每輪先把該欄往回移 90 分鐘,`after > before` 因此**恆真**,
--       拿掉 T1 的 `a7bt_e2b_last_call_not_monotonic` 也照樣綠 = 測到的是我自己的注入。
--    ⇒ 本檔只斷言 E2b **確實每輪都把它更新成 now()**(D9b 的錨點成不成立取決於這件事);
--      「不得往回改」屬**負測**,由 T3a 的 §7.4-31 關閉。
SELECT pg_temp.assert((SELECT count(*) FROM lrc_hist) = 6, 'C:E2b 應執行 6 輪');
SELECT pg_temp.assert((SELECT before_val IS NULL AND after_val IS NOT NULL FROM lrc_hist WHERE rnd = 1),
                      'C:第 1 輪 E2b 之前 last_refund_call_at 應為 NULL');
SELECT pg_temp.assert((SELECT count(*) FROM lrc_hist WHERE after_val IS DISTINCT FROM now()) = 0,
                      'C:某一輪 E2b 後的 last_refund_call_at 不等於 now()');
SQL
}

# ── gen2(B / G 共用)───────────────────────────────────────────────
sql_gen2() { cat <<'SQL'
INSERT INTO public.order_refund_jobs
  (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
   refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
   reason, actor, request_id)
SELECT job2_id, cancellation_id, order_id, 2,
       rpad('RECT2', 20, '0'), rpad('BRFT2G2', 20, '0'), repeat('b', 64),
       amount, amount, 0, 0, 0,
       '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t2-0002'
  FROM fx;

INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT job2_id, order_id, order_item_id, qty, unit_price, amount FROM fx;

SELECT pg_temp.mark('INSERT-gen2', (SELECT job2_id FROM fx));

-- gen2 走 E1 + E2:證明 **D9c 在合法路徑上不是靜態死鎖**
--(後代 baseline 必須等於前代結案時查到的累計退款額)。
-- ⚠️ 誠實邊界:本 fixture 是**退化的** —— `refunded_before` / 前代 `retry_auth_recorded_refunded`
--    / gen2 baseline 三者皆為 0 ⇒ 這條綠燈**分不出 D9c 比對的是不是正確的那兩欄**。
--    「比錯欄 / 不等時擋下」屬負測,歸 T3b。
UPDATE public.order_refund_jobs
   SET status = 'processing', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_retry_at = NULL
 WHERE id = (SELECT job2_id FROM fx);
SELECT pg_temp.mark('E1', (SELECT job2_id FROM fx));

UPDATE public.order_refund_jobs
   SET refunded_before = 0, refunded_target = refund_amount
 WHERE id = (SELECT job2_id FROM fx);
SELECT pg_temp.mark('E2', (SELECT job2_id FROM fx));
SQL
}

# ══════════════════════════════════════════════════════════════
# 負測外殼:把一段 SQL 包進「必須紅在指定 CONSTRAINT_NAME」的探針
# ══════════════════════════════════════════════════════════════
# 🔴 判定的是 `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`,**不是「反正紅了」**:
#    A7-t 的教訓 —— 每條突變都紅在同一個地方時,判別力歸零而 FAIL 數仍是 0。
red_wrap_head() { cat <<'SQL'
DO $red$
DECLARE v_name text;
BEGIN
SQL
}
red_wrap_tail() { cat <<'SQL'
  RAISE NOTICE 'T2-RED|(未觸發:竟然成功)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
  -- 🔴 SQLSTATE 另開一行(不併進 T2-RED):併進去會改變 T2 既有的解析形狀。
  --    有它才能斷言「紅在指定 constraint **且** SQLSTATE 對」——
  --    只比名字的話,同名約束若哪天從 trigger 搬成 CHECK,測試不會有感覺。
  RAISE NOTICE 'T2-REDSTATE|%', SQLSTATE;
  RAISE NOTICE 'T2-RED|%', coalesce(nullif(v_name, ''), '(空)');
END
$red$;
ROLLBACK;
SQL
}

# expect_red <sql 檔> <預期 constraint> <說明> [預期 SQLSTATE]
# 🔴 第 4 個參數省略時**不檢查** SQLSTATE(T2 沿用舊形狀);T3a 一律帶。
REDSTATE=""
expect_red() {
  local out actual state
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$1" 2>&1)"
  printf '%s\n' "$out" >> "$WORK/steps.log"
  actual="$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | tail -1)"
  state="$(printf '%s\n' "$out" | sed -n 's/.*T2-REDSTATE|//p' | tail -1)"
  REDSTATE="$state"
  if [ "$actual" != "$2" ]; then
    bad "$3 ⇒ 預期紅在 $2,實為 [$actual]"
  elif [ -n "${4:-}" ] && [ "$state" != "$4" ]; then
    bad "$3 ⇒ 紅在 $2 但 SQLSTATE 是 [$state],預期 $4"
  else
    ok "$3 ⇒ 紅在 $2${4:+(SQLSTATE $4)}"
  fi
}
