#!/bin/sh
# 跑一個命令、只印尾 N 行、**另外單獨印那個命令自己的 exit code**。
#
# 用法:
#   sh scripts/run-rc.sh 20 -- pnpm turbo typecheck lint --force
#   sh scripts/run-rc.sh 5  -- bash scripts/migration-static-checks.sh foo.sql
#   sh scripts/run-rc.sh --selftest
#
# ── 為什麼有這支(2026-08-17;機制優先律,不寫第五條規則)────────────────────
# 🔴 `bash x.sh | grep …; echo rc=$?` 拿到的是 **`grep` 的 rc**,不是那支腳本的。
#    CLAUDE.md 終端機紀律寫得明明白白,而 2026-08-16~17 兩天內 **四個不同的窗照踩**。
#
# 🔴 **病根不是不知道,是需求沒有出口**:大家接管線是因為**輸出太長**,
#    而「我想少看一點輸出」在此之前**只有管線這一條路**。
#    規則叫人不要走那條路,**卻沒有給第二條路** ⇒ 規則輸給了需求。
#    ⇒ 這支不是守門,**它只是一條比較好走的路**。不掛 hook、不進 pre-commit ——
#      **採不採用靠好用,不靠強制。**
#
# ── 它保證三件事 ────────────────────────────────────────────────────────
#   ① 印出來的 rc 是【被跑的那個命令】的,不是任何過濾器的
#      (作法:完整輸出先落暫存檔、當場收 rc,**尾巴是事後才裁的**)
#   ② 尾 N 行與 rc **分兩塊**印,rc 有自己的一行,不會混在輸出裡被眼睛滑過去
#   ③ 「命令失敗」與「命令成功但零輸出」**印不同的東西**
#      —— 這兩個世界在 `cmd | tail` 底下長得一模一樣,那正是最貴的那種混淆
#
# ⚠️ 界線:它**不判斷**那個 rc 是不是你要的,也不知道那個命令量的對不對。
#    它只保證**你看到的 rc 屬於你跑的那個命令**。

set -e

usage() {
  echo "用法: sh scripts/run-rc.sh <尾幾行> -- <命令...>" >&2
  echo "     sh scripts/run-rc.sh --selftest" >&2
  exit 2
}

run_and_report() {
  n=$1; shift
  [ "$1" = "--" ] || usage
  shift
  [ $# -gt 0 ] || usage

  log=$(mktemp)
  # 🔴 命令跑在【沒有管線】的位置 ⇒ $? 就是它自己的。
  #    輸出整份落檔,尾巴事後才裁 —— 裁切發生在 rc 收完【之後】。
  set +e
  "$@" > "$log" 2>&1
  rc=$?
  set -e

  total=$(wc -l < "$log" | tr -d ' ')
  echo "───── 尾 $n 行(共 $total 行,完整輸出 $log)─────"
  if [ "$total" = "0" ]; then
    # ③ 零輸出要明說,不要印一片空白讓人以為是它壞了
    echo "（這個命令沒有印任何東西）"
  else
    tail -n "$n" "$log"
  fi
  echo "───── exit code ─────"
  if [ "$rc" = "0" ]; then
    echo "rc=0 ✅（$1 自己的 exit code，不是任何過濾器的）"
  else
    # ③ 失敗的世界印不同的東西,而且明說暫存檔在哪
    echo "rc=$rc 🔴 失敗（$1 自己的 exit code）"
    echo "   完整輸出在 $log —— 尾 $n 行【可能沒有含到真正的錯誤】，失敗時請開全檔。"
  fi
  return "$rc"
}

selftest() {
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  # 格1 [負測]:命令必定 rc=42 ⇒ 印出來的必須是 42
  #     🔴 這格就是這支工具存在的理由。沒有它,整支是恆綠的。
  out=$(sh "$0" 3 -- sh -c 'echo noise; exit 42' 2>&1) || true
  case "$out" in *"rc=42"*) r=42 ;; *) r=other ;; esac
  ck "格1 命令 rc=42 ⇒ 印 rc=42" "$r" "42"

  # 格1b:那個 42 不能是「最後一個命令」的 —— 讓命令【印很多行】確認裁切不影響 rc
  out=$(sh "$0" 2 -- sh -c 'for i in 1 2 3 4 5 6 7 8; do echo line$i; done; exit 7' 2>&1) || true
  case "$out" in *"rc=7"*) r=7 ;; *) r=other ;; esac
  ck "格1b 輸出被裁到 2 行後 rc 仍是 7" "$r" "7"

  # 格2:rc=0 且零輸出 ⇒ 要明說「沒有印任何東西」
  out=$(sh "$0" 5 -- true 2>&1) || true
  case "$out" in *"沒有印任何東西"*) r=said ;; *) r=silent ;; esac
  ck "格2 零輸出 ⇒ 明說(不是一片空白)" "$r" "said"

  # 格3:兩個世界印不同的東西 —— 失敗的那個要有 🔴 與完整輸出路徑
  bad=$(sh "$0" 3 -- sh -c 'exit 1' 2>&1) || true
  good=$(sh "$0" 3 -- true 2>&1) || true
  case "$bad"  in *"完整輸出在"*) b=has_path ;; *) b=no_path ;; esac
  case "$good" in *"完整輸出在"*) g=has_path ;; *) g=no_path ;; esac
  ck "格3 失敗時指路" "$b" "has_path"
  ck "格3b 成功時不指路(⇒ 兩個世界不同)" "$g" "no_path"

  # 格4:本工具自己的 rc 要等於被跑命令的 rc(否則呼叫端 && 串接會壞)
  sh "$0" 1 -- sh -c 'exit 9' >/dev/null 2>&1 && r=0 || r=$?
  ck "格4 工具自己的 rc 透傳" "$r" "9"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  ''|-h|--help) usage ;;
  *) run_and_report "$@" ;;
esac
