#!/bin/sh
# .husky/board-token-gate.sh — 殼。真尺在 scripts/board-token-normalize.py --check-staged。
#
# 守什麼:`docs/launch-todo.md` 的擋上線 token
#   ① 最後一格開頭沒有 token 而行內找得到(合併推歪 ⇒ 計數器把它讀成「未填」⇒ **擋數低報**)
#   ② 態 `done` 而 token 仍 ⟨擋⟩(**做完了而看起來沒做完** ⇒ 那是「派重了」的燃料)
#
# 🟡 **warn-only:rc 恆 0, 不擋 commit。** 擋不擋等三天的分母出來再拍(Sean 未拍;主視窗 2026-09-07 04:0x 裁)。
#   ⚠️ ⇒ **它印了東西不代表 commit 被擋;它安靜也不代表板子乾淨** —— 它只看這顆 commit staged 的那份。
#
# 🔴 **殼刻意什麼都不做**(照 `md-table-overflow-gate.sh` 的家規, 那支前兩版都因為殼裡做事被判 FAIL):
#   清單、git 的 rc、掃描全部在**同一個程序、同一個 rc 的射程**裡。
#   ⇒ 這裡**不列檔、不接管線、不用 xargs**(管線的 rc 是最後一段的;xargs 會把子程序 rc 壓成 1)。
#
# 🛑 **讀的是 staged 那份, 不是工作樹** —— 2026-09-06 一夜有兩道閘踩過這一格。
#   工作樹已修而 staged 沒修 ⇒ 印綠而進 commit 的是壞的;反過來則罵一個沒問題的 commit。
#
# ⚠️ 它不是每種 commit 都會跑:官方契約只保證 `git commit` 觸發 ⇒ 乾淨的 merge / rebase /
#   cherry-pick 多半不經 pre-commit。⇒ **本閘安靜 ≠ 這個 repo 沒有那兩種病。**

if [ ! -f scripts/board-token-normalize.py ]; then
  printf '%s\n' '🟡 board-token 閘:scripts/board-token-normalize.py 不見了 ⇒ **本閘沒有看過任何東西**' >&2
  printf '%s\n' '   (warn-only ⇒ 仍放行;要它真的守就先把那支檔找回來)' >&2
  exit 0
fi
# 🔴 codex 2026-09-07 must-fix ①:`|| true` 不是裝飾。
#   若呼叫端已匯出 `SHELLOPTS=errexit`(或 husky 用 `sh -e` 跑本檔),
#   python 只要 raise, **內層會在走到 `exit 0` 之前就中止 ⇒ 整顆 commit 被擋。**
#   🛑 而本閘的契約逐字是「rc 恆 0、不擋 commit」⇒ **那會直接違約。**
#   ⇒ 把它接起來, 讓 python 的任何非 0 都在這一行被吃掉。
python3 scripts/board-token-normalize.py --check-staged || true
exit 0
