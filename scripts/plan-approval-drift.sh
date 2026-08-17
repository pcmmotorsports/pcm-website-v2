#!/usr/bin/env sh
# plan-approval-drift.sh —— 找出「plan 檔頭說【等 Sean 批】,而別處說【已批】」的那一族。
#
# 為什麼要它(2026-08-18 T 線,主視窗指定做成機制而不是一次清理):
#   當晚實查 docs/specs/*.md,發現 **5 份已批的 plan,檔頭仍寫著等批**,
#   其中 4 份是最近兩天批的 ⇒ **不是疏忽,是這個流程從來沒有把批准寫回 plan 過。**
#   而 2 份的檔頭寫的是「尚未批准,未動任何 code」——比「等批」更強的禁止句
#   ⇒ **下一個窗打開那份 plan,會讀到那句然後放下。批准存在,但存在錯地方。**
#   一次清理修得掉那 5 份,修不掉下一批 ⇒ 要一道便宜到每次都會跑的檢查。
#
# 🔴🔴 **這支腳本【看不到】什麼 —— 先讀完再用它的輸出**
#   ① **批准字面常常不提檔名。** 當晚那份 max-rows plan 的批准逐字是「D2 ＝ 甲(兩件都做)」
#      —— 整句沒有出現檔名 ⇒ **靠檔名交叉比對的本腳本抓不到它**。
#      ⇒ 本腳本會把它歸進「無批准字面」那一堆,而它其實已批。**這是已知的假陰性,不是 bug。**
#   ② **它只看檔頭前 8 行。** 檔頭沒寫「等批」而實際卡住的那一族,本腳本看不到 —— 那一族沒有量法。
#   ③ **「零提及」只代表【memory/ 與 MAIN-*.md 這兩個載體】查不到**,
#      不代表沒批 —— 批准也可能落在別的窗的信、commit body、或只在對話裡。
#   ⇒ **本腳本的輸出是【要人去看的清單】,不是判決。**
#
# 用法:
#   sh scripts/plan-approval-drift.sh              掃真實路徑
#   sh scripts/plan-approval-drift.sh --selftest   兩個世界(已知矛盾必抓到 / 已知一致必不抓)
#
# 可覆寫(selftest 用):PLAN_DIR / CARRIER_GLOB
set -u

PLAN_DIR="${PLAN_DIR:-docs/specs}"
CARRIER_GLOB="${CARRIER_GLOB:-}"

# 檔頭「還在說等批」的字面。
# 🔴 刻意【不含】「零實作」—— 那句多半在說「這份檔是計畫、不含 code」,
#    是永遠成立的描述,不是批准狀態。2026-08-18 第一版把它收進來,36 份裡誤收 9 份。
PENDING_PAT='等 Sean 批|尚未批准|待批准|批准前|等 Sean 拍|等待批准'
# 別處「說已批」的字面。
APPROVED_PAT='批准|已批|批甲|現在批|可以做|拍板|開工'

carriers() {
  if [ -n "$CARRIER_GLOB" ]; then
    # shellcheck disable=SC2086
    ls $CARRIER_GLOB 2>/dev/null
  else
    ls "$HOME/.claude/projects/-Users-sean-1-pcm-website-v2/memory/"*.md 2>/dev/null
    ls "$HOME/pcm-mailbox/MAIN-"*.md 2>/dev/null
  fi
}

scan() {
  _total=0; _pending=0; _mismatch=0; _mentioned=0; _silent=0
  _mismatch_list=''; _silent_list=''; _mentioned_list=''
  for f in "$PLAN_DIR"/*.md; do
    [ -f "$f" ] || continue
    _total=$((_total + 1))
    head -8 "$f" | grep -qE "$PENDING_PAT" || continue
    _pending=$((_pending + 1))
    _stem=$(basename "$f" .md)
    # 該檔名被提到的那幾行(只看提到檔名的【那一行】—— 射程①說的假陰性就在這裡)
    _lines=$(carriers | while read -r c; do grep -h "$_stem" "$c" 2>/dev/null; done)
    # 🔴 把【命中的那一行】一起帶出去 —— 2026-08-18 實例:brand-showcase 那份的命中句是
    #    「鐵則 8 重大改動 → 先提 plan 等 Sean 批准才動工」= **在敘述規則**,不是狀態欄
    #    (真正的狀態欄長這樣:「狀態:等 Sean 批。批准前一行 code 都不動。」)。
    #    ⇒ 這兩種在 grep 命中數上長得一樣,而【貼出原句】讓人五秒分得出來,
    #      比讓腳本去猜「這句是不是狀態」可靠得多。
    _hit=$(head -8 "$f" | grep -m1 -E "$PENDING_PAT" | sed 's/^[[:space:]>*]*//' | cut -c1-88)
    if [ -z "$_lines" ]; then
      _silent=$((_silent + 1)); _silent_list="$_silent_list$_stem
"
    elif printf '%s' "$_lines" | grep -qE "$APPROVED_PAT"; then
      _mismatch=$((_mismatch + 1)); _mismatch_list="$_mismatch_list$_stem
        命中句: $_hit
"
    else
      _mentioned=$((_mentioned + 1)); _mentioned_list="$_mentioned_list$_stem
"
    fi
  done
}

report() {
  echo "分母  $PLAN_DIR/*.md ⇒ $_total 份;檔頭(前 8 行)說等批 ⇒ $_pending 份"
  echo
  echo "🔴 A 檔頭說等批,而載體裡有【批准字面】⇒ $_mismatch 份(要人看)"
  [ -n "$_mismatch_list" ] && printf '%s' "$_mismatch_list" | sed 's/^/     /'
  echo "   ⚠️ 這一堆是【疑似矛盾】不是判決 —— 那個批准字面可能講的是別件事,自己開檔核對。"
  echo "   🔴 而【命中句常常只有一半過期】,不要整段劃掉:"
  echo "      實例(2026-08-18 B 窗實作時撞到):「等 Sean 批。批准後第一個動作是 B0,不是寫 code。」"
  echo "      前半=狀態(已過期);後半=【批准下來才生效】的做法約束 ⇒ 現在正是它該生效的時候。"
  echo "      ⇒ 逐句判,不要整段標紅或整段刪。本尺指出的是【位置】,不是【處置方式】。"
  echo
  echo "B 檔頭說等批,載體有提到但【無批准字面】⇒ $_mentioned 份"
  [ -n "$_mentioned_list" ] && printf '%s' "$_mentioned_list" | sed 's/^/     /'
  echo "   🔴 **這一堆裡藏著假陰性** —— 批准常常不提檔名(例:「D2 ＝ 甲」整句沒有檔名)。"
  echo
  echo "C 檔頭說等批,兩個載體【零提及】⇒ $_silent 份"
  echo "   ⚠️ 零提及 ≠ 沒批。只代表這兩個載體查不到(批准可能在別的窗的信/commit body/對話裡)。"
  echo
  echo "🔴 本腳本看不到:檔頭【沒寫】等批而實際卡住的那一族 —— 那一族沒有量法。"
}

selftest() {
  _t=$(mktemp -d) || exit 1
  # trap 要在這裡就掛 —— 下面每一步都可能失敗,而失敗時 fixture 不該留在磁碟上。
  trap 'rm -rf "$_t"' EXIT INT TERM
  mkdir -p "$_t/specs" "$_t/carrier"

  # 世界一:已知【矛盾】—— 檔頭說等批,而載體同一行有批准字面 + 檔名
  printf '# Plan:某件事\n\n> **狀態:等 Sean 批。批准前一行 code 都不動。**\n' \
    > "$_t/specs/known-contradiction-plan.md"
  printf 'Q4 那件事 ⇒ A:現在批准。plan 在 docs/specs/known-contradiction-plan.md\n' \
    > "$_t/carrier/m.md"

  # 世界二:已知【一致】—— 檔頭說等批,而載體【完全沒提】它
  printf '# Plan:另一件事\n\n> **狀態:等 Sean 批。**\n' \
    > "$_t/specs/known-consistent-plan.md"

  PLAN_DIR="$_t/specs" CARRIER_GLOB="$_t/carrier/*.md" scan
  _pass=0; _fail=0
  _ck() {
    if [ "$2" = "$3" ]; then _pass=$((_pass + 1)); echo "PASS  $1"
    else _fail=$((_fail + 1)); echo "FAIL  $1  得到「$2」預期「$3」"; fi
  }
  _ck "格1 兩份都被認成【檔頭說等批】" "$_pending" "2"
  _ck "格2 已知矛盾那份被抓進 A 堆" \
      "$(printf '%s' "$_mismatch_list" | grep -c 'known-contradiction')" "1"
  _ck "格3 🔴 已知一致那份【不得】被抓進 A 堆(負測:少了它,一個恆抓的腳本也會全綠)" \
      "$(printf '%s' "$_mismatch_list" | grep -c 'known-consistent')" "0"
  _ck "格4 已知一致那份落在 C(零提及)堆" \
      "$(printf '%s' "$_silent_list" | grep -c 'known-consistent')" "1"
  _ck "格5 A 堆總數恰為 1(不是把兩份都收進來)" "$_mismatch" "1"
  # 🔴 格6:證明「零實作」沒有被收進 PENDING_PAT —— 那是第一版誤收 9 份的原因。
  printf '# Plan:第三件\n\n> **零實作,本檔只是計畫。**\n' > "$_t/specs/zero-impl-plan.md"
  PLAN_DIR="$_t/specs" CARRIER_GLOB="$_t/carrier/*.md" scan
  _ck "格6 只寫「零實作」的檔【不算】等批(它描述檔的性質,不是批准狀態)" "$_pending" "2"
  echo
  echo "合計  PASS=$_pass  FAIL=$_fail"
  [ "$_fail" = "0" ] || exit 1
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
else
  scan
  report
fi
