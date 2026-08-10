#!/usr/bin/env bash
# ============================================================
# OP6-a 行為 harness —— admin_compute_order_settlement 的七條前提閘(P1-P7)
#
# 規格權威 = B-430-PLAN.md v4.1(md5 77e6b04823824e6295bf8d0be56479aa)。
#
# 🔴 本 harness 的中心紀律(plan v4.1 §1 F7 + F9):
#   ①**突變**:把前提改成恆真 ⇒ 對應那格必須從 needs_human **翻出 verdict**;翻不動 = 那條是裝飾。
#     🔴 **涵蓋實況(數過的,不是宣稱;每次加突變都要回來重數)**:
#     突變呼叫 **6 發**(M1/M2a/M2b/M3/M6/M7),涵蓋 **P1・P2(兩腿)・P3・P6・P7 = 五條前提**;
#     **P4 與 P5 沒有恆真突變**(P4 改用毒列注入、見該段;P5 三個分支各有正負行為格但無突變)。
#   ②**但前提 4 的四個子條件全被 DDL/trigger 先擋** ⇒ 恆真突變**沒有可構造樣本會翻**。
#     那一腿改用**毒列注入**(拋棄庫內 DISABLE TRIGGER / DROP CONSTRAINT 後灌毒列),
#     不可注入的逐腿標注「以 DDL 引用代替突變」。這是實話,不是偷懶。
#   ③🔴 **不宣稱「漏想到的形狀會自動保守」** —— 那句 v3 的話已被 Fable 用四個在庫可構造的
#     形狀證偽。本 harness 只證「**部分**前提各自有判別力」(突變涵蓋五條前提共六發、P4 用毒列注入、P5 只有行為格),
#     **不證前提集合充分**。
#
# 🔴 fixture 紀律(v3 前提 3 那個坑的直接教訓):
#   d1t2 seed 的 `shipping_fee` 全為 0 ⇒ 該 seed 下 `subtotal == total`,
#   拿它當 fixture **證不出**我們比的是 subtotal 而不是 total(恆真族)。
#   ⇒ 正向格一律**自造 fixture,且 shipping_fee 必須非 0**。
#
# 用法:
#   PORT=54375 bash scripts/op6a-verify.sh all /tmp/op6av    provision -> 跑 -> teardown
#   PORT=54375 bash scripts/op6a-verify.sh run  /tmp/op6av    對已起好的庫跑
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C

MODE="${1:?用法: op6a-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 直屬短路徑,例 /tmp/op6av)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(本支無預設值;建議 54375)}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
FN="public.admin_compute_order_settlement"
MIG="supabase/migrations/20260811030000_m4b_e10_op6a_compute_order_settlement.sql"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "  🔴 $*"; }
log() { echo ""; echo "== $* =="; }
die() { echo "🔴 $*" >&2; exit 1; }

require_free_port () {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 \
    && die "PORT $PORT 已被占用 ⇒ 拒絕繼續(連過去會靜默查到別窗的庫)"
}
cluster_identity () {
  local dd; dd="$(psql "$URL" -qtA -c "select current_setting('data_directory')" 2>/dev/null)"
  [ "$dd" = "$WORK/pgdata" ] || die "身分閘:PORT=$PORT 連到的 data_directory=${dd:-<查不到>},期望 $WORK/pgdata"
}

if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17(含 OP6-a)"
  require_free_port
  # 🔴 rm -rf 的路徑守門(關卡2:原本只靠註解要求 /tmp 短路徑)
  # 🔴 關卡2 R2:`/tmp/[A-Za-z0-9_-]*` 的尾巴 `*` 吃得下 `/`、空白與 `..`
  #    ⇒ `/tmp/x/../../etc` 會通過。改成整段逐字元比對、且不得含斜線。
  printf '%s' "$WORK" | grep -Eq '^/tmp/[A-Za-z0-9_-]+$' \
    || die "workdir [$WORK] 不是 /tmp 直屬單層短路徑(不得含 / 或 .. 或空白)⇒ 拒絕 rm -rf"
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" bash scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗"; tail -20 "$WORK/provision.log"; exit 1; }
  echo "  · provision 完成(**非測試格**,不計數——關卡2 I2:算進去會讓 run 模式恆紅)"
fi
cluster_identity

# ── 共用:造一張乾淨、內部一致、**運費非 0** 的訂單 ───────────────────────────
# 回傳 order_id。$1=subtotal $2=shipping $3=payment_status
mk_order () {
  # 🔴 不自己湊 NOT NULL 欄:從既有 seed 單**複製**必填欄(display_id 有格式 CHECK
  #    `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`,order_items 另有 variant_sku/product_snapshot 必填)。
  #    自己湊等於把「訂單合法形狀」重寫一份,漂了也不會有人發現。
  psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
    WITH src AS (SELECT * FROM public.orders ORDER BY created_at LIMIT 1),
         si  AS (SELECT * FROM public.order_items ORDER BY id LIMIT 1),
    o AS (
      INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot,
             tier_at_checkout, payment_status, fulfillment_status, subtotal, shipping_fee,
             discount_total, total, shipping_method, invoice, shipping_method_at_checkout)
      SELECT (SELECT string_agg(substr('23456789BCDFGHJKMNPQRSTVWXYZ',
                (random()*26)::int + 1, 1), '') FROM generate_series(1,6)),
             src.customer_user_id, src.shipping_address_snapshot, src.tier_at_checkout,
             '$3'::public.payment_status, 'notOrdered', $1, $2, 0, $1 + $2,
             src.shipping_method, src.invoice, src.shipping_method_at_checkout
        FROM src
      RETURNING id
    ), ins AS (
      INSERT INTO public.order_items (order_id, variant_sku, product_snapshot,
             quantity, unit_price, line_total)
      SELECT o.id, si.variant_sku, si.product_snapshot, 1, $1, $1 FROM o, si
      RETURNING order_id
    )
    SELECT id::text FROM o;" | tail -1
}
verdict_of () { psql "$URL" -qtA -c "SELECT ${FN}('$1'::uuid) ->> 'verdict'"; }
reasons_of () { psql "$URL" -qtA -c "SELECT coalesce(${FN}('$1'::uuid) ->> 'reasons','(null)')"; }
field_of   () { psql "$URL" -qtA -c "SELECT coalesce((${FN}('$1'::uuid) ->> '$2'),'(null)')"; }

cell () {  # $1=標籤 $2=order_id $3=期望 verdict $4=期望 reasons 必含(可空)
  local got_v got_r; got_v="$(verdict_of "$2")"; got_r="$(reasons_of "$2")"
  if [ "$got_v" != "$3" ]; then bad "$1 ⇒ verdict=$got_v(期望 $3)reasons=$got_r"; return; fi
  if [ -n "${4:-}" ] && ! printf '%s' "$got_r" | grep -Fq "$4"; then
    bad "$1 ⇒ verdict 對但 reasons 少了 [$4]:$got_r"; return
  fi
  ok "$1 ⇒ $got_v${4:+ + $4}"
}

# ══ G0 自我測試:壞掉的 SQL 一定要被判紅 ═══════════════════════════════════
log "G0 harness 自我測試"
if psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "SELECT this_col_does_not_exist" >/dev/null 2>&1; then
  die "G0:壞掉的 SQL 竟然沒紅 ⇒ 判定失效"
fi
ok "G0:壞掉的 SQL 會被判紅"

# ══ G1 對照組:函式在、ACL 正確 ═════════════════════════════════════════════
log "G1 對照組"
psql "$URL" -qtA -c "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='admin_compute_order_settlement'" | grep -q 1 \
  && ok "G1 函式在" || bad "G1 函式不在 ⇒ 這個庫沒套過本片"
psql "$URL" -qtA -c "SELECT has_function_privilege('service_role','${FN}(uuid)','EXECUTE')" | grep -q '^t$' \
  && ok "G1 service_role 可 EXECUTE" || bad "G1 service_role 拿不到 EXECUTE"
for r in anon authenticated authenticator; do
  psql "$URL" -qtA -c "SELECT has_function_privilege('$r','${FN}(uuid)','EXECUTE')" | grep -q '^f$' \
    && ok "G1 $r 擋住" || bad "G1 $r 竟然拿得到 EXECUTE"
done
# 🔴 catalog 說 ACL 對 ≠ 角色真的呼叫得動(Fable 要求的「角色實際呼叫格」)
# 🔴 這一格延後到正向 fixture 造好之後(見 SR1):餵隨機 uuid 的版本**零判別力** ——
#    函式對不存在的單本來就回 NULL,SECDEF 壞掉與正常都長一樣(code-reviewer I1)。
psql "$URL" -qtA -c "SET ROLE anon; SELECT ${FN}(gen_random_uuid())" >/dev/null 2>&1 \
  && bad "G1 anon 竟然呼叫成功 ⇒ 開權漏了" || ok "G1 anon 實際呼叫被拒(42501)"

# ══ P0 訂單不存在 ⇒ 回 NULL ════════════════════════════════════════════════
log "P0 訂單不存在"
psql "$URL" -qtA -c "SELECT ${FN}('00000000-0000-0000-0000-000000000000'::uuid) IS NULL" | grep -q '^t$' \
  && ok "P0 不存在的 order ⇒ 回 NULL(與『存在但資料損壞』分流)" || bad "P0 不存在的 order 沒回 NULL"

# ══ 正向三格:settled / underpaid / overpaid ════════════════════════════════
# 🔴 運費非 0 是刻意的:d1t2 seed 全是 0,拿它證不出我們比的是 subtotal 不是 total。
log "正向三格(運費非 0、金額不對稱)"
O_SET=$(mk_order 1000 100 unpaid)
O_UND=$(mk_order 2000 100 unpaid)
O_OVR=$(mk_order 3000 100 unpaid)
[ -n "$O_SET" ] || die "fixture 建不起來(mk_order 回空)"
# 🔴 fixture 一律 ON_ERROR_STOP + 失敗當場 die:插入靜默失敗會讓下游格「綠得像有守住」。
#    本檔第一版把 stderr 吞掉,結果 P5b/P6 兩格用**空的 fixture**在跑,症狀是 verdict 對不上。
sqlx () { psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" >/dev/null || die "fixture SQL 失敗:$1"; }
add_cash () { sqlx "
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, request_id, actor)
  VALUES ('$1'::uuid, 'cash', $2, now() - interval '1 hour', gen_random_uuid(), 'payment_confirmer');"; }
# attempts 的必填欄:customer_user_id / fallback_token_hash(無 amount 欄——第一版我憑印象寫了)
add_attempt () { sqlx "
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, rec_trade_id, fallback_token_hash)
  SELECT '$1'::uuid, o.customer_user_id, '$2', '$3', repeat('a',64) FROM public.orders o WHERE o.id='$1'::uuid;"; }
add_cash "$O_SET" 1100     # = subtotal+shipping ⇒ 剛好結清
add_cash "$O_UND" 1800     # 少收 300
add_cash "$O_OVR" 3800     # 溢收 700
cell "S1 剛好結清" "$O_SET" settled
cell "S2 少收 300"  "$O_UND" underpaid
cell "S3 溢收 700"  "$O_OVR" overpaid
[ "$(field_of "$O_UND" net)" = "-300" ] && ok "S2 net=-300(方向與數字都對)" || bad "S2 net=$(field_of "$O_UND" net),期望 -300"
[ "$(field_of "$O_OVR" net)" = "700" ]  && ok "S3 net=+700(方向與數字都對)" || bad "S3 net=$(field_of "$O_OVR" net),期望 700"

# ══ 前提負向格(P1 / P2a / P3 / P5a / P5b —— **不是六條各一格**,P4 見毒列注入段、P6 見退款面段)══
log "P1 狀態不在可判定集(refunded 族排除;Fable F1)"
O_P1=$(mk_order 1000 100 refunded); add_cash "$O_P1" 1100
cell "P1 refunded ⇒ 不判定" "$O_P1" needs_human STATUS_NOT_DECIDABLE

log "P2 取消痕跡(三處各一)"
O_P2A=$(mk_order 1000 100 unpaid); add_cash "$O_P2A" 1100
sqlx "UPDATE public.orders SET cancelled_at = now() WHERE id='$O_P2A'::uuid"
cell "P2a orders.cancelled_at" "$O_P2A" needs_human D_HAS_CANCELLATION

log "P3 品項快照(🔴 這格證明我們比的是 subtotal 不是 total)"
O_P3=$(mk_order 1000 100 unpaid); add_cash "$O_P3" 1100
sqlx "UPDATE public.order_items SET line_total = 900, unit_price = 900 WHERE order_id='$O_P3'::uuid"
cell "P3 items 合計 ≠ subtotal" "$O_P3" needs_human D_NO_SNAPSHOT

log "P5 帳本覆蓋三形狀"
O_P5A=$(mk_order 1000 100 paid)      # paid 但零收款列 = 建表前老單
cell "P5a paid 但零收款列" "$O_P5A" needs_human G_LEDGER_NOT_BACKFILLED
O_P5B=$(mk_order 1000 100 unpaid)    # unpaid + 零腿 + 有 charged attempt(Fable F2)
add_attempt "$O_P5B" charged "RECB$(uuidgen | tr -d - | cut -c1-10)"
cell "P5b unpaid + charged attempt(F2)" "$O_P5B" needs_human G_UNPAID_WITH_CHARGED_ATTEMPT

log "P6 基準格:卡軌乾淨單(四面全空 ⇒ 應可判定)"
mk_paid_card () {  # 造一張有卡腿、可判定的單,回 order_id
  local oid rec; oid=$(mk_order 1000 100 paid); rec="REC_$(uuidgen | tr -d - | cut -c1-12)"
  add_attempt "$oid" charged "$rec"
  sqlx "INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
        VALUES ('$oid'::uuid, 'card', 1100, now() - interval '1 hour', '$rec', 'payment_confirmer');"
  printf '%s' "$oid"
}
O_BASE=$(mk_paid_card)
cell "P6-base 卡軌乾淨單(前提全過)" "$O_BASE" settled


log "P5c 卡腿缺口 + 🔴 F3 跨單同 rec 陷阱"
O_GAP=$(mk_order 1000 100 paid); REC_G="RECGAP$(uuidgen | tr -d - | cut -c1-10)"
add_attempt "$O_GAP" charged "$REC_G"
add_cash "$O_GAP" 1100                      # 有收款列(現金)但那張 charged attempt 沒有對應卡腿
cell "P5c charged attempt 無對應卡腿" "$O_GAP" needs_human G_LEDGER_WRITE_GAP
# 🔴 F3:把「同一個 rec 的卡腿」掛到**別張單**上 ⇒ 若 join 只比 rec_trade_id,這格會被誤判成覆蓋到了。
O_OTHER=$(mk_order 500 100 paid)
sqlx "INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
      VALUES ('$O_OTHER'::uuid, 'card', 600, now() - interval '1 hour', '$REC_G', 'payment_confirmer');"
cell "P5c-F3 別張單有同 rec 卡腿 ⇒ 仍算缺口" "$O_GAP" needs_human G_LEDGER_WRITE_GAP

log "P6 退款四面(①order_refunds ②payment_refunds+events ③jobs ④anomalies)+ 各自的除外值"
# 🔴 catalog 實查後改寫:order_refunds 的必填欄與我原本憑建表檔寫的**不同**
#    (items_amount/shipping_delta 早被後續 migration 改掉)——問 catalog、不要數 CREATE 敘述。
#    另有 A7c INSERT 守門:初態必須 processing、訂單 payment_status 在白名單、
#    rec_trade_id 必須等於該訂單的 tappay_rec_trade_id。
r_old () {
  sqlx "UPDATE public.orders SET tappay_rec_trade_id = (
          SELECT a.rec_trade_id FROM public.payment_charge_attempts a
           WHERE a.order_id = '$1'::uuid LIMIT 1) WHERE id = '$1'::uuid;"
  sqlx "INSERT INTO public.order_refunds (order_id, bank_refund_id, refund_amount, status, reason,
          actor, request_id, rec_trade_id, kind, record_refunded_before)
        SELECT o.id, 'OP6AHARNESS' || substr(gen_random_uuid()::text,1,8), 1000, 'processing', 'op6a harness', 'payment_confirmer',
               gen_random_uuid()::text, o.tappay_rec_trade_id, 'full', 0
          FROM public.orders o WHERE o.id = '$1'::uuid;"
  [ "$2" = "failed" ] && sqlx "UPDATE public.order_refunds SET status='failed',
        failed_reason='op6a harness' WHERE order_id='$1'::uuid;"
  return 0
}
O_R1=$(mk_paid_card); r_old "$O_R1" processing
cell "P6-1 order_refunds processing(舊帳本、非 failed)" "$O_R1" needs_human R_REFUND_TRACE_PRESENT
O_R1B=$(mk_paid_card); r_old "$O_R1B" failed
cell "P6-1b order_refunds failed ⇒ **不算**跡象(F5 同口徑)" "$O_R1B" settled

O_R4=$(mk_paid_card)
sqlx "INSERT INTO public.payment_double_charge_anomalies (old_attempt_id, old_order_id,
        user_id, cart_session_id, rec_trade_id, refund_target_rec_trade_id, released_at, charged_at,
        amount, status)
      SELECT a.id, '$O_R4'::uuid, o.customer_user_id, gen_random_uuid(),
             a.rec_trade_id, a.rec_trade_id, now(), now(), 1100, 'open'
        FROM public.payment_charge_attempts a JOIN public.orders o ON o.id = a.order_id
       WHERE a.order_id = '$O_R4'::uuid LIMIT 1;"
cell "P6-4 雙扣異常 open(走 Dashboard 退、**不經**前兩本)" "$O_R4" needs_human R_REFUND_TRACE_PRESENT

echo "  ℹ️  P6-3 已補行為格,但**靠卸休眠閘注入**:那張表現在是 CHECK(false),正式站零可達列。"

O_R3=""   # 佔位:上面那格沒做,後面零寫入迴圈不引用它
log "reasons 累積(不是第一個 CASE 就短路)"
O_MULTI=$(mk_order 1000 100 paid)          # paid+零收款列 ⇒ backfill 碼
sqlx "UPDATE public.orders SET cancelled_at = now() WHERE id='$O_MULTI'::uuid"   # + 取消碼
sqlx "UPDATE public.order_items SET line_total = 700, unit_price = 700 WHERE order_id='$O_MULTI'::uuid"  # + 快照碼
MR="$(reasons_of "$O_MULTI")"
if printf '%s' "$MR" | grep -Fq D_HAS_CANCELLATION && printf '%s' "$MR" | grep -Fq D_NO_SNAPSHOT \
   && printf '%s' "$MR" | grep -Fq G_LEDGER_NOT_BACKFILLED; then
  ok "reasons 三碼同時出現(值班看得到全部原因):$MR"
else
  bad "reasons 沒有累積(只看到 $MR)⇒ 值班會漏看原因"
fi

log "零寫入證明(全表 md5,不是只比列數)"
TABLES="orders order_items order_payments order_refunds payment_refunds payment_refund_events payment_charge_attempts order_cancellations order_cancellation_items order_refund_jobs payment_double_charge_anomalies"
# 🔴 全部要 ON_ERROR_STOP + 檢查退出碼:若這 11 次呼叫與兩次快照**全部失敗**,
#    前後 snapshot 會「相同」⇒ 這一格照樣綠 = 恆真裝飾。(關卡2 R2 抓到;我 R1 宣稱折了、實際沒折。)
snap () {
  for t in $TABLES; do
    printf '%s:' "$t"
    psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "SELECT md5(coalesce(string_agg(x.t, '|' ORDER BY x.t), '')) FROM (SELECT (r.*)::text AS t FROM public.$t r) x" \
      || { echo "SNAPSHOT-FAILED"; return 1; }
  done
}
BEFORE_SNAP="$(snap)" || die "零寫入前快照失敗 ⇒ 這一格無法成立"
CALLS=0
for oid in $O_SET $O_UND $O_OVR $O_P1 $O_P5A $O_BASE $O_GAP $O_R1 $O_R1B $O_R4 $O_MULTI; do
  psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "SELECT ${FN}('$oid'::uuid)" >/dev/null \
    || die "零寫入:對 $oid 的呼叫失敗 ⇒ 前後相同只代表兩邊都沒跑"
  CALLS=$((CALLS+1))
done
[ "$CALLS" -eq 11 ] || die "零寫入:只成功呼叫 $CALLS 次(期望 11)"
AFTER_SNAP="$(snap)" || die "零寫入後快照失敗"
[ "$BEFORE_SNAP" = "$AFTER_SNAP" ] \
  && ok "零寫入:11 張表全表 md5 前後相同(11 次呼叫**全部成功**才算數)" \
  || { bad "🔴 有寫入!差異表:"; diff <(printf '%s' "$BEFORE_SNAP") <(printf '%s' "$AFTER_SNAP") | head -5; }

# ══ 突變本段五發:M1(P1)/ M2a・M2b(P2 兩腿)/ M3(P3)/ M6(P6)
#    P7 的 M7 在它自己的段落;P4、P5 無突變。
#    🔴 重數法(別用 `grep -c "^mutate_and_check"` —— 它會把**函式定義那一行**也算進去,
#       我自己就這樣多數了一發):`grep -cE '^mutate_and_check "'` ══════════════════════
log "突變(判別力)—— 本段**五發**(M1/M2a/M2b/M3/M6);P7 那發在 P7 段、P4/P5 無"
mutate_and_check () {  # $1=標籤 $2=sed 表達式 $3=order_id $4=突變後期望 verdict
  local tmp="$WORK/mut.sql"
  sed "$2" "$MIG" > "$tmp"
  grep -q "CREATE FUNCTION" "$tmp" || { bad "$1 突變檔壞了"; return; }
  cmp -s "$MIG" "$tmp" && { bad "$1 sed 沒改到任何東西 ⇒ 這發突變無判別力"; return; }
  psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "DROP FUNCTION public.admin_compute_order_settlement(uuid);" >/dev/null
  # 突變版跳過結構斷言(它會因為碼錨消失而紅——那正是碼錨在做事,但這裡要測行為)
  sed -n "/^CREATE FUNCTION/,/^\\\$fn\\\$;/p" "$tmp" | psql "$URL" -qtA -v ON_ERROR_STOP=1 -f - >/dev/null 2>&1 \
    || { bad "$1 突變版套不上"; psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1; return; }
  # 🔴 **必須連 REVOKE/GRANT 一起重放**:第一版只 CREATE FUNCTION ⇒ 突變期間那支函式的 ACL
  #    回到 PG 預設的 **PUBLIC 可 EXECUTE**(關卡2 與 reviewer I4 同抓)。
  psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
    REVOKE ALL ON FUNCTION public.admin_compute_order_settlement(uuid) FROM PUBLIC, anon, authenticated, authenticator;
    GRANT EXECUTE ON FUNCTION public.admin_compute_order_settlement(uuid) TO service_role;" >/dev/null \
    || die "$1 突變期 ACL 重放失敗 ⇒ 這支函式現在是 PG 預設的 PUBLIC 可 EXECUTE,後面每一格都在錯的 ACL 上跑"
  local got; got="$(verdict_of "$3")"
  if [ "$got" = "$4" ]; then ok "$1 突變後 ⇒ $got(前提原本有在擋)"; else bad "$1 突變後 ⇒ $got(期望 $4)⇒ 該前提是裝飾"; fi
  # 🔴 還原用**整檔 -f 重放**(含 REVOKE/GRANT 與全部結構/ACL gate)且**檢查成功**:
  #    第一版只重建函式本體、也沒檢查 ⇒ 還原後的狀態沒有任何人驗過(reviewer I4)。
  psql "$URL" -qtA -c "DROP FUNCTION public.admin_compute_order_settlement(uuid);" >/dev/null
  psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null \
    || die "$1 還原失敗:原版 migration 重放不回去 ⇒ 後面每一格都在測一個沒人驗過的狀態"
}
mutate_and_check "M1 P1 恆真" "s/(o.ps IN ('unpaid','paid','partiallyPaid')) IS TRUE/(true) IS TRUE/" "$O_P1" settled
# 🔴 M2 拆成**逐腿**:P2 是三個子條件的 AND,只鬆一腿而 fixture 踩的是另一腿 ⇒ 翻不動,
#    那不代表前提是裝飾,代表**靶配錯了**。第一版我就是這樣紅的,改成一腿一靶。
mutate_and_check "M2a P2 的 cancelled_at 腿恆真" \
  "s/(o.cancelled_at IS NULL/(o.cancelled_at IS NOT DISTINCT FROM o.cancelled_at/" "$O_P2A" settled
O_P2B=$(mk_order 1000 100 unpaid); add_cash "$O_P2B" 1100
# 🔴 header 與 items 必須**同一交易**:A7-t 的 DEFERRED trigger 擋「有 header、零明細」。
sqlx "WITH h AS (
        INSERT INTO public.order_cancellations (order_id, reason_code, reason_detail,
               idempotency_key, payload_hash, actor)
        SELECT '$O_P2B'::uuid, 'other', 'op6a harness', gen_random_uuid(), repeat('b',64),
               'payment_confirmer' RETURNING id, order_id)
      INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
      SELECT h.id, h.order_id, oi.id, 1 FROM h JOIN public.order_items oi ON oi.order_id = h.order_id;"
cell "P2b order_cancellations header" "$O_P2B" needs_human D_HAS_CANCELLATION
mutate_and_check "M2b P2 的 canc.n 腿恆真" \
       "s/     AND canc.n = 0)/     AND canc.n >= 0)/" "$O_P2B" settled
# 🔴 M3 的期望值第一版我算錯:O_P3 的 total=1100、收款也是 1100 ⇒ P3 一恆真就是 net=0=settled,
#    不是 underpaid。**是我的算術錯,不是函式錯**——留這行註解免得下一個人又改回去。
# 🔴 這條 sed 靶隨 migration 改 ::bigint 而失效過一次,是 mutate_and_check 的 cmp 守門抓到的
#    (「誰引用了我剛改的東西」——突變靶就是引用者)。改 migration 那一行時要同步改這裡。
mutate_and_check "M3 P3 恆真" "s/(items.n > 0 AND items.sum_line = o.subtotal::bigint) IS TRUE/(true) IS TRUE                                     /" "$O_P3" settled
mutate_and_check "M6 P6 恆真" "s/AND ref.anom_n = 0) IS TRUE/AND ref.anom_n >= 0) IS TRUE/" "$O_R4" settled
echo "  ℹ️  M4(前提 4)**刻意不做恆真突變**:四個子條件全被 DDL/trigger 先擋"
echo "     (op2a P2B31 未來時間 / composite FK 同單 / one_reversal_uniq / OP2b P2B33 反號)"
echo "     ⇒ 沒有可構造樣本會翻。要真測必須先 DISABLE TRIGGER/DROP CONSTRAINT 灌毒列,"
echo "     本輪**沒有做**,以 DDL 引用代替——這是實話,不是通過。"
echo "  ℹ️  M5(前提 5)三個分支已各有正向負向格(P5a/P5b/P5c+F3),突變留待毒列注入輪。"

log "SR1 🔴 service_role 對**真單**呼叫(reviewer I1:餵隨機 uuid 那版零判別力)"
SR="$(psql "$URL" -qtA -c "SET ROLE service_role; SELECT ${FN}('$O_BASE'::uuid) ->> 'verdict'" 2>&1 | tail -1)"
[ "$SR" = "settled" ] && ok "SR1 service_role 拿得到真資料(settled)⇒ SECDEF 真的在運作" \
  || bad "SR1 service_role 對真單回 [$SR](期望 settled)⇒ SECDEF 路徑有問題"

log "P6-2 payment_refunds + events 三格(🔴 首輪完全沒有,而 F5 的修法只落在這裡)"
mk_refund () {  # $1=order_id $2=事件清單(空=只有父列)
  local rid
  rid=$(psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
    INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
    SELECT a.id, substr(replace(gen_random_uuid()::text,'-',''),1,20), 1100, 'TWD',
           'sk_' || replace(gen_random_uuid()::text,'-',''), 0
      FROM public.payment_charge_attempts a WHERE a.order_id='$1'::uuid LIMIT 1
    RETURNING id::text;" | tail -1) || die "mk_refund 失敗"
  local n=1
  for ev in $2; do
    psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
      INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token)
      VALUES ('$rid'::uuid, '$ev', $n, 0);" >/dev/null || die "mk_refund 事件 $ev 失敗"
    n=$((n+1))
  done
}
O_PR1=$(mk_paid_card); mk_refund "$O_PR1" "sent"
cell "P6-2a sent-only(外呼在途、未知態)⇒ **算**跡象" "$O_PR1" needs_human R_REFUND_TRACE_PRESENT
O_PR2=$(mk_paid_card); mk_refund "$O_PR2" "sent result_unknown"
cell "P6-2b result_unknown(非 terminal)⇒ **算**跡象" "$O_PR2" needs_human R_REFUND_TRACE_PRESENT
O_PR3=$(mk_paid_card); mk_refund "$O_PR3" "sent result_failed"
cell "P6-2c terminal 全為 result_failed ⇒ **不算**跡象(錢確定沒動)" "$O_PR3" settled
O_PR4=$(mk_paid_card); mk_refund "$O_PR4" "sent result_success"
cell "P6-2d result_success ⇒ **算**跡象" "$O_PR4" needs_human R_REFUND_TRACE_PRESENT

log "P6-3 order_refund_jobs 行為格 —— 🔴 那張表現在是**硬休眠**的"
# 🔴🔴 實測:`order_refund_jobs_dormant_until_triggers` = **`CHECK (false)`**
#    ⇒ 該表今天**一列都插不進去**,退款面③在正式站是**不可達的死分支**(不是「還沒發生」)。
#    · 函式仍查它 = 為將來留位,現在零成本;但**別把它算成今天的守備**。
#    · 失效條件(到期日):某片 DROP 掉那條 CHECK 的那一刻,這條分支才開始真的擋東西。
#    · 行為格只能用**注入法**(拋棄庫內卸掉休眠閘)——與 P4 同一種手法、同樣不是「通過」。
O_JOB=$(mk_paid_card)
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "ALTER TABLE public.order_refund_jobs DROP CONSTRAINT order_refund_jobs_dormant_until_triggers;" >/dev/null
sqlx "WITH h AS (
        INSERT INTO public.order_cancellations (order_id, reason_code, reason_detail,
               idempotency_key, payload_hash, actor)
        SELECT '$O_JOB'::uuid, 'other', 'op6a jobs', gen_random_uuid(), repeat('c',64),
               'payment_confirmer' RETURNING id, order_id),
      i AS (
        INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
        SELECT h.id, h.order_id, oi.id, 1 FROM h JOIN public.order_items oi ON oi.order_id = h.order_id
        RETURNING cancellation_id)
      INSERT INTO public.order_refund_jobs (cancellation_id, order_id, rec_trade_id, bank_refund_id,
             payload_hash, refund_amount, items_amount, shipping_fee_before, shipping_fee_after,
             shipping_delta, reason, actor, request_id, status, next_retry_at)
      SELECT (SELECT cancellation_id FROM i LIMIT 1), '$O_JOB'::uuid,
             (SELECT a.rec_trade_id FROM public.payment_charge_attempts a WHERE a.order_id='$O_JOB'::uuid LIMIT 1),
             'BRF' || substr(replace(gen_random_uuid()::text,'-',''),1,8), repeat('d',64),
             1000, 1000, 100, 100, 0, 'op6a harness', 'payment_confirmer',
             gen_random_uuid()::text, 'queued', now() + interval '1 hour';"
cell "P6-3 order_refund_jobs queued(卸休眠閘注入)⇒ 算跡象" "$O_JOB" needs_human R_REFUND_TRACE_PRESENT
# 🔴 關卡2 R2:第一版在**還有那列**的情況下重加 `CHECK(false)` ⇒ 驗證必然失敗,
#    而我寫了 `|| true` **把失敗吞掉** ⇒ 休眠閘沒復原、沒人知道。改成:先刪列、再加回、**不吞**。
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "DELETE FROM public.order_refund_jobs WHERE order_id='$O_JOB'::uuid;" >/dev/null \
  || die "P6-3 清理注入列失敗"
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "ALTER TABLE public.order_refund_jobs ADD CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false);" >/dev/null \
  || die "P6-3 休眠閘復原失敗 ⇒ 這個庫的後續格都在一個被我改過的 schema 上跑"
ok "P6-3b 休眠閘已復原(ADD CONSTRAINT 成功,失敗不吞)"
printf '%s' "$(reasons_of "$O_JOB")" | grep -Fq D_HAS_CANCELLATION \
  && ok "P6-3b 同一格同時出現取消碼(reasons 累積,不是短路)" \
  || bad "P6-3b 取消碼沒出現:$(reasons_of "$O_JOB")"

log "P6-4b 雙扣異常 dismissed ⇒ **不算**跡象(規格明列的排除值,首輪沒測)"
O_DIS=$(mk_paid_card)
sqlx "INSERT INTO public.payment_double_charge_anomalies (old_attempt_id, old_order_id,
        user_id, cart_session_id, rec_trade_id, refund_target_rec_trade_id, released_at, charged_at,
        amount, status, resolved_at, resolved_by, resolution_note)
      SELECT a.id, '$O_DIS'::uuid, o.customer_user_id, gen_random_uuid(),
             a.rec_trade_id, a.rec_trade_id, now(), now(), 1100, 'dismissed',
             now(), 'payment_confirmer', 'op6a harness:誤報'
        FROM public.payment_charge_attempts a JOIN public.orders o ON o.id = a.order_id
       WHERE a.order_id = '$O_DIS'::uuid LIMIT 1;"
cell "P6-4b anomaly dismissed ⇒ 不算跡象" "$O_DIS" settled

log "P1 值域兩格(reviewer:排除面與可判定面都要有行為證據)"
O_PPR=$(mk_order 1000 100 partiallyRefunded); add_cash "$O_PPR" 1100
cell "P1b partiallyRefunded ⇒ 排除" "$O_PPR" needs_human STATUS_NOT_DECIDABLE
O_PPD=$(mk_order 1000 100 partiallyPaid); add_cash "$O_PPD" 1100
cell "P1c partiallyPaid ⇒ **可判定**(不是所有非 unpaid 都排除)" "$O_PPD" settled

log "P2c cancelled_reason 單獨一格(首輪 header 與 items 永遠成對、reason 沒被單獨測)"
O_P2C=$(mk_order 1000 100 unpaid); add_cash "$O_P2C" 1100
sqlx "UPDATE public.orders SET cancelled_reason = '客人來電取消' WHERE id='$O_P2C'::uuid"
cell "P2c 只有 cancelled_reason(cancelled_at 仍 NULL)" "$O_P2C" needs_human D_HAS_CANCELLATION

log "P4 毒列注入(reviewer:六前提唯一正反兩面皆零行為證據的一條)"
O_P4=$(mk_order 1000 100 unpaid); add_cash "$O_P4" 1100
cell "P4a 乾淨收款列(正面)" "$O_P4" settled
# 🔴 未來 received_at 被 op2a 的 trigger P2B31 擋 ⇒ 關掉那張表的 user trigger 才灌得進去。
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "ALTER TABLE public.order_payments DISABLE TRIGGER USER;" >/dev/null
sqlx "UPDATE public.order_payments SET received_at = now() + interval '2 days' WHERE order_id='$O_P4'::uuid"
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "ALTER TABLE public.order_payments ENABLE TRIGGER USER;" >/dev/null
cell "P4b 毒列:未來 received_at ⇒ 形狀異常" "$O_P4" needs_human PAYMENT_ROW_SHAPE_ANOMALY

log "JSON contract 七鍵齊(reviewer:首輪只驗 verdict + 部分 reasons + 兩個 net)"
KEYS="$(psql "$URL" -qtA -c "SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(${FN}('$O_BASE'::uuid)) k")"
[ "$KEYS" = "gross,net,reasons,receivable,refunded,scope,verdict" ] \
  && ok "JSON 七鍵齊且無多餘鍵:$KEYS" || bad "JSON 鍵不對:$KEYS"

log "P7 金額範圍(新前提,關卡2 R2:加了守門沒加證據)"
O_OVF=$(mk_order 1000 100 unpaid)
add_cash "$O_OVF" 2000000000
add_cash "$O_OVF" 2000000000     # 合計 4e9 > int4 上界
cell "P7 gross 超出 int4 ⇒ 不可判定(而不是噴錯)" "$O_OVF" needs_human AMOUNT_OUT_OF_RANGE
# 🔴 第一版靶寫成 `IS TRUE`→`IS NOT FALSE`:p7 求值是 FALSE(不是 NULL)⇒ 換了還是 false、翻不動。
#    恆真化要動的是**範圍本身**(兩行都有,用 /g)。
mutate_and_check "M7 P7 恆真" \
  "s/BETWEEN -2147483648 AND 2147483647/BETWEEN -1e30 AND 1e30/g" "$O_OVF" overpaid

# 🔴🔴 本檔自己的假綠守門(實錘:一個多餘的反斜線讓 M2b 變成上一行的參數、整格沒跑,
#    而 PASS=33 FAIL=0 看起來完全健康)。⇒ 宣告格數與實跑格數必須相等。
EXPECTED_CELLS="${EXPECTED_CELLS:-49}"   # 純測試格數(不含 provision/teardown);可覆寫僅供突變驗這道守門
echo ""
if [ $((PASS + FAIL)) -ne "$EXPECTED_CELLS" ]; then
  echo "🔴 實跑格數 $((PASS + FAIL)) ≠ 宣告 $EXPECTED_CELLS ⇒ **有格子沒被執行**(語法接錯/提早 return),"
  echo "   這種漏格不會讓總數變紅,只會讓它變小。拒絕以綠收工。"
  FAIL=$((FAIL + 1))
fi
echo "════ PASS=$PASS FAIL=$FAIL(宣告 $EXPECTED_CELLS 格)════"

if [ "$MODE" = "all" ]; then
  log "teardown"
  if PORT="$PORT" bash scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1; then
    :
  else
    echo "🔴 teardown 指令自己回非 0 ⇒ 計入 FAIL(關卡2 R2:第一版只看 port、忽略指令退出碼)"
    FAIL=$((FAIL + 1))
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "🔴 teardown 後 port $PORT 仍被占 ⇒ 計入 FAIL(關卡2:只印紅字不計數 ⇒ 仍以 FAIL=0 成功退出)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ teardown 後 port $PORT 無人聽(零留痕)"
  fi
fi
[ "$FAIL" -eq 0 ]
