#!/usr/bin/env bash
# `20261002130000_m4b_admin_search_orders_multi_term.sql`(S2 訂單搜尋拆詞)的行為驗證
# 要證的(Sean 2026-10-02 Q1 甲):拆詞每個詞都要對到;全形轉半形;一個詞的查詢結果與第 3 代逐筆相同;上限與 truncated 照舊;回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。先紅:套本支之前跑同一批格子。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002130000_m4b_admin_search_orders_multi_term.sql"
DOWN="$REPO/supabase/rollbacks/20261002130000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vS2-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002130000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:admin_search_orders = 正式庫第 3 代" "$(Q "select md5(prosrc) from pg_proc where proname='admin_search_orders'")" "c3cdaf1bf1294ae283362dbdaa7cf78e"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL'
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_s2', '測試員', true);
CREATE TABLE public.zz_o (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE c uuid; o uuid; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('a', '王小明', '0912345678', '台北市中山區南京東路 100 號', 'AKR-S-Y6R5', 'Slip-On 鈦合金排氣管'),
      ('b', '王大明', '0922000111', '台中市西屯區福星路 427 號',   'RPM-001',    '碳纖維車台護蓋'),
      ('c', '林小明', '0933000222', '高雄市左營區博愛二路 1 號',   'BRK-77',     '煞車拉桿')) v(k, nm, ph, ln, sku, title) LOOP
    c := gen_random_uuid();
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (c, c::text || '@s2.test', '{}'::jsonb);
    INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (c, c::text || '@s2.test', r.nm, r.ph, 'general');
    o := (public.admin_create_manual_order(p_customer_user_id => c, p_manual_request_id => gen_random_uuid(), p_actor => 'probe_s2',
          p_order_source => 'manual_phone', p_payment_channel => 'cash', p_shipping_method => 'home',
          p_ship_to => jsonb_build_object('name', r.nm, 'phone', r.ph, 'line', r.ln),
          p_invoice => '{"type":"personal","requested":false}'::jsonb, p_shipping_fee => 0,
          p_lines => jsonb_build_array(jsonb_build_object('sku', r.sku, 'title', r.title, 'qty', 1, 'unit_price', 1000, 'spec', '{}'::jsonb))) ->> 'order_id')::uuid;
    INSERT INTO public.zz_o VALUES (r.k, o);
  END LOOP;
END $s$;
CREATE FUNCTION public.zz_s(q text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(z.k, ',' ORDER BY z.k), '-') FROM public.zz_o z
   WHERE z.id::text IN (SELECT jsonb_array_elements_text(public.admin_search_orders(q) -> 'ids'));
$f$;
CREATE TABLE public.zz_before (q text PRIMARY KEY, res jsonb);
SQL
S() { Q "select public.zz_s('$1')"; }
SINGLE=("王" "小明" "0912" "AKRS" "中山區" "碳纖維" "PCM" "rpm001")
for q in "${SINGLE[@]}"; do Q "insert into public.zz_before values ('$q', public.admin_search_orders('$q'))" >/dev/null; done
run_cells() {
  cell "「王 小明」⇒ 只有王小明(兩個詞都要對到)" "$(S '王 小明')" "a"
  cell "「明 台中」⇒ 王大明(姓名 + 地址跨維)" "$(S '明 台中')" "b"
  cell "「王 煞車」⇒ 沒有(沒有一張單兩個詞都對到)" "$(S '王 煞車')" "-"
  cell "全形電話「０９１２」⇒ 王小明" "$(S '０９１２')" "a"
  cell "全形料號「ＡＫＲ－Ｓ」⇒ 王小明" "$(S 'ＡＫＲ－Ｓ')" "a"
  cell "「排氣管 R6」⇒ 品名 + 料號跨維" "$(S '排氣管 r6')" "a"
}
echo "── 貼前(先紅)──"
OB="$(run_cells 2>/dev/null)"; printf '%s\n' "$OB" | sed 's/^/  [貼前] /'
RED="$(printf '%s\n' "$OB" | grep -c FAIL)"
# 「排氣管 r6」第 3 代的模糊比對(word_similarity)本來就對得到, 所以貼前紅的是拆詞兩格加全形兩格。
cell "貼前紅的正好是:王 小明 / 明 台中 / 全形電話 / 全形料號" "$(printf '%s\n' "$OB" | grep FAIL | grep -c '王 小明\|明 台中\|全形電話\|全形料號')/$RED" "4/4"
P -f "$MIG" >/dev/null || { echo "🔴 migration 套不上"; exit 1; }
echo "── 貼後 ──"
run_cells
for q in "${SINGLE[@]}"; do cell "一個詞「$q」結果與第 3 代逐筆相同" "$(Q "select (res = public.admin_search_orders('$q'))::text from public.zz_before where q = '$q'")" "true"; done
cell "空白 / 超過 120 字 ⇒ 空" "$(Q "select (public.admin_search_orders('   ') ->> 'ids') || (public.admin_search_orders(repeat('a', 121)) ->> 'ids')")" "[][]"
cell "權限:內部函式 service_role 不可、主函式可" "$(Q "select has_function_privilege('service_role','public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)','EXECUTE')::text || has_function_privilege('service_role','public.admin_search_orders(text,integer,timestamptz,timestamptz)','EXECUTE')::text")" "falsetrue"
cell "已貼過再貼 ⇒ 前置閘擋" "$(P -f "$MIG" 2>&1 | grep -c 'S2 前置閘')" "1"
P -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗"; FAIL=1; }
cell "回滾後 = 第 3 代、內部函式不在" "$(Q "select md5(prosrc) from pg_proc where proname='admin_search_orders'")|$(Q "select count(*) from pg_proc where proname='pcm_admin_search_order_term_hits'")" "c3cdaf1bf1294ae283362dbdaa7cf78e|0"
P -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(S '王 小明')" "a"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
