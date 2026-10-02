#!/usr/bin/env bash
# `20261002170000_m4b_search_nfkc_both_sides.sql`(訂單搜尋、客戶搜尋:文字欄原字串與轉半形各比一次)的行為驗證
# 要證的:從商品名稱複製的「翅膀（左）」、半形「翅膀(左)」都找得到訂單;全形英文姓名的客人找得到;其他查詢只多不少;回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration(含 265、267)。用非 superuser 角色貼。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002170000_m4b_search_nfkc_both_sides.sql"
DOWN="$REPO/supabase/rollbacks/20261002170000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vNF-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002170000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:訂單搜尋內部函式 = 正式庫 71158872" "$(Q "select md5(prosrc) from pg_proc where proname='pcm_admin_search_order_term_hits'")" "711588725c4add65224a241ae063e664"
cell "前置:客戶搜尋 = 正式庫 19102ce2" "$(Q "select md5(prosrc) from pg_proc where proname='admin_search_customers'")" "19102ce213bd16759900003c72072c2f"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_nf', '測試員', true);
CREATE TABLE public.zz_o (k text PRIMARY KEY, id uuid);
CREATE TABLE public.zz_c (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE c uuid; o uuid; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('a', '王小明',   'ming@example.com',  '0912345678', '台北市中山區（測試）路 1 號', 'WING-L', '碳纖維腳踏翅膀（左）'),
      ('b', 'Ｊｏｈｎ 陳', 'ｊｏｈｎ@example.com', '0922000111', '台中市西屯區福星路 427 號',   'RPM-001', '碳纖維車台護蓋')) v(k, nm, em, ph, ln, sku, title) LOOP
    c := gen_random_uuid();
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (c, c::text || '@nf.test', '{}'::jsonb);
    INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (c, r.em, r.nm, r.ph, 'general');
    INSERT INTO public.zz_c VALUES (r.k, c);
    o := (public.admin_create_manual_order(p_customer_user_id => c, p_manual_request_id => gen_random_uuid(), p_actor => 'probe_nf',
          p_order_source => 'manual_phone', p_payment_channel => 'cash', p_shipping_method => 'home',
          p_ship_to => jsonb_build_object('name', r.nm, 'phone', r.ph, 'line', r.ln),
          p_invoice => '{"type":"personal","requested":false}'::jsonb, p_shipping_fee => 0,
          p_lines => jsonb_build_array(jsonb_build_object('sku', r.sku, 'title', r.title, 'qty', 1, 'unit_price', 1000, 'spec', '{}'::jsonb))) ->> 'order_id')::uuid;
    INSERT INTO public.zz_o VALUES (r.k, o);
  END LOOP;
END $s$;
CREATE FUNCTION public.zz_so(q text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(z.k, ',' ORDER BY z.k), '-') FROM public.zz_o z
   WHERE z.id::text IN (SELECT jsonb_array_elements_text(public.admin_search_orders(q) -> 'ids'));
$f$;
CREATE FUNCTION public.zz_sc(q text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(z.k, ',' ORDER BY z.k), '-') FROM public.zz_c z
   WHERE z.id::text IN (SELECT jsonb_array_elements_text(public.admin_search_customers(q, 100, 'all') -> 'ids'));
$f$;
CREATE TABLE public.zz_before (kind text, q text, res text, PRIMARY KEY (kind, q));
SQL
SO() { Q "select public.zz_so('$1')"; }
SC() { Q "select public.zz_sc('$1')"; }
OQ=("王" "小明" "0912" "WING" "碳纖維" "翅膀" "中山區" "台中" "王 翅膀" "pcm")
CQ=("王" "ming" "example" "0922" "陳" "王 0912")
for q in "${OQ[@]}"; do Q "insert into public.zz_before values ('o', '$q', public.zz_so('$q'))" >/dev/null; done
for q in "${CQ[@]}"; do Q "insert into public.zz_before values ('c', '$q', public.zz_sc('$q'))" >/dev/null; done
cell "對照組:「翅膀」貼前就找得到那張訂單(資料真的在)" "$(SO '翅膀')" "a"
run_cells() {
  cell "訂單:從名稱複製「翅膀（左）」⇒ 找得到" "$(SO '翅膀（左）')" "a"
  cell "訂單:半形「翅膀(左)」⇒ 找得到全形括號的品名" "$(SO '翅膀(左)')" "a"
  cell "訂單:地址「（測試）路」⇒ 找得到" "$(SO '（測試）路')" "a"
  cell "客戶:全形英文姓名, 打「john」⇒ 找得到" "$(SC 'john')" "b"
  cell "客戶:全形 Email, 打「john@」⇒ 找得到" "$(SC 'john@')" "b"
}
echo "── 貼前(先紅)──"
OB="$(run_cells 2>/dev/null)"; printf '%s\n' "$OB" | sed 's/^/  [貼前] /'
cell "貼前五格都是紅的" "$(printf '%s\n' "$OB" | grep -c FAIL)" "5"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
run_cells
LOST="$(Q "select coalesce(string_agg(kind || ':' || q || '=' || res || '→' || CASE kind WHEN 'o' THEN public.zz_so(q) ELSE public.zz_sc(q) END, ' '), '') from public.zz_before where res <> '-' and not (string_to_array(res, ',') <@ string_to_array(CASE kind WHEN 'o' THEN public.zz_so(q) ELSE public.zz_sc(q) END, ','))")"
cell "其他 16 種查詢:貼前找得到的, 貼後都找得到" "$LOST" ""
cell "比對到的查詢真的有 16 種(不是 0 種而假綠)" "$(Q "select count(*) from public.zz_before")" "16"
cell "模糊門檻 0.4 還在、權限照舊" "$(Q "select (proconfig @> array['pg_trgm.word_similarity_threshold=0.4'])::text from pg_proc where proname='pcm_admin_search_order_term_hits'")|$(Q "select has_function_privilege('service_role','public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)','EXECUTE')::text || has_function_privilege('service_role','public.admin_search_customers(text,integer,text)','EXECUTE')::text || has_function_privilege('anon','public.admin_search_customers(text,integer,text)','EXECUTE')::text")" "true|falsetruefalse"
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c '全形前置閘')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後兩支都回到貼前本體" "$(Q "select md5(prosrc) from pg_proc where proname='pcm_admin_search_order_term_hits'")|$(Q "select md5(prosrc) from pg_proc where proname='admin_search_customers'")" "711588725c4add65224a241ae063e664|19102ce213bd16759900003c72072c2f"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(SO '翅膀(左)')|$(SC 'john')" "a|b"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
