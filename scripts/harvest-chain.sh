#!/bin/bash
# scripts/harvest-chain.sh —— 收割鏈:閘 → install → 三綠 → vitest×2 四數 → push
#
# 🎯 板列 `⟦f8-HARVESTCHAIN⟧`。**它就是「Sean 手動推 = review checkpoint」的接手者**
#   ⇒ 📌 **它判錯的代價不是一次失敗, 是一批沒被檢查的東西上了 production 分支。**
#
# 🔴🔴 **它的前身一夜被複製成十餘版**(`chain-bb` … `chain-bo`, 每版 `sed` 複製 + 手改),
#   而**只活在主視窗 session 的 scratchpad 裡** ⇒ session 消失即消失。
#   ⇒ ✅ 落成本檔。(來源副本:`~/pcm-mailbox/chain-scratch-20260906.sh`, 34 行。)
#
# 用法
#   bash scripts/harvest-chain.sh <批號>      跑一輪(批號只進 log 檔名與輸出, 不影響判斷)
#   bash scripts/harvest-chain.sh <批號> --dry-run   全部照跑, **只是不呼叫 push**
#   bash scripts/harvest-chain.sh --selftest  自檢(正負對照;🛑 **絕不會 push**)
#
# ⚠️⚠️ **`--dry-run` 不是驗收模式** —— 它答的是「**這一輪的每一道閘與判定會怎麼說**」,
#   🛑 **它答不出**:①`announce-and-push.sh` 自己會不會失敗(non-FF / ruleset / 網路)
#     ②推的那一刻樹是不是還一樣 ⇒ 📌 **一次綠的 dry-run 不代表那一發推得上去。**
#   🔵 它的用途是**兩支鏈對同一顆 HEAD 比判定**(⟦f8-HARVESTCHAIN⟧:37 批拿主視窗那支當對照)。
#   環境變數 `HARVEST_ROOT`(預設 `/Users/sean_1/pcm-website-v2`)
#
# 退出碼(🔴 **「有閘紅」與「跑完沒事」不可以同碼** —— 前身兩者都 `exit 0`)
#   0 = 全綠而且**推了**
#   3 = **有閘紅 / 前置條件不成立 / HEAD 中途動了** ⇒ **沒推**(這不是錯誤, 是它該做的事)
#   4 = **兩發 vitest 的【摘要】對不上**(不同 / 半份 / 零 passed / 有 failed)⇒ **沒推**
#   2 = 工具自己壞了
# ⚠️ **3 與 4 的界線要講清楚**(codex R1 must-fix:原本的契約與實作對不上):
#    一般的 vitest 紅會先讓 `test1` / `test2` 那兩道**閘**的 rc 非 0 ⇒ 📌 **它走的是 3, 不是 4。**
#    4 只在「兩發 rc 都 0 而摘要對不上」時才會發生 —— 那是**更少見也更可疑**的一種。
#    ⇒ 🛑 **看到 3 不要只找閘, 也要看 vitest;看到 4 表示 rc 說綠而摘要說話不算話。**
set -u

ROOT="${HARVEST_ROOT:-/Users/sean_1/pcm-website-v2}"
WORK=""
# 🔴 **紅了不刪 log**(codex R1 nit):畫面上寫「log 在 $WORK」而 EXIT trap 每次都刪掉
#    ⇒ 📌 **任何一次紅燈離場, 完整診斷證據立刻消失** —— 而那正是最需要它的時候。
KEEP_LOG=0
cleanup() { if [ "$KEEP_LOG" = 1 ]; then [ -n "$WORK" ] && echo "🔵 log 留著:$WORK" >&2; else [ -n "$WORK" ] && rm -rf "$WORK"; fi; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

# ══ 🔴🔴 判定 —— **逐項 AND, 不是數字面** ═══════════════════════════════════
#   前身逐字:`RCS=$(grep -c 'rc=0' "$OUT")` 然後拿它跟一個寫死的數字比。
#   🔬 **08:47 那一發就是被這個判準打紅的**(主視窗自陳):兩發 859/15479 **完全相同、全綠**,
#      而它印了「紅或不同, 不推」⇒ 主視窗只好手動 `announce-and-push.sh` 才把 36 批推上去。
#   ⛔ ~~我原本寫「因為多了一行含 rc=0 的說明, 數字就不是 11 了」~~ ——
#      🔴 **那個 `11` 是我從手上那份 `chain-bn` 副本抄來的, 而 08:47 出事的是 `chain-bo`**
#      (codex R1 複量:那一發是 **8 ≠ 6**)。
#      ⇒ 📌 **兩個事件、兩個數字, 我把它們接在一起了** —— 而接起來的句子讀起來完全合理。
#      ⇒ ✅ 病型是同一個(數字面)。
#   🔬 **確切的數字**(主視窗 log 量到, 2026-09-06 補):`chain-bo` 那一發
#      `grep -c 'rc=0'` **得 8**, 而判準寫 **6** ⇒ 多出來的兩行是
#      「三綠沿用…rc=0(0 cached)」那句 + 板閘輸出裡的一行。
#      ⇒ 📌 **兩行【解釋文字】就足以翻轉一個全綠的判定。**
#   ⇒ 🎯 **那個判準問的是「畫面上出現幾次 rc=0」, 而要問的是「每一道各自過了沒」。**
#     📌 **一個把【自己的輸出】當【資料來源】的判準, 會被自己的解釋文字改變結論。**
#   ⇒ ✅ 每一道閘的 rc 各自存進陣列, 放行 = 逐項 AND;**印什麼都不影響判斷**。
#
# $1 = 以空白分隔的「名字:rc」清單   $2 = 第一發摘要   $3 = 第二發摘要
# 回傳 0 = 可以推 · 3 = 有閘紅 · 4 = 兩發不一致或有紅
# 🔴 **十一道閘的名單寫在這裡, 而 `verdict` 會比對它** ——
#    codex R1 must-fix:原本只 AND「收到的項目」⇒ 📌 **漏掉一個 `add` 的那一道, 會被當成【不存在】而不是紅燈。**
#    ⇒ 一個少跑了一道閘的鏈, 與一個全過的鏈, 在判定上同形。
EXPECT_GATES='fw-live fw-json ledger deploy install nextlink boarddup tc lint build test1 test2'

verdict() {
  local gates="$1" a="$2" b="$3" item name rc got n
  # 名單完整性:每一道都要出現, 而且只出現一次
  for name in $EXPECT_GATES; do
    n=0
    for item in $gates; do [ "${item%%:*}" = "$name" ] && n=$((n+1)); done
    if [ "$n" != 1 ]; then
      echo "  🔴 閘名單對不上:$name 出現 $n 次(要 1)⇒ 有一道沒跑到或跑了兩次 ⇒ 不推"
      return 3
    fi
  done
  for item in $gates; do
    name="${item%%:*}"
    case " $EXPECT_GATES " in *" $name "*) : ;; *) echo "  🔴 名單外的閘:$name ⇒ 不推"; return 3 ;; esac
  done
  for item in $gates; do
    name="${item%%:*}"; rc="${item##*:}"
    if [ "$rc" != 0 ]; then
      echo "  🔴 閘紅:$name rc=$rc ⇒ 不推"
      return 3
    fi
  done
  # 🔴 **兩發要【逐字相同】而且【沒有 failed】** —— 兩個條件都要, 而它們各擋一半:
  #    · 相同而都紅 ⇒ 那是重現性不是通過
  #    · 不同而都綠 ⇒ 有東西在飄, 一樣不推
  if [ "$a" != "$b" ]; then
    echo "  🔴 兩發 vitest 摘要不同 ⇒ 不推"
    echo "     第1發:$a"
    echo "     第2發:$b"
    return 4
  fi
  case "$a" in
    *failed*) echo "  🔴 vitest 有 failed ⇒ 不推"; echo "     $a"; return 4 ;;
  esac
  # 🔴 **「沒有 failed」是【否定的】證據 —— 它與「半份摘要」「整批 skipped」同形**(codex R1 must-fix)
  #    ⇒ 📌 要一個**正向的數**:兩行都在, 而且 `passed` 的數字 > 0。
  case "$a" in
    *'Test Files'*) : ;;
    *) echo "  🔴 摘要裡沒有 Test Files 那一行 ⇒ 只抓到半份(或它沒跑完)⇒ 不推"; return 4 ;;
  esac
  case "$a" in
    *Tests*) : ;;
    *) echo "  🔴 摘要裡沒有 Tests 那一行 ⇒ 只抓到半份 ⇒ 不推"; return 4 ;;
  esac
  if ! printf '%s' "$a" | grep -qE '[1-9][0-9]* passed'; then
    echo "  🔴 摘要裡沒有【大於 0 的 passed】⇒ 可能整批 skipped 或根本沒跑 ⇒ 不推"
    echo "     $a"
    return 4
  fi
  echo "  🟢 每一道閘各自 rc=0 · 兩發逐字相同 · 零 failed ⇒ 推"
  return 0
}

# 🔴 **它定義在自檢【之前】** —— 第一版我放在主流程裡, 而自檢在分派時就跑了
#    ⇒ 📌 `push_step` 那時還不存在 ⇒ 呼叫失敗 ⇒ **沒有痕跡 ⇒ ⑩ 印綠**。
#    🎯 **那是一格假綠, 而抓到它的是 ⑩b 反向對照**(它要求「非 dry-run 必須留下痕跡」)。
#    ⇒ 🛑 **同一個順序坑我今天第三次踩** —— 而三次都是【反向對照】或 rc=127 抓到的, 不是我看出來的。
# 🔴 **推那一步抽成函式** —— 讓自檢驗得到「`--dry-run` 走到最後而【沒有呼叫它】」。
#    📌 若只在呼叫點寫一個 `if [ "$DRY" = 1 ]`, 那件事**只能用眼睛看**, 沒有一格證人。
PUSH_CMD="${PUSH_CMD:-bash scripts/announce-and-push.sh dev}"
push_step() {   # $1=log 檔  ⇒ 0 成功 / 非 0 失敗;dry-run 一定不呼叫 PUSH_CMD
  if [ "${DRY:-0}" = 1 ]; then
    echo "  🔵 --dry-run:**沒有呼叫** $PUSH_CMD(判定說可以推, 而本模式不推)"
    return 0
  fi
  $PUSH_CMD > "$1" 2>&1
}


# ══ 自檢(🛑 **只跑 `verdict`, 一行 git 都不碰, 絕不 push**)═══════════════
if [ "${1:-}" = "--selftest" ]; then
  p=0; f=0
  ck() { if [ "$2" = "$3" ]; then echo "  ✅ $1 (rc=$2)"; p=$((p+1)); else echo "  🔴 $1 —— 得 $2 期望 $3"; f=$((f+1)); fi; }
  run() { verdict "$1" "$2" "$3" >/dev/null 2>&1; echo $?; }
  SUM='Test Files 859 passed (859) Tests 15479 passed (15479)'
  # 🔵 依 `EXPECT_GATES` 現算一份「全部 rc=0」的清單 —— **不要在自檢裡另抄一份名單**,
  #    否則加一道閘的人改了正式路徑而自檢還在用舊名單, 📌 **兩邊會安靜地分家。**
  allz() { local g="" n; for n in $EXPECT_GATES; do g="$g $n:0"; done; printf '%s' "$g"; }
  one_bad() { local g="" n; for n in $EXPECT_GATES; do
                if [ "$n" = "$1" ]; then g="$g $n:$2"; else g="$g $n:0"; fi; done; printf '%s' "$g"; }
  drop_one() { local g="" n; for n in $EXPECT_GATES; do
                [ "$n" = "$1" ] || g="$g $n:0"; done; printf '%s' "$g"; }
  echo "══ harvest-chain 自檢 ══"
  echo "  🛑 本自檢只跑判定函式 —— 不 install、不 build、不 vitest、**不 push**。"
  echo "  🔵 閘名單:$EXPECT_GATES"
  ck "①有一道閘 rc≠0 ⇒ 3(不推)" "$(run "$(one_bad ledger 1)" "$SUM" "$SUM")" "3"
  ck "②每一道都 rc=0 ⇒ 0(推)"   "$(run "$(allz)" "$SUM" "$SUM")" "0"
  # 🔴🔴 ③ —— **本檔存在的理由那一格, 要【兩個判準各跑一次】才看得出差別**
  #    只證「新版回 0」不夠:②已經證過了。要證的是「同一份輸入, 舊判準說不推、新判準說推」。
  _old_verdict() {   # 前身的判準:數畫面上出現幾次 rc=0, 要剛好等於某個寫死的數
    local out="$1" want="$2" n
    n=$(printf '%s\n' "$out" | grep -c 'rc=0')
    [ "$n" = "$want" ] && return 0 || return 3
  }
  _sample=$(for n in $EXPECT_GATES; do printf '%s rc=0\n' "$n"; done
            printf '%s\n' '⚠️ 那道閘檔不存在, 視為 rc=0 —— 這一行是說明, 不是一道閘')
  _want=$(printf '%s\n' $EXPECT_GATES | grep -c .)
  _old_verdict "$_sample" "$_want"; _oldrc=$?
  ck "③a 舊判準對【同一份全綠輸出】⇒ 3(它被自己的說明文字打紅)" "$_oldrc" "3"
  ck "③b 新判準對同一組閘 ⇒ 0(推)" "$(run "$(allz)" "$SUM" "$SUM")" "0"
  ck "④兩發摘要不同 ⇒ 4" "$(run "$(allz)" "$SUM" 'Test Files 858 passed (858) Tests 15470 passed (15470)')" "4"
  ck "⑤兩發相同而都有 failed ⇒ 4" "$(run "$(allz)" 'Test Files 2 failed 857 passed Tests 11 failed' 'Test Files 2 failed 857 passed Tests 11 failed')" "4"
  ck "⑥摘要是空的 ⇒ 4(不當成綠)" "$(run "$(allz)" '' '')" "4"
  # 🔴 ⑦ 少一道閘 ⇒ 不推(而不是「那一道不存在所以不算」)
  ck "⑦漏掉一道 add ⇒ 3(不得被當成不存在)" "$(run "$(drop_one boarddup)" "$SUM" "$SUM")" "3"
  # 🔴 ⑧ 只有半份摘要(有 Test Files 沒有 Tests)⇒ 不推 —— 它與全綠都「沒有 failed」
  ck "⑧只抓到半份摘要 ⇒ 4" "$(run "$(allz)" 'Test Files 859 passed (859)' 'Test Files 859 passed (859)')" "4"
  # 🔴 ⑨ 整批 skipped(零 passed)⇒ 不推 —— 它也「沒有 failed」
  # 🔴 ⑩ `--dry-run` 走到最後而【沒有呼叫 push】—— 而它要**證得出來**, 不是用眼睛看。
  #    做法:把 PUSH_CMD 換成一支會**留下痕跡**的樁, 然後看那個痕跡在不在。
  _mark="$(mktemp -d)/pushed"
  ( DRY=1 PUSH_CMD="touch $_mark" ; push_step /dev/null ) >/dev/null 2>&1
  if [ -f "$_mark" ]; then ck "⑩dry-run 不得呼叫 push" "有痕跡" "沒有痕跡"; else ck "⑩dry-run 不得呼叫 push" "沒有痕跡" "沒有痕跡"; fi
  # 🟢 ⑩b 反向對照:同一支樁, 非 dry-run ⇒ **必須**留下痕跡(證明上面那個「沒有」不是因為樁壞了)
  ( DRY=0 PUSH_CMD="touch $_mark" ; push_step /dev/null ) >/dev/null 2>&1
  if [ -f "$_mark" ]; then ck "⑩b 反向對照:非 dry-run ⇒ 真的會呼叫" "有痕跡" "有痕跡"; else ck "⑩b 反向對照:非 dry-run ⇒ 真的會呼叫" "沒有痕跡" "有痕跡"; fi
  rm -rf "$(dirname "$_mark")"
  ck "⑨零 passed(整批 skipped)⇒ 4" "$(run "$(allz)" 'Test Files 0 passed (859) Tests 0 passed 15479 skipped' 'Test Files 0 passed (859) Tests 0 passed 15479 skipped')" "4"
  echo "  ── $p PASS / $f FAIL"
  [ "$f" = 0 ] && { echo "全部通過。"; exit 0; } || { echo "🔴 有格子沒過"; exit 1; }
fi

BATCH=""; DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -*) echo "🔴 不認得的參數:$arg" >&2; exit 2 ;;
    *) BATCH="$arg" ;;
  esac
done
export DRY
[ -n "$BATCH" ] || { echo "用法:bash scripts/harvest-chain.sh <批號> [--dry-run]  或  --selftest" >&2; exit 2; }
[ "$DRY" = 1 ] && echo "🔵 --dry-run:全部照跑, 而**不會呼叫 push**(它不是驗收模式, 見檔頭)"
cd "$ROOT" || exit 2
WORK=$(mktemp -d) || exit 2   # 🔵 log 落 mktemp, 不寫死 scratchpad(session 消失即消失)

GATES=""
add() { GATES="$GATES $1:$2"; }
say() { echo "$*"; }

# 🔴🔴 **釘住 HEAD**(codex R1 must-fix):原本只把它【印出來】而沒有釘。
#    ⇒ 📌 測的是這一顆, 而最後 `announce-and-push.sh` 推的是**當下的 `dev` tip** ——
#      測試那十幾分鐘裡別的窗多 commit 一顆, **那一顆從來沒被這一輪驗過就上了 production 分支**,
#      而本鏈回 0。⇒ ✅ 推之前比一次, 不同就不推。
PINNED=$(git rev-parse HEAD) || exit 2

# 🔴🔴 **工作樹與 index 都要乾淨**(codex R1 must-fix):
#    📌 一個沒 commit 的修補可以讓三綠與 vitest 全過, 而**推上去的是【沒有那個修補】的樹**
#    ⇒ 🛑 **「我這裡是綠的」與「推上去的是綠的」是兩件事。**
if [ -n "$(git status --porcelain)" ]; then
  say "🔴 工作樹或 index 不乾淨 ⇒ 三綠可能是【沒 commit 的東西】撐出來的, 而推的是沒有它的樹 ⇒ 不跑"
  git status --porcelain | head
  exit 3
fi

say "══ 收割鏈 批號 $BATCH · HEAD=$(git rev-parse --short HEAD) · log 在 $WORK ══"

python3 scripts/vercel-firewall-cron-order-check.py > "$WORK/fw-live.log" 2>&1; add fw-live $?
python3 scripts/vercel-json-waf-cron-gate.py         > "$WORK/fw-json.log" 2>&1; add fw-json $?
if [ -f scripts/applied-ledger-dup-gate.py ]; then
  python3 scripts/applied-ledger-dup-gate.py > "$WORK/ledger.log" 2>&1; add ledger $?
else
  # 🔴 **檔不在 ⇒ fail-closed**(codex R1 must-fix):原本記 `ledger:0` 並印一行警告 ——
  #    📌 **那就是把「沒檢查」講成「通過」**, 而同 repo 的 husky 薄殼對同情境是明確 fail-closed。
  #    ⇒ 要跳過它必須是一個【人的決定】, 不是一個檔案不存在的副作用。
  say "  🔴 scripts/applied-ledger-dup-gate.py 不存在 ⇒ 這一道【沒有跑】⇒ 不推(要跳過請自己決定並改本檔)"
  add ledger 90
fi
# 🔴 **板列重複在這裡【再查一次】**(codex R1 must-fix):姊妹檔 `harvest-merge-line.sh` 撈到 dup 會回 6,
#    ⇒ 📌 **而那顆壞掉的 merge 已經在 `dev` 上了** —— 若那時沒有人手動處理, 本鏈照樣會把它推上去。
#    ⇒ ✅ 推之前自己再問一次。(那支檢查的板路徑寫死, 只能對當下的樹問。)
if python3 scripts/board-state-consistency.py > "$WORK/boarddup.log" 2>&1; then
  if grep -q '同一個錨佔了兩列以上' "$WORK/boarddup.log"; then add boarddup 92; else add boarddup 0; fi
else
  if grep -q '同一個錨佔了兩列以上' "$WORK/boarddup.log"; then add boarddup 92; else add boarddup 0; fi
fi

printf 'refs/heads/dev %s refs/heads/dev %s\n' "$(git rev-parse HEAD)" "$(git rev-parse origin/dev)" \
  | bash scripts/deploy-order-gate.sh > "$WORK/deploy.log" 2>&1; add deploy $?

pnpm install --frozen-lockfile --config.confirmModulesPurge=false > "$WORK/install.log" 2>&1; add install $?
# 🔵 裝完看【目錄/連結】不看 rc(既有規矩:pnpm 可能 rc=0 而什麼都沒裝)
# 🔴 **而只比字串外形不夠**(codex R1 must-fix):一條**懸空的**或指向舊版的 symlink
#    外形一模一樣而它指到的東西不在 ⇒ 📌 那時本閘綠, 而 build 用的是另一套依賴。
#    ⇒ ✅ 外形對 **且** 目標真的存在。
if readlink apps/admin/node_modules/next | grep -q '^\.\./\.\./\.\./node_modules/\.pnpm/' \
   && [ -e apps/admin/node_modules/next ]; then add nextlink 0; else add nextlink 91; fi

TURBO_FORCE=1 pnpm typecheck > "$WORK/tc.log"    2>&1; add tc $?
TURBO_FORCE=1 pnpm lint      > "$WORK/lint.log"  2>&1; add lint $?
TURBO_FORCE=1 pnpm build     > "$WORK/build.log" 2>&1; add build $?

# ── vitest 連跑兩發(鐵則 11)────────────────────────────────────────────
# 🔴 **鐵則 11 第四個數「我餵幾條 vs 它跑幾支」—— 本鏈【答不出來】, 明寫。**
#    ⛔ ~~我原本寫「由 `Test Files` 那個總數承擔」~~ —— codex R1 must-fix:**那句是假的**。
#    📌 本鏈**沒有一個獨立的「應該有幾支」** ⇒ 它只知道「這一發跑了 N 支」,
#      而 N 是 vitest 自己數的。⇒ 🛑 **設定若穩定地排掉一整族測試, 兩發會【完全相同】而照樣放行。**
#    ⚠️ 這是**已知缺口**, 不是被守住的一格:
#      · 兩發比對擋得住「**這一次**少跑了」(飄動)
#      · 擋不住「**一直**少跑」(穩定的漏)
#    ⇒ 🔵 要補它得有一份**期望檔數**的來源(而那份來源今天不存在, 誰也沒有維護它)。
# 🔌 **插槽(先不做)**:⟦ship-BROWSERFAMILY⟧ b 那條路要「全套排除瀏覽器族 + 族序列跑一發」——
#    📌 今天**不接**, 因為那會把「哪些算瀏覽器族」變成本檔的一個新判準, 而那份名單還沒有人定。
#    ⇒ 要接的時候改這兩行加 `--exclude`, 並在下面多一組 `add browser $?`。
pnpm vitest --run --maxWorkers=2 > "$WORK/t1.log" 2>&1; add test1 $?
pnpm vitest --run --maxWorkers=2 > "$WORK/t2.log" 2>&1; add test2 $?
SUM1=$(grep -E 'Test Files|^ +Tests ' "$WORK/t1.log" | tr -s ' ' | tr '\n' ' ')
SUM2=$(grep -E 'Test Files|^ +Tests ' "$WORK/t2.log" | tr -s ' ' | tr '\n' ' ')

say "── 逐道 rc ──"
for it in $GATES; do say "   ${it%%:*} rc=${it##*:}"; done
say "── vitest 兩發 ──"
say "   第1發:$SUM1"
say "   第2發:$SUM2"

verdict "$GATES" "$SUM1" "$SUM2"; V=$?
if [ "$V" != 0 ]; then
  KEEP_LOG=1
  grep -h '^ FAIL ' "$WORK/t1.log" | sort -u | head
  say "   實測 origin/dev=$(git ls-remote origin refs/heads/dev | cut -c1-9)"
  exit "$V"
fi

# 🔴 **推之前再比一次 HEAD** —— 測的那一顆與要推的那一顆必須是同一顆。
NOW=$(git rev-parse HEAD) || exit 2
if [ "$NOW" != "$PINNED" ]; then
  say "🔴 HEAD 在這一輪中間動了:$(printf '%s' "$PINNED" | cut -c1-9) ⇒ $(printf '%s' "$NOW" | cut -c1-9)"
  say "   ⇒ 📌 新的那幾顆【沒有被這一輪驗過】⇒ 不推。重跑一輪。"
  exit 3
fi
if [ -n "$(git status --porcelain)" ]; then
  say "🔴 跑完之後工作樹不乾淨了(有東西在這一輪中間被寫進來)⇒ 不推"
  exit 3
fi

push_step "$WORK/push.log"; PRC=$?
say "   push rc=$PRC"
if [ "$PRC" != 0 ]; then KEEP_LOG=1; tail -5 "$WORK/push.log"; exit 2; fi
say "   實測 origin/dev=$(git ls-remote origin refs/heads/dev | cut -c1-9) 未推=$(git rev-list --count origin/dev..HEAD)"
exit 0
