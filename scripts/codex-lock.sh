#!/bin/bash
# codex-lock — 起背景審查之前把受審檔鎖成唯讀, 並算一個【證明得了的】雜湊。
#
# 用法:
#   bash scripts/codex-lock.sh a.sql b.ts c.ts            ⇒ 鎖起來, 印 BASELINE=<hash>
#   bash scripts/codex-lock.sh --unlock a.sql b.ts c.ts   ⇒ 解鎖, 印 CURRENT=<hash>
#   bash scripts/codex-lock.sh --selftest
#
# 🔴🔴 **一律餵絕對路徑** —— 本 repo 有多棵 worktree(~/pcm-wt-*), 而相對路徑會對到
#    「你這個 session 的 cwd」那一棵, 不是你以為的那一棵。
#    🛑 而對錯樹時它【不會報錯】:那支檔在別棵樹上也存在 ⇒ 鎖成功、雜湊算得出來,
#      而**你鎖的是別人的檔, 你自己那支照樣改得動。**(線【出貨】-ship 2026-09-05 撞到)
#    ⇒ 📌 一個「鎖對了」與「鎖錯樹」印同一句 🔒 的工具, 對它要防的事零判別力。
#
# ⚠️ **已知限制:分批鎖、一次解鎖 ⇒ 那兩個雜湊不可比。**
#    BASELINE 算的是【你那一次餵進來的檔集】。先鎖 6 支再鎖 3 支 ⇒ 兩個 BASELINE;
#    而一次解鎖 9 支得到的是第三個集合的雜湊 ⇒ **它與任一個 BASELINE 都不相等,
#    而不相等【正是「有人動過」的訊號】** ⇒ 零留痕那一發會給你一個假警報。
#    ✅ 用法:一次鎖完要一起解的那一整組。
#
# exit code: 0=成功  2=用法錯  3=鎖失敗或雜湊是空的(**它自己知道自己沒量到**)
#
# ── 🔴 為什麼有這支:2026-09-05 線【信】`-mail` 手打那段, 兩道防護【同時是假的而都印綠】
#    ① `FILES="a b c"` + `for f in $FILES` ⇒ **zsh 不對未加引號的變數斷詞**
#       ⇒ 整串被當成【一個檔名】⇒ `chmod: <整串>: No such file or directory`
#       🛑 而下一行 `echo "🔒 五支已鎖"` 是**無條件印的** ⇒ 它在成功與失敗印同一句話。
#    ② `BEFORE=$(cat $FILES | shasum)` 同樣失敗 ⇒ **BEFORE 與 AFTER 都是「空字串的 hash」**
#       ⇒ `test "$BEFORE" = "$AFTER"` ⇒ ✅ 相等 ⇒ 印「零留痕」
#       🔴 **⇒ 那道檢查在【什麼都沒量到】時印綠, 而它的綠與真的零留痕長得一模一樣。**
#    🎯 **兩個失敗互相掩護**:鎖沒上 ⇒ 我可能改檔;零留痕印綠 ⇒ 我不會發現我改了。
#    ⇒ 📌 **所以本支的每一行標籤都由【結果】決定, 而空的量測當場紅。**
#
# ⚠️ 射程(先講, 免得它被當成比它大的東西):
#   · `chmod a-w` 擋得住寫入, **擋不住把檔複製一份去改**(那至少是刻意的)
#   · 多窗共用工作樹時**別的窗也會被擋** ⇒ 受審檔若是共用檔, 鎖之前先講一聲
#   · 它**不驗「codex 有沒有在跑」** —— 忘了 --unlock 的話下一步會撞到, 而那是【會叫的失敗】
set -u

usage () { echo "用法: bash scripts/codex-lock.sh [--unlock] <檔…>   |   --selftest" >&2 ; exit 2 ; }

hash_of () {
  # 🔴 `"$@"` 而不是 `$*` —— 這一支存在的理由就是那個斷詞。
  local h
  h=$(cat "$@" 2>/dev/null | shasum -a 256 | awk '{print $1}')
  # 🔴🔴 **空的量測要當場叫** —— 空字串的 shasum 是一個【合法的 hash】,
  #    它會安靜地讓後面的比對式恆真。這一行就是本支存在的核心。
  local empty
  empty=$(printf '' | shasum -a 256 | awk '{print $1}')
  if [ -z "$h" ] || [ "$h" = "$empty" ]; then
    echo "🔴 雜湊是空的(或等於空輸入的雜湊)⇒ cat 沒讀到任何內容 ⇒ 拒繼續" >&2
    return 3
  fi
  printf '%s' "$h"
}

MODE=lock
if [ "${1:-}" = "--selftest" ]; then MODE=selftest; shift
elif [ "${1:-}" = "--unlock" ]; then MODE=unlock; shift
fi
[ "$MODE" = "selftest" ] || [ $# -gt 0 ] || usage

if [ "$MODE" = "selftest" ]; then
  T=$(mktemp -d) || exit 1
  printf 'a\n' > "$T/one.txt" ; printf 'b\n' > "$T/two.txt"
  FAIL=0
  chk () { if [ "$2" = "$3" ]; then echo "  ✅ $1"; else echo "  ❌ $1 (得 $2 / 期 $3)"; FAIL=1; fi ; }

  # ① 兩支檔的 hash 算得出來, 而它不等於空輸入的 hash
  H=$(hash_of "$T/one.txt" "$T/two.txt") ; RC=$?
  chk "①a 兩支檔算得出 hash" "$RC" "0"
  chk "①b 而它不是空的" "$( [ -n "$H" ] && echo yes || echo no )" "yes"

  # ② 🔴 **本支存在的理由**:檔不存在時【必須紅】, 不得回一個合法的 hash
  H2=$(hash_of "$T/nope-does-not-exist" 2>/dev/null) ; RC2=$?
  chk "② 檔不存在 ⇒ rc=3(而不是印一個空輸入的 hash)" "$RC2" "3"

  # ③ 🟢 正對照:只要有一支讀得到就算數(證明 ② 不是「一律紅」)
  H3=$(hash_of "$T/one.txt" 2>/dev/null) ; RC3=$?
  chk "③ 正對照 單一存在的檔 ⇒ rc=0" "$RC3" "0"

  # ④ 鎖了真的不能寫;⑤ 解鎖之後又能寫
  chmod a-w "$T/one.txt"
  if (echo x > "$T/one.txt") 2>/dev/null ; then W=writable ; else W=locked ; fi
  chk "④ 鎖住之後寫不進去" "$W" "locked"
  chmod u+w "$T/one.txt"
  if (echo x > "$T/one.txt") 2>/dev/null ; then W2=writable ; else W2=locked ; fi
  chk "⑤ 解鎖之後寫得進去(證明 ④ 不是檔本來就壞)" "$W2" "writable"

  rm -rf "$T"
  [ "$FAIL" -eq 0 ] && { echo "OK 五格全過"; exit 0; } || { echo "X 有格子紅了"; exit 3; }
fi

# ── lock / unlock ────────────────────────────────────────────────────────
FILES=("$@")
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "🔴 檔不存在: $f ⇒ 拒繼續(不要鎖一半)" >&2 ; exit 3 ; }
done

H=$(hash_of "${FILES[@]}") || exit 3

if [ "$MODE" = "lock" ]; then
  for f in "${FILES[@]}"; do
    # 🔴 每一支各自看 rc —— 一支失敗就整個停, 不要「鎖了三支而印五支」
    chmod a-w "$f" || { echo "🔴 鎖失敗: $f" >&2 ; exit 3 ; }
  done
  # 🔵 數字由陣列長度來, 不是我打的
  echo "🔒 已鎖 ${#FILES[@]} 支"
  echo "BASELINE=$H"
else
  for f in "${FILES[@]}"; do
    chmod u+w "$f" || { echo "🔴 解鎖失敗: $f" >&2 ; exit 3 ; }
  done
  echo "🔓 已解鎖 ${#FILES[@]} 支"
  echo "CURRENT=$H"
  echo "⇒ 拿它與起審查時那行 BASELINE= 比對。**不相等 = 有人在審查期間改了檔** ⇒ 那份 findings 對現在這一版未經證明。"
fi
