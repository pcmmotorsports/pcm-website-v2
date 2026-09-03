#!/usr/bin/env bash
# ============================================================
# rls-policy-debt.sh — 「還有幾張表開了 RLS 而 service_role 讀不到」
# ------------------------------------------------------------
# 🎯 用途:在【動 `BYPASSRLS` / `ALTER ROLE` / 收緊 RLS】之前跑一發。
#    那個數字不是 0 ⇒ 停下來問, 因為收掉 `BYPASSRLS` 會在那幾張表上同時發生, 而且【全部靜默】。
#    (實測 2026-09-01:RLS 開 + 零 policy + 沒有 BYPASSRLS 的角色 ⇒ 讀到 0 列【而且不報錯】)
#
# 🛑🛑 它是【盤點工具】, 不是【守門】—— 這一行寫死, 不要讓它升級:
#    · 它要連【正式庫】(唯讀), 而那條連線 2026-09-01 只有一個窗有
#    · ⇒ 📌 **一支只有一個人跑得動的工具, 與一支不存在的工具, 對別人是同一件事。**
#    · ⇒ 所以它【不掛 pre-commit / CI】—— 掛上去只會對其他人 ENV-FAIL, 而那會訓練人略過它
#
# 🔴 而它印的數字【一定帶判準】—— 那是它存在的第二個理由:
#    2026-09-01 有兩份稽核各報 45 與 37, 而沒有人知道差在哪
#    ⇒ 兩把尺在量兩件事(45 = 沒有 service_role 讀得到的 SELECT policy;37 = 一條 policy 都沒有)
#    ⇒ ⇒ 📌 **一個數字不帶判準, 與一個錯的數字, 在對帳的時候長得一樣。**
#
# 🛑 它答不出什麼:
#    · 那幾張表【各自用哪一把鑰匙讀】—— 它只數 `.from('<表>')` 的檔數, 而那分不出
#      anon client 與 service_role client
#    · 走 `SECURITY DEFINER` RPC 讀的表【不需要】那條 policy(2026-09-01 實測)
#      ⇒ 所以「有直接呼叫端」那個數是【要補的上界】, 不是要補的張數
#    · 它讀的是【正式庫此刻】—— `pg_policy` 隨時可能被 dashboard 改
#
# 用法:
#   bash scripts/rls-policy-debt.sh              # 需要 .env.local 裡的 PCM_READONLY_DATABASE_URL
#   bash scripts/rls-policy-debt.sh --selftest   # 不連正式庫, 用拋棄式 PG 驗這支腳本自己
# 退出碼:0 = 量到了(不論數字多少)· 2 = ENV-FAIL(連不上 / 沒有連線字串)· 1 = selftest 失敗
# ============================================================
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SQL_DEBT="
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid=c.oid
                         and p.polcmd in ('r','*')
                         and (p.polroles='{0}'::oid[] or 'service_role'::regrole = any(p.polroles))))
  || '|' ||
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid=c.oid))
  || '|' ||
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity)
  || '|' ||
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r')
  || '|' ||
  (select coalesce(string_agg(rolname||'='||rolbypassrls::text, ' ' order by rolname), '(none)')
     from pg_roles where rolname in ('service_role','anon','authenticated'))
  || '|' ||
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity);
"

list_debt_tables() {
  psql "$1" -tAc "
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid=c.oid
                         and p.polcmd in ('r','*')
                         and (p.polroles='{0}'::oid[] or 'service_role'::regrole = any(p.polroles)))
     order by 1;" 2>/dev/null
}

# ── selftest:不碰正式庫, 起一顆拋棄式 PG 驗這支腳本【在兩個世界印不同的東西】 ──
if [ "${1:-}" = "--selftest" ]; then
  export LC_ALL=C LANG=C
  command -v initdb >/dev/null || { echo "🔴 ENV-FAIL:找不到 initdb ⇒ selftest 跑不了(這不是量測結果)"; exit 2; }
  D=$(mktemp -d /tmp/rlsdebt.XXXX); PORT=${SELFTEST_PORT:-59897}
  trap 'pg_ctl -D "$D/db" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
  initdb -D "$D/db" -U postgres --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:initdb 失敗"; exit 2; }
  pg_ctl -D "$D/db" -o "-k $D -p $PORT -h ''" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:pg_ctl 失敗"; exit 2; }
  U="postgresql://postgres@/postgres?host=$D&port=$PORT"
  psql "$U" -tAc "select 1;" 2>/dev/null | grep -q '^1$' || { echo "🔴 ENV-FAIL:連不上拋棄式 PG"; exit 2; }
  psql "$U" -q >/dev/null 2>&1 <<'SQL'
create role service_role; create role anon; create role authenticated;
create table public.a_no_policy(id int);           alter table public.a_no_policy enable row level security;
create table public.b_wrong_policy(id int);        alter table public.b_wrong_policy enable row level security;
create policy p_b on public.b_wrong_policy for select to anon using (true);
create table public.c_good_policy(id int);         alter table public.c_good_policy enable row level security;
create policy p_c on public.c_good_policy for select to service_role using (true);
create table public.d_no_rls(id int);
SQL
  R=$(psql "$U" -tAc "$SQL_DEBT" 2>/dev/null)
  DEBT=$(echo "$R" | cut -d'|' -f1); ZERO=$(echo "$R" | cut -d'|' -f2)
  RLSON=$(echo "$R" | cut -d'|' -f3); TOT=$(echo "$R" | cut -d'|' -f4)
  FAIL=0
  chk(){ if [ "$2" = "$3" ]; then printf '  🟢 %-52s %s\n' "$1" "$2"; else printf '  🔴 %-52s 實=%s 期望=%s\n' "$1" "$2" "$3"; FAIL=1; fi; }
  echo "── selftest(拋棄式 PG;四張表:無 policy / policy 給錯角色 / policy 給對 / 沒開 RLS)──"
  chk "缺 service_role SELECT policy(a + b)" "$DEBT"  2
  chk "🔴 一條 policy 都沒有(只有 a)"        "$ZERO"  1
  chk "🟢 正對照 開了 RLS 的表(a b c)"       "$RLSON" 3
  chk "🟢 正對照 表總數(a b c d)"            "$TOT"   4
  echo "  📌 而 a 與 b 的差別就是那個【45 vs 37】的形狀:b【有 policy 而不是 service_role 讀得到的】"
  L=$(list_debt_tables "$U" | tr '\n' ' ')
  case "$L" in *a_no_policy*b_wrong_policy*) printf '  🟢 %-52s %s\n' "名單列得出那兩張" "$L";;
    *) printf '  🔴 %-52s %s\n' "名單不對" "$L"; FAIL=1;; esac
  case "$L" in *c_good_policy*|*d_no_rls*) printf '  🔴 %-52s %s\n' "名單多列了不該列的" "$L"; FAIL=1;;
    *) printf '  🟢 %-52s\n' "🔵 負對照 c(有對的 policy)與 d(沒開 RLS)都不在名單裡";; esac
  [ "$FAIL" = 0 ] && { echo "── selftest 全過"; exit 0; } || { echo "── 🔴 selftest 有格沒過"; exit 1; }
fi

# ── 正式量測 ────────────────────────────────────────────────
# 🔴🔴 **`.env.local` 要從【主樹】找, 不是從 `cwd` 找**(⟦f3-ROKEYWORKTREE⟧, 2026-09-03 線 `-auth`)
#
#   ⛔ 舊寫法 ~~`[ -f .env.local ]` + `. ./.env.local`~~ 是**相對 `cwd`** 的。
#   🔴 而 `.env.local` **不被 git 追蹤 ⇒ 它只存在於主樹, 每一棵 worktree 都沒有**
#      (實測:主樹 `/Users/sean_1/pcm-website-v2/.env.local` 有 · worktree `pcm-wt-auth` 沒有)
#      ⇒ 📌 **一窗一棵樹之後, 施工窗跑本腳本【結構上】拿不到那把鑰匙。**
#
#   🎯 **而它為什麼值得一條規則**:那個 ENV-FAIL 訊息會讓人去**問人要憑證**,
#      而 Sean 2026-08-31 逐字答過「**你們已經有了!已經在 env.local 有帳號密碼**」
#      ⇒ ⇒ **一個死循環, 而兩端都是誠實的** —— 差的只是【那個檔在哪一棵樹】。
#
#   ✅ 修法:`git rev-parse --git-common-dir` —— 它從**任何一棵 worktree** 都回主樹的 `.git`,
#      從主樹自己跑則回主樹自己(兩個世界實測過)⇒ 它的父目錄就是主樹根。
#   🛑 **本腳本不複製任何 `.env` 檔、不印任何值** —— 只是換一個【去哪裡找】。
ENV_HERE="$(pwd)/.env.local"
ENV_MAIN=""
if GCD=$(git rev-parse --git-common-dir 2>/dev/null); then
  ENV_MAIN="$(cd "$GCD/.." 2>/dev/null && pwd)/.env.local"
fi
ENV_FILE=""
[ -f "$ENV_HERE" ] && ENV_FILE="$ENV_HERE"
[ -z "$ENV_FILE" ] && [ -n "$ENV_MAIN" ] && [ -f "$ENV_MAIN" ] && ENV_FILE="$ENV_MAIN"
[ -n "$ENV_FILE" ] || {
  echo "🔴 ENV-FAIL:找不到 .env.local ⇒ 這不是量測結果, 是跑不起來"
  echo "   找過的兩個位置(印出來, 免得【沒找到】與【找錯地方】長得一樣):"
  echo "     ① 這棵樹  $ENV_HERE"
  echo "     ② 主樹    ${ENV_MAIN:-(git rev-parse --git-common-dir 失敗 ⇒ 推不出主樹)}"
  exit 2; }
# 🔵 **印出【用了哪一個】** —— 否則「拿到鑰匙了」在兩棵樹上是同一句話。
echo "🔵 .env.local 來源:$ENV_FILE"
set -a; . "$ENV_FILE" >/dev/null 2>&1; set +a
[ -n "${PCM_READONLY_DATABASE_URL:-}" ] || {
  echo "🔴 ENV-FAIL:$ENV_FILE 裡沒有 PCM_READONLY_DATABASE_URL"
  echo "   ⇒ 那條唯讀連線 2026-09-01 由 Sean 開, 而不是每個窗都有。"
  echo "   ⇒ 📌 而【跑不起來】與【數字是 0】是兩件事 —— 本腳本用 exit 2 把它們分開。"
  echo "   ⇒ 🔵 而【檔找到了而變數不在裡面】與【檔根本找不到】也是兩件事 —— 上面那行印的是前者。"
  exit 2; }
R=$(psql "$PCM_READONLY_DATABASE_URL" -tAc "$SQL_DEBT" 2>&1) || { echo "🔴 ENV-FAIL:連不上正式庫 ⇒ $R"; exit 2; }
DEBT=$(echo "$R" | cut -d'|' -f1); ZERO=$(echo "$R" | cut -d'|' -f2)
RLSON=$(echo "$R" | cut -d'|' -f3); TOT=$(echo "$R" | cut -d'|' -f4)
ROLES=$(echo "$R" | cut -d'|' -f5); FORCE=$(echo "$R" | cut -d'|' -f6)

echo "══ RLS policy 債(正式庫,唯讀;量測時刻 $(date '+%Y-%m-%d %H:%M:%S %Z'))══"
echo "  🔴 $DEBT 張:開了 RLS 且【沒有 service_role 讀得到的 SELECT policy】"
echo "     (判準:relrowsecurity=true 且無 polcmd in ('r','*') 且 polroles 含 service_role 或 PUBLIC 的 policy)"
echo "  🔵 $ZERO 張:其中【一條 policy 都沒有】的 —— 它是上面那個數的子集"
echo "     📌 兩份稽核 2026-09-01 各報 45 與 37 而沒有人知道差在哪 ⇒ 就是這兩格"
echo "  🟢 對照:開了 RLS 的表 $RLSON / public 表總數 $TOT / relforcerowsecurity 開著的 $FORCE"
echo "  🔑 rolbypassrls:$ROLES"
case "$ROLES" in *service_role=t*) echo "     ⇒ 🔵 service_role 有 BYPASSRLS ⇒ 那 $DEBT 張【今天讀得到】⇒ 風險是未來式";;
  *) echo "     ⇒ 🔴🔴 service_role 【沒有】 BYPASSRLS ⇒ 那 $DEBT 張現在就在讀空的, 而且不報錯";; esac
echo
echo "  ── 名單 ──"; list_debt_tables "$PCM_READONLY_DATABASE_URL" | sed 's/^/    /'
echo
echo "  🛑 本工具的射程(每次都印, 因為一個訊號沒帶分母就是下一件事故):"
echo "     · 它是【盤點工具】不是【守門】—— 那條唯讀連線不是每個窗都有 ⇒ 刻意不掛 pre-commit / CI"
echo "     · 它答不出那幾張表【各自用哪一把鑰匙讀】"
echo "     · 走 SECURITY DEFINER RPC 讀的表【不需要】那條 policy(2026-09-01 實測)"
echo "       ⇒ 所以上面那個數是【要補的上界】, 不是要補的張數"
echo "     · 它讀的是正式庫【此刻】—— pg_policy 隨時可能被 dashboard 改"
exit 0
