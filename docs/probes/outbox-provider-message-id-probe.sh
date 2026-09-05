#!/bin/bash
# 拋棄式 PG 探針 · 20260906200000(email_outbox 加 provider_message_id)
#
# 🔴 **它證什麼**:apply 得起來 · 欄是 nullable 且無 DEFAULT · 欄級 ACL 三個角色分得開 ·
#    forward-only 重跑會被擋 · 而那幾道閘**殺得掉突變**。
# 🛑 **它【證不到】什麼**(寫在前面):
#    · 這裡的三個角色沒有 Supabase 的預設授權 ⇒ 證的是**我下的那道 GRANT/REVOKE 的行為**,
#      不是正式庫的 RLS 與 PostgREST 可達性。
#    · 它不證「sender 真的會把 id 寫進去」—— 那是碼那一半。
#      🔴 **訂正(codex R1-#7)**:⛔ ~~原本這裡只寫「由單元測試守」~~ —— **寫下那句的當下它是【假的】**:
#      當時每一格單元測試的第四參都是 `null` ⇒ 把那一欄從 update 物件整個拿掉, **一格都不會紅**。
#      ✅ 現在真的守著它的是這三格(補上之後才成立):
#        · `SupabaseEmailOutboxAdapter.test.ts` 「markSent 帶 provider 訊息 id」(正)
#        · 同檔 「負對照:第四參 null ⇒ 那一欄落 null」(反, 且證鍵仍在)
#        · `sweep-email-outbox.test.ts` 「sender 回了 id ⇒ 那個字串走到 markSent 第四參」
#      🧬 突變驗過:拿掉 `provider_message_id:` 那一行 + use-case 改硬傳 `null` ⇒ **3 failed**;還原 ⇒ 全綠。
#      📌 **一句「由測試守」不會自己變成真的** —— 它指的那些測試可以整批對它零判別力。
# 🛑 rc 由讀數決定(FAILED > 0 ⇒ exit 1)。

set -u
export LC_ALL=C LANG=C
D=$(mktemp -d); P=54363
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
trap 'pg_ctl -D "$D/pg" -w stop >/dev/null 2>&1; rm -rf "$D"' EXIT

MIG="${1:-/Users/sean_1/pcm-wt-mail/supabase/migrations/20260906200000_m4b_outbox_provider_message_id.sql}"
test -f "$MIG" || { echo "🔴 找不到 migration: $MIG"; exit 2; }

initdb -D "$D/pg" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start >/dev/null 2>&1 || { echo "🔴 PG 起不來"; exit 2; }

PASS=0; FAILED=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "🟢 $1  ($2)"
  else FAILED=$((FAILED+1)); echo "🔴 $1  期望[$3] 實得[$2]"; fi
}
Q() { psql -U postgres -At -X -c "$1" 2>/dev/null; }

psql -U postgres -q -X -v ON_ERROR_STOP=1 > "$D/fx.log" 2>&1 <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  event_type text NOT NULL,
  dedup_key text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_error_code text,
  sent_at timestamptz
);
-- 🔴 **本表的 ACL 形狀照正式庫:只有 service_role 讀得到。**
--    ⚠️ 少了這兩行, 事後閘②a/②b 會【因為錯的理由】綠 —— 沒有任何人有權限, 而不是「我收乾淨了」。
REVOKE ALL ON public.email_outbox FROM PUBLIC;
REVOKE ALL ON public.email_outbox FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_outbox TO service_role;
SQL
chk "00 fixture 建起來" "$?" "0"
[ "$FAILED" = "0" ] || { cat "$D/fx.log"; echo "PASSED=$PASS FAILED=$FAILED"; exit 1; }

# 🟢 貼之前先量一次 —— 沒有這一格, 下面「欄在」證不到是本支加的
chk "01 貼前:那一欄【不在】(正對照的另一半)" \
    "$(Q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.email_outbox'::regclass AND attname='provider_message_id' AND attnum>0 AND NOT attisdropped")" "0"

psql -U postgres -q -X -v ON_ERROR_STOP=1 -f "$MIG" > "$D/apply.log" 2>&1
chk "02 apply 成功" "$?" "0"
if [ "$FAILED" != "0" ]; then echo "--- apply log ---"; cat "$D/apply.log"; echo "PASSED=$PASS FAILED=$FAILED"; exit 1; fi

chk "03 欄在了" \
    "$(Q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.email_outbox'::regclass AND attname='provider_message_id' AND attnum>0 AND NOT attisdropped")" "1"
chk "04 是 nullable(不是 NOT NULL)" \
    "$(Q "SELECT attnotnull::text FROM pg_attribute WHERE attrelid='public.email_outbox'::regclass AND attname='provider_message_id'")" "false"
chk "05 沒有 DEFAULT" \
    "$(Q "SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.email_outbox'::regclass AND a.attname='provider_message_id'")" "0"
chk "06 型別是 text" \
    "$(Q "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='public.email_outbox'::regclass AND attname='provider_message_id'")" "text"

# ── 欄級 ACL 三個角色分得開 ──────────────────────────────────────
chk "07 anon 讀不到那一欄"          "$(Q "SELECT has_column_privilege('anon','public.email_outbox','provider_message_id','SELECT')::text")" "false"
chk "08 authenticated 讀不到"       "$(Q "SELECT has_column_privilege('authenticated','public.email_outbox','provider_message_id','SELECT')::text")" "false"
chk "09 🟢 正對照:service_role 讀得到(否則上面兩個 false 只是尺對整張表都 false)" \
    "$(Q "SELECT has_column_privilege('service_role','public.email_outbox','provider_message_id','SELECT')::text")" "true"

# ── forward-only ────────────────────────────────────────────────
psql -U postgres -q -X -v ON_ERROR_STOP=1 -f "$MIG" > "$D/rerun.log" 2>&1
chk "10 重跑被擋"                    "$?" "3"
chk "10b 擋在【前置閘②】而不是別的地方" "$(grep -c '前置閘②' "$D/rerun.log")" "1"

# ── 🧬 突變:證那幾道閘會紅 ───────────────────────────────────────
# ① 欄級 ACL 那道:開一格 SELECT (provider_message_id) 給 anon ⇒ 事後閘②a 該紅
psql -U postgres -q -X >/dev/null 2>&1 <<'SQL'
CREATE TABLE public.mut_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_message_id text);
REVOKE ALL ON public.mut_outbox FROM PUBLIC;
REVOKE ALL ON public.mut_outbox FROM anon, authenticated, service_role;
GRANT SELECT (provider_message_id) ON public.mut_outbox TO anon;
SQL
chk "11 🧬 突變:欄級 GRANT 給 anon ⇒ has_column_privilege 抓得到(true)" \
    "$(Q "SELECT has_column_privilege('anon','public.mut_outbox','provider_message_id','SELECT')::text")" "true"
chk "12 🔴🔴 而同一個世界 has_TABLE_privilege 回 false ⇒ 用表級那一支會【放它過去】" \
    "$(Q "SELECT has_table_privilege('anon','public.mut_outbox','SELECT')::text")" "false"

echo "PASSED=$PASS FAILED=$FAILED"
[ "$FAILED" = "0" ] || exit 1
