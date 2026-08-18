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
# rc:0=兩格都查到且對照組正常 / 2=用法錯 / 1=工具問題(psql 沒裝、連不上、量具證不出來)
#     6=這個庫沒有指定的校準表(你可能在跑報價單庫 ⇒ 用 CALIB_YES / CALIB_NO 指定)
#     7=校準表在,但它的權限現值不符預期 ⇒ 🔴 **這是一個【發現】,不是工具壞掉**
#   🔴 rc=1 / 6 都不是「查無」—— 不要當成「權限已經收乾淨了」。
#
# 🔴 **校準表是【網站庫專用】的,而「兩個庫都要跑」需要你先給那個庫自己的校準表**
#    (2026-08-18 主視窗抓到:`:19` 的指示與 `:56` 的校準互相矛盾 —— 報價單庫沒有 legal_terms_versions,
#     對照組在那裡永遠不成立 ⇒ 腳本永遠 rc=1、永遠報不出數。)
#    ⇒ 報價單庫要跑,先指定它自己的兩張表:
#         CALIB_YES=public.<那個庫裡 anon【應該】讀得到的表> \
#         CALIB_NO=public.<那個庫裡 anon【不該】有任何權限的表> bash scripts/check-anon-grants-prod.sh
#    ⚠️ E686 §6 講的是「兩庫的【結果】相同」,**不代表同一支校準在兩個庫都成立** —— 兩件事。
#
# 🔴🔴 **`information_schema` 會依【連線角色】過濾,而 `pg_catalog` 不會**(2026-08-18 G4 實測:
#    非 owner 非 grantee 的角色查 `information_schema.role_table_grants` ⇒ **0**,
#    同一時刻同一張表 `pg_class.relacl` ⇒ **7 項全開**)
#    ⇒ 本腳本第 ④ 段(`net` 兩表)**改走 `relacl` / `attacl`**,`information_schema` 只留作對照。
#    ⇒ **舊版對 `net` 那半印出來的「空」不算數** —— 它可能只是我們這條連線看不到。
#
# 🔴 **為什麼負向對照【不能單獨用】**(同日實錘,值得留在檔頭):
#    `admin_audit_log × anon ⇒ 0` 在「表被鎖好了」與「表根本不存在」兩個世界**印同一個東西**。
#    今天救了這支腳本的是**正向那一格**(表不在時它會掉到 0 而報紅)。
#    ⇒ 只放負向對照的話,它會在報價單庫上印出一個漂亮的綠。(memory `feedback_absence-read-as-verified`)

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
CALIB_YES="${CALIB_YES:-public.legal_terms_versions}"   # anon【應該】讀得到的表
CALIB_NO="${CALIB_NO:-public.admin_audit_log}"          # anon【不該】有任何權限的表

# 0-a. 校準表在不在(🔴 表不存在時,權限查詢也回 0 ⇒ 不先問這一句就分不出「鎖好了」與「不在」)
EXIST=$(run "select coalesce(to_regclass('$CALIB_YES')::text,'-') || '|' ||
                    coalesce(to_regclass('$CALIB_NO')::text,'-');")
case "$EXIST" in
  *'|'*) : ;;
  *) echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果" >&2
     echo "$EXIST" | head -3 >&2; exit 1;;
esac
YES_T="${EXIST%%|*}"; NO_T="${EXIST##*|}"
echo "── 對照組(先驗量具,不是結論)──────────────────"
echo "  校準表:$CALIB_YES ⇒ $YES_T / $CALIB_NO ⇒ $NO_T"
if [ "$YES_T" = '-' ] || [ "$NO_T" = '-' ]; then
  echo "🔴 這個庫【沒有】本腳本預設的校準表 ⇒ 你很可能在跑報價單庫,而預設校準是網站庫專用的。" >&2
  echo "   ⇒ 這【不是】查詢結果,也【不是】權限已收乾淨。" >&2
  echo "   ⇒ 指定那個庫自己的兩張表再跑:" >&2
  echo "     CALIB_YES=public.<anon 應該讀得到的表> CALIB_NO=public.<anon 不該有權限的表> \\" >&2
  echo "       bash scripts/check-anon-grants-prod.sh" >&2
  exit 6
fi

# 0-b. 量具自證:這個庫裡 anon 到底有沒有【任何】表權限(與校準表無關,證明查詢看得見 grant)
ANY=$(run "select count(*) from information_schema.role_table_grants where grantee='anon';")
POS=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema=split_part('$CALIB_YES','.',1)
             and table_name=split_part('$CALIB_YES','.',2);")
NEG=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema=split_part('$CALIB_NO','.',1)
             and table_name=split_part('$CALIB_NO','.',2);")
case "$ANY$POS$NEG" in
  *[!0-9]*) echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果" >&2
            echo "$POS" | head -3 >&2; exit 1;;
esac
echo "  量具自證:本庫 anon 的表權限總筆數 ⇒ $ANY(=0 表示這把尺沒看到過任何 grant)"
echo "  該有的:$CALIB_YES × anon ⇒ 期待 >0,實得 $POS"
echo "  該沒有的:$CALIB_NO × anon ⇒ 期待 =0,實得 $NEG"
if [ "$ANY" -eq 0 ]; then
  echo "🔴 這把尺在本庫【一筆 grant 都沒看到】⇒ 量具證不出來(可能連錯庫 / 權限不足)。" >&2
  echo "   ⇒ 這【不是】「權限已經收乾淨了」。" >&2
  exit 1
fi
if [ "$POS" -eq 0 ] || [ "$NEG" -ne 0 ]; then
  echo "🔴 量具是好的(它看得到 $ANY 筆 grant),而**校準表的權限現值不符預期** ⇒ 這是一個【發現】:" >&2
  [ "$POS" -eq 0 ] && echo "   · $CALIB_YES 對 anon 沒有任何權限 —— 預期它有 SELECT(前台要讀)⇒ 少了一條 GRANT 或連錯庫" >&2
  [ "$NEG" -ne 0 ] && echo "   · 🔴🔴 $CALIB_NO 對 anon 有 $NEG 筆權限 —— 那張表應該對 client 全鎖,這是嚴重偏移" >&2
  echo "   ⇒ 先把這一條查清楚再看下面的數字;本次不繼續報數(rc=7)。" >&2
  exit 7
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
echo "  (0) 🔴 先問【表在不在】—— 表不存在時,下面每一格都會印空,而空會被讀成「已收乾淨」:"
run "select 'net.'||t||' ⇒ '||coalesce(to_regclass('net.'||t)::text,'🔴 不存在(下面的空不算數)')||
            coalesce(' / relacl='||(select case when c.relacl is null then 'NULL(零顯式授權)'
                                              else '有值('||array_length(c.relacl,1)||' 筆)' end
                                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                    where n.nspname='net' and c.relname=t), '')
       from unnest(array['_http_response','http_request_queue']) t;" | sed 's/^/    /'
echo "      🔴 relacl=NULL 對【表】而言 = 零顯式授權 ⇒ anon 真的沒有權限(2026-08-18 實測:"
echo "         relacl NULL 的表 has_table_privilege('anon',…,'TRUNCATE') ⇒ false;"
echo "         而在 anon 預設授權下出生的表,relacl 會被【寫實】成 anon=arwdDxtm ⇒ 下面 (a) 撈得到)"
echo "      ⚠️ 這條【只對表成立】。函式的 proacl 是 NULL 時 PUBLIC 反而【有】EXECUTE ——"
echo "         本腳本不查函式,要查請看 docs/patterns/revoking-function-execute-in-supabase.md" 
echo "  (a) 🔴 表級 —— 走 pg_class.relacl(pg_catalog,**不受可見性過濾**):"
run "select c.relname||' × '||a.grantee::regrole||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace,
            lateral aclexplode(c.relacl) a
      where n.nspname='net' and a.grantee::regrole::text in ('anon','authenticated')
      group by c.relname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (b) 欄級 —— 走 pg_attribute.attacl(同上;🔴 has_table_privilege 看不到這一層):"
run "select c.relname||'.'||at.attname||' × '||a.grantee::regrole||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped,
            lateral aclexplode(at.attacl) a
      where n.nspname='net' and a.grantee::regrole::text in ('anon','authenticated')
      group by c.relname, at.attname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (a2) 對照:同一件事走 information_schema(🔴 **它會依連線角色過濾**,兩者不一致以 (a) 為準):"
run "select table_name||' × '||grantee||' ⇒ '||string_agg(privilege_type, ',' order by privilege_type)
       from information_schema.role_table_grants
      where table_schema='net' and grantee in ('anon','authenticated')
      group by table_name, grantee order by 1;" | sed 's/^/    /'
echo "  (c) RLS 開了沒:"
run "select c.relname||' ⇒ rls='||c.relrowsecurity||' / policies='||
            (select count(*) from pg_policy p where p.polrelid=c.oid)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='net' and c.relkind='r' order by 1;" | sed 's/^/    /'
echo "  🔴 判讀:(a)(b) 任一有 DELETE/TRUNCATE/UPDATE/INSERT ⇒ 【還沒補齊】"
echo "         全空 ⇒ 已收乾淨,**但要三個條件同時成立**:(0) 兩張表都存在、上面的對照組過了、"
echo "         且 (a) 與 (a2) 的【列】一致。🔴 (a2) 少了一整列 ⇒ 那是【可見性過濾】不是【權限被收掉】"
echo "         ⚠️ 已知的良性差異:(a) 會多一個 MAINTAIN(PG17 新權限,information_schema 不報)"
echo "            ⇒ 只差 MAINTAIN 這個字 = 正常;差【整列】才是可見性問題"
echo "         (2026-08-18 實測:非 owner 非 grantee 的角色查 information_schema 得 0,同時 relacl 看得到 7 項)"
echo "  📄 docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md"
echo
echo "🔴 本次結果只代表【這個庫、這一刻】。報價單庫要跑 ⇒ 先用 CALIB_YES / CALIB_NO 給它自己的校準表(見檔頭)。"
