#!/usr/bin/env python3
# board-state-consistency.py — 兩張「態欄板」的內部一致性掃描。
#
# ══ 為什麼要有它(2026-08-25 線 3 · 幽靈清查線乙)═══════════════════════════
# 兩份檔各自被抓到同一個病, 而**兩邊都不會叫**:
#   `docs/launch-todo.md`  態欄 `open` 而該列內文寫著「✅ 已結掉」
#   spec `§1-A-1`          列坐在「✅ 現在做得到」那張表裡, 而狀態欄寫「🔴 …做不到」
# 🔴 而 launch-todo 自己附的數法會**少數**那些態欄不在封閉集的列:
#   `grep -oE '\| (open|doing|parked|done) \|'` 與實際資料列數不相等時, 沒有任何東西會叫。
#   **「板子有 96 件」與「板子有 99 件而我漏了 3 件」印同一個東西。**
#
# ══ 🔴 它的出生事故(留著, 因為它是零回饋的那一種)══════════════════════════
# 2026-08-25 本檔剛放進 `scripts/` 而**還沒登記進 `package.json` 的 lint-staged** 的那段空窗,
# `.husky/scripts-whitelist-gate.sh` 判「沒有歸屬」⇒ **全隊(主視窗 + 三條下手線)的 commit 全部卡死。**
#   🔴 **放檔是【我的】動作, 而被擋的是【下一個碰 pre-commit 的人】**
#      ⇒ 造成它的人不會撞到它 ⇒ **對造成它的人, 這個錯是零回饋的。**
#   🔴 而那道閘的訊息寫著「這是你要處理的東西」——
#      **對造成它的窗為真, 對被擋的窗為假** ⇒ 兩個窗都以為那支檔是自己的。
#   📌 規矩(主視窗 2026-08-25 立):**放新腳本進 `scripts/` ⇒ 放檔與登記在同一個動作裡。**
#   📌 而**一個零回饋的錯, 不會靠「下次記得」修好** —— 這段寫在這裡是因為它會再發生。
#
# ══ 🔴 天花板(先讀這段, 不要把它讀得比它大)══════════════════════════════
#  ① **它只看得到【寫在同一列文字裡】的矛盾。** 一列若安靜地過期(沒有人回來寫「已結掉」),
#     它**完全看不見, 而且會一直是綠的**。⇒ 它防的是「有人回來寫了一半」, 不是「沒有人回來」。
#  ② 規則② 的字集是**人列的四個詞**, 不是窮舉。已知漏兩個形狀(2026-08-25 逐列開檔核):
#       `#904` 那一列寫「**已補 2 格**」  ⇒ 抓不到(子項完成與整列結案在文字上分不開)
#       `J:226` 誰欄寫「✅ 已 commit 進 dev」⇒ 抓不到(用詞不在四詞內)
#  ③ 規則②③ 都刻意收窄。誤擋率乾跑見 `--why` 印出的表。
#     ⚠️ ~~原寫「收窄的代價是漏, 不是誤擋」~~ ⇒ **codex 推翻**, 見下面 ⑧。
#  ③b 🔴🔴 **本工具對【列的形狀】是盲的, 而那個盲區今天被量到了**(2026-08-29 `-c8`):
#     `docs/launch-todo.md` **185 列裡有 44 列(24%)不以 `|` 結尾**。
#     **Markdown 照樣渲染** ⇒ **沒有人會發現**;而本工具讀 `f[1]` 拿態、**不管行尾** ⇒ 它也不會叫。
#     **後果**:任何要「往某一列的【最後一格】加東西」的批次腳本, **會在那 24% 上失敗** ——
#     而它在另外 76% 上會成功, **所以寫的人會以為自己的做法是對的。**
#     📌 **判別句(主視窗 `-06` 定為與「等式 vs 查表」同族)**:
#        **一個「大部分列都長這樣」的假設, 在 76% 的樣本上都會成立 ——**
#        **而 76% 的成功率跑一次全綠, 與 100% 的印同一個東西。**
#     🔴 **而它失敗的那一次, 是 `assert` 擋下來的, 不是任何守門。**
#     ⚠️ **本工具刻意不修這一格**(改行尾 = 動 44 列的內容, 而那些列各自有主人)——
#        **寫進這裡是為了讓下一個寫批次腳本的人先讀到:兩種形狀都要處理。**
#
#  ④ 🔴 **反方向(態=done/parked 而內文自稱還沒做)【刻意不做】** —— 不是忘了。
#     2026-08-25 乾跑(分母 = launch-todo 的 30 個 done/parked 列):
#       寬字集 ⇒ 9 列 · 中字集 ⇒ 4 列 · 只看【事】欄 ⇒ 1 列
#     而**只看【事】欄那 1 列是誤擋**:`M:300` 的事欄是 `B5-a 的 20260824030000 **仍未** apply`,
#     那是**這一列在描述的缺陷本身**, 不是它現在的狀態(Sean 已 apply、該列是真的 done)。
#     🔴 **【事】欄天生就在唸缺陷的名字** ⇒ 那一列的誤擋是可解釋的, 不是巧合。
#     ⚠️ **而「100% 誤擋」這個說法要收窄**(R2 抓到):~~原寫「結構上 100% 誤擋」~~ ——
#        **那個 100% 的分母是 1**。準確說法:**在【事】欄這個位置, 分母 1 / 誤擋 1**。
#     ⚠️ 而 R2 另外指出**第三種寫法**:同型字樣**大量出現在「關鍵事實」欄而不是事欄**
#        (例:一列態=doing 而關鍵事實欄寫「🔴 仍未 apply」, 且那一列已被更正過)
#        ⇒ **那個位置我一格都沒量。** 要做這個方向, 先量那裡。
#  ⑤ ~~🔴 **它讀的是【工作樹】, 不是 staged 的那一份**(codex F9)…而目前**沒有修**~~
#     ✅ **2026-08-25 已修**:`--staged` 走 `git show :<path>`。證人 = partial-staging 三格
#     (真 git repo, 每格帶「不帶 --staged 的對照組」)。**預設仍讀工作樹**(人手動跑要看眼前這份)。
#     ⚠️ **殘留**:`--staged` 對【稀疏 checkout / 子模組 / 大檔】的失效面**沒有量過**
#        —— 缺的檢查很具體:在 sparse-checkout repo 與含 submodule 的 repo 各跑一發 `--staged`。
#  ⑥ **地板以上的消失是看不見的**(codex F10):板側地板 60、spec 側 5
#     ⇒ 一整節悄悄掉出分母而列數仍在地板之上 ⇒ 它**安靜全綠**。
#     地板只擋「掉光」, 不擋「掉一半」。
#  ⑦ **表頭只驗「整份檔至少看過一次」**(codex F11)——
#     ⇒ 同一份檔裡**另一張表**換了欄序或缺表頭, 它會被當資料讀而不出聲。
#  ⑧ ~~規則② …事欄寫「待確認是否已完成」「不是已完成」這類**否定或疑問語境**照樣會紅~~
#     ✅ **2026-08-25 已修**(欠帳 7):否定與疑問**分開**處理, 六格證人 ㊀-㊅。
#     ⚠️ **而它仍然做得很窄**(刻意):已知漏 = 雙重否定 / 跨標點的否定 / 否定在詞的**後面**
#        (「已完成嗎」)。📏 而族群在真板上是 **0 處**(同尺正對照 = 那四個詞全板 **6 處**)
#        ⇒ 這個修法**改不動任何真實結果**, 它買到的是「以後不會誤擋」。
#  ⑧b 🔴 **檔頭這一節自己過期過一次** —— ⑤ 與 ⑧ 在修完之後**沒有跟著改**,
#     而本檔第一段明文叫讀者「先讀這段」⇒ **被指示先讀的兩句話, 方向是反的。**
#     📌 **判別句:我剛剛修好的東西, 在檔頭有沒有一句話還在說它沒修?**
#  ⑨ **它不是守門, 除非有人把它掛上去。** 現行接線 = `package.json` 的 lint-staged
#     跑 `--selftest`(那只驗它自己活著);**對真檔跑那一發要有人在 CI 或 pre-commit 叫它**,
#     而那一步動 `.husky/` = 平台設定 = 鐵則 12④, 不在本檔的權限裡。
#
# ══ 用法 ════════════════════════════════════════════════════════════════
#    python3 scripts/board-state-consistency.py            掃兩份檔(讀【工作樹】)
#    python3 scripts/board-state-consistency.py --staged   掃 **index 那一份**(給閘用的模式)
#    python3 scripts/board-state-consistency.py --selftest 各規則兩個方向各一發
#    python3 scripts/board-state-consistency.py --why      印誤擋率乾跑的數字與量法
#
#    rc=0 全過 / rc=1 有 finding / rc=2 **工具自己壞掉**(與 finding 分得開)
#
# ══ 🔴 它【仍然只能當印報告用】—— 而擋它的理由從兩條減成一條 ═══════════════
# ✅ **已修(2026-08-25)**:`--staged` 讀 **index 那一份**(`git show :<path>`)。
#    ~~它讀的是工作樹, 不是這顆 commit 要收的那份~~ ⇒ 已不成立。
#    證人 = selftest 的 partial-staging 兩格(**真的建 git repo**, 不是 fixture 字串),
#    而且每一格都帶【不帶 `--staged` 的對照組】—— 兩個模式必須印**不同的**答案,
#    否則那兩格對「它讀哪一份」零判別力。
#      ①staged 乾淨而工作樹髒 ⇒ `--staged` rc=0 · 不帶 ⇒ rc=1
#      ②staged 髒而工作樹已修 ⇒ `--staged` rc=1 · 不帶 ⇒ rc=0
#
# ✅ **已修(2026-08-25,欠帳 7)**:規則② 現在會跳過**否定**與**疑問**語境。
#    ~~已知會誤擋「待確認是否已完成」「不是已完成」~~ ⇒ 已不成立(六格證人 ㊀-㊅)。
#    🔴 **而兩種是分開餵的**(主視窗明令):否定 =「它不成立」· 疑問 =「還不知道成不成立」
#      —— 用同一格代表兩者的話,清空其中一個字集**不會紅**(突變實測)。
#    📏 **而這個修法【改不動任何真實結果】**:族群在真板上是 **0 處**
#      (同尺正對照 = 那四個詞全板出現 **6 處** ⇒ 尺是活的);改動前後對真板皆 rc=0。
#      ⇒ **它買到的是「以後不會誤擋」, 不是「現在少擋了什麼」。**
#
# 🔴 **它仍然不是擋人的閘 —— 而現在的理由只剩【沒有人把它掛上去】**:
#    現行接線只有 `package.json` lint-staged 跑 `--selftest`(那只驗它自己活著)。
#    掛上去那一步動 `.husky/` = 平台設定 = 鐵則 12④ ⇒ **不在本檔的權限裡。**
# ⚠️ 而升成擋人閘之前,**族群 0 那條要重量一次** —— 板子每天都在長。
# ⇒ 現行接線只有 `package.json` lint-staged 跑 `--selftest`(那只驗它自己活著),
#    **沒有人在 commit 時對真檔叫它** —— 那是刻意的, 不是漏做。
# 📌 升成擋人閘的前置(codex 開的順序):
#    ~~① 改成掃 index + 兩發 partial-staging 整合測試~~ ⇒ **✅ 2026-08-25 做完**
#    ② 規則② 先只印報告(**還沒做**)
#    ③ 結構性的 ①③ 與 rc=2 才先升 blocking(**還沒做**)
# ⚠️ 而掛上去那一步動 `.husky/` = 平台設定 = 鐵則 12④ ⇒ **不在本檔的權限裡。**
import io, json, os, re, subprocess, sys, tempfile

CLOSED = ('open', 'doing', 'parked', 'done')
# 🔴 板子那條數法的 regex 【只寫一次】 —— grep 用它, 驗輸出形狀也用它。
#    寫兩份的話, 有人改了 CLOSED 而只改到一邊 ⇒ 驗證器會開始放行它本來該擋的東西。
#    ⚠️ **而「只寫一次」只治【只改一邊】那一種漂移, 治不了【新值本身含 regex 元字元】那一種**
#      (R1 審查打出來的):`CLOSED += ('wip?',)` ⇒ 未 escape 時 `wip?` 的 `?` 被當量詞
#      ⇒ grep 撈不到那一列、而 fullmatch 也一起漏 ⇒ 兩邊【同時】瞎掉, 又回到「板子少數了 N 列」。
#      ⇒ 所以要 `re.escape`。**收成單一來源不等於沒有無訊號漂移, 只是少一種。**
def _state_cell(states):
    """組出板子那條數法的 regex。🔴 **做成函式是為了讓 selftest 打得到它** ——
       原本寫成一行 module 層的字串, 而 selftest 只能【照抄一次組法】去驗,
       那等於驗我自己抄的那份, 不是驗它 ⇒ 拿掉 re.escape 時那一格照樣全綠(實測過)。"""
    return r'\| (' + '|'.join(map(re.escape, states)) + r') \|'


_STATE_CELL = _state_cell(CLOSED)
# 🔴 `GREP_OPTIONS` 會讓 grep 的輸出多東西, 而【本片新加的形狀檢查會把它判成量具壞掉】
#    (R1 審查實測:`GREP_OPTIONS='-H'` ⇒ 輸出帶檔名前綴;`--color=always` ⇒ 帶 ANSI
#     兩者在【舊版】都照常數對, 在【新版】一律 GREP_GARBAGE)
#    ⇒ 那是**本片新引入的誤擋路徑**, 不是既有事故(本機此刻沒有設它)。
#    📌 而誤擋比漏擋更會殺死一道閘:被誤擋的人會繞過去, 然後它就永遠不紅了。
def _grep_env():
    """🔴 **每次呼叫【現算】, 不是 import 當下快照一份。**
       第一版寫成 module 層的 `_GREP_ENV = {...}` 常數 ⇒ 而 selftest 的證人是先設
       `os.environ['GREP_OPTIONS']` 再呼叫 ⇒ **子行程在「有洗」與「沒洗」兩個世界拿到同一份 env**
       ⇒ 把這個洗法整個刪掉, 那一格【照樣印 ✅】(R2 審查突變實測, 我複現過)。
       📌 一個在【量測開始之前】就凍住的值, 對量測要分辨的那兩個世界是瞎的。"""
    return {**os.environ, 'GREP_OPTIONS': ''}
DONE_WORDS = ('已結掉', '已做完', '已關掉', '已完成')
# ✅ 與那四個詞之間容許幾個字。
# 📏 2026-08-25 掃 0-200(量的對象 = **本檔 selftest 的 fixture**, 不是真板):
#    綠區間 = **[16, 29]**。15 以下格⑤ 紅(判決句抓不到), 30 以上格⑦ 紅(距離太遠的也被算成判決句)。
# 🔴 **兩個界都是量到的**(~~原寫「上界沒有量到天花板」~~ ⇒ R2 實測推翻:上界 29)。
# 🔴 而這個區間的**唯一證人是 fixture** —— 對真板跑 `LOOKBACK` 取 0/16/24/200 **一律 0 列命中**
#    ⇒ 真板此刻對這個常數**零判別力**。取 24 是區間中段, 不是因為 24 有什麼特別。
LOOKBACK = 24

# 🔴 否定 / 疑問語境(codex:規則② 對事欄只要出現那四個詞就紅 ⇒
#    「不是已完成」「待確認是否已完成」都會被判成整列已完成)。
#    📏 而**族群在真板上是 0**(2026-08-25 量;同尺正對照 = 那四個詞全板出現 **6 處** ⇒ 尺是活的)
#    ⇒ 所以這裡**刻意做窄**:只認幾個**明確的**標記, 不做中文否定語境解析。
#    理由:①族群 0 ⇒ 我沒有真實樣本能驗一個解析器對不對, 只能拿自己編的句子驗自己寫的規則
#          ②中文否定自己會帶新誤擋(「並不是還沒完成」是雙重否定;
#            「已完成的部分不含 X」裡的「不含」不是在否定「已完成」)
#    ⇒ **換一個誤擋率未知的東西, 去修一個實例數 0 的缺口, 不划算。**
#    ⚠️ 已知漏(明寫, 不假裝):雙重否定、跨標點的否定、否定在【詞的後面】都抓不到。
NEGATORS = ('不是', '並不是', '並非', '不算', '不等於')
QUESTIONERS = ('是否', '待確認', '待驗', '尚待確認', '有沒有')
# 往前看幾個字。8 是量出來的:「待確認是否」到「已完成」之間最長 5 字, 留餘裕。
CONTEXT_BACK = 8

BOARD = 'docs/launch-todo.md'
SPEC = 'docs/specs/2026-07-25-admin-backend-rebuild-spec.md'
# 🔴 分母地板:少掉一整節時, 唯一的訊號是「資料列 N」變小, 而沒有人 diff 那個 N。
#    這兩個數字是 2026-08-25 量的下界(當時 99 / 8), 留了緩衝。低於它 ⇒ 判量具失效, 不判通過。
BOARD_MIN_ROWS = 60
SPEC_GREEN_MIN_ROWS = 5

# ══ 合法繞道(2026-08-25 線3;主視窗批准「乙案」)════════════════════════
# 🔴 **為什麼一定要有**:一道逼人用 `--no-verify` 的閘, 比沒有那道閘更糟 ——
#    `--no-verify` 會把那顆 commit 上的**每一道**閘一起關掉, 而畫面上看不出差別。
# 🔴 **為什麼不照現成慣例做**:本 repo 既有兩處 `PCM_ALLOW_*` 逃生門
#    (`scripts/reserve-backlog.sh:168` · `PCM_ALLOW_STATUS_IN_WORKTREE`)
#    **都只 `printf` 到 stderr** ⇒ **痕跡跟著終端機一起消失**, 半小時後沒有人知道繞過了。
# ⇒ 本閘的逃生門**只在板子自己帶著那行痕時才生效**:痕與繞道的動作進同一顆 commit,
#    住在收訊者本來就會打開的那份檔裡。沒有痕 ⇒ **fail-closed, 閘照擋。**
# 🔴 讀的是 `read_source(board, staged)` ⇒ **判誰、就讀誰**:
#    `--staged` 時讀 index 那一份, 不帶時讀工作樹那一份。
#    否則會出現「工作樹有痕而 index 沒有」⇒ 繞道成立而痕沒進 commit。
BYPASS_ENV = 'PCM_ALLOW_BOARD_DRIFT'
BYPASS_MARK = '<!-- BOARD-GATE-BYPASS:'
# 🔴 codex R1-A/C(2026-08-25):**上面那個設計有一個洞, 而它會自己長大** ——
#    第一行痕一旦 commit 進板子, 它就**永遠在那裡** ⇒ 之後任何人只要設 env 就能重用它,
#    而畫面上與「這次真的寫了一行理由」**一模一樣**。
#    ⇒ 判準改成:**這次要放行, 必須有一行痕是【HEAD 裡沒有的】。**
#    ⚠️ 已知天花板(明寫, 不假裝):本檢查是整檔 substring, **不排除 fence / 引文 / 範例**。
#       有人在**這一顆 commit 裡**新增一行長得像痕的引文 ⇒ 它會成立。
#       而「舊痕重用」那條路已經被上面那句堵死 ⇒ 剩下的是**當次刻意為之**, 不是會慢慢腐爛的洞。
def _bypass_marks(text):
    """🔴 code-reviewer N1(2026-08-25):比對前**把空白正規化**——
       原本是整行字面比對 ⇒ 在 HEAD 舊痕中間多插一個空白, 它就被算成「新痕」,
       而那正是本檢查要擋的那件事(舊痕重用)換一個寫法。"""
    #    🔴 用 `''.join` 不是 `' '.join`:中文之間本來就沒有空白,
    #       插一個進去會把 `上一次留下的` 切成兩個 token ⇒ 正規化成單一空白**擋不住**
    #       (逃11 實測到:第一版仍然 rc=0 放行)。剝光空白才比得出「同一行」。
    #    ⚠️ 副作用:兩行只差空白的**不同**痕會被當成同一行 ⇒ 偏保守(往「擋」的方向錯), 可接受。
    return {''.join(l.split()) for l in text.split('\n') if BYPASS_MARK in l}


def _head_text(path):
    """HEAD 裡那一份。**沒有 HEAD / 該檔還沒進版本庫 ⇒ None**(那種世界裡任何痕都必然是新的)。
       🔴 code-reviewer I3(2026-08-25):原本對**任何** git 失敗都回 None ⇒ fail-open,
          而它印出來的是一句**正面的假宣稱**:「板子帶著【這次新增的】痕 ⇒ 放行」。
          實跑證據:痕在 HEAD 裡、重用它、PATH 上沒有 git ⇒ rc=0 放行;
          同一世界 git 在 PATH 上 ⇒ rc=1。**兩個世界該印不同的東西, 而它印一樣的。**
       ⇒ 現在分三種:git 跑不動 ⇒ MeasurementError(rc=2, 與同檔 `read_source` 的既有約定一致);
          git 跑得動而沒有 HEAD ⇒ None;git 跑得動、有 HEAD 而該檔不在裡面 ⇒ None。
       ⚠️ **刻意不剝 GIT_***:這裡只跑 `git show`(唯讀, 不可能污染 index),
          而剝掉之後它在 linked worktree 裡會與同檔 `read_source` 讀到不同的 repo。"""
    try:
        r = subprocess.run(['git', 'show', f'HEAD:{path}'], capture_output=True)
    except OSError as e:
        raise MeasurementError('GIT_UNRUNNABLE', f'跑不動 git show HEAD:{path}:{e}')
    if r.returncode == 0:
        return r.stdout.decode('utf-8', 'replace')
    try:
        chk = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD'], capture_output=True)
    except OSError as e:
        raise MeasurementError('GIT_UNRUNNABLE', f'跑不動 git rev-parse:{e}')
    return None


def split_cells(line):
    """切欄。🔴 `\\|` 是跳脫的豎線, 不能當欄位分隔。
       📏 板內現有 **28 處**(2026-08-25 當場數:`grep -o '\\\\|' docs/launch-todo.md | wc -l`;
          ~~原寫 11~~ ⇒ R2 實測推翻, 而 `193e41f9` 當時**也是 28** ⇒ 那不是檔變了, 是我寫錯)。"""
    parts = re.split(r'(?<!\\)\|', line)
    return [p.strip() for p in parts]


class MeasurementError(RuntimeError):
    """量具失效。🔴 codex R2:selftest 原本把【任何】RuntimeError 都當「量具失效」通過
       ⇒ 一格可能因為完全不同的錯誤而誤判通過。帶 code 才分得開。"""

    def __init__(self, code, msg):
        super().__init__(f'[{code}] {msg}')
        self.code = code


def read_source(path, staged):
    """讀檔內容。
       🔴 `staged=True` ⇒ 讀 **index 裡那一份**(`git show :<path>`), 不是工作樹。
       成因(codex 兩輪都咬同一條):掛進 pre-commit 之後, 這支東西要判的是
       **這顆 commit 會收什麼**, 不是硬碟上現在長什麼樣。partial staging 時兩者會分岔:
         staged 乾淨而工作樹髒  ⇒ 讀工作樹會【誤擋】
         staged 壞而工作樹已修  ⇒ 讀工作樹會【放行】← 比誤擋更糟
       ⚠️ 預設仍是 `False`(讀工作樹)—— 人手動跑它時要看的是眼前這份。"""
    if not staged:
        try:
            return io.open(path, encoding='utf-8').read()
        except OSError as e:
            raise MeasurementError('FILE_UNREADABLE', f'讀不到 {path}:{e}')
    try:
        r = subprocess.run(['git', 'show', f':{path}'], capture_output=True)
    except OSError as e:
        raise MeasurementError('GIT_UNRUNNABLE', f'跑不動 git show :{path}:{e}')
    if r.returncode != 0:
        raise MeasurementError(
            'NOT_IN_INDEX',
            f'{path} 不在 index 裡(git show :{path} 回 rc={r.returncode})—— '
            f'這不是「檔案沒問題」, 是【這顆 commit 沒有它】')
    try:
        return r.stdout.decode('utf-8')
    except UnicodeDecodeError as e:
        raise MeasurementError('NOT_UTF8', f'index 裡的 {path} 不是 UTF-8:{e}')


def worktree_differs(paths):
    """🔴🔴 **回傳這幾支檔裡, 【工作樹與 index 不同】的那些**(2026-09-01 加)。

    ── 為什麼要有這一格(它是一次真的踩到, 不是想像)──────────────────
    2026-09-01 線 `-f7` 改完板子, 直接跑 `--staged` ⇒ **全綠**,
    而它**還沒 `git add`** ⇒ 🔴 **這一發驗的是 HEAD 那一份, 不是他剛改的那一份。**
    `git add` 之後重跑才抓到他漏改的一列。

    🛑 **而這個坑 memory 裡【已經記過】, 它還是復發了 ⇒ 提醒治不了它。**
    而復發的機制是這一句:
      📌 **那行「讀自 index」它一直都有印 —— 是讀的人跳過了它。**
      ⇒ ⇒ 而它跳得掉的原因是:**它在【我 add 了】與【我沒 add】兩個世界【逐字相同】。**
      ⇒ ⇒ ⇒ **一個對兩個世界印同一句話的標註, 等於不存在。**

    ✅ **所以這一格做的不是「多印一行提醒」, 是【讓那一行在兩個世界不一樣】**:
       · 相同 ⇒ 標題直接寫「與工作樹相同」(**不是警告, 是事實** ⇒ 不製造噪音)
       · 不同 ⇒ 標題不變, 而**結論的正上方**多一塊, 逐支列出是哪幾支。

    ⚠️ **選【出聲】不選【拒跑】, 理由**:pre-commit 底下 partial staging 是**合法的**
       (先 add 一半拿去審、再改另一半)⇒ 拒跑會把一個正當的 commit 變成硬擋,
       而本 repo 記過「**一道紅著而沒有出路的守門會被整支刪掉**」。

    🔴 **`git diff` 是 cwd 相對, 而 `git show :path` 是 repo-root 相對** ——
       兩者混用就會在非根目錄下比錯東西(這條是 `md-table-overflow.py` 檔頭記過的坑)。
       ⇒ 這裡顯式取 `--show-toplevel` 並在那裡跑。
    ⚠️ **射程**:它只答「工作樹 vs index」。**答不出**「index vs HEAD」(那是另一個問題),
       也答不出未追蹤的新檔(那種在 `git show :path` 那一關就已經炸了)。
    """
    try:
        top = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True)
    except OSError:
        return None
    if top.returncode != 0:
        return None
    root = top.stdout.strip()
    try:
        r = subprocess.run(['git', 'diff', '--name-only', '--'] + list(paths),
                           cwd=root, capture_output=True, text=True)
    except OSError:
        return None
    if r.returncode != 0:
        return None
    hit = {ln.strip() for ln in r.stdout.split('\n') if ln.strip()}
    return sorted(p for p in paths if p in hit)


def _rows(path, sec_pat, head_pat, state_header, staged=False):
    """撈資料列。同時驗【欄位標題】—— 不驗的話, 欄位順序一改它會靜靜地讀錯欄。"""
    lines = read_source(path, staged).split('\n')
    rows, sec, in_fence, header_seen = [], None, False, False
    for i, l in enumerate(lines):
        # 🔴 code fence 內的示範表列不是真資料列。
        # 📏 板內現有 **7 條**(14 行 ```;~~原寫 8 條~~ ⇒ R2 實測推翻, `193e41f9` 當時也是 14 行)。
        if l.lstrip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(sec_pat, l)
        if m:
            sec = m.group(1)
        elif re.match(head_pat, l):
            sec = None
        # 🔴 codex R2:對齊分隔列 `| :--- | ---: |` 的字元集含 `:` ⇒ 原本的 set 檢查漏掉它。
        if sec is None or not l.startswith('|') or set(l) <= set('|-: '):
            continue
        f = split_cells(l)
        if len(f) < 3:
            continue
        # 表頭列:第一格就是那個標題字。驗它, 不是丟掉它。
        if f[1] == state_header:
            header_seen = True
            continue
        rows.append({'sec': sec, 'line': i + 1, 'state': f[1], 'f': f})
    if not header_seen:
        raise MeasurementError(
            'HEADER_MISSING',
            f'{path} 找不到任何欄位標題為「{state_header}」的表頭 —— '
            f'欄位順序若改過, 本工具會讀到別欄而靜靜全綠')
    return rows


def board_grep_count(path, staged=False):
    """🔴 真的跑板子【自己附的那條數法】, 不要用 len(rows) 去推算它。
       兩邊是不同的機制(它不分節、不剝 fence), 今天相等不代表明天相等。"""
    # 🔴 staged 模式下要數的是【index 那一份】—— 拿工作樹去數就與上面那一半不同源,
    #    而「兩個各自量到的數」如果來自不同的檔, 它們相等或不等都沒有意義。
    try:
        if staged:
            out = subprocess.run(['grep', '-oE', _STATE_CELL],
                                 input=read_source(path, True),
                                 capture_output=True, text=True, env=_grep_env())
        else:
            out = subprocess.run(
                ['grep', '-oE', _STATE_CELL, path],
                capture_output=True, text=True, env=_grep_env())
    except OSError as e:
        raise MeasurementError('GREP_UNRUNNABLE', f'跑不動 grep:{e}')
    # 🔴 grep 的 rc:0=有命中 · 1=零命中 · **2 以上=它自己出錯**。
    #    不看 rc 的話, 「grep 壞了」會回空 ⇒ 0 ⇒ 判成「板子少數了 N 列」⇒ **紅錯地方**。
    if out.returncode > 1:
        raise MeasurementError('GREP_FAILED', f'grep 對 {path} 回 rc={out.returncode}:{out.stderr.strip()[:80]}')
    lines = [x for x in out.stdout.split('\n') if x.strip()]
    # 🔴🔴 rc 不夠 —— 2026-08-25 線 3 造樁量到的第二條入口:
    #    板子裡只要有一個 NUL, `grep` 會回 `Binary file … matches` 而 **rc=0**
    #    ⇒ 上面那道 `rc > 1` 【不觸發】, 而這裡會數到 1(那行訊息)而不是真的列數
    #    ⇒ 與 python 這半不符 ⇒ 仍然會紅(方向是對的), **而紅的訊息會寫成「板子少數了 N 列」**
    #    ⇒ 有人會去板子上找一列【不存在的東西】。上面那段註解自己就寫著這個病,
    #      作者想到了「回空 rc=1」那條入口, 沒想到「rc=0 而輸出是一句話」那條。
    #    📌 **守門存在這件事, 會讓下一個人以為這條路已經被想過了。**
    # 🔴 判準【不看 grep 的訊息字面】(那會隨 locale / 版本變),
    #    看的是**輸出的形狀**:`-oE` 只會印出被匹配到的那段文字
    #    ⇒ 每一行都必須 fullmatch 同一條 regex。對不上 = grep 沒有做我們要求的事。
    # 🔴 第三條入口(R1 審查提出, 而**本機驗不成**, 照實標):
    #    GNU grep >= 3.5 據稱把 `Binary file … matches` 印到 **stderr**, stdout 留空
    #    ⇒ `lines` 是空的 ⇒ `bad` 也是空的 ⇒ 回 0 而不出聲 = 本片要修的那個病原封不動。
    #    ⚠️ **未驗**:本機是 `BSD grep 2.6.0-FreeBSD`(它印 stdout, 所以下面那條抓得到),
    #      `ggrep` 查無 ⇒ **缺的那一道檢查 = 在 GNU grep 上跑一次同一份 NUL fixture。**
    #    ⇒ 所以不賭訊息去哪, 改釘一個**不可能的組合**:`-oE` 的 rc=0 代表「有匹配到東西」,
    #      有匹配就一定會印出來 ⇒ **rc=0 而零輸出 = grep 沒有做它說它做了的事。**
    #      這一條與訊息**印到哪、長什麼樣**無關。
    #      ⚠️ 而**不是「與哪一支 grep 無關」**(R2 審查:那句講太滿)——
    #        一支被 `-q` / `-l` / `-c` 驅動的 grep, rc=0 而零輸出是**它正確執行了指令**,
    #        這道閘會判它壞了。前提是「`-oE` 且沒有 `-q`/`-l`/`-c`」, 而那個前提由
    #        `_grep_env()` 洗掉 `GREP_OPTIONS` 來保證 ⇒ **是【條件成立】, 不是【無關】。**
    if out.returncode == 0 and not lines:
        raise MeasurementError(
            'GREP_GARBAGE',
            f'grep 對 {path} 回 rc=0(= 有匹配)卻沒有印出任何東西'
            f' ⇒ 這是【量具壞了】, 不是板子零命中'
            f'(stderr 前 80 字:{out.stderr.strip()[:80]!r})')
    bad = [x for x in lines if not re.fullmatch(_STATE_CELL, x)]
    if bad:
        raise MeasurementError(
            'GREP_GARBAGE',
            f'grep 對 {path} 回 rc={out.returncode} 而輸出不是態欄的形狀'
            f'(例:{bad[0][:60]!r})⇒ 這是【量具壞了】, 不是板子少列。'
            f'常見成因:板子含 NUL / GREP_OPTIONS 或 alias 讓輸出多了前綴或色碼')
    return len(lines)


def rule1_closed_set(rows):
    """① 態欄必須落在封閉集裡。空態欄也算 —— 那正是最壞的形狀(板子的 grep 也數不到它)。"""
    return [r for r in rows if r['state'] not in CLOSED]


PARKED_PREFIXES = ('等#', '等人:', '等時機:')


def rule4_parked_has_prefix(rows):
    """④ 態=parked 的列, 必須有一個機讀的「等什麼」前綴。

    🔴 **本檢查驗的是「有沒有前綴」, 不是「前綴填得對不對」。**
       一個填錯的前綴與一個填對的, 在它底下印同一個東西。
       ⇒ 不要把它讀成「這些列的等待對象已經被驗過了」。

    為什麼是前綴而不是新開一個態(2026-08-29 `-c8` 量、主視窗裁):
       2026-08-29 `-c8` 量(當時 11 個 parked, 其中一列同片改判 `open` ⇒ 現值 **以本工具輸出為準**):
       9-10 種不同的「等」, 而**在等 Sean 回答的是 0 列**
       ⇒ 開 `waiting-sean` 會有零個成員。真正的病是
       **一列 parked 進去之後, 沒有機制會告訴你它可以出來了** ——
       而前綴讓「**在等什麼**」變成一發 grep。
       ⚠️ ~~原寫「讓『前置關了沒』變成一發 grep」~~ **降級**:R1 用板面反證 ——
       同一個 `等#` 底下現在有**三套互不相通的編號**(backlog `#958`、同板列號 `#①`、
       `#17` 那列自己逐字寫著「指哪套編號未確認, 所以這個前綴現在回答不了」)
       ⇒ **指涉的編號屬於哪套仍未收斂。**

    ⚠️ 天花板:它**掃整列的任何一格**, 不驗前綴的位置。
       理由:板子的列**內容裡有 `|`** ⇒ 按位置解析會讀到別欄而靜靜地錯。
       📏 數法與分母(2026-08-29 R1 複量, 我原寫的「欄數 5 到 18」四種數法都複現不出來):
         全板 214 條 pipe 列 ⇒ `len(l.split('|'))` = **4..18**(內容格 2..16)—— **方向成立**;
         🔴 **而本規則的分母只有那 10 個 parked 列, 它們的欄數是 6 或 7,
            前綴 10/10 全在 `f[4]`, 零例外** ⇒ **位置解析的風險在這群列上一格都沒發生過。**
       🔴 **代價(這一半原本沒寫進檔, R1 抓到)**:前綴若出現在**別的欄**
         (例:關鍵事實欄引用另一列的 `等#123`)⇒ **這道閘假綠**。
         2026-08-29 實測風險池:非 parked 列命中前綴 **0** 列、parked 前綴在 `f[4]` 以外 **0** 列。
    """
    return [r for r in rows
            if r['state'] == 'parked'
            and not any(x in c for c in r['f'] for x in PARKED_PREFIXES)]


def _negated_or_questioned(cell, at):
    """那個詞的**前 CONTEXT_BACK 字**裡有沒有否定/疑問標記。
       🔴 只看【前面】—— 「已完成嗎」那種後置疑問抓不到, 明寫在 NEGATORS 上面的天花板裡。"""
    pre = cell[max(0, at - CONTEXT_BACK):at]
    return any(x in pre for x in NEGATORS) or any(x in pre for x in QUESTIONERS)


def rule2_self_contradiction(rows):
    """② 態=open/doing 而該列自稱做完了。
       回傳 (row, 命中的欄位索引, 命中的詞) —— 🔴 codex F13:只印【事】欄的話,
       命中發生在後面欄位時會把人指向一個沒問題的欄。"""
    out = []
    for r in rows:
        if r['state'] not in ('open', 'doing'):
            continue
        f = r['f']
        found = None
        # 🔴 codex F12:劃掉的舊值不算宣稱(`~~已完成~~` 是更正慣例)⇒ 與 rule3 同一套剝法。
        if len(f) > 3:
            title = re.sub(r'~~.*?~~', '', f[3])
            for w in DONE_WORDS:
                for m in re.finditer(re.escape(w), title):
                    if _negated_or_questioned(title, m.start()):
                        continue        # 「不是已完成」/「待確認是否已完成」⇒ 不是宣稱
                    found = (3, w)
                    break
                if found:
                    break
        if found is None:
            for idx, cell in enumerate(f[4:], start=4):
                cell = re.sub(r'~~.*?~~', '', cell)
                for w in DONE_WORDS:
                    for m in re.finditer(re.escape(w), cell):
                        if _negated_or_questioned(cell, m.start()):
                            continue
                        if '✅' in cell[max(0, m.start() - LOOKBACK):m.start()]:
                            found = (idx, w)
                            break
                    if found:
                        break
                if found:
                    break
        if found:
            out.append((r, found[0], found[1]))
    return out


def normalize_marker(s):
    """把【劃掉的舊值】與粗體/空白剝掉, 留下真正在宣稱的那個標記。
       🔴 剝劃線的理由:本 repo 的更正慣例是「劃掉不刪」(`~~❌~~ → **✅**`),
          不剝的話那個作廢的 ❌ 會被讀成現值。📏 誤擋率見 --why。"""
    s = re.sub(r'~~.*?~~', '', s)
    s = s.replace('*', '').replace('→', '').strip()
    return s


def rule3_marker_vs_table(rows):
    """③ 坐在「✅ 現在做得到」那張表裡, 而狀態欄不是【純 ✅】。
       🔴 用【白名單】不用黑名單:黑名單只認得你想得到的那幾個符號,
          而同一份 spec 自己就定義了第四種標記 `🔌`(2026-08-22 新增)。
          白名單版本對「🔌」「✅ 但只在測試環境」「空白」一律出聲。"""
    # 🔴 欄位不足也要出聲 —— 一列少了狀態欄與「狀態欄寫著 ✅」是兩件事。
    return [r for r in rows if len(r['f']) <= 3 or normalize_marker(r['f'][3]) != '✅']


def scan(board=BOARD, spec=SPEC, quiet=False, board_min=None, spec_min=None, staged=False):
    board_min = BOARD_MIN_ROWS if board_min is None else board_min
    spec_min = SPEC_GREEN_MIN_ROWS if spec_min is None else spec_min

    def say(*a):
        if not quiet:
            print(*a)

    bad = 0

    rows = _rows(board, r'^## ([A-Z]+) · ', r'^#{2,3} ', '態', staged=staged)
    if len(rows) < board_min:
        raise MeasurementError(
            'BOARD_ROW_FLOOR',
            f'{board} 只撈到 {len(rows)} 列(地板 {board_min})—— '
            f'掉一整節時唯一的訊號就是這個數變小')
    # 🔴 `--staged` 時先量一次「工作樹與 index 一不一樣」—— 見 `worktree_differs` 的 docstring。
    #    `None` = 量不出來(git 跑不動 / 不在 repo 裡)⇒ **那是第三個世界, 不可以與「相同」合併**。
    drift = worktree_differs([board, spec]) if staged else []
    if not staged:
        src = '工作樹'
    elif drift is None:
        src = 'index(而【工作樹那一份比不出來】—— git 答不了)'
    elif drift:
        src = 'index'
    else:
        src = 'index(與工作樹相同)'
    say(f'══ {board}(資料列 {len(rows)};讀自 {src})══')

    # ① 🔴 真的跑那條 grep, 兩個【各自量到的】數字比對。不是 len(rows) 減 len(strays)。
    # 🔴 兩條路【分開判、分開印】—— R2 抓到:合成一個 if 之後它們會互相遮蔽,
    #    拿掉任一條另一條都會接住 ⇒ 沒有任何一格證明它們【各自】活著。
    grep_n = board_grep_count(board, staged=staged)
    strays = rule1_closed_set(rows)
    if strays:
        bad = 1
        say(f'  🔴 ①a 態欄不在封閉集的有 {len(strays)} 列(封閉集 = {"/".join(CLOSED)})')
        for r in strays:
            st = r['state'] if r['state'] else '(空白)'
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{st}]')
    else:
        say(f'  ✅ ①a {len(rows)} 列的態欄全在封閉集裡')
    if grep_n != len(rows):
        bad = 1
        say(f'  🔴 ①b 板子自己的數法印 {grep_n},而資料列是 {len(rows)}(差 {len(rows) - grep_n})')
        if strays:
            say('     ⇒ 差額的一部分來自上面 ①a 那幾列(它們的態欄字樣, 那條 grep 認不得)')
        else:
            say('     ⚠️ 而【一列態欄都沒錯】⇒ 差額來自別的地方。'
                '**下面是候選, 不是結論**(codex F14:過度推論會把人指錯方向):'
                'fence 裡的示範表列 / 節外的表 / 跳脫豎線 / 註解或引文裡的表格樣式。')
        say('     🔴 這仍然是【真的 finding】—— 板子那條數法會把示範列算進「還剩幾件」。'
            '處置是把示範列的態欄字樣改掉, 不是把本檢查關掉。')
    else:
        say(f'  ✅ ①b 板子的數法印 {grep_n} = 資料列 {len(rows)}(兩個各自量到的數)')

    noprefix = rule4_parked_has_prefix(rows)
    if noprefix:
        bad = 1
        say(f'  🔴 ④ 態=parked 而沒有「等什麼」前綴的有 {len(noprefix)} 列'
            f'(前綴 = {"/".join(PARKED_PREFIXES)})')
        for r in noprefix:
            say(f'     {r["sec"]} 節 :{r["line"]}  {r["f"][3][:44] if len(r["f"]) > 3 else ""}')
        say('     ⚠️ 本檢查只驗【有沒有前綴】, 不驗【填得對不對】')
    else:
        n_parked = len([r for r in rows if r['state'] == 'parked'])
        say(f'  ✅ ④ {n_parked} 個 parked 列都有「等什麼」前綴'
            f'(⚠️ 只驗有沒有, 不驗對不對)')

    contra = rule2_self_contradiction(rows)
    if contra:
        bad = 1
        say(f'  🔴 ② 態=open/doing 而自稱做完的有 {len(contra)} 列')
        for r, idx, w in contra:
            where = '事欄' if idx == 3 else f'第 {idx} 欄'
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{r["state"]}]  '
                f'命中「{w}」在【{where}】:{r["f"][idx][:44]}')
    else:
        say('  ✅ ② 零命中')

    grows = _rows(spec, r'^### .*(§1-A-1) ✅ 現在做得到', r'^#{3,4} ', '#', staged=staged)
    for r in grows:
        r['sec'] = 'GREEN'
    if len(grows) < spec_min:
        raise MeasurementError(
            'SPEC_ROW_FLOOR', f'{spec} §1-A-1 只撈到 {len(grows)} 列(地板 {spec_min})')
    say(f'══ {spec} §1-A-1(資料列 {len(grows)})══')
    odd = rule3_marker_vs_table(grows)
    if odd:
        bad = 1
        say(f'  🔴 ③ 坐在「✅ 現在做得到」表裡而狀態欄**不是純 ✅** 的有 {len(odd)} 列')
        say(f'     ⇒ 數「我們能做幾件」會數到 {len(grows)},而其中 {len(odd)} 列的狀態欄另有說法')
        say('     ⚠️ 「另有說法」不等於「做不完整」—— 也可能只是格式或註記。**去開那一列看。**')
        for r in odd:
            f = r['f']
            # 🔴 codex F15 的實例:這裡原本裸寫 f[3] ⇒ 一列【欄位不足】時 IndexError,
            #    而那正是 rule3 該抓的形狀之一 ⇒ **它抓到了, 然後印的時候自己炸掉。**
            if len(f) <= 3:
                say(f'     :{r["line"]}  #{f[1]} {f[2][:20] if len(f) > 2 else ""}  '
                    f'狀態=[缺這一欄, 整列只有 {len(f) - 1} 格]')
            else:
                mk = f[3] if f[3] else '(空白)'
                say(f'     :{r["line"]}  #{f[1]} {f[2][:20]}  狀態=[{mk[:40]}]')
    else:
        say(f'  ✅ ③ {len(grows)} 列狀態欄全是純 ✅')

    # 🔴🔴 **結論的正上方** —— 位置是刻意的:放輸出開頭會被捲過去,
    #    而人讀的是最後那幾行(綠或紅)。⇒ 這一塊要貼著那個結論。
    if staged and drift:
        say('')
        say(f'  🔴 這一發驗的是 **index 那一份**, 而下面這 {len(drift)} 支檔'
            f'**工作樹上還有沒 stage 的改動**:')
        for p in drift:
            say(f'     {p}')
        say('     ⇒ 📌 **所以「它綠了」的意思是【index 那一份是綠的】, 不是【你剛改的那份是綠的】。**')
        say('     ✅ 要驗你剛改的那份 ⇒ `git add <檔>` 之後重跑, 或**不帶 `--staged`**(那會讀工作樹)。')
        say('     ⚠️ 而 pre-commit 底下這是【合法】的(partial staging)⇒ 本閘只出聲, 不擋你。')

    # 🔴 逃生門(見檔上方 BYPASS_ENV 那段的「為什麼」)。**兩個條件都要成立才放行。**
    #    ⚠️ 只在 bad 時才讀那支檔 —— 綠的時候多讀一次沒有意義, 而 `--staged` 那條會多跑一發 git。
    if bad and os.environ.get(BYPASS_ENV) == '1':
        cur = _bypass_marks(read_source(board, staged))
        if not cur:
            say(f'  🔴 {BYPASS_ENV}=1 而板子【沒有】{BYPASS_MARK} 那行痕 ⇒ **不放行**'
                f'(逃生門要留痕才生效。把那行寫進 {board} 並 stage 它)')
            return bad
        head = _head_text(board)
        fresh = cur if head is None else cur - _bypass_marks(head)
        if fresh:
            say(f'  ⚠️ {BYPASS_ENV}=1 且板子帶著【這次新增的】{BYPASS_MARK} 痕 ⇒ **放行**'
                f'(痕跟著這顆 commit 進 {board};要查是誰繞的, 去板子裡看那一行)')
            return 0
        say(f'  🔴 {BYPASS_ENV}=1 而板子上那 {len(cur)} 行痕【HEAD 裡已經有了】⇒ **不放行**'
            f'(舊痕不能重用 —— 那會讓第一次繞道變成一個永久的洞。'
            f'這次要繞就寫一行新的, 並且 stage 它)')
    elif bad:
        # 🔴🔴 code-reviewer C1 [Critical](2026-08-25):**逃生門對【除了寫它的人以外的所有人】不存在。**
        #    原本只有 `env == '1'` 那條分支會印任何一句關於它的話 ⇒ 撞到閘的人看到兩行紅、
        #    **沒有任何出口** ⇒ 他伸手拿 `--no-verify` ⇒ 那顆 commit 上的**每一道閘**一起關掉。
        #    ⚠️ 而 body 裡「一道逼人用 --no-verify 的閘比沒有那道閘更糟」那句是我自己寫的 ——
        #       **這一片交出去的就是那道閘。**
        #    對照組:`.husky/status-owner-gate.sh:22` 與 `scripts/reserve-backlog.sh:168`
        #    都把 env 名寫進**失敗訊息**。本閘原本是全 repo 唯一一道把逃生門藏起來的。
        say(f'  ── 真的要繞過去(而板子確實還沒改得完)⇒ **兩步, 缺一不可**:')
        say(f'     ① 把一行 `{BYPASS_MARK} <日期> <誰> <為什麼> -->` 寫進 {board} 並 stage 它')
        say(f'     ② {BYPASS_ENV}=1 git commit …')
        say(f'     🔴 那一行痕會跟著這顆 commit 進板子 —— 這就是它與 --no-verify 的差別:'
            f'--no-verify 會把這顆 commit 上的【每一道】閘一起關掉, 而且不留任何痕。')
    return bad


# ══ selftest ═════════════════════════════════════════════════════════════
# 🔴 設計原則(R1 抓到的病):**每一個修法都要對應到至少一格紅。**
#    第一版有七個修法拿掉之後 selftest 一格都不紅 ⇒ 那七段等於沒有守門。
def _pad(extra=''):
    """湊到地板以上的乾淨列, 讓每一格測的是它自己那條規則, 不是分母不足。"""
    head = '## A · 測試節\n| 態 | # | 事 | 誰 | 卡什麼 |\n|---|---|---|---|---|\n'
    body = ''.join(f'| open | — | 乾淨列 {i} | 待派 | 沒有結案字樣 |\n' for i in range(60))
    return head + body + extra


def _spec(extra=''):
    head = '### §1-A-1 ✅ 現在做得到\n| # | 能力 | 狀態 | 量法 |\n|---|---|---|---|\n'
    body = ''.join(f'| {i} | 能力 {i} | ✅ | 量過 |\n' for i in range(2, 10))
    return head + body + extra


GREEN_BOARD = _pad()
GREEN_SPEC = _spec()


# 🔴🔴 **這一段是事故的修補, 不是防禦性想像。**
#    2026-08-25:本檔的 selftest 會 `git init` / `git add -A` 一個拋棄式 repo。
#    而它**掛在 `package.json` 的 lint-staged 上** ⇒ 每次 pre-commit 都會跑它。
#    pre-commit 執行時, git **匯出 `GIT_DIR` 與 `GIT_INDEX_FILE`(在 linked worktree 下是絕對路徑)**
#    ⇒ 子程序裡的 `git add -A` **寫進真 repo 的 index**, 而 `cwd` 是空的暫存目錄
#    ⇒ **它會把整個 repo 的檔案 stage 成刪除**, 而 selftest 照樣印「全部通過」。
#    ⇒ 下一顆不帶 pathspec 的 commit 會刪掉整個 repo。
#    📌 **兩個世界印同一句話**:有沒有污染真 index, selftest 的輸出**一模一樣**。
_GIT_FREE_ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}


def selftest():
    d = tempfile.mkdtemp()

    def w(name, text):
        p = os.path.join(d, name)
        io.open(p, 'w', encoding='utf-8').write(text)
        return p

    cases = [
        ('①該綠必綠 · 乾淨板 + 乾淨 spec', GREEN_BOARD, GREEN_SPEC, 0),
        ('②該紅必紅 · 態欄不在封閉集',
         _pad('| ~~open~~ **半關** | — | 錯填的態欄 | — | x |\n'), GREEN_SPEC, 1),
        ('③該紅必紅 · 態欄【空白】(板子的 grep 也數不到它)',
         _pad('|  | — | 空態欄 | — | x |\n'), GREEN_SPEC, 1),
        ('④該紅必紅 · 【事】欄自稱做完而態=open',
         _pad('| open | — | ✅ **這件已做完** | — | x |\n'), GREEN_SPEC, 1),
        ('⑤該紅必紅 · 【後面欄位】的 ✅+判決句(LOOKBACK 那條路)',
         _pad('| open | — | 一件事 | — | ✅ **2026-08-25 夜已結掉**:貼過了 |\n'), GREEN_SPEC, 1),
        ('⑥該綠必綠 · 四詞出現在句中而【沒有 ✅ 前綴】⇒ 子項完成, 不得誤擋',
         _pad('| open | — | 一件事 | — | F1 那一小格已做完並實測, 整件還沒 |\n'), GREEN_SPEC, 0),
        ('⑦該綠必綠 · ✅ 離那四個詞太遠 ⇒ 不算判決句(LOOKBACK 的上界證人)',
         _pad('| open | — | 一件事 | — | ✅ 這裡先講一段很長的別的事情所以距離拉開了非常非常遠了喔 已做完 |\n'),
         GREEN_SPEC, 0),
        ('④a該紅必紅 · 態=parked 而沒有「等什麼」前綴',
         _pad('| parked | — | 一件停著的事 | 等某個東西 | x |\n'), GREEN_SPEC, 1),
        ('④b該綠必綠 · 態=parked 而有前綴 ⇒ 不得恆紅',
         _pad('| parked | — | 一件停著的事 | **等#123** 前置 | x |\n'), GREEN_SPEC, 0),
        # ⚠️ ④c 是**意圖記錄**, 不是唯一證人:R1 突變實測它在 M1/M2 都不紅,
        #    因為 `_pad()` 本體已產 60 列同形的 `| open |…| 待派 |` ⇒ 案例 ① 就涵蓋它。
        ('④c該綠必綠(意圖記錄) · 態【不是】parked 而沒有前綴 ⇒ 不得咬到不該咬的',
         _pad('| open | — | 一件沒在等的事 | 待派 | x |\n'), GREEN_SPEC, 0),
        ('⑧該紅必紅 · 🟡 坐在 ✅ 表裡', GREEN_BOARD, _spec('| 9 | 坐錯表的 | 🟡 | 量過 |\n'), 1),
        ('⑨該紅必紅 · 🔴 半邊(標記欄兩半)', GREEN_BOARD,
         _spec('| 9 | 半殘的 | ✅ **記得下來** / 🔴 **提醒不了他** | 量過 |\n'), 1),
        ('⑩該紅必紅 · ❌ 坐在 ✅ 表裡', GREEN_BOARD, _spec('| 9 | 做不到的 | ❌ | 量過 |\n'), 1),
        ('⑪該紅必紅 · 🔌 第四種標記(黑名單版會放行它)', GREEN_BOARD,
         _spec('| 9 | 被旗標關著的 | 🔌 `FLAG` | 量過 |\n'), 1),
        ('⑫該紅必紅 · 粗體 🟡(startswith 版會放行它)', GREEN_BOARD,
         _spec('| 9 | 粗體的 | **🟡** | 量過 |\n'), 1),
        ('⑬該紅必紅 · 帶但書的 ✅', GREEN_BOARD,
         _spec('| 9 | 有但書的 | ✅ 但只在測試環境 | 量過 |\n'), 1),
        ('⑭該綠必綠 · ~~❌~~ → ✅ 是更正慣例, 不得誤擋', GREEN_BOARD,
         _spec('| 10 | 更正過的 | ~~❌~~ → **✅** | 量過 |\n'), 0),
        # 🔴 ⑮ 這一格的期望值是 rc=1, 而它原本被我寫成 0 —— 那是【我的期望值錯了, 不是碼錯】。
        #    改期望值通常是停止訊號, 所以理由寫在這裡:
        #    本工具剝 fence, 而**板子自己那條 grep 不剝** ⇒ fence 裡放一列 `| open |`,
        #    板子的數法就會把它算進「還剩幾件」。**那是真的 finding, 不是誤擋。**
        #    處置是把示範列的態欄字樣改掉, 不是把本檢查關掉。
        ('⑮該紅必紅 · fence 裡的示範列會讓板子的數法多數一列',
         _pad('```\n| open | — | ✅ **這是示範不是真的** | — | x |\n```\n'), GREEN_SPEC, 1),
        ('⑯該綠必綠 · fence 裡【沒有態欄字樣】⇒ 剝 fence 那段本身要正確',
         _pad('```\n| 欄一 | 欄二 |\n| 示範 | 內容 |\n```\n'), GREEN_SPEC, 0),
        # 🔴 這一格原本餵在【板】側, 而那個輸入對壞掉的切法**也是綠的** ⇒ 恆綠、零判別力
        #    (2026-08-25 突變矩陣 M10 抓到:拿掉跳脫豎線處理 ⇒ 一格都不紅)。
        #    改餵在【spec】側:跳脫豎線放在「能力」欄 ⇒ 切法一壞, 狀態欄就讀到別的字 ⇒ 誤擋。
        ('⑰該綠必綠 · 跳脫豎線不得位移欄位(切法一壞這格就誤擋)', GREEN_BOARD,
         _spec('| 9 | 能力 \\| 別名 | ✅ | 量過 |\n'), 0),
        # ── R2 加的六格。每一格對應一個【R1/R2 突變存活】的缺口 ──────────────
        ('⑱該綠必綠 · 態=done 而事欄寫「已結掉」⇒ 不得抓(規則② 只管 open/doing)',
         _pad('| done | — | ✅ **這件已結掉** | — | x |\n'), GREEN_SPEC, 0),
        ('⑲該綠必綠 · 內文有「已」而不是那四個詞 ⇒ 不得抓(字集放寬會誤擋)',
         _pad('| open | — | 已下單、已到貨、已通知 | — | 都還沒收工 |\n'), GREEN_SPEC, 0),
        ('⑳該紅必紅 · spec 狀態欄【空白】(docstring 自稱會出聲, 而它曾零格覆蓋)',
         GREEN_BOARD, _spec('| 9 | 沒填狀態的 |  | 量過 |\n'), 1),
        ('㉑該紅必紅 · spec 側列數低於地板 ⇒ 判量具失效(不是 rc=1 也不是 rc=0)',
         GREEN_BOARD,
         '### §1-A-1 ✅ 現在做得到\n| # | 能力 | 狀態 | 量法 |\n|---|---|---|---|\n'
         + ''.join(f'| {i} | 能力 {i} | ✅ | 量過 |\n' for i in range(2, 6)),
         '量具失效:SPEC_ROW_FLOOR'),
        # ── R2 突變矩陣第二輪:A3/A4/A8/A9 四發【零格紅】⇒ 這四格是為它們補的 ──────
        ('㉒該綠必綠 · fence【關掉之後】的列要回來(只開不關的話它們會消失)',
         _pad()[:_pad().index('| open | — | 乾淨列 20')]
         + '```\n| 欄一 | 欄二 |\n```\n'
         + ''.join(f'| open | — | fence 之後的列 {i} | 待派 | x |\n' for i in range(20, 60)),
         GREEN_SPEC, 0),
        ('㉓該紅必紅 · 態欄多一個空白 ⇒ 板子的 grep 認不得它(①b 的【少數】方向)',
         _pad('| open  | — | 態欄多一個空白 | — | x |\n'), GREEN_SPEC, 1),
        # 🔴 期望值是 rc=1 而我原本寫 0 —— **又一次是我的期望值錯, 不是碼錯。**
        #    節外那張表:本工具**不算它**(rows 不變), 而板子那條 grep **會算它**(grep_n +1)
        #    ⇒ ①b 兩個數字對不上 ⇒ 紅, 而**那是真的 finding**:
        #      板子那條數法會把節外的表算進「還剩幾件」。
        #    ⇒ 這一格同時是【節範圍】的證人:節範圍一失效, 兩邊都算它 ⇒ 數字又相等 ⇒ 綠。
        #    🔴 那一列**刻意不帶結案字樣** —— 帶了的話規則② 會接住它, 這一格就分不出節範圍壞沒壞
        #       (2026-08-25 突變矩陣實測:帶結案字樣時 A9 零格紅)。
        ('㉔該紅必紅 · 節【外面】的表會讓板子的數法多數一列(也是節範圍的證人)',
         _pad() + '\n## 附錄(是 ## 開頭但沒有 ` · ` ⇒ 不是資料節)\n'
         '| 態 | # | 事 | 誰 | 卡什麼 |\n|---|---|---|---|---|\n'
         '| open | — | 節外的一列(刻意不帶結案字樣) | — | x |\n',
         GREEN_SPEC, 1),
        # ── codex NO-GO 那一輪補的九格(F1-F6, F12)────────────────────────
        ('㉕該綠必綠 · doing / parked 是封閉集成員(拿掉任一個成員這格就誤擋)',
         _pad('| doing | — | 在做的 | — | x |\n| parked | — | 擱著的 | — | **等時機:**在等外部事件 |\n'),
         GREEN_SPEC, 0),
        ('㉖該紅必紅 · 事欄寫「已關掉」(字集第 3 個詞的證人)',
         _pad('| open | — | 這件**已關掉**了 | — | x |\n'), GREEN_SPEC, 1),
        ('㉗該紅必紅 · 事欄寫「已完成」(字集第 4 個詞的證人)',
         _pad('| open | — | 這件**已完成** | — | x |\n'), GREEN_SPEC, 1),
        ('㉘該紅必紅 · 態=doing 而自稱做完(規則② 的 doing 分支證人)',
         _pad('| doing | — | 這件**已完成** | — | x |\n'), GREEN_SPEC, 1),
        ('㉙該綠必綠 · 態=parked 而寫「已完成」⇒ 不得抓(規則② 的邊界)',
         _pad('| parked | — | 這件**已完成** | — | **等時機:**在等外部事件 |\n'), GREEN_SPEC, 0),
        # ── 欠帳 7:否定 / 疑問語境(主視窗 2026-08-25 明令【分開各餵一發】,
        #    因為那兩種不是同一件事:否定是「它不成立」, 疑問是「還不知道成不成立」)──
        ('㊀該綠必綠 · 否定語境「不是已完成」⇒ 不得抓',
         _pad('| open | — | 這件**不是已完成**, 還在做 | — | x |\n'), GREEN_SPEC, 0),
        ('㊁該綠必綠 · 疑問語境「待確認是否已完成」⇒ 不得抓',
         _pad('| open | — | 待確認是否已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㊂該紅必紅 · 【對照組】真的自稱做完 ⇒ 仍要抓(否則上面兩格是恆綠的)',
         _pad('| open | — | 這件**已完成**了 | — | x |\n'), GREEN_SPEC, 1),
        ('㊃該綠必綠 · 否定出現在【後面欄位】的判決句裡也不得抓',
         _pad('| open | — | 一件事 | — | ✅ 上游說法是不是已結掉還要問 |\n'), GREEN_SPEC, 0),
        # 🔴 CONTEXT_BACK 的【上界證人】—— 往前看太多的話, 一個不相干的「不是」會把
        #    後面真正的宣稱吃掉。突變實測:改 999 ⇒ 沒有這一格的話一格都不紅。
        ('㊅該紅必紅 · 否定詞離得很遠 ⇒ 不算否定(往前看太多會吃掉真的宣稱)',
         _pad('| open | — | 這件不是上週報的那一件, 而它現在已完成 | — | x |\n'), GREEN_SPEC, 1),
        # ⚠️ **效度限定(主視窗 2026-08-25 明令照實標)**:下面這八格餵的是**我自己編的句子**。
        #    那八個標記在真板上**一個真實樣本都沒有**(族群 0)⇒ 它們證明的是
        #    「**這個字串會讓規則② 跳過**」, **不是**「真實世界裡那種寫法會被正確處理」。
        #    📌 **我編的句子驗我寫的規則 = 同一個腦。** 不要把這八格讀成「驗過了」。
        # 🔴 code-reviewer MF4:十個標記原本只有 `不是` 與 `是否` 兩個有證人
        #    (突變:清空成一個詞 ⇒ 零格紅)⇒ 其餘八個刪掉沒人會知道。逐個補。
        #    📌 而這正是同檔對 `DONE_WORDS` 已經套過的標準(㉖/㉗ 就是為此補的)——
        #       **我自己的標準在這裡沒套上。**
        ('㊆該綠必綠 · 否定標記「並非」', _pad('| open | — | 並非已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㊇該綠必綠 · 否定標記「不算」', _pad('| open | — | 這不算已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㊈該綠必綠 · 否定標記「不等於」', _pad('| open | — | 不等於已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㊉該綠必綠 · 否定標記「並不是」', _pad('| open | — | 並不是已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㋀該綠必綠 · 疑問標記「待確認」', _pad('| open | — | 待確認已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㋁該綠必綠 · 疑問標記「待驗」', _pad('| open | — | 待驗已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㋂該綠必綠 · 疑問標記「尚待確認」', _pad('| open | — | 尚待確認已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㋃該綠必綠 · 疑問標記「有沒有」', _pad('| open | — | 有沒有已完成 | — | x |\n'), GREEN_SPEC, 0),
        ('㊄該紅必紅 · 【對照組】同一欄位真的是判決句 ⇒ 仍要抓',
         _pad('| open | — | 一件事 | — | ✅ **2026-08-25 夜已結掉**:貼過了 |\n'), GREEN_SPEC, 1),
        ('㉚該綠必綠 · 【劃掉的】已完成不是宣稱(codex F12 的誤擋面)',
         _pad('| open | — | ~~原寫已完成~~ ⇒ 其實還在做 | — | x |\n'), GREEN_SPEC, 0),
        ('㉛該綠必綠 · 節內含多個豎線的【普通文字】不得被吃成資料列',
         _pad('\n用法:`a | b | c` 這樣寫。\n'), GREEN_SPEC, 0),
        ('㉜該紅必紅 · spec 列【欄位不足】(不是欄位空白, 是根本沒那一欄)',
         GREEN_BOARD, _spec('| 9 | 缺欄的\n'), 1),
        # ── codex 第二輪補的四格(F12 後段 / F13 / F14 / 對齊分隔列)──────────
        ('㉞該綠必綠 · 【後面欄位】裡劃掉的「已完成」也不算宣稱(F12 的另一半分支)',
         _pad('| open | — | 還在做 | — | ✅ ~~已完成~~,更正為尚未完成 |\n'), GREEN_SPEC, 0),
        ('㉟該綠必綠 · 對齊分隔列 `| :--- | ---: |` 不是資料列',
         _pad('| :--- | ---: | :---: | --- | --- |\n'), GREEN_SPEC, 0),
        ('㊱該紅必紅 · fence 只開不關 ⇒ 後面整段消失 ⇒ 要撞到分母地板',
         _pad()[:_pad().index('| open | — | 乾淨列 50')] + '```\n'
         + ''.join(f'| open | — | 乾淨列 {i} | 待派 | x |\n' for i in range(50, 60)),
         GREEN_SPEC, '量具失效:BOARD_ROW_FLOOR'),
    ]
    ok = True
    for name, b, s, want in cases:
        try:
            got = scan(w('b.md', b), w('s.md', s), quiet=True)
        except MeasurementError as e:
            got = f'量具失效:{e.code}'   # 🔴 codex R2:帶 code, 不然任何錯都能冒充「該失效」
        mark = '✅' if got == want else '🔴'
        if got != want:
            ok = False
        print(f'  {mark} {name}  期望 rc={want} 實得 rc={got}')

    # 🔴 rc 對 ≠ 訊息有用。M1(rule1 回 [])那一發 **rc 仍然是 1**(grep 那條路接住了),
    #    而訊息會說「一列態欄都沒錯」並把讀的人指向 fence / 豎線 —— **指錯方向**。
    #    ⇒ 這一格驗的是【輸出點不點得出那一列】, 不是 rc。
    #    📌 主視窗 2026-08-25 的意思是:一道印「有 N 列不對」的閘, 與一道印「哪 N 列不對」的閘,
    #       修復成本差一個數量級。⇒ 那個性質要有守門。
    #    ⚠️ **原句已隨 session 消失, repo 內 grep 不到**(`literal-sweep.sh` 全類別 0 命中)
    #       ⇒ 上面那兩行是**轉述不是逐字**, 不要當引文用。
    import contextlib as _ctx
    _buf = io.StringIO()
    with _ctx.redirect_stdout(_buf):
        try:
            scan(w('b.md', _pad('| ~~open~~ **半關** | — | 錯填的態欄 | — | x |\n')),
                 w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    _b2 = io.StringIO()
    with _ctx.redirect_stdout(_b2):
        try:
            scan(w('b.md', _pad('|  | — | 空態欄那一列 | — | x |\n')), w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    if '半關' in _buf.getvalue() and '①a' in _buf.getvalue():
        print('  ✅ 甲·訊息點名 · 錯填的那一列被【逐列點名】且掛在 ①a 底下')
    else:
        print('  🔴 甲·訊息點名 · rc 對而訊息沒點出那一列, 或沒掛在 ①a')
        ok = False
    # 🔴 空態欄那一列必須出現在 ①a 底下 —— 只靠 rc 分不出來(①b 也會因為它而紅)
    if '(空白)' in _b2.getvalue() and '①a' in _b2.getvalue():
        print('  ✅ 乙·空態欄 · 被 ①a 逐列點名為 (空白)(不是只靠 ①b 的數字差接住)')
    else:
        print('  🔴 乙·空態欄 · ①a 沒有點名它 ⇒ 它是被 ①b 的數字差【順便】接住的')
        ok = False

    # ㉘ 分母地板:掉一整節(而不是歸零)也要判量具失效
    try:
        scan(w('b.md', _pad()[:_pad().index('| open | — | 乾淨列 30')]), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 丙·分母地板 · 列數掉到地板以下而它印了通過')
        ok = False
    except RuntimeError:
        print('  ✅ 丙·分母地板 · 列數低於地板 ⇒ 判量具失效(不判通過)')

    # ㉙ 欄位標題驗證:狀態欄改名 / 移位 ⇒ 判量具失效, 不得靜靜全綠
    try:
        scan(w('b.md', GREEN_BOARD),
             w('s.md', _spec().replace('| # | 能力 | 狀態 | 量法 |', '| 項 | 能力 | 狀態 | 量法 |')),
             quiet=True)
        print('  🔴 丁·欄位標題 · 標題改了而它靜靜跑完')
        ok = False
    except RuntimeError:
        print('  ✅ 丁·欄位標題 · 找不到預期的表頭 ⇒ 判量具失效')

    # ㉚ 讀不到檔:訊息要點名那支檔(rc=2 那條路)
    try:
        scan(os.path.join(d, 'no-such.md'), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 戊·檔不存在時沒有出聲')
        ok = False
    except RuntimeError as e:
        if 'no-such.md' not in str(e):
            print(f'  🔴 戊·訊息沒點名那支檔:{e}')
            ok = False
        else:
            print('  ✅ 戊·檔不存在 ⇒ RuntimeError 且點名該檔(呼叫端轉 rc=2, 與 finding 的 rc=1 分得開)')

    # ㉛ grep 那一半:板子的數法與資料列數【各自量】, 不是同一個變數推出來的
    b2 = _pad('| open | — | 這一列的態欄在封閉集裡 | — | x |\n')
    p = w('b.md', b2)
    if board_grep_count(p) == 0:
        print('  🔴 己·board_grep_count 對一份有 open 列的板子回 0 ⇒ 它沒在跑')
        ok = False
    else:
        print(f'  ✅ 己·board_grep_count 真的在跑(該板 ⇒ {board_grep_count(p)})')

    # ㉝ grep 自己出錯(rc>1)要判量具失效, 不得回 0 而被讀成「板子少數了 N 列」。
    #    🔴 這一格是【單元級】的:整支 scan() 走不到這裡(io.open 會先炸)⇒ 直接餵 board_grep_count。
    try:
        board_grep_count(d)  # 目錄不是檔 ⇒ grep 回 rc=2
        print('  🔴 庚·grep rc · grep 對目錄回錯而它沒出聲 ⇒ 會回 0 並被讀成「少數了 N 列」')
        ok = False
    except RuntimeError:
        print('  ✅ 庚·grep rc · grep 自己出錯 ⇒ 判量具失效(不是回 0 假裝零命中)')

    # ㉝b 🔴 grep 的【第二條壞法】:rc=0 而輸出不是態欄。**全文在 `board_grep_count()` 的註解裡**, 不在這裡複述。
    #     🔴 這一格【必須有該綠的那一半】:誤擋比漏擋更會殺死一道閘。
    _nulb = os.path.join(d, 'nul-board.md')
    _cleanb = os.path.join(d, 'clean-board.md')
    _rowbytes = b'| open | x | a | y | z |\n| done | x | b | y | z |\n| open | x | c | y | z |\n'
    # 🔴 不叫 `_rows` —— 模組層 :182 有個函式叫 `_rows()`, 同名會在 selftest 這個 scope 遮蔽它
    #    ⇒ 今天不會炸(這裡沒呼叫它), 而下一個在 selftest 裡加一行 `_rows(...)` 的人會拿到 UnboundLocalError。
    with open(_cleanb, 'wb') as _f:
        _f.write(_rowbytes)
    with open(_nulb, 'wb') as _f:
        _f.write(_rowbytes[:30] + b'\x00' + _rowbytes[30:])
    try:
        _n = board_grep_count(_nulb)
        print(f'  🔴 庚b·grep 二號壞法 · 含 NUL 的板子回 {_n} 而沒出聲'
              f' ⇒ 會被讀成「板子少數了 N 列」, 有人會去找不存在的列')
        ok = False
    except MeasurementError as _e:
        if _e.code == 'GREP_GARBAGE':
            print('  ✅ 庚b·grep 二號壞法 · rc=0 而輸出不是態欄 ⇒ 判量具失效(指向量具, 不是板子)')
        else:
            print(f'  🔴 庚b·grep 二號壞法 · 拋了 {_e.code}, 期望 GREP_GARBAGE ⇒ 紅錯地方')
            ok = False
    # 該綠的那一半:乾淨的板子不得被這道新守門誤擋
    try:
        _n2 = board_grep_count(_cleanb)
        if _n2 == 3:
            print('  ✅ 庚b·該綠真的綠 · 乾淨板子照常數到 3(新守門沒有誤擋)')
        else:
            print(f'  🔴 庚b·該綠真的綠 · 乾淨板子數到 {_n2}, 期望 3')
            ok = False
    except MeasurementError as _e:
        print(f'  🔴 庚b·該綠真的綠 · 乾淨板子被誤擋:{_e.code}')
        ok = False

    # ㉝c 🔴 第三條入口:rc=0 而【零輸出】。用 PATH shim 造一支「回 0 卻不印東西」的 grep。
    #     這一格釘的是「不賭 grep 把訊息印到哪」那個判準本身。
    _shimd = os.path.join(d, 'shim-quiet')
    os.makedirs(_shimd, exist_ok=True)
    with open(os.path.join(_shimd, 'grep'), 'w') as _f:
        _f.write('#!/bin/sh\nexit 0\n')
    os.chmod(os.path.join(_shimd, 'grep'), 0o755)
    _saved = os.environ.get('PATH', '')
    try:
        os.environ['PATH'] = _shimd + os.pathsep + _saved
        try:
            _n3 = board_grep_count(_cleanb)
            print(f'  🔴 庚c·rc=0 零輸出 · 回 {_n3} 而沒出聲 ⇒ 會被讀成「板子零命中」')
            ok = False
        except MeasurementError as _e:
            if _e.code == 'GREP_GARBAGE':
                print('  ✅ 庚c·rc=0 零輸出 · 判量具失效(不賭訊息印到 stdout 還是 stderr)')
            else:
                print(f'  🔴 庚c·rc=0 零輸出 · 拋了 {_e.code}, 期望 GREP_GARBAGE')
                ok = False
    finally:
        os.environ['PATH'] = _saved

    # ㉝e 🔴 `_STATE_CELL` 必須 escape —— 否則 CLOSED 新增一個含 regex 元字元的值時,
    #     grep 撈不到那一列、而形狀檢查 fullmatch **也一起漏** ⇒ 兩邊同時瞎掉,
    #     又回到「板子少數了 N 列」= 本片要消滅的那個紅錯地方。
    #     這一格不動真的 CLOSED, 只驗【組法】本身。
    #     🔴 打的是【本檔真的那個組法】`_state_cell()`, 不是照抄一份 ——
    #     第一版就是照抄, 而拿掉 re.escape 之後那一格【照樣全綠】(我突變實測到的)。
    if re.fullmatch(_state_cell(('open', 'wip?')), '| wip? |'):
        print('  ✅ 庚e·escape · 含元字元的態欄值配得到 ⇒ _state_cell 有 escape')
    else:
        print('  🔴 庚e·escape · `wip?` 這種值配不到 ⇒ _state_cell 少了 re.escape'
              ' ⇒ grep 與 fullmatch 會【同時】漏掉那一列, 又回到「板子少數了 N 列」')
        ok = False
    if re.fullmatch(_state_cell(('open',)), '| XXXX |'):
        print('  🔴 庚e·負對照 · 不該配的也配上了 ⇒ 這一格零判別力')
        ok = False
    #     🔴 上面兩發只打了 **python 的 `re`** 那一半, 而 `re.escape` 產的是 Python flavour,
    #     真正拿去跑的是 **grep 的 POSIX ERE** ⇒ 兩邊對 `\?` `\#` `\&` 的處理不保證一樣。
    #     ⇒ 這一發把同一條 regex 真的餵給 grep, 兩半才都被打到。
    _ecell = _state_cell(('open', 'wip?'))
    _et = os.path.join(d, 'escape-probe.md')
    io.open(_et, 'w', encoding='utf-8').write('| wip? |\n| open |\n')
    _er = subprocess.run(['grep', '-oE', _ecell, _et],
                         capture_output=True, text=True, env=_grep_env())
    _elines = [x for x in _er.stdout.split('\n') if x.strip()]
    if _elines == ['| wip? |', '| open |']:
        print('  ✅ 庚e·grep 那一半 · escape 後的 regex 餵給【真的 grep】也撈得到 wip?')
    else:
        print(f'  🔴 庚e·grep 那一半 · grep 撈到 {_elines!r}, 期望 [\'| wip? |\', \'| open |\']'
              f' ⇒ python 的 escape 與 POSIX ERE 對不上(rc={_er.returncode})')
        ok = False

    # ㉝f 🔴 **staged 那條路(走 `input=` + stdin)在此之前【一個證人都沒有】**(R2 審查指出)——
    #     庚b/庚c/庚d 全部只打 `staged=False`。而兩條路餵給 grep 的方式不同
    #     (一條給檔名、一條給 stdin)⇒ **「檔案那條擋得住」證不了「stdin 那條也擋得住」。**
    _sgw = tempfile.mkdtemp()
    os.makedirs(os.path.join(_sgw, os.path.dirname(BOARD)), exist_ok=True)
    _sgb = os.path.join(_sgw, BOARD)
    with open(_sgb, 'wb') as _f:
        _f.write(_rowbytes[:30] + b'\x00' + _rowbytes[30:])
    _sgok = True
    for _c in (['git', 'init', '-q'], ['git', 'config', 'user.email', 't@t'],
               ['git', 'config', 'user.name', 't'], ['git', 'add', '-A']):
        if subprocess.run(_c, cwd=_sgw, capture_output=True,
                          env=_GIT_FREE_ENV).returncode != 0:
            print(f'  🔴 庚f·staged 路 · fixture 建置失敗:{_c} ⇒ 量具失效, 不判通過')
            ok = False
            _sgok = False
            break
    if _sgok:
        _cwd = os.getcwd()
        # 🔴 `read_source(staged=True)` 裡那發 `git show :<path>` **沒有帶 `_GIT_FREE_ENV`**
        #    ⇒ 它會繼承外面的 `GIT_DIR` / `GIT_INDEX_FILE`
        #    ⇒ 本格在【寅卯b 那一發帶著 GIT_DIR 跑整支 selftest】時, 會去讀【別人的 index】
        #      ⇒ 拋 NOT_IN_INDEX 而不是 GREP_GARBAGE(我第一版就是這樣紅的, 而外層那發是綠的
        #        ⇒ **手動跑綠、在隔離 harness 底下紅**, 正是本檔 :20 那段出生事故的同一個形狀)。
        #    ⇒ 這裡自己剝乾淨, 跑完還原。
        _savedgit = {k: v for k, v in os.environ.items() if k.startswith('GIT_')}
        try:
            for _k in _savedgit:
                os.environ.pop(_k, None)
            os.chdir(_sgw)
            try:
                _n5 = board_grep_count(BOARD, staged=True)
                print(f'  🔴 庚f·staged 路 · index 裡含 NUL 的板子回 {_n5} 而沒出聲'
                      f' ⇒ stdin 那條路沒有被這道守門蓋到')
                ok = False
            except MeasurementError as _e:
                if _e.code == 'GREP_GARBAGE':
                    print('  ✅ 庚f·staged 路 · 走 stdin 也判量具失效(不是只有檔案那條擋得住)')
                else:
                    print(f'  🔴 庚f·staged 路 · 拋了 {_e.code}, 期望 GREP_GARBAGE')
                    ok = False
        finally:
            os.chdir(_cwd)
            os.environ.update(_savedgit)

    # ㉝d 🔴 該綠真的綠(第二個):`GREP_OPTIONS` 設了也不得誤擋乾淨的板子。
    #     這是**本片新引入的誤擋路徑**(R1 審查實測), 所以它需要自己的證人。
    _saved2 = os.environ.get('GREP_OPTIONS')
    try:
        os.environ['GREP_OPTIONS'] = '-H'
        _n4 = board_grep_count(_cleanb)
        if _n4 == 3:
            print('  ✅ 庚d·GREP_OPTIONS · 設了 -H 仍照常數到 3(env 有被洗掉, 沒有誤擋)')
        else:
            print(f'  🔴 庚d·GREP_OPTIONS · 數到 {_n4}, 期望 3')
            ok = False
    except MeasurementError as _e:
        print(f'  🔴 庚d·GREP_OPTIONS · 乾淨板子被誤擋:{_e.code} ⇒ 被誤擋的人會繞過這道閘')
        ok = False
    finally:
        if _saved2 is None:
            os.environ.pop('GREP_OPTIONS', None)
        else:
            os.environ['GREP_OPTIONS'] = _saved2

    # 子 🔴 codex R2:F13 與 F14 **只改了行為與字面, 沒有任何一格在看訊息**
    #    ⇒ 改回「固定印事欄」或「過度推論的舊文案」, 44 格照樣全綠。這兩格補那個缺口。
    _b3 = io.StringIO()
    with _ctx.redirect_stdout(_b3):
        try:
            scan(w('b.md', _pad('| open | — | 一件事 | — | ✅ **已結掉** |\n')),
                 w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    _o3 = _b3.getvalue()
    if '第 5 欄' in _o3 and '已結掉' in _o3:
        print('  ✅ 子·規則②訊息 · 點名【命中在第幾欄】與【哪個詞】(不是固定印事欄)')
    else:
        print('  🔴 子·規則②訊息 · 沒點名命中欄位/詞 ⇒ 人會被指向一個沒問題的欄')
        ok = False

    _b4 = io.StringIO()
    with _ctx.redirect_stdout(_b4):
        try:
            scan(w('b.md', _pad('```\n| open | — | 示範 | — | x |\n```\n')), w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    if '候選' in _b4.getvalue():
        print('  ✅ 丑·①b 訊息 · 成因標成【候選】不是結論(codex F14)')
    else:
        print('  🔴 丑·①b 訊息 · 把候選成因寫成結論 ⇒ 過度推論')
        ok = False

    _b5 = io.StringIO()
    with _ctx.redirect_stdout(_b5):
        try:
            scan(w('b.md', GREEN_BOARD), w('s.md', _spec('| 9 | 坐錯表的 | 🟡 | 量過 |\n')))
        except MeasurementError:
            pass
    if '不等於' in _b5.getvalue():
        print('  ✅ 寅·③ 訊息 · 「另有說法不等於做不完整」那句在(codex F14)')
    else:
        print('  🔴 寅·③ 訊息 · 把「非純 ✅」直接說成「做不完整」⇒ 過度推論')
        ok = False

    # 壬 🔴 codex F6:rc=0 與 rc=1 這兩條也要真的走過 `__main__`。
    #    只驗 rc=2 的話, 把 `sys.exit(scan())` 改成裸 `scan()` ⇒ finding 會靜靜 exit 0。
    _here = os.path.abspath(__file__)
    _cases = [(GREEN_BOARD, GREEN_SPEC, 0, '乾淨'),
              (_pad('| ~~open~~ **半關** | — | 錯填 | — | x |\n'), GREEN_SPEC, 1, '有 finding')]
    for _b, _s, _want, _lbl in _cases:
        _d2 = tempfile.mkdtemp()
        io.open(os.path.join(_d2, 'docs'), 'w')  # 佔位, 讓相對路徑一定不存在
        os.remove(os.path.join(_d2, 'docs'))
        os.makedirs(os.path.join(_d2, 'docs', 'specs'), exist_ok=True)
        io.open(os.path.join(_d2, BOARD), 'w', encoding='utf-8').write(_b)
        io.open(os.path.join(_d2, SPEC), 'w', encoding='utf-8').write(_s)
        _r = subprocess.run([sys.executable, _here], cwd=_d2, capture_output=True, text=True, env=_GIT_FREE_ENV)
        if _r.returncode == _want:
            print(f'  ✅ 壬·rc 對應表 · {_lbl} fixture ⇒ 子程序真的 exit {_want}')
        else:
            print(f'  🔴 壬·rc 對應表 · {_lbl} fixture ⇒ exit {_r.returncode}(該是 {_want})')
            ok = False

    # ══ partial-staging 整合測試(codex 兩輪都咬的那一條)══════════════════
    # 🔴 這兩格是【真的建一個 git repo】跑的, 不是 fixture 字串。
    #    因為它們要問的正是「index 那一份與工作樹那一份不同時, 它讀哪一份」。
    DIRTY = _pad('| ~~open~~ **半關** | — | 工作樹上的髒東西 | — | x |\n')

    def _git_world(staged_text, worktree_text):
        w = tempfile.mkdtemp()
        os.makedirs(os.path.join(w, 'docs', 'specs'), exist_ok=True)
        bp = os.path.join(w, BOARD)
        io.open(bp, 'w', encoding='utf-8').write(staged_text)
        io.open(os.path.join(w, SPEC), 'w', encoding='utf-8').write(GREEN_SPEC)
        for cmd in (['git', 'init', '-q'], ['git', 'config', 'user.email', 't@t'],
                    ['git', 'config', 'user.name', 't'], ['git', 'add', '-A']):
            if subprocess.run(cmd, cwd=w, capture_output=True,
                              env=_GIT_FREE_ENV).returncode != 0:
                raise RuntimeError(f'fixture 建置失敗:{cmd}')
        io.open(bp, 'w', encoding='utf-8').write(worktree_text)   # 只改工作樹, 不 stage
        return w

    for label, staged_text, wt_text, want_staged, want_worktree in [
        ('①staged 乾淨而工作樹髒 ⇒ --staged 必須【放行】(讀工作樹會誤擋)',
         GREEN_BOARD, DIRTY, 0, 1),
        ('②staged 髒而工作樹已修 ⇒ --staged 必須【擋】(讀工作樹會放行 ← 比誤擋更糟)',
         DIRTY, GREEN_BOARD, 1, 0),
    ]:
        try:
            w = _git_world(staged_text, wt_text)
        except RuntimeError as e:
            print(f'  🔴 partial-staging · fixture 壞了:{e}')
            ok = False
            continue
        _here2 = os.path.abspath(__file__)
        # 🔴 **這兩發也要濾掉 `GIT_*`。** 2026-08-25 實測:在 pre-commit 底下(`GIT_DIR` 指著真 repo)
        #    子程序會拿真 repo 的 index 去回答, 而不是這個拋棄式世界的
        #    ⇒ ②「staged 髒而工作樹已修 ⇒ 該擋」變成 rc=0 ⇒ **只有在 pre-commit 底下才紅。**
        #    📌 而先前那一版**只驗了「它不會弄壞別人」, 沒驗「它在那個環境底下跑得起來」** ——
        #       那是兩個宣稱。
        r_s = subprocess.run([sys.executable, _here2, '--staged'], cwd=w,
                             capture_output=True, text=True, env=_GIT_FREE_ENV)
        r_w = subprocess.run([sys.executable, _here2], cwd=w,
                             capture_output=True, text=True, env=_GIT_FREE_ENV)
        good = r_s.returncode == want_staged
        print(('  ✅ ' if good else '  🔴 ') +
              f'partial-staging {label} ⇒ --staged rc={r_s.returncode}(期望 {want_staged})')
        if not good:
            ok = False
        # 🔴 對照組:同一個世界【不帶 --staged】必須印出【不同的】答案。
        #    兩邊一樣的話, 這兩格對「它讀哪一份」零判別力。
        if r_w.returncode == want_worktree:
            print(f'      ✅ 對照:不帶 --staged rc={r_w.returncode} ⇒ 兩個模式真的讀到不同的東西')
        else:
            print(f'      🔴 對照:不帶 --staged rc={r_w.returncode}(期望 {want_worktree})'
                  f' ⇒ 兩個模式讀到一樣的東西 ⇒ 上面那一格沒有判別力')
            ok = False

    # 🔴 這一格單獨釘 `board_grep_count` 那條路。上面兩格對它零判別力:
    #    它們的工作樹版與 index 版**grep 數剛好相同** ⇒ 讀哪一份都印同一個答案。
    #    這裡讓工作樹**多一列乾淨的 `| open |`** ⇒ 工作樹的 grep 是 61、index 是 60,
    #    而 rows 讀 index = 60 ⇒ 若 grep 去讀工作樹, ①b 就會誤報「差 1」。
    try:
        w = _git_world(GREEN_BOARD, _pad('| open | — | 只在工作樹上的一列 | 待派 | x |\n'))
        r = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'],
                           cwd=w, capture_output=True, text=True, env=_GIT_FREE_ENV)
        if r.returncode == 0:
            print('  ✅ 子丑·grep 同源 · --staged 時板子的數法也讀 index(不是工作樹)')
        else:
            print(f'  🔴 子丑·grep 同源 · rc={r.returncode}(該是 0)'
                  f' ⇒ 兩個數來自不同的檔, 它們相等或不等都沒有意義')
            ok = False
    except RuntimeError as e:
        print(f'  🔴 子丑·grep 同源 · fixture 壞了:{e}')
        ok = False

    # ══ 工作樹漂移那一行:【四個世界】各表演一次(2026-09-01 加)═══════════════
    # 🔴 **這一組守的不是「它會不會叫」, 是【它在兩個世界印不同的字】。**
    #    成因見 `worktree_differs` 的 docstring:那行「讀自 index」原本在
    #    【我 add 了】與【我沒 add】**逐字相同** ⇒ 而那正是它可以被跳過的原因。
    #    ⇒ 📌 所以「乾淨時不得出現那一塊」與「髒時必須出現」**兩格缺一不可** ——
    #      只驗前者 = 一個永遠沉默的守門;只驗後者 = 一個對常態發的警報。
    MARK = '工作樹上還有沒 stage 的改動'
    SAME = '與工作樹相同'

    def _mm_world():
        """`MM` 那一種:index 與 HEAD 不同, **而且**工作樹與 index 也不同。
           🔴 哨兵點名它是第三種形狀, 而它最陰險:閘看到的是【中間那一份】。"""
        w = _git_world(GREEN_BOARD, GREEN_BOARD)  # 先做出一個乾淨世界
        bp = os.path.join(w, BOARD)
        for cmd in (['git', 'commit', '-q', '-m', 'base'],):
            subprocess.run(cmd, cwd=w, capture_output=True, env=_GIT_FREE_ENV)
        io.open(bp, 'w', encoding='utf-8').write(GREEN_BOARD + _pad('| open | — | staged 那一份多的 | 待派 | x |\n'))
        subprocess.run(['git', 'add', BOARD], cwd=w, capture_output=True, env=_GIT_FREE_ENV)
        io.open(bp, 'w', encoding='utf-8').write(GREEN_BOARD + _pad('| open | — | 只在工作樹上的 | 待派 | x |\n'))
        return w

    for label, mk, args, want_mark, want_same in [
        ('①乾淨(staged == 工作樹)⇒ **不得**出現那一塊, 而標題要寫「與工作樹相同」',
         lambda: _git_world(GREEN_BOARD, GREEN_BOARD), ['--staged'], False, True),
        ('②只有工作樹髒(add 之後又改)⇒ **必須**出現那一塊',
         lambda: _git_world(GREEN_BOARD, GREEN_BOARD + _pad('| open | — | 只在工作樹 | 待派 | x |\n')),
         ['--staged'], True, False),
        ('③`MM`(index 與 HEAD 不同, 工作樹又與 index 不同)⇒ **必須**出現那一塊',
         _mm_world, ['--staged'], True, False),
        ('④負對照:**不帶 --staged** ⇒ 它讀工作樹 ⇒ 那一塊【不得】出現',
         lambda: _git_world(GREEN_BOARD, GREEN_BOARD + _pad('| open | — | 只在工作樹 | 待派 | x |\n')),
         [], False, False),
    ]:
        try:
            w = mk()
        except RuntimeError as e:
            print(f'  🔴 工作樹漂移 {label} · fixture 壞了:{e}')
            ok = False
            continue
        r = subprocess.run([sys.executable, os.path.abspath(__file__)] + args,
                           cwd=w, capture_output=True, text=True, env=_GIT_FREE_ENV)
        got_mark = MARK in r.stdout
        got_same = SAME in r.stdout
        good = (got_mark == want_mark) and (got_same == want_same)
        print(('  ✅ ' if good else '  🔴 ') +
              f'工作樹漂移 {label} ⇒ 那一塊={got_mark}(期望 {want_mark})· '
              f'「{SAME}」={got_same}(期望 {want_same})')
        if not good:
            ok = False

    # 🔴🔴 **這一格是那場事故的證人。** 它把 `GIT_DIR` / `GIT_INDEX_FILE` 指到一個
    #    拋棄式 repo(= pre-commit 執行時的環境形狀), 跑一次本檔的 selftest,
    #    然後**數那個 repo 的 index 還在不在**。
    #    📌 沒有這一格的話, 「有沒有污染真 index」與「沒有」在輸出上**一模一樣**。
    # 🔴 **這一格會再跑一次完整 selftest ⇒ 它自己會無限遞迴。**
    #    內層那一發帶 `BSC_SKIP_ISOLATION_CELL=1` 讓它跳過本格。
    #    ⚠️ 而那個旗標本身是一個【可以讓守門靜靜消失】的東西 ⇒ 只在這裡讀, 別處不得用。
    #    (2026-08-25 實測:沒有它 ⇒ selftest 跑不完, 120 秒逾時。)
    if os.environ.get('BSC_SKIP_ISOLATION_CELL') == '1':
        print('  ⏭  寅卯·GIT 環境隔離 · 內層跑, 跳過(避免無限遞迴)')
        _vic = None
    else:
        _vic = tempfile.mkdtemp()
        _clean = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        for _c in (['git', 'init', '-q'], ['git', 'config', 'user.email', 'v@v'],
                   ['git', 'config', 'user.name', 'v']):
            subprocess.run(_c, cwd=_vic, capture_output=True, env=_clean)
        for _i in range(3):
            io.open(os.path.join(_vic, f'f{_i}.txt'), 'w').write('x')
        subprocess.run(['git', 'add', '-A'], cwd=_vic, capture_output=True, env=_clean)
        subprocess.run(['git', 'commit', '-qm', 'base'], cwd=_vic, capture_output=True, env=_clean)

        def _victim_files():
            r = subprocess.run(['git', 'ls-files'], cwd=_vic, capture_output=True,
                               text=True, env=_clean)
            return len([x for x in r.stdout.split('\n') if x.strip()])

        _before = _victim_files()
        _polluted = dict(os.environ)
        _polluted['GIT_DIR'] = os.path.join(_vic, '.git')
        _polluted['GIT_INDEX_FILE'] = os.path.join(_vic, '.git', 'index')
        # 🔴 **刻意【不設】`GIT_WORK_TREE`** —— pre-commit 匯出的是 `GIT_DIR` 與 `GIT_INDEX_FILE`,
        #    而**不是** work tree。設了它反而讓這一格失去判別力(2026-08-25 突變實測:
        #    設了 ⇒ 拿掉隔離也不紅)。真正的失效機制是:
        #    有 GIT_DIR 而沒有 GIT_WORK_TREE ⇒ git 把 **cwd** 當工作樹
        #    ⇒ `git add -A` 在一個空目錄裡 ⇒ **把 index 裡所有檔 stage 成刪除**。
        _inner = subprocess.run(
            [sys.executable, os.path.abspath(__file__), '--selftest'],
            cwd=tempfile.mkdtemp(), capture_output=True, text=True,
            env={**_polluted, 'BSC_SKIP_ISOLATION_CELL': '1'})
        _after = _victim_files()
        # 🔴 **兩個宣稱, 分開驗**(2026-08-25 主視窗指出, 而它是對的):
        #    ① 它不會弄壞別人(index 沒被動)  ② **它在那個環境底下跑得完**(內層 rc=0)
        #    先前這一格只驗了 ①, 而 ② 掛掉了 —— 症狀是「手動跑過、pre-commit 底下沒過」。
        if _inner.returncode != 0:
            print(f'  🔴 寅卯b·在 GIT_DIR 環境底下【跑不完】· 內層 rc={_inner.returncode}'
                  ' ⇒ 收這一包的人會撞到, 而手動跑是綠的')
            for _l in (_inner.stdout + _inner.stderr).split('\n'):
                if _l.startswith('  🔴'):
                    print('        ' + _l.strip()[:110])
            ok = False
        else:
            print('  ✅ 寅卯b·在 GIT_DIR 環境底下跑得完(內層 rc=0)')
        if _before == 3 and _after == 3:
            print('  ✅ 寅卯·GIT 環境隔離 · 被 GIT_DIR 指著跑一次 selftest ⇒ 那個 repo 的 index 沒被動'
                  f'(前 {_before} / 後 {_after})')
        elif _before != 3:
            print(f'  🔴 寅卯·GIT 環境隔離 · fixture 壞了(前 {_before} 該是 3)⇒ 量具失效, 不判通過')
            ok = False
        else:
            print(f'  🔴 寅卯·GIT 環境隔離 · index 被動了(前 {_before} → 後 {_after})'
                  ' ⇒ 它會在別人的 pre-commit 裡刪掉整個 repo')
            ok = False

    # ══ code-reviewer MF2:`--staged` 帶進來的四條錯誤路徑【原本全部零證人】════
    #    三條路本身是通的(實測過), 而**沒有一格在看它們** ⇒ 拿掉判斷、或把 code 字串
    #    改成別的字, selftest 一格都不紅。
    #    🔴 而這裡驗的是 **`.code`**, 不是「有沒有丟 MeasurementError」——
    #       檔頭 `MeasurementError` 的 docstring 自己寫著「帶 code 才分得開」, 而沒有一格在用它。
    # 🔴 code-reviewer n1:`w` 這個名字在本函式中途被 `w = _git_world(…)` 蓋成 **str**
    #    ⇒ 在它之後呼叫 `w(...)` 會 `TypeError`。我就踩了一次。
    #    ⇒ 自己開一個不會被蓋的名字。
    def _mkf(name, text):
        pp = os.path.join(d, name)
        io.open(pp, 'w', encoding='utf-8').write(text)
        return pp

    def _mk_git_repo(board_text=None, spec_text=None, add=True):
        w = tempfile.mkdtemp()
        os.makedirs(os.path.join(w, 'docs', 'specs'), exist_ok=True)
        if board_text is not None:
            io.open(os.path.join(w, BOARD), 'w', encoding='utf-8').write(board_text)
        if spec_text is not None:
            io.open(os.path.join(w, SPEC), 'w', encoding='utf-8').write(spec_text)
        for c in (['git', 'init', '-q'], ['git', 'config', 'user.email', 'e@e'],
                  ['git', 'config', 'user.name', 'e']):
            subprocess.run(c, cwd=w, capture_output=True, env=_GIT_FREE_ENV)
        if add:
            subprocess.run(['git', 'add', '-A'], cwd=w, capture_output=True, env=_GIT_FREE_ENV)
        return w

    def _code_of(cwd, env=None):
        """在子程序裡跑 --staged, 從 stderr 抓 [CODE]。"""
        r = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'],
                           cwd=cwd, capture_output=True, text=True,
                           env=env or _GIT_FREE_ENV)
        # 🔴 原本寫 `[A-Z_]+` ⇒ **撈不到 `NOT_UTF8`(裡面有數字 8)**。
        #    而它的症狀是「code=(沒有 code)」—— 看起來像**程式沒帶 code**, 實際是**尺不認得那個 code**。
        #    📌 兩個世界印同一句話:真的沒帶 code / 帶了而我的尺讀不到。
        m = re.search(r'\[([A-Z0-9_]+)\]', r.stderr + r.stdout)
        return r.returncode, (m.group(1) if m else '(沒有 code)')

    # 甲乙 NOT_IN_INDEX:檔在工作樹而【沒 add】
    _w = _mk_git_repo(GREEN_BOARD, GREEN_SPEC, add=False)
    _rc, _code = _code_of(_w)
    if _rc == 2 and _code == 'NOT_IN_INDEX':
        print('  ✅ 甲乙·NOT_IN_INDEX · 檔沒進 index ⇒ rc=2 且 code 對')
    else:
        print(f'  🔴 甲乙·NOT_IN_INDEX · rc={_rc} code={_code}(該是 2 / NOT_IN_INDEX)')
        ok = False

    # 丙丁 NOT_UTF8:index 那份不是 UTF-8
    _w = _mk_git_repo(GREEN_BOARD, GREEN_SPEC, add=False)
    open(os.path.join(_w, BOARD), 'wb').write(b'## A \xb7 \xff\xfe\n')
    subprocess.run(['git', 'add', '-A'], cwd=_w, capture_output=True, env=_GIT_FREE_ENV)
    _rc, _code = _code_of(_w)
    if _rc == 2 and _code == 'NOT_UTF8':
        print('  ✅ 丙丁·NOT_UTF8 · index 那份不是 UTF-8 ⇒ rc=2 且 code 對')
    else:
        print(f'  🔴 丙丁·NOT_UTF8 · rc={_rc} code={_code}(該是 2 / NOT_UTF8)')
        ok = False

    # 戊己 GIT_UNRUNNABLE:PATH 裡沒有 git
    _w = _mk_git_repo(GREEN_BOARD, GREEN_SPEC)
    _nogit = dict(_GIT_FREE_ENV)
    _nogit['PATH'] = tempfile.mkdtemp()
    _rc, _code = _code_of(_w, env=_nogit)
    if _rc == 2 and _code == 'GIT_UNRUNNABLE':
        print('  ✅ 戊己·GIT_UNRUNNABLE · PATH 裡沒有 git ⇒ rc=2 且 code 對')
    else:
        print(f'  🔴 戊己·GIT_UNRUNNABLE · rc={_rc} code={_code}(該是 2 / GIT_UNRUNNABLE)')
        ok = False

    # 庚辛 而【工作樹模式】的三個 code 也要各自驗到, 不是「有丟就算過」
    for _lbl, _mk in [
        ('FILE_UNREADABLE',
         lambda: (os.path.join(d, 'no-such-at-all.md'), _mkf('s2.md', GREEN_SPEC))),
        ('BOARD_ROW_FLOOR',
         lambda: (_mkf('b2.md', _pad()[:_pad().index('| open | — | 乾淨列 30')]),
                  _mkf('s3.md', GREEN_SPEC))),
        ('HEADER_MISSING',
         lambda: (_mkf('b3.md', GREEN_BOARD),
                  _mkf('s4.md', _spec().replace('| # | 能力 | 狀態 | 量法 |',
                                                '| 項 | 能力 | 狀態 | 量法 |')))),
        # 🔴 **這一項是【比對本身】的證人。** 期望值刻意寫錯 ⇒ 它**必須不相符**。
        #    突變實測:沒有它的時候, 把 `if e.code == _want` 改成 `if True` ⇒ **零格紅**
        #    —— 因為其餘三項的 code 本來就都對, 比對鬆掉了也看不出來。
        ('ZZZ_BOGUS_EXPECTATION',
         lambda: (os.path.join(d, 'definitely-not-here.md'), _mkf('s9.md', GREEN_SPEC))),
    ]:
        _want = _lbl
        _must_mismatch = _lbl.startswith('ZZZ_')
        _b, _s = _mk()
        try:
            scan(_b, _s, quiet=True)
            print(f'  🔴 庚辛·{_lbl} · 該失效而它沒丟')
            ok = False
        except MeasurementError as e:
            _match = (e.code == _want)
            if _must_mismatch:
                if _match:
                    print(f'  🔴 庚辛·比對證人 · 連編造的期望 `{_want}` 都說相符 ⇒ 比對是恆真的')
                    ok = False
                else:
                    print(f'  ✅ 庚辛·比對證人 · 編造的期望不相符(實得 {e.code})⇒ 比對有判別力')
            elif _match:
                print(f'  ✅ 庚辛·{_lbl} · code 逐字相符(不是「有丟就算過」)')
            else:
                print(f'  🔴 庚辛·{_lbl} · code={e.code}(該是 {_want})')
                ok = False

    # 癸 🔴 codex F15:**非預期**的例外(不是 RuntimeError)也要落 rc=2, 不得落 rc=1。
    #    餵一份不是 UTF-8 的板 ⇒ io.open 丟 UnicodeDecodeError(不是 OSError ⇒ 不會變 RuntimeError)。
    #    📌 這一格是真的踩過才補的:rule3 抓到「欄位不足」那一列之後, **印訊息時自己 IndexError**
    #       ⇒ 沒有這條 except 的話, 那一發會 exit 1 而被讀成「有 finding」。
    _d3 = tempfile.mkdtemp()
    os.makedirs(os.path.join(_d3, 'docs', 'specs'), exist_ok=True)
    open(os.path.join(_d3, BOARD), 'wb').write(b'## A \xb7 \xff\xfe not utf8\n')
    io.open(os.path.join(_d3, SPEC), 'w', encoding='utf-8').write(GREEN_SPEC)
    _r3 = subprocess.run([sys.executable, os.path.abspath(__file__)],
                         cwd=_d3, capture_output=True, text=True, env=_GIT_FREE_ENV)
    if _r3.returncode == 2:
        print('  ✅ 癸·非預期例外 · 非 UTF-8 的板 ⇒ exit 2(不是 1)')
    else:
        print(f'  🔴 癸·非預期例外 · exit {_r3.returncode}(該是 2)⇒ 它會被讀成「有 finding」')
        ok = False

    # 辛 🔴 rc 對應表整段從沒被驗過 —— 前面那些格都在 in-process 跑 scan(),
    #    **一格都沒經過 `__main__` 那三行**。R2 實測:把 sys.exit(2) 改成 sys.exit(1) ⇒ selftest 全綠。
    #    ⇒ 這一格真的開一個子程序, 斷言 exit code。
    r = subprocess.run(
        [sys.executable, os.path.abspath(__file__)],
        cwd=d, capture_output=True, text=True, env=_GIT_FREE_ENV)
    if r.returncode == 2:
        print('  ✅ 辛·rc 對應表 · 讀不到檔 ⇒ 子程序真的 exit 2(與 finding 的 1 分得開)')
    else:
        print(f'  🔴 辛·rc 對應表 · 讀不到檔而子程序 exit {r.returncode}(該是 2)')
        ok = False

    # ══ 逃生門的證人(2026-08-25 線3;主視窗:「證人不可以省」)══════════════
    #    🔴 三格, 而**每一格殺死的是不同的一刀**:
    #      逃1 拿掉整個逃生門      ⇒ 只有逃1 會紅(它期望放行)
    #      逃2 拿掉「要有痕」那半  ⇒ 只有逃2 會紅(它期望仍然擋)
    #      逃3 拿掉「要設 env」那半 ⇒ 只有逃3 會紅(痕本身不得當成永久的洞)
    #    📌 少了逃2,「逃生門裝好了」與「逃生門恆開」印同一個結果。
    #    📌 少了逃3, 那行痕會變成一個**寫進板子就永遠打開**的洞 —— 而它讀起來像一筆紀錄。
    _dirty_board = _pad('| zzzbad | — | 態欄不在封閉集 | — | x |\n')
    _mark_line = '\n<!-- BOARD-GATE-BYPASS: 2026-08-25 selftest 證人用的假痕 -->\n'
    _esc = [
        # 🔴 code-reviewer N2(2026-08-25):這一格餵的板子是**臨時檔、不在任何 git repo 裡**
        #    ⇒ `_head_text` 回 None ⇒ 它走的是 **fail-open 那條分支**, 不是 fresh 比對。
        #    ⇒ 標題原本寫「板子帶著痕 ⇒ 放行」, 讀起來像在驗 fresh 那條路, 而它沒有。
        #    真正驗 fresh 的是 逃5 / 逃6(那兩格在真 git repo 裡)。標題改成它實際驗的東西。
        ('逃1該綠必綠 · 【拿不到 HEAD 的世界】env=1 + 痕 ⇒ 放行(走 fail-open 那條分支)',
         _dirty_board + _mark_line, True, 0),
        ('逃2該紅必紅 · env=1 而板子【沒有】痕 ⇒ 仍然擋', _dirty_board, True, 1),
        ('逃3該紅必紅 · 有痕而【沒設 env】⇒ 仍然擋(痕不是永久的洞)',
         _dirty_board + _mark_line, False, 1),
    ]
    for _name, _bt, _set_env, _want in _esc:
        _old = os.environ.get(BYPASS_ENV)
        if _set_env:
            os.environ[BYPASS_ENV] = '1'
        else:
            os.environ.pop(BYPASS_ENV, None)
        try:
            _got = scan(_mkf('esc-b.md', _bt), _mkf('esc-s.md', GREEN_SPEC), quiet=True)
        except MeasurementError as e:
            _got = f'量具失效:{e.code}'
        finally:
            if _old is None:
                os.environ.pop(BYPASS_ENV, None)
            else:
                os.environ[BYPASS_ENV] = _old
        if _got == _want:
            print(f'  ✅ {_name}  期望 rc={_want} 實得 rc={_got}')
        else:
            print(f'  🔴 {_name}  期望 rc={_want} 實得 rc={_got}')
            ok = False

    # 🔴 逃4:**上面三格都餵【工作樹】那條路。** `--staged` 那條讀的是 index,
    #    而逃生門讀的是 `read_source(board, staged)` ⇒ 兩條路各自有一個「痕在哪」的答案。
    #    ⇒ 這一格造一個真 repo:**痕只在工作樹上, index 裡沒有** ⇒ `--staged` 必須【仍然擋】。
    #    📌 少了它, 「痕跟著 commit 走」這個整個設計的賣點**一格證人都沒有**:
    #       有人可以在工作樹寫一行痕、繞過閘, 而那顆 commit 裡沒有那行痕。
    _w4 = _mk_git_repo(board_text=_dirty_board, spec_text=GREEN_SPEC, add=True)
    subprocess.run(['git', 'commit', '-q', '-m', 'base'], cwd=_w4,
                   capture_output=True, env=_GIT_FREE_ENV)
    io.open(os.path.join(_w4, BOARD), 'w', encoding='utf-8').write(_dirty_board + _mark_line)
    _r4 = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'], cwd=_w4,
                         capture_output=True, text=True,
                         env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    _r4w = subprocess.run([sys.executable, os.path.abspath(__file__)], cwd=_w4,
                          capture_output=True, text=True,
                          env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    if _r4.returncode == 1 and _r4w.returncode == 0:
        print('  ✅ 逃4·痕只在工作樹 · --staged 仍然擋(rc=1), 而不帶 --staged 放行(rc=0)'
              ' ⇒ 兩條路真的各自讀自己那一份')
    else:
        print(f'  🔴 逃4·痕只在工作樹 · --staged rc={_r4.returncode}(該是 1)'
              f' / 不帶 --staged rc={_r4w.returncode}(該是 0)'
              ' ⇒ 逃生門讀錯了那一份, 痕可以不進 commit')
        ok = False

    # ══ codex R1-A/C 的證人:**舊痕不得重用**(2026-08-25)════════════════
    #    🔴 這一格擋的是【會自己長大的洞】:第一次繞道留下的那行痕會永遠留在板子裡,
    #       而重用它與「這次真的寫了理由」在畫面上一模一樣。
    #    逃5 舊痕(HEAD 裡已有) ⇒ 仍然擋   逃6 這次新增的痕 ⇒ 放行
    #    📌 少了逃5, 把「fresh」那半改回「只要有痕」⇒ 一格都不會紅。
    _old_mark = '<!-- BOARD-GATE-BYPASS: 2026-08-01 上一次繞道留下的 -->\n'
    _w5 = _mk_git_repo(board_text=_pad() + _old_mark, spec_text=GREEN_SPEC, add=True)
    subprocess.run(['git', 'commit', '-q', '-m', 'base'], cwd=_w5,
                   capture_output=True, env=_GIT_FREE_ENV)
    _b5 = os.path.join(_w5, BOARD)
    io.open(_b5, 'w', encoding='utf-8').write(_dirty_board + _old_mark)
    subprocess.run(['git', 'add', BOARD], cwd=_w5, capture_output=True, env=_GIT_FREE_ENV)
    _r5 = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'], cwd=_w5,
                         capture_output=True, text=True,
                         env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    if _r5.returncode == 1:
        print('  ✅ 逃5·舊痕重用 · HEAD 裡已有的那行痕 ⇒ 仍然擋(rc=1)')
    else:
        print(f'  🔴 逃5·舊痕重用 · rc={_r5.returncode}(該是 1)'
              ' ⇒ 第一次繞道會變成一個永久的洞')
        ok = False
    io.open(_b5, 'w', encoding='utf-8').write(
        _dirty_board + _old_mark + '<!-- BOARD-GATE-BYPASS: 2026-08-25 這次新寫的 -->\n')
    subprocess.run(['git', 'add', BOARD], cwd=_w5, capture_output=True, env=_GIT_FREE_ENV)
    _r6 = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'], cwd=_w5,
                         capture_output=True, text=True,
                         env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    if _r6.returncode == 0:
        print('  ✅ 逃6·新痕 · 舊痕還在而這次多寫了一行新的 ⇒ 放行(rc=0)'
              ' ⇒ 逃5 不是靠「有舊痕就一律擋」蒙對的')
    else:
        print(f'  🔴 逃6·新痕 · rc={_r6.returncode}(該是 0)⇒ 誤擋:寫了新理由還是繞不過去')
        ok = False

    # ══ codex R1-F 的證人:**打錯的旗標不得被安靜吞掉**══════════════════
    #    🔴 實測過的病:`--stage`(少一個 d)⇒ rc=0 而它印「讀自工作樹」
    #       ⇒ 人以為驗了 index, 而它驗的是另一份。**兩個模式印的是同一個 rc。**
    #    ⚠️ 該綠那一半也要有 —— 位置參數(lint-staged 會附加的絕對路徑)**不得**被當成壞旗標。
    _w7 = _mk_git_repo(board_text=GREEN_BOARD, spec_text=GREEN_SPEC, add=True)
    subprocess.run(['git', 'commit', '-q', '-m', 'base'], cwd=_w7,
                   capture_output=True, env=_GIT_FREE_ENV)
    _r7 = subprocess.run([sys.executable, os.path.abspath(__file__), '--stage'], cwd=_w7,
                         capture_output=True, text=True, env=_GIT_FREE_ENV)
    _r8 = subprocess.run([sys.executable, os.path.abspath(__file__),
                          os.path.join(_w7, BOARD)], cwd=_w7,
                         capture_output=True, text=True, env=_GIT_FREE_ENV)
    if _r7.returncode == 2 and _r8.returncode == 0:
        print('  ✅ 逃7·旗標 · 打錯的 --stage ⇒ rc=2(不是靜靜跑另一個模式);'
              '而 lint-staged 附加的路徑參數照常放行(rc=0)')
    else:
        print(f'  🔴 逃7·旗標 · --stage rc={_r7.returncode}(該是 2)'
              f' / 附加路徑 rc={_r8.returncode}(該是 0)')
        ok = False

    # ══ code-reviewer C1 [Critical] 的證人:**逃生門要講給撞到閘的人聽**═══════
    #    🔴 少了這一格, 逃生門可以只存在於 code 裡, 而撞到閘的人手上只有 --no-verify。
    #    ⚠️ **該不印的那一半也要有** —— 綠的時候印一段繞道教學 = 教大家怎麼繞, 那是反效果。
    import contextlib as _c1ctx
    def _cap(board_text):
        _b = io.StringIO()
        with _c1ctx.redirect_stdout(_b):
            try:
                scan(_mkf('c1-b.md', board_text), _mkf('c1-s.md', GREEN_SPEC))
            except MeasurementError:
                pass
        return _b.getvalue()
    _o_bad = _cap(_dirty_board)
    _o_ok = _cap(GREEN_BOARD)
    if BYPASS_ENV in _o_bad and BYPASS_MARK in _o_bad and BYPASS_ENV not in _o_ok:
        print('  ✅ 逃8·出口可見 · 紅的時候把 env 名與痕的格式印出來;綠的時候不印'
              '(不教沒撞到閘的人怎麼繞)')
    else:
        print(f'  🔴 逃8·出口可見 · 紅時有 env={BYPASS_ENV in _o_bad} 有痕格式={BYPASS_MARK in _o_bad}'
              f' / 綠時有 env={BYPASS_ENV in _o_ok}'
              ' ⇒ 撞到閘的人看不到出口, 他會伸手拿 --no-verify')
        ok = False

    # ══ code-reviewer I2 的證人:**少一個 dash 也要擋**═══════════════════════
    #    🔴 `-selftest` 比 `--stage` 更會咬人:package.json 那條 entry 就是 `--selftest`
    #       ⇒ 「91 格全過」與「一格都沒跑」原本印同一個 rc=0。
    _r9 = subprocess.run([sys.executable, os.path.abspath(__file__), '-selftest'], cwd=_w7,
                         capture_output=True, text=True, env=_GIT_FREE_ENV)
    _r10 = subprocess.run([sys.executable, os.path.abspath(__file__), '-staged'], cwd=_w7,
                          capture_output=True, text=True, env=_GIT_FREE_ENV)
    if _r9.returncode == 2 and _r10.returncode == 2:
        print('  ✅ 逃9·少一個 dash · -selftest 與 -staged 都 rc=2'
              '(不是靜靜跑另一個模式、也不是靜靜地一格都不跑)')
    else:
        print(f'  🔴 逃9·少一個 dash · -selftest rc={_r9.returncode} / -staged rc={_r10.returncode}'
              '(兩個都該是 2)')
        ok = False

    # ══ code-reviewer I3 的證人:**git 跑不動要 rc=2, 不得放行**═══════════════
    #    🔴 原本 fail-open, 而它印的是一句**正面的假宣稱**:「板子帶著【這次新增的】痕 ⇒ 放行」。
    #    做法:PATH 上只留 grep, 沒有 git ⇒ `git show` 丟 FileNotFoundError。
    _shim = tempfile.mkdtemp()
    for _b in ('grep', 'sed'):
        _src = f'/usr/bin/{_b}'
        if os.path.exists(_src):
            os.symlink(_src, os.path.join(_shim, _b))
    _w11 = _mk_git_repo(board_text=_pad() + _old_mark, spec_text=GREEN_SPEC, add=True)
    subprocess.run(['git', 'commit', '-q', '-m', 'base'], cwd=_w11,
                   capture_output=True, env=_GIT_FREE_ENV)
    io.open(os.path.join(_w11, BOARD), 'w', encoding='utf-8').write(_dirty_board + _old_mark)
    _r11 = subprocess.run([sys.executable, os.path.abspath(__file__)], cwd=_w11,
                          capture_output=True, text=True,
                          env={**_GIT_FREE_ENV, BYPASS_ENV: '1', 'PATH': _shim})
    _r12 = subprocess.run([sys.executable, os.path.abspath(__file__)], cwd=_w11,
                          capture_output=True, text=True,
                          env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    if _r11.returncode == 2 and _r12.returncode == 1:
        print('  ✅ 逃10·git 跑不動 · rc=2 判量具失效(不是 fail-open 放行);'
              '而同一世界 git 在 PATH 上 ⇒ rc=1 ⇒ 兩個世界真的印不同的東西')
    else:
        print(f'  🔴 逃10·git 跑不動 · 無 git rc={_r11.returncode}(該是 2)'
              f' / 有 git rc={_r12.returncode}(該是 1)⇒ 重用舊痕會被放行而它說是新痕')
        ok = False

    # ══ code-reviewer N1 的證人:**舊痕多插一個空白不得變成新痕**═════════════
    io.open(os.path.join(_w11, BOARD), 'w', encoding='utf-8').write(
        _dirty_board + _old_mark.replace('上一次', '上一次 '))
    subprocess.run(['git', 'add', BOARD], cwd=_w11, capture_output=True, env=_GIT_FREE_ENV)
    _r13 = subprocess.run([sys.executable, os.path.abspath(__file__), '--staged'], cwd=_w11,
                          capture_output=True, text=True,
                          env={**_GIT_FREE_ENV, BYPASS_ENV: '1'})
    if _r13.returncode == 1:
        print('  ✅ 逃11·空白 · 舊痕中間多插一個空白 ⇒ 仍算舊痕, 仍然擋')
    else:
        print(f'  🔴 逃11·空白 · rc={_r13.returncode}(該是 1)'
              ' ⇒ 舊痕重用只要多打一個空白就繞得過去')
        ok = False

    # ══ code-reviewer I4 的證人:**閘讀兩支檔, 兩支都要接上 lint-staged**═════
    #    🔴 只接板子那一支的話:改壞 spec 的人**零回饋**, 而被擋的是**下一個碰板子的人**,
    #       紅的內容指向他**沒動過**的那支檔 ⇒ 他唯一的出口是「以他的名義寫一行繞道痕」
    #       ⇒ **繞道紀錄歸屬直接錯人。**
    #    ⚠️ 找不到 package.json ⇒ 跳過(突變副本跑在 /tmp), 不判紅也不判綠。
    _pkg = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'package.json')
    if os.path.exists(_pkg):
        try:
            _ls = json.load(io.open(_pkg, encoding='utf-8')).get('lint-staged', {})
        except Exception:  # noqa: BLE001
            _ls = {}
        _mine = [k for k, v in _ls.items() if 'board-state-consistency.py --staged' in v]
        _covers = [k for k in _mine if BOARD in k and SPEC in k]
        if _covers:
            print('  ✅ 逃12·接線涵蓋面 · lint-staged 那條 key 同時涵蓋板子與 spec 兩支')
        else:
            print(f'  🔴 逃12·接線涵蓋面 · 命中的 key = {_mine or "(一條都沒有)"}'
                  f' ⇒ 沒有同時涵蓋 {BOARD} 與 {SPEC}'
                  ' ⇒ 改壞 spec 的人零回饋, 而繞道紀錄會歸屬到錯的人身上')
            ok = False
    else:
        print('  ⏭ 逃12·接線涵蓋面 · 找不到 package.json ⇒ 跳過(不判綠)')

    print('\n全部通過。' if ok else '\n🔴 有格沒過。')
    return 0 if ok else 1


WHY = """誤擋率乾跑

🔴 先讀:下面每一組數字都綁著【量測時點 2026-08-25 凌晨】與【當時的檔】。
   那兩份檔一直在被改(量測當晚 launch-todo 從 99 列走到 100 列、
   spec §1-A-1 從 11 列走到 8 列)⇒ **這些數字不會自己更新, 也沒有東西會在它們漂掉時出聲。**
   要現值就照下面的量法當場重跑。

── 規則② 字集與位置 ──(量測時分母 = launch-todo 的 99 資料列)
   字集 A(含裸 ✅ + 四詞, 不限位置)  ⇒ 24 列, 人工判【多數是誤擋】(進度句裡的 ✅)
   字集 B(四詞, 不限位置)            ⇒  3 列, 其中 1 列誤擋(`#858` 的「F1 … 已做完」是子項)
   字集 C(本規則:限【事】欄或 ✅ 判決句)⇒  2 列, 誤擋 0
   四個詞 = 已結掉 / 已做完 / 已關掉 / 已完成(見 DONE_WORDS)
   字集 A 多的那個 = 裸 `✅`(不要求它後面接那四個詞)
   量法:對每組字集重跑一次全表, 逐列開檔核判真偽。

── 規則③ 剝不剝劃線 ──(量測時分母 = spec §1-A-1 的 11 列;**現值已是 8 列**)
   不剝 ~~...~~  ⇒ 5 列, 其中 2 列誤擋(`#10` / `#16` 的 `~~❌~~ → **✅**`)
   剝了          ⇒ 3 列, 誤擋 0

── 反方向(態=done/parked 而自稱還沒做)──(量測時分母 = 30 個 done/parked 列)
   寬字集(仍未/還沒/尚未/未做/沒做)⇒ 9 列 · 中字集(仍未/尚未)⇒ 4 列 · 只看【事】欄 ⇒ 1 列
   🔴 而那 1 列是誤擋(事欄在唸缺陷的名字)⇒ **在【事】欄這個位置, 分母 1 / 誤擋 1。**
   ⚠️ 不要把它讀成「結構上 100% 誤擋」—— **那個 100% 的分母是 1。**
   ⚠️ 而同型字樣**大量出現在「關鍵事實」欄而不是事欄** ⇒ **那個位置一格都沒量。**
   ⇒ 本規則刻意不做, 而要做的話**先量那裡**。

── LOOKBACK ──(量的對象 = 本檔 selftest 的 fixture, **不是真板**)
   掃 0-200 ⇒ 綠區間 = **[16, 29]**。15 以下格⑤ 紅, 30 以上格⑦ 紅。**兩個界都是量到的。**
   🔴 而真板此刻對它**零判別力**:LOOKBACK 取 0/16/24/200, 規則② 對真板一律 0 列命中。
"""

if __name__ == '__main__':
    try:
        # 🔴 codex R1-F(2026-08-25):旗標比對是 `in sys.argv` ⇒ **打錯的旗標會被安靜吞掉**。
        #    實測:`--stage`(少一個 d)⇒ rc=0 而它印「讀自工作樹」—— 人以為驗了 index, 其實沒有。
        #    ⇒ 未知的 `--` 開頭一律 rc=2(量具失效), 不與 finding 的 rc=1 混。
        #    ⚠️ **不含位置參數** —— lint-staged 會附加檔名(絕對路徑), 那個本來就被無視。
        _known = ('--selftest', '--why', '--staged')
        # 🔴 code-reviewer I2(2026-08-25):原本比對 `--` 開頭 ⇒ **少一個 dash 仍然被安靜吞掉**。
        #    實跑:`-selftest` ⇒ rc=0 且印 ✅①a ✅①b, 而 `'全部通過' in stdout` 是 **False**
        #    ⇒ **91 格一格都沒跑**, 而它與「全部通過」印同一個 rc。
        #    而 `package.json` 那條 entry 正是 `--selftest` ⇒ 這一族比 `--stage` 更會咬人。
        #    改成 `-` 開頭:實測 lint-staged 遞的是**絕對路徑**, 永遠不以 `-` 開頭。
        _bad_flags = [a for a in sys.argv[1:] if a.startswith('-') and a not in _known]
        if _bad_flags:
            print(f'🔴 工具壞了(不認得的旗標 {" ".join(_bad_flags)};認得的只有 '
                  f'{" ".join(_known)})—— 打錯旗標時它會安靜地跑【另一個模式】',
                  file=sys.stderr)
            sys.exit(2)
        if '--selftest' in sys.argv:
            sys.exit(selftest())
        if '--why' in sys.argv:
            print(WHY)
            sys.exit(0)
        sys.exit(scan(staged='--staged' in sys.argv))
    except RuntimeError as e:
        print(f'🔴 工具壞了:{e}', file=sys.stderr)
        sys.exit(2)
    except Exception as e:  # noqa: BLE001
        # 🔴 codex F15:UnicodeDecodeError / IndexError 這類**沒被預期的**例外,
        #    Python 預設 exit 1 ⇒ 與「有 finding」混在同一個 rc 裡。一律轉 rc=2。
        print(f'🔴 工具壞了(非預期例外 {type(e).__name__}):{e}', file=sys.stderr)
        sys.exit(2)
