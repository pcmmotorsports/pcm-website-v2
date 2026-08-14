#!/usr/bin/env bash
# ============================================================
# `#473b-1` 併發與繞路負測(codex 關卡2 must-fix:staged diff 缺雙連線實測)
# ============================================================
# 用法:
#   bash scripts/d1t2-rehearsal.sh provision /tmp/r473b1     # 拋棄式 PG、套全部 migration
#   bash scripts/473b1-concurrency-probe.sh                  # 本檔
#   bash scripts/d1t2-rehearsal.sh teardown /tmp/r473b1
#
# 🔴 為什麼一定要跑:本片的正確性論證有兩根柱子,**兩根都是推論、不是觀察**:
#   ① 「G4 NKU + G6b CAS 擋得住兩個交易同時更正同一列」
#   ② 「FK 取的 KEY SHARE 與 NKU 不會死結」(A2b1 的 40P01 是 FOR UPDATE 版的案底)
#   推論寫得再漂亮也不是證據 —— memory `feedback_unconstructible-negative-test-means-noop-guard`。
#
# 🔴 socket 路徑長度:PG 的 Unix socket 上限 103 bytes ⇒ workdir 必須短(`/tmp/r473b1`),
#    放進 scratchpad 那種長路徑會 FATAL(2026-08-14 實測)。
#
# ── 🔴🔴 本檔第一版有兩格假綠,修法留在這裡當判例 ──────────────────────────────
# 病徵:S2「走 RPC 更正成功」與 S9「零死結」都印 ok,**但當時什麼都沒發生** ——
#   fixture 根本沒種進去。`q()` 把 psql 的**錯誤訊息**當成回傳值塞進變數,
#   而我的判準是 `[ -n "$C1" ]`(非空)⇒ 錯誤訊息也非空 ⇒ 恆真。
# 修法三條(以後寫 probe 一律照做):
#   ① **判「非空」沒有判別力,要驗形狀**(這裡驗 uuid;數字就驗數字、錯誤碼就比對五碼)。
#   ② **前置失敗要 `exit 1`,不要讓後續格繼續印** —— 後面每一格都在對不存在的資料斷言。
#   ③ **fixture 種完要獨立數一次它真的在**,而不是「指令沒報錯」就算數。
set -uo pipefail

URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
AURL="${URL}?application_name=r473b1_a"
BURL="${URL}?application_name=r473b1_b"
W="${1:-/tmp/r473b1-probe}"
mkdir -p "$W"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -tAX -c "$1" 2>&1; }
errcode() { psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$1" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1; }

# ── 身分閘:不對錯的庫跑 ──────────────────────────────────────────────────
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SELECT to_regclass('public.order_refund_manual_corrections') IS NOT NULL")" = "t" ] \
  || { echo "🔴 #473b-1 未套用;先跑 provision;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC 預設;拒跑"; exit 1; }
echo "== #473b-1 併發/繞路負測 =="

# ── 種資料 ────────────────────────────────────────────────────────────────
# order_refunds 的 INSERT 守門要求初態 processing + 訂單白名單態 + rec_trade_id,
# 而**本片測的是更正 RPC、不是那些守門** ⇒ 種資料時暫關 USER trigger,種完立刻開回來。
# 🔴 fixture 一次寫完、用 -v ON_ERROR_STOP=1 —— 上一版把錯誤文字存進變數再往下跑，
#    結果 S2/S9 兩格在什麼都沒發生的情況下印 ok = 假綠。現在種不出來就直接 exit。
cat > "$W/seed.sql" <<'SEED'
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.orders DISABLE TRIGGER USER;
ALTER TABLE public.order_refunds DISABLE TRIGGER USER;
-- 🔴 可重跑:先清掉上一輪的 fixture(固定 uuid ⇒ 第二次跑必撞 orders_pkey)。
--    順序 = 子表先清(FK),更正表 → 退款 → 訂單。
DELETE FROM public.order_refund_manual_corrections
 WHERE refund_id IN ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
DELETE FROM public.order_refunds WHERE order_id = '22222222-2222-2222-2222-222222222222';
DELETE FROM public.orders WHERE id = '22222222-2222-2222-2222-222222222222';
-- customers.user_id → auth.users(id);拋棄式庫裡沒有任何 auth 使用者,先種一個。
-- 🔴 email 一定要給:`handle_new_auth_user()` trigger 會自動把 NEW.email 灌進 customers,
--    而 customers.email 是 NOT NULL ⇒ 少給就爆在**別人的 trigger 裡**、訊息看起來與本片無關。
INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'probe473b1@example.test')
  ON CONFLICT DO NOTHING;
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout, payment_status,
   fulfillment_status, subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
   order_source, payment_channel, version, invoice_status, shipping_free_threshold, shipping_home_fee,
   shipping_method_at_checkout, tappay_rec_trade_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'PCM-2026-9001',
        '11111111-1111-1111-1111-111111111111',
        '{"name":"probe","phone":"0900000000","line":"test"}'::jsonb, 'general', 'paid',
        'notOrdered', 10000, 0, 0, 10000, 'home', '{"type":"personal"}'::jsonb,
        'web', 'tappay', 1, 'not_issued', 5000, 100, 'home', 'rec_r473b1');
-- 🔴 欄位以**現行 schema** 為準,不是建表那支:`items_amount` / `shipping_*` 已被後續
--    migration 拿掉(2026-08-14 對拋棄式庫實查 pg_attribute 才發現,不是照 20260725130100 抄)。
INSERT INTO public.order_refunds
  (id, order_id, bank_refund_id, refund_amount, status, reason, actor, request_id,
   failed_reason, failed_detail, rec_trade_id, kind, record_refunded_before)
VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        'br_r473b1_a', 3000, 'failed', 'probe', 'probe_actor', 'req_seed',
        'manual_failed', 'Record 差額 0', 'rec_r473b1', 'partial', 0),
       ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
        'br_r473b1_b', 1000, 'failed', 'probe2', 'probe_actor', 'req_seed2',
        'manual_failed', 'Record 差額 0', 'rec_r473b1', 'partial', 0);
ALTER TABLE public.orders ENABLE TRIGGER USER;
ALTER TABLE public.order_refunds ENABLE TRIGGER USER;
COMMIT;
SEED
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$W/seed.sql" > "$W/seed.log" 2>&1 \
  || { echo "🔴 種資料失敗，拒跑；輸出："; cat "$W/seed.log"; exit 1; }
OID_='22222222-2222-2222-2222-222222222222'
RID='33333333-3333-3333-3333-333333333333'
RID2='44444444-4444-4444-4444-444444444444'
# 🔴 確認 fixture 真的在（不是“指令沒報錯”而已）
[ "$(q "SELECT count(*) FROM public.order_refunds WHERE id IN ('$RID','$RID2')")" = "2" ] \
  || { echo "🔴 fixture 不在；拒跑"; exit 1; }
echo "  fixture: order=$OID_ refund=$RID / $RID2"

# ── S0 正向:remaining 起始值 = total − 0(failed 未被更正 ⇒ 不佔額度)────────
R0=$(q "SELECT public.pcm_order_refundable_remaining('$OID_')")
[ "$R0" = "10000" ] && ok "S0 未更正時 remaining=10000(failed 不佔額度)" || bad "S0 remaining=$R0(期望 10000)"

# ── S1 🔴 繞路負測:service_role 不得直接 INSERT 更正 ────────────────────────
S1=$(psql "$URL" -tAX -c "SET ROLE service_role" \
      -c "INSERT INTO public.order_refund_manual_corrections
            (refund_id, seq, corrected_to, reason, actor, request_id)
          VALUES ('$RID', 99, 'money_moved', '繞路', 'attacker', 'req_bypass')" 2>&1 | head -3)
case "$S1" in
  *"permission denied"*) ok "S1 service_role 直接 INSERT 被拒(繞路關閉)" ;;
  *) bad "S1 service_role 竟可直接寫入更正表 ⇒ 本片的機制論證失效;輸出=$S1" ;;
esac

# ── S2 正向:走 RPC 可以更正 ────────────────────────────────────────────────
C1=$(q "SELECT (public.admin_correct_order_refund_verdict('$RID', NULL, 'probe_actor', '判錯了', 'money_moved', 'req_c1'))->>'correction_id'")
# 🔴 不能只判「非空」：上一版 $C1 裝的是錯誤訊息、非空也非空 ⇒ 假綠。必須驗形狀。
case "$C1" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ok "S2 走 RPC 更正成功(correction_id=$C1)" ;;
  *) bad "S2 RPC 更正沒回 uuid：$C1"; echo "  🔴 fixture/RPC 已失效，後續格無意義，中斷"; exit 1 ;;
esac

# ── S3 🔴 機制本體:remaining 真的扣掉了 ────────────────────────────────────
R1=$(q "SELECT public.pcm_order_refundable_remaining('$OID_')")
[ "$R1" = "7000" ] && ok "S3 money_moved 更正後 remaining=7000(扣掉 3000)" || bad "S3 remaining=$R1(期望 7000)"

# ── S4 反向對照:改回 no_money_moved ⇒ 額度必須回升(只跑正向 = 半個對照)────
C2=$(q "SELECT (public.admin_correct_order_refund_verdict('$RID', '$C1', 'probe_actor', '再判一次', 'no_money_moved', 'req_c2'))->>'correction_id'")
R2=$(q "SELECT public.pcm_order_refundable_remaining('$OID_')")
[ "$R2" = "10000" ] && ok "S4 改回 no_money_moved 後 remaining 回到 10000(最新一筆說了算)" || bad "S4 remaining=$R2(期望 10000)"

# ── S5 CAS:拿過期的 correction_id 去更正 ⇒ 必須被拒 ────────────────────────
E5=$(errcode "SELECT public.admin_correct_order_refund_verdict('$RID', '$C1', 'probe_actor', '過期', 'money_moved', 'req_c3')")
[ "$E5" = "P2B44" ] && ok "S5 過期 CAS 被拒(P2B44)" || bad "S5 錯誤碼=$E5(期望 P2B44)"

# ── S6 冪等:同一 request_id 重播 ⇒ DUPLICATE_REQUEST,不是再寫一列 ──────────
D6=$(q "SELECT (public.admin_correct_order_refund_verdict('$RID', '$C2', 'probe_actor', '再判一次', 'no_money_moved', 'req_c2'))->>'result'")
[ "$D6" = "DUPLICATE_REQUEST" ] && ok "S6 同 refund 同 token 重播回 DUPLICATE_REQUEST" || bad "S6 result=$D6"

# ── S7 🔴 token 撞到別筆退款 ⇒ 必須 RAISE,不得假裝成功(codex must-fix)──────
E7=$(errcode "SELECT public.admin_correct_order_refund_verdict('$RID2', NULL, 'probe_actor', '借用 token', 'money_moved', 'req_c2')")
[ "$E7" = "P2B44" ] && ok "S7 token 撞別筆退款被拒(P2B44,不假裝成功)" || bad "S7 錯誤碼=$E7(期望 P2B44)"

# ── S8 隔離閘:RR 下呼叫必須被拒 ────────────────────────────────────────────
E8=$(psql "$URL" -tAX -c "\set VERBOSITY verbose" \
      -c "BEGIN ISOLATION LEVEL REPEATABLE READ" \
      -c "SELECT public.admin_correct_order_refund_verdict('$RID2', NULL, 'probe_actor', 'rr', 'money_moved', 'req_rr')" \
      -c "ROLLBACK" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)
[ "$E8" = "P8C01" ] && ok "S8 REPEATABLE READ 下被隔離閘擋(P8C01)" || bad "S8 錯誤碼=$E8(期望 P8C01)"

# ── S9 🔴🔴 雙連線同時更正同一列 ────────────────────────────────────────────
# 🔴🔴 **上一版這格是假的**(codex R2 抓到,屬實):兩邊各 `pg_sleep(0.2)` 之後才呼叫,
#    **完全序列執行也會得到「一成功一 CAS、零死結」** —— 那個結果對「有沒有真的重疊」零判別力。
#    ⇒ 改成真正的 barrier:A **先取住父列鎖並握著**,B 在 A 還握著時進來,
#      並且用 `pg_blocking_pids()` **實地觀察到「擋住 B 的就是 A」**(a2b2 的判例形狀)。
#      觀察不到重疊 = 本格直接紅,不准拿「結果看起來對」當證據。
CUR=$(q "SELECT correction_id::text FROM public.order_refund_effective_verdict WHERE refund_id='$RID'")

cat > "$W/fa.sql" <<EOF
\set VERBOSITY verbose
BEGIN;
SELECT id FROM public.order_refunds WHERE id = '$RID' FOR NO KEY UPDATE;
SELECT pg_sleep(4);
SELECT public.admin_correct_order_refund_verdict('$RID', '$CUR', 'probe_actor', 'A 改', 'money_moved', 'req_race_a');
COMMIT;
EOF
cat > "$W/fb.sql" <<EOF
\set VERBOSITY verbose
SELECT public.admin_correct_order_refund_verdict('$RID', '$CUR', 'probe_actor', 'B 改', 'money_moved', 'req_race_b');
EOF

( psql "$AURL" -tAX -v ON_ERROR_STOP=0 -f "$W/fa.sql" > "$W/outa.txt" 2>&1 ) & PA=$!
sleep 1.5
( psql "$BURL" -tAX -v ON_ERROR_STOP=0 -f "$W/fb.sql" > "$W/outb.txt" 2>&1 ) & PB=$!
sleep 1.5

# 🔴 重疊的**證據**:B 正在等鎖,而擋住它的 pid 就是 A(不是「有人在等」而已)。
BLOCK=$(q "SELECT count(*) FROM pg_stat_activity b
            WHERE b.application_name='r473b1_b'
              AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(b.pid)) g
                          JOIN pg_stat_activity a ON a.pid=g
                         WHERE a.application_name='r473b1_a')")
[ "$BLOCK" = "1" ] && ok "S9 觀察到真重疊:B 被 A 擋住(pg_blocking_pids 綁定)" \
  || { bad "S9 沒有觀察到重疊(BLOCK=$BLOCK)⇒ 後面三格對併發零判別力,不採計"; SKIP9=1; }

wait $PA; wait $PB
OKN=$(cat "$W/outa.txt" "$W/outb.txt" | grep -c 'CORRECTED')
CASN=$(cat "$W/outa.txt" "$W/outb.txt" | grep -c 'P2B44')
DEAD=$(cat "$W/outa.txt" "$W/outb.txt" | grep -c '40P01')
if [ "${SKIP9:-0}" = "1" ]; then
  echo "  skip S9 後續三格(未觀察到重疊)"
else
  [ "$OKN" = "1" ] && ok "S9 雙連線恰一個成功(不是兩個都成功)" || bad "S9 成功數=$OKN(期望 1)"
  [ "$CASN" = "1" ] && ok "S9 另一個被 CAS 擋(P2B44)" || bad "S9 CAS 拒絕數=$CASN(期望 1)"
  [ "$DEAD" = "0" ] && ok "S9 零死結(NKU 選對了;FOR UPDATE 版的 40P01 未重現)" || bad "S9 出現 40P01 死結 $DEAD 次"
fi

# ── S10 view 最新一筆說了算:seq 最大者生效 ─────────────────────────────────
N10=$(q "SELECT count(*) FROM public.order_refund_effective_verdict WHERE refund_id='$RID'")
S10=$(q "SELECT seq FROM public.order_refund_effective_verdict WHERE refund_id='$RID'")
MX=$(q "SELECT max(seq) FROM public.order_refund_manual_corrections WHERE refund_id='$RID'")
[ "$N10" = "1" ] && ok "S10 view 對一筆 refund 恰回一列" || bad "S10 view 回了 $N10 列"
[ "$S10" = "$MX" ] && ok "S10 生效的是 seq 最大者($S10)" || bad "S10 生效 seq=$S10 但 max=$MX"

# ── S11 🔴 舊列零改動:更正前後把父列整列指紋比一次 ─────────────────────────
# codex R2 nit:plan 宣稱「probe 驗過舊列零改動」,但腳本原本**沒有任何 before/after 指紋**
# ⇒ RPC 若改到父列某個「後續判準沒用到」的欄位,前面每一格照樣全綠。這格把宣稱補成事實。
BEFORE=$(q "SELECT md5(to_jsonb(r)::text) FROM public.order_refunds r WHERE r.id='$RID2'")
q "SELECT public.admin_correct_order_refund_verdict('$RID2', NULL, 'probe_actor', '指紋測試', 'money_moved', 'req_fp')" >/dev/null
AFTER=$(q "SELECT md5(to_jsonb(r)::text) FROM public.order_refunds r WHERE r.id='$RID2'")
[ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ] \
  && ok "S11 更正前後父列逐欄指紋相同(order_refunds 真的一個字都沒動)" \
  || bad "S11 父列被改動了:before=$BEFORE after=$AFTER"

echo "== PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] || exit 1
