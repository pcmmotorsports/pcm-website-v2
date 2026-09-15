#!/usr/bin/env bash
# `20260915233000_m4b_p02a_bank_due_at_helper_and_manual_order_customer_lock.sql` 的行為驗證
#
# 要證的三句:
#   ① pcm_bank_transfer_due_at 跟逾期取消排程判的是同一個界
#      —— 日界兩種世界真跑排程;秒級的界跑「排程本體逐字、只把 now() 換成可設定的時鐘」的副本
#   ② admin_create_manual_order 建單前拿客人層級鎖:別人拿著同一把 ⇒ 它被那個連線擋住;它拿著 ⇒ 別人被它擋住;別的客人不被擋
#   ③ 回滾之後鎖不見(⇒ 被擋確實是本片造成的)、helper 不見、手動建單回到上一代;回滾前置閘擋得住「還有人呼叫 helper」
#
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema-only dump(Sean Q41 甲,零資料)。起法照
#       `~/pcm-mailbox/schema-dump-20260915/up.sh`;平台替身(角色 / auth.users / pg_cron 不自己跑)見那裡的 bootstrap.sql。
#
# 🛑 答不出什麼:
#   · 補登記收款那一側的鎖(下一片才有)。本檔用裸 pg_advisory_xact_lock 代替它 —— key 與 create_order 逐字同一個算法。
#   · 秒級那格的排程是「換了時鐘的副本」,不是正式那支;副本與原本的差別只有 now() 那幾處(格內核對替換次數,不是語意等價證明)。
#   · 效能、正式庫真實資料。
#
# 鎖的判準(codex DB1 R1 must-fix 2、R2 must-fix 1):不靠耗時、不靠全庫鎖數。
#   · 持鎖端 = 一條由本腳本經 fifo 控制的連線(application_name = p02a-holder),**本腳本送 COMMIT 之前它一定持有**。
#   · 鎖身分 = pg_locks 的 advisory 列、objsubid = 1、(classid<<32 | objid) = hashtextextended(客人 id::text, 0)。
#   · 被擋 = 受測連線(application_name = p02a-waiter)在那一把鎖上有未 granted 列,而且 pg_blocking_pids(受測) 含持鎖端 pid。
#   · 沒被擋 = 受測連線做完時,持鎖端仍 granted 持有那一把(它還沒收到 COMMIT)。
#   · 任何一發觀測 SQL 失敗、任一連線退出碼非 0、單沒建出來 ⇒ 該格回 error,不是 PASS。
#
# 用法:bash scripts/20260915233000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20260915233000_m4b_p02a_bank_due_at_helper_and_manual_order_customer_lock.sql"
DOWN="$REPO/supabase/rollbacks/20260915233000_down.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
test -f "$MIG" || { echo "ENV-FAIL:找不到 $MIG"; exit 3; }
test -f "$DOWN" || { echo "ENV-FAIL:找不到 $DOWN"; exit 3; }
test -f "$UP" || { echo "ENV-FAIL:找不到 $UP(正式庫 schema dump 起庫腳本)"; exit 3; }
NEW_MD5="$(sed -n "s/^-- 前置閘:admin_create_manual_order md5 = [0-9a-f]*(20260915170000)⇒ 升;= \([0-9a-f]\{32\}\)(本代).*/\1/p" "$MIG")"
[ ${#NEW_MD5} -eq 32 ] || { echo "ENV-FAIL:從 migration 檔頭讀不到本代 md5"; exit 3; }

WIN="v233-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"
ERRN="$(printf '%s\n' "$OUT" | sed -n 's/^套 dump 的 ERROR 行數 = \([0-9]*\).*/\1/p')"
D="/tmp/pcm-sd-$WIN"
TMPD="$(mktemp -d)"
cleanup() { exec 7>&- 2>/dev/null; pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D" "$TMPD"; }
trap cleanup EXIT
[ -n "$PORT" ] || { printf '%s\n' "$OUT"; echo "ENV-FAIL:讀不到埠"; exit 3; }
[ "$ERRN" = "0" ] || { echo "ENV-FAIL:套 dump 有 ERROR($ERRN 行)⇒ 世界不可信"; exit 3; }

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
P() { "${PSQL[@]}" "$@"; }
Q() { P -tA -c "$1"; }
# 觀測用:SQL 失敗時回非零,呼叫端必須接住(R2 must-fix 1:觀測失敗不得被當成「沒看到」)
Qx() { local o; o="$(P -tA -c "$1" 2>&1)" || return 1; printf '%s' "$o"; }
FAIL=0; N=0
cell() {
  N=$((N+1))
  if [ "$2" = "$3" ]; then printf '  PASS %-60s (%s)\n' "$1" "$2"
  else printf '  🔴 FAIL %-57s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi
}
uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
MANUAL_OID="'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text,text,jsonb)'::regprocedure"

CUST_A='11111111-1111-1111-1111-111111111111'
CUST_B='22222222-2222-2222-2222-222222222222'
P -c "
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('$CUST_A', 'p02a-a@example.test', '{}'::jsonb), ('$CUST_B', 'p02a-b@example.test', '{}'::jsonb);
INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES
  ('$CUST_A', 'p02a-a@example.test', '客人甲', '0912345678', 'general'),
  ('$CUST_B', 'p02a-b@example.test', '客人乙', '0912345679', 'general');
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_alice', '測試員小愛', true);
" >/dev/null || { echo "ENV-FAIL:種子資料寫不進去"; exit 3; }

# 建一張手動匯款單的 SQL(回傳欄位 $3)
mk_sql() {
  printf "SELECT public.admin_create_manual_order('%s'::uuid, '%s'::uuid, 'probe_alice', 'manual_phone', 'bank_transfer', 'home', '{\"name\":\"王小明\",\"phone\":\"0912000111\",\"line\":\"台北市測試路1號\"}'::jsonb, '{\"type\":\"personal\",\"requested\":false}'::jsonb, 100, '[{\"sku\":\"P02A\",\"title\":\"測試品\",\"qty\":1,\"unit_price\":100,\"spec\":{}}]'::jsonb) ->> '%s'" "$1" "$2" "$3"
}
key_sql() { printf "pg_catalog.hashtextextended('%s'::text, 0)" "$1"; }
lock_sql() {  # $1 application_name  $2 客人 id  $3 granted(true/false):那一把客人鎖上符合條件的列數
  printf "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.objsubid = 1 AND ((l.classid::bigint << 32) | l.objid::bigint) = %s AND a.application_name = '%s' AND l.granted = %s" "$(key_sql "$2")" "$1" "$3"
}
BLOCKED_SQL="SELECT count(*) FROM pg_stat_activity w, pg_stat_activity h WHERE w.application_name = 'p02a-waiter' AND h.application_name = 'p02a-holder' AND h.pid = ANY (pg_blocking_pids(w.pid))"

# 鎖探測。$1 = 持鎖端在 BEGIN 之後執行的一句(拿客人甲的鎖,或以客人甲建手動單)
#          $2 = 受測連線的一句  $3 = 預期訂單 +1 的客人  ⇒ 印 waited / not_waited / error:<原因>
probe() {
  local hold_stmt="$1" wsql="$2" ccust="$3" before hp wp hrc wrc i r st=none
  before="$(Qx "SELECT count(*) FROM public.orders WHERE customer_user_id = '$ccust'")" || { echo "error:觀測失敗(before)"; return; }
  rm -f "$TMPD/h.fifo"; mkfifo "$TMPD/h.fifo"
  PGAPPNAME=p02a-holder "${PSQL[@]}" -f "$TMPD/h.fifo" >"$TMPD/h.out" 2>&1 &
  hp=$!
  exec 7>"$TMPD/h.fifo"
  printf '%s\n' 'BEGIN;' "$hold_stmt;" >&7
  r=0
  for i in $(seq 1 50); do
    r="$(Qx "$(lock_sql p02a-holder "$CUST_A" true)")" || { r=obsfail; break; }
    [ "$r" = "1" ] && break
    sleep 0.1
  done
  if [ "$r" != "1" ]; then
    printf 'ROLLBACK;\n' >&7; exec 7>&-; wait "$hp"
    echo "error:持鎖端沒有拿到客人甲那一把鎖($r)"; return
  fi
  PGAPPNAME=p02a-waiter "${PSQL[@]}" -tA -c "$wsql" >"$TMPD/w.out" 2>&1 &
  wp=$!
  for i in $(seq 1 50); do
    if ! kill -0 "$wp" 2>/dev/null; then st=done; break; fi
    r="$(Qx "$BLOCKED_SQL")" || { st=obsfail; break; }
    if [ "$r" = "1" ]; then
      r="$(Qx "$(lock_sql p02a-waiter "$CUST_A" false)")" || { st=obsfail; break; }
      [ "$r" = "1" ] && { st=blocked; break; }
    fi
    sleep 0.1
  done
  if [ "$st" = "done" ]; then
    r="$(Qx "$(lock_sql p02a-holder "$CUST_A" true)")" || r=obsfail
    [ "$r" = "1" ] && st=done_while_held || st="done_but_holder_lock=$r"
  fi
  printf 'COMMIT;\n' >&7; exec 7>&-
  wait "$hp"; hrc=$?
  wait "$wp"; wrc=$?
  [ "$st" = "obsfail" ] && { echo "error:觀測 SQL 失敗"; return; }
  [ "$hrc" = "0" ] || { echo "error:持鎖端 rc=$hrc $(head -c 120 "$TMPD/h.out")"; return; }
  [ "$wrc" = "0" ] || { echo "error:受測連線 rc=$wrc $(head -c 120 "$TMPD/w.out")"; return; }
  r="$(Qx "SELECT count(*) FROM public.orders WHERE customer_user_id = '$ccust'")" || { echo "error:觀測失敗(after)"; return; }
  [ "$r" = "$((before + 1))" ] || { echo "error:訂單數 $before → $r(期望 +1)"; return; }
  case "$st" in
    blocked) echo waited ;;
    done_while_held) echo not_waited ;;
    *) echo "error:$st" ;;
  esac
}
BARE_LOCK_A="SELECT pg_advisory_xact_lock($(key_sql "$CUST_A"))"

echo "── ⓪ 本片之前(負對照:沒有鎖 ⇒ 不被擋)"
cell "上一代手動建單建得出來" "$(Q "$(mk_sql "$CUST_A" "$(uuid)" idempotent)")" "false"
cell "上一代:別人拿著客人甲的鎖,客人甲的手動建單不被擋" "$(probe "$BARE_LOCK_A" "$(mk_sql "$CUST_A" "$(uuid)" order_id)" "$CUST_A")" "not_waited"

echo "── ① 套本片(兩次:第二次走冪等)"
P -f "$MIG" >/dev/null 2>&1; cell "第一次套用 rc" "$?" "0"
P -f "$MIG" >/dev/null 2>&1; cell "第二次套用(冪等)rc" "$?" "0"
cell "手動建單是本代 md5" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid=$MANUAL_OID")" "$NEW_MD5"

echo "── ② helper 與排程判同一個界"
# ②a 日界兩種世界,真跑排程:台北「今天-5 天」與「今天-6 天」各 4 個時刻。
IDS=""
for back in 5 6; do
  for hm in '00:00:00' '00:01:00' '12:00:00' '23:59:59'; do
    oid="$(Q "$(mk_sql "$CUST_A" "$(uuid)" order_id)")"
    Q "UPDATE public.orders SET created_at = ((date_trunc('day', timezone('Asia/Taipei', now())) - interval '$back days' + time '$hm') AT TIME ZONE 'Asia/Taipei') WHERE id = '$oid'" >/dev/null
    IDS="$IDS'$oid',"
  done
done
IDS="${IDS%,}"
P -tA -c "SELECT pcm_cron.expire_unpaid_orders(500)" >/dev/null 2>&1; cell "②a 真排程呼叫 rc" "$?" "0"
cell "②a 真排程取消了 4 張(兩種世界都有)" "$(Q "SELECT count(*) FROM public.orders WHERE id IN ($IDS) AND cancelled_at IS NOT NULL")" "4"
cell "②a 8 張逐張:真排程取消與否 = helper 判已過界與否" "$(Q "SELECT count(*) FROM public.orders WHERE id IN ($IDS) AND (cancelled_at IS NOT NULL) = (public.pcm_bank_transfer_due_at(created_at) <= now())")" "8"
cell "②a 被取消的 4 張全是「今天-6 天」那一組" "$(Q "SELECT count(*) FROM public.orders WHERE id IN ($IDS) AND cancelled_at IS NOT NULL AND timezone('Asia/Taipei', created_at)::date = (timezone('Asia/Taipei', now())::date - 6)")" "4"

# ②b 秒級的界:排程本體逐字、只把 pg_catalog.now() 換成可設定的時鐘(codex DB1 R1 should-fix 2)
NOW_CALLS="$(Q "SELECT (length(prosrc) - length(replace(prosrc, 'pg_catalog.now()', ''))) / length('pg_catalog.now()') FROM pg_proc WHERE oid='pcm_cron.expire_unpaid_orders(integer)'::regprocedure")"
P -c "DO \$\$ BEGIN EXECUTE replace(replace(pg_get_functiondef('pcm_cron.expire_unpaid_orders(integer)'::regprocedure), 'pcm_cron.expire_unpaid_orders(', 'pcm_cron.expire_unpaid_orders_fakenow('), 'pg_catalog.now()', '(pg_catalog.current_setting(''p02a.now''))::timestamptz'); END \$\$;" >/dev/null 2>&1
cell "②b 換時鐘的排程副本建得出來" "$?" "0"
cell "②b 副本裡 now() 全換掉、換進去的次數 = 原本 now() 的次數" "$(Q "SELECT (strpos(prosrc, 'pg_catalog.now()') = 0)::text || '/' || ((length(prosrc) - length(replace(prosrc, 'p02a.now', ''))) / length('p02a.now'))::text FROM pg_proc WHERE oid='pcm_cron.expire_unpaid_orders_fakenow(integer)'::regprocedure")" "true/$NOW_CALLS"
cell "②b 原本 now() 至少出現一次(否則上一格恆真)" "$([ "${NOW_CALLS:-0}" -ge 1 ] && echo yes || echo no)" "yes"
SIDS=""
for ts in '2026-09-05 00:00:00+08' '2026-09-05 00:01:00+08' '2026-09-05 12:00:00+08' '2026-09-05 23:59:59+08' '2026-09-04 16:30:00+00'; do
  oid="$(Q "$(mk_sql "$CUST_A" "$(uuid)" order_id)")"
  Q "UPDATE public.orders SET created_at = '$ts'::timestamptz WHERE id = '$oid'" >/dev/null
  SIDS="$SIDS'$oid',"
done
SIDS="${SIDS%,}"
cell "②b 5 張(含 UTC 16:30 = 台北隔天 00:30)helper 算出同一個界" "$(Q "SELECT count(DISTINCT public.pcm_bank_transfer_due_at(created_at))::text || '/' || (min(public.pcm_bank_transfer_due_at(created_at)) = '2026-09-11 00:00:00+08'::timestamptz)::text FROM public.orders WHERE id IN ($SIDS)")" "1/true"
# 🔴 R2 must-fix 2:呼叫本身失敗時「0 張被取消」不得算 PASS ⇒ 先驗 rc 與回傳筆數,再驗取消結果
FAKE1="$(P -tA -c "SET p02a.now = '2026-09-10 23:59:59+08'; SELECT pcm_cron.expire_unpaid_orders_fakenow(500);" 2>&1)"; FAKE1_RC=$?
cell "②b 界前 1 秒那一發排程副本呼叫 rc" "$FAKE1_RC" "0"
cell "②b 時鐘 = 界前 1 秒 ⇒ 排程副本一張都不取消" "$(Q "SELECT count(*) FROM public.orders WHERE id IN ($SIDS) AND cancelled_at IS NOT NULL")" "0"
FAKE2="$(P -tA -c "SET p02a.now = '2026-09-11 00:00:00+08'; SELECT pcm_cron.expire_unpaid_orders_fakenow(500);" 2>&1)"; FAKE2_RC=$?
cell "②b 界上那一發排程副本呼叫 rc" "$FAKE2_RC" "0"
cell "②b 界上那一發回報的取消筆數 ≥ 5(副本真的有動作)" "$([ "${FAKE2:-0}" -ge 5 ] 2>/dev/null && echo yes || echo "no:$FAKE2")" "yes"
cell "②b 時鐘 = 界上 ⇒ 排程副本 5 張全取消(界上算逾期)" "$(Q "SELECT count(*) FROM public.orders WHERE id IN ($SIDS) AND cancelled_at IS NOT NULL")" "5"
P -c "DROP FUNCTION pcm_cron.expire_unpaid_orders_fakenow(integer);" >/dev/null
: "${FAKE1:=}"

echo "── ③ helper 權限"
H="'public.pcm_bank_transfer_due_at(timestamptz)'::regprocedure"
cell "anon 叫不到" "$(Q "SELECT has_function_privilege('anon', $H, 'EXECUTE')")" "f"
cell "authenticated 叫不到" "$(Q "SELECT has_function_privilege('authenticated', $H, 'EXECUTE')")" "f"
cell "service_role 叫不到" "$(Q "SELECT has_function_privilege('service_role', $H, 'EXECUTE')")" "f"
cell "owner postgres / INVOKER / STABLE" "$(Q "SELECT pg_get_userbyid(proowner)||'/'||prosecdef::text||'/'||provolatile::text FROM pg_proc WHERE oid=$H")" "postgres/false/s"
cell "service_role 實呼叫被拒" "$(P -tA -c "SET ROLE service_role; SELECT public.pcm_bank_transfer_due_at(now());" 2>&1 | grep -c 'permission denied')" "1"

echo "── ④ 手動建單照常 + 拿客人層級鎖"
K="$(uuid)"
cell "本代建單建得出來" "$(Q "$(mk_sql "$CUST_B" "$K" idempotent)")" "false"
cell "同鍵重送回冪等" "$(Q "$(mk_sql "$CUST_B" "$K" idempotent)")" "true"
cell "別人拿著客人甲的鎖 ⇒ 客人甲的手動建單被那個連線擋住" "$(probe "$BARE_LOCK_A" "$(mk_sql "$CUST_A" "$(uuid)" order_id)" "$CUST_A")" "waited"
cell "別人拿著客人甲的鎖 ⇒ 客人乙的手動建單不被擋" "$(probe "$BARE_LOCK_A" "$(mk_sql "$CUST_B" "$(uuid)" order_id)" "$CUST_B")" "not_waited"
cell "手動建單(客人甲)交易沒 commit ⇒ 客人甲的鎖被它擋住" "$(probe "$(mk_sql "$CUST_A" "$(uuid)" order_id)" "$BARE_LOCK_A" "$CUST_A")" "waited"
cell "手動建單(客人甲)交易沒 commit ⇒ 客人乙的鎖不被擋" "$(probe "$(mk_sql "$CUST_A" "$(uuid)" order_id)" "SELECT pg_advisory_xact_lock($(key_sql "$CUST_B"))" "$CUST_A")" "not_waited"

echo "── ⑤ 回滾"
P -c "CREATE FUNCTION public.zz_p02a_uses_helper() RETURNS timestamptz LANGUAGE sql AS \$f\$ SELECT public.pcm_bank_transfer_due_at(now()) \$f\$;" >/dev/null
cell "還有函式呼叫 helper ⇒ 回滾前置閘②擋下" "$(P -f "$DOWN" 2>&1 | grep -c '回滾前置閘②')" "1"
cell "被擋下之後手動建單仍是本代、helper 仍在" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid=$MANUAL_OID")/$(Q "SELECT to_regprocedure('public.pcm_bank_transfer_due_at(timestamptz)') IS NOT NULL")" "$NEW_MD5/t"
P -c "DROP FUNCTION public.zz_p02a_uses_helper();" >/dev/null
ATTR_Q="SELECT proacl::text||'|'||proconfig::text||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner) FROM pg_proc WHERE oid=$MANUAL_OID"
ATTR_BEFORE="$(Q "$ATTR_Q")"
P -f "$DOWN" >/dev/null 2>&1; cell "回滾 rc" "$?" "0"
cell "手動建單回到 20260915170000 那一代" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid=$MANUAL_OID")" "dc97e3eee72204f893fa95e8355e8f5b"
cell "回滾前後 ACL / proconfig / SECURITY DEFINER / owner 相同" "$(Q "$ATTR_Q")" "$ATTR_BEFORE"
cell "helper 不在" "$(Q "SELECT to_regprocedure('public.pcm_bank_transfer_due_at(timestamptz)') IS NULL")" "t"
cell "回滾後:別人拿著客人甲的鎖,客人甲的手動建單不被擋" "$(probe "$BARE_LOCK_A" "$(mk_sql "$CUST_A" "$(uuid)" order_id)" "$CUST_A")" "not_waited"

echo "── ⑥ 前置閘有判別力"
P -c "COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS 'p02a 只改 COMMENT';" >/dev/null
P -f "$MIG" >/dev/null 2>&1; cell "排程只改 COMMENT ⇒ 前置閘③放行(套用 rc)" "$?" "0"
P -f "$DOWN" >/dev/null 2>&1; cell "再回滾 rc" "$?" "0"
P -c "ALTER FUNCTION public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text,text,jsonb) SET lock_timeout = '9s';" >/dev/null
cell "手動建單多一個 SET 設定 ⇒ 前置閘①擋下" "$(P -f "$MIG" 2>&1 | grep -c '前置閘①:admin_create_manual_order 的 proconfig')" "1"
P -c "ALTER FUNCTION public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text,text,jsonb) RESET lock_timeout;" >/dev/null
P -c "CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS \$f\$ SELECT 0 \$f\$;" >/dev/null
cell "排程本體換了一代 ⇒ 前置閘③擋下" "$(P -f "$MIG" 2>&1 | grep -c '前置閘③')" "1"
cell "被擋下之後 helper 沒有建出來、手動建單仍是上一代" "$(Q "SELECT to_regprocedure('public.pcm_bank_transfer_due_at(timestamptz)') IS NULL")/$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid=$MANUAL_OID")" "t/dc97e3eee72204f893fa95e8355e8f5b"

echo
if [ "$FAIL" = "0" ]; then echo "✅ 20260915233000-verify:$N/$N PASS"; else echo "🔴 20260915233000-verify:有 FAIL"; fi
exit "$FAIL"
