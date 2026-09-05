#!/usr/bin/env bash
# scripts/350000-verify.sh —— 兩世界驗 20260905350000(ADP 改預設)
#   🔴 靜態檢查六道全過而【不驗行為】—— 這一支證的是「新表出生時到底帶不帶那四種」。
set -u
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
MIG=/Users/sean_1/pcm-wt-db/supabase/migrations/20260905350000_m4b_adp_revoke_service_role_residual_on_tables.sql
D=$(mktemp -d /tmp/v350.XXXXXX)
cleanup(){ [ -n "${PG:-}" ] && pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
SENT="v350_$$_$(date +%s)"; PG=""
for c in $(seq 54390 54440); do [ ! -S "/tmp/.s.PGSQL.$c" ] && PG=$c && break; done
[ -n "$PG" ] || { echo "🔴 沒有空 port ⇒ ENV-FAIL"; exit 2; }
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 起不來 ⇒ ENV-FAIL"; cat "$D/pg.log"; exit 2; }
for i in $(seq 1 10); do psql -h /tmp -p $PG -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 && break; done
psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE TABLE public.__s(v text); INSERT INTO public.__s VALUES ('$SENT');" >/dev/null 2>&1
[ "$(psql -h /tmp -p $PG -U postgres -d postgres -tAc 'SELECT v FROM public.__s' 2>&1)" = "$SENT" ] \
  || { echo "🔴 哨兵不符 ⇒ 可能連到別人那座 ⇒ ENV-FAIL"; exit 2; }
DDIR=$(psql -h /tmp -p $PG -U postgres -d postgres -tAc 'SHOW data_directory')
case "$DDIR" in "$D/pg"*) : ;; *) echo "🔴 data_directory=$DDIR 不是我的 ⇒ ENV-FAIL"; exit 2;; esac
printf '  🔵 叢集自證:port=%s · data_directory=%s · 哨兵相符\n' "$PG" "$DDIR"

Q(){ psql -h /tmp -p $PG -U postgres -d "$1" -tAc "$2" 2>&1; }
FAIL=0
setup(){  # 造出與正式庫同形狀的那一列預設權限
  psql -h /tmp -p $PG -U postgres -d postgres -qc "CREATE DATABASE $1" >/dev/null 2>&1
  psql -h /tmp -p $PG -U postgres -d "$1" -q >/dev/null 2>&1 <<'R'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN SUPERUSER; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO service_role;
R
  # supabase_admin 那三列(本片不該動到它們)
  psql -h /tmp -p $PG -U postgres -d "$1" -q >/dev/null 2>&1 <<'R2'
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role, anon, authenticated;
R2
  # 一張【貼之前】就存在的表 —— 用來驗零追溯
  psql -h /tmp -p $PG -U postgres -d "$1" -qc "CREATE TABLE public.before_t(id int);" >/dev/null 2>&1
}

echo "=== 世界①:貼【之前】新建的表, 應該自帶那四種(先證明這個世界是真的) ==="
setup w_before
psql -h /tmp -p $PG -U postgres -d w_before -qc "CREATE TABLE public.probe_pre(id int);" >"$D/probe_pre.log" 2>&1 \
  || { echo "  🔴 probe_pre 建不出來 ⇒ ENV-FAIL"; cat "$D/probe_pre.log"; exit 2; }
PRE=$(Q w_before "SELECT COALESCE(string_agg(a.privilege_type,',' ORDER BY a.privilege_type),'(空)') FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid=to_regclass('public.probe_pre') AND a.grantee=to_regrole('service_role')")
printf '  貼前新表 service_role 拿到:%s\n' "$PRE"
[ "$PRE" = "MAINTAIN,REFERENCES,TRIGGER,TRUNCATE" ] || { echo "  🔴 這個世界沒造出來 ⇒ 後面的綠沒有意義 (ENV-FAIL)"; exit 2; }

echo
echo "=== 世界②:貼上去 ⇒ 之後新建的表【不可以】再拿到 ==="
setup w_after
psql -h /tmp -p $PG -U postgres -d w_after -v ON_ERROR_STOP=1 -f "$MIG" >"$D/after.log" 2>&1
RC=$?
printf '  migration rc=%s(期望 0)\n' "$RC"; [ "$RC" -eq 0 ] || { grep -m1 ERROR "$D/after.log" | sed 's/^/     /'; FAIL=1; }
grep -E 'NOTICE' "$D/after.log" | sed 's/^/     /'
# 🔴 codex must-fix ④:原版把建表的錯誤丟掉 ⇒ 表沒建成 ⇒ `to_regclass` 回 NULL
#    ⇒ 聚合仍回「(空)」⇒ 📌 **「探針不存在」被讀成「撤權成功」。**
psql -h /tmp -p $PG -U postgres -d w_after -qc "CREATE TABLE public.probe_post(id int);" >"$D/probe_post.log" 2>&1 \
  || { echo "  🔴 probe_post 建不出來 ⇒ 這一格沒有分母 (ENV-FAIL)"; cat "$D/probe_post.log"; exit 2; }
[ "$(Q w_after "SELECT to_regclass('public.probe_post') IS NOT NULL")" = t ] \
  || { echo "  🔴 probe_post 不存在 ⇒ 下面那個「(空)」不算數 (ENV-FAIL)"; exit 2; }
POST=$(Q w_after "SELECT COALESCE(string_agg(a.privilege_type,',' ORDER BY a.privilege_type),'(空)') FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid=to_regclass('public.probe_post') AND a.grantee=to_regrole('service_role')")
printf '  貼後新表 service_role 拿到:%s(期望「(空)」)\n' "$POST"
[ "$POST" = "(空)" ] || { echo "  🔴 那一行沒生效"; FAIL=1; }

echo
echo "=== ③ 零追溯:貼之前就存在的那張表, 權限【一格都不可以變】 ==="
OLD=$(Q w_after "SELECT COALESCE(string_agg(a.privilege_type,',' ORDER BY a.privilege_type),'(空)') FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid=to_regclass('public.before_t') AND a.grantee=to_regrole('service_role')")
printf '  貼前既有表仍是:%s(期望四種都在 —— 這是【預期】不是失敗)\n' "$OLD"
[ "$OLD" = "MAINTAIN,REFERENCES,TRIGGER,TRUNCATE" ] || { echo "  🔴 它變了 ⇒ ADP 竟然追溯了"; FAIL=1; }

echo
echo "=== ④ 負對照:supabase_admin 那三列不可以被動到 ==="
# 🔴 codex must-fix ⑤:原版只數列數 ⇒ 內容被改而列數不變 ⇒ 照樣 PASS。**數量不是內容。**
SA=$(Q w_after "SELECT COALESCE(string_agg(d.defaclobjtype::text||'='||array_to_string(d.defaclacl,','),' || ' ORDER BY d.defaclobjtype),'(無)') FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' AND d.defaclrole=to_regrole('supabase_admin')")
SB=$(Q w_before "SELECT COALESCE(string_agg(d.defaclobjtype::text||'='||array_to_string(d.defaclacl,','),' || ' ORDER BY d.defaclobjtype),'(無)') FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' AND d.defaclrole=to_regrole('supabase_admin')")
if [ "$SA" = "$SB" ]; then printf '  ✅ supabase_admin 三列【內容】與未貼那個庫逐字相同\n'
else printf '  🔴 內容變了\n     貼後 %s\n     對照 %s\n' "$SA" "$SB"; FAIL=1; fi

echo
echo "=== ⑤ 前置閘要擋得住:那一列被人動過的世界 ==="
setup w_tamper
psql -h /tmp -p $PG -U postgres -d w_tamper -qc "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO service_role;" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_tamper -v ON_ERROR_STOP=1 -f "$MIG" >"$D/tamper.log" 2>&1
TRC=$?
printf '  被動過的世界 rc=%s(期望非 0)\n' "$TRC"
# 🔵 這裡認的是【前置閘】而不是某一個編號 —— 編號會隨我重寫檔案而變,
#    而「紅在前置閘」才是要驗的事。(2026-09-05 實測:我重寫之後編號從 ② 變 ①,
#    而測試因為釘死編號而假紅 —— 📌 一把釘在【編號】上的尺, 會在我改註解時叫。)
if [ "$TRC" -ne 0 ] && grep -q '前置閘' "$D/tamper.log"; then
  printf '  ✅ 紅在前置閘\n'; grep -m1 '前置閘' "$D/tamper.log" | sed 's/^/     /'
else printf '  🔴 沒擋住或紅在別的地方\n'; grep -m1 ERROR "$D/tamper.log" | sed 's/^/     /'; FAIL=1; fi

echo
echo "=== ⑥ 冪等:同一支再跑一次 ⇒ 期望【綠, 並印「已經做過了」】 ==="
# 🔴 這一格原本期望「紅」, 而實測讓我改掉那個期望:
#    「已經做過」與「被別人破壞」若印同一個紅 ⇒ 📌 兩者的下一步完全不同, 而讀的人分不出來。
psql -h /tmp -p $PG -U postgres -d w_after -v ON_ERROR_STOP=1 -f "$MIG" >"$D/again.log" 2>&1
ARC=$?
printf '  第二次 rc=%s(期望 0)\n' "$ARC"
grep -m1 '已經做過了' "$D/again.log" | sed 's/^/     /'
if [ "$ARC" -eq 0 ] && grep -q '已經做過了' "$D/again.log"; then printf '  ✅ 冪等且說得出理由\n'
else printf '  🔴 第二次沒過或沒說「已經做過了」\n'; grep -m1 ERROR "$D/again.log" | sed 's/^/     /'; FAIL=1; fi

echo
echo "=== ⑦ 🔴 最危險那個世界:schema 那列不在, 而【全域】那列還在給那四種 ==="
# codex must-fix ⑥:原版沒有這個世界 ⇒ 前置閘會判「已經做過了」而放行
#   ⇒ 📌 **一個成功的 migration 什麼都沒解決, 而新表照樣自帶。**
setup w_global
psql -h /tmp -p $PG -U postgres -d w_global -qc \
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM service_role;" >/dev/null 2>&1
psql -h /tmp -p $PG -U postgres -d w_global -qc \
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO service_role;" >/dev/null 2>&1
GRC_SETUP=$(Q w_global "SELECT count(*) FROM pg_default_acl WHERE defaclnamespace=0")
printf '  造出來的全域列數 = %s(期望 >=1, 否則這個世界沒造出來)\n' "$GRC_SETUP"
[ "$GRC_SETUP" -ge 1 ] || { echo "  🔴 世界沒造出來 ⇒ 這一格的綠沒有意義 (ENV-FAIL)"; exit 2; }
psql -h /tmp -p $PG -U postgres -d w_global -v ON_ERROR_STOP=1 -f "$MIG" >"$D/global.log" 2>&1
GRC=$?
printf '  rc=%s(期望非 0)\n' "$GRC"
if [ "$GRC" -ne 0 ] && grep -q '前置閘⓪' "$D/global.log"; then
  printf '  ✅ 紅在前置閘⓪(全域那條路)\n'; grep -m1 '前置閘⓪' "$D/global.log" | sed 's/^/     /'
else printf '  🔴 沒擋住 ⇒ 成功而無效\n'; grep -m1 -E 'ERROR|NOTICE' "$D/global.log" | sed 's/^/     /'; FAIL=1; fi

printf '\n%s 350000-verify %s\n' "$([ $FAIL -eq 0 ] && echo ✅ || echo 🔴)" "$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
exit $FAIL
