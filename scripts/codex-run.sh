#!/usr/bin/env bash
#
# codex CLI 包裝器 —— 消滅「零輸出 = 不知道發生什麼事」這類誤歸因。
#
# 2026-07-29 實錄:同一天三次 codex 「逾時」被寫進交接檔,事後查其實至少三種不同原因
#   ①沒導 stdin,codex 停在 "Reading additional input from stdin..." 永久等待
#   ②被外部 SIGTERM 砍掉(不是 codex 的問題;🔴 而且 codex 被砍仍回報 exit 0)
#   ③接了 `| tail`,管線把輸出憋到程式結束才吐 → 看起來像零輸出、其實在跑
# 這三種在「零輸出」的表象下長得一模一樣,於是被歸成同一類、觸發換路決策。
#
# 用法:
#   scripts/codex-run.sh <輸出檔> <prompt 檔> [額外參數...]
#
# 例:
#   scripts/codex-run.sh /tmp/k2.log /tmp/review.md -s read-only
#
# 🔴 擋不住什麼(不要把它當萬靈丹):
#   - codex 本身答錯、答得爛 —— 這支只管「跑完了沒」,不管答得對不對
#   - 「跑完了」不代表結論可信,只代表它不是半路死掉的殘篇
#   - 網路端的靜默失敗(能連上但回空)—— 只會顯示成 exit 0 且輸出很短
#   - 模型 quota 用盡 —— codex 自己會講,本腳本原樣轉傳
set -uo pipefail

OUT="${1:?用法: codex-run.sh <輸出檔> <prompt 檔> [額外參數...]}"
PROMPT_FILE="${2:?缺 prompt 檔}"
shift 2

if [ ! -s "$PROMPT_FILE" ]; then
  echo "codex-run: prompt 檔不存在或為空:$PROMPT_FILE" >&2
  exit 2
fi

MODEL="${CODEX_MODEL:-gpt-5.6-sol}"
EFFORT="${CODEX_EFFORT:-xhigh}"

START=$(date +%s)

# 🔴 `< /dev/null` 是本腳本存在的主因:沒有它 codex 會停在等 stdin,外表與逾時無法區分。
# 🔴 不接管線:任何 pipe 都會把輸出緩衝到結束,讓「進行中」與「卡死」看起來一樣。
codex exec -m "$MODEL" -c model_reasoning_effort="$EFFORT" "$@" \
  "$(cat "$PROMPT_FILE")" < /dev/null > "$OUT" 2>&1
CODE=$?

ELAPSED=$(( $(date +%s) - START ))
BYTES=$(wc -c < "$OUT" | tr -d ' ')

# 🔴 **不能用 exit code 判斷有沒有跑完** —— 2026-07-29 實測:把 codex 中途 SIGTERM 砍掉,
#    它照樣 exit 0,而且已經吐了 2313 bytes。只看 exit code + 位元組數會判成「正常結束」,
#    那比沒有判定更糟(給出假的安心)。
#    可靠的完成標記 = codex 跑完一定會印的 `tokens used` 行;中途被砍的那次是 0 個。
if grep -q '^tokens used' "$OUT" 2>/dev/null; then
  REASON="跑完了(有完成標記)"
elif [ "$CODE" -eq 0 ]; then
  REASON="🔴 中途死掉但 exit 0 — 沒有完成標記,結論不完整,不可當審查結果採用"
else
  REASON="失敗(exit $CODE、無完成標記)"
fi

printf 'codex-run: exit=%s 耗時=%ss 輸出=%s bytes 判定=%s\n' \
  "$CODE" "$ELAPSED" "$BYTES" "$REASON" >&2

# 停在等 stdin 的特徵:那行會印,但後面應該還有內容。輸出很短又只有它 = 卡在等輸入。
if [ "$BYTES" -lt 200 ] && grep -q 'Reading additional input from stdin' "$OUT" 2>/dev/null; then
  echo "codex-run: 🔴 輸出只停在 stdin 提示 — 檢查是否有東西吃掉了 /dev/null 重導向" >&2
fi

exit "$CODE"
