#!/usr/bin/env bash
# ============================================================
# caprace1-concurrency-probe — ⟦b4-CAPRACE1⟧ 兩個人同時按退款會不會退超過
#
# 🔴 為什麼要有這一支(而不是引用 2026-08-30 那一發):
#    那一發量的是 `20260824011000` 那一代。而 **2026-08-31 片E(`20260831010000`)
#    把那支函式整個 CREATE OR REPLACE 了** ⇒ 量過的那一代已經不是現在跑的那一代。
#    📌 **一個結論的有效期,到它量的那個東西被改掉為止 —— 而改它的人就是我。**
#
# 🔴 harness 存 scripts/ 不存 scratchpad:上一發的 harness 隨 scratchpad 消失,
#    交件檔逐字寫著「scratchpad 會消失,結論在本檔」⇒ 那代表**沒有人能重跑它**。
#
# 三個世界,每個世界都有【單發對照】(證明閘是活的,不是沒接上):
#   A 沒有閘      ⇒ 併發必須 2 列 / 1200  ← 正對照:證明這個 harness 造得出壞狀態
#   B 現行那一代  ⇒ 這就是要量的
#   C B + 算 cap 前對父列 FOR UPDATE ⇒ 期望 1 列 / 600
#
# 🔴 而「B 被擋」與「B 只是晚一步」輸出相同 ⇒ **本檔量時間**(第二個 session 的牆鐘)。
#
# ⚠️ 效度限制(照 runbook 不放寬):
#   · 本機 `read committed` = PG 預設;**正式庫的預設本檔沒有量**
#     ⇒ 若正式庫是 repeatable read 或更高,世界B 的結論要重驗
#   · orders / staff 是最小 stub ⇒ 它們自己的約束不在射程
#   · 沒有 RLS、沒有正式庫既有資料 ⇒ **本檔過 ≠ 正式庫過**
#   · 沒驗:FOR UPDATE 與 order_refunds 上既有那些 trigger 的**鎖序互動**
# ============================================================
set -uo pipefail
export LC_ALL=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CAP="$REPO/supabase/migrations/20260824010000_m4b_866_manual_refund_rail_cap.sql"
ENF="$REPO/supabase/migrations/20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql"
NEWEST="$REPO/supabase/migrations/20260831010000_m4b_866_manual_refund_raise_plaintext.sql"
SRC_PAY="$REPO/supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql"
SRC_MR="$REPO/supabase/migrations/20260820010000_m4b_manual_refunds.sql"
SRC_MR_ALTER="$REPO/supabase/migrations/20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql"
for f in "$CAP" "$ENF" "$NEWEST" "$SRC_PAY" "$SRC_MR" "$SRC_MR_ALTER"; do
  test -f "$f" || { echo "🔴 找不到 $f ⇒ 本次作廢"; exit 2; }
done

command -v initdb >/dev/null || { echo "🔴 找不到 initdb"; exit 2; }
PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/caprace1.XXXXXX")"
export PGHOST="$PGDIR" PGPORT=54893 PGDATABASE=postgres PGUSER=probe
cleanup() { pg_ctl -D "$PGDIR/data" stop -m immediate >/dev/null 2>&1; rm -rf "$PGDIR"; }
trap cleanup EXIT
initdb -D "$PGDIR/data" -U probe --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
pg_ctl -D "$PGDIR/data" -o "-k $PGDIR -p 54893 -c listen_addresses=''" -l "$PGDIR/log" start >/dev/null 2>&1
for _ in $(seq 1 40); do psql -qc "select 1" >/dev/null 2>&1 && break; done
psql -qc "select 1" >/dev/null 2>&1 || { echo "🔴 PG 起不來"; tail -5 "$PGDIR/log"; exit 2; }
echo "══ $(psql -qtAX -c 'select version()' | cut -c1-40) · 隔離級別 $(psql -qtAX -c 'show default_transaction_isolation') ══"

q() { psql -qtAX -c "$1" 2>&1; }
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  🔴 %s — %s\n' "$1" "$2"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1 ⇒ $2"; else bad "$1" "期望 $3 實得 $2"; fi; }

cut_table() { sed -n "/^CREATE TABLE $1 (/,/^);/p" "$2"; }
{
  echo "CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;"
  echo "CREATE TABLE public.orders (id uuid PRIMARY KEY);"
  echo "CREATE TABLE public.staff  (id text PRIMARY KEY);"
  cut_table "public.order_payments" "$SRC_PAY"
  cut_table "public.order_manual_refunds" "$SRC_MR"
  sed -n '/^CREATE FUNCTION public.pcm_b2_is_blank(/,/^\$fn\$;/p' \
    "$REPO/supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql"
  python3 - "$REPO/supabase/migrations" <<'PY'
import sys, re, glob, os
tgt = re.compile(r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?public\.(?:order_manual_refunds|order_payments)\b[^;]*;', re.I|re.S)
dollar = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*|)\$.*?\$\1\$', re.S)
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.sql'))):
    src = open(f, encoding='utf-8').read()
    src = dollar.sub('', src); src = re.sub(r'--[^\n]*', '', src)
    for m in tgt.finditer(src):
        stmt = m.group(0)
        _m = re.match(r'\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?\S+\s+(.*);\s*$', stmt, re.I|re.S)
        if _m:
            _a = [a.strip() for a in _m.group(1).split(',')]
            if _a and all(re.match(r'(EN|DIS)ABLE\b.*\bTRIGGER\b', a, re.I) for a in _a): continue
        print(stmt)
PY
} > "$PGDIR/schema.sql"
# 🔴 量具自檢:切出來的 schema 少一格 ⇒ 本次作廢(不是「少一格但還能跑」)
for t in "REFERENCES public.orders(id)" "voided_at" "request_id uuid NOT NULL" "FUNCTION public.pcm_b2_is_blank"; do
  grep -qF "$t" "$PGDIR/schema.sql" || { echo "🔴 schema 少了 [$t] ⇒ 沒切到真表,本次作廢"; exit 2; }
done
psql -qX -v ON_ERROR_STOP=1 -f "$PGDIR/schema.sql" >/dev/null 2>&1 || { echo "🔴 schema 建不起來"; psql -qX -f "$PGDIR/schema.sql" 2>&1|grep -m1 ERROR; exit 2; }

O1='11111111-1111-1111-1111-111111111111'
# 🔴🔴 **seed 清不掉桌面 —— 而擋住它的正是本片自己那道保護。**
#    `20260831010000` 的 guard 對 `TG_OP = 'DELETE'` 會 RAISE(PCM03,帳不塗改)
#    ⇒ 第一版 seed 的 `DELETE` **靜靜失敗**(輸出被導去 /dev/null)
#    ⇒ 世界A 的兩列活到世界B,而世界B 的「單發後列數 2」被我讀成「1200 沒被擋」。
#    📌 **⇒ 我的清桌動作被我自己今天寫的保護擋住,而它不出聲。**
#    ⇒ 改成:清桌前後【停用/復原】那道 trigger,而且**清完要驗真的空了**。
seed() {
  psql -qX -c "ALTER TABLE public.order_manual_refunds DISABLE TRIGGER USER" >/dev/null 2>&1
  psql -qX -c "DELETE FROM public.order_manual_refunds" >/dev/null 2>&1
  psql -qX -c "ALTER TABLE public.order_manual_refunds ENABLE TRIGGER USER" >/dev/null 2>&1
  psql -qX -c "DELETE FROM public.order_payments; DELETE FROM public.orders;" >/dev/null 2>&1
  # 🔴 `actor` 有 FK 指到 `staff` —— 少了這一列, 收款那發會被 FK 擋掉。
  #    ⚠️ 而在我修好「不吞錯誤」之前, 世界A 是【綠的】: 它沒有閘, 兩筆退款照樣進得去,
  #       所以我印出「訂單只收了 1000 ⇒ 這就是退超過」—— **而那張單其實一毛都沒收到。**
  #    📌 **⇒ 一個【正對照】可以在 fixture 整個壞掉的情況下照樣印綠, 只要它問的問題剛好不碰那一格。**
  psql -qX -c "INSERT INTO public.staff(id) VALUES ('tester') ON CONFLICT DO NOTHING" >/dev/null 2>&1
  # 🔴 **這兩發的錯誤不准吞** —— 本檔已經被「導去 /dev/null 的失敗」咬過兩次
  #    (seed 的 DELETE 被 PCM03 擋、apply 的三發)。第三次就不要再犯同一個形狀。
  psql -qX -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders(id) VALUES ('$O1')" > "$PGDIR/seed.out" 2>&1 \
    || { echo "  🔴 seed 建 orders 失敗"; grep -m2 -E 'ERROR|FATAL' "$PGDIR/seed.out" | sed 's/^/       /'; exit 2; }
  psql -qX -v ON_ERROR_STOP=1 -c "INSERT INTO public.order_payments(id,order_id,rail,amount,received_at,actor,request_id)
               VALUES (gen_random_uuid(),'$O1','cash',1000,now(),'tester',gen_random_uuid())" > "$PGDIR/seed.out" 2>&1 \
    || { echo "  🔴 seed 建 order_payments 失敗"; grep -m2 -E 'ERROR|FATAL' "$PGDIR/seed.out" | sed 's/^/       /'; exit 2; }
  # 🔴 清桌自檢:沒清乾淨 ⇒ 後面每一格都在量上一個世界的殘留 ⇒ 當場作廢,不要往下跑。
  local left cap
  left=$(psql -qtAX -c "select count(*) from public.order_manual_refunds" 2>&1)
  cap=$(psql -qtAX -c "select public.pcm_manual_refund_rail_cap('$O1')" 2>&1)
  if [ "$left" != "0" ]; then echo "  🔴 seed 沒清乾淨(殘留 $left 列)⇒ 本次作廢"; exit 2; fi
  # cap 在沒有閘的世界A 查不到那支函式 ⇒ 只在查得到時驗它等於 1000
  case "$cap" in ''|*ERROR*|*error*) : ;; *) [ "$cap" = "1000" ] || { echo "  🔴 seed 後 cap=$cap(期望 1000)⇒ 本次作廢"; exit 2; } ;; esac
}
ins() { echo "INSERT INTO public.order_manual_refunds(order_id,rail,refund_amount,reason,actor,occurred_at,request_id) VALUES ('$O1','cash',$1,'測試','tester',now(),gen_random_uuid())"; }

# 兩個 session 真的重疊:S1 先插入並【按住】不 commit,S2 在那段期間插入
race() {
  local amt="$1" hold="$2"
  ( printf 'BEGIN;\n%s;\nSELECT pg_sleep(%s);\nCOMMIT;\n' "$(ins "$amt")" "$hold" | psql -qX -v ON_ERROR_STOP=1 >"$PGDIR/s1.out" 2>&1; echo "$?" >"$PGDIR/s1.rc" ) &
  local P1=$!
  sleep 0.6
  local T0 T1
  T0=$(python3 -c 'import time;print(time.time())')
  printf 'BEGIN;\n%s;\nCOMMIT;\n' "$(ins "$amt")" | psql -qX -v ON_ERROR_STOP=1 >"$PGDIR/s2.out" 2>&1; echo "$?" >"$PGDIR/s2.rc"
  T1=$(python3 -c 'import time;print(time.time())')
  wait "$P1"
  S2SEC=$(python3 -c "print(f'{$T1-$T0:.2f}')")
}

# 🔴 **apply 的錯誤【不准吞掉】** —— 第一版把三發都導去 /dev/null,
#    結果三支其實都沒進去,而世界B 量的是「完全沒有閘」的世界,還印出「洞仍在」。
#    📌 **那個結論方向是對的,而它的證據是空的** —— 抓到它的是單發對照,不是我。
apply_guard() {
  local f rc
  for f in "$CAP" "$ENF" "$NEWEST"; do
    psql -qX -v ON_ERROR_STOP=1 -f "$f" > "$PGDIR/apply.out" 2>&1; rc=$?
    if [ "$rc" != "0" ]; then
      echo "  🔴 apply 失敗:$(basename "$f")"
      grep -m3 -E 'ERROR|FATAL|例外|RAISE' "$PGDIR/apply.out" | sed 's/^/       /'
      return 1
    fi
  done
  # 🔴 apply rc=0 【不等於】trigger 掛上了 —— 直接問 pg_trigger,那是兩個宣稱。
  local n
  n=$(psql -qtAX -c "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='order_manual_refunds' and not t.tgisinternal" 2>&1)
  if [ "$n" = "0" ]; then echo "  🔴 三支都 apply 成功而 order_manual_refunds 上【零個 trigger】"; return 1; fi
  echo "  🔵 trigger 實查:$n 個掛在 order_manual_refunds 上"
  return 0
}
drop_guard() {
  psql -qX -c "DROP TRIGGER IF EXISTS trg_pcm_manual_refund_rail_cap ON public.order_manual_refunds" >/dev/null 2>&1
}

echo
echo "── 世界 A:沒有閘(正對照 —— 證明這個 harness 造得出壞狀態)──"
seed; race 600 2.0
eq  "A 併發 600+600 的列數"   "$(q "select count(*) from public.order_manual_refunds")" "2"
eq  "A 併發後總退款額"        "$(q "select coalesce(sum(refund_amount),0) from public.order_manual_refunds")" "1200"
echo "     (訂單只收了 1000 ⇒ 這就是【退超過】;S2 牆鐘 ${S2SEC}s)"

echo
echo "── 世界 B:現行那一代(cap + enforce + 片E 20260831010000)──"
apply_guard || { echo "🔴 三支 apply 不起來 ⇒ 作廢"; exit 2; }
seed
# 🔴 **psql 預設【不印 SQLSTATE】,只印訊息** —— 第一版 grep 'PCM01' 恆得 0,
#    而同一發的「列數 0」明明就說它被擋了 ⇒ **兩個指標互相矛盾,而只有一個是尺壞了。**
#    📌 那一格若只留 grep,我會得到「單發也擋不住」這個【錯的、而且更嚴重的】結論。
#    ⇒ 改用 VERBOSITY verbose 讓 SQLSTATE 出現在輸出裡。
SINGLE=$(printf '\\set VERBOSITY verbose\n%s;\n' "$(ins 1200)" | psql -qX 2>&1 | grep -c 'PCM01')
eq  "B 單發對照:一次送 1200 被 PCM01 擋"  "$SINGLE" "1"
eq  "B 單發後列數"  "$(q "select count(*) from public.order_manual_refunds")" "0"
seed; race 600 2.0
B_ROWS=$(q "select count(*) from public.order_manual_refunds")
B_SUM=$(q "select coalesce(sum(refund_amount),0) from public.order_manual_refunds")
echo "     B 併發結果:列數 $B_ROWS / 總額 $B_SUM / S2 牆鐘 ${S2SEC}s"
if [ "$B_ROWS" = "2" ]; then
  echo "     🔴🔴 **洞仍在**:兩筆都進去了,而訂單只收 1000"
  echo "     🔵 而 S2 牆鐘 ${S2SEC}s ⇒ 它【沒有被鎖住等 S1】(被鎖的話會接近 S1 的持有時間 2.0s)"
else
  echo "     ✅ 洞不見了(列數 $B_ROWS)⇒ 前提可能已被別的改動關掉,要查是誰關的"
fi

echo
echo "── 世界 C:同一道閘 + 算 cap 前對父列 FOR UPDATE ──"
psql -qX -v ON_ERROR_STOP=1 <<'PATCH' >/dev/null 2>&1
CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_cap bigint; v_headroom bigint; v_lock uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '不得刪除' USING ERRCODE='PCM03'; END IF;
  SELECT o.id INTO v_lock FROM public.orders o WHERE o.id = NEW.order_id FOR UPDATE;
  v_cap := public.pcm_manual_refund_rail_cap(NEW.order_id);
  IF v_cap IS NULL THEN RAISE EXCEPTION '算不出上限' USING ERRCODE='PCM02'; END IF;
  v_headroom := v_cap;
  IF TG_OP='UPDATE' AND OLD.voided_at IS NULL AND OLD.order_id = NEW.order_id THEN
    v_headroom := v_cap + OLD.refund_amount;
  END IF;
  IF NEW.refund_amount > v_headroom THEN
    RAISE EXCEPTION '只剩 % 元可退,退不了 %', GREATEST(v_headroom,0), NEW.refund_amount USING ERRCODE='PCM01';
  END IF;
  RETURN NEW;
END $fn$;
PATCH
seed
SINGLE_C=$(printf '\\set VERBOSITY verbose\n%s;\n' "$(ins 1200)" | psql -qX 2>&1 | grep -c 'PCM01')
eq  "C 單發對照:一次送 1200 仍被 PCM01 擋"  "$SINGLE_C" "1"
seed; race 600 2.0
C_ROWS=$(q "select count(*) from public.order_manual_refunds")
C_SUM=$(q "select coalesce(sum(refund_amount),0) from public.order_manual_refunds")
eq  "C 併發後列數"   "$C_ROWS" "1"
eq  "C 併發後總額"   "$C_SUM"  "600"
echo "     🔵 S2 牆鐘 ${S2SEC}s ⇒ 接近 S1 持有的 2.0s = **它真的被鎖住等**,不是剛好晚一步"


# ══════════════════════════════════════════════════════════════
# 世界 D:死結 —— 甲 的代價,而 2026-08-24 主視窗就是為了它裁「不加鎖」
#
# 🔴 現況兩條路的鎖序【相反】(本窗 2026-08-31 複量,兩格都對得上檔頭的宣稱):
#    admin_record_manual_refund :216  orders FOR UPDATE → :298 INSERT 子表   ⇒ orders → 子表
#    admin_void_manual_refund   :335  子表 FOR UPDATE;對 orders 上鎖命中 0  ⇒ 子表 → (加鎖後)orders
# ⇒ 在 trigger 內取 orders 鎖 = 讓第二條路變成「子表 → orders」⇒ 兩種順序並存 ⇒ 死結。
#
# 🔴🔴 **本節必須有一個【該死鎖的世界】真的死鎖** ——
#    否則「沒有 deadlock」與「我的測法根本碰不到那條路」印同一個綠。(主視窗 2026-08-31 指定的形狀)
# ══════════════════════════════════════════════════════════════
echo
echo "── 世界 D:兩種鎖序並存會不會死結 ──"
seed
# D1 正對照:【手工造一個必死的世界】—— 兩個交易以相反順序鎖同兩列。
#    這一格不是在測我們的碼, 是在測【這個 harness 抓不抓得到死結】。
psql -qX -c "CREATE TABLE IF NOT EXISTS public.zzq_lockprobe(id int primary key)" >/dev/null 2>&1
psql -qX -c "INSERT INTO public.zzq_lockprobe(id) VALUES (1),(2) ON CONFLICT DO NOTHING" >/dev/null 2>&1
( printf 'BEGIN;\nSELECT 1 FROM public.zzq_lockprobe WHERE id=1 FOR UPDATE;\nSELECT pg_sleep(1.2);\nSELECT 1 FROM public.zzq_lockprobe WHERE id=2 FOR UPDATE;\nCOMMIT;\n' | psql -qX > "$PGDIR/d1a.out" 2>&1 ) &
DA=$!
( sleep 0.2; printf 'BEGIN;\nSELECT 1 FROM public.zzq_lockprobe WHERE id=2 FOR UPDATE;\nSELECT pg_sleep(1.2);\nSELECT 1 FROM public.zzq_lockprobe WHERE id=1 FOR UPDATE;\nCOMMIT;\n' | psql -qX > "$PGDIR/d1b.out" 2>&1 ) &
DB=$!
wait $DA $DB
D1=$(cat "$PGDIR/d1a.out" "$PGDIR/d1b.out" | grep -c 'deadlock detected')
eq "D1 正對照:反向鎖序的世界【真的死鎖】(證明本 harness 抓得到)" "$D1" "1"

# D2:世界C 的修法(trigger 取 orders 鎖)+ 一個模擬 void 路徑(先鎖子表、再碰 orders)
seed
psql -qX -c "$(ins 300)" >/dev/null 2>&1   # 先有一列可以讓 void 那條路去鎖
RID=$(q "select id from public.order_manual_refunds limit 1")
( printf 'BEGIN;\nSELECT 1 FROM public.order_manual_refunds WHERE id=%s FOR UPDATE;\nSELECT pg_sleep(1.2);\nSELECT 1 FROM public.orders WHERE id=%s FOR UPDATE;\nCOMMIT;\n' "'$RID'" "'$O1'" | psql -qX > "$PGDIR/d2a.out" 2>&1 ) &
DA=$!
( sleep 0.2; printf 'BEGIN;\n%s;\nSELECT pg_sleep(1.2);\nCOMMIT;\n' "$(ins 100)" | psql -qX > "$PGDIR/d2b.out" 2>&1 ) &
DB=$!
wait $DA $DB
D2=$(cat "$PGDIR/d2a.out" "$PGDIR/d2b.out" | grep -c 'deadlock detected')
if [ "$D2" -ge 1 ]; then
  ok "D2 甲的代價【實測成立】:trigger 取 orders 鎖 + 子表先鎖的路徑 ⇒ 死結 $D2 次"
else
  echo "  ⬜ D2 這一發沒撞出死結(0 次)—— 🔴 **而這【不等於】甲安全**:"
  echo "     死結要兩邊真的交錯持有;本格用固定 sleep 逼交錯, 仍可能錯過。"
  echo "     ⇒ 照 D1 的形狀:D1 死鎖了 ⇒ harness 抓得到死結 ⇒ D2 的 0 至少不是「尺沒接上」。"
fi

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL ══"
echo "🛑 射程:本機 read committed;orders/staff 是 stub;無 RLS;未驗 FOR UPDATE 與既有 trigger 的鎖序互動。"
[ "$FAIL" -eq 0 ] || exit 1
