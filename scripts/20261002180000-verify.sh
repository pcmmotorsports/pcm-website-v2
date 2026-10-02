#!/usr/bin/env bash
# `20261002180000_m4b_storefront_search_partno_prefix_index.sql`(前台搜料號「料號開頭」那段走得到索引)的行為驗證
# 要證的:①同一組搜尋字貼前貼後結果逐筆相同(id、is_exact、tier、順序)②「料號開頭」那段貼前全表掃、貼後走 products_external_id_normalized_idx
#        ③權限與 SET 子句不變 ④已貼過再貼會被前置閘擋 ⑤回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼。
# 資料:兩萬件假商品(讓規劃器在有索引可走時真的會選索引;幾十件的表它一律全表掃, 那一格就沒有判別力)。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002180000_m4b_storefront_search_partno_prefix_index.sql"
DOWN="$REPO/supabase/rollbacks/20261002180000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vPX-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
# 貼板角色:正式庫的 postgres 不是 superuser ⇒ 用一個 NOSUPERUSER、身為 postgres 成員的角色來貼。
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002180000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:顧客站搜尋 = 正式庫 d35ff9b7" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "d35ff9b71cff59d8eae2a084fad35565"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
CREATE TABLE public.zz_p (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE b uuid; c uuid; p uuid; r record;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('Rizoma', 'zz-rizoma') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  -- 指名的幾件:料號開頭比對要找得到 / 下架的要找不到 / 規格料號那條要找得到
  FOR r IN SELECT * FROM (VALUES
      ('za',      'Slip-On 排氣管',   'ZA-222Y',          'ZA222Y-BK',   false),
      ('za2',     '排氣管尾段',        'ZA2229',           'ZA2229',      false),
      ('pe',      '腳踏後移',          'PE668',            'PE668B',      false),
      ('a01',     '碳纖維護蓋',        'A01041C4240B7-0',  'A01041C4240', false),
      ('gone',    '已下架煞車拉桿',    'ZA222Q',           'ZA222Q',      true),
      ('carbon',  'carbon 側蓋',       'CB-100',           'CB100',       false)) v(k, title, ext, sku, gone) LOOP
    INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, delisted_at)
      VALUES ('zz-' || r.k, r.title, r.ext, b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, CASE WHEN r.gone THEN now() END) RETURNING id INTO p;
    INSERT INTO public.product_variants (product_id, sku) VALUES (p, r.sku);
    INSERT INTO public.zz_p VALUES (r.k, p);
  END LOOP;
  -- 兩萬件陪跑(料號 QX00001…, 不撞上面任何一個搜尋字)
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier)
    SELECT 'zz-fill-' || g, '陪跑商品 ' || g, 'QX' || lpad(g::text, 5, '0'), b, c, '{"general":500,"store":null,"premiumStore":null}'::jsonb
      FROM generate_series(1, 20000) g;
END $s$;
ANALYZE public.products; ANALYZE public.product_variants;
-- 每組搜尋字的結果(含順序)攤成一個字串:k 或 fill, ! = is_exact, :tier
CREATE FUNCTION public.zz_s(terms text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(coalesce(z.k, 'fill') || CASE WHEN s.is_exact THEN '!' ELSE '' END || ':' || s.tier, ',' ORDER BY s.ord), '-')
    FROM (SELECT x.*, row_number() OVER () AS ord FROM public.storefront_search_product_ids(terms) x) s
    LEFT JOIN public.zz_p z ON z.id = s.id;
$f$;
CREATE TABLE public.zz_before (q text PRIMARY KEY, res text);
SQL
S() { Q "select public.zz_s(ARRAY['$1'])"; }
TERMS=("ZA222Y" "ZA222" "za-222" "PE668" "PE66" "A01041C4240" "A0104" "ZA222Q" "ZQX999R" "carbon" "排氣管" "QX0001" "CB100")
for q in "${TERMS[@]}"; do Q "insert into public.zz_before values ('$q', public.zz_s(ARRAY['$q']))" >/dev/null; done
cell "對照組:ZA222 貼前就找得到 za 與 za2 兩件(資料真的在)" "$(Q "select string_agg(k, ',' order by k) from public.zz_p where id in (select id from public.storefront_search_product_ids(ARRAY['ZA222']))")" "za,za2"
cell "對照組:下架的 ZA222Q 找不到" "$(S 'ZA222Q')" "-"
# 「料號開頭」那段走哪條路:用 auto_explain 把函式裡面的計畫印到 client(只在拋棄式 PG 用 superuser 開)
PLAN() { P -c "LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_nested_statements = on; SET auto_explain.log_level = notice; SET client_min_messages = notice; SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['$1']);" 2>&1; }
cell "貼前(先紅):料號開頭那段有全表掃(Seq Scan on products)" "$([ "$(PLAN 'ZA222' | grep -c 'Seq Scan on products p')" -gt 0 ] && echo yes || echo no)" "yes"
BEFORE_IDX="$(PLAN 'ZA222' | grep -c 'products_external_id_normalized_idx')"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
cell "本體 md5 = 3b574dff" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "3b574dfff654377ada66b1359136ea35"
DIFF="$(Q "select coalesce(string_agg(q || '=' || res || '→' || public.zz_s(ARRAY[q]), ' '), '') from public.zz_before where res <> public.zz_s(ARRAY[q])")"
cell "13 組搜尋字貼前貼後逐筆相同(id、精確、tier、順序)" "$DIFF" ""
cell "比對到的搜尋字真的有 13 組(不是 0 組而假綠)" "$(Q "select count(*) from public.zz_before")" "13"
AFTER_IDX="$(PLAN 'ZA222' | grep -c 'products_external_id_normalized_idx')"
cell "料號開頭那段:貼後走 products_external_id_normalized_idx 的次數比貼前多" "$([ "$AFTER_IDX" -gt "$BEFORE_IDX" ] && echo yes || echo "no(貼前 $BEFORE_IDX 貼後 $AFTER_IDX)")" "yes"
cell "權限與 SET 子句照舊" "$(Q "select prosecdef::text || '|' || array_to_string(proconfig, ',') || '|' || pg_get_userbyid(proowner) from pg_proc where proname='storefront_search_product_ids'")|$(Q "select has_function_privilege('anon','public.storefront_search_product_ids(text[])','EXECUTE')::text")" 'true|search_path=""|postgres|true'
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c '前置閘①')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後回到貼前本體 d35ff9b7" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "d35ff9b71cff59d8eae2a084fad35565"
cell "回滾後結果仍與貼前相同" "$(Q "select count(*) from public.zz_before where res <> public.zz_s(ARRAY[q])")" "0"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "3b574dfff654377ada66b1359136ea35"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
