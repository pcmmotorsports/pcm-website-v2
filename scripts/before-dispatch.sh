#!/bin/bash
# 派工前守門(主視窗用):派一個板列之前, 先問【那列現在什麼態】與【有沒有 commit 提到它】。
# 為什麼:2026-09-06 一夜主視窗派錯 9 次, 全是同一族 —— 板上 open 的列早已被做掉(修法列與缺口列相鄰而不同線維護;
#   或做掉它的那顆是 docs-only commit), 而派工的人讀了板列沒跑 what-happened-to。
#   「更記得」治不好這一格 ⇒ 做成機制:派工單第一行貼本工具的輸出。
# 用法:bash scripts/before-dispatch.sh <錨(不含⟦⟧)>
# exit:0=列是 open/doing(仍要開檔) · 3=列是 done/parked ⇒ 不得派 · 4=板上找不到那列 · 2=用法錯
set -u
[ $# -eq 1 ] || { echo "用法: bash scripts/before-dispatch.sh <錨>" >&2; exit 2; }
A="$1"
cd "$(git rev-parse --show-toplevel)" || exit 1
ROW=$(bash scripts/board-row-by-anchor.sh "$A" 2>/dev/null | awk -F'\t' 'NR==2 && $1 ~ /^[0-9]+$/ {print $2}')
if [ -z "$ROW" ]; then echo "🔴 板上找不到錨欄 = ⟦$A⟧ 的列(整行 grep 撈得到的是引用, 不算)"; exit 4; fi
echo "板列態 = $ROW"
case "$ROW" in
  done|parked) echo "🛑 態是 $ROW ⇒ 不得派。要派得先讀那列為什麼 $ROW。"; exit 3;;
esac
HITS=$(python3 scripts/what-happened-to.py "$A" 2>&1)
N=$(printf '%s\n' "$HITS" | grep -oE '訊息裡提到這個錨的 commit:[0-9]+' | grep -oE '[0-9]+$')
if [ "${N:-0}" != 0 ]; then
  echo "⚠️ 有 $N 顆 commit 提到這個錨 ⇒ 先開那幾顆再派(命中 ≠ 做掉, 但它們是「已經有人動過」的訊號):"
  printf '%s\n' "$HITS" | sed -n '3,12p'
else
  echo "零顆 commit 提到這個錨(零命中 ≠ 沒做;沒帶錨的 commit 本工具看不到)"
fi
echo "🛑 open 不是「還沒做」, 是「沒有人來改過這一格」。"
exit 0
