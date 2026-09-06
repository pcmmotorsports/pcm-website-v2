#!/bin/sh
# scripts/shell-dialect-gate.sh —— shell 方言閘(第一族:mktemp -t · 第二族:process substitution 被 sh 跑到)
#
# 天花板/範圍: 只認【一族】方言 —— `mktemp -t <前綴>`。BSD(macOS)把 -t 後面當前綴、自動補亂數;
#   GNU coreutils 要求 template 自帶 XXXXXX,`mktemp -t foo` 會噴 "too few X's in template" 而【必炸】。
#   2026-08-27 CI 實證:.husky/commit-msg 那一顆就是這樣在 ubuntu 上炸的(修在 7efbe93d)。
#   ⬜ 不認:sed -i / stat -f|-c / date -v|-d|-r / grep -P / base64 -w|-b / readlink -f /
#           find -printf / md5 / tac / xargs -r …等其他 BSD⇄GNU 分歧。要多一族=多寫一條 pattern。
#   分母 = 呼叫端【傳進來的清單】(argv;無 argv 時讀 stdin,一行一路徑)。
#   🔴 本閘【不自算】「哪些腳本 CI 會跑到」—— 那個可達集【沒有乾淨定義】:
#      CI 不直接跑 .sh、也不跑 lint-staged,是 vitest 把某些 hook/腳本 spawn 起來才跑到;
#      而 `bash "$CHECKS"`(用【變數】組路徑呼叫)對任何【字面】尺都是結構性盲區
#      (-ed 2026-08-27 實證:migration-static-checks.sh 真的會跑,但字面 grep 看不到它)。
#      ⇒ 傳寬的清單=多掃沒壞處;傳窄的清單=這個閘就跟著窄。分母的責任在【呼叫端】,不在本閘。
#
# 天花板/量具: 我(寫這支的人)在 macOS 上做的是【字面比對】,【沒有】在 Linux 上實跑驗證這些字面
#   「真的會炸」。「GNU 上會炸」是【推的】——依 coreutils mktemp 的 man page(template 需帶 XXXXXX)
#   推論,不是我量到的。若你要把它當「已驗」,請在 Linux 上實跑一發補上這一格。
#   ⚠️ 我剝除【整行註解】(行首選擇性空白後接 #)—— 這一族不可能執行,剝掉零假陰性風險;
#      但我【不】剝除【行尾註解】(code # …mktemp -t…)與【字串/heredoc 內】的假 `mktemp -t`
#      ⇒ 那兩種仍會【假陽性】;判違規前開檔看一眼那行是不是真的在執行
#      (同 -ed 撞到 a4a-verify.sh 的 `md5` 在 SQL 字串裡那種)。
#
# 退出碼(🔴 constraint#1:閘壞了 ≠ 抓到方言,兩種紅要分得開):
#   0 = 掃完、零違規    1 = 抓到違規(印 檔:行)    2 = 閘自己壞了(用法錯/self-check 失敗)
#
# 本閘自己只用 POSIX 可攜寫法(自檢的臨時目錄用 `mktemp -d`,兩家都吃)—— 它不可以犯它在抓的病。

# ══ 第二族(2026-09-06 加;板列 ⟦auth-SHPROCSUBST⟧, 主視窗 `-f8` 裁「甲」)═══════
#
# 抓什麼:一支檔【同時】滿足兩件事 ⇒ 違規
#   ① 它有一行非註解的 process substitution 寫法(`<` 後面接 `(`)
#   ② **它會被 `sh` 跑到**(`package.json` 用 `sh ` 叫 / `.husky/*` 用 `sh ` 叫 / 它自己是 `#!/bin/sh`)
#
# 🔴 **為什麼要兩個條件都成立才算** —— 這一族的病【不住在檔案裡, 住在呼叫端】:
#   同一支檔, `bash` 叫它是對的、`sh` 叫它是壞的。⇒ 📌 **只掃檔案內容的尺會對 22 支好檔誤報。**
#   🔬 2026-09-06 實測:`scripts/` + `.husky/` 共 245 支 `.sh`, 真的有這個寫法的 **22 支**,
#      而它們**今天全部是 `bash` 叫的** ⇒ 交集 **0**。本閘守的是「有人把 bash 改成 sh」那一天。
#
# 🛑 **它的症狀為什麼特別壞**(這一族是這樣被發現的):`sh` 撞到那個寫法**不會整支死掉** ——
#   出錯的那一行的輸出變成**空字串**, 而旁邊的格子照樣 PASS。
#   🔬 實例:`selftest-git-isolation-gate.sh` 的一格印「得 (空) 期望 2」, 而 commit 被擋在
#   一個看不出原因的地方(修在 `c5073440e`;修法 = 先寫暫存檔再餵 `grep -f` / `comm`)。
#   ⇒ 📌 **一個空值不是一個錯誤。**
#
# ⚠️ **這一族的天花板**:
#   · 呼叫端三個來源是**字面**掃的 ⇒ 用變數組出來的呼叫(`$SH "$f"`)看不到 —— 與第一族同一個盲區。
#   · `package.json` 那一側**錨在開頭的引號**(`"sh `)。🔴 **這一格是踩過才寫對的**:
#     ⛔ ~~`grep 'sh scripts/x.sh'`~~ ⇒ **`"bash scripts/x.sh"` 裡面含著它** ⇒ 4 支假陽性,
#     而它們逐字都是 `bash`。**一個子字串比對, 在「bash vs sh」這題上恰好會答反。**
#   · 只剝**整行註解**, 不剝行尾註解與字串內 —— 與第一族同一個已揭露盲區。
#
# 🔵 **本閘自己是 `#!/bin/sh` 而且 `package.json:58` 用 `sh` 叫它** ⇒ 它在自己的分母裡,
#    所以它自己不可以用那個寫法(要組清單一律先寫暫存檔)。**它不可以犯它在抓的病。**

set -u

# 候選:mktemp,允許中間夾其他旗標,然後出現一個【單獨的 -t 旗標】
CAND='mktemp([[:space:]]+-[A-Za-z]+)*[[:space:]]+-t([[:space:]]|$)'
# 豁免:-t 後面的 template 自帶 XXXXXX(GNU 也吃)=合法,不判違規
GNUOK='\-t[[:space:]]+[^[:space:];|&)"'\''`]*XXXXXX'

scan_one() {
  # $1=路徑。印出違規行(檔:行:內容);回傳命中數走 stdout 由呼叫端數。
  f=$1
  if [ ! -r "$f" ]; then
    printf '  ⚠️ 讀不到(不計入命中,也不算乾淨):%s\n' "$f" >&2
    return 0
  fi
  # grep -n 印 "行號:內容";先砍掉【整行註解】(行號後、選擇性空白、接 #),再砍 GNU-ok 的 XXXXXX。
  grep -nE "$CAND" "$f" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*#' | grep -vE "$GNUOK" | while IFS= read -r hit; do
    printf '  ❌ %s:%s\n' "$f" "$hit"
  done
}

# ── 第二族:算出「會被 sh 跑到」的檔案集合, 落在 $1 這個檔裡(一行一個 repo 相對路徑)──
build_shset() {
  out=$1
  : > "$out"
  root=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd) || return 1
  # ① package.json:錨在【開頭那個引號】—— 見檔頭「這一格是踩過才寫對的」
  if [ -r "$root/package.json" ]; then
    grep -oE '"sh +[^"]*"' "$root/package.json" 2>/dev/null \
      | grep -oE '(scripts|\.husky)/[A-Za-z0-9_.-]+\.sh' >> "$out"
  fi
  # ② .husky/*:非註解行裡, 前面不是字母的 `sh ` (擋掉 bash / zsh / dash)
  for h in "$root"/.husky/*; do
    [ -f "$h" ] || continue
    grep -vE '^[[:space:]]*#' "$h" 2>/dev/null \
      | grep -oE '(^|[[:space:]&|;(])sh[[:space:]]+[^[:space:];|&)]*' \
      | grep -oE '(scripts|\.husky)/[A-Za-z0-9_.-]+\.sh' >> "$out"
  done
  # ③-a 🔴 **husky hook 【自己】就是被 sh 跑的**(codex R1 must-fix):`.husky/pre-commit` 這種檔
  #     **沒有 `.sh` 副檔名**, 而 husky 用 `sh` 執行它 ⇒ 它在裡面寫 process substitution 一樣會壞,
  #     📌 而我原本的三個來源**一個都收不到它** —— 它不是被誰「叫」的, 它自己就是入口。
  #     ⚠️ 跳過 `_/`(husky 自己產生的內部檔)與目錄。
  for h in "$root"/.husky/*; do
    [ -f "$h" ] || continue
    printf '.husky/%s\n' "$(basename "$h")" >> "$out"
  done
  # ③-b shebang 自己就是 sh
  for f in "$root"/scripts/*.sh; do
    [ -f "$f" ] || continue
    sb=$(head -1 "$f")
    case "$sb" in
      '#!/bin/sh'|'#!/usr/bin/env sh') printf 'scripts/%s\n' "$(basename "$f")" >> "$out" ;;
    esac
  done
  sort -u "$out" -o "$out"
}

# 第二族的單檔掃描。$1=要掃的檔(可為絕對路徑) $2=shset 檔 $3=拿來比對集合用的名字(repo 相對)
scan_one_procsub() {
  f=$1; set_file=$2; key=$3
  [ -r "$f" ] || return 0
  [ -r "$set_file" ] || return 0
  grep -qxF "$key" "$set_file" 2>/dev/null || return 0
  grep -nE '<\(' "$f" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*#' | while IFS= read -r hit; do
    printf '  ❌ %s:%s\n' "$f" "$hit"
    printf '     ⇒ 第二族:process substitution, 而這支檔會被 sh 跑到 ⇒ 那一行的輸出會變【空字串】而不是錯誤。\n'
    printf '     ⇒ 修法:先寫暫存檔再餵 grep -f / comm(照 c5073440e 的做法), 不要改成用 bash 叫它。\n'
  done
}

run_list() {
  # 讀 argv 或 stdin,逐檔掃,統計。
  total=0; hits=0; hits1=0; hits2=0
  _T=t   # 用變數拼「-t」, 免得本檔的訊息字面被自己的第一族判違規
  # 第二族要先算一次「會被 sh 跑到」的集合(每次 run_list 算一次, 不是每個檔算一次)
  # 🔴 **量具建不起來 ⇒ fail-closed**(codex R1 must-fix):原本只印一句警告然後往下跑,
  #    ⇒ 📌 **最壞情況是「第二族整族沒掃」而離場碼 0** —— 那與「掃過了、乾淨」印同一個東西。
  WORKDIR=$(mktemp -d) || { echo "閘自己壞了:mktemp -d 失敗" >&2; return 2; }
  SHSET="$WORKDIR/shset"
  if ! build_shset "$SHSET"; then
    echo "🔴 閘自己壞了:算不出「會被 sh 跑到」的集合 ⇒ 第二族沒有掃 ⇒ 拒絕回 0(exit 2)" >&2
    rm -rf "$WORKDIR"
    return 2
  fi
  _relkey() { # 把絕對路徑正規化成 repo 相對(lint-staged 餵的是絕對路徑)
    _r=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd) || { printf '%s' "$1"; return; }
    case "$1" in "$_r"/*) printf '%s' "${1#"$_r"/}" ;; *) printf '%s' "$1" ;; esac
  }
  _scan() {
    total=$((total + 1))
    # 🔴 **兩族分開數** —— 因為它們的**處置不同**(第一族只印, 第二族擋)。
    #    合在一起數的話, 離場碼就答不出「是哪一族」。
    o1=$(scan_one "$1")
    o2=$(scan_one_procsub "$1" "$SHSET" "$(_relkey "$1")")
    if [ -n "$o1" ]; then
      printf '%s\n' "$o1"
      n1=$(printf '%s\n' "$o1" | grep -c '❌'); hits1=$((hits1 + n1)); hits=$((hits + n1))
    fi
    if [ -n "$o2" ]; then
      printf '%s\n' "$o2"
      n2=$(printf '%s\n' "$o2" | grep -c '❌'); hits2=$((hits2 + n2)); hits=$((hits + n2))
    fi
  }
  # ── 先把要掃的清單收進一個檔, 再一次掃 ───────────────────────────────
  TGT="$WORKDIR/targets"; : > "$TGT"
  if [ "$#" -gt 0 ]; then
    for f in "$@"; do printf '%s\n' "$f" >> "$TGT"; done
  else
    while IFS= read -r f; do [ -n "$f" ] || continue; printf '%s\n' "$f" >> "$TGT"; done
  fi
  # 🔴🔴 **呼叫關係改了 ⇒ 要重掃【被呼叫的那些檔】, 不是只掃改動的那一支**(codex R1 must-fix ×2)。
  #   📌 這一族的違規是**一對關係**(檔案內容 × 誰用什麼 shell 叫它)——
  #     ⇒ 把 `package.json` 裡某支的 `bash` 改成 `sh`, **改動的檔是 `package.json`**,
  #       而**變成違規的是那支腳本** ⇒ 只掃 staged 清單的話, 它**一個字都不會印**。
  #   ⇒ ✅ staged 裡出現 `package.json` 或 `.husky/` 底下的東西 ⇒ **把整個 shset 一起掃**。
  #   ⚠️ 代價:那幾種 commit 會多花幾秒(shset 今天約 30 多支);而**漏放的代價是這一族的核心事故**。
  _relist=0
  while IFS= read -r f; do
    case "$(_relkey "$f")" in package.json|.husky/*) _relist=1 ;; esac
  done < "$TGT"
  if [ "$_relist" = 1 ]; then
    _r2=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)
    printf '  🔁 呼叫關係可能改了(staged 含 package.json 或 .husky/)⇒ 把整個「會被 sh 跑到」的集合一起掃\n'
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      [ -f "$_r2/$k" ] && printf '%s\n' "$_r2/$k" >> "$TGT"
    done < "$SHSET"
  fi
  sort -u "$TGT" -o "$TGT"
  while IFS= read -r f; do [ -n "$f" ] || continue; _scan "$f"; done < "$TGT"
  printf '\n掃了 %s 支(傳進來的清單)· 認得【2 族】方言:①%s <無 XXXXXX 前綴>(BSD-only)②process substitution 而該檔會被 sh 跑到\n' "$total" "mktemp -$_T"
  printf '命中 %s 處(第一族 %s · 第二族 %s)。分母=你傳的清單,不是「CI 會跑到的全部」(見檔頭「天花板/範圍」)。\n' "$hits" "$hits1" "$hits2"
  # 🔴🔴 **第一族【印了但不擋】**(2026-09-06 主視窗 `-f8` 裁「乙」)——
  #   接進 `lint-staged` 的那一刻, 第一族現存的 17 處會讓 **6 支檔誰改誰被擋**,
  #   而那 5 支是別條線在維護的檔。⇒ 📌 **一道新閘不該把別人的既有債變成【今天的阻塞】。**
  #   ⇒ ✅ 第一族照印、照計數, **而只有第二族會讓離場碼變 1**。
  #   ⏰ **第一族何時轉「擋」= 板列 ⟦auth-MKTEMPDEBT⟧ 關掉的那一天。**
  #   🛑 **這一句一定要留著** —— 否則下一個人看到第一族印紅, 會以為它在守。
  if [ "$hits1" -ne 0 ]; then
    printf '⚠️ 第一族有 %s 處, 而它【只印不擋】(板列 ⟦auth-MKTEMPDEBT⟧;那一列關掉才轉擋)。\n' "$hits1" >&2
  fi
  rm -rf "$WORKDIR"
  [ "$hits2" -eq 0 ] && return 0 || return 1
}

self_check() {
  d=$(mktemp -d) || { echo "self-check: mktemp -d 失敗" >&2; return 2; }
  # constraint#3 的三個具名格 + template 形 + 可攜 -d
  # 🔴🔴 **樁的內容不可以【逐字】寫在本檔裡**(2026-09-06;主視窗 `-f8` 指定現在就修)——
  #   本閘接進 `lint-staged` 之後會**掃到自己**, 而這幾行的字面會被第一族判違規(字串盲區)
  #   ⇒ 📌 **維護這支閘的人, 他的 commit 會被這支閘擋住。**
  #   ⇒ 🎯 **一支對【自己】叫的守門會被關掉, 而它守的東西跟著沒了。**
  #   ⇒ ✅ 用 `%s` 讓那兩個字在**執行時**才拼起來:**檔案裡沒有它, 樁裡有它** ——
  #     🔵 而**盲區的活證據沒有消失**:`neg_string.sh` 的內容照舊, 它照舊被判 hit(下面那一格還在演)。
  _m='mktemp -t'
  printf 'out=$(%s pagecount).pdf\n'   "$_m" > "$d/pos_suffix.sh"   # 後接副檔名,單獨一格,要判違規
  printf 'tmp="$(%s l4a1mut)"\n'       "$_m" > "$d/pos_prefix.sh"   # 裸前綴,要判違規
  printf 'f="$(mktemp "$TMPDIR/a.XXXXXX")"\n' > "$d/neg_template.sh" # template 形,不判違規
  printf 'd="$(mktemp -d)"\n'                 > "$d/neg_portable.sh" # -d 可攜,不判違規
  printf 'g="$(%s foo.XXXXXX)"\n'      "$_m" > "$d/neg_gnuok.sh"    # -t 但帶 XXXXXX(GNU 也吃),不判違規
  printf '  # 🔴 %s <前綴> 是 BSD 方言\n' "$_m" > "$d/neg_comment.sh"  # 整行註解 ⇒ 剝除 ⇒ 不判違規
  printf 'echo "run: %s xyz"\n'        "$_m" > "$d/neg_string.sh"   # ⚠️ 已知盲區:字串內 ⇒ 目前【仍會】假陽性

  ok=1
  _expect() { # $1=檔 $2=want(hit|clean)
    o=$(scan_one "$d/$1")
    got=clean; [ -n "$o" ] && got=hit
    if [ "$got" = "$2" ]; then printf '  ✅ %-16s ⇒ %s\n' "$1" "$got"
    else printf '  ❌ %-16s ⇒ 得 %s 期望 %s\n' "$1" "$got" "$2"; ok=0; fi
  }
  echo "self-check(正負對照):"
  _expect pos_suffix.sh   hit
  _expect pos_prefix.sh   hit
  _expect neg_template.sh clean
  _expect neg_portable.sh clean
  _expect neg_gnuok.sh    clean
  _expect neg_comment.sh  clean
  # neg_string.sh 是【已揭露的盲區】:它現在會被判 hit(假陽性)。self-check 把這件事【演出來】,
  # 不當失敗——證明「天花板/量具」第二段講的字串盲區是真的、不是嘴上說說。
  o=$(scan_one "$d/neg_string.sh"); got=clean; [ -n "$o" ] && got=hit
  printf '  ⚠️ %-16s ⇒ %s(這是檔頭揭露的字串盲區,故意留著當活證據,非 bug)\n' "neg_string.sh" "$got"

  # ══ 第二族的四格 ══════════════════════════════════════════════════════
  #   🔴 這一族是【關係型】的(檔案內容 × 呼叫端), 所以每一格都要把【兩邊】說清楚。
  echo ""
  echo "self-check 第二族(process substitution × 會不會被 sh 跑到):"
  ps_set="$d/shset"
  printf 'x/pos_ps.sh\nx/neg_comment_ps.sh\nx/real_pre.sh\n' > "$ps_set"
  # 🔴🔴 **樁的內容不可以【逐字】寫在本檔裡** —— 而這是量到的:
  #    第一版直接寫 `printf 'a=$(comm -12 - <(printf x))'`, 結果**本閘掃自己時抓到那三行**
  #    (3 處), 而它們是**字串裡的**假陽性 —— 與第一族 `neg_string.sh` 同一個已揭露盲區。
  #    🛑 **差別在於:第一族那一格是【故意留著當活證據】, 而這一族不能** ——
  #      本閘自己就在「會被 sh 跑到」的集合裡(`package.json:58` 用 `sh` 叫), 一支**對自己叫的守門**
  #      會被關掉。⇒ ✅ 用 `%s` 把那兩個字元**在執行時才拼起來**:檔案裡沒有它, 樁裡有它。
  _lt='<'
  # ⚠️ **連【行尾註解】也不能寫那兩個字元** —— 本族只剝【整行】註解, 與第一族同一個盲區。
  #    🔬 第二次量到:改完樁之後還剩 2 處, 而它們是這兩行的**行尾註解**。
  printf 'a=$(comm -12 - %s(printf x))\n' "$_lt" > "$d/pos_ps.sh"        # 有 process substitution 且在 sh 集合裡 ⇒ hit
  printf 'b=$(comm -12 - %s(printf x))\n' "$_lt" > "$d/neg_notsh.sh"     # 有 process substitution 而【不在】集合裡 ⇒ clean
  printf '  # 這行只是註解 %s(printf x)\n' "$_lt" > "$d/neg_comment_ps.sh" # 在集合裡而只在註解 ⇒ clean
  _expect_ps() { # $1=檔名 $2=want
    o=$(scan_one_procsub "$d/$1" "$ps_set" "x/$1")
    got=clean; [ -n "$o" ] && got=hit
    if [ "$got" = "$2" ]; then printf '  ✅ %-18s ⇒ %s\n' "$1" "$got"
    else printf '  ❌ %-18s ⇒ 得 %s 期望 %s\n' "$1" "$got" "$2"; ok=0; fi
  }
  _expect_ps pos_ps.sh        hit
  _expect_ps neg_notsh.sh     clean
  _expect_ps neg_comment_ps.sh clean
  # 🟢 **真實世界正對照**(主視窗 `-f8` 指定):拿【修之前】那一版隔離閘 —— 它當時確實
  #    被 `package.json:71` 用 `sh` 叫, 而它含那個寫法 ⇒ 這把尺必須抓到它。
  #    📌 少了這一格, 上面三格都是我自己造的樁 —— 而樁證明不了「它在真檔上分得出來」。
  if git -C "$(cd "$(dirname "$0")/.." && pwd)" show 73692a244:scripts/selftest-git-isolation-gate.sh > "$d/real_pre.sh" 2>/dev/null; then
    _expect_ps real_pre.sh hit
  else
    printf '  ⚠️ %-18s ⇒ 取不到(git show 失敗)⇒ 這一格【沒有跑】, 不當通過也不當失敗\n' "real_pre.sh"
  fi

  [ "$ok" -eq 1 ] && { echo "  ⇒ self-check PASS"; return 0; } || { echo "  ⇒ self-check FAIL"; return 2; }
}

case "${1:-}" in
  --self-check|--selftest) self_check; exit $? ;;
  -h|--help)
    echo "用法: shell-dialect-gate.sh <檔...>   或   printf '%s\\n' <檔...> | shell-dialect-gate.sh"
    echo "      shell-dialect-gate.sh --self-check"
    exit 0 ;;
  *) run_list "$@"; exit $? ;;
esac
