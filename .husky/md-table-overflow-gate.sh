#!/bin/sh
# .husky/md-table-overflow-gate.sh — 殼。真尺在 scripts/md-table-overflow.py。
#
# 守什麼:markdown 表格裡「這一列的格數超過表頭欄數」的行。
#   GFM 規格逐字:多出來的格【在渲染時被丟掉】。
#   🔴 而檔案裡那些字一個都沒少 ⇒ `grep` / `cat` 讀得到 ⇒ **這個病只在渲染那一層成立,
#      而寫的人從來不那樣讀它。**(2026-08-31 一夜四次同款,四次全部由工具抓到、人 0 次。)
#
# 🛑 **這支殼刻意寫得【什麼都不做】—— 那是第三版, 前兩版都被 codex 判 FAIL:**
#   第一版:掛成 lint-staged 的一條規則
#     ⇒ ① `refs/stash` 四棵 worktree 共用, 而 lint-staged 用會漂移的 stash 序號分兩步
#          apply/drop ⇒ 八窗並行可能誤擋、拿錯、**刪掉別人的備份**
#       ② 子工具 rc=2/3 被 lint-staged 統一壓成 1
#   第二版:改成獨立的殼, 而**在殼裡列檔 + xargs**
#     ⇒ ① `git diff … | tr` ⇒ **整條管線的 rc 是 `tr` 的** ⇒ git 失敗(實測 rc=129)
#          清單變空 ⇒ 殼 `exit 0` ⇒ 🔴 **印綠放行, 而那把尺根本沒跑**
#       ② `xargs` 把子程序的 rc=1/2/3 **全部壓成 1**(BSD xargs 實測)
#          ⇒ 四態契約在殼裡消失 —— **與第一版被判 FAIL 的病【一模一樣】, 只是換了個殼**
#   ⇒ ✅ **第三版:殼只做一件事 —— 確認那支 .py 在, 然後把整件事交給它。**
#     清單、git 的 rc、逐檔掃描全部在**同一個程序、同一個 rc 的射程**裡。
#
# ⚠️ **它【不是】每一種 commit 都會跑**(codex 查 `githooks` 規格):
#    乾淨的 merge / 一般 rebase / cherry-pick / revert **多半不經 pre-commit**;
#    ⛔ ~~衝突解完後的 commit 與 `--continue` / `--amend` 會經過~~
#    ✅ **2026-08-31 codex 第三輪訂正(原句寫太寬)**:官方契約只保證 pre-commit 由
#       `git commit` 觸發 ⇒ **會經過的是**「merge 衝突解完後另行 `git commit`」、
#       `git merge --continue`、以及 `git commit --amend`;
#       **rebase / cherry-pick 的 `--continue` 不保證觸發。**
#       📌 舊句留著加刪除線 —— **搜到舊字面的人會在同一發撞到這裡。**
#    ⇒ 🔴 **本閘綠, 不代表這個 repo 沒有溢出** —— 那要跑不帶旗標的全量掃描。
#
# ⚠️ **射程還有兩格(codex 第三輪查官方 pathspec 語意確認的)**:
#    · `-- '*.md'` 是 **git 的 pathspec wildcard**(不是 shell glob)⇒ **跨 `/`, 收得到子目錄**
#      🔴 **而它大小寫敏感** ⇒ `.MD` / `.markdown` **收不到**。今天 repo 裡是 0 支, 而那是「今天沒有」。
#    · `--diff-filter=ACMR` **刻意排除 `D`** ⇒ 只刪掉一支 .md 的那顆 commit 這道閘不出聲
#      —— 那是對的(刪掉的檔沒有新內容會溢出), 寫出來是為了讓下一個人不用重新推一次。
#
# ⚠️ **而 `.husky/pre-commit` 跑的是【工作樹版】的本檔, 不是 staged 版**(codex 指出)
#    ⇒ 「staged 壞版 + 工作樹好版」可以把一支壞掉的 gate commit 進去。
#    這是 husky 的形狀, 不是本檔能修的;**寫在這裡讓下一個人知道。**
#
# fail-closed:.py 不見了 ⇒ rc=2 擋下。刪掉那支 .py 正是關掉本閘最省事的方法。
set -u
if [ ! -f scripts/md-table-overflow.py ]; then
  printf '%s\n' '🔴 scripts/md-table-overflow.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/md-table-overflow.py' >&2
  exit 2
fi
python3 scripts/md-table-overflow.py --staged-md
exit $?
