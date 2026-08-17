#!/bin/sh
# pagecount — 把一份 HTML 用 headless Chrome 印成 PDF,回報【頁數】。
#
# 🔴 存在的理由:出貨明細單的驗收條件是「單品項訂單一頁印完」,
#    而那句話只有【真的印出來數頁數】才驗得掉。收窄要跑很多輪 ⇒ 值得做成工具。
#
# exit code(🔴 三種分得開,不共用 0/1):
#   0 = 印成功,頁數印在 stdout
#   2 = 用法錯(沒給檔 / 檔不存在)
#   3 = Chrome 沒有產出 PDF(工具自壞 / 逾時)—— 🔴 【不是】「0 頁」
#   4 = PDF 產出了但數不出頁數(格式非預期)
#
# 🔴 為什麼要先 rm 目標檔:Chrome 失敗時舊 PDF 會留在原地,
#    而讀到的是【上一輪的頁數】—— 那個數字看起來完全正常。
#    這一條是本工具存在的第二個理由,比「會不會印」還重要。
#
# ── 🔴 本工具的分母【不含什麼】(2026-08-17 落地時寫,不是事後補)──────────
#   它只做一件事:把 HTML 印成 PDF、數 PDF 裡 `/Type /Page` 的出現次數。
#   **它不驗頁面內容對不對。** 具體來說,下面每一種它都會回一個【看起來很正常的頁數】:
#     · 中文變成亂碼(charset 沒生效)⇒ 亂碼一樣有寬度,一樣會排版,一樣數得出頁數
#       🔴 2026-08-17 A 窗真的踩過這一發(`python3 -m http.server` 不送 charset)
#     · 頁面上有【不該印在紙上】的東西(註解框、除錯標記)⇒ 它照樣算進高度
#       🔴 同日本窗真的踩過這一發(給 Sean 看的兩個虛線註解框混進量具)
#     · 版面壞掉、圖沒載入、字型 fallback ⇒ 一律照數
#   ⇒ **量完之後要把那一頁輸出成人看得懂的形式看一眼**(`--screenshot=x.png` 然後真的開來看),
#     再採信任何數字。**自檢驗的是尺,看產出才驗得到「我量的是不是那個東西」。**
#
# ── ⚠️ 已知噪音(不要去修)────────────────────────────────────────────
#   `--selftest` 的 stderr 會印 `rm: /var/folders/.../pcprof.xxx: Permission denied`
#   —— 清 Chrome 暫存 profile 被沙箱擋。**不影響結果與 exit code。**
#   刻意不修:修它要動沙箱權限,而**那條路上沒有事**
#   (memory `feedback_a-guard-on-a-safe-path-is-net-negative`)。
#
# ── 🔴 三綠對這支是【空跑的綠】────────────────────────────────────────
#   `pnpm lint` / `typecheck` 不吃 `.sh`;pre-commit 的 `check-syntax-nonts.ts` 只驗語法。
#   ⇒ **語法對 ≠ 它量得準。本支的判別力【只有 `--selftest`】。**
#   ⇒ 已掛進 lint-staged:這支被 stage 時自動跑 selftest(要 Chrome 在)。
#
# 用法:
#   sh scripts/pagecount.sh docs/probes/xxx.html
#   sh scripts/pagecount.sh --selftest

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

count_pages() {
  python3 - "$1" <<'PY'
import io,re,sys
d=io.open(sys.argv[1],'rb').read()
n=len(re.findall(rb'/Type\s*/Page[^s]', d))
print(n if n>0 else -1)
PY
}

render() {
  src=$1
  out=$(mktemp -t pagecount).pdf
  prof=$(mktemp -d -t pcprof)
  rm -f "$out"                       # 🔴 先刪:不讓上一輪的產物混進來
  "$CHROME" --headless --disable-gpu --no-sandbox \
    --user-data-dir="$prof" --no-pdf-header-footer \
    --print-to-pdf="$out" "file://$src" >/dev/null 2>&1 &
  pid=$!
  i=0
  while [ $i -lt 30 ]; do            # 🔴 判準 = 產出有沒有出現,不是程序還在不在
    if [ -s "$out" ]; then sleep 1; break; fi
    sleep 1
    i=$((i+1))
  done
  kill $pid 2>/dev/null
  rm -rf "$prof"
  if [ ! -s "$out" ]; then rm -f "$out"; return 3; fi
  echo "$out"
  return 0
}

if [ "$1" = "--selftest" ]; then
  # 🔴 雙向表演:一份一定 1 頁的、一份一定 2 頁以上的。兩發都對才算工具可信。
  one=$(mktemp -t pc1).html
  two=$(mktemp -t pc2).html
  printf '%s' '<!doctype html><meta charset="utf-8"><style>@page{size:A4}</style><body>一頁</body>' > "$one"
  printf '%s' '<!doctype html><meta charset="utf-8"><style>@page{size:A4}div{height:400mm}</style><body><div>跨頁</div></body>' > "$two"
  # 🔴🔴 兩種失敗【刻意用不同的開頭字串】:`ENV-FAIL` vs `BROKEN`。
  #    理由:掛進 pre-commit 之後,「Chrome 起不來」與「你改壞了判別力」都會擋下 commit,
  #    而**擋下的理由如果長得一樣,下一個人會以為是自己改壞的**、跑去改一支好的工具。
  #    ⇒ 這正是四條要件的第 2 條(輸出層要分得出【真發現】與【工具自壞】)。
  #    ⇒ 掃 log 的人要一眼分得開,所以兩段訊息不共用開頭。
  if [ ! -x "$CHROME" ]; then
    echo "ENV-FAIL  找不到 Chrome:$CHROME"
    echo "ENV-FAIL  🔴 這【不是】你改壞了 —— 是環境。裝好 Chrome 再跑;"
    echo "ENV-FAIL     真的要先過,用 git commit --no-verify 並在 commit body 註明跳過原因。"
    rm -f "$one" "$two"
    exit 3
  fi
  fail=0
  envfail=0
  for pair in "$one:1" "$two:2"; do
    f=${pair%:*}; want=${pair#*:}
    got=$(sh "$0" "$f"); rc=$?
    # 🔴🔴 **精確比對,不用 `-ge`**(2026-08-17 落地當天自己踩到):
    #    原本寫 `[ "$got" -ge "$want" ]` ⇒ 把數頁數改成「永遠回 99」之後
    #    `99 >= 1` 與 `99 >= 2` **兩格都通過**,selftest 印「全過」。
    #    ⇒ 那是四條要件的第 1 條:**判斷式在【壞掉】的世界恰好為真。**
    #    ⇒ 一頁那份必須【剛好 1】、跨頁那份必須【剛好 2】(400mm 內容 / 271mm 可印高度)。
    if [ "$rc" -eq 0 ] && [ "$got" = "$want" ]; then
      echo "PASS  $(basename "$f") 期望 =$want 得 $got"
    elif [ "$rc" -eq 3 ]; then
      echo "ENV-FAIL  $(basename "$f") Chrome 沒有產出 PDF(逾時 / 被佔 / 沙箱擋)"
      echo "ENV-FAIL  🔴 這【不是】你改壞了 —— 是環境。機器負載高時會逾時,慢不等於壞。"
      envfail=1
    else
      echo "BROKEN  $(basename "$f") 期望 =$want 得 '$got' rc=$rc"
      echo "BROKEN  🔴 selftest 的期望值對不上 ⇒ 你改壞了這支的判別力。修好再 commit。"
      fail=1
    fi
  done
  # 🔴 第三發:餵一個不存在的檔,必須回 2 而不是「0 頁」
  sh "$0" /tmp/definitely-not-here-20260817.html >/dev/null 2>&1
  if [ $? -eq 2 ]; then
    echo "PASS  不存在的檔 ⇒ rc=2(用法錯),不是 0 頁"
  else
    echo "BROKEN  不存在的檔沒回 2 ⇒ 「查無此檔」與「0 頁」混在一起了"
    fail=1
  fi
  rm -f "$one" "$two"
  if [ $fail -ne 0 ]; then
    echo "selftest BROKEN —— 判別力壞了,修好再 commit"
    exit 1
  fi
  if [ $envfail -ne 0 ]; then
    echo "selftest ENV-FAIL —— 環境問題,不是這支的判別力"
    exit 3
  fi
  echo "selftest 全過"
  exit 0
fi

[ -n "$1" ] || { echo "用法: sh $0 <file.html> | --selftest" >&2; exit 2; }
[ -f "$1" ] || { echo "查無此檔: $1" >&2; exit 2; }

pdf=$(render "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")") || {
  echo "Chrome 沒有產出 PDF(工具自壞或逾時)—— 這【不是】0 頁" >&2
  exit 3
}
n=$(count_pages "$pdf")
rm -f "$pdf"
[ "$n" -gt 0 ] 2>/dev/null || { echo "PDF 產出了但數不出頁數" >&2; exit 4; }
echo "$n"
