#!/usr/bin/env bash
# ============================================================
# A7b-T · T3a「狀態機負測」可重現驗證 harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7.2 / §7.3 / §7.4
# 用法:scripts/a7bt-negative-state.sh all /tmp/a7bt3a   (從零 provision,最完整)
#      scripts/a7bt-negative-state.sh run /tmp/a7bt3a   (重用既有拋棄式 cluster)
#
# ── 與 T2 的分工(plan §7.4 開頭的紀律)────────────────────────────────
#   T2 = 正向鏈:證明「好的走得通」。
#   T3a = 本檔:證明「壞的被擋住」,且**紅在指定的那一支守門**,不是「反正紅了」。
#   🔴 兩者共用 `scripts/a7bt-fixtures.sh`:負測的 fixture 一律用**與正向鏈完全相同的
#      合法 edge**堆出來(plan §7.3),只在最後一步注入**一格**壞資料。
#
# ── 本檔的範圍(T3a / T3b 分界;plan §7.4 的編號)────────────────────────
#   🔴 Sean Q1=A 只說「T3a 狀態機負測 + T3b 錢面負測」,**逐字分界沒有規格**
#      ⇒ 本檔劃的線寫在 plan §7.2 前言,兩片相加**涵蓋 §7.4 全部 37 條、零孤兒**。
#   本檔收下:1 / 2-5 / 6(併發)/ 7 / 9 / 10-11 / 12 / 13 / 14 / 15 / 17 / 18 /
#            19 / 20 / 21 / 23 / 24 / 26 / 28 / 29 / 30 / 31 / 32 / 33 / 35 / 36 / 37
#   留給 T3b:8(跨表 bank id)/ 16(job↔ledger 十一欄 + item set + NULL-safe)/
#            22(dormant gate 雙向)/ 25(D7)/ 27(D9 全套)/ 34(時區兩跑)
#   留給 T4:突變 harness、ACL 32 格、barrier lock probe、rollback 六步隔離庫實跑
#
# ── 🔴 這支腳本**不**證明什麼(誠實邊界,不得在任何地方宣稱超出)─────────
#   · 不證明守門「涵蓋所有壞資料」—— 只證明**列出來的那些**各自紅在指定 ID。
#   · 不證明 T1 的守門在**併發**下成立(唯一的併發案例是 §7.4-6,其餘全是單交易)。
#   · 不證明正式站行為:本機 PG17.10 非 Supabase、C locale ≠ en_US.UTF-8。
#   · 不做突變(把守門刪掉看會不會轉紅)= T4。**本檔全綠不代表守門有承重**,
#     它只代表「這些壞資料現在進不去」。承重證明在 T4。
#     🔴 唯一的例外是「被支配」那一類:本檔對每一條**構造不出來**的規則逐條列出理由
#        (見 §7.2 矩陣的「被支配」欄),那些規則本檔**明說沒有行為覆蓋**。
#
# ── 判定紀律(A7 / A7-t / A1 / A7b-M / T2 的教訓,不重蹈)───────────────
#  ① 每一條負測都斷言 `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME` **等於指定值**。
#     A7-t 的實錘:每條突變都紅在同一個地方時,判別力歸零而 FAIL 數仍是 0。
#  ② **對照組必跑**:同一個外殼下的合法動作必須印「(未觸發:竟然成功)」。
#     沒有對照組,「全部都紅」可能只是外殼自己壞了。
#  ③ `pg_temp.assert()` 用 `IS NOT TRUE` ⇒ 條件為 NULL(查無列)也判失敗。
#  ④ 需要 DEFERRED constraint trigger 當場發作的案例,**必須**先
#     `SET CONSTRAINTS ALL IMMEDIATE` —— 否則那四支一次都不會跑(自我測試②證明)。
#  ⑤ `now()` = transaction_timestamp,單一交易內恆定 ⇒ 凡是「等待到期」的閘門一律
#     用共用的 `pg_temp.advance()` 注入,不各寫一套。
#  ⑥ 以 **owner(postgres)** 身分跑 = 模擬 SECURITY DEFINER RPC 內部的身分
#     (Sean 2026-07-31 拍 Q1=D:寫入一律走 owner RPC)。以 service_role 跑會紅在
#     42501 權限、而不是紅在守門 ⇒ 那種綠什麼都沒證明。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/a7bt-fixtures.sh
. scripts/a7bt-fixtures.sh

MODE="${1:?用法: a7bt-negative-state.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7bt3a)}"
export LC_ALL=C
guard_workdir "$WORK"

MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"

# ══════════════════════════════════════════════════════════════
# 負測案例機器
# ══════════════════════════════════════════════════════════════
# 🔴 `case_red` / `case_green` 已搬進 scripts/a7bt-fixtures.sh(T3b 用同一組形狀)。

# ══════════════════════════════════════════════════════════════
# fixture 前綴(全部由**合法 edge** 組成;唯一例外是共用的時間注入)
# ══════════════════════════════════════════════════════════════
p_none()        { :; }
p_processing()  { sql_e1; }
p_baseline()    { sql_e1; sql_e2; }
p_stamped()     { sql_e1; sql_e2; sql_e2b; }
p_stamped_old() { p_stamped; sql_advance '10 minutes'; }          # lease 已過期
p_baseline_old(){ p_baseline; sql_advance '10 minutes'; }         # lease 過期、未戳記
p_submitted()   { p_stamped; sql_e4 'TPR-T3A-0001'; }
p_submitted_due(){ p_submitted; sql_advance '2 days'; }
p_recon()       { p_stamped_old; sql_e3b; }                       # 走 E3b 進 reconciling
p_recon_due()   { p_recon; sql_advance '2 days'; }
p_completed()   { p_recon; sql_ledger_and_e9; }
p_failed()      { p_stamped; sql_e5; }
p_queued2()     { p_failed; sql_e6; sql_advance '90 minutes'; }   # backoff 已到期的 queued
p_dead()        { sql_retry_loop; }                               # dead / retry_exhausted / 未複核
p_dead_auth()   { sql_retry_loop; sql_advance '2 days'; sql_e13_auth; }
p_dead_ext()    { sql_retry_loop; sql_e13_plain 'external_refund_confirmed'; }
p_dead_wo()     { sql_retry_loop; sql_e13_plain 'over_refund_writeoff'; }
p_dead_corr()   { sql_retry_loop; sql_advance '2 days'
                  sql_e13_plain 'external_refund_confirmed'; sql_e14_auth; }
p_gen2()        { p_dead_auth; sql_gen2; }

# retry_count = 5 且已 stamped 的 processing(§7.4-15 / E5b 的 rc=6 前提)
p_rc5_stamped() {
  sql_c_round1; sql_c_round; sql_c_round; sql_c_round; sql_c_round
  sql_advance '1 day'; sql_e1; sql_e2b
}

# 第二張取消單(U3 / U5 / C1-C4 / 「該取消零列 job」都需要一個乾淨的 cancellation)
sql_fx2() { cat <<'SQL'
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
SELECT cancellation2_id, order_id, 'customer_request', gen_random_uuid(), repeat('a', 64), staff_a FROM fx;
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT cancellation2_id, order_id, order_item2_id, qty FROM fx;
SQL
}
p_fx2()          { sql_fx2; }
p_fx2_completed(){ p_completed; sql_fx2; }

# ══════════════════════════════════════════════════════════════
# 0. provision
# ══════════════════════════════════════════════════════════════
if [ "$MODE" = "all" ]; then
  log "0/9 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  stop_stale_cluster "$WORK"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成(全部既有 migration + A7b-M + A7b-T 依序套用)"
else
  mkdir -p "$WORK"
fi
# 🔴 身分閘:本檔含 `DROP DATABASE` / `TRUNCATE` / `ALTER TABLE` / `session_replication_role = replica`。
#    埠雖然硬編 54329,但「硬編」不是斷言。provision 會在 workdir 放 `.d1t2-harness` 標記,
#    這裡要求它存在、且連上去的確實是本機 54329 的拋棄式 cluster,否則停下。
[ -f "$WORK/.d1t2-harness" ] \
  || die "身分閘:$WORK 沒有 .d1t2-harness 標記 ⇒ 這不是 d1t2 provision 出來的拋棄式 cluster,拒絕執行"
[ "$(runsql "SELECT current_setting('port') || '|' || current_database()")" = "54329|postgres" ] \
  || die "身分閘:連到的不是 127.0.0.1:54329 的拋棄式 postgres 庫,拒絕執行"
ok "身分閘:workdir 帶 d1t2 標記、連線確為本機 54329 拋棄式 cluster"

: > "$WORK/steps.log"
: > "$WORK/matrix.tsv"

# ══════════════════════════════════════════════════════════════
# 1. harness 自我測試
# ══════════════════════════════════════════════════════════════
log "1/9 harness 自我測試(harness 自己壞掉時必須看得出來)"

( snapshot "SELECT this_column_does_not_exist FROM pg_class" "$WORK/selftest.snap" "自我測試" ) >/dev/null 2>&1
if [ $? -eq 0 ]; then
  die "自我測試①失敗:壞掉的快照 SQL 竟然沒有讓 snapshot() 中止"
fi
ok "自我測試①:壞掉的快照 SQL 會當場中止(不會變成假的零漂移)"

# 自我測試②:`SET CONSTRAINTS ALL IMMEDIATE` 真的會讓 DEFERRED constraint trigger 當場觸發。
# 🔴 本檔的 C1-C4 與「後代 item set」共 5 條負測**完全依賴**這一行;沒有它它們會恆綠。
{ sql_head; red_wrap_head; cat <<'SQL'
  -- 用 replica 模式繞過永久阻擋刪掉明細 ⇒ C1 應在 SET CONSTRAINTS 時當場紅
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.order_refund_job_items WHERE job_id = (SELECT job_id FROM fx);
  SET LOCAL session_replication_role = origin;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL
  red_wrap_tail; } > "$WORK/selftest-deferred.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/selftest-deferred.sql" 2>&1)"
actual="$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | tail -1)"
[ "$actual" = "a7bt_c1_job_has_no_items" ] \
  && ok "自我測試②:SET CONSTRAINTS ALL IMMEDIATE 確實讓 DEFERRED constraint trigger 當場觸發" \
  || die "自我測試②失敗:期望紅在 a7bt_c1_job_has_no_items,實為 [$actual]"

# 自我測試③:忘了把 session_replication_role 還原會被當場抓到。
# 🔴 本檔有兩條負測刻意用 replica 模式構造(U2 / 自我測試②)⇒ 這道守衛必須被證明會響。
{ sql_head; cat <<'SQL'
SET LOCAL session_replication_role = replica;
DO $g$
DECLARE v_msg text;
BEGIN
  PERFORM pg_temp.mark('E1', (SELECT job_id FROM fx));
  RAISE NOTICE 'T3A-GUARD|(未觸發:守門關著時 mark() 竟然放行)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  RAISE NOTICE 'T3A-GUARD|%', left(v_msg, 40);
END
$g$;
SET LOCAL session_replication_role = origin;
ROLLBACK;
SQL
} > "$WORK/selftest-guard.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/selftest-guard.sql" 2>&1)"
case "$(printf '%s\n' "$out" | sed -n 's/.*T3A-GUARD|//p' | head -1)" in
  "T2:session_replication_role = replica"*)
    ok "自我測試③:守門被關著時 mark() 會當場中止(replica 模式下的假綠被封死)" ;;
  *) die "自我測試③失敗:守門關著時 mark() 沒有中止" ;;
esac

# 自我測試④:T1 的七支函式本體指紋 = migration 檔裡的常數。
# 🔴 沒有這一段,`run` 模式對著一台用**舊版檔案** provision 的 cluster 會印全綠。
fpr_n=0; fpr_bad=""
while IFS='|' read -r fn want; do
  fpr_n=$((fpr_n + 1))
  got="$(runsql "SELECT coalesce((SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'), '(缺)')")"
  [ "$got" = "$want" ] || fpr_bad="$fpr_bad $fn(期望 ${want:0:8}… 實際 ${got:0:8}…)"
done < <(sed -n "s/^ *('\(pcm_a7bt_[a-z_]*\)', *'\([0-9a-f]\{32\}\)').*/\1|\2/p" "$MIG")
if [ "$fpr_n" -ne 7 ]; then
  die "自我測試④:從 migration 檔抽出的函式指紋常數不是 7 筆(實 $fpr_n)⇒ 抽取式失配,本段等於沒驗"
elif [ -n "$fpr_bad" ]; then
  die "自我測試④:庫裡的函式本體與 migration 檔不符 —$fpr_bad"
else
  ok "自我測試④:七支函式本體指紋 = migration 檔裡的常數(run 模式也與檔案掛鉤)"
fi

snapshot "$STRUCT_SQL" "$WORK/struct-before.snap" "跑負測前結構快照"
ok "結構快照建立(跑完全部負測後會再比一次)"

# ══════════════════════════════════════════════════════════════
# 2. 對照組(§7.3;沒有它,「全部都紅」證明不了任何事)
# ══════════════════════════════════════════════════════════════
log "2/9 對照組:同一個外殼下的合法動作必須不紅"

case_green "queued 走合法 E1" p_none <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_retry_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_green "已 stamped 的 processing 走合法 E4" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-CTL'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_green "合法的第二張取消單 + 明細(deferred 全部當場檢查通過)" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECC2', 20, '0'), rpad('BRFC2', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '對照組', staff_a, 'req-ctl' FROM fx;
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_green "未複核的 dead 走合法 E13(external_refund_confirmed)" p_dead <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'external_refund_confirmed'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_green "已結案的 dead 由另一位 staff 走合法 E14 更正" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '原結案人選錯,實為超退沖銷'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_green "已授權重試的前代之後開合法 gen2(含子表與 deferred 全部當場檢查)" p_dead_auth <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, 2,
         rpad('RECT2', 20, '0'), rpad('BRFCTL2', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0,
         '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-ctl-g2' FROM fx;
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job2_id, order_id, order_item_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# ══════════════════════════════════════════════════════════════
# 3. INSERT 守門(§7.4-1 / 2-5 / 7 / 9)
# ══════════════════════════════════════════════════════════════
log "3/9 INSERT 守門(§7.4-1 / 2-5 / 7 / 9)"

case_red "§7.4-1 直接 INSERT 一列 status='completed' 的假完成單" \
         "a7bt_insert_must_be_queued" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id, status)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECN1', 20, '0'), rpad('BRFN1', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '假完成單', staff_a, 'req-n1', 'completed' FROM fx;
SQL

case_red "INSERT 帶既往狀態(reviewed_at 非 NULL)" \
         "a7bt_insert_history_must_be_null" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id, reviewed_at)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECN2', 20, '0'), rpad('BRFN2', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '帶既往狀態', staff_a, 'req-n2', now() FROM fx;
SQL

case_red "INSERT 計數器非起始值(retry_count=3)" \
         "a7bt_insert_counters_must_be_initial" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id, retry_count)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECN3', 20, '0'), rpad('BRFN3', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '計數器非零', staff_a, 'req-n3', 3 FROM fx;
SQL

sql_gen2_variant() {  # $1=bank id 尾碼 $2=reason $3=generation
cat <<SQL
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, ${3:-2},
         rpad('RECT2', 20, '0'), rpad('${1:?}', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0,
         '${2:-客人要求取消(A7b-T T2 正向鏈)}', staff_a, 'req-t3a-g2' FROM fx;
SQL
}

case_red "§7.4-2 前代還是 queued 就開 gen2" \
         "a7bt_insert_predecessor_not_dead" p_none <<SQL
$(sql_gen2_variant 'BRFG2A')
SQL

case_red "§7.4-3 前代結成 external_refund_confirmed 仍開 gen2" \
         "a7bt_insert_predecessor_not_authorized" p_dead_ext <<SQL
$(sql_gen2_variant 'BRFG2B')
SQL

case_red "§7.4-4 前代結成 over_refund_writeoff 仍開 gen2" \
         "a7bt_insert_predecessor_not_authorized" p_dead_wo <<SQL
$(sql_gen2_variant 'BRFG2C')
SQL

case_red "§7.4-5 拿 gen1 的舊授權開 gen3(gen2 還活著)" \
         "a7bt_insert_predecessor_not_dead" p_gen2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation_id, order_id, 3,
         rpad('RECT2', 20, '0'), rpad('BRFG3', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0,
         '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t3a-g3' FROM fx;
SQL

case_red "跳號:只有 gen1 已授權卻直接開 gen3" \
         "a7bt_insert_not_direct_successor" p_dead_auth <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, 3,
         rpad('RECT2', 20, '0'), rpad('BRFG3B', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0,
         '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t3a-g3b' FROM fx;
SQL

case_red "§7.4-7 該取消一列 job 都沒有卻開 gen2(NOT FOUND fail-closed)" \
         "a7bt_insert_no_predecessor" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id, 2,
         rpad('RECN7', 20, '0'), rpad('BRFN7', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '無前代', staff_a, 'req-n7' FROM fx;
SQL

case_red "§7.4-9a 後代 payload 與前代不同(reason 被改)" \
         "a7bt_insert_payload_differs_from_predecessor" p_dead_auth <<SQL
$(sql_gen2_variant 'BRFG2D' '換了一個理由')
SQL

case_red "§7.4-9b 後代重用前代的 bank_refund_id(世代重試不靠冪等鍵)" \
         "a7bt_insert_successor_reuses_bank_id" p_dead_auth <<SQL
$(sql_gen2_variant 'BRFT2')
SQL

case_red "§7.4-9c 後代 item set 與前代不同(換成同單同價的另一個品項)" \
         "a7bt_successor_item_set_differs" p_dead_auth <<SQL
$(sql_gen2_variant 'BRFG2E')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job2_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# ══════════════════════════════════════════════════════════════
# 4. classifier:表外組合一律拒絕 / 判別式必須互斥(§7.4-10 / 11 / 35)
# ══════════════════════════════════════════════════════════════
log "4/9 classifier(§7.4-10 / 11 / 35)"

case_red "§7.4-35b 一條 edge 都不滿足的 UPDATE(queued→queued、零 delta)" \
         "a7bt_edge_unmatched" p_none <<'SQL'
  UPDATE public.order_refund_jobs SET request_id = request_id
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-10 submitted → processing" "a7bt_edge_unmatched" p_submitted <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-10 reconciling → processing(R10:永不回 processing)" \
         "a7bt_edge_unmatched" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', next_check_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-11 submitted → failed(R11:failed 不在 submitted 之後)" \
         "a7bt_edge_unmatched" p_submitted <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', next_check_at = NULL, next_retry_at = now() + interval '5 minutes',
         failed_reason = '不該走得通', retry_count = 1, refund_call_attempted_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-11 submitted → dead" "a7bt_edge_unmatched" p_submitted <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', next_check_at = NULL,
         dead_reason = 'over_refunded', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-11 completed 轉出(終態不可轉出)" "a7bt_edge_unmatched" p_completed <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'queued', refund_id = NULL, refund_call_attempted_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-11 dead → queued" "a7bt_edge_unmatched" p_dead <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'queued', dead_reason = NULL, manual_review_required = false,
         failed_reason = NULL, retry_count = 0
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-35a 同時滿足兩條 edge(E2 與 E2b 一次做完)" \
         "a7bt_edge_ambiguous" p_processing <<'SQL'
  UPDATE public.order_refund_jobs
     SET refunded_before = 0, refunded_target = refund_amount,
         refund_call_attempted_at = now(), last_refund_call_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

# ══════════════════════════════════════════════════════════════
# 5. 逐 edge 的額外條件(§7.2「16 條 edge × 每條至少一格」)
# ══════════════════════════════════════════════════════════════
log "5/9 逐 edge 額外條件(§7.4-12/13/14/15/18/23/24/26/28/29/30/31/32/33)"

# ── E1 ──
case_red "E1 沒寫 claim_token" "a7bt_e1_claim_token_shape" p_none <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-28 E1 lease 錨點給過去" "a7bt_e1_lease_anchor" p_none <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now() - interval '1 minute',
         claim_expires_at = now() - interval '1 minute' + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-28 E1 lease 錨點給未來" "a7bt_e1_lease_anchor" p_none <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now() + interval '1 minute',
         claim_expires_at = now() + interval '6 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-28 E1 claim 後不清 next_retry_at" \
         "a7bt_e1_next_retry_not_cleared" p_queued2 <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E2 ──
case_red "E2 baseline 只寫一半(refunded_target 仍 NULL)" \
         "a7bt_e2_baseline_not_paired" p_processing <<'SQL'
  UPDATE public.order_refund_jobs SET refunded_before = 0
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E2b ──
case_red "§7.4-13a 沒 baseline 就戳呼叫記號" \
         "a7bt_e2b_baseline_required" p_processing <<'SQL'
  UPDATE public.order_refund_jobs
     SET refund_call_attempted_at = now(), last_refund_call_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E2b 的 attempted 不等於 now()" \
         "a7bt_e2b_attempted_must_be_now" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs
     SET refund_call_attempted_at = now() - interval '1 minute', last_refund_call_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-31a E2b 把 last_refund_call_at 留成 NULL" \
         "a7bt_e2b_last_call_must_be_now" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs SET refund_call_attempted_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-31b E2b 把 last_refund_call_at 往回寫" \
         "a7bt_e2b_last_call_must_be_now" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs
     SET refund_call_attempted_at = now(), last_refund_call_at = now() - interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-26 E2b 以外的 edge 想改 attempted(E4 順手改)" \
         "a7bt_immutable_column_changed" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-26',
         refund_call_attempted_at = now() - interval '1 hour'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-31c E2b 以外的 edge 想清掉 last_refund_call_at(E4 順手清)" \
         "a7bt_immutable_column_changed" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-31',
         last_refund_call_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E3 / E3b ──
case_red "§7.4-14 已有呼叫記號的 lease 過期列走 E3 重領回 processing" \
         "a7bt_e3_attempted_must_be_null" p_stamped_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E3 重領時 lease 錨點沒重設" "a7bt_e3_lease_anchor" p_baseline_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "沒有呼叫記號卻走 E3b 進 reconciling" \
         "a7bt_e3b_attempted_required" p_baseline_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E3b 的 next_check_at 沒跨台北日界(用 now() ⇒ 台北日期必相同)" \
         "a7bt_e3b_next_check_not_next_day" p_stamped_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E3b 的 lease 錨點沒重設" "a7bt_e3b_lease_anchor" p_stamped_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claim_expires_at = now() + interval '5 minutes',
         next_check_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E3b 沒換新 claim_token(舊 worker 的 token 仍有效)" \
         "a7bt_e3b_claim_token_not_new" p_stamped_old <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling',
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E4 ──
case_red "沒 baseline 就宣告送出成功" "a7bt_e4_baseline_required" p_processing <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-E4A'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-13b 沒戳呼叫記號就 processing → submitted" \
         "a7bt_e4_attempted_required" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-E4B'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E4 沒寫 tappay_refund_id(唯一可首寫的 edge 卻不寫)" \
         "a7bt_e4_tappay_id_first_write" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E4 沒清 lease 三欄" "a7bt_e4_lease_not_cleared" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted',
         next_check_at = now() + interval '1 day', tappay_refund_id = 'TPR-T3A-E4C'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E4 的 next_check_at 沒跨台北日界(用 now() ⇒ 台北日期必相同)" \
         "a7bt_e4_next_check_not_next_day" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = now(), tappay_refund_id = 'TPR-T3A-E4D'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E5 / E5b(D12)──
case_red "§7.4-32a 沒呼叫記號的 processing 記成明確失敗(D12)" \
         "a7bt_e5_attempted_required" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         failed_reason = '沒打過卻說失敗', retry_count = 1,
         next_retry_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5 的 failed_reason 是視覺空字串(全形空白 + TAB)" \
         "a7bt_e5_failed_reason_blank" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, failed_reason = E'\t　 ', retry_count = 1,
         next_retry_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-15 retry_count 已經 5 還走 E5(第六次必須走 E5b)" \
         "a7bt_e5_retry_count_step" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, failed_reason = '第六次', retry_count = retry_count + 1,
         next_retry_at = now() + interval '5 minutes' * (1 << retry_count)
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5 沒清 lease 三欄" "a7bt_e5_lease_not_cleared" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', refund_call_attempted_at = NULL,
         failed_reason = 'lease 沒清', retry_count = 1,
         next_retry_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-24 E5 不清 refund_call_attempted_at" \
         "a7bt_e5_attempted_not_cleared" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         failed_reason = '戳記沒清', retry_count = 1,
         next_retry_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-18 E5 的 backoff 倍率錯(第一次失敗卻只等 4 分鐘)" \
         "a7bt_e5_backoff_formula" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, failed_reason = '倍率錯', retry_count = 1,
         next_retry_at = now() + interval '4 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

# 🔴🔴 **plan §7.4-18 的字面(「基準用 created_at 或 OLD.updated_at」)在單一交易內構造不出來**
#    —— 首跑實測:那條負測**竟然通過**(綠)。原因不是守門有洞,是我的 mutant 不是 mutant:
#    fixture 的 job 就在本交易內 INSERT,`created_at` DEFAULT `now()` = transaction_timestamp
#    ⇒ `created_at + 5min` 與 `now() + 5min` **是同一個值**。`updated_at` 同理。
#    ⇒ 這是 T2 抓到的「now() 在單一交易內恆定」那一族的第二例,plan §7.4 的時間注入
#      例外清單再度不完整。
#    ⇒ 修法 = **具名的一次性注入**:只把 `created_at` 往回移一天(不動任何其他欄),
#      讓「基準寫錯」在型式上分得出來。這是本檔唯一一次注入 `created_at`,
#      共用的 `pg_temp.advance()` 刻意不含它(它只處理六個「等待/過去事件」欄)。
p_stamped_old_created() {
  p_stamped
  cat <<'SQL'
SET LOCAL session_replication_role = replica;
UPDATE public.order_refund_jobs SET created_at = created_at - interval '1 day'
 WHERE id = (SELECT job_id FROM fx);
SET LOCAL session_replication_role = origin;
SQL
}
case_red "§7.4-18 E5 的 backoff 基準用 created_at 而不是 now()(created_at 已注入為昨天)" \
         "a7bt_e5_backoff_formula" p_stamped_old_created <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'failed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, failed_reason = '基準錯', retry_count = 1,
         next_retry_at = created_at + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-32b 沒呼叫記號的 processing 直接判 dead(D12)" \
         "a7bt_e5b_attempted_required" p_baseline <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         failed_reason = '沒打過卻判死', retry_count = 6,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 的 retry_count 不是 6(第一次失敗就判死)" \
         "a7bt_e5b_retry_count_must_be_six" p_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, failed_reason = '第一次就判死', retry_count = 1,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 的 dead_reason 不是 retry_exhausted(偽裝成超退)" \
         "a7bt_e5b_dead_reason" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, next_retry_at = NULL,
         failed_reason = '第六次', retry_count = retry_count + 1,
         dead_reason = 'over_refunded', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 沒標 manual_review_required(死了卻沒人被叫醒)" \
         "a7bt_e5b_manual_review_required" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, next_retry_at = NULL,
         failed_reason = '第六次', retry_count = retry_count + 1,
         dead_reason = 'retry_exhausted'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 的 failed_reason 是視覺空字串" \
         "a7bt_e5b_failed_reason_blank" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, next_retry_at = NULL,
         failed_reason = E'\t　 ', retry_count = retry_count + 1,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 沒清 lease 三欄" "a7bt_e5b_lease_not_cleared" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', refund_call_attempted_at = NULL, next_retry_at = NULL,
         failed_reason = '第六次', retry_count = retry_count + 1,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 不清 refund_call_attempted_at" \
         "a7bt_e5b_attempted_not_cleared" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_retry_at = NULL, failed_reason = '第六次', retry_count = retry_count + 1,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E5b 沒清 next_retry_at(dead 不該再排重試)" \
         "a7bt_e5b_next_retry_not_cleared" p_rc5_stamped <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_call_attempted_at = NULL, next_retry_at = now() + interval '5 minutes',
         failed_reason = '第六次', retry_count = retry_count + 1,
         dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E6 ──
case_red "§7.4-23a E6 回佇列卻不清 failed_reason" \
         "a7bt_e6_failed_reason_not_cleared" p_failed <<'SQL'
  UPDATE public.order_refund_jobs SET status = 'queued'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-23b E6 順手重算 next_retry_at(只准保留)" \
         "a7bt_immutable_column_changed" p_failed <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'queued', failed_reason = NULL, next_retry_at = now() + interval '1 minute'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E8 ──
case_red "E8 沒換新 claim_token" "a7bt_e8_claim_token_not_new" p_submitted_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E8 的 lease 錨點錯" "a7bt_e8_lease_anchor" p_submitted_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '30 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E9 ──
case_red "E9 沒寫 refund_id" "a7bt_e9_refund_id_first_write" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E9 沒清 next_check_at" "a7bt_e9_next_check_not_cleared" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E9 沒清 lease 三欄" "a7bt_e9_lease_not_cleared" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E10 ──
case_red "E10 沒把 next_check_at 往後推" \
         "a7bt_e10_next_check_not_advanced" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         check_fail_count = 0
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E10 沒清 lease 三欄" "a7bt_e10_lease_not_cleared" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', next_check_at = next_check_at + interval '1 day',
         check_fail_count = 0
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E10 的 check_fail_count 一次跳 2" \
         "a7bt_e10_check_fail_count_step" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = next_check_at + interval '1 day',
         check_fail_count = check_fail_count + 2
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E11 ──
case_red "E11 沒換新 claim_token" "a7bt_e11_claim_token_not_new" p_recon_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E11 的 lease 錨點錯" "a7bt_e11_lease_anchor" p_recon_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '1 hour'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E12 ──
case_red "§7.4-30 E12 不清 next_check_at" \
         "a7bt_e12_next_check_not_cleared" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         dead_reason = 'over_refunded', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E12 沒清 lease 三欄" "a7bt_e12_lease_not_cleared" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', next_check_at = NULL,
         dead_reason = 'over_refunded', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E12 沒標 manual_review_required" \
         "a7bt_e12_manual_review_required" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, dead_reason = 'over_refunded'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E12 的 dead_reason 用了 retry_exhausted(那是 E5b 專用)" \
         "a7bt_e12_dead_reason" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, dead_reason = 'retry_exhausted', manual_review_required = true
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E12(over_refunded)順手動了 check_fail_count" \
         "a7bt_e12_over_refunded_counter_changed" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, dead_reason = 'over_refunded', manual_review_required = true,
         check_fail_count = check_fail_count + 1
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E12(reconcile_exhausted)但 check_fail_count 不是 6" \
         "a7bt_e12_exhausted_counter_step" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'dead', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, dead_reason = 'reconcile_exhausted',
         manual_review_required = true, check_fail_count = check_fail_count + 1
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── E13 / E14(D11)──
case_red "§7.4-12a 只寫 reviewed_at(U2/U3 的 partial 條件會當場失效)" \
         "a7bt_e13_review_triple_incomplete" p_dead <<'SQL'
  UPDATE public.order_refund_jobs SET reviewed_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E13 順手改 dead_reason" "a7bt_immutable_column_changed" p_dead <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'external_refund_confirmed', dead_reason = 'over_refunded'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-12b 已結案的 dead 再走一次 E13(改寫結案人)" \
         "a7bt_immutable_column_changed" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_b FROM fx),
         resolution = 'over_refund_writeoff'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33a 還沒結案就想走 E14 更正" \
         "a7bt_immutable_column_changed" p_dead <<'SQL'
  UPDATE public.order_refund_jobs
     SET corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '還沒結案就更正'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33b 第二次 E14(第二道 CAS)" \
         "a7bt_e14_already_corrected" p_dead_corr <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         retry_auth_recorded_refunded = NULL, retry_auth_checked_at = NULL,
         corrected_at = now(), corrected_by = (SELECT staff_a FROM fx),
         correction_reason = '第二次更正'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33c 更正人 = 原結案人(兩人簽核被繞過)" \
         "a7bt_e14_same_person" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         corrected_at = now(), corrected_by = (SELECT staff_a FROM fx),
         correction_reason = '同一個人自己改自己'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33d 已有後繼列仍走 E14(會產生孤兒授權)" \
         "a7bt_e14_successor_exists" p_gen2 <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         retry_auth_recorded_refunded = NULL, retry_auth_checked_at = NULL,
         corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '後繼已開還要改授權'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33e E14 改動原結案人(稽核痕跡被抹掉)" \
         "a7bt_immutable_column_changed" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff', reviewed_by = (SELECT staff_b FROM fx),
         corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '順手改掉原結案人'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-33f correction_reason 是視覺空字串" \
         "a7bt_e14_correction_reason_blank" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = E'\t　 '
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E14 的 corrected 三欄不齊(只寫 corrected_at)" \
         "a7bt_e14_correction_triple_incomplete" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff', corrected_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "E14 的 corrected_at 是未來時間" \
         "a7bt_e14_corrected_at_in_future" p_dead_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'over_refund_writeoff',
         corrected_at = now() + interval '1 day', corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '時間往前灌'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ── §7.4-29 tappay_refund_id 首寫獨佔(除 E4 外一律不得動)──
case_red "§7.4-29 E8 偷寫 tappay_refund_id" \
         "a7bt_immutable_column_changed" p_submitted_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         tappay_refund_id = 'TPR-FAKE-E8'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-29 E10 偷寫 tappay_refund_id" \
         "a7bt_immutable_column_changed" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'submitted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = next_check_at + interval '1 day', check_fail_count = 0,
         tappay_refund_id = 'TPR-FAKE-E10'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-29 E11 偷寫 tappay_refund_id" \
         "a7bt_immutable_column_changed" p_recon_due <<'SQL'
  UPDATE public.order_refund_jobs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         tappay_refund_id = 'TPR-FAKE-E11'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-29 E9 偷寫 tappay_refund_id" \
         "a7bt_immutable_column_changed" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx),
         tappay_refund_id = 'TPR-FAKE-E9'
   WHERE id = (SELECT job_id FROM fx);
SQL

# ══════════════════════════════════════════════════════════════
# 6. 子表四不變式 + 不可逆(§7.4-17 / 19)
# ══════════════════════════════════════════════════════════════
log "6/9 子表不變式與 DELETE / TRUNCATE(§7.4-17 / 19)"

sql_job3_header() {  # $1=items_amount / refund_amount(兩者必須相等,orj_amount_balances)
cat <<SQL
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECC3', 20, '0'), rpad('BRFC3', 20, '0'), repeat('c', 64),
         ${1:-amount}, ${1:-amount}, 0, 0, 0, '子表負測', staff_a, 'req-c3' FROM fx;
SQL
}

case_red "§7.4-17 C1:有 header、零明細" "a7bt_c1_job_has_no_items" p_fx2 <<SQL
$(sql_job3_header)
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C2:Σ line_amount ≠ items_amount" \
         "a7bt_c2_items_amount_mismatch" p_fx2 <<SQL
$(sql_job3_header 'amount + 1')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C3:退的數量超過原品項" \
         "a7bt_c3_quantity_exceeds_order_item" p_fx2 <<SQL
$(sql_job3_header 'amount * 2')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, 2, unit_price, amount * 2 FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C4:單價不等於訂單快照" \
         "a7bt_c4_unit_price_mismatch" p_fx2 <<SQL
$(sql_job3_header 'amount + 1')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price + 1, amount + 1 FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 子表 UPDATE 一律阻擋" "a7bt_items_update_blocked" p_none <<'SQL'
  UPDATE public.order_refund_job_items SET quantity = quantity
   WHERE job_id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-17 子表 DELETE 一律阻擋" "a7bt_items_delete_blocked" p_none <<'SQL'
  DELETE FROM public.order_refund_job_items WHERE job_id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-19 主表 DELETE 一律阻擋(owner 身分)" \
         "a7bt_jobs_delete_blocked" p_none <<'SQL'
  DELETE FROM public.order_refund_jobs WHERE id = (SELECT job_id FROM fx);
SQL

# 🔴 TRUNCATE 的形狀陷阱(T2 實測、已寫進 T1 註解):
#    ① 交易內若還有 pending DEFERRED 事件,`TRUNCATE` 先死於 **55006**、CONSTRAINT_NAME 為空
#       ⇒ 把守門整支刪掉結果一樣 = 測不到東西。必須先 SET CONSTRAINTS ALL IMMEDIATE。
#    ② 單獨 `TRUNCATE order_refund_jobs` 更早死在子表 FK 的 **0A000**,同樣是假綠
#       ⇒ 可達形狀只有「兩表同一句」與 `CASCADE`。
case_red "§7.4-19 TRUNCATE 兩表同一句(先清 pending deferred)" \
         "a7bt_jobs_truncate_blocked" p_none <<'SQL'
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  TRUNCATE public.order_refund_jobs, public.order_refund_job_items;
SQL

case_red "§7.4-19 TRUNCATE 主表 CASCADE" \
         "a7bt_jobs_truncate_blocked" p_none <<'SQL'
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  TRUNCATE public.order_refund_jobs CASCADE;
SQL

case_red "§7.4-19 單獨 TRUNCATE 子表" \
         "a7bt_items_truncate_blocked" p_none <<'SQL'
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  TRUNCATE public.order_refund_job_items;
SQL

# ══════════════════════════════════════════════════════════════
# 7. 五道唯一性裡本片負責的四道(§7.4-20 / 21;U1 另見第 9 段併發)
# ══════════════════════════════════════════════════════════════
log "7/9 唯一性索引(§7.4-20 / 21)"

case_red "U1:同一取消的同一世代重複建" \
         "orj_cancellation_generation_key" p_none <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id,
         rpad('RECU1', 20, '0'), rpad('BRFU1', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0, '同世代重複建', staff_a, 'req-u1' FROM fx;
SQL

# 🔴 U2 只有在 **INSERT 守門被關掉** 時才構造得出來(逐條理由見 plan §7.2 的「被支配」欄):
#    合法路徑下「同一取消的第二個未結案 job」需要前代 dead 且已授權,而那一刻前代的
#    `reviewed_at` 已非 NULL ⇒ 不再落入 U2 的 partial 條件。
#    ⇒ 本案例以 `session_replication_role = replica` 模擬 **break-glass**
#      (owner 把守門 DISABLE 的那一刻)—— 那正是 plan §4.3 說這五道索引存在的理由。
p_replica() { printf 'SET LOCAL session_replication_role = replica;\n'; }
case_red "§7.4-20 U2:break-glass 下同一取消出現第二個未結案 job" \
         "orj_one_current_per_cancellation_idx" p_replica <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, 2,
         rpad('RECU2', 20, '0'), rpad('BRFU2', 20, '0'), repeat('b', 64),
         amount, amount, 0, 0, 0, '第二個未結案', staff_a, 'req-u2' FROM fx;
SQL

case_red "§7.4-20 U3:另一張取消單重用同一筆 TapPay 交易(rec_trade_id)" \
         "orj_one_current_per_rec_trade_idx" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECT2', 20, '0'), rpad('BRFU3', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '同一筆交易兩個 job', staff_a, 'req-u3' FROM fx;
SQL

# U5:job1 已 completed 並綁定帳本 L;第二張取消單的 job 也想綁 L。
p_u5() {
  p_fx2_completed
  cat <<'SQL'
INSERT INTO public.order_refund_jobs
  (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
   refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
   reason, actor, request_id)
SELECT job3_id, cancellation2_id, order_id,
       rpad('RECU5', 20, '0'), rpad('BRFU5', 20, '0'), repeat('c', 64),
       amount, amount, 0, 0, 0, 'U5 第二個 job', staff_a, 'req-u5' FROM fx;
INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;

UPDATE public.order_refund_jobs
   SET status = 'processing', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
 WHERE id = (SELECT job3_id FROM fx);
UPDATE public.order_refund_jobs
   SET refunded_before = 0, refunded_target = refund_amount
 WHERE id = (SELECT job3_id FROM fx);
UPDATE public.order_refund_jobs
   SET refund_call_attempted_at = now(), last_refund_call_at = now()
 WHERE id = (SELECT job3_id FROM fx);
SET LOCAL session_replication_role = replica;
UPDATE public.order_refund_jobs
   SET claimed_at = claimed_at - interval '10 minutes',
       claim_expires_at = claim_expires_at - interval '10 minutes'
 WHERE id = (SELECT job3_id FROM fx);
SET LOCAL session_replication_role = origin;
UPDATE public.order_refund_jobs
   SET status = 'reconciling', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_check_at = now() + interval '1 day'
 WHERE id = (SELECT job3_id FROM fx);
SQL
}
case_red "§7.4-21 U5:兩個 job 綁同一張帳本" \
         "orj_one_job_per_refund_idx" p_u5 <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job3_id FROM fx);
SQL

# ══════════════════════════════════════════════════════════════
# 8. deny-by-default(§7.4-36)+ 寫入路徑合約(§7.4-37)
# ══════════════════════════════════════════════════════════════
log "8/9 deny-by-default(§7.4-36)與寫入路徑合約(§7.4-37)"

# 行為半:新增一個不在任何白名單裡的欄 ⇒ 想改它一定被擋。
# 🔴 這一條才是「deny-by-default 不是宣告而是機制」的證據:
#    T1 用 `to_jsonb(OLD)` 逐 key 比對,新欄自動落入「必須 IS NOT DISTINCT FROM OLD」。
# 🔴 `SET CONSTRAINTS ALL IMMEDIATE` 不可省:交易內只要還有 pending DEFERRED 事件,
#    `ALTER TABLE` 會死在 `cannot ALTER TABLE ... because it has pending trigger events`
#    ⇒ 整條負測拿不到 CONSTRAINT_NAME(首跑實測就是這樣紅的),與 TRUNCATE 的 55006 同型。
p_addcol() { printf "SET CONSTRAINTS ALL IMMEDIATE;\nALTER TABLE public.order_refund_jobs ADD COLUMN zzz_t3a_probe text;\n"; }
case_red "§7.4-36 新增一個不在任何 edge 白名單裡的欄,合法 E1 想順手寫它" \
         "a7bt_immutable_column_changed" p_addcol <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'processing', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_retry_at = NULL, zzz_t3a_probe = '偷渡'
   WHERE id = (SELECT job_id FROM fx);
SQL

# 結構半:欄數常數**從 migration 檔即時抽出**(不在本檔另抄一份 = 不製造第二個真相),
# 加欄之後必須與實際不符;不加欄則必須相符。
COLN="$(sed -n 's/.*order_refund_jobs 應為 \([0-9]\{1,\}\) 欄.*/\1/p' "$MIG" | head -1)"
case "$COLN" in
  ''|*[!0-9]*) bad "§7.4-36 結構半:從 migration 檔抽不到欄數常數(抽取式失配)⇒ 本段等於沒驗" ;;
  *)
    live="$(runsql "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_refund_jobs'::regclass AND attnum>0 AND NOT attisdropped")"
    probe="$(runsql "BEGIN; ALTER TABLE public.order_refund_jobs ADD COLUMN zzz_t3a_probe text; SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_refund_jobs'::regclass AND attnum>0 AND NOT attisdropped; ROLLBACK;" | tail -1)"
    if [ "$live" = "$COLN" ] && [ "$probe" = "$((COLN + 1))" ]; then
      ok "§7.4-36 結構半:欄數 = migration 檔常數 $COLN;加一欄後變 $probe ⇒ T1 §9.2 的集合相等斷言會轉紅"
    else
      bad "§7.4-36 結構半:期望 live=$COLN / 加欄後=$((COLN + 1)),實為 live=$live / 加欄後=$probe"
    fi ;;
esac

# A7b-M 的約束集合指紋:T1 §9.6 拿它當「拆閘門的前提」。
# 🔴 truth table 的 7 條 `orj_shape_*`(以及 D7/D9 四條錢面 CHECK)全部涵蓋在這個指紋裡
#    ⇒ plan §7.2 要求的「被支配的格改用結構字面驗證」由這一段關閉,不另抄一份期望字串。
# 🔴 anchor 在「A7b-M 的約束集合指紋不符:期望 <md5>」那一行,不用 `head -1` 撿檔內第一個 md5
#    —— 同檔還有索引指紋,順序一變就會比錯常數(code-reviewer N8)。
MFPR="$(sed -n 's/.*A7b-M 的約束集合指紋不符:期望 \([0-9a-f]\{32\}\).*/\1/p' "$MIG" | head -1)"
MCNT="$(sed -n 's/.*A7b-M 的約束應為 \([0-9]\{1,\}\) 條.*/\1/p' "$MIG" | head -1)"
if [ -z "$MFPR" ] || [ -z "$MCNT" ]; then
  bad "A7b-M 指紋常數抽取失配(fpr=[$MFPR] cnt=[$MCNT])⇒ 本段等於沒驗"
else
  gotf="$(runsql "SELECT md5(string_agg(sig, E'\n' ORDER BY sig)) FROM (SELECT c.relname||'.'||con.conname||'='||pg_get_constraintdef(con.oid) AS sig FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items') AND con.contype <> 't' AND con.conname <> 'order_refund_jobs_dormant_until_triggers') s")"
  gotc="$(runsql "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items') AND con.contype <> 't' AND con.conname <> 'order_refund_jobs_dormant_until_triggers'")"
  [ "$gotf" = "$MFPR" ] && [ "$gotc" = "$MCNT" ] \
    && ok "truth table 的結構字面驗證:A7b-M 約束指紋 = migration 檔常數(${MFPR:0:8}… / $MCNT 條;7 條 orj_shape_* 含在內)" \
    || bad "A7b-M 約束指紋不符:期望 ${MFPR:0:8}…/$MCNT,實為 ${gotf:0:8}…/$gotc"
fi

# §7.4-37 本片必做的那半:service_role 直接寫帳本必 42501(純 ACL,不需要任何新函式)。
# ⛔ 另一半(complete_refund_job 單交易成功 / 中途 RAISE 無殘留)屬第 3 批,本片測不了。
{ sql_head; cat <<'SQL'
DO $r$
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    INSERT INTO public.order_refunds
      (id, order_id, bank_refund_id, items_amount, shipping_fee_before, shipping_fee_after,
       shipping_delta, refund_amount, status, reason, actor, request_id)
    SELECT led_id, order_id, rpad('BRFSR', 20, '0'), amount, 0, 0, 0, amount,
           'pending', '直寫帳本', staff_a, 'req-sr' FROM fx;
    RAISE NOTICE 'T3A-ROLE|LEDGER|OK';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T3A-ROLE|LEDGER|% %', SQLSTATE, left(SQLERRM, 60);
  END;
  RESET ROLE;
END
$r$;
ROLLBACK;
SQL
} > "$WORK/role-ledger.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/role-ledger.sql" 2>&1)"
printf '%s\n' "$out" >> "$WORK/steps.log"
r_led="$(printf '%s\n' "$out" | sed -n 's/.*T3A-ROLE|LEDGER|//p' | head -1)"
case "$r_led" in
  42501*) ok "§7.4-37 契約:service_role 直接 INSERT order_refunds 必失敗於 42501(${r_led#42501 })" ;;
  OK)     bad "§7.4-37 契約破了:service_role **寫得進帳本** ⇒ worker 可繞過 complete_refund_job 直接寫帳" ;;
  *)      bad "§7.4-37 契約:期望 42501,實為 [$r_led]" ;;
esac

# ══════════════════════════════════════════════════════════════
# 9. §7.4-6 併發:兩 session 同時重開 gen2
# ══════════════════════════════════════════════════════════════
# 🔴 **在獨立資料庫跑**:併發必須有**已提交**的前代,而 job / items 的 DELETE 與 TRUNCATE
#    被永久擋住 ⇒ 在主庫提交等於留痕、且清不掉。改成 `CREATE DATABASE … TEMPLATE postgres`
#    複製一份、跑完 DROP ⇒ 主庫零接觸。
# 🔴 **barrier 不可省**(memory `feedback_race-test-without-barrier-proves-nothing`):
#    沒有「確實觀察到 B 被擋住」這一步,兩筆很可能是先後跑完的,綠了不代表任何事。
#    本檔的 barrier = 從第三條連線輪詢 `pg_stat_activity`,**看到 B 真的在等鎖**才讓 A commit;
#    沒看到就判 FAIL(不是靜默通過)。
log "9/9 §7.4-6 併發:兩 session 同時重開 gen2(獨立資料庫 + barrier)"
CDB="a7bt_t3a_conc"
CURL="postgresql://postgres@127.0.0.1:${PORT}/${CDB}"
ADMIN="postgresql://postgres@127.0.0.1:${PORT}/template1"

conc_insert() {  # $1=session 標記 $2=bank id
cat <<SQL
BEGIN;
SET LOCAL lock_timeout = '30s';
DO \$c\$
DECLARE v_name text; v_c uuid; v_o uuid; v_amt integer; v_item uuid;
BEGIN
  SELECT j.cancellation_id, j.order_id, j.refund_amount INTO v_c, v_o, v_amt
    FROM public.order_refund_jobs j WHERE j.generation = 1;
  SELECT ji.order_item_id INTO v_item FROM public.order_refund_job_items ji LIMIT 1;
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT gen_random_uuid(), v_c, v_o, 2, j.rec_trade_id, rpad('$2', 20, '0'), j.payload_hash,
         j.refund_amount, j.items_amount, j.shipping_fee_before, j.shipping_fee_after,
         j.shipping_delta, j.reason, j.actor, 'req-$1'
    FROM public.order_refund_jobs j WHERE j.generation = 1;
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT j.id, v_o, v_item, 1, v_amt, v_amt
    FROM public.order_refund_jobs j WHERE j.generation = 2 AND j.request_id = 'req-$1';
  RAISE NOTICE 'T3A-CONC|$1|OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
  RAISE NOTICE 'T3A-CONC|$1|%|%', SQLSTATE, coalesce(nullif(v_name, ''), '(空)');
END
\$c\$;
SQL
}

# run_race <標籤> <期望 B 的結果> <要不要先 DROP U1>
run_race() {
  local label="$1" want_b="$2" drop_u1="$3" tag
  tag="$(printf '%s' "$label" | tr -cd 'a-zA-Z0-9')"
  rm -f "$WORK/a-inserted" "$WORK/go-commit"
  psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
  if ! psql "$ADMIN" -v ON_ERROR_STOP=1 -qtA -c "CREATE DATABASE $CDB TEMPLATE postgres" \
        >"$WORK/conc-create-$tag.log" 2>&1; then
    bad "§7.4-6($label):建立隔離資料庫失敗(見 $WORK/conc-create-$tag.log)⇒ 本條**未執行**,不得算過"
    return
  fi

  # 前代:一路走到 dead → 結案 retry_authorized,**提交**(併發必須有已提交的前代)
  { sql_head; sql_retry_loop; sql_advance '2 days'; sql_e13_auth
    printf 'SET CONSTRAINTS ALL IMMEDIATE;\nCOMMIT;\n'; } > "$WORK/conc-setup.sql"
  if ! psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/conc-setup.sql" >"$WORK/conc-setup-$tag.log" 2>&1; then
    bad "§7.4-6($label):前代 fixture 建立失敗(見 $WORK/conc-setup-$tag.log)⇒ 本條**未執行**"
    psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
    return
  fi
  if [ "$drop_u1" = yes ]; then
    psql "$CURL" -v ON_ERROR_STOP=1 -qtA \
      -c "ALTER TABLE public.order_refund_jobs DROP CONSTRAINT orj_cancellation_generation_key" \
      >/dev/null 2>&1 \
      || { bad "§7.4-6($label):DROP U1 失敗 ⇒ 本條**未執行**"; \
           psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1; return; }
  fi

  { conc_insert A BRFCA
    printf "\\\\! touch %s/a-inserted\n" "$WORK"
    printf "\\\\! bash -c 'for i in \$(seq 1 300); do [ -f %s/go-commit ] && exit 0; sleep 0.1; done; exit 1'\n" "$WORK"
    printf 'COMMIT;\n'
  } > "$WORK/conc-a.sql"
  { conc_insert B BRFCB; printf 'COMMIT;\n'; } > "$WORK/conc-b.sql"

  psql "$CURL" -qtA -f "$WORK/conc-a.sql" > "$WORK/conc-a-$tag.out" 2>&1 &
  local pid_a=$!
  local i
  for i in $(seq 1 100); do [ -f "$WORK/a-inserted" ] && break; sleep 0.1; done
  if [ ! -f "$WORK/a-inserted" ]; then
    bad "§7.4-6($label):session A 的 gen2 INSERT 沒有在 10 秒內完成 ⇒ 本條**未執行**"
    kill "$pid_a" 2>/dev/null; wait "$pid_a" 2>/dev/null
    psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
    return
  fi

  psql "$CURL" -qtA -f "$WORK/conc-b.sql" > "$WORK/conc-b-$tag.out" 2>&1 &
  local pid_b=$!
  # 🔴 barrier:必須**實際觀察到** B 在等鎖才讓 A commit。沒觀察到 = 判 FAIL,不是靜默通過。
  local blocked=no n
  for i in $(seq 1 100); do
    # 🔴 必須認得出「等鎖的就是 B」:只數 datname + wait_event_type 的話,
    #    autovacuum 或任何殘留連線在該庫等鎖都會被算進來(code-reviewer N2)。
    #    B 的 DO 區塊本文含 `req-B` 字面,A 的含 `req-A` ⇒ 用 query 文字精確辨識。
    n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$CDB' AND wait_event_type = 'Lock' AND query LIKE '%req-B%'")"
    [ "$n" = "1" ] && { blocked=yes; break; }
    sleep 0.1
  done
  touch "$WORK/go-commit"
  wait "$pid_a" 2>/dev/null; wait "$pid_b" 2>/dev/null

  [ "$blocked" = yes ] \
    && ok "§7.4-6($label)barrier 成立:實際觀察到 session B 在等鎖(不是先後跑完)" \
    || bad "§7.4-6($label)barrier 不成立:從未觀察到 B 等鎖 ⇒ 這條併發測試證明不了任何事"

  local a_res b_res g2
  a_res="$(sed -n 's/.*T3A-CONC|A|//p' "$WORK/conc-a-$tag.out" | head -1)"
  b_res="$(sed -n 's/.*T3A-CONC|B|//p' "$WORK/conc-b-$tag.out" | head -1)"
  [ "$a_res" = "OK" ] \
    && ok "§7.4-6($label)session A 的 gen2 成功提交" \
    || bad "§7.4-6($label)session A 應成功,實為 [$a_res]"
  [ "$b_res" = "$want_b" ] \
    && ok "§7.4-6($label)session B 紅在 $want_b" \
    || bad "§7.4-6($label)session B 預期 [$want_b],實為 [$b_res]"
  g2="$(psql "$CURL" -qtA -c "SELECT count(*) FROM public.order_refund_jobs WHERE generation = 2")"
  [ "$g2" = "1" ] \
    && ok "§7.4-6($label)gen2 恰一列(不是「不超過一個成功」的模糊斷言)" \
    || bad "§7.4-6($label)gen2 應恰一列,實為 $g2"

  psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
  [ "$(psql "$ADMIN" -qtA -c "SELECT count(*) FROM pg_database WHERE datname = '$CDB'")" = "0" ] \
    && ok "§7.4-6($label)隔離資料庫已刪除(主庫全程零接觸)" \
    || bad "§7.4-6($label)隔離資料庫沒刪掉"
}

# 🔴🔴 **plan §5.1 末段的字面在本片實測下不成立,已就地驗證兩次**:
#    plan 寫「FOR UPDATE 讓後者等待,但後者解鎖後不會重跑 ORDER BY ⇒ 仍以 gen1 為最大世代
#    通過守門,最後紅在 U1 的 23505」,並據此要求「併發負測必須斷言 U1 的 constraint 名」。
#    那段話寫於**關卡2 F2 / Sean Q4=A 把「先鎖 cancellation 列」加進 INSERT 守門之前**。
#    加了那把鎖之後,B 是先擋在 `PERFORM … order_cancellations … FOR UPDATE` 這**一個獨立
#    statement** 上;解鎖後 trigger 內的下一個 statement 在 READ COMMITTED 取得**新快照**
#    ⇒ 看得到 A 剛提交的 gen2 ⇒ 紅在 `a7bt_insert_not_direct_successor`,不是 U1。
#    ⇒ 第二輪把 U1 整條 DROP 掉再跑一次,回答 plan 那句安全論證(「拿掉 U1 會產生第二次退款」)
#      到底還成不成立 —— 這是就地反事實,不是推論。
run_race "U1 在" "P7B01|a7bt_insert_not_direct_successor" no
run_race "U1 已 DROP:plan §5.1 安全論證的反事實" "P7B01|a7bt_insert_not_direct_successor" yes

# ══════════════════════════════════════════════════════════════
# 10. 覆蓋率 / 零留痕 / 結構零漂移
# ══════════════════════════════════════════════════════════════
log "覆蓋率 / 零留痕 / 結構零漂移"

# 🔴 具名 ID 覆蓋率:清單**從 migration 檔即時抽出**,不在本檔另抄一份。
#    差集必須逐一有歸屬(T3b / T4 / 被支配),不得默默少測。
# 🔴 **兩條抽取式缺一不可**(code-reviewer M1 抓到、我親驗成立):
#    `pcm_a7bt_block_write` / `pcm_a7bt_block_truncate` 三支共用一個函式,具名 ID 是**經
#    `TG_ARGV[0]` 從 CREATE TRIGGER 傳進去的**,函式本體裡只有 `CONSTRAINT = TG_ARGV[0]`
#    ⇒ 只抓 `CONSTRAINT = '...'` 會漏掉那 5 個(jobs/items 的 delete/truncate/update 阻擋)。
#    後果不是少報一個數字:**日後再掛一支 `pcm_a7bt_block_write('a7bt_新守門')`,分母看不到它、
#    差集不變、PASS 照樣 0 FAIL** —— 正好是這段自稱要擋掉的那個「靜默截斷」。
ALL_IDS="$( { sed -n "s/.*CONSTRAINT = '\(a7bt_[a-z0-9_]*\)'.*/\1/p" "$MIG"
              grep -oE "pcm_a7bt_block_(write|truncate)\('a7bt_[a-z0-9_]*'\)" "$MIG" \
                | sed -E "s/.*'(a7bt_[a-z0-9_]*)'.*/\1/"
            } | grep -v '^a7bt_selftest_marker$' | sort -u)"
COVERED="$(printf '%s\n' $SEEN_IDS | grep '^a7bt_' | sort -u)"
MISSING="$(comm -23 <(printf '%s\n' "$ALL_IDS") <(printf '%s\n' "$COVERED"))"
n_all="$(printf '%s\n' "$ALL_IDS" | grep -c .)"
n_cov="$(printf '%s\n' "$COVERED" | grep -c .)"
# 🔴 `$COVERED` 必須是 `$ALL_IDS` 的子集,否則「N 個裡覆蓋 M 個」這句話是假的
#    (M2:抽取式漏 5 個的時候,78 裡有 5 個不在 92 裡 ⇒ 78+19≠92,三個數字互相矛盾)。
EXTRA="$(comm -13 <(printf '%s\n' "$ALL_IDS") <(printf '%s\n' "$COVERED"))"
if [ -n "$EXTRA" ]; then
  bad "覆蓋率分母不完整:本片紅在下列 ID,但它們不在從 migration 檔抽出的清單裡 ⇒ 抽取式漏抓"
  printf '%s\n' "$EXTRA" | sed 's/^/      · /'
fi
printf '  ── T1 具名守門 ID:%s 個;本片實跑紅在其中 %s 個 ──\n' "$n_all" "$n_cov"

# 🔴🔴 **差集必須逐一有歸屬,而且是機器守著的**(機制優先律):
#    只印不判的話,哪天 T1 新增一支守門而沒有人替它寫負測,清單默默多一行、PASS 照樣 0 FAIL
#    = 「靜默截斷」。這裡改成**集合相等**斷言:差集與下面這份逐條列名的清單不符就轉紅。
#    三種歸屬(與 plan §7.2 矩陣逐字對應):
#      ① T2 已關閉 —— 六道「等待型閘門」的注入承重證明(`a7bt-verify.sh` 第 6 段)
#      ② T3b —— 錢面(D9 / job↔ledger / 跨表 bank id)
#      ③ 被支配 —— 行為上構造不出來,逐條理由在 plan §7.2;由 T4 的突變證明它不是死碼
EXPECTED_MISSING="$(cat <<'IDS'
a7bt_e11_lease_not_expired
a7bt_e13_checked_at_in_future
a7bt_e14_checked_at_in_future
a7bt_e1_attempted_must_be_null
a7bt_e1_not_due_yet
a7bt_e2_attempted_must_be_null
a7bt_e2_d9c_baseline_mismatch
a7bt_e2_no_predecessor_for_d9c
a7bt_e2b_last_call_not_monotonic
a7bt_e3_lease_not_expired
a7bt_e3b_lease_not_expired
a7bt_e6_retry_count_changed
a7bt_e8_not_due_yet
a7bt_insert_bank_id_crosstable_reuse
a7bt_ledger_column_mismatch
a7bt_ledger_item_set_differs
a7bt_ledger_missing
a7bt_ledger_not_confirmed
a7bt_successor_no_predecessor
IDS
)"
if [ "$MISSING" = "$EXPECTED_MISSING" ]; then
  ok "具名 ID 覆蓋率:$n_all 個守門、行為覆蓋 $n_cov 個、未覆蓋 $(printf '%s\n' "$MISSING" | grep -c .) 個**逐一有歸屬**(T2 已關 5 / T3b 9 / 被支配 5),集合相等"
else
  bad "具名 ID 覆蓋率:差集與 plan §7.2 登記的歸屬不符 ⇒ 有守門沒人測,或有登記已過時"
  printf '  實際差集:\n';   printf '%s\n' "$MISSING" | sed 's/^/      · /'
  printf '  登記差集:\n';   printf '%s\n' "$EXPECTED_MISSING" | sed 's/^/      · /'
fi

for t in order_refund_jobs order_refund_job_items order_cancellations \
         order_cancellation_items order_refunds order_refund_items; do
  [ "$(runsql "SELECT count(*) FROM public.$t")" = "0" ] \
    && ok "零留痕:$t 仍為 0 列" || bad "零留痕失敗:$t 不是 0 列"
done

snapshot "$STRUCT_SQL" "$WORK/struct-after.snap" "跑完全部負測後結構快照"
cmp -s "$WORK/struct-before.snap" "$WORK/struct-after.snap" \
  && ok "結構零漂移:跑完全部負測(含 ADD COLUMN 與 replica 模式探針)後 catalog 一個 byte 都沒變" \
  || bad "結構漂移:跑完之後 catalog 被動到了"

printf '  §7.2 一對一矩陣(實跑產生,可直接貼進 plan):%s\n' "$WORK/matrix.tsv"
printf '  負測案例 %d 條  PASS=%d  FAIL=%d\n' "$CASE_N" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
