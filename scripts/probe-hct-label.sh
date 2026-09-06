#!/bin/sh
# probe-hct-label.sh —— 對新竹打【一發】, 只為了知道「拿標籤圖」那支服務**回什麼形狀**。
#
# ══ 🔴🔴 這支腳本會對外發請求, 而那是不可回收的(鐵則 12⑤)══════════════
#   授權來源:Sean 2026-09-06 10:5x 答 `Q-標籤5 = 甲` —— 逐字「可以用他的新竹帳密真打一發:
#   只拿一張測試單的標籤圖, **不建單不出貨**, 只記回來的格式不記內容」。
#   ⇒ 🛑 **本腳本【只送查詢類的操作】** —— 它不碰 `TransData_Json`(那支會建單)。
#     操作名由 `--method` 傳入, 而**呼叫的人要為那個名字負責**(見下面「我們不知道什麼」)。
#
# ══ 🛑🛑 **我們不知道那支操作叫什麼 —— 這是本片最大的未知** ═══════════
#   `GetImage_Json` 這個名字**查無來源**:全 repo 3 筆命中, 全在我們自己寫的 plan 與板列裡,
#   官方文件 0 筆、碼 0 筆(2026-09-06 量)。
#   ⇒ 📌 **所以本腳本【不預設任何操作名】** —— `--method` 是必填。
#     ⚠️ 猜一個名字打過去, 回來的 `unknown method` 與「服務掛了」在輸出上長得很像。
#
# ══ 只印形狀, 不印內容 ═════════════════════════════════════════════
#   印:HTTP 狀態 / Content-Type / 位元組數 / 前 64 bytes 的 hex / 回應裡出現的**欄位名**清單
#   ⛔ **不印**:任何欄位的【值】、任何客人資料、帳號、密碼。
#   ⛔ **不存**:回應本體只落在 `mktemp` 的暫存檔, 收工即刪。
#   🔴 env 只讀**名稱不印值**(照 CLAUDE.md 的 credential 紀律:只印名稱是白名單, 黑名單擋不完)。
#
# ── 用法 ──────────────────────────────────────────────────────────
#   在**有 .env.local 的樹**跑(施工窗的 worktree 沒有那支檔):
#     set -a; . ./.env.local; set +a
#     sh scripts/probe-hct-label.sh --method <官方文件上那支操作名> --epino <一張測試單的箱號>
#   例(⚠️ 操作名請從官方 PDF 抄, 不要用這裡的示意字):
#     sh scripts/probe-hct-label.sh --method QueryEDELNO_Json --epino B7K3MN
set -u

METHOD=''; EPINO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --method) METHOD="${2:-}"; shift 2 ;;
    --epino)  EPINO="${2:-}";  shift 2 ;;
    *) echo "❌ 不認得的參數:$1(只吃 --method / --epino)" >&2; exit 2 ;;
  esac
done
[ -n "$METHOD" ] || { echo "❌ --method 必填 —— 本腳本【刻意不預設操作名】, 理由見檔頭。" >&2; exit 2; }
[ -n "$EPINO" ]  || { echo "❌ --epino 必填(一張測試單的箱號)。" >&2; exit 2; }

# 🔴 只印【名稱】與「有沒有值」, 絕不印值。
echo "── env(只印名稱與有無, 不印值)"
for n in HCT_API_ENDPOINT HCT_API_ACCOUNT HCT_API_PASSWORD; do
  eval "v=\${$n:-}"
  if [ -n "$v" ]; then echo "   $n = (有值, 長度 ${#v})"; else echo "   $n = (空 —— 這一發會打不出去)"; fi
done
[ -n "${HCT_API_ENDPOINT:-}" ] && [ -n "${HCT_API_ACCOUNT:-}" ] && [ -n "${HCT_API_PASSWORD:-}" ] || {
  echo "❌ 三個 env 沒齊 ⇒ 不發請求(fail-closed:寧可不打, 也不要打一發半殘的出去)" >&2; exit 3; }

BODY=$(mktemp) || exit 96
HDR=$(mktemp)  || { rm -f "$BODY"; exit 96; }
trap 'rm -f "$BODY" "$HDR"' EXIT

# SOAP 信封 —— 形狀照 `apps/admin/src/lib/shipping/hct-client.ts:153`(company/password/json 三個小寫參數)。
ENV_XML="<?xml version=\"1.0\" encoding=\"utf-8\"?>
<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">
  <soap:Body>
    <$METHOD xmlns=\"http://tempuri.org/\">
      <company>$HCT_API_ACCOUNT</company>
      <password>$HCT_API_PASSWORD</password>
      <json>[{\"epino\":\"$EPINO\"}]</json>
    </$METHOD>
  </soap:Body>
</soap:Envelope>"

echo "── 送出(method=$METHOD · epino=$EPINO)"
CODE=$(curl -s -o "$BODY" -D "$HDR" -w '%{http_code}' -m 30 \
  -H "Content-Type: text/xml; charset=utf-8" \
  -H "SOAPAction: \"http://tempuri.org/$METHOD\"" \
  --data-binary "$ENV_XML" "$HCT_API_ENDPOINT") || CODE='(curl 失敗)'

echo "── 形狀"
echo "   HTTP 狀態      : $CODE"
echo "   Content-Type   : $(grep -i '^content-type:' "$HDR" | tr -d '\r' | head -1)"
echo "   位元組數        : $(wc -c < "$BODY" | tr -d ' ')"
echo "   前 64 bytes hex : $(head -c 64 "$BODY" | xxd -p | tr -d '\n')"
echo "     (🔵 判型: 25504446='%PDF' · 89504e47=PNG · ffd8ff=JPEG · 3c3f786d6c='<?xml')"
echo "── 回應裡出現的【欄位名】(只印 key, 不印 value)"
tr '{,' '\n\n' < "$BODY" | grep -oE '"[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*:' | tr -d '":' \
  | sort -u | sed 's/^/   /' | head -60
echo "── XML 標籤名(SOAP 外層;同樣只印名字)"
grep -oE '<[A-Za-z_][A-Za-z0-9_]*>' "$BODY" | tr -d '<>' | sort -u | sed 's/^/   /' | head -40
echo "✅ 收工 —— 回應本體只在暫存檔, 本腳本結束時已刪。**一個位元都沒有落進版控。**"
