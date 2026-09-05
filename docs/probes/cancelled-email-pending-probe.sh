#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# cancelled-email-pending-probe.sh
#   ⟦b4-CANCELEMAIL⟧ 取消信掃描面(20260905310000)探針:拋棄式 PG, 雙向。
#
# 🛑🛑 **它【證不到】什麼(先讀這段, 它決定下面每一格能不能當結論)**:
#   · fixture 是**最小可跑**的世界, 不是正式庫的 schema ⇒ 它答得出「述詞篩對了嗎」,
#     答不出「正式庫那些欄位的實際內容會不會讓它篩錯」。
#   · 它不驗「信真的寄出去了」—— 那是 sweep 那一半, 本片沒動。
#   · 🔴 它**不驗 RLS** —— 本機建的表沒有 Supabase 的預設授權形狀。
set -u
export LC_ALL=C LANG=C
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="${1:-$REPO_ROOT/supabase/migrations/20260905310000_m4b_cancelled_email_pending_view.sql}"
test -f "$MIG" || { echo "🔴 找不到受測 migration:$MIG"; exit 1; }

pick() {
  if command -v "$1" > /dev/null 2>&1; then printf '%s' "$1"
  elif [ -x "/opt/homebrew/bin/$1" ]; then printf '%s' "/opt/homebrew/bin/$1"
  else echo "🔴 找不到 $1 ⇒ 沒有跑, 不是通過" >&2; exit 1
  fi
}
INITDB=$(pick initdb) || exit 1
PG_CTL=$(pick pg_ctl) || exit 1
PSQL=$(pick psql)     || exit 1

D=$(mktemp -d); P="${PGPORT_PROBE:-54343}"
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

# ── fixture:🔴 ACL 形狀照正式庫(新物件出生自帶 anon 權限, 本地預設不同)──
Q <<'SQL' > /dev/null
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TYPE payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.customers (user_id uuid PRIMARY KEY, email text);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  total integer NOT NULL DEFAULT 5000,
  display_id text,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz DEFAULT now(),
  notification_email text,
  customer_user_id uuid REFERENCES public.customers(user_id),
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  payment_channel text NOT NULL DEFAULT 'tappay',
  -- 🔴 **實際怎麼收的** —— 本 view 讀的是這一欄, 不是上面那個(codex R2 ④)。
  --    建表 `20260604120000:109` 它是 **nullable** ⇒ fixture 也要留得住 NULL 那個世界(格4c)。
  payment_method text DEFAULT 'tappay',
  order_source text NOT NULL DEFAULT 'web');
CREATE TABLE public.email_outbox (order_id uuid, event_type text);
CREATE TABLE public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid, refund_amount bigint, status text, failed_reason text);
CREATE TABLE public.order_manual_refunds (order_id uuid, refund_amount bigint, voided_at timestamptz);
CREATE TABLE public.order_cancellations (order_id uuid);
-- 🔴 更正判定:正式庫那張是 view, 這裡用最小形狀的表 —— 本探針要問的是
--    「被更正成 money_moved 的那一筆有沒有被算進去」, 不是「那張 view 自己怎麼算」。
CREATE TABLE public.order_refund_effective_verdict (refund_id uuid, corrected_to text);
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT E' \t\n\r' $$;
REVOKE EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;
-- 🔴🔴 **底表也要授權給 service_role**(codex R1 ⑥)——
--   ⛔ ~~原本只有權限【位元】那三格(has_any_column_privilege)~~
--   🛑 `security_invoker = true` 的 view **用呼叫者的權限去讀底表** ⇒ 位元對而底表沒授權
--     ⇒ 真的 `SET ROLE service_role; SELECT ...` 會被拒, **而那三格照樣印 t/f/f 全綠。**
--   ⇒ 📌 一個「有沒有權限」的位元, 答不出「叫得動嗎」。下面格14b 真的叫一次。
GRANT SELECT ON public.orders, public.customers, public.email_outbox,
                public.order_refunds, public.order_manual_refunds,
                public.order_refund_effective_verdict TO service_role;
SQL

# ── 🔴 四個世界(codex/主視窗指定):各造一張單 ────────────────
Q <<'SQL' > /dev/null
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-0000000000c1','c1@x.test');
INSERT INTO public.orders (id,display_id,cancelled_at,notification_email,customer_user_id,payment_status,payment_channel,order_source)
VALUES
 ('00000000-0000-0000-0000-000000000001','W1',now(),NULL,'00000000-0000-0000-0000-0000000000c1','refunded','tappay','web'),
 ('00000000-0000-0000-0000-000000000002','W2',now(),NULL,'00000000-0000-0000-0000-0000000000c1','partiallyRefunded','tappay','web'),
 ('00000000-0000-0000-0000-000000000003','W3',now(),NULL,'00000000-0000-0000-0000-0000000000c1','refunded','bank_transfer','web'),
 ('00000000-0000-0000-0000-000000000004','W4',NULL,NULL,'00000000-0000-0000-0000-0000000000c1','refunded','tappay','web');
-- 🔴 W3 是匯款單 ⇒ 它的【實際付款方式】也要是匯款, 否則格4 量到的是 channel 不是 method。
UPDATE public.orders SET payment_method='bank_transfer' WHERE display_id='W3';
-- 🔴🔴 **W6 = codex R2 ④ 的那個世界**:建單時打算刷卡(channel=tappay), 客人**實際付現金**。
--   舊版述詞讀 channel ⇒ 它會被掃進來 ⇒ 信說「全額退回原付款方式」而那張卡從來沒被扣過。
INSERT INTO public.orders (id,display_id,cancelled_at,notification_email,customer_user_id,payment_status,payment_channel,payment_method,order_source)
VALUES ('00000000-0000-0000-0000-000000000006','W6',now(),NULL,'00000000-0000-0000-0000-0000000000c1','refunded','tappay','cash','web');
-- 🔴 W7 = `payment_method` **是 NULL** 的舊單 ⇒ 掉出掃描面(fail-closed 那一半, 要有格在量)
INSERT INTO public.orders (id,display_id,cancelled_at,notification_email,customer_user_id,payment_status,payment_channel,payment_method,order_source)
VALUES ('00000000-0000-0000-0000-000000000007','W7',now(),NULL,'00000000-0000-0000-0000-0000000000c1','refunded','tappay',NULL,'web');
INSERT INTO public.order_refunds (order_id,refund_amount,status) VALUES
 ('00000000-0000-0000-0000-000000000006',5000,'confirmed'),
 ('00000000-0000-0000-0000-000000000007',5000,'confirmed');
-- 🔴🔴 **W5:兩個信箱都空的一張單**(codex R1 ⑧)——
--   ⛔ ~~原本每一張 fixture 都掛在同一個【有信箱】的客人身上~~
--   🛑 ⇒ 把 view 那條收件人述詞**整段刪掉, 每一格照樣綠** —— 沒有任何一格在量它。
--   🔴 而它漏掉的後果是具體的:50 張沒有信箱的舊單**每一輪都被撈進同一批**、
--     每一輪都 noRecipient ⇒ 它們**永遠佔著那 50 個名額** ⇒ 後面真的該寄的信餓死。
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-0000000000c2', NULL);
INSERT INTO public.orders (id,display_id,cancelled_at,notification_email,customer_user_id,payment_status,payment_channel,order_source)
VALUES ('00000000-0000-0000-0000-000000000005','W5',now(),NULL,'00000000-0000-0000-0000-0000000000c2','refunded','tappay','web');
INSERT INTO public.order_refunds (order_id,refund_amount,status)
VALUES ('00000000-0000-0000-0000-000000000005',5000,'confirmed');
SQL

# 🔴 退款 fixture:W1 退滿 5000(= total)⇒ 全額;而金額那兩格在下面
Q -c "INSERT INTO public.order_refunds (order_id,refund_amount,status) VALUES ('00000000-0000-0000-0000-000000000001',5000,'confirmed');" > /dev/null

Q -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
chk "格1 貼上去 rc" "$RC" 0
[ "$RC" -ne 0 ] && sed -n '1,6p' "$D/apply.log"

chk "格2 🔴 W1(刷卡 + 全額退款 + 已取消)⇒ 在掃描面上" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 1
chk "格3 🔴 W2(partiallyRefunded)⇒ 不在 —— 部分退款不在射程內" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W2'")" 0
chk "格4 🔴 W3(匯款單)⇒ 不在 —— 射程只有刷卡" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W3'")" 0
chk "格5 🔴 W4(沒取消)⇒ 不在" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W4'")" 0
# 🔴🔴 codex R2 ④:預期軸 vs 事實軸
chk "格4b 🔴🔴 W6(打算刷卡而【實際付現金】)⇒ 不在 —— 讀 payment_method 不讀 payment_channel" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W6'")" 0
chk "格4c 🔴 W7(payment_method 是 NULL 的舊單)⇒ 不在(fail-closed:寧可不寄)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W7'")" 0
chk "格6 🟢 總數 = 1(證明上面三個 0 不是整支 view 空的)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_cancelled_email_pending')" 1

# ── 🔴🔴 金額:**回到那張卡的錢**(主視窗 2026-09-05 改裁甲)──
#   ⛔ ~~原本這一族量的是「卡 + 人工的和」(對齊狀態機的 v_moved)~~
#   🛑 codex R1 ③:總額 5000、卡退 4000、人工現金退 1000 ⇒ 和 = 5000 ⇒ 判成 full
#     ⇒ 信說「全額退回原付款方式」+ 印 5000, **而那張卡只回了 4000**。
chk "格6b 🔴 退款金額印得出來(卡上 confirmed 的 5000)" \
  "$(QV -Atc "SELECT refunded_amount FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 5000
chk "格6c 🔴 refund_kind 是算出來的 'full'(卡上退滿 ⇒ full)" \
  "$(QV -Atc "SELECT refund_kind FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" full

# 🔴🔴 有未作廢的人工退款 ⇒ **整張不寄**(混合軌;與下面格6f 同一條述詞, 這格量的是「一塊錢也算」)
Q -c "INSERT INTO public.order_manual_refunds VALUES ('00000000-0000-0000-0000-000000000001',300,NULL);" > /dev/null
chk "格6d 🔴 只要有一筆未作廢的人工退款(300 元)⇒ 整張離開掃描面" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 0
Q -c "DELETE FROM public.order_manual_refunds;" > /dev/null

# 🔴🔴 **混合退款(卡 4000 + 現金 1000 = 總額)⇒ 整張不寄**(主視窗 2026-09-05 裁 Q2 乙)
#   ⛔ ~~上一版這兩格斷言它【在】掃描面上而 kind='partial'~~
#   🛑 而 'partial' ⇒ 模板那句與那個數字**都不印** ⇒ 客人收到一封**完全沒提到退款**的取消信,
#     而 outbox anti-join ⇒ 日後卡上補退滿也不會再寄。⇒ 裁示改成整張不寄, 等人工。
Q -c "UPDATE public.order_refunds SET refund_amount=4000 WHERE order_id='00000000-0000-0000-0000-000000000001';
      INSERT INTO public.order_manual_refunds VALUES ('00000000-0000-0000-0000-000000000001',1000,NULL);" > /dev/null
chk "格6f 🔴🔴 混合退款(卡 4000 + 現金 1000)⇒ 【整張離開掃描面】, 不寄" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 0
Q -c "UPDATE public.order_manual_refunds SET voided_at = now();" > /dev/null
chk "格6g 🟢 正對照:那筆人工退款【作廢】⇒ 同一張單回到掃描面(證明是那條述詞在做事)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 1
chk "格6g2 🔴 而它此時 kind='partial'(卡上只退 4000)⇒ 模板那句與那個數字都不印" \
  "$(QV -Atc "SELECT refund_kind FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" partial
Q -c "DELETE FROM public.order_manual_refunds;
      UPDATE public.order_refunds SET refund_amount=5000 WHERE order_id='00000000-0000-0000-0000-000000000001';" > /dev/null

# 🔴🔴 `processing` **不算** —— 送出去了還沒確認到帳, 算它等於替沒動的錢背書
Q -c "INSERT INTO public.order_refunds (order_id,refund_amount,status) VALUES ('00000000-0000-0000-0000-000000000001',700,'processing');" > /dev/null
chk "格6h 🔴 status='processing' 的那筆【不算】(仍是 5000)" \
  "$(QV -Atc "SELECT refunded_amount FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 5000
Q -c "DELETE FROM public.order_refunds WHERE status='processing';" > /dev/null

# 🔴🔴 codex R1 ④:標成 failed/manual_failed 而**被更正成 money_moved** ⇒ 錢真的動了 ⇒ 要算
Q -c "INSERT INTO public.order_refunds (id,order_id,refund_amount,status,failed_reason)
      VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001',800,'failed','manual_failed');" > /dev/null
chk "格6i 🔴 failed 而【還沒被更正】⇒ 不算(仍是 5000)" \
  "$(QV -Atc "SELECT refunded_amount FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 5000
Q -c "INSERT INTO public.order_refund_effective_verdict VALUES ('00000000-0000-0000-0000-0000000000f1','money_moved');" > /dev/null
chk "格6j 🔴🔴 同一筆被更正成 money_moved ⇒ 算進去(5800)—— 少了它會【少報給客人】" \
  "$(QV -Atc "SELECT refunded_amount FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 5800
Q -c "UPDATE public.order_refund_effective_verdict SET corrected_to='not_moved';" > /dev/null
chk "格6k 🟢 更正成【錢沒動】⇒ 又不算了(回 5000)—— 證明它看的是那個值不是那張表" \
  "$(QV -Atc "SELECT refunded_amount FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 5000
Q -c "DELETE FROM public.order_refund_effective_verdict;
      DELETE FROM public.order_refunds WHERE status='failed';" > /dev/null

# 🔴🔴 W5:兩個信箱都空 ⇒ 不在掃描面(codex R1 ⑧;突變那一層會把這條述詞拿掉)
chk "格6m 🔴 W5(兩個信箱都空)⇒ 不在掃描面" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W5'")" 0

# ── 🔴🔴 這一格是 -d8 提醒的那個:mark 那條路不寫取消帳本 ──
Q -c "DELETE FROM public.order_cancellations;" > /dev/null
chk "格7 🔴🔴 取消帳本【空的】而 W1 仍在掃描面上(mark RPC 不寫那張表)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 1

# ── 已寄過就離開掃描面 ──
Q -c "INSERT INTO public.email_outbox VALUES ('00000000-0000-0000-0000-000000000001','order_cancelled');" > /dev/null
chk "格8 🔴 已經有 order_cancelled 的 outbox 列 ⇒ 離開掃描面" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 0
Q -c "DELETE FROM public.email_outbox; INSERT INTO public.email_outbox VALUES ('00000000-0000-0000-0000-000000000001','order_created');" > /dev/null
chk "格9 🟢 正對照:別的事件的 outbox 列【不算】(否則寄過建單信就不寄取消信)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 1

# ── 手動留白那條規矩 ──
Q -c "DELETE FROM public.email_outbox;
      UPDATE public.orders SET order_source='manual_phone' WHERE display_id='W1';" > /dev/null
chk "格10 🔴 手動建單 + 通知信箱留白 ⇒ 離開掃描面(與另外四支同一條規矩)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 0
Q -c "UPDATE public.orders SET notification_email='staff@x.test' WHERE display_id='W1';" > /dev/null
chk "格11 🟢 正對照:同一張單【填了信箱】⇒ 回到掃描面(證明尺會動)" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W1'")" 1
Q -c "UPDATE public.orders SET order_source='web', notification_email=NULL WHERE display_id='W1';" > /dev/null

# ── ACL ──
chk "格12 🔴 anon 讀不到(它含兩個 email 欄)" \
  "$(QV -Atc "SELECT has_any_column_privilege('anon','public.pcm_cancelled_email_pending','SELECT')")" f
chk "格13 🔴 authenticated 也讀不到" \
  "$(QV -Atc "SELECT has_any_column_privilege('authenticated','public.pcm_cancelled_email_pending','SELECT')")" f
chk "格14 🟢 而 service_role 讀得到(否則建了等於沒建)" \
  "$(QV -Atc "SELECT has_any_column_privilege('service_role','public.pcm_cancelled_email_pending','SELECT')")" t

# 🔴🔴 **格14b:位元對 ≠ 叫得動**(codex R1 ⑥)——
#   `security_invoker = true` ⇒ 這支 view 用**呼叫者**的權限去讀底表與那支函式。
#   ⇒ 上面三格量的是「授權位元」, 而**真的用那個身分查一次**是另一個宣稱。
#   🔬 它雙向:底表少一個 GRANT ⇒ 這一格 rc≠0, 而格12-14 照樣全綠。
Q -c "SET ROLE service_role; SELECT count(*) FROM public.pcm_cancelled_email_pending;" > "$D/asrole.log" 2>&1
chk "格14b 🔴🔴 真的 SET ROLE service_role 查一次 ⇒ rc" "$?" 0
grep -m1 -E '^(psql:)?ERROR' "$D/asrole.log" | sed 's/^/     實際: /'
chk "格14c 🔴 anon 用同一發查 ⇒ 要被拒(它含兩個 email 欄)" \
  "$(Q -c "SET ROLE anon; SELECT count(*) FROM public.pcm_cancelled_email_pending;" > /dev/null 2>&1; echo $?)" 1

# ── 🧬 突變 ─────────────────────────────────────────────────
# 🔴 **兩個物件都要退, 而 view 要先** —— 它依賴那支函式, 反過來 PostgreSQL 會擋(2BP01)。
#    少了第二行 ⇒ 下一發突變在【裸 CREATE FUNCTION 撞名】就紅, 而那不是我們要量的東西。
reset_world() { Q -c "DROP VIEW IF EXISTS public.pcm_cancelled_email_pending;
                      DROP FUNCTION IF EXISTS public.pcm_order_card_refunded(uuid);" > /dev/null; }

# 🔴🔴 **兩層突變 —— 而第一層印的是【自證叫了】, 不是「壞行為出現了」。**
#    我第一版把格15 寫成「W2 會被掃進來」⇒ 它印空字串,而我一開始讀成「量不到」。
#    🔬 真相是:**這支 migration 自己的自證② 擋下了那發突變**(它要求 viewdef 裡有 `refunded`)
#    ⇒ 整筆回滾 ⇒ view 根本沒建出來 ⇒ 查它當然是空的。
#    ⇒ 📌 **一個「壞行為沒出現」的讀數, 有兩種成因:守門擋住了 / 世界沒造出來。**
#       ⇒ ✅ 所以拆成兩層:①先證守門會叫 ②再把守門也拿掉, 證述詞本身在做事。
reset_world
python3 - "$MIG" > "$D/mut1.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
o = "  AND o.payment_status = 'refunded'\n"
assert s.count(o) == 1, ('突變沒落在目標上', s.count(o))
sys.stdout.write(s.replace(o, "  AND o.payment_status <> 'paid'\n", 1))
PY
test -s "$D/mut1.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut1.sql" > "$D/mut1.log" 2>&1; RCM1=$?
chk_ne "格15 🧬 把精確 refunded 換成【不等於 paid】⇒ 貼上去 rc" "$RCM1" 0
if grep -qF '自證②' "$D/mut1.log"; then chk "格15b 🧬 而它紅在【自證②】那一句" yes yes
else chk "格15b 🧬 而它紅在【自證②】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut1.log" | sed 's/^/     實際: /'; fi

# ── 第二層:把自證也拿掉 ⇒ 證那條述詞【自己】在做事 ──
reset_world
python3 - "$MIG" > "$D/mut2.sql" <<'PY'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
o = "  AND o.payment_status = 'refunded'\n"
assert s.count(o) == 1, ('突變沒落在目標上', s.count(o))
s = s.replace(o, "  AND o.payment_status <> 'paid'\n", 1)
# 連自證②那兩格一起拿掉(它們釘的就是被我改掉的那個字面)
i = s.index("  -- ② \U0001F534 射程那四條")
j = s.index("  -- ③ \U0001F534 它【不得】看 order_cancellations")
s = s[:i] + s[j:]
# 🔴 只檢查【會叫的那幾行】 —— 「自證②b」這四個字現在也出現在 view 與函式的說明註解裡,
#    而那些不是斷言。查整份字串會對一段【正確的註解】報「沒拿乾淨」。
assert "RAISE EXCEPTION '自證②" not in s, '自證② 的 RAISE 沒拿乾淨'
sys.stdout.write(s)
PY
test -s "$D/mut2.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut2.sql" > "$D/mut2.log" 2>&1; RCM2=$?
chk "格16 🧬 述詞放寬【且】拿掉自證 ⇒ 這次貼得進去" "$RCM2" 0
chk "格16b 🧬🔴 而 partiallyRefunded 那張【真的被掃進來了】—— 這一格才證那條述詞在做事" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W2'")" 1

reset_world
Q -f "$MIG" > /dev/null 2>&1
chk "格17 🟢 還原後回到 1(證明上面兩發突變是【它們】造成的, 不是世界壞了)" \
  "$(QV -Atc 'SELECT count(*) FROM public.pcm_cancelled_email_pending')" 1

# ── 🔴🔴 第三層突變:把【收件人述詞】整段拿掉 ⇒ W5 要冒出來(codex R1 ⑧)──
#    這一發答的是「那條述詞在不在做事」;沒有 W5 的話它**恆綠**。
reset_world
python3 - "$MIG" > "$D/mut3.sql" <<'PY3'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index("  AND (\n        nullif(pg_catalog.btrim(o.notification_email")
j = s.index("  AND (\n        -- \U0001F534 `NULL NOT IN")
assert i < j, ('兩個錨的順序不對', i, j)
s = s[:i] + s[j:]
sys.stdout.write(s)
PY3
test -s "$D/mut3.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut3.sql" > "$D/mut3.log" 2>&1; RCM3=$?
chk "格19 🧬 拿掉收件人述詞 ⇒ 貼得進去(自證沒有在釘它)" "$RCM3" 0
chk "格19b 🧬🔴 而 W5(兩個信箱都空)【真的被掃進來了】—— 這一格才證那條述詞在做事" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W5'")" 1

reset_world
Q -f "$MIG" > /dev/null 2>&1
chk "格19c 🟢 還原後 W5 又不見了" \
  "$(QV -Atc "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='W5'")" 0

# ── 🧬 自證會不會叫:撞名 ──
Q -f "$MIG" > "$D/dup.log" 2>&1; RC2=$?
chk_ne "格18 🧬 再貼一次 ⇒ 前置閘要擋(裸 CREATE, 不可靜默覆蓋)" "$RC2" 0
if grep -qF '已經存在' "$D/dup.log"; then chk "格18b 🧬 而它紅在【前置閘】那一句" yes yes
else chk "格18b 🧬 而它紅在【前置閘】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/dup.log" | sed 's/^/     實際: /'; fi

if [ "$FAILED" -eq 0 ]; then echo "🟢 全部通過(格數當場數:上面的 ✅ 行)"; exit 0; fi
echo "🔴 有 $FAILED 格不符預期 ⇒ 本探針判 FAIL"; exit 1
