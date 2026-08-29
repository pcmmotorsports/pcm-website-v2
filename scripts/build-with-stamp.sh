#!/usr/bin/env bash
# build-with-stamp.sh — 跑 `next build`,而**只有成功才留下戳記**。
#
# 🔴 **為什麼**(來源 `~/pcm-mailbox/R3-plan-M2-BUILD_OK戳記-20260829.md`):
#    2026-08-29 實測:`next build` **rc=1**(type check 失敗),
#    而 `.next/static/chunks` **仍然被寫出來了**(28 個檔、時間戳是當次)。
#    ⇒ **「產物存在」在【成功】與【失敗但寫了一半】兩個世界印同一個綠。**
#    📌 而有 4 支測試的第一格斷言就是「建置產物在不在」
#       ⇒ **它們的前置條件,可以被一次失敗的 build 滿足。**
#
# 🔴 **核心設計一句話**:**先刪舊戳記,再 build,rc=0 才寫新的。**
#    ⇒ 失敗世界留下的是【無戳記】,**不是昨天的戳記**。
#    ⚠️ **而讀者端【不比 HEAD 判紅,只警告】**(codex 2026-08-29 逼出的設計更正):
#       `turbo.json` 的 `build.outputs` 含 `.next/**` ⇒ 本戳記會被 turbo 快取並 replay,
#       而 HEAD 不是 task hash 的輸入 ⇒ 比 HEAD 判紅會變成【常態假紅】。
#    📌 **它把一個【會說謊的訊號】換成一個【沉默的訊號】——**
#       **而沉默會被判紅,說謊會被判綠。**
#
# 用法(由 package.json 的 "build" 呼叫):
#   bash ../../scripts/build-with-stamp.sh <app>
#
# ⚠️ **rc 原樣穿透** —— 本檔不改變 build 的成敗語意,它只多寫一個檔。

set -u

APP="${1:-}"
if [ -z "$APP" ]; then
  printf '用法: bash scripts/build-with-stamp.sh <app>(admin / storefront)\n' >&2
  exit 2
fi

# 🔴 可注入的 repo 根 —— **只為了讓這支腳本自己可以被測**(成例:
#    `scripts/null-shortcircuit-check-guard.test.ts` 的 `NULL_SHORTCIRCUIT_GUARD_MIGRATIONS_DIR`)。
#    ⇒ 不注入時行為完全不變:從腳本自己的位置推,而不是從你人在哪推。
#    ⚠️ 而它存在的理由是 codex 2026-08-29 那句「四支讀者測試不能證明守門本身有判別力」——
#       沒有這個旋鈕,唯一的測法是往共用樹丟一個假 app 目錄,而那是今晚已經被記過的事。
REPO="${BUILD_STAMP_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NEXT_DIR="$REPO/apps/$APP/.next"
STAMP="$NEXT_DIR/BUILD_OK"

# ── 🔴 先刪,而且【在 build 之前】 ────────────────────────────────────────────
#    順序是這支檔存在的理由:build 失敗時,舊戳記不可以留在原地被下一個人讀到。
rm -f "$STAMP"

# ── 🔴 `$?` 是每一個指令都會覆寫的全域變數 ⇒ 那一行前後不准有任何東西 ────────
next build ; RC=$?

if [ "$RC" -eq 0 ]; then
  mkdir -p "$NEXT_DIR"
  # 戳記自帶分母:哪一次 build、幾點、哪個 HEAD、哪個 app。
  printf '{"app":"%s","head":"%s","at":"%s","rc":0}\n' \
    "$APP" \
    "$(git -C "$REPO" rev-parse HEAD 2>/dev/null || printf 'unknown')" \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    > "$STAMP"
  # 🔴 **戳記寫失敗不可以還 exit 0**(codex 2026-08-29 抓到:「戳記寫入失敗仍會 exit 0」)。
  #    ⇒ 那會回到本機制要解的那個世界:build 說成功,而沒有東西證明它成功。
  if [ ! -s "$STAMP" ]; then
    printf '🔴 build 成功而【戳記寫不出來】(%s)⇒ 本次判為失敗,因為沒有東西證明它成功。\n' "$STAMP" >&2
    exit 1
  fi
else
  # ⚠️ 明說「沒有寫戳記」—— 而**缺席不需要被解讀**:讀者看不到戳記就是紅。
  printf '🔴 build 失敗(rc=%s)⇒ **沒有寫 BUILD_OK 戳記**。\n' "$RC" >&2
  printf '   而 .next 底下可能仍有【寫了一半】的產物 —— 那些不算數,別拿它們當「build 過了」。\n' >&2
fi

exit "$RC"
