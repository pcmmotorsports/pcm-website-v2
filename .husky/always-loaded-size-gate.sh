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
#    設閘那天實際 19,852。若硬上限設 20,000 ⇒ 餘裕只有 148 字元。
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
# 🔴 兩個數字都是【從量測推的】, 不是挑的(2026-09-02;R1 兩線都問「24,000 哪來的」):
#    量:瘦身前 18 筆 CLAUDE.md 改動 ⇒ 正增量 15 筆, 中位 **614**, p90 **1,301**, 最大 1,360。
#    設閘當下 19,852。
#      WARN=22000 ⇒ 餘裕 2,148 = **3.5 個中位改動** ⇒ 它不會在下一次改動就叫
#      HARD=26000 ⇒ 餘裕 6,148 = **10 個中位改動 / 4.7 個 p90 改動**
#      而 WARN 到 HARD 之間 4,000 = 6.5 個中位改動 ⇒ **看到警告之後還有很多時間搬**
#    ⛔ ~~原設 WARN=20000 / HARD=24000~~ 作廢 —— WARN 離當下只有 148 字元 = **0.2 個中位改動**
#       ⇒ 它會在【下一次任何改動】就叫 ⇒ 📌 **一道每次都叫的警告與一道從不叫的警告, 對讀的人是同一個東西。**
WARN=22000
HARD=26000

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
  # 🔴 期望值【從門檻推】, 不寫死數字 —— 否則改門檻時這幾格會紅, 而紅的是測試不是缺陷。
  #    (2026-09-02 實測:門檻從 20000/24000 改成 22000/26000 ⇒ 寫死版當場 2 格紅。)
  chk "遠低於警告帶"   "$(verdict 100)"                "ok"
  chk "警告帶下緣-1"   "$(verdict $((WARN-1)))"        "ok"
  chk "警告帶下緣"     "$(verdict "$WARN")"            "warn"
  chk "警告帶正中"     "$(verdict $(((WARN+HARD)/2)))" "warn"
  chk "硬上限-1"       "$(verdict $((HARD-1)))"        "warn"
  chk "硬上限"         "$(verdict "$HARD")"            "block"
  chk "遠超過"         "$(verdict $((HARD*4)))"        "block"
  # 🛑 而上面七格【全部只用相對關係】⇒ 它們證不到「門檻的絕對值是對的」。
  #    那一格靠檔頭那段量測(中位 614 / p90 1,301)與 Sean 的拍板, 不靠 selftest。
  chk "門檻順序 WARN<HARD" "$([ "$WARN" -lt "$HARD" ] && echo yes || echo no)" "yes"
  python3 -c "import io,sys;io.open(sys.argv[1],'w',encoding='utf-8').write('短'*100)" "$T/cjk.md"
  chk "中文算字元不算byte" "$(count_file "$T/cjk.md")" "100"
  chk "缺檔量不到"     "$(count_file "$T/nope.md" 2>/dev/null || printf 'ERR')" "ERR"
  # 🧬 突變格:證明 verdict 真的在承重 —— 換掉它, 上面那七格必須有東西紅。
  m=$(verdict "$HARD"); chk "突變靶(硬上限必須 block)" "$m" "block"
  # 🔴🔴 整合層 —— R2(2026-09-02)造了三發突變, 而【上面那些格全部活著】:
  #    mut4 把 `git show ":$F"` 換回 `cat "$F"`(= 整個還原 R1-① 的修法)⇒ 舊 selftest PASS
  #    mut5 把末行 `exit 1` 改成 `exit 0`(硬上限永不擋)          ⇒ 舊 selftest PASS
  #    mut6 把觸發條件的檔名改掉(閘永不啟動)                      ⇒ 舊 selftest PASS
  # 📌 ⇒ verdict 層的格子護的是【算得對不對】, 護不到【它有沒有被接上、讀哪棵樹、回什麼 rc】。
  #    本 repo 記過三次的病正是「閘被無聲改回讀錯的樹」—— 而那正好是 mut4。
  # 🔴 一定要【絕對路徑】—— it.sh 會 `cd` 進拋棄式 repo, 相對路徑當場失效。
  #    實測:相對路徑 ⇒ `cp` 失敗 ⇒ g.sh 不存在 ⇒ **五格全部 rc=127**, 而 127 看起來像「閘壞了」。
  GATE_SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[0]:-$0}")"
  R=$(mktemp -d) || exit 1
  cat > "$R/it.sh" <<'ITEOF'
set -u
R="$1"; G="$2"
w() { python3 -c "import io,sys;io.open(sys.argv[1],'w',encoding='utf-8').write('安'*int(sys.argv[2]))" "$1" "$2"; }
cd "$R/repo" || exit 9
git init -q . && git config user.email a@b.c && git config user.name t
mkdir -p .husky && cp "$G" .husky/g.sh
w CLAUDE.md 100; git add CLAUDE.md; git commit -qm i
bash .husky/g.sh >/dev/null 2>&1; echo "small=$?"
w CLAUDE.md 99999; git add CLAUDE.md; w CLAUDE.md 100
bash .husky/g.sh >/dev/null 2>&1; echo "stagedBig=$?"
w CLAUDE.md 100; git add CLAUDE.md; w CLAUDE.md 99999
bash .husky/g.sh >/dev/null 2>&1; echo "treeBig=$?"
w CLAUDE.md 100; git add CLAUDE.md; git rm -q --cached CLAUDE.md
bash .husky/g.sh >/dev/null 2>&1; echo "noBlob=$?"
git checkout -q -- . 2>/dev/null; git reset -q
echo x > other.md; git add other.md
bash .husky/g.sh >/dev/null 2>&1; echo "notStaged=$?"
ITEOF
  mkdir -p "$R/repo"
  env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_NAMESPACE \
      bash "$R/it.sh" "$R" "$GATE_SELF" > "$R/out" 2>/dev/null
  g() { grep -m1 "^$1=" "$R/out" 2>/dev/null | cut -d= -f2; }
  chk "整合:合規放行"           "$(g small)"     "0"
  chk "整合:staged 超標要擋"    "$(g stagedBig)" "1"
  chk "整合:只有工作樹超標要放"  "$(g treeBig)"   "0"
  chk "整合:讀不到 blob 要擋"    "$(g noBlob)"    "2"
  chk "整合:沒動到本檔要放行"    "$(g notStaged)" "0"
  rm -rf "$R"
  printf '⇒ selftest %s (通過 %s / 失敗 %s)\n' "$([ "$ng" -eq 0 ] && echo PASS || echo FAIL)" "$ok" "$ng"
  [ "$ng" -eq 0 ] || exit 1
  exit 0
fi

git diff --cached --name-only 2>/dev/null | grep -qx "$F" || exit 0

# 🔴 兩步, 不准串成一條管線(2026-09-02 我自己踩到, 而規則就寫在 CLAUDE.md 終端機紀律第 6 條):
#    `git show :F | python3 數長度` ⇒ git show 失敗時 python3 讀到空 stdin ⇒ **印 0 而 rc=0**
#    ⇒ 閘拿到「0 字元」⇒ 判 ok ⇒ **安靜放行**。實測:`git show :不存在的檔 | python3 …` ⇒ 印 0, rc=0。
#    📌 管線的 rc 是【最後一段】的, 而錯在第一段。
BLOB=$(mktemp) || { printf '🔴 建不出暫存檔 ⇒ 擋下\n' >&2; exit 2; }
trap 'rm -f "$BLOB"' EXIT
git show ":$F" > "$BLOB" 2>/dev/null
GRC=$?
[ "$GRC" -eq 0 ] || { printf '🔴 讀不到 staged 的 %s(git show rc=%s)⇒ 擋下, 不是「乾淨」\n' "$F" "$GRC" >&2; exit 2; }
N=$(python3 -c "import io,sys;print(len(io.open(sys.argv[1],encoding='utf-8').read()))" "$BLOB" 2>/dev/null)
PRC=$?
[ "$PRC" -eq 0 ] && [ -n "$N" ] || { printf '🔴 量不到字元數(python rc=%s)⇒ 擋下\n' "$PRC" >&2; exit 2; }

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
