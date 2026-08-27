#!/usr/bin/env bash
# migration-new-file-static-checks.sh — lint-staged 的入口:**只對【新增的】 .sql 跑四道靜態檢查**
#
# 用法(lint-staged 會把命中的檔名接在後面):
#   bash scripts/migration-new-file-static-checks.sh <file.sql> [more.sql ...]
#   bash scripts/migration-new-file-static-checks.sh --selftest
#
# ── 為什麼要有這一支,而不是直接把 migration-static-checks.sh 掛上去 ─────────────
# 🔴 ① **Sean 2026-08-23 拍板「甲:只擋新增的、舊檔一律豁免」**,而 lint-staged **做不到那一刀**:
#      `lint-staged@17.0.4/lib/index.d.ts:1` 逐字 `(stagedFileNames: readonly string[]) => …`
#      —— 它**內部知道** A/C/D/M/R(`lib/getStagedFiles.js` 解 `--raw -z`、`lib/generateTasks.js:24`
#      把 status 帶進 task),**但只把檔名交出來**。唯一的旋鈕 `--diff-filter` 是**全域**的,
#      設成 A 會讓 lint-staged 裡每一條規則都只看新增檔 ⇒ 不可接受。
#      ⇒ 那一刀只能由**我們自己寫的這一行**切:`git diff --cached --diff-filter=A`。
# 🔴 ② lint-staged 把**所有**命中的檔一次接在命令後面(`lib/getSpawnedTask.js:102`
#      `args.concat(files)`)⇒ 入口必須自己迴圈。
# 🔴 ③ **不把過濾寫進 migration-static-checks.sh 本體**:那一支也給人**手動**驗任意檔用
#      (含已 commit 的舊檔)。在它裡面加「只看 staged 新增」會讓手動用法安靜地什麼都不檢查。
#
# ⚠️ **誠實邊界(不要讀成比它大)**:
#   · 只看**這一次 commit 新增**的檔。舊檔改一個字 ⇒ 跳過、不檢查(那就是「甲」的意思)。
#   · 舊檔**刪掉再重加**會被當成新增 ⇒ 會被檢查。
#   · 跳過幾支、跳過哪幾支**一律印出來** —— 沉默的跳過會讓人以為「全部檢查過了」。
#
# 天花板/範圍: 只對【這次 commit 新增(--diff-filter=A)】的 .sql 跑;舊檔改一個字 ⇒ 跳過(Sean 08-23「甲」);
#   舊檔刪掉重加 ⇒ 當新增、會檢查。四道檢查的本體在 migration-static-checks.sh,本支只是入口/過濾。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「改舊 migration 引入的錯 —— 按定義不在射程內,那是拍板取捨不是疏漏」。
# 天花板/量具: 它量「新增檔有沒有過那四道靜態檢查」,量不到「那四道夠不夠」(那是 migration-static-checks.sh 的射程);
#   staged 狀態由 git index 決定 ⇒ 在別的 cwd / 沒 index 的環境跑會量到不同的東西。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「A/M 以外的 git 狀態(R 改名、C 複製)被 --diff-filter=A 怎麼算」。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKS="$HERE/migration-static-checks.sh"
# 🔴 自檢會 `cd` 進拋棄式 repo,而 `$0` 是【相對路徑】⇒ cd 之後就找不到自己(實測 rc=127)。
#    那個 127 不是「閘擋了」也不是「閘放行」,是【指令根本沒跑】—— 而 `rc != 0` 讀起來像前者。
SELF="$HERE/$(basename "$0")"

is_added() { # $1=path → 0=這次 commit 新增
  git diff --cached --name-only --diff-filter=A -- "$1" 2>/dev/null | grep -q .
}

if [ "${1:-}" = "--selftest" ]; then
  # 🔴 自檢要在**拋棄式 repo** 裡跑:A 與 M 的差別只有真的 git index 才造得出來,
  #    而在本 repo 裡動 index = 動別人正在準備的那次 commit。
  # 🔴 codex R1 must-fix(2026-08-27):這裡原本回 2 —— 而下面「自檢 fixture 建置失敗」也回 2
  #    ⇒ **我在別處拆開的那個病, 自己家門口留了一個。**
  W=$(mktemp -d) || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是「乾淨」 ⇒ exit 9" >&2; exit 9; }
  trap 'rm -rf "$W"' EXIT
  # 繼承來的 git env 會讓底下的 git add 寫進【外層那次 commit 的 index】(mutation-harness-restore.md §4e)。
  unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_PREFIX 2>/dev/null || true
  fail=0; n=0
  (
    cd "$W" && git init -q . && git config user.email cf@x && git config user.name cf \
      && git config commit.gpgsign false && mkdir -p supabase/migrations
  ) || { echo "✗ 自檢 fixture 建置失敗 ⇒ exit 2" >&2; exit 2; }
  # 舊檔:先 commit 一份【乾淨】的,再把它改成【違規】(開了交易卻中途結束)。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200101000000_old.sql"
  ( cd "$W" && git add -A && git commit -q -m seed ) || { echo "✗ seed 失敗 ⇒ exit 2" >&2; exit 2; }
  printf 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n' > "$W/supabase/migrations/20200101000000_old.sql"
  # 新檔:同款違規。
  printf 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n' > "$W/supabase/migrations/20200202000000_new.sql"
  ( cd "$W" && git add supabase/migrations ) || { echo "✗ stage 失敗 ⇒ exit 2" >&2; exit 2; }

  cell() { # $1=標籤 $2=實得rc $3=該得rc
    n=$((n + 1))
    if [ "$2" = "$3" ]; then echo "  PASS $1 (rc=$2)"
    else echo "  🔴 FAIL $1 —— rc=$2 但宣稱是 $3"; fail=1; fi
  }
  # 🔴 該綠那格排前面(2026-08-23:兩格的自檢,先跑比較容易被跳過的那一格)。
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql >/dev/null 2>&1 )
  cell "舊檔(M)違規 ⇒ 跳過、放行 —— 這就是 Sean 的「甲」" "$?" "0"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "新檔(A)違規 ⇒ 擋" "$?" "1"
  # 兩支一起餵:違規的那支【排在後面】—— 被安靜忽略的正是後面那些。
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "多檔:違規新檔排在第二個 ⇒ 仍擋(不得只看 \$1)" "$?" "1"
  # 負對照:新檔改成乾淨的 ⇒ 必須放行(否則它是一道恆紅的閘)。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200202000000_new.sql"
  ( cd "$W" && git add supabase/migrations/20200202000000_new.sql && bash "$SELF" supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "新檔(A)乾淨 ⇒ 放行(該綠必綠)" "$?" "0"
  [ "$fail" = "0" ] && echo "✅ migration-new-file-static-checks --selftest $n/$n(A/M 雙向 + 多檔 + 該綠必綠)"
  exit "$fail"
fi

if [ ! -f "$CHECKS" ]; then
  printf '%s\n' "🔴 找不到 $CHECKS ⇒ 擋下(不放行)" >&2
  printf '%s\n' "   本入口沒有它就什麼都沒檢查,而「檢查過了」與「沒東西可檢查」在畫面上長得一樣。" >&2
  exit 1
fi

rc=0
checked=0
skipped_list=""
_idx=0
for f in "$@"; do
  _idx=$((_idx + 1))
  if ! is_added "$f"; then
    skipped_list="$skipped_list $f"
    continue
  fi
  checked=$((checked + 1))
  # 🔴 `|| rc=1` 會把【每一種】非 0 都塌成「這支違規」(2026-08-27 本窗實測)——
  #    而 9 =「暫存目錄建不出來 ⇒ 我根本沒檢查」。塌成 1 之後畫面說的是「有違規」,
  #    ⇒ 擋是擋住了, **而它擋人的理由是編的** ⇒ 下一個人會去改一支沒問題的 SQL。
  #    📌 同一個病的第三層:守門答對了, 而【答案在往上傳的路上被換成別的意思】。
  bash "$CHECKS" "$f"; _c=$?
  case "$_c" in
    0) ;;
    9) echo "🔴 $f:量不到(暫存目錄建不出來)⇒ 這一發【沒有檢查過】,不是「有違規」,exit 9" >&2
       # 🔴 codex R1 nit:提早跳出 ⇒ 後面的檔【真的沒跑】。本檔自己寫著 no silent caps,
       #    而「擋住了」與「檢查過了」是兩件事 ⇒ 把沒跑到的逐一列出來。
       # 🔴 codex R2 + code-reviewer nit(兩把獨立的尺撞同一格):用【檔名】判斷「我走到哪了」
       #    在重複參數時會把已檢查過的那次誤列成未檢查 ⇒ 改用【位置】, 名字重複也不影響。
       _j=0
       for _rest in "$@"; do
         _j=$((_j + 1))
         if [ "$_j" -gt "$_idx" ]; then echo "   · 未檢查:$_rest" >&2; fi
       done
       exit 9 ;;
    *) rc=1 ;;
  esac
done

# 🔴 跳過了什麼一律講出來(no silent caps):不講,下一個人會以為這一發把所有 .sql 都看過了。
if [ -n "$skipped_list" ]; then
  printf '⚠️ 略過(不是這次新增的檔,照 Sean 2026-08-23「甲」豁免):\n'
  for s in $skipped_list; do printf '   · %s\n' "$s"; done
fi
printf 'migration-new-file-static-checks:檢查了 %s 支新增的 .sql\n' "$checked"
exit "$rc"
