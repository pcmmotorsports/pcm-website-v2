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
if [ "$ACT" = "$TIP" ]; then EQ="✅ 相等"; OUT=0; else EQ="🔴 不相等"; OUT=2; fi

python3 - "$LEDGER" "$ACT" "$EQ" <<'PY'
import io,sys
p,act,eq=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| %s | %s |'%(act,eq),1)
io.open(p,'w',encoding='utf-8').write(s)
PY

echo "   ls-remote 實測 = $ACT ⇒ $EQ"
tail -1 "$LEDGER"
exit "$OUT"
