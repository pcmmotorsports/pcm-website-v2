#!/usr/bin/env bash
# next-backlog-number.sh — 下一個可用的 backlog 號(backlog #490 同族的機制片)
#
# 🔴 存在理由(2026-08-14 實錘,而且病因不是「忘記」):
#    主視窗發號時查的是「**主樹當下最大 + 1**」⇒ 已配出、還在別窗 branch 沒 merge 的號**看不到**
#    ⇒ 兩窗各自都以為自己拿到唯一的號,而**發現時機是收割**(最貴的時候)。
#    當天 `#489` 真的撞了(V 窗已寫入 / E 窗拿去佔位),**接住它的是「E 主動請主視窗確認」,不是機制。**
#
# 🔴🔴 **為什麼一行 playbook 指令不夠、非要一支有名字的腳本**(主視窗自述,逐字保留):
#    「**我就是會寫出較窄版本的那個人。那不是我忘了跑,是我當場想了一個較窄的查法然後跑了它。**」
#    ⇒ 文件擋不住「現想一個」;**一支有名字的腳本擋得住 —— 它讓「現想」變成不必要。**
#
# 🔴 本工具的核心不是「算出一個數字」,是「**三層各自的最大值都印出來**」——
#    當天的病就是**只看到其中一層**。三個數字並列 ⇒ 哪一層貢獻了最大值一眼看得到,
#    而且**三個數字不一致本身就是資訊**(代表有號還沒回到主樹)。
#
# 用法:  bash scripts/next-backlog-number.sh
#        (無參數。輸出:三層最大值 + 下一個可用號 + 每次都印的掃描限度)
#
# 測試接縫(只給負測用,平常不要設):
#        NEXT_BACKLOG_REFS='<ref1> <ref2>' NEXT_BACKLOG_SKIP_LIVE=1 bash scripts/next-backlog-number.sh
#        ⇒ 前者用指定的 ref 取代「所有本機 branch」、後者跳過「主樹 / worktree」兩層(它們只讀得到今天的檔)
#        ⇒ 兩個一起用,才能把**整支腳本**放回病發當下跑,而不是只驗其中一層。

set -uo pipefail
cd "$(dirname "$0")/.."

FILE='docs/phase-1-backlog.md'
# 🔴 抽號的正規式與 playbook §F 逐字同一份。**禁 `sort -t'#' -k2 -n`**(BSD sort 行為不同,
#    已列進量具方言坑集)⇒ 一律先把數字單獨切出來再 `sort -n`。
nums() { grep -oE '^### #[0-9]+' | grep -oE '[0-9]+'; }
maxof() { sort -n | tail -1; }

# ── 第一層:主樹的工作區檔 ────────────────────────────────────────────
if [ -n "${NEXT_BACKLOG_SKIP_LIVE:-}" ]; then MAIN_MAX=''; else
MAIN_MAX=$(cat "$FILE" 2>/dev/null | nums | maxof)
fi

# ── 第二層:所有 worktree 的**工作區檔**(這一層才抓得到「已寫進檔案、還沒 commit」的號)──
if [ -n "${NEXT_BACKLOG_SKIP_LIVE:-}" ]; then WT_MAX=''; else
WT_MAX=$(
  for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
    cat "$w/$FILE" 2>/dev/null
  done | nums | maxof
)
fi

# ── 第三層:所有本機 branch(關掉的窗留下的 branch 也在這一層)──────────
REFS="${NEXT_BACKLOG_REFS:-}"
if [ -z "$REFS" ]; then
  REFS=$(git for-each-ref --format='%(refname)' refs/heads)
fi
REF_COUNT=$(printf '%s\n' $REFS | grep -c . || true)
BR_MAX=$(
  for r in $REFS; do
    git show "$r:$FILE" 2>/dev/null
  done | nums | maxof
)

MAIN_MAX=${MAIN_MAX:-0}; WT_MAX=${WT_MAX:-0}; BR_MAX=${BR_MAX:-0}
MAX=$(printf '%s\n%s\n%s\n' "$MAIN_MAX" "$WT_MAX" "$BR_MAX" | maxof)
NEXT=$((MAX + 1))

echo "── 三層各自的最大號(不一致 = 有號還沒回到主樹)──────────────"
SKIP_NOTE="$([ -n "${NEXT_BACKLOG_SKIP_LIVE:-}" ] && echo '  ⚠️ 測試模式:本層已跳過' || echo '')"
printf '  主樹工作區檔      = %s%s\n' "$MAIN_MAX" "$SKIP_NOTE"
printf '  所有 worktree     = %s   (%s 個 worktree)%s\n' "$WT_MAX" "$(git worktree list | wc -l | tr -d ' ')" "$SKIP_NOTE"
printf '  所有本機 branch   = %s   (%s 個 ref%s)\n' "$BR_MAX" "$REF_COUNT" \
  "$([ -n "${NEXT_BACKLOG_REFS:-}" ] && echo '  ⚠️ 由 NEXT_BACKLOG_REFS 指定=測試模式' || echo '')"
echo
echo "  ⇒ 取三者最大 = $MAX"
echo "  ⇒ **下一個可用號 = #$NEXT**"
echo
echo "── 掃描限度(每次都印,不要只寫在文件裡)────────────────────────"
echo "  · **掃不到**:只存在於 remote、本機沒有對應 branch 的號"
echo "  · **掃不到**:還沒寫進 $FILE、只存在於某封信或某段對話裡的號"
echo "  · ⇒ 這支給的是**下限**。窗要號仍然跟主視窗要;真要佔位,**必須標明「佔位、請主視窗確認」**。"
echo ""
echo "── 🔴 自己掃信箱佔位時的兩件(2026-08-18 兩個窗各撞一次,是同一個坑的兩面)──"
echo "  · **錨頭**:裸 \`#6[0-9][0-9]\` 會撈到 \`#64738a\`(十六進位色碼)、\`supabase/auth#6603\`(GitHub issue)"
echo "  · **錨尾**:\`^### #[0-9]{1,3}\` 沒錨尾會把 \`#220b\` / \`#220c\` 讀成 \`#220\`,報出假重複"
echo "  · 🔴 **backlog 號與色碼在字形上是同一個東西,差別只在前後那一個字元。**"
echo "  · ⇒ 不管用哪個 pattern,**命中都要開檔看一眼再採信**。"
echo ""
echo "── 🔴 發號【之前】還有一步:這件事是不是已經有號了(別名檢查)──"
echo "  · 撞號掃描只問「這個號有沒有人用」,**沒問「這件事有沒有人登記過」**"
echo "  · ⇒ 拿你要發的那條的**症狀關鍵字**跑一次:"
echo "        python3 scripts/backlog-duplicate-scan.py --search 詞1 詞2 …"
echo "  · 🔴 **「我有獨立證據」不是「這是新的」的證明** —— 有新數據點的那一刻最不會懷疑自己。"
