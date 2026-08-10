#!/usr/bin/env bash
# ============================================================
# OP5 行為 harness —— admin_record_manual_payment(人工軌收款登錄)
#
# 分工照 op2b-verify.sh / op3-verify.sh:migration 檔尾只做**不依賴業務資料**的結構斷言;
# 真正的行為(落一列、逐欄正確、冪等、每一道拒絕路徑零落帳)需要真訂單當 fixture,在這裡跑。
#
# 🔴 本 harness 以 **owner(postgres)** 身分呼叫 —— 本片**刻意零 GRANT**(分期開權,見 migration 檔頭):
#    EXECUTE 要等 OP-A12 與沖銷 RPC 一起開。owner 天生可執行自己的函式,所以這裡測得到行為;
#    但要誠實記住:**本檔全綠不等於正式路徑可呼叫**,那一半要等 OP-A12 開權後才成立。
#
# 🔴 判定紀律(同 op3-verify.sh):每格自己比 SQLSTATE / CONSTRAINT 名 / 訊息;fail-closed
#    (psql 退出碼 + sentinel);輸入類負向格另比**訊息片段**(否則拿掉某一道閘、下一道會接手擋、
#    格照樣綠 —— 突變 M7 實測過這件事);每格跑完驗 order_payments 零殘列(全部在交易內、跑完 ROLLBACK)。
#    唯一例外 = C1 併發格(它必須真的 COMMIT 才量得到鎖等待),見該格說明。
#
# 覆蓋:
#   G0  自我測試        壞掉的 SQL 必須被判紅
#   G1  對照組          上游終態(四支 trigger 啟用中、gate 已移除)+ 本片已套 + staff seed
#   P1-P9  正向         兩軌落帳逐欄 / 冪等 / cash NULL-safe 重送 / 多筆 / 部分取消單 /
#                       當日入帳交叉格 / clock 窗 / 逐軌下限邊界
#   N1-N19 負向         每格只讓一道閘失敗;有 CONSTRAINT 名的比名,沒有的比 SQLSTATE=P0001
#                       + 本 RPC 的具名訊息前綴(+ 能指名的再比一段訊息片段)
#   S1-S3  結構         ACL 分期開權極性 / SECDEF fail-open 面 / 碼錨與順序錨
#   C1     併發         雙 session rendezvous:A 觀察到 B 真的卡在它的 orders 列鎖上才提交
#                       (有界輪詢、等不到就紅);再驗 B 走冪等樹(逐字 idempotent: true)與最終恰一列
#
# ⚠️ 已知邊界(誠實列,不假裝關完):
#   · 本檔以 owner 呼叫 ⇒ 證不到 service_role 路徑(那要等 OP-A12 開權)。
#   · C1 量的是「B 被 A 擋住」與「A commit 後 B 走冪等樹」;**unique 真撞在同單情境下不可構造**
#     (orders FOR UPDATE 已序列化)⇒ 那條 backstop 本檔不宣稱測過。
#   · 時區相關的格用 Asia/Taipei 明寫,不依賴 session 的 TimeZone 設定。
#
# 用法:
#   bash scripts/op5-verify.sh all <workdir>          # provision -> 跑 -> teardown
#   PORT=54375 bash scripts/op5-verify.sh run /tmp/x  # 對已起好的庫跑(C1 會被跳過並記錄)
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: op5-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54375}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

# 🔴🔴 自檢:SQL 註解內不得出現反引號 / ASCII 雙引號(照抄 op3-verify.sh 的機制,B-393 記的三次事故)。
#    本檔所有 SQL 包在 bash 雙引號字串裡 ⇒ 反引號會被 shell 當命令替換執行、雙引號會截斷字串。
SELF_BAD="$(grep -nE '^[[:space:]]+--.*[`"]' "${BASH_SOURCE[0]}" || true)"
if [ -n "$SELF_BAD" ]; then
  echo "🔴 自檢失敗:SQL 註解含反引號或 ASCII 雙引號(會被 shell 執行/截斷),請改成純文字:"
  printf '%s\n' "$SELF_BAD" | head -10
  exit 2
fi

PASS=0; FAIL=0; SKIP=0
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  ⏭  %s\n' "$1"; SKIP=$((SKIP+1)); }
log()  { echo "== $* =="; }

case "$WORK" in
  /tmp/[!/]*) : ;;
  *) echo "🔴 workdir 必須是 /tmp/<名字>(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in
  */)   echo "🔴 workdir 不得以斜線結尾(收到:$WORK)"; exit 2 ;;
  *//*) echo "🔴 workdir 不得含連續斜線(收到:$WORK)"; exit 2 ;;
  *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;;
esac
[ -L "$WORK" ] && { echo "🔴 workdir 是 symlink(收到:$WORK)"; exit 2; }

require_free_port() {
  command -v lsof >/dev/null 2>&1 || {
    echo "🔴 找不到 lsof ⇒ 埠檢查做不到,拒絕往下跑(fail-closed)"; exit 2; }
  local pids; pids="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -z "$pids" ] || { echo "🔴 port ${PORT} 被佔用(pid: $(echo "$pids" | tr '\n' ' '))⇒ 換 PORT 重跑"; exit 2; }
}

cluster_identity() {
  local dd; dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
  [ "$dd" = "$WORK/pgdata" ] || {
    echo "🔴 身分閘:PORT=${PORT} 連到的 data_directory=${dd:-<查不到>},期望 ${WORK}/pgdata ⇒ 連錯庫,拒繼續"; exit 2; }
}

# 每格:跑 SQL -> 驗退出碼 -> 驗 sentinel -> 驗本表零殘列
run_case() {
  local name="$1" sentinel="$2" sql="$3" out rc rows
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    bad "$name:psql rc=$rc ⇒ $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:退出碼 0 但 sentinel「$sentinel」不在輸出裡 ⇒ 判定無效"; return 1; fi
  rows="$(psql "$URL" -qtA -c 'SELECT count(*) FROM public.order_payments' 2>/dev/null)"
  if [ "$rows" != "0" ]; then
    bad "$name:跑完本表有 $rows 列 ⇒ 沒 ROLLBACK 乾淨,錢帳被測試污染"; return 1; fi
  ok "$name"
}

# 🔴 fixture:一張乾淨的單 —— 未取消、狀態在 allowlist 內、且沒有任何取消紀錄。
#    (取消紀錄那條是為了讓 P6 能自己造一筆部分取消,而不是撿到已經有的。)
FIXTURE=$'  SELECT o.id, o.total, o.created_at INTO v_o, v_total, v_created\n    FROM public.orders o\n   WHERE o.payment_status = \'unpaid\'::public.payment_status\n     AND o.cancelled_at IS NULL\n     AND NOT EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = o.id)\n   ORDER BY o.created_at LIMIT 1;\n  IF v_o IS NULL THEN\n    RAISE EXCEPTION \'fixture 不足:找不到乾淨的 unpaid 單 ⇒ 這輪沒有證據\';\n  END IF;'

# 負測哨兵專屬碼(照 op2b/op3 的 Fable R3 教訓:哨兵若用預設 P0001 會被同格 WHEN others 撈回去,
# 印出來的診斷與事實相反)。
SENTINEL_CODE="P2BF0"

if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17(含 OP5)"
  require_free_port
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 已存在但缺 .d1t2-harness ownership marker ⇒ 這不是本 harness 家族建的目錄,拒絕 rm -rf"; exit 2
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  ok "provision 完成"
fi
cluster_identity

log "G0 harness 自我測試"
if run_case "G0(應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 判定失效"; echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1)); ok "G0:壞掉的 SQL 會被判紅"

log "G1 對照組:上游終態 + 本片已套"
run_case "G1 四支 trigger 啟用中 + dormant gate 已移除 + 本片函式在 + staff seed 齊" "OP5-G1-OK" "
DO \$g1\$
DECLARE v_names text; v_n integer;
BEGIN
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal AND tgenabled = 'O';
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION '這個庫不是 OP2b 的終態(啟用中的 trigger=%)', coalesce(v_names,'(無)');
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers' AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'dormant gate 還在 ⇒ OP2b 沒 apply'; END IF;
  IF to_regprocedure('public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)') IS NULL THEN
    RAISE EXCEPTION '本片的函式不在 ⇒ 這個庫沒套過 OP5';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = 'staff_1' AND s.is_active) THEN
    RAISE EXCEPTION 'staff seed 的 staff_1 不在或未啟用 ⇒ 正向格沒有合法 actor';
  END IF;
  -- 🔴 opus 線 nit:N14f 用 staff_2 當「改 actor」的第二人;它若停用,那格會在 G2 就被擋下、
  --    照樣綠,而它宣稱測的是 G8 的 actor 比對 ⇒ 對照組要連 staff_2 一起釘(a8a1-verify:69 同款)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = 'staff_2' AND s.is_active) THEN
    RAISE EXCEPTION 'staff seed 的 staff_2 不在或未啟用 ⇒ N14f 會在 G2 被擋、證不到 G8 的 actor 比對';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = 'payment_confirmer' AND NOT s.is_active) THEN
    RAISE EXCEPTION 'payment_confirmer 不在或不是停用狀態 ⇒ N10 的停用 actor fixture 不成立';
  END IF;
  RAISE NOTICE 'OP5-G1-OK';
END
\$g1\$;"

log "P1 正向:bank_transfer 落一列,十六欄逐欄"
# 🔴 只驗列數不夠:rail 寫錯、amount 寫成別的數、received_at 被換成 now()、actor 寫成 current_user、
#    或某個該留 NULL 的欄被順手填了 —— 單看列數全是綠的。有給值的比值,沒給值的必須仍是 NULL。
run_case "P1 bank_transfer 落一列 + 十六欄逐欄" "OP5-P1-OK" "
BEGIN;
DO \$p1\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_res jsonb; v_n integer;
        v_row public.order_payments%ROWTYPE; v_req uuid := gen_random_uuid();
        v_recv timestamptz;
BEGIN
$FIXTURE
  v_recv := pg_catalog.date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei';
  IF v_recv < v_created THEN v_recv := v_created; END IF;
  v_res := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'bank_transfer', 1234, v_recv, '  12345  ', '  客人說今天匯的  ');
  IF (v_res->>'recorded')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'recorded 不是 true:%', v_res; END IF;
  IF (v_res->>'idempotent')::boolean IS NOT FALSE THEN RAISE EXCEPTION '首次登錄卻回 idempotent=true:%', v_res; END IF;
  IF (v_res->>'payment_id') IS NULL THEN RAISE EXCEPTION '沒有回 payment_id:%', v_res; END IF;

  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '期望恰 1 列,實得 %', v_n; END IF;
  SELECT * INTO v_row FROM public.order_payments WHERE order_id = v_o;

  IF v_row.id::text IS DISTINCT FROM (v_res->>'payment_id') THEN RAISE EXCEPTION '回傳的 payment_id 與落的列對不上'; END IF;
  IF v_row.rail IS DISTINCT FROM 'bank_transfer' THEN RAISE EXCEPTION 'rail=%', v_row.rail; END IF;
  IF v_row.amount IS DISTINCT FROM 1234 THEN RAISE EXCEPTION 'amount=%', v_row.amount; END IF;
  IF v_row.received_at IS DISTINCT FROM v_recv THEN RAISE EXCEPTION 'received_at=% 期望 %', v_row.received_at, v_recv; END IF;
  IF v_row.bank_reference IS DISTINCT FROM '12345' THEN RAISE EXCEPTION 'bank_reference 沒被正規化:[%]', v_row.bank_reference; END IF;
  IF v_row.payer_note IS DISTINCT FROM '客人說今天匯的' THEN RAISE EXCEPTION 'payer_note 沒被正規化:[%]', v_row.payer_note; END IF;
  IF v_row.request_id IS DISTINCT FROM v_req THEN RAISE EXCEPTION 'request_id=%', v_row.request_id; END IF;
  IF v_row.actor IS DISTINCT FROM 'staff_1' THEN RAISE EXCEPTION 'actor=% ⇒ 不是 p_actor 參數', v_row.actor; END IF;
  IF v_row.order_id IS DISTINCT FROM v_o THEN RAISE EXCEPTION 'order_id 對不上'; END IF;
  IF v_row.created_at IS NULL THEN RAISE EXCEPTION 'created_at 應由預設值填'; END IF;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'id 應由預設值填'; END IF;
  IF v_row.rec_trade_id IS NOT NULL THEN RAISE EXCEPTION 'rec_trade_id 應為 NULL(那是卡軌的)'; END IF;
  IF v_row.reverses_payment_id IS NOT NULL THEN RAISE EXCEPTION 'reverses_payment_id 應為 NULL'; END IF;
  IF v_row.reversal_reason IS NOT NULL THEN RAISE EXCEPTION 'reversal_reason 應為 NULL'; END IF;
  IF v_row.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'reviewed_by 應為 NULL(Q4=C 本 RPC 不寫複核欄)'; END IF;
  IF v_row.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'reviewed_at 應為 NULL(Q4=C)'; END IF;
  IF v_row.note IS NOT NULL THEN RAISE EXCEPTION 'note 應為 NULL(本 RPC 不寫)'; END IF;
  RAISE NOTICE 'OP5-P1-OK';
END
\$p1\$;
ROLLBACK;"

log "P2 正向:cash 落一列,識別欄全 NULL"
run_case "P2 cash 落一列 + bank_reference/rec_trade_id 皆 NULL" "OP5-P2-OK" "
BEGIN;
DO \$p2\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_res jsonb;
        v_row public.order_payments%ROWTYPE; v_req uuid := gen_random_uuid();
BEGIN
$FIXTURE
  v_res := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'cash', 500, now(), NULL, NULL);
  SELECT * INTO v_row FROM public.order_payments WHERE order_id = v_o;
  IF v_row.rail IS DISTINCT FROM 'cash' THEN RAISE EXCEPTION 'rail=%', v_row.rail; END IF;
  IF v_row.bank_reference IS NOT NULL THEN RAISE EXCEPTION '現金軌不該有 bank_reference'; END IF;
  IF v_row.rec_trade_id IS NOT NULL THEN RAISE EXCEPTION '現金軌不該有 rec_trade_id'; END IF;
  IF v_row.payer_note IS NOT NULL THEN RAISE EXCEPTION 'payer_note 應為 NULL'; END IF;
  IF v_row.amount IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'amount=%', v_row.amount; END IF;
  RAISE NOTICE 'OP5-P2-OK';
END
\$p2\$;
ROLLBACK;"

log "P3 正向:同輸入重送 ⇒ idempotent 且不落第二列"
run_case "P3 bank_transfer 重送:idempotent=true、payment_id 相同、仍恰一列" "OP5-P3-OK" "
BEGIN;
DO \$p3\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_a jsonb; v_b jsonb; v_n integer;
        v_req uuid := gen_random_uuid(); v_recv timestamptz;
BEGIN
$FIXTURE
  v_recv := pg_catalog.date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei';
  IF v_recv < v_created THEN v_recv := v_created; END IF;
  v_a := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'bank_transfer', 900, v_recv, 'REF9', '備註');
  v_b := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'bank_transfer', 900, v_recv, 'REF9', '備註');
  IF (v_b->>'idempotent')::boolean IS NOT TRUE THEN RAISE EXCEPTION '重送沒回 idempotent:%', v_b; END IF;
  IF (v_b->>'payment_id') IS DISTINCT FROM (v_a->>'payment_id') THEN RAISE EXCEPTION '重送回了不同的 payment_id'; END IF;
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '重送落了第二列(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-P3-OK';
END
\$p3\$;
ROLLBACK;"

log "P4 正向:cash 重送(兩個可空欄皆 NULL)⇒ 仍 idempotent"
# 🔴 這格是 Fable R3 #3 的專屬負責格:六輸入若用 = 比,NULL = NULL 得 NULL ⇒ 整條 AND 變 NULL
#    ⇒ cash 的**合法重送**會被判成竄改。用 IS NOT DISTINCT FROM 才會綠。
#    突變靶:把函式裡的 IS NOT DISTINCT FROM 換成 =,這一格必紅,而 P3(兩欄都有值)照樣綠。
run_case "P4 cash 重送 NULL-safe:idempotent=true、不落第二列" "OP5-P4-OK" "
BEGIN;
DO \$p4\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_a jsonb; v_b jsonb; v_n integer;
        v_req uuid := gen_random_uuid(); v_recv timestamptz := now();
BEGIN
$FIXTURE
  v_a := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'cash', 300, v_recv, NULL, NULL);
  v_b := public.admin_record_manual_payment(v_o, v_req, 'staff_1', 'cash', 300, v_recv, NULL, NULL);
  IF (v_b->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'cash 的合法重送被判成竄改:% ⇒ 冪等比對沒用 IS NOT DISTINCT FROM', v_b;
  END IF;
  IF (v_b->>'payment_id') IS DISTINCT FROM (v_a->>'payment_id') THEN RAISE EXCEPTION '重送回了不同的 payment_id'; END IF;
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION 'cash 重送落了第二列(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-P4-OK';
END
\$p4\$;
ROLLBACK;"

log "P5 正向:同單兩筆不同 request_id ⇒ 落兩列(U3 可記多筆不被誤擋)"
run_case "P5 同單兩筆不同 request_id ⇒ 兩列" "OP5-P5-OK" "
BEGIN;
DO \$p5\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_n integer; v_recv timestamptz;
BEGIN
$FIXTURE
  v_recv := pg_catalog.date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei';
  IF v_recv < v_created THEN v_recv := v_created; END IF;
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'bank_transfer', 100, v_recv, 'A1', NULL);
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'bank_transfer', 200, v_recv, 'A1', NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 2 THEN RAISE EXCEPTION '期望兩列(同銀行參考的兩筆合法匯款),實得 %', v_n; END IF;
  RAISE NOTICE 'OP5-P5-OK';
END
\$p5\$;
ROLLBACK;"

log "P10-P11 正向:allowlist 的另外兩態(paid / partiallyPaid)真的收得進來"
# 🔴 codex 關卡2 #4:所有 fixture 都是 unpaid ⇒ 把 allowlist 縮成只接受 unpaid,正向格全綠、
#    而檔頭宣稱的 paid/partiallyPaid 從沒被守住。⇒ 兩態各補一格(交易內改狀態、跑完 ROLLBACK)。
for st in paid partiallyPaid; do
  run_case "P1x $st 單仍可登錄人工款(allowlist 正向)" "OP5-PX-OK" "
BEGIN;
DO \$px\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_n integer;
BEGIN
$FIXTURE
  UPDATE public.orders SET payment_status = '$st'::public.payment_status WHERE id = v_o;
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 70, now(), NULL, NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '$st 單的合法登錄被擋掉(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-PX-OK';
END
\$px\$;
ROLLBACK;"
done

log "P6 正向:部分取消的單仍可登錄(抄錯先例的回歸格)"
# 🔴 這格是 codex/Fable R3 的第 2 條:我原本照抄 OP3 的取消守門(連 order_cancellations 有列都擋),
#    但部分取消的單還活著、還會收後續款 —— §5.1b 契約寫死部分取消不動 orders.cancelled_at。
#    突變靶:把 G6 改回「EXISTS(order_cancellations) 也拒」,這一格必紅,而 N11(整單取消)照樣綠。
run_case "P6 有 order_cancellations 列但 cancelled_at 為空 ⇒ 仍可登錄" "OP5-P6-OK" "
BEGIN;
DO \$p6\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_n integer; v_cid uuid;
BEGIN
$FIXTURE
  INSERT INTO public.order_cancellations (order_id, idempotency_key, actor, reason_code, reason_detail, payload_hash)
  VALUES (v_o, gen_random_uuid(), 'staff_1', 'customer_request', NULL,
          pg_catalog.encode(pg_catalog.sha256('op5-p6-fixture'::bytea), 'hex'))
  RETURNING id INTO v_cid;
  IF (SELECT o.cancelled_at FROM public.orders o WHERE o.id = v_o) IS NOT NULL THEN
    RAISE EXCEPTION 'fixture 前提壞了:部分取消不該動 orders.cancelled_at';
  END IF;
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '部分取消單的登錄被擋掉了(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-P6-OK';
END
\$p6\$;
ROLLBACK;"

log "P7 正向:同日下午建單 + 當日 00:00 匯款入帳 ⇒ 必須通過(G7 交叉格)"
# 🔴 本輪最重的交叉洞(Fable R3 #1 = codex R3 #1):匯款軌的值是台北當日 00:00,
#    若下限拿 created_at 逐秒比,「今天 14:00 成立、客人立刻轉帳當日到帳」= 台灣最常見情境會全滅。
#    突變靶:把 G7 的 bank_transfer 分支改成 v_floor := v_order.created_at,這一格必紅。
run_case "P7 當日建單 + 當日 00:00 入帳 ⇒ 通過" "OP5-P7-OK" "
BEGIN;
DO \$p7\$
DECLARE v_o uuid; v_recv timestamptz; v_n integer;
BEGIN
  SELECT o.id INTO v_o FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status AND o.cancelled_at IS NULL
   ORDER BY o.created_at LIMIT 1;
  IF v_o IS NULL THEN RAISE EXCEPTION 'fixture 不足'; END IF;
  -- 把這張單改成**今天**成立(交易內改、跑完 ROLLBACK)。
  -- 🔴 Fable 線 MF1:第一版寫死「台北當日 14:00」⇒ **台北 00:00-14:00 之間跑這格必紅**
  --    (fixture 造出未來時間、被我自己下一行的前提守門擋掉),連帶 W7 record all 上午跑必 FAIL
  --    = 凍結證據在半個曆日內不可複現。改用 now():它必然落在當日 00:00 之後、且永不為未來,
  --    而交叉格要證的語意(建單在當日 00:00 之後、入帳填當日 00:00)完全不變。
  UPDATE public.orders SET created_at = now() WHERE id = v_o;
  v_recv := pg_catalog.date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei';
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'bank_transfer', 777, v_recv, 'SAMEDAY', NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '當日入帳的匯款被誤拒(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-P7-OK';
END
\$p7\$;
ROLLBACK;"

log "P8 正向:received_at 落在 now() 與 clock_timestamp() 之間 ⇒ 通過"
# 🔴 這格證 G4 用的是 clock_timestamp 不是 now():交易內 now() 是交易開始時刻、恆定,
#    而 clock_timestamp() 一直在走。取一個 now() 之後的真實時刻,用 now() 寫的閘會誤殺它。
#    突變靶:把 G4 的 clock_timestamp() 換成 now(),這一格必紅,而 N7(未來一小時)照樣綠。
run_case "P8 now() 與 clock_timestamp() 之間的時點 ⇒ 通過" "OP5-P8-OK" "
BEGIN;
DO \$p8\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_recv timestamptz; v_n integer;
BEGIN
$FIXTURE
  PERFORM pg_catalog.pg_sleep(0.05);
  v_recv := pg_catalog.clock_timestamp() - interval '10 milliseconds';
  IF v_recv <= now() THEN RAISE EXCEPTION '這格的前提不成立:clock_timestamp 還沒超過交易的 now()'; END IF;
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 50, v_recv, NULL, NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '交易開始後的真實時刻被誤擋(實得 % 列)', v_n; END IF;
  RAISE NOTICE 'OP5-P8-OK';
END
\$p8\$;
ROLLBACK;"

log "P9 正向:cash 的下限是精確時點(等於 created_at 必須通過)"
run_case "P9 cash received_at = orders.created_at ⇒ 通過(邊界含等於)" "OP5-P9-OK" "
BEGIN;
DO \$p9\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_n integer;
BEGIN
$FIXTURE
  PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 60, v_created, NULL, NULL);
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION '下限邊界(等於 created_at)被誤拒'; END IF;
  RAISE NOTICE 'OP5-P9-OK';
END
\$p9\$;
ROLLBACK;"

# ── 負測共用:每格只讓一道閘失敗,並比 CONSTRAINT 名;零落帳由 run_case 統一驗 ──
# 🔴 哨兵碼 P2BF0:自己的 RAISE 若用預設 P0001 會被同格的 WHEN others 撈回去,
#    印出來的診斷會與事實相反(紅是紅了,但實況是寫入被放行)。
# 🔴🔴 Fable 線 MF3:第一版的 want_con 若為空就**接受任何例外** —— 27 格負向裡有 17 格是這樣,
#    而檔頭卻宣稱「每格自己比 SQLSTATE / CONSTRAINT 名」= 字面大於事實。
#    後果不是理論:把 G3 的 card 具名拒整條刪掉,N1/N2 照樣綠(那筆會一路走到 INSERT,
#    改由 OP1 的 order_payments_rail_fields 噴 23514 擋下)⇒ G3 整層零行為判別力。
#    ⇒ 沒有 conname 的閘改成比**兩件事**:①SQLSTATE 必須是 P0001(RPC 自己 RAISE 的,
#      不是撞到下游 CHECK/FK)②訊息前綴必須是本 RPC 的具名前綴;能指名的再多比一段訊息片段。
neg_case() {
  local name="$1" want_con="$2" call="$3" pre="${4:-}" want_msg="${5:-}"
  run_case "$name" "OP5-NEG-OK" "
BEGIN;
DO \$neg\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_con text; v_state text; v_msg text;
BEGIN
$FIXTURE
$pre
  $call
  RAISE EXCEPTION '沒被擋住 ⇒ 這道守門沒生效' USING ERRCODE = '$SENTINEL_CODE';
EXCEPTION
  WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
  WHEN others THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME, v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF '$want_con' <> '' THEN
      IF v_con IS DISTINCT FROM '$want_con' THEN
        RAISE EXCEPTION '被擋了,但擋它的是 [%](SQLSTATE=%),期望 CONSTRAINT [%]',
                        coalesce(v_con, '(無 conname)'), v_state, '$want_con'
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
    ELSE
      IF v_state IS DISTINCT FROM 'P0001' THEN
        RAISE EXCEPTION '被擋了但 SQLSTATE=%(訊息:%)⇒ 不是本 RPC 自己 RAISE 的,可能是下游 CHECK/FK 代打',
                        v_state, coalesce(v_msg, '(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
      IF pg_catalog.strpos(coalesce(v_msg,''), 'admin_record_manual_payment:') <> 1 THEN
        RAISE EXCEPTION '訊息不是本 RPC 的具名前綴:%', coalesce(v_msg, '(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
      -- 🔴 codex 關卡2 #3:通用訊息那族原本只比前綴 ⇒ 有人把它改成
      --    「收款登錄失敗(訂單不存在)」照樣全綠、狀態就洩出去了。
      --    ⇒ 兩個等號當前綴 = **逐字全等**;其餘 = 片段命中。
      IF pg_catalog.left('$want_msg', 2) = '==' THEN
        IF coalesce(v_msg,'') IS DISTINCT FROM pg_catalog.substr('$want_msg', 3) THEN
          RAISE EXCEPTION '訊息不是逐字的通用訊息。實得 [%],期望逐字 [%]', v_msg, pg_catalog.substr('$want_msg', 3)
            USING ERRCODE = '$SENTINEL_CODE';
        END IF;
      ELSIF '$want_msg' <> '' AND pg_catalog.strpos(coalesce(v_msg,''), '$want_msg') = 0 THEN
        RAISE EXCEPTION '訊息片段對不上。實得 [%],期望含 [%]', v_msg, '$want_msg'
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
    END IF;
    RAISE NOTICE 'OP5-NEG-OK';
END
\$neg\$;
ROLLBACK;"
}

log "N1-N5 輸入驗"
neg_case "N1 card 軌具名拒" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'card', 100, now(), NULL, NULL);" "" \
  "card 軌不得由人工登錄"
neg_case "N2 rail 亂值拒" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'atm', 100, now(), NULL, NULL);" "" \
  "不是 bank_transfer 或 cash"
neg_case "N3 匯款軌缺 bank_reference 拒" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'bank_transfer', 100, v_created, '   ', NULL);" "" \
  "匯款軌必須填銀行參考"
neg_case "N4 現金軌帶 bank_reference 拒" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), 'X1', NULL);" "" \
  "現金軌不得填銀行參考"
neg_case "N5 金額非正拒" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 0, now(), NULL, NULL);" "" \
  "金額必須為正整數"

log "N6 五個參數的 NULL 守門(逐一,不寫計數字面)"
neg_case "N6a p_order_id IS NULL" "" \
  "PERFORM public.admin_record_manual_payment(NULL, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);" "" \
  "訂單識別碼缺失"
neg_case "N6b p_request_id IS NULL" "" \
  "PERFORM public.admin_record_manual_payment(v_o, NULL, 'staff_1', 'cash', 100, now(), NULL, NULL);" "" \
  "冪等鍵 request_id 缺失"
neg_case "N6c p_rail IS NULL" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', NULL, 100, now(), NULL, NULL);" "" \
  "收款管道缺失"
neg_case "N6d p_amount IS NULL" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', NULL, now(), NULL, NULL);" "" \
  "金額缺失"
neg_case "N6e p_received_at IS NULL(v3 折 finding 時被我弄丟過的那一道)" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, NULL, NULL, NULL);" "" \
  "收款時點缺失"

log "N7 未來時點 ⇒ 紅在本片的 G4"
neg_case "N7 未來一小時 ⇒ pcm_op5_received_at_future" "pcm_op5_received_at_future" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now() + interval '1 hour', NULL, NULL);"

log "N8 判別力:拔掉 G4 之後,同一筆改紅在 OP2a 的 A8 閘"
# 🔴 這格證兩件事:①G4 不是恆真的裝飾(拿掉會換一條路徑紅)②OP2a 的 backstop 真的還在。
#    只證其中一件都不夠:少了它,G4 可能根本沒生效而 OP2a 一直在替它擋。
run_case "N8 突變拔掉 G4 ⇒ 改紅在 pcm_op2_received_at_future(OP2a backstop 仍在)" "OP5-N8-OK" "
BEGIN;
DO \$n8\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_def text; v_mut text; v_con text;
BEGIN
$FIXTURE
  v_def := pg_catalog.pg_get_functiondef(
    'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure);
  v_mut := pg_catalog.replace(v_def,
             'IF p_received_at > pg_catalog.clock_timestamp() THEN',
             'IF false THEN');
  IF v_mut = v_def THEN
    RAISE EXCEPTION '突變沒套上:G4 的錨點字面已經不在函式體裡 ⇒ 這格的判定失效';
  END IF;
  EXECUTE v_mut;
  BEGIN
    PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100,
                                               now() + interval '1 hour', NULL, NULL);
    RAISE EXCEPTION '拔掉 G4 之後未來時點竟然寫得進去 ⇒ OP2a 的 A8 閘也沒在守'
      USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op2_received_at_future' THEN
        RAISE EXCEPTION '拔掉 G4 之後擋它的是 [%],期望 OP2a 的 pcm_op2_received_at_future',
                        coalesce(v_con, '(無 conname)') USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'OP5-N8-OK';
END
\$n8\$;
ROLLBACK;"

log "N9-N10 actor 守門(存在 / 啟用 兩形狀分開測)"
# 🔴 兩發必須分開:只測「不存在」的話,把 is_active 條件拿掉仍然全綠 —— 那一半從沒被證過。
neg_case "N9 actor 不存在" "pcm_op5_actor_invalid" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'nobody_here', 'cash', 100, now(), NULL, NULL);"
neg_case "N10 actor 存在但已停用(payment_confirmer)" "pcm_op5_actor_invalid" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'payment_confirmer', 'cash', 100, now(), NULL, NULL);"

log "N11 整單取消 ⇒ 通用訊息拒"
neg_case "N11 cancelled_at 非空 ⇒ 拒(逐字通用訊息,不得洩狀態)" "" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);" \
  "  UPDATE public.orders SET cancelled_at = now(), cancelled_reason = 'N11 fixture' WHERE id = v_o;" \
  "==admin_record_manual_payment: 收款登錄失敗"

log "N19 訂單不存在 ⇒ 與已取消**同一句**逐字通用訊息(不洩存在與否)"
neg_case "N19 未知 order_id ⇒ 逐字通用訊息" "" \
  "PERFORM public.admin_record_manual_payment('00000000-0000-0000-0000-0000000000ff'::uuid, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);" "" \
  "==admin_record_manual_payment: 收款登錄失敗"

log "N12-N13 退款兩態 ⇒ 具名可診斷拒(政策性,不是通用訊息)"
neg_case "N12 refunded ⇒ pcm_op5_refunded_state" "pcm_op5_refunded_state" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);" \
  "  UPDATE public.orders SET payment_status = 'refunded'::public.payment_status WHERE id = v_o;"
neg_case "N13 partiallyRefunded ⇒ pcm_op5_refunded_state" "pcm_op5_refunded_state" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);" \
  "  UPDATE public.orders SET payment_status = 'partiallyRefunded'::public.payment_status WHERE id = v_o;"

log "N14 冪等竄改:六個輸入各改一欄,各一發"
# 🔴 六發分開的理由同 N9/N10:只測金額那一欄的話,比對面縮回三欄仍然全綠。
#    每一發的 pre 先用同一個 request_id 登一筆合法的,再用改過一欄的輸入重送。
IDEM_PRE="  PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid,
                                            'staff_1', 'cash', 100, v_created, NULL, 'note-A');"
# 🔴 opus 線 MF3:N14d 原本用 cash + bank_reference='X9' 去測「改 bank_reference」——
#    那筆在 **G3**(現金軌不得填銀行參考)就被擋,根本走不到 G8 ⇒ 把 bank_reference 從六欄比對裡
#    拿掉本格照樣綠 = 對該欄零判別力,與本節自述相反。⇒ 該格改用**兩筆都合法的 bank_transfer**,
#    只讓 bank_reference 一欄不同,才真的落在 G8 上。
IDEM_PRE_BT="  PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid,
                                            'staff_1', 'bank_transfer', 100, v_created, 'R1', 'note-A');"
neg_case "N14a 改 rail(rail 與 bank_reference 必然連動:兩軌的欄位形狀不同,單改 rail 過不了 G3)" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_1', 'bank_transfer', 100, v_created, 'R1', 'note-A');" "$IDEM_PRE" \
  "==admin_record_manual_payment: 收款登錄失敗"
neg_case "N14b 改 amount" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_1', 'cash', 999, v_created, NULL, 'note-A');" "$IDEM_PRE" \
  "==admin_record_manual_payment: 收款登錄失敗"
neg_case "N14c 改 received_at" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_1', 'cash', 100, v_created + interval '1 second', NULL, 'note-A');" "$IDEM_PRE" \
  "==admin_record_manual_payment: 收款登錄失敗"
neg_case "N14d 改 bank_reference(兩筆都是合法 bank_transfer,只差這一欄)" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_1', 'bank_transfer', 100, v_created, 'R2', 'note-A');" "$IDEM_PRE_BT" \
  "==admin_record_manual_payment: 收款登錄失敗"
neg_case "N14e 改 payer_note" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_1', 'cash', 100, v_created, NULL, 'note-B');" "$IDEM_PRE" \
  "==admin_record_manual_payment: 收款登錄失敗"
neg_case "N14f 改 actor" "" \
  "PERFORM public.admin_record_manual_payment(v_o, '11111111-1111-1111-1111-111111111111'::uuid, 'staff_2', 'cash', 100, v_created, NULL, 'note-A');" "$IDEM_PRE" \
  "==admin_record_manual_payment: 收款登錄失敗"

log "N15-N16 下限守門(逐軌各一發)"
neg_case "N15 匯款早於建單日的台北 00:00 ⇒ pcm_op5_received_at_before_order" "pcm_op5_received_at_before_order" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'bank_transfer', 100,
     pg_catalog.date_trunc('day', v_created AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei' - interval '1 second', 'B1', NULL);"
neg_case "N16 現金早於 created_at ⇒ pcm_op5_received_at_before_order" "pcm_op5_received_at_before_order" \
  "PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, v_created - interval '1 second', NULL, NULL);"

log "N17 隔離閘:非 READ COMMITTED ⇒ P8C01"
run_case "N17 REPEATABLE READ ⇒ P8C01" "OP5-N17-OK" "
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
DO \$n17\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_state text;
BEGIN
$FIXTURE
  BEGIN
    PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);
    RAISE EXCEPTION '非 READ COMMITTED 竟然放行 ⇒ 隔離閘沒生效' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state IS DISTINCT FROM 'P8C01' THEN
        RAISE EXCEPTION '被擋了但 SQLSTATE=%,期望 P8C01', v_state USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'OP5-N17-OK';
END
\$n17\$;
ROLLBACK;"

log "N18 靜默吞列:BEFORE INSERT 回 NULL ⇒ P2B40"
# 🔴 本片最危險的失敗形狀:INSERT 影響 0 列且**不報任何錯**,函式照樣 RETURN 成功,
#    呼叫端以為錢記進帳了。這格裝一支回 NULL 的 trigger 來構造它。
run_case "N18 BEFORE INSERT 回 NULL ⇒ 紅在 pcm_op5_row_count" "OP5-N18-OK" "
BEGIN;
CREATE FUNCTION pg_temp.op5_swallow() RETURNS trigger LANGUAGE plpgsql AS \$sw\$ BEGIN RETURN NULL; END \$sw\$;
CREATE TRIGGER aaa_op5_probe_swallow_bi BEFORE INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION pg_temp.op5_swallow();
DO \$n18\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_con text;
BEGIN
$FIXTURE
  BEGIN
    PERFORM public.admin_record_manual_payment(v_o, gen_random_uuid(), 'staff_1', 'cash', 100, now(), NULL, NULL);
    RAISE EXCEPTION '列被靜默吞掉卻回成功 ⇒ row_count 守沒生效' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op5_row_count' THEN
        RAISE EXCEPTION '擋它的是 [%],期望 pcm_op5_row_count', coalesce(v_con,'(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'OP5-N18-OK';
END
\$n18\$;
ROLLBACK;"

log "S1-S3 結構:ACL 分期開權極性 / SECDEF fail-open 面 / 碼錨與順序錨"
run_case "S1 ACL:proacl 非 NULL 且 owner 以外零 EXECUTE(分期開權,到期點=OP-A12)" "OP5-S1-OK" "
DO \$s1\$
DECLARE v_fn oid; v_acl text; v_bad text;
BEGIN
  SELECT p.oid, p.proacl::text INTO v_fn, v_acl FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure;
  IF v_acl IS NULL THEN RAISE EXCEPTION 'proacl 是 NULL ⇒ PG 的預設是 EXECUTE TO PUBLIC'; END IF;
  SELECT pg_catalog.string_agg(DISTINCT
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
   WHERE p.oid = v_fn AND g.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '本片應為零 GRANT,但有 owner 以外的 grantee(%)。
   處置 = 若這是 OP-A12 的開權,請**同批**把本格與 migration 檔尾 ⑧ 的極性一起翻成 service_role only
   並補 has_function_privilege 斷言,**不是把這道閘拿掉**;若不是 OP-A12,那就是有人偷開權。', v_bad;
  END IF;
  IF pg_catalog.has_function_privilege('service_role',
       'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role 有效權限拿得到 EXECUTE(可能經 role 繼承)⇒ 分期開權被繞過';
  END IF;
  RAISE NOTICE 'OP5-S1-OK';
END
\$s1\$;"

run_case "S2 SECDEF fail-open 面:owner 對齊三張表、非 FORCE RLS、八欄欄級 INSERT 權" "OP5-S2-OK" "
DO \$s2\$
DECLARE v_owner oid; v_bad text;
BEGIN
  SELECT p.proowner INTO v_owner FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure;
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.order_payments'::regclass, 'public.staff'::regclass)
     AND (c.relowner <> v_owner OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'owner 不對齊或 FORCE RLS on:%', v_bad; END IF;
  SELECT pg_catalog.string_agg(x.col, ', ' ORDER BY x.col) INTO v_bad
    FROM unnest(ARRAY['order_id','rail','amount','received_at','bank_reference','request_id','payer_note','actor']) x(col)
   WHERE NOT pg_catalog.has_column_privilege(v_owner, 'public.order_payments'::regclass, x.col, 'INSERT');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '函式 owner 對這些欄沒有 INSERT 權:%', v_bad; END IF;
  RAISE NOTICE 'OP5-S2-OK';
END
\$s2\$;"

run_case "S3 碼錨 + session_user 反向錨 + 三條順序錨" "OP5-S3-OK" "
DO \$s3\$
DECLARE v_code text; v_body text; v_bad text;
BEGIN
  SELECT p.prosrc INTO v_code FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure;
  -- 🔴 雙線審 MF1+MF2:strpos 取首次命中,而首次命中多半落在**註解**
  --    (實測 IS NOT DISTINCT FROM 在函式內出現十次、首次在註解)⇒ 把六條比較改成 = 而註解留著,
  --    存在性錨與順序錨會全綠。⇒ 先剝行內註解,所有錨對純程式碼比。
  v_body := pg_catalog.regexp_replace(v_code, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY['USING ERRCODE = ''P8C01''','USING ERRCODE = ''P2B38''','USING ERRCODE = ''P2B39''',
                      'USING ERRCODE = ''P2B40''','USING ERRCODE = ''P2B41''','IS NOT DISTINCT FROM',
                      'GET DIAGNOSTICS v_n = ROW_COUNT;','pg_catalog.clock_timestamp()','AND s.is_active']) x(frag)
   WHERE pg_catalog.strpos(v_body, x.frag) = 0;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '碼錨缺失:%', v_bad; END IF;
  IF (pg_catalog.length(v_body) - pg_catalog.length(pg_catalog.replace(v_body, 'IS NOT DISTINCT FROM', '')))
     / pg_catalog.length('IS NOT DISTINCT FROM') <> 6 THEN
    RAISE EXCEPTION '冪等比對不是六條 IS NOT DISTINCT FROM ⇒ 有欄被改成 = 或被刪';
  END IF;
  -- 🔴 codex 關卡2 #5:只數次數擋不住「把 rail 那條換成恆真、再補一條湊數」——
  --    而 rail 那一欄的行為格(N14a)因為 rail 與 bank_reference 必然連動、擋它的可能是 G3。
  --    ⇒ 六組**欄位↔參數的配對**逐字釘住(用正規式吸收對齊空白)。
  SELECT pg_catalog.string_agg(x.col, ' | ' ORDER BY x.col) INTO v_bad
    FROM unnest(ARRAY['v_existing.rail','v_existing.amount','v_existing.received_at',
                      'v_existing.bank_reference','v_existing.payer_note','v_existing.actor']) x(col)
   WHERE v_body !~ (x.col || '[[:space:]]+IS NOT DISTINCT FROM[[:space:]]+(p_|v_)');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些欄沒有自己的 IS NOT DISTINCT FROM 配對(可能被換成恆真或比錯參數):%', v_bad;
  END IF;
  IF pg_catalog.strpos(v_body, 'session_user') <> 0 THEN
    RAISE EXCEPTION '函式體出現 session_user ⇒ 人工軌抄了 OP3 的機器軌身分';
  END IF;
  IF pg_catalog.strpos(v_body, 'GET DIAGNOSTICS v_n = ROW_COUNT;')
     < pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION '順序錨:row_count 守不在 INSERT 之後 ⇒ 恆真';
  END IF;
  IF pg_catalog.strpos(v_body, 'AND s.is_active') > pg_catalog.strpos(v_body, 'FROM public.orders o') THEN
    RAISE EXCEPTION '順序錨:actor 守門排在讀 orders 之後 ⇒ 守門序自己變成訂單狀態 oracle';
  END IF;
  IF pg_catalog.strpos(v_body, 'IS NOT DISTINCT FROM') > pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION '順序錨:冪等樹不在 INSERT 之前 ⇒ 重送會落第二列';
  END IF;
  RAISE NOTICE 'OP5-S3-OK';
END
\$s3\$;"

log "C1 併發:B 真的被 A 的 orders 列鎖擋住"
# 🔴 這格與其他格的紀律**不同**:它必須真的 COMMIT 才量得到鎖等待,所以會在本表留下一列。
#    ⇒ 只在 all 模式跑(跑完整個 cluster 會被 teardown 掉);run 模式一律跳過並記錄,不靜默略過。
# 🔴 FAIL 只綁在**可構造的那一半**:「B 沒有被 A 擋住」。
#    「B 最後是走冪等樹而不是撞 unique」是預期結果、據實記錄 —— 同單的 orders FOR UPDATE
#    已經序列化,unique 真撞在這個情境下本來就構造不出來(Fable R3 #5)。
if [ "$MODE" != "all" ]; then
  skip "C1 併發格:run 模式會在共用庫留下已提交的列 ⇒ 跳過(要跑請用 all 模式)"
else
  C1_OUT="$WORK/c1"; mkdir -p "$C1_OUT"
  C1_ORDER="$(psql "$URL" -qtA -c "SELECT o.id FROM public.orders o WHERE o.payment_status='unpaid'::public.payment_status AND o.cancelled_at IS NULL ORDER BY o.created_at LIMIT 1")"
  C1_REQ="22222222-2222-2222-2222-222222222222"
  if [ -z "$C1_ORDER" ]; then
    bad "C1:找不到乾淨的 unpaid 單當 fixture"
  else
    # 🔴 兩支必須送**逐字相同**的 received_at —— 各自寫 now() 的話兩個時刻不同,
    #    B 會被冪等比對正確地判成竄改(rc<>0),而最終列數仍是 1 ⇒ 那個綠證明的是「竄改被擋」,
    #    不是「重送走冪等樹」。第一版就是這樣,我差點把它當成後者宣稱出去。
    C1_RECV="$(psql "$URL" -qtA -c "SELECT now()")"
    # 🔴🔴 opus 線 MF5:第一版用裸 `pg_sleep(6)` + `sleep 2` 的定時編排 —— plan `B-399` 逐字要求
    #    沿用 w6b/w7b 家族的 barrier + rendezvous、不自己發明,而我沒照做也沒申報。
    #    定時編排的問題不是「會假綠」(BLOCKED 斷言 fail-closed),是**負載機上會不穩**:
    #    B 還沒進到鎖上、或 A 已經先走完,量到的東西就不是同一件事。
    #    ⇒ 改成 **rendezvous**:A 鎖住列之後**有界輪詢**,直到它自己觀察到「有一支在跑本 RPC 且被擋住」
    #      才往下走;等不到就 RAISE(A rc<>0 ⇒ 本格紅),不會靜默降級成「其實沒併發」。
    #    ⚠️ 與 w6c 的差異(申報):w6 家族用 advisory lock 當 gate session;這裡不需要第三個 session,
    #      因為要證的是「B 被 A 擋住」這個**單向**事實,A 自己就能觀察到。判別力相同、少一個 session。
    # A:開交易、鎖住 orders 那一列、等到 B 真的卡在鎖上才提交
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQLA > "$C1_OUT/a.log" 2>&1
BEGIN;
SELECT id FROM public.orders WHERE id = '$C1_ORDER' FOR UPDATE;
DO \$rv\$
DECLARE i integer := 0;
BEGIN
  LOOP
    -- 🔴 實跑抓到的坑:pg_stat_activity 的內容在**同一筆交易內是快取的**,第一次讀到的快照會一直沿用
    --    ⇒ A 永遠看不到「B 後來才卡住」、rendezvous 必逾時。fail-closed 設計讓它紅出來,
    --      而不是靜默退化成「其實沒併發卻全綠」—— 這正是這道逾時的價值。
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
                       WHERE a.pid <> pg_catalog.pg_backend_pid()
                         AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
                         AND a.query ILIKE '%admin_record_manual_payment%');
    i := i + 1;
    IF i > 150 THEN
      RAISE EXCEPTION 'rendezvous 逾時(30 秒):沒有任何 session 卡在本 RPC 的鎖上 ⇒ 這一輪根本沒有併發,本格不成立';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.2);
  END LOOP;
  RAISE NOTICE 'C1-A-SAW-B-BLOCKED';
END
\$rv\$;
SELECT public.admin_record_manual_payment('$C1_ORDER'::uuid, '$C1_REQ'::uuid, 'staff_1', 'cash', 4321, '$C1_RECV'::timestamptz, NULL, NULL);
COMMIT;
SQLA
    ) &
    A_PID=$!
    sleep 1
    # B:同單同 request_id、同輸入,預期先卡在 G5 的 FOR UPDATE 上,醒來後走冪等樹
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQLB > "$C1_OUT/b.log" 2>&1
SELECT public.admin_record_manual_payment('$C1_ORDER'::uuid, '$C1_REQ'::uuid, 'staff_1', 'cash', 4321, '$C1_RECV'::timestamptz, NULL, NULL);
SQLB
    ) &
    B_PID=$!
    # 🔴 不再由外部輪詢 pg_blocking_pids:A 一觀察到 B 被擋就往下走,那個窗口隨即關閉
    #    ⇒ 外部 poll 是在賭時機(實測會漏)。決定性證據改成 **A 自己的 marker**:
    #      A 不可能在沒觀察到「有人卡在本 RPC 的鎖上」的情況下走到那一行(否則它會 RAISE 逾時)。
    wait $A_PID; A_RC=$?
    wait $B_PID; B_RC=$?
    if grep -Fq 'C1-A-SAW-B-BLOCKED' "$C1_OUT/a.log"; then
      ok "C1:A 在提交前**自己觀察到** B 卡在它的 orders 列鎖上(rendezvous 成立,pg_blocking_pids 非空)"
    else
      bad "C1:A 沒落下 rendezvous marker ⇒ 這一輪沒有真的併發(A 逾時或提早走完),本格不成立"
    fi
    C1_ROWS="$(psql "$URL" -qtA -c "SELECT count(*) FROM public.order_payments WHERE order_id = '$C1_ORDER' AND request_id = '$C1_REQ'")"
    if [ "$C1_ROWS" = "1" ]; then
      ok "C1:兩支同 request_id 的呼叫最終恰落一列(A rc=$A_RC B rc=$B_RC)"
    else
      bad "C1:最終落了 $C1_ROWS 列(期望恰 1)⇒ 冪等在真並發下沒守住"
    fi
    # 🔴 「B 走冪等樹」要單獨量,不能從列數推:列數 1 也可能是「B 被判竄改而整筆拒絕」。
    # 🔴🔴 Fable 線 MF2:第一版比 `grep -Fq true` + `grep -Fq idempotent` —— 後者比的是**鍵名**,
    #    而鍵名恆在 ⇒ 不辨值。可構造的全綠假世界:A 鎖住列之後才失敗(rc<>0、錢沒進去),
    #    B 醒來查無列走**新登**(idempotent=false),於是 rows=1 綠、B rc=0 綠、兩個 grep 也綠,
    #    而「B 走冪等樹」整句是假的。⇒ 改成①斷言 A 真的成功(A_RC=0)②比**值**(逐字 idempotent: true)。
    #    值的字面是實跑量的:psql -qtA 對 jsonb 印出 {"recorded": true, "idempotent": true, "payment_id": "…"}。
    if [ "$A_RC" -eq 0 ] && [ "$B_RC" -eq 0 ] && grep -Fq '"idempotent": true' "$C1_OUT/b.log"; then
      ok "C1:A 真的落帳成功(rc=0)且 B 醒來走的是冪等樹(逐字 idempotent: true),不是新登也不是被判竄改"
    else
      bad "C1:B 沒走冪等樹或 A 沒成功(A rc=$A_RC B rc=$B_RC,B 輸出=$(tr '\n' ' ' < "$C1_OUT/b.log" | cut -c1-200))"
    fi
    echo "     (C1 已提交一列,本庫自此不得再跑其他格;all 模式跑完會 teardown 整個 cluster)"
  fi
fi

echo
echo "════ OP5 harness 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"
[ "$FAIL" -eq 0 ] || exit 1
