#!/usr/bin/env bash
# order-goods-axis-parity-probe.sh — 貨品軸 SQL 側對【共用真值表】的驗證(`#522`)
#
# 🔴 **不是「兩邊互比」** —— `#522` 正是兩邊【一起】用錯分母,互比會一致通過。
#    本 probe 拿 `apps/admin/src/lib/orders/goods-axis-cases.json` 的**人寫期望值**當第三方;
#    TS 那側由 `goods-axis-cases.test.ts` 讀**同一個檔**。
#    ⇒ 兩邊各自對同一份 oracle 比,而不是互相對照。
#
# 環境 = 拋棄式 Postgres(照 docs/runbooks/throwaway-postgres-for-migration-verification.md)。
# ⚠️ 效度邊界:造的 orders / order_items / summary 是**最小形狀**(只含本 view 用到的欄)。
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgaxis; PORT=55531
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CASES="$REPO/apps/admin/src/lib/orders/goods-axis-cases.json"

trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
sleep 3
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
pq -tAc "select 1" >/dev/null || { tail -6 "$D/pg.log"; exit 1; }

pq -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE TABLE public.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  quantity integer NOT NULL);
CREATE TABLE public.order_item_quantity_summary (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  ordered_quantity integer NOT NULL DEFAULT 0, instock_quantity integer NOT NULL DEFAULT 0,
  shipped_quantity integer NOT NULL DEFAULT 0, cancelled_quantity integer NOT NULL DEFAULT 0);
SQL

# 🔴 只抽 view 那一段 apply —— 整支 migration 的 DO 斷言要 orders 全欄,而本 probe 是最小形狀。
python3 - "$REPO/supabase/migrations/20260816050000_m4b_522_goods_axis_subtract_cancelled.sql" > "$D/view.sql" <<'PY'
import sys
lines=open(sys.argv[1],encoding='utf-8').read().split('\n')
start=next(i for i,l in enumerate(lines) if l.startswith('CREATE OR REPLACE VIEW'))
end=next(i for i,l in enumerate(lines) if i>start and l.strip()=='FROM public.orders o;')
print('\n'.join(lines[start:end+1]))
PY
test -s "$D/view.sql" || { echo "❌ 抽不到 view 定義"; exit 1; }
pq -q -f "$D/view.sql"

# 造資料 + 比對,全部由真值表驅動
python3 - "$CASES" > "$D/fixture.sql" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
out=[]
for i,c in enumerate(d['cases']):
    oid=f"'{i:08d}-0000-0000-0000-000000000000'::uuid"
    out.append(f"INSERT INTO public.orders(id) VALUES ({oid});")
    for j,l in enumerate(c['lines']):
        iid=f"'{i:08d}-0000-0000-0000-{j:012d}'::uuid"
        out.append(f"INSERT INTO public.order_items(id,order_id,quantity) VALUES ({iid},{oid},{l['quantity']});")
        out.append("INSERT INTO public.order_item_quantity_summary"
                   f"(order_item_id,ordered_quantity,instock_quantity,shipped_quantity,cancelled_quantity)"
                   f" VALUES ({iid},{l['ordered']},{l['instock']},{l['shipped']},{l['cancelled']});")
    out.append(f"INSERT INTO expected(order_id,expected,label) VALUES ({oid},'{c['expected']}',"
               f"$lbl${c['label']}$lbl$);")
print("CREATE TABLE expected(order_id uuid PRIMARY KEY, expected text, label text);")
print('\n'.join(out))
PY
pq -q -f "$D/fixture.sql"

echo "── 真值表比對(SQL 側)──"
TOTAL=$(pq -tAc "select count(*) from expected")
echo "  案例數:$TOTAL(前置檢查:非 0 才有判別力)"
[ "$TOTAL" -ge 10 ] || { echo "❌ 案例數 < 10,真值表沒讀進來"; exit 1; }
CANCELLED=$(pq -tAc "select count(distinct oi.order_id) from public.order_items oi join public.order_item_quantity_summary s on s.order_item_id=oi.id where s.cancelled_quantity>0")
echo "  含取消的案例數:$CANCELLED(這是 #522 的判別力來源,0 的話整份比對沒意義)"
[ "$CANCELLED" -ge 5 ] || { echo "❌ 含取消的案例太少"; exit 1; }

pq -tA -F '  ' -c "
  SELECT '❌ ' || e.label || ' | 期望 ' || e.expected || ' 實得 ' || v.goods_axis
    FROM expected e JOIN public.admin_order_list_v v ON v.id = e.order_id
   WHERE v.goods_axis IS DISTINCT FROM e.expected;" > "$D/mismatch.txt"

if [ -s "$D/mismatch.txt" ]; then
  echo "🔴 SQL 側與真值表不符:"
  cat "$D/mismatch.txt"
  exit 1
fi
echo "✅ SQL 側 $TOTAL 個案例全部符合真值表(其中 $CANCELLED 個含取消)"
