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
  echo "$d"
}
run() { ( cd "$1" && sh .husky/gate.sh > "$OUT" 2>&1 ); echo $?; }

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
W=$(world extra); : > "$W/scripts/orphan.py" || die "touch orphan"
ck "格2 [負] 多一支未列管 ⇒ 1" "$(run "$W")" "1" "orphan.py"

# ── 格3 [exit 2] 分母是 0:scripts/ 在,但一支都掃不到 ──────────
#    🔴 這正是「零次迴圈然後 exit 0」那個失效形狀 —— 必須與「乾淨」分得開。
W=$(world empty); rm -f "$W/scripts/only.py"; : > "$W/scripts/keep.txt" || die "touch keep.txt"
ck "格3 [exit2] 分母 0 ⇒ 2,不是 0" "$(run "$W")" "2" "分母是 0"

# ── 格4 [exit 2] 檔名含換行 ⇒ 逐行比對會漏擋 ──────────────────
W=$(world newline)
: > "$W/scripts/$(printf 'we\nird').py" || die "造含換行檔名"
ck "格4 [exit2] 檔名含換行 ⇒ 2" "$(run "$W")" "2" "檔名含換行"

# ── 格5 [exit 2] 抽不出 lint-staged 區塊 ──────────────────────
W=$(world nols)
printf '{\n  "name": "fake"\n}\n' > "$W/package.json" || die "寫無 lint-staged 的 package.json"
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
W=$(world lastline); : > "$W/scripts/orphan-XYZ.py" || die "touch orphan-XYZ"
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

echo "  ── harness: $pass PASS / $fail FAIL"
# 🔴 codex R1 must-fix:只驗 fail=0 ⇒ 整格被刪掉仍 exit 0,而檔頭卻寫著「N 格全 PASS」。
# 🔴 格數守門比的是【跑過幾格】(pass+fail),不是【過了幾格】(pass)——
#    2026-08-21 R3(W3)實測:讓某一格正確翻紅 ⇒ 17 PASS / 1 FAIL,而**格數其實還是 18**,
#    舊寫法卻印「格數不對:有格被刪掉或沒跑到」⇒ **診斷指錯方向**,
#    而它印在「17 PASS / 1 FAIL」之後 ⇒ 讀的人最後看到的是錯的那一句。
#    「一格失敗」與「一格不見了」修法完全不同,不能共用同一個出口。
EXPECT=14
if [ "$((pass + fail))" != "$EXPECT" ]; then
  echo "  🔴 【格數】不對:跑了 $((pass + fail)) 格 ≠ $EXPECT ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)"
  exit 1
fi
if [ "$fail" != "0" ]; then exit 1; fi
exit 0
