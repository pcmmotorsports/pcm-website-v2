#!/usr/bin/env bash
# migration-static-checks.sh — migration 檔的三道靜態檢查(不用連 DB)
#
# 用法:bash scripts/migration-static-checks.sh <migration.sql>
#
# 出處:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §7.5 步驟 2。
# 🔴 這三道 2026-08-16 全部改過 —— 原版在【合格的檔上誤報】,
#    是寫完第一支真的 migration 才發現的。原版錯在哪寫在各道的註解裡。
#
# 🔴 為什麼要有這支檔:那三道原本只寫在規格與 STOP 信裡。
#    規格會被讀,但【不會被執行】—— 而檢查不被執行就等於不存在。
set -uo pipefail

F="${1:-}"
if [ -z "$F" ] || [ ! -f "$F" ]; then
  echo "用法:bash scripts/migration-static-checks.sh <migration.sql>" >&2
  exit 2
fi

RC=0

# ── 共用:剝掉 dollar-quoted 區塊($tag$…$tag$)────────────────────────────
# 🔴 為什麼一開始就剝:plpgsql 函式體裡有一堆長得像禁詞的東西 ——
#    `IF NOT EXISTS (SELECT …)` 是條件判斷、`END;` 是區塊結尾,
#    **兩者都與「CREATE 時跳過」「結束交易」完全無關,而字面一模一樣。**
#    ⇒ 用結構分,不用「出現」分。這是本 repo patterns 檔在教的同一條。
STRIPPED="$(mktemp)"
trap 'rm -f "$STRIPPED"' EXIT
awk '
  {
    line = $0
    while (1) {
      if (intag == "") {
        if (match(line, /\$[A-Za-z_0-9]*\$/)) {
          intag = substr(line, RSTART, RLENGTH)
          out = out substr(line, 1, RSTART-1)
          line = substr(line, RSTART+RLENGTH)
        } else { out = out line; break }
      } else {
        idx = index(line, intag)
        if (idx > 0) { line = substr(line, idx+length(intag)); intag = "" }
        else { break }
      }
    }
    print out; out = ""
  }
' "$F" | sed 's/--.*$//' > "$STRIPPED"

echo "── ① 禁詞:CREATE … IF NOT EXISTS / CREATE OR REPLACE ────────────"
# 🔴 兩次誤報的修法都在這一行:
#    原版 ①:沒剝行註解 ⇒ 抓到【檔頭那段解釋這條規則的註解】
#    原版 ②:只找裸字面 ⇒ 抓到 plpgsql 的 `IF NOT EXISTS (SELECT …)`(條件判斷,不是 DDL)
#    ⇒ 現在:剝註解 + 剝 dollar-quote + **錨定在 CREATE 那一句上**。
HITS=$(grep -niE '^[[:space:]]*create[[:space:]].*(if[[:space:]]+not[[:space:]]+exists|or[[:space:]]+replace)' "$STRIPPED" || true)
if [ -n "$HITS" ]; then
  echo "🔴 命中(剝註解後):"; echo "$HITS" | sed 's/^/     /'
  echo "   ⇒ migration 建新物件一律裸 CREATE。撞名要當場紅,不要靜靜跳過。"
  echo "   ⇒ 跳過之後,你的 REVOKE 與斷言會對著那個既有物件跑而且很可能通過"
  echo "      —— 拿到綠燈,而這支 migration 什麼都沒建。"
  RC=1
else
  echo "✅ 零命中"
fi

echo "── ② 結束交易:commit / end / rollback 三種寫法 ───────────────────"
# 🔴 原版只找 '^ *commit;'。四臂實測它放行三種毒檔:
#      同一行 select 1; commit;  → 看不見(回 0)
#      中段 ROLLBACK;            → 過關(回 1)
#      中段 END;(COMMIT 同義字)  → 過關(回 1)
#    ROLLBACK 與 END 的毒性等同「中段 COMMIT」:交易中途結束,後面每句各自 autocommit。
#
# 🔴🔴 而把 END 加進來之後【誤報了】:plpgsql 的 `DO $x$ … END; $x$` 那個 END 也是這個字面。
#    ⇒ **字面分不出來,要用結構分**:用檔頭那個已經剝過 dollar-quote 的 $STRIPPED。
#    這正是本 repo patterns 檔在教的:用位置或結構判,不用「出現」判。
PAT='(^|;)[[:space:]]*(commit|end|rollback)[[:space:]]*;'
N=$(grep -ciE "$PAT" "$STRIPPED" || true)
LAST=$(wc -l < "$F" | tr -d ' ')
LINE=$(grep -niE "$PAT" "$STRIPPED" | tail -1 | cut -d: -f1)
if [ "$N" != "1" ]; then
  echo "🔴 命中 $N 次,預期恰好 1:"
  grep -niE "$PAT" "$STRIPPED" | sed 's/^/     /'
  echo "   ⇒ 檔頭 BEGIN、檔尾 COMMIT,中間不得有任何結束交易的語句。"
  RC=1
elif [ "$LINE" != "$LAST" ]; then
  echo "🔴 命中 1 次但不在最後一行(在第 $LINE 行,全檔 $LAST 行)"
  RC=1
else
  echo "✅ 恰好 1 次,且在最後一行(第 $LINE 行)"
fi

echo "── ③ 可授權物件數 vs 收權斷言清單長度 ────────────────────────────"
# 🔴 原版把 CREATE TRIGGER 也數進去 ⇒ 在合格檔上 3 vs 2 誤報漏列。
#    trigger 沒有 ACL,列進斷言清單反而會 to_regclass 找不到而紅。
OBJ=$(sed 's/--.*$//' "$F" | grep -cE '^CREATE (TABLE|VIEW|MATERIALIZED VIEW|FUNCTION)' || true)
# 🔴 必須支援【跨行的 ARRAY[...]】。原版只抓 `v_xxx text[] :=` 那一行,
#    而清單一旦換行(元素多了自然會換行),後面幾行就數不到
#    ⇒ 在一個【清單其實是對的】檔上誤報「有漏列」。2026-08-16 實際發生過。
#    ⇒ 從 `v_relations|v_functions` 那一行起,一路吃到 `]::text[]` 為止。
LST=$(awk '
  /^[[:space:]]*v_(relations|functions)[[:space:]]+text\[\][[:space:]]*:=/ { inlist=1 }
  inlist { print }
  inlist && /\]::text\[\]/ { inlist=0 }
' "$F" | grep -oE "'[^']+'" | wc -l | tr -d ' ')
if [ "$OBJ" != "$LST" ]; then
  echo "🔴 可授權物件 $OBJ 個,斷言清單列了 $LST 個 ⇒ 有漏列"
  echo "   ⇒ 收權斷言【只檢查你列出來的物件】:它防「忘記收權」,不防「忘記列」。"
  RC=1
else
  echo "✅ 兩邊都是 $OBJ 個"
fi

echo "──────────────────────────────────────────────────────────────────"
if [ "$RC" = "0" ]; then
  echo "✅ 三道靜態檢查全過:$F"
else
  echo "🔴 有檢查未過:$F"
fi
echo "⚠️ 靜態檢查【不驗行為】—— 它證的是「我沒寫那個字面」,"
echo "   不證「撞名時會紅」。後者要在拋棄式 PG 上重跑一次同一支 SQL。"
exit "$RC"
