#!/usr/bin/env bash
# 20260906910000-verify.sh —— ⟦search-CARDPARTNO⟧ 母料號進 search_catalog_by_vehicle 的拋棄式驗證
#
# 🛑 **零正式庫動作。**
#
# 🔴 **它答不出什麼(先寫)**:
#   · 只**行為驗到「沒有車款」那一條路**(不帶 p_brand)。帶車款那條要種 fitments,
#     本檔沒種 ⇒ 那條路**只有靜態斷言**(事後閘數 `external_id` 出現兩次)。
#     ⇒ 📌 **兩份查詢裡有一份沒有被真的跑過** —— 照實寫, 不要讀成「兩條路都驗過了」。
#   · 卡片上怎麼顯示是線【前台】那半, 本檔只答「RPC 有沒有把它送出來」。
#   · 拋棄式 PG 的資料是本檔自己造的。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260906910000_m4b_catalog_rpc_expose_external_id.sql"
[ -f "$MIG" ] || { echo "🔴 找不到本片 migration ⇒ 路徑錯, 不是查無"; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; exit 2; }; done

D=$(mktemp -d "${TMPDIR:-/tmp}/cardpn.XXXXXX") || exit 9
PG=$(( 58000 + ($$ % 800) ))
while lsof -nP -iTCP:"$PG" -sTCP:LISTEN >/dev/null 2>&1; do PG=$((PG+1)); done
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
Q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -tAc "$1"; }

CELLS=0; FAILS=0
cell(){ CELLS=$((CELLS+1)); if [ "$1" = 1 ]; then printf '  ✅ %s\n' "$2"; else FAILS=$((FAILS+1)); printf '  🔴 %s\n' "$2"; fi; }
EXPECT_TOTAL=9

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 PG 起不來 ⇒ ENV-FAIL"; exit 2; }
RB="$REPO/docs/runbooks/throwaway-postgres-for-migration-verification.md"
awk '/^## 2\. .*bootstrap/{s=1} s&&/^```sql$/{f=1;next} f&&/^```$/{exit} f' "$RB" > "$D/bs.raw"
awk '/^-- 業務型別/{exit} {print}' "$D/bs.raw" > "$D/bs.sql"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/bs.sql" >/dev/null 2>&1 \
  || { echo "🔴 bootstrap 跑不過 ⇒ ENV-FAIL"; exit 2; }

echo "══ 依序 apply(失敗容忍)"
OK=0; BAD=0
for f in "$REPO"/supabase/migrations/*.sql; do
  [ "$(basename "$f")" = "$(basename "$MIG")" ] && continue
  if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
  then OK=$((OK+1)); else BAD=$((BAD+1)); fi
done
printf '   成功 %s ｜ 失敗 %s\n' "$OK" "$BAD"

# 🔴 與 20260906900000 同一個坑(見 runbook §5c):replay 不乾淨 ⇒ 那支 RPC 可能停在更舊那一代。
#    ⇒ 明確把來源那一代裝上去, 再繼續。
echo
echo "── 前置:把 search_catalog_by_vehicle 裝成【本片抄的那一代】──"
awk '/^CREATE FUNCTION public.search_catalog_by_vehicle\(/,/^\$fn\$;/' \
  "$REPO/supabase/migrations/20260904160000_m4b_search_catalog_multi_category.sql" > "$D/gen.sql"
sed -i.bak 's/^CREATE FUNCTION /CREATE OR REPLACE FUNCTION /' "$D/gen.sql"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen.sql" >"$D/gen.log" 2>&1 \
  || { echo "🔴 裝不上去 ⇒ ENV-FAIL:$(sed -e 's|^psql:[^ ]*: ||' "$D/gen.log" | grep -m1 ERROR | cut -c1-70)"; exit 2; }
N0=$(Q "SELECT (length(prosrc) - length(replace(prosrc, '''id'', pg.id', ''))) / length('''id'', pg.id') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%'")
cell "$([ "$N0" = "2" ] && echo 1 || echo 0)" "🟢 世界對齊:庫上那支有 ${N0} 份 jsonb_build_object(期望 2 —— 本函式有兩條路)"

echo
echo "── 格 A:前置閘會擋 —— 先把它改成【已經含 external_id】的樣子, 本片必須紅 ──"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -c "$(printf "CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL, p_model text DEFAULT NULL, p_year int DEFAULT NULL, p_offset int DEFAULT 0, p_limit int DEFAULT 25, p_sort text DEFAULT 'recommend', p_category text DEFAULT NULL, p_brand_slugs text[] DEFAULT NULL, p_price_min int DEFAULT NULL, p_price_max int DEFAULT NULL, p_new_since timestamptz DEFAULT NULL) RETURNS TABLE (item jsonb, total bigint) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS \$z\$ BEGIN RETURN QUERY SELECT jsonb_build_object('external_id', pe.external_id) , 0::bigint FROM public.products_public pe WHERE false; END \$z\$")" >/dev/null 2>&1
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/gate.log" 2>&1
then cell 0 "格 A:庫上已含 external_id 而本片仍貼得進去(前置閘④沒擋)"
else cell "$(grep -q '前置閘' "$D/gate.log" && echo 1 || echo 0)" \
       "格 A:被前置閘擋下($(sed -e 's|^psql:[^ ]*: ||' "$D/gate.log" | grep -m1 ERROR | cut -c1-52))"; fi
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen.sql" >/dev/null 2>&1

echo
echo "── 格 B:正常世界貼得進去, 兩份都改到 ──"
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/apply.log" 2>&1
then cell 1 "格 B:apply 成功(前置閘 + 事後閘全過)"
else cell 0 "格 B:apply 失敗 ⇒ $(sed -e 's|^psql:[^ ]*: ||' "$D/apply.log" | grep -m1 ERROR | cut -c1-70)"; fi
NK=$(Q "SELECT (length(prosrc) - length(replace(prosrc, '''external_id'', pe.external_id', ''))) / length('''external_id'', pe.external_id') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%'")
cell "$([ "$NK" = "2" ] && echo 1 || echo 0)" "格 B:external_id 兩份都在(實測 ${NK:-?} 份)"
NJ=$(Q "SELECT (length(prosrc) - length(replace(prosrc, 'LEFT JOIN public.products_public pe', ''))) / length('LEFT JOIN public.products_public pe') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%'")
cell "$([ "$NJ" = "2" ] && echo 1 || echo 0)" "格 B:那個 LEFT JOIN 兩份都在(實測 ${NJ:-?} 份)"

echo
echo "── 造資料 + 格 C:真的呼叫它(沒有車款那條路)──"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 >"$D/seed.log" 2>&1 <<'SQL'
INSERT INTO public.brands (id, name, slug) VALUES ('cccccccc-3333-3333-3333-333333333333','測試品牌','test-brand') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, name, raw_path, segments) VALUES ('dddddddd-4444-4444-4444-444444444444','測試分類','測試分類','["測試分類"]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.products (id, external_id, title, handle, availability, price_by_tier, brand_id, category_id)
VALUES ('11111111-1111-1111-1111-111111111111','MOTHER-PN-1','有料號的商品','live-pn','in-stock','{"general":100,"store":90}'::jsonb,
        'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444');
SQL
[ -s "$D/seed.log" ] && { echo "   ⚠️ 造資料有輸出:"; sed -e 's|^psql:[^ ]*: ||' "$D/seed.log" | head -2 | sed 's/^/     /'; }
GOT=$(Q "SELECT item->>'external_id' FROM public.search_catalog_by_vehicle(p_categories => ARRAY[]::text[]) LIMIT 1")
cell "$([ "$GOT" = "MOTHER-PN-1" ] && echo 1 || echo 0)" "🟢 格 C 正對照:RPC 吐出來的 item 帶母料號(實測 '${GOT:-空}')"
NULLCNT=$(Q "SELECT count(*) FROM public.search_catalog_by_vehicle(p_categories => ARRAY[]::text[]) WHERE item->>'external_id' IS NULL")
cell "$([ "${NULLCNT:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C 負對照:沒有任何一列的 external_id 是 null(實測 ${NULLCNT:-?} 列)"
HASKEY=$(Q "SELECT count(*) FROM public.search_catalog_by_vehicle(p_categories => ARRAY[]::text[]) WHERE item ? 'zzq_never_a_key'")
cell "$([ "${HASKEY:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C 尺的負對照:問一個現造的 key ⇒ ${HASKEY:-?} 列(期望 0 —— 證明上面那格不是恆真)"

SEC=$(Q "SELECT p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','),'-') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%'")
cell "$([ "$SEC" = "false|search_path=public, pg_temp" ] && echo 1 || echo 0)" "🔴 格 D:REPLACE 之後仍是 INVOKER 且 search_path 還在(實測 '$SEC')"

echo
echo "── 收 ──"
printf '   跑了 %s 格 · 紅 %s 格 · 期望 %s 格\n' "$CELLS" "$FAILS" "$EXPECT_TOTAL"
if [ "$CELLS" != "$EXPECT_TOTAL" ]; then
  printf '   🔴 格數與期望不符(多或少)⇒ 有格子沒跑到, 而少跑一格在畫面上沒有形狀\n'; exit 1
fi
[ "$FAILS" = 0 ] || exit 1
printf '   ✅ %s 格全過\n' "$CELLS"
