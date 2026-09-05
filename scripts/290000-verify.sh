#!/usr/bin/env bash
# scripts/290000-verify.sh —— 兩世界驗 20260905290000
#   🔴 為什麼要它:`migrations-replay-from-zero.sh` 對本片【零判別力】——
#      上游 20260905070000 在那個環境先失敗 ⇒ pcm_noncard_settle_recompute 從沒建出來
#      ⇒ 本片的前置閘⓪ 正確拒絕 ⇒ 那個紅**不是本片的紅**, 而它與真的壞掉印同一件事。
#   ⇒ 本支自己造出「函式就是正式庫那一版」的世界, 再看本片過不過。
set -u
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
R=/Users/sean_1/pcm-wt-db
MIG=$R/supabase/migrations/20260905290000_m4b_pending_refund_open_failure_incident.sql
SRC=$R/supabase/migrations/20260905070000_m4b_pending_refund_on_late_payment.sql
D=$(mktemp -d /tmp/v290.XXXXXX)
cleanup(){ [ -n "${PG:-}" ] && pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT

# 🔴 codex must-fix M8:原版寫死 PG=54329。/tmp 上若已經有【別人的】叢集在那個 port,
#    `pg_ctl start` 會失敗而我忽略了 rc, 然後 readiness 那一發**連上別人的伺服器** ——
#    ⇒ 📌 之後建角色、建資料庫、跑 migration 全部落在別人的庫上, 而輸出看起來完全正常。
#    ⇒ 兩件事一起修:①挑一個沒人用的 port ②起完之後**驗那是不是我這一座**(哨兵值)。
SENTINEL="v290_$$_$(date +%s)"
PG=""
for c in $(seq 54330 54380); do
  if [ ! -S "/tmp/.s.PGSQL.$c" ]; then PG=$c; break; fi
done
[ -n "$PG" ] || { echo "🔴 54330-54380 全被佔 ⇒ ENV-FAIL"; exit 2; }

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb 失敗 ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 \
  || { echo "🔴 pg_ctl start 失敗 ⇒ ENV-FAIL(這一格原本被忽略, 見上方 M8)"; cat "$D/pg.log"; exit 2; }
for i in 1 2 3 4 5 6 7 8 9 10; do psql -h /tmp -p $PG -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 && break; done
psql -h /tmp -p $PG -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 || { echo "🔴 起不來 ⇒ ENV-FAIL"; exit 2; }
# 哨兵:在【我剛 initdb 的那座】寫一個只有我知道的值, 再從連線讀回來。
# 🔵 若我連到的是別人的叢集, 那個值不會在(它的 data dir 不是我這個 $D/pg)。
psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE TABLE public.__v290_sentinel(v text); INSERT INTO public.__v290_sentinel VALUES ('$SENTINEL');" >/dev/null 2>&1
GOT=$(psql -h /tmp -p $PG -U postgres -d postgres -tAc "SELECT v FROM public.__v290_sentinel" 2>&1)
[ "$GOT" = "$SENTINEL" ] || { echo "🔴 哨兵不符(得到 '$GOT')⇒ 我連到的可能不是自己那一座 ⇒ ENV-FAIL"; exit 2; }
DATADIR=$(psql -h /tmp -p $PG -U postgres -d postgres -tAc "SHOW data_directory" 2>&1)
case "$DATADIR" in "$D/pg"*) : ;; *) echo "🔴 data_directory=$DATADIR 不是我的 $D/pg ⇒ ENV-FAIL"; exit 2;; esac
printf '  🔵 叢集自證:port=%s · data_directory=%s · 哨兵相符\n' "$PG" "$DATADIR"

Q(){ psql -h /tmp -p $PG -U postgres -d "$1" -tAc "$2" 2>&1; }

# 抽出正式庫那一版的函式定義(程式化, 不手抄)
python3 - "$SRC" "$D/fn.sql" <<'PY'
import io,re,sys,hashlib
s=io.open(sys.argv[1],encoding='utf-8').read()
i=s.index('CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute')
m=re.search(r'AS \$([a-zA-Z]*)\$(.*?)\$\1\$', s[i:], re.S)
body=m.group(2)
assert hashlib.md5(body.encode()).hexdigest()=='8353cf70f0121ea3d361ee2d5031dba5'
io.open(sys.argv[2],'w',encoding='utf-8').write(
  "CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)\n"
  "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO ''\n"
  "AS $fn$"+body+"$fn$;\n")
PY

world(){  # $1=db名 $2=要不要竄改函式 $3=期望 rc
  psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE DATABASE $1" >/dev/null 2>&1
  psql -h /tmp -p $PG -U postgres -d "$1" -q >/dev/null 2>&1 <<'ROLES'
DO $$ BEGIN
  PERFORM 1; 
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='payment_confirmer') THEN CREATE ROLE payment_confirmer NOLOGIN; END IF;
END $$;
ROLES
  # 那份本體的 DECLARE 用到 public.payment_status ⇒ 先造它。
  # 🔵 值不是我編的:2026-09-05 從正式庫 pg_enum 逐字抓的
  #    (unpaid,paid,partiallyPaid,refunded,partiallyRefunded)。
  # ⚠️ 本尺只需要【型別存在】—— 值錯不會讓建函式失敗, 但寫錯就不是同一個世界了, 所以照抄。
  psql -h /tmp -p $PG -U postgres -d "$1" -qc \
    "DO \$\$ BEGIN IF to_regtype('public.payment_status') IS NULL THEN CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded'); END IF; END \$\$;" >/dev/null 2>&1
  psql -h /tmp -p $PG -U postgres -d "$1" -q -v ON_ERROR_STOP=1 -f "$D/fn.sql" >"$D/$1.fn.log" 2>&1 \
    || { echo "🔴 $1:連基準函式都建不起來 ⇒ 本尺自己壞了 (exit 2)"; cat "$D/$1.fn.log"; exit 2; }
  if [ "$2" = tamper ]; then
    psql -h /tmp -p $PG -U postgres -d "$1" -qc \
      "CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS \$fn\$ BEGIN RAISE NOTICE '別人改過的一版'; END; \$fn\$;" >/dev/null 2>&1
  fi
  psql -h /tmp -p $PG -U postgres -d "$1" -v ON_ERROR_STOP=1 -f "$MIG" >"$D/$1.log" 2>&1
  RC=$?
  if [ "$RC" -eq "$3" ]; then M=✅; else M=🔴; FAIL=1; fi
  printf '  %s %-34s 期望 rc=%s 實得 rc=%s\n' "$M" "$4" "$3" "$RC"
}

FAIL=0
printf '=== 兩世界 ===\n'
world w_ok    keep   0 "① 函式就是正式庫那一版 ⇒ 過"
world w_bad   tamper 3 "② 函式被別人改過 ⇒ 前置閘⓪ 擋"

printf '\n=== ① 那個世界裡, 事後閘印了什麼 ===\n'
grep -E 'NOTICE|ERROR' "$D/w_ok.log" | sed 's/^/  /'

printf '\n=== ② 是不是【紅在前置閘⓪】(紅不等於守到) ===\n'
grep -m1 'ERROR' "$D/w_bad.log" | sed 's/^/  /'
grep -q '前置閘⓪' "$D/w_bad.log" || { printf '  🔴 紅在別的地方 ⇒ 這一格不算證\n'; FAIL=1; }

printf '\n=== ① 世界的實測:留痕真的寫得進去嗎(不是只看函式裡有那個字)===\n'
Q w_ok "SELECT public.pcm_incident_log('pending_refund_open_failed', NULL, '實測留痕')"  >/dev/null
N=$(Q w_ok "SELECT count(*) FROM public.pcm_incident WHERE detail='實測留痕'")
printf '  寫入後列數 = %s(期望 1)\n' "$N"; [ "$N" = 1 ] || FAIL=1
H=$(Q w_ok "SELECT public.get_pcm_incident_health()")
printf '  讀出口回傳 = %s\n' "$H"
echo "$H" | grep -q '"open_total": *1' || { printf '  🔴 讀出口沒把那一列算進去\n'; FAIL=1; }
echo "$H" | grep -q '實測留痕' && { printf '  🔴 讀出口把 detail 漏出去了(它該零 PII)\n'; FAIL=1; }
BAD=$(Q w_ok "INSERT INTO public.pcm_incident(kind,detail) VALUES ('不在封閉集','x')")
echo "$BAD" | grep -q 'violates check constraint' || { printf '  🔴 封閉集擋不住\n'; FAIL=1; }
printf '  封閉集負對照:%s\n' "$(echo "$BAD" | head -1)"
A=$(Q w_ok "SELECT has_table_privilege('anon','public.pcm_incident','SELECT')")
printf '  anon 讀得到嗎 = %s(期望 f)\n' "$A"; [ "$A" = f ] || FAIL=1


# ══ 🔴 codex must-fix M9:上面每一格都只是【直接呼叫 logger】—— handler 那條路一次都沒走。
#    ⇒ 把 migration 裡那一行 `PERFORM public.pcm_incident_log(...)` 拿掉、只留註解裡的函式名,
#      原版的事後閘⑤ 照樣過(它用 strpos 找字面, 而註解也是字面)。
#    ⇒ 📌 「檔案裡有那個字」與「那一行會被執行」是兩件事。
#    ✅ 這一格是**突變測試**:餵一份被拿掉那一行的 migration, 事後閘⑤ **必須紅**。
printf '\n=== ③ 突變:把留痕那一行拿掉(只留註解)⇒ 事後閘⑤ 必須紅 ===\n'
python3 - "$MIG" "$D/mutant.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
LINE="        PERFORM public.pcm_incident_log('pending_refund_open_failed', p_order_id, v_err);"
assert s.count(LINE)==1, '突變錨不唯一 ⇒ 這個突變本身沒接上'
# 只把【碼】那一行變成註解 —— 註解裡的 `pcm_incident_log` 字面【留著】,
# 那正是要證明「字面存在 != 呼叫存在」。
io.open(sys.argv[2],'w',encoding='utf-8').write(s.replace(LINE, "        -- 突變:原本這裡是 PERFORM public.pcm_incident_log(...) 的呼叫"))
PY
psql -h /tmp -p $PG -U postgres -qc "CREATE DATABASE w_mut" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_mut -q >/dev/null 2>&1 <<'ROLES2'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='payment_confirmer') THEN CREATE ROLE payment_confirmer NOLOGIN; END IF;
END $$;
ROLES2
psql -h /tmp -p $PG -U postgres -d w_mut -qc \
  "DO \$\$ BEGIN IF to_regtype('public.payment_status') IS NULL THEN CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded'); END IF; END \$\$;" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_mut -q -v ON_ERROR_STOP=1 -f "$D/fn.sql" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_mut -v ON_ERROR_STOP=1 -f "$D/mutant.sql" >"$D/w_mut.log" 2>&1
MRC=$?
if [ "$MRC" -ne 0 ] && grep -q '事後閘⑤' "$D/w_mut.log"; then
  printf '  ✅ 突變被抓到, 而且紅在事後閘⑤(rc=%s)\n' "$MRC"
  grep -m1 '事後閘⑤' "$D/w_mut.log" | sed 's/^/     /'
else
  printf '  🔴 突變【沒有】被抓到(rc=%s)⇒ 事後閘⑤ 對這個病沒有判別力\n' "$MRC"
  grep -m1 'ERROR' "$D/w_mut.log" | sed 's/^/     /'
  FAIL=1
fi

# ══ 🔴 codex must-fix M10:原版只驗 anon 對【表】的 SELECT。
#    ⇒ 預設權限可能把函式 EXECUTE / sequence 權限發給別的角色, 而那一格看不到。
#    ⇒ 改成斷言【授權對象的完整名單】—— 那是封閉的, 列舉「誰不該有」不是。
printf '\n=== ④ 四個物件的授權對象名單(封閉斷言, 不是列舉黑名單)===\n'
for spec in \
  "表|SELECT COALESCE(string_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee)::text,'PUBLIC'),','),'(空)') FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass('public.pcm_incident')|postgres" \
  "序列|SELECT COALESCE(string_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee)::text,'PUBLIC'),','),'(空)') FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) a WHERE c.oid=to_regclass('public.pcm_incident_id_seq')|postgres" \
  "寫入口|SELECT COALESCE(string_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee)::text,'PUBLIC'),','),'(空)') FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.pcm_incident_log(text, uuid, text)')|postgres" \
  "讀出口|SELECT COALESCE(string_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee)::text,'PUBLIC'),','),'(空)') FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.get_pcm_incident_health()')|postgres,service_role" ; do
  NAME=${spec%%|*}; REST=${spec#*|}; SQL=${REST%|*}; WANT=${REST##*|}
  GOT=$(Q w_ok "$SQL")
  if [ "$GOT" = "$WANT" ]; then printf '  ✅ %-6s 授權對象 = %s\n' "$NAME" "$GOT"
  else printf '  🔴 %-6s 授權對象 = %s(期望 %s)\n' "$NAME" "$GOT" "$WANT"; FAIL=1; fi
done
# 負對照:這把尺分得開嗎 —— 故意多給一個, 名單必須變
psql -h /tmp -p $PG -U postgres -d w_ok -qc "GRANT EXECUTE ON FUNCTION public.get_pcm_incident_health() TO anon" >/dev/null 2>&1
GOT=$(Q w_ok "SELECT COALESCE(string_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee)::text,'PUBLIC'),','),'(空)') FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.get_pcm_incident_health()')")
if [ "$GOT" = "anon,postgres,service_role" ]; then printf '  ✅ 負對照:多給 anon 之後名單變成 %s ⇒ 這把尺是活的\n' "$GOT"
else printf '  🔴 負對照:多給 anon 之後名單是 %s ⇒ 這把尺沒有判別力\n' "$GOT"; FAIL=1; fi

printf '\n%s 290000-verify %s\n' "$([ $FAIL -eq 0 ] && echo ✅ || echo 🔴)" "$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
exit $FAIL
