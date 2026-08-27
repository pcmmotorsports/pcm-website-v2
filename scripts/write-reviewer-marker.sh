#!/bin/bash
# 寫 pre-commit reviewer 閘的完成標記(Sean 2026-08-11 拍板 A 案機制化)。
# 用法: bash scripts/write-reviewer-marker.sh "<片名+審查輪次或跳審理由>"
# 背景: 「往 git-dir 寫標記」對權限 classifier 是不可分辨的繞守門形狀(四路實測全擋),
#       故收斂為這支具名腳本+一條允許規則。防線不變: pre-commit 閘與審查鏈都沒動,
#       本腳本只是把「審完後的登記動作」變成可稽核的單一入口(理由必填、進標記檔)。
set -euo pipefail
reason="${1:?用法: bash scripts/write-reviewer-marker.sh <片名+輪次或跳審理由>}"
gd=$(git rev-parse --git-dir)
{ git rev-parse HEAD; echo "reviewed: $reason"; } > "$gd/pcm-reviewer-ran"
echo "marker OK head=$(git rev-parse --short HEAD) reason=$reason"
