#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 這一行是 CI 的【認領標記】,見 .github/workflows/ci.yml
# admin-customer-list-view-probe.sh — `admin_customer_list_v` 的【值】正確性驗證(可重跑、零花費)
#
# 為什麼在這裡而不在 migration 裡:值斷言要造 fixture,而 migration **正式 apply 時也會跑**
# ⇒ 會污染正式資料。migration 只放結構不變式,值放這裡。(codex 2026-08-16 關卡1 must-fix)
#
# 環境 = 拋棄式 Postgres(照 docs/runbooks/throwaway-postgres-for-migration-verification.md)。
# 🔴 **效度邊界**:本 probe 造的 `orders` 是**最小形狀**(只含本 view 用到的欄,逐字取自 repo),
#    不是正式庫的完整 orders ⇒ 它證的是「這支 view 的算法對」,**不證「在正式庫跑起來一樣」**。
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgprobe-cust
PORT=55507
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260816030000_m4b_admin_customer_list_view.sql"

trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
# 🔴 先把上一次殘留的 server 停掉再 rm —— 直接 rm 會把一個【還活著】的 server 的 data dir 抽掉
#    (它不會馬上死,而是開始噴詭異錯誤)。code-reviewer 2026-08-16 nit。
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
# 🔴 **不用固定 `sleep`** —— runner 負載高時三秒不夠,那會變成**假紅**,
#    而假紅比沒有守門更糟:它會訓練大家忽略這個紅。改成有上限的輪詢。
wait_pg () {
  local i
  for i in $(seq 1 30); do
    psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "❌ Postgres 30 秒內沒起來。pg.log 最後 10 行:"
  tail -10 "$D/pg.log" 2>&1 || true
  return 1
}
wait_pg
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

# ── bootstrap(Supabase 平台給的東西,本機沒有)──────────────────────────────
pq -q <<'SQL'
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE member_tier AS ENUM ('general','store','premiumStore');
SQL

# customers:逐字取自 20260523034911_init_customers_and_subtables.sql:14-25
pq -q <<'SQL'
CREATE TABLE public.customers (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL DEFAULT '',
  phone           text DEFAULT '',
  birthday        date,
  tier            member_tier NOT NULL DEFAULT 'general',
  wallet_balance  integer NOT NULL DEFAULT 0,
  total_deposit   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- orders:最小形狀。total 取自 20260604120000_...:104;cancelled_at 取自 20260712203000_...:56
CREATE TABLE public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES public.customers(user_id) ON DELETE CASCADE,
  total            integer NOT NULL CHECK (total >= 0),
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON public.orders(customer_user_id);
SQL

# ── apply 待驗的 migration(§6 的結構斷言會在這一步自己跑)────────────────────
echo "── apply migration ──"
pq -f "$MIG"

# ── fixture:三個客人,涵蓋零訂單 / 有取消單 / 全取消 ─────────────────────────
pq -q <<'SQL'
INSERT INTO auth.users(id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
INSERT INTO public.customers(user_id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111','zero@t.test','零訂單'),
  ('22222222-2222-2222-2222-222222222222','mixed@t.test','有取消單'),
  ('33333333-3333-3333-3333-333333333333','allcancel@t.test','全部取消');
-- 客人2:兩筆有效(1000 + 500)+ 一筆取消(9999,而且是【最新的】)
INSERT INTO public.orders(customer_user_id,total,cancelled_at,created_at) VALUES
  ('22222222-2222-2222-2222-222222222222',1000,NULL,'2026-01-01'),
  ('22222222-2222-2222-2222-222222222222', 500,NULL,'2026-02-01'),
  ('22222222-2222-2222-2222-222222222222',9999,'2026-08-16','2026-08-15');
-- 客人3:只有一筆取消單
INSERT INTO public.orders(customer_user_id,total,cancelled_at,created_at) VALUES
  ('33333333-3333-3333-3333-333333333333',7777,'2026-08-16','2026-08-10');
SQL

echo "── 值斷言 ──"
pq -v ON_ERROR_STOP=1 <<'SQL'
DO $p$
DECLARE r record;
BEGIN
  -- ① 零訂單:count=0 / sum=0 / max=NULL(🔴 NULL 是刻意的)
  SELECT * INTO r FROM public.admin_customer_list_v WHERE email='zero@t.test';
  IF r.active_order_count <> 0 OR r.active_spend_total <> 0 OR r.last_active_ordered_at IS NOT NULL THEN
    RAISE EXCEPTION '① 零訂單錯:count=% sum=% last=%', r.active_order_count, r.active_spend_total, r.last_active_ordered_at;
  END IF;

  -- ② 🔴 負向對照(本 probe 的核心):取消單【一欄都不准影響】
  --    那筆取消單 total=9999 且 created_at 是最新的 ⇒ 沒排除的話 sum 會是 10499、last 會是 08-15。
  SELECT * INTO r FROM public.admin_customer_list_v WHERE email='mixed@t.test';
  IF r.active_order_count <> 2 THEN RAISE EXCEPTION '② count 應為 2(取消單不算),實 %', r.active_order_count; END IF;
  IF r.active_spend_total <> 1500 THEN RAISE EXCEPTION '② sum 應為 1500,實 %(=10499 表示取消單被算進去了)', r.active_spend_total; END IF;
  IF r.last_active_ordered_at <> '2026-02-01'::timestamptz THEN
    RAISE EXCEPTION '② last 應為 2026-02-01,實 %(=2026-08-15 表示取消單被算進去了)', r.last_active_ordered_at;
  END IF;

  -- ③ 全部取消 ⇒ 與零訂單同形
  SELECT * INTO r FROM public.admin_customer_list_v WHERE email='allcancel@t.test';
  IF r.active_order_count <> 0 OR r.active_spend_total <> 0 OR r.last_active_ordered_at IS NOT NULL THEN
    RAISE EXCEPTION '③ 全取消錯:count=% sum=% last=%', r.active_order_count, r.active_spend_total, r.last_active_ordered_at;
  END IF;

  -- ④ 正向對照:證這三格真的在讀資料(全空的 view 會讓上面每一條恆真)
  IF (SELECT count(*) FROM public.admin_customer_list_v) <> 3 THEN
    RAISE EXCEPTION '④ view 應有 3 列,實 % —— 上面的斷言沒有判別力', (SELECT count(*) FROM public.admin_customer_list_v);
  END IF;

  RAISE NOTICE '✅ 值斷言四條全過(含取消單負向對照)';
END $p$;
SQL

# ══ 規模量測(§8 那組 4.17 / 4.41 就是這裡出來的)══════════════════════════════
# 🔴 **這一段以前只活在我的 shell 裡** —— §8 標「可重跑」而產生器沒出貨,
#    等於那組否決 codex 索引 must-fix 的數字沒有人能重跑。(code-reviewer 2026-08-16 must-fix)
# 用法:PROBE_SCALE=1 bash docs/probes/admin-customer-list-view-probe.sh
if [ "${PROBE_SCALE:-0}" = "1" ]; then
  echo "── 規模量測:20,000 客戶 / 100,000 訂單 / 10% 取消率 ──"
  pq -q <<'SQL'
INSERT INTO auth.users(id) SELECT gen_random_uuid() FROM generate_series(1,20000);
INSERT INTO public.customers(user_id, email, created_at)
  SELECT u.id, 'scale'||row_number() over ()||'@t.test', now() - (row_number() over ()||' minutes')::interval
    FROM auth.users u WHERE u.id NOT IN (SELECT user_id FROM public.customers);
INSERT INTO public.orders(customer_user_id, total, cancelled_at, created_at)
  SELECT c.user_id, (random()*5000)::int,
         CASE WHEN random() < 0.1 THEN now() ELSE NULL END,
         now() - ((random()*400)||' days')::interval
    FROM public.customers c, generate_series(1,5)
   WHERE c.email LIKE 'scale%';
ANALYZE;
SQL
  pq -tAc "select '客戶 '||(select count(*) from customers)||' / 訂單 '||(select count(*) from orders)"
  echo "  A. 只有既有 orders_customer_idx(分頁路徑 = 後台真正走的路):"
  pq -tAc "EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM admin_customer_list_v ORDER BY created_at DESC LIMIT 20" | grep "Execution Time"
  pq -q -c "CREATE INDEX ord_active_cov ON public.orders(customer_user_id, created_at DESC) INCLUDE (total) WHERE cancelled_at IS NULL; ANALYZE;"
  echo "  B. 再加 codex 建議的 partial covering index:"
  pq -tAc "EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM admin_customer_list_v ORDER BY created_at DESC LIMIT 20" | grep "Execution Time"
  echo "  C. 全表掃(不分頁,最壞情況):"
  pq -tAc "EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*), sum(active_spend_total) FROM admin_customer_list_v" | grep "Execution Time"
  echo "  🔴 判讀:A 與 B 的差距在雜訊等級 ⇒【沒有可觀測的改善】,不是「加了更慢」。"
  pq -q -c "DROP INDEX ord_active_cov;"
fi

echo "── EXPLAIN(小資料,只證查詢計畫形狀;規模數字看上面 PROBE_SCALE=1)──"
pq -c "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM public.admin_customer_list_v ORDER BY created_at DESC LIMIT 20;"
echo "✅ probe 全過"
