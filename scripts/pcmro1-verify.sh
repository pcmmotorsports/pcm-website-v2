#!/usr/bin/env bash
# ⟦b4-PCMRO1⟧ 驗證 harness —— 多個世界 + 兩發突變(數量當場數, 見檔尾;不寫死)。
# 🔴 v1 有一個【它自己就是實例】的 bug:突變沒咬到任何東西時 python assert 掛掉,
#    而後面那發 psql 讀到一支不存在的檔 ⇒ rc≠0 ⇒ 印【D PASS】。
#    ⇒ 「突變被斷言殺掉」與「突變根本沒發生」印同一個綠。⇒ v2 突變失敗一律 exit 2。
set -u
MIG="${1:-supabase/migrations/20260901230000_m4b_pcmro1_revoke_customer_pii.sql}"

# ── --selftest:不需要 postgres, 它只驗【這支 harness 的兩發突變還咬得到那支 migration】──
#    🔴 為什麼要它:突變的 anchor 是【字面】—— 有人改了那支 migration 的那一行,
#       突變就靜靜地不再咬到任何東西, 而 v1 那次的失敗形狀是【印 PASS】。
#    ⇒ 這一格接進 lint-staged, 不需要跑資料庫。
if [ "${1:-}" = "--selftest" ]; then
  MIG=supabase/migrations/20260901230000_m4b_pcmro1_revoke_customer_pii.sql
  RC=0
  [ -f "$MIG" ] || { echo "🔴 selftest:找不到 $MIG"; exit 2; }
  A1='AND pg_catalog.has_column_privilege(v_role, v_oid, att.attnum, '"'"'SELECT'"'"');'
  A2="'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',"
  grep -qF -- "$A1" "$MIG" && echo "✅ 突變1 的 anchor 還在" || { echo "🔴 突變1 的 anchor 【不見了】⇒ 那一發突變會靜靜地不咬任何東西"; RC=1; }
  grep -qF -- "$A2" "$MIG" && echo "✅ 突變2 的 anchor 還在" || { echo "🔴 突變2 的 anchor 【不見了】⇒ 那一發突變會靜靜地不咬任何東西"; RC=1; }
  ZZ='zzq_no_such_anchor_20260902'
  grep -qF -- "$ZZ" "$MIG" && { echo "🔴 負對照命中 ⇒ 這把尺壞了"; RC=1; } || echo "🟢 負對照 0(尺沒有亂命中)"
  echo "⚠️ 射程:本 selftest 只驗【anchor 在不在】, 不驗那支 migration 對不對 —— 那要跑全部世界(不帶參數即可, 它會當場數幾個)"
  exit $RC
fi
D=$(mktemp -d); PORT=$((5600 + RANDOM % 300))
export LC_ALL=C
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start > /dev/null 2>&1 || { echo "🔴 pg_ctl 失敗"; tail -5 "$D/pg.log"; exit 2; }
trap 'LC_ALL=C pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" -q -v ON_ERROR_STOP=1 "${@:2}"; }
T() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d w -tAc "$1"; }
FAILED=0
SQ="'"

seed() {  # $1 role? $2 tablegrant? $3 colgrant? $4 publicgrant? $5 defacl?
  psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -q -c "DROP DATABASE IF EXISTS w" -c "CREATE DATABASE w" >/dev/null 2>&1
  P w -c "DROP ROLE IF EXISTS pcm_readonly" -c "DROP ROLE IF EXISTS service_role" >/dev/null 2>&1
  P w -c "CREATE ROLE service_role" \
      -c "CREATE TABLE public.customers(id int, birthday date, phone text, email text, gender text)" \
      -c "CREATE VIEW public.admin_customer_list_v AS SELECT * FROM public.customers" \
      -c "GRANT SELECT ON public.admin_customer_list_v TO service_role" >/dev/null 2>&1
  [ "$1" = y ] && P w -c "CREATE ROLE pcm_readonly" >/dev/null 2>&1
  [ "$2" = y ] && P w -c "GRANT SELECT ON public.admin_customer_list_v TO pcm_readonly" >/dev/null 2>&1
  [ "$3" = y ] && P w -c "GRANT SELECT (birthday, phone) ON public.admin_customer_list_v TO pcm_readonly" >/dev/null 2>&1
  [ "$4" = y ] && P w -c "GRANT SELECT ON public.admin_customer_list_v TO PUBLIC" >/dev/null 2>&1
  [ "$5" = y ] && P w -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO pcm_readonly" >/dev/null 2>&1
  return 0
}
run() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d w -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
check() { # $1 名 $2 期望rc(0|nonzero) $3 實際rc $4.. 額外條件字串
  local ok=1
  if [ "$2" = 0 ]; then [ "$3" = 0 ] || ok=0; else [ "$3" != 0 ] || ok=0; fi
  shift 3
  for c in "$@"; do eval "$c" || ok=0; done
  if [ $ok = 1 ]; then echo "  ✅ PASS"; else echo "  🔴 FAIL"; FAILED=1; fi
}
mutate() { # $1 out $2 old $3 new  —— 🔴 沒咬到就 exit 2, 不准往下跑
  python3 - "$MIG" "$1" "$2" "$3" <<'PY'
import sys
s=open(sys.argv[1],encoding='utf-8').read()
if sys.argv[3] not in s:
    print("🔴🔴 突變沒有咬到任何東西 ⇒ 這一發【不算數】, 整支 harness 停下"); sys.exit(2)
open(sys.argv[2],'w',encoding='utf-8').write(s.replace(sys.argv[3], sys.argv[4]))
PY
}

echo "== A 該收(表級 grant + 預設權限)=="
seed y y n n y; OUT=$(run "$MIG"); RC=$?
check A 0 $RC '[ "$(T "SELECT has_table_privilege(${SQ}pcm_readonly${SQ},${SQ}public.admin_customer_list_v${SQ},${SQ}SELECT${SQ})")" = f ]' \
              '[ "$(T "SELECT count(*) FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE d.defaclobjtype=${SQ}r${SQ} AND a.grantee=to_regrole(${SQ}pcm_readonly${SQ})")" = 0 ]'

echo "== B 負對照(角色在而全乾淨)⇒ 不炸, 且印【什麼都沒收】=="
seed y n n n n; OUT=$(run "$MIG"); RC=$?
check B 0 $RC 'echo "$OUT" | grep -q "本支【什麼都沒收】"'

echo "== C 角色不存在 ⇒ WARNING 跳過, 不炸 =="
seed n n n n n; OUT=$(run "$MIG"); RC=$?
check C 0 $RC 'echo "$OUT" | grep -q "pcm_readonly 不存在"'

echo "== E 欄級授權(relacl 看不到它)⇒ 必須被收掉 =="
seed y n y n n; OUT=$(run "$MIG"); RC=$?
check E 0 $RC 'echo "$OUT" | grep -q "已收欄級授權"' \
              '[ "$(T "SELECT count(*) FROM pg_attribute att, aclexplode(att.attacl) a WHERE att.attrelid=${SQ}public.admin_customer_list_v${SQ}::regclass AND a.grantee=to_regrole(${SQ}pcm_readonly${SQ})")" = 0 ]'

echo "== F PUBLIC 也有 SELECT ⇒ 收完仍讀得到 ⇒ 必須【紅】不是印綠 =="
seed y y n y n; OUT=$(run "$MIG"); RC=$?
check F nonzero $RC 'echo "$OUT" | grep -q "仍然讀得到"'

echo "== G PUBLIC 只在【一欄】上有 SELECT ⇒ 表級尺印 false 而它讀得到 ⇒ 必須紅 =="
seed y n n n n
P w -c "GRANT SELECT (birthday) ON public.admin_customer_list_v TO PUBLIC" >/dev/null 2>&1
OUT=$(run "$MIG"); RC=$?
check G nonzero $RC 'echo "$OUT" | grep -q "仍然讀得到"'

echo "== H 全域 default ACL(不帶 IN SCHEMA)⇒ 本支收不到 ⇒ 必須紅, 不准印綠 =="
seed y y n n n
P w -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO pcm_readonly" >/dev/null 2>&1
OUT=$(run "$MIG"); RC=$?
check H nonzero $RC 'echo "$OUT" | grep -q "全域"'

echo "== I 收之前有 SELECT+INSERT ⇒ 還原句必須印出【兩個都有】, 不是只印 SELECT =="
seed y n n n n
P w -c "GRANT SELECT, INSERT ON public.admin_customer_list_v TO pcm_readonly" >/dev/null 2>&1
OUT=$(run "$MIG"); RC=$?
check I 0 $RC 'echo "$OUT" | grep -q "還原表級:GRANT INSERT, SELECT"'

echo "== 突變1:把有效權限斷言換成永遠不成立 ⇒ 世界 F 必須從紅變綠(證明那道斷言是【它】在擋)=="
mutate "$D/m1.sql" 'AND pg_catalog.has_column_privilege(v_role, v_oid, att.attnum, '"'"'SELECT'"'"');' 'AND false;' || exit 2
seed y y n y n; OUT=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d w -v ON_ERROR_STOP=1 -f "$D/m1.sql" 2>&1); RC=$?
echo "  突變後世界 F 的 rc=$RC(要 0 —— 綠了才證明原本那個紅是這道斷言擋的)"
[ "$RC" = 0 ] && echo "  ✅ PASS" || { echo "  🔴 FAIL —— 拿掉它還是紅 ⇒ 擋住 F 的不是這道斷言"; FAILED=1; }

echo "== 突變2:拿掉 ALTER DEFAULT PRIVILEGES ⇒ 世界 A 必須紅 =="
mutate "$D/m2.sql" "'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I'," "'SELECT 1 /* %I %I */'," || exit 2
seed y y n n y; OUT=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d w -v ON_ERROR_STOP=1 -f "$D/m2.sql" 2>&1); RC=$?
echo "  突變後世界 A 的 rc=$RC(要非 0)"
[ "$RC" != 0 ] && echo "  ✅ PASS" || { echo "  🔴 FAIL —— 那個斷言是恆真的"; FAILED=1; }

echo "======================================"
# 🔴 這一行【當場數】, 不寫死 —— 上一版寫死「六個世界」, 而加到 8 個之後它還印六
N=$(grep -c '^check ' "$0")
echo "(本檔現有 check 世界 $N 個 + 突變 2 發 —— 當場數的, 不是寫死的)"
[ $FAILED = 0 ] && echo "🟢 全過" || echo "🔴 有紅"
exit $FAILED
