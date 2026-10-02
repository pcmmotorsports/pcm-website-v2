#!/usr/bin/env bash
# `20261002150000_m4b_admin_search_customers_multi_term.sql`(S4 客戶搜尋拆詞)的行為驗證
# 要證的(Sean 2026-10-02 Q1 甲):拆詞每個詞都要對到;全形轉半形;一般單詞查詢結果與上一版逐筆相同;狀態篩選、上限、truncated 照舊;回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼(265 的教訓)。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002150000_m4b_admin_search_customers_multi_term.sql"
DOWN="$REPO/supabase/rollbacks/20261002150000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vS4-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002150000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:admin_search_customers = 正式庫 e69e31ce" "$(Q "select md5(prosrc) from pg_proc where proname='admin_search_customers'")" "e69e31cee080a7f12e422ac0b6877c6a"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上"; exit 3; }
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
CREATE TABLE public.zz_c (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE c uuid; r record; i int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('a', '王小明', 'ming@example.com',  '0912-345-678', false),
      ('b', '王大明', 'daming@example.com','0922000111',   false),
      ('c', '林小明', 'lin_ming@shop.tw',  '0933000222',   false),
      ('d', '王小華', 'hua@example.com',   '0912999888',   true)) v(k, nm, em, ph, gone) LOOP
    i := i + 1;
    c := gen_random_uuid();
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (c, r.em, '{}'::jsonb);
    INSERT INTO public.customers (user_id, email, name, phone, tier, created_at, disabled_at)
      VALUES (c, r.em, r.nm, r.ph, 'general', now() - pg_catalog.make_interval(mins => i), CASE WHEN r.gone THEN now() END);
    INSERT INTO public.zz_c VALUES (r.k, c);
  END LOOP;
END $s$;
CREATE FUNCTION public.zz_s(q text, st text DEFAULT 'active', lim int DEFAULT 100) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(z.k, ',' ORDER BY x.ord), '-')
    FROM jsonb_array_elements_text(public.admin_search_customers(q, lim, st) -> 'ids') WITH ORDINALITY x(id, ord)
    JOIN public.zz_c z ON z.id::text = x.id;
$f$;
CREATE TABLE public.zz_before (q text, st text, res jsonb, PRIMARY KEY (q, st));
SQL
S() { Q "select public.zz_s('$1', '${2:-active}')"; }
SINGLE=("王" "小明" "0912" "0912-345" "example" "lin_ming" "_" "%" "ming@" "王小華" "-")
for q in "${SINGLE[@]}"; do for st in active disabled all bogus; do
  Q "insert into public.zz_before values ('$q', '$st', public.admin_search_customers('$q', 100, '$st'))" >/dev/null
done; done
run_cells() {
  cell "「王 小明」⇒ 只有王小明(兩個詞都要對到)" "$(S '王 小明')" "a"
  cell "「小明 0912」⇒ 王小明(姓名 + 電話跨軸)" "$(S '小明 0912')" "a"
  cell "「林 0912」⇒ 沒有(上一版只看電話數字就列出王小明)" "$(S '林 0912')" "-"
  cell "「0912 - 345」⇒ 王小明(中間的 - 不算一個詞)" "$(S '0912 - 345')" "a"
  cell "「王 example」⇒ 王小明、王大明(姓名 + Email)" "$(S '王 example')" "a,b"
  cell "「王 煞車」⇒ 沒有" "$(S '王 煞車')" "-"
  cell "全形電話「０９２２」⇒ 王大明" "$(S '０９２２')" "b"
  cell "「王 小華」⇒ 已停用的那位只在 all 出現" "$(S '王 小華')|$(S '王 小華' all)" "-|d"
}
echo "── 貼前(先紅)──"
OB="$(run_cells 2>/dev/null)"; printf '%s\n' "$OB" | sed 's/^/  [貼前] /'
# 「小明 0912」「0912 - 345」上一版靠整串抽數字比電話本來就對得到, 不算改善。
cell "貼前紅的正好是:王 小明 / 林 0912 / 王 example / 全形電話 / 王 小華" "$(printf '%s\n' "$OB" | grep FAIL | grep -c '王 小明\|林 0912\|王 example\|全形電話\|王 小華')/$(printf '%s\n' "$OB" | grep -c FAIL)" "5/5"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
run_cells
DIFF="$(Q "select coalesce(string_agg(q || '/' || st, ' '), '') from public.zz_before where res <> public.admin_search_customers(q, 100, st)")"
cell "單詞 11 種 × 4 種狀態, 結果與上一版逐筆相同" "$DIFF" ""
cell "上限 1 ⇒ 只回 1 筆、truncated = true" "$(Q "select jsonb_array_length(r -> 'ids') || '/' || (r ->> 'truncated') from (select public.admin_search_customers('王 明', 1, 'all') r) x")" "1/true"
cell "上限 1 ⇒ 回的是最新那位(王小明)" "$(Q "select public.zz_s('王 明', 'all', 1)")" "a"
cell "空白 / 超過 120 字 ⇒ 空" "$(Q "select (public.admin_search_customers('   ') ->> 'ids') || (public.admin_search_customers(repeat('a', 121)) ->> 'ids')")" "[][]"
cell "權限:anon / authenticated 不可、service_role 可" "$(Q "select has_function_privilege('anon','public.admin_search_customers(text,integer,text)','EXECUTE')::text || has_function_privilege('authenticated','public.admin_search_customers(text,integer,text)','EXECUTE')::text || has_function_privilege('service_role','public.admin_search_customers(text,integer,text)','EXECUTE')::text")" "falsefalsetrue"
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c 'S4 前置閘')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後 = 上一版 e69e31ce" "$(Q "select md5(prosrc) from pg_proc where proname='admin_search_customers'")" "e69e31cee080a7f12e422ac0b6877c6a"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(S '王 小明')" "a"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
