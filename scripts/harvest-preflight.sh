#!/usr/bin/env bash
# harvest-preflight.sh <branch> — 收割前:印出「共用索引裡 staged、而這次 merge 不該動」的檔。
#
# 為什麼要有它(2026-08-19 實錘,W2 通報):
#   `git merge` 帶走的是【當下共用索引裡的一切】,而做 merge 的窗**看不到那些是誰的**。
#   88804080 那顆 merge 就這樣把 W2 還沒 commit 的 scripts/containment-probe.mjs 一起帶走了 ——
#   對做 merge 的人:成功、四綠過、完全正常;對被帶走的人:code 進了 dev 而 git log 那條路是斷的。
#   🔴 這不是注意力問題,加再多小心都擋不住 —— 那些檔在你的視野裡根本不存在。
#
# 用法:  bash scripts/harvest-preflight.sh <要收的分支>
# 退出碼:0 = 索引乾淨可以 merge / 3 = 有別人的東西,停下來問那個窗 / 2 = 用法錯
#
# 雙向表演(它有沒有判別力,自己跑一次就知道):
#   乾淨的索引            ⇒ 無輸出、rc=0
#   `git add` 一支不相干的檔 ⇒ 印出那個檔名、rc=3
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法: bash scripts/harvest-preflight.sh <branch>" >&2
  exit 2
fi
branch="$1"
git rev-parse --verify --quiet "$branch" >/dev/null || { echo "查無分支: $branch" >&2; exit 2; }

mb=$(git merge-base HEAD "$branch")
staged=$(git diff --cached --name-only | sort -u)
expected=$(git diff --name-only "$mb" "$branch" | sort -u)
# 差集 = staged 裡有、而這次 merge 的改動清單裡沒有 ⇒ 那就是別人的
intruders=$(comm -23 <(printf '%s\n' "$staged") <(printf '%s\n' "$expected") | sed '/^$/d')

if [ -n "$intruders" ]; then
  printf '🔴 共用索引裡有【不屬於這次 merge】的 staged 檔,merge 會把它們一起帶走:\n%s\n' "$intruders" >&2
  printf '⇒ 停下來問那個窗,不要自己判斷要不要帶。\n' >&2
  exit 3
fi

# ── 第二種:工作樹裡有未提交改動,而它【與這次 merge 會動到的檔重疊】 ────────
# 🔴 2026-08-19 補:上面那段只量【索引】,而擋住 merge 的還有另一種 ——
#    別的窗在工作樹裡改了這次 merge 也要動的檔 ⇒ `git merge` 連 stash 都做不到
#    (實錘:`Cannot save the current worktree state / fatal: stash failed`,
#     以及 `error: Entry '<檔>' not uptodate. Cannot merge.`)
#    ⇒ 這兩種是不同的失效:①merge【成功】而帶走別人的東西 ②merge【跑不起來】
#    而本腳本原本只看得到 ①,rc=0 卻仍然 merge 不動 —— 尺比它宣稱的窄。
# 🔴 而 intent-to-add(`git add -N`,porcelain 第二欄是 A)**不論重不重疊都會擋死 merge** ——
#    它在 `git diff --cached` 裡【看不到】(索引條目是空的),所以上面那段量不到它。
#    實錘 2026-08-19:`[ A] apps/admin/.../product-sku-filter.tsx` ⇒
#    `error: Entry '<檔>' not uptodate. Cannot merge.` + `fatal: stash failed`
inta=$(git status --porcelain | sed -n 's/^ A //p' | sort -u)
if [ -n "$inta" ]; then
  printf '🔴 工作樹裡有 intent-to-add(git add -N)的檔,它會【直接擋死】任何 merge:\n%s\n' "$inta" >&2
  printf '⇒ 與這次 merge 重不重疊無關。請那個窗 commit 或 `git reset <檔>`,不要自己動。\n' >&2
  exit 4
fi

dirty=$(git status --porcelain | awk '{ $1=""; sub(/^ +/, ""); print }' | sed 's/.* -> //' | sort -u)
overlap=$(comm -12 <(printf '%s\n' "$dirty") <(printf '%s\n' "$expected") | sed '/^$/d')

if [ -n "$overlap" ]; then
  printf '🔴 工作樹裡有【未提交】的改動,而它們正好是這次 merge 要動的檔:\n%s\n' "$overlap" >&2
  printf '⇒ merge 會直接失敗(stash 也做不到)。請那個窗先 commit(帶 pathspec),不要自己 stash。\n' >&2
  exit 4
fi
exit 0
