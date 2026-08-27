#!/usr/bin/env bash
# ============================================================
# OP2b 行為 harness ——「migration 的 apply-time 探針**故意不驗**的那一半」
#
# 🔴 為什麼要有這支:OP2b 的 migration 只跑三發**不依賴業務資料**的負向探針
#    (N1 parent 不存在 / N2 自環 / N3 multi-row 互指環,皆 P2B32),因為
#    **migration 不得依賴業務資料存在** —— 第一版我讓它抓一筆真的 orders 當 fixture,
#    實跑當場證明那讓 migration 在任何空庫都套不上。
#    ⇒ 正向(合法鏈真的落值、值沒被偷改、allowlist 欄真的改得動)與所有需要既有列的負向
#      (改不可變欄、DELETE、UPDATE 面雙重違規)在這裡跑,這裡有種子資料。
#
# 覆蓋(七格 + 對照組;`all` 模式另有 teardown 與埠的兩道零留痕判定):
#   G1 對照組  四支 trigger 都在、dormant gate 已不在(不是這個狀態就別往下跑)
#   G2 正測    合法鏈 P(+500) → R1(-500) → R2(+500):三列落值、SUM=500、
#              R1 **十六欄逐欄**未被竄改(有給值的比值、沒給值的必須仍是 NULL)
#   G3 正測    合法鏈在**三種寫法**下都寫得進(multi-row VALUES 後列指前列 / INSERT…SELECT /
#              data-modifying CTE)⇒ 不必要求 writer 拆 statement;外加 **sibling CTE 互指環仍被擋 P2B32**
#   G4 負測    金額不是反號 ⇒ P2B33,**兩格**:正 parent→錯誤負額、負 parent→錯誤正額
#              (第二格是唯一會被「A9 的 WHEN 被縮成只管負額」那個突變放行的形狀)
#   G5 負測    改 amount / request_id / **id** / **reverses_payment_id** ⇒ P2B34;
#              四個 allowlist 欄(note / payer_note / reviewed_by+reviewed_at)都必須改得動
#   G6 負測    DELETE ⇒ P2B35
#   G7 發火序  INSERT 面雙重違規紅在 A8(P2B31)、UPDATE 面雙重違規紅在不可變(P2B34)
#
# 🔴 判定紀律(同 op1p-verify.sh):每格自己比 SQLSTATE;fail-closed(psql 退出碼 + sentinel);
#    每格跑完驗本表零殘列(所有寫入都在交易內、跑完 ROLLBACK)。
# 🔴 **負測哨兵用專屬碼 `P2BF0`,handler 第一行 re-raise**(本輪 Fable R3 N1):
#    哨兵 = 「這句不該被執行到」的那發 RAISE(寫入竟然成功時才會跑到)。它若用預設的 P0001,
#    會被同一格的 `WHEN others` 撈回去,訊息印成「被擋但 SQLSTATE=P0001」——
#    紅是紅了(所以不是假綠),但**診斷字面完全誤導**:實況是寫入被放行,不是被別條擋。
#    ⇒ 哨兵獨立碼 + `WHEN SQLSTATE 'P2BF0' THEN RAISE;` 排在 `WHEN others` 之前(同 migration 探針形狀)。
#
# 用法:
#   bash scripts/op2b-verify.sh all <workdir>          # provision → 跑 → teardown
#   PORT=54381 bash scripts/op2b-verify.sh run /tmp/x  # 對已起好的庫跑
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: op2b-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54381}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }

# workdir 身分閘(all 模式對它跑 rm -rf)。逐條擋 /tmp//、尾斜線、連續斜線、..、symlink
# ——與 op1p-verify.sh 同款,理由見該檔(codex 關卡2 R2 抓到 `/tmp/?*` 會放行 `/tmp//`)。
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

FIXTURE=$'  SELECT id INTO v_o FROM public.orders ORDER BY created_at LIMIT 1;\n  SELECT id INTO v_s FROM public.staff ORDER BY id LIMIT 1;\n  IF v_o IS NULL OR v_s IS NULL THEN\n    RAISE EXCEPTION \'fixture 不足(orders=% staff=%)⇒ 這輪沒有證據\', v_o, v_s;\n  END IF;'

if [ "$MODE" = "all" ]; then
  log "0/8 provision 拋棄式 PG17(含 OP2b)"
  require_free_port
  # 🔴 關卡2 #10:上面那組路徑形狀閘只證明「$WORK 長得像 /tmp/名字」,**不證明它是我建的**。
  #    傳入一個既有的 /tmp/shared,形狀全過、然後 rm -rf 掉別人的資料。
  #    ⇒ 沿用本 repo 既有的 ownership marker(`.d1t2-harness`,provision 建目錄時寫入;
  #      d1t2 teardown 與 a7c-rw1b 同款)—— 目錄已存在但沒有 marker 就拒絕,不自己另發明一種標記。
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    echo "🔴 $WORK 已存在但缺 .d1t2-harness ownership marker ⇒ 這不是本 harness 家族建的目錄,拒絕 rm -rf"; exit 2
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  ok "provision 完成"
fi
cluster_identity

log "1/8 G0 harness 自我測試"
if run_case "G0(應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 判定失效"; echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1)); ok "G0:壞掉的 SQL 會被判紅"

log "2/8 G1 對照組:四支 trigger 在、gate 已不在、欄名集合仍是那 16 欄"
# 🔴 本輪 code-reviewer MF1:不可變契約是**逐欄枚舉**的(12 不可變 + 4 allowlist = 現有 16 欄)。
#    日後任何 `ADD COLUMN` 都會靜默成為「可隨意改」的欄,而 G1-G7 原本一格都看不到欄集
#    ⇒ 這裡把欄集凍死,和 migration 檔尾 ⑨ **兩個面各守一次**(migration 守 apply 那一刻、
#      harness 守之後每一次回歸)。兩處字面必須同步改,不然這裡會先紅 —— 那是要的。
run_case "G1 OP2b 終態(四支 trigger + gate 已移除 + 欄名集合逐字 16 欄)" "OP2B-G1-OK" "
DO \$g1\$
DECLARE v_names text; v_n integer;
BEGIN
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION '這個庫不是 OP2b 的終態(trigger=%)⇒ 本 harness 驗的是 OP2b 之後的行為', coalesce(v_names,'(無)');
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers' AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'dormant gate 還在 ⇒ OP2b 沒 apply 或沒 DROP 成功'; END IF;
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attname COLLATE \"C\"), pg_catalog.count(*)::integer
    INTO v_names, v_n
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_payments'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 16 OR v_names IS DISTINCT FROM
       'actor,amount,bank_reference,created_at,id,note,order_id,payer_note,rail,'
       'rec_trade_id,received_at,request_id,reversal_reason,reverses_payment_id,'
       'reviewed_at,reviewed_by' THEN
    RAISE EXCEPTION '欄名集合不是凍結的那 16 欄(實得 % 欄:[%])⇒ 新增/改名的欄不在不可變枚舉裡 = 立刻成為可隨意改的欄;把它加進枚舉或 allowlist,再同步改本字面與 migration 檔尾 ⑨',
                    v_n, coalesce(v_names,'(無)');
  END IF;
  RAISE NOTICE 'OP2B-G1-OK';
END
\$g1\$;"

log "3/8 G2 正測:合法鏈落值且未被偷改"
# 🔴 關卡2 #9:上一版宣稱「值未被偷改」,實際只驗了列數 / 總額 / R1 的 amount ——
#    BEFORE trigger 改掉 actor、received_at、reversal_reason、note 任何一個都照樣全綠。
#    「宣稱的範圍 > 驗到的範圍」是本 repo 反覆記過的形狀 ⇒ 這裡改成**整列逐欄**比對:
#    有給值的欄逐欄比,沒給值的欄必須仍是 NULL(擋「trigger 自己補了一個值」)。
run_case "G2 P(+500)→R1(-500)→R2(+500):三列落值、SUM=500、R1 十六欄逐欄未被竄改" "OP2B-G2-OK" "
BEGIN;
DO \$g2\$
DECLARE v_o uuid; v_s text; v_p uuid; v_r1 uuid; v_n integer; v_amt integer;
        v_ts timestamptz := now() - interval '3 minutes';
        v_row public.order_payments%ROWTYPE; v_bad text;
BEGIN
$FIXTURE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G2', v_s) RETURNING id INTO v_p;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor, note)
  VALUES (v_o, 'card', -500, v_ts, v_p, '誤沖', v_s, 'G2-NOTE') RETURNING id INTO v_r1;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', 500, now(), v_r1, '沖銷之沖銷', v_s);
  SELECT count(*)::integer, sum(amount)::integer INTO v_n, v_amt FROM public.order_payments WHERE order_id = v_o;
  IF v_n <> 3 OR v_amt <> 500 THEN
    RAISE EXCEPTION '合法鏈落值不對(列數=% 總額=%,期望 3/500)⇒ trigger 吞列或改值', v_n, v_amt;
  END IF;
  SELECT * INTO v_row FROM public.order_payments WHERE id = v_r1;
  IF NOT FOUND THEN RAISE EXCEPTION 'R1 查不到 ⇒ trigger 把列吞了'; END IF;
  v_bad := concat_ws(', ',
    CASE WHEN v_row.id                  IS DISTINCT FROM v_r1     THEN 'id' END,
    CASE WHEN v_row.order_id            IS DISTINCT FROM v_o      THEN 'order_id' END,
    CASE WHEN v_row.rail                IS DISTINCT FROM 'card'   THEN 'rail' END,
    CASE WHEN v_row.amount              IS DISTINCT FROM -500     THEN 'amount' END,
    CASE WHEN v_row.reverses_payment_id IS DISTINCT FROM v_p      THEN 'reverses_payment_id' END,
    CASE WHEN v_row.received_at         IS DISTINCT FROM v_ts     THEN 'received_at' END,
    CASE WHEN v_row.reversal_reason     IS DISTINCT FROM '誤沖'   THEN 'reversal_reason' END,
    CASE WHEN v_row.actor               IS DISTINCT FROM v_s      THEN 'actor' END,
    CASE WHEN v_row.note                IS DISTINCT FROM 'G2-NOTE' THEN 'note' END,
    -- 🔴 本輪 code-reviewer nit 6:原本比 created_at IS NULL —— 欄位是 NOT NULL DEFAULT now(),
    --    那條**恆假**,是十六欄裡唯一的佔位欄。改成比「落在本交易的時間窗內」才有判別力
    --    (trigger 把它改成去年、或改成未來,現在都紅得到)。
    --    🔴 窗的下界必須是 now()(= 交易開始時刻,也是 DEFAULT 取的那個值),不是 clock_timestamp():
    --      第一版我用了後者,而 clock_timestamp() 嚴格晚於 now() ⇒ 合法的列當場被判成「早於窗」。
    --      (實跑當場紅過一次才發現;留著這句免得下一個人再踩。)
    --    ⚠️ 這些 SQL 註解裡**不得出現反引號,也不得出現 ASCII 雙引號** —— 整段 SQL 包在 bash
    --      雙引號字串裡:反引號會被 shell 當命令替換執行、雙引號會當場結束字串把 SQL 截斷
    --      (同一版我兩個都踩了:先是 created_at: command not found,再是 unterminated dollar-quoted string)。
    CASE WHEN v_row.created_at IS NULL
           OR v_row.created_at < now()
           OR v_row.created_at > clock_timestamp() THEN 'created_at(不在本交易時間窗內:' || coalesce(v_row.created_at::text,'NULL') || ')' END,
    CASE WHEN v_row.rec_trade_id        IS NOT NULL THEN 'rec_trade_id(沒給值卻有值)' END,
    CASE WHEN v_row.bank_reference      IS NOT NULL THEN 'bank_reference(沒給值卻有值)' END,
    CASE WHEN v_row.request_id          IS NOT NULL THEN 'request_id(沒給值卻有值)' END,
    CASE WHEN v_row.payer_note          IS NOT NULL THEN 'payer_note(沒給值卻有值)' END,
    CASE WHEN v_row.reviewed_by         IS NOT NULL THEN 'reviewed_by(沒給值卻有值)' END,
    CASE WHEN v_row.reviewed_at         IS NOT NULL THEN 'reviewed_at(沒給值卻有值)' END);
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'R1 這些欄被 BEFORE trigger 竄改或自行補值:%', v_bad;
  END IF;
  RAISE NOTICE 'OP2B-G2-OK';
END
\$g2\$;
ROLLBACK;"

log "4/8 G3 正測:同一 statement 的合法鏈(VALUES / INSERT…SELECT / data-modifying CTE 三種寫法)"
# 🔴 本輪 code-reviewer nit 7:migration 檔頭的誠實邊界說「INSERT…SELECT / CTE / COPY 沒實測、
#    對應探針在 op2b-verify.sh」——**那裡當時只有 VALUES 一種**,宣稱的範圍大於驗到的範圍。
#    reviewer 順手替我測了,但**我不把別人的測量寫成檔頭的事實**(memory
#    `feedback_verify-subagent-function-behavior-before-decision-question`)⇒ 把它變成這裡真的會跑的格,
#    由 harness 自己每次重新證。COPY 仍未測 ⇒ 檔頭只縮到 COPY,不外推。
run_case "G3 合法鏈三種寫法都寫得進(VALUES 後列指前列 / INSERT…SELECT / CTE),CTE 互指環仍被擋 P2B32" "OP2B-G3-OK" "
BEGIN;
DO \$g3\$
DECLARE v_o uuid; v_s text; v_n integer; v_state text;
BEGIN
$FIXTURE
  -- ① multi-row VALUES:後列指向前列
  INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, rec_trade_id, reverses_payment_id, reversal_reason, actor)
  VALUES ('00000000-0000-0000-0000-00000000e011', v_o, 'card', 700, now(), 'OP2B-G3', NULL, NULL, v_s),
         ('00000000-0000-0000-0000-00000000e012', v_o, 'card', -700, now(), NULL,
          '00000000-0000-0000-0000-00000000e011', '同 statement 沖銷', v_s);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN RAISE EXCEPTION 'VALUES 合法鏈只落 % 列(期望 2)', v_n; END IF;

  -- ② INSERT … SELECT:同一個 statement 產出父子兩列(後列指向前列)
  INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, rec_trade_id, reverses_payment_id, reversal_reason, actor)
  SELECT x.id, v_o, 'card', x.amt, now(), x.rtid, x.rev, x.rsn, v_s
    FROM (VALUES ('00000000-0000-0000-0000-00000000e021'::uuid, 700, 'OP2B-G3S'::text, NULL::uuid, NULL::text, 1),
                 ('00000000-0000-0000-0000-00000000e022'::uuid, -700, NULL,
                  '00000000-0000-0000-0000-00000000e021'::uuid, 'INSERT…SELECT 沖銷'::text, 2))
         AS x(id, amt, rtid, rev, rsn, ord)
   ORDER BY x.ord;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN RAISE EXCEPTION 'INSERT…SELECT 合法鏈只落 % 列(期望 2)', v_n; END IF;

  -- ③ data-modifying CTE:父列在 CTE 裡寫、子列在主查詢指向它
  WITH parent AS (
    INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES ('00000000-0000-0000-0000-00000000e031', v_o, 'card', 700, now(), 'OP2B-G3C', v_s)
    RETURNING id
  )
  INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  SELECT '00000000-0000-0000-0000-00000000e032', v_o, 'card', -700, now(), parent.id, 'CTE 沖銷', v_s FROM parent;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'CTE 合法鏈的子列落 % 列(期望 1)', v_n; END IF;

  -- ④ 🔴 CTE 互指環仍必須被擋:兩個 sibling CTE 互相指向對方 ⇒ 環在這個寫法下也構造不出來
  BEGIN
    WITH a AS (
      INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
      VALUES ('00000000-0000-0000-0000-00000000e041', v_o, 'card', -300, now(),
              '00000000-0000-0000-0000-00000000e042', 'CTE 環 A', v_s) RETURNING id
    ), b AS (
      INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
      VALUES ('00000000-0000-0000-0000-00000000e042', v_o, 'card', 300, now(),
              '00000000-0000-0000-0000-00000000e041', 'CTE 環 B', v_s) RETURNING id
    )
    SELECT pg_catalog.count(*)::integer INTO v_n FROM (SELECT id FROM a UNION ALL SELECT id FROM b) z;
    RAISE EXCEPTION 'CTE 互指環竟然寫進去了 ⇒ 環在這個寫法下構造得出來,無環論證倒了'
      USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state <> 'P2B32' THEN RAISE EXCEPTION 'CTE 互指環被擋但 SQLSTATE=%(期望 P2B32)', v_state; END IF;
  END;
  RAISE NOTICE 'OP2B-G3-OK';
END
\$g3\$;
ROLLBACK;"

log "5/8 G4 負測:金額不是反號(正 parent 與**負** parent 兩格)"
# 🔴 關卡2 #7:上一版只有「正 parent(+500)→ 錯誤負額 child(-200)」一格。
#    A9 的 WHEN 若被縮成 `… AND NEW.amount < 0`,那一格照樣紅(child 是負的、A9 還是有跑),
#    整支 harness 全綠,而**正額的沖銷之沖銷已經整批繞過 A9**(誤沖恢復路正是走正額)。
#    ⇒ 補「負 parent(-500)→ 錯誤**正**額 child(+300)」那一格,它是唯一會被那個突變放行的形狀。
run_case "G4 非反號的沖銷紅在 P2B33:正 parent→錯誤負額、負 parent→錯誤正額,兩格" "OP2B-G4-OK" "
BEGIN;
DO \$g4\$
DECLARE v_o uuid; v_s text; v_p uuid; v_r1 uuid; v_state text;
BEGIN
$FIXTURE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G4', v_s) RETURNING id INTO v_p;
  -- 格一:正 parent(+500)→ 錯誤負額 child(-200)
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
    VALUES (v_o, 'card', -200, now(), v_p, '金額不等', v_s);
    RAISE EXCEPTION '非反號的沖銷竟然寫進去了 ⇒ A9 主體沒生效' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B33' THEN RAISE EXCEPTION '被擋但 SQLSTATE=%(期望 P2B33)', v_state; END IF;
  END;
  -- 格二:合法沖一次拿到**負** parent,再用錯誤的**正**額去沖它
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', -500, now(), v_p, '誤沖', v_s) RETURNING id INTO v_r1;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
    VALUES (v_o, 'card', 300, now(), v_r1, '沖銷之沖銷金額不等', v_s);
    RAISE EXCEPTION '負 parent 的錯誤正額沖銷竟然寫進去了 ⇒ A9 對正額 child 沒生效(WHEN 被縮過?)' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B33' THEN RAISE EXCEPTION '負 parent 那格被擋但 SQLSTATE=%(期望 P2B33)', v_state; END IF;
  END;
  RAISE NOTICE 'OP2B-G4-OK';
END
\$g4\$;
ROLLBACK;"

log "6/8 G5 負測:不可變欄 vs allowlist 欄"
# 🔴 關卡2 #8:上一版只負測 amount / request_id,**沒測 id 與 reverses_payment_id** ——
#    而那兩欄正是「無環由構造保證」的第二根柱子(邊不會事後改指向)。漏測等於那半沒被證過:
#    把 R1 的 reverses_payment_id 事後改指向別列,「沿 parent 走 = 沿插入序更早走」就斷了。
# 🔴 allowlist 那半上一版只驗 note 一欄 ⇒ 另外三欄若被誤擋(契約過寬)完全看不出來。
#    reviewed_by / reviewed_at 被 order_payments_review_pair 綁成一對,必須同一句 UPDATE 改。
run_case "G5 改 amount / request_id / id / reverses_payment_id ⇒ P2B34;四個 allowlist 欄都改得動" "OP2B-G5-OK" "
BEGIN;
DO \$g5\$
DECLARE v_o uuid; v_s text; v_p uuid; v_p2 uuid; v_r1 uuid; v_state text;
        v_row public.order_payments%ROWTYPE; v_bad text;
BEGIN
$FIXTURE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G5', v_s) RETURNING id INTO v_p;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G5b', v_s) RETURNING id INTO v_p2;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', -500, now(), v_p, '誤沖', v_s) RETURNING id INTO v_r1;
  BEGIN
    UPDATE public.order_payments SET amount = 999 WHERE id = v_p;
    RAISE EXCEPTION '改 amount 竟然過了 ⇒ 無環論證的第二根柱子倒了' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B34' THEN RAISE EXCEPTION '改 amount 被擋但 SQLSTATE=%(期望 P2B34)', v_state; END IF;
  END;
  BEGIN
    UPDATE public.order_payments SET request_id = gen_random_uuid() WHERE id = v_p;
    RAISE EXCEPTION '改 request_id 竟然過了 ⇒ 冪等鍵可改 = 拿舊值重登付款那條路還開著' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B34' THEN RAISE EXCEPTION '改 request_id 被擋但 SQLSTATE=%(期望 P2B34)', v_state; END IF;
  END;
  BEGIN
    UPDATE public.order_payments SET id = gen_random_uuid() WHERE id = v_p;
    RAISE EXCEPTION '改 id 竟然過了 ⇒ 節點能換身分,無環歸納(parent 嚴格早於自己)就失去對象' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B34' THEN RAISE EXCEPTION '改 id 被擋但 SQLSTATE=%(期望 P2B34)', v_state; END IF;
  END;
  BEGIN
    UPDATE public.order_payments SET reverses_payment_id = v_p2 WHERE id = v_r1;
    RAISE EXCEPTION '改 reverses_payment_id 竟然過了 ⇒ 邊能事後改指向,環就構造得出來了' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B34' THEN RAISE EXCEPTION '改 reverses_payment_id 被擋但 SQLSTATE=%(期望 P2B34)', v_state; END IF;
  END;
  UPDATE public.order_payments SET note = 'G5-note' WHERE id = v_p;
  UPDATE public.order_payments SET payer_note = 'G5-payer' WHERE id = v_p;
  UPDATE public.order_payments SET reviewed_by = v_s, reviewed_at = now() WHERE id = v_p;
  SELECT * INTO v_row FROM public.order_payments WHERE id = v_p;
  v_bad := concat_ws(', ',
    CASE WHEN v_row.note        IS DISTINCT FROM 'G5-note'  THEN 'note' END,
    CASE WHEN v_row.payer_note  IS DISTINCT FROM 'G5-payer' THEN 'payer_note' END,
    CASE WHEN v_row.reviewed_by IS DISTINCT FROM v_s        THEN 'reviewed_by' END,
    CASE WHEN v_row.reviewed_at IS NULL                     THEN 'reviewed_at' END);
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'allowlist 欄改不動(%)⇒ 不可變契約過寬,把該放的也擋了', v_bad;
  END IF;
  RAISE NOTICE 'OP2B-G5-OK';
END
\$g5\$;
ROLLBACK;"

log "7/8 G6 負測:DELETE"
run_case "G6 DELETE 紅在 P2B35" "OP2B-G6-OK" "
BEGIN;
DO \$g6\$
DECLARE v_o uuid; v_s text; v_p uuid; v_state text;
BEGIN
$FIXTURE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G6', v_s) RETURNING id INTO v_p;
  BEGIN
    DELETE FROM public.order_payments WHERE id = v_p;
    RAISE EXCEPTION 'DELETE 竟然過了 ⇒ 刪掉重寫就是 UPDATE 的替代路' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B35' THEN RAISE EXCEPTION 'DELETE 被擋但 SQLSTATE=%(期望 P2B35)', v_state; END IF;
  END;
  RAISE NOTICE 'OP2B-G6-OK';
END
\$g6\$;
ROLLBACK;"

log "8/8 G7 發火序:兩面的雙重違規各紅在誰"
run_case "G7 INSERT 面雙重違規紅在 A8(P2B31)、UPDATE 面紅在不可變(P2B34)" "OP2B-G7-OK" "
BEGIN;
DO \$g7\$
DECLARE v_o uuid; v_s text; v_p uuid; v_state text;
BEGIN
$FIXTURE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP2B-G7', v_s) RETURNING id INTO v_p;
  -- INSERT 面:未來時點(違反 A8)+ 非反號(違反 A9)⇒ 名字排序 rec < rev ⇒ A8 先
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
    VALUES (v_o, 'card', -123, now() + interval '1 hour', v_p, '雙重違規', v_s);
    RAISE EXCEPTION 'INSERT 面雙重違規竟然過了' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B31' THEN
      RAISE EXCEPTION 'INSERT 面雙重違規紅在 %(期望 P2B31=A8 先發火)⇒ 發火序與 migration 檔頭釘的不一致', v_state;
    END IF;
  END;
  -- UPDATE 面:改 amount(違反不可變)+ 未來時點(違反 A8)⇒ 名字排序 i < r ⇒ 不可變先
  BEGIN
    UPDATE public.order_payments SET amount = 111, received_at = now() + interval '1 hour' WHERE id = v_p;
    RAISE EXCEPTION 'UPDATE 面雙重違規竟然過了' USING ERRCODE = 'P2BF0';
  EXCEPTION
    WHEN SQLSTATE 'P2BF0' THEN RAISE;
    WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P2B34' THEN
      RAISE EXCEPTION 'UPDATE 面雙重違規紅在 %(期望 P2B34=不可變先發火)⇒ 發火序漂移', v_state;
    END IF;
  END;
  RAISE NOTICE 'OP2B-G7-OK';
END
\$g7\$;
ROLLBACK;"

if [ "$MODE" = "all" ]; then
  # 🔴 關卡2 #11:上一版是 `|| true` —— teardown 失敗被整個吞掉,帳面照樣印 FAIL=0 exit 0,
  #    而現場留著一台活的 postmaster 佔著埠。「零留痕」是本片自己宣稱過的驗收,
  #    宣稱過就要有對應的判定 ⇒ 失敗計入 FAIL,並**另外**驗埠真的沒人聽
  #    (teardown 退出碼 0 也可能沒停乾淨,退出碼證明不了埠的狀態)。
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
