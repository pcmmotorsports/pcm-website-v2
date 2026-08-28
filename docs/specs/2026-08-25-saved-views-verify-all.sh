#!/bin/bash
# ============================================================================
# 片1 全套驗收 —— 一發跑完六層量具  🛑 拋棄式 PG, 絕不碰正式庫
# ============================================================================
# 🔴 為什麼要有這一支:六把尺是分批做出來的, 而草稿【一直在長】(597 ⇒ 703 行)。
#    每一把尺各自綠過, 而**沒有人在同一個版本上把六把一起跑過**。
#    📌 六個「上次跑是綠的」加起來, 不等於「現在是綠的」。
# 用法  bash docs/specs/2026-08-25-saved-views-verify-all.sh
# ============================================================================
set -u
export LC_ALL=C LANG=C
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
SOCK=/tmp/pgVA; DATA=${TMPDIR:-/tmp}/pgVA-data
HERE=${VAHERE:-$(cd "$(dirname "$0")" && pwd)}
# 🔴 可指定另一支 SQL(給突變用)。沒有這個, 這支腳本【沒辦法被突變殺】——
#    而一支殺不了的尺與一支在守著的尺, 都印 ok。
D="${VADRAFT:-$HERE/2026-08-25-saved-views-migration-draft.sql}"
T="$HERE/2026-08-25-saved-views-tests.sql"
FAILED=0
Q() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq "$@"; }
say() { printf '%-46s %s\n' "$1" "$2"; }
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate > /dev/null 2>&1; rm -rf "$SOCK" "$DATA"; }
trap cleanup EXIT

rm -rf "$SOCK" "$DATA"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C > /dev/null 2>&1 || { echo "initdb 失敗"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h ''" -l "$DATA/pg.log" start > /dev/null 2>&1 || { echo "pg_ctl 失敗"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do Q -c "select 1" > /dev/null 2>&1 && break; done
Q > /dev/null <<'BOOT'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE public.staff (id text PRIMARY KEY, label text NOT NULL,
  is_manager boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text, action text, target text, before jsonb, after jsonb, reason text,
  request_id text, source_app text, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.staff (id,label,is_manager) VALUES ('boss','boss',true),('clerk','clerk',false),('gone','gone',false);
UPDATE public.staff SET is_active=false WHERE id='gone';
BOOT

echo "── ① apply(草稿 $(wc -l < "$D" | tr -d ' ') 行)──"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D" > "$DATA/up.log" 2>&1
RC=$?
# 🔴 失敗時要印出【是哪一道斷言】—— 第一版只印 rc, 而 rc 只答得出「哪一層紅」,
#    答不出「哪一格紅」。而突變測試的整個價值就在後面那個。
#    📌 一支把多層收成一個總結的腳本, 會把「紅在哪一格」壓成「哪一層紅」。
if [ $RC -eq 0 ]; then say "apply(含 22+ 道碼錨與斷言)" "rc=0 ✅"
else say "apply" "rc=$RC 🔴"; grep -m1 "ERROR:" "$DATA/up.log" | sed 's/^/    /'; exit 2; fi

echo "── ② apply 後的四格(每格寫死期望)──"
chk() { local got; got=$(Q -c "$2"); [ "$got" = "$3" ] && say "$1 期望 $3" "實得 $got ✅" || { say "$1 期望 $3" "實得 $got 🔴"; FAILED=1; }; }
chk "to_regclass" "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');" "admin_saved_order_views"
chk "函式支數" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';" "5"
chk "RLS 開著" "SELECT relrowsecurity FROM pg_class WHERE oid='public.admin_saved_order_views'::regclass;" "t"
chk "policy 條數" "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='admin_saved_order_views';" "0"
chk "service_role EXECUTE" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%' AND has_function_privilege('service_role', p.oid, 'EXECUTE');" "4"
chk "🔴 負對照 不存在的表" "SELECT coalesce(to_regclass('public.zzz_never_a_table')::text,'不存在');" "不存在"

echo "── ③ 34 格行為測試 ──"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$T" > "$DATA/t.log" 2>&1
RC=$?; N=$(grep -c "NOTICE:  ok" "$DATA/t.log")
if [ $RC -eq 0 ]; then say "行為測試 rc=0 · ok 格數" "$N ✅"
else say "行為測試 rc=$RC · ok" "$N 🔴"
     grep -m1 "ERROR:" "$DATA/t.log" | sed 's/^/    /'      # ← 哪一格紅, 不是哪一層紅
     FAILED=1; fi

echo "── ④ 帶資料的 down(有資料那半)──"
Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query,idempotency_key)
      SELECT 'clerk','vv'||i,'q='||i,'kk'||i FROM generate_series(1,5000) i;" > /dev/null
GOT=$(Q -c "SELECT count(*) FROM public.admin_saved_order_views;")
# 灌完當場數, 不相信 INSERT 的回傳(表裡本來有測試留下的列 ⇒ 只驗它 >= 5000)
[ "$GOT" -ge 5000 ] && say "灌資料 當場 count(*)" "$GOT(>=5000)✅" || { say "灌資料" "$GOT 🔴"; FAILED=1; }
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 > "$DATA/down.log" 2>&1 <<'DOWN'
SET lock_timeout = '5s';
BEGIN;
  DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
  DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
  DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
  DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
  DROP TRIGGER  IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
  DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
  DROP TABLE    IF EXISTS public.admin_saved_order_views;
COMMIT;
DOWN
RC=$?; [ $RC -eq 0 ] && say "down(帶 $GOT 列 · lock_timeout 5s)" "rc=0 ✅" || { say "down" "rc=$RC 🔴"; tail -2 "$DATA/down.log"; FAILED=1; }
chk "down 後 to_regclass" "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');" "不存在"
chk "down 後 函式支數" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';" "0"

# 🔴 這支腳本【只跑三層】:apply+斷言 / 34 格行為 / 帶資料的 down。
#    另外三層要各自跑, 不在本檔:
#      並發   bash docs/specs/2026-08-25-saved-views-concurrency-test.sh
#      合約   python3 docs/specs/2026-08-25-saved-views-contract-check.py
#      定義   python3 docs/specs/2026-08-25-saved-views-manager-def-check.py
#      突變   /tmp 那支(未進 repo ⇒ 見下方缺口)
#    📌 本檔第一版印的是「六層一起綠」—— **而它只跑了三層。**
#       那正是它自己要治的病:一個看起來完整的結論, 而分母比它宣稱的窄。
[ $FAILED -eq 0 ] && echo "=== 本檔三層在同一個版本上一起綠(另外三層另跑, 見檔尾註)===" || echo "=== 有紅 ==="
exit $FAILED
