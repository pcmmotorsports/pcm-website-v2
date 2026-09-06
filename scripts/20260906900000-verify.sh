#!/usr/bin/env bash
# 20260906900000-verify.sh —— ⟦search-VARIANTSKU⟧ 的拋棄式 PG 驗證
#
# 🛑 **零正式庫動作。** 它起一台自己的 PG、依序 apply 全部 migration、再 apply 本片, 然後問五組問題。
#
# 🔴 **它答不出什麼(先寫)**:
#   · 拋棄式 PG 的資料是**本檔自己造的** ⇒ 它答「這段 SQL 的行為對不對」, 答不出「正式庫會怎樣」。
#   · `RPC_ID_CAP` 那一格(1000→1001)**不在這裡** —— 那要對正式庫量真實筆數,
#     見 `scripts/20260906900000-cap-headroom.sql`(唯讀)。
#   · anon 那兩格用的是**本地建的 anon 角色**, 而正式庫的 anon 另有 Supabase 的設定 ⇒ 只證「policy 的形狀對」。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260906900000_m4b_storefront_search_variant_sku.sql"
[ -f "$MIG" ] || { echo "🔴 找不到本片 migration ⇒ 路徑錯, 不是查無"; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; exit 2; }; done

D=$(mktemp -d "${TMPDIR:-/tmp}/vsku.XXXXXX") || exit 9
PG=$(( 57000 + ($$ % 800) ))
while lsof -nP -iTCP:"$PG" -sTCP:LISTEN >/dev/null 2>&1; do PG=$((PG+1)); done
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
Q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -tAc "$1"; }
QF(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$1"; }

CELLS=0; FAILS=0
cell(){ CELLS=$((CELLS+1)); if [ "$1" = 1 ]; then printf '  ✅ %s\n' "$2"; else FAILS=$((FAILS+1)); printf '  🔴 %s\n' "$2"; fi; }
EXPECT_TOTAL=18

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 PG 起不來 ⇒ ENV-FAIL"; exit 2; }
RB="$REPO/docs/runbooks/throwaway-postgres-for-migration-verification.md"
awk '/^## 2\. .*bootstrap/{s=1} s&&/^```sql$/{f=1;next} f&&/^```$/{exit} f' "$RB" > "$D/bs.raw"
awk '/^-- 業務型別/{exit} {print}' "$D/bs.raw" > "$D/bs.sql"
[ -s "$D/bs.sql" ] || { echo "🔴 抽不到 bootstrap ⇒ ENV-FAIL"; exit 2; }
QF "$D/bs.sql" >/dev/null 2>&1 || { echo "🔴 bootstrap 跑不過 ⇒ ENV-FAIL"; exit 2; }

echo "══ 依序 apply(失敗容忍 —— 而失敗數要印出來)"
OK=0; BAD=0
for f in "$REPO"/supabase/migrations/*.sql; do
  [ "$(basename "$f")" = "$(basename "$MIG")" ] && continue
  if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
  then OK=$((OK+1)); else BAD=$((BAD+1)); fi
done
printf '   成功 %s ｜ 失敗 %s\n' "$OK" "$BAD"


# ══ 🔴🔴 把世界【搬到與正式庫同一代】——— 這一段是本檔最重要的一段, 先讀 ═══════
#   從零 replay 之後, 這台 PG 上的那支函式 **不是** 正式庫那一代:
#     實測 replay 後 md5 = 76df17fe…  ·  正式庫 = a780b8052812395dbe65611dde927015
#   成因:62 支 migration 在拋棄式環境失敗(環境缺件), 其中包含這條函式鏈上的某一代
#     ⇒ `20260904180000` 自己的前置閘(它釘的是【上一代】的 md5)擋下它 ⇒ 函式停在更舊那一代。
#   📌 **⇒ 一支【釘 md5】的 migration, 在一個 replay 不乾淨的拋棄式庫裡【天生驗不了】。**
#      而那不是它寫錯 —— 那道閘本來就是為了「不要蓋掉別人的改動」而存在的。
#   ✅ 所以這裡**明確地把那一代裝上去**(只抽 `20260904180000` 的函式定義那一段來跑),
#      然後**斷言它的 md5 等於正式庫實測值** —— 那一格就是「我在跟正式庫同一個世界裡測」的證據。
#   🛑 **而這是一個【被我構造出來的】世界, 不是自然 replay 出來的** —— 照實寫在這裡, 不藏。
echo
echo "── 前置:把那支函式裝成【正式庫那一代】, 並斷言 md5 對得上 ──"
awk '/^CREATE OR REPLACE FUNCTION public.storefront_search_product_ids/,/^\$function\$;/' \
  "$REPO/supabase/migrations/20260904180000_m4b_storefront_search_partno_long_numeric.sql" > "$D/gen5.sql"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen5.sql" >"$D/gen5.log" 2>&1 \
  || { echo "🔴 裝不上去 ⇒ ENV-FAIL:$(sed -e 's|^psql:[^ ]*: ||' "$D/gen5.log" | grep -m1 ERROR | cut -c1-70)"; exit 2; }
LIVEMD5=$(Q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'")
cell "$([ "$LIVEMD5" = "a780b8052812395dbe65611dde927015" ] && echo 1 || echo 0)" \
     "🟢 世界對齊:本地那支的 md5 = 正式庫 2026-09-06 實測值(實測 ${LIVEMD5:0:12}…)"

echo
echo "── 貼之前:庫上那支必須【還沒有】變體那一塊(不然後面全部沒意義)──"
PRE=$(Q "SELECT CASE WHEN position('product_variants_public' IN prosrc) > 0 THEN 't' ELSE 'f' END FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'")
cell "$([ "$PRE" = "f" ] && echo 1 || echo 0)" "貼前:變體那一塊【不在】(實測 '$PRE')"

echo
echo "── 格 A:前置閘會擋 —— 先把庫上那支改掉, 本片必須紅 ──"
Q "CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[]) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS \$f\$ SELECT NULL::uuid WHERE false \$f\$" >/dev/null 2>&1
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/gate.log" 2>&1
then cell 0 "格 A:動過函式之後本片仍然貼得進去(前置閘沒擋)"
else
  cell "$(grep -q '前置閘' "$D/gate.log" && echo 1 || echo 0)" \
       "格 A:動過函式 ⇒ 本片被【前置閘】擋下($(sed -e 's|^psql:[^ ]*: ||' "$D/gate.log" | grep -m1 ERROR | cut -c1-58))"
fi
echo "   (把庫上那支還原成正式庫那一代, 再繼續)"
# 🔴 **不要用整支 20260904180000 還原** —— 它自己的前置閘釘的是【上一代】的 md5,
#    而我剛剛把函式改壞了 ⇒ 那道閘會擋 ⇒ 還原失敗, 而後面每一格都會紅在錯的理由上。
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen5.sql" >/dev/null 2>&1 \
  || echo "   ⚠️ 還原沒過 —— 下面若整片紅, 先看這裡"
RESTORED=$(Q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'")
cell "$([ "$RESTORED" = "a780b8052812395dbe65611dde927015" ] && echo 1 || echo 0)" \
     "格 A 收尾:還原回正式庫那一代(md5 ${RESTORED:0:12}…)—— 沒還原成功的話, 後面每一格都會紅在錯的理由上"

echo
echo "── 格 B:正常世界貼得進去, 四塊都在 ──"
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/apply.log" 2>&1
then cell 1 "格 B:本片 apply 成功(前置閘 + 事後閘全過)"
else cell 0 "格 B:apply 失敗 ⇒ $(sed -e 's|^psql:[^ ]*: ||' "$D/apply.log" | grep -m1 ERROR | cut -c1-70)"; fi
# 🔴 **問的是【剝掉註解之後】的碼** —— code-reviewer 2026-09-06 抓的:
#    `product_variants_public` 在註解裡也出現 ⇒ 把整塊 SELECT 刪掉只留註解, 這一格照樣綠。
STRIP="regexp_replace(regexp_replace(prosrc, '/\\*.*?\\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g')"
for k in product_variants_public 'regexp_replace(p.external_id' 'bh.brand_id' 'n.want > 0'; do
  n=$(Q "SELECT CASE WHEN position('$k' IN $STRIP) > 0 THEN 't' ELSE 'f' END FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'")
  cell "$([ "$n" = "t" ] && echo 1 || echo 0)" "格 B:新版含 \`$k\`(實測 $n)"
done

echo
echo "── 造資料:兩個商品(一上架一下架), 各一個變體 sku ──"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 >"$D/seed.log" 2>&1 <<'SQL'
-- 🔴 造資料要一路補到【所有 NOT NULL 都滿足】—— 而缺一欄的症狀是「搜不到」,
--    那與「比對邏輯錯」印同一個 0(本檔實測連踩兩次:price_by_tier 之後是 brand_id)。
INSERT INTO public.brands (id, name, slug)
VALUES ('cccccccc-3333-3333-3333-333333333333', '測試品牌', 'test-brand')
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, name, raw_path, segments)
VALUES ('dddddddd-4444-4444-4444-444444444444', '測試分類', '測試分類', '["測試分類"]'::jsonb)
ON CONFLICT DO NOTHING;
INSERT INTO public.products (id, external_id, title, handle, availability, price_by_tier, brand_id, category_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'MOTHER-1', '上架母商品', 'live-one', 'in-stock', '{"general": 100, "store": 90}'::jsonb,
        'cccccccc-3333-3333-3333-333333333333', 'dddddddd-4444-4444-4444-444444444444'),
       ('22222222-2222-2222-2222-222222222222', 'MOTHER-2', '下架母商品', 'dead-one', 'in-stock', '{"general": 100, "store": 90}'::jsonb,
        'cccccccc-3333-3333-3333-333333333333', 'dddddddd-4444-4444-4444-444444444444');
UPDATE public.products SET delisted_at = now() WHERE id = '22222222-2222-2222-2222-222222222222';
INSERT INTO public.product_variants (id, product_id, sku, spec, availability)
VALUES ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'PET52R', '{"spec":"A"}'::jsonb, 'in-stock'),
       ('bbbbbbbb-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'AZ203B', '{"spec":"B"}'::jsonb, 'in-stock'),
       -- 🔴 **真實形狀**:正式庫裡 Sean 打的 `PET52R` 實際存成 `PET52-PET52R`
       --    ⇒ 前綴比對抓不到它, 而這一格就是為了讓「改成前綴」當場紅。
       -- 🔴 **這個料號【只以複合形狀存在】** —— 沒有一個單獨的 `QRS77Z` 變體。
       --    ⇒ 格 C2 只能靠【包含式】過;改成前綴 ⇒ 它必須當場變 0。
       --    ⚠️ 上一版我同時放了單獨的 `PET52R` 與複合的 `PET52-PET52R`
       --      ⇒ 前綴靠那個單獨的就過關 ⇒ **突變殺不掉, 而那是我的測資給了一個比正式庫容易的世界。**
       ('eeeeeeee-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'WXY99-QRS77Z', '{"spec":"C"}'::jsonb, 'in-stock');
SQL
[ -s "$D/seed.log" ] && { echo "   ⚠️ 造資料有輸出(下面若紅先看這裡):"; sed -e 's|^psql:[^ ]*: ||' "$D/seed.log" | head -3 | sed 's/^/     /'; }

echo
echo "── 格 C:以 postgres 身分(RLS 不套用)—— 證明【比對邏輯】本身會動 ──"
C1=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['PET52R'])")
cell "$([ "${C1:-0}" = "1" ] && echo 1 || echo 0)" "格 C:搜 PET52R ⇒ 命中 ${C1:-?} 件(期望 1)"
C0=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['ZZQ9999X'])")
cell "$([ "${C0:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C 負對照:搜一個現造料號 ⇒ ${C0:-?} 件(期望 0)"

echo
echo "── 格 C2:真實形狀的複合 sku(WXY99-QRS77Z)—— 用【右半】那個詞搜得到嗎 ──"
C2=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['QRS77Z'])")
cell "$([ "${C2:-0}" -ge 1 ] && echo 1 || echo 0)" "🔴 格 C2:搜 QRS77Z(只存在於複合 sku WXY99-QRS77Z)⇒ ${C2:-?} 件(期望 >= 1;改成【前綴】這格必須變 0)"
C3=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['77ZQRS'])")
cell "$([ "${C3:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C2 負對照:字母順序打亂的 77ZQRS ⇒ ${C3:-?} 件(期望 0 —— 包含式不是模糊比對)"

echo
echo "── 格 C3:最短長度閘(codex MF2 / reviewer #3)—— 兩字元的詞不准進第 ④ 塊 ──"
# 種一個【只有兩字元的詞才撈得到】的變體 sku, 證明那道閘真的在擋
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
INSERT INTO public.product_variants (id, product_id, sku, spec, availability)
VALUES ('ffffffff-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'ZZ-K9-TAIL', '{"spec":"D"}'::jsonb, 'in-stock');
SQL
S2=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['K9'])")
cell "$([ "${S2:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C3:兩字元的 K9 ⇒ ${S2:-?} 件(期望 0 —— 長度閘擋住;拿掉那道閘這格會變 1)"
S4=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['K9TAIL'])")
cell "$([ "${S4:-0}" -ge 1 ] && echo 1 || echo 0)" "🟢 格 C3 正對照:六字元的 K9TAIL ⇒ ${S4:-?} 件(期望 >= 1 —— 證明擋的是【長度】不是【那一列】)"

echo
echo "── 格 D(codex MF3 要的):以 anon 身分 —— 上架看得到 / 下架看不到 ──"
D1=$(psql -h /tmp -p "$PG" -U postgres -d postgres -tAc "SET LOCAL ROLE anon; SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['PET52R']);" 2>&1 | tail -1)
cell "$([ "$D1" = "1" ] && echo 1 || echo 0)" "🟢 格 D 正對照:anon 搜上架母商品的變體 ⇒ $D1(期望 1)"
D2=$(psql -h /tmp -p "$PG" -U postgres -d postgres -tAc "SET LOCAL ROLE anon; SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['AZ203B']);" 2>&1 | tail -1)
cell "$([ "$D2" = "0" ] && echo 1 || echo 0)" "🔴 格 D 負對照:anon 搜【下架】母商品的變體 ⇒ $D2(期望 0 —— RLS 擋掉)"
D3=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['AZ203B'])")
cell "$([ "$D3" = "1" ] && echo 1 || echo 0)" "🛑 格 D 對照的對照:postgres 搜同一個詞 ⇒ $D3(期望 1)—— 證明上一格的 0 是【RLS 擋的】, 不是【比對沒中】"

echo
echo "── 收 ──"
printf '   跑了 %s 格 · 紅 %s 格 · 期望 %s 格\n' "$CELLS" "$FAILS" "$EXPECT_TOTAL"
if [ "$CELLS" != "$EXPECT_TOTAL" ]; then
  printf '   🔴 格數與期望不符(多或少)⇒ 有格子沒跑到, 而少跑一格在畫面上沒有形狀\n'
  exit 1
fi
[ "$FAILS" = 0 ] || exit 1
printf '   ✅ %s 格全過\n' "$CELLS"
