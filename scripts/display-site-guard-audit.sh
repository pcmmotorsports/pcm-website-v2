#!/usr/bin/env bash
# display-site-guard-audit.sh — 「某個值有幾個顯示點、各自有沒有被守門」
#
# 🔴 **它只回答這一個問題,不是通用工具。**
#    催生它的事故(2026-08-16,同一晚兩次):
#      · 有人用 `grep 函式名` 判「零守門」,而那格斷言的是【渲染出來的字面】⇒ 判錯
#      · 🔴🔴 那不是隨機失手,是【有方向的】:**越接近「斷言行為而非實作」的測試,
#        越不會被識別字 pattern 抓到** —— 而那正是我們推崇的那種測試。
#    ⇒ 本腳本強制**同時**吃【識別字】與【渲染字面】兩組 pattern,缺一不跑。
#
# 用法:
#   ./scripts/display-site-guard-audit.sh \
#       --id 'customerEmailDisplay|LINE_NO_EMAIL_LABEL' \
#       --literal 'LINE 帳號登入,無 Email|line_u|pcmmotorsports\.local' \
#       [--ref <git-ref>]        # 對某個歷史版本跑（正向對照用）
#
# 🔴 **它證明不了的事(照實印在輸出裡,不要只寫在這裡)**:
#   · 「某支測試真的渲染到某個顯示點」—— grep 看不到 import 鏈與整頁渲染
#     ⇒ 本腳本只報「**有沒有【看起來相關】的測試**」,判定仍要人開檔看
#   · 動態組出來的字串、i18n key、DB 裡的資料列
set -uo pipefail

ID_PAT=""; LIT_PAT=""; REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --id)      ID_PAT="${2:-}"; shift 2 ;;
    --literal) LIT_PAT="${2:-}"; shift 2 ;;
    --ref)     REF="${2:-}"; shift 2 ;;
    *) echo "未知參數:$1" >&2; exit 2 ;;
  esac
done

# 🔴 兩組 pattern 缺一就拒跑 —— 這條就是本腳本存在的理由,不能有「只給一組也能跑」的路徑。
if [ -z "$ID_PAT" ] || [ -z "$LIT_PAT" ]; then
  echo "⛔ --id 與 --literal 兩組 pattern 都是必填。" >&2
  echo "   只給識別字 ⇒ 會漏掉所有『斷言渲染結果』的測試(本腳本存在的理由)。" >&2
  echo "   只給渲染字面 ⇒ 會漏掉純邏輯單測。" >&2
  exit 2
fi

# 對歷史版本跑時,用 `git grep <ref>`;對工作區跑時用 `git grep`(含未 commit)。
g() { if [ -n "$REF" ]; then git grep -I -n -E "$1" "$REF" -- "${@:2}" 2>/dev/null | sed "s|^$REF:||"; \
      else git grep -I -n -E "$1" -- "${@:2}" 2>/dev/null; fi; }

# 🔴 含 `.css`:對「token 定義了但零消費端」這種題有用(便宜)。
#    ⚠️ **而 CSS 這一類只到字面層** —— 限度印在輸出結尾第 5 條,不只寫在這裡。
SRC_GLOBS=('apps/*/src/**/*.ts' 'apps/*/src/**/*.tsx' 'apps/*/src/**/*.css' \
           'packages/*/src/**/*.ts' 'packages/*/src/**/*.tsx' 'packages/*/src/**/*.css')
echo "════════════════════════════════════════════════════════════════"
# 🔴 這三行**每次跑都印**,不是只在 --help ——
#    最容易只看到輸出、而不會去讀檔頭或路由表的那個人,最需要這句話。
echo "🔴 ✅ 不是判決。本工具只說「有沒有【檔名對應】的測試」,"
echo "   說不出「那支測試真的驗到了這個顯示點」。✅ 要開檔確認,❓ 更要。"
echo "🔴 而【顯示點清單由你給的 --id / --literal 決定】,不是由「這個值有幾個顯示點」決定。"
echo "   換一個名字(TIER_LABEL → TierText)就整張漏掉,而報告上【看不出少了東西】。"
echo "   ⇒ 下面那個「N 個顯示點」是【pattern 的產物】,不是【事實】。"
echo "════════════════════════════════════════════════════════════════"
echo "顯示點 × 守門 盤點    ref=${REF:-<工作區>}"
echo "  識別字 pattern : $ID_PAT"
echo "  渲染字 pattern : $LIT_PAT"
echo "════════════════════════════════════════════════════════════════"

# ── ① 顯示點 = 非測試檔裡引用識別字的地方(排掉定義本身由人判斷) ──────────────
echo
echo "── ① 顯示點(非測試檔命中識別字)"
SITES="$(g "$ID_PAT" "${SRC_GLOBS[@]}" | grep -v -E '\.test\.|__tests__|/__mocks__/' || true)"
if [ -z "$SITES" ]; then
  echo "   🔴 零命中。**這不代表沒有顯示點** —— 先確認 --id pattern 對不對(分母為 0 時本報告無效)。"
  exit 1
fi
echo "$SITES" | sed 's/^/   /'
SITE_FILES="$(echo "$SITES" | cut -d: -f1 | sort -u)"
echo "   ⇒ 涉及 $(echo "$SITE_FILES" | wc -l | tr -d ' ') 個檔"

# ── ② 候選守門 = 測試檔命中【識別字】或【渲染字面】────────────────────────────
echo
echo "── ② 候選守門(測試檔;兩組 pattern 各自分開列,差異就是重點)"
T_ID="$(g "$ID_PAT" "${SRC_GLOBS[@]}" | grep -E '\.test\.' | cut -d: -f1 | sort -u || true)"
T_LIT="$(g "$LIT_PAT" "${SRC_GLOBS[@]}" | grep -E '\.test\.' | cut -d: -f1 | sort -u || true)"
echo "   [識別字命中]"; [ -n "$T_ID" ] && echo "$T_ID" | sed 's/^/     /' || echo "     (無)"
echo "   [渲染字命中]"; [ -n "$T_LIT" ] && echo "$T_LIT" | sed 's/^/     /' || echo "     (無)"
ONLY_LIT="$(comm -13 <(echo "$T_ID") <(echo "$T_LIT") 2>/dev/null || true)"
if [ -n "$ONLY_LIT" ]; then
  echo "   🔴 只有渲染字才抓得到的(= 純識別字量法會【整批漏掉】這些):"
  echo "$ONLY_LIT" | sed 's/^/     /'
fi
GUARDS="$(printf '%s\n%s\n' "$T_ID" "$T_LIT" | grep -v '^$' | sort -u || true)"

# ── ③ 逐個顯示點 × 有沒有看起來相關的守門 ────────────────────────────────────
echo
echo "── ③ 逐個顯示點判定"
echo "   🔴🔴 **本節【刻意不做寬鬆比對】,而那是踩出來的**:"
echo "      第一版用『測試路徑含該顯示點的目錄名』當判準 ⇒ 對 2026-08-16 的已知缺口跑正向對照,"
echo "      它回報【0 個缺口】,把那個真的沒守門的檔標成 ✅ ——"
echo "      **因為 app/customers/page.test.tsx 的路徑含 customers,於是 components/customers/ 底下每個檔都算被守。**"
echo "      ⇒ **工具自己在假裝成功**,而那是本 repo 今晚一直在抓的形狀。"
echo "   ⇒ 現在只認【檔名精確對應】為 ✅;其餘一律 ❓,由人開檔判。"
echo "      ⚠️ 這會產生假警報(跨目錄的頁級測試會被標 ❓)—— **那個方向是刻意選的**:"
echo "      **假警報讓人多看一眼;假 ✅ 讓人再也不看。**"
GAP=0; UNKNOWN=0
for f in $SITE_FILES; do
  # 🔴 **用參數展開剝副檔名,不用 sed** —— 第一版用 `sed 's/\.[tj]sx\?$//'`,
  #    而 **macOS 的 BSD sed 在 BRE 下把 `\?` 當【字面問號】,不是「可選」**
  #    ⇒ **副檔名從來沒被剝掉** ⇒ 檔名比對永遠不成立。
  #    ⚠️ 而第一版的寬鬆目錄比對**把這個 bug 整個遮住**(什麼都判 ✅)——
  #    **修好遮蔽的那層之後,底下的第二個 bug 才露出來。**
  #    🔴 「修好 A 之後 B 紅了」⇒ 第一問不是「我弄壞 B 了嗎」,是「**B 之前為什麼是綠的**」。
  base="${f##*/}"
  for ext in .tsx .ts .jsx .js; do base="${base%$ext}"; done
  exact=""
  for gt in $GUARDS; do
    gb="${gt##*/}"
    for ext in .test.tsx .test.ts .test.jsx .test.js; do gb="${gb%$ext}"; done
    # 檔名精確、或 <檔名>-<後綴> 形式（例 customer-detail → customer-detail-email.test.tsx）
    case "$gb" in
      "$base"|"$base"-*) exact="$exact $gt" ;;
    esac
  done
  if [ -n "$exact" ]; then
    printf '   ✅ %s\n' "$f"; for h in $exact; do printf '        ← %s\n' "$h"; done
  else
    printf '   ❓ %s   ← 沒有檔名對應的測試；可能被【跨目錄的頁級測試】守著，要開檔確認\n' "$f"
    UNKNOWN=$((UNKNOWN+1))
  fi
done

echo
echo "════════════════════════════════════════════════════════════════"
echo "檔名對應找不到守門的顯示點:$UNKNOWN 個  ⇒ 🔴 這【不是】缺口數,是【要人開檔看的數】"
echo "🔴 本報告【證明不了】的事(不要只當它掃過了):"
echo "  1. 「某支測試真的渲染到某個顯示點」—— grep 看不到 import 鏈與整頁渲染。"
echo "     ⇒ ✅ 只代表「有看起來相關的測試」,🔴 只代表「值得開檔看」,兩者都不是判決。"
echo "  2. 只掃檔案裡的字面:動態組出的字串、i18n key、DB 資料列,一律掃不到。"
echo "  🔴 5. CSS token 這一類,本工具只答得出「有沒有人【寫】 var(--x)」。"
echo "     答不出「那個效果【真的有跑】」—— 瀏覽器算出來的用值 grep 不到。"
echo "     ⇒ 這一類的 ✅／❓ 都只到【字面層】,真正的觀察點在真瀏覽器。"
echo "     📎 house 同條:「CSS 守門釘的是字面、壞掉的是瀏覽器算出的用值」。"
echo "  3. 🔴 ③ 的比對是【檔名/目錄啟發式】—— 跨目錄的頁級測試(例:訂單頁測試守著客戶側的函式)"
echo "     可能被判成無關。**那正是本腳本自己最容易犯的錯,而它與它要抓的病同族。**"
echo "════════════════════════════════════════════════════════════════"
