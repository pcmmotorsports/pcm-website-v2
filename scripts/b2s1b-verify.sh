#!/usr/bin/env bash
#
# B2 S1b 驗收:`public.shipment_items` + parent guard(X3+A7)+ X1(掛 shipments)。
# 片級 plan = docs/specs/2026-08-05-e10-b2-shipments-db-plan.md(v5.4)§4 項 19-33。
#
# 用法:scripts/b2s1b-verify.sh <db-url>
#
# 🔴 本支最重要的一格 = **項 24 作廢重開**:Sean 2026-08-05 拍 Q1=A 時明文接受的
#    更正流程就是「先作廢包裹 → 改 → 重新出貨」,而它在 DB 層能不能走通,只有這一格在證明。
#    它紅掉 = 那條拍板的流程走不通。
#
# 🔴 誠實邊界(codex K2-R3 nit):`SET CONSTRAINTS ALL IMMEDIATE` 會**當場跑掉延遲檢查**,
#    但它**不等於真 COMMIT** —— 真 COMMIT 還包含寫入可見性、其他交易的併發效應等。
#    本支證明的是「這個終態通得過所有延遲約束」,不是「它在正式站 commit 一定沒事」。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="${1:-${D1_DB_URL:-}}"
[ -n "$URL" ] || { echo "🔴 用法:scripts/b2s1b-verify.sh <db-url>"; exit 2; }
export LC_ALL=C

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $*"; }
log() { echo; echo "== $* =="; }
q()  { psql "$URL" -v ON_ERROR_STOP=0 -qtA -c "$1" 2>&1 || true; }
qs() { psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1"; }

# ── 🔴🔴 拋棄庫身分閘(v5.4 新增;codex K2-R3 BLOCKER)────────────────────────
# 本支會 **COMMIT 真資料、停用 trigger、CREATE OR REPLACE 真函式**(barrier 節與突變矩陣),
# 而原本只檢查「URL 非空」⇒ 誤餵正式站 URL 就會直接寫正式資料與 DDL。
# 🔴 這個破壞面是 v5.4 才引進的(v5.3 全程 BEGIN/ROLLBACK),閘必須跟著補。
# 三重、fail-closed(照 scripts/a6-verify.sh:45-52 的既有形狀改寫成吃 URL 的版本):
#   ①連到的 DB 的 data_directory 的上層目錄必須有 `.d1t2-harness` ownership marker
#     —— 正式站的 data_directory 在本機根本不存在 ⇒ 檢查必失敗、拒跑;
#   ②host 必須是 127.0.0.1、port 必須落在 543xx(交接檔 §5 的既有範圍閘);
#   ③database 名必須是 postgres。
# 🔴 v5.4-b(codex K2-R4 BLOCKER):第一版用 `case "$URL" in *127.0.0.1:543xx/*)` 比對,
#    那是**子字串**比對 ⇒ 一個 `postgresql://u:p@prod.example.com/db?x=127.0.0.1:54342/y`
#    照樣命中、閘形同虛設。改成**問伺服器本人**(`inet_server_addr/port`),
#    URL 長什麼樣不重要,連到誰才重要。
gate_throwaway_db() {
  local datadir workdir addr port
  addr="$(qs "SELECT COALESCE(host(inet_server_addr()),'<unix-socket>')")"
  port="$(qs "SELECT inet_server_port()")"
  case "$addr:$port" in
    127.0.0.1:543[0-9][0-9]) : ;;
    *) echo "🔴 身分閘:連到的伺服器是 $addr:$port,不是 127.0.0.1 的 543xx 拋棄庫;拒跑"; exit 1 ;;
  esac
  [ "$(qs "SELECT current_database()")" = "postgres" ] || { echo "🔴 身分閘:database 名不是 postgres;拒跑"; exit 1; }
  datadir="$(qs "SHOW data_directory")"
  workdir="$(dirname "$datadir")"
  [ -f "$workdir/.d1t2-harness" ] || {
    echo "🔴 身分閘:$workdir 沒有 .d1t2-harness ownership marker ⇒ 這不是 d1t2 provision 出來的拋棄庫;拒跑"
    echo "   (本支會 COMMIT 資料並改函式定義,不接受在非拋棄庫上跑)"
    exit 1; }
}
gate_throwaway_db
# 🔴 v5.4-b(codex K2-R4 B):負向實測必須落成**常駐回歸**,否則日後有人把閘寫鬆,
#    正常數字照樣全綠、沒有人會知道。本格在 subshell 裡拿假 URL 重跑閘邏輯,期望它拒跑。
gate_selftest() {
  local rc
  ( URL="postgresql://postgres@prod.example.com:5432/postgres?x=127.0.0.1:54342/y"
    gate_throwaway_db ) >/dev/null 2>&1 && rc=0 || rc=$?
  [ "${rc:-0}" -ne 0 ]
}

CUST1="$(qs "SELECT customer_user_id FROM public.orders GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;")"
CUST2="$(qs "SELECT customer_user_id FROM public.orders WHERE customer_user_id <> '$CUST1' LIMIT 1;")"
ITEM1A="$(qs "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.customer_user_id='$CUST1' ORDER BY oi.id LIMIT 1;")"
# 🔴🔴 v5.4(codex K2 #24,夜跑實測):ITEM1B 舊寫法只保證「同客人、**不同訂單**」,
#    實測那兩張訂單的 `shipping_address_snapshot` **完全相同**
#    (皆為 `{"line":"演練地址",...}`)⇒ 項 23 宣稱在證 Q1=B(併箱只認客人、**不比對地址**),
#    實際上根本**構造不出那個區別** —— 就算 guard 偷偷加了「地址也要一樣」,該格照樣綠。
#    (memory `feedback_fixture-value-makes-guard-vacuous` 的同型:fixture 裡碰巧的值讓守門恆真。)
#    ⇒ 改成**明確挑收件地址不同**的第二張訂單,並在下方 A7 正測前先斷言兩者不相等。
ITEM1B="$(qs "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
  WHERE o.customer_user_id='$CUST1'
    AND o.shipping_address_snapshot::text <> (SELECT o2.shipping_address_snapshot::text
          FROM public.order_items oi2 JOIN public.orders o2 ON o2.id=oi2.order_id WHERE oi2.id='$ITEM1A')
  ORDER BY oi.id LIMIT 1;")"
ITEM2="$(qs "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.customer_user_id='$CUST2' ORDER BY oi.id LIMIT 1;")"
[ -n "$CUST2" ] && [ -n "$ITEM1B" ] && [ -n "$ITEM2" ] \
  || { echo "🔴 fixture 不足(需要兩位客人;其中一位要有**兩張收件地址不同**的訂單 —— 項 23 的前提)"; exit 1; }

SNAP="'{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb"
MKDRAFT="INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGH','$CUST1',$SNAP,'hct') RETURNING id INTO v_id;"

expect_sqlstate() {
  local want="$1" body="$2" label="$3" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; v_id2 uuid; BEGIN $body
             RAISE EXCEPTION 'NO_ERROR_RAISED' USING ERRCODE='XX999';
             EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then ok "$label(${want})"
  elif [ -z "$got" ]; then bad "$label — 🔴 測試自身異常(沒拿到 SQLSTATE)"
  else bad "$label — 期望 $want,實得 $got"; fi
}

# 🔴🔴 v5.4(codex K2 #17):`expect_ok` **已全數退場**,改用本函式。
#    舊寫法只看「有沒有噴例外」,兩個致命後果:
#      ①**沒有 `SET CONSTRAINTS ALL IMMEDIATE`** ⇒ X1 這支 DEFERRED trigger 在每格 ROLLBACK
#        之前從未發火,「零品項就出貨」這種在真 COMMIT 下必紅的流程會**假綠**;
#      ②**沒有回查終態** ⇒ 守門 `RETURN NULL` 讓 UPDATE 變成 `UPDATE 0`、零錯誤,照樣綠。
#    ⇒ 正測一律三件事:執行 → 強制跑掉延遲檢查 → 用呼叫端給的 oracle 回查**值真的落庫**。
expect_landed() {
  local body="$1" oracle="$2" want="$3" label="$4" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; v_id2 uuid; v_got text; BEGIN $body
             SET CONSTRAINTS ALL IMMEDIATE;
             SELECT ($oracle)::text INTO v_got;
             RAISE NOTICE 'GOT:%', COALESCE(v_got,'<NULL>');
             EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:ERR:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then ok "$label(oracle=$want;延遲約束已強制落地)"
  else bad "$label — 期望 oracle=$want,實得 ${got:-<無>}"; fi
}

log "1/6 結構(§4 項 19/21)"
gate_selftest \
  && ok "🔴 身分閘自檢:拿一個「主機是正式站、但字串裡藏了 127.0.0.1:54342」的假 URL 餵閘 → 確實被拒跑(閘問的是伺服器本人 inet_server_addr/port,不是 URL 子字串)" \
  || bad "🔴🔴 身分閘自檢失敗 —— 假 URL 竟然通過!本支會 COMMIT 資料並改函式定義,閘失效 = 可能寫到正式站"
[ "$(qs "SELECT count(*) FROM pg_attribute WHERE attrelid='public.shipment_items'::regclass AND attnum>0 AND NOT attisdropped")" = "5" ] \
  && ok "5 欄" || bad "欄數不是 5"
# 🔴 v5.4(codex K2-R2 must-fix 9):原本只查「同名 index 存在」⇒ **建在錯欄位上照樣綠**
#    (同型病 b2s1a1 的靶⑪ 已實證)。改成 `pg_get_indexdef` 全等:欄位 + 唯一性一次釘死。
[ "$(qs "SELECT pg_get_indexdef('public.shipment_items_order_item_id_idx'::regclass)")" \
  = "CREATE INDEX shipment_items_order_item_id_idx ON public.shipment_items USING btree (order_item_id)" ] \
  && ok "(order_item_id) index 定義全等(欄位+唯一性;catalog 斷言,不用 EXPLAIN)" \
  || bad "order_item_id index 定義不符:$(qs "SELECT pg_get_indexdef('public.shipment_items_order_item_id_idx'::regclass)" 2>&1 | head -1)"
[ "$(qs "SELECT pg_get_indexdef('public.shipment_items_shipment_order_item_unique'::regclass)")" \
  = "CREATE UNIQUE INDEX shipment_items_shipment_order_item_unique ON public.shipment_items USING btree (shipment_id, order_item_id)" ] \
  && ok "business key unique index 定義全等(兩欄順序也釘死 —— 反序會讓作廢重開的語意變掉)" \
  || bad "unique index 定義不符:$(qs "SELECT pg_get_indexdef('public.shipment_items_shipment_order_item_unique'::regclass)" 2>&1 | head -1)"
[ "$(qs "SELECT tgdeferrable FROM pg_trigger WHERE tgrelid='public.shipment_items'::regclass AND tgname='shipment_items_parent_guard_ac'")" = "f" ] \
  && ok "parent guard = NOT DEFERRABLE(誤設 DEFERRED 會誤殺合法主流程)" || bad "parent guard 竟是 DEFERRABLE"
[ "$(qs "SELECT tgdeferrable AND tginitdeferred FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND tgname='shipments_items_presence_ac'")" = "t" ] \
  && ok "X1 = DEFERRABLE INITIALLY DEFERRED" || bad "X1 不是 DEFERRED"

# 🔴 v5.4(codex K2-R2 must-fix 11):plan §4 項 20 要求「兩個 CONSTRAINT 名歸因正確」,
#    但原本三支 harness 的 P0001 負測**只比 SQLSTATE** ⇒ 任何丟 P0001 的分支都能代打
#    (同型病本批已在 a1 的 TRUNCATE 格實錘過:紅在子表卻被讀成父表守門有效)。
#    ⇒ 本函式改讀 `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`。
#    🔴 `CONSTRAINT_NAME` 沒帶時是**空字串**而非 NULL,比對一律用 IS DISTINCT FROM 的等價寫法,
#       不可用 `<>`(NULL 會讓比較靜默回 NULL、判斷被吞掉)。
expect_constraint() {
  local want_state="$1" want_con="$2" body="$3" label="$4" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_id uuid; v_id2 uuid; v_con text; BEGIN $body
             RAISE EXCEPTION 'NO_ERROR_RAISED' USING ERRCODE='XX999';
             EXCEPTION WHEN OTHERS THEN
               GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
               RAISE NOTICE 'GOT:%|%', SQLSTATE, COALESCE(NULLIF(v_con,''),'<無>');
             END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "${want_state}|${want_con}" ]; then ok "$label(${want_state} / CONSTRAINT=${want_con})"
  else bad "$label — 期望 ${want_state}|${want_con},實得 ${got:-<無>}"; fi
}

log "2/6 X3 已寄出/已作廢禁加品項 + 主流程正測(§4 項 20/21)"
expect_constraint P0001 shipment_items_parent_open "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  UPDATE public.shipments SET shipped_at=now(),tracking_number='T1' WHERE id=v_id;
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1B',1);" \
  "🔴 X3 已寄出後加品項 被擋(歸因到 parent_open,不只看 SQLSTATE)"
expect_constraint P0001 shipment_items_parent_open "$MKDRAFT
  UPDATE public.shipments SET deleted_at=now(),void_reason='作廢' WHERE id=v_id;
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);" \
  "🔴 X3 已作廢後加品項 被擋(歸因到 parent_open)"
expect_landed "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',2);
  UPDATE public.shipments SET shipped_at=now(),tracking_number='T2' WHERE id=v_id;" \
  "SELECT (SELECT shipped_at IS NOT NULL FROM public.shipments WHERE id=v_id)::text || '/' ||
          (SELECT count(*) FROM public.shipment_items WHERE shipment_id=v_id)::text || '/' ||
          (SELECT shipped_quantity FROM public.shipment_items WHERE shipment_id=v_id)::text" \
  "true/1/2" \
  "🔴 主流程正測:加品項 → 設 shipped_at → commit(parent guard 若誤設 DEFERRED 這格會紅)"

log "3/6 A7 併箱同客人(§4 項 22/23)"
expect_constraint P0001 shipment_items_same_customer "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM2',1);" \
  "🔴 A7 塞入別的客人的品項 被擋(歸因到 same_customer —— 與 parent_open 是同一支函式的兩個分支,只比 SQLSTATE 分不出來)"
# 🔴 v5.4(codex K2 #24):**先斷言前提成立**再跑那格 —— 兩張訂單的收件地址必須真的不同,
#    否則「不比對地址」這件事在本格根本沒有被觀察到(前提消失是靜默的、不會轉紅)。
ADDR_DIFF="$(qs "SELECT (SELECT o.shipping_address_snapshot::text FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id='$ITEM1A')
                     <> (SELECT o.shipping_address_snapshot::text FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id='$ITEM1B')")"
[ "$ADDR_DIFF" = "t" ] \
  && ok "🔴 A7 正測的前提:兩張訂單的收件地址**確實不同**(v5.3 實測兩者相同 ⇒ 該格當時證明不了 Q1=B)" \
  || bad "A7 正測前提不成立 — 兩張訂單收件地址相同,Q1=B(不比對地址)在本格不可觀察"
expect_landed "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1B',1);" \
  "SELECT (SELECT count(*) FROM public.shipment_items WHERE shipment_id=v_id)::text || '/' ||
          (SELECT count(DISTINCT oi.order_id)::text FROM public.shipment_items si JOIN public.order_items oi ON oi.id=si.order_item_id WHERE si.shipment_id=v_id)" \
  "2/2" \
  "🔴 A7 判別力正測(Q1=B):同客人**兩張不同訂單、收件地址不同**併同一箱 → 必須成功"

log "4/6 🔴 項 24 作廢重開(Sean Q1=A 拍板流程的唯一 DB 層驗收)"
# 🔴 v5.4(codex K2 #17):本格是 Sean Q1=A 拍板流程的**唯一** DB 層驗收 ⇒ 最不能只驗「沒噴錯」。
#    oracle 逐項回查**兩張包裹與兩組品項的終態**:舊包裹已作廢且仍留著出貨事實、新包裹已出貨、
#    同一個 order_item 確實同時存在於兩張包裹(= UNIQUE 只鎖 (shipment_id, order_item_id) 的證據)。
expect_landed "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  UPDATE public.shipments SET shipped_at=now(),tracking_number='T3' WHERE id=v_id;
  UPDATE public.shipments SET deleted_at=now(),void_reason='選錯快遞商' WHERE id=v_id;
  INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note)
    VALUES ('BCDFGJ','$CUST1',$SNAP,'other','客人自取') RETURNING id INTO v_id2;
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id2,'$ITEM1A',1);
  UPDATE public.shipments SET shipped_at=now() WHERE id=v_id2;" \
  "SELECT (SELECT deleted_at IS NOT NULL AND shipped_at IS NOT NULL FROM public.shipments WHERE id=v_id)::text || '/' ||
          (SELECT deleted_at IS NULL AND shipped_at IS NOT NULL FROM public.shipments WHERE id=v_id2)::text || '/' ||
          (SELECT count(*) FROM public.shipment_items WHERE order_item_id='$ITEM1A' AND shipment_id IN (v_id,v_id2))::text" \
  "true/true/2" \
  "🔴 作廢重開:同一批品項可進新包裹並重新出貨(逐項回查兩張包裹終態)"

log "5/6 A6 append-only(§4 項 25)"
expect_sqlstate P0001 "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  DELETE FROM public.shipment_items WHERE shipment_id=v_id;" "A6 DELETE 被擋"
expect_sqlstate P0001 "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  UPDATE public.shipment_items SET shipped_quantity=99 WHERE shipment_id=v_id;" "A6 UPDATE 被擋"
expect_sqlstate P0001 "TRUNCATE public.shipment_items;" "A6 TRUNCATE 被擋"
expect_sqlstate 23505 "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);" \
  "同箱同品項重複 被擋"

log "6/6 X1 五面 + 判別序 + 暫態(§4 項 28-32)"
# 🔴🔴 **X1 是 DEFERRED constraint trigger ⇒ 它在 COMMIT 當下才驗**,而本支每一格都以
#    ROLLBACK 收尾(零留痕)⇒ **不做任何處理的話,X1 的檢查從頭到尾一次都不會跑**:
#    五條負測會全部「沒有錯誤」而被判失敗,兩條正測則會**假綠**(它們通過不是因為守門放行,
#    是因為守門根本沒被叫到)。實際踩過:第一版本支就是這個狀態。
#    ⇒ 每一格的最後補 `SET CONSTRAINTS ALL IMMEDIATE`,強制把佇列中的延遲檢查**當場**跑掉。
#    這也是為什麼下面的突變靶① 一定要驗:它證明「這幾格真的在量 DEFERRED 這件事」。
FIRE="SET CONSTRAINTS ALL IMMEDIATE;"
expect_sqlstate P0001 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,tracking_number,shipped_at) VALUES ('BCDFGK','$CUST1',$SNAP,'hct','T4',now()); $FIRE" \
  "X1 INSERT 面:一筆帶 shipped_at 的 INSERT、零品項"
expect_sqlstate P0001 "$MKDRAFT UPDATE public.shipments SET shipped_at=now(),tracking_number='T5' WHERE id=v_id; $FIRE" \
  "X1 UPDATE 面:設 shipped_at、零品項"
expect_sqlstate P0001 "$MKDRAFT UPDATE public.shipments SET hct_status='submitted',hct_request_id='R1' WHERE id=v_id; $FIRE" \
  "X1 送單面 submitted(D∅)、零品項"
expect_sqlstate P0001 "$MKDRAFT UPDATE public.shipments SET hct_status='failed' WHERE id=v_id; $FIRE" \
  "🔴 X1 送單面 **failed**、零品項(條件若誤寫成 = 'submitted' 這格會綠)"
expect_sqlstate P0001 "$MKDRAFT
  UPDATE public.shipments SET deleted_at=now(),void_reason='作廢' WHERE id=v_id;
  UPDATE public.shipments SET hct_status='submitted',hct_request_id='R2' WHERE id=v_id; $FIRE" \
  "X1 送單面(D≠∅ 作廢面)、零品項"
expect_landed "$MKDRAFT
  UPDATE public.shipments SET hct_status='submitted',hct_request_id='R3' WHERE id=v_id;
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);" \
  "SELECT (SELECT hct_status FROM public.shipments WHERE id=v_id) || '/' ||
          (SELECT count(*) FROM public.shipment_items WHERE shipment_id=v_id)::text" \
  "submitted/1" \
  "🔴 X1 判別序正測:先離開草稿(零品項)→ 再加品項 → commit(只有 DEFERRED 會過)"
expect_landed "$MKDRAFT
  UPDATE public.shipments SET hct_status='submitted',hct_request_id='R4' WHERE id=v_id;
  UPDATE public.shipments SET hct_status='draft',hct_request_id=NULL WHERE id=v_id;" \
  "SELECT (SELECT hct_status FROM public.shipments WHERE id=v_id) || '/' ||
          (SELECT count(*) FROM public.shipment_items WHERE shipment_id=v_id)::text" \
  "draft/0" \
  "🔴 X1 暫態正測:submitted → 改回 draft、零品項 → 必須成功(證明函式重讀現況、不信 NEW)"

# 🔴 v5.4(codex K2 #22):X1 的狀態積原本缺兩面 —— 兩面都是**可達**的真實路徑,不是理論補完。
expect_sqlstate P0001 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status,hct_request_id)
  VALUES ('BCDFGM','$CUST1',$SNAP,'hct','submitted','R-INS'); $FIRE" \
  "🔴 X1 INSERT 面 **直接帶 submitted**(不經 UPDATE;只掛 UPDATE 事件面的話這格會綠)"
expect_sqlstate P0001 "$MKDRAFT
  UPDATE public.shipments SET deleted_at=now(),void_reason='作廢' WHERE id=v_id;
  UPDATE public.shipments SET hct_status='failed' WHERE id=v_id; $FIRE" \
  "🔴 X1 送單面 **failed + 已作廢**、零品項(既有那格只測了作廢面的 submitted)"

log "7/6 🔴 shipment_items 的 RLS / ACL / 函式面(§4 項 19/33;codex K2 #23 —— 本支原本 0 命中)"
# 🔴 v5.4(codex K2 #23):實測 grep,本支對 `has_table_privilege` / `relrowsecurity` / `pg_policy`
#    / `proacl` / `proowner` **零命中** —— S1b 的權限面完全沒有被驗收過,
#    而 plan §4 項 33 明文要求「RLS/ACL 同 S1a-1 標準」。
[ "$(qs "SELECT relrowsecurity FROM pg_class WHERE oid='public.shipment_items'::regclass")" = "t" ] \
  && ok "shipment_items RLS 已啟用" || bad "shipment_items RLS 未啟用"
[ "$(qs "SELECT count(*) FROM pg_policy WHERE polrelid='public.shipment_items'::regclass")" = "0" ] \
  && ok "shipment_items zero-policy" || bad "shipment_items 不是 zero-policy"
[ "$(qs "SELECT relforcerowsecurity FROM pg_class WHERE oid='public.shipment_items'::regclass")" = "f" ] \
  && ok "shipment_items 未 FORCE RLS(parent guard 是 SECDEF、要以函式 owner 讀得到本表)" \
  || bad "shipment_items 被 FORCE RLS — SECDEF 守門會讀不到自己的表"
[ "$(qs "SELECT has_table_privilege('service_role','public.shipment_items','SELECT')")" = "t" ] \
  && ok "service_role 有 SELECT" || bad "service_role 缺 SELECT"
[ "$(qs "SELECT has_table_privilege('service_role','public.shipment_items','INSERT') OR has_table_privilege('service_role','public.shipment_items','UPDATE') OR has_table_privilege('service_role','public.shipment_items','DELETE')")" = "f" ] \
  && ok "service_role 只有 SELECT(本批零 writer)" || bad "service_role 有寫入權 — 本批應零 writer"
[ "$(qs "SELECT has_table_privilege('anon','public.shipment_items','SELECT') OR has_table_privilege('authenticated','public.shipment_items','SELECT')")" = "f" ] \
  && ok "client 角色對 shipment_items 零權限" || bad "client 角色讀得到包裹內容"
# 🔴 nit 6:`has_table_privilege` 在 superuser 連線下對 owner 面零判別力 ⇒ 補一格**真的換身分**的行為觀察。
NONOWNER="$(q "BEGIN; SET LOCAL ROLE service_role;
  DO \$\$ BEGIN INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity)
    VALUES (gen_random_uuid(),'$ITEM1A',1);
    RAISE NOTICE 'NONOWNER:WROTE';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'NONOWNER:%', SQLSTATE; END \$\$; ROLLBACK;")"
echo "$NONOWNER" | grep -q 'NONOWNER:42501' \
  && ok "🔴 非 owner 行為格:service_role 真的以該身分 INSERT → 被拒(42501),不是只查 has_table_privilege" \
  || bad "非 owner 行為格失準 — 期望 42501,實得:$(echo "$NONOWNER" | grep NONOWNER | head -1)"
# 三支 S1b 函式的 owner / SECDEF / search_path / 零 grantee(§3.2-C-2 的同一套標準)
S1B_FNS="'public.pcm_b2_shipment_items_parent_guard()'::regprocedure,
         'public.pcm_b2_shipments_items_presence()'::regprocedure,
         'public.pcm_b2_shipment_items_append_only()'::regprocedure"
[ "$(qs "SELECT count(*) FROM pg_proc p WHERE p.oid IN ($S1B_FNS)
          AND p.proowner <> (SELECT relowner FROM pg_class WHERE oid='public.shipment_items'::regclass)")" = "0" ] \
  && ok "三支 S1b 函式的 owner = shipment_items 的 owner(SECDEF 以函式 owner 起跑 ⇒ 承重)" \
  || bad "有 S1b 函式 owner 與表 owner 不一致 — SECDEF 守門會讀不到表"
[ "$(qs "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid IN ($S1B_FNS) AND a.grantee <> p.proowner")" = "0" ] \
  && ok "三支 S1b 函式除 owner 外零 grantee" \
  || bad "S1b 函式仍有非 owner grantee — REVOKE 只寫 FROM PUBLIC 擋不掉具名角色"
# 🔴 v5.4(codex K2-R2 D1):`proacl IS NULL` = 走預設 ACL(函式預設含 PUBLIC EXECUTE),
#    而 `aclexplode(NULL)` 回零列 ⇒ 上一條在那種情況下恆真。補「非 NULL」+ 行為面兩道。
[ "$(qs "SELECT count(*) FROM pg_proc WHERE oid IN ($S1B_FNS) AND proacl IS NULL")" = "0" ] \
  && ok "三支 S1b 函式的 proacl 皆非 NULL(NULL 會讓上一條變恆真)" \
  || bad "有 S1b 函式 proacl 為 NULL — 零 grantee 斷言在它身上是恆真的"
[ "$(qs "SELECT count(*) FROM pg_proc p, unnest(ARRAY['public','anon','authenticated','service_role']) r
          WHERE p.oid IN ($S1B_FNS) AND has_function_privilege(r, p.oid, 'EXECUTE')")" = "0" ] \
  && ok "🔴 行為面:四個角色對三支 S1b 函式**實際上**都沒有 EXECUTE(不靠 catalog 表示法)" \
  || bad "有角色實際執行得了 S1b 函式"
# 🔴 恰兩支 SECDEF(parent_guard / items_presence),且兩支的 search_path 逐字 = 'public, pg_temp'。
#    空 proconfig 的 SECDEF 可被呼叫端的 search_path 劫持 ⇒ 這條是承重的、不是清單裝飾。
[ "$(qs "SELECT string_agg(p.oid::regprocedure::text || '|' || array_to_string(p.proconfig,';'), ',' ORDER BY p.oid::regprocedure::text)
          FROM pg_proc p WHERE p.oid IN ($S1B_FNS) AND p.prosecdef")" \
  = "pcm_b2_shipment_items_parent_guard()|search_path=public, pg_temp;lock_timeout=5s,pcm_b2_shipments_items_presence()|search_path=public, pg_temp;lock_timeout=5s" ] \
  && ok "兩支 SECDEF 的 search_path 與 lock_timeout 逐字釘死(空 proconfig 的 SECDEF 可被 search_path 劫持)" \
  || bad "SECDEF 的 proconfig 不符:$(qs "SELECT string_agg(p.oid::regprocedure::text || '|' || array_to_string(p.proconfig,';'), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN ($S1B_FNS) AND p.prosecdef")"
# 品項表的約束集合雙向 + 兩支 FK 定義逐字(#23 點名的結構面;少一條多一條都紅)
[ "$(qs "SELECT string_agg(conname,',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.shipment_items'::regclass AND contype IN ('p','u','f','c')")" \
  = "shipment_items_order_item_id_fkey,shipment_items_pkey,shipment_items_quantity_positive,shipment_items_shipment_id_fkey,shipment_items_shipment_order_item_unique" ] \
  && ok "shipment_items 約束集合雙向(5 條;多一條少一條都紅)" \
  || bad "shipment_items 約束集合不符:$(qs "SELECT string_agg(conname,',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.shipment_items'::regclass AND contype IN ('p','u','f','c')")"
[ "$(qs "SELECT string_agg(pg_get_constraintdef(oid),' | ' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.shipment_items'::regclass AND contype='f'")" \
  = "FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT | FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT" ] \
  && ok "兩支 FK 定義逐字(ON DELETE RESTRICT — 改成 CASCADE 會讓 append-only 形同虛設;字面對齊 migration:69-70)" \
  || bad "FK 定義不符:$(qs "SELECT string_agg(pg_get_constraintdef(oid),' | ' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.shipment_items'::regclass AND contype='f'")"
expect_sqlstate 23514 "$MKDRAFT
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',0);" \
  "quantity=0 被擋(CHECK 有在工作,不只是存在)"

log "F 突變矩陣(靶①②⑥;plan §4 項 35)"
MUT="$(q "BEGIN;
  DROP TRIGGER shipments_items_presence_ac ON public.shipments;
  CREATE CONSTRAINT TRIGGER shipments_items_presence_ac AFTER INSERT OR UPDATE ON public.shipments
    NOT DEFERRABLE FOR EACH ROW WHEN (NEW.shipped_at IS NOT NULL OR NEW.hct_status <> 'draft')
    EXECUTE FUNCTION public.pcm_b2_shipments_items_presence();
  DO \$\$ DECLARE v_id uuid; BEGIN $MKDRAFT
    UPDATE public.shipments SET hct_status='submitted',hct_request_id='R9' WHERE id=v_id;
    INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM1A',1);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE NOTICE 'MUT1:PASSED';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT1:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT1:P0001' \
  && ok "突變靶①:X1 改 IMMEDIATE 後,判別序正測被打紅 ⇒ 該格真的在量 DEFERRED" \
  || bad "突變靶① 沒重現(X1 改 IMMEDIATE 竟仍過)⇒ 判別序正測可能量錯東西:$(echo "$MUT" | grep MUT1 | head -1)"

MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_shipments_items_presence() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$m\$
  DECLARE v_cnt integer; BEGIN
    SELECT count(*) INTO v_cnt FROM public.shipment_items si WHERE si.shipment_id = NEW.id;
    IF v_cnt = 0 THEN RAISE EXCEPTION '信 NEW 版' USING ERRCODE='P0001'; END IF;
    RETURN NULL; END \$m\$;
  DO \$\$ DECLARE v_id uuid; BEGIN $MKDRAFT
    UPDATE public.shipments SET hct_status='submitted',hct_request_id='R8' WHERE id=v_id;
    UPDATE public.shipments SET hct_status='draft',hct_request_id=NULL WHERE id=v_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE NOTICE 'MUT2:PASSED';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT2:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT2:P0001' \
  && ok "突變靶②:X1 改成信 NEW 後,暫態正測被打紅 ⇒ 該格真的在量「重讀現況」" \
  || bad "突變靶② 沒重現:$(echo "$MUT" | grep MUT2 | head -1)"

MUT="$(q "BEGIN;
  DROP TRIGGER shipments_items_presence_ac ON public.shipments;
  CREATE CONSTRAINT TRIGGER shipments_items_presence_ac AFTER INSERT OR UPDATE ON public.shipments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.shipped_at IS NOT NULL OR NEW.hct_status = 'submitted')
    EXECUTE FUNCTION public.pcm_b2_shipments_items_presence();
  DO \$\$ DECLARE v_id uuid; BEGIN $MKDRAFT
    UPDATE public.shipments SET hct_status='failed' WHERE id=v_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE NOTICE 'MUT3:PASSED';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT3:%', SQLSTATE; END \$\$;
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT3:PASSED' \
  && ok "突變靶⑥:X1 條件改成 = 'submitted' 後,failed 面**真的漏掉**(那格因此有判別力)" \
  || bad "突變靶⑥ 沒重現:$(echo "$MUT" | grep MUT3 | head -1)"

log "8/6 🔴🔴 併發 barrier:parent guard 的 FOR NO KEY UPDATE 是承重件(§4 項 21b;codex K2 #25)"
# 🔴 為什麼要有這一節:v5.3 全部是單 session,而**單 session 對鎖原語零判別力**。
#    夜跑實測:把 `FOR NO KEY UPDATE` 整句移除後重跑整支 → PASS=24 / FAIL=0,**全綠**。
#    承重的鎖原語被拔掉,驗收毫無反應(memory `feedback_race-test-without-barrier-proves-nothing`)。
#
# 🔴 判別力來源(不講清楚就會量錯東西):`shipment_items` 的 FK 會對 parent 自動取 **KEY SHARE**,
#    而 KEY SHARE 依 PG 列鎖衝突矩陣**只與 FOR UPDATE 衝突、不與 NO KEY UPDATE 衝突**
#    ⇒ 若 guard 退回普通 SELECT,B 的 UPDATE(取 NO KEY UPDATE)**不會**被 FK 的 KEY SHARE 擋住。
#    ⇒ 「B 被擋住」這個觀察**只可能由 guard 那句顯式 FOR NO KEY UPDATE 提供**。突變靶⑦ 在證這件事。
#
# 🔴 **兩個方向都要測**(codex K2-R2 must-fix 2):
#    方向甲(guard 先取鎖):A 插品項 → B 改 parent 的 shipped_at → B 被擋。證「guard 取得了鎖」。
#    方向乙(guard 撞別人的鎖):A 直接 UPDATE parent(取 NKU)→ B 插品項 → **B 的 guard 被擋在自己那句
#      SELECT … FOR NO KEY UPDATE 上**。證「guard 讀 parent 那句**本身**是鎖定讀」——
#      只有方向甲的話,一個「先普通讀舊值、事後才另外取鎖」的寫法照樣全綠,stale-pass 沒被封死。
#
# 🔴 fixture 必須 **COMMIT**(兩個 session 都要看得見)⇒ 本節是全支唯一會留列的地方。
#    ⇒ 掛 EXIT/INT/TERM trap:**任何中斷路徑**都會還原 guard 定義並清掉 fixture
#    (codex K2-R2 must-fix 3/4:突變與還原都是 autocommit,沒有 trap 的話一次 Ctrl-C
#     就會把 parent guard 永久留在「沒有鎖原語」的突變版,而那正是本節要保護的東西)。
BARRIER_REF="BZZZZZ"
# 🔴🔴 fixture id 存**檔案**不存變數(codex K2-R2 B):`R="$(barrier_run …)"` 是 command
#    substitution ⇒ 整個函式跑在 **subshell** 裡,它對變數的賦值**傳不回父 shell**
#    ⇒ 父層 EXIT trap 看到的 BARRIER_FIX_ID 永遠是空的,中斷時清不掉那張已 COMMIT 的 fixture。
#    改用檔案就跨得過 subshell 邊界。
BARRIER_IDFILE="/tmp/b2barrier_id_$$"
: > "$BARRIER_IDFILE"
GUARD_ORIG_DEF="$(qs "SELECT pg_get_functiondef('public.pcm_b2_shipment_items_parent_guard()'::regprocedure)")"
[ -n "$GUARD_ORIG_DEF" ] || { echo "🔴 取不到 parent guard 定義,拒跑 barrier 節(沒有原定義就沒有還原保底)"; exit 1; }

# 🔴🔴 **兩個職責必須分開**(本支實際踩過的 bug):清 fixture 每一輪都要做,
#    但**還原 guard 只能在突變階段結束後做**。第一版把兩件事寫在同一個函式、又在每輪結尾呼叫
#    ⇒ 突變版方向甲跑完就把 guard 還原了,方向乙其實是在**原版**上量的,
#    突變靶⑦(方向乙)因此永遠「沒重現」—— 那條紅不是守門的問題,是 harness 自己量錯東西。
barrier_restore_guard() {
  # 還原 guard(即使沒被突變過也無害:CREATE OR REPLACE 成原定義是冪等的)。
  # 🔴 還原**失敗不可靜默吞掉**(codex K2-R2 nit):這是保底路徑,它失敗的時候正是最需要有人知道的時候。
  if ! psql "$URL" -v ON_ERROR_STOP=1 -q -c "$GUARD_ORIG_DEF" >/dev/null 2>&1; then
    echo "🔴🔴 barrier:parent guard 還原失敗 —— 該函式可能停在無鎖原語的突變版,請人工檢查!" >&2
    return 1
  fi
}
barrier_cleanup() {
  # 清 fixture。🔴 只停用**指名的兩支** block trigger,不用 `DISABLE TRIGGER USER`——
  #    後者會把「執行前本來就被刻意停用」的其他 user trigger 一併改回啟用,
  #    讓下方「全部 O」那條斷言把狀態污染判成成功(codex K2-R2 nit 2)。
  local fid
  fid="$(cat "$BARRIER_IDFILE" 2>/dev/null || true)"
  if [ -n "$fid" ]; then
    # 🔴 v5.4(codex K2-R3 must-fix):原本用 ON_ERROR_STOP=0 吞掉錯誤、之後**無條件**清空 ID 檔
    #    ⇒ 刪除失敗時已 COMMIT 的 fixture 還在,但「它是誰」的唯一指標被抹掉 = 留痕且無從追。
    #    改成:ON_ERROR_STOP=1、**只有成功才清 ID 檔**,失敗大聲報並保留指標。
    if psql "$URL" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<CLEAN
BEGIN;
ALTER TABLE public.shipment_items DISABLE TRIGGER shipment_items_block_delete_bd;
ALTER TABLE public.shipments DISABLE TRIGGER shipments_block_delete_bd;
DELETE FROM public.shipment_items WHERE shipment_id='$fid';
DELETE FROM public.shipments WHERE id='$fid';
ALTER TABLE public.shipments ENABLE TRIGGER shipments_block_delete_bd;
ALTER TABLE public.shipment_items ENABLE TRIGGER shipment_items_block_delete_bd;
COMMIT;
CLEAN
    then
      : > "$BARRIER_IDFILE"
    else
      echo "🔴🔴 barrier:fixture 清理失敗,shipment id=$fid 仍留在庫裡(ID 檔保留供追查)" >&2
    fi
  fi
  rm -f "/tmp/b2barrier_a_$$.out" "/tmp/b2barrier_b_$$.out"
}
# 🔴 ID 檔本身也要收(本支第一版漏了 ⇒ 每跑一次就在 /tmp 留一個空檔案)。
#    放在獨立函式、只由 trap 呼叫 —— barrier_cleanup 每輪都跑,不能在那裡刪掉還要用的 ID 檔。
# 🔴 v5.4-b(codex K2-R4 must-fix 3 / B):**只在 cleanup 成功時才刪 ID 檔**。
#    第一版無條件 rm ⇒ cleanup 失敗(fixture 還在庫裡)時,唯一的追查指標也被抹掉,
#    而正常路徑全綠不會讓這條失敗路徑轉紅 —— 正是 R3 那條「覆蓋面靜默流失」的同型。
barrier_drop_idfile() {
  if [ -s "$BARRIER_IDFILE" ]; then
    echo "🔴🔴 barrier:ID 檔非空 ⇒ fixture 沒清乾淨,保留 $BARRIER_IDFILE 供追查(內容=$(cat "$BARRIER_IDFILE"))" >&2
  else
    rm -f "$BARRIER_IDFILE"
  fi
}
# 🔴 trap 兩件都做:任何中斷路徑(Ctrl-C / kill / set -e 退出)都要把 guard 還原 **並** 清掉 fixture,
#    否則一次中斷就會把 parent guard 永久留在「沒有鎖原語」的突變版 —— 那正是本節要保護的東西。
# 🔴 INT/TERM 的 handler 必須自己 `exit` —— 訊號處理完 shell 會**繼續往下跑**,
#    那會在「已經被要求中止」之後接著動 DB(codex K2-R2 B)。EXIT 那條照舊只做清理。
trap 'barrier_restore_guard; barrier_cleanup; barrier_drop_idfile' EXIT
trap 'barrier_restore_guard; barrier_cleanup; barrier_drop_idfile; exit 130' INT TERM

# $1 = 方向(jia = guard 先取鎖 / yi = guard 撞別人的鎖);回傳 "BLOCKED=… BLOCKER_IS_A=…"
barrier_run() {
  local dir="$1" apid bpid blocked blocker unblocked timedout fix_id
  fix_id="$(qs "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note)
                VALUES ('$BARRIER_REF','$CUST1',$SNAP,'other','barrier fixture') RETURNING id;")"
  printf '%s' "$fix_id" > "$BARRIER_IDFILE"   # 讓父層 trap 跨得過 subshell 看到它
  BARRIER_FIX_ID="$fix_id"
  # session A:開交易 → 取得 parent 的 NO KEY UPDATE → 掛住不放 → **COMMIT**(§4 項 21b ④ 逐字)
  if [ "$dir" = "jia" ]; then
    A_ACT="INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES ('$BARRIER_FIX_ID','$ITEM1A',1);"
  else
    A_ACT="UPDATE public.shipments SET tracking_number='T-A-LOCK' WHERE id='$BARRIER_FIX_ID';"
  fi
  psql "$URL" -v ON_ERROR_STOP=0 -qtA > "/tmp/b2barrier_a_$$.out" 2>&1 <<SQLA &
BEGIN;
SELECT 'A_PID=' || pg_backend_pid();
$A_ACT
SELECT 'A_HOLDS_LOCK';
SELECT pg_sleep(12);
COMMIT;
SQLA
  apid=""
  for _ in $(seq 1 60); do
    apid="$(sed -n 's/^A_PID=\(.*\)$/\1/p' "/tmp/b2barrier_a_$$.out" | head -1)"
    grep -q 'A_HOLDS_LOCK' "/tmp/b2barrier_a_$$.out" && break
    sleep 0.2
  done
  # session B:方向甲 = 改 parent 的 shipped_at(§4 項 21b ② 逐字);方向乙 = 插品項(觸發 guard)
  if [ "$dir" = "jia" ]; then
    B_ACT="UPDATE public.shipments SET shipped_at=now() WHERE id='$BARRIER_FIX_ID';"
  else
    B_ACT="INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES ('$BARRIER_FIX_ID','$ITEM1B',1);"
  fi
  psql "$URL" -v ON_ERROR_STOP=0 -qtA > "/tmp/b2barrier_b_$$.out" 2>&1 <<SQLB &
BEGIN;
SELECT 'B_PID=' || pg_backend_pid();
$B_ACT
SELECT 'B_ACTED';
ROLLBACK;
SQLB
  bpid=""
  for _ in $(seq 1 40); do
    bpid="$(sed -n 's/^B_PID=\(.*\)$/\1/p' "/tmp/b2barrier_b_$$.out" | head -1)"
    [ -n "$bpid" ] && break
    sleep 0.2
  done
  sleep 2   # 給 B 足夠時間「要嘛完成、要嘛卡住」
  # 🔴 兩個旗標一律用 PG 的 `true`/`false` 字面(`boolean::text` 給的是 true/false,不是 t/f)——
  #    混用會讓 case 比對永遠落到 `*)`,把一次**成功的觀察**誤報成失敗(本支實際踩過)。
  if grep -q 'B_ACTED' "/tmp/b2barrier_b_$$.out"; then blocked="false"; else blocked="true"; fi
  # 🔴 `pg_blocking_pids` **全等** ARRAY[A] —— 不是「A 在裡面就好」(§4 項 21b ③ 逐字「= {A}」)。
  #    只驗包含的話,多一個無關的 blocker 也會過,擋住 B 的到底是誰仍然沒被釘死。
  blocker="$(qs "SELECT (pg_blocking_pids('${bpid:-0}'::int) = ARRAY['$apid'::int])::text" 2>/dev/null || echo "false")"
  wait 2>/dev/null || true
  # 🔴 ④「A 結束後 B 解除阻塞」必須**驗**、不能假設(codex K2-R2 must-fix 1):
  #    上面的 blocked 是在等待**之前**定案的;若 B 解鎖後其實是失敗收場(而非完成),
  #    只看 blocked 會把「B 永遠沒成功」讀成「barrier 成立」。等 A 收工後再讀一次輸出。
  if grep -q 'B_ACTED' "/tmp/b2barrier_b_$$.out"; then unblocked="true"; else unblocked="false"; fi
  # 🔴 方向乙 B 走的是 guard,而 guard 自己 `SET lock_timeout = '5s'` ⇒ A 持鎖 12 秒時
  #    B 的正確結局是**被 lock timeout 中止**,不是完成。這個區別本身就是一條有價值的斷言:
  #    它同時證明了「guard 會等」與「guard 不會無限等」(那個 5s 護欄是承重的)。
  if grep -qi 'lock timeout' "/tmp/b2barrier_b_$$.out"; then timedout="true"; else timedout="false"; fi
  barrier_cleanup
  echo "BLOCKED=$blocked BLOCKER_IS_A=$blocker UNBLOCKED=$unblocked TIMEDOUT=$timedout"
}

BASE_SHIPMENTS="$(qs "SELECT count(*) FROM public.shipments")"
BASE_ITEMS="$(qs "SELECT count(*) FROM public.shipment_items")"

# 🔴 每一輪 barrier 跑完都要重驗基線與 trigger 狀態(codex K2-R2 must-fix 5:
#    原本只在正常版之後驗一次,突變版之後那次 teardown 失敗會完全沒人發現)。
barrier_residue_check() {
  local tag="$1"
  [ "$(qs "SELECT count(*) FROM public.shipments")" = "$BASE_SHIPMENTS" ] && [ "$(qs "SELECT count(*) FROM public.shipment_items")" = "$BASE_ITEMS" ] \
    && ok "barrier[$tag] 列數回到基線($BASE_SHIPMENTS / $BASE_ITEMS)⇒ fixture 已收乾淨、零留痕" \
    || bad "barrier[$tag] teardown 沒收乾淨 — shipments=$(qs "SELECT count(*) FROM public.shipments")(基線 $BASE_SHIPMENTS)、items=$(qs "SELECT count(*) FROM public.shipment_items")(基線 $BASE_ITEMS)"
  [ "$(qs "SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.shipments'::regclass,'public.shipment_items'::regclass) AND NOT tgisinternal AND tgenabled <> 'O'")" = "0" ] \
    && ok "barrier[$tag] 後兩表所有 trigger 都回到啟用('O')⇒ 沒有把守門留在關閉狀態" \
    || bad "🔴🔴 barrier[$tag]:有 trigger 停在非啟用狀態 — teardown 把守門關掉沒開回來"
}

R="$(barrier_run jia)"
case "$R" in
  "BLOCKED=true BLOCKER_IS_A=true UNBLOCKED=true TIMEDOUT=false")
    ok "🔴 barrier 方向甲 ①②③④:A 插品項(guard 取得 parent 的 NKU)時,B 對同一列設 shipped_at **被阻塞**;pg_blocking_pids(B) **全等** {A};**A commit 後 B 確實完成**(已回讀 B_ACTED、不是假設)" ;;
  "BLOCKED=true BLOCKER_IS_A=true UNBLOCKED=false"*)
    bad "barrier 方向甲:B 被 A 擋住了,但 A 結束後 B **沒有完成** ⇒ 這不是 barrier,是 B 根本失敗;④ 不成立($R)" ;;
  "BLOCKED=true "*)
    bad "barrier 方向甲:B 被擋住了,但 pg_blocking_pids(B) 不等於 {A} ⇒ 擋住 B 的不只(或不是)A,這格沒有判別力" ;;
  *)
    bad "barrier 方向甲:B 沒有被擋住($R)⇒ parent guard 的鎖原語沒有在工作" ;;
esac
barrier_residue_check 方向甲

R="$(barrier_run yi)"
case "$R" in
  "BLOCKED=true BLOCKER_IS_A=true UNBLOCKED=false TIMEDOUT=true")
    ok "🔴🔴 barrier 方向乙:A 先鎖住 parent 時,B **插品項**被擋、blockers 全等 {A},且 B 在 5 秒時被 guard 自己的 lock_timeout 中止(A 持鎖 12 秒)⇒ ①guard 這條路徑取得的是**會與 NKU 衝突的鎖** ②那道 5s 護欄是承重的、不會無限等。配合突變靶⑦(拿掉該子句後本格不再阻塞)⇒ 阻塞由 FOR NO KEY UPDATE 那個子句提供。🔴 誠實邊界:本格證明的是「該子句提供了阻塞」,**不是**「任何改寫都不可能先讀舊值再補鎖」—— 後者要靠 code review,測試構造不出來" ;;
  "BLOCKED=true BLOCKER_IS_A=true UNBLOCKED=true TIMEDOUT=false")
    bad "🔴 barrier 方向乙:B 竟然等到 A 結束才完成 ⇒ guard 的 SET lock_timeout=5s 沒有生效(A 持鎖 12 秒,B 應在 5 秒被中止)" ;;
  "BLOCKED=true "*)
    bad "barrier 方向乙:B 被擋住了,但 blockers 不等於 {A} ⇒ 量到的可能是別的鎖" ;;
  *)
    bad "barrier 方向乙:B 插品項沒有被擋住($R)⇒ guard 讀 parent 那條路徑沒有取得會與 NKU 衝突的鎖" ;;
esac
barrier_residue_check 方向乙

# 突變靶⑦:把 guard 的 FOR NO KEY UPDATE 換成普通 SELECT ⇒ **兩個方向都必須不再阻塞**。
# 🔴 本靶必須改到真的函式(兩個 session 都要看得見)⇒ 全程由上方的 EXIT trap 保護還原。
# 🔴 只刪鎖原語、**不可換成註解**:原文是 `FOR NO KEY UPDATE;`,換成 `-- …` 會把行尾那個
#    分號一起吃進註解 ⇒ SELECT 沒有終止符、下一行的 IF 變成語法錯誤,突變版根本沒 apply 成功
#    (memory `feedback_text-level-guard-blind-to-invalid-syntax`;下面那條 apply 檢查就是為此)。
MUT_DEF="$(echo "$GUARD_ORIG_DEF" | sed 's/FOR NO KEY UPDATE//')"
psql "$URL" -v ON_ERROR_STOP=1 -q -c "$MUT_DEF" >/dev/null
qs "SELECT pg_get_functiondef('public.pcm_b2_shipment_items_parent_guard()'::regprocedure)" | grep -q 'FOR NO KEY UPDATE' \
  && bad "🔴 突變靶⑦ **沒有 apply 成功**(函式裡仍有 FOR NO KEY UPDATE)⇒ 下面那格量的不是突變版" \
  || ok "突變靶⑦ apply 檢查:parent guard 的 FOR NO KEY UPDATE 確實已被移除"
R="$(barrier_run jia)"
case "$R" in
  "BLOCKED=false "*)
    ok "🔴🔴 突變靶⑦(方向甲):拿掉 FOR NO KEY UPDATE 後,B 的 UPDATE **不再被擋住** ⇒ 方向甲量的確實是 guard 的鎖原語(FK 的 KEY SHARE 不與 NO KEY UPDATE 衝突,提供不了這個觀察)" ;;
  *)
    bad "突變靶⑦(方向甲)沒重現($R)⇒ B 被擋住的原因可能不是 guard 那句鎖,這節沒有判別力" ;;
esac
R="$(barrier_run yi)"
case "$R" in
  "BLOCKED=false "*)
    ok "🔴🔴 突變靶⑦(方向乙):拿掉鎖原語後,B 插品項也不再被擋 ⇒ 方向乙量的確實是 guard 那句讀取的鎖定性" ;;
  *)
    bad "突變靶⑦(方向乙)沒重現($R)" ;;
esac
barrier_restore_guard
NOW_DEF="$(qs "SELECT pg_get_functiondef('public.pcm_b2_shipment_items_parent_guard()'::regprocedure)")"
[ "$NOW_DEF" = "$GUARD_ORIG_DEF" ] \
  && ok "突變靶⑦ 還原檢查:parent guard 定義已逐字還原(pg_get_functiondef 全等;另有 EXIT trap 保底)" \
  || bad "🔴🔴 突變靶⑦ **沒有還原**:parent guard 現在是突變版,DB 已被污染"
barrier_residue_check 突變版
echo
echo "════════ B2 S1b 驗證結果:PASS=$PASS / FAIL=$FAIL ════════"
[ "$FAIL" -eq 0 ] || exit 1
