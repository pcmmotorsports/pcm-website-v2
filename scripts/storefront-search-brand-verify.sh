#!/usr/bin/env bash
# storefront-search-brand-verify.sh
#   驗 `20260903050000_m4b_storefront_search_product_ids.sql` 的**行為**。
#
# 🔴 為什麼要有它:那支 migration 自己的事後閘只驗**定義層**
#    (函式建得出來、是 INVOKER 不是 DEFINER)。
#    **「函式建出來了」與「它回的東西是對的」是兩個宣稱。**
#
# 🔴🔴 **本檔最重要的一格是「判別世界」** —— 而它需要一支**品牌名只存在於 `brands` 表**的商品。
#    鑽機的種子把品牌名塞進了標題(`… — BRAND`)⇒ **在那種資料上,舊述詞與新函式回一樣的數字**
#    ⇒ 📌 **那樣的綠沒有判別力:它不會因為我把品牌那一半拿掉而變**。
#    ⇒ 所以本檔**自己造**那個世界(改一支商品的四欄與它的品牌名),再比兩邊。
#
# 用法:先起鑽機,再跑本檔(埠可覆寫)
#   STOREFRONT_PROBE_DIR=/tmp/pcm-mail-probe STOREFRONT_PROBE_PG=55545 bash scripts/storefront-probe/up.sh
#   PGPORT=55545 bash scripts/storefront-search-brand-verify.sh
# 🛑 它會**改鑽機裡的資料**(那是拋棄式庫,而本檔不碰任何非拋棄式的東西)。
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260903050000_m4b_storefront_search_product_ids.sql"
PORT="${PGPORT:-55545}"
[ -f "$M" ] || { echo "🔴 找不到 $M ⇒ ENV-FAIL"; exit 2; }
command -v psql >/dev/null || { echo "🔴 缺 psql ⇒ ENV-FAIL"; exit 2; }

p(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -c "$1" 2>/dev/null; }
p "select 1" >/dev/null || { echo "🔴 連不上鑽機(埠 $PORT)⇒ ENV-FAIL:先起 scripts/storefront-probe/up.sh"; exit 2; }

PASS=0; FAIL=0
ok(){ printf '  %-44s ⇒ ✅ %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad(){ printf '  %-44s ⇒ 🔴 %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
eq(){ [ "$2" = "$3" ] && ok "$1" "$2" || bad "$1" "得 $2, 期望 $3"; }

# 🔴🔴 **鑽機起站時【已經】把 supabase/migrations/ 全跑過一遍,包含本片這一支。**
#    而本片是**裸 `CREATE`**(不是 `OR REPLACE`)⇒ **再 apply 一次會失敗**,
#    而那個失敗是**正確行為**(forward-only:撞名要當場紅), 不是問題。
#    ⚠️ 我第一版無條件再 apply 一次 ⇒ 它印「migration apply 不過」而**那是我的腳本錯,不是碼錯**。
#    ⇒ 判準改成【那支函式在不在】, 不是【apply 成不成功】。
FNEXISTS=$(p "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")
if [ "$FNEXISTS" = "0" ]; then
  psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$M" >/dev/null 2>&1 \
    || { echo "🔴 函式不在, 而 apply 也不過 ⇒ 先看 migration 本身"; exit 1; }
  echo "🔵 函式原本不在 ⇒ 本檔自己 apply 了一次"
else
  echo "🔵 函式已在(鑽機起站時跑過)⇒ 本檔不重複 apply(裸 CREATE 重跑本來就該紅)"
fi
# 🟢 不論走哪一條路, 這裡都必須是 1 —— 否則下面每一格量的是【不存在的東西】
eq "0 前置:函式在" "$(p "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")" "1"

TOTAL=$(p "select count(*) from products_public")
echo "🟢 分母:鑽機商品數 = $TOTAL(下面每個 0 都要對得起這個分母)"

echo "── A 失敗方向:沒有條件時【回零列, 不是回全表】────────────────"
# 🔴 這一族是本函式最危險的失敗形狀:「沒有條件的查詢」的失敗長得像【成功】
#    (回 200、有結果、畫面正常)⇒ 每一格都要對得起上面那個分母。
eq "A1 空陣列"       "$(p "select count(*) from storefront_search_product_ids(ARRAY[]::text[])")" "0"
eq "A2 全空白詞"     "$(p "select count(*) from storefront_search_product_ids(ARRAY['  ',''])")" "0"
eq "A3 NULL"         "$(p "select count(*) from storefront_search_product_ids(NULL)")" "0"
eq "A4 萬用字元 pct" "$(p "select count(*) from storefront_search_product_ids(ARRAY['%'])")" "0"
eq "A5 底線"         "$(p "select count(*) from storefront_search_product_ids(ARRAY['_'])")" "0"
eq "A6 負對照 亂碼"  "$(p "select count(*) from storefront_search_product_ids(ARRAY['zzqprbxx9137never'])")" "0"

echo "── B 🔴 判別世界:品牌名【只】存在於 brands 表 ────────────────"
BID=$(p "select id from brands order by name limit 1")
PID=$(p "select id from products where brand_id='$BID' limit 1")
[ -n "$BID" ] && [ -n "$PID" ] || { echo "🔴 種子裡撈不到品牌/商品 ⇒ ENV-FAIL"; exit 2; }
p "update brands set name='ZZTESTBRAND' where id='$BID'" >/dev/null
p "update products set title='無品牌字樣的標題', subtitle='副標', description='描述', external_id='PLAIN-001' where id='$PID'" >/dev/null

OLD=$(p "select count(*) from products_public where title ilike '%ZZTESTBRAND%' or subtitle ilike '%ZZTESTBRAND%' or description ilike '%ZZTESTBRAND%' or external_id ilike '%ZZTESTBRAND%'")
NEW=$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTESTBRAND'])")
# 🎯 這兩個數字**必須不同** —— 相同的話, 這一整片沒有做任何事而測試照樣綠
eq "B1 舊述詞(四欄)找品牌名"  "$OLD" "0"
[ "$NEW" -gt 0 ] && ok "B2 新函式找得到品牌名" "$NEW 列(> 0)" || bad "B2 新函式找得到品牌名" "得 $NEW"
[ "$OLD" != "$NEW" ] && ok "B3 兩邊【印不同的東西】" "$OLD vs $NEW" || bad "B3 兩邊印不同" "都是 $OLD ⇒ 這片沒做事也會綠"

echo "── C 跨表 AND(就是 rpm+rsv4 那個形狀)────────────────────────"
eq "C1 品牌名 + 該商品標題詞" "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTESTBRAND','無品牌字樣'])")" "1"
eq "C2 品牌名 + 不存在的詞"   "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTESTBRAND','zzqprbxx'])")" "0"
# 🔴 C2 是 AND 的證明:少了它, 一個把 AND 寫成 OR 的實作在 C1 上照樣綠
eq "C3 詞序顛倒同結果"        "$(p "select count(*) from storefront_search_product_ids(ARRAY['無品牌字樣','ZZTESTBRAND'])")" "1"
eq "C4 同一個詞打兩次"        "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTESTBRAND','ZZTESTBRAND'])")" "$NEW"

echo "── D 安全:函式必須是 INVOKER ────────────────────────────────"
eq "D1 prosecdef" "$(p "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")" "f"
# 🔵 正對照:同一把尺對一支真的 DEFINER 函式要印 t(否則這個 f 沒有判別力)
DEFN=$(p "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")
[ "$DEFN" -gt 0 ] && ok "D2 正對照:庫裡有 DEFINER 函式" "$DEFN 支 ⇒ 那個 f 有判別力" \
  || bad "D2 正對照" "庫裡零支 DEFINER ⇒ D1 的 f 可能是恆 f"

echo "── E 🔴 ACL:新物件出生就自帶權限, 所以每一格都要明著問 ──────"
# 🔴 這一族是 .husky 的 migration 靜態檢查逼出來的 —— 它抓到我原本【沒有明寫 GRANT】。
#    📌 **「proacl 是 NULL」與「沒有人有權限」是兩件事**:前者的意思是「用預設」, 而
#      Postgres 對新函式的預設是把 EXECUTE 授給 PUBLIC ⇒ **不明寫 = 出生就所有人叫得動**。
eq "E1 proacl 不是 NULL" "$(p "select proacl is null from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")" "f"
# 🔵 這裡刻意**不** join pg_roles:PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
#    ⇒ 內部 join 會把它靜靜丟掉(本 repo 記過這一格)。
eq "E2 PUBLIC 不在 ACL 裡" "$(p "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral aclexplode(p.proacl) a where n.nspname='public' and p.proname='storefront_search_product_ids' and a.grantee=0")" "0"
eq "E3 anon 執行得到"      "$(p "select has_function_privilege('anon','public.storefront_search_product_ids(text[])','EXECUTE')")" "t"
eq "E4 authenticated 執行得到" "$(p "select has_function_privilege('authenticated','public.storefront_search_product_ids(text[])','EXECUTE')")" "t"
# 🔵 負對照:一個【沒有被 GRANT】的角色必須是 f —— 否則上面那些 t 沒有判別力
eq "E5 負對照 pcm_readonly 執行不到" "$(p "select has_function_privilege('pcm_readonly','public.storefront_search_product_ids(text[])','EXECUTE')")" "f"

echo "──────────────────────────────────────────────────────────────"
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
echo "🛑 射程:本機拋棄式庫 ⇒ 證不出正式庫的行為;**不驗效能**(那要對正式庫 EXPLAIN)。"
echo "🛑 本檔【會改鑽機資料】(造判別世界)⇒ 跑完那座鑽機的資料已被汙染, 不要拿它去量別的。"
[ "$FAIL" -eq 0 ] || exit 1
