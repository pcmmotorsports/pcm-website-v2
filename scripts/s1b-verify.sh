#!/usr/bin/env bash
# S1b 採購表供應商欄改 FK — 驗收 harness
#
# 用法:bash scripts/s1b-verify.sh [<work-dir>]     預設 /tmp/s1b-work
# 前置:scripts/d1t2-rehearsal.sh provision <work-dir>(會套完全部 migrations 並種 41 筆 order_items)
#
# 四段:0 自我測試 / A 結構與回歸 / B 行為負測 / C 突變證明。
# 🔴 §C 之後逐條列出「只有結構斷言、無突變證明」的項目,不含混宣稱「每條守門都證過承重」。
# 🔴 §B6/B7 記錄一個實測發現:FK 的 ON DELETE RESTRICT 在「刪供應商」這個方向
#    被 S1a 的 BEFORE DELETE trigger **支配**(trigger 先炸,FK 永遠輪不到)
#    ⇒ 不停用那支 trigger 就物理上觀察不到 23503。這不是 no-op,是縱深防禦的第二層,
#    但**不得**宣稱它被獨立證明過(memory `feedback_unconstructible-negative-test-means-noop-guard`)。

set -uo pipefail

WORK="${1:-/tmp/s1b-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

q() { psql "$URL" -tAX -c "$1" 2>&1; }

# ── 身分閘(照 s1a-verify.sh:marker + data_directory + db 名三重)──
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下 —— 這不是本 harness 的拋棄式庫;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }

expect_red() {
  local label="$1" want_txt="$2" want_state="$3" sql="$4" out rc state
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label — 竟然成功了(期望被擋)"; return; fi
  # 🔴 psql VERBOSITY verbose 的格式是 `ERROR:  23505: 訊息`,不是 `SQLSTATE: 23505`。
  #    s1a-verify.sh 抄過來的舊 pattern 對不上 ⇒ 主路徑其實從未命中、一直靠下面的 fallback。
  #    兩條都留(fallback 是 SQLSTATE 的權威來源),但主路徑必須真的能用,否則等於只有一條腿。
  state="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$sql" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  [ -n "$state" ] || state="$(psql "$URL" -tAX <<SQL 2>&1 | tr -d ' \n'
DO \$\$ BEGIN
  BEGIN $sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLSTATE; END;
END \$\$;
SQL
)"
  case "$out" in
    *"$want_txt"*) : ;;
    *) bad "$label — 紅了但訊息不符;實際:$(printf '%s' "$out" | head -1)"; return ;;
  esac
  case "$state" in
    *"$want_state"*) ok "$label(紅在 $want_txt / $want_state)" ;;
    *)               bad "$label — 訊息對但 SQLSTATE 不符:期望 $want_state、實際 $state" ;;
  esac
}
expect_green() {
  local label="$1" sql="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"
  if [ $? -eq 0 ]; then ok "$label"; else bad "$label — 應成功卻失敗:$(printf '%s' "$out" | head -1)"; fi
}

echo "== 0. harness 自我測試 =="
st_ok=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT FROM WHERE;" 2>&1)"; [ $? -ne 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1;" 2>&1)";        [ $? -eq 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1/0;" 2>&1)"
case "$o" in *"division by zero"*) : ;; *) st_ok=0 ;; esac
[ "$st_ok" = "1" ] && ok "自我測試:壞 SQL 判紅、好 SQL 判綠、錯誤訊息取得正確" \
  || { echo "🔴 harness 自我測試失敗 — 後面結果不可信"; exit 1; }

# 🔴 SQLSTATE 兩條取得路徑各自證明可用(關卡2 #9):本 harness 首跑就是因為主路徑失效
#    才 5 格全紅;修好之後若沒有這兩條斷言,主路徑哪天再壞回去會被 fallback 靜默蓋掉。
sqlstate_primary="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "SELECT 1/0;" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
[ "$sqlstate_primary" = "22012" ] && ok "自我測試:SQLSTATE 主路徑(verbose 解析)可用" \
  || bad "SQLSTATE 主路徑失效 — 取得 [$sqlstate_primary],整組 SQLSTATE 判定只剩 fallback 一條腿"
sqlstate_fallback="$(psql "$URL" -tAX <<'SQL' 2>&1 | tr -d ' \n'
DO $$ BEGIN
  BEGIN SELECT 1/0; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLSTATE; END;
END $$;
SQL
)"
case "$sqlstate_fallback" in *22012*) ok "自我測試:SQLSTATE fallback 路徑可用" ;;
  *) bad "SQLSTATE fallback 失效 — 取得 [$sqlstate_fallback]" ;; esac

# fixture:真實 order_item + 兩家供應商(不是自己造假 FK 目標)
# 🔀 2026-08-03 A2b1/A4a 連動修訂(a4a plan §7 同族;家族序跑抓到的既有債):
#    d1t2 seed 的 41 筆品項全部 quantity=1 ⇒ A2b1 守門(08-03 落地)讓「拆兩家 1+1」與
#    business_key 突變攻擊(同對重插)都被 P2B01 先擋 —— 本檔自 08-01 寫成時無守門、從未列入
#    a2b1 家族名單所以沒被發現。修法 = 自建 qty=5 的真實品項(仍是真 FK 目標)、trap 清除。
ORDERS_BASE="$(q "SELECT count(*) FROM public.orders")"
psql "$URL" -v ON_ERROR_STOP=1 -tAX >/dev/null 2>&1 <<'S1BFX'
DO $fx$
DECLARE v_cust uuid; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9993-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9993-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9993-0001', v_cust,
          jsonb_build_object('name','S1b 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'S1B-P5A', '{"title":"s1b a","sku":"S1B-P5A","spec":{}}'::jsonb, 5, 0, 0);
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'S1B-P5B', '{"title":"s1b b","sku":"S1B-P5B","spec":{}}'::jsonb, 5, 0, 0);
END $fx$;
S1BFX
[ $? -eq 0 ] || { echo "🔴 s1b fixture 建立失敗;拒跑"; exit 1; }
s1b_cleanup() {
  psql "$URL" -tAX -c "DELETE FROM public.order_item_procurement WHERE order_item_id IN (SELECT id FROM public.order_items WHERE variant_sku LIKE 'S1B-%')" >/dev/null 2>&1 || true
  psql "$URL" -tAX -c "DELETE FROM public.order_item_quantity_summary WHERE order_item_id IN (SELECT id FROM public.order_items WHERE variant_sku LIKE 'S1B-%')" >/dev/null 2>&1 || true
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9993-0001'" >/dev/null 2>&1 || echo "🔴 s1b cleanup:fixture 訂單殘留" >&2
}
trap s1b_cleanup EXIT
ITEM="$(q "SELECT id FROM public.order_items WHERE variant_sku='S1B-P5A'")"
ITEM2="$(q "SELECT id FROM public.order_items WHERE variant_sku='S1B-P5B'")"
SUP="$(q "SELECT id FROM public.suppliers WHERE label='AKOSO'")"
SUP2="$(q "SELECT id FROM public.suppliers WHERE label='PROTI'")"
for v in "$ITEM:order_item" "$ITEM2:order_item2" "$SUP:AKOSO" "$SUP2:PROTI"; do
  case "${v%%:*}" in
    "" | *ERROR*) echo "🔴 fixture 取不到(${v##*:})—— provision 是否跑過?拒跑"; exit 1 ;;
  esac
done
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "0" ] \
  && ok "起始狀態:採購表 0 列(fixture 品項 qty=5 ×2 自建)" || { echo "🔴 採購表非空,負測會被前一輪殘留污染;拒跑"; exit 1; }

echo "== A. 結構與回歸 =="
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped AND attname IN ('supplier_name','supplier_canonical_key')")" = "0" ] \
  && ok "舊兩個文字欄零殘留" || bad "supplier_name / supplier_canonical_key 仍在"
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped AND attname='supplier_id' AND atttypid='uuid'::regtype AND attnotnull")" = "1" ] \
  && ok "supplier_id 為 uuid NOT NULL" || bad "supplier_id 型別或 NOT NULL 不符"
# 🔴 關卡2 R2:補 convalidated —— FK 改成 NOT VALID 仍會擋新插入的壞列,
#    整組行為負測與 PASS 數完全不變,但既有列從未被檢查過。
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_supplier_id_fkey' AND contype='f' AND confrelid='public.suppliers'::regclass AND confdeltype='r' AND confupdtype='r' AND convalidated")" = "1" ] \
  && ok "FK 具名、指向 suppliers、ON DELETE/UPDATE 皆 RESTRICT、且 convalidated" || bad "FK 定義不符(含 convalidated)"
# 🔴 關卡2 R2:約束**雙向集合相等**。原本 harness 完全沒驗這個,
#    卻在誠實邊界那節寫「約束集合相等 …… 皆為結構斷言」= 宣稱大於事實。
CONSTRAINT_SET="order_item_procurement_allocated_range,order_item_procurement_business_key,order_item_procurement_contact_channel_nonempty,order_item_procurement_exception_reason_nonempty,order_item_procurement_order_item_id_fkey,order_item_procurement_pkey,order_item_procurement_received_range,order_item_procurement_reply_status_check,order_item_procurement_supplier_id_fkey,order_item_procurement_supplier_order_no_nonempty"
[ "$(q "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND contype IN ('c','u','p','f')")" = "$CONSTRAINT_SET" ] \
  && ok "約束集合雙向相等(少一條或多一條都會紅)" \
  || bad "約束集合不符 — 實為 $(q "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND contype IN ('c','u','p','f')")"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND contype='c' AND NOT convalidated")" = "0" ] \
  && ok "零未驗證 CHECK" || bad "有未驗證 CHECK"
# 🔴 關卡2 R2:採購表 ACL 原本只驗四格,補成與 migration §4.9 同一套(含 is_grantable / PUBLIC / 欄級 / policy)
PACL_SQL="SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p), '<無>') FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.order_item_procurement'::regclass AND a.grantee <> c.relowner) x"
[ "$(q "$PACL_SQL")" = "service_role:SELECT:false" ] \
  && ok "採購表 ACL 攤平比對:恰 service_role:SELECT:false" || bad "採購表 ACL 不符 — 實為 $(q "$PACL_SQL")"
[ "$(q "SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.order_item_procurement'::regclass AND a.grantee=0")" = "0" ] \
  && ok "採購表 PUBLIC 零授權" || bad "採購表對 PUBLIC 有授權"
[ "$(q "SELECT count(*) FROM pg_policy WHERE polrelid='public.order_item_procurement'::regclass")" = "0" ] \
  && ok "採購表 zero-policy" || bad "採購表出現 policy"
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped AND attacl IS NOT NULL")" = "0" ] \
  && ok "採購表零欄級 ACL" || bad "採購表有欄級 ACL"
[ "$(q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_business_key'")" = "UNIQUE (order_item_id, supplier_id)" ] \
  && ok "business key 定義逐字為 UNIQUE (order_item_id, supplier_id)" || bad "business key 定義不符"
[ "$(q "SELECT pg_get_indexdef('public.order_item_procurement_supplier_id_idx'::regclass)")" = "CREATE INDEX order_item_procurement_supplier_id_idx ON public.order_item_procurement USING btree (supplier_id)" ] \
  && ok "供應商維度索引已補回(舊 canonical 單欄索引的等價物)" || bad "supplier_id 索引定義不符"
[ "$(q "SELECT to_regclass('public.order_item_procurement_canonical_key_idx') IS NULL")" = "t" ] \
  && ok "舊 canonical_key 索引已移除" || bad "舊 canonical 索引仍在"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname IN ('order_item_procurement_supplier_name_nonempty','order_item_procurement_canonical_key_nonempty')")" = "0" ] \
  && ok "兩條依附舊欄的 CHECK 已隨欄消失" || bad "舊供應商 CHECK 仍在"
# 🔴 註解掃全表(表 + 全欄),不是只看被我改到的那幾處
[ "$(q "SELECT count(*) FROM pg_description WHERE objoid='public.order_item_procurement'::regclass AND classoid='pg_catalog.pg_class'::regclass AND (description LIKE '%canonical%' OR description LIKE '%supplier_name%')")" = "0" ] \
  && ok "表與欄註解:canonical / supplier_name 舊字面零殘留" || bad "註解仍提到已不存在的欄"
[ "$(q "SELECT count(*) FROM pg_description d JOIN pg_constraint c ON c.oid=d.objoid WHERE d.classoid='pg_catalog.pg_constraint'::regclass AND c.conrelid='public.order_item_procurement'::regclass AND (d.description LIKE '%canonical%' OR d.description LIKE '%supplier_name%') AND c.conname <> 'order_item_procurement_business_key'")" = "0" ] \
  && ok "約束註解:舊字面只出現在 business key 的結案說明裡" || bad "別的約束註解仍提到舊欄"
# 🔴 關卡2 #16:原本斷言 `description LIKE '%結案%'` —— 那正是我在 migration 註解裡
#    罵過的「拿措辭當守門」:把整段理由刪光、只留「結案」兩個字照樣 PASS。
#    改成比對它必須真的記住的三件具體事:舊債出處、A5b 下場、inactive 新債。
BK_DESC_SQL="SELECT d.description FROM pg_description d JOIN pg_constraint c ON c.oid=d.objoid WHERE d.classoid='pg_catalog.pg_constraint'::regclass AND c.conrelid='public.order_item_procurement'::regclass AND c.conname='order_item_procurement_business_key'"
for probe in "123-126:舊債出處(A2 migration 行號)" "A5b:canonical key 函式的下場" "is_active:FK 不驗可用的新債"; do
  key="${probe%%:*}"; what="${probe#*:}"
  [ "$(q "$BK_DESC_SQL" | grep -c -- "$key")" -ge 1 ] \
    && ok "business key 註解載明【$what】" || bad "business key 註解漏了【$what】= 債務蒸發"
done
# 表註解必須同時留住 A1 的更正與本片的說明(整段覆蓋 ⇒ 少帶一段就是靜默刪掉上一次的修正)
TBL_DESC="$(q "SELECT description FROM pg_description WHERE objoid='public.order_item_procurement'::regclass AND classoid='pg_catalog.pg_class'::regclass AND objsubid=0")"
case "$TBL_DESC" in
  *order_item_quantity_summary*S1b*|*S1b*order_item_quantity_summary*) ok "表註解同時保留 A1 更正與 S1b 說明" ;;
  *) bad "表註解漏了 A1 更正或 S1b 說明 —— 實際開頭:$(printf '%s' "$TBL_DESC" | head -c 60)" ;;
esac
[ "$(q "SELECT count(*) FROM pg_description d JOIN pg_attribute a ON a.attrelid=d.objoid AND a.attnum=d.objsubid WHERE d.objoid='public.order_item_procurement'::regclass AND d.classoid='pg_catalog.pg_class'::regclass AND a.attname='supplier_id' AND d.description LIKE '%is_active%'")" = "1" ] \
  && ok "supplier_id 欄註解存在且載明「FK 不驗 is_active」" || bad "supplier_id 欄註解缺漏或沒記新債"
# 回歸:本片不得動 A2 定下的 RLS/ACL
[ "$(q "SELECT relrowsecurity FROM pg_class WHERE oid='public.order_item_procurement'::regclass")" = "t" ] \
  && ok "回歸:RLS 仍啟用" || bad "RLS 被關掉"
[ "$(q "SELECT has_table_privilege('service_role','public.order_item_procurement','SELECT') AND NOT (has_table_privilege('service_role','public.order_item_procurement','INSERT') OR has_table_privilege('service_role','public.order_item_procurement','UPDATE') OR has_table_privilege('service_role','public.order_item_procurement','DELETE'))")" = "t" ] \
  && ok "回歸:service_role 對採購表仍只有 SELECT" || bad "service_role 權限被本片改寬"
# 回歸:S1a 的主檔沒被本片動到
[ "$(q "SELECT count(*) FROM public.suppliers")" = "26" ] \
  && ok "回歸:suppliers 仍為 26 列" || bad "suppliers 列數被本片改動"

echo "== B. 行為負測 =="
expect_red "supplier_id 不得為 NULL" "null value in column" "23502" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', NULL, 1)"
expect_red "指向不存在的供應商" "order_item_procurement_supplier_id_fkey" "23503" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', gen_random_uuid(), 1)"

expect_green "合法採購列(品項 A + AKOSO)" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP', 1)"
expect_red "同品項同供應商插第二次" "order_item_procurement_business_key" "23505" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP', 2)"
# 🔴 對照組:證明 business key 是「複合」的,不是把 order_item_id 鎖成一列
#    (少了這條,把鍵寫成 UNIQUE(order_item_id) 也會全綠 —— 而那會禁止一品項拆兩家)
expect_green "同品項不同供應商(拆單給兩家)" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP2', 1)"
expect_green "不同品項同供應商" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM2', '$SUP', 1)"

# B6/B7:刪供應商的兩層防線 —— 實測誰先攔
expect_red "刪除已被採購引用的供應商(第一層 = S1a trigger)" "不可刪除" "P0001" \
  "DELETE FROM public.suppliers WHERE id='$SUP'"
# 🔴 關卡2 #10:原本這個手寫 case 只比訊息片段卻記成「23503」⇒ 同訊息配錯碼照樣 PASS。
#    改成用 DO 包住取真 SQLSTATE,碼與約束名兩者都比。
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
ALTER TABLE public.suppliers DISABLE TRIGGER suppliers_no_delete;
DO \$probe\$ BEGIN
  BEGIN DELETE FROM public.suppliers WHERE id='$SUP'; RAISE NOTICE 'PROBE-GREEN';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PROBE-RED %|%', SQLSTATE, SQLERRM; END;
END \$probe\$;
ROLLBACK;
SQL
)"
case "$o" in
  *"PROBE-RED 23503|"*order_item_procurement_supplier_id_fkey*) ok "停用 S1a trigger 後,FK ON DELETE RESTRICT 接手擋下(23503 + 約束名皆比對)= 第二層承重" ;;
  *) bad "停用 trigger 後 FK 沒擋住或 SQLSTATE 不符 —— 實際:$(printf '%s' "$o" | grep PROBE | head -1)" ;;
esac
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.suppliers'::regclass AND NOT tgisinternal AND tgenabled='O'")" = "3" ] \
  && ok "上一步 ROLLBACK 後三支 trigger 仍啟用(零留痕)" || bad "trigger 啟用態沒還原"

# ON UPDATE RESTRICT 沒有 trigger 支配它 ⇒ 可直接觀察
expect_red "改動已被引用的供應商 id" "order_item_procurement_supplier_id_fkey" "23503" \
  "UPDATE public.suppliers SET id=gen_random_uuid() WHERE id='$SUP'"
# 🔴 包在交易裡跑:改名會觸發 S1a 的 touch trigger 推進 updated_at,
#    那是**持久狀態**,留下去會讓 s1a-verify 的 touch_updated 突變格靜默轉紅
#    (2026-08-01 實際踩到)。harness 不得對別支 harness 的前提造成副作用。
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
UPDATE public.suppliers SET label='AKOSO 改名測試' WHERE id='$SUP';
ROLLBACK;
SQL
)"
case "$o" in
  *ERROR*) bad "改名(只動 label)被擋 —— ON UPDATE RESTRICT 不該波及 label;實際:$(printf '%s' "$o" | grep ERROR | head -1)" ;;
  *) ok "改名(只動 label)不受阻,且交易 ROLLBACK 零留痕" ;;
esac
[ "$(q "SELECT count(*) FROM public.suppliers WHERE label='AKOSO'")" = "1" ] \
  && ok "改名測試已完全還原(AKOSO 仍在)" || bad "改名測試留下殘留"

# 清理
psql "$URL" -q -c "DELETE FROM public.order_item_procurement;" >/dev/null 2>&1
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "0" ] \
  && ok "清理後採購表回到 0 列" || bad "清理未完成,殘留列"
[ "$(q "SELECT count(*) FROM public.suppliers")" = "26" ] \
  && ok "清理後 suppliers 仍為 26 列" || bad "suppliers 被負測改動"

echo "== C. 突變證明(拿掉守門 ⇒ 對應攻擊必須成功)=="
mutate() {
  local label="$1" drop="$2" attack="$3" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$drop
$attack
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "突變 $label ⇒ 攻擊成功 = 該守門承重"
  else bad "突變 $label ⇒ 攻擊仍失敗 = 可能是死碼或被別道蘊含;實際:$(printf '%s' "$out" | head -1)"; fi
}
mutate "supplier_id_fkey(存在性)" \
  "ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_supplier_id_fkey;" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', gen_random_uuid(), 1);"
# 🔴 關卡2 #18:原本這格是「把整條 FK 刪掉」⇒ 它只證明「某條 FK 在擋」,
#    分不出 RESTRICT 與 NO ACTION,更不是 ON UPDATE 這個 action 的證據。
#    改成 action-specific:把 FK 原地換成 ON UPDATE CASCADE,
#    攻擊必須「成功**且**子列真的被串連改掉」——只有 action 不同,其餘完全一樣。
mutate "supplier_id_fkey 的 ON UPDATE 分支(RESTRICT → CASCADE)" \
  "ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_supplier_id_fkey;
   ALTER TABLE public.order_item_procurement
     ADD CONSTRAINT order_item_procurement_supplier_id_fkey FOREIGN KEY (supplier_id)
     REFERENCES public.suppliers(id) ON DELETE RESTRICT ON UPDATE CASCADE;" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP', 1);
   UPDATE public.suppliers SET id='11111111-1111-1111-1111-111111111111' WHERE id='$SUP';
   DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM public.order_item_procurement
                     WHERE supplier_id='11111111-1111-1111-1111-111111111111') THEN
       RAISE EXCEPTION 'CASCADE 沒有串連到子列 = 這格沒測到 ON UPDATE 分支';
     END IF;
   END \$\$;"
mutate "business_key" \
  "ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_business_key;" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP', 1);
   INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', '$SUP', 2);"
mutate "supplier_id NOT NULL" \
  "ALTER TABLE public.order_item_procurement ALTER COLUMN supplier_id DROP NOT NULL;" \
  "INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM', NULL, 1);"

[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "0" ] \
  && ok "全部突變 ROLLBACK 後採購表仍 0 列(零留痕)" || bad "突變留下殘留列"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname IN ('order_item_procurement_supplier_id_fkey','order_item_procurement_business_key')")" = "2" ] \
  && ok "全部突變 ROLLBACK 後兩條約束都還在(零留痕)" || bad "突變後約束沒還原"

echo
echo "== 🔴 只有結構斷言、**沒有**突變證明的項目(不得宣稱已證承重;關卡2 #19 補齊)=="
echo "   · order_item_procurement_supplier_id_idx —— 索引是效能物件,拿掉不改變任何可觀察的正確性"
echo "   · FK 的 **ON DELETE** 分支 —— 只有存在性與 ON UPDATE 兩格有突變;"
echo "     沒有做「ON DELETE 改 CASCADE」的突變(改了會刪到採購真相列,代價高於證據價值)"
echo "   · 三段 COMMENT —— 驗的是 **presence gate**(必要關鍵字在、禁字不在),**不是語意守門**:"
echo "     把整段理由反過來寫、只要 A5b / is_active / 123-126 這幾個字還在,仍然全綠。"
echo "     文字層的東西只能做到這裡;要更強得靠人讀 diff(關卡2 R2 明確不接受把它稱作語意驗證)"
echo "   · 舊物件消失(兩條 CHECK、canonical 索引、舊欄)—— 只有結構斷言,"
echo "     沒有「把它們加回去就必須轉紅」的反向突變"
echo "   · 約束集合相等 / ACL 攤平比對 / zero-policy / 欄級 ACL —— 皆為結構斷言,無突變"
echo "   · RLS / ACL 屬**回歸**斷言(本片沒改它們),不是本片的守門"
echo
echo "== 誠實邊界(實測,非推論)=="
echo "   🔴 刪供應商時,S1a 的 BEFORE DELETE trigger **先攔**(P0001)⇒ FK 的 23503 在正常狀態下"
echo "      物理上觀察不到。B7 是把那支 trigger 停用後才看到 FK 接手 ——"
echo "      FK RESTRICT 是縱深防禦的第二層,**不是**獨立可觀察的第一道。"
echo "   🔴 FK 只驗『這家存在』、不驗『這家可用』:指向 is_active=false 的供應商 DB 層合法,"
echo "      拒收停用供應商是 A5a 寫入 RPC 的契約(尚未實作)。"
echo "   🔴 本片零 writer:採購表至今沒有任何 INSERT 路徑(service_role 只有 SELECT、A5a RPC 未建)"
echo "      ⇒ 本 harness 是以 owner 身分直插來測形狀,不是在測真實寫入流程。"
echo "   🔴 本機 C locale ≠ 正式站 en_US.UTF-8(#305);database.types.ts 重 gen 需 apply 後才做得了。"
echo
echo "== 收尾:顯式清理 + 基準斷言(codex K2-7:trap 失敗不得靜默 exit 0)=="
s1b_cleanup
trap - EXIT
[ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_BASE" ] \
  && [ "$(q "SELECT count(*) FROM public.order_items WHERE variant_sku LIKE 'S1B-%'")" = "0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "0" ] \
  && ok "零殘留:orders 回基準($ORDERS_BASE)、S1B fixture 品項 0、採購表 0" \
  || bad "殘留:fixture 清理不完整(orders=$(q "SELECT count(*) FROM public.orders") 基準=$ORDERS_BASE)"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] || exit 1
