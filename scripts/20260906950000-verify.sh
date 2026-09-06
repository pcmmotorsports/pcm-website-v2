#!/usr/bin/env bash
# 20260906950000-verify.sh —— ⟦search-VARIANTSKUFIRST⟧ 完全命中排最前, 拋棄式 PG 驗證
#
# 🛑 **零正式庫動作。**
# 🔴 **它答不出什麼**:
#   · 資料是本檔自己造的 ⇒ 答「排序邏輯對不對」, 答不出「正式庫會怎樣」。
#   · **零效能量測** —— 那個 `EXISTS` 對結果集每一列各跑一次, 而正式庫的延遲要貼完用唯讀 EXPLAIN 量
#     (主視窗 2026-09-06 裁乙 ⇒ 板列**貼完之後才關得掉**)。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260906950000_m4b_search_exact_match_first.sql"
PREV="$REPO/supabase/migrations/20260906900000_m4b_storefront_search_variant_sku.sql"
for f in "$MIG" "$PREV"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ 路徑錯, 不是查無"; exit 2; }; done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; exit 2; }; done

D=$(mktemp -d "${TMPDIR:-/tmp}/emf.XXXXXX") || exit 9
PG=$(( 59000 + ($$ % 700) ))
while lsof -nP -iTCP:"$PG" -sTCP:LISTEN >/dev/null 2>&1; do PG=$((PG+1)); done
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
Q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -tAc "$1"; }

CELLS=0; FAILS=0
cell(){ CELLS=$((CELLS+1)); if [ "$1" = 1 ]; then printf '  ✅ %s\n' "$2"; else FAILS=$((FAILS+1)); printf '  🔴 %s\n' "$2"; fi; }
EXPECT_TOTAL=11

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 PG 起不來 ⇒ ENV-FAIL"; exit 2; }
RB="$REPO/docs/runbooks/throwaway-postgres-for-migration-verification.md"
awk '/^## 2\. .*bootstrap/{s=1} s&&/^```sql$/{f=1;next} f&&/^```$/{exit} f' "$RB" > "$D/bs.raw"
awk '/^-- 業務型別/{exit} {print}' "$D/bs.raw" > "$D/bs.sql"
[ -s "$D/bs.sql" ] || { echo "🔴 抽不到 bootstrap ⇒ ENV-FAIL"; exit 2; }
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/bs.sql" >/dev/null 2>&1 \
  || { echo "🔴 bootstrap 跑不過 ⇒ ENV-FAIL"; exit 2; }

echo "══ 依序 apply(失敗容忍)"
OK=0; BAD=0
for f in "$REPO"/supabase/migrations/*.sql; do
  case "$(basename "$f")" in "$(basename "$MIG")") continue ;; esac
  if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
  then OK=$((OK+1)); else BAD=$((BAD+1)); fi
done
printf '   成功 %s ｜ 失敗 %s\n' "$OK" "$BAD"

# 🔴 replay 不乾淨 ⇒ 那支函式可能停在更舊那一代(runbook §5c)⇒ 明確把 58 那一代裝上去
echo
echo "── 格 0:貼板 58 還沒貼的世界 —— 本片必須被【前置閘③】擋下 ──"
awk '/^CREATE OR REPLACE FUNCTION public.storefront_search_product_ids/,/^\$function\$;/' \
  "$REPO/supabase/migrations/20260904180000_m4b_storefront_search_partno_long_numeric.sql" > "$D/gen58before.sql"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen58before.sql" >/dev/null 2>&1
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/g0.log" 2>&1
then cell 0 "格 0:58 還沒貼而本片仍貼得進去(前置閘③沒擋)"
else cell "$(grep -q '前置閘③' "$D/g0.log" && echo 1 || echo 0)" \
       "🔴 格 0:被【前置閘③】擋下($(sed -e 's|^psql:[^ ]*: ||' "$D/g0.log" | grep -m1 ERROR | cut -c1-46))"
fi

echo
echo "── 前置:把 58 那一代裝上去(= 貼板 58 貼完的世界)──"
awk '/^CREATE OR REPLACE FUNCTION public.storefront_search_product_ids/,/^\$function\$;/' "$PREV" > "$D/gen58.sql"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$D/gen58.sql" >"$D/gen.log" 2>&1 \
  || { echo "🔴 裝不上去 ⇒ ENV-FAIL:$(sed -e 's|^psql:[^ ]*: ||' "$D/gen.log" | grep -m1 ERROR | cut -c1-60)"; exit 2; }
MD5=$(Q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'")
cell "$([ "$MD5" = "866c53e2ef071d187bc34061bf1b4816" ] && echo 1 || echo 0)" \
     "🟢 世界對齊:md5 = 58 貼完那一版(實測 ${MD5:0:12}…)"

echo
echo "── 格 A:正常世界貼得進去 ──"
if psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$MIG" >"$D/ap.log" 2>&1
then cell 1 "格 A:apply 成功(前置閘 + 事後閘全過)"
else cell 0 "格 A:apply 失敗 ⇒ $(sed -e 's|^psql:[^ ]*: ||' "$D/ap.log" | grep -m1 ERROR | cut -c1-70)"; fi

echo
echo "── 造資料:**每一組都放競爭者** —— 沒有競爭者的排序測不出東西(codex 2026-09-06 MF1/MF2)──"
psql -h /tmp -p "$PG" -U postgres -d postgres -q -v ON_ERROR_STOP=1 >"$D/seed.log" 2>&1 <<'SQL'
INSERT INTO public.brands (id, name, slug) VALUES ('cccccccc-3333-3333-3333-333333333333','測試品牌','test-brand') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, name, raw_path, segments) VALUES ('dddddddd-4444-4444-4444-444444444444','測試分類','測試分類','["測試分類"]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.products (id, external_id, title, handle, availability, price_by_tier, brand_id, category_id) VALUES
 -- 🔴 id 刻意讓「完全命中」那張排在【字典序後面】—— 否則 ORDER BY h.id 自己就會把它排到前面,
 --    而那時這一格就分不出「是排序生效了」還是「剛好」。
 ('ffffffff-9999-9999-9999-999999999999','AZ203','完全命中那張','h-exact','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 ('11111111-1111-1111-1111-111111111111','AZ2030','只是前綴命中','h-prefix','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 ('22222222-2222-2222-2222-222222222222','PET52','母商品 PET52','h-mother','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 ('eeeeeeee-8888-8888-8888-888888888888','PET52X','變體所屬那張','h-variant','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 -- 🔴 **PET52R 那一組的競爭者**(codex MF2:原本那一組只有一張命中
 --    ⇒ 把排序裡的變體分支改成永遠 false, 那一格照樣綠 ⇒ 它測不到「變體優先」)。
 --    這一張的 id 比 eeee… 小 ⇒ **沒有排序的話它會排前面**。
 ('00000000-0000-0000-0000-000000000001','X-PET52R-Y','只是包含 PET52R 的','h-pet-contains','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 -- 🔴 **同組多筆**(codex MF1:AZ203 那一組只有一筆 ⇒ 第二排序鍵測不到,
 --    插一個 `random()` 當第二鍵也會照樣綠)。這兩張都【不是】完全命中 ⇒ 與 AZ2030 同一組。
 ('00000000-0000-0000-0000-0000000000a2','AZ2031','同組競爭者 a2','h-az-a2','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444'),
 ('00000000-0000-0000-0000-0000000000a3','AZ2032','同組競爭者 a3','h-az-a3','in-stock','{"general":100,"store":90}'::jsonb,'cccccccc-3333-3333-3333-333333333333','dddddddd-4444-4444-4444-444444444444');
INSERT INTO public.product_variants (id, product_id, sku, spec, availability) VALUES
 ('aaaaaaaa-1111-1111-1111-111111111111','eeeeeeee-8888-8888-8888-888888888888','PET52R','{"s":"1"}'::jsonb,'in-stock');
SQL
[ -s "$D/seed.log" ] && { echo "   ⚠️ 造資料有輸出:"; sed -e 's|^psql:[^ ]*: ||' "$D/seed.log" | head -2 | sed 's/^/     /'; }

echo
echo "── 格 B:主視窗給的兩個正對照 ──"
# 🔴 **`WITH ORDINALITY` 固定 RPC 的序位再 JOIN** —— 直接 `JOIN … LIMIT 1` 的話,
#    JOIN 自己可以重排, 而那時這一格量到的不是 RPC 給的順序(codex 2026-09-06 MF2)。
B1=$(Q "SELECT p.external_id FROM public.storefront_search_product_ids(ARRAY['AZ203']) WITH ORDINALITY AS s(id, ord) JOIN public.products_public p ON p.id = s.id ORDER BY s.ord LIMIT 1")
cell "$([ "$B1" = "AZ203" ] && echo 1 || echo 0)" "🟢 格 B1:搜 AZ203 ⇒ 第一筆 external_id = '${B1:-空}'(期望 AZ203, 而它的 id 是 ffff… 字典序最後)"
B2=$(Q "SELECT p.external_id FROM public.storefront_search_product_ids(ARRAY['PET52R']) WITH ORDINALITY AS s(id, ord) JOIN public.products_public p ON p.id = s.id ORDER BY s.ord LIMIT 1")
cell "$([ "$B2" = "PET52X" ] && echo 1 || echo 0)" "🟢 格 B2:搜 PET52R ⇒ 第一筆 = '${B2:-空}'(期望 PET52X;而同組有個 id 更小的競爭者 X-PET52R-Y ⇒ 沒排序的話它會排前面)"

echo
echo "── 格 C:負對照 ──"
C1=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['ZZQ9999NOTATERM'])")
cell "$([ "${C1:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 C1:現造料號 ⇒ ${C1:-?} 筆(期望 0 —— 尺會動)"
# 🔴 不完全命中的詞:順序不得被本片改動 ⇒ 應該仍是 id 升冪(第二鍵)
# 🔴 上一版寫成 `[ -n "$C2" ]` —— **`t` 與 `f` 都印綠**(codex MF3 實跑過那個 shell 判準)。
#    ⇒ 改成:**斷言完整的預期序列**。`AZ2030` 這個詞誰都不是完全命中 ⇒ 全部同一組
#      ⇒ 順序必須是純 id 升冪(第二排序鍵單獨在做事的證據)。
C2=$(Q "SELECT string_agg(id::text, ',' ) FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ2030'])) x")
C2W=$(Q "SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ2030']) ORDER BY 1) y")
cell "$([ -n "$C2" ] && [ "$C2" = "$C2W" ] && echo 1 || echo 0)" "🔴 格 C2:全不是完全命中的詞 ⇒ 順序 = 純 id 升冪(實測 '${C2:0:8}…' vs 期望 '${C2W:0:8}…')"

echo
echo "── 格 D:分頁不重複(第二排序鍵那一格)──"
# 連跑兩發同一個查詢, 順序必須逐字相同 —— 沒有第二鍵的話 planner 可以給不同順序
D1=$(Q "SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203'])) x")
D2=$(Q "SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203'])) x")
cell "$([ -n "$D1" ] && [ "$D1" = "$D2" ] && echo 1 || echo 0)" "🔴 格 D1:同一個查詢連跑兩發, 順序逐字相同(非空且相等)"
# 分頁:前 1 筆 + 後面的, 不得有交集
# 🔴 上一版把**同一次**呼叫切成兩半再取交集 ⇒ 交集當然是空的(codex MF2:那一格恆真)。
#    ⇒ 改成:**兩次獨立呼叫**各取一頁, 兩頁不得有交集、而且合起來要等於全集。
P1=$(Q "SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203']) LIMIT 2) x")
P2=$(Q "SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203']) OFFSET 2) x")
INTER=$(Q "WITH a AS (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203']) LIMIT 2),
                b AS (SELECT id FROM public.storefront_search_product_ids(ARRAY['AZ203']) OFFSET 2)
           SELECT count(*) FROM (SELECT id FROM a INTERSECT SELECT id FROM b) z")
cell "$([ "${INTER:-1}" = "0" ] && echo 1 || echo 0)" "🔴 格 D2:**兩次獨立呼叫**各取一頁, 交集 ⇒ ${INTER:-?}(期望 0 —— 分頁不重複)"
# 🔵 而「同組有幾筆」要印出來 —— 只有一筆的話上面那兩格測不到第二排序鍵
SAME=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['AZ203']) s
           WHERE NOT EXISTS (SELECT 1 FROM public.products_public p
                              WHERE p.id = s.id AND upper(p.external_id) = 'AZ203')")
cell "$([ "${SAME:-0}" -ge 2 ] && echo 1 || echo 0)" "🔵 格 D2b 同組分母:【不是】完全命中的那一組有 ${SAME:-?} 筆(>= 2 —— 少於 2 的話第二排序鍵測不到)"
TOT=$(Q "SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['AZ203'])")
cell "$([ "${TOT:-0}" -ge 2 ] && echo 1 || echo 0)" "🔵 格 D3 分母:搜 AZ203 共 ${TOT:-?} 筆(>= 2 —— 只有一筆的話上面兩格是對空集合說話)"

echo
echo "── 收 ──"
printf '   跑了 %s 格 · 紅 %s 格 · 期望 %s 格\n' "$CELLS" "$FAILS" "$EXPECT_TOTAL"
if [ "$CELLS" != "$EXPECT_TOTAL" ]; then
  printf '   🔴 格數與期望不符(多或少)⇒ 有格沒跑到, 而少跑一格在畫面上沒有形狀\n'; exit 1
fi
[ "$FAILS" = 0 ] || exit 1
printf '   ✅ %s 格全過\n' "$CELLS"
