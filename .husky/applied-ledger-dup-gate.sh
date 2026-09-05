#!/bin/sh
# .husky/applied-ledger-dup-gate.sh —— 薄殼:呼叫 scripts/applied-ledger-dup-gate.py --staged
# 🔴 為什麼要這層薄殼:`scripts/state-gates-freshness.harness.sh` 格9 的 stub 射程是【.husky/*.sh】
#    (該檔 :202-203 逐字)⇒ 直接在 pre-commit 叫 scripts/… 會讓那份 harness 紅, 而理由與它要驗的事無關。
#    📌 凡是要進 pre-commit 的閘, 都要有一張 .husky 臉。(2026-09-05 我踩過一次, 見 migration-reset-role-gate.sh)
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
if [ ! -f scripts/applied-ledger-dup-gate.py ]; then
  printf '%s\n' '🔴 scripts/applied-ledger-dup-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/applied-ledger-dup-gate.py' >&2
  exit 1
fi
exec python3 scripts/applied-ledger-dup-gate.py --staged
