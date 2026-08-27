#!/usr/bin/env bash
#
# D1a6/D1a7 還原演練 —— 一鍵版。
#
# 這支做的事:解密備份 → 補帳號替身 → 走**正式那支** wrapper 還原 → 新連線重數驗收。
# 中間任何一步失敗就整條停,不會留下「跑了一半但看起來成功」的狀態。
#
# 🔴 只對演練庫跑。`preflight` 會拒絕指向 production 專案的連線字串,
#    腳本內的守門也會在連到 production 叢集時當場中止 —— 兩道,方向相反。
#
# 用法:
#   export D1_DB_URL='演練分支的連線字串'     # 🔴 不放命令列(ps 看得到)
#   scripts/d1-rehearsal.sh [加密備份路徑]
set -euo pipefail

ARCHIVE="${1:-$HOME/d1-backup-20260729-v2.tar.gz.age}"
: "${D1_DB_URL:?缺 D1_DB_URL(演練分支的連線字串)}"
test -f "$ARCHIVE" || { echo "找不到備份檔:$ARCHIVE" >&2; exit 1; }

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
chmod 700 "$WORK"
# 明文備份只活在這個資料夾裡,腳本結束(含中途失敗)一定刪掉。
trap 'rm -rf "$WORK"' EXIT

echo "== 1/4 解密備份(接下來會問你 age 密碼)=="
age -d -o "$WORK/backup.tar.gz" "$ARCHIVE"
tar xzf "$WORK/backup.tar.gz" -C "$WORK"
DIR="$(find "$WORK" -maxdepth 1 -type d -name 'd1-backup-*' | head -1)"
test -n "$DIR" || { echo "解開後找不到備份資料夾" >&2; exit 1; }
echo "解出 $(find "$DIR" -name '*.csv' | wc -l | tr -d ' ') 份 CSV"

npx tsx scripts/d1-restore.ts --write-ca "$WORK/ca.pem"
run_sql() {
  PGDATABASE="$D1_DB_URL" PGSSLMODE=verify-full PGSSLROOTCERT="$WORK/ca.pem" psql -f "$1"
}

echo "== 2/4 補 auth.users 替身(只塞 id、零個資)=="
# auth.users 刻意不備份(Sean 拍板 Q3=A,含密碼雜湊)⇒ 全新分支的帳號表是空的,
# 而 customers.user_id → auth.users 是 FK,不補連第一張父表都插不進去。
npx tsx scripts/d1-restore.ts --seed-rehearsal "$DIR" > "$WORK/seed.sql"
test -s "$WORK/seed.sql"
run_sql "$WORK/seed.sql"

echo "== 3/4 還原(走的就是災難當天要用的那支 wrapper)=="
scripts/d1-restore.sh pre rehearsal "$DIR"

echo "== 4/4 新連線重數驗收 =="
# 🔴 與腳本內的驗證不同:那些跑在同一筆交易裡、證明「這筆交易看得到」;
#    這一段跑在交易結束之後,證明「真的 COMMIT 了」。前者對 rollback 沒有感覺。
npx tsx scripts/d1-restore.ts --verify-restored > "$WORK/verify.sql"
test -s "$WORK/verify.sql"
run_sql "$WORK/verify.sql"

echo
echo "🎉 演練通過:備份解得開、塞得回去、COMMIT 後重數十五張表全部相符。"
