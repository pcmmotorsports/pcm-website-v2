#!/bin/sh
# greedy-anchor-pattern-gate.sh — 擋「貪吃錨樣式」回流。
#
# 病:錨比對寫成 [ ^ 閉括號 ] 時,字元類【跨得過另一個開括號】⇒ 遇到沒閉合的開括號就一路吞到
#    下一個閉括號。2026-09-07 實測板上三個開口吞 844 / 968 / 45 字元,而其中一個吞掉的正是
#    ⟦b9-UNCLOSEDANCHOR⟧ ——【講這件事的那一列自己撈不到】。正確形是把開括號也排除掉。
# 🔴 為什麼要有這道閘(機制優先律;主視窗 -f1 2026-09-07 裁「開」):
#    修完 5 支之後 merge origin/dev,**同一次 merge 就漂回來 1 處**
#    (別窗抄了同檔隔壁行,而 merge 不跑 pre-commit ⇒ 沒有東西會叫)。
# 🛑 本檔【不得含那個裸字面】(樣式跳脫過、fixture 用變數組)⇒ 不會自咬。selftest 第 ⑤ 格釘住它,
#    而首版就是被它紅出來的 —— fixture 那兩行原本直接寫了裸字面。
#
# 用法:無參數 = 掃 scripts/ 全部 .sh/.py(harvest-chain 用,擋)
#      給檔名 = 只掃那些(lint-staged 用)· --selftest = 自檢
# 退出碼:0 乾淨 · 1 抓到貪吃樣式 · 2 selftest 失敗
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
# ⚠️ **射程**:只抓那個【逐字】字面。變種(字元類裡夾別的字, 例 `[^ 閉括號]`)抓不到 ——
#    那是刻意的:防的是「抄隔壁行」這個已重現過的動作, 不是通用偵測器。
GREEDY='\[\^⟧\]'

# 🔴 迴圈變數與計數器一律加 `_` 前綴 —— 2026-09-07 首版 `for f` 撞到 selftest 的 FAIL 計數器 `f`,
#    而①〜④照樣印 PASS、只有⑤炸開 ⇒ 📌 一支印著 PASS 的自檢, 可以同時是壞的。
scan() {  # $@ = 檔;印命中、有命中回 1
  _hit=0
  for _f in "$@"; do
    [ -f "$_f" ] || continue
    if grep -nE "$GREEDY" "$_f" 2>/dev/null; then _hit=$((_hit + 1)); fi
  done
  [ "$_hit" -eq 0 ]
}

if [ "$1" = "--selftest" ]; then
  d=$(mktemp -d "${TMPDIR:-/tmp}/greedyanchor.XXXXXX") || exit 2
  # 🔴 fixture 用【變數】組出那個字面 —— 直接寫進來的話, 本檔自己就含它 ⇒ 第 ⑤ 格會紅。
  #    (首版就是這樣紅的, 而那一格是【對的】:一道禁某字面的閘, 自己不准含那個字面。)
  _OB='⟦'; _CB='⟧'
  printf '%s\n' "x = re.compile(r'${_OB}([^${_CB}]+)${_CB}')" > "$d/bad.py"
  printf '%s\n' "x = re.compile(r'${_OB}([^${_OB}${_CB}]+)${_CB}')" > "$d/good.py"
  : > "$d/empty.sh"
  _pass=0; _fail=0
  chk() { if [ "$2" = "$3" ]; then _pass=$((_pass+1)); echo "  PASS $1"; else _fail=$((_fail+1)); echo "  FAIL $1(得 $2 期望 $3)"; fi; }
  scan "$d/bad.py"  >/dev/null 2>&1; chk '① 貪吃樣式 ⇒ 紅' "$?" 1
  scan "$d/good.py" >/dev/null 2>&1; chk '② 正確樣式 ⇒ 綠(正對照)' "$?" 0
  scan "$d/empty.sh" >/dev/null 2>&1; chk '③ 空檔 ⇒ 綠' "$?" 0
  scan "$d/good.py" "$d/bad.py" >/dev/null 2>&1; chk '④ 混一支壞的 ⇒ 紅' "$?" 1
  scan "$0" >/dev/null 2>&1; chk '⑤ 本閘自己 ⇒ 綠(它不得自咬)' "$?" 0
  rm -rf "$d"
  echo "  ⇒ PASS $_pass · FAIL $_fail"; [ "$_fail" -eq 0 ] || exit 2; exit 0
fi

# 🔴 逐行讀進 "$@" —— 不要 `set -- $(find …)`:那會對【含空白的檔名】斷詞,
#    而斷詞之後兩半都 `[ -f ]` 不成立 ⇒ 那支檔【安靜地沒被掃】, 而本閘照樣印綠。
#    (現況 scripts/ 沒有含空白的檔, 所以這是【防未來】不是修現行 bug。)
#    ⚠️ 仍答不出檔名含【換行】的那一種 —— 那要 -print0, 而 POSIX sh 讀不了 NUL。
if [ $# -eq 0 ]; then
  set --
  while IFS= read -r _p; do set -- "$@" "$_p"; done <<EOF
$(find scripts -type f \( -name '*.sh' -o -name '*.py' \) 2>/dev/null)
EOF
fi
scan "$@" && exit 0
printf '%s\n' '🔴 貪吃錨樣式 —— 字元類要把【開括號】也排除掉, 否則遇到沒閉合的開口會吞掉鄰居。' >&2
printf '%s\n' '   病史與量測:板列 ⟦b9-UNCLOSEDANCHOR⟧' >&2
exit 1
