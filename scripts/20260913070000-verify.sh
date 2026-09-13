#!/usr/bin/env bash
# `20260913070000_m4b_fx_rates.sql` 的行為驗證(拋棄式 PG)
#
# 要證的一句:**只有在職的老闆能新增匯率列,而舊列誰都改不動、刪不掉。**
#
# 步驟:① 最小世界(角色 + staff + admin_audit_log)② 貼 migration(含它自己的前置閘 / 事後閘)
#      ③ 正對照:老闆設 USD ⇒ 1 列 + 稽核 1 列 ④ 負對照:非老闆 / 停用老闆 / 不存在 / TWD / 0 / NaN / Infinity /
#        幣別格式 / UPDATE 舊列 / DELETE 舊列 / TRUNCATE / 稽核炸 ⇒ 全部要紅 ⑤ 「現在的匯率」取最新、
#        未來列不算、兩連線並發 before 是真的 ⑥ 回退檔跑得過
#
# 🛑 答不出什麼:效能 · 正式庫的 staff 真實列 · service_role 經 PostgREST 的路徑(本檔直接 SET ROLE)。
#
# 用法:bash scripts/20260913070000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20260913070000_m4b_fx_rates.sql"
ROLLBACK="$REPO/supabase/rollbacks/20260913070000-rollback.sql"

test -f "$MIG" || { echo "ENV-FAIL:找不到 $MIG"; exit 3; }
test -f "$ROLLBACK" || { echo "ENV-FAIL:找不到 $ROLLBACK"; exit 3; }
command -v initdb >/dev/null 2>&1 || { echo "ENV-FAIL:本機沒有 initdb"; exit 3; }

TMP="$(mktemp -d)"
PGD="$TMP/pgdata"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
cleanup() { pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

echo "(跑的是 $(command -v psql) · port=$PORT)"
initdb -D "$PGD" -U postgres --encoding=UTF8 --locale=C >"$TMP/initdb.log" 2>&1 \
  || { echo "ENV-FAIL:initdb 失敗"; tail -5 "$TMP/initdb.log"; exit 3; }
pg_ctl -D "$PGD" -o "-p $PORT -k $TMP -c listen_addresses=" -l "$TMP/pg.log" -w start >/dev/null 2>&1 \
  || { echo "ENV-FAIL:PG 起不來"; tail -10 "$TMP/pg.log"; exit 3; }
PSQL="psql -h $TMP -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
# 期望【紅】:$1 說明 $2 SQL $3 錯誤訊息要含的字
expect_err() {
  local out; out="$($PSQL -c "$2" 2>&1)"; local rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q -- "$3"; then ok "$1(紅,含「$3」)"; else bad "$1 ⇒ 沒紅或訊息不對:$(printf '%s' "$out" | head -2)"; fi
}
# 期望【綠】且印出的值等於 $3
expect_val() {
  local out; out="$($PSQL -tA -c "$2" 2>&1)"; local rc=$?
  if [ $rc -eq 0 ] && [ "$out" = "$3" ]; then ok "$1 = $3"; else bad "$1 ⇒ 期望「$3」,得到「$out」"; fi
}

# ── ① 最小世界 ──────────────────────────────────────────────────────────────
$PSQL >"$TMP/fixture.log" 2>&1 <<'SQL' || { echo "ENV-FAIL:fixture 建不起來"; tail -20 "$TMP/fixture.log"; exit 3; }
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE payment_confirmer NOLOGIN; CREATE ROLE pcm_readonly NOLOGIN;
-- 模擬 shim:新表出生就帶 service_role 全權(20260907070000 抓到的那個世界)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
CREATE TABLE public.staff (
  id text PRIMARY KEY, label text NOT NULL,
  is_manager boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT staff_id_format CHECK (id ~ '^[a-z0-9_]{1,64}$')
);
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL, action text NOT NULL, target text, before jsonb, after jsonb, reason text,
  request_id text NOT NULL, source_app text NOT NULL DEFAULT 'admin', created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_request_id_nonempty CHECK (request_id <> '')
);
INSERT INTO public.staff (id, label, is_manager, is_active) VALUES
  ('boss', '老闆', true, true),
  ('clerk', '員工', false, true),
  ('exboss', '離職老闆', true, false);
SQL

# ── ② 貼 migration ──────────────────────────────────────────────────────────
if $PSQL -f "$MIG" >"$TMP/mig.log" 2>&1; then ok "migration 貼得過(含前置閘 / 事後閘)"; else bad "migration 紅"; tail -5 "$TMP/mig.log"; exit 1; fi
expect_err "重貼要當場紅(裸 CREATE / 前置閘①)" "\\i $MIG" "已存在"

# ── ③ 正對照 ────────────────────────────────────────────────────────────────
expect_val "老闆設 USD 32.5 ⇒ result ok" \
  "SELECT public.admin_fx_rate_set('boss','usd',32.5,NULL,'req-1')->>'result'" "ok"
expect_val "fx_rates 1 列、USD、32.5" "SELECT count(*)||'/'||min(currency_code)||'/'||min(rate_to_twd) FROM public.fx_rates" "1/USD/32.5"
expect_val "稽核 1 列 settings.fx.set, before 為 NULL(第一次設)" \
  "SELECT count(*)||'/'||bool_and(before IS NULL) FROM public.admin_audit_log WHERE action='settings.fx.set' AND target='fx_rates:USD'" "1/true"
expect_val "service_role 讀得到(SET ROLE)" "SET ROLE service_role; SELECT count(*) FROM public.fx_rates" "1"

# ── ④ 負對照 ────────────────────────────────────────────────────────────────
expect_err "員工(非老闆)設匯率" "SELECT public.admin_fx_rate_set('clerk','USD',33,NULL,'req-2')" "無權執行此操作"
expect_err "停用的老闆設匯率" "SELECT public.admin_fx_rate_set('exboss','USD',33,NULL,'req-3')" "無權執行此操作"
expect_err "不存在的人設匯率" "SELECT public.admin_fx_rate_set('ghost','USD',33,NULL,'req-4')" "無權執行此操作"
expect_err "TWD 不可改" "SELECT public.admin_fx_rate_set('boss','TWD',2,NULL,'req-5')" "TWD 固定 1"
expect_err "匯率 0" "SELECT public.admin_fx_rate_set('boss','USD',0,NULL,'req-6')" "大於 0"
expect_err "幣別格式(US1)" "SELECT public.admin_fx_rate_set('boss','US1',1,NULL,'req-7')" "三個英文字母"
expect_err "request_id 空" "SELECT public.admin_fx_rate_set('boss','USD',1,NULL,'  ')" "不可為空"
expect_err "owner UPDATE 舊列" "UPDATE public.fx_rates SET rate_to_twd = 1" "append-only"
expect_err "owner DELETE 舊列" "DELETE FROM public.fx_rates" "append-only"
expect_err "owner TRUNCATE" "TRUNCATE public.fx_rates" "append-only"
expect_err "直接 INSERT TWD=2 撞 CHECK" "INSERT INTO public.fx_rates (currency_code, rate_to_twd, created_by) VALUES ('TWD', 2, 'boss')" "fx_rates_twd_is_one"
expect_err "service_role 直接 INSERT(表權)" "SET ROLE service_role; INSERT INTO public.fx_rates (currency_code, rate_to_twd, created_by) VALUES ('EUR', 1, 'boss')" "permission denied"
expect_err "anon 呼 RPC" "SET ROLE anon; SELECT public.admin_fx_rate_set('boss','USD',1,NULL,'req-8')" "permission denied"
expect_err "anon 讀表" "SET ROLE anon; SELECT count(*) FROM public.fx_rates" "permission denied"
expect_val "負對照之後 fx_rates 仍 1 列、稽核仍 1 列" \
  "SELECT (SELECT count(*) FROM public.fx_rates)||'/'||(SELECT count(*) FROM public.admin_audit_log)" "1/1"

# ── ⑤ 現在的匯率取最新;before 帶上一列 ────────────────────────────────────
expect_val "老闆再設 USD 31 ⇒ ok" "SELECT public.admin_fx_rate_set('boss','USD',31,NULL,'req-9')->>'result'" "ok"
expect_val "現在的 USD = 31(DISTINCT ON 最新)" \
  "SELECT DISTINCT ON (currency_code) rate_to_twd FROM public.fx_rates WHERE effective_from <= now() ORDER BY currency_code, effective_from DESC" "31"
expect_val "第二筆稽核 before.rate_to_twd = 32.5" \
  "SELECT before->>'rate_to_twd' FROM public.admin_audit_log WHERE request_id='req-9'" "32.5"
# 🔴 寫入與查詢分兩句(同一句 SELECT 的外層子查詢看的是舊快照,會假綠;codex R1 must-fix 3)
expect_val "新增一列明天生效 ⇒ ok" "SELECT public.admin_fx_rate_set('boss','USD',99,now()+interval '1 day','req-10')->>'result'" "ok"
expect_val "負對照:不帶時間條件會讀到 99(證明那條 WHERE 真的在做事)" \
  "SELECT DISTINCT ON (currency_code) rate_to_twd FROM public.fx_rates ORDER BY currency_code, effective_from DESC" "99"
expect_val "現在的 USD 仍是 31(未來列不算現在)" \
  "SELECT DISTINCT ON (currency_code) rate_to_twd FROM public.fx_rates WHERE effective_from <= now() ORDER BY currency_code, effective_from DESC" "31"
expect_err "NaN 進不去(RPC)" "SELECT public.admin_fx_rate_set('boss','EUR','NaN'::numeric,NULL,'req-11')" "大於 0"
expect_err "Infinity 進不去(RPC)" "SELECT public.admin_fx_rate_set('boss','EUR','Infinity'::numeric,NULL,'req-12')" "大於 0"
expect_err "NaN 進不去(CHECK)" "INSERT INTO public.fx_rates (currency_code, rate_to_twd, created_by) VALUES ('EUR', 'NaN', 'boss')" "fx_rates_rate_positive"
expect_val "service_role 經 RPC 設 JPY 0.21 ⇒ ok(後台真實路徑的角色)" \
  "SET ROLE service_role; SELECT public.admin_fx_rate_set('boss','JPY',0.21,NULL,'req-13')->>'result'" "ok"
# 稽核與寫入同生共死:讓稽核那一筆故意炸(臨時 CHECK),匯率列不能多出來
$PSQL -c "ALTER TABLE public.admin_audit_log ADD CONSTRAINT tmp_block_gbp CHECK (target IS DISTINCT FROM 'fx_rates:GBP')" >/dev/null
expect_err "稽核寫不進去 ⇒ 整發紅" "SELECT public.admin_fx_rate_set('boss','GBP',40,NULL,'req-14')" "tmp_block_gbp"
expect_val "⇒ GBP 匯率列 0 筆(同交易一起撤)" "SELECT count(*) FROM public.fx_rates WHERE currency_code='GBP'" "0"
$PSQL -c "ALTER TABLE public.admin_audit_log DROP CONSTRAINT tmp_block_gbp" >/dev/null

# ── ⑤-b 兩連線並發:同幣別第二發要等第一發 commit,before 才是真的 ─────────
# A:交易內設 EUR 10 然後睡 2 秒才 commit;B:0.5 秒後設 EUR 20。B 的 before 必須是 10(不是「沒有」)。
$PSQL -c "BEGIN; SELECT public.admin_fx_rate_set('boss','EUR',10,NULL,'req-A'); SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
sleep 0.5
$PSQL -c "SELECT public.admin_fx_rate_set('boss','EUR',20,NULL,'req-B')" >/dev/null 2>&1
wait
expect_val "B 的稽核 before.rate_to_twd = 10(advisory lock 讓它等到 A commit)" \
  "SELECT coalesce(before->>'rate_to_twd','沒有') FROM public.admin_audit_log WHERE request_id='req-B'" "10"
expect_val "EUR 兩列都在" "SELECT count(*) FROM public.fx_rates WHERE currency_code='EUR'" "2"
# 反過來:B 先開交易(now() 釘在這一刻)但睡 1 秒才呼 RPC;A 0.3 秒後直接設 EUR 25 並 commit。
# B 的 before 必須是 25(RPC 用拿到鎖之後的 clock_timestamp,不是交易開始的 now();codex R2 must-fix)。
$PSQL -c "BEGIN; SELECT pg_sleep(1); SELECT public.admin_fx_rate_set('boss','EUR',30,NULL,'req-B2'); COMMIT;" >/dev/null 2>&1 &
sleep 0.3
$PSQL -c "SELECT public.admin_fx_rate_set('boss','EUR',25,NULL,'req-A2')" >/dev/null 2>&1
wait
expect_val "B2 的稽核 before.rate_to_twd = 25(交易早開、鎖晚拿,仍看得到 A2)" \
  "SELECT coalesce(before->>'rate_to_twd','沒有') FROM public.admin_audit_log WHERE request_id='req-B2'" "25"
expect_val "現在的 EUR = 30(B2 的生效時間晚於 A2)" \
  "SELECT DISTINCT ON (currency_code) rate_to_twd FROM public.fx_rates WHERE currency_code='EUR' AND effective_from <= now() ORDER BY currency_code, effective_from DESC" "30"

# ── ⑥ 回退 ──────────────────────────────────────────────────────────────────
if $PSQL -f "$ROLLBACK" >"$TMP/rb.log" 2>&1 && [ "$($PSQL -tA -c "SELECT to_regclass('public.fx_rates') IS NULL")" = "t" ]; then ok "回退檔跑得過,表不在了"; else bad "回退紅"; tail -5 "$TMP/rb.log"; fi

echo "── 結果:$PASS 綠 / $FAIL 紅"
[ $FAIL -eq 0 ]
