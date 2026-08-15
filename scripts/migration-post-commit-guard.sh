#!/usr/bin/env bash
# migration-post-commit-guard.sh —— `#531`:migration 的最後一個 `COMMIT;` 之後不得再有 DDL/DML。
#
# ============================================================================
# 🔴 這道守門在防什麼(失效形狀,E 窗 `E-640` 實測)
# ----------------------------------------------------------------------------
#   內層 `COMMIT;` 結束外層交易 ⇒ 之後每一句在 autocommit 下【各自提交】
#   ⇒ 斷言失敗時**沒有交易可以回滾**,而 migration 仍然回報失敗
#   ⇒ **人以為整片沒生效,實際上半支已經落地。**
#   ⚠️ 症狀是「看起來失敗了」,而那正是最難察覺的一種:失敗訊息把人指向「重跑一次」,
#      而重跑會撞上「已存在」之類的錯,再把人指向別的地方。
#
# 🔴 本 repo 落地當下:**零命中**(不是抽樣,是逐支掃)
#   分母  ls supabase/migrations/*.sql | wc -l                      ⇒ 175
#   其中自己寫 COMMIT 的  grep -lE '^\s*COMMIT\s*;' … | wc -l        ⇒ 86
#   最後一個 COMMIT 之後仍有 DDL/DML                                  ⇒ 0
#   正向對照:拿某支的 `BEGIN;` 行當假的 COMMIT 位置,其後 DDL 行數    ⇒ 6（非 0 ⇒ pattern 是活的）
#   ⇒ **現在無人踩到,而踩到不會有任何東西叫** —— 這道守門是為了讓「第一次踩到」會紅。
#
# ============================================================================
# ⚠️ 覆蓋界線:它釘得到什麼、釘不到什麼(不要讓它看起來比實際強)
# ----------------------------------------------------------------------------
# ✅ 釘得到
#   · 最後一個 `COMMIT;` 之後,行首(允許前導空白)出現 DDL/DML 關鍵字
#   · `#530` 那組「會沖掉批次」的語句出現在**交易區塊之內**
# 🔴 釘不到 —— 逐條寫出來,不要讓下一個人以為這面已經全包
#   1. **同一行內的多句**:`COMMIT; CREATE TABLE x(...);` 寫在一行 ⇒ 本支只看行首,抓不到。
#      (本 repo 現況零這種寫法,但它不是被守住的,是還沒有人這樣寫。)
#   2. **字串或 dollar-quoted 區塊裡的關鍵字**:`DO $$ … 'CREATE TABLE' … $$;` 的字面
#      —— 本支剝註解但**不解析 SQL**,字串內的關鍵字若出現在行首會誤報。
#   3. **由變數 / psql 代換組出來的語句**:`\i` include、`:'var'` 代換 ⇒ 本支看不到展開後的內容。
#   4. **執行期才決定的分支**:`DO` 區塊裡依條件執行的 DDL ⇒ 本支只看文字,不知道它跑不跑。
#   📎 同族實例(B 窗 2026-08-16):一行寫死在 CSS 裡的 `6px`,它的守門抓不到 ——
#      **因為那是 raw CSS、沒有 class 可釘**。**守門釘的是它看得到的形狀,不是事實。**
#
# 🔴 **剝註解是必要的,不是整潔**:本 repo 有 4 支 migration 在**註解裡**討論
#   「為什麼不用 CONCURRENTLY」(`20260811040000` / `20260811110000` / `20260812130000` /
#   `20260813120000`)。不剝註解 ⇒ 那四支全部誤報,而它們一個字都沒做錯。
#   (寫本支時第一版就這樣誤報了 4 檔 —— 留在這裡當理由,不是當笑話。)
# ============================================================================

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DIR="${1:-supabase/migrations}"
FAIL=0

# 行首 DDL/DML 關鍵字。🔴 字集刻意寬:寧可誤報一次讓人來讀,不要漏放一句 DDL 出去。
DDL='^[[:space:]]*(CREATE|ALTER|DROP|COMMENT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DO|TRUNCATE|CALL|ANALYZE|VACUUM|REFRESH|NOTIFY|REINDEX|CLUSTER|SECURITY[[:space:]]+LABEL)\b'
# `#530`:會沖掉批次的語句 —— 出現在交易區塊【內】就是原子性斷點。
BATCH_BREAKER='(CREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY|REINDEX[[:space:]]+[A-Z]*[[:space:]]*CONCURRENTLY|^[[:space:]]*VACUUM\b|^[[:space:]]*CLUSTER\b|ALTER[[:space:]]+SYSTEM\b)'

# 剝註解:`--` 行註解與 `/* */` 區塊註解。⚠️ 不是完整 parser（見上方界線 2）。
strip_comments() {
  perl -0pe 's{/\*.*?\*/}{}gs; s{^\s*--.*$}{}gm; s{\s--[^\n]*$}{}gm' "$1"
}

for f in "$DIR"/*.sql; do
  [ -e "$f" ] || continue
  body=$(strip_comments "$f")

  # ── ① 最後一個 COMMIT 之後不得有 DDL/DML ────────────────────────────
  last=$(printf '%s\n' "$body" | grep -nE '^[[:space:]]*COMMIT[[:space:]]*;' | tail -1 | cut -d: -f1)
  if [ -n "$last" ]; then
    after=$(printf '%s\n' "$body" | awk -v L="$last" 'NR>L' | grep -nE "$DDL" || true)
    if [ -n "$after" ]; then
      echo "🔴 $f:最後一個 COMMIT;(第 $last 行,剝註解後)之後仍有 DDL/DML:"
      printf '%s\n' "$after" | sed 's/^/     /'
      echo "     ⇒ 那些句子會在 autocommit 下【各自提交】,失敗時沒有交易可回滾。"
      FAIL=1
    fi
  fi

  # ── ② #530:交易區塊內不得出現會沖掉批次的語句 ──────────────────────
  begin=$(printf '%s\n' "$body" | grep -nE '^[[:space:]]*BEGIN[[:space:]]*;' | head -1 | cut -d: -f1)
  if [ -n "$begin" ] && [ -n "$last" ]; then
    inside=$(printf '%s\n' "$body" | awk -v A="$begin" -v B="$last" 'NR>A && NR<B' | grep -nE "$BATCH_BREAKER" || true)
    if [ -n "$inside" ]; then
      echo "🔴 $f:交易區塊內(第 $begin–$last 行)有會沖掉批次的語句:"
      printf '%s\n' "$inside" | sed 's/^/     /'
      echo "     ⇒ 原子性在那一刀就斷了(#530)。要用它就把整支拆成交易外的獨立步驟。"
      FAIL=1
    fi
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "✅ migration post-COMMIT 守門:通過($(ls "$DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') 支)"
fi
exit "$FAIL"
