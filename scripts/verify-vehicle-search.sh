#!/bin/bash
# 車款搜尋修法(4f5962730)的【推前 / 推後】驗收 —— 同一份探針跑兩次, 比同一批數字。
#
# 用法:
#   bash scripts/verify-vehicle-search.sh before   # 推之前跑, 存證
#   bash scripts/verify-vehicle-search.sh after    # 推之後跑
#   bash scripts/verify-vehicle-search.sh diff     # 把兩份並排
#
# 🔴🔴 **它為什麼存在**:Sean 2026-09-07 在正式站搜「panigale v4 腳踏」⇒ 0 件,
#    畫面逐字「這幾個字沒有用到:「panigale」」。修法在 `dev` 上、不在 `main` 上。
#    ⇒ 📌 **沒有【推前】的讀數, 推後那一發證不了是這一發修好的。**
#
# 🎯 **量的是【畫面上那行字】不是「有沒有結果」** —— 那兩個世界會印不同的東西:
#    · 舊碼:多字車名比不到 ⇒ 只認出一個片段 ⇒ 網址帶 `unmatched=` ⇒ 頁面印「這幾個字沒有用到」
#    · 新碼:由長到短的視窗比對 ⇒ 整組認出來 ⇒ 沒有 unmatched
#
# 🛑 **代價明寫**:每跑一次, 每一條探針都會在正式庫 `public.search_queries` 留一列
#    (`log_search_query`)。⇒ 那份語料只有 ~100 列 ⇒ **這支腳本會顯著改變它的組成。**
#    ⇒ 下面 PROBES 的字串**刻意固定**, 讓事後可以把它們挑出來排除。
#    ⇒ 2026-09-08 已知的污染:front 的 8 發探針(見板列 ⟦front-VEHFACETSILENTDROP⟧)。
#
# 🔵 **顧客站可以 curl**(不像後台 —— memory `reference_admin-cannot-be-verified-by-curl`:
#    後台入口在 quote 站, curl 一律 429 challenge)。而**本腳本仍然驗一次拿到的是真頁面**
#    (見下面 `pp-count` 那個特徵字), 因為「challenge 頁」與「真頁面」都會回 200。

set -u
MODE="${1:-}"
BASE="https://shop.pcmmotorsports.com/products"
OUT="${VERIFY_OUT_DIR:-/tmp/vehicle-search-verify}"
mkdir -p "$OUT"

# 探針:各挑一種【不同結構】的車名 —— 那顆 commit 逐字寫「舊碼對 88.1% 的車款結構上比不到」
# ⇒ 🛑 只驗 Panigale 一台的話, 證到的是一台不是那 88.1%。
PROBES=(
  "sean-原始|panigale v4 腳踏|多字車名 + 零件字(Sean 2026-09-07 實際打的那一串)"
  "多字|Trident 660|多字 + 數字"
  "連字號|Ninja ZX-10R|多字 + 連字號 + 數字"
  "連字號單詞|MT-09|單一 token 但帶連字號與數字"
  "PC-正對照|Ninja|🟢 單字車名 —— 舊碼【本來就會過】⇒ 推前推後都要成功"
  "NC-負對照|zq7fh3k2m|⚪ 現造車名 —— 推前推後都要查無, 而它的畫面要與失敗畫面分得開"
)

probe() {
  local label="$1" q="$2" why="$3" tag="$4"
  local enc file
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$q")
  file="$OUT/${tag}-$(printf '%s' "$label" | tr -c 'A-Za-z0-9_-' '_').html"
  local code
  code=$(curl -s -L -o "$file" -w '%{http_code}' "$BASE?search=$enc" --max-time 40)
  local unmatched said count vehicle real
  # 🔴🔴 **第一發拿到的可能不是最終頁** —— 這個站的轉址是【應用層】的(payload 裡帶 `;307;`),
  #    不是 HTTP 3xx ⇒ `curl -L` **沒有東西可以跟**。2026-09-08 第一版就是這樣:
  #    存下來的是轉址殼, `pp-count` 抓不到 ⇒ 件數欄一片空白, 而那長得像「查無」。
  #    ⇒ 📌 所以要**兩段**:先抓殼、把 `vehicle=` / `categories=` 取出來、再打一次最終頁。
  unmatched=$(grep -o 'unmatched=[^"&<\\]*' "$file" | head -1 | sed 's/^unmatched=//;s/;.*//')
  vehicle=$(grep -o 'vehicle=[^"&<\\]*' "$file" | head -1 | sed 's/^vehicle=//;s/;.*//;s/\\u0026.*//')
  local cats final="$file"
  cats=$(grep -o 'categories=[^"&<\\]*' "$file" | head -1 | sed 's/^categories=//;s/;.*//;s/\\u0026.*//')
  if [ -n "$vehicle" ]; then
    final="${file%.html}-final.html"
    local u="$BASE?vehicle=$vehicle"
    [ -n "$cats" ] && u="$u&categories=$cats&category=$cats"
    curl -s -L -o "$final" "$u" --max-time 40
  fi
  said=$(grep -c '沒有用到' "$final")
  count=$(grep -o 'pp-count">[0-9,]* 件商品' "$final" | head -1 | sed 's/pp-count">//')
  # 🔴 真頁面 vs challenge:兩者都回 200 ⇒ 用【只有真頁面才有的特徵字】判
  # 🔴🔴 **429 要單獨講, 不可以跟「查無」混在一起** —— 2026-09-08 實測踩到:
  #    我連跑兩輪(而且改成兩段式之後請求數加倍)⇒ 顧客站開始回 **429**,
  #    而我第一版的輸出把它印成「件數=（無） / unmatched=（無）」
  #    ⇒ 📌 **那跟【這台車搜不到東西】長得一模一樣。**
  #    🔵 顧客站有 WAF 限流(板列 ⟦auth-SEARCHWAFRATE⟧, Sean 拍過)⇒ 被擋是【預期行為】不是壞掉。
  if [ "$code" = "429" ]; then
    real="🛑 429 限流 —— 這一格【沒有量到】, 不是查無。等一下再跑。"
  elif grep -q 'pp-count' "$final"; then
    real="真頁面"
  else
    real="🔴 無 pp-count(challenge? 轉址沒跟上?)"
  fi
  printf '%-12s | %-18s | http=%s | %s\n' "$label" "$q" "$code" "$real"
  printf '   件數=%-12s 說「沒有用到」=%s  vehicle=%s\n' "${count:-（無）}" "$said" "${vehicle:-（無）}"
  printf '   unmatched=%s\n' "${unmatched:-（無）}"
  printf '   為什麼挑它:%s\n\n' "$why"
}

# 🔴🔴 **部署指紋** —— 解一個會讓整份驗收作廢的歧義:
#    push 之後 Vercel 要幾分鐘才換版 ⇒ **「還沒部署完」與「修法沒生效」印同一個東西。**
#    ⇒ 📌 所以 `after` 那一發**必須先證明站上換版了**, 再談修沒修好。
#    做法:`/_next/static/immutable/chunks/` 底下的檔名是**內容雜湊** ⇒ 換版就會變。
#    ⚠️ 射程:它證的是**站上的前端產物換了**, **不證明換成的是哪一顆 commit**。
fingerprint() {
  local f="$1"
  grep -oE '/_next/static/immutable/chunks/[a-z0-9_]+\.(js|css)' "$f" \
    | sort -u | shasum | cut -c1-12
}

case "$MODE" in
  before|after)
    printf '══ 車款搜尋驗收 · %s ══\n' "$MODE"
    date '+跑的時間:%F %T'
    printf '⚠️ 本次會在正式庫 search_queries 留下 %s 列(每條探針一列)\n\n' "${#PROBES[@]}"
    for p in "${PROBES[@]}"; do
      IFS='|' read -r label q why <<< "$p"
      probe "$label" "$q" "$why" "$MODE"
      # 🔴 每條之間停一下 —— 顧客站有 WAF 限流, 打太快會拿到 429,
      #    而 429 在輸出上與「查無」很接近(上面那格已經把它分開了, 這裡是不要撞它)。
      sleep "${VERIFY_SLEEP:-8}"
    done
    # 存指紋, 讓 after 那一發問得出「站上到底換版了沒」
    FPSRC=$(ls "$OUT/${MODE}"-*-final.html "$OUT/${MODE}"-*.html 2>/dev/null | head -1)
    if [ -n "${FPSRC:-}" ]; then
      fingerprint "$FPSRC" > "$OUT/${MODE}.fingerprint"
      printf '🔖 本次部署指紋 = %s\n' "$(cat "$OUT/${MODE}.fingerprint")"
    fi
    if [ "$MODE" = after ] && [ -f "$OUT/before.fingerprint" ] && [ -f "$OUT/after.fingerprint" ]; then
      if [ "$(cat "$OUT/before.fingerprint")" = "$(cat "$OUT/after.fingerprint")" ]; then
        printf '\n🛑🛑 **指紋與推前【一模一樣】⇒ 站上還沒換版。**\n'
        printf '   ⇒ 上面每一格都是【推前的畫面】, 不是「修法沒生效」。等幾分鐘再跑一次。\n'
      else
        printf '\n🟢 指紋與推前【不同】⇒ 站上換版了 ⇒ 上面的讀數才談得上修沒修好。\n'
      fi
    fi
    printf '📎 HTML 存在 %s\n' "$OUT"
    ;;
  diff)
    printf '══ 推前 vs 推後(只比兩個世界會印不同東西的那幾格)══\n'
    for p in "${PROBES[@]}"; do
      IFS='|' read -r label q why <<< "$p"
      f=$(printf '%s' "$label" | tr -c 'A-Za-z0-9_-' '_')
      for m in before after; do
        h="$OUT/${m}-${f}.html"
        if [ -f "$h" ]; then
          printf '%-12s %-6s 沒有用到=%s 件數=%s\n' "$label" "$m" \
            "$(grep -c '沒有用到' "$h")" \
            "$(grep -o 'pp-count">[0-9,]* 件商品' "$h" | head -1 | sed 's/pp-count">//')"
        else
          printf '%-12s %-6s 🔴 沒有這份 log —— 那是【沒跑】不是【沒差別】\n' "$label" "$m"
        fi
      done
      echo
    done
    ;;
  *)
    printf '用法:bash scripts/verify-vehicle-search.sh before|after|diff\n' >&2
    exit 2
    ;;
esac
