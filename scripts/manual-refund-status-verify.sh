#!/usr/bin/env bash
#
# ⟦b4-MANREFUNDNOOWNER⟧ harness —— 人工退款之後 payment_status 沒有主人。
#
# 缺陷:admin_record_manual_refund 寫 `order_manual_refunds`, 然後呼叫
#   pcm_sync_order_refund_payment_status —— 而那支只加總 `order_refunds`
#   ⇒ 它算到 0 ⇒ 提早 return ⇒ **狀態從來沒有被改過**。
#   🔴 而檔名 `..._record_calls_sync.sql` 是誠實的:它真的呼叫了。
#     「A 呼叫了 B」與「B 做了那件事」是兩個宣稱, 而檔名只答得出前一個。
#
# 用法:
#   bash scripts/manual-refund-status-verify.sh all <workdir>
#   🔴 `all` 會自己 provision;重跑一律用 `all`(套過受測檔之後世界一必然紅, 而那個紅是對的)
#   🔴 不含 teardown:PORT=<port> bash scripts/d1t2-rehearsal.sh teardown <workdir>
#
# 🛑 效度限制:
#   · 拋棄式庫套了【所有】migration 含還沒貼的 ⇒ 它的世界 ≠ 正式站的世界
#   · 它不驗「正式站貼下去會怎樣」—— 那要 Sean 貼, 那是另一個宣稱
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: manual-refund-status-verify.sh all <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54410}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
MIGRATION="${MIGRATION:-docs/specs/2026-09-02-m4b-manual-refund-status-owner.sql}"
ROLLBACK_SQL="${ROLLBACK_SQL:-docs/specs/2026-09-02-m4b-manual-refund-status-owner-ROLLBACK.sql}"
export LC_ALL=C

SELF_BAD="$(grep -nE '^[[:space:]]+--.*[`"]' "${BASH_SOURCE[0]}" || true)"
if [ -n "$SELF_BAD" ]; then
  echo "🔴 自檢失敗:SQL 註解含反引號或 ASCII 雙引號:"; printf '%s\n' "$SELF_BAD" | head -5; exit 2
fi

PASS=0; FAIL=0; SKIP=0
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log()  { echo "== $* =="; }

case "$WORK" in /tmp/[!/]*) : ;; *) echo "🔴 workdir 必須是 /tmp/<名字>"; exit 2 ;; esac
case "$WORK" in */)   echo "🔴 不得以斜線結尾"; exit 2 ;; *//*) echo "🔴 不得含連續斜線"; exit 2 ;; *..*) echo "🔴 不得含 .."; exit 2 ;; esac
[ -L "$WORK" ] && { echo "🔴 workdir 是 symlink"; exit 2; }

cluster_identity() {
  local dd; dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
  [ "$dd" = "$WORK/pgdata" ] || { echo "🔴 身分閘:連到的是 ${dd:-<查不到>},期望 ${WORK}/pgdata,拒繼續"; exit 2; }
}

run_case() {
  local name="$1" sentinel="$2" sql="$3" out rc
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then bad "$name:psql rc=$rc ⇒ $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:rc=0 但 sentinel「$sentinel」不在輸出裡 ⇒ 判定無效"; return 1; fi
  ok "$name"
}
# 🔴 預期紅的格:要紅【而且紅在指定的那句話上】。
#    只看 rc 非 0 ⇒ DROP 失敗、權限錯、fixture 壞掉都會被算成「殺死 mutant」。
run_case_expect_red() {
  local name="$1" sentinel="$2" sql="$3" out rc
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then bad "$name:預期紅而它綠了 ⇒ 這一格殺不掉突變"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:紅了而【紅在別的地方】—— 找不到「$sentinel」。實得:$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-240)"; return 1; fi
  ok "$name"
}

# fixture:一張【已付款】的單(卡片那條路的正常終態)+ 一列品項(#13 跨列不變式)
MKPAID=$'  SELECT user_id INTO v_u FROM public.customers ORDER BY user_id LIMIT 1;\n  IF v_u IS NULL THEN RAISE EXCEPTION \'fixture 前提不成立:customers 零列\'; END IF;\n  SELECT id INTO v_v FROM public.product_variants ORDER BY id LIMIT 1;\n  IF v_v IS NULL THEN RAISE EXCEPTION \'fixture 前提不成立:product_variants 零列\'; END IF;\n  v_o := pg_catalog.gen_random_uuid();\n  INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,\n                             subtotal, shipping_fee, discount_total, total, shipping_method,\n                             shipping_method_at_checkout, invoice, payment_status, created_at)\n  VALUES (v_o, (SELECT pg_catalog.string_agg(pg_catalog.substr(\'23456789BCDFGHJKMNPQRSTVWXYZ\', (pg_catalog.floor(pg_catalog.random()*28)+1)::int, 1), \'\') FROM pg_catalog.generate_series(1,6)),\n          v_u, \'{"name":"h","phone":"0900000000","line":"h"}\'::jsonb, \'general\',\n          1000, 0, 0, 1000, \'home\', \'home\', \'{"type":"personal"}\'::jsonb, \'paid\'::public.payment_status, pg_catalog.now() - interval \'3 days\');\n  INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)\n  SELECT v_o, v.id, v.sku, \'{"title":"h","sku":"h","spec":{}}\'::jsonb, 1, 1000, 1000 FROM public.product_variants v WHERE v.id = v_v;\n  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)\n  VALUES (v_o, \'bank_transfer\', 1000, pg_catalog.now() - interval \'2 hours\', \'staff_1\', \'REF-MR\', pg_catalog.gen_random_uuid());'

if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17"
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 存在但缺 ownership marker ⇒ 拒絕 rm -rf"; exit 2; fi
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

log "G1 這個庫是不是我以為的那個世界"
run_case "G1 三個物件都在(同步器 / 兩張退款表 / 登記 RPC)" "MR-G1-OK" "
DO \$g1\$
BEGIN
  IF to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)') IS NULL THEN
    RAISE EXCEPTION '同步器不在'; END IF;
  IF to_regclass('public.order_refunds') IS NULL THEN RAISE EXCEPTION 'order_refunds 不在'; END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN RAISE EXCEPTION 'order_manual_refunds 不在'; END IF;
  IF to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '登記 RPC 不在'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = 'staff_1' AND is_active) THEN
    RAISE EXCEPTION 'staff_1 不在或已停用'; END IF;
  RAISE NOTICE 'MR-G1-OK';
END \$g1\$;"

run_case "G2 同步器現在【讀不到】人工那本帳(缺陷的結構證據)" "MR-G2-OK" "
DO \$g2\$
DECLARE v_src text; v_m integer; v_c integer;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  v_m := (SELECT pg_catalog.count(*) FROM regexp_matches(v_src, 'order_manual_refunds', 'g'))::integer;
  v_c := (SELECT pg_catalog.count(*) FROM regexp_matches(v_src, 'order_refunds', 'g'))::integer;
  IF v_m <> 0 THEN RAISE EXCEPTION 'G2:同步器已經讀得到人工那本帳(% 次)⇒ 有人先修了, 停下確認', v_m; END IF;
  IF v_c < 1 THEN RAISE EXCEPTION 'G2 正對照失敗:同一把尺連 order_refunds 都找不到 ⇒ 那個 0 沒有判別力'; END IF;
  RAISE NOTICE 'MR-G2-OK manual=% card=%', v_m, v_c;
END \$g2\$;"

log "世界一(修法前)缺陷可重現"
run_case "W1-1 已付款單登記人工退款 ⇒ 狀態【仍是 paid】(缺陷本體)" "MR-W1-1-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness 退款', pg_catalog.now());
  IF (SELECT count(*) FROM public.order_manual_refunds WHERE order_id = v_o) <> 1 THEN
    RAISE EXCEPTION 'W1-1 前提不成立:退款沒有登記進帳本 ⇒ 這一格測不到狀態';
  END IF;
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN
    RAISE EXCEPTION 'W1-1【沒有紅】:狀態已經是 % ⇒ ①有人修好了 ⇒ 本片多餘, 停下確認;②這個庫已套過本片 ⇒ 世界一沒有意義', v_st;
  END IF;
  RAISE NOTICE 'MR-W1-1-OK 退了 400 而狀態仍是 %', v_st;
END \$w\$;
ROLLBACK;"

log "套用受測檔 $MIGRATION"
if [ ! -f "$MIGRATION" ]; then
  bad "受測檔不存在:$MIGRATION"; echo "════ PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"; exit 1; fi
if psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$MIGRATION" > "$WORK/apply.log" 2>&1; then
  ok "受測檔 apply 成功"
else
  bad "受測檔 apply 失敗 ⇒ $(tail -3 "$WORK/apply.log" | tr '\n' ' ' | cut -c1-300)"
  echo "════ PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"; exit 1
fi

log "世界二(修法後)"
run_case "W2-1 已付款單退 400(共 1000)⇒ partiallyRefunded" "MR-W2-1-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness 部分退', pg_catalog.now());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'partiallyRefunded' THEN RAISE EXCEPTION 'W2-1:退 400 之後狀態 =%(預期 partiallyRefunded)', v_st; END IF;
  RAISE NOTICE 'MR-W2-1-OK status=%', v_st;
END \$w\$;
ROLLBACK;"

run_case "W2-2 已付款單退滿 1000 ⇒ refunded" "MR-W2-2-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'cash', 1000, 'harness 全退', pg_catalog.now());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'refunded' THEN RAISE EXCEPTION 'W2-2:退滿之後狀態 =%(預期 refunded)', v_st; END IF;
  RAISE NOTICE 'MR-W2-2-OK status=%', v_st;
END \$w\$;
ROLLBACK;"

# 🔴 作廢的退款不算 —— 那張表刻意沒有 status, voided_at 是它唯一的「不算數」訊號。
run_case "W2-3 退款被作廢(voided_at 非空)⇒ 不計入 ⇒ 狀態回不到退款域" "MR-W2-3-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount, reason, actor, occurred_at, request_id, voided_at, void_reason, voided_by)
  VALUES (v_o, 'bank_transfer', 400, 'harness', 'staff_1', pg_catalog.now(), pg_catalog.gen_random_uuid(),
          pg_catalog.now(), 'harness 作廢', 'staff_1');
  SELECT public.pcm_sync_order_refund_payment_status(v_o) INTO v_st;
  IF v_st <> 'paid' THEN
    RAISE EXCEPTION 'W2-3:作廢過的退款被算成錢真的退出去了(狀態 =%)⇒ 少了 voided_at IS NULL 那道篩', v_st;
  END IF;
  RAISE NOTICE 'MR-W2-3-OK 作廢的不算, 狀態維持 %', v_st;
END \$w\$;
ROLLBACK;"

# 🔴🔴 這一格是【回歸守門】—— 本檔差一點就會弄壞一個今天能用的流程。
run_case "W2-4 unpaid 的單被人工退款 ⇒ 不拋錯、狀態不變(保護分支)" "MR-W2-4-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  UPDATE public.orders SET payment_status = 'unpaid'::public.payment_status WHERE id = v_o;
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness unpaid 退款', pg_catalog.now());
  IF (SELECT count(*) FROM public.order_manual_refunds WHERE order_id = v_o) <> 1 THEN
    RAISE EXCEPTION 'W2-4:登記【失敗】了 ⇒ 本檔弄壞了一個今天能用的流程(這正是那個保護分支要防的事)';
  END IF;
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'unpaid' THEN RAISE EXCEPTION 'W2-4:unpaid 的單被改成 % ⇒ 本檔越界去動了另一件事的缺口', v_st; END IF;
  RAISE NOTICE 'MR-W2-4-OK 登記成功且狀態維持 %', v_st;
END \$w\$;
ROLLBACK;"

# 🟢 正對照:卡片那條路一個字都沒改, 它要照舊會動。
run_case "W2-5 卡片那條路行為不變(confirmed 的 order_refunds ⇒ partiallyRefunded)" "MR-W2-5-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  UPDATE public.orders SET tappay_rec_trade_id = 'REC-MR5-' || pg_catalog.substr(v_o::text, 1, 8) WHERE id = v_o;
  INSERT INTO public.order_refunds (order_id, rec_trade_id, bank_refund_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before, confirmed_at)
  VALUES (v_o, 'REC-MR5-' || pg_catalog.substr(v_o::text, 1, 8), 'BR-' || pg_catalog.substr(v_o::text, 1, 12), 400, 'processing', 'harness', 'staff_1', pg_catalog.gen_random_uuid()::text, 'partial', 0, NULL);
  -- 🔴 帳本的狀態機:INSERT 初態必須是 processing, confirmed 只能【轉】過去(實跑撞到才知道)
  UPDATE public.order_refunds SET status = 'confirmed', confirmed_at = pg_catalog.now(),
         tappay_refund_id = 'TR-' || pg_catalog.substr(v_o::text, 1, 10)
   WHERE order_id = v_o AND status = 'processing';
  SELECT public.pcm_sync_order_refund_payment_status(v_o) INTO v_st;
  IF v_st <> 'partiallyRefunded' THEN
    RAISE EXCEPTION 'W2-5:卡片那條路壞了(狀態 =%, 預期 partiallyRefunded)⇒ 本檔動到了不該動的那半', v_st;
  END IF;
  RAISE NOTICE 'MR-W2-5-OK 卡片那條路照舊 ⇒ %', v_st;
END \$w\$;
ROLLBACK;"

log "M 突變證人"
run_case_expect_red "M1 把人工那本帳的 SUM 拿掉 ⇒ W2-1 必須紅" "M1 如預期" "
BEGIN;
DO \$m0\$
DECLARE v_def text; v_n integer;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure);
  v_n := (SELECT pg_catalog.count(*) FROM regexp_matches(v_def, 'v_moved := v_card \\+ v_manual;', 'g'))::integer;
  IF v_n <> 1 THEN RAISE EXCEPTION 'M1 突變沒有裝上:錨出現 % 次(預期恰 1)⇒ 本格作廢', v_n; END IF;
  v_def := pg_catalog.replace(v_def, 'v_moved := v_card + v_manual;', 'v_moved := v_card;');
  EXECUTE v_def;
END \$m0\$;
DO \$m\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness', pg_catalog.now());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'partiallyRefunded' THEN RAISE EXCEPTION 'M1 如預期:拿掉人工那半之後狀態 =%', v_st; END IF;
END \$m\$;
ROLLBACK;"

run_case_expect_red "M2 把保護分支拿掉 ⇒ W2-4 必須紅(登記會失敗)" "M2 如預期" "
BEGIN;
DO \$m0\$
DECLARE v_def text; v_n integer;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure);
  v_n := (SELECT pg_catalog.count(*) FROM regexp_matches(v_def, 'IF v_card = 0 THEN', 'g'))::integer;
  IF v_n <> 1 THEN RAISE EXCEPTION 'M2 突變沒有裝上:錨出現 % 次(預期恰 1)⇒ 本格作廢', v_n; END IF;
  v_def := pg_catalog.replace(v_def, 'IF v_card = 0 THEN', 'IF false THEN');
  EXECUTE v_def;
END \$m0\$;
DO \$m\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_err text;
BEGIN
${MKPAID}
  UPDATE public.orders SET payment_status = 'unpaid'::public.payment_status WHERE id = v_o;
  BEGIN
    PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness', pg_catalog.now());
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'M2:拿掉保護分支之後登記竟然還是成功的 ⇒ W2-4 那一格證不到那個分支'; END IF;
  RAISE EXCEPTION 'M2 如預期:拿掉保護分支之後登記失敗了(%)', pg_catalog.left(v_err, 80);
END \$m\$;
ROLLBACK;"

log "R 還原"
if [ ! -f "$ROLLBACK_SQL" ]; then
  bad "R:還原檔不存在:$ROLLBACK_SQL ⇒ 交件少一半"
else
  if psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$ROLLBACK_SQL" > "$WORK/rollback.log" 2>&1; then
    ok "R1 還原檔整支跑得動(不是註解, 不用挑段落)"
  else
    bad "R1 還原檔跑不動 ⇒ $(tail -3 "$WORK/rollback.log" | tr '\n' ' ' | cut -c1-260)"
  fi
  run_case "R2 還原之後缺陷回來了, 而【卡片那條路仍然好的】" "MR-R2-OK" "
BEGIN;
DO \$r\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  PERFORM public.admin_record_manual_refund(v_o, pg_catalog.gen_random_uuid(), 'staff_1', 'bank_transfer', 400, 'harness', pg_catalog.now());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN RAISE EXCEPTION 'R2:還原之後人工退款竟然還會改狀態(%)⇒ 還原沒還乾淨', v_st; END IF;
END \$r\$;
DO \$r2\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKPAID}
  UPDATE public.orders SET tappay_rec_trade_id = 'REC-R2-' || pg_catalog.substr(v_o::text, 1, 8) WHERE id = v_o;
  INSERT INTO public.order_refunds (order_id, rec_trade_id, bank_refund_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before, confirmed_at)
  VALUES (v_o, 'REC-R2-' || pg_catalog.substr(v_o::text, 1, 8), 'BR2-' || pg_catalog.substr(v_o::text, 1, 12), 400, 'processing', 'harness', 'staff_1', pg_catalog.gen_random_uuid()::text, 'partial', 0, NULL);
  -- 🔴 帳本的狀態機:INSERT 初態必須是 processing, confirmed 只能【轉】過去(實跑撞到才知道)
  UPDATE public.order_refunds SET status = 'confirmed', confirmed_at = pg_catalog.now(),
         tappay_refund_id = 'TR-' || pg_catalog.substr(v_o::text, 1, 10)
   WHERE order_id = v_o AND status = 'processing';
  SELECT public.pcm_sync_order_refund_payment_status(v_o) INTO v_st;
  IF v_st <> 'partiallyRefunded' THEN
    RAISE EXCEPTION 'R2:還原把卡片那條路也弄壞了(%)⇒ 那不是還原', v_st;
  END IF;
  RAISE NOTICE 'MR-R2-OK 缺陷如預期回來了, 而卡片那條路仍然是 %', v_st;
END \$r2\$;
ROLLBACK;"
fi

echo
echo "════ MANUAL-REFUND-STATUS harness 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"
echo "🛑 它證不到:正式站貼下去會怎樣(這個庫套了還沒貼的 migration);並發;UI 那一層。"
echo "   跑完自己收:PORT=$PORT bash scripts/d1t2-rehearsal.sh teardown $WORK"
[ "$FAIL" -eq 0 ] || exit 1
