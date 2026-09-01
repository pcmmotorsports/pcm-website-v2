#!/usr/bin/env bash
# design-ref-check.sh — 你在【這一棵工作樹】grep design-reference,答案有沒有分母?
#
# ══ 🔴🔴 它為什麼存在(而它不是為了方便)═══════════════════════════════════════
#    2026-09-02 `-15` 實量:**13 棵工作樹裡有 12 棵的 `design-reference/` 是空的**
#    (只有主樹 `pcm-website-v2` 有東西)。`git submodule status` 前綴是 `-` = 未初始化。
#    🔴 而鐵則 1 逐字要求:「寫前台元件前**必先 grep design-reference 字面、不憑記憶**」
#    ⇒ ⇒ **那 12 棵裡的每一發 grep 都回零命中, 而讀的人會把它讀成【設計稿裡沒有這個】。**
#    📌 **⇒ 「查無」與「我站在一個空目錄裡」印同一個東西。**
#
# ══ 🛑 它擋不住什麼 —— 先讀這一段 ═════════════════════════════════════════════
#    · 它只答「**這一棵樹的 design-reference 有沒有東西**」。
#      🔴 它**不**答「你要找的那個字面在不在稿裡」—— 那要你自己 grep。
#    · 它**不**答「submodule 指到的那一版是不是最新的」(那是 `git submodule update --remote`)。
#    · 🔴 而它**不是**設計真權威的全部:鐵則 1 明寫真權威還包含 OD 專案
#      (`list_projects` + 磁碟目錄數對一次)⇒ **這支只守 design-reference 那一半。**
#
# ══ 用法 ═════════════════════════════════════════════════════════════════════
#   bash scripts/design-ref-check.sh            (在你要 grep 的那一棵樹底下跑)
#   bash scripts/design-ref-check.sh --selftest
#
#   rc=0 ⇒ 有分母, 可以 grep      rc=3 ⇒ **空的**(印出修法)      rc=1 ⇒ 工具自己壞了
#   🔴 三態分得開是刻意的:`rc=3` 不是失敗, 是「你的尺還沒接上」。
set -u

SUB="design-reference"
# 🔴 **正對照用的檔**:它在稿裡, 而它不是我隨手挑的 —— 它是 submodule 的根檔案。
#    ⇒ 有它 ⇒ 這一棵真的 checkout 過;沒有它而目錄非空 ⇒ **那是別的東西, 不是稿。**
SENTINEL="README.md"

die() { printf '🔴 design-ref-check 自己壞了:%s\n' "$1" >&2; exit 1; }

check_one() {
  local root="$1" label="$2"
  [ -d "$root" ] || { printf '  %-40s 🔴 連目錄都沒有\n' "$label"; return 3; }
  local n; n="$(ls -A "$root" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" = "0" ]; then
    printf '  %-40s 🔴 **空的**(0 個檔)\n' "$label"; return 3
  fi
  if [ ! -f "$root/$SENTINEL" ]; then
    printf '  %-40s ⚠️ 有 %s 個檔而【沒有 %s】⇒ 那可能不是稿\n' "$label" "$n" "$SENTINEL"; return 3
  fi
  printf '  %-40s ✅ %s 個檔(正對照 %s 在)\n' "$label" "$n" "$SENTINEL"; return 0
}

selftest() {
  local rc bad=0
  # 🔴 `SELFTEST_TMP` 是【全域】不是 local —— trap 在函式結束【之後】才跑,
  #    而 `set -u` 之下一個 local 變數在那時已經不存在 ⇒ 「unbound variable」。
  #    ⇒ 📌 而那個錯印在 selftest【全過】的下一行 ⇒ **一支自檢工具自己壞在收尾。**
  SELFTEST_TMP="$(mktemp -d)" || die "mktemp 失敗"
  trap 'rm -rf "${SELFTEST_TMP:-}"' EXIT
  local tmp="$SELFTEST_TMP"
  printf '── selftest ──\n'

  # 🟢 正對照:造一個【看起來對】的目錄
  mkdir -p "$tmp/ok" && printf 'x\n' > "$tmp/ok/$SENTINEL"
  check_one "$tmp/ok" "正對照 有稿" >/dev/null; rc=$?
  [ "$rc" = "0" ] && printf '  ✅ 有稿 ⇒ rc=0\n' || { printf '  🔴 有稿卻 rc=%s\n' "$rc"; bad=1; }

  # 🔴 負對照①:空目錄
  mkdir -p "$tmp/empty"
  check_one "$tmp/empty" "負對照 空的" >/dev/null; rc=$?
  [ "$rc" = "3" ] && printf '  ✅ 空的 ⇒ rc=3\n' || { printf '  🔴 空的卻 rc=%s\n' "$rc"; bad=1; }

  # 🔴 負對照②:**有東西而不是稿** —— 這一格擋的是「只數檔數」那種寫法
  mkdir -p "$tmp/wrong" && printf 'x\n' > "$tmp/wrong/some-other-file.txt"
  check_one "$tmp/wrong" "負對照 有東西而不是稿" >/dev/null; rc=$?
  [ "$rc" = "3" ] && printf '  ✅ 不是稿 ⇒ rc=3\n' || { printf '  🔴 不是稿卻 rc=%s ⇒ 只數檔數會漏掉它\n' "$rc"; bad=1; }

  # 🔴 負對照③:目錄不存在
  check_one "$tmp/nope" "負對照 目錄不存在" >/dev/null; rc=$?
  [ "$rc" = "3" ] && printf '  ✅ 不存在 ⇒ rc=3\n' || { printf '  🔴 不存在卻 rc=%s\n' "$rc"; bad=1; }

  printf '── selftest %s ──\n' "$([ "$bad" = "0" ] && printf '全過' || printf '🔴 有紅')"
  return "$bad"
}

[ "${1:-}" = "--selftest" ] && { selftest; exit $?; }
[ $# -gt 0 ] && { printf '用法:bash scripts/design-ref-check.sh [--selftest]\n' >&2; exit 2; }

printf '你現在站的地方:%s\n' "$PWD"
printf 'design-reference 狀況:\n'
check_one "$PWD/$SUB" "本樹 $SUB"; rc=$?

if [ "$rc" != "0" ]; then
  cat <<'FIX'

🔴 **你在這一棵樹 grep design-reference,答案【沒有分母】。**
   ⇒ 每一發 grep 都會回零命中, 而那與「稿裡真的沒有」印同一個東西。

✅ 修法(一行, 在這一棵樹底下跑):
     git submodule update --init design-reference

🔵 而它是 submodule ⇒ 每一棵新開的工作樹都要各自跑一次(不會自動跟著 checkout 過來)。
🛑 而在你跑它之前:**不要把剛才那個零命中寫進任何 plan / 板列 / 交件。**
FIX
fi

cat <<'SCOPE'

⚠️ 這支答的是【這一棵樹有沒有稿】,不是:
   · 「你要找的字面在不在稿裡」⇒ 那要你自己 grep
   · 「稿是不是最新的」⇒ 那是 git submodule update --remote
   · 🔴 「設計真權威」的全部 ⇒ 鐵則 1 明寫還包含 OD 專案(list_projects + 磁碟目錄數對一次)
SCOPE
exit "$rc"
