#!/bin/sh
# probe-schema-exposure — PostgREST 的曝露 schema 清單有沒有被動過?
#
# 用法:
#   sh scripts/probe-schema-exposure.sh [site|quote|both]      預設 both
#   sh scripts/probe-schema-exposure.sh --selftest             離線,不打網路
#
# exit code:  0=全格通過   3=有格 FAIL(真發現)   2=用法錯   1=工具自壞
#   🔴 三態分得開是硬要件(對齊 scripts/where-is.sh):
#      「探針壞了」與「真的曝露了」必須是不同的碼 ——
#      兩者合流的話,一個綠燈會同時代表兩件相反的事。
#   ⚠️ 憑證檔在 != 帳號還活著:連不上 / 認證失敗 = **1(工具自壞)**,不是 3。
#
# ══ 🔴 這是【偵測】,不是【牆】 ═══════════════════════════════════════════
# 它守的那個東西不在 repo 裡 —— 曝露清單是 Supabase Dashboard 的設定,
# repo 內任何 grep / 測試 / CI 都看不到它;三綠恆綠、覆蓋率算不到。
#   ❌ 它**擋不住**有人去 Dashboard 把 net 加進清單。
#   ✅ 它能在**加進去之後**、下一次跑的時候叫出來。
# 🔴🔴 **⇒ 偵測頻率就是暴露窗。**
# 🔴🔴 **⇒ Supabase Dashboard 動過 Exposed schemas 之後【必跑一次】。**(硬要件)
#
# ══ 明令不做(照抄 spec §4 / §6b,寫在這裡不是只寫在規格裡)══════════════
#   ❌ 不寫 REVOKE —— spec §2.5 已實測:postgres 非 superuser,對 supabase_admin
#      的 grant 是**靜默 no-op**(supabase/migrations/20260723120000_...:16-19)。
#   ❌ 不加 RLS policy 當修法 —— spec §2.2:**TRUNCATE 不受 RLS 管**。
#   ❌ 不 SELECT、**不印 headers 欄**,連「為了寫報告舉個例」都不行
#      (那一欄內有 CRON_SECRET 明碼)。
#   ❌ key 不進 stdout / log / 命令列;要引用只引用**長度**。
#   ❌ **不塞進三綠 / CI 必跑** —— 它打正式站 + 依賴外部網路,
#      塞進去會做出時好時壞的測試,而**假紅比沒有守門更糟**(團隊會學會忽略它)。
#
# ══ 🛑🛑 本檔【從來沒有對正式站跑過】(2026-08-30 線A `-e9` 寫的時候)══════
# 已驗:`--selftest` 離線 **29 格全過**(當場數的:標「突變」4 格 / 標「【對照】」4 格 /
#       現造負對照 1 格;其餘為正路徑與拆解)、
#       `sh -n` 語法過、**rc 四態都分得開**:
#         0 (--help 實跑) / 1 (HOME 指空目錄讀不到憑證, 實跑) / 2 (用法錯, 實跑)
#         3 → **selftest 格4e/4f 演得出來**(最終映射抽成 final_rc, 與網路無關)
#       ⚠️ ~~上一版這裡寫「rc=3 未驗, 因為打不了正式站」~~ —— **那句是錯的**,
#          code-reviewer R1 #1 指出:那一態與正式站無關, 抽成函式就測得到。**已補。**
# 🔴 **未驗**:`site` / `quote` / `both` 任何一發**真跑**(打正式站那一半)。
#    成因不是漏做:**本窗的權限模式擋下了「拿存放的憑證打正式 Supabase」**。
# 🔴🔴 **而那道閘擋的理由是【結構性的】,不是【今晚變數太多】那種判斷**:
#      逐字「the user **never named this production target**; assigned only by a peer session」
#      ⇒ **同僚視窗沒有權限授權打正式站,只有 Sean 本人有。**
#      📌 這一句要留著:一個「判斷」型的理由,下一次會被人合理地說服掉;
#         一個「結構」型的理由不會。(`-48` 2026-08-30 自陳它原本給的理由弱了一級。)
# ⚠️ **所以下面那些期望值全部來自規格與 2026-08-17 的舊量測,不是本檔跑出來的。**
#    第一個有權限的人跑完之後,請把這一整段換成實跑輸出的日期與結果。
#
# ══ 🛑 **而目前【沒有任何東西會叫人跑它】⇒ 偵測頻率 = 0 ⇒ 這道守門現在買到 0**══
# code-reviewer R1 #11 當場量的:`grep -rl probe-schema-exposure` 全 repo ⇒ **只有規格那一支**
# (它自己)。而規格 §6b 的硬要件是「Dashboard 動過 Exposed schemas 之後**必跑一次**」。
# 📌 **⇒ 上面那句「偵測頻率就是暴露窗」在今天的意思是:暴露窗 = 永遠。**
# ⇒ 這一格**本檔自己修不掉** —— 它要一列在別人會讀的板子上(`docs/launch-todo.md` 由 `-b9`
#   維護,本窗不改別人的板)。已回報主視窗排。**在那一列出現之前,這支是躺著的。**
#
# 規格正本 docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md §3 + §6b
#   ⚠️ nit(不自己改規格,回報給規格作者):§6b 那個小標寫「每個庫要跑的**四格**」,
#      而它下面那張表列的是 **A-E 五格**。交辦單是對的(五格),小標是舊數。
# 交辦單   ~/pcm-mailbox/R3-交辦單-探針片probe-schema-exposure-20260830.md

set -u

RC_OK=0; RC_FAIL=3; RC_USAGE=2; RC_BROKEN=1

SITE_URL='https://bmpnplmnldofgaohnaok.supabase.co'
QUOTE_URL='https://dllwkkfanaebrsuyuedy.supabase.co'
SITE_KEY_FILE="${HOME}/.pcm-site-anon-key"
QUOTE_KEY_FILE="${HOME}/.pcm-quote-anon-key"
SITE_RO_FILE="${HOME}/.pcm-readonly-db"
QUOTE_RO_FILE="${HOME}/.pcm-readonly-quote-db"

EXPECTED_HINT='Only the following schemas are exposed: public, graphql_public'

# 🔴🔴🔴 **must-fix(code-reviewer R1 #4):原本用 `case *"$EXPECTED_HINT"*` = 【子字串】。**
#    而 Dashboard 加一個 schema 的形狀是**追加**:
#      hint 變成 "…exposed: public, graphql_public, net"
#      ⇒ 它**仍然包含** EXPECTED_HINT ⇒ **PASS**
#    📌 **⇒ 這支探針唯一要偵測的那件事,原本會安靜地通過。**
#    ⚠️ 而我原本的突變集只演了「清單被清空」,**恰好繞開真威脅**(追加)——
#       突變演的是我想得到的壞法,不是最可能發生的那一種。
#    ⇒ 改成把 hint 的值**抽出來做 `=` 比對**,並在 selftest 補一發【追加】突變。
hint_of() {  # hint_of <body> —— 從 PostgREST 的 JSON 抽出 hint 的值(抽不到回空字串)
  printf '%s' "$1" | sed -n 's/.*"hint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

# ══ 格 D 的清單 ═══════════════════════════════════════════════════════
# 🔴🔴🔴 **must-fix(code-reviewer R1 #5):原本打 `/rest/v1/job` 這種【不帶 Accept-Profile】
#    的路徑,而 PostgREST 沒有 profile 時用**預設 schema**(`db-schemas` 第一項 = `public`)
#    ⇒ 它去找 `public.job` ⇒ 404,**不論 cron 在不在曝露清單裡**。
#    ⚠️ 而這件事**同樣適用於 `net` 那兩張表** —— 把 `net` 加進曝露清單並不會讓它變成預設
#      schema ⇒ `/rest/v1/_http_response` 照樣 404。
#    📌 **⇒ 原本整個 D 格在「安全」與「已曝露」兩個世界印同一個 404。**
#    ⇒ 改成【每個 schema 各發一次 `Accept-Profile: <schema>`】,期望 PostgREST 自己回
#      `PGRST106`(這個 schema 沒有被曝露)。這與 E 格同形狀,而那正是它有判別力的原因。
# ⚠️⚠️ **這一條是【推出來的】,不是【量到的】** —— 依據是 PostgREST 的 profile 語義,
#      而本窗打不了正式站。第一個有權限的人跑真的那一發時,請順手驗:
#      對一個**確定沒被曝露**的 schema ⇒ 應得 PGRST106(這就是負對照)。
# ⚠️ 這偏離了 spec §6b 那張表的字面 URL。偏離的理由就是上面那段;**規格那一格也該修**,
#    而改規格不是本片的範圍 ⇒ 已回報。
D_SCHEMAS='net cron vault extensions auth'
D_EXPECTED_N=5

FAILS=0
CHECKS=0

emit() {   # emit <格名> <期望> <實得>
  CHECKS=$((CHECKS + 1))
  if [ "$2" = "$3" ]; then
    printf '  %-34s 期望=%-52s 實得=%-52s PASS\n' "$1" "$2" "$3"
  else
    printf '  %-34s 期望=%-52s 實得=%-52s FAIL\n' "$1" "$2" "$3"
    FAILS=$((FAILS + 1))
  fi
}

# nit #9:射程聲明原本只印在成功路徑 ⇒ 工具自壞與用法錯那兩發沒有射程。
# 交辦單 §④ 要的是「輸出末尾自帶」,所以這裡也印。
die_broken() { printf '🔴 工具自壞:%s\n' "$1" >&2; scope_note >&2; exit "$RC_BROKEN"; }

# 🔴 最終 rc 的映射抽成函式,**為了讓 selftest 演得出 rc=3 那一態** ——
#    否則檔頭那句「rc=3 未驗」會一直成立,而它其實不必成立(reviewer #1 指出的)。
final_rc() {  # final_rc <FAILS>
  if [ "$1" -eq 0 ]; then printf '%s' "$RC_OK"; else printf '%s' "$RC_FAIL"; fi
}

# ── 讀 key。🔴 只回報【長度】,絕不回報前綴或內容。 ────────────────────────
load_key() {  # load_key <檔> <變數名> ; 成功時把值放進 LOADED_KEY
  [ -r "$1" ] || die_broken "讀不到憑證檔 $1"
  # shellcheck disable=SC1090
  . "$1"
  LOADED_KEY=$(eval "printf '%s' \"\${$2:-}\"")
  [ -n "$LOADED_KEY" ] || die_broken "$1 裡沒有 $2"
}

# 🔴🔴 **curl 的 header 走 `-K -`(config 從 stdin),不走 `-H`。**
#    成因:`-H "apikey: $KEY"` 會把 key 放進 **argv** ⇒ 同一台機器上任何人
#    `ps -ww` 就看得到 —— 而 spec §4 明令「key 不進命令列」。
#    ⚠️ 這一條 `-b4` 與 `-1c` 交接時各自獨立撞到,而**我第一版就是用 `-H` 寫的**。
#    ✅ 已實測 `-K -` 真的把 header 送出去(本機 echo 伺服器收到 `apikey: CANARY123`),
#       不是「看起來應該會送」。
#    📌 走 stdin 而不走設定檔:設定檔要 chmod 600 + trap 清理,而**沒有檔就沒有清理問題**。
curl_cfg() {  # curl_cfg <base> <key> <路徑> [額外 header] —— 產生 config 到 stdout
  printf 'header = "apikey: %s"\n' "$2"
  printf 'header = "Authorization: Bearer %s"\n' "$2"
  if [ "$#" -ge 4 ] && [ -n "$4" ]; then printf 'header = "%s"\n' "$4"; fi
  printf 'url = "%s%s"\n' "$1" "$3"
}

# 🔴🔴 **must-fix(code-reviewer R1 #1):網路不可達會落到 rc=3,而它該是 rc=1。**
#    實測:`curl -w '%{http_code}'` 打不可達 host ⇒ stdout 印 **`000`**、curl 自己 rc=6。
#    只收 stdout 的話 got=000 ⇒ emit FAIL ⇒ exit 3
#    ⇒ **「探針壞了」與「真的曝露了」印同一個碼**,正是 spec §6b 硬要件禁的那一件。
#    ⇒ 這裡收 curl 自己的 rc,`000` 或 rc!=0 一律 die_broken。
http_code() {  # http_code <base> <key> <路徑> [額外 header]
  _hc=$(curl_cfg "$@" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 -K - 2>/dev/null) ; _hr=$?
  if [ "$_hr" -ne 0 ] || [ "$_hc" = '000' ]; then
    die_broken "curl 打不到 $1$3(curl rc=$_hr, http_code=$_hc)—— 網路 / DNS / 專案睡著,不是曝露"
  fi
  printf '%s' "$_hc"
}

http_body() {  # http_body <base> <key> <路徑> <額外 header>
  _hb=$(curl_cfg "$@" | curl -s --max-time 20 -K - 2>/dev/null) ; _hr=$?
  [ "$_hr" -eq 0 ] || die_broken "curl 取 body 失敗(rc=$_hr)"
  printf '%s' "$_hb"
}

# ══ 格 D:對每個不該被曝露的 schema 各發一次 Accept-Profile,期望 PGRST106 ═══
# ⚠️ ~~原本這行寫「主張 net 兩表 + 順帶守的三個 schema 都不可達」~~ ——
#    那是改成 profile 版之前的字面,**留著會讓下一個人以為它還在打表路徑**。已換。
d_cell() {  # d_cell <label> <base> <key> <a_path>
  n=0
  for sch in $D_SCHEMAS; do
    b=$(http_body "$2" "$3" "$4" "Accept-Profile: $sch")
    case "$b" in
      (*PGRST106*) got='PGRST106(未曝露)' ;;
      (*)          got="(無 PGRST106 ⇒ 這個 schema 可能被曝露了;hint=$(hint_of "$b"))" ;;
    esac
    emit "$1 D.${sch}" 'PGRST106(未曝露)' "$got"
    n=$((n + 1))
  done
  # 🔴 **must-fix(#6)字面 vs 事實**:這一格**不是**「伺服器側清單被改空就會叫」——
  #    腳本讀不到伺服器那份清單。它數的是**本檔硬編的 D_SCHEMAS 有幾個元素**,
  #    唯一擋得住的是「有人改了清單卻忘了改 D_EXPECTED_N」。
  #    ⇒ 它守的是【我自己的迴圈有沒有被靜靜地縮短】,不是【曝露清單】。
  #    (原本的註解寫成後者,那句話是假的;是 code-reviewer 指出來的。)
  emit "$1 D.跑了幾格(守我自己的迴圈)" "$D_EXPECTED_N" "$n"
}

# ══ 格 0:拓樸重量(psql 唯讀)══════════════════════════════════════════
# 期望 6 列全 t + postgres_is_super=f。
# 🔴 任何一格 f ⇒ 印「拓樸變了」+ 實得值,rc=3 —— 那可能代表鎖變可行了,不要吞。
# 🔴🔴 **must-fix(code-reviewer R1 #10)字面 vs 事實 —— 這個 6 不是 2026-08-17 的基線。**
#    spec §2.1 那發 08-17 實測的是 `rolname IN ('anon','authenticated')` ⇒ **4 列**。
#    本檔照抄停件檔的版本多了 `service_role` ⇒ 6 列,而**那多出來的 2 列從來沒有被量過**。
#    ⇒ 所以「6 列全 t = 拓樸同 08-17」是**假的**:那是拿 6 去比一個 4 的基線。
#    ⚠️ 若 service_role 某一格本來就是 `f`,**第一發真跑會印「拓樸變了」而那不是變**。
#    ⇒ 第一個有權限的人跑完之後:把 service_role 那 2 列的實得值寫回這裡當基線,
#      在那之前,**這一格的紅要當「未校準」讀,不要當「拓樸真的變了」讀。**
TOPO_SQL="SELECT r.rolname, t.tbl,
       has_table_privilege(r.rolname,t.tbl,'SELECT')   AS sel,
       has_table_privilege(r.rolname,t.tbl,'INSERT')   AS ins,
       has_table_privilege(r.rolname,t.tbl,'UPDATE')   AS upd,
       has_table_privilege(r.rolname,t.tbl,'DELETE')   AS del,
       has_table_privilege(r.rolname,t.tbl,'TRUNCATE') AS trunc,
       (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') AS postgres_is_super
  FROM pg_roles r
  CROSS JOIN (VALUES ('net._http_response'),('net.http_request_queue')) AS t(tbl)
 WHERE r.rolname IN ('anon','authenticated','service_role')
 ORDER BY t.tbl, r.rolname;"

topo_cell() {  # topo_cell <label> <ro 檔> <變數名>
  command -v psql > /dev/null 2>&1 || die_broken "找不到 psql,格 0 跑不了"
  [ -r "$2" ] || die_broken "讀不到 $2"
  # shellcheck disable=SC1090
  . "$2"
  url=$(eval "printf '%s' \"\${$3:-}\"")
  [ -n "$url" ] || die_broken "$2 裡沒有 $3"

  # 🔴🔴 **conninfo 不走 argv** —— `psql "$url"` 會把**含密碼的 URI** 放進命令列。
  #    改成拆成 PG* 環境變數(環境變數不進 `ps` 的 argv)。
  #    ✅ 已本機實測(打 127.0.0.1:1,零正式站接觸)兩個世界:
  #       `PGDATABASE=<整條 URI>` ⇒ **不會展開**,它跑去連本機 socket ⇒ 這條路不能用;
  #       拆成 PG* ⇒ 與「URI 走命令列」拿到**同一個** Connection refused ⇒ 它真的照著連。
  #    ⚠️ URI 裡的密碼可能是 percent-encoded,而 `PGPASSWORD` **不會**幫你解碼 ⇒ 這裡自己解。
  rest=${url#*://}
  cred=${rest%%@*}
  hostpart=${rest#*@}
  u_user=${cred%%:*}
  u_pass_raw=${cred#*:}
  hostport=${hostpart%%/*}
  u_db=${hostpart#*/}
  u_db=${u_db%%\?*}
  u_host=${hostport%%:*}
  case "$hostport" in *:*) u_port=${hostport#*:} ;; *) u_port=5432 ;; esac
  u_pass=$(printf '%b' "$(printf '%s' "$u_pass_raw" | sed 's/%/\\x/g')")
  [ -n "$u_host" ] && [ -n "$u_user" ] && [ -n "$u_db" ] || die_broken "$2 裡的 URI 拆不開(host/user/db 有空的)"

  # 🔴🔴 **must-fix(code-reviewer R1 #2):原本用 `2>&1` 把 stderr 併進 out。**
  #    psql 就算 rc=0 也可能印警告,例如
  #      psql: WARNING: password file ".pgpass" has group or world access
  #    而下面的 `cut` **沒有 `-s`** ⇒ 不含分隔符的行會**原樣吐出來**
  #    ⇒ flags 變成 "...password file...accessttttt" ⇒ 命中 `*f*`(來自 **file** 的 f)
  #    📌 **⇒ 一個檔案權限警告會被印成「拓樸變了、鎖可能變可行了」。**
  #    ⇒ stderr 分開收(只在失敗時拿來報錯),並給 cut 加 `-s`。
  _errf=$(mktemp -t probeschemaXXXXXX) || die_broken 'mktemp 失敗'
  out=$(PGHOST="$u_host" PGPORT="$u_port" PGUSER="$u_user" PGPASSWORD="$u_pass" PGDATABASE="$u_db" \
        psql -Atq -c "$TOPO_SQL" 2>"$_errf") ; PRC=$?
  _err=$(cat "$_errf"); rm -f "$_errf"
  # 🔴 連不上 / 認證失敗 = 工具自壞(1),**不是** 真發現(3)。兩個世界分開。
  [ "$PRC" -eq 0 ] || die_broken "psql 連線或查詢失敗(rc=$PRC):$_err;憑證檔在 != 帳號還活著"
  # nit #3 / #12:psql rc=0 但**零列**(角色名對不上之類)⇒ 下面 flags 會是空字串而落到
  # 「無 f ⇒ PASS」,那一格自己在兩個世界印同一個字。⇒ 空輸出直接判工具自壞,不讓它走到那裡。
  [ -n "$out" ] || die_broken 'psql rc=0 但零列 —— 拓樸查詢沒回東西, 這是工具/權限問題不是曝露'

  rows=$(printf '%s\n' "$out" | grep -c '|')
  emit "$1 0.列數" "6" "$rows"
  # 🔴 只看第 3-7 欄(五個權限旗標),**不要把整列壓平** ——
  #    rolname 有 `authenticated`(含 f? 沒有)、tbl 有 `_http_response`(沒有 f),
  #    但第 8 欄 postgres_is_super **期望就是 f** ⇒ 壓平的話它會讓這一格永遠叫。
  flags=$(printf '%s\n' "$out" | cut -s -d'|' -f3-7 | tr -d '|\n')
  case "$flags" in
    *f*) emit "$1 0.權限旗標全 t" "無 f" "出現 f ⇒ 拓樸變了:$out" ;;
    *)   emit "$1 0.權限旗標全 t" "無 f" "無 f" ;;
  esac
  super=$(printf '%s\n' "$out" | head -1 | cut -s -d'|' -f8)
  emit "$1 0.postgres_is_super" "f" "$super"
}

# ══ 一個庫的 A-E 五格 ══════════════════════════════════════════════════
run_db() {  # run_db <site|quote>
  case "$1" in
    site)
      base="$SITE_URL"
      kf="$SITE_KEY_FILE"; kv='PCM_SITE_ANON_KEY'
      okf="$QUOTE_KEY_FILE"; okv='PCM_QUOTE_ANON_KEY'
      a_path='/rest/v1/products_public?select=id&limit=0'
      c_path='/rest/v1/customers?select=id&limit=0'
      rof="$SITE_RO_FILE"; rov='PCM_AUDIT_RO_URL'
      ;;
    quote)
      base="$QUOTE_URL"
      kf="$QUOTE_KEY_FILE"; kv='PCM_QUOTE_ANON_KEY'
      okf="$SITE_KEY_FILE"; okv='PCM_SITE_ANON_KEY'
      a_path='/rest/v1/storefront_catalog_v?select=id&limit=0'
      # 🔴 spec §6 只給了報價單庫的 A 格與庫別對照三發,**沒有給 C 格的端點**。
      #    這裡沿用 customers ——⚠️ **未經實測**:若報價單庫沒有這張表,它回 404 不是 401。
      #    ⇒ 下面對 404 有專門處理(判 rc=1 不是 rc=3),理由寫在那裡。
      c_path='/rest/v1/customers?select=id&limit=0'
      rof="$QUOTE_RO_FILE"; rov='PCM_AUDIT_RO_QUOTE_URL'
      ;;
    *) return 1 ;;
  esac

  printf '\n══ %s(%s)══\n' "$1" "$base"

  load_key "$kf" "$kv"; key="$LOADED_KEY"
  load_key "$okf" "$okv"; other_key="$LOADED_KEY"
  printf '  (key 長度 %s / 對照庫 key 長度 %s —— 內容與前綴一律不印)\n' \
    "$(printf '%s' "$key" | wc -c | tr -d ' ')" \
    "$(printf '%s' "$other_key" | wc -c | tr -d ' ')"

  topo_cell "$1" "$rof" "$rov"

  # A 正向對照:沒有它,斷網 / key 過期 / 專案睡著都會讓主張「通過」
  emit "$1 A.正向對照" "200" "$(http_code "$base" "$key" "$a_path")"
  # B 庫別對照:兩把 key 同前綴同長度,拿錯不會報錯 ⇒ 這格證明我打的是這個庫
  emit "$1 B.庫別對照(另一庫的 key)" "401" "$(http_code "$base" "$other_key" "$a_path")"
  # C 判別力對照:證明 404 不是「打錯路徑的通用回應」
  # 🔴 **C 格收到 404 ⇒ 那是【我的端點寫錯了】,不是【曝露】** ——
  #    而 404 正好是 D 格的期望值 ⇒ 若照 FAIL 處理,它會變成一發**假紅**,
  #    而假紅比沒有守門更糟(團隊會學會忽略它)。⇒ 判 rc=1(工具自壞),兩個世界分開。
  #    (這一格是 `-b4` / `-1c` 交接時補的;我第一版只寫了「未經實測」而沒處理它會怎麼壞。)
  c_got=$(http_code "$base" "$key" "$c_path")
  if [ "$c_got" = "404" ]; then
    die_broken "C 格端點回 404 ⇒ 這張表在本庫不存在,是對照格未校準、不是曝露。改對端點再跑。"
  fi
  emit "$1 C.判別力對照" "401" "$c_got"
  # D 主張 + 跑了幾格
  d_cell "$1" "$base" "$key" "$a_path"
  # E 白名單自曝:讓被測物自己把邊界講出來
  body=$(http_body "$base" "$key" "$a_path" 'Accept-Profile: net')
  case "$body" in
    *PGRST106*) e_code='PGRST106' ;;
    *)          e_code='(無 PGRST106)' ;;
  esac
  emit "$1 E.錯誤碼" "PGRST106" "$e_code"
  # 🔴 比對【完整字串】,不是只查 net 在不在 ——
  #    「net 不在裡面」在「清單是 public, graphql_public」與「清單被改動了」兩個世界一樣。
  # 🔴 **`=` 比對抽出來的 hint 值,不是子字串命中** —— 理由見上面 hint_of 那一段。
  #    ⚠️ 這裡刻意把**實得的 hint 原樣印出來**:它是 PostgREST 自己講的 schema 清單,
  #       不含任何 key 與 headers 欄 ⇒ 印它是安全的,而**不印的話,清單被改成什麼沒人看得到**。
  e_hint=$(hint_of "$body")
  [ -n "$e_hint" ] || e_hint="(抽不到 hint;body 長度 $(printf '%s' "$body" | wc -c | tr -d ' '))"
  emit "$1 E.白名單清單" "$EXPECTED_HINT" "$e_hint"
}

scope_note() {
  cat <<'SCOPE'

──────────────────────────────────────────────────────────────
🛑 射程(印在你眼前,不是躺在檔頭):
   · 這是【偵測】不是【牆】 —— 它擋不住有人去 Dashboard 加 schema,
     只能在加了之後的下一次執行叫出來。**偵測頻率 = 暴露窗。**
   · 它量的是【生效設定】(REST 實際回什麼),量不到【設定畫面上寫什麼】——
     兩者不一致時它站在生效那一側,而那一側才是客人碰得到的。
   · 它只看這兩個庫的這幾張表與這幾個 schema。**別的 schema 不在分母裡。**
   · 格 0 走唯讀 psql:它答的是【ACL 拓樸】,不是【曝露清單】。兩件事。
──────────────────────────────────────────────────────────────
SCOPE
}

# ══ selftest:離線,零網路 ══════════════════════════════════════════════
# 🔴 它驗的是【斷言本身分不分得出兩個世界】,不是「正式站現在安不安全」。
selftest() {
  printf '=== probe-schema-exposure --selftest(離線,不打網路)===\n'
  rc=0
  ck() {  # ck <格名> <實得> <期望>
    if [ "$2" = "$3" ]; then printf '  ✅ %s\n' "$1"
    else printf '  🔴 %s(得 %s / 期望 %s)\n' "$1" "$2" "$3"; rc=1; fi
  }

  # 格1 emit 的兩個世界:相同 ⇒ PASS 且不累加 FAILS;不同 ⇒ FAIL 且累加
  FAILS=0; CHECKS=0
  emit '自測.相同' '200' '200' > /dev/null
  ck '格1a 相同 ⇒ 不累加 FAILS' "$FAILS" '0'
  emit '自測.不同' '200' '404' > /dev/null
  ck '格1b 不同 ⇒ 累加 FAILS' "$FAILS" '1'
  ck '格1c CHECKS 有在數' "$CHECKS" '2'

  # 格2 🔴 E 格【完整字串】比對:三個 body,而**三個都沒有 net**。
  #     這一格是本檔最重要的一格 —— 只查「net 不在裡面」的話,三發都印綠。
  good_body='{"code":"PGRST106","hint":"Only the following schemas are exposed: public, graphql_public"}'
  empty_body='{"code":"PGRST106","hint":"Only the following schemas are exposed: "}'
  # 🔴 `-1c` 給的那一發:清單**被改動了**(少了 graphql_public),而它看起來完全正常。
  drift_body='{"code":"PGRST106","hint":"Only the following schemas are exposed: public"}'
  # 🔴🔴🔴 **這一發才是真威脅(code-reviewer R1 #4)**:Dashboard 加一個 schema 是**追加**。
  #    ⚠️ 而它**同時擊破兩種寫法**:
  #      · 子字串比對(原本的寫法)⇒ 追加後仍含舊字串 ⇒ **PASS**
  #      · 只查「net 在不在」    ⇒ 這一發 net **在**裡面 ⇒ 那種寫法在這一發【會叫】
  #    📌 ⇒ 所以下面 naive 那一格只演三個世界,不能把 appended 算進去 ——
  #       **一把壞尺不是每一發都錯,而「它這一發抓到了」不代表它是對的尺。**
  appended_body='{"code":"PGRST106","hint":"Only the following schemas are exposed: public, graphql_public, net"}'
  hit() { h=$(hint_of "$2"); [ "$h" = "$EXPECTED_HINT" ] && printf 'yes' || printf 'no'; }
  ck '格2a 正常 body ⇒ hint 相等'                "$(hit x "$good_body")"      'yes'
  ck '格2b 清單被清空 ⇒ 必須不等(突變)'          "$(hit x "$empty_body")"     'no'
  ck '格2c 清單少一個 ⇒ 必須不等(突變,-1c)'      "$(hit x "$drift_body")"     'no'
  ck '格2d 🔴 清單被【追加】⇒ 必須不等(真威脅)'   "$(hit x "$appended_body")"  'no'
  substr() { case "$2" in (*"$EXPECTED_HINT"*) printf 'pass' ;; (*) printf 'fail' ;; esac; }
  ck '格2e 【對照】舊的子字串寫法 ⇒ 追加時會安靜地放行' "$(substr x "$appended_body")" 'pass'
  naive() { case "$2" in (*net*) printf 'has-net' ;; (*) printf 'no-net' ;; esac; }
  ck '格2f 【對照】只查 net ⇒ 前三個世界同一個答案' \
     "$(naive x "$good_body")$(naive x "$empty_body")$(naive x "$drift_body")" \
     'no-netno-netno-net'
  ck '格2g hint 抽不出來時回空字串(負路徑)' "$(hint_of '{"code":"X"}')" ''

  # 格3 🔴 D 格的「跑了幾格」:清單被改空 ⇒ 「全部 404」恆真,只有這一格會叫
  # 🔴 **真的突變 D_SCHEMAS 本身**,不是餵 emit 一個字面 0 ——
  #    reviewer #6:餵字面只驗到 emit 會不會翻紅,沒有驗到「迴圈被縮短會不會被抓」。
  count_schemas() { n=0; for s in $1; do n=$((n + 1)); done; printf '%s' "$n"; }
  FAILS=0; CHECKS=0
  emit '自測.D 幾格' "$D_EXPECTED_N" "$(count_schemas "$D_SCHEMAS")" > /dev/null
  ck '格3a 清單完整 ⇒ N 相符'  "$FAILS" '0'
  FAILS=0
  emit '自測.D 幾格(突變:迴圈被縮短)' "$D_EXPECTED_N" "$(count_schemas 'net cron')" > /dev/null
  ck '格3b 迴圈被縮短 ⇒ 必須翻紅(真突變)' "$FAILS" '1'
  FAILS=0
  emit '自測.D 幾格(突變:清單空掉)' "$D_EXPECTED_N" "$(count_schemas '')" > /dev/null
  ck '格3c 清單空掉 ⇒ 必須翻紅' "$FAILS" '1'

  # 格4 rc 三態互不相等(它們合流的話,一個綠燈會代表兩件相反的事)
  ck '格4a OK != FAIL'     "$([ "$RC_OK" != "$RC_FAIL" ] && printf y || printf n)" 'y'
  ck '格4b FAIL != BROKEN' "$([ "$RC_FAIL" != "$RC_BROKEN" ] && printf y || printf n)" 'y'
  ck '格4c BROKEN != USAGE' "$([ "$RC_BROKEN" != "$RC_USAGE" ] && printf y || printf n)" 'y'
  # 🔴 **rc=3 那一態現在演得出來** —— 檔頭原本寫「rc=3 未驗, 因為打不了正式站」,
  #    而 reviewer #1 指出那是不必要的:最終映射與網路無關,抽成 final_rc 就測得到。
  ck '格4d FAILS=0 ⇒ rc 0'  "$(final_rc 0)" "$RC_OK"
  ck '格4e FAILS=1 ⇒ rc 3'  "$(final_rc 1)" "$RC_FAIL"
  ck '格4f FAILS=9 ⇒ rc 3'  "$(final_rc 9)" "$RC_FAIL"

  # 格5 🔴 格 0 的旗標掃描只能吃第 3-7 欄 ——
  #     把整列壓平的話,`postgres_is_super=f`(期望就是 f)會讓它永遠叫。
  fake_row='anon|net._http_response|t|t|t|t|t|f'
  # 🔴 這幾行的 `cut` 要與**正式路徑逐字相同**(都帶 `-s`)——
  #    量具與被量的東西不是同一支的話, 綠的是量具不是碼。
  f_cols=$(printf '%s\n' "$fake_row" | cut -s -d'|' -f3-7 | tr -d '|\n')
  f_all=$(printf '%s\n' "$fake_row" | tr -d '|\n')
  # 🔴 `case` 的 pattern 要寫成 `(*f*)` 帶前括號 —— 不帶的話那個 `)` 會把 `$( )` 提前關掉。
  #    (第一版就是這樣寫的, 而**是這支 selftest 自己把它抓出來的**:三格同時紅、錯誤訊息指到行號。)
  ck '格5a 只看 3-7 欄 ⇒ 全 t 不誤報' "$(case "$f_cols" in (*f*) printf bad ;; (*) printf ok ;; esac)" 'ok'
  ck '格5b 【對照】整列壓平 ⇒ 會被 super=f 誤觸' "$(case "$f_all" in (*f*) printf bad ;; (*) printf ok ;; esac)" 'bad'
  bad_row='anon|net._http_response|t|f|t|t|t|f'
  b_cols=$(printf '%s\n' "$bad_row" | cut -s -d'|' -f3-7 | tr -d '|\n')
  ck '格5c 真的有 f(突變)⇒ 必須抓到' "$(case "$b_cols" in (*f*) printf caught ;; (*) printf missed ;; esac)" 'caught'
  # 🔴🔴 **這一發證的是 must-fix #2 真的修掉了** —— psql 的警告行沒有分隔符,
  #    `cut` 不帶 `-s` 會**原樣吐出來**, 而 "password file" 裡有一個 `f`。
  warn_row='psql: WARNING: password file has group or world access
anon|net._http_response|t|t|t|t|t|f'
  w_with=$(printf '%s\n' "$warn_row" | cut -s -d'|' -f3-7 | tr -d '|\n')
  w_without=$(printf '%s\n' "$warn_row" | cut -d'|' -f3-7 | tr -d '|\n')
  ck '格5d 帶 -s ⇒ 警告行被丟掉, 不誤報' "$(case "$w_with" in (*f*) printf bad ;; (*) printf ok ;; esac)" 'ok'
  ck '格5e 【對照】不帶 -s ⇒ 被 password file 的 f 誤觸' "$(case "$w_without" in (*f*) printf bad ;; (*) printf ok ;; esac)" 'bad'

  # 格6 URI 拆解:percent-encoded 密碼要解得開
  tu='postgresql://u1:some%40pass@h1:6543/db1'
  t_rest=${tu#*://}; t_cred=${t_rest%%@*}; t_hp=${t_rest#*@}
  t_pass=$(printf '%b' "$(printf '%s' "${t_cred#*:}" | sed 's/%/\\x/g')")
  ck '格6a 使用者拆得出'   "${t_cred%%:*}" 'u1'
  ck '格6b 密碼 percent 解得開' "$t_pass" 'some@pass'
  ck '格6c 主機拆得出'     "${t_hp%%:*}" 'h1'
  ck '格6d 資料庫拆得出'   "${t_hp#*/}" 'db1'

  # 格7 負對照:現造一個字面,任何 body 都不該命中
  neg="ZZQ$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')nowhere"
  nhit() { case "$2" in *"$neg"*) printf 'yes' ;; *) printf 'no' ;; esac; }
  ck '格7 負對照(現造)⇒ 不命中' "$(nhit x "$good_body")" 'no'

  FAILS=0; CHECKS=0
  if [ "$rc" -eq 0 ]; then printf '⇒ selftest PASS(每一格的兩個世界都印不同的東西)\n'
  else printf '⇒ selftest FAIL\n'; fi
  return "$rc"
}

# ══ main ═══════════════════════════════════════════════════════════════
case "${1:-both}" in
  --selftest) selftest; exit "$?" ;;
  -h|--help)
    printf '用法: sh scripts/probe-schema-exposure.sh [site|quote|both]\n'
    printf '      sh scripts/probe-schema-exposure.sh --selftest\n'
    exit "$RC_OK" ;;
  site)  TARGETS='site' ;;
  quote) TARGETS='quote' ;;
  both)  TARGETS='site quote' ;;
  *)
    printf '🔴 用法錯:不認得 "%s"。只吃 site | quote | both | --selftest\n' "$1" >&2
    scope_note >&2
    exit "$RC_USAGE" ;;
esac

command -v curl > /dev/null 2>&1 || die_broken '找不到 curl'

for db in $TARGETS; do run_db "$db"; done

printf '\n總判:%s 格,FAIL %s 格\n' "$CHECKS" "$FAILS"
scope_note
exit "$(final_rc "$FAILS")"
