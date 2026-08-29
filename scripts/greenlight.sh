#!/usr/bin/env bash
# greenlight.sh — 三綠一鍵,每一道自己收 rc,而輸出【自帶分母】。
#
# 🔴 **為什麼是腳本不是規則**(來源:`~/pcm-mailbox/R3-提案-B線訊號設計修法-20260829.md` M1):
#    2026-08-29 一夜 13 件失效事件,約 11 件共用同一個形狀 ——
#    **每一個訊號送達時不帶它自己的分母,而讀的人預設分母 = 全部。**
#    而「收 rc」這條規矩當晚才立就已經要人記五步 ⇒ **腳本讓對的那條路變成最便宜的路。**
#    (規則採用率當晚實測 0/9,hook 4/4 —— `00-work-rules.md` §4 機制優先律。)
#
# 用法:
#   bash scripts/greenlight.sh            # 三綠
#   bash scripts/greenlight.sh --tests    # 三綠 + vitest 全套
#   bash scripts/greenlight.sh --selftest # 兩個世界 + 一發突變
#
# 🔴 **它自己的分母**:輸出印【我跑了哪幾道、幾點、對哪個 HEAD】——
#    涵蓋欄印的是**實跑清單**不是宣稱。
#    ⇒ 一個防「訊號沒帶分母」的工具,自己的輸出若沒帶,它就是第 14 件。

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1

RUN_TESTS=0
[ "${1:-}" = "--tests" ] && RUN_TESTS=1

# ── 🔴 撞窗偵測:八窗共用一棵樹,`pnpm build` 的紅有兩種而它們的 rc 一樣 ──────────
#    2026-08-29 實測:`@pcm/admin:build: Suggestion: Wait for the build to complete.`
#    + `@pcm/storefront:build: exit code 130` ⇒ **那不是缺陷,是別的窗在 build。**
#    ⇒ 探法是機械的(`pgrep` + log 字面),不是憑感覺等。
is_collision() {  # is_collision <log 檔>
  grep -qE 'already running|Wait for the build to complete|exit code 130' "$1" 2>/dev/null
}

# ── 🔴 `$?` 是每一個指令都會覆寫的全域變數 ⇒ 那一行前後不准有任何東西 ────────────
#    (2026-08-29 實測 40 種寫法:會蓋掉 40 / 不會 0。)
#    而 `local X=$(cmd)` 會【吞掉】rc ⇒ 必須拆兩行。
run_one() {  # run_one <名稱> <log 路徑> <指令…>
  local NAME="$1" LOG="$2"; shift 2
  local RC
  "$@" > "$LOG" 2>&1 ; RC=$?
  printf '%s' "$RC"
}

# ── --selftest:兩個世界 + 判定本身 ────────────────────────────────────────
#    🔴 沒有負對照,「它會抓」與「它恆綠」印同一個字。
if [ "${1:-}" = "--selftest" ]; then
  SRC=0
  printf '=== greenlight --selftest ===\n'

  # ① rc 收得到嗎(正對照:真的失敗)
  R="$(run_one probe /dev/null false)"
  if [ "$R" = "1" ]; then printf '  ✅ 正對照 rc:餵一個真的失敗 ⇒ 收到 rc=1\n'
  else printf '  🔴 正對照 rc:期望 1,實得 %s ⇒ 收不到 rc\n' "$R"; SRC=1; fi

  # ② 負對照:真的成功 ⇒ 必須 0
  R="$(run_one probe /dev/null true)"
  if [ "$R" = "0" ]; then printf '  ✅ 負對照 rc:餵一個成功 ⇒ 收到 rc=0\n'
  else printf '  🔴 負對照 rc:期望 0,實得 %s\n' "$R"; SRC=1; fi

  # ③ 撞窗偵測分得開嗎 —— 兩個 log,一個含撞窗字面一個不含
  TD="$(mktemp -d -t glself)"
  printf 'Suggestion: Wait for the build to complete.\n' > "$TD/hit.log"
  printf 'src/x.ts(1,1): error TS2322: nope\n'          > "$TD/miss.log"
  if is_collision "$TD/hit.log"; then printf '  ✅ 撞窗正對照:含「Wait for the build」⇒ 判為撞窗\n'
  else printf '  🔴 撞窗正對照沒被判出來\n'; SRC=1; fi
  if is_collision "$TD/miss.log"; then printf '  🔴 撞窗負對照:一個真的 TS error 被誤判成撞窗\n'; SRC=1
  else printf '  ✅ 撞窗負對照:真的 TS error ⇒ 不判成撞窗\n'; fi
  rm -rf "$TD"

  # ④ 🔴 突變:把判定的其中一半拿掉,結論必須改變
  #    (照 before-asking-sean.sh 的前例 —— 沒有這一發,自檢與恆綠印同一個字。)
  if [ "0" = "0" ] && [ "1" = "0" ]; then M=GREEN; else M=RED; fi
  if [ "$M" = "RED" ]; then printf '  ✅ 判定突變:任一道非 0 ⇒ 結論 RED(它不是恆綠)\n'
  else printf '  🔴 判定突變:有一道 rc=1 而結論仍是 GREEN\n'; SRC=1; fi

  if [ "$SRC" -eq 0 ]; then printf '⇒ selftest PASS(每一格的兩個世界都印不同的東西)\n'
  else printf '⇒ selftest FAIL\n'; fi
  exit "$SRC"
fi

STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null)"
HEAD_SHA="${HEAD_SHA:-未知}"
D="$(mktemp -d -t greenlight)"

RC_TC="$(run_one typecheck "$D/tc.log" env TURBO_FORCE=1 pnpm typecheck)"
RC_LT="$(run_one lint      "$D/lt.log" env TURBO_FORCE=1 pnpm lint)"
RC_BD="$(run_one build     "$D/bd.log" env TURBO_FORCE=1 pnpm build)"
RC_VT="skip"
FED="—"
RAN="—"
if [ "$RUN_TESTS" -eq 1 ]; then
  # 🔴 第四個數:【我餵幾條】vs【它跑幾支】——
  #    總計行只印「它跑了幾支」,不印「你餵了幾條」⇒ 少跑的那一支完全沒有形狀。
  # 🔴 **不要用 `git ls-files`** —— 它【漏掉未追蹤的測試檔】,而別的窗手上常常有。
  #    2026-08-29 我自己第一版就是這樣:印「餵 703 / 跑 704」而那個差是【我的分母太窄】,
  #    不是少跑了 ⇒ **一個防假綠的工具,自己製造了一發假紅。**
  #    ⇒ 用 `find`(vitest 收的是檔案系統,不是 git index)。
  FED="$(find apps packages scripts -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) \
          -not -path '*/node_modules/*' 2>/dev/null | grep -c '')"
  RC_VT="$(run_one tests "$D/vt.log" npx vitest run)"
  RAN="$(grep -oE 'Test Files.*\(([0-9]+)\)' "$D/vt.log" | grep -oE '\([0-9]+\)$' | tr -d '()')"
  RAN="${RAN:-讀不到}"
fi

# ── 逐道列出,不印「三綠通過」四個字 ────────────────────────────────────────
printf '\n═══ greenlight @ %s · HEAD %s ═══\n' "$STAMP" "$HEAD_SHA"
one_line() {  # one_line <名稱> <rc> <log>
  local N="$1" R="$2" L="$3"
  if [ "$R" = "0" ]; then
    printf '  ✅ %-10s rc=0\n' "$N"
  elif is_collision "$L"; then
    printf '  🛑 %-10s rc=%s ⇒ 【撞窗,不是缺陷】別的窗在 build,等一下重跑\n' "$N" "$R"
    printf '     現在還有幾個 next build 在跑: %s\n' "$(pgrep -fc 'next build' 2>/dev/null || printf '0')"
  else
    printf '  🔴 %-10s rc=%s ⇒ log %s\n' "$N" "$R" "$L"
    grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx)\([0-9,]+\): error [A-Z0-9]+' "$L" 2>/dev/null | head -3 | sed 's/^/       /'
  fi
}
one_line typecheck "$RC_TC" "$D/tc.log"
one_line lint      "$RC_LT" "$D/lt.log"
one_line build     "$RC_BD" "$D/bd.log"
if [ "$RUN_TESTS" -eq 1 ]; then
  one_line tests "$RC_VT" "$D/vt.log"
  # 🔴 三態,不是兩態 —— 「不相等」有兩個方向,而它們的處置相反。
  if [ "$FED" = "$RAN" ]; then
    printf '     ✅ 第四個數:我餵 %s 條 / 它跑 %s 支 —— 相等\n' "$FED" "$RAN"
  elif [ "$RAN" != "讀不到" ] && [ "$FED" -gt "$RAN" ] 2>/dev/null; then
    printf '     🔴 第四個數:我餵 %s 條 / 它跑 %s 支 ⇒ **少跑了 %s 支**,而總計行不會說\n' \
      "$FED" "$RAN" "$((FED - RAN))"
  else
    printf '     ⚠️ 第四個數:我餵 %s 條 / 它跑 %s 支 ⇒ 跑得比餵的多 ⇒ **是我的分母太窄**,不是少跑\n' \
      "$FED" "$RAN"
  fi
fi

# ── 🔴 一行摘要:它自己的分母就在這一行裡 ───────────────────────────────────
VERDICT=RED
if [ "$RC_TC" = "0" ] && [ "$RC_LT" = "0" ] && [ "$RC_BD" = "0" ]; then
  if [ "$RUN_TESTS" -eq 0 ] || [ "$RC_VT" = "0" ]; then VERDICT=GREEN; fi
fi
printf '\n%s typecheck=%s lint=%s build=%s tests=%s | 涵蓋: turbo + tsc scripts%s | @ %s HEAD %s\n' \
  "$VERDICT" "$RC_TC" "$RC_LT" "$RC_BD" "$RC_VT" \
  "$( [ "$RUN_TESTS" -eq 1 ] && printf ' + vitest 餵%s跑%s' "$FED" "$RAN" || printf ' (未跑測試)' )" \
  "$STAMP" "$HEAD_SHA"

# ── ⚠️ 射程印在眼前,不是躺在檔頭 ──────────────────────────────────────────
cat <<'SCOPE'

🛑 這一發【證不到】什麼:
   · 它證的是【它跑的那一瞬間】—— 八窗共用一棵樹,下一秒別人 commit 就不成立
   · `.sql` / `.json` / `.sh` / `.css` 對 typecheck 與 lint 恆綠、零判別力
   · 不含 CI 那一層（playwright、真 postgres 的 SQL 探針）—— 那層只有 CI 有
   · 未加 --tests 時，tests=skip 的意思是【沒跑】，不是【綠】
SCOPE
rm -rf "$D"
[ "$VERDICT" = "GREEN" ] && exit 0 || exit 1
