#!/usr/bin/env bash
#
# L4a-1 驗證 harness:begin_charge_attempt 的 user_in_flight 帶回 in_flight_order_id。
#
#   PORT=54372 bash scripts/l4a1-verify.sh /tmp/p2-l4-work
#
# 兩層,缺一層都證不完:
#   【matrix】10 格行為矩陣 —— 對「現行定義」跑,證明它**做了什麼**。
#   【mutations】9 發突變 —— 每發改壞 per-user 閘的一條述詞,分兩軸各自斷言:
#       軸 A(結構錨判別力):把突變**連同 migration 的 assert 區**一起送 ⇒ 必須被整段錨**擋下**。
#       軸 B(矩陣判別力):把突變**不帶 assert** 直接 CREATE OR REPLACE 裝上去 ⇒ 必須**恰好只有**
#                          對應的那一格翻掉、其餘 8 格照常(控制流突變 M8 例外,見該處註解)。
#     🔴 兩軸都要跑的理由:只跑 A,證明的是「錨擋得住」但沒證明「矩陣看得見」;
#        只跑 B,證明的是「矩陣看得見」但沒證明「錨擋得住」。兩者是不同的守門,各自要有自己的突變。
#        (memory feedback_negative-test-harness-self-false-green:每條新斷言配自己的突變、且只紅它那一條。)
#
# 🔴 零留痕:每一格都在 BEGIN … ROLLBACK 內造 fixture、呼函式、斷言;突變裝上後在該格結束時
#    用原檔重裝回來。腳本結束會做一次 md5 read-back,確認定義回到本片版本。
#
# 🔴 身分閘(2026-08-09 P 窗實錘:port 寫死會讓 psql 靜默連到別窗的庫):
#    連上後必驗 data_directory = <workdir>/pgdata,不符硬停。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C

PORT="${PORT:-54372}"
WORK="${1:-}"
MIG=supabase/migrations/20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql

die() { echo "🔴 $*" >&2; exit 1; }
url() { echo "postgresql://postgres@127.0.0.1:${PORT}/postgres"; }
q()   { psql "$(url)" -v ON_ERROR_STOP=1 -qtA "$@"; }

[ -n "$WORK" ] || die "用法:PORT=<port> bash scripts/l4a1-verify.sh <workdir>"
DD="$(q -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
[ "$DD" = "$WORK/pgdata" ] \
  || die "身分閘:連到的 data_directory=${DD:-<查不到>},期望 ${WORK}/pgdata —— 拒繼續(很可能連到別的視窗的庫)"

# 🔴 不論從哪個出口離開(含 die / 中途 Ctrl-C / 軸B 裝不上去就 continue),都把定義還原成本片正版。
#    codex 關卡2 R1:原本只在 happy path 還原 ⇒ 任一發突變中途失敗就把庫留在突變或 A8c1 狀態,
#    而**下一個人跑出來的結果會看起來很正常**(這正是最難查的那種髒)。
RESTORE_ON_EXIT=1
cleanup() {
  [ "${RESTORE_ON_EXIT:-0}" = 1 ] || return 0
  { echo 'BEGIN;'; sed -n '71,202p' supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql; echo 'COMMIT;'; } \
    | psql "$(url)" -v ON_ERROR_STOP=1 -qtA >/dev/null 2>&1 || true
  if ! psql "$(url)" -v ON_ERROR_STOP=1 -qtA \
       -f supabase/migrations/20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql >/dev/null 2>&1; then
    # 🔴 收尾污染不得被 exit 0 蓋掉(codex 關卡2 R2):A8c1 還原成功但正版裝不回去時,
    #    庫會停在**舊定義**,而腳本原本仍會回 0 ⇒ 下一個人跑出來的一切都建立在錯的定義上。
    echo "⚠️ cleanup:裝不回本片正版定義,庫停在 A8c1 或突變狀態 —— 手動跑一次該 migration" >&2
    exit 1
  fi
}
trap cleanup EXIT

MATRIX_CELLS=10  # 矩陣格數(M8 的「全翻」期望值要對齊它;加格時一起改)
PASS=0; FAIL=0
ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

# ── fixture + 呼叫 + 取回 outcome ────────────────────────────────────────────
# 造:U=會員、N=本次要刷的新單(異 cart)、F*=在途單。全部在交易內、結束 ROLLBACK。
# 回一行 "reason|in_flight_order_id"(acquired:true 時 reason=ACQUIRED)。
run_cell() {
  local extra_sql="$1"
  psql "$(url)" -v ON_ERROR_STOP=1 -qtA <<SQL 2>&1
BEGIN;
CREATE TEMP TABLE _l4 (k text primary key, v uuid) ON COMMIT DROP;
INSERT INTO _l4 VALUES
  ('user',   '9a000000-0000-4000-8000-000000000001'),
  ('other',  '9a000000-0000-4000-8000-0000000000ff'),
  ('n',      '9b000000-0000-4000-8000-000000000001'),
  ('f1',     '9b000000-0000-4000-8000-000000000011'),
  ('f2',     '9b000000-0000-4000-8000-000000000012');

-- 🔴 address/invoice 直接**借**既有 seed 列的值,不自己編:orders 有 ship_addr 白名單 CHECK,
--    自編的 jsonb 會被擋。這兩欄與 per-user 閘無關 ⇒ 借值不會讓任何一格變恆真
--    (memory feedback_fixture-value-makes-guard-vacuous:要問的是「這個值會不會讓守門恆真」,
--     這兩欄不進閘的述詞 ⇒ 不會)。
CREATE OR REPLACE FUNCTION pg_temp.mk_order(p_id uuid, p_user uuid, p_disp text, p_cart uuid, p_paid boolean)
RETURNS void LANGUAGE sql AS \$\$
  INSERT INTO public.orders
    (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice, shipping_method_at_checkout,
     payment_status, cart_session_id)
  SELECT
    p_id, p_disp, p_user, o.shipping_address_snapshot, 'general'::public.member_tier,
    1000, 0, 1000, o.shipping_method, o.invoice, o.shipping_method_at_checkout,
    CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END::public.payment_status, p_cart
  FROM public.orders o ORDER BY o.created_at LIMIT 1;
\$\$;

CREATE OR REPLACE FUNCTION pg_temp.mk_attempt(p_id uuid, p_order uuid, p_user uuid, p_status text, p_age interval)
RETURNS void LANGUAGE sql AS \$\$
  INSERT INTO public.payment_charge_attempts
    (id, order_id, customer_user_id, status, fallback_token_hash, created_at, rec_trade_id)
  -- 用真的 hash 函式產 token hash:該欄有格式 CHECK,自己編的字串會被擋。
  -- status='charged' 另有 CHECK 要求 rec_trade_id NOT NULL ⇒ 只在 charged 時補一個具名 rec。
  VALUES (p_id, p_order, p_user, p_status, public.charge_attempt_token_hash(p_id), pg_catalog.now() - p_age,
          CASE WHEN p_status = 'charged' THEN 'l4t-rec-' || p_id::text END);
\$\$;

-- 🔴 造**自己的**兩個會員,不借 seed 的會員:seed 有 27 筆 attempt 掛在既有會員身上,
--    借用會讓「同會員有沒有在途 attempt」被 seed 資料污染(格1/格3/格4/格7/格8 期望「不擋」的那幾格
--    會被 seed 的在途 attempt 擋掉 ⇒ 整組矩陣量的是 seed 不是 fixture)。
-- 只插 auth.users:public.customers 由 handle_new_auth_user() trigger 自動補
-- (自己再插一次會撞主鍵;讓真實路徑跑,fixture 才與正式一致)
INSERT INTO auth.users (id, email) VALUES
  ((SELECT v FROM _l4 WHERE k='user'),  'l4t-user@example.test'),
  ((SELECT v FROM _l4 WHERE k='other'), 'l4t-other@example.test');

-- 本次要刷的新單:自己的 cart(異 cart ⇒ cart dedup 不攔、確保走到 per-user 閘)
SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='n'), (SELECT v FROM _l4 WHERE k='user'),
                        'PCM-2099-9001', 'c0000000-0000-4000-8000-00000000000c'::uuid, false);

${extra_sql}

SELECT COALESCE(r->>'reason', CASE WHEN (r->>'acquired')::boolean THEN 'ACQUIRED' END)
       || '|' || COALESCE(r->>'in_flight_order_id', '-')
  FROM (SELECT public.begin_charge_attempt((SELECT v FROM _l4 WHERE k='n')) AS r) t;
ROLLBACK;
SQL
}

expect() { # expect <格名> <期望字串> <fixture sql>
  local name="$1" want="$2" sql="$3" got
  # 🔴 `|| true`:psql 失敗時 pipefail 會讓整個命令替換非零 → set -e 靜默中止整個腳本
  #    (症狀=只印得出標題、一格都不跑)。要的是「把失敗當成該格的 got 印出來」,不是中止。
  got="$(run_cell "$sql" | tail -1 || true)"
  if [ "$got" = "$want" ]; then ok "$name → $got"; else bad "$name → 得到 [$got],期望 [$want]"; fi
}

# ── 八格 fixture(共用定義,matrix 與 mutations 都吃這一份,不各寫一份)────────
F_NONE=""
F_INFLIGHT="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '1 minute');"
F_PAID="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,true);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '1 minute');"
F_OLD="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '11 minutes');"
F_SAMEORDER="SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='n'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '1 minute');"
# 🔴 格 6:兩筆 created_at **完全相同**、attempt id 不同 —— 否則拿掉 a.id DESC 的突變會存活
#    (created_at DESC 照樣選中同一筆 ⇒ 那條 tie-breaker 等於沒被測)。期望回 attempt id 較大者的 order。
F_TIE="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f2'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9012','c0000000-0000-4000-8000-0000000000f2'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-0000000000aa',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '1 minute');
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-0000000000bb',(SELECT v FROM _l4 WHERE k='f2'),(SELECT v FROM _l4 WHERE k='user'),'pending',interval '1 minute');
UPDATE public.payment_charge_attempts SET created_at = pg_catalog.now() - interval '1 minute'
 WHERE id IN ('9c000000-0000-4000-8000-0000000000aa','9c000000-0000-4000-8000-0000000000bb');"
F_RELEASED="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'released',interval '1 minute');"
F_OTHERUSER="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='other'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='other'),'pending',interval '1 minute');"
# 🔴 格 9:failed —— 與格 7(released)分開成格。plan 原本把兩者寫在同一格,但 fixture 只造了 released
#    ⇒「誤把 failed 加進 active 集合」這個突變沒有任何一格會紅(codex 關卡2 R1)。
# 🔴 格 10(R3 換模型審查 F3):**charged-未-paid** 的在途單。
#    migration 自陳這條是「雙扣視窗」——本閘最高錢面的述詞,而原本 9 格 fixture 沒有任何一格是 charged
#    ⇒ 把 'charged' 從 status 集合刪掉的突變,當時**沒有任何一格會紅**。
F_CHARGED="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'charged',interval '1 minute');"
F_FAILED="SELECT pg_temp.mk_order((SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'PCM-2099-9011','c0000000-0000-4000-8000-0000000000f1'::uuid,false);
SELECT pg_temp.mk_attempt('9c000000-0000-4000-8000-000000000011',(SELECT v FROM _l4 WHERE k='f1'),(SELECT v FROM _l4 WHERE k='user'),'failed',interval '1 minute');"

W_ACQ='ACQUIRED|-'
W_FLIGHT_F1='user_in_flight|9b000000-0000-4000-8000-000000000011'
W_FLIGHT_F2='user_in_flight|9b000000-0000-4000-8000-000000000012'
W_LOCKED='order_locked|-'

matrix() {
  echo "== 10 格行為矩陣 =="
  expect "格1 無在途 attempt              " "$W_ACQ"        "$F_NONE"
  expect "格2 1 張在途(異單異 cart 10 分內)" "$W_FLIGHT_F1"  "$F_INFLIGHT"
  expect "格3 在途單已 paid                " "$W_ACQ"        "$F_PAID"
  expect "格4 attempt 超過 10 分鐘         " "$W_ACQ"        "$F_OLD"
  expect "格5 attempt 在本單(不是異單)    " "$W_LOCKED"     "$F_SAMEORDER"
  expect "格6 兩張同 created_at → 取 id 大 " "$W_FLIGHT_F2"  "$F_TIE"
  expect "格7 attempt 是 released          " "$W_ACQ"        "$F_RELEASED"
  expect "格8 在途 attempt 屬別的會員      " "$W_ACQ"        "$F_OTHERUSER"
  expect "格9 attempt 是 failed            " "$W_ACQ"        "$F_FAILED"
  expect "格10 charged-未-paid(雙扣視窗)  " "$W_FLIGHT_F1"  "$F_CHARGED"
}

# 把 begin 還原成 A8c1 的定義(裸裝、不帶 assert)。突變兩軸都要用:
# 本片的前置閘釘 md5=A8c1,裝過一次 L4a-1 之後 md5 就變了 ⇒ 不還原就永遠是前置閘在喊。
A8C1=supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql
install_a8c1_bare() {
  # ⚠️ 行號寫死(R3 nit F6):A8c1 若被編輯過,這段會抽錯範圍。方向是安全的
  #    —— 抽錯 ⇒ 本片 migration 的 md5 前置閘會攔下,不會靜默用錯定義。
  #    但錯誤訊息會指向「md5 不符」而不是真因 ⇒ 撞到那個錯時**先確認這兩個行號還對**。
  { echo 'BEGIN;'; sed -n '71,202p' "$A8C1"; echo 'COMMIT;'; } \
    | psql "$(url)" -v ON_ERROR_STOP=1 -qtA >/dev/null 2>&1 \
    || die "還原 A8c1 定義失敗 —— 停下(庫狀態未知)"
}

# ── 突變:perl 就地改 per-user 閘的一條述詞 ─────────────────────────────────
# 每發只動一條,且**保留選擇器**(閘還在、只是條件被改壞)——不是把整段拿掉。
mutate_sed() { # $1=突變代號 → 印出 perl 表達式
  case "$1" in
    M1) echo "s/^       AND o\.payment_status <> 'paid'::public\.payment_status\$/       AND true/m" ;;
    M2) echo "s/^       AND a\.created_at > pg_catalog\.now\(\) - interval '10 minutes'\$/       AND true/m" ;;
    M3) echo "s/^       AND a\.order_id <> p_order_id\$/       AND true/m" ;;
    M4) echo "s/^       AND a\.status IN \('pending', 'charged'\)\$/       AND a.status IN ('pending', 'charged', 'released')/m" ;;
    M5) echo "s/^     WHERE a\.customer_user_id = v_order\.customer_user_id\$/     WHERE true/m" ;;
    # 🔴 M6 不用「拿掉 tie-breaker」(codex 關卡2 R1 抓到):少了 ORDER BY 的第二鍵,PG **可能**照樣
    #    回同一筆 —— 那樣這一發是否翻格取決於執行計畫,綠了也證不了東西(不穩定的突變=沒有判別力)。
    #    改成把 tie-breaker **反向**:結果變成確定回 id 較小者 ⇒ 格 6 必定翻,且翻得可重現。
    M6) echo "s/^     ORDER BY \(a\.status = 'charged'\) DESC, a\.created_at DESC, a\.id DESC\$/     ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id ASC/m" ;;
    # 🔴 M7:plan 的格 7 原本宣稱涵蓋 released **與 failed**,但 fixture 與突變都只碰 released
    #    ⇒「誤把 failed 加進 active 集合」這個突變當時無人擋(codex 關卡2 R1)。補格 9 + 本發。
    M7) echo "s/^       AND a\.status IN \('pending', 'charged'\)\$/       AND a.status IN ('pending', 'charged', 'failed')/m" ;;
    # 🔴 M8:控制流突變 —— 述詞一字不動,只把 IF FOUND 反轉。這一發是用來證明
    #    「整段錨含到 END IF」那個修法真的有效(舊版只錨到 LIMIT 1 時它會全綠逃掉)。
    # 🔴 M9(R3 F3):拿掉 'charged' —— 這一發在加格 10 之前**無格可紅**。
    M9) echo "s/^       AND a\.status IN \('pending', 'charged'\)\$/       AND a.status IN ('pending')/m" ;;
    M8) echo "s/^  IF FOUND THEN\n    RETURN pg_catalog\.jsonb_build_object\(\n      'acquired', false, 'reason', 'user_in_flight',/  IF NOT FOUND THEN\n    RETURN pg_catalog.jsonb_build_object(\n      'acquired', false, 'reason', 'user_in_flight',/m" ;;
  esac
}
mutate_expect_cell() { # 該突變應該讓哪一格翻掉
  case "$1" in
    M1) echo "格3" ;; M2) echo "格4" ;; M3) echo "格5" ;;
    M4) echo "格7" ;; M5) echo "格8" ;; M6) echo "格6" ;; M7) echo "格9" ;;
    # M8 反轉控制流 ⇒ 每一格的結果都不再等於期望 ⇒ 簽名是「9 格全翻」,見 mutations() 內的分流。
    M8) echo "全格" ;; M9) echo "格10" ;;
  esac
}

mutations() {
  echo
  echo "== 9 發突變 × 兩軸 =="
  local m expr tmp out
  for m in M1 M2 M3 M4 M5 M6 M7 M8 M9; do
    expr="$(mutate_sed "$m")"
    tmp="$(mktemp -t l4a1mut)"
    perl -0777 -pe "$expr" "$MIG" > "$tmp"
    if cmp -s "$tmp" "$MIG"; then bad "$m 突變沒套上(perl 表達式沒命中)—— 這一發的結論全部無效"; rm -f "$tmp"; continue; fi

    # 軸 A:帶 assert 區送進去 ⇒ 整段錨必須擋下
    # 🔴 先把定義還原成 A8c1,否則**前置閘會先喊**(md5 已是 L4a-1 版)⇒ 我們就只證明了
    #    「前置閘擋得住」,完全沒證明「整段錨擋得住」—— 那是量錯東西。
    install_a8c1_bare
    if out="$(psql "$(url)" -v ON_ERROR_STOP=1 -qtA -f "$tmp" 2>&1)"; then
      bad "$m 軸A:帶 assert 的突變**沒有**被擋下 ⇒ 整段錨對這條述詞無判別力"
    else
      if echo "$out" | grep -q '整段錨出現 0 次'; then ok "$m 軸A:被整段錨擋下"; else bad "$m 軸A:被擋下但不是整段錨喊的($(echo "$out" | tail -1))"; fi
    fi
    psql "$(url)" -qtA -c 'ROLLBACK' >/dev/null 2>&1 || true

    # 軸 B:去掉 assert 區、裸裝突變函式 ⇒ 恰好只有對應那一格翻掉
    awk '/^-- ── 2\. 結構 assert/{exit} {print}' "$tmp" > "$tmp.bare"
    echo 'COMMIT;' >> "$tmp.bare"
    perl -0777 -i -pe "s/^DO \\\$\\\$\nDECLARE v text;.*?\n\\\$\\\$;\n//sm" "$tmp.bare"   # 連前置閘一起拿掉(它會擋自己)
    psql "$(url)" -v ON_ERROR_STOP=1 -qtA -f "$tmp.bare" >/dev/null 2>&1 \
      || { bad "$m 軸B:裸突變裝不上去"; rm -f "$tmp" "$tmp.bare"; continue; }

    local want_cell flipped=0 total_diff=0 line
    want_cell="$(mutate_expect_cell "$m")"
    while IFS= read -r line; do
      case "$line" in
        *"❌"*) total_diff=$((total_diff+1)); case "$line" in *"$want_cell"*) flipped=1 ;; esac ;;
      esac
    done < <(matrix 2>&1)
    if [ "$want_cell" = "全格" ]; then
      # M8(控制流反轉):要求「恰 1 格」是錯的期望,但放寬成「≥1 格」幾乎沒有判別力
      # (codex 關卡2 R2:那樣即使有八格失去判別力,這一發照樣 PASS)。
      # 反轉 IF FOUND 會讓**每一格**的結果都不再等於期望值 ⇒ 正確簽名是 **恰好 9 格全翻**。
      if [ "$total_diff" = "$MATRIX_CELLS" ]; then
        ok "$m 軸B:$MATRIX_CELLS 格全翻(控制流反轉的正確簽名)"
      else
        bad "$m 軸B:期望 $MATRIX_CELLS 格全翻,實際只翻 $total_diff 格 ⇒ 有格子對控制流反轉是盲的"
      fi
    elif [ "$flipped" = 1 ] && [ "$total_diff" = 1 ]; then
      ok "$m 軸B:恰好只有 $want_cell 翻掉"
    else
      bad "$m 軸B:期望恰 1 格($want_cell)翻掉,實際 $total_diff 格翻掉(flipped=$flipped)⇒ 該格判別力不成立"
    fi

    # 裝回本片正版(前置閘要求現定義=A8c1 ⇒ 先還原再套)
    install_a8c1_bare
    psql "$(url)" -v ON_ERROR_STOP=1 -qtA -f "$MIG" >/dev/null 2>&1 || die "$m 之後裝不回正版定義,庫已髒 —— 停下"
    rm -f "$tmp" "$tmp.bare"
  done
}

echo "== L4a-1 verify(PORT=$PORT, data_directory=$DD)=="
# 🔴 先裝本片正版再量:不能假設庫裡已經是正版(上一輪失敗/別人的殘留都會讓矩陣安靜地量到舊定義)
install_a8c1_bare
psql "$(url)" -v ON_ERROR_STOP=1 -qtA -f "$MIG" >/dev/null 2>&1 || die "裝不上本片 migration —— 先修 migration 再跑驗證"
matrix
mutations

# 🔴 收尾 read-back 改比 **完整 functiondef 的 md5**(codex 關卡2 R1:只查字串存在證不了「已還原成正版」
#    —— 帶著某個突變的定義裡那個字串照樣在)。期望值在第一次跑時由本腳本自己量、印出來給人釘。
FINAL_MD5="$(q -c "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")"
# 期望值釘死在這裡。改了 migration 就必須手動重釘:跑一次、把印出來的 md5 貼回本行。
# 忘記重釘 = false-stop(腳本紅、但庫是好的),這是安全方向;不會有假綠。
EXPECT_MD5="${EXPECT_MD5:-3cde7884d42de7d169052030c3ff82db}"
[ "$FINAL_MD5" = "$EXPECT_MD5" ] \
  || die "收尾 read-back:定義 md5=$FINAL_MD5,期望 $EXPECT_MD5。
     若你剛改過 migration ⇒ 把 EXPECT_MD5 重釘成上面那個值;
     若你沒改過 ⇒ 庫沒回到本片正版,**不要拿這次結果下結論**"
echo "收尾 read-back:md5 = $FINAL_MD5(與 EXPECT_MD5 相符)"
# 🔴 到這裡才關掉 EXIT cleanup:上面每一步都已確認庫是本片正版,
#    再讓 trap 重裝一次只會製造「重裝失敗 → 收尾把好的庫弄壞」這條新路徑。
RESTORE_ON_EXIT=0
echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
echo "✅ L4a-1 全綠(10 格矩陣 + 9 發突變 × 兩軸;$PASS 條斷言)"
