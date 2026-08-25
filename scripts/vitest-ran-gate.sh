#!/bin/sh
# vitest-ran-gate.sh —— 讓「vitest 根本沒跑到」這件事【自己會叫】。
#
# ══════════════════════════════════════════════════════════════════════
# 病(2026-08-25 一天內三個人各踩一次,三個不同成因)
# ══════════════════════════════════════════════════════════════════════
#   cf   工作目錄還停在 packages/adapters ⇒ include 樣式對不上 ⇒ 0 個檔
#   b4   路徑打成 …Adapter.ts.test.ts     ⇒ 查無檔
#   1b   cwd 在 apps/admin 而路徑從 repo 根算 ⇒ No test files found
# 🔴 三次的外觀都一樣:**沒有任何 `Tests  N passed` 那一行,而它看起來只是安靜。**
#    b4 那次更毒 —— 它接了 `| grep "Tests"`,於是**連那句「查無檔」都被濾掉了**。
#
# 判別句(本閘就是它的機械化):
#   🔴 **看不到 `Tests  N passed` 那一行 ⇒ 它沒有跑,不是它沒事。**
#
# ── 🔴 分母:它擋得住什麼、擋不住什麼(先讀,不然會把它當成更大的保證)──────
#   ✅ 擋得住:輸出裡【完全沒有】`Tests ` 摘要行(= 一個檔都沒跑到)
#   🔴 擋不住:`Tests ` 行【在】而少跑了幾格
#            (06/b4 2026-08-25 量到:同一棵樹三發三個總數 11152 / 11101 / 11169,
#             其中一發**印全綠而少 22 格**)—— **那是另一個病,本閘對它零判別力。**
#   ⇒ 兩者不要合成一句話。本閘只把「安靜」變成「有聲」。
#
# ── 不改變任何既有行為 ────────────────────────────────────────────
#   · 輸出原樣印出(不吞、不改順序)
#   · exit code 是**三態**,不是「原封轉發」一句話講得完的
#     (🔴 2026-08-25 codex must-fix:原句只寫「原封轉發」,而 98 那條分支是後來補的、
#      檔頭沒跟 —— **行為是對的,假的是那句宣稱**。同族母題:我改了一個地方,而它旁邊那個沒跟。)
#       ① 有 `Tests ` 行【且真的跑過東西】 ⇒ **原封轉發 vitest 自己的**(紅照紅、綠照綠)
#       ② 有 `Tests ` 行【而一格都沒真的跑】(全 skipped)⇒ exit 98,**不轉發**
#          🔴 這一格 vitest 自己回 **0**。沒有這道閘,那個世界看起來完全正常。
#       ③ 完全沒有 `Tests ` 行 ⇒ exit 97(與 vitest 慣用的 0/1 分得開)
#
# ── 用法 ──────────────────────────────────────────────────────────
#   sh vitest-ran-gate.sh <原本要餵給 vitest 的所有參數>
#   例:sh vitest-ran-gate.sh run --project node packages/x/y.test.ts
#
# ⚠️ 它自己【不對 repo 做任何寫入】:只用 mktemp,收工即刪。
#    🔴 `mktemp` **不是 POSIX 規範指令** ⇒ 極簡系統上沒有它時本閘回 96(本 repo 環境有它)。
#       寫下來的理由:原句讀起來像 mktemp 一定在。

set -u

OUT=$(mktemp) || { echo "🔴 vitest-ran-gate:mktemp 失敗 ⇒ 本閘自壞,輸出作廢" >&2; exit 96; }
# 🔴 **只掛 EXIT,不要掛 INT TERM HUP**(2026-08-25 codex must-fix,兩個世界都實測過):
#    掛了訊號 ⇒ handler 跑完之後 **shell 會【繼續執行下一行】** ⇒ `$OUT` 已被刪、`cat` 讀不到
#    ⇒ 一路走到最後 `exit 97`「它沒有跑」。**而它其實跑了,只是被中斷。**
#    📌 「被中斷」與「沒跑到」印同一句話 —— 那正是本閘要消滅的東西,在它自己身上復發。
#    實測【對本閘本體,兩個世界各跑一發】(macOS /bin/sh;對背景程序送 TERM ——
#    🔴 背景程序預設【忽略 INT】,第一發用 kill -INT 完全沒打中而外觀是「它沒事」):
#      掛 EXIT INT TERM HUP ⇒ 🔴 **rc=97,而且真的印出「它沒有跑」** —— 中斷被誤報成沒跑
#      只掛 EXIT            ⇒ ✅ rc=143(訊號死,分得開)· 不印那句話
trap 'rm -f "$OUT"' EXIT

# 🔴 不接管線 —— pipeline 之後的 $? 是【右端】那個指令的,不是 vitest 的。
#    先落檔取得真正的 rc,再把檔案印出來。
npx vitest "$@" > "$OUT" 2>&1
RC=$?

cat "$OUT"

# `Tests  35 passed (35)` / `Tests  1 failed | 34 passed (35)` 兩種都要認得。
SUMMARY=$(grep -E '^[[:space:]]*Tests[[:space:]]+[0-9]' "$OUT" | tail -1)

if [ -n "$SUMMARY" ]; then
  # 🔴 有 Tests 行【不等於】有東西跑過(這一格是本閘自己的洞,實測補的):
  #    `-t` 過濾沒命中任何測試 ⇒ 印「Tests  38 skipped (38)」而且 **rc=0** ⇒ 舊版會放行。
  #    ⇒ 判準:那一行裡要真的有【跑過的東西】—— passed 或 failed 至少一個非零。
  RAN=$(printf '%s' "$SUMMARY" | grep -cE '[1-9][0-9]* (passed|failed)')
  if [ "$RAN" -gt 0 ]; then
    exit "$RC"
  fi
  echo '' >&2
  echo "🔴 vitest-ran-gate:有 Tests 行,而**一格都沒有真的跑**(逐字:$SUMMARY)" >&2
  echo '   最常見成因:`-t` / `--project` 的過濾沒有命中任何測試 ⇒ 全部 skipped 而 exit 0。' >&2
  echo '   🔴 這一格與「完全沒有 Tests 行」不同:它【印得出摘要】,所以更像跑完了。' >&2
  exit 98
fi

echo '' >&2
echo '🔴 vitest-ran-gate:輸出裡【找不到】`Tests  N …` 那一行 ⇒ **它沒有跑,不是它沒事。**' >&2
echo '   最常見的三個成因(2026-08-25 一天內各踩過一次):' >&2
echo '     ① 工作目錄不對 —— vitest 的 include 是相對 root 算的,先 `cd` 到 repo 根' >&2
echo '     ② 測試檔路徑打錯(例:多一截副檔名)⇒ 查無檔' >&2
echo '     ③ 變數沒引號被 word split ⇒ 餵進去的路徑不是你以為的那個' >&2
echo "   （vitest 自己的 exit code 是 $RC —— 🔴 而它在【查無檔】時可以是 0 或 1,不足以判別）" >&2
exit 97
