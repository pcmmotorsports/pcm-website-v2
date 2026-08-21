#!/bin/sh
# reserve-backlog-stale-gate.harness.sh — 讓「計數器落後守門」自己表演該紅與該綠的那幾發
#
# 🔴 為什麼一定要有這支:被它擋住的那道閘,2026-08-21 之前【量了 181 次都沒紅過】,
#    因為沒有人再看它。一道沒表演過的閘,「它會擋」只是註解,不是量到的。
#
# 用法:sh scripts/reserve-backlog-stale-gate.harness.sh
# 🔴 不碰正式計數器 refs/pcm/counters/backlog —— 除了【第 1 格】,那格刻意用真的,
#    因為今天的真實狀態(641 落後 822)就是最好的紅對照,而假造的紅證明不了它在真環境會紅。
#    第 1 格只跑 --show(唯讀,不配號)。
#
# 每格印:期望 / 實得 / PASS|FAIL。任一 FAIL ⇒ 整支 exit 1。
set -u
cd "$(dirname "$0")/.."

TMPREF=refs/pcm/counters/backlog-harness-$$
cleanup() { git update-ref -d "$TMPREF" 2>/dev/null || true; }
trap cleanup EXIT

FLOOR=$(bash scripts/next-backlog-number.sh --floor 2>/dev/null)
case "$FLOOR" in ''|*[!0-9]*)
  echo "🔴 harness 自己壞了:拿不到 floor(得到 '$FLOOR')⇒ 本次輸出作廢" >&2; exit 2 ;;
esac
echo "檔案側 floor = $FLOOR   (bash scripts/next-backlog-number.sh --floor)"
echo

# ══ 🔴 BL-1 折(2026-08-21 R1):在用 FLOOR 之前,先【用另一條路】驗它 ══════════
# 審查者指出的病:harness 與被測的閘拿 floor 用【逐字同一條命令】
#   ⇒ `--floor` 若回一個【錯的數字】(不是非數字 —— 那條格 5 擋了),
#     閘拿它判、harness 拿它擺 temp ref ⇒ **兩邊一起偏同一個方向 ⇒ 五格照樣全 PASS**。
#   ⇒ 而 `--floor` 是這個 diff 新加的出口,**它自己原本沒有任何測試**。
# 下面兩發【不呼叫 --floor】,直接問檔案 —— 兩條路獨立,才不是一個證據複印兩份。
# ⚠️ 限度:floor 取三層最大(主樹/worktree/branch),**可以合法地大於主樹最大值**
#   ⇒ 所以只能斷言「floor >= 主樹最大」與「floor+1 在主樹沒人用」,不能斷言相等。
WT_MAX=$(grep -oE '^### #[0-9]+' docs/phase-1-backlog.md | grep -oE '[0-9]+' | sort -n | tail -1)
NEXT_USED=$(grep -c "^### #$((FLOOR+1))" docs/phase-1-backlog.md)
FLOOR_BAD=0
if [ "$FLOOR" -lt "$WT_MAX" ]; then
  printf '  ❌ FAIL  --floor 獨立核驗:floor=%s 小於主樹最大 %s ⇒ 它漏看了主樹\n' "$FLOOR" "$WT_MAX"; FLOOR_BAD=1
else
  printf '  ✅ PASS  --floor 獨立核驗:floor=%s >= 主樹最大 %s\n' "$FLOOR" "$WT_MAX"
fi
if [ "$NEXT_USED" != "0" ]; then
  printf '  ❌ FAIL  --floor 獨立核驗:floor+1 = #%s 在主樹【已經有人用】⇒ floor 偏低\n' "$((FLOOR+1))"; FLOOR_BAD=1
else
  printf '  ✅ PASS  --floor 獨立核驗:floor+1 = #%s 主樹零命中(那個號真的可用)\n' "$((FLOOR+1))"
fi
# ── 🔴 BL-3 折(2026-08-21 R2):上界。上面兩發【只擋得住 floor 偏低】────────
# 審查者實測:floor=900 或 floor=20260821(離譜的大數)⇒ 上面兩發【全 PASS】
#   ⇒ `--floor` 哪天撈進一個不該進來的大數(日期 / 版本號 / 貼錯的字串)
#   ⇒ 三發全過 ⇒ 七格全過 ⇒ **而那道閘從此對所有人回 exit 1,永遠。**
#   ⇒ 那是**誤擋**方向,而「誤擋會把人趕出守門的視野」是本檔格 4 自己寫的話。
# 上界檢查不用新發明:floor 的定義是「三層裡【用過的】最大號」⇒ **`#floor` 自己必須存在。**
# ⚠️ 要在【三層】都找 —— floor 可以合法地來自 worktree 或 branch 而不在主樹
#    (那正是三層掃描存在的理由)。只找主樹會把一個合法的 floor 誤判成離譜。
# ⚠️ zsh 陷阱:`git show $r:path` 未加大括號會被吃掉 ⇒ 一律 `${r}:path`(memory 有實錘)
FLOOR_SEEN=$(grep -c "^### #$FLOOR" docs/phase-1-backlog.md)
if [ "$FLOOR_SEEN" = "0" ]; then
  for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
    # 🔴 這裡【不能】接 `|| echo 0`:grep -c 沒命中時**已經印了 0**、然後 exit 1
    #    ⇒ `|| echo 0` 會再印一個 ⇒ n 變成兩行的 "0\n0" ⇒ `!= "0"` 成立 ⇒ **誤判成找到**。
    #    2026-08-21 實測:本檢查對 floor=900 / 20260821 都回 PASS —— 它抓不到它要抓的東西。
    #    ⇒ 用 `|| true` 吞掉 exit code 而不多印東西。
    n=$(grep -c "^### #$FLOOR" "$w/docs/phase-1-backlog.md" 2>/dev/null || true)
    [ "${n:-0}" != "0" ] && { FLOOR_SEEN=$n; break; }
  done
fi
if [ "$FLOOR_SEEN" = "0" ]; then
  for r in $(git for-each-ref --format='%(refname)' refs/heads); do
    n=$(git show "${r}:docs/phase-1-backlog.md" 2>/dev/null | grep -c "^### #$FLOOR" || true)
    [ "${n:-0}" != "0" ] && { FLOOR_SEEN=$n; break; }
  done
fi
if [ "$FLOOR_SEEN" = "0" ]; then
  printf '  ❌ FAIL  --floor 上界核驗:#%s 自己在【三層都找不到】⇒ floor 不是一個用過的號\n' "$FLOOR"
  printf '           (離譜的大數會讓那道閘對所有人恆擋 —— 誤擋方向,比漏擋更難發現)\n'; FLOOR_BAD=1
else
  printf '  ✅ PASS  --floor 上界核驗:#%s 自己找得到(三層,%s 處)⇒ 不是憑空的大數\n' "$FLOOR" "$FLOOR_SEEN"
fi
# 負對照:同一段邏輯餵一個【一定不存在】的號,必須說「找不到」
if [ "$(grep -c '^### #20260821' docs/phase-1-backlog.md)" = "0" ]; then
  printf '  ✅ PASS  上界負對照:對 #20260821(離譜大數)回 0 ⇒ 這一發分得開兩個世界\n'
else
  printf '  ❌ FAIL  上界負對照:對 #20260821 回非 0 ⇒ 這把尺量不到東西,上界那發作廢\n'; FLOOR_BAD=1
fi

# 負對照:讓同一把尺對一個【一定被用過】的號說「有人用」,證明它不是恆回 0
CTRL=$(grep -c "^### #$WT_MAX" docs/phase-1-backlog.md)
if [ "$CTRL" -ge 1 ]; then
  printf '  ✅ PASS  負對照:同一把尺對 #%s 回 %s(非恆 0,有判別力)\n' "$WT_MAX" "$CTRL"
else
  printf '  ❌ FAIL  負對照:同一把尺對 #%s 回 0 ⇒ 這把尺量不到東西,上面兩發作廢\n' "$WT_MAX"; FLOOR_BAD=1
fi
if [ "$FLOOR_BAD" -ne 0 ]; then
  echo; echo "🔴 FLOOR 本身沒通過獨立核驗 ⇒ 底下五格【全部作廢】(它們都建立在這個數字上),exit 2" >&2
  exit 2
fi
echo

fails=0
chk() { # <格名> <期望rc> <實得rc>
  if [ "$2" = "$3" ]; then printf '  ✅ PASS  %s   期望 rc=%s 實得 rc=%s\n' "$1" "$2" "$3"
  else printf '  ❌ FAIL  %s   期望 rc=%s 實得 rc=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

set_ref() { printf '%s\n' "$1" | git hash-object -w --stdin | xargs -I{} git update-ref "$TMPREF" {}; }

# ── 格1:真的計數器(唯讀)。今天它落後 ⇒ 必須紅 ────────────────────────────
REAL=$(git cat-file -p "$(git rev-parse refs/pcm/counters/backlog)" 2>/dev/null || echo '')
sh scripts/reserve-backlog.sh --show >/dev/null 2>&1; rc=$?
if [ -n "$REAL" ] && [ "$REAL" -lt "$FLOOR" ] 2>/dev/null; then
  chk "真計數器落後($REAL < $FLOOR)⇒ 該紅" 1 "$rc"
else
  chk "真計數器已對齊($REAL >= $FLOOR)⇒ 該綠" 0 "$rc"
  echo "     ⚠️ 本格的期望值隨真實狀態翻面 —— 對齊之後這一格就不再是紅對照了,"
  echo "        紅對照請看格2(它不依賴真實狀態)"
fi

# ── 格2:計數器落後 1 ⇒ 必須紅(不依賴真實狀態的紅對照)──────────────────
set_ref "$((FLOOR-1))"
PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "計數器 $((FLOOR-1)) 落後 1 ⇒ 該紅" 1 "$?"

# ── 格3:剛好對齊 ⇒ 必須綠(邊界:cur == floor,它要配 floor+1,沒人用)────
set_ref "$FLOOR"
PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "計數器 $FLOOR 剛好對齊 ⇒ 該綠(邊界)" 0 "$?"

# ── 格4:計數器【超前】檔案 ⇒ 必須綠 ─────────────────────────────────────
# 🔴 主視窗 2026-08-21 指定要驗的那一發。反方向是本檔「已知限制 4」描述的正常交接期
#    (配號成功、條目還沒 commit,檔案側必然少報)。做成「兩邊不等就紅」的閘,
#    會在對齊之後天天誤擋 —— 而誤擋會把人趕出守門的視野,比漏擋更難發現。
set_ref "$((FLOOR+100))"
PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "計數器 $((FLOOR+100)) 超前檔案 ⇒ 該綠(不得誤擋)" 0 "$?"

# ── 格5:計數器值不是數字 ⇒ 必須 exit 2(量具壞了,與「有落後」分得開)──────
set_ref "這不是數字"
PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "計數器值非數字 ⇒ 該 exit 2(不是 1)" 2 "$?"

# ── 格6/7:逃生門(2026-08-21 R1 BL-2 折;原本【零表演】)────────────────────
# 逃生門放行的是「我知道它落後、我就是要配」,**不是**「這顆 ref 是不是壞的」。
set_ref "$((FLOOR-1))"
PCM_ALLOW_STALE_BACKLOG_COUNTER=1 PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "逃生門開 + 計數器落後 ⇒ 該放行" 0 "$?"

set_ref "這不是數字"
PCM_ALLOW_STALE_BACKLOG_COUNTER=1 PCM_BACKLOG_REF="$TMPREF" sh scripts/reserve-backlog.sh --show >/dev/null 2>&1
chk "逃生門開 + 計數器【壞了】⇒ 仍該 exit 2(逃生門跳不過健全性檢查)" 2 "$?"

echo
echo "🔴 未表演的那一格(照 scripts-whitelist-gate 的先例,寫出來不假裝驗過):"
echo "   ·「--floor 拿不到數字 ⇒ exit 2」這條路【沒有表演過】——"
echo "     要餵它一發得動 scripts/next-backlog-number.sh 本身,而八個窗共用這棵樹,"
echo "     突變一支共用檔的風險大於這格的價值(docs/patterns/mutation-harness-restore.md)。"
echo "   ⇒ 那個 exit 2 目前是【讀 code 得到的】,不是量到的。誰要依賴它,先去餵它一發。"
echo
[ "$fails" -eq 0 ] && { echo "全格 PASS"; exit 0; }
echo "$fails 格 FAIL"; exit 1
