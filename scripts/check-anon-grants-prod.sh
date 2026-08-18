#!/usr/bin/env bash
# scripts/check-anon-grants-prod.sh — 對【正式庫】查 anon/authenticated 的實際權限現值。
#
# 回答兩條上線前缺口(docs/security/2026-08-17-pre-launch-must-close-checklist.md ③ 與 ④):
#   ③ E683-1 新建的表出生就自帶 anon 權限(含 TRUNCATE)  → 查 pg_default_acl 現值
#   ④ E686-1 net 兩表對 anon 全 DML + TRUNCATE、RLS 關   → 查那兩張表的表級 + 欄級權限
#
# 🔴 這支腳本【只讀不寫】:全部是 SELECT,零 DDL、零 DML。
# 🔴 用法(連線字串走 env,不進 argv、不進 shell history):
#     read -rs PGURL && export PGURL
#     bash scripts/check-anon-grants-prod.sh
#     unset PGURL
#   ⚠️ 本腳本【不接受】把連線字串當參數傳 —— 那會讓它出現在 process table(ps)裡。
#   ⚠️ 它也不會把連線字串交給 psql 的 argv:先拆成 PG* 環境變數再呼叫(見 connect_env)。
#
# rc:0=兩格都查到且對照組正常 / 2=用法錯 / 1=工具問題(psql 沒裝、連不上、對照組失效)
#   🔴 rc=1 不是「查無」—— 不要當成「權限已經收乾淨了」。
#
# 兩個庫都要跑:網站庫(pcm-website-v2)與報價單庫(pcm-quote-v2)。E686 §6 實測兩庫結果相同。

set -uo pipefail

if [ -n "${1:-}" ]; then
  echo "🔴 用法錯:本腳本不收參數。連線字串請走 PGURL env(read -rs PGURL && export PGURL)。" >&2
  exit 2
fi
if [ -z "${PGURL:-}" ]; then
  echo "用法: read -rs PGURL && export PGURL && bash scripts/check-anon-grants-prod.sh && unset PGURL" >&2
  exit 2
fi
command -v psql > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 psql —— 這不是查詢結果" >&2; exit 1; }
command -v python3 > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 python3 —— 這不是查詢結果" >&2; exit 1; }

# 連線字串拆成 PG* env,psql 的 argv 因此不含任何 secret。
eval "$(python3 - <<'PY'
import os, shlex, urllib.parse as u
p = u.urlparse(os.environ['PGURL'])
q = dict(u.parse_qsl(p.query))
env = {
    'PGHOST': p.hostname or '',
    'PGPORT': str(p.port or 5432),
    'PGUSER': u.unquote(p.username or ''),
    'PGPASSWORD': u.unquote(p.password or ''),
    'PGDATABASE': (p.path or '/postgres').lstrip('/') or 'postgres',
    'PGSSLMODE': q.get('sslmode', 'require'),
}
for k, v in env.items():
    print('export %s=%s' % (k, shlex.quote(v)))
PY
)" || { echo "🔴 工具問題:PGURL 解析失敗 —— 這不是查詢結果" >&2; exit 1; }

run() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# ── 0. 對照組:先證明這把尺量得到東西(該綠的一發綠、該紅的一發紅)────────────
POS=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema='public' and table_name='legal_terms_versions';")
NEG=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema='public' and table_name='admin_audit_log';")
case "$POS$NEG" in
  *[!0-9]*) echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果" >&2
            echo "$POS" | head -3 >&2; exit 1;;
esac
echo "── 對照組(先驗量具,不是結論)──────────────────"
echo "  該有的:legal_terms_versions × anon 顯式 GRANT SELECT ⇒ 期待 >0,實得 $POS"
echo "  該沒有的:admin_audit_log × anon 零 client 權限        ⇒ 期待 =0,實得 $NEG"
if [ "$POS" -eq 0 ] || [ "$NEG" -ne 0 ]; then
  echo "🔴 對照組不符 ⇒ 這把尺現在量不準,下面的數字一律【不要採信】。先查為什麼。" >&2
  exit 1
fi
echo "  ✅ 兩發都表演得出來 ⇒ 下面的數字可以讀。"
echo

# ── 1. E683:新表出生會不會自帶 anon/authenticated 權限 ────────────────────
echo "── ③ E683:預設授權(決定【以後】新建的表出生帶什麼)──────────"
echo "  pg_default_acl 現值(空 = 沒有人動過預設;有 anon=... = 新表會自帶):"
run "select coalesce(nsp.nspname,'(所有 schema)') as schema, d.defaclobjtype as objtype,
            pg_catalog.array_to_string(d.defaclacl, E'\n            ') as acl
       from pg_default_acl d left join pg_namespace nsp on nsp.oid = d.defaclnamespace
      order by 1,2;" | sed 's/^/    /'
echo "  🔴 判讀:acl 裡出現 anon= 或 authenticated= ⇒ 【還沒補齊】(新表出生自帶,含 TRUNCATE=D)"
echo "         acl 裡沒有它們 ⇒ 已補齊。空輸出 ⇒ 見 plan §2b,空不等於安全,要配 §1 的斷言一起看"
echo "  📄 docs/specs/2026-08-17-e683-default-privileges-plan.md"
echo

# ── 2. E686:net 兩表的表級 + 欄級權限 ──────────────────────────────────────
echo "── ④ E686:net 兩表對 anon / authenticated 的實際權限 ───────────"
echo "  (a) 表級:"
run "select table_name||' × '||grantee||' ⇒ '||string_agg(privilege_type, ',' order by privilege_type)
       from information_schema.role_table_grants
      where table_schema='net' and grantee in ('anon','authenticated')
      group by table_name, grantee order by 1;" | sed 's/^/    /'
echo "  (b) 欄級(🔴 has_table_privilege 看不到這一層,E 窗 2026-08-17 實測少報):"
run "select table_name||'.'||column_name||' × '||grantee||' ⇒ '||string_agg(privilege_type, ',' order by privilege_type)
       from information_schema.column_privileges
      where table_schema='net' and grantee in ('anon','authenticated')
      group by table_name, column_name, grantee order by 1;" | sed 's/^/    /'
echo "  (c) RLS 開了沒:"
run "select c.relname||' ⇒ rls='||c.relrowsecurity||' / policies='||
            (select count(*) from pg_policy p where p.polrelid=c.oid)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='net' and c.relkind='r' order by 1;" | sed 's/^/    /'
echo "  🔴 判讀:(a)(b) 任一有 DELETE/TRUNCATE/UPDATE/INSERT ⇒ 【還沒補齊】"
echo "         三格全空 ⇒ 已收乾淨。⚠️ 空輸出要配上面的對照組才算數"
echo "  📄 docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md"
echo
echo "🔴 本次結果只代表【這個庫、這一刻】。兩個庫都要跑(網站庫 + 報價單庫)。"
