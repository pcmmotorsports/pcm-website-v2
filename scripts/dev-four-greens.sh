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
  # ⚠️ 用 `env` 起頭而不是 `TURBO_FORCE=1 one …`(掛在【函式】上)——
  #    R2 四個 shell 實測:掛函式上,`/bin/sh` 確實殘留(after=1),而這支就是 /bin/sh 跑的
  #    ⇒ 會洩到後面的 vitest 那行。**這個理由成立。**
  # 🔴 但 R1 建議的其實是 `TURBO_FORCE=1 sh "$RUNRC" … `(掛在【外部命令】上),
  #    R2 實測四個 shell 全部不殘留 ⇒ **那個寫法是安全的,我上一版寫的理由打錯靶了。**
  #    不改的真正理由是另一個:那樣寫會把 one() 的 label 區塊繞掉,四項就少了標題與分隔。
  #    代價 = run-rc.sh 印 rc 那行的標籤寫 `env` 而不是 `pnpm typecheck`(它取 $1);
  #    真命令寫在下面那個 label 裡,不影響判讀。
  one 'typecheck  (TURBO_FORCE=1 pnpm typecheck)' env TURBO_FORCE=1 pnpm typecheck || tc=$?
  one 'lint       (TURBO_FORCE=1 pnpm lint)'      env TURBO_FORCE=1 pnpm lint      || li=$?
  one 'build      (TURBO_FORCE=1 pnpm build)'     env TURBO_FORCE=1 pnpm build     || bu=$?
  one 'vitest     (pnpm test = vitest run)'       pnpm test                        || vi=$?

  echo
  echo "════════ 總表(這四個 rc 各屬各自的命令)════════"
  summary_table "$tc" "$li" "$bu" "$vi"
  echo "🔴 上面每一項的 \`Cached:\` 行請自己看,本腳本不替你下結論。"
  verdict "$tc" "$li" "$bu" "$vi"
}

# 四項全 0 才回 0。抽成函式【只為了讓 selftest 餵得到它】——
# 它原本是 four_greens 裡的一行 inline 判定,而 inline 的東西測不到。
verdict() {
  [ "$1" = 0 ] && [ "$2" = 0 ] && [ "$3" = 0 ] && [ "$4" = 0 ]
}

# 總表也抽出來,理由同上:格7 要餵它、看標籤與變數有沒有對調。
# 🔴 selftest 必須呼叫【這一支】—— 在格子裡自己重打一份同樣的 printf,
#    那是把答案抄進考卷,改壞這裡它照樣綠。
summary_table() {
  printf 'typecheck rc=%s\nlint      rc=%s\nbuild     rc=%s\nvitest    rc=%s\n' "$1" "$2" "$3" "$4"
}

# ── 🔴 已知會產生【假綠】的位置(下面這份清單【不是窮舉】,原因寫在最後)────────
#    這一段被改寫過兩次,兩次都是因為我寫的數字被突變測試推翻:
#      ~~第一版「唯一會出錯的地方是 || rc=$? 把失敗吃掉」~~   ⇒ R1 推翻
#      ~~第二版「會出錯的地方有兩個」~~                        ⇒ R2 推翻(它打出第 3、第 4 個)
#    ⇒ **所以這一版不寫數字。** 帶數字的宣稱在這支檔上已經錯兩次。
#
#      ① one() 沒把非 0 rc 傳回來        ⇒ 四項有紅卻印一張全 0 的總表   【格1 守】
#      ② verdict() 壞掉                  ⇒ 總表照印 rc=1 而腳本 rc=0      【格3/3b/3c/3d 守】
#      ③ `|| tc=$?` 被改成 `|| true`     ⇒ 總表印 rc=0 且腳本 rc=0        【未守,見下】
#         🔴 反直覺:整行【刪掉】反而被 set -e 抓成紅,只有「吃掉」這種寫法會假綠。
#      ④ `'') four_greens ;;` 加上 `|| true` ⇒ 總表印四個 rc=1 而腳本 rc=0 【未守】
#    ②③④ 比①毒:①的假綠印在臉上,②③④的假綠只存在於 exit code 裡,人眼看不到。
#
# ⚠️ ③④ 與下列三處目前【沒有格子守】,列出來是為了不假裝它們被守住了:
#      · ck() 自己的比對(:82)—— 它是全套斷言的底座,改成 true ⇒ 五格恆 PASS
#      · run-rc.sh 有沒有真的在路徑上 —— 格5 只驗檔案存在,不驗 one() 有沒有走它
#      · 總表 printf 的標籤與變數對應(:63)—— 對調會把紅算到別項頭上(exit code 仍對,非假綠)
#    後兩者本版已補格(格6/格7);③④與 ck() 需要「拿整支去跑」才測得到,
#    而那要一個假 pnpm harness ⇒ **本版不做,明寫在這裡,不寫成已守。**
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

  # 格3 系列 [負測]:verdict() 的【每一個位置】各餵一發 ——
  # 🔴 R2 打出來的洞:上一版只餵 `0 0 0 1`,而 `verdict(){ [ "$4" = 0 ]; }` 這種突變
  #    會讓前三個位置整個沒人守,五格照樣全 PASS,而 typecheck 紅時整支 rc=0。
  #    ⇒ 一個位置一發,四發都要紅。
  for i in 1 2 3 4; do
    case $i in
      1) a=1; b=0; c=0; d=0 ;;
      2) a=0; b=1; c=0; d=0 ;;
      3) a=0; b=0; c=1; d=0 ;;
      4) a=0; b=0; c=0; d=1 ;;
    esac
    got=0; verdict "$a" "$b" "$c" "$d" || got=$?
    [ "$got" != 0 ] && r=nonzero || r=zero
    ck "格3-$i verdict(第 $i 項非 0) 要非 0" "$r" "nonzero"
  done

  # 格4 [正測]:四項全 0 才回 0(否則格3 系列可能只是「永遠非 0」)
  got=0; verdict 0 0 0 0 || got=$?
  ck "格4 verdict(0 0 0 0) 回 0" "$got" "0"

  # 格5:run-rc.sh 得在,否則整支是空跑
  [ -f "$RUNRC" ] && r=yes || r=no
  ck "格5 依賴的 $RUNRC 存在" "$r" "yes"

  # 格6:one() 必須【真的走 run-rc.sh】—— 格5 只驗檔案存在,驗不到有沒有用它。
  #     判準取 run-rc.sh 自己印的分隔線;把 :39 的 `sh "$RUNRC" 8 --` 拿掉就會消失。
  one '自測-有沒有走 run-rc' true 2>&1 | grep -q 'exit code' && r=yes || r=no
  ck "格6 one() 真的經過 $RUNRC" "$r" "yes"

  # 格7 系列:總表的標籤與變數要對得上 —— 對調會把紅算到別項頭上(exit code 仍對,所以人眼是唯一防線)。
  # 🔴 呼叫真的 summary_table(),不在這裡重打一份 printf ——
  #    重打的話,改壞 summary_table() 這格照樣綠(把答案抄進考卷)。
  for i in 1 2 3 4; do
    case $i in
      1) a=1; b=0; c=0; d=0; want='^typecheck rc=1$' ;;
      2) a=0; b=1; c=0; d=0; want='^lint  *rc=1$'    ;;
      3) a=0; b=0; c=1; d=0; want='^build  *rc=1$'   ;;
      4) a=0; b=0; c=0; d=1; want='^vitest  *rc=1$'  ;;
    esac
    # ⚠️ `|| true` 不可省:零命中時 grep 回 1,而 `set -e` 會讓整支【當場死掉】
    #    ⇒ 該格不會印 FAIL、後面的格也不跑,看起來像「跑到一半就沒了」而不是「這格紅了」。
    r=$(summary_table "$a" "$b" "$c" "$d" | grep -c "$want" || true)
    ck "格7-$i 總表第 $i 格對應第 $i 個變數" "$r" "1"
  done

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') four_greens ;;
  *) echo "用法: sh scripts/dev-four-greens.sh [--selftest]" >&2; exit 2 ;;
esac
