#!/usr/bin/env bash
#
# B2 S1a-1 驗收:`public.shipments` 建表 + 10 條 CHECK + 索引 + ACL/RLS。
# 片級 plan = docs/specs/2026-08-05-e10-b2-shipments-db-plan.md(v5.4)§4 項 1-9b。
#
# 用法:
#   scripts/d1t2-rehearsal.sh provision <workdir>     # 先備庫(印出 D1_DB_URL)
#   scripts/b2s1a1-verify.sh <db-url>
#
# 🔴 為什麼吃 URL 而不是自己 provision(與 a1-verify 的形狀不同,刻意的):
#   d1t2 的 PORT 是**寫死**的(scripts/d1t2-rehearsal.sh:26)⇒ 多視窗並行時
#   後啟動的那個一定撞 port。吃 URL 讓本支可以掛在任何一個已備好的庫上。
#
# 證明:每一條斷言都有一個突變能單獨打紅它(§F 突變矩陣);
#   正測不只驗「沒噴錯」,凡是「應成功」的格子一律**回查值真的落庫**
#   (plan §4 項 16b:守門 RETURN NULL 會讓 UPDATE 變成 UPDATE 0、零錯誤 ⇒ 只看錯誤會假綠)。
#
# 🔴 v5.4(codex K2 #18):上面那句在 v5.3 是**假的** —— 本支當時只有 `expect_ok`(只看有無例外),
#    `expect_landed` 只寫在 S1a-2。本版補上 `expect_landed`,所有正測改用它。
# 🔴 v5.4(codex K2 #15):所有「應成功」的格子結尾一律 `SET CONSTRAINTS ALL IMMEDIATE`。
#    理由:S1b 的 X1 是 DEFERRED constraint trigger,而本支每格以 ROLLBACK 收尾
#    ⇒ 不強制的話 X1 **從頭到尾不會發火**,「已出貨零品項」這種在真 COMMIT 下必紅的 fixture
#    會假綠通過。(同型病本批在 S1b 抓到過,S1a 這邊當時沒回頭查。)
#
# 🔴 誠實邊界(codex K2-R3 nit):`SET CONSTRAINTS ALL IMMEDIATE` 會**當場跑掉延遲檢查**,
#    但它**不等於真 COMMIT** —— 真 COMMIT 還包含寫入可見性、其他交易的併發效應等。
#    本支證明的是「這個終態通得過所有延遲約束」,不是「它在正式站 commit 一定沒事」。
# 🔴 依賴邊界(codex K2-R3 must-fix):本支**已經不是純 S1a-1 的驗收** —— A8 正測與突變靶⑫
#    都要插 `shipment_items`(合法 fixture 的必要條件),A6 的 TRUNCATE 格也要連子表一起。
#    ⇒ 本支只能在**三片全套**的庫上跑;plan §4 項 37 的三個 cut point(逐片 apply 後續跑)
#    **本支不涵蓋、也不宣稱涵蓋**,那是另一條獨立驗收。
set -euo pipefail
# 🔴 在 cd 之前捕捉本檔絕對路徑:gate_wiring_check 要對原始碼做存在性斷言。
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="${1:-${D1_DB_URL:-}}"
[ -n "$URL" ] || { echo "🔴 用法:scripts/b2s1a1-verify.sh <db-url>"; exit 2; }
export LC_ALL=C

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $*"; }
log() { echo; echo "== $* =="; }

# 🔴 `|| true`:psql 對 parse error 會回非零,而本支是 set -e ⇒ 不加會在第一個負測就整支靜默退出
#    (實際踩過:輸出停在 "1/6" 標題、零錯誤訊息)。
q() { psql "$URL" -v ON_ERROR_STOP=0 -qtA -c "$1" 2>&1 || true; }
qs() { psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1"; }

# ── 🔴🔴 拋棄庫身分閘(v5.4;codex K2-R3 BLOCKER / K2-R4 / Fable F1)──────────────
# 🔴 本支的破壞面(v5.4-c F2 更正:先前這段是從 b2s1b 複製貼上、字面不對):
#    本支**全程 BEGIN/ROLLBACK、零 COMMIT** —— 但它仍會在交易內 `CREATE ROLE`、
#    `CREATE OR REPLACE` 守門函式、`DROP CONSTRAINT`(RLS 判別力格與突變矩陣)。
#    接錯庫雖然不留痕,那些 DDL 仍會**在該庫上真的跑一遍**;而且三支共用同一份閘、
#    形狀一致比較好維護 ⇒ 照樣擋。**真正會 COMMIT 的是 `b2s1b`(barrier fixture)。**
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

# 🔴 每一格都包在 BEGIN/ROLLBACK 裡:**成功的正測會留列**,不回滾的話
#    ①本支不可重跑(第二次跑會撞 shipment_reference 唯一鍵,實際踩過:四條正測全紅在 23505)
#    ②違反「零留痕」。負測本來就被 PL/pgSQL 的 EXCEPTION 子交易回掉,正測不會。
# 期望某段 SQL 紅在指定 SQLSTATE。用 DO + EXCEPTION 取 SQLSTATE,避免解析英文訊息。
expect_sqlstate() {
  local want="$1" sql="$2" label="$3" got
  got="$(q "BEGIN; DO \$\$ BEGIN $sql; RAISE EXCEPTION 'NO_ERROR_RAISED' USING ERRCODE='XX999';
           EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then
    ok "$label(${want})"
  elif [ -z "$got" ]; then
    # 🔴 拿不到 SQLSTATE = **測試自己壞了**(多半是 SQL 沒解析成功),不是守門沒擋。
    #    這兩件事必須分開報,否則一個寫壞的負測會被讀成「守門失效」而去改守門(實際踩過)。
    bad "$label — 🔴 測試自身異常(沒拿到 SQLSTATE):$(q "$sql" | head -2 | tr '\n' ' ')"
  else
    bad "$label — 期望 $want,實得 $got"
  fi
}

# 🔴 v5.4:正測一律用本函式 —— ①執行 ②`SET CONSTRAINTS ALL IMMEDIATE` 強制跑掉延遲檢查
#    ③用呼叫端給的 oracle 回查**值真的落庫**。三者缺一都會假綠(codex K2 #15/#18)。
expect_landed() {
  local sql="$1" oracle="$2" want="$3" label="$4" got
  got="$(q "BEGIN; DO \$\$ DECLARE v_got text; v_id uuid; BEGIN $sql
             SET CONSTRAINTS ALL IMMEDIATE;
             SELECT ($oracle)::text INTO v_got;
             RAISE NOTICE 'GOT:%', COALESCE(v_got,'<NULL>');
           EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOT:ERR:%', SQLSTATE; END \$\$; ROLLBACK;" \
        | sed -n 's/^NOTICE:  GOT:\(.*\)$/\1/p' | head -1)"
  if [ "$got" = "$want" ]; then ok "$label(oracle=$want;延遲約束已強制落地)"
  else bad "$label — 期望 oracle=$want,實得 ${got:-<無>}"; fi
}

# 🔴 v5.4:改從 orders 取客人 —— 已出貨的正測必須能加**該客人自己的**品項(A7 只認同客人),
#    從 customers 隨便取一位可能一張訂單都沒有,那些格會紅在 A7 而不是待測的守門。
CUST="$(qs "SELECT customer_user_id FROM public.orders GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;")"
[ -n "$CUST" ] || { echo "🔴 備庫裡沒有 orders 列,無法造 fixture"; exit 1; }
ITEM="$(qs "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.customer_user_id='$CUST' ORDER BY oi.id LIMIT 1;")"
[ -n "$ITEM" ] || { echo "🔴 該客人沒有 order_items,無法造合法的已出貨 fixture"; exit 1; }
# 🔴 用單引號、**不要用 `$$` dollar-quote**:整段 SQL 已經被外層的 `DO $$ … $$` 包住,
#    再用 `$$` 包 JSON 會提前結束外層引號(實際踩過:`syntax error at or near "{"`)。
SNAP="'{\"name\":\"王小明\",\"phone\":\"0900000000\",\"line\":\"lineid\"}'::jsonb"

log "0/6 前提:表在、本片產物齊"
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
qs "SELECT 1 FROM pg_class WHERE oid='public.shipments'::regclass" >/dev/null && ok "shipments 存在"
[ "$(qs "SELECT count(*) FROM pg_attribute WHERE attrelid='public.shipments'::regclass AND attnum>0 AND NOT attisdropped")" = "15" ] \
  && ok "15 欄" || bad "欄數不是 15"
[ "$(qs "SELECT count(*) FROM pg_constraint WHERE conrelid='public.shipments'::regclass AND contype='c'")" = "10" ] \
  && ok "10 條 CHECK" || bad "CHECK 數不是 10"

log "1/6 A1 產號格式與唯一(§4 項 2)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('ABC','$CUST',$SNAP,'hct')" "A1 三碼被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('B0DFGH','$CUST',$SNAP,'hct')" "A1 含 0 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGHJ','$CUST',$SNAP,'hct')" "A1 七碼被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('bcdfgh','$CUST',$SNAP,'hct')" "A1 小寫被擋"
expect_sqlstate 23505 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGH','$CUST',$SNAP,'hct'); INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGH','$CUST',$SNAP,'sf')" "A1 重複編號被擋"

log "2/6 A3 快遞值域與 carrier_note 雙向配對(§4 項 3;五格逐字寫死)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGJ','$CUST',$SNAP,'blackcat')" "A3 值域外被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGJ','$CUST',$SNAP,'other',NULL)" "A3 (other,NULL) 被擋 ← 突變靶④ 唯一抓得到的那格"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGJ','$CUST',$SNAP,'other','   ')" "A3 (other,純空白) 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGJ','$CUST',$SNAP,'hct','有值')" "A3 非 other 帶說明 被擋"
expect_landed "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGK','$CUST',$SNAP,'other','客人自取');" \
  "SELECT count(*) FROM public.shipments WHERE shipment_reference='BCDFGK'" "1" "A3 判別力正測(other+說明)"
expect_landed "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGM','$CUST',$SNAP,'hct');" \
  "SELECT count(*) FROM public.shipments WHERE shipment_reference='BCDFGM'" "1" "A3 判別力正測(hct+無說明)"
# 🔴 v5.4(codex K2 #6 的判別力正測):tab / 全形空格當說明必須被擋 —— 這兩格是
#    `btrim`→`pcm_b2_is_blank` 那條修法唯一的證明。舊寫法只有 '   '(ASCII 空格)那格,
#    而 `btrim` 本來就擋得住 ASCII 空格 ⇒ 修法有沒有生效,舊 harness 分不出來。
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGN','$CUST',$SNAP,'other',E'\t')" "A3 (other, tab) 被擋 ← btrim 舊寫法會放行"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGN','$CUST',$SNAP,'other',U&'\3000')" "A3 (other, 全形空格) 被擋 ← \\s 也擋不住的那個" 

log "3/6 A4 收件快照形狀 / A9 狀態值域 / X4-X7(§4 項 4/6/7)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGN','$CUST','{\"name\":\"a\",\"phone\":\"b\"}'::jsonb,'hct')" "A4 缺鍵被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGN','$CUST','{\"name\":\"a\",\"phone\":\"b\",\"line\":\"c\",\"cost\":\"9\"}'::jsonb,'hct')" "A4 多鍵被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGN','$CUST','{\"name\":{\"x\":\"1\"},\"phone\":\"b\",\"line\":\"c\"}'::jsonb,'hct')" "A4 值非字串被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status) VALUES ('BCDFGN','$CUST',$SNAP,'hct','delivered')" "A9 delivered 被擋(U7 無此值)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status) VALUES ('BCDFGN','$CUST',$SNAP,'hct','banana')" "A9 值域外被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status) VALUES ('BCDFGN','$CUST',$SNAP,'hct','submitted')" "X4 submitted 無 request_id 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status,hct_request_id) VALUES ('BCDFGN','$CUST',$SNAP,'sf','submitted','R1')" "X5 非 hct 卻 submitted 被擋(⚠️ 本格同時違反 X6,對 X5 零判別力 —— 見下一格)"
# 🔴 v5.4(codex K2 #20,夜跑實測):上一格帶了 hct_request_id='R1' ⇒ **同時違反 X6**
#    (非 hct 不得帶證據欄)。實測 `DROP CONSTRAINT shipments_hct_status_carrier`(X5)後
#    該格**仍紅在 23514**(來自 X6)⇒ 它證明不了 X5 存在。
#    本格 = X5 專屬:`sf + failed + 零 hct 證據` ⇒ X6 被滿足,唯一被違反的只有 X5。
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status) VALUES ('BCDFGN','$CUST',$SNAP,'sf','failed')" "🔴 X5 專屬格:sf + failed + 零證據(只違反 X5)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_request_id) VALUES ('BCDFGN','$CUST',$SNAP,'sf','R1')" "X6 非 hct 帶證據欄 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,void_reason) VALUES ('BCDFGN','$CUST',$SNAP,'hct','有理由沒時間')" "X7 只有 void_reason 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,deleted_at) VALUES ('BCDFGN','$CUST',$SNAP,'hct',now())" "X7 只有 deleted_at 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,deleted_at,void_reason) VALUES ('BCDFGN','$CUST',$SNAP,'hct',now(),'   ')" "X7 理由純空白 被擋"

log "4/6 A8 追蹤號軸 + A5 partial unique(§4 項 5;F11)"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,shipped_at) VALUES ('BCDFGP','$CUST',$SNAP,'hct',now())" "A8 hct 出貨無單號 被擋"
expect_sqlstate 23514 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,shipped_at,tracking_number) VALUES ('BCDFGP','$CUST',$SNAP,'sf',now(),'   ')" "A8 sf 出貨單號純空白 被擋"
# 🔴 v5.4(codex K2 #15):原格是「一筆 INSERT 直接帶 shipped_at、零品項」——
#    那在三片齊全的世界 **commit 不了**(X1 會擋),它看似通過只因每格 ROLLBACK、X1 從未發火。
#    改成合法順序:建草稿 → 加品項 → 出貨 → 強制 deferred。
expect_landed "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note) VALUES ('BCDFGQ','$CUST',$SNAP,'other','客人自取') RETURNING id INTO v_id;
  INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM',1);
  UPDATE public.shipments SET shipped_at=now() WHERE id=v_id;" \
  "SELECT shipped_at IS NOT NULL FROM public.shipments WHERE shipment_reference='BCDFGQ'" "true" \
  "A8 判別力正測:other 無單號可出貨(合法品項 + 強制 X1)"
expect_sqlstate 23505 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_request_id) VALUES ('BCDFGR','$CUST',$SNAP,'hct','DUP'); INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_request_id) VALUES ('BCDFGS','$CUST',$SNAP,'hct','DUP')" "A5 request_id 重複 被擋"
expect_landed "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGT','$CUST',$SNAP,'hct'); INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGV','$CUST',$SNAP,'hct');" \
  "SELECT count(*) FROM public.shipments WHERE shipment_reference IN ('BCDFGT','BCDFGV')" "2" "A5 判別力正測:兩列 request_id 皆 NULL"

log "5/6 A6 永不硬刪 + ACL/RLS(§4 項 8/9/9b)"
expect_sqlstate P0001 "INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES ('BCDFGW','$CUST',$SNAP,'hct'); DELETE FROM public.shipments WHERE shipment_reference='BCDFGW'" "A6 owner DELETE 被擋"
# 🔴 **S1b 落地後必須連 shipment_items 一起 TRUNCATE**,否則紅在 FK 的 `0A000`
#    (feature_not_supported:被 FK 參照的表不能單獨 TRUNCATE)而**到不了** block trigger 的 P0001。
#    守門本身沒壞,是被新 FK **降級成觀察不到** —— 這正是
#    memory `feedback_new-fk-can-demote-an-existing-guard-to-unobservable` 記過的形狀,
#    本批內部就真的復現了一次(S1a-1 的 harness 在 S1b apply 後由綠轉紅)。
expect_sqlstate P0001 "TRUNCATE public.shipments, public.shipment_items" "A6 owner TRUNCATE 被擋(需連品項表一起,見上方註解)"
# 🔴 v5.4(codex K2 #21,夜跑實測):上一格只驗 SQLSTATE ⇒ **歸因錯人**。
#    實測 `DROP TRIGGER shipments_block_truncate_bt`(父表那支)後,同一句 TRUNCATE
#    **仍紅在 P0001**,但訊息來自**子表**的 append-only。⇒ 父表那支有沒有在工作,上一格分不出來。
#    本格改驗訊息歸因:必須是 shipments 那支的字面。
GOT="$(q "BEGIN; DO \$\$ BEGIN TRUNCATE public.shipments, public.shipment_items;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MSG:%', SQLERRM; END \$\$; ROLLBACK;")"
if echo "$GOT" | grep -q '包裹永不硬刪'; then
  ok "🔴 A6 TRUNCATE 歸因:紅在 shipments 自己那支 block trigger(非子表代打)"
else
  bad "A6 TRUNCATE 歸因失準 — 期望 shipments 的『包裹永不硬刪』,實得:$(echo "$GOT" | grep MSG | head -1)"
fi
[ "$(qs "SELECT relrowsecurity FROM pg_class WHERE oid='public.shipments'::regclass")" = "t" ] && ok "RLS 已啟用" || bad "RLS 未啟用"
[ "$(qs "SELECT count(*) FROM pg_policy WHERE polrelid='public.shipments'::regclass")" = "0" ] && ok "zero-policy" || bad "不是 zero-policy"
[ "$(qs "SELECT relforcerowsecurity FROM pg_class WHERE oid='public.shipments'::regclass")" = "f" ] \
  && ok "未 FORCE RLS(S1b 的 owner 守門才讀得到)" || bad "FORCE RLS 被打開 — S1b 守門會誤殺合法包裹"
[ "$(qs "SELECT has_table_privilege('service_role','public.shipments','SELECT')")" = "t" ] && ok "service_role 有 SELECT" || bad "service_role 缺 SELECT"
[ "$(qs "SELECT has_table_privilege('service_role','public.shipments','INSERT') OR has_table_privilege('service_role','public.shipments','UPDATE') OR has_table_privilege('service_role','public.shipments','DELETE')")" = "f" ] \
  && ok "service_role 只有 SELECT" || bad "service_role 有寫入權 — 本批應零 writer"
[ "$(qs "SELECT has_table_privilege('anon','public.shipments','SELECT') OR has_table_privilege('authenticated','public.shipments','SELECT')")" = "f" ] \
  && ok "client 角色零權限" || bad "client 角色讀得到包裹"
# 🔴 v5.4(codex K2 nit 6 / K2-R2 nit 1):`has_table_privilege` 在 superuser 連線下對 owner 面
#    零判別力(見下一節的 🟡)⇒ 補一格**真的換身分**的行為觀察。S1b 那支的 INSERT 行為格
#    只涵蓋 shipment_items,不能代替 shipments 自己這一面。
NONOWNER="$(q "BEGIN; SET LOCAL ROLE service_role;
  DO \$\$ BEGIN DELETE FROM public.shipments WHERE shipment_reference='NOPE99';
    RAISE NOTICE 'NONOWNER:ALLOWED';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'NONOWNER:%', SQLSTATE; END \$\$; ROLLBACK;")"
echo "$NONOWNER" | grep -q 'NONOWNER:42501' \
  && ok "🔴 非 owner 行為格:service_role 真的以該身分 DELETE shipments → 被拒(42501),不是只查 catalog" \
  || bad "非 owner 行為格失準 — 期望 42501,實得:$(echo "$NONOWNER" | grep NONOWNER | head -1)"

log "6/6 🔴 RLS 判別力(v5.4 重寫:改用**有資料**的 fixture 做成對紅綠;plan §4 項 9)"
# 🔴 v5.4(codex K2 #5,上一棒自己標為成立):v5.3 這格在**空表**上只查 `count(*)=0`,
#    而空表在 FORCE 開與不開之下**都是 0** ⇒ 整格恆真、零判別力
#    (memory `feedback_fixture-value-makes-guard-vacuous` 的同型)。
#    本版改成:先塞一筆真資料,再對同一位非 superuser owner 做**成對**觀察 ——
#      FORCE 開 ⇒ owner 自己也讀到 **0**(被 zero-policy 擋)
#      FORCE 關 ⇒ owner 讀到 **1**(前提②成立時守門才讀得到)
#    兩個方向都對,這格才有判別力;任一方向不符即 FAIL。
IS_SUPER="$(qs "SELECT rolsuper FROM pg_roles WHERE rolname=current_user")"
[ "$IS_SUPER" = "t" ] && echo "  🟡 連線身分是 superuser ⇒ 前一節的 has_table_privilege 斷言在本庫零判別力(已知事實);本節用非 superuser owner 補回判別力"

rls_probe() {  # $1 = force(on/off);回傳 owner 身分讀到的列數
  q "BEGIN;
    INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code)
      VALUES ('BCDFGZ','$CUST',$SNAP,'hct');
    CREATE ROLE b2_tbl_owner NOSUPERUSER NOBYPASSRLS;
    ALTER TABLE public.shipments OWNER TO b2_tbl_owner;
    $( [ "$1" = "on" ] && echo 'ALTER TABLE public.shipments FORCE ROW LEVEL SECURITY;' )
    SET LOCAL ROLE b2_tbl_owner;
    SELECT 'RLSCNT=' || count(*)::text FROM public.shipments;
  ROLLBACK;" | sed -n 's/^RLSCNT=\(.*\)$/\1/p' | head -1
}
FORCE_ON="$(rls_probe on)"
FORCE_OFF="$(rls_probe off)"
if [ "$FORCE_ON" = "0" ] && [ "$FORCE_OFF" = "1" ]; then
  ok "🔴 RLS 成對紅綠:非 superuser owner 之下 FORCE 開=讀到 0 列 / FORCE 關=讀到 1 列 ⇒ 前提②「不得 FORCE」有真實後果、本格有判別力"
else
  bad "RLS 判別力格失準 — 期望 (FORCE 開=0, FORCE 關=1),實得 (開=${FORCE_ON:-<無>}, 關=${FORCE_OFF:-<無>})"
fi

# 🔴 v5.4(codex K2 #5 後半):不只驗 table owner —— 兩支 SECURITY DEFINER 守門是以**函式 owner**
#    身分起跑的,函式 owner 與表 owner 不一致時,S1b 的守門會讀不到 parent 而誤判。
SECDEF_MISALIGNED="$(qs "SELECT count(*) FROM pg_proc p
  WHERE p.oid IN ('public.pcm_b2_shipment_items_parent_guard()'::regprocedure,
                  'public.pcm_b2_shipments_items_presence()'::regprocedure)
    AND p.proowner <> (SELECT relowner FROM pg_class WHERE oid='public.shipments'::regclass)")"
[ "$SECDEF_MISALIGNED" = "0" ] \
  && ok "兩支 SECDEF 守門的函式 owner = 表 owner(SECDEF 以函式 owner 起跑 ⇒ 這條是承重的)" \
  || bad "有 $SECDEF_MISALIGNED 支 SECDEF 守門的 owner 與表 owner 不一致 — 守門會讀不到 parent"

log "F 突變矩陣(每條斷言要有一個突變能單獨打紅它)"
# 突變靶④:拿掉 A3 的 COALESCE ⇒ (other, NULL) 應該從「被擋」變成「寫得進去」。
MUT="$(q "BEGIN;
  ALTER TABLE public.shipments DROP CONSTRAINT shipments_carrier_note_pair;
  ALTER TABLE public.shipments ADD CONSTRAINT shipments_carrier_note_pair
    CHECK ((carrier_code = 'other') = (pg_catalog.btrim(carrier_note) <> ''));
  INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note)
  VALUES ('ZZZZZZ','$CUST',$SNAP,'other',NULL);
  SELECT 'MUTANT_ACCEPTED_ROWS=' || count(*)::text FROM public.shipments WHERE shipment_reference='ZZZZZZ';
ROLLBACK;")"
if echo "$MUT" | grep -q 'MUTANT_ACCEPTED_ROWS=1'; then
  ok "突變靶④:拿掉 COALESCE 後 (other,NULL) 真的寫得進去 ⇒ 該格有判別力、修法不是裝飾"
else
  bad "突變靶④ 沒有重現(拿掉 COALESCE 仍被擋?)⇒ 該格可能量錯東西:$(echo "$MUT" | tail -2 | tr '\n' ' ')"
fi


# ── 🔴 v5.4 新增突變靶(每個新斷言都要有一個突變能單獨打紅它;plan §4 項 35)──

# 靶⑧:拿掉 X5 ⇒ 「X5 專屬格」必須從『被擋』變成『寫得進去』(證明該格真的在量 X5,不是 X6 代打)
MUT="$(q "BEGIN;
  ALTER TABLE public.shipments DROP CONSTRAINT shipments_hct_status_carrier;
  INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,hct_status)
  VALUES ('ZZZZZY','$CUST',$SNAP,'sf','failed');
  SELECT 'MUT8_ACCEPTED=' || count(*)::text FROM public.shipments WHERE shipment_reference='ZZZZZY';
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT8_ACCEPTED=1' \
  && ok "突變靶⑧:拿掉 X5 後 sf+failed 真的寫得進去 ⇒ X5 專屬格有判別力(舊的合併格做不到這件事)" \
  || bad "突變靶⑧ 沒重現:$(echo "$MUT" | tail -2 | tr '\n' ' ')"

# 靶⑨:拿掉**父表**的 truncate trigger ⇒ TRUNCATE 歸因格必須紅(訊息改由子表發出)
MUT="$(q "BEGIN;
  DROP TRIGGER shipments_block_truncate_bt ON public.shipments;
  DO \$\$ BEGIN TRUNCATE public.shipments, public.shipment_items;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT9:%', SQLERRM; END \$\$;
ROLLBACK;")"
if echo "$MUT" | grep -q 'MUT9:.*append-only'; then
  ok "突變靶⑨:拿掉父表 truncate trigger 後,錯誤改由**子表**發出(append-only)⇒ 歸因格抓得到、只驗 SQLSTATE 抓不到"
elif echo "$MUT" | grep -q 'MUT9:.*永不硬刪'; then
  bad "突變靶⑨ 沒重現 — 父表 trigger 已拿掉卻仍是父表訊息?"
else
  bad "突變靶⑨ 執行異常:$(echo "$MUT" | grep MUT9 | head -1)"
fi

# 靶⑩:把 pcm_b2_is_blank 退回 btrim 語意 ⇒ tab 那格必須從『被擋』變成『寫得進去』
MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_is_blank(t text) RETURNS boolean
    LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
    AS \$m\$ SELECT pg_catalog.btrim(COALESCE(t,'')) = '' \$m\$;
  INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note)
  VALUES ('ZZZZZX','$CUST',$SNAP,'other',E'\t');
  SELECT 'MUT10_ACCEPTED=' || count(*)::text FROM public.shipments WHERE shipment_reference='ZZZZZX';
ROLLBACK;")"
echo "$MUT" | grep -q 'MUT10_ACCEPTED=1' \
  && ok "突變靶⑩:helper 退回 btrim 後,一個 tab 真的能冒充『有說明』寫進去 ⇒ #6 的修法不是裝飾" \
  || bad "突變靶⑩ 沒重現(退回 btrim 竟仍被擋?)⇒ tab 那格可能量錯東西:$(echo "$MUT" | tail -2 | tr '\n' ' ')"

# 靶⑪:把 A5 索引改建在錯的欄位 ⇒ 定義全等斷言必須紅(v5.3 只驗名稱+is-partial,改錯欄位仍全綠)
MUT="$(q "BEGIN;
  DROP INDEX public.shipments_hct_request_id_key;
  CREATE UNIQUE INDEX shipments_hct_request_id_key ON public.shipments (shipment_reference) WHERE shipment_reference IS NOT NULL;
  SELECT 'MUT11_DEF=' || pg_get_indexdef('public.shipments_hct_request_id_key'::regclass);
ROLLBACK;")"
if echo "$MUT" | grep -q 'MUT11_DEF=.*btree (shipment_reference)'; then
  ok "突變靶⑪:索引改建在 shipment_reference 上,定義字串確實改變 ⇒ pg_get_indexdef 全等斷言抓得到(舊的『名稱存在+is-partial』抓不到)"
else
  bad "突變靶⑪ 沒重現:$(echo "$MUT" | grep MUT11 | head -1)"
fi

# 靶⑫:把 X2 守門改成 `RETURN NULL` ⇒ A8 正測的 UPDATE 被**靜默吞掉**、shipped_at 留在 NULL。
# 🔴 本靶是 `expect_landed` 這個機制本身的判別力證明(codex K2 #18):
#    舊的 `expect_ok` 只看「有沒有噴錯」,而 BEFORE 守門 `RETURN NULL` 會讓 UPDATE 變成
#    `UPDATE 0`、**零錯誤** ⇒ 舊寫法在這個突變下照樣全綠。沒有這一靶,#18 的修法等於沒被證明。
MUT="$(q "BEGIN;
  CREATE OR REPLACE FUNCTION public.pcm_b2_shipments_write_once() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS \$m\$ BEGIN RETURN NULL; END \$m\$;
  DO \$\$ DECLARE v_id uuid; v_got text; BEGIN
    INSERT INTO public.shipments (shipment_reference,customer_user_id,recipient_snapshot,carrier_code,carrier_note)
      VALUES ('ZZZZZW','$CUST',$SNAP,'other','客人自取') RETURNING id INTO v_id;
    INSERT INTO public.shipment_items (shipment_id,order_item_id,shipped_quantity) VALUES (v_id,'$ITEM',1);
    UPDATE public.shipments SET shipped_at=now() WHERE id=v_id;
    SELECT (shipped_at IS NOT NULL)::text INTO v_got FROM public.shipments WHERE id=v_id;
    RAISE NOTICE 'MUT12:%', v_got;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MUT12:ERR:%', SQLSTATE; END \$\$;
ROLLBACK;")"
if echo "$MUT" | grep -q 'MUT12:false'; then
  ok "突變靶⑫:X2 守門改 RETURN NULL 後,出貨的 UPDATE 被靜默吞掉(shipped_at 仍 NULL、零錯誤)⇒ expect_landed 的回查 oracle 抓得到,舊的 expect_ok 抓不到"
elif echo "$MUT" | grep -q 'MUT12:true'; then
  bad "突變靶⑫ 沒重現 — 守門改 RETURN NULL 之下 shipped_at 竟仍落庫?請重查 PG BEFORE trigger 語意"
else
  bad "突變靶⑫ 執行異常:$(echo "$MUT" | grep MUT12 | head -1)"
fi

# ── 結構斷言(harness 端重跑一次 migration DO 的關鍵集合;DO 只在 apply 當下跑過一次)──
ACTUAL_CONS="$(qs "SELECT string_agg(conname,',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.shipments'::regclass AND contype IN ('p','u','f','c')")"
[ "$ACTUAL_CONS" = "shipments_carrier_domain,shipments_carrier_note_pair,shipments_customer_user_id_fkey,shipments_hct_evidence_carrier,shipments_hct_status_carrier,shipments_hct_status_domain,shipments_hct_submitted_evidence,shipments_pkey,shipments_recipient_snapshot_shape,shipments_reference_format,shipments_reference_unique,shipments_shipped_needs_tracking,shipments_void_pair" ] \
  && ok "約束集合雙向(13 條含 FK;多一條少一條都紅)" || bad "約束集合不符:$ACTUAL_CONS"
[ "$(qs "SELECT pg_get_indexdef('public.shipments_hct_request_id_key'::regclass)")" \
  = "CREATE UNIQUE INDEX shipments_hct_request_id_key ON public.shipments USING btree (hct_request_id) WHERE (hct_request_id IS NOT NULL)" ] \
  && ok "A5 索引定義全等(欄位+唯一性+partial 一次釘死)" || bad "A5 索引定義不符"
[ "$(qs "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname LIKE 'pcm_b2_%' AND a.grantee <> p.proowner")" = "0" ] \
  && ok "🔴 八支 B2 函式除 owner 外零 grantee(shim 的具名 default grant 已被 REVOKE 收掉)" \
  || bad "仍有非 owner grantee — REVOKE 只寫 FROM PUBLIC 擋不掉 anon/authenticated/service_role"
# 🔴🔴 v5.4(codex K2-R2 D1):上面那條**單獨用會有恆真的一角** —— `proacl IS NULL` 代表
#    「使用預設 ACL」(對函式而言預設**包含 PUBLIC EXECUTE**),而 `aclexplode(NULL)` 回**零列**
#    ⇒ REVOKE 若被整條刪掉、且該庫的 default privileges 是原廠值,上面那條會**靜默全綠**。
#    本庫實測 proacl 全部非 NULL(shim 設過 default privileges)⇒ 今天不會踩到;
#    但正式站的 default privileges 未必相同 ⇒ 補兩道:①proacl 不得為 NULL
#    ②直接問**行為**(`has_function_privilege`),它不受 NULL 表示法影響。
[ "$(qs "SELECT count(*) FROM pg_proc WHERE proname LIKE 'pcm_b2_%' AND proacl IS NULL")" = "0" ] \
  && ok "🔴 八支函式的 proacl 皆非 NULL(NULL = 走預設 ACL = PUBLIC 有 EXECUTE,且 aclexplode 看不見)" \
  || bad "有函式 proacl 為 NULL — 上一條的零 grantee 斷言在它身上是恆真的"
[ "$(qs "SELECT count(*) FROM pg_proc p, unnest(ARRAY['public','anon','authenticated','service_role']) r
          WHERE p.proname LIKE 'pcm_b2_%' AND has_function_privilege(r, p.oid, 'EXECUTE')")" = "0" ] \
  && ok "🔴 行為面:public/anon/authenticated/service_role 對八支函式**實際上**都沒有 EXECUTE(不靠 catalog 表示法)" \
  || bad "有角色實際執行得了 B2 函式:$(qs "SELECT string_agg(p.oid::regprocedure::text || '←' || r, ', ') FROM pg_proc p, unnest(ARRAY['public','anon','authenticated','service_role']) r WHERE p.proname LIKE 'pcm_b2_%' AND has_function_privilege(r, p.oid, 'EXECUTE')")"


log "G B2-S2b 回歸格(項 25a;2026-08-07 S2b-4c 加)"
# 🔴 本格的用途 = **S1 這一側的回歸點**:大線 B2-S2b 在 `shipments` 上掛了一支重算 trigger,
#    它的結構(事件面 / 逐欄 / 是否可延遲 / 指向哪支函式)全部都是本線論證的前提。
#    哪天有人改了它而只跑 S1 harness,這一格要當場紅。
TD_SUMMARY_FROZEN='CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac AFTER UPDATE OF shipped_at, deleted_at ON public.shipments NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION pcm_a4a_shipments_summary_recompute()'
# 🔴 R2 F2:同一輪在 25b 修過的兩件事要回灌到這裡,不要同片留兩種寫法 ——
#    ①`coalesce(pg_get_triggerdef(oid),…)` 在**零列**時根本不會求值 ⇒「<不存在>」是死碼、變數變空字串,
#      「不存在」與「被改成別的」分不出來;改成子查詢形,COALESCE 才吃得到 NULL。
#    ②加 `tgrelid` 過濾 —— 只用 tgname 時,同名 trigger 掛在別表會回兩列。
TD_SUMMARY_NOW="$(qs "SELECT coalesce((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.shipments'::regclass AND tgname='shipments_summary_recompute_ac' AND NOT tgisinternal), '<不存在>')")"
[ "$TD_SUMMARY_NOW" = "$TD_SUMMARY_FROZEN" ] \
  && ok "🔴 項25a:B2-S2b 的 shipments 重算 trigger 存在且 triggerdef **逐字**相符(事件面 / UPDATE OF 兩欄 / NOT DEFERRABLE / 指向 pcm_a4a_shipments_summary_recompute)" \
  || bad "項25a:重算 trigger 的 triggerdef 與凍結值不符 — 實得 [$TD_SUMMARY_NOW]"

# 🔴🔴 **plan 指定的靶「改 `tgtype` 成 BEFORE」構造不出來**(2026-08-07 實測,與環境A 矩陣同一件事):
#    PG 的文法**不接受** `CREATE CONSTRAINT TRIGGER … BEFORE` —— 實跑 `syntax error at or near "BEFORE"`。
#    ⇒ 換成**打同一個面(tgtype)而且構造得出**的靶:**多掛一個 INSERT 事件面**。
MUT="$(q "BEGIN;
  DROP TRIGGER shipments_summary_recompute_ac ON public.shipments;
  CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac
    AFTER INSERT OR UPDATE OF shipped_at, deleted_at ON public.shipments
    NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
    EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();
  SELECT 'MUTANT_TD=' || pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='shipments_summary_recompute_ac' AND NOT tgisinternal;
ROLLBACK;")"
MUT_TD="$(printf '%s' "$MUT" | sed -n 's/^MUTANT_TD=//p' | head -1)"
if [ -n "$MUT_TD" ] && [ "$MUT_TD" != "$TD_SUMMARY_FROZEN" ]; then
  ok "項25a 靶:多掛 INSERT 事件面之後 triggerdef 真的變了 ⇒ 上面那格對 tgtype 有判別力(不是只看名字在不在)"
else
  bad "項25a 靶沒有重現(突變後 triggerdef 竟然沒變或抓不到)⇒ 該格可能量錯東西:$(printf '%s' "$MUT" | tail -2 | tr '\n' ' ')"
fi

echo
echo "════════ B2 S1a-1 驗證結果:PASS=$PASS / FAIL=$FAIL ════════"
[ "$FAIL" -eq 0 ] || exit 1
