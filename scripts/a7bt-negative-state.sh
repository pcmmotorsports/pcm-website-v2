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
#   留給 T4:突變 harness、ACL 64 格、barrier lock probe、rollback 八步隔離庫實跑
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

case_green "合法的第二張取消單 + 明細(deferred 全部當場檢查通過)" p_fx2_completed <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFC2', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '對照組', staff_a, 'req-ctl' FROM fx;
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
         rec_trade, rpad('BRFCTL2', 20, '0'), repeat('b', 64),
         amount + ship_before, amount, ship_before, 0, -ship_before,
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
         rec_trade, rpad('BRFN1', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '假完成單', staff_a, 'req-n1', 'completed' FROM fx;
SQL

case_red "INSERT 帶既往狀態(reviewed_at 非 NULL)" \
         "a7bt_insert_history_must_be_null" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id, reviewed_at)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFN2', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '帶既往狀態', staff_a, 'req-n2', now() FROM fx;
SQL

case_red "INSERT 計數器非起始值(retry_count=3)" \
         "a7bt_insert_counters_must_be_initial" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id, retry_count)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFN3', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '計數器非零', staff_a, 'req-n3', 3 FROM fx;
SQL

sql_gen2_variant() {  # $1=bank id 尾碼 $2=reason $3=generation
cat <<SQL
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, ${3:-2},
         rec_trade, rpad('${1:?}', 20, '0'), repeat('b', 64),
         amount + ship_before, amount, ship_before, 0, -ship_before,
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
         rec_trade, rpad('BRFG3', 20, '0'), repeat('b', 64),
         amount + ship_before, amount, ship_before, 0, -ship_before,
         '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t3a-g3' FROM fx;
SQL

case_red "跳號:只有 gen1 已授權卻直接開 gen3" \
         "a7bt_insert_not_direct_successor" p_dead_auth <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job2_id, cancellation_id, order_id, 3,
         rec_trade, rpad('BRFG3B', 20, '0'), repeat('b', 64),
         amount + ship_before, amount, ship_before, 0, -ship_before,
         '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t3a-g3b' FROM fx;
SQL

case_red "§7.4-7 該取消一列 job 都沒有卻開 gen2(NOT FOUND fail-closed)" \
         "a7bt_insert_no_predecessor" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id, 2,
         rec_trade, rpad('BRFN7', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '無前代', staff_a, 'req-n7' FROM fx;
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
  -- 🔴 先讓這張取消單也取消 order_item2 —— 否則 C5(明細品項必須真的被取消)會**先**紅,
  --    這條就變成在測 C5 而不是在測「後代 item set 必須等於前代」。
  --    取消兩個品項、只退其中一個 = 合法形狀(退少不違反任何不變式)。
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT cancellation_id, order_id, order_item2_id, qty FROM fx;
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
         rec_trade, rpad('BRFC3', 20, '0'), repeat('c', 64),
         ${1:-amount}, ${1:-amount}, ship_before, ship_before, 0, '子表負測', staff_a, 'req-c3' FROM fx;
SQL
}

case_red "§7.4-17 C1:有 header、零明細" "a7bt_c1_job_has_no_items" p_fx2_completed <<SQL
$(sql_job3_header)
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C2:Σ line_amount ≠ items_amount" \
         "a7bt_c2_items_amount_mismatch" p_fx2_completed <<SQL
$(sql_job3_header 'amount + 1')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# 🔴 C5 / C6 = 關卡2 #24 的錢面漏洞(Sean 07-31 拍板「檢查放資料庫」)。
#    修正前的實測攻擊:cancellation2 只取消 order_item2 一件,job3 卻列 2 件(或列別的品項),
#    C1-C4 全過、帳本配得平、一路走到 completed ⇒ 退的錢超過取消的錢。
case_red "§7.4-17 C5:退款明細的品項不在該取消單的取消明細內" \
         "a7bt_c5_item_not_cancelled" p_fx2_completed <<SQL
  -- 🔴 **構造上的兩難,寫下來免得下一個人又踩**:前面那筆 completed 工單已經退掉
  --    order_item 1 件,而該品項客人只買 1 件 ⇒ 任何再退它一次的工單都會**先紅在 C7**
  --    (實測過)。⇒ 本案例改用 order_item2 當「被退的品項」,並把 cancellation2 的
  --    取消明細換成 order_item ⇒ 「退的品項不在自己那張取消單裡」成立,
  --    而兩個品項的累計退款都仍在下單量之內 ⇒ **只有 C5 會紅**。
  UPDATE public.order_cancellation_items
     SET order_item_id = (SELECT order_item_id FROM fx)
   WHERE cancellation_id = (SELECT cancellation2_id FROM fx);
$(sql_job3_header)
  -- cancellation2 現在只取消了 order_item;這裡卻拿 order_item2 來退。
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C6:退款件數超過該取消單的取消件數" \
         "a7bt_c6_quantity_exceeds_cancelled" p_fx2_completed <<SQL
$(sql_job3_header 'amount * 2')
  -- cancellation2 對 order_item2 只取消 1 件,這裡退 2 件。
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, 2, unit_price, amount * 2 FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# 🔴 C3 的負測必須先把取消量放寬到 5 —— 否則 C6(排在 C3 前面、且更緊)會先紅,
#    這條就變成「測到別條規則」的假綠。`cancelled_quantity` 依 `20260730130000:215-219` 無上限,
#    所以「取消 5 件、原單只有 1 件」是一個資料庫允許存在的合法形狀 ⇒ C3 仍可獨立到達。
case_red "§7.4-17 C3:退的數量超過原品項" \
         "a7bt_c3_quantity_exceeds_order_item" p_fx2_completed <<SQL
  UPDATE public.order_cancellation_items SET cancelled_quantity = 5
   WHERE cancellation_id = (SELECT cancellation2_id FROM fx);
$(sql_job3_header 'amount * 2')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, 2, unit_price, amount * 2 FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17 C4:單價不等於訂單快照" \
         "a7bt_c4_unit_price_mismatch" p_fx2_completed <<SQL
$(sql_job3_header 'amount + 1')
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price + 1, amount + 1 FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# ══ 🔴🔴 四條錢面守門(2026-07-31 關卡2 R2;Sean 拍 A「四條全關」)══════════════
#    這四條都是「守門不存在時,錢會出錯」而不是「狀態機走錯路」——
#    但它們的落點在 INSERT 守門與主從一致 trigger,與 T3a 同一組外殼,故留在本檔。

case_red "§7.4-17b C7:同一品項跨取消單的累計退款件數超過客人下單件數" \
         "a7bt_c7_cumulative_exceeds_cancelled" p_fx2_completed <<SQL
  -- 前一筆 completed 工單已退掉 order_item 1 件(cancellation1 取消 1 件)。
  -- 讓 cancellation2 也取消**同一個品項** 1 件、再退 1 件:
  --   C5 過(該品項在 cancellation2 的明細裡)、C6 過(1 <= 1)、
  --   「累計退款 <= 累計取消」也過(2 <= 2)—— 這正是我第一版寫錯的上界。
  -- 但客人只買了 1 件 ⇒ 累計退 2 件 > 下單 1 件 ⇒ **只有 C7 抓得到**。
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT cancellation2_id, order_id, order_item_id, qty FROM fx;
$(sql_job3_header)
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17c C8:跨取消單累計退掉的運費超過訂單實付運費(同一筆運費退兩次)" \
         "a7bt_c8_cumulative_shipping_exceeds_order" p_fx2_completed <<SQL
  -- 🔴🔴 **Fable R3 F1 的實測形狀**:第一筆 completed 工單已經把運費 137 整筆退掉
  --    (fixture 的 job1 = before 137 / after 0 / delta -137)。
  --    3.2c **強制**第二張取消單的工單再宣告一次 `shipping_fee_before = 137`
  --    —— 那個欄位不會因為退過款而遞減 ⇒ 它可以「合法地」再退一次運費。
  -- 🔴 這裡只多退**一元**(after = 136、delta = -1):
  --    ① 累計 138 > 137 ⇒ 只可能紅在 C8;
  --    ② 上界若少算一元或比較子寫成 >=,對照組(第 2 段那條 delta = 0 的合法第二張取消單,
  --       累計恰好 = 137)會轉紅 ⇒ 邊界的兩側都被釘住。
  -- 🔴 件數那一軸刻意全部合法:退的是 order_item2(cancellation2 取消的就是它)、1 件、
  --    客人買了 1 件 ⇒ C5/C6/C3/C4/C7 逐條都過 ⇒ 這條負測不會被別條蓋掉。
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFC8', 20, '0'), repeat('c', 64),
         amount + 1, amount, ship_before, ship_before - 1, -1,
         '運費跨取消單累計負測', staff_a, 'req-c8' FROM fx;
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT job3_id, order_id, order_item2_id, qty, unit_price, amount FROM fx;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17b 反向 trigger:工單建立後刪掉取消明細,必須當場被抓" \
         "a7bt_c5_item_not_cancelled" p_none <<'SQL'
  -- 🔴 沒有掛在 order_cancellation_items 上的第 11 支 trigger,這一格會**完全沒有反應**:
  --    工單那一側沒有任何列被改動 ⇒ C5/C6/C7 一次都不會排隊。
  -- 🔴 先補一列別的品項:A7-t 的 presence trigger 要求取消單至少一列明細,
  --    整張刪光會先紅在它(且 CONSTRAINT_NAME 為空)⇒ 測不到本片的東西。
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT cancellation_id, order_id, order_item2_id, qty FROM fx;
  DELETE FROM public.order_cancellation_items
   WHERE cancellation_id = (SELECT cancellation_id FROM fx)
     AND order_item_id   = (SELECT order_item_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17b 反向 trigger:工單建立後把取消明細改掛別的品項,必須當場被抓" \
         "a7bt_c5_item_not_cancelled" p_none <<'SQL'
  -- 只擋 DELETE 不夠:把 5 改成 1 一樣繞過。先放寬再調小,證明 UPDATE 分支也承重。
  -- 🔴 不要另外去 UPDATE 退款明細來「觸發重驗」—— 那會先紅在 a7bt_items_update_blocked
  --    (實測過)。第 11 支 trigger 的重點正是:**只動取消明細**就要重驗。
  --    先把工單的退款件數合法地墊高到 3(取消量同步放寬),再把取消量調回 1。
  -- 🔴 「調小 cancelled_quantity」在現有種子資料上**構造不出違反**：
  --    工單只退 1 件，而 cancelled_quantity 的 CHECK 是 > 0 ⇒ 最小只能到 1，1 <= 1 永遠合法。
  --    硬寫一條「調 3 再調回 1」的案例會**恆綠**（實測過，那就是假的覆蓋）。
  --    ⇒ 改用同樣走 UPDATE 分支、但真的會違反的形狀：**把取消明細換成另一個品項**
  --      ⇒ 工單退的那個品項從此不在取消明細裡 ⇒ C5。
  UPDATE public.order_cancellation_items
     SET order_item_id = (SELECT order_item2_id FROM fx)
   WHERE cancellation_id = (SELECT cancellation_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_red "§7.4-17b rec_trade_id 不是這張訂單自己的交易(退到別人的卡)" \
         "a7bt_insert_rec_trade_not_order_own" p_fx2_completed <<'SQL'
  -- 🔴 只動 rec_trade_id 一格:其餘全部照 fx 的合法值,確保紅在指定的那一條。
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rpad('RECOTHERORDER', 20, '0'), rpad('BRFOTHER', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0,
         '交易編號綁訂單負測', staff_a, 'req-rec' FROM fx;
SQL

case_red "§7.4-17b shipping_fee_before 不等於訂單當下的運費(運費快照憑空捏造)" \
         "a7bt_insert_shipping_before_not_order_own" p_fx2_completed <<SQL
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFSHIP', 20, '0'), repeat('c', 64),
         amount, amount, ship_before + 100000, ship_before, -100000,
         '運費快照負測', staff_a, 'req-ship' FROM fx;
SQL

case_red "§7.4-17c 3.2d:訂單的 payment_status 表示錢從未全額收進來(未付款也開得出退款工單)" \
         "a7bt_insert_order_payment_not_captured" p_fx2_completed <<'SQL'
  -- 🔴 Fable R3 F3:修法前這一格會**成功** —— 整片 T 一次都沒讀過 payment_status,
  --    擋住它的只是「只有 confirm_order_payment 會寫 rec_trade_id」這個跨 migration 的推論。
  -- 🔴 只把 payment_status 改回種子原本的 `unpaid`(fixture 注入前就是這個值),
  --    rec_trade / 運費 / 件數全部維持合法 ⇒ 只可能紅在 3.2d。
  UPDATE public.orders SET payment_status = 'unpaid'
   WHERE id = (SELECT order_id FROM fx);
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFPAY', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0,
         '未付款訂單負測', staff_a, 'req-pay' FROM fx;
SQL

# ── 隔離級 fail-closed(Fable R3 F11):**不能用 case_red 的外殼** ──────────────
# 🔴 `SET TRANSACTION ISOLATION LEVEL` 必須是交易的第一個動作,而 case_red 的外殼是
#    「sql_head 造 fixture → 才輪到壞資料那一步」⇒ 實測回 **25001**、CONSTRAINT_NAME 為空
#    (那正是「紅了但不是紅在要測的地方」)。⇒ 本條自己開一個 `BEGIN ISOLATION LEVEL …`,
#    再把 sql_head 疊上去(它的 `BEGIN;` 在已開交易裡只是 WARNING)。
# 🔴 判定仍走 expect_red(斷言 CONSTRAINT_NAME + SQLSTATE),只是不進 CASE_N 與 §7.2 矩陣
#    —— 它不是「一筆壞資料」,是「執行環境的前提不成立」。
{ printf 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
  sql_head
  red_wrap_head
  cat <<'SQL'
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL
  red_wrap_tail; } > "$WORK/neg-isolation.sql"
expect_red "$WORK/neg-isolation.sql" "a7bt_isolation_not_read_committed" \
  "隔離級 fail-closed:REPEATABLE READ 下主從一致函式必須拒跑(advisory 鎖的序列化論證前提)" "P7B01"
# 🔴 `SEEN_IDS` 只有 case_red 會寫;這條走自訂外殼 ⇒ 手動補登,而且**只在真的紅對時才補**
#    (`LAST_RED_OK` 由 expect_red 設定)⇒ 覆蓋率仍然是「紅對了」而不是「有跑過」。
[ "$LAST_RED_OK" = yes ] && SEEN_IDS="$SEEN_IDS a7bt_isolation_not_read_committed"

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
         rec_trade, rpad('BRFU1', 20, '0'), repeat('b', 64),
         amount, amount, ship_before, ship_before, 0, '同世代重複建', staff_a, 'req-u1' FROM fx;
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
         rec_trade, rpad('BRFU2', 20, '0'), repeat('b', 64),
         amount, amount, ship_before, ship_before, 0, '第二個未結案', staff_a, 'req-u2' FROM fx;
SQL

case_red "§7.4-20 U3:另一張取消單重用同一筆 TapPay 交易(rec_trade_id)" \
         "orj_one_current_per_rec_trade_idx" p_fx2 <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFU3', 20, '0'), repeat('c', 64),
         amount, amount, ship_before, ship_before, 0, '同一筆交易兩個 job', staff_a, 'req-u3' FROM fx;
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
       rec_trade, rpad('BRFU5', 20, '0'), repeat('c', 64),
       amount, amount, ship_before, ship_before, 0, 'U5 第二個 job', staff_a, 'req-u5' FROM fx;
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
DECLARE v_name text; v_c uuid; v_o uuid;
BEGIN
  SELECT j.cancellation_id, j.order_id INTO v_c, v_o
    FROM public.order_refund_jobs j WHERE j.generation = 1;
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT gen_random_uuid(), v_c, v_o, 2, j.rec_trade_id, rpad('$2', 20, '0'), j.payload_hash,
         j.refund_amount, j.items_amount, j.shipping_fee_before, j.shipping_fee_after,
         j.shipping_delta, j.reason, j.actor, 'req-$1'
    FROM public.order_refund_jobs j WHERE j.generation = 1;
  -- 🔴 明細**逐列複製前代**,不要自己拼數字:原版用 `refund_amount` 當 unit_price,
  --    那只在「運費 delta = 0 ⇒ refund_amount = items_amount」時碰巧成立
  --    (2026-08-01 fixture 改跑非零運費後當場紅在 C2)。後代 item set 本來就必須逐列等於前代。
  INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT j2.id, ji.order_id, ji.order_item_id, ji.quantity, ji.unit_price, ji.line_amount
    FROM public.order_refund_jobs j2
    JOIN public.order_refund_jobs j1 ON j1.generation = 1
    JOIN public.order_refund_job_items ji ON ji.job_id = j1.id
   WHERE j2.generation = 2 AND j2.request_id = 'req-$1';
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
# 9b. E14(更正結案)↔ gen2 INSERT 的競速(codex 關卡2 R2 的 must-fix,交接檔 §5-1)
# ══════════════════════════════════════════════════════════════
# 🔴🔴 **上面那兩輪只測了「兩筆 gen2 併發」一個形狀**。E14 那把
#    `PERFORM 1 FROM order_cancellations … FOR UPDATE`(`:986`)存在的理由是**另一個**形狀:
#    A 正在開 gen2、B 同時把授權更正掉 ⇒ 沒有那把鎖時 B 的 `EXISTS(後繼)` 查的是舊快照
#    ⇒ 看不到 A 的 gen2 ⇒ E14 放行 ⇒ 留下「下一張卡已開出去、授權卻被撤銷」的孤兒。
#    交接檔逐字:「拿掉或放錯位置,現有順序測試與具名突變**都會全綠**」——
#    因為突變只會把 `a7bt_e14_successor_exists` 那句 RAISE 換掉,**碰不到那把鎖**。
# 🔴 ⇒ 本段跑兩輪:①鎖在 ⇒ B 必須紅在 `a7bt_e14_successor_exists`;
#    ②把那一行**就地拿掉** ⇒ B 必須**成功**(= 孤兒真的產生)。
#    第二輪是這條測試唯一的承重證明:沒有它,第一輪的紅可能只是「反正 B 後跑」。
log "9b/9 E14 ↔ gen2 併發(那把 cancellation 列鎖的專屬形狀;含拿掉鎖的反事實)"

E14_LOCK_LINE='PERFORM 1 FROM public.order_cancellations WHERE id = OLD.cancellation_id FOR UPDATE;'
# INSERT 側「鎖住該取消的最大世代列」那一句的結尾(`:377-382`)。拿掉 `FOR UPDATE` 就等於
# A 不再鎖 gen1 那一列 —— 這是分辨「B 看得到 gen2 是誰的功勞」唯一的辦法。
INS_LOCK_FRAG='     LIMIT 1
       FOR UPDATE;'
INS_LOCK_REPL='     LIMIT 1;'

# mutate_fn <函式名> <被取代字串> <取代成> ; 回傳非 0 = 沒套上(呼叫端必須當場判 FAIL)
# 🔴 **突變一定要證明自己套上了**(#306 的教訓:sed 樣式失配 ⇒ 突變沒套上卻被讀成「守門沒承重」)。
# 🔴 **psql 變數在 dollar-quoted 區塊裡不會被展開**(本 repo 已在 `scripts/a7bt-rollback.sql:30`
#    逐字記錄過同一個坑)⇒ 這裡只能走 shell 展開的 heredoc,`$m$` 要跳脫成 `\$m\$`。
#    首版寫成 `-v frm=…` + `:'frm'`,實測「突變沒套上」——**那個失敗是被上面那道
#    md5 前後比對抓到的**,不是靠我看出來的;沒有那道比對,它會變成「拿掉鎖也全綠」的假結論。
mutate_fn() {
  local fn="$1" from="$2" to="$3" before after
  before="$(psql "$CURL" -qtA -c "SELECT md5(prosrc) FROM pg_proc WHERE proname='$fn'")"
  psql "$CURL" -v ON_ERROR_STOP=1 -qtA >>"$WORK/e14-mutate.log" 2>&1 <<SQL
DO \$m\$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '$fn';
  IF position('$from' in v_src) = 0 THEN
    RAISE EXCEPTION '突變樣式失配:$fn 的本體裡找不到要拿掉的那一段';
  END IF;
  v_src := replace(v_src, '$from', '$to');
  EXECUTE format('CREATE OR REPLACE FUNCTION public.$fn() RETURNS trigger '
                 'LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS %L', v_src);
END
\$m\$;
SQL
  after="$(psql "$CURL" -qtA -c "SELECT md5(prosrc) FROM pg_proc WHERE proname='$fn'")"
  [ -n "$after" ] && [ "$before" != "$after" ] || return 1
  ok "§7.4-6b 反事實已套上:$fn 的本體指紋改變(${before:0:8}… → ${after:0:8}…)"
  return 0
}

run_race_e14() {  # $1=標籤 $2=期望 B 結果 $3=拿掉哪些鎖:no|e14|both
  local label="$1" want_b="$2" drop_lock="$3" tag
  tag="$(printf '%s' "$label" | tr -cd 'a-zA-Z0-9')"
  rm -f "$WORK/a-inserted" "$WORK/go-commit"
  psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
  if ! psql "$ADMIN" -v ON_ERROR_STOP=1 -qtA -c "CREATE DATABASE $CDB TEMPLATE postgres" \
        >"$WORK/e14-create-$tag.log" 2>&1; then
    bad "§7.4-6b($label):建立隔離資料庫失敗 ⇒ 本條**未執行**,不得算過"; return
  fi
  { sql_head; sql_retry_loop; sql_advance '2 days'; sql_e13_auth
    printf 'SET CONSTRAINTS ALL IMMEDIATE;\nCOMMIT;\n'; } > "$WORK/e14-setup.sql"
  if ! psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/e14-setup.sql" >"$WORK/e14-setup-$tag.log" 2>&1; then
    bad "§7.4-6b($label):前代 fixture 建立失敗(見 $WORK/e14-setup-$tag.log)⇒ 本條**未執行**"
    psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1; return
  fi

  if [ "$drop_lock" != no ]; then
    if ! mutate_fn pcm_a7bt_jobs_before_update "$E14_LOCK_LINE" 'PERFORM 1;'; then
      bad "§7.4-6b($label):拿掉 E14 那把鎖的反事實**沒有套上** ⇒ 下面的結果證明不了任何事"
      psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1; return
    fi
  fi
  if [ "$drop_lock" = both ]; then
    if ! mutate_fn pcm_a7bt_jobs_before_insert "$INS_LOCK_FRAG" "$INS_LOCK_REPL"; then
      bad "§7.4-6b($label):拿掉 INSERT 側「鎖最大世代列」的反事實**沒有套上** ⇒ 結果證明不了任何事"
      psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1; return
    fi
  fi

  # session A:開 gen2,停在 COMMIT 之前
  { conc_insert A BRFE14A
    printf "\\\\! touch %s/a-inserted\n" "$WORK"
    printf "\\\\! bash -c 'for i in \$(seq 1 300); do [ -f %s/go-commit ] && exit 0; sleep 0.1; done; exit 1'\n" "$WORK"
    printf 'COMMIT;\n'
  } > "$WORK/e14-a.sql"

  # session B:E14 把 gen1 的授權**撤銷**掉(retry_authorized → external_refund_confirmed)
  # 🔴 D9a 要求「非 retry_authorized ⇒ 證據兩欄必須為 NULL」⇒ 同一句一起清掉,
  #    否則會先紅在 `orj_retry_auth_evidence_required` 而測不到後繼檢查。
  # 🔴 `corrected_by` 必須不同於原結案人(orj_correction_two_person)⇒ 用 staff_b。
  { printf 'BEGIN;\nSET LOCAL lock_timeout = %s;\n' "'30s'"
    cat <<'SQL'
DO $c$
DECLARE v_name text;
BEGIN
  UPDATE public.order_refund_jobs
     SET resolution = 'external_refund_confirmed',
         retry_auth_recorded_refunded = NULL,
         retry_auth_checked_at = NULL,
         corrected_at = now(), corrected_by = 'staff_1',
         correction_reason = 'e14-race:撤銷授權(E14 與 gen2 併發)'
   WHERE generation = 1;
  RAISE NOTICE 'T3A-E14|B|OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
  RAISE NOTICE 'T3A-E14|B|%|%', SQLSTATE, coalesce(nullif(v_name, ''), '(空)');
END
$c$;
COMMIT;
SQL
  } > "$WORK/e14-b.sql"

  psql "$CURL" -qtA -f "$WORK/e14-a.sql" > "$WORK/e14-a-$tag.out" 2>&1 &
  local pid_a=$! i n blocked=no
  for i in $(seq 1 100); do [ -f "$WORK/a-inserted" ] && break; sleep 0.1; done
  if [ ! -f "$WORK/a-inserted" ]; then
    bad "§7.4-6b($label):session A 的 gen2 INSERT 沒有在 10 秒內完成 ⇒ 本條**未執行**"
    kill "$pid_a" 2>/dev/null; wait "$pid_a" 2>/dev/null
    psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1; return
  fi
  psql "$CURL" -qtA -f "$WORK/e14-b.sql" > "$WORK/e14-b-$tag.out" 2>&1 &
  local pid_b=$!
  for i in $(seq 1 100); do
    n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$CDB' AND wait_event_type = 'Lock' AND query LIKE '%e14-race%'")"
    [ "$n" = "1" ] && { blocked=yes; break; }
    sleep 0.1
  done
  touch "$WORK/go-commit"
  wait "$pid_a" 2>/dev/null; wait "$pid_b" 2>/dev/null

  # 🔴 barrier 的期望值隨反事實而變:只有「兩把鎖都拿掉」時 B 才不該被擋住
  #    —— 拿掉 E14 那一把之後,B 仍會被 **A 對 gen1 那一列的列鎖**擋住(實測,見下方結論)。
  local b_res orphan want_blocked
  b_res="$(sed -n 's/.*T3A-E14|B|//p' "$WORK/e14-b-$tag.out" | head -1)"
  case "$drop_lock" in both) want_blocked=no ;; *) want_blocked=yes ;; esac
  [ "$blocked" = "$want_blocked" ] \
    && ok "§7.4-6b($label)barrier 觀察到的阻塞狀態 = $want_blocked(與這一輪的前提相符)" \
    || bad "§7.4-6b($label)barrier 期望阻塞=$want_blocked,實測=$blocked ⇒ 擋住 B 的不是這一輪以為的那個東西"
  [ "$b_res" = "$want_b" ] \
    && ok "§7.4-6b($label)session B 結果 = $want_b" \
    || bad "§7.4-6b($label)session B 預期 [$want_b],實為 [$b_res]"

  # 孤兒的直接定義:gen2 已存在,而 gen1 的 resolution 已不是 retry_authorized
  orphan="$(psql "$CURL" -qtA -c "SELECT (SELECT count(*) FROM public.order_refund_jobs WHERE generation=2) || '/' || (SELECT resolution FROM public.order_refund_jobs WHERE generation=1)")"
  if [ "$drop_lock" = both ]; then
    [ "$orphan" = "1/external_refund_confirmed" ] \
      && ok "🔴 §7.4-6b($label)**孤兒真的產生了**(gen2 已開出、gen1 授權已被撤銷:$orphan)⇒ 這條競速確實有東西擋著,不是「本來就不會發生」" \
      || bad "§7.4-6b($label)兩把鎖都拿掉後預期產生孤兒 1/external_refund_confirmed,實為 $orphan"
  else
    [ "$orphan" = "1/retry_authorized" ] \
      && ok "§7.4-6b($label)零孤兒:gen2 恰一列且 gen1 的授權原封不動($orphan)" \
      || bad "§7.4-6b($label)預期 1/retry_authorized,實為 $orphan"
  fi

  psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
  [ "$(psql "$ADMIN" -qtA -c "SELECT count(*) FROM pg_database WHERE datname = '$CDB'")" = "0" ] \
    && ok "§7.4-6b($label)隔離資料庫已刪除(主庫全程零接觸)" \
    || bad "§7.4-6b($label)隔離資料庫沒刪掉"
}

run_race_e14 "兩把鎖都在" "P7B01|a7bt_e14_successor_exists" no
run_race_e14 "只拿掉 E14 那把 cancellation 列鎖" "P7B01|a7bt_e14_successor_exists" e14
run_race_e14 "兩把鎖都拿掉" "OK" both

# 🔴🔴 **三輪跑出來的結論(寫在這裡,因為它推翻了 migration `:352-359` 的原註解)**:
#    ① 兩把都在 ⇒ B 紅在 a7bt_e14_successor_exists、零孤兒。
#    ② **只拿掉 E14 那把 cancellation 列鎖 ⇒ 結果完全一樣**(仍被擋、仍紅在同一條、仍零孤兒)。
#    ③ 兩把都拿掉 ⇒ B 成功、**孤兒真的產生**。
#    ⇒ 在這個競速形狀裡,真正承重的是 **INSERT 側「鎖住該取消的最大世代列」的 FOR UPDATE**
#      —— 它鎖的正是 gen1 那一列,而 B 的 E14 UPDATE 目標也是 gen1
#      ⇒ B 在 UPDATE 取列鎖時就被擋住,解鎖後 trigger 內的查詢是新 statement、
#        READ COMMITTED 下取得新快照 ⇒ 看得到 A 剛提交的 gen2。
#    ⇒ migration `:352-359` 那段「必須搶同一把、且與被查的列無關的鎖」的論證,
#      在**這個**形狀下不是它擋住的。E14 那把鎖不是死碼(它仍是 break-glass 與其他形狀的一層),
#      但**不得再被記成這條競速的防護**。已同步更正 migration 的註解。
# ⚠️ **未測、且已登記為新發現**:E14 路徑的取鎖順序其實與 INSERT 路徑**相反**
#    (UPDATE 自己先鎖 order_refund_jobs 那一列,trigger 才去鎖 order_cancellations;
#     INSERT 則是先 cancellations 後 jobs)⇒ 理論上存在互鎖窗。
#    後果是 PostgreSQL 偵測到並中止其中一方(**錯誤訊息,不是錢的錯誤**)⇒ 不擋本片,
#    但要在第 3 批 worker 片之前決定要不要把 E14 也改成「先鎖 cancellations」。

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

[ "$MODE" = "all" ] && count_gate 120 164 || count_gate 120 163

printf '  §7.2 一對一矩陣(實跑產生,可直接貼進 plan):%s\n' "$WORK/matrix.tsv"
printf '  負測案例 %d 條  PASS=%d  FAIL=%d\n' "$CASE_N" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
