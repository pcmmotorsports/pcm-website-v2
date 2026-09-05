#!/bin/bash
# selftest-git-isolation-gate.sh
#   問題:一支腳本的 `--selftest` 常常會自己 `git init` 一個拋棄式世界來演給自己看。
#   而 `pre-commit` 會設 `GIT_DIR` / `GIT_INDEX_FILE`(**不設 `GIT_WORK_TREE`**)
#   ⇒ 那個「拋棄式世界」的 git 指令會**打到真的 repo 上**。
#   2026-08-25 實錘:一支 selftest 在別人的 pre-commit 底下把 3,231 個檔案的 index 清空,
#   而它自己印的是「全部通過」。
#
# 🔴 本閘【不用字面判斷】。
#   字面尺(grep `git init`)的錯有方向 —— 它只會往【少報】掉:
#   用變數組出來的、包在別支腳本裡的、寫成 subprocess list 的,它都看不見。
#   而少報在這道閘上零訊號:漏掉的那一支就是下一次事故。
#   ⇒ 本閘改成【行為尺】:建一個受害者 repo, 把 GIT_DIR 指過去, 跑那支 selftest,
#     看受害者有沒有變。**它有沒有隔離, 由它的行為回答, 不由它的原始碼回答。**
#
# 用法
#   bash scripts/selftest-git-isolation-gate.sh              # 掃全部候選
#   bash scripts/selftest-git-isolation-gate.sh --selftest   # 本閘自己的兩方向證人
#
# 退出碼
#   0 = 沒有新的違規者   1 = 有違規者(finding)   2 = 本閘自己壞了(量具失效)
#
# ⚠️ 天花板(不假裝驗過)
#   ① 只跑 `scripts/*.py` 與 `scripts/*.sh`。`.ts`(走 vitest)與 `.husky/*.sh`
#      不在分母裡 —— 後者不是 `--selftest` 入口。
#      🔴🔴 **而分母本身是用 `grep -l -- '--selftest'` 撈出來的, 那把撈子有一個靜默的洞**:
#      這台的 `grep` 是 **`ugrep`**(不是 GNU grep), 而 Bash 工具那層每次注入 **`-I`**
#      ⇒ 它把檔判成 **binary** 就**整支跳過** —— 零輸出、`rc=1`,
#      **與「這支檔裡沒有 `--selftest`」印一模一樣的東西** ⇒ **分母縮水零訊號。**
#      **哪些會被判 binary(2026-08-25 夜逐項實測, 每支都含 `--selftest` 兩次)**:
#        · 含 **NUL** byte              ⇒ `file` 印 `data`     ⇒ **跳過**(`-c` 空 / `-l` 零命中)
#        · **編碼不合法**(半個多位元組) ⇒ `file` 印 `ISO-8859` ⇒ **跳過**
#        · 含 **C1**(NEL, 合法 UTF-8)   ⇒ `file` 印 UTF-8      ⇒ 🔴 **不跳過, 完全正常**
#          ⚠️ 全隊曾廣播「含 C1 或 NUL ⇒ binary」—— **C1 那一半我量到的是【不會】**, 已更正。
#      **救法**:加 `-a`(`grep -a -c`)⇒ 上面兩種都回到正確值;`python3` 走真 grep 不中。
#      **判別法**:`file -b <檔>` 印 `data` 或 `ISO-8859` ⇒ 對 ugrep 全盲。
#        🔴 **而 `file` 有一族答不出來** —— 見 ⑤, 那裡 `file` 印的是 `ASCII text`。
#      🔴 **多檔模式形狀不同**:零命中印 `檔名:0`, 而被判 binary 的那支**整行不見**
#        (實測:餵 4 支 ⇒ 只吐 2 行)⇒ **數「輸出行數 == 餵進去的檔數」, 不是看有沒有 0。**
#      ⚠️ **不是每次弄壞都會中** —— 切在乾淨字邊界仍是合法 UTF-8 ⇒ 那一發「重現失敗」,
#         **而失敗的那一發看起來就像「這個病不存在」。**(我自己第一發就是這樣。)
#      現況(2026-08-25 夜量;**用 python3 逐檔讀 bytes, 不用 grep** ——
#         用 grep 去量「有沒有 grep 看不到的檔」= 拿瞎掉的那隻眼睛數自己的盲點):
#         `scripts/` 底下 `.sh`+`.py` **181 支** · 編碼解不開 **0** · 含 NUL **0** · 聯集 **0**。
#         負對照:餵自造的那兩支壞檔 ⇒ 各自被認出來 ⇒ **這個檢查會動**。
#         🔴 而在量之前, 「181」在【真的 181】與【有幾支瞎掉】印同一個數字。
#      ⚠️ 只在本機這台 `ugrep 7.8.4` 驗過, **別台未確認**。
#   ② 只設 `GIT_DIR` + `GIT_INDEX_FILE` 兩個, 因為 pre-commit 真的只設這兩個。
#      🔴 **模擬一個環境時, 多設一個變數會讓它變成另一個環境。**
#   ③ 超時 = **量不到**, 不是乾淨。慢的腳本會被標 TIMEOUT 並單獨列出。
#   ④ 🔴 **`CLEAN` 只涵蓋 `snap()` 那五格量得到的東西, 而那五格【只讀受害者 repo `$V`】。**
#      ⇒ 一支用**非 git 手段**寫真樹的 selftest(`rm` / `> file` / 寫 `.next` 產物)本閘印 CLEAN。
#      **以下仍然量不到**, 而每一項後面標了它的**證據等級**(2026-08-25 R2):
#        · `.git/hooks/` 被寫入          —— **實測**
#        · `.git/info/exclude`           —— **實測**
#        · `packed-refs` 重排(`pack-refs --all` / `gc`) —— **實測**(五格一個位元不動)
#        · `reflog`(`reflog expire --all`) —— **實測**(五格一個位元不動)
#        · `git config --global`         —— **實測**(2026-08-25 夜, 假 `HOME` + `GIT_CONFIG_GLOBAL`
#          導向拋棄式目錄, 導向與真全域設定未變兩件事都證了)。尺只看 `--local`。
#        · 🔴🔴 **「重複鍵對調」= 一次真的身分劫持, 而第四格印【逐字相同】的值** —— **實測**。
#          `git config` 對重複鍵取的是**最後一個** ⇒ `.git/config` 裡兩行 `name = AAA` / `name = BBB`,
#          把它們對調 ⇒ 生效 `user.name` **`BBB` ⇒ `AAA`**, 而第四格兩次都是 `220376642_204`。
#          成因:第四格先 `sort` 再 hash ⇒ **行序不進 hash**。
#          📌 **這一項刻意【不】叫「行序重排」** —— 那個名字聽起來無害, 會被略過;
#            而它實際上是一個**會改變生效身分**的洞。**同一件事, 兩個名字, 一個會被跳過一個不會。**
#          🔴 而這個盲區是**寫這把尺的人自己造的**:那個 `sort` 是為了**消除輸出順序的噪音**而加的。
#            **為了讓輸出穩定而做的正規化, 買到一個盲區。**(同族:天花板 ① 的 `ugrep` ——
#            它為了不吐亂碼而拒讀整支檔, 買到一個會靜默歸零的分母。)
#        · **瞬時寫入**(建了又刪:`stash` 後 `stash drop`、建 ref 又刪)—— **實測**逐字回到原值。
#          📌 這是 before/after 快照尺的**天生形狀**, 不是漏補的格子。
#      🔴🔴 **`stash` 不在上面這張表裡, 因為它【看得見】** —— R2 實測:留著的 `stash` 會讓
#      `refs/stash` 出現在 `git for-each-ref` ⇒ **第五格紅**, 而前四格全部不動。
#      📌 **上一版這裡把 `stash` 列成「量不到」, 而且整段寫著「code-reviewer 實測列出, 不是推測」——**
#      **那句出處宣稱把【推理】升級成【量測】, 而唯一被它掩護的錯項, 正是量一下就會掉出來的那一項。**
#      (§6-b:完成式動詞落筆時要自問「這是量到的還是推出來的」。)
#      📌 **這一節是尺的形狀, 不是待辦清單。** 要讀成「它看得到哪些」, 不要讀成「這支腳本安全」。
#   ⑤ 🔴🔴 **`ugrep -vc` 與 GNU `grep -vc` 會給不同的數字, 而【規則我沒有找出來】。**
#      2026-08-25 夜量:同一個兩行檔(`aaa` / `bbb`)· 8 種 pattern × 檔尾有無換行 = **16 格 · 6 格不一致**。
#      觀察到**兩個互相獨立的觸發條件**, 而它們的**方向相反**:
#        (a) 檔尾**沒有換行** + 一般 pattern(`aaa` / `zzz` / `b$`)⇒ ugrep 比真 grep **少 1**
#        (b) pattern 含 `*` 而**可以匹配空字串**(`x*` / `a*`)⇒ ugrep **多**, 而且**有結尾換行照樣不一致**
#            (實測 `-vc 'x*'` 有換行:ugrep **2** / 真 grep **0**)
#        一致的:`^$` / `^` / `$` 兩種檔尾都一致。
#      🔴🔴 **所以【不要】記成「沒有結尾換行才會中」, 也【不要】記成「錯的方向固定」——**
#        **我自己先寫成那兩句, 兩句都被後面的量測推翻。** 多量六格就翻掉了。
#      🔴 `file -b` 對上面每一支都印 `ASCII text` ⇒ **純 ASCII, 與編碼無關**, ① 的判別法看不到這一族。
#      **安全做法**:要數數就用 `/usr/bin/grep` 或 `awk` 或 `python3`, **不要用 `grep -vc`**。
#      📌 **本閘不用 `grep -v`, 所以本閘不中。** 寫在這裡是因為 `scripts/` 底下有別支在用:
#         `migration-ledger-divergence.sh` 的 `n_odd_R` / `n_odd_H` 自檢(走 **pre-push**;
#         查法 `grep -n 'n_odd_R=' scripts/migration-ledger-divergence.sh` ——
#         🔴 這裡原本寫 `:192-193`, 2026-08-27 那支加了註解就漂到別處了),
#         而那道自檢正上方的註解寫著它是為了抓「形狀對不上的列會靜默消失」。
#         2026-08-25 夜實測:`supabase/APPLIED.tsv` 與重現出的 `R.raw`/`H.raw` **都以 `0a` 結尾**,
#         兩把 grep 給的 `n_odd` 皆 **0**, 餵進 214 列吐出 214 列 ⇒ **條件不成立, 不是事故**。
#         ⚠️ 而那兩行的 pattern 不含 `*` ⇒ **(b) 那一族也不中**。**兩族都要問, 不要只問一族。**
#      📌 同族還有一支**靠運氣安全**的:`b2s2b-verify.sh:253` 的 `nwords()` 用 `printf '%s'`(**無結尾換行**)
#         餵 `grep -vc '^$'` ⇒ **實測答案正確**, 因為 `^$` 剛好是一致的那幾個之一。
#         🔴 **它是對的, 而理由不是寫它的人想的那個** —— 有人把 `^$` 換成別的 pattern, 它就開始少算。
set -u

# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 本閘【自己】曾經犯下它要抓的那個病 —— 2026-08-25, 收包的人在 pre-commit 底下撞到。
#   形狀:手動跑 5 PASS「全部通過。」/ 在 pre-commit 底下 exit 2「正對照沒抓到」,
#         而**同一發還把一個誘餌 repo 從 7 個檔寫成 12 個**。
#   成因:`pre-commit` 設了 `GIT_DIR` / `GIT_INDEX_FILE`, 而本閘蓋受害者 repo 用的
#         `git init` / `git add` / `git commit` **一路繼承下去** ⇒ 蓋在別人的倉庫上。
#   📌 **一把抓「沒有隔離」的尺, 自己沒有隔離。** 而它手動跑是全綠的 ——
#      綠的那一次與壞的那一次, 差別只有【誰在跑它】。
# ⇒ 修法:本閘自己的每一發 git 都在**剝乾淨的環境**下跑;
#   只有 `probe ... yes` 那一發【故意】把 GIT_DIR 指向受害者。
#   證人 = `--selftest` 的「丁」格(帶著 GIT_DIR 跑, 誘餌不得變、且 selftest 要真的跑完)。
# ══════════════════════════════════════════════════════════════════════════════
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$_v"; done
unset _v

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPROOT="${TMPDIR:-/tmp}/sgi.$$"
V="$TMPROOT/victim"
LIMIT="${SGI_TIMEOUT:-240}"
trap 'rm -rf "$TMPROOT"' EXIT

# ── 已知違規者(2026-08-25 量到, 尚未修)────────────────────────────────
#   🔴 這張表是**債, 不是豁免**。每一支旁邊要寫「它壞在哪」, 修好就從這裡刪掉。
#   📌 2026-08-25 09:43 實例:`view-apply-before-wire-gate.py` 在我量測**中途**被別的窗修好了
#      (mtime 09:41:35, 修法 = `_GIT_FREE_ENV`)⇒ 同一支檔在 20 分鐘內量到 DIRTY 兩次、CLEAN 三次。
#      🔴 **那不是尺不穩, 是靶在動。** 八個窗共用一棵樹時, 這張表的每一列都自帶保鮮期
#      ⇒ **引用本表前先跑一次本閘, 不要引用這幾行。**
#   🔴 本閘對【表上的】只印不擋, 對【表外新出現的】才 exit 1
#      —— 否則它會一裝就紅, 而一裝就紅的閘會在三天內被繞過去。
# 🔴 2026-08-25 收工:三支全部修完 ⇒ 本表【清空】。
#    清空之後本閘對【任何】違規者都 exit 1 —— 而當下違規 0, 所以它是綠的。
#    ⇒ 下一個違規者出現時它會直接擋人, 那是刻意的:表空著的時候, 沒有「已知例外」這種東西。
KNOWN="
"

die() { echo "🔴 $1 ⇒ 本閘自己壞了, exit 2" >&2; exit 2; }

mkvictim() {
  rm -rf "$V"; mkdir -p "$V" || die "mkdir victim"
  ( cd "$V" && git init -q . && git config user.email v@v.t && git config user.name victim ) || die "git init victim"
  for i in 1 2 3 4 5; do printf 'x%s\n' "$i" > "$V/f$i.txt"; done
  ( cd "$V" && git add f1.txt f2.txt f3.txt f4.txt f5.txt && git commit -qm base ) >/dev/null || die "commit victim"
}
# 🔴 第四格 `config` 是 2026-08-25 補的, 而**補它的理由是一次真事故**:
#    那天出事的 selftest 除了在真 repo 建假 commit, 還把 `.git/config` 的身分
#    改成 fixture 用的名字(`probe` → `victim`)。
#    📌 **改 config 不會讓前三格裡的任何一個數字變** ⇒ 本尺對那一整族傷害【完全失明】,
#      而它印的是 `CLEAN`。「沒看到」與「沒有」在這把尺上印同一個字。
#    ⇒ 證人 = `--selftest` 的「己」格:一支【只改 config、不碰檔案】的樁, 兩方向。
# 🔴 第五格 `for-each-ref` 是**同一輪 code-reviewer 打出來的**, 而它指的是**另一起真事故**:
#    `.husky/pre-push:46` 記著「建 4 顆 commit 並把 **dev** 指過去」——
#    📌 **動的不是 HEAD, 是別的 ref** ⇒ `git rev-parse HEAD` 一個位元都不變, `git ls-files` 也不變。
#    reviewer 實測:樁做 `git branch` + `git tag`, 四格尺印 **CLEAN** 而四項傷害全部落地。
#    ⇒ 證人 = 「庚」格。
#    ⚠️ **兩次都是同一個形狀**:補一族盲區的當下, 要問「還有哪一族長得像它」——
#      config / refs 兩族都是「不經過工作樹的寫入」。第三族見天花板 ④, 那些**仍然量不到**。
# 🔴 `cksum` 的分隔改 `tr ' ' '_'`(原 `tr -d ' '`):`cksum` 印的是 `sum bytes` 兩個數字,
#    整個刪空白會把 (38164600,14176) 與 (3816460014,176) 黏成同一個字串。機率極低而修法零成本。
snap() {
  printf '%s %s %s %s %s' \
    "$(cd "$V" && git ls-files | wc -l | tr -d ' ')" \
    "$(cd "$V" && git rev-parse HEAD 2>/dev/null || echo none)" \
    "$(cd "$V" && git status --porcelain | wc -l | tr -d ' ')" \
    "$(cd "$V" && git config --local --list | sort | cksum | tr ' ' '_')" \
    "$(cd "$V" && git for-each-ref | cksum | tr ' ' '_')"
}
# 跑一支, 印 "狀態 rc";狀態 = CLEAN / DIRTY / TIMEOUT
probe() { # $1=相對路徑  $2=leak(yes/no)
  local f="$1" leak="$2" cmd b a rc pid waited=0
  local fp
  case "$f" in /*) fp="$f" ;; *) fp="$ROOT/$f" ;; esac
  case "$f" in
    *.py) cmd=(python3 "$fp" --selftest) ;;
    *.sh) cmd=(bash    "$fp" --selftest) ;;
    *) echo "SKIP 0"; return ;;
  esac
  mkvictim; b=$(snap)
  if [ "$leak" = yes ]; then
    ( cd "$ROOT" && GIT_DIR="$V/.git" GIT_INDEX_FILE="$V/.git/index" "${cmd[@]}" ) >/dev/null 2>&1 &
  else
    ( cd "$ROOT" && "${cmd[@]}" ) >/dev/null 2>&1 &
  fi
  pid=$!
  while kill -0 $pid 2>/dev/null; do
    sleep 1; waited=$((waited+1))
    [ $waited -ge "$LIMIT" ] && { kill -9 $pid 2>/dev/null; echo "TIMEOUT -"; return; }
  done
  wait $pid; rc=$?
  a=$(snap)
  [ "$b" = "$a" ] && echo "CLEAN $rc" || echo "DIRTY $rc"
}

controls() {
  mkvictim; local b a
  b=$(snap)
  ( cd "$ROOT" && GIT_DIR="$V/.git" GIT_INDEX_FILE="$V/.git/index" git rm -q --cached f1.txt ) >/dev/null 2>&1
  a=$(snap)
  [ "$b" != "$a" ] || die "正對照:明知會弄壞的樁沒被抓到 ⇒ 本尺零判別力"
  mkvictim; b=$(snap); a=$(snap)
  [ "$b" = "$a" ] || die "負對照:什麼都沒跑而受害者變了 ⇒ 尺自己有噪音"
}

# ══ 掃描 + 判離場碼 —— 🔴 **抽成函式, 而那不是整理版面** ════════════════════
#
# 🎯 **它取代的是一個【測試接縫】**(codex R2 must-fix):
#    上一版為了讓證人格能餵假候選清單, 開了一對環境變數當接縫
#    (`SGI_SELFTEST_FAKE_CAND` + 一個記號)。而 codex 兩輪都指著同一件事:
#    🛑 **那個接縫是「讓本閘印綠而一支真候選都沒掃」的鑰匙** —— 我補了 nonce, 它再指出
#      nonce 也只是把門檻抬高:**清單是外面給的, nonce 也是外面給的**, 兩個都給就過。
#    ⇒ 📌 **那條路補不完 —— 因為檢查與被檢查的東西住在同一支任何人都讀得到的檔裡。**
#    ⇒ ✅ 所以**把接縫刪掉**:證人格直接在**同一個行程**裡呼叫這支函式餵假清單,
#      正式路徑則餵真清單。**正式路徑上沒有東西可以被設。**
# 🔵 **而這讓證人變強了, 不是變弱**:壬族現在跑的**就是正式路徑那份碼**(同一支函式),
#    以前是「另起一個行程、走一條只有測試才走的分支」。
#
# 用法:`run_scan "<候選清單, 換行分隔>"` ⇒ return 0 / 1 / 2(規則見函式尾)。
run_scan() {
  local CANDLIST="$1"
n=0; bad=0; newbad=0; slow=0; early=0
echo "══ 掃描(受害者 repo 行為尺)══"
# 🔴 **逐行讀, 不要 `for f in $CAND`**(codex must-fix ②):後者依 IFS 斷詞
#    ⇒ 含空白的檔名會被拆成兩段 ⇒ 兩段都不是候選 ⇒ 📌 **那一支【沒有被跑】而總數照樣是綠的。**
#    ⚠️ 今天 repo 內沒有含空白的腳本名 —— 而「今天沒有」不是守門。
while IFS= read -r f; do
  [ -n "$f" ] || continue
  n=$((n+1)); read -r st rc <<EOF2
$(probe "$f" yes)
EOF2
  case "$st" in
    # 🔵 **`CLEAN` 而【候選自己的 rc 非 0】⇒ 照印、單獨計數, 不改離場碼**(codex R1 must-fix ③)。
    #    📌 **本閘只管【隔離】** —— 候選自己的 selftest 紅不紅是**別的閘**的職責
    #      (它自己 `package.json` 那條 `--selftest` entry)。⇒ 這裡不擋, 是刻意的。
    #    🛑 **而【靜靜吞掉】是不對的**:一支「沒動受害者、而自己早就死了」的候選,
    #      它的隔離其實**沒有被驗過** —— 它只是還沒走到會動 git 的那一段就死了。
    #      ⇒ ⚠️ 射程寫在這裡:**本閘對它印的那個「乾淨」, 分母是【它跑到的地方】, 不是整支檔。**
    CLEAN)
      if [ "${rc:-0}" != 0 ]; then
        early=$((early+1))
        echo "  🔵 沒動受害者, 而它自己 rc=$rc(可能沒走到會動 git 那一段)⇒ 本閘不擋, 而它【未被驗過】  $f"
      fi ;;
    TIMEOUT) slow=$((slow+1)); echo "  ⏱  量不到(逾時 ${LIMIT}s, **不等於乾淨**)  $f" ;;
    DIRTY)
      bad=$((bad+1))
      if printf '%s' "$KNOWN" | grep -qxF "$f"; then
        echo "  🟡 已知違規(在債表上, 本閘不擋)  rc=$rc  $f"
      else
        newbad=$((newbad+1)); echo "  🔴 **新的違規者**(不在債表上)  rc=$rc  $f"
      fi ;;
    # 🔴🔴 **`*)` 不是禮貌, 它是這一格的守門**(codex R2 must-fix ⑤b):
    #    `probe` 自己壞掉時回的狀態不是那三種, 而**沒有 default 的 `case` 會【安靜地什麼都不做】**
    #    ⇒ 📌 **一把壞掉的量具, 在這個迴圈裡與「這一支乾淨」走同一條路。**
    #    ⇒ ✅ 未知狀態一律當**量具失效**算進 `slow`(而 `--only` 那半 `slow>0` 就 exit 2)。
    *)
      slow=$((slow+1))
      echo "  🔴 量具回了我看不懂的狀態(st='$st' rc=$rc)⇒ 當【量不到】算, 不當乾淨  $f" ;;
  esac
done <<EOF3
$CANDLIST
EOF3
echo "── 分母 $n 支 · 違規 $bad(其中新的 $newbad)· 量不到 $slow · 自己先死掉 $early(不擋, 而它們未被驗過)"
# ══ 收尾 · 離場碼的規則(主視窗 `-f8` 2026-09-06 裁;兩半【對稱】)═══════════
#
#   `exit 0` = 零【新】違規、零量不到
#   `exit 1` = **有新違規**(⚠️ **可能【同時】也有量不到 —— 看輸出那兩行**)
#   `exit 2` = **零【新】違規, 而有量不到**
#
# ⚠️ **「新」這個字是量出來的差別, 不是修辭**(codex R1 nit):判準是 `newbad`, 不是 `bad` ——
#    **在債表 `KNOWN` 上的違規者不擋**(它今天是空的, 而它不會永遠是空的)
#    ⇒ 📌 `KNOWN` 非空的那一天, 「有違規而 exit 0」是**設計**, 不是漏。分母印在上面那一行。
#
# 🔴🔴 **⛔ ~~「`--only` 那半量不到就 exit 2、全量那半不算」~~ —— 那個不對稱【取消了】。**
#    舊字面留在下面加刪除線, 讓照著它以為「全量逾時會回 0」的人同一發撞到這裡:
#    ⛔ ~~· 全量是 `pre-push` 第 5 支, 已經有既有語意:`TIMEOUT` 只計數、最後仍 `exit 0`。~~
#    ⛔ ~~· `--only` 是新的路, 沒有既有語意 ⇒ 從第一天就把它定成「量不到 = 不算過」。~~
#    ⇒ 🛑 **那個理由是【向後相容】, 不是【安全】** —— 而它保住的那個相容, 內容剛好是
#      「一支腳本逾時, 與它乾淨, 在畫面上都是沒有 🔴」。**兩半都不該接受那個同形。**
#
# 🔴 **而【違規優先】這個順序是刻意留的, 不是那句假話的殘骸**:
#    兩者都是非 0 ⇒ **擋的效果一模一樣**, 差別只在【診斷】; 而「有違規」比「量不到」具體。
#    ⇒ 📌 所以規則要答得出「同時發生時看到什麼」:**看到 1, 而量不到的支數印在上面那一行。**
#    ⛔ ~~「只要量不到就 exit 2」~~ ⇒ **那句話本來就不成立**(違規優先會遮掉它), 已刪。
#
# ⚠️ **三態會在哪裡塌掉 —— 而那【只有一半】**(codex R2 nit 訂正;⛔ ~~舊字面說「lint-staged / husky
#    底下都會壓成 1」~~ 是錯的):
#    · 🔴 **`lint-staged`(`--only` 那條路)會把 2 壓成 1** ⇒ 那一半的三態確實塌成「非 0」。
#    · 🟢 **`pre-push`(全量那條路)【不會】** —— `.husky/pre-push:101` 逐字是 `... || exit $?`
#      ⇒ **2 原樣傳出去**。(`.husky/pre-push` 檔頭本來就寫著「壓成 1 會讓三態消失」而它避開了。)
#    ⇒ 📌 塌掉的那一半**不影響安全**(照樣擋), 影響的是**診斷**:看到 1 的人要回來讀這一段。
if [ "$newbad" != 0 ]; then
  if [ "$slow" != 0 ]; then
    echo "⚠️ 本次【同時】有 $newbad 支新違規與 $slow 支量不到 ⇒ 離場碼是 1(違規優先)。" >&2
    echo "   🛑 那 $slow 支【沒有被驗過】—— 修完違規之後要回來看它們, 不要當它們過了。" >&2
  fi
  return 1
fi

if [ "$slow" != 0 ]; then
  if [ "$ONLY_MODE" = 1 ]; then _mode='--only'; else _mode='全量'; fi
  echo "🔴 $_mode:零【新】違規, 而有 $slow 支【量不到】(逾時 ${LIMIT}s)⇒ exit 2" >&2
  echo "   🛑 「量不到」不等於「乾淨」—— 而它在畫面上與乾淨長得一樣, 所以這裡讓它出聲。" >&2
  echo "   🔵 是哪幾支:上面每一支都印過一行「⏱ 量不到」。" >&2
  echo "   ⚠️ 若那一支【本來就慢】而不是壞掉:調 SGI_TIMEOUT 或把它拆小, **不要把這道閘關掉**。" >&2
  return 2
fi
return 0
}

if [ "${1:-}" = "--selftest" ]; then
  echo "══ selftest-git-isolation-gate 自己的證人 ══"
  p=0; f=0; SKIPPED=0
  ck() { if [ "$2" = "$3" ]; then echo "  PASS $1 ($2)"; p=$((p+1)); else echo "  🔴 FAIL $1 —— 得 $2 期望 $3"; f=$((f+1)); fi; }
  controls; echo "  PASS 甲 正負對照皆過"; p=$((p+1))
  # 乙:一支【故意不隔離】的樁 ⇒ 帶 GIT_DIR 必 DIRTY、不帶必 CLEAN(兩方向)
  # 🔴🔴 **這支樁是自己造的, 不是拿 repo 裡某一支真腳本當範例。**
  #    2026-08-25 踩到:原本乙格指名 `scripts/where-is.sh`(當時的已知違規者),
  #    而**我把它修好的那一刻, 乙1 就假紅了** —— 紅的原因不是本閘壞了, 是**靶被修好了**。
  #    📌 一個「已知會壞」的例子, 只要它是**活的檔**, 就有人會去修它。
  #      ⇒ 對照組要**自己造**, 它的壞是我寫死的, 沒有人會來修。
  LEAK="$TMPROOT/leaky-stub.sh"
  cat > "$LEAK" <<'STUB'
#!/bin/sh
t=$(mktemp -d) || exit 1
cd "$t" || exit 1
git init -q . >/dev/null 2>&1
printf 'x\n' > leak.txt
git add leak.txt >/dev/null 2>&1
git -c commit.gpgsign=false commit -qm leak >/dev/null 2>&1
exit 0
STUB
  chmod +x "$LEAK"
  ck "乙1 故意不隔離的樁 帶 GIT_DIR"   "$(probe "$LEAK" yes | cut -d' ' -f1)" DIRTY
  ck "乙2 故意不隔離的樁 不帶 GIT_DIR" "$(probe "$LEAK" no  | cut -d' ' -f1)" CLEAN
  # ── 己:🔴 **只改 `.git/config` 身分、一個檔都不碰的樁** ─────────────────────
  #    這一格證的不是「本閘會動」(甲/乙已經證了), 是【本閘往哪一側錯】。
  #    在補上 snap 的第四格之前, 己1 印的是 **CLEAN** —— 一個真實發生過的傷害
  #    被這把尺判成乾淨。**修前會演 / 修後不會演**, 這一格就是那個「演」。
  #    ⚠️ 樁自己 `mktemp -d` + `git init` ⇒ **不帶 GIT_DIR 時它寫的是自己的拋棄式 repo**。
  #      🔴 「不會碰到真的 pcm-website-v2」這句**有兩個前提**, 不是無條件成立:
  #         ① `git init` 成功(已補 `|| exit 1`) ② `$TMPDIR` 不在本 repo 底下。
  #         ⇒ 照 code-reviewer R1:**話不要寫得比碼保證的強。**帶 GIT_DIR 時 `git config` 才落到受害者身上,
  #      而那正是事故當天的形狀。
  #    🔴 樁寫的身分【必須與 `mkvictim` 寫的不同】。第一版我照事故原文寫 `victim`,
  #      而 `mkvictim` 的 `user.name` 本來就是 `victim` ⇒ 那一格會靠 `user.email` 僥倖紅。
  #      📌 一個「改成同一個值」的覆寫在任何 diff 尺上都是 CLEAN, 而它仍然是一次劫持。
  IDSTUB="$TMPROOT/identity-stub.sh"
  cat > "$IDSTUB" <<'STUB2'
#!/bin/sh
t=$(mktemp -d) || exit 1
cd "$t" || exit 1
git init -q . >/dev/null 2>&1 || exit 1
git config user.name hijacked-by-fixture >/dev/null 2>&1
git config user.email hijack@fixture.invalid >/dev/null 2>&1
exit 0
STUB2
  chmod +x "$IDSTUB"
  ck "己1 只改 config 的樁 帶 GIT_DIR"   "$(probe "$IDSTUB" yes | cut -d' ' -f1)" DIRTY
  ck "己2 只改 config 的樁 不帶 GIT_DIR" "$(probe "$IDSTUB" no  | cut -d' ' -f1)" CLEAN
  # ── 庚:🔴 **只動【非 HEAD 的 ref】、不碰檔案也不碰 config 的樁** ──────────────
  #    來歷 = `.husky/pre-push:46` 記的第二起真事故:「建 4 顆 commit 並把 **dev** 指過去」。
  #    `git branch` / `git tag` 不動 `HEAD`、不動 `git ls-files`、不動 `.git/config`
  #    ⇒ 在補上第五格之前, 前四格對它印 **CLEAN**。這一格就是那個「演」。
  #    ⚠️ **庚2 的機制與它的兄弟格不同族, 講清楚免得被讀成同一件事**(R2 實測):
  #      乙2 / 己2 的樁在不帶 GIT_DIR 時是**寫進自己的拋棄式 repo**;而庚樁那個 repo 是**空的**,
  #      `git branch` / `git tag` 在零 commit 的 repo 上 rc=128、**哪裡都沒落地**(事後 `for-each-ref` 0 行)。
  #      ⇒ 庚2 擋得住「尺自己有噪音」, 擋不住它字面看起來擋的那件事。
  #      🔴 而若日後有人「修好」這支樁(先補一顆 commit 讓 branch 成功), **這一格的性質會靜靜改變** ——
  #        它會從「什麼都沒發生」變成「有發生但落在別處」, 而**兩者都印 CLEAN**。
  REFSTUB="$TMPROOT/refs-stub.sh"
  cat > "$REFSTUB" <<'STUB3'
#!/bin/sh
t=$(mktemp -d) || exit 1
cd "$t" || exit 1
git init -q . >/dev/null 2>&1 || exit 1
git branch hijacked-line3 >/dev/null 2>&1
git tag hijacked-line3-tag >/dev/null 2>&1
exit 0
STUB3
  chmod +x "$REFSTUB"
  ck "庚1 只動非 HEAD ref 的樁 帶 GIT_DIR"   "$(probe "$REFSTUB" yes | cut -d' ' -f1)" DIRTY
  ck "庚2 只動非 HEAD ref 的樁 不帶 GIT_DIR" "$(probe "$REFSTUB" no  | cut -d' ' -f1)" CLEAN
  # 丙:一支【真的、已知修好的】腳本 ⇒ 兩個方向都必須 CLEAN。
  #    ⚠️ **這一格刻意留了一個真檔**(乙格改成自建樁之後, 這裡是唯一的真實世界樣本)——
  #      它證明的是「這把尺在**別人寫的真碼**上也分得出修好與壞的」, 樁證明不了這件事。
  #    🔴 **代價要講清楚**:若有人把 `board-state-consistency.py` 的隔離弄壞,
  #      紅的會是**本閘**, 而病人是那支檔 ⇒ 看到丙紅時, 先去看那支檔, 不要先查本閘。
  ck "丙1 board-state 帶 GIT_DIR"   "$(probe scripts/board-state-consistency.py yes | cut -d' ' -f1)" CLEAN
  ck "丙2 board-state 不帶 GIT_DIR" "$(probe scripts/board-state-consistency.py no  | cut -d' ' -f1)" CLEAN
  # ── 丁:🔴 **這一格就是收包的人撞到的那一發。** ─────────────────────────────
  #    帶著 pre-commit 真的會設的那兩個變數跑【本閘自己】, 要求兩件事同時成立:
  #      丁1 誘餌 repo 一個檔都不許變(它不得寫到繼承來的倉庫上)
  #      丁2 內層要**真的跑完**(rc=0)—— 只驗丁1 的話, 「它壞掉提早死掉」也會讓誘餌不變
  #    📌 少了丁2, 「安全」與「死了」印同一個結果。
  #    ⚠️ 只設 GIT_DIR + GIT_INDEX_FILE, **不設 GIT_WORK_TREE** —— pre-commit 就是這樣。
  if [ "${SGI_SKIP_ISOLATION_CELL:-}" != "1" ]; then
    DEC="$TMPROOT/decoy"
    rm -rf "$DEC"; mkdir -p "$DEC" || die "mkdir decoy"
    ( cd "$DEC" && git init -q . && git config user.email d@d.t && git config user.name d ) || die "git init decoy"
    for i in 1 2 3 4 5 6 7; do printf 'y%s\n' "$i" > "$DEC/g$i.txt"; done
    ( cd "$DEC" && git add g1.txt g2.txt g3.txt g4.txt g5.txt g6.txt g7.txt && git commit -qm base ) >/dev/null || die "commit decoy"
    # 🔴 `config` 這一格與 `snap()` 同時補上 —— 否則會是同一個盲區的上一層版本:
    #    本閘自己若劫持了誘餌的身分, 丁1 一樣印綠。**修一層盲區時, 先問它有沒有第二層。**
    dcount() { printf '%s %s %s %s' "$(cd "$DEC" && git ls-files | wc -l | tr -d ' ')" "$(cd "$DEC" && git rev-parse HEAD)" "$(cd "$DEC" && git config --local --list | sort | cksum | tr ' ' '_')" "$(cd "$DEC" && git for-each-ref | cksum | tr ' ' '_')"; }
    d_before=$(dcount)
    ( cd "$ROOT" && SGI_SKIP_ISOLATION_CELL=1 \
        GIT_DIR="$DEC/.git" GIT_INDEX_FILE="$DEC/.git/index" \
        bash "$ROOT/scripts/selftest-git-isolation-gate.sh" --selftest ) > "$TMPROOT/inner.txt" 2>&1
    d_rc=$?
    d_after=$(dcount)
    ck "丁1 帶 GIT_DIR 跑自己 ⇒ 誘餌 repo 不得變" "$d_after" "$d_before"
    # 🔴 內層是**巢狀模式** ⇒ 它照設計回 2(丁/壬 未跑, 見收尾那段)。
    #    ⚠️ **而 2 也可能是「它中途死掉」** ⇒ 兩個數字都要:碼要是 2, **且**要看得到收尾那句話。
    ck "丁2 帶 GIT_DIR 跑自己 ⇒ 內層回巢狀碼"     "$d_rc"    "2"
    grep -q '部分通過(巢狀模式' "$TMPROOT/inner.txt" \
      && ck "丁3 而它要【真的跑到收尾】(不是中途死掉也回 2)" yes yes \
      || ck "丁3 而它要【真的跑到收尾】(不是中途死掉也回 2)" no yes
  else
    SKIPPED=1
    echo "  ⚠️ SGI_SKIP_ISOLATION_CELL=1 ⇒ **跳過 丁 族**(巢狀那一層才該設它)"
  fi
  # ── 戊:從**別的目錄**呼叫本閘, 候選清單不得變成空的 ────────────────────────
  #    🔴 這一格是真 push 實測換來的:`pre-push` 不保證 cwd 是 repo 根。
  #    量的是「列得出候選」而不是「rc=0」—— 因為債表上還有違規者時 rc 也可能非 0,
  #    那兩件事要分開問。
  # ── 辛:🔴 **拿 `--only` 掃【本檔自己】不得死鎖** ────────────────────────
  #    守的是 2026-09-06 那個自我死鎖:`--only` 掃本檔 ⇒ 跑本檔的 `--selftest`(264s)⇒ 超過 60s 上限 ⇒ exit 2。
  #    ⇒ 📌 **那會讓「動這支檔」本身變成 commit 不了。**
  #    ✅ 現在本檔被 `--only` 排除 ⇒ 這一格要**很快**回 0(而不是跑 264 秒再回 2)。
  #    🔬 而「很快」也要量:同一發記秒數, 超過 30 秒就當它沒被排除掉。
  _t0=$(date +%s)
  ( cd "$ROOT" && bash "$ROOT/scripts/selftest-git-isolation-gate.sh" \
      --only scripts/selftest-git-isolation-gate.sh ) >/dev/null 2>&1
  _selfrc=$?
  _dt=$(( $(date +%s) - _t0 ))
  ck "辛1 --only 掃本檔自己 ⇒ 0(排除掉, 不死鎖)" "$_selfrc" "0"
  [ "$_dt" -lt 30 ] && ck "辛2 而且要【很快】回(實測 ${_dt}s < 30s)" yes yes \
                    || ck "辛2 而且要【很快】回(實測 ${_dt}s < 30s)" no yes
  # 🟢 辛3 負對照:換一支【沒有被排除】的候選 ⇒ 它要真的被掃(分母 1 支), 證明排除的是本檔不是全部
  ( cd "$ROOT" && bash "$ROOT/scripts/selftest-git-isolation-gate.sh" \
      --only scripts/free-port.sh ) 2>/dev/null | grep -q '分母 1 支' \
    && ck "辛3 負對照:別的候選仍然被掃到(分母 1 支)" yes yes \
    || ck "辛3 負對照:別的候選仍然被掃到(分母 1 支)" no yes

  # ── 壬:🔴🔴 **離場碼那三態 —— 而【不准拿真候選集當靶】** ────────────────
  #    🎯 守的是兩件事:
  #      ① 主視窗 `-f8` 2026-09-06 裁的「兩半對稱」(全量那半的量不到也要出聲)
  #      ② 那一次自述的事故:⛔ ~~把上限設成 1 秒跑一次真的全量掃~~ ⇒ **81 支候選每一支都被砍在第 1 秒**,
  #        它們的暫存檔留在**別人的工作樹**上(`apps/` · `docs/` · `supabase/migrations/`)。
  #        ⇒ 📌 **那不是省時間, 是【換了一個受測物】** —— 從「一支慢的腳本」換成「全部腳本都被砍」。
  #    ✅ 改成餵一份**自己造的假候選清單**(絕對路徑, 全在 `$TMPROOT` 裡)⇒ 零真候選被跑。
  #    🔵 **而它是【同一個行程裡直接呼叫 run_scan】** —— 不起子程序、沒有環境變數接縫
  #      ⇒ 正式路徑上**沒有東西可以被外面設**(codex R2 must-fix 換來的;理由寫在 run_scan 檔頭)。
  if [ "${SGI_SKIP_ISOLATION_CELL:-}" != "1" ]; then
    # 🔬 **先照一張 ROOT 工作樹的相** —— 壬6 要拿它比。
    #    🔴 **比【全樹】不是比 `scripts/`**:上一次的殘留落在 `apps/` · `docs/` · `supabase/migrations/`,
    #      而我盯著的是我在改的那個目錄 ⇒ **那一次是 codex 順手比工作樹才發現的, 不是我。**
    #    ⚠️ **射程(它答不出的)**:①**untracked 檔的【內容】**不在分母裡(全樹逐檔雜湊太貴)
    #      ②`git config` 那一項**不排序**(重複鍵換順序會改變生效值, 而 `sort` 會把它抹平 —— codex R2)。
    rootsnap() { ( cd "$ROOT" && printf '%s|%s|%s|%s|%s|%s|%s' \
      "$(git status --porcelain --untracked-files=all | sort | cksum)" \
      "$(git rev-parse HEAD)" \
      "$(git diff | cksum)" \
      "$(git diff --cached | cksum)" \
      "$(git for-each-ref | cksum)" \
      "$(git stash list | cksum)" \
      "$(git config --local --list | cksum)" ); }
    _root_before=$(rootsnap)
    WK="$TMPROOT/wit"; rm -rf "$WK"; mkdir -p "$WK" || die "mkdir wit"
    printf '%s\n' '#!/bin/sh' 'exit 0'                                    > "$WK/ok.sh"
    printf '%s\n' '#!/bin/sh' 'sleep 8' 'exit 0'                          > "$WK/slow.sh"
    printf '%s\n' '#!/bin/sh' 'git rm -q --cached f1.txt >/dev/null 2>&1' 'exit 0' > "$WK/dirty.sh"
    printf '%s\n' '#!/bin/sh' 'exit 3'                                    > "$WK/early.sh"
    chmod +x "$WK"/*.sh
    wit() { # $1=假候選清單(換行分隔)  $2=逾時上限
            # ⇒ **rc 用 return 傳回、輸出寫進 $WK/out.txt**(不是印出來)
      # 🔵 整段在 `$( )` 這個子 shell 裡改 LIMIT / ONLY_MODE ⇒ 改不到外面。
      _wo=$( LIMIT="$2"; ONLY_MODE=0; run_scan "$1" 2>&1 ); _wr=$?
      printf '%s' "$_wo" > "$WK/out.txt"
      return $_wr
    }
    # 🟢 壬0 **綠對照(先跑這一格)**:一支乾淨的假候選 ⇒ 0。
    #    📌 少了它, 壬1 的那個 2 可能是「這條路永遠不通過」—— 而那與「逾時被抓到」同形。
    wit "$WK/ok.sh" 240; ck "壬0 綠對照:假清單一支乾淨 ⇒ 0" "$?" "0"
    grep -q '分母 1 支' "$WK/out.txt" && ck "壬0b 而且分母要是 1(證明掃的是假清單)" yes yes \
                                     || ck "壬0b 而且分母要是 1(證明掃的是假清單)" no yes
    # 壬1 零新違規 + 一支量不到 ⇒ 2(**這就是全量那半以前會回 0 的那一格**)
    wit "$WK/slow.sh" 2;  ck "壬1 零新違規而有量不到 ⇒ 2" "$?" "2"
    # 壬2 **同時**有違規與量不到 ⇒ 1(違規優先), 而輸出要把兩件事都講出來
    wit "$(printf '%s\n%s' "$WK/slow.sh" "$WK/dirty.sh")" 2
    ck "壬2 違規與量不到同時 ⇒ 1(違規優先)" "$?" "1"
    grep -q '同時' "$WK/out.txt" && ck "壬2b 而輸出要講出【還有量不到】(不能只說違規)" yes yes \
                                 || ck "壬2b 而輸出要講出【還有量不到】(不能只說違規)" no yes
    # 壬3 CLEAN 而候選自己 rc 非 0 ⇒ **不擋**(0), 而要**印出來**單獨計數
    #    🔴 兩件事分開驗:計數行有沒有算它 / 印的 rc 是不是【它的】(early.sh 寫死 exit 3)
    wit "$WK/early.sh" 240; ck "壬3 沒動受害者而自己 rc=3 ⇒ 不擋(0)" "$?" "0"
    grep -q '自己先死掉 1' "$WK/out.txt" && ck "壬3b 而它要出現在計數行上(不得靜靜吞掉)" yes yes \
                                        || ck "壬3b 而它要出現在計數行上(不得靜靜吞掉)" no yes
    grep -q 'rc=3' "$WK/out.txt" && ck "壬3c 而印的要是【那一支的】rc(early.sh 寫死 3)" yes yes \
                                 || ck "壬3c 而印的要是【那一支的】rc(early.sh 寫死 3)" no yes
    # 🔬 壬6 **收尾也要量**:本族跑完, `$ROOT` 的工作樹不得多出任何東西
    #    (母題:一格證人的副作用落在別人的樹上, 而它印的是自己的 PASS)
    ck "壬6 本族跑完不得在 ROOT 的工作樹留下任何東西" "$(rootsnap)" "$_root_before"
  else
    SKIPPED=1
    echo "  ⚠️ SGI_SKIP_ISOLATION_CELL=1 ⇒ **跳過 壬 族**(離場碼那三態這一發沒有被驗)"
  fi

  wcount=$( cd / && { cd "$ROOT" && { git ls-files -z; git ls-files -z --others --exclude-standard; } \
            | xargs -0 grep -l -- '--selftest' 2>/dev/null | sort -u | grep -cE '^scripts/.*\.(py|sh)$'; } )
  [ "${wcount:-0}" -gt 0 ] && ck "戊 從別的目錄也列得出候選" yes yes \
                          || ck "戊 從別的目錄也列得出候選" no yes
  echo "  ── $p PASS / $f FAIL"
  [ "$f" = 0 ] || exit 1
  # 🔴🔴 **零 FAIL 不等於「全部跑過了」**(codex R1 must-fix)——
  #    `SGI_SKIP_ISOLATION_CELL=1` 從**外面**設進來, 就會整族跳過 丁/壬,
  #    而它照樣印「全部通過」⇒ 📌 **一個被閹掉的自檢, 與一個完整的自檢, 印同一句話。**
  #    ⇒ ✅ 兩道:①跳過時**換一句話講** ②沒跳過時**數格數**(少了格 = 有東西沒跑到)。
  # ⚠️ **`_EXPECT_P` 是寫死的數 —— 加新格子的人要把它一起改大**;
  #    而它擋的正是「加了格子卻沒被跑到」與「格子被靜靜拿掉」。
  _EXPECT_P=25
  # 🔴🔴 **巢狀模式要回【非 0】**(codex R2 must-fix):上一版只把「靜默」修掉 ——
  #    它印了警告, 而**離場碼還是 0** ⇒ 📌 **`lint-staged` / hook 讀的是碼, 不是那句話。**
  #    ⇒ 誰在外面設了 `SGI_SKIP_ISOLATION_CELL=1`, 整族不跑而 CI 照樣綠。
  #    ⇒ ✅ 回 **2**(與「量不到」同一族:**不是紅, 是【沒驗到】**)。
  #    🔵 而**巢狀那一層(丁)本來就期望非 0** —— 丁2 改成比 2, 並且另外驗它有沒有跑到收尾那句話
  #      (📌 少了後半, 「跑到尾而跳過」與「中途死掉」在碼上都是非 0)。
  if [ "$SKIPPED" = 1 ]; then
    echo "⚠️ 部分通過(巢狀模式:丁/壬 族未跑)—— 🛑 **這一發不算完整自檢** ⇒ exit 2"
    exit 2
  fi
  # 🔴 **比【相等】不比【至少】**(codex R2 nit):`-ge` 之下, 「新加一格」剛好可以補上
  #    「舊的一格消失」⇒ 📌 兩個相反的錯互相抵消, 而總數印同一個值。
  if [ "$p" != "$_EXPECT_P" ]; then
    echo "🔴 格數對不上:實得 $p · 預期 $_EXPECT_P" >&2
    echo "   ⇒ 少了 = 有格子沒跑到或被拿掉;多了 = 加了格而沒把 _EXPECT_P 一起改。兩種都不當通過。" >&2
    exit 1
  fi
  echo "全部通過($p 格 = 預期 $_EXPECT_P)。"; exit 0
fi

controls
# 🔴 **整段在 `cd "$ROOT"` 裡面跑**(2026-08-25 真 push 實測抓到):
#    `git -C "$ROOT" ls-files` 吐的是**相對於 ROOT** 的路徑, 而 `grep` 用的是**當下的 cwd**
#    ⇒ 從別的目錄呼叫本閘時, 每一個檔名都開不起來 ⇒ 命中 0 ⇒ 本閘判自己壞掉 exit 2。
#    📌 而在 `pre-commit` 底下 cwd 剛好是 repo 根 ⇒ **它一直是對的, 直到有人從別的地方叫它。**
#    (第一次撞到是拿它掛 `pre-push` 做拋棄式真 push:push 被擋, 而理由與違規者無關。)
CAND=$( cd "$ROOT" && { git ls-files -z; git ls-files -z --others --exclude-standard; } \
        | xargs -0 grep -l -- '--selftest' 2>/dev/null | sort -u | grep -E '^scripts/.*\.(py|sh)$' )
[ -n "$CAND" ] || die "候選清單是空的"

# ── `--only <路徑>…`:只掃這幾支(2026-09-03 加)──────────────────────────────────
#
# 🔵 **它是一個【模式】, 不是新的預設**(全掃仍然掛在 `.husky/pre-push` 的鏈上)。
# ⛔ ~~不帶 `--only` 時本閘的行為「一個字都沒變」~~ ⇒ 🔴 **2026-09-06 起那句話不成立了**
#    (codex R1 must-fix;舊字面留刪除線, 讓引用它的人同一發撞到):
#    **全量那半的「量不到」從 `exit 0` 改成 `exit 2`** —— 規則兩半對稱了(主視窗 `-f8` 裁, 見檔尾)。
#    ⇒ ⚠️ **那會改變 `pre-push` 的行為**:以前一支候選逾時只計數然後放行, 現在會擋。
#      🔵 而它擋的正是「逾時與乾淨印同一個東西」那一格 —— **擋對了**, 而**改的人要知道自己改了它**。
#
# 🎯 **它為什麼存在**:2026-09-03 曾提案把全掃從 pre-push 搬去 pre-commit(只掃 diff)+ CI。
#    🛑 **那個搬家【park 了】**(codex 六條 must-fix;板上 `⟦02-SELFTESTMOVEPARKED⟧`)——
#      而擋下它的兩條值得寫在這裡, 因為下一個人會再想一次同樣的事:
#      ① **pre-commit 攔不到那兩次真事故** —— 它們是【作者手打 `--selftest`】那一刻炸的,
#         那在任何 commit 之前 ⇒ 搬過去只是【早一個 push 週期發現】, 不是「守在事故當下」。
#      ② **CI 只跑 push 到 dev/main, 而 pre-push 跑所有分支** ⇒ 搬完之後 `agent/*` 那幾條線
#         **完全沒有人掃** ⇒ 那個交換是虧的。
#
# ⛔ ~~所以這個模式今天【沒有呼叫端】—— 它是給「只想驗某幾支」的人手動用的。~~
# ⇒ 🔴 **2026-09-06 訂正:它有呼叫端了** —— `package.json` 的 lint-staged 把
#    `scripts/*.{sh,py}` 接到 `--only`(主視窗 `-f8` 派;起因是今晚 load 41-73 那場
#    「11 個窗同時手動跑全量」的事故)。⇒ 全量仍然只在 `pre-push` 第 5 支跑一次。
# 🔵 **舊字面留刪除線**:讓照著那句話以為「改它不影響任何人」的人, 同一發撞到這裡。
#    🔴 而那正是它最容易被誤讀的一格:**它不是「更快的全掃」, 它是一把【更窄】的尺**
#    ⇒ 拿它取代全掃 ⇒ 守備範圍從全部候選縮到本次那幾支, **而畫面上一切正常**。
#
# ⚠️ **它不修、也不弄壞【分母那個洞】**:上面 `:26-30` 記著 `grep -l -- '--selftest'`
#    對**被判 binary 的檔靜默不算** ⇒ 那個洞在兩個模式下都在。
#
# 🔬 **分母帶著量法走**(沒帶範圍的數字不進表):
#    · **81** = 本閘的分母(`scripts/*.py` + `scripts/*.sh` 且含 `--selftest`;2026-09-03 量)
#      ⇒ 而**以本閘跑完自己印的那個「── 分母 N 支」為準**, 不要引用這裡寫死的 81。
#    · ⛔ ~~86~~ 是**另一個集合**(`grep -rl -- '--selftest' scripts .husky`, 不限副檔名)
#      ⇒ 🔴 2026-09-03 的 plan 初稿寫 86 ⇒ **舊字面留著**, 讓引用 86 的人同一發撞到:
#        **兩個數字都對, 而它們數的不是同一個東西。**
ONLY_MODE=0
if [ "${1:-}" = "--only" ]; then
  ONLY_MODE=1
  # 🔴 **commit 路徑上的逾時上限要比 pre-push 短, 而那是量出來的不是猜的**(codex R1 must-fix ⑤):
  #    🔬 2026-09-06 實測:**一支候選跑一次 probe = 8 秒**(建受害者 repo + 跑它的 selftest + 比對)。
  #    ⇒ 一顆 commit staged 10 支 ⇒ 正常約 **80 秒**;而**若照全量那半的 240s 上限**,
  #      最壞是 10 × 240 = **40 分鐘**卡在 pre-commit 上。
  #    ⇒ 🛑 **那會把今晚那場 load 事故從 pre-push 搬到 pre-commit** —— 而本片存在的理由就是避開它。
  #    ⇒ ✅ `--only` 預設 **60s**(仍是實測值的 7.5 倍餘裕), 而全量那半**維持 240s 不動**。
  #    ⚠️ 逾時在本模式是 `exit 2`(見檔尾)⇒ **調短不會把問題藏起來, 它會出聲。**
  LIMIT="${SGI_TIMEOUT:-60}"
  shift
  # 🔴 **沒有給任何路徑 = 呼叫端壞了**(codex R2 must-fix ⑤a):`lint-staged` 只有在**有檔命中**時
  #    才會叫這條命令 ⇒ 走到這裡代表接線出問題, 而它原本會 `exit 0`(= 又一個安靜的通過)。
  if [ "$#" -eq 0 ]; then
    echo "🔴 --only 沒有收到任何路徑 ⇒ 這是呼叫端壞了(lint-staged 有命中才會叫它)" >&2
    echo "   🛑 而它原本會安靜地 exit 0 —— 那與『掃過了都乾淨』印同一個東西。" >&2
    exit 2
  fi
  # 🔴 取交集, 不是直接用參數 —— 餵進來的可能不是候選(例如 .ts / 不含 --selftest)。
  #    而**取交集之後為空是合法的**。
  # 🔴🔴 **先分開兩種「掃不到」** —— 它們今天印同一句話而都 exit 0(2026-09-06 實測):
  #    ① 路徑**存在而不是候選**(`.ts` / 沒有 `--selftest`)⇒ **合法**, 零候選、放行。
  #    ② 路徑**根本不存在** ⇒ 🛑 **那是【呼叫端錯了】**(接線打錯 / 檔被搬走),
  #       而它今天會安靜地變成「零候選 ⇒ 通過」。
  #    ⇒ 📌 **那正是本 repo 記過的那條**:餵一條不存在的路徑, 尺不報錯、少跑一支,
  #      **而畫面與「跑完了都乾淨」一模一樣。**
  #    ⇒ ✅ 分開之後:①放行 ②`exit 2`(量具層, 與「本閘自己壞了」同一態 —— 因為它就是接線壞了)。
  _missing=''
  for _p in "$@"; do
    case "$_p" in /*) _fp="$_p" ;; *) _fp="$ROOT/$_p" ;; esac   # 絕對路徑原樣測, 相對的補 ROOT
    [ -e "$_fp" ] || _missing="$_missing $_p"
  done
  if [ -n "$_missing" ]; then
    echo "🔴 --only 收到【不存在的路徑】:$_missing" >&2
    echo "   ⇒ 這是呼叫端的錯(接線打錯 / 檔被搬走), 不是「沒有候選」。" >&2
    echo "   🛑 而它若被當成零候選放行, 畫面會與【跑完了都乾淨】一模一樣。" >&2
    echo "   ⚠️ 射程:本檢查只問【檔在不在】—— 同一顆 commit 裡被刪掉的檔會落在這裡," >&2
    echo "      而那種情況本來就不該餵進來(lint-staged 只傳存在的 staged 檔)。" >&2
    exit 2
  fi
  # 🔴🔴 **收進來的路徑要先【正規化成 repo 相對】—— 少了這一步整條接線是 no-op**
  #    (2026-09-06 codex must-fix ①, 而我自己測不到:我手打的是相對路徑)。
  #    `lint-staged` 預設把**絕對路徑**接在命令後面, 而 `CAND` 是相對路徑
  #    ⇒ `comm -12` 交集**恆為空** ⇒ 🛑 **印「零候選」然後 exit 0。**
  #    ⇒ 📌 **那不是漏擋一格, 那是【整條接線什麼都沒做】, 而畫面上是一句和善的訊息。**
  #    🔬 實測逐字:餵絕對路徑 ⇒「零候選」rc=0;同一支餵相對路徑 ⇒「分母 1 支」。
  # 🔴🔴 **正規化交給 git 自己那把尺, 不要自己剝前綴**(2026-09-06 codex R2 must-fix ①):
  #    ⛔ ~~`case "$_p" in "$ROOT"/*) _rel=${_p#$ROOT/}`~~ —— 它只吃得下「乾淨的絕對路徑」,
  #    而 `./x` · `../repo/x` · symlink 拼法 · **`ROOT` 本身含 `[` `]` 之類 glob 字元**都會失準
  #    ⇒ 📌 **失準的方向是【落空】⇒「零候選」⇒ exit 0** ⇒ 又是一個安靜的 no-op。
  #    ✅ `git ls-files --full-name` 收任何拼法, 回**repo 相對**的那一份 —— 那是它的工作, 不是我的。
  #    ⚠️ 射程:它只認**被 git 追蹤到的**(staged / 已 commit)。而 lint-staged 傳的一定是 staged 的
  #      ⇒ 這個限制在本用途上不咬人;**手動餵一支 untracked 的檔會落到下面「不存在」那一格**, 那是對的。
  _norm=''
  for _p in "$@"; do
    _rel=$(cd "$ROOT" && git ls-files --full-name -- "$_p" 2>/dev/null | head -1)
    [ -n "$_rel" ] || _rel=$_p
    _norm="$_norm$_rel
"
  done
  # 🔴🔴 **`--only` 一律把【本檔自己】排除掉 —— 否則動這支檔的人 commit 必被擋**
  #    (2026-09-06 codex R1 must-fix ②;而那個死鎖是我上一片 `1495cc167` 接線時造出來的)。
  #    🔬 算式:`package.json` 的 `scripts/*.{sh,py}` 那條 wildcard 會用 `--only` 掃**本檔**
  #      ⇒ 而掃一支候選 = **跑它的 `--selftest`** ⇒ 本檔的 `--selftest` 實測 **264 秒**
  #      ⇒ 而 `--only` 的上限是 **60 秒** ⇒ 🛑 **必逾時 ⇒ exit 2 ⇒ 任何人動這支檔都 commit 不了。**
  #    ⇒ 📌 **它今天還沒咬人, 只是因為 1495cc167 進 dev 之後【還沒有人動過這支檔】。**
  # ✅ **而排除它【不留守備缺口】**, 三條路各自還在:
  #    ① `package.json` 另有一條直接跑本檔 `--selftest` 的 entry(動本檔時它照跑)
  #    ② `pre-push` 第 5 支的**全量**掃仍然涵蓋本檔
  #    ③ 本檔的 `--selftest` 裡就有「帶 `GIT_DIR` 跑自己 ⇒ 誘餌 repo 不得變」那兩格(丁1/丁2)
  #    ⇒ 🎯 **少掉的只有「用 --only 掃自己」這一條, 而那一條【結構上跑不完】。**
  _self_rel='scripts/selftest-git-isolation-gate.sh'
  _only=$(printf '%s' "$_norm" | sed '/^$/d' | grep -vxF "$_self_rel" | sort -u)
  if [ -z "$_only" ]; then
    echo "── --only:給的路徑只有本閘自己 ⇒ 零候選(本檔刻意排除, 理由見上)"
    echo "   🔵 動本檔的守備仍在:package.json 的 --selftest entry · pre-push 全量 · 丁1/丁2 兩格。"
    exit 0
  fi
  CAND=$(printf '%s\n' "$CAND" | sort -u | comm -12 - <(printf '%s\n' "$_only"))
  if [ -z "$CAND" ]; then
    echo "── 給的路徑裡沒有任何帶 --selftest 的腳本 ⇒ 零候選"
    echo "   🛑 而【零候選】不等於【通過】—— 全部候選的守備仍然在 pre-push 的全掃, 不在這裡。"
    exit 0
  fi
  echo "══ 只掃指定的 $(printf '%s\n' "$CAND" | wc -l | tr -d ' ') 支(⚠️ 這【不是】全掃)══"
fi
run_scan "$CAND"
exit $?
