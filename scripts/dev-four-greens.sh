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
  # ⚠️ 用 `env` 起頭而不是 `TURBO_FORCE=1 one …`:POSIX 對「賦值前綴掛在【函式】呼叫上」
  #    是否只在該次呼叫生效【未規定】,各家 shell 不同 ⇒ 可能洩到後面的 vitest 那行。
  #    代價=run-rc.sh 印 rc 那行的標籤會寫 `env` 而不是 `pnpm typecheck`(它取 $1)。
  #    ⇒ 標籤問題留著,真命令寫在上面那個 label 裡;寧可標籤醜,不要語意未定義。
  one 'typecheck  (TURBO_FORCE=1 pnpm typecheck)' env TURBO_FORCE=1 pnpm typecheck || tc=$?
  one 'lint       (TURBO_FORCE=1 pnpm lint)'      env TURBO_FORCE=1 pnpm lint      || li=$?
  one 'build      (TURBO_FORCE=1 pnpm build)'     env TURBO_FORCE=1 pnpm build     || bu=$?
  one 'vitest     (pnpm test = vitest run)'       pnpm test                        || vi=$?

  echo
  echo "════════ 總表(這四個 rc 各屬各自的命令)════════"
  printf 'typecheck rc=%s\nlint      rc=%s\nbuild     rc=%s\nvitest    rc=%s\n' "$tc" "$li" "$bu" "$vi"
  echo "🔴 上面每一項的 \`Cached:\` 行請自己看,本腳本不替你下結論。"
  verdict "$tc" "$li" "$bu" "$vi"
}

# 四項全 0 才回 0。抽成函式【只為了讓 selftest 餵得到它】——
# 它原本是 four_greens 裡的一行 inline 判定,而 inline 的東西測不到。
verdict() {
  [ "$1" = 0 ] && [ "$2" = 0 ] && [ "$3" = 0 ] && [ "$4" = 0 ]
}

# 🔴 這支會出錯的地方有兩個(2026-08-17 code-reviewer 實測補上第二個;
#    ~~原本寫「唯一會出錯的地方是 || rc=$? 把失敗吃掉」~~ —— 那句被突變測試推翻):
#      ① one() 沒把非 0 rc 傳回來 ⇒ 四項有紅卻印一張全 0 的總表
#      ② verdict() 壞掉        ⇒ 總表【照印 rc=1、看起來完全正常】而腳本 rc=0
#         ⇒ 呼叫端寫 `sh scripts/dev-four-greens.sh && git merge …` 會在紅的時候放行
#    ②比①毒:①的假綠印在臉上,②的假綠只存在於 exit code 裡,人眼看不到。
selftest() {
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  # 🔴 呼叫端的變數【不能叫 rc】—— POSIX sh 沒有 local,one() 內部的 rc 是同一個全域。
  #    叫 rc 的話:刪掉 one() 的 `return "$rc"` ⇒ 格1 讀回的是 one() 自己剛寫進去的 13
  #    ⇒ 恆綠。這正是 code-reviewer 2026-08-17 用單行突變打出來的洞。
  # 格1 [負測]:one() 必須把被跑命令的非 0 rc 傳回來,不得吞掉
  got=0; one '自測-必失敗' sh -c 'exit 13' >/dev/null 2>&1 || got=$?
  ck "格1 one() 透傳失敗 rc" "$got" "13"

  # 格2 [正測]:成功時要回 0(否則格1 可能只是「永遠非 0」)
  got=0; one '自測-必成功' true >/dev/null 2>&1 || got=$?
  ck "格2 one() 成功回 0" "$got" "0"

  # 格3 [負測]:verdict() 只要有一項非 0 就必須非 0 —— 守的是「總表好看而 exit code 說謊」
  got=0; verdict 0 0 0 1 || got=$?
  [ "$got" != 0 ] && r=nonzero || r=zero
  ck "格3 verdict(0 0 0 1) 非 0" "$r" "nonzero"

  # 格4 [正測]:四項全 0 才回 0(否則格3 可能只是「永遠非 0」)
  got=0; verdict 0 0 0 0 || got=$?
  ck "格4 verdict(0 0 0 0) 回 0" "$got" "0"

  # 格5:run-rc.sh 得在,否則整支是空跑
  [ -f "$RUNRC" ] && r=yes || r=no
  ck "格5 依賴的 $RUNRC 存在" "$r" "yes"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') four_greens ;;
  *) echo "用法: sh scripts/dev-four-greens.sh [--selftest]" >&2; exit 2 ;;
esac
