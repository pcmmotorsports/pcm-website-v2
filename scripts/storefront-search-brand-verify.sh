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

echo "── F 🔴 料號:不同打法要指向同一顆(⟦search-PARTNOSEPINDIGITS⟧ 20260903230000)──"
# 🔴🔴 **這一族是 adversarial-reviewer M5 逼出來的:本檔原本零料號案例**
#    (數法:`rg '0010|料號|regexp_replace' scripts/storefront-search-brand-verify.sh` ⇒ 0)。
#    ⇒ 而那讓 230000 那支 migration **不留下任何可重跑的檢查**。
#
# 🛑 **而 M5 點名的假綠世界要先擋掉**:本檔上面那段在函式不存在時會**自己 apply 050000**
#    ⇒ 那樣它會對著**舊那一代**全綠。⇒ 所以這裡先問「庫上那支是不是【含料號分支】的那一代」,
#      不是問「函式在不在」。
MIG_PN="$REPO/supabase/migrations/20260903230000_m4b_storefront_search_partno_normalized.sql"
HASPN=$(p "select position('PARTNOSEPINDIGITS' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")
if [ "$HASPN" != "t" ]; then
  if [ -f "$MIG_PN" ]; then
    psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$MIG_PN" >/dev/null 2>&1 \
      && echo "🔵 庫上是舊那一代 ⇒ 本檔 apply 了 230000" \
      || { echo "🔴 230000 apply 不過 ⇒ F 族跳過(而這【不是綠】)"; FAIL=$((FAIL+1)); }
  else
    echo "🔴 找不到 $MIG_PN ⇒ F 族跳過(而這【不是綠】)"; FAIL=$((FAIL+1))
  fi
fi
# 🟢 這一格必須綠, 否則下面每一格量的是【舊那一代】—— 那正是 M5 講的假綠。
eq "F0 前置:庫上是含料號分支的那一代" \
   "$(p "select position('PARTNOSEPINDIGITS' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='storefront_search_product_ids'")" "t"

# 🔴 自己造料號世界:**分隔號要在【數字中間】** —— 那才是正式站真實料號的形狀
#    (`G3-0010`)。⚠️ 我第一版的語料是 `AB-123`(分隔號在字母↔數字交界),
#    而那種形狀**用舊碼就會中** ⇒ 拿它當案例的話這一族恆綠。
PID2=$(p "select id from products order by id offset 1 limit 1")
[ -n "$PID2" ] || { echo "🔴 撈不到第二支商品 ⇒ ENV-FAIL"; exit 2; }
p "update products set external_id='ZZ7-0042', title='料號測試件', subtitle='', description='' where id='$PID2'" >/dev/null

eq "F1 完整打法 ZZ7-0042"   "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZ7-0042'])")" "1"
eq "F2 小寫 zz7-0042"       "$(p "select count(*) from storefront_search_product_ids(ARRAY['zz7-0042'])")" "1"
eq "F3 空白(呼叫端會切兩詞)" "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZ7','0042'])")" "1"
# 🔴🔴 **F4 是這一族唯一會因為本片而變的那一格** —— 舊那一代在這裡回 0。
eq "F4 無分隔號 zz70042"    "$(p "select count(*) from storefront_search_product_ids(ARRAY['zz70042'])")" "1"
eq "F5 負對照 不存在的料號" "$(p "select count(*) from storefront_search_product_ids(ARRAY['zz70043xx'])")" "0"

# 🔴🔴 **F6 是最貴的那一格:中文詞正規化之後是【空字串】** ——
#    而 `LIKE '' || '%'` = `LIKE '%'` ⇒ **命中每一列**。
#    ⇒ 📌 客人打「油箱貼」就會拿到全站商品, 而 HTTP 200、畫面完全正常。
CJK=$(p "select count(*) from storefront_search_product_ids(ARRAY['油箱貼'])")
[ "$CJK" -lt "$TOTAL" ] && ok "F6 中文詞不得回全表" "$CJK 列 < 分母 $TOTAL" \
  || bad "F6 中文詞不得回全表" "回了 $CJK 列 = 分母 $TOTAL ⇒ 守衛破了"
# 🔵 F7 負對照:單一字母也不得打開料號那道閘(它要求同時有字母與數字)
LETTER=$(p "select count(*) from storefront_search_product_ids(ARRAY['z'])")
[ "$LETTER" -lt "$TOTAL" ] && ok "F7 單字母不得回全表" "$LETTER 列 < 分母 $TOTAL" \
  || bad "F7 單字母不得回全表" "回了 $LETTER 列 = 分母 $TOTAL"

echo "── G 🔴🔴 跨兩半的 AND:一個詞只中文字、另一個詞只中料號 ──────────"
# 🔴🔴 **這一族是【在拆之前寫的】, 而它今天【應該是綠的】。**
#
#    ⟦search-CAPSULEPARSE⟧ 之後那支 RPC 的述詞長這樣(29 行 SQL 的骨架):
#      JOIN t ON ( 五個 ILIKE 分支  OR  料號正規化分支 )
#      …
#      HAVING count(DISTINCT t.ord) = n.want      ← **每一個詞都要中**
#
#    🎯 **⇒ 而「每個詞都要中」這條 AND 是【跨兩半】的**:
#      一個詞可以**只靠料號**命中, 而它仍然要算進「都中了」。
#    🔵 **⇒ 而今天它【由結構保證】** —— 兩半在同一個 `OR` 裡, 所以這件事自然成立,
#      **所以今天沒有人寫過這一格。**
#
# 🛑 **⇒ 而下一步要把料號那半拆出去**(理由:那條表達式讓整個 OR 吃不到 trgm 索引;
#    鑽機實測 四欄版 BitmapOr=1/1.22ms vs 加了它 Seq Scan/39.9ms)。
#    ⇒ 🔴 **拆掉結構之後, 就沒有東西保證這條 AND 了。**
#    ⇒ ⇒ ✅ **所以這一格先寫、先跑、確認它綠;拆的過程中它若變紅 ⇒ 當場知道拆壞了。**
#    ⇒ ⇒ ⇒ 📌 **而它與平常「先寫一格會紅的守門」相反** ——
#      這一格是**先寫一格會綠的**, 而它的用途是**在改的過程中變紅**。
PID3=$(p "select id from products order by id offset 2 limit 1")
[ -n "$PID3" ] || { echo "🔴 撈不到第三支商品 ⇒ ENV-FAIL"; exit 2; }
# 造一個【兩半各中一半】的世界:
#   `ZZTEXTONLY` 只出現在**標題**   ·  `ZZPN-0042` 只出現在**料號**
p "update products set title='ZZTEXTONLY 跨半測試件', subtitle='', description='', external_id='ZZPN-0042' where id='$PID3'" >/dev/null

eq "G1 詞①只中文字(ZZTEXTONLY)" "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTEXTONLY'])")" "1"
eq "G2 詞②只中料號(無分隔號打法)" "$(p "select count(*) from storefront_search_product_ids(ARRAY['zzpn0042'])")" "1"
# 🔴🔴 **本族的核心那一格** —— 兩個詞各自只中一半, 而 AND 之後仍然要命中。
eq "G3 🔴 兩個詞各中一半 ⇒ **仍要命中**" \
   "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTEXTONLY','zzpn0042'])")" "1"
# 🔵 負對照:換一個【不存在】的第二詞 ⇒ AND 必須把它擋掉(否則 G3 的 1 沒有判別力)
eq "G4 🔵 負對照 第二詞不存在 ⇒ 0" \
   "$(p "select count(*) from storefront_search_product_ids(ARRAY['ZZTEXTONLY','zzqprbxx9137never'])")" "0"
# 🔵 負對照:兩個詞都只中料號那一半的【不同】商品 ⇒ 0(證 AND 是 per-商品 不是 per-詞集合)
eq "G5 🔵 負對照 料號詞 + 別支商品的文字詞 ⇒ 0" \
   "$(p "select count(*) from storefront_search_product_ids(ARRAY['zzpn0042','ZZTESTBRAND'])")" "0"

echo "──────────────────────────────────────────────────────────────"
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
echo "🛑 射程:本機拋棄式庫 ⇒ 證不出正式庫的行為;**不驗效能**(那要對正式庫 EXPLAIN)。"
echo "🛑 本檔【會改鑽機資料】(造判別世界)⇒ 跑完那座鑽機的資料已被汙染, 不要拿它去量別的。"
[ "$FAIL" -eq 0 ] || exit 1
