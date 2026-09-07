#!/usr/bin/env bash
# board-row-by-anchor.sh —— 用【錨欄】定位板上那一列, 不用行號、不用整行 grep。
#
# 它解的兩個病(規格 ~/pcm-mailbox/規格-board-row-by-anchor-20260902.md, 線 -7d 2026-09-02):
#   ① 行號會漂, 而漂移量【不固定】(實量 0/+1/+2/+3/+4/+5, 六列六個值)
#      ⇒ 每一列各漂各的, 而每一列看起來都正常 ⇒ 不能用「加 N」回推。
#   ② 用【整行】grep 一個錨 ⇒ 會撈到【只是引用那個錨】的列。
#      而「引用它的列」與「是它的列」在整行 grep 上完全一樣。
#      實量:b4-SHIPGATE1 整行 grep 10 列 / 錨欄 2 列 ⇒ 8 個假陽性, 而第一個讀起來完全正常。
#
# 🔴🔴 **而錨欄【本身】也會有假陽性 —— 判別式在這裡**(2026-09-07 主視窗轉 front 實例, :1566):
#
#       ⟦x-FOO⟧        ← 沒有反引號 ⇒ **這是那一列**(資料列)
#       `⟦x-FOO⟧`      ← 有反引號   ⇒ **這是【提到】那一列**(引用列)
#
#   為什麼會混進錨欄:合併/整併時, 一列的錨欄可能被寫成
#   「`⟦x-FOO⟧` 的正本在下面」這種**帶反引號的引用**, 而本工具比對的是【子字串】
#   ⇒ 兩者都命中, 而**它們讀起來一模一樣**。
#   ⇒ ⛔ ~~**判別句:錨欄裡那個錨【不帶反引號】才是它自己;帶反引號的是在講別人。**~~
#   ⇒ 🔴 **2026-09-07 訂正(主視窗拍甲;`-ship` 量到才改)** —— 那句話讓 **84 列查不到自己**:
#      當場數全板 932 列 ⇒ 錨欄帶反引號 **89** 列, 其中 **84** 列的錨欄【整欄就只有那一個反引號錨】
#      (⇒ 那是它自己的錨, 只是寫的時候包了反引號), 只有 **5** 列欄裡還有別的東西。
#      ⚪ 正對照 錨欄裸錨 548 列 · 🔴 負對照 錨欄含現造字 0 列。
#   ✅ **現行判別句:整欄只有一個反引號錨 ⇒ 當成它自己的;欄裡還有別的東西 ⇒ 那些反引號段仍然剝掉。**
#      📌 一個從【一個】真實例推出來的規則, 射程會蓋過它要解的那件事。
#   🛑 本工具**不自動過濾** —— 因為過濾錯會讓一列永久消失, 比多印一列糟。
#      它改成:命中多列時把每一列的錨欄原文印出來, 讓你自己看得到反引號。
#
# rc:  0 = 命中 1 列或多列 · 3 = 查無 · 2 = 用法錯 · 1 = 工具自壞
set -uo pipefail

BOARD_DEFAULT="docs/launch-todo.md"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat >&2 <<'USAGE'
用法:
  bash scripts/board-row-by-anchor.sh <錨> [板檔]     # 例:b4-CAPNULLDEAD(不必帶 ⟦⟧)
  bash scripts/board-row-by-anchor.sh --regex <樣式> [板檔]
  bash scripts/board-row-by-anchor.sh --cells <錨> [板檔]    # 唯讀印五欄(pipe-aware)
  bash scripts/board-row-by-anchor.sh --selftest
預設【純字串】比對;要正規式才加 --regex。
USAGE
}

# 只比對錨欄($3), 印「行號 · 態 · 錨欄原文」。
lookup() {
  local anchor="$1" board="$2" mode="$3"
  awk -F'|' -v a="$anchor" -v m="$mode" '
    NF > 4 {
      # 🔴 比對前先把錨欄裡【被反引號包住的那一段】剝掉 —— 那是「提到別人」不是「是它自己」。
      #    剝的是【那一段】不是整列 ⇒ 一列若自己也有錨, 它的錨不帶反引號 ⇒ 照樣命中, 不會消失。
      #    (2026-09-07 front 在 :1566 差點命中兩列 ⇒ 主視窗轉。)
      probe = $3
      # 🔴 全形空白也要剝 —— 只剝 ASCII 空白時, 一個用全形空白排版的錨欄會落回舊行為
      #    (code-reviewer 2026-09-07 nit;今天板上 col3 零命中, 而「今天沒有」不是理由)。
      gsub(/^[ \t　]+|[ \t　]+$/, "", probe)
      # 🔴 判別式 2026-09-07 二版:先把【所有】反引號去掉, 再問「剩下的是不是【正好一個錨】」。
      #    ⛔ ~~一版只認「正好一對反引號」~~ ⇒ 三對以上(``` `⟦x⟧` ```)會掉進 else 被整段吃掉,
      #    而那時 lookup 與 fallback 【兩邊都 0】= 一個徹底的假查無(code-reviewer 抓到)。
      #    ✅ 二版對 0 對 / 1 對 / N 對一律成立, 而它問的是同一件事:這一欄是不是就只有它自己的錨。
      _d = probe; gsub(/`/, "", _d)
      _ok = (length(_d) >= 7) && (index(_d, "\342\237\246") == 1) && (substr(_d, length(_d) - 2) == "\342\237\247")
      if (_ok) {
        _mid = substr(_d, 4, length(_d) - 6)
        if (index(_mid, "\342\237\246") > 0 || index(_mid, "\342\237\247") > 0) _ok = 0
      }
      if (_ok) {
        probe = _d
      } else {
        # 欄裡還有別的東西 ⇒ 那些反引號段是「在講別人」, 照舊剝掉。
        gsub(/`[^`]*`/, "", probe)
      }
      hit = (m == "regex") ? (probe ~ a) : (index(probe, a) > 0)
      if (hit) {
        state = $2; col = $3
        gsub(/^[ \t]+|[ \t]+$/, "", state)
        gsub(/^[ \t]+|[ \t]+$/, "", col)
        # 🔴 態是【封閉集】。分隔線【下面】那張表的第 2 欄不是態(實測印出 `731`)
        #    ⇒ 而一個看起來像狀態碼的數字, 讀的人會當成某種態。
        #    ⇒ 不在封閉集 ⇒ 印 `—` 並標「不在主表」, 而不是把原值端出去。
        # 🔴 2026-09-07 補 standing:板上實有 3 列 standing, 而本白名單漏了它
        #    ⇒ 它們一律被印成「—(不在主表)」—— 而那句話讀起來像【這一列不在板上】。
        #    📌 同一份板, launch-blocking-count.sh 認得 standing(數得出 standing 共 3)
        #    ⇒ 兩把尺對同一列給不同答案, 而不一致的那一邊印的是一個【看起來像查無的東西】。
        if (state != "open" && state != "done" && state != "doing" && state != "parked" && state != "standing") {
          state = "—(不在主表)"
        }
        printf "%s\t%s\t%s\n", NR, state, col
      }
    }
  ' "$board"
}

# 🔴 查無時要多答一個數:【錨欄裡, 那個錨被反引號包著】的列有幾列。
#    為什麼(主視窗 2026-09-07 轉 B 的實例, `:2065` 與 `c7-BACKOFFCAPSYNC` 兩列同型):
#    印一個孤零零的 0 時,「板上真的沒有」與「有而它被反引號規則剝掉了」是【同一個畫面】。
#    ⇒ 這個數 >0 ⇒ 讀的人立刻知道要去看那幾列的錨欄長什麼樣, 而不是去開新列。
count_backticked() {
  awk -F'|' -v a="$1" '
    NF > 4 {
      c = $3
      while (match(c, /`[^`]*`/)) {
        seg = substr(c, RSTART, RLENGTH)
        if (index(seg, a) > 0) { n++; break }
        c = substr(c, RSTART + RLENGTH)
      }
    }
    END { print n + 0 }' "$2"
}

# 對照用:整行比對, 只回列數 —— 它就是本工具要廢掉的那把尺。
count_wholeline() {
  local anchor="$1" board="$2"
  awk -v a="$anchor" 'index($0, a) > 0 { n++ } END { print n + 0 }' "$board"
}

# 分母:板上共幾列資料列。查無時要印它 —— 否則「尺沒接上」與「真的沒有」印同一個 0。
count_rows() {
  awk -F'|' 'NF > 4 { n++ } END { print n + 0 }' "$1"
}

# 🔴🔴 **退回檔:錨【不在錨欄】的那些列(2026-09-03 線 -auth 加)**
#
#   病灶:本工具原本錨欄查無就印「查無」收工。而板上**每 3 列就有 1 列**的錨
#   寫在【標題欄】不在錨欄(2026-09-03 實量:資料列 674 / 錨在錨欄 329 /
#   錨只在別欄 147 / 整列無錨 198;主視窗同日另量得 625/330/143/152 ——
#   🔵 **兩把尺的資料列定義不同, 兩個數都列著, 不挑一個看起來對的**;
#   而「每 3 列有 1 列」這個量級兩邊一致)。
#
#   🛑 **後果有名字**:一個窗拿錨來查 ⇒ 印「查無」⇒ 合理的讀法是「板上沒有這一列」
#     ⇒ 它去開一列新的, 做一件已經有人記過的事。
#     ⇒ 那正是 Sean 2026-09-02 親口點名的六個病之一:「做到一陣子才發現之前做過了」。
#   📌 **⇒ 失效時它印的是「查無」, 而那跟「這件事不存在」是同一個字。**
#
#   ✅ 修的是【工具】不是那 147 列:①動 147 列的爆炸半徑遠大於它解的問題
#     ②錨寫在標題裡往往是刻意的(標題本來就在講那個錨)③改列 = 改別人的內容。
#   🛑 **而退回來的結果【不等於】錨欄命中** —— 整行比對會撈到「只是引用那個錨」的列,
#     所以它一定要帶著那句警告一起印, 不可以靜靜地混進正常輸出。
lookup_fallback() {
  local anchor="$1" board="$2" mode="$3"
  awk -F'|' -v a="$anchor" -v m="$mode" '
    NF > 4 {
      inrow = (m == "regex") ? ($0 ~ a) : (index($0, a) > 0)
      incol = (m == "regex") ? ($3 ~ a) : (index($3, a) > 0)
      if (inrow && !incol) {
        state = $2; title = $4
        gsub(/^[ \t]+|[ \t]+$/, "", state)
        gsub(/^[ \t]+|[ \t]+$/, "", title)
        if (state != "open" && state != "done" && state != "doing" && state != "parked" && state != "standing") {
          # 🔴 awk 不認 `\u` 跳脫 ⇒ 原本這裡逐字印出 `u2014(不在主表)`(2026-09-07 `-ship` 撞到)。
          #    ⇒ 直接寫那個字, 與上面 lookup() 那條同形。
          state = "—(不在主表)"
        }
        if (length(title) > 90) { title = substr(title, 1, 90) "…" }
        printf "%s\t%s\t%s\n", NR, state, title
      }
    }
  ' "$board"
}

run_query() {
  local anchor="$1" board="$2" mode="$3"
  [ -r "$board" ] || { echo "🛑 讀不到板檔:$board" >&2; return 1; }

  local out n
  out="$(lookup "$anchor" "$board" "$mode")"
  n="$(printf '%s' "$out" | grep -c . || true)"

  if [ "$n" -eq 0 ]; then
    local fb fbn
    fb="$(lookup_fallback "$anchor" "$board" "$mode")"
    fbn="$(printf '%s' "$fb" | grep -c . || true)"

    if [ "$fbn" -eq 0 ]; then
      echo "⇒ 查無:$anchor(錨欄 0 列 · 整行比對 0 列)"
      echo "   🔵 分母:本板共 $(count_rows "$board") 列資料列 —— 印出來是為了讓你看見【尺有接上】。"
      echo "      (只印一個 0 的話, 「尺壞了」與「真的沒有」是同一個畫面。)"
      # 🛑 這裡【不】印「錨欄反引號段命中幾列」—— 它在這條路徑上結構性恆為 0:
      #    錨若在錨欄裡(不論有沒有反引號), 整行比對一定也會命中 ⇒ 就不會走到這一段。
      #    ⇒ 那個數要印在【退回路徑】那邊。(2026-09-07 `-ship` 第一版寫錯位置。)
      print_scope
      return 3
    fi

    # 🔴🔴 **錨欄查無時【不給替代答案】**(主視窗 `-f1` 2026-09-07 令;mail 實錘 `⟦f3-REDNEEDSEXIT⟧`:
    #    本工具當時錨欄查無 ⇒ 退回整行比對 ⇒ **印出 `:1102`(車款搜尋那列)當答案**,
    #    而那一列看起來完全像答案。📌 **端一列別的出去, 比印查無糟得多 —— 查無會讓人再找,
    #    而一個看起來對的答案會讓人停止找。**)
    #    ⇒ 只印【數】與一句明說「不是它那一列」, 不印任何行號。
    echo "⚠️⚠️ 錨欄查無 —— 而【整行提到 $fbn 列】(僅供參考, **不是它那一列**)。"
    # 🔴 主視窗 2026-09-07 指定的第二個數:錨欄裡【被反引號包住那一段】命中幾列。
    #    為什麼:「錨欄查無」有兩種成因, 而它們印同一句話 ——
    #    ①那個錨真的不在任何一列的錨欄 ②在, 而它被寫成反引號形式、被本工具剝掉了。
    _bt_n="$(count_backticked "$anchor" "$board")"
    if [ "${_bt_n:-0}" -gt 0 ]; then
      echo "🔴 而【錨欄裡被反引號包住的那一段】命中 $_bt_n 列 ⇒ 這裡的「錨欄查無」不是「不在錨欄」,"
      echo "   是那幾列把它寫成了反引號形式(= 本工具讀成「在講別人」)⇒ 先開那幾列看錨欄原文。"
    else
      echo "⚪ 錨欄的反引號段命中 0 列 ⇒ 這一發的「錨欄查無」不是被反引號規則吃掉的。"
    fi
    echo "🛑 本工具【不把那幾列印出來】—— 它們是「提到這個錨的列」, 不是「這個錨那一列」,"
    echo "   而兩者在整行比對上完全一樣(實量:b4-SHIPGATE1 整行 10 列 / 錨欄 2 列 ⇒ 8 個假陽性)。"
    echo "   ⇒ 要自己找 ⇒ 跑 grep -n '<錨>' 那支板, 逐列開檔;本工具不替你挑。"
    echo "🔵 對照:整行比對 $(count_wholeline "$anchor" "$board") 列 · 錨欄 0 列 · 本板共 $(count_rows "$board") 列"
    print_scope
    return 0
  fi

  printf '行號\t態\t錨欄\n'
  printf '%s\n' "$out"
  echo "🟢 錨欄命中 —— 這是本工具最強的那一種答案(不經整行比對)。"
  # 🔴 命中之後【先給末格尾端】—— 見 print_tail_then_row 檔內那段成因
  printf '%s\n' "$out" | while IFS="$(printf '\t')" read -r _ln _st _col; do
    [ -n "$_ln" ] && print_tail_then_row "$board" "$_ln"
  done
  if [ "$n" -ge 2 ]; then
    echo "🔴 多列($n)—— 你要自己看是哪一列。本工具不替你挑第一列。"
  fi
  echo "🔵 對照:整行比對 $(count_wholeline "$anchor" "$board") 列 · 錨欄 $n 列"
  print_scope
  return 0
}

# ── 先印【末格尾端】再印整列(2026-09-07 主視窗令;機制優先律)──────────────
# 🔴 **成因是一次真的重工**:tidy 為了做 ⟦f3-ALLOWLISTMANUAL1⟧ 那一列**開了那一列**,
#    而**讀的是列的開頭** ⇒ 花 40 分鐘做了一支閘,
#    **而答案寫在那一列的末格【尾端】**(逐字「從今天起會被擋在 commit 之前」+ 三個當日讀數),
#    那道閘 40 分鐘前就有人做好並接進 `.husky/pre-commit` 了。
# 📌 **板列的末格是【最新的】—— 而它也是最長的, 所以最容易只讀開頭。**
# ⇒ 本工具改成:**尾端先出場**, 標「最新」;整列排在它後面。
# 🛑 **短列不重印** —— 尾端已等於整列時再印一次是雜訊, 而雜訊會讓人開始略過這一段。
TAIL_CHARS=700
print_tail_then_row() {
  local board="$1" lineno="$2"
  python3 - "$board" "$lineno" "$TAIL_CHARS" <<'PYEOF'
import io, re, sys
board, ln, ncap = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rows = io.open(board, encoding='utf-8').read().split(chr(10))
if not (1 <= ln <= len(rows)):
    print('   ⏸️  讀不到 :%d ⇒ 不印尾端' % ln)
    raise SystemExit(0)
row = rows[ln - 1]
cells = [c for c in re.split(r'(?<!\\)\|', row) if c.strip()]
last = cells[-1].strip() if cells else ''
# 🔴 **短列只印一次** —— 而判準是【整列長度】不是「末格有沒有被截斷」。
#    我第一版寫 `len(row) <= len(tail)`:那是拿【整列】比【末格】, 兩個不同的東西
#    ⇒ 短列照樣走進「印兩次」那一支, 兩格 selftest 直接紅。
#    📌 又一次 fixture 沒落在邊界上 —— 而這次是【斷言先紅】才抓到的, 不是我看出來的。
if len(row) <= ncap:
    print('── \U0001f7e2 **整列(最新;本列僅 %d 字元 ⇒ 不另印尾端)** :%d ──' % (len(row), ln))
    print('   ' + row)
else:
    tail = last[-ncap:]
    print('── \U0001f7e2 **末格尾端(最新)** :%d —— 先讀這裡, 不要只讀開頭 ──' % ln)
    print('   ' + tail)
    print('── 整列(%d 字元)──' % len(row))
    print(row)
PYEOF
}

print_scope() {
  cat <<'SCOPE'
── 它答不出什麼 ──
· 它答「板上哪一列是它」, 答不出「那件事做完了沒」—— 那要開檔。
· 它讀的是【工作樹】那一版板檔;有未 commit 的改動時, 讀到的就是那一版。
· 無錨的列它定位不到 —— 那些只能靠內文特徵字面, 而那把尺較弱。
SCOPE
}

# ── --cells:pipe-aware 印五欄(唯讀)─────────────────────────────
# 🔴 **為什麼要有這個模式**(2026-09-05 線【出貨】`-ship` 當場量, 主視窗裁「甲, 你做」):
#    板上 **843 列**(數法:**以 `|` 開頭的行**)裡有 **130 列(15.4%)**內文含【跳脫過的】 `\|`
#    ⚠️ **同一件事有三個數, 而它們不是矛盾, 是三把不同的尺**(2026-09-05 當場量):
#       以 `|` 開頭 = **843** · 本檔 `count_rows` = **844** · `NF>5` = **830**
#       ⇒ `count_rows` 那 844 **含 4 行程式碼區塊裡的 grep 範例**(它們有豎線而不是表格列)。
#       ⇒ 📌 引用任何一個之前先講清楚在數哪一把 —— 本段一律用「以 `|` 開頭」那把。
#    (寫在 grep 的「或」裡, 例 `sh\|python3`)⇒ 共 **446 處**。
#    量法(可重跑):`len(row.split('|')) != len(re.compile(r'(?<!\\)\|').split(row))`
#    正對照 人造含 `\|` 的列 ⇒ naive 9 / 真 8 ⇒ 尺會動;極端值 `⟦b4-PICKPHONE1⟧` naive **23** / 真 **7**。
#    ⇒ 任何人用 `split('|')` / `awk -F'|'` 讀欄, 對這 130 列會拿到**半截**,
#      而**去改**會把字接在**別人句子的中間**。
# 🛑 **而那個錯【不掉字】** —— `'|'.join(split('|'))` 逐位元組無損
#    ⇒ `md-table` 那道 pre-commit **印綠**。而它印的警告逐字就是
#    「若你剛剛用程式改過這一列 ⇒ 先確認你的字沒有接在別人句子的中間」
#    ⇒ 📌 **一句正確的警告, 印在一道結構上看不到那個病的閘上。**
# ✅ **所以這裡給的是【前置條件】不是偵測**:讓人不必自己手刻 split。
# 🟢 **而本工具的【定位】那半一直是安全的**:那些 `\|` 全在備註欄,
#    實量「錨欄($3)被 naive 讀錯的列」= **0** ⇒ 上面那些 lookup 不受影響。
# ⚠️ **本模式證不到什麼**:它只答「這一列的五欄各是什麼」, 答不出那些內容對不對;
#    態欄印**原文**(不做封閉集正規化)—— 要判態請看 lookup 那半。
cells_of() {
  local anchor="$1" board="$2"
  awk -v a="$anchor" '
    BEGIN { nm[2]="態"; nm[3]="錨欄"; nm[4]="名稱"; nm[5]="誰欄"; nm[6]="備註欄" }
    {
      line = $0
      gsub(/\\\|/, "\001", line)             # 跳脫的豎線先換成哨兵, 它不是欄界
      n = split(line, f, "|")
      if (n < 6) next
      col = f[3]; gsub(/^[ \t]+|[ \t]+$/, "", col)
      if (index(col, a) == 0) next
      naive = split($0, g, "|")
      printf "行號\t%s\n", NR
      printf "真欄數\t%s   (naive split 會讀成 %s 欄)\n", n, naive
      for (i = 2; i <= 6 && i <= n; i++) {
        v = f[i]
        gsub(/\001/, "\\\\|", v)             # 還原成 \| 再印
        printf "%s\t%s\n", nm[i], v
      }
      hit = 1
    }
    END { exit (hit ? 0 : 3) }
  ' "$board"
}

# ── selftest:釘【關係】不釘【座標】 ─────────────────────────────
# 理由:座標正是這支工具要廢掉的東西。一支 selftest 若釘了行號,
#       下一次板子被改它就假紅。實量:b4-SHIPGATE1 五分鐘漂 1 行。
selftest() {
  local board="$REPO/$BOARD_DEFAULT" pass=0 fail=0
  check() { # <名稱> <實際> <期待>
    if [ "$2" = "$3" ]; then echo "🟢 PASS $1 ($2)"; pass=$((pass + 1))
    else echo "🔴 FAIL $1:得到 $2, 期待 $3"; fail=$((fail + 1)); fi
  }
  [ -r "$board" ] || { echo "🛑 ENV-FAIL 讀不到 $board" >&2; return 1; }

  # ① 正對照:一個真的存在的錨 ⇒ 恰好 1 列, rc=0
  local n1 rc1
  n1="$(lookup "b4-CAPNULLDEAD" "$board" str | grep -c . || true)"
  run_query "b4-CAPNULLDEAD" "$board" str >/dev/null; rc1=$?
  check "①正對照 命中列數" "$n1" "1"
  check "①正對照 rc" "$rc1" "0"

  # ② 負對照:現造帶時間戳的錨 ⇒ 0 列, rc=3
  # 🛑 一定要現造 —— 寫死的假錨有一天會變成真的。
  local fake n2 rc2
  fake="zz-not-real-$(date +%s)-$$"
  n2="$(lookup "$fake" "$board" str | grep -c . || true)"
  run_query "$fake" "$board" str >/dev/null; rc2=$?
  check "②負對照 命中列數" "$n2" "0"
  check "②負對照 rc" "$rc2" "3"

  # ⑪⑫ 末格尾端優先(2026-09-07 主視窗令)——【走真的 run_query】, 不在這裡重算
  #    🔴 為什麼要有這兩格:成因是一次真的重工(tidy 開了那一列而只讀開頭,
  #       答案在末格尾端)⇒ 順序本身就是這個修法的全部, 順序錯 = 修法沒生效。
  local _o11 _pt _pr
  _o11="$(run_query "b4-CAPNULLDEAD" "$board" str 2>&1)"
  _pt="$(printf '%s\n' "$_o11" | grep -n '末格尾端' | head -1 | cut -d: -f1)"
  _pr="$(printf '%s\n' "$_o11" | grep -n '^── 整列' | head -1 | cut -d: -f1)"
  # 🔵 先確認兩者都印了 —— 少了這一步, 「都沒印」會讓下面的比較變成空字串比空字串
  check "⑪ 末格尾端有印" "$([ -n "$_pt" ] && echo yes || echo no)" "yes"
  check "⑪ 整列有印" "$([ -n "$_pr" ] && echo yes || echo no)" "yes"
  check "⑪ 尾端【排在】整列之前" \
    "$([ -n "$_pt" ] && [ -n "$_pr" ] && [ "$_pt" -lt "$_pr" ] && echo yes || echo no)" "yes"

  # ⑫ 短列不重印:現造一支只有一列【短列】的板, 尾端已是全部 ⇒ 不印整列
  local _tmp _o12
  _tmp="$(mktemp -d)"
  printf '%s\n' '| 態 | 錨 | 事 | 誰 | x |' '|---|---|---|---|---|' \
    '| open | ⟦zz-short⟧ | 甲 | 誰 | ⟨擋⟩ 短 |' > "$_tmp/b.md"
  _o12="$(run_query "zz-short" "$_tmp/b.md" str 2>&1)"
  check "⑫ 短列 ⇒ 明說不另印尾端" \
    "$(printf '%s\n' "$_o12" | grep -c '不另印尾端' || true)" "1"
  check "⑫ 短列 ⇒ 真的沒印那段尾端(不是只印那句話)" \
    "$(printf '%s\n' "$_o12" | grep -c '末格尾端' || true)" "0"
  rm -rf "$_tmp"

  # ③ 突變格:本工具存在的理由。
  #
  # 🔴 而這一格【第一版是壞的】, 記在這裡免得有人改回去:
  #    原本寫「錨欄命中數 嚴格小於 整行命中數」⇒ 而我把核心 index($3,a) 突變成 index($0,a)
  #    ⇒ 實量 錨欄 2 / 突變 8 / 整行 10 ⇒ **8 < 10 ⇒ 那一格照樣 PASS。**
  #    📌 一個「比數量」的判準, 對「多抓了一些但還沒抓滿」的突變是瞎的。
  #
  # ✅ 改成比【集合】不比【數量】:先算出「整行撈得到而錨欄不該撈」的那些列(真假陽性),
  #    再斷言本工具的輸出與它們【零交集】。突變成整行比對 ⇒ 交集非空 ⇒ 紅。
  local anchor3 bad_rows out3 overlap
  anchor3="b4-SHIPGATE1"
  bad_rows="$(awk -F'|' -v a="$anchor3" 'index($0,a)>0 && index($3,a)==0 {print NR}' "$board" | sort)"
  out3="$(lookup "$anchor3" "$board" str | cut -f1 | sort)"
  overlap="$(comm -12 <(printf '%s\n' "$bad_rows") <(printf '%s\n' "$out3") | grep -c . || true)"
  check "③突變 與假陽性零交集" "$overlap" "0"

  # ⑩⑪ 錨欄帶反引號的兩種形狀(主視窗 2026-09-07 拍甲;`-ship` 量到 84 vs 5 才改)
  #
  # 🔴 **這兩格用【自造的板】不用真板, 而理由是量到的, 不是圖方便**:
  #    我先寫成「從真板現挑」, 而它連兩次挑到答不出這題的樣本 ——
  #      第一次挑到 `:207`:那一列的第 3 欄是一段【內文】(裡面剛好有兩個反引號錨), 根本不是錨欄;
  #      第二次挑到 `f3-TAPPAYNORATELIMIT1`:它是混的那一類, 而它【沒有任何一列用裸錨】
  #      ⇒ lookup 對它回 0 列 ⇒ 「那一列不在結果裡」在【剝】與【不剝】兩個世界都成立 = 恆真。
  #    📌 **一個從真實資料現挑的樣本, 不保證答得出你要問的那一題。**
  #    ✅ 自造的板同時放三種列, 一發問完, 而且不會因為板子被改而失效。
  local fb fbd
  fbd="$(mktemp -d "${TMPDIR:-/tmp}/brba.XXXXXX")" || return 1
  fb="$fbd/board.md"
  {
    printf '%s\n' '| open | ⟦zz-bare-1⟧ | 裸錨那一列 | 誰 | 只出現在內容欄 |'
    printf '%s\n' '| open | `⟦zz-back-1⟧` | 整欄只有一個反引號錨 = 那是它自己的 | 誰 | 內容 |'
    printf '%s\n' '| open | `⟦zz-back-1⟧` (原欄:#1) | 欄裡還有別的東西 = 在講別人 | 誰 | 內容 |'
    # code-reviewer 2026-09-07 指出的兩個形狀, 收進自造板讓修法有尺守著
    printf '%s\n' '| open | ```⟦zz-triple-1⟧``` | 形狀A 三對反引號 | 誰 | 內容 |'
    printf '%s\n' '| open | 　`⟦zz-fw-1⟧`　 | 形狀B 全形空白 | 誰 | 內容 |'
  } > "$fb"

  local got10 got11
  # ⑩ 整欄只有一個反引號錨 ⇒ 查得到(命中第 2 列, 不含第 3 列)
  got10="$(lookup "zz-back-1" "$fb" str | cut -f1 | tr '\n' ',')"
  check "⑩整欄只有一個反引號錨 ⇒ 只命中它自己那一列" "$got10" "2,"
  # ⑪ 混的那一列(第 3 列)不得出現 —— 上面那格若把 3 也撈進來就會紅
  got11="$(lookup "zz-back-1" "$fb" str | cut -f1 | grep -cx 3 || true)"
  check "⑪欄裡還有別的東西 ⇒ 那一列仍被剝掉" "$got11" "0"
  # ⚪ 正對照:裸錨那一列照舊查得到(證明這把尺在自造板上是活的)
  check "⑩⚪正對照 裸錨仍查得到" "$(lookup "zz-bare-1" "$fb" str | grep -c . || true)" "1"
  # 🔴 負對照:自造板上不存在的錨 ⇒ 0
  check "⑩🔴負對照 自造板上沒有的錨 ⇒ 0" "$(lookup "zz-nope-$$" "$fb" str | grep -c . || true)" "0"
  # ⑬ 查無時的第二個數(主視窗 2026-09-07 指定):錨欄裡被反引號包住那一段命中幾列。
  #    🔴 一定要有負對照 —— 一個【永遠印 >0】的數與一個真的計數, 在畫面上長得一樣。
  #    🛑 而它的位置也量過:放在【真查無】那條路徑上是死碼(錨若在錨欄, 整行一定也命中
  #       ⇒ 走不到真查無)⇒ 它印在【退回整行比對】那條路徑上。
  check "⑬反引號段計數 正對照(自造板兩列都有)" "$(count_backticked "zz-back-1" "$fb")" "2"
  check "⑬反引號段計數 🔴負對照(只出現在第 5 欄的字)" "$(count_backticked "只出現在內容欄" "$fb")" "0"
  check "⑬反引號段計數 🔴負對照(自造板上沒有的字)" "$(count_backticked "zz-nope-$$" "$fb")" "0"
  # ⑧⑧ 形狀A / 形狀B(code-reviewer 2026-09-07)—— 沒有這兩格, 判別式會安靜退化回一版
  check "形狀A 三對反引號 ⇒ 仍當成它自己的錨" "$(lookup "zz-triple-1" "$fb" str | grep -c . || true)" "1"
  check "形狀B 全形空白 ⇒ 仍當成它自己的錨" "$(lookup "zz-fw-1" "$fb" str | grep -c . || true)" "1"
  check "形狀 負對照 自造板上沒有的錨 ⇒ 0" "$(lookup "zz-triple-nope-$$" "$fb" str | grep -c . || true)" "0"
  rm -rf "$fbd"

  # ⑥ 退回路徑的破折號不得印成字面 `u2014`(awk 不認 \u 跳脫)
  local u6
  u6="$(lookup_fallback "f3-PRODUCTEDITUI1" "$board" str 2>/dev/null | grep -c 'u2014' || true)"
  check "⑫退回路徑不得印出字面 u2014" "$u6" "0"
  # 而那組假陽性必須非空 —— 不然這一格恆綠(沒有東西可以被錯抓)。
  check "③突變 假陽性組非空" \
    "$([ "$(printf '%s\n' "$bad_rows" | grep -c . || true)" -gt 0 ] && echo yes || echo no)" "yes"

  # ④ 多列格:一個錨真的命中多列 ⇒ 必須印出全部, 不得只回第一列。
  #
  # 🔴🔴 **這一格【一直靠一個假陽性活著】**(2026-09-07 加⑨時發現):
  #    原本用真板上的 `b4-MAILHTML1` 當 fixture, 而它命中的兩列是
  #      :1095 錨欄 `⟦b4-MAILHTML1⟧`        ← 是它自己
  #      :1565 錨欄 <反引號>⟦b4-MAILHTML1⟧<反引號>  ← **只是提到它**(該列「態」欄實際印 726,
  #                                            它根本在分隔線下面那張表)
  #    ⇒ 加了⑨的反引號過濾之後, 這一格從 2 掉到 1 而**變紅**。
  #    🛑 **當下最順手的修法是把期待值改成 1 —— 那是【動驗證本身】, 立即停止訊號。**
  #       改了之後「命中多列必須全印」就沒有任何東西在守了。
  #    ✅ 改成【合成板檔】:兩列都是真的同錨列。那才是這一格要守的東西,
  #       而且它不再依賴真板上剛好有一個假陽性。
  #    📌 **一個靠別人的髒資料活著的 selftest, 會在那份資料被清乾淨的那天變紅。**
  local tmp4 na4
  tmp4="$(mktemp "${TMPDIR:-/tmp}/anchor4.XXXXXX")" || return 1
  {
    printf '%s\n' '| 態 | 錨 | 事 | 誰 | 末 |'
    printf '%s\n' '|---|---|---|---|---|'
    printf '%s\n' '| open | ⟦zz4-DUP⟧ | 同一個錨的第一列 | 誰 | x |'
    printf '%s\n' '| done | ⟦zz4-DUP⟧ | 同一個錨的第二列 | 誰 | x |'
  } > "$tmp4"
  na4="$(lookup "zz4-DUP" "$tmp4" str | grep -c . || true)"
  rm -f "$tmp4"
  check "④多列 命中 ≥2" "$([ "$na4" -ge 2 ] && echo yes || echo "no($na4)")" "yes"

  # ⑤ 退回檔正對照:一個錨【只在別欄】的 ⇒ 必須找得到, 且必須印那句警告。
  # 🔴 這一格是 2026-09-03 加退回檔的理由本身:在此之前它印「查無」,
  #    而「查無」與「板上沒有這一列」是同一個字 ⇒ 讀的人會去開一列新的。
  local fbn5 out5 rc5
  fbn5="$(lookup_fallback "b4-SQLCOMMENT1" "$board" str | grep -c . || true)"
  out5="$(run_query "b4-SQLCOMMENT1" "$board" str 2>&1)"; rc5=$?
  check "⑤退回 錨欄 0 列" "$(lookup "b4-SQLCOMMENT1" "$board" str | grep -c . || true)" "0"
  check "⑤退回 整行找得到" "$([ "$fbn5" -ge 1 ] && echo yes || echo no)" "yes"
  # 🔴 期待字面 2026-09-07 換過(意思沒變:退回路徑必須警告)——
  #    ⛔ ~~`錨【不在錨欄】`~~ 那句住在被拿掉的 WARN 段裡(主視窗令「查無時不給替代答案」)。
  #    📌 **是我把它驗的那段話搬走了, 不是功能不見了** —— 所以換字面, 不是降標準。
  check "⑤退回 有印警告" \
    "$(printf '%s' "$out5" | grep -c '不是它那一列' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  check "⑤退回 有明說不替你挑" \
    "$(printf '%s' "$out5" | grep -c '不把那幾列印出來' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  check "⑤退回 rc" "$rc5" "0"
  # 🛑 而它【不得】冒充錨欄命中 —— 那句「🟢 錨欄命中」只能出現在真的錨欄命中時。
  check "⑤退回 不冒充錨欄命中" \
    "$(printf '%s' "$out5" | grep -c '🟢 錨欄命中' | awk '{print ($1>0)?"yes":"no"}')" "no"
  # 🔴🔴 ⑤c **錨欄 0 而整行有 ⇒ 不得印任何行號當答案**(主視窗 `-f1` 2026-09-07 令)。
  #    實錘 `⟦f3-REDNEEDSEXIT⟧`:本工具當時錨欄查無 ⇒ 退回整行 ⇒ **印 `:1102`(車款搜尋那列)當答案**,
  #    而那一列看起來完全像答案。📌 **端一列別的出去比印查無糟 —— 查無讓人繼續找,
  #    一個看起來對的答案讓人【停止】找。**
  #    ⚪ 而這一格要有分母:同一發的整行命中數必須 ≥1(否則它是在測一條沒走到的路)。
  check "⑤c 這一格有沒有走到退回路徑(整行命中 ≥1)" "$([ "$fbn5" -ge 1 ] && echo yes || echo no)" "yes"
  check "⑤c 退回路徑不得印出任何行號" \
    "$(printf '%s' "$out5" | grep -cE '^[0-9]+\t')" "0"

  # ⑥ 錨欄命中那條路必須【標記自己】—— 否則兩種答案在畫面上長一樣。
  local out6
  out6="$(run_query "b4-CAPNULLDEAD" "$board" str 2>&1)"
  check "⑥錨欄命中 有標記" \
    "$(printf '%s' "$out6" | grep -c '🟢 錨欄命中' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  check "⑥錨欄命中 不印退回警告" \
    "$(printf '%s' "$out6" | grep -c '錨【不在錨欄】' | awk '{print ($1>0)?"yes":"no"}')" "no"

  # ⑦ 真查無:必須印【分母】。
  # 🔴 沒有分母的 0 = 「尺壞了」與「真的沒有」同一個畫面 —— 這支檔自己記過那個病。
  local fake7 out7 rc7
  fake7="zz-none-$(date +%s)-$$"
  out7="$(run_query "$fake7" "$board" str 2>&1)"; rc7=$?
  check "⑦查無 rc" "$rc7" "3"
  check "⑦查無 有印分母" \
    "$(printf '%s' "$out7" | grep -c '分母:本板共' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  # 而那個分母必須是【真的數出來的】, 不是寫死的 —— 拿它跟現算的比。
  check "⑦查無 分母對得上" \
    "$(printf '%s' "$out7" | sed -n 's/.*分母:本板共 \([0-9]*\) 列.*/\1/p')" "$(count_rows "$board")"

  # ⑧ --cells 必須是 pipe-aware 的。
  #    ⚠️ **本格用【板上的真實列】當 fixture, 不是人造資料** —— 它會跟著板子動。
  #       🟢 而它壞掉的方向是【大聲的】:那一列若被改成不含 `\|`, 第三格當場紅;
  #          那一列若被刪掉, `c8a` 是空字串 ⇒ 也紅。**沒有一種壞法是靜靜通過。**
  #       🔴 而它證不到「板上其他 129 列」—— 它只證這支工具會切。
  #    🟢 正對照 `b4-PICKPHONE1`(含 4+ 個 `\|`, naive 會爆成 23 欄)⇒ 真欄數 7
  #    🟢 負對照 `f3-SHIPPDF1`(不含)⇒ 真欄數 7, 而 naive 也是 7
  #    🔴 **兩格都印 7 ⇒ 一支「永遠印 7」的假實作也會過** ——
  #       所以第三格比的是【naive 那個數兩列必須不同】, 那才是尺有沒有接上。
  local c8a c8b n8a n8b
  c8a="$(cells_of "b4-PICKPHONE1" "$board" | sed -n 's/^真欄數.\([0-9]*\).*/\1/p')"
  c8b="$(cells_of "f3-SHIPPDF1"   "$board" | sed -n 's/^真欄數.\([0-9]*\).*/\1/p')"
  check "⑧正對照 b4-PICKPHONE1 真欄數" "$c8a" "7"
  check "⑧負對照 f3-SHIPPDF1 真欄數"   "$c8b" "7"
  n8a="$(cells_of "b4-PICKPHONE1" "$board" | sed -n 's/.*naive split 會讀成 \([0-9]*\) 欄.*/\1/p')"
  n8b="$(cells_of "f3-SHIPPDF1"   "$board" | sed -n 's/.*naive split 會讀成 \([0-9]*\) 欄.*/\1/p')"
  check "⑧ naive 兩列必須不同(否則尺沒接上)" "$( [ "$n8a" != "$n8b" ] && echo yes || echo no )" "yes"

  # ⑨ 引用列 —— 錨欄裡【帶反引號】的錨是在講別人, 不該命中(2026-09-07 主視窗轉 front :1566)
  #   🔴 用【合成板檔】測, 不依賴真板:真板上那一列隨時會被別的窗改掉,
  #      而一格靠別人的資料活著的 selftest, 綠掉的那天你不知道是誰弄的。
  local tmp9 n9a n9b n9c
  tmp9="$(mktemp "${TMPDIR:-/tmp}/anchor9.XXXXXX")" || return 1
  {
    printf '%s\n' '| 態 | 錨 | 事 | 誰 | 末 |'
    printf '%s\n' '|---|---|---|---|---|'
    printf '%s\n' '| open | ⟦zz9-REAL⟧ | 這是它自己那一列 | 誰 | x |'
    printf '%s\n' '| open | `⟦zz9-REAL⟧` 的正本在上面 | 這只是提到它 | 誰 | x |'
    printf '%s\n' '| open | ⟦zz9-BOTH⟧ 而它也提到 `⟦zz9-REAL⟧` | 自己有錨又提到別人 | 誰 | x |'
  } > "$tmp9"
  n9a="$(lookup "zz9-REAL" "$tmp9" str | grep -c . || true)"
  n9b="$(lookup "zz9-BOTH" "$tmp9" str | grep -c . || true)"
  n9c="$(grep -c 'zz9-REAL' "$tmp9" || true)"
  rm -f "$tmp9"
  check "⑨ 引用列不命中(錨欄比對)" "$n9a" "1"
  check "⑨ 自己有錨又提到別人 ⇒ 仍命中(剝的是那一段不是整列)" "$n9b" "1"
  # 🔵 正對照:整行 grep 對同一份輸入撈到 3 列 ⇒ 證明【那兩個假陽性真的在檔裡】,
  #    而不是我造的 fixture 根本沒有它們(那樣 ⑨ 會在兩個世界印同一個 1)。
  check "⑨ 對照 整行 grep 撈到 3 列(假陽性確實存在)" "$n9c" "3"

  # 🔴 ⛔ ~~「9 格 / 23 檢查」~~ 是【手維護的總數】 —— 2026-09-07 加三格之後它就過期了
  #    (印 23 而實跑 26)。⇒ 改成數出來的:總數 = PASS + FAIL, 加格子不必回來改這一行。
  echo "── selftest:檢查 $((pass + fail)) 項 ⇒ PASS=$pass FAIL=$fail ──"
  [ "$fail" -eq 0 ]
}

# ── 進入點 ────────────────────────────────────────────────────
case "${1:-}" in
  --selftest) selftest; exit $? ;;
  --cells)    [ $# -ge 2 ] || { usage; exit 2; }
              cells_of "$2" "${3:-$REPO/$BOARD_DEFAULT}"; exit $? ;;
  --regex)    [ $# -ge 2 ] || { usage; exit 2; }
              run_query "$2" "${3:-$REPO/$BOARD_DEFAULT}" regex; exit $? ;;
  ""|-h|--help) usage; exit 2 ;;
  -*)         usage; exit 2 ;;
  *)          run_query "$1" "${2:-$REPO/$BOARD_DEFAULT}" str; exit $? ;;
esac
