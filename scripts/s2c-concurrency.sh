#!/usr/bin/env bash
# S2-C · admin_upsert_supplier 併發 harness(兩連線 + barrier)
#
# 用法:bash scripts/s2c-concurrency.sh [<work-dir>]     預設 /tmp/s2-work
#   前置:bash scripts/d1t2-rehearsal.sh provision /tmp/s2-work
#
# 🔴 **必須序列跑,不得與別的 harness 或另一份自己併行** ——
#    §B 的突變是 **committed DDL**(併發測試需要兩個 session 看得到彼此,交易內的
#    CREATE OR REPLACE 對另一條連線不可見)。突變視窗內 **`s2-verify.sh` 會真的讀到被改壞的函式**
#    (它是唯一呼叫這支 RPC 的兄弟 harness);`s1a/s1b-verify.sh` 不呼叫 RPC,
#    受影響的是目標列短暫叫 L1、以及還原用的 ALTER TABLE 表鎖。
#
# 要證的事:函式體的 `SELECT … FOR UPDATE` 真的把同一家的並行改動序列化。
# s2-verify.sh 對它只有**文字層**斷言(prosrc 裡那個字還在)⇒ 拿掉它,那 77 條除了那一條
# 之外一條都不會紅。本 harness 補的就是「拿掉會怎樣」。
#
# 🔴 為什麼情境要設計成「B 把名字改回原值」:
#   單純問「B 會不會卡住」**沒有判別力** —— 就算拿掉 FOR UPDATE,只要 B 改的是**不同**的值,
#   它的 `UPDATE … WHERE id=X` 照樣會卡在 A 的列鎖上(卡住是 UPDATE 給的,不是 FOR UPDATE 給的)。
#   把 B 的目標值設成**原值 L0** 之後兩條路才分岔:
#     真函式  → B 卡在 SELECT FOR UPDATE;A commit 後讀到 before=L1 ⇒ L0≠L1 ⇒ UPDATED、改名生效
#     拿掉後  → B 讀到 stale before=L0 ⇒ L0=L0 ⇒ **NO_CHANGE 在任何寫入之前就返回**
#               ⇒ 不卡、零稽核列,且 A commit 後列上留著 L1 ⇒ **B 的改名整個遺失**(lost update)
#
# 🔴 誠實邊界:情境① 突變翻面的是 **1 個根因、4 個彼此相關的症狀**,不是 4 個獨立證據。
#   根因 = B 讀到 stale 快照。由它單向推出:`NO_CHANGE`(migration `:262-264` 判等)
#   → 提早返回 ⇒ 不進 UPDATE ⇒ **不卡**、且 `:284` 的稽核 INSERT 走不到 ⇒ **零稽核列**
#   → 沒有人寫回 L0 ⇒ **端狀態留 L1**。四條都留著是為了讓「壞掉的樣子」以業務語言被看見。
#
# 🔴 情境②「B 改成第三個值 L2、同時 A 把這家停用」—— R3 換模型審查指出:**這個變體壞得更兇**,
#   而它原本不在規格的三格裡。差別在於情境② **所有表面訊號都正常**:
#     真函式 → B 被擋 → before=(L1,false) → 寫 L2、is_active 維持 false、稽核 before=L1
#     拿掉後 → B 讀 stale (L0,true) → UPDATE 仍會卡在 A 的列鎖、A commit 後經 EPQ 照樣寫進去
#              ⇒ **回傳碼一樣是 UPDATED、端狀態 label 一樣是 L2**,但
#              ① 稽核列宣稱「從 L0 改成 L2」= **偽造歷史**(真相是那一刻的值是 L1)
#              ② `coalesce(p_is_active, v_before.is_active)` 吃到 stale 的 true
#                 ⇒ **把 A 剛停用的供應商靜默翻回啟用**
#   ⇒ 情境② 的判別力**只在稽核 before 與 is_active 兩個欄位上**;情境① 靠「卡不卡 / 回傳碼」
#   的那套訊號在這裡**全部失效**。鑑識上缺一列比不上被寫進一列假的,故補成第二個情境、不記成債。
#
# 🔴 barrier,不是賽跑:A 由 FIFO 餵指令,**在我們對 B 做出「被擋住 / 沒被擋住」的判定之前
#   不會 commit**(commit 寫進 FIFO 的時點嚴格晚於 barrier② 迴圈結束)。
#   ⇒「B 在 A 的交易還開著時就跑完了」是硬事實,不含時間假設。
#   輪詢只用來**正向觀察**,而且用 `pg_blocking_pids()` 綁定「擋住 B 的就是 A」——
#   只問「B 有沒有在等某把鎖」會被第三方 DDL 鎖代打(codex 關卡2 抓)。
#   沒觀察到一律當 FAIL,絕不靜靜算過(memory feedback_race-test-without-barrier-proves-nothing)。
#
# 🔴 「零留痕」只到**業務欄位與物件定義**這一層:目標列三欄還原成快照、函式定義 md5 回原值、
#   本 harness 寫的稽核列刪掉。MVCC 的 xmin / WAL / 統計 / plan cache 失效**留得下來**,
#   本 harness 不宣稱清得掉那些。
#
# 🔴🔴 **本 harness 沒測什麼**(全綠**不等於**「併發已經測過了」;R3 抓:不列出來就會被外推):
#   · **新增路徑的撞名競速** —— 兩條連線同時新增同一個 label。migration `:223` 自陳
#     「同名(含與並行 session 撞名)= 業務結果」,那句宣稱**目前沒有任何測試背書**;
#     它靠的是唯一索引而不是 FOR UPDATE,本 harness 完全沒碰。
#   · **跨家競速**(A 改甲家、B 改乙家撞成同一個 label)、**停用 vs 改名**的交錯。
#   · **PostgREST / service_role 那一層** —— 本 harness 以 owner 直連。正式站的 B 走
#     PostgREST + 角色層 `statement_timeout`,「被擋住」在那裡的表現可能是 `57014` 直接炸到 UI,
#     而不是這裡看到的「等待然後成功」。migration `:58-60` 已把它登記為債,本片不改變那個狀態。
#   · 只測 26 家 seed 裡的一家、一種 locale、一顆本機庫。

set -uo pipefail

WORK="${1:-/tmp/s2-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
FNSIG="public.admin_upsert_supplier(uuid,text,boolean,text,text,text)"
TARGET='FOWLER'                 # 只出現在 s1a-verify.sh:137 的 seed 名單斷言裡,無 harness 拿它當工作對象
                                # (AKOSO 被 s1a 的 touch 突變格用掉、PROTI 被 s1b/s2 用掉)
L1="FOWLER-s2cA"                # A 要改成的新名(必須不撞既有 26 名)
L2="FOWLER-s2cB"                # 情境② 裡 B 要改成的第三個名
TAG="s2c-$$"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -tAX -c "$1" 2>&1; }

# 🔴 探針一律走這支,不走 q():q() 併了 stderr 且無 ON_ERROR_STOP ⇒ psql 只要報錯,
#    回傳的錯誤字串在 `!= "0"` 的判定下會被當成「有觀察到」= 探針恆真、格1 假綠。
#    只認「rc=0 且輸出是純數字」;其餘(錯誤、空字串、**rc 非 0 但仍印出數字**)一律回 -1。
#    rc 那半是 codex 關卡2 抓的:連線中途死掉可能已印出位元組又非零退出。
probe_count() {
  local out rc
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$1" 2>/dev/null)"; rc=$?
  [ "$rc" -ne 0 ] && { printf '%s' "-1"; return 0; }
  case "$out" in
    ''|*[!0-9]*) printf '%s' "-1" ;;
    *)           printf '%s' "$out" ;;
  esac
}

# ── 身分閘(對齊 s1a/s2-verify:marker + data_directory + db 名三重)─────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下 —— 這不是本 harness 的拋棄式庫;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
# 🔴 整個分岔推理建立在 READ COMMITTED 上(REPEATABLE READ 下突變版的 B 會直接撞
#    serialization failure、症狀完全不同)⇒ 隔離級別是前提,不是背景知識,開跑前釘死。
ISO="$(q "SHOW default_transaction_isolation")"
[ "$ISO" = "read committed" ] || { echo "🔴 default_transaction_isolation=$ISO,本 harness 的分岔只在 read committed 成立;拒跑"; exit 1; }

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/s2c.XXXXXX")" || exit 1
FIFO="$TMPD/a.fifo"
A_PID=""; B_PID=""; P0_PID=""; P1_PID=""; P2_PID=""; MUTATED=0; SIGNALLED=0

# ── 快照:目標列的原狀 + 原函式定義 ──────────────────────────────
SUP_ID="$(q "SELECT id FROM public.suppliers WHERE label = '$TARGET'")"
[ -n "$SUP_ID" ] || { echo "🔴 找不到供應商 $TARGET;拒跑"; exit 1; }
ORIG_ACTIVE="$(q "SELECT is_active FROM public.suppliers WHERE id = '$SUP_ID'")"
ORIG_UPDATED="$(q "SELECT updated_at FROM public.suppliers WHERE id = '$SUP_ID'")"
# 快照本身是還原的唯一依據 ⇒ 抓歪了要當場停,不能拖到 restore_row 才炸
case "$ORIG_ACTIVE" in t|f) : ;; *) echo "🔴 快照 is_active 非 t/f(實得 '$ORIG_ACTIVE');拒跑"; exit 1 ;; esac
[ -n "$ORIG_UPDATED" ] && [ "${ORIG_UPDATED#*ERROR}" = "$ORIG_UPDATED" ] \
  || { echo "🔴 快照 updated_at 取得失敗(實得 '$ORIG_UPDATED');拒跑"; exit 1; }
# 🔴 restore_row 會無條件把 touch trigger 開回 'O'。若開跑前它本來就不是 'O',
#    那不是還原、是**把庫改成別的樣子**而且 §C 仍會全綠 ⇒ 開跑前釘死,不做「還原成非 O」這件事。
[ "$(probe_count "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'suppliers'
         AND t.tgname = 'suppliers_touch_updated_at' AND t.tgenabled = 'O'")" = "1" ] \
  || { echo "🔴 suppliers_touch_updated_at 開跑前不是啟用('O')狀態;還原邏輯會把它改成 O = 污染;拒跑"; exit 1; }
# 前一次跑被 SIGKILL 的殘留會讓 §C 的「已清空」變成謊話(它只看自己這輪的 $$ 前綴)⇒ 開跑前先擋
[ "$(probe_count "SELECT count(*) FROM public.admin_audit_log WHERE request_id LIKE 's2c-%'")" = "0" ] \
  || { echo "🔴 庫裡已有 s2c-% 的稽核殘留(前一次跑沒善終)⇒ 先清乾淨再跑;拒跑"; exit 1; }

# 🔴 第六道閘(R3 抓):前一次跑被 SIGKILL 死在突變視窗、而列與稽核剛好乾淨時,上面五道全會通過,
#    接著 fn-orig.sql 就會把**壞掉的版本**快照成「原值」⇒ 之後每一輪都以壞版本為基準、
#    §B 只會抱怨「anchor 出現 0 次」而不是指出真正的問題。開跑前先確認函式還是好的。
[ "$(probe_count "SELECT (pg_catalog.length(pg_get_functiondef('$FNSIG'::regprocedure))
       - pg_catalog.length(pg_catalog.replace(pg_get_functiondef('$FNSIG'::regprocedure), 'FOR UPDATE', '')))
       / pg_catalog.length('FOR UPDATE')")" = "1" ] \
  || { echo "🔴 函式現在不含恰好 1 處 FOR UPDATE ⇒ 上一次跑可能死在突變視窗。
   救援:psql \"$URL\" -f <(psql \"$URL\" -tAX -c \"SELECT pg_get_functiondef('$FNSIG'::regprocedure)\") 不可用,
   請改用 supabase/migrations/20260801160000_m4b_e10_s2_admin_upsert_supplier.sql 重放該函式,或重建演練庫:
   bash scripts/d1t2-rehearsal.sh provision $WORK;拒跑"; exit 1; }

psql "$URL" -tAX -o "$TMPD/fn-orig.sql" -c "SELECT pg_get_functiondef('$FNSIG'::regprocedure)" >/dev/null 2>&1
test -s "$TMPD/fn-orig.sql" || { echo "🔴 抓不到原函式定義;拒跑"; exit 1; }
ORIG_MD5="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"

# ── 還原原語 ────────────────────────────────────────────────
# 🔴 fail-closed:原本這支把輸出與 rc 全丟 /dev/null 且無條件 MUTATED=0
#    ⇒ 還原失敗時零回報、突變版函式留在庫裡。還原是零留痕的承重點,不得靜默。
restore_fn() {
  local out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$TMPD/fn-orig.sql" 2>&1)"
  if [ $? -ne 0 ]; then
    bad "restore_fn 執行失敗 — $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"
    return 1
  fi
  if [ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" != "$ORIG_MD5" ]; then
    bad "restore_fn 跑完但 md5 仍不等於原值 —— 這顆庫的函式還是壞的"
    return 1
  fi
  MUTATED=0
  return 0
}

# 還原目標列到快照:touch trigger 會把 updated_at 推走 ⇒ 單一交易內停用→改→啟用
# (原子性由交易保證:中途死掉不會留下 trigger 被關著的庫)
# 🔴 曾經靜默失敗過一次:`q()` 對 boolean 回 `t`,拼進 SQL 變成 `is_active = t`(不存在的欄位)
#    ⇒ 整個交易中止、而輸出被 /dev/null 吞掉 ⇒ 污染了兄弟 harness 卻全綠。現改 fail-closed。
# 🔴 lock_timeout:被中斷時另一條 backend 可能還握著這一列的鎖,沒有上限會讓 EXIT trap 永久掛住。
restore_row() {
  local out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1 <<SQL
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.suppliers DISABLE TRIGGER suppliers_touch_updated_at;
UPDATE public.suppliers
   SET label = '$TARGET', is_active = '$ORIG_ACTIVE'::boolean, updated_at = '$ORIG_UPDATED'::timestamptz
 WHERE id = '$SUP_ID';
ALTER TABLE public.suppliers ENABLE TRIGGER suppliers_touch_updated_at;
DELETE FROM public.admin_audit_log WHERE request_id LIKE 's2c-%';
COMMIT;
SQL
)"
  if [ $? -ne 0 ]; then
    bad "restore_row 失敗(零留痕沒發生)— $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"
    return 1
  fi
  return 0
}

kill_bg() {   # 殺前先確認那個 PID 真的是 psql(memory:kill -9 \$! 可能殺到子 shell)
  local pid="$1"
  [ -n "$pid" ] || return 0
  ps -p "$pid" -o command= 2>/dev/null | grep -q psql || return 0
  kill "$pid" 2>/dev/null || true
}

# 🔴 trap 必須自己決定退出碼:還原失敗時 bad() 只會在摘要**之後**印一行,
#    而 `exit 1` 早就判定完了 ⇒ 會出現「退出碼 0 + 資料髒」。
cleanup() {
  local rc=$?
  [ "$SIGNALLED" = "1" ] && { rc=130; echo "🔴 被中斷 —— 執行還原後以非零退出(中斷跑不得看起來像成功)"; }
  exec 8>&- 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  # 🔴 P0 握著目標列的 FOR UPDATE 且在等 FIFO 的 EOF;不殺它就 restore_row,
  #    UPDATE 會卡在它的列鎖上、而它要等 shell 結束 ⇒ EXIT trap 互相等到天荒地老。
  kill_bg "$A_PID"; kill_bg "$B_PID"; kill_bg "$P0_PID"; kill_bg "$P1_PID"; kill_bg "$P2_PID"
  # 🔴 有界等待,不用裸 `wait`:child 若沒被 TERM 收掉,裸 wait 會讓 cleanup 卡在還原之前
  #    (codex 關卡2 抓)。process 一旦成為 zombie,連線就已關閉、鎖已釋放 ⇒ 對還原而言夠了。
  local w
  for w in $(seq 1 100); do
    ps -p "${A_PID:-0}" -p "${B_PID:-0}" -p "${P0_PID:-0}" -p "${P1_PID:-0}" -p "${P2_PID:-0}" \
       -o stat= 2>/dev/null | grep -qv 'Z' || break
    sleep 0.05
  done
  [ "$MUTATED" = "1" ] && { restore_fn || rc=1; }
  restore_row || rc=1
  rm -rf "$TMPD"
  exit "$rc"
}
# 🔴 EXIT 單獨掛不夠:未被 trap 的 SIGTERM/SIGINT/SIGHUP 會讓 shell 直接死、EXIT trap **根本不執行**
#    ⇒ 突變視窗內被 Ctrl-C / kill / 關掉終端機就會把改壞的函式留在庫裡。
#    HUP 是 codex 關卡2 補的:關終端機是最真實的那一種。
# 🔴 signal handler 不直接做還原,只立旗標 + exit ⇒ 由 EXIT trap 統一還原,避免還原邏輯有兩份;
#    `exit 130` 也讓中斷跑不會回報成退出碼 0(實測過:只掛 EXIT 時 trap 進來 `$?` 是最後一句
#    指令的狀態、不是信號 ⇒ 中斷後照樣 exit 0)。
trap 'SIGNALLED=1; exit 130' INT TERM HUP
trap cleanup EXIT

probe_waiting() {   # 這個 app 有沒有在等**任何**一把沒被授予的鎖(寬:給負向控制用)
  probe_count "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE a.application_name = '$1' AND NOT l.granted"
}
# 🔴 格1 用這支,不用 probe_waiting:只問「有在等某把鎖」的話,任何第三方 DDL 鎖都能代打
#    ⇒ 那格會在 FOR UPDATE 早就沒了的情況下照樣綠(codex 關卡2 抓)。
#    `pg_blocking_pids()` 把「擋住 $1 的就是 $2」釘死。
probe_blocked_by() {
  probe_count "SELECT count(*) FROM pg_stat_activity b
                WHERE b.application_name = '$1'
                  AND EXISTS (SELECT 1 FROM pg_stat_activity a
                               WHERE a.application_name = '$2'
                                 AND a.pid = ANY(pg_blocking_pids(b.pid)))"
}
probe_present() {
  probe_count "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1'"
}

echo "== 0. harness 自我測試 =="

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT FROM WHERE;" 2>&1)"; rc=$?
[ $rc -ne 0 ] && ok "壞 SQL 判紅" || bad "壞 SQL 沒判紅 — 後面結果不可信"

# probe_count 自檢:查詢壞掉時必須回 -1,不能回錯誤字串(那會讓 `!= 0` 的判定恆真)
[ "$(probe_count "SELECT nonexistent_column_zzz")" = "-1" ] \
  && ok "探針故障判定:查詢出錯回 -1(不會被當成「有觀察到」)" \
  || bad "探針故障判定失效 —— psql 錯誤會被算成正向觀察"

# 0.2 探針的**正向**控制:確定會卡的東西,探針必須看得到、而且要指認出擋住它的是誰
mkfifo "$TMPD/p.fifo" || { echo "🔴 mkfifo 失敗;拒跑"; exit 1; }
PGAPPNAME=s2c_P0 psql "$URL" -qtAX < "$TMPD/p.fifo" > "$TMPD/p0.out" 2>&1 &
P0_PID=$!
exec 8> "$TMPD/p.fifo"
printf 'BEGIN;\nSELECT id FROM public.suppliers WHERE id = %s FOR UPDATE;\n' "'$SUP_ID'" >&8
for _ in $(seq 1 200); do
  [ "$(probe_count "SELECT count(*) FROM pg_stat_activity WHERE application_name='s2c_P0' AND state='idle in transaction'")" = "1" ] && break
  sleep 0.05
done
# 🔴 `8>&-`:不關的話 P1 會繼承 fd 8 這個 FIFO 寫端,P0 的 EOF 就得等 P1 先死 = 隱性耦合
PGAPPNAME=s2c_P1 psql "$URL" -qtAX -c "SELECT id FROM public.suppliers WHERE id = '$SUP_ID' FOR UPDATE" \
  > "$TMPD/p1.out" 2>&1 8>&- &
P1_PID=$!
seen=0; probe_broke=0
for _ in $(seq 1 200); do
  n="$(probe_blocked_by s2c_P1 s2c_P0)"
  [ "$n" = "-1" ] && { probe_broke=1; break; }
  [ "$n" -gt 0 ] && { seen=1; break; }
  sleep 0.05
done
if [ "$probe_broke" = "1" ]; then
  bad "探針正向控制:probe_blocked_by 查詢自己壞掉 ⇒ 這格不算數"
elif [ "$seen" = "1" ]; then
  ok "探針正向控制:確定會卡的 SELECT FOR UPDATE 被探到、且指認出擋住它的正是 P0"
else
  bad "探針正向控制失敗 — 探針對「真的在等」無感 ⇒ 後面「沒探到」全是假綠"
fi
printf 'ROLLBACK;\n' >&8; exec 8>&-; wait "$P0_PID" 2>/dev/null; wait "$P1_PID" 2>/dev/null
P0_PID=""; P1_PID=""

# 0.3 探針的**負向**控制:不碰鎖的東西,探針必須看不到 —— 且必須真的看到過那個 backend,
#     否則「沒探到」可能只是它早就跑完了(空觀察不算數)
PGAPPNAME=s2c_P2 psql "$URL" -qtAX -c "SELECT pg_sleep(1)" > "$TMPD/p2.out" 2>&1 8>&- &
P2_PID=$!
present=0; falsepos=0; nfault=0
for _ in $(seq 1 40); do
  pp="$(probe_present s2c_P2)"; pw="$(probe_waiting s2c_P2)"
  # 🔴 -1 不是「沒在等」,是「探針壞了」。原本這裡把 -1 當普通 false ⇒ 探針全故障仍判 PASS
  #    (codex 關卡2 抓);負向控制本身假綠是最難發現的一種。
  { [ "$pp" = "-1" ] || [ "$pw" = "-1" ]; } && { nfault=1; break; }
  [ "$pp" -gt 0 ] && present=1
  [ "$pw" -gt 0 ] && falsepos=1
  sleep 0.05
done
wait "$P2_PID" 2>/dev/null; P2_PID=""
if [ "$nfault" = "1" ]; then
  bad "探針負向控制:探針查詢自己壞掉(回 -1)⇒ 這格不算數"
elif [ "$present" = "1" ] && [ "$falsepos" = "0" ]; then
  ok "探針負向控制:不碰鎖的 backend 有被看見、但沒被誤判成在等鎖"
elif [ "$present" != "1" ]; then
  bad "探針負向控制無效 — 從未觀察到 s2c_P2 這個 backend ⇒ 這格是空觀察、不算數"
else
  bad "探針負向控制失敗 — 沒碰鎖卻被判成在等鎖 ⇒ 探針恆真"
fi

# 0.4 還原原語自檢:先確認 restore_fn 真的把定義搬得回來
# 🔴 MUTATED 旗標必須在 DDL **之前**立起來 —— 這是 committed DDL,
#    死在 DDL 與 restore_fn 之間的話,旗標還是 0 的 trap 不會還原,那行註解會永久烙進函式。
MUTATED=1
psql "$URL" -v ON_ERROR_STOP=1 -qtAX >/dev/null 2>&1 <<SQL
DO \$s\$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('$FNSIG'::regprocedure) INTO v_def;
  EXECUTE pg_catalog.replace(v_def, 'RETURN ''UPDATED'';', 'RETURN ''UPDATED'';  -- S2C-SELFTEST');
END \$s\$;
SQL
[ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" != "$ORIG_MD5" ] \
  && ok "還原自檢:無害突變確實改變了 catalog 定義" || bad "還原自檢:無害突變沒套上 ⇒ 後面的還原斷言不算數"
restore_fn && ok "還原自檢:restore_fn 把定義還原成原值(md5 相符)" \
           || bad "還原自檢:restore_fn 還原不回去"

# ── 情境:A 改名 L0→L1 不 commit;B 對同一家改名回 L0 ─────────────
# 結果寫進 SC_* 全域;判讀留給呼叫端(真函式與突變版期望相反)。
# 用法:scenario <run> <A 的 label> <A 的 is_active(SQL 字面)> <B 的 label> <B 的 is_active(SQL 字面)>
scenario() {
  local run="$1"
  local a_label="$2" a_active="$3" b_label="$4" b_active="$5"
  local reqA="$TAG-A-$run"
  local reqB="$TAG-B-$run"
  SC_BLOCKED=0; SC_B_EARLY=0; SC_B_RESULT=""; SC_B_RC=""; SC_FINAL=""; SC_FINAL_ACTIVE=""
  SC_A_AFTER=""; SC_B_BEFORE=""; SC_B_ROWS=""

  restore_row || return 1         # 每輪從 label=L0 的乾淨狀態起跑;還原失敗就不要跑,結論不算數
  rm -f "$TMPD/b.out" "$TMPD/b.err"; : > "$TMPD/b.out"; : > "$TMPD/b.err"
  rm -f "$FIFO"; mkfifo "$FIFO" || { bad "run=$run:mkfifo 失敗"; return 1; }

  PGAPPNAME=s2c_A psql "$URL" -v ON_ERROR_STOP=1 -qtAX < "$FIFO" > "$TMPD/a.out" 2>&1 &
  A_PID=$!
  exec 9> "$FIFO"
  printf "BEGIN;\nSELECT public.admin_upsert_supplier('%s', '%s', %s, NULL, 's2c', '%s');\n" \
         "$SUP_ID" "$a_label" "$a_active" "$reqA" >&9

  # barrier ①:等到 A **確實**做完 RPC 且持有 suppliers 的 RowExclusiveLock 才放 B 進場。
  #   'idle in transaction' = A 已執行完上面兩句、正在等下一句 ⇒ 鎖一定已經拿到。
  local aready=0 aidle alock
  for _ in $(seq 1 200); do
    aidle="$(probe_count "SELECT count(*) FROM pg_stat_activity
                           WHERE application_name='s2c_A' AND state='idle in transaction'")"
    alock="$(probe_count "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
                           WHERE a.application_name='s2c_A' AND l.granted
                             AND l.locktype='relation' AND l.relation='public.suppliers'::regclass
                             AND l.mode='RowExclusiveLock'")"
    if [ "$aidle" = "-1" ] || [ "$alock" = "-1" ]; then
      bad "run=$run:barrier① 的探針查詢自己出錯(aidle=$aidle alock=$alock)⇒ 本輪不算數"
      printf 'ROLLBACK;\n' >&9; exec 9>&-; wait "$A_PID" 2>/dev/null; A_PID=""
      return 1
    fi
    if [ "$aidle" -gt 0 ] && [ "$alock" -gt 0 ]; then aready=1; break; fi
    sleep 0.05
  done
  if [ "$aready" != "1" ]; then
    bad "run=$run:A 從未進入「持鎖且 idle in transaction」⇒ barrier 沒建立起來,本輪不算數(A 輸出:$(head -c 160 "$TMPD/a.out"))"
    printf 'ROLLBACK;\n' >&9; exec 9>&-; wait "$A_PID" 2>/dev/null; A_PID=""
    return 1
  fi

  # 🔴 stderr 分流到 b.err:併進 b.out 的話,psql 的任何啟動警告都會讓 `-s b.out`
  #    在查詢還沒回來時就成立 ⇒ 假的「B 提早跑完」(codex 關卡2 抓)。
  #    分流後 b.out 只會有查詢結果,而結果只在查詢返回後才寫出 ⇒ 非空 = B 真的跑完了。
  # 🔴 `9>&-`:不關的話 B 繼承 FIFO 寫端,A 的 EOF 要等 B 先死。
  PGAPPNAME=s2c_B psql "$URL" -v ON_ERROR_STOP=1 -qtAX \
    -c "SELECT public.admin_upsert_supplier('$SUP_ID', '$b_label', $b_active, NULL, 's2c', '$reqB')" \
    > "$TMPD/b.out" 2> "$TMPD/b.err" 9>&- &
  B_PID=$!

  # barrier ②:正向觀察「B 正被 A 擋住」;若 B 在 A 還開著時就產出結果 ⇒ 它根本沒被擋
  #   (硬事實:COMMIT 要到這個迴圈結束之後才寫進 FIFO)
  local bw
  for _ in $(seq 1 200); do
    bw="$(probe_blocked_by s2c_B s2c_A)"
    if [ "$bw" = "-1" ]; then
      bad "run=$run:barrier② 的探針查詢自己出錯 ⇒ 本輪不算數"; break
    fi
    [ "$bw" -gt 0 ] && { SC_BLOCKED=1; break; }
    [ -s "$TMPD/b.out" ] && { SC_B_EARLY=1; break; }
    sleep 0.05
  done

  printf 'COMMIT;\n' >&9; exec 9>&-; wait "$A_PID" 2>/dev/null; A_PID=""
  wait "$B_PID"; SC_B_RC=$?; B_PID=""

  SC_B_RESULT="$(tr -d ' \n' < "$TMPD/b.out")"
  SC_FINAL="$(q "SELECT label FROM public.suppliers WHERE id = '$SUP_ID'")"
  SC_FINAL_ACTIVE="$(q "SELECT is_active FROM public.suppliers WHERE id = '$SUP_ID'")"
  SC_A_AFTER="$(q "SELECT after->>'label' FROM public.admin_audit_log WHERE request_id = '$reqA'")"
  SC_B_BEFORE="$(q "SELECT before->>'label' FROM public.admin_audit_log WHERE request_id = '$reqB'")"
  SC_B_ROWS="$(q "SELECT count(*) FROM public.admin_audit_log WHERE request_id = '$reqB'")"
  return 0
}

# B 的 client 端健康檢查:兩種情境下 B 都該正常結束(差別在回哪個碼,不在成不成功)
assert_b_healthy() {
  [ "$SC_B_RC" = "0" ] \
    && ok "$1:B 的 psql 正常結束(rc=0)" \
    || bad "$1:B 的 psql rc=$SC_B_RC、stderr=$(head -c 120 "$TMPD/b.err") ⇒ 這輪的回傳碼判讀不算數"
  [ ! -s "$TMPD/b.err" ] \
    && ok "$1:B 的 stderr 全空(沒有被誤當成輸出的雜訊)" \
    || bad "$1:B 的 stderr 非空:$(head -c 120 "$TMPD/b.err")"
}

echo "== A. 基準①「B 改回原值」:真函式(FOR UPDATE 在) =="
if scenario base "$L1" NULL "$TARGET" NULL; then
  assert_b_healthy "基準①"
  [ "$SC_BLOCKED" = "1" ] \
    && ok "格1 擋得住:B 被正向觀察到「正被 A 擋住」(pg_blocking_pids 指認,不是失敗、是等)" \
    || bad "格1:B 沒有被 A 擋住 —— SC_B_EARLY=$SC_B_EARLY、B 回 '$SC_B_RESULT'"
  [ "$SC_B_RESULT" = "UPDATED" ] \
    && ok "格2a(根因觀測點):B 解鎖後讀到 A 的新值 ⇒ 回 UPDATED、改名真的生效" \
    || bad "格2a:B 回 '$SC_B_RESULT',期望 UPDATED"
  # 🔴 R3 抓:原本這格是「兩個 q() 讀值互比」。q() 併 stderr ⇒ 連線層錯誤不含查詢字面,
  #    兩邊會拿到**完全相同**的錯誤字串 ⇒ `-n` 過、相等也過 = 沒讀到任何稽核資料卻全綠。
  #    改成兩邊各自對**字面 $L1** 斷言:更嚴,且錯誤字串永遠不會等於 L1 ⇒ fail-closed。
  { [ "$SC_A_AFTER" = "$L1" ] && [ "$SC_B_BEFORE" = "$L1" ]; } \
    && ok "格2b(症狀):稽核鏈首尾相接且兩端都等於字面 '$L1'(A.after / B.before)" \
    || bad "格2b:稽核鏈斷了或讀不到 —— A.after='$SC_A_AFTER'、B.before='$SC_B_BEFORE',兩者都應為 '$L1'"
  [ "$SC_B_ROWS" = "1" ] \
    && ok "格2b'(症狀,被格2a 蘊含):B 恰 1 筆稽核列" || bad "格2b':B 稽核列 $SC_B_ROWS 筆,期望 1"
  [ "$SC_FINAL" = "$TARGET" ] \
    && ok "格2c(症狀,被格2a 蘊含):最終 label='$SC_FINAL' = B 的意圖" \
    || bad "格2c:最終 label='$SC_FINAL',期望 '$TARGET'"
fi

echo "== A2. 基準②「A 改名+停用,B 改成第三個值」:真函式 =="
# 這個情境的回傳碼與端狀態 label 在突變前後**完全一樣** ⇒ 判別力只在稽核 before 與 is_active。
if scenario base2 "$L1" false "$L2" NULL; then
  assert_b_healthy "基準②"
  [ "$SC_B_RESULT" = "UPDATED" ] \
    && ok "格3a:B 回 UPDATED(這格突變後也是 UPDATED ⇒ 它本身不具判別力,是對照組)" \
    || bad "格3a:B 回 '$SC_B_RESULT',期望 UPDATED"
  [ "$SC_B_BEFORE" = "$L1" ] \
    && ok "格3b(判別點):B 的稽核 before='$L1' = A 剛寫進去的真相,不是 A 之前的舊值" \
    || bad "格3b:B 的稽核 before='$SC_B_BEFORE',期望字面 '$L1'"
  [ "$SC_FINAL_ACTIVE" = "f" ] \
    && ok "格3c(判別點):A 的停用存活 —— B 帶 is_active=NULL 沒有把它翻回啟用" \
    || bad "格3c:最終 is_active='$SC_FINAL_ACTIVE',期望 f(A 的停用被 B 覆蓋掉了)"
fi

echo "== B. 突變:拿掉 FOR UPDATE(committed DDL,跑完還原)=="
MUTATED=1   # 🔴 同 §0.4:committed DDL,旗標必須早於 DDL,否則死在中間 trap 不會還原
mut_out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1 <<SQL
DO \$mut\$
DECLARE
  v_oid oid := '$FNSIG'::regprocedure;
  v_def text; v_new text; v_md5 text; v_occ integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_def;
  v_md5 := pg_catalog.md5(v_def);
  v_occ := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'FOR UPDATE', '')))
           / pg_catalog.length('FOR UPDATE');
  IF v_occ <> 1 THEN
    RAISE EXCEPTION '突變 anchor 出現 % 次,與宣告的 1 次不符 —— 會變成過量/不足突變', v_occ;
  END IF;
  v_new := pg_catalog.replace(v_def, 'FOR UPDATE', '');
  EXECUTE v_new;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:catalog 定義沒有改變';
  END IF;
END
\$mut\$;
SQL
)"
if [ $? -ne 0 ]; then
  bad "突變沒套上 — $(printf '%s' "$mut_out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"
  restore_fn
else
  ok "突變已套上(anchor 恰 1 處、catalog 定義確實改變)"
  if scenario mut "$L1" NULL "$TARGET" NULL; then
    assert_b_healthy "突變①"
    [ "$SC_BLOCKED" = "0" ] && [ "$SC_B_EARLY" = "1" ] \
      && ok "格1 轉紅:B 在 A 的交易還開著時就跑完了 ⇒ 序列化不見了" \
      || bad "格1 沒轉紅:SC_BLOCKED=$SC_BLOCKED、SC_B_EARLY=$SC_B_EARLY ⇒ 這格對 FOR UPDATE 沒有判別力"
    [ "$SC_B_RESULT" = "NO_CHANGE" ] \
      && ok "格2a 轉紅(根因):B 讀到 stale before ⇒ 回 NO_CHANGE(它以為沒事要做)" \
      || bad "格2a 沒轉紅:B 回 '$SC_B_RESULT',期望 NO_CHANGE"
    [ "$SC_B_ROWS" = "0" ] \
      && ok "格2b 轉紅(症狀):B 零稽核列 ⇒ 稽核鏈在 A.after 之後直接斷掉" \
      || bad "格2b 沒轉紅:B 稽核列 $SC_B_ROWS 筆,期望 0"
    [ "$SC_FINAL" = "$L1" ] \
      && ok "格2c 轉紅(症狀):最終 label='$SC_FINAL' = A 的值 ⇒ **B 的改名遺失**(lost update 實錘)" \
      || bad "格2c 沒轉紅:最終 label='$SC_FINAL',期望 '$L1'"
  fi
  # 情境② 的突變版:回傳碼與端狀態 label 都不會變 ⇒ 只有稽核 before 與 is_active 會翻面
  if scenario mut2 "$L1" false "$L2" NULL; then
    assert_b_healthy "突變②"
    [ "$SC_B_RESULT" = "UPDATED" ] \
      && ok "格3a 對照組:突變後 B 仍回 UPDATED ⇒ 證實回傳碼在情境② 沒有判別力" \
      || bad "格3a 對照組失效:B 回 '$SC_B_RESULT' 而非 UPDATED,情境② 的前提要重看"
    [ "$SC_B_BEFORE" = "$TARGET" ] \
      && ok "格3b 轉紅:B 的稽核 before='$SC_B_BEFORE' = **A 改之前的舊值** ⇒ 稽核列在說謊(偽造歷史)" \
      || bad "格3b 沒轉紅:B 的稽核 before='$SC_B_BEFORE',期望 stale 的 '$TARGET'"
    [ "$SC_FINAL_ACTIVE" = "t" ] \
      && ok "格3c 轉紅:最終 is_active='t' ⇒ **A 的停用被靜默翻回啟用**(coalesce 吃到 stale 值)" \
      || bad "格3c 沒轉紅:最終 is_active='$SC_FINAL_ACTIVE',期望被翻回 t"
  fi
  restore_fn && ok "突變已還原:函式定義 md5 回到原值" || bad "突變還原失敗 —— 這顆庫的函式已被改壞"
fi

echo "== C. 還原(業務欄位與物件定義層)=="
restore_row
[ "$(probe_count "SELECT count(*) FROM public.suppliers")" = "26" ] \
  && ok "suppliers 仍 26 列" || bad "suppliers 列數變了"
[ "$(q "SELECT label = '$TARGET' AND is_active IS NOT DISTINCT FROM '$ORIG_ACTIVE'::boolean
          AND updated_at = '$ORIG_UPDATED'::timestamptz FROM public.suppliers WHERE id = '$SUP_ID'")" = "t" ] \
  && ok "目標列 label / is_active / updated_at 三欄還原到快照(updated_at 不被推進 ⇒ 任何以它為判準的斷言都看不到本 harness 來過)" \
  || bad "目標列沒還原乾淨"
[ "$(probe_count "SELECT count(*) FROM public.admin_audit_log WHERE request_id LIKE 's2c-%'")" = "0" ] \
  && ok "s2c-% 稽核列已清空(比對全前綴,不只本輪的 PID)" || bad "稽核列有殘留"
[ "$(probe_count "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         WHERE c.relnamespace='public'::regnamespace AND c.relname='suppliers'
           AND t.tgname='suppliers_touch_updated_at' AND t.tgenabled='O'")" = "1" ] \
  && ok "touch trigger 仍是啟用狀態(還原用的 DISABLE 沒有留下來)" || bad "touch trigger 沒被重新啟用"
[ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" = "$ORIG_MD5" ] \
  && ok "函式定義 md5 = 原值(突變沒有外洩到庫裡)" || bad "函式定義與原值不符"
echo "   🔴 未還原(本 harness 不宣稱清得掉):MVCC xmin / WAL / 統計 / plan cache 失效。"

echo
echo "== S2-C 併發 harness:$PASS PASS / $FAIL FAIL =="
[ "$FAIL" = "0" ] || exit 1
