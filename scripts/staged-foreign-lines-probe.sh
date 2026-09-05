#!/bin/sh
# staged-foreign-lines-probe.sh — 「我這一顆 commit 會不會夾到別人的行」
#
# 板列 ⟦b9-STATBLIND⟧(2026-09-05 · 線【身分】`-auth` 做, 主視窗 `-f8` 派)。
#
# ══ 它要取代的那把尺 ═══════════════════════════════════════════════
# 每片 commit 後都在跑 `git show HEAD --stat` 數「非我的檔數」——
# 🔴 **而它比對的是【檔名】, 汙染卻發生在【檔案內部】** ⇒ 同一支檔被兩個人動過時,
#    「該過」與「該擋」兩個世界**印同一個答案**(`-1c` 2026-08-30 兩個世界實測:檔數 1 / 非我的 0, 兩邊一樣)。
#
# ══ 🔴🔴 先講【它答不出什麼】—— 因為那決定了它能答什麼 ════════════════
#   ① **index 裡已經混進來的別人的行, git 分不出作者** —— 未 commit 的行沒有 blame。
#      ⇒ 📌 **這一支【不宣稱】它看得到那一種。**
#   ② **HEAD 上別人推進你分支的 commit, 也分不出** —— 全窗共用 git 身分
#      (當場量:近三顆 author 全是 `probe <probe@local>`, **一個身分**)。
#      ⇒ 那是本 repo 已記過的事實, 不是本支的疏漏。
#   ⇒ 🎯 **所以本支只做【它做得到】的那一種:兩個【時間差】的世界。**
#
# ══ 它做得到的兩發(各自帶正負對照, 見 --selftest)════════════════════
#   A. **同一棵樹**:某支 staged 的檔, 工作樹版本**已經與 index 不同**
#      ⇒ 有人(或另一個窗)在你 `git add` 之後又動了它 ⇒ 你要 commit 的不是你看過的那一份。
#   B. **跨工作樹**:同一支路徑在**別棵 worktree** 裡是 dirty 的
#      ⇒ 另一條線正在改同一支檔 ⇒ 本 repo 的 git 紀律逐字:「**停下來協調, 等對方先 commit**」。
#
# 離場碼:0 沒訊號 / 1 有訊號(A 或 B)/ 2 工具層壞了(git 讀不到 ⇒ fail-closed)
set -u

if [ "${1:-}" = "--selftest" ]; then
  # 🔴 selftest 第一件事:剝掉繼承來的 git 環境(自檢清單那一格;`git -C` 擋不住它)
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE 2>/dev/null || true
  D=$(mktemp -d) || exit 2
  fails=0 ; ran=0
  chk() { # chk <名稱> <期望rc> <實得rc>
    ran=$((ran+1))
    if [ "$2" = "$3" ]; then printf '  PASS  %s\n' "$1"
    else fails=$((fails+1)); printf '  🔴 FAIL  %s  期望 rc=%s 實得 %s\n' "$1" "$2" "$3"; fi
  }
  git init -q "$D" 2>/dev/null || exit 2
  ( cd "$D" && git config user.email t@t && git config user.name t \
    && printf 'a\n' > shared.md && git add shared.md \
    && git -c core.hooksPath= commit -qm base ) || exit 2

  # 🔵 負對照 1:只有我改, add 完沒有人動 ⇒ 沒訊號
  ( cd "$D" && printf 'a\nmine\n' > shared.md && git add shared.md ) || exit 2
  ( cd "$D" && sh "$OLDPWD/scripts/staged-foreign-lines-probe.sh" >/dev/null 2>&1 ) ; chk '🔵 負對照:add 之後沒有人動 ⇒ 沒訊號' 0 $?

  # 🔴 正對照 A:add 之後【別人在同一支檔追加】⇒ 要有訊號
  ( cd "$D" && printf 'a\nmine\nZZOTHER\n' > shared.md ) || exit 2
  ( cd "$D" && sh "$OLDPWD/scripts/staged-foreign-lines-probe.sh" >/dev/null 2>&1 ) ; chk '🔴 正對照A:add 之後別人在同一支檔追加 ⇒ 有訊號' 1 $?

  # 🔵 負對照 2:別人動的是【另一支檔】⇒ 那不是本支要抓的(它只看 staged 的那幾支)
  ( cd "$D" && git checkout -- shared.md 2>/dev/null; printf 'x\n' > other.md ) || exit 2
  ( cd "$D" && sh "$OLDPWD/scripts/staged-foreign-lines-probe.sh" >/dev/null 2>&1 ) ; chk '🔵 負對照:別人動的是另一支檔 ⇒ 沒訊號' 0 $?

  # 🔵 負對照 3:零 staged ⇒ 不適用, 不得叫
  ( cd "$D" && git reset -q ) || exit 2
  ( cd "$D" && sh "$OLDPWD/scripts/staged-foreign-lines-probe.sh" >/dev/null 2>&1 ) ; chk '🔵 負對照:零 staged ⇒ 不適用' 0 $?

  # 🔴 工具層:不在 git repo 裡 ⇒ fail-closed rc=2
  E=$(mktemp -d) || exit 2
  ( cd "$E" && sh "$OLDPWD/scripts/staged-foreign-lines-probe.sh" >/dev/null 2>&1 ) ; chk '🔴 工具層:不在 repo 裡 ⇒ rc=2 fail-closed' 2 $?
  rm -rf "$D" "$E"
  printf -- '── staged-foreign-lines-probe selftest: %s PASS / %s FAIL\n' "$((ran-fails))" "$fails"
  [ "$fails" -eq 0 ] || exit 1
  exit 0
fi

git rev-parse --git-dir > /dev/null 2>&1 || {
  printf '%s\n' '🔴 不在 git repo 裡 ⇒ 本探針【沒有跑】⇒ fail-closed' >&2 ; exit 2 ; }

STAGED=$(git diff --cached --name-only 2>/dev/null) || {
  printf '%s\n' '🔴 git diff --cached 讀不到 ⇒ 本探針【沒有跑】⇒ fail-closed' >&2 ; exit 2 ; }
[ -n "$STAGED" ] || { printf '%s\n' '── staged-foreign-lines-probe:零 staged ⇒ 不適用' ; exit 0 ; }

HIT=0
# ── A:staged 的檔, 工作樹是不是已經跟 index 不一樣了 ──────────────
A=$(git diff --name-only -- $STAGED 2>/dev/null)
if [ -n "$A" ]; then
  HIT=1
  printf '%s\n' '🔴 A:下面這幾支【已經 staged, 而工作樹又被動過】——' >&2
  printf '%s\n' "$A" | sed 's/^/     /' >&2
  printf '%s\n' '   ⇒ 你要 commit 的不是你最後看過的那一份。先 `git diff <檔>` 逐行看。' >&2
fi

# ── B:同一支路徑在【別棵 worktree】裡 dirty ────────────────────
SELF=$(git rev-parse --show-toplevel 2>/dev/null)
git worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | while IFS= read -r WT; do
  [ "$WT" = "$SELF" ] && continue
  [ -d "$WT" ] || continue
  OUT=$(git -C "$WT" status --porcelain -- $STAGED 2>/dev/null)
  [ -n "$OUT" ] && {
    printf '%s\n' "🔴 B:同一支路徑在別棵樹裡是 dirty 的 —— $WT" >&2
    printf '%s\n' "$OUT" | sed 's/^/     /' >&2
    printf '%s\n' '   ⇒ git 紀律逐字:【停下來協調, 等對方先 commit】。' >&2
    printf '%s\n' 'B-HIT' > "${TMPDIR:-/tmp}/.sflp_b_$$"
  }
done
[ -f "${TMPDIR:-/tmp}/.sflp_b_$$" ] && { HIT=1 ; rm -f "${TMPDIR:-/tmp}/.sflp_b_$$" ; }

if [ "$HIT" -eq 1 ]; then exit 1 ; fi
printf '%s\n' '   ⚪ staged-foreign-lines-probe:A 與 B 都沒有訊號'
printf '%s\n' '   🛑 而它【證不到】index 裡有沒有別人的行(未 commit 的行沒有 blame)'
exit 0
