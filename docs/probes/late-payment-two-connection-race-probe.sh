#!/usr/bin/env bash
# ci-self-contained: yes
# late-payment-two-connection-race-probe.sh
#   ⟦b4-NCPCRONRACE⟧ 的【兩連線】世界 —— codex 2026-09-05 R2 must-fix ① 說的那一個。
#
# 🔴🔴 **它要回答的唯一問題**:
#   「取消交易與付款交易【同時在飛】、兩邊都看不到對方」那個 lost-wakeup,
#   **今天重現得出來嗎?**
#
# 🛑 **為什麼要另開一支, 而不是加在單連線那支裡**:
#   單連線那支的 fixture **沒有 order_payments → orders 的 FK**
#   ⇒ 🔴 **它結構上造不出「付款持 KEY SHARE」那個世界** ——
#     而那正是這個問題的樞紐。📌 一個造不出目標世界的探針, 印的綠是誠實的而無用。
#
# ⚠️ **本檔證不到什麼**:
#   ① 排不出時序時, 結論只能是「**我沒造出那個世界**」, 不是「它不存在」。
#   ② fixture 是最小表, 不是正式 schema(但 FK / 部分唯一索引 / CHECK 都帶上了)。
set -u
D=$(mktemp -d); PORT=$((5900 + RANDOM % 300))
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
export LC_ALL=C
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "X initdb 失敗"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c deadlock_timeout=200ms" \
  -l "$D/pg.log" start >/dev/null || { echo "X 起不來"; exit 1; }
FAILED=0; PASSED=0
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@" ; local rc=$?
        [ "$rc" -eq 0 ] || { printf '  FAIL psql rc=%s ⇒ 這一發不算數:%s\n' "$rc" "$*"; FAILED=1; }; return "$rc"; }
q1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "$1"; }
check () { if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
           else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=1; fi; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)

pq -q <<'SQL'
CREATE TABLE public.orders (id uuid PRIMARY KEY, cancelled_at timestamptz);
CREATE TABLE public.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, created_at timestamptz NOT NULL);
-- 🔴🔴 **這個 FK 是本檔的樞紐** —— 它讓 INSERT 對 orders 那一列持有 KEY SHARE。
CREATE TABLE public.order_payments (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  rail text NOT NULL, amount bigint NOT NULL);
CREATE TABLE public.order_manual_refunds (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL, rail text NOT NULL,
  refund_amount bigint NOT NULL, voided_at timestamptz);
CREATE TABLE public.order_pending_refunds (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL, cancellation_id uuid,
  rail text NOT NULL, amount_at_cancel bigint NOT NULL CHECK (amount_at_cancel > 0),
  voided_at timestamptz, settled_at timestamptz, settled_manual_refund_id uuid,
  CHECK ((settled_at IS NULL) = (settled_manual_refund_id IS NULL)));
CREATE UNIQUE INDEX order_pending_refunds_live_order_rail_key
  ON public.order_pending_refunds (order_id, rail)
  WHERE voided_at IS NULL AND settled_at IS NULL;
SQL

awk '/^CREATE FUNCTION public\.pcm_pending_refund_amounts/,/^\$fn\$;$/' \
  "$REPO/supabase/migrations/20260902030000_m4b_crossrail_pending_refund_net.sql" > "$D/a.sql"
awk '/^CREATE FUNCTION public\.pcm_pending_refund_open_for/,/^\$fn\$;$/' \
  "$REPO/supabase/migrations/20260905070000_m4b_pending_refund_on_late_payment.sql" > "$D/b.sql"
for f in a b ; do test -s "$D/$f.sql" || { echo "X 抽不到 $f"; exit 1; }; done
pq -q -f "$D/a.sql" && pq -q -f "$D/b.sql" || exit 1

# 🔵 兩支 trigger:形狀照正式那兩支(付款側含 advisory lock + 條件式 UPDATE orders,
#    因為【鎖序】正是本檔要測的東西)。
pq -q <<'SQL'
CREATE FUNCTION public.tg_pay() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.order_id::text, 0));
  PERFORM public.pcm_pending_refund_open_for(NEW.order_id, false);
  UPDATE public.orders o SET cancelled_at = o.cancelled_at WHERE o.id = NEW.order_id;
  RETURN NULL;
END $t$;
CREATE TRIGGER tg_pay_ai AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_pay();
CREATE FUNCTION public.tg_cancel() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN RETURN NULL; END IF;
  PERFORM public.pcm_pending_refund_open_for(NEW.id);
  RETURN NULL;
END $t$;
CREATE TRIGGER tg_cancel_au AFTER UPDATE OF cancelled_at ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_cancel();
SQL

mk () { # $1 = order id;建一張未取消的單
  pq -q -c "INSERT INTO public.orders VALUES ('$1', NULL);"
}
rows () { q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$1'"; }

echo "── 世界 A(序列):先取消, 後收款 ──"
A=$(q1 "SELECT gen_random_uuid()"); mk "$A"
pq -q -c "UPDATE public.orders SET cancelled_at = now() WHERE id='$A';"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) SELECT '$A', cancelled_at FROM public.orders WHERE id='$A';"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$A','bank_transfer',1000);"
check "格1 序列(取消先) ⇒ 有一列待退款" "1" "$(rows "$A")"

echo "── 世界 B(序列):先收款, 後取消 ──"
B=$(q1 "SELECT gen_random_uuid()"); mk "$B"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$B','bank_transfer',1000);"
pq -q -c "UPDATE public.orders SET cancelled_at = now() WHERE id='$B';"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) SELECT '$B', cancelled_at FROM public.orders WHERE id='$B';"
check "格2 序列(收款先) ⇒ 有一列待退款" "1" "$(rows "$B")"

echo "── 🔴 世界 C(兩連線, 真的同時):付款先開始, 取消中途插進來 ──"
C=$(q1 "SELECT gen_random_uuid()"); mk "$C"
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN;
    INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$C','bank_transfer',1000);
    SELECT pg_sleep(2);
    COMMIT;" > "$D/c-pay.log" 2>&1 ) &
PAY=$!
sleep 0.6
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN;
    UPDATE public.orders SET cancelled_at = now() WHERE id='$C';
    INSERT INTO public.order_cancellations (order_id, created_at)
      SELECT '$C', cancelled_at FROM public.orders WHERE id='$C';
    COMMIT;" > "$D/c-cancel.log" 2>&1 ) &
CAN=$!
wait "$PAY"; wait "$CAN"
DL=$(cat "$D/c-pay.log" "$D/c-cancel.log" | grep -ci 'deadlock' || true)
echo "     (兩條連線的輸出裡 deadlock 字樣:$DL)"
check "格3 🔴 兩連線同時 ⇒ 仍然有一列待退款(= lost-wakeup 沒發生)" "1" "$(rows "$C")"
check "格4 🟢 而且沒有死結" "0" "$DL"

echo "── 🔴 世界 D(兩連線, 反過來):取消先開始, 付款中途插進來 ──"
# 🛑 **少了這一格, 我只造了【一個】時序** —— 而 lost-wakeup 的兩種排法是兩個世界。
G=$(q1 "SELECT gen_random_uuid()"); mk "$G"
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN;
    UPDATE public.orders SET cancelled_at = now() WHERE id='$G';
    INSERT INTO public.order_cancellations (order_id, created_at)
      SELECT '$G', cancelled_at FROM public.orders WHERE id='$G';
    SELECT pg_sleep(2);
    COMMIT;" > "$D/d-cancel.log" 2>&1 ) &
CN2=$!
sleep 0.6
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN;
    INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$G','bank_transfer',1000);
    COMMIT;" > "$D/d-pay.log" 2>&1 ) &
PY2=$!
wait "$CN2"; wait "$PY2"
DLD=$(cat "$D/d-cancel.log" "$D/d-pay.log" | grep -ci 'deadlock' || true)
echo "     (deadlock 字樣:$DLD)"
# 🔴🔴 **這一格斷言的是【現在這個錯的行為】—— 它是缺陷的證據, 不是一個通過的驗收。**
#   為什麼不斷言 1(對的行為):斷言 1 ⇒ 這支探針永遠紅 ⇒ 它會被人關掉,
#   而**被關掉的閘比安靜的漏更難回來**(Sean 2026-09-05 原話, 板列 ⟦b4-STUCKBANKBLINDWINDOW⟧)。
# 🛑 **而它【自己會叫】**:哪天有人把這個洞修好, 這一格會【變紅】並印出下面那句話
#   ⇒ 📌 那不是壞消息, 那是「該來改我了」。⇒ 把期望值改成 1, 並劃掉本段。
# ⏰ 修法在板列 ⟦b4-NCPCRONRACE⟧:事後掃描器(與 ⟦b4-SETTLERETRYNEVER⟧ 同一支)。
check "格3b 🔴【缺陷仍在】反過來的時序 ⇒ 零列待退款(修好之後這格會紅, 那時把期望改成 1)" "0" "$(rows "$G")"
check "格4b 🟢 而且沒有死結" "0" "$DLD"

echo "── 🔴 世界 E:【兩筆併發付款】打同一張已取消的單(戊 的鎖升級風險就在這裡)──"
# 🛑 20260904230000:198 逐字警告「FOR UPDATE 是鎖升級 ⇒ 會死結」。
#    戊 的論證是「advisory L 先排隊 ⇒ 不會兩個同時升級」—— 而那是【推論】, 這一格是它的量測。
H=$(q1 "SELECT gen_random_uuid()"); mk "$H"
pq -q -c "UPDATE public.orders SET cancelled_at = now() WHERE id='$H';"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) SELECT '$H', cancelled_at FROM public.orders WHERE id='$H';"
for i in 1 2 ; do
  ( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
      BEGIN;
      INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$H','bank_transfer',500);
      SELECT pg_sleep(1);
      COMMIT;" > "$D/e-$i.log" 2>&1 ) &
done
wait
DLE=$(cat "$D/e-1.log" "$D/e-2.log" | grep -ci 'deadlock' || true)
check "格6 🔴 兩筆併發付款 ⇒ 【沒有】死結(戊 的鎖升級論證)" "0" "$DLE"
check "格6b 而且兩筆都收進去了" "2" \
  "$(q1 "SELECT count(*)::text FROM public.order_payments WHERE order_id='$H'")"

echo "── ⚪ 死結負對照:把鎖序【故意弄反】⇒ 必須真的看到 deadlock ──"
# 🔴 這一格是本檔的正對照:少了它,「沒死結」與「我沒造出那個世界」印同一個綠。
pq -q -c "CREATE OR REPLACE FUNCTION public.tg_pay() RETURNS trigger LANGUAGE plpgsql AS \$t\$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.order_id::text, 0));
  PERFORM pg_sleep(1);
  UPDATE public.orders o SET cancelled_at = o.cancelled_at WHERE o.id = NEW.order_id;
  RETURN NULL;
END \$t\$;"
E=$(q1 "SELECT gen_random_uuid()"); mk "$E"
F=$(q1 "SELECT gen_random_uuid()"); mk "$F"
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN; UPDATE public.orders SET cancelled_at = now() WHERE id='$E';
    SELECT pg_sleep(1);
    SELECT pg_advisory_xact_lock(hashtextextended('$E'::text, 0));
    COMMIT;" > "$D/d1.log" 2>&1 ) &
X1=$!
sleep 0.2
( psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=0 -c "
    BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('$E'::text, 0));
    SELECT pg_sleep(1);
    UPDATE public.orders SET cancelled_at = now() WHERE id='$E';
    COMMIT;" > "$D/d2.log" 2>&1 ) &
X2=$!
wait "$X1"; wait "$X2"
DL2=$(cat "$D/d1.log" "$D/d2.log" | grep -ci 'deadlock' || true)
check "格5 ⚪ 鎖序弄反 ⇒ 真的看得到 deadlock(證明本檔量得到死結)" "1" "$DL2"

if [ "$FAILED" -ne 0 ]; then echo "X 有格子紅了(見上)"; exit 1; fi
echo "OK 全過:$PASSED 格"
