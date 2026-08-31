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
#   ~~{ git rev-parse HEAD; echo "reviewed: <理由>"; } > "<git-dir>/pcm-reviewer-ran"~~
#   🔴 **2026-08-30 作廢 —— 那是【兩行】版, 而標記現在是三行**(HEAD / index tree id / 理由)。
#   照舊寫的話理由會落在第 2 行 ⇒ **必定對不上 tree id ⇒ 你會被自己的標記擋住**。
#   ✅ 現行唯一寫法(先 git add, 再寫標記, 才 commit):
#       bash scripts/write-reviewer-marker.sh "<片名或跳審理由>"
# 標記釘在寫入當下的 HEAD **與當下 index 的 tree id** ⇒ HEAD 一動、或別人動了 index, 標記都失效;
# 而**別窗寫的標記不再放行你的 commit**(它的 tree id 與你的不同)。⇒ 任何 commit 落地後標記自動失效(不需要
# post-commit 消耗;.husky/post-commit 是 graphify 本機 hook 保留位、.gitignore:84 擋著)。
# 代價:同一片的 amend、或 reviewer 跑完後先落了別的 commit,都要重寫標記 —— 一行的事。
# 已知邊界:標記失效不刪檔,HEAD 若被 reset/checkout 回被釘的那顆 commit,標記會復活
#   放行一次 —— 本 repo 紀律本就不自行 reset,不另寫程式封。
#
# ══ 🔴🔴 **這道閘的紅在成本上等於零 —— 這是【已知的刻意取捨】,不是待改善** ═══════
#   (`-b4` 2026-08-30 量到、`-48` 指定寫在本檔頭;寫在這裡的理由 =
#    **下一個覺得它很吵而想放寬它的人,一定會打開這支檔。**)
#
#   **兩件事同時為真,不要只記其中一件**:
#     ✅ 新版擋掉了真的假放 —— 舊版只釘 HEAD ⇒ 別窗為別片寫的標記會放你過去
#        (`-b4` 06:0x 當場讀到共用檔裡是別窗的理由;新版釘 index tree 之後那條路關了)
#     🔴 **而它的紅,解除成本是零** —— 被擋之後你只要**重寫一次標記**就過了,
#        而「重寫標記」這個動作**本身不含任何審查**。
#
#   📌 **⇒ 一道成本為零的紅,重複幾次之後與【沒有紅】是同一件事。**
#   🔴 而這不需要任何人偷懶就成立 —— 它是這道閘的**結構性質**,不是行為預測。
#
#   ⚠️ **而它會變成噪音的訊號(這是本段唯一可執行的部分)**:
#     **當有人開始在被擋之後【只重寫標記,而沒有重看那一片】,它就已經是噪音了。**
#     🛑 **而那個行為在紀錄上看不出來** —— 標記檔只存 HEAD / tree / 理由,
#     它存不下「這個人有沒有回去看」。⇒ 要發現它,只能靠人自己講。
#
#   🛑 **`-b4` 與 `-b9` 都【不主張撤掉它】** —— 擋掉的假放是真的、而且是親自量到的那一種。
#      本段的用途是:讓這件事在它變成噪音【之前】就被寫下來,而不是之後。
#
# ══ 🔴🔴 **而它的【綠】只涵蓋一件事:「送出的內容 = 寫標記當下那一份」** ═══════════
#   **它【不是】「這片審過了」的證據。**
#   (2026-08-30 `-b9` 實錘、`-01` 收窄、`-b4` 落;寫在這裡的理由 =
#    **下一個因為它沒紅而放心的人,會打開這支檔,不會打開板子。**)
#   🔴 **再收窄一格(2026-08-30 `-e9` 量、`-01` 轉達)**:它也證不出**歸屬** ——
#     標記檔是**八窗共用的一個槽**,`-e9` 親自量到**兩個方向都發生過**
#     (A 的標記讓 B 過 / B 的標記讓 A 過),而**沒有歷史、覆寫不留痕 ⇒ 事後不可查**。
#     ⇒ **歸屬的唯一來源 = 交件裡寫的「誰審的 / 哪一輪 / 什麼模型」。**
#     全文在 `scripts/write-reviewer-marker.sh` 那段加了刪除線的原句底下(單一權威,此處不重複)。
#
#   **實錘 `5e394be9`**:那顆的 body 寫「我列 4 列 / 工作樹 4 列 ⇒ 相符」,
#   而它實際收了 **5** 列(多的一列是別窗的編輯,落在【數完之後、`git add` 之前】)。
#   ⇒ 作者照新順序 `add` → 寫標記 ⇒ **標記釘的正是那個含 5 列的 tree** ⇒ 相符
#     ⇒ 🔴 **閘放行了,而且它不該叫。**
#
#   📌 **一句話:那道閘在【標記所釘的內容】與【實際送出的內容】相符時放行 ——**
#      **而那句話裡沒有一個字提到【你以為你送出了什麼】。**
#      ⇒ 所以它對「我核對用的那個數,量在 `add` 之前」這種錯,**結構上不可能叫**。
#
#   ✅ **修法在你這一側,不在閘這一側**:
#      出錯的地方在「數的時候看到的那份」與「送出的那份」之間那段空白,
#      而**閘的兩端都落在空白的【同一側】**。
#      ⇒ 換比較對象:比「我列的 vs 工作樹現在有幾列」,不是「add 前 vs add 後」;
#        而那個計數**必須在 `git add` 之後跑**。
#
#   ⚠️ **而這一段與上面「零成本的紅」那一格要一起讀**:
#      **它的【紅】便宜到等於沒有紅,它的【綠】窄到不涵蓋「你核對的東西對不對」。**
#      ⇒ 它是一道【只驗一件很窄的事、而且很容易被解除】的閘 ——
#        **而那不是缺陷,是它的設計;寫下來是為了不要有人把它的綠讀寬。**
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

# 🔴 2026-08-30:除了 HEAD, 還要比對【這一次 staged 的內容】。
#   理由與實錘見 scripts/write-reviewer-marker.sh 的註解(那支是唯一的寫入口)。
#   一句話:只比 HEAD 的話, **A 窗寫的標記會讓 B 窗的 commit 通過**。
# ⚠️ **這一句刻意放在條件位置以外, 而它【必須】fail-closed**:
#   算不出雜湊(git 壞了 / shasum 不在)⇒ `$now_staged` 空 ⇒ 下面比對必不相等 ⇒ **擋**。
#   📌 而這正是本檔檔頭那條教訓的反面:`staged=$(...)` 失敗會變空而**靜默放行**;
#     這裡失敗變空會**擋**。⇒ 同一種「變成空字串」, 在兩個位置的方向相反 —— 要寫出來。
# 🔴 用 git write-tree(index 的 tree id)—— **不要雜湊 diff 的文字輸出**。
#   管線只回最後一段的 rc ⇒ git diff 失敗會被吞而 shasum 算出「空內容」的雜湊
#   ⇒ 兩邊都算出同一個空雜湊 ⇒ **放行**(codex 2026-08-30 實測重現)。理由全文在 writer 那支。
now_staged=$(git write-tree)
case "$now_staged" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) now_staged='' ;;    # 🔴 算不出來 ⇒ 清空 ⇒ 下面必不相等 ⇒ **擋**
esac

# ════════════════════════════════════════════════════════════════
# 🔵 **片1 診斷(2026-08-31,線【出貨】`-1e`;⟦b9-GATEDEADLOCK1⟧)——【零判準改動】**
#
# 🛑 **下面這一段不參與任何判斷** —— 它只在【已經要擋】的路徑上多印幾行。
#    判準那三行(HEAD / now_staged / 標記第 2 行)**一個字都沒動**。
#
# 🔴 **它要回答的問題**:`now_staged=$(git write-tree)` 在【帶 pathspec 的 commit】裡
#    拿到的是 **git 造的暫時 index**,不是我寫標記時看到的那個 index。
#    ⇒ 兩者只有在【index 裡只有我自己的檔】時才相同;
#      而 `CLAUDE.md` 的規矩A 正是在【index 裡有別人的檔】時才要求帶 pathspec
#      ⇒ 📌 **兩條規矩的觸發條件是同一個, 而它們在那個條件下互相矛盾。**
#
# ⚠️ **而這一段存在的理由是:那個機制我【只在拋棄式 repo 上複現過】** ——
#    用的是一支只印 `git write-tree` 的 hook, **不是這支 154 行的閘**。
#    ⇒ **機制成立 ≠ 這支閘沒有別的分支。** 這幾行就是要在【真的這一支】上把它看見。
#    ⇒ 🛑 **在它印出「兩個 tree 不同」之前, 不要改判準。**(片2 的前置)
#
# 🔵 唯讀、不需要 lock:`git write-tree` 要寫 `index.lock`(commit 期間拿不到,實測
#    `fatal: Unable to create '.../index.lock': File exists`), 而 `ls-files -s` 不用。
# ════════════════════════════════════════════════════════════════
_diag_tmp_fp=$(git ls-files -s 2>/dev/null | shasum -a 256 2>/dev/null | cut -c1-16)
_diag_real_fp=$(GIT_INDEX_FILE="$git_dir/index" git ls-files -s 2>/dev/null | shasum -a 256 2>/dev/null | cut -c1-16)
_diag_tmp_n=$(git ls-files 2>/dev/null | grep -c '' 2>/dev/null)
_diag_real_n=$(GIT_INDEX_FILE="$git_dir/index" git ls-files 2>/dev/null | grep -c '' 2>/dev/null)

if [ -f "$git_dir/pcm-reviewer-ran" ] \
   && [ "$(sed -n 1p "$git_dir/pcm-reviewer-ran")" = "$head" ] \
   && [ -n "$now_staged" ] \
   && [ "$(sed -n 2p "$git_dir/pcm-reviewer-ran")" = "$now_staged" ]; then
  exit 0
fi

echo '' >&2
# 🔵 片1 診斷:先印這一段, 再印原本的訊息(原訊息一個字都沒改)。
if [ -n "$_diag_tmp_fp" ] && [ -n "$_diag_real_fp" ] && [ "$_diag_tmp_fp" != "$_diag_real_fp" ]; then
  echo '🔵🔵 [診斷] 這一次的 index 有兩個版本, 而它們不一樣 —— 你可能撞到 ⟦b9-GATEDEADLOCK1⟧:' >&2
  echo "     暫時 index(閘看到的, 判準用的) 指紋 $_diag_tmp_fp · $_diag_tmp_n 條" >&2
  echo "     真 index  (你寫標記時看到的)   指紋 $_diag_real_fp · $_diag_real_n 條" >&2
  echo '     ⇒ 帶 pathspec 的 commit 會讓 git 造一個【只含你指定那幾支】的暫時 index,' >&2
  echo '       而標記釘的是【寫標記那一刻的真 index】⇒ 兩個 tree 對不上 ⇒ 就是下面這個擋。' >&2
  echo '     🔴 而【它今天沒有出路】—— 帶 pathspec 會被這裡擋, 不帶會掃走別人的檔。' >&2
  echo '     ⇒ 🛑 撞到請回報主視窗並附上這兩行, 不要用 --no-verify 繞過去。' >&2
  echo '     📎 落點 docs/plans/2026-08-31-reviewer-gate-deadlock-plan.md' >&2
  echo '' >&2
elif [ -n "$_diag_tmp_fp" ] && [ "$_diag_tmp_fp" = "$_diag_real_fp" ]; then
  echo "🔵 [診斷] 兩個 index 指紋相同($_diag_tmp_fp)⇒ **不是** ⟦b9-GATEDEADLOCK1⟧ 那個死結。" >&2
  echo '' >&2
else
  # 🔴 算不出指紋 ⇒ 明說算不出來, **不要讓它看起來像「相同」**。
  echo '🔵 [診斷] 兩個 index 的指紋【算不出來】(git/shasum 沒回值)⇒ 本格無結論, 不是「沒問題」。' >&2
  echo '' >&2
fi
echo '⛔ PCM reviewer gate:本次 commit 動到受審面(code 或根層平台設定),' >&2
echo '   但本 worktree 沒有釘在當下 HEAD 的 reviewer 完成標記。' >&2
echo '   · 已跑過 code-reviewer(或本片=輕量片、依分級可跳審)→ 寫標記再 commit:' >&2
echo '       bash scripts/write-reviewer-marker.sh "<片名或跳審理由>"' >&2
echo '     🔴 舊的那條兩行寫法(手動 echo 兩行進 pcm-reviewer-ran)已作廢:' >&2
echo '        標記現在是三行(HEAD / index tree id / 理由),照舊寫理由會落在第 2 行' >&2
echo '        ⇒ 必定對不上 tree id ⇒ 你會被自己的標記擋住。' >&2
echo '   · 還沒審 → 先跑 code-reviewer、折完 findings 再回來。' >&2
echo '   · amend 或中間落過別的 commit ⇒ 標記已因 HEAD 移動失效,重寫即可。' >&2
echo '   · 🔴 2026-08-30 起順序變了:**先 `git add`、再寫標記、才 commit**' >&2
echo '     (標記現在同時釘 HEAD 與【這一次 staged 的內容】⇒ 先寫標記再 add 會對不上)' >&2
echo '     ⇒ 寫標記一律走:bash scripts/write-reviewer-marker.sh "<你這一片>"' >&2
echo '   · 而它為什麼要釘內容:只釘 HEAD 的話,**別的窗寫的標記會讓你的 commit 通過**' >&2
echo '     ⇒ 那道閘答得出「最近有人寫過標記」,答不出「這一顆審過了嗎」。' >&2
echo '   背景:Sean 2026-08-04 拍板 Q3=A(D3a/D3c-1 兩次「先 commit 後審」)。' >&2
exit 1

# 片1 驗收暫時標記 A(這一行等一下會被移除)
