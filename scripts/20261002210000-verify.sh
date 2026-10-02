#!/usr/bin/env bash
# `20261002210000_m4b_admin_set_manual_product_images.sql`(手動商品照片寫回網站)的行為驗證
# 要證的:①只有 service_role 叫得動 ②pcm 商品寫得進去、同值 NO_CHANGE、稽核同交易寫一筆 ③非 pcm 商品、停用員工、格式不對都被擋
#        ④已貼再貼被前置閘擋 ⑤回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002210000_m4b_admin_set_manual_product_images.sql"
DOWN="$REPO/supabase/rollbacks/20261002210000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vMI-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
# 以 service_role 身分呼叫(後台 server action 的身分);回傳值或錯誤訊息的第一行
SR() { P -tA -c "SET ROLE service_role; $1" 2>&1 | sed -n '1{s/^ERROR: *//;p;}'; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-60s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-57s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002210000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "前置:函式還不存在" "$(Q "select coalesce(to_regprocedure('public.admin_set_manual_product_images(uuid, jsonb, text, text)')::text, 'none')")" "none"
P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試資料建不起來"; exit 3; }
INSERT INTO public.staff (id, label, is_active) VALUES ('zz_staff', '測試員工', true), ('zz_gone', '已離職', false);
CREATE TABLE public.zz_p (k text PRIMARY KEY, id uuid);
DO $s$
DECLARE b uuid; c uuid; p uuid;
BEGIN
  INSERT INTO public.brands (name, slug) VALUES ('PCM', 'zz-pcm') RETURNING id INTO b;
  INSERT INTO public.categories (name, raw_path, segments) VALUES ('排氣', '排氣', '["排氣"]'::jsonb) RETURNING id INTO c;
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, supplier_slug)
    VALUES ('zz-manual', '手動商品', 'TEST-01', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, 'pcm') RETURNING id INTO p;
  INSERT INTO public.zz_p VALUES ('pcm', p);
  INSERT INTO public.products (handle, title, external_id, brand_id, category_id, price_by_tier, supplier_slug, images)
    VALUES ('zz-synced', '同步商品', 'RPM-1', b, c, '{"general":1000,"store":null,"premiumStore":null}'::jsonb, 'rpm', '["https://cdn.example.com/rpm.jpg"]'::jsonb) RETURNING id INTO p;
  INSERT INTO public.zz_p VALUES ('rpm', p);
END $s$;
SQL
PCM="$(Q "select id from public.zz_p where k = 'pcm'")"; RPM="$(Q "select id from public.zz_p where k = 'rpm'")"
CALL() { printf "select public.admin_set_manual_product_images('%s', '%s'::jsonb, '%s', 'req-1')" "$1" "$2" "${3:-zz_staff}"; }
TWO='["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"]'
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 貼後 ──"
cell "權限:anon / authenticated 叫不動, service_role 叫得動" "$(Q "select has_function_privilege('anon', 'public.admin_set_manual_product_images(uuid, jsonb, text, text)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'public.admin_set_manual_product_images(uuid, jsonb, text, text)', 'EXECUTE')::text || '|' || has_function_privilege('service_role', 'public.admin_set_manual_product_images(uuid, jsonb, text, text)', 'EXECUTE')::text")" "false|false|true"
cell "權限:PUBLIC 沒有 EXECUTE(ACL 為空時看 acldefault)" "$(Q "select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = 'public.admin_set_manual_product_images(uuid, jsonb, text, text)'::regprocedure and x.grantee = 0")" "0"
cell "anon 身分直接呼叫 ⇒ 沒有權限" "$(P -tA -c "SET ROLE anon; $(CALL "$PCM" "$TWO")" 2>&1 | grep -c 'permission denied')" "1"
cell "pcm 商品寫兩張 ⇒ UPDATED" "$(SR "$(CALL "$PCM" "$TWO")")" "UPDATED"
cell "寫進 products.images, 順序照給的" "$(Q "select images::text from public.products where id = '$PCM'")" '["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"]'
cell "稽核同交易寫一筆(product.images.sync, 操作人 zz_staff)" "$(Q "select count(*) || '|' || max(actor) || '|' || max(after::text) from public.admin_audit_log where action = 'product.images.sync' and target = 'product:$PCM'")" '1|zz_staff|{"images": ["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"]}'
cell "同樣內容再寫 ⇒ NO_CHANGE, 稽核仍是 1 筆" "$(SR "$(CALL "$PCM" "$TWO")")|$(Q "select count(*) from public.admin_audit_log where action = 'product.images.sync'")" "NO_CHANGE|1"
cell "換順序 ⇒ UPDATED" "$(SR "$(CALL "$PCM" '["https://img.example.com/b.jpg", "https://img.example.com/a.jpg"]')")" "UPDATED"
cell "全刪(空陣列)⇒ UPDATED, images 變 []" "$(SR "$(CALL "$PCM" '[]')")|$(Q "select images::text from public.products where id = '$PCM'")" "UPDATED|[]"
cell "同步商品(rpm)⇒ 擋下, 照片不動" "$(SR "$(CALL "$RPM" "$TWO")" | grep -c '只有後台新增的商品')|$(Q "select images::text from public.products where id = '$RPM'")" '1|["https://cdn.example.com/rpm.jpg"]'
cell "停用員工 ⇒ 無權執行此操作" "$(SR "$(CALL "$PCM" "$TWO" zz_gone)")" "無權執行此操作"
cell "不存在的員工 ⇒ 無權執行此操作" "$(SR "$(CALL "$PCM" "$TWO" zz_nobody)")" "無權執行此操作"
cell "不存在的商品 ⇒ NOT_FOUND" "$(SR "$(CALL "00000000-0000-0000-0000-000000000000" "$TWO")")" "NOT_FOUND"
cell "http 網址 ⇒ 擋下" "$(SR "$(CALL "$PCM" '["http://img.example.com/a.jpg"]')" | grep -c 'https')" "1"
cell "網址含空白 ⇒ 擋下" "$(SR "$(CALL "$PCM" '["https://img.example.com/a b.jpg"]')" | grep -c 'https')" "1"
cell "網址重複 ⇒ 擋下" "$(SR "$(CALL "$PCM" '["https://img.example.com/a.jpg", "https://img.example.com/a.jpg"]')" | grep -c '重複')" "1"
cell "不是陣列 ⇒ 擋下" "$(SR "$(CALL "$PCM" '"https://img.example.com/a.jpg"')" | grep -c '陣列')" "1"
cell "陣列裡有數字 ⇒ 擋下" "$(SR "$(CALL "$PCM" '[1]')" | grep -c '網址文字')" "1"
FIFTY_ONE="$(Q "select jsonb_agg('https://img.example.com/' || g || '.jpg')::text from generate_series(1, 51) g")"
FIFTY="$(Q "select jsonb_agg('https://img.example.com/' || g || '.jpg')::text from generate_series(1, 50) g")"
cell "51 張 ⇒ 擋下;50 張 ⇒ UPDATED" "$(SR "$(CALL "$PCM" "$FIFTY_ONE")" | grep -c '50 張')|$(SR "$(CALL "$PCM" "$FIFTY")")" "1|UPDATED"
cell "被擋的那幾次都沒有寫稽核(只有 4 次 UPDATED)" "$(Q "select count(*) from public.admin_audit_log where action = 'product.images.sync'")" "4"
cell "已貼過再貼 ⇒ 前置閘擋下" "$(PN -f "$MIG" 2>&1 | grep -c '已經存在')" "1"
echo "── 回滾 ──"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾用非 superuser 貼不上"; FAIL=1; }
cell "回滾後函式不在" "$(Q "select coalesce(to_regprocedure('public.admin_set_manual_product_images(uuid, jsonb, text, text)')::text, 'none')")" "none"
cell "回滾後再貼一次成功" "$(PN -f "$MIG" >/dev/null 2>&1 && Q "select has_function_privilege('service_role', 'public.admin_set_manual_product_images(uuid, jsonb, text, text)', 'EXECUTE')::text")" "true"
echo "共 $N 格"
[ "$FAIL" = 0 ] && echo "✅ 全部通過" || { echo "🔴 有格子沒過"; exit 1; }
