#!/usr/bin/env bash
# e8b-b1-probe — 真登入線 B1 三支 migration 的拋棄式驗證台
#
# 用法:bash scripts/e8b-b1-probe/run.sh
# 它做三件事:①起一座拋棄式 PG ②把三支草稿真的跑一遍 ③跑突變測試 ④拆掉並驗死
#
# 🔴 為什麼要有這支檔(2026-08-18 G5):
#    這組東西原本只活在 scratchpad —— 而 apply 當天要重跑的正是它。
#    「改對了」與「跑得起來」是兩件事,而第二件只有真的跑才知道。
#
# 🔴 判準是【紅的是不是那一句】,不是【有沒有紅】:
#    第一版 harness 用「有沒有 ERROR」判,而 `ALTER ROLE … NOBYPASSRLS` 是【叢集層級】的、
#    洩漏到後面三個 case ⇒ 那三格照樣印「期望=RED 實得=RED」,而紅的原因根本不是要測的那個。
#    ⇒ 每一格都要求錯誤訊息含指定字串。
#
# ⚠️ 效度限定(照 docs/runbooks/throwaway-postgres-for-migration-verification.md §5):
#    · 本機的 service_role / anon / authenticated 是這支檔自己造的,ADP 與 role membership 與正式庫不同
#    · auth.users 是骨架(id + email 兩欄),不是真的 GoTrue 表
#    · 走的是 psql,不是 MCP apply_migration ⇒ 台帳與連線角色這裡問不到
set -uo pipefail

PORT="${PGPROBE_PORT:-55501}"
DATA="${PGPROBE_DIR:-/tmp/pgprobe-e8b}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
B1A="$REPO/docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql"
B1B="$REPO/docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql"
B1C="$REPO/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql"   # 舊檔名,內容是 B1-c
STAFF="$REPO/supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql"

PASS=0; FAIL=0
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

up () {
  export LC_ALL=C LANG=C
  rm -rf "$DATA"; mkdir -p "$DATA"
  initdb -U postgres -A trust "$DATA/data" > "$DATA/initdb.log" 2>&1 || { tail -6 "$DATA/initdb.log"; exit 1; }
  pg_ctl -D "$DATA/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
    -l "$DATA/pg.log" start >/dev/null || { tail -6 "$DATA/pg.log"; exit 1; }
  sleep 3
  pq -d postgres -q -c "CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;"
}

down () {
  pg_ctl -D "$DATA/data" stop -m fast >/dev/null 2>&1
  sleep 1
  local procs ports
  procs="$(pgrep -f "$PORT" | head -3)"
  ports="$(lsof -nP -iTCP:"$PORT" 2>/dev/null | head -3)"
  rm -rf "$DATA"
  echo "── 收攤:程序[${procs:-空}] 埠[${ports:-空}] 資料目錄已刪 ──"
  # 🔴 程序死 ≠ 埠釋放 ⇒ 兩層都印出來,不看 stop 的回傳值
}

# case <名字> <哪個 db 樣板> <突變 SQL 或 ''> <要跑的檔> <GREEN|RED> <錯誤訊息要含的字串>
case1 () {
  local name="$1" tpl="$2" mut="$3" file="$4" expect="$5" want="${6:-}"
  pq -d postgres -q -c "DROP DATABASE IF EXISTS $name" >/dev/null 2>&1
  createdb -h 127.0.0.1 -p "$PORT" -U postgres -T "$tpl" "$name" || { echo "[FAIL] $name createdb"; FAIL=$((FAIL+1)); return; }
  if [ -n "$mut" ]; then pq -d "$name" -q -c "$mut" >/dev/null 2>&1 || { echo "[FAIL] $name 突變本身失敗"; FAIL=$((FAIL+1)); return; }; fi
  local out got ok=1
  out="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$name" -f "$file" 2>&1)"
  if printf '%s' "$out" | grep -q 'ERROR:'; then got=RED; else got=GREEN; fi
  [ "$got" = "$expect" ] || ok=0
  if [ -n "$want" ]; then printf '%s' "$out" | grep -q -- "$want" || ok=0; fi
  if [ "$ok" = 1 ]; then PASS=$((PASS+1)); echo "[OK  ] $name 期望=$expect${want:+ 含「$want」}";
  else FAIL=$((FAIL+1)); echo "[FAIL] $name 期望=$expect${want:+ 含「$want」} 實得=$got";
       printf '%s' "$out" | grep -E 'ERROR:' | head -1 | sed 's/^/        /'; fi
}

up
trap down EXIT

# ── A 庫(pcm-website-v2):B1-a ────────────────────────────────────────────
createdb -h 127.0.0.1 -p "$PORT" -U postgres atpl
pq -d atpl -q -f "$STAFF" >/dev/null
pq -d atpl -q -c "INSERT INTO public.staff (id,label,is_manager,is_active) VALUES
   ('test_01','測試帳號 01',true,true),('op4_backfill','補登用',false,false),('payment_confirmer','收款確認',false,false);" >/dev/null

echo "── B1-a(A 庫:停用 test_01)──"
# 🔴 GREEN 那幾格也要有字串斷言(2026-08-18 MAIN 追問後補):
#    「沒有 ERROR」在【檔案根本沒跑起來】的世界裡也成立 —— 綠也會綠錯原因。
#    ⇒ 對照組改成要求看到那支檔自己印的成功 NOTICE。
case1 a_ctrl     atpl "" "$B1A" GREEN "沒有第三種差異"
case1 a_newhire  atpl "INSERT INTO public.staff (id,label,is_manager,is_active) VALUES ('staff_3','新員工 3',false,true)" "$B1A" GREEN "不擋"
case1 a_swap     atpl "UPDATE public.staff SET is_active=false WHERE id='staff_1'; UPDATE public.staff SET is_active=true WHERE id='op4_backfill'" "$B1A" GREEN "不擋"
case1 a_gone     atpl "DELETE FROM public.staff WHERE id='test_01'" "$B1A" RED "沒有 test_01"
# 🔴 這一格的突變【必須發生在 migration 執行的當下】,不能是事先改好 ——
#    b1a_before 的快照是在 migration 內拍的,事先改掉的東西會被算進「before」⇒ 不是 drift。
#    (第一版我把它寫成事先 UPDATE,結果 GREEN;那不是斷言壞了,是我的測資測錯東西。)
#    ⇒ 掛一支 trigger:本支 UPDATE test_01 的時候,順手動別人一列。
case1 a_label    atpl "CREATE FUNCTION public.probe_side_effect() RETURNS trigger LANGUAGE plpgsql AS \$p\$ BEGIN UPDATE public.staff SET label='被順手改到' WHERE id='sean'; RETURN NEW; END \$p\$; CREATE TRIGGER probe_side_effect_trg BEFORE UPDATE ON public.staff FOR EACH ROW WHEN (OLD.id='test_01') EXECUTE FUNCTION public.probe_side_effect();" "$B1A" RED "動到了不該動"

# ── 報價單庫:B1-b + B1-c ─────────────────────────────────────────────────
createdb -h 127.0.0.1 -p "$PORT" -U postgres qtpl
pq -d qtpl -q -c "CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  INSERT INTO auth.users VALUES
    ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533','sean@pcmmotorsports.com'),
    ('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f','shopee1@partscheaper.net');
  CREATE TABLE public.auth_state (id int PRIMARY KEY DEFAULT 1 CHECK (id=1), require_2fa boolean NOT NULL DEFAULT false);
  INSERT INTO public.auth_state (id,require_2fa) VALUES (1,false);
  CREATE TABLE public.totp_devices (id bigserial PRIMARY KEY);
  CREATE TABLE public.recovery_codes (id bigserial PRIMARY KEY);" >/dev/null

echo "── B1-b(報價單庫:建映射表)──"
case1 b_ctrl qtpl "" "$B1B" GREEN "新物件收權斷言通過"
pq -d qtpl -q -f "$B1B" >/dev/null 2>&1 || { echo "[FAIL] qtpl 套 B1-b 失敗"; FAIL=$((FAIL+1)); }

echo "── B1-c(報價單庫:塞人)──"
case1 c_ctrl     qtpl "" "$B1C" GREEN "落地斷言通過"
case1 c_email    qtpl "UPDATE auth.users SET email='x@example.com' WHERE id='63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f'" "$B1C" RED "email 不是預期的那個"
case1 c_wl4      qtpl "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist; ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist CHECK (staff_id IN ('sean','staff_1','staff_2','x9'))" "$B1C" RED "白名單裡的字面有 4 個"
case1 c_anon     qtpl "GRANT SELECT ON TABLE public.admin_user_staff_map TO anon" "$B1C" RED "anon:SELECT"
case1 c_maintain qtpl "GRANT MAINTAIN ON TABLE public.admin_user_staff_map TO anon" "$B1C" RED "anon:MAINTAIN"
case1 c_col      qtpl "GRANT SELECT (staff_id) ON TABLE public.admin_user_staff_map TO anon" "$B1C" RED "欄級"
case1 c_policy   qtpl "CREATE POLICY p_all ON public.admin_user_staff_map FOR SELECT USING (true)" "$B1C" RED "出現了 policy"
case1 c_norls    qtpl "ALTER TABLE public.admin_user_staff_map DISABLE ROW LEVEL SECURITY" "$B1C" RED "RLS 沒有開著"
case1 c_write    qtpl "GRANT INSERT ON TABLE public.admin_user_staff_map TO service_role" "$B1C" RED "又拿到寫入權"

# 🔴 這一格的突變是【叢集層級】的 ⇒ 跑完當場還原,否則它會洩漏到後面每一格
pq -d postgres -q -c "ALTER ROLE service_role NOBYPASSRLS" >/dev/null
case1 c_nobypass qtpl "" "$B1C" RED "沒有 BYPASSRLS"
pq -d postgres -q -c "ALTER ROLE service_role BYPASSRLS" >/dev/null

cat > "$DATA/mut_del.sql" <<'EOF'
CREATE OR REPLACE FUNCTION public.admin_user_staff_map_no_delete()
RETURNS trigger LANGUAGE plpgsql AS $x$
BEGIN IF OLD.staff_id = 'sean' THEN RAISE EXCEPTION 'no delete'; END IF; RETURN OLD; END $x$;
EOF
cat > "$DATA/mut_rebind.sql" <<'EOF'
CREATE OR REPLACE FUNCTION public.admin_user_staff_map_no_rebind()
RETURNS trigger LANGUAGE plpgsql AS $x$
BEGIN IF NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN RAISE EXCEPTION 'no rebind'; END IF; RETURN NEW; END $x$;
EOF
cat > "$DATA/mut_trunc.sql" <<'EOF'
CREATE OR REPLACE FUNCTION public.admin_user_staff_map_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $x$
BEGIN RETURN NULL; END $x$;
EOF
for m in del rebind trunc; do
  n="c_gut_$m"
  pq -d postgres -q -c "DROP DATABASE IF EXISTS $n" >/dev/null 2>&1
  createdb -h 127.0.0.1 -p "$PORT" -U postgres -T qtpl "$n"
  pq -d "$n" -q -f "$DATA/mut_$m.sql" >/dev/null
  out="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$n" -f "$B1C" 2>&1)"
  case "$m" in
    del)    want="DELETE(staff_2)" ;;
    rebind) want="auth_user_id" ;;
    trunc)  want="TRUNCATE 沒有被擋下" ;;
  esac
  if printf '%s' "$out" | grep -q 'ERROR:' && printf '%s' "$out" | grep -q -- "$want"; then
    PASS=$((PASS+1)); echo "[OK  ] $n 期望=RED 含「$want」"
  else
    FAIL=$((FAIL+1)); echo "[FAIL] $n 期望=RED 含「$want」"
    printf '%s' "$out" | grep -E 'ERROR:' | head -1 | sed 's/^/        /'
  fi
done

echo "────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
