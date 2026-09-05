#!/bin/bash
# 拋棄式 PG 探針 · 20260906140000(email_outbox 加第六個 event_type: bank_order_created)
#
# 🔴 **本探針的重點不是「migration 跑得過」** —— 那只是第 1 格。
#    重點是第 09/10 兩格:**證明【帶引號比對】不是風格偏好, 是必要條件。**
#    先例用裸 `strpos(v_def, 'order_created')`;而本片新增的值是 `bank_order_created`
#    ⇒ 它**包含** `order_created` ⇒ 一個把舊值刪掉的世界會讓那道閘**綠著放行**。
#
# 🛑 **rc 由讀數決定, 不是由「有沒有跑完」決定**(FAILED > 0 ⇒ exit 1)。
#    ⚠️ 本 repo 記過:15 格全是 `echo` 的探針 rc 恆 0 ⇒ 掛進 CI 的是一個不帶資訊的綠。
# ⚠️ **本機效度限制**:這裡沒有 Supabase 的角色、RLS、PostgREST ⇒ 它證的是**約束的行為**,
#    證不到正式庫的權限與可達性。

set -u
export LC_ALL=C LANG=C
D=$(mktemp -d); P=54361
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
trap 'pg_ctl -D "$D/pg" -w stop >/dev/null 2>&1; rm -rf "$D"' EXIT

MIG="${1:-/Users/sean_1/pcm-wt-mail/supabase/migrations/20260906140000_m4b_outbox_bank_order_created_event.sql}"
test -f "$MIG" || { echo "🔴 找不到 migration: $MIG"; exit 2; }

initdb -D "$D/pg" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start >/dev/null 2>&1 || { echo "🔴 PG 起不來"; exit 2; }

PASS=0; FAILED=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "🟢 $1  ($2)"
  else FAILED=$((FAILED+1)); echo "🔴 $1  期望[$3] 實得[$2]"; fi
}
Q() { psql -U postgres -At -X -c "$1" 2>/dev/null; }

# ── fixture:貼進去之前的那個世界(五值)──
psql -U postgres -q -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  event_type text NOT NULL,
  dedup_key text NOT NULL,
  CONSTRAINT email_outbox_event_type_check CHECK (event_type IN (
    'order_created','order_shipped','order_cancelled','order_unpaid_cancelled','shipment_tracking_corrected'))
);
SQL

psql -U postgres -q -X -v ON_ERROR_STOP=1 -f "$MIG" > "$D/apply.log" 2>&1
RC=$?
chk "01 apply 成功" "$RC" "0"
# 🔴 apply 失敗 = 致命 —— 否則下游每一格都會「因為錯的理由」變綠
if [ "$RC" != "0" ]; then echo "--- apply log ---"; cat "$D/apply.log"; echo "PASSED=$PASS FAILED=$FAILED"; exit 1; fi

DEF=$(Q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_event_type_check'")
echo "── constraintdef ──"; echo "$DEF"

chk "02 定義裡的值帶單引號(本支比對法的前提)" "$(printf '%s' "$DEF" | grep -c "'order_created'")" "1"
chk "03 新值在" "$(printf '%s' "$DEF" | grep -c "'bank_order_created'")" "1"
chk "04 舊五值都在" "$(printf '%s' "$DEF" | grep -o "'order_created'\|'order_shipped'\|'order_cancelled'\|'order_unpaid_cancelled'\|'shipment_tracking_corrected'" | sort -u | wc -l | tr -d ' ')" "5"

psql -U postgres -q -X -c "INSERT INTO public.email_outbox(event_type,dedup_key) VALUES ('bank_order_created','k1')" >/dev/null 2>&1
chk "05 新值寫得進去" "$(Q "SELECT count(*) FROM public.email_outbox WHERE event_type='bank_order_created'")" "1"
psql -U postgres -q -X -c "INSERT INTO public.email_outbox(event_type,dedup_key) VALUES ('order_created','k2')" >/dev/null 2>&1
chk "06 舊值仍寫得進去(負對照的另一半)" "$(Q "SELECT count(*) FROM public.email_outbox WHERE event_type='order_created'")" "1"
psql -U postgres -q -X -c "INSERT INTO public.email_outbox(event_type,dedup_key) VALUES ('zzz_never','k3')" >/dev/null 2>&1
chk "07 現造值仍被擋" "$(Q "SELECT count(*) FROM public.email_outbox WHERE event_type='zzz_never'")" "0"

psql -U postgres -q -X -v ON_ERROR_STOP=1 -f "$MIG" > "$D/rerun.log" 2>&1
chk "08 forward-only 重跑被擋" "$?" "3"
chk "08b 重跑擋在【前置閘②】而不是別的地方" "$(grep -c '前置閘②' "$D/rerun.log")" "1"

# ══════════════════════════════════════════════════════════════════
# 🧬 突變:證明【帶引號比對】是必要條件
# ══════════════════════════════════════════════════════════════════
# 兩把尺並排量同一個東西:裸 strpos vs 帶引號 strpos。
# 09 = 正對照(現況兩把都該命中)· 10 = 突變(舊值被刪掉, 只剩 bank_order_created)
SQL_BOTH="SELECT (pg_catalog.strpos(pg_get_constraintdef(oid), \$q\$order_created\$q\$) > 0)::text || '/' || (pg_catalog.strpos(pg_get_constraintdef(oid), \$q\$'order_created'\$q\$) > 0)::text FROM pg_constraint WHERE conname="

chk "09 正對照:現況【裸/帶引號】兩把尺都命中" "$(Q "${SQL_BOTH}'email_outbox_event_type_check'")" "true/true"

psql -U postgres -q -X >/dev/null 2>&1 <<'SQL'
CREATE TABLE public.mut (event_type text NOT NULL,
  CONSTRAINT mut_chk CHECK (event_type IN ('bank_order_created','order_shipped')));
SQL
chk "10 🔴 突變:order_created 被刪、只剩 bank_order_created ⇒ 裸比對【假綠 true】而帶引號【抓到 false】" \
    "$(Q "${SQL_BOTH}'mut_chk'")" "true/false"

echo "PASSED=$PASS FAILED=$FAILED"
[ "$FAILED" = "0" ] || exit 1
