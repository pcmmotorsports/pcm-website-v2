#!/bin/bash
# catalog-fitments-slimming-verify.sh
#   ⟦search-CATALOGPAGE2MB⟧ / ⟦front-PDPTAXONOMYEMPTY⟧ 的驗收尺。
#   立於 2026-09-06 · 線 front · commit 3fd5097c6 / a3643c3fe 部署【之後】跑。
#
# 用法
#   snapshot:  bash scripts/catalog-fitments-slimming-verify.sh snap <base-url> <標籤> [share-token]
#   比對兩份:  bash scripts/catalog-fitments-slimming-verify.sh diff <標籤A> <標籤B>
#   log 那格:  bash scripts/catalog-fitments-slimming-verify.sh logs
#
# 🔴 這支【自己就帶兩把對照, 每一發都跑】—— 不是一個要人記得跑的 selftest:
#     正對照 pp-count 必須 >0(證明我真的進到站, 不是落在 Vercel 登入頁)
#     負對照 一個【每次執行現造】的字串必須 =0(證明尺不亂報)
#
# 🛑 它【答不出】的三件事, 寫在這裡免得有人拿它當全部:
#   1. ⟦front-PDPTAXONOMYEMPTY⟧ 那 6 小時窗要查 Vercel runtime logs ⇒ 本支【做不到】,
#      它只印出要跑的查詢與判準(`logs` 子命令)。跑的人要有 Vercel 存取。
#   2. 它量的是【RSC 回應 body 的 bytes】, 而 log 裡那個 `items over 2MB` 量的是
#      【cache entry 序列化後】的 bytes ⇒ 🔴 兩個數只能比方向, 不能比大小。
#   3. 它看不到「客人實際看到什麼」的樣式與版面 —— 它比的是那 100 條「適用 …」字串。
set -uo pipefail

OUT="${PCM_FITMENT_SNAP_DIR:-/tmp/pcm-fitments-snap}"
URLS=(
  "/products?per=100"
  "/products?per=100&vehicle=ducati:scrambler-800:2023"
  "/products?per=100&vehicle=ducati:scrambler-1100-club-italia"
)

usage() { sed -n '2,20p' "$0"; exit 2; }

snap() {
  local base="$1" label="$2" token="${3:-}"
  local dir="$OUT/$label"
  mkdir -p "$dir" || return 1
  local jar="$dir/.cookies"
  rm -f "$jar"
  # 現造負對照 —— 每次執行都不一樣, 不會被寫進任何檔案而變成下一次的假命中
  local NEG="zqnope$(date +%s)$RANDOM"

  if [ -n "$token" ]; then
    curl -sL -c "$jar" -o /dev/null "$base/?_vercel_share=$token" || return 1
    printf '(帶 share token 取 cookie;token 不印)\n'
  fi

  printf '快照 %s ⇒ %s\n' "$label" "$dir"
  # 🔴 「我抓到幾條」旁邊一定要有它的分母(卡片數)—— 少一批綠比多一個紅難發現
  printf '%-46s %-12s %-11s %-9s %-13s %s\n' 網址 bytes motoBrand pp-count 卡片/抓到 負對照
  local i=0
  for u in "${URLS[@]}"; do
    i=$((i + 1))
    local body="$dir/body$i.html"
    curl -sL ${token:+-b "$jar"} -o "$body" "$base$u" || return 1
    local BY MB PP NG
    BY=$(wc -c < "$body" | tr -d ' ')
    MB=$(grep -o 'motoBrand' "$body" | wc -l | tr -d ' ')
    PP=$(grep -o 'pp-count' "$body" | wc -l | tr -d ' ')
    NG=$(grep -o "$NEG" "$body" | wc -l | tr -d ' ')
    # 「適用 …」那 100 條:剝掉 React 插進去的 <!-- -->, 一行一條, 排序後存檔
    grep -o 'pcard-fits">[^<]*<!-- -->[^<]*' "$body" \
      | sed 's/.*pcard-fits">//; s/<!-- -->//' | LC_ALL=C sort > "$dir/fits$i.txt"
    local FN CARDS
    FN=$(wc -l < "$dir/fits$i.txt" | tr -d ' ')
    CARDS=$(grep -o 'pcard-fits' "$body" | wc -l | tr -d ' ')
    printf '%-46s %-12s %-11s %-9s %-13s %s\n' "$u" "$BY" "$MB" "$PP" "$CARDS/$FN" "$NG"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$BY" "$MB" "$PP" "$FN" "$NG" "$CARDS" >> "$dir/metrics.tsv"
    [ "$PP" -gt 0 ] || printf '  🔴 正對照【失敗】:pp-count=0 ⇒ 我沒有進到站(多半落在 Vercel 登入頁)⇒ 本發作廢\n'
    [ "$NG" -eq 0 ] || printf '  🔴 負對照【失敗】:現造字串竟然命中 ⇒ 這把尺壞了\n'
    # 🔴 卡片數 ≠ 抓到數 ⇒ 我的抽取式漏了一批, 而那與「這頁本來就少」印同一個小數字
    [ "$CARDS" -eq "$FN" ] || printf '  🔴 抽取漏了:卡片 %s 張而我只抓到 %s 條 ⇒ 這一格的「適用」比對不可信\n' "$CARDS" "$FN"
  done
  printf '\n✅ 存好了。改前改後各跑一次, 再 `diff <前> <後>`。\n'
}

cmp_snaps() {
  local a="$OUT/$1" b="$OUT/$2"
  [ -d "$a" ] && [ -d "$b" ] || { printf '🔴 找不到快照:%s 或 %s\n' "$1" "$2"; return 1; }
  printf '=== 兩個世界各印什麼(%s ⇒ %s)===\n' "$1" "$2"
  printf '%-46s %-22s %-18s %s\n' 網址 "bytes 前⇒後" "motoBrand 前⇒後" "適用字串"
  local i=0
  local bad=0
  for u in "${URLS[@]}"; do
    i=$((i + 1))
    local ra rb
    ra=$(awk -F'\t' -v u="$u" '$1==u{print $2"\t"$3}' "$a/metrics.tsv" | tail -1)
    rb=$(awk -F'\t' -v u="$u" '$1==u{print $2"\t"$3}' "$b/metrics.tsv" | tail -1)
    local BA MA BB MB2
    BA=$(printf '%s' "$ra" | cut -f1); MA=$(printf '%s' "$ra" | cut -f2)
    BB=$(printf '%s' "$rb" | cut -f1); MB2=$(printf '%s' "$rb" | cut -f2)
    local same
    if diff -q "$a/fits$i.txt" "$b/fits$i.txt" > /dev/null 2>&1; then
      same='逐字相同 ✅'
    else
      same="🔴 有差($(diff "$a/fits$i.txt" "$b/fits$i.txt" | grep -c '^[<>]') 行)"
      bad=1
    fi
    printf '%-46s %-22s %-18s %s\n' "$u" "$BA ⇒ $BB" "$MA ⇒ $MB2" "$same"
  done
  printf '\n判準(兩個都要, 缺一不可):\n'
  printf '  ① motoBrand 後面那個數要變 0 —— 而【0 在「改對了」與「頁面整個壞掉」都會印】\n'
  printf '  ② 所以同一發的 pp-count 必須 >0 且那 100 條「適用 …」逐字相同 ⇒ 才叫改對了\n'
  [ "$bad" -eq 0 ] || printf '\n🔴 有一格的「適用 …」對不上 ⇒ 那【不是】變小, 那是畫面變了。\n'
}

logs_hint() {
  cat <<'HINT'
=== ⟦front-PDPTAXONOMYEMPTY⟧ 那 6 小時窗 —— 本支跑不了, 這是要跑的東西 ===
工具 Vercel get_runtime_logs(需要 Vercel 存取)
  projectId prj_4yNDP3XOt202tQIlYwF9auf5fLN7
  teamId    team_uMPmFCKRDUhoixK6p3JC0Tis

① 分子   environment=production · query="cached fitments fetch failed" · group_by=requestPath
         since/until = 一個【6 小時】窗(與修前基線同量級)
② 分母   同一個窗 · environment=production · group_by=requestPath  ⇒ 期望 1,704 量級
③ 正對照 同一個窗 · query="catalogRoute"                          ⇒ 必須有輸出(證明尺接得上)
④ 負對照 同一個窗 · query=<你現編的一個字串>                        ⇒ 必須 0

修前基線(2026-09-05T19:40Z ~ 2026-09-06T01:40Z):分子 31 個相異 requestPath / 分母 1,704
🛑 分母是【全站相異路徑】不是 PDP 請求數 —— 偏大, 而偏大對我們是保守的。
🛑 那 6 小時裡有「一分鐘 9 發」的爆量 ⇒ 修後若剛好避開那種窗口, 分子 0 的說服力會變弱
   ⇒ 回報時要一起講【這個窗裡有沒有出現同量級的爆量】。
🔴 而這一格要等 main 有那個修法才成立 —— 2026-09-06 實測 main 沒有它(正式站當時 6 小時 22 個相異 PDP 仍在噴)。
HINT
}

case "${1:-}" in
  snap) [ $# -ge 3 ] || usage; snap "$2" "$3" "${4:-}" ;;
  diff) [ $# -ge 3 ] || usage; cmp_snaps "$2" "$3" ;;
  logs) logs_hint ;;
  *) usage ;;
esac
