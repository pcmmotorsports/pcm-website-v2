#!/usr/bin/env bash
# board-text-pending — 「信箱裡的落板文字, 有幾份還沒進板?」
#
# 🔴 為什麼有它(2026-09-08 線【信】`-mail` 建;A 裁、主視窗 B 派):
#    板列至少有人會掃, 而 `~/pcm-mailbox/` **沒有任何東西在數它** ——
#    📌 交件寫得再好, 沒落地等於沒寫。而 2026-09-07 夜實測:8 份交件檔裡 **6 份未落地**,
#      其中三份已經超過兩小時, 而**沒有任何機制會叫**。
#    🛑 而那一發量測**本身也只活在一則訊息裡** ⇒ 這支檔就是把它變成一個可重跑的東西。
#
# 用法:
#   bash scripts/board-text-pending.sh              掃一次(只印, 不擋)
#   bash scripts/board-text-pending.sh --selftest   離線自檢(不碰真的信箱、不碰真的板)
#
# exit code(三態分得開;形狀對齊 scripts/mailbox-snapshot.sh):
#   0 = 跑完了(不論有沒有未落地 —— 🛑 **它不是閘, 有未落地【也是 0】**)
#   1 = 工具自壞(信箱不存在 / 板讀不到 / 正對照失敗)
#   2 = 用法錯
#   🔴 「有未落地」與「工具自壞」必須是不同的碼 —— 合流的話, 一個 rc 會同時代表兩件相反的事。
#
# 🛑 這支答不出什麼(先讀, 不要把它讀得比它大):
#   ① 🔴 **它【不宣稱方向】—— 既不是下界也不是上界。**
#      ⛔ ~~舊版寫「只會把未落地誤判成已落地, 不會反過來」~~ ⇒ **那句被 auth 2026-09-08 R1 M2 推翻**:
#      **加嚴的門檻會把【已落地】判成未落地**(實測 `board.count==1` 濾掉 4 條合法重複),
#      **放寬會反過來** ⇒ **兩個方向都會錯**。
#      🛑 **而那句話印在每次輸出的最後一行, 讀的人會照它做決定** ——
#      📌 **一個方向性宣稱, 比它修飾的那個數字傳得更遠:數字有人會重量, 而「這是下界」沒有人會。**
#      ⛔ ~~⇒ 所以它改成三態:已落地 / 🟡 判不出來 / 未落地~~
#      🔴 **那句是【中間那一版】的結論**(auth 2026-09-08 R2 N1)—— **後來又換路了**:
#      ✅ **現在它【完全不分類】** —— 只印證據(對上幾條 + 每條在板上出現幾次 + 未命中行帶行號),
#        而唯一還印的結論是「一條都沒對上」。**輸出裡沒有「判不出來」這個字。**
#   ② 它比的是 `origin/dev` 那份板 ⇒ **別人還沒推的落板不算數**(那是對的:沒推 = 還沒落地)。
#   ③ 它只認 `落板文字-*` 與 `訂正文字-*` 兩種檔名 ⇒ **別種命名的交件它看不到。**

set -u

MB="${PCM_MAILBOX_DIR:-$HOME/pcm-mailbox}"
BOARD_REF="${PCM_BOARD_REF:-origin/dev}"
BOARD_PATH="docs/launch-todo.md"

die()  { echo "🔴 $*" >&2; exit 1; }
usage(){ echo "用法:bash scripts/board-text-pending.sh [--selftest]" >&2; exit 2; }

# 🔴🔴 **變數後面緊接【全形標點】一律用 `${VAR}`, 不要裸 `$VAR`**(auth 2026-09-08 R2 M1)
#    `"…$BOARD_REF】…"` ⇒ bash 把全形的位元組吃進變數名 ⇒ `set -u` 下 unbound   # noqa:fullwidth-var
#    🔵 **上面那一行是【故意留的錯寫法】, 而它帶 `# noqa:fullwidth-var`**(auth R3 N1)——
#      📌 **任何人照這條教訓寫一道掃描閘, 第一個命中的就是這行註解**
#      ⇒ 🔴 **而誤報第一顆出現在教學範例上, 最容易讓人把整道閘關掉。**
#    ⇒ 🛑 **整段 note 死掉, 而 rc 仍是 0、stdout 什麼都不說。**
#    🎯 **今晚同族的第三個**(`cut -c` 按位元組切 · 環境變數截斷 276⇒116 · 這個)——
#      **三個都不報錯, 三個都只是「比不中 / 不出聲」。**
#    🔬 **條件量出來了 —— 是【locale】不是版本**(auth R3;我自己也複現過, 同一支 `/bin/bash 3.2.57`):
#      `LC_ALL=en_US.UTF-8` ⇒ **rc=1 unbound variable** · `LC_ALL=zh_TW.UTF-8` ⇒ **同樣炸**
#      `LC_ALL=C` ⇒ **正常印出** · `LANG/LC_ALL/LC_CTYPE 全未設` ⇒ **正常印出**
#      ⇒ 🎯 **UTF-8 locale 下【必炸】, 不是「有時候會炸」** —— 📌 **後者寫不成掃描規則, 前者可以。**
#      ⚠️ 射程:只在 `bash 3.2.57` / macOS 量過;**新版 bash 未測**。
#    ⚠️ **而我第一次複現不出來**(那句印 7 次 · unbound 0)—— 成因是**我的 shell locale 全未設**
#      ⇒ 📌 **「我這邊沒炸」不是「它不會炸」** —— **下一個在 C locale 下複現不出來的人, 會以為這條是假的。**
#      ⇒ 📌 **「我這邊沒炸」不是「它不會炸」** —— 照修, 不辯。
# 🔴 剝掉【所有】空白再比 —— 落板文字本身就是表格列, 兩邊的縮排/全形空白不會一致。
#    ⛔ ~~第一版把含 `|` 的行當雜訊排除~~ ⇒ 那會讓候選變 0, 而 0 會被讀成「讀不出來」。
squash() { tr -d '[:space:]' ; }

# 一份交件檔的【證據】—— 🛑 **它不判「落地了沒」, 它把判斷所需的東西印出來給人看。**
#
# 🔴🔴 **為什麼不分類**(2026-09-08 · 主視窗 B 裁【乙】, 而理由是我自己那句):
#    ⛔ ~~門檻 `board.count(fp)==1`~~ ⇒ ⛔ ~~`<=2` 三態(罕見/常見)~~ ⇒ ⛔ ~~排除路徑/識別字行~~
#    📌 **三次調門檻, 每一次都是【調完才發現維度不對】** —— 而第四次(換成「像不像散文」)
#      **只是換一個代理, 同一個病。**
#    🔬 **本體**:「板上只出現 1 次」**不等於**「那份檔獨有的句子」——
#      實測罕見命中的實際內容是 `31040000_m4b_maildead_requ` / `cripts/admin-probe/up.sh`起
#      ⇒ **一個【只被引用過一次的檔名片段】也是罕見的。**
#      ⇒ 🎯 **我用「出現次數」當「是不是獨有內容」的代理, 而那個代理不成立。**
#    ✅ **⇒ 換路(R4):讓工具【不再分類】。**
#      **「判不出來」不是三個選項之一, 它是【拒絕在沒有判別力的時候給答案】** ——
#      而**光說判不出來而不給數字是把球丟掉**, 所以每條命中都印它在板上出現幾次。
#
# 🔵 **唯一一個【不必分類就成立】的數:命中 0** —— 它連一條都沒對上。
evidence_of() {
  local f="$1"
  BOARD_FILE="$BOARD_FILE" python3 - "$f" <<'PY'
import io, os, re, sys
board = io.open(os.environ["BOARD_FILE"], encoding="utf-8").read()
hit, miss, seen = [], [], set()
for lineno, ln in enumerate(io.open(sys.argv[1], encoding="utf-8", errors="replace"), 1):
    t = re.sub(r"\s+", "", ln).lstrip(">|").strip()
    if len(t) < 30:
        continue
    # 🔴 python 切片按【字元】—— 不可用 `cut -c`(macOS 按位元組, 中文會被切成半個)。
    fp = t[8:34]
    if len(fp) < 20 or fp in seen:
        continue
    seen.add(fp)
    c = board.count(fp)
    (hit if c else miss).append((fp, c, len(t), lineno))
print("HITS %d" % len(hit))
for fp, c, _, ln_ in hit[:4]:
    print("  ✓ :%d 命中「%s」 板上 %d 次" % (ln_, fp, c))
# 🔴 最長的 3 條【未命中】行 = 「這份檔要進板的東西」的樣本 —— 人看到它一眼就判得出來。
# 🔴 印【行號】(A 2026-09-08 加)—— 不然人拿到一句話, 還要自己回檔裡找它在哪。
for fp, _, L, ln_ in sorted(miss, key=lambda x: -x[2])[:3]:
    print("  ✗ :%d 未命中「%s」" % (ln_, fp))
PY
}

# 🛑🛑 **這支來源檔【刻意不在版控】**(主視窗 B 2026-09-08 裁;A 的理由:
#    **它的壽命是「這一批落完」, 而板才是長期記錄 —— 進 repo 的東西不會有人來刪**)。
#    ⇒ 📌 **本腳本住在 repo 裡而讀一個 repo 外的檔** ——
#      **下一個人看到它不見了, 那不是壞掉, 是它到期了。不要去 repo 裡找它。**
ASSIGN="${PCM_ASSIGN_FILE:-$HOME/pcm-mailbox/落板文字-指派表-20260908.md}"

# 指派欄 —— 🔴 **原封帶出來源檔的狀態, 不自己重新分類。**
#    來源:`落板文字-指派表-20260908.md`(主視窗 A 2026-09-08 建, 格式寫在它檔頭)
#    `檔名 | 被指派 | 指派時間 | 狀態`, 狀態封閉集 `待落 / 已落(<sha>) / 作廢(<理由>)`
#    🛑 **「作廢」與「未落」在【重新分類】裡會印同一個東西, 而來源檔答得出來** ⇒ 照抄它。
#    🛑 **來源檔沒列到某一份 ⇒ 印「未列入指派表」, 不要印「未指派」** —— 那又是兩件事。
#    🔵 而它是【表格】⇒ 用 `-F'|'` 取欄, 不靠長度門檻(表格列剝空白後常在 35 上下)。
assignee_of() {
  local base="$1"
  [ -f "$ASSIGN" ] || { printf '%s' "未列入指派表(來源檔不存在:$ASSIGN)"; return 0; }
  local row
  row="$(grep -F "$base" "$ASSIGN" 2>/dev/null | grep '^|' | head -1)"
  [ -n "$row" ] || { printf '%s' "未列入指派表"; return 0; }
  local who st sha note
  who="$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')"
  st="$(printf '%s' "$row"  | awk -F'|' '{gsub(/^ +| +$/,"",$5); print $5}')"
  # 🔴 「已落(<sha>)」順手問一句【那顆 sha 在不在 ${BOARD_REF}】——
  #    📌 因為本工具比的是 `origin/dev`, 而「已落」可能是落進【別人那棵樹】。
  #    🛑 **只是多印一個事實, 不改回分類。**
  #    🔬 實錘(2026-09-08):`BINLOGGREP` 指派表寫「已落(7fa85f77b)」而本工具對上 0 條 ——
  #      量出來是 **commit 存在而不在 `origin/dev`** ⇒ **兩邊都對, 主詞不同。**
  sha="$(printf '%s' "$st" | sed -n 's/.*已落(\([0-9a-f]\{7,\}\)).*/\1/p')"
  if [ -n "$sha" ]; then
    # 🔴🔴 **這一欄加的是【事實】不是【代理】** —— 那個分別是前四次調門檻踩出來的:
    #    ⛔ 代理(出現次數 / 像不像散文)**每一個都要一個門檻, 而門檻永遠調不準**
    #    ✅ 事實:**那顆 sha 的 diff 有沒有動到 `docs/launch-todo.md`** ——
    #       **一行 git、沒有門檻、兩個世界印不同的東西。**
    #    🎯 **判準 = 「它要不要一個門檻」。要 ⇒ 代理, 不加;不要 ⇒ 事實, 加。**
    local touched=""
    if git cat-file -e "$sha^{commit}" 2>/dev/null; then
      if [ -n "$(git show --stat --format= "$sha" -- "$BOARD_PATH" 2>/dev/null)" ]; then
        touched=" · 該 sha 動了板"
      else
        touched=" · 🔴 該 sha 【沒動】板(ship 標錯, 或落在別的檔)"
      fi
    fi
    if git merge-base --is-ancestor "$sha" "$BOARD_REF" 2>/dev/null; then
      note=" [該 sha 已在 $BOARD_REF$touched]"
    elif git cat-file -e "$sha^{commit}" 2>/dev/null; then
      note=" [該 sha 存在而【不在 ${BOARD_REF}】$touched]"
    else
      note=" [⚠️ 該 sha 在本樹找不到 ⇒ 讀不出來]"
    fi
    # 🛑 **三行事實並排, 不收成一個結論** —— 而**加了這一欄之後它驗的仍然只是
    #    「那顆 sha 動了板」, 不驗【那次改動是不是這份交件檔的內容】**
    #    ⇒ 🔴 **那要看同一行的「對上 N 條」** ⇒ 📌 **兩欄合起來才有話講, 單看任一欄都會誤讀。**
  else
    note=""
  fi
  # 🔴 指派時間也帶出來(來源檔第 4 欄)—— 見下方「兩個時鐘」。
  local at; at="$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')"
  printf '%s / %s%s|%s' "$who" "$st" "$note" "$at"
}

scan() {
  [ -d "$MB" ] || die "信箱不存在:$MB"
  # 🔴🔴 板要用【檔案】傳給子行程, 不能用環境變數(2026-09-08 量到:板 276 字元, 子行程只拿到 116)
  #    🛑 而截斷後的板仍是一個合法字串, 只是比不中 ⇒ 與「真的沒落地」印同一個東西。
  BOARD_FILE="$(mktemp)" || die "mktemp 失敗"
  git show "$BOARD_REF:$BOARD_PATH" 2>/dev/null | squash > "$BOARD_FILE" || die "讀不到板:$BOARD_REF:$BOARD_PATH"
  [ -s "$BOARD_FILE" ] || die "板讀到空的:$BOARD_REF:$BOARD_PATH"
  export BOARD_FILE
  local board; board="$(cat "$BOARD_FILE")"
  # 🟢 正對照:板上一定有的字面。撈不到 ⇒ 尺沒接上, 而那與「全部沒對上」印同一個東西。
  case "$board" in *'⟦b4-'*) ;; *) die "正對照失敗:板上撈不到 '⟦b4-' ⇒ 尺沒接上, 拒絕報結論" ;; esac
  # ⚪ 負對照:現場現造(🔴 不用任何「大家都在用」的哨兵字面 —— 實測 'ZZQnowhere' 在板上命中 2 處)
  local neg; neg="zz$(date +%s 2>/dev/null)$$nope"
  case "$board" in *"$neg"*) die "負對照失敗:現造字串竟在板上命中 ⇒ 拒絕報結論" ;; esac

  local total=0 zero=0 broken=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    total=$((total+1))
    local ev rc_e n age base
    base="$(basename "$f")"
    ev="$(evidence_of "$f")"; rc_e=$?
    # N1(auth R1):收 rc —— 量具自壞不可以靜靜落進「零命中」。
    if [ "$rc_e" != "0" ] || [ -z "$ev" ]; then
      broken=$((broken+1))
      printf '  WARN %-52s 量具自壞(rc=%s)—— 這【不是】讀數\n' "$base" "$rc_e"
      continue
    fi
    n="$(printf '%s\n' "$ev" | sed -n 's/^HITS //p')"
    age="$(( ( $(date +%s) - $(stat -f %m "$f" 2>/dev/null || echo 0) ) / 60 ))"
    [ "${n:-0}" -eq 0 ] && zero=$((zero+1))
    echo
    printf -- '-- %s\n' "$base"
    # 🔴🔴 **「已等多久」有【兩個時鐘】, 而它們差很多**(主視窗 B 2026-09-08 抓到):
    #    ⛔ ~~只印一個「已等 N 分」~~ ⇒ 🛑 **讀的人會讀成「被指派的人壓了 N 分鐘」** ——
    #      實測 `PURCHTAX1` 從【檔案寫好】起算 209 分, 而它是 00:2x 才被指派的 ⇒ **ship 只拿到十來分鐘。**
    #    ⇒ 📌 **又是同一句:一個數字沒有說它從哪裡開始算。**
    #    ✅ 兩個數都印, 而**起點寫死在數字旁邊**;指派時間來源檔裡就有 ⇒ **不用估。**
    local ai wait_a
    ai="$(assignee_of "$base")"
    wait_a="${ai##*|}"; ai="${ai%%|*}"
    printf '   指派 %s · 寫好後 %s 分' "$ai" "$age"
    [ -n "$wait_a" ] && printf ' · 指派於 %s(排隊時間從那時起算, 不是從寫好起算)' "$wait_a"
    printf ' · 對上 %s 條\n' "$n"
    printf '%s\n' "$ev" | grep -v '^HITS'
  # 🔴🔴 **為什麼要排除:本工具的【來源檔】與它的【受測物】用同一套命名。**
  #    ⇒ 📌 **不排除的話, 它會把自己的來源當成一份沒落地的交件檔**(2026-09-08 出生當天實際發生:
  #      指派表被印成「未列入指派表 · 對上 0 條」)。
  #    🛑 **⇒ 判準是「這份檔是不是本工具讀進來當依據的」, 不是「檔名裡有沒有『指派表』」** ——
  #      **哪天多一支來源檔(例如第二張指派表 / 一份狀態表), 它也要一起排。**
  #    🔵 同族:auth 2026-09-07 數 postgres 程序時抓到自己那條 `grep` —— **兩次都是【多算】。**
  done < <(ls -t "$MB"/落板文字-*.md "$MB"/訂正文字-*.md 2>/dev/null | grep -v "指派表")

  echo
  echo "== 這一輪掃過什麼(本工具【不判「落地了沒」】)=="
  printf '幾份?%s   一條都沒對上的?%s   量具自壞的?%s\n' "$total" "$zero" "$broken"
  [ "$zero" -gt 0 ] \
    && echo "🔴 上面那 $zero 份一條都沒對上 —— 那是唯一一個不必分類就成立的數。" \
    || echo "🟢 每一份至少對上一條(而那【不代表】它們都落地了 —— 見下)。"
  [ "$broken" -gt 0 ] \
    && echo "⚠️ 有 $broken 份量具自壞 ⇒ 那幾份【沒有讀數】, 不要當成任何一種結論。" \
    || echo "🟢 量具沒有自壞的那一種。"
  echo "🛑 其餘請自己看上面那幾行 ——「命中」若全是檔名/路徑片段, 那多半還沒落地;"
  echo "   而「未命中」那幾條就是【這份檔要進板的東西】的樣本。"
  echo "🔴 本工具不宣稱方向 —— 既不是下界也不是上界(四次調門檻都調不準, 見 evidence_of 檔頭)。"
  return 0
}

selftest() {
  # 🔴🔴 selftest 第一件事:剝掉繼承來的 git 環境(`git -C` 擋不住它)
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
  local tmp; tmp="$(mktemp -d)" || die "mktemp 失敗"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  mkdir -p "$tmp/mb" "$tmp/repo"
  ( cd "$tmp/repo" && git init -q . && git config user.email t@t && git config user.name t \
    && mkdir -p docs && printf '%s\n%s\n%s\n' '| open | AAA | 這是第一條已經落地的內容而且它夠長夠長夠長夠長夠長 |' '| open | BBB | 這是第二條已經落地的內容而且它也夠長夠長夠長夠長夠長 |' '| open | ⟦b4-CCC⟧ | 這是第三條已經落地的內容而且它同樣夠長夠長夠長夠長夠長 |' > docs/launch-todo.md \
    && git add docs/launch-todo.md && git commit -qm x && git branch -f selftestref ) || die "自檢 repo 建不起來"
  printf '%s\n%s\n%s\n' '| open | AAA | 這是第一條已經落地的內容而且它夠長夠長夠長夠長夠長 |' '| open | BBB | 這是第二條已經落地的內容而且它也夠長夠長夠長夠長夠長 |' '這一行是給接手者的說明而它本來就不會進板夠長夠長夠長夠長夠長' > "$tmp/mb/落板文字-已落地-20260908.md"
  printf '%s\n%s\n' '| open | ZZ1 | 這一條板上完全沒有而且它夠長夠長夠長夠長夠長夠長夠長 |' '| open | ZZ2 | 這一條板上也完全沒有而且它同樣夠長夠長夠長夠長夠長夠長 |' > "$tmp/mb/落板文字-未落地-20260908.md"
  local out rc
  # 🔴 M3(auth R1):⛔ ~~`$OLDPWD/scripts/…`~~ —— 從 repo 根【以外】的目錄跑 ⇒ rc=127,
  #    而舊版印「世界①失敗 世界②失敗」⇒ 📌 **「叫不動」與「判錯」印同一個東西。**
  #    ✅ 改成從【腳本自身位置】推,而不是靠呼叫者站在哪。
  local self; self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  [ -f "$self" ] || { echo "  🔴 自檢叫不動:找不到腳本自身 $self(這【不是】判錯)"; return 1; }
  out="$(cd "$tmp/repo" && PCM_MAILBOX_DIR="$tmp/mb" PCM_BOARD_REF=selftestref bash "$self" 2>&1)"; rc=$?
  if [ "$rc" = "127" ]; then echo "  🔴 自檢叫不動:rc=127(這【不是】判錯)"; return 1; fi
  echo "$out"
  echo "── 自檢判定(兩個世界)──"
  local ok=0
  # 🔴 自檢的判準跟著換路(2026-09-08 裁乙:工具不再分類)——
  #    ⛔ ~~找『已落地 1 / 未落地 1』那兩個字面~~ **輸出已經不印那個結論了。**
  #    ✅ 改成驗【兩個世界印不同的東西】:板上有的那份要對上 ≥1 條, 現造那份要 0 條。
  case "$out" in *'對上 2 條'*|*'對上 3 條'*|*'對上 4 條'*)
        echo "  ✅ 世界①【板上有的內容】⇒ 對上多條" ;;
     *) echo "  🔴 世界① 判錯(腳本叫得動而答案不對)"; ok=1 ;; esac
  case "$out" in *'對上 0 條'*)
        echo "  ✅ 世界②【現造假檔】⇒ 一條都沒對上" ;;
     *) echo "  🔴 世界② 判錯(腳本叫得動而答案不對)"; ok=1 ;; esac
  # 🟢 而【兩個世界必須印不同的東西】—— 少了這一格, 一個恆回同一個答案的尺也會過上面兩格。
  case "$out" in *'對上 0 條'*) case "$out" in *'對上 2 條'*|*'對上 3 條'*|*'對上 4 條'*)
        echo "  ✅ 兩個世界印出【不同的】數" ;; *) echo "  🔴 兩個世界印同一個數"; ok=1 ;; esac ;; esac
  # 🔵 受詞跟著換路(auth R2 N2):⛔ ~~「有未落地時」~~ ⇒ 輸出已不判「未落地」。
  #    判定本身不變(只印不擋), 而**標籤要說它現在在驗什麼**。
  [ "$rc" = "0" ] && echo "  ✅ 有【一條都沒對上】的份數時 rc 仍是 0(只印不擋)" || { echo "  🔴 rc=$rc 應為 0"; ok=1; }
  return "$ok"
}

case "${1:-}" in
  --selftest) selftest ;;
  "")         scan ;;
  *)          usage ;;
esac
