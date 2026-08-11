#!/bin/bash
# ============================================================
# L5b-1 verify(v5 兩表版):payment_refunds(父,insert-only)+ payment_refund_events(append-only 子)
#
# 用法:scripts/l5b1-verify.sh   (自建拋棄式 cluster、跑完自動 teardown;不碰任何正式庫)
# 真權威:docs/specs/2026-08-10-l5b-compensation-refund-plan.md + 本片 migration 檔頭
#
# 🔴 本輪(v5)的四條紀律(前兩版各被三線審查抓過,逐條改進):
#   ① **每條約束各配一發獨立突變**(v3 只有 5 發、三條 CHECK 零覆蓋 ⇒ 檔頭宣稱為假)
#   ② 🔴 **每發突變之後重跑「全矩陣」並比對每一格的精確結果**
#      —— v4 只比「哪些格變了」:目標格從『正確的錯誤』翻成『另一個無關的 ERR』照樣算過
#      (核心機制自身的洞,codex 線抓到)。v5 改成期望快照逐字元相等。
#   ③ append-only 負測**以 owner 身分**跑 —— 唯一寫入者是 SECDEF RPC(owner),
#      拿非 owner 測會被 ACL/RLS 擋 ⇒ 那是恆真的假綠,證不到 append-only。
#   ④ 🔴 **突變要隔離到單一守門**:v4 的 TRUNCATE 突變同時停父子兩支,只證得到「至少一支有效」;
#      v5 只停子表那支(見 MUT-ao-truncate-child 的註解)。
#
# 🔴 psql 預設不印 SQLSTATE ⇒ 全程 -v VERBOSITY=verbose(否則比 P5B01 恆假)。
# ============================================================
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(mktemp -d /tmp/l5b1.XXXXXXXX)" || { echo "REFUSE: mktemp 失敗"; exit 1; }
chmod 700 "$ROOT" || { echo "REFUSE: chmod 700 失敗"; exit 1; }
case "$ROOT" in /tmp/l5b1.????????) : ;; *) echo "REFUSE: 非預期路徑 [$ROOT]"; exit 1 ;; esac
D="$ROOT/pgdata"; SOCK="$ROOT/sock"; P=54433
PASS=0; FAIL=0; LABELS=""
ok()  { PASS=$((PASS+1)); LABELS="$LABELS $1"; printf '  PASS %-22s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); LABELS="$LABELS $1"; printf '  FAIL %-22s %s\n' "$1" "$2"; }
PMPID=""
teardown() {
  TD_RC=$?
  [ -z "$PMPID" ] && [ -f "$D/postmaster.pid" ] && PMPID="$(head -1 "$D/postmaster.pid" 2>/dev/null)"
  if [ -n "$PMPID" ]; then
    kill -0 "$PMPID" 2>/dev/null && { pg_ctl -D "$D" -w stop >/dev/null 2>&1 || echo "🔴 TEARDOWN_WARN"; }
    kill -0 "$PMPID" 2>/dev/null && { echo "🔴 postmaster 仍活 ⇒ 保留 $ROOT"; [ "$TD_RC" -eq 0 ] && exit 9 || exit "$TD_RC"; }
  fi
  rm -rf "$ROOT"
  [ -e "$ROOT" ] && { echo "🔴 rm 後 $ROOT 仍在"; [ "$TD_RC" -eq 0 ] && exit 9 || exit "$TD_RC"; }
  echo "  teardown:postmaster 已停、$ROOT 已收(皆實測)"
}
trap teardown EXIT
mkdir -p "$SOCK" "$D"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1 || { echo INITDB_FAIL; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 || { echo START_FAIL; cat "$D/log"; exit 1; }
PMPID="$(head -1 "$D/postmaster.pid")"; [ -n "$PMPID" ] || { echo "🔴 無 PID"; exit 1; }
die() { echo "🔴 $1"; exit 1; }
PSQL() { psql -X -h "$SOCK" -p "$P" -U postgres -d postgres "$@"; }
Q() { local o; o="$(PSQL -v ON_ERROR_STOP=1 -qtA -c "$1" 2>"$SOCK/e")" || die "psql 失敗:$1 :: $(tr -d '\n' <"$SOCK/e")"; printf '%s' "$o" | tr -d '\n'; }

PREFIX_TS="20260810140000"
# ⚠️⚠️ **這道版本柵欄目前正在替本檔擋一顆地雷,動它之前先讀這段**(2026-08-11 L5b-2 片 2c 順掃發現):
#   本檔約 15 處 fixture 把 `strong_key` 寫成 `'r'` / `'rec-1'` 這種**無前綴**字面。
#   `20260811080000`(L5b-2 片 2c)給 `payment_refunds.strong_key` 加了值域 CHECK
#   `pr_strong_key_domain_chk`(`^(rec|bank):…`)⇒ 那 15 處**全部會被 23514 拒掉**。
#   現在沒事的**唯一**理由是:上面那行柵欄讓本檔只套用到 `20260810140000` 為止,080000 從未進到這個庫。
#   🔴 那是**時點事實不是不變量** —— 誰把 `PREFIX_TS` 往後推過 080000,本檔會整批爆,
#   而且症狀會長成「一堆負測紅在 `pr_strong_key_domain_chk` 而不是它們各自要測的那條」
#   (更糟的是只比 SQLSTATE 的格會**因為錯的理由變綠**)。
#   ⇒ 推柵欄的人請同批把那些字面改成 `bank:`+值(op6a 已照此修,理由見該檔 mk_refund 註解)。
MIG="$REPO/supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql"
[ -f "$MIG" ] || die "MIG_MISSING"
cd "$REPO" || die CD_FAIL
PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die SHIM_FAIL
FIRST_FIT="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  # 🔴 跳過的兩支都**只做 pg_cron 排程**,而拋棄式 cluster 沒有 pg_cron 擴充(兩支自己就會
  #    RAISE「pg_cron 未啟用,拒繼續」而中止建庫)。它們零 schema 面、與本片兩張表零交集
  #    ⇒ 跳過不影響本片任何斷言。20260723120000=M-3 S2 sweeper 排程;
  #    20260809170000=M-4b L3b expire-unpaid 排程(該檔 :9 自己就寫明「隔離環境跳過它」)。
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] && continue; [ "$TS" = "$PREFIX_TS" ] && continue
  [ "$f" = "$FIRST_FIT" ] && { PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die FITBOOT_FAIL; }
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT count(*)::text FROM pg_class WHERE oid='public.payment_charge_attempts'::regclass")" = "1" ] \
  || die "UPSTREAM_MISSING: payment_charge_attempts 不在"
echo "== L5b-1 verify v5(port=$P)=="
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>"$D/err" || die "APPLY_FAIL: $(cat "$D/err")"

U='7e000000-0000-4000-8000-000000000001'
O1='7f000000-0000-4000-8000-000000000001'; O2='7f000000-0000-4000-8000-000000000002'
A1='7d000000-0000-4000-8000-000000000001'; A2='7d000000-0000-4000-8000-000000000002'
R1='7c000000-0000-4000-8000-000000000001'; R2='7c000000-0000-4000-8000-000000000002'
# 🔴 第二張 order + 第二個 attempt:跨 attempt 的重試鏈負測需要它,而 payment_charge_attempts
#    有 per-order partial UNIQUE `payment_charge_attempts_order_lock_idx`。
#    **最後一支改它的是 R1a1 20260624120000:62-64**(DROP → CREATE 同名),述詞
#    `WHERE status IN ('pending','charged','released')`(原始片 20260612150000:102 的舊述詞
#    只有 pending,charged —— 讀舊版會低估這道索引的覆蓋面)。
#    ⇒ 兩個 pending attempt 必須掛在**不同 order** 上,否則撞的是那道索引、不是本片的守門。
FIX="
INSERT INTO auth.users (id,email) VALUES ('$U','l5b1@example.test');
INSERT INTO public.orders (id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,
  subtotal,shipping_fee,total,shipping_method,invoice,cart_session_id,payment_status)
VALUES ('$O1','PCM-2099-7001','$U',jsonb_build_object('name','l5b1','phone','0900000000','line','x'),
  'general'::public.member_tier,100,0,100,'store',jsonb_build_object('type','personal'),gen_random_uuid(),'unpaid'),
       ('$O2','PCM-2099-7002','$U',jsonb_build_object('name','l5b1','phone','0900000000','line','x'),
  'general'::public.member_tier,100,0,100,'store',jsonb_build_object('type','personal'),gen_random_uuid(),'unpaid');
INSERT INTO public.payment_charge_attempts (id,order_id,customer_user_id,status,fallback_token_hash)
VALUES ('$A1','$O1','$U','pending',public.charge_attempt_token_hash('$A1')),
       ('$A2','$O2','$U','pending',public.charge_attempt_token_hash('$A2'));
"
RF="INSERT INTO public.payment_refunds (id,attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('%s','%s','%s',100,'TWD','rec-1',3);"
run() { # run <sql> → OK / UNIQ:x / CHECK:x / FK:x / P5B01 / P5B02 / DENIED / ERR:...
  local out; out="$(PSQL -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA <<SQL 2>&1
BEGIN;
$FIX
$1
ROLLBACK;
SQL
)" && { printf 'OK'; return; }
  case "$out" in
    *'P5B01'*) printf 'P5B01' ;;
    *'P5B02'*) printf 'P5B02' ;;
    *'violates foreign key constraint'*) printf 'FK:%s' "$(printf '%s' "$out" | sed -n 's/.*foreign key constraint "\([^"]*\)".*/\1/p'|head -1)" ;;
    *'violates unique constraint'*|*'duplicate key'*) printf 'UNIQ:%s' "$(printf '%s' "$out" | sed -n 's/.*unique constraint "\([^"]*\)".*/\1/p'|head -1)" ;;
    *'violates check constraint'*) printf 'CHECK:%s' "$(printf '%s' "$out" | sed -n 's/.*check constraint "\([^"]*\)".*/\1/p'|head -1)" ;;
    *'violates not-null constraint'*) printf 'NOTNULL:%s' "$(printf '%s' "$out" | sed -n 's/.*column "\([^"]*\)".*/\1/p'|head -1)" ;;
    *'permission denied'*) printf 'DENIED' ;;
    *) printf 'ERR:%s' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-70)" ;;
  esac
}
# ── 全矩陣:名稱|期望|SQL(每發突變後整份重跑,比對**精確結果**、不只比「哪些格變了」)──────
MATRIX_N=(); MATRIX_W=(); MATRIX_S=()
add() { MATRIX_N+=("$1"); MATRIX_W+=("$2"); MATRIX_S+=("$3"); }
add G-HAPPY            OK                       "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',1,3),('$R1','result_success',2,3);"
add G-RETRY-CHAIN      OK                       "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refunds (id,attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$R2','$A1','$R1','k2',100,'TWD','rec-1',4);"
# 🔴 合法建鏈**在已實測形狀下**不被誤擋的證據:多列 VALUES、後列指前列。
#    ⚠️ 本格只涵蓋這個形狀 + 單列 INSERT;`INSERT … SELECT` / data-modifying CTE 的列處理順序
#    PG 不保證 ⇒ 那些形狀可能被誤擋(fail-closed),本 harness **沒有**為它們背書。
add G-CHAIN-SAME-STMT  OK                       "INSERT INTO public.payment_refunds (id,attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$R1','$A1',NULL,'k1',100,'TWD','r',3),('$R2','$A1','$R1','k2',100,'TWD','r',3);"
# 🔴 頭號宣稱(無環)的負測:同一 statement 兩列互指 —— v4 只靠 FK 時**這格是 OK**(環寫得進去)
add G-NO-CYCLE         P5B02                    "INSERT INTO public.payment_refunds (id,attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$R1','$A1','$R2','k1',100,'TWD','r',3),('$R2','$A1','$R1','k2',100,'TWD','r',3);"
add G-KEY-UNIQUE       UNIQ:pr_idem_key_uniq    "$(printf "$RF" "$R1" "$A1" k1) $(printf "$RF" "$R2" "$A1" k1)"
add G-CHAIN-NOFORK     UNIQ:pr_supersedes_uniq  "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refunds (attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','$R1','k2',100,'TWD','r',3),('$A1','$R1','k3',100,'TWD','r',3);"
# 懸空前手:防環守門先攔(它嚴格蘊含 FK 的存在性那半)⇒ 期望 P5B02、**不是** FK
add G-SUPERSEDES-DANGLING P5B02                 "INSERT INTO public.payment_refunds (attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','$R2','k1',100,'TWD','r',3);"
# 🔴 複合 FK 專屬負測:前手存在且可見(守門放行),但屬於別的 attempt ⇒ 只有複合 FK 擋得到
add G-CROSS-ATTEMPT    FK:pr_supersedes_same_attempt_fkey "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refunds (attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A2','$R1','k2',100,'TWD','r',3);"
# 自環:被防環守門嚴格蘊含 ⇒ 基線期望 P5B02;CHECK 那層的判別力靠 MUT-no-cycle / MUT-not-self 分層證
add G-NO-SELF          P5B02                    "INSERT INTO public.payment_refunds (id,attempt_id,supersedes_refund_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$R1','$A1','$R1','k1',100,'TWD','r',3);"
add G-AMOUNT-POS       CHECK:pr_amount_positive_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','k1',0,'TWD','r',3);"
add G-CURRENCY         CHECK:pr_currency_domain_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','k1',100,'USD','r',3);"
add G-LEASE-NONNEG     CHECK:pr_lease_token_nonneg_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','k1',100,'TWD','r',-1);"
add G-STRONGKEY-REQ    NOTNULL:strong_key       "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,lease_token) VALUES ('$A1','k1',100,'TWD',3);"
# 🔴 NOT NULL 擋不掉空白:純空白 strong_key / 空字串冪等鍵仍會進退款路徑
add G-STRONGKEY-BLANK  CHECK:pr_strong_key_nonblank_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','k1',100,'TWD','   ',3);"
add G-IDEM-BLANK       CHECK:pr_idem_key_shape_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','',100,'TWD','r',3);"
# 🔴 idempotency_key = TapPay bank_refund_id ⇒ 36 字 UUID 與非法字元都必須進不了 write-ahead 列
#    (不擋的話:DB 收得下、adapter pre-flight 一定拒送 ⇒ 一列「已宣告意圖、從未送出」的殭屍)
add G-IDEM-UUID        CHECK:pr_idem_key_shape_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','7c000000-0000-4000-8000-000000000009',100,'TWD','r',3);"
add G-IDEM-BADCHAR     CHECK:pr_idem_key_shape_chk "INSERT INTO public.payment_refunds (attempt_id,idempotency_key,amount,currency,strong_key,lease_token) VALUES ('$A1','k1 k2',100,'TWD','r',3);"
add G-TERMINAL-ONCE    UNIQ:pre_one_terminal_uniq "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','result_success',1,3),('$R1','result_failed',2,3);"
add G-SEQ-UNIQUE       UNIQ:pre_refund_seq_uniq "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',1,3),('$R1','reconcile',1,3);"
add G-EVENT-TYPE       CHECK:pre_event_type_chk "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','bogus',1,3);"
add G-EVENT-SEQ-POS    CHECK:pre_seq_positive_chk "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',0,3);"
add G-EVENT-LEASE      CHECK:pre_lease_token_nonneg_chk "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',1,-1);"
add AO-PARENT-UPDATE   P5B01 "$(printf "$RF" "$R1" "$A1" k1) UPDATE public.payment_refunds SET amount=999;"
add AO-PARENT-DELETE   P5B01 "$(printf "$RF" "$R1" "$A1" k1) DELETE FROM public.payment_refunds;"
add AO-PARENT-TRUNCATE P5B01 "TRUNCATE public.payment_refunds CASCADE;"
add AO-EVENT-UPDATE    P5B01 "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',1,3); UPDATE public.payment_refund_events SET seq=9;"
add AO-EVENT-DELETE    P5B01 "$(printf "$RF" "$R1" "$A1" k1) INSERT INTO public.payment_refund_events (refund_id,event_type,seq,lease_token) VALUES ('$R1','sent',1,3); DELETE FROM public.payment_refund_events;"
add AO-EVENT-TRUNCATE  P5B01 "TRUNCATE public.payment_refund_events;"

cell()   { printf '%s' "$1" | tr ';' '\n' | sed -n "s/^$2=//p"; }
matrix() { local i out=";"; for i in "${!MATRIX_N[@]}"; do out="$out${MATRIX_N[$i]}=$(run "${MATRIX_S[$i]}");"; done; printf '%s' "$out"; }
echo "-- 全矩陣(${#MATRIX_N[@]} 格)--"
BASE="$(matrix)"
for i in "${!MATRIX_N[@]}"; do
  g="$(cell "$BASE" "${MATRIX_N[$i]}")"
  [ "$g" = "${MATRIX_W[$i]}" ] && ok "${MATRIX_N[$i]}" "→ $g" || bad "${MATRIX_N[$i]}" "得到 [$g],期望 [${MATRIX_W[$i]}]"
done

# ── 突變:每發拿掉一條,**重跑全矩陣**,比對**每一格的精確結果** ────────────────────
# 🔴 前版只比「哪些格變了」:目標格從『正確的錯誤』翻成『另一個無關的 ERR』照樣算過
#    ⇒ 核心機制自身的洞(三線審查抓到)。本版改成:期望快照 = 基線快照套上明列的覆蓋,
#    整份逐字元相等才算過。覆蓋寫錯格名 ⇒ BADCELL 直接 FAIL(不會靜默變成恆真)。
echo "-- 突變(每發重跑全矩陣、比對精確結果)--"
expected() { # <"CELL=RESULT ..."> → 完整期望快照;覆蓋名不在矩陣內回非零
  local exp="$BASE" kv n r
  for kv in $1; do
    n="${kv%%=*}"; r="${kv#*=}"
    case "$BASE" in *";$n="*) : ;; *) printf 'BADCELL:%s' "$n"; return 1 ;; esac
    exp="$(printf '%s' "$exp" | sed "s/;$n=[^;]*;/;$n=$r;/")"
  done
  printf '%s' "$exp"
}
diffcells() { # <got> <want> → 列出不符的格
  local i n g w out=""
  for i in "${!MATRIX_N[@]}"; do
    n="${MATRIX_N[$i]}"; g="$(cell "$1" "$n")"; w="$(cell "$2" "$n")"
    [ "$g" != "$w" ] && out="$out $n(得[$g]≠期[$w])"
  done
  printf '%s' "$out"
}
MUTS=0
mut() { # mut <label> <drop> <restore> "<CELL=期望結果 ...>";第四參數空 = 期望全矩陣零變化
  local label="$1" drop="$2" restore="$3" want
  MUTS=$((MUTS+1))
  want="$(expected "$4")" || { bad "$label" "期望覆蓋寫錯:$want"; return; }
  PSQL -v ON_ERROR_STOP=1 -q -c "$drop" >/dev/null 2>&1 || { bad "$label" "突變裝不上去"; return; }
  local got; got="$(matrix)"
  PSQL -v ON_ERROR_STOP=1 -q -c "$restore" >/dev/null 2>&1 || die "還原失敗($label),庫已髒"
  [ "$got" = "$want" ] && ok "$label" "全矩陣精確結果=期望(覆蓋 [$4])" || bad "$label" "不符:$(diffcells "$got" "$want")"
}
mut MUT-key-unique   "DROP INDEX public.pr_idem_key_uniq"   "CREATE UNIQUE INDEX pr_idem_key_uniq ON public.payment_refunds (idempotency_key)" "G-KEY-UNIQUE=OK"
mut MUT-chain-nofork "DROP INDEX public.pr_supersedes_uniq" "CREATE UNIQUE INDEX pr_supersedes_uniq ON public.payment_refunds (supersedes_refund_id) WHERE supersedes_refund_id IS NOT NULL" "G-CHAIN-NOFORK=OK"
# 複合 FK:拿掉之後只有跨 attempt 那格翻掉;懸空那格仍被防環守門攔著(P5B02 不變)⇒ 兩條守門分得開
mut MUT-supersedes-fk "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_supersedes_same_attempt_fkey" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_supersedes_same_attempt_fkey FOREIGN KEY (attempt_id, supersedes_refund_id) REFERENCES public.payment_refunds (attempt_id, id)" "G-CROSS-ATTEMPT=OK"
# 🔴🔴 本片頭號宣稱的判別力:停掉防環守門 ⇒ 同 statement 互指環**寫得進去**(G-NO-CYCLE=OK)
#      = v4「構造上即 DAG、不需要防環守門」那句為假的機械證據;同時露出它蓋住的下面兩層
#      (懸空 → 複合 FK;自環 → pr_not_self_chk)。合法建鏈 G-CHAIN-SAME-STMT 兩邊都 OK
#      = **在該形狀下**守門不誤擋(只涵蓋多列 VALUES 後列指前列 + 單列 INSERT,見該格註解)。
mut MUT-no-cycle     "ALTER TABLE public.payment_refunds DISABLE TRIGGER pr_no_cycle" "ALTER TABLE public.payment_refunds ENABLE TRIGGER pr_no_cycle" "G-NO-CYCLE=OK G-SUPERSEDES-DANGLING=FK:pr_supersedes_same_attempt_fkey G-NO-SELF=CHECK:pr_not_self_chk"
# 分層突變的第二半:守門停掉**且**CHECK 拿掉 ⇒ 自環才真的寫得進 ⇒ 證明 CHECK 那層不是死碼
mut MUT-not-self     "ALTER TABLE public.payment_refunds DISABLE TRIGGER pr_no_cycle; ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_not_self_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_not_self_chk CHECK (supersedes_refund_id IS DISTINCT FROM id); ALTER TABLE public.payment_refunds ENABLE TRIGGER pr_no_cycle" "G-NO-CYCLE=OK G-SUPERSEDES-DANGLING=FK:pr_supersedes_same_attempt_fkey G-NO-SELF=OK"
mut MUT-amount-pos   "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_amount_positive_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_amount_positive_chk CHECK (amount > 0)" "G-AMOUNT-POS=OK"
mut MUT-currency     "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_currency_domain_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_currency_domain_chk CHECK (currency = 'TWD')" "G-CURRENCY=OK"
mut MUT-lease-nonneg "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_lease_token_nonneg_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_lease_token_nonneg_chk CHECK (lease_token >= 0)" "G-LEASE-NONNEG=OK"
mut MUT-strongkey    "ALTER TABLE public.payment_refunds ALTER COLUMN strong_key DROP NOT NULL" "ALTER TABLE public.payment_refunds ALTER COLUMN strong_key SET NOT NULL" "G-STRONGKEY-REQ=OK"
mut MUT-strongkey-blank "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_strong_key_nonblank_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_strong_key_nonblank_chk CHECK (pg_catalog.btrim(strong_key) <> '')" "G-STRONGKEY-BLANK=OK"
mut MUT-idem-shape   "ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_idem_key_shape_chk" "ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_idem_key_shape_chk CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,20}\$')" "G-IDEM-BLANK=OK G-IDEM-UUID=OK G-IDEM-BADCHAR=OK"
mut MUT-terminal-once "DROP INDEX public.pre_one_terminal_uniq" "CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id) WHERE event_type IN ('result_success','result_failed','manual')" "G-TERMINAL-ONCE=OK"
mut MUT-seq-unique   "DROP INDEX public.pre_refund_seq_uniq" "CREATE UNIQUE INDEX pre_refund_seq_uniq ON public.payment_refund_events (refund_id, seq)" "G-SEQ-UNIQUE=OK"
mut MUT-event-type   "ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk" "ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_event_type_chk CHECK (event_type IN ('sent','result_success','result_failed','result_unknown','reconcile','manual'))" "G-EVENT-TYPE=OK"
mut MUT-event-seq    "ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_seq_positive_chk" "ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_seq_positive_chk CHECK (seq > 0)" "G-EVENT-SEQ-POS=OK"
mut MUT-event-lease  "ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_lease_token_nonneg_chk" "ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_lease_token_nonneg_chk CHECK (lease_token >= 0)" "G-EVENT-LEASE=OK"
mut MUT-ao-parent    "ALTER TABLE public.payment_refunds DISABLE TRIGGER pr_append_only" "ALTER TABLE public.payment_refunds ENABLE TRIGGER pr_append_only" "AO-PARENT-UPDATE=OK AO-PARENT-DELETE=OK"
mut MUT-ao-event     "ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_append_only" "ALTER TABLE public.payment_refund_events ENABLE TRIGGER pre_append_only" "AO-EVENT-UPDATE=OK AO-EVENT-DELETE=OK"
# 🔴 TRUNCATE 的**隔離**突變:只停**子表**那支。
#    這一發同時證兩件事:①子表那支有效(AO-EVENT-TRUNCATE 翻成 OK)
#    ②**父表那支有效**(AO-PARENT-TRUNCATE 仍是 P5B01,而此刻子表的守門已停 ⇒ 那個 P5B01
#      只可能是父表那支發的)。
#    ⚠️ 前版兩支一起停,只證得到「至少一支有效」—— CASCADE 會連帶截斷子表,子表那支照樣會擋
#    (memory feedback_negative-test-observation-supplied-by-another-mechanism 同型)。
#    ⚠️ 反過來「只停父表那支」不另立一發:那發的 delta 恆為空(父表的 TRUNCATE 被子表守門供出來),
#    零判別力;父表那半的證據由本發的 ②承擔。
mut MUT-ao-truncate-child "ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_append_only_truncate" "ALTER TABLE public.payment_refund_events ENABLE TRIGGER pre_append_only_truncate" "AO-EVENT-TRUNCATE=OK"

# 🔴 收尾:全矩陣必須回到基線 —— 任何一發突變的「還原」沒還乾淨,後面所有比對都會失去意義
FINAL="$(matrix)"
[ "$FINAL" = "$BASE" ] && ok RESTORE-CLEAN "$MUTS 發突變還原後全矩陣逐字回到基線" \
  || bad RESTORE-CLEAN "還原有殘留:$(diffcells "$FINAL" "$BASE")"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
echo "✅ L5b-1 全綠($PASS 條:${#MATRIX_N[@]} 格全矩陣 + $MUTS 發突變 + 還原對帳,每發重跑全矩陣比對精確結果)"
