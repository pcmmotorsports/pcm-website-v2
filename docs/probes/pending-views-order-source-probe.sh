#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# pending-views-order-source-probe.sh
#   ⟦f3-MAILFALLBACKVSRULING⟧ 片 A 探針:拋棄式 PG,雙向。
# 🟢 正向:貼上去 ⇒ 四個 view 各多一欄, 而【列的集合不變】
# 🔵 負向:重貼 ⇒ 前置閘要紅;把新欄插在中間 ⇒ 自證②要紅
set -u
# 🔴 R1-F2:CI 跑的是 `bash <本檔>` **沒有參數**, 而 `set -u` 會讓 `"$1"` 當場 unbound。
#    ⇒ 給一個預設值:本片那支 migration。(手動跑時仍可用第一參數覆寫。)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="${1:-$REPO_ROOT/supabase/migrations/20260905080000_m4b_pending_views_order_source.sql}"
test -f "$MIG" || { echo "🔴 找不到受測 migration:$MIG"; exit 1; }

# 🔴 R1-F2 第二個成因:本檔原本寫死 /opt/homebrew/bin/*(那是我這台 macOS 的路徑),
#    而 CI runner 的 PG 在 /usr/lib/postgresql/*/bin ⇒ 在 CI 上必紅。
#    ⇒ 一律走 PATH;PATH 上沒有才退回 homebrew。
pick() {  # $1 = 命令名 ⇒ 印出可用的絕對路徑或命令名;找不到就 exit
  if command -v "$1" > /dev/null 2>&1; then printf '%s' "$1"
  elif [ -x "/opt/homebrew/bin/$1" ]; then printf '%s' "/opt/homebrew/bin/$1"
  else echo "🔴 找不到 $1(PATH 與 /opt/homebrew/bin 都沒有)⇒ 沒有跑, 不是通過" >&2; exit 1
  fi
}
# ⚠️ 不用 `${B^^}` —— 那是 bash 4+ 的語法, 而 macOS 內建 bash 是 3.2。
INITDB=$(pick initdb) || exit 1
PG_CTL=$(pick pg_ctl) || exit 1
PSQL=$(pick psql)     || exit 1

# 🔴 macOS 上 postmaster 會 multithreaded ⇒ 要 LC_ALL=C(它自己的 HINT 講的)
export LC_ALL=C LANG=C
# 🔴 R1-F12:寫死的 port 會與別支並行的 probe 撞 ⇒ 可覆寫
D=$(mktemp -d); P="${PGPORT_PROBE:-54329}"
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
"$INITDB" -D "$D/pg" -U postgres --no-sync -A trust > /dev/null 2>&1
"$PG_CTL" -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start > /dev/null 2>&1 || { echo "起不來"; cat "$D/log"; exit 1; }
Q() { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>&1; }

# 🔴🔴 R2-M2(對抗審查抓到):本檔第一版每一格都只是 `echo` ⇒ **rc 恆 0**
#    ⇒ 掛進 CI(`ci.yml` 那一步是 `bash "$P"`)之後, 格3 rc≠0 / 格6b 列數變了 /
#      格7 重貼沒被擋 / 格9 突變沒紅 —— **CI 一律綠**。
#    📌 一個被 CI 認領、而永遠不會紅的探針, 比沒有探針糟:它讓人以為有東西在守。
#    ✅ 每一格改成「拿讀數比預期值」, 不符就記一筆, 檔尾用 FAILED 決定 rc。
FAILED=0
chk() {  # chk <格名> <實得> <期望>
  if [ "$2" = "$3" ]; then
    printf '  ✅ %s = %s\n' "$1" "$2"
  else
    printf '  🔴 %s = %s   而期望 %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
chk_ne() {  # chk_ne <格名> <實得> <不該是的值>
  if [ "$2" != "$3" ]; then
    printf '  ✅ %s = %s(非 %s)\n' "$1" "$2" "$3"
  else
    printf '  🔴 %s = %s   而它【不該】是 %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# ── fixture:最小可跑的 before 世界 ─────────────────────────────
Q -c "
CREATE TYPE payment_status AS ENUM ('unpaid','paid','refunded');
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT E' \t\n' \$\$;
CREATE FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text||':'||\$2::text \$\$;
CREATE FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text||':'||\$2::text||':'||\$3::text \$\$;
CREATE FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$ SELECT \$1::text \$\$;
CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
-- 🔴🔴 fixture 要鏡射【正式庫的權限形狀】, 不是 PG 的預設形狀(2026-09-05 唯讀實查:
--    四支函式對 anon 皆 f、service_role 皆 t;四個 view 對 anon/authenticated 皆 f)。
--    ⇒ 不收掉 PUBLIC 的預設 EXECUTE 的話, migration 的自證⑤ 會在【只有這個 fixture 才有】
--      的世界裡紅 —— 📌 而那不是它抓到缺陷, 是我的 fixture 與被測世界不同。
REVOKE EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz) TO service_role;
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
" > /dev/null || { echo "fixture 失敗"; exit 1; }

# before 版 view = 本次 migration 的四段, 各自拿掉 order_source 那一行
python3 - "$MIG" > "$D/before.sql" <<'PY'
import io,sys,re
s=io.open(sys.argv[1],encoding='utf-8').read()
body=s.split('-- ══ ROLLBACK')[0]
body='\n'.join(l for l in body.split('\n') if not l.strip().startswith('--'))
# 只取四段 CREATE OR REPLACE VIEW ... ;
segs=re.findall(r'CREATE OR REPLACE VIEW.*?;\n', body, re.S)
assert len(segs)==4, len(segs)
out=[]
for g in segs:
    g2 = '\n'.join(l for l in g.split('\n') if 'AS order_source' not in l)
    g2 = re.sub(r',(\s*\nFROM )', r'\1', g2, count=1)
    out.append(g2)
sys.stdout.write('\n'.join(out))
PY
test -s "$D/before.sql" || { echo "🔴 before.sql 是空的 ⇒ 產它的那一步失敗了(而 psql 對空檔 rc=0)"; exit 1; }
Q -f "$D/before.sql" > /dev/null || { echo "🔴 before 建不起來"; Q -f "$D/before.sql"; exit 1; }

BEFORE_N=$(Q -Atc "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND a.attname='order_source' AND a.attnum>0 AND NOT a.attisdropped")
chk "格1 貼之前 order_source 欄數" "$BEFORE_N" 0

# 造兩張會進 order_created view 的單:一 web 一 manual
Q -c "
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-0000000000c1','c1@x.test');
INSERT INTO public.orders (id,display_id,paid_at,created_at,notification_email,customer_user_id,payment_status,order_source)
VALUES ('00000000-0000-0000-0000-000000000001','W1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','web'),
       ('00000000-0000-0000-0000-000000000002','M1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','manual_phone');
" > /dev/null
# 🔴🔴 R1-F7:格2/格5 只量【非 DISTINCT】那一支 ⇒ 對「加一欄會不會改列數」零判別力。
#    真正的機制住在 ②③ 兩支 `SELECT DISTINCT` —— 加一欄 = 改 distinct key。
#    ⇒ 造一張【同一張單、同一次出貨、兩個品項】的資料:DISTINCT 前 2 列、後 1 列。
#    📌 這是唯一一種「加一欄會靜默改列數」會現形的形狀。
Q -c "
INSERT INTO public.orders (id,display_id,created_at,customer_user_id,payment_status,order_source)
VALUES ('00000000-0000-0000-0000-000000000003','S1',now(),'00000000-0000-0000-0000-0000000000c1','paid','manual_line');
INSERT INTO public.order_items VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000003');
INSERT INTO public.shipments (id,shipment_reference,shipped_at) VALUES
  ('00000000-0000-0000-0000-0000000000f1','SHIP-1',now());
INSERT INTO public.shipment_items VALUES
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a2');
" > /dev/null
RAW=$(Q -Atc "SELECT count(*) FROM public.shipments s JOIN public.shipment_items si ON si.shipment_id=s.id")
DIST_BEFORE=$(Q -Atc "SELECT count(*) FROM public.pcm_shipped_email_pending")
chk "格2b-底層配對(fixture 要真的造出 DISTINCT 世界)" "$RAW" 2
chk "格2b-DISTINCT 那支貼前撈到" "$DIST_BEFORE" 1

# 🔴 貼前那個數必須在【所有 fixture 都插完之後】才量 ——
#    我第一版把它量在插入 shipment fixture【之前】⇒ 貼前 2 / 貼後 3,
#    看起來像「加一欄改了行為」, 而真正的成因是我自己中途換了世界。
#    📌 前後兩個讀數要來自同一個世界, 否則差值不是我要的那個差值。
ROWS_BEFORE=$(Q -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending")
chk "格2 貼之前那個 view 撈到幾列" "$ROWS_BEFORE" 3

# ── 正向 ──────────────────────────────────────────────────────
Q -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
chk "格3 貼上去 rc" "$RC" 0
[ "$RC" -ne 0 ] && sed -n '1,12p' "$D/apply.log"
AFTER_N=$(Q -Atc "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND a.attname='order_source' AND a.attnum>0 AND NOT a.attisdropped")
chk "格4 貼之後 order_source 欄數" "$AFTER_N" 4
ROWS_AFTER=$(Q -Atc "SELECT count(*) FROM public.pcm_order_created_email_pending")
chk "格5 貼之後那個 view 撈到幾列(🔴 行為不得改變)" "$ROWS_AFTER" "$ROWS_BEFORE"
SRC=$(Q -Atc "SELECT string_agg(order_source, ',' ORDER BY display_id) FROM public.pcm_order_created_email_pending")
chk "格6 新欄真的帶出值" "$SRC" "manual_phone,manual_line,web"
DIST_AFTER=$(Q -Atc "SELECT count(*) FROM public.pcm_shipped_email_pending")
chk "格6b 🔴 DISTINCT 那支貼後撈到(加一欄不得改列數)" "$DIST_AFTER" "$DIST_BEFORE"
DSRC=$(Q -Atc "SELECT string_agg(order_source, ',') FROM public.pcm_shipped_email_pending")
chk "格6c DISTINCT 那支的新欄值" "$DSRC" "manual_line"

# ── 負向 ──────────────────────────────────────────────────────
Q -f "$MIG" > "$D/again.log" 2>&1; RC2=$?
chk_ne "格7 🔵 重貼一次 rc(前置閘要擋)" "$RC2" 0   # 🔵 而【紅在哪一句】由格8 判
if grep -qF '已經有 order_source 欄' "$D/again.log"; then chk "格8 🔵 它紅在【對的那一句】" yes yes; else chk "格8 🔵 它紅在【對的那一句】" no yes; fi

# 🧬 格11:自證④(invoker view 的 EXECUTE 斷言)—— 收掉一支函式的 EXECUTE ⇒ 它要紅。
#    🔴 沒有這一格, 那四行斷言【從來沒有在該紅的世界跑過】—— 而它們在正常世界必然全綠
#      (那四支函式今天靠 PUBLIC 的預設 EXECUTE 在跑)⇒ 恆綠與守住印同一個東西。
Q -c "DROP VIEW public.pcm_order_created_email_pending, public.pcm_shipped_email_pending, public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
Q -f "$D/before.sql" > /dev/null
Q -c "REVOKE EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) FROM PUBLIC, service_role" > /dev/null
Q -f "$MIG" > "$D/acl.log" 2>&1; RC4=$?
chk_ne "格11 🧬 收掉一支函式的 EXECUTE ⇒ 貼上去 rc" "$RC4" 0
if grep -qF '自證④' "$D/acl.log"; then chk "格11b 🧬 而它紅在【自證④】那一句" yes yes; else chk "格11b 🧬 而它紅在【自證④】那一句" no yes; fi
# 🔴 還原要回到【fixture 原本那個狀態】(收掉 PUBLIC + 給 service_role),
#    而我第一版寫 `TO PUBLIC` ⇒ 那是 PG 的預設狀態, 不是被測世界的狀態
#    ⇒ 它讓 anon 又叫得動那支函式, 而下游的格13 就紅在【格11 留下的髒狀態】上。
#    📌 抓到它的是新加的自證⑤ —— 一個守門在它自己的測試裡抓到了測試的錯。
Q -c "GRANT EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid,uuid) TO service_role" > /dev/null

# 突變:把新欄插在【中間】而不是最後 ⇒ 自證② 要紅
# 🧬 格12/12b:自證⑤(anon 叫不動)與自證⑥(anon 看不到 view)—— 證它們不是恆綠。
#    🔴 fixture 現在鏡射正式庫 ⇒ 那兩格在正常世界必然通過 ⇒ 必須各有一發突變把它們打紅,
#      否則「它們通過」與「它們根本沒被評估」印同一個東西。
Q -c "DROP VIEW public.pcm_order_created_email_pending, public.pcm_shipped_email_pending, public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
Q -f "$D/before.sql" > /dev/null
Q -c "GRANT EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) TO anon" > /dev/null
Q -f "$MIG" > "$D/anon1.log" 2>&1; RC5=$?
chk_ne "格12 🧬 讓 anon 叫得動一支函式 ⇒ 貼上去 rc" "$RC5" 0
if grep -qF '自證⑤' "$D/anon1.log"; then chk "格12b 🧬 而它紅在【自證⑤】那一句" yes yes; else chk "格12b 🧬 而它紅在【自證⑤】那一句" no yes; fi
Q -c "REVOKE EXECUTE ON FUNCTION public.pcm_tracking_corrected_at_key(timestamptz) FROM anon" > /dev/null

# 🧬 格13/13b:自證⑥ —— 🔴 而【只 GRANT 給 anon】打不到它:
#    本檔的 REVOKE 就排在自證之前, 它會把那個 GRANT 收掉 ⇒ 自證⑥ 看到 0 ⇒ 綠。
#    📌 那不是自證⑥ 壞了, 是**我的突變沒有落在目標上** —— 它其實證明了 REVOKE 有效。
#    ✅ 要打到自證⑥, 突變得【同時】拿掉那一行 REVOKE:那才是「REVOKE 寫錯/漏寫」的世界。
Q -c "GRANT SELECT ON public.pcm_shipped_email_pending TO anon" > /dev/null
sed 's|^REVOKE ALL ON public.pcm_shipped_email_pending .*$||' "$MIG" > "$D/norevoke.sql"
test -s "$D/norevoke.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/norevoke.sql" > "$D/anon2.log" 2>&1; RC6=$?
chk_ne "格13 🧬 漏寫一行 REVOKE 而 anon 看得到那個 view ⇒ 貼上去 rc" "$RC6" 0
if grep -qF '自證⑥' "$D/anon2.log"; then chk "格13b 🧬 而它紅在【自證⑥】那一句" yes yes; else chk "格13b 🧬 而它紅在【自證⑥】那一句" no yes; fi
grep -m1 -E "^psql:.*ERROR" "$D/anon2.log" | sed 's/^/     實際紅在: /'
Q -c "REVOKE ALL ON public.pcm_shipped_email_pending FROM PUBLIC, anon, authenticated" > /dev/null

# 🔵 R2-N1:下面那個 replace 的縮排字面同時命中 view ①②④(三段逐字相同), ③ 不中
#    ⇒ 這一發突變【動了三支】, 不是一支。功能上仍是「把新欄插到中間」, 而數字要說對。
python3 - "$MIG" > "$D/mut.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read().split('-- ══ ROLLBACK')[0]
s=s.replace('  o.notification_email AS notification_email,\n  c.email              AS customer_email,\n  o.order_source       AS order_source\n',
            '  o.notification_email AS notification_email,\n  o.order_source       AS order_source,\n  c.email              AS customer_email\n')
sys.stdout.write(s)
PY
Q -c "DROP VIEW public.pcm_order_created_email_pending, public.pcm_shipped_email_pending, public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
Q -f "$D/before.sql" > /dev/null
Q -f "$D/mut.sql" > "$D/mut.log" 2>&1; RC3=$?
chk_ne "格9 🧬 把新欄插在中間 rc" "$RC3" 0
# 🔴🔴 codex 2026-09-05 MF3:格9 只判「有失敗」⇒ 因【別的錯】失敗一樣算過;
#    而格10 只 echo 不更新 FAILED ⇒ 錯誤原因變了它不會叫。
#    📌 「它紅了」與「它紅在我要的那一句」是兩個宣稱, 而只有後者說得出守到了什麼。
echo "格10 🧬 它紅在哪一句(逐字):"
grep -m1 -E '^psql:.*ERROR' "$D/mut.log" | sed 's/^/     /'
if grep -qF 'cannot change name of view column' "$D/mut.log"; then
  chk "格10 🧬 而它紅在【欄序】那一句(不是別的錯)" yes yes
else
  chk "格10 🧬 而它紅在【欄序】那一句(不是別的錯)" no yes
fi


# 🧬 格14/15:**回退真的跑得動嗎** —— codex MF2 逼出來的那支 down.sql。
#    🔴 一支從來沒被執行過的回退腳本, 與一段回退【說明】是同一個東西:
#      都要在最需要它的那一刻才第一次被讀。⇒ 在這裡先跑一次。
DOWN="$REPO_ROOT/scripts/20260905080000-down.sql"
if [ -f "$DOWN" ]; then
  Q -c "DROP VIEW public.pcm_order_created_email_pending, public.pcm_shipped_email_pending, public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
  Q -f "$D/before.sql" > /dev/null
  Q -f "$MIG" > /dev/null 2>&1
  Q -f "$DOWN" > "$D/down.log" 2>&1; RC7=$?
  chk "格14 🧬 回退腳本跑得動 rc" "$RC7" 0
  [ "$RC7" -ne 0 ] && grep -m2 -E '^psql:.*(ERROR|錯誤)' "$D/down.log" | sed 's/^/     /'
  [ "$RC7" -ne 0 ] && sed -n '1,6p' "$D/down.log" | sed 's/^/     log: /' 
  BACK_N=$(Q -Atc "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND a.attname='order_source' AND a.attnum>0 AND NOT a.attisdropped")
  chk "格15 🧬 回退之後 order_source 欄數" "$BACK_N" 0
else
  echo "  🔴 找不到回退腳本 $DOWN"; FAILED=$((FAILED + 1))
fi

"$PG_CTL" -D "$D/pg" -w stop > /dev/null 2>&1
rm -rf "$D"

# 🔴 rc 由【結果】決定 —— 這一段就是 R2-M2 的修法本體。
if [ "$FAILED" -eq 0 ]; then
  echo "🟢 全部 22 格通過"
  exit 0
fi
echo "🔴 有 $FAILED 格不符預期 ⇒ 本探針判 FAIL"
exit 1
