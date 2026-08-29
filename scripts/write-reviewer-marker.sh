#!/bin/bash
# 寫 pre-commit reviewer 閘的完成標記(Sean 2026-08-11 拍板 A 案機制化)。
# 用法: bash scripts/write-reviewer-marker.sh "<片名+審查輪次或跳審理由>"
# 背景: 「往 git-dir 寫標記」對權限 classifier 是不可分辨的繞守門形狀(四路實測全擋),
#       故收斂為這支具名腳本+一條允許規則。防線不變: pre-commit 閘與審查鏈都沒動,
#       本腳本只是把「審完後的登記動作」變成可稽核的單一入口(理由必填、進標記檔)。
set -euo pipefail
reason="${1:?用法: bash scripts/write-reviewer-marker.sh <片名+輪次或跳審理由>}"
gd=$(git rev-parse --git-dir)

# 🔴 2026-08-30(線D,主視窗批 plan):標記多釘一行 —— **這一次要 commit 的內容**。
#   病灶:標記檔是【單一槽位】+ 唯一比對是「第1行 == 當下 HEAD」
#   ⇒ 它答得出「最近有人在這顆 HEAD 上寫過標記」, 答不出「【這一顆】、由【這個人】審過了嗎」。
#   實錘(當天 cat 出來的):第1行是線D 的 migration commit, 第2行是 -b9 另一片的理由
#   ⇒ **兩半各自都是真的, 合起來是一句假話。**
#   ⚠️ 而它的**紅也一樣不承重**(別窗 commit 讓 HEAD 動 ⇒ 假擋)⇒ **綠與紅都不代表「這片審過了」。**
#
# 🔴 **為什麼釘【內容】不釘【人】**:七窗共用一棵樹與同一個 .git、git 身分全是 `probe`、
#   env 在兩次 tool call 之間不留存 ⇒ **沒有一個穩定的窗識別可以給 hook 看**。
#   ⇒ 而「內容」本來就是我們真正想釘的:標記的意思從「某個人審過某件事」
#     變成「**我審過【我正要送出去的這一份】**」。
#
# ⚠️ **所以順序變成:`git add` → 寫標記 → `commit`**(而這個順序本來就比較對)。
# 🔴 codex 三條 must-fix 換來的:**用 git write-tree, 不要雜湊 diff 的文字輸出。**
#   ① 管線只回【最後一段】的 rc ⇒ git diff 失敗會被吞、shasum 反而算出「空內容」的雜湊
#      ⇒ 而閘那一側用同樣的壞管線也會算出同一個空雜湊 ⇒ **兩邊一致 ⇒ 放行**(codex 實測重現 PASS)
#      📌 **我以為我寫的是 fail-closed, 而它是 fail-open** —— 差別在那條管線的 rc 被誰吃掉。
#   ② shasum 是 Perl 的工具, **不是每個環境都有**(精簡容器沒有)⇒ 少了它會把所有人鎖死
#   ③ 雜湊「人類看的 diff 輸出」而不是 index 的身分 ⇒ diff.noprefix 之類的 config
#      會讓**同樣的內容算出不同的雜湊**(codex 實測)
#   ✅ git write-tree = git 自己對 index 內容的標準身分:單一指令(沒有管線)、
#      不受 diff config / locale / textconv 影響、失敗時輸出為空(下面明檢)。
#      而它正是 commit 會用的那個 tree。
staged_hash=$(git write-tree)
case "$staged_hash" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) echo "write-reviewer-marker: git write-tree 失敗或回了奇怪的東西($staged_hash)⇒ 不寫標記" >&2; exit 1 ;;
esac
{ git rev-parse HEAD; printf '%s\n' "$staged_hash"; echo "reviewed: $reason"; } > "$gd/pcm-reviewer-ran"
echo "marker OK head=$(git rev-parse --short HEAD) staged=${staged_hash%"${staged_hash#????????}"} reason=$reason"
# ── 🔵 那個「已知殘留」**實測不存在了** —— 而它是換成 git write-tree 之後才關掉的 ─────────
# ~~原文:共用 index ⇒ B 先 add、A 才寫標記(雜湊 = A+B)、B 再用 pathspec commit ⇒ B 仍會通過。
#   (主視窗 -48 2026-08-30 接受, 未經 Sean)~~
# 🔴 **那段是【雜湊 diff 輸出】那一版的性質, 不是這一版的。** 實測(2026-08-30, 拋棄式 repo):
#   git 在 **partial commit(帶 pathspec)** 時, 會給 hook 一個**暫時的 index**:
#     HOOK: GIT_INDEX_FILE=…/next-index-29835.lock
#     標記裡的 tree(A+B) 58e021d6…  ≠  hook 看到的 write-tree f75f49d6…(HEAD + 只有 B 那一支)
#   ⇒ **對不上 ⇒ 擋。** 而它擋得對:那個暫時 index 的 tree **正是這一顆 commit 真的會產生的 tree**
#   ⇒ 📌 `git write-tree` 在 hook 底下回的不是「共用 index 現在有什麼」,
#      而是「**這一顆 commit 會長成什麼**」—— 那正是我們一開始就想釘的東西。
# ⚠️ **而射程要寫準, 不要換個方向過度宣稱**:
#   · 帶 pathspec 的 commit(本 repo 明令的寫法)⇒ 洞關掉了, 有實測
#   · **不帶 pathspec** 的 commit ⇒ hook 看到的就是共用 index 本身
#     ⇒ A 的標記(A+B)與 B 的 commit(也是 A+B)會相符 ⇒ 放行
#     🔴 而那一種情況下 **B 本來就是在 commit A 的檔** —— 那是「不帶 pathspec」自己的病
#     (CLAUDE.md Git 紀律已明令帶 pathspec), 不是這道閘的洞。
