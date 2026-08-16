#!/usr/bin/env bash
# ci-self-contained: no — 需要 postgrest binary,而 CI runner 沒有裝(#532 那步只掛 PostgreSQL server binaries)
# customer-list-select-probe.sh — 🔴 拿 **adapter 真正送出去的那串投影** 去打 **真的 view**
#
# 🔴🔴 **本 probe 目前【不在 CI 跑】,而那是我選的,不是忘了掛。**
#    它需要 `postgrest` binary,而 runner 上沒有(`#532` 那一步只把 PostgreSQL **server**
#    binaries 掛進 PATH)。⇒ 標 `yes` 的話 CI 會直接紅在 preflight。
#    **兩條路我都寫在這裡,讓下一個人選,而不是讓他重新發現這件事**:
#      ① CI 加一步裝 postgrest(動 CI = 鐵則 12④,要對抗審查;而我無法在本機驗 runner 上裝得起來)
#      ② 維持手動:**動 `ADMIN_CUSTOMER_LIST_SELECT` 或那支 view 的人自己跑一次**
#         `bash docs/probes/customer-list-select-probe.sh`
#    ⚠️ 現況是 ②。**所以這支的觸發是「有人記得」,而那正是 `#532` 要修掉的形狀** ——
#       誠實寫下來,不要讓它看起來已經被自動守著。
#
# ══ 為什麼一定要這一支 ═══════════════════════════════════════════════════════
#
# 客戶頁三欄的 `ADMIN_CUSTOMER_LIST_SELECT` 是一串**字串**,而它的真值在**資料庫**。
# 🔴 E 窗 2026-08-16 盤點指出:`ADMIN_ORDER_LIST_SELECT` 那格是 **TS↔TS 的 byte-equal**
#    —— 常數對照一份手寫期望值,**而資料庫沒有出現在那格裡**。
#    那正是 08-07 正式站 8 小時事故的形狀:應用層先於 DB 上線,而守門看不到。
# ⇒ **本 probe 是為了不複製那個形狀**:它把那串字面**送給一個真的 PostgREST**,
#   對一支**真的用 migration 建出來的 view** 查,看它 200 還是 400。
#
# ⚠️ **它守不住什麼**:
#   ① 這是**拋棄式叢集**,不是正式站 —— 證的是「這份 SQL 建出來的 view 吃得下這串投影」,
#      **不證「正式站上的那支 view 也吃得下」**(正式站還沒 apply)。
#   ② 不驗值對不對(那是 `admin-customer-list-view-probe.sh` 的事)。
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgcsel; PGPORT=55551; PRPORT=3993
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ADAPTER="$REPO/packages/adapters/src/supabase/SupabaseCustomerAdapter.ts"
MIG="$REPO/supabase/migrations/20260816030000_m4b_admin_customer_list_view.sql"

trap 'kill $PRPID 2>/dev/null || true; pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT INT TERM HUP
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
wait_pg () {
  for _ in $(seq 1 30); do
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "❌ Postgres 30 秒內沒起來"; tail -10 "$D/pg.log" || true; return 1
}
wait_pg
pq () { psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

pq -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT service_role TO authenticator; GRANT anon TO authenticator;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE member_tier AS ENUM ('general','store','premiumStore');
CREATE TABLE public.customers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE, name text NOT NULL DEFAULT '', phone text DEFAULT '',
  birthday date, tier member_tier NOT NULL DEFAULT 'general',
  wallet_balance integer NOT NULL DEFAULT 0, total_deposit integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES public.customers(user_id) ON DELETE CASCADE,
  total integer NOT NULL CHECK (total >= 0), cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX orders_customer_idx ON public.orders(customer_user_id);
SQL
# 🔴 **preflight:本 probe 是全 repo 唯一需要 `postgrest` binary 的腳本**
#    (code-reviewer 2026-08-16 must-fix)。CI 的 runner 沒有裝它,而**沒有這道 preflight 時
#    的症狀是:背景 job 127 → readiness 空轉 → curl 拿到 000 → 印「投影被 view 拒絕」**
#    ⇒ **缺件會偽裝成程式的缺陷**,而那正是本檔下面自己寫的那條教訓。
if ! command -v postgrest >/dev/null 2>&1; then
  echo "❌ 找不到 postgrest binary —— 本 probe 需要它才能對真 PostgREST 打投影。"
  echo "   本機:brew install postgrest"
  echo "   CI  :這一步要先裝 postgrest,或把本 probe 的認領標記改成 no 並寫明理由。"
  echo "   🔴 不要把這個當成「投影寫錯」——那是兩件事。"
  exit 1
fi
pq -q -f "$MIG"
# 🔴 **底表權限要自己補** —— view 是 `security_invoker = true`,以呼叫者身分讀底表,
#    而 Supabase 平台在正式庫【已經】給了 service_role 這些權限、本機沒有。
#    ⚠️ 第一版漏了這段 ⇒ 401 "permission denied for table customers",
#       而那看起來像「投影寫錯」。**環境缺的東西會偽裝成程式的缺陷。**
pq -q -c "GRANT USAGE ON SCHEMA public TO service_role;"
pq -q -c "GRANT SELECT ON public.customers, public.orders TO service_role;"

# 🔴 投影字串【從 adapter 原始碼抽出來】—— 手抄一份就會漂移,而漂移正是本 probe 要抓的東西
SEL=$(python3 - "$ADAPTER" <<'PY'
import re,sys
s=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r"export const ADMIN_CUSTOMER_LIST_SELECT\s*=\s*((?:\s*'[^']*'\s*\+?)+);", s)
assert m, "抽不到 ADMIN_CUSTOMER_LIST_SELECT —— 停,不要用手抄的字串跑"
print(''.join(re.findall(r"'([^']*)'", m.group(1))))
PY
)
[ -n "$SEL" ] || { echo "❌ 投影字串是空的"; exit 1; }
echo "  adapter 送出的投影:$SEL"

cat > "$D/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "service_role"
server-port = $PRPORT
CONF
postgrest "$D/pgrst.conf" > "$D/pgrst.log" 2>&1 &
PRPID=$!
for _ in $(seq 1 20); do curl -s "http://127.0.0.1:$PRPORT/" >/dev/null 2>&1 && break; sleep 1; done

ENC=$(printf '%s' "$SEL" | tr -d ' ')
echo "── 正向:adapter 的投影打真 view ──"
CODE=$(curl -s -o "$D/ok.json" -w '%{http_code}' "http://127.0.0.1:$PRPORT/admin_customer_list_v?select=$ENC&limit=1")
if [ "$CODE" != "200" ]; then
  echo "❌ 投影被 view 拒絕(HTTP $CODE)—— adapter 的 select 與 view 的欄位對不上:"
  cat "$D/ok.json"; exit 1
fi
echo "  ✅ HTTP 200"

echo "── 負向對照:故意加一個不存在的欄,必須 400(證這道檢查有判別力)──"
CODE2=$(curl -s -o "$D/bad.json" -w '%{http_code}' "http://127.0.0.1:$PRPORT/admin_customer_list_v?select=$ENC,__no_such_col&limit=1")
# 🔴 釘死 400,不是「任何非 200」(code-reviewer nit):404/500 也算過的話,
#    連線壞掉會被讀成「負向對照通過」。
if [ "$CODE2" != "400" ]; then
  echo "❌ 不存在的欄回 HTTP $CODE2(預期 400)—— 本檢查沒有判別力,上面那個 200 不算數"; exit 1
fi
echo "  ✅ HTTP $CODE2"

echo "── 🔴 白名單:wallet_balance / total_deposit 連 view 裡都不該有 ──"
for COL in wallet_balance total_deposit; do
  C=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PRPORT/admin_customer_list_v?select=$COL&limit=1")
  [ "$C" = "400" ] || { echo "❌ $COL 回 HTTP $C(預期 400)—— 它不該出現在這支 view 裡"; exit 1; }
  echo "  ✅ $COL → HTTP $C"
done
echo "✅ customer-list select probe 全過"
