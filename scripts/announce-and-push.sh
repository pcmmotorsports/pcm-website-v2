#!/usr/bin/env bash
# 代推:預告 → push → 【當場量】回填。
#
# 🔴 為什麼有這支:2026-09-01 夜, 主視窗代推那條鏈的「預告」那一步漏了三次,
#    而三次的成因不同(記憶 / 用 push origin dev 而非釘 hash / 急事擠掉)⇒ 提醒治不好。
#    改成寫進一個所有人都撈得到的檔(~/pcm-mailbox/推送預告.md —— 刻意不帶日期,見下)。
# 🔴 而那張表上線第一發就被手填錯:「實際推到」那一欄在 push 還在跑的時候量
#    ⇒ 填成起點 ⇒ 印「🔴 不相等」⇒ 而假警報【看起來像那把尺在工作】, 沒有人會去查。
#    ⇒ 所以那一欄不手填 —— 由本腳本在 rc 印出來【之後】跑 git ls-remote 貼進去。
#    ⇒ ⇒ 它填錯的唯一方式變成【沒填】, 而空白看得出來。
#
# 用法:bash scripts/announce-and-push.sh [<要推的 commit-ish, 預設 dev>]
# 出口:0=推成功且兩欄相等 · 1=push 失敗 · 2=推成功但兩欄不相等(真事故) · 3=用法錯
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 3

TARGET="${1:-dev}"
TIP="$(git rev-parse --short "$TARGET" 2>/dev/null)" || { echo "🔴 解不出 $TARGET"; exit 3; }
FROM="$(git rev-parse --short origin/dev 2>/dev/null)"

# 🔴🔴 **push 之前, 先看【上一發】的 CI** —— 而這是本檔今晚新增的唯一動作。
#    成因(2026-09-04 量到):`1eedfdb8` 的 CI 紅了 **8 小時**才被人看到,
#    而主視窗**在那 8 小時裡推了兩次**, 一次都沒看過 CI。
#    ⇒ 🎯 **⇒ 「我會記得去看」不是可以假設的前提, 它是要被做成機制的東西。**
#
# 🛑 **而為什麼查【上一發】而不是等這一發** —— 這是量出來的, 不是選的:
#    `gh api` 實測 48 發已完成的 CI ⇒ 中位 **422s** · p90 **460s** · 最長 **513s**
#    ⇒ 🔴 **⇒ 主視窗原本提的「等 90 秒」會【100% 逾時】** ——
#         而那句「還在跑, 我沒等到」每推必印 ⇒ 它會變成噪音 ⇒ 而人會學會跳過它。
#         (那正是 Sean 對 GitHub 那些信做的事:「太多了, 根本沒有在看」。)
#    ⇒ ✅ **⇒ 改成查上一發:它早就跑完了(兩次收割間隔遠大於 8.5 分鐘)⇒ 零等待、零逾時、
#         而紅的發現時間一樣是【一次收割】。**
#
# 🔴 **這一格【不擋 push】** —— 它只印。CI 結果在 push 之後才存在, 所以它不可能是一道閘。
#    ⇒ 🛑 **⇒ 而那表示它必然可以被忽略。那是這個形狀的天花板, 不是疏漏。**
# 🔴 **而它自己沒有守門** —— 把下面這幾行刪掉, **不會有任何測試變紅**。
#    它靠的是【它長在必經之路上】, 而不是靠有東西在看著它。**這句話是誠實的天花板。**
if [ -x scripts/ci-verdict.py ] || [ -f scripts/ci-verdict.py ]; then
  echo "── 上一發(origin/dev = $FROM)的 CI ──"
  python3 scripts/ci-verdict.py "$FROM"
  # 🔵 rc 刻意不接進 set -e / 不擋 push:紅的是【上一發】, 而擋住這一發不會讓它變綠。
else
  echo "🔴 scripts/ci-verdict.py 不在 ⇒ 【沒有查上一發的 CI】。"
  echo "   🛑 這不是「上一發是綠的」—— 兩者在這裡印不同的東西, 就是為了這一刻。"
fi
# 🔴 檔名【不帶日期】—— 2026-09-02 00:0x 踩到:帶日期的檔名在跨午夜那一刻,
#    把各窗拿到的「tail 那支檔」指到一個空的地方,而【查無】與【沒有人在推】印同一個東西。
#    (同一夜同一個病的第二個載體:第一個是艦隊表 現在誰在做什麼-<日期>.md)
#    ⇒ 固定檔名把整個「跨午夜」這一類失效模式消掉,而代價只是檔會長。
LEDGER="$HOME/pcm-mailbox/推送預告.md"
LOG="$(mktemp -t announce-push)"

if [ ! -f "$LEDGER" ]; then
  {
    printf '%s\n' "# 推送預告 —— 主視窗代推的單一落點"
    printf '%s\n' ""
    printf '%s\n' "> **收到 push 警示 ⇒ 先 tail 這支檔。** 有對應那一行 ⇒ 不是事故。沒有 ⇒ 那才要叫。"
    printf '%s\n' "> 🔴 「實際推到」由 scripts/announce-and-push.sh 在 rc 之後跑 ls-remote 填 —— 不手填。"
    printf '%s\n' ""
    printf '%s\n' "| 時刻 | 從 | 預告終點 | 實際推到 | 相不相等 |"
    printf '%s\n' "|---|---|---|---|---|"
  } > "$LEDGER"
fi

# 🔴 先自癒:把那些「PUSH-FAILED」而【後來其實進去了】的列標起來。
#    成因(線 -7d 診斷):這張表記的是【嘗試】不是【結局】——
#    一個 PUSH-FAILED 的列永遠是 PUSH-FAILED, 即使那顆 commit 十分鐘後被下一發帶上去。
#    🛑 而它沒有任何訊號說它已經不是現況 ⇒ 下一個讀它的人會去重推, 或去叫。
#    📌 而這一格比別的過期難發現:那張表【是我們用來查證別的東西的工具】——
#       一把量具自己過期時, 沒有第二把量具在量它。
#    ✅ 所以每次跑都掃一遍, 而不是「下次記得回來改」。
if [ -f "$LEDGER" ]; then
  while IFS= read -r h; do
    [ -z "$h" ] && continue
    if git merge-base --is-ancestor "$h" origin/dev 2>/dev/null; then
      python3 - "$LEDGER" "$h" <<'PYHEAL'
import io,sys
p,h=sys.argv[1],sys.argv[2]
s=io.open(p,encoding='utf-8').read()
old='| %s | PUSH-FAILED' % h
if old in s:
    s=s.replace('| %s | PUSH-FAILED(rc=1) | 🔴 推失敗 |' % h,
                '| %s | PUSH-FAILED(rc=1) | 🔵 當時失敗, 而它後來被別的一發帶上去了(自癒標記) |' % h)
    io.open(p,'w',encoding='utf-8').write(s)
PYHEAL
    fi
  done <<< "$(grep 'PUSH-FAILED' "$LEDGER" 2>/dev/null | sed -n 's/^| *[0-9:]* *| *[0-9a-f]* *| *\([0-9a-f]\{7,\}\) *|.*/\1/p')"
fi

# 🔴 推之前先把【每一顆的標題】印出來 —— 2026-09-02 00:1x 實錘:
#    一顆 subject 逐字寫著「🛑 未完成, 不得上線」的 commit 被收割推上 origin/dev,
#    而它裡面有一行是【把 HTML 付款信接上】(4 條 must-fix 未修, 洩漏面從單號變成品名/金額)。
#    🎯 成因是結構性的:收割那條路是 `rev-list --count` + `push` ——
#       那一路上【沒有任何一步會看到 commit 標題】。
#       ⇒ 那顆 commit 在標題寫「不得上線」是給【人】看的,而收割是機器動作。
#    ⇒ 所以這裡把標題印出來(肉眼那一格不靠字串比對),並對幾個常見講法硬停。
#    ⚠️ 那個清單是【黑名單】⇒ 它在跟下一個沒想到的講法賽跑 ⇒ 印出來那一格才是主要防線。
echo "── 這一發要推的 commit(逐顆標題,自己看一眼)──"
git log --format='   %h %s' "$FROM".."$TIP" 2>/dev/null || git log --format='   %h %s' -5 "$TIP"
# 🔴 只比【沒有被引號包住】的字 —— 本閘上線第一發就被自己咬:
#    記錄這道閘的那一顆 commit, 標題逐字寫著「不得上線」(在引號裡, 是【提及】不是【宣稱】)
#    ⇒ 它把自己擋下來了。而那正是 memory 裡那條:
#      「記錄缺口的註解, 會被偵測缺口的量具數進去。」
#    ⇒ 所以先把 「…」 與 "…" 裡的東西拿掉再比。⚠️ 它擋不住:用別的引號、或根本不加引號地引述。
# 🔴 而第三發又誤擋:「未完成」太泛 —— 一顆【講這次事故的 docs commit】逐字寫
#    「合起來把一行未完成的接線送上遠端」⇒ 那是敘述, 不是宣稱。已從清單移除。
#    📌 而三發三種誤擋(自己引用 / 敘述用語 / 尚待第四種)⇒ 一份黑名單要跑過真語料好幾輪才穩,
#       而每一輪的誤擋都長得像「它在工作」。
# 🔴 第四發誤擋(就是上一句預言的那個):一顆 commit 的【body】列出了這份黑名單本身
#    ⇒ 逐字「尚未通過審查 / WIP / DO NOT MERGE|PUSH|SHIP」⇒ 沒有引號, 剝不掉。
#    ✅ 改成【只讀 subject】—— 真正的宣稱(「這一顆不得上線」)寫在標題,
#       而 body 是文件住的地方, 而文件本來就會引用它要防的字。
#    📌 一般化:一道守門要判的是【這一顆在宣稱什麼】, 而宣稱住在標題。
BLOCKED="$(git log --format='%h %s' "$FROM".."$TIP" 2>/dev/null \
  | python3 -c "import sys,re; sys.stdout.write(re.sub(r'「[^」]*」|\"[^\"]*\"','',sys.stdin.read()))" \
  | grep -nE '不得上線|不得貼|不得 ?apply|不要上線|尚未通過審查|WIP|DO NOT (MERGE|PUSH|SHIP)' || true)"
# 🔴 而這道閘一定要有出路 —— 今晚學到的:「守門紅了沒有出路, 會被整支刪掉」。
#    而它特別需要:線 -7d 指出【一個掃文字的系統, 會被描述這個系統的文字觸發】,
#    而這支艦隊的 commit 標題寫法逐字就是「把那個危險的句子寫進標題」
#    ⇒ 所以字串比對在這裡【結構性地】會反覆誤擋, 不是調得不夠好。
if [ -n "$BLOCKED" ] && [ -z "${ALLOW_SELFDESC:-}" ]; then
  echo "🛑 有 commit 自稱不該上線 —— 停下,不推:"
  echo "$BLOCKED" | head -20
  echo "   ⇒ 真的是【某一顆自稱不該上線】⇒ 先處理掉那一顆(revert / 改標題 / 分開推)。"
  echo "   ⇒ 而如果它只是【一顆在描述這件事的 commit】(本閘四發裡有三發是這一種):"
  echo "        ALLOW_SELFDESC=1 bash scripts/announce-and-push.sh $TARGET"
  echo "     🔴 而用它之前, 上面那份逐顆標題【自己看完】—— 這道閘的主要防線是那一份, 不是字串比對。"
  exit 3
fi

# 🔴 互斥鎖 —— 2026-09-02 02:0x 量到的成因, 不是猜的:
#    兩發 announce-and-push 同時在跑 ⇒ 第二發送出的 old-value 是它【開跑時】看到的
#    origin/dev, 而那時第一發還沒落地 ⇒ remote 回
#      "cannot lock ref: is at <A> but expected <B>"
#    ⇒ 而它在帳本上印 PUSH-FAILED, 讀起來像【內容沒上去】
#    ⇒ ⇒ 而事實是【第一發的內容上去了, 第二發的還沒】—— 兩者長得一樣。
#    🛑 而這道鎖擋不住:別的視窗自己下 `git push`(它不經過這支)。
LOCK="$HOME/pcm-mailbox/.announce-push.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "🛑 另一發 announce-and-push 正在跑(鎖:$LOCK)⇒ 本發不推, 沒有任何副作用。"
  echo "   ⇒ 等它印完 rc 再跑一次。⇒ 而如果它已經死了:rmdir \"$LOCK\""
  exit 4
fi
# 🔴🔴 **收工一律回填那一格 —— 不只 happy path**(2026-09-02 17:5x 加, 成因是量到的)
#   本檔原本已經有【兩條】回填路徑:push 成功(下方 ls-remote 那段)與 push 失敗(rc!=0 那段)。
#   🛑 **而缺的是第三種:整個 process 被砍。**
#   實例:2026-09-02 16:52 那一發被前景逾時 SIGTERM ⇒ 預告那一列**永遠停在 `(推中)`**。
#   🔴 而它的後果不是難看:**一列停在「(推中)」的預告, 對下一個來讀它的窗,
#      與【正在推】長得一模一樣** ⇒ ⇒ **而那個窗會【等】—— 等一個已經結束的東西。**
#   📌 **⇒ 「推失敗」「被砍」「還在推」是三個不同的動作, 而它們今天印同一個字。**
#   ⚠️ **而被砍時我們【不知道】push 成功了沒** —— 所以這一格**不猜**, 它寫「未量」並叫人自己量。
#      (同日 16:34 那一發就是反例:它被砍而**推其實成功了** ⇒ 猜「失敗」會寫下一個假的。)
_finish() {
  rmdir "$LOCK" 2>/dev/null
  # 還留著 (推中) ⇒ 代表上面兩條回填路徑都沒走到 ⇒ 我們是被砍的那一種
  grep -qF '| (推中) | — |' "$LEDGER" 2>/dev/null || return 0
  python3 - "$LEDGER" <<'PY' 2>/dev/null
import io,sys
p=sys.argv[1]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| ⚠️ 被中斷(未量) | ⚠️ 未知 —— 自己跑 git ls-remote origin refs/heads/dev |',1)
io.open(p,'w',encoding='utf-8').write(s)
PY
}
trap _finish EXIT

# 預告先落檔, 再 push —— 順序不能反, 反了就不是預告
printf '| %s | %s | %s | (推中) | — |\n' "$(date '+%H:%M')" "$FROM" "$TIP" >> "$LEDGER"
echo "📢 預告已落檔:$LEDGER"
echo "   origin/dev 會從 $FROM 走到 $TIP"

git push origin "$TIP":refs/heads/dev > "$LOG" 2>&1 ; RC=$?
echo "   push rc=$RC · log=$LOG"

if [ "$RC" -ne 0 ]; then
  # 失敗也要留痕 —— 一個沒有結果的預告, 與一個成功的推, 在表上不能長一樣
  python3 - "$LEDGER" "PUSH-FAILED(rc=$RC)" "🔴 推失敗" <<'PY'
import io,sys
p,act,eq=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| %s | %s |'%(act,eq),1)
io.open(p,'w',encoding='utf-8').write(s)
PY
  tail -25 "$LOG"
  exit 1
fi

# 🔴 只有到這裡才量 —— rc 已經印出來了
ACT="$(git ls-remote origin refs/heads/dev 2>/dev/null | cut -c1-8)"
# 🔴🔴 **終點 ≠ 預告終點時要【列出差集】, 不是只說「不相等」**(2026-09-02 18:0x 加)
#   成因是量到的:同日 16:34 那一發預告 `5f47d374` 而實際推到 `9c06a72a`
#   ⇒ 中間又落了 4 顆 commit, 被同一發帶上去 —— 而那 4 顆**沒有任何預告寫過它們**。
#   🛑 而那一列當時標著「✅ 相等」而兩欄是不同字串 ⇒ **收訊端拿到的是一個【假的放行】**
#      (這張表的檔頭逐字:「沒有對應那一行 ⇒ 那才要叫」)。
#   🎯 **⇒ 所以「不相等」這三個字不夠 —— 要答得出【誰被帶上去而沒有預告】。**
#   ⚠️ 而差集寫在**終端機**不寫進表格(一列多顆會把那一行撐爆);表格只放顆數。
if [ "$ACT" = "$TIP" ]; then
  EQ="✅ 相等"; OUT=0
else
  EXTRA="$(git rev-list --count "$TIP".."$ACT" 2>/dev/null || echo '?')"
  EQ="🔵 不相等 —— 多帶 ${EXTRA} 顆(差集見終端機)"; OUT=2
  echo "🔵 終點與預告不同 ⇒ 預告 $TIP · 實際 $ACT ⇒ 多帶 $EXTRA 顆:"
  git log --oneline "$TIP".."$ACT" 2>/dev/null | sed 's/^/     /' || echo "     (差集算不出來 —— 本地沒有那些物件?先 git fetch)"
fi

python3 - "$LEDGER" "$ACT" "$EQ" <<'PY'
import io,sys
p,act,eq=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| %s | %s |'%(act,eq),1)
io.open(p,'w',encoding='utf-8').write(s)
PY

echo "   ls-remote 實測 = $ACT ⇒ $EQ"

# 🔵 這一發的 CI 現在【一定還在跑】(實測中位 422s)⇒ 不等, 只指路。
#    真正會看到它的時機是【下一次收割】—— 就在本檔開頭那一段。
echo "── 這一發的 CI ──"
echo "   ⏳ 現在一定還在跑(實測中位 422s / 最長 513s)。**下一次收割時本檔開頭會自己查它。**"
echo "   🔵 想現在就看:python3 scripts/ci-verdict.py $ACT"
tail -1 "$LEDGER"
exit "$OUT"
