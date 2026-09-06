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
#   環境變數 `HARVEST_ROOT` 可指定主樹路徑(預設 `/Users/sean_1/pcm-website-v2`)
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
ROOT="${HARVEST_ROOT:-/Users/sean_1/pcm-website-v2}"
WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

DUP_PAT='同一個錨佔了兩列以上'

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
