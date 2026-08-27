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
#      直接這樣呼叫 = 當閘用,擋到會 exit 1:
#        bash scripts/build-guard.sh storefront && TURBO_FORCE=1 pnpm --filter storefront build
#      package.json 的 prebuild 呼叫時帶 PREBUILD_WARN_ONLY=1 = 只警告不擋(見下方 turbo 那段)
#
# 驗證(2026-08-21 F-81,手動跑過,不是內建在每次呼叫裡——每次呼叫都真的起一次 dev server
# 驗證太重):
#   正對照:apps/storefront 下開一個 next dev,跑本檔 ⇒ exit 1,擋下
#   負對照:沒有人開,跑本檔 ⇒ exit 0,放行
#   綁 app 目錄:apps/storefront 開著時,對編造的 app 名跑本檔 ⇒ 零命中、exit 0
#   (三發輸出見交件 `~/pcm-mailbox/F-81-build-guard完成-20260821.md`)

set -euo pipefail

# 🔴 Vercel 逃生門(2026-08-21):這支腳本本來只為了解決本機多窗互撞,而 prebuild 這條路
#    (見提案v2)會讓它坐在【正式部署的必經路徑】上——Vercel 建置容器裡本來就不會有 next dev
#    在跑,但為了不依賴「巧合沒撞到」,遇到 CI 環境就直接放行,不跑 pgrep。
#    CI=1:Vercel 官方文件(build time 提供,無需額外開關)
#      https://vercel.com/docs/environment-variables/system-environment-variables
#    VERCEL=1:同頁,但**需要專案設定裡打開「Enable access to System Environment Variables」**
#      才會有,不保證一定存在,所以以 CI 為主、VERCEL 當備援,兩個任一命中就放行。
if [ "${CI:-}" = "1" ] || [ "${VERCEL:-}" = "1" ]; then
  echo "✅ 偵測到 CI/Vercel 環境(CI=${CI:-未設定} VERCEL=${VERCEL:-未設定}),跳過本機 dev server 檢查。"
  exit 0
fi

APP="${1:-}"
if [ -z "$APP" ]; then
  echo "用法: bash scripts/build-guard.sh <app-name>(例如 storefront / admin)" >&2
  exit 2
fi

MATCH=$(pgrep -fl "apps/${APP}/.*next.*dev" || true)
if [ -n "$MATCH" ]; then
  echo "BUILD-GUARD-WARN 🔴 build 可能會假紅:apps/${APP} 底下有 next dev 開著,跟 build 共用同一個 .next 目錄。" >&2
  echo "如果下面出現 ENOENT / 找不到 .next 底下某個檔,先回頭看這一行,那多半不是你的 code 壞了。" >&2
  echo "" >&2
  echo "偵測到的行程:" >&2
  echo "$MATCH" >&2
  echo "" >&2
  echo "這不是你的 code 壞了 —— build 讀寫 .next 的同時 dev server 也在寫,兩邊互相破壞產物," >&2
  echo "常見症狀是 ENOENT / 找不到某個 .next/static/<hash>/ 檔案。" >&2
  echo "  · 那台 dev server 是你的 ⇒ 先收掉(down.sh 或對應的收攤腳本),再重跑build" >&2
  echo "  · 不是你的 ⇒ 去問上面那個 pid 是誰的,協調收掉的時間,不要自己 kill 別人的" >&2
  # 🔴 2026-08-21 急件修:turbo 是整批跑的,一支 app 的 dev server 擋下去會讓整個 monorepo
  #    的 build 全紅(admin 幾乎永遠有窗開著)——prebuild 這條路只警告、不擋,阻擋權留給
  #    「直接呼叫本腳本」那條路(要當閘用的人還是有閘可用)。
  #    PREBUILD_WARN_ONLY 只在 package.json 的 prebuild 那一行設,直接跑本腳本不會有它。
  if [ "${PREBUILD_WARN_ONLY:-}" = "1" ]; then
    exit 0
  fi
  exit 1
fi

echo "✅ apps/${APP} 沒有偵測到 next dev,build 判別力乾淨。"
exit 0
