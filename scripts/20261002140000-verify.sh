#!/usr/bin/env bash
# `20261002140000_m4b_admin_search_product_ids.sql`(S3 建單查商品)的行為驗證
# 要證的(Sean 2026-10-02 Q2 甲):後台版商品搜尋 = 顧客站同一套比對, 只是看得到已下架;顧客站那支不變;權限只開 service_role;回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。先紅:套本支之前後台版不存在。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002140000_m4b_admin_search_product_ids.sql"
DOWN="$REPO/supabase/rollbacks/20261002140000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vS3-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
# 貼板角色:正式庫的 postgres 不是 superuser ⇒ 用一個 NOSUPERUSER、身為 postgres 成員的角色來貼(265 第一次貼失敗的教訓)。
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002140000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:顧客站搜尋 = 正式庫 d35ff9b7" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "d35ff9b71cff59d8eae2a084fad35565"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
CREATE TABLE public.zz_p (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE b uuid; c uuid; p uuid; r record;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('Akrapovic', 'zz-akrapovic') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  FOR r IN SELECT * FROM (VALUES
      ('listed',   'Slip-On 鈦合金排氣管', 'S-Y6R5',     'S-Y6R5-HAPT', false),
      ('delisted', '碳纖維排氣管護蓋',     'PED-GP EVO', 'PED-GP EVO',  true),
      ('brake',    '煞車拉桿',             'BRK77',      'BRK77-BK',    false)) v(k, title, ext, sku, gone) LOOP
    INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, delisted_at)
      VALUES ('zz-' || r.k, r.title, r.ext, b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, CASE WHEN r.gone THEN now() END) RETURNING id INTO p;
    INSERT INTO public.product_variants (product_id, sku) VALUES (p, r.sku);
    INSERT INTO public.zz_p VALUES (r.k, p);
  END LOOP;
END $s$;
CREATE FUNCTION public.zz_s(fn text, terms text[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE o text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(z.k || CASE WHEN s.is_exact THEN ''!'' ELSE '''' END, '','' ORDER BY s.ord), ''-'')
                    FROM (SELECT x.*, row_number() OVER () AS ord FROM public.%I($1) x) s JOIN public.zz_p z ON z.id = s.id', fn)
    INTO o USING terms;
  RETURN o;
END $f$;
SQL
A() { Q "select public.zz_s('admin_search_product_ids', $1)"; }
F() { Q "select public.zz_s('storefront_search_product_ids', $1)"; }
echo "── 貼前(先紅)──"
cell "貼前:後台版函式不存在" "$(Q "select count(*) from pg_proc where proname='admin_search_product_ids'")" "0"
SF_BEFORE="$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
cell "顧客站那支一個字都沒變" "$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "$SF_BEFORE"
cell "「排氣管」顧客站只看得到上架那件" "$(F "array['排氣管']")" "listed"
cell "「排氣管」後台兩件都找得到(含已下架)" "$(A "array['排氣管']" | tr ',' '\n' | sort | paste -sd, -)" "delisted,listed"
cell "「PEDGPEVO」(沒打連字號空白)⇒ 已下架那件, 料號整串相等" "$(A "array['PEDGPEVO']")" "delisted!"
cell "「排氣管 碳纖維」⇒ 兩個詞都要對到" "$(A "array['排氣管','碳纖維']")" "delisted"
cell "品牌「akrapovic」⇒ 三件都是這個品牌" "$(A "array['akrapovic']" | tr ',' '\n' | sort | paste -sd, -)" "brake,delisted,listed"
cell "「BRK77-BK」⇒ 煞車拉桿, 料號整串相等" "$(A "array['BRK77-BK']")" "brake!"
cell "零個有效詞 ⇒ 零列(不是全部)" "$(A "array['  ']")" "-"
for t in "array['排氣管']" "array['akrapovic']" "array['y6r5']" "array['鈦合金','排氣管']"; do
  sf="$(F "$t")"
  # 顧客站那邊空的話這格會兩邊都空而假綠 ⇒ 先擋
  [ -n "$sf" ] && [ "$sf" != "-" ] || { cell "對照組有結果:$t" "$sf" "(非空)"; continue; }
  cell "拿掉已下架後與顧客站同順序:$t" "$(A "$t" | tr ',' '\n' | grep -v '^delisted' | paste -sd, -)" "$sf"
done
cell "權限:anon / authenticated 不可、service_role 可" "$(Q "select has_function_privilege('anon','public.admin_search_product_ids(text[])','EXECUTE')::text || has_function_privilege('authenticated','public.admin_search_product_ids(text[])','EXECUTE')::text || has_function_privilege('service_role','public.admin_search_product_ids(text[])','EXECUTE')::text")" "falsefalsetrue"
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c 'S3 前置閘')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後後台版不在、顧客站不變" "$(Q "select count(*) from pg_proc where proname='admin_search_product_ids'")|$(Q "select md5(prosrc) from pg_proc where proname='storefront_search_product_ids'")" "0|$SF_BEFORE"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(A "array['PEDGPEVO']")" "delisted!"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
