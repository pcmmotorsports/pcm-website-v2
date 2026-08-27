#!/bin/sh
# .husky/zsh-shebang-gate.sh — 殼。真閘在 scripts/zsh-shebang-gate.py。
#
# 🔴 **它守的不是那個坑,是那個坑的【到期條件】。**
#    repo 裡有 55 處 `for X in $VAR`(b4 2026-08-27 量), 它們現在是對的 ——
#    靠的是「179 支腳本沒有一支被 zsh 跑」。
#    ⇒ 有人寫下第一支 `#!/usr/bin/env zsh` 的那一天, 55 處會同時開始只跑一次,
#      **而每一次都印一個乾淨、合理的結論。沒有東西會紅。**
#
# ⚠️ **本閘的天花板寫在 .py 的檔頭「══ 天花板 ══」那節** —— 最重要的一條先講:
#    🔴 **它只擋 shebang, 擋不住 `zsh <script>` / `source` / `SHELL=zsh` 的 runner。**
#    而真正的病灶(人打進互動 zsh 的一次性指令)**沒有載體 ⇒ 掃不到, 連事後都查不到。**
#    ⇒ **本閘綠, 不代表沒有腳本在 zsh 下跑。**
#
# fail-closed:.py 不見了 ⇒ rc=2 擋下。刪掉那支 .py 正是關掉本閘最省事的方法。
set -u
if [ ! -f scripts/zsh-shebang-gate.py ]; then
  printf '%s\n' '🔴 scripts/zsh-shebang-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/zsh-shebang-gate.py' >&2
  exit 2
fi
python3 scripts/zsh-shebang-gate.py
exit $?
