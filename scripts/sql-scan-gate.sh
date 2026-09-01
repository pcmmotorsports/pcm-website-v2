#!/usr/bin/env bash
# sql-scan-gate — 純 .sql 的 commit 也要跑【掃 migration 的那一族測試】。
#
# 🔴 成因是 backlog `#863`(⏳ 待執行, 而修法在那裡就寫好了 —— 本檔是照它做的, 不是新發明):
#    鐵則 11 的三綠 = typecheck + lint(+ build), 而【三綠與 .sql 的語法守門都不跑 vitest】
#    ⇒ packages/domain 與 apps/*/src 裡每一道「掃 supabase/migrations 的閘」,
#      對 migration-only 的 commit **一律隱形**。
#    📌 實錘(`#863` 逐字):2026-08-23 退款片1/片2a 兩支純 .sql commit ⇒ 該紅的閘沒被跑到
#      ⇒ **紅了兩天**, 而每個窗跑 pnpm test 都撞到它。
#    🛑 **而最難發現的那一半:閘【沒被跑到】與閘【通過了】, 在 commit 當下長得一模一樣** ——
#       作者看到的都是「三綠全過」。
#
# 🔴🔴 **而做這支時量到一格, 它會咬到任何想跑測試子集的人**(2026-09-02 實測 vitest 4.1.5):
#    本 repo 的 vitest 有三個 project(node / admin / storefront)。
#    **把跨 project 的 filter 一次餵進去 ⇒ `No test files found`, rc=1** ——
#    而每一條 filter 單獨跑都是綠的。
#    ```
#    npx vitest run coupon member-tier-enum-drift          ⇒ 🔴 No test files found
#    npx vitest run --project node coupon member-tier-…    ⇒ ✅ 3 passed
#    ```
#    ⇒ 📌 **所以必須【逐 project 分開跑】。**而它至少是誠實的:rc=1 而且明說找不到檔
#      (不是印一個全綠而少跑 —— 那才是鐵則 11 講的那一種)。
#
# 🔴 鐵則 11「我餵幾條 vs 它跑幾支」:本檔逐 project 比對, **對不上就紅**。
#    ⇒ 因為餵一條不存在的 filter, vitest 不報錯、就少跑一支, 而總計行只印「它跑了幾支」。
#
# 用法:
#   bash scripts/sql-scan-gate.sh              # 跑全族
#   bash scripts/sql-scan-gate.sh --staged     # 只在 staged 含 supabase/migrations/*.sql 時跑
#   bash scripts/sql-scan-gate.sh --selftest   # 自檢(含負對照)
#
# 🛑 射程 —— 它做不到什麼(照 `#864` 不放寬):
#   · 它比對的是【repo 內的一致性】, **不是正式庫現況**。
#     ⇒ Sean 在 SQL Editor 貼一支 migration 是【人】的動作, 走的是另一條路徑
#     ⇒ ⇒ **本閘能做到的最好情況是【縮短窗口】, 不是【消滅它】。**
#     ⇒ ⇒ ⇒ 它的價值要用【窗口從幾小時縮到幾分鐘】估, **不是用「有沒有防住」**。
#   · 它不看 `APPLIED.tsv` —— `#864` 逐字:「帳上沒有」這個訊號本來就弱, 過半是事後補記。
#     實測 2026-09-02:266 支 migration / 帳上 241 ⇒ **25 支沒記帳, 而那是【正常狀態】**
#     ⇒ 拿它當紅的判準會【每天紅 25 次】⇒ 本閘刻意不用它。
#   · 族的定義是 grep `supabase/migrations` 的字面 ⇒ 一道用別的方式讀 migration 的閘會漏掉。
set -uo pipefail
export LC_ALL=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 2

family() {
  grep -rln "supabase/migrations" packages/domain/src apps/*/src \
    --include="*.test.ts" --include="*.test.tsx" 2>/dev/null | sort
}

project_of() {
  case "$1" in
    apps/admin/*)      echo admin ;;
    apps/storefront/*) echo storefront ;;
    *)                 echo node ;;
  esac
}

run_family() {
  local files fed ran rc total_rc=0 miss=0
  files="$(family)"
  if [ -z "$files" ]; then
    echo "🔴 這一族一支都找不到 ⇒ 那是尺自己壞了, 不是沒有閘(fail-closed)"
    return 2
  fi
  echo "族的分母:$(echo "$files" | wc -l | tr -d ' ') 支(grep 'supabase/migrations' 的字面)"
  for P in node admin storefront; do
    local filt
    filt=$(echo "$files" | while IFS= read -r f; do
             [ "$(project_of "$f")" = "$P" ] && basename "$f" | sed -E 's#\.test\.tsx?$##'
           done | sort -u)
    fed=$(echo "$filt" | grep -c . || true)
    if [ "$fed" -eq 0 ]; then
      printf '  %-11s 餵 0 條 ⇒ 跳過\n' "$P"
      continue
    fi
    # shellcheck disable=SC2086
    npx vitest run --project "$P" $filt > "/tmp/sql-scan-$P.out" 2>&1
    rc=$?
    ran=$(grep -oE 'Test Files.*\(([0-9]+)\)' "/tmp/sql-scan-$P.out" | grep -oE '\([0-9]+\)$' | tr -d '()' | tail -1)
    ran=${ran:-0}
    printf '  %-11s 餵 %2s 條 · 它跑 %2s 支 · rc=%s\n' "$P" "$fed" "$ran" "$rc"
    [ "$rc" -ne 0 ] && total_rc=1
    # 🔴 鐵則 11:餵的條數與跑的支數對不上 ⇒ 有東西被安靜地漏掉了
    if [ "$ran" -lt "$fed" ]; then
      echo "     🔴 餵 $fed 條而只跑了 $ran 支 ⇒ 有 filter 沒命中任何檔(vitest 對此【不報錯】)"
      echo "        log:/tmp/sql-scan-$P.out"
      miss=1
    fi
  done
  [ "$miss" -eq 1 ] && total_rc=1
  return "$total_rc"
}

case "${1:-}" in
  --staged)
    if git diff --cached --name-only | grep -q '^supabase/migrations/.*\.sql$'; then
      echo "staged 含 supabase/migrations/*.sql ⇒ 跑掃 migration 的那一族"
      run_family; exit $?
    else
      echo "staged 不含 supabase/migrations/*.sql ⇒ 本閘這一次不適用(不是綠, 是不適用)"
      exit 0
    fi
    ;;
  --selftest)
    ok=0
    F="$(family)"; N=$(echo "$F" | grep -c . || true)
    if [ "$N" -ge 10 ]; then echo "✅ P1 族撈得到($N 支, 門檻 10)"; else echo "🔴 P1 族只撈到 $N 支 ⇒ 尺可能沒接上"; ok=1; fi
    # 🟢 N1 負對照:--staged 在【沒有 .sql】的 index 上必須說「不適用」而不是綠
    if git diff --cached --name-only | grep -q '^supabase/migrations/.*\.sql$'; then
      echo "⚠️  N1 跳過:此刻 index 真的含 .sql ⇒ 這一格今天演不了(照實說, 不假裝過)"
    else
      out=$(bash "$0" --staged 2>&1)
      case "$out" in
        *不適用*) echo "✅ N1 沒有 .sql ⇒ 說「不適用」不是「綠」" ;;
        *)        echo "🔴 N1 沒有 .sql 而它說了別的:$out"; ok=1 ;;
      esac
    fi
    # 🟢 N2 負對照:project 分類函式要分得開三種, 而不是全部落回 node
    a=$(project_of apps/admin/src/x.test.ts); s=$(project_of apps/storefront/src/x.test.ts); n=$(project_of packages/domain/src/x.test.ts)
    if [ "$a" = admin ] && [ "$s" = storefront ] && [ "$n" = node ]; then
      echo "✅ N2 三個 project 分得開($a/$s/$n)"
    else echo "🔴 N2 分類壞了:$a/$s/$n"; ok=1; fi
    echo ""
    echo "射程:它比對【repo 內一致性】不是正式庫現況 ⇒ 它縮短窗口, 不消滅窗口。"
    echo "      它不看 APPLIED.tsv(#864:那個訊號本來就弱;實測 266 支 migration / 帳上 241)。"
    exit "$ok"
    ;;
  *)
    run_family; exit $?
    ;;
esac
