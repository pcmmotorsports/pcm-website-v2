#!/usr/bin/env bash
# migration-new-file-static-checks.sh — lint-staged 的入口:**只對【新增的】 .sql 跑【五道】靜態檢查**
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
#   · ⛔ ~~只看這一次 commit 新增的檔。舊檔改一個字 ⇒ 跳過、不檢查~~
#     (2026-09-06 前的舊字面, 留刪除線讓搜到的人同一發撞到訂正)
#   · **三條路, 由「落地了沒」與「這次動了沒」決定走哪一條**:
#     ① **未落地**(不在 `APPLIED.tsv` 第一欄, 也不在 `origin/dev`)且 A/M/untracked ⇒ **五道全檢**
#     ② **已落地而這次有改** ⇒ **不退步閘**:舊版(HEAD)與新版各量一次,
#        **只有【更紅】才擋**(🔴 格數變多, 或出現舊版沒有的紅【種類】)
#     ③ **已落地而這次沒動到** ⇒ 完全不掃
#   · 舊檔**刪掉再重加**會被當成新增 ⇒ 會被檢查。
#   · 跳過幾支、跳過哪幾支**一律印出來** —— 沉默的跳過會讓人以為「全部檢查過了」。
#
# 天花板/範圍: 本支只是入口/過濾, 五道檢查的本體在 migration-static-checks.sh。
#   🛑 **② 那條路【不會】擋掉舊版就有的紅** —— 那正是 Sean 08-23「甲」保護的那一類
#   (repo 裡有 39 支長這樣, 而 39/39 都已 apply);它只擋**你這次弄出來的**。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「② 那條路對【既有的紅】按定義失明 —— 那是拍板取捨不是疏漏」。
# 天花板/量具: 它量「有沒有過那五道靜態檢查 / 有沒有比舊版更紅」, 量不到「那五道夠不夠」;
#   staged 狀態由 git index 決定 ⇒ 在別的 cwd / 沒 index 的環境跑會量到不同的東西;
#   ② 那條路要 `git show HEAD:<path>` 拿得到舊版, 拿不到 ⇒ **exit 9(量不到)**, 不是放行。
#   ⚠️ **效能**:② 要跑【兩發】主檢查器 ⇒ 一支含 13 處 `CREATE OR REPLACE` 的重檔實測 **3.83 s**
#   (一般 0.09–1.49 s)。`-f8` 2026-09-06 裁【甲:就這樣收】—— 不加快取層(快取是新的一個可能恆綠的東西)。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「A/M 以外的 git 狀態(R 改名、C 複製)被 --diff-filter=AM 怎麼算」。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKS="$HERE/migration-static-checks.sh"
# 🔴 自檢會 `cd` 進拋棄式 repo,而 `$0` 是【相對路徑】⇒ cd 之後就找不到自己(實測 rc=127)。
#    那個 127 不是「閘擋了」也不是「閘放行」,是【指令根本沒跑】—— 而 `rc != 0` 讀起來像前者。
SELF="$HERE/$(basename "$0")"

# 🔴🔴 **2026-08-30 線A `-e9` 改(主視窗 `-48` 指名;成因是本支自己造出來的)**:
#    舊版只認 `--cached --diff-filter=A` ⇒ **檔沒 staged 就整支略過**,
#    印「檢查了 0 支新增的 .sql」而**它其實一支都沒看**。
#    🔴 **⇒ 它逼人把還沒要 commit 的東西放進 index**:2026-08-30 我為了讓這道閘真的跑,
#      只好先 `git add` 一支動錢的 migration ⇒ 而八窗共用一棵樹 ⇒ 同一個 index
#      ⇒ **另一個窗 `-e4` 差點在它自己那顆 commit 裡把它一起帶走**(它帶了 pathspec 才擋住)。
#    📌 **一道正確的守門,它的【輸入需求】本身可以是危險的** ——
#      而這一格在單窗環境下完全沒有代價,只有共用工作樹時才變成問題。
#    ⇒ **只改輸入,不動它的檢查邏輯**(那幾道是對的,今天還當場擋下過我一格 —— ⚠️ 刻意不寫死道數:寫死的數字會漂,而它 08-18 從三變四、08-30 從四變五)。
#
# ⚠️ 而這**不放寬 Sean 2026-08-23「甲」** —— 「甲」是「只擋**新增的**、舊檔一律豁免」,
#    而一支 untracked 的檔按任何定義都是新增的。放寬的是「新增」的**觀測方式**,不是它的定義。
# ⚠️ 對 pre-commit 鏈**零影響**:lint-staged 只會把 **staged** 的檔接在後面
#    ⇒ untracked 那一支根本不會被傳進來。這一改只讓**手動呼叫**看得見它們。
is_new() { # $1=path → 0=【要掃的】(staged 新增或修改 / 未追蹤)
  # 🔴🔴 **2026-09-06 由 `A` 放寬成 `AM`(主視窗 -f8 裁)—— 而放寬與 `already_landed` 【成對】。**
  #    病灶的另一半:`--diff-filter=A` 只看「新檔」⇒ **新內容住在【舊檔】裡時它看不到**。
  #    實錘:`20260905200000` 從 B-2 那顆起被改了 500+ 行(加欄、加 trigger、換判準),
  #    而它對 git 是「修改」⇒ 📌 **那道閘從來沒對它跑過一次**, 而它**還沒 apply**。
  #    ⇒ 🎯 「新」有兩個意思:**新的檔** 與 **新的內容**。舊版只看得到第一種。
  # 🛑 **而這【不是】把 Sean 2026-08-23「甲:只擋新增的、舊檔一律豁免」翻掉** ——
  #    他要豁免的是**歷史檔**(改一個字不該被新規則追殺), 而歷史檔的判準現在由
  #    `already_landed`(在 APPLIED.tsv 第一欄 / 已在 origin/dev)提供, **比「是不是新檔」準**。
  #    ⇒ 兩者成對:AM 讓「舊檔裡的新內容」看得見, already_landed 讓「真的歷史檔」照樣豁免。
  git diff --cached --name-only --diff-filter=AM -- "$1" 2>/dev/null | grep -q . && return 0
  # `--others --exclude-standard` = 未追蹤且不被 .gitignore 忽略的檔
  git ls-files --others --exclude-standard -- "$1" 2>/dev/null | grep -q .
}

# ══ 🔴🔴 already_landed:**已經落地的檔一律不掃**(2026-09-06 線 -ship 加)══════════
#
# 🛑 **病灶**:`--diff-filter=A` 在一顆 **merge commit** 上, 會把
#    **從 origin/dev 帶進來的每一支舊 migration 都算成「新增」** ——
#    對這棵樹而言它們確實是第一次出現, 而**對專案而言它們早就在了、甚至早就貼進正式庫了**。
#    ⇒ 📌 **「新」是相對於【誰】的?`--diff-filter=A` 答的是「相對於這一次 commit 的父」,**
#      **而 Sean 2026-08-23 拍「甲:只擋新增的」講的是【相對於專案】。兩個新不是同一個新。**
#
# 🔴 **實錘**(2026-09-06):`-5b` merge `origin/dev` 那一顆 ⇒ 掃了 23 支「新增」的 .sql、
#    紅 6 支, 而**六支全部早就在 `origin/dev` 上**;其中 `20260905210000` **已貼進正式庫**
#    ⇒ 主視窗 `-f8` 判:改它的斷言清單 = 動已 apply 的 migration 本體(⟦01-LEDGERHASH1⟧ 乙類, **禁**)
#    ⇒ 🎯 **那個紅【沒有任何合法的修法】** —— 它只能讓每一顆 merge commit 都卡住。
#
# ✅ 兩把尺, 任一命中就跳過(而**兩把都要有**:帳本答「貼了沒」, origin/dev 答「進主線了沒」):
#    ① 版本號出現在 `supabase/APPLIED.tsv` 的**第一欄**(⚠️ 不是整檔 grep ——
#       整檔 grep 會被註解裡提到的版本號餵飽)
#    ② 那支檔**已經在 `origin/dev` 上存在**(`git cat-file -e`)
# 🛑 **而這【不是】放寬**:一支**真的新**的 migration 兩把尺都不會命中 ⇒ 照掃。
#    下面的 selftest 兩個世界就是在證這件事。
already_landed() { # $1=path → 0=已落地(不該掃)
  local base ver
  base=$(basename "$1")
  ver=${base%%_*}
  case "$ver" in
    # 🔴 版本號是 **14 位**(`YYYYMMDDHHMMSS`)—— ⛔ 我第一版只寫了 12 位
    #    ⇒ 每一支真的 migration 都對不上 ⇒ `already_landed` 恆回「不是」⇒ **這一改整個沒生效**,
    #    而畫面上它是綠的(閘照舊掃、照舊擋)。抓到它的是 selftest 那一格, 不是我。
    20[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) : ;;
    *) return 1 ;;                      # 檔名不是版本號開頭 ⇒ 不敢判, 照掃
  esac
  if [ -f supabase/APPLIED.tsv ] &&      awk -F'\t' -v v="$ver" '$1==v {found=1} END{exit !found}' supabase/APPLIED.tsv 2>/dev/null; then
    return 0
  fi
  git cat-file -e "origin/dev:$1" 2>/dev/null && return 0
  return 1
}

is_modified() { # $1=path → 0=這次改到的既有檔
  git diff --cached --name-only --diff-filter=M -- "$1" 2>/dev/null | grep -q . && return 0
  git diff --name-only -- "$1" 2>/dev/null | grep -q .
}

# stdout 兩行:第一行 = 🔴 格數;第二行 = 排序去重後的紅【種類】
# 🔴 第三行 = CHECKS 自己的 rc —— 9 表示【它沒量到】。
#    不接這個 rc ⇒ 它印的那句錯誤訊息裡的 🔴 會被 grep -c 數成「1 格紅」,
#    而「量不到」就這樣被讀成了一個讀數。
redness() { # $1=要檢查的檔
  local out rc
  out=$(bash "$CHECKS" "$1" 2>&1); rc=$?
  printf '%s
' "$out" | grep -c '🔴'
  # 種類:抽 🔴 之後那句話, 正規化之後當作「同一種病」。
  # 🔴🔴 ⛔ ~~把【所有】數字正規化~~(codex 2026-09-06 R1):那會把「可授權物件 1 個 ⇒ 2 個」
  #    與「交易結束語句 2 次 ⇒ 3 次」併成同一類 ⇒ **這次新增的錯被合併進舊紅 ⇒ 惡化了也放行**。
  #    ✅ 只正規化【行號】與【路徑】—— 行號要正規化, 是因為多一行註解會讓後面每個 `:N` 位移(假紅);
  #    ⚠️ 順序:先吃路徑(路徑裡也有數字), 再吃 `:數字`。
  printf '%s\n' "$out" | grep -o '🔴.*' \
    | sed -E 's#/[^ ]+#PATH#g; s#:[0-9]+#:N#g; s#[[:space:]]+# #g' | sort -u | tr '\n' '|'
  printf '%s\n' "$rc"
}

# 回 0 = 沒有變更紅(放行)· 1 = 更紅(擋)· 9 = 量不到
no_regression() { # $1=path
  local f tdir old new on oc nn nc ok_kinds nw_kinds orc nrc oldifs
  f="$1"
  # 🔴 **副檔名要是 `.sql`** —— `mktemp` 產的是 `/tmp/tmp.XXXX`(沒有 `.sql`),
  #    而 `migration-static-checks.sh` **跳過非 .sql** ⇒ 兩邊都量到 0 格紅 ⇒ 相等 ⇒ 放行。
  #    📌 實測:世界二b 該紅而它綠 —— 那一格量的是「兩個空結果相等」, 不是「沒有變更紅」。
  tdir=$(mktemp -d) || return 9
  # 🔴 被 Ctrl-C 砍掉時 EXIT 那道 trap 不一定跑得到 ⇒ 明寫 INT/TERM。
  trap 'rm -rf "$tdir"' INT TERM
  old="$tdir/old.sql"; new="$tdir/new.sql"
  # 舊版 = HEAD 那一份;新版 = index 那一份(沒 staged 就用工作樹)
  if ! git show "HEAD:$f" > "$old" 2>/dev/null; then rm -rf "$tdir"; return 9; fi
  # 🔴🔴 ⛔ ~~`git show ":$f" || cp "$f" "$new"`~~ —— **那條 fallback 從來沒被走到過**:
  #    `git show ":$f"` 對【任何已追蹤的檔】都會成功, 回的是 **index 那份**。
  #    ⇒ 檔改了而沒 `git add` 時, 新版取到的是【沒改過的那份】⇒ 舊 vs 舊 ⇒ 恆等 ⇒ 恆放行。
  #    📌 而 `is_modified()` 明文涵蓋未 staged 的改動 ⇒ 這道閘對它【整段失明】, 而畫面印的是綠。
  #    ✅ 改成先問「這支這次有沒有 staged」, 有 ⇒ 取 index, 沒有 ⇒ 取工作樹。
  if git diff --cached --name-only -- "$f" 2>/dev/null | grep -q .; then
    git show ":$f" > "$new" 2>/dev/null || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  else
    cp "$f" "$new" 2>/dev/null || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  fi
  # 🔴 二進位/含 NUL 的檔:靜態檢查對它的行為未定義 ⇒ 那不是「乾淨」, 是量不到。
  # 🔴🔴 ⛔ ~~`LC_ALL=C grep -qU '\x00' "$f"`~~ —— **實測它是恆放行的**:BSD grep 把 `\x00` 當
  #    【字面的四個字元】, 餵一支真的含 NUL 的檔進去照樣 rc=1 ⇒ 「守門」與「沒有守門」印同一個東西。
  #    📌 兩個世界實測(2026-09-06):含 NUL ⇒ 漏掉 / 乾淨檔 ⇒ 放過 —— 只有後者是對的, 而它是白給的。
  #    ✅ `tr -d '\000'` 刪掉 NUL 之後與原檔比:不一樣 ⇒ 原檔有 NUL。同兩支 fixture 實測雙向都對。
  if ! tr -d '\000' < "$old" | cmp -s - "$old" || ! tr -d '\000' < "$new" | cmp -s - "$new"; then
    rm -rf "$tdir"; trap - INT TERM; return 9
  fi
  on=$(redness "$old"); oc=$(printf '%s' "$on" | sed -n '1p'); ok_kinds=$(printf '%s' "$on" | sed -n '2p'); orc=$(printf '%s' "$on" | sed -n '3p')
  nn=$(redness "$new"); nc=$(printf '%s' "$nn" | sed -n '1p'); nw_kinds=$(printf '%s' "$nn" | sed -n '2p'); nrc=$(printf '%s' "$nn" | sed -n '3p')
  rm -rf "$tdir"; trap - INT TERM
  case "$oc$nc" in *[!0-9]*) return 9 ;; esac
  # 🔴 任一邊 rc=9 ⇒ 這一對讀數裡有一個是【沒量到】⇒ 不准拿去比。
  if [ "$orc" = "9" ] || [ "$nrc" = "9" ]; then return 9; fi
  local newkind=0 k
  oldifs=$IFS; IFS='|'; for k in $nw_kinds; do
    [ -n "$k" ] || continue
    case "|$ok_kinds|" in *"|$k|"*) : ;; *) newkind=1 ;; esac
  done; IFS=$oldifs
  if [ "$nc" -gt "$oc" ] || [ "$newkind" = "1" ]; then
    printf '🔴 %s:這次改動讓它【更紅】⇒ 擋(舊版 %s 格 ⇒ 新版 %s 格%s)\n' \
      "$f" "$oc" "$nc" "$([ "$newkind" = 1 ] && printf ';且出現舊版沒有的紅種類')" >&2
    printf '   🔵 舊檔【既有】的紅仍然豁免(Sean 2026-08-23「甲」)—— 本閘只擋你這次弄壞的。\n' >&2
    return 1
  fi
  printf '   🔵 %s:既有檔, 這次改動【沒有變更紅】(舊 %s ⇒ 新 %s)⇒ 放行\n' "$f" "$oc" "$nc"
  return 0
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
  # 🔴🔴 **2026-09-06 這一格的期望值反過來了 —— 而那是【契約改了】不是尺壞了。**
  #    ⛔ ~~「舊檔(M)違規 ⇒ 跳過、放行 —— 這就是 Sean 的『甲』」rc=0~~
  #    🛑 舊契約用「是不是新檔」代表「是不是歷史檔」, 而那個代理是錯的:
  #      `20260905200000` 被改了 500+ 行、**還沒 apply**, 而它對 git 是「修改」⇒ 從來沒被掃過。
  #    ✅ 新契約:**掃 A 與 M, 由 `already_landed` 決定誰是歷史檔**(見 is_new 那一段)。
  #    ⇒ 這一格的 fixture 那支舊檔**不在帳本也不在 origin/dev** ⇒ 它不是歷史檔 ⇒ **該掃、該擋**。
  #    🔵 而 Sean 的「甲」由下面那一格接住:**同一支檔 + 一行帳本 ⇒ 放行。**
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql >/dev/null 2>&1 )
  cell "舊檔(M)違規而【未落地】⇒ 照掃、擋(契約 2026-09-06 改)" "$?" "1"
  # 🔴🔴 **2026-09-06 `-f8` 裁【甲】後這一格的斷言【翻面】** ——
  #    ⛔ ~~`cell "🟢 同一支舊檔 + 一行帳本 ⇒ 放行(Sean 08-23「甲」的新落點)" "$?" "0"`~~
  #    🛑 **為什麼翻**:這格的 fixture 是【**乾淨**的舊檔被這次改壞】(HEAD 那份 0 格紅 ⇒ 現在 1 格)。
  #      而 Sean 08-23「甲」說的是「**既有**的紅豁免」, **不是「這次弄紅的也豁免」** ——
  #      舊斷言把兩者混成一件事 ⇒ 已 apply 的 migration 被手滑改壞時**零守門**。
  #    ✅ 甲仍然成立, 而它的證人搬到下面那一格:**本來就紅的舊檔 + 只改註解 ⇒ 放行**。
  ( cd "$W" && printf 'version\tsha\n20200101000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql >/dev/null 2>&1 )
  cell "🔴 已落地的舊檔【被這次改壞】(乾淨 ⇒ 違規)⇒ 擋(契約 2026-09-06 翻面)" "$?" "1"
  ( cd "$W" && rm -f supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "新檔(A)違規 ⇒ 擋" "$?" "1"
  # 兩支一起餵:違規的那支【排在後面】—— 被安靜忽略的正是後面那些。
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "多檔:違規新檔排在第二個 ⇒ 仍擋(不得只看 \$1)" "$?" "1"
  # 負對照:新檔改成乾淨的 ⇒ 必須放行(否則它是一道恆紅的閘)。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200202000000_new.sql"
  ( cd "$W" && git add supabase/migrations/20200202000000_new.sql && bash "$SELF" supabase/migrations/20200202000000_new.sql >/dev/null 2>&1 )
  cell "新檔(A)乾淨 ⇒ 放行(該綠必綠)" "$?" "0"

  # ══ 🔴🔴 未 staged 的新增檔(2026-08-30 線A `-e9` 加)══════════════════════
  #    這兩格是本次改動的證人。**舊版在這兩格上都會放行**(它只看 `--cached --diff-filter=A`)
  #    ⇒ 而放行的理由不是「這支檔沒問題」,是「**我沒看到它**」。
  #    📌 而那個放行**逼人去 `git add`** —— 那正是這一改要拆掉的因果。
  printf 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n' > "$W/supabase/migrations/20200303000000_untracked_bad.sql"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200303000000_untracked_bad.sql >/dev/null 2>&1 )
  cell "🔴 未 staged 的新檔【違規】⇒ 必須擋(舊版會放行)" "$?" "1"
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200404000000_untracked_ok.sql"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200404000000_untracked_ok.sql >/dev/null 2>&1 )
  cell "未 staged 的新檔【乾淨】⇒ 放行(不誤報)" "$?" "0"
  # 🔴 **突變:證明擋它的是【新的 untracked 那條】,不是別的** ——
  #    把那支違規的檔加進 .gitignore ⇒ `--others --exclude-standard` 就看不到它
  #    ⇒ 它退回「不是新增的」⇒ 照「甲」豁免 ⇒ 必須放行。
  #    沒有這一發,「它會擋」與「它對任何 .sql 都擋」印同一個字。
  ( cd "$W" && printf 'supabase/migrations/20200303000000_untracked_bad.sql\n' > .gitignore )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200303000000_untracked_bad.sql >/dev/null 2>&1 )
  cell "突變:同一支檔被 gitignore ⇒ 看不見 ⇒ 放行(證明擋它的是 untracked 那條)" "$?" "0"
  ( cd "$W" && rm -f .gitignore )

  # ══ 🔴🔴 已落地的檔不掃(2026-09-06 線 -ship 加;主視窗 `-f8` 判「丙」)══════════
  #    兩個世界, 而它們**只差一行帳本** —— 少了第二格, 「它會跳過」與「它對誰都跳過」印同一個字。
  #    🛑 而第一格用的是**同一支違規檔**:證明跳過它的是【落地】那條, 不是它突然變乾淨了。
  printf 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n' > "$W/supabase/migrations/20200505000000_landed_bad.sql"
  ( cd "$W" && git add supabase/migrations/20200505000000_landed_bad.sql )
  # 世界一:**不在**帳本、**不在** origin/dev ⇒ 照掃 ⇒ 擋
  ( cd "$W" && bash "$SELF" supabase/migrations/20200505000000_landed_bad.sql >/dev/null 2>&1 )
  cell "🔴 未落地的違規新檔 ⇒ 仍擋(這一改【不是】放寬)" "$?" "1"
  # 世界二:同一支檔, 只多一行帳本 ⇒ 跳過 ⇒ 放行
  ( cd "$W" && printf 'version\tsha\n20200505000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200505000000_landed_bad.sql >/dev/null 2>&1 )
  cell "已在 APPLIED.tsv 第一欄 ⇒ 不掃、放行(改它是被禁的, 那個紅沒有合法修法)" "$?" "0"
  # 🔴 突變:版本號只出現在【第二欄】⇒ 必須【仍然擋】——
  #    這一格在證那把尺讀的是第一欄, 不是整檔 grep(整檔 grep 會被註解裡的版本號餵飽)。
  ( cd "$W" && printf 'version\tsha\nzzz\t20200505000000\n' > supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200505000000_landed_bad.sql >/dev/null 2>&1 )
  cell "突變:版本號只在第二欄 ⇒ 不算落地 ⇒ 仍擋(證明它讀的是第一欄)" "$?" "1"
  ( cd "$W" && rm -f supabase/APPLIED.tsv )

  # ══ 🔴 「0」的兩態必須分得開 ═════════════════════════════════════════════
  #    · 有輸入而全都不是新增 ⇒ rc=0(照「甲」豁免)
  #    · 一個輸入都沒有       ⇒ rc=2(工具沒生效)—— 而舊版這一格也是 0
  ( cd "$W" && bash "$SELF" >/dev/null 2>&1 )
  cell "🔴 零參數 ⇒ rc=2(我沒去查), 不是 rc=0(查無)" "$?" "2"
  # 🔴 這一整組的 fixture 都要【先落地】(寫進 APPLIED.tsv 第一欄), 否則它們走的是
  #    「未落地 ⇒ 五道全檢」那條路, 演的就不是不退步閘那個世界。
  ( cd "$W" && printf 'version\tsha\n20200505000000\tdeadbeef\n20200606000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  # ══ 🔴 不退步閘的兩個世界(`-f8` 2026-09-06 指定)══════════════════════
  #    世界一在上面(乾淨 ⇒ 違規 ⇒ 擋)。世界二在這裡:**本來就違規的舊檔, 這次只改註解**。
  #    📌 那正是 Sean「甲」要保護的那一類 —— repo 裡有 39 支長這樣, 而它們全部已 apply。
  # 🔵 base:一支【本來就紅】的舊檔(有可授權物件而沒有斷言清單)⇒ 2 格紅
  printf 'BEGIN;\nCREATE FUNCTION public.zz_f() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\nCOMMIT;\n' \
    > "$W/supabase/migrations/20200505000000_dirty.sql"
  ( cd "$W" && git add supabase/migrations/20200505000000_dirty.sql && git commit -q -m dirty-seed )
  # 世界二:只加一行註解 ⇒ 紅的格數與種類都不變 ⇒ 放行
  printf 'BEGIN;\nCREATE FUNCTION public.zz_f() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\nCOMMIT;\n-- 只加一行註解\n' \
    > "$W/supabase/migrations/20200505000000_dirty.sql"
  ( cd "$W" && git add supabase/migrations/20200505000000_dirty.sql && bash "$SELF" supabase/migrations/20200505000000_dirty.sql >/dev/null 2>&1 )
  cell "🟢 世界二:本來就紅的舊檔【只改註解】⇒ 放行(「甲」仍然成立)" "$?" "0"
  # 🔴 判別力(codex R1 E):只斷言 rc=0 的話, 把 no_regression 換成永遠放行這格照樣過。
  #    ⇒ 斷言它**真的走過那條路**(印出「沒有變更紅」)。
  # 🔴 ⛔ ~~`… | grep -q …`~~ —— `grep -q` 命中就關管線 ⇒ 上游收到 SIGPIPE ⇒ **rc=141**,
  #    而 141 既不是「有」也不是「沒有」。⇒ 先把輸出收進變數, 再比。
  _o2=$( cd "$W" && bash "$SELF" supabase/migrations/20200505000000_dirty.sql 2>&1 )
  case "$_o2" in *沒有變更紅*) _r2=0 ;; *) _r2=1 ;; esac
  cell "🟢 世界二 而且是【走過不退步閘】才放行的(不是被略過)" "$_r2" "0"
  # 世界二b:同一支加一個 CREATE OR REPLACE VIEW ⇒ 2 格 ⇒ 3 格【且】多一種紅 ⇒ 擋
  #   🔵 沒有這一格,「世界二會綠」與「這道閘對舊檔恆綠」印同一個東西。
  printf 'BEGIN;\nCREATE FUNCTION public.zz_f() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\nCREATE OR REPLACE VIEW public.zz_v AS SELECT 1 AS a;\nCOMMIT;\n' \
    > "$W/supabase/migrations/20200505000000_dirty.sql"
  ( cd "$W" && git add supabase/migrations/20200505000000_dirty.sql && bash "$SELF" supabase/migrations/20200505000000_dirty.sql >/dev/null 2>&1 )
  cell "🔴 世界二b:同一支這次弄出【新的一種紅】⇒ 擋(證明世界二的綠不是恆綠)" "$?" "1"
  # 世界二c:**同一種紅而數量變多**(可授權物件 1 個 ⇒ 2 個)⇒ 也要擋。
  #   🔴 這一格釘的是「只正規化行號與路徑」那個修法 —— 舊版把所有數字正規化, 它會放行。
  printf 'BEGIN;\nCREATE FUNCTION public.zz_f() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\nCREATE FUNCTION public.zz_g() RETURNS int LANGUAGE sql AS $g$ SELECT 2 $g$;\nCOMMIT;\n' \
    > "$W/supabase/migrations/20200505000000_dirty.sql"
  ( cd "$W" && git add supabase/migrations/20200505000000_dirty.sql && bash "$SELF" supabase/migrations/20200505000000_dirty.sql >/dev/null 2>&1 )
  cell "🔴 世界二c:同一種紅【數量】變多(1 個 ⇒ 2 個)⇒ 擋" "$?" "1"

  # ══ 🔴 【未 staged】的改動也要進不退步閘 ══════════════════════════════════
  #    舊寫法在這一格恆綠(它拿的是 index 那份 = 沒改過的)。這格是那個修法的證人。
  printf 'ALTER FUNCTION f() OWNER TO postgres;\n' >> "$W/supabase/migrations/20200505000000_dirty.sql"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200505000000_dirty.sql ) >/dev/null 2>&1
  cell "🔴 改了但【沒 git add】⇒ 一樣要擋(不是恆放行)" "$?" "1"
  ( cd "$W" && git checkout -- supabase/migrations/20200505000000_dirty.sql ) >/dev/null 2>&1

  # ══ 🔴 二進位/含 NUL 的既有檔 ⇒ 【量不到】(exit 9), 不得讀成「沒有變更紅」══════════
  #    這一格是上面那個恆放行守門的證人:換回 grep -qU 版 ⇒ 它會綠(被當成 0 格紅 = 沒變紅 = 放行)。
  printf 'select 1;\n' > "$W/supabase/migrations/20200606000000_bin.sql"
  ( cd "$W" && git add supabase/migrations/20200606000000_bin.sql && git commit -qm bin ) >/dev/null 2>&1
  printf 'select 1;\000\n' > "$W/supabase/migrations/20200606000000_bin.sql"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200606000000_bin.sql ) > "$W/_bin.out" 2>&1
  _br=$?
  cell "🔴 既有檔變成含 NUL ⇒ exit 9(量不到)而不是放行" "$_br" "9"

  ( cd "$W" && rm -f supabase/APPLIED.tsv )

  # 🔵 對照要換一支【真的會被跳過】的檔 —— 契約改了之後,「舊檔」本身不再等於「跳過」。
  # 🔴 契約翻面後, 「落地」本身不再等於「跳過」—— 還要**這次真的沒改到**。
  #    ⇒ 先把它還原成 HEAD 那份(index 與工作樹都要), 它才是真的沒改動。
  ( cd "$W" && git reset -q HEAD supabase/migrations/20200101000000_old.sql 2>/dev/null; git checkout -q -- supabase/migrations/20200101000000_old.sql 2>/dev/null )
  ( cd "$W" && printf 'version\tsha\n20200101000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql >/dev/null 2>&1 )
  cell "【對照】已落地且這次【沒改到】⇒ rc=0(這一格才是「查無」)" "$?" "0"
  ( cd "$W" && rm -f supabase/APPLIED.tsv )

  [ "$fail" = "0" ] && echo "✅ migration-new-file-static-checks --selftest $n/$n(A/M 都掃 + 未落地舊檔照擋 + 已落地改壞照擋而【既有的紅】仍豁免 + 不退步閘世界二/二b/二c + 未 staged + NUL 量不到 + 多檔 + 該綠必綠 + untracked 雙向含突變 + 零參數兩態 + 已落地沒改到才跳過)"
  exit "$fail"
fi

if [ ! -f "$CHECKS" ]; then
  printf '%s\n' "🔴 找不到 $CHECKS ⇒ 擋下(不放行)" >&2
  printf '%s\n' "   本入口沒有它就什麼都沒檢查,而「檢查過了」與「沒東西可檢查」在畫面上長得一樣。" >&2
  exit 1
fi

rc=0
checked=0
checked_new=0
checked_mod=0
skipped_list=""
landed_list=""
_idx=0
for f in "$@"; do
  _idx=$((_idx + 1))
  # 🔴 `is_new` 只看 **staged**(`--cached --diff-filter=AM`)與 untracked ——
  #    一支【已追蹤而改了沒 git add】的檔它看不見, 而 `is_modified` 明文涵蓋那一種。
  #    ⇒ 少了 `|| is_modified`, 不退步閘對「改了沒 add」整段失明, 而畫面印的是「略過」。
  #    🔵 對 pre-commit 鏈零影響:lint-staged 只會把 staged 的檔接上來。
  if ! is_new "$f" && ! is_modified "$f"; then
    skipped_list="$skipped_list $f"
    continue
  fi
  # 🔴 已落地的檔一律不掃, 而**印一行說出來** —— 靜默跳過與「掃過而沒事」在畫面上一樣。
  # 🔴🔴 **2026-09-06 `-f8` 裁【甲】:已落地的檔不再是「一道都不跑」, 而是【跑不退步閘】。**
  #    ⛔ ~~已落地 ⇒ continue(零檢查)~~ —— 那讓「已 apply 的 migration 被這次改壞」**零守門**,
  #    而擋它的只剩「不得改已 apply 的本體」這條**規矩**。🛑 **規矩擋不住手滑。**
  #    ✅ 而這【仍然】是 Sean 2026-08-23「甲」:甲說的是「**既有**的紅豁免」,
  #      不是「這次弄紅的也豁免」⇒ 舊版已有的紅一格都不擋, 只擋你這次弄出來的。
  #    🔵 沒有改動的已落地檔(只是被餵進來)⇒ 照舊完全不掃。
  if already_landed "$f"; then
    if is_modified "$f"; then
      no_regression "$f"; _n=$?
      case "$_n" in
        0) checked=$((checked + 1)); checked_mod=$((checked_mod + 1)) ;;
        9) echo "🔴 $f:不退步閘量不到(取不到舊版或暫存檔建不出來)⇒ 這一發沒有檢查過, exit 9" >&2; exit 9 ;;
        *) rc=1; checked=$((checked + 1)); checked_mod=$((checked_mod + 1)) ;;
      esac
      continue
    fi
    landed_list="$landed_list $f"
    printf '⏭️  已 apply / 已在 origin/dev 且這次沒改動, 不掃:%s\n' "$f"
    continue
  fi
  checked=$((checked + 1)); checked_new=$((checked_new + 1))
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
  printf '⚠️ 略過(這次 commit 沒有動到的檔 —— 2026-09-06 起掃 A 與 M, 所以這裡只剩【沒動到】那一種):\n'
  for s in $skipped_list; do printf '   · %s\n' "$s"; done
fi
# 🔴 同一條紀律套在新的那一刀上:跳過幾支、是哪幾支, 都要說出來。
if [ -n "$landed_list" ]; then
  printf '⏭️  已落地而不掃(在 APPLIED.tsv 第一欄, 或已在 origin/dev 上):\n'
  for s in $landed_list; do printf '   · %s\n' "$s"; done
  printf '   🛑 這【不是】「它們沒問題」—— 是【現在改它們是被禁的】(已 apply 的 migration 本體不得動)。\n'
fi
# 🔴🔴 **「0」要分成兩態**(主視窗 `-48` 指名的第二格;而它就是今晚一直在講的那條):
#    **【查無】與【我沒去查】不得壓成同一格。**
#    · 有輸入而全都不是新增的 ⇒ **正常**(照「甲」豁免;上面已逐支列出來了)
#    · **一個輸入都沒收到** ⇒ **工具沒生效** —— 那不是「乾淨」,是這一發**什麼都沒量**。
#      而舊版兩者都印「檢查了 0 支」⇒ 讀的人會把後者讀成前者。
if [ "$_idx" -eq 0 ]; then
  printf '🛑 migration-new-file-static-checks:**一個輸入都沒收到** ⇒ 這一發沒有量到任何東西。\n' >&2
  printf '   這【不是】「沒有新增的 .sql」—— 那一種會印「檢查了 0 支」並列出略過的檔。\n' >&2
  printf '   最可能的成因:呼叫端沒有把檔名接上來(lint-staged 沒命中 / 手動忘了給參數)。\n' >&2
  printf '   用法:bash %s <file.sql> [more.sql ...]\n' "$0" >&2
  exit 2
fi
# 🔴 兩條路徑分開數 —— 它們是【兩道不同的閘】(五道全檢 vs 不退步), 混成一個數
#    會讓「檢查了 3 支」被讀成「3 支都跑了五道全檢」。
printf 'migration-new-file-static-checks:收到 %s 支、檢查了 %s 支(未落地 %s 支跑五道全檢 / 已落地且這次有改 %s 支跑不退步閘;其餘另計)\n' \
  "$_idx" "$checked" "$checked_new" "$checked_mod"
exit "$rc"
