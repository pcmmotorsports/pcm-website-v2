#!/usr/bin/env bash
# ============================================================
# OP3 行為 harness ——「confirm_order_payment 擴充成同交易寫 card 腿」的那一半
#
# 🔴 為什麼要有這支(照 op2b-verify.sh 的分工):OP3 的 migration 只做**不依賴業務資料**的
#    結構斷言(md5 前置閘 / 碼錨 / 順序錨 / SECDEF 可寫性 / gate 已不在)。而 OP3 真正的行為
#    ——「付款確認同交易落一列 card 腿、冪等重放不落第二列、拒絕路徑一列都不落」——
#    全部需要一張真的 unpaid 訂單當 fixture,而 migration 不得依賴業務資料存在
#    (OP2b 第一版讓 migration 抓真 orders 當 fixture,實跑當場證明那讓它在任何空庫都套不上)。
#    ⇒ 那些格在這裡跑,這裡有種子資料。
#
# 🔴🔴 **本 harness 以 `payment_confirmer` 身分呼叫 confirm,不是以 postgres。**
#    OP3 的 card 腿 `actor = session_user`(Sean 拍 A′),而 `actor` 是 NOT NULL FK 到 staff。
#    以 postgres 呼叫時 `session_user='postgres'`、staff 查無此列 ⇒ 會紅在 P2B36 守門
#    (那正是 G9 要證的東西)。⇒ 正向格必須 `SET LOCAL SESSION AUTHORIZATION 'payment_confirmer'`,
#    否則測的根本不是正式路徑。**不得**改成「幫 postgres 也 seed 一列 staff」來讓測試變綠 ——
#    那會讓 G9 與 P2B36 整條守門變成恆真(memory `feedback_fixture-value-makes-guard-vacuous`)。
#    切換只包住 confirm 那一句:fixture 查詢與事後斷言仍需 postgres 權限(payment_confirmer
#    對 orders / order_payments 零權限)。
#
# 覆蓋(十三格 + 對照組;all 模式另有 teardown 與埠的兩道零留痕判定):
#   G0 自我測試 壞掉的 SQL 必須被判紅(判定本身有效)
#   G1 對照組  OP2b 終態(四支 trigger 在、dormant gate 已不在)+ confirm 帶 card 腿碼錨
#              + staff 的 payment_confirmer 列在且停用 ⇒ 不是這個狀態就別往下跑
#   G2 正測    unpaid 訂單付款確認:orders 翻 paid **且** order_payments 恰落一列,
#              **十六欄逐欄**驗(有給值的比值、沒給值的必須仍是 NULL)
#   G3 正測    冪等重放(同 rec 同額)回 idempotent=true **且不落第二列**
#   G4 負測    A8c2 取消守門回歸:已取消的單拒確認 **且零落帳**(證明我沒蓋掉守門)
#   G5 負測    A8c2 隔離閘回歸:REPEATABLE READ ⇒ P8C01 **且零落帳**
#   G6 負測    金額不符 ⇒ 拒 **且零落帳**,且不得把單翻成 paid
#   G7 負測    撞 order_payments 的**全域** rec 唯一 ⇒ 回通用訊息(PF-E)、不洩 23505/約束名
#   G8 負測    orders 翻 paid 與 card 腿是**同一筆交易**:card 腿寫不進去時 orders 不得留在 paid
#   G9 負測    錯身分**兩形狀**都要紅在 P2B36:①postgres(無 staff 列)②有 staff 列的錯角色
#              🔴 ② 是真正危險的那個:舊版只問「有沒有同名 staff」時它會全綠,而 actor 已寫錯人
#   G10 負測   BEFORE INSERT 回 NULL **靜默吞列** ⇒ 必須紅在 P2B37(本片最危險的失敗形狀)
#   G11 負測   refunded / partiallyPaid 兩態拒確認且狀態不被改回 paid(復活路徑回歸)
#   G12 負測   total<=0 收斂成 PF-E,不得噴 raw 23514(DETAIL 會外洩整列)
#
# ⚠️ **已知邊界(誠實列出,不假裝關完;codex 關卡2 nit,他說得對)**:
#   · G3 的兩次 confirm 在**同一筆交易內**,證的是交易內重入;**跨連線 retry 與兩 session 真並發
#     沒有測到**。擋後者的是 orders 的 FOR UPDATE 串行化 + 兩道 partial unique,那是讀碼推論、
#     不是本檔量到的。要真的測需要跨 session 併發 harness(同 w6 家族的形狀)= 另一片的工。
#   · `SET LOCAL SESSION AUTHORIZATION` 只換函式內看到的 `session_user`,**繞過真實 LOGIN、
#     Supabase pooler 與正式 DSN** ⇒ 本檔全綠**不等於**正式站真的以 payment_confirmer 登入。
#     那一半只有 apply 後對正式連線實測才算數(見 migration 檔頭的部署不變式那段)。
#
# 🔴 判定紀律(同 op2b-verify.sh):每格自己比 SQLSTATE 或訊息;fail-closed(psql 退出碼 + sentinel);
#    每格跑完驗 order_payments 零殘列(所有寫入都在交易內、跑完 ROLLBACK)。
# 🔴 負測哨兵用專屬碼 P2BF0,handler 第一行 re-raise(op2b-verify.sh 的 Fable R3 N1 教訓):
#    哨兵若用預設 P0001 會被同格的 WHEN others 撈回去,印成「被擋但 SQLSTATE=P0001」——
#    紅是紅了,但診斷字面完全誤導(實況是寫入被放行,不是被別條擋)。
# 🔴 本檔所有 SQL 包在 bash 雙引號字串裡 ⇒ SQL 註解內**不得出現反引號、不得出現 ASCII 雙引號**
#    (反引號被 shell 當命令替換執行、雙引號當場截斷字串;B-385-CHECKPOINT 記的兩個實踩坑)。
#
# 用法:
#   bash scripts/op3-verify.sh all <workdir>          # provision -> 跑 -> teardown
#   PORT=54371 bash scripts/op3-verify.sh run /tmp/x  # 對已起好的庫跑
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: op3-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54371}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

# 🔴🔴 **自檢:SQL 註解內不得出現反引號 / ASCII 雙引號(機制,不是靠記憶)。**
#    本檔所有 SQL 包在 bash 雙引號字串裡 ⇒ 反引號會被 shell 當**命令替換執行**、
#    雙引號會當場截斷字串。症狀陰險:格照樣綠,只有 stderr 冒出 command not found,
#    而註解文字已被悄悄換成命令輸出。本 session 我自己踩了三次(B-385 也記過)
#    ⇒ 改成開跑前機械掃描,踩到當場 exit 2。
#    判準:縮排的 SQL 註解行(`^[[:space:]]+--`);bash 自己的 `#` 註解不受影響。
SELF_BAD="$(grep -nE '^[[:space:]]+--.*[`"]' "${BASH_SOURCE[0]}" || true)"
if [ -n "$SELF_BAD" ]; then
  echo "🔴 自檢失敗:SQL 註解含反引號或 ASCII 雙引號(會被 shell 執行/截斷),請改成純文字:"
  printf '%s\n' "$SELF_BAD" | head -10
  exit 2
fi

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }

# workdir 身分閘(all 模式對它跑 rm -rf)。逐條擋 /tmp//、尾斜線、連續斜線、..、symlink
# —— 與 op2b-verify.sh 同款,理由見該檔(/tmp/?* 會放行 /tmp//)。
case "$WORK" in
  /tmp/[!/]*) : ;;
  *) echo "🔴 workdir 必須是 /tmp/<名字>(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in
  */)   echo "🔴 workdir 不得以斜線結尾(收到:$WORK)"; exit 2 ;;
  *//*) echo "🔴 workdir 不得含連續斜線(收到:$WORK)"; exit 2 ;;
  *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;;
esac
[ -L "$WORK" ] && { echo "🔴 workdir 是 symlink(收到:$WORK)"; exit 2; }

require_free_port() {
  command -v lsof >/dev/null 2>&1 || {
    echo "🔴 找不到 lsof ⇒ 埠檢查做不到,拒絕往下跑(fail-closed)"; exit 2; }
  local pids; pids="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -z "$pids" ] || { echo "🔴 port ${PORT} 被佔用(pid: $(echo "$pids" | tr '\n' ' '))⇒ 換 PORT 重跑"; exit 2; }
}

cluster_identity() {
  local dd; dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
  [ "$dd" = "$WORK/pgdata" ] || {
    echo "🔴 身分閘:PORT=${PORT} 連到的 data_directory=${dd:-<查不到>},期望 ${WORK}/pgdata ⇒ 連錯庫,拒繼續"; exit 2; }
}

run_case() {
  local name="$1" sentinel="$2" sql="$3" out rc rows
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    bad "$name:psql rc=$rc ⇒ $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1; fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:退出碼 0 但 sentinel「$sentinel」不在輸出裡 ⇒ 判定無效"; return 1; fi
  rows="$(psql "$URL" -qtA -c 'SELECT count(*) FROM public.order_payments' 2>/dev/null)"
  if [ "$rows" != "0" ]; then
    bad "$name:跑完本表有 $rows 列 ⇒ 沒 ROLLBACK 乾淨,錢帳被測試污染"; return 1; fi
  ok "$name"
}

# 🔴 fixture:挑一張**乾淨的 unpaid 單** —— 未取消、沒帶 rec_trade_id、且沒有取消紀錄。
#    三個條件缺一,confirm 會紅在別的守門,而那格證的就不是我要證的東西。
FIXTURE=$'  SELECT o.id, o.total INTO v_o, v_total\n    FROM public.orders o\n   WHERE o.payment_status = \'unpaid\'::public.payment_status\n     AND o.cancelled_at IS NULL\n     AND o.tappay_rec_trade_id IS NULL\n     AND NOT EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = o.id)\n   ORDER BY o.created_at LIMIT 1;\n  IF v_o IS NULL THEN\n    RAISE EXCEPTION \'fixture 不足:找不到乾淨的 unpaid 單 ⇒ 這輪沒有證據\';\n  END IF;'

# 🔴 身分切換只包住 confirm 那一句。fixture 與事後斷言要 postgres 權限,
#    payment_confirmer 對 orders / order_payments 是零權限(它只有函式的 EXECUTE)。
AS_PC=$'  EXECUTE \'SET LOCAL SESSION AUTHORIZATION \' || quote_literal(\'payment_confirmer\');'
AS_PG=$'  EXECUTE \'RESET SESSION AUTHORIZATION\';'

if [ "$MODE" = "all" ]; then
  log "0/13 provision 拋棄式 PG17(含 OP3)"
  require_free_port
  # 🔴 路徑形狀閘只證明 $WORK 長得像 /tmp/名字,**不證明它是我建的**。傳一個既有的
  #    /tmp/shared 進來會形狀全過、然後 rm -rf 掉別人的資料 ⇒ 沿用本 repo 既有的
  #    ownership marker(.d1t2-harness,provision 建目錄時寫入),不自己另發明一種標記。
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 已存在但缺 .d1t2-harness ownership marker ⇒ 這不是本 harness 家族建的目錄,拒絕 rm -rf"; exit 2
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  ok "provision 完成"
fi
cluster_identity

log "1/13 G0 harness 自我測試"
if run_case "G0(應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 判定失效"; echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1)); ok "G0:壞掉的 SQL 會被判紅"

log "2/13 G1 對照組:OP2b 終態 + card 腿碼錨 + 系統身分列"
# 🔴 這格證的是「這個庫真的套過 OP3」。少了它,OP3 沒套上時 G2 會紅在「零列」,
#    而那個紅看起來像行為錯誤、不像沒套 migration —— 診斷會被帶去錯的方向。
run_case "G1 四支 trigger + gate 已移除 + card 腿碼錨 + payment_confirmer 列停用中" "OP3-G1-OK" "
DO \$g1\$
DECLARE v_names text; v_n integer; v_def text;
BEGIN
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION '這個庫不是 OP2b 的終態(trigger=%)⇒ OP3 的行為驗的是 OP2b 之後', coalesce(v_names,'(無)');
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers' AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'dormant gate 還在 ⇒ OP2b 沒 apply,OP3 的 INSERT 一定撞 CHECK (false)'; END IF;
  v_def := pg_catalog.pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure);
  -- 🔴 用 pg_catalog.strpos 不用 position(x in y):後者是**特殊語法**、不能加 schema 前綴,
  --    寫成 pg_catalog.position(… in …) 會 syntax error(本檔第一版實踩;與 session_user
  --    不能寫成 pg_catalog.session_user 同族 —— 關鍵字/特殊語法不是函式)。
  IF pg_catalog.strpos(v_def, 'INSERT INTO public.order_payments') = 0 THEN
    RAISE EXCEPTION 'confirm_order_payment 裡沒有 card 腿的 INSERT ⇒ 這個庫沒套過 OP3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = 'payment_confirmer' AND s.is_active = false) THEN
    RAISE EXCEPTION 'staff 的 payment_confirmer 列不存在或不是停用狀態 ⇒ OP3 的 seed 沒到位';
  END IF;
  RAISE NOTICE 'OP3-G1-OK';
END
\$g1\$;"

log "3/13 G2 正測:付款確認同交易落一列 card 腿,十六欄逐欄"
# 🔴 只驗「有一列」不夠:rail 寫錯、amount 寫成別的數、received_at 落成未來、
#    actor 寫成 current_user(=owner postgres)、或 trigger 自己補了一個值,單看列數全都是綠的。
#    ⇒ 逐欄比:有給值的比值,沒給值的必須仍是 NULL(op2b-verify.sh G2 同款紀律)。
run_case "G2 落一列 card 腿:orders 翻 paid + 十六欄逐欄正確(actor=payment_confirmer)" "OP3-G2-OK" "
BEGIN;
DO \$g2\$
DECLARE v_o uuid; v_total integer; v_res jsonb; v_n integer;
        v_row public.order_payments%ROWTYPE; v_bad text; v_status text;
        v_t0 timestamptz := now();
BEGIN
$FIXTURE
$AS_PC
  v_res := public.confirm_order_payment(v_o, v_total, 'OP3-G2-REC');
$AS_PG
  IF v_res IS DISTINCT FROM pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false) THEN
    RAISE EXCEPTION '回傳不是 {confirmed:true, idempotent:false}(實得 %)', v_res;
  END IF;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'paid' THEN RAISE EXCEPTION 'orders 沒翻 paid(實得 %)', v_status; END IF;

  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN RAISE EXCEPTION 'card 腿落了 % 列(期望恰 1)', v_n; END IF;
  SELECT * INTO v_row FROM public.order_payments WHERE order_id = v_o;

  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN v_row.order_id            IS DISTINCT FROM v_o            THEN 'order_id' END,
    CASE WHEN v_row.rail                IS DISTINCT FROM 'card'         THEN 'rail(' || coalesce(v_row.rail,'NULL') || ')' END,
    CASE WHEN v_row.amount              IS DISTINCT FROM v_total        THEN 'amount(' || coalesce(v_row.amount::text,'NULL') || ' 應為 ' || v_total || ')' END,
    CASE WHEN v_row.rec_trade_id        IS DISTINCT FROM 'OP3-G2-REC'   THEN 'rec_trade_id' END,
    -- 🔴 actor 必須是 session_user(payment_confirmer),**不是** current_user(owner postgres)。
    --    寫成後者的話稽核會把每一筆刷卡記成 postgres 做的,而列數與金額全綠。
    CASE WHEN v_row.actor               IS DISTINCT FROM 'payment_confirmer'
           THEN 'actor(' || coalesce(v_row.actor,'NULL') || ' 應為 payment_confirmer=session_user;寫成 postgres 表示用了 current_user)' END,
    -- received_at 必須落在本交易的時間窗內。下界用 now()(交易開始時刻)不是 clock_timestamp():
    -- clock_timestamp() 嚴格晚於 now(),拿它當下界會把合法的列判成早於窗(op2b-verify.sh 實踩過)。
    CASE WHEN v_row.received_at IS NULL
           OR v_row.received_at < v_t0
           OR v_row.received_at > clock_timestamp() THEN 'received_at(不在本交易時間窗內:' || coalesce(v_row.received_at::text,'NULL') || ')' END,
    CASE WHEN v_row.created_at IS NULL
           OR v_row.created_at < v_t0
           OR v_row.created_at > clock_timestamp() THEN 'created_at(不在本交易時間窗內)' END,
    -- 沒給值的欄必須仍是 NULL:擋 trigger 或 writer 自己補值
    CASE WHEN v_row.reverses_payment_id IS NOT NULL THEN 'reverses_payment_id(收款列不該有)' END,
    CASE WHEN v_row.bank_reference      IS NOT NULL THEN 'bank_reference(card 軌不該有)' END,
    CASE WHEN v_row.request_id          IS NOT NULL THEN 'request_id(card 軌不該有)' END,
    CASE WHEN v_row.reversal_reason     IS NOT NULL THEN 'reversal_reason(收款列不該有)' END,
    CASE WHEN v_row.payer_note          IS NOT NULL THEN 'payer_note(沒給值卻有值)' END,
    CASE WHEN v_row.note                IS NOT NULL THEN 'note(沒給值卻有值)' END,
    CASE WHEN v_row.reviewed_by         IS NOT NULL THEN 'reviewed_by(沒給值卻有值)' END,
    CASE WHEN v_row.reviewed_at         IS NOT NULL THEN 'reviewed_at(沒給值卻有值)' END,
    CASE WHEN v_row.id                  IS NULL     THEN 'id' END);
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'card 腿這些欄不對:%', v_bad;
  END IF;
  RAISE NOTICE 'OP3-G2-OK';
END
\$g2\$;
ROLLBACK;"

log "4/13 G3 正測:冪等重放不落第二列"
# 🔴 這格是 OP3 最貴的一格:重放若落第二列,SUM(amount) 直接把同一筆錢算成兩次。
#    擋它的不是新寫的 INSERT,是 A8c2 既有的 paid 冪等樹提前 RETURN(根本到不了 INSERT)——
#    所以這格同時是「我沒把那棵樹的位置搬到 INSERT 後面」的回歸證據。
run_case "G3 同 rec 同額重放回 idempotent=true 且仍只有一列" "OP3-G3-OK" "
BEGIN;
DO \$g3\$
DECLARE v_o uuid; v_total integer; v_res jsonb; v_n integer;
BEGIN
$FIXTURE
$AS_PC
  PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G3-REC');
  v_res := public.confirm_order_payment(v_o, v_total, 'OP3-G3-REC');
$AS_PG
  IF v_res IS DISTINCT FROM pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true) THEN
    RAISE EXCEPTION '重放回傳不是 idempotent=true(實得 %)', v_res;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '重放後 card 腿有 % 列(期望仍是 1)⇒ 同一筆錢被記了兩次,SUM(amount) 高報', v_n;
  END IF;
  RAISE NOTICE 'OP3-G3-OK';
END
\$g3\$;
ROLLBACK;"

log "5/13 G4 負測:A8c2 取消守門回歸(拒確認且零落帳)"
run_case "G4 取消守門兩個分支(cancelled_at / order_cancellations)都拒確認且零落帳" "OP3-G4-OK" "
BEGIN;
DO \$g4\$
DECLARE v_o uuid; v_total integer; v_n integer; v_msg text;
BEGIN
$FIXTURE
  UPDATE public.orders SET cancelled_at = now() WHERE id = v_o;
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G4-REC');
$AS_PG
    RAISE EXCEPTION '已取消的單竟然確認成功 ⇒ A8c2 取消守門被 OP3 蓋掉了(cancelled_at 那半)' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION '被擋但訊息是 [%](期望 PF-E 通用訊息)', v_msg;
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '拒絕路徑竟然落了 % 列帳', v_n; END IF;

  -- 🔴🔴 **codex 關卡2 must-fix:上一版只測了 cancelled_at 那半。**
  --    A8c2 的取消守門是**兩個分支的 OR**:cancelled_at IS NOT NULL **OR**
  --    EXISTS 取消紀錄。只餵第一個條件的話,把第二個分支整條刪掉
  --    這一格照樣全綠 —— 而第二個分支正是**部分取消**走的路(部分取消不動 orders.cancelled_at,
  --    只在 order_cancellations 留列)。⇒ 補一發只有取消紀錄、cancelled_at 仍為 NULL 的。
  -- 🔴 欄位是實查 A7 建表檔寫的,不是憑印象:reason_code 有值域 CHECK、reason_detail 只有
  --    reason_code='other' 時才准非空、payload_hash 必須是 64 位小寫 hex(兩個 md5 接起來剛好 64)。
  -- 🔴 不必補 order_cancellation_items:a7t 的「取消必須有明細」是
  --    CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED(實查該檔),在 COMMIT 才驗,
  --    而本格跑完 ROLLBACK ⇒ 它不會發火。這是刻意利用、寫下來免得下一個人以為漏了。
  UPDATE public.orders SET cancelled_at = NULL WHERE id = v_o;
  INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_o, 'customer_request', gen_random_uuid(), md5('g4-a') || md5('g4-b'), 'sean');
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G4-REC2');
$AS_PG
    RAISE EXCEPTION '只有 order_cancellations 列(cancelled_at 為 NULL)竟然確認成功 ⇒ 取消守門的第二個分支沒生效'
      USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION '第二分支被擋但訊息是 [%](期望 PF-E 通用訊息)', v_msg;
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '第二分支拒絕路徑竟然落了 % 列帳', v_n; END IF;
  RAISE NOTICE 'OP3-G4-OK';
END
\$g4\$;
ROLLBACK;"

log "6/13 G5 負測:A8c2 隔離閘回歸(P8C01)"
# 🔴 隔離閘要在**交易層級**設定才測得到 ⇒ 這格自己開一個 REPEATABLE READ 交易,
#    不能塞在上面那些 read committed 的交易裡。
run_case "G5 REPEATABLE READ 下紅在 P8C01,且零落帳" "OP3-G5-OK" "
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
DO \$g5\$
DECLARE v_o uuid; v_total integer; v_n integer; v_state text;
BEGIN
$FIXTURE
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G5-REC');
$AS_PG
    RAISE EXCEPTION 'REPEATABLE READ 下竟然確認成功 ⇒ A8c2 隔離閘被 OP3 蓋掉了' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_state <> 'P8C01' THEN RAISE EXCEPTION '被擋但 SQLSTATE=%(期望 P8C01)', v_state; END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '拒絕路徑竟然落了 % 列帳', v_n; END IF;
  RAISE NOTICE 'OP3-G5-OK';
END
\$g5\$;
ROLLBACK;"

log "7/13 G6 負測:金額不符(拒、零落帳、且不得翻單)"
run_case "G6 金額不符拒確認,零落帳且單仍 unpaid" "OP3-G6-OK" "
BEGIN;
DO \$g6\$
DECLARE v_o uuid; v_total integer; v_n integer; v_msg text; v_status text;
BEGIN
$FIXTURE
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total + 1, 'OP3-G6-REC');
$AS_PG
    RAISE EXCEPTION '金額不符竟然確認成功' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION '被擋但訊息是 [%](期望 PF-E 通用訊息)', v_msg;
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '拒絕路徑竟然落了 % 列帳', v_n; END IF;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'unpaid' THEN RAISE EXCEPTION '拒絕路徑竟然把單翻成 %', v_status; END IF;
  RAISE NOTICE 'OP3-G6-OK';
END
\$g6\$;
ROLLBACK;"

log "8/13 G7 負測:撞全域 rec 唯一 ⇒ 回通用訊息(PF-E)"
# 🔴 這格是 OP3 **新開**的面:card 腿的 INSERT 讓既有的 WHEN unique_violation handler
#    多了一個觸發來源(OP3 之前只可能由 orders.tappay_rec_trade_id 那道 UNIQUE 觸發)。
#    構造:先直接在本表放一列帶 rec R 的 card 腿(掛在**別張單**上),再拿同一個 R 去確認本單。
#    本單的 orders.tappay_rec_trade_id 是 NULL ⇒ cross-order pre-check 過得去,
#    真正擋下來的是 order_payments_rec_trade_global_uniq ⇒ 必須被 handler 收成通用訊息,
#    不得把 raw 23505 或約束名洩出去。
run_case "G7 全域 rec 撞唯一時回 PF-E 通用訊息(不洩 23505/約束名)" "OP3-G7-OK" "
BEGIN;
DO \$g7\$
DECLARE v_o uuid; v_total integer; v_other uuid; v_actor text; v_msg text; v_state text; v_n integer;
BEGIN
$FIXTURE
  SELECT o.id INTO v_other FROM public.orders o WHERE o.id <> v_o ORDER BY o.created_at LIMIT 1;
  SELECT s.id INTO v_actor FROM public.staff s WHERE s.id = 'sean';
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_other, 'card', 999, now(), 'OP3-G7-REC', v_actor);
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G7-REC');
$AS_PG
    RAISE EXCEPTION '撞全域 rec 唯一竟然寫進去了 ⇒ 同一筆 TapPay 交易記到了兩張單' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION '被擋但訊息是 [%] / SQLSTATE=% ⇒ 洩了內部狀態,PF-E 沒蓋住新的 INSERT', v_msg, v_state;
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '撞唯一的那筆竟然落了 % 列帳', v_n; END IF;
  RAISE NOTICE 'OP3-G7-OK';
END
\$g7\$;
ROLLBACK;"

log "9/13 G8 負測:orders 翻 paid 與 card 腿同生共死"
# 🔴 這格證的是「同交易」這三個字。card 腿寫不進去時 orders 不得留在 paid ——
#    否則帳面顯示已收款、收款帳本卻查無此筆,而 OP6/OP7 算的是後者。
#    構造失敗的方式:借 G7 的全域 rec 唯一(它擋的是本表的 INSERT,不是 orders 那道)。
run_case "G8 card 腿寫不進時 orders 不得留在 paid" "OP3-G8-OK" "
BEGIN;
DO \$g8\$
DECLARE v_o uuid; v_total integer; v_other uuid; v_actor text; v_status text; v_msg text;
BEGIN
$FIXTURE
  SELECT o.id INTO v_other FROM public.orders o WHERE o.id <> v_o ORDER BY o.created_at LIMIT 1;
  SELECT s.id INTO v_actor FROM public.staff s WHERE s.id = 'sean';
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_other, 'card', 999, now(), 'OP3-G8-REC', v_actor);
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G8-REC');
$AS_PG
    RAISE EXCEPTION 'card 腿撞唯一卻確認成功' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      -- 🔴 nit(codex 關卡2):上一版這裡是裸 NULL,任何**較早的無關錯誤**只要讓訂單維持
      --    unpaid,這格就會宣稱「原子性通過」——那是拿別的失敗當證據。⇒ 釘住它必須是
      --    撞唯一之後的 PF-E 通用訊息,不是隨便哪個紅。
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION 'G8 期望紅在撞唯一的 PF-E 通用訊息,實得 [%] ⇒ 這格證的不是原子性', v_msg;
      END IF;
  END;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'unpaid' THEN
    RAISE EXCEPTION 'card 腿失敗但 orders 停在 %(期望 unpaid)⇒ 翻單與落帳不同生共死,帳面已收款而錢帳查無此筆', v_status;
  END IF;
  RAISE NOTICE 'OP3-G8-OK';
END
\$g8\$;
ROLLBACK;"

log "10/13 G9 負測:沒有 staff 列的角色呼叫 ⇒ P2B36 而非 raw 23503"
# 🔴 這格守的是**部署面**的不變式:actor = session_user,而 session_user 記的是登入角色。
#    以「繼承了 EXECUTE 但自己沒有 staff 列」的角色連線時,每一筆刷卡都會失敗 ——
#    少了 P2B36,現場看到的是一句 raw 23503(洩約束名 order_payments_actor_fkey),
#    而且完全看不出這是部署設定問題、不是訂單問題。
# 🔴 本格刻意**以 postgres 身分**呼叫(不切 payment_confirmer):postgres 是 superuser 拿得到
#    EXECUTE,而 staff 裡沒有叫 postgres 的列 ⇒ 這是現成、非人工捏造的負測身分。
#    ⚠️ 因此**不得**為了讓別的格好寫而幫 postgres seed 一列 staff —— 那會讓本格恆綠。
run_case "G9 錯身分三形狀各紅在**對的那道**守門(conname 逐格比):postgres/錯角色→角色釘、缺 staff 列→staff 釘" "OP3-G9-OK" "
BEGIN;
DO \$g9\$
DECLARE v_o uuid; v_total integer; v_n integer; v_state text; v_con text; v_status text;
BEGIN
$FIXTURE
  IF EXISTS (SELECT 1 FROM public.staff s WHERE s.id = session_user) THEN
    RAISE EXCEPTION '本格的前提破了:session_user=% 在 staff 裡有列 ⇒ 這個負測構造不出來、判定無效', session_user;
  END IF;
  v_con := NULL;  -- 🔴 殘值防護:不清的話下一格比到的是上一格的 conname(本輪 must-fix 的病根)
  BEGIN
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G9-REC');
    RAISE EXCEPTION '沒有 staff 列的角色竟然確認成功 ⇒ actor 寫進了一個不存在的 staff' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      IF v_state = '23503' THEN
        RAISE EXCEPTION '紅在 raw 23503(FK)⇒ P2B36 守門不在或排在 INSERT 之後,現場會看到洩約束名且無法診斷的錯誤';
      END IF;
      IF v_state <> 'P2B36' THEN RAISE EXCEPTION '被擋但 SQLSTATE=%(期望 P2B36)', v_state; END IF;
      -- 🔴 比 conname 不只比 SQLSTATE:兩道守門共用 P2B36,只比碼的話分不出是誰擋的
      IF v_con IS DISTINCT FROM 'pcm_op3_actor_wrong_role' THEN
        RAISE EXCEPTION 'postgres 應紅在角色釘,實得 conname=%', coalesce(v_con,'(NULL)');
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '拒絕路徑竟然落了 % 列帳', v_n; END IF;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'unpaid' THEN RAISE EXCEPTION 'actor 守門擋下了,但單已被翻成 % ⇒ 翻單與落帳不同生共死', v_status; END IF;

  -- 🔴🔴 **codex 關卡2 must-fix:上一版只證「缺 staff 列會擋」。**
  --    真正危險的形狀是**反過來的**:某個角色拿到了 EXECUTE、而 staff 恰好也有同名列
  --    ⇒ 舊守門(只問「有沒有同名 staff」)**全綠**,card 腿的 actor 被寫成那個角色,
  --      列有落、FK 也過、金額也對,**沒有任何斷言看得出經手人是錯的**。
  --    ⇒ 構造那個形狀:建一個有 staff 列、也有 EXECUTE 的角色,它必須仍然被擋。
  -- 🔴🔴 三線審查 must-fix:本格第一版**只取 v_state 沒重取 CONSTRAINT_NAME**
  --    ⇒ 比到的是上一格的 v_con 殘值、**恆真**,而檔頭還宣稱「conname 逐格比」= 宣稱 > 事實。
  --    修法兩半:①每個 handler 都重取 ②每格進入前 v_con := NULL(殘值不可能冒充)。
  CREATE ROLE op3_wrong_role LOGIN;
  GRANT EXECUTE ON FUNCTION public.confirm_order_payment(uuid,integer,text) TO op3_wrong_role;
  INSERT INTO public.staff (id, label, is_active) VALUES ('op3_wrong_role', 'G9 錯角色(測試用)', false);
  v_con := NULL;  -- 🔴 殘值防護:不清的話下一格比到的是上一格的 conname(本輪 must-fix 的病根)
  BEGIN
    EXECUTE 'SET LOCAL SESSION AUTHORIZATION ' || quote_literal('op3_wrong_role');
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G9-REC2');
    EXECUTE 'RESET SESSION AUTHORIZATION';
    RAISE EXCEPTION '有 staff 列的**錯角色**竟然確認成功 ⇒ actor 被寫成 op3_wrong_role,經手人是錯的而沒人看得出來'
      USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_state <> 'P2B36' THEN
        RAISE EXCEPTION '錯角色被擋但 SQLSTATE=%(期望 P2B36 角色釘)', v_state;
      END IF;
      IF v_con IS DISTINCT FROM 'pcm_op3_actor_wrong_role' THEN
        RAISE EXCEPTION '錯角色應紅在角色釘,實得 conname=%', coalesce(v_con,'(NULL)');
      END IF;
  END;

  -- 🔴🔴 **codex R2 must-fix:前兩個子格都紅在角色釘(它排在前面),所以**staff 那道守門
  --    整條刪掉、兩格照樣全綠** —— 被嚴格蘊含的守門唯一症狀就是「寫不出只紅它的負測」
  --    (memory feedback_unconstructible-negative-test-means-noop-guard)。
  --    ⇒ 構造只紅它的那格:角色**是對的**(payment_confirmer),但 seed 的 staff 列被刪掉。
  v_con := NULL;  -- 🔴 殘值防護(同上)
  DELETE FROM public.staff WHERE id = 'payment_confirmer';
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G9-REC3');
$AS_PG
    RAISE EXCEPTION 'staff 列被刪掉卻仍確認成功 ⇒ actor 會撞 FK 或寫進不存在的人' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_state = '23503' THEN
        RAISE EXCEPTION '缺 staff 列時退回 raw 23503 ⇒ staff 那道守門不在(洩約束名、不可診斷)';
      END IF;
      IF v_con IS DISTINCT FROM 'pcm_op3_actor_not_in_staff' THEN
        RAISE EXCEPTION '缺 staff 列應紅在 staff 守門,實得 SQLSTATE=% conname=%', v_state, coalesce(v_con,'(NULL)');
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '錯角色路徑竟然落了 % 列帳', v_n; END IF;
  RAISE NOTICE 'OP3-G9-OK';
END
\$g9\$;
ROLLBACK;"

log "11/13 G10 負測:BEFORE INSERT 回 NULL 靜默吞列 ⇒ 必須紅在 P2B37"
# 🔴🔴 這格守的是本片**最危險**的失敗形狀,也是 codex 關卡2 抓到我漏的那條:
#    BEFORE INSERT trigger 回 NULL 會把那一列**靜默吞掉** —— INSERT 影響 0 列、**不報任何錯**。
#    少了 P2B37,函式會照樣 RETURN 成功、orders 已翻成 paid 並隨交易 commit
#    ⇒ 帳面顯示已收款、收款帳本查無此筆,而且**沒有任何守門會叫**。
# 🔴 trigger 取名 zzz_ 讓它排在既有四支之後發火(名字排序決定發火序)⇒ 模擬的是
#    「別片日後在本表加了一支會吞列的 BEFORE INSERT」,不是把既有守門換掉。
run_case "G10 靜默吞列被 P2B37 擋下,且零落帳、單仍 unpaid" "OP3-G10-OK" "
BEGIN;
DO \$g10\$
DECLARE v_o uuid; v_total integer; v_n integer; v_state text; v_status text;
BEGIN
$FIXTURE
  CREATE FUNCTION public.op3_g10_swallow() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END';
  CREATE TRIGGER zzz_op3_g10_swallow BEFORE INSERT ON public.order_payments
    FOR EACH ROW EXECUTE FUNCTION public.op3_g10_swallow();
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G10-REC');
$AS_PG
    RAISE EXCEPTION '列被吞掉卻回成功 ⇒ 翻單已 commit 成 paid 而錢帳查無此筆,P2B37 沒生效' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_state <> 'P2B37' THEN RAISE EXCEPTION '被擋但 SQLSTATE=%(期望 P2B37 吞列守)', v_state; END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION '吞列路徑竟然落了 % 列帳', v_n; END IF;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'unpaid' THEN
    RAISE EXCEPTION '吞列被擋下了,但單停在 %(期望 unpaid)⇒ 翻單沒跟著回滾', v_status;
  END IF;
  RAISE NOTICE 'OP3-G10-OK';
END
\$g10\$;
ROLLBACK;"

log "12/13 G11 負測:非 unpaid(refunded / partiallyPaid)拒絕樹回歸"
# 🔴 codex 關卡2 must-fix:上一版的矩陣沒有這兩個狀態。整支 RPC 是 CREATE OR REPLACE 換掉的,
#    若「非 unpaid 一律拒」那棵樹連同 UPDATE 的 WHERE predicate 一起退步,
#    已退款的單會被同一個 rec 重新翻回 paid(復活路徑)——而現有每一格都碰不到它。
run_case "G11 refunded / partiallyPaid 兩態都拒確認、零落帳、狀態不被改回 paid" "OP3-G11-OK" "
BEGIN;
DO \$g11\$
DECLARE v_o uuid; v_total integer; v_n integer; v_msg text; v_status text; v_st text;
BEGIN
$FIXTURE
  FOREACH v_st IN ARRAY ARRAY['refunded','partiallyPaid'] LOOP
    UPDATE public.orders SET payment_status = v_st::public.payment_status WHERE id = v_o;
    BEGIN
$AS_PC
      PERFORM public.confirm_order_payment(v_o, v_total, 'OP3-G11-' || v_st);
$AS_PG
      RAISE EXCEPTION '% 的單竟然確認成功 ⇒ 非 unpaid 拒絕樹退步,已退款的單被復活成 paid', v_st
        USING ERRCODE = 'P2BF0';
    EXCEPTION
      WHEN SQLSTATE 'P2BF0' THEN RAISE;
      WHEN others THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        EXECUTE 'RESET SESSION AUTHORIZATION';
        IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
          RAISE EXCEPTION '% 被擋但訊息是 [%](期望 PF-E 通用訊息)', v_st, v_msg;
        END IF;
    END;
    SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
    IF v_n <> 0 THEN RAISE EXCEPTION '% 拒絕路徑竟然落了 % 列帳', v_st, v_n; END IF;
    SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
    IF v_status <> v_st THEN RAISE EXCEPTION '% 的單狀態被改成 % ⇒ 復活路徑打開了', v_st, v_status; END IF;
  END LOOP;
  RAISE NOTICE 'OP3-G11-OK';
END
\$g11\$;
ROLLBACK;"

log "13/13 G12 負測:total<=0 必須收斂成 PF-E,不得噴 raw 23514"
# 🔴 Fable 實跑抓到的邊界:total=0 且 p_amount=0 時金額相等檢查**會過**,
#    然後 card 腿撞 order_payments 的 CHECK (amount <> 0) ⇒ raw **23514**,
#    而 PG 的 DETAIL 會把**整列值**帶出來(繞過 PF-E 不洩內部狀態),app 層又標成可重試。
#    可達性趨零(合法訂單 total 恆正),但後果不對稱 ⇒ 一行守門 + 這一格盯著它。
run_case "G12 total=0 紅在 PF-E 通用訊息(不是 raw 23514、不洩整列)" "OP3-G12-OK" "
BEGIN;
DO \$g12\$
DECLARE v_o uuid; v_total integer; v_n integer; v_msg text; v_state text; v_status text;
BEGIN
$FIXTURE
  -- 🔴 只改 total 會撞 orders_total_balances(total = subtotal + shipping_fee - discount_total)
  --    ⇒ 四欄一起歸零才構造得出 total=0(三欄的 CHECK 都是 >= 0,實查建表檔)。
  --    ⚠️ 這讓 orders.subtotal 與 Σ(order_items.line_total) 不一致 —— 那條是**跨表不變式、DB 沒有 CHECK**
  --       (建表檔自己註明「跨 row 無法表達」)⇒ 構造得出來,且本格跑完 ROLLBACK,不留痕。
  UPDATE public.orders SET subtotal = 0, shipping_fee = 0, discount_total = 0, total = 0 WHERE id = v_o;
  BEGIN
$AS_PC
    PERFORM public.confirm_order_payment(v_o, 0, 'OP3-G12-REC');
$AS_PG
    RAISE EXCEPTION 'total=0 竟然確認成功 ⇒ 落了一列 amount=0 的帳' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      EXECUTE 'RESET SESSION AUTHORIZATION';
      IF v_state = '23514' THEN
        RAISE EXCEPTION 'total=0 紅在 raw 23514 ⇒ total<=0 守門不在,DETAIL 會把整列外洩';
      END IF;
      IF v_msg <> 'confirm_order_payment: 付款確認失敗' THEN
        RAISE EXCEPTION 'total=0 被擋但訊息是 [%] / SQLSTATE=%(期望 PF-E 通用訊息)', v_msg, v_state;
      END IF;
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 0 THEN RAISE EXCEPTION 'total=0 路徑竟然落了 % 列帳', v_n; END IF;
  SELECT payment_status::text INTO v_status FROM public.orders WHERE id = v_o;
  IF v_status <> 'unpaid' THEN RAISE EXCEPTION 'total=0 被擋下但單已翻成 %', v_status; END IF;
  RAISE NOTICE 'OP3-G12-OK';
END
\$g12\$;
ROLLBACK;"

if [ "$MODE" = "all" ]; then
  # 🔴 teardown 失敗不得吞掉(op2b-verify.sh 關卡2 #11):吞掉的話帳面印 FAIL=0 exit 0,
  #    而現場留著一台活的 postmaster 佔著埠。零留痕是宣稱過的驗收 ⇒ 要有對應判定,
  #    並**另外**驗埠真的沒人聽(teardown 退出碼 0 也可能沒停乾淨)。
  if scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1; then
    ok "teardown 完成"
  else
    bad "teardown 失敗 ⇒ 可能留下活叢集(PORT=${PORT}、workdir=${WORK}),請手動 pg_ctl stop 後刪目錄"
  fi
  if lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t >/dev/null 2>&1; then
    bad "teardown 後 port ${PORT} 仍有人聽(pid: $(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' '))⇒ 零留痕不成立"
  else
    ok "teardown 後 port ${PORT} 無人聽(零留痕)"
  fi
fi

echo "════ PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" -eq 0 ] || exit 1
