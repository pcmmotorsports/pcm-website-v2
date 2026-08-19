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
exit 0
