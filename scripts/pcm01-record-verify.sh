#!/usr/bin/env bash
# ⟦b4-PCM01RECORD⟧ 驗證 —— 那道閘【真的不擋了】, 而它的鄰居【真的還在擋】。
# 🔴 判準不是「有沒有紅」—— 判準是【那一列進不進得去】與【超額時有沒有出聲】。
set -u
MIG="${1:-supabase/migrations/20260902020000_m4b_pcm01_record_not_block.sql}"

# ── --selftest:不需要 postgres, 只驗【那一發突變還咬得到】──────────────────────
#    🔴 為什麼要它:突變的 anchor 是【字面】—— 有人改了那支 migration 的那一行,
#       突變就靜靜地不再咬到任何東西, 而失敗形狀是【印 PASS】。
if [ "${1:-}" = "--selftest" ]; then
  MIG=supabase/migrations/20260902020000_m4b_pcm01_record_not_block.sql
  RC=0
  [ -f "$MIG" ] || { echo "🔴 selftest:找不到 $MIG"; exit 2; }
  A1="RAISE WARNING"
  # 🔴 **原本這裡釘 `PCM02`, 而 Sean 2026-09-02 拍 Q4 甲之後 PCM02 不再用 ERRCODE**
  #    ⇒ 這道 selftest 當場紅了, 而【那是它做對了】:它的 anchor 指到一個我剛拿掉的東西。
  #    ⇒ 📌 而值得留著的是:**一個 anchor 檢查會在【你改對了】的時候也紅** ——
  #      它答的是「世界變了」, 不是「你錯了」。⇒ 兩者要靠人分, 而它分不出來。
  #    ✅ 改釘 `PCM03`(不能 DELETE)—— 它是這支 guard 裡【唯一還該有 ERRCODE】的那一道。
  A2="ERRCODE = 'PCM03'"
  grep -qF -- "$A1" "$MIG" && echo "✅ 突變 anchor(RAISE WARNING)還在" || { echo "🔴 突變 anchor 不見了 ⇒ 那一發會靜靜地不咬任何東西"; RC=1; }
  grep -qF -- "$A2" "$MIG" && echo "✅ 鄰居 PCM03 還在(世界C 的正對照靠它)" || { echo "🔴 PCM03 不見了 ⇒ DELETE 那道被動到了"; RC=1; }
  grep -qF -- "ERRCODE = 'PCM01'" "$MIG" && { echo "🔴 PCM01 又出現了 ⇒ 這一支的意義沒了"; RC=1; } || echo "✅ PCM01 不在(那正是本支要的)"
  grep -qF -- "zzq_no_such_anchor_20260902" "$MIG" && { echo "🔴 負對照命中 ⇒ 尺壞了"; RC=1; } || echo "🟢 負對照 0"
  echo "⚠️ 射程:本 selftest 只驗【字面在不在】—— 行為要跑六個世界(不帶參數即可)"
  exit $RC
fi
D=$(mktemp -d); PORT=$((6100 + RANDOM % 200)); export LC_ALL=C
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/i.log" 2>&1 || { echo "initdb 失敗"; exit 2; }
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "pg_ctl 失敗"; tail -5 "$D/pg.log"; exit 2; }
trap 'LC_ALL=C pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
Q() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tA "$@"; }
FAILED=0

# ── 世界的骨架:只建這道 trigger 真的會讀到的東西 ──────────────────────────
Q -q <<'EOS' > /dev/null 2>&1
CREATE TABLE public.orders(id uuid PRIMARY KEY);
CREATE TABLE public.order_payments(order_id uuid NOT NULL, rail text NOT NULL, amount integer NOT NULL);
CREATE TABLE public.order_manual_refunds(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  refund_amount integer NOT NULL CHECK (refund_amount > 0),
  voided_at timestamptz);
CREATE FUNCTION public.pcm_manual_refund_rail_cap(p_order_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                    WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer','cash')),0)::bigint
       - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = p_order_id AND m.voided_at IS NULL),0)::bigint;
$$;
INSERT INTO public.orders(id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO public.order_payments(order_id, rail, amount)
  VALUES ('11111111-1111-1111-1111-111111111111','bank_transfer',1000);
EOS

apply() {
  Q -q -v ON_ERROR_STOP=1 -f "$1" > "$D/apply.log" 2>&1
  local rc=$?
  Q -q -c "DROP TRIGGER IF EXISTS t ON public.order_manual_refunds" \
      -c "CREATE TRIGGER t BEFORE INSERT OR UPDATE OR DELETE ON public.order_manual_refunds
          FOR EACH ROW EXECUTE FUNCTION public.pcm_manual_refund_rail_cap_guard()" > /dev/null 2>&1
  return $rc
}
# 🔴 **不能用 DELETE 清場** —— 這道 guard 的 PCM03 就是在擋 DELETE(世界C 正在驗它)
#    ⇒ 第一版用 DELETE ⇒ 清不掉 ⇒ 世界B 量到 -800 而不是 700, 而它看起來像【本支的 bug】
#    📌 **我的清場動作被【我正在測的那道閘】擋住了, 而失敗顯示在下一個世界的數字上。**
#    ⇒ 改用 TRUNCATE:ROW trigger 不會為 TRUNCATE 開火。
reset_rows() { Q -q -c "TRUNCATE public.order_manual_refunds" > /dev/null 2>&1; }

echo "== 世界0 - 本支 apply 得起來嗎(它自己的後置斷言會不會炸) =="
apply "$MIG"; RC=$?
[ "$RC" = 0 ] && echo "  PASS apply rc=0" || { echo "  FAIL apply rc=$RC"; tail -4 "$D/apply.log"; FAILED=1; }

ins() {  # $1 金額 ⇒ 印 OK|<sqlstate>  以及有沒有 WARNING
  psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tA <<EOS 2>&1
DO \$\$
BEGIN
  INSERT INTO public.order_manual_refunds(order_id, refund_amount)
  VALUES ('11111111-1111-1111-1111-111111111111', $1);
  RAISE NOTICE 'RESULT|OK';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'RESULT|%', SQLSTATE;
END \$\$;
EOS
}

echo "== 世界A - 超額登記(收 1000, 登記 1500)進得去嗎? =="
reset_rows; OUT=$(ins 1500)
echo "$OUT" | grep -q 'RESULT|OK' && A1=ok || { A1=no; FAILED=1; }
echo "$OUT" | grep -q '超過這張單' && A2=ok || { A2=no; FAILED=1; }
N=$(Q -c "SELECT count(*) FROM public.order_manual_refunds")
CAP=$(Q -c "SELECT public.pcm_manual_refund_rail_cap('11111111-1111-1111-1111-111111111111')")
echo "  那一列進去了嗎=$A1 · 有沒有出聲(WARNING)=$A2 · 表上列數=$N · 軌別餘裕=$CAP"
[ "$A1" = ok ] && [ "$A2" = ok ] && [ "$N" = 1 ] && [ "$CAP" = "-500" ] && echo "  PASS - 記下來了, 有出聲, 餘裕變負(畫面可據此標紅)" || { echo "  FAIL"; FAILED=1; }

echo "== 世界B - 負對照: 沒超額(登記 300)不准出聲 =="
reset_rows; OUT=$(ins 300)
echo "$OUT" | grep -q 'RESULT|OK' && B1=ok || { B1=no; FAILED=1; }
echo "$OUT" | grep -q '超過這張單' && { B2=no; FAILED=1; } || B2=ok
CAP=$(Q -c "SELECT public.pcm_manual_refund_rail_cap('11111111-1111-1111-1111-111111111111')")
echo "  進去了嗎=$B1 · 沒有亂出聲=$B2 · 餘裕=$CAP(應為正)"
[ "$B1" = ok ] && [ "$B2" = ok ] && [ "$CAP" = "700" ] && echo "  PASS - 尺不會亂開火" || { echo "  FAIL"; FAILED=1; }

echo "== 世界C - 正對照: 鄰居 PCM03(不能 DELETE)還在擋嗎? =="
reset_rows; Q -q -c "INSERT INTO public.order_manual_refunds(order_id, refund_amount)
  VALUES ('11111111-1111-1111-1111-111111111111', 100)" > /dev/null 2>&1
OUT=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tA <<'EOS' 2>&1
DO $$
BEGIN
  DELETE FROM public.order_manual_refunds;
  RAISE NOTICE 'RESULT|OK';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'RESULT|%', SQLSTATE;
END $$;
EOS
)
echo "  $(echo "$OUT" | grep RESULT | head -1)"
echo "$OUT" | grep -q 'RESULT|PCM03' && echo "  PASS - 鄰居沒被我動到" || { echo "  FAIL - PCM03 不見了"; FAILED=1; }

echo "== 世界D - Sean 拍 Q4 甲:算不出上限時也要【記得下來】, 而紅要不一樣 =="
reset_rows
# 🔵 讓 cap 函式回 NULL ⇒ 那是 PCM02 那條路
# 🔴 參數名必須是 `p_order_id` —— Postgres **不准改輸入參數名**(要 DROP 才行)
#    ⇒ 我第一版寫 `(p uuid)` ⇒ 那一發【失敗了】, 而 `2>/dev/null` 把錯誤吃掉
#    ⇒ ⇒ 結果 cap 還是原本那支 ⇒ 世界D 量到「沒有那一句紅」而看起來像本支的 bug
#    📌 又一次:**準備階段靜靜失敗, 而症狀出現在被測物身上。**
Q -q -c "CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap(p_order_id uuid) RETURNS bigint LANGUAGE sql STABLE AS \$x\$ SELECT NULL::bigint \$x\$" > "$D/capnull.log" 2>&1
grep -qi 'error' "$D/capnull.log" && { echo "  🔴 換 cap 函式失敗 ⇒ 這一格不算數"; sed -n 1,2p "$D/capnull.log"; FAILED=1; }
OUT=$(ins 400)
echo "$OUT" | grep -q 'RESULT|OK' && D1=ok || { D1=no; FAILED=1; }
echo "$OUT" | grep -q '算不出可退上限' && D2=ok || { D2=no; FAILED=1; }
# 🔴 而它【不得】同時吐超額那一句 —— 不知道上限就不該宣稱它超額
echo "$OUT" | grep -q '超過這張單' && { D3=no; FAILED=1; } || D3=ok
N=$(Q -c "SELECT count(*) FROM public.order_manual_refunds")
echo "  進得去嗎=$D1 · 有那一句不同的紅=$D2 · 沒有同時說超額=$D3 · 表上列數=$N"
[ "$D1" = ok ] && [ "$D2" = ok ] && [ "$D3" = ok ] && [ "$N" = 1 ] && echo "  PASS - 記下來了, 而紅是另一種" || echo "  FAIL"
# 還原那支 cap 函式, 免得影響後面的世界
Q -q -c "CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap(p_order_id uuid) RETURNS bigint LANGUAGE sql STABLE AS \$x\$
  SELECT COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                    WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer','cash')),0)::bigint
       - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = p_order_id AND m.voided_at IS NULL),0)::bigint;
\$x\$" > /dev/null 2>&1

echo "== 突變 - 把 WARNING 換回 EXCEPTION ⇒ 本支自己的後置斷言要擋下它 =="
python3 - "$MIG" "$D/m.sql" <<'PY2'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
old = """    RAISE WARNING
      '人工退款登記超過這張單"""
if old not in s:
    print("MUTATION-NOT-APPLIED"); sys.exit(2)
new = """    RAISE EXCEPTION
      USING ERRCODE = 'PCM01';
    RAISE WARNING
      '人工退款登記超過這張單"""
open(sys.argv[2], 'w', encoding='utf-8').write(s.replace(old, new))
PY2
[ $? = 0 ] || { echo "  突變沒咬到 ⇒ 這一發不算數"; exit 2; }
Q -q -v ON_ERROR_STOP=1 -f "$D/m.sql" > "$D/mut.log" 2>&1; RC=$?
echo "  突變 apply rc=$RC"
grep -q 'PCM01 還在擋' "$D/mut.log" && REASON=ok || REASON=no
echo "  紅的理由對不對(要看到「PCM01 還在擋」): $REASON"
[ "$RC" != 0 ] && [ "$REASON" = ok ] && echo "  PASS - 為【正確的理由】被擋下" || { echo "  FAIL"; sed -n '1,4p' "$D/mut.log"; FAILED=1; }

echo "======================================"
[ $FAILED = 0 ] && echo "全過" || echo "有紅"
exit $FAILED
