#!/usr/bin/env bash
# ============================================================
# #352-a2 驗證 harness —— 到貨登錄 / 刪除兩支 RPC
# ============================================================
# 規格 = docs/specs/2026-08-10-352-receipt-recording-plan-v3.md §3(RPC)、§7(驗收 6-23)
# 用法:先 `PORT=54352 bash scripts/d1t2-rehearsal.sh provision /tmp/352a2-work`
#       再 `PORT=54352 bash scripts/352a2-verify.sh /tmp/352a2-work`
# 形狀照 a5a-verify.sh / a2b1-verify.sh:三計數器 + 身分閘 + 全程 BEGIN…ROLLBACK 零留痕
#       + DB 內突變(每發先證「突變真的套上了」才談紅綠)。
#
# ══ 🔴 本檔目前是【骨架】,不是完成品 ═══════════════════════
#   a2 的兩支 RPC **還沒寫**(本檔隨 a1 收工時先立,讓 a2 開工時只要填 body)。
#   ⇒ 現在跑它會**紅在身分閘**(RPC 不存在)。那是**刻意的**:
#     骨架不可以在「被驗的東西還不存在」時吐綠 —— 那正是本 repo 最常復發的假綠形狀。
#   ⇒ 每一格的位置、名稱、期望都已寫死;`TODO(a2)` 標的是待填的**斷言主體**,不是待決定的規格。
#
# ══ 🔴 三種格,計數分開,收尾三道閘 ═════════════════════════
#   PASS/FAIL —— 一般格。
#   CELL      —— 矩陣格數(同 a2b1/a5a 的用法)。
#   **PEND**  —— 🟡 **留白格**:規格已知、但**答案還在人手上**,不可以當成通過、也不可以消失。
#                收尾要求 `PEND == EXPECTED_PEND`;有人偷偷把留白格刪掉 ⇒ 收尾閘紅。
#                (形制對齊 P 窗 -t1 的留白半;理由:靜默缺席與假綠是同一種病。)
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/352a2-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54352}/postgres"
MIGFILE_A1="supabase/migrations/20260810230000_m4b_e10_352a1_receipt_recording_schema.sql"
# TODO(a2):a2 migration 落檔後填入(前綴由主視窗集中發號)
MIGFILE_A2=""

FN_RECORD="public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)"
FN_DELETE="public.admin_delete_item_receipt(uuid,text)"

PASS=0; FAIL=0; CELL=0; PEND=0; MUT=0
EXPECTED_TOTAL=0     # TODO(a2):填最終格數
EXPECTED_MUT=0       # TODO(a2):填突變靶數
EXPECTED_PEND=1      # 🟡 現在恰 1 格留白(溢收列 × 取消閘;等 Sean 拍)

ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
pend() { PEND=$((PEND+1)); printf '  PEND %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(照 a5a-verify.sh:45-55 六重 + 本片兩支 RPC)────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIGFILE_A1" || { echo "🔴 $MIGFILE_A1 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;紅色判定依賴英文 ERROR 前綴;拒跑"; exit 1; }

# 🔴 a1 的地基必須在(否則後面每一格都會紅在錯的地方,看起來像 a2 壞了)
[ "$(q "SELECT count(*) FROM pg_class WHERE oid='public.order_item_receipt_requests'::regclass")" = "1" ] \
  || { echo "🔴 a1 的冪等帳表不在;先套 a1 再跑本檔"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_item_procurement_receipts'::regclass AND attname='surplus_quantity' AND NOT attisdropped")" = "1" ] \
  || { echo "🔴 a1 的 surplus_quantity 欄不在;先套 a1"; exit 1; }

# 🔴 兩支 RPC 必須在 —— 骨架階段這裡就會擋下來,**這是刻意的**(見檔頭)
for FN in "$FN_RECORD" "$FN_DELETE"; do
  [ "$(q "SELECT count(*) FROM pg_proc WHERE oid = '$FN'::regprocedure" 2>/dev/null)" = "1" ] \
    || { echo "🔴 RPC 不在:$FN"
         echo "   ⇒ 本檔是 a2 的驗收 harness,a2 尚未實作 ⇒ **拒跑、不吐綠**。"
         echo "   ⇒ 這不是故障:骨架在被驗對象不存在時吐綠,才是故障。"
         exit 1; }
done

# ── 判定原語:每格全程 BEGIN…ROLLBACK(零留痕) ───────────────
# case_ok <label> <sql>   —— sql 內以 RAISE 表示失敗
case_ok() {
  local label="$1" body="$2" out
  out=$(psql "$URL" -qtAX <<SQL 2>&1
BEGIN;
DO \$c\$ BEGIN
$body
END \$c\$;
ROLLBACK;
SQL
)
  if echo "$out" | grep -q 'ERROR:'; then bad "$label — $(echo "$out" | grep -m1 'ERROR:' | cut -c1-110)"
  else ok "$label"; fi
}

# expect_code <label> <sql> <期望的回傳代碼字串>
#   🔴 用在「RPC 回代碼字串」那一族(§3.0:輸入/業務結果回代碼,不 RAISE)
expect_code() { :; }   # TODO(a2)

# expect_sqlstate <label> <sql> <期望 SQLSTATE>
#   🔴 只給「必須回滾」那一族(目前僅 P4A03)。
#   ⚠️ 比對 SQLSTATE **不要**比中文訊息:訊息會被改,碼是契約。
expect_sqlstate() { :; }   # TODO(a2)

echo "── #352-a2 驗收 ──────────────────────────────────────────"

# ══ A 區:結構(RPC 的形狀與權限)═══════════════════════════
# A1  兩支皆 SECURITY DEFINER + search_path = public, pg_temp        TODO(a2)
# A2  EXECUTE 權恰 service_role、且 is_grantable = false             TODO(a2)
#     🔴 a1 的教訓:只驗「有 SELECT/EXECUTE」會漏掉 WITH GRANT OPTION。
# A3  🔴 取鎖序 prosrc 錨:proc 的 NKU 出現在 order_items 的 NKU 之前 TODO(a2)
#     突變:把兩行對調 ⇒ 本格必紅(plan §4 的失效條件①)
# A4  🔴 `SET CONSTRAINTS … summary_recompute_zc IMMEDIATE`
#     **只准出現在 delete 那支**(plan §3.1-2:record 不需要、且它有副作用)  TODO(a2)
# A5  ledger 仍為零 FK(plan §4 失效條件②:有人補 FK ⇒ 整段鎖序論證要重跑) TODO(a2)

# ══ B 區:登錄正向 ═════════════════════════════════════════
# B1  一般到貨 ⇒ received / instock 同步上升(A4a 級聯真的跑了)      TODO(a2)
# B2  溢收 quantity=0 / surplus=N ⇒ received、instock **皆不變**      TODO(a2)
# B3  帶連字號的小寫 UUID 當 request_id ⇒ 收得下                     TODO(a2)

# ══ C 區:登錄負向 ═════════════════════════════════════════
# C1  超收 ⇒ 回 'QUANTITY_EXCEEDS_ALLOCATED'(**不是** raw 23514、也不是 RAISE) TODO(a2)
# C2  p_procurement_id 不存在 ⇒ 回 'PROCUREMENT_NOT_FOUND'(**不是** raw 23503)
#     且 **ledger 不留孤兒列**(plan §3.1-5:同交易回滾)              TODO(a2)
# C3  大寫 request_id ⇒ 拒收(**不是**靜默 lower)                    TODO(a2)
# C4  p_received_at 未來值(> clock_timestamp + 5 分)⇒ 拒;
#     **5 分鐘內的未來值收得下**(證明寬限真的在,不是把整條路封死)  TODO(a2)

# ══ D 區:冪等(plan §7-10 五格)═══════════════════════════
# D1  同鍵同 payload ⇒ DUPLICATE_REQUEST 且 receipt **只有一列**      TODO(a2)
# D1a 🔴 **note = NULL 的同鍵重放 ⇒ 必須 DUPLICATE_REQUEST**(Fable R3-F1)
#     ⚠️ 本格 fixture **必須用 NULL note**;拿非空 note 跑會讓它恆綠 = fixture-vacuous。
#     突變:把 IS NOT DISTINCT FROM 改回 `=` ⇒ 本格必紅            TODO(a2)
# D2  同鍵**不同 payload** ⇒ RAISE(caller bug、不具名碼)            TODO(a2)
# D3  同鍵掛**不同 procurement** 的併發 ⇒ 不得外洩 raw 23505         TODO(a2)
# D4  🔴 receipt INSERT 失敗 ⇒ **ledger 同滾**;之後同鍵重送必須**成功**
#     (回 RECORDED,不得誤判 DUPLICATE)—— F3 折面的承重點           TODO(a2)
# D5  **不復活**:登錄 → 刪除 → 同鍵重送 ⇒ DUPLICATE_REQUEST 且 receipt 沒被重建 TODO(a2)

# ══ E 區:刪除 ═════════════════════════════════════════════
# E1  正向:刪掉 N 件 ⇒ instock 退回                                  TODO(a2)
# E2  守門:N 件已裝進未出貨包裹 ⇒ P4A03、訊息**列出全部包裹**、交易回滾 TODO(a2)
# E3  **判別力**:已刪的 id ⇒ ALREADY_DELETED;**隨機不存在的 uuid ⇒ RECEIPT_NOT_FOUND**
#     (不可以兩者都回成功 —— 那會讓任何亂數 uuid 得到「成功」)      TODO(a2)
# E4  併發雙刪 ⇒ 一個 DELETED、另一個 ALREADY_DELETED
#     突變:拿掉 `DELETE … RETURNING` 的 rowcount 判斷 ⇒ 本格必紅(Fable R3-F5) TODO(a2)
# E5  **fail-closed**:摘要列缺席 ⇒ 刪除被 RAISE 擋下(**不是**靜默放行)
#     🔴 A4a 惰性建列 ⇒ 缺列是真的會發生的態,不是理論值             TODO(a2)

# ══ F 區:deferred(plan §3.3)══════════════════════════════
# F1  呼叫端先 SET CONSTRAINTS … DEFERRED 再呼叫**刪除** ⇒ 守門仍擋得住 TODO(a2)
# F2  同條件呼叫**登錄** ⇒ 行為不變
#     🔴 F2 是在證明「record 不需要 IMMEDIATE」這句**不是宣稱**       TODO(a2)

# ══ G 區:🟡 留白(等 Sean 拍板,不可當通過、不可刪除)═══════
pend "G1 溢收列 × 取消閘 —— plan §8-10:兩道取消閘(20260804180000:217-219 / 20260805100000:411-413)
       用 r.quantity > 0 當「有沒有到貨」的述詞 ⇒ quantity=0 的溢收專用列會被判成「沒到貨」
       ⇒ 貨其實到了卻可整單取消(撞 Sean 2026-07-28 Q17=B)。
       **這是產品題不是技術題**,答案在 Sean 手上。
       ⇒ 本格待拍板後填入:造一列 quantity=0/surplus=N,對該單跑整單取消,
         把當下行為釘成可觀察事實(不論拍哪一邊都不可以讓它靜默)。"

echo "──────────────────────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL CELL=$CELL MUT=$MUT PEND=$PEND"

# ── 收尾四道閘(任一不成立 = 整支紅)──────────────────────
GATE_FAIL=0
[ "$FAIL" -eq 0 ] || { echo "🔴 有 $FAIL 格紅"; GATE_FAIL=1; }
count_gate "$EXPECTED_TOTAL" "$((PASS+FAIL))" || { echo "🔴 格數 $((PASS+FAIL)) ≠ 凍結值 $EXPECTED_TOTAL(有格被刪或漏跑)"; GATE_FAIL=1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 突變數 $MUT ≠ 凍結值 $EXPECTED_MUT"; GATE_FAIL=1; }
# 🟡 留白格的收尾閘:少了 ⇒ 有人把待拍板的題目偷偷刪掉;多了 ⇒ 有新的題沒被登記
count_gate "$EXPECTED_PEND" "$PEND" || { echo "🔴 留白格 $PEND ≠ 凍結值 $EXPECTED_PEND(留白被刪或新增未登記)"; GATE_FAIL=1; }

if [ "$PEND" -gt 0 ]; then
  echo "🟡 尚有 $PEND 格留白等人拍板 ⇒ **本線未完成**,不得據此宣稱 a2 驗收通過。"
fi
[ "$GATE_FAIL" -eq 0 ] || exit 1
echo "✅ #352-a2 驗收全綠(留白格另計)"
