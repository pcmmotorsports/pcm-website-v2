#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 CI 的認領標記,見 .github/workflows/ci.yml
# late-payment-sweep-probe.sh
#   ⟦b4-NCPCRONRACE⟧ 兜底 · 片 1(腿 A)探針:拋棄式 PG, 雙向。
#
# 🛑🛑 **它【證不到】什麼(先讀這段, 它決定下面每一格能不能當結論)**:
#   · 拋棄式 PG **沒有 pg_cron** ⇒ 本檔造一個 `cron` 的**替身**(一張 job 表 + 兩支函式)。
#     ⇒ 🔴 它驗得了「這支 migration 的 SQL 合法、斷言會叫」, **驗不了「排程真的每 10 分鐘跑」**。
#   · 它是**單連線** ⇒ 驗得了「掃描器掃對了什麼」, **驗不了「它在真的競態下補得及」**。
#   · 那兩格只能靠上線後看 —— ⚠️ 而**不要用「補了幾筆」當驗收**(Sean 拍板時看到的那句)。
set -u
export LC_ALL=C LANG=C
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="${1:-$REPO_ROOT/supabase/migrations/20260905180000_m4b_late_payment_pending_refund_sweep.sql}"
test -f "$MIG" || { echo "🔴 找不到受測 migration:$MIG"; exit 1; }
DOWN="$REPO_ROOT/scripts/20260905180000-down.sql"

pick() {
  if command -v "$1" > /dev/null 2>&1; then printf '%s' "$1"
  elif [ -x "/opt/homebrew/bin/$1" ]; then printf '%s' "/opt/homebrew/bin/$1"
  else echo "🔴 找不到 $1 ⇒ 沒有跑, 不是通過" >&2; exit 1
  fi
}
INITDB=$(pick initdb) || exit 1
PG_CTL=$(pick pg_ctl) || exit 1
PSQL=$(pick psql)     || exit 1

D=$(mktemp -d); P="${PGPORT_PROBE:-54341}"
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
cleanup() { [ -d "$D/pg" ] && "$PG_CTL" -D "$D/pg" -w stop > /dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT INT TERM

"$INITDB" -D "$D/pg" -U postgres --no-sync -A trust > /dev/null 2>&1
"$PG_CTL" -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start > /dev/null 2>&1 \
  || { echo "起不來"; cat "$D/log"; exit 1; }
Q() { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>&1; }
# 🔴 Q() 把 stderr 併進來(要看得到 ERROR), 而那會讓 RAISE WARNING 混進【值】裡。
#    ⇒ 取值用這一支, 它把 stderr 丟掉。兩支各有用途, 不可互相取代。
QV() { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>/dev/null; }

FAILED=0
chk() { if [ "$2" = "$3" ]; then printf '  ✅ %s = %s\n' "$1" "$2"
        else printf '  🔴 %s = %s   而期望 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi }
chk_ne() { if [ "$2" != "$3" ]; then printf '  ✅ %s = %s(非 %s)\n' "$1" "$2" "$3"
           else printf '  🔴 %s = %s   而它【不該】是 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi }

# ── fixture:最小可跑的世界 ─────────────────────────────
Q -c "
CREATE SCHEMA pcm_cron;
CREATE TYPE payment_status AS ENUM ('unpaid','paid','refunded');
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.orders (id uuid PRIMARY KEY, cancelled_at timestamptz, payment_status payment_status NOT NULL DEFAULT 'paid');
CREATE TABLE public.order_pending_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  cancellation_id uuid,
  rail text NOT NULL CHECK (rail IN ('bank_transfer','cash')),
  amount_at_cancel bigint NOT NULL CHECK (amount_at_cancel > 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz, voided_at timestamptz);
CREATE UNIQUE INDEX opr_open_uq ON public.order_pending_refunds (order_id, rail)
  WHERE voided_at IS NULL AND settled_at IS NULL;
-- 替身:回傳「這張單每一軌還欠多少」
CREATE TABLE public._probe_amounts (order_id uuid, rail text, amount bigint);
-- 🔴 心跳表:少了它, 函式裡那段 INSERT 會被自己的 EXCEPTION 吞掉 ⇒ 探針對心跳【零判別力】,
--    而它照樣全綠。📌 一個被 try/catch 包住的動作, 在沒有目標的世界裡與成功長得一樣。
CREATE TABLE public.sweeper_heartbeat (
  job_name text PRIMARY KEY, last_success_at timestamptz, last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE FUNCTION public.pcm_pending_refund_amounts(p_order_id uuid)
  RETURNS TABLE (rail text, amount bigint) LANGUAGE sql STABLE AS
  \$\$ SELECT a.rail, a.amount FROM public._probe_amounts a WHERE a.order_id = p_order_id \$\$;
-- 替身:開列。🔴 R1-F12:它與【真的那支】的差, 逐條寫在這裡, 不假裝忠實:
--   · 少 SECURITY DEFINER / search_path='' ⇒ 本探針驗不到權限與 search_path 那一層
--   · 不寫 cancellation_id ⇒ 🔴 對帳單那格用 cancellation_id 當判準的錯, 本探針【結構上撞不到】
--   · ⛔ ~~多一條 WHERE a.amount > 0(真的那支沒有)~~ ⇒ **已拿掉**(codex R3-⑦):
--     🔴 替身比真函式【窄】= 一個只在探針裡成立的保護 ——
--        同一張單同時有【正額軌】與【零額軌】時, 替身只插正的而**真的那支會整張撞 CHECK 失敗**
--        ⇒ 📌 格3-5 會綠而正式庫會炸。**替身寧可比真的寬鬆一點, 也不可以比它嚴。**
--   ⇒ 📌 上面三條都是【本探針的盲區】, 不是它驗過的東西。
CREATE FUNCTION public.pcm_pending_refund_open_for(p_order_id uuid, p_overwrite_amount boolean DEFAULT true)
  RETURNS void LANGUAGE plpgsql AS \$\$
BEGIN
  IF (SELECT o.cancelled_at FROM public.orders o WHERE o.id = p_order_id) IS NULL THEN RETURN; END IF;
  INSERT INTO public.order_pending_refunds (order_id, rail, amount_at_cancel)
  SELECT p_order_id, a.rail, a.amount FROM public.pcm_pending_refund_amounts(p_order_id) AS a
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel WHERE p_overwrite_amount;
END \$\$;
-- 替身:pg_cron。🔴 它【不是】pg_cron, 只讓 migration 走得完(見檔頭「證不到什麼」)。
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text,
  nodename text DEFAULT 'localhost', nodeport int DEFAULT 5432, database text DEFAULT current_database(),
  username text DEFAULT 'postgres', active boolean DEFAULT false);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE plpgsql AS \$\$
DECLARE v bigint; BEGIN
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO v; RETURN v; END \$\$;
CREATE FUNCTION cron.alter_job(job_id bigint, active boolean) RETURNS void LANGUAGE sql AS
  \$\$ UPDATE cron.job SET active = \$2 WHERE jobid = \$1 \$\$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS
  \$\$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true \$\$;
-- 🔴 先放一支【別人的】排程 —— migration 的事後⑤ 要有比對對象, 而空的比對永遠綠
INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('pcm-someone-else', '*/5 * * * *', 'SELECT 1', true);
" > /dev/null || { echo "🔴 fixture 失敗"; Q -c "SELECT 1" ; exit 1; }

# 三張單:①已取消欠錢沒開列(該補) ②已取消欠錢【已經有開好的列】(不得重開)
#          ③【未取消】欠錢(不得碰)
Q -c "
INSERT INTO public.orders (id, cancelled_at) VALUES
  ('00000000-0000-0000-0000-000000000001', now() - interval '2 hour'),
  ('00000000-0000-0000-0000-000000000002', now() - interval '1 hour');
INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000003', NULL);
INSERT INTO public._probe_amounts VALUES
  ('00000000-0000-0000-0000-000000000001','bank_transfer',1000),
  ('00000000-0000-0000-0000-000000000002','bank_transfer',2000),
  ('00000000-0000-0000-0000-000000000003','bank_transfer',3000);
INSERT INTO public.order_pending_refunds (order_id, rail, amount_at_cancel)
  VALUES ('00000000-0000-0000-0000-000000000002','bank_transfer',999);
" > /dev/null

BEFORE=$(Q -Atc "SELECT count(*) FROM public.order_pending_refunds")
chk "格1 貼之前待退款列數" "$BEFORE" 1

# ── 正向 ───────────────────────────────────────────────
Q -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
chk "格2 貼上去 rc" "$RC" 0
[ "$RC" -ne 0 ] && grep -m2 -E '^psql:.*ERROR' "$D/apply.log" | sed 's/^/     /'

# 🔵 回傳型別在 R1 折 F1/F2 時從 integer 換成 jsonb ⇒ 取值要挑欄位, 而且要用 QV(不併 stderr)
J=$(QV -Atc "SELECT pcm_cron.late_payment_pending_refund_sweep()")
chk "格3 🟢 跑一輪補了幾張單(只有①該被補)" "$(printf '%s' "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["opened"])')" 1
chk "格3b 🔴 R1-F1:②【列在而金額少】要被【數到】(999 < 2000)" "$(printf '%s' "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["amount_short"])')" 1
chk "格4 跑完待退款列數(1 ⇒ 2)" "$(Q -Atc 'SELECT count(*) FROM public.order_pending_refunds')" 2
chk "格5 🔴 補的是【①】那張" "$(Q -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000001'")" 1
chk "格6 🔵 負對照:【未取消】那張不得被碰" "$(Q -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000003'")" 0
chk "格7 🔵 負對照:②已開好的金額【不得被覆寫】(999 不變)" "$(Q -Atc "SELECT amount_at_cancel FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000002'")" 999

# 冪等:再跑一輪不得再補
chk "格8 🔵 再跑一輪補幾張(該 0)" "$(QV -Atc "SELECT (pcm_cron.late_payment_pending_refund_sweep())->>'opened'")" 0
chk "格9 而列數不變" "$(Q -Atc 'SELECT count(*) FROM public.order_pending_refunds')" 2

# p_limit fail-safe
# 🔴🔴 R1-F5:我第一版把這一格跑在「已經沒東西可補」之後 ⇒ **有 fail-safe 回 0、
#    拿掉 fail-safe 也回 0** ⇒ 對那三行零判別力。**恆真格與守住印同一個綠。**
#    ✅ 改成:先造一張【沒補過】的單, 再用 p_limit=0 呼叫 ⇒ 期望 1(fail-safe 把 0 退回 1)。
Q -c "
INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000004', now());
INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000004','bank_transfer',4000);
" > /dev/null
chk "格10 🔴 p_limit=0 ⇒ fail-safe 退回 1 ⇒ 該補到 1 張(而不是靜默不處理)" "$(QV -Atc "SELECT (pcm_cron.late_payment_pending_refund_sweep(0))->>'opened'")" 1

# ACL
chk "格11 🔴 三個應用角色都叫不動它" "$(Q -Atc "SELECT count(*) FROM (VALUES ('anon'),('authenticated'),('service_role')) r(n) WHERE has_function_privilege(r.n,'pcm_cron.late_payment_pending_refund_sweep(integer)','EXECUTE')")" 0
chk "格12 🟢 正對照:postgres 叫得動(否則上面那個 0 是尺沒動)" "$(Q -Atc "SELECT has_function_privilege('postgres','pcm_cron.late_payment_pending_refund_sweep(integer)','EXECUTE')")" t
# 🔴 R2-②:心跳有沒有真的寫進去。沒有它, 進白名單 = 每天一封假警報。
chk "格12b 🔴 跑完之後心跳表有本支那一列" "$(QV -Atc "SELECT count(*) FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" 1
chk "格12c 🔵 而 last_success_at 不是 NULL(有列而空值 = 儀表照樣叫)" "$(QV -Atc "SELECT last_success_at IS NOT NULL FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" t
chk "格13 🔴 別人的排程沒被動到" "$(Q -Atc "SELECT count(*) FROM cron.job WHERE jobname='pcm-someone-else' AND schedule='*/5 * * * *' AND active")" 1

# ── 負向 / 突變 ────────────────────────────────────────
# 🔵 改成裸 CREATE 之後, 重貼【該紅】—— 撞名要當場叫, 那正是靜態閘要的。
Q -f "$MIG" > "$D/again.log" 2>&1; RC2=$?
chk_ne "格14 🔵 重貼(裸 CREATE ⇒ 撞名該當場紅)rc" "$RC2" 0
if grep -qiE "already exists|已經存在" "$D/again.log"; then chk "格14b 🔵 而它紅在【already exists】" yes yes
else chk "格14b 🔵 而它紅在【already exists】" no yes; grep -m1 -E '^psql:.*ERROR' "$D/again.log" | sed 's/^/     實際: /'; fi

# 🧬 格10b/10c:R1-F3 那段(失敗計數 + 回負數)—— 證它不是恆綠。
#    造一張【一定會失敗】的單:讓 open_for 對它丟例外(amount 為負 ⇒ 撞 CHECK amount > 0)。
Q -c "
INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000005', now());
INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000005','bank_transfer',-1);
" > /dev/null
# 🔵 而 amount 為負時我的掃描判準(a.amount > 0)不會選它 ⇒ 換一個真的會炸的形狀:
#    rail 值不在 CHECK 允許集合裡 ⇒ INSERT 當場丟例外, 而金額是正的所以會被選中。
Q -c "UPDATE public._probe_amounts SET rail='zzz_bad_rail', amount=500 WHERE order_id='00000000-0000-0000-0000-000000000005'" > /dev/null
# 🔵 用 QV 不用 Q —— 我第一版用 Q, 而 RAISE WARNING 的文字被併進 $RET
#    ⇒ 格10c 判成 no, 而那不是碼壞了, 是我的【取值方式】把訊號當成值。
RET=$(QV -Atc "SELECT (pcm_cron.late_payment_pending_refund_sweep())->>'failed'")
chk "格10b 🧬 有一張單必炸 ⇒ failed 要數到它(而不是靜默)" "$RET" 1
Q -c "DELETE FROM public._probe_amounts WHERE order_id='00000000-0000-0000-0000-000000000005'" > /dev/null

# 🧬 格10d/10e:R1-F2「有作廢列 ⇒ 整張跳過」擋不擋得住?會不會被數到?
Q -c "
INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000006', now());
INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000006','bank_transfer',5000);
INSERT INTO public.order_pending_refunds (order_id, rail, amount_at_cancel, voided_at)
  VALUES ('00000000-0000-0000-0000-000000000006','bank_transfer',5000, now());
" > /dev/null
J2=$(QV -Atc "SELECT pcm_cron.late_payment_pending_refund_sweep()")
chk "格10d 🧬 有作廢列的單被數成 voided_skipped" "$(printf '%s' "$J2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["voided_skipped"])')" 1
chk "格10e 🔴 而它【沒有】被重開(該單的活列數仍是 0)" "$(QV -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000006' AND voided_at IS NULL")" 0
Q -c "DELETE FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000006';
      DELETE FROM public._probe_amounts WHERE order_id='00000000-0000-0000-0000-000000000006';" > /dev/null

# 🧬 突變①:把 NOT EXISTS 那段拿掉 ⇒ 事後② 要紅
#    🔵 R1-F11:這裡原本多一行輸出丟到 /dev/null 的 sed —— 零作用的死碼,
#       而讀的人會把它當成突變之一。已刪。
# 🔴 裸 CREATE 之後, 每一發突變都要先回到【沒貼過】的世界 ——
#    否則它們會紅在 already exists, 而那【不是】我要驗的那一句。
#    📌 「它紅了」與「它紅在我要的那一句」是兩個宣稱。
reset_world() {
  Q -c "DROP FUNCTION IF EXISTS pcm_cron.late_payment_pending_refund_sweep(integer);
        DELETE FROM cron.job WHERE jobname='pcm-late-payment-sweep';" > /dev/null
}
reset_world
python3 - "$MIG" > "$D/mut1.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
s=s.replace('                         AND r.voided_at  IS NULL\n','')
sys.stdout.write(s)
PY
test -s "$D/mut1.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut1.sql" > "$D/mut1.log" 2>&1; RC3=$?
chk_ne "格15 🧬 拿掉一條未結清判準 ⇒ 貼上去 rc" "$RC3" 0
if grep -qF '事後②' "$D/mut1.log"; then chk "格15b 🧬 而它紅在【事後②】那一句" yes yes
else chk "格15b 🧬 而它紅在【事後②】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut1.log" | sed 's/^/     實際: /'; fi

# 🧬 突變②:把 false 改成 true ⇒ 事後③ 要紅(兜底會覆寫已開好的金額)
reset_world
python3 - "$MIG" > "$D/mut2.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
s=s.replace('PERFORM public.pcm_pending_refund_open_for(r_row.order_id, false);','PERFORM public.pcm_pending_refund_open_for(r_row.order_id, true);')
sys.stdout.write(s)
PY
test -s "$D/mut2.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut2.sql" > "$D/mut2.log" 2>&1; RC4=$?
chk_ne "格16 🧬 把 false 改成 true ⇒ 貼上去 rc" "$RC4" 0
if grep -qF '事後③' "$D/mut2.log"; then chk "格16b 🧬 而它紅在【事後③】那一句" yes yes
else chk "格16b 🧬 而它紅在【事後③】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut2.log" | sed 's/^/     實際: /'; fi

# 🧬 突變③:動別人的排程 ⇒ 事後⑤ 要紅
reset_world
python3 - "$MIG" > "$D/mut3.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
s=s.replace("  PERFORM cron.alter_job(job_id => v_id, active => true);",
            "  PERFORM cron.alter_job(job_id => v_id, active => true);\n  UPDATE cron.job SET schedule = '*/1 * * * *' WHERE jobname = 'pcm-someone-else';")
sys.stdout.write(s)
PY
test -s "$D/mut3.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mut3.sql" > "$D/mut3.log" 2>&1; RC5=$?
chk_ne "格17 🧬 順手改掉別人的排程 ⇒ 貼上去 rc" "$RC5" 0
if grep -qF '事後⑤' "$D/mut3.log"; then chk "格17b 🧬 而它紅在【事後⑤】那一句" yes yes
else chk "格17b 🧬 而它紅在【事後⑤】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mut3.log" | sed 's/^/     實際: /'; fi

# 🧬 格18b/18c:R6 指出的那一格 —— **把 WARNING 搬回統計趟之前**。
#    🔴 這條已經復發過一次(R4 提出、R5 抓到我宣稱修好而沒修)⇒ 它需要一個【殺得掉的突變】。
#    ⚠️ 而探針原本對它結構上零判別力:它只讀 jsonb, 而 jsonb 在更後面才組。
reset_world
python3 - "$MIG" > "$D/mutW.sql" <<'PY2'
import io,sys,re
s=io.open(sys.argv[1],encoding='utf-8').read()
# 把那一段 WARNING 整塊搬到統計趟【之前】—— 也就是還原成 R4 抓到的那個錯
m=re.search(r"\n  IF v_fail > 0 OR v_noop > 0.*?\n  END IF;\n", s, re.S)
assert m, '找不到那段 WARNING'
warn=m.group(0)
s=s.replace(warn,'\n')
k=s.index('  -- 🔴🔴 **R2-⑤:這一趟【移到寫入之後】')
s=s[:k]+warn.lstrip('\n')+'\n'+s[k:]
sys.stdout.write(s)
PY2
test -s "$D/mutW.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/mutW.sql" > "$D/mutW.log" 2>&1; RCW=$?
chk_ne "格18b 🧬 把 WARNING 搬回統計趟【之前】⇒ 貼上去 rc" "$RCW" 0
if grep -qF '事後③d' "$D/mutW.log"; then chk "格18c 🧬 而它紅在【事後③d】那一句" yes yes
else chk "格18c 🧬 而它紅在【事後③d】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/mutW.log" | sed 's/^/     實際: /'; fi

# 🔵 負對照突變:恆等改寫 ⇒ 該綠
reset_world
python3 - "$MIG" > "$D/mut0.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
sys.stdout.write(s.replace('BEGIN;','BEGIN;  -- 恆等改寫',1))
PY
Q -f "$D/mut0.sql" > "$D/mut0.log" 2>&1
chk "格18 🔵 負對照突變(恆等改寫)⇒ rc" "$?" 0

# ── 回退真的跑得動嗎 ───────────────────────────────────
if [ -f "$DOWN" ]; then
  reset_world
  Q -f "$MIG" > /dev/null 2>&1
  Q -f "$DOWN" > "$D/down.log" 2>&1; RC6=$?
  chk "格19 🧬 回退腳本跑得動 rc" "$RC6" 0
  [ "$RC6" -ne 0 ] && grep -m2 -E '^psql:.*ERROR' "$D/down.log" | sed 's/^/     /'
  chk "格20 🧬 回退後函式不見了" "$(Q -Atc "SELECT to_regprocedure('pcm_cron.late_payment_pending_refund_sweep(integer)') IS NULL")" t
  chk "格21 🧬 回退後排程不見了" "$(Q -Atc "SELECT count(*) FROM cron.job WHERE jobname='pcm-late-payment-sweep'")" 0
  chk "格22 🔵 而別人的排程還在(回退沒有多刪)" "$(Q -Atc "SELECT count(*) FROM cron.job WHERE jobname='pcm-someone-else'")" 1
else
  echo "  🔴 找不到回退腳本 $DOWN"; FAILED=$((FAILED + 1))
fi

# 🔵 R1-F10:不寫死格數 —— 我第一版寫「22 格」而實際印 25 格(含 15b/16b/17b)。
#    📌 一個沒有東西在維護的計數, 每加一格就更假一次, 而它讀起來永遠一樣有把握。
# ══ codex R3 逼出來的兩個【從來沒被走過】的世界 ═════════════════════
# 🔴 上面每一格都跑在「cron.job 裡有一支別人的排程」那個世界裡 ——
#    而那支是**探針自己種的**。⇒ 📌 空 cron.job 那條路在測試裡固定假綠。
Q -c "DROP FUNCTION IF EXISTS pcm_cron.late_payment_pending_refund_sweep(integer);
      DELETE FROM cron.job;" > /dev/null
chk "格23 前提:cron.job 現在是空的" "$(QV -Atc 'SELECT count(*) FROM cron.job')" 0
Q -f "$MIG" > "$D/empty.log" 2>&1; RC9=$?
chk "格24 🔴 R3-④ 空 cron.job 也要貼得進去(它是合法環境)" "$RC9" 0
[ "$RC9" -ne 0 ] && grep -m1 -E '^psql:.*ERROR' "$D/empty.log" | sed 's/^/     /'
chk "格25 而貼完之後只有我那一支" "$(QV -Atc 'SELECT count(*) FROM cron.job')" 1

# 🔴 R3-⑥:回退在「只有我那一支」的世界 —— 舊自證會在這裡把整份回退回滾掉
if [ -f "$DOWN" ]; then
  { echo "SET pcm.code_reverted = 'yes';"; cat "$DOWN"; } > "$D/down-solo.sql"
  Q -f "$D/down-solo.sql" > "$D/down-solo.log" 2>&1; RC10=$?
  chk "格26 🔴 R3-⑥ 只有我那一支時, 回退也要跑得完" "$RC10" 0
  [ "$RC10" -ne 0 ] && grep -m1 -E '^psql:.*ERROR' "$D/down-solo.log" | sed 's/^/     /'
  chk "格27 而回退後函式真的不見了" "$(QV -Atc "SELECT to_regprocedure('pcm_cron.late_payment_pending_refund_sweep(integer)') IS NULL")" t
  chk "格28 排程也不見了(而 cron.job 現在空的, 那是對的)" "$(QV -Atc 'SELECT count(*) FROM cron.job')" 0
fi

# 🔴 R3-③:每一張都失敗時, 心跳【不得】被刷成成功
Q -c "DELETE FROM cron.job;" > /dev/null
Q -f "$MIG" > /dev/null 2>&1
Q -c "UPDATE public.sweeper_heartbeat SET consecutive_failures = 0, last_failure_at = NULL
       WHERE job_name='pcm-late-payment-sweep';
      INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000007', now());
      INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000007','zzz_bad_rail',700);" > /dev/null
J3=$(QV -Atc "SELECT pcm_cron.late_payment_pending_refund_sweep()")
chk "格29 🧬 全失敗那一輪 failed 要數到" "$(printf '%s' "$J3" | python3 -c 'import sys,json;print(json.load(sys.stdin)["failed"])')" 1
chk "格30 🔴 R3-③ 而心跳的 consecutive_failures【不得】是 0" "$(QV -Atc "SELECT consecutive_failures FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" 1
chk "格31 🔴 而 last_failure_at 要有值(否則儀表看不到這一輪炸過)" "$(QV -Atc "SELECT last_failure_at IS NOT NULL FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" t

# ══ 🔴🔴 codex R2 ⑤:統計趟撞 statement_timeout 時, 寫入趟補好的列要【留著】═══════
#    造法:把替身 `pcm_pending_refund_amounts` 換成「**這張單已經有待退款列時才睡**」——
#    ⇒ 寫入趟(那時還沒有列)**快**、統計趟(那時已經有列了)**慢** ⇒ 只有統計趟撞得到逾時。
#    🛑 這一格若沒有那個「已經有列才睡」的條件, 寫入趟自己會先被砍掉
#       ⇒ 它量到的就不是我要驗的那一句了。
reset_world
Q -c "DELETE FROM public.order_pending_refunds; DELETE FROM public._probe_amounts;
      DELETE FROM public.orders; DELETE FROM cron.job;" > /dev/null
Q -f "$MIG" > /dev/null 2>&1
Q -c "CREATE OR REPLACE FUNCTION public.pcm_pending_refund_amounts(p_order_id uuid)
        RETURNS TABLE (rail text, amount bigint) LANGUAGE plpgsql VOLATILE AS \$f\$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.order_pending_refunds r WHERE r.order_id = p_order_id) THEN
          PERFORM pg_sleep(2);
        END IF;
        RETURN QUERY SELECT a.rail, a.amount FROM public._probe_amounts a WHERE a.order_id = p_order_id;
      END \$f\$;
      INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000008', now());
      INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000008','bank_transfer',800);" > /dev/null
# 🔴 先把心跳釘成一個【已知的成功】—— 否則「last_success_at 沒有前進」這句話沒有基準,
#    而「它沒動」與「它本來就是這個值」在讀數上長得一樣。
Q -c "INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
      VALUES ('pcm-late-payment-sweep', '2000-01-01 00:00:00+00', 0, now())
      ON CONFLICT (job_name) DO UPDATE
        SET last_success_at = '2000-01-01 00:00:00+00', last_failure_at = NULL,
            consecutive_failures = 0;" > /dev/null
J4=$(QV -Atc "SET statement_timeout = '600ms'; SELECT pcm_cron.late_payment_pending_refund_sweep()")
chk "格32 🔴 統計趟被逾時砍掉, 而【整支函式仍然回得出 json】(接住了)" \
  "$(printf '%s' "$J4" | python3 -c 'import sys,json
t=sys.stdin.read().strip()
print("json" if t.startswith("{") else "not-json")')" json
chk "格33 🔴 而三個統計數字要是 -1(沒量到, 不是 0)" \
  "$(printf '%s' "$J4" | python3 -c 'import sys,json
d=json.load(sys.stdin);print(d["scanned"], d["amount_short"], d["voided_skipped"])' 2>/dev/null)" "-1 -1 -1"
chk "格34 🔴🔴 而寫入趟補好的那一列【還在】—— 這一格就是 codex ⑤ 要的那句話" \
  "$(QV -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000008'")" 1
chk "格33b 🔴 回傳值要有自己一格 stats_cancelled(它與 failed 是兩件事)" \
  "$(printf '%s' "$J4" | python3 -c 'import sys,json
d=json.load(sys.stdin);print(d["stats_cancelled"], d["failed"])' 2>/dev/null)" "True 0"

# ══ 🔴🔴 「補得好, 而量不到」要有人知道 —— 心跳【不得】寫成功 ═══════════════════
#    這三格是本探針裡唯一問「儀表上看不看得出來」的地方。
#    🛑 少了它們, 一個統計永遠量不到的掃描器在儀表上與一個健康的**印同一個畫面**,
#       而它的驗收本來就不能用「補了幾筆」⇒ **那個畫面是它唯一的訊號。**
chk "格36 🔴 統計趟被取消 ⇒ 心跳走【失敗】那一支(consecutive_failures 不得是 0)" \
  "$(QV -Atc "SELECT consecutive_failures FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" 1
chk "格37 🔴 而 last_failure_at 要有值(儀表上那盞燈靠它)" \
  "$(QV -Atc "SELECT last_failure_at IS NOT NULL FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" t
chk "格38 🔴 而 last_success_at【不得】被推到今天(推了就等於宣告這一輪成功)" \
  "$(QV -Atc "SELECT last_success_at = '2000-01-01 00:00:00+00' FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" t

# 🧬 突變:把 `WHEN query_canceled` 那一格拿掉 ⇒ 57014 逃回 WHEN OTHERS 之外 ⇒ 整筆回滾
#    ⇒ 格34 那一列**應該消失**。它若還在, 表示上面三格量到的不是這件事。
reset_world
Q -c "DELETE FROM public.order_pending_refunds; DELETE FROM public.orders;
      DELETE FROM public._probe_amounts; DELETE FROM cron.job;" > /dev/null
python3 - "$MIG" > "$D/mut57014.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index('    WHEN query_canceled THEN')
j = s.index('    WHEN OTHERS THEN', i)
sys.stdout.write(s[:i] + s[j:])
PY
test -s "$D/mut57014.sql" || { echo "🔴 突變檔是空的"; exit 1; }
grep -q '^    WHEN query_canceled THEN' "$D/mut57014.sql" \
  && { echo "🔴 突變沒落在目標上(query_canceled 還在)⇒ 下面那格不算數"; FAILED=$((FAILED + 1)); }
Q -f "$D/mut57014.sql" > /dev/null 2>&1
Q -c "INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-000000000009', now());
      INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-000000000009','bank_transfer',900);" > /dev/null
QV -Atc "SET statement_timeout = '600ms'; SELECT pcm_cron.late_payment_pending_refund_sweep()" > /dev/null 2>&1
chk "格35 🧬 拿掉那一格之後, 補好的列【被一起回滾】(0)—— 兩個世界印不同的答案" \
  "$(QV -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-000000000009'")" 0

# 🧬 第二發突變:handler 留著, 只把心跳那一條 `OR v_stats_cancelled` 拿掉
#    ⇒ 補好的列還在(所以格34 那一族仍綠), 而**心跳會寫成功** ⇒ 格36 那一族要紅。
#    📌 兩發突變落在不同的地方, 各自殺掉不同的格 —— 這是在問「這兩族量的是不是同一件事」。
reset_world
Q -c "DELETE FROM public.order_pending_refunds; DELETE FROM public.orders;
      DELETE FROM public._probe_amounts; DELETE FROM cron.job;" > /dev/null
python3 - "$MIG" > "$D/mutHB.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
o = '    IF v_fail > 0 OR v_stats_cancelled THEN'
assert s.count(o) == 1, s.count(o)
sys.stdout.write(s.replace(o, '    IF v_fail > 0 THEN', 1))
PY
test -s "$D/mutHB.sql" || { echo "🔴 突變檔是空的"; exit 1; }
grep -q 'IF v_fail > 0 OR v_stats_cancelled THEN' "$D/mutHB.sql" \
  && { echo "🔴 突變沒落在目標上 ⇒ 下面那格不算數"; FAILED=$((FAILED + 1)); }
Q -f "$D/mutHB.sql" > /dev/null 2>&1
Q -c "UPDATE public.sweeper_heartbeat SET last_success_at='2000-01-01 00:00:00+00',
        last_failure_at=NULL, consecutive_failures=0 WHERE job_name='pcm-late-payment-sweep';
      INSERT INTO public.orders (id, cancelled_at) VALUES ('00000000-0000-0000-0000-00000000000a', now());
      INSERT INTO public._probe_amounts VALUES ('00000000-0000-0000-0000-00000000000a','bank_transfer',1000);" > /dev/null
QV -Atc "SET statement_timeout = '600ms'; SELECT pcm_cron.late_payment_pending_refund_sweep()" > /dev/null 2>&1
chk "格39 🧬 拿掉心跳那一條 ⇒ 它把這一輪寫成【成功】(last_success_at 被推走)—— 兩個世界印不同的答案" \
  "$(QV -Atc "SELECT last_success_at = '2000-01-01 00:00:00+00' FROM public.sweeper_heartbeat WHERE job_name='pcm-late-payment-sweep'")" f
chk "格39b 🟢 正對照:同一發裡補好的列仍在(證明世界造出來了, 格39 的 f 不是因為沒跑)" \
  "$(QV -Atc "SELECT count(*) FROM public.order_pending_refunds WHERE order_id='00000000-0000-0000-0000-00000000000a'")" 1

if [ "$FAILED" -eq 0 ]; then echo "🟢 全部通過(格數當場數:上面的 ✅ 行)"; exit 0; fi
echo "🔴 有 $FAILED 格不符預期 ⇒ 本探針判 FAIL"; exit 1
