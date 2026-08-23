#!/usr/bin/env bash
# commit 包預檢 —— 在一棵【乾淨的 dev】上,只放這一包要收的檔,跑 typecheck + lint。
#
# 🔴 它殺的是哪一族病(分母是量出來的, 不是印象):
#      git log --oneline -60 | grep -cE "工作樹|沒進版控|躺在|CI 全紅|連紅"  ⇒ 4
#      負對照(同一把尺量一個不存在的字)                                     ⇒ 0   ← 尺是活的
#    而那四顆是連續的 HEAD~3..HEAD ⇒ 不是失手, 是結構性的洞。
#
# 🔴 機制:漏收一支【被其他收進去的檔需要】的檔
#      ⇒ 乾淨樹上少那一支 ⇒ typecheck 紅
#      ⇒ 而共用樹上它還在 ⇒ 本機永遠綠。**那正是那四顆的共同形狀。**
#
# ⚠️ 它【抓不到】什麼(必要不充分, 不要當成通過就沒事):
#      · 🔴 **少收一支【帶守門的】測試檔 ⇒ 它會【綠】, 只是綠得比較小聲**
#        2026-08-24 實測(補洞窗):退回一支帶守門的測試檔 ⇒ exit=0 綠,
#        而測試總數 177 -> 165 ⇒ **12 格守門安靜地消失了**
#        ⇒ 多了一支在等的檔 = 紅 = 會吵 = 有人會發現(本腳本抓得到)
#          少了一支帶守門的檔 = 綠 = 不吵 = 沒有人會發現(本腳本【看不到】)
#        ⇒ 固定動作(腳本做不到, 要人做):比對【Test Files / Tests 兩欄的格數】
#          基準 = 主樹上跑該片相關測試的兩欄;格數變少 ⇒ 漏收了帶守門的檔
#      · runtime-only 的相依
#      · **不驗你收的那些 hunk 對不對**(git add -p 的情況)
#        ⇒ 它驗的是「這一包自己站得住嗎」, 不是「這一包是不是你想要的」
#
# 用法:bash scripts/commit-pack-preflight.sh <具名路徑>...
set -uo pipefail

[ "$#" -gt 0 ] || { echo "用法: bash $0 <具名路徑>..." >&2; exit 2; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1
W=$(mktemp -d "${TMPDIR:-/tmp}/pack-check.XXXXXX")/wt
trap 'git -C "$ROOT" worktree remove --force "$W" >/dev/null 2>&1; rm -rf "$(dirname "$W")"' EXIT

HEAD_SHA=$(git rev-parse --short HEAD)
echo "repo=$ROOT  HEAD=$HEAD_SHA  包內檔數=$#"

git worktree add --detach "$W" HEAD >/dev/null 2>&1 || { echo "🔴 建 worktree 失敗" >&2; exit 1; }

# 🔴 基準自檢:新樹必須是 0 dirty。不是就作廢 —— 髒的基準量出來的綠沒有意義。
BASE=$(git -C "$W" status --porcelain | wc -l | tr -d ' ')
if [ "$BASE" != "0" ]; then echo "🔴 新樹 dirty=$BASE(應為 0)⇒ 本次量測作廢" >&2; exit 1; fi

for f in "$@"; do
  [ -e "$f" ] || { echo "🔴 來源不存在: $f" >&2; exit 1; }
  mkdir -p "$W/$(dirname "$f")" && cp "$f" "$W/$f" || { echo "🔴 複製失敗: $f" >&2; exit 1; }
done

# 🔴 複製後自檢:dirty 必須【剛好等於】包內檔數。多了 = 我搬到別線的東西 ⇒ 那會讓結果偏綠。
GOT=$(git -C "$W" status --porcelain | wc -l | tr -d ' ')
if [ "$GOT" != "$#" ]; then
  echo "🔴 複製後 dirty=$GOT, 預期 $# ⇒ 本次量測作廢(多出來的會讓結果偏綠)" >&2
  git -C "$W" status --porcelain >&2
  exit 1
fi
echo "基準自檢: 建樹時 dirty=0 / 複製後 dirty=$GOT ✅"

( cd "$W" && pnpm install --frozen-lockfile >/dev/null 2>&1 ); IE=$?
( cd "$W" && TURBO_FORCE=1 pnpm typecheck > "$W/.tc.log" 2>&1 ); TE=$?
( cd "$W" && TURBO_FORCE=1 pnpm lint > "$W/.lint.log" 2>&1 ); LE=$?

echo "install=$IE  typecheck=$TE  lint=$LE"
[ "$TE" -eq 0 ] || { echo "--- typecheck 錯 ---"; grep -E "error TS" "$W/.tc.log" | head -20; }
[ "$LE" -eq 0 ] || { echo "--- lint 錯 ---"; tail -20 "$W/.lint.log"; }

# 🔴 包內若有測試檔, 在乾淨樹上跑一次 —— typecheck+lint 對「測試在等一支沒收的檔」零判別力。
# 2026-08-24 實錘:一包只放 design-tokens.test.ts ⇒ 本腳本原本印綠,
# 而同一個乾淨基準上跑 vitest ⇒ rc=1 / 15 格紅(新測試在等還沒 commit 的 globals.css)。
# 🔴 `*-browser.test.*` 排除 —— 它們需要主樹才有的建置產物(`.next`), 在新 worktree 上必紅。
#    2026-08-24 實測:L1 那包的兩支 browser 測試在乾淨樹紅、在主樹 `2 passed / 9 tests / EXIT=0`
#    ⇒ 那是【本工具的誤擋】, 不是那一包的問題。
#    而誤擋比漏抓更該修:一道會誤紅的收工閘, 會讓人繞過它 —— 然後我們就有了第五顆 #884。
#    ⚠️ 代價寫明:browser 那族在本工具下【零覆蓋】, 要另外在主樹跑。
TESTS=""
SKIPPED_BROWSER=0
for f in "$@"; do
  case "$f" in
    *-browser.test.ts|*-browser.test.tsx) SKIPPED_BROWSER=$((SKIPPED_BROWSER+1));;
    *.test.ts|*.test.tsx) TESTS="$TESTS $f";;
  esac
done
[ "$SKIPPED_BROWSER" -eq 0 ] || echo "⚠️ 略過 $SKIPPED_BROWSER 支 *-browser.test.*(需主樹 .next)⇒ 這幾支【本工具沒量】, 請在主樹自己跑"
VE=0
if [ -n "$TESTS" ]; then
  ( cd "$W" && npx vitest run $TESTS > "$W/.vt.log" 2>&1 ); VE=$?
  echo "vitest(包內測試檔)=$VE  $(grep -E 'Test Files' "$W/.vt.log" | tail -1)"
  [ "$VE" -eq 0 ] || { echo "--- vitest 錯 ---"; grep -E "FAIL|AssertionError" "$W/.vt.log" | head -10; }
else
  echo "vitest: 包內無測試檔 ⇒ 略過(而這【不是】一個綠, 是沒量)"
fi

if [ "$IE" -eq 0 ] && [ "$TE" -eq 0 ] && [ "$LE" -eq 0 ] && [ "$VE" -eq 0 ]; then
  echo "✅ 這一包在乾淨 dev 上站得住(而這是必要條件, 不是充分條件 —— 見檔頭)"
  exit 0
fi
echo "🔴 這一包在乾淨 dev 上站不住 ⇒ 多半漏收了一支它需要的檔"
exit 1
