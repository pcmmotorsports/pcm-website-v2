#!/usr/bin/env bash
# `20261002160000_m4b_admin_products_by_keyword_multi_term.sql`(S5 商品管理搜尋)的行為驗證
# 要證的(Sean 2026-10-02 Q1 甲):拆詞每個詞都要對到;料號去符號;全形轉半形;一般單詞查詢與上一版相同(* 照舊是萬用字元);回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼(265 的教訓)。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002160000_m4b_admin_products_by_keyword_multi_term.sql"
DOWN="$REPO/supabase/rollbacks/20261002160000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vS5-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002160000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:admin_products_by_keyword = 正式庫 c1ffafa6" "$(Q "select md5(prosrc) from pg_proc where proname='admin_products_by_keyword'")" "c1ffafa6189dd0e675be1b1300d18097"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
CREATE TABLE public.zz_p (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE b uuid; c uuid; p uuid; r record;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('ZZ Brand', 'zz-brand') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  FOR r IN SELECT * FROM (VALUES
      ('a', 'Slip-On 鈦合金排氣管',   'PED-GP EVO AC', 'fit', 'Ducati', 'Panigale V4'),
      ('b', 'Arrow 排氣管 碳纖維尾蓋', 'ARW-71',        'eff', 'Ducati', 'Monster 937'),
      ('c', '煞車拉桿',               'BRK_77',        'fit', 'Honda',  'CBR1000RR'),
      ('d', '碳纖維腳踏翅膀（左）',   'WING-L',        'fit', 'Yamaha', 'YZF-R1')) v(k, title, ext, src, mb, mc) LOOP
    INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier)
      VALUES ('zz-' || r.k, r.title, r.ext, b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb) RETURNING id INTO p;
    IF r.src = 'fit' THEN
      INSERT INTO public.product_fitments (product_id, moto_brand, model_code) VALUES (p, r.mb, r.mc);
    ELSE
      INSERT INTO public.product_fitments_effective (product_id, moto_brand, model_code, match_source, source_model_code)
        VALUES (p, r.mb, r.mc, 'direct', r.mc);
    END IF;
    INSERT INTO public.zz_p VALUES (r.k, p);
  END LOOP;
END $s$;
CREATE FUNCTION public.zz_s(q text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(z.k, ',' ORDER BY z.k), '-')
    FROM public.admin_products_by_keyword(q) x JOIN public.zz_p z ON z.id = x.id;
$f$;
CREATE TABLE public.zz_before (q text PRIMARY KEY, res text);
SQL
S() { Q "select public.zz_s('$1')"; }
SINGLE=("a" "排氣管" "ducati" "panigale" "monster 937" "brk_77" "BRK\\_77" "*" "arw*71" "slip-on" "ped-gp" "%" "_" "（左）" "翅膀（左）")
for q in "${SINGLE[@]}"; do Q "insert into public.zz_before values ('$q', public.zz_s('$q'))" >/dev/null; done
cell "對照組:單詞「排氣管」貼前就有兩件(資料真的在)" "$(S '排氣管')" "a,b"
run_cells() {
  cell "「PEDGPEVO」⇒ 料號去符號對到 PED-GP EVO AC" "$(S 'PEDGPEVO')" "a"
  cell "「ducati 排氣管」⇒ 車款 + 名稱, 兩件" "$(S 'ducati 排氣管')" "a,b"
  cell "「ducati arrow」⇒ 名稱 Arrow + 車款 Ducati" "$(S 'ducati arrow')" "b"
  cell "「排氣管 panigale」⇒ 只有 Panigale 那件" "$(S '排氣管 panigale')" "a"
  cell "全形「ＢＲＫ」⇒ 煞車拉桿" "$(S 'ＢＲＫ')" "c"
  cell "從名稱複製「翅膀（左）」⇒ 照舊找得到(名稱有全形括號)" "$(S '翅膀（左）')" "d"
  cell "半形「翅膀(左)」⇒ 也找得到全形括號的名稱" "$(S '翅膀(左)')" "d"
  cell "「ducati 煞車」⇒ 沒有" "$(S 'ducati 煞車')" "-"
}
echo "── 貼前(先紅)──"
OB="$(run_cells 2>/dev/null)"; printf '%s\n' "$OB" | sed 's/^/  [貼前] /'
cell "貼前紅的正好是:PEDGPEVO / ducati 排氣管 / ducati arrow / 排氣管 panigale / 全形 / 半形括號" "$(printf '%s\n' "$OB" | grep FAIL | grep -c 'PEDGPEVO\|ducati 排氣管\|ducati arrow\|排氣管 panigale\|全形「ＢＲＫ\|半形「翅膀')/$(printf '%s\n' "$OB" | grep -c FAIL)" "6/6"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
run_cells
# 料號去符號是新增的比對 ⇒ 帶符號的單詞可能多找到(例如「BRK\\_77」現在對得到 BRK_77), 不會少。
LOST="$(Q "select coalesce(string_agg(q || '=' || res || '→' || public.zz_s(q), ' '), '') from public.zz_before where res <> '-' and not (string_to_array(res, ',') <@ string_to_array(public.zz_s(q), ','))")"
cell "單詞 15 種(含 * 萬用字元、\\ % _ 字面、全形括號):上一版找得到的, 現在都找得到" "$LOST" ""
SAME_Q="q IN ('a', '排氣管', 'ducati', 'panigale', 'monster 937', '*', 'arw*71')"
cell "逐筆相同那格真的比到 7 種(不是比了 0 種而假綠)" "$(Q "select count(*) from public.zz_before where $SAME_Q")" "7"
SAME="$(Q "select coalesce(string_agg(q || '=' || res || '→' || public.zz_s(q), ' '), '') from public.zz_before where $SAME_Q and res <> public.zz_s(q)")"
cell "a / 排氣管 / ducati / panigale / monster 937 / * / arw*71 結果完全相同" "$SAME" ""
cell "空白 ⇒ 沒有" "$(S '   ')" "-"
cell "權限:anon / authenticated 不可、service_role 可, 仍是 SECURITY INVOKER" "$(Q "select has_function_privilege('anon','public.admin_products_by_keyword(text)','EXECUTE')::text || has_function_privilege('authenticated','public.admin_products_by_keyword(text)','EXECUTE')::text || has_function_privilege('service_role','public.admin_products_by_keyword(text)','EXECUTE')::text || (select prosecdef::text from pg_proc where proname='admin_products_by_keyword')")" "falsefalsetruefalse"
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c 'S5 前置閘')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後 = 上一版 c1ffafa6" "$(Q "select md5(prosrc) from pg_proc where proname='admin_products_by_keyword'")" "c1ffafa6189dd0e675be1b1300d18097"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(S 'ducati arrow')" "b"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
