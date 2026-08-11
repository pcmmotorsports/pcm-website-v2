#!/usr/bin/env bash
# ============================================================
# A1 可重現驗證 harness — order_item_quantity_summary
# ============================================================
# 對應 = docs/specs/2026-07-30-e10-a1-order-item-summary-columns-plan.md §6
# 用法:scripts/a1-verify.sh all /tmp/a1v      (從零 provision,最完整;**跑完自動 teardown**)
#      A1V_KEEP=1 scripts/a1-verify.sh all /tmp/a1v   (跳過 teardown —— 只在要事後翻庫時用,見下方警語)
#      scripts/a1-verify.sh run /tmp/a1v      (重用既有拋棄式 cluster;**只有前一次帶了 A1V_KEEP=1 才存在**)
#
# 🔴 **teardown 不分模式**:`run` 跑完**一樣會**停 cluster + 刪 workdir(除非帶 `A1V_KEEP=1`)。
#   ⇒ 「`A1V_KEEP=1 all` → `run`」是**一次性**的重用,第二次 `run` 會找不到 workdir。這是刻意的:
#     `A1V_KEEP` 是唯一的「留著」開關,任何沒帶它的一跑都會把現場收乾淨。
# 🔴 **失敗時的例外**:`FAIL>0` 時只停 cluster(釋放專屬埠)、**保留 workdir** —— 紅了要留現場。
#
# 🔴🔴 **為什麼一定要 teardown(2026-08-07 實測,不是理論)**:本支的 provision 會重放**全部** migration
#   (含 B2-S2b),但它接著 `drop_a1` 把摘要表整張刪掉、只重套 A1 ⇒ 跑完時庫裡是
#   **6 支 pcm_a4a 函式 + shipments 重算 trigger 都在,而摘要表沒有 `shipped_quantity`** 這個**斷裂態**。
#   實跑證據(2026-08-07,port 54361):`information_schema.columns` 只回
#   `order_item_id,quantity,ordered_quantity,instock_quantity,cancelled_quantity`,
#   而 `pg_trigger` 裡 `shipments_summary_recompute_ac` 存在。
#   🔴 **而本支照樣印 PASS=61 / FAIL=0** —— 它自己不走 A4a/S2b 那條路,所以完全看不到自己留下的爛攤子。
#   ⇒ 這個庫對**任何別的 harness** 都是壞的。plan §3.5a 因此拍板「專屬 port + 跑完即 teardown」,
#     而**不是**「把庫修回去」(修復程序自己也要被驗證,小線已證那會長出一整層新的假綠面)。
#
# ── 這支腳本在證明什麼、不證明什麼(誠實邊界)────────────────
# 證明:結構/定義字面/ACL/FK 形狀被斷言鎖住,且**每一條斷言都有一個突變能單獨打紅它**;
#      七條 CHECK 中五條可獨立觸發者各有負向行為證據;合法邊界值不被過度限制誤拒。
# 不證明:正式站行為(本機 PG17.10 非 Supabase、auth.uid() 是 shim、C locale ≠ en_US.UTF-8)。
#
# 🔴 provision 不是「套全部 migration 從零重建」(codex 關卡1 must-fix)——
#    scripts/d1t2-rehearsal.sh 的 provision 含 fitments 相容 stub 插序,
#    因為 public.product_fitments_effective 在 repo 內沒有任何建立來源(backlog #299)。
#    ⇒ 這裡的「全綠」不等於「repo 能從零重建正式站 schema」,那條缺口由 #299 承接。
#
# 🔴 判定紀律(A7 / A7-t 兩片的教訓,不重蹈)
#  ① 突變必須**紅在指定的那條斷言**,不是「反正紅了就算抓到」
#     (A7-t 實錘:後續每條突變都紅在同一個探針 ⇒ 判別力歸零而 FAIL 數仍 0)。
#  ② 結構突變與行為突變**分開跑**。行為突變一律先把 migration 內的結構驗收 DO block 拿掉再套用,
#     否則結構斷言會先擋下,行為 probe 的判別力從未被證明(codex 關卡1 must-fix)。
#  ③ 外層 oracle(order_items 基準)存在 shell 這一側,突變改不到它。
#  ④ 每個 sed 突變都要驗「真的改到東西」(cmp),否則 sed 沒命中會變成「零突變卻宣稱紅了」。
#  ⑤ 對照組必跑:沒有對照組,全紅毫無意義。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a1-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a1v)}"
MIG="supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql"
PROBE="scripts/a1-behavior-probe.sql"
# 🔴 **專屬埠 54361**(B2-S2b plan §3.6 定案;2026-08-07 S2b-4b 落地)。原與 `a4a-verify.sh` 共用 54329。
PORT="${PORT:-54361}"
# 🔴🔴 **必須 export**(2026-08-07 實測,不是預防性):provision 是委派給 `scripts/d1t2-rehearsal.sh`,
#    而**它有自己的 `PORT="${PORT:-54329}"` 預設**。以前兩支預設同為 54329,靠巧合對上;
#    本片把預設改成 54361 之後,不 export 就會變成「cluster 起在 54329、本支去連 54361」
#    ⇒ 第一次實跑當場紅在「連不上 54361(先跑 all 模式)」。
export PORT
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PROCQ="SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/'||p.prokind::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY 1"

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
# 🔴 任何「拿來當基準」的查詢輸出都要先證明它本身是有效的。
#    實錘(2026-07-31):pg_proc 那條查詢因 `prokind` 型別而語法錯誤,base 與 after **都是同一則
#    ERROR 文字** ⇒ diff 為空 ⇒ 兩條偷加函式突變雙雙「通過」。查詢壞掉長得跟「沒有差異」一模一樣。
# 🔴 統一的快照取得器(R3 must-fix:原版只對兩個檔做事後檢查,而且只抓行首 `ERROR:`、
#    抓不到 psql 自己吐的 `psql: error:`;trigger / ACL 兩份基準根本沒被驗)。
#    三道:①psql 退出碼 ②stderr 必須空 ③結尾補 sentinel
#    —— sentinel 讓「合法為零列」(order_items 本來就沒有 user trigger)與「查詢壞掉」區分得開。
snapshot() {  # $1=SQL  $2=輸出檔  $3=用途說明
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1" > "$2" 2>"$2.err"
  local rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$2.err" ]; then
    echo "🔴 快照查詢失敗($3,rc=$rc):$(head -1 "$2.err" 2>/dev/null)"; exit 1
  fi
  printf 'SNAPSHOT-OK\n' >> "$2"
}
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }
runsql() { psql "$URL" -qtA -c "$1" 2>&1; }

# ══ workdir 與 cluster 身分閘(沿用 a7t-verify.sh 的三重把關)═══════════════
MARK="$WORK/.a1-throwaway"
CIDFILE="$WORK/cluster-id"

case "$(cd / && printf '%s' "$WORK")" in
  /tmp/?*) : ;;
  *) echo "🔴 workdir 必須在 /tmp 底下(收到:$WORK)—— 這支腳本會 rm -rf 它"; exit 2 ;;
esac
case "$WORK" in *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;; esac
[ ${#WORK} -le 40 ] || { echo "🔴 workdir 太長(${#WORK} 字元)—— socket 路徑上限 103 bytes"; exit 2; }

if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ] && [ ! -f "$MARK" ]; then
    echo "🔴 $WORK 已存在但沒有本腳本的 ownership marker($MARK)—— 拒絕 rm -rf,請換路徑"; exit 2
  fi
  # 🔴 先停掉可能還活著的舊 cluster,再刪目錄。
  #    原版直接 rm -rf,把「正在跑的 postmaster 的資料目錄」砍掉 ⇒ 它不會死、繼續佔著本支的 port
  #    ⇒ 下一次 pg_ctl start 撞 "Address already in use"、provision 失敗,
  #      而且會連帶害到共用同一個 port 的 a7 / a7t harness(2026-07-31 實測踩到)。
  if [ -d "$WORK/pgdata" ]; then
    PGBIN="$(dirname "$(command -v psql 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/psql)")"
    "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1 || true
  fi
  if psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    echo "🔴 port $PORT 上仍有活著的 postmaster,且不是本 workdir 的 pgdata —— 拒絕繼續(先手動停掉)"; exit 2
  fi
  log "0/10 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  rm -rf "$WORK"
  mkdir -p "$WORK" && : > "$MARK"
  scripts/d1t2-rehearsal.sh provision "$WORK" >"$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
fi

[ -f "$MARK" ] || { echo "🔴 $WORK 不是本腳本建立的拋棄式 workdir(缺 $MARK);拒絕動任何 DDL"; exit 2; }
psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上 $URL(先跑 all 模式)"; exit 1; }

CID="$(psql "$URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
[ -n "$CID" ] || { echo "🔴 讀不到 cluster system_identifier"; exit 1; }
if [ "$MODE" = "all" ]; then
  printf '%s' "$CID" > "$CIDFILE"
else
  [ -f "$CIDFILE" ] || { echo "🔴 缺 $CIDFILE —— 無法確認 $URL 是先前 provision 的拋棄式 cluster;拒絕繼續"; exit 2; }
  [ "$CID" = "$(cat "$CIDFILE")" ] || {
    echo "🔴 cluster 身分不符(實 $CID / 期望 $(cat "$CIDFILE"))—— **零寫入退出**"; exit 2; }
fi

# 探針的正向環境閘
psql "$URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS public.pcm_a7_probe_allowed (note text);" >/dev/null

# ══ teardown(plan §3.5a;10/10 段與異常退出都走這裡)═══════════════════════
A1V_TORN=0
# 🔴🔴 **兩道斷言不得共用同一個觀察源**(R1 must-fix 2):第一版只看「psql 連不連得上」——
#    cluster 若**從頭就沒活著**,`pg_ctl stop` 有 `|| true`、連不上被當成「已停」⇒ 整段白拿兩分。
#    ⇒ 改成 **前置條件 + 後置條件 + 第三個獨立來源**:①停之前必須**連得上**(否則判紅)
#      ②停之後必須**連不上** ③`pg_ctl status` 必須說 not running(不經 psql)。
# 🔴 R1 nit 7:「埠已釋放」與「連不上」不是同一件事。有 `lsof` 就用它直接量 LISTEN,
#    沒有就**降級並在訊息裡說明降級**,不宣稱量到了埠。
a1v_teardown() {
  [ "$A1V_TORN" = "1" ] && return 0
  A1V_TORN=1
  local PGBIN listen
  PGBIN="$(dirname "$(command -v psql 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/psql)")"
  # ① 前置:cluster 必須真的活著 —— 否則後面兩道就是恆真。
  if ! psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    bad "teardown:停之前就連不上 $URL —— cluster 沒活著,後面的「已停」會是恆真,判紅"
    return 1
  fi
  # 🔴 R2 F2:**停 cluster 要排在兩道拒刪檢查之前**。第一版把 marker/symlink 檢查放前面,
  #    那兩道紅著 return 時 cluster 還活著、埠沒釋放,而 `A1V_TORN=1` 已經把 trap 抑制掉
  #    ⇒ 檔頭「FAIL>0 也會停 cluster 釋放專屬埠」在那個角落是假的。停 cluster **不需要** marker 保護
  #    (它只動 `$WORK/pgdata`,不刪任何東西);需要保護的是後面的 `rm -rf`。
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1 || true
  # 🔴 R1 nit 11:本支會 rm -rf 使用者給的路徑 ⇒ marker 與 symlink 都要擋(比照 b2s2b-verify)。
  if [ ! -f "$MARK" ]; then
    bad "teardown:找不到 ownership marker($MARK)—— cluster 已停,但**拒絕 rm -rf**(不確定這個 workdir 是不是我建的)"
    return 1
  fi
  if [ -L "$WORK" ]; then
    bad "teardown:$WORK 是 symlink —— cluster 已停,但**拒絕 rm -rf**"
    return 1
  fi
  # ② 後置:連不上。③ 獨立來源:pg_ctl status。
  if psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    bad "teardown:停之後仍連得上 $URL —— postmaster 沒停掉"
    return 1
  fi
  if "$PGBIN/pg_ctl" -D "$WORK/pgdata" status >/dev/null 2>&1; then
    bad "teardown:pg_ctl status 仍回「running」—— 與 psql 連不上矛盾,判紅(兩個來源必須一致)"
    return 1
  fi
  if command -v lsof >/dev/null 2>&1; then
    listen="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2)"
    [ -z "$listen" ] || { bad "teardown:port $PORT 仍有 LISTEN 的行程:$(printf '%s' "$listen" | head -1)"; return 1; }
    listen="(lsof 實測 port $PORT 無 LISTEN)"
  else
    listen="(**降級**:本機沒有 lsof ⇒ 只證到「連不上 + pg_ctl 說 not running」,**沒有直接量埠**)"
  fi
  # 🔴 R1 nit 8:紅了就把現場留著。`provision.log` / `apply.log` / `drop.log` 都在 workdir 裡,
  #    刪掉之後沒人查得下去。埠(共用資源)已經釋放,留一個目錄不影響別人。
  if [ "$FAIL" -gt 0 ]; then
    ok "teardown:cluster 已停 $listen;**因為 FAIL=$FAIL,workdir $WORK 刻意保留**供查證(埠已釋放,不影響其他 harness)"
    return 0
  fi
  rm -rf "$WORK"
  if [ -e "$WORK" ]; then
    bad "teardown:workdir $WORK 沒刪乾淨"
    return 1
  fi
  ok "teardown:cluster 已停 $listen、workdir 已刪 —— 斷裂態不外流"
}
# 🔴🔴 **異常退出也要拆**(R1 must-fix 3):本支在 provision 之後有九處 `exit 1|2`,
#    第一版沒有 trap ⇒ 中途硬退就把斷裂態的 cluster 留在專屬埠上,而用法註解寫的是「跑完自動 teardown」
#    —— 那句話在失敗路徑上是假的。這個 trap 只做「停 cluster」,不刪 workdir(異常時現場要留)。
# 🔴 W7 跟片③(2026-08-09,B-226 MF-3):本片把 19 支 w 線 harness 的 teardown 殘留出口改成
#    fail-closed(`exit 9`),**本檔刻意不改**。理由=實驗打回,不是漏掉:
#    下面的殘留分支被 `A1V_TORN`/`A1V_KEEP` 兩道擋住,只有「正常 teardown 從沒跑過」才進得來,
#    而那只發生在中途 `exit 1|2`(已非 0);正常路徑的殘留由 `a1v_teardown` 自己的後置檢查
#    `bad` 成 FAIL ⇒ 尾端 `exit 1`(實測:把 :156 的 stop 換成 true ⇒ PASS=62/FAIL=1、exit=1)。
#    ⇒ 在此加 `exit 9` 是到不了的死碼。
# 🔴 **失效條件(這是時點觀察,不是恆真)** —— 下列任一成立,本段理由當場作廢、要回頭補:
#    ① `trap a1v_trap EXIT` 之後新增任何可達的 `exit 0`(現況全檔 `exit 0` 零命中)
#    ② `a1v_teardown` 在 `A1V_TORN=1` 那句**之前**多一條 `return`
#    ③ `bad()` 不再累加 FAIL(尾端 `exit 1` 就不成立了)
a1v_trap() {
  [ "$A1V_TORN" = "1" ] && return 0
  [ "${A1V_KEEP:-0}" = "1" ] && return 0
  [ -f "$MARK" ] || return 0
  [ -d "$WORK/pgdata" ] || return 0
  A1V_TORN=1
  local PGBIN
  PGBIN="$(dirname "$(command -v psql 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/psql)")"
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1 || true
  # 🔴 R2 F3:**停完要驗,否則訊息就是「量測失敗長得像成功」那一族在異常路徑的殘影**。
  #    postmaster 卡死時 `pg_ctl stop` 帶 `|| true` 會靜默通過,而訊息卻宣稱埠已釋放。
  if psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    echo "  🔴 異常退出:**cluster 沒停掉**(port $PORT 仍連得上)—— 請手動 pg_ctl -D $WORK/pgdata stop;workdir 保留。"
  else
    echo "  ⚠️  異常退出:已停掉 $WORK 的 cluster(實測 port $PORT 已連不上);**workdir 保留**供查證。"
  fi
}
trap a1v_trap EXIT

# ══ 共用動作 ═══════════════════════════════════════════════════════════════
drop_a1() {
  psql "$URL" -v ON_ERROR_STOP=1 -q > "$WORK/drop.log" 2>&1 <<'SQL'
DROP TABLE IF EXISTS public.order_item_quantity_summary;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_id_quantity_key;
SQL
  [ $? -eq 0 ] || { echo "🔴 drop_a1 失敗(fail-closed):$(tail -3 "$WORK/drop.log")"; exit 1; }
}

apply_mig() {  # $1 = migration 檔路徑
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$1" > "$WORK/apply.log" 2>&1
  local rc=$?
  cat "$WORK/apply.log"
  return $rc
}

log "1/10 抓外層 oracle 基準(order_items 的約束 / trigger / ACL,存在 shell 側,突變改不到)"
drop_a1
snapshot "SELECT conname||' :: '||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_items'::regclass ORDER BY conname" "$WORK/oi-constraints.base" "oi-constraints.base"
snapshot "SELECT tgname||' :: '||tgenabled::text||' :: '||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.order_items'::regclass AND NOT tgisinternal ORDER BY tgname" "$WORK/oi-triggers.base" "oi-triggers.base"
snapshot "SELECT coalesce(array_to_string(relacl,','),'(null)') FROM pg_class WHERE oid='public.order_items'::regclass" "$WORK/oi-acl.base" "oi-acl.base"
# 🔴 「本片零新函式」只能由外層證明(關卡2 R1 must-fix):migration 內部沒有「套用前」的
#    pg_proc 可比,只查 trigger 數的話,一支**沒掛 trigger 的**新函式會全綠溜過去。
# 🔴 **且必須掃所有非系統 schema**(R2 must-fix):原版只掃 public ⇒ 在 auth / extensions 等
#    schema 偷加函式一樣全綠。鍵含 schema + 名稱 + identity args + prokind。
snapshot "SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/'||p.prokind::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY 1" "$WORK/procs.base" "procs.base"
# 🔴 harness 自身突變:故意把快照 SQL 弄壞,snapshot() 必須當場中止,
#    而不是回一份「兩邊都是同一則錯誤」因此看起來零漂移的垃圾(R3 must-fix)。
( snapshot "SELECT this_column_does_not_exist FROM pg_class" "$WORK/selftest.snap" "自我測試" ) >/dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "🔴 harness 自我測試失敗:壞掉的快照 SQL 竟然沒有讓 snapshot() 中止"; exit 1
fi
ok "harness 自我測試:壞掉的快照 SQL 會當場中止(不會變成假的零漂移)"
ok "基準已存檔($(wc -l < "$WORK/oi-constraints.base") 條 order_items 約束)"

log "2/10 套用 A1 + 結構驗收(零突變必須綠)"
OUT="$(apply_mig "$MIG")"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'A1 結構驗收全數通過'; then
  ok "apply + 結構驗收綠"
else
  bad "apply 未通過(rc=$RC):$(echo "$OUT" | grep -m1 ERROR)"
fi

log "3/10 外層比對:order_items 除了新增那把唯一鍵之外,一個 byte 都沒變"
snapshot "SELECT conname||' :: '||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_items'::regclass ORDER BY conname" "$WORK/oi-constraints.after" "oi-constraints.after"
snapshot "SELECT tgname||' :: '||tgenabled::text||' :: '||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.order_items'::regclass AND NOT tgisinternal ORDER BY tgname" "$WORK/oi-triggers.after" "oi-triggers.after"
snapshot "SELECT coalesce(array_to_string(relacl,','),'(null)') FROM pg_class WHERE oid='public.order_items'::regclass" "$WORK/oi-acl.after" "oi-acl.after"

DIFF="$(diff <(cat "$WORK/oi-constraints.base") <(grep -v 'order_items_id_quantity_key' "$WORK/oi-constraints.after"))"
[ -z "$DIFF" ] && ok "order_items 既有約束零漂移" || bad "order_items 既有約束漂移:$DIFF"
grep -q 'order_items_id_quantity_key :: UNIQUE (id, quantity)' "$WORK/oi-constraints.after" \
  && ok "新唯一鍵形狀正確" || bad "新唯一鍵缺漏或形狀不符"
diff -q "$WORK/oi-triggers.base" "$WORK/oi-triggers.after" >/dev/null \
  && ok "order_items trigger 零漂移(名稱 + tgenabled + 定義)" || bad "order_items trigger 漂移"
diff -q "$WORK/oi-acl.base" "$WORK/oi-acl.after" >/dev/null \
  && ok "order_items ACL 零漂移" || bad "order_items ACL 漂移"
snapshot "SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/'||p.prokind::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY 1" "$WORK/procs.after" "procs.after"
diff -q "$WORK/procs.base" "$WORK/procs.after" >/dev/null \
  && ok "本片零新函式(全非系統 schema 的 pg_proc 差集為空)" \
  || bad "本片新增了函式:$(diff "$WORK/procs.base" "$WORK/procs.after" | head -3 | tr '\n' ' ')"

log "4/10 行為探針(零突變必須全綠)"
psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$PROBE" > "$WORK/probe.out" 2>&1
if [ $? -eq 0 ] && grep -q '行為探針 15/15 通過' "$WORK/probe.out" && grep -q '零殘留複驗通過' "$WORK/probe.out"; then
  ok "探針 14/14 + 零殘留"
else
  bad "探針未全綠:$(grep -m1 'ERROR:' "$WORK/probe.out")"
fi

log "5/10 真 create_order 回歸(證明加唯一鍵沒把結帳弄壞)"
# fixture 配方沿用 scripts/n3-verify.sh §4.1(已實跑定案),不自己發明。
# 🔴 誠實:這三件 fixture 是造出來的 ⇒ 本段是**煙霧測試**,不是「結帳真的能用」。
UID_FIX="$(runsql "SELECT customer_user_id FROM public.customer_addresses ORDER BY id LIMIT 1")"
ADDR="$(runsql "SELECT id FROM public.customer_addresses ORDER BY id LIMIT 1")"
VARIANT="$(runsql "SELECT id FROM public.product_variants ORDER BY sku LIMIT 1")"
TERMS="$(runsql "SELECT version FROM public.legal_terms_versions ORDER BY version DESC LIMIT 1")"
if [ -n "$UID_FIX" ] && [ -n "$ADDR" ] && [ -n "$VARIANT" ] && [ -n "$TERMS" ]; then
  runsql "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$SELECT '${UID_FIX}'::uuid\$\$" >/dev/null
  runsql "UPDATE public.product_variants SET price_general = 1500 WHERE id = '${VARIANT}'" >/dev/null
  OI_BEFORE="$(runsql "SELECT count(*) FROM public.order_items")"
  SUM_BEFORE="$(runsql "SELECT count(*) FROM public.order_item_quantity_summary")"
  CO_OUT="$(runsql "SELECT public.create_order(
      jsonb_build_array(jsonb_build_object('variant_id','${VARIANT}','qty',2)),
      '${ADDR}'::uuid, 'home', jsonb_build_object('type','personal','carrier','/ABC1234'),
      gen_random_uuid(), '${TERMS}', '127.0.0.1', 'a1-verify', 'probe@example.com')")"
  if echo "$CO_OUT" | grep -q 'display_id'; then
    ok "create_order 在 A1 之後仍能建單"
  else
    bad "create_order 失敗:$(echo "$CO_OUT" | head -2)"
  fi
  [ "$(runsql "SELECT count(*) FROM public.order_items")" = "$((OI_BEFORE + 1))" ] \
    && ok "order_items 正常 +1(新唯一鍵未擋住結帳)" || bad "order_items 筆數異常"
  # 🔴 惰性建列:結帳不該碰摘要表
  [ "$(runsql "SELECT count(*) FROM public.order_item_quantity_summary")" = "$SUM_BEFORE" ] \
    && ok "摘要表未被結帳觸碰(惰性建列成立)" || bad "結帳竟寫了摘要表"
else
  bad "create_order fixture 取值失敗(uid=$UID_FIX addr=$ADDR variant=$VARIANT terms=$TERMS)—— 不當作通過"
fi

# 抽出結構驗收 DO block 當突變靶
awk '/^DO \$\$$/{f=1} f{print} f && /^\$\$;$/{exit}' "$MIG" > "$WORK/a1-assert.sql"
[ -s "$WORK/a1-assert.sql" ] || { echo "🔴 抽不出結構驗收 DO block"; exit 1; }

# ══ 結構突變:DDL 破壞 → 跑斷言 → 必須紅在指定 ID ═══════════════════════════
s_mut() {  # $1=名稱 $2=DDL $3=期望的第一個 ERROR 片段
  local name="$1" ddl="$2" want="$3"
  { echo "BEGIN;"; echo "$ddl"; cat "$WORK/a1-assert.sql"; echo "ROLLBACK;"; } > "$WORK/m.sql"
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/m.sql" > "$WORK/m.out" 2>&1
  local rc=$? first
  first="$(grep -m1 'ERROR:' "$WORK/m.out")"
  if [ "$rc" -eq 0 ] || grep -q 'A1 結構驗收全數通過' "$WORK/m.out"; then
    bad "S:$name —— 突變未被抓到(假綠)"
  elif [ -z "$first" ]; then
    bad "S:$name —— 非零退出但無 ERROR 行(harness 自身問題)"
  elif ! printf '%s' "$first" | grep -qF "$want"; then
    bad "S:$name —— 紅在錯的地方(期望「$want」):$(printf '%s' "$first" | cut -c1-110)"
  else
    ok "S:$name → 命中「$want」"
  fi
}

log "6/10 結構突變(每條必須紅在自己那條斷言)"
T=public.order_item_quantity_summary
for c in oiqs_ordered_nonneg oiqs_instock_nonneg oiqs_cancelled_nonneg \
         oiqs_ordered_le_quantity oiqs_instock_le_ordered \
         oiqs_cancelled_le_quantity oiqs_instock_cancelled_le_quantity; do
  s_mut "刪除 $c" "ALTER TABLE $T DROP CONSTRAINT $c;" "A1-C-MISSING:$c"
done
s_mut "C5 邏輯反向(關鍵字全在)" \
  "ALTER TABLE $T DROP CONSTRAINT oiqs_instock_le_ordered;
   ALTER TABLE $T ADD CONSTRAINT oiqs_instock_le_ordered CHECK (instock_quantity >= ordered_quantity);" \
  "A1-C-DEF-MISMATCH:oiqs_instock_le_ordered"
s_mut "C7 拿掉 ::bigint" \
  "ALTER TABLE $T DROP CONSTRAINT oiqs_instock_cancelled_le_quantity;
   ALTER TABLE $T ADD CONSTRAINT oiqs_instock_cancelled_le_quantity CHECK (instock_quantity + cancelled_quantity <= quantity);" \
  "A1-C-DEF-MISMATCH:oiqs_instock_cancelled_le_quantity"
for col in ordered_quantity instock_quantity cancelled_quantity; do
  s_mut "$col DROP NOT NULL" "ALTER TABLE $T ALTER COLUMN $col DROP NOT NULL;" "A1-COL:$col"
  s_mut "$col DROP DEFAULT"  "ALTER TABLE $T ALTER COLUMN $col DROP DEFAULT;"  "A1-COL:$col"
  s_mut "$col 改 bigint"     "ALTER TABLE $T ALTER COLUMN $col TYPE bigint;"   "A1-COL:$col"
done
s_mut "quantity 給了 DEFAULT" "ALTER TABLE $T ALTER COLUMN quantity SET DEFAULT 1;" "A1-COL:quantity"
s_mut "多一欄" "ALTER TABLE $T ADD COLUMN sneaky integer;" "A1-COL-SET"
s_mut "額外第八條 CHECK(恆真)" "ALTER TABLE $T ADD CONSTRAINT sneaky_chk CHECK (true);" "A1-C-EXTRA"
s_mut "額外第八條 CHECK(過度限制 cancelled<=ordered)" \
  "ALTER TABLE $T ADD CONSTRAINT sneaky_over CHECK (cancelled_quantity <= ordered_quantity);" "A1-C-EXTRA"
s_mut "GRANT SELECT 給 authenticated" "GRANT SELECT ON TABLE $T TO authenticated;" "A1-ACL:authenticated.SELECT"
s_mut "GRANT SELECT 給 anon" "GRANT SELECT ON TABLE $T TO anon;" "A1-ACL:anon.SELECT"
s_mut "GRANT UPDATE 給 service_role" "GRANT UPDATE ON TABLE $T TO service_role;" "A1-ACL:service_role.UPDATE"
# 🔴 PG17 新增的第八種表權限。實測:授出去之後 has_table_privilege(...,'SELECT') 仍為 false
#    ⇒ 七格矩陣對它完全無感。這條突變存在的意義就是釘住那格。
s_mut "GRANT MAINTAIN 給 authenticated" "GRANT MAINTAIN ON TABLE $T TO authenticated;" "A1-ACL:authenticated.MAINTAIN"
s_mut "GRANT MAINTAIN 給 service_role" "GRANT MAINTAIN ON TABLE $T TO service_role;" "A1-ACL:service_role.MAINTAIN"
s_mut "column 級授權給 authenticated" "GRANT SELECT (ordered_quantity) ON TABLE $T TO authenticated;" "A1-ACL-COLUMN"
# 🔴 期望值要精確到 PUBLIC:GRANT TO PUBLIC 會讓 anon/authenticated 因**繼承**而變 true,
#    若斷言順序或期望值放寬成模糊的 "A1-ACL:",把真正的 PUBLIC 那條斷言整個刪掉仍會綠
#    (紅的是 anon.SELECT)。migration 已把 PUBLIC 檢查移到角色矩陣之前。
s_mut "授權給 PUBLIC" "GRANT SELECT ON TABLE $T TO PUBLIC;" "A1-ACL:PUBLIC 直接授權應為 0"
s_mut "關掉 RLS" "ALTER TABLE $T DISABLE ROW LEVEL SECURITY;" "A1-RLS-OFF"
s_mut "加一條 RLS policy" "CREATE POLICY sneaky ON $T FOR SELECT USING (true);" "A1-RLS-POLICY"
s_mut "FK 退化成單欄(去正規化不再被釘死)" \
  "ALTER TABLE $T DROP CONSTRAINT order_item_quantity_summary_item_fk;
   ALTER TABLE $T ADD CONSTRAINT order_item_quantity_summary_item_fk
     FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;" \
  "A1-FK-SHAPE"
s_mut "FK 改成 NO ACTION" \
  "ALTER TABLE $T DROP CONSTRAINT order_item_quantity_summary_item_fk;
   ALTER TABLE $T ADD CONSTRAINT order_item_quantity_summary_item_fk
     FOREIGN KEY (order_item_id, quantity) REFERENCES public.order_items(id, quantity);" \
  "A1-FK-SHAPE"
# 🔴 這條專門證明「不依賴字串的 FK 實體斷言」有用(R2 must-fix):
#    把 search_path 換成 a1_evil 優先,pg_get_constraintdef 就會把 a1_evil.order_items
#    印成**未加 schema 的 `order_items`** ⇒ **逐字比對照樣通過**,只有 confrelid 那道抓得到。
s_mut "FK 指向別 schema 的同名表(逐字比對騙得過)" \
  "CREATE SCHEMA a1_evil;
   CREATE TABLE a1_evil.order_items (id uuid, quantity integer, CONSTRAINT ev_uq UNIQUE (id, quantity));
   ALTER TABLE $T DROP CONSTRAINT order_item_quantity_summary_item_fk;
   SET LOCAL search_path = a1_evil, public;
   ALTER TABLE $T ADD CONSTRAINT order_item_quantity_summary_item_fk
     FOREIGN KEY (order_item_id, quantity) REFERENCES a1_evil.order_items(id, quantity) ON DELETE CASCADE;
   SET LOCAL search_path = public;" \
  "A1-FK-SHAPE"

# 🔴 自訂 grantee 斷言的專屬突變(R2 must-fix:原本這道判官從未被證明)
s_mut "授權給第三個 role" \
  "CREATE ROLE a1_third NOLOGIN;
   GRANT SELECT ON TABLE $T TO a1_third;" \
  "A1-ACL:出現非預期 grantee"

# 🔴 拿掉主鍵(R2 must-fix:原本 56 條全綠也擋不住「一個品項兩列」)
s_mut "拿掉主鍵" "ALTER TABLE $T DROP CONSTRAINT order_item_quantity_summary_pkey CASCADE;" "A1-PK"
# (「order_item_id 改可空」這條突變已移除:PG 不允許對主鍵欄 DROP NOT NULL
#   ⇒ 它永遠紅在 PG 自己的錯誤訊息、證明不了我的斷言。該面向由「拿掉主鍵」那條覆蓋。)

s_mut "摘要表被塞了一列" \
  "INSERT INTO $T (order_item_id, quantity) SELECT id, quantity FROM public.order_items LIMIT 1;" \
  "A1-ROWS"
s_mut "order_items 被加 trigger" \
  "CREATE FUNCTION public.a1noop() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
   CREATE TRIGGER a1_sneaky BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.a1noop();" \
  "A1-OI-TRIGGER-DRIFT"
# 🔴 這兩條原本寫成 DROP CONSTRAINT,實測**被相依的 FK 擋在 DDL 階段**
#    (order_cancellation_items / order_refund_items / 本片的複合 FK 都依賴它們)
#    ⇒ 紅在 "cannot drop constraint … because" 而不是我的斷言 = 判別力沒被證明。
#    改用 RENAME:斷言照樣查不到那個名字,且不必 CASCADE 連帶動到別人的 FK。
s_mut "order_items 既有唯一鍵被改名" \
  "ALTER TABLE public.order_items RENAME CONSTRAINT order_items_order_id_id_key TO oi_renamed_key;" \
  "A1-OI-CONSTRAINT-DRIFT"
s_mut "新唯一鍵被改名" \
  "ALTER TABLE public.order_items RENAME CONSTRAINT order_items_id_quantity_key TO oi_renamed_key2;" \
  "A1-OI-UNIQUE-MISSING"

# ══ 行為突變:改 migration 檔 → **剝掉結構驗收** → 套用 → 跑探針 ═════════════
# 🔴 剝掉結構驗收是刻意的:否則逐字比對會先擋下,行為探針的判別力永遠沒被證明。
strip_assert() { awk '/^DO \$\$$/{f=1} f && /^\$\$;$/{f=0; next} !f' "$1"; }

b_mut() {  # $1=名稱 $2=sed 表達式 $3=期望探針錯誤片段
  local name="$1" sedexpr="$2" want="$3"
  if ! sed "$sedexpr" "$MIG" > "$WORK/mig-mut-raw.sql" 2>"$WORK/sed.err"; then
    bad "B:$name —— sed 執行失敗:$(head -1 "$WORK/sed.err")"; return
  fi
  if cmp -s "$MIG" "$WORK/mig-mut-raw.sql"; then
    bad "B:$name —— sed 沒改到任何東西(零突變卻要宣稱抓到)"; return
  fi
  # 🔴 產物健全性:空檔或缺 CREATE TABLE 的檔案,psql 會安靜回傳 0
  #    ⇒ 「apply 成功」變成假的,探針紅在「表不存在」而被計成一次有效突變。
  if [ ! -s "$WORK/mig-mut-raw.sql" ] || ! grep -q 'CREATE TABLE public.order_item_quantity_summary' "$WORK/mig-mut-raw.sql"; then
    bad "B:$name —— 突變產物不健全(空檔或缺 CREATE TABLE);拒絕當作一次突變"; return
  fi
  strip_assert "$WORK/mig-mut-raw.sql" > "$WORK/mig-mut.sql"
  drop_a1
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/mig-mut.sql" > "$WORK/bapply.log" 2>&1
  if [ $? -ne 0 ]; then
    bad "B:$name —— 突變版 migration 套不上(harness 問題):$(grep -m1 ERROR "$WORK/bapply.log" | cut -c1-100)"
  else
    psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$PROBE" > "$WORK/bprobe.out" 2>&1
    local rc=$? first
    first="$(grep -m1 'ERROR:' "$WORK/bprobe.out")"
    if [ "$rc" -eq 0 ]; then
      bad "B:$name —— 突變後探針仍全綠(假綠)"
    elif ! printf '%s' "$first" | grep -qF "$want"; then
      bad "B:$name —— 探針紅在錯的地方(期望「$want」):$(printf '%s' "$first" | cut -c1-110)"
    else
      ok "B:$name → 探針命中「$want」"
    fi
  fi
  drop_a1; apply_mig "$MIG" >/dev/null
}

log "6b/10 偷加函式突變(證明 pg_proc 外層基準抓得到「沒掛 trigger 的新函式」)"
drop_a1
snapshot "$PROCQ" "$WORK/procs.fnbase" "procs.fnbase"
awk '/^COMMIT;$/ && !done {print "CREATE FUNCTION public.a1_sneaky_fn() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$SELECT 1$fn$;"; done=1} {print}' "$MIG" > "$WORK/mig-fn.sql"
if cmp -s "$MIG" "$WORK/mig-fn.sql"; then
  bad "偷加函式突變:awk 沒插入任何東西"
else
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/mig-fn.sql" > "$WORK/fnapply.log" 2>&1
  if [ $? -ne 0 ]; then
    bad "偷加函式突變:突變版套不上(harness 問題):$(grep -m1 ERROR "$WORK/fnapply.log" | cut -c1-90)"
  else
    snapshot "SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/'||p.prokind::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY 1" "$WORK/procs.fnafter" "procs.fnafter"
    if diff -q "$WORK/procs.fnbase" "$WORK/procs.fnafter" >/dev/null; then
      bad "偷加函式突變 —— pg_proc 差集沒抓到(假綠)"
    else
      ok "偷加函式突變 → pg_proc 差集抓到 a1_sneaky_fn"
    fi
  fi
fi
runsql "DROP FUNCTION IF EXISTS public.a1_sneaky_fn()" >/dev/null

# 🔴 非 public schema 的同款突變(R2 must-fix:原版只掃 public,這條會漏)
drop_a1
snapshot "$PROCQ" "$WORK/procs.fnbase2" "procs.fnbase2"
awk '/^COMMIT;$/ && !done {print "CREATE SCHEMA IF NOT EXISTS a1_evil;"; print "CREATE FUNCTION a1_evil.sneaky() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$SELECT 1$fn$;"; done=1} {print}' "$MIG" > "$WORK/mig-fn2.sql"
if cmp -s "$MIG" "$WORK/mig-fn2.sql"; then
  bad "非 public 偷加函式突變:awk 沒插入任何東西"
else
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/mig-fn2.sql" > "$WORK/fnapply2.log" 2>&1
  if [ $? -ne 0 ]; then
    bad "非 public 偷加函式突變:突變版套不上:$(grep -m1 ERROR "$WORK/fnapply2.log" | cut -c1-90)"
  else
    snapshot "$PROCQ" "$WORK/procs.fnafter2" "procs.fnafter2"
    if diff -q "$WORK/procs.fnbase2" "$WORK/procs.fnafter2" >/dev/null; then
      bad "非 public 偷加函式突變 —— pg_proc 差集沒抓到(假綠)"
    else
      ok "非 public 偷加函式突變 → 差集抓到 a1_evil.sneaky"
    fi
  fi
fi
runsql "DROP SCHEMA IF EXISTS a1_evil CASCADE" >/dev/null
drop_a1; apply_mig "$MIG" >/dev/null

log "7/10 行為突變(剝掉結構驗收,單獨證明探針的判別力)"
# 🔴 期望落點是 N1 而不是 N4:把 C5 反向之後,N1(instock=-1, ordered=0)對
#    `instock >= ordered` 也不成立 ⇒ N1 先撞上、回報的 constraint 變成 oiqs_instock_le_ordered。
#    探針按序執行 ⇒ 最早受影響的案例才是確定落點。硬要寫 N4 就是在猜。
b_mut "C5 邏輯反向" \
  's/CHECK (instock_quantity <= ordered_quantity)/CHECK (instock_quantity >= ordered_quantity)/' \
  "A1-PROBE-WRONG-CONSTRAINT:N1"
b_mut "C7 弱化成只比 instock" \
  's/CHECK (instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint)/CHECK (instock_quantity <= quantity)/' \
  "A1-PROBE-FAIL:N5"
b_mut "C7 拿掉 ::bigint(溢位路徑)" \
  's/instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint/instock_quantity + cancelled_quantity <= quantity/' \
  "integer out of range"
b_mut "偷加 cancelled <= ordered(過度限制)" \
  's/CONSTRAINT oiqs_cancelled_nonneg CHECK (cancelled_quantity >= 0),/CONSTRAINT oiqs_cancelled_nonneg CHECK (cancelled_quantity >= 0),\n  CONSTRAINT oiqs_over CHECK (cancelled_quantity <= ordered_quantity),/' \
  "A1-PROBE-OVER-RESTRICT:P4"
# 🔴 原版想用一個跨行 sed 匹配 FK 的兩行定義 —— sed 逐行處理、匹配不到,
#    結果是「零突變卻宣稱抓到」。cmp 守門當場攔下(這正是它存在的理由)。改成兩個單行表達式。
b_mut "FK 退化成單欄(去正規化不再被釘死)" \
  's/FOREIGN KEY (order_item_id, quantity)/FOREIGN KEY (order_item_id)/; s/REFERENCES public.order_items (id, quantity)/REFERENCES public.order_items (id)/' \
  "A1-PROBE-FAIL:F1"

log "8/10 探針自身突變(證明探針不會自己假綠)"
# 🔴 原版用 sed 改「所有」符合的行,而 N5 與 N6 的判官字串一模一樣
#    ⇒ 同時改到兩處,判定又只 grep 任意 WRONG-CONSTRAINT ⇒ **N5 的判官死了也會由 N6 代打轉紅**。
#    改成 perl 只換第一處(= N5),並斷言「恰好一行不同」+ 第一個錯誤精確含 N5。
perl -0pe "s/IF v_con <> 'oiqs_instock_cancelled_le_quantity' THEN/IF v_con <> 'A1_WRONG_NAME' THEN/" "$PROBE" > "$WORK/probe-mut.sql"
NDIFF="$(diff "$PROBE" "$WORK/probe-mut.sql" | grep -c '^[<>]')"
if [ "$NDIFF" -ne 2 ]; then
  bad "探針自身突變:應恰好改動 1 行(diff 兩側共 2 行),實際 $NDIFF —— 可能同時改到 N5 與 N6"
else
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/probe-mut.sql" > "$WORK/pm.out" 2>&1
  PMRC=$?
  PMFIRST="$(grep -m1 'ERROR:' "$WORK/pm.out")"
  if [ "$PMRC" -eq 0 ]; then
    bad "探針自身突變後仍綠(探針假綠)"
  elif ! printf '%s' "$PMFIRST" | grep -qF 'A1-PROBE-WRONG-CONSTRAINT:N5'; then
    bad "探針自身突變 —— 紅在錯的地方(期望 N5):$(printf '%s' "$PMFIRST" | cut -c1-110)"
  else
    ok "探針自身突變 → N5 的判官自己轉紅(且只改動一行)"
  fi
fi

log "9/10 對照組(零突變必須全綠;沒有對照組,全紅毫無意義)"
drop_a1
OUT="$(apply_mig "$MIG")"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'A1 結構驗收全數通過'; then
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$PROBE" > "$WORK/ctrl.out" 2>&1
  [ $? -eq 0 ] && ok "對照組:結構 + 行為皆綠" || bad "對照組探針紅了:$(grep -m1 ERROR "$WORK/ctrl.out")"
else
  bad "對照組 apply 失敗"
fi

# ══ 10/10 teardown(plan §3.5a 拍板)══════════════════════════════════════════
log "10/10 跑完即 teardown(專屬 port $PORT;不把斷裂態留給下一個人)"
# 🔴 **先把「斷裂態真的存在」量出來,再拆**:沒有這一步,teardown 只是一個沒人知道為何存在的動作,
#    下一棒會覺得它多餘而拿掉。這裡不是描述風險,是**觀察**它。
# 🔴🔴 **量測失敗必須紅,不得長得像「沒有那個斷裂面」**(R1 must-fix 1):第一版把 psql 的錯誤
#    `2>/dev/null` 吞掉、空字串落進「沒有 trigger」那一支照樣印 ✅ —— 那是本 repo 記過的同一族
#    (`feedback_guard-checks-existence-not-effect` / 「量測失敗長得像乾淨結果」)。
#    ⇒ 兩個查詢各自接 rc,任一非零或回空 ⇒ **判紅**,不進分支。
TD_COLS="$(psql "$URL" -qtAc "SELECT coalesce(string_agg(column_name, ',' ORDER BY ordinal_position), '<無此表>') FROM information_schema.columns WHERE table_schema='public' AND table_name='order_item_quantity_summary'" 2>"$WORK/td-cols.err")"
TD_COLS_RC=$?
TD_TRIG="$(psql "$URL" -qtAc "SELECT count(*) FROM pg_trigger WHERE tgname='shipments_summary_recompute_ac' AND NOT tgisinternal" 2>"$WORK/td-trig.err")"
TD_TRIG_RC=$?
if [ "$TD_COLS_RC" -ne 0 ] || [ "$TD_TRIG_RC" -ne 0 ] || [ -z "$TD_COLS" ] || [ -z "$TD_TRIG" ]; then
  bad "斷裂態偵測:量測本身失敗(cols rc=$TD_COLS_RC / trig rc=$TD_TRIG_RC)—— fail-closed 判紅,**不當成「沒有那個斷裂面」**
     $(head -1 "$WORK/td-cols.err" 2>/dev/null)$(head -1 "$WORK/td-trig.err" 2>/dev/null)"
else
  case "$TD_TRIG" in
    1)
      case "$TD_COLS" in
        *shipped_quantity*)
          bad "斷裂態偵測:S2b trigger 在、摘要表也有 shipped_quantity —— 與 2026-08-07 的實測相反,teardown 的理由要重新查證" ;;
        *)
          ok "斷裂態實證:S2b 的 shipments 重算 trigger 存在,但摘要表欄位 = [$TD_COLS](**缺 shipped_quantity**)
     ⇒ 本支跑完的庫對別的 harness 是壞的 —— teardown 不是可選項,是這一格的理由" ;;
      esac ;;
    0)
      ok "斷裂態偵測:本次 migration 前綴不含 B2-S2b 的重算 trigger(tgcount=0)⇒ 沒有那個斷裂面;teardown 照跑" ;;
    *)
      bad "斷裂態偵測:trigger 計數是 [$TD_TRIG](只接受 0 或 1)—— 觀察值超出預期,判紅" ;;
  esac
fi
# 🔴 **這一格今天恆走同一支**(R1 nit 6,誠實列):真實流程下 trigger 恆在、`shipped_quantity` 恆不在。
#    另外兩支(欄位竟然在 / 計數不是 0 或 1)**沒有任何突變靶證明它們紅得起來** ——
#    它們是給「哪天 a1-verify 不再 drop 掉摘要表」的保險,不是已被證明的判別力。

if [ "${A1V_KEEP:-0}" = "1" ]; then
  # 🔴 R1 nit 9:這一支**不計分** ⇒ 帶 A1V_KEEP 時 PASS 會比正常路徑少 1(63 → 62)。寫在這裡,
  #    免得下一棒拿兩條路徑的 PASS 數互相對照而誤以為有格漏跑。
  echo "  ⚠️  A1V_KEEP=1 ⇒ **跳過 teardown**(本段少計 1 分)。$WORK 的 cluster 仍活在 port $PORT,"
  echo "     而且很可能處於上面那個**斷裂態** —— 別讓其他 harness 連上去,查完請自己停掉。"
else
  a1v_teardown
fi

echo
# 🔴 2026-08-11 W-b:總結行的 `PASS=n FAIL=n` 之間**不能有 ` / `** —— w7-coverage 的 recorder
#    用 `sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/…/p'` 取值,舊字面 `PASS=n / FAIL=n`
#    解析不到 ⇒ 收據記成 `PASS=0 FAIL=-1` 恆紅。**只改分隔字元,判定邏輯與 exit code 未動。**
echo "════════ A1 驗證結果:PASS=$PASS FAIL=$FAIL ════════"
[ "$FAIL" -eq 0 ] || exit 1
