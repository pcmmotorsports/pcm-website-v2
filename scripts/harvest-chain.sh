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
#   4 = **兩發的【摘要】對不上**(不同 / 半份 / 零 passed / 有 failed)⇒ **沒推**(主段與族段都算)
#   5 = **第五數對不上(分母)** —— 主段檔數 ≠ `--split-check` 的全套, 或族段檔數 ≠ 這族,
#       或那兩個分母根本撈不到 ⇒ **沒推**
#   2 = 工具自己壞了
# 🔴 **5 是 2026-09-06 加的, 而它【差一點又漏在這裡】** —— R1 抓到:碼 `:400`/`:405` 會 `exit 5`
#    而本段只列了 0/3/4/2。⚠️ **同一段下面第三行就寫著「原本的契約與實作對不上」** ⇒ 同型缺陷復發。
#    📌 **一個把退出碼寫在註解裡的契約, 不會因為碼多了一條路而自己更新。**
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
# $1 = 「名字:rc」清單 · $2/$3 = 主段兩發摘要 · $4/$5 = 族段兩發摘要 · $6 = 全套 T · $7 = 這族 F
# 回傳 0 = 可以推 · 3 = 有閘紅 · 4 = 兩發不一致或有紅 · **5 = 第五數對不上(分母)**
# 🟡 **第五數 = 兩個【獨立分母】各自對**(主視窗 -f8 2026-09-06 裁 auth-007=A):
#      主段 Test Files 總數 == `--split-check` 的「全套」
#      族段 Test Files 總數 == `--split-check` 的「這族」
#    🔴 **它買到的是【一個不是 vitest 自己數出來的分母】** —— 兩發比對只證重現性:
#      擋得住「這一次少跑了」, 擋不住「一直少跑」(而 browser 那族正是後者的形狀)。
# 🔴 **閘的名單寫在下面那一行 `EXPECT_GATES`, 而 `verdict` 會比對它** ——
#    ⛔ ~~十一道~~ **R1 抓到:寫死的道數會過期**(當時 11, 加了三道之後是 15)
#    ⇒ 📌 **要知道幾道就去數那一行**:`sed -n "s/^EXPECT_GATES='\(.*\)'/\1/p" 本檔 | wc -w`。
#    🛑 **一個寫死在註解裡的計數, 與它旁邊那一行分家的時候不會有任何東西紅。**
#    codex R1 must-fix:原本只 AND「收到的項目」⇒ 📌 **漏掉一個 `add` 的那一道, 會被當成【不存在】而不是紅燈。**
#    ⇒ 一個少跑了一道閘的鏈, 與一個全過的鏈, 在判定上同形。
# 🟡 **2026-09-06 加三道(⟦ship-BROWSERFAMILY⟧ 接線, 主視窗 -f8 批 auth-006 + 裁 auth-007=A)**:
#    `splitcheck`(當場拿分母)· `btest1` / `btest2`(族段兩發)。
# 🟡 **2026-09-06 再加七道(⟦db-MERGEBLINDGATE⟧, 主視窗 -f1 裁甲)**:那七道是 pre-commit 上
#    【掃整棵樹】而 harvest-chain 沒跑過的 —— 逐支比對的分母見那一列。**只報不擋**(見 add_report)。
#    🔬 數法:pre-commit 掛 19 支(`grep -cE '^\s*(sh|bash)\s+' .husky/pre-commit`);
#      其中 harvest 已涵蓋 1(applied-ledger-dup)· 沒跑 18 · 而 18 裡 11 支讀 staged
#      (merge 之後 staged 是空的 ⇒ 接進來會空轉)⇒ **接得動的是 7 支**。
EXPECT_GATES='fw-live fw-json ledger deploy install nextlink boarddup tc lint build test1 test2 splitcheck btest1 btest2 zshshebang viewapply undefassert rlspolicy resetrole acldrift isolation'
# 🟡 **只報不擋的那一族(⟦db-MERGEBLINDGATE⟧)** —— 它們**必須在 `EXPECT_GATES` 裡**(所以「少跑一支」抓得到),
#    而 `verdict` **不把它們的 rc 算進放行判定**。
# 🔴 **這個名單放在【判定函式看得到的地方】, 不是靠呼叫端記得用哪個 helper** ——
#    下一個人把 `add_report` 改成 `add`, 這七道會默默變成會擋推的, 而沒有任何東西會說。
#    ⇒ 📌 保證要住在判定裡。selftest ⑦c 就是量這一格。
REPORT_ONLY='zshshebang viewapply undefassert rlspolicy resetrole acldrift isolation'

verdict() {
  local gates="$1" a="$2" b="$3" ba="$4" bb="$5" T="$6" F="$7" item name rc got n mt ft
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
      # 🟡 只報不擋那一族:印出來, 而**不改放行判定**(見 REPORT_ONLY 的註解)
      case " $REPORT_ONLY " in
        *" $name "*) echo "  🟡🔴 只報不擋:$name rc=$rc ⇒ **不擋推, 而你要自己去讀那支 log**"; continue ;;
      esac
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
  # ══ 🟡 族段(browser family)—— 與主段【同一套】健全性檢查 ═══════════════
  #    🔴 不共用一份程式碼就會分家:主段修過的四個坑(不同 / 有 failed / 半份 / 零 passed),
  #      族段一個都不能少。⇒ 這裡逐項照抄同一組判準, 而受詞換成族段。
  if [ "$ba" != "$bb" ]; then
    echo "  🔴 兩發【族段】摘要不同 ⇒ 不推"; echo "     第1發:$ba"; echo "     第2發:$bb"; return 4
  fi
  case "$ba" in *failed*) echo "  🔴 族段有 failed ⇒ 不推"; echo "     $ba"; return 4 ;; esac
  case "$ba" in *'Test Files'*) : ;; *) echo "  🔴 族段摘要沒有 Test Files 那一行 ⇒ 只抓到半份 ⇒ 不推"; return 4 ;; esac
  case "$ba" in *Tests*) : ;; *) echo "  🔴 族段摘要沒有 Tests 那一行 ⇒ 只抓到半份 ⇒ 不推"; return 4 ;; esac
  if ! printf '%s' "$ba" | grep -qE '[1-9][0-9]* passed'; then
    echo "  🔴 族段沒有【大於 0 的 passed】⇒ 可能整批 skipped 或根本沒跑 ⇒ 不推"; echo "     $ba"; return 4
  fi

  # ══ 🔴🔴 第五數:兩個獨立分母各自對 ══════════════════════════════════════
  #    取的是 `Test Files … (N)` 那個【括號裡的總數】—— 它含 skipped,
  #    而 `--split-check` 數的是**檔案存在幾支** ⇒ 兩邊同一個單位。
  #    ⚠️ **不可以用 Tests(測項數)** —— `skipped` 與 `it.each` 的展開會動它(ship 2026-09-06 Q2)。
  #    🔴🔴 **而 `T` 與 `mt` 是【兩把結構不同的尺】(R1 抓到, 寫出來)**:
  #      `T`  來自 `browser-test-family.py` 走檔案系統掃 `apps|packages|scripts` 三個根
  #      `mt` 來自 vitest 自己解析 **projects** 之後回報的檔數
  #      ⇒ 📌 **它們今天相等是【實測】不是【定義】** —— 新增一支測試檔若落在那三個根之外,
  #        或落進 vitest 的 exclude, 兩把尺就會分家 ⇒ 這道閘會**擋整條鏈**。
  #      🔵 方向是 fail-closed(誤擋), 而**誤擋的那一天訊息要看得懂** ⇒ 下面兩句話各印出兩個數。
  # 🔴🔴 **codex gpt-6-astra 抓到:`[^(]*` 會【穿過 Tests 那一段】去借它的括號。**
  #    ⛔ ~~`sed -n 's/.*Test Files[^(]*(\(…\)).*/\1/p'` 直接餵整串~~
  #    🔬 複現(逐字):餵 `Test Files 858 passed Tests 859 passed (859)` ⇒ 抽到 **859**
  #      ⇒ 📌 **檔數的括號【缺席】時, 它把測項總數當成檔數** ⇒ 兩發一致、名稱都在、passed>0
  #        ⇒ 🛑 **放行了不該放行的。**
  #    ✅ 修法:**先切掉 ` Tests ` 之後那半**, 再抽括號 ⇒ 缺括號就抽不到 ⇒ 空 ⇒ 下面 return 5。
  #      🟢 正對照:完整摘要 ` Test Files 870 passed | 1 skipped (871)  Tests …(15647) ` ⇒ 仍抽到 **871**。
  _files_paren() { sed 's/ Tests .*//' | sed -n 's/.*Test Files[^(]*(\([0-9][0-9]*\)).*/\1/p'; }
  mt="$(printf '%s' "$a"  | _files_paren)"
  ft="$(printf '%s' "$ba" | _files_paren)"
  if [ -z "$T" ] || [ -z "$F" ]; then
    echo "  🔴 分母是空的(--split-check 沒撈到「全套 / 這族」那兩個數)⇒ 不推"
    echo "     🛑 空分母與『對得上』不可以同形 —— 撈不到就是撈不到。"
    return 5
  fi
  if [ -z "$mt" ] || [ -z "$ft" ]; then
    echo "  🔴 摘要裡撈不到 Test Files 的括號總數(主段[$mt] / 族段[$ft])⇒ 不推"; return 5
  fi
  if [ "$mt" != "$T" ]; then
    echo "  🔴 第五數:主段跑了 $mt 支, 而 --split-check 說全套是 $T ⇒ 不推"
    echo "     🛑 差的那幾支【不會紅, 它們只是不存在】—— 少一批綠, 而兩發都是綠的。"
    return 5
  fi
  if [ "$ft" != "$F" ]; then
    echo "  🔴 第五數:族段跑了 $ft 支, 而 --split-check 說這族是 $F ⇒ 不推"
    echo "     🛑 同上 —— 族段是最可能出現「這一發剛好沒跑起來」的那一段。"
    return 5
  fi
  echo "  🟢 每一道閘各自 rc=0 · 兩段各自兩發逐字相同 · 零 failed"
  echo "  🟢 第五數:主段 $mt == 全套 $T · 族段 $ft == 這族 $F ⇒ 推"
  return 0
}

# 🔴🔴 **codex gpt-6-astra 抓到:兩條各自 `head -1` ⇒ T 與 F 可能來自【不同行】。**
#    ⛔ ~~`sed …全套…| head -1` 與 `sed …這族…| head -1` 兩條分開撈~~
#    🔬 複現:餵一份第一行是「歷次量測:全套 859 支 = 這族 13 + 其餘 846」的 log
#      ⇒ 現行解析得 **T=859 / F=13**, 而那一發真正的結果行是 871/13
#      ⇒ 📌 主段只要真的跑 859 支就會【對上】而放行, 實際比當場全套少 12 支 ⇒ 🛑 **放行了不該放行的。**
#    ✅ 修法(抽成函式, 讓自檢摸得到):**只認完整的結果行形狀**, 而且**恰好一筆**;
#      T 與 F 從**同一筆**取。0 筆或多筆 ⇒ 兩個都回空 ⇒ `verdict` 走 return 5(不猜)。
split_denoms() {   # $1=split.log 路徑 ⇒ 印 "T F";任何不確定一律印空
  local n line
  n=$(grep -cE '全套 [0-9]+ 支 = 這族 [0-9]+ ' "$1" 2>/dev/null || true)
  [ "$n" = "1" ] || { printf ' \n'; return 0; }
  line=$(grep -E '全套 [0-9]+ 支 = 這族 [0-9]+ ' "$1")
  printf '%s %s\n' \
    "$(printf '%s' "$line" | sed -n 's/.*全套 \([0-9][0-9]*\) 支 = 這族 [0-9][0-9]* .*/\1/p')" \
    "$(printf '%s' "$line" | sed -n 's/.*全套 [0-9][0-9]* 支 = 這族 \([0-9][0-9]*\) .*/\1/p')"
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
  # 🟡 **族段與分母的預設值** —— 讓既有的格子【一個字都不用改】就仍然在問它們原本問的事。
  #    🔴 而預設值必須與 `SUM` 一致(主段 859 ⇒ 全套預設 859), 否則既有的格子會因為
  #      一個【與它們無關的新判準】而紅 ⇒ 那種紅會讓人去改對的格子。
  BSUM_OK='Test Files 10 passed (10) Tests 94 passed (94)'
  run() { verdict "$1" "$2" "$3" "${4-$BSUM_OK}" "${5-$BSUM_OK}" "${6-859}" "${7-10}" >/dev/null 2>&1; echo $?; }
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
  # ── 🟡 只報不擋那七道(⟦db-MERGEBLINDGATE⟧, 2026-09-06)——【兩格缺一不可】────
  # 🔴 ⑦b 少跑其中一道 ⇒ 仍然不推。
  #    它與 ⑦ 是同一條規矩, 而**要對這七道各自再演一次** ——
  #    📌 因為它們的 rc 恆為 0, 一個「少跑了」與一個「跑了而綠」在 rc 上完全一樣,
  #      **能分開它們的只有名單那一關**。
  ck "⑦b 漏掉只報那族的一道(acldrift)⇒ 3" "$(run "$(drop_one acldrift)" "$SUM" "$SUM")" "3"
  # 🔴🔴 ⑦c —— **這一格就是「只報不擋」的證明**, 沒有它我只是在宣稱。
  #    那七道之一 rc≠0 ⇒ **仍然要推**(0), 而 ①(一般閘 rc≠0 ⇒ 3)就在上面幾行 ——
  #    ⇒ 📌 兩格擺在一起才看得出「這七道與其他十五道走的是不同規矩」。
  #    ⚠️ 而 `one_bad` 改的是 GATES 字串裡那一項的 rc ——
  #      真跑時 `add_report` 記進去的**恆為 0**, 所以真跑不會出現這個輸入;
  #      這一格量的是**判定函式**對這種輸入的反應, 不是真跑。**射程照寫。**
  ck "⑦c 只報那族之一 rc≠0 ⇒ 仍 0(推)—— 這一格證明它【只報不擋】" "$(run "$(one_bad acldrift 1)" "$SUM" "$SUM")" "0"
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
  # ══ 🟡 條件② 那四發(主視窗 -f8 2026-09-06 裁 auth-007 §四)══════════════
  #    🔴 **這四格要的是「對不上會不會紅」, 不是「對得上會不會綠」** ——
  #      後者 ② 已經證過了, 而**一個只證得了綠的守門, 在它自己壞掉那天也是綠的**。
  ck "⑪主段檔數與全套 T 對不上 ⇒ 5(不推)" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" "$BSUM_OK" 861 10)" "5"
  ck "⑫族段檔數與這族 F 對不上 ⇒ 5(不推)" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" "$BSUM_OK" 859 12)" "5"
  ck "⑬兩個分母都對上 ⇒ 0(推;⑪⑫ 的紅不是恆紅)" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" "$BSUM_OK" 859 10)" "0"
  ck "⑭--split-check 自己 rc≠0 ⇒ 3(不得當成「沒有要排除的」繼續)" \
     "$(run "$(one_bad splitcheck 1)" "$SUM" "$SUM")" "3"
  # 🔴 分母是【空的】—— 它與「對得上」不可以同形(撈不到那兩個數的世界)
  ck "⑮分母撈不到(空字串)⇒ 5(不推)" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" "$BSUM_OK" '' '')" "5"
  # 🔴 族段自己的健全性:主段修過的四個坑, 族段一個都不能少
  ck "⑯族段兩發不同 ⇒ 4" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" 'Test Files 9 passed (9) Tests 90 passed (90)' 859 10)" "4"
  ck "⑰族段整批 skipped(零 passed)⇒ 4" \
     "$(run "$(allz)" "$SUM" "$SUM" 'Test Files 0 passed (10) Tests 0 passed 94 skipped' 'Test Files 0 passed (10) Tests 0 passed 94 skipped' 859 10)" "4"
  # ══ 🟡 R1 抓到的三條【零證人分支】(2026-09-06)══════════════════════════
  #    🔴 三條都是**碼裡有、而 19 格裡沒有任何一格走到它** ——
  #      📌 一條沒有證人的分支, 與一條**被刪掉**的分支, 在全綠的自檢底下同形。
  ck "⑱摘要有 Test Files 而【撈不到括號總數】⇒ 5(不是當成對上)" \
     "$(run "$(allz)" 'Test Files 859 passed Tests 15479 passed' 'Test Files 859 passed Tests 15479 passed' "$BSUM_OK" "$BSUM_OK" 859 10)" "5"
  # 🔴 ⑲⑳ 補的是**族段**那兩條 —— `:124-125` 逐字宣稱「主段修過的四個坑一個都不能少」,
  #    而在這之前**碼有四條、證人只有兩條**(⑯兩發不同 · ⑰零 passed)。
  ck "⑲族段有 failed ⇒ 4" \
     "$(run "$(allz)" "$SUM" "$SUM" 'Test Files 1 failed | 9 passed (10) Tests 3 failed | 91 passed (94)' 'Test Files 1 failed | 9 passed (10) Tests 3 failed | 91 passed (94)' 859 10)" "4"
  ck "⑳族段只抓到半份摘要(有 Test Files 沒有 Tests)⇒ 4" \
     "$(run "$(allz)" "$SUM" "$SUM" 'Test Files 10 passed (10)' 'Test Files 10 passed (10)' 859 10)" "4"
  # ══ 🟡 codex gpt-6-astra 抓到的兩條(2026-09-06)—— 兩條都是【放行了不該放行的】═══
  # ㉑ 檔數的括號【缺席】時, 舊版 `[^(]*` 會穿過 `Tests` 去借它的括號 ⇒ 把測項總數當檔數。
  #    🔬 反例逐字取自 codex:`Test Files 858 passed Tests 859 passed (859)`
  #    ⇒ 舊版抽到 859 == T ⇒ 兩發一致、名稱都在、passed>0 ⇒ **全綠放行**。
  #    ⚠️ ⑱ 是把【兩邊括號一起】拿掉, 測不到這條【借用】路徑 —— codex 逐字點名。
  ck "㉑檔數括號缺席時不得借用 Tests 的括號 ⇒ 5" \
     "$(run "$(allz)" 'Test Files 858 passed Tests 859 passed (859)' 'Test Files 858 passed Tests 859 passed (859)' "$BSUM_OK" "$BSUM_OK" 859 10)" "5"
  # ㉒ 分母解析:T 與 F 必須來自【同一行】, 而且那種行要【恰好一筆】。
  #    🔬 反例:log 第一行是「歷次量測:全套 859 支 = 這族 13 + 其餘 846」⇒ 舊版兩條各自 head -1
  #      ⇒ T=859(舊行)/ F=13 ⇒ 主段只要真跑 859 支就對上而放行, 實際比當場全套少 12 支。
  #    🔵 這一格測的是 `split_denoms`(本檔函式), 不是 `verdict` —— 它是**上游那一半**。
  _sd_dir="$(mktemp -d)"
  printf '%s\n' '歷次量測:全套 859 支 = 這族 13 + 其餘 846' '① 全套 871 支 = 這族 13 + 其餘 858  ✅' > "$_sd_dir/two.log"
  printf '%s\n' '① 全套 871 支 = 這族 13 + 其餘 858  ✅' > "$_sd_dir/one.log"
  printf '%s\n' '這一份沒有結果行' > "$_sd_dir/none.log"
  ck "㉒a 兩筆結果行 ⇒ 分母回空(不猜)" "[$(split_denoms "$_sd_dir/two.log")]" "[ ]"
  ck "㉒b 零筆結果行 ⇒ 分母回空"       "[$(split_denoms "$_sd_dir/none.log")]" "[ ]"
  # 🟢 正對照:恰好一筆 ⇒ 要拿得到, 而且 T 與 F 來自同一行
  ck "㉒c 正對照 恰好一筆 ⇒ 拿到 871 13"  "[$(split_denoms "$_sd_dir/one.log")]" "[871 13]"
  # 🔴 而【空分母】要真的讓 verdict 回 5 —— 上下游接起來才算數
  ck "㉒d 空分母餵進 verdict ⇒ 5" \
     "$(run "$(allz)" "$SUM" "$SUM" "$BSUM_OK" "$BSUM_OK" '' '')" "5"
  rm -rf "$_sd_dir"
  echo "  ── $p PASS / $f FAIL"
  # 🔴🔴 **自檢自己也要有一個【不是它自己數出來的】分母**(R1 抓到, 2026-09-06)——
  #    ⛔ ~~本段原本只看 `$f = 0`~~ ⇒ 📌 **漏寫一格 `ck` 會印 `18 PASS / 0 FAIL` 而照樣「全部通過」。**
  #    🛑 **那正是本片在替收割鏈修的那個病**(兩發相同只證重現性, 證不了分母)—— 同型, 在自檢這一層。
  #    ⚠️ 加一格 `ck` 必同步改這個數;數法 = 跑一發看 `$p`。
  EXPECT_CELLS=29   # 🟡 2026-09-06 +2:⑦b/⑦c(只報不擋那一族, ⟦db-MERGEBLINDGATE⟧)
  if [ "$f" = 0 ] && [ "$p" != "$EXPECT_CELLS" ]; then
    echo "🔴 零 FAIL 但格數不對(PASS=$p ≠ EXPECT_CELLS=$EXPECT_CELLS)⇒ 有格被刪/被跳過, 判為未通過"
    exit 1
  fi
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
# 🔴 **每一道跑完【立刻】印一行**(2026-09-06 第一次真跑之後補;主視窗指定)——
#    🔬 那一發從印完 banner 到印逐道 rc **沉默了十幾分鐘**(中間 install + 三綠 + vitest ×2)
#    ⇒ 📌 **一支跑十幾分鐘而不出聲的工具, 與一支卡住的工具長得一樣。**
#    ⚠️ **它只印, 不參與判定** —— 判定仍然是收尾那一次逐項 AND
#      (前身的病就是**拿自己印的東西當資料來源**, 不要在這裡把它請回來)。
_T0=$(date +%s)
add() {
  local now el; now=$(date +%s); el=$((now - _T0)); _T0=$now
  GATES="$GATES $1:$2"
  printf '   · %-9s rc=%-3s %ss\n' "$1" "$2" "$el"
}
say() { echo "$*"; }

# 🔵 **只報不擋的那一族**(主視窗 2026-09-06 裁甲):它們進 `EXPECT_GATES`(所以「少跑一支」抓得到),
#    而**記進 GATES 的 rc 一律 0** ⇒ 📌 **它們紅不會擋推**, 只會在畫面上留一行。
#    🔴 **而這是刻意的取捨, 要寫出來**:這 7 道是別人 merge 進來的東西會踩到的那一類
#    (RLS / ACL / migration 角色 / 隔離層級), 而**它們從來沒有在合併結果上跑過** ——
#    先讓它看得見, 「要不要擋」是另一顆, 由人決定。
#    ⚠️ **代價**:一個真紅在這裡**不會停下這條鏈**。看到 🟡 要自己去讀那支 log。
add_report() {
  local now el; now=$(date +%s); el=$((now - _T0)); _T0=$now
  GATES="$GATES $1:0"
  if [ "$2" = 0 ]; then
    printf '   · %-9s rc=%-3s %ss  🟡只報\n' "$1" "$2" "$el"
  else
    printf '   · %-9s rc=%-3s %ss  🟡🔴只報不擋 —— 去讀 %s/%s.log\n' "$1" "$2" "$el" "$WORK" "$1"
  fi
}

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

# ── 🟡 只報不擋的七道(⟦db-MERGEBLINDGATE⟧)────────────────────────────────
# 🔴 **為什麼在這裡**:`git merge` 不跑 pre-commit ⇒ 別人 merge 進來的東西**從來沒有被這七道掃過**。
#    這一段讓它們**第一次在合併結果上跑**。只報不擋 —— 見 add_report 的註解。
# 🛑 **檔不在 ⇒ 記 rc=97 並印出來**, 不當成 0(那會把「沒檢查」講成「通過」)。
for _pair in \
  'zshshebang:.husky/zsh-shebang-gate.sh' \
  'viewapply:.husky/view-apply-gate.sh' \
  'undefassert:.husky/undefined-assert-gate.sh' \
  'rlspolicy:.husky/rls-service-role-policy-gate.sh' \
  'resetrole:.husky/migration-reset-role-gate.sh' \
  'acldrift:.husky/acl-drift-gate.sh' \
  'isolation:.husky/isolation-level-scan-gate.sh' ; do
  _n="${_pair%%:*}"; _f="${_pair#*:}"
  if [ -f "$_f" ]; then
    sh "$_f" > "$WORK/$_n.log" 2>&1; add_report "$_n" $?
  else
    printf '🔴 %s 不存在 ⇒ 這一道沒有跑\n' "$_f" > "$WORK/$_n.log"
    add_report "$_n" 97
  fi
done

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
# 🟡 **插槽已接(2026-09-06;主視窗 -f8 批 auth-006 plan + 裁 auth-007=A)**
#    ⛔ ~~要接的時候改這兩行加 `--exclude`, 並在下面多一組 `add browser $?`~~
#    🔴🔴 **`--exclude` 在本 repo【完全沒作用】—— 而它是【靜默】的, 這一段留給下一個想用它的人**:
#      本 repo 是 **vitest projects** 設定(`vitest.config.*:2` 逐字「#606 改 projects 拆 per-app alias」;
#      `vitest list` 的輸出帶 `[admin]` / `[node]` 前綴)⇒ **root 層的 `--exclude` 不會下到 project config**。
#      🔬 實測(2026-09-06, `vitest/4.1.5`, `npx vitest list --filesOnly`):
#        不帶 ⇒ 861 · 帶族裡一支完整路徑 ⇒ **861** · 十支一起下 ⇒ **861**
#        · glob 單支 `**/x.test.ts` ⇒ **861** · glob 目錄 `**/print/**` ⇒ **861**
#        🔴 負對照 現造的不存在路徑 ⇒ **861** ⇒ 📌 **負對照與真排除印同一個數
#           ⇒ 那不是「排除無效」, 是【那個旗標沒被吃到】。**
#        🟢 正對照 正向過濾 `mark-detail-print` ⇒ **1** ⇒ 這支指令會動, 壞的是 `--exclude` 這條路。
#    ⇒ ✅ **改成【不排除】**:主段照舊跑全套, 族段另外跑兩發, **兩個獨立分母各自對**(見 `verdict`)。
#      🔵 它比排除【更安全】:沒有排除動作 ⇒ 沒有「安靜地少跑一批」這個新風險。
#      ⚠️ **代價(R1 訂正:我原本寫「跑兩次」, 那把成本講小了一半)**:
#        主段兩發各跑它一次 + 族段兩發各跑它一次 ⇒ 🔴 **那一族實際跑 4 次。**
#        📏 **族段實測 46 秒/發 —— 而那個讀數的範圍是「這族 = 10 支」那個時點**
#          (2026-09-06 合 `origin/dev` 之前);同一顆下面就記著這族已經變成 **13** 支
#          ⇒ 🛑 **46 這個數不要直接乘, 它離開量測現場了。要用當場再量一次。**

# ── ① 分母:當場跑 `--split-check` 拿 ────────────────────────────────────
# 🔴 **當場跑當場拿, 不寫死**(ship 2026-09-06:那個數每被收割一次就會變)。
# 🟢 **而那句話當天就有正對照**(2026-09-06 · `-auth` 實測, 同一台機器同一支指令):
#      合 `origin/dev` **之前** ⇒ 「全套 **861** 支 = 這族 **10** + 其餘 851」
#      合 `origin/dev` **之後** ⇒ 「全套 **871** 支 = 這族 **13** + 其餘 858」
#    ⇒ 📌 **中間只隔一次收割** —— 若當初把 861 寫死進判準, 它現在會拿一個【舊的分母】說話,
#      而那句話**會是綠的**(861 對 861), 只是它對的不是今天這棵樹。
#    ⇒ 🛑 **一個寫死的分母不會紅, 它會【安靜地量錯東西】。**
# 🔴 rc != 0 ⇒ 它會讓 `verdict` 判紅 —— **不可以當成「沒有要排除的」繼續跑**。
python3 scripts/browser-test-family.py --split-check > "$WORK/split.log" 2>&1; add splitcheck $?
read -r SPLIT_T SPLIT_F <<< "$(split_denoms "$WORK/split.log")"

# ── ② 主段:全套兩發 ─────────────────────────────────────────────────────
pnpm vitest --run --maxWorkers=2 > "$WORK/t1.log" 2>&1; add test1 $?
pnpm vitest --run --maxWorkers=2 > "$WORK/t2.log" 2>&1; add test2 $?
SUM1=$(grep -E 'Test Files|^ +Tests ' "$WORK/t1.log" | tr -s ' ' | tr '\n' ' ')
SUM2=$(grep -E 'Test Files|^ +Tests ' "$WORK/t2.log" | tr -s ' ' | tr '\n' ' ')

# ── ③ 族段:瀏覽器族兩發 ─────────────────────────────────────────────────
# 🔵 走 `pnpm test:browser`(= `browser-test-family.py --run`)—— 它自己內部就會比
#    「我餵幾支 vs 它跑幾支」並在對不上時 rc=1 ⇒ **第四個數在那一層已經有人管, 我不重寫一份。**
# 🔴 而**兩發**是這一層加的:族段起真瀏覽器 ⇒ 它是最可能「這一發剛好沒跑起來」的那一段(ship Q3)。
# ⚠️ **而族段那個分母檢查(`ft != F`)實際擋得到的窗很窄(R1 抓到, 收窄這句話)**:
#    `--run` 自己就會比「我餵幾支 vs 它跑幾支」並在對不上時 rc=1 ⇒ 那一半**已經被 `btest*` 閘擋掉**。
#    ⇒ 📌 `ft != F` 真正活著的射程只剩一個:**`--split-check` 與 `--run` 兩次呼叫【之間】家族變了**
#      (有人在那幾十秒內新增/刪掉一支族內測試檔)。**它不是「族段少跑」的主要防線。**
pnpm test:browser > "$WORK/b1.log" 2>&1; add btest1 $?
pnpm test:browser > "$WORK/b2.log" 2>&1; add btest2 $?
BSUM1=$(grep -E 'Test Files|^ +Tests ' "$WORK/b1.log" | tr -s ' ' | tr '\n' ' ')
BSUM2=$(grep -E 'Test Files|^ +Tests ' "$WORK/b2.log" | tr -s ' ' | tr '\n' ' ')

say "── 逐道 rc ──"
for it in $GATES; do say "   ${it%%:*} rc=${it##*:}"; done
say "── 主段 vitest 兩發 ──"
say "   第1發:$SUM1"
say "   第2發:$SUM2"
say "── 族段 browser 兩發 ──"
say "   第1發:$BSUM1"
say "   第2發:$BSUM2"
say "── 分母(當場跑 --split-check)──"
say "   全套 T=[$SPLIT_T] · 這族 F=[$SPLIT_F]"

verdict "$GATES" "$SUM1" "$SUM2" "$BSUM1" "$BSUM2" "$SPLIT_T" "$SPLIT_F"; V=$?
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
