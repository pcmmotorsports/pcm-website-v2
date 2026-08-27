#!/usr/bin/env bash
# ci-self-contained: yes
# admin-customer-list-view-birthday-probe.sh
#
# 證人:20260826140000_m4b_admin_customer_list_view_birthday.sql 的 DO 區塊【有沒有判別力】。
#
# 🔴🔴 為什麼不是「跑一次 migration 看它綠不綠」——
#    上游 20260816030000 自己記著它第一版 harness 是【假綠】的, 逐字:
#      「拿『跑整支 migration』當突變載體 —— 而 REVOKE 在 DO 區塊【之前】
#        ⇒ 自己把突變清掉了再斷言 ⇒ **突變要打在被測的那一段上,
#        不是打在「包含被測那段的整個流程」上。**」
#    ⇒ 本檔把 migration 拆成【base】與【DO 區塊】兩半:
#      base 先跑一次建好世界 → 每一格突變只改被測的那個東西 → **只跑 DO 區塊**。
#
# 🔴 base 與 DO 區塊都是【從 migration 檔本身切出來的】, 不是抄一份 ——
#    抄一份會漂, 而漂了之後這支 probe 仍然全綠。
#
# 用法:bash docs/probes/admin-customer-list-view-birthday-probe.sh
# 環境:拋棄式 Postgres(docs/runbooks/throwaway-postgres-for-migration-verification.md)
set -uo pipefail

# 🔴 LC_ALL=C 不是裝飾:不設的話 macOS 上 postmaster 會
#    「became multithreaded during startup」而 FATAL —— 而 pg_ctl start 的 rc 是 1、
#    錯誤只出現在 log 檔裡, 外面看起來只是「連不上」。
#    (docs/runbooks/throwaway-postgres-for-migration-verification.md 記過的坑之一)
export LC_ALL=C
export LANG=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260826140000_m4b_admin_customer_list_view_birthday.sql"
[ -f "$MIG" ] || { echo "找不到 migration: $MIG"; exit 2; }

PORT="${PGPORT_PROBE:-55440}"
D="$(mktemp -d)"
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT

initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 40); do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && break
  sleep 0.25
done
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

# ── 切檔:base = DO 區塊【之前】的所有 SQL;DO 區塊單獨一份 ────────────────────
python3 - "$MIG" "$D" <<'PYEOF'
import io, sys, re
mig, d = sys.argv[1], sys.argv[2]
s = io.open(mig, encoding='utf-8').read()
i = s.index('DO $verify$')
j = s.index('$verify$;') + len('$verify$;')
io.open(d + '/base.sql', 'w', encoding='utf-8').write(s[:i])
io.open(d + '/verify.sql', 'w', encoding='utf-8').write(s[i:j])
print('base bytes=%d  verify bytes=%d' % (len(s[:i]), len(s[i:j])))
PYEOF

# ── 世界:最小 customers / orders + service_role ───────────────────────────────
pq >/dev/null <<'SQL'
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.customers (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, email text, phone text, tier text DEFAULT 'general',
  birthday date,
  wallet_balance integer NOT NULL DEFAULT 0,
  total_deposit  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES public.customers(user_id),
  total integer NOT NULL DEFAULT 0,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
SQL

# 🔴 nit 7:切法把 `$verify$;` **之後**的東西整段排除 ⇒ 日後補 SQL 或第二個 DO 區塊, 本檔照樣全綠。
#    ⇒ 這一格機械核:尾段不得有任何非註解、非空白行。
TAILN="$(python3 -c "
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
t=s[s.index('\$verify\$;')+len('\$verify\$;'):]
print(sum(1 for l in t.split(chr(10)) if l.strip() and not l.strip().startswith('--')))
" "$MIG")"
if [ "$TAILN" != "0" ]; then
  echo "  🔴 DO 區塊之後有 $TAILN 行非註解 SQL, 而本 probe 【不會跑到它們】⇒ 切法要改"
  FAIL=$((FAIL+1))
else
  echo "  ✅ 切法自檢:DO 區塊之後 0 行非註解 SQL(尾段沒有東西被漏掉)"
fi

pq -f "$D/base.sql" >/dev/null 2>"$D/base.err" || { echo "🔴 base 就跑不起來:"; cat "$D/base.err"; exit 1; }
cp "$D/base.sql" "$D/base.orig.sql"

PASS=0; FAIL=0
run_verify () { pq -f "$D/verify.sql" >"$D/out.txt" 2>&1; echo $?; }

# 🔴🔴 reset 一定要【先 DROP 再重建】, 不能只跑 base ——
#    base 用的是 CREATE OR REPLACE VIEW, 而它【不能刪欄、不能改欄型別】
#    ⇒ 前一格若加了一顆欄, reset 會【安靜地失敗】, 下一格就在髒世界裡跑。
#    (第一版就是這樣:N4 加了 wallet_balance 之後, N5/N6/N7 全都紅在 N4 的錯誤上
#     —— 四格全部 ✅, 而它們量的是同一件事。「一發紅多格」。)
reset () {
  pq -c "DROP VIEW IF EXISTS public.admin_customer_list_v;" >/dev/null 2>&1
  # 🔴🔴 索引也要先 DROP —— base 用的是 `CREATE INDEX IF NOT EXISTS`,
  #    而**同名但運算式錯的索引存在時, 它會安靜地跳過** ⇒ reset 之後世界仍然是髒的。
  #    📌 這一格是 codex 2026-08-26 指出的坑, 而它**在本檔自己身上現場發生過**:
  #      加了 N10(名字對而運算式少 ::smallint)之後, 收尾正對照 N9 紅了 ——
  #      而它紅的理由不是 N9 有問題, 是 N10 的髒東西還在。
  pq -c "DROP INDEX IF EXISTS public.customers_birth_month_idx;" >/dev/null 2>&1
  pq -c "DROP INDEX IF EXISTS public.customers_birthday_idx;" >/dev/null 2>&1
  pq -f "$D/base.orig.sql" >"$D/reset.err" 2>&1 || { echo "🔴 reset 失敗:"; cat "$D/reset.err"; exit 1; }
}

# 🔴🔴 mutate:突變【必須真的套上去】才算數。
#    第一版把突變的 stderr 丟進 /dev/null ⇒ Postgres 拒絕了(CREATE OR REPLACE 不能刪欄/改型別)
#    而外面看到的是「突變跑了、斷言綠」⇒ 讀起來像【守門瞎了】, 真相是【突變根本沒套上】。
#    ⇒ 這一格分得開才有意義:套不上 = 這一發作廢, 不是 guard 的問題。
mutate () {
  local name="$1"
  if ! pq -f "$D/mut.sql" >"$D/mut.err" 2>&1; then
    printf '  ⚠️  %-46s 【突變本身沒套上】⇒ 這一格作廢, 不是守門的問題\n' "$name"
    head -2 "$D/mut.err" | sed 's/^/       /'
    FAIL=$((FAIL+1)); return 1
  fi
  return 0
}

# check <green|red> <格名> [紅時必須命中的字串]
#
# 🔴🔴 **紅不夠, 要【紅在對的那一條】**(codex 2026-08-26 must-fix)。
#    只判 rc 非零的話:語法錯、物件不見、或**前面某一格污染世界導致別的斷言先炸**,
#    全部都會被算成「這一格擊中了」。
#    ⇒ 第三個參數 = 這一格【預期的錯誤字串】。對不上 ⇒ 判 FAIL 並印出實際錯誤。
#    📌 這一條與本檔第一版的兩個病是同一族:**紅的理由要是我打的那個東西。**
check () {
  local expect="$1" name="$2" want="${3:-}"
  local rc; rc="$(run_verify)"
  local err; err="$(grep -o 'ERROR:.*' "$D/out.txt" | head -1)"
  if [ "$expect" = green ] && [ "$rc" = 0 ]; then
    printf '  ✅ %-44s 應綠 → 綠\n' "$name"; PASS=$((PASS+1))
  elif [ "$expect" = green ]; then
    printf '  🔴 %-44s 應綠 → rc=%s\n' "$name" "$rc"
    head -3 "$D/out.txt" | sed 's/^/       /'; FAIL=$((FAIL+1))
  elif [ "$rc" = 0 ]; then
    printf '  🔴 %-44s 應紅 → 綠 【這一格沒有判別力】\n' "$name"; FAIL=$((FAIL+1))
  elif [ -n "$want" ] && ! printf '%s' "$err" | grep -q -- "$want"; then
    printf '  🔴 %-44s 紅了, 而【紅錯地方】\n     想要: %s\n     實際: %s\n' \
      "$name" "$want" "$(printf '%s' "$err" | cut -c1-90)"
    FAIL=$((FAIL+1))
  else
    printf '  ✅ %-44s 應紅 → 紅 (%s)\n' "$name" "$(printf '%s' "$err" | cut -c8-60)"
    PASS=$((PASS+1))
  fi
}

echo "── 證人:每一格突變【只打被測的那一段】, 之後【只跑 DO 區塊】 ──"

check green "N0 乾淨"

# N1 少一顆欄 —— 🔴 必須 DROP+CREATE:CREATE OR REPLACE 不能刪欄, 會安靜地失敗
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 (SELECT count(*) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
 (SELECT coalesce(sum(o.total),0) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
 (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
 c.birthday AS birthday
FROM public.customers c;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
SQL
mutate "N1 view 少加 birth_month" && check red "N1 view 少加 birth_month" "欄名或順序不符白名單"; reset

# N2 兩顆新欄順序對調(證 ④ 釘的是順序不只是集合)
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 (SELECT count(*) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
 (SELECT coalesce(sum(o.total),0) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
 (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
 extract(month from c.birthday)::smallint AS birth_month,
 c.birthday AS birthday
FROM public.customers c;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
SQL
mutate "N2 兩欄順序對調" && check red "N2 兩顆新欄順序對調" "欄名或順序不符白名單"; reset

# N3 birth_month 留 numeric —— 🔴 同樣要 DROP+CREATE:CREATE OR REPLACE 不能改欄型別
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 (SELECT count(*) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
 (SELECT coalesce(sum(o.total),0) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
 (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
 c.birthday AS birthday,
 extract(month from c.birthday) AS birth_month
FROM public.customers c;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
SQL
mutate "N3 birth_month 留 numeric" && check red "N3 birth_month 留 numeric 不轉 smallint" "兩顆新欄的型別不對"; reset

# N4 🔴 這一格證「放寬的只有欄名清單, 第③條沒鬆」
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 (SELECT count(*) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
 (SELECT coalesce(sum(o.total),0) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
 (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
 c.birthday AS birthday,
 extract(month from c.birthday)::smallint AS birth_month,
 c.wallet_balance AS wallet_balance
FROM public.customers c;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
SQL
mutate "N4 加回 wallet_balance" && check red "N4 加回 wallet_balance(證第③條沒被一起鬆)" "定義裡出現 wallet_balance"; reset

# N5 表層 GRANT anon
echo 'GRANT SELECT ON public.admin_customer_list_v TO anon;' > "$D/mut.sql"
mutate "N5 表層 GRANT anon" && check red "N5 表層 GRANT anon" "表層授權除了 owner"; reset
pq >/dev/null 2>&1 -c "REVOKE ALL ON public.admin_customer_list_v FROM anon;"

# N6 欄位層 GRANT
echo 'GRANT SELECT (birthday) ON public.admin_customer_list_v TO authenticated;' > "$D/mut.sql"
mutate "N6 欄位層 GRANT" && check red "N6 欄位層 GRANT (birthday) authenticated" "欄位層"; reset
pq >/dev/null 2>&1 -c "REVOKE ALL (birthday) ON public.admin_customer_list_v FROM authenticated;"

# N7 兩支索引各打一次(要報得出是哪一支)
echo 'DROP INDEX public.customers_birth_month_idx;' > "$D/mut.sql"
mutate "N7a DROP birth_month_idx" && check red "N7a DROP customers_birth_month_idx" "customers_birth_month_idx"; reset
echo 'DROP INDEX public.customers_birthday_idx;' > "$D/mut.sql"
mutate "N7b DROP birthday_idx" && check red "N7b DROP customers_birthday_idx" "customers_birthday_idx"; reset

# N8 LEFT JOIN
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 count(o.id) AS active_order_count, coalesce(sum(o.total),0) AS active_spend_total,
 max(o.created_at) AS last_active_ordered_at, c.birthday,
 extract(month from c.birthday)::smallint AS birth_month
FROM public.customers c LEFT JOIN public.orders o ON o.customer_user_id=c.user_id
GROUP BY c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,c.birthday;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
SQL
mutate "N8a LEFT JOIN + GROUP BY" && check red "N8a LEFT JOIN + GROUP BY" "定義裡出現 GROUP BY"; reset

# 🔴 N8b:**只加 JOIN、不加 GROUP BY**(codex must-fix)
#    N8a 兩個關鍵字一起下 ⇒ 就算 JOIN 那道守門瞎了, GROUP BY 那道也會擋 ⇒ **那一格證不了 JOIN。**
#    ⇒ 這一格把 JOIN 單獨拉出來打。
cat > "$D/mut.sql" <<'SQL'
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v WITH (security_invoker = true) AS
SELECT c.user_id,c.name,c.email,c.phone,c.tier,c.created_at,
 (SELECT count(*) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
 (SELECT coalesce(sum(o.total),0) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
 (SELECT max(o.created_at) FROM public.orders o WHERE o.customer_user_id=c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
 c.birthday AS birthday,
 extract(month from c.birthday)::smallint AS birth_month
FROM public.customers c LEFT JOIN public.orders x ON x.customer_user_id = c.user_id AND false;
SQL
mutate "N8b 只加 JOIN 不加 GROUP BY" && check red "N8b 只加 JOIN 不加 GROUP BY" "GROUP BY / DISTINCT / JOIN"; reset

# 🔴 N10:索引【名字對而運算式錯】—— 少一個 ::smallint
#    這一格是 codex 抓到的:CREATE INDEX IF NOT EXISTS 遇到同名索引會【安靜跳過】,
#    而只查名字的斷言會全綠 —— 而那支索引【對不上查詢, 永遠是 Seq Scan】。
#    📌 量到的:無 cast ⇒ Seq Scan;有 cast ⇒ Bitmap Index Scan(50,000 列, ANALYZE 過)。
cat > "$D/mut.sql" <<'SQL'
DROP INDEX public.customers_birth_month_idx;
CREATE INDEX customers_birth_month_idx ON public.customers ((extract(month from birthday)));
SQL
mutate "N10 索引名字對而運算式少 ::smallint" \
  && check red "N10 索引運算式少 ::smallint(名字對)" "的【定義】不符"; reset

check green "N9 全部還原後(收尾正對照)"

# ── 值的正確性:四個邊界 ──────────────────────────────────────────────────────
echo "── 值:birth_month 的四個邊界(這一段 DO 區塊【不驗】, 所以在這裡驗)──"
pq >/dev/null 2>&1 <<'SQL'
INSERT INTO public.customers (name, birthday) VALUES
  ('一月底', '1990-01-31'), ('十二月底', '1990-12-31'),
  ('閏日',   '1992-02-29'), ('沒填生日', NULL);
SQL
VAL="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
  "select name||'='||coalesce(birth_month::text,'NULL') from public.admin_customer_list_v order by name" 2>&1)"
EXPECT='一月底=1
十二月底=12
沒填生日=NULL
閏日=2'
if [ "$VAL" = "$EXPECT" ]; then
  printf '  ✅ %-46s 四格全中\n' "值:1/31→1 · 12/31→12 · 2/29→2 · NULL→NULL"; PASS=$((PASS+1))
else
  printf '  🔴 %-46s\n     實際: %s\n     預期: %s\n' "值:四個邊界" "$(echo "$VAL"|tr '\n' ' ')" "$(echo "$EXPECT"|tr '\n' ' ')"
  FAIL=$((FAIL+1))
fi
# 🔴 負對照 —— 第一版是「餵一個假字串比對」, 而**那天然不可能相等 ⇒ 它什麼都沒證明**
#    (codex 2026-08-26 nit)。改成真的動產品那一側:把一筆生日換月份, 那條查詢必須跟著變。
pq >/dev/null 2>&1 -c "UPDATE public.customers SET birthday = '1990-07-31' WHERE name = '一月底';"
VAL2="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
  "select coalesce(birth_month::text,'NULL') from public.admin_customer_list_v where name='一月底'" 2>&1)"
if [ "$VAL2" = "7" ]; then
  printf '  ✅ %-44s 改 1/31→7/31 後那一格從 1 變 7\n' "負對照:動產品側, 量具跟著動"; PASS=$((PASS+1))
else
  printf '  🔴 %-44s 改了生日而 birth_month 沒跟著變(實際 %s)⇒ 上面那格是恆真的\n' "負對照" "$VAL2"
  FAIL=$((FAIL+1))
fi
pq >/dev/null 2>&1 -c "UPDATE public.customers SET birthday = '1990-01-31' WHERE name = '一月底';"

# ══ 索引真的被用到嗎 —— must-fix 5:那組 EXPLAIN 要有人能重跑 ═══════════════
echo "── 索引:EXPLAIN 兩個世界(must-fix 5 —— 上一版那組數字沒有重跑法)──"
pq >/dev/null 2>&1 <<'SQL'
INSERT INTO public.customers (name, birthday)
  SELECT 'bulk'||g, ('1970-01-01'::date + (g % 20000)) FROM generate_series(1,50000) g;
ANALYZE public.customers;
SQL
PLAN_CAST="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
  "EXPLAIN SELECT * FROM public.admin_customer_list_v WHERE birth_month = 5" 2>&1 | head -3 | tr '\n' ' ')"
pq >/dev/null 2>&1 <<'SQL'
DROP INDEX public.customers_birth_month_idx;
CREATE INDEX customers_birth_month_idx ON public.customers ((extract(month from birthday)));
ANALYZE public.customers;
SQL
PLAN_NOCAST="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
  "EXPLAIN SELECT * FROM public.admin_customer_list_v WHERE birth_month = 5" 2>&1 | head -3 | tr '\n' ' ')"
reset
if printf '%s' "$PLAN_CAST" | grep -q 'Index Scan' && ! printf '%s' "$PLAN_NOCAST" | grep -q 'Index Scan'; then
  printf '  ✅ %-44s 有 cast ⇒ Index Scan · 無 cast ⇒ 沒有\n' "索引:::smallint 是必要的(50,000 列)"
  PASS=$((PASS+1))
else
  printf '  🔴 %-44s\n     有cast: %s\n     無cast: %s\n' "索引:EXPLAIN 兩個世界沒有分別" \
    "$(printf '%s' "$PLAN_CAST"|cut -c1-70)" "$(printf '%s' "$PLAN_NOCAST"|cut -c1-70)"
  FAIL=$((FAIL+1))
fi

# ══ ROLLBACK 實跑 —— must-fix 1:上一版的 §7 貼下去是無聲 no-op ════════════════
echo "── ROLLBACK:從本檔切出來實跑, 不是用讀的 ──"
python3 - "$MIG" "$D" <<'PYEOF2'
import io,sys
mig,d=sys.argv[1],sys.argv[2]
s=io.open(mig,encoding='utf-8').read()
i=s.index('\n-- BEGIN;'); j=s.index('\n-- COMMIT;')+len('\n-- COMMIT;')
body='\n'.join(l[3:] if l.startswith('-- ') else l for l in s[i:j].split('\n'))
io.open(d+'/rollback.sql','w',encoding='utf-8').write(body)
PYEOF2
if pq -f "$D/rollback.sql" > "$D/rb.log" 2>&1; then
  RCOLS="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='admin_customer_list_v'")"
  RIDX="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select count(*) from pg_class where relname in ('customers_birthday_idx','customers_birth_month_idx') and relkind='i'")"
  RCMT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select count(*) from pg_description d join pg_attribute a on a.attrelid=d.objoid and a.attnum=d.objsubid where d.objoid='public.admin_customer_list_v'::regclass and d.objsubid>0")"
  WANT='user_id,name,email,phone,tier,created_at,active_order_count,active_spend_total,last_active_ordered_at'
  if [ "$RCOLS" = "$WANT" ] && [ "$RIDX" = "0" ] && [ "$RCMT" = "3" ]; then
    printf '  ✅ %-44s 9 欄 · 0 索引 · 3 則欄位 COMMENT\n' "rollback 實跑:真的退回去了"; PASS=$((PASS+1))
  else
    printf '  🔴 %-44s 欄=%s 索引=%s COMMENT=%s\n' "rollback 跑了而【沒有真的退回去】" "$RCOLS" "$RIDX" "$RCMT"
    FAIL=$((FAIL+1))
  fi
else
  printf '  🔴 %-44s\n' "rollback 跑不起來"; head -3 "$D/rb.log" | sed 's/^/       /'; FAIL=$((FAIL+1))
fi

echo
echo "── 結果:PASS=$PASS  FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] || exit 1
