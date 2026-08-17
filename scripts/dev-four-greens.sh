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
# 🔴 在 cd 之前把自己的絕對路徑存起來 —— 格19 要 grep 本檔,而 cd 之後 `$0` 這個相對路徑
#    只有「從 repo 根呼叫」那一種情況還解得開,其餘全解不開 ⇒ 那格會變成假紅。
# 🔴 `CDPATH=` 不可省(codex R1 F6 實測):使用者環境若有 `CDPATH=.`,`cd` 會把它解到的路徑
#    印到 stdout ⇒ 這個 command substitution 收到【兩行】⇒ SELF 變成一個含換行的爛路徑。
#    下面那個 cd 同理 —— 它壞掉整支腳本就跑錯目錄,而畫面上不會有任何一行字說它跑錯了。
SELF="$(CDPATH= cd "$(dirname "$0")" && pwd)/$(basename "$0")"
CDPATH= cd "$(dirname "$0")/.."
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
  # 🔴 `RUNRC_FULL_LOG` 把【完整輸出】留在 repo 內的 logs/ ——
  #    在此之前它只在 run-rc 的 mktemp(/var/folders),**macOS 會清掉它**。
  #    實錘(2026-08-17 V 窗量的):`31fa9b7e` 共 400 行只留 60、`da395345` 共 594 行只留 60
  #    ⇒ 失敗清單有 400 行的那天,尾 60 行【正好存不到需要的那一段】。
  #    ⚠️ 環境變數掛在【外部命令 `sh`】前面,不是掛在函式上 —— 掛函式上 /bin/sh 會殘留(本檔 R2 實測)。
  RUNRC_FULL_LOG="$d/$slug.full.log" sh "$RUNRC" "$n" -- "$@" > "$d/$slug.log" 2>&1 || rc=$?
  cat "$d/$slug.log"
  return "$rc"
}

four_greens() {
  FP_START="$(tree_fingerprint)"
  T_START="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  VITEST_START="$(count_vitest)"
  LOAD_START="$(load_avg_now)"
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
  BUILD_START="$(count_build)"
  trap 'mark_end build' EXIT
  trap 'mark_end build; trap - INT; kill -INT $$' INT
  trap 'mark_end build; trap - TERM; kill -TERM $$' TERM
  mark_begin build
  one  8 build     'build      (TURBO_FORCE=1 pnpm build)'     env TURBO_FORCE=1 pnpm build     || bu=$?
  mark_end build
  trap - EXIT INT TERM
  # 🔴 第三個取樣點,而它是三個裡最有用的那個:**我的 vitest 正要開始的那一刻,別人有幾支在跑**。
  #    「開始」那個是兩分鐘前(typecheck 之前)、「結束」那個是我的 vitest 已經跑完之後
  #    ⇒ 兩個都**不在** vitest 真正跑的那段時間裡。實測 2026-08-17 19:10 那一發:開始 0 / 結束 0。
  VITEST_PRE="$(count_vitest)"
  BUILD_PRE="$(count_build)"      # 🔴 同一刻的 build 並行數 —— 它與 vitest 搶同一批 CPU
  LOAD_PRE="$(load_avg_now)"      # 🔴 這一個才答得出「機器有多忙」（並行數答的是別的問題）
  # 🔴 標記檔只在【真的在跑 vitest】那一段存在 —— 開在這一行之前、關在之後。
  #    trap 是為了 Ctrl-C；正常路徑靠下一行的 vitest_mark_end。
  # 🔴 codex R1 F3:訊號 trap 只刪檔【不退出】的話,收到 TERM 之後腳本會繼續跑,
  #    而標記已經沒了 ⇒ 「還在跑卻沒有標記」。⇒ 訊號路徑清完要把原訊號再送一次。
  # 🔴 取樣器與標記檔【掛同一組 trap】—— 分開掛的話,少改一處就會留下一支
  #    永遠在跑的背景迴圈,而它沒有任何輸出 ⇒ 看起來完全正常。
  # 🔴 順序:trap 先掛,取樣器後起 —— 反過來的話,那兩行之間收到訊號,取樣器就活下來了。
  #    (reviewer 打的:我原本寫在 trap 之前。移動成本是零,而漏掉的代價是一支永遠在跑的迴圈。)
  trap 'runq_stop; mark_end vitest' EXIT
  trap 'runq_stop; mark_end vitest; trap - INT; kill -INT $$' INT
  trap 'runq_stop; mark_end vitest; trap - TERM; kill -TERM $$' TERM
  runq_start "$(logdir_for "$MODE")/runq.samples"
  mark_begin vitest
  one 60 vitest    'vitest     (pnpm test = vitest run)'       pnpm test                        || vi=$?
  mark_end vitest
  runq_stop
  trap - EXIT INT TERM
  # 🔴 分診【事後只讀 log】—— 不重跑、不影響那一發的結果。
  {
    triage_vitest_log "$(logdir_for "$MODE")/vitest.full.log"
    echo "vite 快取 mtime: $(vite_cache_age)"
  } > "$(logdir_for "$MODE")/TRIAGE" 2>/dev/null || true

  echo
  echo "════════ 總表(這四個 rc 各屬各自的命令)════════"
  summary_table "$tc" "$li" "$bu" "$vi"
  echo "🔴 上面每一項的 \`Cached:\` 行請自己看,本腳本不替你下結論。"
  # 有紅才印這一段。它指的是【上面各項自己印過的】完整輸出路徑,
  # 🔴 而它存在的理由是:那行路徑很容易在 grep / 複製回報時被濾掉,而它是唯一能查出「誰紅」的線。
  if ! verdict "$tc" "$li" "$bu" "$vi"; then
    echo
    # 🔴 紅的時候【第一眼】就要看到並行數(V 窗:它原本只在 RUN-CONTEXT 檔尾,
    #    而看紅的人先看的是失敗清單、看完就去改 code 了)。
    #    `#618` 那族隨機紅的判別靠這個數,放在這裡的成本是三行,漏掉的成本是一筆樣本。
    # 🔴 codex R1 F5:「結束」只取樣【一次】—— 印在畫面上的那個數與存進 RUN-CONTEXT 的
    #    必須是同一個值,否則別窗在這兩次取樣之間起停一發,螢幕與檔案就互相矛盾,
    #    而那是最難查的一種:兩邊都「有紀錄」。
    VITEST_END="$(count_vitest)"
    concurrency_note "$VITEST_START" "$VITEST_PRE" "$VITEST_END"
    echo "🔴 有項目非 0。四項的【尾 N 行】都在:$(logdir_for "$MODE")"
    echo "   尾行數是裁過的,失敗的真正原因【可能不在印出來的那幾行裡】⇒ 開全檔。"
    echo "   四項各自的 log:"
    ls -t "$(logdir_for "$MODE")" 2>/dev/null | head -4 | sed "s|^|     $(logdir_for "$MODE")/|"
  fi
  dr=0
  drift_report "$FP_START" "$(tree_fingerprint)" "$(logdir_for "$MODE")" || dr=$?
  [ -n "${VITEST_END:-}" ] || VITEST_END="$(count_vitest)"   # 全綠那條路沒經過上面 ⇒ 這裡才取樣
  run_context "$T_START" "$VITEST_START" "$VITEST_PRE" "$VITEST_END" "$(logdir_for "$MODE")" \
    "$BUILD_START" "$BUILD_PRE" "$tc" "$li" "$bu" "$vi" \
    "$LOAD_START" "$LOAD_PRE" "$(load_avg_now)"
  # 🔴 DRIFT 要能【擋住下一個動作】,否則它什麼也買不到(V 窗 R3-3)。
  #    在此之前:警告印在會滾走的輸出裡、檔落在沒人查的目錄裡,而收割照收、四綠照綠 ——
  #    **沒有任何一條判準會因為 DRIFT 存在而停。** 那不是品質問題,是它現在買不到東西。
  #    ⇒ 給它一個【和「有項目紅」分得開的】exit code:3。
  #      `sh scripts/dev-four-greens.sh && git merge …` 這種寫法會當場停住。
  # 🔴 DRIFT 壓過四項的綠紅,理由:漂移的那一發,綠和紅【兩個都不可信】,不是只有綠不可信。
  if [ "$dr" != 0 ]; then
    echo "🔴 rc=3 = DRIFT ⇒ 這一發不算數(即使上面四項全綠)。重跑一次。"
    echo "   (rc=1 才是「四項裡有紅」;兩者刻意分開,呼叫端要分得出來。)"
    return 3
  fi
  verdict "$tc" "$li" "$bu" "$vi"
}

# ── 跑這一發的【外在條件】,跟結果存在同一個地方 ──────────────────────────
# 病:`#618` 的 vitest 隨機紅,現在只能事後靠 `uptime` 猜「是不是七個窗同時在跑測試」——
#     而前一任自己標了「負載掉下來所以綠了是**相關不是因果**,沒有做控制實驗」。
# ⇒ 每一發記下【並行 vitest 行程數】與【起訖時戳】,下一次紅**自己就帶著答案**。
# 🔴 為什麼記行程數而不是只記 Duration:Duration **部分內生** —— timeout 自己會把時間拉長
#    ⇒ 慢可能是果不是因。並行行程數是**外生**的,這是它比 Duration 值錢的地方。
# ⚠️ 它記的是**開始與結束兩個時點**的瞬時值,不是期間的最大值 ——
#    中間衝上去又掉下來,這兩個數看不到。要看得到得改成持續取樣,不在本片範圍。
run_context() {
  rx_start=$1; rx_v0=$2; rx_vpre=$3; rx_v1=$4; rx_dir=$5; rx_b0=$6; rx_bpre=$7
  rx_tc=$8; rx_li=$9; shift 9; rx_bu=$1; rx_vi=$2; rx_l0=$3; rx_lpre=$4; rx_lend=$5
  # 🔴 絕對路徑閘 —— 這不是防禦性程式設計潔癖,是**今晚真的發生過**:
  #    我在改這支函式的參數個數時,呼叫端與函式體有一瞬間對不上(4 個 vs 5 個)
  #    ⇒ `rx_dir` 收到的是 `"7"`(某個並行行程數)⇒ **selftest 在 repo 根目錄生了一個 `7/` 目錄**,
  #      裡面躺著一支 `RUN-CONTEXT`,而 **selftest 印的是 34/34 全綠**。
  #    shell 沒有參數個數檢查,參數錯位**不會有任何東西叫** —— 只會安靜地寫到別的地方去。
  #    ⇒ 這個閘把「寫到我沒指定的地方」變成 fail-loud。`logdir_for()` 一定回絕對路徑,不會誤擋。
  case "$rx_dir" in
    /*) ;;
    *) echo "🔴 run_context:目錄必須是絕對路徑,收到「$rx_dir」(參數錯位?)" >&2; return 2 ;;
  esac
  mkdir -p "$rx_dir"
  {
    printf '開始 %s\n結束 %s\n' "$rx_start" "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf '全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=%s vitest起跑前=%s 結束=%s\n' "$rx_v0" "$rx_vpre" "$rx_v1"
    printf '全樹並行四綠build數(不含自己;2026-08-18 起跨工作樹) 開始=%s vitest起跑前=%s\n' "$rx_b0" "$rx_bpre"
    # 🔴 rc 也寫進來 —— 不是多餘的:沒有它,任何要做「並行數 × 紅綠」統計的人
    #    都得去 parse `run-rc.sh` 印的那句中文(`rc=0 ✅（…）`)⇒ 統計工具就綁死在那句措辭上,
    #    措辭一改、統計靜默失準。**把結論放在跟條件同一個檔裡,兩者一起被讀到。**
    printf 'rc typecheck=%s lint=%s build=%s vitest=%s\n' "$rx_tc" "$rx_li" "$rx_bu" "$rx_vi"
    # 🔴 兩條限定跟著欄位一起寫進檔案 —— 檔頭那一格今晚剛證明擋不住誤讀。
    printf 'load average(1m 5m 15m) 開始=[%s] vitest起跑前=[%s] 結束=[%s]\n' \
      "$rx_l0" "$rx_lpre" "$rx_lend"
    printf '  ⚠️ load 是過去 1/5/15 分鐘的【平均】不是當下 ⇒ 答「這段期間忙不忙」，答不了「逾時那一秒忙不忙」\n'
    printf '  🔴 #608「load 高 ⇒ 撞 5000ms」假說【已被推翻】⇒ 記錄這個值【不等於】復活那個假說\n'
    printf '  🔴 而【並行數那兩欄答的是「有幾個窗在跑四綠」，不是「機器有多忙」】—— 兩者曾被當成同一件事用過\n'
    # 🔴 兩條限定同樣寫在【欄位旁邊】,不放檔頭。
    printf 'vitest 期間 run queue(狀態 R 的行程數，0.5 秒取一發，OS=%s) %s\n' \
      "$(uname -s 2>/dev/null || echo 未知)" "$(runq_summary "$rx_dir/runq.samples")"
    printf '  🔴 這一欄是【瞬時值的分佈】不是平均 ⇒ 它是四個欄位裡最接近「逾時那一秒忙不忙」的\n'
    printf '  ⚠️ 但 0.5 秒是【快照】：比它短的尖峰看不到 ⇒【最大值是下界，不是真最大】\n'
    printf '  ⚠️ 這個數【含本發 vitest 自己的 worker】與取樣器自己 ⇒ 答得出「這台機器多忙」，答不出「別人多忙」\n'
    printf '  ⚠️ macOS 與 Linux 尺規不同(Linux 閒置約 1-3、macOS 動輒數十)⇒【跨機器不可比】\n'
    printf '  ⚠️ n<20 時 p95 恆等於最大 —— 那不是兩個獨立的數，別當成兩個證據\n'
    printf '  ⚠️ 取樣器自己的 ps/grep 每發也被數進去(1-2)⇒ 底噪不是 0\n'
    printf '  🔴🔴 上面那兩欄【並行數】的射程,2026-08-18 修過一次 —— 引用前先看是哪一版產的\n'
    printf '     ~~舊~~ 標記檔落在自己這棵工作樹，而「其他窗」在別棵樹 ⇒ 那兩欄【構造上必然是 0】\n'
    printf '     ✅ 現行 標記檔在 git common dir 的共用點 ⇒ 【真的跨工作樹看得到】(本檔 :570-571)\n'
    printf '     🔴 新射程:只看得到也跑【新版腳本】的窗;跑舊 checkout 的窗仍寫舊路徑、對它隱形\n'
    printf '        ⚠️ 有幾個窗跑新版 = runtime fleet 狀態,腳本讀不到 ⇒【未確認】\n'
    printf '     🔴🔴 本檔【就是新版產的】⇒ 上面那兩欄的 0 是【量到的】,不是構造上必然\n'
    printf '        而 2026-08-18 修正之前產的 RUN-CONTEXT,那兩欄的 0 是構造上必然\n'
    printf '        ⇒ 兩者不可混在同一張表裡數(context-table 已隔離成「舊尺」不進四格)\n'
    printf '     ✅ 本欄(run queue)不同：ps -A 是全機，當場驗過看得到 5 棵不同工作樹的行程\n'
  } > "$rx_dir/RUN-CONTEXT"
  echo
  echo "───── 這一發跑在什麼條件下(給三週後查因果的人)─────"
  echo "起訖              : $rx_start → $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "全樹並行四綠 vitest 數(不含自己;跨工作樹): 開始 $rx_v0 / 【我的 vitest 起跑前 $rx_vpre】/ 結束 $rx_v1"
  echo "全樹並行四綠 build  數(不含自己;跨工作樹): 開始 $rx_b0 / 【我的 vitest 起跑前 $rx_bpre】"
  echo "                    ⚠️ build 這一欄是【把儀器補完整】,不是已有證據指向 build。"
  echo "機器負載 load average(1m 5m 15m):"
  echo "  開始 [$rx_l0] / 【我的 vitest 起跑前 $rx_lpre】/ 結束 [$rx_lend]"
  echo "  🔴 這一欄才答得出「機器有多忙」;上面那兩欄答的是「有幾個窗在跑四綠」。"
  echo "  ⚠️ 它是過去 1/5/15 分鐘的平均、不是當下;而 #608 那個 load 假說【已被推翻】,"
  echo "     記錄這個值不等於復活它。"
  echo "vitest 期間 run queue(狀態 R 的行程數,0.5 秒取一發,OS=$(uname -s 2>/dev/null || echo 未知)):"
  echo "  $(runq_summary "$rx_dir/runq.samples")"
  echo "  🔴 這一欄是【瞬時值的分佈】不是平均 —— 四個欄位裡它最接近「逾時那一秒忙不忙」。"
  echo "     load average 答的是「這段期間」。"
  echo "  🔴🔴 上面那兩欄【並行數】2026-08-18 被 I 窗證實射程比欄位名窄很多,**而當天已修**:"
  echo "     ~~舊行為~~ 標記檔在 \$(pwd)/logs/four-greens/.running ⇒ 落在【自己這棵工作樹】,"
  echo "     而「其他窗」照定義在別棵樹 ⇒ 那兩欄【構造上必然是 0】,不是量到閒。"
  echo "     ✅ 現行 標記檔改到 \$(git rev-parse --git-common-dir)/pcm-four-greens-running"
  echo "        ⇒ 全 worktree 共用一個位置 ⇒ 那兩欄【真的跨工作樹看得到】(見本檔 :570-571)。"
  echo "     🔴 而新射程不是零:**只看得到也跑【新版腳本】的窗** —— 跑舊 checkout 的窗"
  echo "        仍寫舊的 per-worktree 路徑,對新 counter 隱形。"
  echo "        ⚠️ 「現在有幾個窗跑新版」是 runtime fleet 狀態,腳本讀不到 ⇒ **標未確認**。"
  echo "     🔴🔴 給【引用舊 RUN-CONTEXT 的人】:2026-08-18 修正之前產生的那兩欄,"
  echo "        它的 0 是【構造上必然】;之後產生的,0 是【量到的】。"
  echo "        **兩者不可混在同一張表裡數** —— scripts/four-greens-context-table.sh"
  echo "        已把舊格式隔離成「舊尺(看不見別樹)」、不進四格、不補 0。"
  echo "     ⇒ 本欄(run queue)與那兩欄仍是不同的東西,不可互相佐證。"
  echo "     ✅ 對照:本欄用 ps -A ⇒ 全機,當場驗過看得到 5 棵不同工作樹的行程。"
  echo "  ⚠️ 但 0.5 秒是快照,比它短的尖峰看不到 ⇒【最大值是下界】,不是真最大。"
  echo "  ⚠️ 它含本發 vitest 自己的 worker ⇒ 答「這台機器多忙」,答不出「別人多忙」;跨機器不可比。"
  echo "  ⚠️ n 小的時候看【最大值】,中位數會把尖峰抹掉;而 n<20 時 p95 恆等於最大(不是兩個獨立的數)。"
  echo "                    🔴 中間那個才是判「我的 vitest 跟誰擠在一起」的那個數。"
  echo "                    (痕跡同時落在 $rx_dir/RUN-CONTEXT)"
}

# 紅的時候印在最前面的那三行。抽成函式【只為了讓 selftest 餵得到它】。
# 🔴 它刻意【不下結論】—— 不寫「所以是負載造成的」。`#618` 現在只有 1 筆帶並行數的樣本,
#    而一筆不是分佈。這裡只把數字擺到眼前,判斷留給累積夠多樣本之後。
concurrency_note() {
  echo "🔴 這一發跑的時候,【還有幾個窗在跑四綠的 vitest】(不含自己):開始 $1 / 【我起跑前 $2】/ 結束 $3"
  echo "   中間那個是判 #618 那族隨機紅的那個數。若它 >0,把這一發連同 RUN-CONTEXT 存進 #618。"
  echo
}

# ── `#618` 症狀 B(module mock 失效)自動分診 ────────────────────────────
# 提案來自另一個 T 線窗(socket 32075),主視窗核可,**而下面每個數字是我自己在 25 支
# 已搶救 log 上獨立重量的**,不是採信它的回報(今晚實例 5:「儀器量的」≠「可信的」)。
#
# 🔴 **我量到的三組分離(逐檔跑,不只看數字)**:
#   18 支綠         兩個 marker 皆 0
#    6 支紅(症狀A)  兩個 marker 皆 0      ← ⚠️ 對方報 5 支，差的那支是我 21:41 那發（它的分析早於它）
#    1 支紅(症狀B)  not set=28 / createSupaseServiceClient=14
#   ⇒ **零假陽性,而【真陽性只有 1 支】。**
# ⚠️🔴 **所以這道分診的正面判別力建立在【單一樣本】上** —— 它可能認得太窄(別的 mock 失效
#   長不一樣就漏掉)。**它是候選標記器,不是分類器。** 標記為候選之後仍要人開 log 看。
#
# ⚠️ **對方建議的「第 2 件」(判斷失敗的是不是該檔【第一個執行的格】)我【沒有實作】,理由是量過的**:
#   我們的 log **不是 verbose 模式** —— 8556 格只印得出 18 行失敗符號 ⇒ **執行順序不在 log 裡**。
#   可導出的是**較弱的一件**:那一發 18 格失敗**集中度**(16 格在 `order-shipments.test.ts`、
#   2 格在 `order-keyword-search-wiring.test.tsx`)⇒ 本函式落「最集中的那支檔與其失敗格數」,
#   **不宣稱「整檔全紅」**(那需要知道該檔總格數,而 log 裡沒有)。
triage_vitest_log() {
  _log=$1
  [ -f "$_log" ] || { echo "分診: log 不存在"; return 0; }
  _ns="$(grep -c 'not set' "$_log" 2>/dev/null || true)"
  _cs="$(grep -c 'createSupabaseServiceClient' "$_log" 2>/dev/null || true)"
  _to="$(grep -c 'Test timed out in 5000ms' "$_log" 2>/dev/null || true)"
  _red="$(grep -cE 'Test Files.*failed' "$_log" 2>/dev/null || true)"
  # 最集中的那支失敗檔與其格數(可導出的那一半)
  _top="$(grep -oE 'FAIL +\|[a-z]+\| [^ ]+\.test\.tsx?' "$_log" 2>/dev/null \
          | sed 's/.*| //' | sort | uniq -c | sort -rn | head -1 | sed 's/^ *//' || true)"
  if [ "$_ns" -gt 0 ] || [ "$_cs" -gt 0 ]; then _k='🔴症狀B候選(module mock 失效)'
  elif [ "$_to" -gt 0 ];  then _k='症狀A(逾時)'
  elif [ "$_red" -gt 0 ]; then _k='🔴紅但兩類皆不符(新形狀,值得看)'
  else _k='綠'
  fi
  echo "分診: $_k"
  echo "marker: not_set=$_ns service_client=$_cs timeout=$_to"
  echo "最集中的失敗檔: ${_top:-無}"
}

# ── 機器負載(`load average`)—— 2026-08-17 23:1x 主視窗裁定加 ─────────────
# 🔴 **加它的理由不是「想要更多資料」,是【現有欄位會讓人得出反向結論】**:
#    同一晚兩發紅,`其他窗四綠vitest並行數 = 0`,而當場 `uptime` ⇒ **load 86.27 / 113.23 / 84.47**。
#    ⇒ 那個 `0` 答的是「有幾個窗在跑四綠」,**不是「機器有多忙」**,而兩者被當成同一件事用過
#      —— **主視窗據此對 Sean 說過「負載假說被推翻」,而那是錯的口徑**(它已去更正)。
#    🔴 **而射程限定當時就寫在欄位名裡(`其他窗四綠vitest並行數`),兩個人都讀了、兩個人都誤讀**
#       ⇒ **「寫下來」在這一格上失效過一次。** 所以下面兩條限定寫在【欄位旁邊】,不放檔頭。
#
# 為什麼是 `load average` 而不是「瞬時 CPU」:先前判「瞬時 CPU 不加」的理由是
# **「要取樣不是取點,成本跳一級」** —— 而**那個理由對 `load average` 不成立**:
# 它**本身就是平均**,一次 `uptime` 就有。**不是改變主意,是原本的理由不適用於這個東西。**
#
# ⚠️⚠️ **兩條限定(照主視窗指定,一個字不少;而它們會跟著欄位一起印出去)**:
#   ① 🔴 `#608` 的「load 高 ⇒ 撞 5000ms」假說**已被推翻**
#      ⇒ **記錄那個值【不等於】復活那個假說。**
#   ② `load average` 是**過去 1/5/15 分鐘的平均、不是當下**
#      ⇒ 它答「這段期間忙不忙」,**答不了「我這一格逾時的那一秒忙不忙」**。
#
# 🔴 **雙向驗為什麼【不是】用「造負載看它動」做成格子(當場實測的理由,不是偷懶)**:
#    造 4 個燒 CPU 的行程、8 秒後 1 分鐘平均 `29.92 → 32.01`
#    ⇒ **那個 +2.09 與機器自己的衰減分不開**(同一時段它正從 86 掉下來)
#    ⇒ **1 分鐘平均的時間常數 ~60 秒,selftest 等不起,而等得起也分不乾淨。**
#    ⇒ **所以格子測【解析器】(純函式、餵構造好的字串,兩個世界都能造);
#       而「它會不會隨負載動」用【真實事件】背書,不用合成測試**:
#         C 窗 21:56 靜默前 `16.92` → 跑完 `68.80`;本窗 23:11 `86.27` → 23:14 `29.92`
#       ⇒ 它確實會動,而那是 OS 的性質,不是本檔的程式碼需要驗的東西。
# ✅ **附帶一個它比並行數可信的理由**:`load average` **不需要任何人記得任何事**
#    (不像標記檔要 begin/end 配對),而且它**不區分是誰造成的負載** —— 那正是我們要的。
parse_load_avg() {
  # macOS: `load averages: 1.23 4.56 7.89` / Linux: `load average: 1.23, 4.56, 7.89`
  _l="$(printf '%s' "$1" | sed -n 's/.*load average[s]*: *//p' | tr -d ',' \
        | awk '{ if (NF >= 3) printf "%s %s %s", $1, $2, $3 }')"
  # 🔴 解析不出來就明說,**不印 0** —— 0 會讓「沒量到」長得像「機器很閒」,
  #    而那是本檔今晚一直在修的那個病。
  [ -n "$_l" ] && echo "$_l" || echo "讀不到"
}
load_avg_now() { parse_load_avg "$(uptime 2>/dev/null)"; }

# ── 瞬時 run queue 取樣(2026-08-18 T 線加;主視窗裁定「做」)────────────────
# 補的是本檔第 225 行自己寫下的那個缺口:
#   「它記的是開始與結束兩個時點的瞬時值,不是期間的最大值 —— 中間衝上去又掉下來,
#     這兩個數看不到。要看得到得改成持續取樣,不在本片範圍。」
#
# 🔴 為什麼不是 `ps -o %cpu`:**macOS 的 `%cpu` 是該行程【生涯平均】,不是當下**
#    ⇒ 拿它當「瞬時」正是本檔一直在修的那個病(量到的東西不是宣稱的東西)。
# 🔴 為什麼不是 `top -l 2`:當場量過 `/usr/bin/time -p top -l 2 -n 0 -s 1` ⇒ real 3.79s
#    (單發,量於 2026-08-18 00:2x、該機 load≈220)。一發要 3.8 秒
#    ⇒ 取樣間隔被工具本身決定,而不是被我們要的解析度決定。
# ✅ 選 run queue 深度:`ps -A -o state=` 裡狀態為 `R` 的【行程】數。
#    🔴 是【行程】不是執行緒 —— `ps -A` 不列執行緒(要列得加 `-M`/`-L`)。
#       單位標錯的話,讀者會拿它跟核心數之類的東西比,而那是另一個量。
#    成本當場量 `real 0.03`(單發,同上機器狀態)⇒ 夠便宜到 0.5 秒取一發;
#    而它是**真瞬時**的快照,不是任何時間窗的平均。
#
# 雙向表演(2026-08-18 當場跑,不是推的)——🔴 **結論只到「方向」,不到「量值」**:
#   基準(未另造負載),連取 5 發   ⇒ 76 72 66 73 72
#   同時造 16 個燒 CPU 的行程     ⇒ 124 121 113 117 125 119
#   ⚠️ 而「基準」那一組**不是一台閒置機器** —— 當時全陣八個窗在跑,uptime load≈78。
#      16 個行程只換到 +48 而不是 +16 ⇒ **這一組證得了「它會隨負載動」這個方向,
#      證不了「動多少」**。要量值得在一台安靜的機器上重做,本窗沒有那個環境。
#   ✅ 但方向這件事它證得很硬:**一發之內就反應**。
#      (對照:`load average` 造 4 個行程 8 秒後 1 分鐘平均只從 29.92 動到 32.01,
#       且與同時段的自然衰減分不開 —— 那正是本檔 §load 段落當初拒絕用它驗的理由。
#       瞬時量沒有那個問題,所以這一項【驗得起來】而 load average 驗不起來。)
#
# 🔴 這把尺的三個射程,寫在這裡也寫在欄位旁邊:
#   ① **0.5 秒是快照不是連續紀錄** ⇒ 比取樣間隔短的尖峰(例如 300ms)完全看不到
#      ⇒ 「最大值」是**下界**,不是真最大。它「有機會抓到」尖峰,不是「保證抓到」。
#   ② **這個數含本發 vitest 自己的 worker**,也含取樣器自己那 1-2 個 ps/grep
#      ⇒ 它答的是「這台機器多忙」,**答不出「別人有多忙」**。兩發相比的差,
#        可能整個來自自己的 worker 數,而讀者很容易讀成「那次別人比較忙」。
#   ③ **macOS 與 Linux 不同尺規**:Linux 的 state 只印單字元、閒置機約 1-3;
#      macOS 動輒數十 ⇒ **跨機器不可比**,而 RUN-CONTEXT 正是要被跨機跨三週引用的那份。
#   ④ 儀器本身有成本:每 0.5 秒兩個 fork,約一核的 6% ⇒ 它對被量的東西有非零貢獻。
#   ⑤ 🔴 **它沒有保護的那一半,明寫在這裡**:看門狗擋得住「父死了子還在」,
#      **擋不住「單一發 `ps` 自己卡住」** —— 後者沒有任何保護。
#      不寫的話下一個人會以為看門狗涵蓋全部,而 2026-08-18 凌晨主視窗清掉的那五隻失控程序
#      裡有四隻正是「一發 `uptime` 自己卡死」,各 90% CPU、跑了 1 小時 39 分。
#      不加超時是當下的裁量(macOS 無現成 `timeout`,自己刻會讓這把尺變複雜,
#      而最貴的後果 —— 孤兒永久跑 —— 已被看門狗關掉),**不是沒想到**。
#
# 🔴 部署風險寫在這裡,因為我自己踩了一次:寫這段時我用一條會逾時被砍的命令造尖峰,
#    差一點留下 16 個燒 CPU 的行程在機器上(當場 `pgrep -x yes` 確認 0 才收手)。
#    ⇒ **取樣器是背景迴圈,一定要掛在 trap 上**;漏掉的話,一次 Ctrl-C 就留下一支
#      永遠在跑的迴圈,而它**看起來完全正常**(沒有輸出、沒有錯誤)。
# 🔴 `ps` 壞掉時不可以吐 `0` —— 直接 `ps … | grep -c` 的話,`ps` 失敗會讓 grep 收到空輸入
#    而印出字面 `0`,寫進樣本檔就跟「機器全閒」分不開(實測 `ps -A -o nosuchfield= | grep -c '^R'` ⇒ 0)。
#    這正是 parse_load_avg 與格29-b 在彙總層擋掉、卻曾在取樣層放行的同一個病。
#    ⇒ ps 失敗就【不寫這一發】,寧可 n 少一筆。(真的 0 幾乎不可能:ps 至少數得到自己。)
runq_now() {
  _s="$(ps -A -o state= 2>/dev/null)" || return 1
  [ -n "$_s" ] || return 1
  printf '%s\n' "$_s" | grep -c '^R'
}

runq_start() {
  RUNQ_PID=''
  # 開不了檔就放棄取樣,但**不讓四綠因此失敗** —— 這是輔助儀器,不是守門。
  : > "$1" 2>/dev/null || return 0
  # 🔴 這一行的每一段都是 reviewer 打出來的,四個獨立的「靜靜死掉」路徑:
  #   ① `|| :`      —— `grep -c` 零命中回 rc=1(ps 暫時失敗也是),而本檔跑在 `set -e` 下
  #                     ⇒ 子 shell 當場結束。實測:`sh -c 'set -e; (echo one>>f; false; echo two>>f) & wait'`
  #                     只印 one。**取樣器會在第一次「機器全閒」時死掉,而那看起來完全正常。**
  #   ② `kill -0 $$` —— trap 不是牽繩的全部:SIGHUP(關窗/斷線)、SIGQUIT、`kill -9` 都沒有 trap
  #                     ⇒ 迴圈成孤兒、永遠跑、零輸出。`$$` 在子 shell 裡仍是父 PID
  #                     ⇒ 父死它自己收攤。**trap 由此降級成保險,不是唯一那條繩。**
  #   ③ `|| sleep 1` —— 小數秒不是每個 sh 的 `sleep` 都吃(busybox 無 FANCY_SLEEP、老 Solaris)。
  #                     配上 ①之前的 `set -e`,它會死在第一發 ⇒ 樣本檔剛好 1 行
  #                     ⇒ summary 印 `n=1 最大=X`,**長得完全正常**。不是忙迴圈,是安靜截斷。
  ( while kill -0 $$ 2>/dev/null; do
      runq_now >> "$1" 2>/dev/null || :
      sleep 0.5 || sleep 1
    done ) &
  RUNQ_PID=$!
}

runq_stop() {
  [ -n "${RUNQ_PID:-}" ] || return 0
  # 🔴🔴 `|| :` 這五個字元是 R2 打出來的,而漏掉它的代價不成比例:
  #    取樣器若已經自己死了(看門狗收攤 / 被 OS 殺),`kill` 回 rc=1,而本檔跑在 `set -e` 下
  #    ⇒ **整支腳本當場結束在這一行** —— 而這一行的下游正是 summary_table / TRIAGE /
  #      drift_report / run_context ⇒ **整份報告不見**,且退出碼 rc=1 與「四項裡有紅」
  #      是同一個碼(本檔開頭自己標過這個碰撞)⇒ 看的人會以為是測試紅了。
  kill "$RUNQ_PID" 2>/dev/null || :
  # wait 一下:被殺當下那個 `sleep` 子行程否則會孤兒 ≤0.5 秒(無害),
  # 順手把「PID 會不會被回收給別人」那個爭論一起關掉。
  wait "$RUNQ_PID" 2>/dev/null || :
  RUNQ_PID=''
}

# 讀樣本檔印分佈。🔴 印【最大值與分佈】不是平均 —— 平均會把尖峰抹掉,
#    而我們要找的就是尖峰(「逾時那一秒」是尾端事件,不是平均事件)。
# 🔴 沒樣本回「讀不到」不回 0(同 parse_load_avg:0 會讓「沒量到」長得像「機器很閒」)。
runq_summary() {
  _f="${1:-}"
  { [ -n "$_f" ] && [ -s "$_f" ]; } || { printf '讀不到'; return 0; }
  sort -n "$_f" 2>/dev/null | awk '
    /^[0-9]+$/ { v[++n] = $1 + 0 }
    END {
      if (n == 0) { printf "讀不到"; exit }
      # nearest-rank:索引取【天花板】不是地板。用 int() 直接截斷的話,
      # n=5 的中位會落在 v[2] 而不是 v[3] —— selftest 格29-a 當場抓到過這個 off-by-one。
      i95 = int(n * 0.95); if (i95 < n * 0.95) i95++; if (i95 < 1) i95 = 1
      i50 = int(n * 0.50); if (i50 < n * 0.50) i50++; if (i50 < 1) i50 = 1
      printf "n=%d 最大=%d p95=%d 中位=%d 最小=%d", n, v[n], v[i95], v[i50], v[1]
    }'
}

# 快取年齡 —— 對方指的第 3 件之一。**刻意不掛任何假說**:
# ⚠️ 「merge 改了 .ts ⇒ 快取冷」這個直覺**已被兩發純 docs merge 的紅 run 證偽**
#    (`31fa9b7e` / `9946d24e`,對方量的)⇒ **這一欄只是捕捉當下值,不是在測那個假說。**
# 🔴 路徑是當場找過的:本樹只有 `node_modules/.vite`(其餘三個候選都不存在)。
#    不存在時明說「無此目錄」,**不印 0** —— 0 會讓「沒有快取」長得像「快取很新」。
vite_cache_age() {
  if [ -d node_modules/.vite ]; then
    stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' node_modules/.vite 2>/dev/null || echo 讀不到
  else
    echo 無此目錄
  fi
}

# 外生量:當下有幾個行程的【完整命令列】命中 <pattern>。
# 🔴 **macOS 的 `pgrep` 沒有 `-c`**(當場實測:`pgrep -c vitest` ⇒ 印 usage、rc=2)
#    ⇒ 只能 `| wc -l`。這裡接管線是對的:我要的就是 `wc` 的輸出,不是 `pgrep` 的 rc。
# 🔴 pattern 寫成 `[v]itest` 這種括號形,免得 pgrep 命中【包著它的那個 shell】自己。
count_matching() { pgrep -f "$1" 2>/dev/null | wc -l | tr -d ' '; }
# 🔴🔴 pattern 必須認【行程的身分】,不能認「命令列裡提到那個字」。
#    2026-08-17 22:0x 實測,本檔第一版用 `[v]itest` ⇒ **量到的不是 vitest 在跑,是誰的命令列提到 vitest**:
#      真的有 vitest 在跑時   舊尺 23~25   新尺 2   ← 新尺 = 真的 run 數（兩個窗各一）
#      沒有 vitest 在跑時     舊尺 ≥3      新尺 0   ← 舊尺的「地板」來自別窗的 shell 包裝
#    舊尺撈到的假命中實例(當場 `pgrep -fl` 列出來的):
#      · 別窗的 `/bin/zsh -c … grep -E "^typecheck|^lint|^build|^vitest…"`  ← grep 的 pattern 裡有那個字
#      · 別窗一支叫 `vitest-sampler.sh` 的腳本                              ← 檔名裡有那個字
#    🔴 `[v]itest` 那個括號技巧**只避開 pgrep/grep 自己**,避不開**別人命令列裡的那個字**。
#    ⇒ 認 `vitest.mjs`(runner 的進入點:`node …/vitest/vitest.mjs run`)。
#    ⚠️ 它數的是【幾個 run】不是【幾個行程】—— worker(`vitest@4.x` 那些)刻意不算,
#       當天實測一個 run 帶 ~9 個 worker,把 worker 算進來會讓這個數跟著 CPU 數浮動。
# ── 並行 vitest run 數:**不從 `ps` 數**(2026-08-17 夜,兩把字串尺連續被打掉之後的第三版)──
#
# 🔴 為什麼放棄字串比對(兩次實測,兩次都是我自己的尺):
#   第一版 `pgrep -f '[v]itest'`      ⇒ 量到的是「誰的命令列提到 vitest」
#     假命中:別窗 `grep -E "…|^vitest…"` 的 pattern、一支叫 `vitest-sampler.sh` 的腳本
#   第二版 `pgrep -f '[v]itest\.mjs'` ⇒ **仍然自我命中**。I 窗當場量到【零個真 run 而它讀到 5】:
#     3 個是它自己的 zsh(它在同一條命令裡 echo 了一段含該字面的解釋文字)
#     2 個是別窗的 codex(**prompt 文字裡有那個字面**)
#     🔴 而我自己也做過同一件事:我請 codex 審這把尺,prompt 裡就寫著那個字面。
#   ⇒ **`[x]` 那個括號技巧只避開 `grep`/`pgrep` 自己,避不開「有人正在談論它」。**
#   🔴🔴 **這把尺的地板高度 = 現在有多少人正在打字提到它**,而**討論強度在事故當天最高**
#        ⇒ 最糟的一種噪音:它與我們調查這件事的力度正相關。
#   📎 I 窗抽的判別句:**命令列是【任何人都能寫進去的字串】,而檔案系統不是。**
#      **凡是從 `ps`/`pgrep` 的命令列數東西,你數的是「誰提到過它」,不是「它在不在跑」。**
#
# ⇒ 改成:**跑 vitest 的那一段,自己在 logs/ 開一支以 PID 命名的標記檔,跑完刪掉。**
#   那不是字串比對,是**只有真的有那一發 run 才會存在的東西**。
#
# ⚠️ **射程限定(這一版換了一種瞎):只數【走這支腳本】的 run。**
#    別窗手打 `npx vitest run …` 不會有標記檔 ⇒ **算不到**。
#    ⇒ 它答的是「**還有幾個窗在跑四綠**」,不是「機器上總共有幾發 vitest」。**欄位名要照這個寫。**
# 🔴🔴 **2026-08-18 補上漏掉的那一條(它比上面那條致命,而上面那條寫了會讓人以為那就是全部)**:
#    舊版標記落在【各自的工作樹】⇒ **走這支腳本、但在別棵樹跑的也算不到**,
#    而**別棵樹正是「別的窗」的定義** ⇒ 那個欄位【每一次都報 0】。
#    ⇒ 已改成 git common dir 底下的共用點(見下方 `FOUR_GREENS_SHARED_ROOT`),
#      欄位名同步改成「**全樹並行四綠 … 數**」—— **改了行為不改名,等於留一個新的假字面。**
# 🔴🔴 **2026-08-18 修:標記檔【全樹共用一個位置】,不再各樹一份。**
#
# 病灶(I 窗當場量到,而它讓四格表整整一欄作廢):
#   舊寫法 `VITEST_MARKDIR="$(pwd)/logs/four-greens/.running"`,而 `$(pwd)` = **跑它的那棵工作樹**。
#   ⇒ 標記檔落在自己那棵樹;而「**其他窗**」照定義就在**別棵工作樹**,它們的標記落在它們自己的 `logs/`。
#   ⇒ **這個欄位看不見任何別的窗,而且每一次都會報 0。**
#   實測:`pcm-drift` 與 `pcm-website-v2` 兩份 `.running` 同時存在(全樹數 ⇒ 3),
#         而同一刻的 `RUN-CONTEXT` 逐字 `其他窗四綠vitest並行數(不含自己) 開始=0 …=0 結束=0`。
#   🔴 ⇒ **改尺之前所有的 `0` 是【構造上必然】,不是【量到的】**,而且**救不回來**
#      (四格表要把改尺前/後分開數、各自具名、不補 0)。
#
# 📎 最該帶走的:`:295-297` 的射程限定寫著「只數走這支腳本的 run;別窗手打 npx vitest 算不到」——
#   **那條是真的,而它漏了更大的一條(走這支腳本、但在別棵樹跑的也算不到)**,
#   ⇒ **寫了一條射程,會讓讀者以為那就是全部。**
#   而 `scripts/four-greens-context-table.sh:29` 早就寫著「別窗的 run 在它們自己的工作樹裡」
#   ⇒ **知道的人寫下過它,卻沒有回頭改產數字那支的欄位名 —— 兩份檔各對一半。**
#
# 🔴 共用點用 **git common dir 的隔壁**,不寫死 `/Users/sean_1/pcm-*`:
#   `git rev-parse --git-common-dir` 對**所有** worktree 都回**同一個** `.git`(主 repo 的),
#   而寫死路徑會在 repo 搬家 / 別人 clone 時靜默變成「各自一份」——**回到同一個病**。
FOUR_GREENS_SHARED_ROOT="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
VITEST_MARKDIR="$FOUR_GREENS_SHARED_ROOT/pcm-four-greens-running"

# 兩道防呆一起上(缺一就會變成另一把騙人的尺):
#   ① `trap` 刪自己那支 —— 正常結束/Ctrl-C 都清掉
#   ② 讀的時候用 `kill -0` 驗那個 PID **還活著** —— 🔴 `trap` 對 SIGKILL 與斷電無效,
#      沒有這一道,一次被 kill 的 run 會讓這個數**永遠多算 1**
# 🔴 標記檔的【內容】是那個 PID 的行程啟動時間(codex R1 F1/F2)——
#    光有 PID 不夠:PID 會被作業系統回收,一支沒清掉的死標記若號碼被別的無關行程拿到,
#    `kill -0` 會成功 ⇒ **這個數會一直多算 1,而它看起來完全正常**。
#    ⇒ 讀的時候比對「PID 還在 **而且** 啟動時間一樣」,兩者都對才算。
proc_start_of() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ *//;s/ *$//'; }

# 🔴 一種機制、兩個被量的東西(`vitest` 與 `build`)—— **刻意不複製第二份**:
#    複製出來的第二份會各自長歪(這支檔的歷史上已經發生過兩次「函式算一份、變數存一份」)。
#    `$1` = 種類(`vitest` | `build`);每一種一個子目錄。
markdir_for_kind() { echo "$VITEST_MARKDIR/$1"; }
mark_begin() { mkdir -p "$(markdir_for_kind "$1")"; proc_start_of "$$" > "$(markdir_for_kind "$1")/$$"; }
mark_end()   { rm -f "$(markdir_for_kind "$1")/$$"; }

# 🔴 欄位語意寫在函式名裡,不留給讀的人猜:**不含自己**。
count_other_runs() {
  n=0
  for f in "$(markdir_for_kind "$1")"/*; do
    [ -e "$f" ] || continue                      # glob 沒命中時的字面
    pid="$(basename "$f")"
    [ "$pid" = "$$" ] && continue                # 不算自己
    # 🔴 兩個條件都要:行程還在(ps 撈得到)**而且**啟動時間與當初記的一致(擋 PID 回收)
    if [ "$(proc_start_of "$pid")" = "$(cat "$f" 2>/dev/null)" ] && [ -n "$(proc_start_of "$pid")" ]; then
      n=$((n+1))
    else
      rm -f "$f"                                 # 死了、或那個號碼被別人拿去用了 ⇒ 清掉
    fi
  done
  echo "$n"
}
count_vitest() { count_other_runs vitest; }
# ⚠️ **`build` 這一欄新增的理由,寫在這裡免得被誤讀(主視窗指定):**
#    **它不是在追那個負載假說** —— 落筆當下四格(並行低/高 × 紅/綠)只有「低×綠」有樣本,
#    **任何為了支持假說而加的量測都會變成「找資料救假說」**。
#    ⇒ **正當理由只有一個:把儀器補完整。**
#    `RUN-CONTEXT` 原本只看得到 vitest,而 **`build` 與 vitest 搶的是同一批 CPU**,
#    它是 C 窗指的兩個候選變數之一。**加它是為了涵蓋另一個【已知的資源競爭者】,
#    不是因為已有證據指向 build。**
count_build() { count_other_runs build; }
# 🔴 「瞬時 CPU」仍然【不加】,理由不變:它要**取樣**不是取點,成本跳一級,
#    而現在連 run 數都還沒有第二格樣本。

# ── DRIFT:這一發【期間】樹有沒有被動過 ────────────────────────────────────
# 病:目錄名的 hash 是【跑之前】取的,而後段項目量的是【當下】的樹 ⇒ 兩個世界零痕跡:
#   ① 中途有人 commit ⇒ 目錄名指的樹 ≠ 實際量的樹
#   ② 髒樹跑(slice 流程本來就是先跑四綠再 commit)⇒ 目錄名 = 父 commit,量的是父 + 未提交改動
# 🔴 兩種 run 的目錄名【長得一樣】。⇒ 頭尾各取一次指紋,不同就落一支 DRIFT 標記檔。
#
# 🔴 上一版(`#620` 撤回的那份)整組的病都長在【沒有這一跳】:判定寫成 four_greens 裡的
#    一行 inline `if [ "$FP_START" != "$FP_END" ]`,格子碰不到它 ⇒ 改成 `if false` 照樣 22/22 全綠。
#    ⇒ 本版把判定與落痕跡都抽成吃【字串】的函式,格子餵構造好的指紋去打它。
drifted_between() { [ "$1" != "$2" ]; }

# 判定 + 落痕跡 + 印警告。三個參數全是字串:不自己取指紋、不自己算目錄
# ⇒ selftest 餵得到,而且靶是它自己造的暫存目錄,**不是現場的 logs/**
#   (`docs/patterns/mutation-harness-restore.md`:拿來當靶的要是你造的,不是現場的)。
# 🔴 變數名刻意不用 `d` —— one() 的 `d` 是同一個全域(POSIX sh 無 local),上一版就是這麼撞的。
drift_report() {
  dr_start=$1; dr_end=$2; dr_dir=$3
  drifted_between "$dr_start" "$dr_end" || return 0
  mkdir -p "$dr_dir"
  printf '開始 %s\n結束 %s\n' "$dr_start" "$dr_end" > "$dr_dir/DRIFT"
  echo
  echo "🔴 DRIFT:這一發【跑到一半樹被動過】 —— 目錄名指的不是它實際量的東西。"
  echo "   開始 $dr_start"
  echo "   結束 $dr_end"
  echo "   ⇒ 這一發的結果【不要拿去背書任何一顆 commit】,重跑一次。"
  echo "   痕跡落在 $dr_dir/DRIFT"
  return 3   # 🔴 呼叫端據此把整支的 rc 變成 3(V 窗 R3-3:亮了要擋得住下一個動作)
}

# 樹態指紋。三欄:HEAD + 未提交【檔案清單】的 cksum + 已追蹤【內容】的 cksum。
# 🔴 上一版第三欄是 `git status --porcelain | wc -l`(**行數**)⇒ 開跑前已髒、途中把該檔內容
#    整個換掉而行數不變 ⇒ 前後都 `dirty=1`、**零 DRIFT**,而那正是檔頭點名的「髒樹跑 = 常態」。
#    ⇒ 換成兩個 cksum:清單那欄抓「換了哪一支」,內容那欄抓「同一支裡改了什麼」。
# 🔴 三欄各自帶【失敗字面】,不可以讓 git 失敗長得像「乾淨的樹」(codex R1 F2)——
#    `git status … | cksum` 這種寫法,git 死掉時 cksum 吃到空輸入,回的是一個**固定的數**
#    (`4294967295 0`)⇒ 前後兩次都拿到同一個常數 ⇒ **DRIFT 永遠不亮,而畫面上一切正常**。
#    那正是上一版 F5 被打掉的那個病,只是換一個位置長出來。
#    ⇒ 改成先接住 git 的 rc,失敗就寫 `GITFAIL-*` 進指紋,再由格14-0 把這件事變成一格。
# ⚠️ **兩條射程限定(未守,明寫不假裝)**:
#    ① `git diff HEAD` 看不到**未追蹤檔的內容** ⇒ 只改一支未追蹤檔的內容(檔名沒變)⇒ 不亮。
#       (未追蹤檔的**增刪**看得到 —— 那是 `-uall` 那一半;看不到的是**內容**。)
#    ② **ABA**:期間被改動、收尾前又改回原狀 ⇒ 頭尾指紋相同 ⇒ 不亮(codex R1 F7)。
#       頭尾兩點取樣天生看不到中間,要看得到得改成持續監看,不在本片範圍。
# ⚠️ 它記的是「這一發【期間】樹有沒有動」,**不是**「這一發量的是哪一版」。
tree_fingerprint() {
  fp_head="$(git rev-parse HEAD 2>/dev/null)" || fp_head=nohead
  # 🔴 `-uall` 不可省(codex R2):預設 `git status --porcelain` 會把一整個未追蹤【目錄】
  #    縮成一列 `?? dir/` ⇒ 在那個目錄裡增檔刪檔,指紋一個位元都不會變。
  if fp_st="$(git status --porcelain -uall 2>/dev/null)"; then
    # 🔴 `tr ' ' '-'` 不是 `tr -d ' '`(V 窗 R3-4):`cksum` 印的是【兩個】欄位,
    #    刪空白會把「123 45」與「1234 5」黏成同一個字串 ⇒ 理論碰撞、漏亮 DRIFT。
    fp_st="$(printf '%s' "$fp_st" | cksum | tr ' ' '-')"
  else fp_st=GITFAIL-status; fi
  if fp_df="$(git diff HEAD 2>/dev/null)"; then
    fp_df="$(printf '%s' "$fp_df" | cksum | tr ' ' '-')"   # 同上,不刪空白、換成連字號
  else fp_df=GITFAIL-diff; fi
  echo "$fp_head $fp_st $fp_df"
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
  # four_greens() 的函式體,多個「釘呼叫點」的格子共用(格19/格24-b/格25-j/k)。
  # 🔴 在最前面算好 —— 它原本定義在格19 旁邊,而後來新增的格子在它【上面】⇒ 那幾格會拿到空字串
  #    ⇒ grep -c 回 0 ⇒ 假紅。(改這裡的時候撞到過一次。)
  fg_body="$(sed -n '/^four_greens() {$/,/^}$/p' "$SELF")"
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

  # ── 格14-0~格19:DRIFT ────────────────────────────────────────────────────
  # 🔴 上一版(撤回的那份)這一族有 5 條 must-fix,而**它們全部長在同一個形狀上**:
  #    格子驗的是「兩次呼叫同一支函式會不會相等」(恆真)與字串運算(不是那支函式)
  #    ⇒ 把函式換成 `echo CONSTANT`、把判定換成 `if false`,22/22 照樣全綠。
  #    ⇒ 本版一律【餵構造好的值給抽出來的函式】,而且靶是自造的拋棄式 repo / 暫存目錄。

  # 格14-0:鏡像格8-0。git 不可用時三欄會一起塌成常數 ⇒ 前後恆等 ⇒ DRIFT 恆不亮。
  #   🔴 codex R1 F1 指出上一輪只擋字面 `nohead`,任何【別的常數】照樣過這一格。
  #      —— 那半是對的,而「其餘五格全綠」不成立:突變 M3(`echo CONSTANT`)實測**格15 會紅**。
  #      本輪仍收緊這一格,理由是【每一格要能自己說出它守什麼】,不靠隔壁那格兜底。
  #   ⇒ 改成釘 HEAD 欄的形狀(40 個 hex)+ 兩個 GITFAIL 字面。
  fp_now="$(tree_fingerprint)"
  fp_h="${fp_now%% *}"
  case "$fp_h" in
    *[!0-9a-f]*) r=bad ;;
    *) [ "${#fp_h}" = 40 ] && r=ok || r=bad ;;
  esac
  #   🔴 標籤照 codex R2 收窄:它擋的是 `nohead` 與**非 hex 的**常數。
  #      一個【40 碼小寫 hex 的寫死常數】仍然過得了這一格 —— 那個世界由格15 擋(實測 M3/M7 會紅)。
  #      宣稱不可以大於事實:這一格說得出「HEAD 欄長得像 hash」,說不出「它是真的 HEAD」。
  ck "格14-0 指紋 HEAD 欄是 40 碼 hex(擋 nohead 與非 hex 常數;擋不了 hex 常數)" "$r" "ok"
  case "$fp_now" in *GITFAIL*) r=yes ;; *) r=no ;; esac
  ck "格14-1 指紋不含 GITFAIL(git 死掉不得長得像乾淨的樹)" "$r" "no"
  # 格14-2 [兩個世界]:在【非 git 目錄】跑 ⇒ 上面兩格守的東西必須真的出現,證它們不是恆真。
  #   🔴 `GIT_CEILING_DIRECTORIES` 不可省(codex R2):`mktemp -d` 只保證目錄是新的,
  #      **不保證它的祖先裡沒有 `.git`**(TMPDIR 被指到某個 worktree 底下就破功)——
  #      那樣這一格的「非 git 目錄」前提就是假的。天花板一釘,git 不會往上走。
  nogit_tmp="$(mktemp -d)"
  fp_nogit="$(cd "$nogit_tmp" && GIT_CEILING_DIRECTORIES="$nogit_tmp" tree_fingerprint)"
  rmdir "$nogit_tmp"
  case "$fp_nogit" in 'nohead '*GITFAIL*) r=yes ;; *) r=no ;; esac
  ck "格14-2 [負向對照] 非 git 目錄的指紋要自己承認(nohead + GITFAIL)" "$r" "yes"

  # 格15/16:指紋對【內容】有沒有判別力 —— 在【自造的拋棄式 repo】上跑,不動現場的樹。
  #   🔴 格15 就是上一版 F4 的「世界 C」:開跑前已髒、途中把該檔內容整個換掉、**行數不變**
  #      ⇒ 舊指紋(`wc -l`)前後同值、零 DRIFT。它同時也擋住「函式被換成常數」那個突變。
  #   🔴 `-c` 那一串是 codex R1 F5 打出來的:拋棄式 repo 會繼承使用者/CI 的 `init.templateDir`
  #      (帶 hooks)與 `commit.gpgsign` ⇒ 別台機器上這兩格會變成**環境性假紅**。
  #      🔴 codex R2 又補一刀:`--no-verify` **只跳過 pre-commit / commit-msg**,
  #         `prepare-commit-msg`、`post-commit` 照跑,而全域 `core.hooksPath` 更是繞過樣板那道。
  #         ⇒ 直接把 hooksPath 指到一個不存在的地方,才是真的沒有 hook。
  #      📌 這一段全部是在治【假紅】 —— 一格在該綠的世界誤紅,比沒有那一格更糟:
  #         它會讓下一個人以為 DRIFT 壞了,然後把整族格子關掉。
  drift_tmp="$(mktemp -d)"
  ( cd "$drift_tmp" && git -c init.templateDir= -c core.hooksPath=/dev/null init -q . \
    && printf 'AAA\n' > f.txt && git -c core.hooksPath=/dev/null add f.txt \
    && git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false \
         -c core.hooksPath=/dev/null commit -q --no-verify -m base ) >/dev/null 2>&1
  fp_a="$(cd "$drift_tmp" && printf 'XXX\n' > f.txt && tree_fingerprint)"
  fp_b="$(cd "$drift_tmp" && printf 'YYY\n' > f.txt && tree_fingerprint)"
  fp_b2="$(cd "$drift_tmp" && tree_fingerprint)"
  #   格15-b:未追蹤【目錄】裡增檔 —— 預設 `git status --porcelain` 把整個目錄縮成一列 `?? sub/`,
  #   多一支檔它一個位元都不變(codex R2)。這一格釘的就是 `-uall`。
  fp_c="$(cd "$drift_tmp" && mkdir -p sub && printf 'x\n' > sub/one.txt && tree_fingerprint)"
  fp_d="$(cd "$drift_tmp" && printf 'y\n' > sub/two.txt && tree_fingerprint)"
  rm -rf "$drift_tmp"
  [ "$fp_a" != "$fp_b" ] && r=diff || r=same
  ck "格15 [世界C] 髒樹內容被換掉而檔數不變 ⇒ 指紋必須不同" "$r" "diff"
  [ "$fp_b" = "$fp_b2" ] && r=same || r=diff
  ck "格16 [正向對照] 樹沒動 ⇒ 指紋必須相同(證格15 不是恆 diff)" "$r" "same"
  [ "$fp_c" != "$fp_d" ] && r=diff || r=same
  ck "格15-b 未追蹤目錄裡多一支檔 ⇒ 指紋必須不同(釘 -uall)" "$r" "diff"

  # 格17/18:DRIFT 判定【本體】—— 餵構造好的指紋字串,靶目錄自己造。
  #   把 drifted_between 改成 `false`(或 `true`)⇒ 兩格必有一格紅。
  dr_tmp="$(mktemp -d)"
  dr_rc=0; drift_report "same-fp" "same-fp" "$dr_tmp/nodrift" >/dev/null 2>&1 || dr_rc=$?
  [ -e "$dr_tmp/nodrift/DRIFT" ] && r=yes || r=no
  ck "格17 [正向對照] 兩個指紋相同 ⇒ 不得落 DRIFT 檔" "$r" "no"
  ck "格17-c [正向對照] 沒漂移 ⇒ drift_report 的 rc 必須是 0" "$dr_rc" "0"
  dr_rc=0; dr_out="$(drift_report "fp-開始" "fp-結束" "$dr_tmp/drift" 2>&1)" || dr_rc=$?
  ck "格18-c 有漂移 ⇒ drift_report 的 rc 必須是 3(才擋得住 && 串接)" "$dr_rc" "3"
  r="$(tr '\n' ' ' < "$dr_tmp/drift/DRIFT" 2>/dev/null || true)"
  rm -rf "$dr_tmp"
  ck "格18 兩個指紋不同 ⇒ DRIFT 檔要帶【兩個】指紋原字" "$r" "開始 fp-開始 結束 fp-結束 "
  # 格18-b:🔴 codex R1 F4 —— 格18 只驗【檔】,而人看到的是【螢幕上那段字】。
  #   把整段 echo 刪掉 ⇒ 檔還在、格18 照樣綠,而跑的人什麼都不會看到(DRIFT 又不改 rc)。
  case "$dr_out" in *DRIFT*不要拿去背書*) r=yes ;; *) r=no ;; esac
  ck "格18-b DRIFT 要印在螢幕上(檔案有痕跡不等於人看得到)" "$r" "yes"

  # 格19:釘住呼叫點 —— 格17/18 證的是那支函式會做對的事,證不到 four_greens 有沒有用它
  #   (= 上一版 F3「判定本體零守門」剩下的那一跳)。
  #   ⚠️ **這格的射程只到「原始碼裡那一行還在」**,不是「那一行執行過」——
  #      要證後者得真跑一次四綠,而那要 15-60 秒 × 4。明寫,不假裝已守。
  #   🔴 pattern 是【拼出來的】,為的是不讓本行自己命中自己(偵測字串自命中)——
  #      第一版寫成完整字面 `'^  drift_report '`,實跑得到 **3**(呼叫點 1 + 格17/18 那兩行),
  #      而那兩行同樣是兩格縮排。⇒ 改成鎖 `$FP_START`,並把字面拆成兩段接起來。
  #   🔴 而 codex R1 F3 又打掉一次:只 grep 整份檔案 ⇒ 把呼叫行從 four_greens【搬到別的函式】
  #      仍然是 1 ⇒ 照樣 PASS。⇒ 先用 sed 切出 four_greens() 的函式體,只在那一段裡數。
  #   ⚠️ **這個範圍表達式的前提(codex R2 指出,寫下來不假裝沒有)**:four_greens() 的函式體裡
  #      不能出現任何【第一欄就是 `}`】的行,否則範圍會提早收掉 ⇒ 假紅。落筆當下成立,
  #      數法 `sed -n '/^four_greens() {$/,/^}$/p' scripts/dev-four-greens.sh | grep -c '^}'` ⇒ 1(只有結尾那個)。
  anchor='^  drift_'"report \"\$FP_START\""
  r=$(printf '%s\n' "$fg_body" | grep -c "$anchor" || true)
  ck "格19 呼叫點在 four_greens() 函式體【之內】(射程=原始碼行,不證它執行過)" "$r" "1"
  # 格19-b:DRIFT 的 rc 有沒有被【接起來】—— drift_report 自己回 3(格18-c 守),
  #   而 four_greens 若不接、不 return,整支照樣 rc=0 ⇒ DRIFT 又變回買不到東西。
  #   射程同格19:只證原始碼那兩行還在。
  r=$(printf '%s\n' "$fg_body" | grep -c 'return 3' || true)
  ck "格19-b four_greens 把 DRIFT 變成 rc=3(射程=原始碼行)" "$r" "1"

  # ── 格20~格23:跑這一發的外在條件(#618 的儀器)與完整 log ────────────────
  # 格20/21 [兩個世界]:count_matching 是【外生量測】,它必須真的跟著世界動。
  #   🔴 「跑起來沒報錯」不是證據 —— 一個永遠回 0 的計數器也不會報錯,而它會讓
  #      每一發都記下「並行 0 個」,看起來完全正常。
  #   靶是我自己起的行程(帶唯一標記),不是去假裝有 vitest 在跑 —— 不污染真正的那個數。
  probe_marker="dfg-probe-$$-$(date '+%s')"
  sh -c ": $probe_marker; sleep 1" &
  probe_pid=$!
  # 忙等到看見它(不用 sleep:固定睡法在慢機器上會變成假紅)
  probe_i=0; probe_up=0
  while [ "$probe_i" -lt 200 ] && [ "$probe_up" = 0 ]; do
    probe_up="$(count_matching "$probe_marker")"; probe_i=$((probe_i+1))
  done
  ck "格20 起了一個帶標記的行程 ⇒ 計數要跟著變成 1" "$probe_up" "1"
  wait "$probe_pid" 2>/dev/null || true
  ck "格21 [負向對照] 它結束之後 ⇒ 同一把尺要回到 0(證格20 不是恆 1)" \
     "$(count_matching "$probe_marker")" "0"

  # ── 格25 系列:並行數量具(標記檔版)。四個世界,一個也不能少 ──────────────
  # 🔴 為什麼整組重寫:前兩版是字串尺,兩次都自我命中(成因寫在 count_vitest 上方)。
  #    這一版數的是**檔案**,所以它的病也換了 —— 下面四格各守一種。
  #    🔴 靶全部是【我自己造的假標記檔】,放在自己造的暫存目錄,不碰真的 .running/。
  mk_tmp="$(mktemp -d)"
  mk_saved="$VITEST_MARKDIR"; VITEST_MARKDIR="$mk_tmp/running"
  mkdir -p "$(markdir_for_kind vitest)" "$(markdir_for_kind build)"

  # 格25-a [地板]:沒有任何 run ⇒ 必須是 0。**這是前兩版最大的病(它們有地板)。**
  ck "格25-a 零個 run ⇒ 並行數必須是 0(舊版字串尺在這裡有地板)" "$(count_vitest)" "0"

  # 格25-b [單位]:兩發【獨立】的 run ⇒ 必須是 2,不是 1、也不是 worker 數。
  #   🔴 這一格是為了解掉一個真實的分歧:同一時刻我報 2、I 窗報 1,而那是字串尺量的
  #      ⇒ 誰都不知道那是「兩發 run」還是「一發兩個命中」。數檔案就沒有這個歧義。
  sh -c 'sleep 6' & mk_p1=$!
  sh -c 'sleep 6' & mk_p2=$!
  mkdir -p "$(markdir_for_kind vitest)"
  proc_start_of "$mk_p1" > "$(markdir_for_kind vitest)/$mk_p1"
  proc_start_of "$mk_p2" > "$(markdir_for_kind vitest)/$mk_p2"
  ck "格25-b 兩發獨立 run ⇒ 並行數必須是 2(單位是 run 不是行程)" "$(count_vitest)" "2"

  # 格25-c [不算自己]:欄位語意是「不含自己」⇒ 自己那支標記檔不得被算進去。
  proc_start_of "$$" > "$(markdir_for_kind vitest)/$$"
  ck "格25-c 自己那支標記檔不得算進去(欄位語意=不含自己)" "$(count_vitest)" "2"
  rm -f "$(markdir_for_kind vitest)/$$"

  # 格25-d [死掉的不算]:🔴 trap 對 SIGKILL 無效 ⇒ 沒有這一道,一次被 kill 的 run
  #   會讓這個數【永遠多算 1】。殺掉其中一個 ⇒ 必須掉回 1,而且那支檔要被順手清掉。
  kill "$mk_p1" 2>/dev/null || true
  wait "$mk_p1" 2>/dev/null || true
  ck "格25-d PID 已死的標記檔不得算進去(trap 對 SIGKILL 無效)" "$(count_vitest)" "1"
  [ -e "$(markdir_for_kind vitest)/$mk_p1" ] && r=left || r=cleaned
  ck "格25-e 而且那支死掉的標記檔要被順手清掉(否則目錄會長大)" "$r" "cleaned"
  # 格25-f [PID 回收,codex R1 F1]:標記檔的號碼指到一個【活著但無關】的行程 ⇒ 不得算。
  #   構造:拿還活著的 mk_p2 當號碼,但把內容寫成一個【不同的】啟動時間(模擬號碼被回收)。
  #   🔴 沒有這一格,光靠 kill -0 的版本會把它算進去,而那個多算【永遠不會消失】。
  echo 'Thu Jan  1 00:00:00 1970' > "$(markdir_for_kind vitest)/$mk_p2"
  ck "格25-f PID 活著但啟動時間不符(號碼被回收)⇒ 不得算進去" "$(count_vitest)" "0"
  kill "$mk_p2" 2>/dev/null || true; wait "$mk_p2" 2>/dev/null || true

  # 格25-g [lifecycle,codex R1 F7]:上面五格全是【手工造檔】⇒ 把 mark_begin/mark_end
  #   整個刪掉,那五格照樣全綠。這一格真的呼叫那兩支函式,驗檔案出現、然後消失。
  mark_begin vitest
  [ -e "$(markdir_for_kind vitest)/$$" ] && r=yes || r=no
  ck "格25-g mark_begin 真的開出標記檔" "$r" "yes"
  mk_content="$(cat "$(markdir_for_kind vitest)/$$" 2>/dev/null)"
  [ -n "$mk_content" ] && r=nonempty || r=empty
  ck "格25-h 標記檔內容不得是空的(空的話 PID 回收那道就形同虛設)" "$r" "nonempty"
  mark_end vitest
  [ -e "$(markdir_for_kind vitest)/$$" ] && r=left || r=gone
  ck "格25-i mark_end 真的把它刪掉" "$r" "gone"

  # ── 格26-a/b:build 那一半的【地板】與【單位】,與 vitest 同款不打折 ──────
  ck "格26-a 零個 build ⇒ 並行數必須是 0(地板那一格)" "$(count_build)" "0"
  sh -c 'sleep 6' & mk_b1=$!
  sh -c 'sleep 6' & mk_b2=$!
  mkdir -p "$(markdir_for_kind build)"
  proc_start_of "$mk_b1" > "$(markdir_for_kind build)/$mk_b1"
  proc_start_of "$mk_b2" > "$(markdir_for_kind build)/$mk_b2"
  ck "格26-b 兩發獨立 build ⇒ 必須是 2(單位那一格)" "$(count_build)" "2"
  # 格26-c:兩種標記【互不干擾】—— 同一支機制兩個子目錄,搞混的話兩欄會互相污染。
  ck "格26-c build 的標記不得被算進 vitest 那一欄" "$(count_vitest)" "0"
  echo 'Thu Jan  1 00:00:00 1970' > "$(markdir_for_kind build)/$mk_b2"
  ck "格26-d build 也擋 PID 回收(啟動時間不符 ⇒ 不算)" "$(count_build)" "1"
  kill "$mk_b1" "$mk_b2" 2>/dev/null || true
  wait "$mk_b1" 2>/dev/null || true; wait "$mk_b2" 2>/dev/null || true

  VITEST_MARKDIR="$mk_saved"; rm -rf "$mk_tmp"
  # 格25-j [呼叫點,codex R1 F7 的另一半]:那兩支函式有沒有真的掛在 vitest 那一項前後。
  #   射程同格19/格24-b:只證原始碼那兩行還在 four_greens() 裡。
  r=$(printf '%s\n' "$fg_body" | grep -c '^  mark_begin vitest$' || true)
  ck "格25-j mark_begin vitest 掛在 four_greens 裡(射程=原始碼行)" "$r" "1"
  r=$(printf '%s\n' "$fg_body" | grep -c '^  mark_end vitest$' || true)
  ck "格25-k mark_end vitest 也掛在裡面(射程=原始碼行)" "$r" "1"
  # 格26 系列:build 那一半 —— 與 vitest 同款,不打折。
  r=$(printf '%s\n' "$fg_body" | grep -c '^  mark_begin build$' || true)
  ck "格26-j mark_begin build 掛在 four_greens 裡(射程=原始碼行)" "$r" "1"
  r=$(printf '%s\n' "$fg_body" | grep -c '^  mark_end build$' || true)
  ck "格26-k mark_end build 也掛在裡面(射程=原始碼行)" "$r" "1"
  # 格26-l:build 的取樣點要真的餵進 run_context(不是算了不用)。
  r=$(printf '%s\n' "$fg_body" | grep -c '"\$BUILD_START" "\$BUILD_PRE"' || true)
  ck "格26-l build 那兩個值真的餵進 run_context(射程=原始碼行)" "$r" "1"

  # ── 格27 系列:症狀 B 自動分診的四個世界。餵【構造好的 log】,不去讀真的 log ────
  #   🔴 靶是我自己寫的假 log,四種各一支 —— 真 log 只有一支症狀 B,拿它當唯一測資
  #      等於「用僅有的那個正例當考卷答案」。
  tri_tmp="$(mktemp -d)"
  printf 'Test Files  514 passed (514)\n' > "$tri_tmp/green.log"
  printf 'FAIL  |admin| a/b.test.ts\nError: Test timed out in 5000ms.\nTest Files  1 failed | 513 passed\n' \
    > "$tri_tmp/symA.log"
  printf 'FAIL  |admin| a/b.test.ts\nError: NEXT_PUBLIC_SUPABASE_URL not set\n  createSupabaseServiceClient\nTest Files  1 failed\n' \
    > "$tri_tmp/symB.log"
  printf 'FAIL  |admin| a/b.test.ts\nAssertionError: nope\nTest Files  1 failed | 2 passed\n' \
    > "$tri_tmp/other.log"
  case "$(triage_vitest_log "$tri_tmp/green.log")" in *綠*) r=ok ;; *) r=bad ;; esac
  ck "格27-a 全綠 log ⇒ 判綠" "$r" "ok"
  case "$(triage_vitest_log "$tri_tmp/symA.log")" in *'症狀A(逾時)'*) r=ok ;; *) r=bad ;; esac
  ck "格27-b 只有逾時 ⇒ 判症狀A" "$r" "ok"
  case "$(triage_vitest_log "$tri_tmp/symB.log")" in *'症狀B候選'*) r=ok ;; *) r=bad ;; esac
  ck "格27-c 有 not set / createSupabaseServiceClient ⇒ 判症狀B候選" "$r" "ok"
  # 🔴 格27-d 是【新形狀】那一格:紅、但兩類 marker 都不符 ⇒ 不得被靜默歸進 A 或綠。
  #    沒有這一格,一種沒見過的紅會被塞進最近的那個桶,而分診表看起來完整。
  case "$(triage_vitest_log "$tri_tmp/other.log")" in *'兩類皆不符'*) r=ok ;; *) r=bad ;; esac
  ck "格27-d 紅但兩類 marker 皆不符 ⇒ 要明說是新形狀,不得塞進既有桶" "$r" "ok"
  # 格27-e:log 不存在時明說,不得靜默判綠(那會讓「沒量到」長得像「量到綠」)。
  case "$(triage_vitest_log "$tri_tmp/nope.log")" in *'log 不存在'*) r=ok ;; *) r=bad ;; esac
  ck "格27-e log 不存在 ⇒ 明說,不得靜默判綠" "$r" "ok"
  rm -rf "$tri_tmp"
  # ── 格28 系列:load average 解析器的三個世界(純函式,餵構造好的字串)──────
  #   🔴 **刻意【不】做「造負載看它動」那一格**,而理由是量過的:
  #      造 4 個燒 CPU 的行程、8 秒後 1 分鐘平均 29.92 → 32.01,而同時段機器正從 86 衰減
  #      ⇒ 那 +2.09 與衰減分不開。1 分鐘平均的時間常數 ~60 秒,selftest 等不起。
  #      ⇒ 「它會不會隨負載動」用真實事件背書(見函式上方),不用合成測試。
  ck "格28-a macOS 式 uptime ⇒ 取出三個數" \
     "$(parse_load_avg '23:14 up 5 days, 1 user, load averages: 29.92 73.84 72.93')" \
     "29.92 73.84 72.93"
  # 🔴 格28-b:Linux 式用【逗號】分隔 —— 而它同時證明了一件事(見格28-c 上方註解)。
  ck "格28-b Linux 式(逗號分隔)也要解得出來" \
     "$(parse_load_avg '23:14 up 1 day, load average: 0.00, 0.01, 0.05')" \
     "0.00 0.01 0.05"
  # 🔴🔴 格28-c:解不出來要回【讀不到】,**不可以回 0**。
  #   主視窗原本要求加一格「不造負載時它不能是 0」,而**我沒有加那一格,因為它是錯的**:
  #   格28-b 那個真實的 Linux 輸出就是 `0.00 0.01 0.05` ⇒ **`0` 是一個合法的讀數**。
  #   ⇒ 真正該守的不是「不能是 0」,是**「沒量到」與「量到 0」要分得開** —— 就是這一格。
  ck "格28-c 解析失敗 ⇒ 回【讀不到】而不是 0(沒量到 ≠ 量到 0)" \
     "$(parse_load_avg '完全不相關的一行')" "讀不到"
  # 格28-d:欄位數不足(只有兩個數)也算解不出來,不得回一個殘缺的值。
  ck "格28-d 只有兩個數 ⇒ 讀不到(不得回殘缺值)" \
     "$(parse_load_avg 'load averages: 1.00 2.00')" "讀不到"

  # ── 格29 系列:run queue 取樣的彙總器(純函式,餵構造好的樣本檔)────────────
  # 🔴 為什麼格子只測【彙總器】,不測「它會不會隨負載動」:
  #    後者要造 CPU 尖峰,而**造尖峰的 selftest 是部署風險** —— 寫這一段時我自己用一條
  #    會逾時被砍的命令造過 16 個燒 CPU 的行程,差點留在機器上(當場 pgrep 確認 0 才收手)。
  #    ⇒ 「它會不會動」用【當場的真實量測】背書,數字與其限定寫在 runq_now 上方註解:
  #      基準 76 72 66 73 72 / 同時造 16 個行程 124 121 113 117 125 119 ⇒ 方向分得開。
  #      🔴 而那組「基準」是量在一台 load≈78 的機器上(全陣八窗在跑),不是閒置機
  #         ⇒ 它證的是【會動】,不是【動多少】。引用時不要把它當成量值校準。
  #    這與 load average 那一段的處置一致(格子測解析器、動不動用真實事件背書),
  #    差別在:瞬時量【驗得起來】,而 load average 的 60 秒時間常數讓 selftest 等不起。
  _rq="$(mktemp -d)"
  printf '3\n9\n1\n5\n7\n' > "$_rq/s"
  ck "格29-a 正常樣本 ⇒ n/最大/最小 都對(最大 9 最小 1,不是取首尾)" \
     "$(runq_summary "$_rq/s")" "n=5 最大=9 p95=9 中位=5 最小=1"
  # 🔴 格29-b:空檔要回【讀不到】不可以回 0 —— 同格28-c 那個病:
  #    run queue 真的可能是 0(機器全閒)⇒ 0 是合法讀數,而「沒取到樣本」不是 0。
  : > "$_rq/empty"
  ck "格29-b 空樣本檔 ⇒ 讀不到(沒取到樣本 ≠ 量到 0)" \
     "$(runq_summary "$_rq/empty")" "讀不到"
  ck "格29-c 檔案不存在 ⇒ 讀不到(不得安靜當成 0)" \
     "$(runq_summary "$_rq/does-not-exist")" "讀不到"
  # 格29-d:非數字行不得被算進 n —— 取樣器若某一發吐了錯誤訊息,它不能污染分佈。
  printf '4\nps: 壞掉了\n6\n' > "$_rq/dirty"
  ck "格29-d 夾雜非數字行 ⇒ 只算數字行(n=2 不是 3)" \
     "$(runq_summary "$_rq/dirty")" "n=2 最大=6 p95=6 中位=4 最小=4"
  # 🔴🔴 格29-e 負測:把尖峰那一筆拿掉,【最大值必須跟著變】。
  #    沒有這一格的話,一個永遠回傳固定字串的彙總器也會讓上面四格全綠。
  printf '2\n2\n2\n99\n' > "$_rq/spike"
  printf '2\n2\n2\n2\n'  > "$_rq/flat"
  _mx_spike="$(runq_summary "$_rq/spike")"; _mx_flat="$(runq_summary "$_rq/flat")"
  ck "格29-e 負測:有尖峰 vs 無尖峰,兩個世界的【最大】必須不同" \
     "$([ "$_mx_spike" != "$_mx_flat" ] && echo 不同 || echo 相同)" "不同"
  ck "格29-e2 而且尖峰那份的最大要是 99(不是中位數把它抹掉)" \
     "$(printf '%s' "$_mx_spike" | sed -n 's/.*最大=\([0-9]*\).*/\1/p')" "99"
  # 格29-f:取樣器本身回的要是非負整數(格式閘;它的「會不會動」見上方註解)。
  ck "格29-f runq_now 回非負整數" \
     "$(runq_now | grep -cE '^[0-9]+$')" "1"
  rm -rf "$_rq"

  # 格27-f:快取目錄不存在時要印【無此目錄】而不是 0 —— 0 會讓「沒有快取」長得像「快取很新」。
  # ⚠️ 用【自己新開的】暫存檔 —— 第一版寫進 $mk_tmp,而那個目錄在格25 收尾就被 rm 掉了
  #    ⇒ 讀回空字串、這一格當場紅。那次紅是對的,紅的是我的測試碼。
  cache_probe="$(mktemp -d)"
  ( CDPATH= cd "$cache_probe" && vite_cache_age ) > "$cache_probe/out.txt" 2>&1 || true
  ck "格27-f 沒有快取目錄 ⇒ 印【無此目錄】不印 0" "$(cat "$cache_probe/out.txt")" "無此目錄"
  rm -rf "$cache_probe"

  # 格22:one() 真的把【完整輸出】留下來 —— 不是只留尾 N 行。
  #   餵一個印 8 行的命令、尾巴只要 2 行 ⇒ 完整檔必須有 8 行。
  one 2 selftest-full '自測-完整 log' sh -c 'for i in 1 2 3 4 5 6 7 8; do echo line$i; done' \
    >/dev/null 2>&1 || true
  full_log="$(logdir_for selftest)/selftest-full.full.log"
  [ -f "$full_log" ] && r="$(wc -l < "$full_log" | tr -d ' ')" || r=nofile
  ck "格22 one() 留下完整輸出(8 行),不是只留尾 2 行" "$r" "8"

  # 格23:run_context 真的把兩個數寫進痕跡檔(餵構造好的值,靶目錄自己造)。
  rx_tmp="$(mktemp -d)"
  run_context "T0" "3" "5" "7" "$rx_tmp/ctx" "8" "9" "0" "1" "2" "3" >/dev/null 2>&1
  # 🔴 2026-08-18 補強:這一格原本只 grep 三個【值】,不認欄位名 ——
  #    ⇒ 我同一批把 vitest 那個欄位名整個改掉,**這一格一聲不吭**,
  #    而隔壁 `格23-d`(認前綴)當場就紅了。**兩格守同一支輸出,而判別力差一個數量級。**
  #    ⇒ 補上前綴,讓改名這件事在兩個欄位上都擋得住。
  r="$(grep -c '全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=3 vitest起跑前=5 結束=7' "$rx_tmp/ctx/RUN-CONTEXT" 2>/dev/null || true)"
  ck "格23 RUN-CONTEXT 要帶【三個】並行行程數的原值(含最有用的中間那個)+ 欄位名" "$r" "1"
  # 🔴 2026-08-18:欄位名從「其他窗四綠build並行數」改成「全樹並行四綠build數」(跨工作樹修正),
  #    這一格當場變紅 —— **而它紅得對**:改了對外字面而守門認的是舊字面。
  #    ⚠️ 這裡**刻意不放寬成只認 `開始=8`** —— 那樣改名就再也擋不住,
  #    而「位置不得與 vitest 那三個對調」正是靠這串前綴在守。
  r="$(grep -c 'build數(不含自己;2026-08-18 起跨工作樹) 開始=8 vitest起跑前=9' "$rx_tmp/ctx/RUN-CONTEXT" 2>/dev/null || true)"
  ck "格23-d build 那兩個值也要原字進檔(位置不得與 vitest 那三個對調)" "$r" "1"
  # 格23-e:rc 四個值原字進檔,且【位置不得對調】—— 餵 0/1/2/3 四個不同的值就分得出來。
  r="$(grep -c 'rc typecheck=0 lint=1 build=2 vitest=3' "$rx_tmp/ctx/RUN-CONTEXT" 2>/dev/null || true)"
  ck "格23-e rc 四個值原字進檔且位置正確(統計工具靠它,不必去 parse 中文措辭)" "$r" "1"
  rm -rf "$rx_tmp"
  # 格23-b [負向對照]:參數錯位的世界。**今晚真的發生過** —— 呼叫端與函式體參數個數對不上一瞬間,
  #   `rx_dir` 收到 `"7"` ⇒ selftest 在 repo 根生了一個 `7/` 目錄,而**印的是全綠**。
  #   靶用一個絕對不存在的相對名字,確認它 ①回 rc=2 ②不生任何東西。
  rel_rc=0; run_context "T0" "1" "2" "3" "dfg-should-never-exist" >/dev/null 2>&1 || rel_rc=$?
  ck "格23-b 相對路徑 ⇒ run_context 必須 rc=2(不得安靜寫到別的地方)" "$rel_rc" "2"
  [ -e dfg-should-never-exist ] && r=yes || r=no
  # 🔴 檢查完【自己收乾淨】—— 突變測試時這一格的靶會被真的生出來,
  #    不收的話它會活到下一發,讓後面每一發都紅在這一格(實測:M16/M17/M18 都被它污染過)。
  #    這正是「突變 harness 要有後置檢查:上一發還原乾淨了嗎」那條的最小版本。
  rm -rf dfg-should-never-exist
  ck "格23-c 而且不得在 repo 裡留下任何東西" "$r" "no"

  # 格24 系列:紅的時候那三行要真的帶【三個】並行數,而且要接在 verdict 失敗那條路上。
  #   餵構造好的值,證它三個位置各自透傳(位置對調會把中間那個最有用的數印到別的位置去)。
  cn_out="$(concurrency_note 11 22 33)"
  # ⚠️ pattern 別跟著抄空白:實際輸出是「起跑前 22】」(後面接的是全形括號不是空白),
  #    第一版寫成 `'起跑前 22 '` ⇒ 這一格當場紅。**那次紅是對的,紅的是我的 pattern。**
  case "$cn_out" in *'開始 11 '*'起跑前 22'*'結束 33'*) r=ok ;; *) r=bad ;; esac
  ck "格24 concurrency_note 三個並行數各自透傳(順序不得對調)" "$r" "ok"
  # 格24-b:釘住它掛在【verdict 失敗】那一條路上 —— 只印在 RUN-CONTEXT 檔尾等於沒解決 V 窗那條。
  #   射程同格19:只證原始碼那一行還在 four_greens() 的失敗分支裡。
  r=$(printf '%s\n' "$fg_body" | grep -c 'concurrency_note "\$VITEST_START"' || true)
  ck "格24-b 那三行掛在 verdict 失敗分支裡(射程=原始碼行)" "$r" "1"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') four_greens ;;
  *) echo "用法: sh scripts/dev-four-greens.sh [--selftest]" >&2; exit 2 ;;
esac
