#!/usr/bin/env bash
# ============================================================
# 片 D3-c:GRANT migration 的【行為】驗證 —— 20260822120000
# ============================================================
# 🔴 它驗的是**那支 migration 自己的四道後置斷言有沒有判別力**,不是「正式庫開好了」。
#    正式庫那半要 Sean 貼過才驗得到(交件單第一行)。
# 🔴 前置 bootstrap 逐字照 scripts/d3b-void-probe.sh(同一套最小合成 schema),
#    只加「跑第三支 migration」與五個世界。
# ── 效度限制(不放寬)──
#    · 合成 schema，不是真 schema ⇒ 證的是「這支 migration 在它的前置條件下行為對」
#    · 本機 PG 的 service_role/anon/authenticated 是空殼角色，不是 Supabase 那三個真角色
set -uo pipefail
export LC_ALL=C LANG=C
W=/tmp/d3c-grant-probe; P=55763
U="postgresql://postgres@127.0.0.1:$P/postgres"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_A="$ROOT/supabase/migrations/20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql"
MIG_B="$ROOT/supabase/migrations/20260820100000_m4b_e10_d3b_void_manual_refund.sql"
MIG_C="$ROOT/supabase/migrations/20260822120000_m4b_e10_d3c_grant_void_manual_refund.sql"
q(){ psql "$U" -tAX -c "$1" 2>&1; }
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
for m in "$MIG_A" "$MIG_B" "$MIG_C"; do test -f "$m" || { echo "🔴 找不到 $m"; exit 1; }; done

pg_ctl -D $W/pg stop -m immediate >/dev/null 2>&1
rm -rf $W && mkdir -p $W/pg
initdb -D $W/pg -U postgres -E UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 1; }
pg_ctl -D $W/pg -o "-p $P -k /tmp" -l $W/log start >/dev/null 2>&1
for i in $(seq 1 30); do q "SELECT 1" >/dev/null 2>&1 && break; sleep 0.3; done
[ "$(q 'SELECT 1')" = "1" ] || { echo "🔴 PG 起不來"; tail -5 $W/log; exit 1; }

q "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
   END \$\$;" >/dev/null
q "CREATE FUNCTION public.pcm_b2_is_blank(t text) RETURNS boolean LANGUAGE sql IMMUTABLE
   SET search_path = pg_catalog AS \$fn\$ SELECT pg_catalog.btrim(pg_catalog.translate(COALESCE(t,''),
     E'\t\n\r\v\f' || U&'\00A0' || U&'\3000', '       ')) = '' \$fn\$;" >/dev/null
q "CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), total integer NOT NULL DEFAULT 5000);
   CREATE TABLE public.staff(id text PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
   CREATE TABLE public.order_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
     refund_amount integer NOT NULL, status text NOT NULL, failed_reason text);
   CREATE VIEW public.order_refund_effective_verdict AS
     SELECT id AS refund_id, 'money_moved'::text AS corrected_to FROM public.order_refunds WHERE false;
   CREATE TABLE public.order_manual_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id uuid NOT NULL REFERENCES public.orders(id), request_id uuid NOT NULL,
     rail text NOT NULL CHECK (rail IN ('bank_transfer','cash')),
     refund_amount integer NOT NULL CHECK (refund_amount > 0),
     reason text NOT NULL, actor text NOT NULL, occurred_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now());
   CREATE FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)
     RETURNS jsonb LANGUAGE sql AS \$\$ SELECT '{}'::jsonb \$\$;
   REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz) TO service_role;
   INSERT INTO public.staff(id,is_active) VALUES ('alice',true),('bob',true),('gone',false);
   INSERT INTO public.orders DEFAULT VALUES;" >/dev/null
q "CREATE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid) RETURNS bigint
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$
     SELECT o.total::bigint
          - COALESCE(
              (SELECT SUM(r.refund_amount)
                 FROM public.order_refunds r
                WHERE r.order_id = o.id
                  AND r.status IN ('processing', 'confirmed')), 0)
          - COALESCE(
              (SELECT SUM(r.refund_amount)
                 FROM public.order_refunds r
                 JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
                WHERE r.order_id = o.id
                  AND r.status = 'failed'
                  AND r.failed_reason = 'manual_failed'
                  AND v.corrected_to = 'money_moved'), 0)
          - COALESCE(
              (SELECT SUM(m.refund_amount)
                 FROM public.order_manual_refunds m
                WHERE m.order_id = o.id), 0)
       FROM public.orders o
      WHERE o.id = p_order_id \$fn\$;" >/dev/null

echo "── 套用 D3-a / D3-b(真檔)──"
for m in "$MIG_A" "$MIG_B"; do
  psql "$U" -v ON_ERROR_STOP=1 -f "$m" >$W/a.txt 2>&1 && ok "apply $(basename $m)" || { bad "apply $(basename $m)"; tail -6 $W/a.txt; }
done

SIG="public.admin_void_manual_refund(uuid,text,text)"
priv(){ q "SELECT has_function_privilege('$1','$SIG','EXECUTE')"; }
acl(){ q "SELECT coalesce(p.proacl::text,'<NULL>') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_void_manual_refund'"; }

echo
echo "── 世界0(對照組):D3-c 跑之前，service_role 必須是 false ──"
B4=$(priv service_role); echo "     開權前 service_role=$B4   ACL=$(acl)"
[ "$B4" = "f" ] && ok "開權前 = false ⇒ 這把尺兩個世界會印不同的東西" || bad "開權前就已經是 $B4 ⇒ 尺沒有判別力"

echo
echo "── 世界1:套用 D3-c ⇒ 必須成功，且 service_role 變 true ──"
if psql "$U" -v ON_ERROR_STOP=1 -f "$MIG_C" >$W/c.txt 2>&1; then ok "apply D3-c"; else bad "apply D3-c"; tail -8 $W/c.txt; fi
AF=$(priv service_role); echo "     開權後 service_role=$AF   ACL=$(acl)"
[ "$AF" = "t" ] && ok "開權後 = true" || bad "開權後仍是 $AF"
[ "$(priv anon)" = "f" ] && ok "anon 仍 false" || bad "anon 被開到了"
[ "$(priv authenticated)" = "f" ] && ok "authenticated 仍 false" || bad "authenticated 被開到了"

echo
echo "── 世界2(該紅):重跑 D3-c ⇒ 前置 P2 必須擋下(本檔不是冪等的)──"
if psql "$U" -v ON_ERROR_STOP=1 -f "$MIG_C" >$W/c2.txt 2>&1; then bad "重跑竟然成功 ⇒ P2 沒有判別力"; else
  grep -q 'D3-c 前置 P2' $W/c2.txt && ok "重跑被 P2 擋下（訊息命中）" || { bad "重跑失敗了但不是 P2 擋的"; tail -4 $W/c2.txt; }
fi

echo
echo "── 世界3(該紅):把 ACL 弄髒(先給 authenticated)再跑 ⇒ P2 必須擋 ──"
psql "$U" -q -c "REVOKE EXECUTE ON FUNCTION $SIG FROM service_role;" >/dev/null 2>&1
psql "$U" -q -c "GRANT EXECUTE ON FUNCTION $SIG TO authenticated;" >/dev/null 2>&1
if psql "$U" -v ON_ERROR_STOP=1 -f "$MIG_C" >$W/c3.txt 2>&1; then bad "ACL 被弄髒了還讓它過"; else
  grep -q 'D3-c 前置 P2' $W/c3.txt && ok "髒 ACL 被 P2 擋下" || { bad "擋了但不是 P2"; tail -4 $W/c3.txt; }
fi

echo
echo "── 世界4(該紅):繞過 P2 直接驗 A4 —— 把 ACL 復原成乾淨+authenticated 也有 ──"
psql "$U" -q -c "REVOKE EXECUTE ON FUNCTION $SIG FROM authenticated;" >/dev/null 2>&1
echo "     復原後 ACL=$(acl)"
MUT=$W/mut.sql
sed 's|^GRANT EXECUTE ON FUNCTION public.admin_void_manual_refund(uuid, text, text) TO service_role;|GRANT EXECUTE ON FUNCTION public.admin_void_manual_refund(uuid, text, text) TO service_role;\nGRANT EXECUTE ON FUNCTION public.admin_void_manual_refund(uuid, text, text) TO authenticated;|' "$MIG_C" > "$MUT"
# 🔴 突變的完整性要【斷言】不是只印（Fable R2 nit F5）——
#    GRANT 那行的字面日後一改，sed 就靜默不匹配 ⇒ 跑的是【未突變的檔】而這一格照樣「ok」。
#    世界5 已經為同一個坑加了訊息斷言，世界4 漏了同款。
N=$(grep -c 'TO authenticated;' "$MUT")
echo "     突變後 authenticated GRANT 行數（要 1）= $N"
[ "$N" = 1 ] || { bad "世界4 的 sed 突變沒生效（實得 $N）⇒ 這一格證不到 A3/A4，作廢"; }
if psql "$U" -v ON_ERROR_STOP=1 -f "$MUT" >$W/c4.txt 2>&1; then bad "多開了 authenticated 竟然過 ⇒ A3/A4 沒判別力"; else
  grep -qE 'D3-c 後置 A[34]' $W/c4.txt && ok "多開一個角色被 A3/A4 擋下" || { bad "擋了但不是 A3/A4"; tail -4 $W/c4.txt; }
fi

echo
echo "── 世界5(該紅):PUBLIC 有 EXECUTE ⇒ A2 必須擋 ──"
psql "$U" -q -c "REVOKE EXECUTE ON FUNCTION $SIG FROM authenticated, service_role; GRANT EXECUTE ON FUNCTION $SIG TO PUBLIC;" >/dev/null 2>&1
MUT2=$W/mut2.sql
# 🔴 P2 會先擋掉髒 ACL ⇒ 要單獨驗 A2，得先把 P2 整塊（含它的 DO $$ … END $$;）拿掉。
#    用 python 精準切，不用 sed 行範圍 —— 第一版用 sed 切出語法錯的檔，
#    而那一發【也是紅的】⇒ 「紅了」與「被 A2 擋下」長得一樣。所以下面加了訊息斷言。
python3 - "$MIG_C" "$MUT2" <<'PY'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index('DO $$', s.index('前置閘 P2'))
j = s.index('END $$;', i) + len('END $$;')
io.open(sys.argv[2], 'w', encoding='utf-8').write(s[:i] + s[j:])
PY
grep -c 'D3-c 前置 P2' "$MUT2" | sed 's/^/     拿掉 P2 之後 P2 訊息出現次數（要 0）= /'
# 突變後剩下的 DO 區塊要是 5（P1 + A1 + A2 + A3 + A4；只有 P2 被切掉）。
# 🔴 這一行在量【我切對了沒有】—— 切壞的檔也會讓 psql 回非 0，而那個紅證不到 A2。
grep -c '^DO \$\$' "$MUT2" | sed 's/^/     剩下的 DO 區塊數（要 5）= /'
if psql "$U" -v ON_ERROR_STOP=1 -f "$MUT2" >$W/c5.txt 2>&1; then bad "PUBLIC 有 EXECUTE 竟然過 ⇒ A2 沒判別力"; else
  grep -qE 'D3-c 後置 A[23]' $W/c5.txt && ok "PUBLIC 被 A2/A3 擋下" || { bad "擋了但不是 A2/A3"; tail -4 $W/c5.txt; }
fi

echo
pg_ctl -D $W/pg stop -m immediate >/dev/null 2>&1; rm -rf $W
echo "════ PASS=$PASS  FAIL=$FAIL ════"
[ "$FAIL" = 0 ] || exit 1
