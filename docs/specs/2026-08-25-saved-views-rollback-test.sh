#!/bin/bash
# ============================================================================
# 片1 rollback 實跑 —— 🛑 草稿的測試,不是 migration 的一部分。絕不碰正式庫。
# ============================================================================
# 🔴 為什麼(2026-08-28 線C 量到):
#    本 repo 222 支 migration 裡, **檔名帶 down/rollback/revert 的 = 0**;
#    而 137 支的 `DROP` 有 100 支【只出現在註解裡】—— 那是刻意的慣例
#    (逐字「Rollback(Supabase forward-only、僅供參考、手動執行)」)。
#    ⇒ 📌 **回退是以【文字】的形式存在的, 而文字沒有人執行過。**
#       forward 這一側跑過幾十次, down 這一側【零次】。
#
# 🔴 而驗收條要小心:**「down 跑完 rc=0」不等於「回到 down 之前的狀態」。**
#    ⇒ 本檔比三個 schema 快照:before / after-up / after-down
#      該相同的是 **before 與 after-down**;after-up 必須與它們【不同】
#      (若 after-up 也相同 ⇒ 那代表 up 根本沒生效, 而三者全同會印一個很好看的綠)
#
# 用法  bash docs/specs/2026-08-25-saved-views-rollback-test.sh
# ============================================================================
set -u
export LC_ALL=C LANG=C
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
SOCK=/tmp/pgRB; DATA=${TMPDIR:-/tmp}/pgRB-data
# 🔴 路徑從【腳本自己的位置】推 —— 而那表示:**把這支檔複製到別處,它會安靜地去找別的東西。**
#    2026-08-28 我把它 sed 成三份突變放進 scratchpad, 三份全部紅在「up 沒套上去」——
#    而那不是突變抓到東西, 是**複製品找不到 UP 檔**。
#    📌 CLAUDE.md 記過同族(`storefront-probe/up.sh` 寫死 REPO ⇒ 從 worktree 呼叫它會跑去主樹)。
#    ✅ 留一個 `RBHERE` 讓突變版指回原處 —— **否則這支腳本【沒辦法被突變殺】。**
HERE=${RBHERE:-$(cd "$(dirname "$0")" && pwd)}
UP="$HERE/2026-08-25-saved-views-migration-draft.sql"
FAILED=0
psqlq() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq "$@"; }
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate > /dev/null 2>&1; rm -rf "$SOCK" "$DATA" ; }
trap cleanup EXIT

rm -rf "$SOCK" "$DATA"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C > /dev/null 2>&1 || { echo "initdb 失敗"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h ''" -l "$DATA/pg.log" start > /dev/null 2>&1 || { echo "pg_ctl 失敗"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do psqlq -c "select 1" > /dev/null 2>&1 && break; done
psqlq > /dev/null <<'BOOT'
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
INSERT INTO public.staff (id,label,is_manager) VALUES ('boss','boss',true),('clerk','clerk',false);
BOOT

# schema 快照:表 / 欄 / 索引 / 函式 / 觸發器 / 表級 ACL / 函式級 ACL / RLS 態
snap() {
  psqlq <<'SQL'
SELECT string_agg(x, E'\n' ORDER BY x) FROM (
  SELECT 'T:'||c.relname||':'||c.relrowsecurity::text||':'||coalesce(array_to_string(c.relacl,','),'-') AS x
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','v','i','S')
  UNION ALL
  SELECT 'C:'||table_name||'.'||column_name||':'||data_type
    FROM information_schema.columns WHERE table_schema='public'
  UNION ALL
  SELECT 'F:'||p.proname||':'||pg_get_function_identity_arguments(p.oid)||':'||coalesce(array_to_string(p.proacl,','),'-')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  UNION ALL
  SELECT 'G:'||tgname||':'||tgrelid::regclass::text FROM pg_trigger WHERE NOT tgisinternal
) s;
SQL
}

BEFORE=$(snap)
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$UP" > "$DATA/up.log" 2>&1
UPRC=$?
if [ $UPRC -ne 0 ]; then echo "FAIL up 沒套上去 rc=$UPRC"; tail -2 "$DATA/up.log"; exit 2; fi
echo "ok   up  套上去了"
AFTER_UP=$(snap)

# ── down:照 repo 慣例「forward-only、手動執行」那個形狀,逐句列 ──────────────
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q > "$DATA/down.log" 2>&1 <<'DOWN'
BEGIN;
  DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
  DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
  DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
  DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
  DROP TRIGGER IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
  DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
  DROP TABLE IF EXISTS public.admin_saved_order_views;
COMMIT;
DOWN
DOWNRC=$?
if [ $DOWNRC -ne 0 ]; then echo "FAIL down 跑不起來 rc=$DOWNRC"; tail -3 "$DATA/down.log"; FAILED=1
else echo "ok   down 跑完 rc=0"; fi
AFTER_DOWN=$(snap)

# ── 三個快照的關係 ──────────────────────────────────────────────────────────
if [ "$BEFORE" = "$AFTER_UP" ]; then
  echo "FAIL 對照:before 與 after-up 相同 ⇒ **up 根本沒生效**, 底下的「回得去」不算數"
  FAILED=1
else
  echo "ok   對照:up 真的改變了 schema(before ≠ after-up)"
fi
if [ "$BEFORE" = "$AFTER_DOWN" ]; then
  echo "ok   down 真的回到了 before(逐字相同)"
else
  echo "FAIL down 【沒有】回到 before —— 差異如下(左 before / 右 after-down):"
  diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER_DOWN") | head -20
  FAILED=1
fi
[ $FAILED -eq 0 ] && echo "=== rollback:up 生效 · down 回得去 ===" || echo "=== rollback:有問題 ==="
exit $FAILED
