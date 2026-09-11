#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# `20260912010000_m4b_catalog_facet_counts.sql` 的行為驗證(拋棄式 PG)
#
# 要證的只有一句:**面板上的數字 = 點下去之後 search_catalog_by_vehicle 回的 total。**
#   新函式的述詞是【抄】的 ⇒ 用真的兩支函式(都從 migration 切出來, 不手抄)在同一份假資料上逐格比。
#
# 步驟:
#   ① 整支 migration 照貼(含它自己的 ACL 閘與行為閘)⇒ 建得起來、事後閘會過
#   ② 對照矩陣:車 6 種 × 已選品牌 4 種 × 已選分類 5 種, 每格比 8 個分類 key + 4 個品牌 key
#   ③ anon 叫得動;名單外的角色叫不動
#   ④ 突變 4 發:每一發把新函式弄壞一個地方 ⇒ 矩陣必須出現不一致(不紅 = 那道比對沒在守)
#
# 🛑 它答不出什麼:效能(14 筆資料)· RLS(替身表沒開)· 正式庫上的那兩支是不是 repo 這一版
#   (那一半由 migration 的行為閘③在正式資料上補)。
#
# 用法:bash scripts/20260912010000-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20260912010000_m4b_catalog_facet_counts.sql"
LIST="$REPO/supabase/migrations/20260909070000_m4b_search_exact_match_first_in_catalog_rpc.sql"

test -f "$MIG"  || { echo "ENV-FAIL:找不到 $MIG"; exit 3; }
test -f "$LIST" || { echo "ENV-FAIL:找不到 $LIST"; exit 3; }
command -v initdb >/dev/null 2>&1 || { echo "ENV-FAIL:本機沒有 initdb"; exit 3; }

TMP="$(mktemp -d)"
PGD="$TMP/pgdata"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
cleanup() { pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

echo "(跑的是 $(command -v psql) · port=$PORT)"
initdb -D "$PGD" -U postgres --encoding=UTF8 --locale=C >"$TMP/initdb.log" 2>&1 \
  || { echo "ENV-FAIL:initdb 失敗"; tail -5 "$TMP/initdb.log"; exit 3; }
pg_ctl -D "$PGD" -o "-p $PORT -k $TMP -c listen_addresses=" -l "$TMP/pg.log" -w start >/dev/null 2>&1 \
  || { echo "ENV-FAIL:PG 起不來"; tail -10 "$TMP/pg.log"; exit 3; }
PSQL="psql -h $TMP -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

# ── 最小世界 ────────────────────────────────────────────────────────────────
$PSQL >"$TMP/fixture.log" 2>&1 <<'SQL' || { echo "ENV-FAIL:fixture 建不起來"; tail -20 "$TMP/fixture.log"; exit 3; }
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE ROLE outsider NOLOGIN;

CREATE TABLE public.products_list_public (
  id uuid PRIMARY KEY, title text, subtitle text, handle text,
  brand_id uuid, category_id uuid, availability text, fitments jsonb,
  price_general integer, supplier_slug text, card_image text, fits text,
  brand_name text, brand_slug text, category_raw text, created_at timestamptz
);
CREATE TABLE public.products_public (id uuid PRIMARY KEY, external_id text);
CREATE TABLE public.product_image_trim (
  url text, status text, bbox_left numeric, bbox_top numeric,
  bbox_width numeric, bbox_height numeric, natural_width integer, natural_height integer
);
CREATE TABLE public.product_fitments (
  product_id uuid, moto_brand text, model_code text, year_start integer, year_end integer
);
-- 🔴 effective 是【另一張】, 不是 fitments 的 view —— 否則「只在 effective 裡的車」這一格測不到
CREATE TABLE public.product_fitments_effective (
  product_id uuid, moto_brand text, model_code text, year_start integer, year_end integer
);
-- 列表那支會叫它一次(沒關鍵字時回零列);替身 = 永遠零列
CREATE FUNCTION public.storefront_search_product_ids(text[])
  RETURNS TABLE(id uuid, is_exact boolean) LANGUAGE sql STABLE
  AS $f$ SELECT NULL::uuid, false WHERE false $f$;

-- 14 筆商品。每一筆為了某一格而在:
--   子類 rollup(外觀配件 · 後視鏡 / 牌架)· 只有子類沒有大類本身(操控部品 · 腳踏)
--   🔴 前綴但沒有分隔符的「外觀配件X」—— 不得被算進「外觀配件」
--   category_raw / brand_slug 為 NULL 的各一筆
INSERT INTO public.products_list_public (id, title, brand_slug, category_raw, price_general, created_at)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'P' || i, b, c, 1000 * i, now() - interval '10 days'
  FROM (VALUES
    (1,  'a', '外觀配件'),
    (2,  'a', '外觀配件 · 後視鏡'),
    (3,  'b', '外觀配件 · 後視鏡'),
    (4,  'b', '外觀配件 · 牌架'),
    (5,  'c', '排氣系統'),
    (6,  'a', '排氣系統'),
    (7,  'b', '煞車系統'),
    (8,  'c', '操控部品 · 腳踏'),
    (9,  'a', '外觀配件X'),
    (10, 'c', '外觀配件 · 牌架'),
    (11, 'b', NULL),
    (12, NULL, '排氣系統'),
    (13, 'a', '煞車系統'),
    (14, 'c', '外觀配件')
  ) AS v(i, b, c);
INSERT INTO public.products_public (id, external_id) SELECT id, title FROM public.products_list_public;

INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, mb, mc, ys, ye
  FROM (VALUES
    (1, 'Ducati', 'V4', 2018, 2026), (2, 'Ducati', 'V4', 2018, 2026), (5, 'Ducati', 'V4', 2018, 2026),
    (7, 'Ducati', 'V4', 2022, 2026), (9, 'Ducati', 'V4', 2018, 2026), (12, 'Ducati', 'V4', 2018, 2026),
    (3, 'Yamaha', 'MT09', NULL, 2020), (4, 'Yamaha', 'MT09', NULL, 2020), (13, 'Yamaha', 'MT09', 2015, NULL),
    (6, 'Kawasaki', 'ZX10', 2021, NULL), (10, 'Kawasaki', 'ZX10', 2021, NULL)
  ) AS v(i, mb, mc, ys, ye);
-- 只在 effective 裡:Ducati V2(P8 / P14)+ 與 fitments 重複的一列(P1, UNION 要去重)
INSERT INTO public.product_fitments_effective (product_id, moto_brand, model_code, year_start, year_end)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, mb, mc, ys, ye
  FROM (VALUES
    (8, 'Ducati', 'V2', NULL, NULL), (14, 'Ducati', 'V2', 2019, 2024), (1, 'Ducati', 'V4', 2018, 2026)
  ) AS v(i, mb, mc, ys, ye);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.products_list_public, public.products_public, public.product_image_trim,
                public.product_fitments, public.product_fitments_effective TO anon, authenticated, service_role;
SQL

# 列表那支:從真的 migration 切出來(不手抄)
python3 - "$LIST" "$TMP/list.sql" <<'PY'
import sys, io
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(')
j = src.index('$function$;', i) + len('$function$;')
io.open(sys.argv[2], 'w', encoding='utf-8').write(src[i:j] + '\n')
PY
$PSQL -f "$TMP/list.sql" >"$TMP/list.log" 2>&1 \
  || { echo "ENV-FAIL:search_catalog_by_vehicle 建不起來"; tail -20 "$TMP/list.log"; exit 3; }

fail=0

# ── ① 整支 migration 照貼 ────────────────────────────────────────────────────
if $PSQL -f "$MIG" >"$TMP/mig.log" 2>&1; then
  echo "  PASS ① migration 整支貼得上, 事後閘全過 —— $(grep -o '事後閘全過.*' "$TMP/mig.log" | head -1)"
else
  echo "  🔴 FAIL ① migration 貼不上"; tail -15 "$TMP/mig.log"; exit 1
fi

# ── ② 對照矩陣(一個 DO 區塊跑完, 印出比了幾格、幾格不一致)─────────────────────
cat >"$TMP/matrix.sql" <<'SQL'
\set ON_ERROR_STOP 1
DO $m$
DECLARE
  c_cat_keys text[] := ARRAY['外觀配件','外觀配件 · 後視鏡','外觀配件 · 牌架','排氣系統','煞車系統','操控部品','操控部品 · 腳踏','外觀配件X'];
  c_brand_keys text[] := ARRAY['a','b','c','zz'];
  veh record; sb record; sc record;
  k text; v_got bigint; v_want bigint;
  v_cells int := 0; v_bad int := 0; v_pos int := 0; v_zero int := 0;
BEGIN
  FOR veh IN SELECT * FROM (VALUES
      (NULL::text, NULL::text, NULL::int), ('Ducati', NULL, NULL), ('Ducati', 'V4', 2020),
      ('Ducati', 'V2', NULL), ('Yamaha', 'MT09', 2019), ('Kawasaki', 'ZX10', 2019)) AS t(b, m, y)
  LOOP
    FOR sb IN SELECT * FROM (VALUES (NULL::text[]), (ARRAY['a']), (ARRAY['a','b']), (ARRAY['zz'])) AS t(v) LOOP
      FOR sc IN SELECT * FROM (VALUES (NULL::text[]), (ARRAY['外觀配件']), (ARRAY['外觀配件 · 後視鏡']),
                                      (ARRAY['排氣系統', ' 煞車系統 ']), (ARRAY[''])) AS t(v) LOOP
        FOREACH k IN ARRAY c_cat_keys LOOP
          SELECT f.n INTO v_got FROM public.catalog_facet_counts(c_cat_keys, c_brand_keys, veh.b, veh.m, veh.y, sc.v, sb.v) f
           WHERE f.facet = 'category' AND f.key = k;
          SELECT coalesce(max(s.total), 0) INTO v_want FROM public.search_catalog_by_vehicle(
            ARRAY[k], veh.b, veh.m, veh.y, 0, 1, 'new', NULL, sb.v, NULL, NULL, NULL, NULL) s;
          v_cells := v_cells + 1;
          IF v_want > 0 THEN v_pos := v_pos + 1; ELSE v_zero := v_zero + 1; END IF;
          IF v_got IS DISTINCT FROM v_want THEN
            v_bad := v_bad + 1;
            IF v_bad <= 3 THEN RAISE NOTICE 'MISMATCH 分類 % 車 %/%/% 已選品牌 % ⇒ 面板 % 列表 %', k, veh.b, veh.m, veh.y, sb.v, v_got, v_want; END IF;
          END IF;
        END LOOP;
        FOREACH k IN ARRAY c_brand_keys LOOP
          SELECT f.n INTO v_got FROM public.catalog_facet_counts(c_cat_keys, c_brand_keys, veh.b, veh.m, veh.y, sc.v, sb.v) f
           WHERE f.facet = 'brand' AND f.key = k;
          SELECT coalesce(max(s.total), 0) INTO v_want FROM public.search_catalog_by_vehicle(
            sc.v, veh.b, veh.m, veh.y, 0, 1, 'new', NULL, ARRAY[k], NULL, NULL, NULL, NULL) s;
          v_cells := v_cells + 1;
          IF v_want > 0 THEN v_pos := v_pos + 1; ELSE v_zero := v_zero + 1; END IF;
          IF v_got IS DISTINCT FROM v_want THEN
            v_bad := v_bad + 1;
            IF v_bad <= 3 THEN RAISE NOTICE 'MISMATCH 品牌 % 車 %/%/% 已選分類 % ⇒ 面板 % 列表 %', k, veh.b, veh.m, veh.y, sc.v, v_got, v_want; END IF;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'RESULT cells=% bad=% pos=% zero=%', v_cells, v_bad, v_pos, v_zero;
END
$m$;
SQL

run_matrix() {  # 印 "cells bad pos zero"
  $PSQL -f "$TMP/matrix.sql" >"$TMP/matrix.log" 2>&1 || { echo "ERR"; return; }
  grep -o 'RESULT cells=[0-9]* bad=[0-9]* pos=[0-9]* zero=[0-9]*' "$TMP/matrix.log" \
    | sed 's/RESULT cells=\([0-9]*\) bad=\([0-9]*\) pos=\([0-9]*\) zero=\([0-9]*\)/\1 \2 \3 \4/'
}

read -r cells bad pos zero <<<"$(run_matrix)"
if [ "${cells:-}" = "1440" ] && [ "${bad:-x}" = "0" ] && [ "${pos:-0}" -gt 100 ] && [ "${zero:-0}" -gt 100 ]; then
  echo "  PASS ② 對照矩陣 $cells 格全等(列表 >0 的 $pos 格 · =0 的 $zero 格, 兩種都有才算有分母)"
else
  echo "  🔴 FAIL ② 對照矩陣 cells=${cells:-?} bad=${bad:-?} pos=${pos:-?} zero=${zero:-?}"; grep -E 'MISMATCH|ERROR' "$TMP/matrix.log" | head -5; fail=1
fi

# ── ③ 權限 ──────────────────────────────────────────────────────────────────
got="$($PSQL -tA -c "SET ROLE anon; SELECT count(*) FROM public.catalog_facet_counts(ARRAY['排氣系統'], ARRAY['a'])" 2>&1)"
[ "$got" = "2" ] && echo "  PASS ③a anon 叫得動(回 $got 列)" || { echo "  🔴 FAIL ③a anon 叫不動:$got"; fail=1; }
got="$($PSQL -tA -c "SELECT has_function_privilege('outsider', 'public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[])', 'EXECUTE')")"
[ "$got" = "f" ] && echo "  PASS ③b 名單外角色(靠 PUBLIC)叫不動" || { echo "  🔴 FAIL ③b 名單外角色拿得到 EXECUTE"; fail=1; }

# ── ④ 突變:每一發必須讓矩陣出現不一致 ────────────────────────────────────────
mutate() {  # mutate <名稱> <舊字面> <新字面>
python3 - "$MIG" "$TMP/mut.sql" "$2" "$3" <<'PY'
import sys, io
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE FUNCTION public.catalog_facet_counts(')
j = src.index('$function$;', i) + len('$function$;')
body = src[i:j]
old, new = sys.argv[3], sys.argv[4]
assert body.count(old) >= 1, '突變 anchor 命中 0 份 ⇒ 這一發沒有套用上去'
body = body.replace(old, new).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
io.open(sys.argv[2], 'w', encoding='utf-8').write(body + '\n')
PY
  [ $? -eq 0 ] || { echo "  🔴 FAIL ④ $1:突變套不上去"; fail=1; return; }
  $PSQL -f "$TMP/mut.sql" >"$TMP/mut.log" 2>&1 || { echo "  🔴 FAIL ④ $1:突變版建不起來"; tail -5 "$TMP/mut.log"; fail=1; return; }
  read -r mc mb _ _ <<<"$(run_matrix)"
  if [ "${mb:-0}" -gt 0 ] 2>/dev/null; then echo "  PASS ④ 突變「$1」⇒ 矩陣 $mb / $mc 格不一致(比對有在守)"
  else echo "  🔴 FAIL ④ 突變「$1」⇒ 矩陣仍全等(bad=${mb:-?})⇒ 這道比對沒在守"; fail=1; fi
}
mutate "拿掉子類 rollup" " OR g.category_raw LIKE ck.kt || ' · %')" ")"
mutate "分隔符寫丟" "ck.kt || ' · %'" "ck.kt || '%'"
mutate "拿掉 effective 那半" "FROM public.product_fitments_effective" "FROM public.product_fitments"
mutate "分類面板不疊已選品牌" "OR g.brand_slug = ANY(p_selected_brand_slugs))" "OR true)"

# 收尾:換回正版, 再跑一次矩陣(突變沒有殘留)
python3 - "$MIG" "$TMP/restore.sql" <<'PY'
import sys, io
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE FUNCTION public.catalog_facet_counts(')
j = src.index('$function$;', i) + len('$function$;')
io.open(sys.argv[2], 'w', encoding='utf-8').write(src[i:j].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1) + '\n')
PY
$PSQL -f "$TMP/restore.sql" >/dev/null 2>&1
read -r cells bad _ _ <<<"$(run_matrix)"
[ "${bad:-x}" = "0" ] && echo "  PASS ⑤ 換回正版後矩陣 $cells 格再度全等" || { echo "  🔴 FAIL ⑤ 換回正版後仍不一致 bad=${bad:-?}"; fail=1; }

[ "$fail" = "0" ] && { echo "✅ 全過"; exit 0; } || { echo "🔴 有 FAIL"; exit 1; }
