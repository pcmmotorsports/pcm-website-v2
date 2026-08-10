#!/usr/bin/env bash
# ============================================================
# #352-a2 驗證 harness —— 到貨登錄 / 刪除兩支 RPC
# ============================================================
# 規格 = docs/specs/2026-08-10-352-receipt-recording-plan-v3.md §3(RPC)、§7(驗收)
# 用法:PORT=54352 bash scripts/d1t2-rehearsal.sh provision /tmp/352a2-work
#       PORT=54352 bash scripts/352a2-verify.sh /tmp/352a2-work
# 形狀照 a5a-verify.sh / a2b1-verify.sh:身分閘 + 計數器 + 全程 BEGIN…ROLLBACK 零留痕
#       + DB 內突變(每發**先證突變真的套上了**才談紅綠)。
#
# ══ 三種格,計數分開,收尾四道閘 ═══════════════════════════
#   PASS/FAIL —— 一般格。   MUT —— 突變靶。
#   **PEND**  —— 🟡 留白格:規格已知、答案還在人手上,不可當通過、也不可靜默消失。
#                收尾要求 PEND == EXPECTED_PEND;留白被刪 ⇒ 紅,新題沒登記 ⇒ 紅。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/352a2-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54352}/postgres"
MIG_A1="supabase/migrations/20260810230000_m4b_e10_352a1_receipt_recording_schema.sql"
MIG_A2="supabase/migrations/20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql"
FN_RECORD="public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)"
FN_DELETE="public.admin_delete_item_receipt(uuid,text,text)"
SPOT="00000000-0000-4000-8000-000000000352"

PASS=0; FAIL=0; MUT=0; MUT_BAD=0; PEND=0
EXPECTED_TOTAL=39
EXPECTED_MUT=9
EXPECTED_PEND=0

ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
pend() { PEND=$((PEND+1)); printf '  PEND %s\n' "$1"; }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘 ───────────────────────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIG_A1" || { echo "🔴 $MIG_A1 不存在;拒跑"; exit 1; }
test -f "$MIG_A2" || { echo "🔴 $MIG_A2 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;紅色判定依賴英文 ERROR 前綴;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_class WHERE oid='public.order_item_receipt_requests'::regclass")" = "1" ] \
  || { echo "🔴 a1 的冪等帳表不在;先套 a1"; exit 1; }
for FN in "$FN_RECORD" "$FN_DELETE"; do
  [ "$(q "SELECT count(*) FROM pg_proc WHERE oid = '$FN'::regprocedure" 2>/dev/null)" = "1" ] \
    || { echo "🔴 RPC 不在:$FN ⇒ 拒跑、不吐綠(骨架在被驗對象不存在時吐綠才是故障)"; exit 1; }
done

# ── fixture:交易內建一個「從沒被採購過」的品項 + 一列現貨採購 ──
# 🔴 **必須 LEFT JOIN 摘要表**:A4a 惰性建列 ⇒ 從沒被採購過的品項根本沒有摘要列,
#    用 INNER JOIN 會讓候選集合恆空、整份 harness 靜默跑不到東西(a1 探針踩過同一個坑)。
FIX="
  SELECT oi.id, oi.quantity INTO v_item, v_qty
    FROM public.order_items oi
    LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = oi.id
   WHERE oi.quantity >= 1
     AND coalesce(q.ordered_quantity,0)=0 AND coalesce(q.cancelled_quantity,0)=0
     AND coalesce(q.instock_quantity,0)=0
   ORDER BY oi.id LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION 'fixture 取不到可用品項(前提不足,本格無判別力)'; END IF;
  INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id, reply_status)
  VALUES (v_proc, v_item, v_qty, '$SPOT', 'confirmed');
"
DECL="DECLARE v_item uuid; v_qty int; v_proc uuid := gen_random_uuid(); v_r text; v_rid uuid; v_n bigint; v_ship uuid; v_ord uuid; v_i3 uuid; v_p3 uuid;"

# cell <label> <body>  —— body 內用 RAISE 表示失敗;全程 BEGIN…ROLLBACK
cell() {
  local label="$1" body="$2" out
  out=$(psql "$URL" -qtAX <<SQL 2>&1
BEGIN;
DO \$c\$ $DECL BEGIN
$FIX
$body
END \$c\$;
ROLLBACK;
SQL
)
  if echo "$out" | grep -q 'ERROR:'; then bad "$label — $(echo "$out" | grep -m1 'ERROR:' | sed 's/^.*ERROR:  //' | cut -c1-90)"
  else ok "$label"; fi
}

# sql_cell <label> <純 SQL 斷言(回 boolean,false ⇒ 紅)>
sql_cell() {
  local label="$1" expr="$2" got
  got=$(q "SELECT ($expr)::text")
  if [ "$got" = "true" ]; then ok "$label"; else bad "$label — 斷言為 $got"; fi
}

# mut <label> <landed 斷言 SQL> <期望值> <突變 SQL> <被期望變紅的格 body>
#   🔴 先證「突變真的套上了」,再看那一格是否翻紅。兩者缺一不可。
mut() {
  local label="$1" landed="$2" expect="$3" mutate="$4" probe="$5" out l
  MUT=$((MUT+1))
  out=$(psql "$URL" -qtAX <<SQL 2>&1
BEGIN;
$mutate
\echo '--L--'
SELECT ($landed)::text;
\echo '--P--'
DO \$c\$ $DECL BEGIN
$FIX
$probe
END \$c\$;
ROLLBACK;
SQL
)
  l=$(echo "$out" | sed -n '/--L--/,/--P--/p' | sed '1d;$d' | tr -d ' \n')
  if [ "$l" != "$expect" ]; then MUT_BAD=$((MUT_BAD+1)); printf '  FAIL [MUT] %s — 突變沒套上(landed=%s 預期 %s)\n' "$label" "$l" "$expect"; return; fi
  if echo "$out" | grep -q 'ERROR:'; then printf '  ok   [MUT] %s — 套上✓ 對應格翻紅✓\n' "$label"
  else MUT_BAD=$((MUT_BAD+1)); printf '  FAIL [MUT] %s — 套上✓ 但對應格沒紅(該守門恆真!)\n' "$label"; fi
}

echo "── #352-a2 驗收 ──────────────────────────────────────────"

# ══ A 區:結構 ═════════════════════════════════════════════
sql_cell "A1 兩支皆 SECDEF + search_path 逐字" \
  "(SELECT count(*) FROM pg_proc WHERE oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure)
      AND prosecdef AND array_to_string(proconfig,',')='search_path=public, pg_temp') = 2"
sql_cell "A2 EXECUTE 恰 service_role 且【不可轉授】" \
  "(SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure)
       AND a.grantee='service_role'::regrole::oid AND a.privilege_type='EXECUTE' AND a.is_grantable=false) = 2
   AND (SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure)
       AND a.grantee <> p.proowner
       AND NOT (a.grantee='service_role'::regrole::oid AND a.privilege_type='EXECUTE' AND a.is_grantable=false)) = 0"
sql_cell "A3 取鎖序:proc 的 NKU 在 order_items 的 NKU 之前" \
  "(SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'FROM public.order_item_procurement WHERE id = v_rec.procurement_id FOR NO KEY UPDATE')
    < strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'FROM public.order_items WHERE id = v_item FOR NO KEY UPDATE')
    FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure)"
# ⚠️ opus nit12:A4 是**存在性**斷言 —— 把 `IMMEDIATE` 改成 `DEFERRED` 它照樣綠。
#    **效果面的判別力在 F1 那格**(呼叫端先 DEFERRED,守門仍要擋得住);兩格一起看才完整。
sql_cell "A4 SET CONSTRAINTS 只在 delete、record 沒有(存在性;效果面看 F1)" \
  "(SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'SET CONSTRAINTS')>0 FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure)
   AND (SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'SET CONSTRAINTS')=0 FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure)"
sql_cell "A5 冪等帳仍為零 FK(plan §4 鎖序論證的前提)" \
  "(SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_receipt_requests'::regclass AND contype='f')=0"

# ══ B 區:登錄正向 ═════════════════════════════════════════
cell "B1 一般到貨 ⇒ received/instock 同步上升(A4a 級聯真的跑了)" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'b1-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'B1 回 %', v_r; END IF;
  IF (SELECT received_quantity FROM public.order_item_procurement WHERE id=v_proc) <> v_qty
     OR (SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id=v_item) <> v_qty
  THEN RAISE EXCEPTION 'B1 received/instock 沒跟上'; END IF;"
cell "B2 溢收 0/N 寫得進、且 received·instock【不變】" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '2 hours', NULL, 'staff_d', 'b2a-'||v_proc::text);
  v_r := public.admin_record_item_receipt(v_proc, 0, 5, now()-interval '1 hour', NULL, 'staff_d', 'b2b-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'B2 溢收回 %', v_r; END IF;
  IF (SELECT received_quantity FROM public.order_item_procurement WHERE id=v_proc) <> v_qty
     OR (SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id=v_item) <> v_qty
  THEN RAISE EXCEPTION 'B2 溢收竟然動到 received/instock'; END IF;"
cell "B3 帶連字號的小寫 UUID 當 request_id 收得下" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', '7f3a1c2e-0b44-4d8e-9a11-0c2d3e4f5a6b');
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'B3 回 %', v_r; END IF;"

# ══ C 區:登錄負向 ═════════════════════════════════════════
cell "C1 超收 ⇒ QUANTITY_EXCEEDS_ALLOCATED(不是 raw 23514、也不是 RAISE)" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty+99, 0, now()-interval '1 hour', NULL, 'staff_d', 'c1-'||v_proc::text);
  IF v_r <> 'QUANTITY_EXCEEDS_ALLOCATED' THEN RAISE EXCEPTION 'C1 回 %', v_r; END IF;"
cell "C2 採購列不存在 ⇒ PROCUREMENT_NOT_FOUND 且 ledger 不留孤兒" "
  v_r := public.admin_record_item_receipt(gen_random_uuid(), 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'c2-'||v_proc::text);
  IF v_r <> 'PROCUREMENT_NOT_FOUND' THEN RAISE EXCEPTION 'C2 回 %', v_r; END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_receipt_requests WHERE request_id='c2-'||v_proc::text)
  THEN RAISE EXCEPTION 'C2 ledger 留下孤兒列'; END IF;"
# 🔴 codex 關卡2 C1 的守門:那條 finding 是「**兩支的正規化不一致**」——
#    修法(把 v_ws/v_zw 抄進 delete)如果沒有格看著,下一個人把它清掉就靜默回到不一致。
#    🔴🔴 **R2 更正:第一版只放【前置 U+200B】一個毒值,而那只擋得住「剝」那一半** ——
#         如果有人只撤掉 delete 的**形狀閘**,前置零寬早就被 btrim 剝掉了 ⇒ 這格照樣全綠
#         ⇒ 我原本寫的「少任一半這格就紅」**是假的**(codex R2 must-fix)。
#    ⇒ 現在放**兩個方向相反的毒值**,一個只殺得死「剝」、一個只殺得死「形狀閘」:
#      ①**前置** U+200B(在 v_ws/v_zw 裡、不在 `[!-~]` 裡)⇒ 撤掉 btrim 就紅
#      ②**內嵌** U+200B(btrim 只剝頭尾、剝不掉它)+ 大寫 ⇒ 撤掉形狀閘就會被靜默收下 ⇒ 本格紅
cell "C6 零寬/大寫 request_id:剝與形狀閘【兩半各有一個毒值】(兩支正規化對稱)" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', U&'\200B'||'c6-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'C6 登錄拒了前置零寬(回 %)', v_r; END IF;
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', U&'\200B'||'c6d-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'C6 刪除拒了前置零寬(回 %)⇒ 兩支正規化不對稱', v_r; END IF;
  -- 剝乾淨才寫進稽核(不是連零寬一起寫進去)
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                  WHERE action='procurement_receipt.delete' AND request_id='c6d-'||v_proc::text)
  THEN RAISE EXCEPTION 'C6 稽核裡的 request_id 沒被剝乾淨'; END IF;
  -- ── 毒值②:btrim 剝不掉的位置 ⇒ 只有形狀閘擋得住;兩支都必須 RAISE ──
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'c6x'||U&'\200B'||'y');
    RAISE EXCEPTION 'C6 登錄收下了內嵌零寬(回 %)⇒ 形狀閘失效', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C6 登錄收下了內嵌零寬%' THEN RAISE; END IF;
  END;
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc LIMIT 1;
  BEGIN
    v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'c6x'||U&'\200B'||'z');
    RAISE EXCEPTION 'C6 刪除收下了內嵌零寬(回 %)⇒ 形狀閘失效', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C6 刪除收下了內嵌零寬%' THEN RAISE; END IF;
  END;
  BEGIN
    v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'C6D-UPPER');
    RAISE EXCEPTION 'C6 刪除收下了大寫(回 %)⇒ 形狀閘失效', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C6 刪除收下了大寫%' THEN RAISE; END IF;
  END;"
# 🔴 codex 關卡2 R2-nit:C6 只抽驗單一碼位 ⇒ delete 若漏掉 `U+200C`(或等長替換成別的字元),
#    31/7 自檢與 C6 都會綠、兩支卻再次分歧。本格改用**結構等價**釘死:
#    兩支的 v_ws / v_zw 定義**逐字相同**才准過(抗漂移,不靠抽樣)。
sql_cell "A6 兩支的 v_ws / v_zw 常數定義【逐字相同】(C1 修法的抗漂移守門)" \
  "(WITH s AS (SELECT p.oid, regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g') AS src FROM pg_proc p
                WHERE p.oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure))
    SELECT count(DISTINCT substring(src from 'v_ws constant text :=[^;]*;')) = 1
       AND count(DISTINCT substring(src from 'v_zw constant text :=[^;]*;')) = 1
       AND count(*) FILTER (WHERE src ~ 'v_ws constant text :=') = 2
       AND count(*) FILTER (WHERE src ~ 'v_zw constant text :=') = 2
      FROM s)"
# 🔴🔴 Fable R3 F1(**穿透前四輪**):plan §7-6 寫「**每條守門各有一格只紅它自己的負測**」,
#      但 record 的四道輸入守門在本檔**零格覆蓋** —— `INVALID_QUANTITY` / `RECEIVED_AT_REQUIRED` /
#      `NOTE_TOO_LONG` / `p_actor` 形狀閘,拿掉任一道,32 格 + 7 突變**照樣全綠**、收尾照印「✅ 全綠」。
#      ⇒ 這是宣稱面超出事實(`feedback_claim-scope-exceeds-fact` 三形狀之一),而且長在
#         「R1/R2 折面反覆收窄宣稱」的同一份文件裡。
#      **修法選補格不選收窄**(我的判斷,理由寫進 STOP):這四道**構造成本近乎零**,
#      拿「誠實缺口」去豁免十幾行就能測的東西,是把那個機制用歪。
cell "C7 四道輸入守門各有專屬毒值(F1:補上零覆蓋的那四道)" "
  v_r := public.admin_record_item_receipt(v_proc, -1, 0, now()-interval '1 hour', NULL, 'staff_d', 'c7a-'||v_proc::text);
  IF v_r <> 'INVALID_QUANTITY' THEN RAISE EXCEPTION 'C7 負數量回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 0, 0, now()-interval '1 hour', NULL, 'staff_d', 'c7b-'||v_proc::text);
  IF v_r <> 'INVALID_QUANTITY' THEN RAISE EXCEPTION 'C7 全零(和 0)回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 100000, 1, now()-interval '1 hour', NULL, 'staff_d', 'c7c-'||v_proc::text);
  IF v_r <> 'INVALID_QUANTITY' THEN RAISE EXCEPTION 'C7 和超過 100000 回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, NULL, NULL, 'staff_d', 'c7d-'||v_proc::text);
  IF v_r <> 'RECEIVED_AT_REQUIRED' THEN RAISE EXCEPTION 'C7 到貨時間 NULL 回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', repeat('x', 501), 'staff_d', 'c7e-'||v_proc::text);
  IF v_r <> 'NOTE_TOO_LONG' THEN RAISE EXCEPTION 'C7 501 字備註回 %', v_r; END IF;
  -- 邊界另一側:恰 500 字必須收得下(證明上面那格不是「備註一律拒」的假紅)
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', repeat('x', 500), 'staff_d', 'c7f-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'C7 恰 500 字備註竟被拒(回 %)', v_r; END IF;
  -- actor 形狀閘:caller bug 面 ⇒ RAISE(不給固定碼)
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'Staff D!', 'c7g-'||v_proc::text);
    RAISE EXCEPTION 'C7 非法 actor 竟被收下(回 %)', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C7 非法 actor 竟被收下%' THEN RAISE; END IF;
  END;"
cell "C3 大寫 request_id ⇒ RAISE(不靜默 lower)" "
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'C3-UPPER');
    RAISE EXCEPTION 'C3 大寫竟然收下了(回 %)', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C3 大寫竟然收下了%' THEN RAISE; END IF;
  END;"
cell "C4 未來值拒、但 5 分鐘內的未來值收得下(寬限真的在)" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()+interval '30 minutes', NULL, 'staff_d', 'c4a-'||v_proc::text);
  IF v_r <> 'RECEIVED_AT_IN_FUTURE' THEN RAISE EXCEPTION 'C4 遠未來回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()+interval '2 minutes', NULL, 'staff_d', 'c4b-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'C4 寬限內竟被拒(回 %)', v_r; END IF;"
# 🔴 opus nit8:migration `:140-141` 的界**刻意帶時區偏移**,理由是「不帶偏移會用呼叫端 session 的
#    TimeZone 解讀」——但那條理由從來沒有負測。本格把 session 推到 UTC+14 再驗判定不動。
#    ⚠️ 判別力自證(**codex 關卡2 C6 更正:我原本寫反了,說會紅的是第一條**):
#       界若改寫成不帶偏移的字面,`'2020-01-01 00:00:00'` 在 UTC+14 下 = 2019-12-31T10:00Z
#       ⇒ 下界**往前挪、窗口變寬** ⇒ 第一條(2020-01-01T05:00Z)本來就在界內、**照樣綠**;
#       真正翻紅的是**第二條**(2019-12-31T23:00Z 從界外變成界內 ⇒ 回 RECORDED 而非 OUT_OF_RANGE)。
#       ⇒ 這一格的判別力**來自第二條**;第一條是防「窗口被縮窄」的另一邊,兩條都要留。
cell "C5 呼叫端 session TimeZone 改成 UTC+14 ⇒ range 界的判定【不變】(界帶偏移的理由有負測)" "
  SET LOCAL TimeZone = 'Pacific/Kiritimati';
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, TIMESTAMPTZ '2020-01-01 05:00:00+00', NULL, 'staff_d', 'c5a-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'C5 界內值在 UTC+14 下被誤判(回 %)', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, TIMESTAMPTZ '2019-12-31 23:00:00+00', NULL, 'staff_d', 'c5b-'||v_proc::text);
  IF v_r <> 'RECEIVED_AT_OUT_OF_RANGE' THEN RAISE EXCEPTION 'C5 界外值在 UTC+14 下沒被擋(回 %)', v_r; END IF;
  SET LOCAL TimeZone = 'UTC';"

# ══ D 區:冪等 ═════════════════════════════════════════════
cell "D1 同鍵同 payload ⇒ DUPLICATE_REQUEST 且 receipt 只有一列" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'note', 'staff_d', 'd1-'||v_proc::text);
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'note', 'staff_d', 'd1-'||v_proc::text);
  IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D1 回 %', v_r; END IF;
  IF (SELECT count(*) FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc) <> 1
  THEN RAISE EXCEPTION 'D1 產生了第二筆到貨'; END IF;"
# 🔴 D1a 的 fixture **必須用 NULL note**:拿非空 note 跑會讓這一格恆綠(fixture-vacuous)。
cell "D1a 🔴 note=NULL 的同鍵重放 ⇒ 必須 DUPLICATE(用 = 會走不符枝)" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd1a-'||v_proc::text);
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd1a-'||v_proc::text);
  IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D1a note=NULL 重放回 %', v_r; END IF;"
cell "D2 同鍵【不同 payload】⇒ RAISE(caller bug)" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd2-'||v_proc::text);
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 3, now()-interval '1 hour', NULL, 'staff_d', 'd2-'||v_proc::text);
    RAISE EXCEPTION 'D2 不同 payload 竟回 %', v_r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'D2 不同 payload 竟回%' THEN RAISE; END IF;
  END;"
# 🔴 誠實邊界(opus MF4 / Fable F3):本格兩次呼叫在**同一交易**內 ⇒ 第二次在**步 6 快篩**就
#    看得見自己未提交的 ledger 列(FOUND=true、payload 不符)⇒ 在 migration `:202` 就 RAISE,
#    **到不了 `:216-236` 的 `unique_violation` 併發 fallback**。那一枝要兩條連線 rendezvous 才走得到。
#    ⇒ 格名只宣稱「單連線同鍵跨採購列會被明確擋下且不外洩 23505」;fallback 分支列進收尾缺口段。
cell "D3 同鍵掛【不同採購列】(單連線)⇒ RAISE、不外洩 raw 23505" "
  DECLARE v_p2 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id, reply_status)
    SELECT v_p2, oi.id, oi.quantity, '$SPOT', 'confirmed' FROM public.order_items oi
     LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id=oi.id
     WHERE oi.id <> v_item AND oi.quantity>=1 AND coalesce(q.ordered_quantity,0)=0
       AND coalesce(q.instock_quantity,0)=0 ORDER BY oi.id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'D3 fixture 取不到第二個品項'; END IF;
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd3-'||v_proc::text);
    BEGIN
      v_r := public.admin_record_item_receipt(v_p2, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd3-'||v_proc::text);
      RAISE EXCEPTION 'D3 竟回 %', v_r;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'D3 外洩 raw 23505';
      WHEN raise_exception THEN IF SQLERRM LIKE 'D3 竟回%' THEN RAISE; END IF;
    END;
  END;"
# 🔴🔴 D4 原本用 1999 年的日期當「失敗」——那在 migration `:140-143` 的 range 閘就 `RETURN` 了,
#      **ledger 從來沒被寫過、receipt INSERT 從來沒失敗**,格名那句「同滾」等於沒測
#      (opus MF1 / Fable F3;把兩個 INSERT 拆成各自獨立的 subtransaction,舊版照樣綠)。
#      改法照 E5 形制:**臨時 trigger 讓 receipt INSERT 真的失敗**,再看 ledger 有沒有跟著滾掉。
cell "D4 🔴 receipt 寫入【真的失敗】⇒ ledger 同滾;同鍵重送必須【成功】不誤判" "
  CREATE FUNCTION pg_temp.d4_boom() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''d4 boom''; END';
  CREATE TRIGGER d4_boom BEFORE INSERT ON public.order_item_procurement_receipts
    FOR EACH ROW EXECUTE FUNCTION pg_temp.d4_boom();
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd4-'||v_proc::text);
    RAISE EXCEPTION 'D4 receipt 寫入竟然沒失敗(回 %)', v_r;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'D4 receipt 寫入竟然沒失敗%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%d4 boom%' THEN RAISE EXCEPTION 'D4 紅在別的地方:%', SQLERRM; END IF;
  END;
  DROP TRIGGER d4_boom ON public.order_item_procurement_receipts;
  -- 🔴 真正的不變式:ledger 是 write-ahead 先寫的,產物失敗後它**必須跟著不見**
  IF EXISTS (SELECT 1 FROM public.order_item_receipt_requests WHERE request_id='d4-'||v_proc::text)
  THEN RAISE EXCEPTION 'D4 產物失敗了、ledger 卻留下列(冪等帳被污染 ⇒ 合法重送會被誤判成 DUPLICATE)'; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd4-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'D4 同鍵重送被誤判(回 %)', v_r; END IF;"
cell "D4a 早退路徑(range 閘)也不留 ledger 孤兒 —— 原 D4 真正測到的那半,單獨留格" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, TIMESTAMPTZ '1999-01-01', NULL, 'staff_d', 'd4a-'||v_proc::text);
  IF v_r <> 'RECEIVED_AT_OUT_OF_RANGE' THEN RAISE EXCEPTION 'D4a 前置未擋(回 %)', v_r; END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_receipt_requests WHERE request_id='d4a-'||v_proc::text)
  THEN RAISE EXCEPTION 'D4a 早退竟在 ledger 留下列'; END IF;"
# 🔴🔴 codex 關卡2 C2:第一版**只用 `xmin`**,而 `xmin` 是在**第一次 record 回來之後**才取的
#      ⇒ 若 record 自己在同一次呼叫裡「先 INSERT 再 UPDATE」,我量到的已經是更新後的值,全綠。
#      (更根本:同交易內的 UPDATE 產生的新版本 `xmin` 不變 —— 這個觀察點對 intra-call UPDATE 全盲。)
#      改法照 D4 的形制:**掛一個 `BEFORE UPDATE` 的爆炸 trigger**,整段情境跑完都不准有人 UPDATE 這張表。
#      xmin/receipt_id 那兩條保留當第二道(便宜、且擋得住跨交易的改動)。
cell "D6 ledger 零 UPDATE 路徑(plan §7-19):全程掛 BEFORE UPDATE 爆炸 trigger,任何 UPDATE 當場紅" "
  CREATE FUNCTION pg_temp.d6_boom() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''d6 ledger 被 UPDATE 了''; END';
  CREATE TRIGGER d6_boom BEFORE UPDATE ON public.order_item_receipt_requests
    FOR EACH ROW EXECUTE FUNCTION pg_temp.d6_boom();
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'n', 'staff_d', 'd6-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'D6 登錄回 %', v_r; END IF;
  SELECT xmin::text::bigint INTO v_n FROM public.order_item_receipt_requests WHERE request_id='d6-'||v_proc::text;
  SELECT receipt_id INTO v_rid FROM public.order_item_receipt_requests WHERE request_id='d6-'||v_proc::text;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'n', 'staff_d', 'd6-'||v_proc::text);
  IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D6 重放回 %', v_r; END IF;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'd6d-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'D6 刪除回 %', v_r; END IF;
  -- 🔴 xmin 變了 = 那一列被 UPDATE 過(即使欄值看起來一樣)⇒ append-only 宣稱破功
  IF (SELECT xmin::text::bigint FROM public.order_item_receipt_requests WHERE request_id='d6-'||v_proc::text) <> v_n
  THEN RAISE EXCEPTION 'D6 ledger 列被改過(xmin 變動)⇒ 不是 append-only'; END IF;
  IF (SELECT receipt_id FROM public.order_item_receipt_requests WHERE request_id='d6-'||v_proc::text) <> v_rid
  THEN RAISE EXCEPTION 'D6 ledger 的 receipt_id 被改過'; END IF;
  -- 🔴 **偵測器自證**:上面全綠有兩種可能 ①真的沒人 UPDATE ②我的 trigger 根本沒生效。
  --    故意 UPDATE 一次,**必須爆**;不爆就代表這一格前面那些「全綠」沒有判別力。
  BEGIN
    UPDATE public.order_item_receipt_requests SET actor=actor WHERE request_id='d6-'||v_proc::text;
    RAISE EXCEPTION 'D6 偵測器失效:UPDATE 竟然沒被 trigger 擋下';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'D6 偵測器失效%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%d6 ledger 被 UPDATE 了%' THEN RAISE EXCEPTION 'D6 偵測器爆在別的地方:%', SQLERRM; END IF;
  END;
  DROP TRIGGER d6_boom ON public.order_item_receipt_requests;"
cell "D5 不復活:登錄→刪除→同鍵重送 ⇒ DUPLICATE 且 receipt 沒被重建" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd5-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'd5del-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'D5 刪除回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'd5-'||v_proc::text);
  IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D5 重送回 %', v_r; END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc)
  THEN RAISE EXCEPTION 'D5 receipt 被復活了'; END IF;"

# ══ E 區:刪除 ═════════════════════════════════════════════
cell "E1 刪除正向 ⇒ instock 退回" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'e1-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'e1d-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'E1 回 %', v_r; END IF;
  IF (SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id=v_item) <> 0
  THEN RAISE EXCEPTION 'E1 instock 沒退回'; END IF;"
cell "E2 已裝進未出貨包裹 ⇒ P4A03、訊息列出包裹編號、交易回滾" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'e2-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  INSERT INTO public.shipments (id, shipment_reference, customer_user_id, carrier_code, recipient_snapshot)
  SELECT gen_random_uuid(), 'BCDFGH', o.customer_user_id, 'hct',
         jsonb_build_object('name','n','phone','0900000000','line','')
    FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id=v_item
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_item, v_qty);
  BEGIN
    v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'e2d-'||v_proc::text);
    RAISE EXCEPTION 'E2 竟然刪掉了(回 %)', v_r;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'E2 竟然刪掉了%' THEN RAISE; END IF;
      IF SQLSTATE <> 'P4A03' THEN RAISE EXCEPTION 'E2 紅在 % 不是 P4A03', SQLSTATE; END IF;
      IF SQLERRM NOT LIKE '%BCDFGH%' THEN RAISE EXCEPTION 'E2 訊息沒列出包裹編號'; END IF;
    WHEN sqlstate 'P4A03' THEN
      IF SQLERRM NOT LIKE '%BCDFGH%' THEN RAISE EXCEPTION 'E2 訊息沒列出包裹編號'; END IF;
  END;
  -- 🔴 opus nit7:格名寫了「交易回滾」卻沒有對應斷言 ⇒ 補這條(守門擋下了、東西必須還在)
  IF NOT EXISTS (SELECT 1 FROM public.order_item_procurement_receipts WHERE id=v_rid)
  THEN RAISE EXCEPTION 'E2 守門擋下了、receipt 卻不見了(刪除沒有跟著回滾)'; END IF;"
cell "E3 判別力:已刪 ⇒ ALREADY_DELETED;隨機 uuid ⇒ RECEIPT_NOT_FOUND" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'e3-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'e3a-'||v_proc::text);
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'e3b-'||v_proc::text);
  IF v_r <> 'ALREADY_DELETED' THEN RAISE EXCEPTION 'E3 已刪的回 %', v_r; END IF;
  v_r := public.admin_delete_item_receipt(gen_random_uuid(), 'staff_d', 'e3c-'||v_proc::text);
  IF v_r <> 'RECEIPT_NOT_FOUND' THEN RAISE EXCEPTION 'E3 隨機 uuid 回 %(不可回成功)', v_r; END IF;"
# ⚠️ 錨點原本釘在 `RETURNING id INTO v_deleted` —— 那是個**死賦值**(opus nit13),已從 migration 移除;
#    真正的判準一直都是 `ROW_COUNT`,錨點改釘它 + 它的消費點。
cell "E4 rowcount 分支結構在(⚠️ 真併發未測,見收尾說明)" "
  IF (SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'GET DIAGNOSTICS v_rows = ROW_COUNT')=0
        FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure)
     OR (SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'IF v_rows = 0 THEN')=0
        FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure)
  THEN RAISE EXCEPTION 'E4 ROW_COUNT 判斷或它的消費點不在'; END IF;"
cell "E5 fail-closed:摘要列缺席 ⇒ 刪除被擋(需停掉 A4a 才構造得出,見標註)" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'e5-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  -- 🔴 **這一格為什麼要先停掉 trigger(誠實說明,不是偷吃步)**:
  --    A4a 的重算會在 DELETE 當下把摘要列**重新建出來**(實測:刪掉後再呼叫,摘要列回到 1 列)
  --    ⇒ 走正常應用路徑,fail-closed 那一枝**構造不出來**。
  --    它守的是「A4a 不在/壞掉」那個世界,所以負測必須把 A4a 拿掉才有判別力。
  --    ⇒ 本格證的是【那一枝活著且會擋】,**不宣稱**它在正常路徑上會被觸發。
  ALTER TABLE public.order_item_procurement DISABLE TRIGGER order_item_procurement_summary_recompute_zc;
  DELETE FROM public.order_item_quantity_summary WHERE order_item_id=v_item;
  BEGIN
    v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'e5d-'||v_proc::text);
    RAISE EXCEPTION 'E5 摘要缺席竟然放行(回 %)', v_r;
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'E5 摘要缺席竟然放行%' THEN RAISE; END IF;
    WHEN sqlstate 'P4A03' THEN NULL;
  END;"

# ══ F 區:deferred ═════════════════════════════════════════
cell "F1 呼叫端先 SET CONSTRAINTS DEFERRED ⇒ 刪除守門仍擋得住" "
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'f1-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  INSERT INTO public.shipments (id, shipment_reference, customer_user_id, carrier_code, recipient_snapshot)
  SELECT gen_random_uuid(), 'JKMNPQ', o.customer_user_id, 'hct',
         jsonb_build_object('name','n','phone','0900000000','line','')
    FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id=v_item
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_item, v_qty);
  SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc DEFERRED;
  BEGIN
    v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'f1d-'||v_proc::text);
    RAISE EXCEPTION 'F1 DEFERRED 下竟然放行(回 %)', v_r;
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'F1 DEFERRED 下竟然放行%' THEN RAISE; END IF;
    WHEN sqlstate 'P4A03' THEN NULL;
  END;"
# 🔴 關卡1 must-fix 5 原本要我補一格 commit-aware 的 `F2a`(因為 DEFERRED trigger 在 rollback 前不發火)。
#    **plan v1 換設計之後那一格失去對象**:新守門讀的是**真相表**
#    (`order_cancellation_items` / `order_item_procurement_receipts`),兩者都由 RPC 直接寫、
#    **沒有 deferred trigger 夾在中間** ⇒ 「可能讀到舊值」這個危險面**不存在了**,不需要真 COMMIT 去觀察它。
#    ⇒ 改成把**新守門**併進 F2 一起在 DEFERRED 下驗(仍走 BEGIN…ROLLBACK,零留痕不破)。
#    **這是「因為設計改了所以那格沒有對象」,不是「測不出來所以跳過」** —— 兩者要分清楚。
cell "F2 DEFERRED 下【登錄】行為不變(證明 record 不需要 IMMEDIATE)" "
  SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc DEFERRED;
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'f2-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'F2 DEFERRED 下登錄回 %', v_r; END IF;
  v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'f2-'||v_proc::text);
  IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'F2 DEFERRED 下重放回 %', v_r; END IF;"
# ⚠️ **本格是「非回歸格」,判別力有限**(opus 線 ③):新守門讀的兩張真相表由 RPC 直接寫,
#    夾在中間的 deferred trigger(`…presence_ac`)**只驗不寫** ⇒ DEFERRED 與否本來就不影響它的值。
#    ⇒ 本格證的是「**設計改了之後行為沒退化**」,**不是**「守門在 deferred 下被考驗過」。
#    真正的判別力來源是 migration 的結構斷言(record 的函式體內 `order_item_quantity_summary` 零命中)。
cell "F2b(非回歸格)DEFERRED 下品項層守門行為不變 —— 判別力見上方註解" "
  SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc DEFERRED;
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_1', 'f2b-'||v_proc::text);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'F2b DEFERRED 下爆了(SQLSTATE=%)—— 若這裡紅,代表守門其實還在讀衍生值', SQLSTATE;
  END;
  IF v_r <> 'EXCEEDS_ROOM_AFTER_CANCELLATION' THEN RAISE EXCEPTION 'F2b DEFERRED 下回 %', v_r; END IF;"

# ══ G 區:稽核 ═════════════════════════════════════════════
# 🔴🔴 Fable F1:原本整份 harness 對 `admin_audit_log` **零斷言**(`grep -c` = 0)——
#      把兩支 RPC 的 audit INSERT 整段刪掉,25 格 + 5 突變**照樣全綠**。
#      而 audit 是 plan 與 STOP 反覆引用的補償控制(刪除即滅失、只剩它查得到)
#      ⇒ 全片唯一「拿掉沒人紅」的寫入面。本格 + M6 突變把它釘住。
cell "G2 兩支 RPC 都必須留下稽核列(action / target / request_id 逐欄對)" "
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'n', 'staff_d', 'g2-'||v_proc::text);
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                  WHERE action='procurement_receipt.create' AND target='receipt:'||v_rid::text
                    AND request_id='g2-'||v_proc::text AND actor='staff_d')
  THEN RAISE EXCEPTION 'G2 登錄沒留稽核列'; END IF;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_d', 'g2d-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'G2 刪除回 %', v_r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                  WHERE action='procurement_receipt.delete' AND target='receipt:'||v_rid::text
                    AND request_id='g2d-'||v_proc::text AND actor='staff_d')
  THEN RAISE EXCEPTION 'G2 刪除沒留稽核列'; END IF;
  -- 🔴 刪除的 before-image 必須真的帶得走內容(刪掉之後 receipts 那列就不存在了)
  -- 🔴🔴 codex 關卡2 C4:第一版只驗 `before ? 'quantity'`(**鍵在不在**)——
  --      把值寫成 NULL 或寫錯照樣全綠 ⇒ 證不出「帶得走內容」。改成**逐值比對**。
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                  WHERE a.action='procurement_receipt.delete' AND a.target='receipt:'||v_rid::text
                    AND (a.before->>'procurement_id')::uuid = v_proc
                    AND (a.before->>'quantity')::int = 1
                    AND (a.before->>'surplus_quantity')::int = 0)
  THEN RAISE EXCEPTION 'G2 刪除的 before-image 值對不上(鍵在不代表內容帶得走)'; END IF;"

# ══ H 區:品項層額度守門(#352 甲片;Sean Q9=A)════════════════
# 🔴 背景:a2 只擋「採購列層」超收,C7 是「品項層」不變式 ⇒ 取消吃掉的額度看不見
#    ⇒ 「單子取消後貨才到」原本直接吐 raw 23514。甲片補了讀**真相表**的品項層守門。
cell "H1 未付款單全量取消後貨才到 ⇒ 回 EXCEEDS_ROOM_AFTER_CANCELLATION(不是 raw 23514)" "
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
  BEGIN
    v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_1', 'h1-'||v_proc::text);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'H1 竟然爆了(SQLSTATE=%)—— 甲片的整個目的就是不要讓員工看到這個', SQLSTATE;
  END;
  IF v_r <> 'EXCEEDS_ROOM_AFTER_CANCELLATION' THEN RAISE EXCEPTION 'H1 回 %', v_r; END IF;"
# 🔴 判別力的另一半:新守門**不得過度攔截**。溢收列 quantity=0 不佔 C7 的 instock 軸
#    ⇒ 取消後純溢收仍必須 RECORDED。這一格是「甲片沒有把到貨側整個關掉」的證據。
cell "H1b 取消後【純溢收】(quantity=0/surplus=N)仍必須 RECORDED —— 新守門不過度攔截" "
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
  v_r := public.admin_record_item_receipt(v_proc, 0, 5, now()-interval '1 hour', NULL, 'staff_1', 'h1b-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'H1b 純溢收被誤擋(回 %)', v_r; END IF;"
# 🔴🔴 H2/H3 = **部分取消**情境。plan v0 我寫「構造不出來」——**那是假的**(關卡1 打掉):
#      `w6b3-cancel-vs-receipt.sh:232` 的 `mkitem` 早就不動 seed 自建 `quantity=3` 的品項。
#      這裡照同一招:往既有訂單插一筆自己的 `quantity=3` 品項(`line_total = quantity × unit_price`,
#      與 mkitem 逐字同形),再跑部分取消。
#      ⚠️ 前提斷言:該訂單其它品項不得已有真到貨,否則整單閘會先擋、本格失去判別力。
H23FIX="
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  IF EXISTS (SELECT 1 FROM public.order_items oi
              JOIN public.order_item_procurement p ON p.order_item_id=oi.id
              JOIN public.order_item_procurement_receipts r ON r.procurement_id=p.id
             WHERE oi.order_id=v_ord AND r.quantity>0)
  THEN RAISE EXCEPTION '前提不足:同單已有真到貨,本格無判別力'; END IF;
  v_i3 := gen_random_uuid();
  INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total)
  VALUES (v_i3, v_ord, 'SKU-H23', '{\"title\":\"零件\",\"sku\":\"S1\",\"spec\":{\"color\":\"black\"}}'::jsonb, 3, 10, 30);
  v_p3 := gen_random_uuid();
  INSERT INTO public.order_item_procurement(id,order_item_id,allocated_quantity,supplier_id,reply_status)
  VALUES (v_p3, v_i3, 3, '$SPOT', 'confirmed');
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
"
cell "H2 部分取消 2/3 後想登錄 2 件(額度只剩 1)⇒ 回 EXCEEDS_ROOM_AFTER_CANCELLATION" "
  $H23FIX
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL,
    jsonb_build_array(jsonb_build_object('order_item_id', v_i3::text, 'quantity', 2)));
  BEGIN
    v_r := public.admin_record_item_receipt(v_p3, 2, 0, now()-interval '1 hour', NULL, 'staff_1', 'h2-'||v_p3::text);
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'H2 竟然爆了(SQLSTATE=%)', SQLSTATE;
  END;
  IF v_r <> 'EXCEEDS_ROOM_AFTER_CANCELLATION' THEN RAISE EXCEPTION 'H2 回 %', v_r; END IF;"
cell "H3 部分取消 1/3 後登錄 2 件(額度剩 2)⇒ 必須 RECORDED(部分取消也不過度攔截)" "
  $H23FIX
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL,
    jsonb_build_array(jsonb_build_object('order_item_id', v_i3::text, 'quantity', 1)));
  v_r := public.admin_record_item_receipt(v_p3, 2, 0, now()-interval '1 hour', NULL, 'staff_1', 'h3-'||v_p3::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'H3 額度內竟被擋(回 %)', v_r; END IF;
  IF (SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id=v_i3) <> 2
  THEN RAISE EXCEPTION 'H3 instock 沒跟上'; END IF;"
# 🔴 precedence(關卡1 must-fix 3):兩道守門同時不足時,**採購列層先回** ——
#    否則員工看到的錯誤碼會隨實作順序漂移、處置跟著改。
cell "H4 兩層額度同時不足 ⇒ 固定回採購列層的碼(precedence 被釘住)" "
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
  v_r := public.admin_record_item_receipt(v_proc, v_qty+99, 0, now()-interval '1 hour', NULL, 'staff_1', 'h4-'||v_proc::text);
  IF v_r <> 'QUANTITY_EXCEEDS_ALLOCATED'
  THEN RAISE EXCEPTION 'H4 precedence 漂移:兩層都不足時回了 %(應為採購列層的碼)', v_r; END IF;"

# ══ 突變靶 ═════════════════════════════════════════════════
mut "M1 冪等帳補 FK ⇒ A5 翻紅" \
  "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_receipt_requests'::regclass AND contype='f'" "1" \
  "ALTER TABLE public.order_item_receipt_requests ADD CONSTRAINT m1 FOREIGN KEY (procurement_id) REFERENCES public.order_item_procurement(id);" \
  "IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_receipt_requests'::regclass AND contype='f')<>0
   THEN RAISE EXCEPTION 'A5 等價格:冪等帳長出外鍵'; END IF;"
# 🔴 M8 = C7 的判別力證明。F1 的整個要害就是「拿掉一道守門、全部照樣綠」,
#    所以補一發**改壞值、保留選擇器**的突變(memory 的處方,不是拿掉整條):
#    把 `NOTE_TOO_LONG` 的門檻 500 改成 100000 ⇒ 501 字的備註會被收下 ⇒ C7 必紅。
#    ⚠️ 誠實界:本發只證了**四道裡的這一道**有牙;另三道是同形狀(各自的毒值斷言**確切回傳碼**、
#       不是存在性檢查),但**沒有各自的突變** —— 這句同時寫進 STOP,不寫成「四道都驗過」。
mut "M8 NOTE_TOO_LONG 門檻 500 改成 100000(保留選擇器、只改壞值)⇒ C7 翻紅" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'char_length(v_note) > 100000')>0
     FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure" "true" \
  "DO \$mm\$
   DECLARE s text; t text := 'char_length(v_note) > 500'; n int;
   BEGIN
     SELECT prosrc INTO s FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure;
     n := (length(s) - length(replace(s, t, ''))) / length(t);
     IF n <> 1 THEN RAISE EXCEPTION 'M8 突變前提破了:該字面出現 % 次(預期 1)', n; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamptz, p_note text, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', replace(s, t, 'char_length(v_note) > 100000'));
   END \$mm\$;" \
  "v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', repeat('x', 501), 'staff_d', 'm8-'||v_proc::text);
   IF v_r <> 'NOTE_TOO_LONG' THEN RAISE EXCEPTION 'C7 等價格:501 字備註回 %', v_r; END IF;"
# ⚠️ Fable R3 N4:標籤原本寫「⇒ **D1a** 翻紅」是**條件真** —— D1a 用 `quantity=1`,
#    fixture 品項 `quantity ≥ 2` 時 `1 > v_qty − 1` 不成立、D1a 照樣綠。
#    本發自己的 probe **刻意用 `v_qty`** 所以必殺(操作面無害),但那句對應關係沒被量過。
#    ⇒ 標籤改成描述**本發自己的 probe**,不借用別格的名字。
mut "M2 record 的超收守門移到冪等【之前】⇒ 同鍵重放被超收擋下(本發自帶 v_qty probe)" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'QUANTITY_EXCEEDS_ALLOCATED')
     < strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'DUPLICATE_REQUEST') FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure" "true" \
  "CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamptz, p_note text, p_actor text, p_request_id text) RETURNS text
   LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$m\$
   DECLARE v_proc public.order_item_procurement%ROWTYPE; v_same boolean; v_rid uuid; BEGIN
     SELECT * INTO v_proc FROM public.order_item_procurement WHERE id=p_procurement_id FOR NO KEY UPDATE;
     IF NOT FOUND THEN RETURN 'PROCUREMENT_NOT_FOUND'; END IF;
     IF p_quantity > (v_proc.allocated_quantity - v_proc.received_quantity) THEN RETURN 'QUANTITY_EXCEEDS_ALLOCATED'; END IF;
     SELECT true INTO v_same FROM public.order_item_receipt_requests WHERE request_id=p_request_id;
     IF FOUND THEN RETURN 'DUPLICATE_REQUEST'; END IF;
     v_rid := gen_random_uuid();
     INSERT INTO public.order_item_receipt_requests (request_id,procurement_id,quantity,surplus_quantity,received_at,note,actor,receipt_id)
     VALUES (p_request_id,p_procurement_id,p_quantity,p_surplus_quantity,p_received_at,p_note,p_actor,v_rid);
     INSERT INTO public.order_item_procurement_receipts (id,procurement_id,quantity,surplus_quantity,received_at,received_by,note)
     VALUES (v_rid,p_procurement_id,p_quantity,p_surplus_quantity,p_received_at,p_actor,p_note);
     RETURN 'RECORDED'; END \$m\$;" \
  "v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'm2-'||v_proc::text);
   v_r := public.admin_record_item_receipt(v_proc, v_qty, 0, now()-interval '1 hour', NULL, 'staff_d', 'm2-'||v_proc::text);
   IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D1a 等價格:重放回 %', v_r; END IF;"
# 🔴 opus nit6:M3 原本把 delete **整支換成 stub**(`BEGIN RETURN 'DELETED'; END`)——
#    ①標籤寫「拿掉 SET CONSTRAINTS」= 字面 vs 事實 ②那種突變 E1/E3/E5/F1 全會紅
#    ⇒ 證不出 A4 的**專屬**判別力(memory:突變要改壞值、保留選擇器)。
#    改法:拿真函式的 prosrc,**只刪那一行敘述**,其餘一字不動;並先斷言那條敘述恰好出現 1 次
#    (出現 0 或 2 次 = 突變前提已破,當場 fail-loud、不會靜默做出一個假突變)。
mut "M3 delete【只刪掉 SET CONSTRAINTS 那一行】⇒ A4 翻紅" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'SET CONSTRAINTS')=0 FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure" "true" \
  "DO \$mm\$
   DECLARE s text; t text := 'SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc IMMEDIATE;'; n int;
   BEGIN
     SELECT prosrc INTO s FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure;
     n := (length(s) - length(replace(s, t, ''))) / length(t);
     IF n <> 1 THEN RAISE EXCEPTION 'M3 突變前提破了:那條敘述出現 % 次(預期 1)', n; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(p_receipt_id uuid, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', replace(s, t, ''));
   END \$mm\$;" \
  "IF (SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'SET CONSTRAINTS')
        FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure)=0
   THEN RAISE EXCEPTION 'A4 等價格:delete 沒有 SET CONSTRAINTS'; END IF;"
# 🔴 M7 = A6 的判別力證明。codex R2-nit 講的失效形狀就是「**等長替換**」——
#    7 個字元還在、31/7 自檢照樣過、C6 的抽樣毒值也照樣綠,但兩支的字元集已經分歧。
#    這一發就是照那個形狀打:把 delete 的 `v_zw` 裡 `U+00AD` 換成 `U+00AE`(等長、不同碼位)。
#    🔴 實作踩點:`prosrc` 存的是**原始碼字面**,裡面是 `U&'\00AD'` 這九個字元、
#       **不是**解碼後的那一個字元 ⇒ 拿解碼後的字元去 replace 會恆為 0 次、突變永遠套不上。
#       第一次跑就紅在這裡(harness 明確報「突變沒套上」而不是靜默通過 —— 這正是 landed 斷言的用處)。
mut "M7 delete 的 v_zw 等長替換一個碼位(31/7 自檢仍過)⇒ A6 翻紅" \
  "WITH s AS (SELECT regexp_replace(prosrc,'--[^'||chr(10)||']*','','g') AS src FROM pg_proc
                WHERE oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure))
   SELECT count(DISTINCT substring(src from 'v_zw constant text :=[^;]*;')) = 2 FROM s" "true" \
  "DO \$mm\$
   DECLARE s text; n int;
           t_old text := 'U&' || chr(39) || chr(92) || '00AD' || chr(39);
           t_new text := 'U&' || chr(39) || chr(92) || '00AE' || chr(39);
   BEGIN
     SELECT prosrc INTO s FROM pg_proc WHERE oid='$FN_DELETE'::regprocedure;
     n := (length(s) - length(replace(s, t_old, ''))) / length(t_old);
     IF n <> 1 THEN RAISE EXCEPTION 'M7 突變前提破了:該字面在 delete 出現 % 次(預期 1)', n; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_delete_item_receipt(p_receipt_id uuid, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', replace(s, t_old, t_new));
   END \$mm\$;" \
  "IF (WITH s AS (SELECT regexp_replace(prosrc,'--[^'||chr(10)||']*','','g') AS src FROM pg_proc
                   WHERE oid IN ('$FN_RECORD'::regprocedure,'$FN_DELETE'::regprocedure))
       SELECT count(DISTINCT substring(src from 'v_zw constant text :=[^;]*;')) FROM s) <> 1
   THEN RAISE EXCEPTION 'A6 等價格:兩支的 v_zw 定義不再逐字相同'; END IF;"
mut "M4 EXECUTE 改成【可轉授】⇒ A2 翻紅" \
  "SELECT bool_or(a.is_grantable) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid='$FN_RECORD'::regprocedure AND a.grantee='service_role'::regrole::oid" "true" \
  "GRANT EXECUTE ON FUNCTION public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text) TO service_role WITH GRANT OPTION;" \
  "IF (SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
        WHERE p.oid='$FN_RECORD'::regprocedure AND a.grantee<>p.proowner
          AND NOT (a.grantee='service_role'::regrole::oid AND a.privilege_type='EXECUTE' AND a.is_grantable=false))<>0
   THEN RAISE EXCEPTION 'A2 等價格:出現可轉授 EXECUTE'; END IF;"
mut "M5 冪等比對改回等號 ⇒ D1a(note=NULL)翻紅" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'IS NOT DISTINCT FROM')=0 FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure" "true" \
  "CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamptz, p_note text, p_actor text, p_request_id text) RETURNS text
   LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$m\$
   DECLARE v_proc public.order_item_procurement%ROWTYPE; v_same boolean; v_rid uuid; BEGIN
     SELECT * INTO v_proc FROM public.order_item_procurement WHERE id=p_procurement_id FOR NO KEY UPDATE;
     IF NOT FOUND THEN RETURN 'PROCUREMENT_NOT_FOUND'; END IF;
     SELECT (l.procurement_id = p_procurement_id AND l.quantity = p_quantity AND l.surplus_quantity = p_surplus_quantity
             AND l.received_at = p_received_at AND l.note = p_note AND l.actor = p_actor)
       INTO v_same FROM public.order_item_receipt_requests l WHERE l.request_id=p_request_id;
     IF FOUND THEN
       IF v_same THEN RETURN 'DUPLICATE_REQUEST'; END IF;
       RAISE EXCEPTION '這個提交編號先前已經用過,但內容不一樣。請重新整理頁面再送一次。';
     END IF;
     IF p_quantity > (v_proc.allocated_quantity - v_proc.received_quantity) THEN RETURN 'QUANTITY_EXCEEDS_ALLOCATED'; END IF;
     v_rid := gen_random_uuid();
     INSERT INTO public.order_item_receipt_requests (request_id,procurement_id,quantity,surplus_quantity,received_at,note,actor,receipt_id)
     VALUES (p_request_id,p_procurement_id,p_quantity,p_surplus_quantity,p_received_at,p_note,p_actor,v_rid);
     INSERT INTO public.order_item_procurement_receipts (id,procurement_id,quantity,surplus_quantity,received_at,received_by,note)
     VALUES (v_rid,p_procurement_id,p_quantity,p_surplus_quantity,p_received_at,p_actor,p_note);
     RETURN 'RECORDED'; END \$m\$;" \
  "v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'm5-'||v_proc::text);
   v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_d', 'm5-'||v_proc::text);
   IF v_r <> 'DUPLICATE_REQUEST' THEN RAISE EXCEPTION 'D1a 等價格:note=NULL 重放回 %', v_r; END IF;"
# 🔴🔴 M6(Fable F1):**這一發是全片唯一守著 audit 的東西**。同 M3 的手法 ——
#      拿真函式的 prosrc、只把 audit 那一條 INSERT 敘述抽掉,其餘一字不動。
#      前提斷言:那條敘述在 record 裡恰好出現 1 次(`[^;]*;` 不跨分號,而該敘述內部無分號)。
mut "M6 record 抽掉 audit INSERT ⇒ G2 翻紅" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'admin_audit_log')=0 FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure" "true" \
  "DO \$mm\$
   DECLARE s text; s2 text; n int;
   BEGIN
     SELECT prosrc INTO s FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure;
     -- 🔴 codex 關卡2 C5:原本只驗『替換後長度有變』——有兩段時會被一起刪掉而**不會 fail-loud**。
     --    改成先數命中次數,恰好 1 次才准動(與 M3 同一條紀律)。
     n := (SELECT count(*) FROM regexp_matches(s, 'INSERT INTO public\.admin_audit_log[^;]*;', 'g'));
     IF n <> 1 THEN RAISE EXCEPTION 'M6 突變前提破了:record 裡的 audit INSERT 出現 % 次(預期 1)', n; END IF;
     s2 := regexp_replace(s, 'INSERT INTO public\.admin_audit_log[^;]*;', '', 'g');
     IF strpos(regexp_replace(s2,'--[^'||chr(10)||']*','','g'),'admin_audit_log') <> 0
       THEN RAISE EXCEPTION 'M6 突變沒抽乾淨:函式體裡還有 admin_audit_log'; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamptz, p_note text, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', s2);
   END \$mm\$;" \
  "v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', 'n', 'staff_d', 'm6-'||v_proc::text);
   SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc;
   IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                   WHERE action='procurement_receipt.create' AND target='receipt:'||v_rid::text
                     AND request_id='m6-'||v_proc::text AND actor='staff_d')
   THEN RAISE EXCEPTION 'G2 等價格:登錄沒留稽核列'; END IF;"

# 🔴 M9 = H1 的判別力證明:把品項層額度的算式**改壞值、保留選擇器**
#    (拿掉 `- v_cancelled` ⇒ 取消吃掉的額度又看不見了)⇒ H1 必紅。
mut "M9 品項層額度算式拿掉取消那一項(保留選擇器)⇒ H1 翻紅" \
  "SELECT strpos(regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'oi.quantity::bigint - 0')>0
     FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure" "true" \
  "DO \$mm\$
   DECLARE s text; t text := 'oi.quantity::bigint - v_cancelled'; n int;
   BEGIN
     SELECT prosrc INTO s FROM pg_proc WHERE oid='$FN_RECORD'::regprocedure;
     n := (length(s) - length(replace(s, t, ''))) / length(t);
     IF n <> 1 THEN RAISE EXCEPTION 'M9 突變前提破了:該字面出現 % 次(預期 1)', n; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION public.admin_record_item_receipt(p_procurement_id uuid, p_quantity integer, p_surplus_quantity integer, p_received_at timestamptz, p_note text, p_actor text, p_request_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L', replace(s, t, 'oi.quantity::bigint - 0'));
   END \$mm\$;" \
  "SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
   UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
   UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
   PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
   BEGIN
     v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_1', 'm9-'||v_proc::text);
   EXCEPTION WHEN others THEN RAISE EXCEPTION 'H1 等價格:回到 raw %', SQLSTATE;
   END;
   IF v_r <> 'EXCEEDS_ROOM_AFTER_CANCELLATION' THEN RAISE EXCEPTION 'H1 等價格:回 %', v_r; END IF;"

# ══ 🟡 留白格(house 形制保留:規格已知、答案在人手上時放這裡)════
#    目前 0 格 —— G1 已於 2026-08-11 由 Sean Q6=A 解鎖並改成下方的真行為格。

# ══ G1(Sean 2026-08-11 Q6=A 拍板後補)════════════════════════
# 兩道整單取消閘(`20260804180000:216-222` / `20260805100000:411-413`)用 `r.quantity > 0`
# 當「有沒有到貨」的述詞 ⇒ **只有溢收(quantity=0)的列不算到貨、不擋取消**。
# 🔴 **Sean Q6=A:這就是要的行為**(可取消 + 由畫面提醒)⇒ 本格把它釘成可觀察事實,
#    日後有人「順手」把述詞改成 `>= 0` 或把 surplus 算進去,本格當場紅、必須回來重讀 Q6。
# 🔴 判別力靠**同一張單的前後對照**:同樣的單,有 quantity>0 的列時**擋**、只剩溢收列時**放**
#    ⇒ 排除掉「取消功能整個壞了」這類共同原因。
# ⚠️ **界(codex 關卡2 C8;我原本寫「唯一的變因就是那個述詞」= 太強)**:
#    刪掉那筆到貨列的同時,A4a 也會把 `received_quantity` / `instock_quantity` 一起改掉
#    ⇒ 若日後有人把取消閘改成**讀摘要值**而不是讀 receipts 列,本格**照樣會綠**。
#    本格證的是「**有真到貨列 vs 只剩溢收列**這個差異會改變取消結果」,
#    **不宣稱**它能釘死「閘一定是用 `r.quantity > 0` 這個述詞實作的」。
cell "G1 🏁 Q6=A:有真到貨 ⇒ 擋取消;刪到只剩溢收列(quantity=0)⇒ 放行" "
  SELECT order_id INTO v_ord FROM public.order_items WHERE id=v_item;
  IF EXISTS (SELECT 1 FROM public.order_items oi
              JOIN public.order_item_procurement p ON p.order_item_id=oi.id
              JOIN public.order_item_procurement_receipts r ON r.procurement_id=p.id
             WHERE oi.order_id=v_ord AND oi.id<>v_item AND r.quantity>0)
  THEN RAISE EXCEPTION 'G1 前提不足:同單其它品項已有真到貨,本格無判別力'; END IF;
  v_r := public.admin_record_item_receipt(v_proc, 1, 0, now()-interval '1 hour', NULL, 'staff_1', 'g1a-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'G1 真到貨列沒寫進去(回 %)', v_r; END IF;
  SELECT id INTO v_rid FROM public.order_item_procurement_receipts WHERE procurement_id=v_proc AND quantity=1;
  v_r := public.admin_record_item_receipt(v_proc, 0, 5, now()-interval '1 hour', NULL, 'staff_1', 'g1b-'||v_proc::text);
  IF v_r <> 'RECORDED' THEN RAISE EXCEPTION 'G1 溢收列沒寫進去(回 %)', v_r; END IF;
  -- fixture:把這張單推進「本來就可以取消」的狀態(a8c1 步 6/7 的前置與本片無關)——
  -- actor 必須是**啟用中的 staff**(`staff_1`)、payment_status=unpaid、且付款嘗試全為終態 failed。
  -- 🔴 第一版漏了這兩道,結果「有真到貨 ⇒ 擋取消」那半**是被 actor 閘擋的、不是被到貨閘擋的**
  --    = 假綠(拿掉全部到貨列它照樣『擋』)。判別力真正的來源是下面的**前後對照**。
  UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL, cancelled_reason=NULL WHERE id=v_ord;
  UPDATE public.payment_charge_attempts SET status='failed' WHERE order_id=v_ord AND status<>'failed';
  BEGIN
    PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
    RAISE EXCEPTION 'G1 有真到貨竟然還能取消';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'G1 有真到貨竟然還能取消%' THEN RAISE; END IF;
  END;
  v_r := public.admin_delete_item_receipt(v_rid, 'staff_1', 'g1d-'||v_proc::text);
  IF v_r <> 'DELETED' THEN RAISE EXCEPTION 'G1 刪真到貨列回 %', v_r; END IF;
  PERFORM public.admin_cancel_order(v_ord, gen_random_uuid(), 'staff_1', 'customer_request', NULL);
  IF (SELECT cancelled_at FROM public.orders WHERE id=v_ord) IS NULL
  THEN RAISE EXCEPTION 'G1 只剩溢收列時竟仍擋住取消 —— 與 Sean Q6=A 相反'; END IF;"

echo "──────────────────────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL MUT=$MUT(未殺 $MUT_BAD) PEND=$PEND"
echo "⚠️ 已知覆蓋缺口(誠實記,不假裝測過):"
echo "   · E4 只證了 ROW_COUNT 判斷的**結構在**,**沒有證真併發雙刪的行為** ——"
echo "     那需要兩條連線 rendezvous(w6 系列那種形制),本片未做。"
echo "   · 🔴 record 的 unique_violation 併發 fallback(migration 步 8 的 EXCEPTION 枝)**零行為覆蓋**:"
echo "     單連線下第二次呼叫在步 6 快篩就看得見自己未提交的 ledger 列 ⇒ 永遠走不到那一枝。"
echo "     D3 只證了『單連線同鍵跨採購列會被明確擋下且不外洩 23505』。同鍵**跨採購列的真併發**未測。"
echo "   · 🔴 record 註解宣稱『同鍵同採購列由 proc 列鎖序列化』——**結構推論,無 rendezvous 實測**。"
echo "   · 🔴 品項層額度守門(甲片)的**真併發未測**:它讀 order_cancellation_items / receipts 兩張真相表"
echo "     但**沒有鎖那兩張表**;與取消 RPC 的序列化靠的是雙方都鎖同一列 order_items"
echo "     (20260805100000:367-370 與本片的 order_items NKU)—— 那是**字面**,但交錯行為需兩條連線"
echo "     rendezvous 才驗得到,本片未做。"
echo "   · 🔴 v_cancelled = 0 卻超出額度的 RAISE 枝**不可達是推導**(A2b1 不變式 + 採購層守門兩式相接),"
echo "     **沒有負測**。A2b1 若被改動,這條推導要重做。"
echo "   · E5 的 fail-closed 分支在正常路徑構造不出來(停掉 A4a 才測得到);證的是那一枝活著、"
echo "     **不宣稱**它會在正常路徑被觸發。"

GATE_FAIL=0
[ "$FAIL" -eq 0 ] || { echo "🔴 有 $FAIL 格紅"; GATE_FAIL=1; }
[ "$MUT_BAD" -eq 0 ] || { echo "🔴 有 $MUT_BAD 發突變沒殺掉"; GATE_FAIL=1; }
count_gate "$EXPECTED_TOTAL" "$((PASS+FAIL))" || { echo "🔴 格數 $((PASS+FAIL)) ≠ 凍結值 $EXPECTED_TOTAL"; GATE_FAIL=1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 突變數 $MUT ≠ 凍結值 $EXPECTED_MUT"; GATE_FAIL=1; }
count_gate "$EXPECTED_PEND" "$PEND" || { echo "🔴 留白格 $PEND ≠ 凍結值 $EXPECTED_PEND(留白被刪或新增未登記)"; GATE_FAIL=1; }
if [ "$PEND" -gt 0 ]; then
  echo "🟡 尚有 $PEND 格留白等人拍板 ⇒ **本線未完成**,不得據此宣稱 a2 驗收全數通過。"
fi
[ "$GATE_FAIL" -eq 0 ] || exit 1
echo "✅ #352-a2 驗收全綠(留白格另計)"
