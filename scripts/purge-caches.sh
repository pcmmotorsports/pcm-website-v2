#!/usr/bin/env bash
# 清快取 —— 只碰【重建得回來的東西】,不碰任何人的工作。
#
# 🔴 為什麼需要這支:2026-08-24 實測 `.turbo/cache` = 281G,磁碟 97% 滿(剩 28Gi)。
#    那個目錄 08-14 建立 ⇒ **10 天長到 281G**。這件事會再發生。
#
# 🔴 而【看起來能做這件事的兩個指令都不能】——查過了,不要再繞路:
#      turbo prune   ⇒ 逐字「Prepare a subset of your monorepo」= 幫 Docker 切子集, 與快取無關
#      pnpm clean    ⇒ turbo.json:47 有定義, 而 `grep -l '"clean"' apps/*/package.json packages/*/package.json | wc -l` ⇒ 0
#                      (負對照:同一把尺數 "build" ⇒ 2)⇒ **沒有人實作它, 跑下去什麼都不會發生**
#
# ⚠️ 本檔【刻意不刪】 apps/*/.next(3.4G)——
#    那是 dev server 正在讀的東西, 而這台機器常態是八個窗同時開。
#    刪它會讓別人的畫面當場壞掉, 而他不會知道是我幹的。
#    ⇒ 它只被【列出來】。要刪請自己確認沒有 dev server 在跑之後手動刪。
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1
echo "repo root = $ROOT"

free_now() { df -h /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4 " free / " $5 " used"}'; }

echo "--- 現在 ---"
echo "磁碟: $(free_now)"
du -sh .turbo/cache 2>/dev/null || echo "0B	.turbo/cache (不存在)"
du -sh "$(pnpm store path 2>/dev/null)" 2>/dev/null || true
du -sh "$HOME/.npm" 2>/dev/null || true
echo "--- 只列出、不刪(dev server 在讀) ---"
du -sh apps/*/.next 2>/dev/null || true

printf '\n要刪 .turbo/cache + pnpm store prune + npm cache 嗎? [y/N] '
read -r ans
case "$ans" in
  y|Y) ;;
  *) echo "沒有刪任何東西。"; exit 0 ;;
esac

rm -rf .turbo/cache
# 🔴 不用 `rm && echo` —— rm -rf 對【不存在的目錄】也回 0 ⇒ 那句「已刪」會是恆真的。
#    判準要問【現在還在不在】, 不是問 rm 的回傳值。
if [ -e .turbo/cache ]; then echo "🔴 .turbo/cache 還在, 刪失敗"; else echo "已刪 .turbo/cache"; fi
pnpm store prune >/dev/null 2>&1 && echo "已跑 pnpm store prune" || echo "🔴 pnpm store prune 失敗"
npm cache clean --force >/dev/null 2>&1 && echo "已清 npm cache" || echo "🔴 npm cache clean 失敗"

echo "--- 刪後(驗證, 不是宣稱) ---"
echo "磁碟: $(free_now)"
du -sh .turbo/cache 2>/dev/null && echo "🔴 .turbo/cache 還在" || echo "✅ .turbo/cache 已不存在"
