#!/usr/bin/env bash
# window-standing-actions.sh — 印出「開窗提示詞必含的常設動作」,給派工的人整段貼。
#
# 🔴 這支存在的理由(2026-08-18):
#   `docs/runbooks/night-run-command-playbook.md:24` 兩個月前就寫著「STOP 即掛哨=施工窗標準動作」,
#   而當天的八段開窗提示詞 `MAIN-012` **一段都沒抄它**
#     grep -c '哨兵\|掛哨\|喚醒\|sleep' ~/pcm-mailbox/MAIN-012-*.md   ⇒ 0
#     正向對照 grep -c '哨兵' docs/runbooks/night-run-command-playbook.md ⇒ 18
#   ⇒ 那個機制在 runbook 裡活著,而**沒有一個窗用它**,因為派工單沒引用它。
#   🔴 **一份寫對的 runbook,擋不住一份沒有引用它的派工單。**
#
# ⇒ 所以修法不是「再寫一次規則」,是**把它變成一條你本來就會跑的指令**:
#      bash scripts/window-standing-actions.sh          # 印出來
#      bash scripts/window-standing-actions.sh | pbcopy # 直接進剪貼簿
#   內容的**唯一來源**是 runbook 裡那兩個標記之間 ⇒ 改 runbook 就是改所有新窗,不會漂。
#
# ⚠️ 這支**不是守門**,它不會擋任何東西 —— 派工的人不跑它,一樣沒有東西紅。
#    它買到的只有「跑了就不會抄漏」。要真的擋,得有人在開窗流程上掛檢查,那還沒有。
set -uo pipefail
cd "$(dirname "$0")/.."
SRC="docs/runbooks/multi-window-command-workflow.md"
[ -f "$SRC" ] || { echo "找不到 $SRC" >&2; exit 2; }

OUT="$(awk '/STANDING-ACTIONS:BEGIN/{f=1;next} /STANDING-ACTIONS:END/{f=0} f' "$SRC")"
if [ -z "$OUT" ]; then
  echo "🔴 抓不到 STANDING-ACTIONS 區塊($SRC)⇒ fail-closed,不要貼一段空的。" >&2
  exit 1
fi
printf '%s\n' "$OUT"
