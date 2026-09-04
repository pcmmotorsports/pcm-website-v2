#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 這一行是 CI 的【認領標記】,見 .github/workflows/ci.yml
# sibling-lookup-bank-pending-probe.sh — 匯款單那條路的【資料世界】驗證(M-4b 段 1 片 A + 片 B)
#   片 A = find_active_sibling_own 看得見未付款匯款單
#   片 B = begin_charge_attempt 在客人改用刷卡時把它取消
#   🔵 **片 B 用這支加格子, 不另起一套** —— 📌 一支被第二片用到的探針,
#      才證明它不是為了通過驗收而寫的。
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
  cancelled_reason text,
  -- 片 B 的取消會寫它(逾期那支同一行也寫)。
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- 片 B 的函式會讀它(取消守門);最小形狀。
CREATE TABLE public.order_cancellations (order_id uuid PRIMARY KEY);
CREATE TABLE public.payment_charge_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- 🔵 真表這一欄有 DEFAULT 'pending'(那支函式的 INSERT 不寫它)⇒ 最小形狀要跟著。
  status              text NOT NULL DEFAULT 'pending',
  -- 片 B 的 begin_charge_attempt 會投影這兩欄(needs_settle 帶給上層做 Record 反查鍵)。
  rec_trade_id        text,
  bank_transaction_id text,
  -- per-user 閘會用這兩欄(異單、10 分鐘窗)。
  customer_user_id    uuid,
  fallback_token_hash text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- 🔵 最小形狀:那道 ON CONFLICT 需要這個部分唯一索引才成立。
CREATE UNIQUE INDEX pca_one_active ON public.payment_charge_attempts (order_id)
  WHERE status IN ('pending', 'charged');
-- 🛑 **樁**:真的那支做雜湊, 而本探針量的不是雜湊。
--    ⇒ 📌 那也表示**本探針證不了 token 那條路**, 檔頭的天花板那一節涵蓋它。
CREATE FUNCTION public.charge_attempt_token_hash(t uuid) RETURNS text
  LANGUAGE sql IMMUTABLE AS \$stub\$ SELECT md5(t::text) \$stub\$;
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

# ── 片 B:同樣【從 migration 抽】begin_charge_attempt, 不抄一份 ────────────
MIGB="$REPO/supabase/migrations/20260904050000_m4b_supersede_bank_order_on_card.sql"
awk '/^CREATE OR REPLACE FUNCTION public\.begin_charge_attempt/,/^\$fn\$;/' "$MIGB" > "$D/fnb.sql"
LINESB=$(wc -l < "$D/fnb.sql" | tr -d ' ')
if [ "$LINESB" -lt 60 ]; then
  echo "X 片 B 函式只抽到 $LINESB 行, 抽取失敗 ⇒ 不是探針通過, 是探針壞了"; exit 1
fi
pq -q -f "$D/fnb.sql"
echo "  (抽出 $LINESB 行 begin_charge_attempt, 來源 = $(basename "$MIGB"))"

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

echo "== 片 B:begin_charge_attempt 改用刷卡時取消匯款單 =="

CARD='55555555-5555-4555-8555-555555555555'
begin_card () { q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'acquired';"; }
bank_cancelled () { q1 "SELECT (cancelled_at IS NOT NULL)::text FROM public.orders WHERE display_id='PCM-BANK-B';"; }
bank_reason () { q1 "SELECT COALESCE(cancelled_reason,'<null>') FROM public.orders WHERE display_id='PCM-BANK-B';"; }
seed_card () { pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${CARD}','${UID_FIXED}','${CART}','PCM-CARD-B','unpaid','tappay');"; }
seed_bank () { pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');"; }

# 格8:同車有未付款匯款單 ⇒ 刷卡拿得到鎖, 而那張匯款單被取消
reset_data; seed_card; seed_bank
check "格8 刷卡取得鎖" "true" "$(begin_card)"
check "格8b 匯款單被取消" "true" "$(bank_cancelled)"
check "格8c 取消原因分得出來" "superseded_by_card" "$(bank_reason)"

# 格9 🔴 不變量:匯款單【有 active attempt】⇒ 不可以被取消(放寬它 = 雙扣)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('66666666-6666-4666-8666-666666666666','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('66666666-6666-4666-8666-666666666666','pending');"
begin_card > /dev/null
check "格9 有 attempt 的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格10 正對照:同車有刷卡在途 ⇒ 仍然回 needs_settle(舊行為逐字不變)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('77777777-7777-4777-8777-777777777777','${UID_FIXED}','${CART}','PCM-CARD-C','unpaid','tappay');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('77777777-7777-4777-8777-777777777777','pending');"
check "格10 正對照 刷卡在途仍 needs_settle" "needs_settle" "$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")"

# 格11 正對照:同車什麼都沒有 ⇒ 刷卡照常拿到鎖
reset_data; seed_card
check "格11 正對照 乾淨車" "true" "$(begin_card)"

# ── 片 B 第二批:codex 關卡2 說「探針打不到那些風險」而它對 ──────────────
# 格12 🔴 released attempt:canonical 條件是 `status <> 'failed'`, 不是 IN('pending','charged')
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('88888888-8888-4888-8888-888888888888','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('88888888-8888-4888-8888-888888888888','released');"
begin_card > /dev/null
check "格12 帶 released attempt 的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格13 🟢 而 failed 是終態 ⇒ 帶 failed 的匯款單【可以】被取消(證明上一格不是「一律不取消」)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('99999999-9999-4999-8999-999999999999','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('99999999-9999-4999-8999-999999999999','failed');"
begin_card > /dev/null
check "格13 帶 failed 的匯款單可以被取消(尺不是一律不取消)" "true" "$(bank_cancelled)"

# 格14 🔴 早退路徑:目標單被別的 active attempt 佔住(order_locked)⇒ 匯款單【不可】被取消
reset_data; seed_card; seed_bank
pq -q -c "INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('${CARD}','pending');"
R=$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")
check "格14a 早退 = order_locked" "order_locked" "$R"
check "格14b 早退時匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格15 🔴 跨客人:別人的匯款單不可以被我取消
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('22222222-1111-4111-8111-111111111111','${CART}','PCM-BANK-B','unpaid','bank_transfer');"
begin_card > /dev/null
check "格15 別人的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格16 🔴 目標單本身是匯款單 ⇒ 不得開刷卡 attempt(not_card_order)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${CARD}','${UID_FIXED}','${CART}','PCM-BANK-TARGET','unpaid','bank_transfer');"
check "格16 目標單是匯款單 ⇒ not_card_order" "not_card_order" "$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")"

# 格17 🔵 多張:同車兩張未付款匯款單 ⇒ **兩張都被取消**(明寫這是刻意的, 不是只取消一張)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer'),
                 ('${UID_FIXED}','${CART}','PCM-BANK-B2','unpaid','bank_transfer');"
begin_card > /dev/null
check "格17 同車兩張匯款單都被取消" "2" "$(q1 "SELECT count(*)::text FROM public.orders WHERE display_id LIKE 'PCM-BANK-B%' AND cancelled_at IS NOT NULL;")"

if [ "$FAILED" -ne 0 ]; then echo "X 有格子紅了(見上)"; exit 1; fi
echo "OK 十七格全過"
