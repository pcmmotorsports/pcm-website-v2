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
#     ⛔ ~~它【不會】反過來把真紅藏起來 —— 那個方向才是會出事的方向。~~
#     🔴🔴 **2026-09-03 訂正(線 `-account` 實測):那句話只對【它看得見的 FAIL 行】成立。**
#        **一種失敗它完全看不見 —— 而那種失敗印得跟全綠一模一樣:**
#        vitest 若【一行 `FAIL` 都沒有】就失敗(例:`No test files found, exiting with code 1`),
#        本支的分母是 0 ⇒ 兩堆都印「0 支」⇒ 而本支自己 `rc=0`。
#        四個世界(當場跑, 可重跑;前兩發是正對照, 證明尺會動):
#          手造一支真紅的 log        ⇒ 真紅 1 支        ✅ 尺會動
#          手造一支沒 build 的紅     ⇒ build 紅 1 支    ✅ 尺會動
#          **vitest rc=1(No test files found)⇒ 真紅 0 · build 紅 0**  🔴
#          vitest rc=0(全綠)        ⇒ 真紅 0 · build 紅 0
#        ⇒ 🎯 **rc=1 的那一發與全綠那一發, 經過本支之後逐字相同。**
#        ✅ **怎麼分辨(要動作, 不是要小心)**:把 rc 一起存進 log ——
#           `npx vitest run > /tmp/v.log 2>&1 ; echo "rc=$?" >> /tmp/v.log`
#           然後 `grep -c 'No test files found' /tmp/v.log`。**別只看 FAIL 行的數量。**
#        🔵 而這個【現象】不是新的, 是本支沒有繼承它:
#           `docs/patterns/guard-and-instrument-traps.md:14327` 逐字記過同一個實例
#           (「在 apps/admin/ 底下用相對於該目錄的路徑跑 ⇒ No test files found」),
#           同檔 `:3223` 是它的母題(「`rc=1` 有很多種, 而失敗訊息被當成失敗結論」)。
#           📌 **⇒ 新的那一半只有一件:本支【自己】踩了那個坑, 而檔頭還宣稱它不會藏真紅。**
#
#   ✅ **2026-09-03 同日已修(主視窗 `-87` 裁「改, 而範圍收到最小」)**:
#      `blind_check()` —— 判準是**結構性的**不是字面:**我一列都報不出來, 而這份 log
#      沒有【健康跑完】的證據**(沒有 `rc=0`, 也沒有 `Test Files … passed`)⇒ 印
#      「🔴🔴 我看不見這一份」並且**本支自己 `exit 1`**。
#      🛑 **刻意不去解析 `No test files found` 那個字面** —— 那是在跟下一種沒想到的訊息賽跑。
#      實測四個世界(重跑, 而這次它們印不同的東西):
#        手造真紅   ⇒ rc=0 · 真紅 1 支        手造 build 紅 ⇒ rc=0 · build 紅 1 支
#        **rc=1 那一發 ⇒ rc=1 · 印「我看不見這一份」**   全綠 ⇒ rc=0 · 不叫
#      ⇒ `--selftest` 從 5 格加到 **9 格**(正 5 / 負 4), 新增四格全在演 `blind_check` 雙向。
#   ⚠️ **而它仍然不知道【是哪一支測試】沒跑到** —— 它只知道「這份 log 我讀不出健康」。
#      那一格要人自己看 log 尾巴, 本支不假裝答得出來。
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

# 🔴🔴 2026-09-03 補:接住【本支看不見的那一種紅】(線 -account 實測, 主視窗 -87 裁准)
#   判準是**結構性的**, 不是字面:【我一列都報不出來, 而這份 log 沒有健康跑完的證據】
#   ⇒ 刻意**不去解析 "No test files found"** —— 那是在跟下一種沒想到的訊息賽跑。
#   ⇒ fail-closed 的方向:看不見就要說看不見, 不要印 0。
blind_check() {   # $1=已分類列數  $2=log 檔  ⇒ stdout 0/1
  _n="$1"; _log="$2"
  [ "$_n" -gt 0 ] && { echo 0; return; }
  # 呼叫端若照建議把 rc 存進 log(`echo "rc=$?" >> log`), 那是最硬的證據
  _rc=$(grep -oE '(^|[^A-Za-z_])rc=[0-9]+' "$_log" 2>/dev/null | grep -oE '[0-9]+$' | tail -1)
  if [ -n "$_rc" ] && [ "$_rc" != "0" ]; then echo 1; return; fi
  # 沒有 rc 可看 ⇒ 退而求其次:一份健康跑完的 vitest log 一定有 "Test Files … passed"
  if grep -qE '^ *Test Files +[0-9]+ passed' "$_log" 2>/dev/null; then echo 0; else echo 1; fi
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
  # ── 🔴 2026-09-03 新增:blind_check 的四個世界(它自己也要能雙向表演)──
  _t=$(mktemp); printf '%s\n' ' RUN  v4.1.5 /x' 'No test files found, exiting with code 1' 'rc=1' > "$_t"
  [ "$(blind_check 0 "$_t")" = 1 ] || { echo "❌ 世界C:rc=1 而零命中 竟然沒被叫住"; fail=1; }
  printf '%s\n' ' Test Files  737 passed (737)' 'rc=0' > "$_t"
  [ "$(blind_check 0 "$_t")" = 0 ] || { echo "❌ 負對照三:全綠竟然被誤叫"; fail=1; }
  printf '%s\n' ' RUN  v4.1.5 /x' 'No test files found, exiting with code 1' > "$_t"
  [ "$(blind_check 0 "$_t")" = 1 ] || { echo "❌ 世界D:沒存 rc 也要靠【缺少 passed 摘要】叫住"; fail=1; }
  printf '%s\n' ' Test Files  1 passed (1)' > "$_t"
  [ "$(blind_check 1 "$_t")" = 0 ] || { echo "❌ 負對照四:有命中就不該叫"; fail=1; }
  rm -f "$_t"
  # ═══ 戳記【新不新】的兩個世界(2026-09-07 加;mail 量到, 三窗各撞一次)═══
  #   🔴 這兩格測的是【比較邏輯】, 不是真的去 build —— 用兩個現造的時間戳表演。
  _sd=$(mktemp -d); : > "$_sd/BUILD_OK"
  _stale_check() {   # $1=戳記時間 $2=HEAD 時間 ⇒ 印 1=該叫(過期) 0=不該叫
    if [ "$1" -lt "$2" ]; then echo 1; else echo 0; fi
  }
  [ "$(_stale_check 1000 2000)" = 1 ] || { echo "❌ 世界E:戳記【舊於】HEAD 必須叫"; fail=1; }
  [ "$(_stale_check 2000 1000)" = 0 ] || { echo "❌ 負對照五:戳記【新於】HEAD 不該叫"; fail=1; }
  [ "$(_stale_check 1500 1500)" = 0 ] || { echo "❌ 負對照六:同一秒不該叫(build 就在那顆 commit 上)"; fail=1; }
  # 🔴 而上面三格只驗算式 ⇒ 再驗一次【真的讀得到檔案時間】, 否則 stat 壞掉時算式照樣全過
  _real=$(stat -f %m "$_sd/BUILD_OK" 2>/dev/null || stat -c %Y "$_sd/BUILD_OK" 2>/dev/null || echo 0)
  [ "$_real" -gt 0 ] || { echo "❌ 世界F:stat 讀不到剛建的戳記時間(讀到 $_real)⇒ 上面三格是空轉"; fail=1; }
  rm -rf "$_sd"
  [ "$fail" = 0 ] && echo "✅ selftest 13 格全過(正 6 / 負 6 / 量具活性 1)" || echo "🔴 selftest 有格沒過"
  exit "$fail"
fi

LOG="${1:-}"
[ -n "$LOG" ] && [ -r "$LOG" ] || { echo "用法: $0 <vitest log 檔> | $0 --selftest" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
echo "== 你這棵樹的 build 戳記(決定你【會不會】看到假紅)=="
# 🔴 2026-09-07 補「新不新」那一半(mail 量到, 今晚三窗各撞一次):
#    本段原本只問【戳記在不在】⇒ 而 merge 帶進新的 storefront 碼、build 卻是**合併前**跑的,
#    戳記照樣在 ⇒ 假紅被判成真紅, 三個人各自去追一個不存在的 bug。
#    ⇒ 📌 **「build 過」與「build 過【現在這份碼】」是兩件事, 而戳記只答得出前者。**
# 🔴 2026-09-07 補:**非 browser 的檔也會因為 load 飄**(主視窗轉 auth 實錘)。
#    auth `a11082dea` 全套:第 1 發**零紅**、第 2 發 **3 支紅**(order-panel-wiring /
#    products/[id]/page / cancel-request-token —— **都不是 browser 檔**), 而**單跑三發全綠**。
#    當時 `db` + `ship` 同時在跑全套;`db` 量同一支 `cancel-request-token` 五發 **5-25 秒**。
#    🛑 **⇒ 「這支不是 browser 檔」不足以判它是真紅** —— 而本工具原本只把 browser 那一族分出來。
#    📌 所以印【當下的 load】與【有幾個 vitest 在跑】: 那兩個數字**不判定任何事**,
#       它們讓你知道**這一發是在什麼環境下跑的** —— 而那是事後回頭看時唯一還原得了的東西。
echo "== 這一發跑的時候, 這台機器在忙什麼 =="
printf '  load averages  %s\n' "$(uptime | sed 's/.*averages*: *//')"
printf '  在跑的 vitest  %s 個\n' "$(pgrep -fl vitest 2>/dev/null | grep -c . || echo 0)"
echo "  ⚠️ 高 load 之下【非 browser 的檔也會飄】(2026-09-07 auth 實錘:同一顆 commit 第 1 發 0 紅、第 2 發 3 紅、單跑全綠)"
echo "     ⇒ 下面分出來的「真紅」若都在同一批出現、而單跑會綠 ⇒ **先看這兩個數字, 再去修碼。**"
echo

HEAD_CT=$(git -C "$REPO" log -1 --format=%ct HEAD 2>/dev/null || echo 0)
# 🔴 2026-09-07 補(`-ship` `⟦f3-PGPORTCOLLISION⟧` ④ 的同型):**丟掉 stderr 之後, 兩種失敗印同一個東西。**
#    這裡 `|| echo 0` 讓 git 失敗降級成 `HEAD_CT=0` ⇒ 而 `0` 會讓下面每一支戳記都判「不舊」
#    ⇒ 🛑 **「這棵樹沒有 git」與「戳記都是新的」印同一個結論(= 全部安靜)。**
#    ⇒ 所以在這裡問一次, 而**不是**把 `2>/dev/null` 拿掉(拿掉只會多噴一行 git 的錯誤, 判定照樣壞)。
if [ "$HEAD_CT" = "0" ]; then
  echo "  🔴 讀不到 HEAD 的時間(git 失敗或這裡不是 repo)⇒ **下面的「戳記新不新」這一格今天沒有答案**"
  echo "     ⚠️ 它【不是】說戳記是新的 —— 是這一格沒跑成。"
fi
for a in admin storefront; do
  STAMP="$REPO/apps/$a/.next/BUILD_OK"
  if [ ! -e "$STAMP" ]; then
    echo "  apps/$a: 🔴 沒有戳記 ⇒ 這棵樹會印出不屬於你的紅"
    continue
  fi
  ST_CT=$(stat -f %m "$STAMP" 2>/dev/null || stat -c %Y "$STAMP" 2>/dev/null || echo 0)
  if [ "$ST_CT" -lt "$HEAD_CT" ]; then
    echo "  apps/$a: 🔴 **戳記過期** —— build 於 $(date -r "$ST_CT" '+%m-%d %H:%M' 2>/dev/null), 而 HEAD 是 $(date -r "$HEAD_CT" '+%m-%d %H:%M' 2>/dev/null)"
    echo "           ⇒ 戳記【在】而它 build 的是**舊碼** ⇒ 下面的紅仍可能是假的。"
    echo "           ⇒ 先跑 \`TURBO_FORCE=1 pnpm build\` 再跑一次本工具。"
  else
    echo "  apps/$a: 有戳記, 且不舊於 HEAD"
  fi
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
BLIND=$(blind_check "$((NB + NR))" "$LOG")
if [ "$BLIND" = 1 ]; then
  echo "== 🔴🔴 我看不見這一份 =="
  echo "  我一列都報不出來, 而這份 log 沒有【健康跑完】的證據(沒有 rc=0, 也沒有 Test Files … passed)。"
  echo "  ⇒ 那可能是一種【一行 FAIL 都沒有的失敗】(例:路徑餵錯 ⇒ 沒有任何測試被選到)。"
  echo "  ⇒ 🔴 **請自己看 log 尾巴**;而下次跑的時候把 rc 一起存進去:"
  echo "       npx vitest run > /tmp/v.log 2>&1 ; echo \"rc=\$?\" >> /tmp/v.log"
  echo
fi
echo "== 射程 =="
echo "  · 分母 = 你餵的這份 log。log 不全 ⇒ 上面的數就不全。"
echo "  · 判不出來的一律歸【真紅】⇒ 它可能多報,不會少報。"
echo "  · 它【不】驗「build 完真的會綠」。要那句話就自己 build 完重跑。"

[ "$BLIND" = 1 ] && exit 1
exit 0
