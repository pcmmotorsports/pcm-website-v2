#!/usr/bin/env bash
# ============================================================
# #347-1 驗證 harness:public.admin_search_orders(text, integer)
# ============================================================
# 用法:scripts/d1t2-rehearsal.sh provision /tmp/347-work
#       scripts/347-1-verify.sh [workdir]
#
# 形狀照 l3-verify.sh:計數器 + 身分閘 + 每格自包 BEGIN…ROLLBACK 零留痕
#                    + DB 內突變格(改壞函式 → 驗對應那格翻面 → 還原)。
#
# ── 這支 harness 要證明什麼 ─────────────────────────────────────────────────
# ① **八個維度各自真的在做事**:每個維度一格正測(只有它含毒值的那張單被撈到)。
# ② **正測不是「碰巧全撈」**:每格的期望值是**恰好一張**指定的單 ——
#    若實作變成「條件恆真」,回來的會是十張以上,格子當場紅。
#    🔴 **每個維度的「負測」就藏在這裡,而且比一格共用的 miss 更嚴格**:
#    搜維度 X 的毒值時,另外九張(各自帶別的維度毒值)**都必須不命中** ——
#    等於每一格同時是「X 要中」與「其餘九個維度不得誤中」的九條負向斷言。
#    B1 那格(查不存在的字串)是額外的整體 miss,不是唯一的負測。
# ③ **每個維度的守門有判別力**:D 區逐維度把該維度的欄位表達式換成 `''`(該分支變死碼),
#    只重跑**對應那一格**,驗它從命中變零命中。⚠️ 不宣稱「只翻那一格」——
#    宣稱的是「拿掉這個維度 ⇒ 這個維度的正測會紅」。
# ④ **合約行為**:空白短路 / 無萬用字元語意 / p_limit 夾取 / truncated / 排序 / 同單不重複。
# ⑤ **ACL**:service_role 可執行、PUBLIC/anon/authenticated 不可。
#
# ── ⚠️ 它擋不住什麼(誠實邊界)────────────────────────────────────────────────
# · 本機是 **vanilla PG17,不是 Supabase**:沒有 PostgREST ⇒ 「PostgREST 找不找得到這個
#   overload」「service_role 走 HTTP 打得通嗎」**一格都測不到**。那半只有 apply 當下的
#   fail-closed 斷言 + 收割端的真站 smoke。
# · 沒有測效能(逐列掃描的天花板寫在 migration 檔頭,不在這裡驗)。
# · 「搜尋詞不落 log」由 migration 的斷言 E 用**字面**守(函式體零 RAISE);
#   本 harness **沒有**去讀真的 server log ⇒ 那條是字面證據,不是觀察證據。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="${1:-/tmp/347-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
FN="public.admin_search_orders(text, integer)"
MIGFILE="supabase/migrations/20260809180000_m4b_347_1_admin_search_orders.sql"
PASS=0; FAIL=0; MUT=0

# 🔴 突變是在交易外改真函式(CREATE OR REPLACE 不能在別的連線讀著的同時回滾)⇒ 中斷在還原前,
#    這個隔離 DB 會永久留著壞函式,之後任何人跑別的 harness 都在測錯的東西。
#    還原 = 重跑 migration(它自己是 CREATE OR REPLACE + 斷言,重跑安全)。
NEED_RESTORE=0
restore() {
  if [ "$NEED_RESTORE" = "1" ]; then
    if psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$MIGFILE" >/dev/null 2>&1; then
      echo "  ♻️  函式已還原" >&2
    else
      # 🔴 還原失敗**必須計入 FAIL**(codex R1):第一版只印一行紅字就把旗標清掉,
      #    最後一格失敗時整支仍以 `FAIL=0` exit 0 ⇒ 「全綠」報告 + 一個被污染的 cluster。
      echo "  🔴 還原失敗,這個 cluster 已污染 —— 重跑 provision" >&2
      FAIL=$((FAIL+1))
    fi
    NEED_RESTORE=0
  fi
}
trap restore EXIT
trap 'echo "  ⚠️ 收到中斷訊號,還原後結束" >&2; restore; exit 130' INT TERM

q() { psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

GAP=0
gap() { # gap <名稱> <期望> <實得> —— **已知缺口**專用,不計入 PASS
  # 🔴 已知的產品缺陷不該被算成「35 項正確行為」之一(codex R2):把它混進 PASS,
  #    讀報告的人會以為那是一條被滿足的需求;而缺口哪天被修好,它反而會讓整支翻紅。
  #    ⇒ 獨立計數、獨立措辭:「目前行為如此,且這是已知缺口」。
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    GAP=$((GAP+1)); printf '  🕳️  %-56s = %s(已知缺口,行為如預期)\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); printf '  ❗ %-56s 缺口行為變了(期望 [%s] 實得 [%s])—— 可能已被修好,回頭更新 migration 檔頭的缺口段\n' "$name" "$want" "$got"
  fi
}

cell() { # cell <名稱> <期望> <實得>
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); printf '  ✅ %-56s = %s\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %-56s 期望 [%s] 實得 [%s]\n' "$name" "$want" "$got"
  fi
}

# ── 身分閘(跑錯庫比跑錯斷言更糟)────────────────────────────────────────────
echo "== 身分閘 =="
q "SELECT 1" >/dev/null 2>&1 || { echo "🔴 連不上 $URL —— 先跑 scripts/d1t2-rehearsal.sh provision $WORK"; exit 1; }
# 🔴 **跨窗撞庫**(主視窗 D-376-A,P 窗實錘):`d1t2-rehearsal.sh` 預設 port 54329,
#    多個視窗同時排練會連到**別人的 cluster** —— 而斷言照樣跑得出漂亮的數字。
#    ⇒ 連 `data_directory` 一起印、對上自己的 workdir 才採信。
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 54329 上的 cluster 是 [$DATADIR],不是本窗的 [$WORK/pgdata] —— 撞到別的視窗了;拒繼續"
     echo "   換一個專屬 port 重跑:PORT=54331 scripts/d1t2-rehearsal.sh provision /tmp/347-work"
     exit 1 ;;
esac
test -f "$MIGFILE" || { echo "🔴 找不到 $MIGFILE"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc p WHERE p.oid='${FN}'::regprocedure")" = "1" ] \
  || { echo "🔴 ${FN} 不存在(#347-1 未套用?);拒繼續"; exit 1; }

# 🔴 DB 上那支必須是**本片這一版**。錨點要涵蓋「安全性與行為所在的那幾行」——
#    改壞 SECDEF/search_path/owner、或抽掉任一維度,都要讓這道閘紅。
#    ⚠️ 誠實邊界:錨點比對**不是** exact pin(沒用 functiondef 的 md5,那會隨 PG 版本格式化差異假紅)。
DEF_OK="$(q "SELECT (p.prosecdef AND p.proowner='postgres'::regrole
                     AND p.proconfig @> ARRAY['search_path=\"\"'])::text
             FROM pg_proc p WHERE p.oid='${FN}'::regprocedure")"
ANCHORS_OK="$(q "SELECT (position('shipping_address_snapshot ->> ''line''' in d) > 0
                     AND position('order_item_procurement' in d) > 0
                     AND position('c.user_id = o.customer_user_id' in d) > 0
                     AND position('LIMIT v_limit + 1' in d) > 0
                     AND position('truncated' in d) > 0)::text
                 FROM (SELECT pg_get_functiondef('${FN}'::regprocedure) AS d) s")"
[ "$DEF_OK" = "true" ] && [ "$ANCHORS_OK" = "true" ] \
  || { echo "🔴 DB 上的 ${FN} 不是本片版本(secdef/owner/search_path=$DEF_OK、錨=$ANCHORS_OK);拒繼續"; exit 1; }
echo "  ok:函式在且為本片版本、migration 檔在"

# ── 共用假資料 ───────────────────────────────────────────────────────────────
# 🔴 **設計:每張單只在「一個維度」帶自己的毒值,其餘欄位一律乾淨。**
#    這樣「搜毒值 X → 恰好回那一張」才等於「維度 X 真的在做事」。
#    若某格回了兩張以上,代表毒值不夠獨特或條件恆真 —— 兩種都是要修的。
# ⚠️ 毒值挑選:彼此不得互為子字串,也不得出現在 provision 的既有 29 筆資料裡
#    (`PCM-2099-73xx` 與既有的 `PCM-2026-xxxx` 不會互相命中)。
# ⚠️ `display_id` 有 CHECK `^PCM-[0-9]{4}-[0-9]{4,}$`,毒值只能藏在合法格式裡 ⇒ 用年份 2099。
# ⚠️ `product_snapshot` 有白名單 CHECK:**恰好** {title, sku, spec} 且 spec 是 object。
# ⚠️ `customers` 由 `auth.users` 的 trigger 自動建立 ⇒ 姓名/電話要從 raw_user_meta_data 帶進去。
read -r -d '' SETUP <<'SQL'
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','base347@x.test',  '{"name":"CleanCustomer347","phone":"0900000001"}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000002','dname347@x.test', '{"name":"QQD2NAME","phone":"0900000002"}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000003','dphone347@x.test','{"name":"CleanCustomer349","phone":"0999000203"}'::jsonb);

INSERT INTO public.brands (id, name, slug) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001','CleanBrand347','clean-brand-347'),
  ('bbbbbbbb-0000-4000-8000-000000000002','QQD7BRAND','qqd7-brand-347');

INSERT INTO public.products (id, external_id, title, handle, price_by_tier, brand_id, category_id) VALUES
  ('cccccccc-0000-4000-8000-000000000001','ext-347-1','CleanProduct347','clean-347-1','{"general":100,"store":100}'::jsonb,
   'bbbbbbbb-0000-4000-8000-000000000001',(SELECT id FROM public.categories ORDER BY id LIMIT 1)),
  ('cccccccc-0000-4000-8000-000000000002','ext-347-2','CleanProduct348','clean-347-2','{"general":100,"store":100}'::jsonb,
   'bbbbbbbb-0000-4000-8000-000000000002',(SELECT id FROM public.categories ORDER BY id LIMIT 1));

INSERT INTO public.product_variants (id, product_id, sku) VALUES
  ('dddddddd-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','CLEANVAR347'),
  ('dddddddd-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002','CLEANVAR348');

-- 十張單:display_id 尾碼 = 維度編號。created_at 遞增,方便驗排序。
INSERT INTO public.orders
  (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, created_at)
VALUES
  ('PCM-2099-7301','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:01+00'),
  ('PCM-2099-7302','aaaaaaaa-0000-4000-8000-000000000002','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:02+00'),
  ('PCM-2099-7303','aaaaaaaa-0000-4000-8000-000000000003','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:03+00'),
  ('PCM-2099-7304','aaaaaaaa-0000-4000-8000-000000000001','{"name":"QQD4NAME","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:04+00'),
  ('PCM-2099-7305','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0999000405","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:05+00'),
  ('PCM-2099-7306','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"QQD4LINE"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:06+00'),
  ('PCM-2099-7307','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:07+00'),
  ('PCM-2099-7308','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:08+00'),
  ('PCM-2099-7309','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:09+00'),
  ('PCM-2099-7310','aaaaaaaa-0000-4000-8000-000000000001','{"name":"CleanN","phone":"0900000000","line":"Clean Line"}'::jsonb,'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2099-01-01 00:10+00');

-- 每張單一個品項。⑤ 料號、⑥ 品名、⑦ 品牌(靠 variant 指到毒值品牌)各自只在自己那張單。
INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT o.id,
       CASE WHEN o.display_id = 'PCM-2099-7309'
            THEN 'dddddddd-0000-4000-8000-000000000002'::uuid
            ELSE 'dddddddd-0000-4000-8000-000000000001'::uuid END,
       CASE WHEN o.display_id = 'PCM-2099-7307' THEN 'QQD5SKU' ELSE 'CLEANSKU347' END,
       jsonb_build_object(
         'sku', 'CLEANSKU347',
         'spec', '{}'::jsonb,
         'title', CASE WHEN o.display_id = 'PCM-2099-7308' THEN 'QQD6TITLE' ELSE 'Clean Title 347' END),
       1, 100, 100
  FROM public.orders o
 WHERE o.display_id LIKE 'PCM-2099-73%';

-- ⑧ 供應商單號:每個品項掛一筆採購,只有 7310 那筆帶毒值。
-- 🔴 **給空白格一個真的靶**(R3-M2):B17/B18 原本恆真 —— fixture 裡沒有任何一列含 tab
--    或全形空白,所以就算把 btrim 的字元集改回預設,搜 tab 照樣 0 命中、格子照樣綠。
--    ⇒ 這張單的收件地址**真的**含一個 tab 與一個 U+3000。有短路 ⇒ 0 命中;
--      拿掉短路的字元集 ⇒ v_needle 變成那顆空白、命中這一張。負測這才構造得出來。
INSERT INTO public.orders
  (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, created_at)
VALUES
  ('PCM-2097-7311','aaaaaaaa-0000-4000-8000-000000000001',
   jsonb_build_object('name','CleanN','phone','0900000000',
                      'line', 'ZQ' || E'\t' || 'ZQ' || E'\u3000' || 'ZQ'),
   'general',100,0,100,'home','{"type":"personal"}'::jsonb, '2097-01-01 00:01+00');

INSERT INTO public.order_item_procurement (order_item_id, allocated_quantity, supplier_id, supplier_order_no)
SELECT oi.id, 1, (SELECT id FROM public.suppliers ORDER BY id LIMIT 1),
       CASE WHEN o.display_id = 'PCM-2099-7310' THEN 'QQD8PO' ELSE 'CLEANPO347' END
  FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
 WHERE o.display_id LIKE 'PCM-2099-73%';
SQL

# hit <搜尋詞> [limit 參數字面] → 回「命中的 display_id 以逗號串接(排序後)」
hit() {
  local needle="$1" lim="${2:-}"
  local call="public.admin_search_orders('${needle}')"
  [ -n "$lim" ] && call="public.admin_search_orders('${needle}', ${lim})"
  q "
BEGIN;
$SETUP
SELECT COALESCE(string_agg(o.display_id, ',' ORDER BY o.display_id), '(none)')
  FROM public.orders o
 WHERE o.id IN (SELECT (jsonb_array_elements_text(($call) -> 'ids'))::uuid);
ROLLBACK;" | tail -1
}

# meta <搜尋詞> [limit] → 回「命中筆數|truncated」
meta() {
  local needle="$1" lim="${2:-}"
  local call="public.admin_search_orders('${needle}')"
  [ -n "$lim" ] && call="public.admin_search_orders('${needle}', ${lim})"
  q "
BEGIN;
$SETUP
SELECT jsonb_array_length(r -> 'ids')::text || '|' || (r ->> 'truncated')
  FROM (SELECT $call AS r) t;
ROLLBACK;" | tail -1
}

# ── 維度表:編號｜名稱｜毒值｜期望命中的單｜突變目標(欄位表達式)──────────────
DIMS=(
  "1|訂單編號 display_id|2099-7301|PCM-2099-7301|COALESCE(o.display_id, '')"
  "2|會員姓名 customers.name|QQD2NAME|PCM-2099-7302|COALESCE(c.name, '')"
  "3|會員電話 customers.phone|0999000203|PCM-2099-7303|COALESCE(c.phone, '')"
  "4|收件快照 name|QQD4NAME|PCM-2099-7304|COALESCE(o.shipping_address_snapshot ->> 'name', '')"
  "5|收件快照 phone|0999000405|PCM-2099-7305|COALESCE(o.shipping_address_snapshot ->> 'phone', '')"
  "6|收件快照 line|QQD4LINE|PCM-2099-7306|COALESCE(o.shipping_address_snapshot ->> 'line', '')"
  "7|料號 variant_sku|QQD5SKU|PCM-2099-7307|COALESCE(oi.variant_sku, '')"
  "8|品名 product_snapshot.title|QQD6TITLE|PCM-2099-7308|COALESCE(oi.product_snapshot ->> 'title', '')"
  "9|品牌 brands.name|QQD7BRAND|PCM-2099-7309|COALESCE(br.name, '')"
  "10|供應商單號 supplier_order_no|QQD8PO|PCM-2099-7310|COALESCE(pc.supplier_order_no, '')"
)

echo
echo "== A 區:八維度正測(每格期望**恰好一張**指定的單)=="
for d in "${DIMS[@]}"; do
  IFS='|' read -r n name needle want _mut <<<"$d"
  cell "A${n} ${name}" "$want" "$(hit "$needle")"
done

echo
echo "== B 區:負測 + 合約 =="
cell "B1 查無此字串 → 零命中"              "(none)" "$(hit 'ZZNOTHINGZZ347')"
cell "B2 空字串 → 零命中(不是回全部)"      "0|false" "$(meta '')"
cell "B3 全空白 → 零命中(不是回全部)"      "0|false" "$(meta '   ')"
# 🔴 這兩格擋的是「改用 ILIKE 而忘了逃脫」:那時 % 會命中全部訂單 = 整份 PII 一次撈出。
cell "B4 % 不是萬用字元 → 零命中"           "0|false" "$(meta '%')"
cell "B5 _ 不是萬用字元 → 零命中"           "0|false" "$(meta '_')"
# 大小寫不敏感(兩邊都 lower)。
cell "B6 大小寫不敏感"                      "PCM-2099-7307" "$(hit 'qqd5sku')"
# 前後空白會被 btrim 掉。
cell "B7 前後空白被 btrim"                  "PCM-2099-7307" "$(hit '  QQD5SKU  ')"
# 🔴 跨欄假命中:'CleanN' 結尾 + phone 開頭 = 'CleanN0900000000'。
#    實作若把三個子鍵用 || 串起來再比,這格會命中十張單。
cell "B8 收件快照三子鍵不得串接後比對"      "(none)" "$(hit 'CleanN0900000000')"

# 🔴 tab 與**全形空白 U+3000**:btrim 預設清不掉它們 ⇒ 會穿過空白短路、白掃全表。
#    全形空白是中文輸入法下很容易按到的那顆,不是理論邊界。
# 🔴 這兩格的靶是 `PCM-2097-7311`(地址裡真的含 tab 與 U+3000)——沒有那張單,兩格恆真(R3-M2)。
cell "B17 tab 視同空白 → 零命中(有真靶)"   "0|false" "$(meta '	')"
cell "B18 全形空白 U+3000 視同空白 → 零命中" "0|false" "$(meta '　')"
# 前提格:證明那個靶真的存在、且那兩顆空白真的在資料裡 —— 否則上面兩格又會退化成恆真。
cell "B17p 前提:靶單存在且地址含那兩顆空白" "PCM-2097-7311" "$(hit 'ZQ')"

echo
echo "== B 區續:p_limit 與 truncated(共同前綴命中十張)=="
cell "B9  預設(NULL,=100)→ 十張、未截斷"  "10|false" "$(meta 'PCM-2099-73' 'NULL')"
cell "B10 limit=3 → 三張、truncated=true"   "3|true"   "$(meta 'PCM-2099-73' '3')"
# 🔴 合約:NULL 與 <=0 都回預設 200(不是回 1)。第一版實作回 1、與檔頭合約矛盾,codex R1 抓到。
cell "B11 limit=0 → 退回預設 200"           "10|false" "$(meta 'PCM-2099-73' '0')"
cell "B12 limit=-5 → 退回預設 200"          "10|false" "$(meta 'PCM-2099-73' '-5')"
cell "B13 limit=10 → 剛好十張、未截斷"      "10|false" "$(meta 'PCM-2099-73' '10')"
# 🔴 排序 = created_at DESC ⇒ 取前三張應該是 7310/7309/7308,不是 7301/7302/7303。
cell "B14 排序:取前三是最新的三張(集合)"  "PCM-2099-7308,PCM-2099-7309,PCM-2099-7310" "$(hit 'PCM-2099-73' '3')"
# 🔴 上一格用 `hit()`,而 `hit()` 為了輸出穩定會**依 display_id 重排** ⇒ 它只證明「集合對」,
#    **不證明 JSON 陣列裡的順序對**(codex R2:把回傳順序改壞,上一格照樣綠)。
#    這格用 `WITH ORDINALITY` 保留原順序,直接讀 ids 陣列的第 1/2/3 個是誰。
#    ⚠️ 這格**刻意不加 limit**(十張全回、未截斷):不截斷時「集合」恆為那十張、
#    **只有順序會變** ⇒ 這格量的是 B14 量不到的面(B14 走 `hit()`,會依 display_id 重排)。
#    🔴 **誠實標註判別力的實際強度**:我實跑過「只反轉 array_agg 的 ORDER BY」這個突變,
#    結果 **B14 與本格一起翻**,不是本格單獨翻 —— 因為截斷是從陣列**前端**切,
#    同一個運算式同時決定「順序」與「被切下來的是哪三張」,結構上分不開。
#    ⇒ 可宣稱的是:**本格覆蓋了未截斷時的陣列順序,那是 B14 看不到的**;
#      **不可**宣稱「有一個突變只紅本格」。(先前這裡寫成後者,是沒實測就下的斷言。)
ORDERED="$(q "
BEGIN;
$SETUP
SELECT string_agg(o.display_id, ',' ORDER BY e.ord)
  FROM jsonb_array_elements_text((public.admin_search_orders('PCM-2099-73')) -> 'ids')
       WITH ORDINALITY AS e(v, ord)
  JOIN public.orders o ON o.id = e.v::uuid;
ROLLBACK;" | tail -1)"
cell "B14b 排序:ids **陣列順序**是新→舊(不截斷)" \
  "PCM-2099-7310,PCM-2099-7309,PCM-2099-7308,PCM-2099-7307,PCM-2099-7306,PCM-2099-7305,PCM-2099-7304,PCM-2099-7303,PCM-2099-7302,PCM-2099-7301" "$ORDERED"

echo
echo "== B 區續:上限硬夾 200(額外造 201 張)=="
# 🔴 寫成函式而不是把結果存進變數:D13 的突變格要**重跑**這個查詢才有意義。
#    第一版存成 `CAP` 再讓 D13 `echo "$CAP"` —— 那是拿突變**之前**的舊值去比,
#    永遠等於期望值 ⇒ 那格恆綠、零判別力(自己寫完當場抓到)。
cap() { q "
BEGIN;
$SETUP
INSERT INTO public.orders
  (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice)
SELECT 'PCM-2098-' || pg_catalog.lpad(g::text, 4, '0'),
       'aaaaaaaa-0000-4000-8000-000000000001',
       '{\"name\":\"CleanN\",\"phone\":\"0900000000\",\"line\":\"Clean Line\"}'::jsonb,
       'general', 100, 0, 100, 'home', '{\"type\":\"personal\"}'::jsonb
  FROM generate_series(1, 201) g;
SELECT jsonb_array_length(r -> 'ids')::text || '|' || (r ->> 'truncated')
  FROM (SELECT public.admin_search_orders('PCM-2098-', 5000) AS r) t;
ROLLBACK;" | tail -1; }
cell "B15 傳 limit=5000 → 硬夾 100 + truncated" "100|true" "$(cap)"

# 🔴 **同秒排序的一致性**(R3-M5):cap 的 201 張全部同一個 created_at ⇒ 誰進前 100 完全由
#    **次鍵 id** 決定。B15 只比對「100|true」,對次鍵方向零覆蓋 —— 而次鍵方向正是 R2 修過的東西
#    (要與列表那層的 `id DESC` 一致)。這格直接斷言「回來的就是 id 最大的那 100 張,且順序相符」。
#    ⚠️ 它同時覆蓋 migration 兩處 ORDER BY(子查詢 LIMIT 取誰、array_agg 排序)。
CAPSET="$(q "
BEGIN;
$SETUP
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, created_at)
SELECT ('eeeeeeee-0000-4000-8000-' || pg_catalog.lpad(g::text, 12, '0'))::uuid,
       'PCM-2096-' || pg_catalog.lpad(g::text, 4, '0'),
       'aaaaaaaa-0000-4000-8000-000000000001',
       '{\"name\":\"CleanN\",\"phone\":\"0900000000\",\"line\":\"Clean Line\"}'::jsonb,
       'general', 100, 0, 100, 'home', '{\"type\":\"personal\"}'::jsonb,
       '2096-01-01 00:00:00+00'
  FROM generate_series(1, 201) g;
SELECT (
  SELECT (array_agg(a.id ORDER BY a.ord) IS NOT DISTINCT FROM array_agg(b.id ORDER BY b.rn))::text
    FROM (SELECT (v)::uuid AS id, ord
            FROM jsonb_array_elements_text((public.admin_search_orders('PCM-2096-', 100)) -> 'ids')
                 WITH ORDINALITY AS e(v, ord)) a
    FULL JOIN (SELECT id, row_number() OVER (ORDER BY id DESC) AS rn
                 FROM public.orders WHERE display_id LIKE 'PCM-2096-%'
                ORDER BY id DESC LIMIT 100) b ON b.rn = a.ord);
ROLLBACK;" | tail -1)"
cell "B15b 同秒 201 張 → 回的是 id 最大的 100 張且順序相符" "true" "$CAPSET"

echo
echo "== B 區續:同一張單多品項命中不得重複 =="
DUP="$(q "
BEGIN;
$SETUP
INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT o.id, 'dddddddd-0000-4000-8000-000000000001', 'QQD5SKU',
       '{\"sku\":\"CLEANSKU347\",\"spec\":{},\"title\":\"Clean Title 347\"}'::jsonb, 1, 100, 100
  FROM public.orders o WHERE o.display_id = 'PCM-2099-7307';
INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT o.id, 'dddddddd-0000-4000-8000-000000000001', 'QQD5SKU',
       '{\"sku\":\"CLEANSKU347\",\"spec\":{},\"title\":\"Clean Title 347\"}'::jsonb, 1, 100, 100
  FROM public.orders o WHERE o.display_id = 'PCM-2099-7307';
SELECT jsonb_array_length(r -> 'ids')::text FROM (SELECT public.admin_search_orders('QQD5SKU') AS r) t;
ROLLBACK;" | tail -1)"
cell "B16 一單三品項全命中 → id 只出現一次" "1" "$DUP"

# 🔴 **已知缺口的釘子**(codex R1):`order_items.variant_id` 是 ON DELETE SET NULL ⇒
#    變體被刪掉的歷史訂單再也連不到品牌,用品牌搜就是漏單,而 product_snapshot 不含品牌。
#    這格**不是在證明實作正確**,是把這個限制**釘成已知且可觀察的**:
#    哪天有人把品牌寫進快照、修好了這個洞,這格會翻紅提醒他一起更新合約。
BRANDNULL="$(q "
BEGIN;
$SETUP
UPDATE public.order_items SET variant_id = NULL
 WHERE order_id = (SELECT id FROM public.orders WHERE display_id = 'PCM-2099-7309');
SELECT COALESCE(string_agg(o.display_id, ',' ORDER BY o.display_id), '(none)')
  FROM public.orders o
 WHERE o.id IN (SELECT (jsonb_array_elements_text((public.admin_search_orders('QQD7BRAND')) -> 'ids'))::uuid);
ROLLBACK;" | tail -1)"
gap "B19 變體被刪(variant_id=NULL)→ 品牌搜不到" "(none)" "$BRANDNULL"

echo
echo "== C 區:ACL(這支能跨全部訂單比對 PII)=="
# ⚠️ **C1-C6 對「本片是否正確」不提供獨立證據**(R3 nit):它們查的東西與 migration 檔尾的
#    fail-closed 斷言重疊 —— 那些斷言若沒過,migration 根本 apply 不上去,harness 連跑都跑不到。
#    留著的理由是**回歸**:有人日後在 DB 上手動 GRANT(不經 migration)時,只有這裡看得到。
#    真正有獨立判別力的是下面 C 區續的**執行面**三格,以及 E 區的兩個 ACL 攻擊突變。
cell "C1 service_role 可執行"   "true"  "$(q "SELECT has_function_privilege('service_role','${FN}','EXECUTE')::text")"
cell "C2 PUBLIC 不可執行"        "false" "$(q "SELECT has_function_privilege('public','${FN}','EXECUTE')::text")"
cell "C3 anon 不可執行"          "false" "$(q "SELECT has_function_privilege('anon','${FN}','EXECUTE')::text")"
cell "C4 authenticated 不可執行" "false" "$(q "SELECT has_function_privilege('authenticated','${FN}','EXECUTE')::text")"
# 🔴 allowlist:owner 與 service_role 以外零 grantee(黑名單式列舉擋不住「新加的角色」)。
cell "C5 owner/service_role 以外零 grantee" "0" "$(q "
SELECT count(*)::text FROM pg_proc p,
  LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
 WHERE p.oid='${FN}'::regprocedure AND a.grantee <> p.proowner
   AND a.grantee <> 0 AND a.grantee <> 'service_role'::regrole")"
cell "C6 函式體零 RAISE(搜尋詞不落 log)" "false" "$(q "
SELECT (p.prosrc ~* '\\mRAISE\\M')::text FROM pg_proc p WHERE p.oid='${FN}'::regprocedure")"

# ── D 區:突變 ───────────────────────────────────────────────────────────────
# 🔴 逐維度把該維度的欄位表達式換成 `''`(那條分支變死碼),只重跑**對應那一格**。
#    換成 `''` 而不是刪整行:刪行會動到 SQL 結構(第一條沒有前置 OR),換值則永遠合法。
# ⚠️ 宣稱的是「拿掉這個維度 ⇒ 這個維度的正測會紅」,**不宣稱其他格不受影響**。
echo
echo "== C 區續:**執行面**(真 SET ROLE,不是目錄查詢)=="
# 🔴 C1-C4 查的是 `has_function_privilege` = **目錄面**。它證得了「ACL 上誰有 EXECUTE」,
#    但證不了 **SECDEF + search_path='' 在真正的呼叫者身分下跑不跑得動**
#    —— harness 連線是 superuser,superuser 執行任何東西都會過(同族教訓:
#    memory `reference_pg-has-table-privilege-not-rls-passthrough`)。
#    ⇒ 補三格真的 `SET LOCAL ROLE`(同 repo 正解 `scripts/a6-verify.sh:761-764`)。
role_exec() { # role_exec <角色> → ok | denied
  # 🔴 **先把輸出接住再判,不要用 `… | grep -q && echo A || echo B`。**
  #    本檔開頭有 `set -uo pipefail` ⇒ psql 因 ON_ERROR_STOP 退出碼 3 會**蓋掉 grep 的成功**,
  #    整條 `&&` 被跳過、一律落到 `|| echo ok` ⇒ **anon/authenticated 兩格恆綠地報「可以執行」**
  #    (第一版真的這樣,當場自己抓到;對齊 memory `reference_exit-code-provenance-three-traps`)。
  local out
  out="$(q "BEGIN; SET LOCAL ROLE $1; SELECT public.admin_search_orders('QQD5SKU')::text; ROLLBACK;")"
  case "$out" in
    *"permission denied"*|*42501*) echo denied ;;
    *)                             echo ok ;;
  esac
}
cell "C7 service_role **真的執行得動**(SECDEF+search_path 在它身分下 OK)" "ok"     "$(role_exec service_role)"
cell "C8 anon 執行 → permission denied(42501)"                              "denied" "$(role_exec anon)"
cell "C9 authenticated 執行 → permission denied(42501)"                     "denied" "$(role_exec authenticated)"
# 前提格:上面那三格的判別靠「訊息裡有沒有 permission denied」,所以要證明 ok 那格真的**有結果**,
# 不是靜默回空(靜默回空也會被判成 ok ⇒ 恆真)。
cell "C7p 前提:service_role 那次真的撈到那張單" "PCM-2099-7307" "$(q "
BEGIN;
$SETUP
SET LOCAL ROLE service_role;
SELECT COALESCE(string_agg(o.display_id, ','), '(none)')
  FROM public.orders o
 WHERE o.id IN (SELECT (jsonb_array_elements_text((public.admin_search_orders('QQD5SKU')) -> 'ids'))::uuid);
ROLLBACK;" | tail -1)"

echo
echo "== D 區:逐維度突變(改壞 → 對應那格必須翻面 → 還原)=="
DEF="$(q "SELECT pg_get_functiondef('${FN}'::regprocedure)")"
for d in "${DIMS[@]}"; do
  IFS='|' read -r n name needle want mut <<<"$d"
  MUTDEF="$(NEEDLE="$mut" DEF="$DEF" python3 -c "
import os,sys
d=os.environ['DEF']; t=os.environ['NEEDLE']
if d.count(t) != 1:
    sys.stderr.write('ANCHOR_NOT_UNIQUE\n'); sys.exit(3)
sys.stdout.write(d.replace(t, \"''\"))
" 2>/dev/null)"
  if [ -z "$MUTDEF" ]; then
    FAIL=$((FAIL+1)); printf '  ❌ D%-2s %-50s 突變錨點找不到(實作改了形狀 → 本格要重寫)\n' "$n" "$name"
    continue
  fi
  NEED_RESTORE=1
  if ! printf '%s' "$MUTDEF" | psql "$URL" -qtA -v ON_ERROR_STOP=1 -f - >/dev/null 2>&1; then
    FAIL=$((FAIL+1)); printf '  ❌ D%-2s %-50s 突變版本建不起來\n' "$n" "$name"
    restore; continue
  fi
  GOT="$(hit "$needle")"
  restore
  if [ "$GOT" = "(none)" ]; then
    MUT=$((MUT+1)); printf '  ✅ D%-2s %-50s 拿掉後正測翻成零命中\n' "$n" "$name"
  else
    FAIL=$((FAIL+1)); printf '  ❌ D%-2s %-50s 拿掉這個維度,A%s 仍命中 [%s] ⇒ 那格沒有判別力\n' "$n" "$name" "$n" "$GOT"
  fi
done

# 合約層突變:空白短路與 truncated。
echo
echo "== D 區續:合約突變 =="
# 🔴 第五個參數是**突變後的期望值**,不是「原本的值」(codex R1)。
#    第一版只判「got != 原值」就算擊殺 —— 那樣 SQL 被改壞噴 ERROR 字串也算「翻面」,
#    而我自己稍早就真的踩過一次(`FROM (call AS r) t` 語法錯,三格全部假綠)。
#    ⇒ 改成**逐字比對突變後應該長什麼樣**,壞掉的輸出不會等於它。
mutate_contract() { # mutate_contract <描述> <old> <new> <驗證命令> <突變後期望值>
  local desc="$1" old="$2" new="$3" want_after="$5"
  local MUTDEF
  MUTDEF="$(OLD="$old" NEW="$new" DEF="$DEF" python3 -c "
import os,sys
d=os.environ['DEF']; o=os.environ['OLD']
if d.count(o) != 1:
    sys.stderr.write('ANCHOR_NOT_UNIQUE\n'); sys.exit(3)
sys.stdout.write(d.replace(o, os.environ['NEW']))
" 2>/dev/null)"
  if [ -z "$MUTDEF" ]; then
    FAIL=$((FAIL+1)); printf '  ❌ %-53s 突變錨點找不到\n' "$desc"; return
  fi
  NEED_RESTORE=1
  if ! printf '%s' "$MUTDEF" | psql "$URL" -qtA -v ON_ERROR_STOP=1 -f - >/dev/null 2>&1; then
    FAIL=$((FAIL+1)); printf '  ❌ %-53s 突變版本建不起來\n' "$desc"; restore; return
  fi
  local got; got="$(eval "$4")"
  restore
  if [ "$got" = "$want_after" ]; then
    MUT=$((MUT+1)); printf '  ✅ %-53s 翻成預期的壞值 %s\n' "$desc" "$got"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %-53s 期望突變後 [%s] 實得 [%s] ⇒ 突變沒發生、或那格沒判別力、或查詢本身壞了\n' "$desc" "$want_after" "$got"
  fi
}
# 拿掉空白短路 ⇒ 空字串會變成「每一欄都含空字串」= 撈出全部訂單(strpos(x,'')=1)。
mutate_contract "D11 拿掉空白短路 → B2/B3 應翻面" \
  "IF v_needle = '' THEN" "IF false THEN" "meta ''" "42|false"
# 把多取一筆拿掉 ⇒ 命中數剛好等於 limit 時 truncated 永遠 false。
mutate_contract "D12 LIMIT 不多取一筆 → B10 應翻面" \
  "LIMIT v_limit + 1" "LIMIT v_limit" "meta 'PCM-2099-73' '3'" "3|false"
# 拿掉上限硬夾 ⇒ B15 不再是 200。
mutate_contract "D13 拿掉 LEAST(…,200) → B15 應翻面" \
  "CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN 100 ELSE LEAST(p_limit, 100) END" \
  "COALESCE(p_limit, 100)" "cap" "201|false"


# ── E 區:ACL 斷言的突變(codex R2-D3)────────────────────────────────────────
# 🔴 D 區的 13 個突變**一個都沒碰到 C-2/C-3 那兩道 ACL 斷言** ——
#    把它們從 migration 裡整段刪掉,在乾淨的角色圖上照樣 35/0、13/13。
#    我手動試過那兩種攻擊會被擋,但**手動一次不是回歸守門** ⇒ 自動化成兩格。
# ⚠️ 這兩格改的是**角色圖**(不是函式),而 GRANT/REVOKE 無法靠交易回滾到別的連線 ⇒
#    每格自己負責還原,且還原失敗一律計 FAIL(拋棄式 cluster,不影響任何真環境)。
# 🔴 D14 是 R3-M2 的收尾:證明「空白字元集」那道守門真的有判別力。
#    有靶單(地址含 tab)之後,把字元集改回 btrim 預設 ⇒ 搜 tab 會命中那張單。
#    沒有靶單的話這個突變**什麼都不會發生** —— 那正是原本 B17/B18 恆真的原因。
mutate_contract "D14 btrim 字元集改回預設 → B17 應翻面" \
  "E' \\t\\r\\n\\u3000\\u00a0\\u202f\\u200b\\ufeff'" "' '" "meta '	'" "1|false"

echo
echo "== E 區:ACL 斷言的突變(攻擊 → migration 必須中止)=="
acl_attack() { # acl_attack <描述> <攻擊 SQL> <還原 SQL> <期望的中止訊息片段>
  local desc="$1" attack="$2" undo="$3" want="$4" out
  q "$attack" >/dev/null 2>&1 || { FAIL=$((FAIL+1)); printf '  ❌ %-53s 攻擊 SQL 本身失敗\n' "$desc"; return; }
  out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$MIGFILE" 2>&1 | grep -c "$want")"
  q "$undo" >/dev/null 2>&1 || { FAIL=$((FAIL+1)); printf '  🔴 %-53s **還原失敗,cluster 已污染**\n' "$desc"; return; }
  # 還原後必須能重新 apply(證明擋下來的是攻擊、不是本來就壞的)
  if ! psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$MIGFILE" >/dev/null 2>&1; then
    FAIL=$((FAIL+1)); printf '  ❌ %-53s 還原後 migration 仍套不上\n' "$desc"; return
  fi
  if [ "$out" -ge 1 ]; then
    MUT=$((MUT+1)); printf '  ✅ %-53s 攻擊被斷言擋下、還原後回綠\n' "$desc"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %-53s 攻擊沒被擋(斷言沒有判別力)\n' "$desc"
  fi
}
acl_attack "E1 GRANT service_role TO anon(角色繼承)" \
  "GRANT service_role TO anon;" "REVOKE service_role FROM anon;" "有效可執行"
acl_attack "E2 GRANT … TO service_role WITH GRANT OPTION" \
  "GRANT EXECUTE ON FUNCTION public.admin_search_orders(text,integer) TO service_role WITH GRANT OPTION;" \
  "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.admin_search_orders(text,integer) FROM service_role;" \
  "GRANT OPTION"

echo
echo "════════════════════════════════════════════"
printf '  PASS=%d  FAIL=%d  已知缺口=%d  突變已證判別力=%d\n' "$PASS" "$FAIL" "$GAP" "$MUT"
echo "════════════════════════════════════════════"
[ "$FAIL" = "0" ] || exit 1
