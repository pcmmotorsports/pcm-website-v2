#!/bin/bash
# scripts/harvest-merge-line.sh —— 收割:合一條線, 而【合完立刻查同錨重複】
#
# 🎯 **它為什麼存在**(板列 `⟦auth-BOARDMERGEDUP⟧`):
#   板檔在兩夜裡被合成同一個錨佔兩列(34 批 `:2164/2165` · 35 批 `:2178/2179`)。
#   🔬 而因是釘住的:那一列在**對面被搬了位置**、在**我側被改了內容**
#     ⇒ 📌 **行為單位的三方合併把它算成「兩個獨立的加入」⇒ 兩列都留。**
#   🛑 **而 `scripts/board-merge-rows.py` 只跑在【衝突塊】上** ——
#     那一發那一列**根本沒進衝突塊**, git 自動合併掉了, 靜靜留下兩列。
#   ⇒ 🎯 **缺的不是尺**(`board-state-consistency.py` 的 ⑤ 早就會叫)——
#     **缺的是【沒有人在合併之後跑它】。**(`git merge` 不跑 pre-commit, 那是既有 memory 記過的。)
#
# 🔴🔴 **它的前身只活在某個 session 的 scratchpad 裡** ——
#   線 `-auth` 2026-09-06 要收那一列時找遍九棵樹 + `pcm-tools` **零命中**
#   ⇒ 📌 **一個只活在 session 裡的修法, 給不了「下一次不會再發生」那個保證**,
#     而板列若那時就寫 `done`, 下一個人讀到的是「這個病修好了」。
#   ⇒ ✅ 落成本檔。(來源副本:`~/pcm-mailbox/merge-line-scratch-20260906.sh`, 34 行。)
#
# 用法
#   bash scripts/harvest-merge-line.sh <分支>     合它, 印一行結果
#   bash scripts/harvest-merge-line.sh --selftest 自檢(正負對照)
#   🔴 環境變數 `HARVEST_ROOT` **必給**(指哪棵樹)—— ⛔ ~~預設 `/Users/sean_1/pcm-website-v2`~~
#      不給 ⇒ rc=2 + 印用法。理由(一次險過)寫在下面 `ROOT=` 那一段。
#
# 退出碼
#   0 = 合完、零同錨重複        2 = commit 失敗
#   3 = 有沒處理的衝突 ⇒ 已 `merge --abort`
#   4 = 上一次的 merge 還沒收   5 = HEAD 沒動而那條線也沒被合進來
#   6 = 🔴 **合完之後板上出現同一個錨佔兩列以上**
set -u

# ── 🔴 這三件是落檔時修掉的, 不是照抄 ──────────────────────────────────────
#  ① `/tmp/pcm-*.txt` 固定檔名 ⇒ **跨窗共用**(七個窗同時在跑;既有 memory
#     `reference_tmp-fixed-filename-is-shared-across-windows`)⇒ 改 `mktemp`。
#  ② **`dup` 那道閘原本只守【乾淨合併】那一半** —— 衝突那一半只把 `dup=` 印出來、
#     **不改離場碼** ⇒ 📌 那正好是它要守的那個病可以溜過去的一半。⇒ 兩半都 `exit 6`。
#  ③ 原本 `git commit … && D=$(…); echo … || { echo COMMIT FAILED; exit 2; }`
#     ⇒ 🛑 **`||` 綁在 `echo` 上, 而 `echo` 幾乎不會失敗 ⇒ 那個 `exit 2` 是【到不了的碼】**。
#     一顆失敗的 commit 會印 `resolved <hash> dup=` 然後 **exit 0**。⇒ 改成明白的 `if !`。
# 🔴🔴 **`HARVEST_ROOT` 不給就停 —— 而【那個預設值】是這一改的理由**(2026-09-06 `-auth`,
#    主視窗 `-f1` 點頭)。⛔ ~~原本 `ROOT="${HARVEST_ROOT:-/Users/sean_1/pcm-website-v2}"`~~
#    📌 **病史**:施工窗被交代「主樹別碰」, 然後照著交接訊息打 `bash scripts/harvest-merge-line.sh origin/dev`
#      —— 那一行**看起來完全正常**, 而它把一支【會 merge、會 commit】的腳本指到了主樹。
#    🔵 那一發沒有造成改動, **而那是運氣不是設計**:主樹當下的 `origin/dev` 剛好已是祖先 ⇒ 空操作。
#    🛑 **⇒ 一個「省事的預設值」在多窗環境裡, 是一個【安靜地指向別人的樹】的預設值。**
#      而它錯的時候與對的時候**在終端機上印一模一樣的東西**(都是那一行 `clean <hash> dup=0`)。
#    ✅ 改成:不給就 rc=2 + 印用法。**多打一個環境變數, 換掉一整類「我以為我在自己的樹上」。**
#    ⚠️ `--selftest` 不受影響 —— 它在下面自己開拋棄式 fixture, 不讀 `ROOT` 去 merge。
if [ -z "${HARVEST_ROOT:-}" ] && [ "${1:-}" != "--selftest" ]; then
  echo "🔴 HARVEST_ROOT 沒給 —— 本支會在那棵樹上【真的 merge 並 commit】, 所以不猜。" >&2
  echo "   用法:HARVEST_ROOT=<那棵樹的路徑> bash scripts/harvest-merge-line.sh <分支>" >&2
  echo "   例:HARVEST_ROOT=\"\$PWD\" bash scripts/harvest-merge-line.sh origin/dev" >&2
  echo "   ⚠️ 主樹是 /Users/sean_1/pcm-website-v2 —— 夜跑期間多半【不該】是你要的那個。" >&2
  exit 2
fi
ROOT="${HARVEST_ROOT:-/Users/sean_1/pcm-website-v2}"
WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

DUP_PAT='同一個錨佔了兩列以上'

# ══ 🔴🔴 訂正被回捲 —— 而它與「更新內容」在 diff 上是同一個動作 ═══════════
#   板列 `⟦auth-BOARDMERGERETRACT⟧`(2026-09-06;來源 = `mail` 的實例, 主視窗 `-f8` 轉)。
#   🔬 實例:`mail a4d86fb45` 把 `⟦b4-EXPIREDNOCANCELMAIL⟧` **態 open ⇒ parked**,
#     並**收回一段會寄上百封信的修法方向**。而 `board-merge-rows.py` 的規則是
#     「同錨取我側、再把對方獨有段補到列末」⇒ 📌 **dev 舊版那四段會被當成【對方獨有】補回來。**
#   🛑 **那不是多了一段字, 那是把一個人剛做的判斷【還原】了** ——
#     而在 diff 上它與「更新狀態 / 補充內容」**是同一個動作**
#     (同族 memory `feedback_changing-a-status-cell-erases-its-reason`)。
#
# 🎯 **三個觸發**(同錨兩版之間):①**態欄不同** ②**標題欄不同** ③**收回標記【一側有而另一側沒有】**
#
# 🔴 **③ 為什麼不是「任一側含收回字樣就停」** —— 那是量出來的, 不是風格:
#   🔬 板上帶錨的列 **559**, 而含 `⛔ ~~` / 收回 / 作廢的有 **214**(**38%**)——
#     因為 `⛔ ~~舊字面~~` **就是這個 repo 記錄訂正的標準寫法**。
#     數法:`awk -F'|' 'NF>3 && $3 ~ /⟦/' docs/launch-todo.md` 再數那三個字串。
#   ⇒ 🛑 **照字面做, 這道閘會在 38% 的列上叫** ⇒ 而**一道被別人的正常工作弄紅的閘會被關掉**
#     (今晚同一個母題已經咬過兩次:`⟦auth-LOADPROBEHOLES⟧` 與隔離閘的壬6)。
#   ⇒ ✅ **比【兩側的差異】**:收回是**新加的那一側**才有的東西;兩側都有的那些是早就在的舊訂正。
#   ⇒ 🎯 **這道閘叫的時候, 要是【真的有人剛收回了什麼】。**
#   ⚠️ **它答不出的**:兩側**各自**新增了不同的收回 ⇒ 它會叫(對), 而**分不出誰的比較新** —— 那本來就該人看。
RETRACT_PAT='⛔ ~~\|收回\|作廢'

# 從一列板列取某一欄(1=態 2=錨 3=標題 4=誰 5=內容)
_cell() { printf '%s' "$1" | awk -F'|' -v n="$2" '{print $(n+1)}' | sed 's/^ *//;s/ *$//'; }
_retract_n() { printf '%s' "$1" | grep -o "$RETRACT_PAT" | grep -c . ; }

# $1 = 帶衝突標記的板檔  ⇒ 0 沒事 / 7 有訂正可能被回捲(印出兩版)
retract_check() {
  local f="$1" side ours theirs anchor line n_o n_t hit=0
  ours=$(awk '/^<<<<<<</{s=1;next} /^=======$/{s=2;next} /^>>>>>>>/{s=0;next} s==1' "$f")
  theirs=$(awk '/^<<<<<<</{s=1;next} /^=======$/{s=2;next} /^>>>>>>>/{s=0;next} s==2' "$f")
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    anchor=$(printf '%s' "$line" | grep -o '⟦[^⟧]*⟧' | head -1)
    [ -n "$anchor" ] || continue
    side=$(printf '%s\n' "$theirs" | grep -F "$anchor" | head -1)
    [ -n "$side" ] || continue
    if [ "$(_cell "$line" 1)" != "$(_cell "$side" 1)" ]; then
      echo "  🛑 $anchor 的【態欄】兩側不同:我側「$(_cell "$line" 1)」· 對面「$(_cell "$side" 1)」"; hit=1
    elif [ "$(_cell "$line" 3)" != "$(_cell "$side" 3)" ]; then
      echo "  🛑 $anchor 的【標題欄】兩側不同 ⇒ 有人改寫了它在講什麼"; hit=1
    else
      n_o=$(_retract_n "$line"); n_t=$(_retract_n "$side")
      if [ "$n_o" != "$n_t" ]; then
        echo "  🛑 $anchor 的【收回標記】兩側不同:我側 $n_o 個 · 對面 $n_t 個 ⇒ 有人剛收回了什麼"; hit=1
      fi
    fi
    if [ "$hit" = 1 ]; then
      echo "  ── 我側 ──"; printf '%s\n' "$line" | cut -c1-300
      echo "  ── 對面 ──"; printf '%s\n' "$side" | cut -c1-300
      echo "  ⇒ 📌 **不自動合** —— 這兩版不是「同一件事的兩份草稿」, 是【有人改了判斷】。人選一個。"
      return 7
    fi
  done <<EOFR
$ours
EOFR
  return 0
}

# 從「板檢查的輸出文字」數出重複幾個。
# 🔴 **回傳的是【真正的個數】不是 0/1** —— 原本用 `grep -c`, 而那支工具把個數印在**同一行**
#    ⇒ 📌 `grep -c` 永遠只會是 0 或 1, 而 `dup=1` 在五個錨重複時也印 1。
dup_from_text() {
  # 🔴 **預設值要在 shell 裡補, 不能靠 `sed 's/^$/0/'`** —— 這是自檢當場抓到的:
  #    `sed -n …p` 沒命中時**吐的是【零行】而不是【一行空的】** ⇒ 後面那個 `s/^$/0/` **沒有輸入可以替**
  #    ⇒ 📌 整條管線回空字串, 而呼叫端拿它去比 `!= 0` 會得到「不等於 0」⇒ **恆紅**。
  #    ⇒ 🛑 「沒有輸出」與「輸出是空的」是兩件事, 而只有第二種替得掉。
  local n
  n=$(printf '%s' "$1" | sed -n "s/.*${DUP_PAT}的有 \([0-9]\{1,\}\) 個.*/\1/p" | head -1)
  [ -n "$n" ] || n=0
  printf '%s' "$n"
}

dup_now() {
  local out n
  out=$(cd "$ROOT" && python3 scripts/board-state-consistency.py 2>&1)
  n=$(dup_from_text "$out")
  [ -n "$n" ] || n=0
  printf '%s' "$n"
}

# ── 自檢 ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  p=0; f=0
  ck() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; p=$((p+1)); else echo "  🔴 $1 —— 得 $2 期望 $3"; f=$((f+1)); fi; }
  echo "══ harvest-merge-line 自檢 ══"
  # 🔴 **本自檢驗的是【判讀與離場】那一段, 不是那支板檢查本身**
  #    (`board-state-consistency.py` 的板路徑寫死在它裡面 `:169`, 餵不進假板;它自己有 `--selftest`)。
  #    ⇒ 📌 而**兩個真實的 bug 都住在判讀這一段** —— 射程寫在這裡, 不假裝驗了別的。
  ck "①乾淨的輸出 ⇒ 0" "$(dup_from_text '  ✅ ⑤ 542 個帶錨的列, 錨各自唯一 —— 而另外 194 列錨欄無錨')" "0"
  ck "②一個重複 ⇒ 1"   "$(dup_from_text '  🔴 ⑤ 同一個錨佔了兩列以上的有 1 個')" "1"
  # 🔴 這一格是 `grep -c` 那個寫法【答不出來】的:五個重複它也只會回 1。
  ck "③五個重複 ⇒ 5(不是 1)" "$(dup_from_text '  🔴 ⑤ 同一個錨佔了兩列以上的有 5 個')" "5"
  ck "④完全沒有那一行 ⇒ 0"     "$(dup_from_text '什麼都沒有')" "0"
  # 🔴 commit 失敗那條路要【到得了】—— 這一格演的就是原本到不了的那個碼。
  _commit_exit() { if ! "$@"; then echo 2; return; fi; echo 0; }
  ck "⑤commit 失敗 ⇒ 走得到 2" "$(_commit_exit false)" "2"
  ck "⑥commit 成功 ⇒ 0(反向對照)" "$(_commit_exit true)" "0"

  # ── 訂正回捲那三個觸發 + 兩格反向對照(板列 ⟦auth-BOARDMERGERETRACT⟧)──────
  _rc_dir=$(mktemp -d)
  _mk_conf() {  # $1=我側那列  $2=對面那列  ⇒ 印出檔名
    printf '<<<<<<< HEAD\n%s\n=======\n%s\n>>>>>>> other\n' "$1" "$2" > "$_rc_dir/b.md"
    printf '%s' "$_rc_dir/b.md"
  }
  _R() { retract_check "$1" >/dev/null 2>&1; echo $?; }
  _base='| open | ⟦zz-T1⟧ | 標題 | 誰 | 內容 |'
  ck "⑦態欄不同(open vs parked)⇒ 7" \
     "$(_R "$(_mk_conf "$_base" '| parked | ⟦zz-T1⟧ | 標題 | 誰 | 內容 |')")" "7"
  ck "⑧標題欄不同 ⇒ 7" \
     "$(_R "$(_mk_conf "$_base" '| open | ⟦zz-T1⟧ | 標題【改寫過】 | 誰 | 內容 |')")" "7"
  # 🔴 ⑨ = mail 那個實例的形狀:態與標題【都一樣】, 而一側多了收回
  ck "⑨收回標記一側有一側沒有 ⇒ 7(mail 實例的形狀)" \
     "$(_R "$(_mk_conf "$_base" '| open | ⟦zz-T1⟧ | 標題 | 誰 | 內容 ⛔ ~~那段修法收回~~ |')")" "7"
  # 🟢 ⑩ 反向對照:兩側【同一組舊訂正】⇒ 不得叫
  #    📌 這一格就是「那 38% 不會被誤報」的證明 —— 少了它, 上面三格的 7 可能只是它恆叫。
  _old='| open | ⟦zz-T1⟧ | 標題 | 誰 | 內容 ⛔ ~~早就在的舊訂正~~ |'
  ck "⑩反向對照:兩側同一組舊訂正 ⇒ 0(不叫)" "$(_R "$(_mk_conf "$_old" "$_old")")" "0"
  ck "⑪反向對照:兩側逐字相同 ⇒ 0" "$(_R "$(_mk_conf "$_base" "$_base")")" "0"
  rm -rf "$_rc_dir"

  echo "  ── $p PASS / $f FAIL"
  [ "$f" = 0 ] && { echo "全部通過。"; exit 0; } || { echo "🔴 有格子沒過"; exit 1; }
fi

b="${1:-}"
[ -n "$b" ] || { echo "用法:bash scripts/harvest-merge-line.sh <分支>  或  --selftest" >&2; exit 2; }
cd "$ROOT" || exit 2

# 上一次的 merge 還卡著 ⇒ 不要疊上去
test -f .git/MERGE_HEAD && { echo "$b SKIPPED: merge in progress ($(cut -c1-9 .git/MERGE_HEAD))"; exit 4; }

WORK=$(mktemp -d) || exit 2
CONF="$WORK/conflicts.txt"; BMR="$WORK/board-merge.out"

BEFORE=$(git rev-parse --short HEAD)
git merge -q --no-edit "$b" >/dev/null 2>&1
git diff --name-only --diff-filter=U > "$CONF"

# ── A. 乾淨合併那一半 ─────────────────────────────────────────────────────
if [ ! -s "$CONF" ]; then
  A=$(git rev-parse --short HEAD)
  if [ "$A" = "$BEFORE" ] && ! git merge-base --is-ancestor "$b" HEAD; then
    echo "$b NOT MERGED (HEAD unchanged $A)"; exit 5
  fi
  D=$(dup_now)
  if [ "$D" != 0 ]; then
    echo "$b clean $A BUT BOARD DUP=$D(⑤ 叫了 —— 而它是【自動合併】那一半造成的)"; exit 6
  fi
  echo "$b clean $A dup=0"; exit 0
fi

# ── B. 有衝突那一半 ───────────────────────────────────────────────────────
OK=1
while IFS= read -r file; do
  case "$file" in
    docs/launch-todo.md)
      python3 scripts/board-merge-rows.py --apply > "$BMR" 2>&1; BRC=$?
      grep -E '^ +塊' "$BMR"
      if [ "$BRC" != 0 ]; then echo "STOP board-merge rc=$BRC"; tail -5 "$BMR"; OK=0
      else git add docs/launch-todo.md; fi ;;
    supabase/APPLIED.tsv)
      python3 - <<'PY'
import re
p='supabase/APPLIED.tsv'; s=open(p,encoding='utf-8').read()
s2=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m: m.group(1)+m.group(2), s, flags=re.S)
assert '<<<<<<< ' not in s2; open(p,'w',encoding='utf-8').write(s2); print('applied union')
PY
      git add supabase/APPLIED.tsv ;;
    scripts/board-dispatch-triage.py|docs/plans/2026-09-05-service-role-consumers-inventory.md)
      # ⚠️ **直接取我側** —— 而它對「對面把那一列【訂正】過」是失明的
      #    (同族:板列 ⟦auth-BOARDMERGEDUP⟧ 第二格)。這兩支是具名豁免, 不是通則。
      git checkout --ours -- "$file"; git add "$file"; echo "ours: $file" ;;
    docs/patterns/guard-and-instrument-traps.md|docs/patterns/traps-inbox/*)
      python3 - "$file" <<'PY'
import sys
p=sys.argv[1]; L=open(p,encoding='utf-8').read().split('\n'); out=[]; n=0
for l in L:
    if l.startswith('<<<<<<< ') or l=='=======' or l.startswith('>>>>>>> '): n+=1; continue
    out.append(l)
assert n%3==0 and n>0, n
open(p,'w',encoding='utf-8').write('\n'.join(out)); print('traps union', n//3)
PY
      git add "$file" ;;
    *) echo "STOP other conflict: $file"; OK=0 ;;
  esac
done < "$CONF"

if [ "$OK" != 1 ]; then
  git merge --abort; echo "$b aborted"; exit 3
fi

# 🔴 **明白的 `if !`** —— 原本那個 `|| { … exit 2; }` 綁在 `echo` 上, 到不了。
if ! git commit -q --no-edit >/dev/null 2>&1; then
  echo "$b COMMIT FAILED"; exit 2
fi
A=$(git rev-parse --short HEAD)
D=$(dup_now)
# 🔴 **衝突那一半也要擋** —— 原本這裡只印 `dup=$D` 而不改離場碼。
if [ "$D" != 0 ]; then
  echo "$b resolved $A BUT BOARD DUP=$D ⇒ 停, 不要往下合"; exit 6
fi
echo "$b resolved $A dup=0"
exit 0
