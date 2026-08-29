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
SINCE="${BEFORE_ASKING_SINCE:-2026-08-01}"

# 🔴 標籤一律由結果決定 —— 本檔自己不得違反 `block-unconditional-echo-label` 那條。
#    (那條的成因:`cmd; echo "(空 = 零命中)"` 在【有命中】時照樣印,而它就印在命中的正下方。)
report() {  # report <這一發掃了什麼> <輸出檔>
  if [ -s "$2" ]; then
    sed 's/^/    /' "$2"
  else
    printf '    ⇒ 掃了 %s, 零命中\n' "$1"
  fi
}

section() { printf '\n═══ %s ═══\n  指令: %s\n' "$1" "$2"; }

sweep() {
  local KW="$1"
  local TMP; TMP="$(mktemp -t basweep)"

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
  sweep 'ZZQ6641不存在的關鍵字' > "$T2" 2>&1

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
  printf '  負對照 ZZQ6641…     ⇒ 五段裡零命中的段數 = %s (期望 = 5)\n' "$N"

  if [ "$P" -lt 5 ]; then printf '  ✅ 正對照:它真的撈得到東西\n'; else printf '  🔴 正對照全零 ⇒ 本 script 是死的\n'; RC=1; fi
  if [ "$N" -eq 5 ]; then printf '  ✅ 負對照:現造字面五段全零\n'; else printf '  🔴 負對照有命中 ⇒ 它在亂撈\n'; RC=1; fi

  rm -f "$T1" "$T2"
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

for KW in "$@"; do sweep "$KW"; done
scope_note
