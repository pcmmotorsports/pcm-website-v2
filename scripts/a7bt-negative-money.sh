#!/usr/bin/env bash
# ============================================================
# A7b-T · T3b「錢面負測」可重現驗證 harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7.2 / §7.3 / §7.4
# 用法:scripts/a7bt-negative-money.sh all /tmp/a7bt3b   (從零 provision,最完整)
#      scripts/a7bt-negative-money.sh run /tmp/a7bt3b   (重用既有拋棄式 cluster)
#
# ── 範圍(plan §7.2.0 片界表登記的 T3b 那一列)────────────────────────────
#   §7.4-8  跨表 bank id(`order_refunds` 已有的 bank_refund_id 不得再開新 job)
#   §7.4-16 job↔ledger 十一欄 + item set + **NULL-safe 專測**
#   §7.4-22 dormant gate(T1 之後的處置,見第 7 段)
#   §7.4-25 D7(已受理的死因不得結成「授權重試」)
#   §7.4-27 D9 全套(證據成對/必填、隔日閘、fail-closed、未來時間、D9d、D9c)
#   §7.4-34 時區兩跑(UTC 與 Asia/Taipei 各跑一次,結果必須相同)
#
#   T3a(狀態機面)已完成 = `scripts/a7bt-negative-state.sh`;T4 = 突變 / ACL 64 格 /
#   barrier lock probe / rollback 八步。**三片相加涵蓋 §7.4 全部 37 條**(§7.2.0)。
#
# ── 🔴 這支腳本**不**證明什麼(誠實邊界)───────────────────────────────
#   · 不證明守門「涵蓋所有錢面壞資料」—— 只證明列出來的那些各自紅在指定 ID。
#   · **全綠不代表守門有承重**(拿掉它會不會轉綠 = 突變,歸 T4)。
#   · D9 的根本邊界不變(plan §3.5):它讀的兩邊都來自 Record API ⇒ **共模失效**;
#     Record 自己回錯,D9c 與 D9d 會一起錯、兩條 CHECK 全綠。本檔測不到那件事。
#   · **零 TapPay 接觸**:「隔日生效」在本檔只是 CHECK 的日曆比較,不是外部行為。
#   · 本機 PG17.10 非 Supabase;C locale ≠ 正式站 `en_US.UTF-8`。
#   · **整份 harness 只以 owner 身分跑**(那是 SECURITY DEFINER RPC 內部的身分)⇒
#     `pcm_a7bt_assert_job_ledger_equal` 是 SECURITY INVOKER,它對 `order_refunds` 的
#     `NOT FOUND` 在 RLS 遮蔽下會**誤報** `a7bt_ledger_missing`、對 `order_refund_jobs` 的
#     `NOT FOUND` 則**靜默 RETURN NULL` —— 這兩格本檔測不到(呼叫端身分固定為 owner)。
#
# ── 判定紀律(與 T3a 同一套,不重述理由)───────────────────────────────
#   每條負測斷言 `CONSTRAINT_NAME` **且** SQLSTATE;對照組必跑;
#   DEFERRED 的一律 `SET CONSTRAINTS ALL IMMEDIATE` 逼出來;以 owner 身分跑。
# 🔴 **CHECK 的求值順序不是契約**:同時違反兩條 CHECK 時,PostgreSQL 回哪一個名字沒有保證
#    ⇒ 本檔每條 D9 負測都刻意構造成**只違反一條**(構造方式寫在各案例的標籤裡),
#      構造不出來的逐條列進 plan §7.2.2,不硬測。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/a7bt-fixtures.sh
. scripts/a7bt-fixtures.sh

MODE="${1:?用法: a7bt-negative-money.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7bt3b)}"
export LC_ALL=C
guard_workdir "$WORK"

MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"

# ══════════════════════════════════════════════════════════════
# fixture 前綴(全部由合法 edge 組成;時間注入走共用的 pg_temp.advance)
# ══════════════════════════════════════════════════════════════
p_none()      { :; }
p_stamped()   { sql_e1; sql_e2; sql_e2b; }
# 走 E3b 進 reconciling ⇒ **tappay_refund_id 全程為 NULL**(NULL-safe 專測靠這條)
p_recon()     { p_stamped; sql_advance '10 minutes'; sql_e3b; }
# 走 E4 → E8 進 reconciling ⇒ tappay_refund_id **非 NULL**(反向 NULL-safe 專測)
p_recon_tp()  { p_stamped; sql_e4 'TPR-T3B-0001'; sql_advance '2 days'; sql_e8; }
# dead / retry_exhausted / 未複核,且 last_refund_call_at 已注入為兩天前(D9b 可過)
p_dead_ready(){ sql_retry_loop; sql_advance '2 days'; }
# dead / over_refunded(D7 的第一種已受理死因)
p_dead_over() { p_recon; sql_e12 'over_refunded'; sql_advance '2 days'; }
# dead / reconcile_exhausted(D7 的第二種;需 check_fail_count 走到 6)
p_dead_exh()  {
  p_recon
  local _i
  for _i in 1 2 3 4 5; do
    sql_e10 'check_fail_count + 1'
    sql_advance '3 days'
    sql_e8
  done
  sql_e12 'reconcile_exhausted' 'check_fail_count + 1'
  sql_advance '2 days'
}
# gen1 已結案 retry_authorized(recorded = refunded_before = 0)+ 已開出 gen2 並走到 processing
p_gen2_processing() {
  p_dead_ready; sql_e13_auth
  cat <<'SQL'
INSERT INTO public.order_refund_jobs
  (id, cancellation_id, order_id, generation, rec_trade_id, bank_refund_id, payload_hash,
   refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
   reason, actor, request_id)
SELECT job2_id, cancellation_id, order_id, 2,
       rec_trade, rpad('BRFT3BG2', 20, '0'), repeat('b', 64),
       amount, amount, 0, 0, 0,
       '客人要求取消(A7b-T T2 正向鏈)', staff_a, 'req-t3b-g2'
  FROM fx;
INSERT INTO public.order_refund_job_items (job_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT job2_id, order_id, order_item_id, qty, unit_price, amount FROM fx;
UPDATE public.order_refund_jobs
   SET status = 'processing', claim_token = gen_random_uuid(),
       claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
       next_retry_at = NULL
 WHERE id = (SELECT job2_id FROM fx);
SELECT pg_temp.mark('E1', (SELECT job2_id FROM fx));
SQL
}
# 另一張訂單的同單價品項(job↔ledger 的 order_id 欄負測需要)
p_recon_fx3() {
  p_recon
  cat <<'SQL'
CREATE TEMP TABLE fx3 ON COMMIT DROP AS
SELECT oi.order_id, oi.id AS order_item_id, oi.unit_price, oi.quantity
  FROM public.order_items oi, fx
 WHERE oi.order_id <> fx.order_id
   AND oi.unit_price = fx.unit_price
   AND oi.quantity >= fx.qty
 ORDER BY oi.order_id, oi.id
 LIMIT 1;
SELECT pg_temp.assert((SELECT count(*) FROM fx3) = 1,
                      'fixture:找不到「另一張訂單、同單價、數量足夠」的 order_item');
SQL
}

# ══════════════════════════════════════════════════════════════
# 0. provision + 身分閘 + 自我測試
# ══════════════════════════════════════════════════════════════
if [ "$MODE" = "all" ]; then
  log "0/8 provision 拋棄式 PG17"
  stop_stale_cluster "$WORK"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成(全部既有 migration + A7b-M + A7b-T 依序套用)"
else
  mkdir -p "$WORK"
fi

[ -f "$WORK/.d1t2-harness" ] \
  || die "身分閘:$WORK 沒有 .d1t2-harness 標記 ⇒ 這不是 d1t2 provision 出來的拋棄式 cluster,拒絕執行"
[ "$(runsql "SELECT current_setting('port') || '|' || current_database()")" = "54329|postgres" ] \
  || die "身分閘:連到的不是 127.0.0.1:54329 的拋棄式 postgres 庫,拒絕執行"
ok "身分閘:workdir 帶 d1t2 標記、連線確為本機 54329 拋棄式 cluster"

: > "$WORK/steps.log"
: > "$WORK/matrix.tsv"

log "1/8 harness 自我測試"

( snapshot "SELECT this_column_does_not_exist FROM pg_class" "$WORK/selftest.snap" "自我測試" ) >/dev/null 2>&1
[ $? -ne 0 ] && ok "自我測試①:壞掉的快照 SQL 會當場中止" \
             || die "自我測試①失敗:壞掉的快照 SQL 竟然沒有讓 snapshot() 中止"

# 🔴 本檔**每一條** job↔ledger 負測都靠這一行把 DEFERRED trigger 逼出來;沒有它全部恆綠。
{ sql_head; red_wrap_head; cat <<'SQL'
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.order_refund_job_items WHERE job_id = (SELECT job_id FROM fx);
  SET LOCAL session_replication_role = origin;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL
  red_wrap_tail; } > "$WORK/selftest-deferred.sql"
out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/selftest-deferred.sql" 2>&1)"
[ "$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | tail -1)" = "a7bt_c1_job_has_no_items" ] \
  && ok "自我測試②:SET CONSTRAINTS ALL IMMEDIATE 確實讓 DEFERRED constraint trigger 當場觸發" \
  || die "自我測試②失敗:DEFERRED trigger 沒有被逼出來 ⇒ 本檔的 job↔ledger 負測全部恆綠"

fpr_n=0; fpr_bad=""
while IFS='|' read -r fn want; do
  fpr_n=$((fpr_n + 1))
  got="$(runsql "SELECT coalesce((SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'), '(缺)')")"
  [ "$got" = "$want" ] || fpr_bad="$fpr_bad $fn(期望 ${want:0:8}… 實際 ${got:0:8}…)"
done < <(sed -n "s/^ *('\(pcm_a7bt_[a-z_]*\)', *'\([0-9a-f]\{32\}\)').*/\1|\2/p" "$MIG")
[ "$fpr_n" -eq 7 ] && [ -z "$fpr_bad" ] \
  && ok "自我測試③:七支函式本體指紋 = migration 檔裡的常數(run 模式也與檔案掛鉤)" \
  || die "自我測試③:函式指紋比對失敗(n=$fpr_n)—$fpr_bad"

snapshot "$STRUCT_SQL" "$WORK/struct-before.snap" "跑負測前結構快照"
ok "結構快照建立"

# ══════════════════════════════════════════════════════════════
# 2. 對照組
# ══════════════════════════════════════════════════════════════
log "2/8 對照組(合法的錢面動作必須不紅)"

case_green "reconciling → 建帳本 → E9 completed(十一欄相等、item set 相等、tappay 兩邊皆 NULL)" p_recon <<'SQL'
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
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

case_green "dead / retry_exhausted 隔日結成 retry_authorized(D7 + D9a/b/d 全部滿足)" p_dead_ready <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

# ══════════════════════════════════════════════════════════════
# 3. §7.4-8 跨表 bank id
# ══════════════════════════════════════════════════════════════
log "3/8 §7.4-8 跨表 bank id"

sql_fx2() { cat <<'SQL'
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
SELECT cancellation2_id, order_id, 'customer_request', gen_random_uuid(), repeat('a', 64), staff_a FROM fx;
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT cancellation2_id, order_id, order_item2_id, qty FROM fx;
SQL
}
# 帳本先有一筆用掉 'BRFXT3B' 的紀錄(U4 是**本表內**的唯一索引,對它完全不會響)
p_ledger_taken() {
  sql_fx2
  cat <<'SQL'
INSERT INTO public.order_refunds
  (id, order_id, bank_refund_id, items_amount, shipping_fee_before, shipping_fee_after,
   shipping_delta, refund_amount, status, reason, actor, request_id)
SELECT led_id, order_id, rpad('BRFXT3B', 20, '0'), amount, 0, 0, 0, amount,
       'processing', '既有帳本', staff_a, 'req-led' FROM fx;
INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
SELECT led_id, order_id, order_item_id, qty, unit_price, amount FROM fx;
SQL
}
case_red "§7.4-8 用一個已存在於 order_refunds 的 bank_refund_id 開新 job(U4 對跨表完全不會響)" \
         "a7bt_insert_bank_id_crosstable_reuse" p_ledger_taken <<'SQL'
  INSERT INTO public.order_refund_jobs
    (id, cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
     refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
     reason, actor, request_id)
  SELECT job3_id, cancellation2_id, order_id,
         rec_trade, rpad('BRFXT3B', 20, '0'), repeat('c', 64),
         amount, amount, 0, 0, 0, '跨表重用', staff_a, 'req-x8' FROM fx;
SQL

# ══════════════════════════════════════════════════════════════
# 4. §7.4-16 job ↔ ledger 十一欄 + item set + NULL-safe
# ══════════════════════════════════════════════════════════════
# 🔴 **哪些欄可以「只動一格」、哪些不行**(帳本自身的 CHECK 決定的,已逐條驗過):
#    可獨立:order_id / bank_refund_id / tappay_refund_id / reason / actor / request_id
#    不可獨立(必須成組動,`refund_amount = items_amount - shipping_delta` 與
#    `shipping_delta = after - before` 兩條等式綁死):
#      · shipping_fee_before + shipping_fee_after(delta 不變、金額不變)
#      · items_amount + refund_amount(帳本改成**兩列**同單價明細 ⇒ 兩欄一起加倍)
#      · shipping_delta + shipping_fee_after + refund_amount
# 🔴 **我原本寫「金額三欄只能整組換」時附的理由是錯的**(code-reviewer 實測推翻):
#    我以為 `Σ line_amount = items_amount` 加上 quantity=1 會讓金額欄整組動不了,
#    但**多插一列同單價明細**就把 items_amount 與 refund_amount 一起換掉了 ⇒ 可構造。
#    ⇒ 已補 T3b-014 / T3b-015 兩條,十一欄現在**逐欄都有覆蓋**。
log "4/8 §7.4-16 job↔ledger 十一欄 / item set / NULL-safe"

# 產生「除了指定欄之外逐欄照抄 job」的帳本 + 明細 + E9 + 逼出 deferred
led_case() {  # $1 = 覆寫片段(SELECT 清單裡的欄位覆寫,用 -- 佔位表示不覆寫)
cat <<SQL
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, tappay_refund_id, items_amount,
     shipping_fee_before, shipping_fee_after, shipping_delta, refund_amount,
     status, reason, actor, request_id, confirmed_at)
  SELECT (SELECT led_id FROM fx), $1
    FROM public.order_refund_jobs j WHERE j.id = (SELECT job_id FROM fx);
  INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT (SELECT led_id FROM fx), ji.order_id, ji.order_item_id, ji.quantity, ji.unit_price, ji.line_amount
    FROM public.order_refund_job_items ji WHERE ji.job_id = (SELECT job_id FROM fx);
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL
}
LED_OK="j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()"

case_red "§7.4-16 帳本 status 不是 confirmed" "a7bt_ledger_not_confirmed" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'processing', j.reason, j.actor, j.request_id, NULL")
SQL

case_red "§7.4-16 十一欄之 bank_refund_id 不等" "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, rpad('BRFLED', 20, '0'), j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()")
SQL

case_red "§7.4-16 十一欄之 reason 不等" "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', '帳本被改成另一個合法非空字串', j.actor, j.request_id, now()")
SQL

case_red "§7.4-16 十一欄之 actor 不等" "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, (SELECT staff_b FROM fx), j.request_id, now()")
SQL

case_red "§7.4-16 十一欄之 request_id 不等" "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, 'req-ledger-differs', now()")
SQL

case_red "§7.4-16 十一欄之 shipping_fee_before + after 成組不等(delta 與金額都不變)" \
         "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before + 60, j.shipping_fee_after + 60, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()")
SQL

# 🔴 **NULL-safe 專測**:走 E3b 的 job 全程 tappay 為 NULL,帳本側非 NULL。
#    天真 `=` 遇 NULL 整式為 NULL ⇒ 「不等才 RAISE」會**靜默放行** —— 這條就是在打那個。
case_red "§7.4-16 **NULL-safe**:job 側 tappay 為 NULL、帳本側非 NULL" \
         "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, 'TPR-LEDGER-ONLY', j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()")
SQL

case_red "§7.4-16 **NULL-safe 反向**:job 側 tappay 非 NULL、帳本側為 NULL" \
         "a7bt_ledger_column_mismatch" p_recon_tp <<SQL
$(led_case "j.order_id, j.bank_refund_id, NULL, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()")
SQL

# order_id:帳本掛到另一張訂單(明細也必須跟著換到那張訂單的同單價品項,否則過不了帳本自己的 CHECK)
case_red "§7.4-16 十一欄之 order_id 不等(帳本掛到另一張訂單)" \
         "a7bt_ledger_column_mismatch" p_recon_fx3 <<'SQL'
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, tappay_refund_id, items_amount,
     shipping_fee_before, shipping_fee_after, shipping_delta, refund_amount,
     status, reason, actor, request_id, confirmed_at)
  SELECT (SELECT led_id FROM fx), (SELECT order_id FROM fx3), j.bank_refund_id, j.tappay_refund_id,
         j.items_amount, j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta,
         j.refund_amount, 'confirmed', j.reason, j.actor, j.request_id, now()
    FROM public.order_refund_jobs j WHERE j.id = (SELECT job_id FROM fx);
  INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT (SELECT led_id FROM fx), f3.order_id, f3.order_item_id, fx.qty, f3.unit_price, fx.amount
    FROM fx3 f3, fx;
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# item set:同列數、同金額,但品項不同 ⇒ 十一欄全部相等 ⇒ 只可能紅在 item set 那條
case_red "§7.4-16 item set:列數與金額都一樣,但品項換成同單價的另一個" \
         "a7bt_ledger_item_set_differs" p_recon <<'SQL'
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, tappay_refund_id, items_amount,
     shipping_fee_before, shipping_fee_after, shipping_delta, refund_amount,
     status, reason, actor, request_id, confirmed_at)
  SELECT (SELECT led_id FROM fx), j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta, j.refund_amount,
         'confirmed', j.reason, j.actor, j.request_id, now()
    FROM public.order_refund_jobs j WHERE j.id = (SELECT job_id FROM fx);
  INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT (SELECT led_id FROM fx), order_id, order_item2_id, qty, unit_price, amount FROM fx;
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# 金額組:帳本改成兩列同單價明細 ⇒ items_amount 與 refund_amount 一起加倍(仍滿足帳本自身全部 CHECK)
case_red "§7.4-16 十一欄之 items_amount + refund_amount 成組不等(帳本多一列同單價明細)" \
         "a7bt_ledger_column_mismatch" p_recon <<'SQL'
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, tappay_refund_id, items_amount,
     shipping_fee_before, shipping_fee_after, shipping_delta, refund_amount,
     status, reason, actor, request_id, confirmed_at)
  SELECT (SELECT led_id FROM fx), j.order_id, j.bank_refund_id, j.tappay_refund_id,
         j.items_amount * 2, j.shipping_fee_before, j.shipping_fee_after, j.shipping_delta,
         j.refund_amount * 2, 'confirmed', j.reason, j.actor, j.request_id, now()
    FROM public.order_refund_jobs j WHERE j.id = (SELECT job_id FROM fx);
  INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT (SELECT led_id FROM fx), order_id, order_item_id, qty, unit_price, amount FROM fx;
  INSERT INTO public.order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
  SELECT (SELECT led_id FROM fx), order_id, order_item2_id, qty, unit_price, amount FROM fx;
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = (SELECT led_id FROM fx)
   WHERE id = (SELECT job_id FROM fx);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
SQL

# delta 組:運費後值 +60 ⇒ delta +60、refund_amount -60(items_amount 不變)
case_red "§7.4-16 十一欄之 shipping_delta + shipping_fee_after + refund_amount 成組不等" \
         "a7bt_ledger_column_mismatch" p_recon <<SQL
$(led_case "j.order_id, j.bank_refund_id, j.tappay_refund_id, j.items_amount,
         j.shipping_fee_before, j.shipping_fee_after + 60, j.shipping_delta + 60,
         j.refund_amount - 60, 'confirmed', j.reason, j.actor, j.request_id, now()")
SQL

# ══════════════════════════════════════════════════════════════
# 5. §7.4-25 D7 + §7.4-27 D9 全套
# ══════════════════════════════════════════════════════════════
# 🔴 每一條都刻意構造成**只違反一條 CHECK**(CHECK 求值順序不是契約)。
log "5/8 §7.4-25 D7 / §7.4-27 D9 全套"

case_red "§7.4-25 D7:over_refunded(已被受理)結成 retry_authorized" \
         "orj_retry_auth_only_from_retry_exhausted" p_dead_over <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-25 D7:reconcile_exhausted(已被受理)結成 retry_authorized" \
         "orj_retry_auth_only_from_retry_exhausted" p_dead_exh <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

# D9a 必填:resolution 不是 retry_authorized 卻填了證據 ⇒ 只違反 required
#(反方向「retry_authorized 卻不填」會同時違反 D9b,不是只動一格 ⇒ 見 plan §7.2.2)
case_red "§7.4-27 D9a 必填:非 retry_authorized 卻填了 Record 證據" \
         "orj_retry_auth_evidence_required" p_dead_ready <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'external_refund_confirmed',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

# D9a 成對:只填 recorded、不填 checked_at,且 resolution 不是 retry_authorized ⇒ 只違反 paired
case_red "§7.4-27 D9a 成對:只填 recorded、沒填 checked_at" \
         "orj_retry_auth_evidence_paired" p_dead_ready <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'external_refund_confirmed',
         retry_auth_recorded_refunded = refunded_before
   WHERE id = (SELECT job_id FROM fx);
SQL

# D9b fail-closed:last_refund_call_at 被清成 NULL(模擬 worker 跳過 E2b 直接發 HTTP)
# 🔴 只能用 replica 注入構造:合法路徑下 D12 保證 retry_exhausted 蘊含 last 非 NULL。
#    這正是 plan §3.5 說「D12 讓 fail-closed 成為可能」的那條依賴 —— 這裡把它拆掉看閘門還在不在。
p_dead_last_null() {
  p_dead_ready
  cat <<'SQL'
SET LOCAL session_replication_role = replica;
UPDATE public.order_refund_jobs SET last_refund_call_at = NULL
 WHERE id = (SELECT job_id FROM fx);
SET LOCAL session_replication_role = origin;
SQL
}
case_red "§7.4-27 D9b fail-closed:last_refund_call_at 為 NULL 仍想結成 retry_authorized" \
         "orj_retry_auth_next_day_gate" p_dead_last_null <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-27 D9d:結案當下的 Record 讀數不等於本代 baseline" \
         "orj_retry_auth_recorded_matches_baseline" p_dead_ready <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before + 1,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-27 E13 的 checked_at 是未來時間(填明天就能繞過隔日閘)" \
         "a7bt_e13_checked_at_in_future" p_dead_ready <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now() + interval '1 day'
   WHERE id = (SELECT job_id FROM fx);
SQL

p_dead_reviewed_ext() { p_dead_ready; sql_e13_plain 'external_refund_confirmed'; }
case_red "§7.4-27 E14 的 checked_at 是未來時間" \
         "a7bt_e14_checked_at_in_future" p_dead_reviewed_ext <<'SQL'
  UPDATE public.order_refund_jobs
     SET resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now() + interval '1 day',
         corrected_at = now(), corrected_by = (SELECT staff_b FROM fx),
         correction_reason = '把 checked_at 填到明天'
   WHERE id = (SELECT job_id FROM fx);
SQL

case_red "§7.4-27 D9c:gen2 的 E2 baseline 不等於前代結案時查到的累計退款額" \
         "a7bt_e2_d9c_baseline_mismatch" p_gen2_processing <<'SQL'
  UPDATE public.order_refund_jobs
     SET refunded_before = 1, refunded_target = 1 + refund_amount
   WHERE id = (SELECT job2_id FROM fx);
SQL

# 🔴 **`a7bt_ledger_missing` 是被支配的,而且是被實測證明的、不是推論**:
#    `orj_refund_fk`(refund_id → order_refunds.id)是**即時** FK ⇒ 指向不存在的帳本
#    在 UPDATE 當下就死在 `23503`,DEFERRED 的 job↔ledger 斷言根本輪不到。
#    ⇒ 依 plan §7.2「被嚴格支配的約束要標出來、不假裝它被驗過」,這裡測的是**支配者**,
#      並在 plan §7.2.2 把它從「T3b」改列「被支配」。
case_red "(被支配)E9 把 refund_id 指向不存在的帳本 ⇒ 先死在 FK,a7bt_ledger_missing 輪不到" \
         "orj_refund_fk" p_recon <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'completed', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
         next_check_at = NULL, refund_id = gen_random_uuid()
   WHERE id = (SELECT job_id FROM fx);
SQL

# ══════════════════════════════════════════════════════════════
# 6. §7.4-34 時區兩跑
# ══════════════════════════════════════════════════════════════
# 🔴 判別向量必須是「兩個時區會給出不同答案」的那一格,否則兩跑相同不代表任何事:
#    取 last_refund_call_at = **今天(台北)01:00** ⇒ 它的 UTC 日期是**昨天**;
#    checked_at = now()。台北日曆:兩者同一天 ⇒ D9b 必須**拒絕**。
#    若實作誤用 `date_trunc('day', ts)`(= session 時區)且 session 為 UTC,
#    兩者會落在不同 UTC 日 ⇒ 會**放行**。⇒ 這一格分得出對錯。
# 🔴🔴 **前提門檻是 08:00,不是 01:00**(code-reviewer 抓、我逐時驗算成立):
#    `last` 的 UTC 日期恆為「昨天」;要讓天真 UTC 實作**放行**,`checked_at`(= now())的 UTC 日期
#    必須是「今天」⇒ UTC now 必須已過 00:00 ⇒ **台北時刻必須 ≥ 08:00**。
#    台北 02:00–07:59 時兩種實作**都拒絕** ⇒ 兩跑全綠但**零判別力**,而註解卻宣稱它是判別向量
#    = 正是本線一直在抓的「防護被命名成超出它實際能力」。⇒ 門檻改 8,未達就**大聲不執行**。
log "6/8 §7.4-34 時區兩跑(同一格在 UTC 與 Asia/Taipei 下必須同樣被拒)"

tz_hour="$(runsql "SELECT extract(hour from (now() AT TIME ZONE 'Asia/Taipei'))::int")"
if [ "$tz_hour" -lt 8 ] 2>/dev/null; then
  bad "§7.4-34 前提不成立:現在台北 ${tz_hour} 點 < 08:00 ⇒ 本判別向量在此時段對兩種實作都拒絕、零判別力 ⇒ 本條**未執行**,不得算過"
else
  p_dead_tz() {
    p_dead_ready
    cat <<'SQL'
-- 注入:last_refund_call_at = 今天(台北)01:00 ⇒ UTC 日期是昨天、台北日期是今天
SET LOCAL session_replication_role = replica;
UPDATE public.order_refund_jobs
   SET last_refund_call_at =
         (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '1 hour')
           AT TIME ZONE 'Asia/Taipei'
 WHERE id = (SELECT job_id FROM fx);
SET LOCAL session_replication_role = origin;
SQL
  }
  # 🔴🔴 **先證明這個向量真的分得出對錯,再拿它去跑兩次。**
  #    「兩跑結果相同」本身不是證據 —— 一個對兩種實作都拒絕的向量也會兩跑相同(那正是
  #    code-reviewer 抓到的原版病灶)。這裡直接對注入值斷言判別條件:
  #      台北日曆:last 與 checked **同一天**(⇒ 正確實作必拒)
  #      UTC 日曆:last 與 checked **不同天**(⇒ 誤用 session 時區的實作會放行)
  disc="$(runsql "SELECT ((l AT TIME ZONE 'Asia/Taipei')::date = (c AT TIME ZONE 'Asia/Taipei')::date)
                      AND ((l AT TIME ZONE 'UTC')::date <> (c AT TIME ZONE 'UTC')::date)
                    FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '1 hour')
                                   AT TIME ZONE 'Asia/Taipei' AS l, now() AS c) v")"
  [ "$disc" = "t" ] \
    && ok "§7.4-34 判別力已證明:注入向量在台北日曆同日、在 UTC 日曆不同日(兩種實作會給出不同答案)" \
    || bad "§7.4-34 判別向量**沒有判別力**(disc=[$disc])⇒ 下面兩跑相同也證明不了任何事"

  for tz in UTC Asia/Taipei; do
    p_dead_tz_run() { printf "SET LOCAL TimeZone = '%s';\n" "$tz"; p_dead_tz; }
    case_red "§7.4-34 session TimeZone=$tz:台北同一日的結案必須被 D9b 拒絕" \
             "orj_retry_auth_next_day_gate" p_dead_tz_run <<'SQL'
  UPDATE public.order_refund_jobs
     SET reviewed_at = now(), reviewed_by = (SELECT staff_a FROM fx),
         resolution = 'retry_authorized',
         retry_auth_recorded_refunded = refunded_before,
         retry_auth_checked_at = now()
   WHERE id = (SELECT job_id FROM fx);
SQL
  done

  # E3b 的隔日基準同樣兩跑。
  # 🔴 **原本用 `next_check_at = now()` vs `attempted = now()-10min` 是零判別力的**
  #    (code-reviewer 實測:一天 24 小時裡只有兩個 10 分鐘窗口兩種時區才會分歧)。
  #    改用真正分歧的向量:`attempted` 注入為**今天台北 01:00**(UTC 昨天 17:00)、
  #    `next_check_at` 設為**今天台北 09:00**(UTC 今天 01:00)
  #    ⇒ 台北日曆:同一天 ⇒ 正確實作**拒絕**;UTC 日曆:昨天 vs 今天 ⇒ 天真實作**放行**。
  disc2="$(runsql "SELECT ((a AT TIME ZONE 'Asia/Taipei')::date = (n AT TIME ZONE 'Asia/Taipei')::date)
                       AND ((a AT TIME ZONE 'UTC')::date <> (n AT TIME ZONE 'UTC')::date)
                     FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '1 hour')
                                    AT TIME ZONE 'Asia/Taipei' AS a,
                                  (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '9 hours')
                                    AT TIME ZONE 'Asia/Taipei' AS n) v")"
  [ "$disc2" = "t" ] \
    && ok "§7.4-34 E3b 判別力已證明:attempted 與 next_check 在台北同日、在 UTC 不同日" \
    || bad "§7.4-34 E3b 判別向量**沒有判別力**(disc2=[$disc2])⇒ 兩跑相同證明不了任何事"

  for tz in UTC Asia/Taipei; do
    p_stamped_tz() {
      printf "SET LOCAL TimeZone = '%s';\n" "$tz"
      p_stamped
      cat <<'SQL'
SET LOCAL session_replication_role = replica;
UPDATE public.order_refund_jobs
   SET refund_call_attempted_at =
         (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '1 hour')
           AT TIME ZONE 'Asia/Taipei',
       claim_expires_at = now() - interval '1 minute'
 WHERE id = (SELECT job_id FROM fx);
SET LOCAL session_replication_role = origin;
SQL
    }
    case_red "§7.4-34 session TimeZone=$tz:E3b 的 next_check_at 與呼叫日同一個台北日必須被拒" \
             "a7bt_e3b_next_check_not_next_day" p_stamped_tz <<'SQL'
  UPDATE public.order_refund_jobs
     SET status = 'reconciling', claim_token = gen_random_uuid(),
         claimed_at = now(), claim_expires_at = now() + interval '5 minutes',
         next_check_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') + interval '9 hours')
                           AT TIME ZONE 'Asia/Taipei'
   WHERE id = (SELECT job_id FROM fx);
SQL
  done
fi

# ══════════════════════════════════════════════════════════════
# 7. §7.4-22 dormant gate:T1 之後的處置
# ══════════════════════════════════════════════════════════════
# 🔴 **「雙向」在 T1 之後物理上不可再跑**:T1 的最後一步就是 DROP 掉那個 gate,
#    而 gate 與十支守門在**同一個 migration = 同一個交易**裡 ⇒ 沒有「gate 還在、守門也在」
#    的中間狀態可供構造。「gate 在 ⇒ 一筆全合法的列仍被擋下」那一半由 A7b-M 的
#    `scripts/a7bm-verify.sh` 在 T1 之前關閉(該檔實跑 24/0)。
# ⇒ 本片能做、也只做另一半:**gate 確實不在了,而且一筆全合法的列真的進得去**
#   (後者由本檔每一條 prefix 隱含證明,並由第 2 段的兩條對照組顯式證明)。
log "7/8 §7.4-22 dormant gate(T1 之後只剩「已移除」這一半可驗)"

gate_n="$(runsql "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_refund_jobs'::regclass AND conname='order_refund_jobs_dormant_until_triggers'")"
[ "$gate_n" = "0" ] \
  && ok "§7.4-22 dormant gate 已移除(另一半「gate 在時擋下」由 A7b-M 的 a7bm-verify.sh 在 T1 之前關閉,T1 之後不可再構造)" \
  || bad "§7.4-22 dormant gate 仍在 ⇒ T1 沒跑完"

# ══════════════════════════════════════════════════════════════
# 8. 覆蓋率 / 零留痕 / 結構零漂移
# ══════════════════════════════════════════════════════════════
log "8/8 覆蓋率 / 零留痕 / 結構零漂移"

# 🔴 本片負責關閉的 **7** 個具名守門 ID 必須**逐一**被紅到(另 2 個原本也登記給 T3b,
#    施工中確認是**被支配**、已在 plan §7.2.2 改列)。
# 🔴 `SEEN_IDS` 只在該案**真的紅對了**時才記(見 a7bt-fixtures.sh 的 `LAST_RED_OK`)
#    ⇒ 這道檢查證明的是「紅對了」,不是「有跑過」。
EXPECT_CLOSED="$(cat <<'IDS'
a7bt_e13_checked_at_in_future
a7bt_e14_checked_at_in_future
a7bt_e2_d9c_baseline_mismatch
a7bt_insert_bank_id_crosstable_reuse
a7bt_ledger_column_mismatch
a7bt_ledger_item_set_differs
a7bt_ledger_not_confirmed
IDS
)"
COVERED="$(printf '%s\n' $SEEN_IDS | grep '^a7bt_' | sort -u)"
NOT_CLOSED="$(comm -23 <(printf '%s\n' "$EXPECT_CLOSED" | sort) <(printf '%s\n' "$COVERED"))"
if [ -z "$NOT_CLOSED" ]; then
  ok "本片登記要關的 7 個 a7bt_* 守門全部實跑紅對(另 2 個為被支配:a7bt_ledger_missing 有實測 T3b-023、a7bt_e2_no_predecessor_for_d9c **只有論證沒有實測**,理由見 plan §7.2.2)"
else
  bad "下列登記給 T3b 的守門沒有被實跑紅到:$(printf '%s' "$NOT_CLOSED" | tr '\n' ' ')"
fi

for t in order_refund_jobs order_refund_job_items order_cancellations \
         order_cancellation_items order_refunds order_refund_items; do
  [ "$(runsql "SELECT count(*) FROM public.$t")" = "0" ] \
    && ok "零留痕:$t 仍為 0 列" || bad "零留痕失敗:$t 不是 0 列"
done

snapshot "$STRUCT_SQL" "$WORK/struct-after.snap" "跑完全部負測後結構快照"
cmp -s "$WORK/struct-before.snap" "$WORK/struct-after.snap" \
  && ok "結構零漂移:跑完全部錢面負測後 catalog 一個 byte 都沒變" \
  || bad "結構漂移:跑完之後 catalog 被動到了"

[ "$MODE" = "all" ] && count_gate 29 46 || count_gate 29 45

printf '  §7.2 矩陣(實跑產生):%s\n' "$WORK/matrix.tsv"
printf '  負測案例 %d 條  PASS=%d  FAIL=%d\n' "$CASE_N" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
