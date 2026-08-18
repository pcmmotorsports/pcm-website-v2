#!/bin/bash
# who-is-touching.sh — 「這條 backlog 現在有沒有人在動?」唯讀查詢
#
# 用法:  bash scripts/who-is-touching.sh 528 [477 ...]
#
# ── 為什麼有這支(2026-08-19 主視窗裁,G6 實作)────────────────────────────────
# 🔴 backlog 的狀態欄**沒有任何一格代表「有人現在正在改」**。
#    (2026-08-19 實數,可重跑:
#      grep -cE '^- \*\*狀態:\*\*.*(進行中|施工中|開工中|in progress|正在做)' docs/phase-1-backlog.md ⇒ **0**
#      負向對照 grep -cE '^- \*\*狀態:\*\*.*待執行' ⇒ **240**;條目總數 600;相異狀態值 **100 種**
#      ⚠️ 更正:本檔第一版寫「狀態欄只有待執行/已完成**兩格**」—— **那是假的**,實數 100 種。
#         真正成立的是窄版:**那 100 種裡沒有一種是「進行中」。**)
# ⇒ 挑條目的人看到 `⏳` 會以為沒人碰,而實際上別窗的工作樹裡正改著同一批檔
#    (2026-08-19 一晚**多個窗**因此互相吃掉未 commit 的東西。
#     ⚠️ **「四個」這個數字我沒有自己數過** —— 它來自主視窗轉述
#        (它列了 G2 `79a67170` / G6 `4fe7c975` / G4 `42002997` 三顆,
#         我自己另被 `bbc01a95` 吃過一次)⇒ **至少 3 顆有 commit hash 可查,總數未確認。**)
# 🔴 **而主視窗明文裁定「不加第三格狀態欄」** —— 理由:那一格要人維護,
#    而「做完沒回頭改紙」正是當晚數到六次的那個病。
# ⇒ 本腳本是那一格的替代:**不靠人維護,靠 `git status` 這個一直是真的東西。**
#
# ── 天花板(它答得出什麼、答不出什麼)──────────────────────────────────────
# 答得出:「**這支檔現在有人在改**」
# 答不出:「**他改的是不是這一條**」—— 同一支檔可以同時裝著別件事。
#         (來源:G6 查 `#528` 時只從檔名對上載體、沒讀那五支的 diff,那就是本腳本的上限。)
# 🔴 三種世界要分得開,不是兩種:①有人在改 ②沒人在改 ③**查不出來**(條目沒點名任何檔)。
#    ②與③在「沒印出東西」時長得一樣 —— 那正是本專案反覆犯的那一族。
#
# 唯讀:只 `grep` 與 `git status`,不改任何檔、不動 index、不 commit。

set -u
BACKLOG="docs/phase-1-backlog.md"
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "不在 git repo 裡"; exit 2; }
[ -f "$BACKLOG" ] || { echo "找不到 $BACKLOG"; exit 2; }
[ $# -ge 1 ] || { echo "用法: bash scripts/who-is-touching.sh <backlog 號> [更多號...]"; exit 2; }

# 當下工作樹裡「有未 commit 改動」的檔(含 staged 與 untracked)。快照,會過期。
DIRTY="$(git status --porcelain | sed 's/^...//')"

for N in "$@"; do
  echo "════════ #${N} ════════"
  START="$(grep -n "^### #${N}\." "$BACKLOG" | head -1 | cut -d: -f1)"
  if [ -z "$START" ]; then
    echo "  ③ 查不出來 —— $BACKLOG 裡找不到 '### #${N}.'(號碼打錯,或那條不存在)"
    continue
  fi
  # 條目範圍 = 本標題到下一個 '### #' 之前
  NEXT="$(tail -n "+$((START+1))" "$BACKLOG" | grep -n '^### #' | head -1 | cut -d: -f1)"
  [ -n "$NEXT" ] && END=$((START+NEXT-1)) || END="$(wc -l < "$BACKLOG")"

  # 條目點名的檔案路徑(去重)。只認 repo 內四個常見根目錄,避免撈到網址與雜訊。
  PATHS="$(sed -n "${START},${END}p" "$BACKLOG" \
    | grep -oE '(apps|packages|supabase|scripts)/[A-Za-z0-9._/-]+\.[a-z]{1,4}' \
    | sort -u)"

  if [ -z "$PATHS" ]; then
    echo "  ③ 查不出來 —— 這條**沒有點名任何 repo 內的檔案路徑**"
    echo "     ⇒ 這【不是】「沒有人在動」。本腳本對它零判別力。"
    continue
  fi

  HITS=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if printf '%s\n' "$DIRTY" | grep -qxF "$p"; then
      echo "  🔴 有人在改  $p"
      HITS=$((HITS+1))
    fi
  done <<< "$PATHS"

  TOTAL="$(printf '%s\n' "$PATHS" | grep -c .)"
  if [ "$HITS" -eq 0 ]; then
    echo "  ✅ 沒有人在改 —— 條目點名的 ${TOTAL} 支檔,工作樹裡一支都是乾淨的"
  else
    echo "  ⇒ 條目點名 ${TOTAL} 支,其中 ${HITS} 支現在有未 commit 的改動"
  fi
  echo "     (點名的檔:$(printf '%s\n' "$PATHS" | tr '\n' ' '))"
done

cat <<'EOF'

────────────────────────────────────────────────────────────
🔴 這是【當下 git status 的快照】,你讀到的那一刻它可能已經變了。要現值就重跑。
🔴 它答得出「有人在改這支檔」,答不出「他改的是不是這一條」。
🔴 「✅ 沒有人在改」與「③ 查不出來」是**兩個不同的答案**,不要都讀成「沒事」。
🔴 誤報來源(已知,未修):它抓的是**條目裡出現過的任何路徑** ——
   包含寫在「查核紀錄 / 已修紀錄」裡的路徑,那些**不一定是這條要改的目標**。
   ⇒ 命中之後仍要開條目看那個路徑是以什麼身分出現的。
EOF
