#!/bin/sh
# scripts/shell-dialect-gate.sh —— shell 方言閘(第一族:mktemp -t)
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

run_list() {
  # 讀 argv 或 stdin,逐檔掃,統計。
  total=0; hits=0
  tmp_hits=$(mktemp -d)/hits   # 用 -d(可攜),把命中行數落檔避開 subshell 吞變數
  : > "$tmp_hits"
  _scan() {
    total=$((total + 1))
    out=$(scan_one "$1")
    if [ -n "$out" ]; then
      printf '%s\n' "$out"
      n=$(printf '%s\n' "$out" | grep -c '❌')
      hits=$((hits + n))
    fi
  }
  if [ "$#" -gt 0 ]; then
    for f in "$@"; do _scan "$f"; done
  else
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      _scan "$f"
    done
  fi
  printf '\n掃了 %s 支(傳進來的清單)· 認得【1 族】方言:mktemp -t <無 XXXXXX 前綴>(BSD-only)\n' "$total"
  printf '命中 %s 處。分母=你傳的清單,不是「CI 會跑到的全部」(見檔頭「天花板/範圍」)。\n' "$hits"
  [ "$hits" -eq 0 ] && return 0 || return 1
}

self_check() {
  d=$(mktemp -d) || { echo "self-check: mktemp -d 失敗" >&2; return 2; }
  # constraint#3 的三個具名格 + template 形 + 可攜 -d
  printf 'out=$(mktemp -t pagecount).pdf\n'      > "$d/pos_suffix.sh"   # 後接副檔名,單獨一格,要判違規
  printf 'tmp="$(mktemp -t l4a1mut)"\n'          > "$d/pos_prefix.sh"   # 裸前綴,要判違規
  printf 'f="$(mktemp "$TMPDIR/a.XXXXXX")"\n'    > "$d/neg_template.sh" # template 形,不判違規
  printf 'd="$(mktemp -d)"\n'                    > "$d/neg_portable.sh" # -d 可攜,不判違規
  printf 'g="$(mktemp -t foo.XXXXXX)"\n'         > "$d/neg_gnuok.sh"    # -t 但帶 XXXXXX(GNU 也吃),不判違規
  printf '  # 🔴 mktemp -t <前綴> 是 BSD 方言\n' > "$d/neg_comment.sh"   # 整行註解 ⇒ 剝除 ⇒ 不判違規
  printf 'echo "run: mktemp -t xyz"\n'           > "$d/neg_string.sh"   # ⚠️ 已知盲區:字串內 ⇒ 目前【仍會】假陽性

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
