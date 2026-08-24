#!/bin/sh
# ============================================================
# .husky/scripts-whitelist-gate.sh 的證人 — 把它的 exit code 逐個【餵一發】
# ============================================================
# 為什麼要有這支(2026-08-21 主視窗裁定,W5 執行):
#   那道閘的檔頭自己寫著「下面四道自檢宣稱失敗時回 exit 2」,並老實標注
#   **從沒有表演過**。而「檔頭寫了」與「它會發生」是兩件事 ——
#   沒餵過的 exit 2 只是註解,不是行為。
#
# 做法:在暫存目錄造**拋棄式 git repo**,把閘複製進去,一次改一個條件餵它一發。
#   ⇒ 完全不碰本 repo 的 scripts/ 與 package.json。
#
# 🔴 每一格驗【兩件事】,不是一件(2026-08-21 codex 對抗審查 R1 must-fix):
#     ① exit code 對不對
#     ② **它是不是為了我要的那個理由紅的** —— 比對 stderr 裡的關鍵字。
#   沒有②的話,`git init` 或 `cp` 先失敗而碰巧也回 2,那一格照樣記 PASS,
#   而它證明的東西是零。fixture 建置本身也逐步檢查,失敗當場停。
#
# 🔴 誠實邊界:
#   · 這支驗的是【閘的判別力】,不是「本 repo 現在乾淨」——後者要直接跑那道閘。
#   · 「豁免理由空白」那一格用的是**閘的突變副本**(把某列理由挖空),
#     因為豁免清單是寫死在閘裡的 heredoc、沒有外部注入點。
#     ⇒ 那一格證的是「判定式會紅」,不是「正本那份清單有沒有空理由」(正本由閘自己每次跑)。
#
# exit 0 = 每一格都表演到位   1 = 有格沒過(閘的行為與宣稱不符)   2 = 本 harness 自己壞了
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

GATE="$(git rev-parse --show-toplevel 2>/dev/null)/.husky/scripts-whitelist-gate.sh"
if [ ! -f "$GATE" ]; then
  echo "✗ 找不到 $GATE ⇒ 本 harness 沒有被驗物,exit 2" >&2
  exit 2
fi

usage() { echo "用法: sh scripts/scripts-whitelist-gate.harness.sh" >&2; }
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

# 🔴🔴 **把繼承來的 git 環境變數清掉**(2026-08-21 實測,codex R4 的接線題挖出來的):
#    本段會在暫存目錄裡 `git init` / `git add` / `git commit` 造 fixture。
#    而 lint-staged 是被 **`git commit` 的 pre-commit hook** 叫起來的 ⇒ 我們繼承了
#    `GIT_INDEX_FILE`(指向外層那次 commit 的**暫存 index**)。
#    ⇒ fixture 裡的 `git add` 會把路徑寫進【外層那次 commit 的 index】,
#      外層隨即報 `error: invalid object … for 'supabase/migrations/20260101000000_x.sql'`
#      ⇒ **整批 commit 失敗,而錯誤訊息指著一個那個 repo 裡根本不存在的檔。**
#    ⇒ 這不是 fixture 的問題,是「自檢從 hook 裡跑」時的真實副作用。
unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_PREFIX 2>/dev/null || true
pass=0; fail=0
BASE=$(mktemp -d) || exit 2
# 🔴 INT/TERM 的 handler 要自己 `exit`(2026-08-21 R3 must-fix,與 `.husky/pre-push:37` 同一條):
#    只清暫存而不離場的話,Ctrl-C 之後**執行流會繼續往下跑**,而暫存已經刪了
#    ⇒ 被中斷的那一次仍會印出一個判決。EXIT 那條只負責清檔,不改離場碼。
trap 'rm -rf "$BASE"' EXIT
trap 'rm -rf "$BASE"; exit 1' INT TERM
OUT="$BASE/out.txt"

ck() { # $1=標籤 $2=實得rc $3=該得rc $4=stderr 該出現的關鍵字(空=不驗)
  _why="ok"
  if [ "$2" != "$3" ]; then
    _why="rc=$2 但宣稱是 $3"
  elif [ -n "${4:-}" ] && ! grep -qF "$4" "$OUT"; then
    _why="rc 對了,但沒印出「$4」⇒ 它是為了別的理由紅的"
  fi
  if [ "$_why" = "ok" ]; then
    echo "  PASS $1 (rc=$2)"; pass=$((pass + 1))
  else
    echo "  🔴 FAIL $1 —— $_why"; fail=$((fail + 1))
  fi
}

die() { echo "✗ fixture 建置失敗:$1 ⇒ 本 harness 自己壞了,exit 2" >&2; exit 2; }

# 造一個【該綠】的最小世界:一支 script + package.json 裡有它的白名單行
mkworld() { # $1=世界名 → 印出目錄
  d="$BASE/$1"
  mkdir -p "$d/scripts" "$d/.husky" || die "mkdir $1"
  ( cd "$d" && git init -q . && git config user.email w5@x && git config user.name w5 ) \
    || die "git init $1"
  : > "$d/scripts/only.py" || die "touch only.py"
  cat > "$d/package.json" <<'PJ' || die "寫 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
  cp "$GATE" "$d/.husky/gate.sh" || die "cp gate"
  # 🔴 2026-08-25:本閘改成【只看 index】之後, fixture 不 stage 就等於什麼都沒放進它的分母。
  #    ⇒ 這裡加 `git add -A` 是**修 fixture**, 不是改期望值 —— 下面 14 格的期望值一個字沒動。
  #    (判別句:期望值沒變而全部回綠 ⇒ 沒有被弱化;若要改期望值, 那是另一件事、要先回報。)
  ( cd "$d" && git add -A ) || die "git add -A $1"
  echo "$d"
}
run() { ( cd "$1" && sh .husky/gate.sh > "$OUT" 2>&1 ); echo $?; }
# 🔴 帶參數跑 —— `--list-orphans` 那條路原本一格都沒走過(突變矩陣抓到:拿掉它零格紅)。
run_args() { _r="$1"; shift; ( cd "$_r" && sh .husky/gate.sh "$@" > "$OUT" 2>&1 ); echo $?; }

# 🔴 codex R2 nit:`die` 發生在 `W=$(world …)` 的**子 shell** 裡,只結束 command substitution,
#    parent 會若無其事繼續 ⇒ fixture 壞掉時最後回 1(看起來像「閘不合宣稱」)而不是 2(harness 自壞)。
#    ⇒ 每次取世界都用這個包裝,parent 這一層自己檢查。
world() { # $1=世界名
  _d=$(mkworld "$1")
  if [ ! -d "${_d:-}" ] || [ ! -f "${_d:-}/.husky/gate.sh" ]; then
    echo "✗ fixture 建置失敗:$1 ⇒ 本 harness 自己壞了,exit 2" >&2; exit 2
  fi
  echo "$_d"
}

# ── 格1 [該綠] 正向對照:每支都有歸屬 ⇒ 0 ────────────────────
W=$(world ok)
ck "格1 [正] 每支都有歸屬 ⇒ 0" "$(run "$W")" "0" "白名單涵蓋"

# ── 格1b [該綠·另一條讀取路徑] package.json 已 staged ⇒ 走 git show :package.json
#    🔴 codex R1 must-fix:上一版每一格都沒 `git add`,所以**正式 repo 慣用的 staged 分支
#       一次都沒被驗到** —— 而那條分支正是 R2 補上去防「用未 staged 的 package.json 遮掉」的。
W=$(world staged)
( cd "$W" && git add package.json scripts/only.py ) || die "git add staged 世界"
ck "格1b [正] 讀 staged 的 package.json ⇒ 0" "$(run "$W")" "0" "讀自 staged"

# ── 格1c [該紅·staged 分支的判別力] staged 的 package.json 沒有白名單,
#    工作樹那份有 ⇒ 必須以 staged 為準而擋下(否則就是 R2 要防的那個繞法)
W=$(world stagedbypass)
printf '{\n  "name": "fake",\n  "lint-staged": {\n    "nothing.py": "true"\n  }\n}\n' > "$W/package.json" || die "寫遮蔽用 package.json"
( cd "$W" && git add package.json scripts/only.py ) || die "git add stagedbypass"
cat > "$W/package.json" <<'PJ' || die "覆寫工作樹 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
# 🔴 釘的是【被點名的那支檔名】,不是擋下訊息的措辭(2026-08-21 換過一次教訓):
#    上一版釘「都沒有」,而我改寫擋下訊息時那三個字沒了 ⇒ 這一格當場翻紅。
#    **那是 harness 在做它的事**,而修法不是把措辭改回去,是釘一個**承重且不會隨措辭走**的東西:
#    「它有沒有指名道姓報出【正確的那一支】」。
ck "格1c [負] 工作樹的白名單不算數,以 staged 為準 ⇒ 1" "$(run "$W")" "1" "only.py"

# ── 格2 [該紅] 多一支沒歸屬的 ⇒ 1 ────────────────────────────
# 🔴 2026-08-25:本閘只看 index ⇒ 這一格【後來造的東西】也要 stage, 不然不在它的分母裡。
W=$(world extra); : > "$W/scripts/orphan.py" || die "touch orphan"
( cd "$W" && git add -A ) || die "stage extra"
ck "格2 [負] 多一支未列管 ⇒ 1" "$(run "$W")" "1" "orphan.py"

# ── 格3 [exit 2] 分母是 0:scripts/ 在,但一支都掃不到 ──────────
#    🔴 這正是「零次迴圈然後 exit 0」那個失效形狀 —— 必須與「乾淨」分得開。
W=$(world empty); rm -f "$W/scripts/only.py"; : > "$W/scripts/keep.txt" || die "touch keep.txt"
ck "格3 [exit2] 分母 0 ⇒ 2,不是 0" "$(run "$W")" "2" "分母是 0"

# ── 格4 [exit 2] 檔名含換行 ⇒ 逐行比對會漏擋 ──────────────────
# 🔴 2026-08-25:本閘只看 index ⇒ 這一格【後來造的東西】也要 stage, 不然不在它的分母裡。
W=$(world newline)
: > "$W/scripts/$(printf 'we\nird').py" || die "造含換行檔名"
( cd "$W" && git add -A ) || die "stage newline"
ck "格4 [exit2] 檔名含換行 ⇒ 2" "$(run "$W")" "2" "檔名含換行"

# ── 格5 [exit 2] 抽不出 lint-staged 區塊 ──────────────────────
W=$(world nols)
printf '{\n  "name": "fake"\n}\n' > "$W/package.json" || die "寫無 lint-staged 的 package.json"
( cd "$W" && git add -A ) || die "stage pkg"
ck "格5 [exit2] 沒有 lint-staged 區塊 ⇒ 2" "$(run "$W")" "2" "開了 0 個 lint-staged 區塊"

# ── 格5b [exit 2] 兩個 lint-staged 區塊(巢狀偽造)⇒ 比對範圍不明確 ──
W=$(world twols)
cat > "$W/package.json" <<'PJ' || die "寫雙區塊 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true"
  },
  "nested": {
    "lint-staged": {
      "scripts/only.py": "true"
    }
  }
}
PJ
( cd "$W" && git add -A ) || die "stage pkg 5b"
ck "格5b [exit2] 兩個 lint-staged 區塊 ⇒ 2" "$(run "$W")" "2" "開了 2 個 lint-staged 區塊"

# ── 格6 [exit 2] 豁免理由空白(用閘的突變副本)────────────────
W=$(world noreason)
# 把豁免清單第一列的理由欄挖空(保留 TAB,只清理由)
awk 'BEGIN{done=0} /^scripts\/.*\t/ && !done {sub(/\t.*$/,"\t"); done=1} {print}' \
    "$GATE" > "$W/.husky/gate.sh" || die "產生突變副本"
# 🔴 突變沒套上就要當場停 —— 否則這一格會「證明」一個沒發生的東西
if diff "$GATE" "$W/.husky/gate.sh" > /dev/null 2>&1; then
  die "突變沒套上(豁免清單格式變了?)"
fi
ck "格6 [exit2] 豁免列沒寫理由 ⇒ 2" "$(run "$W")" "2" "沒寫理由"

# ── 格8 [訊息形狀] 沒歸屬的檔名必須出現在【最後一行】────────────────
# 🔴 立於 2026-08-21:這道閘曾經擋住全隊 commit,而主視窗**花三發還不知道是哪一支** ——
#    它有印 `✗ <檔名>`,但被埋在 16 行豁免清單後面(而且兩個串流混在一起)。
#    ⇒ 病不是「沒印」,是「印在沒有人會看的位置」。終端機往下捲 ⇒ **最後一行最顯眼**。
# 🔴 2026-08-25:本閘只看 index ⇒ 這一格【後來造的東西】也要 stage, 不然不在它的分母裡。
W=$(world lastline); : > "$W/scripts/orphan-XYZ.py" || die "touch orphan-XYZ"
( cd "$W" && git add -A ) || die "stage lastline"
rc=$(run "$W")
_last=$(tail -1 "$OUT")
case "$_last" in
  *orphan-XYZ.py*) _hit=yes ;;
  *)               _hit=no  ;;
esac
ck "格8 [訊息] 沒歸屬的檔名在最後一行" "$_hit" "yes"
ck "格8b [訊息] 那一發仍然是 rc=1" "$rc" "1"

# ── 格9 [訊息形狀] 綠的時候不准倒出整份豁免清單 ────────────────────
# 🔴 綠的輸出每次 commit 都會出現。豁免清單是**給人定期審視的**,不是給每次 commit 看的
#    ⇒ 它一長,真正的訊號就被推到看不見的地方(格8 那個病的上游)。
W=$(world quiet)
rc=$(run "$W")
_lines=$(wc -l < "$OUT" | tr -d ' ')
ck "格9 [訊息] 綠的輸出 ≤ 2 行(實得 $_lines)" "$([ "$_lines" -le 2 ] && echo yes || echo no)" "yes"
ck "格9b [訊息] 那一發是 rc=0" "$rc" "0"

# ── 格7 [exit 2] 不在 git repo 裡 ⇒ 本閘無法判斷 ───────────────
W="$BASE/nogit"; mkdir -p "$W/scripts" || die "mkdir nogit"
cp "$GATE" "$W/gate.sh" || die "cp gate nogit"
( cd "$W" && GIT_CEILING_DIRECTORIES="$BASE" sh gate.sh > "$OUT" 2>&1 ); rc=$?
ck "格7 [exit2] 不在 git repo ⇒ 2" "$rc" "2" "git rev-parse 失敗"

# ══ index-aware 那一組(2026-08-25 立;本閘改成只看 index 之後才有意義)════════
# 🔴 格10 是【承重的那一格】:主視窗指定的硬條件是「改成看 staged 之後,
#    `d7341281` 那個物證的情境還擋不擋得住」。這一格就是那一題, 而它必須紅。
#    (d7341281 = 兩支新腳本進版控、lint-staged 零 pattern 命中 ⇒ 它照樣放行。)
W=$(world d7341281)
: > "$W/scripts/new-one.py" || die "touch new-one"
: > "$W/scripts/new-two.py" || die "touch new-two"
( cd "$W" && git add -A ) || die "stage d7341281"
ck "格10 [承重] d7341281 情境(新檔已 staged、零 pattern 命中)⇒ 仍要擋" "$(run "$W")" "1" "new-one.py"

# 🔴 格11:今夜那個事故的形狀 —— 一支【誰都還沒收】的腳本躺在樹上, 而我收的是別的檔。
#    舊設計會擋(而被擋的人與造成它的人不是同一個);新設計必須放行。
#    🔴 fixture 要先 commit 掉基底 —— 那次事故裡 **package.json 沒有被 staged**,
#    而本閘 2026-08-25 新增的規則是「動到 package.json ⇒ 分母放大回整棵樹」。
#    不先 commit 的話, mkworld 的 `git add -A` 會把 package.json 也放進 index ⇒ 量到的是另一件事。
W=$(world orphan_pass)
( cd "$W" && git commit -qm base ) || die "commit orphan_pass"
: > "$W/scripts/nobody-staged-me.py" || die "touch orphan"
: > "$W/unrelated.txt" || die "touch unrelated"
( cd "$W" && git add unrelated.txt ) || die "stage unrelated"
ck "格11 [該綠] 未追蹤孤兒躺在樹上而收的是別的檔 ⇒ 放行" "$(run "$W")" "0"

# 🔴 格12:而放行【不等於默默放掉】—— 那支孤兒要被講出來, 否則我是靜靜地
#    把舊設計要防的那一族丟了。這一格釘的是「講了沒」, 不是 rc。
ck "格12 [訊息] 放行的同時要點名那支孤兒" \
   "$(grep -qF 'nobody-staged-me.py' "$OUT" && echo yes || echo no)" "yes" 
ck "格12b [訊息] 而且要明說【沒有擋你】(不然人會以為它擋了)" \
   "$(grep -qF '只提醒, 沒有擋你' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格13 [負對照] 沒有孤兒的世界 ⇒ 那段提醒不得出現。
#    少了這一格, 上面兩格在「它無條件印那段」時也會綠。
W=$(world no_orphan)
( cd "$W" && git commit -qm base ) || die "commit no_orphan"
: > "$W/unrelated.txt" || die "touch unrelated2"
( cd "$W" && git add unrelated.txt ) || die "stage unrelated2"
rc=$(run "$W")
ck "格13 [負對照] 沒有孤兒 ⇒ 不得印那段提醒" \
   "$(grep -qF '只提醒, 沒有擋你' "$OUT" && echo yes || echo no)" "no"
ck "格13b [該綠] 這顆 commit 沒動腳本 ⇒ 0(不是判量具失效)" "$rc" "0"

# 🔴 格14:分母自檢【意思反過來】那一格。
#    舊版「掃到 0 支 ⇒ 本閘壞了」原樣搬進 index 這一側 ⇒ 每一顆不動腳本的 commit 都會 exit 2。
#    這一格釘的是「staged 是 0 而整棵樹不是 0 ⇒ 正常放行」。
#    🔴 它要一個【腳本全部已經 commit 完、這次只收別的檔】的世界 ——
#    上一格那個世界裡 `scripts/only.py` 還在 index 裡(mkworld 會 add), 分母不是 0。
W=$(world staged_zero)
( cd "$W" && git commit -qm base ) || die "commit staged_zero"
: > "$W/unrelated.txt" || die "touch unrelated3"
( cd "$W" && git add unrelated.txt ) || die "stage unrelated3"
rc=$(run "$W")
ck "格14 [該綠] staged 0 支而整棵樹非 0 ⇒ 不得判量具失效" "$rc" "0" "不適用"

# ══ code-reviewer R1 那一輪補的 7 格(每一格對應一發【當時活著】的突變)════════
# 🔴 格15 是 must-fix①的證人:只看 staged 腳本 ⇒「白名單條目被刪掉」零守門。
#    實測過:刪 entry、腳本不動 ⇒ 舊版擋、只看 staged 的版本放行。
W=$(world wl_deleted)
( cd "$W" && git commit -qm base ) || die "commit wl_deleted"
cat > "$W/package.json" <<'PJ' || die "寫無 entry 的 package.json"
{
  "name": "fake",
  "lint-staged": {
    "somethingelse.md": "true"
  }
}
PJ
( cd "$W" && git add package.json ) || die "stage wl_deleted"
ck "格15 [承重] 白名單條目被刪、腳本不動 ⇒ 仍要擋" "$(run "$W")" "1" "only.py"

# 🔴 格16:`--diff-filter=ACMR` 的證人 —— 被【刪除】的腳本不該進擋人的分母
#    (它已經不在了, 擋它等於叫人去登記一支不存在的檔)。
W=$(world deleted_script)
( cd "$W" && git commit -qm base ) || die "commit deleted_script"
: > "$W/scripts/gone.py" || die "touch gone"
( cd "$W" && git add -A && git commit -qm add-gone ) || die "commit gone"
rm -f "$W/scripts/gone.py"
( cd "$W" && git add -A ) || die "stage deletion"
ck "格16 [該綠] 刪掉一支腳本 ⇒ 不得因為它沒歸屬而擋你" "$(run "$W")" "0"

# 🔴 格17:`-- scripts` 路徑限定的證人 —— repo 根的 .py 不在本閘射程內。
#    失效形狀正是【擋住所有人】, 也就是這一片在修的那個事故。
W=$(world outside_scripts)
( cd "$W" && git commit -qm base ) || die "commit outside"
: > "$W/root-level.py" || die "touch root-level"
( cd "$W" && git add -A ) || die "stage outside"
ck "格17 [該綠] scripts/ 以外的 .py 不在本閘分母裡" "$(run "$W")" "0"

# 🔴 格18:副檔名集收窄的證人(只留 .py 的話這一格會綠)。
W=$(world mjs)
( cd "$W" && git commit -qm base ) || die "commit mjs"
: > "$W/scripts/nobody.mjs" || die "touch mjs"
( cd "$W" && git add -A ) || die "stage mjs"
ck "格18 [該紅] .mjs 也在分母裡 ⇒ 沒歸屬要擋" "$(run "$W")" "1" "nobody.mjs"

# 🔴 格19:must-fix②的證人 —— 工作樹含換行檔名時, 整棵樹那一側也要出聲。
#    (舊版對這形狀是 exit 2, 而換掃描來源時這一道差點漏搬。)
W=$(world tree_newline)
: > "$W/scripts/$(printf 'tr\nee').py" || die "造樹上含換行檔名"
( cd "$W" && git add -A ) || die "stage tree_newline"
ck "格19 [exit2] 工作樹有含換行的檔名 ⇒ 2" "$(run "$W")" "2" "檔名含換行"

# 🔴 格20:孤兒清單要涵蓋【已在版控而沒歸屬】的, 不只未追蹤的。
W=$(world tracked_orphan)
: > "$W/scripts/tracked-but-unlisted.py" || die "touch tracked orphan"
( cd "$W" && git add -A && git commit -qm base ) || die "commit tracked orphan"
: > "$W/unrelated.txt" || die "touch unrelated4"
( cd "$W" && git add unrelated.txt ) || die "stage unrelated4"
rc=$(run "$W")
ck "格20 [訊息] 已在版控而沒歸屬的也要被講出來" \
   "$(grep -qF 'tracked-but-unlisted.py' "$OUT" && echo yes || echo no)" "yes"
ck "格20b [訊息] 而且要標出它是【已在版控】還是【未進版控】" \
   "$(grep -qF '已在版控' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格21:主視窗裁准的三行診斷 —— 「沒有歸屬」有四種世界而訊息本來一模一樣。
#    這一格餵的是【寫了但沒 git add package.json】那一種。
W=$(world diag_notstaged)
( cd "$W" && git commit -qm base ) || die "commit diag"
: > "$W/scripts/wrote-but-not-added.py" || die "touch diag script"
cat > "$W/package.json" <<'PJ' || die "寫工作樹 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true",
    "scripts/wrote-but-not-added.py": "true"
  }
}
PJ
( cd "$W" && git add scripts/wrote-but-not-added.py ) || die "stage diag script"
rc=$(run "$W")
ck "格21 [訊息] 四種世界要分得開:工作樹有而 staged 沒有 ⇒ 明說沒 git add" \
   "$(grep -qF '沒有 git add package.json' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格22/23:上面那兩道換行自檢(樹側 / staged 側)在格4 與格19 裡**互相遮蔽** ——
#    2026-08-25 突變矩陣實測:拿掉任一道, 一格都不紅。因為那兩格的檔案【同時】在樹上與 index 裡。
#    ⇒ 各給它一個只命中自己那一側的世界。
W=$(world newline_tree_only)
( cd "$W" && git commit -qm base ) || die "commit newline_tree_only"
: > "$W/scripts/$(printf 'on\nly-tree').py" || die "造只在樹上的換行檔名"
ck "格22 [exit2] 換行檔名【只在樹上、沒 staged】⇒ 樹側自檢要出聲" "$(run "$W")" "2" "工作樹檔數"

W=$(world newline_index_only)
( cd "$W" && git commit -qm base ) || die "commit newline_index_only"
: > "$W/scripts/$(printf 'on\nly-idx').py" || die "造換行檔名"
( cd "$W" && git add -A ) || die "stage newline_index_only"
rm -f "$W/scripts/$(printf 'on\nly-idx').py" || die "rm newline file"
ck "格23 [exit2] 換行檔名【只在 index、樹上已刪】⇒ staged 側自檢要出聲" "$(run "$W")" "2" "staged 檔數"

# ══ codex 那一輪補的 9 格 ═══════════════════════════════════════════════
# 🔴 格24:codex must-fix 1 的漏擋 —— 第一版放大到【工作樹】而不是【index】。
#    形狀:stage 刪白名單 + 工作樹刪掉那支腳本【但不 stage 刪檔】
#    ⇒ find 看不到它 ⇒ 放行, 而這顆 commit 實際上保留了那支腳本、只刪了它的白名單。
#    ⚠️ fixture 要另外留一支【還在樹上】的腳本 —— 不然刪掉 only.py 之後整棵樹是 0 支,
#       會撞到分母自檢而回 exit 2, 那一發量到的就不是這一格要問的事。
W=$(world widen_worktree_hole)
: > "$W/scripts/keeper.py" || die "touch keeper"
cat > "$W/package.json" <<'PJ' || die "寫含 keeper 的 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true",
    "scripts/keeper.py": "true"
  }
}
PJ
( cd "$W" && git add -A && git commit -qm base ) || die "commit widen hole"
cat > "$W/package.json" <<'PJ' || die "寫刪掉 only.py 條目的 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/keeper.py": "true"
  }
}
PJ
( cd "$W" && git add package.json ) || die "stage pkg widen"
rm -f "$W/scripts/only.py" || die "rm only.py(不 stage)"
ck "格24 [承重] 刪白名單 + 工作樹刪檔但不 stage ⇒ 仍要擋(index 裡還有它)" "$(run "$W")" "1" "only.py"

# 🔴 格25:codex must-fix 2 的誤擋 —— 無關的 package.json 改動不得讓未追蹤孤兒重新擋人。
#    那正是八窗事故的部分重演。
W=$(world pkg_unrelated)
( cd "$W" && git commit -qm base ) || die "commit pkg_unrelated"
cat > "$W/package.json" <<'PJ' || die "寫升版 package.json"
{
  "name": "fake",
  "version": "9.9.9",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
: > "$W/scripts/untracked-orphan.py" || die "touch untracked orphan"
( cd "$W" && git add package.json ) || die "stage pkg unrelated"
rc=$(run "$W")
ck "格25 [該綠] 無關的 package.json 改動 + 未追蹤孤兒 ⇒ 放行" "$rc" "0"
ck "格25b [訊息] 而那支孤兒仍要被提醒" \
   "$(grep -qF 'untracked-orphan.py' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格26:staged 刪除的腳本不得被要求登記(它就要不見了)。
W=$(world staged_deletion)
: > "$W/scripts/going-away.py" || die "touch going-away"
cat > "$W/package.json" <<'PJ' || die "寫含兩條的 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true",
    "scripts/going-away.py": "true"
  }
}
PJ
( cd "$W" && git add -A && git commit -qm base2 ) || die "commit staged_deletion"
( cd "$W" && git rm -q scripts/going-away.py ) || die "git rm going-away"
cat > "$W/package.json" <<'PJ' || die "寫刪掉那條的 package.json"
{
  "name": "fake",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
( cd "$W" && git add package.json ) || die "stage pkg deletion"
ck "格26 [該綠] 同時刪腳本與它的白名單 ⇒ 不得要求替它登記" "$(run "$W")" "0"

# 🔴 格27:codex must-fix 3 —— 全樹模式下不得說「就在你這顆 commit 要收的東西裡」。
W=$(world scope_msg)
: > "$W/scripts/long-standing-orphan.py" || die "touch long-standing"
( cd "$W" && git add -A && git commit -qm base3 ) || die "commit scope_msg"
cat > "$W/package.json" <<'PJ' || die "寫升版 package.json 2"
{
  "name": "fake",
  "version": "2.0.0",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
( cd "$W" && git add package.json ) || die "stage pkg scope"
rc=$(run "$W")
ck "格27 [該紅] 全樹模式 ⇒ 早就存在的 tracked orphan 要被擋" "$rc" "1" "long-standing-orphan.py"
ck "格27b [訊息] 而不得宣稱它是【你這次要收的】" \
   "$(grep -qF '就在【你這顆 commit 要收的東西】裡' "$OUT" && echo yes || echo no)" "no"
ck "格27c [訊息] 要改講【射程是全樹】" \
   "$(grep -qF '白名單的射程是全樹' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格28:三行診斷的第二種世界 —— 檔案已經不在工作樹而還在 index。
W=$(world diag_gone)
( cd "$W" && git commit -qm base ) || die "commit diag_gone"
: > "$W/scripts/moved-away.py" || die "touch moved-away"
( cd "$W" && git add scripts/moved-away.py ) || die "stage moved-away"
rm -f "$W/scripts/moved-away.py" || die "rm moved-away"
rc=$(run "$W")
ck "格28 [訊息] 檔案不在工作樹了 ⇒ 明說可能要 git rm --cached" \
   "$(grep -qF 'git rm --cached' "$OUT" && echo yes || echo no)" "yes"
ck "格28b [訊息] 三個狀態值要都印出來(兩個世界會印不同的東西)" \
   "$(grep -qF '檔案現在:不在了' "$OUT" && echo yes || echo no)" "yes"

# 🔴 格29:孤兒超過上限時 —— 只列 5 支、剩餘數正確、印在摘要【之後】。
W=$(world many_orphans)
( cd "$W" && git commit -qm base ) || die "commit many_orphans"
for i in 1 2 3 4 5 6 7; do : > "$W/scripts/orphan-$i.py" || die "touch orphan-$i"; done
: > "$W/unrelated.txt" || die "touch unrelated5"
( cd "$W" && git add unrelated.txt ) || die "stage unrelated5"
rc=$(run "$W")
ck "格29 [訊息] 孤兒 7 支 ⇒ 只列 5 支並說還有 2 支" \
   "$(grep -qF '還有 2 支' "$OUT" && echo yes || echo no)" "yes"
ck "格29b [訊息] 而那句「要列全」的命令必須真的列得全" \
   "$(grep -qF -- '--list-orphans' "$OUT" && echo yes || echo no)" "yes"
ck "格29c [該綠] 孤兒再多也不擋" "$rc" "0"
# 🔴 格30/31:上面那兩格只驗「訊息裡有那串字」⇒ 拿掉上限或拿掉 --list-orphans **都不會紅**
#    (2026-08-25 突變矩陣實測)。這兩格改成**數實際列出幾支**。
_listed=$(grep -cE '^ +· scripts/orphan-[0-9]+\.py' "$OUT")
ck "格30 [訊息] 預設只列 5 支(實得 $_listed)" "$_listed" "5"
rc=$(run_args "$W" --list-orphans)
_listed_all=$(grep -cE '^ +· scripts/orphan-[0-9]+\.py' "$OUT")
ck "格31 [訊息] --list-orphans 要真的列全 7 支(實得 $_listed_all)" "$_listed_all" "7"
ck "格31b [該綠] --list-orphans 只是列印, 不改判定" "$rc" "0"

# 🔴 格32:codex R2 F2 —— 全樹模式下真正拿來擋人的是 `idx.z`, 而那一份原本【沒有】換行自檢
#    (現有兩道量的是工作樹與 staged diff)。這一格讓含換行的路徑只出現在 index 全樹那條路上。
W=$(world idx_newline)
: > "$W/scripts/$(printf 'id\nx').py" || die "造 index 換行檔名"
( cd "$W" && git add -A && git commit -qm base ) || die "commit idx_newline"
cat > "$W/package.json" <<'PJ' || die "寫升版 package.json 3"
{
  "name": "fake",
  "version": "3.0.0",
  "lint-staged": {
    "scripts/only.py": "true"
  }
}
PJ
( cd "$W" && git add package.json ) || die "stage pkg idx_newline"
ck "格32 [exit2] 全樹模式 + index 裡有含換行的路徑 ⇒ 2" "$(run "$W")" "2" "index 檔數"

echo "  ── harness: $pass PASS / $fail FAIL"
# 🔴 codex R1 must-fix:只驗 fail=0 ⇒ 整格被刪掉仍 exit 0,而檔頭卻寫著「N 格全 PASS」。
# 🔴 格數守門比的是【跑過幾格】(pass+fail),不是【過了幾格】(pass)——
#    2026-08-21 R3(W3)實測:讓某一格正確翻紅 ⇒ 17 PASS / 1 FAIL,而**格數其實還是 18**,
#    舊寫法卻印「格數不對:有格被刪掉或沒跑到」⇒ **診斷指錯方向**,
#    而它印在「17 PASS / 1 FAIL」之後 ⇒ 讀的人最後看到的是錯的那一句。
#    「一格失敗」與「一格不見了」修法完全不同,不能共用同一個出口。
EXPECT=47
if [ "$((pass + fail))" != "$EXPECT" ]; then
  echo "  🔴 【格數】不對:跑了 $((pass + fail)) 格 ≠ $EXPECT ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)"
  exit 1
fi
if [ "$fail" != "0" ]; then exit 1; fi
exit 0
