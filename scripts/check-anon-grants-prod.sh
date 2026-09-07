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
# 🔵 **同一件事現在有【第二把尺】, 而它每天自己跑一次**(2026-09-08 起):
#    `public.pcm_net_exposure_snapshot` —— migration `20260908030000` 排的 `pcm-net-exposure`
#    每天 00:00 UTC 唯讀量同一組東西並落一列。
#    🛑 **而它【尚未 apply】(2026-09-08 寫這行時)** —— 上面那句描述的是【貼下去之後】,
#       不是現在。查法 `bash scripts/is-migration-applied.sh 20260908030000`。
#    🛑 **而它【只記錄, 不告警】** —— 沒有任何東西會因為那個數字叫。
#    🔴 **兩把尺【曾經對同一座庫講相反的故事】** —— 這支手動的印「乾淨」, 而真實是 PUBLIC ALL
#       (成因見 (a) 那格的訂正註解)。⇒ **兩邊不一致時, 先問【它們各自量的是哪一個受詞】。**
#    ⚠️ 而那張表的基線【不是 0】:2026-09-08 由**本次查詢**實量 = 7(平台側的 PUBLIC 授權)
#       —— 🛑 那是【查詢的量測值】, 不是「已經存進那張快照表」(它還沒 apply)。
#       ⇒ 讀它要讀 **delta**, 不要讀絕對值。
#    🔴🔴 **而【只比數量的 delta 會漏掉權限擴大】**(2026-09-08 codex):
#       同一組授權從 `SELECT` 擴成 `ALL`, **ACL 組數與有效權限命中數都可能一格不變**
#       ⇒ delta = 0 而權限變大了。⇒ **要比【權限明細】(那串字母), 不是只比數字。**
#
# rc:0=兩格都查到且對照組正常 / 2=用法錯 / 1=工具問題(psql 沒裝、連不上、量具證不出來)
#     6=這個庫沒有指定的校準表(你可能在跑報價單庫 ⇒ 用 CALIB_YES / CALIB_NO 指定)
#     8=第 ③ 段跑完了,而 net 兩表【不存在】⇒ 第 ④ 段不適用(不是「乾淨」)
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
NET_N=$(run "select count(*) from unnest(array['_http_response','http_request_queue']) t
             where to_regclass('net.'||t) is not null;")
case "$NET_N" in *[!0-9]*) NET_N=-1;; esac
echo "  (a) 🔴 表級 —— 走 pg_class.relacl(pg_catalog,**不受可見性過濾**):"
# 🔴🔴 **2026-09-08 訂正(⟦tidy-ANONGRANTSFALSEGREEN⟧):舊版漏掉整個 PUBLIC 族**
#    ⛔ ~~where … and a.grantee::regrole::text in ('anon','authenticated')~~
#    成因:`GRANT … TO PUBLIC` 在 aclexplode 裡的 `grantee` 是 **0**,而 `0::regrole::text` 印 `'-'`
#         ⇒ **不 match 任何角色名 ⇒ 整族安靜地不算**。
#    🔴 而那不是理論:2026-09-08 唯讀實量,`net` 兩表的 relacl 各含一筆
#       `=arwdDxtm/supabase_admin`(grantee 為空 = PUBLIC)⇒ **舊版對它印【空】**,
#       而本段下面的判讀逐字寫著「全空 ⇒ 已收乾淨」。
#    🛑 **具名的受害者**:Sean 2026-08-23 親跑過這支腳本, 拿到的就是那個假綠。
#    📌 形狀:**用【誰被具名授權】這把尺去問【誰讀得到】** —— 兩個受詞,
#       而它們在正常的庫裡幾乎總是一致, 所以那個空看起來完全正常。
run "select c.relname||' × '||(case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace,
            lateral aclexplode(c.relacl) a
      where n.nspname='net' and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated'))
      group by c.relname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (b) 欄級 —— 走 pg_attribute.attacl(同上;🔴 has_table_privilege 看不到這一層):"
# 🔴 同一個訂正(欄級那半):PUBLIC 的 grantee 也是 0。
run "select c.relname||'.'||at.attname||' × '||(case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped,
            lateral aclexplode(at.attacl) a
      where n.nspname='net' and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated'))
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
echo "  (d) 🔴 有效權限 —— has_table_privilege(它把【角色繼承】算進去):"
# 🔴🔴 **2026-09-08 新增(⟦tidy-ANONGRANTSFALSEGREEN⟧;來源 codex R3 審 20260908030000 那片)**
#    (a)(b) 走的是【誰被授權】(aclexplode 的 grantee)。而權限可以**授給一個群組角色,
#    由 anon INHERIT 取得** ⇒ 那種情況下 grantee 是那個群組, 不是 anon / PUBLIC
#    ⇒ **(a)(b) 兩把尺整族看不到, 而 anon 真的讀得到。**
#    ✅ has_table_privilege 問的是【有效權限】⇒ 補得起這個洞。
#    🛑 **而它看不到欄級**(見 (b) 那格的註解)⇒ 兩把尺**各補對方的一部分**盲區, 不可以只留一把。
#    🔴🔴 **而它們【沒有】互補完**(2026-09-08 codex 指出, 我原本寫「各補對方的盲區」= 太強):
#       **群組角色持有【欄級】SELECT/UPDATE 而 anon 經繼承取得** ⇒
#       (b) 濾掉群組看不到、(d) 只問表級也看不到 ⇒ **兩把一起漏報。**
#    ⇒ 下面 (e) 補那一格(`has_column_privilege`), 而**它仍然只涵蓋我列舉的那幾個欄位語意**。
D_OUT=$(run "select t||' × '||r||' ⇒ '||
            (case when has_table_privilege(r,'net.'||t,'SELECT')   then 'S' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'INSERT')   then 'I' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'UPDATE')   then 'U' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'DELETE')   then 'D' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'TRUNCATE') then 'T' else '-' end)
       from unnest(array['_http_response','http_request_queue']) t
       cross join unnest(array['anon','authenticated']) r
      where to_regclass('net.'||t) is not null order by 1;")
# 🔴 2026-09-08 codex:新查詢失敗【會被包成成功】—— run 的輸出接進 sed 之後 rc 就沒了。
#    唯一安全形狀:先收進變數, 立刻取 rc, 中間不准有任何東西。
D_RC=$?
printf '%s\n' "$D_OUT" | sed 's/^/    /'
if [ "$D_RC" -ne 0 ]; then
  echo "🔴 (d) 那一發【沒有跑成功】(rc=$D_RC)⇒ 上面那幾行不是查詢結果, 不要讀成「沒有權限」。" >&2
  exit 1
fi
echo "      🔴 任何一格不是全 '-----' ⇒ 那個角色【真的讀/寫得到】, 不管它是怎麼拿到的。"
echo "      🔵 而 schema USAGE 是另一道門:表權限為 t 而 schema USAGE 為 f ⇒ 那個 t 到不了。"
run "select 'net schema USAGE × '||r||' ⇒ '||has_schema_privilege(r,'net','USAGE')::text
       from unnest(array['anon','authenticated']) r order by 1;" | sed 's/^/    /'
echo "  (e) 🔴 欄級【有效】權限 —— has_column_privilege(補 (b) 與 (d) 一起漏的那一格):"
# 🔴 2026-09-08 加(codex 指出 (b)+(d) 沒有互補完):群組持有欄級權限而 anon 繼承 ⇒ 兩把都看不到。
E_OUT=$(run "select c.relname||'.'||at.attname||' × '||r||' ⇒ '||
            (case when has_column_privilege(r, c.oid, at.attnum, 'SELECT') then 'S' else '-' end)||
            (case when has_column_privilege(r, c.oid, at.attnum, 'INSERT') then 'I' else '-' end)||
            (case when has_column_privilege(r, c.oid, at.attnum, 'UPDATE') then 'U' else '-' end)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped
       cross join unnest(array['anon','authenticated']) r
      where n.nspname='net' and c.relkind='r'
        and (has_column_privilege(r, c.oid, at.attnum, 'SELECT')
          or has_column_privilege(r, c.oid, at.attnum, 'INSERT')
          or has_column_privilege(r, c.oid, at.attnum, 'UPDATE'))
      order by 1;")
E_RC=$?
printf '%s\n' "$E_OUT" | sed 's/^/    /'
if [ "$E_RC" -ne 0 ]; then
  echo "🔴 (e) 那一發【沒有跑成功】(rc=$E_RC)⇒ 上面那幾行不是查詢結果, 不要讀成「沒有欄級權限」。" >&2
  exit 1
fi
echo "      🛑 這一格【零列】不等於安全:它只涵蓋 SELECT / INSERT / UPDATE 三個欄級語意。"
echo "      ⚠️ 而表級有權時, has_column_privilege 對每一欄都回 t ⇒ 它會【跟著 (d) 一起亮】, 那是預期的。"
echo "  🔴 判讀 —— 2026-09-08 重寫(codex 指出舊版三句在新版底下都不成立):"
echo "     ⛔ 舊句一 ~~(a)(b) 任一有 DELETE/TRUNCATE/UPDATE/INSERT ⇒ 還沒補齊~~"
echo "     ⛔ 舊句二 ~~全空 ⇒ 已收乾淨~~ —— 對 (d)(e) 恆假:無權限時它們印的是 '-----',"
echo "        而那是一列有內容的輸出。要問的是【那一列是不是全 '-'】, 不是【有沒有列】。"
echo "     ⛔ 舊句三 ~~(a) 與 (a2) 的列一致~~ —— (a2) 走 information_schema 而它不含 PUBLIC,"
echo "        所以新版 (a) 多出的 PUBLIC 幾列是預期差異;要問的是【具名角色那幾列有沒有少】。"
echo "     ✅ 新判準, 三格分開問:"
echo "        · (a)(b) 要問:ACL 上有沒有任何一列?零列才是 ACL 乾淨。"
echo "        · (d)(e) 要問:有沒有任何一格不是全 '-'?(含角色繼承)"
echo "        · (a2)   只當可見性對照:它比 (a) 少 PUBLIC 是預期的;少掉具名角色那幾列才是問題。"
echo "     🛑 (d)(e) 為真要不要讀成【它讀得到資料】? 要先看上面 (c) 那一格的 RLS:"
echo "        表級 SELECT 與 schema USAGE 都為 t, 而 RLS 開著且沒有適用 policy ⇒ 仍讀不到列。"
echo "        而 TRUNCATE 那一格要單獨問 —— RLS 管不到 TRUNCATE(見 docs/patterns/"
echo "        revoking-function-execute-in-supabase.md)⇒ 它為 t 時 RLS 幫不上忙。"
echo "        ⇒ 要下「anon 真的讀得到」這個結論, (d) 與 (c) 兩格要一起看。"
echo "     ⚠️ 而三格都乾淨也只涵蓋【DB 層】—— 外面叫不叫得到是 PostgREST 有沒有暴露 net,"
echo "        那一格本腳本問不到(⟦tidy-NETPUBLICALL⟧ 那一列記著:四種問法皆拿不到)。"
echo "  📄 docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md"
echo
echo "🔴 本次結果只代表【這個庫、這一刻】。報價單庫要跑 ⇒ 先用 CALIB_YES / CALIB_NO 給它自己的校準表(見檔頭)。"

# ── 5. 🔴 net 兩表都不存在 ⇒ 第 ④ 段【不適用】,不是【乾淨】────────────────────
#    沒有這一段的話:輸出是「④ 全空 + rc=0」,而那正是會被讀成「已收乾淨」的形狀
#    （2026-08-18 G4 自查:同 GR-004 那個「零是濾網壞掉印出來的」家族）
if [ "$NET_N" = "0" ]; then
  echo "🔴 這個庫【沒有 net 那兩張表】(可能沒裝 pg_net)⇒ 第 ④ 段是【不適用】,不是【已收乾淨】。" >&2
  echo "   ⇒ 第 ③ 段(E683 預設授權)的結果仍然有效。" >&2
  exit 8
fi
