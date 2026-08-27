#!/usr/bin/env bash
# ============================================================
# OP-A12 行為 harness —— admin_reverse_manual_payment(人工軌沖銷)+ 兩支開權終態
#
# 骨架、判定紀律、自檢與 neg_case 全部沿用 scripts/op5-verify.sh(同一家族,不另發明)。
# 差異只有三處,其餘照舊:
#   · 本片**已開權** ⇒ 除了以 owner 跑行為格,另有一格用 SET LOCAL ROLE service_role
#     跑真正向流程(ACL 斷言只證得到權限,證不到「真的寫得進去」)。
#   · 沖銷**沒有冪等**:同一列第二次沖銷一律具名拒,不是回 idempotent。
#   · G7 刻意不擋已取消 / 退款態 ⇒ 那兩格是**正向**格(在 OP5 那邊它們是負向)。
#
# ⚠️ 誠實邊界:SET LOCAL ROLE 不等於真 LOGIN(繞過 pooler 與正式 DSN),
#    那一半只有 apply 後對正式連線實測才算數 —— 同 op3-verify 的字面。
#
# 用法:bash scripts/opa12-verify.sh all <workdir>   /   PORT=… bash … run <workdir>
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: opa12-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54378}"
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
  run_case "$name" "A12-NEG-OK" "
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
      IF pg_catalog.strpos(coalesce(v_msg,''), 'admin_reverse_manual_payment:') <> 1 THEN
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
    RAISE NOTICE 'A12-NEG-OK';
END
\$neg\$;
ROLLBACK;"
}
# 沖銷 fixture:先用 OP5 登一筆人工款,回傳它的 id 給沖銷用。
# 🔴 用真的 OP5 RPC 而不是直接 INSERT —— 直接 INSERT 會繞過 OP5 的守門,
#    造出正式路徑產不出來的列,那樣測的就不是真實形狀。
SEED_PAYMENT=$'  v_pid := (public.admin_record_manual_payment(v_o, gen_random_uuid(), \'staff_1\', \'cash\', 500, v_created, NULL, NULL) ->> \'payment_id\')::uuid;'

if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17(含 OP-A12)"
  require_free_port
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 已存在但缺 .d1t2-harness ownership marker ⇒ 拒絕 rm -rf"; exit 2
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

log "G1 對照組:A12 在 + 兩支已開權 + 上游守門在"
run_case "G1 A12 函式在、兩支 service_role 可執行、四支 trigger 啟用中" "A12-G1-OK" "
DO \$g1\$
DECLARE v_names text;
BEGIN
  IF to_regprocedure('public.admin_reverse_manual_payment(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A12 函式不在 ⇒ 這個庫沒套過本片';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role','public.admin_reverse_manual_payment(uuid,text,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '兩支沒有同時開權 ⇒ 分期開權的解鎖點沒生效';
  END IF;
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal AND tgenabled = 'O';
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION '上游 trigger 集合不對:%', coalesce(v_names,'(無)');
  END IF;
  RAISE NOTICE 'A12-G1-OK';
END
\$g1\$;"

log "P1 正向:沖 cash 收款列,逐欄"
run_case "P1 沖銷列逐欄:反號/指向/理由/識別欄全 NULL/received_at 跟著被沖那筆" "A12-P1-OK" "
BEGIN;
DO \$p1\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_res jsonb;
        v_row public.order_payments%ROWTYPE; v_n integer;
BEGIN
$FIXTURE
$SEED_PAYMENT
  v_res := public.admin_reverse_manual_payment(v_pid, 'staff_1', '  打錯金額  ');
  IF (v_res->>'reversed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'reversed 不是 true:%', v_res; END IF;
  IF v_res ? 'idempotent' THEN RAISE EXCEPTION '回傳不該有 idempotent 欄(本支沒有冪等):%', v_res; END IF;
  SELECT * INTO v_row FROM public.order_payments WHERE id = (v_res->>'reversal_id')::uuid;
  IF v_row.amount IS DISTINCT FROM -500 THEN RAISE EXCEPTION '金額不是反號:%', v_row.amount; END IF;
  IF v_row.reverses_payment_id IS DISTINCT FROM v_pid THEN RAISE EXCEPTION '沒指向被沖的那一列'; END IF;
  IF v_row.reversal_reason IS DISTINCT FROM '打錯金額' THEN RAISE EXCEPTION '理由沒被正規化:[%]', v_row.reversal_reason; END IF;
  IF v_row.rail IS DISTINCT FROM 'cash' THEN RAISE EXCEPTION 'rail 沒跟著被沖那筆'; END IF;
  IF v_row.order_id IS DISTINCT FROM v_o THEN RAISE EXCEPTION 'order_id 不對'; END IF;
  IF v_row.received_at IS DISTINCT FROM v_created THEN RAISE EXCEPTION 'received_at 沒跟著被沖那筆'; END IF;
  IF v_row.actor IS DISTINCT FROM 'staff_1' THEN RAISE EXCEPTION 'actor 不對'; END IF;
  IF v_row.rec_trade_id IS NOT NULL OR v_row.bank_reference IS NOT NULL OR v_row.request_id IS NOT NULL THEN
    RAISE EXCEPTION '沖銷列不得帶任何識別欄';
  END IF;
  IF v_row.reviewed_by IS NOT NULL OR v_row.reviewed_at IS NOT NULL THEN RAISE EXCEPTION '不該寫複核欄'; END IF;
  SELECT pg_catalog.sum(amount)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '沖銷後該單淨額應為 0,實得 %', v_n; END IF;
  RAISE NOTICE 'A12-P1-OK';
END
\$p1\$;
ROLLBACK;"

log "P2 正向:沖銷之沖銷(鏈)+ SUM 回到原值"
run_case "P2 P(+500)→R1(−500)→R2(+500):鏈成立且 SUM=500" "A12-P2-OK" "
BEGIN;
DO \$p2\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_r1 uuid; v_n integer;
BEGIN
$FIXTURE
$SEED_PAYMENT
  v_r1 := (public.admin_reverse_manual_payment(v_pid, 'staff_1', '誤沖前的沖銷') ->> 'reversal_id')::uuid;
  PERFORM public.admin_reverse_manual_payment(v_r1, 'staff_1', '沖銷之沖銷:上一筆沖錯了');
  SELECT pg_catalog.sum(amount)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 500 THEN RAISE EXCEPTION '鏈式沖銷後 SUM 應回到 500,實得 %', v_n; END IF;
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 3 THEN RAISE EXCEPTION '應有三列(P/R1/R2),實得 %', v_n; END IF;
  RAISE NOTICE 'A12-P2-OK';
END
\$p2\$;
ROLLBACK;"

log "P3-P4 正向:G7 刻意留白 —— 已取消單 / 退款態單都要沖得掉"
# 🔴 這兩格在 OP5 那邊是**負向**(登錄被拒);在本支必須是**正向**。
#    突變靶:把 OP5 的 allowlist 抄進 A12,這兩格必紅。
for scen in cancelled refunded; do
  run_case "P3x $scen 的單仍可沖銷(#372:沖銷不受 allowlist 限)" "A12-PX-OK" "
BEGIN;
DO \$px\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_n integer;
BEGIN
$FIXTURE
$SEED_PAYMENT
  IF '$scen' = 'cancelled' THEN
    UPDATE public.orders SET cancelled_at = now(), cancelled_reason = 'A12 fixture' WHERE id = v_o;
  ELSE
    UPDATE public.orders SET payment_status = 'refunded'::public.payment_status WHERE id = v_o;
  END IF;
  PERFORM public.admin_reverse_manual_payment(v_pid, 'staff_1', '$scen 單的更正');
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o AND reverses_payment_id = v_pid;
  IF v_n <> 1 THEN RAISE EXCEPTION '$scen 單的沖銷被擋掉了'; END IF;
  RAISE NOTICE 'A12-PX-OK';
END
\$px\$;
ROLLBACK;"
done

log "P5 正向:以 service_role 身分跑真流程(ACL 斷言證不到「真的寫得進去」)"
run_case "P5 SET LOCAL ROLE service_role ⇒ 登錄 + 沖銷兩支都跑得完" "A12-P5-OK" "
BEGIN;
DO \$p5\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_n integer;
BEGIN
$FIXTURE
  EXECUTE 'SET LOCAL ROLE service_role';
$SEED_PAYMENT
  PERFORM public.admin_reverse_manual_payment(v_pid, 'staff_1', 'service_role 路徑');
  EXECUTE 'RESET ROLE';
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 2 THEN RAISE EXCEPTION 'service_role 路徑沒落兩列(收款+沖銷),實得 %', v_n; END IF;
  RAISE NOTICE 'A12-P5-OK';
END
\$p5\$;
ROLLBACK;"

GEN='==admin_reverse_manual_payment: 沖銷失敗'
SEED_PRE=$'  DECLARE v_pid uuid;\n  BEGIN\n  NULL;\n  END;'

log "N1-N6 負向"
neg_case "N1 卡軌具名拒" "pcm_opa12_card_rail" \
  "PERFORM public.admin_reverse_manual_payment((SELECT op.id FROM public.order_payments op WHERE op.rail='card' LIMIT 1), 'staff_1', '試沖卡軌');" \
  "  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
   VALUES (v_o, 'card', 800, v_created, 'A12-CARD-PROBE', 'staff_1');"
neg_case "N2 沖銷理由空白拒" "" \
  "PERFORM public.admin_reverse_manual_payment(gen_random_uuid(), 'staff_1', '   ');" "" \
  "沖銷理由必填"
neg_case "N3 收款列不存在 ⇒ 逐字通用訊息(不洩存在與否)" "" \
  "PERFORM public.admin_reverse_manual_payment('00000000-0000-0000-0000-0000000000ee'::uuid, 'staff_1', '不存在');" "" \
  "$GEN"
neg_case "N4 actor 不存在" "pcm_opa12_actor_invalid" \
  "PERFORM public.admin_reverse_manual_payment(gen_random_uuid(), 'nobody_here', '理由');"
# 🔴 nit(opus#13):p_payment_id NULL 的守門原本零負向格 —— 它是唯一沒有任何格碰過的入口參數。
#    ⚠️ 同一條 finding 的另一半「它是唯一沒有 ERRCODE/CONSTRAINT 的守門」**實查不成立**:
#       :107/:111/:117/:130/:174 五處都沒有 ERRCODE(通用訊息那族刻意如此)⇒ 不改 ERRCODE,只補格。
#       沒有 conname 的閘走 want_con='' 那條路:比 SQLSTATE=P0001 + 本 RPC 具名前綴 + 訊息片段。
neg_case "N10 p_payment_id 為 NULL ⇒ 具名拒(不是走到 G4 查無)" "" \
  "PERFORM public.admin_reverse_manual_payment(NULL::uuid, 'staff_1', '理由');" "" \
  "收款列識別碼缺失"
neg_case "N5 actor 存在但已停用" "pcm_opa12_actor_invalid" \
  "PERFORM public.admin_reverse_manual_payment(gen_random_uuid(), 'payment_confirmer', '理由');"

run_case "N6 同一列第二次沖銷 ⇒ pcm_opa12_already_reversed(不是回冪等成功)" "A12-N6-OK" "
BEGIN;
DO \$n6\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_con text; v_n integer;
BEGIN
$FIXTURE
$SEED_PAYMENT
  PERFORM public.admin_reverse_manual_payment(v_pid, 'staff_1', '第一次');
  BEGIN
    PERFORM public.admin_reverse_manual_payment(v_pid, 'staff_1', '第一次');
    RAISE EXCEPTION '同一列被沖第二次竟然放行' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_opa12_already_reversed' THEN
        RAISE EXCEPTION '第二次沖銷被 [%] 擋住,期望 pcm_opa12_already_reversed', coalesce(v_con,'(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  SELECT count(*)::integer INTO v_n FROM public.order_payments WHERE reverses_payment_id = v_pid;
  IF v_n <> 1 THEN RAISE EXCEPTION '沖銷列應恰一列,實得 %', v_n; END IF;
  RAISE NOTICE 'A12-N6-OK';
END
\$n6\$;
ROLLBACK;"

log "N7 隔離閘 / N8 靜默吞列 / N9 A9 回歸"
run_case "N7 REPEATABLE READ ⇒ P8C01" "A12-N7-OK" "
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
DO \$n7\$
DECLARE v_state text;
BEGIN
  BEGIN
    PERFORM public.admin_reverse_manual_payment(gen_random_uuid(), 'staff_1', '理由');
    RAISE EXCEPTION '非 READ COMMITTED 竟然放行' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state IS DISTINCT FROM 'P8C01' THEN
        RAISE EXCEPTION '被擋但 SQLSTATE=%,期望 P8C01', v_state USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'A12-N7-OK';
END
\$n7\$;
ROLLBACK;"

run_case "N8 BEFORE INSERT 回 NULL ⇒ 紅在 pcm_opa12_row_count" "A12-N8-OK" "
BEGIN;
DO \$seed\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid;
BEGIN
$FIXTURE
$SEED_PAYMENT
  CREATE TEMP TABLE a12_probe(pid uuid) ON COMMIT DROP;
  INSERT INTO a12_probe VALUES (v_pid);
END
\$seed\$;
CREATE FUNCTION pg_temp.a12_swallow() RETURNS trigger LANGUAGE plpgsql AS \$sw\$ BEGIN RETURN NULL; END \$sw\$;
CREATE TRIGGER aaa_a12_probe_swallow_bi BEFORE INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION pg_temp.a12_swallow();
DO \$n8\$
DECLARE v_pid uuid; v_con text;
BEGIN
  SELECT pid INTO v_pid FROM a12_probe;
  BEGIN
    PERFORM public.admin_reverse_manual_payment(v_pid, 'staff_1', '吞列探針');
    RAISE EXCEPTION '列被靜默吞掉卻回成功' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_opa12_row_count' THEN
        RAISE EXCEPTION '擋它的是 [%],期望 pcm_opa12_row_count', coalesce(v_con,'(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'A12-N8-OK';
END
\$n8\$;
ROLLBACK;"

# 🔴 A9 回歸格:本片不自己驗反號,那是 OP2b 的職責 ⇒ 這格證「A9 仍在守」。
#    直接 INSERT(繞過本 RPC)一列金額不是反號的沖銷列,必須紅在 P2B33。
run_case "N9 A9 回歸:手工塞非反號沖銷列 ⇒ 紅在 pcm_op2b_reversal_amount_mismatch" "A12-N9-OK" "
BEGIN;
DO \$n9\$
DECLARE v_o uuid; v_total integer; v_created timestamptz; v_pid uuid; v_con text;
BEGIN
$FIXTURE
$SEED_PAYMENT
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
    VALUES (v_o, 'cash', -499, v_created, v_pid, '金額對不上', 'staff_1');
    RAISE EXCEPTION '非反號的沖銷列竟然寫得進去 ⇒ A9 沒在守' USING ERRCODE = '$SENTINEL_CODE';
  EXCEPTION
    WHEN SQLSTATE '$SENTINEL_CODE' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op2b_reversal_amount_mismatch' THEN
        RAISE EXCEPTION '擋它的是 [%],期望 A9 的 pcm_op2b_reversal_amount_mismatch', coalesce(v_con,'(無)')
          USING ERRCODE = '$SENTINEL_CODE';
      END IF;
  END;
  RAISE NOTICE 'A12-N9-OK';
END
\$n9\$;
ROLLBACK;"

log "S1-S2 結構:兩支的 ACL 終態 / 碼錨與順序錨"
run_case "S1 ACL 終態:兩支 service_role=真、anon/authenticated/authenticator=假" "A12-S1-OK" "
DO \$s1\$
DECLARE v_bad text;
BEGIN
  SELECT pg_catalog.string_agg(s.sig || ':' || x.r, ', ' ORDER BY s.sig, x.r) INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig),
         unnest(ARRAY['anon','authenticated','authenticator']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r, s.sig, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '開權開太寬:%', v_bad; END IF;
  SELECT pg_catalog.string_agg(s.sig, ', ') INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig)
   WHERE NOT pg_catalog.has_function_privilege('service_role', s.sig, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'service_role 拿不到 EXECUTE:%', v_bad; END IF;
  -- 🔴🔴 must-fix #8(Fable F2)閉世界:上面兩道都是**具名清單** ⇒ 對清單外角色全盲。
  --    這一份是**可重跑**的那個面:migration 檔尾那道只在 apply 當下成立,
  --    「apply 之後有人誤 GRANT 給自訂 role」只有這裡抓得到。
  --    proacl IS NULL 一併擋(函式預設 PUBLIC 可 EXECUTE,且 aclexplode(NULL) 回零列 = 恆綠洞)。
  SELECT pg_catalog.string_agg(s.sig, ', ' ORDER BY s.sig) INTO v_bad
    FROM unnest(ARRAY['public.admin_reverse_manual_payment(uuid,text,text)',
                      'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)']) s(sig)
   WHERE (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = s.sig::regprocedure) IS NULL;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'proacl 是 NULL(%)⇒ REVOKE 沒執行過,預設 PUBLIC 可 EXECUTE', v_bad; END IF;
  SELECT pg_catalog.string_agg(x.sig || ':' || x.grantee, ', ' ORDER BY x.sig, x.grantee) INTO v_bad
    FROM (
      SELECT p.oid::regprocedure::text AS sig,
             CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid IN ('public.admin_reverse_manual_payment(uuid,text,text)'::regprocedure,
                       'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure)
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              -- 🔴 codex 關卡2 R1 #2:grantee 對了還不夠,WITH GRANT OPTION 也要擋。
              --    實測:先 GRANT 帶 WITH GRANT OPTION、再下一道普通 GRANT,is_grantable
              --    仍然是 true(普通 GRANT 不會拔掉 grant option),而本片對 service_role
              --    只 GRANT、沒 REVOKE ⇒ 既有的轉授權原封活過本片,閉世界照樣綠。
              --    有 grant option = service_role 可以自己再轉授給任何人 ⇒ 閉世界名存實亡。
              OR g.is_grantable)
    ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '閉世界被打破:% ⇒ 兩種可能:①{owner, service_role} 以外的 grantee '
                    '②允許集合內的角色帶了 WITH GRANT OPTION', v_bad;
  END IF;
  RAISE NOTICE 'A12-S1-OK';
END
\$s1\$;"

run_case "S2 碼錨(剝註解後比)+ 三條順序錨" "A12-S2-OK" "
DO \$s2\$
DECLARE v_code text; v_body text; v_bad text;
BEGIN
  SELECT p.prosrc INTO v_code FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_reverse_manual_payment(uuid,text,text)'::regprocedure;
  v_body := pg_catalog.regexp_replace(v_code, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  -- 🔴 雙線審 must-fix #2(opus#4=Fable F1):本清單原本 7 個片段、migration 那份 8 個,
  --    少的正是 FOR UPDATE ⇒ 刪掉 G5 的 orders 鎖時,這一關接不住。已補齊對齊。
  -- 🔴 must-fix #3:順序錨 fail-open —— strpos(A)>strpos(B) 在運算元缺席時是 0>N = 恆假、不紅。
  --    ⇒ 順序錨用到的運算元全部進本清單;本檢查 RAISE 在比序之前,比序那三行拿不到 0。
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY['USING ERRCODE = ''P8C01''','USING ERRCODE = ''P2B42''','USING ERRCODE = ''P2B43''',
                      'USING ERRCODE = ''P2B44''','FOR NO KEY UPDATE','FOR UPDATE',
                      'GET DIAGNOSTICS v_n = ROW_COUNT;','AND s.is_active',
                      'FROM public.orders o','FROM public.order_payments op',
                      'INSERT INTO public.order_payments']) x(frag)
   WHERE pg_catalog.strpos(v_body, x.frag) = 0;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '碼錨缺失:%', v_bad; END IF;
  IF pg_catalog.strpos(v_body, 'AND s.is_active') > pg_catalog.strpos(v_body, 'FROM public.order_payments op') THEN
    RAISE EXCEPTION '順序錨:actor 守門排在讀帳本之後';
  END IF;
  IF pg_catalog.strpos(v_body, 'FROM public.orders o') > pg_catalog.strpos(v_body, 'FOR NO KEY UPDATE') THEN
    RAISE EXCEPTION '順序錨:鎖 orders 不在鎖 target 之前 ⇒ 違反 orders 到 order_payments 的鎖序契約(a2b1 預防性規定;死結本身在今天的 writer 集合下構造不出,見 C2 邊界)';
  END IF;
  IF pg_catalog.strpos(v_body, 'GET DIAGNOSTICS v_n = ROW_COUNT;')
     < pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION '順序錨:row_count 守不在 INSERT 之後 ⇒ 恆真';
  END IF;
  RAISE NOTICE 'A12-S2-OK';
END
\$s2\$;"

# ══ C1-C2 併發(must-fix #4:opus#6)═══════════════════════════════════════════
# 🔴 本片原本**零併發格**,而 migration 檔頭有兩句**併發面**的宣稱,在場每一格卻都是單 session:
#    ①「鎖序 orders → order_payments,與 OP5 同向」
#    ②「G5 鎖 orders 之後 G6 必須回頭鎖 target 並重讀」
#    ⇒ 本區補觀察。**但只補到一半**:①的死結那半實測構造不出(見 C2 上方的邊界段),
#      檔頭已同批改成「a2b1 推論 + 未來多 writer 時重估」,鎖序的守門落在 S2 順序錨。
# 🔴 這兩格與其他格紀律不同:必須真的 COMMIT 才量得到鎖等待 ⇒ 只在 all 模式跑、跑完庫就髒,
#    因此排在所有格之後(run_case 的「本表零殘列」斷言對它們不適用)。
# ⚠️ 誠實邊界:rendezvous 逾時**也可能是機器太慢**而非被測物壞(w7b:79 同款申報);
#    fail-closed ⇒ 寧可紅,不會靜默退化成「其實沒併發卻全綠」。
log "C1-C2 併發:A12×A12 同列 / A12×OP5 同單"
if [ "$MODE" != "all" ]; then
  skip "C1 A12×A12 同列併發:run 模式會留下已提交的列 ⇒ 跳過(要跑請用 all 模式)"
  skip "C2 A12×OP5 同單併發:同上"
  skip "C3 G6 target 列鎖(第三方持鎖 + lock_timeout):同上"
else
  CC_OUT="$WORK/cc"; mkdir -p "$CC_OUT"
  CC_ORDER="$(psql "$URL" -qtA -c "SELECT o.id FROM public.orders o WHERE o.payment_status='unpaid'::public.payment_status AND o.cancelled_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.order_payments op WHERE op.order_id = o.id) ORDER BY o.created_at LIMIT 1")"
  if [ -z "$CC_ORDER" ]; then
    bad "C1-C2:找不到乾淨且零收款列的 unpaid 單當 fixture"
  else
    CC_RECV="$(psql "$URL" -qtA -c "SELECT now()")"
    CC_PID1="$(psql "$URL" -qtA -c "SELECT (public.admin_record_manual_payment('$CC_ORDER'::uuid, gen_random_uuid(), 'staff_1', 'cash', 700, '$CC_RECV'::timestamptz, NULL, NULL) ->> 'payment_id')")"
    # ── C1:兩支 A12 沖同一列 ────────────────────────────────────────────────
    # A 先鎖住 orders 那一列,等到自己觀察到「有人卡在 admin_reverse_manual_payment 的鎖上」才沖並提交;
    # B 必定先卡在 G5,醒來後 G8 應該具名拒(**不是** unique backstop 的通用訊息 —— 兩者可分辨,
    # 這正是這一格對「G6 鎖後重讀 + G8」的判別力)。
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQLA > "$CC_OUT/c1a.log" 2>&1
BEGIN;
SELECT id FROM public.orders WHERE id = '$CC_ORDER' FOR UPDATE;
DO \$rv\$
DECLARE i integer := 0;
BEGIN
  LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();   -- 同交易內是快取快照,不清就永遠看不到 B
    -- 🔴 codex 關卡2 R1 nit-2:原本只問「有某個跑這支的 session 被某人擋住」——
    --    擋它的是不是**我**沒問 ⇒ 這個觀察沒有身分判別力。改成問「阻擋者清單裡有我」。
    EXIT WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
                       WHERE a.pid <> pg_catalog.pg_backend_pid()
                         AND pg_catalog.pg_backend_pid() = ANY (pg_catalog.pg_blocking_pids(a.pid))
                         AND a.query ILIKE '%admin_reverse_manual_payment%');
    i := i + 1;
    IF i > 150 THEN
      RAISE EXCEPTION 'rendezvous 逾時(30 秒):沒有任何 session 卡在 A12 的鎖上 ⇒ 這一輪沒有併發,本格不成立';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.2);
  END LOOP;
  RAISE NOTICE 'C1-A-SAW-B-BLOCKED';
END
\$rv\$;
SELECT public.admin_reverse_manual_payment('$CC_PID1'::uuid, 'staff_1', 'A 的沖銷');
COMMIT;
SQLA
    ) &
    CC_A=$!
    sleep 1
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQLB > "$CC_OUT/c1b.log" 2>&1
SELECT public.admin_reverse_manual_payment('$CC_PID1'::uuid, 'staff_1', 'B 的沖銷');
SQLB
    ) &
    CC_B=$!
    wait $CC_A; CC_A_RC=$?
    wait $CC_B; CC_B_RC=$?
    if grep -Fq 'C1-A-SAW-B-BLOCKED' "$CC_OUT/c1a.log"; then
      ok "C1:A 在提交前自己觀察到 B 卡在它的 orders 列鎖上(rendezvous 成立 ⇒ 兩支真的被 G5 序列化)"
    else
      bad "C1:A 沒落下 rendezvous marker ⇒ 這一輪沒有真的併發(A 逾時或提早走完),本格不成立"
    fi
    # 🔴 只斷言「B 失敗」是不夠的:B 若因 unique backstop 而失敗,訊息是通用的、G8 等於沒被證到。
    #    ⇒ 比**具名**約束(名字本身 locale 無關;LC_ALL=C 已在檔頭設,標籤字面不比)。
    if [ "$CC_A_RC" -eq 0 ] && [ "$CC_B_RC" -ne 0 ] \
       && grep -Fq 'pcm_opa12_already_reversed' "$CC_OUT/c1b.log" && grep -Fq 'P2B44' "$CC_OUT/c1b.log"; then
      ok "C1:A 成功、B 具名拒 pcm_opa12_already_reversed/P2B44(不是 unique backstop 的通用訊息)"
    else
      bad "C1:期望 A rc=0 且 B 被 G8 具名拒,實得 A rc=$CC_A_RC B rc=$CC_B_RC(B 輸出=$(tr '\n' ' ' < "$CC_OUT/c1b.log" | cut -c1-220))"
    fi
    CC_N="$(psql "$URL" -qtA -c "SELECT count(*) FROM public.order_payments WHERE reverses_payment_id = '$CC_PID1'")"
    if [ "$CC_N" = "1" ]; then
      ok "C1:同一列在真併發下最終恰一筆沖銷(一列只沖一次守住)"
    else
      bad "C1:同一列落了 $CC_N 筆沖銷(期望恰 1)"
    fi
    # ── C2:A12 與 OP5 併發同一張單 ────────────────────────────────────────────
    # 🔴🔴 **本格的判別力邊界(實測結論,不是推測)**:我寫完後跑突變 M8c ——
    #    把 A12 的鎖序**整個反過來**(先 target NKU、再 orders FOR UPDATE)裝進活庫重跑本格,
    #    結果 **A12 rc=0 / OP5 rc=0 / 零 40P01 / rendezvous 照樣成立 = 本格全綠**。
    #    ⇒ 本格**證不到**「鎖序同向所以不死結」。原因不是骨架寫壞,是那個死結**構造不出來**:
    #      OP5 插的是一列 `reverses_payment_id IS NULL` 的新收款列,不會去要任何既有收款列的鎖
    #      ⇒ 兩支的鎖集合**只在 orders 那一列重疊**,單一共用資源不構成循環等待。
    #      窮舉過的交錯:A12×OP5 同單 / A12×A12 同列 / A12×A12 同單不同列 —— 都構造不出循環。
    # ⇒ **鎖序真正的守門是 S2 的順序錨**(`strpos(orders) < strpos(FOR NO KEY UPDATE)`),
    #    同一個 M8c 突變下它**紅了**(實測)。本格守的是另一件事,寫在下面 ok() 的字面裡。
    # ⇒ 檔頭 migration:33-35 那句「反向寫兩支併發就是死結」已同批改成 a2b1 推論而非本片觀察。
    CC_PID2="$(psql "$URL" -qtA -c "SELECT (public.admin_record_manual_payment('$CC_ORDER'::uuid, gen_random_uuid(), 'staff_1', 'cash', 900, '$CC_RECV'::timestamptz, NULL, NULL) ->> 'payment_id')")"
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQLC > "$CC_OUT/c2a.log" 2>&1
BEGIN;
SELECT id FROM public.orders WHERE id = '$CC_ORDER' FOR UPDATE;
DO \$rv2\$
DECLARE i integer := 0;
BEGIN
  LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    -- 🔴 codex 關卡2 R1 nit-2:原本只問「有某個跑這支的 session 被某人擋住」——
    --    擋它的是不是**我**沒問 ⇒ 這個觀察沒有身分判別力。改成問「阻擋者清單裡有我」。
    EXIT WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
                       WHERE a.pid <> pg_catalog.pg_backend_pid()
                         AND pg_catalog.pg_backend_pid() = ANY (pg_catalog.pg_blocking_pids(a.pid))
                         AND a.query ILIKE '%admin_record_manual_payment%');
    i := i + 1;
    IF i > 150 THEN
      RAISE EXCEPTION 'rendezvous 逾時(30 秒):沒有任何 session 卡在 OP5 的鎖上 ⇒ 這一輪沒有併發,本格不成立';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.2);
  END LOOP;
  RAISE NOTICE 'C2-A-SAW-B-BLOCKED';
END
\$rv2\$;
SELECT public.admin_reverse_manual_payment('$CC_PID2'::uuid, 'staff_1', 'A12 側沖銷');
COMMIT;
SQLC
    ) &
    CC_C=$!
    sleep 1
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQLD > "$CC_OUT/c2b.log" 2>&1
SELECT public.admin_record_manual_payment('$CC_ORDER'::uuid, gen_random_uuid(), 'staff_1', 'cash', 1100, '$CC_RECV'::timestamptz, NULL, NULL);
SQLD
    ) &
    CC_D=$!
    wait $CC_C; CC_C_RC=$?
    wait $CC_D; CC_D_RC=$?
    if grep -Fq 'C2-A-SAW-B-BLOCKED' "$CC_OUT/c2a.log"; then
      ok "C2:A12 側在提交前觀察到 OP5 側卡在同一張單的 orders 列鎖上(兩支真的互相序列化)"
    else
      bad "C2:沒落下 rendezvous marker ⇒ 這一輪沒有真的併發,本格不成立"
    fi
    # 🔴 R3 F2:原本 ok 字面宣稱「帳本兩列都落地」卻沒有任何列數斷言 —— 兩支 rc=0 只證「沒報錯」,
    #    證不到兩邊各自的列真的在。⇒ 兩邊各補一條直接計數。
    CC_N2R="$(psql "$URL" -qtA -c "SELECT count(*) FROM public.order_payments WHERE reverses_payment_id = '$CC_PID2'")"
    CC_N2P="$(psql "$URL" -qtA -c "SELECT count(*) FROM public.order_payments WHERE order_id = '$CC_ORDER' AND amount = 1100 AND reverses_payment_id IS NULL")"
    if [ "$CC_C_RC" -eq 0 ] && [ "$CC_D_RC" -eq 0 ] \
       && ! grep -Fq '40P01' "$CC_OUT/c2a.log" && ! grep -Fq '40P01' "$CC_OUT/c2b.log" \
       && [ "$CC_N2R" = "1" ] && [ "$CC_N2P" = "1" ]; then
      ok "C2:A12 與 OP5 併發同單兩支都完成、零 40P01,且**兩邊的列都實際查得到**(A12 側沖銷列 $CC_N2R 筆 / OP5 側收款列 $CC_N2P 筆)⇒ 互不擋死也不互相吃掉;鎖序那件事由 S2 順序錨守,見上方邊界"
    else
      bad "C2:期望兩支都成功、無死結、兩邊各落一列,實得 A12 rc=$CC_C_RC OP5 rc=$CC_D_RC 沖銷列=$CC_N2R 收款列=$CC_N2P(40P01 見 $CC_OUT/c2*.log)"
    fi
    # ── C3:G6 真的對 target 取了列鎖嗎(codex 關卡2 R1 #3 打穿的地方)────────────
    # 🔴 codex 的 finding + 我實測確認:把 **G6 的 FOR NO KEY UPDATE 整條拿掉**,
    #    C1 的四個斷言**仍然全綠**(實得 A rc=0 / B rc=3 / B 仍被 G8 具名拒 / 沖銷列恰 1)——
    #    因為 G5 的 orders 鎖已經把 B 擋到 A 提交之後、G8 自然接手擋。
    #    ⇒ C1 證的是「序列化 + 鎖後重讀的**結果** + G8」,**證不到 G6 那把鎖本身**(codex R2 nit)。
    # ⇒ 本格直接觀察那把鎖:第三方先握住 target 列的 NKU,A12 進來必定卡在 G6
    #    ⇒ 用 lock_timeout 把它變成可判定的 55P03;G6 的鎖若被拿掉,A12 會一路走完 ⇒ 紅。
    # 🔴 codex R2 #2:光有 55P03 **證不到卡在哪** —— 若剛好有人握著同一張 orders 列,
    #    A12 會在 G5 逾時、同樣吐 55P03,即使 G6 的鎖被刪掉也假綠。
    #    ⇒ 開跑前先用 NOWAIT 探針證明 **orders 那一列是空的**(拿得到就立刻放掉);
    #      orders 既然沒被鎖,55P03 就只可能來自 G6 要的那把 target 鎖。
    # 🔴 codex R2 nit:holder 的就緒**不能用 sleep 賭** —— 慢機器上 A12 可能先跑完 ⇒ 正確的
    #    G6 也會假紅。改成 holder 取到鎖後印 marker,主流程有界輪詢等 marker 出現才放行。
    CC_PID3="$(psql "$URL" -qtA -c "SELECT (public.admin_record_manual_payment('$CC_ORDER'::uuid, gen_random_uuid(), 'staff_1', 'cash', 1300, '$CC_RECV'::timestamptz, NULL, NULL) ->> 'payment_id')")"
    (
      psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQLH > "$CC_OUT/c3holder.log" 2>&1
BEGIN;
SELECT id FROM public.order_payments WHERE id = '$CC_PID3' FOR NO KEY UPDATE;
\echo C3-HOLDER-READY
SELECT pg_catalog.pg_sleep(20);
ROLLBACK;
SQLH
    ) &
    CC_H=$!
    CC_READY=0
    for _i in $(seq 1 120); do
      if grep -Fq 'C3-HOLDER-READY' "$CC_OUT/c3holder.log" 2>/dev/null; then CC_READY=1; break; fi
      sleep 0.25
    done
    if [ "$CC_READY" -ne 1 ]; then
      bad "C3:holder 在 30 秒內沒取到 target 列鎖 ⇒ 本格前提不成立(不當成綠也不當成被測物壞)"
    fi
    CC_ORDFREE=0
    if psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "BEGIN; SELECT id FROM public.orders WHERE id = '$CC_ORDER' FOR UPDATE NOWAIT; ROLLBACK;" >/dev/null 2>&1; then
      CC_ORDFREE=1
    fi
    if [ "$CC_ORDFREE" -ne 1 ]; then
      bad "C3:開跑前 orders 那一列就被別人鎖著 ⇒ 之後的 55P03 分不出是 G5 還是 G6,本格判定作廢"
    fi
    psql "$URL" -qtA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$CC_OUT/c3.log" 2>&1 <<SQLE
SET lock_timeout = '3s';
SELECT public.admin_reverse_manual_payment('$CC_PID3'::uuid, 'staff_1', '應該卡在 G6');
SQLE
    CC_E_RC=$?
    wait $CC_H 2>/dev/null || true
    if [ "$CC_E_RC" -ne 0 ] && [ "$CC_READY" -eq 1 ] && [ "$CC_ORDFREE" -eq 1 ] && grep -Fq '55P03' "$CC_OUT/c3.log"; then
      ok "C3:orders 列已證為空(NOWAIT 探針)+ 第三方握著 target 列 NKU ⇒ A12 吃到 55P03,那把鎖只可能是 G6 要的 target 鎖"
    else
      bad "C3:期望 A12 被 target 列鎖擋住(55P03),實得 rc=$CC_E_RC ⇒ ①G6 可能根本沒鎖,**或** ②極慢機器上 holder 的 20 秒已先到期、鎖早就放掉了(R3 F3:兩者從這裡分不出來,先看 $CC_OUT/c3holder.log 的時間再判)。輸出=$(tr '\n' ' ' < "$CC_OUT/c3.log" | cut -c1-200)"
    fi
    CC_N3="$(psql "$URL" -qtA -c "SELECT count(*) FROM public.order_payments WHERE reverses_payment_id = '$CC_PID3'")"
    if [ "$CC_N3" = "0" ]; then
      ok "C3:被鎖擋住的那次沖銷零落帳(fail-closed,沒有半套寫入)"
    else
      bad "C3:被擋住卻仍落了 $CC_N3 筆沖銷列"
    fi
    echo "     (C1-C3 已提交列,本庫自此不得再跑其他格。🔴 本腳本**不會**自己 teardown ——"
    echo "      跑完請自己收:PORT=$PORT bash scripts/d1t2-rehearsal.sh teardown $WORK)"
  fi
fi

echo
echo "════ OP-A12 harness 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"
[ "$FAIL" -eq 0 ] || exit 1
