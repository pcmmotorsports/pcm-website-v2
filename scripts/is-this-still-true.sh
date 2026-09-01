#!/usr/bin/env bash
# is-this-still-true.sh — 接一件工作【之前】,先量那一列現在的態。
#
# 🔴 **為什麼是腳本不是規則**(來源 `~/pcm-mailbox/R3-提案-B線訊號設計修法-20260829.md` M3):
#    2026-08-29 一夜,「板子描述一個已經不存在的世界」發生**第五次**,而其中一次是
#    一條被派下去的 **P0 權限漏洞 —— 那個洞兩小時前已經被補好了**。
#    ⇒ 每一次都是被派的人**手工跑同樣那幾發**;而習慣**不可派發**,腳本可以。
#    📌 **同一夜的另一個形狀**:一份提案的前提在【落檔那一刻】就已經過期,
#       **而落檔這個動作本身不會檢查它。**
#
# 🛑 **它不下判斷** —— 只擺證據。照 `scripts/before-asking-sean.sh`(`5fe2839b`)的形狀。
#    理由:一個會下結論的工具,錯的時候沒有人分得出是【它錯】還是【輸入錯】。
#
# 用法:
#   bash scripts/is-this-still-true.sh "<那一列的錨或關鍵字>"
#   bash scripts/is-this-still-true.sh --selftest

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MAILBOX="${HOME}/pcm-mailbox"
# 🔴 拍板落檔的正式落點(`00-work-rules §4`)—— 2026-08-31 補進分母。
MEMDIR="${MEMDIR:-$HOME/.claude/projects/-Users-sean-1-pcm-website-v2/memory}"
# 🔴🔴 **`--since=<今天的日期>` 恆回 0** —— 2026-08-29 線A 實測,而它爆在最需要它的那一天。
#    git 把【光寫今天日期】的 `--since` 解析成「**現在**」,不是「今天 00:00」:
#      `--since=2026-08-29`         ⇒ 0 顆
#      `--since="2026-08-29 00:00"` ⇒ 285 顆   ← 同一天,只多了時間
#    而昨天的日期正常(`--since=2026-08-28` ⇒ 286 顆)⇒ **只有【今天】那一格會爆。**
#    📌 而你最常想問的正是「這件事【今天】有沒有人做掉了」⇒ 那正是唯一會回 0 的那天。
#    ⇒ **本檔的預設值刻意不是今天**;而若你用 env 覆寫成今天的日期, 第①段就會死,
#      **而它會安靜地印「零命中」。⇒ 覆寫時一律寫成 `"<日期> 00:00"`。**
SINCE="${STILL_TRUE_SINCE:-2026-08-20}"

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

# 🔴 標籤由結果決定 —— 本檔自己不得違反 `block-unconditional-echo-label` 那條。
report() {  # report <這一發掃了什麼> <輸出檔>
  if [ -s "$2" ]; then sed 's/^/    /' "$2"
  else printf '    ⇒ 掃了 %s, 零命中\n' "$1"; fi
}
section() { printf '\n═══ %s ═══\n  指令: %s\n' "$1" "$2"; }

sweep() {
  local KW="$1"
  local TMP; TMP="$(mktemp -t stillsweep)"
  printf '\n\n########## 接手前探測: %s ##########\n' "$KW"

  # ① 有人已經修掉了嗎
  section "① 有人已經修掉了嗎(commit 訊息)" "git log --oneline --since=$SINCE --grep=<關鍵字>"
  git -C "$REPO" log --oneline --since="$SINCE" --grep="$KW" > "$TMP" 2>/dev/null
  report "自 $SINCE 起的 commit 訊息" "$TMP"

  # ② 那一列現在的【態】是什麼 —— 🔴 而 `open` 與 `done` 印在同一張表上
  section "② 板子上那一列現在是什麼態" "grep -n <關鍵字> docs/launch-todo.md | 取態欄"
  grep -n -- "$KW" "$REPO/docs/launch-todo.md" 2>/dev/null \
    | awk -F'|' '{printf "%s 態=%s | %s\n", $1, $2, substr($4,1,110)}' > "$TMP"
  report "docs/launch-todo.md" "$TMP"

  # ③ 那個字面現在還在碼裡嗎 —— 它在不在,與板子怎麼寫是兩件事
  section "③ 那個字面現在還在碼裡嗎" "git grep -n <關鍵字> -- apps packages supabase scripts"
  # 🔴🔴 **這裡曾經有一道「排除本檔自己」的過濾,而 2026-08-30 把它拆掉了。**
  #    ⛔ ~~`| grep -v '^scripts/is-this-still-true\.sh:'`~~
  #    成因(2026-08-29):`--selftest` 的負對照字面**寫死在本檔裡**,
  #    而本檔一被 commit(untracked ⇒ tracked),`git grep` 就看得到它
  #    ⇒ 負對照從「五段全零」變成「四段」,而**邏輯一個字都沒改**。
  #    ⇒ 我當時的修法是【排除本檔】—— **而那是錯的修法**:
  #    🔴 **它製造了一個真盲區** —— 實測:掃 `min-height` 時本檔內有 **3 處**命中被它吃掉,
  #       而那三處是真的內容,不是回音。
  #    ✅ **正解**(2026-08-30 線-b4 廣播的形狀):**讓那個形狀在檔案裡不存在** ——
  #       負對照改成【每次現造】(見 `selftest()`),而輸出標籤也改印【真的用了哪一個】
  #       ⇒ 本檔裡不再有任何一個會被自己撈到的固定字面 ⇒ **排除不必要,而盲區沒了。**
  git -C "$REPO" grep -n -- "$KW" -- apps packages supabase scripts 2>/dev/null \
    | cut -c1-200 | head -25 > "$TMP"
  report "apps + packages + supabase + scripts" "$TMP"

  # ④ 🔴 有沒有一段【就地訂正】在推翻它 —— 這一格是最貴的
  #    (今晚兩個實例:`check-anomaly-alerts.ts:74` 的訂正就在原句正下方;
  #     `print-a4.css:96` 的更正在改前那行的 14 行之下,而兩個窗連續引錯同一格。)
  section "④ 它下面有沒有一段在推翻它(就地訂正)" \
          "git grep -n -A10 <關鍵字> | grep -E '~~|訂正|為假|已修|作廢|推翻|已被.*取代'"
  git -C "$REPO" grep -n -A10 -- "$KW" -- . 2>/dev/null \
    | grep -E '~~|訂正|為假|已修|作廢|推翻|已被.{0,12}取代' | cut -c1-200 | head -15 > "$TMP"
  report "全 repo 命中處往下 10 行" "$TMP"

  # ⑤ mailbox 有沒有人交過更正
  section "⑤ 有沒有人交過更正(mailbox)" "grep -rln <關鍵字> ~/pcm-mailbox/*.md"
  grep -rln -- "$KW" "$MAILBOX"/*.md 2>/dev/null | head -12 > "$TMP"
  report "~/pcm-mailbox 的 .md" "$TMP"


  # ⑥ 有沒有一板拍板蓋掉它(memory)
  #    🔴 2026-08-31 補。成因:`-eb` 拿它與 `before-asking-sean.sh` 一起量 ⇒ 兩支都 `grep -c memory` = 0,
  #       而 `~/.claude/rules/00-work-rules.md §4` 逐字寫著「PCM 事實/拍板/進度 → memory `project_*`」
  #       ⇒ 📌 **兩支【專門用來查「這還成不成立」】的工具, 都不看拍板實際住的那個地方。**
  #    ⇒ 而拍板正是最會讓一列作廢的東西 —— 它不留 commit、不進板子、不進 mailbox。
  section "⑥ 有沒有一板拍板蓋掉它(memory)" "grep -rln <關鍵字> ~/.claude/projects/*/memory/"
  grep -rln -- "$KW" "$MEMDIR" 2>/dev/null | head -12 > "$TMP"
  report "memory 拍板檔" "$TMP"
  rm -f "$TMP"
}

# ══ 🔴🔴 **這一棵樹與 dev 差多少 —— 而不印它會產生【假的零】** ═══════════════
#    成因是量到的(2026-09-01 線 `-5b`, 線DB 複驗):在一棵落後 origin/dev 59 顆的
#    工作樹上跑本支查 `⟦b4-ZERODENOM1⟧` ⇒ **五段全部零命中**, 而那一列就在 dev 的板上。
#      那棵樹的板 態列 315 · 命中 0   ·   origin/dev 的板 態列 377 · 命中 4
#    🛑 **而那一發的量測戳看起來完全健康**:HEAD 正常、工作樹 0 項 dirty。
#    📌 **⇒ 判別句(`-5b` 的原句)**:
#       **它守的是「同一棵樹上兩個人的差異」, 而漏的是「這棵樹與 dev 的差異」。**
#       **⇒ 兩個都是分母, 而它只印了一個。**
#    🔵 **⇒ 而修法【不是】改成讀 `origin/dev`** —— 那會換一個方向的假零:
#       「我剛剛 commit 而還沒推」的東西就查不到了。
#       ⇒ ⇒ **兩個方向都有假零 ⇒ 兩邊都印, 而不是選一邊。**
behind_warning() {
  local BEHIND AHEAD
  BEHIND="$(git -C "$REPO" rev-list --count HEAD..origin/dev 2>/dev/null)"; BEHIND="${BEHIND:-未知}"
  AHEAD="$(git -C "$REPO" rev-list --count origin/dev..HEAD 2>/dev/null)"; AHEAD="${AHEAD:-未知}"
  if [ "$BEHIND" != "0" ]; then
    printf '\n   🔴🔴 ⚠️  這棵樹【落後 origin/dev %s 顆】—— 本支所有 grep 讀的是【這棵樹】\n' "$BEHIND"
    printf '   🔴🔴     ⇒ 那 %s 顆裡新增的板子列、碼、註解, 本支【一個字都看不到】\n' "$BEHIND"
    printf '   🔴🔴     ⇒ 而它會印成【零命中】, 而零命中讀起來像「這件事沒有人碰過」\n'
    printf '   🔴🔴     ⇒ 先 `git pull --ff-only`(或到主樹跑)再重跑, 不要用這一發的零下結論\n'
  else
    printf '   🔵 落後 origin/dev 0 顆(這棵樹的板與 dev 同步)\n'
  fi
  if [ "$AHEAD" != "0" ]; then
    printf '   🔵 領先 origin/dev %s 顆 —— 那幾顆【只有這棵樹看得到】, 別棵樹跑同一發會少那些命中\n' "$AHEAD"
  fi
  printf '   ⚠️ 而 origin/dev 是【本地那份 ref】—— 它可能是舊的, 而它不會說。要遠端實況跑 git ls-remote\n'
}

stamp_and_scope() {
  local T H DIRTY
  T="$(date '+%Y-%m-%d %H:%M')"
  H="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)"; H="${H:-未知}"
  DIRTY="$(git -C "$REPO" status --porcelain 2>/dev/null | grep -c '')"
  printf '\n──────────────────────────────────────────────────────────────\n'
  printf '📋 貼進交件檔頭用(paste-ready):\n'
  printf '   量測 @ %s · HEAD %s · 工作樹 %s 項未 commit\n' "$T" "$H" "$DIRTY"
  printf '   🔴 那個「%s 項未 commit」不是雜訊 —— 八窗共用一棵樹,\n' "$DIRTY"
  printf '      HEAD 相同而工作樹不同,量到的就不是同一份碼。\n'
  behind_warning
  cat <<'SCOPE'
──────────────────────────────────────────────────────────────
🛑 這一發【掃不到】什麼:
   · 別的 session 的對話 —— 2026-08-29 那一夜，有三個答案只住在對話裡
   · 正式庫的實際狀態 —— 旗標現值 / RLS 開沒開 / 表裡幾列，本檔一格都答不出
   · OD 設計稿 —— 稿不在 repo 裡
   · 別的 repo（PCM_Quote / 老闆腦）
🔴 ⇒ 所以【六段全零】的意思是「這六個載體裡沒有」，不是「它還成立」。
   ✅ ⑥(memory 拍板檔)是 2026-08-31 才加的 —— 在那之前這支工具看不到任何一板拍板。
──────────────────────────────────────────────────────────────
SCOPE
}

selftest() {
  printf '=== is-this-still-true --selftest ===\n'
  local RC=0 T1 T2 P N
  T1="$(mktemp -t itst)"; T2="$(mktemp -t itst)"

  # 🔴 正對照:一個【今晚確定被改過】的字面 —— `min-height` 那件有 commit、有碼、有訂正。
  sweep 'min-height' > "$T1" 2>&1
  # 🔴 負對照:現造字面,五段全零。
  # 🔴 **負對照字面【每次現造】,不要寫死** —— 2026-08-29 主視窗把「負對照 ⇒ 0」那句
  #    寫進了它自己要掃的那個檔 ⇒ 下一次量它就回 1(而成因看不出來)。
  #    📌 而一個【被用過的】負對照,已經散在別的檔裡了 —— 它下一次會在【別人的檔】上回 1,
  #       而那時沒有人知道成因。⇒ 現造一個含隨機字尾的,用完就丟。
  local NEG; NEG="ZZQ$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')nowhere"
  sweep "$NEG" > "$T2" 2>&1

  P="$(grep -o '零命中' "$T1" | wc -l | tr -d ' ')"   # ← 不用 grep -c(本機是 ugrep,零命中時不印)
  N="$(grep -o '零命中' "$T2" | wc -l | tr -d ' ')"
  SEG="$(grep -o '^═══ [①②③④⑤⑥⑦⑧⑨]' "$T1" | wc -l | tr -d ' ')"
  printf '  正對照 min-height ⇒ %s 段裡零命中 %s 段(期望 < %s)\n' "$SEG" "$P" "$SEG"
  # 🔴 印【真的用了哪一個】,不印一個過期的名字 —— 舊版這裡印的是一個**寫死的字面**,
  #    而實際用的已經是現造的 ⇒ 讀的人會以為它還是寫死的(而那正是本檔要防的病)。
  # 🔴🔴 **而這一行註解本身也踩過一次**:我第一版在這裡**把那個舊字面又寫了一遍**當例子
  #    ⇒ 那個形狀就又回到檔案裡了 ⇒ **而 `--selftest` 照樣 PASS**(它只驗現造那一發)。
  #    📌 **⇒ 解釋一個坑的文字,用了那個坑本身的材料** —— 而它不會被任何自檢抓到。
  #    ⇒ 所以這裡刻意**不寫出那個字面**,只描述它的形狀。
  printf '  負對照 %s ⇒ %s 段裡零命中 %s 段(期望 = %s)\n' "$NEG" "$SEG" "$N" "$SEG"
  if [ "$P" -lt "$SEG" ]; then printf '  ✅ 正對照:它真的撈得到\n'; else printf '  🔴 正對照全零 ⇒ 本 script 是死的\n'; RC=1; fi
  if [ "$N" -eq "$SEG" ]; then printf '  ✅ 負對照:現造字面全段零命中\n'; else printf '  🔴 負對照有命中 ⇒ 它在亂撈\n'; RC=1; fi

  # 🔴 突變:量測戳若印不出 HEAD,那一行就沒有分母 ⇒ 必須抓得到
  if stamp_and_scope | grep -q 'HEAD '; then printf '  ✅ 量測戳含 HEAD\n'
  else printf '  🔴 量測戳沒有 HEAD ⇒ 那一行沒有分母\n'; RC=1; fi

  rm -f "$T1" "$T2"
  if [ "$RC" -eq 0 ]; then printf '⇒ selftest PASS(兩個世界印不同的東西)\n'; else printf '⇒ selftest FAIL\n'; fi
  return "$RC"
}

if [ "$#" -eq 0 ]; then
  printf '用法: bash scripts/is-this-still-true.sh "<那一列的錨或關鍵字>"\n'
  printf '      bash scripts/is-this-still-true.sh --selftest\n\n'
  printf '🔴 接一件工作【之前】跑它 —— 而不是做完之後。\n'
  printf '🔴 而【板列的錨、與他的原話,要各跑一次】。\n'
  printf '   2026-08-29 我拿本工具檢查自己的交件時量到:同一件事,兩個識別字結果相反 ——\n'
  printf '   錨那一發說「還開著」,而用他的原話那一發,當場撈到他已經答過的那份決策檔。\n'
  printf '   ⇒ 工具沒壞,是【輸入】的問題:我們用編號,而他答的時候不會用編號。\n'
  printf '   (同一句紀律 scripts/before-asking-sean.sh 檔頭就有 —— 我在那支寫了,這支忘了套。)\n'
  printf '   2026-08-29 一夜,「板子描述一個已經不存在的世界」發生第五次,\n'
  printf '   其中一次是一條被派下去的 P0,而那個洞兩小時前已經被補好了。\n'
  exit 2
fi

if [ "$1" = "--selftest" ]; then selftest; exit "$?"; fi
for KW in "$@"; do sweep "$KW"; done
stamp_and_scope
