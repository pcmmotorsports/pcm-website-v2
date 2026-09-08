#!/usr/bin/env bash
# 常載檔【淨增量】閘 —— 問的不是「現在多大」, 是「這一批讓它變大了嗎, 而有沒有人寫理由」。
#
# 🔴 為什麼要有它(Sean 2026-09-08 拍甲的另一半, 逐字:
#    「現在調上限先通關, 重開之後派一個窗【真的】重搬一次 + 立一條『新東西不准進常載』的閘」):
#    `.husky/always-loaded-size-gate.sh` 檔頭自己寫著它的射程 ——
#      逐字「它只答『總量到哪裡』, **答不出『新加的那段該不該在這裡』**」
#    ⇒ 📌 本檔補的就是那一格, 而**兩支是兄弟, 不是取代**。
#
# 🔬 病灶是量到的(2026-09-08 `tidy`;數法:
#    `git log --since=2026-09-02 --format=%H -- CLAUDE.md` 逐顆比 `sha:CLAUDE.md` 與 `sha^:CLAUDE.md`):
#      2026-09-02 搬過一次 43,326 ⇒ 19,650, 六天後回到 24,279
#      30 顆動到它 ⇒ **正增量 26 顆 / 負 4 顆**(6.5:1)· 中位 +266 · p90 +612 · 總和 +9,046
#    🔴 **關鍵是分佈**:四顆大的(1301/1000/637/612)只佔約 3,550, **其餘約 5,500 是小額**
#    ⇒ 🛑 **不能設「淨增量 > N 才叫」的門檻** —— 那會漏掉六成的成長。
#
# 🔴 floor = 0(主視窗提議小額地板, tidy 量完主視窗採納 floor=0):
#      地板 0/20/50 ⇒ 豁免 **0 顆** · 放掉 **0 字元**   ← 六天裡最小的正增量是 +74
#      地板 80 ⇒ 1 顆 / 74 字元(0.8%)   地板 200 ⇒ 10 顆 / 1,363 字元(15.1%)
#    ⇒ 📌 **地板小到只擋錯字就等於什麼都沒豁免;大到豁免得了東西, 就已經在吃真的新增。**
#    ⚠️ **這是【沒看到】不是【不會有】** —— 六天樣本裡沒出現錯字級 commit, 不代表它不存在。
#       真出現了再加地板是一行的事, 不預先造機構。
#
# ═══════════════════════════════════════════════════════════════════════
# 🔴🔴 **主閘掛在【收割】不掛在【推】, 理由是推的人是 Sean**(主視窗 2026-09-08 裁 Q3=丙)
# ═══════════════════════════════════════════════════════════════════════
#   本 repo 的硬規則:**所有施工窗都「不 push」, 只有 Sean 手動推。**
#   ⇒ 🛑 **主閘若只掛 pre-push, 那它唯一會叫的對象就是 Sean** —— 而他
#        ①不知道那段字是哪個窗加的 ②看不懂 `git log <範圍> -- CLAUDE.md` 要他做什麼
#        ③手邊唯一能讓他繼續的動作是關掉守門
#   ⇒ 📌 **一道只會擋老闆的閘, 會在第一次被撞到的那天被永久關掉。**
#   ✅ 所以主閘掛在 `scripts/harvest-chain.sh`(副手每一批合併之前跑的那條鏈)——
#      **收到紅的那個人有能力也有職責去追作者**(它本來就在做「量到一個數 ⇒ 找出是誰 ⇒ 敲那個窗」)。
#   🔵 `.husky/pre-push` **保留當兜底**, 給「繞過收割直接推」那條路。
#   ⛔ **下一個想把主閘移回 pre-push 的人:先回答「這一次撞到它的會是誰」。**
#
# ═══ 我試過而【拿掉】的兩個家, 舊字面留著免得有人再走一次 ═══
#   ⛔ ~~家放 `.husky/commit-msg`~~ ⇒ 實跑 `scripts/migration-post-commit-gate.test.ts`
#      **12 failed / 20 passed (32)**;撤線後 32/32。成因是兩個設計互斥:那支檔檔頭逐字
#      「正常路徑**連 git 都不呼叫**……**那一行是控制爆炸半徑的唯一憑據**」,
#      而本閘要知道 CLAUDE.md 有沒有被 staged 就一定要叫 git。
#   ⛔ ~~家放 `.husky/prepare-commit-msg`(單顆 commit 層)~~ ⇒ codex R2 開了**四條同形的** must-fix:
#        `git commit -C` 也給 source=commit ⇒ 誤判成 amend / merge 衝突用 -m 收尾 ⇒ 誤擋 /
#        被擋之後想用 --amend 補理由 ⇒ 編輯器還沒開就被擋 / `core.commentChar=';'` 我只濾 '#'
#      🔴 **四條是同一個形狀:每多認識一條 git 路徑, 就要多一個特例** ⇒ R4 換路訊號的字面。
#      ⇒ 📌 **而批次層一條都沒有** —— 它讀的是【已經進歷史的 commit 訊息】,
#         不需要知道那顆是怎麼做出來的(amend / 衝突 merge / 編輯器 / commentChar 一律不管)。
#
# 🛑 射程與明文缺口(不要讀寬):
#   1. 🔴 **第一次推一條分支時本閘不守**(`remote_sha` 全零 ⇒ 遠端還沒有它 ⇒ **沒有基準可比**)。
#      候選基準三個我都想過而都有問題:空樹(整支 CLAUDE.md 都算新增, 荒謬)/
#      merge-base(沒有遠端就沒有 base)/ 直接放行。
#      ⇒ **不發明基準** —— 📌 **一道「看起來有守而其實在猜」的閘, 比沒有那道閘糟。**
#      ⇒ ✅ 改成**出聲 skip**(印一行說它這一發沒守)。射程:`dev`/`main` 第一次推在本 repo
#        實務上不會發生, **而它是真的洞**。
#   2. 回饋在【合併之前】才到, 不是 commit 當下 ⇒ 加那段字的人當下不會知道。
#      🔵 緩解:紅字印出 `git log --oneline <範圍> -- CLAUDE.md` 讓收到的人當場查出**是哪幾顆**。
#      ⚠️ **緩解不等於沒有那個代價。**
#      🔴🔴 ⛔ ~~「讓收到的人當場查出**作者**」~~ —— **那句我寫過, 而它是錯的**(主視窗 2026-09-08 抓到, tidy 複量):
#         本 repo 每一顆 commit 的 `author` 都是 `probe`(實測近 60 顆:`probe` 59 · `Sean` 1;
#         數法 `git log -60 --format='%an' | sort | uniq -c`)
#         ⇒ 📌 **`%an` 對「哪一個窗做的」零判別力。**
#         🟢 正對照(同一把尺對 subject 有判別力):`git log -60 --format='%s' | sort -u | wc -l` ⇒ **55**。
#         ⇒ ✅ 所以紅字改印 `--oneline`(帶 subject), 並在紅字裡**明寫不要看 author**。
#         🎯 **為什麼這一格要寫進檔頭**:下一個撞到紅的人若去跑 `--format=%an`, 會拿到一堆 `probe` 然後放棄
#            ⇒ **那正是「他手邊最省力的合法出口」變壞的方式** —— 而閘不會知道自己被放棄了。
#   3. 它只看 `CLAUDE.md`。`~/.claude/rules/00-work-rules.md` 與 `MEMORY.md` 在 repo 外, 摸不到。
#   4. 🔴 **它答不出「你加的那一段該不該在常載」** —— 那是判斷。
#      **本閘擋的是「你沒注意到你在加」, 擋不住「你加了一段不該在這裡的」。兩者不可混為一談。**
#
# 🔴 設計依據裡誠實的一格(2026-09-08 量:CLAUDE.md 23,878, 距 WARN 27,000 還有 3,122):
#    **今天沒有任何人會被總量閘擋到** ⇒ 本閘的紅字**不能靠「你快撞牆了」說服人**,
#    只能靠那句判別句本身。⇒ 📌 **它上線那天不會有人感謝它 —— 它守的是三個月後。**
#
# 🔴 一個【上線前量不到】的缺口, 與它日後的量法(主視窗要求寫死在這裡):
#    逃生 token 只有一行 ⇒ 最便宜的通過方式可能退化成**反射式樣板** ⇒ 牙齒被磨掉。
#    ✅ **三個月後(約 2026-12-08)這樣量**:
#         git log --all --grep='常載新增理由' --format='%h %s' | wc -l     ← 分母
#         git log --all --grep='常載新增理由' --format='%B' | grep '常載新增理由'
#       ⇒ **逐條讀, 數有幾條答得出「為什麼非在常載不可」**。
#       退化到一半以上是樣板 ⇒ 修法不是把 token 變難打, 是把【落點】變好找。

set -u
F="CLAUDE.md"
TOKEN="常載新增理由:"          # 半形冒號 U+003A
TOKEN_FW="常載新增理由："        # 全形冒號 U+FF1A

# 🔴 **兩種冒號都要收**(codex R1 標 nit, tidy 判 must-fix):
#    第一版紅字寫「冒號是全形」而碼裡比對的是**半形** ⇒ 照著指示打的人**會被擋第二次**,
#    而**第二次被擋正是人伸手去拿 --no-verify 的那一刻** ⇒ 逃生口壞掉比沒有閘更糟。
# 🔴 **註解行不算** —— git 的 cleanup 會把它整行刪掉 ⇒ 訊息裡看得到而最後進歷史的那顆沒有。
#    ⚠️ **註解字元不一定是 `#`**(codex R2 #5):`core.commentChar` 可以設成別的。
#    ⇒ 當場問 git, 不寫死。問不到就退回 `#`(那是 git 的預設值)。
has_token() { # <訊息檔>
  local cc
  cc=$(git config --get core.commentChar 2>/dev/null)
  [ -n "$cc" ] || cc='#'
  [ "$cc" = "auto" ] && cc='#'
  grep -v "^[[:space:]]*[$cc]" "$1" 2>/dev/null | grep -qF "$TOKEN"    && return 0
  grep -v "^[[:space:]]*[$cc]" "$1" 2>/dev/null | grep -qF "$TOKEN_FW" && return 0
  return 1
}

# 🔴 fail-closed 要是【行為】不是【宣稱】(codex R1 #2 + R2 #1):
#    第一版用 `git show` 的 rc 當判準, 而它對【那棵樹沒這支檔】與【git 整個壞了】**回同一個東西**
#    ⇒ 假 git 固定回 3 ⇒ 兩邊都算 0 ⇒ 判「沒長大」⇒ **靜默放行**。
# ✅ 改成先分開問兩題:①這個 rev 解得出來嗎 ②那棵樹裡有沒有這支檔。
#    任一問失敗 = git 壞了 ⇒ rc=2(擋);②答「沒有」是**正常回答** ⇒ 0。
# 🧬 **這三道各要一個【不同的世界】才量得到 —— 前面那道會遮住後面那道**:
#    全壞的假 git 只證得到 rev-parse;只壞 ls-tree 才證得到第二道;只壞 ls-files 才證得到第三道。
#    📌 **少一個世界, 那一道就是【沒被測過的防禦碼】。** selftest 三支假 git 各對應一道。
count_blob() { # <rev|空字串=index> <path> -> 印字元數(0 = 那棵樹沒這支檔); rc=2 = git/python 壞了
  local rev="$1" path="$2" present b n rc
  if [ -z "$rev" ]; then
    present=$(git ls-files --stage -- "$path" 2>/dev/null); rc=$?
    [ "$rc" -eq 0 ] || return 2
  else
    git rev-parse --verify -q "$rev" >/dev/null 2>&1 || return 2
    present=$(git ls-tree --name-only "$rev" -- "$path" 2>/dev/null); rc=$?
    [ "$rc" -eq 0 ] || return 2
  fi
  [ -n "$present" ] || { printf '0'; return 0; }
  b=$(mktemp) || return 2
  git show "${rev}:${path}" > "$b" 2>/dev/null
  rc=$?
  if [ "$rc" -ne 0 ]; then rm -f "$b"; return 2; fi
  n=$(python3 -c "import io,sys;print(len(io.open(sys.argv[1],encoding='utf-8').read()))" "$b" 2>/dev/null)
  rc=$?
  rm -f "$b"
  [ "$rc" -eq 0 ] && [ -n "$n" ] || return 2
  printf '%s' "$n"
}

# 判決式只有這一支 —— selftest 與正式路徑共用它, 不准在別處重打一份。
verdict() { # <舊字元數> <新字元數> <有沒有token: yes|no> -> ok | block
  local delta=$(( $2 - $1 ))
  if   [ "$delta" -le 0 ]; then printf 'ok'
  elif [ "$3" = "yes" ];   then printf 'ok'
  else                          printf 'block'; fi
}

red() { # <舊> <新> <base> <tip>
  local delta=$(( $2 - $1 ))
  {
  printf '%s\n' "🔴 這一批讓常載檔 $F 變大了 $delta 字元($1 ⇒ $2), 而整批沒有一顆寫理由。"
  printf '%s\n' ''
  printf '%s\n' "🔎 是誰讓它變大的(當場查, 這一行可以整行複製):"
  printf '%s\n' "     git log --oneline $3..$4 -- $F"
  printf '%s\n' "     ⚠️ **看 subject 與 commit body, 不要看 author** —— 全 repo 的 author 都是 \`probe\`,"
  printf '%s\n' "        它分不出是哪一個窗(實測近 60 顆:probe 59 / Sean 1;而相異 subject 55)。"
  printf '%s\n' ''
  printf '%s\n' "❓ 判別句:**為什麼那一段非在常載不可?**"
  printf '%s\n' "   常載 = 每個 session 每次都付費讀的東西。它變大, 是全艦隊每個窗都變慢。"
  printf '%s\n' ''
  printf '%s\n' "✅ 兩條合法出路(都不必讀任何別的檔):"
  printf '%s\n' ''
  printf '%s\n' "  【甲】它真的該在常載 ⇒ 請那顆的作者在 commit body 補一行(整行複製即可):"
  printf '%s\n' ''
  printf '%s\n' "        $TOKEN <一句話:為什麼它非在常載不可>"
  printf '%s\n' ''
  printf '%s\n' "     真的例子:"
  printf '%s\n' "        $TOKEN 這是義務不是病史, 拿掉之後條文單獨讀會變寬"
  printf '%s\n' "        $TOKEN 這是路由鍵字面, 搬走路由表就不再是路由表"
  printf '%s\n' "     (半形或全形冒號都收;🔴 而那一行【不要用註解字元開頭】—— git 會整行刪掉)"
  printf '%s\n' "     補法:git commit --amend -F <訊息檔>(那條路本閘不在, 不會再擋你一次)"
  printf '%s\n' ''
  printf '%s\n' "  【乙】它其實是病史/實錘/舊字面 ⇒ 搬去落點檔, 常載只留【症狀句 + 一行 📎 指標】"
  printf '%s\n' "        落點:docs/patterns/{routing,ironrules,checklist}-casebook.md · zsh-and-bash-traps.md"
  printf '%s\n' "        搬完整批淨增量會 <= 0 ⇒ 本閘自動安靜放行(它獎勵搬出去)"
  printf '%s\n' ''
  printf '%s\n' "⛔ 不要靠刪字通過 —— 那些字裡住著 Sean 的拍板紀錄(鐵則 6 同款)。"
  printf '%s\n' ''
  printf '%s\n' "🛑 本閘擋的是「沒有人注意到常載在長大」, 擋不住「那一段不該在這裡」。"
  printf '%s\n' "   ⇒ 寫那一行的時候是【人】在判, 不是它在判。"
  } >&2
}

# ─────────────────────────────────────────────────────────────
# selftest
# ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  ok=0; ng=0
  chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); else ng=$((ng+1)); printf '  FAIL %s: got %s want %s\n' "$1" "$2" "$3"; fi; }

  chk "淨負(搬遷)⇒ 放行"        "$(verdict 1000 900 no)"   "ok"
  chk "淨零 ⇒ 放行"              "$(verdict 1000 1000 no)"  "ok"
  chk "淨增 1 而無 token ⇒ 擋"   "$(verdict 1000 1001 no)"  "block"
  chk "淨增 74(實測最小)⇒ 擋"   "$(verdict 1000 1074 no)"  "block"
  chk "淨增 1301(實測最大)⇒ 擋" "$(verdict 1000 2301 no)"  "block"
  chk "淨增而有 token ⇒ 放行"    "$(verdict 1000 2301 yes)" "ok"
  chk "突變靶(淨增無token必block)" "$(verdict 0 1 no)"      "block"

  TF=$(mktemp)
  printf '%s 半形\n' "$TOKEN"    > "$TF"; chk "半形冒號收"          "$(has_token "$TF" && echo y || echo n)" "y"
  printf '%s 全形\n' "$TOKEN_FW" > "$TF"; chk "全形冒號收"          "$(has_token "$TF" && echo y || echo n)" "y"
  printf '常載新增理由 沒冒號\n'  > "$TF"; chk "負對照:沒冒號不算"  "$(has_token "$TF" && echo y || echo n)" "n"
  printf '# %s 藏註解\n' "$TOKEN" > "$TF"; chk "註解行(#)的 token 不算" "$(has_token "$TF" && echo y || echo n)" "n"
  printf '  #%s 縮排\n' "$TOKEN"  > "$TF"; chk "縮排註解也不算"      "$(has_token "$TF" && echo y || echo n)" "n"
  rm -f "$TF"

  SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[0]:-$0}")"
  R=$(mktemp -d) || exit 1
  cat > "$R/it.sh" <<'ITEOF'
set -u
R="$1"; G="$2"; TOKEN="$3"
w(){ python3 -c "import io,sys;io.open(sys.argv[1],'w',encoding='utf-8').write('安'*int(sys.argv[2]))" "$1" "$2"; }
cd "$R/repo" || exit 9
git init -q . && git config user.email a@b.c && git config user.name t && git config commit.gpgsign false
cp "$G" g.sh
w CLAUDE.md 1000; git add CLAUDE.md; git commit -q -m base
BASE=$(git rev-parse HEAD)
# 🔴 不假設預設分支叫 master 還是 main —— 當場問。
#    (少了這一行, 下面的 `git checkout "$MAIN"` 在 `set -u` 下**直接殺掉整支 fixture**,
#     而 stderr 當時是被丟掉的 ⇒ 症狀是「後面每一格回空值」, 看起來像被測物壞掉。
#     📌 **一支把自己的 stderr 丟掉的 fixture, 會把【它自己死了】報成【那些格失敗】。**)
MAIN=$(git rev-parse --abbrev-ref HEAD)
# ① 這一批長大而沒有人寫理由 ⇒ 擋
w CLAUDE.md 1400; git add CLAUDE.md; git commit -q -m "silent growth"
GREW=$(git rev-parse HEAD)
echo "grewNoToken=$(sh g.sh --range "$BASE" "$GREW" >/dev/null 2>&1; echo $?)"
echo "grewReally=$(git show $GREW:CLAUDE.md | python3 -c "import sys;print(1 if len(sys.stdin.read())==1400 else 0)")"
# ② 再補一顆【自己帶理由】的 ⇒ 它自己那一顆過, 而①那顆仍然沒有理由 ⇒ 整批仍要擋
printf 'add reason\n\n%s 這是義務\n' "$TOKEN" > "$R/m"
w CLAUDE.md 1500; git add CLAUDE.md; git commit -q -F "$R/m"
WITH=$(git rev-parse HEAD)
echo "oneGoodOneBad=$(sh g.sh --range "$BASE" "$WITH" >/dev/null 2>&1; echo $?)"
# ②-b 正對照:從【那顆帶理由的】自己的父算起 ⇒ 只有它一顆 ⇒ 放行
echo "onlyGood=$(sh g.sh --range "$GREW" "$WITH" >/dev/null 2>&1; echo $?)"
# ②-c 🔴 母題格:一顆【只是在講那個 token】的 commit, 不可以替別人的成長背書
git checkout -q -b mention "$GREW"
printf 'talk about it\n\nthis commit explains that a body must contain %s and why\n' "$TOKEN" > "$R/m"
echo x > note.txt; git add note.txt; git commit -q -F "$R/m"
echo "mentionDoesNotVouch=$(sh g.sh --range "$BASE" "$(git rev-parse HEAD)" >/dev/null 2>&1; echo $?)"
git checkout -q "$MAIN"
# ③ 淨負(搬遷)⇒ 放行, 而且【不需要理由】
w CLAUDE.md 600; git add CLAUDE.md; git commit -q -m "moved out"
SHRUNK=$(git rev-parse HEAD)
echo "shrink=$(sh g.sh --range "$BASE" "$SHRUNK" >/dev/null 2>&1; echo $?)"
# ④ 註解行裡的 token 不算 ⇒ 擋(codex R2 #5 的 '#' 那一半)
git checkout -q -b cmt "$BASE"
printf 'grow\n\n# %s 藏註解\n' "$TOKEN" > "$R/m"
w CLAUDE.md 1600; git add CLAUDE.md; git commit -q -F "$R/m"
echo "commentToken=$(sh g.sh --range "$BASE" "$(git rev-parse HEAD)" >/dev/null 2>&1; echo $?)"
# ⑤ 🔴 commentChar 換成分號 ⇒ 分號註解裡的 token 也不能算(codex R2 #5 的另一半)
git config core.commentChar ';'
git checkout -q -b semi "$BASE"
printf 'grow\n\n; %s 分號註解\n' "$TOKEN" > "$R/m"
w CLAUDE.md 1700; git add CLAUDE.md; git commit -q -F "$R/m"
echo "semiToken=$(sh g.sh --range "$BASE" "$(git rev-parse HEAD)" >/dev/null 2>&1; echo $?)"
git config --unset core.commentChar
# ⑥ 沒長大 ⇒ 放行
echo "flat=$(sh g.sh --range "$BASE" "$BASE" >/dev/null 2>&1; echo $?)"
# ⑦ 那棵樹根本沒有 CLAUDE.md ⇒ 那是【合法的 0】不是故障
git checkout -q --orphan bare >/dev/null 2>&1; git rm -q -rf . >/dev/null 2>&1
echo o > o.txt; git add o.txt; git commit -q -m orphan
echo "noFile=$(sh ../repo/g.sh --range "$(git rev-parse HEAD)" "$GREW" >/dev/null 2>&1; echo $?)"
git checkout -q "$(git rev-parse --abbrev-ref --symbolic-full-name @{-1} 2>/dev/null || echo master)" >/dev/null 2>&1
# ⑧⑨⑩ fail-closed 三道 —— 三個【不同的世界】, 因為前面那道會遮住後面那道
mkdir -p "$R/fb1"; printf '#!/bin/sh\nexit 3\n' > "$R/fb1/git"; chmod +x "$R/fb1/git"
mkdir -p "$R/fb2"; { printf '#!/bin/sh\ncase "$1" in\n  ls-tree) exit 3 ;;\n  *) exec %s "$@" ;;\nesac\n' "$(command -v git)"; } > "$R/fb2/git"; chmod +x "$R/fb2/git"
# 🔴 改逐顆問責之後, 範圍那一層靠的是 `rev-list` 不是 `log` ⇒ 假 git 要壞【對的那一支】。
mkdir -p "$R/fb3"; { printf '#!/bin/sh\ncase "$1" in\n  rev-list) exit 3 ;;\n  *) exec %s "$@" ;;\nesac\n' "$(command -v git)"; } > "$R/fb3/git"; chmod +x "$R/fb3/git"
mkdir -p "$R/fb4"; { printf '#!/bin/sh\ncase "$1" in\n  log) exit 3 ;;\n  *) exec %s "$@" ;;\nesac\n' "$(command -v git)"; } > "$R/fb4/git"; chmod +x "$R/fb4/git"
echo "gitAllBroken=$(PATH="$R/fb1:$PATH" sh "$R/repo/g.sh" --range "$BASE" "$GREW" >/dev/null 2>&1; echo $?)"
echo "gitLsTreeBroken=$(PATH="$R/fb2:$PATH" sh "$R/repo/g.sh" --range "$BASE" "$GREW" >/dev/null 2>&1; echo $?)"
echo "gitRevListBroken=$(PATH="$R/fb3:$PATH" sh "$R/repo/g.sh" --range "$BASE" "$GREW" >/dev/null 2>&1; echo $?)"
echo "gitLogBroken=$(PATH="$R/fb4:$PATH" sh "$R/repo/g.sh" --range "$BASE" "$GREW" >/dev/null 2>&1; echo $?)"
ITEOF
  mkdir -p "$R/repo"
  env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_NAMESPACE \
      bash "$R/it.sh" "$R" "$SELF" "$TOKEN" > "$R/out" 2>"$R/err"
  g() { grep -m1 "^$1=" "$R/out" 2>/dev/null | cut -d= -f2; }
  chk "前提:那一批確實長大了"        "$(g grewReally)"      "1"
  chk "長大而無理由 ⇒ 擋"             "$(g grewNoToken)"     "1"
  # 🔴 一好一壞 ⇒ 仍要擋(舊做法「整批有一顆帶理由就放行」會在這裡印 0)
  chk "一顆有理由一顆沒有 ⇒ 仍要擋"   "$(g oneGoodOneBad)"   "1"
  chk "正對照:只有那顆有理由的 ⇒ 放行" "$(g onlyGood)"        "0"
  # 🔴🔴 母題格:一顆【只是在講 token】的 commit 不可以替別人的成長背書
  #    (2026-09-08 實錘:本閘自己那顆 commit 的 body 在解釋 token ⇒ 整批 +3,063 被靜默放行)
  chk "只是【提及】token 不算理由 ⇒ 擋" "$(g mentionDoesNotVouch)" "1"
  chk "淨負(搬遷)⇒ 放行且免理由"    "$(g shrink)"          "0"
  chk "R2#5a 井號註解的 token 不算"   "$(g commentToken)"    "1"
  chk "R2#5b 分號註解的 token 也不算" "$(g semiToken)"       "1"
  chk "沒長大 ⇒ 放行"                 "$(g flat)"            "0"
  chk "那棵樹沒有本檔 = 合法的 0"     "$(g noFile)"          "1"
  chk "fail-closed①全壞 ⇒ 擋"        "$(g gitAllBroken)"    "2"
  chk "fail-closed②只壞 ls-tree ⇒ 擋" "$(g gitLsTreeBroken)" "2"
  chk "fail-closed③只壞 rev-list ⇒ 擋" "$(g gitRevListBroken)" "2"
  # 🔵 `git log` 只用在【印出是哪幾顆】那一步 ⇒ 它壞掉不影響判決, 而必須仍然【擋】(非 0)。
  #    這一格刻意不要求 2 —— 要求 2 會是把「訊息印不出來」誤判成「量不到」。
  chk "只壞 log ⇒ 仍然擋(非 0)"      "$([ "$(g gitLogBroken)" != "0" ] && echo blocked || echo passed)" "blocked"

  # 🧬 紅字內容那一格 —— 沒有它, `%an` 哪天被加回來不會有任何東西紅
  RT=$(red 100 500 aaa bbb 2>&1)
  chk "紅字不印 author(它全是 probe)" "$(printf '%s' "$RT" | grep -c '%an')" "0"
  chk "紅字有印可複製的 --oneline"     "$(printf '%s' "$RT" | grep -c 'git log --oneline')" "1"
  chk "紅字明寫不要看 author"          "$(printf '%s' "$RT" | grep -c '不要看 author')" "1"

  # ── 🔴 接線層:上面每一格都直接呼叫本檔 ⇒ 對「有沒有人叫它」零判別力
  CH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/scripts/harvest-chain.sh"
  if [ -f "$CH" ]; then
    # 🔴 數【呼叫】不數【提到】—— 檔名在 if 測試 / 呼叫 / 錯誤訊息裡各一次(3 次)。
    #    拿「提到幾次」當尺, 改一行註解就會紅, 而拿掉真正那次呼叫它未必紅。
    #    (本輪我第二次踩同一個坑, 所以這句留著。)
    chk "接線:收割鏈真的呼叫本閘" "$(grep -c -- '--range' "$CH")" "1"
    chk "接線:閘名在 EXPECT_GATES" "$(sed -n "s/^EXPECT_GATES='\(.*\)'/\1/p" "$CH" | grep -c 'nigrow')" "1"
  else
    chk "接線:找得到 harvest-chain.sh" "missing" "found"
  fi
  PP="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/pre-push"
  if [ -f "$PP" ]; then
    chk "兜底:pre-push 仍呼叫本閘" "$(grep -c -- '--range' "$PP")" "1"
  else
    chk "兜底:找得到 pre-push" "missing" "found"
  fi
  [ -n "${NIKEEP:-}" ] && printf "TMPDIR=%s\n" "$R" >&2
  [ -n "${NIKEEP:-}" ] || rm -rf "$R"
  printf '⇒ selftest %s (通過 %s / 失敗 %s)\n' "$([ "$ng" -eq 0 ] && echo PASS || echo FAIL)" "$ok" "$ng"
  [ "$ng" -eq 0 ] || exit 1
  exit 0
fi

# ─────────────────────────────────────────────────────────────
# --range <base> <tip> :唯一的判決模式
# ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--range" ]; then
  BASE="${2:-}"; TIP="${3:-}"
  [ -n "$BASE" ] && [ -n "$TIP" ] || { printf '🔴 --range 要帶 <base> <tip>\n' >&2; exit 2; }
  OLD=$(count_blob "$BASE" "$F"); ORC=$?
  NEW=$(count_blob "$TIP" "$F");  NRC=$?
  [ "$ORC" -eq 0 ] && [ "$NRC" -eq 0 ] || { printf '🔴 量不到字元數(git 失敗)⇒ 擋下, 不是「乾淨」\n' >&2; exit 2; }
  # 整批沒長大 ⇒ 連逐顆都不用看(這是【便宜的早退】, 不是判決)
  [ "$NEW" -gt "$OLD" ] || exit 0

  # 🔴🔴 **逐顆問, 不要整批問**(2026-09-08 tidy 自己的閘被自己的 commit 放行之後改的):
  #    ⛔ ~~舊做法:整批的訊息串起來 grep 一次 token, 有就整批放行~~ **那是錯的, 兩個理由**:
  #      ① **「提及」與「使用」分不出來** —— 本閘自己那顆 commit(`91541b009`)的 body 在**解釋**
  #         這個 token(逐字「commit body 沒有 `常載新增理由:` ⇒ 擋」)⇒ **整批被判成有人寫了理由**。
  #         🔬 實測:`811abf11c..HEAD` CLAUDE.md **20,815 ⇒ 23,878(+3,063)**, 而閘 **rc=0 靜默放行**。
  #         📌 這是本 repo 記過的母題:**逐字比對的閘分不出「這是一個 X」與「這是在講 X」**,
  #            而**最會去講它的人, 正是維護它的人**。
  #      ② 就算沒有①, **一顆寫了理由的 commit 會替【另一顆】的成長背書** —— 那不是它的理由。
  #    ✅ 改成:**逐顆算它自己的增量, 而理由要寫在【那一顆自己的訊息】裡。**
  #    ⚠️ 射程:用 `--no-merges` ⇒ **merge 衝突解決時【在 merge commit 裡】長出來的字看不到**。
  #       那是已知缺口 —— 逐顆是為了問責, 而 merge commit 沒有「作者的那一段字」可問。
  BAD=""; BADN=0
  CL=$(mktemp) || exit 2
  # 🔴 **一定要帶 `-- "$F"` 這個 pathspec**(2026-09-08 實測:少了它, 一個一百多顆的範圍
  #    要跑超過 120 秒 —— 每一顆都開 `git ls-tree` + `git show` + `python3`, 而 python3 的
  #    啟動成本乘以顆數就是全部的時間)。
  #    ✅ 而它**語意零改變**:一顆**沒有動到 `$F`** 的 commit, 不可能讓 `$F` 變大。
  #    🔬 實測(本 repo, `dc171a713..f49e15745`):不帶 pathspec 逾時 >120s ⇒ 帶了之後見下方計時。
  git rev-list --no-merges --reverse "$BASE..$TIP" -- "$F" > "$CL" 2>/dev/null
  RLRC=$?
  if [ "$RLRC" -ne 0 ]; then rm -f "$CL"; printf '🔴 讀不到 %s..%s 的 commit 清單(git rc=%s)⇒ 擋下\n' "$BASE" "$TIP" "$RLRC" >&2; exit 2; fi
  while IFS= read -r C; do
    [ -n "$C" ] || continue
    CO=$(count_blob "${C}^" "$F"); CORC=$?
    [ "$CORC" -eq 0 ] || CO=0          # 沒有父(第一顆)⇒ 基準 0
    CN=$(count_blob "$C" "$F"); CNRC=$?
    [ "$CNRC" -eq 0 ] || { rm -f "$CL"; printf '🔴 量不到 %s 的 %s ⇒ 擋下\n' "$C" "$F" >&2; exit 2; }
    [ "$CN" -gt "$CO" ] || continue
    MB=$(mktemp) || { rm -f "$CL"; exit 2; }
    git show -s --format=%B "$C" > "$MB" 2>/dev/null
    if has_token "$MB"; then rm -f "$MB"; continue; fi
    rm -f "$MB"
    BADN=$((BADN + 1))
    BAD="$BAD
     $(git log -1 --format='%h %s' "$C" 2>/dev/null | cut -c1-88)  (+$((CN - CO)) 字元)"
  done < "$CL"
  rm -f "$CL"
  [ "$BADN" -gt 0 ] || exit 0
  red "$OLD" "$NEW" "$BASE" "$TIP"
  {
  printf '%s\n' ''
  printf '%s\n' "🔎 **這 $BADN 顆讓它變大而自己的訊息裡沒有理由**(逐顆算的, 不是整批):"
  printf '%s\n' "$BAD"
  } >&2
  exit 1
fi

printf '🔴 用法:%s --range <base> <tip> | --selftest\n' "$0" >&2
exit 2
