#!/usr/bin/env bash
#
# B2 S1a-2 驗收:`public.shipments` 的 BEFORE UPDATE 守門族(X8 / A2 / touch / X2)。
# 片級 plan = docs/specs/2026-08-05-e10-b2-shipments-db-plan.md(v5.4)§4 項 10-18。
#
# 用法:scripts/b2s1a2-verify.sh <db-url>(備庫見 b2s1a1-verify.sh 檔頭)
#
# 🔴 本支的核心紀律(plan §4 項 16b):**凡是「應成功」的格子,不只驗「沒噴錯」,
#    一律回查該欄新值真的落庫**。理由 = BEFORE 守門 `RETURN NULL` 會讓 UPDATE 變成
#    `UPDATE 0`、零錯誤、值沒變(本機 PG17.10 實測)⇒ 只看錯誤的正測會假綠。
#    §F 的突變靶⑤ 就是把某支守門改成 RETURN NULL,證明本支抓得到。
#
# 🔴 誠實邊界(codex K2-R3 nit):`SET CONSTRAINTS ALL IMMEDIATE` 會**當場跑掉延遲檢查**,
#    但它**不等於真 COMMIT** —— 真 COMMIT 還包含寫入可見性、其他交易的併發效應等。
#    本支證明的是「這個終態通得過所有延遲約束」,不是「它在正式站 commit 一定沒事」。
set -euo pipefail
# 🔴 在 cd 之前捕捉本檔絕對路徑:gate_wiring_check 要對原始碼做存在性斷言。
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="${1:-${D1_DB_URL:-}}"
[ -n "$URL" ] || { echo "🔴 用法:scripts/b2s1a2-verify.sh <db-url>"; exit 2; }
export LC_ALL=C

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $*"; }
log() { echo; echo "== $* =="; }
q()  { psql "$URL" -v ON_ERROR_STOP=0 -qtA -c "$1" 2>&1 || true; }
qs() { psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1"; }

# ── 🔴🔴 拋棄庫身分閘(v5.4;codex K2-R3 BLOCKER / K2-R4 / Fable F1)──────────────
# 🔴 本支的破壞面(v5.4-c F2 更正:先前這段是從 b2s1b 複製貼上、字面不對):
#    本支**全程 BEGIN/ROLLBACK、零 COMMIT** —— 但它仍會在交易內 `CREATE OR REPLACE`
#    守門函式、`DROP TRIGGER`(突變矩陣靶③⑤⑬⑭⑯)。接錯庫雖然不留痕,
#    那些 DDL 仍會**在該庫上真的跑一遍** ⇒ 照樣擋。**真正會 COMMIT 的是 `b2s1b`。**
#
# 三重、fail-closed(照 scripts/a6-verify.sh:45-52 的既有形狀改寫成吃 URL 的版本):
#   ①位址必須是 127.0.0.1、埠必須落在 543xx ②database 名必須是 postgres
#   ③`dirname(data_directory)` 底下必須有 `.d1t2-harness` ownership marker
#     —— 正式站的 data_directory 在本機根本不存在 ⇒ 檢查必失敗、拒跑。
#
# 🔴 v5.4-b(codex K2-R4):第一版用 `case "$URL" in *127.0.0.1:543xx/*)` = **子字串**比對,
#    `postgresql://u:p@prod.example.com/db?x=127.0.0.1:54342/y` 照樣命中 ⇒ 改成問伺服器本人。
#
# 🔴🔴 v5.4-c(Fable 確認輪 F1,**must-fix**)—— 判準必須抽成**不連線的純函式**:
#    前一版的 `gate_selftest` 是拿假 URL 去跑整個 `gate_throwaway_db`,只斷言「rc≠0」。
#    但假 URL 的非零**來自連線失敗**,不是身分判準 ⇒ **把閘退回子字串比對,selftest 照樣綠**
#    (正是 K2-R4 那個 bug 的形狀)。「日後有人把閘寫鬆會轉紅」那句話當時 ≠ 事實。
#    ⇒ 判準抽成 `gate_decide addr port`(零連線、零副作用),selftest **兩向直測**:
#      壞位址必須被拒、好位址必須被放 —— 兩向都要,只驗單向會被「一律拒絕」的壞實作騙過。

# 純判準:只看 addr/port,不連線、不讀檔、無副作用。回 0=放行 / 非 0=拒絕。
gate_decide() {
  case "$1:$2" in
    127.0.0.1:543[0-9][0-9]) return 0 ;;
    *) return 1 ;;
  esac
}

gate_throwaway_db() {
  local datadir workdir addr port
  addr="$(qs "SELECT COALESCE(host(inet_server_addr()),'<unix-socket>')")"
  port="$(qs "SELECT inet_server_port()")"
  gate_decide "$addr" "$port" \
    || { echo "🔴 身分閘:連到的伺服器是 $addr:$port,不是 127.0.0.1 的 543xx 拋棄庫;拒跑"; exit 1; }
  [ "$(qs "SELECT current_database()")" = "postgres" ] || { echo "🔴 身分閘:database 名不是 postgres;拒跑"; exit 1; }
  datadir="$(qs "SHOW data_directory")"
  workdir="$(dirname "$datadir")"
  [ -f "$workdir/.d1t2-harness" ] || {
    echo "🔴 身分閘:$workdir 沒有 .d1t2-harness ownership marker ⇒ 這不是 d1t2 provision 出來的拋棄庫;拒跑"
    exit 1; }
}
gate_throwaway_db

# 🔴 兩向直測純判準(零連線 ⇒ 判定的理由只可能來自判準本身)。
#    回 0 = 自檢通過;1 = 壞位址竟被放行;2 = 好位址竟被拒。
gate_selftest() {
  if gate_decide 10.0.0.1 5432;     then return 1; fi
  if ! gate_decide 127.0.0.1 54342; then return 2; fi
  return 0
}

# 🔴 接線存在性(F1 附帶):`gate_decide`/`gate_throwaway_db` 連同呼叫點**整組被刪掉**時,
#    subshell 會以 127「command not found」收場 —— 那也是非零,看起來同樣像「被拒」。
#    ⇒ 直接對**本檔原始碼**斷言:兩個函式都在、閘真的被呼叫、閘真的用了純判準。
gate_wiring_check() {
  declare -F gate_decide >/dev/null 2>&1        || return 1
  declare -F gate_throwaway_db >/dev/null 2>&1  || return 2
  grep -qE '^gate_throwaway_db$' "$SELF_PATH"   || return 3
  # 🔴 必須錨定行首縮排的**呼叫**形狀:不加錨點的話,這行 grep 自己的 pattern 字串
  #    就會被自己比對到 ⇒ 呼叫點被換掉了它照樣綠(本輪消融實測抓到,已修)。
  grep -qE '^[[:space:]]+gate_decide "\$addr" "\$port"' "$SELF_PATH" || return 4
  return 0
}

# 🔴 v5.4(codex K2 #16):改從 orders 取客人 —— 已出貨的 fixture 必須能加**該客人自己的**品項
#    (A7 只認同客人),從 customers 隨便取一位可能一張訂單都沒有,那些格會紅在 A7 而非待測的守門。
CUST="$(qs "SELECT customer_user_id FROM public.orders GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;")"
[ -n "$CUST" ] || { echo "🔴 備庫裡沒有 orders 列,無法造合法 fixture"; exit 1; }
ITEM="$(qs "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.customer_user_id='$CUST' ORDER BY oi.id LIMIT 1;")"
[ -n "$ITEM" ] || { echo "🔴 該客人沒有 order_items,無法造合法的已出貨 fixture"; exit 1; }
# A2 的 customer_user_id 欄格要換成**另一位真實存在**的客人(FK 擋掉隨機 uuid ⇒ 會紅在 23503、量錯東西)
CUST2="$(qs "SELECT customer_user_id FROM public.orders WHERE customer_user_id <> '$CUST' LIMIT 1;")"
# 🔴 B2-S2b-F:fixture 補到貨需要一個供應商(見下方 STOCK)。
SUP="$(qs "SELECT id FROM public.suppliers ORDER BY id LIMIT 1;")"
[ -n "$SUP" ] || { echo "🔴 備庫裡沒有 suppliers 列,無法造合法的到貨 fixture(C9 需要 instock >= shipped)"; exit 1; }
[ -n "$CUST2" ] || { echo "🔴 需要第二位客人才能測 A2 的 customer_user_id 欄"; exit 1; }
SNAP="'{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb"
SNAP2="'{\"name\":\"李小華\",\"phone\":\"0911111111\",\"line\":\"other\"}'::jsonb"

# 造一張包裹並回傳 id 的 SQL 片段(在同一個 DO 內用)。
mk() {  # $1 = 額外欄位, $2 = 額外值
  echo "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code${1}) VALUES ('BCDFGH','$CUST',$SNAP,'hct'${2}) RETURNING id INTO v_id;"
}

# 期望 SQL 紅在指定 SQLSTATE(全程 BEGIN/ROLLBACK,零留痕、可重跑)
expect_sqlstate() {
  local want="$1" setup="$2" act="$3" label="$4" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; BEGIN $setup $act;
             RAISE EXCEPTION 'NO_ERROR_RAISED' USING ERRCODE='XX999';
             EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then ok "$label(${want})"
  elif [ -z "$got" ]; then bad "$label — 🔴 測試自身異常(沒拿到 SQLSTATE)"
  else bad "$label — 期望 $want,實得 $got"; fi
}

# 期望成功 **且** 指定欄位真的變成期望值(項 16b 的 oracle 紀律)
# 🔴 v5.4(codex K2 #16):`SET CONSTRAINTS ALL IMMEDIATE` 是本函式的第二根支柱 ——
#    fixture 合法化只保證「這列在真 COMMIT 下站得住」,而**強制跑掉延遲檢查**才讓 X1 真的發火。
#    兩者缺一,「已出貨零品項」這種在真世界必紅的列仍會假綠通過。
expect_landed() {
  local setup="$1" act="$2" col="$3" want="$4" label="$5" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; v_got text; BEGIN $setup $act;
             SET CONSTRAINTS ALL IMMEDIATE;
             SELECT ${col}::text INTO v_got FROM public.shipments WHERE id = v_id;
             RAISE NOTICE 'GOT:%', COALESCE(v_got,'<NULL>');
             EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:ERR:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then ok "$label(${col}=${want};延遲約束已強制落地)"
  else bad "$label — 期望 ${col}=${want},實得 ${got:-<無>}"; fi
}

# 🔴🔴 v5.4(codex K2 #16)**fixture 全面合法化**:舊版三張 fixture 都是「一筆 INSERT 直接帶
#    shipped_at / deleted_at、**零品項**」。那種列在三片齊全的世界 **commit 不了** —— X1
#    (DEFERRED constraint trigger)會擋;它們看似通過只因每格以 ROLLBACK 收尾、**X1 從頭到尾沒發火**。
#    ⇒ 全部改成合法順序:**草稿 → 加品項 → 才進入已出貨 / 已送單 / 已作廢**。
#    🔴 只改 fixture 不夠,`expect_landed` 同時補了 `SET CONSTRAINTS ALL IMMEDIATE`(見該函式),
#    否則 X1 依然不會發火、fixture 合不合法根本觀察不到。
# 🔴🔴 **2026-08-07 B2-S2b-F:fixture 對齊 C9**(主視窗 `B-162-A` 裁 Q1=A)。
#    大線 B2-S2b 把 `shipped_quantity` 接上四軸重算之後,C9(`shipped <= instock`)才真的會發火 ——
#    而本支的 fixture 是「加品項 + 設 shipped_at」但**完全沒有到貨**(receipts)⇒ instock = 0
#    ⇒ 重算算出 shipped 1 > instock 0,**25 條斷言全部紅在 `23514 / oiqs_shipped_le_instock`**。
#    🔴 那不是大線的 bug —— 是本支的 fixture **早於 C9 這條規則**(Sean Q1=A 拍的強制點:沒到貨就不可能出貨)。
#    ⇒ 修法 = 讓 fixture 成為**合法世界裡的一列**:出貨之前先有採購與到貨。
#    這與 v5.4「fixture 全面合法化」是同一條路 —— 那次補的是 X1(零品項),這次補的是 C9(零到貨)。
# 🔴 `ADDITEM` 是**唯一咽喉**:所有 fixture(DRAFT / SHIPPED / VOIDED / SUBMITTED / OTHER_* / F9SHIPPED)
#    都經過它 ⇒ 補在這裡一處,25 條全部歸位,**不動任何一條斷言、不動任何期望值**。
# 🔴 值:採購 1 + 到貨 1 ⇒ instock = 1,而出貨量也是 1 —— **刻意停在 C9 的邊界**(shipped = instock)。
#    這是本 fixture 能取到的最強值:該品項 `quantity = 1`(實查),C7(`instock + cancelled <= quantity`)
#    讓 instock 不可能超過 1 ⇒ 等號是資料逼出來的,不是我隨手選的;而且邊界值讓任何 off-by-one 當場紅。
# 🔴 R2 F4:到貨用 **CTE `RETURNING`** 鎖定剛插入的那一列 —— 用 `(order_item_id, supplier_id)` 撈時,
#    該鍵若已有第二列 procurement 會各插一筆到貨、instock 變倍數而撞 C7,且**歸因錯人**。
STOCK="WITH p AS (
    INSERT INTO public.order_item_procurement (order_item_id,supplier_id,allocated_quantity)
    VALUES ('$ITEM','$SUP',1) RETURNING id
  )
  INSERT INTO public.order_item_procurement_receipts (procurement_id,quantity,received_at,received_by)
  SELECT p.id,1,now(),'b2s1a2_verify' FROM p;"
ADDITEM="$STOCK INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM',1);"
DRAFT="$(mk "" "") $ADDITEM"
SHIPPED="$DRAFT UPDATE public.shipments SET tracking_number='T111',shipped_at=now() WHERE id=v_id;"
VOIDED="$DRAFT UPDATE public.shipments SET deleted_at=now(),void_reason='打錯了' WHERE id=v_id;"
SUBMITTED="$DRAFT UPDATE public.shipments SET hct_status='submitted',hct_request_id='R-SUB' WHERE id=v_id;"
# 🔴 carrier_note 的獨立格只能在 **other** 列上做:A3 要求 `(carrier='other') = (note 非空白)`,
#    在 hct 列上單獨改 note 會紅在 A3 的 23514 ⇒ 量到的是 A3、不是 X8(「負測量錯東西」的同型)。
MKOTHER="INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGJ','$CUST',$SNAP,'other','客人自取') RETURNING id INTO v_id; $ADDITEM"
OTHER_SHIPPED="$MKOTHER UPDATE public.shipments SET shipped_at=now() WHERE id=v_id;"
OTHER_VOIDED="$MKOTHER UPDATE public.shipments SET deleted_at=now(),void_reason='打錯了' WHERE id=v_id;"
# F9(已出貨 + 送單失敗)同樣要合法化:hct 出貨需單號(A8),failed 不需 request_id(X4 只管 submitted)。
F9SHIPPED="$DRAFT UPDATE public.shipments SET tracking_number='T333',shipped_at=now(),hct_status='failed' WHERE id=v_id;"

log "1/6 X2 write-once(§4 項 10)"
# 🔴 F3(隨 F1 修法一起改):舊標籤宣稱「閘問的是伺服器本人」,但那格其實只證明了
#    「假 URL 會讓整支非零」——非零來自連不上,不是身分判準。新標籤只講本格真的證明的事。
GATE_RC=0; gate_selftest || GATE_RC=$?
case "$GATE_RC" in
  0) ok "🔴 身分閘判準**兩向直測**(零連線):壞位址 10.0.0.1:5432 被拒 **且** 好位址 127.0.0.1:54342 被放 ⇒ 判準本身有判別力(把閘改成恆拒或恆放,本格都會紅)" ;;
  1) bad "🔴🔴 身分閘自檢失敗:壞位址 10.0.0.1:5432 竟被**放行** —— 閘等於不存在" ;;
  2) bad "🔴🔴 身分閘自檢失敗:好位址 127.0.0.1:54342 竟被**拒絕** —— 閘恆拒,那種實作單向測試看不出來" ;;
  *) bad "🔴🔴 身分閘自檢異常(rc=$GATE_RC)" ;;
esac
WIRE_RC=0; gate_wiring_check || WIRE_RC=$?
case "$WIRE_RC" in
  0) ok "🔴 身分閘**接線存在性**:兩支函式都在、閘真的被呼叫、閘真的用了純判準 ⇒ 「整組被刪掉」不會偽裝成「自檢通過」" ;;
  1) bad "🔴🔴 接線斷了:gate_decide 不存在" ;;
  2) bad "🔴🔴 接線斷了:gate_throwaway_db 不存在" ;;
  3) bad "🔴🔴 接線斷了:本檔找不到頂層的 gate_throwaway_db 呼叫 ⇒ 閘定義了但沒被叫" ;;
  4) bad "🔴🔴 接線斷了:gate_throwaway_db 沒有用 gate_decide ⇒ 判準被繞過,自檢驗的不是實際用的那條路" ;;
  *) bad "🔴🔴 接線檢查異常(rc=$WIRE_RC)" ;;
esac
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET shipped_at=NULL WHERE id=v_id" "X2 清空 shipped_at 被擋"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET shipped_at=now()+interval '1 day' WHERE id=v_id" "X2 改成別的時間 被擋"

log "2/6 X8 已出貨面 · 逐欄矩陣(§4 項 11;15 欄不得少列)"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET recipient_snapshot=$SNAP2 WHERE id=v_id" "X8 改收件快照 被擋"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET carrier_code='sf' WHERE id=v_id" "X8 改快遞商 被擋"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET carrier_code='other',carrier_note='自送' WHERE id=v_id" "X8 改成 other+說明 被擋"
# 🔴 v5.4(codex K2 #19):上一格**同時**改了 carrier_code 與 carrier_note ⇒ 把 carrier_note
#    從 X8 的凍結集拿掉,該格仍會紅在 carrier_code ⇒ 對 carrier_note 這一欄零判別力。
#    本格是 carrier_note 的**獨立**格(突變靶⑬ 證明它抓得到)。
expect_sqlstate P0001 "$OTHER_SHIPPED" "UPDATE public.shipments SET carrier_note='改成別的說明' WHERE id=v_id" \
  "🔴 X8 改 carrier_note **單獨格**(other 列 ⇒ A3 仍成立、唯一被違反的是 X8)"
expect_landed "$SHIPPED" "UPDATE public.shipments SET tracking_number='T-NEW' WHERE id=v_id" "tracking_number" "T-NEW" "X8 正測:單號可改(Q2=A)"
expect_landed "$SHIPPED" "UPDATE public.shipments SET hct_status='failed' WHERE id=v_id" "hct_status" "failed" "X8 正測:hct_status 可寫"
expect_landed "$SHIPPED" "UPDATE public.shipments SET hct_request_id='R9' WHERE id=v_id" "hct_request_id" "R9" "X8 正測:hct_request_id 可寫"
expect_landed "$SHIPPED" "UPDATE public.shipments SET hct_raw_response='{\"a\":1}'::jsonb WHERE id=v_id" "hct_raw_response" '{"a": 1}' "X8 正測:hct_raw_response 可寫"
expect_landed "$SHIPPED" "UPDATE public.shipments SET deleted_at=now(),void_reason='作廢' WHERE id=v_id" "void_reason" "作廢" "X8 正測:可作廢(deleted_at 需與 void_reason 成對,否則會紅在 X7)"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET id=gen_random_uuid() WHERE id=v_id" "A2 改 id 被擋"
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET shipment_reference='ZZZZZZ' WHERE id=v_id" "A2 改編號 被擋"
# 🔴 **不可以用 `now()` 當新值**:now() 在同一交易內是**固定的交易開始時間**,而該列的
#    created_at DEFAULT 也是同一個 now() ⇒ `NEW.created_at IS DISTINCT FROM OLD.created_at`
#    為 false、守門正確地不發火,測試卻會誤判成「守門失效」(本支實際踩過)。
#    這是「fixture 裡碰巧的值讓守門變恆真」的同型坑 ⇒ 用一個**保證不同**的時間。
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET created_at='2020-01-01T00:00:00Z'::timestamptz WHERE id=v_id" "A2 改建立時間 被擋"
# 🔴 v5.4(codex K2 #19):15 欄矩陣原本缺 customer_user_id 與 updated_at 兩欄的獨立格。
#    customer_user_id 用**另一位真實客人**(隨機 uuid 會紅在 FK 的 23503,量到的是 FK 不是 A2)。
expect_sqlstate P0001 "$SHIPPED" "UPDATE public.shipments SET customer_user_id='$CUST2' WHERE id=v_id" \
  "🔴 A2 改 customer_user_id **單獨格**(改客人會讓已裝箱品項跨客人,而 A7 只在 INSERT 面驗)"
# updated_at:規格是「由 touch 自動改、不由外部指定」⇒ 外部指定的值**不得**落庫(突變靶⑭ 證明它抓得到)。
# 🔴🔴 oracle 必須**同時**驗一個同句更新的伴隨欄(tracking_number)真的落庫 —— 否則這格是假綠:
#    任一 BEFORE 守門 `RETURN NULL` 吞掉整句 UPDATE 時,updated_at 保持原值(本來就 <> 2020)
#    ⇒ 單看 `updated_at <> 2020` 仍回 true,違反 plan 項 16b「任一 RETURN NULL → 對應正測必紅」。
#    (codex K2-R2 must-fix 6;「斷言量錯東西」的同型 —— 條件被別的原因滿足。)
expect_landed "$SHIPPED" "UPDATE public.shipments SET updated_at='2020-01-01T00:00:00Z'::timestamptz,tracking_number='T-UPD' WHERE id=v_id" \
  "(updated_at <> '2020-01-01T00:00:00Z'::timestamptz AND tracking_number = 'T-UPD')" "true" \
  "🔴 updated_at **單獨格**:外部指定的值被 touch 覆寫、不落庫(且同句的伴隨欄確實落庫 ⇒ RETURN NULL 吞掉整句時本格必紅)"

log "3/6 🔴 X8 已作廢面(§4 項 11b;v5.1 補的那半條件)"
expect_sqlstate P0001 "$VOIDED" "UPDATE public.shipments SET carrier_code='sf' WHERE id=v_id" "X8 作廢後改快遞商 被擋"
expect_sqlstate P0001 "$VOIDED" "UPDATE public.shipments SET recipient_snapshot=$SNAP2 WHERE id=v_id" "X8 作廢後改收件快照 被擋"
expect_sqlstate P0001 "$OTHER_VOIDED" "UPDATE public.shipments SET carrier_note='改成別的說明' WHERE id=v_id" \
  "🔴 X8 作廢後改 carrier_note **單獨格**(項 11b 的凍結 3 欄補齊第 3 欄)"
expect_landed "$VOIDED" "UPDATE public.shipments SET deleted_at=NULL,void_reason=NULL WHERE id=v_id" "deleted_at" "<NULL>" "Q3=A 正測:unvoid 可回復"

log "3b/6 🔴 Q3=A 三態作廢 + 由已出貨作廢態 unvoid(§4 項 17;codex K2 #26)"
# 🔴 舊版只有兩格:「已出貨作廢」與「由 **draft 作廢**態 unvoid」。
#    §4 項 17 要求的是 **draft / submitted / 已出貨 三種狀態各自作廢**,submitted 那態完全沒被測;
#    unvoid 也只從最寬鬆的那態試過 —— 由**已出貨作廢**態回復才是會踩到 X8/X2 的那條路徑。
expect_landed "$DRAFT" "UPDATE public.shipments SET deleted_at=now(),void_reason='草稿作廢' WHERE id=v_id" \
  "(deleted_at IS NOT NULL)" "true" "Q3=A:draft 態可作廢"
# 🔴🔴 v5.4(codex K2-R3 must-fix):#16 的 fixture 全面合法化**弄丟了一條原本走得到的路徑** ——
#    所有 fixture 現在都先加品項,於是「**零品項**的空草稿能不能作廢/回復」再也沒有被測到。
#    那條路徑是真實的(建了包裹還沒裝箱就想取消),而且它是 X1 條件的判別點:
#    X1 若誤把 `deleted_at IS NOT NULL` 也納入 presence 條件,只有本格會紅、其他格全都不會。
#    ⇒ 教訓:修 finding 造成的**覆蓋面流失**是靜默的,不會有任何一條斷言轉紅來提醒你。
EMPTY_DRAFT="$(mk "" "")"
expect_landed "$EMPTY_DRAFT" "UPDATE public.shipments SET deleted_at=now(),void_reason='空草稿作廢' WHERE id=v_id" \
  "(deleted_at IS NOT NULL)" "true" "🔴 Q3=A:**零品項空草稿**可作廢(fixture 合法化後唯一還走這條路徑的格)"
expect_landed "$EMPTY_DRAFT UPDATE public.shipments SET deleted_at=now(),void_reason='空草稿作廢' WHERE id=v_id;" \
  "UPDATE public.shipments SET deleted_at=NULL,void_reason=NULL WHERE id=v_id" \
  "deleted_at" "<NULL>" "🔴 Q3=A:**零品項空草稿**作廢後可 unvoid(終態仍是零品項草稿 = L1 合法)"
expect_landed "$SUBMITTED" "UPDATE public.shipments SET deleted_at=now(),void_reason='送單後作廢' WHERE id=v_id" \
  "(deleted_at IS NOT NULL)" "true" "🔴 Q3=A:**submitted 態**可作廢(舊版缺這格)"
expect_landed "$SHIPPED" "UPDATE public.shipments SET deleted_at=now(),void_reason='已出貨作廢' WHERE id=v_id" \
  "(deleted_at IS NOT NULL)" "true" "Q3=A:已出貨態可作廢"
expect_landed "$SHIPPED UPDATE public.shipments SET deleted_at=now(),void_reason='已出貨作廢' WHERE id=v_id;" \
  "UPDATE public.shipments SET deleted_at=NULL,void_reason=NULL WHERE id=v_id" \
  "deleted_at" "<NULL>" "🔴 Q3=A:由**已出貨作廢**態 unvoid(舊版只從 draft 作廢態試過)"

log "4/6 X8 階段判定 + F9 逃逸路徑(§4 項 12/13)"
expect_landed "$DRAFT" "UPDATE public.shipments SET shipped_at=now(),tracking_number='T222',carrier_code='sf' WHERE id=v_id" "carrier_code" "sf" \
  "X8 階段正測:同句設 shipped_at 並改 carrier(證明用 OLD 判階段)"
expect_landed "$F9SHIPPED" \
  "UPDATE public.shipments SET hct_status='submitted',hct_request_id='R-RETRY',hct_raw_response='{\"ok\":true}'::jsonb WHERE id=v_id" \
  "hct_status" "submitted" "🔴 F9 逃逸正測:已出貨+送單失敗可重送"
expect_sqlstate P0001 "$F9SHIPPED" \
  "UPDATE public.shipments SET recipient_snapshot=$SNAP2 WHERE id=v_id" "F9 對照:同一列改收件快照仍被擋(X8 沒被整條拆掉)"

log "5/6 歸因格(§4 項 15;名稱序 f < i < t < w)"
GOT="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; BEGIN $SHIPPED
  UPDATE public.shipments SET carrier_code='sf', shipment_reference='ZZZZZZ' WHERE id=v_id;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:%', COALESCE(NULLIF(current_setting('x',true),''),SQLERRM); END \$\$; ROLLBACK;")"
if echo "$GOT" | grep -q "收件資料與快遞商不可再改"; then
  ok "歸因:同時違反 X8+A2 → 紅在 frozen_after_ship(名稱序較前)"
else
  bad "歸因格失準 — 期望紅在 X8,實得:$(echo "$GOT" | head -2 | tr '\n' ' ')"
fi
GOT="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; BEGIN $SHIPPED
  UPDATE public.shipments SET shipment_reference='ZZZZZZ', shipped_at=NULL WHERE id=v_id;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:%', SQLERRM; END \$\$; ROLLBACK;")"
if echo "$GOT" | grep -q "永不可改"; then
  ok "歸因:同時違反 A2+X2 → 紅在 immutable_guard(名稱序較前)"
else
  bad "歸因格失準 — 期望紅在 A2,實得:$(echo "$GOT" | head -2 | tr '\n' ' ')"
fi

log "6/6 名稱序與前提斷言(§4 項 16/18)"
[ "$(qs "SELECT string_agg(tgname,',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND NOT tgisinternal AND (tgtype & 16)<>0 AND (tgtype & 2)<>0")" \
  = "shipments_frozen_after_ship_bu,shipments_immutable_guard_bu,shipments_touch_updated_at_bu,shipments_write_once_bu" ] \
  && ok "名稱序契約成立" || bad "名稱序契約破裂"
# 🔴 **逐名列舉,不可用 `LIKE 'pcm_b2_shipments_%'`**:那個 pattern 會把 S1b 的
#    `pcm_b2_shipments_items_presence`(X1)也掃進來 —— 它是 AFTER constraint trigger,
#    `RETURN NULL` 對它完全正常(回傳值被忽略)、SECDEF 也是必要的(要讀別的表)。
#    本支第一版就是用 pattern 寫的,S1b 一落地就由綠轉紅 = **測試自己的範圍寫錯**,不是守門壞了。
S1A2_FNS="'pcm_b2_shipments_frozen_after_ship','pcm_b2_shipments_immutable_guard','pcm_b2_shipments_write_once','pcm_b2_shipments_touch_updated_at'"
[ "$(qs "SELECT count(*) FROM pg_proc WHERE proname IN ($S1A2_FNS) AND prosrc ~* 'RETURN\s+NULL'")" = "0" ] \
  && ok "P1b:本片四支守門都沒有 RETURN NULL" || bad "有守門含 RETURN NULL — 會靜默吞掉合法更新"
[ "$(qs "SELECT count(*) FROM pg_proc WHERE proname IN ('pcm_b2_shipments_frozen_after_ship','pcm_b2_shipments_immutable_guard','pcm_b2_shipments_write_once') AND prosrc ~* 'NEW\.[a-z_]+\s*(:=|=[^=])'")" = "0" ] \
  && ok "P1:三支守門都不寫 NEW(只有 touch 寫)" || bad "有守門寫 NEW — 名稱序會開始影響結果"
[ "$(qs "SELECT count(*) FROM pg_proc WHERE proname IN ($S1A2_FNS) AND prosecdef")" = "0" ] \
  && ok "本片四支皆非 SECURITY DEFINER(它們不讀別的表 ⇒ 掛了只是多一個 owner 權限入口)" \
  || bad "本片有函式掛了不必要的 SECDEF"

log "7/6 🔴 前置閘的聚合鍵含 tgtype(B-126-A 解除令折入)"
# 🔴 migration 的前置閘原本只 pin `tgname:tgenabled` ⇒ 同名 trigger 改掛 BEFORE/AFTER 或換事件面、
#    保持啟用,閘照樣綠。v5.4-c 補上 tgtype;本節在 harness 端做同樣的雙向比對 + 突變靶⑯。
TRIGSET="$(qs "SELECT array_agg(tgname || ':' || tgenabled::text || ':' || tgtype::text ORDER BY tgname)::text
  FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND NOT tgisinternal")"
# 🔴🔴 **2026-08-07 B2-S2b-4c 更新:七支 → 八支**。大線 B2-S2b 在 `shipments` 上新增了
#    `shipments_summary_recompute_ac:O:17`(AFTER UPDATE OF shipped_at, deleted_at)。
#    🔴 這一格**當時就已經紅了**,而且紅得完全正確 —— 它是這個凍結集**應該**發揮的作用。
#    我第一版把它跟另外 25 條 C9 的紅混成一句「紅點全是 23514」,是字面 vs 事實偏離(R1 抓到)。
#    這條的修法只是把新 trigger 加進凍結集(一行字面),**不含 disable/繞過、不需上呈**。
[ "$TRIGSET" = "{shipments_block_delete_bd:O:11,shipments_block_truncate_bt:O:34,shipments_frozen_after_ship_bu:O:19,shipments_immutable_guard_bu:O:19,shipments_items_presence_ac:O:21,shipments_summary_recompute_ac:O:17,shipments_touch_updated_at_bu:O:19,shipments_write_once_bu:O:19}" ] \
  && ok "🔴 shipments **八支** trigger 的 名稱:啟用:事件面 三元組全等(改事件面會紅,不只改名會紅;第八支 = B2-S2b 的重算 trigger)" \
  || bad "trigger 三元組不符:$TRIGSET"

# 靶⑯:同名 trigger 改成 BEFORE INSERT 重建 ⇒ tgtype 由 19 變 7,上面那條必須紅。
MUT="$(q "BEGIN;
  DROP TRIGGER shipments_touch_updated_at_bu ON public.shipments;
  CREATE TRIGGER shipments_touch_updated_at_bu BEFORE INSERT ON public.shipments
    FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipments_touch_updated_at();
  SELECT 'MUT16=' || (tgtype::text) FROM pg_trigger
   WHERE tgrelid='public.shipments'::regclass AND tgname='shipments_touch_updated_at_bu';
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT16=7' \
  && ok "突變靶⑯:同名 trigger 改掛 BEFORE INSERT 後 tgtype 由 19 變 7 ⇒ 補上 tgtype 的聚合鍵抓得到(舊的 名稱:啟用 兩元組完全隱形)" \
  || bad "突變靶⑯ 沒重現:$(echo "$MUT" | grep MUT16 | head -1)"

log "F 突變矩陣:靶⑤ 守門改 RETURN NULL(plan §4 項 35)"
MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_shipments_write_once() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS \$m\$ BEGIN RETURN NULL; END \$m\$;
  DO \$\$ DECLARE v_id uuid; v_got text; BEGIN $SHIPPED
    UPDATE public.shipments SET tracking_number='T-MUT' WHERE id=v_id;
    SELECT tracking_number INTO v_got FROM public.shipments WHERE id=v_id;
    RAISE NOTICE 'MUT:%', COALESCE(v_got,'<NULL>');
  END \$\$;
ROLLBACK;")"
# 🔴 v5.4 期望值隨 #16 的 fixture 合法化一起改:舊 fixture 是「一筆 INSERT 直接帶 T111」,
#    所以突變下觀察到的殘值是 `T111`;新 fixture 的出貨是一句 **UPDATE**,而 RETURN NULL
#    會把**那句也一起吞掉** ⇒ 殘值是 `<NULL>`。判別力不變(未突變時該值是 `T-MUT`),
#    但期望值寫成 T111 就會像現在這樣紅 —— 這正是「改預設 fixture 讓既有斷言前提消失」的同型
#    (memory `feedback_false-green-when-default-constant-changes` 的反向:這次是轉紅、抓到了)。
if echo "$MUT" | grep -q 'MUT:<NULL>'; then
  ok "突變靶⑤:守門改 RETURN NULL 後,合法更新被靜默吞掉、零錯誤(連 fixture 的出貨 UPDATE 都沒生效 ⇒ 殘值 NULL)⇒ 項 16b 的回查 oracle 抓得到"
elif echo "$MUT" | grep -q 'MUT:T-MUT'; then
  bad "突變靶⑤ 沒重現 — RETURN NULL 之下值竟然仍落庫?請重查 PG BEFORE trigger 語意"
else
  bad "突變靶⑤ 執行異常:$(echo "$MUT" | tail -2 | tr '\n' ' ')"
fi

# 🔴 靶⑬(v5.4,codex K2 #19):把 carrier_note 從 X8 的凍結條件拿掉 ⇒ **carrier_note 單獨格**
#    必須從「被擋」變成「改得動」。舊的合併格(同句改 carrier_code)在這個突變下**仍然紅**
#    ⇒ 那格證明不了 carrier_note 有被凍結。
MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_shipments_frozen_after_ship() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS \$m\$
  BEGIN
    IF (OLD.shipped_at IS NOT NULL OR OLD.deleted_at IS NOT NULL)
       AND (NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
         OR NEW.carrier_code IS DISTINCT FROM OLD.carrier_code) THEN
      RAISE EXCEPTION '突變版' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END \$m\$;
  DO \$\$ DECLARE v_id uuid; v_got text; BEGIN $OTHER_SHIPPED
    UPDATE public.shipments SET carrier_note='改成別的說明' WHERE id=v_id;
    SELECT carrier_note INTO v_got FROM public.shipments WHERE id=v_id;
    RAISE NOTICE 'MUT13:%', v_got;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT13:ERR:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT13:改成別的說明' \
  && ok "突變靶⑬:carrier_note 移出凍結集後,單獨格真的改得動 ⇒ 該格對 carrier_note 有判別力(舊的合併格做不到)" \
  || bad "突變靶⑬ 沒重現:$(echo "$MUT" | grep MUT13 | head -1)"

# 🔴 靶⑭(v5.4,codex K2 #19):拿掉 touch trigger ⇒ 外部指定的 updated_at **真的落庫**,
#    updated_at 單獨格必須翻紅。沒有這一靶,那格可能只是「碰巧成立」。
MUT="$(q "BEGIN;
  DROP TRIGGER shipments_touch_updated_at_bu ON public.shipments;
  DO \$\$ DECLARE v_id uuid; v_got text; BEGIN $SHIPPED
    UPDATE public.shipments SET updated_at='2020-01-01T00:00:00Z'::timestamptz WHERE id=v_id;
    SELECT (updated_at = '2020-01-01T00:00:00Z'::timestamptz)::text INTO v_got FROM public.shipments WHERE id=v_id;
    RAISE NOTICE 'MUT14:%', v_got;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT14:ERR:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT14:true' \
  && ok "突變靶⑭:拿掉 touch 後,外部指定的 updated_at 真的落庫 ⇒ 該格量的是 touch、不是恆真" \
  || bad "突變靶⑭ 沒重現:$(echo "$MUT" | grep MUT14 | head -1)"

# 🔴 靶③(plan §4 項 35 指定的四靶之一 —— **v5.3 之下三支 harness 一個都沒實作**,
#    而 plan 卻寫「③⑥ 由 b2s1b-verify.sh §F 實跑證」⇒ 那句是字面與事實不符,本版補上。
#    靶③ 測的是 X8 條件裡的 `OR OLD.deleted_at IS NOT NULL`:砍掉它 ⇒ **項 11b 已作廢面整族失效**。
#    🔴 fixture 的 `hct_status` 必須是 draft(plan 項 35 明文),否則改 carrier_code 會先紅在
#       X5 的 23514、歸因錯人 —— VOIDED 正是「draft + 已作廢」。
MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_shipments_frozen_after_ship() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS \$m\$
  BEGIN
    IF (OLD.shipped_at IS NOT NULL)
       AND (NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
         OR NEW.carrier_code IS DISTINCT FROM OLD.carrier_code
         OR NEW.carrier_note IS DISTINCT FROM OLD.carrier_note) THEN
      RAISE EXCEPTION '突變版:只看 shipped_at' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END \$m\$;
  DO \$\$ DECLARE v_id uuid; v_got text; BEGIN $VOIDED
    UPDATE public.shipments SET carrier_code='sf' WHERE id=v_id;
    SELECT carrier_code INTO v_got FROM public.shipments WHERE id=v_id;
    RAISE NOTICE 'MUT3:%', v_got;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT3:ERR:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT3:sf' \
  && ok "突變靶③:X8 砍掉 \`OR OLD.deleted_at IS NOT NULL\` 後,已作廢包裹的快遞商真的改得動 ⇒ 項 11b 那族有判別力(v5.3 之下此靶零實作)" \
  || bad "突變靶③ 沒重現:$(echo "$MUT" | grep MUT3 | head -1)"

# 🔴 靶⑮(v5.4,codex K2 #15/#16 的**修法自證**):把 fixture 退回舊寫法(一筆 INSERT 直接帶
#    shipped_at、**零品項**),配上 expect_landed 現在會下的 `SET CONSTRAINTS ALL IMMEDIATE`
#    ⇒ 必須紅在 X1 的 P0001。
#    這一格證明的是「**fixture 合法化 + 強制 deferred 這對修法有真實後果**」:
#    在 v5.3 之下,同一張非法 fixture 因為 X1 從未發火而**全程假綠**。
MUT="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; BEGIN
    INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,tracking_number,shipped_at)
      VALUES ('BCDFGK','$CUST',$SNAP,'hct','T-OLD',now()) RETURNING id INTO v_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE NOTICE 'MUT15:PASSED';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT15:%', SQLSTATE; END \$\$; ROLLBACK;")"
echo "$MUT" | grep -q 'MUT15:P0001' \
  && ok "突變靶⑮:舊的「零品項已出貨」fixture 在強制 deferred 之下真的紅在 X1 ⇒ #15/#16 的 fixture 合法化不是裝飾(v5.3 之下它全程假綠)" \
  || bad "突變靶⑮ 沒重現 — 非法 fixture 竟仍通過?SET CONSTRAINTS 可能沒生效:$(echo "$MUT" | grep MUT15 | head -1)"


log "G B2-S2b 回歸格(項 25b;2026-08-07 S2b-4c 加)"
# 🔴 大線 B2-S2b §0.3 的**前提**是「`shipped` 只可能經由 `UPDATE shipments SET shipped_at` 升值」,
#    而那個前提整個壓在 **X1 與 X3** 上:X3 擋「對已寄出/已作廢的包裹加品項」、
#    X1 擋「已離開草稿態卻零品項」⇒ 兩條路都不通,已寄出的包裹只能由 UPDATE 產生。
#    哪天有人放寬其中一支,大線的 `shipped` 會**靜默永遠算少**,而大線自己的 harness 不會紅
#    (它掛在 shipments 的 UPDATE 上,看不到 INSERT 那條路)。⇒ 回歸點必須畫在**這裡**。
# 🔴 **凍結字串一律雙引號**:X1 的 triggerdef 內含 `'draft'::text` —— 用單引號包會被那個單引號
#    當場切斷,變數只剩前半段 ⇒ 這一格會**永遠紅**而且訊息裡兩邊看起來一模一樣(第一次實跑實錘)。
TD_X1_FROZEN="CREATE CONSTRAINT TRIGGER shipments_items_presence_ac AFTER INSERT OR UPDATE ON public.shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.shipped_at IS NOT NULL) OR (new.hct_status <> 'draft'::text))) EXECUTE FUNCTION pcm_b2_shipments_items_presence()"
TD_X3_FROZEN="CREATE CONSTRAINT TRIGGER shipment_items_parent_guard_ac AFTER INSERT ON public.shipment_items NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION pcm_b2_shipment_items_parent_guard()"
# 🔴 R1 nit 7:`coalesce(pg_get_triggerdef(oid),…)` 在**零列**時根本不會求值 ⇒ 那個「<不存在>」是死碼、
#    變數會變成空字串,「不存在」與「被改成別的」分不出來。改成子查詢形,COALESCE 才吃得到 NULL。
# 🔴 R1 nit 8:加上 `tgrelid` 過濾 —— 只用 tgname 時,同名 trigger 掛在別表會回兩列。
TD_X1_NOW="$(qs "SELECT coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND tgname='shipments_items_presence_ac' AND NOT tgisinternal), '<不存在>')")"
TD_X3_NOW="$(qs "SELECT coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipment_items'::regclass AND tgname='shipment_items_parent_guard_ac' AND NOT tgisinternal), '<不存在>')")"
if [ "$TD_X1_NOW" = "$TD_X1_FROZEN" ] && [ "$TD_X3_NOW" = "$TD_X3_FROZEN" ]; then
  ok "🔴 項25b:X1 / X3 都還在,且 triggerdef **逐字**未被放寬(B2-S2b §0.3 前提的回歸點)"
else
  bad "項25b:X1 或 X3 的 triggerdef 變了 — X1 實得 [$TD_X1_NOW] / X3 實得 [$TD_X3_NOW]
     🔴 放寬其中一支 ⇒ 大線 B2-S2b 的 shipped 會靜默永遠算少,而大線自己的 harness 不會紅"
fi

# 🔴 靶:拿掉 X3 ⇒ 上面那格必須從綠翻紅(證明它真的在量 X3,不是被 X1 代打)。
MUT="$(q "BEGIN;
  DROP TRIGGER shipment_items_parent_guard_ac ON public.shipment_items;
  SELECT 'MUTANT_X3=' || coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipment_items'::regclass AND tgname='shipment_items_parent_guard_ac' AND NOT tgisinternal), '<不存在>');
  SELECT 'MUTANT_CELL=' || (
      coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND tgname='shipments_items_presence_ac' AND NOT tgisinternal), '<不存在>') = \$X1\$$TD_X1_FROZEN\$X1\$
  AND coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipment_items'::regclass AND tgname='shipment_items_parent_guard_ac' AND NOT tgisinternal), '<不存在>') = \$X3\$$TD_X3_FROZEN\$X3\$
  )::text;
ROLLBACK;")"
# 🔴 R1 nit 10:證的必須是「**那一格會翻紅**」,不是「觀察會變」⇒ 在突變交易裡把該格的
#    **複合判斷原樣重跑一次**(X1 AND X3),並要求它的結論從 true 變 false。
MUT_VERDICT="$(printf '%s' "$MUT" | sed -n 's/^MUTANT_CELL=//p' | head -1)"
if printf '%s' "$MUT" | grep -q 'MUTANT_X3=<不存在>' && [ "$MUT_VERDICT" = "false" ]; then
  ok "項25b 靶:拿掉 X3 之後 ①它真的查不到了 ②**該格的複合判斷(X1 AND X3)由 true 翻成 false** ⇒ 那一格對 X3 有判別力(不是只靠 X1 就綠)"
else
  bad "項25b 靶沒有重現(拿掉 X3 之後竟然還查得到)⇒ 該格可能量錯東西:$(printf '%s' "$MUT" | tail -2 | tr '\n' ' ')"
fi

echo
echo "════════ B2 S1a-2 驗證結果:PASS=$PASS / FAIL=$FAIL ════════"
[ "$FAIL" -eq 0 ] || exit 1
