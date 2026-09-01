#!/usr/bin/env bash
# 代推:預告 → push → 【當場量】回填。
#
# 🔴 為什麼有這支:2026-09-01 夜, 主視窗代推那條鏈的「預告」那一步漏了三次,
#    而三次的成因不同(記憶 / 用 push origin dev 而非釘 hash / 急事擠掉)⇒ 提醒治不好。
#    改成寫進一個所有人都撈得到的檔(~/pcm-mailbox/推送預告-<date>.md)。
# 🔴 而那張表上線第一發就被手填錯:「實際推到」那一欄在 push 還在跑的時候量
#    ⇒ 填成起點 ⇒ 印「🔴 不相等」⇒ 而假警報【看起來像那把尺在工作】, 沒有人會去查。
#    ⇒ 所以那一欄不手填 —— 由本腳本在 rc 印出來【之後】跑 git ls-remote 貼進去。
#    ⇒ ⇒ 它填錯的唯一方式變成【沒填】, 而空白看得出來。
#
# 用法:bash scripts/announce-and-push.sh [<要推的 commit-ish, 預設 dev>]
# 出口:0=推成功且兩欄相等 · 1=push 失敗 · 2=推成功但兩欄不相等(真事故) · 3=用法錯
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 3

TARGET="${1:-dev}"
TIP="$(git rev-parse --short "$TARGET" 2>/dev/null)" || { echo "🔴 解不出 $TARGET"; exit 3; }
FROM="$(git rev-parse --short origin/dev 2>/dev/null)"
LEDGER="$HOME/pcm-mailbox/推送預告-$(date '+%Y%m%d').md"
LOG="$(mktemp -t announce-push)"

if [ ! -f "$LEDGER" ]; then
  {
    printf '%s\n' "# 推送預告 —— 主視窗代推的單一落點"
    printf '%s\n' ""
    printf '%s\n' "> **收到 push 警示 ⇒ 先 tail 這支檔。** 有對應那一行 ⇒ 不是事故。沒有 ⇒ 那才要叫。"
    printf '%s\n' "> 🔴 「實際推到」由 scripts/announce-and-push.sh 在 rc 之後跑 ls-remote 填 —— 不手填。"
    printf '%s\n' ""
    printf '%s\n' "| 時刻 | 從 | 預告終點 | 實際推到 | 相不相等 |"
    printf '%s\n' "|---|---|---|---|---|"
  } > "$LEDGER"
fi

# 預告先落檔, 再 push —— 順序不能反, 反了就不是預告
printf '| %s | %s | %s | (推中) | — |\n' "$(date '+%H:%M')" "$FROM" "$TIP" >> "$LEDGER"
echo "📢 預告已落檔:$LEDGER"
echo "   origin/dev 會從 $FROM 走到 $TIP"

git push origin "$TIP":refs/heads/dev > "$LOG" 2>&1 ; RC=$?
echo "   push rc=$RC · log=$LOG"

if [ "$RC" -ne 0 ]; then
  # 失敗也要留痕 —— 一個沒有結果的預告, 與一個成功的推, 在表上不能長一樣
  python3 - "$LEDGER" "PUSH-FAILED(rc=$RC)" "🔴 推失敗" <<'PY'
import io,sys
p,act,eq=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| %s | %s |'%(act,eq),1)
io.open(p,'w',encoding='utf-8').write(s)
PY
  tail -25 "$LOG"
  exit 1
fi

# 🔴 只有到這裡才量 —— rc 已經印出來了
ACT="$(git ls-remote origin refs/heads/dev 2>/dev/null | cut -c1-8)"
if [ "$ACT" = "$TIP" ]; then EQ="✅ 相等"; OUT=0; else EQ="🔴 不相等"; OUT=2; fi

python3 - "$LEDGER" "$ACT" "$EQ" <<'PY'
import io,sys
p,act,eq=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s=s.replace('| (推中) | — |','| %s | %s |'%(act,eq),1)
io.open(p,'w',encoding='utf-8').write(s)
PY

echo "   ls-remote 實測 = $ACT ⇒ $EQ"
tail -1 "$LEDGER"
exit "$OUT"
