#!/usr/bin/env bash
# storefront-search-canary.sh — 顧客站搜尋壞掉時,**有一個東西會變成紅的**
# (⟦search-NOBODYWATCHES⟧ 2026-09-04)
#
# ── 🔴 它為什麼存在 ────────────────────────────────────────────────────────
#    2026-09-03 早上正式站顧客搜尋 **HTTP 503 `search_failed`**(11 次,`/search` 與 `/api/search`)。
#    🛑 **而發現它的是 Sean 本人** —— 不是任何機制。
#    ⇒ 📌 那一層今天沒有守門,而本檔是那一層的**偵測**那一半。
#
# ── 🛑🛑 而【今天沒有人在讀它】—— 這句話要先講,而不是藏在檔尾 ──────────────
#    通知那一半(把紅送到一個有人會看的地方)由線【DB】負責,而**它今天一行都還沒寫**
#    (`STATUS.md` Blocker 逐字:「CI 不是閘、是事後警報,而【沒有人在看】…修法未定」)。
#    ⇒ 🔴 **所以本檔今天是一支【要有人主動去跑】的腳本, 不是一個會自己叫的東西。**
#    ⇒ ⇒ 📌 **不要把它讀成「搜尋壞掉會有人知道」** —— 那句話今天仍然是假的。
#    ⚠️ 而**「收訊者是誰」是一個決策題不是工程題**:主視窗 2026-09-04 明說「寄給 Sean 不是一個答案」
#      ⇒ 本檔刻意**不自己接任何通知管道**(兩條管道 = 兩個要維護的東西, 而其中一條會先死)。
#
# ── 🔬 判準怎麼來的(而它不是「> 0」)──────────────────────────────────────
#    🛑 「> 0」對「只剩一件」也通過 ⇒ 那不是判準, 那是一個很寬的存在性檢查。
#    ✅ 而 `/api/search` 有一個**天然的上界**:它用 `SEARCH_OVERLAY_LIMIT`(= 8)取前 N 筆,
#      而且傳 `countTotal=false`(`app/api/search/route.ts:76`)⇒ **它不給總數**。
#    ⇒ 🎯 **⇒ 所以【寬詞應該把那個上限吃滿】** —— 那比「> 0」強得多:
#      一個回 3 筆的寬詞, 代表命中集合掉到 3 以下, 而那一定是壞了。
#
#    🔬 **量測時點與來源(數字要帶著它們走)**:
#      2026-09-04 04:xx 對 `shop.pcmmotorsports.com` 實測(帶 cache-buster):
#        `碳纖維` ⇒ 8 筆 · `貼` ⇒ 8 筆 · `rsv4` ⇒ 8 筆 · `akrapovic` ⇒ 8 筆
#      ⇒ 四個詞都**吃滿上限** ⇒ 上限 8 是可達的。
#    ⚠️ **而上架會讓命中變多、下架會讓它變少** —— 而變多不會叫。這個判準只抓「變少」。
#
# ── 🔴 兩發探測, 而它們證的是【不同的事】 ────────────────────────────────
#    ① **寬詞**(`WIDE_TERM`)⇒ 證「這條管道活著」。
#       挑一個**極常見的中文字**, 而不是某個商品名 —— 商品下架不該讓它變紅。
#    ② **具體詞**(`EXACT_TERM`)⇒ 證「比對真的在跑」, 而不是回一包快取。
#       🔴 而它要挑**最不可能下架的那一種** ⇒ 本檔用**料號**(`FCAP-06`, 2026-09-04 實查存在):
#         料號是**廠商給的識別碼**, 它比商品名穩定;而 Sean 2026-09-03 逐字說
#         「我們工作基本上都是用**原廠料號**在工作」⇒ 它壞掉是他最先痛的那一種。
#    ③ 🔵 **負對照**(`NONSENSE_TERM`)⇒ 證**這把尺會分辨** ——
#       它必須回 **0**。少了這一格,「①②都通過」與「這支腳本對什麼都說通過」印同一個綠。
#
# 用法:
#   bash scripts/storefront-search-canary.sh                  # 打正式站
#   BASE=http://localhost:3063 bash scripts/…                 # 打鑽機
# ── 🔴🔴 **三個世界, 三個字面 —— 而第三個最容易被漏掉** ────────────────────
#    ① 好的      ⇒ `PASS=3 FAIL=0` · exit **0**
#    ② 搜尋壞了  ⇒ 具體哪一發紅 + 為什麼 · exit **1**
#    ③ 🔴 **我自己壞了**(連不到 / 逾時 / 回不出 JSON)⇒ `UNREACHABLE` · exit **2**
#    🛑 **③ 不得與 ② 印同一個東西** —— 它們的下一步完全不同:
#      ② 去看搜尋;③ 去看**這台機器 / 網路 / 這支腳本**。
#      ⇒ 📌 而混在一起的話, 「網路斷了」會被讀成「搜尋掛了」而動員錯的人。
#    🔵 而這組 rc 與線【DB】的 `scripts/ci-verdict.py` 對齊(0 綠 / 1 紅 / 2 量不到);
#      它有第四種 `3 還在跑`, 而**本檔沒有那個世界**(探測是同步的)⇒ 三種, 寫明。
set -uo pipefail

BASE="${BASE:-https://shop.pcmmotorsports.com}"
# 🔴 這個 8 是 `SEARCH_OVERLAY_LIMIT` 的**複本**(`apps/storefront/src/lib/search.ts`)——
#    本檔打的是 HTTP, 讀不到那個常數。⇒ 📌 **那個常數改了, 這裡要跟著改**,
#    而**沒有東西會提醒你** —— 這是一個已知的、寫出來的缺口。
CAP="${CAP:-8}"
WIDE_TERM="${WIDE_TERM:-貼}"
EXACT_TERM="${EXACT_TERM:-FCAP-06}"
NONSENSE_TERM="${NONSENSE_TERM:-zzqprbxx9137never}"

command -v curl >/dev/null || { echo "🔴 缺 curl ⇒ ENV-FAIL"; exit 2; }
command -v python3 >/dev/null || { echo "🔴 缺 python3 ⇒ ENV-FAIL"; exit 2; }

PASS=0; FAIL=0
ok(){  printf '  %-34s ⇒ ✅ %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad(){ printf '  %-34s ⇒ 🔴 %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

# 回「HTTP碼 筆數 有沒有 error 欄」。
# 🔴 **三個都要回** —— 因為壞掉有兩種形狀而它們印不同的東西:
#    ① 503 + `{"error":"search_failed"}`(2026-09-03 正式站那次的**逐字**形狀)
#    ② **HTTP 200 而 0 筆**(資料層壞掉:它還活著但比對不到)
#    ⇒ 🛑 **一個只看狀態碼的偵測, 對第二種【完全看不到】**(兩種我都在鑽機上造得出來)。
probe() {
  local term="$1" enc body code rc
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$term")
  # 🔴 `curl` 的 rc 要**單獨接**, 不要放進管線 ——
  #    `cmd | tail` 之後的 `$?` 是 **tail 的**(CLAUDE.md 記過, 而今晚全隊踩了四次)。
  body=$(curl -s -m 20 -H 'Cache-Control: no-cache' \
    -w '\n%{http_code}' "$BASE/api/search?q=$enc&_cb=$RANDOM" 2>/dev/null) ; rc=$?
  # 🔴🔴 **第三個世界:我自己壞了。** curl 非 0(連不到 / 逾時 / DNS)
  #    ⇒ 回一個**與 HTTP 錯誤不同的字面**, 呼叫端據此走 exit 2 而不是 exit 1。
  if [ "$rc" -ne 0 ]; then
    echo "UNREACHABLE -1 curl_rc_$rc"
    return
  fi
  code=$(printf '%s' "$body" | tail -n1)
  # 🔵 curl rc=0 而 code 是 000 ⇒ 也是「我打不到」那一族(而不是搜尋回了 000)
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    echo "UNREACHABLE -1 empty_http_code"
    return
  fi
  printf '%s' "$body" | sed '$d' | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    print('$code', len(d.get('items') or []), d.get('error') or '-')
except Exception:
    # 🔴 解析不了也要**印出來**, 不要靜靜當成 0 筆 ——
    #    「回了壞 JSON」與「回了 0 筆」是兩件事, 而它們的下一步不同。
    print('$code', -1, 'unparseable')
"
}

echo "🔬 顧客站搜尋 canary · BASE=$BASE · 上限 CAP=$CAP"
echo "🛑 而【今天沒有人在讀它】—— 通知那一半還不存在(見檔頭)"
echo

read -r C1 N1 E1 <<<"$(probe "$WIDE_TERM")"
# 🔴 **先判第三個世界** —— 它必須在「搜尋壞了」之前被攔下來。
if [ "$C1" = "UNREACHABLE" ]; then
  echo "  🟡 UNREACHABLE:打不到 $BASE($E1)"
  echo
  echo "🟡 **這【不是】「搜尋壞了」** —— 這是【我自己量不到】。"
  echo "   ⇒ 下一步去看:這台機器的網路 / BASE 對不對 / 站點在不在, **不是去看搜尋。**"
  exit 2
fi
if [ "$C1" != "200" ]; then
  bad "① 寬詞「$WIDE_TERM」" "HTTP $C1 · error=$E1 ⇒ 搜尋整條掛了(= 2026-09-03 那次的形狀)"
elif [ "$N1" -lt "$CAP" ]; then
  bad "① 寬詞「$WIDE_TERM」" "只回 $N1 筆(期望吃滿 $CAP)⇒ 命中集合縮小或資料層壞了"
else
  ok  "① 寬詞「$WIDE_TERM」" "$N1 筆(吃滿上限)"
fi

read -r C2 N2 E2 <<<"$(probe "$EXACT_TERM")"
if [ "$C2" != "200" ]; then
  bad "② 料號「$EXACT_TERM」" "HTTP $C2 · error=$E2"
elif [ "$N2" -lt 1 ]; then
  bad "② 料號「$EXACT_TERM」" "0 筆 ⇒ **比對沒有在跑**(而 HTTP 是 200 ⇒ 只看狀態碼看不到這一種)"
else
  ok  "② 料號「$EXACT_TERM」" "$N2 筆"
fi

# 🔵 負對照 —— 少了它, 上面兩個綠可能只代表「這支腳本對什麼都說通過」。
read -r C3 N3 E3 <<<"$(probe "$NONSENSE_TERM")"
if [ "$C3" != "200" ]; then
  bad "③ 負對照(亂碼)" "HTTP $C3 · error=$E3"
elif [ "$N3" -ne 0 ]; then
  bad "③ 負對照(亂碼)" "回了 $N3 筆(期望 0)⇒ **這把尺對什麼都說有** ⇒ 上面兩個綠不算數"
else
  ok  "③ 負對照(亂碼)" "0 筆 ⇒ 尺會分辨"
fi

echo
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
echo "🛑 射程:本檔只證【那一刻、從這台機器打過去】的行為;它不是監控, 因為沒有東西在定期跑它。"
[ "$FAIL" -eq 0 ] || exit 1
