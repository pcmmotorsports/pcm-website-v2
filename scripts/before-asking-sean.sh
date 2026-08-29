#!/usr/bin/env bash
# before-asking-sean.sh — 我要端一題給 Sean 之前,先跑這一發。
#
# 🔴 **為什麼是 script 不是規則**(2026-08-29 線A `-e9` 做、主視窗 `-48` 指定規格):
#    當晚驗那 7 條「要 Sean 拍板」的題,**5 條的前提已經不成立**,
#    而那 5 條的答案【全部都寫下來了】,只是住在五個不同的載體:
#      · 2 條在【碼的註解】· 1 條在【COLUMN COMMENT】
#      · 1 條在【板子自己那一列】· 1 條只在【Sean 的原話】裡(沒有錨,只有用他的話搜得到)
#    📌 **沒有一條是「查不到」** —— 是【答案落在提問者不會去的那個載體】。
#    🔴 而把這五發寫成規則文字,它會變成【第六種同型病】:
#       寫下來了、grep 得到、而沒有人在端題前去讀它。
#    ⇒ `~/.claude/rules/00-work-rules.md` §4 機制優先律:機制做得到就不寫規則。**這件做得到。**
#
# 用法:
#   bash scripts/before-asking-sean.sh "<關鍵字>" [更多關鍵字…]
#   bash scripts/before-asking-sean.sh --selftest
#
# 🛑 **本檔不下判斷** —— 它只擺證據,五段原始輸出讓端題的人自己讀。
#    理由:一個會下結論的 script,錯的時候沒有人分得出是【它錯】還是【輸入錯】。

set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MAILBOX="${HOME}/pcm-mailbox"
# 🔴🔴 **`--since=<今天的日期>` 恆回 0** —— 2026-08-29 線A 實測,而它爆在最需要它的那一天。
#    git 把【光寫今天日期】的 `--since` 解析成「**現在**」,不是「今天 00:00」:
#      `--since=2026-08-29`         ⇒ 0 顆
#      `--since="2026-08-29 00:00"` ⇒ 285 顆   ← 同一天,只多了時間
#    而昨天的日期正常(`--since=2026-08-28` ⇒ 286 顆)⇒ **只有【今天】那一格會爆。**
#    📌 而你最常想問的正是「這件事【今天】有沒有人做掉了」⇒ 那正是唯一會回 0 的那天。
#    ⇒ **本檔的預設值刻意不是今天**;而若你用 env 覆寫成今天的日期, 第①段就會死,
#      **而它會安靜地印「零命中」。⇒ 覆寫時一律寫成 `"<日期> 00:00"`。**
SINCE="${BEFORE_ASKING_SINCE:-2026-08-01}"

# 🔴 **機制,不是提醒** —— 上面那段警告只是文字;這一格會【當場叫】。
#    判準:`--since=$SINCE` 撈到 0 顆,而【這個 repo 明明有 commit】
#    ⇒ 那不是「沒有人做」,是這個 SINCE 把射程收成了空的
#      (最常見成因:把它設成今天的日期)。
if [ "$(git -C "$REPO" log --since="$SINCE" --format=%h 2>/dev/null | grep -c '')" = "0" ] \
   && [ -n "$(git -C "$REPO" log -1 --format=%h 2>/dev/null)" ]; then
  printf '🛑 SINCE=%s 撈到 0 顆 commit, 而這個 repo 有 commit\n' "$SINCE" >&2
  printf '   ⇒ 第一段那一發沒有射程, 它印的零命中不算數。\n' >&2
  printf '   ⇒ 改寫成 "%s 00:00" 再跑一次。\n' "$SINCE" >&2
fi

# 🔴 標籤一律由結果決定 —— 本檔自己不得違反 `block-unconditional-echo-label` 那條。
#    (那條的成因:`cmd; echo "(空 = 零命中)"` 在【有命中】時照樣印,而它就印在命中的正下方。)
# 🔴 而它同時記帳:這一段是不是零。**第二輪要靠這個數決定跑不跑**,
#    而【不是靠人看完五段之後自己判斷】—— 那正是本檔第二輪存在的理由。
ZERO_N=0
report() {  # report <這一發掃了什麼> <輸出檔>
  if [ -s "$2" ]; then
    sed 's/^/    /' "$2"
  else
    ZERO_N=$((ZERO_N + 1))
    printf '    ⇒ 掃了 %s, 零命中\n' "$1"
  fi
}

section() { printf '\n═══ %s ═══\n  指令: %s\n' "$1" "$2"; }

sweep() {
  local KW="$1"
  local TMP; TMP="$(mktemp -t basweep)"
  ZERO_N=0

  printf '\n\n########## 關鍵字: %s ##########\n' "$KW"

  # ── ① 有人寫碼做掉了嗎 ────────────────────────────────────────────────
  local C1="git log --oneline --since=$SINCE --grep=<關鍵字>"
  section "① 有人寫碼做掉了嗎(commit 訊息)" "$C1"
  git -C "$REPO" log --oneline --since="$SINCE" --grep="$KW" > "$TMP" 2>/dev/null
  report "自 $SINCE 起的 commit 訊息" "$TMP"

  # ── ② Sean 答過了嗎 ──────────────────────────────────────────────────
  #    🔴 用【他會講的話】去掃,不是用我們的編號 —— 他答的時候不會用錨。
  local C2="grep -rn <關鍵字> ~/pcm-mailbox/*決策*.md ~/pcm-mailbox/*等Sean*.md docs/launch-todo.md"
  section "② Sean 答過了嗎(決策板 + 板子)" "$C2"
  { grep -rn -- "$KW" "$MAILBOX"/*決策*.md "$MAILBOX"/*等Sean*.md 2>/dev/null
    grep -n -- "$KW" "$REPO/docs/launch-todo.md" 2>/dev/null; } | cut -c1-220 > "$TMP"
  report "決策板與 launch-todo" "$TMP"

  # ── ③ 答案寫在碼的註解裡嗎 ────────────────────────────────────────────
  local C3="git grep -n <關鍵字> -- supabase/migrations packages/use-cases apps/*/src"
  section "③ 答案寫在碼裡嗎(migrations / use-cases / src)" "$C3"
  git -C "$REPO" grep -n -- "$KW" -- supabase/migrations packages/use-cases 'apps/*/src' 2>/dev/null \
    | cut -c1-220 | head -40 > "$TMP"
  report "migrations + use-cases + apps 原始碼" "$TMP"

  # ── ④ 答案寫在資料庫自己的說明裡嗎 ────────────────────────────────────
  #    🔴 停產品那一條就住在這裡 —— 而它是 DB 自己的說明,不是文件。
  local C4="git grep -n -A6 'COMMENT ON (COLUMN|FUNCTION|TABLE)' -- supabase/migrations | grep <關鍵字>"
  section "④ 答案寫在 DB 註解裡嗎(COMMENT ON …)" "$C4"
  git -C "$REPO" grep -n -A6 -E 'COMMENT ON (COLUMN|FUNCTION|TABLE)' -- supabase/migrations 2>/dev/null \
    | grep -- "$KW" | cut -c1-220 | head -20 > "$TMP"
  report "68 支帶 COMMENT ON 的 migration" "$TMP"

  # ── ⑤ 那段話下面有沒有一段在推翻它 ────────────────────────────────────
  #    🔴 這一格是五格裡最貴的:③ 的分母是【別的檔】,而這一格的分母是【同一段的下面幾行】。
  #    實例:`check-anomaly-alerts.ts:74` 的訂正就在原句正下方;
  #          `print-a4.css:96` 的更正在改前那行的 14 行之下 —— 兩個窗連續引錯同一格。
  local C5="git grep -n -A10 <關鍵字> -- . | grep -E '~~|訂正|為假|已修|作廢|推翻|已被.*取代'"
  section "⑤ 它下面有沒有一段在推翻它(就地訂正)" "$C5"
  git -C "$REPO" grep -n -A10 -- "$KW" -- . 2>/dev/null \
    | grep -E '~~|訂正|為假|已修|作廢|推翻|已被.{0,12}取代' | cut -c1-220 | head -20 > "$TMP"
  report "全 repo 命中處往下 10 行" "$TMP"

  rm -f "$TMP"
}

# ══ 🔴 第二輪:五段全零時【自己換一批字再跑一次】════════════════════════
#
# 🔴 **為什麼是機制不是一句話**(2026-08-30 線G 實例, 而受害者是本檔自己):
#    有人跑 `before-asking-sean.sh "出貨信 時區"` ⇒ **五段全零**,
#    而那個答案**就在 repo 裡** —— 它住在 `Q-出貨信起點` 與一支 `.ts` 的檔頭註解,
#    要用常數名 `SHIPPED_EMAIL_CUTOFF` 才撈得到。
#    ⇒ 📌 **本檔的存在理由就是防「答案落在提問者不會去的地方」——而它自己就是那樣失敗的。**
#    ⚠️ 而本檔輸出末尾**已經有一份誠實的射程清單**(三樣掃不到的),
#       **而「關鍵字沒對上」不在上面** ⇒ ⇒ **一份沒有被讀完的清單, 再加一行不會被讀到。**
#       ⇒ **所以修法是「它自己再跑一次」, 不是「多印一句提醒」。**
#
# 變體怎麼生(只用【使用者給的字】推,不猜語意):
#   · 拆詞:空白 / 全形空白 / 頓號 分開
#   · 每個詞的 SCREAMING_SNAKE 與 camelCase(只對 ASCII 詞有意義, 中文原樣保留)
#   · 整串去空白
# 🔴 切詞用 python3, 【不要用 tr】—— macOS 的 tr 是【逐 byte】的
#    (2026-08-30 線G 實測、成因逐字):
#      、 = e3 80 81 · 全形空白 = e3 80 80  ⇒ tr 的字集含 byte 80 與 81
#      而 揀 = e6 8f 80(尾 byte 80) · 頁 = e9 a0 81(尾 byte 81)
#    ⇒ `printf '揀貨單 尾頁' | tr ' 、　' '\n\n\n'` ⇒ 印出 [?] [貨單] [尾?] []
#    ⇒ ⇒ 而它【不報錯】—— 壞掉的變體照樣拿去 grep, 撈到就看起來像它會動。
#    📌 一個壞掉的變體產生器剛好命中, 與一個好的產生器, 那一發印同一個結果。
#    ⚠️ 而舊的 selftest 是用英文 `SHIPPED_EMAIL_CUTOFF` 過的
#       ⇒ 那把尺從來沒有量過中文, 而它的使用者九成在打中文。
_split_words() {  # 逐詞切(空白 / 、 / , / 全形空白), UTF-8 安全
  printf '%s' "$1" | python3 -c 'import sys,re
[print(w) for w in re.split(r"[\s、，,　]+", sys.stdin.read()) if w]'
}

_strip_seps() {  # 去掉所有分隔字元, UTF-8 安全
  printf '%s' "$1" | python3 -c 'import sys,re
sys.stdout.write(re.sub(r"[\s、，,　]+", "", sys.stdin.read()))'
}

variants_of() {  # variants_of "<原關鍵字>"
  _split_words "$1" | while IFS= read -r w; do
    [ -n "$w" ] || continue
    printf '%s\n' "$w"
    # ASCII 詞才生大小寫變體
    case "$w" in
      *[!\ -~]*) : ;;
      *) printf '%s\n' "$(printf '%s' "$w" | tr 'a-z-' 'A-Z_')"
         printf '%s\n' "$(printf '%s' "$w" | tr 'A-Z_' 'a-z-')" ;;
    esac
  done
  printf '%s\n' "$(_strip_seps "$1")"
  # 🔴 **合併形**才是真正撈得到東西的那一種(2026-08-30 實例:`shipped email cutoff`
  #    ⇒ 逐詞變體全部零命中, 而 `SHIPPED_EMAIL_CUTOFF` 一發命中)。
  #    ⇒ 只對【全 ASCII】的關鍵字生, 中文不生(生出來也沒有意義)。
  case "$1" in
    *[!\ -~]*) : ;;
    *) printf '%s\n' "$(printf '%s' "$1" | tr ' ' '_' | tr 'a-z-' 'A-Z_')"
       printf '%s\n' "$(printf '%s' "$1" | awk '{for(i=1;i<=NF;i++){if(i==1)printf tolower($i);else printf toupper(substr($i,1,1)) tolower(substr($i,2))}print ""}')" ;;
  esac
}

second_round() {  # second_round "<原關鍵字>"
  printf '\n\n🔁 ═══ 第二輪(觸發條件:第一輪【五段全零】)═══\n'
  printf '  🔴 五段全零【最常見的成因不是「沒有人做」, 是【關鍵字沒對上】。\n'
  printf '     ⇒ 本輪由工具自己換一批字重跑, 不需要任何人記得。\n'
  V="$(variants_of "$1" | sort -u | grep -v "^$(printf '%s' "$1" | sed 's/[].[^$\\*/]/\\&/g')$")"
  if [ -z "$V" ]; then
    printf '  ⇒ 這個關鍵字生不出任何變體(單一中文詞)⇒ 第二輪【沒有東西可跑】\n'
    printf '  🛑 ⇒ 而那【不是】「確認沒有」—— 請自己換成常數名 / 檔名 / 英文識別字再跑一次。\n'
    return 0
  fi
  printf '  變體清單:%s\n' "$(printf '%s' "$V" | tr '\n' ' ')"
  printf '%s\n' "$V" | while IFS= read -r v; do
    [ -n "$v" ] || continue
    sweep "$v"
  done
}

scope_note() {
  cat <<'SCOPE'


──────────────────────────────────────────────────────────────
🛑 這一發【掃不到】什麼(射程,印在你眼前不是躺在檔頭):
   · 別的 session 的對話 —— 2026-08-29 那一夜,三個答案只住在對話裡
   · 正式庫的實際狀態 —— 旗標現值 / RLS 開沒開 / 表裡幾列,本檔一格都答不出
   · OD 設計稿 —— 稿在 ~/Library/Application Support/Open Design/…,不在 repo
🔴 ⇒ 所以【五段全零】的意思是「這五個載體裡沒有」,不是「沒有人答過」。
──────────────────────────────────────────────────────────────
SCOPE
}

selftest() {
  printf '=== --selftest:兩個世界必須印不同的東西 ===\n'
  local T1 T2 RC=0
  T1="$(mktemp -t basel)"; T2="$(mktemp -t basel)"

  # 🔴 正對照:Sean 2026-08-29 的原話,決策板上有。撈不到 ⇒ 這支 script 是死的。
  sweep '不用改名' > "$T1" 2>&1
  # 🔴 負對照:現造的字面,五段都必須是零命中。
  # 🔴 **負對照字面【每次現造】,不要寫死** —— 2026-08-29 主視窗把「負對照 ⇒ 0」那句
  #    寫進了它自己要掃的那個檔 ⇒ 下一次量它就回 1(而成因看不出來)。
  #    📌 而一個【被用過的】負對照,已經散在別的檔裡了 —— 它下一次會在【別人的檔】上回 1,
  #       而那時沒有人知道成因。⇒ 現造一個含隨機字尾的,用完就丟。
  local NEG; NEG="ZZQ$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')nowhere"
  sweep "$NEG" > "$T2" 2>&1

  # 🔴 **不要用 `grep -c`** —— 本機的 `grep` 是 ugrep,而它在【零命中】時
  #    **什麼都不印**(不是印 `0`)⇒ 變數會拿到空字串 ⇒ 下面的 `-lt` / `-eq` 當場語法錯,
  #    而更糟的情況是它被算進一個看起來正常的算式。
  #    (2026-08-29 線A 做這支時當場踩到:我用 `grep -c` 量它自己,
  #     三個關鍵字印出「撈到 5 段」而真值是 4/4/5 —— **壞尺印了一個合理的數字**。)
  #    ⇒ 一律 `grep -o … | wc -l`,它零命中時穩定印 0。
  local P N
  P="$(grep -o '零命中' "$T1" | wc -l | tr -d ' ')"
  N="$(grep -o '零命中' "$T2" | wc -l | tr -d ' ')"
  printf '  正對照「不用改名」  ⇒ 五段裡零命中的段數 = %s (期望 < 5)\n' "$P"
  # 🔴 印【真的用了哪一個】—— 舊版印死字面,而實際用的已經是現造的。
  printf '  負對照 %s ⇒ 五段裡零命中的段數 = %s (期望 = 5)\n' "$NEG" "$N"

  if [ "$P" -lt 5 ]; then printf '  ✅ 正對照:它真的撈得到東西\n'; else printf '  🔴 正對照全零 ⇒ 本 script 是死的\n'; RC=1; fi
  if [ "$N" -eq 5 ]; then printf '  ✅ 負對照:現造字面五段全零\n'; else printf '  🔴 負對照有命中 ⇒ 它在亂撈\n'; RC=1; fi


  # ══ 🔴 第二輪的兩發(2026-08-30 加;**這一格是「第二輪成不成立」的唯一判準**)══
  #    沒有它, 第二輪只是「多跑幾次」—— 而多跑幾次不等於多撈到東西。
  local T3 T4 Z3A Z3B Z4A Z4B
  T3="$(mktemp -t basweep3)"; T4="$(mktemp -t basweep4)"

  # 正對照:一個【只有合併成 SCREAMING_SNAKE 才撈得到】的關鍵字。
  #   `shipped email cutoff` ⇒ 第一輪五段全零;而 `SHIPPED_EMAIL_CUTOFF` 撈得到。
  bash "$0" 'shipped email cutoff' > "$T3" 2>&1
  Z3A="$(sed -n '/關鍵字: shipped email cutoff/,/第二輪/p' "$T3" | grep -c '零命中')"
  Z3B="$(sed -n '/關鍵字: SHIPPED_EMAIL_CUTOFF/,/##########/p' "$T3" | grep -c '零命中')"
  printf '\n  第二輪 正對照「shipped email cutoff」\n'
  printf '    第一輪零命中段數 = %s (觀測值, 不是判準 —— 見下方汙染訂正)\n' "$Z3A"
  printf '    第二輪 SHIPPED_EMAIL_CUTOFF 的零命中段數 = %s (期望 < 5)\n' "$Z3B"

  # 負對照:一個現造字面 ⇒ **兩輪都要全零**(否則第二輪只是變得比較會亂命中)。
  local NEG2; NEG2="ZZQ$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')nowhere"
  bash "$0" "$NEG2" > "$T4" 2>&1
  Z4A="$(sed -n "/關鍵字: $NEG2/,/第二輪/p" "$T4" | grep -c '零命中')"
  Z4B="$(grep -c '零命中' "$T4")"
  printf '  第二輪 負對照 %s\n' "$NEG2"
  printf '    第一輪零命中段數 = %s (期望 5)\n' "$Z4A"
  printf '    整份輸出的零命中段數 = %s (期望 = 每一輪都 5 的倍數, 而【不得有任何一段命中】)\n' "$Z4B"

  # 🔴 2026-08-30 訂正:`Z3A -eq 5` 這個判準【自己被汙染了】。
  #    成因(量到的, 不是推的):`31b6f7eb` 那顆 commit 的訊息裡就寫著
  #    `shipped email cutoff` 這個字面(`git log -1 --format=%B 31b6f7eb | grep -c` ⇒ 1)
  #    ⇒ 第①段(掃 commit 訊息)從那一刻起【必定命中】⇒ Z3A 再也不會是 5。
  #    📌 ⇒ **一個測資, 被寫進了它自己的分母** —— 而寫它進去的正是那一片的 commit。
  #    ⇒ ⇒ 而它壞掉的方式是【紅】, 所以還算幸運;同族的另一種是安靜地變綠。
  #    ✅ 改法:判準改成【不依賴 repo 內容】—— 直接看變體清單裡有沒有那個合併形。
  #       那才是這一發真正要證的事(第二輪會不會生出撈得到的字), 而不是「今天撈不撈得到」。
  local HASSNAKE
  HASSNAKE="$(variants_of 'shipped email cutoff' | grep -c '^SHIPPED_EMAIL_CUTOFF$')"
  printf '    變體清單裡有沒有 SHIPPED_EMAIL_CUTOFF ⇒ %s (期望 1)\n' "$HASSNAKE"
  if [ "$HASSNAKE" -eq 1 ] && [ "$Z3B" -lt 5 ]; then
    printf '  ✅ 第二輪【有判別力】:它生得出合併形, 而那個合併形撈得到東西\n'
  else
    printf '  🔴 第二輪沒有判別力 —— 它只是多跑了幾次\n'; RC=1
  fi
  # ⚠️ 而 Z3A 仍然印出來當【觀測值】, 不再當判準 —— 它今天是 4, 那是汙染不是缺陷。

  rm -f "$T1" "$T2" "$T3" "$T4"
  # ══ 🔴 中文切詞那一發(2026-08-30 加)══
  #    舊的兩發都是英文 ⇒ 那把尺從來沒有量過中文, 而使用者九成在打中文。
  #    這一發直接看【變體本身】, 不看撈不撈得到 —— 因為壞掉的變體也可能撈到東西。
  local CJK EXP BAD
  CJK="$(variants_of '揀貨單 尾頁' | sort -u | tr '\n' ' ')"
  EXP="$(printf '%s\n' '揀貨單' '尾頁' '揀貨單尾頁' | sort -u | tr '\n' ' ')"
  printf '  中文切詞 variants_of "揀貨單 尾頁" ⇒ %s\n' "$CJK"
  if [ "$CJK" = "$EXP" ]; then
    printf '  ✅ 中文變體逐字正確(每個都是完整的詞)\n'
  else
    printf '  🔴 中文變體壞掉 —— 期望 [%s]\n' "$EXP"; RC=1
  fi
  # 負對照:任何一個變體不是合法 UTF-8 ⇒ 紅。(舊寫法 tr 會切出半個字)
  BAD="$(variants_of '揀貨單 尾頁' | python3 -c 'import sys
raw = sys.stdin.buffer.read()
try:
    raw.decode("utf-8"); print(0)
except UnicodeDecodeError:
    print(1)')"
  if [ "$BAD" = "0" ]; then
    printf '  ✅ 負對照:沒有任何一個變體是半個字\n'
  else
    printf '  🔴 有變體不是合法 UTF-8 ⇒ 切詞又退回 byte 層了\n'; RC=1
  fi

  if [ "$RC" -eq 0 ]; then printf '⇒ selftest PASS(兩個世界印不同的東西)\n'; else printf '⇒ selftest FAIL\n'; fi
  return "$RC"
}

if [ "$#" -eq 0 ]; then
  printf '用法: bash scripts/before-asking-sean.sh "<關鍵字>" [更多關鍵字…]\n'
  printf '      bash scripts/before-asking-sean.sh --selftest\n\n'
  printf '🔴 關鍵字要用【Sean 會講的話】,不是我們的編號 ——\n'
  printf '   他答「不用改名,依照現在」的時候,不會提 ⟦b4-2PAPERS⟧。\n'
  exit 2
fi

if [ "$1" = "--selftest" ]; then selftest; exit "$?"; fi

for KW in "$@"; do
  sweep "$KW"
  # 🔴 五段全零 ⇒ 自己再跑一輪(而不是印一句話叫人自己想)
  if [ "$ZERO_N" -eq 5 ]; then second_round "$KW"; fi
done
scope_note
