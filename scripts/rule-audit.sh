#!/bin/sh
# rule-audit.sh — 把 docs/ops/rule-ledger.tsv 每一列重驗一次。
#
#   sh scripts/rule-audit.sh              跑全表
#   sh scripts/rule-audit.sh --selftest   負向對照:證明它抓得到「規則不見了」
#
# ── 🔴 它驗什麼、不驗什麼(先讀這段,否則會下錯結論)────────────────────────
#   驗:那段字面【還在那個檔裡】。規則被刪掉、被改寫、檔案被搬走 ⇒ 紅。
#   🔴 **不驗任何人有沒有照做。** 規則還在而全隊都無視 ⇒ 它是綠的。
#   ⇒ 它治的是「規則悄悄消失」,不是「規則沒被執行」。**兩件事,不要混。**
#
# ── 為什麼用固定字串比對而不是可執行命令欄 ──────────────────────────────
#   ledger 若存「驗證命令」就要 eval 它 ⇒ 一張別人也會編輯的表變成可執行檔。
#   實際需要的形狀只有一種:「某段字面在不在某個檔裡」⇒ grep -F 就夠,**不引入 eval**。
#   ⚠️ 代價:表達不了「行首錨定」這種條件(例 `^<<<<<<<`)
#      ⇒ R013 改用 `<<<<<<< HEAD` 這個【真衝突才會出現】的完整字面繞開。
#      **這是已知天花板,不是漏掉。**
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
LEDGER="${RULE_LEDGER:-docs/ops/rule-ledger.tsv}"

audit() {  # $1=ledger 路徑;回傳非 0 表示有紅
  _red=0; _green=0
  # 🔴 跳過註解與表頭;IFS 設 tab —— 規則欄含空白,不能用預設 IFS
  while IFS='	' read -r id rule file pat expect since source; do
    case "$id" in ''|'#'*|id) continue ;; esac
    if [ ! -f "$file" ]; then
      printf '🔴 %s  落點檔不存在: %s\n     %s\n' "$id" "$file" "$rule"
      _red=$((_red+1)); continue
    fi
    _n=$(grep -cF -- "$pat" "$file" || true)
    case "$expect" in
      '==0') if [ "$_n" = "0" ]; then _ok=1; else _ok=0; fi ;;
      *)     if [ "$_n" -ge 1 ]; then _ok=1; else _ok=0; fi ;;
    esac
    if [ "$_ok" = "1" ]; then
      _green=$((_green+1))
    else
      printf '🔴 %s  pattern 命中 %s(期望 %s)  %s\n     規則: %s\n     來源: %s\n' \
        "$id" "$_n" "$expect" "$file" "$rule" "$source"
      _red=$((_red+1))
    fi
  done < "$1"
  printf '\n綠 %s / 紅 %s   (量的是 %s,跑的是 %s)\n' "$_green" "$_red" "$1" "$(command -v grep)"
  # 🔴 這一行【跟數字一起走】—— 數字會被複製到別的地方,而檔頭不會跟著去
  printf '🔴 綠的意思是【那段字面還在那個檔裡】,不是【那條規則有在被遵守】。\n'
  printf '   規則還在而全隊都無視 ⇒ 它照樣是綠的。(G6 2026-08-18 提:守門要自己聲明射程)\n'
  [ "$_red" = "0" ]
}

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  echo "== 世界一:原表 ⇒ 應該全綠、rc=0 =="
  if audit "$LEDGER" > "$T/a.out" 2>&1; then A=0; else A=1; fi
  tail -1 "$T/a.out"; echo "  rc=$A   期望 0"
  echo
  echo "== 世界二:把 R008 的 pattern 換成一個保證不存在的字串 ⇒ 那一列必須紅、rc=1 =="
  sed 's/我自己發明的前置檢查/這段字面保證不存在xyzzy/' "$LEDGER" > "$T/mut.tsv"
  if audit "$T/mut.tsv" > "$T/b.out" 2>&1; then B=0; else B=1; fi
  grep -E '^🔴 R008|^綠 ' "$T/b.out" | head -3
  echo "  rc=$B   期望 1"
  echo
  if [ "$A" = "0" ] && [ "$B" = "1" ]; then
    echo "✅ 兩個世界都對:規則還在 ⇒ 綠;規則不見了 ⇒ 那一列紅且整支 rc=1"
    exit 0
  fi
  echo "🔴 這支稽核自己壞了 —— 它的綠不能當證據"
  exit 1
fi

audit "$LEDGER"
