#!/usr/bin/env bash
#
# D1t2:orchestrator 隔離 DB 實跑(規格 row 17「隔離 DB 假資料單元測」)。
#
# 子命令(provision / scenario 分離 —— D1t3 重用 provision 跑自己的負測,不複製貼上):
#   scripts/d1t2-rehearsal.sh all                    # provision → 三段 scenario → teardown(一鍵)
#   scripts/d1t2-rehearsal.sh provision <workdir>    # 建庫+假資料;印 D1_DB_URL 與 cluster id
#   scripts/d1t2-rehearsal.sh scenarios <workdir>    # 段 A dry-run → 段 B 負向 → 段 C apply
#   scripts/d1t2-rehearsal.sh teardown <workdir>
#
# 三段的斷言全部腳本判定、不靠肉眼:
#   A dry-run(happy fixture):not_committed + 訊息「全數通過」+ audit=dry-run-rolled-back 六筆 verdict
#     + 無 state + 逐表 SQL 摘要跑前後一致(pg_dump 有隨機 \restrict key,byte 比對不成立)+ cron 未動
#   B 負向(0102 查無):abort not_committed + 29 張全在 + cron 已恢復 active + state 已清 + 本段 audit 不存在
#   C apply(0052 查無 = keep-original 合法出口):completed + 外部矩陣(獨立重數,不信 orchestrator 自驗)
#     + 0052 payment_status 保持原值 + cron 恢復 + state 清 + audit=committed
#
# 🔴 誠實邊界:fake 排程器不會真的跑(d1-fake-cron.sql 檔頭)、TapPay 是 fixture、
#   本機 PG 非 Supabase;70 秒沉降照真跑(不改時序常數 —— 保真的代價,全程約 +3 分鐘);
#   CLI 的 signal 二擊硬退出本片零自動覆蓋(kill/signal 實跑 = D1t3 規格 row 18 負測)。
set -euo pipefail
# 🔴 用 BASH_SOURCE 不用 $0:被 source 時 $0 是**呼叫端**腳本,而呼叫端多半已經 cd 到
#    repo 根 ⇒ 這行會再 cd 一次、落到 repo 上一層(從 scripts/ 裡呼叫 d1t3 時實測重現)。
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT=54329
PGBIN="$(dirname "$(command -v initdb)")"
# macOS + zh_TW locale 會讓 postmaster 啟動即死(multithreaded during startup);全程 C locale。
export LC_ALL=C

log() { echo "== $* ==" >&2; }
die() { echo "🔴 $*" >&2; exit 1; }

url() { echo "postgresql://postgres@127.0.0.1:${PORT}/postgres"; }
runsql() { psql "$(url)" -v ON_ERROR_STOP=1 -qtA -c "$1"; }

provision() {
  local WORK="$1"
  mkdir -p "$WORK"
  log "1/5 initdb 拋棄式 PG17(superuser=postgres、trust、port ${PORT})"
  "$PGBIN/initdb" --version | grep -q ' 17\.' || die "PATH 的 initdb 非 PG17(宣稱=實際;codex K2 nit)"
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null
  touch "$WORK/.d1t2-harness"
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗(log 如上)"; }

  log "2/5 Supabase shim(角色 + auth schema)"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql

  log "3/5 套 migrations(跳過 pg_cron 那支;fitments 快照插在首引用之前)"
  local FIRST_FITMENTS
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in
      *20260723120000*) echo "  跳過(pg_cron/vault):$f" >&2; continue ;;
    esac
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      echo "  插入 fitments DDL 快照(於首引用 $f 之前)" >&2
      psql "$(url)" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql
    fi
    psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$f" || die "migration 失敗:$f"
  done

  log "4/5 fake cron/pg_net 介面 + alter_job 自檢(true→false→true;五元組唯一)"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f scripts/d1-fake-cron.sql
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "t" || die "fake cron 初始 active 應為 t"
  runsql "SELECT cron.alter_job(job_id => (SELECT jobid FROM cron.job WHERE jobname='pcm-settle-sweep'), active => false)" >/dev/null
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "f" || die "alter_job(false) 未生效"
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-anomaly-alert'")" = "t" || die "alter_job 漏 WHERE:干擾列被連帶停用(codex K2 nit)"
  runsql "SELECT cron.alter_job(job_id => (SELECT jobid FROM cron.job WHERE jobname='pcm-settle-sweep'), active => true)" >/dev/null
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "t" || die "alter_job(true) 未生效"
  test "$(runsql "SELECT count(*) FROM cron.job")" = "2" || die "fake cron 應含干擾列共 2 job"

  log "5/5 造 cohort 逐格同筆數假資料(+2 張非 cohort 誘餌)+ fixture 三版"
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql"
  test -s "$WORK/seed.sql"
  psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql"
  for v in happy no-hit-0052 no-hit-0102; do
    pnpm exec tsx scripts/d1t2-seed.ts --fixture "$v" > "$WORK/fixture-$v.json"
    test -s "$WORK/fixture-$v.json"
  done
  for pair in "orders 31" "order_items 41" "order_legal_consents 5" "payment_charge_attempts 28" "pending_invoices 4" "customers 2" "customer_addresses 3" "products 10" "product_variants 10" "legal_terms_versions 2" "email_outbox 1"; do
    set -- $pair
    test "$(runsql "SELECT count(*) FROM public.$1")" = "$2" || die "seed 筆數不符:$1 應 $2"
  done

  runsql "SELECT system_identifier FROM pg_control_system()" > "$WORK/cluster-id"
  echo "provision 完成:D1_DB_URL=$(url) cluster-id=$(cat "$WORK/cluster-id")" >&2
}

# 逐表 SQL 摘要(決定性;pg_dump 的隨機 \restrict key 不能用)。
# 涵蓋 consents 與四張零表計數(codex K2:漏的表在交易外被改壞,三段照樣綠)。
digest() {
  runsql "SELECT md5(concat(
    (SELECT coalesce(string_agg(o::text, '|' ORDER BY o.id), '') FROM public.orders o),
    (SELECT coalesce(string_agg(i::text, '|' ORDER BY i.id), '') FROM public.order_items i),
    (SELECT coalesce(string_agg(c::text, '|' ORDER BY c.order_id, c.terms_version), '') FROM public.order_legal_consents c),
    (SELECT coalesce(string_agg(a::text, '|' ORDER BY a.id), '') FROM public.payment_charge_attempts a),
    (SELECT coalesce(string_agg(p::text, '|' ORDER BY p.id), '') FROM public.pending_invoices p),
    (SELECT coalesce(string_agg(e::text, '|' ORDER BY e.id), '') FROM public.email_outbox e),
    (SELECT count(*) FROM public.order_refunds),
    (SELECT count(*) FROM public.order_refund_items),
    (SELECT count(*) FROM public.payment_double_charge_anomalies),
    (SELECT count(*) FROM public.payment_double_charge_anomaly_events)))"
}

# 非 cohort 誘餌 + 留存 attempts 的獨立快照(段 C 後與跑前逐列一致;不信 orchestrator 自驗)。
NC1='aaaaaaaa-0000-4000-8000-000000000001'
NC2='aaaaaaaa-0000-4000-8000-000000000002'
digest_bystanders() {
  runsql "SELECT md5(concat(
    (SELECT coalesce(string_agg(o::text, '|' ORDER BY o.id), '') FROM public.orders o WHERE o.id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(i::text, '|' ORDER BY i.id), '') FROM public.order_items i WHERE i.order_id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(a::text, '|' ORDER BY a.id), '') FROM public.payment_charge_attempts a WHERE a.order_id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(p::text, '|' ORDER BY p.id), '') FROM public.pending_invoices p WHERE p.order_id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(e::text, '|' ORDER BY e.id), '') FROM public.email_outbox e WHERE e.order_id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(c::text, '|' ORDER BY c.order_id, c.terms_version), '') FROM public.order_legal_consents c WHERE c.order_id IN ('$NC1','$NC2')),
    (SELECT coalesce(string_agg(a2::text, '|' ORDER BY a2.id), '') FROM public.payment_charge_attempts a2 WHERE a2.rec_trade_id IN ('REC0052','REC0102','REC0104'))))"
}

# 父表摘要(rehearsal 的「非 cohort 面」:D1 全程不得動父表;段 C 後仍須與跑前一致)。
digest_parents() {
  runsql "SELECT md5(concat(
    (SELECT coalesce(string_agg(c::text, '|' ORDER BY c.user_id), '') FROM public.customers c),
    (SELECT coalesce(string_agg(a::text, '|' ORDER BY a.id), '') FROM public.customer_addresses a),
    (SELECT coalesce(string_agg(p::text, '|' ORDER BY p.id), '') FROM public.products p),
    (SELECT coalesce(string_agg(v::text, '|' ORDER BY v.id), '') FROM public.product_variants v),
    (SELECT coalesce(string_agg(l::text, '|' ORDER BY l.version), '') FROM public.legal_terms_versions l)))"
}

run_cli() {
  local action="$1" fixture="$2" audit="$3" state="$4" expect_outcome="$5" expect_exit="$6"
  local out rc
  local args=("$action" --target rehearsal --cluster-id "$(cat "$WORK/cluster-id")" --state "$state" --audit "$audit")
  if [ -n "$fixture" ]; then args+=(--readback-fixture "$fixture"); fi
  set +e
  out="$(D1_DB_URL="$(url)" pnpm exec tsx scripts/d1-orchestrator-cli.ts "${args[@]}" 2>"$WORK/cli-stderr.log")"
  rc=$?
  set -e
  # 行尾錨定 + 唯一行(codex K2 nit:同時輸出兩個互斥 outcome 不得放行)。
  test "$(echo "$out" | grep -c '^D1-OUTCOME: ')" = "1" || die "$action 的 D1-OUTCOME 應恰一行,實:$out"
  echo "$out" | grep -q "D1-OUTCOME: ${expect_outcome}$" || { cat "$WORK/cli-stderr.log" >&2; die "$action 應 outcome=${expect_outcome},實:$out"; }
  test "$rc" = "$expect_exit" || die "$action 應 exit ${expect_exit},實 $rc"
}

scenarios() {
  WORK="$1"
  local STATE="$WORK/state.json"

  log "段 A:dry-run(happy fixture)"
  local BEFORE PARENTS_BEFORE BYSTANDERS_BEFORE
  BEFORE="$(digest)"
  PARENTS_BEFORE="$(digest_parents)"
  BYSTANDERS_BEFORE="$(digest_bystanders)"
  run_cli dry-run "$WORK/fixture-happy.json" "$WORK/audit-A.json" "$STATE" not_committed 1
  grep -q '全數通過' "$WORK/cli-stderr.log" || die "段 A 訊息應含「全數通過」(區分跑完 vs 提前炸)"
  test "$(digest)" = "$BEFORE" || die "段 A dry-run 動到資料(摘要不一致)"
  test ! -f "$STATE" || die "段 A 不應留 state"
  # 逐筆驗六 ID/verdict/0101 證據字面(codex K2:只驗長度 6,T-Q3 證據掉了照樣綠)。
  python3 - "$WORK/audit-A.json" <<'PYEOF' || die "段 A audit 逐筆驗證失敗"
import json, sys
a = json.load(open(sys.argv[1]))
assert a['outcome'] == 'dry-run-rolled-back', a['outcome']
v = {r['displayId']: r for r in a['readback']}
assert sorted(v) == ['PCM-2026-0052','PCM-2026-0064','PCM-2026-0090','PCM-2026-0101','PCM-2026-0102','PCM-2026-0104'], sorted(v)
for d in ('PCM-2026-0052','PCM-2026-0102','PCM-2026-0104'): assert v[d]['verdict'] == 'refund-confirmed', v[d]
for d in ('PCM-2026-0064','PCM-2026-0090'): assert v[d]['verdict'] == 'not-charged-confirmed', v[d]
r0101 = v['PCM-2026-0101']
assert r0101['verdict'] == 'sean-attested-no-key' and r0101['evidenceLevel'] == 'sean-attested', r0101
assert '未經 TapPay read-back' in r0101['note'], r0101['note']
PYEOF
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "t" || die "段 A 不應動 cron"

  log "段 B:負向(0102 查無 → 必 abort;把 bug 放回去的那一發)"
  run_cli apply "$WORK/fixture-no-hit-0102.json" "$WORK/audit-B.json" "$STATE" not_committed 1
  # 全摘要一致 = 不只 orders 計數,任何表任何列都不准動(codex K2)。
  test "$(digest)" = "$BEFORE" || die "段 B 後資料應與跑前逐列一致"
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "t" || die "段 B 後 sweeper 應已恢復"
  test ! -f "$STATE" || die "段 B 後 state 應已清(殘留會污染段 C)"
  test ! -f "$WORK/audit-B.json" || die "段 B abort 在 audit 落盤前,不應有 audit 檔"

  log "段 C:apply(0052 查無 = keep-original 合法出口)"
  local SNAP_0052; SNAP_0052="$(runsql "SELECT payment_status FROM public.orders WHERE display_id='PCM-2026-0052'")"
  run_cli apply "$WORK/fixture-no-hit-0052.json" "$WORK/audit-C.json" "$STATE" completed 0
  log "段 C 外部矩陣(新連線獨立重數、不信 orchestrator 自驗)"
  local checks=(
    "SELECT count(*) FROM public.orders|5"
    "SELECT count(*) FROM public.order_items|5"
    "SELECT count(*) FROM public.order_legal_consents|3"
    "SELECT count(*) FROM public.payment_charge_attempts|4"
    "SELECT count(*) FROM public.pending_invoices|4"
    "SELECT count(*) FROM public.pending_invoices WHERE status='voided'|3"
    "SELECT count(*) FROM public.orders WHERE display_id IN ('YWP3PC','BKPR5M','ZNHY8B')|3"
    "SELECT count(*) FROM public.orders WHERE legacy_display_id IN ('PCM-2026-0052','PCM-2026-0102','PCM-2026-0104')|3"
    "SELECT count(*) FROM public.orders WHERE payment_status='refunded'|2"
    "SELECT count(*) FROM public.email_outbox|1"
    "SELECT count(*) FROM public.order_refunds|0"
    "SELECT count(*) FROM public.order_refund_items|0"
    "SELECT count(*) FROM public.payment_double_charge_anomalies|0"
    "SELECT count(*) FROM public.payment_double_charge_anomaly_events|0"
  )
  for c in "${checks[@]}"; do
    local q="${c%|*}" want="${c#*|}"
    test "$(runsql "$q")" = "$want" || die "外部矩陣不符:$q 應 $want 實 $(runsql "$q")"
  done
  test "$(runsql "SELECT payment_status FROM public.orders WHERE legacy_display_id='PCM-2026-0052'")" = "$SNAP_0052" || die "0052 keep-original 應保持原值"
  test "$(digest_bystanders)" = "$BYSTANDERS_BEFORE" || die "段 C 後非 cohort 誘餌或留存 attempts 被動到(逐列比對)"
  test "$(digest_parents)" = "$PARENTS_BEFORE" || die "段 C 後父表被動到(D1 全程不得碰父表)"
  test "$(runsql "SELECT active FROM cron.job WHERE jobname='pcm-settle-sweep'")" = "t" || die "段 C 後 sweeper 應已恢復"
  test ! -f "$STATE" || die "段 C 後 state 應已清"
  # 六筆逐筆驗(同段 A 口徑,0052 換成 keep-original;codex K2 R2 nit)。
  python3 - "$WORK/audit-C.json" <<'PYEOF' || die "段 C audit 逐筆驗證失敗"
import json, sys
a = json.load(open(sys.argv[1]))
assert a['outcome'] == 'committed', a['outcome']
v = {r['displayId']: r for r in a['readback']}
assert sorted(v) == ['PCM-2026-0052','PCM-2026-0064','PCM-2026-0090','PCM-2026-0101','PCM-2026-0102','PCM-2026-0104'], sorted(v)
assert v['PCM-2026-0052']['verdict'] == 'keep-original-no-hit', v['PCM-2026-0052']
for d in ('PCM-2026-0102','PCM-2026-0104'): assert v[d]['verdict'] == 'refund-confirmed', v[d]
for d in ('PCM-2026-0064','PCM-2026-0090'): assert v[d]['verdict'] == 'not-charged-confirmed', v[d]
assert v['PCM-2026-0101']['evidenceLevel'] == 'sean-attested' and '未經 TapPay read-back' in v['PCM-2026-0101']['note']
PYEOF

  echo "🎉 三段全過:dry-run 零寫入 / 負向急停復原 / apply 全鏈 + keep-original 出口實跑。" >&2
}

teardown() {
  local WORK="$1"
  # 🔴 只刪本腳本建的目錄(codex K2:公開的 teardown 對任意輸入 rm -rf = 誤傳 repo/home 即毀)。
  local REAL; REAL="$(cd "$WORK" 2>/dev/null && pwd -P)" || return 0
  test -f "$REAL/.d1t2-harness" || die "teardown 拒絕:$REAL 不是本 harness 建的目錄(缺 ownership marker)"
  # marker 過了就先停 postmaster —— 後面任何 die 都不能留下佔 port 的殘留(實錘:tmpdir
  # 檢查先 die 過一次,54329 被前一輪佔住、下一輪 initdb 起不來)。
  "$PGBIN/pg_ctl" -D "$REAL/pgdata" stop -m immediate >/dev/null 2>&1 || true
  case "$REAL" in
    "${TMPDIR:-/tmp}"*|/tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) : ;;
    *) die "teardown 拒絕:$REAL 不在暫存目錄樹下(postmaster 已停、目錄保留人工看)" ;;
  esac
  rm -rf "$REAL"
}

# 被 source 時(D1t3 重用 provision/teardown/digest/runsql)不跑 dispatch。
# 三種呼叫方式(`bash x.sh` / `./x.sh` / `source x.sh`)已逐一實測。
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

CMD="${1:-}"
case "$CMD" in
  provision) provision "${2:?缺 workdir}" ;;
  scenarios) WORK="${2:?缺 workdir}"; scenarios "$WORK" ;;
  teardown) teardown "${2:?缺 workdir}" ;;
  all)
    WORK="$(mktemp -d)"
    trap 'teardown "$WORK"' EXIT
    provision "$WORK"
    scenarios "$WORK"
    ;;
  *) die "用法:d1t2-rehearsal.sh all | provision <workdir> | scenarios <workdir> | teardown <workdir>" ;;
esac
