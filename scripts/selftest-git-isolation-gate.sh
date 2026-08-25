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
#   ② 只設 `GIT_DIR` + `GIT_INDEX_FILE` 兩個, 因為 pre-commit 真的只設這兩個。
#      🔴 **模擬一個環境時, 多設一個變數會讓它變成另一個環境。**
#   ③ 超時 = **量不到**, 不是乾淨。慢的腳本會被標 TIMEOUT 並單獨列出。
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
KNOWN="
scripts/dev-four-greens.sh
scripts/pre-push-attack-surface-sweep.sh
scripts/where-is.sh
"

die() { echo "🔴 $1 ⇒ 本閘自己壞了, exit 2" >&2; exit 2; }

mkvictim() {
  rm -rf "$V"; mkdir -p "$V" || die "mkdir victim"
  ( cd "$V" && git init -q . && git config user.email v@v.t && git config user.name victim ) || die "git init victim"
  for i in 1 2 3 4 5; do printf 'x%s\n' "$i" > "$V/f$i.txt"; done
  ( cd "$V" && git add f1.txt f2.txt f3.txt f4.txt f5.txt && git commit -qm base ) >/dev/null || die "commit victim"
}
snap() {
  printf '%s %s %s' \
    "$(cd "$V" && git ls-files | wc -l | tr -d ' ')" \
    "$(cd "$V" && git rev-parse HEAD 2>/dev/null || echo none)" \
    "$(cd "$V" && git status --porcelain | wc -l | tr -d ' ')"
}
# 跑一支, 印 "狀態 rc";狀態 = CLEAN / DIRTY / TIMEOUT
probe() { # $1=相對路徑  $2=leak(yes/no)
  local f="$1" leak="$2" cmd b a rc pid waited=0
  case "$f" in
    *.py) cmd=(python3 "$ROOT/$f" --selftest) ;;
    *.sh) cmd=(bash    "$ROOT/$f" --selftest) ;;
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
  # 乙:一支已知會洩漏的 ⇒ 帶 GIT_DIR 必 DIRTY、不帶必 CLEAN(兩方向)
  ck "乙1 where-is.sh 帶 GIT_DIR"   "$(probe scripts/where-is.sh yes | cut -d' ' -f1)" DIRTY
  ck "乙2 where-is.sh 不帶 GIT_DIR" "$(probe scripts/where-is.sh no  | cut -d' ' -f1)" CLEAN
  # 丙:一支已知修好的 ⇒ 兩個方向都必須 CLEAN(它分得出「修好」與「壞的」)
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
    dcount() { printf '%s %s' "$(cd "$DEC" && git ls-files | wc -l | tr -d ' ')" "$(cd "$DEC" && git rev-parse HEAD)"; }
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
