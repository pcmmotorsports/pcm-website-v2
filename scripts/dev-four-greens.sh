#!/bin/sh
# dev 四綠 —— 收割窗每併一支跑一次的那四項,一次跑完,逐項印 rc 與 `Cached:` 那一行。
#
# 用法:
#   sh scripts/dev-four-greens.sh              # 跑四項
#   sh scripts/dev-four-greens.sh --selftest   # 只驗這支自己不會吃掉失敗
#
# ── 它【不是】一鍵通過 ──────────────────────────────────────────────────
# 它不判斷你該不該收、也不替你下「綠了」的結論。它只保證:
#   ① 四項各自跑在【沒有管線】的位置(透過 scripts/run-rc.sh)⇒ 印的 rc 是它自己的
#   ② 每一項的 `Cached:` 那一行原樣印出來,給人自己看
#   ③ 收尾的總表把四個 rc 並排,**任何一項非 0 這支就非 0**
#
# ── 🔴 `Cached: 0 cached` 為什麼要自己加 TURBO_FORCE=1 才算數 ────────────
# `docs/phase-1-backlog.md` `#524` 逐字:**真跑與 replay 之下 `Cached:` 印的東西完全相同**
# ⇒ 那一行本身**零判別力**。本腳本把 `TURBO_FORCE=1` 寫死在命令裡,所以它印的
# `0 cached` 證的是「**這支強制它真跑了**」,不是「它本來就真跑」。
# 🔴 **別人回報的 `0 cached`,除非他寫了他加了什麼,否則不是他真跑過的證據。**
#
# ── 🔴 兩條射程限定(跟數字一起看,別放大)────────────────────────────────
#   1 `build` 的分母是 2 不是 8 —— 只有 apps/storefront 與 apps/admin 有 build script,
#     `packages/*` 有 typecheck 沒 build ⇒「build 全綠」涵蓋不到共用套件的產物。
#     量法: grep -rl '"build"' --include=package.json apps packages
#   2 `pnpm test` 走根 package.json 的 `vitest run`、**不經 turbo**
#     ⇒ 它沒有 replay 問題,也**沒有 `Cached` 行可貼**。拿不出那一行不是漏報。
#
# ⚠️ 它量的是【你現在所在的那棵樹的當下 HEAD】。開頭會把樹、分支、commit、時點印出來
#    —— 數字離開量測現場就要帶著範圍走,所以那四樣要跟結果一起複製。

set -e
cd "$(dirname "$0")/.."
RUNRC="scripts/run-rc.sh"

one() {
  label=$1; shift
  echo
  echo "════════ $label ════════"
  rc=0
  sh "$RUNRC" 8 -- "$@" || rc=$?
  return "$rc"
}

four_greens() {
  echo "───── 這份結果量的是 ─────"
  echo "樹      : $(pwd)"
  echo "分支    : $(git branch --show-current)"
  echo "commit  : $(git rev-parse --short HEAD)"
  echo "工作樹  : $(git status --porcelain | wc -l | tr -d ' ') 行未提交異動"
  echo "時點    : $(date '+%Y-%m-%d %H:%M:%S %Z')"

  tc=0; li=0; bu=0; vi=0
  one 'typecheck  (TURBO_FORCE=1 pnpm typecheck)' env TURBO_FORCE=1 pnpm typecheck || tc=$?
  one 'lint       (TURBO_FORCE=1 pnpm lint)'      env TURBO_FORCE=1 pnpm lint      || li=$?
  one 'build      (TURBO_FORCE=1 pnpm build)'     env TURBO_FORCE=1 pnpm build     || bu=$?
  one 'vitest     (pnpm test = vitest run)'       pnpm test                        || vi=$?

  echo
  echo "════════ 總表(這四個 rc 各屬各自的命令)════════"
  printf 'typecheck rc=%s\nlint      rc=%s\nbuild     rc=%s\nvitest    rc=%s\n' "$tc" "$li" "$bu" "$vi"
  echo "🔴 上面每一項的 \`Cached:\` 行請自己看，本腳本不替你下結論。"
  [ "$tc" = 0 ] && [ "$li" = 0 ] && [ "$bu" = 0 ] && [ "$vi" = 0 ]
}

# 🔴 這支唯一會出錯的地方是「`|| rc=$?` 把失敗吃掉」——
#    吃掉之後它會在四項有紅時印一張全 0 的總表,而那正是最貴的那種假綠。
selftest() {
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  # 格1 [負測]:one() 必須把被跑命令的非 0 rc 傳回來,不得吞掉
  rc=0; one '自測-必失敗' sh -c 'exit 13' >/dev/null 2>&1 || rc=$?
  ck "格1 one() 透傳失敗 rc" "$rc" "13"

  # 格2 [正測]:成功時要回 0(否則格1 可能只是「永遠非 0」)
  rc=0; one '自測-必成功' true >/dev/null 2>&1 || rc=$?
  ck "格2 one() 成功回 0" "$rc" "0"

  # 格3:run-rc.sh 得在,否則整支是空跑
  [ -f "$RUNRC" ] && r=yes || r=no
  ck "格3 依賴的 $RUNRC 存在" "$r" "yes"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') four_greens ;;
  *) echo "用法: sh scripts/dev-four-greens.sh [--selftest]" >&2; exit 2 ;;
esac
