#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# pending-refund-late-payment-probe.sh
#   ⟦b4-NCPCRONRACE⟧ / migration 20260905070000 的【資料世界】驗證。
#
# 🔴🔴 **這支探針要證的那一件事**:
#   錢比取消【晚】到時, `order_pending_refunds` 上要有對應的一列。
#   而在 20260905070000 之前它【沒有】—— 因為既有那道網掛 `orders` 的 AFTER UPDATE,
#   在取消那一刻算 `order_payments`, 而那時錢還沒到。
#
# 🛑 **本檔【證不到什麼】—— 先讀這段, 不然你會以為跑完就沒事了**:
#   ① 它用的是**最小 fixture 表**, 不是正式 schema ⇒ 它驗的是【函式的行為】,
#      不是「貼進正式庫會不會過」。後者由 20260905070000 自己的六道事後閘驗。
#   ② 它**不驗接線** —— 「重算函式有沒有真的呼叫 open_for」由那支 migration 的
#      事後閘 ②/②b/③/④ 驗(讀 `pg_proc.prosrc`)。
#      ⇒ 📌 **行為在這裡驗, 接線在那裡驗。兩個都要, 而它們是兩個宣稱。**
#   ③ 它**不驗競態本身** —— 真正的並行時序要兩條連線;本檔用【呼叫順序】模擬那個世界。
set -u
D=$(mktemp -d); PORT=$((5600 + RANDOM % 300))
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
export LC_ALL=C
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 \
  || { echo "X initdb 失敗"; tail -5 "$D/initdb.log"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null || { echo "X 起不來"; tail -5 "$D/pg.log"; exit 1; }
# 🔴🔴 **每一發 pq 都要檢查 rc**(codex 2026-09-05 R1 must-fix ⑥)——
#   ⛔ ~~我第一版只有 `set -u`, 而多數 pq 呼叫的回傳碼沒有被看~~
#   ⇒ 🛑 **中途真的發生 SQL ERROR 時, 探針可能照樣走到最後印綠。**
#   📌 那是本 repo 記過的形狀:**失敗的形狀是【成功】。**
FAILED=0; PASSED=0
pq () {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '  FAIL psql 非零退出(rc=%s)⇒ 這一發的結果【不算數】:%s\n' "$rc" "$*"
    FAILED=1
  fi
  return "$rc"
}
q1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "$1"; }

check () { # $1=格名 $2=期望 $3=實得
  if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
  else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=1; fi
}

REPO=$(cd "$(dirname "$0")/../.." && pwd)

# ── fixture(最小表;欄位只留被測函式真的讀到的那些)──────────────────
pq -q <<'SQL'
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, cancelled_at timestamptz);
CREATE TABLE public.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE public.order_payments (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL, rail text NOT NULL, amount bigint NOT NULL);
CREATE TABLE public.order_manual_refunds (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL, rail text NOT NULL,
  refund_amount bigint NOT NULL, voided_at timestamptz);
CREATE TABLE public.order_pending_refunds (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL, cancellation_id uuid,
  rail text NOT NULL, amount_at_cancel bigint NOT NULL CHECK (amount_at_cancel > 0),
  voided_at timestamptz, settled_at timestamptz,
  settled_manual_refund_id uuid,
  -- 🔴 正式表這道 CHECK 一定要帶上(20260901080000:241)—— 少了它, fixture 造得出
  --    一個【正式庫建不起來】的世界, 而那一格的綠證不到任何線上行為。
  CHECK ((settled_at IS NULL) = (settled_manual_refund_id IS NULL)),
  CHECK (NOT (settled_at IS NOT NULL AND voided_at IS NOT NULL)));
CREATE UNIQUE INDEX order_pending_refunds_live_order_rail_key
  ON public.order_pending_refunds (order_id, rail)
  WHERE voided_at IS NULL AND settled_at IS NULL;
SQL

# ── 🔴 兩支函式都【從 migration 檔裡抽】, 不抄一份 ──────────────────
awk '/^CREATE FUNCTION public\.pcm_pending_refund_amounts/,/^\$fn\$;$/' \
  "$REPO/supabase/migrations/20260902030000_m4b_crossrail_pending_refund_net.sql" > "$D/amounts.sql"
awk '/^CREATE FUNCTION public\.pcm_pending_refund_open_for/,/^\$fn\$;$/' \
  "$REPO/supabase/migrations/20260905070000_m4b_pending_refund_on_late_payment.sql" > "$D/openfor.sql"
for f in amounts openfor ; do
  test -s "$D/$f.sql" || { echo "X 抽不到 $f —— 那支 migration 的函式頭尾字面變了?"; exit 1; }
done
pq -q -f "$D/amounts.sql" && pq -q -f "$D/openfor.sql" || { echo "X 函式建不起來"; exit 1; }

OID=$(q1 "SELECT gen_random_uuid()")
NOW=$(q1 "SELECT now()")

echo "── 世界 A:取消【先】提交, 收款【之後】才落帳(= 本片要修的那個競態)──"
pq -q -c "INSERT INTO public.orders VALUES ('$OID', '$NOW');"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) VALUES ('$OID', '$NOW');"
# 取消那一刻:order_payments 零列 ⇒ 既有那道網會開 0 列
pq -q -c "SELECT public.pcm_pending_refund_open_for('$OID');"
check "格1 取消當下沒有錢 ⇒ 一列都不開(這是【舊行為】, 證明那個洞真的存在)" "0" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$OID'")"
# 錢晚到 ⇒ 本片的新呼叫
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$OID','bank_transfer',1000);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$OID');"
check "格2 🔴 錢晚到之後再呼叫 ⇒ 開出一列" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$OID'")"
check "格3 金額正確" "1000" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$OID'")"
check "格4 歸屬有接上(cancellation_id 非 NULL)" "true" \
  "$(q1 "SELECT (cancellation_id IS NOT NULL)::text FROM public.order_pending_refunds WHERE order_id='$OID'")"

echo "── 世界 B:正常順序(先收款, 後取消)⇒ 不重複開列 ──"
O2=$(q1 "SELECT gen_random_uuid()")
pq -q -c "INSERT INTO public.orders VALUES ('$O2', NULL);"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O2','bank_transfer',2000);"
pq -q -c "UPDATE public.orders SET cancelled_at = now() WHERE id='$O2';"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) SELECT '$O2', cancelled_at FROM public.orders WHERE id='$O2';"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
check "格5 正常順序 ⇒ 開一列" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O2'")"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
check "格6 🔴 再呼叫兩次 ⇒ 仍然只有一列(冪等)" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O2'")"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O2','bank_transfer',500);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
check "格7 又收到一筆 ⇒ 金額【更新】而不是多一列(DO UPDATE 的意思)" "2500" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$O2'")"

echo "── 🟢 負對照:沒取消的單, 呼叫它應該【什麼都不做】──"
O3=$(q1 "SELECT gen_random_uuid()")
pq -q -c "INSERT INTO public.orders VALUES ('$O3', NULL);"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O3','bank_transfer',9999);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O3');"
check "格8 🟢 未取消 ⇒ 零列(少了它, 一支【無條件開列】的版本會讓上面全綠)" "0" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O3'")"

echo "── ⚪ 第二個負對照:已結清的列不擋新的(部分唯一索引的語意)──"
# 🔴🔴 **fixture 要滿足正式表的 CHECK**(codex R1 must-fix ⑦)——
#   ⛔ ~~我第一版只寫 settled_at~~ ⇒ 🛑 **那在正式 schema 是【不合法】的**:
#     `20260901080000:241` 逐字 `CHECK ((settled_at IS NULL) = (settled_manual_refund_id IS NULL))`
#   ⇒ 📌 **一個在正式庫建不起來的 fixture, 讓這一格的綠證不到任何線上行為。**
#   ✅ 所以本檔的 fixture 表也把那道 CHECK 帶上(見上方建表), 而這裡兩欄一起填。
#   ⚠️ **仍然證不到的一格**:真實結清會新增一筆 order_manual_refunds,
#     那會改變 pcm_pending_refund_amounts 的結果。本格【沒有】模擬那一步
#     ⇒ 它證的是「部分唯一索引不擋新列」, **不是「結清之後金額算得對」**。
# 🔴🔴 **走【真實的結清路徑】**(codex R2 must-fix ⑦)——
#   ⛔ ~~我第一版只 UPDATE settled_at + 填一個隨機 UUID~~
#   ⇒ 🛑 真實結清會**新增一筆 order_manual_refunds**, 而那會讓 pcm_pending_refund_amounts
#     算出來的淨額**跟著變**。只改狀態不動退款表, 造出來的是一個**線上到不了的世界**。
#   ✅ 現在:真的登記一筆等額的人工退款去結清它 ⇒ 淨額歸零 ⇒ 這時 open_for **不該開新列**;
#     再收一筆新的錢 ⇒ 淨額 > 0 ⇒ 才會開出第二列。
MR=$(q1 "SELECT gen_random_uuid()")
pq -q -c "INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount)
          VALUES ('$O2','bank_transfer', 2500);"
pq -q -c "UPDATE public.order_pending_refunds
             SET settled_at = now(), settled_manual_refund_id = '$MR'
           WHERE order_id='$O2' AND settled_at IS NULL;"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
check "格9 結清後淨額歸零 ⇒ 【不】開新列(仍是那一列已結清的)" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O2'")"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O2','bank_transfer',400);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O2');"
check "格9b 🔴 結清之後又收到錢 ⇒ 開出第二列(部分唯一索引不擋已結清的那列)" "2" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O2'")"
check "格9c 新那列的金額 = 結清後的淨額" "400" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$O2' AND settled_at IS NULL")"

echo "── 🔴 p_overwrite_amount=false(收款重算走的那條路)——【本片 #1 的修法就是這格】──"
# 🔬 為什麼要單獨測:上面每一格都用預設 true, 所以它們【一格都沒有】走到 false 那條路。
#    📌 我折了 codex #1、加了一個參數, 而**沒有加測它的格子** —— 今晚同型第六次。
O4=$(q1 "SELECT gen_random_uuid()")
pq -q -c "INSERT INTO public.orders VALUES ('$O4', now());"
pq -q -c "INSERT INTO public.order_cancellations (order_id, created_at) SELECT '$O4', cancelled_at FROM public.orders WHERE id='$O4';"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O4','bank_transfer',700);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O4', false);"
check "格10 🔴 false + 沒有既有列 ⇒ 仍然要開一列(這就是那個洞)" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O4'")"
check "格10b 金額 = 第一次算得出來時的金額" "700" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$O4'")"
pq -q -c "INSERT INTO public.order_payments (order_id, rail, amount) VALUES ('$O4','bank_transfer',300);"
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O4', false);"
check "格11 🔴🔴 false + 已有列 + 又收到錢 ⇒ 金額【不動】(快照不會自己更新)" "700" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$O4'")"
check "格11b 而且沒有多開一列" "1" \
  "$(q1 "SELECT count(*)::text FROM public.order_pending_refunds WHERE order_id='$O4'")"
# 🟢 正對照:同一張單改用 true ⇒ 這次要動 ⇒ 證明格11 的「不動」是 false 造成的, 不是它恆不動
pq -q -c "SELECT public.pcm_pending_refund_open_for('$O4', true);"
check "格12 🟢 正對照:同一張單改傳 true ⇒ 金額變成 1000" "1000" \
  "$(q1 "SELECT amount_at_cancel::text FROM public.order_pending_refunds WHERE order_id='$O4'")"

# 🛑 **本檔【證不到】的一格, 照實寫**:pq 現在會在 psql 非零時把 FAILED 設成 1,
#    而**那條路沒有自己的測試** —— 要驗它得故意跑一發壞 SQL, 而那會把整支探針弄紅。
#    ⇒ 它是「有寫」不是「驗過」。下一個人要驗:暫時加一行 `pq -c "SELECT 1/0;"` 看它是否轉紅。

if [ "$FAILED" -ne 0 ]; then echo "X 有格子紅了(見上)"; exit 1; fi
echo "OK 全過:$PASSED 格"
