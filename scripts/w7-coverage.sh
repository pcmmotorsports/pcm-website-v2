#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# W7 · 出貨 writer 線的**跑過帳**(covering account = 「帳上這 28 支到底有沒有被跑過」)
#
#   check(預設):驗收據 —— 28 支每支都有一張、都綠、跑的是**現在這個版本**的 harness、
#                 跑的時候 migration 尾碼**就是現行的**。任何一條不成立就紅。
#   record <支|all>:真的跑 harness、把結果寫成收據。慢(每支要 initdb + 重放全套 migration),
#                 這是 **apply preflight 的本分**,不是每次 commit 都要做的事。
#
# ══ 🔴🔴 本檔為什麼是這個形狀(R3 打掉了前一版,理由要留著)══════════════
#   前一版守的是「**帳被偷改**」:凍結每支的 `EXPECT_TOTAL` 與靶清單,有人改小就紅。
#   R3 用 `git log -p` 實查全線史 ⇒ `EXPECT_TOTAL` **只上升過、零下降、零靶被刪**
#   —— 那個威脅模型在本線**零實例**,而真實發生過的失效有四種,它一種都守不到:
#     ① 天生零靶族(w1 五族 / w3b2 SHAPE 族)—— 出生就缺,不是後來被改小
#     ② 承諾了不存在的靶(`w2:18` 的 `TMUT-WIRED`)—— 凍結表會把「這族零靶」照實凍住、全綠
#     ③ 跨線釘值過期(08-08 02:15 實錘:附件線 migration 落檔沒同批重釘 ⇒ W7b 當場紅)
#     ④ 🔴 **跑都沒跑** —— `docs/handoff/CURRENT.md:19` 逐字:
#        「⛔ apply=Sean 停點,preflight 必跑 b2s2b 全套(**現只重釘未重跑**)」
#   ⇒ 本版改守 ③④(它們真的會咬人),①② 不是守門守得住的、是欠款,寫在
#     `docs/reviews/2026-08-08-w-line-mutation-matrix.md` §3。
#   ⇒ 附帶好處:**天然免維護**。加一格、補一發靶都不用改本檔任何數字
#     (前一版要同步約 16 處字面 + 兩次心算加總 = 本 repo 復發第一名那個病的最大化版本)。
#
# ══ 🔴 證得了什麼 / 證不了什麼 ═══════════════════════════════════════════
#   ✅ 這 28 支**被跑過**、跑的是現在這份程式碼、當時 migration 尾碼是現行的、結果全綠。
#   ❌ **證不了**那些格「有判別力」—— 那是各支自己的靶在證(全線現況見 matrix.md §1)。
#   ❌ **證不了**「該有的守門都想到了」。欠款清單在 matrix.md §3。
#   ❌ 收據是**自陳**:它證的是「有人跑了並記下結果」,不是「結果沒被手改」。
#      擋手改的是 code review 與 git 歷史,不是本檔。
#
# 用法:
#   bash scripts/w7-coverage.sh              驗收據(快,<1s)
#   bash scripts/w7-coverage.sh record all   跑全線 28 支並重寫收據
#     **實測 314 秒(5 分 14 秒)**,2026-08-10 **收編 l5b0 兩支之後**當場重量(單次、這台機器)。
#     前一個值是收編 op2b 當時的 **232 秒**。
#     🔴 **這 82 秒的差別不是 l5b0 兩支造成的 —— 我第一版就是這樣歸因,當場被自己的實測打臉**:
#     單獨重錄那兩支(`record l5b0-verify.sh` + `record l5b0t2-verify.sh`)實測**共 24 秒**(約 12 秒/支),
#     與下面那條「每收編一支 +10-13 秒」**完全吻合**、沒有例外。
#     ⇒ 剩下那 58 秒(82-24)**我沒有個別量過**(要重跑舊 migration 集合下的 25 支才能對照)。
#       目前只能說:**不排除**與「每支都要重放全套 migration、而 08-10 又多了好幾支」有關。
#       🔴 這句刻意寫成假設語氣 —— 第一版我寫的是「真正的成長來自…」那種斷定句,
#       而我手上只有「兩支 24 秒」這一個量測值。折 finding 時順手寫的新理由,是全篇最沒被驗過的字面。
#     ⇒ 失效條件照舊:每收編一支 +10-13 秒(已再次被 24 秒/2 支印證);整體秒數另受 migration 支數影響。
#     再前一個值是收編 a7t 當時的 **217 秒**;收 op2b 讓它多約 15 秒(那支共用叢集)。
#     組成:b2s2b 約 26 秒、op2b 約 15 秒、a7t 約 2 秒,其餘 19 支 w 線各約 10 秒上下 —— 每支都要 initdb + 重放全套 migration。
#     🔴 R2 nit:別把組成式當精算(19×10+26+2=218 已經超過 217)。當量級看:**約 3.5-4.5 分**;
#        **失效條件 = 每收編一支 w 線約 +10-13 秒、migration 變多每支都會變慢**,數字過期就重量一次。
#     (更早的「15-25 分」是從未實測過的字面,已於 W7d-3 片更正為 ~4 分;本行是收編後重量的值。)
#   bash scripts/w7-coverage.sh record w2-verify.sh   只重跑一支
# ══════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$REPO/scripts"
LEDGER="$SCRIPTS/w7-receipts.tsv"
TMPD="${W7TMP:-/tmp/w7cov}"
MODE="${1:-check}"

# 目錄裡的 W 線 harness 檔案集合。🔴 排除本檔自己(它沒有被測物、不是 harness)與收據檔。
# 🔴 `^w[0-9]` 是命名慣例不是機制:未來若有人把 harness 取成別的開頭,它對本檔隱形。
#    今天 19 支全部符合(逐支實查),這是**慣例債**、寫下來不假裝沒有。
# 🔴 2026-08-09 W7 跟片:`b2s2b-verify.sh` **收編進帳**(B-222-A ②-2 裁准)。
#    動機事故:08-09 中午跨線重釘漏掉它,而 `check` 27/0 對那個漏**零判別力** ——
#    因為它不在本集合裡。`^w[0-9]` 是命名慣例,慣例外的 harness 對本檔隱形。
#    ⇒ 改成**顯式併集**:慣例撈到的 + 一份具名清單。慣例本身仍是債(見上),但不再是唯一入口。
# 🔴 W7 跟片⑦(2026-08-09,主視窗裁):收編 `a7t-concurrency-probe.sh`。
#    它自足、跑 2 秒、無參數 exit 0 ⇒ 收編成本最低。
# 🔴 **另外三支明知有洞、明知不在帳上,仍不收 —— 理由逐支寫下來,不含混**:
#    · `n3-verify.sh`      需要一個**空 port**,而多視窗環境下 port 常被別窗佔
#      (08-09 一天撞三次)⇒ 進帳會變成「別人開叢集就紅」的假紅來源。
#      🔴 誠實邊界(**2026-08-10 殘項 C 已改寫,舊字面留在下面對照**):
#      舊字面是「**a7t 有同樣的風險**(54366 被佔 ⇒ pg_ctl start 失敗 ⇒ 一樣的假紅),
#      差別只在那個埠冷門…收 a7t 是賭埠冷門,不是它沒有這個問題」——
#      **那個賭注已經拆掉**:a7t 現在自帶埠閘(fail-closed),而且**用專屬離場碼 2**
#      把「環境不可用」與「真的紅(1)」分開 ⇒ 埠被佔時收據記 exit=2,帳面一眼看得出是哪一種。
#      實測對照(2026-08-10,同一個被佔的埠):改前 exit=**1**(與真失敗同形)、改後 exit=**2**。
#      ⚠️ 仍**不是**「不會受影響」:埠被佔照樣跑不了、check 照樣紅(exits_of 只准 0)——
#      改掉的是**可分辨性**,不是可用性。n3 仍不收,理由見上一行(它的紅會是常態假紅來源)。
#    · `s1b-verify.sh`     需要外部 `d1t2-rehearsal.sh provision <workdir>` 先建庫,
#      不是加一行 `invoke_of` 就能自足;要進帳得先讓它會自己 provision。
#    · `b2s1-concurrency-probe.sh` 目前被自己的 `exit 2` 停用(已知會卡死),不該進帳。
#    ⇒ 這三支的回歸目前**沒有任何自動化會紅**。這是慣例債,寫在這裡是為了下一個人
#      不用重新發現一次(跟片⑥ B-326-STOP ⑦、主視窗 B-328-A 裁)。
# 🔴 OP2b 片(2026-08-10,本輪 code-reviewer MF3):收編 `op2b-verify.sh`。
#    動機不是「多一支比較齊」,是**覆蓋淨減**:OP2b 同一片把 `op1p-verify.sh` 退役,
#    A9 / 不可變 / 擋刪的回歸全部搬進 `op2b-verify.sh`;它若不在本集合裡,
#    `record all` 永遠跑不到它 ⇒ 帳面照樣 32/0 全綠,而那三條守門的回歸**沒有任何自動化在看**。
#    它自足(all 模式自己 provision + teardown)、只認 PORT 與 workdir ⇒ 收編成本同 b2s2b。
# 🔴 OP3 片(2026-08-10):收編 `op3-verify.sh`。同 op2b 的理由 —— OP3 把「付款確認同交易落 card 腿」
#    的**全部行為證據**放在那支(migration 只做結構斷言,因為它不得依賴業務資料)。
#    它若不在本集合裡,`record all` 永遠跑不到它 ⇒ 帳面照樣全綠,而
#    「重放不落第二列」「翻單與落帳同生共死」「actor 守門 P2B36」的回歸**沒有任何自動化在看**。
#    它自足(all 模式自己 provision + teardown)、只認 PORT 與 workdir ⇒ 收編成本同 op2b。
# 🔴 L5b-0 t 線(2026-08-10):收編 `l5b0-verify.sh`(attempt 面 13 格 + 10 發突變)與
#    `l5b0t2-verify.sh`(confirm 面 5 格 + 2 發突變 + 一條 adapter→真 DB 端到端)。
#    理由同 op2b/op3:L5b-0 的**行為證據全在這兩支**,migration 檔內只留不可回滾的結構斷言。
#    它們不在集合裡 ⇒ `record all` 永遠跑不到 ⇒ 帳面照樣全綠,而「讓路款不得被認列成收款」
#    這條鐵律的回歸**沒有任何自動化在看**。
#    兩支都已在 -t3 補上 `all` 模式(自己 provision + teardown + 驗埠零留痕)⇒ 自足、收編成本同 op3。
#    🔴 2026-08-11 OP4 片同款理由:歷史回填的行為證據**全在 op4-verify.sh**(migration 檔內
#    只有不可回滾的檔尾斷言)。它是**寫錢帳且不可回收**的片(卡軌無沖銷 RPC)⇒ 不收編
#    = 這條線的回歸沒有任何自動化在看。
#    🔴 2026-08-11 OP6-a **補登記**(主視窗判定:昨夜收割遺漏,不是刻意排除)。
#    OP6-a 收割行寫的 w7 39/0 裡的 39 = 37+2,**它自己那 49 格從來不在帳上** ——
#    「結清狀態純算函式」的行為證據全在 op6a-verify.sh,不收編等於這條線沒人跑。
#    🔴 2026-08-11 L5b-2 片 2a 收編 l5b2-2a-verify.sh:它是那支**正在收錢的 claim RPC** 被 DROP+重建
#    之後唯一的守門(回傳形狀/ACL 四件/schema USAGE/成員白名單 + 十發突變 + 回退腳本實跑)。
#    不收編 ⇒ `record all` 永遠跑不到它,帳面照樣全綠,而這些守門的回歸沒有任何自動化在看。
EXTRA_HARNESSES="a7t-concurrency-probe.sh b2s2b-verify.sh l5b0-verify.sh l5b0t2-verify.sh l5b2-2a-verify.sh op4-verify.sh op6a-verify.sh opa12-verify.sh op2b-verify.sh op3-verify.sh op5-verify.sh"
harness_set() {
  { ls "$SCRIPTS" 2>/dev/null | grep -E '^w[0-9].*\.sh$' | grep -v '^w7-coverage\.sh$'
    for e in $EXTRA_HARNESSES; do [ -f "$SCRIPTS/$e" ] && printf '%s\n' "$e"; done
  } | sort
}

# 🔴 **不是每支 harness 都是「無參數、exit 0」** —— 這是收編 b2s2b 時才發現的:
#    `b2s2b-verify.sh:198-201` 要 MODE + workdir,且 **PORT 必須顯式帶**(它自己 plan §3.6
#    刻意不給預設值,那是別片的設計決定,不為了我方便而改掉)。
#    ⇒ 呼叫方式與允許出口碼都改成**每支各自查表**,預設維持「無參數 / 只准 exit 0」。
invoke_of() {  # $1=harness 檔名 → 印出要跑的完整命令
  case "$1" in
    b2s2b-verify.sh) printf 'PORT=54365 bash scripts/%s all /tmp/b2s2bv' "$1" ;;
    # 🔴 a7t 用**專屬的 workdir 與 port**,與有人手跑本檔隔離(它預設是 /tmp/a7tcc:54332)。
    a7t-concurrency-probe.sh) printf 'A7TCC_WORK=/tmp/a7tcov A7TCC_PORT=54366 bash scripts/%s' "$1" ;;
    # 🔴 op2b 同款隔離:它預設 PORT=54381,這裡改用專屬埠與 workdir,免得撞到手跑那一輪。
    #    `all` 會自己 provision + teardown;workdir 有 `.d1t2-harness` ownership marker 才敢 rm -rf。
    op2b-verify.sh) printf 'PORT=54367 bash scripts/%s all /tmp/op2bcov' "$1" ;;
    # 🔴 op3 同款隔離:它預設 PORT=54371,這裡改用專屬埠與 workdir,免得撞到手跑那一輪。
    op3-verify.sh) printf 'PORT=54368 bash scripts/%s all /tmp/op3cov' "$1" ;;
    op5-verify.sh) printf 'PORT=54369 bash scripts/%s all /tmp/op5cov' "$1" ;;
    # 🔴 op4 無預設 PORT(該支刻意要求顯式帶),這裡給專屬埠與 workdir;
    #    刻意避開 54374 / 54379 系(P 窗 2a 與手跑輪在用)。
    op4-verify.sh) printf 'PORT=54364 bash scripts/%s all /tmp/op4cov' "$1" ;;
    # 🔴 op6a 同款:它也刻意無預設 PORT(檔頭建議 54375)。這裡**不用**它建議的那個 ——
    #    照 op2b/op3 的慣例給覆蓋率專用埠,免得撞到有人同時手跑 54375 那一輪。
    op6a-verify.sh) printf 'PORT=54363 bash scripts/%s all /tmp/op6acov' "$1" ;;
    opa12-verify.sh) printf 'PORT=54370 bash scripts/%s all /tmp/a12cov' "$1" ;;
    # 🔴 L5b-0 兩支:各自專屬埠與 workdir。l5b0*-verify.sh 讀的是 L5B0_VERIFY_PORT
    #    (不是 PORT)—— 但它們內部把 PORT 傳給 d1t2-rehearsal provision,故**兩個都要給**,
    #    否則會 provision 在 A 埠、卻連去 B 埠(那正是 d1t2-rehearsal:44-52 警告的無症狀假綠)。
    l5b0-verify.sh)   printf 'PORT=54372 L5B0_VERIFY_PORT=54372 bash scripts/%s all /tmp/l5b0cov' "$1" ;;
    l5b0t2-verify.sh) printf 'PORT=54373 L5B0_VERIFY_PORT=54373 bash scripts/%s all /tmp/l5b0t2cov' "$1" ;;
    # 🔴 l5b2-2a 用專屬埠與 workdir。它的**叢集身分閘會讀 <workdir>/cluster-id** ⇒ workdir 必須是
    #    它自己 provision 的那個(all 模式會建),不能借用別支的目錄。
    l5b2-2a-verify.sh) printf 'PORT=54374 bash scripts/%s all /tmp/l5b22acov' "$1" ;;
    *)               printf 'bash scripts/%s' "$1" ;;
  esac
}
# 🔴 record 跑完必須自己收掉那座拋棄式 cluster。實查(看**實際呼叫**不看註解):
#    a7t=`trap teardown EXIT` 自清 / op2b、op3 在 all 尾端真的 teardown 並驗埠 /
#    **b2s2b、op5、opa12 從來沒呼叫過**,只印一行「請自己收」。
#    後果不是理論:同一支連錄兩次,第二次必被自己上一輪的 postmaster 佔埠、
#    fail-closed 成 `exit=2 / PASS=0 / FAIL=-1`,而收據只寫得出「不綠」、不會說是埠。
#    ⇒ 這裡統一收尾。**埠與 workdir 不另抄一份**,直接從 invoke_of 的字面解析
#      (抄第二份 = 改埠時只改一邊的漂移風險);解析不到就當它不用拋棄式庫、跳過。
cleanup_of() { # $1=harness 檔名 → 印出 "PORT WORKDIR",無則印空
  local cmd p w
  cmd="$(invoke_of "$1")"
  p="$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]])[A-Z0-9_]*PORT=[0-9]+' | grep -oE '[0-9]+$' | head -1)"
  w="$(printf '%s' "$cmd" | grep -oE '/tmp/[A-Za-z0-9_.-]+' | head -1)"
  [ -n "$p" ] && [ -n "$w" ] && printf '%s %s' "$p" "$w"
}
exits_of() {   # $1=harness 檔名 → 印出允許的出口碼(空白分隔)
  case "$1" in
    # 🔴 b2s2b 的 `exit 3` 是**刻意的第三態**(`:2935`:INCONC 待裁格 > 0),不是失敗。
    #    它自己在 `:2874` 驗過「待裁格集合逐字相符」⇒ 對它而言 FAIL=0 + 集合相符 = 綠。
    #    ⚠️ 所以收據多記一欄 `inconc`:待裁格從 1 個變 5 個時,帳面看得到。
    b2s2b-verify.sh) printf '0 3' ;;
    *)               printf '0' ;;
  esac
}
# 現行 migration 時間序尾碼(與 b2s2b-verify.sh 的 NEWEST_TS 閘同一個量法)
newest_ts() { ls "$REPO"/supabase/migrations/*.sql 2>/dev/null | sed 's|.*/||; s|_.*||' | sort | tail -1; }
sha_of() { shasum "$SCRIPTS/$1" 2>/dev/null | cut -d' ' -f1; }

# ══════════════════════════ record 模式 ══════════════════════════════════
if [ "$MODE" = "record" ]; then
  TARGET="${2:-all}"
  REC_BAD=0
  TS="$(newest_ts)"
  [ -n "$TS" ] || { echo "找不到 supabase/migrations ⇒ 不敢記帳"; exit 1; }
  if [ "$TARGET" = "all" ]; then
    LIST="$(harness_set)"
  else
    # 🔴 W7 跟片⑦:具名那條路原本**不檢查名字在不在集合裡** —— 打錯字(或像我一樣手滑打成
    #    `record w7-coverage.sh`)會寫進一筆「有收據沒 harness」的列,下一次 check 才紅在 SET-MATCH。
    #    fail-closed 沒錯,但紅的地方離手滑很遠。⇒ 當場擋。
    case " $(harness_set | tr '\n' ' ') " in
      *" $TARGET "*) : ;;
      *) echo "🔴 $TARGET 不在 harness 集合裡 ⇒ 拒絕記帳(集合 = ^w[0-9] 撈到的 + EXTRA_HARNESSES)"; exit 1 ;;
    esac
    LIST="$TARGET"
  fi
  [ -f "$LEDGER" ] || printf '# W7 跑過帳。一行一支:harness\\tPASS\\tFAIL\\texit\\tnewest_ts\\tharness_sha\n# 由 `bash scripts/w7-coverage.sh record` 產生,勿手改。\n' > "$LEDGER"
  for h in $LIST; do
    [ -f "$SCRIPTS/$h" ] || { echo "SKIP $h(檔案不存在)"; continue; }
    printf '跑 %s … ' "$h"
    OUT="$(cd "$REPO" && eval "$(invoke_of "$h")" 2>&1)"; EX=$?
    # 🔴 兩軌都讀(退出碼三連坑):字面的 PASS=/FAIL= **與** 結束碼,任一不對就是不綠。
    P="$(printf '%s' "$OUT" | sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\1/p' | tail -1)"
    F="$(printf '%s' "$OUT" | sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\2/p' | tail -1)"
    [ -n "$P" ] || P=0
    [ -n "$F" ] || F=-1   # 抓不到總結行 = 不當作 0,當作壞掉
    # 待裁格數(只有 b2s2b 會印 INCONCLUSIVE=;其餘恆 0)
    IC="$(printf '%s' "$OUT" | sed -n 's/.*INCONCLUSIVE=\([0-9]*\).*/\1/p' | tail -1)"
    [ -n "$IC" ] || IC=0
    printf 'PASS=%s FAIL=%s exit=%s inconc=%s\n' "$P" "$F" "$EX" "$IC"
    # 🔴 收尾:**成功與失敗兩條路徑都要收**(失敗那次留下的 cluster 一樣會擋死下一支;
    #    這正是實際踩到的形狀)⇒ 放在這裡、不放在任何 if 裡面。
    #    對已自清的 a7t / op2b / op3 是 no-op(目錄已不在,teardown 拒絕後被 || true 吃掉)。
    CLEAN="$(cleanup_of "$h")"
    if [ -n "$CLEAN" ]; then
      CPORT="${CLEAN%% *}"; CWORK="${CLEAN##* }"
      PORT="$CPORT" bash "$SCRIPTS/d1t2-rehearsal.sh" teardown "$CWORK" >/dev/null 2>&1 || true
      # 🔴 teardown 的退出碼證明不了埠的狀態(op2b 關卡2 #11 的教訓)⇒ 另外驗埠。
      if lsof -nP -iTCP:"$CPORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        LEFT_PID="$(lsof -nP -iTCP:"$CPORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
        LEFT_DD="$(psql "postgresql://postgres@127.0.0.1:$CPORT/postgres" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null)"
        echo "   🔴 $h 跑完後 port $CPORT 仍有人聽(pid: $LEFT_PID / data_directory: ${LEFT_DD:-查不到})" \
             "⇒ 下一支 record 會被它 fail-closed 成 exit=2"
        # 🔴 只有在那座**確實是本表的 workdir** 時才敢叫人收 —— 佔埠的可能是別的 workdir
        #    甚至別的視窗(本輪實測過這個情境);叫錯人去 teardown 等於教人砍別人的庫。
        if [ "$LEFT_DD" = "$CWORK/pgdata" ]; then
          echo "      ↳ 那座就是本表的 workdir,手動收:PORT=$CPORT bash scripts/d1t2-rehearsal.sh teardown $CWORK"
        else
          echo "      ↳ ⚠️ 它的 data_directory 不是本表的 $CWORK/pgdata ⇒ **可能是別人的庫,不要逕自 teardown**;先用 pid $LEFT_PID 查清楚是誰的"
        fi
        REC_BAD=$((REC_BAD+1))
      fi
    fi
    # 🔴 失敗訊息要點名埠:harness 自己印的「port 被佔用」原本被總結行吃掉,
    #    帳面只剩 `exit=2 / PASS=0 / FAIL=-1`,看的人不知道是埠。⇒ 把它那幾行撈回來。
    case " $(exits_of "$h") " in
      *" $EX "*) : ;;
      *) printf '%s' "$OUT" | grep -E '🔴|被佔用|port [0-9]+' | head -3 | sed 's/^/   ↳ /' ;;
    esac
    # 🔴 R1 F7:原本 `|| true` 之後無條件 mv —— grep 因「無匹配」**以外**的原因失敗
    #    (檔不可讀、磁碟滿)時 tmp 是空的,整本收據會被靜默清空、只剩本支那行。
    #    grep 的退出碼:0=有匹配、1=無匹配(正常)、≥2=真的出錯 ⇒ 只有前兩者才敢 mv。
    grep -v "^$h	" "$LEDGER" > "$LEDGER.tmp" 2>/dev/null; GRC=$?
    [ "$GRC" -le 1 ] || { echo "🔴 grep 讀收據失敗(rc=$GRC)⇒ 拒絕覆寫,收據保持原樣"; rm -f "$LEDGER.tmp"; exit 1; }
    # 🔴 R2 F3:`> file` 重導向失敗時 bash 也給 rc=1 —— 與「無匹配」**不可分辨**。
    #    那時 tmp 根本不存在,`mv` 只在 stderr 抱怨,收據沒被換掉,下一行 `>>` 再追加 ⇒ 該支出現兩列。
    #    ⇒ 不能只看 rc,要看產物真的在。
    [ -f "$LEDGER.tmp" ] || { echo "🔴 收據暫存檔沒產出(重導向失敗?)⇒ 拒絕覆寫"; exit 1; }
    mv "$LEDGER.tmp" "$LEDGER"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$h" "$P" "$F" "$EX" "$TS" "$(sha_of "$h")" "$IC" >> "$LEDGER"
    # 🔴 R1 F6:record 原本無條件 `exit 0` —— 而 record 是唯一**真的跑 harness** 的模式,
    #    任一支跑紅照樣回 0 ⇒ 夜跑寫 `record all && …` 會被騙。判準與 check 的 `check_one` 對齊:
    #    FAIL 非 0、或 exit 不在該支的允許集合內,就是不綠。
    case " $(exits_of "$h") " in *" $EX "*) : ;; *) REC_BAD=$((REC_BAD+1)) ;; esac
    [ "$F" = "0" ] || REC_BAD=$((REC_BAD+1))
  done
  echo "收據已寫入 $LEDGER"
  [ "$REC_BAD" -eq 0 ] || { echo "🔴 本輪有 $REC_BAD 項不綠(FAIL 非 0 或 exit 不在允許集合)⇒ 收據已寫,但離場碼非 0"; exit 1; }
  exit 0
fi

# ══════════════════════════ check 模式 ═══════════════════════════════════
PASS=0; FAIL=0; KEYS=""
# 🔴 R1 F5(宣稱範圍,寫下來不假裝沒有):格名用 `sed 's/-.*//'` 取檔名第一段 ⇒
#    `a7t-concurrency-probe.sh` 的格叫 `RECEIPT-a7t`。
#    但 `scripts/a7t-verify.sh`(真正測 A7-t 函式那支)推出來也是 `a7t`,而**它不在帳上**。
#    ⇒ `RECEIPT-a7t` 綠只代表那支**併發探針**跑過,不代表 A7-t 有被驗過。
#    🔴 **2026-08-11 W-a 實況**:本輪已把 KEY 推導改成「撞號才展開」(見下方 key_of),
#       撞號在結構上不會再留下來。但 `a7t-verify.sh` **本輪仍收編不進來** —— 它跑不綠,
#       原因不是格名也不是輸出格式,是 A7-t migration 自己的斷言過期(見 backlog **#399**)。
#       ⇒ **這段歧義警告到 #399 修完、a7t-verify 收編為止都仍然成立。** 格內訊息印的是
#    完整檔名(`a7t-concurrency-probe.sh:6 綠`),讀訊息不會誤會;讀格名會。
EXPECT_TOTAL=40   # 🔴 量出來的(**30** 逐支〔19 支 w 線 + b2s2b + a7t + op2b + op3 + op4 + op5 + op6a + opa12 + l5b0 + l5b0t2 + l5b2-2a〕 + SET-MATCH + **六發靶** + NO-WRITEBACK + EXCLUDED-REASONS + MIG-PREFIX-UNIQ)。全綠 PASS = 40 + 2 = 42。
                  # 🔴 2026-08-11 合併裁定(主視窗):B 線 37→38(op4)→39(op6a 補登記)與 P 線 37→38(l5b2-2a)
                  #    於 dev 合流=**40**;三支收編理由見 EXTRA_HARNESSES 上方。
                  #    ⚠️ OP6-a 那筆是**補既有遺漏**(收編是收割的一部分,不是下一片的事)。
                  #    ⚠️ 改這個數字時**同句的枚舉也要改**——「改了數字沒改枚舉」是本 repo 2026-08-11 已發作三次的病,不要第四次。
                  # 🔴 2026-08-10 L5b-0-t3 片:35→37,收編 l5b0-verify.sh + l5b0t2-verify.sh
                  #    (「讓路款不得被認列成收款」那條鐵律的行為證據全在這兩支;不收編 = 這條線沒人跑)。
                  # 🔴 2026-08-10 OP3 片:32→33,新增 MIG-PREFIX-UNIQ(本片自己撞號兩次,見該格上方理由)。
                  # 🔴 2026-08-10 OP-A12 片:34→35,收編 opa12-verify.sh(沖銷入口 + 兩支開權終態的唯一行為證據)。
                  # 🔴 2026-08-10 OP5 片:33→34,收編 op5-verify.sh(人工軌登錄 RPC 的行為證據全在那支;不收編就等於本線沒人跑)。
                  # 🔴 2026-08-10 OP3 片:31→32,收編 op3-verify.sh(見 EXTRA_HARNESSES 上方理由)。
                  # 🔴 2026-08-10 OP2b 片(code-reviewer MF3):30→31,收編 op2b-verify.sh(見 EXTRA_HARNESSES 上方理由)。
                  # 🔴 2026-08-10 殘項 A:29→30,新增 EXCLUDED-REASONS(三支明文不收的 harness,排除理由的失效條件)。
                  # 🔴 2026-08-10 #354:27→29,新增 TMUT-COV-EXITS / TMUT-COV-INCONC 兩發常設靶。
                  # 🔴 W7d-1(2026-08-08)新增 scripts/w7d1-verify.sh ⇒ harness_set() 的 ^w[0-9] 自動撈得到它,
                  #    但**格數與 KEYS_FROZEN 是手動字面**、不會自己長 —— 關卡2 抓到這個漏。
                  #    ⇒ 以後每新增一支 w 開頭的 harness,這兩個字面都要一起改(這正是本檔在守的那種帳)。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-28s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-28s %s\n' "$1" "$2"; }
rm -rf "$TMPD"; mkdir -p "$TMPD"
# 🔴 R2 nit(2026-08-08):原本掛 `EXIT INT TERM`,那正是我在當時那 **18 支** harness **拒絕**的雙跑形狀。
#    (數字刻意不隨後來新增的 w7d3 一起長 —— 這句講的是掃掠當下的範圍,是歷史陳述不是現況。)
#    bash 3.2.57 實測:掛上 INT/TERM 後,被中斷的腳本**退出碼被洗成 0**(130→0、143→0)
#    ⇒ 一次 Ctrl-C 的 `check` 會回 exit 0 = fail-open。EXIT 單掛就接得到 INT/TERM/HUP/QUIT,不需要它們。
trap 'rm -rf "$TMPD"' EXIT

TS_NOW="$(newest_ts)"

# ── 對帳原語:吃一份收據檔,回一支的問題描述(空 = 這支的帳是好的)────────
# 🔴 參數化成吃檔案,是為了 §3 六發靶能對「動過手腳的副本」跑**同一份判定式**
#    —— 靶與被靶用兩套判定,翻面證的只是我寫了兩套。
check_one() { # $1=收據檔 $2=harness 檔名
  local led="$1" h="$2" row p f ex ts sha problems=""
  row="$(grep "^$h	" "$led" 2>/dev/null | tail -1)"
  [ -n "$row" ] || { printf '沒有收據 ⇒ **這支從來沒被跑過**(或收據被刪)'; return; }
  p="$(printf '%s' "$row" | cut -f2)"; f="$(printf '%s' "$row" | cut -f3)"
  ex="$(printf '%s' "$row" | cut -f4)"; ts="$(printf '%s' "$row" | cut -f5)"
  sha="$(printf '%s' "$row" | cut -f6)"; ic="$(printf '%s' "$row" | cut -f7)"
  # 待裁格數凍結:b2s2b 現況恰 1(BMUT-L2A-INCONCLUSIVE);變多變少都要有人看
  case "$h" in
    b2s2b-verify.sh) [ "${ic:-x}" = "1" ] || problems="$problems 待裁格數=${ic:-未記}(凍結值 1)⇒ 有格從綠掉進待裁、或待裁格被消掉,兩種都要人看;" ;;
    *)               [ "${ic:-0}" = "0" ] || problems="$problems 待裁格數=$ic(該支不該有待裁格);" ;;
  esac
  # ① 綠不綠 —— 字面與退出碼**兩軌都要**(本線教訓:五支 verify 曾「紅跑回 exit 0」)
  [ "$f" = "0" ]  || problems="$problems 收據記 FAIL=$f(非 0);"
  # 🔴 允許碼每支各自查表(b2s2b = 0 或 3)。預設仍是「只准 0」——放寬只發生在具名那支。
  ALLOWED="$(exits_of "$h")"; ex_ok=0
  for a in $ALLOWED; do [ "$ex" = "$a" ] && ex_ok=1; done
  [ "$ex_ok" = "1" ] || problems="$problems 收據記 exit=$ex(該支允許的是 [$ALLOWED]);"
  [ "${p:-0}" -gt 0 ] 2>/dev/null || problems="$problems 收據記 PASS=$p ⇒ 一格都沒跑到;"
  # ② 跑的是不是**現在這份**程式碼(用內容 sha,不用 mtime —— git checkout 會動 mtime)
  [ "$sha" = "$(sha_of "$h")" ] || problems="$problems harness 內容已改但**沒重跑**(收據 sha ${sha:0:8}… vs 現行 $(sha_of "$h" | cut -c1-8)…);"
  # ③ 跑的時候 migration 尾碼是不是現行的 —— 這條打的是 08-08 02:15 那次真事故:
  #    新 migration 落檔、釘值檔沒同批重跑 ⇒ 帳面全綠但釘的是舊世界
  [ "$ts" = "$TS_NOW" ] || problems="$problems 跑的時候 migration 尾碼是 $ts、現行是 $TS_NOW ⇒ 釘值過期,要重跑;"
  printf '%s' "$problems"
}

echo "══ 1. 逐支跑過帳(有沒有跑 / 綠不綠 / 跑的是不是這版 / 釘值對不對)═══"
if [ ! -f "$LEDGER" ]; then
  echo "  🔴 收據檔不存在:$LEDGER"
  echo "     ⇒ 先跑 bash scripts/w7-coverage.sh record all(慢,apply preflight 的本分)"
fi
# 🔴🔴 **KEY 推導:撞號才展開**(2026-08-11 W-a)。
#    舊規則 `sed 's/-.*//'`(截到第一個 `-`)在只有一支 `a7t-*` 時沒問題,
#    但 `a7t-verify.sh` 一收編就與 `a7t-concurrency-probe.sh` **推出同一個 `RECEIPT-a7t`**。
#    ⚠️ 為什麼不用「後綴剝除法」(剝 `-verify` / `-probe`):
#       ① 它會一次改掉 **9 個**既有格名(w5/w6a/w6b1-3/w6c/w7b/l5b2-2a/a7t-probe),爆炸半徑大;
#       ② **它擋不住下一對同前綴**(`xx-verify.sh` 與 `xx-probe.sh` 剝完都是 `xx`,照樣撞)。
#    ⇒ 改成:base 撞號時,**撞到的那幾支**才改用「檔名去掉 .sh」當 KEY,其餘一律維持舊規則。
#      效果分兩個世界講清楚(reviewer C1:上一版把兩者混為一談,量的是**還沒發生的那個**):
#        · **現況**(a7t-verify.sh 尚未收編):`COLLIDING_BASES` 為空 ⇒ **30/30 逐字不變**、
#          `RECEIPT-a7t` 原封不動。本次改動對帳面是**零行為差異**。
#        · **收編 a7t-verify.sh 之後**(待 #399 修完):29/30 不變,唯一變的是
#          `a7t-concurrency-probe`(`a7t` → `a7t-concurrency-probe`),並新增 `a7t-verify`。
#    🔴 這條規則讓**重複 KEY** 結構上不可能留下來:任何新撞號都會自動展開成全名。
#    ⚠️ 誠實邊界(reviewer Minor):它自動的只有**推導**,`KEYS_FROZEN` 仍是**人工字面** ——
#       收編一支新 harness 時該清單還是要有人改。而且反向也有盲區:實測**刪掉撞號的一方**時,
#       倖存者的 KEY 會縮回短名 ⇒ `TMUT-COV-EXITS` 會紅,但 `CELL-KEYSET` 對這個縮回**全盲**
#       (它比的是集合,而縮回後的集合剛好又合法)。⇒ 別把這條讀成「格名層全自動了」。
COLLIDING_BASES="$(harness_set | sed 's/-.*//' | sort | uniq -d | tr '\n' ' ')"
key_of() {  # $1=harness 檔名 → 印出格名
  local base; base="$(printf '%s' "$1" | sed 's/-.*//')"
  case " $COLLIDING_BASES " in
    *" $base "*) printf 'RECEIPT-%s' "$(printf '%s' "$1" | sed 's/\.sh$//')" ;;
    *)           printf 'RECEIPT-%s' "$base" ;;
  esac
}
for h in $(harness_set); do
  KEY="$(key_of "$h")"
  PROB="$(check_one "$LEDGER" "$h")"
  if [ -z "$PROB" ]; then
    ROW="$(grep "^$h	" "$LEDGER" | tail -1)"
    ok "$KEY" "$h:$(printf '%s' "$ROW" | cut -f2) 綠 / 釘值 $(printf '%s' "$ROW" | cut -f5) ✓"
  else
    bad "$KEY" "$h:$PROB"
  fi
done

echo "══ 2. 集合帳 ═════════════════════════════════════════════"
# 🔴 這條抓「新片落檔沒進帳」:harness 集合與收據集合必須逐字相等。
#    (前一版靠手維護的凍結清單抓同一件事;現在兩邊都是量出來的,免維護。)
HS="$(harness_set | tr '\n' ' ' | sed 's/ *$//')"
RS="$(grep -v '^#' "$LEDGER" 2>/dev/null | cut -f1 | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
[ "$HS" = "$RS" ] \
  && ok SET-MATCH "harness 集合($(printf '%s' "$HS" | wc -w | tr -d ' ') 支)與收據集合逐字相等 ⇒ 新片落檔沒記帳會紅在這裡" \
  || bad SET-MATCH "集合不符。有 harness 沒收據:[$(comm -23 <(printf '%s' "$HS" | tr ' ' '\n' | sort) <(printf '%s' "$RS" | tr ' ' '\n' | sort) | tr '\n' ' ')] 有收據沒 harness:[$(comm -13 <(printf '%s' "$HS" | tr ' ' '\n' | sort) <(printf '%s' "$RS" | tr ' ' '\n' | sort) | tr '\n' ' ')]"

# 🔴🔴 **殘項 A(B-357 盤點,主視窗裁 A→C→B 序):三支「明知有洞、明知不在帳上」的
#    排除理由,補失效條件。** 檔頭 `:58-68` 逐支寫了為什麼不收,但那三條理由都是
#    **時點觀察**:改成自帶隨機埠、讓它自己 provision、或哪天把卡死修好,理由就不成立了,
#    而**沒有任何機制在複查**(memory `feedback_withdrawal-reason-needs-expiry-condition`)。
# ⇒ 每支釘一個「排除理由還成立」的可觀測證據;證據不見了就判紅、要人重看該不該收進帳。
#
# 🔴🔴 **誠實邊界(這一格的實力就到這裡,別讀成更多)**:
#    它檢查的是**排除理由的證據**,不是排除理由的**真假**。
#    例:n3 可以保留 `require_free_port` 卻改成隨機埠 —— 證據還在、理由其實已經失效,這格不會紅。
#    它擋的是「**證據整條消失**卻沒人重看」,不是「理由被悄悄改成別的意思」。
#    ⚠️ 「證據消失」也**只在錨點真的唯一指向那個機制時**才等於「理由消失」——
#       第一版 b2s1 就栽在這裡(錨點同時命中一段散文,刪掉真機制後仍恆綠)。
#       ⇒ 每個錨點都要**用守門那條命令本身**去數命中次數,不是用另一條看起來等價的。
#    真正要關那半,得逐支讀懂它們 —— 那是殘項 B 的工作(主視窗已登記日班)。
# ⚠️ 落字(本輪 code-reviewer 建議):本格的判別力是**人工一次性突變**跑出來的
#    (四種失效各一發、每發驗錨點真的移除、跑完驗三支 harness 指紋逐位元不變)——
#    腳本沒有隨片留檔 ⇒ 「零回寫」這句在**這一次**是實測、但**不是常設可重跑的證據**。
#    下次動這一族時,突變腳本要一併留痕。
EXCL_BAD=""
# 🔴🔴 **本輪 code-reviewer must-fix:錨點必須用 `grep -E`(行錨),不能用 `grep -F`(子字串)。**
#    第一版 b2s1 的錨點是固定字串 `exit 2`,而它在該檔命中**兩處**:`:25` 是真正的停用機制,
#    `:32` 只是註解裡用反引號引用它。⇒ **真實的失效(有人重新啟用、刪掉 `:25`)之後,
#    `:32` 那段散文仍然命中 ⇒ 這一格對 b2s1 恆綠**,而它存在的唯一理由就是要擋那件事。
#    🔴 **根因是我驗唯一性時用錯判準**:我用 `^exit 2$`(命中 1)確認「唯一」,
#       而守門實際用的是 `grep -F`(命中 2)——**驗證的判準與守門的判準不是同一個**,
#       所以那句「唯一」從頭到尾沒有被真的驗過。下次釘錨點:**用守門那條命令本身去數**。
excl_check() {  # excl_check <harness> <錨點 ERE(必要時用 ^…$ 釘行)> <排除理由一句話>
  if [ ! -f "$SCRIPTS/$1" ]; then
    EXCL_BAD="$EXCL_BAD [$1 檔案不見了 ⇒ 排除清單過期]"
  elif ! grep -qE "$2" "$SCRIPTS/$1"; then
    EXCL_BAD="$EXCL_BAD [$1 的排除理由「$3」失去證據(找不到 \`$2\`)⇒ 重看它該不該進帳]"
  fi
}
# · n3:需要一個**空 port**;它自己有一道顯式的 require_free_port ⇒ 那道就是「需要固定空埠」的證據
excl_check n3-verify.sh                "require_free_port"              "需空 port,多視窗常被佔 ⇒ 進帳會變假紅來源"
# · s1b:需要外部 provision 先建庫;它在 fixture 取不到時明講「provision 是否跑過?拒跑」
# 🔴 錨點**不含正規式元字元**:原本用「provision 是否跑過?拒跑」,那個 `?` 是 **ASCII** 不是全形
#    ⇒ 在 ERE 裡是量詞、整條比不到,換成 -E 的當下這格就紅了(fail-closed 正確,但那是我的錯)。
#    這正是上面那條教訓的即時複現:**用守門自己的命令去數**,不要憑「看起來等價」。
#    現用錨點以守門的 `grep -E` 實數 = 1 命中。
excl_check s1b-verify.sh               "provision 是否跑過"              "需外部 d1t2-rehearsal provision,不自足"
# · b2s1:被自己的 exit 2 停用(已知卡死)
# 🔴 **行錨**:`exit 2` 這三個字在該檔出現兩次(`:25` 真停用 / `:32` 註解引用)⇒ 必須釘行
excl_check b2s1-concurrency-probe.sh   "^exit 2$"                       "自己 exit 2 停用(已知會卡死)"
# 🔴🔴 **2026-08-10 OP3 片新增三支(三線審查 must-fix:不得沉默)**:a8c2 / a8a1 / a8a2 家族
#    在**全量 migration 庫**上跑不動,而它們**不在本帳集合裡** ⇒ 帳面永遠全綠、沒有任何訊號。
#    · **既有債(先於 OP3)**:三支都釘 `begin_charge_attempt` 或 confirm 的 md5,而 L4a-1(08-09)
#      改過 begin ⇒ 早在 OP3 之前就拒跑。實證:2026-08-10 把 OP3 暫時移出 migrations 後重跑,
#      `a8c2-verify` 仍紅在 **begin 閘** ⇒ 這是 **backlog #370**,不是 OP3 弄壞的。
#    · **OP3 新增的理由**(要一起修才活得過來):三支以 **postgres** 連線呼叫 confirm,
#      而 OP3 的 P2B36 只放行 `payment_confirmer`;且 OP3 改了 confirm 的**定義**與 **COMMENT**
#      ⇒ `MD5_NEW` / `MD5_CONFIRM_A8C2` / `CMT_MD5_NEW` 三個釘值全部過期。
#    · 🔴 **失效條件(這條排除理由什麼時候不再成立)**:一旦 #370 修好(改用
#      `SET SESSION AUTHORIZATION 'payment_confirmer'` + 重釘上述 md5 + 對齊 begin 閘),
#      三支就該**收進本帳**;屆時本段要刪,並把它們加進 EXTRA_HARNESSES 與格數。
#    · 錨點用**變數名**不用 md5 值:值本來就會被重釘,名字才是「它釘了那個東西」的證據。
excl_check a8c2-verify.sh              "MD5_BEGIN_A8C1"                 "釘 begin md5(#370 既有債)+ 以 postgres 呼 confirm(OP3 P2B36 擋)"
excl_check a8a1-verify.sh              "MD5_CONFIRM_A8C2"               "釘 confirm md5,OP3 改了定義與 COMMENT ⇒ 需重釘(#370 一併)"
excl_check a8a2-verify.sh              "MD5_CONFIRM_A8C2"               "同 a8a1;另釘 begin(部署鏈)⇒ #370 修復時一起處理"
[ -z "$EXCL_BAD" ] \
  && ok EXCLUDED-REASONS "六支明文不收的 harness,排除理由的證據都還在(n3=require_free_port / s1b=未 provision 時拒跑 / b2s1=行錨 ^exit 2$ 的停用機制 / a8c2+a8a1+a8a2=釘 md5 且以 postgres 呼 confirm,#370)⇒ 證據整條消失時會紅在這裡" \
  || bad EXCLUDED-REASONS "排除理由失效:$EXCL_BAD ⇒ 這三支的回歸目前零自動化,理由不成立就要重新判定該不該收進帳"

# ── MIG-PREFIX-UNIQ:migration 版本前綴不得重複(2026-08-10 OP3 片立案)──────────
# 🔴 **立案理由是它今天咬了我自己兩次**:OP3 先取 `20260810140000` 撞 L5b、改 `20260810150000`
#    又撞 D 的 347-3c-3(**且那支已 apply 正式庫**)。Supabase 的 `schema_migrations` PK = 前綴
#    ⇒ 重號的第二支 apply 時會被**靜默跳過**(最貴的那種失敗:零錯誤、零症狀、功能沒上)。
# 🔴 病根不是「忘了查」,是**查過一次就當數**:我確實在 dev 查過,但 dev 一直在前進,
#    我的觀察在定案當下已經過期 ⇒ 守門要在**每次跑 check 當下重查**,不能靠人記得。
# ⚠️ 誠實邊界(兩條):
#    ① 這道比的是「**現在**的 dev + 本 worktree」;它擋不住「我查完之後、合併之前別人又取同號」
#       —— 那一段只有收割當下再跑一次才蓋得到(所以主視窗收割時也要跑)。
#    ③ **真正無競態的觀察點不在這裡**(三線審查 C2,記檔備查):前綴唯一性最終只在
#       **apply 當下對目標庫的 `supabase_migrations.schema_migrations`** 才是無競態的 ——
#       任何 repo 側的檢查都有「查完到 apply 之間別人又進去」的窗。把它做成 apply preflight
#       是流程片的工,不在本片;寫在這裡是為了讓下一個人知道這格的天花板在哪。
#    ② `dev` ref 不可解析時(淺 clone / 沒有該分支)本格**明說跳過 dev 比對**、只驗本樹,
#       不假裝比過(fail-loud 而非靜默降級)。
MIG_DIR="supabase/migrations"
MIG_SELF_DUP="$(ls "$MIG_DIR" 2>/dev/null | cut -d_ -f1 | sort | uniq -d | tr '\n' ' ')"
MIG_DEV_DUP=""
MIG_DEV_NOTE="含 dev 比對"
if git rev-parse --verify --quiet dev >/dev/null 2>&1; then
  # 同前綴但**檔名不同** = 兩支不同的 migration 搶同一個版本號(這正是 OP3 踩的形狀);
  # 同前綴同檔名 = 就是同一支,不算衝突。
  MIG_DEV_DUP="$(
    { git ls-tree -r --name-only dev -- "$MIG_DIR" | xargs -n1 basename 2>/dev/null; ls "$MIG_DIR"; } \
      | sort -u | awk -F_ '{print $1"\t"$0}' | sort | awk -F'\t' '{if($1==p&&$2!=q){print $1} p=$1;q=$2}' | sort -u | tr '\n' ' '
  )"
else
  MIG_DEV_NOTE="dev ref 不可解析"
  MIG_DEV_UNRESOLVED=1
fi
# 🔴 三線審查 nit:上一版註解寫「fail-loud 而非靜默降級」,實作卻是**綠格帶一句紅字**
#    ⇒ 宣稱 > 事實(綠格不會擋任何人)。dev 比不到 = 這格**根本沒驗到它宣稱要驗的那一半**
#    ⇒ 直接判紅,由人決定要不要在該環境放行,不由本檔替他決定。
if [ "${MIG_DEV_UNRESOLVED:-0}" = "1" ]; then
  bad MIG-PREFIX-UNIQ "dev ref 不可解析 ⇒ **與 dev 的撞號完全沒驗到**(只驗了本樹)。本格宣稱涵蓋 dev,驗不到就不給綠;在無 dev ref 的環境要放行請顯式判斷,不要讓它靜默變綠"
elif [ -n "$MIG_SELF_DUP$MIG_DEV_DUP" ]; then
  bad MIG-PREFIX-UNIQ "migration 版本前綴重複(本樹:${MIG_SELF_DUP:-無} / 與 dev:${MIG_DEV_DUP:-無})⇒ schema_migrations PK 是前綴,重號的第二支 apply 會被**靜默跳過**、功能沒上而零錯誤。改號並同步所有釘值"
else
  ok MIG-PREFIX-UNIQ "migration 版本前綴唯一($MIG_DEV_NOTE)⇒ 重號會在這裡紅;OP3 本片就是被它咬出來的形狀"
fi

echo "══ 3. 🔴 靶(六類真實失效各一發;在副本上動手腳)═══════════"
# 🔴 判別力的形狀:**改壞值、保留結構**。六發各打一種**本線真的發生過**的失效,
#    不是打「有人惡意改帳」那個零實例的威脅模型(R3 打掉前一版的理由)。
FP_BEFORE="$(shasum "$LEDGER" 2>/dev/null | cut -d' ' -f1)"
# 🔴 W7 跟片⑦:PROBE **改成釘死具名那支,不再用 `harness_set | head -1`**。
#    原本取排序第一支 ⇒ **收編一支新 harness 就會靜靜換掉四發靶打的對象**,而且沒人會發現:
#    收編 a7t 那一刻,四發靶就從 b2s2b 換成了 a7t,`check` 照樣全綠(**當時**是 29/0;
#    #354 之後是 31/0 —— 這行是史實,數字別讀成現況)。
#    靶打誰是設計決定,不該由檔名排序決定(本檔在守的正是這種「帳自己漂掉」)。
#    選 b2s2b 的理由:它是唯一走特例路徑的一支(`exits_of`=0 3、`inconc` 凍結 1),
#    靶打它才會連特例那條路一起走過。
#    🔴 **原本的誠實邊界(#354)**:四發靶只改 FAIL / sha / ts / 抽收據,**沒有一發打 `exit` 欄**,
#    也沒有一發打 inconc 凍結 ⇒ 那兩條的語意被悄悄放寬時 check 不會紅。
#    ⇒ **2026-08-10 補上靶⑤⑥**(見下),這條邊界關掉;`exits_of` 的對照表另有逐字凍結。
PROBE="b2s2b-verify.sh"
# 🔴 R1 F3/F4:第一版這道守門只問「檔案在不在」,而且不跳過後面四發 ——
#    ① 「檔案還在但已被移出 EXTRA_HARNESSES」它完全不響(靶繼續打一支不在帳上的 harness);
#    ② 標的真的不見時,靶① 對「不存在的 harness」跑 `check_one` 會拿到「從來沒被跑過」
#      ⇒ **TMUT-COV-MISSING 印 PASS**、說一句它證不到的話(靶②③④ 才會說「本靶自己壞了」)。
#    ⇒ 改成問「它還在不在集合裡、有沒有收據」,並且**命中就整節跳過**,不讓任何一格說謊。
#    🔴 #354 後這一節有**六**格。靶⑤ 另有自己的標的 `EXITS_PROBE`,但它仍**隨整節跳過**
#       —— 不做半套:PROBE 不可用時六格一起判紅。反過來,`EXITS_PROBE` 自己不可用時
#       只紅 TMUT-COV-EXITS 那一格,不牽連其他五格(它有自己的守門)。
PROBE_OK=1
harness_set | grep -Fqx "$PROBE" || { echo "  🔴 靶的標的 $PROBE 不在 harness 集合裡 ⇒ 本節六發靶沒有合法對象"; PROBE_OK=0; }
grep -Fq "$PROBE	" "$LEDGER" 2>/dev/null || { echo "  🔴 靶的標的 $PROBE 沒有收據 ⇒ 本節六發靶構造不出「動過手腳的副本」"; PROBE_OK=0; }
if [ "$PROBE_OK" = "0" ]; then
  # 🔴 整節跳過 + 六格逐一判紅(不是靜靜少六格 —— 那會讓 CELL-ACCOUNT 紅在別的理由上)
  bad TMUT-COV-MISSING  "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
  bad TMUT-COV-RED      "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
  bad TMUT-COV-STALE    "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
  bad TMUT-COV-TSDRIFT  "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
  bad TMUT-COV-EXITS    "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
  bad TMUT-COV-INCONC   "靶的標的不可用($PROBE)⇒ 本格沒有對象,拒絕當成綠"
fi
if [ "$PROBE_OK" = "1" ]; then

# ① 「跑都沒跑」:抽掉一張收據
grep -v "^$PROBE	" "$LEDGER" > "$TMPD/led-missing.tsv" 2>/dev/null
M1="$(check_one "$TMPD/led-missing.tsv" "$PROBE")"
case "$M1" in
  *"從來沒被跑過"*) ok TMUT-COV-MISSING "🔴 抽掉 $PROBE 的收據 ⇒ 當場紅並說「這支從來沒被跑過」= 對「沒人跑」有判別力" ;;
  "")               bad TMUT-COV-MISSING "收據被抽掉後仍回報帳是好的 ⇒ 這條恆真" ;;
  *)                bad TMUT-COV-MISSING "紅了但理由不是缺收據:[$M1]" ;;
esac

# ② 「跑了但紅」:把 FAIL 改成 1
sed "s/^\($PROBE	[0-9]*	\)0	/\11	/" "$LEDGER" > "$TMPD/led-red.tsv"
if ! grep -q "^$PROBE	[0-9]*	1	" "$TMPD/led-red.tsv"; then
  bad TMUT-COV-RED "sed 沒把 FAIL 改成 1(非 BSD sed?)⇒ 本靶自己壞了,不是帳的結論"
else
  M2="$(check_one "$TMPD/led-red.tsv" "$PROBE")"
  case "$M2" in
    *"收據記 FAIL=1"*) ok TMUT-COV-RED "🔴 把收據的 FAIL 改成 1 ⇒ 當場紅 = 對「跑了但沒綠」有判別力" ;;
    "")                bad TMUT-COV-RED "收據記 FAIL=1 仍回報帳是好的 ⇒ 這條恆真" ;;
    *)                 bad TMUT-COV-RED "紅了但理由不是 FAIL:[$M2]" ;;
  esac
fi

# ③ 「改了 harness 沒重跑」:把收據的 sha 改掉(等價於 harness 內容變了)
# 🔴 2026-08-09:收據新增第 7 欄 `inconc` 之後,sha 不再位於行尾 ⇒ 原本錨 `$` 的 sed 失配。
#    當時本靶**自己 fail-closed 了**(印「本靶自己壞了,不是帳的結論」)= 正確行為,
#    它沒有靜默通過。錨改成「sha + tab + 尾欄」。
sed "s/^\($PROBE	.*	\)[0-9a-f]\{40\}	\([0-9]*\)$/\1deadbeefdeadbeefdeadbeefdeadbeefdeadbeef	\2/" "$LEDGER" > "$TMPD/led-stale.tsv"
if ! grep -q "^$PROBE	.*deadbeef" "$TMPD/led-stale.tsv"; then
  bad TMUT-COV-STALE "sed 沒把 sha 改掉 ⇒ 本靶自己壞了,不是帳的結論"
else
  M3="$(check_one "$TMPD/led-stale.tsv" "$PROBE")"
  case "$M3" in
    *"沒重跑"*) ok TMUT-COV-STALE "🔴 收據的 sha 與現行 harness 不符 ⇒ 當場紅 = 對「改了沒重跑」有判別力(用內容 sha,不是 mtime)" ;;
    "")         bad TMUT-COV-STALE "sha 不符仍回報帳是好的 ⇒ 這條恆真" ;;
    *)          bad TMUT-COV-STALE "紅了但理由不是 sha:[$M3]" ;;
  esac
fi

# ④ 🔴 「新 migration 落檔、釘值檔沒同批重跑」= 08-08 02:15 那次真事故的形狀
sed "s/^\($PROBE	[0-9]*	[0-9]*	[0-9]*	\)[0-9]*	/\120000101000000	/" "$LEDGER" > "$TMPD/led-ts.tsv"
if ! grep -q "^$PROBE	.*20000101000000" "$TMPD/led-ts.tsv"; then
  bad TMUT-COV-TSDRIFT "sed 沒把釘值改舊 ⇒ 本靶自己壞了,不是帳的結論"
else
  M4="$(check_one "$TMPD/led-ts.tsv" "$PROBE")"
  case "$M4" in
    *"釘值過期"*) ok TMUT-COV-TSDRIFT "🔴 收據的 migration 尾碼比現行舊 ⇒ 當場紅 = 對「新 migration 落檔沒同批重跑」有判別力(08-08 02:15 實錘事故)" ;;
    "")           bad TMUT-COV-TSDRIFT "釘值過期仍回報帳是好的 ⇒ 這條恆真" ;;
    *)            bad TMUT-COV-TSDRIFT "紅了但理由不是釘值:[$M4]" ;;
  esac
fi

# ⑤ 🔴 **#354:`exits_of` 放寬**。靶①-④ 只動 FAIL/sha/ts/收據,**一發都沒打 `exit` 欄**
#    ⇒ 有人把預設允許集從 `0` 放寬成 `0 3`,check 一格都不會紅(這條是 B-330-STOP ⑦ 盤出的)。
#    做法兩半,缺一不可:
#      (a) **對照表逐字凍結** —— 抓**任何一支的允許集被放寬**(含預設 `*)` 那條與 b2s2b 自己那組)。
#          突變實測:改 `*)` 為 `0 3`、改 b2s2b 為 `0 3 7`,兩發都紅在這一半。
#      (b) **在一支預設集 = {0} 的 harness 上把 exit 改成 3** ——
#          🔴 措辭收窄(本輪 code-reviewer nit):(b) **不是**用來抓「集合被放寬」的,那個 (a) 就抓得到。
#          (b) 獨有的價值是抓 **`check_one` 裡那段比對邏輯自己壞掉/被拿掉** ——
#          對照表可以完全沒動,而 `[ "$ex_ok" = "1" ] || problems=…` 那行被刪掉就沒人管 exit 了。
#          突變實測:把該行換成 `:` ⇒ 對照表全綠、只有 (b) 紅。兩半各自蓋住對方看不到的壞法。
#          釘死具名 `w5-line-verify.sh`,不用 `harness_set | head -n`:靶打誰是設計決定,
#          不該由檔名排序決定(同 PROBE 那段的教訓)。
EXITS_PROBE="w5-line-verify.sh"
EXITS_MAP_NOW="$(for h in $(harness_set); do printf '%s=[%s] ' "$h" "$(exits_of "$h")"; done | sed 's/ *$//')"
# 🔴 2026-08-11 L5b-2 片 2a:加 l5b2-2a-verify.sh = **[0]**(只准乾淨離場;它沒有待裁態)。
# 🔴 2026-08-10 L5b-0-t3:加 l5b0-verify.sh / l5b0t2-verify.sh,兩支都是 **[0]**
#    (只准乾淨離場;它們沒有 b2s2b 那種「3=待裁」的語意,別給第二個碼)。
EXITS_MAP_FROZEN="a7t-concurrency-probe.sh=[0] b2s2b-verify.sh=[0 3] l5b0-verify.sh=[0] l5b0t2-verify.sh=[0] l5b2-2a-verify.sh=[0] op2b-verify.sh=[0] op3-verify.sh=[0] op4-verify.sh=[0] op5-verify.sh=[0] op6a-verify.sh=[0] opa12-verify.sh=[0] w0b-verify.sh=[0] w1-verify.sh=[0] w2-verify.sh=[0] w3a-verify.sh=[0] w3b2-verify.sh=[0] w3c1-verify.sh=[0] w3c2-verify.sh=[0] w3c3-verify.sh=[0] w4a-verify.sh=[0] w4b-verify.sh=[0] w5-line-verify.sh=[0] w6a-unvoid-race.sh=[0] w6b1-ship-vs-unvoid.sh=[0] w6b2-cancel-vs-unvoid.sh=[0] w6b3-cancel-vs-receipt.sh=[0] w6c-idem-replay.sh=[0] w7b-cancel-vs-ship-lockorder.sh=[0] w7d1-verify.sh=[0] w7d3-verify.sh=[0]"
if [ "$EXITS_MAP_NOW" != "$EXITS_MAP_FROZEN" ]; then
  bad TMUT-COV-EXITS "exits_of 對照表漂了。現行:[$EXITS_MAP_NOW]。⇒ 放寬任何一支的允許出口碼都要有人看(#354)"
elif ! harness_set | grep -Fqx "$EXITS_PROBE" || ! grep -Fq "$EXITS_PROBE	" "$LEDGER" 2>/dev/null; then
  bad TMUT-COV-EXITS "靶的標的 $EXITS_PROBE 不在集合裡或沒有收據 ⇒ 本格沒有對象,拒絕當成綠"
else
  sed "s/^\($EXITS_PROBE	[0-9]*	[0-9]*	\)0	/\13	/" "$LEDGER" > "$TMPD/led-exit.tsv"
  if ! grep -q "^$EXITS_PROBE	[0-9]*	[0-9]*	3	" "$TMPD/led-exit.tsv"; then
    bad TMUT-COV-EXITS "sed 沒把 exit 改成 3 ⇒ 本靶自己壞了,不是帳的結論"
  else
    M5="$(check_one "$TMPD/led-exit.tsv" "$EXITS_PROBE")"
    case "$M5" in
      *"該支允許的是"*) ok TMUT-COV-EXITS "🔴 把 $EXITS_PROBE 的 exit 改成 3(它只准 0)⇒ 當場紅 = 對「離場碼語意被悄悄放寬」有判別力;對照表另逐字凍結" ;;
      "")               bad TMUT-COV-EXITS "exit=3 仍回報帳是好的 ⇒ 這條恆真(exits_of 的預設集被放寬了?)" ;;
      *)                bad TMUT-COV-EXITS "紅了但理由不是 exit:[$M5]" ;;
    esac
  fi
fi

# ⑥ 🔴 **#354:inconc 凍結**。b2s2b 的待裁格數凍在 1;那條檢查被拿掉或放寬時,
#    原本一發靶都不會紅。⇒ 把它的收據 inconc 改成 5(inconc 是最後一欄)。
if ! grep -Fq "b2s2b-verify.sh	" "$LEDGER" 2>/dev/null; then
  bad TMUT-COV-INCONC "b2s2b 沒有收據 ⇒ 本格沒有對象,拒絕當成綠"
else
  sed "s/^\(b2s2b-verify.sh	.*	\)1$/\15/" "$LEDGER" > "$TMPD/led-inconc.tsv"
  if ! grep -q "^b2s2b-verify.sh	.*	5$" "$TMPD/led-inconc.tsv"; then
    bad TMUT-COV-INCONC "sed 沒把 inconc 改成 5 ⇒ 本靶自己壞了,不是帳的結論"
  else
    M6="$(check_one "$TMPD/led-inconc.tsv" "b2s2b-verify.sh")"
    case "$M6" in
      *"待裁格數"*) ok TMUT-COV-INCONC "🔴 把 b2s2b 的待裁格數改成 5(凍結值 1)⇒ 當場紅 = 對「有格從綠掉進待裁 / 待裁格被消掉」有判別力" ;;
      "")           bad TMUT-COV-INCONC "待裁格數=5 仍回報帳是好的 ⇒ 這條恆真(凍結值被拿掉了?)" ;;
      *)            bad TMUT-COV-INCONC "紅了但理由不是待裁格數:[$M6]" ;;
    esac
  fi
fi

fi   # 🔴 PROBE_OK 那個 if 收在這裡:六發靶要嘛整組跑、要嘛整組判紅,不會半套。
     #    (R2 nit:第一版這個 fi 落在下面那段註解**之後**,讀起來像 COV-NO-WRITEBACK 也被跳過。
     #     實際上那格一直在 fi 之外、兩條路徑都會發 —— 但註解位置會讓人讀錯,所以移上來。)

# 🔴 零回寫自證:六發靶只動 $TMPD 裡的副本,真收據一個位元都不該變。
#    (守在**不變量面**,不是某個瞬間的 git 狀態 —— 那是 R2 打掉前一版的理由。)
FP_AFTER="$(shasum "$LEDGER" 2>/dev/null | cut -d' ' -f1)"
[ "$FP_BEFORE" = "$FP_AFTER" ] \
  && ok COV-NO-WRITEBACK "六發靶跑完,真收據檔指紋逐位元不變 ⇒ 手腳只動到副本" \
  || bad COV-NO-WRITEBACK "真收據檔在本節前後變了(${FP_BEFORE:0:8}… → ${FP_AFTER:0:8}…)"

echo "══ 4. 覆蓋帳 ═════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"; PASS=$((PASS+1))
else
  printf '  FAIL %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或 harness 支數變了卻沒更新本值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-28s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="COV-NO-WRITEBACK EXCLUDED-REASONS MIG-PREFIX-UNIQ RECEIPT-a7t RECEIPT-b2s2b RECEIPT-l5b0 RECEIPT-l5b0t2 RECEIPT-l5b2 RECEIPT-op2b RECEIPT-op3 RECEIPT-op4 RECEIPT-op5 RECEIPT-op6a RECEIPT-opa12 RECEIPT-w0b RECEIPT-w1 RECEIPT-w2 RECEIPT-w3a RECEIPT-w3b2 RECEIPT-w3c1 RECEIPT-w3c2 RECEIPT-w3c3 RECEIPT-w4a RECEIPT-w4b RECEIPT-w5 RECEIPT-w6a RECEIPT-w6b1 RECEIPT-w6b2 RECEIPT-w6b3 RECEIPT-w6c RECEIPT-w7b RECEIPT-w7d1 RECEIPT-w7d3 SET-MATCH TMUT-COV-EXITS TMUT-COV-INCONC TMUT-COV-MISSING TMUT-COV-RED TMUT-COV-STALE TMUT-COV-TSDRIFT"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-28s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單(換格名/換格都紅得到)"; PASS=$((PASS+1))
else
  printf '  FAIL %-28s %s\n' "CELL-KEYSET" "格名集合漂了。多出:[$(comm -13 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')] 少了:[$(comm -23 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')]"; FAIL=$((FAIL+1))
fi

printf '\n════ PASS=%d FAIL=%d ════\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
exit 0
