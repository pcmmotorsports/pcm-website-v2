#!/bin/sh
# .husky/design-blind-gate.sh — 殼。真尺在 `scripts/design-ref-check.sh`。
#
# ═══ 守什麼 ═══
# 在一棵 **`design-reference` submodule 沒有 init** 的工作樹上, commit 顧客站的視覺面檔案。
#   🔴 那棵樹上的每一發 `grep design-reference` 都回**零命中**,
#      而**「稿裡真的沒有」與「這棵樹沒有稿」印同一個東西:零。**
#   ⇒ 鐵則 1 的「動工前先 grep design 真權威字面」那一步在那裡是**空轉的, 而它不出聲**。
#
# ═══ 為什麼是【現在】才有這道閘(2026-09-04 線【帳號】) ═══
# 🛑 **規則早就寫了、工具早就會叫 —— 而我今天照樣踩了。** 三個都實查過:
#   ① `docs/runbooks/multi-window-command-workflow.md:615` STANDING-ACTIONS 逐字有那一行
#   ② 同檔 `:733-734` 又寫了一次(「S 窗 08-10 實踩」)
#   ③ `scripts/design-ref-check.sh` 印得毫不含糊:「你在這一棵樹 grep design-reference,
#      答案【沒有分母】… 不要把剛才那個零命中寫進任何 plan / 板列 / 交件。」
# 🎯 **⇒ 缺的不是規則、不是工具, 是【沒有人在開窗那一刻跑它】。**
#    而 `scripts/window-standing-actions.sh:17-18` 的檔頭自己就寫著這句:
#      「這支**不是守門**…要真的擋, 得有人在開窗流程上掛檢查, **那還沒有**。」
#    ⇒ 📌 **本檔就是那句話說缺的東西。**
#
# ═══ 🔬 掛上去之前先量【它在正常狀態會叫幾次】(閘死於誤報遠比死於漏報常見) ═══
#   2026-09-04 全艦隊實測 `cd <tree>/design-reference && git ls-files | wc -l`:
#     pcm-wt-account 176 · auth 176 · front 176 · mail 176 · ship 176
#     🔴 pcm-wt-db **1** · pcm-wt-e4-probe **1**   ← 這兩棵是盲的
#   ⇒ 在有稿的樹上本閘**恆靜**(第 2 個條件為假);在盲樹上它只在你 commit 視覺面檔案時才叫。
#   ⇒ 而修法是**一行、跑一次、那棵樹從此不再叫** ⇒ 它是會教人的閘, 不是會嘮叨的閘。
#
# ═══ 🛑 它證不到什麼(先讀, 不要把它讀得比實際強) ═══
#   · 它只答「這棵樹有沒有稿」, **不答「你要找的字面在不在稿裡」** —— 那要你自己 grep。
#   · 它**不管 OD 專案那一半**。鐵則 1 的真權威還包含 `list_projects` 對磁碟目錄數
#     ⇒ 本閘綠 ≠ 你做完了鐵則 1。
#   · pre-commit **不是每一種 commit 都會經過**(rebase / cherry-pick 的 `--continue` 不保證)
#     ⇒ 本閘沒叫, 不代表這棵樹有稿。
#   · 它看的是**工作樹版**的自己(husky 的形狀)⇒ 「staged 壞版 + 工作樹好版」擋不住。
#
# ═══ 觸發面刻意窄 ═══
#   只認 `apps/storefront/src/` 底下的 `.tsx` / `.css`, **排除 `.test.`** ——
#   那是「客人會看到的東西」那一面。改測試 / 改 docs / 改後台不叫。
#   🔴 **窄是刻意的**:一道對常態發的警報會被學會忽略, 而它下一次真的抓到東西時沒有人看。
#
# exit 0 = 沒事(沒有視覺面檔案, 或這棵樹有稿)  1 = 盲樹上動視覺面檔案  2 = 本工具自己壞了
#
# 用法:
#   sh .husky/design-blind-gate.sh              pre-commit 呼叫的形式
#   sh .husky/design-blind-gate.sh --selftest   雙向表演(不碰 git、不碰本 repo 的檔)
set -u

RULER='scripts/design-ref-check.sh'

# 判定核心:抽成函式, 讓 --selftest 能餵合成輸入而**完全不碰 git**。
#   $1 = 換行分隔的檔案清單   $2 = 真尺的 rc
# 🔴 回傳值就是本閘的 rc ⇒ 兩個世界要印不同的東西, 而這裡是唯一決定它的地方。
#
# 🔴🔴 **這裡拆成【兩個】函式, 而第一版沒拆 —— 那個 bug 值得留在這裡當紀錄:**
#   第一版只有 `decide(files, ruler_rc)`, 而主流程為了先問「這顆 commit 有沒有碰視覺面」
#   餵了 `decide "$FILES" 0` ⇒ 🛑 **餵 0 就等於宣告「尺說沒事」⇒ 它在兩個世界都回放行**
#   ⇒ 主流程當場 `exit 0`, **後面整段擋人的碼變成死碼**。
#   🎯 **而 selftest 五格【全過】** —— 因為它只呼叫 `decide`, 沒有呼叫**呼叫 decide 的那一段**。
#   📌 **⇒ 抽出來測的那一格是好的, 而洞在它與呼叫端之間。**
#     抓到它的是「在一棵真的盲樹上把整條路走一遍」, 不是更仔細地讀自檢。

# 這顆 commit 有沒有碰到顧客站的視覺面?rc 0 = 有碰(有命中), 1 = 沒碰。
has_visual() {
  printf '%s\n' "$1" \
    | grep -E '^apps/storefront/src/.*\.(tsx|css)$' \
    | grep -qv '\.test\.'
}

# 要不要放行?rc 0 = 放行, 1 = 擋下。$1 = 檔案清單  $2 = 真尺的 rc
decide() {
  has_visual "$1" || return 0
  [ "$2" = "0" ] && return 0
  return 1
}

if [ "${1:-}" = '--selftest' ]; then
  fail=0
  # 🟢 正對照①:盲樹 + 動視覺面檔 ⇒ **必須擋**(這一格紅了 = 本閘根本不會叫)
  decide 'apps/storefront/src/components/WrsShowcase.tsx' 3 && {
    printf '%s\n' '🔴 selftest ①:盲樹上動視覺面檔而本閘放行 ⇒ 它擋不住它要擋的東西' >&2; fail=1; }
  # 🟢 負對照②:有稿的樹 + 同一批檔 ⇒ **必須放行**(這一格紅了 = 它天天誤報)
  decide 'apps/storefront/src/components/WrsShowcase.tsx' 0 || {
    printf '%s\n' '🔴 selftest ②:有稿的樹上照樣擋 ⇒ 這道閘會死於誤報' >&2; fail=1; }
  # 🟢 負對照③:盲樹, 而**只動測試檔** ⇒ 必須放行(觸發面窄是刻意的)
  decide 'apps/storefront/src/components/WrsShowcase.test.tsx' 3 || {
    printf '%s\n' '🔴 selftest ③:只動測試檔也擋 ⇒ 觸發面比宣稱的寬' >&2; fail=1; }
  # 🟢 負對照④:盲樹, 而動的是**後台**的 tsx ⇒ 必須放行
  decide 'apps/admin/src/app/orders/page.tsx' 3 || {
    printf '%s\n' '🔴 selftest ④:後台檔也擋 ⇒ 觸發面比宣稱的寬' >&2; fail=1; }
  # 🟢 負對照⑤:盲樹, 而清單是空的 ⇒ 必須放行
  decide '' 3 || {
    printf '%s\n' '🔴 selftest ⑤:空清單也擋 ⇒ 它對每一顆 commit 都叫' >&2; fail=1; }
  [ "$fail" = "0" ] && printf '%s\n' '✅ design-blind-gate selftest:5 格全過(1 擋 / 4 放行)'
  exit "$fail"
fi

# fail-closed:真尺不見了 ⇒ 擋下。刪掉那支 .sh 正是關掉本閘最省事的方法。
if [ ! -f "$RULER" ]; then
  printf '%s\n' "🔴 $RULER 不見了 ⇒ 擋下(不放行)" >&2
  printf '%s\n' "   復原:git checkout -- $RULER" >&2
  exit 2
fi

FILES=$(git diff --cached --name-only --diff-filter=ACMR)
# 先問「這顆 commit 有沒有碰視覺面」—— 🔴 **這裡要問 `has_visual`, 不是 `decide`**。
#   (第一版問了 `decide "$FILES" 0` ⇒ 兩個世界都回放行 ⇒ 後面整段是死碼。見上方函式的註解。)
# 🔵 分兩步是刻意的:沒碰視覺面的 commit **完全不去跑那把尺**(它會 spawn git 子程序)。
if ! has_visual "$FILES"; then
  # 沒有視覺面檔案 ⇒ 本閘與這顆 commit 無關, 安靜放行(不印任何東西)
  exit 0
fi

# 有視覺面檔案 ⇒ 才去問那棵樹有沒有稿(把 rc 收在自己的射程裡, 中間不放任何東西)
sh "$RULER" > /dev/null 2>&1 ; RULER_RC=$?
if decide "$FILES" "$RULER_RC"; then
  exit 0
fi

printf '%s\n' '' >&2
printf '%s\n' '🔴🔴 這一棵樹【沒有 design-reference】, 而你正在 commit 顧客站的視覺面檔案。' >&2
printf '%s\n' '' >&2
sh "$RULER" >&2 2>&1 || :
printf '%s\n' '' >&2
printf '%s\n' '🛑 為什麼擋你:鐵則 1 要求動工前 grep design 真權威字面 ——' >&2
printf '%s\n' '   而在這棵樹上那一發【一定】回零命中, 與「稿裡真的沒有」印同一個東西。' >&2
printf '%s\n' '   ⇒ 那個零很可能已經寫進你的 plan 了。跑完下面那一行, 回去重跑一次 grep。' >&2
printf '%s\n' '' >&2
printf '%s\n' '✅ 一行修好(在這棵樹底下跑, 跑一次就好):' >&2
printf '%s\n' '     git submodule update --init design-reference' >&2
exit 1
