#!/usr/bin/env bash
#
# ⟦b4-NONCARDPAID1⟧ harness —— **先於碼寫的**(主視窗 2026-09-01 紀律 ②:
#   「plan 裡寫的驗收條件要有一條路讓它必然被檢查 ⇒ 先做 harness, 再寫碼」)。
#   v1 的教訓:那條驗收是我自己寫進 plan 的, 而我沒做, 而 codex 抓到。
#
# 缺陷:客人匯款、後台登記了收款, 而【沒有任何一支函式為匯款翻 payment_status】
#   ⇒ 那張單一直是 unpaid ⇒ 逾期 cron 隔天把它取消掉, 而錢在我們這裡。
#
# 用法:
#   bash scripts/noncardpaid-verify.sh all <workdir>     # provision -> 兩個世界 -> 突變
#   bash scripts/noncardpaid-verify.sh run <workdir>     # 沿用既有的庫
#   🔴 而 `run` 只在【還沒套過受測檔的庫】上有意義:套過之後世界一必然紅
#      (缺陷已經不可重現了)⇒ 那個紅是對的, 不是壞掉。要重跑一律用 `all`。
#   MIGRATION=<path> 可換受測檔(預設 docs/specs/2026-09-01-m4b-noncardpaid-settle-v2.sql)
#   🔴 不含 teardown —— 自己收:PORT=<port> bash scripts/d1t2-rehearsal.sh teardown <workdir>
#
# 🛑 效度限制(照實寫, 不要在報告裡把它省掉):
#   · 這個拋棄式庫【套了所有 migration, 包含還沒 apply 的】⇒ 它的世界 ≠ 正式站的世界。
#     實測:這裡會 SET payment_status 的函式有 4 支, 而正式庫今天是 2 支。
#   · 它不驗「正式站貼下去會怎樣」—— 那要 Sean 貼, 而那是另一個宣稱。
#   · cron 那一格驗的是【述詞會不會選中那張單】, 不是【排程真的有在跑】(本庫是 fake cron)。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: noncardpaid-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54396}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
MIGRATION="${MIGRATION:-docs/specs/2026-09-01-m4b-noncardpaid-settle-v3.sql}"
ROLLBACK_SQL="${ROLLBACK_SQL:-docs/specs/2026-09-01-m4b-noncardpaid-settle-ROLLBACK.sql}"
export LC_ALL=C

# 🔴 自檢:SQL 註解內不得出現反引號 / ASCII 雙引號(照抄 op5-verify.sh 的機制)——
#    本檔所有 SQL 包在 bash 雙引號字串裡 ⇒ 反引號會被 shell 當命令替換執行、雙引號會截斷字串。
SELF_BAD="$(grep -nE '^[[:space:]]+--.*[`"]' "${BASH_SOURCE[0]}" || true)"
if [ -n "$SELF_BAD" ]; then
  echo "🔴 自檢失敗:SQL 註解含反引號或 ASCII 雙引號(會被 shell 執行/截斷):"
  printf '%s\n' "$SELF_BAD" | head -10; exit 2
fi

PASS=0; FAIL=0; SKIP=0
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
# 🔴 skip 【不是綠】—— 它自己一格, 而總結行會把它印出來。
#    一個被跳過的格子與一個通過的格子, 只有這樣才分得開。
skip() { printf '  ⏭  %s\n' "$1"; SKIP=$((SKIP+1)); }
log()  { echo "== $* =="; }

# 那支「第二個掛點」的 trigger 在不在 —— 它決定 W2-5 / M2 兩格跑不跑。
# 🔴 2026-09-01 23:xx:codex 指出第二個掛點會變成【第二個 payment_status 寫入端】
#    (`admin_record_manual_refund` 自 20260823020000 起已呼叫 `pcm_sync_order_refund_payment_status`)
#    ⇒ plan v4 把它拿掉, 而【那個形狀還在等 Sean 重批】
#    ⇒ 📌 所以這兩格不寫死期望值:它在就驗、不在就【明確跳過】, 不假裝通過。
has_refund_trigger() {
  local n; n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'pcm_noncard_settle_after_manual_refund_ai' AND NOT t.tgisinternal" 2>/dev/null || echo 0)"
  [ "$n" = "1" ]
}

case "$WORK" in
  /tmp/[!/]*) : ;;
  *) echo "🔴 workdir 必須是 /tmp/<名字>(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in
  */)   echo "🔴 workdir 不得以斜線結尾"; exit 2 ;;
  *//*) echo "🔴 workdir 不得含連續斜線"; exit 2 ;;
  *..*) echo "🔴 workdir 不得含 .."; exit 2 ;;
esac
[ -L "$WORK" ] && { echo "🔴 workdir 是 symlink"; exit 2; }

cluster_identity() {
  local dd; dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
  [ "$dd" = "$WORK/pgdata" ] || {
    echo "🔴 身分閘:PORT=${PORT} 連到的 data_directory=${dd:-<查不到>},期望 ${WORK}/pgdata ⇒ 連錯庫,拒繼續"; exit 2; }
}

# 每格:跑 SQL -> 驗退出碼 -> 驗 sentinel 真的印出來了
run_case() {
  local name="$1" sentinel="$2" sql="$3" out rc
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    bad "$name:psql rc=$rc ⇒ $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:rc=0 但 sentinel「$sentinel」不在輸出裡 ⇒ 判定無效"; return 1; fi
  ok "$name"
}
# 期望【紅】的格:rc 必須非 0 **而且必須紅在指定的那句話上**。
# 🔴🔴 codex B:73 —— 第一版只看 rc 非 0 ⇒ DROP 失敗、權限錯、fixture 壞掉、函式不存在,
#    全部都會被算成「成功殺死 mutant」。
#    🛑 而更難看的一格:M3 那個「突變沒裝上會自己 RAISE」的設計是【對的】,
#      而這支 helper 從來不讀訊息 ⇒ **我為了分辨兩種紅而寫的那道訊息, 從來沒有被任何東西讀過。**
#    ⇒ 📌 我今晚才剛修過那個突變 —— 我修的是【突變】, 而漏的是【讀它的那一端】。
run_case_expect_red() {
  local name="$1" sentinel="$2" sql="$3" out rc
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "$name:預期紅而它綠了 ⇒ 這一格【殺不掉突變】, 那條驗收是假的"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:紅了, 而【紅在別的地方】—— 找不到「$sentinel」⇒ 這一格證不到突變被殺死。實得:$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-260)"
    return 1; fi
  ok "$name"
}

# ── fixture:一張全新的、三天前建的、未付款的單(含一列品項, 滿足 #13 跨列不變式)──
# 🔴 不借既有訂單:seed 的單各自帶著 attempts / consents, 借到哪一張會改變結果
#    ⇒ 而那個差異在報告上看不出來。全新造 ⇒ 每一格的世界都一樣。
MKORDER=$'  SELECT user_id INTO v_u FROM public.customers ORDER BY user_id LIMIT 1;\n  IF v_u IS NULL THEN RAISE EXCEPTION \'fixture 前提不成立:public.customers 零列 ⇒ 造不出訂單, 而下面每一格都會用別的理由紅\'; END IF;\n  SELECT id INTO v_v FROM public.product_variants ORDER BY id LIMIT 1;\n  IF v_v IS NULL THEN RAISE EXCEPTION \'fixture 前提不成立:public.product_variants 零列 ⇒ 宣稱的「含一列品項」造不出來, 而 cron 那幾格【不看品項】⇒ 它們仍會綠\'; END IF;\n  v_o := pg_catalog.gen_random_uuid();\n  INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,\n                             subtotal, shipping_fee, discount_total, total, shipping_method,\n                             shipping_method_at_checkout, invoice, created_at)\n  VALUES (v_o, (SELECT pg_catalog.string_agg(pg_catalog.substr(\'23456789BCDFGHJKMNPQRSTVWXYZ\', (pg_catalog.floor(pg_catalog.random()*28)+1)::int, 1), \'\') FROM pg_catalog.generate_series(1,6)),\n          v_u, \'{"name":"harness","phone":"0900000000","line":"harness"}\'::jsonb, \'general\',\n          1000, 0, 0, 1000, \'home\', \'home\', \'{"type":"personal"}\'::jsonb, pg_catalog.now() - interval \'3 days\');\n  INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)\n  SELECT v_o, v.id, v.sku, \'{"title":"h","sku":"h","spec":{}}\'::jsonb, 1, 1000, 1000\n    FROM public.product_variants v WHERE v.id = v_v;'

# cron 的述詞:本 harness 直接問「那張單會不會被 expire_unpaid_orders 選中」。
# 🔴 不呼叫那支函式本體 —— 它會真的取消單, 而我們要的是【述詞的判定】, 不是副作用。
#    述詞逐字取自 pcm_cron.expire_unpaid_orders 的 prosrc(下面 S2 那一格會驗它們仍然一致)。

if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17"
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 已存在但缺 .d1t2-harness ownership marker ⇒ 拒絕 rm -rf"; exit 2
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  ok "provision 完成"
fi
cluster_identity

log "G0 harness 自我測試(它自己會不會判紅)"
if run_case "G0(應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 判定失效"; echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1)); ok "G0:壞掉的 SQL 會被判紅"

log "G1 這個庫是不是我以為的那個世界"
run_case "G1 上游物件齊(OP6a / order_payments / order_manual_refunds / expire_unpaid_orders)" "NC-G1-OK" "
DO \$g1\$
BEGIN
  IF to_regprocedure('public.admin_compute_order_settlement(uuid)') IS NULL THEN
    RAISE EXCEPTION 'OP6a 不在 ⇒ 這個庫沒套到 20260811030000'; END IF;
  IF to_regclass('public.order_payments') IS NULL THEN RAISE EXCEPTION 'order_payments 不在'; END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN RAISE EXCEPTION 'order_manual_refunds 不在'; END IF;
  IF to_regprocedure('pcm_cron.expire_unpaid_orders(integer)') IS NULL THEN
    RAISE EXCEPTION 'expire_unpaid_orders 不在'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = 'staff_1' AND is_active) THEN
    RAISE EXCEPTION 'staff_1 不在或已停用 ⇒ 正向格沒有合法 actor'; END IF;
  RAISE NOTICE 'NC-G1-OK';
END \$g1\$;"

run_case "G2 OP6a 結構上看不到 order_manual_refunds(本片第二個掛點存在的理由)" "NC-G2-OK" "
DO \$g2\$
DECLARE v_src text; v_manual integer; v_pay integer;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  v_manual := (SELECT pg_catalog.count(*) FROM regexp_matches(v_src, 'order_manual_refunds', 'g'))::integer;
  v_pay    := (SELECT pg_catalog.count(*) FROM regexp_matches(v_src, 'order_payments', 'g'))::integer;
  IF v_manual <> 0 THEN
    RAISE EXCEPTION 'OP6a 現在讀得到 order_manual_refunds(% 次)⇒ 本片第二個掛點的理由不成立了, 停下重估', v_manual;
  END IF;
  -- 正對照:同一把尺在同一份 prosrc 上要找得到 order_payments, 否則那個 0 只證明尺沒動
  IF v_pay < 1 THEN
    RAISE EXCEPTION '正對照失敗:同一把尺連 order_payments 都找不到 ⇒ 那個 0 沒有判別力';
  END IF;
  RAISE NOTICE 'NC-G2-OK manual=% payments=%', v_manual, v_pay;
END \$g2\$;"

# ══ 世界一:修法【前】—— 缺陷必須可重現 ═══════════════════════════════════
# 🔴 這一段不是裝飾。少了它, 這一片的驗證就是恆綠:
#    「修完會綠」在【本來就綠】與【真的修好了】上印同一個字。
log "世界一(修法前)缺陷可重現"

run_case "W1-1 足額匯款登記後 payment_status 仍是 unpaid(缺陷本體)" "NC-W1-1-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text; v_verdict text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-W1', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  SELECT (public.admin_compute_order_settlement(v_o)->>'verdict') INTO v_verdict;
  -- OP6a 說結清了, 而那張單的狀態沒有動 ⇒ 這兩件事同時為真, 就是缺陷
  IF v_verdict <> 'settled' THEN
    RAISE EXCEPTION 'W1-1 前提不成立:足額收款而 OP6a 判 %(預期 settled)⇒ fixture 或 OP6a 不是我以為的', v_verdict;
  END IF;
  IF v_st <> 'unpaid' THEN
    RAISE EXCEPTION 'W1-1【沒有紅】:狀態已經是 % ⇒ 兩種成因處置相反:①有人已經修好了 ⇒ 本片多餘, 停下確認;②這個庫已經套過本片 ⇒ 世界一沒有意義。不要因為「反正修完會綠」就跳過這一發', v_st;
  END IF;
  RAISE NOTICE 'NC-W1-1-OK verdict=% status=%', v_verdict, v_st;
END \$w\$;
ROLLBACK;"

run_case "W1-2 而那張單會被逾期 cron 真的取消掉(錢在我們這裡)" "NC-W1-2-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_cancelled timestamptz;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-W2', pg_catalog.gen_random_uuid());
  PERFORM pcm_cron.expire_unpaid_orders(500);
  SELECT cancelled_at INTO v_cancelled FROM public.orders WHERE id = v_o;
  IF v_cancelled IS NULL THEN
    RAISE EXCEPTION 'W1-2【沒有紅】:cron 沒有取消那張單 ⇒ 保護已經存在了, 本片的乙那一半多餘, 停下確認';
  END IF;
  RAISE NOTICE 'NC-W1-2-OK 已被 cron 取消 at %', v_cancelled;
END \$w\$;
ROLLBACK;"

# ══ 套用受測檔 ════════════════════════════════════════════════════════════
log "套用受測檔 $MIGRATION"
if [ ! -f "$MIGRATION" ]; then
  bad "受測檔不存在:$MIGRATION ⇒ 世界二整段跑不了"
  echo "════ NONCARDPAID harness 結果:PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
if psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$MIGRATION" > "$WORK/apply.log" 2>&1; then
  ok "受測檔 apply 成功"
else
  bad "受測檔 apply 失敗 ⇒ $(tail -3 "$WORK/apply.log" | tr '\n' ' ' | cut -c1-300)"
  echo "════ NONCARDPAID harness 結果:PASS=$PASS FAIL=$FAIL ════"; exit 1
fi

# ══ 結構 ══════════════════════════════════════════════════════════════════
log "S 結構"
run_case "S1 恰【一支】新 trigger(Sean 2026-09-02 重批:兩個變一個 ⇒ 逐字答甲)" "NC-S1-OK" "
DO \$s1\$
DECLARE v_pay text; v_n integer;
BEGIN
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_pay FROM pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal AND tgname LIKE 'pcm_noncard%';
  IF v_pay IS DISTINCT FROM 'pcm_noncard_settle_after_payment_ai' THEN
    RAISE EXCEPTION 'order_payments 上的本片 trigger = %(預期恰一支)', coalesce(v_pay, '(無)'); END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE 'pcm_noncard%';
  -- 🔴 這一格從「恰 2」改成「恰 1」, 而理由不是少做:
  --    第二個掛點會變成【第二個 payment_status 寫入端】—— 那半自 20260823020000 起
  --    由 admin_record_manual_refund → pcm_sync_order_refund_payment_status 負責。
  --    ⇒ 少的那一個不是漏掉, 是【不該加】。
  IF v_n <> 1 THEN RAISE EXCEPTION '全庫本片 trigger 共 % 支(預期恰 1)', v_n; END IF;
  RAISE NOTICE 'NC-S1-OK';
END \$s1\$;"

# 🔴🔴 codex B:217 —— 第一版是在【含註解的 prosrc】裡搜字串:
#    把真正的 NOT EXISTS 述詞整段刪掉、只留下解釋它的那段註解 ⇒ 它照樣綠。
#    ⇒ 📌 它證明的是【那個字出現過】, 不是【那條腿會篩掉候選單】。那是兩個宣稱。
#    ✅ 改成行為判定:同一發 cron 裡放三張單, 各自代表一條腿, 看誰活下來。
run_case "S2 逾期 cron 兩條腿都【會篩】(行為判定, 不是在 prosrc 裡搜字)" "NC-S2-OK" "
BEGIN;
DO \$s2\$
DECLARE v_u uuid; v_v uuid;
        v_bare uuid; v_card uuid; v_bank uuid;
        v_o uuid;
BEGIN
${MKORDER}
  v_bare := v_o;                       -- 沒收款也沒卡腿 ⇒ 該被取消(對照組:尺會動)
${MKORDER}
  v_card := v_o;                       -- 有非終態卡片 attempt ⇒ 卡片腿該擋住它
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, rec_trade_id, fallback_token_hash)
  VALUES (v_card, v_u, 'pending', NULL, pg_catalog.repeat('a', 64));
${MKORDER}
  v_bank := v_o;                       -- 有匯款收款列 ⇒ 匯款腿該擋住它
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_bank, 'bank_transfer', 1500, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-S2', pg_catalog.gen_random_uuid());

  PERFORM pcm_cron.expire_unpaid_orders(500);

  IF (SELECT cancelled_at FROM public.orders WHERE id = v_bare) IS NULL THEN
    RAISE EXCEPTION 'S2:對照組(沒收款沒卡腿)沒有被取消 ⇒ 這一格的尺沒動, 下面兩個判定沒有判別力';
  END IF;
  IF (SELECT cancelled_at FROM public.orders WHERE id = v_card) IS NOT NULL THEN
    RAISE EXCEPTION 'S2:卡片那條腿沒擋住(帶 pending attempt 的單被取消了)⇒ 本片把既有保護弄掉了';
  END IF;
  IF (SELECT cancelled_at FROM public.orders WHERE id = v_bank) IS NOT NULL THEN
    RAISE EXCEPTION 'S2:匯款那條腿沒擋住(有收款列的單被取消了)⇒ 乙那一半沒有落地';
  END IF;
  RAISE NOTICE 'NC-S2-OK 三張單各自照它那條腿的預期走(對照組被取消 / 卡片與匯款都沒被取消)';
END \$s2\$;
ROLLBACK;"

# ══ 世界二:修法【後】═════════════════════════════════════════════════════
log "世界二(修法後)"

pay_case() {   # $1 名稱 $2 sentinel $3 收款金額 $4 預期狀態
  run_case "$1" "$2" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', $3, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-X', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> '$4' THEN RAISE EXCEPTION '收 $3 之後狀態 =%(預期 $4)', v_st; END IF;
  RAISE NOTICE '$2 status=%', v_st;
END \$w\$;
ROLLBACK;"
}

pay_case "W2-1 足額 1000 ⇒ paid"                      "NC-W2-1-OK" 1000 paid
pay_case "W2-2 部分 400 ⇒ partiallyPaid"              "NC-W2-2-OK" 400  partiallyPaid
# 🔴 溢收【刻意不翻】—— payment_status 的值域裡沒有對應的值(unpaid/paid/partiallyPaid/
#    refunded/partiallyRefunded 共 5 個)⇒ 開一列給人看, 不猜。
#    而「不翻是安全的」這句話依賴乙(cron 不再碰有收款列的單)⇒ 那個依賴由 W2-6 守。
pay_case "W2-3 溢收 1500 ⇒ 刻意不翻(仍 unpaid), 而它的安全性由 W2-6 守" "NC-W2-3-OK" 1500 unpaid

run_case "W2-4 沖銷(負數列)⇒ 重算回去, 不是卡在 paid" "NC-W2-4-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_p uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '2 hours', 'staff_1', 'REF-R1', pg_catalog.gen_random_uuid())
  RETURNING id INTO v_p;
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN RAISE EXCEPTION 'W2-4 前提不成立:足額之後不是 paid 而是 %', v_st; END IF;
  -- 🔴 沖銷列的形狀由 order_payments_rail_fields 決定, 不是我挑的:
  --    reverses_payment_id 非空時, rec_trade_id / bank_reference / request_id 三個都必須是 NULL,
  --    而 reversal_reason 必須非空。(2026-09-01 實跑撞到才知道 —— 第一版餵了 bank_reference 被擋。)
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor,
                                     reverses_payment_id, reversal_reason)
  VALUES (v_o, 'bank_transfer', -1000, pg_catalog.now() - interval '1 hour', 'staff_1',
          v_p, 'harness 沖銷');
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  -- 🔴 codex B:255 —— 第一版只驗「不是 paid」⇒ 寫成 refunded / partiallyRefunded /
  --    partiallyPaid 都會綠。而那三個都是錯的:淨實收回到 0 ⇒ 唯一對的答案是 unpaid。
  --    ⇒ 📌 一個「不等於某個值」的斷言, 涵蓋的是【除了那個值以外的整個世界】。
  IF v_st <> 'unpaid' THEN
    RAISE EXCEPTION 'W2-4:沖銷後淨實收 0, 狀態應為 unpaid, 實得 %(不是「不等於 paid」就算對)', v_st;
  END IF;
  RAISE NOTICE 'NC-W2-4-OK 沖銷後 status=%(確切值, 不是「不是 paid」)', v_st;
END \$w\$;
ROLLBACK;"

# 🔴🔴 這一格是【第二個掛點存在的唯一理由】。
#    OP6a 結構上讀不到 order_manual_refunds(G2 量到 0 次)⇒ 一個只會呼叫 OP6a 的
#    trigger 掛在這張表上, 會很誠實地跑起來而算出【和退款前一模一樣的答案】
#    ⇒ 它不是壞掉, 它是一個 no-op。而 no-op 與正確在測試上長得一樣, 只要你沒測這一格。
if ! has_refund_trigger; then
  skip "W2-5 第二個掛點不在這個庫 ⇒ 本格跳過(plan v4 把它拿掉, 等 Sean 重批;不是通過)"
else
run_case "W2-5 人工退款 ⇒ 不再是 paid(第二個掛點真的有作用, 不是 no-op)" "NC-W2-5-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '2 hours', 'staff_1', 'REF-M1', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN RAISE EXCEPTION 'W2-5 前提不成立:足額之後不是 paid 而是 %', v_st; END IF;
  INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount, reason, actor, occurred_at, request_id)
  VALUES (v_o, 'bank_transfer', 400, 'harness 退款', 'staff_1', pg_catalog.now(), pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st = 'paid' THEN
    RAISE EXCEPTION 'W2-5:退了 400 而狀態還是 paid ⇒ 第二個掛點是 no-op(codex #5)';
  END IF;
  RAISE NOTICE 'NC-W2-5-OK 退款後 status=%', v_st;
END \$w\$;
ROLLBACK;"
fi

# 🔴🔴 W2-9 —— 本片【不碰退款態】。這一格是 codex must-fix A:135 / A:79 / A:107 的守門。
#    第二個 payment_status 寫入端這件事沒有任何三綠抓得到:兩支各自都對, 而它們用不同的分母。
#    ⇒ 這一格證明:有退款活動的時候, 本片【交還】而不是自己算。
run_case "W2-9 有退款活動 ⇒ 本片交還退款管線, 一個字都不碰" "NC-W2-9-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '2 hours', 'staff_1', 'REF-R9', pg_catalog.gen_random_uuid());
  IF (SELECT payment_status::text FROM public.orders WHERE id = v_o) <> 'paid' THEN
    RAISE EXCEPTION 'W2-9 前提不成立:足額之後不是 paid';
  END IF;
  -- 直接插一列人工退款(繞過 RPC ⇒ 退款管線【沒有】被呼叫)
  INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount, reason, actor, occurred_at, request_id)
  VALUES (v_o, 'bank_transfer', 400, 'harness', 'staff_1', pg_catalog.now(), pg_catalog.gen_random_uuid());
  -- 再進一筆收款 ⇒ 本片的 trigger 會被觸發, 而它應該【看到退款活動就交還】
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-R9b', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN
    RAISE EXCEPTION 'W2-9:有退款活動時本片仍然動了狀態(%)⇒ 它變成第二個退款狀態寫入端', v_st;
  END IF;
  RAISE NOTICE 'NC-W2-9-OK 有退款活動 ⇒ 狀態維持 %(交還退款管線)', v_st;
END \$w\$;
ROLLBACK;"

# 🔴🔴 W2-10 —— cron 那條腿的判準是【淨額】不是【有沒有列】(codex must-fix A:241)。
#    收 1000 再全額沖銷 ⇒ 我們手上沒有錢 ⇒ 那張單該恢復可取消。
#    寫成「有沒有列」的話, 它會被歷史那兩列【永久擋住】⇒ 沒有終點的殭屍。
run_case "W2-10 沖銷回淨額 0 的單, cron 又會取消它(判準是淨額不是有沒有列)" "NC-W2-10-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_p uuid; v_c timestamptz;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '2 hours', 'staff_1', 'REF-Z1', pg_catalog.gen_random_uuid())
  RETURNING id INTO v_p;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, reverses_payment_id, reversal_reason)
  VALUES (v_o, 'bank_transfer', -1000, pg_catalog.now() - interval '1 hour', 'staff_1', v_p, 'harness 沖銷');
  IF (SELECT payment_status::text FROM public.orders WHERE id = v_o) <> 'unpaid' THEN
    RAISE EXCEPTION 'W2-10 前提不成立:沖銷回 0 之後不是 unpaid ⇒ 這一格測不到 cron 那條腿';
  END IF;
  PERFORM pcm_cron.expire_unpaid_orders(500);
  SELECT cancelled_at INTO v_c FROM public.orders WHERE id = v_o;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'W2-10:淨額 0 的單沒有被取消 ⇒ 那條腿寫成了「有沒有列」⇒ 這張單永遠沒有終點';
  END IF;
  RAISE NOTICE 'NC-W2-10-OK 淨額 0 ⇒ 恢復可取消(at %)', v_c;
END \$w\$;
ROLLBACK;"

run_case "W2-6 cron 不再取消【有收款列】的單(真的呼叫那支函式 + 同一發裡有對照組)" "NC-W2-6-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_c timestamptz; v_paid uuid; v_bare uuid;
BEGIN
${MKORDER}
  -- 🔴 用溢收那一種:它的 payment_status 仍是 unpaid ⇒ 它【符合 cron 的第一個條件】
  --    ⇒ 唯一能擋住它的就是本片新加的那條腿。若改用 paid 的單, 這一格會被
  --      status 那個條件先擋掉 ⇒ 它會綠, 而綠的理由不是我要測的那個。
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1500, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-C1', pg_catalog.gen_random_uuid());
  IF (SELECT payment_status::text FROM public.orders WHERE id = v_o) <> 'unpaid' THEN
    RAISE EXCEPTION 'W2-6 前提不成立:溢收的單不是 unpaid ⇒ 這一格測不到那條腿';
  END IF;
  v_paid := v_o;
  -- 🔴🔴 codex B:305 —— **同一發 cron 裡放一張對照組。**
  --    第一版只看「我的 fixture 沒被取消」⇒ 而庫裡若有 500 張更舊、更符合條件的單,
  --    LIMIT 500 根本選不到我的 fixture ⇒ **它會因為沒被掃到而綠**, 而綠的理由不是那條腿。
  --    ⇒ 📌 「沒被取消」有兩個成因:被擋住, 與根本沒進候選集。兩者在結果上長得一樣。
  --    ⇒ 對照組進得去 = 這一發真的掃到了這一批, 那個「沒被取消」才有意義。
${MKORDER}
  v_bare := v_o;
  PERFORM pcm_cron.expire_unpaid_orders(500);
  IF (SELECT cancelled_at FROM public.orders WHERE id = v_bare) IS NULL THEN
    RAISE EXCEPTION 'W2-6:對照組(同一發、沒收款)也沒被取消 ⇒ 這一發 cron 根本沒掃到這一批 ⇒ 本格無判別力';
  END IF;
  SELECT cancelled_at INTO v_c FROM public.orders WHERE id = v_paid;
  IF v_c IS NOT NULL THEN
    RAISE EXCEPTION 'W2-6:有收款列的單仍然被 cron 取消了 at % ⇒ 乙那一半沒生效', v_c;
  END IF;
  RAISE NOTICE 'NC-W2-6-OK 有收款的沒被取消, 而同一發的對照組被取消了(⇒ 這一發真的掃到了)';
END \$w\$;
ROLLBACK;"

run_case "W2-7 而 cron 仍然取消【沒收款也沒卡腿】的單(尺還會動 —— 正對照)" "NC-W2-7-OK" "
BEGIN;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_c timestamptz;
BEGIN
${MKORDER}
  PERFORM pcm_cron.expire_unpaid_orders(500);
  SELECT cancelled_at INTO v_c FROM public.orders WHERE id = v_o;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'W2-7:連沒收款的單都不取消了 ⇒ 本片把 cron 弄成恆不動 —— 那比原本的缺陷糟';
  END IF;
  RAISE NOTICE 'NC-W2-7-OK 仍被取消 at %', v_c;
END \$w\$;
ROLLBACK;"

# 🎯 #6:Sean 逐字「錢收了就要記, 不該取決於另一支計算程式跑不跑得動」
run_case "W2-8 OP6a 拋例外時, 收款那一列仍然留得下來(Sean 拍的那條)" "NC-W2-8-OK" "
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_compute_order_settlement(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$boom\$
BEGIN RAISE EXCEPTION 'HARNESS_OP6A_BOOM'; END \$boom\$;
DO \$w\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_n integer; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-B1', pg_catalog.gen_random_uuid());
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'W2-8:計算器炸掉而收款那一列也不見了(% 列)⇒ 錢已經在手上而 DB 記不下來', v_n;
  END IF;
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'unpaid' THEN
    RAISE EXCEPTION 'W2-8:計算器炸掉而狀態竟然被改成 % ⇒ 它憑什麼算得出來', v_st;
  END IF;
  -- 🔴🔴 codex B:343 —— **上面兩個判定, 在「兩個 trigger 都被拿掉」的世界裡【也會全綠】**:
  --    直接 INSERT 收款本來就會留下 1 列, 狀態本來就會維持 unpaid。
  --    ⇒ 📌 它分不出「exception 邊界寫對了」與「根本沒有 trigger」。
  --    ✅ 補一格:證明這個庫裡那支 trigger 是【活的】—— 它存在、啟用中,
  --      而且下面那一發(OP6a 已被還原成正常版之後)會真的翻狀態。
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.order_payments'::regclass
                    AND t.tgname = 'pcm_noncard_settle_after_payment_ai'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'W2-8:那支 trigger 不在或未啟用 ⇒ 上面兩個綠證不到任何東西';
  END IF;
  RAISE NOTICE 'NC-W2-8-OK 收款列還在(% 列), 狀態未被亂改(%), 而那支 trigger 是活的', v_n, v_st;
END \$w\$;
ROLLBACK;"

# ══ 突變證人 ══════════════════════════════════════════════════════════════
# 🔴 這一段回答的是「上面那些綠, 是不是【因為我寫的東西】才綠的」。
#    少了它, 一個什麼都沒做的 trigger 也會讓上面全綠 —— 只要那些格本來就綠。
#    每一格都在交易裡動手, 而 psql 遇錯即止 ⇒ 沒有 COMMIT ⇒ 突變自動回滾。
log "M 突變證人(拿掉一樣東西, 對應那一格必須紅)"

# 🔴🔴 M0 —— **證明 run_case_expect_red 的「看訊息」那一端真的在看。**
#    主視窗 2026-09-01 指出:把「看 rc」換成「看訊息」之後,
#    **「看訊息有沒有真的在看」與「看 rc 有沒有真的在看」是同一個問題。**
#    ⇒ 所以要造一個【會紅、但紅在別的訊息上】的世界, 而它必須被判成【沒殺掉】。
#    ⇒ 📌 這一格與 G0 是同一個動作, 只是對象從「判綠的那一端」換成「判紅的那一端」。
if run_case_expect_red "M0(應該被判沒殺掉)" "M0 如預期" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "M0:一個【紅在別的地方】的世界被判成「殺掉突變」⇒ 那三發突變證人全部作廢"
  echo "════ NONCARDPAID harness 結果:PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1)); ok "M0:紅在別的訊息上時, 它判【沒殺掉】(⇒ 下面三發的 sentinel 是真的在被讀)"

run_case_expect_red "M1 拿掉 order_payments 的 trigger ⇒ W2-1 必須紅" "M1 如預期" "
BEGIN;
DROP TRIGGER pcm_noncard_settle_after_payment_ai ON public.order_payments;
DO \$m\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-M1x', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'paid' THEN RAISE EXCEPTION 'M1 如預期:拿掉 trigger 之後狀態 =%', v_st; END IF;
END \$m\$;
ROLLBACK;"

if ! has_refund_trigger; then
  skip "M2 第二個掛點不在這個庫 ⇒ 本格跳過(不是通過)"
else
run_case_expect_red "M2 拿掉 order_manual_refunds 的 trigger ⇒ W2-5 必須紅" "M2 如預期" "
BEGIN;
DROP TRIGGER pcm_noncard_settle_after_manual_refund_ai ON public.order_manual_refunds;
DO \$m\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '2 hours', 'staff_1', 'REF-M2x', pg_catalog.gen_random_uuid());
  INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount, reason, actor, occurred_at, request_id)
  VALUES (v_o, 'bank_transfer', 400, 'harness', 'staff_1', pg_catalog.now(), pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st = 'paid' THEN RAISE EXCEPTION 'M2 如預期:拿掉 trigger 之後退款不再改狀態(status=%)', v_st; END IF;
END \$m\$;
ROLLBACK;"
fi

run_case_expect_red "M3 把 cron 的匯款那條腿拿掉 ⇒ W2-6 必須紅" "M3 如預期" "
BEGIN;
DO \$m0\$
DECLARE v_def text; v_n integer;
BEGIN
  -- 🔴 用 pg_get_functiondef 整份拿出來改, 不自己重打 LANGUAGE/SECURITY/search_path ——
  --    重打等於【換掉一支不同的函式】, 而那樣這一格測到的就不是原本那一支。
  v_def := pg_catalog.pg_get_functiondef('pcm_cron.expire_unpaid_orders(integer)'::regprocedure);
  v_n := (SELECT pg_catalog.count(*) FROM regexp_matches(v_def, 'np\.order_id = o\.id', 'g'))::integer;
  IF v_n <> 1 THEN
    -- 🛑 突變打不中 ⇒ 這一格會【因為突變沒裝上而紅】, 而那個紅看起來與真的紅一樣。
    --    所以這裡用一個【不同的訊息】自己叫出來, 讓人分得出「突變沒裝上」與「守門有效」。
    RAISE EXCEPTION 'M3 突變沒有裝上:錨 np.order_id = o.id 在函式定義裡出現 % 次(預期恰 1)⇒ 本格作廢', v_n;
  END IF;
  v_def := pg_catalog.replace(v_def, 'np.order_id = o.id', 'np.order_id = o.id AND false');
  EXECUTE v_def;
END \$m0\$;
DO \$m\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_c timestamptz;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1500, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-M3x', pg_catalog.gen_random_uuid());
  PERFORM pcm_cron.expire_unpaid_orders(500);
  SELECT cancelled_at INTO v_c FROM public.orders WHERE id = v_o;
  IF v_c IS NOT NULL THEN RAISE EXCEPTION 'M3 如預期:拿掉那條腿之後單又被取消了 at %', v_c; END IF;
END \$m\$;
ROLLBACK;"


# ══ R 還原段:交件的第二支檔真的還原得了嗎 ═══════════════════════════════
# 🔴 codex must-fix A:320 —— v2 的還原段整段是【註解】, 而檔頭寫「直接貼那一段」。
#    ⇒ 而一個還原段沒有被跑過, 與一個不存在的還原段, 在交件當下長得一樣。
log "R 還原(交件的第二支檔)"
if [ ! -f "$ROLLBACK_SQL" ]; then
  bad "R:還原檔不存在:$ROLLBACK_SQL ⇒ 交件少一半"
else
  if psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$ROLLBACK_SQL" > "$WORK/rollback.log" 2>&1; then
    ok "R1 還原檔整支跑得動(不是註解, 不用挑段落)"
  else
    bad "R1 還原檔跑不動 ⇒ $(tail -3 "$WORK/rollback.log" | tr '\n' ' ' | cut -c1-260)"
  fi
  run_case "R2 還原之後:本片 trigger 沒了, 而【心跳與卡片腿都還在】" "NC-R2-OK" "
DO \$r2\$
DECLARE v_bare text; v_n integer;
BEGIN
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_bare FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE 'pcm_noncard%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'R2:還原後本片 trigger 還剩 % 支', v_n; END IF;
  IF pg_catalog.strpos(v_bare, 'np.order_id = o.id') > 0 THEN
    RAISE EXCEPTION 'R2:那條腿還在 ⇒ 還原沒生效'; END IF;
  -- 🔴 這兩格是重點:一個把心跳一起拆掉的還原, 【不是還原】—— 它是第二次事故。
  IF pg_catalog.strpos(v_bare, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION 'R2:還原把心跳一起拆掉了'; END IF;
  IF pg_catalog.strpos(v_bare, 'payment_charge_attempts') = 0 THEN
    RAISE EXCEPTION 'R2:還原把卡片那條腿一起拆掉了'; END IF;
  RAISE NOTICE 'NC-R2-OK';
END \$r2\$;"
  run_case "R3 而還原之後【缺陷回來了】—— 那是還原的定義, 不是它壞掉" "NC-R3-OK" "
BEGIN;
DO \$r3\$
DECLARE v_o uuid; v_u uuid; v_v uuid; v_st text; v_c timestamptz;
BEGIN
${MKORDER}
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor, bank_reference, request_id)
  VALUES (v_o, 'bank_transfer', 1000, pg_catalog.now() - interval '1 hour', 'staff_1', 'REF-R3', pg_catalog.gen_random_uuid());
  SELECT payment_status::text INTO v_st FROM public.orders WHERE id = v_o;
  IF v_st <> 'unpaid' THEN RAISE EXCEPTION 'R3:還原之後狀態竟然還會翻(%)⇒ 還原沒還乾淨', v_st; END IF;
  PERFORM pcm_cron.expire_unpaid_orders(500);
  SELECT cancelled_at INTO v_c FROM public.orders WHERE id = v_o;
  IF v_c IS NULL THEN RAISE EXCEPTION 'R3:還原之後 cron 竟然還擋著 ⇒ 還原沒還乾淨'; END IF;
  RAISE NOTICE 'NC-R3-OK 缺陷如預期回來了(狀態 unpaid 且被 cron 取消)⇒ 還原是真的';
END \$r3\$;
ROLLBACK;"
fi

echo
echo "════ NONCARDPAID harness 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP ════"
echo "🔴 SKIP 不是綠 —— 被跳過的格子, 它宣稱的那件事【沒有被驗過】。"
echo "🛑 它證不到:正式站貼下去會怎樣(這個庫套了還沒 apply 的 migration, 世界不同);"
echo "   排程真的有在跑(本庫是 fake cron);金額以外的業務正確性。"
echo "   跑完自己收:PORT=$PORT bash scripts/d1t2-rehearsal.sh teardown $WORK"
[ "$FAIL" -eq 0 ] || exit 1
