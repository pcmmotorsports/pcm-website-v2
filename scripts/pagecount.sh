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
#   4 = 有兩個意思(**本來就是這樣, 不是本次改的**):
#         · `--png`:gs 沒有產出任何 PNG —— 🔴 【不是】空白頁
#         · 主路徑:PDF 產出了但數不出頁數(格式非預期)
#       ⚠️ 兩者都是「產出在, 而下一步壞了」⇒ 共用一個碼今天說得過去。
#         🔴 而它與 `--selftest` 的 `1`(判別力壞了)刻意不共用 —— 那才是分得開的那一刀。
#   ⚠️ `render()` 內部另有一個 4 =「建不出暫存目錄」, 那是【函式的回傳值, 不是腳本的 exit code】:
#      呼叫端收到它仍然 `exit 3`, 只是把訊息從「Chrome 壞了」換成「環境壞了」。
#      🔴 這兩個 4 不同命名空間 —— 寫在這裡免得下一個人以為它們撞號了。
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
# ── ✅ ~~已知噪音(不要去修)~~ **作廢:2026-08-27 已修** ──────────────────
#   ~~`--selftest` 的 stderr 會印 `rm: /var/folders/.../pcprof.xxx: Permission denied`,
#   刻意不修, 那條路上沒有事。~~
#   🔴 **而「那條路上沒有事」是錯的 —— 我去數了:那串紅字每印一次, 就留下一個目錄。**
#      2026-08-27 實測 /var/folders 殘留:`pcprof.*` 目錄 **166** 個 ·
#      `pagecount.*` **171** · `pc1.*` **57** · `pc2.*` **57**(後三者全是 0 bytes)。
#   📌 **一段「不要去修」的註解, 會關掉下一個人去【數一下】的動作** ——
#      而它當初被寫下來的理由(不影響結果與 exit code)到今天仍然成立。
#      ⇒ 判準錯的不是「影不影響 exit code」, 是**把「不影響判定」讀成了「沒有代價」**。
#   成因(量到的, 不是推的):`kill` 是非同步的 ⇒ Chrome 還沒退, 它的 cache 目錄不可寫
#      ⇒ `rm -rf` 印紅字而【刪不掉】。修法 = 有上限地等它退 + `chmod -R` + 整個目錄一起收。
#
# ── 🔴 三綠對這支是【空跑的綠】────────────────────────────────────────
#   `pnpm lint` / `typecheck` 不吃 `.sh`;pre-commit 的 `check-syntax-nonts.ts` 只驗語法。
#   ⇒ **語法對 ≠ 它量得準。本支的判別力【只有 `--selftest`】。**
#   ⇒ 已掛進 lint-staged:這支被 stage 時自動跑 selftest(要 Chrome 在)。
#
# 用法:
#   sh scripts/pagecount.sh docs/probes/xxx.html
#   sh scripts/pagecount.sh --png docs/probes/xxx.html /tmp/shots   ⇒ 每頁一張 PNG,開來看
#   sh scripts/pagecount.sh --selftest
#
# 🔴 上面第 25 行那句「量完之後要把那一頁輸出成人看得懂的形式看一眼」**現在有工具了**
#    (`--png`,2026-08-17 晚補)。在那之前它是一句沒有落點的指示,而**沒有落點的指示不會被執行** ——
#    實錘:同日有一輪量到「貼底之後 2 頁」,而**第 2 頁上有沒有東西沒有人看過**,那條線就卡在那裡。

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
  # 🔴 `mktemp -t <前綴>` 是 BSD 方言, 在 GNU coreutils(Linux / CI)上【必炸】
  #    —— 同族實錘見 `.husky/commit-msg` 檔頭與 `7efbe93d`(2026-08-27 CI 實證)。
  # 🔴 而這裡原本【多一層】:`$(mktemp -t pagecount).pdf` 是在字串後面接副檔名
  #    ⇒ mktemp 真的建了 `pagecount.XXXX`, 而 `$out` 是【另一個】名字 `pagecount.XXXX.pdf`
  #    ⇒ **那個真的被建出來的檔從來沒有人刪**。2026-08-27 實測殘留:
  #       pagecount.* 171 個 · pc1.* 57 · pc2.* 57 · pcprof.* 目錄 166(全部 0 bytes)
  #    ⇒ 所以修法不是把 `-t` 換成模板就好 —— 改成【一個拋棄式目錄, 檔名自己取】:
  #      兩邊方言都吃、名字仍然唯一、而且離開時整個目錄一起收掉、零殘留。
  # 🔴 code-reviewer nit:回 3 會與「Chrome 沒產出 PDF」撞號 ⇒ 呼叫端印的固定訊息
  #    會把「磁碟滿 / TMPDIR 不可寫」講成「Chrome 壞了」⇒ 指錯除錯方向。用專屬的 4。
  #    📌 這正是今天 `migration-ledger-divergence.sh` 那五格的同一個病:同一個數字兩個意思。
  _w=$(mktemp -d "${TMPDIR:-/tmp}/pagecount.XXXXXX") || { echo "ENV-FAIL  建不出暫存目錄(mktemp)⇒ 這【不是】你改壞了, 是環境。" >&2; return 4; }
  out="$_w/out.pdf"
  prof="$_w/prof"
  mkdir -p "$prof"
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
  # 🔴 三件事缺一不可, 而它們是 2026-08-27 一發一發試出來的, 不是設計出來的:
  #  ① `wait`:`kill` 是非同步的 —— 不等它真的退, 它的 `prof/Default/Cache` 當下【不可寫】。
  #  ② `chmod -R`:Chrome 把 cache 目錄設成不可寫 ⇒ 少了它 `rm -rf` 會印一串 Permission denied。
  #  ③ 而漏了任何一件的症狀【都是同一個】:一串紅字 + 目錄還在, 而 selftest 照樣 `全過`。
  #    舊版就是這樣在 /var/folders 留了 166 個 `pcprof.*` 目錄, 而沒有人看那串紅字。
  # 🔴 code-reviewer must-fix:原本寫 `wait $pid` —— 而 `kill` 只送 SIGTERM,
  #    Chrome 卡在清理狀態時 `wait` 會【永遠不回來】⇒ 而這支掛在 lint-staged 上
  #    ⇒ `git add scripts/pagecount.sh` 就會自己觸發 ⇒ **整個 commit 卡死, 沒有逃生路**。
  #    📌 舊版沒有這一行 ⇒ 那個掛死路徑是我這次改動【新引進】的, 不是本來就有的。
  #    ⇒ 改成有上限的等待:最多 10 秒, 之後 SIGKILL。等它退是為了②那一行 chmod 才有效。
  _k=0
  while kill -0 $pid 2>/dev/null && [ $_k -lt 10 ]; do sleep 1; _k=$((_k + 1)); done
  # ⚠️ R2 nit(已知角落, 未能構造出可重現案例):10 秒窗內若 OS 把這個 pid 分配給別的程序,
  #    `kill -9 $pid` 理論上會誤殺它。留著這句是要下一個人知道這個角落存在。
  kill -9 $pid 2>/dev/null
  chmod -R u+rwX "$_w" 2>/dev/null || true
  rm -rf "$prof"
  # 🔴 產不出來就整個目錄收掉(含那個 0 byte 的空殼)——「沒產出」與「產了空的」都算失敗。
  if [ ! -s "$out" ]; then rm -rf "$_w"; return 3; fi
  # ⚠️ 成功時【不刪 $_w】:呼叫端要拿 $out 去讀。清理責任在呼叫端(與改版前相同)。
  echo "$out"
  return 0
}

if [ "$1" = "--selftest" ]; then
  # 🔴 雙向表演:一份一定 1 頁的、一份一定 2 頁以上的。兩發都對才算工具可信。
  # 🔴 同上:BSD 方言 + 借名字後遺棄。自檢這兩份改放進同一個拋棄式目錄。
  # 🔴 這裡回 3(環境)不是 2(用法錯)—— 建不出暫存目錄不是使用者打錯指令。
  #    與下面 `envfail ⇒ exit 3` 同一個意思, 刻意對齊。
  _sw=$(mktemp -d "${TMPDIR:-/tmp}/pcself.XXXXXX") || { echo "ENV-FAIL  建不出暫存目錄(mktemp)⇒ 這【不是】你改壞了, 是環境。" >&2; exit 3; }
  # ⚠️ R2 nit(shell 機制天花板, 不是本次缺陷):`trap EXIT` 對 SIGKILL 無效 ——
  #    例如 lint-staged 逾時後把整條命令鏈 SIGKILL, `$_sw` 就會留下來。
  trap 'rm -rf "$_sw"' EXIT
  one="$_sw/pc1.html"
  two="$_sw/pc2.html"
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
  # 🔴 第四發:`--png` 必須為跨頁那份產出【剛好 2 張】圖。
  #    沒有這一格的話,`--png` 壞掉會靜默產 0 張,而呼叫的人把「沒圖可看」讀成「沒東西可看」——
  #    那正是這個模式被加進來要解掉的那個病(見下方 `--png` 的檔頭)。
  if ! command -v gs >/dev/null 2>&1; then
    echo "ENV-FAIL  --png 這一格跳過:找不到 gs(Ghostscript)。這【不是】你改壞了。"
    envfail=1
  else
    shotdir="$_sw/shots"; mkdir -p "$shotdir"
    sh "$0" --png "$two" "$shotdir" >/dev/null 2>&1
    _pngrc=$?                        # 🔴 區塊第一句 —— $? 每個指令都會蓋掉
    # 🔴 2026-08-27 用「逐個讓 mktemp 失敗」量出來的:第 4 次失敗打到這個子行程的 render
    #    ⇒ 它 exit 3(環境), 而這一格只看「有幾張圖」⇒ 印 `BROKEN 判別力壞了` ⇒ **rc=1**。
    #    📌 那正是本檔檔頭自己在防的那個病:**擋下的理由長得一樣, 下一個人會以為是自己改壞的**,
    #       然後跑去改一支好的工具。⇒ 環境問題要走 ENV-FAIL, 不走 BROKEN。
    # 🔴 R2 nit 訂正我自己的宣稱:我說「跑過負對照, 沒有被吞」——
    #    而那個負對照只餵了【圖數不對】那一種。R2 另外用 `while(true){}` 逼出
    #    【Chrome 真的逾時】⇒ `--png` 對外也是 rc=3 ⇒ 這個判斷式**分不開那兩種**,
    #    一律當 ENV-FAIL。與本檔主路徑既有慣例一致(rc=3 一律當環境)⇒ 不是迴歸,
    #    而**我原本那句話比我驗過的範圍寬**, 訂正在這裡。
    if [ "$_pngrc" = "3" ]; then
      echo "ENV-FAIL  --png 這一格:子行程回 3(Chrome / 暫存目錄)。這【不是】你改壞了。"
      envfail=1
      shots=skip
    else
      shots=$(ls "$shotdir"/p*.png 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$shots" = "skip" ]; then
      :
    elif [ "$shots" = "2" ]; then
      echo "PASS  --png 跨頁那份 ⇒ 剛好 2 張圖"
    else
      echo "BROKEN  --png 期望 2 張圖,得 '$shots' 張 ⇒ 看得到頁內這件事壞了"
      fail=1
    fi
    rm -rf "$shotdir"
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

# ── `--png`:把每一頁輸出成 PNG,讓人真的開來看 ────────────────────────────
# 🔴 **為什麼要有這個模式**:`pagecount` 只回一個數字,而 2026-08-17 卡住這條線的那一題
#    是「**貼底之後變 2 頁,那第 2 頁上有東西嗎**」—— **數字答不出來**,
#    而當時的 C 窗就停在那裡,因為它的量具答不出它真正想問的問題。
# ⚠️ **本模式不驗任何東西** —— 判別力在【看的人】身上,不在這支。
#    它只保證「你看到的那張圖確實是這份 HTML 印出來的那一頁」。
# ⚠️ 圖的解析度固定 70dpi:夠看版面與有沒有字,**不夠看細字的字型 fallback**。
if [ "$1" = "--png" ]; then
  [ -n "$2" ] && [ -n "$3" ] || { echo "用法: sh $0 --png <file.html> <outdir>" >&2; exit 2; }
  [ -f "$2" ] || { echo "查無此檔: $2" >&2; exit 2; }
  command -v gs >/dev/null 2>&1 || {
    echo "ENV-FAIL  找不到 gs(Ghostscript)。這【不是】版面有問題,是環境:brew install ghostscript" >&2
    exit 3
  }
  pdf=$(render "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")") || {
    _rrc=$?                          # 🔴 必須是這個區塊的【第一句】—— $? 每個指令都會蓋掉
    if [ "$_rrc" = "4" ]; then echo "建不出暫存目錄(磁碟滿 / TMPDIR 不可寫)—— 這【不是】Chrome 的問題" >&2
    else echo "Chrome 沒有產出 PDF(工具自壞或逾時)—— 這【不是】0 頁" >&2; fi
    exit 3
  }
  mkdir -p "$3" || { rm -rf "${pdf%/*}"; exit 2; }
  rm -f "$3"/p*.png                  # 🔴 同 render 那條:不讓上一輪的圖混進來被當成這一輪的
  gs -sDEVICE=png16m -r70 -dNOPAUSE -dBATCH -o "$3/p%d.png" "$pdf" >/dev/null 2>&1
  # 🔴 render 現在回的是 `<拋棄式目錄>/out.pdf` ⇒ 要收【整個目錄】。
  #    只 `rm -f "$pdf"` 會把目錄留下來 —— 那正是舊版 171 個殘留的同一個病, 換了個形狀。
  rm -rf "${pdf%/*}"
  n=$(ls "$3"/p*.png 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || { echo "gs 沒有產出任何 PNG —— 這【不是】空白頁" >&2; exit 4; }
  ls "$3"/p*.png
  exit 0
fi

[ -n "$1" ] || { echo "用法: sh $0 <file.html> | --png <file.html> <outdir> | --selftest" >&2; exit 2; }
[ -f "$1" ] || { echo "查無此檔: $1" >&2; exit 2; }

pdf=$(render "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")") || {
  _rrc=$?                            # 🔴 同上:區塊第一句
  if [ "$_rrc" = "4" ]; then echo "建不出暫存目錄(磁碟滿 / TMPDIR 不可寫)—— 這【不是】Chrome 的問題" >&2
  else echo "Chrome 沒有產出 PDF(工具自壞或逾時)—— 這【不是】0 頁" >&2; fi
  exit 3
}
n=$(count_pages "$pdf")
rm -rf "${pdf%/*}"
[ "$n" -gt 0 ] 2>/dev/null || { echo "PDF 產出了但數不出頁數" >&2; exit 4; }
echo "$n"
