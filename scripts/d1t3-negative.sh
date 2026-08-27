#!/usr/bin/env bash
#
# D1t3:timeout / rollback 整合負測(規格 §5.1 row 18)—— 全部對**真的**隔離 PostgreSQL 實跑。
#
#   scripts/d1t3-negative.sh all [stages]                 # provision → 負測 → teardown(一鍵)
#   scripts/d1t3-negative.sh negatives <workdir> [stages] # 只跑負測(沿用既有 provision)
#
# stages = 逗號清單(預設 all),合法值 n1,n234,n5,n6 —— **只為突變測試存在**:
# N6 每跑一次要真的閒置 5 分半,逐條突變跑全套不切實際。正式驗收一律跑 all。
#
# provision/teardown/digest 直接 source `d1t2-rehearsal.sh` 重用(交接檔指定;不複製貼上)。
#
# 六段對應規格 row 18 的 ①-⑥:
#   N1 ② 反向持鎖 ⇒ attempts 的 FOR UPDATE NOWAIT **立即** abort(不是等 lock_timeout)
#      + 消融:拿掉持鎖者,同一道 dry-run 必須通過(證明 N1 抓到的是持鎖、不是別的)
#   N2 ④ fault-inject「state 在場 + job 仍 active」⇒ self-heal 只清 state、不誤動 cron
#      🔴 規格 ④ 列的兩個 crash 邊界(「state 已寫、job 未停」與「已恢復、state 未清」)
#      在**可觀察狀態上是同一格**(規格自己逐字「後者同」),而 `jobStoppedAt` 在
#      orchestrator/sweeper-control 全樹**沒有任何讀取點**(僅寫入)⇒ 拿它跑兩次迭代
#      是「一個邊界跑兩次」、第二次鑑別力為零(code-reviewer must-fix 1,已實跑證實)。
#      改成:N2 驗這一格一次;N3 改驗 recovery 分派的**另一條真分支**。
#   N3 fault-inject「state 在場 + job **已停**」⇒ 必須真的 alter_job(true) 才算恢復
#      (走 recoverSweeper,不是 clearState-only 那條)
#   N4 N2/N3 的守門負測:跨環境 state(clusterId 不符)與 jobId 不符 ⇒ **拒絕清除**
#   N5 ⑤③⑥ 雙 orchestrator + kill -9 + 接管:
#      A 停 sweeper 後被 advisory lock 擋下 B → kill -9 A(留下 state + 停用中的 job)
#      → 另一個 process 跑 recover-sweeper ⇒ state-first 分流 → CAS 接管 → 恢復 → 清 state
#   N6 ① idle_in_transaction_session_timeout 逾時 ⇒ 交易 rollback、不留半掛交易
#      + 消融:**閒置一樣久**但關掉該設定 ⇒ 連線必須存活(證明終止來自那個設定)
#      🔴 消融必須等一樣久:短消融證不了事 —— 任何 300 秒級的別的連線殺手會讓真測
#      terminated=true、而短消融照樣存活,兩段全綠卻什麼都沒證到(must-fix 2)。
#      等待長度由探針從 TXN_SETUP_SQL 字面推導(`--idle-seconds auto`),harness 不另抄。
#
# 🔴 誠實邊界(沿用 D1t2 且不放寬):fake 排程器不會真的跑、TapPay 是 fixture、本機 PG 非 Supabase。
#    本片新增的邊界:kill -9 打的是 orchestrator **process**,不是 PostgreSQL —— 資料庫端
#    crash(如 immediate shutdown)不在本片涵蓋範圍。
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/d1t2-rehearsal.sh
source scripts/d1t2-rehearsal.sh

CLI=scripts/d1-orchestrator-cli.ts
# 🔴 直呼 node --import tsx,不走 pnpm exec:N5 要 kill -9 的是**真正跑 orchestrator 的
#    那個 process**;經 pnpm 包一層時 $! 是 wrapper,殺掉它會留下孤兒繼續跑到 COMMIT。
node_tsx() { node --import tsx "$@"; }

jobid() { runsql "SELECT jobid FROM cron.job WHERE jobname='pcm-settle-sweep'"; }
sweep_active() { runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'"; }

# 寫一份人工 state 檔(fault-inject)。$1=路徑 $2=runId $3=jobId $4=clusterId $5=jobStoppedAt|null
write_state() {
  python3 - "$@" <<'PYEOF'
import json, sys
p, run_id, job_id, cluster_id, stopped = sys.argv[1:6]
json.dump({
    "version": 1,
    "projectRef": "rehearsal",
    "clusterId": cluster_id,
    "jobId": int(job_id),
    "jobName": "pcm-settle-sweep",
    "runId": run_id,
    "previousRunId": None,
    "stateWrittenAt": "2026-07-30T00:00:00.000Z",
    "jobStoppedAt": None if stopped == "null" else stopped,
}, open(p, "w"), indent=2)
PYEOF
}

# 跑 CLI(前景)。$1=action $2=audit $3=state $4=期望 outcome $5=期望 exit;$6=可選 fixture
cli() {
  local action="$1" audit="$2" state="$3" want_outcome="$4" want_exit="$5" fixture="${6:-}"
  local args=("$CLI" "$action" --target rehearsal --cluster-id "$CLUSTER" --state "$state" --audit "$audit")
  # 🔴 全檔禁用 `[ … ] && cmd` 形式:條件為假時整個 AND-list 回非零,set -e 會當場殺掉腳本
  #    ⇒ 負測「沒炸」會被誤判成腳本自己結束(綠得莫名其妙)。一律 if / ||。
  if [ -n "$fixture" ]; then args+=(--readback-fixture "$fixture"); fi
  local out rc
  set +e
  out="$(D1_DB_URL="$(url)" node_tsx "${args[@]}" 2>"$WORK/last-stderr.log")"
  rc=$?
  set -e
  CLI_STDERR="$WORK/last-stderr.log"
  test "$(echo "$out" | grep -c '^D1-OUTCOME: ')" = "1" || die "$action 的 D1-OUTCOME 應恰一行,實:$out"
  echo "$out" | grep -q "D1-OUTCOME: ${want_outcome}$" || { cat "$CLI_STDERR" >&2; die "$action 應 outcome=${want_outcome},實:$out"; }
  test "$rc" = "$want_exit" || { cat "$CLI_STDERR" >&2; die "$action 應 exit ${want_exit},實 $rc"; }
}

# 階段過濾(僅供突變測試;預設 all)。
want() { case ",${STAGES}," in *,all,*) return 0 ;; *,"$1",*) return 0 ;; *) return 1 ;; esac; }

# 🔴 N5 的 A 是背景 apply。任何一條斷言 die,腳本一走 A 就成孤兒、繼續跑到 COMMIT ——
#    整個隔離庫(以及「這場負測證明了什麼」)當場作廢。EXIT trap 保證它跟著死。
A_PID=""
kill_a() { if [ -n "$A_PID" ]; then kill -9 "$A_PID" 2>/dev/null || true; A_PID=""; fi; }

negatives() {
  WORK="$1"
  STAGES="${2:-all}"
  # 🔴 驗證與 want() 必須用**同一套** tokenizer(code-reviewer must-fix 5,已實跑證實):
  #    舊版驗證走 word-splitting、want() 走 `,${STAGES},` 比對 ⇒ `" n1"` 兩邊看法不同,
  #    驗證放行但零個 stage 命中 ⇒ 六段**全部靜默跳過、exit 0**。這裡正規化後重建字串。
  local norm="" s
  for s in ${STAGES//,/ }; do
    case "$s" in all|n1|n234|n5|n6) : ;; *) die "未知 stage '$s';合法值:all n1 n234 n5 n6" ;; esac
    norm="$norm,$s"
  done
  STAGES="${norm#,}"
  test -n "$STAGES" || die "stages 不得為空(要跑全部請給 all)"
  case ",$STAGES," in *,all,*) STAGES="all" ;; esac
  RAN=0  # 機制守門:跑完一段就 +1;零段 = 拒絕宣告任何結論。
  if [ "$STAGES" != "all" ]; then echo "⚠️  只跑 stages=${STAGES}(突變測試模式;正式驗收必須跑 all)" >&2; fi
  CLUSTER="$(cat "$WORK/cluster-id")"
  local FIXTURE="$WORK/fixture-happy.json"
  test -s "$FIXTURE" || die "缺 $FIXTURE(請先跑 provision)"
  # 可重複執行:清掉上一輪的 audit/state(CLI 的「拒覆蓋既存 audit」是正確行為,
  # 但會讓同一個 provision 無法重跑負測)。只刪本 harness 命名空間下的檔。
  rm -f "$WORK"/audit-n*.json "$WORK"/audit-n*.json.recovery-*.json "$WORK"/state-n*.json
  # 🔴 前置條件明說、不自動「修好」:sweeper 若不是 active,代表上一輪負測中途死掉、
  #    現場還沒收拾 —— 自動把它打開會蓋掉事故現場,也會讓 N1「不得動 cron」變成假綠。
  test "$(sweep_active)" = "t" \
    || die "前置不成立:cron sweeper 目前非 active(上一輪殘留?)。人工確認後執行:cron.alter_job(job_id => …, active => true)"
  local BASE PARENTS_BASE
  BASE="$(digest)"
  PARENTS_BASE="$(digest_parents)"
  local JOB; JOB="$(jobid)"

  # ── N1 ② NOWAIT fence ────────────────────────────────────────────────────
  if want n1; then
  RAN=$((RAN + 1))
  log "N1 消融:無反向持鎖者 ⇒ 同一道 dry-run 必須通過(先證明這道題本來會過)"
  cli dry-run "$WORK/audit-n1-ablation.json" "$WORK/state-n1.json" not_committed 1 "$FIXTURE"
  grep -q '全數通過' "$CLI_STDERR" || die "N1 消融:無持鎖時 dry-run 應通過(否則 N1 的紅是別的原因)"

  log "N1:反向持鎖 payment_charge_attempts ⇒ NOWAIT 立即 abort"
  local FIFO="$WORK/holder.fifo"
  rm -f "$FIFO"; mkfifo "$FIFO"
  psql "$(url)" -v ON_ERROR_STOP=1 -qtA < "$FIFO" > "$WORK/holder.log" 2>&1 &
  local HOLDER_PID=$!
  exec 9>"$FIFO"
  # 反向持鎖者的真實形狀:先鎖 attempt(如 mark_charge_attempt_charged),再也不放。
  # 🔴 `count(*) … FOR UPDATE` 是**非法語法**(FOR UPDATE is not allowed with aggregate
  #    functions)—— 第一版這樣寫,持鎖者當場 ERROR、一列都沒鎖到,而 N1 照樣「通過」。
  echo "BEGIN; SELECT count(*) FROM (SELECT id FROM public.payment_charge_attempts ORDER BY id FOR UPDATE) t;" >&9
  # 🔴 就緒判定不能看表層 RowShareLock:兩個 FOR UPDATE 交易本來就共存(第一版的假就緒)。
  #    真正的訊號 = 持鎖者被指派了 transaction id —— 只有真的寫了 xmax(= 鎖到列)才會有。
  #    再加一條把訊號**綁到受測資源上**(code-reviewer important 9):光有 xid 只證明
  #    某個 backend 在寫東西,不證明它鎖的是 payment_charge_attempts。兩者相乘 ≥1 才算就緒。
  local waited=0
  until [ "$(runsql "SELECT (SELECT count(*) FROM pg_locks WHERE locktype='transactionid' AND mode='ExclusiveLock' AND granted AND pid <> pg_backend_pid()) * (SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'payment_charge_attempts' AND l.granted AND l.pid <> pg_backend_pid())")" -ge 1 ]; do
    if ! kill -0 "$HOLDER_PID" 2>/dev/null; then cat "$WORK/holder.log" >&2; die "N1:持鎖者 process 已結束(持鎖語句失敗?)"; fi
    sleep 0.2; waited=$((waited + 1)); [ "$waited" -le 100 ] || { cat "$WORK/holder.log" >&2; die "N1:持鎖者 20 秒內未取得列鎖"; }
  done

  local T0 T1
  T0=$(date +%s)
  cli dry-run "$WORK/audit-n1.json" "$WORK/state-n1.json" not_committed 1 "$FIXTURE"
  T1=$(date +%s)
  grep -qi 'could not obtain lock' "$CLI_STDERR" \
    || { cat "$CLI_STDERR" >&2; die "N1 應因 NOWAIT 取不到鎖而 abort(訊息應含 could not obtain lock)"; }
  # 🔴 NOWAIT 與「等到 lock_timeout 才死」在 PG 都是 55P03 ⇒ 只能靠訊息字面 + 時間分辨。
  if grep -qi 'lock timeout' "$CLI_STDERR"; then die "N1 是 lock_timeout(等了 5 秒)不是 NOWAIT 立即 abort"; fi
  test "$((T1 - T0))" -lt 30 || die "N1:dry-run 花了 $((T1 - T0)) 秒,不像立即 abort"
  test ! -f "$WORK/state-n1.json" || die "N1:dry-run 不得寫 state"
  test "$(sweep_active)" = "t" || die "N1:dry-run 不得動 cron"

  echo "ROLLBACK;" >&9 || true
  exec 9>&-
  wait "$HOLDER_PID" 2>/dev/null || true
  rm -f "$FIFO"
  test "$(digest)" = "$BASE" || die "N1 後資料被動到"
  fi

  # ── N2 / N3 ④ fault-inject:recovery 分派的**兩條真分支** ──────────────────
  if want n234; then
  RAN=$((RAN + 1))
  local N2RUN="11111111-2222-4333-8444-555555555555"
  log "N2:state 在場 + job 仍 active ⇒ 只清 state、不誤動 cron(規格 ④ 兩個邊界的同一格)"
  local ST2="$WORK/state-n2.json" AUD2="$WORK/audit-n2.json"
  rm -f "$AUD2".recovery-*.json
  write_state "$ST2" "$N2RUN" "$JOB" "$CLUSTER" "null"
  test "$(sweep_active)" = "t" || die "N2 前提:job 應為 active"
  cli recover-sweeper "$AUD2" "$ST2" recovery_only 5
  test ! -f "$ST2" || die "N2:state 應已清"
  test "$(sweep_active)" = "t" || die "N2:job 本來就 active,不該被動"
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-anomaly-alert'")" = "t" || die "N2:誤動了別的 job"
  local REC2; REC2="$(ls "$AUD2".recovery-*.json)"
  N2RUN="$N2RUN" python3 - "$REC2" <<'PYEOF' || die "N2:recovery audit 內容不符"
import json, os, sys
a = json.load(open(sys.argv[1]))
assert a['outcome'] == 'recovery_only', a
assert a['takenOverRunId'] == os.environ['N2RUN'], a
assert '上輪未提交' in a['reconcile'], a
PYEOF

  log "N3:state 在場 + job **已停** ⇒ 必須真的 alter_job(true) 才算恢復(另一條分支)"
  local N3RUN="11111111-2222-4333-8444-555555555556"
  local ST3="$WORK/state-n3.json" AUD3="$WORK/audit-n3.json"
  rm -f "$AUD3".recovery-*.json
  write_state "$ST3" "$N3RUN" "$JOB" "$CLUSTER" "2026-07-30T00:01:00.000Z"
  runsql "SELECT cron.alter_job(job_id => $JOB, active => false)" >/dev/null
  test "$(sweep_active)" = "f" || die "N3 前提:job 應已停"
  cli recover-sweeper "$AUD3" "$ST3" recovery_only 5
  test "$(sweep_active)" = "t" || die "N3:job 應被恢復成 active(這一格才是 recoverSweeper 那條分支)"
  test ! -f "$ST3" || die "N3:state 應已清"
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-anomaly-alert'")" = "t" || die "N3:誤動了別的 job"
  local REC3; REC3="$(ls "$AUD3".recovery-*.json)"
  N3RUN="$N3RUN" python3 - "$REC3" <<'PYEOF' || die "N3:recovery audit 內容不符"
import json, os, sys
a = json.load(open(sys.argv[1]))
assert a['outcome'] == 'recovery_only', a
assert a['takenOverRunId'] == os.environ['N3RUN'], a
assert '上輪未提交' in a['reconcile'], a
PYEOF

  # ── N4 守門負測(證明 N2/N3 的「清掉了」不是無條件清)─────────────────────
  log "N4a:跨環境 state(clusterId 不符)⇒ 拒絕接管、拒絕清除"
  local ST4="$WORK/state-n4.json"
  write_state "$ST4" "99999999-2222-4333-8444-555555555555" "$JOB" "9999999999999999999" "null"
  cli recover-sweeper "$WORK/audit-n4a.json" "$ST4" not_committed 1
  grep -q '疑似跨環境誤用' "$CLI_STDERR" || die "N4a:應以跨環境理由拒絕"
  test -f "$ST4" || die "N4a:state 不得被清掉"

  log "N4b:state 的 jobId 與現網五元組定位不符 ⇒ 拒絕清除"
  write_state "$ST4" "99999999-2222-4333-8444-555555555556" "999999" "$CLUSTER" "null"
  # 🔴 只驗「檔案還在」不夠(code-reviewer nit 15):orchestrator 的 takeOverState 排在
  #    jobId 檢查**之前**,會先改寫 runId。快照比對把「被改寫了什麼」也釘住。
  local ST4_BEFORE; ST4_BEFORE="$(cat "$ST4")"
  cli recover-sweeper "$WORK/audit-n4b.json" "$ST4" not_committed 1
  grep -q '與現網五元組定位' "$CLI_STDERR" || die "N4b:應以 jobId 不符理由拒絕"
  test -f "$ST4" || die "N4b:state 不得被清掉"
  ST4_BEFORE="$ST4_BEFORE" python3 - "$ST4" <<'PYEOF' || die "N4b:state 被改動的範圍超出預期"
import json, os, sys
before = json.loads(os.environ['ST4_BEFORE'])
after = json.load(open(sys.argv[1]))
# 已知且可接受的改動 = CAS 接管改寫 runId/previousRunId;其餘欄位一律不得變。
assert after['previousRunId'] == before['runId'], (before, after)
for k in ('version', 'projectRef', 'clusterId', 'jobId', 'jobName', 'stateWrittenAt', 'jobStoppedAt'):
    assert after[k] == before[k], (k, before[k], after[k])
PYEOF
  rm -f "$ST4"
  test "$(sweep_active)" = "t" || die "N4 後 job 應仍 active"
  fi

  # ── N5 ⑤③⑥ 雙 orchestrator + kill -9 + CAS 接管 ───────────────────────────
  if want n5; then
  RAN=$((RAN + 1))
  log "N5:啟動 A(apply),等它停完 sweeper 進入 70 秒沉降窗"
  local ST5="$WORK/state-n5.json"
  rm -f "$ST5" "$WORK/audit-n5-a.json" "$WORK/audit-n5-b.json"
  # 🔴 這裡**不能**用 node_tsx 那個函式:`VAR=… somefunc … &` 會讓 bash 先開一個子 shell,
  #    `$!` 拿到的是子 shell、不是 node ⇒ kill -9 只殺掉外殼,orchestrator 變孤兒繼續跑到
  #    COMMIT(實錘:2026-07-30 第二輪 N5 就是這樣,真的留下一支活的 apply)。
  #    簡單命令 + 環境前綴才會 fork/exec 成單一 process。
  D1_DB_URL="$(url)" node --import tsx "$CLI" apply --target rehearsal --cluster-id "$CLUSTER" \
    --state "$ST5" --audit "$WORK/audit-n5-a.json" --readback-fixture "$FIXTURE" \
    > "$WORK/n5-a.out" 2> "$WORK/n5-a.err" &
  A_PID=$!  # 全域(非 local):EXIT trap 的 kill_a 要看得到。
  # 機制守門:證明 $A_PID 真的是 orchestrator 本身,而不是包一層的殼(上面那個坑的回歸閘)。
  ps -p "$A_PID" -o command= | grep -q 'd1-orchestrator-cli.ts' \
    || die "N5:\$A_PID($A_PID)不是 orchestrator process —— kill -9 會留下孤兒,拒絕繼續"
  waited=0
  until [ -f "$ST5" ] && [ "$(sweep_active)" = "f" ]; do
    kill -0 "$A_PID" 2>/dev/null || { cat "$WORK/n5-a.err" >&2; die "N5:A 在停用 sweeper 前就結束了"; }
    sleep 0.5; waited=$((waited + 1)); [ "$waited" -le 240 ] || die "N5:A 兩分鐘內未停用 sweeper"
  done
  local A_RUNID; A_RUNID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runId"])' "$ST5")"
  # 🔴 不整檔比對(code-reviewer important 6):A 在 70 秒沉降後會第二次寫 state 補
  #    `jobStoppedAt`;慢機器上 B 的冷啟動撐過那個窗 ⇒ 整檔比對變假紅,訊息還誤導成
  #    「B 動到了 A 的 state」。只比 B 絕對不該碰的欄。
  local A_OWNER; A_OWNER="$(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
print("|".join(str(s[k]) for k in ("runId", "previousRunId", "jobId", "clusterId", "projectRef")))' "$ST5")"

  log "N5-⑤:此時啟動 B ⇒ 必須被 advisory lock 擋下、且完全不碰 cron/state"
  cli apply "$WORK/audit-n5-b.json" "$ST5" not_committed 1 "$FIXTURE"
  # 🔴 不能只 grep 'advisory lock':金絲雀失敗的訊息也含這四個字 ⇒ single-flight 壞掉
  #    但金絲雀順手擋下時,這條斷言會綠。要的是 single-flight 那一句逐字。
  grep -q '另一個 orchestrator 實例持有 advisory lock' "$CLI_STDERR" \
    || { cat "$CLI_STDERR" >&2; die "N5-⑤:B 應以 single-flight 理由退出(不是金絲雀或別的)"; }
  test "$(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
print("|".join(str(s[k]) for k in ("runId", "previousRunId", "jobId", "clusterId", "projectRef")))' "$ST5")" = "$A_OWNER" \
    || die "N5-⑤:B 動到了 A 的 state 歸屬欄位"
  test "$(sweep_active)" = "f" || die "N5-⑤:B 動到了 cron"
  test ! -f "$WORK/audit-n5-b.json" || die "N5-⑤:B 不該留下 audit"

  log "N5-③:kill -9 A(硬死;signal handler 一律攔不到)"
  local A_PID_SNAPSHOT="$A_PID"
  kill -9 "$A_PID"
  wait "$A_PID" 2>/dev/null || true
  A_PID=""  # 已由本段殺掉,trap 不必再動。
  waited=0
  while kill -0 "$A_PID_SNAPSHOT" 2>/dev/null; do sleep 0.2; waited=$((waited + 1)); [ "$waited" -le 50 ] || die "N5:A 沒死"; done
  if pgrep -f 'd1-orchestrator-cli.ts' >/dev/null; then die "N5:仍有 orchestrator 殘存(孤兒 process 會繼續跑到 COMMIT)"; fi
  test -f "$ST5" || die "N5:crash 現場應留下 ownership state"
  test "$(sweep_active)" = "f" || die "N5:crash 現場 sweeper 應仍停用"
  test "$(runsql "SELECT count(*) FROM public.orders")" = "31" || die "N5:A 在 BEGIN 前就死了,不該有任何刪除"
  test "$(digest)" = "$BASE" || die "N5:crash 後資料被動到"

  # 🔴 等 PG 端把 A 的 backend 收掉再往下(code-reviewer important 7):advisory lock 是
  #    session 級,OS process 沒了不代表 backend 已被 reap ⇒ recover-sweeper 會拿不到鎖、
  #    回 not_committed 而 die 成間歇紅。直接盯鎖本身,不盯 process。
  waited=0
  until [ "$(runsql "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted")" = "0" ]; do
    sleep 0.5; waited=$((waited + 1)); [ "$waited" -le 60 ] || die "N5:A 的 advisory lock 30 秒內未釋放"
  done

  log "N5-⑥:另一個 process 跑 recover-sweeper ⇒ state-first 分流 → CAS 接管 → 恢復 → 清 state"
  rm -f "$WORK/audit-n5-a.json".recovery-*.json
  cli recover-sweeper "$WORK/audit-n5-a.json" "$ST5" recovery_only 5
  test "$(sweep_active)" = "t" || die "N5-⑥:sweeper 應已恢復"
  test ! -f "$ST5" || die "N5-⑥:state 應已清"
  local REC5; REC5="$(ls "$WORK/audit-n5-a.json".recovery-*.json)"
  A_RUNID="$A_RUNID" python3 - "$REC5" <<'PYEOF' || die "N5-⑥:recovery audit 內容不符"
import json, os, sys
a = json.load(open(sys.argv[1]))
assert a['outcome'] == 'recovery_only', a
assert a['takenOverRunId'] == os.environ['A_RUNID'], (a, os.environ['A_RUNID'])
assert a['runId'] != a['takenOverRunId'], a
assert '上輪未提交' in a['reconcile'], a
PYEOF
  test "$(digest)" = "$BASE" || die "N5 全段後資料被動到"
  fi

  # ── N6 ① idle_in_transaction 逾時 ⇒ rollback、不留半掛交易 ──────────────────
  if want n6; then
  RAN=$((RAN + 1))
  log "N6 消融:閒置**一樣久**但關掉 idle 逾時 ⇒ 連線必須存活(這才證明終止來自那個設定)"
  local ABL; ABL="$(D1_DB_URL="$(url)" node_tsx scripts/d1t3-idle-timeout-probe.ts --idle-seconds auto --override-idle 0)"
  echo "N6 消融結果:$ABL" >&2
  echo "$ABL" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["terminated"] is False and r["asyncErrorSeen"] is False and r["deletedRows"] == 1, r' \
    || die "N6 消融:關掉逾時後連線仍被砍 —— 那 N6 的紅不是逾時造成的"
  test "$(digest)" = "$BASE" || die "N6 消融後資料被動到(連線關閉應 rollback)"

  log "N6:用 TXN_SETUP_SQL 的字面推導等待長度(--idle-seconds auto)閒置到逾時"
  local PROBE; PROBE="$(D1_DB_URL="$(url)" node_tsx scripts/d1t3-idle-timeout-probe.ts --idle-seconds auto)"
  # 判定核心 = terminated(= 那句 SELECT 1 真的 throw)。錯誤碼只做**形狀交叉核對**,
  # 🔴 不列入證據鏈(code-reviewer important 8:泛用連線失敗碼幾乎必中)——
  #    「終止來自 idle 逾時」這件事的唯一證據是上面那段等一樣久的消融。
  echo "$PROBE" | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert r["terminated"] is True, r
assert r["deletedRows"] == 1, r
blob = "%s %s" % (r["errorCode"] or "", r["errorMessage"] or "")
assert "25P03" in blob or "idle-in-transaction" in blob, r
' || { echo "$PROBE" >&2; die "N6:閒置逾時後連線應被 server 終止(且錯誤形狀符合 idle 逾時)"; }
  echo "N6 終止證據:$PROBE" >&2
  test "$(digest)" = "$BASE" || die "N6:逾時後那筆 DELETE 未被 rollback(誘餌 email_outbox 不見了)"
  test "$(runsql "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'")" = "0" \
    || die "N6:留下半掛交易(pg_stat_activity 仍有 idle in transaction)"
  test "$(runsql "SELECT count(*) FROM pg_prepared_xacts")" = "0" || die "N6:留下 prepared transaction"
  fi

  test "$(digest_parents)" = "$PARENTS_BASE" || die "全段後父表被動到"
  # 機制守門:一段都沒跑就不准交出任何結論(stage 過濾器的失效形狀就是「靜默跳過」)。
  test "$RAN" -ge 1 || die "沒有任何 stage 執行(stages=${STAGES});拒絕宣告結果"
  if [ "$STAGES" != "all" ]; then echo "⚠️  stages=${STAGES} 跑完 ${RAN} 段(非完整驗收)" >&2; return 0; fi
  test "$RAN" = "4" || die "內部不一致:stage 數應為 4,實 ${RAN}"
  echo "🎉 D1t3 全過(4/4 stage、規格 row 18 ①-⑥ 六項):NOWAIT 立即 abort / recovery 兩條分支 self-heal / 守門拒絕誤清 / 雙實例被鎖擋 + kill -9 後 CAS 接管 / idle 逾時 rollback 零殘留(兩段等長消融證明抓得到)。" >&2
}

CMD="${1:-}"
case "$CMD" in
  negatives)
    trap 'kill_a' EXIT
    negatives "${2:?缺 workdir}" "${3:-all}"
    ;;
  all)
    WORK="$(mktemp -d)"
    trap 'kill_a; teardown "$WORK"' EXIT
    provision "$WORK"
    negatives "$WORK" "${2:-all}"
    ;;
  *) die "用法:d1t3-negative.sh all | negatives <workdir>" ;;
esac
