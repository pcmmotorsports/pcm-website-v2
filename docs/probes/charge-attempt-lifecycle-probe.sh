#!/usr/bin/env bash
# ci-self-contained: yes
# charge-attempt-lifecycle-probe.sh
#
# 證人:刷卡 attempt 那一族的三支函式, 在真的 PostgreSQL 上跑起來是對的:
#   ① `record_charge_capture_state()`      (`20260820040000`) 記請款狀態, 雙鍵比對 + 冪等
#   ② `supersede_charge_attempt_for_user()`(`20260810010000`) 讓一張卡住的單被新單取代
#   ③ `charge_attempt_token_hash()`        (`20260612150000`) token → sha256 hex(算法單一真相)
#
# 🔴 **檔名叫 `lifecycle` 是刻意的**:三支共用 `payment_charge_attempts` 那張表的生命週期。
#    ⇒ CI 紅的時候人先看到的是檔名。
#
# ══ 為什麼需要它 ═════════════════════════════════════════════════════════════
# 2026-09-01 量到:全 repo 測試檔提到這三支 ⇒ **各 0 支**
#   🟢 正對照 同法找 `create_order` ⇒ 15 支 · 🔵 負對照 現造名 ⇒ 0
#
# ══ 突變打在哪 ═══════════════════════════════════════════════════════════════
#   被測段 = 那三支函式本體。突變只重建函式, base 不重跑。
#   函式從各自的 migration 切出來、不抄 —— 抄一份會漂, 而漂了之後這支 probe 仍然全綠。
#   🔴 而切法要切到【第一個 REVOKE/COMMENT 之前】, 不是找收尾符號 ——
#      那個符號在檔裡出現不只一次(雙扣那支 probe 踩過:切到了檔尾 DO 區塊的 `$$;`)。
#
# ══ 天花板 / 範圍 ════════════════════════════════════════════════════════════
# 🔴 **替身缺了什麼(產出的一部分, 不是免責)**:
#   · `payment_charge_attempts` / `orders` / `customers` 是**最小形狀**
#     ⇒ 真表的其餘 CHECK 與部分唯一索引不在 ⇒ 違反那些的情境本 probe 量不到。
#   · 🔴 **併發沒量**:②那支的價值在「兩張單搶同一個 attempt」, 而本檔是**單連線**
#     ⇒ 它的 `FOR UPDATE` / isolation guard 在真正並行下的行為**沒有被驗過**。
#   · ②那支的 isolation guard 讀 `transaction_isolation` ——
#     本檔跑在預設 `read committed` ⇒ **guard 會紅的那一側有餵**(見下), 而其他等級沒有量。
#   · ③是純函式(IMMUTABLE)⇒ 它的正確性等於「這個 sha256 是不是對的」, 本檔用**外部算出來的
#     期望值**比對, 不是拿它自己算兩次(那會恆綠)。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「一個我沒想到要餵的輸入」。
#
# 🔴🔴 **上面那份「缺了什麼」由【撞到它的人】增補, 不是由我維護。**
#   ⇒ 所以它**不是完整清單**, 是第一版的猜測 + 後來每個打中它的人補的那幾行。
#   ⚠️ **最貴的誤讀:以為沒列到的方向【已經被想過而排除了】。**
#   📌 一個人標得出自己盲區的【方向】, 標不出自己盲區的【分母】。
#   ⇒ 打中它的人請直接在上面加一行、署自己的名 —— **守住與記住是兩件事**:
#     修好一格是守住【這一種】, 寫進上面那份清單才防得了【同族的下一種】。
#
# 🔴 **而本檔的併發缺口【板上沒有落點】—— 這是量的, 2026-09-01:**
#   `docs/launch-todo.md` 只有券那一族開了列(🟢 正對照該列標題 ⇒ 1);
#   本檔這一種 ⇒ **0**(🔵 負對照現造字面 ⇒ 0 ⇒ 那把尺是活的)。
#   🛑 **⇒ 所以上面那句「不假裝這裡涵蓋了」目前【只住在這支檔裡】** ——
#     而沒有人會為了找缺口來讀一支 probe 的檔頭。
#   ⇒ 📌 **寫下來與有落點是兩件事**;這一格是後者缺席, 不是前者。
#
# 用法:bash docs/probes/charge-attempt-lifecycle-probe.sh
set -uo pipefail
export LC_ALL=C
export LANG=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
M_CAP="$REPO/supabase/migrations/20260820040000_m4b_capture_state.sql"
M_SUP="$REPO/supabase/migrations/20260810010000_m4b_lifecycle_l5a1_supersede_charge_attempt.sql"
M_TOK="$REPO/supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql"
for f in "$M_CAP" "$M_SUP" "$M_TOK"; do [ -f "$f" ] || { echo "找不到: $f"; exit 2; }; done

PORT="${PGPORT_PROBE:-55443}"
D="$(mktemp -d)"
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 40); do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && break
  sleep 0.25
done
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "🔴 起不了拋棄式 PG。log:"; cat "$D/pg.log"; exit 1; }

pq  () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
pv  () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }
pv1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAq "$@" 2>&1; }

FAIL=0; PASS=0
ok  () { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad () { FAIL=$((FAIL+1)); printf '  🔴 %s\n' "$1"; }

# ── 切檔:三支函式各自從它的 migration 切出來 ─────────────────────────────────
python3 - "$M_CAP" "$M_SUP" "$M_TOK" "$D" <<'PYEOF'
import io, sys
cap, sup, tok, d = sys.argv[1:5]

def cut(path, start_marker, stop_markers, out):
    s = io.open(path, encoding='utf-8').read()
    i = s.index(start_marker)
    ends = [s.index(m, i) for m in stop_markers if m in s[i:]]
    if not ends:
        raise SystemExit('切不到結尾: %s' % start_marker)
    j = min(ends)
    io.open(out, 'w', encoding='utf-8').write(s[i:j])
    return j - i

# 🔴 停在【第一個 REVOKE / COMMENT ON FUNCTION】之前 —— 不用收尾符號當錨。
n1 = cut(cap, 'CREATE OR REPLACE FUNCTION public.record_charge_capture_state',
         ['REVOKE ALL ON FUNCTION public.record_charge_capture_state',
          'COMMENT ON FUNCTION public.record_charge_capture_state'], d + '/cap.sql')
n2 = cut(sup, 'CREATE OR REPLACE FUNCTION public.supersede_charge_attempt_for_user',
         ['REVOKE ALL ON FUNCTION public.supersede_charge_attempt_for_user',
          'COMMENT ON FUNCTION public.supersede_charge_attempt_for_user'], d + '/sup.sql')
n3 = cut(tok, 'CREATE OR REPLACE FUNCTION public.charge_attempt_token_hash',
         ['COMMENT ON FUNCTION public.charge_attempt_token_hash',
          'REVOKE ALL ON FUNCTION public.charge_attempt_token_hash'], d + '/tok.sql')
print('cap=%d sup=%d tok=%d bytes' % (n1, n2, n3))
PYEOF

# 🔴 切法自檢:剝註解之後不得有 REVOKE/GRANT/DO(它們會把突變與 ACL 一起重置)
for f in cap sup tok; do
  sed -e 's/--.*$//' "$D/$f.sql" > "$D/$f.nc.sql"
  if grep -qE '^[[:space:]]*(REVOKE|GRANT|DO \$)' "$D/$f.nc.sql"; then
    bad "切法自檢:$f.sql 剝註解後仍含 REVOKE/GRANT/DO ⇒ 重建函式會把突變清掉"
  else
    ok "切法自檢:$f.sql 只有函式本體"
  fi
done

# ── base ─────────────────────────────────────────────────────────────────────
pq >/dev/null <<'SQL'
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded');
CREATE TABLE public.customers (user_id uuid PRIMARY KEY);
INSERT INTO public.customers VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES public.customers(user_id),
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  cancelled_at timestamptz,
  total integer NOT NULL DEFAULT 1000
);
CREATE TABLE public.payment_charge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  user_id uuid,
  status text NOT NULL DEFAULT 'pending',
  rec_trade_id text,
  token_hash text,
  capture_state text NOT NULL DEFAULT 'unknown',
  capture_state_read_at timestamptz,
  -- 🔴 這幾欄**不是憑印象寫的** —— 從 supersede 函式本體抓它實際用到的欄
  --    (含 `UPDATE … SET` 那半, 那些是裸欄名, 沒有 alias):
  --      customer_user_id, needs_manual_review, next_settle_at, order_id, released_at,
  --      released_manual_review_at, settle_attempt_count, status, superseded_at,
  --      superseded_by_order_id, superseded_reason
  -- ⚠️ 我第一版把最後那個寫成 `successor_order_id`(照參數名 `p_successor_order_id` 推的)
  --    ⇒ 函式建不起來, **而那一發同時讓【突變那一格】變成「語法錯」而不是「守門抓到」**
  --    ⇒ 📌 **一個 base 的錯, 會讓下游的突變格說出錯的話** —— 它印的是紅, 而理由是假的。
  superseded_at timestamptz,
  superseded_reason text,
  superseded_by_order_id uuid,
  customer_user_id uuid,
  needs_manual_review boolean NOT NULL DEFAULT false,
  next_settle_at timestamptz,
  released_at timestamptz,
  released_manual_review_at timestamptz,
  settle_attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_charge_attempts_capture_state_chk
    CHECK (capture_state IN ('authorized','captured','unknown'))
);
-- 🔴 `supersede` 過了值域檢查之後還會讀這張表。少了它, 那一發突變會因為
--    `relation "public.order_cancellations" does not exist` 而「行為變了」
--    ⇒ 📌 **那是一發假的突變殺**:它證明的是「替身缺一張表」, 不是「守門被拿掉了」。
--    而它印的 ✅ 與真的殺掉長得一模一樣。
CREATE TABLE public.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id)
);
SQL
ok "base 建好"

for f in tok cap sup; do
  pq -f "$D/$f.sql" >/dev/null 2>"$D/$f.err" || { bad "$f 建不起來:$(head -2 "$D/$f.err" | tr '\n' ' ')"; }
done
ok "三支函式從各自的 migration 切出來並建起來了"

cell () {  # cell <說明> <期望字串> <SQL>
  local desc="$1" want="$2" sql="$3" got
  got="$(pv -c "$sql")"
  case "$got" in *"$want"*) ok "$desc  ⇒ $(printf '%s' "$got" | head -1)" ;;
                 *)         bad "$desc  期望含【$want】而實得:$(printf '%s' "$got" | head -1)" ;;
  esac
}

echo ""
echo "── ③ token hash:算法單一真相 ──────────────────────────────────────────────"
# 🔴 期望值用【外部算的】—— 拿函式自己算兩次會恆綠。
# 🔴🔴 **`shasum` 是 macOS 的, Linux runner 上的是 `sha256sum`** ——
#    而本檔標了 `ci-self-contained: yes` ⇒ **CI 會跑它**, 而那是 ubuntu runner。
#    ⇒ 📌 我「連跑兩發逐行相同」證的是**本機**, 而本機與 runner 是**兩個分母**。
#      (主視窗 2026-09-01 指出這一格 ⇒ 我去掃了才發現:既有那三支 CI probe **一支都沒用 shasum**,
#       只有我這支用了 ⇒ **我是那個把它帶進來的人。**)
#    ✅ 用 `python3` 算 —— 它三支 probe 本來就在用(切檔那段), 不多一個依賴。
#    🛑 而**不寫成 `command -v shasum || sha256sum`** 那種 fallback:
#       兩條路會有兩種行為, 而只有一條會在 CI 上被跑到 ⇒ 另一條的錯永遠不會被發現。
sha256hex () { python3 -c 'import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())' "$1"; }
TOKEN=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
TOKEN2=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef
EXPECT="$(sha256hex "$TOKEN")"
cell "sha256(uuid canonical text) 對得上外部算的" "$EXPECT" "select public.charge_attempt_token_hash('$TOKEN')"
cell "🔵 不同 token ⇒ 不同 hash" "$(sha256hex "$TOKEN2")" \
  "select public.charge_attempt_token_hash('$TOKEN2')"

echo ""
echo "── ① record_charge_capture_state:雙鍵 + 值域 + 冪等 ───────────────────────"
O1="$(pv1 -c "insert into public.orders (customer_user_id) values ('11111111-1111-1111-1111-111111111111') returning id")"
A1="$(pv1 -c "insert into public.payment_charge_attempts (order_id) values ('$O1') returning id")"
cell "🔵 值域外的 capture_state ⇒ 拒" '值域只收 authorized|captured' \
  "select public.record_charge_capture_state('$A1','$O1','zzqbogus')"
cell "記 captured ⇒ true" 't' "select public.record_charge_capture_state('$A1','$O1','captured')"
cell "🟢 而它真的寫進去了" 'captured' "select capture_state from public.payment_charge_attempts where id='$A1'"
cell "同值重送 ⇒ 冪等回 true(不是 false)" 't' "select public.record_charge_capture_state('$A1','$O1','captured')"
cell "🔵 雙鍵不符(order_id 換一張)⇒ false" 'f' \
  "select public.record_charge_capture_state('$A1','$(pv1 -c "insert into public.orders (customer_user_id) values ('11111111-1111-1111-1111-111111111111') returning id")','captured')"
cell "🔵 attempt 查無 ⇒ false" 'f' \
  "select public.record_charge_capture_state('99999999-9999-9999-9999-999999999999','$O1','captured')"

echo ""
echo "── ② supersede_charge_attempt_for_user ───────────────────────────────────"
O2="$(pv1 -c "insert into public.orders (customer_user_id) values ('11111111-1111-1111-1111-111111111111') returning id")"
O3="$(pv1 -c "insert into public.orders (customer_user_id) values ('11111111-1111-1111-1111-111111111111') returning id")"
cell "🔵 p_reason 值域錯 ⇒ 拒" 'p_reason 值域錯誤' \
  "select public.supersede_charge_attempt_for_user('$O2','11111111-1111-1111-1111-111111111111','zzqbogus','$O3')"
cell "🔵 訂單查無 ⇒ order_not_found" 'order_not_found' \
  "select public.supersede_charge_attempt_for_user('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','record_not_found','$O3')"
cell "🔵 訂單不屬於這個人 ⇒ order_owner_mismatch" 'order_owner_mismatch' \
  "select public.supersede_charge_attempt_for_user('$O2','22222222-2222-2222-2222-222222222222','record_not_found','$O3')"
pq >/dev/null -c "update public.orders set payment_status='paid' where id='$O2'"
cell "🔵 已付款的單 ⇒ order_not_unpaid" 'order_not_unpaid' \
  "select public.supersede_charge_attempt_for_user('$O2','11111111-1111-1111-1111-111111111111','record_not_found','$O3')"
pq >/dev/null -c "update public.orders set payment_status='unpaid' where id='$O2'"

echo ""
echo "── 🔴🔴 突變:打在【函式本體】上, base 不重跑 ─────────────────────────────"
mutate () {  # mutate <說明> <檔> <sed> <SQL> <變之前會出現的字串>
  local desc="$1" f="$2" expr="$3" sql="$4" nowant="$5" got
  sed "$expr" "$D/$f.sql" > "$D/mut.sql"
  if cmp -s "$D/$f.sql" "$D/mut.sql"; then
    bad "突變【$desc】沒有改到任何東西 ⇒ 這一發沒有判別力(anchor 錯了)"; return
  fi
  pq -f "$D/mut.sql" >/dev/null 2>&1 || bad "突變【$desc】讓函式建不起來 ⇒ 那是語法錯, 不是守門抓到"
  got="$(pv -c "$sql")"
  case "$got" in *"$nowant"*) bad "突變【$desc】之後行為沒變(仍含 $nowant)⇒ 那一格是恆綠的" ;;
                 *)           ok "突變【$desc】⇒ 行為變了($(printf '%s' "$got" | head -1))" ;;
  esac
  pq -f "$D/$f.sql" >/dev/null 2>&1
}

mutate "把 capture_state 的值域檢查改成恆假" cap \
  "s/NOT IN ('authorized', 'captured')/IN ('zzq_never')/" \
  "select public.record_charge_capture_state('$A1','$O1','zzqbogus')" '值域只收'

mutate "把 supersede 的 p_reason 值域檢查改成恆假" sup \
  "s/p_reason NOT IN ('record_not_found', 'stuck_pending')/false/" \
  "select public.supersede_charge_attempt_for_user('$O2','11111111-1111-1111-1111-111111111111','zzqbogus','$O3')" \
  'p_reason 值域錯誤'

echo ""
echo "── 🟢 還原驗證 ───────────────────────────────────────────────────────────"
cell "還原後 值域檢查仍在" '值域只收 authorized|captured' \
  "select public.record_charge_capture_state('$A1','$O1','zzqbogus')"
cell "還原後 token hash 仍對得上" "$EXPECT" "select public.charge_attempt_token_hash('$TOKEN')"

echo ""
printf '════ 結果:%s 綠 / %s 紅 ════\n' "$PASS" "$FAIL"
[ "$FAIL" != "0" ] && exit 1
exit 0
