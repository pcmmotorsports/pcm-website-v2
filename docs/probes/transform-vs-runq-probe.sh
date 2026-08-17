#!/usr/bin/env sh
# transform-vs-runq-probe.sh —— 把「vitest 的 transform 慢」與「當下機器多忙」配對量。
#
# 要答的題(T 線 2026-08-18 自己指出、主視窗指定去做的那一個):
#   那發紅的 `transform 6.43s`(綠發 413ms-1.36s)是不是機器負載造成的?
#   先前只能說「時間軸吻合」—— 因為【沒有在跑的當下量】。現在 run queue 那把尺做出來了,
#   這支腳本把兩者【在同一發裡】配對記下來。
#
# 🔴 只用【自然的負載變動】,不人為造負載:
#   MAIN-010 §5 明列「不要製造高並行樣本」,理由是刻意造的負載形狀是我們選的,
#   可能是一個不存在的世界。本機同時有八個窗在做各自的事 ⇒ 自然變動本來就夠大。
#   ⇒ 代價寫在前面:**這是觀察不是介入 ⇒ 它能拿到相關,拿不到因果。**
#
# 🔴 另一個非讀不可的限定:2026-08-18 01:0x 主視窗清掉五隻失控程序(其中四隻各 90% CPU、
#   跑了 1 小時 39 分),機器釋出約 4.5 個核心 ⇒ **本腳本量到的樣本與那之前的舊樣本不同機況**,
#   兩邊的數字不要混在同一張表比。
#
# 用法:  sh docs/probes/transform-vs-runq-probe.sh [次數] [測試檔]
#        次數預設 6;測試檔預設 apps/admin/src/lib/orders/order-keyword-search-wiring.test.tsx
#
# 取樣器的四道保命與 dev-four-greens.sh 那支同源(理由寫在那支的 runq_now 上方,不重複):
#   || :  /  kill -0 $$ 看門狗  /  sleep 0.5 || sleep 1  /  收工 pgrep 確認零殘留。
#   ⚠️ 一樣沒有保護「單一發 ps 自己卡住」。
set -u

N="${1:-6}"
TARGET="${2:-apps/admin/src/lib/orders/order-keyword-search-wiring.test.tsx}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT" || exit 1
[ -f "$TARGET" ] || { echo "🔴 找不到測試檔:$TARGET" >&2; exit 2; }

TMP=$(mktemp -d) || exit 1
cleanup() {
  [ -n "${RUNQ_PID:-}" ] && kill "$RUNQ_PID" 2>/dev/null || :
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

runq_now() {
  _s="$(ps -A -o state= 2>/dev/null)" || return 1
  [ -n "$_s" ] || return 1
  printf '%s\n' "$_s" | grep -c '^R'
}

# 把 vitest 印的時間字面轉成毫秒。`6.43s` -> 6430 / `635ms` -> 635 / 缺欄 -> 讀不到。
to_ms() {
  printf '%s' "$1" | awk '
    /ms$/ { sub(/ms$/, ""); printf "%d", $0 + 0; found = 1 }
    /[0-9]s$/ { if (!found) { sub(/s$/, ""); printf "%d", ($0 + 0) * 1000; found = 1 } }
    END { if (!found) printf "讀不到" }'
}

echo "# transform-vs-runq  target=$TARGET  n=$N  OS=$(uname -s)"
echo "# 🔴 觀察不是介入(未人為造負載)⇒ 只拿得到相關,拿不到因果"
echo "# 🔴 機況:2026-08-18 01:0x 之後(五隻失控程序已被清掉,約 4.5 核釋出)"
echo "run rc transform_ms import_ms tests_ms runq_n runq_max runq_p95 runq_med runq_min load_before"
i=1
while [ "$i" -le "$N" ]; do
  : > "$TMP/samples"
  ( while kill -0 $$ 2>/dev/null; do
      runq_now >> "$TMP/samples" 2>/dev/null || :
      sleep 0.5 || sleep 1
    done ) &
  RUNQ_PID=$!
  _load_before="$(uptime 2>/dev/null | sed -n 's/.*load average[s]*: *//p' | tr -d ',' | awk '{print $1}')"
  _rc=0
  ./node_modules/.bin/vitest run "$TARGET" > "$TMP/out" 2>&1 || _rc=$?
  kill "$RUNQ_PID" 2>/dev/null || :
  wait "$RUNQ_PID" 2>/dev/null || :
  RUNQ_PID=''

  _dur="$(grep -m1 'Duration' "$TMP/out" 2>/dev/null || echo '')"
  _tr="$(to_ms "$(printf '%s' "$_dur" | sed -n 's/.*transform \([0-9.]*[a-z]*\).*/\1/p')")"
  _im="$(to_ms "$(printf '%s' "$_dur" | sed -n 's/.*import \([0-9.]*[a-z]*\).*/\1/p')")"
  _te="$(to_ms "$(printf '%s' "$_dur" | sed -n 's/.*tests \([0-9.]*[a-z]*\).*/\1/p')")"
  # 🔴 樣本檔空的時候印「讀不到」不印 0 —— 沒取到樣本與機器全閒必須分得開。
  _rq="$( { [ -s "$TMP/samples" ]; } && sort -n "$TMP/samples" | awk '
      /^[0-9]+$/ { v[++n] = $1 + 0 }
      END {
        if (n == 0) { printf "讀不到 讀不到 讀不到 讀不到 讀不到"; exit }
        i95 = int(n * 0.95); if (i95 < n * 0.95) i95++; if (i95 < 1) i95 = 1
        i50 = int(n * 0.50); if (i50 < n * 0.50) i50++; if (i50 < 1) i50 = 1
        printf "%d %d %d %d %d", n, v[n], v[i95], v[i50], v[1]
      }' || printf '讀不到 讀不到 讀不到 讀不到 讀不到' )"

  echo "$i $_rc $_tr $_im $_te $_rq ${_load_before:-讀不到}"
  i=$((i + 1))
done

echo "# 收工檢查:殘留取樣器 $(pgrep -f 'o state=' 2>/dev/null | wc -l | tr -d ' ') 支(要 0)"
echo "# 🔴 判讀提醒:transform 與 runq 一起變大【不等於】前者由後者造成 ——"
echo "#    vitest 自己的 worker 也算進 runq ⇒ 兩者共用一個上游(這一發做了多少事),"
echo "#    那正是典型的『共同原因』形狀。要拿因果得做介入,而介入被 MAIN-010 §5 擋著。"
