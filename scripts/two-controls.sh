#!/usr/bin/env bash
# two-controls.sh —— 量一個字面時,把【兩把對照】一起印出來。
#
# 🔴 為什麼有這支(2026-08-30 一晚踩八次之後做的):
#    那一晚每一次量錯,輸出看起來都完全正常 —— 而共通形狀是
#    **尺用了別的地方的字彙 / 掃了錯的檔** ⇒ 它印一個乾淨的 0。
#
# 🔴🔴 **而【負對照擋不到那一種】—— 這支檔存在的理由就是這一句:**
#    尺壞掉時,負對照【照樣印 0】,與「真的沒有」一模一樣。
#    當場實測(同一份資料):
#      尺對、目標在   ⇒ 命中 2 / 負對照 0    ← 分得開
#      尺錯(掃錯檔)  ⇒ 命中 0 / 負對照 0    ← **分不開**
#    ⇒ 📌 **抓得到「尺壞了」的是【正對照】,不是負對照。**
#    ⇒ 所以本支【強制】你給一個正對照,不給就不跑。
#
# 🔵 而負對照仍然要有,它擋的是另一件事(尺太寬 / 恆真)——
#    它是【現造的】:每次執行都不一樣,所以
#    **它從來沒有存在於任何檔案裡 ⇒ 沒有人寫得進去 ⇒ 不會自殺。**
#    (那一晚三個寫死的負對照字串全部因為被寫進板子而失效。)
#
# 用法:
#   bash scripts/two-controls.sh [--regex] <要量的純字串> <正對照> <檔或目錄...>
#   🔴 預設 = 純字串(`grep -F`)。**要正規式一定要加 `--regex`** —— 不加的話 `( ) * . [ ]` 都是字面。
# 例:
#   bash scripts/two-controls.sh 'heartbeat' 'emailOverdue' packages/use-cases/src/check-anomaly-alerts.ts
#
# 🛑 射程:它答不出「這個 pattern 是不是對的字彙」—— 那正是正對照要你自己想的那一格。
#
# 🔴🔴 **它擋不住什麼(2026-08-31 `-08` 各給一個實例, 逐字寫在這裡, 不要只寫它擋得住什麼)**:
#   ① **拿一把「量錯東西」的尺跑它** —— `-08` 用一把粗糙的 CSS/TS 分類尺跑出
#      命中 496 / 正對照 62 / 負對照 0 ⇒ **三個數字全部健康, 而它分類分錯了。**
#      ⇒ 本工具只驗「尺有沒有接上」與「字被讀成什麼」, **不驗那把尺量的是不是你要的東西。**
#   ② **兩邊各自正常運作而【比錯東西】** —— `-08` 今晚最大的一個假數字(1169)不是 grep 的錯,
#      是兩個都對的數字被放在一起比較, 而它們不是同一種東西。**本工具對「比錯東西」完全失明。**
#   📌 **⇒ 一支工具的檔頭若只寫它擋得住什麼, 讀的人會把「它沒說的」當成「它守著的」。**
#   ③ **計數相同而命中【不同的檔】** —— 一個檔含 `a\.b`、另一個含 `a.b`, pattern `a\.b`
#      ⇒ 兩種讀法各命中 1 個, 而是【互斥的兩個檔】。**所以第三把對照比的是檔名清單, 不是數字。**
#      📌 R1 抓到的:第一版比總和 ⇒ 這一族會靜音。
#   ④ **它不知道你要純字串還是 regex** —— 預設當純字串;猜錯的那一半只能靠你加 `--regex`。
#      它只會出一句提示、不擋你 ⇒ **提示是給看的人的, 它擋不住不看的人。**
set -u

if [ "${1:-}" = "--selftest" ]; then
  d=$(mktemp -d); printf 'alpha\nbravo\n' > "$d/f.txt"
  ok=1
  out=$(bash "$0" alpha bravo "$d/f.txt" 2>&1) || ok=0
  echo "$out" | grep -q '^命中 *= *1' || { echo "🔴 selftest: 命中應為 1"; ok=0; }
  echo "$out" | grep -q '^正對照 *= *1' || { echo "🔴 selftest: 正對照應為 1"; ok=0; }
  echo "$out" | grep -q '^負對照 *= *0' || { echo "🔴 selftest: 負對照應為 0"; ok=0; }
  # 世界二:正對照【撈不到】⇒ 必須 rc=2 並出聲
  bash "$0" alpha zzz-not-present "$d/f.txt" >/dev/null 2>&1; rc=$?
  [ "$rc" = "2" ] || { echo "🔴 selftest: 正對照 0 命中時應 rc=2, 實得 $rc"; ok=0; }
  # 世界三:缺參數 ⇒ rc=2
  bash "$0" alpha >/dev/null 2>&1; rc=$?
  [ "$rc" = "2" ] || { echo "🔴 selftest: 缺參數應 rc=2, 實得 $rc"; ok=0; }
  # 世界四(2026-08-31 R1 之後重寫):**兩種讀法命中【不同的檔】⇒ 必須出聲那一句**
  #   🔴 這是本工具自己犯過的 bug 的回歸案例:餵 'replace(/\/\*' 曾經印「命中 0」而真相是 7 支。
  #   🔴 **而它斷言的是【哪一句話】, 不是 rc**(R1 must-fix 3):`a.c`/`abc` 那一發有三條路都會回 2
  #      (元字元、正對照 0、負對照非 0)⇒ **只斷言 rc 的話, 它紅在哪一格是資料湊巧。**
  #   ⚠️ 現在預設是純字串 ⇒ 這一格【不再 rc=2】, 它回 0 而出一句提示。**改尺之後回歸案例的期望值也要跟著改 ——**
  #      **而多數人改完只看「現在全綠了」, 那個綠正是因為那一格不再測任何東西。**
  printf 'abc\n' > "$d/meta.txt"
  out4=$(bash "$0" 'a.c' 'abc' "$d/meta.txt" 2>&1); rc=$?
  echo "$out4" | grep -q '當 regex 讀會命中' || { echo "🔴 selftest: 兩種讀法不同時應出聲, 實得: $out4"; ok=0; }
  [ "$rc" = "0" ] || { echo "🔴 selftest: 純字串模式下這不是錯誤, 應 rc=0, 實得 $rc"; ok=0; }
  # 世界五:**沒有元字元的 pattern 不可以被那一句誤傷**(否則它對每一發都出聲 ⇒ 等於沒出聲)
  out5=$(bash "$0" alpha bravo "$d/f.txt" 2>&1); rc=$?
  echo "$out5" | grep -q '當 regex 讀會命中' && { echo "🔴 selftest: 乾淨 pattern 不該出那一句(太寬)"; ok=0; }
  [ "$rc" = "0" ] || { echo "🔴 selftest: 乾淨 pattern 應 rc=0, 實得 $rc"; ok=0; }
  # 世界六:**--regex 是出口** —— 明講之後不再叫他去加 --regex
  out6=$(bash "$0" --regex 'a.c' 'a.c' "$d/meta.txt" 2>&1); rc=$?
  echo "$out6" | grep -q '你自己明講的' || { echo "🔴 selftest: --regex 應走明講分支, 實得: $out6"; ok=0; }
  [ "$rc" = "0" ] || { echo "🔴 selftest: --regex 正當用法應 rc=0, 實得 $rc"; ok=0; }
  rm -rf "$d"
  [ "$ok" = "1" ] && { echo "✅ selftest PASS(六個世界印不同的東西)"; exit 0; }
  echo "🔴 selftest FAIL"; exit 1
fi

# 🔴 預設【純字串】。要 regex 就明講 —— 而「明講」這件事本身就是這個旗標的用途:
#    它把「這串字要被讀成什麼」從一個【猜】變成一個【你打出來的字】。
MODE=F
if [ "${1:-}" = "--regex" ]; then MODE=R; shift; fi

if [ "$#" -lt 3 ]; then
  echo "用法: bash scripts/two-controls.sh [--regex] <要量的純字串> <正對照> <檔或目錄...>" >&2
  echo "     預設把 pattern 當【純字串】(grep -F)。要正規式 ⇒ 加 --regex。" >&2
  echo "🔴 正對照【不是選配】—— 沒有它，一個壞掉的尺與『真的沒有』印同一個 0。" >&2
  exit 2
fi

TARGET="$1"; POS="$2"; shift 2

# 🔴 **排除建置產物 —— 2026-08-30 首次真實使用時當場撞到的。**
#    用它掃「沒有任何機制在」⇒ 它回 **27**,而我自己帶 `--include` 的那一發回 **20**。
#    差的 7 個全在 `apps/admin/.next/**/*.js.map` —— **那是我自己那些註解被編譯進 sourcemap 的【複本】。**
#    ⇒ 📌 **同一段文字被數了兩次:一次是原稿,一次是它的建置產物。**
#    🔴🔴 **而那一發的兩個對照【都是好的】** —— 正對照 124、負對照 0。
#       ⇒ **錯的不是 pattern,是【掃描集合】。而兩把對照都量不到掃描集合。**
#       ⇒ 這是本工具自己的第三種失效,與它防的前兩種不同。
EXCLUDES=(--exclude-dir=.next --exclude-dir=node_modules --exclude-dir=.git
          --exclude-dir=dist --exclude-dir=coverage --exclude-dir=.turbo
          --exclude-dir=.vercel --exclude-dir=graphify-out --exclude=*.map)

# 🔴 現造:每次執行都不一樣 ⇒ 它不可能已經在任何檔案裡
NEG="negctl-$(date +%s)-$$-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# 🔴🔴 **預設【純字串】(`-F`), regex 要明講 `--regex`**(2026-08-31 R1 must-fix 2 之後改的)
#    原本兩種讀法都跑、不同就 rc=2 ⇒ **它會擋掉正當的 regex 用法, 而且沒有出口**
#    (實測 `use[A-Z]` / `from .@/lib` / `a.b` 三個正當 regex 全被判 rc=2, 而註解叫人「確認元字元」——
#     確認完照樣 rc=2)。📌 **一個沒有出口的紅, 會教人略過它的紅。**
# ⚠️ 陣列不能是空的:macOS 的 bash 3.2 在 `set -u` 下對空陣列展開會報 unbound(實測踩到)
#    ⇒ 兩邊都給非空內容, 用 `-e` 明示 pattern(順帶讓以 `-` 開頭的 pattern 也安全)
if [ "$MODE" = "F" ]; then GF=(-F -e); else GF=(-e); fi
c_target=$(grep -rc "${EXCLUDES[@]}" "${GF[@]}" "$TARGET" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
c_pos=$(grep -rc "${EXCLUDES[@]}" "${GF[@]}" "$POS" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
c_neg=$(grep -rc "${EXCLUDES[@]}" "${GF[@]}" "$NEG" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')

printf '命中   = %s   (%s%s)\n' "$c_target" "$TARGET" "$([ "$MODE" = "F" ] && echo '  ·純字串' || echo '  ·regex')"
printf '正對照 = %s   (%s)\n' "$c_pos" "$POS"
printf '負對照 = %s   (現造 %s)\n' "$c_neg" "$NEG"
# 🔴 掃描集合要有分母 —— 否則「它到底掃了什麼」是一個沒有人看得到的決定
n_files=$(grep -rl "${EXCLUDES[@]}" -- '' "$@" 2>/dev/null | wc -l | tr -d ' ')
printf '掃了   = %s 個檔(已排除 .next / node_modules / dist / *.map 等建置產物)\n' "${n_files:-?}"
# ⚠️ 本工具【不排除它自己】—— 若你搜的字剛好寫在本檔的註解裡,它會把自己算進去。
#    2026-08-30 首次使用當場發生:搜「沒有任何機制在」⇒ 多算 1,那一筆就是本檔。
#    📌 不自動排除是刻意的:**安靜地把自己從分母拿掉,比多算一筆更難發現。**
# ⚠️ 而「掃了 N」是用【本腳本拿到的那個 grep】數的。**你自己 shell 的 grep 可能不是同一支**
#    (本機互動 shell 的 `grep` 是 ugrep 殼、帶 `--ignore-files --hidden`;腳本拿到的是 /usr/bin/grep)
#    ⇒ **拿你的 grep 回頭核這個 N, 兩邊分母天生不同, 而它零訊號。**(2026-08-31 R1 nit 8 實量)

# 🔴 第三把對照 —— 它問的【不是】「尺接上了嗎」, 是【我打的字被讀成我想的那樣了嗎】。
#    ⚠️ **比的是【命中哪些檔】不是【幾筆】**(R1 must-fix 1 實錘):
#    一個檔含 `a\.b`、另一個含 `a.b`, pattern `a\.b` ⇒ 兩種讀法【各命中 1 個, 而是互斥的兩個檔】
#    ⇒ 比總數會印「1 vs 1」然後靜音。**計數相同不代表讀法相同。**
lf=$(grep -rlF "${EXCLUDES[@]}" -- "$TARGET" "$@" 2>/dev/null | sort | tr '\n' ' ')
lr=$(grep -rl  "${EXCLUDES[@]}" -- "$TARGET" "$@" 2>/dev/null | sort | tr '\n' ' ')

rc=0
if [ "$lf" != "$lr" ]; then
  nf=$(printf '%s' "$lf" | wc -w | tr -d ' '); nr=$(printf '%s' "$lr" | wc -w | tr -d ' ')
  if [ "$MODE" = "F" ]; then
    echo "ℹ️  這串字當 regex 讀會命中【不同的檔】(純字串 $nf 支 / regex $nr 支)。" >&2
    echo "   本次是【純字串】的答案, 那是正確的答案 —— 除非你本來就想要 regex ⇒ 那要加 --regex。" >&2
  else
    echo "ℹ️  你用了 --regex。同一串字當純字串讀會命中不同的檔(純字串 $nf 支 / regex $nr 支)。" >&2
    echo "   本次是【regex】的答案, 你自己明講的 ⇒ 不擋。" >&2
  fi
fi
# 🔴 正對照要在【你實際採用的那個讀法】裡非 0(R1 nit 7)—— 不是在另一個讀法裡
if [ "$c_pos" -eq 0 ]; then
  echo "🔴 正對照 0 命中 ⇒ 這把尺【沒有接上】—— 本次的『命中 $c_target』不算數。" >&2
  rc=2
fi
if [ "$c_neg" -ne 0 ]; then
  echo "🔴 負對照非 0 ⇒ 這把尺太寬(或 grep 參數被吃掉) ⇒ 結果作廢。" >&2
  rc=2
fi
exit "$rc"
