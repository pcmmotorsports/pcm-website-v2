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

# 🔴 【尾 N 行】落在 repo 內的 logs/ 而不是系統暫存區(logs/ 已在 .gitignore)。
# ⚠️ **更正一句本檔原本寫錯的**:~~完整輸出落在 repo 內~~ —— **不是**。
#    `run-rc.sh` 把完整輸出寫進它自己的 `mktemp`(/var/folders/…),只把【尾 N 行】印出來,
#    而本檔收下的就是那份尾 N 行 ⇒ **repo 內的 log 是裁過的,完整那份仍然在會被系統清掉的地方。**
#    量法(2026-08-17 當場):故意弄紅 typecheck 跑一發 ⇒ `logs/four-greens/<hash>-<時點>-<PID>/typecheck.log`
#    看得到 `@pcm/admin#typecheck` 出現在 turbo 的 Failed 那一行(⚠️ 該行標籤後面是**四個空白**不是一個,
#    照抄成 `Failed: @pcm/…` 去 grep 會零命中)與 `rc=2`,**看不到是哪一支檔**(`grep -c __four-greens-probe` ⇒ 0),
#    只留了一行指向 /var/folders 的路徑 —— 而那正是本段一開始要避開的東西。
#    ⇒ **這個缺口本版【不修】**(改它要動 one() 的行為,超出「只動落檔路徑」的授權範圍),明寫在這裡不假裝已解。
#    原因是實戰踩到的:run-rc.sh 用 mktemp,檔案在 /var/folders/…,**會被系統清掉**
#    ⇒ 印出來的那個路徑,等你要開的時候可能已經不在了。
# ⚠️ 我第一版是「把 TMPDIR 指過去讓 run-rc 的 mktemp 照著用」——**當場實測不成立**:
#    macOS 的 `mktemp`(無參數)吃的是 darwin 的 per-user 暫存目錄,**不理 TMPDIR**。
#    量法(兩個世界):`TMPDIR=<repo>/logs/four-greens mktemp` ⇒ 仍然回 /var/folders/…
#    ⇒ 改成本檔自己收 log,不動 run-rc.sh。
# 🔴 log 目錄帶【當下 tip 短 hash + 時點】—— 2026-08-17 I 窗量到的守門缺口:
#    舊版每一次跑都寫同一組 `logs/four-greens/<項目>.log`,**後一次整支覆寫前一次**。
#    實錘量法:`ls -lT logs/four-greens/` ⇒ 5 支檔 mtime 全落在同一分鐘,
#    而當天有【四支 merge 連著收】⇒ 規矩「一支 merge 配一次四綠」**事後查不到誰跑過**。
#    🔴 病灶不是有人偷懶,是【遵守與否驗不出來 = 沒有守門】:
#       規矩寫得出來,而 repo 上沒有任何東西會因為漏跑而變得不一樣。
# ⚠️ **四條射程限定,一起看**(R1 對抗審查打出來的,逐條都是實測不是設想):
#    1 它記的是「這次四綠量的是哪一顆 commit」,**不是**「這顆 commit 一定有人跑過四綠」——
#      沒跑就是沒有那個目錄,而【沒有目錄】和【還沒跑】仍然長得一樣。缺席變成可查,不變成不可能。
#    2 🔴 **反向也一樣**:【有目錄】≠【綠了】。目錄在 `mkdir -p` 當下就生 ——
#      紅的、跑到一半 Ctrl-C 的,留下的目錄和一次全綠的長得完全一樣。要看綠不綠請開 log 裡的 rc 行。
#    3 🔴 `logs/` 在 `.gitignore` 裡 ⇒ **這份痕跡只活在跑的那台機器上,進不了 git**。
#      118🏁 診斷的兩半(覆寫 / git 上沒痕跡)本版只關前一半,後一半仍然開著,不要讀成整條關掉。
#    4 `mkdir -p` 失敗時 `set -e` 讓整支以 rc=1 收場,和「四項有紅」**同一個 rc**
#      ⇒ 呼叫端分不出「量具沒起來」與「量到紅」。本版不修(要動收尾流程),明寫不假裝已解。
#
# 🔴 `-$$`(PID)不可省:時點只到【秒】,而本檔實際發生過同秒兩次呼叫擠進同一個目錄
#    (`selftest.log` 與四項 log 落在同一個 `…152523/` 裡)⇒ 那正是本次要治的病原封不動。
# 🔴 selftest 的目錄【刻意不同形】:格1/格2 也會呼叫 one() 而產生目錄,
#    若與真四綠 run 同形,稽核「這顆 merge 有沒有跑過四綠」時它是**假陽性**(有目錄、零四綠證據)。
HEADHASH="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
STAMP="$(date '+%Y%m%dT%H%M%S')-$$"

# 抽成函式【只為了讓 selftest 餵得到它】—— inline 的東西測不到(同 verdict()/summary_table() 的理由)。
# $1 = selftest | run
runstamp_for() {
  if [ "$1" = selftest ]; then echo "selftest-$STAMP"; else echo "$HEADHASH-$STAMP"; fi
}
# 🔴 **沒有 `LOGDIR` 這個變數** —— R2 對抗審查打掉的兩個洞都長在「函式算一份、變數存一份」那一跳上:
#    ①格子測 `runstamp_for()`,而真正建目錄的是 `LOGDIR` ⇒ 只改 `LOGDIR` 一行,格子全綠而病復發。
#    ②`LOGDIR` 寫死成 `$(runstamp_for selftest)` ⇒ selftest 期間兩者同值、恆綠,
#      而**每一次真四綠 run 都落進 `selftest-…` 目錄** ⇒ 稽核變成假陰性(格10 守的假陽性的鏡像)。
#    ⇒ 補格子只會追著洞跑。**把那一跳整個拿掉**:所有使用點一律現算 `logdir_for "$MODE"`。
logdir_for() { echo "$(pwd)/logs/four-greens/$(runstamp_for "$1")"; }

# 🔴 `mkdir -p` 搬進 one() —— 原本在頂層、在參數分派【之前】跑,
#    ⇒ 打錯字(`--self-test`)那種非法參數會印用法、rc=2,**而磁碟留下一個零檔案的「真 run 形狀」目錄**
#      = 稽核假陽性的另一扇門(R2 F-3 實測)。放進 one() 之後,只有真的要寫 log 才會生目錄。
if [ "${1:-}" = --selftest ]; then MODE=selftest; else MODE=run; fi

# 🔴 尾行數是【參數】不是固定值,原因是實戰踩到的(2026-08-17 收割 products 那次):
#    vitest 紅的時候,失敗明細在 `Failed Tests` 那一段,而總結行在最後 ——
#    尾 8 行只夠印到「Test Files 1 failed」,**印不到是哪一格紅、為什麼紅**。
#    ⇒ 我當時是靠 run-rc.sh 印的完整輸出路徑才撈回來,而我第一次還把那行 grep 掉了。
#    `run-rc.sh` 檔頭早就寫著「失敗時尾 N 行可能沒有含到真正的錯誤,請開全檔」——
#    **規則寫了而照樣踩,所以改成機制:讓紅的那一項自己就印得夠多。**
# one <尾幾行> <log 檔名> <標題> -- 命令...
one() {
  n=$1; slug=$2; label=$3; shift 3
  d="$(logdir_for "$MODE")"; mkdir -p "$d"
  echo
  echo "════════ $label ════════"
  echo "(跑完會印在下面;尾 $n 行留在 $d/$slug.log)"
  rc=0
  # 🔴 【沒有管線】—— 輸出整份落檔、rc 是 run-rc.sh 的(而它的 rc 是被跑命令的)。
  #    代價:不是即時串流,要等該項跑完才看得到。四項各 15-60 秒,可以接受;
  #    換來的是【一個叫得出名字、不會被系統清掉的檔】。
  sh "$RUNRC" "$n" -- "$@" > "$d/$slug.log" 2>&1 || rc=$?
  cat "$d/$slug.log"
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
  # 尾行數:turbo 三項的 `Cached:` 行就在最後幾行 ⇒ 8 夠。
  # vitest 用 60 —— 它把 `Failed Tests` 明細印在總結【之前】,8 行只印得到「1 failed」。
  one  8 typecheck 'typecheck  (TURBO_FORCE=1 pnpm typecheck)' env TURBO_FORCE=1 pnpm typecheck || tc=$?
  one  8 lint      'lint       (TURBO_FORCE=1 pnpm lint)'      env TURBO_FORCE=1 pnpm lint      || li=$?
  one  8 build     'build      (TURBO_FORCE=1 pnpm build)'     env TURBO_FORCE=1 pnpm build     || bu=$?
  one 60 vitest    'vitest     (pnpm test = vitest run)'       pnpm test                        || vi=$?

  echo
  echo "════════ 總表(這四個 rc 各屬各自的命令)════════"
  summary_table "$tc" "$li" "$bu" "$vi"
  echo "🔴 上面每一項的 \`Cached:\` 行請自己看,本腳本不替你下結論。"
  # 有紅才印這一段。它指的是【上面各項自己印過的】完整輸出路徑,
  # 🔴 而它存在的理由是:那行路徑很容易在 grep / 複製回報時被濾掉,而它是唯一能查出「誰紅」的線。
  if ! verdict "$tc" "$li" "$bu" "$vi"; then
    echo
    echo "🔴 有項目非 0。四項的【尾 N 行】都在:$(logdir_for "$MODE")"
    echo "   尾行數是裁過的,失敗的真正原因【可能不在印出來的那幾行裡】⇒ 開全檔。"
    echo "   四項各自的 log:"
    ls -t "$(logdir_for "$MODE")" 2>/dev/null | head -4 | sed "s|^|     $(logdir_for "$MODE")/|"
  fi
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
#      · ck() 自己的比對(錨點 `ck() { if [ "$2" = "$3" ]`)—— 它是全套斷言的底座,改成 true ⇒ 五格恆 PASS
#      · run-rc.sh 有沒有真的在路徑上 —— 格5 只驗檔案存在,不驗 one() 有沒有走它
#      · 總表 printf 的標籤與變數對應(錨點 `summary_table()`)—— 對調會把紅算到別項頭上(exit code 仍對,非假綠)
#    後兩者本版已補格(格6/格7);③④與 ck() 需要「拿整支去跑」才測得到,
#    而那要一個假 pnpm harness ⇒ **本版不做,明寫在這裡,不寫成已守。**
#
# 🔴 **還有一跳,本版【刻意不補格】,理由寫在這裡**:`one()` 內部呼叫 `logdir_for "$MODE"` ——
#    若有人把它改成寫死的 `logdir_for selftest`,**selftest 期間兩者同值 ⇒ 每一格照樣綠**,
#    而真四綠 run 會落進 `selftest-…` 目錄(稽核假陰性)。
#    要守它只能在 selftest 裡【真的用 run 模式跑一發 one()】,而那會在 repo 裡生一個
#    「真 run 形狀、裡面只有一支測試 log」的目錄 —— **那正是格10 要防的假陽性本人**。
#    ⇒ 補這個格會製造它要防的東西。**列出來,不假裝已守。**
selftest() {
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  # 🔴 呼叫端的變數【不能叫 rc】—— POSIX sh 沒有 local,one() 內部的 rc 是同一個全域。
  #    叫 rc 的話:刪掉 one() 的 `return "$rc"` ⇒ 格1 讀回的是 one() 自己剛寫進去的 13
  #    ⇒ 恆綠。這正是 code-reviewer 2026-08-17 用單行突變打出來的洞。
  # 格1 [負測]:one() 必須把被跑命令的非 0 rc 傳回來,不得吞掉
  got=0; one 3 selftest '自測-必失敗' sh -c 'exit 13' >/dev/null 2>&1 || got=$?
  ck "格1 one() 透傳失敗 rc" "$got" "13"

  # 格2 [正測]:成功時要回 0(否則格1 可能只是「永遠非 0」)
  got=0; one 3 selftest '自測-必成功' true >/dev/null 2>&1 || got=$?
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
  #     判準取 run-rc.sh 自己印的分隔線;把 one() 裡的 `sh "$RUNRC" "$n" --` 拿掉就會消失。
  one 3 selftest '自測-有沒有走 run-rc' true 2>&1 | grep -q 'exit code' && r=yes || r=no
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

  # 格8~格11:log 目錄命名 —— 釘的是【不覆寫】與【selftest 不冒充四綠 run】。
  # 🔴 上一版被 R1 對抗審查打掉,兩個洞都值得留在這裡:
  #    ① 格8 與格9 原本是【各自獨立的 case】⇒ 把格8 的比對改成「永遠 yes」,
  #      格9 碰不到它、照樣 PASS,合計仍 15/15。**負向對照必須跟正向共用同一支比對函式**,
  #      否則它對照的是另一個東西(= 本檔 `summary_table()` 上方那句「不要把答案抄進考卷」;
#      🔴 這裡原本寫的是行號 `:128`,而本片讓檔案長了二十幾行 ⇒ 自指行號會自己過期,改用文字錨點)。
  #    ② 格8 在【非 git 目錄】恆綠:`HEADHASH` 塌成 `nogit`、路徑也是 `nogit-…`,兩邊一起塌就自動吻合
  #      ⇒ 目錄裡一個 hash 都沒有而格8 印 PASS。⇒ 格8-0 先擋住那個世界。
  # 🔴 格8~13 全部餵【`logdir_for()` 算出來的真路徑】,不餵中間變數 ——
  #    R2 打掉的 F-1 就是這個形狀:格11 原本量 `$STAMP`,而把 PID 剝在 `runstamp_for()` 裡
  #    ⇒ 19/19 全綠而目錄退回秒解析度。**量中間值 = 量了旁邊那個。**
  in_stamp() { case "$1" in *"$2"*) echo yes ;; *) echo no ;; esac; }

  [ "$HEADHASH" = nogit ] && r=no || r=yes
  ck "格8-0 取得到真的 tip 短 hash(不是塌成 nogit)" "$r" "yes"
  ck "格8 真四綠 run 的目錄帶 tip 短 hash($HEADHASH)" \
     "$(in_stamp "$(logdir_for run)" "$HEADHASH")" "yes"
  ck "格9 [負向對照] 假 hash 不得命中(證格8 不是恆真)" \
     "$(in_stamp "$(logdir_for run)" 'zzzzzzz-not-a-hash')" "no"
  ck "格10 selftest 目錄【不得】帶 tip hash(否則稽核假陽性)" \
     "$(in_stamp "$(logdir_for selftest)" "$HEADHASH")" "no"
  ck "格11 真 run 目錄帶 PID(同秒兩次呼叫不得撞同一個)" \
     "$(in_stamp "$(logdir_for run)" "-$$")" "yes"
  [ "$(logdir_for run)" = "$(logdir_for selftest)" ] && r=same || r=diff
  ck "格12 run 與 selftest 兩種目錄名不得相同" "$r" "diff"
  # 格13:🔴 檔頭 `:34` 宣稱的整個目的是「落在 repo 內、不落系統暫存區」,而在 R2 之前
  #   **那件事零守門** —— 把路徑改成 `/tmp/…` ⇒ 前面每一格照樣綠(R2 F-7 實測)。
  ck "格13 log 落在 repo 內的 logs/four-greens/ 底下" \
     "$(in_stamp "$(logdir_for run)" "$(pwd)/logs/four-greens/")" "yes"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') four_greens ;;
  *) echo "用法: sh scripts/dev-four-greens.sh [--selftest]" >&2; exit 2 ;;
esac
