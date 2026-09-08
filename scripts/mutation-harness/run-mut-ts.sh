#!/usr/bin/env bash
# TS 突變 harness —— ⟦#787 開封⟧
# 🔴 三條紀律(主視窗 A 2026-09-08 立), 而本支把它們做成機制不是提醒:
#   ① 每發只退【一道】, 而記錄它紅在【哪一格】
#   ② 第一發固定 M0(不突變)且必須綠, 印在最上面
#   ③ 同一發突變在【修之前 vs 修之後】各紅幾格 = 這次修法加了多少牙
# 🛑 而「突變沒套用上」(anchor 對不上)一律計入【作廢】, 不計入覆蓋。
set -uo pipefail
cd /Users/sean_1/pcm-wt-mainB
HERE="$(cd "$(dirname "$0")" && pwd)"
# 🔴 **暫存不寫進 repo** —— 備份檔與逐發 log 落在 repo 裡的話, 下一個人的 `git status`
#    會看到一堆它看不懂的東西, 而更糟的是【它們可能被 git add 進去】。
#    ⇒ 而那正是本 repo 已經發生過一次的事(2026-08-16 一份被突變的 migration 進了正式分支)。
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pcm-mut-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
SP="$WORK"
T='apps/admin/src/app/orders/[id]/refund-wiring.test.tsx'
F='apps/admin/src/components/orders/manual-refund-entry-section.tsx'
VARIANT="${VARIANT:?請帶 VARIANT=現版|簡版}"
cp "$F" "$SP/F.bak"; cp "$T" "$SP/T.bak"
[ "$VARIANT" = "簡版" ] && python3 "$HERE/to-simple.py"
KILLED=0; SURVIVED=0; VOID=0
for M in M0 M1 M2 M3 M4; do
  cp "$SP/F.bak" "$F"
  python3 "$HERE/mut-ts.py" "$M" > "$SP/mk.txt" 2>&1
  RC=$?
  if [ "$RC" -eq 9 ]; then
    echo "$VARIANT $M | 🛑 作廢 —— 突變沒套用上:$(cat "$SP/mk.txt")"; VOID=$((VOID+1)); continue
  fi
  TURBO_FORCE=1 npx vitest run "$T" > "$SP/r-$VARIANT-$M.log" 2>&1
  FRC=$?
  TF=$(/usr/bin/grep -oE 'Test Files +[0-9]+' "$SP/r-$VARIANT-$M.log" | head -1 | /usr/bin/grep -oE '[0-9]+')
  if [ -z "${TF:-}" ] || [ "$TF" -eq 0 ]; then
    echo "$VARIANT $M | 🛑 作廢 —— 餵 1 條而它跑 ${TF:-0} 支(那一發什麼都沒問到)"; VOID=$((VOID+1)); continue
  fi
  RED=$(/usr/bin/grep -oE 'Tests +[0-9]+ failed' "$SP/r-$VARIANT-$M.log" | head -1 | /usr/bin/grep -oE '[0-9]+')
  RED=${RED:-0}
  WHERE=$(/usr/bin/grep -m1 -oE '× .{0,46}' "$SP/r-$VARIANT-$M.log")
  if [ "$M" = "M0" ]; then
    if [ "$FRC" -eq 0 ]; then echo "$VARIANT M0 | ✅ 不突變 ⇒ 綠(基準線成立)"
    else echo "$VARIANT M0 | 🛑🛑 不突變就紅了 ⇒ 本輪全部作廢, 後面每一發的紅都不可信"; VOID=9; break; fi
    continue
  fi
  if [ "$FRC" -eq 0 ]; then
    echo "$VARIANT $M | 🔴 存活 —— 紅 0 ⇒ 這一處【沒有人在守】"; SURVIVED=$((SURVIVED+1))
  else
    echo "$VARIANT $M | ✅ 殺死 —— 紅 $RED 格 · ${WHERE:-<未擷取>}"; KILLED=$((KILLED+1))
  fi
done
cp "$SP/F.bak" "$F"; cp "$SP/T.bak" "$T"
echo "── $VARIANT:殺死 $KILLED · 存活 $SURVIVED · 作廢 $VOID ──"
# 🔴 **還原之後自己核一次** —— 「腳本裡有還原那一行」與「它真的還原了」是兩個宣稱。
#    🛑 而下面【刻意不用無條件的 echo】:一句寫死的「已還原」在【沒還原】時照樣印,
#       而它就印在那個災難的正下方。⇒ 判定寫進條件式。
DIRTY="$(git -C /Users/sean_1/pcm-wt-mainB status --porcelain -- "$F" "$T" | wc -l | tr -d ' ')"
[ "$DIRTY" = "0" ] \
  && echo "收場核對:那兩支檔對 git 是乾淨的(dirty=0)" \
  || { echo "🛑🛑 還原沒有成功 —— 那兩支檔仍然 dirty=$DIRTY。自己看一眼, 不要 commit。"; exit 1; }
