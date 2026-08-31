#!/usr/bin/env bash
# why-is-this-red.sh —— 分開「我沒 build 造成的紅」與「真紅」。**只讀,不改任何檔。**
#
# 為什麼需要它(2026-08-31 量到):
#   同一顆 551b2e91,CI 紅 6 支、我的乾淨 worktree 紅 12 支。
#   多出來的 6 支【全部】是 BUILD_OK / .next 那一族 —— CI 會先 build,worktree 不會。
#   ⇒ 任何窗在自己的 worktree 跑全套件,都會看到 6 支不屬於它的紅,而沒有訊號說那是假的。
#
# 🔴 為什麼判準是【失敗訊息】而不是【掃原始碼】:
#   掃 test 檔裡的 `build-stamp` / `.next/` 字面 ⇒ 命中 10 支,而實際紅的只有 6 支。
#   那 4 支(design-tokens / print-a4-css / orders-screenshot / build-stamp.test)
#   帶著同樣的字面卻不會因為沒 build 而紅。
#   📌 **一份「比行為寬」的清單,最危險的地方是它每一行都是真的。**
#
# ✅ 它被交叉驗過(2026-08-31,不是自我宣稱):
#   餵它【551b2e91 在沒 build 的 worktree 跑出來的那份 log】(12 支紅) ⇒
#   它判「真紅」6 支,而 CI run 33382956618(同一顆 commit)實際紅的也是那 6 支 —— **逐支 diff 為空**。
#   🔴 正對照:把 CI 那份拿掉一支再 diff ⇒ 它會報不同(尺會叫)。
#   🔴 負對照:餵一份全綠的 log ⇒ 兩堆合計 0 列。
#
# 🛑 它擋不住什麼(射程,照實寫):
#   · 它讀的是【你餵給它的那份 log】。log 不完整 ⇒ 它的分母就不完整。
#   · 判不出來的一律歸【真紅】(fail-closed)。所以它可能把一支新形狀的 build 紅報成真紅;
#     它【不會】反過來把真紅藏起來 —— 那個方向才是會出事的方向。
#   · 它不驗「build 之後真的會綠」。要證那句話,自己 build 完重跑。
#   · 它不看 CI。CI 的分母與你的不一樣,那正是它存在的理由。
#
# 📌 它答的是【這個紅是不是我造成的】,不是【build 完就沒事】。**那是兩個問題。**
#    (主視窗 2026-08-31 補的一句,放這裡免得下一個人把它讀成 build 保證。)
#
# 用法:
#   npx vitest run > /tmp/v.log 2>&1 ; bash scripts/why-is-this-red.sh /tmp/v.log
#   bash scripts/why-is-this-red.sh --selftest

set -u
BUILD_RE='沒有 BUILD_OK 戳記|讀不到 .*\.next'

classify() {   # stdin = vitest log ; stdout = "BUILD<TAB>path" / "REAL<TAB>path"
  awk -v re="$BUILD_RE" '
    /^ *FAIL /  { line=$0
                  sub(/^ *FAIL +/,"",line); sub(/^\|[a-z]+\| */,"",line)
                  sub(/ +>.*$/,"",line);    sub(/ +\[.*$/,"",line)
                  path=line; seen=0; next }
    path != "" && /^(Error|AssertionError|TypeError|ReferenceError):/ {
                  if (seen==0) { print (($0 ~ re) ? "BUILD" : "REAL") "\t" path; seen=1; path="" } }
  ' | sort -u
}

if [ "${1:-}" = "--selftest" ]; then
  fail=0
  # 世界 A:一支 build 紅 + 一支真紅 ⇒ 兩堆各 1
  A=$(printf '%s\n' \
      ' FAIL  |admin| apps/a/x.test.tsx [ apps/a/x.test.tsx ]' \
      'Error: 🔴 沒有 BUILD_OK 戳記 ⇒ 這個 app 沒有【成功】build 過。' \
      ' FAIL  |node| packages/b/y.test.ts > 某一格' \
      "AssertionError: expected 'a' to be 'b'" | classify)
  echo "$A" | grep -qx "BUILD	apps/a/x.test.tsx" || { echo "❌ 世界A:build 紅沒被認出"; fail=1; }
  echo "$A" | grep -qx "REAL	packages/b/y.test.ts"  || { echo "❌ 世界A:真紅沒被認出"; fail=1; }
  [ "$(echo "$A" | grep -c .)" = 2 ] || { echo "❌ 世界A:應該剛好 2 列"; fail=1; }
  # 世界 B:.next 那個形狀也要算 build 紅
  B=$(printf '%s\n' \
      ' FAIL  |storefront| apps/s/z.test.ts [ apps/s/z.test.ts ]' \
      'Error: 讀不到 /w/apps/s/.next/static/chunks —— 先跑 `TURBO_FORCE=1 pnpm build`' | classify)
  echo "$B" | grep -qx "BUILD	apps/s/z.test.ts" || { echo "❌ 世界B:.next 形狀沒被認出"; fail=1; }
  # 🔴 負對照:一支【訊息裡有 next 但不是 build 紅】的,必須歸真紅
  N=$(printf '%s\n' \
      ' FAIL  |node| packages/c/w.test.ts > 某一格' \
      "AssertionError: expected 'next' to be 'prev'" | classify)
  echo "$N" | grep -qx "REAL	packages/c/w.test.ts" || { echo "❌ 負對照:被誤判成 build 紅"; fail=1; }
  # 🔴 負對照二:全綠的 log ⇒ 兩堆都空
  Z=$(printf '%s\n' ' Test Files  737 passed (737)' | classify)
  [ -z "$Z" ] || { echo "❌ 負對照二:全綠的 log 竟然吐出東西"; fail=1; }
  [ "$fail" = 0 ] && echo "✅ selftest 5 格全過(正 3 / 負 2)" || echo "🔴 selftest 有格沒過"
  exit "$fail"
fi

LOG="${1:-}"
[ -n "$LOG" ] && [ -r "$LOG" ] || { echo "用法: $0 <vitest log 檔> | $0 --selftest" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
echo "== 你這棵樹的 build 戳記(決定你【會不會】看到假紅)=="
for a in admin storefront; do
  if [ -e "$REPO/apps/$a/.next/BUILD_OK" ]; then echo "  apps/$a: 有戳記"; else echo "  apps/$a: 🔴 沒有 ⇒ 這棵樹會印出不屬於你的紅"; fi
done

OUT=$(classify < "$LOG")
NB=$(echo "$OUT" | grep -c '^BUILD	' || true)
NR=$(echo "$OUT" | grep -c '^REAL	'  || true)
echo
echo "== 🟡 沒 build 造成的紅($NB 支)—— 先 build 再看,不要修它們 =="
echo "$OUT" | sed -n 's/^BUILD\t/  /p'
echo
echo "== 🔴 真紅($NR 支)—— 這些才要人去看 =="
echo "$OUT" | sed -n 's/^REAL\t/  /p'
echo
echo "== 射程 =="
echo "  · 分母 = 你餵的這份 log。log 不全 ⇒ 上面的數就不全。"
echo "  · 判不出來的一律歸【真紅】⇒ 它可能多報,不會少報。"
echo "  · 它【不】驗「build 完真的會綠」。要那句話就自己 build 完重跑。"
