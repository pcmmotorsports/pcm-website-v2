#!/usr/bin/env bash
# `20261002200000_m4b_email_copy_versions.sql`(信件文字第 2 片 2a)的行為驗證
# 要證的:只新增不修改不刪除;只有 service_role 能讀寫;存檔同交易寫操作紀錄;格式擋得住;重貼被擋;回滾來回。
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。用非 superuser 角色貼(265 的教訓)。
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002200000_m4b_email_copy_versions.sql"
DOWN="$REPO/supabase/rollbacks/20261002200000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
WIN="vEC-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"; D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
PN() { psql -h 127.0.0.1 -p "$PORT" -U zz_paster -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
# 以某個角色跑一句, 回 ok 或 denied(其他錯誤原樣印出)
AS() { local r; r="$(P -tA -c "SET ROLE $1; $2" 2>&1)"; if [ $? -eq 0 ]; then echo ok; elif printf '%s' "$r" | grep -q 'permission denied\|violates check'; then printf '%s' "$r" | grep -q 'violates check' && echo check || echo denied; else echo "ERR:$r"; fi; }
FAIL=0; N=0
cell() { N=$((N+1)); if [ "$2" = "$3" ]; then printf '  PASS %-58s (%s)\n' "$1" "$2"; else printf '  🔴 FAIL %-55s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi; }
while IFS= read -r v; do f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"; [ -n "$f" ] && { P -f "$f" >/dev/null 2>&1 || true; }; done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002200000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
cell "貼前:表與函式都不在" "$(Q "select (to_regclass('public.email_copy_versions') is null)::text || (to_regprocedure('public.admin_save_email_copy(text,text,text,text)') is null)::text")" "truetrue"
P -q -c "CREATE ROLE zz_paster LOGIN NOSUPERUSER; GRANT postgres TO zz_paster;" >/dev/null
PN -f "$MIG" >/dev/null || { echo "🔴 migration 用非 superuser 貼不上"; exit 1; }
echo "── 權限 ──"
SAVE="select public.admin_save_email_copy('greeting', '您好呀，', 'probe', 'req-1')"
cell "service_role 可以存檔(函式)" "$(AS service_role "$SAVE")" "ok"
cell "service_role 可以讀表" "$(AS service_role "select count(*) from public.email_copy_versions")" "ok"
cell "service_role 不能改舊版本" "$(AS service_role "update public.email_copy_versions set text = 'x'")" "denied"
cell "service_role 不能刪舊版本" "$(AS service_role "delete from public.email_copy_versions")" "denied"
cell "service_role 不能清空" "$(AS service_role "truncate public.email_copy_versions")" "denied"
cell "anon 讀不到、寫不進、叫不到" "$(AS anon "select 1 from public.email_copy_versions")|$(AS anon "insert into public.email_copy_versions (copy_key, text, saved_by) values ('greeting','x','a')")|$(AS anon "$SAVE")" "denied|denied|denied"
cell "authenticated 讀不到、叫不到" "$(AS authenticated "select 1 from public.email_copy_versions")|$(AS authenticated "$SAVE")" "denied|denied"
echo "── 存檔與操作紀錄 ──"
AS service_role "select public.admin_save_email_copy('greeting', NULL, 'probe2', 'req-2')" >/dev/null
cell "兩次存檔 ⇒ 兩列, 最新那列是還原(NULL)" "$(Q "select (select count(*) from public.email_copy_versions where copy_key='greeting') || '|' || coalesce((select text from public.email_copy_versions where copy_key='greeting' order by saved_at desc, id desc limit 1), 'NULL')")" "2|NULL"
cell "操作紀錄:第一次 改前=預設、改後=新字" "$(Q "select before::text || ' => ' || after::text from public.admin_audit_log where request_id='req-1'")" '{"text": null, "is_default": true} => {"text": "您好呀，", "is_default": false}'
cell "操作紀錄:第二次 改前=新字、改後=預設" "$(Q "select before::text || ' => ' || after::text from public.admin_audit_log where request_id='req-2'")" '{"text": "您好呀，", "is_default": false} => {"text": null, "is_default": true}'
cell "操作紀錄的 action / target / actor" "$(Q "select action || '|' || target || '|' || actor from public.admin_audit_log where request_id='req-2'")" "email_copy.save|email_copy:greeting|probe2"
echo "── 格式(第二道保險)──"
cell "空字串擋" "$(AS service_role "select public.admin_save_email_copy('greeting', '', 'p', 'r')")" "check"
cell "換行擋" "$(AS service_role "select public.admin_save_email_copy('greeting', E'a\nb', 'p', 'r')")" "check"
cell "< > 擋" "$(AS service_role "select public.admin_save_email_copy('greeting', 'a<b>', 'p', 'r')")" "check"
cell "301 字擋、300 字可以" "$(AS service_role "select public.admin_save_email_copy('greeting', repeat('字', 301), 'p', 'r')")|$(AS service_role "select public.admin_save_email_copy('greeting', repeat('字', 300), 'p', 'r3')")" "check|ok"
cell "代號格式不對擋" "$(AS service_role "select public.admin_save_email_copy('bad key!', 'x', 'p', 'r')")" "check"
cell "格式被擋時, 操作紀錄也沒有多(同一個交易)" "$(Q "select count(*) from public.admin_audit_log where request_id = 'r'")" "0"
echo "── 重貼與回滾 ──"
cell "已貼過再貼 ⇒ 前置閘擋" "$(PN -f "$MIG" 2>&1 | grep -c '信件文字前置閘')" "1"
PN -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗(非 superuser)"; FAIL=1; }
cell "回滾後表與函式都不在" "$(Q "select (to_regclass('public.email_copy_versions') is null)::text || (to_regprocedure('public.admin_save_email_copy(text,text,text,text)') is null)::text")" "truetrue"
PN -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次並存檔" "$(AS service_role "$SAVE")" "ok"
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
