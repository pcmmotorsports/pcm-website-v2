#!/bin/bash
# ============================================================================
# 片1 並發測試 —— 🛑 草稿的測試,不是 migration 的一部分
# ============================================================================
# 🔴 為什麼要有這一支:2026-08-28 突變 M21(把 `FOR UPDATE` 整個拿掉)
#    ⇒ **16 發突變全綠、32 格測試全過**。
#    成因不是疏忽, 是【那一整層的量具不存在】——
#    24 發突變、34 格測試、22 道碼錨, **全部住在單一 session 那個世界裡**。
#    📌 一個東西可以是這一片最重要的設計決定(§14-15 換路的核心), 而零覆蓋。
#
# 用法  bash docs/specs/2026-08-25-saved-views-concurrency-test.sh [migration.sql]
#       不給參數 ⇒ 用 docs/specs/2026-08-25-saved-views-migration-draft.sql
# 回傳  0 = 兩個世界都對 · 非 0 = 有世界不對(訊息會說是哪一個)
# ============================================================================
set -u
export LC_ALL=C LANG=C
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
SOCK=/tmp/pgCC
DATA=${TMPDIR:-/tmp}/pgCC-data
SQL=${1:-docs/specs/2026-08-25-saved-views-migration-draft.sql}
FAILED=0

psqlq() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq "$@"; }

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate > /dev/null 2>&1
  rm -rf "$SOCK" "$DATA"
}
trap cleanup EXIT

# ── 起庫 ────────────────────────────────────────────────────────────────────
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

"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$SQL" > "$DATA/apply.log" 2>&1
if [ $? -ne 0 ]; then
  echo "apply 失敗(這一發的紅來自 migration 本身, 不是並發)"; tail -3 "$DATA/apply.log"; exit 2
fi
psqlq -c "SELECT public.admin_create_saved_order_view('clerk','並發測試','q',NULL,false,'cc1',NULL)" > /dev/null
VID=$(psqlq -c "SELECT id FROM public.admin_saved_order_views WHERE label='並發測試'")

# ── 世界 1:A 鎖住不放手 ⇒ B 必須【擋在那裡】 ────────────────────────────────
# 判別力來源:B 在【擋得住】與【擋不住】兩個世界印不同的東西 ——
#   擋得住 ⇒ statement_timeout 到期 ⇒ 空輸出 + 錯誤;擋不住 ⇒ 立刻印一個回傳碼
( psqlq -c "BEGIN; SELECT 1 FROM public.admin_saved_order_views WHERE id=$VID FOR UPDATE; SELECT pg_sleep(4); COMMIT;" > /dev/null 2>&1 ) &
APID=$!
sleep 1
B1=$("$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq \
      -c "SET statement_timeout='1500ms'" \
      -c "SELECT public.admin_update_saved_order_view('clerk',$VID,'B 改的',NULL,NULL,NULL,NULL)" 2>&1)
case "$B1" in
  *canceling*|*timeout*) echo "ok   W1 A 鎖住時 B 擋在那裡" ;;
  *) echo "FAIL W1 B 沒有被擋 —— 它立刻回了 [$B1]"; echo "     ⇒ 鎖沒有生效, 或判斷根本不在鎖裡面"; FAILED=1 ;;
esac
wait $APID 2>/dev/null

# ── 世界 2:A 在鎖裡把那一列【刪掉】⇒ B 必須看見 A 之後的世界 ────────────────
# 🔴 這一發打的是【判斷在鎖外面】那條繞法 —— 碼錨擋不住它:
#    無鎖預讀 + 事後補一把鎖 ⇒ `FOR UPDATE` 字面仍在、仍在寫入之前 ⇒ 錨全綠
#    而 B 會拿【A 刪掉之前】那一份去判斷 ⇒ UPDATE 影響 0 列 ⇒ 卻回 'UPDATED'
#    📌 它回報成功, 而什麼都沒寫進去。
( psqlq -c "BEGIN; SELECT 1 FROM public.admin_saved_order_views WHERE id=$VID FOR UPDATE; DELETE FROM public.admin_saved_order_views WHERE id=$VID; SELECT pg_sleep(3); COMMIT;" > /dev/null 2>&1 ) &
APID=$!
sleep 1
B2=$(psqlq -c "SELECT public.admin_update_saved_order_view('clerk',$VID,'B 又改的',NULL,NULL,NULL,NULL)" 2>&1)
wait $APID 2>/dev/null
if [ "$B2" = "NOT_FOUND" ]; then
  echo "ok   W2 A 刪掉之後 B 看見的是 A 之後的世界(NOT_FOUND)"
else
  echo "FAIL W2 B 回了 [$B2], 期望 NOT_FOUND"
  echo "     ⇒ B 拿【A 刪掉之前】那一份去判斷 = TOCTOU;它回報成功而什麼都沒寫進去"
  FAILED=1
fi

# ── 世界 4 / 5:delete 那支 —— 🔴 它與 update 是【兩支函式】, 不要從一支外推到另一支
psqlq -c "SELECT public.admin_create_saved_order_view('clerk','刪的並發','q',NULL,false,'cc3',NULL)" > /dev/null
VID3=$(psqlq -c "SELECT id FROM public.admin_saved_order_views WHERE label='刪的並發'")
( psqlq -c "BEGIN; SELECT 1 FROM public.admin_saved_order_views WHERE id=$VID3 FOR UPDATE; SELECT pg_sleep(4); COMMIT;" > /dev/null 2>&1 ) &
APID=$!
sleep 1
B4=$("$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq \
      -c "SET statement_timeout='1500ms'" \
      -c "SELECT public.admin_delete_saved_order_view('clerk',$VID3,NULL)" 2>&1)
case "$B4" in
  *canceling*|*timeout*) echo "ok   W4 A 鎖住時 B 的 delete 擋在那裡" ;;
  *) echo "FAIL W4 delete 沒有被擋 —— 它立刻回了 [$B4]"; FAILED=1 ;;
esac
wait $APID 2>/dev/null

( psqlq -c "BEGIN; SELECT 1 FROM public.admin_saved_order_views WHERE id=$VID3 FOR UPDATE; DELETE FROM public.admin_saved_order_views WHERE id=$VID3; SELECT pg_sleep(3); COMMIT;" > /dev/null 2>&1 ) &
APID=$!
sleep 1
B5=$(psqlq -c "SELECT public.admin_delete_saved_order_view('clerk',$VID3,NULL)" 2>&1)
wait $APID 2>/dev/null
if [ "$B5" = "NOT_FOUND" ]; then
  echo "ok   W5 A 刪掉之後 B 的 delete 看見 A 之後的世界(NOT_FOUND)"
else
  echo "FAIL W5 delete 回了 [$B5], 期望 NOT_FOUND —— 它回報刪掉了, 而是別人刪的"; FAILED=1
fi

# ── 負對照:一個【本來就不該擋】的世界必須通得過 ─────────────────────────────
# 少了這一發, 一個「什麼都擋」的壞掉 harness 也會讓 W1/W2 全綠
psqlq -c "SELECT public.admin_create_saved_order_view('clerk','沒人搶的','q',NULL,false,'cc2',NULL)" > /dev/null
VID2=$(psqlq -c "SELECT id FROM public.admin_saved_order_views WHERE label='沒人搶的'")
B3=$("$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq \
      -c "SET statement_timeout='1500ms'" \
      -c "SELECT public.admin_update_saved_order_view('clerk',$VID2,'改好了',NULL,NULL,NULL,NULL)" 2>&1)
if [ "$B3" = "UPDATED" ]; then
  echo "ok   W3 負對照:沒有人搶的那一列, B 改得動"
else
  echo "FAIL W3 負對照紅了 —— 這把尺【什麼都擋】, W1/W2 的綠不算數。實得 [$B3]"
  FAILED=1
fi

[ $FAILED -eq 0 ] && echo "=== 並發:五個世界都對 ===" || echo "=== 並發:有世界不對 ==="
exit $FAILED
