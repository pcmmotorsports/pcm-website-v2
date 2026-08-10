#!/usr/bin/env bash
# ============================================================
# L5b-0-t1 驗證 harness:讓路入帳鐵律 —— **attempt 面**行為格 + 突變矩陣
# ============================================================
# plan = docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md §5.1 / §5.2
# 用法:provision(d1t2 家族)後 `L5B0_VERIFY_PORT=54394 scripts/l5b0-verify.sh /tmp/l5b0t/pg`
# 形制沿用 a8c1/a8c2-verify.sh:身分閘 → 行為格 → 突變矩陣(逐格向量精確比對)→ 零留痕複查。
#
# 🔴 本片(-t1)只涵蓋 **attempt 面**:格 1,2,5,6,7,9a,10,11,12,13,15,16,17 + 突變 M1,M2,M3,M6,M7,M8,M9,M10,M11,M12。
#    (格 16/17 與 M10-M12 是**改④ 面**;-s 送審期間留白,Sean 2026-08-10 拍板 A 認可改④ 後補齊。)
#    **confirm 面(格 3,4,8,9b,14 + 突變 M4,M5)不在本片**,理由不是偷懶,是**驗收載體不同**:
#    OP3(20260810160000)之後 `confirm_order_payment` 帶 `session_user <> 'payment_confirmer'` 硬閘
#    ⇒ 那幾格必須用**另一條 payment_confirmer 連線**呼 RPC ⇒ fixture 不能留在未提交交易裡
#    ⇒ 要改走「committed fixture + 九表零留痕 + 逐格清理」那套(a8c2 形制)。
#    兩套隔離模型混在同一支腳本會讓「零留痕」這件事失去單一判準 ⇒ 拆 -t2。
#
# 🔴 隔離模型(本片):**每格一條獨立 psql + 自己的 BEGIN…ROLLBACK**。
#    - 每格獨立跑 = 一格紅不擋其他格 ⇒ 收得齊「完整紅集合」(關卡2 R1-MF5 的修法)。
#    - ROLLBACK 收尾 = 零留痕由**構造**保證,不靠事後清理。
#    - 前置 state 一律 owner 直寫 seed;**只有該格點名的那支 RPC 走守門**(plan §5.0 硬紀律)。
#      唯一例外是格 10:它驗的就是 claim 自己的 ceiling,所以八輪都必須真的呼 claim(禁直接 seed count=8)。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/l5b0t/pg}"
PORT="${L5B0_VERIFY_PORT:-54394}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

MIGFILE="supabase/migrations/20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql"
MIGFILE_M="supabase/migrations/20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql"

# post-image prosrc 指紋(= 兩片各自檔內 assert 段釘的同一組值;此處當「該片已套用」的身分閘)
PROSRC_M_G1="13dfcc0a3c7f8e35b53063ca9babf8e5"   # mark_charge_attempt_charged
PROSRC_M_G2="ca9a7593ca05b2991d295ce93be692f4"   # ..._fallback
PROSRC_S_C1="dda1fdbd680632432a22a3f092c4b9ec"   # claim_stuck_unsettled_attempts
PROSRC_S_C2="6c3f81fce0683a4a17ffd83157f02353"   # mark_attempt_settle_retry
PROSRC_S_C3="12a1605c7c9705b1ab1a1c363febbd79"   # get_payment_anomaly_alert_summary
PROSRC_S_C4="a4e1a29b202d75361ae64919f1897d09"   # expire_stuck_attempts_at_ceiling

SIG_MARK="public.mark_charge_attempt_charged(uuid,uuid,text)"
SIG_FB="public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)"
SIG_CLAIM="public.claim_stuck_unsettled_attempts(integer,integer)"
SIG_RETRY="public.mark_attempt_settle_retry(uuid,integer,text)"
SIG_SUM="public.get_payment_anomaly_alert_summary(integer,integer,integer)"
SIG_EXP="public.expire_stuck_attempts_at_ceiling()"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
CASEDIR="$(mktemp -d "${TMPDIR:-/tmp}/l5b0-cases.XXXXXX")"
trap 'rm -rf "$CASEDIR"' EXIT

# ── 自檢:原始碼裡不得出現「會被 shell 吃掉」的反引號 ────────────────────────
# 🔴 2026-08-10 實錘:格 1 的註解裡寫了一組反引號,而 case body 是用**雙引號字串**傳進 emit_case
#    ⇒ shell 在**交出引數之前**就把它當命令替換執行掉,並把那段字面**換成空字串**寫進 SQL 檔。
#    這次只吃掉一句註解(唯一症狀=stderr 一行 "EXCEPTION: command not found",極易被當雜訊放過),
#    但同一個機制吃到的若是一條斷言,就是**靜默少驗一件事而全綠**。
# 🔴 守門要畫在**不變量成立的那個面**:執行期的 `case "$2"` 檢查是**恆真**的
#    (反引號那時候早就不見了)—— 這一版就是先寫了那個恆真守門、被消融測試打回來才改成掃原始碼。
# 🔴 連這段自己都不能出現字面的反引號(否則守門會咬到自己)⇒ 用 printf 產出那個字元。
BT="$(printf '\140')"
if grep -n "$BT" "${BASH_SOURCE[0]}" | grep -qv '^[0-9]*:[[:space:]]*#'; then
  echo "🔴 原始碼含反引號且不在整行註解上 —— shell 會執行它並把那段換成空字串:" >&2
  grep -n "$BT" "${BASH_SOURCE[0]}" | grep -v '^[0-9]*:[[:space:]]*#' >&2
  echo "   改用「」或直接不加引號;不要靠「記得別用」這種規則。" >&2
  exit 1
fi

# ── 身分閘(照 a8c1/a8c2:先證「我連到的是我以為的那台、而且兩片都在」)──────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 缺 d1t2 harness marker;拒跑"; exit 1; }
test -f "$MIGFILE"   || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
test -f "$MIGFILE_M" || { echo "🔴 $MIGFILE_M 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 datadir=$DATADIR 不在 $WORK 底下;拒跑"; exit 1;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
ok "身分閘:datadir/db/isolation/lc_messages"

idcheck() { # $1=簽章 $2=期望 prosrc md5 $3=說明
  local got; got="$(q "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$1'::regprocedure")"
  [ "$got" = "$2" ] || { echo "🔴 $3 的 post-image prosrc=$got 期望=$2 ⇒ 該片未套用或已漂移;拒跑"; exit 1; }
}
idcheck "$SIG_MARK"  "$PROSRC_M_G1" "L5b-0-m 閘一"
idcheck "$SIG_FB"    "$PROSRC_M_G2" "L5b-0-m 閘二"
idcheck "$SIG_CLAIM" "$PROSRC_S_C1" "L5b-0-s 改①"
idcheck "$SIG_RETRY" "$PROSRC_S_C2" "L5b-0-s 改②"
idcheck "$SIG_SUM"   "$PROSRC_S_C3" "L5b-0-s 改③"
idcheck "$SIG_EXP"   "$PROSRC_S_C4" "L5b-0-s 改④"
ok "身分閘:-m 兩支 + -s 四支 post-image 指紋全等(兩片都在、且是我以為的那版)"

# 🔴 零留痕的**前提**也要驗:本 harness 全程 ROLLBACK,所以跑前跑後兩張表列數必須相同。
BASE_ATT="$(q "SELECT count(*) FROM public.payment_charge_attempts")"
BASE_ANO="$(q "SELECT count(*) FROM public.payment_double_charge_anomalies")"
case "$BASE_ATT$BASE_ANO" in *[!0-9]*) echo "🔴 基線計數非數值;拒跑"; exit 1;; esac

# ── 格的共用 seed(owner 直寫;只有點名的 RPC 走守門)────────────────────────
# $1=status $2=count $3=superseded(y/n) $4=next_settle_at 運算式 $5=needs_manual_review
seed_attempt() {
  local st="$1" cnt="$2" sup="$3" lease="$4" manual="$5"
  local sup_at="NULL" sup_rsn="NULL"
  if [ "$sup" = "y" ]; then
    sup_at="pg_catalog.now() - interval '1 hour'"; sup_rsn="'record_not_found'"
  fi
  cat <<SQL
  SELECT o.id, o.customer_user_id INTO v_order, v_user
    FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status
     AND NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id = o.id)
   ORDER BY o.id            -- nit(code-reviewer):無 ORDER BY 的 LIMIT 1 選到哪張單不保證、除錯不可重現
   LIMIT 1;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'seed 失敗:找不到 unpaid 且無 attempt 的訂單(fixture 前提被打穿,不是本格的結論)';
  END IF;
  -- 🔴 fixture 值不得讓任何一格「因為別的理由」紅或綠(memory feedback_fixture-value-makes-guard-vacuous):
  --    d1t2 seed 的 orders.cart_session_id 是 NULL,而 genesis anomaly 那幾欄是 NOT NULL
  --    ⇒ 不補這一行的話,格 6 會因 not_null_violation 紅(看起來像「genesis 沒建」,其實是 fixture 沒給值),
  --    而格 1 在「閘被拿掉」的突變下也會**因為同一個 NULL 而照樣紅** ⇒ 那一格的紅就不是閘的功勞了。
  UPDATE public.orders SET cart_session_id = gen_random_uuid()
   WHERE id = v_order AND cart_session_id IS NULL;
  IF (SELECT total FROM public.orders WHERE id = v_order) <= 0 THEN
    RAISE EXCEPTION 'seed 失敗:選到的訂單 total <= 0(會撞 confirm 的 total 守門、讓格的結論失真)';
  END IF;
  INSERT INTO public.payment_charge_attempts
    (id, order_id, customer_user_id, status, fallback_token_hash, created_at, updated_at,
     settle_attempt_count, next_settle_at, needs_manual_review, released_at, superseded_at, superseded_reason)
  VALUES
    (v_attempt, v_order, v_user, '${st}', pg_catalog.repeat('a', 64),
     pg_catalog.now() - interval '2 days', pg_catalog.now() - interval '2 days',
     ${cnt}, ${lease}, ${manual}, pg_catalog.now() - interval '2 hours', ${sup_at}, ${sup_rsn});
SQL
}

emit_case() { # $1=格名 $2=body(SQL)
  cat > "$CASEDIR/case-$1.sql" <<SQL
\\set ON_ERROR_STOP on
BEGIN;
DO \$harness\$
DECLARE
  v_order uuid; v_user uuid; v_attempt uuid := gen_random_uuid();
  v_hit integer; v_flag boolean; v_before integer; v_after integer;
  v_n integer; v_i integer; v_status text; v_rec text; v_ano integer; v_ok boolean;
  v_token uuid := gen_random_uuid(); v_state text; v_msg text;
BEGIN
$2
END
\$harness\$;
ROLLBACK;
SQL
}

# 每格獨立一條 psql;回傳 0=綠 1=紅,紅時把第一行 ERROR 收進 CELL_ERR
CELL_ERR=""
run_case() {
  local name="$1" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtAX -f "$CASEDIR/case-$name.sql" 2>&1)"
  if [ $? -eq 0 ]; then return 0; fi
  CELL_ERR="$(printf '%s' "$out" | grep -m1 'ERROR' | cut -c1-160)"
  return 1
}

# ══════════════════════════════════════════════════════════
# 行為格(plan §5.1;本片=attempt 面)
# ══════════════════════════════════════════════════════════

# 格 1:閘一 —— superseded + released 呼 markCharged ⇒ RAISE、attempt 不動、anomaly 零列
emit_case 1 "$(seed_attempt released 0 y NULL false)
  SELECT count(*) INTO v_ano FROM public.payment_double_charge_anomalies;
  -- 🔴 code-reviewer must-fix:裸的 EXCEPTION WHEN others 捕捉是**結構性**假綠 ——
  --    只要未來在閘之前多一道前置(例如收緊 rec 格式),這一格會因為「別的東西 RAISE 了」而**靜默續綠**,
  --    而閘本身可能早已被繞過。⇒ 收下 SQLSTATE 與訊息、斷言它就是閘那一種拒絕,
  --    並在呼叫前先證「唯二的前置(rec 形狀、雙鍵 row 存在)確實會過」。
  IF NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts
                  WHERE id = v_attempt AND order_id = v_order) THEN
    RAISE EXCEPTION '格1 前提 FAIL:雙鍵查不到本列 ⇒ 之後的 RAISE 會來自 NOT FOUND、不是閘一';
  END IF;
  v_ok := false; v_state := ''; v_msg := '';
  BEGIN
    PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-1');
  EXCEPTION WHEN others THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '格1 FAIL:閘一沒擋(superseded+released 竟被認列成 charged)'; END IF;
  IF v_state <> 'P0001' OR v_msg <> 'mark_charge_attempt_charged: 付款處理失敗' THEN
    RAISE EXCEPTION '格1 FAIL:確實 RAISE 了,但不是閘一那一種拒絕(SQLSTATE=% 訊息=%)⇒ 本格量到的是別的東西',
                    v_state, v_msg;
  END IF;
  -- 正向對照在格 5(同一支 RPC、同一組前置、只差 superseded_at)⇒ 前置若壞掉,格 5 會紅、不會兩格一起沉默。
  SELECT status, rec_trade_id INTO v_status, v_rec FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_status <> 'released' OR v_rec IS NOT NULL THEN
    RAISE EXCEPTION '格1 FAIL:被擋下了但 attempt 動過(status=% rec=%)', v_status, v_rec;
  END IF;
  SELECT count(*) INTO v_n FROM public.payment_double_charge_anomalies;
  IF v_n <> v_ano THEN RAISE EXCEPTION '格1 FAIL:被擋下了卻建了 anomaly(% → %)', v_ano, v_n; END IF;"

# 格 2:閘二 —— superseded + **pending** 走備軌 ⇒ RAISE
#   (superseded⇒必為 released 是寫入端自律、schema 沒強制 ⇒ 這格就是閘二存在的理由)
emit_case 2 "$(seed_attempt pending 0 y NULL false)
  -- 🔴 這一格在第一版是**為了錯的理由綠的**,是突變 M3(把閘二整條拿掉)把它抓出來的:
  --    備軌在碰到讓路閘之前還有兩道 —— ① auth.uid() 非 NULL ② token hash 相符。
  --    而 d1-supabase-shim.sql:41 把 auth.uid() 釘死回 NULL ⇒ 不處理的話它**永遠**在第①道就 RAISE,
  --    「有 RAISE」被誤讀成「閘二有守住」。⇒ 兩道前置都要在 fixture 裡先讓它過,這一格才在量閘二。
  --    (兩個動作都在本格的交易內、隨 ROLLBACK 一起消失:PG 的 DDL 是交易性的。)
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS 'SELECT pg_catalog.current_setting(''pcm.test_uid'', true)::uuid';
  PERFORM set_config('pcm.test_uid', v_user::text, true);
  UPDATE public.payment_charge_attempts
     SET fallback_token_hash = public.charge_attempt_token_hash(v_token)
   WHERE id = v_attempt;
  IF (SELECT auth.uid()) IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION '格2 前提 FAIL:auth.uid() 沒被墊成本單客人(=%),這一格會退化成量別的東西', v_user;
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.mark_charge_attempt_charged_fallback(v_attempt, v_order, 'L5B0T-REC-2', v_token);
  EXCEPTION WHEN others THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '格2 FAIL:閘二沒擋(superseded+pending 走備軌竟成功)'; END IF;
  IF v_state <> 'P0001' OR v_msg <> 'mark_charge_attempt_charged_fallback: 付款處理失敗' THEN
    RAISE EXCEPTION '格2 FAIL:RAISE 的不是閘二那一種拒絕(SQLSTATE=% 訊息=%)⇒ 又退化成量別的東西', v_state, v_msg;
  END IF;
  SELECT status INTO v_status FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_status <> 'pending' THEN RAISE EXCEPTION '格2 FAIL:被擋下了但 status 動過(%)', v_status; END IF;"

# 格 5:正向 —— superseded_at IS NULL 的 pending → charged 成立、無 anomaly
emit_case 5 "$(seed_attempt pending 0 n NULL false)
  SELECT count(*) INTO v_ano FROM public.payment_double_charge_anomalies;
  PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-5');
  SELECT status, rec_trade_id INTO v_status, v_rec FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_status <> 'charged' OR v_rec <> 'L5B0T-REC-5' THEN
    RAISE EXCEPTION '格5 FAIL:未讓路的 pending 應可正常轉 charged(status=% rec=%)⇒ 閘一擋過頭', v_status, v_rec;
  END IF;
  SELECT count(*) INTO v_n FROM public.payment_double_charge_anomalies;
  IF v_n <> v_ano THEN RAISE EXCEPTION '格5 FAIL:pending→charged 不該建 anomaly(% → %)', v_ano, v_n; END IF;"

# 格 6:正向 —— superseded_at IS NULL 的 released → charged 成立 **且 genesis anomaly 照建**
emit_case 6 "$(seed_attempt released 0 n NULL false)
  SELECT count(*) INTO v_ano FROM public.payment_double_charge_anomalies;
  PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-6');
  SELECT status INTO v_status FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_status <> 'charged' THEN
    RAISE EXCEPTION '格6 FAIL:未讓路的 released 應可 late-success 收斂成 charged(%)', v_status;
  END IF;
  SELECT count(*) INTO v_n FROM public.payment_double_charge_anomalies;
  IF v_n <> v_ano + 1 THEN
    RAISE EXCEPTION '格6 FAIL:released→charged 的 genesis anomaly 沒建(% → %)⇒ 雙扣主訊號不見了', v_ano, v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies
                  WHERE old_attempt_id = v_attempt AND status = 'open'
                    AND refund_target_rec_trade_id = 'L5B0T-REC-6') THEN
    RAISE EXCEPTION '格6 FAIL:genesis 建了但退款標的不是舊 attempt 的 rec';
  END IF;"

# 格 7:正向 —— 未讓路的 charged 同 rec 冪等 ⇒ no-op RETURN(不 RAISE)
emit_case 7 "$(seed_attempt pending 0 n NULL false)
  PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-7');
  PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-7');   -- 同 rec 重放
  SELECT status INTO v_status FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_status <> 'charged' THEN RAISE EXCEPTION '格7 FAIL:同 rec 冪等重放後 status=%', v_status; END IF;"

# 格 9a:legacy `charged` + `superseded` 走 markCharged 腿 ⇒ **RAISE**(不得走冪等分支成功)
#   這格釘的是閘的**位置**:閘一若排在 charged 冪等分支之後,同 rec 重放會 RETURN 成功 = 閘破而全綠。
emit_case 9a "$(seed_attempt pending 0 n NULL false)
  PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-9A');   -- 先合法轉 charged
  UPDATE public.payment_charge_attempts                                             -- owner 直寫:造 legacy 形狀
     SET released_at = pg_catalog.now() - interval '2 hours',
         superseded_at = pg_catalog.now() - interval '1 hour',
         superseded_reason = 'record_not_found'
   WHERE id = v_attempt;
  v_ok := false; v_state := ''; v_msg := '';
  BEGIN
    PERFORM public.mark_charge_attempt_charged(v_attempt, v_order, 'L5B0T-REC-9A'); -- 同 rec 重放
  EXCEPTION WHEN others THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '格9a FAIL:charged+superseded 同 rec 重放竟走冪等分支成功 ⇒ 閘一位置錯(排到冪等之後)';
  END IF;
  -- 🔴 同格 1 的理由:這一格的價值全在「**是閘一**擋的」,不是「有東西擋了」。
  IF v_state <> 'P0001' OR v_msg <> 'mark_charge_attempt_charged: 付款處理失敗' THEN
    RAISE EXCEPTION '格9a FAIL:RAISE 的不是閘一那一種拒絕(SQLSTATE=% 訊息=%)', v_state, v_msg;
  END IF;"

# 格 10:甲 —— 被讓路 attempt 逐輪 claim 八次、第九次 claim 不到(🔴 禁止直接 seed count=8)
emit_case 10 "$(seed_attempt released 0 y NULL false)
  FOR v_i IN 1..8 LOOP
    SELECT count(*) INTO v_hit FROM public.claim_stuck_unsettled_attempts(0, 1000) c WHERE c.attempt_id = v_attempt;
    IF v_hit <> 1 THEN RAISE EXCEPTION '格10 FAIL:第 % 輪應 claim 得到(實得 %)', v_i, v_hit; END IF;
    UPDATE public.payment_charge_attempts SET next_settle_at = NULL WHERE id = v_attempt;  -- owner 直寫:模擬 lease 到期
  END LOOP;
  SELECT settle_attempt_count INTO v_n FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_n <> 8 THEN RAISE EXCEPTION '格10 FAIL:八輪後 count 應為 8(實得 %)', v_n; END IF;
  SELECT count(*) INTO v_hit FROM public.claim_stuck_unsettled_attempts(0, 1000) c WHERE c.attempt_id = v_attempt;
  IF v_hit <> 0 THEN RAISE EXCEPTION '格10 FAIL:第九輪不該 claim 得到(實得 %)⇒ ceiling 沒生效', v_hit; END IF;"

# 格 11:甲 —— 達 ceiling 後 markSettleRetry ⇒ needs_manual_review = true
#   點名 RPC = mark;count=8 由 owner 直寫(§5.0:非點名的前置不走守門)
emit_case 11 "$(seed_attempt released 8 y NULL false)
  SELECT public.mark_attempt_settle_retry(v_attempt, 8, 'record_not_found') INTO v_n;
  IF v_n <> 1 THEN RAISE EXCEPTION '格11 FAIL:markSettleRetry 應影響 1 列(實得 %)', v_n; END IF;
  SELECT needs_manual_review INTO v_flag FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_flag IS NOT TRUE THEN
    RAISE EXCEPTION '格11 FAIL:讓路族達 ceiling 後 needs_manual_review 應為 true(實得 %)⇒ 停住了但沒人知道', v_flag;
  END IF;"

# 格 12:甲 —— 被標起來的旗標,告警計數必須算得到(基線 → +1 增量比對)
emit_case 12 "$(seed_attempt released 8 y NULL false)
  SELECT (public.get_payment_anomaly_alert_summary(86400, 43200, 600) ->> 'attempt_manual_review_count')::integer INTO v_before;
  SELECT public.mark_attempt_settle_retry(v_attempt, 8, 'record_not_found') INTO v_n;
  SELECT needs_manual_review INTO v_flag FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_flag IS NOT TRUE THEN
    RAISE EXCEPTION '格12 FAIL(改② 面):旗標沒被標起來 ⇒ 本格量不到改③';
  END IF;
  SELECT (public.get_payment_anomaly_alert_summary(86400, 43200, 600) ->> 'attempt_manual_review_count')::integer INTO v_after;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION '格12 FAIL(改③ 面):attempt_manual_review_count 應由 % 增為 %(實得 %)⇒ 標了但告警看不到',
                    v_before, v_before + 1, v_after;
  END IF;"

# 格 13:甲的負向對照 —— 未讓路的 released(count 早已 >8)仍繞 ceiling/manual、仍被 claim(R1c1 零回歸)
emit_case 13 "$(seed_attempt released 12 n NULL false)
  SELECT count(*) INTO v_hit FROM public.claim_stuck_unsettled_attempts(0, 1000) c WHERE c.attempt_id = v_attempt;
  IF v_hit <> 1 THEN
    RAISE EXCEPTION '格13 FAIL:未讓路的 released 應仍被 claim(實得 %)⇒ R1c1 行為回歸', v_hit;
  END IF;"

# 格 15:甲 —— 結案(close_released_attempt → failed)之後告警計數必須回落(改③ 的 terminal 排除)
#   旗標由 owner 直寫 seed(不經 mark)⇒ 本格只驗 close + 計數這一段,不與改② 綁在一起
emit_case 15 "$(seed_attempt released 8 y NULL true)
  SELECT (public.get_payment_anomaly_alert_summary(86400, 43200, 600) ->> 'attempt_manual_review_count')::integer INTO v_before;
  IF v_before < 1 THEN
    RAISE EXCEPTION '格15 FAIL(前提被打穿):結案前計數應算得到這列,實得 % ⇒ 本格失去判別力(不是恆綠、是不成立)', v_before;
  END IF;
  PERFORM public.close_released_attempt(v_attempt, 'l5b0-verify 格15 結案');
  SELECT (public.get_payment_anomaly_alert_summary(86400, 43200, 600) ->> 'attempt_manual_review_count')::integer INTO v_after;
  IF v_after <> v_before - 1 THEN
    RAISE EXCEPTION '格15 FAIL:結案後計數應由 % 回落為 %(實得 %)⇒ 已結案的列永久留在計數裡、變底噪',
                    v_before, v_before - 1, v_after;
  END IF;"

# 格 16(改④;關卡2 R1-MF1 的直接證據)——**既有列**:讓路 + count 早已 >8 + lease 到期 + 非 manual。
#   claim 永遠碰不到它(count>=8)⇒ 只有 expire 收得到;沒有改④ 時本格必紅。
#   ⚠️ 刻意**不接**告警計數斷言:那條由格 12 負責。接了會讓 M8(改③ 放寬拿掉)連帶染紅本格 = 多紅。
emit_case 16 "$(seed_attempt released 12 y "pg_catalog.now() - interval '1 minute'" false)
  SELECT count(*) INTO v_hit FROM public.claim_stuck_unsettled_attempts(0, 1000) c WHERE c.attempt_id = v_attempt;
  IF v_hit <> 0 THEN RAISE EXCEPTION '格16 前提 FAIL:count>=8 的列不該被 claim 到(實得 %)', v_hit; END IF;
  SELECT public.expire_stuck_attempts_at_ceiling() INTO v_n;
  IF v_n < 1 THEN RAISE EXCEPTION '格16 FAIL:expire 應至少轉換 1 列(實得 %)', v_n; END IF;
  SELECT needs_manual_review INTO v_flag FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_flag IS NOT TRUE THEN
    RAISE EXCEPTION '格16 FAIL:既有 count>=8 的讓路列沒被 expire 標人工 ⇒ 旗標永遠 false、告警恆零(MF1 原病)';
  END IF;"

# 格 17(格 16 的負向對照 = 收窄版 SWEEP-6)—— 未讓路的 released 不得被 expire 碰。
#   本格若紅,代表改④ 寫成了裸 superseded_at IS NOT NULL 或直接收整族 released ⇒ R1c1 行為回歸、假告警。
emit_case 17 "$(seed_attempt released 12 n "pg_catalog.now() - interval '1 minute'" false)
  SELECT public.expire_stuck_attempts_at_ceiling() INTO v_n;
  SELECT needs_manual_review INTO v_flag FROM public.payment_charge_attempts WHERE id = v_attempt;
  IF v_flag IS NOT FALSE THEN
    RAISE EXCEPTION '格17 FAIL:未讓路的 released 被 expire 標了人工 ⇒ R1c1 行為回歸、假告警';
  END IF;"

CELLS="1 2 5 6 7 9a 10 11 12 13 15 16 17"

# 向量 = 逐格 1/0 字串(1=綠)。突變時與 EXPECT 精確比對,**多紅少紅皆判失敗**。
run_vector() {
  local c out=""
  for c in $CELLS; do
    if run_case "$c"; then out="${out}1"; else out="${out}0"; fi
  done
  printf '%s' "$out"
}

CELL_COUNT="$(set -- $CELLS; echo $#)"
echo "== 行為格 ×${CELL_COUNT} (attempt 面;每格獨立 psql + BEGIN/ROLLBACK) =="
BASE_VEC="$(run_vector)"
i=0
for c in $CELLS; do
  i=$((i+1))
  if [ "${BASE_VEC:$((i-1)):1}" = "1" ]; then ok "格 $c"; else bad "格 $c — ${CELL_ERR:-}"; fi
done
ALL_GREEN="$(printf '1%.0s' $CELLS)"
[ "$BASE_VEC" = "$ALL_GREEN" ] && ok "對照組向量全綠($BASE_VEC)" || bad "對照組向量=$BASE_VEC 期望=$ALL_GREEN"

# ══════════════════════════════════════════════════════════
# 突變矩陣(plan §5.2;本片=M1,M2,M3,M6,M7,M8,M9)
# ══════════════════════════════════════════════════════════
# 形制照 a8c2-verify.sh:把 live 定義 dump 出來 → 錨點取代 → 重套 → 跑向量 → 還原。
# 🔴 錨點唯一性由 python 端強制(命中數 <> 1 立即中止)——「我以為只有一處」是這類腳本最常見的假綠來源。
# 🔴 期望值寫成**該發突變應該紅的格名清單**、不是手數的位元字串:
#    手數位元在格數變動時會靜默錯位,而錯位的向量照樣「比對成功」= 橡皮圖章。
# 🔴 M11/M12 的存在理由:格 17/13 是負向對照,在 M1-M10 之下**全綠**。
#    不另外構造能讓它們紅的突變,「R1c1 零回歸」就只是一句沒被測過的斷言
#    (memory feedback_negative-test-observation-supplied-by-another-mechanism)。
echo "== 突變矩陣 ×${CELL_COUNT} 格 =="

base_file() { printf '%s/base-%s.sql' "$CASEDIR" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"; }
for S in "$SIG_MARK" "$SIG_FB" "$SIG_CLAIM" "$SIG_RETRY" "$SIG_SUM" "$SIG_EXP"; do
  psql "$URL" -qtAX -c "SELECT pg_get_functiondef('$S'::regprocedure)" > "$(base_file "$S")"
  test -s "$(base_file "$S")" || { echo "🔴 dump $S 失敗;拒跑"; exit 1; }
done

restore_all() {
  local S
  for S in "$SIG_MARK" "$SIG_FB" "$SIG_CLAIM" "$SIG_RETRY" "$SIG_SUM" "$SIG_EXP"; do
    psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$(base_file "$S")" >/dev/null 2>&1
  done
}
trap 'restore_all; rm -rf "$CASEDIR"' EXIT

# 標的簽章 → 它的基準 prosrc 指紋(獨立函式;寫在 $( ) 裡的多行 case 會被 shell 當語法錯誤,
# 而那個錯誤會讓「空包彈檢查」與「還原檢查」**雙雙變成恆真** —— 一次踩到兩個假綠)
base_prosrc() {
  case "$1" in
    "$SIG_MARK")  printf '%s' "$PROSRC_M_G1" ;;
    "$SIG_FB")    printf '%s' "$PROSRC_M_G2" ;;
    "$SIG_CLAIM") printf '%s' "$PROSRC_S_C1" ;;
    "$SIG_RETRY") printf '%s' "$PROSRC_S_C2" ;;
    "$SIG_SUM")   printf '%s' "$PROSRC_S_C3" ;;
    "$SIG_EXP")   printf '%s' "$PROSRC_S_C4" ;;
    *) printf '%s' "UNKNOWN_TARGET" ;;
  esac
}

gen_mutant() { # $1=突變名 $2=來源 dump $3=輸出
  python3 - "$1" "$2" "$3" <<'PYEOF'
import sys
name, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit("anchor 命中 %d 次(必須恰 1):%s" % (src.count(anchor), anchor[:60]))
    return src.replace(anchor, repl)
GATE = """  IF v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
CLAIM3 = """             OR ( a.status = 'released'
                  AND a.superseded_at IS NOT NULL      -- 讓路那族:回到 manual/ceiling 閘、8 輪後轉人工
                  AND a.needs_manual_review = false
                  AND a.settle_attempt_count < 8 )
"""
RETRY_OR = "( (a.status IN ('pending', 'charged') OR a.superseded_at IS NOT NULL)"
SUM_WIDE = """          AND ( a.status = 'pending'
                OR ( a.superseded_at IS NOT NULL
                     AND a.status IN ('charged', 'released') ) )
"""
EXP_STATUS = """       AND ( a.status IN ('pending', 'charged')
             OR ( a.status = 'released' AND a.superseded_at IS NOT NULL ) )
"""
CLAIM2 = """             OR ( a.status = 'released'
                  AND a.superseded_at IS NULL )        -- 未讓路的 released:維持 R1c1 繞閘、行為不回歸
"""
if   name == 'M1': out = sub("IF v_row.superseded_at IS NOT NULL THEN", "IF v_row.superseded_at IS NULL THEN")
elif name == 'M2': out = sub(GATE, "  -- M2 mutant:閘一整條拿掉")
elif name == 'M3': out = sub(GATE, "  -- M3 mutant:閘二整條拿掉")
elif name == 'M6': out = sub(CLAIM3, "")
elif name == 'M7': out = sub(RETRY_OR, "( (a.status IN ('pending', 'charged'))")
elif name == 'M8': out = sub(SUM_WIDE, "          AND a.status = 'pending'\n")
elif name == 'M9': out = sub(SUM_WIDE, """          AND ( a.status = 'pending'
                OR a.superseded_at IS NOT NULL )
""")
elif name == 'M10': out = sub(EXP_STATUS, "       AND a.status IN ('pending', 'charged')\n")
elif name == 'M11': out = sub(EXP_STATUS, """       AND ( a.status IN ('pending', 'charged')
             OR a.status = 'released' )
""")
elif name == 'M12': out = sub(CLAIM2, "")
else: sys.exit("unknown mutant " + name)
open(out_p, 'w').write(out)
PYEOF
}

# 突變 → 標的簽章 / 應該紅的格(其餘格必須維持綠;多紅少紅皆判失敗)
mut_target() {
  case "$1" in
    M1|M2) printf '%s' "$SIG_MARK" ;;
    M3)    printf '%s' "$SIG_FB" ;;
    M6)    printf '%s' "$SIG_CLAIM" ;;
    M7)    printf '%s' "$SIG_RETRY" ;;
    M8|M9) printf '%s' "$SIG_SUM" ;;
    M10|M11) printf '%s' "$SIG_EXP" ;;
    M12)   printf '%s' "$SIG_CLAIM" ;;
  esac
}
mut_reds() {
  case "$1" in
    M1) echo "1 5 6 7 9a" ;;
    M2) echo "1 9a" ;;
    M3) echo "2" ;;
    M6) echo "10" ;;
    M7) echo "11 12" ;;
    M8) echo "12 15" ;;
    M9) echo "15" ;;
    M10) echo "16" ;;
    M11) echo "17" ;;
    M12) echo "13" ;;
  esac
}
# 紅格清單 → 向量(避免手數位元錯位)
reds_to_vec() {
  local reds=" $1 " c out=""
  for c in $CELLS; do
    case "$reds" in *" $c "*) out="${out}0" ;; *) out="${out}1" ;; esac
  done
  printf '%s' "$out"
}

for M in M1 M2 M3 M6 M7 M8 M9 M10 M11 M12; do
  TGT="$(mut_target "$M")"
  if ! ERR="$(gen_mutant "$M" "$(base_file "$TGT")" "$CASEDIR/mutant.sql" 2>&1)"; then
    bad "$M 錨點 preflight — $ERR"; continue
  fi
  if ! psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$CASEDIR/mutant.sql" >/dev/null 2>&1; then
    bad "$M 套用失敗"; restore_all; continue
  fi
  # 🔴 套上去了但真的變了嗎:prosrc 必須與基準不同,否則這一發突變是空包彈、後面的向量比對全無意義
  NEWSRC="$(q "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$TGT'::regprocedure")"
  BASESRC="$(base_prosrc "$TGT")"
  if [ "$NEWSRC" = "$BASESRC" ]; then bad "$M prosrc 未變(空包彈)"; restore_all; continue; fi

  VEC="$(run_vector)"
  EXP="$(reds_to_vec "$(mut_reds "$M")")"
  if [ "$VEC" = "$EXP" ]; then ok "$M 向量逐格吻合($VEC;應紅=[$(mut_reds "$M")])"
  else bad "$M 向量=$VEC 期望=$EXP(應紅=[$(mut_reds "$M")];最後一則:${CELL_ERR:-})"; fi

  restore_all
  [ "$(q "SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='$TGT'::regprocedure")" = "$BASESRC" ] \
    && ok "$M 還原後 prosrc = 基準" \
    || { bad "$M 還原失敗 ⇒ 立即停損(後續突變的紅會變成連鎖雜訊、無法歸因)"; break; }
done

# ── 零留痕複查(本 harness 全程 ROLLBACK ⇒ 兩張表列數必須與跑前相同)──────────
END_ATT="$(q "SELECT count(*) FROM public.payment_charge_attempts")"
END_ANO="$(q "SELECT count(*) FROM public.payment_double_charge_anomalies")"
# nit(code-reviewer):q() 併了 stderr ⇒ 非數值要當「查不到」處理,不能拿去跟基線比(比錯方向雖安全、但訊息會誤導)
case "$END_ATT$END_ANO" in *[!0-9]*) bad "零留痕複查取不到數值(att=$END_ATT ano=$END_ANO)"; END_ATT="?"; END_ANO="?";; esac
[ "$END_ATT" = "$BASE_ATT" ] && [ "$END_ANO" = "$BASE_ANO" ] \
  && ok "零留痕:attempts $BASE_ATT→$END_ATT、anomalies $BASE_ANO→$END_ANO" \
  || bad "🔴 有留痕:attempts $BASE_ATT→$END_ATT、anomalies $BASE_ANO→$END_ANO"

echo "─────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
