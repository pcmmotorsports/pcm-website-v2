#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 這一行是 CI 的【認領標記】,見 .github/workflows/ci.yml
# sibling-lookup-bank-pending-probe.sh — find_active_sibling_own 的【資料世界】驗證(M-4b 段 1 片 A)
#
# 🔴🔴 **這支探針存在的理由是量到的, 不是預防性的**:
#   片 A 的三支 TS 測試**都直接 mock `bank_pending`** ⇒ 它們**結構上到不了 SQL**。
#   而 codex 關卡2 在同一輪抓到兩個 SQL bug, 兩個都會【放行一張刷卡單】:
#     ① `payment_status <> 'paid'` 收進四個值(unpaid/partiallyPaid/refunded/partiallyRefunded)
#        ⇒ 一張**已部分收款**的匯款單會被判成 bank_pending
#     ② `ORDER BY … DESC` 預設 **NULLS FIRST** ⇒ 匯款單(a.status 為 NULL)**排在 charged 之前**
#        ⇒ 客人同時有刷卡在途與未匯款單時, 匯款那張會贏 ⇒ 繞過 settle 那道裁決
#   📌 **⇒ 那兩個是【剛好有人在場】抓到的, 不是我們的閘抓到的。這支探針把它變成閘。**
#
# 🔴 **本檔【不抄一份函式】, 它從 migration 檔裡把那支函式抽出來跑** ——
#    抄一份會分岔, 而分岔的那天沒有東西會叫。
#
# 天花板/範圍:只驗這支函式在**最小形狀**的資料上算得對。
#   結構不變式與 ACL 歸 migration 的事後斷言, 不在這裡。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「最小形狀下不出現、真表上才有的欄位互動」。
# 天花板/量具:本機 PG **不是 Supabase** —— `auth.uid()` 在這裡是我造的樁、RLS 預設授權不同、
#   PostgREST 的名稱解析完全不在這個世界裡 ⇒ **它證不了那條網路路徑通不通。**
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgprobe-siblingbank
PORT=55521
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260904040000_m4b_sibling_lookup_sees_bank_orders.sql"

trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
wait_pg () {
  local i
  for i in $(seq 1 30); do
    psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "X Postgres 30 秒內沒起來。pg.log 最後 10 行:"; tail -10 "$D/pg.log" 2>&1 || true; return 1
}
wait_pg
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
q1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "$1"; }

# ── bootstrap(Supabase 平台給的東西, 本機沒有)────────────────────────────
UID_FIXED='11111111-1111-4111-8111-111111111111'
pq -q <<SQL
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
-- auth.uid() 樁:本機沒有 JWT。**這正是本探針量不到的那一層**, 檔頭已標。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT '${UID_FIXED}'::uuid \$\$;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL,
  cart_session_id  uuid,
  display_id       text NOT NULL,
  payment_status   public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_channel  text NOT NULL DEFAULT 'tappay',
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_charge_attempts (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status   text NOT NULL
);
SQL

# ── 把那支函式從 migration 檔裡抽出來(不抄一份)───────────────────────────
awk '/^CREATE OR REPLACE FUNCTION public\.find_active_sibling_own/,/^\$fn\$;/' "$MIG" > "$D/fn.sql"
LINES=$(wc -l < "$D/fn.sql" | tr -d ' ')
if [ "$LINES" -lt 40 ]; then
  echo "X 從 migration 抽出來的函式只有 $LINES 行, 抽取失敗(anchor 沒命中?)⇒ 不是探針通過, 是探針壞了"
  exit 1
fi
pq -q -f "$D/fn.sql"
echo "  (抽出 $LINES 行函式定義, 來源 = $(basename "$MIG"))"

CART='22222222-2222-4222-8222-222222222222'
reset_data () { pq -q -c "TRUNCATE public.payment_charge_attempts, public.orders CASCADE;"; }
kind_of () { q1 "SELECT public.find_active_sibling_own('${CART}'::uuid) ->> 'kind';"; }
FAILED=0
check () { # $1=格名 $2=期望 $3=實得
  if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"
  else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=1; fi
}

echo "== find_active_sibling_own 資料世界 =="

# 格1:未付款匯款單, 零 attempt ⇒ bank_pending(本片新增的那條路)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-1','unpaid','bank_transfer');"
check "格1 未付款匯款單" "bank_pending" "$(kind_of)"

# 格2 🔴 殺 bug①:**已部分收款**的匯款單, 零 attempt ⇒ 絕不可以是 bank_pending
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-2','partiallyPaid','bank_transfer');"
K=$(kind_of)
if [ "$K" = "bank_pending" ]; then
  printf '  FAIL 格2 已部分收款的匯款單被判成 bank_pending(= bug①)⇒ 它會放行一張刷卡單\n'; FAILED=1
else
  printf '  OK   格2 已部分收款的匯款單 ⇒ %s(不是 bank_pending)\n' "$K"
fi

# 格3 🔴 殺 bug②:同一車【刷卡在途】+【未付款匯款單】⇒ 必須是 active(刷卡那張優先裁決)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel, created_at)
          VALUES ('33333333-3333-4333-8333-333333333333','${UID_FIXED}','${CART}','PCM-CARD-1','unpaid','tappay', now() - interval '1 hour');
          INSERT INTO public.payment_charge_attempts (order_id, status)
          VALUES ('33333333-3333-4333-8333-333333333333','charged');
          INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel, created_at)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-3','unpaid','bank_transfer', now());"
check "格3 刷卡在途 + 未匯款單 同車" "active" "$(kind_of)"

# 格4 正對照:只有刷卡在途 ⇒ active(舊行為逐字不變)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('44444444-4444-4444-8444-444444444444','${UID_FIXED}','${CART}','PCM-CARD-2','unpaid','tappay');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('44444444-4444-4444-8444-444444444444','pending');"
check "格4 正對照 只有刷卡在途" "active" "$(kind_of)"

# 格5 正對照:已付款 ⇒ paid(不論管道)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-PAID-1','paid','bank_transfer');"
check "格5 正對照 已付款匯款單" "paid" "$(kind_of)"

# 格6 負對照:什麼都沒有 ⇒ none(證明尺不亂報)
reset_data
check "格6 負對照 空的" "none" "$(kind_of)"

# 格7 負對照:已取消的匯款單 ⇒ none(cancelled_at 那道守門還在)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel, cancelled_at)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-4','unpaid','bank_transfer', now());"
check "格7 負對照 已取消的匯款單" "none" "$(kind_of)"

if [ "$FAILED" -ne 0 ]; then echo "X 有格子紅了(見上)"; exit 1; fi
echo "OK 七格全過"
