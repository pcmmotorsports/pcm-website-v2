#!/usr/bin/env bash
# ci-self-contained: no  (要一台已 apply 完 migrations 的 PG;用 migrations-replay-from-zero.sh --keep-db 起)
# sent-tracking-mutations.sh —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 的【承重點突變】。
#
# 🔴🔴 **它與 `sent-tracking-three-worlds.sql` 的分工**:
#   那一支證「判準在十個世界裡答對了」;**本支證「那些答案是【被哪一行】撐住的」。**
#   ⇒ 📌 十格全綠而某一行其實可以拿掉 ⇒ 那一行不是承重, 而測試不會告訴你。
#
# 🎯 **本支最重要的設計:每一格突變的 view SQL 都是【跑的時候從 migration 抽出來】的,**
#    **然後只做【一次字串取代】** ⇒ **「只差一個變因」是機械保證的, 不是我保證的。**
#    🔴 而那正是我在 `shipped-tracking-two-connection-race-probe.sh` 做錯過的事:
#      我宣稱「兩個世界只差 delay」, 而實際上 hold 也改了(codex 2026-09-05 抓到)。
#      ⇒ **人保證不了「我只改了一個東西」—— 那要由產生它的方式保證。**
#
# ⚠️ **它證不到什麼**:
#   ① 它只證那四行【現在】是承重的, 不證它們涵蓋了所有該擋的世界。
#   ② 它跑在拋棄式 PG 上 ⇒ 答的是判準的邏輯, 不是正式庫的行為。
#   ③ 突變是【字串取代】⇒ 有人改了那幾行的寫法(空白、換行), 錨會找不到 ⇒ **本支會紅**,
#     而那是【對的】:錨找不到就代表我不知道自己在測什麼。
set -u
PORT="${1:-}"
MIG=supabase/migrations/20260905200000_m4b_outbox_record_sent_tracking_number.sql
[ -n "$PORT" ] || { echo "用法: bash $0 <PG port>   (先跑 migrations-replay-from-zero.sh --keep-db)"; exit 2; }
[ -f "$MIG" ] || { echo "🔴 找不到 $MIG"; exit 3; }

# ── 🔴🔴 **每一發都在一個【現造的資料庫】上跑** ────────────────────────────
#    成因:本支**不 rollback**(它要跨 psql 呼叫看得到 fixture 的資料)
#    ⇒ 跑完那台 PG 就髒了 ⇒ 第二次跑時那支 fixture 的前置閘說「orders 不是空的」而停
#    ⇒ 📌 **一支只能跑一次的探針, 等於每次要重播 313 支 migration 才能用**(實測兩次)。
# ✅ 用 `CREATE DATABASE … TEMPLATE postgres` 複製一份 ⇒ 髒的是複本, 收工就丟。
#    🔵 發 CREATE 的那一發**必須連 template1** —— 連著 `postgres` 就不能拿它當範本
#      (`source database is being accessed by other users`)。
# 🔵 **暫存檔名帶 PID**(codex R2 nit)—— 八個窗同時跑時固定檔名會互相覆寫,
#    而覆寫之後那些 FAIL **看起來像判準壞了**, 沒有人歸因得到「是另一個窗改了我的檔」。
W="${TMPDIR:-/tmp}/mut-$$"
RUNDB="mut_$$"
psql -h /tmp -p "$PORT" -U postgres -d template1 -q \
  -c "CREATE DATABASE \"$RUNDB\" TEMPLATE postgres" > "$W-createdb.log" 2>&1 \
  || { echo "🔴 建不出複本資料庫 ⇒ ENV-FAIL"; cat "$W-createdb.log"; exit 3; }
cleanup_db () { psql -h /tmp -p "$PORT" -U postgres -d template1 -q \
                  -c "DROP DATABASE IF EXISTS \"$RUNDB\"" > /dev/null 2>&1; }
trap cleanup_db EXIT
echo "🔵 本發在複本 $RUNDB 上跑(收工自動丟掉;原本那顆庫不會被弄髒)"

FAILED=0; PASSED=0
q1 () { psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -tAc "$1" 2>&1; }
chk () { if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
         else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED+1)); fi ; }

# 🟢 先把十個世界灌進去(它自己是 BEGIN…ROLLBACK, 所以這裡要【不 rollback】的版本)。
#    ⇒ 用 psql 的 -v 讓那支檔跳過結尾的 ROLLBACK 做不到 ⇒ 改成在同一個 session 裡先跑 fixture 再測。
#    🔴 而那正是本支需要一台【專用】PG 的理由:它會留下資料。
# ── 從 migration 抽出真的 view SQL(跑的時候抽, 不是抄一份)──
# 🔴 **順序很重要**:先抽 ⇒ 再灌世界 ⇒ **再還原 view** ⇒ 才量基準。
#    因為那支 fixture 跑完時 view 停在【它自己的突變版】(它靠 ROLLBACK 收尾, 而本支不 rollback)。
python3 - "$MIG" > "$W-view-real.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
# 🔴🔴 **2026-09-05 片 B-2 改結構之後, 承重的那幾行搬到【底面】了。**
#    主面現在只剩「有收件人」那一半 ⇒ 在它身上找 `last.order_id = o.id` 會**找不到錨**
#    ⇒ 本支會紅, 而那是對的(見檔頭③)。這裡把抽取目標換成底面。
key='CREATE OR REPLACE VIEW public.pcm_tracking_correction_candidates\n  WITH (security_invoker = true) AS'
assert s.count(key)==1, f'錨命中 {s.count(key)} 次 ⇒ 拒繼續(我不知道自己抽到什麼)'
# 🔴🔴 **抽的是【兩支一起】** —— 底面 + 主面(中間的 REVOKE/GRANT/COMMENT 一併帶走, 重下無害)。
#    ⛔ 只抽底面 ⇒ 那支 fixture 在 §4 把【主面】換成它自己的突變版, 而還原只還了底面
#      ⇒ 🛑 基準集合量到的是 fixture 的突變版 ⇒ **五格全紅, 而碼是對的**(2026-09-05 當場踩到)。
#    ⇒ 📌 「還原」要還到**每一個被動過的物件**, 而不是我記得的那一個。
i=s.find(key); j=s.find('COMMENT ON VIEW public.pcm_tracking_corrected_email_pending', i)
v=s[i:j].rstrip(); assert v.endswith(';')
sys.stdout.write(v)
PY
[ -s "$W-view-real.sql" ] || { echo "🔴 抽不出 view SQL ⇒ 拒繼續"; exit 3; }

# 🔴 **先把兩支 view 還原一次, 再灌世界** ——
#    本支【不 rollback】⇒ 它跑完會把 fixture 的突變版留在庫上。
#    ⇒ 下一次再跑時, 那支 fixture 的前置閘會說「主面沒有讀底面」而停(2026-09-05 當場踩到)。
#    ⇒ 📌 一支會弄髒環境的探針, 要能**自己把環境洗回可跑的狀態**, 否則它只能跑一次。
#    ⚠️ 而它洗不掉**資料** —— fixture 灌的那十個世界是 COMMIT 的
#      ⇒ **本支仍然需要一台專用 PG**(見檔頭)。
psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -v ON_ERROR_STOP=1 -q -f "$W-view-real.sql" > /dev/null 2>&1

echo "── 灌世界(sent-tracking-three-worlds.sql;ROLLBACK 換成 COMMIT)──"
# 🔴 **換成 COMMIT 不是換成註解** —— 換成註解的話交易永遠不結束,
#    psql 一離開就整批回滾 ⇒ 基準集合是空的, 而**空比空**會讓「還原」那幾格【恆真】。
#    (2026-09-05 當場踩到:PASS=4 全部來自那個恆真。)
sed 's/^ROLLBACK;$/COMMIT;/' scripts/sent-tracking-three-worlds.sql \
  | psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -v ON_ERROR_STOP=1 -q > "$W-fixture.log" 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then echo "🔴 灌世界失敗 rc=$RC ⇒ 後面每一格都不算數"; tail -3 "$W-fixture.log"; exit 3; fi

# 🔵 把 view 還原成 migration 那一版(fixture 留下的是它自己的突變版)
psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -v ON_ERROR_STOP=1 -q -f "$W-view-real.sql" > /dev/null 2>&1

SET_SQL="SELECT string_agg(display_id, ',' ORDER BY display_id) FROM public.pcm_tracking_corrected_email_pending"
BASE=$(q1 "$SET_SQL")
chk "基準(未突變)集合" "WRD222,WRD333,WRD666,WRD999,WRDB22,WRDD44" "$BASE"

# 🔴 **$5/$6 = 第二組取代(選用)** —— 2026-09-05 加。
#    成因:分代那一格的判斷式是 `(SELECT last.sent_tracking_recorded …) IS TRUE`
#    ⇒ 只換掉 SELECT 的欄位, `text IS TRUE` **是型別錯** ⇒ 那一發 SQL **貼不上去**
#    ⇒ 🛑 而 view 停在原樣 ⇒ 集合等於基準 ⇒ 📌 **畫面是「這個突變沒有效果」, 而真相是它從來沒生效。**
#    ⇒ ✅ 所以要能一次換兩處;而**兩處都必須命中**(下面的 assert 對每一組各跑一次)。
mutate () {  # $1=標籤 $2=舊字面 $3=新字面 $4=期望集合(或 ERROR) [$5=舊字面2 $6=新字面2]
  python3 - "$2" "$3" "${5:-}" "${6:-}" "$W-view-real.sql" > "$W-view-mut.sql" <<'PY'
import io,sys
v=io.open(sys.argv[5] if len(sys.argv)>5 else '',encoding='utf-8').read()
old,new=sys.argv[1],sys.argv[2]
old2,new2=sys.argv[3],sys.argv[4]
n=v.count(old)
assert n>=1, f'突變錨【找不到】: {old!r} ⇒ 拒繼續(錨找不到就代表我不知道自己在測什麼)'
# 🔴🔴 **錨不可以只命中【註解】**(2026-09-05 當場踩到, 而本 repo 的 memory 記過同一個形狀:
#    `feedback_comments-read-as-code-by-grep`)。
#    這支檔的註解裡有一行 `⛔ ~~ORDER BY last.sent_seq DESC …~~`(被改掉的舊字面留痕)
#    ⇒ 突變照樣「命中 1 次」、照樣產出一份 SQL、照樣貼得上去 —— **而它一個字都沒改到碼。**
#    ⇒ 📌 那一格的紅看起來像「判準壞了」, 而真相是**我根本沒突變到東西**。
#    ✅ 判別法:命中的行裡至少要有一行**不是註解**(`--` 開頭)。
#    ⚠️ **錨可以跨行**(A 與 D 兩格就是)⇒ 不能用「哪一行含有它」去判,
#      那會把跨行的錨全部誤判成【找不到】(第一版就是這樣, 當場兩格假紅)。
#    ✅ 改成:對每一個命中位置, 看它**橫跨到的那幾行**裡有沒有一行不是註解。
def has_code_hit(text, needle):
    starts = []
    i = text.find(needle)
    while i != -1:
        starts.append(i); i = text.find(needle, i + 1)
    for st in starts:
        en = st + len(needle)
        line_start = text.rfind('\n', 0, st) + 1
        line_end = text.find('\n', en)
        if line_end == -1: line_end = len(text)
        spanned = text[line_start:line_end].split('\n')
        if any(ln.strip() and not ln.lstrip().startswith('--') for ln in spanned):
            return True
    return False
assert has_code_hit(v, old), (f'突變錨只命中【註解】: {old!r} ⇒ 拒繼續 —— '
                   '突變會產出一份看起來正常而【一個字都沒改到】的 SQL')
out = v.replace(old,new)
if old2:
    assert out.count(old2) >= 1, f'第二個突變錨【找不到】: {old2!r} ⇒ 拒繼續'
    assert has_code_hit(out, old2), f'第二個突變錨只命中【註解】: {old2!r} ⇒ 拒繼續'
    out = out.replace(old2,new2)
sys.stdout.write(out)
PY
  if [ ! -s "$W-view-mut.sql" ]; then chk "$1(錨)" "found" "not-found"; return; fi
  psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -v ON_ERROR_STOP=1 -q -f "$W-view-mut.sql" > /dev/null 2>&1
  local got; got=$(q1 "$SET_SQL")
  # 🔴🔴 **2026-09-05 codex R1 must-fix:這裡原本把【任何】錯誤折成同一個 `ERROR`。**
  #    ⛔ ~~case "$got" in *ERROR*) got="ERROR" ;; esac~~
  #    🛑 那讓「連不上 DB」「view 不存在」「打錯字」與**我要證的那個 cast 錯誤**印同一個字
  #      ⇒ 📌 **期望 ERROR 的那一格會在一個壞掉的環境裡【全綠】。**
  #    ✅ 改成只認那一個錯:`invalid input syntax for type uuid`;
  #      其餘錯誤折成 `ERROR-其他` ⇒ 它與期望值不相等 ⇒ **那一格會紅, 並印出真正的訊息。**
  case "$got" in
    *"invalid input syntax for type uuid"*) got="ERROR" ;;
    *ERROR*) got="ERROR-其他:$(printf '%s' "$got" | head -1 | cut -c1-90)" ;;
  esac
  chk "$1" "$4" "$got"
  psql -h /tmp -p "$PORT" -U postgres -d "$RUNDB" -v ON_ERROR_STOP=1 -q -f "$W-view-real.sql" > /dev/null 2>&1
  local back; back=$(q1 "$SET_SQL")
  chk "$1 · 還原" "$BASE" "$back"
}

echo "-- 五格承重點突變(每一格:突變 ⇒ 集合必須【變成預期的樣子】⇒ 還原 ⇒ 必須回到基準)--"

# 🔴 預測寫在跑之前, 逐格附推理 —— 不是抄觀察值。
# A:拿掉綁 order_id ⇒ 一箱兩單共用「最後一封」。SHP888 上兩封 seq 遞增, 後者(WRD999 的)說 A。
#   ⇒ WRD888 的「最後告知」被誤讀成 A ≠ 現在的 B ⇒ 它【多出來】= 誤寄。
mutate "A order 關聯" \
  "             AND last.order_id   = o.id
" "" \
  "WRD222,WRD333,WRD666,WRD888,WRD999,WRDB22,WRDD44"

# B:換回裸 cast ⇒ WRDB22 的 payload 是 'bad' ⇒ PG 不保證求值順序 ⇒ 整張 view 炸掉。
#   🔴 期望是 ERROR 而【不是少一列】—— 那個差別就是本片裁定②的全部。
mutate "B UUID 守門" \
  "public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id" \
  "(last.payload ->> 'shipment_id')::uuid = s.id" \
  "ERROR"

# C:換回用隨機 uuid 決勝 ⇒ WRDC33 兩封 sent_at 相同, 而說 A 那封的 id 是 ffff…
#   ⇒ id DESC 必挑到 A ≠ 現在的 B ⇒ 它【多出來】= 寄一封多餘的更正信。
# 🔴 **2026-09-05 錨換了**:排序主鍵改成 `sent_at`(codex R1 的 rolling deploy 那條)
#   ⇒ 舊錨只剩在**註解的刪除線裡** ⇒ 上面那道「錨不可以只命中註解」就是這一格逼出來的。
mutate "C ORDER BY 單調序號" \
  "ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC" \
  "ORDER BY last.sent_at DESC, last.id DESC" \
  "WRD222,WRD333,WRD666,WRD999,WRDB22,WRDC33,WRDD44"

# D:判斷式改回問號碼 ⇒ WRDD44(片 B 寫的而沒帶號碼)被當成「片 B 之前的舊列」
#   ⇒ 落到時間比較 ⇒ 它寄在更正之後 ⇒ 【不寄】⇒ 它消失 = 裁定③ 靜靜失效。
mutate "D 分代用出處旗標(不是號碼)" \
  "          SELECT last.sent_tracking_recorded
" "          SELECT last.sent_tracking_number
" \
  "WRD222,WRD333,WRD666,WRD999,WRDB22" \
  ") IS TRUE" ") IS NOT NULL"

# 🔴🔴 **E(新, 2026-09-05 codex R2)**:分代改回問 `sent_seq IS NOT NULL`。
#   那是**我自己上一版的寫法**, 而它在【先貼 migration、後上 app】的窗口裡把
#   舊 writer 寫的列(trigger 蓋了 seq、沒號碼)當成片 B 寫的
#   ⇒ WRDF55 會【多出來】= 多寄一封更正信給號碼本來就正確的客人。
#   🔵 而 WRDD44(片 B 寫的、沒帶號碼)在這個突變下仍然在 —— 它有 seq 也有旗標。
mutate "E 分代改回問 seq(部署窗口)" \
  "          SELECT last.sent_tracking_recorded
" "          SELECT last.sent_seq
" \
  "WRD222,WRD333,WRD666,WRD999,WRDB22,WRDD44,WRDF55" \
  ") IS TRUE" ") IS NOT NULL"

printf '\n── 讀數 %s 格:PASS=%s FAIL=%s ──\n' "$((PASSED + FAILED))" "$PASSED" "$FAILED"
if [ "$FAILED" -eq 0 ]; then echo "OK 五格突變全部落在目標上"; else echo "X 有格子紅了"; fi
exit "$FAILED"
