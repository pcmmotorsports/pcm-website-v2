#!/usr/bin/env bash
# ============================================================
# `#525` 客戶搜尋 verify harness —— **可重跑、fixture 驅動**的行為證據
# ============================================================
# 對象 = supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql
# plan  = docs/specs/2026-08-16-525-customer-search-plan.md
#
# 🔴🔴 **這支存在的理由 = codex R3(`gpt-5.6-terra`)的框架層判定**:
#    「200 多行 DO 將**部署、資料探針、行為測試**混為一體,卻**仍只跑一次**,
#      **測試價值反而低於獨立腳本**。」
#    「真正應擋的是『**把 migration DO 宣稱為唯一驗證**』這個框架。」
#    ⇒ migration 只留結構性 fail-fast;**行為保證全部在這裡**,而這裡**每次都能重跑**。
#
# ⚠️ **它是怎麼變成 200 行 DO 的**:R1 說「斷言不夠嚴」⇒ 加;R2 說「還是不夠嚴」⇒ 再加。
#    兩輪都在同一方向加碼,而 R3(**換模型**)說那個方向從一開始就不對。
#    🔴 判別句:**我這輪的修改,是在回答【上一輪的問題】,還是在回答【原本的問題】?**
#
# 🔴🔴 **作者的自我更正(2026-08-16)**:我整晚重複宣稱「本窗無法執行任何 SQL」——
#    **那句話是錯的。** 正確的是「**不能碰正式庫**」(`.env*` 明列絕不動)。
#    本機有 PostgreSQL 17.10(`/opt/homebrew/bin/initdb`),而 repo 早有 63 支同型 verify script
#    (`ls scripts/ | grep -c verify`)⇒ **拋棄式叢集一直都在。**
#    ⚠️ 這正是 memory `feedback_false-unconstructible-claim-is-worse-than-false-verified` 的形狀:
#    **判別刀 = 我要的是「那個環境的狀態」,還是只要「那個引擎的行為」?** 本片只要後者。
#
# ── 用法 ────────────────────────────────────────────────────────────────
#   ./scripts/525-verify.sh provision   # 起拋棄式 PG + 建基線 + 塞 fixture
#   ./scripts/525-verify.sh run         # 套 migration + 跑全部行為格(可重跑)
#   ./scripts/525-verify.sh stop        # 收掉
#
# ⚠️ **基線是照 repo 的 migration 重建的,不是正式庫實況** —— 全檔結論以此為界。
# 🔴 **`service_role` / `anon` / `authenticated` 三個角色 repo 全樹零 CREATE ROLE**
#    (它們是 Supabase 平台給的)⇒ 本檔自己造。**那不是 migration 有問題。**
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:-run}"
WORK="${WORK:-/tmp/525-verify-work}"
PORT="${PORT:-54625}"
MIG="supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql"
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U pgtest -d postgres)

# 🔴 走 TCP 不走 unix socket:socket 路徑上限 103 bytes,深目錄會 FATAL(house 實測踩過)。
# 🔴 LC_ALL=C:不設會 "postmaster became multithreaded during startup"(macOS 實測)。
pg() { LC_ALL=C pg_ctl -D "$WORK/pgdata" "$@"; }

PASS=0; FAIL=0
# 每一格都印「期望 vs 實得」,不只印 OK/NG —— 只印 OK 的話,量具壞掉時看不出來。
chk() { # chk <格名> <期望> <實得>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %-58s %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); printf '  ❌ %-58s 期望[%s] 實得[%s]\n' "$1" "$2" "$3"; fi
}
val() { "${PSQL[@]}" -tAq -c "$1" 2>/dev/null | tr -d '[:space:]'; }

case "$MODE" in
provision)
  rm -rf "$WORK"; mkdir -p "$WORK"
  initdb -D "$WORK/pgdata" -U pgtest --auth=trust -E UTF8 >"$WORK/initdb.log" 2>&1 \
    || { echo "initdb 失敗,見 $WORK/initdb.log"; exit 1; }
  pg -o "-p $PORT -c unix_socket_directories=" -l "$WORK/pg.log" start >/dev/null 2>&1
  sleep 2
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "建基線失敗"; exit 1; }
-- 平台角色(repo 全樹沒有 CREATE ROLE,它們由 Supabase 提供)
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role  nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  -- 🔴 繼承鏈:本角色【繼承 service_role】⇒ 用來驗「proacl 字面看不到、has_function_privilege 看得到」
  if not exists (select 1 from pg_roles where rolname='inherits_sr')   then create role inherits_sr   nologin; end if;
end $$;
grant service_role to inherits_sr;

create schema if not exists extensions;
-- pg_trgm:repo 的 20260812130000:126 建在 extensions schema,本檔照抄那個位置
create extension if not exists pg_trgm with schema extensions;

-- auth.users 的最小替身(customers.user_id 有 FK 指過去)
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- customers:照 20260523034911 的形狀(只取本片會用到的欄)
create table if not exists public.customers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  phone      text,
  tier       text default 'general',
  created_at timestamptz not null default now()
);

-- 前兩支 trigram 索引:照 20260812130000:432-438 逐字
create index if not exists idx_customers_name_trgm  on public.customers using gin
  ((pg_catalog.lower(pg_catalog.btrim(coalesce(name,'')))) extensions.gin_trgm_ops);
create index if not exists idx_customers_phone_trgm on public.customers using gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(coalesce(phone,'')), '[^0-9]', '', 'g')) extensions.gin_trgm_ops);
SQL
  # ── fixture ────────────────────────────────────────────────────────────
  # 🔴 **每一筆都是為了某一格存在的**,不是隨手塞:
  #    · 姓名含 '-'  ⇒ 驗「數字軸 needle 變空時,文字軸仍要命中」(不是回全部、也不是回空)
  #    · email 含 '_' ⇒ 驗 LIKE 的 `_` 被逃逸成字面(沒逃的話 `_` 是萬用字元 ⇒ 幾乎全中)
  #    · 姓名含 '%'  ⇒ 同上,`%` 沒逃的話會撈回全表(fail-open 的主形狀)
  #    · LINE 合成位址 ⇒ 驗「刻意搜得到」那條拍板
  #    · 電話帶連字號 ⇒ 驗數字正規化(0912-345-678 與 0912345678 互通)
  #    · 中文姓名 ⇒ ⚠️ **macOS 的 pg_trgm 對中文抽零 trigram**(house 實錘,memory
  #      `reference_pg-trgm-cjk-zero-on-macos-libc`)⇒ **本格只驗 LIKE 的正確性,不驗索引有沒有被用到。**
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "塞 fixture 失敗"; exit 1; }
insert into auth.users (id) values
 ('11111111-1111-4111-8111-000000000001'),('11111111-1111-4111-8111-000000000002'),
 ('11111111-1111-4111-8111-000000000003'),('11111111-1111-4111-8111-000000000004'),
 ('11111111-1111-4111-8111-000000000005'),('11111111-1111-4111-8111-000000000006')
on conflict do nothing;
insert into public.customers (user_id, email, name, phone, created_at) values
 ('11111111-1111-4111-8111-000000000001','sean@example.com',       '王小明',      '0912-345-678', now() - interval '6 day'),
 ('11111111-1111-4111-8111-000000000002','a_b@example.com',        'Mary-Jane',   '0922333444',   now() - interval '5 day'),
 ('11111111-1111-4111-8111-000000000003','pct@example.com',        '100%純棉',    null,           now() - interval '4 day'),
 ('11111111-1111-4111-8111-000000000004','line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local','LINE 客',null, now() - interval '3 day'),
 ('11111111-1111-4111-8111-000000000005','back\slash@example.com', 'Back\Slash',  null,           now() - interval '2 day'),
 ('11111111-1111-4111-8111-000000000006','zzz@example.com',        '無關的人',    '0999888777',   now() - interval '1 day')
on conflict do nothing;
SQL
  echo "provision 完成:PG 在 127.0.0.1:$PORT,fixture 6 筆"
  ;;

run)
  echo "── 套 migration ───────────────────────────────────────────────"
  APPLY=$("${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1)
  APPLY_RC=$?
  if [ $APPLY_RC -ne 0 ]; then
    echo "🔴 migration apply 失敗(rc=$APPLY_RC):"; echo "$APPLY" | tail -20; exit 1
  fi
  echo "  ✅ apply 成功(含 migration 內四條結構守門)"

  echo "── A 組:輸入形狀(migration 只驗了空字串這一格)───────────────"
  chk "空字串 ⇒ ids 空"        "[]"    "$(val "select (public.admin_search_customers('',100)->'ids')::text")"
  chk "全空白 ⇒ ids 空"        "[]"    "$(val "select (public.admin_search_customers('   ',100)->'ids')::text")"
  chk "NULL ⇒ ids 空"          "[]"    "$(val "select (public.admin_search_customers(null,100)->'ids')::text")"
  chk "超長(121) ⇒ ids 空"     "[]"    "$(val "select (public.admin_search_customers(repeat('a',121),100)->'ids')::text")"
  chk "truncated 是 boolean"   "boolean" "$(val "select jsonb_typeof(public.admin_search_customers('',100)->'truncated')")"

  echo "── B 組:🔴 逃逸與 fail-open(這組是本片最重要的)──────────────"
  # 正向對照先跑:證明量具是活的(不然下面每個 0 都無法與「函式恆回空」區分)
  chk "正向對照:搜 example ⇒ 5 筆"  "5" "$(val "select jsonb_array_length(public.admin_search_customers('example',100)->'ids')")"
  # 🔴🔴 **期望值不寫死,與 `strpos` 獨立算出的答案比對**(codex R2 的教法)。
  #    · `strpos` 是**字面**比對,不經 LIKE、不需逃逸 ⇒ **與被測那條路零共用行**
  #    · 寫死數字會踩「用眼睛數 fixture」那個病 —— **我第一版就踩了**:
  #      搜 `_` 我寫死期望 1,實得 2,而**實得是對的**(`a_b@…` 與 `line_u…` 都含字面 `_`,我漏看後者)。
  #      ⇒ 改成兩邊都由 SQL 算,fixture 增減時這幾格自動跟著對。
  esc() { # esc <探針> ⇒ 印「函式回的筆數|strpos 算的筆數」
    val "select jsonb_array_length(public.admin_search_customers(\$\$$1\$\$,100)->'ids')::text || '|' || (
           select count(*) from public.customers c
            where strpos(lower(btrim(coalesce(c.name,''))),  lower(\$\$$1\$\$)) > 0
               or strpos(lower(btrim(coalesce(c.email,''))), lower(\$\$$1\$\$)) > 0)::text"
  }
  for probe in '%' '_' '-'; do
    r=$(esc "$probe"); a="${r%%|*}"; b="${r##*|}"
    chk "🔴 搜 [$probe] 與 strpos 期望一致(逃逸 / 數字軸空 needle)" "$b" "$a"
  done
  # 全表筆數當上界:任何一格等於它 = fail-open
  TOTAL=$(val "select count(*) from public.customers")
  for probe in '%' '_'; do
    r=$(esc "$probe"); a="${r%%|*}"
    chk "🔴 搜 [$probe] 不得回全部($TOTAL)" "not$TOTAL" "$([ "$a" = "$TOTAL" ] && echo "$TOTAL" || echo "not$TOTAL")"
  done

  echo "── C 組:三軸各自命中 ─────────────────────────────────────────"
  chk "姓名軸(中文)⇒ 王小明"        "1" "$(val "select jsonb_array_length(public.admin_search_customers('王小',100)->'ids')")"
  chk "電話軸:0912345678 命中帶連字號那筆" "1" "$(val "select jsonb_array_length(public.admin_search_customers('0912345678',100)->'ids')")"
  chk "🔴 LINE 合成位址【刻意搜得到】" "1" "$(val "select jsonb_array_length(public.admin_search_customers('pcmmotorsports.local',100)->'ids')")"
  chk "查無 ⇒ 空(負向對照)"        "0" "$(val "select jsonb_array_length(public.admin_search_customers('絕不存在zzzqqq',100)->'ids')")"

  echo "── D 組:排序與截斷 ───────────────────────────────────────────"
  chk "p_limit=2 ⇒ 恰 2 筆"      "2"     "$(val "select jsonb_array_length(public.admin_search_customers('example',2)->'ids')")"
  chk "p_limit=2 ⇒ truncated"    "true"  "$(val "select (public.admin_search_customers('example',2)->>'truncated')")"
  chk "未截斷時 truncated=false" "false" "$(val "select (public.admin_search_customers('example',100)->>'truncated')")"
  # 排序穩定:同一查詢跑兩次必須逐字相同(array_agg 沒有 ORDER BY 時這格會飄)
  chk "排序穩定(兩次相同)" "t" \
    "$(val "select (public.admin_search_customers('example',3)->'ids') = (public.admin_search_customers('example',3)->'ids')")"

  echo "── E 組:權限(含角色繼承 —— proacl 字面看不到這件事)────────────"
  chk "service_role 有 EXECUTE"  "t" "$(val "select has_function_privilege('service_role','public.admin_search_customers(text,integer)','EXECUTE')")"
  chk "🔴 anon 無 EXECUTE"        "f" "$(val "select has_function_privilege('anon','public.admin_search_customers(text,integer)','EXECUTE')")"
  chk "🔴 authenticated 無 EXECUTE" "f" "$(val "select has_function_privilege('authenticated','public.admin_search_customers(text,integer)','EXECUTE')")"
  # 🔴 這格是 migration 的 proacl 斷言【看不到】的東西:繼承 service_role 的角色有【有效】權限
  chk "繼承 service_role 者【有】有效 EXECUTE(proacl 看不到)" "t" \
    "$(val "select has_function_privilege('inherits_sr','public.admin_search_customers(text,integer)','EXECUTE')")"

  echo "── F 組:schema / 安全屬性 drift ──────────────────────────────"
  chk "SECURITY DEFINER"  "t" "$(val "select prosecdef from pg_proc where oid='public.admin_search_customers(text,integer)'::regprocedure")"
  chk "STABLE"            "s" "$(val "select provolatile from pg_proc where oid='public.admin_search_customers(text,integer)'::regprocedure")"
  chk "search_path 釘死"  "t" "$(val "select proconfig::text[] && array['search_path=\"\"','search_path=']::text[] from pg_proc where oid='public.admin_search_customers(text,integer)'::regprocedure")"
  chk "🔴 函式體零 RAISE(PII 不落 log)" "0" \
    "$(val "select count(*) from pg_proc where oid='public.admin_search_customers(text,integer)'::regprocedure and prosrc ~* '\mRAISE\M'")"

  echo "── G 組:三支 trigram 索引的【表達式形狀】──────────────────────"
  # ⚠️ **不驗 EXPLAIN 是否走 GIN**(codex R3 逐字警告):小表下規劃器選 seq scan 是
  #    **正確且更快**的;在 migration/script 裡要求走 GIN 是錯誤要求。
  #    ⇒ 這裡只驗「索引的形狀對」,那是**未來**資料長大後的保證。
  for pair in "idx_customers_name_trgm|btrim" "idx_customers_phone_trgm|regexp_replace" "idx_customers_email_trgm|btrim"; do
    idx="${pair%%|*}"; frag="${pair##*|}"
    chk "索引 $idx 存在且 trgm 且含 $frag 且非 partial" "1" \
      "$(val "select count(*) from pg_indexes where schemaname='public' and tablename='customers' and indexname='$idx' and indexdef ilike '%gin_trgm_ops%' and indexdef ilike '%$frag%' and indexdef not ilike '%where%'")"
  done

  echo
  echo "══ 結果:PASS=$PASS  FAIL=$FAIL ══"
  [ "$FAIL" -eq 0 ] || exit 1
  ;;

stop)
  pg stop >/dev/null 2>&1; echo "已停 $WORK"
  ;;
*)
  echo "用法:$0 {provision|run|stop}"; exit 2;;
esac
