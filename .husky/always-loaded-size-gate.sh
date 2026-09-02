#!/usr/bin/env bash
# 常載檔字元數閘 —— 擋「每次事故 +300~3,000 字元, 只增不減」那個 ratchet。
#
# 🔴 為什麼是【字元數】不是【行數】(2026-09-02 量到, 這一格推翻了既有規則):
#    `~/.claude/rules/00-work-rules.md:89` 寫「CLAUDE.md >150 行 ⇒ 內容移按需檔」。
#    本輪瘦身:砍前 166 行 / 43,326 字元(每行 261)⇒ 砍後 171 行(`wc -l`)/ 19,650 字元(每行 115)。
#    ⇒ 📌 **行數變多了而負擔少 55%** —— 把長行拆短會讓行數閘更紅, 而那個動作讓檔案更好讀。
#    ⇒ 🛑 **行數與真正的負擔可以反向 ⇒ 用行數當代理的閘會在錯的方向叫。**
#    ⚠️ 而 `wc -l` = 171 / python `split(chr(10))` = 172(尾端換行)—— **兩個都對, 定義不同**。
#       本檔一律用字元數, 不用行數, 所以這一格不影響判決。
#
# 🔴 為什麼是【警告帶 + 硬上限】兩段, 不是一條線(2026-09-02 codex + Fable 兩個獨立審查都打這一格):
#    設閘那天實際 19,650。若硬上限設 20,000 ⇒ 餘裕 350 字元。
#    而實量瘦身前 18 筆 CLAUDE.md 改動:正增量 15 筆, **其中 12 筆單次 >350 字**(80%), 中位數約 613。
#    ⇒ 📌 **它會在四次正常改動裡叫三次** ⇒ 而**閘死於誤報遠比死於漏報常見**
#    ⇒ 最便宜的解法會變成 `--no-verify` 或把它註解掉 ⇒ 那時候它一次都不會再叫。
#    ✅ 所以:`WARN` 只印不擋(留訊號), `HARD` 才擋(留出路)。
#
# 🔴 為什麼量【staged blob】不量工作樹(同樣是兩個審查獨立打的):
#    先 stage 一份超標的、再把工作樹改小而不重新 `add` ⇒ commit 進去的仍然超標, 而閘放行。
#    反向則誤擋。⇒ 這是本 repo 記過三次的「閘讀哪棵樹」病族。⇒ 一律 `git show :<檔>`。
#
# 🛑 射程(它擋不住什麼):
#    · 只看 `CLAUDE.md`。`~/.claude/rules/00-work-rules.md` 與 `MEMORY.md` 在 repo 外,
#      pre-commit 摸不到它們 ⇒ **那兩支沒有閘**。已知缺口, 不是疏漏。
#    · 它只答「總量到哪裡」, **答不出「新加的那段該不該在這裡」** —— 那是判斷。

set -u
F="CLAUDE.md"
WARN=20000
HARD=24000

# 判決式只有這一支 —— selftest 與正式路徑共用它, 不准在別處重打一份。
# (Fable 2026-09-02:selftest 若重打比較式, 把本體 `-gt` 改成 `-lt` 它照樣全綠。)
verdict() { # <字元數> -> ok | warn | block
  if   [ "$1" -ge "$HARD" ]; then printf 'block'
  elif [ "$1" -ge "$WARN" ]; then printf 'warn'
  else printf 'ok'; fi
}
count_file() { python3 -c "import io,sys;print(len(io.open(sys.argv[1],encoding='utf-8').read()))" "$1"; }

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  ok=0; ng=0
  chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); else ng=$((ng+1)); printf '  FAIL %s: got %s want %s\n' "$1" "$2" "$3"; fi; }
  chk "遠低於警告帶"   "$(verdict 100)"    "ok"
  chk "警告帶下緣-1"   "$(verdict 19999)"  "ok"
  chk "警告帶下緣"     "$(verdict 20000)"  "warn"
  chk "警告帶內"       "$(verdict 22000)"  "warn"
  chk "硬上限-1"       "$(verdict 23999)"  "warn"
  chk "硬上限"         "$(verdict 24000)"  "block"
  chk "遠超過"         "$(verdict 99999)"  "block"
  python3 -c "import io,sys;io.open(sys.argv[1],'w',encoding='utf-8').write('短'*100)" "$T/cjk.md"
  chk "中文算字元不算byte" "$(count_file "$T/cjk.md")" "100"
  chk "缺檔量不到"     "$(count_file "$T/nope.md" 2>/dev/null || printf 'ERR')" "ERR"
  # 🧬 突變格:證明 verdict 真的在承重 —— 換掉它, 上面那七格必須有東西紅。
  m=$(verdict "$HARD"); chk "突變靶(硬上限必須 block)" "$m" "block"
  printf '⇒ selftest %s (通過 %s / 失敗 %s)\n' "$([ "$ng" -eq 0 ] && echo PASS || echo FAIL)" "$ok" "$ng"
  [ "$ng" -eq 0 ] || exit 1
  exit 0
fi

git diff --cached --name-only 2>/dev/null | grep -qx "$F" || exit 0

N=$(git show ":$F" 2>/dev/null | python3 -c "import sys;print(len(sys.stdin.buffer.read().decode('utf-8')))" 2>/dev/null) || {
  printf '🔴 量不到 staged 的 %s(工具自己壞了)⇒ 擋下, 不是「乾淨」\n' "$F" >&2; exit 2; }
[ -n "$N" ] || { printf '🔴 staged %s 的字元數是空的 ⇒ 擋下\n' "$F" >&2; exit 2; }

V=$(verdict "$N")
if [ "$V" = "ok" ]; then exit 0; fi

printf '%s\n' "📏 staged $F = $N 字元(警告帶 $WARN / 硬上限 $HARD)" >&2
printf '%s\n' '' >&2
printf '%s\n' '🎯 正解:把【病史·實錘·射程】搬去落點檔, 常載只留【症狀句 + 一行指標】。' >&2
printf '%s\n' '   範例:2026-09-02 那兩顆 refactor(docs) —— 43,326 ⇒ 19,650。' >&2
printf '%s\n' '   落點:docs/patterns/{routing,ironrules,checklist}-casebook.md · zsh-and-bash-traps.md' >&2
printf '%s\n' '⛔ 不要靠刪字通過 —— 那些字裡住著 Sean 的拍板紀錄。' >&2
printf '%s\n' '🛑 而搬無可搬時【不要 --no-verify】⇒ 整理一題給 Sean(調上限 / 砍條文 / 換載體), 那是第三條合法出路。' >&2
printf '%s\n' '🛑 本閘證不到「新加的那段該不該在這裡」—— 它只會數總量。' >&2

if [ "$V" = "warn" ]; then
  printf '%s\n' '' >&2
  printf '%s\n' "🟡 這是【警告】不是擋下 —— commit 會過。而它出聲是因為離硬上限只剩 $((HARD-N)) 字元。" >&2
  exit 0
fi
printf '%s\n' '' >&2
printf '%s\n' "🔴 超過硬上限 $((N-HARD)) 字元 ⇒ 擋下。" >&2
exit 1
