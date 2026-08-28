#!/usr/bin/env bash
# literal-sweep.sh — 一段字面在全樹的**分類**命中(backlog #490)
#
# 🔴 存在理由(2026-08-14,同一天咬三次):
#    「改了 A、讓 B 的文案變成謊話」這個病,規則已經寫過、教訓已經記過,還是復發。
#    第三次復發時我**明明列了五類載體**(元件/文案常數/測試/backlog/plan)、
#    **執行時只掃了兩類**(code 掃了、docs 沒掃)⇒ 漏掉的那一處是審查抓的,不是我掃到的。
#    ⇒ 依 `~/.claude/rules/00-work-rules.md` §4 機制優先律:**規則寫了會再犯,機制不會。**
#
# 🔴 本工具的核心不是「找得到」,是「**每一類都印出來,即使 0 命中**」——
#    **「這一類我掃了、沒有」與「這一類我忘了掃」長得必須不一樣。**
#    那個差別就是上面那次漏掃的全部病因。
#
# 用法:  bash scripts/literal-sweep.sh '會從異常清單消失'
#         bash scripts/literal-sweep.sh 'refund-read\.ts:1[0-9][0-9]' --regex
#
# 收工檢查表用法(一行):改了任何對外字面/守門述詞後,拿**舊字面**跑一次,逐類看完再 commit。
#
# 🔴🔴🔴 **下面那整段自述【現在是假的】—— 不要信它,先讀這一段(2026-08-28 訂正)**
#
#   ❌ 它說「大小寫敏感」。**實作是 `re.IGNORECASE`(搜本檔 `re.IGNORECASE` 那一行;🔴 **不寫行號** —— 本次 diff 就把它推移了)+ NFKC。**
#      實測(2026-08-28 當場):`'PCM Motorsports'` ⇒ **53 命中**、`'pcm motorsports'` ⇒ **53 命中**。
#
#   🔴 **而它不是「行為變了而文件沒跟上」——它從寫下來那天就是錯的**:
#      `f7230c90`(08-14 15:01)建立本檔, **`IGNORECASE` 第一版就在**;
#      `224796cc`(08-19 15:27)才寫上那段自述, 11 insertions / 0 deletions,
#      **碰 `IGNORECASE` 的行數 = 0** —— 它的標題逐字寫著「**零行為改動**」。
#      📌 **它說對了。而那正是問題所在:它只動了描述, 而描述從那一刻起與行為相反。**
#
#   🔴🔴 **通則(對明天每一顆「純文件」commit 都成立)**:
#      「零行為改動」在那顆 commit 上是一句**安全宣告** ——
#      **而它安全的原因(沒碰實作), 正是它危險的原因:**
#      **沒有任何測試、任何守門, 會因為【描述寫錯】而紅。**
#      ⇒ **一個「只改文件」的 commit, 是這個 repo 裡唯一一種【可以憑空造出假話而零阻力】的動作。**
#
#   🔴 **它今晚已經產出兩個錯誤, 具名**(2026-08-28):
#      · `-c8` 讀了它 ⇒ 推出「輸出大概沒印比對形式」⇒ 把一個**已經做好的東西**報成最高優先級缺口
#      · 主視窗 `-84` **背書**那個排序(逐字「如果今晚只做得完一件, 做那一半」)
#      📌 **一句假話寫「它可能誤導人」是抽象的;寫「它今晚誤導了這兩個人」是可查的。**
#      📌 而它的傷害形狀是**指錯方向**不是少報:今晚那個 `0` 的真成因是 markdown 標記(見限度 7),
#         **而讀了這句的人會去想「是不是大小寫」—— 那條路是死的。**
#
#   🔴🔴 **本段自己犯過一次它正在警告的錯, 留痕(2026-08-28 code-reviewer 抓到)**:
#      ~~原寫「那支檔現在不在」「那個實例今天查不了」~~ —— **兩句都是假的。**
#      · 那支檔**在**:`docs/marketing/2026-07-20-eazi-grip-demo-board-brief.md`
#        (我拿檔頭的**簡稱** `demo-board-brief.md` 去 find ⇒ 前綴不符 ⇒ 查無)
#      · 那個實例**查得到**:`git show '5766e686^:<全名>' | sed -n '46p'`
#        ⇒ `台灣總代理 ・ PCM MOTORSPORTS` —— **原證據成立。**
#      📌 **我用「查不到」推出「查不了」, 而真正的原因是【我把名字打錯了】** —— 那正是本檔 ⑩ 那一族。
#      🔴 **⇒ 一段用來訂正假話的文字, 用它自己警告的那個方式, 造了一句新的假話。**
#   ✅ **而那個實例【今天】重現不出來的真正原因是時間**:
#      `5766e686`(08-19 **15:23:23**)把行銷三檔的站名改掉,
#      而 `224796cc`(08-19 **15:27:35**)才寫下那段自述 ⇒ **早 4 分 12 秒。**
#      ⇒ **那個數字在被寫下來的時候, 它量的那個世界已經沒了。**
#   ⚠️ **而「6 vs 7」那個算術我【沒有解釋掉】**:IGNORECASE 之下工具應該找到**更多**不是更少
#      ⇒ **那個差不可能只是大小寫**。**未確認 —— 缺的檢查是把當時那版工具跑在當時那版樹上。**
#
#   🔴 **離開這一段要帶走的**:本檔其他的自我描述, **讀之前先跑一發實測對照**。
#      這一句在寫下來那天就是錯的, 而它掛著 🔴🔴 掛了 9 天。
#
# ~~ 以下為原句, 留痕不刪 ~~
# 🔴🔴 **這把尺比對的是【單一字面、大小寫敏感】,不是「一個名字」**(2026-08-19 W2 實錘,本檔零行為改動、只加說明):
#    當天用 `literal-sweep.sh 'PCM Motorsports'` 掃 `docs/marketing/` ⇒ 回 **6**;
#    而 `grep -rn "PCM Motorsports\|PCM MOTORSPORTS" docs/marketing/` ⇒ **7**
#    —— 差的那一處是全大寫的 `PCM MOTORSPORTS`(`demo-board-brief.md:46`)。
#    ⇒ 🔴 **病灶不在工具,在【報告的句子】**:我報的是「有 6 處」,而我量的是
#      「**有 6 處符合這一種拼法**」。**名字有大小寫/空白/縮寫變體,字面沒有。**
#    ⇒ **要掃一個【名字】**:每一種變體各跑一次,或改用 `grep -i` / `--regex` 自己組變體。
#      **只跑一次的結果,只能寫「有 N 處符合這一種拼法」,不能寫「有 N 處」。**
#    ⚠️ **本工具的比對邏輯刻意不改**(主視窗 2026-08-19 裁):改行為會讓所有既有呼叫端的
#      歷史數字失去可比性。**這裡只加說明。**
#    ✅ **2026-08-28 主視窗補(留痕, 不是推翻)**:本條指的是【既有比對路徑】——
#       **新增一個【選用模式】不在其內**(既有呼叫端一個字都不用改、歷史數字仍可比)。
#       ⚠️ 而當日評估過的 `--from-diff`(從 git diff 的 `-` 行自動取舊字面)**判先不做**:
#       實測三例只有 1 例撈得到 —— 判別的不是「刪不刪」, 是【那句話有沒有在 HEAD 裡活過一次】;
#       同一批未 commit 的工作裡寫下又劃掉的, 整塊都是 `+` ⇒ 看不見(**n=3, 不是比例**)。
#       📌 **一個被裁出來而沒有用掉的空間, 要寫明它還在** —— 不然下一個人以為那條裁示涵蓋一切。

set -euo pipefail
cd "$(dirname "$0")/.."

# ══════════════════════════════════════════════════════════════════════════
# 🔴 --selftest:這支【全陣天天在用的尺】自己的守門者(2026-08-18 補)。
#   為什麼要有:它此前 selftest=0 —— 行為只被【手驗】過,而手驗隨 session 消失;
#   且它剛被改過(限度那段),而改過的東西最容易被當成「已經沒問題」。
#   三個世界(缺一則一支恆抓/恆漏的尺也會全綠;🔴 原寫「兩個」而下面列三條 —— 2026-08-28 訂正):
#     ① 該命中的必須落在【它自己那一類】(七類各一個合成標記檔,驗路由不串類)
#     ② 不該命中的必須讓七類【全部印出 0 命中】(raison d'être:掃了沒有 ≠ 忘了掃)
#     ③ 限度那幾行【必須全印】——刪掉一條就紅(射程被靜默刪掉唯一擋得住的方式)
#   🔴 零判定改動:本區只【呼叫】主流程 "$0" <needle> 抓 stdout 斷言,不碰 categorizer。
# ══════════════════════════════════════════════════════════════════════════
if [ "${1:-}" = "--selftest" ]; then
  # 🔴 標記字串【組出來、不寫成連續字面】—— 因為本工具會掃自己這支檔(⑦類),
  #    寫成連續字面的話,它會在自己的原始碼裡找到自己的標記 ⇒ 「絕對缺席」那格假失敗。
  #    (2026-08-18 第一版就這樣栽了:ABSENT 是連續字面 ⇒ 世界②ㆍ得 6/7 而非 7/7。)
  MK="LITSWEEP_SELFTEST_""MARKER_""ZQX9animal"
  ABSENT="LITSWEEP_ABSENT_""NEVER_""ZZQQ77never"
  # 七類各一個合成檔(路徑決定歸類;內容含標記)。名字帶 _litsweep_selftest 好認、好清。
  declare -a ST_FILES=(
    "supabase/migrations/_litsweep_selftest_ZQX9.sql"    # ①
    "scripts/_litsweep_selftest_ZQX9-down.sql"           # ②
    "docs/runbooks/_litsweep_selftest_ZQX9.md"           # ③
    "docs/specs/_litsweep_selftest_ZQX9.md"              # ④
    "apps/_litsweep_selftest_ZQX9.test.ts"               # ⑤
    "docs/handoff/_litsweep_selftest_ZQX9.md"            # ⑥
    "scripts/_litsweep_selftest_ZQX9.txt"                # ⑦
  )
  # 🔴 2026-08-29:期望值改從【獨立答案卷】讀 —— 見 scripts/literal-sweep.expects.txt 檔頭。
  #    原本 ST_CAT 與 BUCKETS 的類別符號【同檔逐字相同】⇒ 全域換符號兩處一起改 ⇒ 自檢仍 rc=0（實測）。
  # 🔴 M3(R1):不可用 $(dirname "$0") —— 本檔 :80 已經 cd 到 repo 根,
  #    再拿 $0 相對新 cwd 解析一次 ⇒ 用相對路徑呼叫時會指到不存在的地方,
  #    而錯誤訊息會說「答案卷不見」(fail-closed 但成因是假的)。
  EXPECTS="scripts/literal-sweep.expects.txt"
  if [ ! -s "$EXPECTS" ]; then
    echo "🔴 selftest 無法進行:答案卷不見或是空的 ⇒ $EXPECTS" >&2
    echo "   (這一格【不 fail-open】—— 沒有答案卷就沒有獨立的期望值, 全綠沒有意義。)" >&2
    exit 1
  fi
  declare -a ST_CAT=()
  while IFS= read -r _c; do ST_CAT+=("$_c"); done < <(grep '^cat:' "$EXPECTS" | sed 's/^cat://')
  EXPECT_BLOCK="$(sed -n 's/^limitblock://p' "$EXPECTS")"
  # 🔴 M1(R1):兩把尺要對稱 —— 舊版 cat 用「精確 7」而 limit 只要 >=1,
  #    ⇒ 答案卷縮成 1 條就能讓 6 條限度被刪掉而全綠(實測 rc=0)。整段錨之後改數行數。
  if [ "${#ST_CAT[@]}" -ne 7 ] || [ "$(printf '%s\n' "$EXPECT_BLOCK" | grep -c .)" -lt 20 ]; then
        echo "🔴 答案卷內容不對:cat ${#ST_CAT[@]} 條(期望 7)、限度整段行數不足 20" >&2
    exit 1
  fi
  st_cleanup() {
    for f in "${ST_FILES[@]}"; do rm -f "$f"; done
    rm -f "${SKIP_PROBE:-}" 2>/dev/null || true
    local leftover; leftover=$(git status --porcelain 2>/dev/null | grep -F "_litsweep_selftest_ZQX9" || true)
    if [ -n "$leftover" ]; then
      echo "🔴🔴 selftest 清理失敗,這些合成檔還在(不要 commit):" >&2
      echo "$leftover" >&2
    fi
  }
  # 🔴 R3:限度 2 說「跳過的目錄」—— 而整段錨只凍住那句【文字】。
  #    行為那半(:275 那行 walk 過濾)被改掉/刪掉時，文字不變、變數不變 ⇒ 今天沒有東西會叫。
  #    ⇒ 種一支帶 MK 的合成檔在【被跳過的目錄】裡，斷言它【不在】輸出。
  #    七支正對照已證明掃描活著 ⇒ 這個「缺席」有判別力。
  # ⚠️ 用 coverage/ 不用 node_modules/:這一格的【突變】要把該目錄從 SKIP_DIRS 拿掉,
  #    而拿掉 node_modules 會讓那一發掃到逾時(-c8 2026-08-29 實測:2 分鐘沒跑完)。
  #    coverage/ 現在不存在 ⇒ 建一支檔進去最便宜, 而它照樣在 SKIP_DIRS 裡。
  # 🔴 **這個探針的靈敏度是【分裂】的 —— 而它自己看不出來**(2026-08-29 R3 `-3f` 結構分析提報,
  #    `-c8` 實跑四發突變複驗;R3 自標「沒實跑突變」, 而實跑改掉了它的一半結論):
  #      整條 walk 過濾被拿掉        ⇒ 本格【紅】(而那一發會去掃 node_modules, 要 2 分鐘)
  #      單一目錄被移出 SKIP_DIRS    ⇒ **只有 `coverage` 那一格會紅 = 1/10**
  #    ⇒ **不要把這一格讀成「SKIP_DIRS 有守門」** —— 它只守【它自己種在的那個目錄】。
  #
  # ✅ **而檔案整體【不是】1/10 —— 另一格接住了, 這是 `-c8` 實跑量到、R3 沒量的那半**:
  #    把 `dist` 移出 SKIP_DIRS ⇒ 本格仍 PASS, **而「限度整段與答案卷」那一格 FAIL**,
  #    並逐字印出差異(`< …, dist, …` / `> …` 少了 dist)⇒ **對【單目錄移除】這一類, 整支自檢是 10/10。**
  #    📌 **兩道是互補的, 不是重複的**:
  #      答案卷比【印出來的文字】⇒ 抓得到「集合少了一個成員」, 抓不到「過濾根本沒跑」(文字不會變);
  #      本探針比【行為】        ⇒ 抓得到「過濾沒跑」, 抓不到「別的目錄被移出」。
  #    ⇒ **拿掉任何一道, 就有一整類突變沒有人接。**
  SKIP_PROBE="coverage/_litsweep_selftest_ZQX9_skip.txt"
  trap st_cleanup EXIT INT TERM HUP
  # 🔴 開跑先清【上一次被 SIGKILL 殺掉沒清乾淨】的合成檔(trap 對 kill -9 無效,reviewer 抓)——
  #    否則一支 _litsweep_selftest_*.sql 會留在 supabase/migrations,被 glob *.sql 的 migration 工具撿走。
  stale=$(find supabase/migrations scripts docs apps -name '_litsweep_selftest_ZQX9*' 2>/dev/null || true)
  if [ -n "$stale" ]; then
    echo "⚠ 清掉上一次被殺掉沒清乾淨的合成檔:" >&2; echo "$stale" >&2
    echo "$stale" | while IFS= read -r sf; do [ -n "$sf" ] && rm -f "$sf"; done
  fi
  mkdir -p "$(dirname "$SKIP_PROBE")" && printf -- '%s\n' "$MK" > "$SKIP_PROBE"
  for f in "${ST_FILES[@]}"; do
    mkdir -p "$(dirname "$f")"
    # 🔴 內容用註解形(-- / //)⇒ 就算 SIGKILL 窗內被 migration 工具撿走也是【惰性】、不會執行出東西。
    case "$f" in
      *.sql) printf -- '-- %s\n' "$MK" > "$f" ;;
      *.ts)  printf -- '// %s\n' "$MK" > "$f" ;;
      *)     printf '%s\n' "$MK" > "$f" ;;
    esac
  done

  FAIL=0
  pass() { echo "PASS  $1"; }
  fail() { echo "FAIL  $1"; FAIL=1; }

  # ── 世界①:命中該落在自己那一類。抓每一類 header 之後、下一個 header 之前的區塊,
  #    驗那一類的合成檔【在】、且不在別類(路由不串)。
  OUT_HIT="$("$0" "$MK")"
  # 🔴 R3 的行為探針:被跳過的目錄裡那一支【必須不在】輸出裡。
  #    這一格與整段錨是【兩個不同的世界】:錨管那句話的字面, 這一格管 :275 那行過濾還在不在。
  if printf '%s' "$OUT_HIT" | grep -qF "$SKIP_PROBE"; then
    fail "🔴 限度 2 的行為沒了:$SKIP_PROBE 在被跳過的目錄裡, 而它出現在輸出裡 ⇒ walk 過濾被改掉了"
  else
    pass "限度 2 的行為仍在:被跳過目錄裡的合成檔沒有出現在輸出($SKIP_PROBE)"
  fi
  i=0
  for f in "${ST_FILES[@]}"; do
    cat="${ST_CAT[$i]}"
    # 該檔應出現在輸出裡(某一行含它的路徑)
    if printf '%s' "$OUT_HIT" | grep -qF "$f"; then
      # 且它出現的那一段的類別標題應是自己的 cat:抓「$f」那行往上最近的「── 類別」行
      seg_cat="$(printf '%s' "$OUT_HIT" | awk -v needle="$f" '
        /^── / { curcat=$0 }
        index($0, needle) { print curcat; exit }')"
      # 🔴 R3(Fable, 2026-08-29):上面那個 awk 是 index 命中就 exit ⇒ 只看【第一次出現】
      #    ⇒ 一支檔重複落兩類、而第一次落對 ⇒ 今天就 PASS。
      #    而 :157 那句註解逐字寫著「且不在別類(路由不串)」—— **註解宣稱的, code 沒做。**
      #    實測(-c8 2026-08-29):把 hits 改成落進【每一個】符合的類 ⇒ rc=0、0 FAIL、世界① 全印 PASS。
      occ="$(printf '%s' "$OUT_HIT" | grep -cF "$f" || true)"
      if printf '%s' "$seg_cat" | grep -qF "$cat" && [ "$occ" -eq 1 ]; then
        pass "世界①-$cat 合成檔落在自己那一類且只出現一次($f)"
      elif [ "$occ" -ne 1 ]; then
        fail "🔴 世界①-$cat 路由串了:$f 在輸出裡出現 $occ 次(期望 1)—— 註解說的『不在別類』沒有被驗過"
      else
        fail "世界①-$cat 合成檔跑到別類了(期望 $cat,實得段落標題:$seg_cat)"
      fi
    else
      fail "世界①-$cat 合成檔根本沒被命中($f)—— 該類路由或 walk 壞了"
    fi
    i=$((i + 1))
  done

  # ── 世界②:不該命中的 → 七類【全部】印 0 命中(raison d'être)。
  OUT_MISS="$("$0" "$ABSENT")"
  zero_lines=$(printf '%s' "$OUT_MISS" | grep -cE "0 命中\(這一類掃了 [0-9]+ 個檔\)" || true)
  if [ "$zero_lines" -eq 7 ]; then
    pass "世界②ㆍ0 命中時七類全印(raison d'être;實得 $zero_lines/7)"
  else
    fail "世界②ㆍ0 命中時【沒有】七類全印(實得 $zero_lines/7)—— 這正是本工具要防的病"
  fi

  # ── 限度那幾行必須全印(刪一條就紅)。2026-08-18 merge dev 後補上限度 5、6(C 窗 24f2429f)。
  #    🔴 教訓(同 traps「兩個來源要同一時點」):我先前查 dev 只有 1-4 是【對的】,但 dev 隨後
  #    動過 ⇒ 用【多個時點】的來源會得到互相矛盾的結論。落 selftest 前重量了一次 dev 現況=6 條。
  # 🔴 R1 §0:改成【整段逐字比對】—— 子字串錨擋不住「逐字保留那句話而把內容掏空」。
  #    實例(reviewer 構造):print("  2. 跳過的目錄 —— 本條已作廢, 不必理會") ⇒ 舊版 rc=0 全綠。
  GOT_BLOCK="$(printf '%s' "$OUT_MISS" | sed -n '/掃描限度/,$p')"
  if [ "$EXPECT_BLOCK" = "$GOT_BLOCK" ]; then
    pass "限度整段與答案卷逐字相符($(printf '%s\n' "$GOT_BLOCK" | grep -c .) 行)"
  else
    fail "🔴 限度整段與答案卷不符 —— 差異如下(< 期望 / > 實得):"
    diff <(printf '%s\n' "$EXPECT_BLOCK") <(printf '%s\n' "$GOT_BLOCK") >&2 || true
  fi

  st_cleanup
  trap - EXIT INT TERM HUP
  if [ "$FAIL" -eq 0 ]; then echo "selftest: 全過"; exit 0; else echo "selftest: 有 FAIL"; exit 1; fi
fi

NEEDLE="${1-}"
MODE="${2-}"
if [ -z "$NEEDLE" ]; then
  echo "用法:bash scripts/literal-sweep.sh <字面> [--regex]" >&2
  echo "  預設把 <字面> 當**純字串**比對(括號、點號不會被當正規式)。" >&2
  echo "  加 --regex 才當正規式。" >&2
  exit 2
fi
case "$MODE" in
  '' | --regex) : ;;
  *) echo "只認一個可選旗標 --regex(實得:$MODE)" >&2; exit 2 ;;
esac

command -v python3 >/dev/null 2>&1 || { echo "找不到 python3" >&2; exit 1; }

# 🔴 比對本體走 python3、不走 grep:本機的 `grep` 實為 ugrep(**版本自己跑 `grep --version` 看** —— 2026-08-19 記 7.5.0, 2026-08-28 自證 7.8.4)(`grep --version` 自證),
#    而本 repo 已記過多次 BSD/GNU/ugrep 方言互咬(`\|`、`$x$`、`sort -t` 等)。
#    大小寫無關 + 全形半形標點等價(NFKC)在 python 是兩行,在 shell 是一個雷區。
NEEDLE="$NEEDLE" MODE="$MODE" python3 - <<'PY'
import os, re, sys, unicodedata
from pathlib import Path

needle = os.environ["NEEDLE"]
as_regex = os.environ["MODE"] == "--regex"

# NFKC:全形（）：ＡＢ 與半形 ():AB 視為同一個東西。
# ⚠️ 只用於**比對**;印出來的一律是原始那一行,行號也是原始行號。
def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s)

pattern = re.compile(
    norm(needle) if as_regex else re.escape(norm(needle)),
    re.IGNORECASE,
)

# ── 七類載體。**由上而下第一個命中就歸該類**(一個檔只會出現在一類裡)。
#    最後一類刻意是「其餘一切」—— 沒有任何檔會被靜默丟掉,那正是本工具存在的理由。
BUCKETS = [
    ("① DB 契約", "supabase/migrations/**(含 COMMENT ON —— 契約債寫在那裡)",
     lambda p: p.parts[:2] == ("supabase", "migrations")),
    ("② 回退腳本", "scripts/*-down.sql(apply 出事時照著跑的那份)",
     lambda p: p.parts[:1] == ("scripts",) and p.name.endswith("-down.sql")),
    ("③ runbook", "docs/runbooks/**(人照著操作的步驟)",
     lambda p: p.parts[:2] == ("docs", "runbooks")),
    ("④ plan / spec", "docs/specs/**(下一個人拿來當規格的東西)",
     lambda p: p.parts[:2] == ("docs", "specs")),
    ("⑤ 測試與探針", "**/*.test.* / **/*.spec.* / docs/probes/**(守門與證據)",
     lambda p: (".test." in p.name or ".spec." in p.name
                or p.parts[:2] == ("docs", "probes"))),
    ("⑥ 待辦與現況", "docs/phase-1-backlog.md + STATUS.md + docs/handoff/**",
     lambda p: (p.as_posix() in ("docs/phase-1-backlog.md", "STATUS.md")
                or p.parts[:2] == ("docs", "handoff"))),
    ("⑦ 其餘一切", "上面六類沒收走的每一個文字檔(原始碼、其他 docs、設定…)",
     lambda p: True),
]

SKIP_DIRS = {
    ".git", "node_modules", ".next", "dist", ".turbo", "coverage",
    "design-reference", ".vercel", "graphify-out", "__pycache__",
}

hits = [[] for _ in BUCKETS]
scanned = [0 for _ in BUCKETS]
skipped = {}  # 副檔名 -> 幾個(讀不出 utf-8 的都記帳,不讓它們靜默消失)

root = Path(".")
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        path = Path(dirpath, fn)
        rel = path.relative_to(root)
        idx = next(i for i, b in enumerate(BUCKETS) if b[2](rel))
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            key = rel.suffix or rel.name
            skipped[key] = skipped.get(key, 0) + 1
            continue
        scanned[idx] += 1
        for lineno, line in enumerate(text.splitlines(), 1):
            if pattern.search(norm(line)):
                hits[idx].append((rel.as_posix(), lineno, line.strip()))

print(f'字面:{needle}{"  (當正規式)" if as_regex else "  (當純字串)"}')
print("比對:大小寫無關 + 全形/半形標點等價(NFKC)")
print("=" * 72)

total = 0
for (name, scope, _), rows, n in zip(BUCKETS, hits, scanned):
    total += len(rows)
    print()
    print(f"── {name} · {scope}")
    if not rows:
        # 🔴 這一行就是本工具的全部價值:0 命中也要說「我掃了幾個檔」。
        print(f"   0 命中(這一類掃了 {n} 個檔)")
        continue
    print(f"   {len(rows)} 命中 / 掃了 {n} 個檔")
    for f, ln, excerpt in rows:
        if len(excerpt) > 110:
            excerpt = excerpt[:110] + "…"
        print(f"   {f}:{ln}: {excerpt}")

print()
print("=" * 72)
skipped_total = sum(skipped.values())
brief = ", ".join(f"{k}×{v}" for k, v in sorted(skipped.items(), key=lambda kv: -kv[1])[:6])
print(f"總計 {total} 命中,掃了 {sum(scanned)} 個文字檔,跳過 {skipped_total} 個讀不出 UTF-8 的檔。")
if skipped_total:
    # 🔴 跳過幾個 + **跳過的是什麼**都要印:只印數字的話,
    #    「跳過的全是圖片」與「跳過了一份壞掉編碼的 .md」長得一樣。
    print(f"       跳過的副檔名:{brief}")

# 🔴 自我守門:某一類掃到 0 個**檔**(不是 0 個命中)= 這一類的路徑判準壞了
#    (例:有人把 docs/runbooks 改名)。那正是本工具要防的病發生在本工具自己身上。
blind = [name for (name, _, _), n in zip(BUCKETS, scanned) if n == 0]
if blind:
    print()
    print(f"🔴🔴 這幾類**一個檔都沒掃到**,判準可能已失效,先修工具再信結果:{', '.join(blind)}")
print()
print("🔴 掃描限度(不要只當它掃過了):")
print("  1. 只掃**檔案裡的字面**。組出來的字串(`'異常' + '清單'`)、i18n key、")
print("     DB 裡的資料列、已 apply 但檔案已改的 migration ⇒ 一律掃不到。")
print(f"  2. 跳過的目錄:{', '.join(sorted(SKIP_DIRS))} ⇒ 建置產物裡的舊字面不會被看到。")
print("  3. 一個檔只歸一類(由上而下第一個命中)⇒ `apps/**/x.test.ts` 會落在 ⑤ 不是 ⑦。")
print("  4. 它告訴你**哪裡還有這個字面**,不告訴你**那句話現在是真是假** —— 那要人開檔判斷。")
print("  5. 🔴🔴 **它分不出「還沒改」與「已改但留痕」。** 本 repo 的更正慣例是**劃掉不刪**")
print("     (`~~舊字面~~ ⇒ 新的說法`)⇒ **訃聞裡面也含那個字面** ⇒ 兩者在上面的輸出裡是同一筆。")
print("     ⇒ 要拆開,**分開數兩種形狀**(可重跑):")
print("       `git grep -l '<字面>' <ref>` → 逐檔逐行判斷該行含不含 `~~<字面>~~`")
print("       實例 2026-08-18:`production 實測 1000` 在 dev 上 12 行 ⇒ **待辦 10 / 訃聞 2**。")
print("  6. 🔴 **這個數字是【某個 checkout 在某個時點】的性質,不是 repo 的性質。**")
print("     同一時刻:某分支上已改、你的基底上還沒改 —— **兩邊都是真的**。")
print("     ⇒ 要分辨「沒改」與「改了但沒進 dev」,**只能掃所有 worktree 與所有分支**:")
print("       `for w in $(git worktree list --porcelain | grep ^worktree | cut -d' ' -f2); do …`")
print("       `for b in $(git branch --format='%(refname:short)'); do git show \"$b:<path>\" | grep -c …`")
print("     ⇒ **把數字寫進報告時,連【哪個 checkout、什麼時點】一起寫**,否則它下一小時就不成立。")
print("  7. 🔴🔴 **它【不剝任何 markdown 標記】** —— `**` / `` ` `` / `~~` 卡在字面中間時,")
print("     你餵【讀者看到的那句】會回 0, 而檔案裡那句在。")
print("     🔴 **自己跑一次, 不要引用寫死的數字**:")
print("       bash scripts/literal-sweep.sh '<你那句的讀者版>'")
print("       bash scripts/literal-sweep.sh '<同一句的檔案原始版, 含 ** / ~~>'")
print("       ⇒ 兩者命中數會不同, 而那個差就是本條在講的東西。")
print("     ⚠️ **本檔【自己也會被掃到】** ⇒ 任何寫死的示範數字, 在寫下去的那一刻就把自己算了進去。")
print("       (2026-08-28 首版寫 0 / 1, 同日複量已是 2 / 3。)")
print("     🔴 而這一條與限度 5 【不是同一件】:5 講的是【訃聞也含那個字面】(多報);")
print("     本條講的是【跨越標記的字面撈不到】(少報)。**兩個方向相反。**")
print("     ⇒ 舊字面在本 repo 慣例上【一定被 `~~` 包著】⇒ 想【整行引用】它的人一定跨邊界。")
print("     ⇒ 餵之前先 `git show HEAD:<檔> | grep -n '<一小段>'` 看那一行的【原始位元組】。")
PY
