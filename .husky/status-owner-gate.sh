#!/bin/sh
# STATUS 收帳權守門 — 子窗(worktree)不得直接寫 STATUS.md
#
# 為什麼有這支(2026-08-15 立):
#   memory `feedback_subwindow-must-not-write-status-directly` 從 08-08 就寫著這條
#   (那天撞過真 merge conflict),而它一直只是【紀律】——
#   靠每個施工窗自己記得、自己去查證。
#
#   🔴 2026-08-15 主視窗自己發了一封錯誤指令,逐字要三個子窗「STATUS 7 欄同 commit」
#      (成因:照抄 CLAUDE.md 的單 session slice 收工清單,那條的情境不是多窗)。
#      三個窗全部自己查證擋下來了 —— 而 C 窗當場指出:
#        「三次都是靠子窗自己查證擋住的,不是靠指令正確。
#          那代表這道防線目前完全依賴每個窗都願意多查一次。那不是機制,是紀律。」
#
#   ⇒ 照 `~/.claude/rules/00-work-rules.md` §4 機制優先律:做成機制,不再寫第四遍規則文字。
#
# 判別(不寫死路徑):
#   主樹    git-dir == git-common-dir
#   worktree git-dir = <common>/worktrees/<name>  ⇒ 兩者不等
#
# 逃生門:真的要在 worktree 動 STATUS(例如主視窗臨時在別的樹上收帳)⇒
#   PCM_ALLOW_STATUS_IN_WORKTREE=1 git commit ...
#   ⚠️ 用了要在 commit body 寫為什麼 —— 這支擋的是「順手寫下去」,不是擋所有可能。

set -e

GIT_DIR=$(git rev-parse --absolute-git-dir)
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir)

# 主樹 ⇒ 放行(收帳權就在這裡)
[ "$GIT_DIR" = "$COMMON_DIR" ] && exit 0

# 這裡起 = worktree
[ "${PCM_ALLOW_STATUS_IN_WORKTREE:-}" = "1" ] && {
  echo "⚠ STATUS 守門被 PCM_ALLOW_STATUS_IN_WORKTREE=1 略過 —— 請在 commit body 寫明理由" >&2
  exit 0
}

HITS=$(git diff --cached --name-only | grep -c '^STATUS\.md$' || true)
[ "$HITS" = "0" ] && exit 0

cat >&2 <<'MSG'

🔴 擋下:子窗(worktree)不得直接寫 STATUS.md

  收帳權集中主視窗;子窗只在 STOP 信裡給 7 欄素材,由主視窗收割。
  出處:memory `feedback_subwindow-must-not-write-status-directly`
        (2026-08-08 撞過真 merge conflict)

  ⚠️ 就算是主視窗叫你寫的也一樣 —— 2026-08-15 主視窗真的發過那封錯誤指令。

  怎麼辦:
    git restore --staged STATUS.md
    然後把 7 欄素材寫進你的 STOP 信

  真的必要(你就是主視窗、只是人在別的樹上):
    PCM_ALLOW_STATUS_IN_WORKTREE=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
