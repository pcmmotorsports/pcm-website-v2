#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# manual-no-email-off-scan-surface-probe.sh
#   ⟦f3-MAILFALLBACKVSRULING⟧ 片 C-2 探針:拋棄式 PG,雙向。
#
# 🛑🛑 **它【證不到】什麼(先讀這段)**:
#   · 它驗的是**三支 view 的收錄行為**,不驗「信真的沒寄出去」(那要真跑)。
#   · fixture 是**最小可跑**的世界(不是正式庫的 schema)⇒ 它答得出「述詞篩對了嗎」,
#     答不出「正式庫那些欄位的實際內容會不會讓它篩錯」。
#   · 🔴 它**不驗** `unpaid_cancelled`(本片刻意不動那一支,見 migration 檔頭)。
set -u
export LC_ALL=C LANG=C
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="${1:-$REPO_ROOT/supabase/migrations/20260905210000_m4b_manual_no_email_off_scan_surface.sql}"
test -f "$MIG" || { echo "🔴 找不到受測 migration:$MIG"; exit 1; }
BASE="$REPO_ROOT/supabase/migrations/20260905080000_m4b_pending_views_order_source.sql"
test -f "$BASE" || { echo "🔴 找不到前一版 view 的 migration:$BASE"; exit 1; }

pick() {
  if command -v "$1" > /dev/null 2>&1; then printf '%s' "$1"
  elif [ -x "/opt/homebrew/bin/$1" ]; then printf '%s' "/opt/homebrew/bin/$1"
  else echo "🔴 找不到 $1 ⇒ 沒有跑, 不是通過" >&2; exit 1
  fi
}
INITDB=$(pick initdb) || exit 1
PG_CTL=$(pick pg_ctl) || exit 1
PSQL=$(pick psql)     || exit 1

D=$(mktemp -d); P="${PGPORT_PROBE:-54351}"
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
cleanup() { [ -d "$D/pg" ] && "$PG_CTL" -D "$D/pg" -w stop > /dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT INT TERM

"$INITDB" -D "$D/pg" -U postgres --no-sync -A trust > /dev/null 2>&1
"$PG_CTL" -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start > /dev/null 2>&1 \
  || { echo "起不來"; cat "$D/log"; exit 1; }
Q()  { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>&1; }
QV() { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>/dev/null; }

FAILED=0
chk() { if [ "$2" = "$3" ]; then printf '  ✅ %s = %s\n' "$1" "$2"
        else printf '  🔴 %s = %s   而期望 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi }
chk_ne() { if [ "$2" != "$3" ]; then printf '  ✅ %s = %s(非 %s)\n' "$1" "$2" "$3"
           else printf '  🔴 %s = %s   而它【不該】是 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi }

# ── fixture:最小可跑的世界(形狀對齊 pending-views-order-source-probe.sh)──
Q -c "
CREATE TYPE payment_status AS ENUM ('unpaid','paid','refunded');
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT E' \t\n' \$\$;
CREATE FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text||':'||\$2::text \$\$;
CREATE FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text||':'||\$2::text||':'||\$3::text \$\$;
CREATE FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text \$\$;
CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.customers (user_id uuid PRIMARY KEY, email text);
CREATE TABLE public.orders (id uuid PRIMARY KEY, display_id text, paid_at timestamptz, created_at timestamptz,
  cancelled_at timestamptz, cancelled_reason text, notification_email text, customer_user_id uuid,
  payment_status payment_status NOT NULL, order_source text NOT NULL DEFAULT 'web');
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid);
CREATE TABLE public.shipments (id uuid PRIMARY KEY, shipment_reference text, shipped_at timestamptz,
  deleted_at timestamptz, tracking_number text, carrier_code text, tracking_corrected_at timestamptz);
CREATE TABLE public.shipment_items (shipment_id uuid, order_item_id uuid);
CREATE TABLE public.order_cancellations (order_id uuid);
CREATE TABLE public.email_outbox (order_id uuid, event_type text, dedup_key text, status text, sent_at timestamptz);
-- 🔴 fixture 要鏡射【正式庫的權限形狀】—— 080000 的自證⑤ 要求 anon 叫不動那四支函式。
--    不收掉 PUBLIC 的預設 EXECUTE 的話, 前一版根本貼不進去(而那不是缺陷, 是我的世界不對)。
REVOKE EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) TO service_role;
" > /dev/null || { echo "🔴 fixture 失敗"; exit 1; }

# 🔵 080000 是 `CREATE OR REPLACE` 且有一道「這四支 view 要先在」的前置閘
#    ⇒ 先從它自己的四段長出【沒有 order_source 的那一版】建起來(形狀抄片 A 探針)。
python3 - "$BASE" > "$D/before.sql" <<'PY0'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read().split('-- ══ ROLLBACK')[0]
s = '\n'.join(l for l in s.split('\n') if not l.strip().startswith('--'))
segs = re.findall(r'CREATE OR REPLACE VIEW.*?;\n', s, re.S)
assert len(segs) == 4, len(segs)
out = []
for g in segs:
    g2 = '\n'.join(l for l in g.split('\n') if 'AS order_source' not in l)
    g2 = re.sub(r',(\s*\nFROM )', r'\1', g2, count=1)
    out.append(g2)
sys.stdout.write('\n'.join(out))
PY0
test -s "$D/before.sql" || { echo "🔴 before.sql 是空的 ⇒ 產它那一步失敗了(而 psql 對空檔 rc=0)"; exit 1; }
Q -f "$D/before.sql" > /dev/null 2>&1 || { echo "🔴 before 版建不起來"; Q -f "$D/before.sql"; exit 1; }

# 再貼【前一版】(080000 那一支, 它把 order_source 加上去)
Q -f "$BASE" > "$D/base.log" 2>&1 || { echo "🔴 前一版貼不進去"; sed -n '1,5p' "$D/base.log"; exit 1; }

# 三張已付款的單:①顧客站留白 ②手動留白 ③手動有填
Q -c "
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-0000000000c1','c1@x.test');
INSERT INTO public.orders (id,display_id,paid_at,created_at,notification_email,customer_user_id,payment_status,order_source)
VALUES ('00000000-0000-0000-0000-000000000001','W1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','web'),
       ('00000000-0000-0000-0000-000000000002','M1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','manual_phone'),
       ('00000000-0000-0000-0000-000000000003','M2',now(),now(),'staff@x.test','00000000-0000-0000-0000-0000000000c1','paid','manual_line'),
       ('00000000-0000-0000-0000-000000000004','M3',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','manual_other');
" > /dev/null

chk "格1 貼之前:掃描面上有 4 張(病本身 —— ②④ 不該在這裡)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_order_created_email_pending')" 4

# ── 正向 ───────────────────────────────────────────────
Q -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
chk "格2 貼上去 rc" "$RC" 0
[ "$RC" -ne 0 ] && grep -m2 -E '^psql:.*ERROR' "$D/apply.log" | sed 's/^/     /'

chk "格3 🔴 貼之後掃描面剩 2 張(手動留白的兩張離開了)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_order_created_email_pending')" 2
chk "格4 🟢 顧客站留白【仍在】(現狀不得變)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending WHERE display_id='W1'")" 1
chk "格5 🟢 手動【有填】的仍在(它要寄)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending WHERE display_id='M2'")" 1
chk "格6 🔴 manual_phone 留白 ⇒ 不在" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending WHERE display_id='M1'")" 0
chk "格7 🔴 manual_other 留白 ⇒ 也不在(只列 manual_phone 的實作會在這裡紅)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending WHERE display_id='M3'")" 0

# 🔵 空白字元:只有空白的信箱等同留白(那條 btrim 述詞本來就在)
Q -c "UPDATE public.orders SET notification_email = '   ' WHERE display_id='M2'" > /dev/null
chk "格8 🔵 手動 + 只有空白的信箱 ⇒ 也算留白, 不在掃描面" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending WHERE display_id='M2'")" 0
Q -c "UPDATE public.orders SET notification_email = 'staff@x.test' WHERE display_id='M2'" > /dev/null

# 出貨線那兩支:造一張手動留白 + 已出貨的單
Q -c "
INSERT INTO public.order_items VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000002');
INSERT INTO public.shipments (id,shipment_reference,shipped_at) VALUES ('00000000-0000-0000-0000-0000000000f1','SHIP-1',now());
INSERT INTO public.shipment_items VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1');
" > /dev/null
chk "格9 🔴 出貨那支:手動留白的單也不在掃描面" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_shipped_email_pending')" 0
Q -c "UPDATE public.orders SET notification_email='staff@x.test' WHERE display_id='M1'" > /dev/null
chk "格10 🟢 正對照:同一張單【填了信箱】⇒ 它回到掃描面(證明尺會動)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_shipped_email_pending')" 1
Q -c "UPDATE public.orders SET notification_email=NULL WHERE display_id='M1'" > /dev/null

# ── 突變 ───────────────────────────────────────────────
# 🔴 080000 有一道「那一欄要還沒有」的前置閘 ⇒ 直接重貼它會紅。
#    ⇒ 重置要先 DROP 再從 before 版重建, 然後才貼 080000。
reset_views() {
  Q -c "DROP VIEW IF EXISTS public.pcm_order_created_email_pending, public.pcm_shipped_email_pending,
        public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
  Q -f "$D/before.sql" > /dev/null 2>&1
  Q -f "$BASE" > /dev/null 2>&1
}

# 🧬 只列 manual_phone ⇒ 自證② 要紅
reset_views
python3 - "$MIG" > "$D/mut1.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = s.replace("'manual_phone', 'manual_line', 'manual_other'", "'manual_phone'")
sys.stdout.write(s)
PY
test -s "$D/mut1.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut1.sql" > "$D/mut1.log" 2>&1; RC1=$?
chk_ne "格11 🧬 只列 manual_phone ⇒ 貼上去 rc" "$RC1" 0
if grep -qF '自證②' "$D/mut1.log"; then chk "格11b 🧬 而它紅在【自證②】那一句" yes yes
else chk "格11b 🧬 而它紅在【自證②】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut1.log" | sed 's/^/     實際: /'; fi

# 🧬 把那整段 AND 拿掉 ⇒ 自證① 要紅
reset_views
python3 - "$MIG" > "$D/mut2.sql" <<'PY'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r"\n  AND \(\n        o\.order_source NOT IN[^;]*?\n      \)", "", s)
sys.stdout.write(s)
PY
test -s "$D/mut2.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut2.sql" > "$D/mut2.log" 2>&1; RC2=$?
chk_ne "格12 🧬 把那段述詞整個拿掉 ⇒ 貼上去 rc" "$RC2" 0
if grep -qF '自證①' "$D/mut2.log"; then chk "格12b 🧬 而它紅在【自證①】那一句" yes yes
else chk "格12b 🧬 而它紅在【自證①】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut2.log" | sed 's/^/     實際: /'; fi

# 🔵 負對照突變:恆等改寫 ⇒ 該綠
reset_views
python3 - "$MIG" > "$D/mut0.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
sys.stdout.write(s.replace('BEGIN;', 'BEGIN;  -- 恆等改寫', 1))
PY
Q -f "$D/mut0.sql" > "$D/mut0.log" 2>&1
chk "格13 🔵 負對照突變(恆等改寫)⇒ rc" "$?" 0

# 🧬 ACL:把其中一支對 anon 開起來(而且拿掉那行 REVOKE)⇒ 自證③ 要紅
reset_views
python3 - "$MIG" > "$D/mut3.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = s.replace('REVOKE ALL ON public.pcm_shipped_email_pending            FROM PUBLIC, anon, authenticated;', '')
sys.stdout.write(s)
PY
Q -c "GRANT SELECT ON public.pcm_shipped_email_pending TO anon" > /dev/null
Q -f "$D/mut3.sql" > "$D/mut3.log" 2>&1; RC3=$?
chk_ne "格14 🧬 漏一行 REVOKE 而 anon 看得到 ⇒ 貼上去 rc" "$RC3" 0
if grep -qF '自證③' "$D/mut3.log"; then chk "格14b 🧬 而它紅在【自證③】那一句" yes yes
else chk "格14b 🧬 而它紅在【自證③】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut3.log" | sed 's/^/     實際: /'; fi

# 🔵 R6 不改 unpaid_cancelled ⇒ 它【不得】被本片動到
reset_views
Q -f "$MIG" > /dev/null 2>&1
chk "格15 🔵 unpaid_cancelled 的定義裡【不得】有 manual_ 字面(本片刻意不動它)" \
  "$(QV -Atc "SELECT pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true) LIKE '%manual_%'")" f

if [ "$FAILED" -eq 0 ]; then echo "🟢 全部通過(格數當場數:上面的 ✅ 行)"; exit 0; fi
echo "🔴 有 $FAILED 格不符預期 ⇒ 本探針判 FAIL"; exit 1
