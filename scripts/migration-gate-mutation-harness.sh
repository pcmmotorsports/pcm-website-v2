#!/usr/bin/env bash
# migration-gate-mutation-harness.sh
#
# 這支在做什麼:證明 `scripts/migration-new-file-gate.test.ts` 那道守門
# **在兩個不同的紅世界印【不同】的東西**。
#
# 🔴 為什麼需要它(2026-08-27, 下手窗 de 立):
#   `1ba70fe5` 那顆的主要宣稱就是「兩個紅的世界印不同的東西」, 而**證據只活在對話裡** ——
#   b4 窗複驗時逐字寫:「突變 A/B 重跑不了 ⇒ 本顆主要產出沒有可重跑證據」,
#   並指出那是**同一夜第三次**(16 個世界 / 9 個世界 / 這個)。
#   📌 **存輸出救不了它** —— 一份存下來的輸出沒辦法被重驗, 它只是另一個宣稱。
#      **可重跑的 harness 才是證據。**
#
# 用法(在 repo 根跑):  bash scripts/migration-gate-mutation-harness.sh
# 退出碼:  0 = 三個世界都印了它該印的  /  1 = 有一格不符  /  2 = 前置不成立, 沒跑
#
# ⚠️ 它會【暫時改】兩支共用檔(package.json / 那支測試), 跑完立刻還原並驗 sha。
#    還原寫法照 `docs/patterns/mutation-harness-restore.md` §3 範本:
#    cp 排在 trap body 第一行、echo 一律進 stderr、訊號清單不加 PIPE。

set -euo pipefail

PKG=package.json
TST=scripts/migration-new-file-gate.test.ts
PKG_BASE=/tmp/mgmh-pkg.base ; PKG_SHA=/tmp/mgmh-pkg.sha
TST_BASE=/tmp/mgmh-tst.base ; TST_SHA=/tmp/mgmh-tst.sha

# ── 前置:兩支檔都必須乾淨 ────────────────────────────────────────────────
# 🔴 髒的話【還原不回去】—— 我不知道該還原成哪一版, 而八個窗共用這棵樹。
DIRTY=$(git status --porcelain -- "$PKG" "$TST" | grep -c . || true)
if [ "$DIRTY" -ne 0 ]; then
  echo "⛔ 前置不成立:下面這幾支有未 commit 的改動 ⇒ 還原不回去, 本harness 不跑。" >&2
  git status --porcelain -- "$PKG" "$TST" >&2
  exit 2
fi

# 🔴 基準【當場照】, 不沿用 /tmp 舊的
cp "$PKG" "$PKG_BASE"; shasum -a 256 "$PKG" | cut -c1-16 > "$PKG_SHA"
cp "$TST" "$TST_BASE"; shasum -a 256 "$TST" | cut -c1-16 > "$TST_SHA"

restore_and_verify () {
  # 🔴 改檔案的動作【排最前面】—— 前面放任何往 stdout 寫的東西, 輸出被 `| head` 截斷時
  #    trap 會死在那一行、走不到這裡(pattern §2 實測 B)。
  cp "$PKG_BASE" "$PKG"
  cp "$TST_BASE" "$TST"
  local p t
  p=$(shasum -a 256 "$PKG" | cut -c1-16)
  t=$(shasum -a 256 "$TST" | cut -c1-16)
  # 🔴 驗【結果】不是驗「cp 跑了」
  if [ "$p" != "$(cat "$PKG_SHA")" ] || [ "$t" != "$(cat "$TST_SHA")" ]; then
    echo "❌❌ 還原失敗:pkg=$p(基準 $(cat "$PKG_SHA")) tst=$t(基準 $(cat "$TST_SHA")) —— 檔案是髒的, 不要 commit" >&2
  else
    echo "✅ 還原已驗(pkg $p / tst $t)" >&2
  fi
}
trap restore_and_verify EXIT INT TERM HUP

run_gate () {  # $1 = 輸出檔
  TURBO_FORCE=1 npx vitest run "$TST" > "$1" 2>&1 || true
}
tests_line () { grep -E '^ *Tests ' "$1" | tail -1 | tr -s ' '; }
fixture_hits () { grep -c '本格的紅【不是規則②沒擋】' "$1" || true; }

FAIL=0
say () { printf '%-34s | %-28s | fixture訊息 %s\n' "$1" "$2" "$3"; }

# ── M0 基準:沒有突變, 必須綠 ─────────────────────────────────────────────
# 🔴 沒有這一發, 「斷言本身壞掉」會被讀成「突變成功」。
run_gate /tmp/mgmh-m0.out
M0T=$(tests_line /tmp/mgmh-m0.out); M0F=$(fixture_hits /tmp/mgmh-m0.out)
say "M0 沒突變(該全綠)" "$M0T" "$M0F"
echo "$M0T" | grep -q '3 passed' || { echo "🔴 M0 不是 3 passed ⇒ 底下全部作廢" >&2; FAIL=1; }
[ "$M0F" = "0" ] || { echo "🔴 M0 不該有 fixture 訊息" >&2; FAIL=1; }

# ── 世界甲:接線被改成 no-op ⇒ 該紅在【規則②沒擋】, 而【不是】fixture 壞 ──
python3 - "$PKG" <<'PY'
import io,sys
p=sys.argv[1]; s=io.open(p,encoding='utf-8').read()
o='"supabase/migrations/*.sql": "bash scripts/migration-new-file-static-checks.sh",'
n='"supabase/migrations/*.sql": "true",'
assert s.count(o)==1, '突變甲的錨命中 %d 次, 沒突變成' % s.count(o)
io.open(p,'w',encoding='utf-8').write(s.replace(o,n))
PY
run_gate /tmp/mgmh-a.out
AT=$(tests_line /tmp/mgmh-a.out); AF=$(fixture_hits /tmp/mgmh-a.out)
say "甲 接線改 no-op(該紅·非fixture)" "$AT" "$AF"
echo "$AT" | grep -q 'failed' || { echo "🔴 甲 該紅而沒紅" >&2; FAIL=1; }
[ "$AF" = "0" ] || { echo "🔴 甲 的紅被歸因成 fixture 壞 ⇒ 兩個世界又混在一起了" >&2; FAIL=1; }
cp "$PKG_BASE" "$PKG"

# ── 世界乙:fixture 不複製 truth-sync 要的檔 ⇒ 該紅在【fixture 壞】並指名真兇 ──
python3 - "$TST" <<'PY'
import io,sys
p=sys.argv[1]; s=io.open(p,encoding='utf-8').read()
o="    if (rel.startsWith('scripts/')) continue;"
n="    if (rel.startsWith('scripts/')) continue;\n    if (true) continue;"
assert s.count(o)==1, '突變乙的錨命中 %d 次, 沒突變成' % s.count(o)
io.open(p,'w',encoding='utf-8').write(s.replace(o,n))
PY
run_gate /tmp/mgmh-b.out
BT=$(tests_line /tmp/mgmh-b.out); BF=$(fixture_hits /tmp/mgmh-b.out)
say "乙 fixture 少檔(該紅·是fixture)" "$BT" "$BF"
echo "$BT" | grep -q 'failed' || { echo "🔴 乙 該紅而沒紅" >&2; FAIL=1; }
[ "$BF" -ge 1 ] || { echo "🔴 乙 沒有指名真兇 ⇒ 它與甲印同一句話, 那正是本 harness 要防的" >&2; FAIL=1; }
cp "$TST_BASE" "$TST"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 三個世界各印各的:M0 綠 / 甲 紅在規則② / 乙 紅在 fixture 並指名真兇"
else
  echo "🔴 有一格不符 —— 見上面的紅字。不要把它讀成「守門壞了」, 先看是哪一格。"
fi
exit "$FAIL"
