#!/usr/bin/env bash
#
# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 **本檔目前會卡死,不在任何守門鏈上**(2026-08-07 W6a 第一動實測後落檔)
# ══════════════════════════════════════════════════════════════════════════════
# 這支從 2026-08-05 起一直是**未追蹤**的遺留檔;老約定是「去留隨 W6a 第一動」。
# W6a 開工當下實跑它 —— **它會卡死**:
#   · 三個 client backend 全部停在 `idle / wait_event_type=Client`(等腳本餵下一句)
#   · 腳本停在 `void_race_once()` 的 `wait $PC` —— 控制端 psql 讀的 FIFO 沒有收到 EOF,
#     `exec 5>&-` 之後仍有子行程持著那個寫端 ⇒ psql 不結束 ⇒ `wait` 永不返回。
#   · 十分鐘零進展,只能外部 kill。
#
# ⇒ **為什麼還是落檔而不是刪掉**:它是未追蹤檔,`rm` 等於**永久毀掉**(git 裡沒有任何一份)。
#    而它最有價值的東西不是程式碼,是下面檔頭記錄的**兩次被實跑推翻的假設**與那個因果模型
#    (`ON CONFLICT DO UPDATE` 寫的是「進入阻塞之前」算好的 SUM ⇒ 靜默漏)。
#    ⇒ 落檔保存(可逆),**但明文宣告它不可執行、不得被任何 gate 引用**。
#
# 🔴 **繼承者**:W6a 的新探針(`scripts/w6a-*`)承接它的因果模型,並改用不會卡死的協調方式。
#    修好這支不在 W6a 範圍;要修的人請先解掉上面那個 FIFO 的 EOF 問題。
# ══════════════════════════════════════════════════════════════════════════════
#
# 🔴 **機制優先律**:上面那段「宣告不可執行」是**留言不是機制** —— 檔案仍可執行、
#    真的跑下去照樣吊死十分鐘只能外部 kill(跨模型審查點名)。⇒ 下面這行是那道機制。
echo "b2s1-concurrency-probe.sh:本檔已知會卡死(FIFO 寫端未收乾淨),刻意不可執行;它只保存檔頭的因果模型。" >&2
exit 2
#
# 🔴🔴 **重新啟用前必修(W7 跟片⑥,2026-08-09;R3 F4 點名)**:
#    下面的 `teardown()` 是 `pg_ctl stop … || true` 之後**無條件 `rm -rf "$W"`**,
#    零殘留觀察 ⇒ 停不掉時會把資料目錄從**還活著的 postmaster** 底下刪掉。
#    修法照 `a7t-concurrency-probe.sh` 同款(停完看 postmaster.pid + pgrep、有殘留就
#    保留現場並讓離場碼非 0;`pgrep` 缺席當不確定)。
#    🔴 本片**沒有直接修這支**:上面那道 `exit 2` 讓整支跑不到 teardown。
#    嚴格說「驗不出來」是過頭的話(R1 F8)—— 拿掉閘的 scratch 副本可以單獨測 teardown、
#    不必跑會卡死的主體。真正的理由是**成本與價值不成比例**:同款修法已在
#    `a7t-concurrency-probe.sh` 上實測翻面過,而這支在重新啟用之前一行都不會執行。
#    地雷標記留在這裡,是因為下一個人要重新啟用時第一個會看到的就是這道閘。
#
#
# B2-S2 併發證據 harness —— 出貨數量軸的超量防護,承重件到底是哪一個(實跑兩次翻案後的定案)。
#
# 用法:scripts/b2s1-concurrency-probe.sh          (自建拋棄式 cluster、跑完自動 teardown)
#      scripts/b2s1-concurrency-probe.sh keep     (跑完保留 cluster 供人工查看)
#
# 真權威:docs/specs/2026-08-05-e10-b2-shipments-db-plan.md §3.2 / §9 / 附錄 A.3
# 形狀照抄:scripts/a7t-concurrency-probe.sh(自建自拆、可觀察 barrier、預期會漏的格算 PASS)
#
# ══ 本檔的來歷:兩個被實跑推翻的假設 ═══════════════════════════════════════════
# v1 假設「A7-t 的發現(RR 下兩交易各改一列會雙雙放行、鎖 parent 單獨不足)原封轉移到出貨軸」,
#   照該假設寫死判定式 ⇒ **實跑打臉**:RR 那格沒漏。根因 = A7-t 的兩個交易改的是**不同列、
#   無共同寫入點**;本片同一 order_item 的兄弟寫入**全部匯流到摘要表的同一列**,那列會撞 40001。
# v2 於是改假設「匯流點本身就夠、parent 鎖不承重」⇒ **又被打臉**:RC + 無鎖那格**靜默漏**。
#   真因(v3 的因果模型,下面五格全部符合):`ON CONFLICT DO UPDATE` 寫的是**進入阻塞之前**
#   算好的 SUM。後到者先算 SUM=2、才卡在摘要列的索引插入;A commit 後它把**過期的 2** 寫進去
#   ⇒ CHECK 看到 2 ≤ 3 放行,而真相已是 4。**錯誤訊息一個都沒有 = 最壞的那種漏。**
#
# ⇒ **承重件 = parent 鎖,而且承重點是「它排在讀 SUM 之前」** —— 這正是 A4a 的既有寫法
#   (`20260803140000:153-177`:先 FOR NO KEY UPDATE 再三軸直讀)。本片照抄它是對的,
#   但理由不是「慣例如此」,是 C 格與 B 格的差。
#
# 🔴 兩次翻案都是「跨形狀外推」踩的坑(memory `feedback_review-process-shrinking-verification-surface`)。
#    結論只寫在下面每一格的判定裡,不寫成註解的宣稱。
#
# ══ 這支在證明什麼 ═══════════════════════════════════════════════════════════
#   最小重現:oi.quantity = 3;兩個交易各插一列 shipment_items(各 2 件)。
#   若無防護,終態 SUM = 4 > 3 = 超量出貨。
#
#   A  RR  + 無 parent 鎖   → 摘要列撞併發更新 ⇒ **40001 自己中止**(不漏,但這是隔離級給的)
#   B  **消融:RC + 拿掉 parent 鎖** → **靜默漏**(truth=4、零錯誤、摘要還顯示 2)
#   C  RC  + 有 parent 鎖   → 卡在 parent 鎖 ⇒ 解鎖後**重算** SUM=4 ⇒ **23514**(不漏)= 真實配置
#   D  **消融:拆掉摘要匯流點**(每筆明細各自一列 = A7-t 的形狀)⇒ **預期漏**
#   E  **B vs C 的差集** ⇒ 兩者必須相反,否則 C 的綠沒有判別力
#   F  SERIALIZABLE + 無鎖  → PG 自己擋(40001)
#
# 🔴 **判別力設計**:B 與 D 是兩格「預期漏」的消融。任一格不漏 = 本 harness 量不到對應機制,
#    C 的綠當場作廢(memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
#
# 🔴 誠實邊界:
#   · 本機 PG17、C locale、**非 Supabase**。
#   · 用的是**等價最小重現**(int 主鍵的 oi/si/summ 三表 + 一支重算 trigger),**不是 B2-S1 真表**
#     —— 證的是 PostgreSQL 在這個形狀下的隔離級語意,不是 S1/S2 那幾支函式的實作
#     (那些等 migration 寫好後由 scripts/b2s1-verify.sh / b2s2-verify.sh 負責)。
#   · trigger 用 `NOT DEFERRABLE`,對齊最近的先例 `order_cancellation_items_summary_recompute_ac`
#     (`20260803140000:420-423`);A4a 家族只有 procurement 那支是 `DEFERRABLE INITIALLY IMMEDIATE`(:409-412)。
#   · 案例 G(Q3 作廢分支)**已接線**(Sean 08-05 拍 Q3=A);目前結果 = `inconclusive`,
#     腳本回非零並印出「未證明」,不靜默跳過、也不當成綠。
set -uo pipefail

W="${B2S1_WORK:-/tmp/b2s1cc}"
PORT=54333
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
KEEP="${1:-}"

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }

# 🔴 R2 抓:v3 把 marker 檢查放在 trap **之後** ⇒ 檢查失敗 exit 時,已安裝的 trap 仍會
#    對別人的目錄跑 pg_ctl stop。⇒ v4 把 marker 檢查提到 trap 安裝**之前**,順序即修法。
if [ -e "$W" ] && [ ! -f "$W/.b2s1-conc-throwaway" ]; then
  echo "🔴 $W 已存在但沒有本腳本的 marker(.b2s1-conc-throwaway)——" >&2
  echo "   拒絕停止/刪除不屬於自己的目錄。請手動確認後移除,或設 B2S1_WORK 換路徑。" >&2
  exit 1
fi

teardown() {
  [ "$KEEP" = "keep" ] && return 0
  [ -f "$W/.b2s1-conc-throwaway" ] || return 0     # 二重保險:沒 marker 什麼都不動
  pg_ctl -D "$W/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$W"
  return 0
}
trap teardown EXIT

echo "== 0. 自建拋棄式 PG17(不依賴任何既有 cluster)=="
pg_ctl -D "$W/data" stop -m immediate >/dev/null 2>&1 || true
rm -rf "$W"; mkdir -p "$W"; : > "$W/.b2s1-conc-throwaway"
initdb --version | grep -q ' 17\.' || { echo "🔴 PATH 的 initdb 非 PG17(宣稱=實際)"; exit 1; }
# macOS 上少了 LC_ALL=C 會 `postmaster became multithreaded during startup` 直接起不來
initdb -D "$W/data" -U postgres --locale=C -E UTF8 >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 1; }
pg_ctl -D "$W/data" -o "-p $PORT -k $W -c listen_addresses=127.0.0.1" -l "$W/log" start >/dev/null 2>&1 \
  || { echo "🔴 start 失敗"; tail -5 "$W/log"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do psql "$URL" -qtAc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
psql "$URL" -qtAc 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上"; tail -5 "$W/log"; exit 1; }

QTY=3   # oi.quantity;兩交易各插 2 件 ⇒ 跨過合法上限的最小值

# $1 = lock | nolock       —— 重算前有沒有 SELECT … FOR NO KEY UPDATE 鎖 parent
# $2 = converge | perrow   —— 摘要是「每 order_item 一列」(真實形狀)還是「每明細一列」(消融)
setup() {
  local LOCKLINE="  SELECT quantity INTO v_qty FROM oi WHERE id = v_oi;"
  [ "$1" = "lock" ] && \
    LOCKLINE="  SELECT quantity INTO v_qty FROM oi WHERE id = v_oi FOR NO KEY UPDATE;"

  # converge = 真實形狀:PK 是 oi_id ⇒ 同一 order_item 的兄弟寫入全撞同一列
  # perrow   = 消融形狀:PK 是明細 id ⇒ 沒有共同寫入列(A7-t 的形狀)
  local SUMMDDL UPSERT
  if [ "$2" = "converge" ]; then
    SUMMDDL="CREATE TABLE summ (oi_id int PRIMARY KEY REFERENCES oi(id), quantity int NOT NULL,
                   shipped int NOT NULL DEFAULT 0,
                   CONSTRAINT summ_shipped_le_quantity CHECK (shipped::bigint <= quantity::bigint));"
    UPSERT="INSERT INTO summ (oi_id, quantity, shipped) VALUES (v_oi, v_qty, v_sum)
      ON CONFLICT (oi_id) DO UPDATE SET quantity = EXCLUDED.quantity, shipped = EXCLUDED.shipped;"
  else
    SUMMDDL="CREATE TABLE summ (si_id int PRIMARY KEY, oi_id int NOT NULL REFERENCES oi(id),
                   quantity int NOT NULL, shipped int NOT NULL DEFAULT 0,
                   CONSTRAINT summ_shipped_le_quantity CHECK (shipped::bigint <= quantity::bigint));"
    UPSERT="INSERT INTO summ (si_id, oi_id, quantity, shipped) VALUES (NEW.id, v_oi, v_qty, v_sum)
      ON CONFLICT (si_id) DO UPDATE SET quantity = EXCLUDED.quantity, shipped = EXCLUDED.shipped;"
  fi

  psql "$URL" -v ON_ERROR_STOP=1 -q > "$W/setup.log" 2>&1 <<SQL
DROP TABLE IF EXISTS si, summ, oi CASCADE;
DROP FUNCTION IF EXISTS recompute() CASCADE;

CREATE TABLE oi (id int PRIMARY KEY, quantity int NOT NULL);
CREATE TABLE si (id serial PRIMARY KEY, oi_id int NOT NULL REFERENCES oi(id), qty int NOT NULL);
$SUMMDDL

-- A4a 第四軸的等價最小形:鎖 parent(視 \$1)→ SUM 真相 → upsert 摘要
CREATE FUNCTION recompute() RETURNS trigger LANGUAGE plpgsql AS \$\$
DECLARE v_oi int; v_qty int; v_sum bigint;
BEGIN
  v_oi := COALESCE(NEW.oi_id, OLD.oi_id);
$LOCKLINE
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(qty), 0) INTO v_sum FROM si WHERE oi_id = v_oi;
  $UPSERT
  RETURN NULL;
END \$\$;

-- NOT DEFERRABLE:對齊 order_cancellation_items_summary_recompute_ac(20260803140000:420-423)
CREATE CONSTRAINT TRIGGER si_ac AFTER INSERT OR UPDATE OR DELETE ON si
  NOT DEFERRABLE FOR EACH ROW EXECUTE FUNCTION recompute();

BEGIN;
INSERT INTO oi VALUES (1, $QTY);
COMMIT;
SQL
  # 🔴 每格開跑前硬斷言 fixture 存在 —— setup 靜默失敗會讓判定沒有對象 = harness 自己假綠
  local O S
  O="$(psql "$URL" -qtAc 'SELECT count(*) FROM oi WHERE id=1' 2>/dev/null)"
  S="$(psql "$URL" -qtAc 'SELECT count(*) FROM si WHERE oi_id=1' 2>/dev/null)"
  if [ "$O" != "1" ] || [ "$S" != "0" ]; then
    echo "  🔴 fixture 沒建起來(oi=$O si=$S)—— 判定沒有對象,中止"; tail -5 "$W/setup.log"; exit 1
  fi
}

AURL="${URL}?application_name=b2s1_sess_a"
BURL="${URL}?application_name=b2s1_sess_b"

# 可觀察 barrier,不用固定 sleep(a7t 關卡2 must-fix)
wait_idle() {
  local who="$1" i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name = 'b2s1_sess_${who}' LIMIT 1" 2>/dev/null)"
    case "$st" in idle|'idle in transaction'|'idle in transaction (aborted)') return 0 ;; esac
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session $who 30 秒內沒回到 idle(state=$st)—— 中止,不假裝跑過"; exit 1
}

# 🔴 等某 session **真的被別人擋住**(不是還沒開始跑、也不是已經跑完)。
#    用 pg_blocking_pids 釘死「擋你的是誰」——只等 state=active 會把「正在算」誤判成「被擋」
#    (memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
wait_blocked() {
  local who="$1" i n
  for i in $(seq 1 120); do
    n="$(psql "$URL" -qtAc "SELECT COALESCE(cardinality(pg_blocking_pids(pid)),0)
           FROM pg_stat_activity WHERE application_name = 'b2s1_sess_${who}' LIMIT 1" 2>/dev/null)"
    [ "${n:-0}" -gt 0 ] 2>/dev/null && return 0
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session $who 30 秒內沒有被任何人擋住 —— 這格的前提不成立,中止"; exit 1
}

open2() {
  rm -f "$W/fa" "$W/fb"; mkfifo "$W/fa" "$W/fb"
  ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$W/fa" > "$W/outa.txt" 2>&1 ) & PA=$!
  ( psql "$BURL" -qtA -v ON_ERROR_STOP=0 -f "$W/fb" > "$W/outb.txt" 2>&1 ) & PB=$!
  exec 3>"$W/fa"; exec 4>"$W/fb"
  wait_idle a; wait_idle b
}
sa() { printf '%s\n' "$1" >&3; wait_idle a; }
sb() { printf '%s\n' "$1" >&4; wait_idle b; }
sb_block() { printf '%s\n' "$1" >&4; wait_blocked b; }   # 送給 B、期待它卡住
close2() { exec 3>&-; exec 4>&-; wait $PA $PB 2>/dev/null || true; }

truth() { psql "$URL" -qtAc 'SELECT COALESCE(sum(qty),0) FROM si WHERE oi_id=1'; }
# 🔴 codex G 堆第 1 條:v2 的結論寫「摘要欄顯示 2」卻從未量過它 —— 宣稱大於量測。
summ_shipped() { psql "$URL" -qtAc "SELECT COALESCE((SELECT shipped FROM summ WHERE oi_id=1), -1)"; }
berr()  { tr '\n' ' ' < "$W/outb.txt" | cut -c1-110; }

echo "== A. REPEATABLE READ + 無 parent 鎖 =="
setup nolock converge
open2
sb "BEGIN ISOLATION LEVEL REPEATABLE READ;"
sb "SELECT count(*) FROM si;"                       # B 取快照(此刻零列)
sa "BEGIN;"
sa "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sa "COMMIT;"                                        # A 先落地
sb "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sb "COMMIT;"
close2
TA="$(truth)"; echo "     truth=$TA / B:$(berr)"
if [ "$TA" = "2" ] && grep -q 'could not serialize access' "$W/outb.txt"; then
  ok "A RR 下 B 自己中止(40001,撞摘要列的併發更新)⇒ 沒漏,但這是**隔離級+匯流點**給的,不是鎖"
else
  bad "A 結果不符(truth=$TA)⇒ 重查本 harness,不得直接下結論"
fi

echo "== B. 消融:READ COMMITTED + **拿掉** parent 鎖 —— 預期靜默漏 =="
setup nolock converge
open2
sa "BEGIN;"; sb "BEGIN;"
sa "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sb_block "INSERT INTO si (oi_id, qty) VALUES (1, 2);"   # 期待卡在摘要列的列鎖
sa "COMMIT;"
wait_idle b
sb "COMMIT;"
close2
TB="$(truth)"; SB="$(summ_shipped)"; NERR_B="$(grep -c 'ERROR' "$W/outb.txt" || true)"
echo "     truth=$TB / summ.shipped=$SB / B 錯誤數=$NERR_B / B:$(berr)"
if [ "$TB" = "4" ] && [ "$SB" = "2" ] && [ "${NERR_B:-0}" = "0" ]; then
  ok "B 消融後 **truth=4、摘要卻停在 2、且零錯誤訊息**(三者都實測)⇒ 靜默超量;鎖必須在讀 SUM 之前"
elif [ "$TB" = "4" ]; then
  # 🔴 R2 抓:v3 這一支仍呼叫 ok() ⇒「摘要=2 且零錯誤」不成立也能 PASS。改 bad()。
  bad "B truth=4 但摘要=$SB(預期 2)或錯誤數=$NERR_B(預期 0)⇒ 量到的不是「靜默超量」那個現象"
else
  bad "B 拿掉 parent 鎖竟然沒漏(truth=$TB)⇒ **本 harness 量不到鎖的作用、C 的綠作廢**"
fi

echo "== C. READ COMMITTED + 有 parent 鎖(= A4a/A2b1 現行組合;真實配置)=="
setup lock converge
open2
sa "BEGIN;"; sb "BEGIN;"
sa "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sb_block "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sa "COMMIT;"
wait_idle b
sb "COMMIT;"
close2
TC="$(truth)"; echo "     truth=$TC / B:$(berr)"
if [ "$TC" = "2" ] && grep -q 'summ_shipped_le_quantity' "$W/outb.txt"; then
  ok "C 現行組合擋得住:B 卡 parent 鎖 → A commit 後**重算** SUM=4 → 紅在具名 CHECK、全回滾"
else
  bad "C 現行組合竟然沒擋住(truth=$TC)⇒ S2 不能照抄 A4a 的組合,設計要重來"
fi

echo "== D. 消融:拆掉摘要匯流點(每筆明細各自一列,= A7-t 的形狀)—— 預期漏 =="
setup nolock perrow
open2
sb "BEGIN ISOLATION LEVEL REPEATABLE READ;"
sb "SELECT count(*) FROM si;"
sa "BEGIN;"
sa "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sa "COMMIT;"
sb "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sb "COMMIT;"
close2
TD="$(truth)"; echo "     truth=$TD / B:$(berr)"
if [ "$TD" = "4" ]; then
  ok "D 消融後 **truth=4 落地**(預期的漏)⇒ 成功重現 A7-t 的無匯流點形狀;匯流點確有第二層作用"
else
  bad "D 拆掉匯流點竟然還是不漏(truth=$TD)⇒ **本 harness 量不到匯流點、A/F 兩格結論作廢**"
fi

echo "== E. B 與 C 的差集 —— 證明 parent 鎖是承重件(兩者必須相反)=="
if [ "$TB" = "4" ] && [ "$TC" = "2" ]; then
  ok "E B(無鎖 truth=4)與 C(有鎖 truth=2)終態相反 ⇒ **parent 鎖是承重件**,且承重點 = 它排在讀 SUM 之前"
else
  bad "E B 與 C 沒有分開(B=$TB C=$TC)⇒ 這組案例量不到鎖,C 的綠沒有判別力"
fi

echo "== F. SERIALIZABLE + 無 parent 鎖 =="
setup nolock converge
open2
sa "BEGIN ISOLATION LEVEL SERIALIZABLE;"; sb "BEGIN ISOLATION LEVEL SERIALIZABLE;"
sa "SELECT count(*) FROM si;"; sb "SELECT count(*) FROM si;"
sa "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sb_block "INSERT INTO si (oi_id, qty) VALUES (1, 2);"
sa "COMMIT;"
wait_idle b
sb "COMMIT;"
close2
TF="$(truth)"; echo "     truth=$TF / B:$(berr)"
# 🔴 codex G 堆第 3 條:只要求 truth=2 的話,B 因任何錯誤(連線失敗/語法錯/trigger crash)
#    沒落第二筆也會 PASS。必須釘住「B 是被 40001 序列化失敗擋掉的」。
if [ "$TF" = "2" ] && grep -q 'could not serialize access' "$W/outb.txt"; then
  ok "F SERIALIZABLE:truth=2 且 B 明確紅在 40001(序列化失敗)⇒ 界定完成:三個隔離級都不漏"
elif [ "$TF" = "2" ]; then
  bad "F truth=2 但 B 不是紅在 40001($(berr))⇒ 這格量到的可能是別的失敗,無判別力"
else
  bad "F SERIALIZABLE 下仍漏(truth=$TF)⇒ 與 PG 語意矛盾,先查 harness 自己"
fi

echo
echo "== 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=6 FAIL=0;B/D 兩格的『漏』算 PASS)=="
[ "$FAIL" -eq 0 ] || exit 1

cat <<'CONCLUSION'

── 給 plan §3.2 的結論(可被推翻的形式;本檔五格實證)────────────────────
① 出貨數量軸的超量防護,**承重件 = parent 的 FOR NO KEY UPDATE 鎖**,
   而且承重點是**「鎖排在讀 SUM 之前」**這個順序 —— 不是鎖的存在本身。
   證據 = B(拿掉鎖)靜默漏 vs C(有鎖)紅在具名 CHECK,其餘一字不改。
② 🔴 **B 格是最危險的那種失效:零錯誤訊息、摘要欄顯示 2 而真相是 4。**
   沒有任何監控會叫,只有對帳才看得出來 ⇒ S2 的重算函式**必須**照抄 A4a 既有順序
   (`20260803140000:153-177`),不得為了效能把鎖往後挪或改成 advisory lock。
③ 摘要匯流點(每 order_item 恰一列)是**第二層**保護,不是第一層:
   它在 RR/SERIALIZABLE 下會製造 40001(A/F 格),在 RC 下**擋不住**(B 格)。
   ⇒ 不得以「反正摘要會撞」當作省略鎖的理由。
④ **A7-t 合約債的結論不轉移到本片的 INSERT 路徑** —— A7-t 的兩交易無共同寫入點(D 格重現了
   那個形狀、確實漏),本片有匯流點但仍需鎖。兩者的正解相同(鎖 + 順序),**理由不同**;
   引用時要引本檔,不要引 A7-t。
⑤ ⚠️ 成立條件:所有寫入路徑都經過這支重算 trigger。繞過它的路徑(backfill、批次匯入、
   手動修補)不在覆蓋範圍 —— 那是 ACL 的責任(摘要表 service_role 只 SELECT)。
CONCLUSION

# ── G. Q3=A 分支:包裹作廢(deleted_at UPDATE)+ 多品項鎖序死結 ──────────────
# Sean 2026-08-05 拍 Q3=A(作廢退回數量)⇒ 本格已接線。
# 要證的**不是**重跑 A-F,而是 Q3=A 獨有的那個風險:
#   一張包裹可含**多個 order_item**;兩張包裹共用同一組品項、同時作廢,
#   若逐 item 取 parent 鎖的**順序不固定** ⇒ 反序 = 死結 40P01(A2b1 前例)。
#   G1 有 ORDER BY  → 預期**不死結**(其中一方等待,兩方最終都成功);試驗次數 = $TRIALS
#   G2 消融無 ORDER BY → 預期**重現 40P01**(否則「ORDER BY 是守門」這句話沒被證明)
echo
echo "== G. Q3=A 作廢路徑:多品項包裹的鎖序 =="

setup_void() {  # $1 = ordered | unordered
  local ORDERBY=""
  [ "$1" = "ordered" ] && ORDERBY=" ORDER BY si.order_item_id"
  psql "$URL" -v ON_ERROR_STOP=1 -q > "$W/setupv.log" 2>&1 <<SQL
DROP TABLE IF EXISTS si, summ, shp, oi CASCADE;
DROP FUNCTION IF EXISTS recompute_one(int) CASCADE;
DROP FUNCTION IF EXISTS on_void() CASCADE;

CREATE TABLE oi   (id int PRIMARY KEY, quantity int NOT NULL);
CREATE TABLE shp  (id int PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE si   (id serial PRIMARY KEY, shp_id int NOT NULL REFERENCES shp(id),
                   oi_id int NOT NULL REFERENCES oi(id), qty int NOT NULL);
CREATE TABLE summ (oi_id int PRIMARY KEY REFERENCES oi(id), quantity int NOT NULL,
                   shipped int NOT NULL DEFAULT 0,
                   CONSTRAINT summ_shipped_le_quantity CHECK (shipped::bigint <= quantity::bigint));

-- A4a 核心的等價最小形:鎖 parent(NKU)→ SUM(排除已作廢)→ upsert
CREATE FUNCTION recompute_one(p_oi int) RETURNS void LANGUAGE plpgsql AS \$\$
DECLARE v_qty int; v_sum bigint;
BEGIN
  SELECT quantity INTO v_qty FROM oi WHERE id = p_oi FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(sum(si.qty), 0) INTO v_sum
    FROM si JOIN shp s ON s.id = si.shp_id
   WHERE si.oi_id = p_oi AND s.deleted_at IS NULL;      -- Q3=A:排除已作廢
  INSERT INTO summ (oi_id, quantity, shipped) VALUES (p_oi, v_qty, v_sum)
    ON CONFLICT (oi_id) DO UPDATE SET quantity = EXCLUDED.quantity, shipped = EXCLUDED.shipped;
END \$\$;

-- 第六支 trigger:作廢 → 逐 item 重算。ORDER BY 有無 = 本格的自變數
CREATE FUNCTION on_void() RETURNS trigger LANGUAGE plpgsql AS \$\$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT si.oi_id FROM si WHERE si.shp_id = NEW.id$ORDERBY LOOP
    PERFORM recompute_one(r.oi_id);
    n := n + 1;
    -- 🔴 barrier:取得第一把 parent 鎖之後、去拿第二把之前,卡在**共享**advisory lock 上。
    --    控制端持有同一把的**獨佔**鎖 ⇒ 兩個交易都會停在這裡;控制端一放,
    --    兩邊同時取得共享鎖並繼續 ⇒ 反序取第二把鎖的競態被決定性地製造出來。
    --    (shared 不是排他 ⇒ 放行後兩邊真的並行,不會被 barrier 自己序列化)
    IF n = 1 THEN PERFORM pg_advisory_xact_lock_shared(42); END IF;
  END LOOP;
  RETURN NULL;
END \$\$;

CREATE CONSTRAINT TRIGGER shp_void_ac AFTER UPDATE ON shp
  NOT DEFERRABLE FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION on_void();

BEGIN;
INSERT INTO oi  VALUES (1, 10), (2, 10);
INSERT INTO shp VALUES (100, NULL), (200, NULL);
-- 🔴 兩張包裹**都**含品項 1 與 2 ⇒ 兩個作廢交易會競爭同一組 parent 鎖
-- 🔴 實體列順序**刻意相反**:100 是 (1,2)、200 是 (2,1)
--    ⇒ 無 ORDER BY 時兩支 trigger 的 SELECT DISTINCT 會以相反順序回傳 = 反序取鎖
INSERT INTO si (shp_id, oi_id, qty) VALUES (100, 1, 1), (100, 2, 1), (200, 2, 1), (200, 1, 1);
COMMIT;
SQL
  local N
  N="$(psql "$URL" -qtAc 'SELECT count(*) FROM si' 2>/dev/null)"
  [ "$N" = "4" ] || { echo "  🔴 作廢 fixture 沒建起來(si=$N)—— 判定沒有對象,中止"; tail -5 "$W/setupv.log"; exit 1; }
  # 前提斷言:無 ORDER BY 時,兩張包裹的 DISTINCT 回傳序**必須相反** ——
  # 否則「反序取鎖」根本沒發生,不死結會被誤讀成「ORDER BY 沒用」。
  if [ "$1" = "unordered" ]; then
    local o1 o2
    o1="$(psql "$URL" -qtAc "SELECT string_agg(oi_id::text, '-') FROM (SELECT DISTINCT si.oi_id FROM si WHERE si.shp_id=100) q")"
    o2="$(psql "$URL" -qtAc "SELECT string_agg(oi_id::text, '-') FROM (SELECT DISTINCT si.oi_id FROM si WHERE si.shp_id=200) q")"
    printf '%s vs %s\n' "$o1" "$o2" > "$W/void_orders.txt"
  fi
}

# 🔴 v2 的 G 段設計錯了,這裡記錄為什麼 —— 不是刪掉重寫而已:
#   原版讓 A 先 `SELECT oi 1 FOR NO KEY UPDATE`、B 先鎖 oi 2(模擬「trigger 已取得第一把鎖」),
#   再讓兩邊各自作廢。**那樣 ORDER BY 根本不可能有用** —— 死結是「預先反序持鎖」造成的,
#   不是 trigger 迭代順序造成的 ⇒ 兩組都該死結,G1 卻回報零死結
#   = **典型的「沒有 barrier 的競賽測試綠了不代表任何事」**
#     (memory `feedback_race-test-without-barrier-proves-nothing`):
#     那個零很可能只是 A 的 UPDATE 在 B 開始之前就整個跑完了。
#
# v3 正確設計:**不預先持鎖**。兩張包裹共用同一組品項,但**實體列順序相反**
#   (100 先插 oi1 再 oi2;200 先插 oi2 再 oi1)⇒ 無 ORDER BY 時兩支 trigger 的
#   `SELECT DISTINCT` 會以相反順序回傳 ⇒ 反序取鎖 ⇒ 死結。有 ORDER BY 時兩邊同序 ⇒ 只會排隊。
#
# 🔴 誠實邊界:兩個 UPDATE 是否真的同時在飛,**無法用 pg_stat_activity 決定性保證**
#   (不像 A-F 那些格有明確的「誰擋誰」)。⇒ 本格改為**重複試驗 + 計次**,
#   結論是統計性的、不是決定性的,判定式也照這個強度寫。
TRIALS=8

CURL="${URL}?application_name=b2s1_ctl"

# 等兩個 session 都真的卡在 advisory lock 42 上(= barrier 已就位)
wait_both_at_barrier() {
  local i n
  for i in $(seq 1 120); do
    n="$(psql "$URL" -qtAc "SELECT count(*) FROM pg_locks l
           JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype='advisory' AND NOT l.granted
            AND a.application_name IN ('b2s1_sess_a','b2s1_sess_b')" 2>/dev/null)"
    [ "${n:-0}" = "2" ] && return 0
    sleep 0.25
  done
  return 1
}

void_race_once() {
  # 控制端走 fifo:持獨佔 advisory 42 → 等兩邊都卡上 barrier → 才放行
  # (前一版用 pg_sleep(0.3) 就結束 ⇒ 鎖在兩邊抵達 barrier 之前就放掉了,barrier 0/8 就是這樣來的)
  rm -f "$W/fc"; mkfifo "$W/fc"
  ( psql "${URL}?application_name=b2s1_ctl" -qtA -v ON_ERROR_STOP=0 -f "$W/fc" > "$W/outc.txt" 2>&1 ) & PC=$!
  exec 5>"$W/fc"
  printf '%s\n' "SELECT pg_advisory_lock(42);" >&5
  local i
  for i in $(seq 1 40); do
    [ "$(psql "$URL" -qtAc "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted AND objid=42" 2>/dev/null)" != "0" ] && break
    sleep 0.1
  done

  open2
  sa "BEGIN;"; sb "BEGIN;"
  printf '%s\n' "UPDATE shp SET deleted_at = now() WHERE id = 100; COMMIT;" >&3
  printf '%s\n' "UPDATE shp SET deleted_at = now() WHERE id = 200; COMMIT;" >&4

  if wait_both_at_barrier; then BARRIER_OK=1; else BARRIER_OK=0; fi
  printf '%s\n' "SELECT pg_advisory_unlock(42);" >&5    # 放行:兩邊同時取得 shared
  exec 5>&-; wait $PC 2>/dev/null || true

  for i in $(seq 1 160); do
    local sa_n sb_n
    sa_n="$(psql "$URL" -qtAc "SELECT count(*) FROM pg_stat_activity WHERE application_name='b2s1_sess_a' AND state='active'" 2>/dev/null)"
    sb_n="$(psql "$URL" -qtAc "SELECT count(*) FROM pg_stat_activity WHERE application_name='b2s1_sess_b' AND state='active'" 2>/dev/null)"
    [ "${sa_n:-0}" = "0" ] && [ "${sb_n:-0}" = "0" ] && break
    sleep 0.25
  done
  close2
  printf '%s' "$BARRIER_OK" > "$W/barrier_ok.txt"
}

count_deadlocks() {  # $1 = ordered | unordered ; 回傳試驗中出現死結的次數
  local mode="$1" n=0 b=0 e=0 t
  for t in $(seq 1 $TRIALS); do
    setup_void "$mode"
    void_race_once
    [ "$(cat "$W/barrier_ok.txt" 2>/dev/null)" = "1" ] && b=$((b+1))
    if cat "$W/outa.txt" "$W/outb.txt" | grep -qi 'deadlock'; then
      n=$((n+1))
    elif cat "$W/outa.txt" "$W/outb.txt" | grep -qi 'ERROR'; then
      e=$((e+1))          # 非死結的其他錯誤:proven 判定要看它
    fi
  done
  printf '%s' "$b" > "$W/barrier_hits_${mode}.txt"
  [ "$mode" = "ordered" ] && printf '%s' "$e" > "$W/ordered_err.txt"
  echo "$n"
}

echo "-- G1. 有 ORDER BY order_item_id(設計字面)—— 預期零死結 --"
DL="$(count_deadlocks ordered)"
echo "     $TRIALS 次試驗中死結 $DL 次"
echo "-- G2. 消融:拿掉 ORDER BY —— 預期至少出現一次 40P01 --"
DL2="$(count_deadlocks unordered)"
echo "     $TRIALS 次試驗中死結 $DL2 次"

BH_O="$(cat "$W/barrier_hits_ordered.txt" 2>/dev/null || echo 0)"
BH_U="$(cat "$W/barrier_hits_unordered.txt" 2>/dev/null || echo 0)"
echo "     barrier 就位次數:同序組 $BH_O/$TRIALS、反序組 $BH_U/$TRIALS"

# 🔴 前提斷言:barrier 沒就位 = 兩個交易從未同時卡在第一把鎖之後 ⇒ 這組數字沒有意義。
#    這條就是「沒有 barrier 的競賽測試綠了不代表任何事」的直接對治。
# 🔴 R2 抓:v3 只要求反序組 barrier ⇒ 同序組八次都沒真併發也能被判 proven。兩組都要求。
if [ "$BH_U" -lt 1 ] || [ "$BH_O" -lt 1 ]; then
  bad "G 前提不成立:barrier 就位 同序組=$BH_O 反序組=$BH_U(兩組都需 ≥1)⇒ 競態未發生,本格無效"
  G_STATE=inconclusive
else

# 🔴 codex G 堆第 4 條:只計 deadlock 字串的話,ORDER BY 組即使全部試驗都因 55P03
#    或其他錯誤失敗,只要零 deadlock 就會假 PASS。要求它是**成功**完成。
ORD_ERR="$(cat "$W/ordered_err.txt" 2>/dev/null || echo unknown)"
if [ "$DL2" -ge 1 ] && [ "$DL" = "0" ] && [ "$ORD_ERR" = "0" ]; then
  ok "G 有 ORDER BY 零死結且**零錯誤完成**($TRIALS 試)/ 消融後死結 $DL2 次 ⇒ **ORDER BY 是承重件**(統計證據)"
  G_STATE=proven
elif [ "$DL2" -ge 1 ] && [ "$DL" = "0" ]; then
  bad "G ORDER BY 組雖零死結,但有 $ORD_ERR 次以其他錯誤收場 ⇒ 它不是「順利通過」,不得判 proven"
  G_STATE=failed
elif [ "$DL2" = "0" ]; then
  # 🔴 這**不是** PASS 也**不是**設計失敗,是「這支 harness 造不出那個競態」。
  #    照 memory `feedback_unconstructible-negative-test-means-noop-guard`:
  #    負測構造不出來時,第一件事是懷疑那條守門是不是 no-op —— 但也可能只是 harness 不夠力。
  #    兩者都不准當成「已驗證」,所以獨立成一個狀態、並讓整支腳本回非零。
  G_STATE=inconclusive
  printf '  ⚠️  %s\n' "G 無判別力:消融組 $TRIALS 次都沒死結 ⇒ 本 harness **造不出**兩個 void 交易的真併發"
else
  bad "G 有 ORDER BY 仍死結 $DL 次 ⇒ ORDER BY 不足以解,S2b 設計要重來"
  G_STATE=failed
fi
fi

echo
echo "== G 段結果:狀態=$G_STATE(A-F 段 PASS=$PASS FAIL=$FAIL)=="

if [ "$G_STATE" = "proven" ] && [ "$FAIL" -eq 0 ]; then
  cat <<'GOK'

── G 段給 plan §3.2b 的結論 ──────────────────────────────────────────
· `ORDER BY order_item_id` 是承重件:有它零死結、消融後重現 40P01。
· 🔴 統計證據、非決定性(重複 $TRIALS 次計次)—— 引用時照這個強度講。
GOK
  exit 0
fi

[ "$FAIL" -eq 0 ] || exit 1

cat <<'GBAD'

── 🔴 G 段結論:**鎖序守門「未證明」,不是「已驗證」** ──────────────────────
消融掉 ORDER BY 之後,全部試驗一次死結都沒有。**診斷輸出直接指出原因**:
消融組的 `SELECT DISTINCT si.oi_id` 兩張包裹回傳序是 **`1-2 vs 1-2`(相同)** ——
即使實體列順序刻意插成相反,**`DISTINCT` 自己就把結果排序了**(本例 PG 選了 Sort/走索引序),
⇒ **反序取鎖從頭到尾沒有發生**,消融組與對照組實際上跑的是同一件事。

🔴 這條的價值不在「證明了什麼」,在於它**否證了我原本的構造**:
   「拿掉 ORDER BY 就會反序」是錯的 —— `DISTINCT` 的輸出順序雖然**不是契約**,
   但在這個資料量下 PG 事實上給了排序結果。

⇒ **對 plan 的處置(已寫進 §3.2b 與驗收 32)**:
① `ORDER BY order_item_id` **照留**。理由不是「已證明有用」,是
   **`DISTINCT` 的輸出順序不是契約** —— 資料量一大 PG 可能改走 HashAggregate、回傳任意序,
   屆時反序取鎖就會發生。留一個成本近乎零、把「靠實作細節」換成「靠明文契約」的 ORDER BY 是對的。
② 但**不得宣稱它已驗證**,也不得寫成「已防死結」。
③ S2b 施工時要重試構造這個負測,**而且要換一種構造** —— 已知 `DISTINCT` 排序會擋住,
   可行方向 = 在重算函式注入 advisory-lock 同步點,強迫兩個交易在迴圈中途交錯。
   仍構造不出來 ⇒ 把「這條守門在真實路徑下是 no-op」當成正式候選結論提給審查,
   而不是默默留著一條沒被測過的守門。

GBAD
exit 1
