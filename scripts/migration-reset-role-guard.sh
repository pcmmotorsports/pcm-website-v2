#!/bin/sh
# migration-reset-role-guard.sh — migration 檔裡不要用 `RESET ROLE`
#
#   sh scripts/migration-reset-role-guard.sh              量 supabase/migrations
#   sh scripts/migration-reset-role-guard.sh --selftest    四個世界各表演一次
#
# ── 完整因果鏈(G6 2026-08-18 查明,#628 結案後長出來的)────────────────────
#   1 supabase CLI 以 `cli_login_<ref>` 連線,session_user = 它
#   2 CLI 進來先下 `SET SESSION ROLE postgres`
#   3 🔴 而那個登入角色是 **NOINHERIT** ⇒ 不繼承 postgres 的權限
#   4 migration 裡的 `RESET ROLE` ⇒ current_user 回到 **session_user**(不是 postgres)
#   5 那個身分在 COMMIT 之後仍然有效,而**帳本 INSERT 在 COMMIT 之後跑**
#   6 `supabase_migrations` owner=postgres / nspacl=null ⇒ 非 owner 無 USAGE
#     ⇒ `ERROR: permission denied for schema supabase_migrations`
#   ⇒ 症狀:那支 migration 的 SQL **生效了**,而**帳本沒記** ⇒ 下一次 db push 會**重跑它**。
#   ⇒ 要還原角色用 `SET LOCAL ROLE`(COMMIT 時自己還原),不要 `RESET ROLE`。
#   📎 G6 第一發**沒重現出來**(第一個測試角色 rolinherit=true)——
#      **那不是實驗失敗,是它告訴我鏈少一環**,少的就是第 3 環。
#
# ── ⚠️ 射程(G6 自標,原文採用)──────────────────────────────────────────
#   · 只擋【字面出現 RESET ROLE】,擋不掉「用別的方式把身分留在 session_user」
#   · 正式庫 `rolinherit=false` 是 **Sean 21:0x 量的**,G6 沒有連線 ⇒ 那一環是**轉述**
#   · 重現跑在本機 PG 17.10、正式庫 17.6 ⇒ 證的是【機制】不是【現值】
#
# ── 🔴 期望值刻意寫死(同 authz-failure-visibility.sh)────────────────────
#   ⛔ ~~1 = 已知那一支 `20260817080000_m4b_628_…`~~
#   ✅ **[2026-09-05 17:2x 線 -db 訂正] 2 支** —— 而訂正的成因值得寫下來:
#      這道 guard **從來沒有被接進 .husky** ⇒ 它寫好了、自己會動、而【沒有任何東西在叫它】
#      ⇒ 期望值停在它出生那天的 1, 而樹上早就是 2。
#      🔬 2026-09-05 實量(用它自己那條 regex):
#        · `20260817080000_m4b_628_revoke_maintain_brands_categories.sql`(碼 3 行)
#        · `20260829170000_m4b_2b1_admin_coupon_list_view.sql`(碼 2 行:SET LOCAL ROLE + 兩個 RESET ROLE)
#      📌 **⇒ 一道沒有人在叫的閘, 它的期望值會靜靜地過期, 而【過期的方向永遠是「看起來還好」】。**
#
#   🔵 **而第二支 apply 過了、帳本也記到了 —— 為什麼沒出事**(這一格不寫下來會被讀成「這道閘沒用」):
#      本閘防的失效模式是 **supabase CLI 專屬**:CLI 以 `cli_login_<ref>` 連線而那個角色 NOINHERIT
#      ⇒ `RESET ROLE` 之後 current_user 掉回 session_user ⇒ COMMIT 之後的帳本 INSERT 權限不足。
#      而 `20260829170000` 是 **Sean 在 SQL Editor 本人貼的**(帳本那一列逐字寫著)——
#      SQL Editor 連線就是 postgres ⇒ `RESET ROLE` 回到 postgres ⇒ 那條路踩不到這個坑。
#      🛑 **⇒ 這道閘防的是一條【我們今天沒在走的路】。留著的理由是那條路會回來**
#         (任何人改用 `supabase db push` 的那一天), **而不是因為今天有人被它咬過。**
#
#   >EXPECT ⇒ 有新的 migration 用了 RESET ROLE ⇒ 它若走 CLI apply 就會漏記帳
#   <EXPECT ⇒ 有人改掉了那些字面 ⇒ 回來改期望值並註明是誰改的
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1
EXPECT_FILES=2
# 🔴 正向對照恆為 1:小數字的天花板 —— 「pattern 打錯永遠回 0」與「真的沒有」長得一樣
FIXTURE="scripts/fixtures/reset-role.fixture.sql"
FIXTURE_EXPECT=1

count_in() { grep -rlE "^[[:space:]]*RESET[[:space:]]+ROLE" $1 2>/dev/null | wc -l | tr -d ' '; }
verdict() { [ "$2" = "$3" ] && printf '  ✅ %s:%s(期望 %s)\n' "$1" "$2" "$3" || printf '  🔴 %s:%s(期望 %s)\n' "$1" "$2" "$3"; }

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  mkdir -p "$T/m"
  i=0; while [ "$i" -lt "$EXPECT_FILES" ]; do printf 'RESET ROLE;\n' > "$T/m/a$i.sql"; i=$((i+1)); done
  printf 'SET LOCAL ROLE postgres;\n' > "$T/m/ok.sql"
  A=$(count_in "$T/m/*.sql")
  printf 'RESET ROLE;\n' > "$T/m/extra.sql"
  B=$(count_in "$T/m/*.sql")
  C=$(count_in "$FIXTURE")
  D=$(grep -rlE "這個字串保證不會出現xyzzy" "$FIXTURE" 2>/dev/null | wc -l | tr -d ' ')
  verdict "世界一 樹裡恰有 $EXPECT_FILES 支" "$A" "$EXPECT_FILES"
  verdict "世界二 多一支之後(要不等於 $EXPECT_FILES)" "$B" "$((EXPECT_FILES + 1))"
  verdict "世界三 fixture 同一支 pattern" "$C" "$FIXTURE_EXPECT"
  verdict "世界四 pattern 弄壞 ⇒ fixture 跟著掉" "$D" "0"
  printf '  (跑的是 %s)\n' "$(command -v grep)"
  if [ "$A" = "$EXPECT_FILES" ] && [ "$B" != "$EXPECT_FILES" ] \
     && [ "$C" = "$FIXTURE_EXPECT" ] && [ "$D" = "0" ]; then
    printf '✅ 四個世界都對:數字對=綠;多一支=抓得到;fixture 校準住尺;pattern 壞掉 fixture 會跟著掉\n'
    exit 0
  fi
  printf '🔴 這支自己壞了 —— 它的綠不能當證據\n'
  exit 1
fi

FIX=$(count_in "$FIXTURE")
if [ "$FIX" != "$FIXTURE_EXPECT" ]; then
  printf '🔴 正向對照壞了:fixture 量到 %s(恆應 %s)⇒ **pattern 壞了,不是沒有 RESET ROLE。**\n' "$FIX" "$FIXTURE_EXPECT"
  exit 1
fi
N=$(count_in "supabase/migrations/*.sql")
printf '正向對照      fixture %s(恆應 %s)\n用 RESET ROLE 的 migration  %s 支(期望 %s)\n(跑的是 %s)\n' \
  "$FIX" "$FIXTURE_EXPECT" "$N" "$EXPECT_FILES" "$(command -v grep)"
if [ "$N" = "$EXPECT_FILES" ]; then
  printf '✅ 與已知相同 —— **這不代表沒問題,代表【沒有變化】。**\n'; exit 0
fi
if [ "$N" -gt "$EXPECT_FILES" ]; then
  printf '🔴 多了 ⇒ **有新的 migration 用了 RESET ROLE,它一 apply 就會漏記帳**\n'
else
  printf '🔶 少了 ⇒ 有人改掉了那支的字面 ⇒ 回來改 EXPECT_FILES 並註明是誰改的\n'
fi
exit 1
