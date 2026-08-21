#!/usr/bin/env bash
# build-guard.sh — 擋住「同一個 app 目錄下 next dev 還開著」造成的 build 假紅。
#
# 成因(2026-08-21 窗G實測、寫進 docs/patterns/guard-and-instrument-traps.md):
# `next dev` 與 `next build` 共用同一個 `.next` 目錄,一邊在寫、一邊在讀 ⇒
# ENOENT 之類的錯誤看起來像 code 壞了,實際上是兩個都對的動作撞在一起。
# `next dev` 的鎖是【每個目錄一份】,不同 app 不會互相擋,所以只問「有沒有 next dev」
# 會在「admin 開著、你要 build storefront」時誤擋——本檔綁的是 app 目錄,不是進程名。
#
# 用法:bash scripts/build-guard.sh <app-name>(例如 storefront / admin)
#      通常接著 build:
#        bash scripts/build-guard.sh storefront && TURBO_FORCE=1 pnpm --filter storefront build
#
# 驗證(2026-08-21 F-81,手動跑過,不是內建在每次呼叫裡——每次呼叫都真的起一次 dev server
# 驗證太重):
#   正對照:apps/storefront 下開一個 next dev,跑本檔 ⇒ exit 1,擋下
#   負對照:沒有人開,跑本檔 ⇒ exit 0,放行
#   綁 app 目錄:apps/storefront 開著時,對編造的 app 名跑本檔 ⇒ 零命中、exit 0
#   (三發輸出見交件 `~/pcm-mailbox/F-81-build-guard完成-20260821.md`)

set -euo pipefail

APP="${1:-}"
if [ -z "$APP" ]; then
  echo "用法: bash scripts/build-guard.sh <app-name>(例如 storefront / admin)" >&2
  exit 2
fi

MATCH=$(pgrep -fl "apps/${APP}/.*next.*dev" || true)
if [ -n "$MATCH" ]; then
  echo "🔴 build 會假紅:apps/${APP} 底下有 next dev 開著,跟 build 共用同一個 .next 目錄。" >&2
  echo "" >&2
  echo "偵測到的行程:" >&2
  echo "$MATCH" >&2
  echo "" >&2
  echo "這不是你的 code 壞了 —— build 讀寫 .next 的同時 dev server 也在寫,兩邊互相破壞產物," >&2
  echo "常見症狀是 ENOENT / 找不到某個 .next/static/<hash>/ 檔案。" >&2
  echo "  · 那台 dev server 是你的 ⇒ 先收掉(down.sh 或對應的收攤腳本),再重跑這支腳本" >&2
  echo "  · 不是你的 ⇒ 去問上面那個 pid 是誰的,協調收掉的時間,不要自己 kill 別人的" >&2
  exit 1
fi

echo "✅ apps/${APP} 沒有偵測到 next dev,build 判別力乾淨。"
exit 0
