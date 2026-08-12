#!/usr/bin/env bash
# ============================================================
# 沖銷片驗證 harness(manual_reversal + canonical view + 修改判定 RPC + op6a 換吃)
# ============================================================
# plan   = docs/specs/2026-08-11-refund-manual-reversal-plan.md(v13)§3 驗收條件 / §11-4 三個翻面 / §13 實跑 / §14 折 R1 / §15 折 R2
# 標的   = supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql
# 回退   = scripts/refund-manual-reversal-rollback.sql(§K 段每次都真的跑它)
#
# 用法:
#   scripts/refund-manual-reversal-verify.sh all <workdir>            自己 provision → 跑 → teardown
#   PORT=54431 scripts/refund-manual-reversal-verify.sh run <workdir> 叢集已在(開發用)
#
# 🔴 本檔的紀律(全部是本線踩過的坑,不是格式潔癖):
#  · **期望值一律 SQLSTATE + 物件名兩件**。本表上 23514 由五條 CHECK 共用、23505 由四個唯一索引
#    共用 ⇒ 只比碼會把「別條擋下來」當成自己的功勞。
#  · **正向格自己包 BEGIN/ROLLBACK**:`psql -c` 成功時是自動提交的。本檔第一版沒包 ⇒ 23 格全綠
#    卻真的寫進去 14 列;§F 的零留痕自檢就是為此存在,且它自己被突變證明過有牙。
#  · **複合自我 FK 與 shape CHECK 的沖銷分支被 trigger 嚴格蔭蔽**(trigger 是 BEFORE ROW、
#    先於約束檢查開火)⇒ 要量到它們自己,必須先 `DISABLE TRIGGER`。見 §C5-C7。
#  · **布林一律 `::text` + 期望 `true`/`false`**:psql -qtA 下裸 bool 印 `t`、`bool::text` 印 `true`。
#    同一支腳本混用就是觸發條件(本檔首跑 9 格因此紅;memory `reference_psql-ta-boolean-cast-renders-true-not-t`)。
#  · 行為格一律 `BEGIN … ROLLBACK`,零留痕由**構造**保證:`payment_refund_events` 是 append-only
#    (`20260810140000:183-184`),committed 的列**刪不掉**。
#
# ── 突變輪(plan §3-9;**紅格由實跑決定,不是預測**)2026-08-12 折 R1+R2 後最終版 ────
# 做法:每個靶 → 乾淨叢集 → 只改**庫內物件**(不改檔案 ⇒ SHA 閘不會誤擋)→ 跑本檔 `run`。
# ⚠️ 格名由 `sed 's/^  FAIL \([A-Z][0-9]*\).*/\1/'` 抽出,**會截掉後綴**(F2-1/F2-2/F2-3 → 都變 "F2";
#    L1a/L1b/L1c → 都變 "L1")⇒ 重複出現 = 同前綴的多個子格。
#
#   靶(改庫內物件)                              實測紅格                              PASS/84
#   M1 trigger 拿掉 G1 隔離閘                     D2 D3                                 82
#   M2 view 兜底 true→false(fail-open)          A7                                    83
#   M3 view 拿掉 jsonb_typeof 型別閘              A8                                    83
#   M4 view 不排除已被沖銷者                      E5 E6 H4 H5 J1 L2                     78
#   M5 op6a 拿掉正向存在條件的左半                J7 J8 J10                             81
#   M6 RPC 拿掉 CAS                               I5 I10 L2                             81
#   M7 trigger 整個停用                           A4 B2 C1 D1 D2 D3 F1 F2 F3 + F2 兩格  73
#   M8 DROP pre_one_reversal_uniq                 A3 A16 C2 F1 F2 + F2 兩格             77
#   M9 trigger 拿掉父列 FOR NO KEY UPDATE         L1(兩子格)                           82
#   M10 GRANT EXECUTE op6a TO PUBLIC              A14                                   83
#   M11 DROP 一條**既有** CHECK                   A15                                   83
#   M12 清掉 op6a 的 COMMENT                      A12                                   83
#   M13 op6a RESET search_path                    A13                                   83
#
# 算術自洽:十三靶皆滿足 `84 − FAIL = PASS`(逐行機械核過)。
#
# 🔴 十三個靶**逐靶紅格欄皆非空** ⇒ 沒有一道守門是恆真的。五條要誠實講清楚:
#  · **M9 是 R1 must-fix #2 的直接產物**:拿掉承重的父列鎖後**只有 L1 紅**,其餘 82 格照樣綠
#    ⇒ 折 R1 之前,這個失效形狀在全鏈零訊號。
#  · **M10-M13 是 R2 nit F 的直接產物**:⑩ 那四道斷言只在 apply 當下跑一次、事後無法重觸發,
#    所以在 §A 放了等價格(A12-A16)。四靶各自精準打紅一格 ⇒ 五道新格全部有牙
#    (A16 由 M8 打紅)。
#  · **M2 與 M3 只紅在定義層(A7/A8),行為層零紅** —— 2c 的 verdict CHECK 讓那條路徑不可達、
#    沒有行為可測。它們擋的是「有人順手改掉方向」的**編輯**,**不是**「fail-open 已被執行面擋住」。
#  · M7/M8 連帶紅 F1/F2 是**副作用不是判別力**:守門沒了之後,本來預期被擋的 INSERT 真的寫進去。
#    判別力來自 B2/C2/D1 那幾格。
#  · 🔴 **M7 那一輪要打折看**:§F2 的構造段結尾有 `ENABLE TRIGGER` ⇒ 它會把 M7(trigger 整個停用)
#    這個突變**修好**。M7 那輪的 §G-§L 其實跑在 trigger 已還原的庫上 ⇒「PASS=73」**不代表**
#    那 73 格對 trigger 不敏感。M7 的紅格清單本身是量到的,結論不受影響,但別把 PASS 欄讀成覆蓋率。
#
# 🔴 **操作紀律(踩過)**:突變輪跑動期間**不得編輯被 SHA 釘住的檔** ——
#    2026-08-12 我中途改了 migration,SHA 閘讓後四靶直接 die、報表印成「紅格=[無]」。
#    若沒去看 `PASS=` 欄是空的,那會被讀成「這四道守門恆真」= **完全相反的結論**。
set -uo pipefail
export LC_ALL=C

MODE="run"
case "${1:-}" in all|run) MODE="$1"; shift ;; esac
WORK="${1:-/tmp/prmr-verify}"
PORT="${PORT:-54431}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

MIG="supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql"
ROLLBACK="scripts/refund-manual-reversal-rollback.sql"
# 順序依賴:本片在 2d 之後。🔴 端到端鏈續(本片回退 → 2d 回退跑得動)與它的突變
# (拿掉索引還原 ⇒ 2d 回退停在第一道閘)是 2026-08-12 的**一次性實測**,不在本檔內
# (本檔跑到 §K 時庫內已有沖銷列、回退必然被拒)⇒ 這裡只釘它的 SHA,量的是「它沒被改過」。
RB_2D="scripts/l5b2-2d-rollback.sql"

# 🔴 依賴檔 SHA 釘死:w7 收據只記 harness 自己的 SHA 與 migration 目錄尾碼
#    ⇒ 同尾碼下改了 migration 或 rollback 而不動本檔,帳面照樣全綠。釘在這裡才閉合。
MIG_SHA_EXPECT="3d0ef761640b8e63256bd3ad8001725c5e3c96b9"
RB_SHA_EXPECT="6c4ea4b8435141052389391071b60356f1da2a74"
RB_2D_SHA_EXPECT="c34a95e5d79048a1a14b42b4ab9e5acff8cec253"

# 🔴 量出來的,不是估的(每加/刪一格必同步改)。數法=看腳本尾端印的 `PASS=`,
#    **不要** `grep -c '^  ok'`:`all` 模式會多印一行「ok provision 完成」,那行是 echo 不經計數器。
EXPECT_TOTAL=84

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
log() { printf '\n── %s ──\n' "$1"; }
die() { echo "🔴 $*"; exit 1; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }
sqlx(){ psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" >/dev/null || die "fixture SQL 失敗:$1"; }

test -f "$MIG"      || die "找不到 $MIG(請在 repo 根目錄跑)"
test -f "$ROLLBACK" || die "找不到 $ROLLBACK"
for pair in "$MIG:$MIG_SHA_EXPECT" "$ROLLBACK:$RB_SHA_EXPECT" "$RB_2D:$RB_2D_SHA_EXPECT"; do
  _f="${pair%%:*}"; _want="${pair##*:}"; _got="$(shasum "$_f" | cut -d' ' -f1)"
  [ "$_got" = "$_want" ] || die "$_f 的 SHA=[$_got] 與本檔釘住的 [$_want] 不符 ⇒ 依賴檔改過但本檔沒同步。
   改法:確認改動是預期的,更新本檔的 *_SHA_EXPECT,然後**重跑**(不要只改常數不重跑)。"
done

if [ "$MODE" = "all" ]; then
  # 🔴 trap 裝在 provision **之前**:provision 中途失敗時叢集已起來,舊寫法此時 trap 還沒裝
  #    ⇒ 留下活叢集佔埠。teardown 失敗一律 fail-closed。
  teardown_and_verify() {
    local rc=$?
    rm -rf "${RACEDIR:-}" 2>/dev/null || true
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
  mkdir -p "$WORK"
  echo "── provision(全量 migration,含本片)──"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  echo "  ok   provision 完成(PORT=$PORT)"
fi

# ── 叢集身分閘(在對任何東西下 ALTER 之前)────────────────────────────────────
# 🔴 本腳本會 DISABLE TRIGGER、DROP 索引與約束、跑回退。PORT 指到別窗的叢集時損害是真的。
[ -f "$WORK/cluster-id" ] || die "$WORK/cluster-id 不存在 ⇒ 無法確認 PORT=$PORT 上的叢集身分,拒跑。"
LIVE_ID="$(q "SELECT system_identifier FROM pg_control_system();")"
WANT_ID="$(cat "$WORK/cluster-id")"
[ -n "$LIVE_ID" ] && [ "$LIVE_ID" = "$WANT_ID" ] \
  || die "叢集身分不符:PORT=$PORT 上是 [$LIVE_ID],期望 [$WANT_ID]。拒跑。"
ok "叢集身分閘:PORT=$PORT 確認是本 workdir provision 的那個叢集"

# ── 判定工具 ────────────────────────────────────────────────────────────────
# 期望 = SQLSTATE + 物件名 兩件
err(){ local label="$1" code="$2" name="$3" sql="$4" out rc
  out="$(psql "$URL" -qtAX -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label —— 竟然成功(期望 $code/$name)"; return; fi
  if printf '%s' "$out" | grep -q "$code" && printf '%s' "$out" | grep -q "$name"; then
    ok "$label ($code/$name)"
  else bad "$label —— 期望 $code+$name,實得: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-260)"; fi }

# 🔴 正向格自己包 BEGIN/ROLLBACK(見檔頭第二條紀律)
pass(){ local label="$1" sql="$2" out rc
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "BEGIN; $sql ROLLBACK;" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && ok "$label" || bad "$label —— 期望成功,實得: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-260)"; }

val(){ local label="$1" want="$2" sql="$3" got
  got="$(q "$3")"
  [ "$got" = "$want" ] && ok "$label = $want" || bad "$label —— 期望 [$want] 實得 [$got]"; }

# 共用 fixture:建一顆 refund 並把 id 放進 v_r(SQL 字面用 dollar-quoting,避開 shell 引號地獄)
FIX='
  INSERT INTO public.payment_refunds(attempt_id,idempotency_key,amount,currency,strong_key,lease_token)
  VALUES ((SELECT id FROM public.payment_charge_attempts LIMIT 1),
          substr(replace(gen_random_uuid()::text,$q$-$q$,$q$$q$),1,20), 100, $q$TWD$q$,
          $q$bank:$q$||gen_random_uuid()::text, 0)
  RETURNING id INTO v_r;'

BASE_EV="$(q 'SELECT count(*) FROM public.payment_refund_events;')"
BASE_RF="$(q 'SELECT count(*) FROM public.payment_refunds;')"

# ══════════════════════════════════════════════════════════════════════════
log "A 結構(獨立重量;⚠️ 判別力邊界見下)"
# 🔴 **誠實邊界(R1 nit #9)**:本段大部分格子與 migration ⑩ 是**同一組判準換寫法**
#    (`LIKE` vs `strpos`,比的是同一段 viewdef / prosrc 字串)⇒ 兩邊一起錯就一起綠,
#    這一段**沒有**消掉那個風險。真正走了不同 catalog 路徑的只有 A2(`pg_indexes` vs `to_regclass`)。
#    本段的價值是「⑩ 只在 apply 當下跑一次,本段可以事後重跑」,不是「獨立第二意見」。
val "A1 值域含 manual_reversal" true \
  "SELECT (pg_get_constraintdef(oid) LIKE '%manual_reversal%')::text FROM pg_constraint
    WHERE conrelid='public.payment_refund_events'::regclass AND conname='pre_event_type_chk';"
val "A2 pre_one_terminal_uniq 已撤" GONE \
  "SELECT COALESCE((SELECT 'STILL' FROM pg_indexes WHERE indexname='pre_one_terminal_uniq'),'GONE');"
val "A3 pre_one_reversal_uniq 是唯一索引且生效" true \
  "SELECT (i.indisunique AND i.indisvalid)::text FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.pre_one_reversal_uniq');"
val "A4 trigger 啟用且時機=ROW+BEFORE+INSERT" "O/7" \
  "SELECT t.tgenabled::text||'/'||t.tgtype::text FROM pg_trigger t
    WHERE t.tgrelid='public.payment_refund_events'::regclass AND t.tgname='pre_one_effective_terminal';"
val "A5 canonical view 是 security_invoker" true \
  "SELECT (c.reloptions @> ARRAY['security_invoker=true'])::text FROM pg_class c
    WHERE c.oid='public.payment_refund_effective_terminal'::regclass;"
val "A6 view 零直權面(owner 以外 0 筆授權)" 0 \
  "SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='payment_refund_effective_terminal' AND grantee<>'postgres';"
# 🔴 定義層斷言,不是行為斷言:`COALESCE(…, true)` 的 NULL 路徑被 2c 的 verdict CHECK 擋成不可達
#    ⇒ 行為測不到它。本格擋的是「有人順手把方向改成 fail-open」這個**編輯**,不是執行。
#    **不得**把本格說成「fail-open 已被測試擋住」(plan §11-4 逐字)。
val "A7 view 的兜底方向是 true(定義層;擋編輯不擋執行)" true \
  "SELECT (pg_get_viewdef('public.payment_refund_effective_terminal'::regclass,true)
           LIKE '%, true) AS indicates_refund%')::text;"
val "A8 view 有 jsonb_typeof 型別閘(F4)" true \
  "SELECT (pg_get_viewdef('public.payment_refund_effective_terminal'::regclass,true)
           LIKE '%jsonb_typeof%')::text;"
val "A9 op6a 已改吃 canonical view" true \
  "SELECT (p.prosrc LIKE '%payment_refund_effective_terminal%')::text FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_compute_order_settlement';"
val "A10 op6a 舊終局字面已不在" false \
  "SELECT (p.prosrc LIKE '%''result_success'',''result_failed'',''manual''%')::text FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_compute_order_settlement';"
# 🔴 §3-6 的驗收條款逐字是「零直權面(**表級 + 欄級**兩本帳)」(R1 nit #7:原本只做表級)
val "A10b view 零**欄級** ACL(attacl;`20260810140000` 明文寫漏掉欄級是回歸)" 0 \
  "SELECT count(*)::text FROM pg_attribute a
    WHERE a.attrelid='public.payment_refund_effective_terminal'::regclass AND a.attacl IS NOT NULL;"
val "A10c 三新欄零欄級 ACL" 0 \
  "SELECT count(*)::text FROM pg_attribute a
    WHERE a.attrelid='public.payment_refund_events'::regclass
      AND a.attname IN ('reverses_event_id','reversal_reason','actor') AND a.attacl IS NOT NULL;"
# 🔴 **R2 nit F**:⑩ 新增的四道斷言(op6a COMMENT / proconfig / ACL、約束與索引完整集合)
#    只在 apply 當下跑一次、事後無法重觸發 ⇒ 它們的判別力沒有被觀察過。
#    這裡放**等價檢查**:同樣的事實、可事後重跑、也進得了突變輪。
val "A12 op6a 的 COMMENT 還在(DROP+CREATE 會弄掉它)" true \
  "SELECT (obj_description('public.admin_compute_order_settlement(uuid)'::regprocedure,'pg_proc') IS NOT NULL)::text;"
val "A13 op6a 的 proconfig 逐字" 'search_path=""' \
  "SELECT array_to_string(p.proconfig,',') FROM pg_proc p
    WHERE p.oid='public.admin_compute_order_settlement(uuid)'::regprocedure;"
val "A14 op6a 只開 service_role 且不可轉授" 0 \
  "SELECT count(*)::text FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name='admin_compute_order_settlement'
      AND grantee<>'postgres' AND NOT (grantee='service_role' AND is_grantable='NO');"
val "A15 表上約束完整集合逐字(既有的一條都沒被動到)" 'payment_refund_events_pkey,payment_refund_events_refund_id_fkey,pre_actor_required_chk,pre_event_type_chk,pre_lease_token_nonneg_chk,pre_manual_needs_verdict_chk,pre_refund_id_uniq,pre_reversal_same_refund_fk,pre_reversal_shape_chk,pre_seq_positive_chk' \
  "SELECT string_agg(c.conname,',' ORDER BY c.conname) FROM pg_constraint c
    WHERE c.conrelid='public.payment_refund_events'::regclass;"
val "A16 表上索引完整集合逐字" 'payment_refund_events_pkey,pre_one_reversal_uniq,pre_one_success_uniq,pre_refund_id_uniq,pre_refund_idx,pre_refund_seq_uniq' \
  "SELECT string_agg(i.indexname,',' ORDER BY i.indexname) FROM pg_indexes i
    WHERE i.schemaname='public' AND i.tablename='payment_refund_events';"
val "A11 RPC 只開 service_role 且不可轉授" 0 \
  "SELECT count(*)::text FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name='admin_correct_refund_manual_verdict'
      AND grantee<>'postgres' AND NOT (grantee='service_role' AND is_grantable='NO');"

# ══════════════════════════════════════════════════════════════════════════
log "B 終局名額(trigger 取代索引那一層)"
pass "B1 manual(refunded=false) 寫得進去" "
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');
END \$t\$;"

err "B2 同顆 refund 第二個終局被擋" P8C04 prl_one_effective_terminal "
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
  VALUES (v_r,'result_confirmed',2,0,'{}'::jsonb);
END \$t\$;"

pass "B3 🔴 沖銷後名額釋放:manual → manual_reversal → result_confirmed" "
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_m,'填錯了','sean');
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
  VALUES (v_r,'result_confirmed',3,0,'{}'::jsonb);
END \$t\$;"

pass "B4 非終局事件不佔名額(sent/result_success 可與 manual 併存)" "
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token) VALUES (v_r,'sent',1,0);
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot) VALUES (v_r,'result_success',2,0,'{}'::jsonb);
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',3,0,'{\"refunded\":true}'::jsonb,'sean');
END \$t\$;"

log "C 沖銷列自身的約束"
err "C1 沖銷指向非 manual 被擋" P8C02 prl_reversal_target_must_be_manual "
DO \$t\$ DECLARE v_r uuid; v_s uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
  VALUES (v_r,'result_success',1,0,'{}'::jsonb) RETURNING id INTO v_s;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_s,'亂指','sean');
END \$t\$;"

err "C2 同一顆 manual 被沖銷兩次被擋" 23505 pre_one_reversal_uniq "
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_m,'第一次','sean');
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',3,0,v_m,'第二次','sean');
END \$t\$;"

err "C3 非沖銷事件卻帶 reverses_event_id 被擋" 23514 pre_reversal_shape_chk "
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token) VALUES (v_r,'sent',1,0) RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,record_snapshot,actor)
  VALUES (v_r,'manual',2,0,v_m,'{\"refunded\":false}'::jsonb,'sean');
END \$t\$;"

err "C4 manual 沒填 actor 被擋" 23514 pre_actor_required_chk "
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb);
END \$t\$;"

# 🔴 C5-C7 必須先 DISABLE TRIGGER 才有判別力(檔頭第三條紀律):
#    trigger 是 BEFORE ROW、先於約束檢查開火,P8C02 會把「跨 refund」與「沒帶 reverses_event_id」
#    都提前擋掉(實測:不停 trigger 時 C5 得到的是 P8C02 而不是 23503)⇒ 複合 FK 與 shape CHECK
#    的沖銷分支在 INSERT 路徑上被**嚴格蔭蔽**,量不到它們自己。
#    停掉 trigger 這幾格量的是「trigger 被停用/繞過時,還有沒有第二層接得住」。
err "C5 沖銷跨 refund 指別顆的 manual 被擋(複合 FK;停 trigger 才量得到)" 23503 pre_reversal_same_refund_fk "
ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_one_effective_terminal;
DO \$t\$ DECLARE v_r uuid; v_r2 uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refunds(attempt_id,idempotency_key,amount,currency,strong_key,lease_token)
  VALUES ((SELECT id FROM public.payment_charge_attempts LIMIT 1),
          substr(replace(gen_random_uuid()::text,'-',''),1,20),100,'TWD','bank:'||gen_random_uuid()::text,0)
  RETURNING id INTO v_r2;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r2,'manual_reversal',1,0,v_m,'跨顆','sean');
END \$t\$;"

err "C6 沖銷列沒帶 reverses_event_id 被擋(shape CHECK 沖銷分支;停 trigger)" 23514 pre_reversal_shape_chk "
ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_one_effective_terminal;
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',1,0,'沒指對象','sean');
END \$t\$;"

err "C7 沖銷列 reason 空白被擋(同分支的另一半)" 23514 pre_reversal_shape_chk "
ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_one_effective_terminal;
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_m,'   ','sean');
END \$t\$;"

log "D 序列化前提(隔離閘 = 這一層的必要條件,不是加分項)"
err "D1 父列不存在 ⇒ 取不到序列化點,fail-closed" P8C03 prl_parent_row_required "
DO \$t\$ BEGIN
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (gen_random_uuid(),'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');
END \$t\$;"

err "D2 🔴 REPEATABLE READ 下寫終局被擋(F1)" P8C01 prl_isolation_guard "
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');
END \$t\$;
ROLLBACK;"

err "D3 SERIALIZABLE 同樣被擋" P8C01 prl_isolation_guard "
BEGIN ISOLATION LEVEL SERIALIZABLE;
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');
END \$t\$;
ROLLBACK;"

log "E canonical view 的 indicates_refund(Q-425=B 的落點)"
vq(){ val "$1" "$2" "
BEGIN;
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'$3',1,0,$4,'sean');
  CREATE TEMP TABLE probe AS SELECT indicates_refund FROM public.payment_refund_effective_terminal WHERE refund_id=v_r;
END \$t\$;
SELECT indicates_refund::text FROM probe;
ROLLBACK;"; }
vq "E1 manual + refunded=false" false manual "'{\"refunded\":false}'::jsonb"
vq "E2 manual + refunded=true"  true  manual "'{\"refunded\":true}'::jsonb"
vq "E3 result_confirmed"        true  result_confirmed "'{}'::jsonb"
vq "E4 result_failed"           false result_failed "'{}'::jsonb"

val "E5 沖銷後 view 剩 0 列(舊 manual 退出)" 0 "
BEGIN;
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":true}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_m,'改回','sean');
  CREATE TEMP TABLE probe2 AS SELECT count(*) n FROM public.payment_refund_effective_terminal WHERE refund_id=v_r;
END \$t\$;
SELECT n::text FROM probe2;
ROLLBACK;"

val "E6 🔴 沖銷+改判 false ⇒ indicates_refund 翻成 false" false "
BEGIN;
DO \$t\$ DECLARE v_r uuid; v_m uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":true}'::jsonb,'sean') RETURNING id INTO v_m;
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
  VALUES (v_r,'manual_reversal',2,0,v_m,'其實沒退','sean');
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',3,0,'{\"refunded\":false}'::jsonb,'sean');
  CREATE TEMP TABLE probe3 AS SELECT indicates_refund FROM public.payment_refund_effective_terminal WHERE refund_id=v_r;
END \$t\$;
SELECT indicates_refund::text FROM probe3;
ROLLBACK;"

log "F 零留痕自檢(本檔自己的守門;§B-E 的正向格若漏包 ROLLBACK,這裡必紅)"
# 🔴 已用突變證明有牙:把 pass() 的 BEGIN/ROLLBACK 拿掉 ⇒ F1/F2 立刻紅(2026-08-12 實測)。
#    §G 之後開始**刻意**留下 committed fixture(op6a 要讀得到),所以本段必須排在 §G 之前。
val "F1 payment_refund_events 列數未變" "$BASE_EV" "SELECT count(*)::text FROM public.payment_refund_events;"
val "F2 payment_refunds 列數未變"       "$BASE_RF" "SELECT count(*)::text FROM public.payment_refunds;"
val "F3 trigger 仍啟用(§C5-C7 停過它)" O \
  "SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='public.payment_refund_events'::regclass AND tgname='pre_one_effective_terminal';"


# ══════════════════════════════════════════════════════════════════════════
log "F2 回退的**第二道閘**(R1 must-fix #5;🔴 必須排在任何沖銷列寫入之前)"
# 🔴 為什麼排在這裡:回退腳本的閘 ①(語意面:有 manual_reversal 就拒)會**短路**掉閘 ②。
#    §H 之後庫裡永遠有沖銷列 ⇒ 那時再跑,量到的永遠是閘 ①,閘 ② 從沒被執行過。
#    閘 ② 守的是「有人繞過 trigger 寫出兩筆 manual、但**沒有** manual_reversal」——
#    閘 ① 對這種庫放行,只有閘 ② 擋得住;它的述詞若寫錯(例如漏了 'manual'),
#    回退會一路跑到 ⑥ CREATE UNIQUE INDEX 才 23505、整片回滾。
val "F2-0 前提:此刻庫內零 manual_reversal(否則本段量到的是閘 ①、不是閘 ②)" 0 \
  "SELECT count(*)::text FROM public.payment_refund_events WHERE event_type='manual_reversal';"

# 構造:停 trigger → 同一顆 refund 兩筆 manual(**提交**)→ 零沖銷列
psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
ALTER TABLE public.payment_refund_events DISABLE TRIGGER pre_one_effective_terminal;
DO \$t\$ DECLARE v_r uuid; BEGIN $FIX
  INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
  VALUES (v_r,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean'),
         (v_r,'manual',2,0,'{\"refunded\":true}'::jsonb,'sean');
END \$t\$;
ALTER TABLE public.payment_refund_events ENABLE TRIGGER pre_one_effective_terminal;" >/dev/null \
  || die "F2 構造失敗 ⇒ 下面那格不算數"

val "F2-1 構造有效:確有一顆 refund 在述詞集合內超過一列" true \
  "SELECT (count(*)>0)::text FROM (SELECT refund_id FROM public.payment_refund_events
     WHERE event_type IN ('result_confirmed','result_failed','manual')
     GROUP BY refund_id HAVING count(*)>1) d;"
val "F2-2 trigger 已復原(構造用的 DISABLE 沒留下)" O \
  "SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='public.payment_refund_events'::regclass AND tgname='pre_one_effective_terminal';"

F2OUT="$(psql "$URL" -qtAX -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
if printf '%s' "$F2OUT" | grep -q 'P5B03' && printf '%s' "$F2OUT" | grep -q 'prmr_rollback_unbuildable'; then
  ok "F2-3 🔴 回退的第二道閘真的發火(P5B03/prmr_rollback_unbuildable)"
else bad "F2-3 —— 期望 P5B03+prmr_rollback_unbuildable,實得: $(printf '%s' "$F2OUT"|tr '\n' ' '|cut -c1-260)"; fi

# ══════════════════════════════════════════════════════════════════════════
# 🔴 以下開始**刻意 commit** fixture:op6a 是另一支交易在讀,不 commit 它看不到。
#    零留痕由 teardown 保證(整顆叢集丟掉),不是靠事後清理 —— 本表 append-only,清不掉。
log "G 訂單面 fixture(形制逐字沿用 scripts/op6a-verify.sh,不自己重寫「訂單合法形狀」)"
mk_order(){ psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
  WITH src AS (SELECT * FROM public.orders ORDER BY created_at LIMIT 1),
       si  AS (SELECT * FROM public.order_items ORDER BY id LIMIT 1),
  o AS (
    INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot,
           tier_at_checkout, payment_status, fulfillment_status, subtotal, shipping_fee,
           discount_total, total, shipping_method, invoice, shipping_method_at_checkout)
    SELECT (SELECT string_agg(substr('23456789BCDFGHJKMNPQRSTVWXYZ',(random()*26)::int + 1, 1), '')
              FROM generate_series(1,6)),
           src.customer_user_id, src.shipping_address_snapshot, src.tier_at_checkout,
           'paid'::public.payment_status, 'notOrdered', 1000, 100, 0, 1100,
           src.shipping_method, src.invoice, src.shipping_method_at_checkout
      FROM src RETURNING id
  ), ins AS (
    INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
    SELECT o.id, si.variant_sku, si.product_snapshot, 1, 1000, 1000 FROM o, si RETURNING order_id
  ) SELECT id::text FROM o;" | tail -1; }

mk_paid_card(){ local oid rec; oid=$(mk_order); rec="REC_$(uuidgen | tr -d - | cut -c1-12)"
  sqlx "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, rec_trade_id, fallback_token_hash)
        SELECT '$oid'::uuid, o.customer_user_id, 'charged', '$rec', repeat('a',64) FROM public.orders o WHERE o.id='$oid'::uuid;"
  sqlx "INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
        VALUES ('$oid'::uuid, 'card', 1100, now() - interval '1 hour', '$rec', 'payment_confirmer');"
  printf '%s' "$oid"; }

# 🔴 strong_key 用 `bank:` 不用 `rec:`:本列刻意不寫 rec_trade_id,而 backlog #403 未來要加的
#    等式條款只約束 `rec:` 那一支 ⇒ 寫 `rec:` 會讓這個 fixture 在 #403 落地當天爆(op6a-verify 同款理由)。
mk_refund_parent(){ psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.payment_refunds (attempt_id, idempotency_key, amount, currency, strong_key, lease_token)
  SELECT a.id, substr(replace(gen_random_uuid()::text,'-',''),1,20), 1100, 'TWD',
         'bank:' || replace(gen_random_uuid()::text,'-',''), 0
    FROM public.payment_charge_attempts a WHERE a.order_id='$1'::uuid LIMIT 1
  RETURNING id::text;" | tail -1; }

ev(){ psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.payment_refund_events (refund_id, event_type, seq, lease_token, record_snapshot, actor)
  VALUES ('$1'::uuid,'$2',$3,0,${4:-NULL},${5:-NULL}) RETURNING id::text;" | tail -1; }

cell(){ local got; got="$(q "SELECT public.admin_compute_order_settlement('$2'::uuid) ->> 'verdict';")"
  [ "$got" = "$3" ] && ok "$1 ⇒ $got" || bad "$1 ⇒ 得 $got,期望 $3"; }

log "H RPC 正向(§3-1)"
O1=$(mk_paid_card); R1=$(mk_refund_parent "$O1")
M1=$(ev "$R1" manual 1 "'{\"refunded\":true}'::jsonb" "'sean'")
OUT=$(q "SELECT public.admin_correct_refund_manual_verdict('$R1'::uuid,'$M1'::uuid,'sean','其實沒退成',false)::text;")
[ -n "$OUT" ] && ok "H1 RPC 呼叫成功" || bad "H1 RPC 回空"
val "H2 事件共 3 列(舊 manual + 沖銷 + 新 manual)" 3 "SELECT count(*)::text FROM payment_refund_events WHERE refund_id='$R1'::uuid;"
val "H3 舊 manual 仍在(append-only)" 1 "SELECT count(*)::text FROM payment_refund_events WHERE id='$M1'::uuid;"
val "H4 現行有效終局的 verdict = 新值" false \
  "SELECT (e.record_snapshot->>'refunded') FROM payment_refund_effective_terminal et JOIN payment_refund_events e ON e.id=et.event_id WHERE et.refund_id='$R1'::uuid;"
val "H5 view 的 indicates_refund 已翻成 false" false \
  "SELECT indicates_refund::text FROM payment_refund_effective_terminal WHERE refund_id='$R1'::uuid;"
# 🔴 lease_token 的繼承(主視窗 P-542-A 條件 1):兩列都要等於被沖那列的值,不是寫入當下的 lease
val "H6 沖銷列與新 manual 的 lease_token 都繼承自被沖列" 2 \
  "SELECT count(*)::text FROM payment_refund_events e
    WHERE e.refund_id='$R1'::uuid AND e.id<>'$M1'::uuid
      AND e.lease_token=(SELECT lease_token FROM payment_refund_events WHERE id='$M1'::uuid);"

log "I RPC 負向(§3-2..§3-5;期望 = SQLSTATE + 約束名)"
O2=$(mk_paid_card); R2=$(mk_refund_parent "$O2")
M2=$(ev "$R2" manual 1 "'{\"refunded\":true}'::jsonb" "'sean'")
RPC="SELECT public.admin_correct_refund_manual_verdict"
err "I1 actor 不存在" P2B42 pcm_prmr_actor_invalid "$RPC('$R2'::uuid,'$M2'::uuid,'nobody','理由',false);"
err "I2 actor 已停用" P2B42 pcm_prmr_actor_invalid "$RPC('$R2'::uuid,'$M2'::uuid,(SELECT id FROM staff WHERE NOT is_active LIMIT 1),'理由',false);"
err "I3 理由空白" P2B42 pcm_prmr_reason_required "$RPC('$R2'::uuid,'$M2'::uuid,'sean','   ',false);"
err "I4 新判定為 NULL" P2B42 pcm_prmr_verdict_missing "$RPC('$R2'::uuid,'$M2'::uuid,'sean','理由',NULL);"
err "I5 CAS 不符" P2B44 pcm_prmr_cas_mismatch "$RPC('$R2'::uuid,gen_random_uuid(),'sean','理由',false);"
err "I6 REPEATABLE READ 呼叫" P8C01 pcm_prmr_isolation \
  "BEGIN ISOLATION LEVEL REPEATABLE READ; $RPC('$R2'::uuid,'$M2'::uuid,'sean','理由',false); ROLLBACK;"
err "I7 refund 不存在" P8C03 pcm_prmr_parent_row_required "$RPC(gen_random_uuid(),'$M2'::uuid,'sean','理由',false);"
O3=$(mk_paid_card); R3=$(mk_refund_parent "$O3"); S3=$(ev "$R3" sent 1)
err "I8 沒有有效終局(只有 sent)⇒ 不靜默建一筆" P2B44 pcm_prmr_no_effective_terminal "$RPC('$R3'::uuid,'$S3'::uuid,'sean','理由',false);"
O4=$(mk_paid_card); R4=$(mk_refund_parent "$O4"); C4=$(ev "$R4" result_confirmed 1 "'{}'::jsonb")
err "I9 現行有效終局不是 manual" P2B44 pcm_prmr_target_not_manual "$RPC('$R4'::uuid,'$C4'::uuid,'sean','理由',false);"
val "I10 九道負向格皆零列寫入(R2 仍只有 1 列)" 1 "SELECT count(*)::text FROM payment_refund_events WHERE refund_id='$R2'::uuid;"

log "J op6a 行為翻面(plan §11-4 表 A/B/C + 左半守門)"
OB=$(mk_paid_card); cell "J0 基準:四面全空 ⇒ 可結清" "$OB" settled

# 翻面 A:被沖銷的 manual + 有效 result_failed
# 🔴 被沖那筆的 refunded **必須釘 true**(plan §11-4 逐字):釘 false 的話,沖銷即使完全失效,
#    它重新變有效後 indicates_refund 仍是 false ⇒ 照樣可結清、本格照樣綠 = 證明不了沖銷在運作。
OA=$(mk_paid_card); RA=$(mk_refund_parent "$OA")
MA=$(ev "$RA" manual 1 "'{\"refunded\":true}'::jsonb" "'sean'")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
      VALUES ('$RA'::uuid,'manual_reversal',2,0,'$MA'::uuid,'填錯','sean');"
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RA'::uuid,'result_failed',3,0,'{}'::jsonb);"
cell "J1 翻面 A:被沖銷的 manual(true)+ 有效 result_failed ⇒ 可結清" "$OA" settled

OA2=$(mk_paid_card); RA2=$(mk_refund_parent "$OA2")
MA2=$(ev "$RA2" manual 1 "'{\"refunded\":true}'::jsonb" "'sean'")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
      VALUES ('$RA2'::uuid,'manual_reversal',2,0,'$MA2'::uuid,'改判','sean');"
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
      VALUES ('$RA2'::uuid,'manual',3,0,'{\"refunded\":true}'::jsonb,'sean');"
cell "J2 翻面 A 負測:替代 manual 仍是 true ⇒ 不得翻面" "$OA2" needs_human

# 翻面 B(Q-425=B)
OB2=$(mk_paid_card); RB2=$(mk_refund_parent "$OB2")
MB2=$(ev "$RB2" manual 1 "'{\"refunded\":false}'::jsonb" "'sean'")
cell "J3 翻面 B:有效 manual + refunded=false ⇒ 可結清" "$OB2" settled
# 🔴🔴 plan §11-4 逐字:「B 的負測是本片最重要的一格」——它同時驗「沖銷真的改得了判定」
#      與「op6a 真的即時重算」。Sean 選 B 的整個安全網就是這一條回頭路。
sqlx "SELECT public.admin_correct_refund_manual_verdict('$RB2'::uuid,'$MB2'::uuid,'sean','其實有退',true);"
cell "🔴 J4 翻面 B 負測(最重要):用 RPC 改回 true ⇒ 必翻回 needs_human" "$OB2" needs_human

# 翻面 C(關卡1 R3 抓出來的第三個;方向=從保守變成自動結清,apply 檢查表要單獨列)
OC=$(mk_paid_card); RC=$(mk_refund_parent "$OC")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RC'::uuid,'result_success',1,0,'{}'::jsonb),('$RC'::uuid,'result_failed',2,0,'{}'::jsonb);"
cell "J5 翻面 C:result_success + result_failed ⇒ 可結清" "$OC" settled
OC2=$(mk_paid_card); RC2=$(mk_refund_parent "$OC2")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RC2'::uuid,'result_success',1,0,'{}'::jsonb),('$RC2'::uuid,'result_confirmed',2,0,'{}'::jsonb);"
cell "J6 翻面 C 負測:把 failed 換成 confirmed ⇒ needs_human" "$OC2" needs_human

# §11-3 左半:零有效終局**不得**被空集合除外
OZ=$(mk_paid_card); RZ=$(mk_refund_parent "$OZ"); ev "$RZ" sent 1 >/dev/null
cell "J7 只有 sent(零有效終局)⇒ 仍 needs_human" "$OZ" needs_human
OZ2=$(mk_paid_card); RZ2=$(mk_refund_parent "$OZ2")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RZ2'::uuid,'sent',1,0,NULL),('$RZ2'::uuid,'result_unknown',2,0,'{}'::jsonb);"
cell "J8 sent + result_unknown ⇒ 仍 needs_human" "$OZ2" needs_human

# 🔴 F2 點名要逐格重推的兩格:**期望值不變,但理由變了**(2d 之後 result_success 不再是終局)
#    ⇒ 它們現在測的是「新語意下仍然對」,不是「舊語意沒被動到」。
OD=$(mk_paid_card); RD=$(mk_refund_parent "$OD")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RD'::uuid,'sent',1,0,NULL),('$RD'::uuid,'result_failed',2,0,'{}'::jsonb);"
cell "J9 (對應 op6a-verify P6-2c 重推)sent+result_failed ⇒ settled" "$OD" settled
OE=$(mk_paid_card); RE=$(mk_refund_parent "$OE")
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot)
      VALUES ('$RE'::uuid,'sent',1,0,NULL),('$RE'::uuid,'result_success',2,0,'{}'::jsonb);"
cell "J10 (對應 op6a-verify P6-2d 重推)sent+result_success ⇒ needs_human" "$OE" needs_human

log "L 真並發(§3-7 兩條;R1 must-fix #2 —— 原本零覆蓋)"
# 🔴 §D 量的是隔離**前提**(RR/SERIALIZABLE 被擋),**不是序列化本身**。§3-7 逐字要求的是
#    「同時沖同一筆 ⇒ 只有一個成功」與「同時寫兩筆 terminal ⇒ 只有一個成功」,而後者
#    **只有一層**(父列鎖 + read committed + trigger 計數)—— 索引後盾已被本片 DROP。
# 編排形制逐字沿用 `scripts/w6a-unvoid-race.sh:257-284`(零 FIFO、全程有界輪詢):
#   控制端持獨佔 advisory 鎖 → 兩個 session 各自 BEGIN 後卡在 shared 鎖上 → 控制端解鎖 ⇒ 同時放行。
# 🔴 **barrier 沒成立就不是併發證據**,所以 barrier 自己也是一格。
race_two() { # $1=標籤 $2=session A 的 SQL $3=session B 的 SQL → 印 barrier 成立與否
  local lockid=4242
  psql "$URL" -qtA -X -c "SELECT pg_catalog.pg_advisory_lock($lockid);
                          SELECT pg_catalog.pg_sleep(1.2);
                          SELECT pg_catalog.pg_advisory_unlock($lockid);" >"$RACEDIR/ctl.$1" 2>&1 &
  local CTL=$!
  local i
  for i in $(seq 1 40); do
    [ "$(q "SELECT count(*)::text FROM pg_locks WHERE locktype='advisory' AND granted AND objid=$lockid")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=prmr_a psql "$URL" -qtA -X \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared($lockid); $2 COMMIT;" >"$RACEDIR/a.$1" 2>&1 &
  PGAPPNAME=prmr_b psql "$URL" -qtA -X \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared($lockid); $3 COMMIT;" >"$RACEDIR/b.$1" 2>&1 &
  local BAR=0
  for i in $(seq 1 60); do
    [ "$(q "SELECT count(*)::text FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
             WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('prmr_a','prmr_b')")" = "2" ] \
      && { BAR=1; break; }
    sleep 0.05
  done
  wait $CTL 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$BAR"
}
# 🔴 **R2 must-fix A**:這裡原本是 `trap 'rm -rf "$RD"' EXIT` —— bash 的後裝 EXIT trap
#    **取代**前裝的(實測:`trap "echo FIRST" EXIT; trap "echo SECOND" EXIT` 只印 SECOND)
#    ⇒ 它把 `:108` 那個 teardown_and_verify 整個關掉,`all` 模式跑完不會收叢集、
#    「PORT 仍有人聽 ⇒ 零留痕不成立」那道也永不執行。而 `:94-95` 逐字記載那個 trap
#    就是為了修「留下活叢集佔埠」才搬到 provision 之前的 —— 折 must-fix #2 時把它掏空了。
#    ⇒ **不裝第二個 trap**;競態暫存目錄交給既有 handler 一起收(見 teardown_and_verify)。
RACEDIR="$(mktemp -d "${TMPDIR:-/tmp}/prmr-race.XXXXXX")"

# ── L1:兩個 session 同時寫終局 ⇒ 恰一個成功 ────────────────────────────────
OL1=$(mk_paid_card); RL1=$(mk_refund_parent "$OL1")
BAR1="$(race_two t1 \
  "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor) VALUES ('$RL1'::uuid,'manual',1,0,'{\"refunded\":false}'::jsonb,'sean');" \
  "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot) VALUES ('$RL1'::uuid,'result_confirmed',2,0,'{}'::jsonb);")"
[ "$BAR1" = "1" ] && ok "L1a barrier 成立:兩個 session 都真的卡上才被放行(=真併發,不是先後執行)" \
                  || bad "L1a barrier 沒成立 ⇒ L1b 的觀察不是併發證據"
val "L1b 🔴 同時寫兩筆終局 ⇒ 有效終局恰 1 列(索引後盾已無,全靠父列鎖+計數)" 1 \
  "SELECT count(*)::text FROM public.payment_refund_effective_terminal WHERE refund_id='$RL1'::uuid;"
if grep -qE 'P8C04|ERROR' "$RACEDIR/a.t1" "$RACEDIR/b.t1" 2>/dev/null; then
  ok "L1c 落敗的那邊拿到具名拒絕(P8C04 或明確 ERROR),不是靜默成功"
else bad "L1c 兩邊都沒報錯 ⇒ 可能兩筆都寫進去了,或編排根本沒撞上"; fi

# ── L2:兩個 session 同時沖同一筆 manual ⇒ 恰一個成功 ──────────────────────
OL2=$(mk_paid_card); RL2=$(mk_refund_parent "$OL2")
ML2=$(ev "$RL2" manual 1 "'{\"refunded\":true}'::jsonb" "'sean'")
BAR2="$(race_two t2 \
  "SELECT public.admin_correct_refund_manual_verdict('$RL2'::uuid,'$ML2'::uuid,'sean','A 改',false);" \
  "SELECT public.admin_correct_refund_manual_verdict('$RL2'::uuid,'$ML2'::uuid,'staff_1','B 改',false);")"
[ "$BAR2" = "1" ] && ok "L2a barrier 成立(沖銷競態)" || bad "L2a barrier 沒成立 ⇒ L2b 不是併發證據"
val "L2b 🔴 同時沖同一筆 ⇒ 沖銷列恰 1(父列鎖 + pre_one_reversal_uniq 兩層)" 1 \
  "SELECT count(*)::text FROM public.payment_refund_events WHERE refund_id='$RL2'::uuid AND event_type='manual_reversal';"
val "L2c 有效終局仍恰 1(沒被兩次更正寫成兩筆)" 1 \
  "SELECT count(*)::text FROM public.payment_refund_effective_terminal WHERE refund_id='$RL2'::uuid;"

log "K 回退(§3-8;🔴 破壞性,排最後)"
# K1 = 永久關閉:上面 §H/§J 已寫入 committed 的 manual_reversal ⇒ 此刻必須拒退。
val "K0 前提:庫內確有 manual_reversal(否則 K1 是空集合恆真)" true \
  "SELECT (count(*)>0)::text FROM payment_refund_events WHERE event_type='manual_reversal';"
K1OUT="$(psql "$URL" -qtAX -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
if printf '%s' "$K1OUT" | grep -q 'P5B03' && printf '%s' "$K1OUT" | grep -q 'prmr_rollback_closed'; then
  ok "K1 🔴 第一筆沖銷之後回退永久關閉(P5B03/prmr_rollback_closed)"
else bad "K1 —— 期望 P5B03+prmr_rollback_closed,實得: $(printf '%s' "$K1OUT"|tr '\n' ' '|cut -c1-260)"; fi

# K2 = 物理面那道(語意面之外的第二道):就算沒有 manual_reversal 列,只要述詞集合內有重複也要拒
# 🔴 具體到 §H 那顆 refund,不用全域「有沒有重複」——§F2 也留了一顆重複的,
#    問全域會讓本格被**別的機制**滿足(memory feedback_negative-test-observation-supplied-by-another-mechanism)。
val "K2 §H 那顆 refund 自己就在述詞集合內有 2 列(沖銷造成的,不是別人的)" 2 \
  "SELECT count(*)::text FROM payment_refund_events
    WHERE refund_id='$R1'::uuid AND event_type IN ('result_confirmed','result_failed','manual');"

# K3 = 這裡直接量「回退永久關閉」的物理原因,而不是引用它:重建 2d post-image 索引 ⇒ 23505
# 🔴 **R2 must-fix B**:述詞原本是**全域**的 ⇒ §F2 為了測閘 ② 而 commit 的那顆重複 refund
#    會單獨滿足它 ⇒ 即使沖銷機制整段失效、$R1 一列重複都沒有,K3 照樣拿到 23505 = 恆真。
#    (K2 已為同一個形狀縮到 $R1,K3 沒跟上 —— 就是 R1 must-fix #6 那個「只改被點名那一處」重演。)
#    ⇒ 探針述詞加 `refund_id = $R1`,量的才是「**沖銷造成的**那顆建不起來」。
K3OUT="$(psql "$URL" -qtAX -v VERBOSITY=verbose -c "CREATE UNIQUE INDEX prmr_probe_terminal_uniq ON public.payment_refund_events (refund_id) WHERE event_type IN ('result_confirmed','result_failed','manual') AND refund_id = '$R1'::uuid;" 2>&1)"
if printf '%s' "$K3OUT" | grep -q '23505'; then
  ok "K3 重建 2d post-image 唯一索引 ⇒ 23505(回退關閉的物理原因,不是推論)"
else bad "K3 —— 期望 23505,實得: $(printf '%s' "$K3OUT"|tr '\n' ' '|cut -c1-200)"; fi
# 🔴 失敗的 CREATE INDEX 不會留下物件;仍明確確認,免得下一格在髒狀態上跑
val "K4 探針索引沒留下" GONE \
  "SELECT COALESCE((SELECT 'STILL' FROM pg_indexes WHERE indexname='prmr_probe_terminal_uniq'),'GONE');"

echo
rm -rf "${RACEDIR:-}" 2>/dev/null || true
echo "PASS=$PASS FAIL=$FAIL(EXPECT_TOTAL=$EXPECT_TOTAL)"
if [ "$PASS" != "$EXPECT_TOTAL" ]; then
  echo "🔴 格數 $PASS ≠ 釘住的 $EXPECT_TOTAL ⇒ 有格被刪掉或沒跑到(全綠也不算數)"; exit 1
fi
[ "$FAIL" = "0" ] || exit 1
