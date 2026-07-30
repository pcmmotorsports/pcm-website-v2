#!/usr/bin/env bash
#
# A7-t 併發證據 harness —— 支撐 plan §2.0「本片對併發**不防**而非**已防**」這個決定。
#
# 用法:scripts/a7t-concurrency-probe.sh          (自建拋棄式 cluster、跑完自動 teardown)
#      scripts/a7t-concurrency-probe.sh keep     (跑完保留 cluster 供人工查看)
#
# ══ 這支在證明什麼 ═══════════════════════════════════════════════════════════
# 主從一致 trigger 的形狀是「`SELECT count(*) ... WHERE parent_id = ?` 為 0 就 RAISE」。
# 情境:header 有兩列明細,**兩個交易各刪一列**。
#
#   案例 A  REPEATABLE READ + 無鎖        → 預期**漏**(壞終態落地)
#   案例 B  REPEATABLE READ + 鎖 parent   → 預期**仍漏**(關卡1 codex 提的修法不足)
#   案例 C  READ COMMITTED  + 無鎖 序列化 → 預期**擋得住**(界定風險範圍)
#   案例 D  SERIALIZABLE    + 無鎖        → 預期 **PG 自己擋**(serialization failure)
#   案例 E  TOCTOU 負測(先鎖表再驗)      → 預期**擋得住**(證 migration §0 的順序有效)
#
# 🔴 **A 與 B 的「漏」是本檔的預期結果、算案例成功** —— 它們正是「不防」這個決定的依據。
#    初版把它們記成 FAIL、腳本又不依 FAIL 回傳非零,兩個問題都會讓讀者誤判(關卡2 codex)。
# 🔴 初版還依賴「別支腳本先 provision 好的 cluster」⇒ 乾淨環境跑不起來 = 證據不可重現。
#    本版**自建自拆**,不依賴任何既有 cluster。
#
# 🔴 誠實邊界:本機 PG 17.10、C locale、**非 Supabase**;用的是**等價最小重現**
#    (int 主鍵的 h/c 兩表),不是 A7 真表 —— 證的是 PostgreSQL 的隔離級語意,
#    不是 A7-t 那支函式的實作(那個在 scripts/a7t-verify.sh)。
set -uo pipefail

W=/tmp/a7tcc
PORT=54332
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
KEEP="${1:-}"

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }

teardown() {
  [ "$KEEP" = "keep" ] && return 0
  pg_ctl -D "$W/data" stop -m fast >/dev/null 2>&1 || true
  # 🔴 「自建自拆」必須真的拆掉(關卡2 R2 nit:原版只停 PG、留下整個 data directory)。
  #    刪除前確認是本腳本建的(ownership marker),不然寧可留著。
  [ -f "$W/.a7t-conc-throwaway" ] && rm -rf "$W"
  return 0
}
trap teardown EXIT

echo "== 0. 自建拋棄式 PG17(不依賴任何既有 cluster)=="
pg_ctl -D "$W/data" stop -m immediate >/dev/null 2>&1 || true
rm -rf "$W"; mkdir -p "$W"; : > "$W/.a7t-conc-throwaway"
# 🔴 macOS 上少了 LC_ALL=C 會 `postmaster became multithreaded during startup` 直接起不來(實測)
initdb -D "$W/data" -U postgres --locale=C -E UTF8 >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 1; }
pg_ctl -D "$W/data" -o "-p $PORT -k $W -c listen_addresses=127.0.0.1" -l "$W/log" start >/dev/null 2>&1 \
  || { echo "🔴 start 失敗"; tail -5 "$W/log"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do psql "$URL" -qtAc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
psql "$URL" -qtAc 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上"; tail -5 "$W/log"; exit 1; }

setup() {  # $1 = lock | nolock
  local LOCKLINE="    SELECT id INTO v_dummy FROM h WHERE id = v_x;"
  [ "$1" = "lock" ] && LOCKLINE="    SELECT id INTO v_dummy FROM h WHERE id = v_x FOR UPDATE;"
  psql "$URL" -v ON_ERROR_STOP=1 -q > "$W/setup.log" 2>&1 <<SQL
DROP TABLE IF EXISTS c, h CASCADE;
DROP FUNCTION IF EXISTS f() CASCADE;
CREATE TABLE h (id int PRIMARY KEY);
CREATE TABLE c (id int PRIMARY KEY, h_id int NOT NULL REFERENCES h(id));
CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS \$\$
DECLARE v_ids int[]; v_x int; v_n int; v_dummy int;
BEGIN
  IF TG_TABLE_NAME = 'h' THEN v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN v_ids := ARRAY[OLD.h_id];
  ELSIF TG_OP = 'UPDATE' THEN v_ids := ARRAY[OLD.h_id, NEW.h_id];
  ELSE v_ids := ARRAY[NEW.h_id];
  END IF;
  FOREACH v_x IN ARRAY v_ids LOOP
$LOCKLINE
    CONTINUE WHEN NOT FOUND;
    SELECT count(*) INTO v_n FROM c WHERE h_id = v_x;
    IF v_n = 0 THEN RAISE EXCEPTION 'A7T_EMPTY_HEADER h=%', v_x; END IF;
  END LOOP;
  RETURN NULL;
END \$\$;
CREATE CONSTRAINT TRIGGER h_ac AFTER INSERT OR UPDATE ON h
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION f();
CREATE CONSTRAINT TRIGGER c_ac AFTER INSERT OR UPDATE OR DELETE ON c
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION f();
BEGIN;
INSERT INTO h VALUES (1);
INSERT INTO c VALUES (10, 1), (11, 1);
COMMIT;
SQL
  # 🔴 **每個案例開跑前硬斷言 fixture 存在** —— 初版沒有這條:setup 靜默失敗
  #    (autocommit 下單獨插 header 自己就觸發 RAISE)造成空資料庫,而判定式讓空庫通過
  #    = 負測 harness 自己假綠。
  local H C
  H="$(psql "$URL" -qtAc 'SELECT count(*) FROM h WHERE id=1' 2>/dev/null)"
  C="$(psql "$URL" -qtAc 'SELECT count(*) FROM c WHERE h_id=1' 2>/dev/null)"
  if [ "$H" != "1" ] || [ "$C" != "2" ]; then
    echo "  🔴 fixture 沒建起來(h=$H c=$C)—— 判定沒有對象,中止"; tail -5 "$W/setup.log"; exit 1
  fi
}

# 🔴 **可觀察 barrier,不用固定 sleep**(關卡2 R2 must-fix):
#    原版靠 `sleep 0.4` 排時序 ⇒ 機器一忙,snapshot 或 commit 順序就漂移,
#    案例可能在「其實沒跑到」的情況下通過;`wait` 還可能永久卡住。
#    ⇒ 兩個 session 帶 application_name,送出每一句後**輪詢 pg_stat_activity 直到它真的跑完**,
#      並設整體逾時,逾時就中止而不是無限等。
AURL="${URL}?application_name=a7t_sess_a"
BURL="${URL}?application_name=a7t_sess_b"

open2() {
  rm -f "$W/fa" "$W/fb"; mkfifo "$W/fa" "$W/fb"
  ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$W/fa" > "$W/outa.txt" 2>&1 ) & PA=$!
  ( psql "$BURL" -qtA -v ON_ERROR_STOP=0 -f "$W/fb" > "$W/outb.txt" 2>&1 ) & PB=$!
  exec 3>"$W/fa"; exec 4>"$W/fb"
  wait_idle a; wait_idle b
}

# 等某個 session 變成「不在跑 query」(idle 或 idle in transaction)= 上一句已完成
wait_idle() {
  local who="$1" i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name = 'a7t_sess_${who}' LIMIT 1" 2>/dev/null)"
    case "$st" in
      idle|'idle in transaction') return 0 ;;
    esac
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session $who 30 秒內沒有回到 idle(state=$st)—— 中止,不假裝跑過"; exit 1
}

sa() { printf '%s\n' "$1" >&3; wait_idle a; }   # 送給 A 並等它跑完
sb() { printf '%s\n' "$1" >&4; wait_idle b; }   # 送給 B 並等它跑完

close2() { exec 3>&-; exec 4>&-; wait $PA $PB 2>/dev/null || true; }
final()  { printf 'header=%s 明細=%s' \
  "$(psql "$URL" -qtAc 'SELECT count(*) FROM h WHERE id=1')" \
  "$(psql "$URL" -qtAc 'SELECT count(*) FROM c WHERE h_id=1')"; }

# B session 走 REPEATABLE READ、快照早於 A 的 commit ⇒ 確定性重現,不靠時序運氣
race_rr() {
  open2
  sb "BEGIN ISOLATION LEVEL REPEATABLE READ;"
  sb "SELECT count(*) FROM c;"          # 取快照(此刻兩列都在)
  sa "BEGIN;"
  sa "DELETE FROM c WHERE id = 10;"
  sa "COMMIT;"                          # A 先落地
  sb "DELETE FROM c WHERE id = 11;"
  sb "COMMIT;"
  close2
}

echo "== A. REPEATABLE READ + 無鎖(= 本片 trigger 的形狀)=="
setup nolock; race_rr; FA="$(final)"
echo "     終態:$FA"
[ "$FA" = "header=1 明細=0" ] \
  && ok "A 兩交易都通過 ⇒ **零明細 header 真的落地**(預期的漏 = 不防的依據)" \
  || bad "A 沒重現預期的漏($FA)⇒ plan §2.0 的前提要重查"

echo "== B. REPEATABLE READ + 鎖 parent(關卡1 codex 提的修法)=="
setup lock; race_rr; FB="$(final)"
echo "     終態:$FB"
[ "$FB" = "header=1 明細=0" ] \
  && ok "B 鎖 parent **仍然漏**(預期)⇒ 鎖修得了併發執行、修不了快照過期" \
  || bad "B 鎖 parent 竟然補住了($FB)⇒ plan「鎖不足以修」的宣稱要更正"

echo "== C. READ COMMITTED + 無鎖、兩交易序列化 commit =="
setup nolock
open2
sa "BEGIN;"; sb "BEGIN;"
sa "DELETE FROM c WHERE id = 10;"
sb "DELETE FROM c WHERE id = 11;"
sa "COMMIT;"
sb "COMMIT;"
close2
FC="$(final)"; echo "     終態:$FC / B:$(tr '\n' ' ' < "$W/outb.txt" | cut -c1-70)"
if [ "$FC" != "header=1 明細=0" ] && grep -q 'A7T_EMPTY_HEADER' "$W/outb.txt"; then
  ok "C 擋得住 ⇒ 風險窗限於「兩支 trigger 併發執行」那一小段"
else bad "C READ COMMITTED 下也漏($FC)⇒ 風險比 plan 寫的大,必須重評"; fi

echo "== D. SERIALIZABLE + 無鎖 =="
setup nolock
open2
sa "BEGIN ISOLATION LEVEL SERIALIZABLE;"; sb "BEGIN ISOLATION LEVEL SERIALIZABLE;"
sa "SELECT count(*) FROM c;"; sb "SELECT count(*) FROM c;"
sa "DELETE FROM c WHERE id = 10;"
sb "DELETE FROM c WHERE id = 11;"
sa "COMMIT;"
sb "COMMIT;"
close2
FD="$(final)"; echo "     終態:$FD / B:$(tr '\n' ' ' < "$W/outb.txt" | cut -c1-80)"
# 🔴 關卡2 codex 標為 uncertain:原本「SERIALIZABLE 由 PG 自己擋」只用一次性指令跑過、
#    repo 內查無證據 ⇒ 本案例補上,並要求 serialization failure 逐字出現。
if [ "$FD" != "header=1 明細=0" ] && grep -qs 'could not serialize access' "$W/outa.txt" "$W/outb.txt"; then
  ok "D PG 自己擋(serialization failure)⇒ 合約債的隔離級集合成立"
else bad "D SERIALIZABLE 沒擋($FD)⇒ 合約債裡「SERIALIZABLE 安全」那句必須拿掉"; fi

echo "== E. TOCTOU 負測:先鎖表再驗,能否擋住「查完才插進來」的孤兒 =="
# 🔴 關卡2 R2 標為 uncertain:repo 內沒有機械證明 migration §0 的
#    「先 LOCK TABLE 再驗既有資料」真的關掉了那個窗。本案例補上。
# 🔴 **必須在「trigger 尚未建立」的狀態下做** —— 那正是 migration §0 執行當下的狀態。
#    (第一版我讓 trigger 存在著跑,A 根本 commit 不了孤兒、案例失去對象;
#     那是我自己的測試 bug,不是修法問題。)
# 手法:
#   A 開交易插一筆孤兒 header(不 commit)⇒ 持有 h 的 ROW EXCLUSIVE
#   B 模擬 migration:BEGIN → LOCK TABLE h,c IN SHARE ROW EXCLUSIVE → **被 A 擋住**
#   A COMMIT ⇒ 孤兒落地、鎖釋放
#   B 取得鎖後才跑閘 ⇒ **必須看到那筆孤兒**(⇒ migration 會 RAISE、整片回滾)
# 若順序反過來(先驗後鎖),B 會在 A commit 前查到 0 筆而放行 = 原本的 TOCTOU。
psql "$URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<'SQL'
DROP TABLE IF EXISTS c, h CASCADE;
DROP FUNCTION IF EXISTS f() CASCADE;
CREATE TABLE h (id int PRIMARY KEY);
CREATE TABLE c (id int PRIMARY KEY, h_id int NOT NULL REFERENCES h(id));
SQL
open2
sa "BEGIN;"
sa "INSERT INTO h VALUES (99);"          # 孤兒:有 header、零明細(此時尚無 trigger)
printf '%s\n' "BEGIN;" >&4; wait_idle b
# B 送出 LOCK 後**不會**馬上回到 idle(被 A 擋住)⇒ 這裡刻意不用 sb
printf '%s\n' "LOCK TABLE h, c IN SHARE ROW EXCLUSIVE MODE;" >&4
BLOCKED=no
for i in $(seq 1 40); do
  if [ "$(psql "$URL" -qtAc "SELECT count(*) FROM pg_stat_activity WHERE application_name='a7t_sess_b' AND wait_event_type='Lock'" 2>/dev/null)" = "1" ]; then
    BLOCKED=yes; break
  fi
  sleep 0.25
done
[ "$BLOCKED" = "yes" ] \
  && ok "E1 B 的 LOCK TABLE 確實被 A 擋住 ⇒ 鎖把「查完才插進來」的窗關上了" \
  || bad "E1 B 沒有被擋 —— 鎖沒生效,TOCTOU 窗仍開著"
sa "COMMIT;"                              # 孤兒落地(無 trigger ⇒ 真的寫進去)
wait_idle b                               # B 現在應該拿到鎖了
sb "SELECT 'ORPHANS=' || count(*) FROM h WHERE NOT EXISTS (SELECT 1 FROM c WHERE c.h_id = h.id);"
sb "ROLLBACK;"
close2
if grep -q 'ORPHANS=1' "$W/outb.txt"; then
  ok "E2 B 取得鎖後**看得到那筆孤兒** ⇒ migration §0「先鎖後驗」的順序有效"
else
  bad "E2 B 沒看到孤兒($(grep -o 'ORPHANS=[0-9]*' "$W/outb.txt" | head -1))—— 先鎖後驗沒關掉窗,§0 要重想"
fi

echo
echo "════ A7-t 併發實測:通過 ${PASS} / 失敗 ${FAIL} ════"
echo "(A/B 的「漏」是預期結果 = 案例成功;它們是 plan §2.0 與 backlog #307 的依據)"
[ "$FAIL" -eq 0 ] || exit 1
