#!/usr/bin/env bash
# spec-1a-recheck.sh — 印出 §1-A 某一項的「量法 / 錨點」,讓「開工前重量一次」變成一條指令。
#
# ══ 存在理由(2026-08-22)═════════════════════════════════════════════════════
# `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1-A 那張表**過期過三次**,
# 而三次的方向**完全相同**:功能做完了而表上還是 ❌ ——【而沒有任何訊號】。
#   2026-08-14 重盤起因:#19 / #15 / #17 皆已可用而表內仍標 ❌
#   2026-08-22 重盤起因:一模一樣。18 個 ❌ 裡 5 個已經不是 ❌
#   2026-08-22 同一夜第三次:#13 的「改品項金額」早就接線了, 而表上寫得像沒有
# 🔴 而最貴的一格是 `#27`:表上寫「連讀取 API 都沒有」而**實際整頁都在, 只差一個環境變數**
#    ⇒ 照那句話估工的人會估「從零寫一頁」, 而真相是「設一個變數」。
#
# ⇒ 那張表的規矩(§1-A-0 規矩②)是「排工之前照那一格的量法自己跑一次」,
#    而**規矩靠人記得** —— 這支把「去讀一張 350+ 行的表、找到那一格、抄出量法」
#    變成 `bash scripts/spec-1a-recheck.sh 27`。
#
# ══ 🔴 天花板(它買到什麼、買不到什麼)══════════════════════════════════════
#    ✅ 買到  「跑了就不會抄漏、不會找錯格」
#    ❌ 買不到 **它不是守門。沒有人跑它, 一樣沒有東西紅。**
#              （形狀與理由同 `scripts/window-standing-actions.sh` 的檔頭)
#    ❌ 買不到 它**不會替你跑那些量法** —— 它只印出來。真的要重量, 你自己貼上去跑。
#    ⚠️ 它讀的是那張表**當下的內容** ⇒ 表本身錯了, 它會忠實地把錯的印出來。
#
# ══ 用法 ═══════════════════════════════════════════════════════════════════
#    bash scripts/spec-1a-recheck.sh 27        # 印第 27 項
#    bash scripts/spec-1a-recheck.sh --list    # 列出全部 33 項的一行摘要
#    bash scripts/spec-1a-recheck.sh --selftest
set -uo pipefail
cd "$(dirname "$0")/.."
SPEC="docs/specs/2026-07-25-admin-backend-rebuild-spec.md"

die() { printf '🔴 %s\n' "$*" >&2; exit 2; }
[ -f "$SPEC" ] || die "找不到 $SPEC —— 這是【工具壞了】,不是那一項不存在。"

# §1-A 的範圍 = 「## 1-A.」到「## 1. 驗收標準」之間
section() { awk '/^## 1-A\./{f=1} /^## 1\. 驗收標準/{f=0} f' "$SPEC"; }

row_of() {  # $1 = 項次;只取【資料列】(以「| N |」開頭),不含表頭
  section | grep -E "^\| $1 \| " || true
}

print_item() {
  local n="$1" rows
  rows="$(row_of "$n")"
  if [ -z "$rows" ]; then
    # 🔴 查無 與 查不了 必須分得開:這裡是【查無】,而檔案存在(上面已驗)
    printf '🔴 §1-A 裡沒有第 %s 項。\n' "$n" >&2
    printf '   （表內現有項次:%s）\n' "$(section | grep -oE '^\| [0-9]+ \|' | grep -oE '[0-9]+' | sort -n -u | tr '\n' ' ')" >&2
    return 3
  fi
  local cnt; cnt="$(printf '%s\n' "$rows" | wc -l | tr -d ' ')"
  printf '═══ §1-A 第 %s 項(在 %s 張表裡出現)═══\n' "$n" "$cnt"
  [ "$cnt" -gt 1 ] && printf '⚠️  它出現在多張表(現況表 / 分類表 / 第一步表)—— 下面【每一段都要讀】。\n\n'
  printf '%s\n' "$rows" | sed 's/<br>/\n    /g'
  printf '\n🔴 開工前:把上面「量法 / 錨點」那幾欄自己跑一次, 輸出貼進你的第一則回報。\n'
  printf '   跑不動、或結果與表上不同 ⇒ 先回報, 不要照舊值開工。\n'
  printf '   （常設動作第 17 條:docs/runbooks/multi-window-command-workflow.md）\n'
  printf '⚠️  這支不是守門 —— 它印出來, 而【跑不跑那些量法是你的事】。\n'
}

selftest() {
  local fail=0
  printf '── selftest ──\n'

  # ① 存在的項次 ⇒ 要有輸出、rc=0
  if print_item 27 >/dev/null 2>&1; then printf '✅ ①存在的項次(27) rc=0\n'; else printf '🔴 ①存在的項次(27) 應該成功而失敗\n'; fail=1; fi

  # ② 🔴 不存在的項次 ⇒ 必須印出可辨識的錯 + 非零 rc, 不可安靜回空
  local out rc
  out="$(print_item 999 2>&1)"; rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q '沒有第 999 項'; then
    printf '✅ ②不存在的項次(999) rc=3 且印出可辨識的錯\n'
  else
    printf '🔴 ②不存在的項次(999) rc=%s、輸出=%s ⇒ 【查無】與【查不了】沒分開\n' "$rc" "${out:0:40}"; fail=1
  fi

  # ③ 🔴 工具自己壞掉（找不到 spec)⇒ 要 rc=2, 與「查無」的 rc=3 分得開
  ( SPEC=/nonexistent/xxx.md; [ -f "$SPEC" ] || exit 2 ) ; rc=$?
  if [ "$rc" -eq 2 ]; then printf '✅ ③工具自己壞掉 rc=2（與查無的 rc=3 分得開）\n'; else printf '🔴 ③工具壞掉的 rc 應為 2, 實得 %s\n' "$rc"; fail=1; fi

  # ④ 正對照:33 項應該全部撈得到
  local miss=""
  for i in $(seq 1 33); do [ -z "$(row_of "$i")" ] && miss="$miss $i"; done
  if [ -z "$miss" ]; then printf '✅ ④正對照:1-33 全部撈得到\n'; else printf '🔴 ④撈不到:%s ⇒ 表的形狀變了, 或本工具的 pattern 過期\n' "$miss"; fail=1; fi

  [ "$fail" -eq 0 ] && printf '\n全部通過。\n' || printf '\n🔴 有格子沒過 —— 不要當它可用。\n'
  return "$fail"
}

case "${1-}" in
  '')          die "用法:bash scripts/spec-1a-recheck.sh <項次 1-33> | --list | --selftest" ;;
  --selftest)  selftest ;;
  --list)      section | grep -E '^\| [0-9]+ \| ' | sed -E 's/^\| ([0-9]+) \| ([^|]*)\|.*/\1\t\2/' | sed 's/<br>.*//' ;;
  *[!0-9]*)    die "項次要是數字,收到「$1」。" ;;
  *)           print_item "$1" ;;
esac
