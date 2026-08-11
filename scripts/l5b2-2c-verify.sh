#!/usr/bin/env bash
# ============================================================
# L5b-2 片 2c 驗證 harness:退款帳本的一欄 + 三條 CHECK
# ============================================================
# plan   = docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§2 片表 2c / §2f-1~3
# 標的   = supabase/migrations/20260811080000_m4b_lifecycle_l5b2_2c_refund_ledger_columns_checks.sql
# 回退   = scripts/l5b2-2c-rollback.sql(本檔每次 reset 都跑它 ⇒ 回退腳本被實跑十幾次)
#
# 用法(workdir = d1t2 provision 的 workdir;身分閘要讀它的 cluster-id):
#   scripts/l5b2-2c-verify.sh all <workdir>          自己 provision → 跑 → teardown
#   PORT=54403 scripts/l5b2-2c-verify.sh run <workdir>   叢集已在(開發用)
#
# 🔴 本片的守門有兩種,**驗法不同,不可混談**:
#   · **結構**(欄在不在、CHECK 在不在且 validated、既有約束沒被動到)→ 查 catalog。
#   · **行為**(那三條 CHECK 到底擋不擋得住壞值)→ **真的 INSERT 進去看它拒絕**。
#     只有結構斷言 = 只證「約束存在」,證不了它擋得住什麼(memory `feedback_guard-checks-existence-not-effect`)。
#
# 🔴 每一發 **CHECK 行為負測**都**驗 constraint 名字,不只驗 SQLSTATE**(plan §5-7):
#   `23514` 是所有 CHECK 違反共用的碼 ⇒ 只比碼會把「別的 CHECK 擋下來」誤判成「我這條生效了」。
#   本片一次加三條、表上原本還有六條 ⇒ 這個誤判是實實在在構造得出來的。
#   ⚠️ **射程收窄**(對抗審查 R2,成立):原本這裡寫「每一發負測」,但 M1-M11 與回退負測
#   **不是** CHECK 違反,它們的 oracle 是各自的 RAISE 訊息字面,沒有 23514 可驗。
#   寫成「每一發」是把一個**只對行為格成立**的紀律講成全域的 —— 同一種超稱在本片已被抓過三次。
#
# 🔴 隔離:每格 `BEGIN … ROLLBACK`,零留痕由**構造**保證,不靠事後清理。
# ============================================================
set -uo pipefail
export LC_ALL=C

MODE="run"
case "${1:-}" in all|run) MODE="$1"; shift ;; esac
WORK="${1:-/tmp/l5b2c}"
PORT="${PORT:-54403}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

MIG="supabase/migrations/20260811080000_m4b_lifecycle_l5b2_2c_refund_ledger_columns_checks.sql"
ROLLBACK="scripts/l5b2-2c-rollback.sql"

# 🔴 依賴檔 SHA 釘死(2a 的 R2 教訓):w7 收據只記 harness 自己的 SHA 與 migration 目錄尾碼
#    ⇒ 同一尾碼下改了 migration 或 rollback 而不動 harness,帳面照樣全綠。釘在這裡才閉合。
MIG_SHA_EXPECT="475ae0d6fc3f9ea507291efc7fde8b2c9023dc8f"
RB_SHA_EXPECT="1139b2a8c984340c08f2b2a81a5a729a06ea6ccd"

# 🔴 量出來的,不是估的(每加/刪一格必同步改;它就是「刪格會紅」那道守門)
#    ⚠️ 病史(這道閘總共擋下我自己**四次**,每次都是同一個動作:用加減算而不是用跑的):
#       ①第一版寫 26(估)→ 實跑 28。②③ R1 折完兩度算錯。
#       ④ R2 折完我寫 40 —— 因為心裡數的是「新增四格」,實際新增五格(漏數了 U+00A0 那格)。
#       ⑤ R3 折完補 M12,又是實跑才知道是 42。
#       註解寫著「量出來的」而值是猜的 = 註解在替一個沒發生的動作背書,比沒註解更糟。
#    🔴 下面這個數字是 2026-08-11 R3 折完後**實跑印出 PASS=42 才回填的**,不是加減算出來的。
#    ⚠️ **要數格數請看腳本尾端印的 `PASS=`,不要用 `grep -c "^  ok"`** ——
#       `all` 模式會多印一行「ok provision 完成」,那行是 echo 不經過計數器 ⇒ grep 會多算一格。
#       (我 R2 的 commit body 就是寫那個 grep 當數法,`run` 模式下對、`all` 模式下錯。)
EXPECT_TOTAL=42

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }

test -f "$MIG"      || { echo "🔴 找不到 $MIG(請在 repo 根目錄跑)"; exit 1; }
test -f "$ROLLBACK" || { echo "🔴 找不到 $ROLLBACK"; exit 1; }
for pair in "$MIG:$MIG_SHA_EXPECT" "$ROLLBACK:$RB_SHA_EXPECT"; do
  _f="${pair%%:*}"; _want="${pair##*:}"; _got="$(shasum "$_f" | cut -d' ' -f1)"
  [ "$_got" = "$_want" ] || { echo "🔴 $_f 的 SHA=[$_got] 與本檔釘住的 [$_want] 不符 ⇒ 依賴檔改過但本檔沒同步。"; \
      echo "   改法:確認改動是預期的,更新本檔的 *_SHA_EXPECT,然後 record 重跑(不要只改常數不重跑)。"; exit 1; }
done
mkdir -p "$WORK"
MUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/l5b2-2c-mut.XXXXXX")"
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
# 🔴 本腳本會 ALTER 退款帳本。PORT 指到別窗的叢集時損害是真的 ⇒ 拒絕在身分不明的叢集上跑。
if [ ! -f "$WORK/cluster-id" ]; then
  echo "🔴 $WORK/cluster-id 不存在 ⇒ 無法確認 PORT=$PORT 上的叢集身分,拒跑。"
  echo "   用 'scripts/l5b2-2c-verify.sh all <workdir>',或把 <workdir> 指向 provision 用的目錄。"
  exit 1
fi
LIVE_ID="$(q "SELECT system_identifier FROM pg_control_system();")"
WANT_ID="$(cat "$WORK/cluster-id")"
if [ -z "$LIVE_ID" ] || [ "$LIVE_ID" != "$WANT_ID" ]; then
  echo "🔴 叢集身分不符:PORT=$PORT 上是 [$LIVE_ID],期望 [$WANT_ID]。拒跑。"; exit 1
fi
ok "叢集身分閘:PORT=$PORT 確認是本 workdir provision 的那個叢集"

reset_preimage() {
  # 🔴 reset 用 `force_nonempty=1`:M7/M8 會刻意留下 guard 列(append-only 清不掉),
  #    而破壞性閘看到非 NULL 快照就會拒絕 ⇒ 不帶 force 的話**我自己的閘會擋住我自己的 reset**。
  #    這不是繞過守門:閘的行為由 M7(force=0 必拒)與 M8(非法值必拒)兩格**正面驗證**,
  #    reset 這裡是「已知情、在拋棄式叢集上、明示放行」——正是那個旗標存在的用途。
  if ! psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=1 -f "$ROLLBACK" > "$MUTDIR/reset.log" 2>&1; then
    echo "🔴🔴 reset 失敗(回退腳本自己紅了)⇒ 後面每一格都不算數,停止。log:"; tail -5 "$MUTDIR/reset.log"; exit 1
  fi
  # setup 有效性斷言:沒真的回到 pre-image,後面整張矩陣的紅都不算數
  local st
  st="$(q "SELECT (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refunds'::regclass AND contype='c')
           || '|' || (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='public.payment_refunds'::regclass AND attname='rec_trade_id' AND NOT attisdropped)
           || '|' || (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conname='pre_manual_needs_verdict_chk' AND conrelid='public.payment_refund_events'::regclass);")"
  if [ "$st" != "6|0|0" ]; then
    echo "🔴🔴 reset 後基線不符(期望 6|0|0,實際 $st)⇒ 後續格全部無效,停止"; exit 1
  fi
}
# 🔴 **必須把 exit code 併進輸出**(對抗審查 R2,實測命中):
#   psql **連線失敗**時印的是小寫 `psql: error: connection to server ... failed`、exit=2,
#   輸出裡**沒有大寫 `ERROR`** ⇒ 所有 `grep -qE 'ERROR'` 的正向格會判成「成功」。
#   最壞情況:叢集掛掉 ⇒ 每一格都「通過」⇒ **PASS=EXPECT_TOTAL 而 2c 根本沒被套用**。
#   (memory `reference_exit-code-provenance-three-traps`:先確認 exit code 是誰的。)
apply_mig() {
  local out rc
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$1" 2>&1)"; rc=$?
  printf '%s' "$out"
  [ "$rc" -eq 0 ] || printf '\nERROR: psql exit=%s(apply_mig;非零退出碼一律當紅,不看輸出長相)\n' "$rc"
}

# 行為格:$1=格名 $2=期望(OK 或 constraint 名) $3=SQL 片段(在已 seed 的交易裡跑)
# 🔴 期望是**約束名**不是 SQLSTATE:23514 由所有 CHECK 共用,只比碼會把別條的擋當成自己的功勞。
behaviour() {
  local name="$1" want="$2" sql="$3" out
  # 🔴 `VERBOSITY=verbose` 才會印出 SQLSTATE(psql 預設不印;memory
  #    `reference_psql-ta-boolean-cast-renders-true-not-t` 同族)。沒有它,下面「驗 23514」那半是空話。
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL 2>&1
BEGIN;
DO \$b\$
DECLARE
  v_order uuid; v_user uuid; v_attempt uuid := gen_random_uuid();
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
  PERFORM pg_catalog.set_config('l5b2_2c.attempt', v_attempt::text, true);
END
\$b\$;
$sql
ROLLBACK;
SQL
)"; local rc=$?
  if [ "$want" = "OK" ]; then
    # 🔴 exit code 與輸出**兩者都要看**(對抗審查 R2):連線失敗是 exit=2 + 小寫 `psql: error:`,
    #    只 grep 大寫 ERROR 會把「根本沒連上」判成「插入成功」。
    if [ "$rc" -ne 0 ]; then
      bad "$name → psql exit=$rc(不是約束問題,這格什麼都沒證明):$(printf '%s' "$out" | grep -iE 'error' | head -1)"
    elif printf '%s' "$out" | grep -qF 'SEED_BROKEN:'; then
      bad "$name → 紅在 fixture 前提而不是約束 ⇒ 這格證不了東西"
    elif printf '%s' "$out" | grep -qE 'ERROR'; then
      bad "$name → 應該被接受卻紅了:$(printf '%s' "$out" | grep ERROR | head -1)"
    else ok "$name"; fi
    return
  fi
  if printf '%s' "$out" | grep -qF "SEED_BROKEN:"; then
    bad "$name → 紅在 fixture 前提而不是約束 ⇒ 這格證不了東西"; return
  fi
  # 🔴 **兩件都要**(對抗審查 R1:我註解寫「同時驗 23514 與名字」,實作只 grep 了名字 ⇒
  #    把 RAISE 換成 P0001 而訊息含該名稱,這格照樣綠)。
  #    ①SQLSTATE 必須是 23514(check_violation)②訊息必須含**我點名的那條約束名**。
  if ! printf '%s' "$out" | grep -qF '23514'; then
    bad "$name → 不是 CHECK 違反(SQLSTATE 非 23514);實際:$(printf '%s' "$out" | grep -E 'ERROR|SQLSTATE' | head -1)"; return
  fi
  if printf '%s' "$out" | grep -qF "$want"; then
    ok "$name → 被 [$want] 擋下(23514 + 約束名兩者皆中)"
  else
    bad "$name → 23514 對了但不是 [$want] 那條;實際:$(printf '%s' "$out" | grep -E 'ERROR|DETAIL' | head -1)"
  fi
}

INS_REFUND="INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token, rec_trade_id) VALUES (pg_catalog.current_setting('l5b2_2c.attempt')::uuid, 'pcm-2c-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,8), 100, 'TWD'"

echo
echo "── 正向(套用 2c)────────────────────────────────────"
reset_preimage
OUT="$(apply_mig "$MIG")"
if printf '%s' "$OUT" | grep -qE '^ERROR|ERROR:'; then bad "2c 套用失敗:$(printf '%s' "$OUT" | grep ERROR | head -1)"; else ok "2c 套用成功"; fi

# 🔴 鎖 conrelid(對抗審查 R2):約束名只對同一張表唯一。不鎖的話,別表若有同名 CHECK,
#    這個計數會**替缺席的目標約束補數** ⇒ 三條裡少了一條也照樣數到 3 = 恆綠。
#    (同一條 R1 已在 migration 與 rollback 修過,harness 這處漏掉 —— 修兩處漏第三處。)
S="$(q "SELECT (SELECT count(*) FROM pg_catalog.pg_constraint WHERE contype='c' AND convalidated AND ((conrelid='public.payment_refunds'::regclass AND conname IN ('pr_rec_trade_id_shape_chk','pr_strong_key_domain_chk')) OR (conrelid='public.payment_refund_events'::regclass AND conname='pre_manual_needs_verdict_chk')))
        || '|' || (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refunds'::regclass AND contype='c')
        || '|' || (SELECT a.atttypid::regtype::text || ':' || a.attnotnull::text FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.payment_refunds'::regclass AND a.attname='rec_trade_id');")"
[ "$S" = "3|8|text:false" ] && ok "結構:三條新 CHECK validated / 表上共 8 條 / rec_trade_id=text 且 nullable" || bad "結構=[$S](期望 3|8|text:false)"

echo
echo "── 行為格:那三條 CHECK 到底擋不擋得住(驗約束名,不只驗 23514)──"
behaviour "①-正 rec_trade_id=NULL(弱識別情境;必須放行)" OK \
  "$INS_REFUND, 'rec:D202608110001', 0, NULL);"
behaviour "①-正 rec_trade_id 有值 → 放行" OK \
  "$INS_REFUND, 'rec:D202608110002', 0, 'D202608110002');"
behaviour "①-負 rec_trade_id='' → pr_rec_trade_id_shape_chk" "pr_rec_trade_id_shape_chk" \
  "$INS_REFUND, 'rec:D202608110003', 0, '');"
behaviour "①-負 rec_trade_id='   '(純空白)→ pr_rec_trade_id_shape_chk" "pr_rec_trade_id_shape_chk" \
  "$INS_REFUND, 'rec:D202608110004', 0, '   ');"

behaviour "②-正 strong_key='rec:…' → 放行" OK \
  "$INS_REFUND, 'rec:D202608110005', 0, NULL);"
behaviour "②-正 strong_key='bank:…' → 放行" OK \
  "$INS_REFUND, 'bank:BK-20260811_0006', 0, NULL);"
behaviour "②-負 前綴不在值域('foo:x')→ pr_strong_key_domain_chk" "pr_strong_key_domain_chk" \
  "$INS_REFUND, 'foo:D202608110007', 0, NULL);"
behaviour "②-負 無前綴(裸值)→ pr_strong_key_domain_chk" "pr_strong_key_domain_chk" \
  "$INS_REFUND, 'D202608110008', 0, NULL);"
behaviour "②-負 前綴後為空('rec:')→ pr_strong_key_domain_chk" "pr_strong_key_domain_chk" \
  "$INS_REFUND, 'rec:', 0, NULL);"
# 🔴 上界從 64 改成 128(取 20260613120000:55/:61 那個最寬的界;R3=F1 更正原本寫錯的座標)後,
#    這兩格的數字同批更新。
#    ⚠️ 這正是「改了值域就要回頭掃測試」的實例:不改的話 65 字那格會**因為新值域放行而紅**,
#    而紅的原因與它宣稱要測的東西無關。
behaviour "②-負 後綴 129 字(超上界)→ pr_strong_key_domain_chk" "pr_strong_key_domain_chk" \
  "$INS_REFUND, 'rec:' || pg_catalog.repeat('A', 129), 0, NULL);"
behaviour "②-邊界 後綴 128 字(上界內)→ 放行" OK \
  "$INS_REFUND, 'rec:' || pg_catalog.repeat('A', 128), 0, NULL);"
behaviour "②-負 後綴含空白('rec:AB C')→ pr_strong_key_domain_chk" "pr_strong_key_domain_chk" \
  "$INS_REFUND, 'rec:AB C', 0, NULL);"
behaviour "①-負 rec_trade_id 是單一 tab(btrim 去不掉)→ pr_rec_trade_id_shape_chk" "pr_rec_trade_id_shape_chk" \
  "$INS_REFUND, 'rec:D202608110009', 0, E'\\t');"
# 🔴 R2-MF4:這格**釘住的是一個已知邊界,不是一個守門** —— 它斷言 U+00A0 會被**放行**。
#    `[:space:]` 的射程是 ASCII 空白(本叢集 datctype=C,17.10 實測 U+00A0 通過)。
#    寫成格子而不是只寫在註解裡,是因為註解不會在行為改變時變紅:
#    哪天 locale 或 PG 版本讓 U+00A0 被歸類成 space,這格會**紅**,逼人回來重讀那段誠實邊界。
behaviour "①-邊界 rec_trade_id 含 U+00A0(非 ASCII 空白)→ **放行**(已知邊界,不是守門)" OK \
  "$INS_REFUND, 'rec:D202608110010', 0, 'A' || pg_catalog.chr(160) || 'B');"

MANUAL_PARENT="WITH p AS (INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token) VALUES (pg_catalog.current_setting('l5b2_2c.attempt')::uuid, 'pcm-2c-m' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,7), 100, 'TWD', 'rec:D20260811M', 0) RETURNING id) INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token, record_snapshot) SELECT p.id"
behaviour "③-正 manual 帶 {\"refunded\":true} → 放行" OK \
  "$MANUAL_PARENT, 'manual', 1, 0, '{\"refunded\": true}'::jsonb FROM p;"
behaviour "③-正 manual 帶 {\"refunded\":false} → 放行(false 是合法判定,不是缺值)" OK \
  "$MANUAL_PARENT, 'manual', 1, 0, '{\"refunded\": false}'::jsonb FROM p;"
behaviour "③-負 manual 無 record_snapshot → pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "$MANUAL_PARENT, 'manual', 1, 0, NULL FROM p;"
behaviour "③-負 manual 有 snapshot 但缺 refunded 鍵 → pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "$MANUAL_PARENT, 'manual', 1, 0, '{\"note\": \"人工處理過\"}'::jsonb FROM p;"
behaviour "③-負 refunded 是字串不是 boolean → pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "$MANUAL_PARENT, 'manual', 1, 0, '{\"refunded\": \"yes\"}'::jsonb FROM p;"
behaviour "③-負 🔴 snapshot 是 **JSON 陣列** ['refunded'] → pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "$MANUAL_PARENT, 'manual', 1, 0, '[\"refunded\"]'::jsonb FROM p;"
behaviour "③-負 snapshot 是純量 true(不是物件)→ pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "$MANUAL_PARENT, 'manual', 1, 0, 'true'::jsonb FROM p;"
behaviour "③-正 **非** manual 事件無 snapshot → 放行(本條只管 manual,不得誤傷別的事件型別)" OK \
  "$MANUAL_PARENT, 'sent', 1, 0, NULL FROM p;"
# 🔴 R2-MF2 的負測:左半 `event_type <> 'manual'` 自己也會傳染 NULL。
#    撤掉 event_type 的 NOT NULL(DDL 在交易內、隨 ROLLBACK 一起消失)後插 event_type=NULL:
#    · 舊的 pre_event_type_chk 求值 NULL ⇒ 放行(它擋不住)
#    · 本片這條若**沒有**左半的 COALESCE ⇒ `NULL OR false` = NULL ⇒ 也放行 = 兩條一起瞎
#    ⇒ 這格紅在 pre_manual_needs_verdict_chk,才證明「由構造保證」那句是真的。
behaviour "③-負 🔴 event_type=NULL(NOT NULL 被撤掉)→ pre_manual_needs_verdict_chk" "pre_manual_needs_verdict_chk" \
  "ALTER TABLE public.payment_refund_events ALTER COLUMN event_type DROP NOT NULL; $MANUAL_PARENT, NULL, 1, 0, NULL FROM p;"

echo
echo "── 突變矩陣(每道斷言各一發)────────────────────────"
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
  # 突變被擋 ≠ 什麼都沒落地:確認整片真的回滾了(仍是 pre-image)
  local now; now="$(q "SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refunds'::regclass AND contype='c';")"
  if [ "$now" != "6" ]; then bad "$name → 紅對了,但表上有 $now 條 CHECK(期望 6)⇒ 失敗的 migration 有東西落地"; return; fi
  ok "$name → 紅在預期那道,且整片已回滾"
}

# 🔴 M1 的語法我第一版寫錯(`NOT VALID CHECK` 不合法;正確是 `… CHECK (…) NOT VALID`)⇒
#    突變檔一跑就 syntax error,那格什麼都沒證明。照實跑校正。
mutate "M1 把新 CHECK 改成 NOT VALID(存在但不驗既有列)→ convalidated 斷言" \
  "條存在且 validated" \
  "src.replace(chr(39) + '^(rec|bank):[^[:space:][:cntrl:]]{1,128}$' + chr(39) + ');', chr(39) + '^(rec|bank):[^[:space:][:cntrl:]]{1,128}$' + chr(39) + ') NOT VALID;', 1)"

mutate "M2 順手取代掉一條既有 CHECK(pr_strong_key_nonblank_chk)→ 既有約束計數斷言" \
  "有既有約束被動到" \
  "src.replace('ALTER TABLE public.payment_refunds' + chr(10) + '  ADD CONSTRAINT pr_strong_key_domain_chk', 'ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_strong_key_nonblank_chk;' + chr(10) + 'ALTER TABLE public.payment_refunds' + chr(10) + '  ADD CONSTRAINT pr_strong_key_domain_chk', 1)"

mutate "M3 rec_trade_id 加成 NOT NULL(永久關掉回填)→ nullable 斷言" \
  "被加成 NOT NULL" \
  "src.replace('  ADD COLUMN rec_trade_id text;', '  ADD COLUMN rec_trade_id text NOT NULL DEFAULT ' + chr(39) + 'x' + chr(39) + ';', 1)"

mutate "M4 刪掉欄註解(它記著「快照不是外鍵」與「為何刻意 nullable」)→ COMMENT 斷言" \
  "欄註解不見了" \
  "re.sub(r'COMMENT ON COLUMN public\\.payment_refunds\\.rec_trade_id IS(\\n  ' + chr(39) + '[^' + chr(39) + ']*' + chr(39) + ')+;', '', src)"

# M5:改**庫**不是改檔 —— 欄集合漂移必須被前置閘擋下(且 ALTER 不該發生)
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "ALTER TABLE public.payment_refunds ADD COLUMN l5b2_2c_probe text;" >/dev/null 2>&1
OUT5="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "ALTER TABLE public.payment_refunds DROP COLUMN IF EXISTS l5b2_2c_probe;" >/dev/null 2>&1
if printf '%s' "$OUT5" | grep -qF "欄集合與 pre-image 不符"; then
  ok "M5 別的片先加了一欄 → 前置閘擋下(不安靜疊上去)"
else
  bad "M5 欄集合漂移沒被擋:$(printf '%s' "$OUT5" | grep ERROR | head -1)"
fi

# ── 🔴 R1-MF13 補:三發原本完全沒有的突變 ─────────────────────────────
# M6 欄級 ACL:只進 attacl、relacl 維持空 ⇒ 只查表級的斷言會宣告「零權限」而事實上有後門
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "GRANT SELECT(amount) ON public.payment_refunds TO authenticated;" >/dev/null 2>&1
OUT6="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "REVOKE SELECT(amount) ON public.payment_refunds FROM authenticated;" >/dev/null 2>&1
printf '%s' "$OUT6" | grep -qF "欄級" \
  && ok "M6 欄級 GRANT(relacl 仍空)→ 前置閘的欄級那本帳擋下" \
  || bad "M6 欄級 GRANT 沒被擋:$(printf '%s' "$OUT6" | grep ERROR | head -1)"

# ── 🔴 R2-MF7 補:R1 新加的三道守門原本**一發突變都沒有** ────────────────
# R1 我補了「condef 釘死」「父表型別/NOT NULL」「子表 pre-image」三道,卻沒有給它們各自的靶
# ⇒ 那三道就算完全失效,36 格照樣全綠(memory `feedback_guard-checks-existence-not-effect`)。
# 下面四發各打一道,且**每發只讓一道紅**(訊息字面不同 ⇒ 判別力可分辨)。
# ⚠️ 這幾發改的是**庫**不是檔,而 reset 跑的回退腳本只撤 2c 的產物、**不會**修復被我改壞的既有約束
#    ⇒ 每發自己負責還原。還原若失敗,下一發會紅在錯誤的訊息上(fail-closed、看得見)。

# M9 把既有約束換成**等價恆真式**(名字不變、數量不變)⇒ 只有 condef 那道抓得到。
#    這正是 R1 版 `strpos(...,'CHECK (true)')` 抓不到的形狀(17.10 實測:回 `CHECK ((1 = 1))`)。
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'M9SQL'
ALTER TABLE public.payment_refunds DROP CONSTRAINT pr_strong_key_nonblank_chk;
ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_strong_key_nonblank_chk CHECK (1=1);
M9SQL
OUT9="$(apply_mig "$MIG")"
psql "$URL" -qtAX >/dev/null 2>&1 <<'M9R'
ALTER TABLE public.payment_refunds DROP CONSTRAINT IF EXISTS pr_strong_key_nonblank_chk;
ALTER TABLE public.payment_refunds ADD CONSTRAINT pr_strong_key_nonblank_chk CHECK (btrim(strong_key) <> '');
M9R
printf '%s' "$OUT9" | grep -qF "既有 CHECK 的**定義**與 pre-image 不符" \
  && ok "M9 既有約束被換成恆真等價式 CHECK (1=1)(同名同數)→ condef 那道擋下" \
  || bad "M9 恆真等價式沒被擋(R1 的 strpos 版就是這樣漏的):$(printf '%s' "$OUT9" | grep ERROR | head -1)"

# M10 父表撤 NOT NULL(名字/數量/condef 全不變)⇒ 只有型別/NOT NULL 那道抓得到。
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "ALTER TABLE public.payment_refunds ALTER COLUMN strong_key DROP NOT NULL;" >/dev/null 2>&1
OUT10="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "ALTER TABLE public.payment_refunds ALTER COLUMN strong_key SET NOT NULL;" >/dev/null 2>&1
printf '%s' "$OUT10" | grep -qF "payment_refunds 的**欄型別/NOT NULL**" \
  && ok "M10 父表 strong_key 撤 NOT NULL → 型別/NOT NULL 那道擋下" \
  || bad "M10 父表 NOT NULL 漂移沒被擋:$(printf '%s' "$OUT10" | grep ERROR | head -1)"

# M11 子表撤 NOT NULL ⇒ 只有 R2 新加的子表欄形狀那道抓得到。
#     這一發打的是 R2 findings 裡最實質的那條:event_type 可為 NULL 時,
#     舊 pre_event_type_chk 與本片新 CHECK 會**一起**求值成 NULL 而放行。
reset_preimage
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "ALTER TABLE public.payment_refund_events ALTER COLUMN event_type DROP NOT NULL;" >/dev/null 2>&1
OUT11="$(apply_mig "$MIG")"
psql "$URL" -qtAX -c "ALTER TABLE public.payment_refund_events ALTER COLUMN event_type SET NOT NULL;" >/dev/null 2>&1
printf '%s' "$OUT11" | grep -qF "payment_refund_events 的**欄型別/NOT NULL**" \
  && ok "M11 子表 event_type 撤 NOT NULL → 子表欄形狀那道擋下" \
  || bad "M11 子表 NOT NULL 漂移沒被擋:$(printf '%s' "$OUT11" | grep ERROR | head -1)"

# M12 打 R3=N1 新補的那道:**回退自驗**的子表欄形狀檢查。
#    不能用 reset_preimage 跑(它一紅整支腳本就停)⇒ 照 M7/M8 的形制自己叫 rollback。
#    此刻 2c 未套用(M11 的 apply 已整片回滾)⇒ 回退走冪等路徑,紅的只會是自驗那道。
psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "ALTER TABLE public.payment_refund_events ALTER COLUMN event_type DROP NOT NULL;" >/dev/null 2>&1
G4="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=1 -f "$ROLLBACK" 2>&1)"
psql "$URL" -qtAX -c "ALTER TABLE public.payment_refund_events ALTER COLUMN event_type SET NOT NULL;" >/dev/null 2>&1
printf '%s' "$G4" | grep -qF "payment_refund_events 的欄型別/NOT NULL 與 pre-image 不符" \
  && ok "M12 回退自驗也擋得住子表 NOT NULL 漂移(與 migration 前置閘對稱)" \
  || bad "M12 回退自驗沒擋住子表漂移:$(printf '%s' "$G4" | grep -E 'ERROR|NOTICE' | head -1)"

# M7/M8 回退的破壞性閘:要真的有一列非 NULL 快照才構造得出來 ⇒ 用 committed 資料,測完刪掉
reset_preimage; apply_mig "$MIG" >/dev/null
# 🔴 這裡**重用既有 attempt**,不新建。理由是實測出來的:d1t2 fixture 只有 29 張單 / 27 個 attempt
#    ⇒ 「unpaid 且無 attempt」的訂單只剩一兩張,而本段是 **committed** 寫入(append-only 清不掉)
#    ⇒ 每跑一輪就吃掉一張,第二輪起所有行為格全部 SEED_BROKEN。第一版就是這樣壞的。
#    行為格用 BEGIN…ROLLBACK 不消耗,但這一段不行 ⇒ 它必須自己不佔資源。
psql "$URL" -qtAX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SEED'
DO $seed$
DECLARE v_attempt uuid;
BEGIN
  SELECT a.id INTO v_attempt FROM public.payment_charge_attempts a ORDER BY a.id LIMIT 1;
  IF v_attempt IS NULL THEN
    RAISE EXCEPTION 'SEED_BROKEN:一個 attempt 都沒有,M7/M8 構造不出來';
  END IF;
  INSERT INTO public.payment_refunds
    (attempt_id, idempotency_key, amount, currency, strong_key, lease_token, rec_trade_id)
  VALUES (v_attempt,
          'pcm-2c-guard' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text),1,8),
          100, 'TWD', 'rec:D20260811GUARD', 0, 'D20260811GUARD');
END $seed$;
SEED
G1="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=0 -f "$ROLLBACK" 2>&1)"
printf '%s' "$G1" | grep -qF "會**永久刪掉**它們" \
  && ok "M7 有非 NULL 快照時,回退**拒絕執行**(破壞性閘生效)" \
  || bad "M7 破壞性閘沒擋:$(printf '%s' "$G1" | grep -E 'ERROR|NOTICE' | head -1)"
# 🔴 M8:第一版的 force 判準是 `<> '0'` ⇒ `false` 這種值會被當成「強制放行」。改成只認 '1' 之後必須仍拒絕。
G2="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=false -f "$ROLLBACK" 2>&1)"
printf '%s' "$G2" | grep -qF "會**永久刪掉**它們" \
  && ok "M8 force_nonempty=false(非字面 1)→ 仍拒絕(白名單而不是黑名單)" \
  || bad "M8 非法 force 值把破壞性閘打開了:$(printf '%s' "$G2" | grep -E 'ERROR|NOTICE' | head -1)"
# 明示放行後應真的執行(證明閘不是恆拒 = 有判別力的另一半)
G3="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=1 -f "$ROLLBACK" 2>&1)"
printf '%s' "$G3" | grep -qF "rollback 完成" \
  && ok "M8b force_nonempty=1 明示放行 → 真的執行(閘不是恆拒)" \
  || bad "M8b 明示放行仍不執行:$(printf '%s' "$G3" | grep ERROR | head -1)"
# 🔴 **這裡刻意不清理**:payment_refunds 是 append-only,DELETE 會被 `prl_append_only_guard()` 擋。
#    我第一版寫了 DELETE 又用 `>/dev/null 2>&1` 把錯誤吞掉 ⇒ 看起來清了、其實沒清,
#    最後是收尾的殘留斷言把它抓出來的。**清不掉是這張表的設計,不是缺陷** ⇒ 改成明說。

echo
echo "── 回退腳本(它本身也是產物)────────────────────────"
reset_preimage; apply_mig "$MIG" >/dev/null
RB="$(psql "$URL" -v ON_ERROR_STOP=1 -v force_nonempty=0 -f "$ROLLBACK" 2>&1)"
if printf '%s' "$RB" | grep -qF "rollback 完成"; then
  RBS="$(q "SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.payment_refunds'::regclass AND contype='c';")"
  [ "$RBS" = "6" ] && ok "回退腳本可執行且真的回到 pre-image(6 條 CHECK、欄已撤)" || bad "回退後 CHECK 數=$RBS(期望 6)"
else
  bad "回退腳本自驗沒過:$(printf '%s' "$RB" | grep ERROR | head -1)"
fi

echo
echo "── 收尾 ──────────────────────────────────────────────"
reset_preimage
OUT="$(apply_mig "$MIG")"
printf '%s' "$OUT" | grep -qE 'ERROR' && bad "最終套用失敗" || ok "最終狀態 = 2c 已套用"
# 🔴 **這張表是 append-only(trigger 擋 DELETE / UPDATE / TRUNCATE,`20260810140000` 建的)**
#    ⇒ M7/M8 那三格必須用 **committed** 資料才構造得出破壞性閘,而那一列**清不掉,也不該清**
#      (清得掉就代表 append-only 守門壞了)。我第一版寫 `DELETE … ` 收尾,被自己的殘留斷言抓到:
#      DELETE 直接被 `prl_append_only_guard()` 擋下,而我用 `>/dev/null` 把錯誤吞了。
#    ⇒ 誠實的斷言不是「零列」,是「**除了本 harness 的 guard 列以外,零列**」。
#      這也是為什麼上面的**叢集身分閘**是承重的:本 harness 對 fixture 是破壞性的,
#      只准在自己 provision 的拋棄式叢集上跑。
LEFT="$(q "SELECT count(*) FROM public.payment_refunds WHERE idempotency_key NOT LIKE 'pcm-2c-guard%';")"
GUARD="$(q "SELECT count(*) FROM public.payment_refunds WHERE idempotency_key LIKE 'pcm-2c-guard%';")"
[ "$LEFT" = "0" ] \
  && ok "行為格零留痕(非 guard 列 = 0;每格 BEGIN…ROLLBACK 由構造保證。guard 列 $GUARD 筆是 M7/M8 刻意留下的、append-only 表清不掉)" \
  || bad "殘留 $LEFT 列非 guard 資料"

echo
echo "── 誠實邊界(**沒有**被本矩陣證明的)────────────────"
cat <<'HONEST'
  ⚠️ 三條 CHECK 只保證**形狀**,不保證**內容對**:
     · `rec_trade_id` 非空白 ≠ 它真的是那筆交易的 rec(綁錯單 schema 擋不住,靠 plan 核心點 2 的條件 11-13);
     · `strong_key` 前綴合法 ≠ 它指到的東西存在(值域不是外鍵);
     · `manual` 帶 boolean verdict ≠ 人填對了 —— **填錯目前沒有修正路徑**(詳下方那條;
       這裡原本寫「填錯要靠新增沖銷事件」,那是 R1 已撤回的宣稱,R2 抓到它還留在本段)。
  ⚠️ `record.amount` 單位=整數元 的依據鏈最強一節是「生產行為背書」(charge 回應被直接當權威金額),
     **不是**直接觀測一筆真 Record 的 amount 與該單 total 並排。取得真實例後應回頭升級這一節。
  ⚠️ 本矩陣全在本機 PG17.10;正式庫 17.6。本片的斷言都用版本無關的 catalog 欄位,但**未在 17.6 實跑**。
     🔴 R2 補訂:pre-image 的 **condef 常數是寫死在 migration 裡的 17.10 實查值**,
     若 17.6 的 `pg_get_constraintdef` 重組格式不同,前置閘會**擋下 apply**(fail-closed、方向安全),
     處置是人去判斷「格式差異 vs 真漂移」,**不是**把常數改成現況。
  ⚠️ `[:space:]`/`[:cntrl:]` 只涵蓋 **ASCII** 空白與控制字元:U+00A0 這類非 ASCII 空白**會被放行**
     (17.10 datctype=C 實測,已釘成一格行為測)。要擋它只能改成 ASCII 正面表列,
     而那會比 adapter 收得更緊 ⇒ 可能誤擋合法退款。**知情接受的邊界,不是漏掉的守門。**
  ⚠️ `strong_key` / `rec_trade_id` 的 **1..128 上界是我自選的**,不是 TapPay 官方規範、
     也**不是**「對齊某個先例」—— repo 裡有三個互不相同的界(R3=F1 更正,原本這裡引的座標是假的):
     `20260613120000:55`/`:61` webhook_events=1..128、DB RPC 閘 `20260612150000:256`>64 即拒、
     `20260731120000:219` orj=1..20。我取最寬的 128,理由=金流路徑上「誤擋一筆合法退款」比「多收雜訊」貴。
  ⚠️ **manual 填錯目前沒有修正路徑**:單一 terminal 唯一索引(`20260810140000:137`)擋掉第二筆 manual,
     而「沖銷事件」的計算語意尚未存在 ⇒ 只能靠 owner 直接改資料(繞過 append-only)。
     這是本片**知情接受**的缺口,修法屬 2k 或另開片。
  ⚠️ 本 harness 對 fixture 是**破壞性**的:M7/M8 需要 committed 列,而 append-only 表清不掉
     ⇒ 只准在自己 provision 的拋棄式叢集跑(叢集身分閘是承重的,不是裝飾)。
HONEST

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"; exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
