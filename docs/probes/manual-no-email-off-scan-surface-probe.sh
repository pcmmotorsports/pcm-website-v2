#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# manual-no-email-off-scan-surface-probe.sh
#   ⟦f3-MAILFALLBACKVSRULING⟧ 片 C-2 探針:拋棄式 PG,雙向。
#
# 🛑🛑 **它【證不到】什麼(先讀這段)**:
#   · 它驗的是**【四】支 pending view + 一支伴生 view 的收錄行為**,
#     不驗「信真的沒寄出去」(那要真跑)。
#     ⛔ ~~三支~~ / ~~它不驗 `unpaid_cancelled`~~ —— **兩句都過期了**(codex R3 ⑧):
#     codex ④ 那一輪推翻了「不動 unpaid_cancelled」那個決定, 而格15 現在就在驗它。
#   · fixture 是**最小可跑**的世界(不是正式庫的 schema)⇒ 它答得出「述詞篩對了嗎」,
#     答不出「正式庫那些欄位的實際內容會不會讓它篩錯」。
#   · 🔴 伴生 view 那幾格驗的是**「被拿掉的通知」數對不對**, 不驗「有沒有人在讀它」——
#     今天**沒有人在讀**(接進 gap_counts / 儀表是下一片)。
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

# 四張已付款的單:①顧客站留白 ②手動留白 ③手動有填 ④手動留白
# 🔴 第五張 M4:**手動 + 留白, 而【未付款也沒取消】** —— 它是 codex R2 ① 那一格的專用單:
#    它**本來就不在任何一支掃描面上** ⇒ 伴生 view **不得**把它算進來(舊版會)。
#    🔵 它不影響格1(那一格數的是 `order_created`, 而那支要 `payment_status='paid'`)。
Q -c "
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-0000000000c1','c1@x.test');
INSERT INTO public.orders (id,display_id,paid_at,created_at,notification_email,customer_user_id,payment_status,order_source)
VALUES ('00000000-0000-0000-0000-000000000001','W1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','web'),
       ('00000000-0000-0000-0000-000000000002','M1',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','manual_phone'),
       ('00000000-0000-0000-0000-000000000003','M2',now(),now(),'staff@x.test','00000000-0000-0000-0000-0000000000c1','paid','manual_line'),
       ('00000000-0000-0000-0000-000000000004','M3',now(),now(),NULL,'00000000-0000-0000-0000-0000000000c1','paid','manual_other'),
       ('00000000-0000-0000-0000-000000000005','M4',NULL,now(),NULL,'00000000-0000-0000-0000-0000000000c1','unpaid','manual_phone');
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
  # 🔴 伴生 view 改成【裸 CREATE】之後(codex R2 ③), 重貼會紅在 `already exists`
  #    ⇒ 而那【不是】每一發突變要驗的那一句 ⇒ 重置一定要連它一起 DROP。
  #    📌 「它紅了」與「它紅在我要的那一句」是兩個宣稱。(180000 那支探針早就踩過同一條。)
  Q -c "DROP VIEW IF EXISTS public.pcm_manual_no_email_excluded" > /dev/null
  Q -c "DROP VIEW IF EXISTS public.pcm_order_created_email_pending, public.pcm_shipped_email_pending,
        public.pcm_tracking_corrected_email_pending, public.pcm_unpaid_cancelled_email_pending" > /dev/null
  Q -f "$D/before.sql" > /dev/null 2>&1
  Q -f "$BASE" > /dev/null 2>&1
}

# 🧬 只列 manual_phone ⇒ 自證② 要紅
reset_views
python3 - "$MIG" > "$D/mut1.sql" <<'PY'
# 🔴🔴 codex R3 ①:⛔ ~~原本這裡把三個來源【硬編碼】在突變器裡~~ ——
#    那是這一組值域的**第六份副本**, 而 parity 測試只綁 migration 與 TS 兩份 ⇒ **它守不到這裡**。
#    🛑 值域改了之後, `replace` 會【沒有命中】⇒ 突變檔與原檔逐字相同 ⇒ 貼上去 rc=0
#    ⇒ 格11 紅, 而它紅的訊息會說「述詞沒擋住」—— 📌 **一個假指控, 而真相是這把尺沒接上。**
# ✅ 改成【從受測檔自己讀出來】, 而且明寫斷言:抽不到就當場停, 不要產出一份沒被突變的檔。
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
# \U0001F534\U0001F534 **只認【碼那一行】**(行首五個空白 + `OR o.order_source NOT IN (`)——
#    \U0001F6D1 我第一版寫成「全檔搜 `NOT IN (…)`」並把分隔符放寬成逗號加空白類,
#    結果它抓到的是本檔一句**註解裡的量測紀錄**(`NULL::text NOT IN ('a','b')`)
#    ⇒ 突變落在一句註解上 ⇒ 貼上去 rc=0 ⇒ 格11 紅, **而它紅的理由是假的**。
#    \U0001F4CC **一把太寬的尺產出的不是漏報, 是假指控。**
#    ⇒ 這裡用的形狀與 `notification-fallback-sql-parity.test.ts` **同一個**, 而註解永遠以 `--` 開頭。
LINES = [l for l in s.split('\n') if re.match(r"^ {5}OR o\.order_source NOT IN \(", l)]
assert len(LINES) == 4, '🔴 碼那一行抓到 %d 條(應為 4)⇒ 抽取式與受測檔對不上了' % len(LINES)
assert len(set(LINES)) == 1, '🔴 四條不逐字相同 ⇒ 值域已經在檔內漂了, 先修那個'
m = re.search(r"NOT IN \((.+)\)", LINES[0])
assert m, '🔴 抽不到值域'
domain = m.group(1)                       # 例:'manual_phone', 'manual_line', 'manual_other'
first = domain.split(',')[0].strip()      # 只留第一個 ⇒ 自證② 要紅
assert domain != first, '🔴 值域只有一個值 ⇒ 這一發突變不可能改變任何東西'
# 🔴🔴 codex R4 ①:**只動那四行, 不做全檔取代。**
#    ⛔ ~~原本抓到四條之後就 `s.replace(domain, first)` 全檔取代~~ ——
#    🛑 那會**連伴生 view 那條反向的 `IN`(第五份值域)一起突變** ⇒ 這一發同時改了兩個東西
#       ⇒ 它紅的時候我分不出是哪一個造成的;而 dollar-quoted 區塊 / 區塊註解裡同形的字面也會被掃到。
#    📌 **一發突變要只有一個受詞** —— 否則「它紅了」答不出「哪一句在守」。
# 🔴🔴 codex R5 ①:⛔ ~~原本 `hit` 數的是【符合前綴的行數】~~ ——
#    🛑 那**不是取代次數**:`str.replace(a, b)` 預設**取代該行【全部】出現處**
#       ⇒ 若某一行尾端還有一個同形的值域(例如行尾註解), 那一行會被改 2 處,
#         而 `hit` 照樣只 +1 ⇒ **改了 8 處而印 hit=4**。
#    ✅ 兩件事分開釘:①每一行**必須正好出現一次**(否則當場停)②**取代總次數 = 4**。
#    📌 「有幾行命中」與「改了幾處」是兩個數 —— 而只有後者是這一發突變的爆炸半徑。
out, lines_hit, repl = [], 0, 0
for l in s.split('\n'):
    if re.match(r"^ {5}OR o\.order_source NOT IN \(", l):
        c = l.count(domain)
        # 🔴 codex R6 nit:⛔ ~~舊訊息寫「取代會超出目標」~~ —— **那是假的**:
        #    下面用的是 `replace(..., 1)` ⇒ **它只改第一處, 不會超出**。
        #    ✅ 停在這裡的真正理由是**歧義**:同一行有兩份值域時,
        #       「我改的是哪一處」由**它在行內的位置**決定, 而那不是我挑的 ——
        #       ⇒ 📌 這一發突變的受詞就變成【碰巧】的了, 而突變的價值全在受詞明確。
        #    🛑 所以仍然停, 而訊息要說對停的理由 —— **一個講錯理由的紅, 會被下一個人用錯的方式修掉。**
        assert c == 1, ('🔴 目標行裡值域出現 %d 次(應為 1)⇒ 我只會改第一處, '
                        '而「第一處」不是我挑的 ⇒ 這一發突變的受詞會變成碰巧的' % c)
        out.append(l.replace(domain, first, 1)); lines_hit += 1; repl += 1
    else:
        out.append(l)
assert lines_hit == 4, '🔴 命中 %d 行(應為 4)' % lines_hit
assert repl == 4, '🔴 實際取代 %d 處(應為 4)' % repl
s = '\n'.join(out)
sys.stdout.write(s)
PY
test -s "$D/mut1.sql" || { echo "🔴 突變檔是空的"; exit 1; }
cmp -s "$MIG" "$D/mut1.sql" && { echo "🔴 突變檔與原檔逐字相同 ⇒ 這一發沒有突變到任何東西"; exit 1; }
Q -f "$D/mut1.sql" > "$D/mut1.log" 2>&1; RC1=$?
chk_ne "格11 🧬 只列 manual_phone ⇒ 貼上去 rc" "$RC1" 0
if grep -qF '自證②' "$D/mut1.log"; then chk "格11b 🧬 而它紅在【自證②】那一句" yes yes
else chk "格11b 🧬 而它紅在【自證②】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut1.log" | sed 's/^/     實際: /'; fi

# 🧬 把那整段 AND 拿掉 ⇒ 自證① 要紅
reset_views
python3 - "$MIG" > "$D/mut2.sql" <<'PY'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r"\n  AND \(\n(?:.*?\n)*?      \)(?=;|\n)", "", s)
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

# 🔴 codex ④ 推翻了「不動 unpaid_cancelled」那個決定 ⇒ 它現在【也要】被改到。
#    ⛔ ~~格15 原本斷言它【不得】有 manual_ 字面~~ —— 那一格在決定翻轉之後就反了。
#    📌 一格照著【當時的決定】寫死的斷言, 在決定被推翻的那一刻會變成一個【擋住正確修法】的東西。
reset_views
Q -f "$MIG" > /dev/null 2>&1
chk "格15 🔴 unpaid_cancelled 的定義裡【也要】有那個述詞(codex ④ 推翻了原本的決定)" \
  "$(QV -Atc "SELECT pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true) LIKE '%manual_%'")" t

# 🔴🔴 codex ② 的 fail 方向 —— 而我量到那個世界【今天到不了】,所以這一格改成量它為什麼到不了。
#    `orders.order_source` 是 **NOT NULL**(fixture 與正式庫都是)⇒ SQL 這一層永遠拿不到 NULL。
#    ⇒ 📌 那條 `o.order_source IS NULL` 是**防禦性的**:它讓兩層在【原則上】一致,
#       而它今天**不會被走到**。⚠️ 有人拿掉那個 NOT NULL 的那一天,它才開始承重。
#    🔵 而 TS 那半的 `null` 是**另一件事** —— 那是「adapter 沒把那一欄撈回來」,
#       不是「資料庫裡那一格是空的」。**同一個字, 兩層不同的意思。**
NN=$(QV -Atc "SELECT attnotnull FROM pg_attribute
              WHERE attrelid='public.orders'::regclass AND attname='order_source'")
chk "格16 🔴 order_source 是 NOT NULL ⇒ SQL 那條 IS NULL 今天到不了(它是防禦, 不是死碼)" "$NN" t
chk "格16b 🔵 而那條防禦【在檔案裡】(拿掉 NOT NULL 的那天它才承重)" \
  "$(grep -c '^        o.order_source IS NULL$' "$MIG")" 4

# 🔴 codex ⑤:被排除的那些單要【數得到】
# 🔴🔴 codex R2 ①:伴生 view 改成【與四支 pending 的其餘述詞同形】之後,
#    它的一列 = **一個本來會發生的通知**, 不再是「一張單」。
#    ⛔ ~~原本這一格期望 2(M1/M3 兩張單)~~ ⇒ ✅ **3** —— 而多的那一列不是 bug:
#    M1 在 fixture 裡**有一批出貨** ⇒ 它同時會被 `order_created` 與 `order_shipped` 兩支收
#    ⇒ 被本片拿掉的是【兩個通知】。📌 **兩張單 / 三個通知 —— 這一格量的是後者。**
chk "格17 🔴 伴生 view 數得到【被拿掉的通知】(M1 兩個 + M3 一個)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_manual_no_email_excluded')" 3
chk "格17b 🔵 而【單】只有兩張(surface 那一欄才是它多出來的維度)" \
  "$(QV -Atc 'SELECT count(DISTINCT order_id) FROM public.pcm_manual_no_email_excluded')" 2
chk "格17c 🔴 M1 那張要同時出現在兩支掃描面上(少一支 = 少統計一個通知)" \
  "$(QV -Atc "SELECT string_agg(surface, ',' ORDER BY surface)
                FROM public.pcm_manual_no_email_excluded WHERE display_id='M1'")" \
  "order_created,order_shipped"
# 🔵 負對照:一個不存在的 surface 值域 ⇒ 必須 0(否則上面三格對任何字面都印命中)
# 🔴🔴 codex R2 ① 的那一格:本來就不在掃描面上的單, 不得被算成「被我們排除掉的」。
#    🛑 ⛔ ~~舊版伴生 view 只判「手動 + 留白」~~ ⇒ M4 會被它算進去 ⇒ **統計虛高**。
#    ⇒ 這一格是那個修法【唯一】會印不同答案的地方。
chk "格17e 🔴 M4(手動留白, 而未付款也沒取消)【不得】出現 —— 它本來就不在掃描面上" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_manual_no_email_excluded WHERE display_id='M4'")" 0
chk "格17f 🟢 正對照:同一把尺對【真的被拿掉的】那張要數得到(否則格17e 的 0 沒有意義)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_manual_no_email_excluded WHERE display_id='M3'")" 1
chk "格17d 🔵 負對照:一個現造的 surface ⇒ 0" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_manual_no_email_excluded WHERE surface='zzz_never_a_surface'")" 0
chk "格18 🔵 而顧客站留白的那張【不在】它裡面(它不是「所有留白的單」)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_manual_no_email_excluded WHERE display_id='W1'")" 0
chk "格19 🔴 伴生 view 對 anon 不得可讀" \
  "$(QV -Atc "SELECT has_any_column_privilege('anon','public.pcm_manual_no_email_excluded','SELECT')")" f

if [ "$FAILED" -eq 0 ]; then echo "🟢 全部通過(格數當場數:上面的 ✅ 行)"; exit 0; fi
echo "🔴 有 $FAILED 格不符預期 ⇒ 本探針判 FAIL"; exit 1
