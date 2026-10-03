#!/usr/bin/env bash
# `20261004010000_m4b_storefront_variant_sku_product_ids.sql`(料號回查改用 SECURITY DEFINER 函式)的行為驗證
# 要證的:①貼前以 anon 走原本的寫法(product_variants_public 的 sku ILIKE)整表掃 ②貼後 anon 呼叫函式, 函式裡面走 product_variants_sku_norm_trgm_idx
#        ③一組料號片段, 函式結果與原寫法(anon 經過資料列權限)逐筆相同;A-1 這類依 Sean Q1 甲改成 0 列 ④下架商品的料號查不到
#        ⑤500 列上限 ⑥權限:anon / authenticated / service_role 執行得到、沒授權的角色執行不到、anon 沒有 SET ROLE 繞路
#        ⑦已貼再貼被前置閘擋 ⑧回滾來回、回滾不刪被改過的同名函式。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼。
# 資料:22,000 件上架商品 × 3 個規格 = 66,000 列(正式庫 66,602 列), 外加指名的幾個料號與 1 件下架商品。
#       資料量太小時規劃器一律全表掃, 「貼前整表掃 / 貼後走索引」那兩格就沒有判別力。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
VER=20261004010000
MIG="$REPO/supabase/migrations/${VER}_m4b_storefront_variant_sku_product_ids.sql"
DOWN="$REPO/supabase/rollbacks/${VER}-rollback.sql"
SD="$HOME/pcm-mailbox/schema-dump-20260915"
for f in "$MIG" "$DOWN" "$SD/bootstrap.sql" "$SD/prod-schema.sql"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
# 🔵 不呼叫 $SD/up.sh:新 mac mini(PCMM6)的 Homebrew PG 17 沒有 pg_cron ⇒ up.sh 的 shared_preload_libraries=pg_cron 起不來。
#    這裡照 up.sh 的步驟起叢集, 只少掉 pg_cron(bootstrap 跳過 CREATE EXTENSION pg_cron;dump 裡排程相關的物件會建失敗)。
#    本支要驗的 product_variants / products / 權限都不依賴 pg_cron;下面「前置」兩格確認世界對得上。
D="/tmp/pcm-sd-vVD-$$"; read -r PORT _R < <(bash "$REPO/scripts/free-port.sh" --two)
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { tail -6 "$D/initdb.log"; echo "ENV-FAIL:initdb"; exit 3; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" -w start >/dev/null || { tail -6 "$D/pg.log"; echo "ENV-FAIL:PG 起不來"; exit 3; }
grep -v -i 'CREATE EXTENSION pg_cron' "$SD/bootstrap.sql" | psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 > "$D/bootstrap.log" 2>&1 || { tail -6 "$D/bootstrap.log"; echo "ENV-FAIL:bootstrap"; exit 3; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -f "$SD/prod-schema.sql" > "$D/restore.log" 2>&1
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-62s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-59s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' -v ver="$VER" '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < ver {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:正規化料號三字索引在" "$(Q "select count(*) from pg_class where relname = 'product_variants_sku_norm_trgm_idx'")" "1"
cell "前置:product_variants_select_public 在" "$(Q "select count(*) from pg_policy where polname = 'product_variants_select_public'")" "1"
cell "前置:函式還不在" "$(Q "select count(*) from pg_proc where proname = 'storefront_variant_sku_product_ids'")" "0"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
SET session_replication_role = replica;
DO $s$
DECLARE b uuid; c uuid;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('Rizoma', 'zz-rizoma') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier)
    SELECT 'zz-' || g, '商品 ' || g, 'ZX' || lpad(g::text, 6, '0'), b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb
      FROM generate_series(1, 22000) g;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, delisted_at)
    VALUES ('zz-gone', '已下架商品', 'GONE777', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, now());
END $s$;
INSERT INTO public.product_variants (product_id, sku, spec, supplier_slug)
SELECT p.id, p.external_id || '-' || v.c, jsonb_build_object('c', v.c), 'zz'
  FROM public.products p CROSS JOIN (VALUES ('BK'), ('RD'), ('SV')) v(c)
 WHERE p.handle LIKE 'zz-%' AND p.handle <> 'zz-gone';
-- 指名的料號(codex 列的四種片段 + 底線 + A-1 + 下架)
UPDATE public.product_variants SET sku = 'PRN014-BK'                WHERE sku = 'ZX000001-BK';
UPDATE public.product_variants SET sku = 'PRN015-BK'                WHERE sku = 'ZX000002-BK';
UPDATE public.product_variants SET sku = 'XX1234YY'                 WHERE sku = 'ZX000003-BK';
UPDATE public.product_variants SET sku = 'DBK-3-BLK'                WHERE sku = 'ZX000004-BK';
UPDATE public.product_variants SET sku = 'DBK_3-RED'                WHERE sku = 'ZX000005-BK';
UPDATE public.product_variants SET sku = 'PED-GP EVO CBR100020 BD'  WHERE sku = 'ZX000006-BK';
UPDATE public.product_variants SET sku = 'A-1X'                     WHERE sku = 'ZX000007-BK';
INSERT INTO public.product_variants (product_id, sku, spec, supplier_slug)
  SELECT id, 'GONE-777-QQ', '{"c":"x"}'::jsonb, 'zz' FROM public.products WHERE handle = 'zz-gone';
RESET session_replication_role;
ANALYZE public.products; ANALYZE public.product_variants;
SQL
cell "資料:product_variants 66,001 列" "$(Q "select count(*) from public.product_variants")" "66001"
GUC="SET work_mem='3500kB'; SET random_page_cost=1.1; SET effective_cache_size='768MB'; SET jit=off;"
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/%/\\%/g' -e 's/_/\\_/g' -e "s/'/''/g"; }
sq() { printf '%s' "$1" | sed -e "s/'/''/g"; }
# 原本的寫法:anon 經過 product_variants_public(資料列權限照套)。🔴 報錯要印 ERR, 不能讓兩邊報錯變成兩個空字串而判成相同
OLD() { P -tA -c "SET ROLE anon; SELECT coalesce(string_agg(DISTINCT product_id::text, ',' ORDER BY product_id::text), '-') FROM (SELECT product_id FROM public.product_variants_public WHERE sku ILIKE '%$(esc "$1")%' LIMIT 500) x" 2>&1 || echo ERR; }
NEW() { P -tA -c "SET ROLE anon; SELECT coalesce(string_agg(DISTINCT product_id::text, ',' ORDER BY product_id::text), '-') FROM public.storefront_variant_sku_product_ids('$(sq "$1")')" 2>&1 || echo ERR; }
NEWCNT() { P -tA -c "SET ROLE anon; SELECT count(*) FROM public.storefront_variant_sku_product_ids('$(sq "$1")')" 2>&1 || echo ERR; }
echo "── 貼前 ──"
cell "貼前(先紅):anon 走原寫法整表掃(Seq Scan on product_variants)" "$(P -tA -c "$GUC SET ROLE anon; EXPLAIN SELECT product_id FROM public.product_variants_public WHERE sku ILIKE '%prn01%' LIMIT 500" | grep -c 'Seq Scan on product_variants')" "1"
PATS=('RN0' 'PRN01' '1234' 'BLK' 'GP EVO' 'DBK_3' 'DBK-3' 'zz9q' 'prn014-bk')
BEFORE=()   # 與 PATS 同索引(macOS 內建 bash 3.2 沒有關聯陣列)
for i in "${!PATS[@]}"; do BEFORE[$i]="$(OLD "${PATS[$i]}")"; done
cell "對照組:RN0 原寫法找得到 PRN014 / PRN015 兩件(資料真的在)" "$(printf '%s' "${BEFORE[0]}" | tr ',' '\n' | grep -c '^[0-9a-f-]\{36\}$')" "2"
cell "對照組:DBK_3 原寫法只找到底線那一件(escape 有效)" "$(printf '%s' "${BEFORE[5]}" | tr ',' '\n' | grep -c '^[0-9a-f-]\{36\}$')" "1"
cell "對照組:A-1 原寫法找得到 A-1X 那件" "$(OLD 'A-1' | tr ',' '\n' | grep -c '^[0-9a-f-]\{36\}$')" "1"
cell "對照組:下架商品的料號原寫法(anon)也找不到" "$(OLD 'GONE-777')" "-"
cell "比對有判別力:原寫法 9 組都沒有報錯" "$(for i in "${!PATS[@]}"; do printf '%s\n' "${BEFORE[$i]}"; done | grep -c ERR)" "0"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster; CREATE ROLE zz_nobody NOLOGIN;" >/dev/null
echo "── 貼(非 superuser)──"
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; PN -f "$MIG" 2>&1 | tail -5; exit 1; }
cell "函式在、owner = postgres、SECURITY DEFINER、STABLE、search_path 空字串" "$(Q "select pg_get_userbyid(proowner) || '|' || prosecdef::text || '|' || provolatile::text || '|' || array_to_string(proconfig, ',') from pg_proc where proname = 'storefront_variant_sku_product_ids'")" 'postgres|true|s|search_path=""'
FNPLAN() { P -c "$GUC LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_nested_statements = on; SET auto_explain.log_level = notice; SET client_min_messages = notice; SET ROLE anon; SELECT count(*) FROM public.storefront_variant_sku_product_ids('$(sq "$1")');" 2>&1; }
cell "貼後:anon 呼叫, 函式裡面走 product_variants_sku_norm_trgm_idx" "$([ "$(FNPLAN 'PRN01' | grep -c 'product_variants_sku_norm_trgm_idx')" -ge 1 ] && echo yes || echo no)" "yes"
cell "貼後:函式裡面沒有整表掃 product_variants" "$(FNPLAN 'PRN01' | grep -c 'Seq Scan on product_variants')" "0"
cell "貼後:計畫輸出沒有 ERROR(上一格的 0 不是因為報錯)" "$(FNPLAN 'PRN01' | grep -c 'ERROR')" "0"
DIFF=""; for i in "${!PATS[@]}"; do a="$(NEW "${PATS[$i]}")"; [ "$a" = "${BEFORE[$i]}" ] || DIFF="$DIFF ${PATS[$i]}(${BEFORE[$i]}→$a)"; done
cell "9 組料號片段:函式結果與原寫法逐筆相同(含底線、空白、大小寫、找不到)" "$DIFF" ""
cell "A-1(去符號後 2 個字)⇒ 0 列(Sean Q1 甲, 原寫法找得到 1 件)" "$(NEWCNT 'A-1')" "0"
cell "ab / --- / %%% / 空字串 ⇒ 都是 0 列" "$(for q in 'ab' '---' '%%%' ''; do NEWCNT "$q"; done | paste -sd, -)" "0,0,0,0"
cell "下架商品的料號:函式查不到" "$(NEW 'GONE-777')" "-"
cell "500 列上限:ZX0 命中 6 萬多列, 函式回 500" "$(NEWCNT 'ZX0')" "500"
echo "── 權限 ──"
cell "anon / authenticated / service_role 執行得到" "$(Q "select string_agg(has_function_privilege(r, 'public.storefront_variant_sku_product_ids(text)', 'EXECUTE')::text, ',' order by r) from unnest(array['anon','authenticated','service_role']) r")" "true,true,true"
cell "沒授權的角色(zz_nobody)執行不到(PUBLIC 那份收掉了)" "$(Q "select has_function_privilege('zz_nobody', 'public.storefront_variant_sku_product_ids(text)', 'EXECUTE')")" "f"
cell "anon 切得過去而可執行的角色只有 anon 自己(權限規範 §3.5)" "$(Q "select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r where pg_has_role('anon', r.oid, 'SET') and has_function_privilege(r.oid, 'public.storefront_variant_sku_product_ids(text)'::regprocedure, 'EXECUTE')")" "anon"
cell "zz_nobody 直接呼叫被拒" "$(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -tA -c "SET ROLE zz_nobody; SELECT count(*) FROM public.storefront_variant_sku_product_ids('PRN01')" 2>&1 | grep -c 'permission denied')" "1"
echo "── 再貼 / 回滾 ──"
cell "已貼過再貼 ⇒ 前置閘⓪擋" "$(PN -f "$MIG" 2>&1 | grep -c '前置閘⓪')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後函式不在" "$(Q "select count(*) from pg_proc where proname = 'storefront_variant_sku_product_ids'")" "0"
cell "回滾後再跑回滾 ⇒ 前置閘①擋(沒有東西可還原)" "$(PN -f "$DOWN" 2>&1 | grep -c '前置閘①')" "1"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(Q "select count(*) from pg_proc where proname = 'storefront_variant_sku_product_ids'")" "1"
P -q -c "CREATE OR REPLACE FUNCTION public.storefront_variant_sku_product_ids(p_q text) RETURNS TABLE(product_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS \$f\$ SELECT NULL::uuid WHERE false \$f\$;" >/dev/null
cell "函式本體被改過 ⇒ 回滾前置閘②擋, 不刪" "$(PN -f "$DOWN" 2>&1 | grep -c '前置閘②')" "1"
cell "被擋時函式還在" "$(Q "select count(*) from pg_proc where proname = 'storefront_variant_sku_product_ids'")" "1"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
