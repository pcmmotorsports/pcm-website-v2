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
# 🔴 檔頭標記的 parser 收攏在一支(⟦0e-DDLINTOVC-MARK⟧;Fable R3 F4 實錘:四份手寫 parser
#    有兩種文法, 同一個檔頭兩把尺說是、兩把尺說不是, 而畫面上沒有東西說兩邊不同)。
#    🛑 讀不到它 ⇒ **擋下**, 不要靜默退回本地判斷。
_MARKLIB="$(cd "$(dirname "$0")" && pwd)/lib-migration-header-marks.sh"
if [ -f "$_MARKLIB" ]; then . "$_MARKLIB"; else
  printf '🔴 找不到 %s ⇒ 檔頭標記無法判讀, 擋下(不放行)\n' "$_MARKLIB" >&2; exit 2
fi

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
redness() { # $1=要檢查的檔  $2=兄弟分母目錄(可空 ⇒ 照舊用受測檔自己的目錄)
  local out rc
  # 🔴 `PCM_SIBLING_DIR` 只在【這一次呼叫】生效 —— 用前綴賦值, 不 export、不留在環境裡。
  #    (留在環境裡的話, 之後每一發 CHECKS 都會被這一次的分母污染, 而那不會有訊號。)
  out=$(PCM_SIBLING_DIR="${2:-}" bash "$CHECKS" "$1" 2>&1); rc=$?
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

# ── 🟠 補版控型 `-- pcm:ddl-into-vc:`(⟦0e-DDLINTOVC-MARK⟧;-f8 2026-09-06 裁甲)──────
#
# 🛑 **本支有兩句話對補版控型是【假的】**:
#    ① `⏭️ 已 apply / 已在 origin/dev 且這次沒改動` —— 把兩件事混在一句裡, 而補版控型
#       是「在 origin/dev 上」而**從來沒有 apply 過**。
#    ② `現在改它們是被禁的(已 apply 的 migration 本體不得動)` —— 對補版控型**這句是錯的**,
#       它沒被 apply 過 ⇒ 改它不受那條限制。📌 而這句正好會擋住「給那三支補檔頭標記」這件事本身。
# ⚠️ 只讀檔頭前 20 行(照 `migration-ledger-divergence.sh:247` 的先例)。
# 🔵 它**不改變任何 rc** —— 補版控型照樣走不退步閘, 這裡改的只有那兩句話。
is_ddl_into_vc() { # $1=path → 0=是補版控型
  # 🔴🔴 **codex R1 MF5**:讀法要與 `no_regression` 選【同一版】—— 閘量的是 index 那版
  #    (有 staged 時), 訊息若講工作樹那版, 兩者可以相反而畫面看不出來。
  #    ✅ 那個選擇邏輯與抽值文法都在 `lib-migration-header-marks.sh`(唯一 parser)。
  local _v
  _v=$(mark_value_or_warn "$(head20_of_index_or_worktree "$(to_repo_relative "$1")")" ddl-into-vc "$1")
  [ -n "$_v" ]
}

# 回 0 = 沒有變更紅(放行)· 1 = 更紅(擋)· 9 = 量不到
# 🔴🔴 **lint-staged 餵的是【絕對路徑】, 而 `git show HEAD:<絕對路徑>` 回 128。**
#    ⇒ 不退步閘取不到舊版 ⇒ 每一支已落地又被改到的 migration 在 pre-commit 裡一律 exit 9,
#      而**我直接跑同一支是 rc=0** ⇒ 📌 「我在自己樹上跑是綠的」與「它在鏈上會動」是兩件事。
#    🔵 它不是靜默的(exit 9 = 我沒檢查過)—— 但它會擋住每一次這種 commit。
#    ✅ 一律先正規化成 repo 相對路徑。`git ls-files --full-name` 對絕對與相對都給同一個答案。
to_repo_relative() { # $1=path → 印 repo 相對路徑(拿不到就原樣印回去)
  _rr=$(git ls-files --full-name --error-unmatch -- "$1" 2>/dev/null | head -1)
  if [ -n "$_rr" ]; then printf '%s' "$_rr"; else printf '%s' "$1"; fi
}

no_regression() { # $1=path
  local f tdir old new on oc nn nc ok_kinds nw_kinds orc nrc oldifs
  f=$(to_repo_relative "$1")
  # 🔴 **副檔名要是 `.sql`** —— `mktemp` 產的是 `/tmp/tmp.XXXX`(沒有 `.sql`),
  #    而 `migration-static-checks.sh` **跳過非 .sql** ⇒ 兩邊都量到 0 格紅 ⇒ 相等 ⇒ 放行。
  #    📌 實測:世界二b 該紅而它綠 —— 那一格量的是「兩個空結果相等」, 不是「沒有變更紅」。
  tdir=$(mktemp -d) || return 9
  # 🔴 被 Ctrl-C 砍掉時 EXIT 那道 trap 不一定跑得到 ⇒ 明寫 INT/TERM。
  trap 'rm -rf "$tdir"' INT TERM
  # 🔴🔴 **暫存檔名不能是 `old.sql` / `new.sql`** —— `migration-static-checks.sh` 的規則①
  #    **用 basename 當版本號**去比「更早的 migration」(`[ "$mb" \< "$THIS_BASE" ]`),
  #    規則④/⑥ 也吃檔名 ⇒ **檔名一換, 同一份內容量出來的紅數就不一樣**。
  #    🔬 實測(2026-09-07, account 抓到 · B 在 58aa9f2a2 複現 · 本窗照抄複現):
  #      同一份 `20260901030000` 的內容, `old.sql` ⇒ **2 紅**、`new.sql` ⇒ **6 紅**,
  #      而用【原檔名】跑 ⇒ **2 紅**。⇒ 📌 **那 4 格是檔名造成的假紅, 不是內容差異。**
  #      ⇒ 任何動既有 migration 的 commit 都可能被這道「不退步閘」誤擋。
  #    ✅ 修法:兩份各放**自己的子目錄**, 而檔名用**原 basename** ⇒ 兩邊的規則①分母一致,
  #      而它們仍在不同目錄 ⇒ 不會互相覆蓋。
  #    ✅ **修法(2026-09-07 主視窗裁乙):把兄弟分母變成【明寫的參數】, 不再靠檔名或建鏡像。**
  #      `migration-static-checks.sh` 現在收 `PCM_SIBLING_DIR`;沒給就照舊用受測檔目錄(零行為改變),
  #      給了而目錄不存在 ⇒ 它 `exit 9` **不靜默照舊**。
  #    ⛔ ~~第一版:兩份各建一棵鏡像目錄 + symlink 全部兄弟~~ —— **codex R1 打掉, 三個理由**:
  #      ① symlink 失敗被吞掉 ⇒ 兩邊同時少檔 ⇒ **對稱 ⇒ 照樣放行** = 正在修的那個假綠又長回來
  #      ② old 那棵的兄弟指向【工作樹】不是 HEAD ⇒ old 不是真的 HEAD 世界
  #      ③ 366 支 migration ⇒ 每支受測檔多開約 1,827 個程序 ⇒ 可能把人逼去用 `--no-verify`
  #    🎯 ⇒ 明寫參數同時解掉這三個:不建檔案系統的東西, 就沒有「建失敗」這個世界。
  local base; base=$(basename "$f")
  local od nd
  od="$tdir/old"; nd="$tdir/new"
  mkdir -p "$od" "$nd" || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  old="$od/$base"; new="$nd/$base"
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
  # 🔴🔴 **兩邊的兄弟分母【不是同一個】, 而且各自要與那一邊的【受測本體】同一個世界**
  #   (codex R1 must-fix③ + R2 must-fix①)
  #   · `old`  的本體 = `HEAD:$f`      ⇒ 兄弟也要 **HEAD**
  #   · `new`  的本體 = index(有 staged)或工作樹(沒 staged)⇒ 兄弟要**同一個來源**
  #   🔬 R2 抓到的假綠:本體取 index 而兄弟取工作樹 ⇒ 一支**未 staged / untracked 的更早 migration**
  #     可以替它提供定義 ⇒ 規則① 不紅, **而那支檔根本不會進 commit**。
  #   ⚡ 兩邊都用 `git archive <tree>` 一次取出(O(1) 個程序);工作樹那條才直接指目錄。
  #   🔴 **`HEAD` 只解析一次**(R2:三次 `HEAD` 之間 repo 可能動)。
  local sibdir_old sibdir_new head_sha new_tree
  head_sha=$(git rev-parse HEAD 2>/dev/null) || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  [ -n "$head_sha" ] || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  sibdir_old="$tdir/sib_old"
  mkdir -p "$sibdir_old" || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  # ── old:HEAD 的兄弟 ────────────────────────────────────────────────
  # 🔴 每一步都接 rc —— R2 逐字:「兩個失敗同時變成 0 == 0 仍可放行」。
  git archive "$head_sha" supabase/migrations 2>/dev/null | tar -x -C "$tdir" 2>/dev/null \
    || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  [ -d "$tdir/supabase/migrations" ] || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  mv "$tdir/supabase/migrations"/*.sql "$sibdir_old"/ || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  rm -rf "$tdir/supabase"
  rm -f "$sibdir_old/$base"          # 受測那一支不能當自己的「更早檔」
  # ── new:與 new 本體同一個世界的兄弟 ────────────────────────────────
  if git diff --cached --name-only -- "$f" 2>/dev/null | grep -q .; then
    # 本體取自 index ⇒ 兄弟也取 index(候選快照)
    new_tree=$(git write-tree 2>/dev/null) || { rm -rf "$tdir"; trap - INT TERM; return 9; }
    sibdir_new="$tdir/sib_new"
    mkdir -p "$sibdir_new" || { rm -rf "$tdir"; trap - INT TERM; return 9; }
    git archive "$new_tree" supabase/migrations 2>/dev/null | tar -x -C "$tdir" 2>/dev/null \
      || { rm -rf "$tdir"; trap - INT TERM; return 9; }
    [ -d "$tdir/supabase/migrations" ] || { rm -rf "$tdir"; trap - INT TERM; return 9; }
    mv "$tdir/supabase/migrations"/*.sql "$sibdir_new"/ || { rm -rf "$tdir"; trap - INT TERM; return 9; }
    rm -rf "$tdir/supabase"
    rm -f "$sibdir_new/$base"
  else
    # 本體取自工作樹 ⇒ 兄弟就是工作樹那個目錄
    sibdir_new="supabase/migrations"
  fi
  # 🔴 **分母完整性:比對數目, 而每一步都要接得到失敗**
  #   ⛔ ~~空就 return 9~~ 過嚴(HEAD 只有一支 migration 的 repo 分母天生是 0)
  #   ⛔ ~~`|| true` 把 ls-tree 的失敗壓成 0~~ ⇒ 那會讓「失敗」與「真的 0」印同一個數。
  local want_sib got_sib lst
  lst=$(git ls-tree -r --name-only "$head_sha" supabase/migrations/ 2>/dev/null) \
    || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  want_sib=$(printf '%s\n' "$lst" | grep -c '\.sql$')
  want_sib=$(( want_sib > 0 ? want_sib - 1 : 0 ))
  got_sib=$(find "$sibdir_old" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ') \
    || { rm -rf "$tdir"; trap - INT TERM; return 9; }
  if [ "$got_sib" != "$want_sib" ]; then
    rm -rf "$tdir"; trap - INT TERM; return 9
  fi
  on=$(redness "$old" "$sibdir_old"); oc=$(printf '%s' "$on" | sed -n '1p'); ok_kinds=$(printf '%s' "$on" | sed -n '2p'); orc=$(printf '%s' "$on" | sed -n '3p')
  nn=$(redness "$new" "$sibdir_new"); nc=$(printf '%s' "$nn" | sed -n '1p'); nw_kinds=$(printf '%s' "$nn" | sed -n '2p'); nrc=$(printf '%s' "$nn" | sed -n '3p')
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
  CHECKS_FOR_SELFTEST="$CHECKS"
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

  # ══ 🟠 補版控型標記兩個世界(⟦0e-DDLINTOVC-MARK⟧)══════════════════════
  #    🛑 同一支 fixture 只差那一行 —— 換了 fixture 就不是在量那一行。
  #    量的是【那兩句話】不是 rc:補版控型照樣走不退步閘, rc 兩個世界都該是 0。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql && git commit -qm vc ) >/dev/null 2>&1
  ( cd "$W" && printf 'version\tsha\n20200808000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  # 世界一:帶標記 ⇒ 那兩句話要說「沒有以檔 apply 過 / 改它不受限制」
  printf -- '-- pcm:ddl-into-vc: public.zz_vc\nBEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql )
  # 🔴🔴 **codex 2026-09-06 R1 MF6**:第一版只比對輸出字串而**把指令的 rc 丟掉**
  #    ⇒ 腳本先印「補版控型」再失敗(exit 9 之類), 這一格照樣綠。
  #    ⇒ 📌 我註解裡寫著「兩個世界 rc 都是 0」而**沒有任何一格在量那個 rc**。
  _ov1=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 ); _rc1=$?
  case "$_ov1" in *補版控型*) _rv1=0 ;; *) _rv1=1 ;; esac
  cell "🟠 帶標記的已落地檔 ⇒ 訊息點名它是補版控型" "$_rv1" "0"
  cell "🟠 而它的 rc 是 0(印了那句話【而且】真的放行)" "$_rc1" "0"
  # 🔴🔴 **這一格記的是一個【量到的事實】, 而它推翻了我原本以為的**:
  #    「已落地 + 這次沒改動」的檔在 :416 就被 `! is_new && ! is_modified` 攔進 `skipped_list`,
  #    **永遠走不到 :427 的 `already_landed` 分支** ⇒ `landed_list` 只在【untracked 且已落地】
  #    這個很窄的情況才會被填 ⇒ 那段「現在改它們是被禁的」訊息**幾乎是死碼**。
  #    ⛔ 我第一版把這格的標籤寫成「⇒ 說出那句話」而斷言寫成「不說」, 然後看到 rc=1 就把
  #      期望值改成 1 —— **那是拿觀察去配斷言**, 本 repo 記過的最壞形狀。⇒ 標籤改成講真話。
  ( cd "$W" && git reset -q HEAD supabase/migrations/20200808000000_vc.sql 2>/dev/null; git checkout -q -- supabase/migrations/20200808000000_vc.sql 2>/dev/null )
  _ov2=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 )
  case "$_ov2" in *"改它不受那條限制"*) _rv2=0 ;; *) _rv2=1 ;; esac
  cell "🔵 已落地【沒改動】⇒ 更前面就被 skipped_list 攔掉, 走不到 landed_list 那段" "$_rv2" "1"
  case "$_ov2" in *"略過(這次 commit 沒有動到的檔"*) _rv2b=0 ;; *) _rv2b=1 ;; esac
  cell "🔵 而它走的是【略過】那條(釘住它到底走哪, 不只釘「沒印那句」)" "$_rv2b" "0"
  # 世界二:同一支【拿掉那一行】⇒ 兩句話都不該出現
  #    🛑 沒有這一格,「帶標記會這樣說」與「這支尺對誰都這樣說」印同一個東西。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- 只改註解\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql )
  _ov3=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 ); _rc3=$?
  case "$_ov3" in *補版控型*) _rv3=1 ;; *) _rv3=0 ;; esac
  cell "🔵 拿掉標記 ⇒ 補版控型那幾句不印(證明上面的綠不是恆綠)" "$_rv3" "0"
  cell "🔵 而它的 rc 也是 0(兩個世界都放行, 標記不改變 rc)" "$_rc3" "0"
  # 🧬🧬 **codex 2026-09-06 R2**:MF5 那個修法【沒有任何一格在量】—— 上面每一發的
  #    index 與工作樹內容都相同 ⇒ 把 `is_ddl_into_vc` 還原成只讀工作樹, 27 格照樣全綠。
  #    ✅ 這一格故意讓兩者【相反】:index 那版**有**標記, 工作樹那版**沒有**。
  #    閘量的是 index 那版 ⇒ 訊息也必須講 index 那版。
  printf -- '-- pcm:ddl-into-vc: public.zz_vc\nBEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql )
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- 工作樹這版【沒有】標記\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  _ov6=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 )
  case "$_ov6" in *是【補版控型】*) _rv6=0 ;; *) _rv6=1 ;; esac
  cell "🧬 index 有標記而工作樹沒有 ⇒ 講【index 那版】(閘量的就是它)" "$_rv6" "0"
  # 反過來:index 沒標記而工作樹有 ⇒ 不得講成補版控型
  # 🔴 **fixture 前提第一版是錯的**:index 與 HEAD 相同時**根本沒有 staged 的東西**
  #    ⇒ 閘(與 `no_regression` 一致)量的本來就是工作樹, 講工作樹是【對的】。
  #    ⇒ 要造真的鏡像, index 必須同時【不等於 HEAD】也【不等於工作樹】。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- index 這版沒有標記\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql )
  printf -- '-- pcm:ddl-into-vc: public.zz_vc\nBEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  _ov7=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 )
  case "$_ov7" in *是【補版控型】*) _rv7=1 ;; *) _rv7=0 ;; esac
  cell "🧬 反過來:index 沒標記而工作樹有 ⇒ 【不】講成補版控型(證明它讀的是 index)" "$_rv7" "0"

  # 🧬 MF8:冒號後空的 ⇒ 要出聲, 而且不算標記
  printf -- '-- pcm:ddl-into-vc:\nBEGIN;\nSELECT 1;\nCOMMIT;\n-- x\n' > "$W/supabase/migrations/20200808000000_vc.sql"
  ( cd "$W" && git add supabase/migrations/20200808000000_vc.sql )
  _ov4=$( cd "$W" && bash "$SELF" supabase/migrations/20200808000000_vc.sql 2>&1 )
  case "$_ov4" in *標記不完整*) _rv4=0 ;; *) _rv4=1 ;; esac
  cell "🧬 冒號後空的 ⇒ 出聲說標記不完整(不是靜默當成沒標記)" "$_rv4" "0"
  case "$_ov4" in *是【補版控型】*) _rv5=1 ;; *) _rv5=0 ;; esac
  cell "🧬 冒號後空的 ⇒ 不算補版控型" "$_rv5" "0"
  ( cd "$W" && rm -f supabase/APPLIED.tsv; git reset -q HEAD supabase/migrations/20200808000000_vc.sql 2>/dev/null; git checkout -q -- supabase/migrations/20200808000000_vc.sql 2>/dev/null )

  # ══ 🔴 絕對路徑(lint-staged 餵的就是這一種)══════════════════════════
  #    🛑 這一格是本 repo「我在自己樹上跑是綠的 = 觸發條件不是通過條件」的又一個實例:
  #      相對路徑 rc=0, 而絕對路徑 `git show HEAD:<絕對路徑>` 回 128 ⇒ exit 9。
  #      它在 pre-commit 裡穩定重現, 而我手動跑一輩子都看不到。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$W/supabase/migrations/20200909000000_abs.sql"
  ( cd "$W" && git add supabase/migrations/20200909000000_abs.sql && git commit -qm abs ) >/dev/null 2>&1
  ( cd "$W" && printf 'version\tsha\n20200909000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- 改一行註解\n' > "$W/supabase/migrations/20200909000000_abs.sql"
  ( cd "$W" && git add supabase/migrations/20200909000000_abs.sql )
  ( cd "$W" && bash "$SELF" "$W/supabase/migrations/20200909000000_abs.sql" ) >/dev/null 2>&1
  cell "🔴 餵【絕對路徑】⇒ 仍量得到(不是 exit 9)" "$?" "0"
  ( cd "$W" && bash "$SELF" supabase/migrations/20200909000000_abs.sql ) >/dev/null 2>&1
  cell "🔵 同一支餵相對路徑 ⇒ 一樣放行(兩種寫法同一個答案)" "$?" "0"
  ( cd "$W" && rm -f supabase/APPLIED.tsv )

  # 🔵 對照要換一支【真的會被跳過】的檔 —— 契約改了之後,「舊檔」本身不再等於「跳過」。
  # 🔴 契約翻面後, 「落地」本身不再等於「跳過」—— 還要**這次真的沒改到**。
  #    ⇒ 先把它還原成 HEAD 那份(index 與工作樹都要), 它才是真的沒改動。
  ( cd "$W" && git reset -q HEAD supabase/migrations/20200101000000_old.sql 2>/dev/null; git checkout -q -- supabase/migrations/20200101000000_old.sql 2>/dev/null )
  ( cd "$W" && printf 'version\tsha\n20200101000000\tdeadbeef\n' > supabase/APPLIED.tsv )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200101000000_old.sql >/dev/null 2>&1 )
  cell "【對照】已落地且這次【沒改到】⇒ rc=0(這一格才是「查無」)" "$?" "0"
  ( cd "$W" && rm -f supabase/APPLIED.tsv )

  # ══ 🔴 暫存檔名/兄弟分母那個假紅(2026-09-07 `⟦db-REGRESSGATETMPNAME⟧`)══════════
  #   病:兩版存成 `$tdir/old.sql` / `new.sql` 再餵 CHECKS ⇒ 規則① 用 `dirname` 當兄弟分母
  #      ⇒ 暫存目錄沒有兄弟 ⇒ 每個 `CREATE OR REPLACE` 都被判【新物件】。
  #   🔬 複現:同一份 `20260901030000` 內容 ⇒ `old.sql` 2 紅 / `new.sql` 6 紅;原檔名 ⇒ 2 紅。
  #   ✅ 修法:CHECKS 收 `PCM_SIBLING_DIR`(明寫分母);old 用 `git archive HEAD` 取出的兄弟、
  #      new 用工作樹;沒給就照舊(零行為改變), 給了而目錄不存在 ⇒ CHECKS `exit 9`。
  #
  # 🔴🔴 **下面三格是【第二版】—— 第一版被 codex R1 打掉, 逐字「兩格對本次差異皆零判別力」**:
  #    世界甲(還原成未修改)**入口就略過、根本不進 `no_regression()`**, 修法前也綠;
  #    世界乙的 `IF NOT EXISTS` **修法前後都會擋**。
  #    📌 **我拿那兩格當「證了」報上去 —— 那是今晚第二次同型**(前一次:突變被 migration 自己修好)。
  #    ✅ 第二版用【同一個旋鈕去模擬壞掉的世界】:把 `PCM_SIBLING_DIR` 指到一個**空目錄**
  #      = 修法前那個「沒有兄弟」的分母 ⇒ 它必須紅。**同一支檔、同一份內容, 只有分母不同。**
  ( cd "$W" && mkdir -p supabase/migrations )
  ( cd "$W" && printf 'BEGIN;\nCREATE FUNCTION public.zzz_sib_fn() RETURNS int LANGUAGE sql AS $x$SELECT 1$x$;\nCOMMIT;\n' \
      > supabase/migrations/20200303000000_earlier.sql )
  ( cd "$W" && printf 'BEGIN;\nCREATE OR REPLACE FUNCTION public.zzz_sib_fn() RETURNS int LANGUAGE sql AS $x$SELECT 2$x$;\nCOMMIT;\n' \
      > supabase/migrations/20200404000000_later.sql )
  ( cd "$W" && git add -A >/dev/null 2>&1 && git -c user.email=p@x -c user.name=p commit -qm sibfix >/dev/null 2>&1 )
  # ── 世界甲:分母【對】(受測檔自己的目錄, 兄弟在)⇒ OR REPLACE 不算新物件 ⇒ 規則① 不叫
  ( cd "$W" && bash "$CHECKS_FOR_SELFTEST" supabase/migrations/20200404000000_later.sql >/dev/null 2>&1 )
  cell "🧪 分母對(兄弟在)⇒ OR REPLACE 不被判新物件" "$?" "0"
  # ── 世界乙:同一支檔, 只把分母換成【空目錄】= 修法前那個世界 ⇒ 必須紅
  ( cd "$W" && mkdir -p "$W/emptysib" && PCM_SIBLING_DIR="$W/emptysib" bash "$CHECKS_FOR_SELFTEST" supabase/migrations/20200404000000_later.sql >/dev/null 2>&1 )
  cell "🧪 分母空(= 修法前)⇒ 同一份內容被判新物件 ⇒ 紅" "$?" "1"
  # ── 世界丙:分母目錄不存在 ⇒ exit 9(不得靜默照舊 —— 那會讓「我以為指定了」與「沒收到」同一個結果)
  ( cd "$W" && PCM_SIBLING_DIR="$W/zzz-no-such" bash "$CHECKS_FOR_SELFTEST" supabase/migrations/20200404000000_later.sql >/dev/null 2>&1 )
  cell "🧪 分母目錄不存在 ⇒ exit 9(不是靜默照舊)" "$?" "9"

  # ── 🔴 端到端(codex R2 must-fix③):上面三格只直接呼叫主檢查器, **沒有走 `no_regression()`**
  #    ⇒ 整段接線壞掉它們仍會全綠。這一對走完整條路, 而且分辨的是 R2 抓到的那個假綠:
  #    **「工作樹有、候選快照沒有」的更早兄弟**。
  # 世界一:更早那支【沒有 staged】(只在工作樹)⇒ 候選快照裡沒有它 ⇒ 規則① 該紅
  ( cd "$W" && printf 'BEGIN;\nCREATE FUNCTION public.zzz_e2e_fn() RETURNS int LANGUAGE sql AS $x$SELECT 1$x$;\nCOMMIT;\n' \
      > supabase/migrations/20200505000000_e2e_earlier.sql )
  ( cd "$W" && printf 'BEGIN;\nCREATE OR REPLACE FUNCTION public.zzz_e2e_fn() RETURNS int LANGUAGE sql AS $x$SELECT 3$x$;\nCOMMIT;\n' \
      > supabase/migrations/20200606000000_e2e_later.sql )
  ( cd "$W" && git add supabase/migrations/20200606000000_e2e_later.sql >/dev/null 2>&1 )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200606000000_e2e_later.sql >/dev/null 2>&1 )
  cell "🧪 端到端:更早那支只在工作樹(沒 staged)⇒ 候選快照沒有它 ⇒ 擋" "$?" "1"
  # 世界二:把更早那支也 staged ⇒ 候選快照裡有它 ⇒ 放行(同一份受測內容, 只差它在不在快照)
  ( cd "$W" && git add supabase/migrations/20200505000000_e2e_earlier.sql >/dev/null 2>&1 )
  ( cd "$W" && bash "$SELF" supabase/migrations/20200606000000_e2e_later.sql >/dev/null 2>&1 )
  cell "🧪 端到端:更早那支也 staged ⇒ 快照裡有它 ⇒ 放行" "$?" "0"
  ( cd "$W" && git rm -q --cached supabase/migrations/20200505000000_e2e_earlier.sql >/dev/null 2>&1
    git rm -q --cached supabase/migrations/20200606000000_e2e_later.sql >/dev/null 2>&1
    rm -f supabase/migrations/20200505000000_e2e_earlier.sql supabase/migrations/20200606000000_e2e_later.sql )

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
      # 🟠 補版控型也要在【有改動】這條路上點名 —— 第一版只在「沒改動」那條印,
      #    而那條是比較少走的。📌 抓到它的是新加的那一格 selftest, 不是我。
      if is_ddl_into_vc "$f"; then
        printf '   🟠 %s 是【補版控型】(檔頭 -- pcm:ddl-into-vc:)⇒ 它**從來沒有以檔 apply 過**,\n' "$f"
        printf '      改它不受「已 apply 的 migration 本體不得動」那條限制;不退步閘照跑。\n'
      fi
      no_regression "$f"; _n=$?
      case "$_n" in
        0) checked=$((checked + 1)); checked_mod=$((checked_mod + 1)) ;;
        9) echo "🔴 $f:不退步閘量不到(取不到舊版或暫存檔建不出來)⇒ 這一發沒有檢查過, exit 9" >&2; exit 9 ;;
        *) rc=1; checked=$((checked + 1)); checked_mod=$((checked_mod + 1)) ;;
      esac
      continue
    fi
    landed_list="$landed_list $f"
    if is_ddl_into_vc "$f"; then
      printf '⏭️  已在 origin/dev 且這次沒改動, 不掃:%s\n' "$f"
      printf '   🟠 而它是【補版控型】(檔頭 -- pcm:ddl-into-vc:)⇒ 它**從來沒有以檔 apply 過**;\n'
      printf '      「物件在正式庫上」是它被寫下來之前就成立的事 ⇒ 兩者不要混講。\n'
    else
      printf '⏭️  已 apply / 已在 origin/dev 且這次沒改動, 不掃:%s\n' "$f"
    fi
    continue
  fi
  checked=$((checked + 1)); checked_new=$((checked_new + 1))
  # 🔴 `|| rc=1` 會把【每一種】非 0 都塌成「這支違規」(2026-08-27 本窗實測)——
  #    而 9 =「暫存目錄建不出來 ⇒ 我根本沒檢查」。塌成 1 之後畫面說的是「有違規」,
  #    ⇒ 擋是擋住了, **而它擋人的理由是編的** ⇒ 下一個人會去改一支沒問題的 SQL。
  #    📌 同一個病的第三層:守門答對了, 而【答案在往上傳的路上被換成別的意思】。
  # 🔴🔴 **新檔(A)這條路的兄弟分母也要是【候選快照】, 不是工作樹**
  #   (2026-09-07 端到端 selftest 自己撞出來的 —— codex R2 只指到 `no_regression()` 那條路,
  #    而**同一個假綠在新檔這條路上也成立**:一支**未 staged / untracked** 的更早 migration
  #    可以替新檔提供定義 ⇒ 規則① 不紅, **而那支檔根本不會進 commit**。)
  #   ⇒ 有 staged ⇒ 用 `git write-tree` 的候選快照;沒有 ⇒ 照舊(那時工作樹就是候選)。
  _sibnew=""
  if git diff --cached --name-only -- "$f" 2>/dev/null | grep -q .; then
    _snaptree=$(git write-tree 2>/dev/null) || _snaptree=""
    if [ -n "$_snaptree" ]; then
      _sibtmp=$(mktemp -d) || _sibtmp=""
      if [ -n "$_sibtmp" ] && git archive "$_snaptree" supabase/migrations 2>/dev/null | tar -x -C "$_sibtmp" 2>/dev/null \
         && [ -d "$_sibtmp/supabase/migrations" ]; then
        rm -f "$_sibtmp/supabase/migrations/$(basename "$f")"
        _sibnew="$_sibtmp/supabase/migrations"
      else
        # 🔴 建不出候選快照 ⇒ 這一發沒量到, 不准當「乾淨」
        [ -n "$_sibtmp" ] && rm -rf "$_sibtmp"
        echo "🔴 $f:候選快照建不出來 ⇒ 這一發【沒有檢查過】, exit 9" >&2
        exit 9
      fi
    fi
  fi
  PCM_SIBLING_DIR="$_sibnew" bash "$CHECKS" "$f"; _c=$?
  [ -n "${_sibtmp:-}" ] && rm -rf "$_sibtmp"; _sibtmp=""
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
  # 🟠 而補版控型是那句話的例外, 要逐支點名 —— 一句「一律不得動」會把一件【允許的事】說成禁止,
  #    而下一個人不會去推翻一句看起來很像規矩的話。
  _vcn=0
  for s in $landed_list; do
    if is_ddl_into_vc "$s"; then
      _vcn=$((_vcn + 1))
      printf '   🟠 例外:%s 是【補版控型】⇒ 它沒有以檔 apply 過, **改它不受那條限制**。\n' "$s"
    fi
  done
  [ "$_vcn" -gt 0 ] && printf '   ⇒ 上面 %s 支是例外;其餘才適用「不得動」。\n' "$_vcn"
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
