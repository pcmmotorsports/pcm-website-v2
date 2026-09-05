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

# ══ 🔴🔴 2026-09-04:剝繼承來的 git 環境, 而位置從 `selftest()` 裡【移到這裡】═══════
#
# **成因是量到的**(主視窗 `-94` 2026-09-04, 三個世界):
# ```
# sh scripts/design-ref-check.sh                                       ⇒ rc=0, 分母 176
# GIT_INDEX_FILE=/tmp/nonexistent-index sh scripts/design-ref-check.sh ⇒ rc=3「沒有分母」
# GIT_DIR=$PWD/.git                     sh scripts/design-ref-check.sh ⇒ rc=0(這顆不影響)
# ```
# ⇒ 掛在 pre-commit 底下時, `lint-staged` 給的 `GIT_INDEX_FILE` 被 `check_one` 的
#   `git -C "$root" ls-files` 繼承 ⇒ 讀到【主 repo 的暫存 index】⇒ submodule 印 0
#   ⇒ 判成「這一棵樹沒有 design-reference」⇒ **擋下一次合法的 commit。**
#
# 🛑 **而這一格最該記的不是機制, 是【防護裝錯地方】**:
#    本檔的 `selftest()` **2026-09-02 就已經剝了**, 註解逐字寫著
#    「`git -C <路徑>` 擋不住它:GIT_DIR / GIT_INDEX_FILE 的優先權比 -C 高」——
#    🔴 **而真正在量的那兩個函式(`check_one` / `submodule_prefix`)不在那個 unset 的射程裡。**
#    ⇒ 📌 **我把防護裝進了【驗自己的那一半】, 而沒裝進【真的被跑的那一半】** ——
#      而兩半在「selftest 全過」這個訊號上長得一模一樣。
#
# ✅ 所以位置在檔頭、全域一次 —— 同一則舊註解自己寫過理由:**「漏掉一發就等於沒做」**。
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE 2>/dev/null || true

SUB="design-reference"
# 🔴 **正對照用的檔**:它在稿裡, 而它不是我隨手挑的 —— 它是 submodule 的根檔案。
#    ⇒ 有它 ⇒ 這一棵真的 checkout 過;沒有它而目錄非空 ⇒ **那是別的東西, 不是稿。**
SENTINEL="README.md"

die() { printf '🔴 design-ref-check 自己壞了:%s\n' "$1" >&2; exit 1; }

check_one() {
  local root="$1" label="$2"
  [ -d "$root" ] || { printf '  %-40s 🔴 連目錄都沒有\n' "$label"; return 3; }
  # 🔴 **尺 B(有判別力的那一把)**:`ls | wc -l` 在【空】與【只是沒加 -A】之間只差 3
  #    ⇒ 那個差太小, 不夠當判準(`-c7` 量 10 / `-15` 量 13 / 而真分母是 176 —— 三個都是真的)。
  #    ✅ `git ls-files` 在兩個世界差 **1 vs 176** ⇒ 那才分得開。
  #    🛑 **而它【不是】靠 rc**:未初始化時它 **rc=0 而回一行 `./`** —— 我實測過。
  #       ⇒ 📌 「它會報錯」是一個很自然的假設, 而它是假的。
  local n; n="$(git -C "$root" ls-files 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -le 1 ] 2>/dev/null; then
    printf '  %-40s 🔴 **沒有分母**(git ls-files ⇒ %s)\n' "$label" "$n"; return 3
  fi
  if [ ! -f "$root/$SENTINEL" ]; then
    printf '  %-40s ⚠️ ls-files %s 而【沒有 %s】⇒ 那可能不是稿\n' "$label" "$n" "$SENTINEL"; return 3
  fi
  printf '  %-40s ✅ 分母 %s 個檔(正對照 %s 在)\n' "$label" "$n" "$SENTINEL"; return 0
}

# 🔵 **尺 A(語意直接的那一把)** —— 它答的不是「有幾個檔」, 是「這個 submodule 初始化了沒」。
#    `git submodule status` 首字元:`-` = 未初始化 · 空白 = 已初始化。**沒有門檻。**
#    🛑 而它【不進 selftest】—— 造一個真的 submodule 太重。
#       ⇒ 它由**真實世界那一發**背書:2026-09-02 `-15` 實測
#         `pcm-wt-ship` ⇒ `-` · `pcm-wt-auth`(已 init)⇒ 空白。**兩個世界印不同的字元。**
submodule_prefix() {
  git -C "$1" submodule status "$SUB" 2>/dev/null | cut -c1
}

selftest() {
  local rc bad=0
  # 🔴 2026-09-02:本函式【第一件事】必須剝掉繼承來的 git 環境。
  #    成因是量到的, 不是猜的 —— `scripts/selftest-git-isolation-gate.sh` 擋下一次 push,
  #    而主視窗用它的環境重現:GIT_DIR + **GIT_INDEX_FILE**、cwd 留在真 repo
  #    ⇒ 受害者 repo 的 `ls-files|status` 從 **1|0 變 4|6** —— 下面每一發
  #      `git -C "$tmp/..." init/add` 都寫進了【別人的】index。
  #    🛑 而 `git -C <路徑>` **擋不住它**:GIT_DIR / GIT_INDEX_FILE 的優先權比 -C 高。
  #    ⚠️ 而它只在【被掛在 hook 底下】那個世界壞 —— 在自己樹上手跑 selftest 是綠的,
  #      而那正是它會被跑的世界。⇒ 「我本機 selftest 全過」與「它在真的被跑的環境裡乾淨」
  #      是兩個宣稱。
  #    🔵 為什麼用 unset 而不是每一發包 `env -u`:漏掉一發就等於沒做, 而這裡有 6 發。
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
  # 🔴 `SELFTEST_TMP` 是【全域】不是 local —— trap 在函式結束【之後】才跑,
  #    而 `set -u` 之下一個 local 變數在那時已經不存在 ⇒ 「unbound variable」。
  #    ⇒ 📌 而那個錯印在 selftest【全過】的下一行 ⇒ **一支自檢工具自己壞在收尾。**
  SELFTEST_TMP="$(mktemp -d)" || die "mktemp 失敗"
  trap 'rm -rf "${SELFTEST_TMP:-}"' EXIT
  local tmp="$SELFTEST_TMP"
  printf '── selftest ──\n'

  # 🟢 正對照:造一個【真的 git repo】而且有稿的根檔
  # 🔴 fixture 從「一個目錄」改成「一個 git repo」是因為**尺換了**(數檔案 ⇒ git ls-files)。
  #    ⇒ 📌 而那一刻 selftest 當場紅 —— **它抓到我換了尺而 fixture 沒跟上。**
  #       那正是 harness 該做的事:不是證明碼對, 是**在前提變了的時候出聲**。
  mkdir -p "$tmp/ok" && printf 'x\n' > "$tmp/ok/$SENTINEL"
  git -C "$tmp/ok" init -q 2>/dev/null && git -C "$tmp/ok" add -A 2>/dev/null
  # 🔵 多塞幾個檔:讓它與「只有 1 個檔」那條線分得開(`ls-files <= 1` ⇒ 沒有分母)
  for i in 1 2 3; do printf 'x\n' > "$tmp/ok/f$i.txt"; done
  git -C "$tmp/ok" add -A 2>/dev/null
  check_one "$tmp/ok" "正對照 有稿" >/dev/null; rc=$?
  [ "$rc" = "0" ] && printf '  ✅ 有稿 ⇒ rc=0\n' || { printf '  🔴 有稿卻 rc=%s\n' "$rc"; bad=1; }

  # 🔴 負對照①:空目錄
  mkdir -p "$tmp/empty"
  check_one "$tmp/empty" "負對照 空的" >/dev/null; rc=$?
  [ "$rc" = "3" ] && printf '  ✅ 空的 ⇒ rc=3\n' || { printf '  🔴 空的卻 rc=%s\n' "$rc"; bad=1; }

  # 🔴 負對照②:**有東西而不是稿** —— 這一格擋的是「只看有沒有分母」那種寫法
  #    ⇒ 它是一個【真的 repo、真的有很多檔】, 而它缺那個根檔 ⇒ **那不是稿。**
  mkdir -p "$tmp/wrong"
  git -C "$tmp/wrong" init -q 2>/dev/null
  for i in 1 2 3 4; do printf 'x\n' > "$tmp/wrong/other$i.txt"; done
  git -C "$tmp/wrong" add -A 2>/dev/null
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

# 🔴 **兩把尺要對得上** —— 對不上時我【不猜】, 我報 rc=1(工具/世界說不清楚)。
#    📌 因為那時「有分母而沒初始化」與「初始化了而空的」都可能, 而它們的修法不同。
PREFIX="$(submodule_prefix "$PWD")"
case "$PREFIX" in
  '-') printf '  尺A submodule status ⇒ **未初始化**(前綴 `-`)\n'
       [ "$rc" = "0" ] && { printf '  🔴 兩把尺不一致:尺B 說有分母而尺A 說沒 init ⇒ 我不猜\n'; rc=1; } ;;
  '')  printf '  尺A submodule status ⇒ 讀不出來(不是 submodule?或不在 repo 裡)\n' ;;
  *)   printf '  尺A submodule status ⇒ 已初始化(前綴 空白)\n'
       [ "$rc" = "3" ] && { printf '  🔴 兩把尺不一致:尺A 說已 init 而尺B 說沒分母 ⇒ 我不猜\n'; rc=1; } ;;
esac

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
