#!/usr/bin/env bash
# ============================================================
# `#27` 片 D0 verify harness —— ACL / RLS / trigger 守門的**可重跑行為證據**
# ============================================================
# 對象 = supabase/migrations/20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql
# plan  = docs/specs/2026-08-14-27-audit-log-viewer-plan.md
#
# 🔴 **這支存在的理由 = codex R3 的 must-fix M1**:
#    前三輪我把 17 道正/負控**只寫在信件散文裡** —— 沒有人能重跑,也沒有人能否證。
#    而 repo 對權限重片的既成體例是**committed verify harness**
#    (數法:`ls scripts/*.sh | wc -l` = 92,`ls scripts/ | grep -ic verify` = 63)。
#    ⇒ **作者自跑只能證明「我想到的都成立」。** 這支是為了讓**非作者**跑得動。
#
# 🔴 **正控與負控交替跑,不要先跑完全部負控**(2026-08-15 C 窗實錘):
#    上一版我寫 `v_privs || 'MAINTAIN'`,plpgsql 當成陣列字面 ⇒ 整支炸在同一處。
#    那時**所有負控看起來全部正常(全紅)** —— 是**正控該 COMMIT 卻紅了**才露餡。
#    ⚠️ 若照習慣先跑十二道負控,會先看到十二個紅、心理上已認定「守門很好」,
#       **正控那一發的紅反而會被當成環境問題。**
#    🔴 **本檔的實際做法(E 窗 2026-08-15 驗證抓到第一版宣稱過大)**:
#       **每 1-3 道負控之間插一次正控,收尾再一次** —— 不是「每一道後面都跟一次」。
#       第一版宣稱「每一道負控後面都跟一次正控」而實際只在前 9 個 case 成立、
#       後面連續 11 道負控中間零正控 ⇒ **宣稱的作用域 > 實際做到的範圍**。字面已改準。
#
# 用法:
#   bash scripts/27-d0-verify.sh provision   # 建丟棄庫(約 10 秒)
#   bash scripts/27-d0-verify.sh run         # 跑 18 個 case
#   bash scripts/27-d0-verify.sh selftest    # 🔴 驗這支腳本自己不是恆綠的
#   bash scripts/27-d0-verify.sh teardown    # 拆乾淨
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:-run}"
WORK="${WORK:-/tmp/27-d0-work}"
PORT="${PORT:-54627}"
MIG="supabase/migrations/20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql"
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U pgtest -d postgres)

# 🔴 走 TCP 不走 unix socket:socket 路徑上限 103 bytes,深目錄會 FATAL(實測踩過)。
# 🔴 LC_ALL=C:不設會 "postmaster became multithreaded during startup"(macOS 實測)。

pg() { LC_ALL=C pg_ctl -D "$WORK/pgdata" "$@"; }
q()  { "${PSQL[@]}" -q "$@" >/dev/null 2>&1; }

case "$MODE" in
provision)
  rm -rf "$WORK"; mkdir -p "$WORK"
  initdb -D "$WORK/pgdata" -U pgtest --auth=trust -E UTF8 >"$WORK/initdb.log" 2>&1 || { echo "initdb 失敗,見 $WORK/initdb.log"; exit 1; }
  pg -o "-p $PORT -c unix_socket_directories=" -l "$WORK/pg.log" start >/dev/null 2>&1
  sleep 2
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "建基線失敗"; exit 1; }
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role  nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='foo')           then create role foo           nologin; end if;
end $$;
-- 重建 20260712210000 的**起始狀態**(建表 + RLS enable + REVOKE ALL + 只 GRANT INSERT)。
-- ⚠️ 這是照 repo 那支 migration 重建的,**不是正式庫的實況** —— 全檔結論皆以此為界。
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null, action text not null, target text,
  before jsonb, after jsonb, reason text,
  request_id text not null, source_app text, created_at timestamptz default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;
grant insert on table public.admin_audit_log to service_role;
alter role service_role bypassrls;
create or replace function public.t_noop() returns trigger language plpgsql as $$ begin return new; end $$;
SQL
  echo "✅ provision 完成($WORK,port $PORT)"
  ;;

teardown)
  pg stop -m fast >/dev/null 2>&1
  rm -rf "$WORK"
  echo "✅ teardown 完成;殘留檢查:$(pgrep -fl "$PORT" | head -1 || echo '無')"
  ;;

run)
  PASS=0; FAIL=0
  reset_state() {
    q -c "drop trigger if exists tr_probe on public.admin_audit_log;" \
      -c "revoke pg_maintain from service_role, anon, authenticated;" \
      -c "revoke pgtest from service_role;" \
      -c "revoke all on table public.admin_audit_log from public, anon, authenticated, service_role, foo;" \
      -c "revoke all (reason) on public.admin_audit_log from service_role, pgtest, anon, authenticated, foo;" \
      -c "grant insert on table public.admin_audit_log to service_role;" \
      -c "drop policy if exists p_tmp on public.admin_audit_log;" \
      -c "alter table public.admin_audit_log enable row level security;" \
      -c "alter role service_role bypassrls;" \
      -c "alter role anon nobypassrls;" -c "alter role authenticated nobypassrls;"
    q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end \$\$;"
  }
  apply_out() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1; }

  # $1=說明 $2=expect(COMMIT|字串片段) $3..=前置 SQL
  # 🔴 **編號由計數器自動給,呼叫端不寫死** —— 寫死的號碼會在插入/刪除 case 時整組過期,
  #    而那正是本專案今晚反覆抓到的那一族(「改了東西沒改記錄它的字面」)。
  N=0
  case_run() {
    N=$((N+1)); local n="$N" desc="$1" expect="$2"; shift 2
    reset_state
    for stmt in "$@"; do q -c "$stmt"; done
    local out; out="$(apply_out)"
    local got; got="$(printf '%s' "$out" | grep -E 'ERROR|COMMIT' | head -1 | sed 's|.*ERROR:  ||')"
    if printf '%s' "$got" | grep -qF "$expect"; then
      printf '  ✅ %-2s %-26s 預期含[%s]\n        實得: %s\n' "$n" "$desc" "$expect" "${got:0:96}"; PASS=$((PASS+1))
    else
      printf '  ❌ %-2s %-28s\n     期望含: %s\n     實得  : %s\n' "$n" "$desc" "$expect" "$got"; FAIL=$((FAIL+1))
    fi
  }
  pos() { case_run "正控(乾淨起始)" "COMMIT"; }

  echo "── 正/負控交替(理由見檔頭)────────────────────────────"
  pos
  case_run "角色不存在"          "角色 authenticated 不存在" "revoke all on public.admin_audit_log from authenticated" "drop role authenticated"
  pos
  case_run "service_role 有 MAINTAIN" "有 MAINTAIN"          "grant pg_maintain to service_role"
  pos
  case_run "anon 有 MAINTAIN"    "client 角色 anon 有 MAINTAIN" "grant pg_maintain to anon"
  pos
  case_run "掛非內部 trigger"    "非內部 trigger"            "create trigger tr_probe after insert on public.admin_audit_log for each row execute function public.t_noop()"
  pos
  case_run "service_role 無 BYPASSRLS" "無 BYPASSRLS"        "alter role service_role nobypassrls"
  case_run "anon 有 BYPASSRLS"   "anon 有 BYPASSRLS"         "alter role anon bypassrls"
  pos
  case_run "service_role 多開 UPDATE" "有 UPDATE"            "grant update on public.admin_audit_log to service_role"
  case_run "繼承 owner(relacl 看不到)" "有 UPDATE"          "grant pgtest to service_role"
  case_run "anon 拿到 SELECT"    "anon 有 SELECT"            "grant select on public.admin_audit_log to anon"
  pos
  case_run "欄級 ACL 後門"       "欄級 ACL 帶"               "grant update (reason) on public.admin_audit_log to service_role"
  case_run "第三角色 foo 拿 SELECT" "foo:SELECT:false"       "grant select on public.admin_audit_log to foo"
  case_run "WITH GRANT OPTION"   "service_role:SELECT:true"  "grant select on public.admin_audit_log to service_role with grant option"
  pos
  case_run "撤 INSERT(誤殺正控)" "INSERT 不存在"            "revoke insert on public.admin_audit_log from service_role"
  case_run "RLS 被關掉"          "RLS 未啟用"                "alter table public.admin_audit_log disable row level security"
  case_run "加一條 policy"       "應為零 policy"             "create policy p_tmp on public.admin_audit_log for select using (true)"
  pos

  echo "── 冪等(R3 C1:整支可對正式庫重跑當漂移探針)──────────"
  reset_state
  o1="$(apply_out | grep -cE 'COMMIT')"; o2="$(apply_out | grep -cE 'COMMIT')"
  if [ "$o1" = "1" ] && [ "$o2" = "1" ]; then
    N=$((N+1)); printf '  ✅ %-2s %-26s 預期含[兩次都 COMMIT]\n        實得: 兩次皆 COMMIT(第二次不因「已經是那樣」誤紅)\n' "$N" "冪等(連跑兩次)"; PASS=$((PASS+1))
  else
    N=$((N+1)); echo "  ❌ $N 冪等失敗:第一次 COMMIT 數=$o1 第二次=$o2"; FAIL=$((FAIL+1))
  fi
  echo "  (⚠️ 冪等只證明『重跑不改狀態』,不證明『守得住』—— 它仍然要有人去跑。)"

  echo "───────────────────────────────────────────────"
  echo "PASS=$PASS  FAIL=$FAIL"
  [ "$FAIL" = "0" ] || exit 1
  ;;
selftest)
  # 🔴 **這支腳本自己也要能被驗**(主視窗驗收條件 3)。
  #    做法 = 對 migration 打兩發突變,斷言腳本**必須紅**,而且**紅在預期的地方**。
  #    ⚠️ **還原用 `cp` 不用 `git checkout`** —— checkout 會把突變與實作一起收掉,
  #       後續的「紅」變成「實作不見了」= 假紅(2026-08-14 E 窗實錘)。
  BK="$WORK/d0-selftest-backup.sql"
  cp "$MIG" "$BK" || { echo "備份失敗"; exit 1; }
  restore() { cp "$BK" "$MIG"; }
  trap restore EXIT

  echo "── 突變 1:trigger 那格期望值 0 → 999(預期:**只有正控群 + 冪等紅**)──"
  perl -0pi -e "s/IF v_cnt <> 0 THEN\n    RAISE EXCEPTION .D0 異常 — admin_audit_log 掛了/IF v_cnt <> 999 THEN\n    RAISE EXCEPTION \x27D0 異常 — admin_audit_log 掛了/" "$MIG"
  M1OUT="$(bash "$0" run 2>&1)"
  echo "$M1OUT" | grep -E '❌|PASS=' | sed 's/^/    /'
  restore
  if echo "$M1OUT" | grep -q 'FAIL=0'; then
    echo "  ❌ 自我測試失敗:突變 1 之後腳本仍然全過 ⇒ **這支 harness 是恆綠的**"; exit 1
  fi
  echo "  ✅ 突變 1 讓腳本紅了 —— 紅的是**正控群 + 冪等**,而**那道負控完全沒反應**。"
  echo "     ⇒ 這就是排正控的理由:**負控抓不到自己壞掉**。"

  echo "── 突變 2:整格移除 trigger 檢查(預期:**「掛非內部 trigger」那道紅**)────"
  perl -0777 -pi -e 's/  SELECT count\(\*\) INTO v_cnt\n    FROM pg_catalog\.pg_trigger.*?END IF;/  -- (selftest 突變:整格移除)/s' "$MIG"
  M2OUT="$(bash "$0" run 2>&1)"
  echo "$M2OUT" | grep -E '❌|PASS=' | sed 's/^/    /'
  restore
  # 🔴 用**說明字串**判,不用 case 編號 —— 編號會隨插入 case 漂掉,說明不會。
  if ! echo "$M2OUT" | grep -q '❌.*掛非內部 trigger'; then
    echo "  ❌ 自我測試失敗:移除 trigger 守門之後那道沒紅 ⇒ **該格是恆綠格**"; exit 1
  fi
  echo "  ✅ 突變 2 讓「掛非內部 trigger」那道紅了 ⇒ 該格有判別力"

  echo "── 還原驗證(突變沒了 / 實作還在 / 重跑回到全過)────────────"
  M=$(grep -c 'selftest 突變\|IF v_cnt <> 999' "$MIG"); I=$(grep -c '非內部 trigger' "$MIG")
  echo "    突變殘留 = $M(該 0)   實作字面 = $I(該 >0)"
  [ "$M" = "0" ] && [ "$I" -gt 0 ] || { echo "  ❌ 還原不乾淨"; exit 1; }
  bash "$0" run 2>&1 | tail -2 | sed 's/^/    /'
  echo "✅ selftest 通過:這支 harness 不是恆綠的"
  ;;
*) echo "用法: bash scripts/27-d0-verify.sh {provision|run|selftest|teardown}"; exit 2;;
esac
