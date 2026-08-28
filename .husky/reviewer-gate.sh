# PCM reviewer gate(Sean 2026-08-04 拍板 Q3=A;機制優先律)
# 背景:施工視窗兩度「先 commit、後跑 code-reviewer、再 amend」(D3a、D3c-1)——
#   規則寫了仍復發,照機制優先律改上 hook。兩次事故都發生在「測試全綠、感覺可以收工」
#   那一刻,是「忘了」不是「想繞」⇒ 本 gate 把「要不要審」的決定逼到 commit 之前,
#   不是防偽:標記自報,且 `git commit --no-verify` 跳過 pre-commit、`HUSKY=0` 關掉
#   全部 hook —— 想繞永遠繞得掉,gate 擋的是「忘了」。
#
# 放行條件(任一即過):
#   1. merge commit(MERGE_HEAD 存在)—— 主視窗 --no-ff 收割不受影響
#      (無衝突的 auto merge 根本不跑 pre-commit;squash merge / cherry-pick 衝突後的
#      手動 commit 不在此列、會照一般判定 —— 本 repo 收割固定 --no-ff,屬可接受摩擦)。
#   2. 本次 staged 沒碰到受審面 —— docs / STATUS / handoff / memory 類 commit 不受影響。
#      受審面 = apps/ packages/ supabase/ scripts/ .github/ + 根層平台設定(鐵則 12 ④
#      那族,**刻意含 lockfile 與 package.json**:純升版依賴也要過審)+ vitest.config
#      與 .npmrc(測試設施與套件解析來源)。
#      刻意不擋:.husky/ 自己、design-reference submodule 指標、*.md、.gitignore/
#      .gitmodules/.graphifyignore —— 這些屬 docs/流程面,誤擋成本高於漏擋。
#   3. 標記檔存在且第一行 = 當下 HEAD:$git_dir/pcm-reviewer-ran
#
# 標記寫法(跑完 code-reviewer、或依片型分級自判輕量片跳審之後,在自己的 worktree 根執行):
#   { git rev-parse HEAD; echo "reviewed: <片名或跳審理由>"; } > "$(git rev-parse --git-dir)/pcm-reviewer-ran"
# 標記釘在寫入當下的 HEAD ⇒ 任何 commit 落地後 HEAD 一動、標記自動失效(不需要
# post-commit 消耗;.husky/post-commit 是 graphify 本機 hook 保留位、.gitignore:84 擋著)。
# 代價:同一片的 amend、或 reviewer 跑完後先落了別的 commit,都要重寫標記 —— 一行的事。
# 已知邊界:標記失效不刪檔,HEAD 若被 reset/checkout 回被釘的那顆 commit,標記會復活
#   放行一次 —— 本 repo 紀律本就不自行 reset,不另寫程式封。
#
# 🔴🔴 ~~原字面「本檔被 husky 以 `sh -e` 執行」~~ **作廢 —— 那一句是假的**
#   (codex 2026-08-29 抓到, 線C 當場實測複驗;原文 ~/pcm-mailbox/線C-codex-reviewer-gate-20260829.txt)
#   `.husky/pre-commit` 是用**裸 `sh`** 叫本檔的 ⇒ 父層的 `-e` 保護不到子殼。
#   ⇒ `staged=$(git diff --cached --name-only)` 失敗時 `$staged` 變空
#     ⇒ 下面那個 grep 判「沒碰受審面」⇒ **exit 0 靜默放行**。
#   🔴 **可重跑的複驗式**(寫在這裡而不是只留一個信箱路徑 —— repo 外的檔會消失,
#      而半年後想複驗「裸 sh 真的會靜默放行嗎」的人打不開它;**可重跑的證據不會過期**):
#        拋棄式 repo → `printf GARBAGE > .git/index`
#        → 本檔 rc=128(擋下) · 拿掉 `set -e` 的同一份 rc=0(靜默放行)
#      另一式:`sh -c 'set -e; x=$(false); echo REACHED'` ⇒ 不印 REACHED、rc=1
#        (POSIX:沒有命令名的簡單命令, 離開狀態 = 最後一次命令替換的狀態)
#   📌 而隔壁 `.husky/pre-commit:25` 自己立過一條判別句:
#      **「我剛剛修好的東西, 在檔頭有沒有一句話還在說它沒修?」**
#      🔴 **這一次是反過來的那一版:檔頭有一句話在說它有修, 而它沒有。**
#      ⇒ 那種形狀更難抓 —— 一個【錯的安心】不會有人回頭去查。
#
# ✅ 修法:本檔自己 `set -e`, **不依賴呼叫端怎麼叫它** ——
#   改呼叫端只修得了現在這一個呼叫者, 而下一個呼叫者會再犯一次。
#
# ⚠️ 可達性(照實寫, 不要寫成「不可達」):**我構造不出一條可達路徑。**
#   **我構造得出的那個世界**(index 壞掉 / 讀不到, 實測 rc=128)裡,
#   **`git commit` 自己也會死**(實測 rc=128, HEAD 沒動)⇒ 那條路上沒有壞 commit 進得來。
#   🔴 而「我構造不出」與「不存在」是兩句話 —— 前者是我的能力, 後者是世界的性質。
#   ⚠️ ~~原字面「唯一能讓它回非零的世界」~~ 作廢(code-reviewer 2026-08-29 nit)——
#      那是**全稱句**, 而它與上一行的誠實句自相矛盾:另一族(資源瞬時失敗:ENOMEM / fork 失敗
#      / EMFILE / 程序被殺)我同樣構造不出, **而那一族裡 `git commit` 未必跟著死**。
#      📌 **一句誠實的「我構造不出」, 下一行就被一句「唯一」蓋掉了** —— 同一段裡兩種強度。
#   ⇒ 這一行仍然照修:它讓檔頭那句宣稱**變成真的**, 而那是零成本的。
# 🔴🔴 **給後來編輯本檔的人**(這不是現況描述, 是規則)——
#   ⚠️ ~~原字面「可能非零的命令都放在條件位置或 || 收尾」~~ **作廢:它今天就不成立**
#      (code-reviewer 2026-08-29 反例:`git_dir=$(...)` 與那七個 `echo >&2` 都是 top-level 裸命令)。
#      📌 **一句「本檔已經有這個慣例」會讓下一個人以為他被保護著, 而他沒有。**
#   ⇒ 規則:**本檔在 `set -e` 之下, 以後新增的 top-level 指令只要回非零, 就會擋住全隊八個窗。**
#     要嘛放進條件位置(`if`/`&&`/`||`), 要嘛 `|| true`。
#     (最常見的地雷:`grep -c` 零命中回 rc=1。)
#   ✅ 刻意的例外只有兩處:
#     · `git_dir=$(...)` 與 `staged=$(...)` —— 它們**就是要** fail-closed
#     · 那七個 `echo ... >&2` —— 實測 fd2 關閉時 rc 仍是 1、EPIPE 時兩個世界都是 141
#       ⇒ 只影響訊息完整度, 不影響擋不擋

set -e

git_dir=$(git rev-parse --git-dir)

if [ -f "$git_dir/MERGE_HEAD" ]; then
  exit 0
fi

staged=$(git -c core.quotePath=false diff --cached --name-only)

if ! printf '%s\n' "$staged" | grep -qE '^(apps|packages|supabase|scripts|\.github)/|^(vercel\.json|turbo\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|eslint\.config\.js|tsconfig|vitest\.config|\.npmrc)'; then
  exit 0
fi

head=$(git rev-parse -q --verify HEAD || echo none)

if [ -f "$git_dir/pcm-reviewer-ran" ] && [ "$(sed -n 1p "$git_dir/pcm-reviewer-ran")" = "$head" ]; then
  exit 0
fi

echo '' >&2
echo '⛔ PCM reviewer gate:本次 commit 動到受審面(code 或根層平台設定),' >&2
echo '   但本 worktree 沒有釘在當下 HEAD 的 reviewer 完成標記。' >&2
echo '   · 已跑過 code-reviewer(或本片=輕量片、依分級可跳審)→ 寫標記再 commit:' >&2
echo '       { git rev-parse HEAD; echo "reviewed: <片名或跳審理由>"; } > "$(git rev-parse --git-dir)/pcm-reviewer-ran"' >&2
echo '   · 還沒審 → 先跑 code-reviewer、折完 findings 再回來。' >&2
echo '   · amend 或中間落過別的 commit ⇒ 標記已因 HEAD 移動失效,重寫上面那行即可。' >&2
echo '   背景:Sean 2026-08-04 拍板 Q3=A(D3a/D3c-1 兩次「先 commit 後審」)。' >&2
exit 1
