#!/usr/bin/env bash
# ============================================================
# A7b-T · T2「正向鏈」可重現驗證 harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7.3 / §7.4 / §7.5 rule 4
# 用法:scripts/a7bt-verify.sh all /tmp/a7btv   (從零 provision,最完整)
#      scripts/a7bt-verify.sh run /tmp/a7btv   (重用既有拋棄式 cluster)
#
# ── 為什麼正向鏈排在負測前面(plan §7.4 開頭,不是偏好)──────────────
#   v3 的 24 負測 + 2 正向對三處**靜態死鎖**全綠;v4 補完又漏兩處。
#   **負測證明「壞的被擋住」,證明不了「好的走得通」。**
#
# ── 這支腳本在證明什麼(誠實邊界)──────────────────────────────────
#   證明:
#     ① T1(20260731120100)疊在全部既有 migration 之上可套用 —— **只在 `all` 模式**;
#        `run` 模式改由第 2 段把 migration 檔裡的七個函式指紋對 `md5(prosrc)` 逐支比對,
#        才不會對著一台用舊版檔案 provision 的 cluster 印全綠。
#     ② **一筆完全合法的列進得去** —— T1 全檔沒有證明過這件事
#     ③ §3.1 的 **16 條 edge 每一條都實跑過一次合法轉移**(§7.5 rule 4),
#        每一步都斷言「落在 §3.1 宣告的那個 status」,任一步跑不過**當場中止**
#     ④ §7.4 的**七條正向鏈 A-G** 全部跑通(含 gen2、D11 更正鏈、三種 resolution)
#     ⑤ 六道「等待型閘門」不是 fail-open:把時間注入拿掉,各自紅在**指定的** constraint
#     ⑥ **「後端程式直寫」這條路確實不可達**(第 7 段;Sean 2026-07-31 拍 Q1=D)——
#        上面①-⑤全部以 owner(postgres)身分跑,那正是 SECURITY DEFINER RPC 內部的身分;
#        第 7 段反過來以 `service_role` 實跑同樣的動作,**斷言它必須失敗於 42501**。
#        ⇒ 這一段是**合約測試**,不是缺陷報告:哪天有人把權限放寬、直寫又通了,它會轉紅。
#   🔴 **不證明**:
#     · 行為負測(哪一條規則實際擋得住哪一筆壞資料)= T3a / T3b
#     · 突變證明、ACL 32 格、barrier lock probe、rollback 六步實跑 = T4
#     · job↔ledger 十一欄「**不等時擋下**」—— 本片的帳本列是從 job 複製出來的,
#       只證明「相等時放行(含 tappay_refund_id 兩邊皆 NULL 的 NULL-safe 格)」
#     · 正式站行為(本機 PG17.10 非 Supabase、C locale ≠ en_US.UTF-8)
#
# ── 🔴 時間注入(本檔唯一的 fixture 例外,逐條列名)────────────────────
#   plan §7.3 要求「所有 fixture 必須經合法 edge 構造」,§7.4 只列了一個例外
#   (B 鏈的 last_refund_call_at 注入兩天前)。**實作時發現那份清單不完整**:
#   以下四個閘門在單一 session 內**靜態不可達**,因為它們比的是 `now()`,
#   而 `now()` = transaction_timestamp,在同一交易內恆定:
#     · E3 / E3b / E11 要求 `OLD.claim_expires_at <= now()`,而 lease 錨點強制
#       `claim_expires_at = now() + 5min` ⇒ 永遠在未來
#     · E1(重試迴圈第 2 輪起)要求 `OLD.next_retry_at <= now()`,而 E5 的 backoff
#       強制 `next_retry_at = now() + 5min × 2^(n-1)` ⇒ 永遠在未來
#     · E8 要求 `OLD.next_check_at <= now()`,而 E3b/E4 強制它的台北日期晚於呼叫日
#     · E13 的 D9b 要求 `checked_at` 的台北日期 > `last_refund_call_at` 的台北日期,
#       而 E13 又要求 `checked_at <= now()`(= plan §7.4 已列名的那個例外)
#   ⇒ 本檔以**單一具名原語** `pg_temp.advance(job, interval)` 統一處理:
#     把六個「等待/過去事件」時間欄各往回移一個 interval(NULL 不動),語意 = 模擬時間流逝。
#     它**不碰**任何其他欄;每次呼叫都把「實際變動的欄名集合」印進 log
#     (🔴 只有 B 鏈那一次被**機器斷言**,其餘僅供人事後查 log)。
#   🔴 走 E5b 進 dead 的列,六欄只剩 `last_refund_call_at` 非 NULL
#     ⇒ B / G 鏈那次呼叫**退化成 plan 逐字允許的那個例外**(harness 對此有機器斷言)。
#     (走 E12 進 dead 的列不同 —— E12 白名單不清 `refund_call_attempted_at`;
#      那種列在本檔沒有被 advance 過。)
#   🔴 注入本身必須被證明「承重」:第 6 段把注入拿掉,六個閘門各自轉紅。
#   🔴 注入走 `SET LOCAL session_replication_role = replica`(交易結束自動還原、**不動 catalog**),
#     不用 `ALTER TABLE ... DISABLE TRIGGER`。`pg_temp.mark()` 每一步都重驗
#     `session_replication_role = 'origin'` —— 忘了還原的話,後面每一步的綠都是假的。
#
# 🔴 判定紀律(A7 / A7-t / A1 / A7b-M 的教訓,不重蹈)
#  ① 每一步都斷言「落在指定的 status」,不是「反正沒炸就算過」。
#  ② 任何當基準的查詢都要 fail-closed(驗退出碼 + stderr 空 + sentinel)。
#  ③ `pg_temp.assert()` 用 `IS NOT TRUE` ⇒ 條件為 NULL(例如查無列)也判失敗。
#  ④ 每條鏈全程在一個交易內、結尾 `SET CONSTRAINTS ALL IMMEDIATE` 再 `ROLLBACK`
#     —— 沒有前者,DEFERRED 的四支 constraint trigger **一次都不會跑**(harness 自我測試 ② 證明)。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a7bt-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7btv)}"
PORT=54329
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }
die() { printf '  🔴🔴 當場中止:%s\n' "$1"; exit 1; }

# workdir 身分閘(這支腳本會 rm -rf 它)
case "$(cd / && printf '%s' "$WORK")" in
  /tmp/?*) : ;;
  *) echo "🔴 workdir 必須在 /tmp 底下(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;; esac

runsql() { psql "$URL" -qtA -c "$1" 2>&1; }

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

# ── 結構快照:本 harness 自己的比對基準(**不是** T1 §9.x 的斷言,不冒充它)──
#    用途只有一個:證明跑完整套正向鏈與注入之後,catalog 一個 byte 都沒被動到。
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

# ── §3.1 宣告的 edge → 目標 status(harness 側的 oracle,與 DB 無關)────────
declare -a EDGES=(E1 E2 E2b E3 E3b E4 E5 E5b E6 E8 E9 E10 E11 E12 E13 E14)
target_status() {
  case "$1" in
    INSERT|INSERT-gen2) echo queued ;;
    E1|E2|E2b|E3) echo processing ;;
    E3b|E8|E11) echo reconciling ;;
    E4|E10) echo submitted ;;
    E5) echo failed ;;
    E5b|E12|E13|E14) echo dead ;;
    E6) echo queued ;;
    E9) echo completed ;;
    *) echo "(未知 edge)" ;;
  esac
}

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

-- 🔴 時間注入原語(檔頭已逐條說明為什麼非有不可)。只動六個時間欄、只往回移。
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
CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT oi.order_id,
       oi.id             AS order_item_id,
       oi.unit_price     AS unit_price,
       1                 AS qty,
       oi.unit_price     AS amount,
       gen_random_uuid() AS cancellation_id,
       gen_random_uuid() AS job_id,
       gen_random_uuid() AS job2_id,
       gen_random_uuid() AS led_id,
       'sean'::text      AS staff_a,
       'staff_1'::text   AS staff_b
  FROM public.order_items oi
 WHERE oi.unit_price > 0
   AND oi.quantity >= 1
 ORDER BY oi.order_id, oi.id
 LIMIT 1;

SELECT pg_temp.assert((SELECT count(*) FROM fx) = 1, 'fixture:找不到 unit_price > 0 的 order_item');
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
--    harness 自我測試 ② 專門證明這一行真的會讓它們當場觸發。
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
--      「不得往回改」屬**負測**,明文歸 T3a。
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
# 0. provision
# ══════════════════════════════════════════════════════════════
if [ "$MODE" = "all" ]; then
  log "0/8 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成 = **T1 的 apply 測試**(全部既有 migration + A7b-M + A7b-T 依序套用)"
else
  mkdir -p "$WORK"
fi
: > "$WORK/steps.log"

# ══════════════════════════════════════════════════════════════
# 1. harness 自我測試
# ══════════════════════════════════════════════════════════════
log "1/8 harness 自我測試(harness 自己壞掉時必須看得出來)"

( snapshot "SELECT this_column_does_not_exist FROM pg_class" "$WORK/selftest.snap" "自我測試" ) >/dev/null 2>&1
if [ $? -eq 0 ]; then
  die "harness 自我測試①失敗:壞掉的快照 SQL 竟然沒有讓 snapshot() 中止"
fi
ok "自我測試①:壞掉的快照 SQL 會當場中止(不會變成假的零漂移)"

# 自我測試②:證明 `SET CONSTRAINTS ALL IMMEDIATE` 真的會讓 DEFERRED constraint trigger 當場觸發。
# 🔴 沒有這一條,後面七條鏈的「綠」可能只代表「那四支 trigger 一次都沒跑」。
{ sql_head; cat <<'SQL'
-- 故意刪掉本 job 的明細(用 replica 模式繞過永久阻擋)⇒ C1 應在 SET CONSTRAINTS 時當場紅
SET LOCAL session_replication_role = replica;
DELETE FROM public.order_refund_job_items WHERE job_id = (SELECT job_id FROM fx);
SET LOCAL session_replication_role = origin;
DO $red$
DECLARE v_name text;
BEGIN
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  RAISE NOTICE 'T2-RED|(未觸發:零明細的 job 竟然通過)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
  RAISE NOTICE 'T2-RED|%', coalesce(nullif(v_name, ''), '(空)');
END
$red$;
ROLLBACK;
SQL
} > "$WORK/selftest-deferred.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/selftest-deferred.sql" 2>&1)"
actual="$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | head -1)"
if [ "$actual" = "a7bt_c1_job_has_no_items" ]; then
  ok "自我測試②:SET CONSTRAINTS ALL IMMEDIATE 確實讓 DEFERRED constraint trigger 當場觸發"
else
  die "harness 自我測試②失敗:期望紅在 a7bt_c1_job_has_no_items,實為 [$actual]"
fi

# 自我測試③:證明「忘了把 session_replication_role 還原」會被當場抓到。
# 🔴 這是本 harness 最大的假綠風險 —— replica 模式下**十支守門一支都不會跑**,
#    整條鏈會一路綠到底而什麼都沒驗到。mark() 裡那個 IF 必須被證明會響。
{ sql_head; cat <<'SQL'
SET LOCAL session_replication_role = replica;
DO $red$
DECLARE v_msg text;
BEGIN
  PERFORM pg_temp.mark('E1', (SELECT job_id FROM fx));
  RAISE NOTICE 'T2-GUARD|(未觸發:守門關著時 mark() 竟然放行)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  RAISE NOTICE 'T2-GUARD|%', left(v_msg, 40);
END
$red$;
SET LOCAL session_replication_role = origin;
ROLLBACK;
SQL
} > "$WORK/selftest-guard.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/selftest-guard.sql" 2>&1)"
case "$(printf '%s\n' "$out" | sed -n 's/.*T2-GUARD|//p' | head -1)" in
  "T2:session_replication_role = replica"*)
    ok "自我測試③:守門被關著時 mark() 會當場中止(replica 模式下的假綠被封死)" ;;
  *)
    die "harness 自我測試③失敗:守門關著時 mark() 沒有中止 — $(printf '%s\n' "$out" | sed -n 's/.*T2-GUARD|//p' | head -1)" ;;
esac

# ══════════════════════════════════════════════════════════════
# 2. T1 落地事實
# ══════════════════════════════════════════════════════════════
log "2/8 T1 落地事實(provision 之後的既成事實,不採信 migration 自述)"
[ "$(runsql "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_refund_jobs'::regclass AND conname='order_refund_jobs_dormant_until_triggers'")" = "0" ] \
  && ok "dormant gate 已移除" || bad "dormant gate 仍在(T1 沒跑完?)"
[ "$(runsql "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items') AND NOT t.tgisinternal")" = "10" ] \
  && ok "兩表非內部 trigger = 10 支" || bad "trigger 不是 10 支"
[ "$(runsql "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%'")" = "7" ] \
  && ok "pcm_a7bt_* 函式 = 7 支" || bad "函式不是 7 支"

# 🔴 把 **migration 檔裡的**七個函式本體指紋逐支對庫裡的 md5(prosrc) 比對。
#    沒有這一段,`run` 模式(重用既有 cluster)與 migration 檔完全脫鉤 ——
#    對著一台用**舊版檔案** provision 的 cluster,整份 harness 會印全綠。
#    常數**從檔案即時抽取**、不在本檔另抄一份(抄一份 = 第二個會漂移的真相)。
MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"
fpr_n=0; fpr_bad=""
while IFS='|' read -r fn want; do
  fpr_n=$((fpr_n + 1))
  got="$(runsql "SELECT coalesce((SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'), '(缺)')")"
  [ "$got" = "$want" ] || fpr_bad="$fpr_bad $fn(期望 ${want:0:8}… 實際 ${got:0:8}…)"
done < <(sed -n "s/^ *('\(pcm_a7bt_[a-z_]*\)', *'\([0-9a-f]\{32\}\)').*/\1|\2/p" "$MIG")
if [ "$fpr_n" -ne 7 ]; then
  bad "從 migration 檔抽出的函式指紋常數不是 7 筆(實 $fpr_n)⇒ 抽取式失配,本段等於沒驗"
elif [ -n "$fpr_bad" ]; then
  bad "函式本體指紋與 migration 檔不符 —$fpr_bad"
else
  ok "七支函式本體指紋 = migration 檔裡的常數(run 模式也與檔案掛鉤)"
fi
snapshot "$STRUCT_SQL" "$WORK/struct-before.snap" "跑鏈前結構快照"
ok "結構快照建立(跑完全部鏈與注入後會再比一次)"

# ══════════════════════════════════════════════════════════════
# 3-5. 正向鏈 A-G
# ══════════════════════════════════════════════════════════════
run_chain() {  # $1=鏈名 $2=sql 檔
  local name="$1" file="$2" out rc line edge st want
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$file" 2>&1)"; rc=$?
  printf '%s\n' "$out" >> "$WORK/steps.log"
  if [ "$rc" -ne 0 ] || ! printf '%s\n' "$out" | grep -q 'T2-CHAIN-OK'; then
    printf '%s\n' "$out" | tail -20 > "$WORK/fail-$name.log"
    die "正向鏈 $name 未跑通(§7.5 rule 4:跑不過當場中止)— $(printf '%s\n' "$out" | grep -m1 -E 'ERROR|T2 斷言失敗' | cut -c1-220);完整輸出 $WORK/fail-$name.log"
  fi
  # 逐步驗「落在 §3.1 宣告的那個 status」
  while IFS='|' read -r _ edge st; do
    want="$(target_status "$edge")"
    [ "$st" = "$want" ] || die "正向鏈 $name:$edge 之後 status 應為 $want,實為 $st"
  done < <(printf '%s\n' "$out" | sed -n 's/.*\(T2-STEP|.*\)/\1/p')
  ok "正向鏈 $name 跑通($(printf '%s\n' "$out" | grep -c 'T2-STEP|') 步,每步 status 皆符合 §3.1)"
}

log "3/8 正向鏈 A / D / E / F(送出 → 對帳 → 完成 / 不確定送出 / 超退 / 對帳耗盡)"

# ── A:queued→E1→processing→E2→E2b→E4→submitted→E8→reconciling→E9→completed ──
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T2-A-0001'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E4', (SELECT job_id FROM fx));

SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '2 days');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E8', (SELECT job_id FROM fx));
SQL
  sql_ledger_and_e9
  cat <<'SQL'
SELECT pg_temp.assert((SELECT tappay_refund_id = 'TPR-T2-A-0001' AND refund_id IS NOT NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'A:completed 的 tappay_refund_id / refund_id 不符');
SQL
  sql_tail; } > "$WORK/chain-a.sql"
run_chain A "$WORK/chain-a.sql"

# ── D:不確定送出鏈(全程 tappay_refund_id 為 NULL)────────────────────
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '1 day'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3b', (SELECT job_id FROM fx));

-- E10:成功查到但未達標 ⇒ check_fail_count 歸零、next_check_at 往後推
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = next_check_at + interval '1 day', check_fail_count = 0
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E10', (SELECT job_id FROM fx));

SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '3 days');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E8', (SELECT job_id FROM fx));

SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E11', (SELECT job_id FROM fx));

SELECT pg_temp.assert((SELECT tappay_refund_id IS NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'D:走 E3b 的 job 全程不得有 tappay_refund_id');
SQL
  sql_ledger_and_e9
  cat <<'SQL'
SELECT pg_temp.assert((SELECT tappay_refund_id IS NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'D:completed 之後 tappay_refund_id 仍應為 NULL(NULL-safe 等值放行)');
SQL
  sql_tail; } > "$WORK/chain-d.sql"
run_chain D "$WORK/chain-d.sql"

# ── E:超退鏈 + E13 的 over_refund_writeoff 正向 ───────────────────────
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '1 day'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3b', (SELECT job_id FROM fx));

UPDATE public.order_refund_jobs
   SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = NULL, dead_reason = 'over_refunded', manual_review_required = true
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E12', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT next_check_at IS NULL AND check_fail_count = 0
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'E:E12(over_refunded)後 next_check_at 必須為 NULL 且計數器不變');

-- E13 的第二種 resolution(plan §7.4「另補」)。證據兩欄必須為 NULL(D9a)。
UPDATE public.order_refund_jobs
   SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
       resolution = 'over_refund_writeoff'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E13', (SELECT job_id FROM fx));
SQL
  sql_tail; } > "$WORK/chain-e.sql"
run_chain E "$WORK/chain-e.sql"

# ── F:對帳耗盡鏈(E10 異常 ×5 → E12 reconcile_exhausted)─────────────
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '1 day'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3b', (SELECT job_id FROM fx));
SQL
  for _ in 1 2 3 4 5; do cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = next_check_at + interval '1 day',
       check_fail_count = check_fail_count + 1
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E10', (SELECT job_id FROM fx));

SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '3 days');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E8', (SELECT job_id FROM fx));
SQL
  done
  cat <<'SQL'
SELECT pg_temp.assert((SELECT check_fail_count = 5
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'F:五輪查詢異常後 check_fail_count 應為 5');

UPDATE public.order_refund_jobs
   SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = NULL, dead_reason = 'reconcile_exhausted',
       manual_review_required = true, check_fail_count = check_fail_count + 1
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E12', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT check_fail_count = 6 AND next_check_at IS NULL
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'F:E12(reconcile_exhausted)後 check_fail_count 應為 6、next_check_at 為 NULL');
SQL
  sql_tail; } > "$WORK/chain-f.sql"
run_chain F "$WORK/chain-f.sql"

log "4/8 正向鏈 C(重試迴圈 6 輪,含 E3 重領)"
{ sql_head; sql_retry_loop; sql_tail; } > "$WORK/chain-c.sql"
run_chain C "$WORK/chain-c.sql"

log "5/8 正向鏈 B / G(結案 → 開世代 / 更正結案 → 開世代)"

# ── B:…→E5b dead→(時間注入)→E13 retry_authorized→INSERT gen2→E1→E2(D9c)──
{ sql_head; sql_retry_loop; cat <<'SQL'
-- 🔴 plan §7.4 逐字允許的**唯一** fixture 例外:只注入 last_refund_call_at 為兩天前。
--    dead 狀態下另外五個時間欄皆為 NULL ⇒ 本次呼叫實際只動到那一欄(下面的 T2-ADVANCE
--    行由 harness 機器斷言;不是靠人看)。
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '2 days');
SET LOCAL session_replication_role = origin;

UPDATE public.order_refund_jobs
   SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
       resolution = 'retry_authorized',
       retry_auth_recorded_refunded = refunded_before,
       retry_auth_checked_at = now()
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E13', (SELECT job_id FROM fx));
SQL
  sql_gen2; sql_tail; } > "$WORK/chain-b.sql"

snapshot "$STRUCT_SQL" "$WORK/struct-pre-inject.snap" "B 鏈注入前結構斷言"
run_chain B "$WORK/chain-b.sql"
snapshot "$STRUCT_SQL" "$WORK/struct-post-inject.snap" "B 鏈注入後結構斷言"
cmp -s "$WORK/struct-pre-inject.snap" "$WORK/struct-post-inject.snap" \
  && ok "B 鏈注入前後的完整結構斷言一致(catalog 零異動)" \
  || bad "B 鏈注入前後結構不一致 — 注入動到了 catalog"

# 🔴 機器斷言:B 鏈那次注入實際只改了 last_refund_call_at 一欄。
adv="$(grep -o 'T2-ADVANCE|2 days|[^ ]*' "$WORK/steps.log" | tail -1 | sed 's/.*|//')"
[ "$adv" = "last_refund_call_at" ] \
  && ok "B 鏈的時間注入實際只動到 last_refund_call_at(符合 plan §7.4 逐字允許的例外)" \
  || bad "B 鏈的時間注入動到的欄位是 [$adv],不是只有 last_refund_call_at"

# ── G:更正鏈(D11)──────────────────────────────────────────────────
{ sql_head; sql_retry_loop; cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '2 days');
SET LOCAL session_replication_role = origin;

-- 先結成 external_refund_confirmed(D9a:此時證據兩欄必須為 NULL)
UPDATE public.order_refund_jobs
   SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
       resolution = 'external_refund_confirmed'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E13', (SELECT job_id FROM fx));

-- E14:另一位 staff 更正為 retry_authorized(仍受 D7 + D9a/b/d 全部約束)
UPDATE public.order_refund_jobs
   SET resolution = 'retry_authorized',
       retry_auth_recorded_refunded = refunded_before,
       retry_auth_checked_at = now(),
       corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
       correction_reason = '原結案人選錯 resolution,實為授權重試(T2 正向鏈 G)'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E14', (SELECT job_id FROM fx));
SELECT pg_temp.assert((SELECT reviewed_by = (SELECT staff_a FROM fx)
                          AND corrected_by = (SELECT staff_b FROM fx)
                         FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx)),
                      'G:E14 不得改動原結案人(reviewed_by 是稽核痕跡)');

-- 第二次 E14 必拒(第二道 CAS)
DO $red$
DECLARE v_name text;
BEGIN
  UPDATE public.order_refund_jobs
     SET corrected_at = now(), corrected_by = (SELECT staff_a FROM fx),
         correction_reason = '第二次更正(應被拒絕)'
   WHERE id = (SELECT job_id FROM fx);
  RAISE NOTICE 'T2-RED|(未觸發:第二次 E14 竟然成功)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
  RAISE NOTICE 'T2-RED|%', coalesce(nullif(v_name, ''), '(空)');
END
$red$;
SQL
  sql_gen2; sql_tail; } > "$WORK/chain-g.sql"
run_chain G "$WORK/chain-g.sql"
g_red="$(grep -o 'T2-RED|[^ ]*' "$WORK/steps.log" | tail -1 | sed 's/T2-RED|//')"
[ "$g_red" = "a7bt_e14_already_corrected" ] \
  && ok "G:第二次 E14 被拒,紅在 a7bt_e14_already_corrected" \
  || bad "G:第二次 E14 應紅在 a7bt_e14_already_corrected,實為 [$g_red]"

# ══════════════════════════════════════════════════════════════
# 6. 注入承重證明:把注入拿掉,四個閘門各自轉紅
# ══════════════════════════════════════════════════════════════
log "6/8 注入承重證明(拿掉注入必須轉紅 —— 否則測到的是 fail-open)"

expect_red() {  # $1=sql 檔 $2=預期 constraint $3=說明
  local out actual
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$1" 2>&1)"
  printf '%s\n' "$out" >> "$WORK/steps.log"
  actual="$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | tail -1)"
  if [ "$actual" = "$2" ]; then
    ok "$3 ⇒ 紅在 $2"
  else
    bad "$3 ⇒ 預期紅在 $2,實為 [$actual]"
  fi
}

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
  RAISE NOTICE 'T2-RED|%', coalesce(nullif(v_name, ''), '(空)');
END
$red$;
ROLLBACK;
SQL
}

# ① E3:不推進時間 ⇒ lease 尚未過期
{ sql_head; sql_e1; red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e3.sql"
expect_red "$WORK/neg-e3.sql" "a7bt_e3_lease_not_expired" "① 拿掉 lease 時間注入後走 E3"

# ② E1(重試後):不推進時間 ⇒ backoff 尚未到期
{ sql_head; sql_e1; sql_e2; sql_e2b; sql_e5; sql_e6; red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_retry_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e1.sql"
expect_red "$WORK/neg-e1.sql" "a7bt_e1_not_due_yet" "② 拿掉 backoff 時間注入後走 E1"

# ③ E8:不推進時間 ⇒ 對帳時間未到
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
UPDATE public.order_refund_jobs
   SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
       next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T2-N-0001'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E4', (SELECT job_id FROM fx));
SQL
  red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e8.sql"
expect_red "$WORK/neg-e8.sql" "a7bt_e8_not_due_yet" "③ 拿掉 next_check 時間注入後走 E8"

# ④ E3b:不推進時間 ⇒ lease 尚未過期(與 E3 是**不同的**具名閘門,鏈 D/E/F 都靠它)
{ sql_head; sql_e1; sql_e2; sql_e2b; red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e3b.sql"
expect_red "$WORK/neg-e3b.sql" "a7bt_e3b_lease_not_expired" "④ 拿掉 lease 時間注入後走 E3b"

# ⑤ E11:不推進時間 ⇒ lease 尚未過期(鏈 D 靠它)
{ sql_head; sql_e1; sql_e2; sql_e2b; cat <<'SQL'
SET LOCAL session_replication_role = replica;
SELECT pg_temp.advance((SELECT job_id FROM fx), interval '10 minutes');
SET LOCAL session_replication_role = origin;
UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '1 day'
 WHERE id = (SELECT job_id FROM fx);
SELECT pg_temp.mark('E3b', (SELECT job_id FROM fx));
SQL
  red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e11.sql"
expect_red "$WORK/neg-e11.sql" "a7bt_e11_lease_not_expired" "⑤ 拿掉第二次 lease 時間注入後走 E11"

# ⑥ E13:不做兩天注入 ⇒ D9b 隔日閘擋下(plan §7.4 逐字要求的那一條)
{ sql_head; sql_retry_loop; red_wrap_head; cat <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL
  red_wrap_tail; } > "$WORK/neg-e13.sql"
expect_red "$WORK/neg-e13.sql" "orj_retry_auth_next_day_gate" "⑥ 拿掉 last_refund_call_at 注入後走 E13(D9b)"

# ══════════════════════════════════════════════════════════════
# 7. 🔴 角色保真:plan §4.5 指定的唯一寫入者是 service_role,不是 owner
# ══════════════════════════════════════════════════════════════
# 🔴 **Sean 2026-07-31 拍板 Q1=D**:退款工作表的寫入**一律走 owner 的 SECURITY DEFINER RPC**,
#    「後端程式(service_role)直寫」這條路**明文作廢** —— 與旁邊三張表(orders /
#    order_cancellations / order_refunds)一致,也是 plan §6 R9 / R16 / R16b 已經指定的形狀。
#    (T2 實跑先發現直寫**本來就走不通**:trigger 內對 `pcm_a7bt_allowed_delta` 是巢狀函式呼叫、
#     以 current_user 檢查 EXECUTE;`PERFORM … FOR UPDATE` 另需 order_cancellations 的 UPDATE 權限。
#     兩者對 service_role 都是 42501。拍板 D 之後這不是缺陷,是契約。)
# ⇒ 本段因此是**合約測試**:斷言直寫**必須**失敗於 42501。
#   哪天有人放寬權限讓直寫又通了,本段轉紅 —— 那正是要攔的事。
# 🔴 上面所有鏈以 owner 身分跑 = 模擬 SECURITY DEFINER RPC 內部的身分,不是「跑錯角色」。
# ⛔ 仍未證明(歸第 3 批):那些 RPC 本身還不存在(plan §6 具名:complete_refund_job /
#    admin_resolve_dead_refund_job / admin_correct_dead_refund_resolution,以及 worker 機械步驟的數支);
#    「收回 service_role 的 INSERT/UPDATE GRANT」也是第 3 批的前置,本片不動。
log "7/8 寫入路徑合約(Sean Q1=D:直寫作廢,一律走 owner RPC)"

{ sql_head; cat <<'SQL'
-- ① service_role 走 E1(= 狀態機的第一步,也是每一條 edge 都會經過的 allowed-delta 呼叫)
DO $r$
DECLARE v_j uuid;
BEGIN
  SELECT job_id INTO v_j FROM fx;
  BEGIN
    SET LOCAL ROLE service_role;
    UPDATE public.order_refund_jobs
       SET status = 'processing', claim_token = gen_random_uuid(),
           claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
           next_retry_at = NULL
     WHERE id = v_j;
    RAISE NOTICE 'T2-ROLE|E1|OK';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2-ROLE|E1|% %', SQLSTATE, left(SQLERRM, 70);
  END;
  RESET ROLE;
END
$r$;

-- ② service_role 走「先鎖 cancellation 列」(gen2 的 INSERT 守門與 E14 都走這一步)
DO $r$
DECLARE v_c uuid;
BEGIN
  SELECT cancellation_id INTO v_c FROM fx;
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM 1 FROM public.order_cancellations WHERE id = v_c FOR UPDATE;
    RAISE NOTICE 'T2-ROLE|LOCK|OK';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2-ROLE|LOCK|% %', SQLSTATE, left(SQLERRM, 70);
  END;
  RESET ROLE;
END
$r$;
ROLLBACK;
SQL
} > "$WORK/role-fidelity.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/role-fidelity.sql" 2>&1)"
printf '%s\n' "$out" >> "$WORK/steps.log"
r_e1="$(printf '%s\n' "$out" | sed -n 's/.*T2-ROLE|E1|//p' | head -1)"
r_lk="$(printf '%s\n' "$out" | sed -n 's/.*T2-ROLE|LOCK|//p' | head -1)"
case "$r_e1" in
  42501*) ok "契約:service_role 直寫 E1 必失敗於 42501(${r_e1#42501 })" ;;
  OK)     bad "契約破了:service_role **直寫 E1 竟然成功** ⇒ 直寫路徑被重新打開(Sean Q1=D 明文作廢)" ;;
  *)      bad "契約:service_role 直寫 E1 應失敗於 42501,實為 [$r_e1]" ;;
esac
case "$r_lk" in
  42501*) ok "契約:service_role 直接鎖 order_cancellations 列必失敗於 42501(${r_lk#42501 })" ;;
  OK)     bad "契約破了:service_role **鎖得住 order_cancellations 列** ⇒ 取消真相表對後端程式開了寫入面" ;;
  *)      bad "契約:service_role 鎖 order_cancellations 應失敗於 42501,實為 [$r_lk]" ;;
esac

# ══════════════════════════════════════════════════════════════
# 9. §7.5 rule 4 覆蓋率 + 零留痕 + 結果
# ══════════════════════════════════════════════════════════════
log "8/8 §7.5 rule 4 覆蓋率 / 零留痕 / 結構零漂移"

missing=""
for e in "${EDGES[@]}"; do
  grep -q "T2-STEP|${e}|" "$WORK/steps.log" || missing="$missing $e"
done
if [ -z "$missing" ]; then
  ok "§7.5 rule 4:§3.1 的 16 條 edge **每一條都實跑過一次合法轉移**(全檔共 $(grep -c 'T2-STEP|' "$WORK/steps.log") 步合法轉移,**含**第 6 段六支消融檔的前綴,不只七條鏈)"
else
  bad "§7.5 rule 4:下列 edge 從未實跑過合法轉移 —$missing"
fi

for pair in "order_refund_jobs 0" "order_refund_job_items 0" "order_cancellations 0" \
            "order_cancellation_items 0" "order_refunds 0" "order_refund_items 0"; do
  set -- $pair
  [ "$(runsql "SELECT count(*) FROM public.$1")" = "$2" ] \
    && ok "零留痕:$1 仍為 $2 列" || bad "零留痕失敗:$1 不是 $2 列"
done

snapshot "$STRUCT_SQL" "$WORK/struct-after.snap" "跑完全部鏈後結構快照"
cmp -s "$WORK/struct-before.snap" "$WORK/struct-after.snap" \
  && ok "結構零漂移:跑完七條鏈 + 六道注入承重證明 + 角色保真探針後 catalog 一個 byte 都沒變" \
  || bad "結構漂移:跑完之後 catalog 被動到了"

printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
