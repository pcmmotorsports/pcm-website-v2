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

if [ "${1:-}" = "--selftest" ]; then
  echo "══ selftest-git-isolation-gate 自己的證人 ══"
  p=0; f=0
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
        bash "$ROOT/scripts/selftest-git-isolation-gate.sh" --selftest ) >/dev/null 2>&1
    d_rc=$?
    d_after=$(dcount)
    ck "丁1 帶 GIT_DIR 跑自己 ⇒ 誘餌 repo 不得變" "$d_after" "$d_before"
    ck "丁2 帶 GIT_DIR 跑自己 ⇒ 內層必須跑完"     "$d_rc"    "0"
  fi
  # ── 戊:從**別的目錄**呼叫本閘, 候選清單不得變成空的 ────────────────────────
  #    🔴 這一格是真 push 實測換來的:`pre-push` 不保證 cwd 是 repo 根。
  #    量的是「列得出候選」而不是「rc=0」—— 因為債表上還有違規者時 rc 也可能非 0,
  #    那兩件事要分開問。
  wcount=$( cd / && { cd "$ROOT" && { git ls-files -z; git ls-files -z --others --exclude-standard; } \
            | xargs -0 grep -l -- '--selftest' 2>/dev/null | sort -u | grep -cE '^scripts/.*\.(py|sh)$'; } )
  [ "${wcount:-0}" -gt 0 ] && ck "戊 從別的目錄也列得出候選" yes yes \
                          || ck "戊 從別的目錄也列得出候選" no yes
  echo "  ── $p PASS / $f FAIL"
  [ "$f" = 0 ] || exit 1
  echo "全部通過。"; exit 0
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
# 🔵 **它是一個【模式】, 不是新的預設** —— 不帶 `--only` 時本閘的行為**一個字都沒變**
#    (全掃, 仍然掛在 `.husky/pre-push` 的鏈上)。
#
# 🎯 **它為什麼存在**:2026-09-03 曾提案把全掃從 pre-push 搬去 pre-commit(只掃 diff)+ CI。
#    🛑 **那個搬家【park 了】**(codex 六條 must-fix;板上 `⟦02-SELFTESTMOVEPARKED⟧`)——
#      而擋下它的兩條值得寫在這裡, 因為下一個人會再想一次同樣的事:
#      ① **pre-commit 攔不到那兩次真事故** —— 它們是【作者手打 `--selftest`】那一刻炸的,
#         那在任何 commit 之前 ⇒ 搬過去只是【早一個 push 週期發現】, 不是「守在事故當下」。
#      ② **CI 只跑 push 到 dev/main, 而 pre-push 跑所有分支** ⇒ 搬完之後 `agent/*` 那幾條線
#         **完全沒有人掃** ⇒ 那個交換是虧的。
#
# ⚠️ **所以這個模式今天【沒有呼叫端】** —— 它是給「只想驗某幾支」的人手動用的。
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
if [ "${1:-}" = "--only" ]; then
  shift
  [ "$#" -gt 0 ] || { echo "── --only 沒有給任何路徑 ⇒ 本次零候選(不是通過, 是沒東西可掃)"; exit 0; }
  # 🔴 取交集, 不是直接用參數 —— 餵進來的可能不是候選(例如 .ts / 不含 --selftest)。
  #    而**取交集之後為空是合法的**。
  _only=$(printf '%s\n' "$@" | sort -u)
  CAND=$(printf '%s\n' "$CAND" | sort -u | comm -12 - <(printf '%s\n' "$_only"))
  if [ -z "$CAND" ]; then
    echo "── 給的路徑裡沒有任何帶 --selftest 的腳本 ⇒ 零候選"
    echo "   🛑 而【零候選】不等於【通過】—— 全部候選的守備仍然在 pre-push 的全掃, 不在這裡。"
    exit 0
  fi
  echo "══ 只掃指定的 $(printf '%s\n' "$CAND" | wc -l | tr -d ' ') 支(⚠️ 這【不是】全掃)══"
fi
n=0; bad=0; newbad=0; slow=0
echo "══ 掃描(受害者 repo 行為尺)══"
for f in $CAND; do
  n=$((n+1)); read -r st rc <<EOF2
$(probe "$f" yes)
EOF2
  case "$st" in
    CLEAN) : ;;
    TIMEOUT) slow=$((slow+1)); echo "  ⏱  量不到(逾時 ${LIMIT}s, **不等於乾淨**)  $f" ;;
    DIRTY)
      bad=$((bad+1))
      if printf '%s' "$KNOWN" | grep -qxF "$f"; then
        echo "  🟡 已知違規(在債表上, 本閘不擋)  rc=$rc  $f"
      else
        newbad=$((newbad+1)); echo "  🔴 **新的違規者**(不在債表上)  rc=$rc  $f"
      fi ;;
  esac
done
echo "── 分母 $n 支 · 違規 $bad(其中新的 $newbad)· 量不到 $slow"
[ "$newbad" = 0 ] || exit 1
exit 0
