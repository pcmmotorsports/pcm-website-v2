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
#   scripts/d1-restore.sh pre|post production|rehearsal <備份解壓目錄>
set -euo pipefail

MODE="${1:?用法: d1-restore.sh pre|post production|rehearsal <備份解壓目錄>}"
TARGET="${2:?缺 target}"
DIR="${3:?缺備份目錄}"
: "${D1_DB_URL:?缺 D1_DB_URL 環境變數}"

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== 1/5 preflight:連線目標 + 十五份 CSV 在場 + cohort 範圍 + 來源叢集 =="
npx tsx scripts/d1-restore.ts --preflight "$TARGET" "$DIR"

echo "== 2/5 校驗碼:每一份 CSV 逐檔比對 =="
# 🔴 一定要 cd 進備份目錄再驗 —— checksums.txt 記的是相對檔名(D1a2 就是這樣產的)。
#    在外面驗會找不到檔,或更糟:找到同名的**別包**檔案。
( cd "$DIR" && shasum -a 256 -c checksums.txt )

echo "== 3/5 取出 CA(讓 psql 也能 verify-full)=="
npx tsx scripts/d1-restore.ts --write-ca "$WORK/supabase-ca.pem"

echo "== 4/5 產生還原 SQL =="
npx tsx scripts/d1-restore.ts "$MODE" "$TARGET" "$DIR" > "$WORK/restore.sql"
test -s "$WORK/restore.sql"

echo "== 5/5 執行(單一交易,任一 assert 不成立即整批 ROLLBACK)=="
# 🔴 連線字串走 PGDATABASE 不走 argv:libpq 的 dbname 若是 URI 會自行展開,
#    而 argv 裡的密碼在整段 psql 執行期間都看得到(ps)。
# 🔴 verify-full:preflight 已擋掉 URL 帶 sslmode,所以這裡設的值不會被覆蓋。
PGDATABASE="$D1_DB_URL" \
PGSSLMODE=verify-full \
PGSSLROOTCERT="$WORK/supabase-ca.pem" \
  psql -f "$WORK/restore.sql"
