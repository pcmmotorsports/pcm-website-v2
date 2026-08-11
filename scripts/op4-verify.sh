#!/usr/bin/env bash
#
# OP4 行為 harness —— `20260811050000_m4b_e10_op4_backfill_card_ledger.sql`
#
#   PORT=54378 bash scripts/op4-verify.sh all /tmp/op4v     # provision → 跑 → teardown
#   PORT=54378 bash scripts/op4-verify.sh run  /tmp/op4v    # 沿用既有庫只跑測試
#
# ── 設計:為什麼是「clone 一個庫跑一格」而不是「一個庫跑到底」───────────────
# 本 migration 是**單一交易 + forward-only**(staff seed 是裸 INSERT、二次 apply 撞 PK)
# ⇒ 每一格都需要一個**沒套過它**的乾淨庫。逐格重新 provision 要好幾分鐘 × 20 格 = 不可行。
# ⇒ provision 一次(此時 050000 會以「0 張候選」套上去),然後每格:
#      CREATE DATABASE … TEMPLATE → 撤掉 050000 唯一的持久痕跡(那一列 staff)→ 造 fixture → 重套 050000
#   🔴 這個做法**建立在一個假設上**:provision 的 seed 不會滿足十三條前提(⇒ 基準庫零回填列)。
#      假設若破,「撤掉 staff 列」會因為 order_payments 還參照它而失敗、或更糟:靜默留下上一格的列。
#      ⇒ `assert_base_clean` 把這個假設變成會紅的斷言,不是註解裡的祈禱。
#
# ── 誠實邊界 ──────────────────────────────────────────────────────────────
# · 本機 PG 非 Supabase:ACL/RLS 的角色形狀不同,本 harness **不驗**那一面。
# · 零寫入 md5 在這裡成立(庫是靜止的);**在正式站不成立**,所以那條斷言刻意
#   不在 migration 檔內(codex 關卡1 #17)——同一條斷言在不同環境效力不同。
# · 前提共 **13 條**(P1,P2,P4-P14;P3 已刪)。
# · P4「至多一筆 charged」由 DDL 保證 ⇒ **本 harness 不為它造負測**,也不宣稱它被證明過。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C

MODE="${1:?用法:op4-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 直屬短路徑,例 /tmp/op4v)}"
PORT="${PORT:?🔴 PORT 必須顯式帶(本支無預設值;建議 54378)}"
MIG="supabase/migrations/20260811050000_m4b_e10_op4_backfill_card_ledger.sql"

PASS=0; FAIL=0
log()  { echo ""; echo "== $* =="; }
die()  { echo "🔴 $*" >&2; exit 1; }
cell() { # cell <描述> <期望> <實際>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1"; echo "     期望=[$2]"; echo "     實際=[$3]"; fi
}
base_url() { echo "postgresql://postgres@127.0.0.1:${PORT}/postgres"; }
db_url()   { echo "postgresql://postgres@127.0.0.1:${PORT}/$1"; }
# 🔴🔴 **所有 psql 一律 `-X`**(關卡2 reviewer M3):`~/.psqlrc` 若有 `\set ECHO all`,
#    migration 的**原始碼**會被 echo 進 apply.log ⇒ 突變格 grep `pcm_op4_*` 會命中**自己的輸入**
#    = 「量錯東西」第八形狀,假綠。`\timing on` 也會讓 scalar 比對錯位。
# 🔴 不用 `2>/dev/null` 吞錯:靜默失敗會讓「fixture 沒建成」偽裝成「前提有效」。
sqlx() { psql -X "$1" -v ON_ERROR_STOP=1 -qtA -c "$2" || die "SQL 失敗(db=$1):${2:0:120}"; }
sqlq() { psql -X "$1" -v ON_ERROR_STOP=1 -qtA -c "$2"; }   # 允許紅(負向探針用)

test -f "$MIG" || die "找不到 migration:$MIG"

# ── provision ─────────────────────────────────────────────────────────────
if [ "$MODE" = "all" ]; then
  log "provision 拋棄式 PG17(含全部 migrations;050000 會以 0 候選套上)"
  # 🔴 路徑守門:下面會 rm -rf。只准 /tmp 直屬短路徑,不靠註解要求。
  printf '%s' "$WORK" | grep -Eq '^/tmp/[A-Za-z0-9_-]+$' || die "workdir 必須是 /tmp 直屬短路徑:$WORK"
  rm -rf "$WORK"
  PORT="$PORT" bash scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK-prov.log" 2>&1 \
    || { echo "🔴 provision 失敗"; tail -20 "$WORK-prov.log"; exit 1; }
  echo "  · provision 完成(**非測試格**,不計數)"
fi

BASE="$(base_url)"

# ── 基準庫假設:必須零回填列(見檔頭)─────────────────────────────────────
assert_base_clean() {
  local n
  n="$(sqlq "$BASE" "SELECT count(*) FROM public.order_payments WHERE actor = 'op4_backfill';")"
  [ "$n" = "0" ] || die "基準庫已有 $n 列回填 ⇒ clone 假設破,整支 harness 的乾淨度不成立"
}

CLONE_N=0
fresh_db() {   # 印出新 db 名;內含「撤掉 050000 的持久痕跡」
  CLONE_N=$((CLONE_N+1))
  local d="op4c${CLONE_N}"
  psql -X "$(db_url template1)" -v ON_ERROR_STOP=1 -qtA -c "DROP DATABASE IF EXISTS $d;" >/dev/null
  psql -X "$(db_url template1)" -v ON_ERROR_STOP=1 -qtA -c "CREATE DATABASE $d TEMPLATE postgres;" >/dev/null
  # 撤掉 050000 唯一的持久痕跡(那一列 staff)。零回填列由 assert_base_clean 保證 ⇒ 無 FK 阻擋。
  sqlx "$(db_url $d)" "DELETE FROM public.staff WHERE id = 'op4_backfill';"
  echo "$d"
}

# ── fixture:造一張**完全合格**的候選單 ───────────────────────────────────
# 🔴 不自己湊 NOT NULL 欄:從既有 seed 單複製(display_id 有格式 CHECK、order_items 另有
#    variant_sku/product_snapshot 必填)。自己湊 = 把「訂單合法形狀」重寫一份,漂了沒人發現。
# 🔴 運費刻意非 0:讓 total <> subtotal,否則「比 subtotal 還是比 total」這一軸恆真。
mk_candidate() {  # mk_candidate <db> <subtotal> <shipping> [rec 後綴] → 印 order_id
  local d="$1" sub="$2" ship="$3" sfx="${4:-x}"
  sqlq "$(db_url $d)" "
    WITH src AS (SELECT * FROM public.orders ORDER BY created_at LIMIT 1),
         si  AS (SELECT * FROM public.order_items ORDER BY id LIMIT 1),
    o AS (
      INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot,
             tier_at_checkout, payment_status, fulfillment_status, subtotal, shipping_fee,
             discount_total, total, shipping_method, invoice, shipping_method_at_checkout,
             payment_method, payment_channel, tappay_rec_trade_id, paid_at)
      SELECT (SELECT string_agg(substr('23456789BCDFGHJKMNPQRSTVWXYZ',
                (random()*26)::int + 1, 1), '') FROM generate_series(1,6)),
             src.customer_user_id, src.shipping_address_snapshot, src.tier_at_checkout,
             'paid', 'notOrdered', $sub, $ship, 0, $sub + $ship,
             src.shipping_method, src.invoice, src.shipping_method_at_checkout,
             'tappay', 'tappay', 'rec_${sfx}', now() - interval '3 days'
        FROM src
      RETURNING id, customer_user_id, tappay_rec_trade_id, total, paid_at
    ), it AS (
      INSERT INTO public.order_items (order_id, variant_sku, product_snapshot,
             quantity, unit_price, line_total)
      SELECT o.id, si.variant_sku, si.product_snapshot, 1, $sub, $sub FROM o, si
      RETURNING order_id
    ), att AS (
      INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status,
             rec_trade_id, fallback_token_hash, created_at, updated_at)
      SELECT o.id, o.customer_user_id, 'charged', o.tappay_rec_trade_id,
             repeat('a', 64), o.paid_at - interval '1 minute', o.paid_at - interval '1 second'
        FROM o
      RETURNING order_id
    ), wh AS (
      INSERT INTO public.payment_webhook_events (rec_trade_id, order_number, raw_hash, amount)
      SELECT o.tappay_rec_trade_id, o.id::text, repeat('b', 64), o.total FROM o
      RETURNING rec_trade_id
    )
    SELECT id::text FROM o;" | tail -1
}

# 套 migration(可帶 sed 突變);印出 exit code
apply_mig() {  # apply_mig <db> [sed 腳本]
  local d="$1" sedscript="${2:-}"
  local f="$WORK/mig.sql"
  mkdir -p "$WORK"
  if [ -n "$sedscript" ]; then
    # 🔴 關卡2 reviewer M4:原本只擋「零命中」。**多命中同樣致命** —— 一次改兩處
    #    (其中一處在斷言②)= 同時掏空實作與檢查者,兩邊一起瞎。這正是我 M5b 假綠的殘洞。
    #    ⇒ 從 sed 腳本裡取出字面 pattern,強制它在檔內恰好命中一次。
    local pat=""
    if [ "${sedscript:0:2}" = "s|" ]; then
      local rest="${sedscript#s|}"
      pat="${rest%%|*}"
    fi
    # 🔴 R2 F4:原本「抽不出 pattern 就跳過整道檢查」= 恆真旁路 —— 換一種 sed 寫法
    #    (例如 `/x/d`)就悄悄失去多命中守門。抽不出就 die,不給預設放行路。
    [ -n "$pat" ] || die "突變守門:無法從 sed 腳本抽出 pattern(只支援 s|…|…| 形式):$sedscript"
    if [ -n "$pat" ]; then
      # 🔴 數命中要**盡量貼近 sed 自己的比對語意**,不能自己另發明一套
      #    (memory `feedback_verify-anchor-with-the-guards-own-command`:
      #     我用自己的錨去驗守門,結果驗的根本不是同一件事)。
      #    · `^…$` 錨定 ⇒ sed 比的是**整行** ⇒ 這裡用 `grep -cxF`(整行相等)。
      #    · 沒錨定 ⇒ sed 比的是**子字串** ⇒ 用 `grep -cF`。
      #    ⚠️ R2 F3 的誠實邊界:`grep -F` 比**字面**、sed 用 **BRE**(`.` 是萬用字元)
      #       ⇒ 兩者並非同構。現行四個 pattern 實查無分歧(無 `.` 以外的 BRE 元字元造成差異),
      #       但若日後 pattern 帶正規式元字元,這道計數會與 sed 實際命中不一致。**不宣稱等價。**
      local lit="$pat" mode="-cF"
      if [ "${pat:0:1}" = "^" ] && [ "${pat: -1}" = "$" ]; then
        lit="${pat#^}"; lit="${lit%$}"; mode="-cxF"
      fi
      local nhit; nhit="$(grep $mode -- "$lit" "$MIG" || true)"
      [ "$nhit" = "1" ] || die "突變 pattern 的字面在 $MIG 出現 $nhit 次(必須恰 1,否則一次改兩處):$lit"
    fi
    sed "$sedscript" "$MIG" > "$f"
    cmp -s "$MIG" "$f" && die "突變沒改到東西(sed 無命中):$sedscript"
  else
    cp "$MIG" "$f"
  fi
  # 🔴 `-v VERBOSITY=verbose` 是**必要的**,不是好看:預設 verbosity **不印約束名**
  #    ⇒ 下面突變格用來判別「紅的是不是我的斷言」的 grep 會恆假(本 harness 真的中過)。
  psql -X "$(db_url $d)" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -f "$f" > "$WORK/apply.log" 2>&1
  echo $?
}

backfilled_n() { sqlq "$(db_url $1)" "SELECT count(*) FROM public.order_payments WHERE actor='op4_backfill';"; }
backfilled_for() { sqlq "$(db_url $1)" "SELECT count(*) FROM public.order_payments WHERE actor='op4_backfill' AND order_id='$2';"; }

assert_base_clean

# ══════════════════════════════════════════════════════════════════════════
log "G0 harness 自我測試(壞 SQL 必須被判紅)"
rc=$(psql -X "$BASE" -v ON_ERROR_STOP=1 -qtA -c "SELECT this_is_not_valid;" >/dev/null 2>&1; echo $?)
cell "G0:壞掉的 SQL 會被判紅" "1" "$([ "$rc" = "0" ] && echo 0 || echo 1)"

# ── 正向 ──────────────────────────────────────────────────────────────────
log "G1 正向:一張完全合格的單 ⇒ 回填 1 列、形狀正確"
D=$(fresh_db); OID=$(mk_candidate "$D" 900 100 g1)
rc=$(apply_mig "$D")
cell "G1 migration 綠" "0" "$rc"
cell "G1 回填恰 1 列" "1" "$(backfilled_n $D)"
cell "G1 逐欄形狀正確(rail/amount/received_at/rec/沖銷欄空)" "true" \
  "$(sqlq "$(db_url $D)" "SELECT (p.rail='card' AND p.amount=1000 AND p.received_at=o.paid_at
       AND p.rec_trade_id=o.tappay_rec_trade_id AND p.reverses_payment_id IS NULL
       AND p.bank_reference IS NULL AND p.request_id IS NULL)::text
     FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id
    WHERE p.actor='op4_backfill';")"
cell "G1 amount 用 total(1000)不是 subtotal(900)⇒ 運費軸有判別力" "1000" \
  "$(sqlq "$(db_url $D)" "SELECT amount FROM public.order_payments WHERE actor='op4_backfill';")"
cell "G1 回填後 OP6-a 不再回 G_LEDGER_NOT_BACKFILLED" "false" \
  "$(sqlq "$(db_url $D)" "SELECT (public.admin_compute_order_settlement('$OID')->'reasons' @> '[\"G_LEDGER_NOT_BACKFILLED\"]'::jsonb)::text;")"
cell "G1 staff 種了 op4_backfill 且 is_active=false" "false" \
  "$(sqlq "$(db_url $D)" "SELECT is_active::text FROM public.staff WHERE id='op4_backfill';")"

log "G2 N=0 路徑:零候選時整片仍綠且零寫入(補斷言①在 N=0 時的恆真盲區)"
D=$(fresh_db)
rc=$(apply_mig "$D")
cell "G2 零候選 migration 仍綠" "0" "$rc"
cell "G2 零候選 ⇒ 零**回填**列(staff seed 那一列仍會寫,格名不含糊)" "0" "$(backfilled_n $D)"

log "G3 forward-only:同一庫二次 apply 必紅(不是「可放心重跑」)"
D=$(fresh_db); mk_candidate "$D" 900 100 g3 >/dev/null
rc1=$(apply_mig "$D"); rc2=$(apply_mig "$D")
cell "G3 首次綠" "0" "$rc1"
cell "G3 二次紅(staff PK 撞)" "1" "$([ "$rc2" = "0" ] && echo 0 || echo 1)"
cell "G3 二次失敗後回填列數不變(整片回滾)" "1" "$(backfilled_n $D)"

# ── 逐前提負測:每格「一張壞單 + 一張好單」,壞的不得被寫、好的必須被寫 ──
# 🔴 兩張一起放的理由:只放壞單的話,migration 整個壞掉也會得到「0 列」= 假綠
#    (memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
#    好單必須同時被寫,才證明是**那一條前提**擋的、不是全片死了。
neg_cell() {  # neg_cell <代號> <說明> <破壞 SQL(用 :OID)>
  local tag="$1" desc="$2" break_sql="$3"
  local d bad good
  d=$(fresh_db)
  bad=$(mk_candidate "$d" 900 100 "${tag}b")
  good=$(mk_candidate "$d" 500 100 "${tag}g")
  sqlx "$(db_url $d)" "${break_sql//:OID/$bad}"
  local rc; rc=$(apply_mig "$d")
  if [ "$rc" != "0" ]; then
    FAIL=$((FAIL+1)); echo "  ❌ $tag $desc — migration 整片紅了(應該是綠但只寫好單)"
    tail -5 "$WORK/apply.log"; return
  fi
  cell "$tag 壞單未被回填($desc)" "0" "$(backfilled_for $d $bad)"
  cell "$tag 同批好單仍被回填(證明是這條前提擋的、不是全片死了)" "1" "$(backfilled_for $d $good)"
}

log "逐前提負測(每格附同批好單當對照)"
neg_cell P1  "payment_status 非 paid" \
  "UPDATE public.orders SET payment_status='partiallyPaid' WHERE id=':OID';"
# 🔴 關卡2 codex C8:原本放的是**同 rec 的 card 列** ⇒ P2 若失效,擋下我的會是
#    `order_payments_card_idem_uniq`(唯一鍵)而不是 P2 ⇒ 觀察被別的機制供給。
#    改放**跨軌** bank_transfer 列:沒有任何唯一鍵會擋它,只有 P2 擋得住。
neg_cell P2  "帳本已有列(跨軌 bank_transfer ⇒ 唯一鍵不會代打)" \
  "INSERT INTO public.order_payments (order_id, rail, amount, received_at, bank_reference, request_id, actor)
   SELECT id,'bank_transfer',total,paid_at,'BR12345',gen_random_uuid(),'sean' FROM public.orders WHERE id=':OID';"
neg_cell P4  "無 charged attempt" \
  "UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=':OID';"
neg_cell P5  "attempt 的 rec 與 orders 不一致" \
  "UPDATE public.payment_charge_attempts SET rec_trade_id='rec_mismatch' WHERE order_id=':OID';"
neg_cell P6a "paid_at 為 NULL" \
  "UPDATE public.orders SET paid_at=NULL WHERE id=':OID';"
neg_cell P6b "paid_at 在未來(codex#7:否則會撞 OP2a 的 P2B31 讓整片回滾)" \
  "UPDATE public.orders SET paid_at=now()+interval '2 days' WHERE id=':OID';"
neg_cell P7a "orders.cancelled_at 有值(codex#1:v1 漏看的半條)" \
  "UPDATE public.orders SET cancelled_at=now() WHERE id=':OID';"
neg_cell P7b "orders.cancelled_reason 有值(單獨一格:與 cancelled_at 不成對出現才測得到)" \
  "UPDATE public.orders SET cancelled_reason='測試' WHERE id=':OID';"
neg_cell P9  "attempt 被讓路 superseded(Sean 拍板:永不准認列成收款)" \
  "UPDATE public.payment_charge_attempts
      SET released_at=now()-interval '2 days', superseded_at=now()-interval '1 day',
          superseded_reason='stuck_pending'
    WHERE order_id=':OID';"
neg_cell P10a "webhook 列不存在" \
  "DELETE FROM public.payment_webhook_events
    WHERE rec_trade_id=(SELECT tappay_rec_trade_id FROM public.orders WHERE id=':OID');"
neg_cell P10b "webhook 金額與 total 不符" \
  "UPDATE public.payment_webhook_events SET amount=amount+1
    WHERE rec_trade_id=(SELECT tappay_rec_trade_id FROM public.orders WHERE id=':OID');"
neg_cell P11 "品項合計 <> subtotal(codex#5:第二個獨立金額來源)" \
  "UPDATE public.order_items SET unit_price=unit_price+50, line_total=(unit_price+50)*quantity WHERE order_id=':OID';"
neg_cell P12 "attempt 的 customer 與訂單不一致" \
  "UPDATE public.payment_charge_attempts
      SET customer_user_id=(SELECT user_id FROM public.customers
                             WHERE user_id<>(SELECT customer_user_id FROM public.orders WHERE id=':OID') LIMIT 1)
    WHERE order_id=':OID';"
neg_cell P13 "payment_method 非 tappay" \
  "UPDATE public.orders SET payment_method='atm' WHERE id=':OID';"
neg_cell P14 "attempt 在付款後又被動過(updated_at 晚於 paid_at)" \
  "UPDATE public.payment_charge_attempts SET updated_at=(SELECT paid_at FROM public.orders WHERE id=':OID')+interval '1 hour'
    WHERE order_id=':OID';"

log "關卡2 codex C7:補上原本沒有行為負測的分支"
neg_cell P6c "total = 0(原本只測 paid_at 兩態,正值那半沒測)" \
  "UPDATE public.order_items SET unit_price=0, line_total=0 WHERE order_id=':OID';
   UPDATE public.orders SET subtotal=0, shipping_fee=0, total=0 WHERE id=':OID';"
# 🔴 取消 header 有 deferred constraint trigger `pcm_assert_cancellation_has_items`
#    ⇒ 光插 header 在 COMMIT 會紅。必須 header + items 同交易成對插 —— 這一格因此
#    **同時**覆蓋 P7 的兩張子表(order_cancellations 與 order_cancellation_items)。
neg_cell P7c "取消子表有列(header + items 成對;一格覆蓋 P7 的兩張子表)" \
  "WITH h AS (
     INSERT INTO public.order_cancellations (order_id, reason_code, actor, idempotency_key, payload_hash)
     SELECT id,'customer_request','sean',gen_random_uuid(),repeat('c',64)
       FROM public.orders WHERE id=':OID' RETURNING id, order_id)
   INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
   SELECT h.id, h.order_id, oi.id, 1 FROM h JOIN public.order_items oi ON oi.order_id = h.order_id;"
neg_cell P11b "品項數 = 0(原本只測合計不符,零品項那半沒測)" \
  "DELETE FROM public.order_items WHERE order_id=':OID';
   UPDATE public.orders SET subtotal=0, total=shipping_fee WHERE id=':OID';"

log "P8 退款面四本(🔴 order_refunds 那格是 OP4 比 OP6-a 嚴的唯一證據)"
neg_cell P8a "order_refunds 有列且 status='failed' —— OP6-a 會除外它、OP4 不除外" \
  "INSERT INTO public.order_refunds (order_id, bank_refund_id, refund_amount, status, reason,
          actor, request_id, rec_trade_id, kind, record_refunded_before)
   SELECT id, 'br_test', 1, 'processing', '測試', 'sean', gen_random_uuid(),
          tappay_rec_trade_id, 'full', 0 FROM public.orders WHERE id=':OID';
   UPDATE public.order_refunds SET status='failed', failed_reason='測試失敗' WHERE order_id=':OID';"
neg_cell P8c "payment_double_charge_anomalies 有列(走 Dashboard 退款、不經前兩本)" \
  "INSERT INTO public.payment_double_charge_anomalies (old_attempt_id, old_order_id, user_id,
          cart_session_id, rec_trade_id, refund_target_rec_trade_id, released_at, charged_at, amount)
   SELECT a.id, o.id, o.customer_user_id, gen_random_uuid(), o.tappay_rec_trade_id,
          o.tappay_rec_trade_id, now()-interval '2 days', now()-interval '2 days', o.total
     FROM public.orders o JOIN public.payment_charge_attempts a ON a.order_id=o.id
    WHERE o.id=':OID';"

# ── P8b(order_refund_jobs):🔴 **不造行為格,改證它為什麼不需要行為格** ─────
# 這一面**構造不出獨立的負測**,而且理由是結構性的、不是「太麻煩」:
#   `orj_cancellation_fk` 是 **(cancellation_id, order_id) 複合 FK** → 指向 `order_cancellations(id, order_id)`
#   ⇒ 任何 order X 的退款工單,**必然**蘊含 order X 有一張取消單 ⇒ **P7 已經先擋掉 X**。
#   ⇒ 我 migration 裡那條 `order_refund_jobs` 子句對**可達的資料形狀**是嚴格被 P7 蘊含的 = 寫不出只紅它的負測
#      (memory `feedback_unconstructible-negative-test-means-noop-guard`)。
#   ⇒ 子句**保留**(P7 若日後放寬、或 FK 若改成單欄,它就變成唯一防線),但**不宣稱它被行為證明過**。
# 🔴 所以這裡測的是**蘊含關係的前提**,不是偽造一個行為:複合 FK 若被改掉,這格會紅,
#    那時就會知道「那條子句從冗餘變成載重」⇒ 該補真的行為格了。
log "P8b:order_refund_jobs 子句 —— 不造行為格,改釘住它為何冗餘"
# 🔴 reviewer M5:蘊含的地基其實是 **cancellation_id NOT NULL** —— 複合 FK 是 MATCH SIMPLE,
#    NULL 的 cancellation_id 會讓整條 FK **直接通過** ⇒ 蘊含失效而原本的格照樣綠。
cell "P8b-0 cancellation_id 仍是 NOT NULL(MATCH SIMPLE 下這才是蘊含的地基)" "true" \
  "$(sqlq "$BASE" "SELECT attnotnull::text FROM pg_attribute
     WHERE attrelid='public.order_refund_jobs'::regclass AND attname='cancellation_id';")"
cell "P8b orj_cancellation_fk 仍是 (cancellation_id, order_id) 複合 FK ⇒ 工單必蘊含同單取消 ⇒ P7 先擋" "true" \
  "$(sqlq "$BASE" "SELECT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='orj_cancellation_fk' AND contype='f'
        AND pg_get_constraintdef(oid) = 'FOREIGN KEY (cancellation_id, order_id) REFERENCES order_cancellations(id, order_id) ON DELETE RESTRICT')::text;")"
# 🔴 reviewer M5:只數 conname ⇒ drop 後 re-add 同名不同式照樣綠。要比**定義本身**。
cell "P8b 休眠閘仍是 CHECK (false)(比定義不比名字)" "CHECK (false)" \
  "$(sqlq "$BASE" "SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname='order_refund_jobs_dormant_until_triggers';")"

# ── 突變:掏空實作,對應斷言必須紅 ────────────────────────────────────────
# 🔴 每一發只改一處,且要能指出**哪一條斷言**接住它。改不到東西的 sed 直接 die。
mut_cell() {  # mut_cell <代號> <說明> <sed> <期望 rc>
  local tag="$1" desc="$2" sedscript="$3" want="$4" want_con="${5:-pcm_op4_}"
  local d; d=$(fresh_db); mk_candidate "$d" 900 100 "m${CLONE_N}" >/dev/null
  local rc; rc=$(apply_mig "$d" "$sedscript")
  local got; got="$([ "$rc" = "0" ] && echo 0 || echo 1)"
  if [ "$want" = "1" ]; then
    local why="syntax-or-other"
    grep -q "$want_con" "$WORK/apply.log" && why="$want_con"
    grep -qE 'syntax error|語法錯誤' "$WORK/apply.log" && why="SYNTAX-ERROR"
    cell "$tag $desc" "1|$want_con" "$got|$why"
  else
    cell "$tag $desc" "$want" "$got"
  fi
}

log "突變(判別力):掏空實作,對應斷言必須紅"
mut_cell M1 "掏空主 INSERT ⇒ 斷言①存活性紅" \
  "s|^  FROM op4_candidates c;\$|  FROM op4_candidates c WHERE false;|" 1 pcm_op4_written_count_mismatch
mut_cell M2 "rec_trade_id 寫錯 ⇒ 斷言③(回問 OP6-a)紅" \
  "s|SELECT c.order_id, 'card', c.total, c.paid_at, c.rec, 'op4_backfill'|SELECT c.order_id, 'card', c.total, c.paid_at, c.rec \|\| '_wrong', 'op4_backfill'|" 1 pcm_op4_ledger_gap_persists
mut_cell M3 "amount 寫錯 ⇒ 斷言②/④紅" \
  "s|SELECT c.order_id, 'card', c.total, c.paid_at, c.rec, 'op4_backfill'|SELECT c.order_id, 'card', c.total + 1, c.paid_at, c.rec, 'op4_backfill'|" 1 pcm_op4_row_shape_wrong
mut_cell M4 "拿掉 P9 前提 + 合格 fixture ⇒ 候選集不變 ⇒ **不可觀測**(期望綠;判別力在 M4b)" \
  "s|^   AND a.superseded_at IS NULL$||" 0
mut_cell M5 "拿掉 P10 前提 + 合格 fixture ⇒ 候選集不變 ⇒ **不可觀測**(期望綠;判別力在 M5b)" \
  "s|w.rec_trade_id = l.rec AND w.amount = l.total|1=1|" 0

# 🔴 M4/M5 期望 rc=0 的理由:合格 fixture 下拿掉一條前提,候選集**不變**
#    ⇒ 該突變在這個 fixture 上不可觀測。要讓它紅,fixture 必須是「只違反那一條」的壞單。
#    ⇒ 下面兩格才是真正的判別力來源:壞單 + 拿掉對應前提 ⇒ 斷言②必須紅。
mut_neg() {  # mut_neg <代號> <說明> <破壞 SQL> <sed>
  local tag="$1" desc="$2" break_sql="$3" sedscript="$4" want_con="${5:-pcm_op4_}"
  local d bad; d=$(fresh_db); bad=$(mk_candidate "$d" 900 100 "mn${CLONE_N}")
  sqlx "$(db_url $d)" "${break_sql//:OID/$bad}"
  local rc; rc=$(apply_mig "$d" "$sedscript")
  # 🔴 只看 rc<>0 不夠:sed 打壞語法也會 rc<>0(本 harness 真的發生過,M5b 一度假綠)。
  #    必須確認紅的是**我具名的斷言**(pcm_op4_*),不是別的機制。
  # 🔴 關卡2 codex C6:泛稱 `pcm_op4_` 不夠 —— M2 宣稱證明斷言③、M3 宣稱涵蓋斷言④,
  #    但兩者其實**先被斷言②攔下**,泛稱 grep 會讓那個錯誤宣稱看起來成立。
  #    ⇒ 每一格自己宣告它期望的**那一條**約束名。
  local why="syntax-or-other"
  grep -q "$want_con" "$WORK/apply.log" && why="$want_con"
  grep -qE 'syntax error|語法錯誤' "$WORK/apply.log" && why="SYNTAX-ERROR"
  cell "$tag $desc" "1|$want_con" "$([ "$rc" = "0" ] && echo 0 || echo 1)|$why"
}
log "突變 × 壞單:拿掉前提之後,壞單會被寫進去 ⇒ 斷言②必須接住"
mut_neg M4b "壞單(superseded)+ 拿掉 P9 ⇒ 斷言②全量重驗紅" \
  "UPDATE public.payment_charge_attempts
      SET released_at=now()-interval '2 days', superseded_at=now()-interval '1 day',
          superseded_reason='stuck_pending' WHERE order_id=':OID';" \
  "s|^   AND a.superseded_at IS NULL$||" pcm_op4_recheck_set_mismatch
mut_neg M5b "壞單(webhook 金額不符)+ 拿掉 P10 ⇒ 斷言②全量重驗紅" \
  "UPDATE public.payment_webhook_events SET amount=amount+1
    WHERE rec_trade_id=(SELECT tappay_rec_trade_id FROM public.orders WHERE id=':OID');" \
  "s|w.rec_trade_id = l.rec AND w.amount = l.total|1=1|" pcm_op4_recheck_set_mismatch

# ── 併發 ──────────────────────────────────────────────────────────────────
log "併發(reviewer M6:要證的是 **repo 事實**,不是 PG 鎖衝突表)"
# 🔴 M6 的兩個修正:
#   ① 只斷言 `rc<>0` ⇒ 紅可以來自任何東西。要斷言 **55P03**(lock_not_available)。
#   ② 裸 `FOR UPDATE` 當對手,證的是「PG 的鎖會衝突」——那是 PG 文件保證的,不是本 repo 的事實。
#      真正承重的事實是「**OP5/OP3 在寫帳本之前真的鎖了同一列 orders**」。
#      ⇒ 第二格直接呼 `admin_record_manual_payment` 當對手。它同時讓 M1(快照可見性)可觀測。
D=$(fresh_db); OID=$(mk_candidate "$D" 900 100 conc)
psql -X "$(db_url $D)" -v ON_ERROR_STOP=1 -qtA \
  -c "BEGIN; SELECT id FROM public.orders WHERE id='$OID' FOR UPDATE; SELECT pg_sleep(20); COMMIT;" \
  > /dev/null 2>&1 &
HOLDER=$!
sleep 2
rc=$(apply_mig "$D")
cell "併發 A:對手持鎖 ⇒ migration 紅在 55P03(不是隨便紅)" "1|55P03" \
  "$([ "$rc" = "0" ] && echo 0 || echo 1)|$(grep -qE '55P03|lock_not_available|無法取得鎖|lock timeout' "$WORK/apply.log" && echo 55P03 || echo other)"
cell "併發 A:失敗後零回填列(整片回滾)" "0" "$(backfilled_n $D)"
wait $HOLDER 2>/dev/null || true

# 併發 B:🔴 真對手 —— OP5 的具名 RPC。它若在寫帳本前**沒有**鎖同一列 orders,這格會抓到。
#   而且它正是 M1 的可觀測化:對手在我等鎖期間**提交**,我拿到鎖之後必須**看得見**那一列,
#   ⇒ P2 排除該單 ⇒ 回填 0 列且整片綠(不是紅)。看不見的話我會寫第二列 ⇒ 這格轉紅。
D=$(fresh_db); OID=$(mk_candidate "$D" 900 100 concb)
psql -X "$(db_url $D)" -v ON_ERROR_STOP=1 -qtA -c "
  BEGIN;
  SELECT public.admin_record_manual_payment(
    '$OID'::uuid, gen_random_uuid(), 'sean', 'bank_transfer', 1000,
    now(), 'BR99999', NULL);
  SELECT pg_sleep(5);
  COMMIT;" > "$WORK/op5.log" 2>&1 &
HOLDER2=$!
sleep 1
# 🔴 R2 F1:這一格的判別力**有 timing 依賴**。若 apply 是在對手 commit 之後才跑到第一句,
#    兩個快照本來就都看得見那一列 ⇒ 回填 0 列照樣綠,而格名宣稱的「拿到鎖之後才看見」
#    **根本沒發生過**。⇒ 量真實耗時:必須真的卡在鎖上等過(對手 sleep 3s 後才 commit)。
T0=$SECONDS
rc=$(apply_mig "$D")
ELAPSED=$((SECONDS-T0))
wait $HOLDER2 2>/dev/null || true
# 🔴 這道門檻**量過基準**才敢設:無對手時同一支 apply 實測 **0s**(拋棄式 PG17,同機同版本)
#    ⇒ 2s 以上只可能來自等鎖,不是 apply 自己就慢 = 這條斷言不是恆真。
#    對手 sleep 5s(不是 3s)是為了讓實測值離門檻夠遠、不在邊界上抖。
cell "併發 B:apply 真的**等過鎖**(耗時 ${ELAPSED}s ≥ 2s;無對手基準實測 0s)⇒ 非 timing 碰巧綠" "true" \
  "$([ "$ELAPSED" -ge 2 ] && echo true || echo false)"
cell "併發 B:OP5 具名 RPC 當對手 ⇒ 它有鎖 orders,我等到它提交" "0" \
  "$(grep -qE 'ERROR|錯誤' "$WORK/op5.log" && echo "OP5-FAILED:$(head -1 "$WORK/op5.log")" || echo 0)"
cell "併發 B:🔴 M1 可觀測化 —— 我拿到鎖後**看得見**對方剛提交的帳本列 ⇒ 該單被 P2 排除、回填 0 列" "0" \
  "$(backfilled_n $D)"
cell "併發 B:且整片是綠的(排除不是炸片)" "0" "$rc"

# ── 零寫入(此環境成立)───────────────────────────────────────────────────
log "零寫入:除 order_payments / staff 外,其餘表全表 md5 前後相同"
D=$(fresh_db); mk_candidate "$D" 900 100 zw >/dev/null
# 🔴 關卡2 codex N3:原清單漏掉 migration 會讀的 order_cancellation_items 與 payment_refunds
TBLS="orders order_items payment_charge_attempts payment_webhook_events order_refunds order_refund_jobs order_cancellations order_cancellation_items payment_refunds payment_double_charge_anomalies"
md5_of() { local d="$1" out=""; for t in $TBLS; do
    out="$out$(sqlq "$(db_url $d)" "SELECT md5(coalesce(string_agg(x.t, '|' ORDER BY x.t), '')) FROM (SELECT $t::text AS t FROM public.$t) x;")"; done; echo "$out"; }
BEFORE=$(md5_of "$D"); rc=$(apply_mig "$D"); AFTER=$(md5_of "$D")
cell "零寫入 migration 綠" "0" "$rc"
cell "零寫入:十張表 md5 前後完全相同" "same" "$([ "$BEFORE" = "$AFTER" ] && echo same || echo differ)"

# ── teardown(🔴 R2 F6:必須在總結行**之前**,否則它的 FAIL 不會被印出來的數字反映)──
if [ "$MODE" = "all" ]; then
  log "teardown"
  bash scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || true
  if lsof -ti :"$PORT" >/dev/null 2>&1; then
    echo "  ❌ teardown 後 port $PORT 仍有人聽(留痕)"; FAIL=$((FAIL+1))
  else
    echo "  ✅ teardown 後 port $PORT 無人聽(零留痕)"
  fi
fi

# ── 自我假綠守門 ──────────────────────────────────────────────────────────
# 🔴 可由 env 覆寫 ⇒ 這道守門自己也能被突變測(宣告錯的數字必須紅)。
# ⚠️ teardown 那一格不計入 EXPECTED_CELLS(它不是測試格,且只在 all 模式跑)。
EXPECTED_CELLS="${EXPECTED_CELLS:-70}"
TOTAL=$((PASS+FAIL))
echo ""
if [ "$TOTAL" -ne "$EXPECTED_CELLS" ]; then
  echo "🔴 實跑格數 $TOTAL <> 宣告格數 $EXPECTED_CELLS ⇒ 有格子沒被執行(或宣告過期)"
  FAIL=$((FAIL+1))
fi
echo "════ PASS=$PASS FAIL=$FAIL(宣告 $EXPECTED_CELLS 格)════"

[ "$FAIL" -eq 0 ] || exit 1
