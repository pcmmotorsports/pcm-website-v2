#!/bin/sh
# ============================================================
# scripts/vitest-ran-gate.sh 的證人 —— 把它的每一個出口【餵一發】
# ============================================================
# 🔴 **「每一個出口」那句我不寫** —— codex must-fix:**96 那個出口本檔沒有演過**
#    (它要 `mktemp` 失敗, 而在有 `mktemp` 的機器上構造它不便攜)⇒ 照實寫:
#    **本檔覆蓋 97 / 98 / 原封轉發(綠與紅各一) / JSON / 看不懂的 reporter / 兩種剝色陷阱 = 9 格;
#      96(本閘自壞)未演。**
#
# 為什麼要有這支(2026-09-01 `⟦b4-N04⟧`, `-f7` 做、主視窗裁):
#   那道閘 2026-08-31 起被接進 `pnpm test`, 而它在 CI 上**連紅 13 發**,
#   底下 740 支測試檔全過、vitest 自己回 0 —— 成因是它讀不到【帶顏色】的摘要行。
#   📌 **它的爆炸半徑是「每一條線的每一次 `pnpm test`」** ⇒ 它的出口要有人餵過(96 除外, 見上)。
#
# 🔴 做法:在 PATH 前面放一支**假的 `npx`**, 它不管參數、直接 cat 指定的 fixture。
#   ⇒ 跑的是 `scripts/vitest-ran-gate.sh` **本尊**, 不是突變副本。
#     (那一格是刻意的:突變副本證的是「我抄過來的那份邏輯」, 不是「正本」。)
#   ⇒ 假 npx 用 `exit $FAKE_RC` 模擬 vitest 自己的 exit code。
#
# 🔴 每一格驗【兩件事】(抄隔壁 scripts-whitelist-gate.harness.sh 的規矩):
#     ① exit code 對不對  ② **它是不是為了我要的那個理由**(比對 stderr 關鍵字)
#   沒有②的話, fixture 沒寫成功而碰巧也回同一個碼, 那一格照樣記 PASS 而證明的東西是零。
#
# 🛑 誠實邊界:
#   · 它驗的是【閘的判別力】, 不是「CI 現在綠不綠」——後者要看 CI。
#   · 假 npx 餵的是**我構造的輸出**, 不是真的 vitest 輸出 ⇒ vitest 未來改摘要格式, 這支照樣全綠。
#   · 🔴 **這一層沒有守門**:本 harness 自己退化成恆真(例如把 fail 改成 return 0)沒有任何東西會叫。
#   · 🔴 **而它現在【沒有被任何東西自動跑】** —— 要接上要在 package.json 的 lint-staged 加一條
#     (隔壁兩支 harness 就是那樣接的)。**未接之前, 它與不存在的差別只有「有人記得跑」。**
#
# exit 0 = 每一格都表演到位   1 = 有格沒過   2 = 本 harness 自己壞了

set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GATE="$ROOT/scripts/vitest-ran-gate.sh"
[ -f "$GATE" ] || { echo "🔴 harness 自壞:找不到 $GATE" >&2; exit 2; }

TMP=$(mktemp -d) || { echo "🔴 harness 自壞:mktemp -d 失敗" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" || { echo "🔴 harness 自壞:mkdir 失敗" >&2; exit 2; }

# 假 npx:不管參數, 印出 $FAKE_OUT 的內容, 然後用 $FAKE_RC 結束。
cat > "$TMP/bin/npx" <<'SHIM'
#!/bin/sh
cat "$FAKE_OUT"
exit "$FAKE_RC"
SHIM
chmod +x "$TMP/bin/npx" || { echo "🔴 harness 自壞:chmod 失敗" >&2; exit 2; }

ESC=$(printf '\033')
FAIL=0

# ── fixtures ────────────────────────────────────────────────────────────
# ① 帶顏色的全綠摘要(逐字照 CI 那一行的形狀重建)
printf '%s[2m Test Files %s[22m %s[1m%s[32m740 passed%s[39m (741)\n%s[2m      Tests %s[22m %s[1m%s[32m12744 passed%s[39m (12749)\n' \
  "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" > "$TMP/color-green.txt"
# ② 不帶顏色的同一份
printf ' Test Files  740 passed (741)\n      Tests  12744 passed (12749)\n' > "$TMP/plain-green.txt"
# ③ 帶顏色、而【真的有一支紅】
printf '%s[2m Test Files %s[22m %s[31m1 failed%s[39m | 735 passed (736)\n%s[2m      Tests %s[22m %s[31m2 failed%s[39m | 12000 passed (12002)\n' \
  "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" "$ESC" > "$TMP/color-red.txt"
# ④ 真的【沒有】摘要行(vitest 查無檔)
printf 'No test files found, exiting with code 1\n' > "$TMP/no-summary.txt"
# ⑤ 有摘要行、而一格都沒真的跑
printf '      Tests  38 skipped (38)\n' > "$TMP/all-skipped.txt"
# ⑥ 帶顏色的 JSON reporter 輸出(numTotalTests > 0)
#    🔴 codex nit:原本這一格註解寫「帶顏色」而 fixture **一個 ESC 都沒有** ⇒ 補上, 讓字面等於事實。
printf '%s[32m{"numTotalTests": 12, "numPassedTests": 12}%s[0m\n' "$ESC" "$ESC" > "$TMP/json-ok.txt"
# ⑧ 🔴🔴 codex must-fix 的反例:**畫面上沒有摘要, 而剝色會把它剝成有摘要**
#    `Te<ESC>[2Dsts  1 passed` —— `[2D` 是【游標左移】不是顏色。
#    舊式 `[0-9;]*[A-Za-z]` 會連它一起剝 ⇒ 變成 `Tests  1 passed` ⇒ **假綠放行**。
#    ⇒ 這一格就是「剝色不可以剝過頭」的正對照:它必須仍然回 97。
printf '      Te%s[2Dsts  1 passed (1)\n' "$ESC" > "$TMP/cursor-trap.txt"
# ⑨ 冒號式 SGR(ITU T.416):舊式 `[0-9;]*` **剝不掉它** ⇒ 這一格證明新式吃得到
printf '%s[38:5:2m      Tests  12 passed (12)%s[0m\n' "$ESC" "$ESC" > "$TMP/colon-sgr.txt"

run() { # run <fixture> <fake_rc> <gate args…>
  FIXTURE=$1; RC_IN=$2; shift 2
  FAKE_OUT="$FIXTURE" FAKE_RC="$RC_IN" PATH="$TMP/bin:$PATH" \
    sh "$GATE" "$@" > "$TMP/out.txt" 2> "$TMP/err.txt"
  echo $?
}

check() { # check <名稱> <期望rc> <實際rc> <stderr該有的關鍵字或 -> 空>
  NAME=$1; WANT=$2; GOT=$3; KEY=$4
  if [ "$GOT" != "$WANT" ]; then
    echo "🔴 $NAME:期望 rc=$WANT, 實得 rc=$GOT" >&2; FAIL=1; return
  fi
  if [ "$KEY" != "-" ] && ! grep -q "$KEY" "$TMP/err.txt"; then
    echo "🔴 $NAME:rc 對了($GOT), 而 stderr 沒有「$KEY」⇒ 它可能是為了別的理由回這個碼" >&2
    FAIL=1; return
  fi
  if [ "$KEY" = "-" ] && grep -q '🔴 vitest-ran-gate' "$TMP/err.txt"; then
    echo "🔴 $NAME:rc 對了($GOT), 而它同時印了抱怨 ⇒ 它其實不滿意" >&2; FAIL=1; return
  fi
  echo "✅ $NAME(rc=$GOT)"
}

echo "── vitest-ran-gate 出口逐個餵一發 ──"
# 🔴 本片的本體:帶顏色 ⇒ 不得再回 97
check '① 帶顏色 · 全綠 ⇒ 原封轉發 0' 0 "$(run "$TMP/color-green.txt" 0 run)" '-'
check '② 不帶色 · 全綠 ⇒ 原封轉發 0' 0 "$(run "$TMP/plain-green.txt" 0 run)" '-'
# 🔴 這一格是本片的正對照:真紅【不得】被蓋成 97(CI run 33396899912 就是那個病)
check '③ 帶顏色 · 真的有紅 ⇒ 原封轉發 1(不是 97)' 1 "$(run "$TMP/color-red.txt" 1 run)" '-'
# 🔴 這一格是負對照:剝色不可以剝到「它變得永遠找得到」
check '④ 真的沒有摘要行 ⇒ 仍要 97' 97 "$(run "$TMP/no-summary.txt" 1 run)" '它沒有跑'
check '⑤ 有摘要行而一格都沒真的跑 ⇒ 98' 98 "$(run "$TMP/all-skipped.txt" 0 run)" '一格都沒有真的跑'
# 🔴 codex must-fix:這一格原本零判別力 —— JSON 解析壞掉會落到 unknown-reporter 分支,
#    而那條也回 0、只印 🟡, 而 `KEY=-` 只攔 🔴 ⇒ 兩個世界印同一個 PASS。
#    ⇒ 改成【反向斷言】:它必須**沒有**印 unknown-reporter 那句, 才證明走的是 JSON 那條。
RC6=$(run "$TMP/json-ok.txt" 0 run --reporter=json)
if [ "$RC6" != 0 ]; then
  echo "🔴 6 JSON reporter:期望 rc=0, 實得 rc=$RC6" >&2; FAIL=1
elif grep -q '看不懂這一種輸出' "$TMP/err.txt"; then
  echo "🔴 6 JSON reporter:rc 對了, 而它其實走的是【看不懂 reporter】那條 ⇒ 這一格零判別力" >&2; FAIL=1
else
  echo "PASS 6 JSON reporter · numTotalTests>0 ⇒ 走 JSON 那條並轉發(rc=$RC6)"
fi
check '⑦ 換了本閘看不懂的 reporter ⇒ 轉發並吵' 0 "$(run "$TMP/no-summary.txt" 0 run --reporter=weird)" '看不懂這一種輸出'
# 🔴🔴 本片最重要的負對照:剝色【不可以】把「沒有摘要」剝成「有摘要」
check '⑧ 游標序列陷阱 ⇒ 仍要 97, 不得被剝成假綠' 97 "$(run "$TMP/cursor-trap.txt" 1 run)" '它沒有跑'
check '⑨ 冒號式 SGR ⇒ 剝得掉 ⇒ 0' 0 "$(run "$TMP/colon-sgr.txt" 0 run)" '-'

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 九格全過(3=「真紅不得被蓋掉」 · 8=「剝色不得剝過頭」 · 9=「冒號式 SGR 剝得掉」;96 未演)"
  exit 0
fi
echo "🔴 有格沒過 ⇒ 閘的行為與宣稱不符" >&2
exit 1
