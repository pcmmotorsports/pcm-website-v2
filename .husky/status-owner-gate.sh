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

# ── merge 繼承放行(2026-08-16 立;兩個窗各撞一次都自己繞過)──────────────
#
# 病症:子窗 `git merge dev` 會把 STATUS.md 帶進 index ⇒ 本守門觸發。
#      而【原本的錯誤訊息建議 `git restore --staged STATUS.md`】——
#      在 merge 中途那麼做會退回舊版 ⇒ **用一顆 merge 把主視窗的收帳行洗掉**。
#      A 窗逐字:「那比觸發 hook 嚴重得多。」
#      ⇒ 守門要擋的是【作者寫了內容】,而它擋到的是【merge 繼承】,兩者在 index 上長得一樣。
#
# 判別(兩條【同時】成立才放行,刻意保守):
#   ① index 裡那顆 STATUS blob == 來源方(MERGE_HEAD)那顆   ⇒ 我採用的是對方的版本
#   ② 我這側自分岔點以來【沒有動過】STATUS                  ⇒ 我沒有作者任何內容
#   只有 ① 會漏掉「作者改成跟對方一樣」;只有 ② 會漏掉「merge 中途又手改」。
if [ -f "$GIT_DIR/MERGE_HEAD" ]; then
  STAGED=$(git rev-parse --quiet --verify ':STATUS.md'          2>/dev/null || true)
  THEIRS=$(git rev-parse --quiet --verify 'MERGE_HEAD:STATUS.md' 2>/dev/null || true)
  BASE=$(git merge-base HEAD MERGE_HEAD 2>/dev/null || true)
  MINE=$(git rev-parse --quiet --verify 'HEAD:STATUS.md'         2>/dev/null || true)
  BASEV=$(git rev-parse --quiet --verify "$BASE:STATUS.md"       2>/dev/null || true)
  if [ -n "$STAGED" ] && [ -n "$THEIRS" ] && [ -n "$MINE" ] && [ -n "$BASEV" ] \
     && [ "$STAGED" = "$THEIRS" ] && [ "$MINE" = "$BASEV" ]; then
    echo "✓ STATUS.md 是 merge 繼承(index==MERGE_HEAD 且本分支自分岔未動過)⇒ 放行" >&2
    exit 0
  fi
fi

cat >&2 <<'MSG'

🔴 擋下:子窗(worktree)不得直接寫 STATUS.md

  收帳權集中主視窗;子窗只在 STOP 信裡給 7 欄素材,由主視窗收割。
  出處:memory `feedback_subwindow-must-not-write-status-directly`
        (2026-08-08 撞過真 merge conflict)

  ⚠️ 就算是主視窗叫你寫的也一樣 —— 2026-08-15 主視窗真的發過那封錯誤指令。

  🔴🔴 你正在 merge 中途嗎?**那就不要 unstage。**
     本守門已經會自動放行「純 merge 繼承」(index 與 MERGE_HEAD 同一顆 blob、
     且你這側自分岔以來沒動過 STATUS)。**你現在被擋,代表那兩條至少有一條不成立**
     —— 也就是說 index 裡的 STATUS **不是**單純從 dev 繼承來的。
     ⇒ 先查清楚是誰改的,**不要 `git restore --staged`**:
        在 merge 中途 unstage 會把 STATUS 退回舊版,
        **等於用你這顆 merge 把主視窗的收帳行洗掉**(那比被 hook 擋嚴重得多)。
     自查兩行:
        git rev-parse :STATUS.md MERGE_HEAD:STATUS.md      # 不同 ⇒ 內容不是對方那版
        git diff $(git merge-base HEAD MERGE_HEAD) HEAD -- STATUS.md | wc -l   # 非 0 ⇒ 你這側動過

  不在 merge 中途(就是你自己改了 STATUS):
    把那些改動移出這次 commit(例如 git restore --staged STATUS.md),
    然後把 7 欄素材寫進你的 STOP 信,由主視窗收帳。

  真的必要(你就是主視窗、只是人在別的樹上):
    PCM_ALLOW_STATUS_IN_WORKTREE=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
