#!/usr/bin/env bash
# ============================================================
# shell-backtick-parse-gate.sh — 擋「雙引號字串裡的反引號被當成命令替換」
# ============================================================
# 用法
#   bash scripts/shell-backtick-parse-gate.sh <檔> [檔…]   # lint-staged 這樣餵
#   bash scripts/shell-backtick-parse-gate.sh --selftest    # 兩個方向的證人
#   bash scripts/shell-backtick-parse-gate.sh --all         # 掃 scripts/ 與 .husky/(人工用)
# 退出碼  0=乾淨  1=有 finding  2=本閘自己壞了(量具失效, 一律當紅)
#   ⚠️ **而 husky 那一層看不到 2** —— lint-staged 把子程序的死法吃掉、自己回 1(拋棄式 repo 實測)
#     ⇒ **會擋(這是重點), 而 2 被壓成 1** ⇒ 三態只有【訊息】活得下來, 所以上面每一種都印字。
#
# ── 病本體(2026-09-08 實錘, 不是設想)────────────────────────────────
# `scripts/deploy-order-gate.sh` 的訊息字串是**雙引號**, 裡面一對**沒逃逸的反引號**
# ⇒ bash 當命令替換 ⇒ 每次跑都印 `command substitution: … syntax error`,
#   而那幾個字**被吃掉、句子還讀得通**。
# 🔴 **它躲得掉每一把尺**:`bash -n` **rc=0**(命令替換的內容是【執行期】才 parse);
#   三綠不 parse `.sh`;`rc` 也不會變。
# 🔴🔴 **而它專門長在【出事的時候才會跑到】的那段碼上**(主視窗 A 2026-09-08 的話, 原封收下)——
#   ⇒ 那正是它最不該壞的時候。今天找到的三個實例**全部**住在錯誤路徑或 fail-closed 分支裡:
#     `deploy-order-gate.sh`      只有【擋下來時】才跑到
#     `is-migration-applied.sh`   「取不到全域正對照」的 `else` 分支
#     `op6a-verify.sh`            psql 字串裡的 SQL 註解(每次都跑, 而註解被吃掉沒有人會發現)
#   數法 = `bash scripts/shell-backtick-parse-gate.sh --all`(本檔寫下時 ⇒ 0)
#
# ── 為什麼是 shellcheck, 而且【不是 SC2006】────────────────────────────
# ⛔ ~~SC2006(legacy backticks)~~ —— **量過, 它抓不到這個病**:
#   🟢 正對照 = 修之前那一版 `deploy-order-gate.sh`(已知含未逃逸反引號)⇒ SC2006 命中 **0**
#   ⚪ 負對照 = 修之後那一版 / 一支乾淨的 `.sh`                          ⇒ **0**
#   🛑 **三個世界印同一個 0** ⇒ 那條規則對它零判別力。
#   📌 **差一點就接上一道永遠不叫的閘, 而它看起來一直是綠的。**
# ✅ 真正報它的是**解析錯誤族**:`SC1009 / SC1064 / SC1065 / SC1072 / SC1073`。
# ⛔ **不開 `-S error` 全級**(2026-09-08 量:79 行 / 34 支檔)——
#   第一天一大片紅, 而那片紅會讓人關掉整道閘。**一次只開一條, 而且是我們親手修過的那一條。**
#
# ── 這道閘的收訊者是誰(三題, 寫在這裡不是心裡有數)──────────────────
#   ① 撞到的是誰?          正在 commit `.sh` 的 agent(**不是 Sean —— 他不寫 `.sh`**)
#   ② 他改得動嗎?          改得動, 一個字元:反引號前面加一個反斜線
#   ③ 最省力的合法出口?    **加那個反斜線**(比繞過還快)
#   🔴 ⇒ 所以本閘紅的時候**印出那一行的字面 + 怎麼補**, 不是只印 `rc=1`:
#     **只印 rc 的閘, 最省力的出口會變成 `--no-verify`。**
#
# ⚠️ 天花板(不假裝驗過)
#   · 🔴 **`--all` 的分母與【接線】的分母不是同一個** —— 這一格 code-reviewer 抓到我寫錯射程:
#     `--all` 掃 `scripts/` + `.husky/`;而 `package.json` 的 glob 吃 `docs/**/*.sh`
#     ⇒ **`--all` 印的 0 涵蓋不到那 33 支**(2026-09-08 實查 `docs/**/*.sh` = 33 支, 各 0 命中)。
#   · ⛔ ~~`packages/` 底下的 `.sh` 未掃~~ —— **實查 `packages/` 與 `apps/` 底下各 0 支 `.sh`**
#     ⇒ 那句點名的缺口是空的。**真正的缺口是 `docs/`(接線吃、`--all` 不吃)。**
#   · 🔴 **沒有 `.sh` 副檔名的 husky hook 不在分母裡**(`.husky/pre-commit` / `pre-push` /
#     `commit-msg` / `prepare-commit-msg`)—— `--all` 用 `find … -name '*.sh'`, 接線的 glob 也吃副檔名。
#     🔬 而**今天它們是乾淨的**(2026-09-08 手動跑 `shellcheck -s bash` 對 `pre-commit` / `pre-push`
#     ⇒ 各 **0** 命中)⇒ 這是【已知缺口】不是【已驗安全】, 兩者不同。
#   · 它報的是【bash 解析不過】的那一種。**能成功解析的命令替換**(例 `"`date`"`)照樣是 bug 而本閘不叫
#   · shellcheck 沒裝 ⇒ **fail-closed**(見下), 不靜默跳過
# ============================================================
set -uo pipefail
export LC_ALL=C

RULES='SC1009,SC1064,SC1065,SC1072,SC1073'

if ! command -v shellcheck > /dev/null 2>&1; then
  echo "🔴 shell-backtick-parse-gate:找不到 shellcheck ⇒ fail-closed(這不是「查過而乾淨」)。" >&2
  echo "   裝法:brew install shellcheck" >&2
  echo "   🔴 不要把本閘改成「沒裝就跳過」—— 那會讓【沒裝】與【乾淨】印同一個綠。" >&2
  exit 2
fi

report() { # $1.. = 要掃的檔
  local out rc f l
  out="$(shellcheck -f gcc -i "$RULES" "$@" 2>&1)"; rc=$?
  # 🔴🔴 **量具壞掉不得靜默放行**(code-reviewer 2026-09-08 抓到, 而它正是本檔頭在警告的那一種):
  #   第一版判準只看「有沒有 SC10 命中」而把 `rc` 取了不用
  #   ⇒ 🔬 實測 `chmod 000` 一支【帶病】的檔 ⇒ shellcheck **rc=2 · SC10 命中 0** ⇒ 本閘回 **0**
  #     ⚪ 同一支 `chmod 644` ⇒ rc=1 · 命中 4 ⇒ 回 1
  #   🛑 **「讀不到」與「乾淨」印同一個綠** —— 而檔頭 `:8` 明寫「2=量具失效, 一律當紅」⇒ 字面 vs 事實。
  # 🔬 shellcheck 的三態(2026-09-08 實測):0=乾淨 · 1=有 finding · 2=有檔處理不了
  #   ⇒ 判準 = **非 0 而零命中 ⇒ 量具失效 ⇒ 回 2**, 不回 0。
  if [ "$rc" -ne 0 ] && ! printf '%s\n' "$out" | grep -q '\[SC10'; then
    echo "🔴 shell-backtick-parse-gate:shellcheck rc=$rc 而零命中 ⇒ **量具失效**, 不是「查過而乾淨」。" >&2
    echo "   常見成因:檔讀不到(權限 / 不存在)、shellcheck 自己爆掉。原文:" >&2
    printf '%s\n' "$out" | head -5 | sed 's/^/     /' >&2
    return 2
  fi
  if ! printf '%s\n' "$out" | grep -q '\[SC10'; then return 0; fi
  echo "🔴 shell-backtick-parse-gate:雙引號字串裡有**沒逃逸的反引號** ⇒ bash 會把它當命令替換。" >&2
  echo "   症狀:每次跑都印 command substitution syntax error, 而那幾個字被吃掉、句子還讀得通。" >&2
  echo "   🔴 bash -n 看不到它, 三綠也看不到 —— 只有真的執行到那一行才會出聲。" >&2
  printf '%s\n' "$out" | grep '\[SC10' | while IFS= read -r line; do
    f="${line%%:*}"; l="$(printf '%s' "$line" | cut -d: -f2)"
    echo "   · $f:$l" >&2
    case "$l" in ''|*[!0-9]*) ;; *) printf '     那一行:%s\n' "$(sed -n "${l}p" "$f" 2>/dev/null | cut -c1-140)" >&2 ;; esac
  done
  echo "   ✅ 怎麼補:那一行的每一個反引號前面加一個反斜線(\\\`)。" >&2
  echo "      —— 它比繞過這道閘還快。**不要用 --no-verify 繞過去。**" >&2
  return 1
}

case "${1:-}" in
  --selftest)
    T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
    P=0; F=0
    ok()  { P=$((P+1)); printf '  ok   %s\n' "$1"; }
    bad() { F=$((F+1)); printf '  FAIL %s\n' "$1"; }
    # 🔴 兩個世界的差別**只有那一個反斜線** —— 其餘一個字都不動
    printf '%s\n' '#!/usr/bin/env bash' 'M="訊息 `.rpc()` 後面還有字"' 'printf "%s\n" "$M"' > "$T/red.sh"
    printf '%s\n' '#!/usr/bin/env bash' 'M="訊息 \`.rpc()\` 後面還有字"' 'printf "%s\n" "$M"' > "$T/green.sh"
    report "$T/red.sh"   > /dev/null 2>&1 && bad "①該紅的沒紅(未逃逸反引號)" || ok "①未逃逸 ⇒ 紅"
    report "$T/green.sh" > /dev/null 2>&1 && ok  "②已逃逸 ⇒ 綠(證明①不是無條件紅)" || bad "②該綠的紅了"
    # ③ 兩個世界的差異必須真的只有那一個字元 —— 免得我其實在比兩份不同的檔
    if [ "$(diff "$T/red.sh" "$T/green.sh" | grep -c '^[<>]')" = "2" ]; then
      ok "③兩個世界只差那一行(diff 只有 2 行)"; else bad "③兩個世界差不只一行 ⇒ ①② 證不了東西"; fi
    # ④ bash -n 對兩個世界【都】rc=0 —— 這一格證明「為什麼需要本閘」
    bash -n "$T/red.sh" 2>/dev/null && bash -n "$T/green.sh" 2>/dev/null \
      && ok "④bash -n 對兩個世界都 rc=0 ⇒ 它看不到這個病(本閘存在的理由)" \
      || bad "④bash -n 的行為變了 ⇒ 本閘的前提要重驗"
    # ⑤ 🔴 **量具壞掉必須紅** —— 這一格就是 code-reviewer 2026-09-08 那條 must-fix 住的地方。
    #    沒有它, 「shellcheck 讀不到檔」與「檔是乾淨的」在 rc 上是同一個 0。
    chmod 000 "$T/red.sh" 2>/dev/null
    report "$T/red.sh" > /dev/null 2>&1; RC5=$?
    chmod 644 "$T/red.sh" 2>/dev/null
    [ "$RC5" = "2" ] && ok "⑤讀不到的檔 ⇒ rc=2(量具失效, 不是「乾淨」)" \
                     || bad "⑤讀不到的檔回 rc=$RC5 ⇒ 期望 2;它會把讀不到當成乾淨"
    # ⑥ 🔴 紅的時候要印【那一行的字面】與【怎麼補】—— 檔頭承諾過, 而承諾要有人驗。
    #    只印 rc 的閘, 最省力的出口會變成 --no-verify ⇒ 這一格守的就是那句。
    report "$T/red.sh" > "$T/red.out" 2>&1
    if grep -qF '.rpc()' "$T/red.out" && grep -qF '怎麼補' "$T/red.out"; then
      ok "⑥紅字裡有【那一行的字面】也有【怎麼補】"
    else
      bad "⑥紅字沒印出那一行或沒印怎麼補 ⇒ 檔頭那句承諾失效"
    fi
    echo "── selftest:PASS=$P FAIL=$F ──"
    [ "$F" -eq 0 ] || exit 1
    exit 0 ;;
  --all)
    FILES=()
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done <<< "$(find scripts .husky -name '*.sh' -type f 2>/dev/null | sort)"
    [ "${#FILES[@]}" -gt 0 ] || { echo "🔴 找不到任何 .sh ⇒ fail-closed(分母不該是空的)。" >&2; exit 2; }
    report "${FILES[@]}"; exit $? ;;
  '')
    echo "用法:bash scripts/shell-backtick-parse-gate.sh <檔> […] | --selftest | --all" >&2; exit 2 ;;
esac

# 🔵 用陣列, 不靠斷詞 —— 今天本 repo 的路徑沒有空白, 而那是【今天成立】不是【結構上成立】。
SH=()
for f in "$@"; do case "$f" in *.sh) [ -f "$f" ] && SH+=("$f") ;; esac; done
[ "${#SH[@]}" -gt 0 ] || exit 0
report "${SH[@]}"
