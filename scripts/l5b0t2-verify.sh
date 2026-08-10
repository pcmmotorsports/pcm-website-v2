#!/usr/bin/env bash
# ============================================================
# L5b-0-t2 驗證 harness:讓路入帳鐵律 —— **confirm 面**行為格 + 突變矩陣
# ============================================================
# plan = docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md §5.1 / §5.2
# 用法:provision(d1t2 家族)後 `L5B0_VERIFY_PORT=54394 scripts/l5b0t2-verify.sh /tmp/l5b0t/pg`
# 涵蓋:格 3、4、8、9b、14 + 突變 M4、M5。(attempt 面 13 格 + 10 發突變在 scripts/l5b0-verify.sh。)
#
# ══ 🔴 為什麼要拆成第二支腳本(不是懶,是隔離模型互斥)══════════════════
#   -t1 那支:每格一條 psql + 自己的 BEGIN…ROLLBACK ⇒ **零留痕由構造保證**。
#   本支做不到那件事,因為 OP3(20260810160000)之後 `confirm_order_payment` 有一道硬閘:
#       IF session_user <> 'payment_confirmer' THEN RAISE ... USING ERRCODE='P2B36'
#   ⇒ 呼它必須走**另一條 payment_confirmer 連線**;而另一條連線看不到我未提交交易裡的 fixture
#   ⇒ fixture 只能 **committed**,零留痕只能靠**逐格清理 + 收尾對帳**(a8c2-verify.sh 形制)。
#   兩種隔離模型混在同一支腳本,「零留痕」就失去單一判準(有的格靠構造、有的格靠清理,
#   一旦有人加格就得先想「這格屬於哪一種」)⇒ 分兩支、各自只有一種模型。
#
# ══ 🔴 零留痕怎麼做到的:**每輪一個拋棄式 clone DB**,base DB 全程唯讀 ═════════
#   第一版想照 a8c2 用「committed fixture + 逐格 DELETE 清理」,**實測不可行**:
#     `order_payments` 是 **append-only**(OP2b 的 `pcm_op2b_no_delete()` trigger,
#      逐字:「收款帳本不得刪列 ⇒ 登錯走沖銷,刪掉重寫等於繞過 append-only」)
#     ⇒ 只要有一格讓 confirm **成功**(格 4/8/14 都會),card 腿就寫一列 order_payments,
#       那列**刪不掉** ⇒ 連帶 orders 也刪不掉(FK)⇒ fixture 永遠留著、下一輪撞號。
#   ⇒ 唯二的出路是「關掉那個 trigger」或「不要在 base DB 上做」。
#     關 trigger = 為了測試把金流帳本的 append-only 守門拆掉,**不做**(而且那正是本 repo 明令禁止的繞道)。
#   ⇒ 本支改成:`CREATE DATABASE … TEMPLATE postgres` 開一個**本輪專用 clone**,所有格與突變都在 clone 上跑,
#     收尾 `DROP DATABASE`。base DB **一個位元組都沒被寫過** —— 這比「刪乾淨了」更強,而且不必信任清理邏輯。
#   收尾仍對 base 的五張表做計數對帳,當作「真的沒寫到 base」的獨立證據(不是唯一證據)。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/l5b0t/pg}"
PORT="${L5B0_VERIFY_PORT:-54394}"
BASE_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
MAINT_URL="postgresql://postgres@127.0.0.1:${PORT}/template1"
RUNDB="l5b0t2_run"
URL="postgresql://postgres@127.0.0.1:${PORT}/${RUNDB}"
PC_URL="postgresql://payment_confirmer@127.0.0.1:${PORT}/${RUNDB}"
export LC_ALL=C

MIGFILE="supabase/migrations/20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql"
PROSRC_M_G3="184204e35edb0dba1b6d4d0909136f3c"   # confirm_order_payment(-m 閘三 post-image)
SIG_CONFIRM="public.confirm_order_payment(uuid,integer,text)"
# 🔴 display_id 有格式 CHECK(orders_display_id_format:^PCM-[0-9]{4}-[0-9]{4,}$ 或 6 碼短碼)
#    ⇒ fixture 前綴不能亂取(第一版寫 PCM-L5B2 直接被 CHECK 擋、五格全紅)。9952 = 本線的識別號段。
PREFIX="PCM-9952"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }        # 本輪 clone
qb()  { psql "$BASE_URL" -qtAX -c "$1" 2>&1; }   # base(唯讀對帳用)

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# 🔴 code-reviewer must-fix:`trap … EXIT` 是**取代**不是疊加 —— 第一版設了三次,而中段那一百多行
#    生效的剛好是「沒有 drop_clone」的那一版 ⇒ 格跑到一半 Ctrl-C / 任何 exit,會把一個**已經寫進
#    card 腿資料**的 clone 留在叢集上,而檔頭卻宣稱「收尾整個 DROP」= 宣稱大於事實。
#    ⇒ 全檔只留**一個** trap;要清什麼一律進 cleanup_all,還沒建立的資源自己跳過。
cleanup_all() {
  rm -f "${ERRFILE:-}" "${SEQFILE:-}" "${BASEDEF:-}" "${MUTFILE:-}"
  if [ -n "${RUNDB:-}" ]; then
    psql "$MAINT_URL" -qtAX -c "DROP DATABASE IF EXISTS ${RUNDB}" >/dev/null 2>&1
  fi
  return 0
}
trap cleanup_all EXIT
# 🔴 位置也是承重:trap 必須設在 **CREATE DATABASE 之前**。
#    我第一版把它擺在檔案中段(clone 已經建好之後)—— 那樣「建完 clone 到設 trap」之間任何中斷
#    都會留下 clone,而症狀跟沒修一模一樣。守門的位置錯了,守門本身就不存在。


# 🔴 與 -t1 同款的原始碼自檢:反引號會被 shell 當命令替換執行掉、並把那段字面換成空字串。
BT="$(printf '\140')"
if grep -n "$BT" "${BASH_SOURCE[0]}" | grep -qv '^[0-9]*:[[:space:]]*#'; then
  echo "🔴 原始碼含反引號且不在整行註解上(shell 會吃掉那段字面):" >&2
  grep -n "$BT" "${BASH_SOURCE[0]}" | grep -v '^[0-9]*:[[:space:]]*#' >&2
  exit 1
fi

# ── 身分閘 ───────────────────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 缺 d1t2 harness marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(qb "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 datadir=$DATADIR 不在 $WORK 底下;拒跑"; exit 1;; esac
[ "$(qb "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(qb "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(qb "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$SIG_CONFIRM'::regprocedure")" = "$PROSRC_M_G3" ] \
  || { echo "🔴 confirm_order_payment 非 L5b-0-m 那版(閘三不在或已漂移);拒跑"; exit 1; }
[ "$(qb "SELECT count(*) FROM public.staff WHERE id='payment_confirmer'")" = "1" ] \
  || { echo "🔴 staff 缺 payment_confirmer 列(OP3 seed)⇒ card 腿寫不進去、格 4/8 會因錯的理由紅;拒跑"; exit 1; }
ok "身分閘:datadir/db/isolation + 閘三指紋 + payment_confirmer 連線可用 + staff 列在"

[ "$(qb "SELECT count(*) FROM public.orders WHERE display_id LIKE '${PREFIX}%'")" = "0" ] \
  || { echo "🔴 base DB 上有 ${PREFIX}* 殘留 ⇒ 代表以前有人在 base 上跑過本支(或清理失敗);先處理再跑"; exit 1; }
ok "base 起跑前零殘留:${PREFIX}* = 0"

# ── 本輪 clone(零留痕的**構造**保證;不是靠事後刪)───────────────────────
psql "$MAINT_URL" -qtAX -c "DROP DATABASE IF EXISTS ${RUNDB}" >/dev/null 2>&1
CLONE_ERR="$(psql "$MAINT_URL" -qtAX -c "CREATE DATABASE ${RUNDB} TEMPLATE postgres" 2>&1)"
case "$CLONE_ERR" in *ERROR*) echo "🔴 建本輪 clone 失敗:$CLONE_ERR"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "${RUNDB}" ] || { echo "🔴 clone 身分閘:連到的不是 ${RUNDB};拒跑"; exit 1; }
ok "本輪 clone ${RUNDB} 已建(base 全程唯讀)"

# 🔴 payment_confirmer 這條連線是本支的**承重**:它不通,所有 confirm 格會以「RAISE 了」收場而全綠 = 假綠。
PC_WHO="$(psql "$PC_URL" -qtAX -c "SELECT session_user" 2>&1)"
[ "$PC_WHO" = "payment_confirmer" ] \
  || { echo "🔴 payment_confirmer 連不上 clone(得到:$PC_WHO)⇒ confirm 面的格會全部因錯的理由綠;拒跑"; exit 1; }
PC_DB="$(psql "$PC_URL" -qtAX -c "SELECT current_database()" 2>&1)"
[ "$PC_DB" = "${RUNDB}" ] || { echo "🔴 payment_confirmer 連到的是 $PC_DB、不是本輪 clone;拒跑"; exit 1; }
ok "payment_confirmer 連線可用且連的是本輪 clone(不是 base)"

TABLES="orders order_items payment_charge_attempts payment_double_charge_anomalies order_payments"
# 🔴 每個計數**當場**驗數值(q() 併了 stderr;把整串拿去比對會因為表名本身有字母而恆真/恆假 ——
#    第一版就是這樣寫的,結果起始快照直接誤判成「非數值」)。
snap() {   # 對 **base** 取(本支的斷言是「base 一個位元組都沒被寫過」)
  local t n out=""
  for t in $TABLES; do
    n="$(qb "SELECT count(*) FROM public.$t")"
    case "$n" in ''|*[!0-9]*) echo "🔴 snap:$t 取到非數值($n)" >&2; return 1 ;; esac
    out="$out$t=$n "
  done
  printf '%s' "$out"
}
SNAP0="$(snap)" || exit 1

CUST="$(q "SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1")"   # clone 上取(值與 base 相同)
[ -n "$CUST" ] || { echo "🔴 customers 空;拒跑"; exit 1; }
# 🔴 序號不能放變數:next_disp 被 $( ) 呼叫 ⇒ 遞增發生在子殼、回不到主殼
#    ⇒ 每一格都拿到同一個號、第二格起 display_id 撞 unique(第一版就是這樣紅的)。改用檔案當計數器。
SEQFILE="$(mktemp "${TMPDIR:-/tmp}/l5b0t2-seq.XXXXXX")"; echo 0 > "$SEQFILE"
next_disp() {
  local n; n="$(( $(cat "$SEQFILE") + 1 ))"; echo "$n" > "$SEQFILE"
  printf '%s-%04d' "$PREFIX" "$n"
}

# committed 訂單(unpaid、total=100;cart_session_id 給值:genesis anomaly 那幾欄 NOT NULL)
mkord() {
  q "INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
       subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
     VALUES ('$1', '$CUST', jsonb_build_object('name','l5b0t2','phone','0900000000','line','x'),
       'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
     RETURNING id"
}
# attempt(owner 直寫;$1=order $2=status $3=superseded(y/n) $4=rec($5 空則 NULL))
mkatt() {
  local sup_at="NULL" sup_rsn="NULL" rec="NULL"
  [ "$3" = "y" ] && { sup_at="pg_catalog.now() - interval '1 hour'"; sup_rsn="'record_not_found'"; }
  [ -n "${4:-}" ] && rec="'$4'"
  q "INSERT INTO public.payment_charge_attempts
       (order_id, customer_user_id, status, fallback_token_hash, rec_trade_id, released_at, superseded_at, superseded_reason)
     VALUES ('$1', '$CUST', '$2', pg_catalog.repeat('a',64), $rec,
             pg_catalog.now() - interval '2 hours', $sup_at, $sup_rsn)
     RETURNING id"
}
# 🔴 confirm 一律走 payment_confirmer 連線(OP3 P2B36);回 stdout=jsonb 或 ERROR 字串
confirm() { psql "$PC_URL" -qtAX -c "SELECT public.confirm_order_payment('$1'::uuid, $2, '$3')" 2>&1; }

# ══════════════════════════════════════════════════════════
# 行為格(plan §5.1;本片=confirm 面)
# ══════════════════════════════════════════════════════════
# 每格自建 committed fixture、自己收乾淨;回 0=綠 1=紅,紅時把原因寫進 ERRFILE(見上,子殼問題)。
# 🔴 錯誤訊息不能只放變數:run_vector 跑在 $( ) 的**子殼**裡,子殼設的變數回不到主殼
#    ⇒ 診斷字串會永遠是空的(-t1 那支也有同款問題,只是那邊的向量本身就帶得走資訊)。改寫檔案。
ERRFILE="$(mktemp "${TMPDIR:-/tmp}/l5b0t2-err.XXXXXX")"
cell_err() { printf '%s\n' "$1" >> "$ERRFILE"; }   # 字串一律自帶「格N:」前綴,收尾用格名撈、不靠行號
last_err() { tail -1 "$ERRFILE" 2>/dev/null; }
GEN="confirm_order_payment: 付款確認失敗"   # PF-E 通用訊息(業務拒絕單一字面)

# 🔴 本支**沒有** cleanup_order:clone 收尾整個 DROP ⇒ 逐列刪既不需要、也做不到
#    (order_payments 是 append-only,見檔頭)。格內不做任何清理,留痕由 DROP DATABASE 收。

# 格 3:該單有**活的**讓路 attempt ⇒ confirm 必須拒;order 維持 unpaid
cell_3() {
  local d o out ps
  d="$(next_disp)"; o="$(mkord "$d")"
  mkatt "$o" released y "" >/dev/null
  out="$(confirm "$o" 100 "REC3-$d")"
  ps="$(q "SELECT payment_status::text FROM public.orders WHERE id='$o'")"
  case "$out" in *"$GEN"*) : ;; *) cell_err "格3:confirm 沒被閘三擋(回:$(printf '%s' "$out" | head -1 | cut -c1-90))"; return 1;; esac
  [ "$ps" = "unpaid" ] || { cell_err "格3:被擋了但 order 竟非 unpaid($ps)"; return 1; }
  return 0
}

# 格 4:🔴 閘三**不得**誤擋 L5a-2 —— 舊 attempt 已 close 成 failed、同單新 attempt 合法收款
#   這格是「status IN (...) 那條不可省」的證據:少了它,凡是曾經有讓路 attempt 的單就永遠收不了款。
cell_4() {
  local d o a out ps
  d="$(next_disp)"; o="$(mkord "$d")"
  a="$(mkatt "$o" released y "")"
  # owner 直寫把舊 attempt 結案成 failed(close_released_attempt 的終態;本格點名的 RPC 只有 confirm)
  q "UPDATE public.payment_charge_attempts
        SET status='failed', released_closed_at=pg_catalog.now(),
            released_closed_by='l5b0t2', released_close_resolution='格4 fixture'
      WHERE id='$a'" >/dev/null
  mkatt "$o" pending n "" >/dev/null                    # 同單新 attempt(未讓路)
  out="$(confirm "$o" 100 "REC4-$d")"
  ps="$(q "SELECT payment_status::text FROM public.orders WHERE id='$o'")"
  case "$out" in *'"confirmed": true'*|*'"confirmed":true'*) : ;;
    *) cell_err "格4:合法重付被擋(回:$(printf '%s' "$out" | head -1 | cut -c1-90))⇒ status IN(...) 那條被省了"; return 1;; esac
  [ "$ps" = "paid" ] || { cell_err "格4:confirm 說成功但 order 沒轉 paid($ps)"; return 1; }
  return 0
}

# 格 8:正 —— 未讓路的 confirm,同 rec 同額重放 ⇒ idempotent:true(不是再收一次)
cell_8() {
  local d o out1 out2
  d="$(next_disp)"; o="$(mkord "$d")"
  mkatt "$o" pending n "" >/dev/null
  out1="$(confirm "$o" 100 "REC8-$d")"
  out2="$(confirm "$o" 100 "REC8-$d")"
  case "$out1" in *'"idempotent": false'*|*'"idempotent":false'*) : ;;
    *) cell_err "格8:第一次 confirm 就不是新收款(回:$(printf '%s' "$out1" | head -1 | cut -c1-90))"; return 1;; esac
  case "$out2" in *'"idempotent": true'*|*'"idempotent":true'*) : ;;
    *) cell_err "格8:同 rec 同額重放沒回 idempotent(回:$(printf '%s' "$out2" | head -1 | cut -c1-90))"; return 1;; esac
  return 0
}

# 格 9b:legacy `charged` + `superseded` 走 **confirm 腿** ⇒ 拒;order 維持 unpaid
cell_9b() {
  local d o out ps
  d="$(next_disp)"; o="$(mkord "$d")"
  mkatt "$o" charged y "REC9BOLD-$d" >/dev/null        # charged 需帶 rec(表上 CHECK)
  out="$(confirm "$o" 100 "REC9B-$d")"
  ps="$(q "SELECT payment_status::text FROM public.orders WHERE id='$o'")"
  case "$out" in *"$GEN"*) : ;; *) cell_err "格9b:legacy charged+superseded 竟被 confirm 收下(回:$(printf '%s' "$out" | head -1 | cut -c1-90))"; return 1;; esac
  [ "$ps" = "unpaid" ] || { cell_err "格9b:被擋了但 order 竟非 unpaid($ps)"; return 1; }
  return 0
}

# 格 14:🔴 **已知天花板**(plan §3.3),這格存在是為了讓它變成**被記錄的行為**、不是「以為擋住了」:
#   舊 attempt 結案成 failed 之後,拿**舊 rec** 呼 confirm ⇒ 閘三**放行**
#   (閘三判的是「這張單有沒有活的讓路 attempt」,不是「這次的錢來自哪顆 attempt」)。
cell_14() {
  local d o a out
  d="$(next_disp)"; o="$(mkord "$d")"
  a="$(mkatt "$o" released y "RECOLD-$d")"
  q "UPDATE public.payment_charge_attempts
        SET status='failed', released_closed_at=pg_catalog.now(),
            released_closed_by='l5b0t2', released_close_resolution='格14 fixture'
      WHERE id='$a'" >/dev/null
  out="$(confirm "$o" 100 "RECOLD-$d")"               # 拿舊 rec 呼
  case "$out" in *'"confirmed": true'*|*'"confirmed":true'*) : ;;
    *) cell_err "格14:天花板行為變了(現在擋下來了)——不是壞事,但 plan §3.3/§8-4 的字面要同步改,別讓文件說謊(回:$(printf '%s' "$out" | head -1 | cut -c1-90))"; return 1;; esac
  return 0
}

CELLS="3 4 8 9b 14"
CELL_COUNT="$(set -- $CELLS; echo $#)"
run_vector() {
  local c out=""
  for c in $CELLS; do
    if "cell_$c"; then out="${out}1"; else out="${out}0"; fi
  done
  printf '%s' "$out"
}

echo "== 行為格 ×${CELL_COUNT}(confirm 面;committed fixture 跑在本輪 clone、收尾整個 DROP)=="
BASE_VEC="$(run_vector)"
i=0
for c in $CELLS; do
  i=$((i+1))
  if [ "${BASE_VEC:$((i-1)):1}" = "1" ]; then ok "格 $c"; else bad "格 $c — $(grep -m1 "^格${c}:" "$ERRFILE" 2>/dev/null || grep -m1 "order" "$ERRFILE" | head -1)"; fi
done
ALL_GREEN="$(printf '1%.0s' $CELLS)"
[ "$BASE_VEC" = "$ALL_GREEN" ] && ok "對照組向量全綠($BASE_VEC)" || bad "對照組向量=$BASE_VEC 期望=$ALL_GREEN"

# ══════════════════════════════════════════════════════════
# 突變矩陣(plan §5.2;本片=M4、M5)
# ══════════════════════════════════════════════════════════
# 形制同 -t1:dump live 定義 → 錨點取代(命中數必須恰 1)→ 重套 → 跑向量 → 還原。
# 差別是本支跑在 clone 上,所以突變一定不會碰到 base。
echo "== 突變矩陣 ×${CELL_COUNT} 格 =="
BASEDEF="$(mktemp "${TMPDIR:-/tmp}/l5b0t2-confirm.XXXXXX")"
psql "$URL" -qtAX -c "SELECT pg_get_functiondef('$SIG_CONFIRM'::regprocedure)" > "$BASEDEF"
test -s "$BASEDEF" || { bad "dump confirm 定義失敗"; }

gen_mutant() { # $1=M4|M5 → $BASEDEF 產出 $2
  python3 - "$1" "$BASEDEF" "$2" <<'PYEOF'
import sys
name, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit("anchor 命中 %d 次(必須恰 1):%s" % (src.count(anchor), anchor[:60]))
    return src.replace(anchor, repl)
GATE3 = """  IF EXISTS (
    SELECT 1 FROM public.payment_charge_attempts a
     WHERE a.order_id = p_order_id
       AND a.superseded_at IS NOT NULL
       AND a.status IN ('pending', 'charged', 'released')
  ) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
STATUS_LINE = "\n       AND a.status IN ('pending', 'charged', 'released')"
if   name == 'M4': out = sub(GATE3, "  -- M4 mutant:閘三整條拿掉")
elif name == 'M5': out = sub(STATUS_LINE, "")
else: sys.exit("unknown mutant " + name)
open(out_p, 'w').write(out)
PYEOF
}
mut_reds() { case "$1" in M4) echo "3 9b" ;; M5) echo "4 14" ;; esac; }
reds_to_vec() {
  local reds=" $1 " c out=""
  for c in $CELLS; do
    case "$reds" in *" $c "*) out="${out}0" ;; *) out="${out}1" ;; esac
  done
  printf '%s' "$out"
}
restore_confirm() { psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$BASEDEF" >/dev/null 2>&1; }
MUTFILE="$(mktemp "${TMPDIR:-/tmp}/l5b0t2-mut.XXXXXX")"

for M in M4 M5; do
  if ! ERR="$(gen_mutant "$M" "$MUTFILE" 2>&1)"; then bad "$M 錨點 preflight — $ERR"; continue; fi
  if ! psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MUTFILE" >/dev/null 2>&1; then bad "$M 套用失敗"; restore_confirm; continue; fi
  # 空包彈檢查:prosrc 必須真的變了,否則後面的向量比對毫無意義
  NEWSRC="$(q "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$SIG_CONFIRM'::regprocedure")"
  [ "$NEWSRC" != "$PROSRC_M_G3" ] || { bad "$M prosrc 未變(空包彈)"; restore_confirm; continue; }

  VEC="$(run_vector)"
  EXP="$(reds_to_vec "$(mut_reds "$M")")"
  if [ "$VEC" = "$EXP" ]; then ok "$M 向量逐格吻合($VEC;應紅=[$(mut_reds "$M")])"
  else bad "$M 向量=$VEC 期望=$EXP(應紅=[$(mut_reds "$M")];最後一則:$(tail -1 "$ERRFILE" 2>/dev/null | cut -c1-110))"; fi

  restore_confirm
  [ "$(q "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$SIG_CONFIRM'::regprocedure")" = "$PROSRC_M_G3" ] \
    && ok "$M 還原後 prosrc = 基準" \
    || { bad "$M 還原失敗 ⇒ 立即停損(後續的紅會變連鎖雜訊)"; break; }
done

# ── 收尾:base 一個位元組都沒被寫過(clone 模型的獨立佐證)─────────────────
SNAP1="$(snap)" || SNAP1="<取不到>"
if [ "$SNAP1" = "$SNAP0" ]; then ok "base 零寫入:$SNAP1"
else bad "🔴 base 被寫到了:跑前=[$SNAP0] 跑後=[$SNAP1]"; fi
[ "$(qb "SELECT count(*) FROM public.orders WHERE display_id LIKE '${PREFIX}%'")" = "0" ] \
  && ok "base 上零 ${PREFIX}* fixture" || bad "🔴 base 上出現 ${PREFIX}* fixture"

echo "─────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
