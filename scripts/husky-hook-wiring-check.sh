#!/bin/sh
# ============================================================
# husky hook 檔的【接線】檢查 —— 語法 + 離場碼有沒有被傳出去
# ============================================================
# 為什麼要有(2026-08-21 W5;#798 洞 A 的實作):
#   `.husky/pre-commit` 與 `.husky/pre-push` **沒有副檔名** ⇒ 不命中 package.json
#   lint-staged 的 `*.{sh,yaml,yml,sql}` ⇒ 不進 `scripts/check-syntax-nonts.ts` 的分母。
#   當場量:`npx tsx scripts/check-syntax-nonts.ts .husky/pre-commit` ⇒ **檢查 0 檔**。
#   ⇒ 這兩支檔寫錯語法,失效方式是「commit/push 時整段安靜地不跑」,畫面上什麼都不會紅。
#
# 🔴 它檢查兩件事,第二件是這一夜真的踩到的:
#   ① `sh -n` 語法
#   ② **每一道 `sh .husky/xxx.sh` 都要接 `|| exit $?`** ——
#      少接的那一道,它的離場碼會被丟掉或被壓掉:
#        · 什麼都不接 ⇒ 只在 husky 的 `sh -e` 之下才擋(`.husky/_/h:17`),裸 `sh` 之下不擋
#        · `|| exit 1` ⇒ 把三態閘的 `2`(量具自己壞了)壓成 `1`(有 finding)
#      兩種失效都**沒有東西會紅**。
#   🔴 分母只數**非註解行** —— 本檔與 `.husky/pre-commit` 的檔頭都在講 `|| exit $?`,
#      不濾註解的話兩邊都會數錯(2026-08-21 第一版就是這樣,正負世界都回 1)。
#
# 🔴 pre-push 是一條 `&&` 鏈、沒有 `sh .husky/*.sh` 這種行 ⇒ 對它只驗語法 + 兩支 gate 還在鏈上。
#
# exit 0 = 接線正常   1 = 接線有問題   2 = 用法錯 / 本工具自己壞了
#
# 用法:
#   sh scripts/husky-hook-wiring-check.sh              檢查本 repo 的兩支 hook
#   sh scripts/husky-hook-wiring-check.sh --selftest   雙向表演(不碰本 repo 的檔)
#
# 🔴 【這一層沒有守門】(2026-08-21 codex R4 MF-5,老實寫出來,不要留一個看起來被守著的東西):
#    下面的自檢證明的是「**被驗物**還對不對」;而「**這些自檢自己有沒有退化成恆真**」
#    沒有任何外層在看。把判定改成永遠 PASS、或把核心函式換成 `return 0` ——
#    白名單仍看到精準 entry、shell 語法仍綠、本檔自己那條 lint-staged task 也綠 ⇒ **零訊號**。
#    ⇒ 現況只靠 code review 看那個 diff。停在這一層的理由與可能的外層:
#      `~/pcm-mailbox/W5-070-帳本分岔守門-20260821.md` §14。
# ============================================================
set -u
export LC_ALL=C

usage() { echo "用法: sh scripts/husky-hook-wiring-check.sh [--selftest]" >&2; }

MODE="check"
case "${1:-}" in
  '')         MODE="check" ;;
  --selftest) MODE="selftest"; shift ;;
  -h|--help)  MODE="help" ;;
  -*)         echo "✗ 不認得的參數:$1" >&2; usage; exit 2 ;;
  *)          MODE="check" ;;   # 非 dash 開頭 = lint-staged 附加的檔名,不是旗標
esac
# 🔴 lint-staged 會把 staged 的檔名【附加在命令後面】(2026-08-21 codex R4 must-fix):
#    `sh 本檔 --selftest` 實際會變成 `sh 本檔 --selftest <檔名>`
#    ⇒ 舊寫法把它判成「多餘的參數」回 2 ⇒ **本批 commit 必紅**。
#    ⇒ 收下位置參數並印出來(不靜靜吃掉),但**打錯的 option 仍要炸**。
#    📌 這個坑我今天才在 `scripts/stale-commit-msgs.py:126-133` 處理過一次,然後在
#       三支新的 shell 腳本上又踩一次 —— 知道一個坑,擋不住你在下一段掉進去。
_extra_opts=""; _extra_pos=""
for _a in "$@"; do
  case "$_a" in
    -*) _extra_opts="$_extra_opts $_a" ;;
    *)  _extra_pos="$_extra_pos $_a" ;;
  esac
done
if [ -n "$_extra_opts" ]; then
  echo "✗ 不認得的參數:$_extra_opts —— 打錯的 option 不會被當成檔名放行" >&2; usage; exit 2
fi
if [ -n "$_extra_pos" ]; then
  echo "(忽略位置參數:$_extra_pos —— 本工具不吃檔名;lint-staged 會附加它們)" >&2
fi
if [ "$MODE" = "help" ]; then usage; exit 0; fi

# $1 = pre-commit 檔路徑 → 0 接線正常 / 1 有問題 / 2 工具自壞
check_precommit() {
  f="$1"
  if [ ! -f "$f" ]; then
    echo "🔴 找不到 $f ⇒ 無法判斷,exit 2" >&2; return 2
  fi
  if ! sh -n "$f" 2>/dev/null; then
    echo "🔴 $f 語法錯 ⇒ 它在 commit 時會整段不跑,而畫面上不會紅" >&2; return 1
  fi
  body=$(grep -v '^[[:space:]]*#' "$f")
  g=$(printf '%s\n' "$body" | grep -c 'sh \.husky/')
  # 🔴 **逐行綁定,不比總數**(2026-08-21 codex R4 must-fix):
  #    比「gate 呼叫總數」與「`|| exit $?` 總數」時,一道漏接 + 別處多一個同字面 ⇒ 數量相等便誤綠。
  #    這裡直接列出「有 gate 呼叫、而【那一行自己】沒有 `|| exit $?`」的行。
  bad=$(printf '%s\n' "$body" | grep 'sh \.husky/' | grep -v '|| exit \$?')
  if [ "$g" -lt 1 ]; then
    echo "🔴 $f 裡一道閘都沒有(非註解行 grep 'sh .husky/' ⇒ 0)⇒ 掃錯檔或格式變了,exit 2" >&2
    return 2
  fi
  if [ -n "$bad" ]; then
    echo "🔴 $f:$g 道閘,而下面這幾行【自己那一行】沒有接 \`|| exit \$?\`" >&2
    printf '%s\n' "$bad" | sed 's/^/      ✗ /' >&2
    echo "   ⇒ 沒接的那道,離場碼會被丟掉(裸 sh 之下不擋)或被壓成 1(三態閘的 2 消失)。" >&2
    echo "   ⇒ 兩種失效都沒有東西會紅。修法:那一行尾巴接上 \`|| exit \$?\`。" >&2
    return 1
  fi
  echo "── husky 接線:$f 共 $g 道閘,全部接了 || exit \$?"
  return 0
}

# $1 = pre-push 檔路徑
# ── 基準集比對:【鏈沒有變短】(2026-09-03;codex MF8)────────────────────────────
#
# 🔴🔴 **它為什麼存在, 而它不是假想的風險**:上面 `check_prepush` 只**寫死列舉兩支**
#    (`deploy-order-gate.sh` / `migration-ledger-divergence.sh`)——
#    而 `selftest-git-isolation-gate.sh` 在 pre-push 的鏈上跑了一整天, **本檔零命中**。
#    ⇒ 🎯 **2026-09-03 下午它真的被刪過一次, 而唯一發現的是刪的那個人自己(我)。**
#    ⇒ ⇒ 📌 **自己發現不是機制。** 那正是「自抓有三個機制, 而只有無條件對照做得成機制」那一條。
#
# 🛑🛑 **本閘證的是【鏈沒有變短】。它證不到『該有的閘都在』。**
#    ⇒ 基準集是**從 pre-push 自己 parse 出來的** ⇒ 它結構上不可能「相對 pre-push 不完整」,
#      而它也因此**繼承了 pre-push 當下的缺漏**。⇒ 「該不該有第五道」是人的判斷, 不是本閘的。
#    ⇒ 🔴 **這一節要跟它抓到什麼一樣顯眼** —— 否則人會把它的沉默讀成背書。
#
# ⚠️ **射程:兩個面都釘, 不只那一行 `&&` 鏈。**
#    pre-push 有兩個面 ——(一)那一行 `&&` 串接(三支 `scripts/*.sh`)
#    (二)底下一個 `if` 區塊(`.husky/always-loaded-size-gate.sh`)。
#    ⇒ 🛑 **只 parse 那一行會靜靜漏掉第二面, 而那正是 MF8 本身的病** ⇒ 所以掃全部非註解行。
#
# 🔴 **撈子的形狀是量過的, 不是想當然**:`grep -oE '(scripts|\.husky)/…'` 那種**交替式**
#    在本機實測**靜默少報**(那一行的三支一支都撈不到, 而 `.husky/` 那支撈得到)
#    ⇒ 改成**兩發分開掃再合併**, 而下面 `_pp_gates` 跑完會印出支數 ⇒ **數字看得到才算量過**。
_pp_gates() {
  # $1 = pre-push 路徑。只看非註解行。
  { grep -v '^[[:space:]]*#' "$1" | grep -oE '[a-zA-Z._$/{}]*scripts/[A-Za-z0-9_.-]+\.sh' | sed 's|.*/scripts/|scripts/|'
    grep -v '^[[:space:]]*#' "$1" | grep -oE '[a-zA-Z._$/{}]*\.husky/[A-Za-z0-9_.-]+\.sh' | sed 's|.*\.husky/|.husky/|'
  } | sort -u
}

check_prepush_baseline() {
  f="$1"; base="$2"
  # 🔴 **基準集不見 ⇒ 紅, 不是「什麼都不少 ⇒ 全綠」。**
  #    那是 fail-open, 而 fail-open 藏住「有沒有裝上」——
  #    刪掉基準集會讓這道閘變成一句恆真的話, 而畫面上一切正常。
  if [ ! -s "$base" ]; then
    echo "🔴 基準集不見或是空的:$base" >&2
    echo "   ⇒ 沒有基準 = 沒有【昨天】可以比 ⇒ 本閘擋下, 不靜靜通過(fail-closed)。" >&2
    return 1
  fi
  # 🔴🔴 **用暫存檔, 不用 `<(...)`** —— 本檔被 `sh` 呼叫(lint-staged 那條是 `sh scripts/…`),
  #    而**行程替換不是 POSIX sh**。⚠️ 而它壞掉的方式**不是報錯就停**:
  #    2026-09-03 第一版就是這樣寫的 ⇒ `sh` 噴 syntax error 到 stderr、
  #    而 `gone` / `added` 兩個變數**變成空的** ⇒ 本閘印「基準 4 支 · 現在 4 支」並 **return 0**。
  #    ⇒ 🎯 **它 fail-open 了, 而畫面上看起來完全正常。**
  #    ⇒ ⇒ 📌 抓到它的不是 rc(rc 是 0), 是**我去讀了它印的東西** ——
  #      那正是這一族最貴的一格:**該紅而沒紅, 而沒有任何訊號。**
  _tw="$(mktemp)" || return 2
  _tn="$(mktemp)" || { rm -f "$_tw"; return 2; }
  now=$(_pp_gates "$f")
  want=$(grep -v '^[[:space:]]*#' "$base" | grep -v '^[[:space:]]*$' | sort -u)
  printf '%s\n' "$want" > "$_tw"
  printf '%s\n' "$now" > "$_tn"
  gone=$(comm -23 "$_tw" "$_tn")
  added=$(comm -13 "$_tw" "$_tn")
  rm -f "$_tw" "$_tn"
  echo "── pre-push 鏈上的閘:基準 $(printf '%s\n' "$want" | wc -l | tr -d ' ') 支 · 現在 $(printf '%s\n' "$now" | wc -l | tr -d ' ') 支"
  if [ -n "$added" ]; then
    # 🔵 **變多【不紅】** —— 否則每加一道閘都要先餵它, 而那種閘會死於誤報。
    echo "   🔵 比基準多了(不擋, 而更新基準集才會讓下一次以新的為準):"
    printf '      + %s\n' $added
  fi
  if [ -n "$gone" ]; then
    echo "🔴 pre-push 的鏈【變短了】—— 基準集裡有而現在沒有:" >&2
    printf '   - %s\n' $gone >&2
    echo "   ⇒ 若那是刻意拿掉的, 手改 scripts/husky-pre-push-gate-baseline.txt 並說明理由。" >&2
    return 1
  fi
  # 🛑 這一句與上面那些紅字【一樣顯眼】, 而它是刻意的:讀的人不可以把沉默讀成背書。
  echo "   🛑 本閘證的是【鏈沒有變短】。它**證不到**「該有的閘都在」——"
  echo "      基準集是從 pre-push 自己 parse 的 ⇒ 它繼承了 pre-push 當下的缺漏。"
  return 0
}

check_prepush() {
  f="$1"
  if [ ! -f "$f" ]; then
    echo "🔴 找不到 $f ⇒ 無法判斷,exit 2" >&2; return 2
  fi
  if ! sh -n "$f" 2>/dev/null; then
    echo "🔴 $f 語法錯 ⇒ 它在 push 時會整段不跑,而畫面上不會紅" >&2; return 1
  fi
  # 🔴 **只看非註解行**(2026-08-21 codex R4 must-fix):`.husky/pre-push` 的註解本來就
  #    寫著這兩支 gate 的名字(當場量:整檔 grep -c ⇒ 2,濾註解 ⇒ 1)
  #    ⇒ 把真正鏈上那一道刪掉,整檔 grep 仍然命中 ⇒ 誤綠。
  #    📌 這與 pre-commit 那半是【同一個病】,而我今天為 pre-commit 做了、pre-push 沒做。
  ppbody=$(grep -v '^[[:space:]]*#' "$f")
  miss=""
  for g in scripts/deploy-order-gate.sh scripts/migration-ledger-divergence.sh; do
    printf '%s\n' "$ppbody" | grep -q "$g" || miss="$miss $g"
  done
  if [ -n "$miss" ]; then
    echo "🔴 $f 的鏈上少了:$miss" >&2
    echo "   ⇒ 整段被刪掉時,既有的 shape harness(deploy-order-gate-verify 格⑱)仍會 PASS。" >&2
    return 1
  fi
  echo "── husky 接線:$f 語法過,兩支 gate 都還在鏈上"
  return 0
}

if [ "$MODE" = "selftest" ]; then
  T=$(mktemp -d) || exit 2
  # 🔴 INT/TERM 的 handler 要自己 `exit`(2026-08-21 R3 must-fix,與 `.husky/pre-push:37` 同一條):
  #    只清暫存而不離場的話,Ctrl-C 之後**執行流會繼續往下跑**,而暫存已經刪了
  #    ⇒ 被中斷的那一次仍會印出一個判決。EXIT 那條只負責清檔,不改離場碼。
  trap 'rm -rf "$T"' EXIT
  trap 'rm -rf "$T"; exit 1' INT TERM
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then echo "  PASS $1 (rc=$2)"; pass=$((pass+1));
         else echo "  🔴 FAIL $1 (rc=$2, 該是 $3)"; fail=$((fail+1)); fi }

  # A【該綠】兩道閘都接了 || exit $?,而檔頭註解裡也出現那串字(分母必須濾掉註解)
  cat > "$T/pc-ok" <<'X'
# 註解裡也寫 sh .husky/foo.sh 與 || exit $? —— 分母不濾註解就會數錯
if [ -f .husky/a.sh ]; then
  sh .husky/a.sh || exit $?
fi
if [ -f .husky/b.sh ]; then
  sh .husky/b.sh || exit $?
fi
pnpm exec lint-staged
X
  check_precommit "$T/pc-ok" >/dev/null 2>&1
  ck "A 兩道都接、註解含同樣字串 ⇒ 0" "$?" "0"

  # B【該紅】其中一道沒接
  sed 's|sh .husky/b.sh || exit $?|sh .husky/b.sh|' "$T/pc-ok" > "$T/pc-bad" 2>/dev/null || true
  awk '{ if ($0 == "  sh .husky/b.sh || exit $?") print "  sh .husky/b.sh"; else print }' "$T/pc-ok" > "$T/pc-bad"
  if diff -q "$T/pc-ok" "$T/pc-bad" >/dev/null 2>&1; then
    echo "  🔴 FAIL 突變沒套上 ⇒ B 格作廢"; fail=$((fail+1))
  else
    check_precommit "$T/pc-bad" >/dev/null 2>&1
    ck "B 有一道沒接 ⇒ 1" "$?" "1"
  fi

  # C【該紅·語法】
  printf 'if [ -f x ]; then\n  sh .husky/a.sh || exit $?\n' > "$T/pc-syn"
  check_precommit "$T/pc-syn" >/dev/null 2>&1
  ck "C 語法錯(fi 少了)⇒ 1" "$?" "1"

  # D【工具自壞】一道閘都沒有 ⇒ 不是「乾淨」
  printf 'echo hi\n' > "$T/pc-empty"
  check_precommit "$T/pc-empty" >/dev/null 2>&1
  ck "D 分母 0 道閘 ⇒ 2,不是 0" "$?" "2"

  # E【工具自壞】檔不存在
  check_precommit "$T/nope" >/dev/null 2>&1
  ck "E 檔不存在 ⇒ 2" "$?" "2"

  # F【該綠】pre-push 兩支 gate 都在
  printf 'a && b && bash scripts/deploy-order-gate.sh && sh scripts/migration-ledger-divergence.sh\n' > "$T/pp-ok"
  check_prepush "$T/pp-ok" >/dev/null 2>&1
  ck "F pre-push 兩支 gate 都在 ⇒ 0" "$?" "0"

  # G【該紅】pre-push 少了第四段
  printf 'a && b && bash scripts/deploy-order-gate.sh\n' > "$T/pp-bad"
  check_prepush "$T/pp-bad" >/dev/null 2>&1
  ck "G pre-push 少了 ledger gate ⇒ 1" "$?" "1"

  # I【該紅·MF-3】pre-push:註解裡有那兩支 gate 的名字,而鏈上少了一支 ⇒ 必須紅
  printf '# 註解:scripts/deploy-order-gate.sh 與 scripts/migration-ledger-divergence.sh\na && bash scripts/deploy-order-gate.sh\n' > "$T/pp-cmt"
  check_prepush "$T/pp-cmt" >/dev/null 2>&1
  ck "I pre-push 註解有、鏈上沒有 ⇒ 1(不可被註解騙過)" "$?" "1"

  # J【該紅·MF-4】pre-commit:總數相等而綁定錯 —— 一道漏接、別處多一個同字面
  cat > "$T/pc-count" <<'X'
if [ -f .husky/a.sh ]; then
  sh .husky/a.sh || exit $?
fi
if [ -f .husky/b.sh ]; then
  sh .husky/b.sh
fi
echo done || exit $?
X
  check_precommit "$T/pc-count" >/dev/null 2>&1
  ck "J 總數相等而逐行綁定錯 ⇒ 1" "$?" "1"

  # H【用法錯】
  sh "$0" --selftest --bogus >/dev/null 2>&1
  ck "H 多餘參數 ⇒ 2" "$?" "2"

  echo "  ── selftest: $pass PASS / $fail FAIL"
  # 🔴 格數守門比的是【跑過幾格】(pass+fail),不是【過了幾格】(pass)——
  #    2026-08-21 R3(W3)實測:讓某一格正確翻紅 ⇒ 17 PASS / 1 FAIL,而**格數其實還是 18**,
  #    舊寫法卻印「格數不對:有格被刪掉或沒跑到」⇒ **診斷指錯方向**,
  #    而它印在「17 PASS / 1 FAIL」之後 ⇒ 讀的人最後看到的是錯的那一句。
  #    「一格失敗」與「一格不見了」修法完全不同,不能共用同一個出口。
  EXPECT=10
  if [ "$((pass + fail))" != "$EXPECT" ]; then
    echo "  🔴 【格數】不對:跑了 $((pass + fail)) 格 ≠ $EXPECT ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)"; exit 1
  fi
  if [ "$fail" != "0" ]; then exit 1; fi
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "🔴 不在 git repo 裡 ⇒ exit 2" >&2; exit 2; }
rc=0
check_precommit "$ROOT/.husky/pre-commit" || rc=$?
check_prepush   "$ROOT/.husky/pre-push"   || { r2=$?; [ "$r2" -gt "$rc" ] && rc=$r2; }
# 🔵 基準集比對(2026-09-03 加):與上面那道【互補】——
#    上面問「那兩支寫死的還在嗎」, 這裡問「整條鏈有沒有比昨天短」。
check_prepush_baseline "$ROOT/.husky/pre-push" "$ROOT/scripts/husky-pre-push-gate-baseline.txt" || { r3=$?; [ "$r3" -gt "$rc" ] && rc=$r3; }
exit $rc
