#!/usr/bin/env bash
#
# D1a4/D1a5 還原執行器。
#
# 🔴 **不要直接跑 d1-restore.ts | psql。** 那條路少了三道只有這裡做得到的檢查:
#   ①連線目標 —— 交易內的 system_identifier 擋不掉實體快照 clone(會保留同一個識別碼),
#     而 psql 端的 SQL 看不到自己連去哪。
#   ②備份檔身分與完整性 —— 腳本內的 EXCEPT ALL 是拿載入的暫存表跟由它插入的資料互比,
#     **自我比對、恆真**;指錯備份目錄照樣全綠。
#   ③TLS —— libpq 沒給 sslmode 時預設 `prefer`,等於完全不驗憑證。
#
# 用法:
#   export D1_DB_URL='...'          # 🔴 從環境變數走,不放命令列(ps 看得到、裡面有密碼)
#   export D1_OPERATOR='你的名字'   # 🔴 必填。寫進稽核的 after 欄;自填的線索、不是憑據
#   scripts/d1-restore.sh pre|post production|rehearsal <備份解壓目錄>
set -euo pipefail

MODE="${1:?用法: d1-restore.sh pre|post production|rehearsal <備份解壓目錄>}"
TARGET="${2:?缺 target}"
DIR="${3:?缺備份目錄}"
: "${D1_DB_URL:?缺 D1_DB_URL 環境變數}"
# 🔴 Sean 2026-08-29 拍甲:操作人姓名必填,而它在【任何破壞性動作之前】就停
#    (對稱於上面那個 D1_DB_URL —— 形狀已存在,錯誤訊息會自己講)。
# ⚠️ **它是操作者自己打的字 —— 線索不是憑據,填假的填得出來。**
#    偽造不了的那一格是 DB 記的 session_user,而 guard 強制它是 postgres
#    ⇒ 那一欄對每一筆都一樣 ⇒ 這一欄是唯一區分得出「這次是誰」的東西。
#    (Sean 是在【知道它可以被填假的】之下選這條的。)
: "${D1_OPERATOR:?缺 D1_OPERATOR:請設成這次實際操作的人的名字,例 export D1_OPERATOR=\'你的名字\'}"

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== 1/6 preflight:連線目標 + 十五份 CSV 在場 + cohort 範圍 + 來源叢集 =="
npx tsx scripts/d1-restore.ts --preflight "$TARGET" "$DIR"

echo "== 2/6 校驗碼:每一份 CSV 逐檔比對 =="
# 🔴 一定要 cd 進備份目錄再驗 —— checksums.txt 記的是相對檔名(D1a2 就是這樣產的)。
#    在外面驗會找不到檔,或更糟:找到同名的**別包**檔案。
( cd "$DIR" && shasum -a 256 -c checksums.txt )

# 🔴🔴 ⟦b4-RESTORE2⟧ G1:上面那一發【驗了】而【沒有留痕】——
#    備份保存 180 天、同一個 cohort 會有很多包 ⇒ 事後查不出「那一次還原吃的是哪一包」。
#    ⇒ 把 checksums.txt 自己的 sha256 交給留痕(形狀照 d1_mode:值由 wrapper 給、不是產生器內插)。
# 🛑 **它不是防偽章** —— 操作者餵得出一包自洽的假備份。它答的是「哪一包」, 不是「這包對不對」。
SRC_SHA="$(shasum -a 256 "$DIR/checksums.txt" | awk '{print $1}')"
test -n "$SRC_SHA"
echo "   來源 checksums.txt sha256 = $SRC_SHA"

# 🔴🔴 ⟦b4-RESTORE2⟧ G3:留痕的 request_id 由【這裡】產, 不由 DB 產。
#    留痕跑在 COMMIT 之後(R3 2026-08-29 對抗審查的決定, 不重開)
#    ⇒ 還原成功而留痕失敗 = 一次沒有紀錄的正式庫還原, 而原本靠「請手動記錄」。
#    ⇒ id 先產在外面 ⇒ 第 6 步 wrapper 自己回頭查它在不在 ⇒ 把「請人記得」換成「機器會叫」。
# 🔵 不用 uuidgen:不假設非 macOS CLI 已裝。bash 的 $RANDOM 夠了(它是 correlation id, 不是密鑰)。
REQ_ID="d1restore-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}"
echo "   本次留痕 request_id = $REQ_ID"

echo "== 3/6 取出 CA(讓 psql 也能 verify-full)=="
npx tsx scripts/d1-restore.ts --write-ca "$WORK/supabase-ca.pem"

echo "== 4/6 產生還原 SQL =="
npx tsx scripts/d1-restore.ts "$MODE" "$TARGET" "$DIR" > "$WORK/restore.sql"
test -s "$WORK/restore.sql"

PSQL_RC=0
echo "== 5/6 執行(單一交易,任一 assert 不成立即整批 ROLLBACK)=="
# 🔴 連線字串走 PGDATABASE 不走 argv:libpq 的 dbname 若是 URI 會自行展開,
#    而 argv 裡的密碼在整段 psql 執行期間都看得到(ps)。
# 🔴 verify-full:preflight 已擋掉 URL 帶 sslmode,所以這裡設的值不會被覆蓋。
# 🔴 `-v d1_mode=` 把【wrapper 選的那一版】交給留痕 —— 而它與 SQL 裡查出來的
#    `sample_display_id`(資料上實際發生什麼)是【兩個不同的來源】⇒ 那才叫交叉核對。
#    ⚠️ 缺這個變數 ⇒ psql 語法錯 ⇒ rc=3(實測);它不會安靜變成空字串。
PGDATABASE="$D1_DB_URL" \
PGSSLMODE=verify-full \
PGSSLROOTCERT="$WORK/supabase-ca.pem" \
  psql -v d1_mode="$MODE" -v d1_src_sha="$SRC_SHA" -v d1_request_id="$REQ_ID" -f "$WORK/restore.sql" \
  || PSQL_RC=$?

echo "== 6/6 留痕回核:那一筆 admin_audit_log 真的在嗎 =="
# 🔴🔴 ⟦b4-RESTORE2⟧ G3(code-reviewer 2026-09-06 must-fix 修過一輪)。
#    ⛔ ~~原本第 5 步是裸跑~~ ⇒ `set -e` 之下 psql 一失敗**腳本當場結束**
#      ⇒ 🛑 **這一步在它唯一要接的那個世界裡, 一行都不會跑** —— 操作者只看到一句原始
#         psql ERROR, 而那句話的自然讀法是「還原失敗」⇒ 他會想重跑。
#      ⇒ 📌 **一道只在「沒事」的時候才執行的安全網, 接近恆真。**
#    ✅ 改成 `|| PSQL_RC=$?` 收下 rc ⇒ **這一步無條件跑**, 而 rc 留到最後才決定退出碼。
#
# 🔵 這一步不是重複勞動:第 5 步的 rc 答的是「psql 整份跑完沒報錯」,
#    而留痕是【COMMIT 之後】的獨立交易 ⇒ 它失敗的時候, 還原已經完成而資料在。
# 🔵 用新的一發連線去查 ⇒ 與寫它的那個交易不同源(同一個交易裡查自己恆真)。
# 🔴 `set -e` 之下 `VAR=$(cmd)` 失敗會【當場結束腳本】⇒ 包進 `if !`, rc 才進得來。
#    ⚠️ 訂正一句我原本寫錯的話:**吞掉 rc 的是 `local X=$(cmd)`, 不是裸的 `X=$(cmd)`**
#       (裸賦值會保留 rc)。這裡用 `if !` 的理由是 `set -e`, 不是 rc 被吞。
AUDIT_CNT=""
if ! AUDIT_CNT="$(PGDATABASE="$D1_DB_URL" PGSSLMODE=verify-full PGSSLROOTCERT="$WORK/supabase-ca.pem" \
  psql -At -c "SELECT count(*) FROM public.admin_audit_log WHERE request_id = '$REQ_ID' AND action = 'ops.d1.restore'")"; then
  echo "🔴🔴 留痕回核【查不到答案】(查詢本身失敗)—— 這【不是】「留痕不在」, 是我問不到。" >&2
  echo "     還原本身的結果看第 5 步(psql rc=$PSQL_RC)。請手動確認 request_id = $REQ_ID 那一筆。" >&2
  exit 1
fi

if [ "$AUDIT_CNT" = "1" ]; then
  echo "   ✅ 留痕在(1 筆)。request_id = $REQ_ID"
elif [ "$PSQL_RC" -ne 0 ]; then
  # 🔵 **這一格與下一格【不可以合併】** —— 它們要人做的事相反。
  #    psql 失敗而留痕不在 ⇒ 最可能是整批 ROLLBACK(那是安全的、什麼都沒改),
  #    而也可能是「還原 COMMIT 了、留痕那一段掛了」⇒ **兩者要先分辨, 不能直接重跑。**
  echo "🔴 第 5 步 psql 失敗(rc=$PSQL_RC), 而留痕也不在(查到 $AUDIT_CNT 筆)。" >&2
  echo "   ⇒ 兩種可能, 而它們要做的事相反:" >&2
  echo "     ① 整批 ROLLBACK ⇒ 什麼都沒改, 排掉原因後可以重跑" >&2
  echo "     ② 還原已 COMMIT 而留痕那一段掛了 ⇒ 資料在, **不可以重跑**, 要手動補記" >&2
  echo "   🛑 **先分辨再動**:npx tsx scripts/d1-restore.ts --verify-restored(它問的是那 26 張在不在)。" >&2
  echo "   手動補記要附:request_id = $REQ_ID / 來源 sha256 = $SRC_SHA / 操作者 = $D1_OPERATOR / mode = $MODE" >&2
  exit "$PSQL_RC"
else
  echo "🔴🔴 psql 成功, 而留痕【不在】(查到 $AUDIT_CNT 筆, 應為 1)。" >&2
  echo "     ⇒ 還原【已經 COMMIT 完成, 資料在】⇒ **這是一次沒有紀錄的正式庫還原。**" >&2
  echo "     請立刻手動補記, 並附:" >&2
  echo "        request_id = $REQ_ID / 來源 sha256 = $SRC_SHA / 操作者 = $D1_OPERATOR / mode = $MODE" >&2
  echo "     🛑 不要重跑還原 —— 資料已經在了。" >&2
  exit 1
fi

# 🔴 第 5 步失敗而留痕【在】的世界:上面那三格都走不到這裡以外的路 ⇒ 退出碼要照實反映 psql。
if [ "$PSQL_RC" -ne 0 ]; then
  echo "🔴 留痕在, 而第 5 步 psql 仍以 rc=$PSQL_RC 結束 ⇒ 照實回報失敗, 不要因為留痕在就當成功。" >&2
  exit "$PSQL_RC"
fi
