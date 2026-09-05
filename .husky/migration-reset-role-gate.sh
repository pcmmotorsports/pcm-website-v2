#!/bin/sh
# .husky/migration-reset-role-gate.sh —— 薄殼:呼叫 scripts/migration-reset-role-guard.sh
#
# 🔴 **為什麼要這一層薄殼, 而不是在 pre-commit 直接叫 scripts/ 那支**
#    `scripts/state-gates-freshness.harness.sh` 的格9 會【複製一份現行 pre-commit】跑,
#    而它的 stub 是「從那份 pre-commit 自己抽出被引用的 `.husky/*.sh` 全部 stub 掉」(:202-203 逐字)。
#    ⇒ 🛑 **它的抽取射程是 `.husky/*.sh`** —— 我第一版直接寫 `sh scripts/migration-reset-role-guard.sh`,
#       那支【不在射程裡】⇒ 不會被 stub ⇒ 它在 harness 的假樹上數不到 2 支 ⇒ 回 1
#       ⇒ 格9a 期待 0 實得 1 ⇒ **紅的是別人的 harness, 而理由與它要驗的事完全無關。**
#    ⇒ 📌 那份 harness 自己在 :197-201 就記過同一個病(「寫死的 stub 清單與閘數耦合」),
#       而它的修法把射程訂在 `.husky/*.sh` ⇒ **凡是要進 pre-commit 的閘, 都要有一張 .husky 臉。**
#    ⇒ ✅ 所以本檔存在的理由不是包裝, 是【讓那道 stub 抽得到我】。
#
# 🔵 而真正的邏輯留在 scripts/ 那支(它有 --selftest 四個世界), 本檔不重複判斷。
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
if [ ! -f scripts/migration-reset-role-guard.sh ]; then
  printf '%s\n' '🔴 scripts/migration-reset-role-guard.sh 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/migration-reset-role-guard.sh' >&2
  exit 1
fi
exec sh scripts/migration-reset-role-guard.sh
