#!/bin/sh
# ============================================================
# is-migration-applied.sh — 「這支 migration 到底貼了沒」的【問法產生器】
# ============================================================
# 線 -db 2026-09-03 建。成因 = 同一夜三次「帳本 0 而正式庫有」:
#   20260902120000(取消信白名單)· 20260828060000(第 6 支排程心跳)⇒ 兩支都【已貼】
#   20260903040000(未付款取消信)                                  ⇒ 這支是【真的沒貼】
#   🔴 三支在 `supabase/APPLIED.tsv` 上【印同一個 0】。
#
# 🛑🛑 **本支【不連 DB】,而那是它的設計不是它的缺陷** ——
#    施工窗沒有正式庫存取, 而需要這個答案的人就是施工窗。
#    ⇒ 它產出一段【唯讀 SQL】, 交給有 access 的人跑。
#
# 🔴🔴 **它真正解的那件事:大部分 migration 的「東西在不在」【零判別力】。**
#    · `CREATE OR REPLACE FUNCTION` ⇒ 舊版新版**都在** ⇒ 問「函式在不在」兩個世界同一個答案
#    · `ADD CONSTRAINT x_v2 … RENAME x_v2 TO x` ⇒ 貼完之後**名字跟貼之前一樣**
#    ⇒ 📌 **一個問錯的查詢會回一個看起來很合理的答案, 而沒有東西會說它問錯了。**
#    ⇒ 所以本支對每一個抽出來的物件, 都標【判別力】: 有 / 無 / 未知。
#
# 🛑 **它答不出什麼**(先講, 不要拿它當它不是的東西):
#    · 它讀的是 SQL 的**字面**, 不執行它 ⇒ 動態產生的 DDL(`EXECUTE format(...)`)它看不到
#    · 「新值」是**猜的**(見下面那條啟發式)⇒ 猜錯時它會印出依據, 讓你自己推翻
#    · 產出的 SQL 回什麼, 本支不知道 ⇒ **判讀在跑的人手上, 而每一格都附兩個世界的期望值**
#    · 它不查帳本 —— 三本帳的分岔看 `scripts/migration-ledger-divergence.sh`(那是另一件事:
#      那支問「有沒有人記」, 本支問「東西在不在」)
#
# 用法  bash scripts/is-migration-applied.sh <migration 檔名或路徑>
#       bash scripts/is-migration-applied.sh --selftest
# ============================================================
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
MIGDIR="$REPO/supabase/migrations"

die() { printf '🔴 %s\n' "$1" >&2; exit 2; }

# ── 解析參數 ───────────────────────────────────────────────
[ $# -ge 1 ] || die "要給一個 migration 檔名。用法: bash scripts/is-migration-applied.sh <檔名>"

if [ "$1" = "--selftest" ]; then SELFTEST=1; shift; else SELFTEST=0; fi
[ $# -ge 1 ] || die "--selftest 之後仍然要給檔名, 或單獨跑 --selftest"

ARG=$1
if [ -f "$ARG" ]; then FILE=$ARG
elif [ -f "$MIGDIR/$ARG" ]; then FILE="$MIGDIR/$ARG"
else
  # 允許只給版本號前綴
  FILE=$(ls "$MIGDIR"/"$ARG"*.sql 2>/dev/null | head -1)
  [ -n "$FILE" ] && [ -f "$FILE" ] || die "找不到這支 migration: $ARG
   已試: 當成路徑 / 當成 $MIGDIR 底下的檔名 / 當成版本號前綴
   🔵 這是【報錯】不是印空 —— 一個查無若印空, 會被讀成「這支沒有任何物件」。"
fi

BASE=$(basename "$FILE")
VER=$(printf '%s' "$BASE" | sed 's/_.*//')

printf '======== is-migration-applied ========\n'
printf '檔  %s\n' "$BASE"
printf '版本 %s\n\n' "$VER"

# ── 帳本那一格(只印, 不當判準)────────────────────────────
# 🔴 `grep -c` 命中 0 時【印 0 而 rc=1】⇒ 加 `|| echo 0` 會印出「0\n0」, 而它讀起來像兩列。
#    那正是本 repo 記過的「一個合法的零會截斷 &&」同一族 ⇒ 用 `; true` 吞 rc, 不要補印。
LEDGER=$(grep -c "^$VER" "$REPO/supabase/APPLIED.tsv" 2>/dev/null; true)
printf '帳本 supabase/APPLIED.tsv 命中 %s 列\n' "$LEDGER"
printf '🛑 **這個數字不是判準** —— 同一夜實測三支都印 0, 而其中兩支已貼。\n'
printf '   帳本答的是「有沒有人【記】」, 不是「東西在不在」。\n\n'

# ── ① 抽物件 ──────────────────────────────────────────────
printf '──── ① 這支建了什麼(逐項標判別力)────\n'
FOUND=0

emit() { FOUND=$((FOUND+1)); printf '%s\n' "$1"; }

# 新表 / 新 index / 新 policy / 新 view / 新 type —— 存在性【有】判別力
grep -oE '^[[:space:]]*CREATE (UNIQUE )?(TABLE|INDEX|POLICY|VIEW|TYPE|SCHEMA)[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_."]+' "$FILE" 2>/dev/null \
| sed 's/^[[:space:]]*//' | sort -u | while IFS= read -r L; do
  printf '  🟢 %s\n     判別力【有】—— 這是新物件, 沒貼就不存在。\n' "$L"
done
CNT_NEW=$(grep -cE '^[[:space:]]*CREATE (UNIQUE )?(TABLE|INDEX|POLICY|VIEW|TYPE|SCHEMA)' "$FILE" 2>/dev/null; true)
[ "$CNT_NEW" -gt 0 ] && FOUND=$((FOUND+CNT_NEW))

# CREATE OR REPLACE FUNCTION —— 存在性【零】判別力
grep -oE '^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]+[A-Za-z0-9_."]+' "$FILE" 2>/dev/null \
| sed 's/^[[:space:]]*//' | sort -u | while IFS= read -r L; do
  printf '  🔴 %s\n     判別力【零】—— 舊版新版都在。要問的是 **body 裡有沒有新版才有的字面**。\n' "$L"
done
CNT_COR=$(grep -cE '^[[:space:]]*CREATE OR REPLACE FUNCTION' "$FILE" 2>/dev/null; true)
[ "$CNT_COR" -gt 0 ] && FOUND=$((FOUND+CNT_COR))

# ADD CONSTRAINT + RENAME 舞步 —— 名字【零】判別力
CNT_REN=$(grep -cE 'RENAME CONSTRAINT' "$FILE" 2>/dev/null; true)
CNT_ADD=$(grep -cE 'ADD CONSTRAINT' "$FILE" 2>/dev/null; true)
if [ "$CNT_ADD" -gt 0 ]; then
  FOUND=$((FOUND+CNT_ADD))
  grep -oE 'ADD CONSTRAINT[[:space:]]+[A-Za-z0-9_]+' "$FILE" | sort -u | while IFS= read -r L; do
    if [ "$CNT_REN" -gt 0 ]; then
      printf '  🔴 %s\n     判別力【零】—— 本檔有 RENAME CONSTRAINT ⇒ 貼完之後名字跟貼之前【一樣】。\n' "$L"
      printf '     要問的是 **約束定義裡有沒有新值**。\n'
    else
      printf '  🟢 %s\n     判別力【有】—— 沒有 RENAME ⇒ 這個名字是新的。\n' "$L"
    fi
  done
fi

# ADD COLUMN —— 有判別力
grep -oE 'ADD COLUMN[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_]+' "$FILE" 2>/dev/null | sort -u | while IFS= read -r L; do
  printf '  🟢 %s\n     判別力【有】—— 新欄位, 沒貼就不存在。\n' "$L"
done
CNT_COL=$(grep -cE 'ADD COLUMN' "$FILE" 2>/dev/null; true)
[ "$CNT_COL" -gt 0 ] && FOUND=$((FOUND+CNT_COL))

if [ "$FOUND" -eq 0 ]; then
  printf '  ⚠️ **這支我抽不出任何物件** ⇒ 請人工開檔看。\n'
  printf '     (它可能是純 DO 區塊 / 動態 DDL / 只有 COMMENT / 只有資料異動)\n'
  printf '     🛑 本支【不猜】—— 一個猜出來的判別點比沒有判別點糟。\n\n'
fi
printf '\n'

# ── ② 新字面啟發式 ────────────────────────────────────────
printf '──── ② 新字面(啟發式, 依據印在旁邊)────\n'
printf '判法:本檔裡的單引號字面, 逐個去【比本檔早的所有 migration】裡找;\n'
printf '      一個都找不到的 ⇒ 它很可能就是這支新加的值。\n'
printf '🛑 這是【猜的】。它會漏(新值剛好在舊檔的註解裡出現過)也會多(無關的新字串)。\n'
printf '   ⇒ 底下每一個候選都要你自己開檔核, 而依據就是它們為什麼被選中。\n\n'
NOVEL=""
for LIT in $(grep -oE "'[a-z][a-z0-9_]{3,40}'" "$FILE" | sort -u | tr -d "'"); do
  HIT=0
  for OLD in "$MIGDIR"/*.sql; do
    OB=$(basename "$OLD"); OV=$(printf '%s' "$OB" | sed 's/_.*//')
    [ "$OV" -lt "$VER" ] 2>/dev/null || continue
    if grep -q "'$LIT'" "$OLD" 2>/dev/null; then HIT=1; break; fi
  done
  if [ "$HIT" -eq 0 ]; then
    printf '  🔵 候選新字面: %s\n' "$LIT"
    NOVEL="$NOVEL $LIT"
  fi
done
[ -n "$NOVEL" ] || printf '  ⚠️ 找不到任何「早於本檔的 migration 都沒出現過」的字面。\n     ⇒ 這支的新東西可能不是一個字串 ⇒ 請人工開檔看。\n'
printf '\n'

# ── ③ 產出唯讀 SQL ────────────────────────────────────────
OUT="${TMPDIR:-/tmp}/is-applied-$VER.sql"
{
printf -- '-- 「%s 貼了沒」唯讀查詢 —— 由 scripts/is-migration-applied.sh 產生\n' "$BASE"
printf -- '-- 🛑 零寫入, 可安全重跑。每一格都附【兩個世界的期望值】。\n'
printf -- '-- 🔴 回 0 之前先看正對照:正對照不對, 那個 0 是尺沒接上, 不是「沒貼」。\n\n'
grep -oE '^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]+[A-Za-z0-9_.]+' "$FILE" 2>/dev/null | sed 's/.*FUNCTION[[:space:]]*//' | sort -u | while IFS= read -r FN; do
  SCH=$(printf '%s' "$FN" | cut -d. -f1); NM=$(printf '%s' "$FN" | cut -d. -f2)
  printf -- '-- 🔵 正對照:函式在不在(期望 1)。回 0 ⇒ 尺沒接上。\n'
  printf -- "SELECT '正對照 %s 存在(期望1)' AS 格, count(*)::text AS 值\n" "$FN"
  printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s';\n\n" "$SCH" "$NM"
  # 🔴🔴 **候選只能取自【函式 body 內】, 不是整個檔** —— 2026-09-03 實測:
  #    20260828060000 的檔案裡有一個 md5 `b5a7681b…`, 它住在**註解與 apply 斷言**裡、
  #    **不在 body**(`sed -n '189,282p' | grep -c` ⇒ 0)。
  #    ⇒ 拿它去問 `pg_get_functiondef` 會回 **0**, 而那個 0 是【它本來就不該在那裡】,
  #      不是「沒貼」⇒ 📌 **一格合理的 0, 會把讀的人推向相反的結論。**
  # ✅ 所以下面用 body 區間(CREATE OR REPLACE FUNCTION 那一行起, 到 `$` 收尾)裡的字面。
  BODY_LITS=$(sed -n "/^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]*$FN/,/^[[:space:]]*\\\$[a-z]*\\\$;/p" "$FILE" \
    | grep -oE "'[a-z][a-z0-9_-]{3,40}'" | tr -d "'" | sort -u)
  [ -n "$BODY_LITS" ] || printf -- '-- ⚠️ body 裡抽不到字面 ⇒ 這一支要人工挑判別點。\n\n'
  for LIT in $BODY_LITS; do
    printf -- '-- 🔴 判別:body 含新版才有的字面(1=已貼 / 0=沒貼)\n'
    printf -- "SELECT 'body 含 %s(1=已貼)' AS 格, count(*)::text AS 值\n" "$LIT"
    printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s'\n   AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%%%s%%';\n\n" "$SCH" "$NM" "$LIT"
  done
  printf -- '-- 🔴🔴 **最終判準是這一格, 不是上面那些單一字面** ——\n'
  printf -- '--    上面每個字面都可能【舊版也有】(例 failed / unpaid)⇒ 回 1 不代表已貼。\n'
  printf -- '--    ⇒ 把下面這段定義, 拿去跟這支 migration 裡那段 CREATE OR REPLACE 逐字比。\n'
  printf -- "SELECT '函式定義全文(拿去跟 migration 逐字比)' AS 格,\n       pg_catalog.pg_get_functiondef(p.oid) AS 值\n  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s';\n\n" "$SCH" "$NM"
  printf -- '-- 🔵 負對照:同一把尺找一個現造字面(期望 0)。回非 0 ⇒ LIKE 寫壞了。\n'
  printf -- "SELECT '負對照 現造字面(期望0)' AS 格, count(*)::text AS 值\n"
  printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s'\n   AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%%zzq_not_a_real_token_9f%%';\n\n" "$SCH" "$NM"
done
grep -oE 'ADD CONSTRAINT[[:space:]]+[A-Za-z0-9_]+' "$FILE" 2>/dev/null | sed 's/.*CONSTRAINT[[:space:]]*//' | sort -u | while IFS= read -r CN; do
  REAL=$(printf '%s' "$CN" | sed 's/_v[0-9]*$//')
  printf -- '-- 🔵 正對照:約束在不在(期望 1)。\n'
  printf -- "-- 🛑 注意本檔有 RENAME ⇒ 貼完之後名字是 %s(不是 %s)⇒ 這一格【零判別力】, 只證尺接上了。\n" "$REAL" "$CN"
  printf -- "SELECT '正對照 約束 %s 存在(期望1)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint WHERE conname='%s';\n\n" "$REAL" "$REAL"
  printf -- '-- 🔴 判別:約束定義的【全文】—— 自己看新值在不在(本支不替你判)\n'
  printf -- "SELECT '約束定義全文' AS 格, pg_catalog.pg_get_constraintdef(oid) AS 值\n  FROM pg_catalog.pg_constraint WHERE conname='%s';\n\n" "$REAL"
  # 🔴🔴 **CHECK 這一族【不用】上面那個新字面啟發式** —— 2026-09-03 實測它會漏, 而且安靜:
  #    20260902120000 加的是 'order_cancelled', 而那個字面早在
  #    20260810010000(完全不同的語境)出現過 ⇒ 啟發式把它濾掉 ⇒ **候選裡沒有正確答案**。
  #    ⇒ 📌 一個會漏而不出聲的判別點, 比沒有判別點糟。
  # ✅ 改法:把**這一條 CHECK 裡的每一個值**都問一遍, 不篩。多問幾格不花錢, 漏掉那一格會給錯答案。
  for LIT in $(grep -A3 "ADD CONSTRAINT[[:space:]]*$CN" "$FILE" | grep -oE "'[a-z][a-z0-9_]*'" | tr -d "'" | sort -u); do
    printf -- "SELECT '定義含 %s(該有=1)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint\n WHERE conname='%s' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%%%s%%';\n\n" "$LIT" "$REAL" "$LIT"
  done
  printf -- '-- 🔴 判讀:上面那組值【全部都是 1】才是已貼。少任何一個 ⇒ 正式庫是舊版。\n'
  printf -- '-- 🛑 而【值是子字串】的陷阱:order_cancelled 是 order_unpaid_cancelled 的一部分\n'
  printf -- "--    ⇒ 新版貼了之後, 舊版那些值【也還是 1】。所以判準是【全部都 1】不是【某一個是 1】。\n"
  printf -- '--    ⇒ 而最終判準仍然是上面那一格【約束定義全文】—— 拿它跟這支 migration 的 CHECK 逐字比。\n\n'
  printf -- '-- 🔵 負對照(期望 0)\n'
  printf -- "SELECT '負對照 現造字面(期望0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint\n WHERE conname='%s' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%%zzq_not_a_real_token_9f%%';\n\n" "$REAL"
done
} > "$OUT"

LINES=$(grep -c '' "$OUT")
WRITES=$(grep -ciE '^[[:space:]]*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)' "$OUT" 2>/dev/null; true)
printf '──── ③ 唯讀 SQL 已產出 ────\n'
printf '  路徑 %s\n' "$OUT"
printf '  行數 %s · 寫入類語句 %s(必須是 0)\n' "$LINES" "$WRITES"
if [ "$LINES" -le 3 ]; then
  printf '  ⚠️ **這支我產不出有意義的查詢** ⇒ 上面 ① 抽不到可查的物件形狀。\n'
  printf '     ⇒ 請人工開檔看。**本支寧可說做不到, 不產一段看起來像答案的 SQL。**\n'
fi
printf '\n🔵 交給有 access 的人跑, 而叫他回報【每一格的值】不是一句「有/沒有」——\n'
printf '   一句判斷在兩個世界可以是同一句話, 一組值不會。\n'
