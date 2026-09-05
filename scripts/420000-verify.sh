#!/usr/bin/env bash
# scripts/420000-verify.sh —— 五世界驗 20260905420000(pcm_incident.kind 加一值)
set -u
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
R=/Users/sean_1/pcm-wt-db
M36=$R/supabase/migrations/20260905290000_m4b_pending_refund_open_failure_incident.sql
M42=$R/supabase/migrations/20260905420000_m4b_pcm_incident_kind_add_refund_over_total.sql
D=$(mktemp -d /tmp/v420.XXXXXX)
cleanup(){ [ -n "${PG:-}" ] && pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
SENT="v420_$$_$(date +%s)"; PG=""
for c in $(seq 54450 54500); do [ ! -S "/tmp/.s.PGSQL.$c" ] && PG=$c && break; done
[ -n "$PG" ] || { echo "🔴 沒有空 port ⇒ ENV-FAIL"; exit 2; }
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 起不來 ⇒ ENV-FAIL"; exit 2; }
for i in $(seq 1 10); do psql -h /tmp -p $PG -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 && break; done
psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE TABLE public.__s(v text); INSERT INTO public.__s VALUES ('$SENT');" >/dev/null 2>&1
[ "$(psql -h /tmp -p $PG -U postgres -d postgres -tAc 'SELECT v FROM public.__s' 2>&1)" = "$SENT" ] || { echo "🔴 哨兵不符 ⇒ ENV-FAIL"; exit 2; }
DDIR=$(psql -h /tmp -p $PG -U postgres -d postgres -tAc 'SHOW data_directory')
case "$DDIR" in "$D/pg"*) : ;; *) echo "🔴 data_directory 不是我的 ⇒ ENV-FAIL"; exit 2;; esac
printf '  🔵 叢集自證:port=%s · data_directory=%s · 哨兵相符\n' "$PG" "$DDIR"

Q(){ psql -h /tmp -p $PG -U postgres -d "$1" -tAc "$2" 2>&1; }
FAIL=0
# 只造出 pcm_incident 那張表與 CHECK(不跑整支 290000 —— 它還要覆蓋一支我這裡沒有的函式)
base(){
  psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE DATABASE $1" >/dev/null 2>&1
  psql -h /tmp -p $PG -U postgres -d "$1" -q >/dev/null 2>&1 <<'B'
CREATE TABLE public.pcm_incident (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('pending_refund_open_failed')),
  subject_id uuid, detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz);
-- 🔴 codex must-fix ④:原版手造的是【空表】⇒ migration 若誤刪同名 detail 的列, 腳本照樣 PASS。
--    ⇒ 種兩列既有事故(其中一列的 detail **故意與事後閘正對照那句一模一樣**)。
INSERT INTO public.pcm_incident(kind, detail) VALUES
  ('pending_refund_open_failed', '既有事故甲'),
  ('pending_refund_open_failed', 'after-check 正對照, 同一個 DO 裡刪掉');
B
}

echo "=== ① 貼之前:新值寫不進去(先證明這個世界是真的) ==="
base w_pre
PRE=$(Q w_pre "INSERT INTO public.pcm_incident(kind,detail) VALUES ('refund_over_total','x')")
echo "$PRE" | grep -q 'violates check constraint' \
  && printf '  ✅ 貼前寫不進去(check constraint 命中)\n' \
  || { printf '  🔴 貼前就寫得進去 ⇒ 這個世界沒造出來, 後面的綠沒有意義 (ENV-FAIL)\n     %s\n' "$PRE"; exit 2; }

echo
echo "=== ② 貼上去 ⇒ 新值寫得進去, 而【不在集合裡的】仍然擋得住 ==="
base w_post
psql -h /tmp -p $PG -U postgres -d w_post -v ON_ERROR_STOP=1 -f "$M42" >"$D/post.log" 2>&1
RC=$?
printf '  migration rc=%s(期望 0)\n' "$RC"
[ "$RC" -eq 0 ] || { grep -m1 ERROR "$D/post.log" | sed 's/^/     /'; FAIL=1; }
grep NOTICE "$D/post.log" | sed 's/^/     /'
# 🔵 `psql -tAc` 對 `INSERT … RETURNING` 會同時印【值】與【命令標籤 INSERT 0 1】
#    ⇒ 只取第一行才是那個值。(2026-09-05 實測:不取就會拿到「refund_over_total\nINSERT 0 1」而假紅。)
NEW=$(Q w_post "INSERT INTO public.pcm_incident(kind,detail) VALUES ('refund_over_total','正對照') RETURNING kind" | head -1)
printf '  新值寫入結果:%s(期望 refund_over_total)\n' "$NEW"; [ "$NEW" = refund_over_total ] || FAIL=1
OLD=$(Q w_post "INSERT INTO public.pcm_incident(kind,detail) VALUES ('pending_refund_open_failed','舊值仍要可用') RETURNING kind" | head -1)
printf '  舊值仍可用:%s(期望 pending_refund_open_failed)\n' "$OLD"; [ "$OLD" = pending_refund_open_failed ] || FAIL=1
KEEP=$(Q w_post "SELECT count(*) FROM public.pcm_incident WHERE detail IN ('既有事故甲','after-check 正對照, 同一個 DO 裡刪掉')")
printf '  貼後既有兩列還在:%s(期望 2 —— 事後閘的正對照不可以誤刪它們)\n' "$KEEP"
[ "$KEEP" = 2 ] || { printf '  🔴 事後閘的探針把既有事故刪掉了\n'; FAIL=1; }
BAD=$(Q w_post "INSERT INTO public.pcm_incident(kind,detail) VALUES ('__不在集合裡__','負對照')")
echo "$BAD" | grep -q 'violates check constraint' \
  && printf '  ✅ 負對照:不在集合裡的仍被擋\n' \
  || { printf '  🔴 封閉集破了:%s\n' "$BAD"; FAIL=1; }

echo
echo "=== ③ 冪等:再跑一次 ⇒ 綠並印「已經做過了」 ==="
# 🔴 codex must-fix ③:原版只驗 rc=0 與 NOTICE ⇒ 📌 **第二次若真的重做 DDL、甚至把第三種 kind
#    移掉, 這一格照樣 PASS。** ⇒ 再比【約束定義】與【列數】前後。
DEF_B=$(Q w_post "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('public.pcm_incident') AND conname='pcm_incident_kind_check'")
CNT_B=$(Q w_post "SELECT count(*) FROM public.pcm_incident")
psql -h /tmp -p $PG -U postgres -d w_post -v ON_ERROR_STOP=1 -f "$M42" >"$D/again.log" 2>&1
ARC=$?
DEF_A=$(Q w_post "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('public.pcm_incident') AND conname='pcm_incident_kind_check'")
CNT_A=$(Q w_post "SELECT count(*) FROM public.pcm_incident")
printf '  rc=%s(期望 0)· 約束前後相同:%s · 列數 %s ⇒ %s\n' "$ARC" \
  "$([ "$DEF_B" = "$DEF_A" ] && echo 是 || echo 🔴否)" "$CNT_B" "$CNT_A"
if [ "$ARC" -eq 0 ] && grep -q '已經做過了' "$D/again.log" \
   && [ "$DEF_B" = "$DEF_A" ] && [ "$CNT_B" = "$CNT_A" ]; then
  printf '  ✅ 冪等:綠 · 說得出理由 · 約束一個字沒動 · 一列都沒少\n'
else printf '  🔴 冪等這一格不成立\n'; grep -m1 ERROR "$D/again.log" | sed 's/^/     /'; FAIL=1; fi

echo
echo "=== ④ 前置閘要擋得住:約束被人動過的世界 ==="
base w_tamper
psql -h /tmp -p $PG -U postgres -d w_tamper -qc \
  "ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check; ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check CHECK (kind IN ('pending_refund_open_failed','別人加的'));" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_tamper -v ON_ERROR_STOP=1 -f "$M42" >"$D/tamper.log" 2>&1
TRC=$?
printf '  rc=%s(期望非 0)\n' "$TRC"
if [ "$TRC" -ne 0 ] && grep -q '前置閘' "$D/tamper.log"; then printf '  ✅ 紅在前置閘\n'; grep -m1 '前置閘' "$D/tamper.log" | sed 's/^/     /'
else printf '  🔴 沒擋住或紅在別的地方\n'; grep -m1 ERROR "$D/tamper.log" | sed 's/^/     /'; FAIL=1; fi

echo
echo "=== ⑤ 約束整個被拿掉的世界 ⇒ 也要擋(不可以靜靜補一個回去) ==="
base w_gone
psql -h /tmp -p $PG -U postgres -d w_gone -qc "ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_gone -v ON_ERROR_STOP=1 -f "$M42" >"$D/gone.log" 2>&1
GRC=$?
printf '  rc=%s(期望非 0)\n' "$GRC"
if [ "$GRC" -ne 0 ] && grep -q '前置閘②' "$D/gone.log"; then printf '  ✅ 紅在前置閘②(有人拿掉了封閉集)\n'; grep -m1 '前置閘②' "$D/gone.log" | sed 's/^/     /'
else printf '  🔴 沒擋住\n'; grep -m1 -E 'ERROR|NOTICE' "$D/gone.log" | sed 's/^/     /'; FAIL=1; fi

printf '\n%s 420000-verify %s\n' "$([ $FAIL -eq 0 ] && echo ✅ || echo 🔴)" "$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
exit $FAIL
