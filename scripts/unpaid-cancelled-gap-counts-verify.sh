#!/usr/bin/env bash
# unpaid-cancelled-gap-counts-verify.sh
#   在【拋棄式 PG】上驗 `20260903070000_m4b_e4_unpaid_cancelled_gap_counts.sql` 的**行為**。
#
# 🔴🔴 **為什麼一定要有它 —— 而理由是我當場量到的, 不是推論**:
#    那支 migration 自己的斷言(收權 / 形狀自檢 / NULL 負對照)驗的是【定義】。
#    2026-09-03 我把 `no_recipient_count` 改成 `0 * count(*)` 造了一個突變體 ⇒
#      **`migration apply rc=0`, 函式回 `0`** ⇒ 📌 **它自己的斷言【殺不掉】這一發。**
#    ⇒ 而 `0` 正是「一切正常」的樣子 ⇒ 一支恆回 0 的告警函式會全綠上線、每天安靜。
#    ⇒ ✅ **所以那個保護只能住在這裡** —— 一個真的把單塞進去、再問它數幾筆的地方。
#
# 🛑 天花板(寫出來, 免得被讀成「這支綠了就沒事」):
#   · **本機拋棄式庫** ⇒ 證不出正式庫的行為(那裡可能有我們不知道的觸發器 / RLS / 殘留約束)。
#   · 它驗的是【這支函式數得對不對】—— **不驗** adapter 有沒有讀它、也不驗它有沒有進 shouldAlert。
#     那兩層各自帶自己的 TS 測試。
#   · 🔴 **REVOKE 那兩道在這裡結構上量不到判別力** —— 拋棄式 PG 的 `anon` 只經 PUBLIC 拿權限
#     ⇒ 第一道就蓋掉它了 ⇒ 拿掉第二道也殺不掉。**那不是「第二道多餘」**,
#     Supabase 正式庫有【直接授權給具名角色】那一層。⇒ 這一格本檔**不宣稱**驗過。
#
# 用法:bash scripts/unpaid-cancelled-gap-counts-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL(工具或檔案不在, 不是碼的問題)/ 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260903070000_m4b_e4_unpaid_cancelled_gap_counts.sql"
HELPER_SRC="$REPO/supabase/migrations/20260901070000_m4b_e4_js_trim_ws_single_source.sql"

for f in "$M" "$HELPER_SRC"; do
  [ -f "$f" ] || { echo "🔴 ENV-FAIL:找不到 $f ⇒ 這不是量測結果"; exit 2; }
done
command -v initdb >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:沒有 initdb"; exit 2; }

D=$(mktemp -d "${TMPDIR:-/tmp}/ucgc.XXXXXXXX") || { echo "🔴 建不出暫存目錄(mktemp)⇒ 不是量測結果也不是乾淨 ⇒ exit 9"; exit 9; }
PG=54391
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT

lsof -nP -iTCP:$PG -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 ENV-FAIL:埠 $PG 已被佔用"; exit 2; }

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/pg" > "$D/initdb.log" 2>&1 || { echo "🔴 ENV-FAIL:initdb 失敗"; tail -5 "$D/initdb.log"; exit 2; }
LC_ALL=C pg_ctl -D "$D/pg" -o "-p $PG -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1
sleep 3
psql -h 127.0.0.1 -p $PG -U postgres -tAc "select 1" >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:PG 起不來"; tail -6 "$D/pg.log"; exit 2; }

q(){ psql -h 127.0.0.1 -p $PG -U postgres -tAc "$1" 2>&1; }
rc=0
check(){ # check <標籤> <期望> <實得>
  printf '  %-46s 期望 %-4s 實得 %-4s ' "$1" "$2" "$3"
  if [ "$2" = "$3" ]; then echo "✅"; else echo "🔴"; rc=1; fi
}

# 🔴 helper **機械抽取**, 不手抄 —— 手抄會引入第三份空白定義,
#    而 `20260901070000` 那片的產出逐字是「解法不是加寬那一份, 是讓只剩一份」。
python3 - "$HELPER_SRC" "$D/helper.sql" <<'PYEOF'
import io,sys
src=io.open(sys.argv[1],encoding='utf-8').read()
i=src.index('CREATE FUNCTION public.pcm_js_trim_whitespace()')
j=src.index('ALTER FUNCTION public.pcm_js_trim_whitespace() OWNER TO postgres;')
b=src[i:j]
k=b.find('COMMENT ON FUNCTION')
if k>0: b=b[:k]
io.open(sys.argv[2],'w',encoding='utf-8').write(b+'\n')
PYEOF
[ -s "$D/helper.sql" ] || { echo "🔴 ENV-FAIL:helper 抽出來是空的(上游檔的形狀變了?)⇒ 停"; exit 2; }

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q >"$D/world.log" 2>&1 <<'SQLEOF'
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE payment_confirmer NOLOGIN;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','refunded');
CREATE TABLE public.customers (user_id text PRIMARY KEY, email text);
CREATE TABLE public.orders (
  id text PRIMARY KEY, customer_user_id text,
  payment_status public.payment_status NOT NULL,
  cancelled_at timestamptz, cancelled_reason text, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), notification_email text);
CREATE TABLE public.order_cancellations (id bigserial PRIMARY KEY, order_id text NOT NULL);
CREATE TABLE public.email_outbox (id bigserial PRIMARY KEY, order_id text NOT NULL, event_type text NOT NULL);
SQLEOF
[ $? -eq 0 ] || { echo "🔴 ENV-FAIL:建世界失敗"; tail -5 "$D/world.log"; exit 2; }
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$D/helper.sql" >>"$D/world.log" 2>&1 || { echo "🔴 ENV-FAIL:helper 建不起來"; tail -5 "$D/world.log"; exit 2; }

echo "── ① 本尊 apply(它自己的三道斷言在這一步跑)──"
if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$M" >"$D/apply.log" 2>&1; then
  echo "  ✅ apply rc=0"
else
  echo "  🔴 apply 失敗:"; tail -8 "$D/apply.log"; exit 1
fi

echo "── ② 六個世界(每一格都要答得出【為什麼是那個數】)──"
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q >>"$D/world.log" 2>&1 <<'SQLEOF'
INSERT INTO public.customers(user_id,email) VALUES
 ('u_empty', NULL), ('u_ws', E'　'), ('u_real','real@example.com');
INSERT INTO public.orders(id,customer_user_id,payment_status,cancelled_at,created_at,notification_email) VALUES
 ('A','u_empty','unpaid', now()-interval '1 h', now()-interval '2 h', NULL),
 ('B','u_real', 'unpaid', now()-interval '1 h', now()-interval '2 h', NULL),
 ('C','u_empty','unpaid', now()-interval '1 h', now()-interval '2 h', NULL),
 ('D','u_empty','paid',   NULL,                 now()-interval '2 h', NULL),
 ('E','u_empty','unpaid', now()-interval '1 h', now()-interval '2 h', NULL),
 ('F','u_ws',   'unpaid', now()-interval '1 h', now()-interval '2 h', E'　'),
 -- 🔴🔴 **cutoff 的對照組(codex 2026-09-03 must-fix)** —— 我第一版六筆【全都在 cutoff 之內】
 --   ⇒ 把 `cancelled_at >= p_cutoff` 或 `created_at >= p_cutoff` 整條刪掉, **每一格照樣印綠**
 --   ⇒ 📌 那兩道閘在我的 harness 裡【結構上沒有被量到】, 而我以為我驗過了。
 --   G:兩個時刻都在 cutoff 之外(30 天前)⇒ 兩道閘任一還在, 它就不該被算進去。
 ('G','u_empty','unpaid', now()-interval '30 d', now()-interval '31 d', NULL),
 -- H:**建立在 cutoff 之前、取消在 cutoff 之後** ⇒ 只有 `created_at` 那道閘擋得住它。
 --   🛑 它今天被排除, 而**那一格與本 repo 的 port 契約【不一致】** ——
 --     `IUnpaidCancelledOrderScanner` 逐字只說「只看這個時點之後【被取消】的單」。
 --   ⇒ 本 harness **釘住現況(排除)**, 而那個不一致是一題要人拍板的事, 不是這支腳本的判斷。
 ('H','u_empty','unpaid', now()-interval '1 h', now()-interval '31 d', NULL),
 -- 🔴🔴 **X = 一列【不可能的資料】:取消在建立【之前】。**
 --   為什麼要造一列現實裡不存在的東西:因為在現實的不變式(cancelled_at >= created_at)之下,
 --   `created_at >= p_cutoff` 成立就**蘊含** `cancelled_at >= p_cutoff`
 --   ⇒ 📌 **那道 `cancelled_at` 閘在任何一列【合法資料】上都隔離不出來。**
 --   ⇒ ⇒ 🛑 而我第一版就是這樣:我加了 G 以為在量它, 實測拿掉那道閘 pending **還是 3**
 --        —— **一個我以為在量、而結構上量不到的東西。**
 ('X','u_empty','unpaid', now()-interval '30 d', now()-interval '2 h',  NULL);
INSERT INTO public.order_cancellations(order_id) VALUES ('A'),('B'),('C'),('D'),('F'),('G'),('H'),('X');
INSERT INTO public.email_outbox(order_id,event_type) VALUES ('C','order_unpaid_cancelled');
SQLEOF
J="public.get_order_unpaid_cancelled_gap_counts(now()-interval '1 day')"
# A 卡住無信箱 · B 卡住【有】信箱 · F 卡住而信箱是全形空白 ⇒ pending = A,B,F = 3
check "pending_count(A,B,F;C已排信 D已付款 E無取消列)" 3 "$(q "select ($J)->>'pending_count'")"
# 🔴 主詞:只有 A 與 F ⇒ 2。**B 被排除是【正對照】** —— 它證這把尺沒有多抓。
check "no_recipient_count(只有 A 與 F)"                2 "$(q "select ($J)->>'no_recipient_count'")"
check "orders_total_count(分母;含 G/H/X)"             9 "$(q "select ($J)->>'orders_total_count'")"

echo "── ②b 兩道 cutoff 閘:哪一道被量到了, 哪一道【結構上量不到】──"
# 🔴🔴 **這一節講的是【本 harness 的效度】, 不是函式對不對。**
#   `created_at >= p_cutoff`:H(建立在窗外、取消在窗內)隔離得出來
#     ⇒ 實測拿掉它 ⇒ pending 3 ⇒ **4** ⇒ 上面那格會紅。✅ **量得到。**
#   `cancelled_at >= p_cutoff`:在合法資料上**隔離不出來**(created_at 那道已經蘊含它)
#     ⇒ 實測拿掉它、只用 A-H ⇒ pending **仍是 3** ⇒ 🛑 **殺不掉。**
#     ⇒ 只有 X(取消早於建立 = 不可能的資料)隔離得出來:本尊 0 / 拿掉那道閘 1。
#   📌 ⇒ 所以下面這一格證的是「**那道閘真的會動**」, 而**不是**「它在生產上有判別力」。
#      🎯 而它沒有判別力這件事本身是個發現 —— 見交件說明的 MF3。
check "X(不可能的列)被 cancelled_at 那道閘擋掉"      0 "$(q "select ($J)->>'pending_count'" >/dev/null; q "select count(*) from public.orders o left join public.customers c on c.user_id=o.customer_user_id where o.id='X' and o.cancelled_at >= now()-interval '1 day'")"

echo "── ③ 逐格拆開:每個排除各自成立嗎(總數對可能是兩個錯互相抵銷)──"
check "E 被排除 = 身分判準(沒有 order_cancellations 列)" 0 "$(q "select count(*) from public.orders o where o.id='E' and exists(select 1 from public.order_cancellations c where c.order_id=o.id)")"
check "F 被算進去 = 全形空白真的被判為空"                1 "$(q "select count(*) from public.orders o left join public.customers c on c.user_id=o.customer_user_id where o.id='F' and nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()),'') is null and nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()),'') is null")"

echo "── ④ 突變:把 no_recipient_count 換成恆回 0 ⇒ 這一格【必須】紅 ──"
sed -e "s/get_order_unpaid_cancelled_gap_counts/get_mut_zero_gap_counts/g" \
    -e "s/'no_recipient_count',\$/'no_recipient_count',/" "$M" \
  | python3 -c "
import sys
t=sys.stdin.read()
a=\"'no_recipient_count',\n      (SELECT pg_catalog.count(*)\"
b=\"'no_recipient_count',\n      (SELECT 0 * pg_catalog.count(*)\"
assert t.count(a)==1, 'MUT-ANCHOR-FAIL'
sys.stdout.write(t.replace(a,b))
" > "$D/mut.sql" || { echo "  🔴 ENV-FAIL:造不出突變體(anchor 對不上 ⇒ 本檔已與 migration 脫節)"; exit 2; }
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$D/mut.sql" >"$D/mut.log" 2>&1
_mut_apply=$?
printf '  %-46s ' "突變體自己 apply 得過嗎(記錄用, 不判分)"
[ "$_mut_apply" = "0" ] && echo "是 —— 📌 這正是本檔存在的理由" || echo "否"
_mut_val=$(q "select (public.get_mut_zero_gap_counts(now()-interval '1 day'))->>'no_recipient_count'")
printf '  %-46s ' "突變體回的 no_recipient_count"
if [ "$_mut_val" = "0" ]; then
  echo "0 ⇒ ✅ 而本尊回 2 ⇒ **這支 harness 殺得掉它**"
else
  echo "$_mut_val ⇒ 🔴 突變沒有落在目標上(它應該恆回 0)⇒ 本格無效"; rc=1
fi

echo
if [ "$rc" = "0" ]; then echo "✅ 全綠 —— 而它證的是【這支函式數得對】, 不證 adapter 讀了它、也不證它會叫。"
else echo "🔴 有格子不如預期 —— 上面標 🔴 的那幾格。"; fi
exit $rc
