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
# 🔴 **`service_role` / `anon` / `authenticated` 三個角色 `supabase/migrations/` 全樹零 CREATE ROLE**
# (⚠️ 2026-08-16 校正:原寫「repo 全樹零」是假的全稱句 —— 量法 `git grep -nE '全樹.{0,8}CREATE ROLE'` 曾回 5 命中,反例包含【拋棄式測試環境自己造角色】。真值=`supabase/migrations/` 底下零,那目錄只有 `payment_confirmer`。)
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
  # 🔴 **先停掉舊叢集再砍目錄** —— 直接 `rm -rf` 會讓還在跑的 postmaster
  #    失去自己的資料檔而**繼續佔著 port**,下一次連線得到
  #    `FATAL: could not open file "global/pg_filenode.map"`(2026-08-16 實際踩到)。
  #    ⚠️ 症狀會被誤讀成「migration 壞了」——**它其實是 harness 自己的清理順序錯**。
  pg stop -m immediate >/dev/null 2>&1 || true
  # 🔴 **等 port 真的放開再繼續** —— `pg stop` 回來不代表 socket 已釋放,
  #    而舊 postmaster 在死亡過程中仍佔著 port ⇒ 新叢集 `could not create any TCP/IP sockets`,
  #    **而錯誤訊息長得像「資料檔壞了」**(`could not open file "global/pg_filenode.map"`)。
  #    ⚠️ 2026-08-16 實際踩到:`lsof` 在一分鐘後查是空的,**因為那時它已經死了**
  #       —— **「我查的時候沒有」不等於「那一刻沒有」。**
  for _ in $(seq 1 20); do
    lsof -ti tcp:"$PORT" >/dev/null 2>&1 || break
    sleep 1
  done
  if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
    echo "❌ VERIFY-ABORT:port $PORT 20 秒後仍被佔用,拒絕 provision(避免產生一個看起來像資料損毀的錯誤)"
    exit 1
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  initdb -D "$WORK/pgdata" -U pgtest --auth=trust -E UTF8 >"$WORK/initdb.log" 2>&1 \
    || { echo "initdb 失敗,見 $WORK/initdb.log"; exit 1; }
  pg -o "-p $PORT -c unix_socket_directories=" -l "$WORK/pg.log" start >/dev/null 2>&1
  sleep 2
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "建基線失敗"; exit 1; }
-- 平台角色(`supabase/migrations/` 底下沒有 CREATE ROLE,它們由 Supabase 提供)
-- (⚠️ 2026-08-16 校正:原寫「repo 全樹零」是假的全稱句 —— 量法 `git grep -nE '全樹.{0,8}CREATE ROLE'` 曾回 5 命中,反例包含【拋棄式測試環境自己造角色】。真值=`supabase/migrations/` 底下零,那目錄只有 `payment_confirmer`。)
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
  # 🔴 **加到 106 筆(6 具名 + 100 批量)—— D 窗突變輪 D04 的修法。**
  #    病因:fixture 只有 6 筆 ⇒ 「p_limit 硬夾 100」那格**分不出來**
  #    (突變成夾 999,`p_limit=200` 時 baseline 與 mutated 都是 `truncated=false`)。
  #    ⚠️ 這 100 筆的 email 一律含 `bulk`,**與上面六筆的探針字元(- % _ 反斜線)零重疊**
  #       ⇒ 不會污染 B 組那幾格的期望集(那組用 strpos 獨立算,加了資料也會自動跟著對,
  #         但**刻意讓它們不重疊**,免得下一個人以為那幾格的數字是巧合)。
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "塞批量 fixture 失敗"; exit 1; }
insert into auth.users (id)
select ('22222222-2222-4222-8222-' || lpad(g::text, 12, '0'))::uuid from generate_series(1,100) g
on conflict do nothing;
insert into public.customers (user_id, email, name, phone, created_at)
select ('22222222-2222-4222-8222-' || lpad(g::text, 12, '0'))::uuid,
       'bulk' || g || '@example.com', 'Bulk' || g, null, now() - (g || ' minute')::interval
from generate_series(1,100) g
on conflict do nothing;
SQL
  echo "provision 完成:PG 在 127.0.0.1:$PORT,fixture $("${PSQL[@]}" -tAq -c 'select count(*) from public.customers' | tr -d '[:space:]') 筆"
  ;;

run)
  echo "── 套 migration ───────────────────────────────────────────────"
  APPLY=$("${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1)
  APPLY_RC=$?
  if [ $APPLY_RC -ne 0 ]; then
    # 🔴 **印明確的失敗標記,不要只靠「沒有輸出」**(E 窗自曝:它第一輪只 grep
    #    `PASS=/FAIL=/❌`,而 apply 失敗時三者都不出現 ⇒ **畫面全空 = 看起來像沒事**)。
    #    ⇒ 「沒有輸出」被讀成「沒有問題」是這類 harness 的通病;這行讓失敗一定有字面。
    echo "❌ VERIFY-ABORT:migration apply 失敗(rc=$APPLY_RC)—— 下面所有行為格【一格都沒跑】"
    echo "$APPLY" | tail -20
    echo "══ 結果:PASS=0  FAIL=1(apply 失敗,行為格未執行)══"
    exit 1
  fi
  # 🔴 **這一行刻意【不】用 ✅**(E 窗獨立複驗抓到):
  #    它是**敘述句**,背後沒有任何「期望 vs 實得」的比較,而 `✅` 是 `chk()` 專用的符號。
  #    E 窗數畫面上的 ✅ 得到 31、腳本印 PASS=30 —— **差的就是這一行**。
  #    ⚠️ 這是「宣稱強度 > 實際驗證強度」的**第四種載體:符號**
  #       (前三種是註解、錯誤訊息、格名)。**敘述句與斷言不共用符號。**
  echo "  ·· apply 成功(含 migration 內四條結構守門;此行為敘述,非斷言)"

  echo "── A 組:輸入形狀(migration 只驗了空字串這一格)───────────────"
  chk "空字串 ⇒ ids 空"        "[]"    "$(val "select (public.admin_search_customers('',100)->'ids')::text")"
  chk "全空白 ⇒ ids 空"        "[]"    "$(val "select (public.admin_search_customers('   ',100)->'ids')::text")"
  chk "NULL ⇒ ids 空"          "[]"    "$(val "select (public.admin_search_customers(null,100)->'ids')::text")"
  # 🔴🔴 **這格的名字曾經比它證的東西大**(D 窗 A03):把長度門檻 120 改成 99999,**輸出逐字相同**
  #    ⇒ 它證的是「121 個 a 查不到東西」(**本來就查不到**),**不是「超長被擋下」**。
  #    ⚠️ **這比恆綠格更毒**:恆綠格沒有判別力;**這種格有判別力,只是守的不是它宣稱的那件事**
  #       ⇒ **數覆蓋率時它會被算成「這個面有守」。**
  #    ⚠️ 真正要驗的是「**沒有掃全表**」,那需要 `EXPLAIN` 類斷言,而 runbook §5 明載本機無判別力。
  #    ⇒ **改名,並把界線寫進格名本身。**
  chk "超長輸入輸出為空(不證守門生效;守門要 EXPLAIN,本機驗不到)" "[]" \
    "$(val "select (public.admin_search_customers(repeat('a',121),100)->'ids')::text")"
  chk "truncated 是 boolean"   "boolean" "$(val "select jsonb_typeof(public.admin_search_customers('',100)->'truncated')")"

  echo "── B 組:🔴 逃逸與 fail-open(這組是本片最重要的)──────────────"
  # 正向對照先跑:證明量具是活的(不然下面每個 0 都無法與「函式恆回空」區分)
  # 🔴 **期望值不寫死**(今晚第二次踩同一條:fixture 從 6 筆加到 106 筆,寫死的 5 當場變假)。
  #    上限也要一起夾,否則 >100 命中時本格自己會假紅。
  chk "正向對照:搜 example = strpos 獨立算出的筆數(夾 100)" "t" \
    "$(val "select jsonb_array_length(public.admin_search_customers('example',100)->'ids')
              = least((select count(*) from public.customers c
                        where strpos(lower(btrim(coalesce(c.email,''))),'example') > 0
                           or strpos(lower(btrim(coalesce(c.name,''))),'example') > 0), 100)")"
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
  # 🔴 **D 窗突變輪 B03 的修法**:上一格**只餵純數字** ⇒ 該輸入下 `v_num == v_txt` **恆等**,
  #    把正規化拿掉(`v_num_like := v_txt`)**一格都不會紅**。
  #    ⇒ 本格餵**帶連字號**的輸入 —— 那是唯一能分出「有沒有做數字正規化」的形狀。
  #    決定性輸入實測(D 窗):基準 `ids=1` / 突變版 `ids=0`。
  chk "🔴 電話軸【正規化】:0912-345 命中(拿掉正規化這格才會紅)" "1" \
    "$(val "select jsonb_array_length(public.admin_search_customers('0912-345',100)->'ids')")"
  chk "🔴 LINE 合成位址【刻意搜得到】" "1" "$(val "select jsonb_array_length(public.admin_search_customers('pcmmotorsports.local',100)->'ids')")"
  chk "查無 ⇒ 空(負向對照)"        "0" "$(val "select jsonb_array_length(public.admin_search_customers('絕不存在zzzqqq',100)->'ids')")"

  echo "── D 組:排序與截斷 ───────────────────────────────────────────"
  chk "p_limit=2 ⇒ 恰 2 筆"      "2"     "$(val "select jsonb_array_length(public.admin_search_customers('example',2)->'ids')")"
  chk "p_limit=2 ⇒ truncated"    "true"  "$(val "select (public.admin_search_customers('example',2)->>'truncated')")"
  # 🔴 用**只命中少數**的詞驗「沒截斷」——`example` 現在有 106 筆,拿它驗 false 是錯的靶。
  chk "未截斷時 truncated=false(用只命中 1 筆的詞)" "false" \
    "$(val "select (public.admin_search_customers('sean@',100)->>'truncated')")"
  # 🔴🔴 **D 窗突變輪 D04 的收穫 —— 這格在 6 筆 fixture 下【構造不出來】。**
  #    「p_limit 硬夾 100」是 migration 明文行為;突變成夾 999 時,6 筆 fixture 下
  #    `p_limit=200` 兩版都回 `truncated=false` ⇒ **分不出來**。
  #    ⇒ fixture 加到 106 筆之後,這兩格才真的在驗那個硬夾。
  chk "🔴 硬夾 100:命中 106 筆時只回 100" "100" \
    "$(val "select jsonb_array_length(public.admin_search_customers('example',200)->'ids')")"
  chk "🔴 硬夾 100:超過上限時 truncated=true" "true" \
    "$(val "select (public.admin_search_customers('example',200)->>'truncated')")"
  # 🔴🔴 **D 窗突變輪 D03 的修法 —— 原版是 `f(x) = f(x)` 同句自比,必然相同。**
  #    原版註解宣稱它會抓到「`array_agg` 少 `ORDER BY`」,而 D 窗**用突變證偽了**:
  #    拿掉那個 `ORDER BY`,原版那格**照樣綠**。
  #    **病根(D 窗逐字)**:**驗的是【穩定性】不是【正確性】—— 順序錯了,兩次也會一樣錯。**
  #    ⇒ 改成比**實際序列**對上**獨立算出的期望序列**(`strpos` 算集合、
  #      排序與上限逐字照函式的契約 `created_at DESC, user_id`)。
  #
  #    🔴🔴 **而改完之後,它【仍然】抓不到「拿掉 `array_agg` 的 ORDER BY」**(2026-08-16 實測):
  #    ```
  #    突變 array_agg(user_id ORDER BY …) → array_agg(user_id)   ⇒ PASS=36 FAIL=0  🔴 沒紅
  #    突變 CTE 的 ORDER BY … DESC → ASC                          ⇒ 本格精準紅      ✅ 有判別力
  #    ```
  #    ⇒ **本格【有】判別力(第二發證明),但那一發突變在本環境【不可觀測】** ——
  #      PG 對聚合輸入順序的規定是「**未指定**」,而它在這個計畫下**剛好保留了**子查詢的順序。
  #    ⚠️ **所以那一發是「無意義突變」,不是「通過」** ——
  #      **「我打不中它」與「它沒有問題」是兩件事,而報告上長得一樣。**
  #    🔴 `array_agg` 的 `ORDER BY` **仍然要留著**:它守的是「PG 哪天不再剛好保留」,
  #      而**那一天不會有任何東西通知我們**。**防禦性的東西本來就該恆綠。**
  chk "🔴 排序【正確性】:實際序列 = 獨立算出的期望序列" "t" \
    "$(val "with actual as (
              select array_agg(x::uuid order by ord) a
                from jsonb_array_elements_text(
                       public.admin_search_customers('example',3)->'ids') with ordinality t(x,ord)),
            expect as (
              select array_agg(user_id order by created_at desc, user_id) e from (
                select c.user_id, c.created_at from public.customers c
                 where strpos(lower(btrim(coalesce(c.email,''))),'example') > 0
                    or strpos(lower(btrim(coalesce(c.name,''))),'example') > 0
                 order by c.created_at desc, c.user_id limit 3) s)
            select coalesce((select a from actual),'{}') = coalesce((select e from expect),'{}')")"

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
  # 🔴🔴 **正向對照(E 窗抓到的缺口)**:上面那格只證「錯的值會被擋」,
  #    **沒有人證「對的那兩種編碼【都】會被放行」** ——
  #    不補這發的話,可能寫了一個「兩種都擋」的守門而看不出來,因為現實只會出現其中一種。
  #    ⇒ 直接對兩種字面各跑一次判定式本體。
  for enc in 'search_path=""' 'search_path='; do
    # ⚠️ **這格驗的是【判定式接受哪些字面】,不是【PG 會產生哪些字面】** ——
    #    後者 E 窗在 17.10 上實測只產生 `search_path=""`(三種語法皆同),
    #    `search_path=` 那個分支在此版本是**死碼、防禦性的**。格名照這個界線寫。
    chk "判定式接受編碼 [$enc](非「PG 會產生它」)" "t" \
      "$(val "select array['$enc']::text[] && array['search_path=\"\"','search_path=']::text[]")"
  done
  chk "🔴 負向對照:錯的編碼必須被擋" "f" \
    "$(val "select array['search_path=public']::text[] && array['search_path=\"\"','search_path=']::text[]")"

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
