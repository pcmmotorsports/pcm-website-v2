#!/bin/bash
# ============================================================================
# 片1 rollback —— **帶資料的那一版**  🛑 草稿的測試, 不碰正式庫
# ============================================================================
# 🔴 為什麼:`2026-08-25-saved-views-rollback-test.sh` 的 down 跑在【空表】上。
#    而真要回退那天不會是空的。**現在完全沒有人知道那個數量級。**
#
# 🔴 N 怎麼挑的(主視窗要求寫出來, 而這比 N 本身重要):
#    我**不挑一個 N**, 我跑一道階梯 0 / 1,000 / 100,000。
#    理由:挑一個 N 只答得出「在那個 N 快不快」;
#         階梯答得出「**它在哪個數量級開始不一樣**」—— 而後者才是沒有人知道的那件事。
#    ⚠️ 而真實 N 的可能範圍本身也沒有人量過:`Q-檢視-9 = 甲`(不限制數量),
#       後台現在 2 個人在用(來源 memory `0827後台實際2人在用`, **非本片量測**)
#       ⇒ 100,000 遠超現實, 它在那裡是**上界探針**不是預測。
#
# 🔴 而【灌資料那一步本身也要有量具】(主視窗點名):
#    「我灌了 N 列」與「我以為我灌了 N 列」要分得開
#    ⇒ 灌完當場 `count(*)`, **不相信 INSERT 的回傳**。對不上 ⇒ 那一輪作廢。
#
# 用法  bash docs/specs/2026-08-25-saved-views-rollback-with-data.sh
# ============================================================================
set -u
export LC_ALL=C LANG=C
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
SOCK=/tmp/pgRD; DATA=${TMPDIR:-/tmp}/pgRD-data
HERE=${RDHERE:-$(cd "$(dirname "$0")" && pwd)}
UP="$HERE/2026-08-25-saved-views-migration-draft.sql"
FAILED=0
Q() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq "$@"; }
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate > /dev/null 2>&1; rm -rf "$SOCK" "$DATA"; }
trap cleanup EXIT

rm -rf "$SOCK" "$DATA"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C > /dev/null 2>&1 || { echo "initdb 失敗"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h ''" -l "$DATA/pg.log" start > /dev/null 2>&1 || { echo "pg_ctl 失敗"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do Q -c "select 1" > /dev/null 2>&1 && break; done

bootstrap() {
  Q > /dev/null <<'BOOT'
DROP TABLE IF EXISTS public.admin_saved_order_views CASCADE;
DROP TABLE IF EXISTS public.staff CASCADE;
DROP TABLE IF EXISTS public.admin_audit_log CASCADE;
DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at() CASCADE;
CREATE TABLE public.staff (id text PRIMARY KEY, label text NOT NULL,
  is_manager boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text, action text, target text, before jsonb, after jsonb, reason text,
  request_id text, source_app text, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.staff (id,label,is_manager) VALUES ('boss','boss',true),('clerk','clerk',false);
BOOT
  Q -c "CREATE ROLE anon NOLOGIN" > /dev/null 2>&1
  Q -c "CREATE ROLE authenticated NOLOGIN" > /dev/null 2>&1
  Q -c "CREATE ROLE service_role NOLOGIN BYPASSRLS" > /dev/null 2>&1
  Q -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; REVOKE CREATE ON SCHEMA public FROM PUBLIC;" > /dev/null 2>&1
  "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$UP" > "$DATA/up.log" 2>&1
  [ $? -eq 0 ] || { echo "FAIL up 套不上去(這一發的紅不是 rollback 的事)"; tail -2 "$DATA/up.log"; exit 2; }
}

DOWN_SQL="BEGIN;
  DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
  DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
  DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
  DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
  DROP TRIGGER  IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
  DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
  DROP TABLE    IF EXISTS public.admin_saved_order_views;
COMMIT;"

echo "=== 階梯:down 的耗時 vs 表裡有幾列 ==="
for N in 0 1000 100000; do
  bootstrap
  if [ "$N" -gt 0 ]; then
    Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query,idempotency_key)
          SELECT CASE WHEN i%2=0 THEN 'clerk' ELSE NULL END, 'v'||i, 'q='||i, 'k'||i
            FROM generate_series(1,$N) i
           WHERE i%2=0 OR i<=1;" > /dev/null 2>&1
    # 共用那半撞部分唯一索引(label 全表唯一)⇒ 只灌得進一列 ⇒ 改成全部私人
    Q -c "TRUNCATE public.admin_saved_order_views;" > /dev/null
    Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query,idempotency_key)
          SELECT 'clerk', 'v'||i, 'q='||i, 'k'||i FROM generate_series(1,$N) i;" > /dev/null
  fi
  # 🔴 量具:當場數, 不相信 INSERT 的回傳
  GOT=$(Q -c "SELECT count(*) FROM public.admin_saved_order_views;")
  if [ "$GOT" != "$N" ]; then
    echo "FAIL 灌資料對不上:想灌 $N,實際 $GOT ⇒ 這一輪作廢"; FAILED=1; continue
  fi
  T0=$(Q -c "SELECT extract(epoch from clock_timestamp())")
  Q -v ON_ERROR_STOP=1 -c "$DOWN_SQL" > "$DATA/down.log" 2>&1; RC=$?
  T1=$(Q -c "SELECT extract(epoch from clock_timestamp())")
  MS=$(Q -c "SELECT round(($T1-$T0)*1000)")
  LEFT=$(Q -c "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');")
  printf 'N=%-7s 灌到=%-7s down rc=%s 耗時=%sms 之後表=%s\n' "$N" "$GOT" "$RC" "$MS" "$LEFT"
  [ "$RC" = "0" ] && [ "$LEFT" = "不存在" ] || { echo "     🔴 這一格不對"; FAILED=1; }
done

echo
echo "=== 🔴 碼錶的正對照:餵它一件【一定會隨 N 變慢】的事 ==="
# 上面三格印 20/19/19ms 完全持平。那可能是真的(DROP TABLE 只是解檔案連結, 不掃列),
# **也可能是我的碼錶根本不會動**。這兩個世界在畫面上是同一組數字。
# ⇒ 拿 DELETE FROM(它【會】逐列掃)當正對照:若碼錶會動, 這裡必須看得出差別。
for N in 1000 100000; do
  bootstrap
  Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query,idempotency_key)
        SELECT 'clerk','v'||i,'q='||i,'k'||i FROM generate_series(1,$N) i;" > /dev/null
  GOT=$(Q -c "SELECT count(*) FROM public.admin_saved_order_views;")
  [ "$GOT" = "$N" ] || { echo "FAIL 灌資料對不上 $N vs $GOT"; FAILED=1; continue; }
  T0=$(Q -c "SELECT extract(epoch from clock_timestamp())")
  Q -c "DELETE FROM public.admin_saved_order_views;" > /dev/null
  T1=$(Q -c "SELECT extract(epoch from clock_timestamp())")
  printf '  正對照 DELETE FROM  N=%-7s 耗時=%sms\n' "$N" "$(Q -c "SELECT round(($T1-$T0)*1000)")"
done
echo "  ⇒ 上面兩個數若【明顯不同】⇒ 碼錶會動 ⇒ DROP 那三個持平的 20/19/19ms 是真的"
echo "  ⇒ 上面兩個數若也持平     ⇒ 🔴 碼錶壞了, 整張階梯作廢"

echo
echo "=== 有人正在讀的時候 down 會怎樣(這一格與 N 無關)==="
bootstrap
Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query) SELECT 'clerk','v'||i,'q' FROM generate_series(1,100) i;" > /dev/null
( Q -c "BEGIN; SELECT count(*) FROM public.admin_saved_order_views; SELECT pg_sleep(4); COMMIT;" > /dev/null 2>&1 ) &
APID=$!
sleep 1
OUT=$("$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq -c "SET lock_timeout='1500ms'" -c "$DOWN_SQL" 2>&1)
case "$OUT" in
  *lock*|*timeout*|*canceling*) echo "ok   有人在讀 ⇒ DROP TABLE 【擋在那裡】(拿不到 ACCESS EXCLUSIVE)" ;;
  *) echo "🔴 有人在讀而 DROP 竟然過了 ⇒ [$OUT]"; FAILED=1 ;;
esac
wait $APID 2>/dev/null
STILL=$(Q -c "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');")
[ "$STILL" = "admin_saved_order_views" ] && echo "ok   被擋下來之後表還在(整支交易回滾, 沒有做一半)" || { echo "🔴 表不見了 —— 被擋卻做了一半"; FAILED=1; }

echo
echo "=== 負對照:沒有人在讀的時候, 同一發 down 必須【過得去】==="
OUT2=$("$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq -c "SET lock_timeout='1500ms'" -c "$DOWN_SQL" 2>&1)
GONE=$(Q -c "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');")
[ "$GONE" = "不存在" ] && echo "ok   負對照:沒人搶的時候 down 過得去(這把尺不是【什麼都擋】)" || { echo "🔴 負對照紅了 ⇒ 上面那個 ok 不算數 [$OUT2]"; FAILED=1; }

[ $FAILED -eq 0 ] && echo "=== 帶資料的 rollback:全部照預期 ===" || echo "=== 帶資料的 rollback:有問題 ==="
exit $FAILED
