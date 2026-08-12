#!/usr/bin/env bash
# ============================================================
# L5b-2 片 2d 驗證 harness:`result_confirmed` 事件(值域 + terminal 集合換人)
# ============================================================
# plan   = docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§4b `:445-457`(甲案)
# 標的   = supabase/migrations/20260811110000_m4b_lifecycle_l5b2_2d_result_confirmed_event.sql
# 回退   = scripts/l5b2-2d-rollback.sql(本檔每次 reset 都跑它 ⇒ 回退腳本被實跑十幾次)
#
# 用法(workdir = d1t2 provision 的 workdir;身分閘要讀它的 cluster-id):
#   scripts/l5b2-2d-verify.sh all <workdir>            自己 provision → 跑 → teardown
#   PORT=54413 scripts/l5b2-2d-verify.sh run <workdir> 叢集已在(開發用)
#
# 🔴 本片改的是**表達能力**,所以「結構對了」離「真的解鎖了」還有一段:
#   · **結構**(值域含 result_confirmed、索引述詞換人)→ 查 catalog。
#   · **行為**(同一顆 refund 能不能先 result_success 再 result_confirmed)→ **真的插進去看**。
#   · **對照組**(pre-image 上同樣的插入必須被擋)→ 沒有這一半,行為格證不了「是本片解鎖的」,
#     只證得了「現在可以」。一個本來就可以的東西也會讓行為格全綠。
#
# 🔴 期望值一律是 **SQLSTATE + 物件名**兩件:
#   23514 由表上四條 CHECK 共用、23505 由表上三個唯一索引共用 ⇒ 只比碼會把「別條擋下來」
#   當成自己的功勞(memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
#
# 🔴 隔離:行為格一律 `BEGIN … ROLLBACK`,零留痕由**構造**保證,不靠事後清理
#   (payment_refund_events 是 append-only:`20260810140000:183-184` 兩個 trigger 擋 UPDATE/DELETE/TRUNCATE
#    ⇒ committed 的列**清不掉**,末段那一格刻意汙染的資料只能靠 teardown 收)。
# ============================================================
set -uo pipefail
export LC_ALL=C

MODE="run"
case "${1:-}" in all|run) MODE="$1"; shift ;; esac
WORK="${1:-/tmp/l5b2d}"
PORT="${PORT:-54413}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

MIG="supabase/migrations/20260811110000_m4b_lifecycle_l5b2_2d_result_confirmed_event.sql"
ROLLBACK="scripts/l5b2-2d-rollback.sql"
# 🔴 順序閘那兩格要跑 2c 的回退與 migration ⇒ 它們是本檔的依賴檔,照同一條紀律釘 SHA。
MIG_2C="supabase/migrations/20260811080000_m4b_lifecycle_l5b2_2c_refund_ledger_columns_checks.sql"
RB_2C="scripts/l5b2-2c-rollback.sql"

# 🔴 依賴檔 SHA 釘死(2a 的 R2 教訓):w7 收據只記 harness 自己的 SHA 與 migration 目錄尾碼
#    ⇒ 同一尾碼下改了 migration 或 rollback 而不動 harness,帳面照樣全綠。釘在這裡才閉合。
MIG_SHA_EXPECT="af35d35b450c279a783a71a2529075d69aa15e4d"
RB_SHA_EXPECT="c34a95e5d79048a1a14b42b4ab9e5acff8cec253"
MIG_2C_SHA_EXPECT="475ae0d6fc3f9ea507291efc7fde8b2c9023dc8f"
RB_2C_SHA_EXPECT="2aa8a87da1f858982c566f5041e92652ba2f0f36"

# 🔴 量出來的,不是估的(每加/刪一格必同步改;它就是「刪格會紅」那道守門)。
#    ⚠️ 數法=看腳本尾端印的 `PASS=`,**不要** `grep -c "^  ok"`:`all` 模式會多印一行
#       「ok provision 完成」,那行是 echo 不經過計數器(2c 的 R2 就是寫錯這個數法)。
EXPECT_TOTAL=37

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }

test -f "$MIG"      || { echo "🔴 找不到 $MIG(請在 repo 根目錄跑)"; exit 1; }
test -f "$ROLLBACK" || { echo "🔴 找不到 $ROLLBACK"; exit 1; }
for pair in "$MIG:$MIG_SHA_EXPECT" "$ROLLBACK:$RB_SHA_EXPECT" "$MIG_2C:$MIG_2C_SHA_EXPECT" "$RB_2C:$RB_2C_SHA_EXPECT"; do
  _f="${pair%%:*}"; _want="${pair##*:}"; _got="$(shasum "$_f" | cut -d' ' -f1)"
  [ "$_got" = "$_want" ] || { echo "🔴 $_f 的 SHA=[$_got] 與本檔釘住的 [$_want] 不符 ⇒ 依賴檔改過但本檔沒同步。"; \
      echo "   改法:確認改動是預期的,更新本檔的 *_SHA_EXPECT,然後 record 重跑(不要只改常數不重跑)。"; exit 1; }
done
mkdir -p "$WORK"
MUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/l5b2-2d-mut.XXXXXX")"
trap 'rm -rf "$MUTDIR"' EXIT

if [ "$MODE" = "all" ]; then
  # 🔴 trap 裝在 provision **之前**(2a 的 R2 教訓):provision 中途失敗時叢集已起來,
  #    舊寫法此時 trap 還沒裝 ⇒ 留下活叢集佔埠。teardown 失敗一律 fail-closed。
  teardown_and_verify() {
    local rc=$?
    rm -rf "$MUTDIR"
    local bad_exit=0
    if ! scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1; then
      echo "🔴 teardown 失敗 ⇒ 可能留下活叢集(PORT=$PORT workdir=$WORK)"; bad_exit=1
    fi
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "🔴 PORT=$PORT 仍有人聽 ⇒ 零留痕不成立"; bad_exit=1
    fi
    [ "$bad_exit" = "0" ] || exit 2
    exit "$rc"
  }
  trap teardown_and_verify EXIT
  echo "── provision(全量 migration)──"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  echo "  ok   provision 完成(PORT=$PORT)"
fi

# ── 叢集身分閘(在對任何東西下 ALTER 之前)────────────────────────────────
# 🔴 本腳本會 DROP/ADD 退款帳本的 CHECK 與唯一索引,末段還會刻意汙染資料。
#    PORT 指到別窗的叢集時損害是真的 ⇒ 拒絕在身分不明的叢集上跑。
if [ ! -f "$WORK/cluster-id" ]; then
  echo "🔴 $WORK/cluster-id 不存在 ⇒ 無法確認 PORT=$PORT 上的叢集身分,拒跑。"
  echo "   用 'scripts/l5b2-2d-verify.sh all <workdir>',或把 <workdir> 指向 provision 用的目錄。"
  exit 1
fi
LIVE_ID="$(q "SELECT system_identifier FROM pg_control_system();")"
WANT_ID="$(cat "$WORK/cluster-id")"
if [ -z "$LIVE_ID" ] || [ "$LIVE_ID" != "$WANT_ID" ]; then
  echo "🔴 叢集身分不符:PORT=$PORT 上是 [$LIVE_ID],期望 [$WANT_ID]。拒跑。"; exit 1
fi
ok "叢集身分閘:PORT=$PORT 確認是本 workdir provision 的那個叢集"

# ── 🔴 沖銷片(`20260812140000`)疊在 2d 之上,先把它退掉 ────────────────────────
# 它 DROP 了 `pre_one_terminal_uniq`,而本檔整套 pre-image 斷言與 `l5b2-2d-rollback.sql`
# 的第一道閘都以那顆索引存在為前提 ⇒ 不先退它,`reset_preimage` 第一次就會死在別人的閘上。
# **只在它的產物還在時退一次**:退完 canonical view 就不在了,重複呼叫會把值域推回錯的方向
# (2d-rollback 之後值域是六值,再跑一次沖銷片回退會變回七值)。
SIC_ROLLBACK="scripts/refund-manual-reversal-rollback.sql"
if [ "$(q "SELECT count(*) FROM pg_class WHERE relname='payment_refund_effective_terminal';")" != "0" ]; then
  test -f "$SIC_ROLLBACK" || { echo "🔴 找不到 $SIC_ROLLBACK,但庫內有沖銷片的產物 ⇒ 退不掉,拒跑"; exit 1; }
  if ! psql "$URL" -v ON_ERROR_STOP=1 -f "$SIC_ROLLBACK" > "$MUTDIR/sic-rollback.log" 2>&1; then
    echo "🔴 沖銷片回退失敗 ⇒ 本檔的 pre-image 前提不成立,停止。log:"; tail -5 "$MUTDIR/sic-rollback.log"; exit 1
  fi
  # 🔴 用 echo 不用 ok():這一步在 run 模式下不一定觸發(叢集可能已退過)
  #    ⇒ 計進 PASS 會讓釘死的 EXPECT_TOTAL 忽大忽小。失敗路徑上面已 exit 1。
  echo "  --   沖銷片已退回(pre_one_terminal_uniq 已還原,2d 的 pre-image 前提恢復)"
fi

# 🔴 **必須把 exit code 併進輸出**(2c 的 R2 實測命中):psql 連線失敗印的是小寫
#    `psql: error: connection to server … failed`、exit=2,輸出裡**沒有大寫 ERROR**
#    ⇒ 所有 `grep -qE 'ERROR'` 的正向格會判成成功。最壞情況=叢集掛掉而 PASS=EXPECT_TOTAL。
# 🔴 **函式要回傳真 rc**(對抗審查 R1 must-fix,成立):v1 的最後一句是 `printf` ⇒ 回傳恆為 0。
#    輸出被 `>/dev/null` 丟掉的呼叫點(回退段、順序閘段)因此**完全看不到 apply 失敗** ——
#    叢集瞬斷時 2d 沒真的套上去,下一格卻走「冪等重跑」分支而綠。⇒ 明確 `return "$rc"`。
apply_mig() {
  local out rc
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$1" 2>&1)"; rc=$?
  printf '%s' "$out"
  [ "$rc" -eq 0 ] || printf '\nERROR: psql exit=%s(apply_mig;非零退出碼一律當紅,不看輸出長相)\n' "$rc"
  return "$rc"
}

# reset = 跑 2d 的回退腳本回到 **2c 已 apply、2d 未 apply** 的形狀。
# 🔴 setup 有效性斷言:沒真的回到 pre-image,後面整張矩陣的紅都不算數。
#    (provision 會把 2d 一起套上去 ⇒ 第一次 reset 就是真的在退,不是空跑。)
reset_preimage() {
  if ! psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" > "$MUTDIR/reset.log" 2>&1; then
    echo "🔴🔴 reset 失敗(回退腳本自己紅了)⇒ 後面每一格都不算數,停止。log:"; tail -5 "$MUTDIR/reset.log"; exit 1
  fi
  # 🔴 **逐字釘 pre-image,不是數數量**(對抗審查 R1 must-fix,成立):v1 用「四條 CHECK + 兩個
  #    字串缺席」當基線 ⇒ 換掉其中一條 CHECK、索引變 invalid 或非唯一、`event_type` 變 nullable,
  #    通通冒充得了基線,而後面每一格都建立在這個基線上。基線假 = 整張矩陣的紅綠都不算數。
  #    (M7 的還原是 `>/dev/null 2>&1` 無 ON_ERROR_STOP ⇒ 還原失敗也只有這裡看得到。)
  local st
  st="$(q "SELECT (SELECT COALESCE(pg_catalog.string_agg(c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname),'(空)')
                     FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.payment_refund_events'::regclass AND c.contype='c')
           || ' @@ ' || (SELECT COALESCE(pg_catalog.pg_get_indexdef(i.indexrelid) || ':' || i.indisunique::text || ':' || i.indisvalid::text,'(無索引)')
                     FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq'))
           || ' @@ ' || (SELECT a.attnotnull::text FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid='public.payment_refund_events'::regclass AND a.attname='event_type');")"
  local want_cons="pre_event_type_chk=CHECK ((event_type = ANY (ARRAY['sent'::text, 'result_success'::text, 'result_failed'::text, 'result_unknown'::text, 'reconcile'::text, 'manual'::text]))) | pre_lease_token_nonneg_chk=CHECK ((lease_token >= 0)) | pre_manual_needs_verdict_chk=CHECK ((COALESCE((event_type <> 'manual'::text), false) OR COALESCE((jsonb_typeof((record_snapshot -> 'refunded'::text)) = 'boolean'::text), false))) | pre_seq_positive_chk=CHECK ((seq > 0))"
  local want_idx="CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id) WHERE (event_type = ANY (ARRAY['result_success'::text, 'result_failed'::text, 'manual'::text])):true:true"
  if [ "$st" != "$want_cons @@ $want_idx @@ true" ]; then
    echo "🔴🔴 reset 後基線與 2c post-image **逐字不符** ⇒ 後續格全部無效,停止。"
    echo "   實際=[$st]"; exit 1
  fi
}

# 行為格:$1=格名 $2=期望(OK 或 `SQLSTATE:物件名`)$3=在已 seed 的交易裡跑的 SQL
# 🔴 seed 自己失敗要跟「約束擋下」分開:SEED_BROKEN 是 fixture 前提被打穿,不是本格的結論。
behaviour() {
  local name="$1" want="$2" sql="$3" out rc
  # 🔴 `VERBOSITY=verbose` 才印得出 SQLSTATE(psql 預設不印 ⇒ 沒有它,「驗 23514」那半是空話)。
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL 2>&1
BEGIN;
DO \$seed\$
DECLARE
  v_order uuid; v_user uuid; v_attempt uuid := gen_random_uuid();
  v_r1 uuid; v_r2 uuid; v_r3 uuid;
BEGIN
  SELECT o.id, o.customer_user_id INTO v_order, v_user
    FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status
     AND NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id = o.id)
   ORDER BY o.id LIMIT 1;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'SEED_BROKEN:找不到 unpaid 且無 attempt 的訂單(fixture 前提被打穿,不是本格的結論)';
  END IF;
  INSERT INTO public.payment_charge_attempts
    (id, order_id, customer_user_id, status, fallback_token_hash, created_at, updated_at,
     settle_attempt_count, needs_manual_review, released_at, superseded_at, superseded_reason)
  VALUES (v_attempt, v_order, v_user, 'released', pg_catalog.repeat('a', 64),
          pg_catalog.now() - interval '2 days', pg_catalog.now() - interval '2 days',
          0, false, pg_catalog.now(), pg_catalog.now(), 'record_not_found');
  -- 兩顆 refund:同 attempt、各自獨立(唯一索引是 per refund_id ⇒ 需要第二顆才驗得出射程)
  INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
  VALUES (v_attempt, 'pcm-2d-a' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,8),
          100, 'TWD', 'rec:D2026081100A', 0) RETURNING id INTO v_r1;
  INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
  VALUES (v_attempt, 'pcm-2d-b' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,8),
          100, 'TWD', 'rec:D2026081100B', 0) RETURNING id INTO v_r2;
  INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
  VALUES (v_attempt, 'pcm-2d-c' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,8),
          100, 'TWD', 'rec:D2026081100C', 0) RETURNING id INTO v_r3;
  PERFORM pg_catalog.set_config('l5b2_2d.r1', v_r1::text, true);
  PERFORM pg_catalog.set_config('l5b2_2d.r2', v_r2::text, true);
  PERFORM pg_catalog.set_config('l5b2_2d.r3', v_r3::text, true);
END
\$seed\$;
$sql
ROLLBACK;
SQL
)"; rc=$?
  if printf '%s' "$out" | grep -qF 'SEED_BROKEN:'; then
    bad "$name → 紅在 fixture 前提而不是約束 ⇒ 這格證不了東西"; return
  fi
  if [ "$want" = "OK" ]; then
    if [ "$rc" -ne 0 ]; then
      bad "$name → psql exit=$rc(不是約束問題,這格什麼都沒證明):$(printf '%s' "$out" | grep -iE 'error' | head -1)"
    elif printf '%s' "$out" | grep -qE 'ERROR'; then
      bad "$name → 應該被接受卻紅了:$(printf '%s' "$out" | grep ERROR | head -1)"
    else ok "$name"; fi
    return
  fi
  local code="${want%%:*}" obj="${want##*:}"
  if ! printf '%s' "$out" | grep -qF "$code"; then
    bad "$name → SQLSTATE 不是 $code;實際:$(printf '%s' "$out" | grep -E 'ERROR|SQLSTATE' | head -1)"; return
  fi
  if printf '%s' "$out" | grep -qF "$obj"; then
    ok "$name → 被 [$obj] 擋下($code + 物件名兩者皆中)"
  else
    bad "$name → $code 對了但不是 [$obj];實際:$(printf '%s' "$out" | grep -E 'ERROR|DETAIL' | head -1)"
  fi
}

EV="INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token, record_snapshot) VALUES"
R1="pg_catalog.current_setting('l5b2_2d.r1')::uuid"
R2="pg_catalog.current_setting('l5b2_2d.r2')::uuid"
R3="pg_catalog.current_setting('l5b2_2d.r3')::uuid"

echo
echo "── 對照組:同樣的插入在 **pre-image** 上必須被擋(沒有這段,行為格證不了是本片解鎖的)──"
reset_preimage
behaviour "對照-1 pre-image 寫 result_confirmed → pre_event_type_chk 擋" "23514:pre_event_type_chk" \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL);"
behaviour "對照-2 pre-image 同顆 result_success + result_failed → 舊 pre_one_terminal_uniq 擋" "23505:pre_one_terminal_uniq" \
  "$EV ($R1, 'result_success', 1, 0, NULL), ($R1, 'result_failed', 2, 0, NULL);"
behaviour "對照-3 pre-image 同顆兩筆 result_success → 舊索引擋(當時它是 terminal,佔掉名額)" "23505:pre_one_terminal_uniq" \
  "$EV ($R1, 'result_success', 1, 0, NULL), ($R1, 'result_success', 2, 0, NULL);"

echo
echo "── 正向(套用 2d)────────────────────────────────────"
OUT="$(apply_mig "$MIG")"
if printf '%s' "$OUT" | grep -qE '^ERROR|ERROR:'; then bad "2d 套用失敗:$(printf '%s' "$OUT" | grep ERROR | head -1)"; else ok "2d 套用成功"; fi

# 🔴 鎖 conrelid:約束名只對同一張表唯一。不鎖的話別表的同名 CHECK 會替缺席的目標補數 ⇒ 恆綠。
S="$(q "SELECT (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refund_events'::regclass AND contype='c' AND convalidated)
        || '|' || (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refund_events'::regclass AND conname='pre_event_type_chk');")"
[ "$S" = "4|CHECK ((event_type = ANY (ARRAY['sent'::text, 'result_success'::text, 'result_confirmed'::text, 'result_failed'::text, 'result_unknown'::text, 'reconcile'::text, 'manual'::text])))" ] \
  && ok "結構:四條 CHECK 皆 validated、值域逐字=七值(舊六值 + result_confirmed)" \
  || bad "結構=[$S]"

S2="$(q "SELECT pg_catalog.pg_get_indexdef(indexrelid) || '|' || indisunique::text || '|' || indisvalid::text
         FROM pg_catalog.pg_index WHERE indexrelid='public.pre_one_terminal_uniq'::regclass;")"
[ "$S2" = "CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id) WHERE (event_type = ANY (ARRAY['result_confirmed'::text, 'result_failed'::text, 'manual'::text]))|true|true" ] \
  && ok "結構:索引述詞逐字=新 terminal 集合,且 unique + valid" \
  || bad "索引=[$S2]"

S3="$(q "SELECT COALESCE(pg_catalog.pg_get_indexdef(i.indexrelid),'(無)') || '|' || i.indisunique::text || '|' || i.indisvalid::text
         FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_success_uniq');")"
[ "$S3" = "CREATE UNIQUE INDEX pre_one_success_uniq ON public.payment_refund_events USING btree (refund_id) WHERE (event_type = 'result_success'::text)|true|true" ] \
  && ok "結構:新索引 pre_one_success_uniq 述詞逐字、unique + valid(接住②弄丟的保證)" \
  || bad "新索引=[$S3]"

echo
echo "── 行為格:表達能力真的解鎖了嗎(驗 SQLSTATE + 物件名)──"
behaviour "①-正 result_confirmed 可寫入(對照-1 的翻面)" OK \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL);"
behaviour "②-正 🔴 同顆 refund:result_success → result_confirmed **兩筆都進得去**(本片存在的理由)" OK \
  "$EV ($R1, 'result_success', 1, 0, NULL), ($R1, 'result_confirmed', 2, 0, NULL);"
# 🔴 ③ 這格在 R3(Fable F2)之後**翻面**:result_success 退出 terminal 之後,
#    「每顆 refund 至多一筆已受理」原本會跟著消失 ⇒ 本片補了 pre_one_success_uniq 接住它。
#    ⚠️ 期望的物件名是**新索引**不是舊的 —— 只比 23505 的話,舊索引沒被換掉也會綠。
behaviour "③-負 🔴 同顆兩筆 result_success → pre_one_success_uniq(②弄丟的保證由③接住)" "23505:pre_one_success_uniq" \
  "$EV ($R1, 'result_success', 1, 0, NULL), ($R1, 'result_success', 2, 0, NULL);"
behaviour "③-b-正 兩顆**不同** refund 各一筆 result_success → 放行(新索引也是 per refund_id)" OK \
  "$EV ($R1, 'result_success', 1, 0, NULL), ($R2, 'result_success', 1, 0, NULL);"
behaviour "④-負 同顆兩筆 result_confirmed → pre_one_terminal_uniq" "23505:pre_one_terminal_uniq" \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL), ($R1, 'result_confirmed', 2, 0, NULL);"
behaviour "⑤-負 同顆 result_confirmed + result_failed → pre_one_terminal_uniq(新集合內互斥)" "23505:pre_one_terminal_uniq" \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL), ($R1, 'result_failed', 2, 0, NULL);"
behaviour "⑥-負 同顆 result_confirmed + manual(帶合法 verdict)→ pre_one_terminal_uniq" "23505:pre_one_terminal_uniq" \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL), ($R1, 'manual', 2, 0, '{\"refunded\": true}'::jsonb);"
behaviour "⑦-正 兩顆**不同** refund 各一筆 result_confirmed → 放行(唯一性是 per refund_id,不是全表)" OK \
  "$EV ($R1, 'result_confirmed', 1, 0, NULL), ($R2, 'result_confirmed', 1, 0, NULL);"
behaviour "⑧-負 值域外的值('confirmed')→ pre_event_type_chk(不是「像就好」)" "23514:pre_event_type_chk" \
  "$EV ($R1, 'confirmed', 1, 0, NULL);"
behaviour "⑨-正 舊六值逐一寫入仍全部放行(DROP+ADD 沒把既有值弄丟)" OK \
  "$EV ($R1,'sent',1,0,NULL),($R1,'result_success',2,0,NULL),($R1,'result_unknown',3,0,NULL),($R1,'reconcile',4,0,NULL),($R2,'result_failed',1,0,NULL),($R3,'manual',1,0,'{\"refunded\": false}'::jsonb);"
behaviour "⑩-負 manual 缺 verdict 仍被 2c 那條擋(本片沒把 2c 的守門弄壞)" "23514:pre_manual_needs_verdict_chk" \
  "$EV ($R1, 'manual', 1, 0, NULL);"

echo
echo "── 突變矩陣(每道斷言各一發,且每發只讓一道紅)──────"
mutate() {
  local name="$1" expect="$2" pyexpr="$3"
  local f="$MUTDIR/mut-$(printf '%s' "$name" | tr -cd 'A-Za-z0-9').sql"
  reset_preimage
  if ! python3 - "$MIG" "$f" "$pyexpr" <<'PY'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
out = eval(sys.argv[3], {'src': src, 're': __import__('re')})
if out == src:
    sys.exit('突變沒改到任何東西(字面對不上)')
open(sys.argv[2], 'w', encoding='utf-8').write(out)
PY
  then bad "$name(產突變檔失敗 ⇒ 這格什麼都沒證明)"; return; fi
  local out; out="$(apply_mig "$f")"
  if ! printf '%s' "$out" | grep -qF "$expect"; then
    bad "$name → 沒紅在 [$expect];實際:$(printf '%s' "$out" | grep ERROR | head -1)"; return
  fi
  # 突變被擋 ≠ 什麼都沒落地:確認整片真的回滾了(值域仍是 pre-image 的六值)
  local now; now="$(q "SELECT pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid),'result_confirmed') FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refund_events'::regclass AND conname='pre_event_type_chk';")"
  if [ "$now" != "0" ]; then bad "$name → 紅對了,但值域已含 result_confirmed ⇒ 失敗的 migration 有東西落地"; return; fi
  ok "$name → 紅在預期那道,且整片已回滾"
}

mutate "M1 重建值域時漏抄 reconcile → post assert① 逐值檢查" \
  "把既有值 [reconcile] 弄丟了" \
  "src.replace(chr(39) + 'result_unknown' + chr(39) + ',' + chr(39) + 'reconcile' + chr(39) + ',', chr(39) + 'result_unknown' + chr(39) + ',', 1)"

mutate "M2 新索引述詞把 result_success 留著(本片等於沒做)→ post assert②「必須離開」" \
  "result_success 還在 terminal 集合裡" \
  "src.replace(chr(10) + '  WHERE event_type IN (' + chr(39) + 'result_confirmed' + chr(39) + ',' + chr(39) + 'result_failed' + chr(39) + ',' + chr(39) + 'manual' + chr(39) + ');', chr(10) + '  WHERE event_type IN (' + chr(39) + 'result_confirmed' + chr(39) + ',' + chr(39) + 'result_success' + chr(39) + ',' + chr(39) + 'result_failed' + chr(39) + ',' + chr(39) + 'manual' + chr(39) + ');', 1)"

mutate "M3 索引建成非唯一(述詞對、唯一性沒了)→ post assert② 的 indisunique 那半" \
  "不是 valid 的唯一索引" \
  "src.replace('CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)', 'CREATE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)', 1)"

mutate "M4 順手撤掉一條既有 CHECK(pre_seq_positive_chk)→ post assert③ 計數" \
  "有別的約束被動到" \
  "src.replace('COMMENT ON CONSTRAINT pre_event_type_chk', 'ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_seq_positive_chk;' + chr(10) + 'COMMENT ON CONSTRAINT pre_event_type_chk', 1)"

# 🔴 M10 打的是③ 那顆新索引:把 CREATE 整句拿掉 ⇒ 「每顆 refund 至多一筆 result_success」無人守。
#    這一發存在的理由=③ 是本片**唯一為了接住既有保證而加的物件**,它自己必須有靶。
#    ⚠️ 必須連同 `COMMENT ON INDEX` 一起拿掉:只刪 CREATE 的話,COMMENT 那句會先以 42P01
#    「relation does not exist」炸掉 ⇒ 紅在錯的地方、證不到 post assert(第一版實測踩到)。
mutate "M10 拿掉 pre_one_success_uniq 的 CREATE → post assert 的新索引那道" \
  "pre_one_success_uniq 不存在或定義不符" \
  "re.sub('CREATE UNIQUE INDEX pre_one_success_uniq.*?COMMENT ON INDEX public.pre_one_success_uniq IS.*?;' + chr(10), '', src, count=1, flags=re.S)"

# 🔴 M9 打的是「逐字 catch-all」那條:**多**一個值 —— 舊六值一個沒少、result_confirmed 也在
#    ⇒ 逐值迴圈與「含 result_confirmed」兩條都放行,只有逐字比對抓得到。
#    (沒有這一發,catch-all 就是零突變的守門 = 只證明它存在,證不了它擋得住什麼。)
mutate "M9 值域多塞一個打錯字的第八值 → post assert 的逐字 catch-all" \
  "值域與 post-image **逐字不符**" \
  "src.replace(chr(39) + 'reconcile' + chr(39) + ',' + chr(39) + 'manual' + chr(39) + '));', chr(39) + 'reconcile' + chr(39) + ',' + chr(39) + 'manual' + chr(39) + ',' + chr(39) + 'result_confirmd' + chr(39) + '));', 1)"

# ── 改**庫**不是改檔:前置閘的三道 pre-image 各一發。每發自己負責還原
#    (reset 跑的是 2d 回退,它不會修復我改壞的既有物件)。
# M5 既有 CHECK 換成**等價恆真式**(名字不變、數量不變)⇒ 只有「釘定義」那道抓得到。
#    這正是 2c 的 R2 實測形狀:`CHECK (1=1)` 的 condef 是 `CHECK ((1 = 1))`,子字串比對抓不到。
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'M5SQL'
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_seq_positive_chk;
ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_seq_positive_chk CHECK (1=1);
M5SQL
OUT5="$(apply_mig "$MIG")"
psql "$URL" -qtAX >/dev/null 2>&1 <<'M5R'
ALTER TABLE public.payment_refund_events DROP CONSTRAINT IF EXISTS pre_seq_positive_chk;
ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_seq_positive_chk CHECK (seq > 0);
M5R
printf '%s' "$OUT5" | grep -qF "CHECK **定義**與 pre-image 不符" \
  && ok "M5 既有 CHECK 被換成等價恆真式(名字/數量都沒變)→ 前置閘② 的「釘定義」擋下" \
  || bad "M5 沒被擋:$(printf '%s' "$OUT5" | grep ERROR | head -1)"

# M6 欄集合漂移(別的片先加了一欄)⇒ 前置閘③
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "ALTER TABLE public.payment_refund_events ADD COLUMN l5b2_2d_probe text;" >/dev/null 2>&1
OUT6="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "ALTER TABLE public.payment_refund_events DROP COLUMN IF EXISTS l5b2_2d_probe;" >/dev/null 2>&1
printf '%s' "$OUT6" | grep -qF "欄型別/NOT NULL 與 pre-image 不符" \
  && ok "M6 別的片先加了一欄 → 前置閘③ 擋下(不安靜疊上去)" \
  || bad "M6 沒被擋:$(printf '%s' "$OUT6" | grep ERROR | head -1)"

# M7 舊索引述詞被別人改過(名字還在)⇒ 前置閘④;只比名字的話會安靜疊上去
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'M7SQL'
DROP INDEX public.pre_one_terminal_uniq;
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_success','result_failed');
M7SQL
OUT7="$(apply_mig "$MIG")"
psql "$URL" -qtAX >/dev/null 2>&1 <<'M7R'
DROP INDEX IF EXISTS public.pre_one_terminal_uniq;
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_success','result_failed','manual');
M7R
printf '%s' "$OUT7" | grep -qF "pre_one_terminal_uniq 的定義與 pre-image 不符" \
  && ok "M7 舊索引述詞被別人改過(名字沒變)→ 前置閘④ 的「釘述詞」擋下" \
  || bad "M7 沒被擋:$(printf '%s' "$OUT7" | grep ERROR | head -1)"

# M8 欄級 ACL:只進 attacl、relacl 維持空 ⇒ 只查表級的斷言會宣告「零權限」而事實上有後門
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "GRANT SELECT(seq) ON public.payment_refund_events TO authenticated;" >/dev/null 2>&1
OUT8="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "REVOKE SELECT(seq) ON public.payment_refund_events FROM authenticated;" >/dev/null 2>&1
printf '%s' "$OUT8" | grep -qF "弄髒了零直權面" \
  && ok "M8 欄級 GRANT(relacl 仍空)→ post assert④ 的欄級那本帳擋下" \
  || bad "M8 欄級 GRANT 沒被擋:$(printf '%s' "$OUT8" | grep ERROR | head -1)"

echo
echo "── 回退腳本(它本身也是產物)────────────────────────"
reset_preimage; apply_mig "$MIG" >/dev/null
RB="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
if printf '%s' "$RB" | grep -qF "rollback 完成"; then
  # 🔴 `strpos` 回的是**位置**不是布林(第一版寫 `::text` 比 '1',實跑印出 131)⇒ 一律轉 `>0`。
  RBS="$(q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'result_confirmed')>0)::text
            || '|' || (pg_catalog.strpos(pg_catalog.pg_get_indexdef('public.pre_one_terminal_uniq'::regclass),'result_success')>0)::text
            FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.payment_refund_events'::regclass AND c.conname='pre_event_type_chk';")"
  [ "$RBS" = "false|true" ] && ok "回退腳本可執行,且值域撤掉 result_confirmed、索引述詞把 result_success 收回來" \
                     || bad "回退後狀態=[$RBS](期望 false|true=值域已無 result_confirmed、索引已收回 result_success)"
else
  bad "回退腳本自驗沒過:$(printf '%s' "$RB" | grep ERROR | head -1)"
fi

RB2="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
printf '%s' "$RB2" | grep -qF "冪等重跑" \
  && ok "回退冪等:2d 產物已不在時重跑會說「無事可做」並仍跑完自驗" \
  || bad "回退第二次沒走冪等分支:$(printf '%s' "$RB2" | grep -E 'ERROR|NOTICE' | head -1)"

# 回退的「只撤一半」閘:手動把值域撤回、索引留在新集合 ⇒ 狀態不一致必須拒絕
reset_preimage; apply_mig "$MIG" >/dev/null
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'HALFSQL'
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk;
ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_failed','result_unknown','reconcile','manual'));
HALFSQL
RB3="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
# 🔴 收拾:半套狀態下 2d 回退會被自己的不一致閘擋(第一版就是這樣把下一發 reset 弄死的)
#    ⇒ 這格自己負責把值域補回七值,讓狀態重新等於「2d 完整套用」。
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'HALFR'
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk;
ALTER TABLE public.payment_refund_events ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_confirmed','result_failed','result_unknown','reconcile','manual'));
HALFR
printf '%s' "$RB3" | grep -qF "只有一邊" \
  && ok "回退的「只撤了一半」閘:值域已撤而索引還是新集合 → 拒絕往下(不盲目 DROP)" \
  || bad "只撤一半沒被擋:$(printf '%s' "$RB3" | grep -E 'ERROR|NOTICE' | head -1)"

echo
echo "── 順序閘:2c rollback 的「先退 2d」那道(2026-08-11 補的機制)──"
# 🔴 負:2d 還在時跑 2c 回退 —— 在補這道閘之前,實測是 **rc=0 完成**(E1),然後就退進死角。
#    這格要的不只是「紅了」,是**紅在指路句**上:操作者要知道下一步跑什麼。
reset_preimage; apply_mig "$MIG" >/dev/null
ORD="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=0 -f "$RB_2C" 2>&1)"; ORD_RC=$?
if [ "$ORD_RC" -eq 0 ]; then
  bad "順序閘-負 → 2d 還在時 2c 回退**照樣跑完**(rc=0)⇒ 閘沒生效,死角仍在"
elif printf '%s' "$ORD" | grep -qF "先跑 scripts/l5b2-2d-rollback.sql"; then
  ok "順序閘-負 → 2d 還在時 2c 回退被擋,且訊息逐字指路(rc=$ORD_RC)"
else
  bad "順序閘-負 → 紅了但沒指路:$(printf '%s' "$ORD" | grep ERROR | head -1)"
fi
# 🔴 正:同一道閘在 2d 不在時**必須放行** —— 沒有這一半,一個「無條件 RAISE」也會讓上面那格全綠。
#    跑完把 2c apply 回來(它是後面每一格的 pre-image),並驗真的回到位。
reset_preimage
ORD2="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=0 -f "$RB_2C" 2>&1)"; ORD2_RC=$?
# 🔴 復原 2c 要驗 **rc + 逐字定義**(對抗審查 R1 must-fix):只數「同名 CHECK 有幾條」的話,
#    2c 重套失敗後若留下一條同名恆真 CHECK,這格照樣綠,而後面每一格的 pre-image 都是假的。
apply_mig "$MIG_2C" >/dev/null; MIG2C_RC=$?
BACK="$(q "SELECT COALESCE(pg_catalog.pg_get_constraintdef(oid),'(無)') FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refund_events'::regclass AND conname='pre_manual_needs_verdict_chk';")"
BACK_WANT="CHECK ((COALESCE((event_type <> 'manual'::text), false) OR COALESCE((jsonb_typeof((record_snapshot -> 'refunded'::text)) = 'boolean'::text), false)))"
if [ "$ORD2_RC" -eq 0 ] && printf '%s' "$ORD2" | grep -qF "rollback 完成" && [ "$MIG2C_RC" -eq 0 ] && [ "$BACK" = "$BACK_WANT" ]; then
  ok "順序閘-正 → 2d 不在時 2c 回退照常完成(閘不是無條件 RAISE),且 2c 已逐字 apply 回 pre-image"
else
  bad "順序閘-正 → 回退 rc=$ORD2_RC / 2c 重套 rc=$MIG2C_RC / 復原後 condef=[$BACK]:$(printf '%s' "$ORD2" | grep ERROR | head -1)"
fi

echo
echo "── 收尾 ──────────────────────────────────────────────"
reset_preimage
OUT="$(apply_mig "$MIG")"
printf '%s' "$OUT" | grep -qE 'ERROR' && bad "最終套用失敗" || ok "最終狀態 = 2d 已套用"
LEFT="$(q "SELECT (SELECT count(*) FROM public.payment_refund_events) || '|' || (SELECT count(*) FROM public.payment_refunds);")"
[ "$LEFT" = "0|0" ] \
  && ok "行為格零留痕(事件 0 列 / 父列 0 列;每格 BEGIN…ROLLBACK 由構造保證,不靠事後清理——這張表 append-only 也清不掉)" \
  || bad "殘留=[$LEFT](期望 0|0)"

echo
echo "── 末段:前置閘⑤(資料閘)的唯一可構造負測 —— **汙染性,故意放在零留痕斷言之後** ──"
# 🔴 為什麼要繞這麼遠:在前置閘②④ 都通過的前提下,⑤ **恆為 0**(理由見誠實邊界)。
#    唯一逃逸路徑=舊索引是 **invalid**:`pg_get_indexdef` 對 invalid 索引印**一樣的字面**
#    ⇒ ④ 的「釘述詞」看不出來(它沒驗 `indisvalid`)。這格同時是 ⑤ 的負測與 ④ 的缺口證明。
# 🔴 這裡塞的是 **committed** 列,而 payment_refund_events 是 append-only(清不掉)⇒ 之後 reset 也回不去。
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'POLLUTE'
DROP INDEX public.pre_one_terminal_uniq;
DO $seed$
DECLARE v_order uuid; v_user uuid; v_attempt uuid := gen_random_uuid(); v_r uuid;
BEGIN
  SELECT o.id, o.customer_user_id INTO v_order, v_user FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status
     AND NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id = o.id)
   ORDER BY o.id LIMIT 1;
  INSERT INTO public.payment_charge_attempts
    (id, order_id, customer_user_id, status, fallback_token_hash, created_at, updated_at,
     settle_attempt_count, needs_manual_review, released_at, superseded_at, superseded_reason)
  VALUES (v_attempt, v_order, v_user, 'released', repeat('a', 64), now() - interval '2 days',
          now() - interval '2 days', 0, false, now(), now(), 'record_not_found');
  INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
  VALUES (v_attempt, 'pcm-2d-pollute', 100, 'TWD', 'rec:D2026081100P', 0) RETURNING id INTO v_r;
  INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token, record_snapshot)
  VALUES (v_r, 'result_failed', 1, 0, NULL), (v_r, 'manual', 2, 0, '{"refunded": true}'::jsonb);
END
$seed$;
POLLUTE
# CREATE INDEX CONCURRENTLY 不能在交易區塊內 ⇒ 單獨一句 `-c`(psql autocommit)。它會**失敗並留下 invalid 索引**。
psql "$URL" -qtAX -c "CREATE UNIQUE INDEX CONCURRENTLY pre_one_terminal_uniq ON public.payment_refund_events (refund_id) WHERE event_type IN ('result_success','result_failed','manual');" >/dev/null 2>&1
IDX="$(q "SELECT indisvalid::text || '|' || (pg_catalog.strpos(pg_catalog.pg_get_indexdef(indexrelid),'result_success')>0)::text FROM pg_catalog.pg_index WHERE indexrelid='public.pre_one_terminal_uniq'::regclass;")"
OUTP="$(apply_mig "$MIG")"
if [ "$IDX" != "false|true" ]; then
  bad "資料閘負測 → 構造前提沒成立(索引 indisvalid|述詞含舊集合=[$IDX],期望 false|true)⇒ 這格什麼都沒證明"
elif printf '%s' "$OUTP" | grep -qF "在新 terminal 集合下已有多筆終局事件"; then
  ok "資料閘負測 → 前置閘⑤ 擋下(舊索引 invalid ⇒ ④ 的字面比對放行,而⑤ 抓到 1 顆 refund 撞新集合)"
else
  bad "資料閘負測 → ⑤ 沒發火:$(printf '%s' "$OUTP" | grep ERROR | head -1)"
fi

echo
echo "── 誠實邊界(**沒有**被本矩陣證明的)────────────────"
cat <<'HONEST'
  ⚠️ 本片只給 schema 加**表達能力**,判定邏輯不在射程:N=3 日曆日、確認述詞(Record refunded_amount
     較 baseline 增加 ≥ 本 refund amount)、逾期落 manual 且不重試 —— 三者都屬 2e/2f/2g,
     本矩陣**一格都沒測**(母 plan `:451-455`)。schema 允許的事,不代表有人會照規格寫。
  ⚠️ 🔴 **前置閘⑤(資料閘)只在一種前提下發得了火**:在前置閘②④ 都通過的前提下它 **恆為 0** ——
     ②釘死值域不含 result_confirmed、④釘死舊索引述詞涵蓋 {result_success,result_failed,manual}
     ⇒ 新集合的任兩筆同顆組合要嘛需要 result_confirmed(值域擋)、要嘛是 {result_failed,manual}(舊索引擋)。
     末段那格用**唯一**的逃逸路徑構造出負測:舊索引 **invalid**(`pg_get_indexdef` 對 invalid 索引
     印一樣的字面 ⇒ ④ 放行)。⇒ 這同時暴露 ④ 的真缺口:**它沒驗 `indisvalid`**
     (前置閘④ 的**逐字比對**看不出 invalid)。2026-08-11 對抗審查後補上的是 **RAISE NOTICE 留痕**、
     不是擋下來 —— 擋了就換⑤ 抓不到重複資料。⇒ 「舊索引在 apply 前確實還在守」這件事,
     本片**只驗了字面 + 印了一行 NOTICE**,沒有擋;真正把資料層攔下來的是⑤。
  ⚠️ 🔴 **前置閘⑤-b(重複 result_success 計數)也恆為 0**,理由與⑤ 同構:在④ 通過(舊索引述詞含
     result_success 且 valid)的前提下,舊索引本來就在守它 ⇒ 唯一能讓它發火的是「舊索引曾 invalid」。
     本矩陣**沒有**為它單獨構造負測(末段那格構造的是⑤ 的重複組合);它的效力由行為格「③-負」
     在 apply **之後**證明(真的插兩筆 result_success 被新索引擋)。⇒ 「apply 前就有重複」這一族
     目前只有 fail-closed 的方向保證,沒有實測樣本。
  ⚠️ 🔴 **「先退 2d 再退 2c」的保護是 2026-08-11 才補的,補之前它不存在**:實跑證明當時 2d 還在時
     直接跑 `scripts/l5b2-2c-rollback.sql` 會**成功**(rc=0),之後 2d 回退卡在自驗、2c 也 apply 不回去
     ⇒ 死角。migration/rollback 檔頭原本宣稱「2c 的回退自驗會當場 abort」是**假的**(那句訊息的
     真正出處是 2c **migration 的前置閘**)。現況=2c rollback 已有順序閘,由上面「順序閘-負/正」
     兩格正反對照守著。**但它守的只是這條退場路徑本身**:正式庫上誰去跑那支腳本、
     跑之前有沒有人先手動撤掉那道閘,本矩陣證不了。
  ⚠️ 本矩陣全在本機 PG17.10;正式庫 17.6。pre-image 的 condef/indexdef 常數是 17.10 實查值,
     若 17.6 的重組格式不同,前置閘會**擋下 apply**(fail-closed、方向安全)——處置是人去判斷
     「格式差異 vs 真漂移」,**不是**把常數改成現況。
  ⚠️ 本 harness 對 fixture 是破壞性的(DROP/ADD 真實約束與索引)⇒ 只准在自己 provision 的
     拋棄式叢集上跑;叢集身分閘是承重的,不是裝飾。
HONEST

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"; exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
