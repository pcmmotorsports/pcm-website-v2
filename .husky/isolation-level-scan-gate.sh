#!/bin/sh
# .husky/isolation-level-scan-gate.sh —— 薄殼:呼叫 scripts/isolation-level-scan-gate.py
# 🔴 為什麼要這層薄殼:`scripts/state-gates-freshness.harness.sh` 格9 的 stub 射程是【.husky/*.sh】
#    ⇒ 直接在 pre-commit 叫 scripts/… 會讓那份 harness 紅, 而理由與它要驗的事無關。
#    📌 凡是要進 pre-commit 的閘, 都要有一張 .husky 臉。
# ⚠️ 本閘掃【全樹】不掃 staged —— 刻意的。
#    它釘的是 ⟦b4-NCPCRONRACE⟧ 判決的前提, 而那個前提被誰弄壞都一樣壞,
#    不會因為「不是我 staged 的」就比較不壞。
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
if [ ! -f scripts/isolation-level-scan-gate.py ]; then
  printf '%s\n' '🔴 scripts/isolation-level-scan-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/isolation-level-scan-gate.py' >&2
  exit 1
fi
exec python3 scripts/isolation-level-scan-gate.py
