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
#      · 漏收一支【不影響編譯】的檔(只有它自己在用的新測試檔 / docs)
#        ⇒ 那種漏掉的症狀是【守門悄悄不見】, 不是紅
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

if [ "$IE" -eq 0 ] && [ "$TE" -eq 0 ] && [ "$LE" -eq 0 ]; then
  echo "✅ 這一包在乾淨 dev 上站得住(而這是必要條件, 不是充分條件 —— 見檔頭)"
  exit 0
fi
echo "🔴 這一包在乾淨 dev 上站不住 ⇒ 多半漏收了一支它需要的檔"
exit 1
