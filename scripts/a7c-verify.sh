#!/usr/bin/env bash
#
# A7c 退款帳本(改記金額版)· 驗收 harness — 負測 + 正向鏈 + 突變證明 + 重放
#
# 用法:
#   bash scripts/d1t2-rehearsal.sh provision /tmp/a7c-work   # 先建庫(已含 A7c)
#   bash scripts/a7c-verify.sh /tmp/a7c-work
#
# 對應交接檔 §7 驗收條件:§7-3 重複套用 → §E / §7-4 每道守門 ≥1 條負測且斷言
# CONSTRAINT_NAME → §B / §7-5 突變、0 死規則 → §D / §7-6 正向鏈坐在邊界 → §C
#
# ── 🔴 誠實邊界(先寫,免得數字被當成比它實際更強的證據)────────────────────────
# · 「負測全綠」證明的是**這些攻擊被擋**,不是「所有壞資料都被擋」。
# · 「突變後攻擊進得來」只證明該守門**對該案例**承重。
# · 跑的是本機 PG17,**不是 Supabase**:role 繼承、BYPASSRLS、pgbouncer 都不在覆蓋內。
# · **完全沒有測「防止超退」** —— 拍板⑤ 明文不做,不是漏測。
# · 🔴 測不到 TapPay Portal 手動退款那條路 ⇒ 帳本與實際退款是否一致,本檔證明不了任何事。
# · 🔴 測不到「轉 failed 後剩餘可退額回升 ⇒ 同一筆錢退兩次」——那條**刻意不設守門**
#   (Sean Q3=A),靠營運鐵律「轉 failed 前先用 Record API 對帳」擋。
#
# ── 🔴 兩個踩過的 harness 陷阱(留著當警告)────────────────────────────────
# ① BEFORE DELETE 守門的突變不能用 `NULL;` —— BEFORE trigger 回傳 NULL = 取消該操作,
#    函式會落到結尾噴「control reached end of trigger procedure without RETURN」⇒ DELETE
#    仍失敗 ⇒ 誤判成「承重」。該類守門的突變必須是 `RETURN OLD;` / `RETURN NEW;`。
# ② 突變 + 負測**必須在同一個 psql session 的同一個交易裡**:psql 每次呼叫是獨立連線,
#    分兩次跑的話第一次的 BEGIN 會回滾,第二次跑的是沒突變過的函式 ⇒ 每格都誤報承重。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="${1:-/tmp/a7c-work}"
# RW1b(2026-08-03)起可用 A7C_VERIFY_PORT 指到別的拋棄式 cluster:
# 54329 是 d1t2 家族約定 port,但平行施工視窗會佔用它;RW1b 的 A→B→A 以 54331 跑本檔。
PORT="${A7C_VERIFY_PORT:-54329}"
MIG="supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql"
export LC_ALL=C

URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
log()  { echo "== $* ==" >&2; }
die()  { echo "🔴 $*" >&2; exit 1; }
PASS=0; FAIL=0
ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || die "連不上測試庫($URL);先跑 scripts/d1t2-rehearsal.sh provision $WORK"
test -f "$MIG" || die "找不到 migration:$MIG"

# 🔴 本檔的 fixture 會對 orders 做**破壞性 UPDATE**。只用「固定 port + SELECT 1」判定
#    測試庫是不夠的 —— 萬一那個 port 上是別的、含真訂單的資料庫,會先把真訂單改掉才失敗。
#    ⇒ 連線前先證明「這是拋棄式 harness 叢集」:標記檔 + data_directory 必須對得上。
#    兩邊都要正規化再比:macOS 的 /tmp 是 /private/tmp 的 symlink,PG 回未解析路徑。
test -f "$WORK/.d1t2-harness" || die "拒跑 —— $WORK 沒有 .d1t2-harness 標記,無法確認這是拋棄式測試庫"
canon() { [ -d "$1" ] && (cd "$1" && pwd -P) || echo "$1"; }
ACTUAL_DATADIR="$(canon "$(psql "$URL" -qtA -c 'SHOW data_directory' 2>/dev/null || true)")"
EXPECT_DATADIR="$(canon "$WORK")/pgdata"
[ "$ACTUAL_DATADIR" = "$EXPECT_DATADIR" ] \
  || die "拒跑 —— port ${PORT} 的 data_directory=[$ACTUAL_DATADIR],不是預期的 [$EXPECT_DATADIR]"

# ══════════════════════════════════════════════════════════════════════════════
# §A fixture —— 🔴 逐欄選值都要問「這個值是不是讓某條守門變成恆真」
# ══════════════════════════════════════════════════════════════════════════════
# memory `feedback_fixture-value-makes-guard-vacuous`:上一輪就是運費 = 0 讓一整族守門
# 失去判別力;這一輪則是 discount_total 被釘成 0,讓折扣反例整個看不見。
#   · shipping_fee = 137 → 非零、質數,與 2437 互質 ⇒ 不會有「湊巧相等」的假綠。
#   · discount_total = 211 → **非零**。改記金額後帳本應該完全不受折扣影響,
#     而只有折扣非零時這件事才證明得了(舊形狀在這裡會多算 211)。
#   · unit_price 2437 × 3 → 品項金額 7311,但**改形狀後帳本不再用品項湊金額**,
#     這些值現在只用來把 orders.total 撐成一個非整數倍的數字。
# 🔴 fixture 的 order/item id 必須當場查、且排序要有唯一決勝鍵(o.id):
#    seed 是一次寫入的 ⇒ 多筆 created_at 相同 ⇒ 只用 created_at 排序時 LIMIT 1
#    每次可能選到不同訂單,而 tappay_rec_trade_id 有 UNIQUE ⇒ 第二次執行直接撞號。
FIXTURE_ORDER="$(psql "$URL" -qtA -c "
  SELECT o.id FROM orders o
   WHERE (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) = 1
   ORDER BY o.created_at, o.id LIMIT 1;")"
[ -n "$FIXTURE_ORDER" ] || die "找不到「恰有一個品項」的訂單當 fixture"
FIXTURE_ITEM="$(psql "$URL" -qtA -c "SELECT id FROM order_items WHERE order_id='${FIXTURE_ORDER}';")"
[ -n "$FIXTURE_ITEM" ] || die "fixture 訂單 ${FIXTURE_ORDER} 沒有品項"

FX_UNIT=2437; FX_QTY=3; FX_SUB=7311; FX_SHIP=137; FX_DISC=211
FX_TOTAL=$(( FX_SUB + FX_SHIP - FX_DISC ))      # 7237 = 訂單實收
RID=a7c00000-0000-4000-8000-000000000001

log "0/5 佈 fixture(運費 137、折扣 211 皆非零;訂單實收 ${FX_TOTAL})"
psql "$URL" -v ON_ERROR_STOP=1 -q <<SQL || die "fixture 佈設失敗"
UPDATE order_items SET unit_price=${FX_UNIT}, quantity=${FX_QTY}, line_total=${FX_SUB}
 WHERE id='${FIXTURE_ITEM}';
-- 先清掉前一次執行留下的同值標記(本欄有 UNIQUE)⇒ 讓 harness 可重複執行
UPDATE orders SET tappay_rec_trade_id = NULL
 WHERE tappay_rec_trade_id = 'REC_A7C_FIXTURE' AND id <> '${FIXTURE_ORDER}';
UPDATE orders SET subtotal=${FX_SUB}, shipping_fee=${FX_SHIP}, discount_total=${FX_DISC},
       total=${FX_TOTAL}, payment_status='paid', tappay_rec_trade_id='REC_A7C_FIXTURE'
 WHERE id='${FIXTURE_ORDER}';
SQL
psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQL || die "fixture 自檢失敗 —— 值沒設進去,後面所有測試都不可信"
DO \$\$
DECLARE v_t integer; v_d integer; v_r text;
BEGIN
  -- 🔴 用 IS DISTINCT FROM 不用 <>:訂單不存在時 SELECT INTO 給 NULL,而 NULL 與數字的
  --    <> 比較求值為 NULL(非 true)⇒ 用 <> 寫的自檢抓不到「fixture 根本不存在」。
  SELECT o.total, o.discount_total, o.tappay_rec_trade_id INTO v_t, v_d, v_r
    FROM orders o WHERE o.id='${FIXTURE_ORDER}';
  IF NOT FOUND THEN RAISE EXCEPTION 'fixture 自檢失敗 — 訂單不存在'; END IF;
  IF v_t IS DISTINCT FROM ${FX_TOTAL} OR v_d IS DISTINCT FROM ${FX_DISC}
  OR v_r IS DISTINCT FROM 'REC_A7C_FIXTURE' THEN
    RAISE EXCEPTION 'fixture 自檢失敗 total=% discount=% rec=%', v_t, v_d, v_r;
  END IF;
  IF ${FX_DISC} = 0 THEN RAISE EXCEPTION 'fixture 折扣為 0 ⇒ 折扣反例會恆真'; END IF;
END \$\$;
SQL
ok "fixture 已佈設並自檢通過(實收 ${FX_TOTAL} = 品項 ${FX_SUB} + 運費 ${FX_SHIP} − 折扣 ${FX_DISC})"

# 共用:一筆合法帳本列(改形狀後只有 header、沒有明細)
# RW1a(20260803150000)加了兩個 NOT NULL 欄 kind / record_refunded_before ⇒ 本檔所有
# INSERT 同步補值('partial', 0 —— 本檔的守門都不讀這兩欄,值只需合法;RW1b 對帳)。
read -r -d '' SEED_LEDGER <<SQL || true
INSERT INTO order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before)
VALUES ('${RID}','${FIXTURE_ORDER}','BRID-SEED-01','REC_A7C_FIXTURE', ${FX_TOTAL},
  'processing','負測前提','tester','req-seed','partial',0);
SQL

# ══════════════════════════════════════════════════════════════════════════════
# §B 負測 —— 每道守門至少一條,斷言的是**指定的 CONSTRAINT_NAME**,不是「反正紅了」
# ══════════════════════════════════════════════════════════════════════════════
NEGDIR="$WORK/a7c-neg"; rm -rf "$NEGDIR"; mkdir -p "$NEGDIR"

# emit_neg <id> <expect_constraint 或 SQLSTATE:xxxxx> <需要先造帳本列?yes|no> <攻擊 SQL>
#
# 🔴 三態不是兩態:舊版把「完全沒擋」與「被**別道**守門擋」都歸成同一種失敗
#    ⇒ 突變段無法分辨「這道承重」與「這道其實被別條蘊含」。實際誤判過一次。
emit_neg() {
  local id="$1" expect="$2" needseed="$3" attack="$4" setup="${5:-}"
  local seed=""; [ "$needseed" = "yes" ] && seed="$SEED_LEDGER"
  # 🔴 setup 放在 DO 區塊**之前**:它不是攻擊,不能被 EXCEPTION 捕捉,
  #    否則 setup 自己失敗會被誤判成「攻擊被擋下」。
  cat > "$NEGDIR/neg-$id.sql" <<SQL
BEGIN;
$seed
$setup
DO \$NEG\$
DECLARE v_c text; v_s text; v_hit text; v_caught boolean := false;
BEGIN
  BEGIN
    $attack
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME, v_s = RETURNED_SQLSTATE;
    v_caught := true;
  END;
  IF '$expect' LIKE 'SQLSTATE:%' THEN
    v_hit := CASE WHEN v_s = substring('$expect' from 10) THEN 'yes' ELSE 'no' END;
  ELSE
    v_hit := CASE WHEN v_c = '$expect' THEN 'yes' ELSE 'no' END;
  END IF;
  IF NOT v_caught THEN
    RAISE NOTICE 'NEG-OPEN % — 攻擊完全沒有被擋下', '$id';
  ELSIF v_hit = 'yes' THEN
    RAISE NOTICE 'NEG-PASS %', '$id';
  ELSE
    RAISE NOTICE 'NEG-OTHER % — 被擋下,但擋它的是 [%](SQLSTATE %),不是期望的 %', '$id', v_c, v_s, '$expect';
  END IF;
END \$NEG\$;
ROLLBACK;
SQL
}

INS_COLS="(id, order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor, request_id, kind, record_refunded_before"

# ── INSERT 類 ────────────────────────────────────────────────────────────────
# 🔴 這條**刻意不帶 tappay_refund_id**:帶了的話,突變掉本守門之後會被
#    a7c_insert_settlement_fields_must_be_empty 接住 ⇒ 本道被誤判成死規則(實測踩過)。
#    不帶時 confirmed_consistency 這條既有 CHECK 仍由 confirmed_at 滿足 ⇒ 突變後真的進得去,
#    而那正是本守門要擋的洞:憑空 INSERT 一列**已結案且沒有對帳碼**的退款
#    (a7c_confirm_requires_tappay_refund_id 只掛 BEFORE UPDATE,INSERT 繞得過它)。
emit_neg a7c_insert_status_must_be_processing a7c_insert_status_must_be_processing no \
"INSERT INTO order_refunds ${INS_COLS}, confirmed_at)
 VALUES ('a7c00000-0000-4000-8000-000000000101','${FIXTURE_ORDER}','BRID-N1','REC_A7C_FIXTURE', ${FX_TOTAL},
   'confirmed','負測','tester','req-n1','partial',0, now());"

# 🔴 期望的擋點是**白名單的 NULL 分支**,不是專屬守門。原本有一道 a7c_insert_order_not_found,
#    突變實測證明被本道嚴格蘊含(死規則)⇒ 已移除。本案例留著釘住「移除後仍進不來」。
emit_neg a7c_insert_order_missing a7c_insert_order_payment_not_captured no \
"INSERT INTO order_refunds ${INS_COLS})
 VALUES ('a7c00000-0000-4000-8000-000000000102','00000000-dead-4000-8000-000000000000','BRID-N2','REC_A7C_FIXTURE', ${FX_TOTAL},
   'processing','負測','tester','req-n2','partial',0);"

emit_neg a7c_insert_order_payment_not_captured a7c_insert_order_payment_not_captured no \
"UPDATE orders SET payment_status='unpaid' WHERE id='${FIXTURE_ORDER}';
   INSERT INTO order_refunds ${INS_COLS})
   VALUES ('a7c00000-0000-4000-8000-000000000103','${FIXTURE_ORDER}','BRID-N3','REC_A7C_FIXTURE', ${FX_TOTAL},
     'processing','負測','tester','req-n3','partial',0);"

emit_neg a7c_insert_order_has_no_rec_trade_id a7c_insert_order_has_no_rec_trade_id no \
"UPDATE orders SET tappay_rec_trade_id=NULL WHERE id='${FIXTURE_ORDER}';
   INSERT INTO order_refunds ${INS_COLS})
   VALUES ('a7c00000-0000-4000-8000-000000000104','${FIXTURE_ORDER}','BRID-N4','REC_A7C_FIXTURE', ${FX_TOTAL},
     'processing','負測','tester','req-n4','partial',0);"

emit_neg a7c_insert_rec_trade_id_mismatch a7c_insert_rec_trade_id_mismatch no \
"INSERT INTO order_refunds ${INS_COLS})
 VALUES ('a7c00000-0000-4000-8000-000000000105','${FIXTURE_ORDER}','BRID-N5','REC_SOMEONE_ELSE', ${FX_TOTAL},
   'processing','負測','tester','req-n5','partial',0);"

# 🔴 INSERT 時預塞假對帳碼 —— write-once 的繞道(實測過:結案時值沒變動 ⇒ 守門不觸發)
emit_neg a7c_insert_settlement_fields_must_be_empty a7c_insert_settlement_fields_must_be_empty no \
"INSERT INTO order_refunds ${INS_COLS}, tappay_refund_id)
 VALUES ('a7c00000-0000-4000-8000-000000000106','${FIXTURE_ORDER}','BRID-N6','REC_A7C_FIXTURE', ${FX_TOTAL},
   'processing','負測','tester','req-n6','partial',0,'DR-FAKE-INSERTED');"

# 🔴 NULL 不會被 trigger 的 `<>` 攔下(NULL <> 'x' 求值為 NULL)⇒ 由欄位 NOT NULL 接住
emit_neg a7c_rec_trade_id_not_null SQLSTATE:23502 no \
"INSERT INTO order_refunds ${INS_COLS})
 VALUES ('a7c00000-0000-4000-8000-000000000107','${FIXTURE_ORDER}','BRID-N7', NULL, ${FX_TOTAL},
   'processing','負測','tester','req-n7','partial',0);"

# ── UPDATE 類 ────────────────────────────────────────────────────────────────
emit_neg a7c_update_money_columns_immutable a7c_update_money_columns_immutable yes \
"UPDATE order_refunds SET refund_amount=100000 WHERE id='${RID}';"

emit_neg a7c_update_identity_columns_immutable a7c_update_identity_columns_immutable yes \
"UPDATE order_refunds SET bank_refund_id='BRID-HACKED' WHERE id='${RID}';"

emit_neg a7c_update_rec_trade_id_immutable a7c_update_identity_columns_immutable yes \
"UPDATE order_refunds SET rec_trade_id='REC_SWAPPED' WHERE id='${RID}';"

emit_neg a7c_update_created_at_immutable a7c_update_identity_columns_immutable yes \
"UPDATE order_refunds SET created_at=now() - interval '30 days' WHERE id='${RID}';"

# 🔴 稽核欄:「誰按的」不得事後改寫
emit_neg a7c_update_actor_immutable a7c_update_identity_columns_immutable yes \
"UPDATE order_refunds SET actor='someone-else' WHERE id='${RID}';"

emit_neg a7c_update_settlement_fields_write_once a7c_update_settlement_fields_write_once yes \
"UPDATE order_refunds SET status='confirmed', confirmed_at=now(), tappay_refund_id='DR-ORIGINAL'
     WHERE id='${RID}';
   UPDATE order_refunds SET tappay_refund_id='DR-TAMPERED' WHERE id='${RID}';"

# 🔴 前兩輪都在問「填了改不改得掉」,沒人問「能不能不填」
emit_neg a7c_confirm_requires_tappay_refund_id a7c_confirm_requires_tappay_refund_id yes \
"UPDATE order_refunds SET status='confirmed', confirmed_at=now() WHERE id='${RID}';"

emit_neg a7c_processing_must_not_have_tappay_refund_id a7c_processing_must_not_have_tappay_refund_id yes \
"UPDATE order_refunds SET tappay_refund_id='DR-PREFILLED' WHERE id='${RID}';"

# ── DELETE / 凍結 ────────────────────────────────────────────────────────────
emit_neg a7c_ledger_delete_forbidden a7c_ledger_delete_forbidden yes \
"DELETE FROM order_refunds WHERE id='${RID}';"

# 🔴 改形狀後 order_refund_items 無寫入端 ⇒ 凍結。這道守的是「不追品項」這個拍板本身。
emit_neg a7c_refund_items_frozen a7c_refund_items_frozen yes \
"INSERT INTO order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
 VALUES ('${RID}','${FIXTURE_ORDER}','${FIXTURE_ITEM}', 1, ${FX_UNIT}, ${FX_UNIT});"

# ── 🔴 R4 must-fix:共用函式掛在**多個**掛載點上,突變函式只證明「函式會擋」,
#    證明不了「每個掛載點都掛對了」。原本只測 header 的 DELETE 與 items 的 INSERT
#    ⇒「兩表全擋」這句話有兩個掛載點從來沒被走過。逐一補上。
# 🔴 這兩條要先「種一列明細」才有東西可刪/可改 —— 但 INSERT 已被凍結守門擋住,
#    而 **BEFORE ROW trigger 對 0 列不觸發** ⇒ 直接刪空表只會得到「沒被擋」的假失敗。
#    解法:在同一個交易內暫時停用凍結守門、種一列、再開回來,然後才發動攻擊。
#    整個交易最後 ROLLBACK ⇒ 零留痕,且被測的守門在攻擊當下是**啟用**的。
ITEMS_SEED="ALTER TABLE order_refund_items DISABLE TRIGGER order_refund_items_a7c_frozen_biu;
INSERT INTO order_refund_items (refund_id, order_id, order_item_id, quantity, unit_price, line_amount)
VALUES ('${RID}','${FIXTURE_ORDER}','${FIXTURE_ITEM}', 1, ${FX_UNIT}, ${FX_UNIT});
ALTER TABLE order_refund_items ENABLE TRIGGER order_refund_items_a7c_frozen_biu;"

emit_neg a7c_ledger_delete_forbidden_items a7c_ledger_delete_forbidden yes \
"DELETE FROM order_refund_items WHERE refund_id='${RID}';" "$ITEMS_SEED"

emit_neg a7c_refund_items_frozen_update a7c_refund_items_frozen yes \
"UPDATE order_refund_items SET quantity=2 WHERE refund_id='${RID}';" "$ITEMS_SEED"

# ── 🔴 R4 must-fix:改形狀砍掉了金額周圍所有等式 ⇒ 既有的 `refund_amount > 0`
#    現在是**唯一**擋 0 元與負數退款的東西,而負數會讓剩餘可退額**上升**。
#    原本 harness 全用正數 ⇒ 這條若漂移不見,38 項照樣全綠。
emit_neg order_refunds_refund_amount_check order_refunds_refund_amount_check no \
"INSERT INTO order_refunds ${INS_COLS})
 VALUES ('a7c00000-0000-4000-8000-000000000301','${FIXTURE_ORDER}','BRID-ZERO','REC_A7C_FIXTURE', 0,
   'processing','零元','tester','req-zero','partial',0);"

emit_neg order_refunds_refund_amount_negative order_refunds_refund_amount_check no \
"INSERT INTO order_refunds ${INS_COLS})
 VALUES ('a7c00000-0000-4000-8000-000000000302','${FIXTURE_ORDER}','BRID-NEG','REC_A7C_FIXTURE', -500,
   'processing','負數','tester','req-neg','partial',0);"

log "1/5 負測($(ls "$NEGDIR" | wc -l | tr -d ' ') 條)"
for f in "$NEGDIR"/neg-*.sql; do
  id="$(basename "$f" .sql)"; id="${id#neg-}"
  if out="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)"; then
    case "$out" in
      *NEG-PASS*)  ok  "負測 $id" ;;
      *NEG-OPEN*)  bad "負測 $id — 攻擊完全沒被擋下" ;;
      *NEG-OTHER*) bad "負測 $id — $(echo "$out" | grep 'NEG-OTHER' | head -1 | sed 's/^NOTICE:  //')" ;;
      *)           bad "負測 $id — 無法判讀:$(echo "$out" | head -3 | tr '\n' ' ')" ;;
    esac
  else
    bad "負測 $id — psql 失敗:$(echo "$out" | grep -E 'ERROR' | head -2 | tr '\n' ' ')"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# §C 正向鏈 + 改形狀的兩個結構性斷言
# ══════════════════════════════════════════════════════════════════════════════
log "2/5 正向鏈(邊界:退款 ${FX_TOTAL} = 訂單實收 ${FX_TOTAL})"
if out="$(psql "$URL" -v ON_ERROR_STOP=1 -q <<SQL 2>&1
BEGIN;
DO \$P\$
DECLARE v_before bigint;
BEGIN
  SELECT public.pcm_order_refundable_remaining('${FIXTURE_ORDER}') INTO v_before;
  IF v_before <> ${FX_TOTAL} THEN
    RAISE EXCEPTION 'POS-FAIL 退款前剩餘可退應為 %,實際 %(SUM 對零列回 NULL 沒 COALESCE?)', ${FX_TOTAL}, v_before;
  END IF;
END \$P\$;
$SEED_LEDGER
-- §6 三步流程第 ③ 步:回填 TapPay 給的 DR 識別碼結案
-- 🔴 刻意傳一個明顯錯的 confirmed_at(30 天前),用來證明 trigger 真的覆寫掉它
UPDATE order_refunds SET status='confirmed', confirmed_at=now() - interval '30 days',
       tappay_refund_id='DR20260801TEST'
 WHERE id='${RID}';
DO \$P\$
DECLARE v_after bigint; v_status text; v_conf timestamptz;
BEGIN
  SELECT public.pcm_order_refundable_remaining('${FIXTURE_ORDER}') INTO v_after;
  IF v_after <> 0 THEN RAISE EXCEPTION 'POS-FAIL 全額退款後剩餘應為 0,實際 %', v_after; END IF;
  SELECT status, confirmed_at INTO v_status, v_conf FROM order_refunds WHERE id='${RID}';
  IF v_status <> 'confirmed' THEN RAISE EXCEPTION 'POS-FAIL 結案失敗,status=%', v_status; END IF;
  IF v_conf < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'POS-FAIL confirmed_at 沒有被 DB 覆寫 —— 呼叫端傳的假時間活下來了';
  END IF;
  RAISE NOTICE 'POS-PASS 邊界正向鏈通過(剩餘 % -> 0、狀態 confirmed、confirmed_at 已被覆寫)', ${FX_TOTAL};
END \$P\$;
ROLLBACK;
SQL
)"; then
  echo "$out" | grep -q 'POS-PASS' && ok "正向鏈:登記 → 回填 DR 結案 → 剩餘可退歸零" || bad "正向鏈沒有 POS-PASS:$out"
else
  bad "正向鏈失敗:$(echo "$out" | grep -E 'ERROR|POS-FAIL' | head -2 | tr '\n' ' ')"
fi

# 🔴 部分退款的敏感度:改形狀後金額**可以自由填**(這正是 Q1=A 要的能力)。
#    用一個**不可能由品項湊出**的金額(300)證明它 —— 舊形狀下這筆寫不進去。
if out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
INSERT INTO order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before)
VALUES ('a7c00000-0000-4000-8000-000000000201','${FIXTURE_ORDER}','BRID-300','REC_A7C_FIXTURE', 300,
  'processing','自由金額','tester','req-300','partial',0);
SELECT public.pcm_order_refundable_remaining('${FIXTURE_ORDER}');
ROLLBACK;
SQL
)"; then
  got="$(echo "$out" | grep -E '^[0-9-]+$' | head -1)"
  [ "$got" = "$((FX_TOTAL-300))" ] \
    && ok "自由金額可**誠實**登記(退 300 → 剩餘 $got)—— 舊形狀下 300 只能靠虛構運費硬湊(items 2437 + 運費憑空漲 2137)才寫得進去,現在是直接記金額" \
    || bad "自由金額登記後剩餘算錯:期望 $((FX_TOTAL-300)),實際 [$got]"
else
  bad "🔴 自由金額 300 **寫不進去** —— Q1=A 的改形狀沒有生效:$(echo "$out" | grep ERROR | head -1)"
fi

# 🔴 折扣訂單:改形狀後帳本直接用 orders.total,**不再多算折扣額**。
#    舊形狀在這裡會算成 subtotal + shipping = 7448,比實收多 211。
if out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 -c \
  "SELECT public.pcm_order_refundable_remaining('${FIXTURE_ORDER}');" 2>&1)"; then
  got="$(echo "$out" | tr -d ' ')"
  if [ "$got" = "$FX_TOTAL" ]; then
    ok "折扣訂單零退款時剩餘 = 實收 ${FX_TOTAL}(舊形狀會是 $((FX_SUB+FX_SHIP))、多算折扣 ${FX_DISC})"
  else
    bad "折扣訂單剩餘算錯:期望 ${FX_TOTAL},實際 [$got]"
  fi
else
  bad "折扣訂單檢查失敗:$out"
fi

# 🔴 結構斷言:四個品項時代的欄位真的不在了(P3「虛構運費」那條路從此物理上不存在)
if out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_refunds'::regclass
     AND attnum>0 AND NOT attisdropped
     AND attname IN ('items_amount','shipping_fee_before','shipping_fee_after','shipping_delta');" 2>&1)"; then
  [ "$(echo "$out" | tr -d ' ')" = "0" ] \
    && ok "四個品項時代的金額欄已移除 ⇒「虛構 shipping_delta 寫任意金額」那條路物理上不再存在" \
    || bad "改形狀不完整:仍有 $out 個舊金額欄"
else
  bad "結構斷言失敗:$out"
fi

# ══════════════════════════════════════════════════════════════════════════════
# §D 突變證明 —— 逐道守門破壞一次,重跑它專屬的那條負測
# ══════════════════════════════════════════════════════════════════════════════
log "3/5 突變證明(每道守門一次)"

# 🔴 harness 自我防呆:同一個 constraint 名若出現兩次以上,突變只會替換第一個 RAISE,
#    第二個仍攔得住 ⇒ 該守門被誤判成死規則(實際發生過)。直接中止,不要產出不可歸因的結論。
DUP="$(grep -o "CONSTRAINT = '[a-z0-9_]*'" "$MIG" | sort | uniq -d || true)"
[ -z "$DUP" ] || die "突變前置失敗 — constraint 名重複,突變無法歸因:$(echo "$DUP" | tr '\n' ' ')"

mutation_repl() {
  case "$1" in
    a7c_ledger_delete_forbidden) echo "RETURN OLD;" ;;
    a7c_refund_items_frozen)     echo "RETURN NEW;" ;;
    *)                           echo "NULL;" ;;
  esac
}
is_ddl_guard() {
  case "$1" in
    a7c_rec_trade_id_not_null|order_refunds_refund_amount_check) return 0 ;;
    *) return 1 ;;
  esac
}

mutate_sql() { # <constraint_id> <replacement>
  python3 - "$MIG" "$1" "$2" <<'PY'
import re, sys
mig, cid, repl = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(mig, encoding='utf-8').read()
blocks = [(m.start(), m.end(), m.group(0)) for m in
          re.finditer(r"CREATE OR REPLACE FUNCTION public\.[\s\S]*?\n\$\$;", src)]
target = None
for s, e, b in blocks:
    if ("CONSTRAINT = '%s'" % cid) in b:
        target = (s, e, b); break
if not target:
    sys.stderr.write("找不到含 %s 的函式區塊\n" % cid); sys.exit(3)
s, e, body = target
key = "CONSTRAINT = '%s';" % cid
k = body.find(key)
rs = body.rfind("RAISE EXCEPTION", 0, k)
if k < 0 or rs < 0:
    sys.stderr.write("定位 %s 的 RAISE 失敗\n" % cid); sys.exit(3)
mutated = body[:rs] + repl + body[k + len(key):]
if mutated == body:
    sys.stderr.write("突變沒有改到任何字元\n"); sys.exit(3)
print(mutated)
PY
}
fingerprint() { psql "$URL" -qtA -c "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$1';"; }
funcname_of() {
  python3 - "$MIG" "$1" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\n\$\$;", src):
    if ("CONSTRAINT = '%s'" % sys.argv[2]) in m.group(0):
        print(m.group(1)); sys.exit(0)
sys.exit(3)
PY
}
cid_of() {
  case "$1" in
    a7c_insert_order_missing)          echo a7c_insert_order_payment_not_captured ;;
    a7c_update_rec_trade_id_immutable) echo a7c_update_identity_columns_immutable ;;
    a7c_update_created_at_immutable)   echo a7c_update_identity_columns_immutable ;;
    a7c_update_actor_immutable)        echo a7c_update_identity_columns_immutable ;;
    a7c_ledger_delete_forbidden_items) echo a7c_ledger_delete_forbidden ;;
    a7c_refund_items_frozen_update)    echo a7c_refund_items_frozen ;;
    order_refunds_refund_amount_negative) echo order_refunds_refund_amount_check ;;
    *)                                 echo "$1" ;;
  esac
}

MUT_LOAD=0; MUT_DEAD=0; MUT_IMPLIED=0; MUT_NOTE=""
# 🔴 每道守門要用**針對它自身語意**的那條負測去突變。實測踩過:payment 守門若用
#    「訂單不存在」那條去突變,會因為不存在的訂單必然沒有 rec_trade_id 而被下一道接住
#    ⇒ 被誤判成死規則。⇒ 優先用 neg-<cid>.sql,沒有才退而用第一條別名負測。
CIDS=""
for f in "$NEGDIR"/neg-*.sql; do
  id="$(basename "$f" .sql)"; id="${id#neg-}"; c="$(cid_of "$id")"
  case " $CIDS " in *" $c "*) ;; *) CIDS="$CIDS $c" ;; esac
done
for cid in $CIDS; do
  if [ -f "$NEGDIR/neg-$cid.sql" ]; then
    f="$NEGDIR/neg-$cid.sql"
  else
    f=""
    for cand in "$NEGDIR"/neg-*.sql; do
      cid2="$(basename "$cand" .sql)"; cid2="${cid2#neg-}"
      if [ "$(cid_of "$cid2")" = "$cid" ]; then f="$cand"; break; fi
    done
    [ -n "$f" ] || { bad "突變 $cid:找不到對應負測"; continue; }
    MUT_NOTE="${MUT_NOTE}
     · $cid 用別名負測 $(basename "$f" .sql | sed 's/^neg-//') 突變(無同名負測)"
  fi

  if [ "$cid" = "order_refunds_refund_amount_check" ]; then
    mut="ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_refund_amount_check;
DO \$FP\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_refunds'::regclass
              AND conname='order_refunds_refund_amount_check') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的 DROP CONSTRAINT 沒有生效';
  END IF;
END \$FP\$;"
  elif is_ddl_guard "$cid"; then
    mut="ALTER TABLE public.order_refunds ALTER COLUMN rec_trade_id DROP NOT NULL;
DO \$FP\$
BEGIN
  IF (SELECT attnotnull FROM pg_attribute
       WHERE attrelid='public.order_refunds'::regclass AND attname='rec_trade_id') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的 DROP NOT NULL 沒有生效';
  END IF;
END \$FP\$;"
  else
    fn="$(funcname_of "$cid")" || { bad "突變 $cid:抽不出所屬函式"; continue; }
    mutbody="$(mutate_sql "$cid" "$(mutation_repl "$cid")")" || { bad "突變 $cid:產生突變 SQL 失敗"; continue; }
    before="$(fingerprint "$fn")"
    mut="$mutbody
DO \$FP\$
DECLARE v text;
BEGIN
  SELECT md5(prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='$fn';
  IF v = '$before' THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的突變沒有改到函式本體(指紋未變)';
  END IF;
END \$FP\$;"
  fi

  out="$(psql "$URL" -q <<SQL 2>&1
BEGIN;
$mut
$(sed -e '1{/^BEGIN;$/d;}' -e '${/^ROLLBACK;$/d;}' "$f")
ROLLBACK;
SQL
)"
  # 🔴 判準三態:NEG-OPEN(攻擊真的進得來)才算承重;
  #    NEG-OTHER(被別道接住)= 被嚴格蘊含 = 死規則,不能算承重。
  if echo "$out" | grep -q 'MUTATION-NOOP'; then
    bad "突變 $cid — **突變沒套上**(自檢未過),這格結論不可信"
  elif echo "$out" | grep -q 'NEG-OPEN'; then
    ok "突變 $cid — 破壞後攻擊真的進得來 ⇒ 承重"; MUT_LOAD=$((MUT_LOAD+1))
  elif echo "$out" | grep -q 'NEG-OTHER'; then
    bad "突變 $cid — 破壞後仍被別道守門擋下 ⇒ 本道被嚴格蘊含 = 死規則"; MUT_IMPLIED=$((MUT_IMPLIED+1))
  elif echo "$out" | grep -q 'NEG-PASS'; then
    bad "突變 $cid — 破壞後負測仍完全通過 ⇒ **死規則**"; MUT_DEAD=$((MUT_DEAD+1))
  else
    bad "突變 $cid — 無法判讀:$(echo "$out" | grep -E 'ERROR|NOTICE' | head -2 | tr '\n' ' ')"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# §E 重複套用 —— 必須乾淨停住、零殘留
# ══════════════════════════════════════════════════════════════════════════════
log "4/5 重複套用 A7c"
before_snap="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
if psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then
  bad "重複套用**成功了** —— 本檔宣稱不冪等,實際卻可重放,兩者必須一致"
else
  after_snap="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
  [ "$before_snap" = "$after_snap" ] \
    && ok "重複套用被擋下且零殘留(trigger 數 $before_snap 不變)" \
    || bad "重複套用被擋下但**有殘留**(trigger 數 $before_snap → $after_snap)"
fi

# ══════════════════════════════════════════════════════════════════════════════
log "5/5 覆蓋數釘死"
# 🔴 若有人刪掉某道守門的全部負測,CIDS 會一起變短,舊版結尾仍會印「全綠」
#    —— 靜默的覆蓋流失看起來與通過一模一樣。
EXPECT_NEG=21      # §B 負測檔數
EXPECT_MUT=14      # 具名守門數(12 道 trigger RAISE + NOT NULL + 既有 refund_amount > 0)
ACTUAL_NEG=$(ls "$NEGDIR"/neg-*.sql 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_MUT=$((MUT_LOAD + MUT_IMPLIED + MUT_DEAD))
[ "$ACTUAL_NEG" = "$EXPECT_NEG" ] && ok "負測數 $ACTUAL_NEG 符合預期" \
  || bad "覆蓋流失 — 負測應有 $EXPECT_NEG 條,實際 $ACTUAL_NEG(改了就同步改 EXPECT_NEG)"
[ "$ACTUAL_MUT" = "$EXPECT_MUT" ] && ok "突變守門數 $ACTUAL_MUT 符合預期" \
  || bad "覆蓋流失 — 應突變 $EXPECT_MUT 道,實際 $ACTUAL_MUT 道"

echo
echo "════════ A7c 驗收總結 ════════"
echo "  通過 $PASS / 失敗 $FAIL"
echo "  突變:承重 $MUT_LOAD 道 / 被蘊含 $MUT_IMPLIED 道 / 死規則 $MUT_DEAD 道"
[ -n "$MUT_NOTE" ] && echo "  ℹ️ 突變取樣說明:$MUT_NOTE"
[ "$FAIL" -eq 0 ] && [ "$MUT_DEAD" -eq 0 ] && [ "$MUT_IMPLIED" -eq 0 ] || exit 1
echo "  🎉 全綠"
