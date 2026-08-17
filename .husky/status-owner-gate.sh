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

# 偵測這次 commit 有沒有動到 STATUS.md
# 🔴 病症(codex R1 `F1`):舊寫法是 `git diff --cached --name-only | grep -c '^STATUS\.md$'`,
#    而 git 預設把 rename 併成一筆、**只列 post-image** ⇒ `git mv STATUS.md X.md` 之後
#    那個 grep 回 **0** ⇒ **整道守門被繞過**,且之後它永遠只找一個已不存在的檔 ⇒ **零症狀**。
#
# ⚠️🔴 **更正(2026-08-16 突變測試抓到,原註解是錯的)**:
#    我原本寫「`--no-renames` 不可拿掉…加了它 rename 才看得見」——**那句是假的**。
#    真正修好 F1 的是**改用 pathspec 形式** `--quiet -- STATUS.md`,不是那個旗標。
#    乾淨實測(`git mv STATUS.md X.md` 之後):
#        `--name-only | grep -c '^STATUS\.md$'`        ⇒ 0   ← 舊寫法,被繞過
#        `--quiet -- STATUS.md`（**沒有** --no-renames）⇒ rc=1 ← 已經抓得到
#        `--quiet --no-renames -- STATUS.md`            ⇒ rc=1
#    ⇒ `--no-renames` **留著當防禦深度**(擋 rename 偵測相關的 config 差異),
#      但**它不是那個修法**,而突變測試證明拿掉它現有的格一格都不會紅。
#    📎 形狀:**註解 = 想守什麼,斷言 = 真表達得出什麼。** 我把「我以為的原因」寫成了「原因」。
git diff --cached --quiet --no-ext-diff --no-textconv --no-renames -- STATUS.md && exit 0

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
#
# 🔴 用 `git diff` 比,不用 blob OID 比(2026-08-16 codex F2):
#    blob 只帶內容、**不帶 file mode** ⇒ merge 後 `chmod +x STATUS.md && git add` 兩顆 OID 仍相等 ⇒ 誤放行。
#    `git diff` 看得到 mode。順帶也修好「STATUS.md 在某一側不存在」那格(兩側都沒有 ⇒ 無 diff ⇒ 正確放行)。
#    ⚠️~~這一半依賴 `core.fileMode=true`~~ **【已作廢,2026-08-16 V 窗 R2 自我更正】**:
#       `git update-index --chmod` 會把 mode **真的寫進 index**,而 `--cached` 的 diff **讀 index 不讀工作樹**
#       ⇒ `core.fileMode=false` 照樣 rc=1。**本偵測【不】依賴 `core.fileMode`。**
#       📎 留痕不刪的理由:我(I 窗)先前把那個限定寫進本檔並宣告過,**下游可能已經引用**;
#          直接刪掉會讓引用者查不到它為什麼消失。
#    🔴 `--no-ext-diff --no-textconv` 不可拿掉(V 窗 R2 `F-R2-1`):
#       否則 hostile 的 `GIT_EXTERNAL_DIFF` + `trustExitCode`(git≥2.48)可讓 mode-only 差異被判「相同」而放行。
#       ⚠️ 本機 git 2.39.5 不重現、PCM 無人設那 config ⇒ **現環境不可達**,這是 hardening 不是修 bug。
#
# 🔴 `MERGE_HEAD` 必須真的是 dev 那邊來的(2026-08-16 A 窗 code-reviewer `A2`):
#    原版把 `MERGE_HEAD` 稱作「對方」,而**沒有任何一行約束它是誰** ——
#    實測:在側分支自己寫收帳行 → 切回來 `git merge --no-ff <側分支>`
#    ⇒ **rc=0,而且印出「✓ 是 merge 繼承 ⇒ 放行」的綠字**。**自己 merge 自己 = 合法繞過。**
#    ⇒ 加一道:來源必須在 **`dev` 線上**(是 `dev` 的祖先,或就是 `dev`)。
#    ⚠️ **比對象是 `dev` 不是 `origin/dev`**(2026-08-16 harness 當場抓到):
#       主樹的 `dev` 常常**領先** `origin/dev`(收割完還沒推),那時 `dev` 不是 `origin/dev` 的祖先
#       ⇒ 用 `origin/dev` 會把**每一次正常的 `git merge dev` 都擋掉**(false-block)。
#       📎 這個錯誤是我加完 A2 之後 harness 第一跑就紅的 —— **cell2 從 allow 變成 block。**
if [ -f "$GIT_DIR/MERGE_HEAD" ]; then
  BASE=$(git merge-base HEAD MERGE_HEAD 2>/dev/null || true)
  # `[ -n "$BASE" ]` 不可拿掉:BASE 為空時 "$BASE:STATUS.md" 會被解成 ":STATUS.md"(= index 那顆)⇒ 恆等 ⇒ 誤放行。
  if [ -n "$BASE" ] \
     && git merge-base --is-ancestor MERGE_HEAD dev 2>/dev/null \
     && git diff --cached --quiet --no-ext-diff --no-textconv --no-renames MERGE_HEAD -- STATUS.md \
     && git diff --quiet --no-ext-diff --no-textconv --no-renames "$BASE" HEAD -- STATUS.md; then
    echo "✓ STATUS.md 是 merge 繼承(index 與 MERGE_HEAD 相同、且本分支自分岔未動過)⇒ 放行" >&2
    exit 0
  fi
fi
# ⚠️ 已知未處理(codex F4,判 nit):octopus merge 的第二個以後的 head、
#    以及 dev 被 rebase/reset 過的情況,會走到【擋下】那條(false-block,不是 false-allow)。
#    ⇒ 誤擋的代價是「窗被卡住並看到訊息」,可用逃生門通過;方向是安全的那一邊,刻意不加碼複雜度。
#
# ⚠️ 第三種(2026-08-17 E 窗自查、merge `aea624a6` body 記載;同為 false-block):
#    **同一支分支重複多次 `git merge dev`**。條件③量的是
#    `git diff $(git merge-base HEAD MERGE_HEAD) HEAD -- STATUS.md`,
#    而重複 merge 會讓 merge-base 落在它先前那幾次 merge 之前
#    ⇒ **dev 自己的收帳行(主視窗/I 窗寫的)被算成「作者這側動過」** ⇒ 條件③不成立 ⇒ 擋下。
#    🔴 撞到這種的人:**不要 unstage**(見下方訊息),那會洗掉 dev 的收帳行。
#       正解=確認自己真的一行都沒 author 過,再走逃生門。**用這一條**:
#         git log --no-merges $(git merge-base HEAD MERGE_HEAD)..HEAD --not MERGE_HEAD -- STATUS.md
#         ⇒ 零筆 = 你沒 author 過(那些 STATUS 動作全是 merge 繼承來的)⇒ 可以走逃生門
#         ⇒ 非零 = 印出來的就是你自己那幾顆,先看清楚再決定
#
#    🔴 `--not MERGE_HEAD` 那一段不可拿掉,而 `aea624a6` body 記的兩條【不要照抄】:
#       ~~git log --no-merges $(git merge-base …)..HEAD -- STATUS.md      ⇒ 應為零筆~~
#       ~~git diff HEAD MERGE_HEAD --stat -- STATUS.md                    ⇒ 應為 0 行差異~~
#       兩條在【本節這第三種情境】的無辜世界裡都印「你動過」(1 筆 / 非空)——
#       前者會把 **dev 自己的收帳 commit** 算進來(它經 merge 可從 HEAD 到達、又不在 merge-base 之前),
#       後者只有在作者【剛好已經吸收 dev 現行 STATUS】時才是 0,那是狀態相依、不是判準。
#       ⇒ 無辜的人照舊版跑會得到「我動過」,而那正是本節要救的那個人。
#
#    📎 證據等級:上面「照這條跑」是**量到的**;交叉 merge 造成本節這種誤擋是**構造出來的**
#       (拋棄式 repo、雙向各一發:無辜 ⇒ C 回 0、有罪 ⇒ C 回 1 並印出那顆;
#        `git merge-base --all HEAD MERGE_HEAD` ⇒ **2 個 base**,那是交叉 merge 的指紋)。
#       ⚠️ E 窗當時遇到的**是不是同一條路徑,未確認** —— 我沒有它當時那棵樹。

cat >&2 <<'MSG'

🔴 擋下:子窗(worktree)不得直接寫 STATUS.md

  收帳權集中主視窗;子窗只在 STOP 信裡給 7 欄素材,由主視窗收割。
  出處:memory `feedback_subwindow-must-not-write-status-directly`
        (2026-08-08 撞過真 merge conflict)

  ⚠️ 就算是主視窗叫你寫的也一樣 —— 2026-08-15 主視窗真的發過那封錯誤指令。

  🔴🔴 你正在 merge 中途嗎?**那就不要 unstage。**
     本守門已經會自動放行「純 merge 繼承」,而放行需要【三條】同時成立:
       ① 來源(MERGE_HEAD)在 `dev` 線上 —— 自己 merge 自己不算
       ② index 裡那份 STATUS 與 MERGE_HEAD 那份完全相同(**含 file mode**)
       ③ 你這側自分岔以來沒動過 STATUS
     **你現在被擋,代表這三條至少有一條不成立** —— 也就是說 index 裡的 STATUS
     **不是**單純從 dev 繼承來的。
     ⇒ 先查清楚是誰改的,**不要 `git restore --staged`**:
        在 merge 中途 unstage 會把 STATUS 退回舊版,
        **等於用你這顆 merge 把主視窗的收帳行洗掉**(那比被 hook 擋嚴重得多)。
     自查三行:
        git rev-parse :STATUS.md MERGE_HEAD:STATUS.md      # 不同 ⇒ 內容不是對方那版
        git diff $(git merge-base HEAD MERGE_HEAD) HEAD -- STATUS.md | wc -l   # 非 0 ⇒ 你這側動過
        git diff --cached MERGE_HEAD --stat -- STATUS.md   # 有輸出而上兩行都說沒動 ⇒ 差在 file mode
     🔴 第三行不可省(V 窗 R2 `F-V21-2`):上面兩行【對 file mode 是盲的】——
        `rev-parse` 比的是 blob OID(只帶內容)、第二行量的是內容行數。
        **merge 後只改了 mode 的人,照前兩行自查會得到「兩個都說我沒動」**,
        而擋住他的正是 mode ⇒ **自查結果與擋他的理由對不上,他會以為守門壞了。**
     ⚠️ 本訊息的允許邏輯是【三條件】不是兩條件:除了下面兩條,
        來源還必須在 `dev` 線上(`git merge-base --is-ancestor MERGE_HEAD dev`)——
        自己 merge 自己不算繼承。

  不在 merge 中途(就是你自己改了 STATUS):
    把那些改動移出這次 commit(例如 git restore --staged STATUS.md),
    然後把 7 欄素材寫進你的 STOP 信,由主視窗收帳。

  真的必要(你就是主視窗、只是人在別的樹上):
    PCM_ALLOW_STATUS_IN_WORKTREE=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
