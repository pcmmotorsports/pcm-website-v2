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
  _red=0; _green=0; _rows=0
  # 🔴 表頭宣告的應有列數 —— 沒有它,一張【被清空的表】會印「綠 0 / 紅 0」然後 rc=0
  #    (GR 2026-08-18 構造:空表 / 掉列 ⇒ 與「全部通過」同輸出)
  _want=$(sed -n 's/^#!rows=\([0-9][0-9]*\).*/\1/p' "$1" | head -1)
  if [ -z "$_want" ]; then
    printf '🔴 表頭沒有 `#!rows=N` ⇒ 無法對帳,本次結果不可信\n'
    return 1
  fi
  # 🔴🔴 **不可以用 `IFS='<tab>' read` 直接讀 TSV**(2026-08-18 G1 構造出來的):
  #    tab 屬於 IFS 空白類 ⇒ **連續 tab 會被併成一個** ⇒ **空欄直接消失、後面每一欄位移**。
  #    症狀:一列 pattern 欄是空的,read 會把 `expect` 讀成 pattern、`since` 讀成 expect
  #    ⇒ 它確實會紅,**但理由是錯的**(訊息印「期望 2026-08-18」)—— 比不紅更難查。
  #    修法:先用 awk 把 tab 換成 \037(unit separator,非空白字元 ⇒ IFS 不會併它)。
  _US=$(printf '\037')
  # 🔴 `$1=$1` 不可省:awk 的 `{print}` **不重建記錄** ⇒ OFS 不會生效(整行原樣輸出)。
  _norm="$1.norm.$$"
  awk -F'\t' 'BEGIN{OFS="\037"} {$1=$1; print}' "$1" > "$_norm"
  # 🔴 用暫存檔不用管線:`... | while` 會讓迴圈跑在子 shell ⇒ 計數器帶不回來。
  # 🔴 `|| [ -n "$id" ]` 不可省:最後一列若沒有結尾換行,while read 會【安靜跳過它】
  while IFS="$_US" read -r id rule file pat expect since source || [ -n "$id" ]; do
    case "$id" in ''|'#'*|id) continue ;; esac
    _rows=$((_rows+1))
    # 🔴 expect 只認這兩個值 —— 它同時是一道【欄位有沒有位移】的哨兵
    case "$expect" in '>=1'|'==0') ;; *)
      printf '🔴 %s  expect 欄是 [%s],不是 >=1 或 ==0 ⇒ 這一列的欄位可能位移了\n' "$id" "$expect"
      _red=$((_red+1)); continue ;;
    esac
    if [ -z "$pat" ]; then
      printf '🔴 %s  pattern 欄是空的 ⇒ 這一列沒有在驗任何東西\n     %s\n' "$id" "$rule"
      _red=$((_red+1)); continue
    fi
    if [ ! -f "$file" ]; then
      printf '🔴 %s  落點檔不存在: %s\n     %s\n' "$id" "$file" "$rule"
      _red=$((_red+1)); continue
    fi
    _n=$(grep -cF -- "$pat" "$file" || true)
    _ok=0
    if [ "$expect" = "==0" ]; then
      if [ "$_n" = "0" ]; then _ok=1; else
        printf '🔴 %s  命中 %s(期望 ==0)  %s\n     %s\n' "$id" "$_n" "$file" "$rule"
      fi
    elif [ "$_n" -ge 1 ]; then
      # 🔴 字面存活 ≠ 語義存活:艦隊慣例是【劃線留痕、不刪字】
      #    ⇒ 命中的行【全部】都在 ~~ 裡 = 訃聞,判紅。只認得 `~~` 這一種形狀(檔頭已明寫)。
      _dead=$(grep -F -- "$pat" "$file" | grep -cF '~~' || true)
      if [ "$_dead" = "$_n" ]; then
        printf '🔴 %s  命中 %s 行而【全部都在 ~~ 劃線裡】⇒ 這條看起來已被廢止\n     %s\n' "$id" "$_n" "$rule"
      else _ok=1; fi
    else
      printf '🔴 %s  命中 0(期望 >=1)  %s\n     規則: %s\n     來源: %s\n' "$id" "$file" "$rule" "$source"
    fi
    [ "$_ok" = "1" ] && _green=$((_green+1)) || _red=$((_red+1))
  done < "$_norm"
  rm -f "$_norm"
  # 🔴 對帳:實際讀到的列數 vs 表頭宣告
  if [ "$_rows" != "$_want" ]; then
    printf '🔴 列數對不上:實際讀到 %s 列,表頭宣告 %s 列 ⇒ 有列掉了或表被動過\n' "$_rows" "$_want"
    _red=$((_red+1))
  fi
  printf '\n列 %s(宣告 %s) / 綠 %s / 紅 %s   (量的是 %s,跑的是 %s)\n' \
    "$_rows" "$_want" "$_green" "$_red" "$1" "$(command -v grep)"
  printf '🔴 綠的意思是【那段字面還在那個檔裡而且不在劃線區】,不是【那條規則有在被遵守】。\n'
  printf '   規則還在而全隊都無視 ⇒ 它照樣是綠的。(G6 2026-08-18 提:守門要自己聲明射程)\n'
  [ "$_red" = "0" ] && [ "$_green" -gt 0 ]
}

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  _w() {  # $1=標題 $2=表 $3=期望rc ;印判定
    if audit "$2" > "$T/o" 2>&1; then _rc=0; else _rc=1; fi
    printf '%s\n  rc=%s  期望 %s%s\n' "$1" "$_rc" "$3" "$([ "$_rc" = "$3" ] && echo '  ✅' || echo '  🔴')"
    grep -E '^🔴 R0|^🔴 表頭|^🔴 列數|^列 ' "$T/o" | head -3 | sed 's/^/    /'
    [ "$_rc" = "$3" ]
  }
  P=0
  _w "== 世界一:原表 ⇒ 全綠、rc=0 ==" "$LEDGER" 0 || P=1
  echo
  sed 's/我自己發明的前置檢查/這段字面保證不存在xyzzy/' "$LEDGER" > "$T/m1.tsv"
  _w "== 世界二:R008 的 pattern 換成不存在的字串 ⇒ 該列紅 ==" "$T/m1.tsv" 1 || P=1
  echo
  grep -v '^R008' "$LEDGER" > "$T/m2.tsv"
  _w "== 世界三(GR finding ①):掉一列 ⇒ 列數對不上必須紅,不可以安靜印綠 ==" "$T/m2.tsv" 1 || P=1
  echo
  printf '#!rows=0\nid\trule\tfile\tpattern\texpect\tsince\tsource\n' > "$T/m3.tsv"
  _w "== 世界四(GR finding ①):整張表清空 ⇒ 不可以印綠 0/紅 0 然後 rc=0 ==" "$T/m3.tsv" 1 || P=1
  echo
  awk -F'\t' 'BEGIN{OFS="\t"} /^R008/{$4=""} {$1=$1; print}' "$LEDGER" > "$T/m4.tsv"
  _w "== 世界五(GR finding ②):pattern 欄空 ⇒ 必須紅(grep -F 空字串會命中每一行)==" "$T/m4.tsv" 1 || P=1
  echo
  sed 's|^\(R008\t[^\t]*\t[^\t]*\t\)我自己發明的前置檢查|\1~~我自己發明的前置檢查~~|' "$LEDGER" > "$T/m5.tsv"
  printf '# 世界六用的落點檔:把那條規則整條劃線,模擬「被廢止但留痕」\n' > /dev/null
  D6="$T/dead.md"; printf '~~## 我自己發明的前置檢查,結構上保護不了它宣稱要保護的那個動作~~\n' > "$D6"
  awk -F'\t' -v f="$D6" 'BEGIN{OFS="\t"} /^R008/{$3=f} {$1=$1; print}' "$LEDGER" > "$T/m6.tsv"
  _w "== 世界六(GR finding ③):字面還在但【整條被劃線】⇒ 判訃聞、必須紅 ==" "$T/m6.tsv" 1 || P=1
  echo
  awk -F'\t' 'BEGIN{OFS="\t"} /^R013/{$4="## "} {$1=$1; print}' "$LEDGER" > "$T/m7.tsv"
  _w "== 世界七(GR nit):==0 方向的負對照 —— 換成一個【確實存在】的字串 ⇒ 必須紅 ==" "$T/m7.tsv" 1 || P=1
  echo
  awk -F'\t' 'BEGIN{OFS="\t"} /^R008/{$5="嗨"} {$1=$1; print}' "$LEDGER" > "$T/m8.tsv"
  _w "== 世界八(G1 自己構造):expect 欄被弄壞 ⇒ 哨兵要抓到欄位位移 ==" "$T/m8.tsv" 1 || P=1
  echo
  if [ "$P" = "0" ]; then
    echo "✅ 八個世界都對:規則在=綠;不見/掉列/空表/空pattern/被劃線/==0被違反/欄位位移 = 紅且 rc=1"
    exit 0
  fi
  echo "🔴 這支稽核自己壞了 —— 它的綠不能當證據"
  exit 1
fi

audit "$LEDGER"
