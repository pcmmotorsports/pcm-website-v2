#!/usr/bin/env bash
# `20261002190000_m4b_vehicle_taxonomy_pairs_view.sql`(車款精簡版改讀沿索引跳著讀的新 view)的行為驗證
# 要證的:①貼前貼後輸出逐字相同 —— postgres 身分與 anon 身分(客人)各比一次, 含「只剩下架商品」的車款
#        ②新 view 走 ix_pf_lookup / ix_pfe_lookup、不整份掃 product_fitments ③函式屬性與權限不變、新 view 只給讀
#        ④已貼過再貼會被前置閘擋 ⑤回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。底表 RLS 照 dump 開著。用非 superuser 角色貼。
# 資料:上架與下架商品各有車款;有一組(廠牌, 車型)只掛在下架商品上、兩張表各一組 —— 用 invoker 身分讀表就會少掉它們(先紅那格)。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002190000_m4b_vehicle_taxonomy_pairs_view.sql"
DOWN="$REPO/supabase/rollbacks/20261002190000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vTX-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
# 用 anon 身分跑(客人):SET ROLE 只在這一個連線裡
QA() { P -tA -c "SET ROLE anon; $1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-62s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-59s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
# 依序重放之後已貼的 migration(第一個參數 ≤ 版本 < 第二個參數)
REPLAY() { while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' -v lo="$1" -v hi="$2" '$1 ~ /^2026/ && $1 >= lo && $1 < hi {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u); }
# 🔴 20260920020000(建車款精簡版)的事後閘要求底表有資料 ⇒ 空表重放會被它擋掉、函式不存在。先放到它前一支, 灌資料, 再放後面的。
REPLAY 20260915100001 20260920020000
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
DO $s$
DECLARE b uuid; c uuid; up1 uuid; up2 uuid; gone uuid;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('Rizoma', 'zz-rizoma') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier)
    VALUES ('zz-up1', '上架一', 'ZZUP1', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb) RETURNING id INTO up1;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier)
    VALUES ('zz-up2', '上架二', 'ZZUP2', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb) RETURNING id INTO up2;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, delisted_at)
    VALUES ('zz-gone', '已下架', 'ZZGONE', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, now()) RETURNING id INTO gone;
  -- product_fitments:同一組不同年份、兩件商品掛同一組、只掛在下架商品上的一組(DUCATI / PANIGALE V4)
  INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end) VALUES
    (up1,  'HONDA',  'CBR600RR',     2013, 2016),
    (up1,  'HONDA',  'CBR600RR',     2017, NULL),
    (up2,  'HONDA',  'CBR600RR',     NULL, NULL),
    (up2,  'YAMAHA', 'YZF-R1',       2015, 2019),
    (gone, 'DUCATI', 'PANIGALE V4',  2018, NULL),
    (gone, 'HONDA',  'CBR600RR',     2020, NULL);
  -- product_fitments_effective:與上面重疊的 direct、只在這張表的 inherited、只掛在下架商品上的一組(KTM / 890 DUKE)
  INSERT INTO public.product_fitments_effective (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code) VALUES
    (up1,  'HONDA',  'CBR600RR',  2013, 2016, 'direct',    'CBR600RR'),
    (up1,  'HONDA',  'CBR650R',   2019, NULL, 'inherited', 'CBR600RR'),
    (up2,  'YAMAHA', 'YZF-R1',    2015, 2019, 'direct',    'YZF-R1'),
    (up2,  'YAMAHA', 'YZF-R1M',   2015, 2019, 'inherited', 'YZF-R1'),
    (gone, 'KTM',    '890 DUKE',  2021, NULL, 'inherited', '790 DUKE');
  -- 陪跑:兩萬列、200 組(讓規劃器在有索引可走時真的選索引;幾十列的表它一律全表掃)
  INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end)
    SELECT up1, 'ZZB' || lpad((g % 20)::text, 2, '0'), 'M' || lpad((g % 10)::text, 2, '0'), g, NULL
      FROM generate_series(1, 20000) g;
  INSERT INTO public.product_fitments_effective (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
    SELECT up2, 'ZZE' || lpad((g % 20)::text, 2, '0'), 'N' || lpad((g % 10)::text, 2, '0'), g, NULL, 'direct', 'N' || lpad((g % 10)::text, 2, '0')
      FROM generate_series(1, 20000) g;
END $s$;
VACUUM ANALYZE public.product_fitments;
VACUUM ANALYZE public.product_fitments_effective;
VACUUM ANALYZE public.products;
SQL
REPLAY 20260920020000 20261002190000
FN="'public.get_vehicle_taxonomy_base()'::regprocedure"
cell "前置:車款精簡版 = 正式庫 95ce06b5" "$(Q "select md5(prosrc) from pg_proc where oid = $FN")" "95ce06b5a052d51763c6eeba540670b5"
cell "前置:兩張底表的 RLS 開著" "$(Q "select string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where oid in ('public.product_fitments'::regclass, 'public.product_fitments_effective'::regclass)")" "product_fitments=true,product_fitments_effective=true"
cell "前置:兩個索引開頭是 (moto_brand, model_code)" "$(Q "select string_agg(c.relname || ':' || pg_get_indexdef(c.oid, 1, true) || ',' || pg_get_indexdef(c.oid, 2, true), ' ' order by c.relname) from pg_class c where c.relname in ('ix_pf_lookup', 'ix_pfe_lookup')")" "ix_pf_lookup:moto_brand,model_code ix_pfe_lookup:moto_brand,model_code"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
OUTPUT_PG() { Q "select md5(public.get_vehicle_taxonomy_base()::text) || '|' || (public.get_vehicle_taxonomy_base() ->> 'n')"; }
OUTPUT_ANON() { QA "select md5(public.get_vehicle_taxonomy_base()::text) || '|' || (public.get_vehicle_taxonomy_base() ->> 'n')"; }
HAS_GONE_PAIRS() { Q "select count(*) from jsonb_array_elements(public.get_vehicle_taxonomy_base() -> 'rows') r where (r ->> 0, r ->> 1) in (('DUCATI', 'PANIGALE V4'), ('KTM', '890 DUKE'))"; }
INVOKER_READ="select count(*) from (select moto_brand, model_code from public.product_fitments union select moto_brand, model_code from public.product_fitments_effective) d"
# 期望組數:陪跑 20+20 組(g%20 與 g%10 同步, 所以每個廠牌只配一個車型)+ 指名 6 組
BEFORE_PG="$(OUTPUT_PG)"; BEFORE_ANON="$(OUTPUT_ANON)"
cell "貼前:postgres 身分 46 組" "${BEFORE_PG#*|}" "46"
cell "貼前:anon 身分與 postgres 身分逐字相同" "$BEFORE_ANON" "$BEFORE_PG"
cell "貼前:只掛在下架商品上的兩組在輸出裡" "$(HAS_GONE_PAIRS)" "2"
cell "先紅(資料有判別力):anon 直接讀底表 ⇒ RLS 擋掉下架那兩組" "$(Q "$INVOKER_READ")-$(QA "$INVOKER_READ")" "46-44"
# 正式庫 postgres(非 superuser)是 anon / authenticated 的成員且 set_option=t(2026-10-02 唯讀查 pg_auth_members)⇒ migration 裡的 SET LOCAL ROLE anon 貼得動。
# 拋棄式 PG 的 postgres 是 superuser、dump 沒帶這條成員關係 ⇒ 補上, 讓非 superuser 貼板角色經 postgres 也切得到 anon。
P -q -c "GRANT anon, authenticated TO postgres WITH SET TRUE; CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
cell "本體 md5 = 377aebad" "$(Q "select md5(prosrc) from pg_proc where oid = $FN")" "377aebadd8ee0fb5e1c2999eb485389f"
cell "postgres 身分:輸出與貼前逐字相同" "$(OUTPUT_PG)" "$BEFORE_PG"
cell "anon 身分(客人):輸出與貼前逐字相同" "$(OUTPUT_ANON)" "$BEFORE_ANON"
cell "只掛在下架商品上的兩組仍在" "$(HAS_GONE_PAIRS)" "2"
cell "函式屬性照舊(invoker|search_path|owner|STABLE)" "$(Q "select prosecdef::text || '|' || array_to_string(proconfig, ',') || '|' || pg_get_userbyid(proowner) || '|' || provolatile::text from pg_proc where oid = $FN")" 'false|search_path=""|postgres|s'
cell "函式 EXECUTE 名單照舊" "$(Q "select string_agg(coalesce(nullif(pg_get_userbyid(x.grantee), ''), 'PUBLIC'), ',' order by pg_get_userbyid(x.grantee)) from pg_proc p, aclexplode(p.proacl) x where p.oid = $FN and x.privilege_type = 'EXECUTE'")" "anon,authenticated,postgres"
cell "新 view:owner postgres、security_invoker=false" "$(Q "select pg_get_userbyid(relowner) || '|' || array_to_string(reloptions, ',') from pg_class where oid = 'public.vehicle_taxonomy_pairs_v'::regclass")" "postgres|security_invoker=false"
cell "新 view:anon 只能讀(SELECT|INSERT|UPDATE|DELETE)" "$(Q "select string_agg(has_table_privilege('anon', 'public.vehicle_taxonomy_pairs_v', p)::text, '|') from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p")" "true|false|false|false"
cell "新 view:PUBLIC 沒有任何權限" "$(Q "select count(*) from pg_class c, aclexplode(c.relacl) x where c.oid = 'public.vehicle_taxonomy_pairs_v'::regclass and x.grantee = 0")" "0"
cell "新 view:只有兩欄(沒有 product_id 等商品欄)" "$(Q "select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.vehicle_taxonomy_pairs_v'::regclass and attnum > 0")" "moto_brand,model_code"
PLAN="$(Q "explain select * from public.vehicle_taxonomy_pairs_v")"
cell "新 view 走 ix_pf_lookup" "$(printf '%s\n' "$PLAN" | grep -c 'ix_pf_lookup' | awk '{print ($1 > 0) ? "yes" : "no"}')" "yes"
cell "新 view 走 ix_pfe_lookup" "$(printf '%s\n' "$PLAN" | grep -c 'ix_pfe_lookup' | awk '{print ($1 > 0) ? "yes" : "no"}')" "yes"
cell "新 view 沒有整份掃兩張表(Seq Scan)" "$(printf '%s\n' "$PLAN" | grep -c -E 'Seq Scan on product_fitments')" "0"
cell "已貼過再貼 ⇒ 前置閘①擋下" "$(PN -f "$MIG" 2>&1 | grep -c '前置閘①')" "1"
echo "── 回滾 ──"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾用非 superuser 貼不上"; FAIL=1; }
cell "回滾後本體 md5 = 95ce06b5" "$(Q "select md5(prosrc) from pg_proc where oid = $FN")" "95ce06b5a052d51763c6eeba540670b5"
cell "回滾後新 view 不在" "$(Q "select coalesce(to_regclass('public.vehicle_taxonomy_pairs_v')::text, 'none')")" "none"
cell "回滾後 anon 身分輸出與貼前相同" "$(OUTPUT_ANON)" "$BEFORE_ANON"
# 擋得住 Fable R1 抓到的那個錯嗎:把 view 改成 security_invoker = true ⇒ postgres 身分(owner, 不受 RLS)仍相同, 只有 anon 身分少兩組
#   (a) 原樣 ⇒ 事後閘②(查 reloptions)先擋;(b) 再把②那一句拿掉 ⇒ 要靠⑤b(anon 身分比快照)擋 —— 證⑤b 自己也有判別力
BAD="$D/bad-invoker.sql"; sed 's/WITH (security_invoker = false) AS/WITH (security_invoker = true) AS/' "$MIG" > "$BAD"
BAD2="$D/bad-invoker-no-gate2.sql"; sed "s/@> ARRAY\['security_invoker=false'\]/@> ARRAY[]::text[]/" "$BAD" > "$BAD2"
cell "壞版本真的改到了 security_invoker / 拿掉了②那一句" "$(grep -c 'security_invoker = true' "$BAD")/$(grep -c "ARRAY\['security_invoker=false'\]" "$BAD2")" "1/0"
cell "壞版本(a)⇒ 事後閘②擋下" "$(PN -f "$BAD" 2>&1 | grep -c '事後閘②')" "1"
cell "壞版本(b)⇒ 事後閘⑤b 擋下(anon 少兩組)" "$(PN -f "$BAD2" 2>&1 | grep -c '事後閘⑤b:anon 身分貼前 46 組、貼後 44 組')" "1"
cell "壞版本被擋後函式仍是舊本體(整支退回)" "$(Q "select md5(prosrc) from pg_proc where oid = $FN")" "95ce06b5a052d51763c6eeba540670b5"
cell "回滾後再貼一次成功" "$(PN -f "$MIG" >/dev/null 2>&1 && Q "select md5(prosrc) from pg_proc where oid = $FN")" "377aebadd8ee0fb5e1c2999eb485389f"
echo "共 $N 格"
[ "$FAIL" = 0 ] && echo "✅ 全部通過" || { echo "🔴 有格子沒過"; exit 1; }
