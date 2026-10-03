#!/usr/bin/env bash
# `20261003230000_m4b_fitment_brand_product_index.sql`(兩張適用車款表加「品牌 + 商品編號」索引)的行為驗證
# 要證的:①貼前重現正式庫的慢查法(Ducati 只選品牌 ⇒ Merge Append 掃 ix_pf_product 全索引)②貼後走兩個新索引
#        ③search_catalog_by_vehicle 函式裡面也換了查法、Ducati 第 1 頁結果貼前貼後相同 ④Kawasaki 那種少量品牌不受影響
#        ⑤用 apply-paste-board 那種 `-1` 貼會整支退回、庫不變 ⑥已貼再貼被前置閘擋 ⑦回滾來回 ⑧回滾檔不刪別人的同名索引。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼。
# 資料:照正式庫 2026-10-03 的比例(唯讀實量):product_fitments 約 19 萬列、Ducati 7.7 萬;
#       product_fitments_effective 約 30 萬列、Ducati 12.7 萬(41%)。規劃器設定照正式庫:work_mem 3500kB、random_page_cost 1.1。
#       資料量太小時規劃器一律走雜湊或全表掃, 那一格就沒有判別力。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
VER=20261003230000
MIG="$REPO/supabase/migrations/${VER}_m4b_fitment_brand_product_index.sql"
DOWN="$REPO/supabase/rollbacks/${VER}-rollback.sql"
SD="$HOME/pcm-mailbox/schema-dump-20260915"
for f in "$MIG" "$DOWN" "$SD/bootstrap.sql" "$SD/prod-schema.sql"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
# 🔵 不呼叫 $SD/up.sh:新 mac mini(PCMM6)的 Homebrew PG 17 沒有 pg_cron ⇒ up.sh 的 shared_preload_libraries=pg_cron 起不來。
#    這裡照 up.sh 的步驟起叢集, 只少掉 pg_cron(bootstrap 跳過 CREATE EXTENSION pg_cron;dump 裡排程相關的物件會建失敗)。
#    本支要驗的兩張適用車款表、search_catalog_by_vehicle 都不依賴 pg_cron;下面「前置」兩格確認世界對得上。
D="/tmp/pcm-sd-vFB-$$"; read -r PORT _R < <(bash "$REPO/scripts/free-port.sh" --two)
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
cell "前置:兩張表的舊索引都在(ix_pf_product / ux_pfe_row / 兩支 lookup)" "$(Q "select count(*) from pg_class where relname in ('ix_pf_product','ux_pfe_row','ix_pf_lookup','ix_pfe_lookup')")" "4"
cell "前置:新索引還不在" "$(Q "select count(*) from pg_class where relname in ('ix_pf_brand_product','ix_pfe_brand_product')")" "0"
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
      FROM generate_series(1, 25000) g;
END $s$;
CREATE TABLE public.zz_pid AS SELECT row_number() OVER (ORDER BY handle) AS n, id FROM public.products WHERE handle LIKE 'zz-%';
-- product_fitments:前 6,400 件是 Ducati(每件 12 列 = 76,800);其餘 18,600 件分給 60 個品牌(每件 6 列 = 111,600)
INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end)
SELECT p.id,
       CASE WHEN p.n <= 6400 THEN 'Ducati' WHEN p.n % 60 = 0 THEN 'Kawasaki' ELSE 'Brand' || (p.n % 60) END,
       'M' || k, 2010, 2020
  FROM public.zz_pid p CROSS JOIN LATERAL generate_series(1, CASE WHEN p.n <= 6400 THEN 12 ELSE 6 END) k;
-- product_fitments_effective:前 6,061 件 Ducati(每件 21 列 = 127,281);6,062–23,000 件每件 10 列(169,390)
INSERT INTO public.product_fitments_effective (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
SELECT p.id,
       CASE WHEN p.n <= 6061 THEN 'Ducati' WHEN p.n % 60 = 0 THEN 'Kawasaki' ELSE 'Brand' || (p.n % 60) END,
       'M' || k, 2010, 2020, 'direct', 'M' || k
  FROM public.zz_pid p CROSS JOIN LATERAL generate_series(1, CASE WHEN p.n <= 6061 THEN 21 ELSE 10 END) k
 WHERE p.n <= 23000;
RESET session_replication_role;
ANALYZE public.products; ANALYZE public.product_fitments; ANALYZE public.product_fitments_effective;
SQL
cell "資料:effective 的 Ducati 列數(約 41%)" "$(Q "select count(*) from public.product_fitments_effective where moto_brand='Ducati'")" "127281"
cell "資料:Ducati 合併去重後的商品數" "$(Q "select count(*) from (select product_id from public.product_fitments where moto_brand='Ducati' union select product_id from public.product_fitments_effective where moto_brand='Ducati') m")" "6400"
# 規劃器設定照正式庫(2026-10-03 pg_settings 唯讀實讀)
GUC="SET work_mem='3500kB'; SET hash_mem_multiplier=2; SET random_page_cost=1.1; SET effective_cache_size='768MB'; SET jit=off;"
MATCHED() { printf "SELECT count(*) FROM (SELECT product_id FROM public.product_fitments WHERE moto_brand = '%s' UNION SELECT product_id FROM public.product_fitments_effective WHERE moto_brand = '%s') m;" "$1" "$1"; }
PLAN() { P -tA -c "$GUC EXPLAIN $(MATCHED "$1")"; }
# 🔴 anon = 網站實際的身分(函式是 SECURITY INVOKER ⇒ 兩張表的資料列權限照套)。
#    資料列權限下, 不是 leakproof 的條件不能先用索引過濾(料號那支 ilike 就因此用不上索引)⇒ 這裡一定要用 anon 量。
PLAN_ANON() { P -tA -c "$GUC SET ROLE anon; EXPLAIN $(MATCHED "$1")" 2>&1; }
# 函式裡面的計畫:auto_explain 只在拋棄式 PG 用 superuser 開
FNPLAN() { P -c "$GUC LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_nested_statements = on; SET auto_explain.log_level = notice; SET client_min_messages = notice;
  SELECT count(*) FROM public.search_catalog_by_vehicle(p_categories=>'{}'::text[], p_brand=>'$1', p_model=>null, p_year=>null, p_offset=>0, p_limit=>100, p_sort=>'recommend', p_category=>null, p_brand_slugs=>null, p_price_min=>null, p_price_max=>null, p_new_since=>null, p_terms=>null, p_fit_scope=>'fit');" 2>&1; }
# 🔴 查詢報錯要印 ERR, 不能讓兩邊都報錯變成兩個空字串而判成「相同」(第一版就這樣假綠過)
FNPLAN_ANON() { P -c "$GUC LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_nested_statements = on; SET auto_explain.log_level = notice; SET client_min_messages = notice; SET ROLE anon;
  SELECT count(*) FROM public.search_catalog_by_vehicle(p_categories=>'{}'::text[], p_brand=>'$1', p_model=>null, p_year=>null, p_offset=>0, p_limit=>100, p_sort=>'recommend', p_category=>null, p_brand_slugs=>null, p_price_min=>null, p_price_max=>null, p_new_since=>null, p_terms=>null, p_fit_scope=>'fit');" 2>&1; }
FNRES() { P -tA -c "SELECT coalesce(string_agg(item->>'id', ',' ORDER BY ord), '-') FROM (SELECT item, row_number() OVER () ord FROM public.search_catalog_by_vehicle(p_categories=>'{}'::text[], p_brand=>'$1', p_model=>null, p_year=>null, p_offset=>0, p_limit=>100, p_sort=>'recommend', p_category=>null, p_brand_slugs=>null, p_price_min=>null, p_price_max=>null, p_new_since=>null, p_terms=>null, p_fit_scope=>'fit')) x" 2>&1 || echo ERR; }
echo "── 貼前 ──"
cell "貼前(先紅):Ducati 走 ix_pf_product 全索引掃 + Merge Append(正式庫同款)" "$(PLAN Ducati | grep -cE 'Merge Append|Index Scan using ix_pf_product on product_fitments')" "2"
echo "    貼前 Ducati 計畫:"; PLAN Ducati | sed 's/^/      /'
# 正式庫 effective 那邊是 ux_pfe_row(Index Only Scan), 這裡是 ix_pfe_product —— 兩支都以 product_id 開頭 ⇒ 同樣是整個索引掃完再過濾品牌
cell "貼前:effective 那邊也是以 product_id 開頭的索引整個掃(ix_pfe_product 或 ux_pfe_row)" "$(PLAN Ducati | grep -cE 'using (ix_pfe_product|ux_pfe_row) on product_fitments_effective')" "1"
cell "貼前對照:Kawasaki 走品牌索引(ix_pf_lookup / ix_pfe_lookup)" "$([ "$(PLAN Kawasaki | grep -cE 'ix_pf_lookup|ix_pfe_lookup')" -ge 2 ] && echo yes || echo no)" "yes"
cell "貼前:函式裡面 Ducati 也用 ix_pf_product" "$([ "$(FNPLAN Ducati | grep -c 'ix_pf_product')" -ge 1 ] && echo yes || echo no)" "yes"
echo "    貼前 anon 計畫:"; PLAN_ANON Ducati | sed 's/^/      /'
cell "貼前(anon):Ducati 也是以 product_id 開頭的索引整個掃" "$([ "$(PLAN_ANON Ducati | grep -cE 'ix_pf_product|ix_pfe_product|ux_pfe_row')" -ge 1 ] && echo yes || echo no)" "yes"
RES_D_BEFORE="$(FNRES Ducati)"; RES_K_BEFORE="$(FNRES Kawasaki)"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
echo "── 用 apply-paste-board 的方式(psql -1)貼 ⇒ 應該整支退回 ──"
ONE="$(PN -1 -f "$MIG" 2>&1)"; ONE_RC=$?
cell "psql -1:報 cannot run inside a transaction block" "$(printf '%s' "$ONE" | grep -c 'cannot run inside a transaction block')" "1"
cell "psql -1:非零離開" "$([ "$ONE_RC" != 0 ] && echo yes || echo no)" "yes"
cell "psql -1:庫不變(新索引 0 個)" "$(Q "select count(*) from pg_class where relname in ('ix_pf_brand_product','ix_pfe_brand_product')")" "0"
echo "── 正確貼法(psql 不加 -1, 非 superuser)──"
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
cell "兩個新索引都有效" "$(Q "select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('ix_pf_brand_product','ix_pfe_brand_product') and i.indisvalid and i.indisready")" "2"
cell "貼後:Ducati 不再掃 ix_pf_product / ux_pfe_row" "$(PLAN Ducati | grep -cE 'ix_pf_product|ux_pfe_row')" "0"
cell "貼後:Ducati 兩邊都走新索引" "$(PLAN Ducati | grep -cE 'ix_pf_brand_product|ix_pfe_brand_product')" "2"
echo "    貼後 anon 計畫:"; PLAN_ANON Ducati | sed 's/^/      /'
cell "貼後(anon):Ducati 兩邊都走新索引" "$(PLAN_ANON Ducati | grep -cE 'ix_pf_brand_product|ix_pfe_brand_product')" "2"
cell "貼後(anon):Ducati 不再掃 ix_pf_product / ix_pfe_product / ux_pfe_row" "$(PLAN_ANON Ducati | grep -cE 'ix_pf_product|ix_pfe_product|ux_pfe_row')" "0"
cell "貼後(anon):函式裡面 Ducati 用到新索引" "$([ "$(FNPLAN_ANON Ducati | grep -cE 'ix_pf_brand_product|ix_pfe_brand_product')" -ge 1 ] && echo yes || echo no)" "yes"
cell "貼後(anon):函式裡面 Ducati 不再用 ix_pf_product" "$(FNPLAN_ANON Ducati | grep -c 'ix_pf_product')" "0"
cell "貼後:函式裡面 Ducati 不再用 ix_pf_product" "$(FNPLAN Ducati | grep -c 'ix_pf_product')" "0"
cell "貼後:函式裡面 Ducati 用到新索引" "$([ "$(FNPLAN Ducati | grep -cE 'ix_pf_brand_product|ix_pfe_brand_product')" -ge 1 ] && echo yes || echo no)" "yes"
# 上面期望 0 的格子, 查詢報錯時也會是 0 ⇒ 另外確認這四種計畫都沒有報錯(Fable R1 nit)
cell "貼後四種計畫都沒有 ERROR(期望 0 的格子不是因為報錯才 0)" "$({ PLAN Ducati; PLAN_ANON Ducati; FNPLAN Ducati; FNPLAN_ANON Ducati; } 2>&1 | grep -c 'ERROR')" "0"
cell "Ducati 第 1 頁結果貼前貼後相同" "$([ "$(FNRES Ducati)" = "$RES_D_BEFORE" ] && echo same || echo diff)" "same"
cell "Kawasaki 第 1 頁結果貼前貼後相同" "$([ "$(FNRES Kawasaki)" = "$RES_K_BEFORE" ] && echo same || echo diff)" "same"
cell "比對有判別力:貼前 Ducati 第 1 頁 100 筆、沒有報錯" "$(printf '%s' "$RES_D_BEFORE" | tr ',' '\n' | grep -cE '^[0-9a-f-]{36}$')" "100"
cell "比對有判別力:貼前 Kawasaki 有結果、沒有報錯" "$([ -n "$RES_K_BEFORE" ] && [ "$RES_K_BEFORE" != "-" ] && ! printf '%s' "$RES_K_BEFORE" | grep -q ERR && echo ok || echo "bad:$RES_K_BEFORE")" "ok"
cell "已貼過再貼 ⇒ 前置閘②擋" "$(PN -f "$MIG" 2>&1 | grep -c '前置閘②')" "1"
echo "── 回滾 ──"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後新索引 0 個" "$(Q "select count(*) from pg_class where relname in ('ix_pf_brand_product','ix_pfe_brand_product')")" "0"
cell "回滾後 Ducati 回到 ix_pf_product(舊查法)" "$([ "$(PLAN Ducati | grep -c 'ix_pf_product')" -ge 1 ] && echo yes || echo no)" "yes"
cell "回滾檔再跑一次(都不在)也成功" "$(R="$(PN -f "$DOWN" 2>&1)" && echo ok || echo "fail:$R")" "ok"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(Q "select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('ix_pf_brand_product','ix_pfe_brand_product') and i.indisvalid")" "2"
echo "── 回滾檔不刪別人的同名索引 ──"
P -q -c "DROP INDEX public.ix_pfe_brand_product; CREATE INDEX ix_pfe_brand_product ON public.product_fitments_effective (moto_brand);" >/dev/null
cell "同名而定義不同 ⇒ 回滾前置閘②擋" "$(PN -f "$DOWN" 2>&1 | grep -c '前置閘②')" "1"
cell "被擋時兩個索引都還在(沒刪到一半)" "$(Q "select count(*) from pg_class where relname in ('ix_pf_brand_product','ix_pfe_brand_product')")" "2"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
