#!/bin/bash
# 跑【掃描型】測試 —— 那一族 `vitest related` 結構上撈不到。
#
# ══ 🔴 為什麼要有它(2026-09-04 一晚四次)══════════════════════════════════════
#
# 「掃描型」= 測試檔**自己去讀** `supabase/migrations/`(`readFileSync` / `readdirSync` / glob),
# 而**不 import 被測的那支碼**。
# ⇒ 📌 **所以改 migration 或改 adapter 時, `vitest related` 的分母裡【結構上】沒有它們。**
# ⇒ 它們一路綠到推之前的全套才紅。
# ```
# 今晚:-auth 兩次 · -ship 一次 · -db 一次(我自己:在 adapter 加了一支 RPC 而沒登記)
# ```
#
# ══ 🩺 病歷:**作者本人在寫完它的同一夜漏跑了它一次** ═══════════════════════════
#   逐字:**作者本人在寫完它的同一夜漏跑了它一次(`e242a9ddd`, 抓到的是主視窗收割全套)。**
#   經過:我改了一支 migration 三次, 而只重跑了「我想得起來的那一支」測試(verify.sh 的 17 格),
#   漏掉 `scripts/rls-exclusions-parity.test.ts` —— 而**本支一發就會撈到它**(53 個名字裡有它)。
#   🛑 形狀不是「不夠小心」, 是:**我把一個【機器算得出來的分母】, 換成了【我記得起來的清單】。**
#   📌 這一條寫在這裡不是提醒 —— 它是**「本支現在是人的規矩而不是機制」的代價**,
#      而那個代價已經被兌現過一次, 兌現的人就是寫它的人。(不掛 hook 的兩次否決見下。)
#
# ══ 🔴 分母【當場算】, 不寫死清單 ═════════════════════════════════════════════
#   判準 = 檔內同時有「自己讀檔」的呼叫 與 `supabase/migrations` | `MIGRATIONS_DIR` 字面。
#   🛑 寫死的清單一定會過期, 而過期的方向是【少】—— 它不會叫。
#
# ══ 🔴🔴 「我餵幾個 vs 它跑幾支」在這裡【不相等, 而那是對的】═══════════════════
#   vitest 的位置參數是**子字串過濾**不是路徑 ⇒ 餵 `coupon` 也會撈到 `coupon-cap-*`。
#   2026-09-04 實測:**餵 52 個名字 ⇒ 跑 71 支檔 · 1147 格 · 21 秒**(`--maxWorkers=2`)。
#   ⇒ ✅ 正確形狀是 **它跑的 ≥ 我餵的**, 不是相等 —— 本支把兩個數與差集都印出來,
#     否則下一個人會以為分母錯了。
#
# ══ 天花板 ═══════════════════════════════════════════════════════════════════
#   ① 判準是**字面**:有人改用別的方式讀 migrations(例如經一支 helper), 本支撈不到它。
#   ② 多撈是安全方向, 而它讓這一發比「只跑該跑的」慢 —— 21 秒是含多撈的數。
#   ③ 它只證「那些測試現在是綠的」, 不證「它們守得夠寬」。

set -uo pipefail

# 🔴🔴 遞迴閘 —— 2026-09-04 實測:掛進 lint-staged 的 `supabase/migrations/*.sql` 之後,
#    `scripts/migration-new-file-gate.test.ts` 會【造一個暫存 repo 跑真的 lint-staged】
#    ⇒ 觸發本支 ⇒ 本支跑那 71 支測試(含它自己)⇒ 再觸發 ⇒ **全機 148 支 vitest, load 29**。
#    📌 而它不像壞掉:每一層都在做對的事, 只是層數沒有底。
#    ⇒ 本支已從 `supabase/migrations/*.sql` 那條 key 拆掉(改掛 pre-push);
#      這道閘是第二層防護 —— 萬一有人再掛回去, 它讓遞迴止於第二層而不是把機器吃光。
if [ "${PCM_SCAN_TESTS_RUNNING:-}" = "1" ]; then
  echo "  🔵 掃描型測試:偵測到自己已在上層執行(PCM_SCAN_TESTS_RUNNING=1)⇒ 本層跳過, 不遞迴"
  exit 0
fi
export PCM_SCAN_TESTS_RUNNING=1
export LC_ALL=C LANG=C
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 2

list_scan_tests() {
  python3 - <<'PY'
import glob, re
out = []
for f in (glob.glob('scripts/*.test.ts')
          + glob.glob('packages/*/src/**/*.test.ts', recursive=True)
          + glob.glob('apps/*/src/**/*.test.ts', recursive=True)):
    try:
        s = open(f, encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    # 🔴 兩個條件【都要】:自己讀檔 + 讀的是 migrations
    if re.search(r'readFileSync|readdirSync|readdir\(|globSync|fast-glob', s) \
       and re.search(r'supabase/migrations|MIGRATIONS_DIR', s):
        out.append(f)
print('\n'.join(sorted(out)))
PY
}

# 🔴 判準抽成具名函式 —— selftest 與正式路徑【呼叫同一支】。
#    若在 selftest 裡把判準重打一份, 改生產路徑那一份時它不會紅(本 repo 已記過那個形狀)。
#    $1 = vitest 輸出檔  $2 = 我餵了幾個名字   ⇒ 0 通過 / 2 量具失效
judge_ran() {
  _log="$1"; _fed="$2"
  _ran=$(grep -aoE 'Test Files +[0-9]+ (passed|failed)' "$_log" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | head -1)
  if [ -z "${_ran:-}" ]; then
    echo "🔴 量具失效:抓不到 vitest 的 \`Test Files\` 那行"
    echo "   ⇒ 這【不是】「測試都過了」—— 兩種世界都印不出那行:它根本沒跑 / 它的輸出格式變了。"
    grep -aE 'No test files found|Error|error' "$_log" 2>/dev/null | head -3 | sed 's/^/   /'
    return 2
  fi
  if [ "$_ran" -lt "$_fed" ]; then
    echo "🔴 它跑的($_ran)【少於】我餵的($_fed)"
    echo "   ⇒ 位置參數是子字串過濾 ⇒ 正常情形只會【多撈】, 不會少。少了代表有名字一個都沒撈到。"
    echo "   ⇒ 常見成因:那支測試檔被改名/刪掉, 而分母是當場算的 ⇒ 名字算得出來、檔案撈不到。"
    return 2
  fi
  echo "  🔵 它跑了 $_ran 支檔(我餵 $_fed)—— 🔴 **它跑的 ≥ 我餵的**(位置參數是子字串過濾, 例 coupon 也撈到 coupon-cap-*)"
  return 0
}

if [ "${1:-}" = "--selftest" ]; then
  ok=0
  n=$(list_scan_tests | wc -l | tr -d ' ')
  # 🔴 分母 > 0 —— 分母是 0 的話這支恆綠, 而它會看起來像通過
  if [ "$n" -gt 0 ]; then echo "  ✅ 分母 $n 支 > 0(分母 0 = 恆綠的空守門)"; else echo "  🔴 分母 0"; ok=1; fi
  # 🔵 負對照:換一個【現造的】判準 ⇒ 必須 0 支(證明尺不是對誰都回非零)
  z=$(python3 - <<'PY'
import glob, re
n = 0
for f in glob.glob('scripts/*.test.ts') + glob.glob('packages/*/src/**/*.test.ts', recursive=True):
    s = open(f, encoding='utf-8', errors='replace').read()
    if re.search(r'zzqBogusReadCall', s) and re.search(r'zzq_bogus_dir', s):
        n += 1
print(n)
PY
)
  if [ "$z" = "0" ]; then echo "  ✅ 負對照(現造判準)⇒ 0 支"; else echo "  🔴 負對照回 $z"; ok=1; fi
  # 🔴🔴 正對照:造一支【會讓掃描型測試紅】的假 migration ⇒ 本支必須回非 0
  #    否則本 selftest 只證明「它會跑」, 不證明「它會叫」。
  FAKE="supabase/migrations/29991231235959_zzq_selftest_fake_redefine.sql"
  # 🔴 trap 一定要在【建檔之前】掛 —— 中途被砍(逾時/Ctrl-C)時, 那支假 migration 會留在樹上,
  #    而它會讓下一個人的三綠紅在一支【不屬於任何 commit】的檔上(今天全隊踩過那個形狀)。
  trap 'rm -f "$FAKE"' EXIT INT TERM
  # 🔴🔴 突變要落在【真的有人在掃】的那個面上 —— 我為這一格連猜三發都沒落在目標上:
  #    ① 普通函式  ⇒ 全綠。那些門檻測試是自己造暫存檔測閘, 碰不到樹上的新檔。
  #    ② SECURITY DEFINER ⇒ 還是全綠。
  #    ③ 開檔讀 `receipt-message-definers.test.ts:48` 才看到:它的 regex 只認
  #       **`admin_delete_item_receipt` 這一個名字**, 不是任何 definer。
  #    📌 ⇒ 「突變全綠」有兩種成因:斷言太弱, 或【突變根本沒壞掉任何東西】。
  #      而它們印同一個綠 ⇒ 先問第二個, 否則會為了殺死不存在的缺陷去改鬆斷言。
  #    ⇒ 用它登記制真正在數的那支名字:多一支沒登記的 definer ⇒ 該格必紅。
  cat > "$FAKE" <<'SQLEOF'
BEGIN;
-- zzq selftest fixture:多生一支【沒登記】的 admin_delete_item_receipt 定義者
-- ⇒ receipt-message-definers.test.ts 的登記制該格必紅。
-- 本檔由 run-migration-scan-tests.sh --selftest 產生, trap 負責刪除。
CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(p_zzq text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $zzq$ SELECT $zzq$;
COMMIT;
SQLEOF
  npx vitest run --maxWorkers=2 $(list_scan_tests | sed 's|.*/||; s|\.test\.ts$||' | tr '\n' ' ') \
    > /tmp/zzq-selftest-scan.log 2>&1
  rc=$?
  rm -f "$FAKE"
  if [ "$rc" != "0" ]; then
    echo "  ✅ 正對照:塞一支假的重定義 migration ⇒ 本支回 rc=$rc(它【會叫】)"
  else
    echo "  🔴 正對照:塞了假 migration 而本支仍 rc=0 ⇒ 它只會跑, 不會叫"
    ok=1
  fi
  # 🔴 第四格:judge_ran 自己會不會動(-ship 2026-09-04 實測那個洞)
  _t="$(mktemp -d)"
  printf 'No test files found, exiting with code 0\n' > "$_t/none"
  judge_ran "$_t/none" 52 > /dev/null 2>&1
  [ "$?" = "2" ] && echo "  ✅ judge_ran:No test files found ⇒ 2(不是「都過了」)" || { echo "  🔴 judge_ran 對 0 支沒反應"; ok=1; }
  printf ' Test Files  9 passed (9)\n' > "$_t/few"
  judge_ran "$_t/few" 52 > /dev/null 2>&1
  [ "$?" = "2" ] && echo "  ✅ judge_ran:跑 9 < 餵 52 ⇒ 2" || { echo "  🔴 judge_ran 對「跑得比餵的少」沒反應"; ok=1; }
  printf ' Test Files  71 passed (71)\n' > "$_t/ok"
  judge_ran "$_t/ok" 52 > /dev/null 2>&1
  [ "$?" = "0" ] && echo "  🟢 負對照:跑 71 ≥ 餵 52 ⇒ 0(它不是對什麼都紅)" || { echo "  🔴 judge_ran 誤報"; ok=1; }
  rm -rf "$_t"
  [ "$ok" = "0" ] && echo "全部通過。" || echo "🔴 有格沒過。"
  exit "$ok"
fi

NAMES="$(list_scan_tests | sed 's|.*/||; s|\.test\.ts$||')"
FED=$(printf '%s\n' "$NAMES" | grep -c . )
if [ "$FED" -lt 1 ]; then
  echo "🔴 量具失效:掃描型測試分母是 0 ⇒ 這【不是】「沒有測試要跑」"
  exit 2
fi
echo "  🔵 掃描型測試:餵 $FED 個名字(分母當場算, 不寫死)"
# 🔴 直接拿 vitest 的 rc —— 不接管線(管線每一段的 rc 是另一族的坑)
printf '%s\n' "$NAMES" | xargs npx vitest run --maxWorkers=2 > /tmp/mig-scan-tests.log 2>&1
RC=$?
# 🔴🔴 2026-09-04 -ship 實測(而它正好打中本支的第一版):
# `vitest related --run <多支檔>` 會印 **No test files found** 而 **rc=0、跑 0 支**。
# ⇒ 第一版把「跑了幾支」**印出來**而【沒有拿它當判準】⇒ 印完就往下走 ⇒ 0 支照樣全綠。
# 📌 **「印出來」與「拿它當判準」是兩件事, 而在畫面上長得一模一樣。**
# 🎯 那正是鐵則 11 的第四個數 —— 我把它寫進註解、文件、commit body, 而碼裡只 echo 它。
#   **規矩寫在會被讀的地方, 判準要寫在會被執行的地方。**
judge_ran /tmp/mig-scan-tests.log "$FED" || exit 2
if [ "$RC" != "0" ]; then
  echo "🔴 掃描型測試紅了 —— 而它們【不會被 vitest related 撈到】, 所以你改的那批檔不會提醒你"
  grep -aE 'FAIL|AssertionError|Error:' /tmp/mig-scan-tests.log | head -6 | sed 's/^/   /'
  echo "   ── 完整輸出:/tmp/mig-scan-tests.log"
else
  echo "  ✅ 全綠(⚠️ 只證它們現在是綠的, 不證它們守得夠寬)"
fi
exit "$RC"
