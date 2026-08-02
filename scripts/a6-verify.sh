#!/usr/bin/env bash
# A6 訂單備註寫入 RPC(admin_append_order_note)— 驗收 harness
#
# 用法:bash scripts/a6-verify.sh [<work-dir>]     預設 /tmp/a6-work
#   前置:bash scripts/d1t2-rehearsal.sh provision /tmp/a6-work
#   (provision 會從零套完全部 migrations 含本片,並 seed customers/orders fixture)
#
# 🔴 manifest 對照(plan v4 §7.1 + 關卡2 R1 折入;格 = 守門 **64**、突變 = **75**):
#   A 行為碼 14(每碼一向量) / B 正規化碼位 7 / C 順序 11(相鄰對 10 + 步12子序 1)
#   D 稽核 8(⑧一格 13 突變) / E 單列結構 **7**(關卡2 [11] 加 E⑦ RETURN 字面集合)
#   F ACL 10(⑥縱深零專屬突變;③④ 依關卡2 [3][4][5] 重定義為 owner 對齊 / FORCE RLS)
#   G 外殼 3 / H harness 自檢 3 / I RAISE 面 1
#   ⇒ 突變 **73**,推導 = 帶突變的格 60(64 − F⑥縱深 1 − H 自檢 3)各 1 = 60,
#     D⑧ 改帶 13(+12)、G① 帶 2(拿掉 + 註解化,+1) ⇒ 73;計數器實測相符。
#     🔴 v4 plan 寫的「74」是我算錯的字面(實作從來只有 71→折入後 73)⇒ plan §7.1 已更正。
#     CELL/MUT/TOTAL 三計數器在收尾釘死(關卡2 [10]);
#     增減守門先改 plan §7.1 再改本檔的三個釘數(CELL/MUT/EXPECTED_TOTAL)。
#
# 段落:§0 自我測試(含 H 區)→ fixture → §A 結構(F/E/G/H)→ §B 行為(A/B/C/D)
#       → §C 突變 74 → 還原與零留痕 → §D 誠實邊界。
# 🔴 §B 每案跑在 BEGIN…ROLLBACK 裡 ⇒ 零留痕;fixture 訂單是唯一 committed 的東西,收尾刪除並比對基準。

set -uo pipefail

WORK="${1:-/tmp/a6-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
FNSIG="public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)"
MIGFILE="supabase/migrations/20260802150000_m4b_e10_a6_admin_append_order_note.sql"
PASS=0; FAIL=0; SKIP=0; MUT=0; CELL=0
EXPECTED_TOTAL=157
EXPECTED_MUT=73
EXPECTED_CELL=64

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
# cell N:登記 N 個 manifest 格(緊鄰該格的測試呼叫;收尾釘 CELL=EXPECTED_CELL)
cell() { CELL=$((CELL+$1)); }
# skip_gate:H2 的閘做成函式,自檢與收尾共用同一份(關卡2 [13]:原本自檢測的是別的變數)
skip_gate() { [ "$1" -eq 0 ]; }

q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(marker + data_directory + db 名三重)────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }

# ── 判定原語(逐字沿用 s2-verify;mut_block 唯一一份、自檢與正式格共用)──
case_ok() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "$label"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

expect_red() {
  local label="$1" want_txt="$2" want_state="$3" sql="$4" out rc state
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label — 竟然成功了(期望被擋)"; return; fi
  state="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$sql" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  case "$out" in
    *"$want_txt"*) : ;;
    *) bad "$label — 紅了但訊息不符;實際:$(printf '%s' "$out" | head -1 | cut -c1-140)"; return ;;
  esac
  case "$state" in
    *"$want_state"*) ok "$label(紅在 $want_txt / $want_state)" ;;
    *)               bad "$label — 訊息對但 SQLSTATE 不符:期望 $want_state、實際 $state" ;;
  esac
}

mut_block() {
  cat <<MUTSQL
DO \$mut\$
DECLARE
  v_oid oid := '$FNSIG'::regprocedure;
  v_def text; v_new text; v_md5 text; v_from text; v_occ integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_def;
  v_md5  := pg_catalog.md5(v_def);
  v_from := current_setting('harness.mut_from');
  v_new  := pg_catalog.replace(v_def, v_from, current_setting('harness.mut_to'));
  IF pg_catalog.md5(v_new) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:anchor 未在函式定義中命中';
  END IF;
  v_occ := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_from, '')))
           / pg_catalog.length(v_from);
  IF v_occ <> current_setting('harness.mut_occ')::integer THEN
    RAISE EXCEPTION '突變 anchor 出現 % 次,與宣告的 % 次不符 —— 這格會變成過量/不足突變',
      v_occ, current_setting('harness.mut_occ');
  END IF;
  EXECUTE v_new;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:catalog 定義沒有改變';
  END IF;
END
\$mut\$;
MUTSQL
}

# 用法:mutate_fn <label> <mfrom> <mto> <setup> <attack> <期望出現次數>
mutate_fn() {
  local label="$1" mfrom="$2" mto="$3" setup="$4" attack="$5" want_occ="$6" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="$mfrom" -v mto="$mto" -v mocc="$want_occ" <<SQL 2>&1
BEGIN;
$setup
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
$attack
ROLLBACK;
SQL
)"
  local rc=$?
  MUT=$((MUT+1))
  if [ $rc -eq 0 ]; then ok "突變 $label ⇒ 預期觀察成立"
  else bad "突變 $label ⇒ $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

run_mut_selftest() {
  local label="$1" mfrom="$2" mto="$3" mocc="$4" want="$5" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="$mfrom" -v mto="$mto" -v mocc="$mocc" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
  case "$out" in
    *"$want"*) ok "自我測試:$label" ;;
    *) bad "$label 沒有發火 — 實際:$(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-140)" ;;
  esac
}

# 目錄突變(catalog 級,F 區):BEGIN → setup(破壞)→ DO 斷言「偏差被觀察到」→ ROLLBACK
mutate_cat() {
  local label="$1" setup="$2" assert_dev="$3" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$setup
DO \$cat\$
BEGIN
$assert_dev
END
\$cat\$;
ROLLBACK;
SQL
)"
  local rc=$?
  MUT=$((MUT+1))
  if [ $rc -eq 0 ]; then ok "突變 $label ⇒ 偏差被觀察到"
  else bad "突變 $label ⇒ $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

# ── 函式本體逐步檢查行(與 migration 逐位元組一致;pg_get_functiondef 保留原文)──
L2=$'  IF p_order_id IS NULL THEN RETURN \'INVALID_INPUT\'; END IF;'
L3=$'  IF p_note_type IS NULL OR p_note_type NOT IN (\'internal\', \'contact_log\', \'customer_notified\') THEN RETURN \'INVALID_TYPE\'; END IF;'
L4=$'  IF p_channel IS NOT NULL AND p_channel NOT IN (\'line\', \'phone\', \'email\', \'in_person\', \'other\') THEN RETURN \'INVALID_CHANNEL\'; END IF;'
L5A=$'  IF p_note_type = \'internal\' AND (p_channel IS NOT NULL OR p_occurred_at IS NOT NULL) THEN RETURN \'INTERNAL_FIELDS_FORBIDDEN\'; END IF;'
L5B=$'  IF p_note_type <> \'internal\' AND (p_channel IS NULL OR p_occurred_at IS NULL) THEN RETURN \'CONTACT_FIELDS_REQUIRED\'; END IF;'
L6=$'  IF p_occurred_at IS NOT NULL AND NOT (p_occurred_at > TIMESTAMPTZ \'2020-01-01\' AND p_occurred_at < TIMESTAMPTZ \'2100-01-01\') THEN RETURN \'OCCURRED_AT_OUT_OF_RANGE\'; END IF;'
L7=$'  IF p_occurred_at IS NOT NULL AND p_occurred_at > pg_catalog.clock_timestamp() + interval \'5 minutes\' THEN RETURN \'OCCURRED_AT_IN_FUTURE\'; END IF;'
L8=$'  IF p_body IS NULL OR pg_catalog.regexp_replace(pg_catalog.translate(p_body, v_body_zw, \'\'), \'[[:space:]]\', \'\', \'g\') = \'\' THEN RETURN \'INVALID_BODY\'; END IF;'
L9=$'  IF pg_catalog.char_length(p_body) > v_body_max THEN RETURN \'BODY_TOO_LONG\'; END IF;'
L10=$'  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND THEN RETURN \'ORDER_NOT_FOUND\'; END IF;'
L10B=$'  IF NOT FOUND THEN RETURN \'ORDER_NOT_FOUND\'; END IF;'
L11=$'  IF EXISTS (SELECT 1 FROM public.admin_audit_log al WHERE al.action = \'order_note.append\' AND al.request_id = v_req) THEN\n    IF EXISTS (SELECT 1 FROM public.admin_audit_log al JOIN public.order_notes n ON n.id::text = al.after->>\'note_id\' AND n.order_id = p_order_id WHERE al.action = \'order_note.append\' AND al.request_id = v_req AND al.after->>\'body_sha256\' = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body, \'UTF8\')), \'hex\')) THEN RETURN \'DUPLICATE_REQUEST\'; END IF;\n    RAISE EXCEPTION \'admin_append_order_note: request_id 已被使用但無對應備註或內容不符(重用或稽核遭偽造)\';\n  END IF;'
L12=$'  IF p_corrects_note_id IS NOT NULL THEN\n    PERFORM 1 FROM public.order_notes WHERE id = p_corrects_note_id AND order_id = p_order_id;\n    IF NOT FOUND THEN RETURN \'CORRECTS_NOT_FOUND\'; END IF;\n    IF EXISTS (SELECT 1 FROM public.order_notes WHERE corrects_note_id = p_corrects_note_id) THEN RETURN \'ALREADY_CORRECTED\'; END IF;\n  END IF;'
L12A=$'    IF NOT FOUND THEN RETURN \'CORRECTS_NOT_FOUND\'; END IF;'
L12B=$'    IF EXISTS (SELECT 1 FROM public.order_notes WHERE corrects_note_id = p_corrects_note_id) THEN RETURN \'ALREADY_CORRECTED\'; END IF;'
ZW1=$'  v_body_zw constant text := U&\'\\200B\' || U&\'\\200C\' || U&\'\\200D\' || U&\'\\FEFF\''
ZW2=$'    || U&\'\\2800\' || U&\'\\3164\' || U&\'\\00AD\';'
AUD=$'  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)\n  VALUES (v_actor, \'order_note.append\', \'order:\' || p_order_id::text, NULL, v_after, NULL, v_req, \'admin\');'

echo "== 0. harness 自我測試 =="
st_ok=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT FROM WHERE;" 2>&1)"; [ $? -ne 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1;" 2>&1)";        [ $? -eq 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1/0;" 2>&1)"
case "$o" in *"division by zero"*) : ;; *) st_ok=0 ;; esac
[ "$st_ok" = "1" ] && ok "自我測試:壞 SQL 判紅、好 SQL 判綠、錯誤訊息取得正確" \
  || { echo "🔴 harness 自我測試失敗 — 後面結果不可信"; exit 1; }

sqlstate_primary="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "SELECT 1/0;" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
[ "$sqlstate_primary" = "22012" ] && ok "自我測試:SQLSTATE 解析路徑可用" \
  || bad "SQLSTATE 解析失效 — 取得 [$sqlstate_primary]"

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
BEGIN;
DO $t$ BEGIN RAISE EXCEPTION '故意失敗'; END $t$;
ROLLBACK;
SQL
)"; [ $? -ne 0 ] && ok "自我測試:case_ok 的 body 內 RAISE 會被判 FAIL" \
  || bad "case_ok 抓不到 body 內的 RAISE — §B 全部結果不可信"

run_mut_selftest "突變自檢① anchor 失配會當場中止" \
  "ANCHOR_THAT_CANNOT_EXIST_9x7" "X" "1" "anchor 未在函式定義中命中"
run_mut_selftest "突變自檢② 出現次數不符會當場中止(真的 1 次、宣告 3 次)" \
  "INSERT INTO public.order_notes" "INSERT INTO public.order_notes_x" "3" "與宣告的 3 次不符"
run_mut_selftest "突變自檢③ catalog 未變會當場中止(建出複本而非替換)" \
  "FUNCTION public.admin_append_order_note(" "FUNCTION public.admin_append_order_note_selftest_clone(" "1" \
  "catalog 定義沒有改變"

echo "-- H 區自我測試(釘數閘 / 0 SKIP 閘 / fixture fail-closed 閘,先證閘會發火)--"
# H1 self-mut:總數閘的比較式要能抓到「差一」
if [ "$((1+1))" -eq "$EXPECTED_TOTAL" ]; then bad "H1 自檢:總數閘竟然放行了 2≠$EXPECTED_TOTAL"; else ok "H1 自檢:總數閘對不符值會發火(2 vs $EXPECTED_TOTAL)"; fi
# H2 self-mut:SKIP 閘 —— 自檢與收尾用**同一個** skip_gate 函式(關卡2 [13]:原本測的是別的變數)
if skip_gate 1; then bad "H2 自檢:skip_gate 竟然放行了 1"; else ok "H2 自檢:skip_gate 對非零值會發火(收尾用同一份)"; fi
skip_gate 0 && ok "H2 自檢:skip_gate 對 0 放行" || bad "H2 自檢:skip_gate 對 0 竟然發火"
# H3 self-mut:fixture 存在性檢查對不存在的 display_id 要回 0
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id='PCM-0000-FAKE'")" = "0" ] \
  && ok "H3 自檢:存在性查詢對不存在 fixture 回 0(= 檢查有判別力)" \
  || bad "H3 自檢:對不存在 fixture 竟然非 0"

echo "== fixture(committed;收尾刪除並比對基準)=="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
NOTES_N0="$(q "SELECT count(*) FROM public.order_notes")"
AUDIT_N0="$(q "SELECT count(*) FROM public.admin_audit_log")"
[ -n "$ORDERS_N0" ] && [ -n "$NOTES_N0" ] && [ -n "$AUDIT_N0" ] \
  && ok "基準已取(orders=$ORDERS_N0 notes=$NOTES_N0 audit=$AUDIT_N0)" || bad "基準取得失敗"

# 🔴 fixture 是全 harness 唯一 committed 的東西 ⇒ 掛 EXIT trap 清理(關卡2 [15]:
#    原本只有成功路徑會刪,中途死掉會殘留兩張 PCM-9998 訂單)。冪等 DELETE、失敗不吵。
cleanup_fixture() {
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id IN ('PCM-9998-0001','PCM-9998-0002')" >/dev/null 2>&1 || true
}
trap cleanup_fixture EXIT INT TERM

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_cnt integer;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'fixture 失敗:customers 為空(customer_user_id 是 NOT NULL + FK)——唯一允許阻擋本檔的前提';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.orders WHERE display_id IN ('PCM-9998-0001','PCM-9998-0002');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'fixture 失敗:合成 display_id 已存在 % 筆', v_cnt; END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9998-0001', v_cust,
          jsonb_build_object('name','A6 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'));
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9998-0002', v_cust,
          jsonb_build_object('name','A6 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'));
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 兩張零品項訂單已建(PCM-9998-0001/0002)" \
  || bad "fixture 建立失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"

# H3 正式格:fixture fail-closed(§B 全部案例的前提)
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id IN ('PCM-9998-0001','PCM-9998-0002')")" = "2" ] \
  && ok "[H3] fixture 訂單存在性 fail-closed(2/2)" \
  || { bad "[H3] fixture 不在 — §B 全部無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }

FNDEF_MD5_BEFORE="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ -n "$FNDEF_MD5_BEFORE" ] && ok "已取得函式定義 md5 基準(§C 收尾比對用)" || bad "取不到函式 md5 基準"

echo "== A. 結構與 ACL(F 區 10 格 + E 區 6 格 + G 區 3 格;獨立重查,不倚賴 migration 檔內 DO)=="
[ "$(q "SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('$FNSIG')")" = "1" ] \
  && ok "函式存在且簽章可解析" || { bad "函式不存在 — 後面全部無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }

# [F①] proacl 非 NULL 前置
[ "$(q "SELECT proacl IS NOT NULL FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[F①] proacl 非 NULL(NULL = EXECUTE TO PUBLIC 預設,整組 ACL 斷言會假綠)" || bad "[F①] proacl 為 NULL"
# [F②] owner = order_notes 表 owner
[ "$(q "SELECT (SELECT proowner FROM pg_proc WHERE oid='$FNSIG'::regprocedure) = (SELECT relowner FROM pg_class WHERE oid='public.order_notes'::regclass)")" = "t" ] \
  && ok "[F②] 函式 owner 與 order_notes 表 owner 相同(SECURITY DEFINER 真的有寫表權)" || bad "[F②] owner 不同"
# [F③](關卡2 [3][4] 重定義)fn owner 必須**就是** audit 表 owner:audit 是 zero-policy RLS 表,
#   非 owner 的表級 GRANT **穿不過 RLS**(SELECT 靜默空、INSERT 42501)⇒「權限能力」不是對的謂詞,
#   owner 對齊才是(FORCE off 時 owner 繞過 RLS)。has_table_privilege 對本機 superuser 恆 true = 零判別力。
F3_SQL="SELECT (SELECT proowner FROM pg_proc WHERE oid='$FNSIG'::regprocedure) = (SELECT relowner FROM pg_class WHERE oid='public.admin_audit_log'::regclass)"
[ "$(q "$F3_SQL")" = "t" ] && ok "[F③] 函式 owner = admin_audit_log 表 owner(zero-policy RLS 的唯一穿透姿勢)" || bad "[F③] owner 不對齊 ⇒ dedup 靜默空 + audit INSERT 42501"
# [F④](關卡2 [5])audit 側 FORCE RLS 必須關:FORCE + 零 policy 連 owner 都擋
[ "$(q "SELECT NOT relforcerowsecurity FROM pg_class WHERE oid='public.admin_audit_log'::regclass")" = "t" ] \
  && ok "[F④] admin_audit_log relforcerowsecurity=false(FORCE 會連 owner RPC 一起擋)" || bad "[F④] audit 被 FORCE RLS"
# [F⑤] 函式 ACL 攤平恰 service_role:EXECUTE:false
FN_ACL_SQL="SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE pr.oid='$FNSIG'::regprocedure AND a.grantee <> pr.proowner) x"
[ "$(q "$FN_ACL_SQL")" = "service_role:EXECUTE:false" ] \
  && ok "[F⑤] 函式 ACL 攤平恰 service_role:EXECUTE:false(含 is_grantable)" \
  || bad "[F⑤] 函式 ACL 不符 — 實為 $(q "$FN_ACL_SQL")"
# [F⑥] PUBLIC/anon/authenticated 零授權(🔴 縱深格:任何 GRANT 也會讓 F⑤ 轉紅 ⇒ 無專屬突變、紅點歸 F⑤;plan F5)
[ "$(q "SELECT count(*) FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE pr.oid='$FNSIG'::regprocedure AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))")" = "0" ] \
  && ok "[F⑥] PUBLIC/anon/authenticated 零 EXECUTE(縱深格,紅點歸 F⑤)" || bad "[F⑥] client 角色仍可 EXECUTE"
# [F⑦] order_notes 表級 ACL 恰 service_role:SELECT:false
TBL_ACL_SQL="SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.order_notes'::regclass AND a.grantee <> c.relowner) x"
[ "$(q "$TBL_ACL_SQL")" = "service_role:SELECT:false" ] \
  && ok "[F⑦] order_notes 表級 ACL 未放寬(恰 service_role:SELECT:false ⇒ 本 RPC 是唯一寫入路)" \
  || bad "[F⑦] order_notes 表級 ACL 不符 — 實為 $(q "$TBL_ACL_SQL")"
# [F⑧] 欄級 ACL = 0(relacl 攤平看不到欄級後門)
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_notes'::regclass AND NOT attisdropped AND attacl IS NOT NULL")" = "0" ] \
  && ok "[F⑧] order_notes 零欄級 ACL" || bad "[F⑧] 有欄級 ACL = 繞過 RPC 的後門"
# [F⑨] RLS on + 零 policy + FORCE off(關卡2 [5]:FORCE + 零 policy 會讓 owner RPC 第一筆 INSERT 就死)
[ "$(q "SELECT relrowsecurity FROM pg_class WHERE oid='public.order_notes'::regclass")" = "t" ] \
  && [ "$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='order_notes'")" = "0" ] \
  && [ "$(q "SELECT NOT relforcerowsecurity FROM pg_class WHERE oid='public.order_notes'::regclass")" = "t" ] \
  && ok "[F⑨] order_notes RLS on + 零 policy + FORCE off" || bad "[F⑨] RLS/policy/FORCE 狀態不符"
# [F⑩] SECDEF + search_path + 簽章逐字 + 回傳型別
[ "$(q "SELECT prosecdef FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && [ "$(q "SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "search_path=public, pg_temp" ] \
  && [ "$(q "SELECT pg_get_function_identity_arguments('$FNSIG'::regprocedure)")" = "p_order_id uuid, p_note_type text, p_body text, p_channel text, p_occurred_at timestamp with time zone, p_corrects_note_id uuid, p_actor text, p_request_id text" ] \
  && [ "$(q "SELECT prorettype::regtype::text FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "text" ] \
  && ok "[F⑩] SECURITY DEFINER + search_path=public, pg_temp + 簽章逐字 + 回傳 text" \
  || bad "[F⑩] 函式結構不符"

# E 區:單列紀律的文字層計數(承重在 D①/D⑧ 行為面;文字層擋不住所有變體 = 已知邊界)
PROSRC_SQL="SELECT prosrc FROM pg_proc WHERE oid='$FNSIG'::regprocedure"
[ "$(q "SELECT (length(prosrc) - length(replace(prosrc,'INSERT INTO public.order_notes','')))/length('INSERT INTO public.order_notes') FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "1" ] \
  && ok "[E①] 本體 INSERT INTO public.order_notes 恰 1 次出現" || bad "[E①] order_notes INSERT 次數 ≠ 1"
[ "$(q "SELECT (length(prosrc) - length(replace(prosrc,'INSERT INTO public.admin_audit_log','')))/length('INSERT INTO public.admin_audit_log') FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "1" ] \
  && ok "[E②] 本體 audit INSERT 恰 1 次出現" || bad "[E②] audit INSERT 次數 ≠ 1"
[ "$(q "SELECT substring(prosrc from 'INSERT INTO public\.order_notes.*?RETURNING') !~ '\),\s*\(' FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[E③] order_notes INSERT 零多列 VALUES" || bad "[E③] 出現多列 VALUES 形狀"
[ "$(q "SELECT substring(prosrc from 'INSERT INTO public\.order_notes.*?RETURNING') ~ 'VALUES' FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[E④] order_notes INSERT 是 VALUES 形(非 INSERT…SELECT)" || bad "[E④] 不是 VALUES 形 = 可能回多列"
[ "$(q "SELECT prosrc !~* '\mEXECUTE\M' FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[E⑤] 本體零動態 SQL(EXECUTE)" || bad "[E⑤] 出現 EXECUTE"
[ "$(q "SELECT prosrc !~* '\mLOOP\M' FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[E⑥] 本體零 LOOP" || bad "[E⑥] 出現 LOOP"
# [E⑦](關卡2 [11]):RETURN 字面集合恰等於 14 碼 —— COMMENT 包含檢查與 14 向量都擋不住第 15 出口
E7_SQL="SELECT string_agg(DISTINCT m[1], ',' ORDER BY m[1]) FROM pg_proc, regexp_matches(prosrc, 'RETURN ''([A-Z_]+)''', 'g') m WHERE oid='$FNSIG'::regprocedure"
E7_WANT="ALREADY_CORRECTED,APPENDED,BODY_TOO_LONG,CONTACT_FIELDS_REQUIRED,CORRECTS_NOT_FOUND,DUPLICATE_REQUEST,INTERNAL_FIELDS_FORBIDDEN,INVALID_BODY,INVALID_CHANNEL,INVALID_INPUT,INVALID_TYPE,OCCURRED_AT_IN_FUTURE,OCCURRED_AT_OUT_OF_RANGE,ORDER_NOT_FOUND"
[ "$(q "$E7_SQL")" = "$E7_WANT" ] \
  && ok "[E⑦] 本體 RETURN 字面集合恰 = 14 碼(無第 15 出口)" \
  || bad "[E⑦] RETURN 字面集合不符 — 實為 $(q "$E7_SQL")"
cell 7

# G 區:外殼
grep -q "^SET LOCAL lock_timeout = '5s';" "$MIGFILE" \
  && ok "[G①] migration 檔含行首 SET LOCAL lock_timeout(錨定 ^ ⇒ 註解化不算存在,關卡2 [14])" || bad "[G①] 缺 lock_timeout"
grep -q "^SET LOCAL statement_timeout = '60s';" "$MIGFILE" \
  && ok "[G②] migration 檔含行首 SET LOCAL statement_timeout" || bad "[G②] 缺 statement_timeout"
cell 10
G3_SQL="SELECT obj_description('$FNSIG'::regprocedure,'pg_proc') IS NOT NULL AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%APPENDED%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%ORDER_NOT_FOUND%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%INVALID_INPUT%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%INVALID_TYPE%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%INVALID_CHANNEL%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%CONTACT_FIELDS_REQUIRED%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%INTERNAL_FIELDS_FORBIDDEN%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%OCCURRED_AT_OUT_OF_RANGE%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%OCCURRED_AT_IN_FUTURE%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%INVALID_BODY%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%BODY_TOO_LONG%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%DUPLICATE_REQUEST%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%CORRECTS_NOT_FOUND%' AND obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%ALREADY_CORRECTED%'"
[ "$(q "$G3_SQL")" = "t" ] \
  && ok "[G③] COMMENT ON FUNCTION 存在且含 14 碼全集" || bad "[G③] COMMENT 缺碼"

cell 3
echo "== B. 行為(A 區 14 + B 區 7 + C 區 11 + D 區;每案 BEGIN…ROLLBACK)=="

case_ok "[A1+D①-⑥] APPENDED(service_role 真身分):兩表各恰 +1 + note 逐欄 + audit 逐欄(note_id/sha256/length)" '
SET LOCAL ROLE service_role;
SELECT set_config($x$a6.res$x$, public.admin_append_order_note(
  (SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
  $x$contact_log$x$, $x$  已電話聯絡客人 交期延後  $x$, $x$phone$x$,
  now() - make_interval(hours => 1), NULL, $x$harness_a6$x$, $x$  req-a1  $x$), true);
SET LOCAL ROLE NONE;
DO $t$
DECLARE v_oid uuid; v_res text; v_note public.order_notes%ROWTYPE; v_a public.admin_audit_log%ROWTYPE;
        v_nn bigint; v_na bigint;
BEGIN
  v_res := current_setting($x$a6.res$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$預期 APPENDED,實 %$x$, v_res; END IF;
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes WHERE order_id = v_oid;
  IF v_nn <> 1 THEN RAISE EXCEPTION $x$order_notes 應恰 +1,實 %$x$, v_nn; END IF;
  SELECT * INTO v_note FROM public.order_notes WHERE order_id = v_oid;
  IF v_note.body <> $x$  已電話聯絡客人 交期延後  $x$ THEN RAISE EXCEPTION $x$body 應存原文(含前後空白)$x$; END IF;
  IF v_note.author <> $x$harness_a6$x$ THEN RAISE EXCEPTION $x$author 應為剝驗後 actor,實 %$x$, v_note.author; END IF;
  IF v_note.note_type <> $x$contact_log$x$ OR v_note.channel <> $x$phone$x$ THEN RAISE EXCEPTION $x$type/channel 錯$x$; END IF;
  IF v_note.occurred_at IS DISTINCT FROM transaction_timestamp() - make_interval(hours => 1) THEN
    RAISE EXCEPTION $x$occurred_at 未逐值相符(關卡2 [8]:只驗非 NULL 擋不住改寫成 now())$x$; END IF;
  IF v_note.corrects_note_id IS NOT NULL THEN RAISE EXCEPTION $x$corrects 應為 NULL$x$; END IF;
  IF v_note.created_at <> transaction_timestamp() THEN RAISE EXCEPTION $x$created_at 非交易時鐘$x$; END IF;
  SELECT count(*) INTO v_na FROM public.admin_audit_log WHERE request_id = $x$req-a1$x$;
  IF v_na <> 1 THEN RAISE EXCEPTION $x$audit 應恰 +1(以剝過的 request_id 取列),實 %$x$, v_na; END IF;
  SELECT * INTO v_a FROM public.admin_audit_log WHERE request_id = $x$req-a1$x$;
  IF v_a.action <> $x$order_note.append$x$ THEN RAISE EXCEPTION $x$action 錯:%$x$, v_a.action; END IF;
  IF v_a.target <> $x$order:$x$ || v_oid::text THEN RAISE EXCEPTION $x$target 錯:%$x$, v_a.target; END IF;
  IF v_a.actor <> $x$harness_a6$x$ OR v_a.source_app <> $x$admin$x$ THEN RAISE EXCEPTION $x$actor/source_app 錯$x$; END IF;
  IF v_a.before IS NOT NULL THEN RAISE EXCEPTION $x$before 應為 NULL$x$; END IF;
  IF (v_a.after->>$x$note_id$x$)::uuid <> v_note.id THEN RAISE EXCEPTION $x$after.note_id 未指向新列$x$; END IF;
  IF v_a.after->>$x$body_sha256$x$ <> encode(sha256(convert_to(v_note.body, $x$UTF8$x$)), $x$hex$x$) THEN
    RAISE EXCEPTION $x$after.body_sha256 與 body 不符$x$; END IF;
  IF (v_a.after->>$x$body_length$x$)::integer <> char_length(v_note.body) THEN RAISE EXCEPTION $x$after.body_length 錯$x$; END IF;
  IF v_a.after->>$x$note_type$x$ <> $x$contact_log$x$ OR v_a.after->>$x$channel$x$ <> $x$phone$x$ THEN
    RAISE EXCEPTION $x$after.note_type/channel 錯$x$; END IF;
  IF (v_a.after->>$x$occurred_at$x$)::timestamptz IS DISTINCT FROM v_note.occurred_at THEN
    RAISE EXCEPTION $x$after.occurred_at 與 note 不符(關卡2 [8])$x$; END IF;
  IF NOT (v_a.after ? $x$corrects_note_id$x$) OR v_a.after->>$x$corrects_note_id$x$ IS NOT NULL THEN
    RAISE EXCEPTION $x$after.corrects_note_id 鍵缺失或值錯(關卡2 [8])$x$; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_a.after)) <> 7 THEN
    RAISE EXCEPTION $x$after 鍵集合應恰 7 鍵(note_id/note_type/channel/occurred_at/corrects_note_id/body_sha256/body_length),實 % 鍵(關卡2 [9])$x$,
      (SELECT count(*) FROM jsonb_object_keys(v_a.after)); END IF;
  IF v_a.after ? $x$body$x$ OR v_a.after::text LIKE $x$%已電話聯絡客人%$x$ THEN
    RAISE EXCEPTION $x$body 全文洩進稽核 = 違反 PII 最小化宣稱(關卡2 [9])$x$; END IF;
  IF v_a.reason IS NOT NULL THEN RAISE EXCEPTION $x$reason 應為 NULL(A6 無備註參數)$x$; END IF;
END $t$;'

case_ok "[A2] ORDER_NOT_FOUND(隨機 uuid)+ 兩表恰 +0(D⑧)" '
DO $t$
DECLARE v_res text; v_nn bigint; v_na bigint;
BEGIN
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(gen_random_uuid(), $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a2$x$);
  IF v_res <> $x$ORDER_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$預期 ORDER_NOT_FOUND,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A3] INVALID_INPUT(order_id NULL)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_nn bigint; v_na bigint;
BEGIN
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(NULL, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a3$x$);
  IF v_res <> $x$INVALID_INPUT$x$ THEN RAISE EXCEPTION $x$預期 INVALID_INPUT,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A4] INVALID_TYPE(NULL 與界外值兩向量)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$bogus$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a4$x$);
  IF v_res <> $x$INVALID_TYPE$x$ THEN RAISE EXCEPTION $x$界外值預期 INVALID_TYPE,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, NULL, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a4b$x$);
  IF v_res <> $x$INVALID_TYPE$x$ THEN RAISE EXCEPTION $x$NULL 預期 INVALID_TYPE,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A5] INVALID_CHANNEL(fax)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$x$x$, $x$fax$x$, now(), NULL, $x$harness_a6$x$, $x$req-a5$x$);
  IF v_res <> $x$INVALID_CHANNEL$x$ THEN RAISE EXCEPTION $x$預期 INVALID_CHANNEL,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A6c] CONTACT_FIELDS_REQUIRED(缺 channel / 缺 occurred_at 兩向量;plan 7.2-3 四向的後兩向)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$x$x$, NULL, now(), NULL, $x$harness_a6$x$, $x$req-a6a$x$);
  IF v_res <> $x$CONTACT_FIELDS_REQUIRED$x$ THEN RAISE EXCEPTION $x$缺 channel 預期 CONTACT_FIELDS_REQUIRED,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$customer_notified$x$, $x$x$x$, $x$line$x$, NULL, NULL, $x$harness_a6$x$, $x$req-a6b$x$);
  IF v_res <> $x$CONTACT_FIELDS_REQUIRED$x$ THEN RAISE EXCEPTION $x$缺 occurred 預期 CONTACT_FIELDS_REQUIRED,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A7] INTERNAL_FIELDS_FORBIDDEN(帶 channel / 帶 occurred_at 兩向量;四向的前兩向)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, $x$line$x$, NULL, NULL, $x$harness_a6$x$, $x$req-a7a$x$);
  IF v_res <> $x$INTERNAL_FIELDS_FORBIDDEN$x$ THEN RAISE EXCEPTION $x$帶 channel 預期 INTERNAL_FIELDS_FORBIDDEN,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, now(), NULL, $x$harness_a6$x$, $x$req-a7b$x$);
  IF v_res <> $x$INTERNAL_FIELDS_FORBIDDEN$x$ THEN RAISE EXCEPTION $x$帶 occurred 預期 INTERNAL_FIELDS_FORBIDDEN,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A8] OCCURRED_AT_OUT_OF_RANGE(2019 / infinity 兩向量)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$x$x$, $x$phone$x$, ($x$2019-06-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$req-a8a$x$);
  IF v_res <> $x$OCCURRED_AT_OUT_OF_RANGE$x$ THEN RAISE EXCEPTION $x$2019 預期 OUT_OF_RANGE,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$x$x$, $x$phone$x$, ($x$infinity$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$req-a8b$x$);
  IF v_res <> $x$OCCURRED_AT_OUT_OF_RANGE$x$ THEN RAISE EXCEPTION $x$infinity 預期 OUT_OF_RANGE,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A9] OCCURRED_AT_IN_FUTURE(明天拒收 + 兩表恰 +0)+ F7 寬限正向(now()+1min 放行)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$x$x$, $x$phone$x$, now() + make_interval(days => 1), NULL, $x$harness_a6$x$, $x$req-a9a$x$);
  IF v_res <> $x$OCCURRED_AT_IN_FUTURE$x$ THEN RAISE EXCEPTION $x$明天預期 IN_FUTURE,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入(關卡2 [7])$x$; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$時鐘偏移內$x$, $x$phone$x$, now() + make_interval(mins => 1), NULL, $x$harness_a6$x$, $x$req-a9b$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$now()+1min 應在 5min 寬限內放行,實 %$x$, v_res; END IF;
END $t$;'

case_ok "[A10] INVALID_BODY(NULL / 純空白 / 純 U+2800 三向量)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, NULL, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a10a$x$);
  IF v_res <> $x$INVALID_BODY$x$ THEN RAISE EXCEPTION $x$NULL 預期 INVALID_BODY,實 %$x$, v_res; END IF;
  -- 🔴 向量用 ASCII 空白(空格/tab/換行):全形空白 U+3000 的 [[:space:]] 判定隨 lc_ctype 變
  --    (本機 C locale 不含、正式站 en_US.UTF-8 含;DB CHECK 同一相依性 ⇒ 兩層一致)⇒ 不鎖進向量,見 §D。
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$   $x$ || chr(9) || chr(10), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a10b$x$);
  IF v_res <> $x$INVALID_BODY$x$ THEN RAISE EXCEPTION $x$純空白預期 INVALID_BODY,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat(chr(10240), 5), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a10c$x$);
  IF v_res <> $x$INVALID_BODY$x$ THEN RAISE EXCEPTION $x$純盲文空白預期 INVALID_BODY,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A11] BODY_TOO_LONG(4001 拒收 + 兩表恰 +0 / 4000 邊界放行;碼位計量:4000×中文字也放行)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat($x$A$x$, 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a11a$x$);
  IF v_res <> $x$BODY_TOO_LONG$x$ THEN RAISE EXCEPTION $x$4001 預期 BODY_TOO_LONG,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入(關卡2 [7])$x$; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat($x$A$x$, 4000), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a11b$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$4000 邊界應放行,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat($x$繁$x$, 4000), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a11c$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$4000 中文字應放行(碼位非 byte),實 %$x$, v_res; END IF;
END $t$;'

case_ok "[A12] DUPLICATE_REQUEST(真重送=同鍵同內容且備註活著才算成功;同鍵不同內容/偽造稽核=RAISE;兩表恰 +0)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_nn bigint; v_na bigint; v_red boolean;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$同一份內容$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a12$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$第一發預期 APPENDED,實 %$x$, v_res; END IF;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$同一份內容$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a12$x$);
  IF v_res <> $x$DUPLICATE_REQUEST$x$ THEN RAISE EXCEPTION $x$同鍵同內容預期 DUPLICATE_REQUEST,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$同一份內容$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$  req-a12  $x$);
  IF v_res <> $x$DUPLICATE_REQUEST$x$ THEN RAISE EXCEPTION $x$剝空白後同鍵預期 DUPLICATE_REQUEST,實 %$x$, v_res; END IF;
  -- 🔴 關卡2 [2]:同 request_id 但**內容不同** = request_id 被重用 ⇒ 必須 fail-loud,
  --    不得回 DUPLICATE_REQUEST 讓呼叫端把「沒寫進去的第二份內容」當成功。
  v_red := false;
  BEGIN
    v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$不同的內容$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-a12$x$);
    RAISE EXCEPTION $x$同鍵不同內容竟回 %(應 RAISE)$x$, v_res;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE $x$%request_id 已被使用%$x$ THEN RAISE; END IF;
    v_red := true;
  END;
  IF NOT v_red THEN RAISE EXCEPTION $x$同鍵不同內容沒有 fail-loud$x$; END IF;
  -- 🔴 關卡2 [1]:偽造稽核(service_role 對 audit 有 INSERT)⇒ 同鍵但無對應備註 ⇒ RAISE,
  --    不得謊報 DUPLICATE_REQUEST 讓呼叫端以為寫入成功。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, source_app)
  VALUES ($x$attacker$x$, $x$order_note.append$x$, $x$order:$x$ || v_oid::text, $x$req-fake$x$, $x$admin$x$);
  v_red := false;
  BEGIN
    v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$受害請求$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-fake$x$);
    RAISE EXCEPTION $x$偽造稽核竟回 %(應 RAISE)$x$, v_res;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE $x$%request_id 已被使用%$x$ THEN RAISE; END IF;
    v_red := true;
  END;
  IF NOT v_red THEN RAISE EXCEPTION $x$偽造稽核沒有 fail-loud$x$; END IF;
  -- 兩表恰 +0(關卡2 [7];+1 是上面 attacker 那筆手動 INSERT)
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na + 1 THEN
    RAISE EXCEPTION $x$重送/拒絕路徑竟有 RPC 寫入$x$; END IF;
END $t$;'

case_ok "[A13] CORRECTS_NOT_FOUND(不存在 / 跨單兩向量)+ 兩表恰 +0" '
DO $t$
DECLARE v_res text; v_oid uuid; v_oid2 uuid; v_note2 uuid; v_nn bigint; v_na bigint;
BEGIN
  SELECT id INTO v_oid  FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT id INTO v_oid2 FROM public.orders WHERE display_id = $x$PCM-9998-0002$x$;
  INSERT INTO public.order_notes (order_id, note_type, body, author)
  VALUES (v_oid2, $x$internal$x$, $x$B 單既有備註$x$, $x$harness_a6$x$) RETURNING id INTO v_note2;
  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$更正$x$, NULL, NULL, gen_random_uuid(), $x$harness_a6$x$, $x$req-a13a$x$);
  IF v_res <> $x$CORRECTS_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$不存在預期 CORRECTS_NOT_FOUND,實 %$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$跨單更正$x$, NULL, NULL, v_note2, $x$harness_a6$x$, $x$req-a13b$x$);
  IF v_res <> $x$CORRECTS_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$跨單預期 CORRECTS_NOT_FOUND(同碼),實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
    RAISE EXCEPTION $x$失敗碼竟有寫入$x$; END IF;
END $t$;'

case_ok "[A14] ALREADY_CORRECTED(更正鏈:首正常 / 二次被擋)+ 更正列 corrects 欄正確" '
DO $t$
DECLARE v_res text; v_oid uuid; v_n1 uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$customer_notified$x$, $x$已告知$x$, $x$line$x$, now(), NULL, $x$harness_a6$x$, $x$req-a14a$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$原始紀錄預期 APPENDED,實 %$x$, v_res; END IF;
  SELECT id INTO v_n1 FROM public.order_notes WHERE order_id = v_oid AND note_type = $x$customer_notified$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$上面那筆點錯了$x$, NULL, NULL, v_n1, $x$harness_a6$x$, $x$req-a14b$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$首次更正預期 APPENDED,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes WHERE corrects_note_id = v_n1) <> 1 THEN
    RAISE EXCEPTION $x$更正列 corrects_note_id 未指向目標$x$; END IF;
  DECLARE v_nn bigint; v_na bigint;
  BEGIN
    SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;
    v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$再更正一次$x$, NULL, NULL, v_n1, $x$harness_a6$x$, $x$req-a14c$x$);
    IF v_res <> $x$ALREADY_CORRECTED$x$ THEN RAISE EXCEPTION $x$二次更正預期 ALREADY_CORRECTED,實 %$x$, v_res; END IF;
    IF (SELECT count(*) FROM public.order_notes) <> v_nn OR (SELECT count(*) FROM public.admin_audit_log) <> v_na THEN
      RAISE EXCEPTION $x$失敗碼竟有寫入(關卡2 [7])$x$; END IF;
  END;
END $t$;'

cell 14
case_ok "[B①-⑦] 七碼位各自「僅含該碼位」⇒ INVALID_BODY(200B/200C/200D/FEFF/2800/3164/00AD)" '
DO $t$
DECLARE v_res text; v_oid uuid; v_cp integer;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  FOREACH v_cp IN ARRAY ARRAY[8203, 8204, 8205, 65279, 10240, 12644, 173] LOOP
    v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat(chr(v_cp), 3), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-b-$x$ || v_cp::text);
    IF v_res <> $x$INVALID_BODY$x$ THEN
      RAISE EXCEPTION $x$碼位 U+%(chr %)應 INVALID_BODY,實 %$x$, upper(to_hex(v_cp)), v_cp, v_res;
    END IF;
  END LOOP;
END $t$;'

cell 7
echo "-- C 區:順序合約(每格一個同時命中兩檢查的向量,斷言前碼勝)--"
case_ok "[C1] order NULL + 爛 type ⇒ INVALID_INPUT(2 先於 3)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note(NULL, $x$bogus$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c1$x$);
  IF v_res <> $x$INVALID_INPUT$x$ THEN RAISE EXCEPTION $x$預期 INVALID_INPUT,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C2] 爛 type + 爛 channel ⇒ INVALID_TYPE(3 先於 4)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$bogus$x$, $x$x$x$, $x$fax$x$, now(), NULL, $x$harness_a6$x$, $x$req-c2$x$);
  IF v_res <> $x$INVALID_TYPE$x$ THEN RAISE EXCEPTION $x$預期 INVALID_TYPE,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C3] internal + 爛 channel ⇒ INVALID_CHANNEL(4 先於 5)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$x$x$, $x$fax$x$, NULL, NULL, $x$harness_a6$x$, $x$req-c3$x$);
  IF v_res <> $x$INVALID_CHANNEL$x$ THEN RAISE EXCEPTION $x$預期 INVALID_CHANNEL,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C4] internal + 界外 occurred ⇒ INTERNAL_FIELDS_FORBIDDEN(5 先於 6)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$x$x$, NULL, ($x$2019-06-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$req-c4$x$);
  IF v_res <> $x$INTERNAL_FIELDS_FORBIDDEN$x$ THEN RAISE EXCEPTION $x$預期 INTERNAL_FIELDS_FORBIDDEN,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C5] occurred 2150(同時界外+未來)⇒ OUT_OF_RANGE(6 先於 7)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$contact_log$x$, $x$x$x$, $x$phone$x$, ($x$2150-01-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$req-c5$x$);
  IF v_res <> $x$OCCURRED_AT_OUT_OF_RANGE$x$ THEN RAISE EXCEPTION $x$預期 OUT_OF_RANGE,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C6] 未來 occurred + body NULL ⇒ IN_FUTURE(7 先於 8)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$contact_log$x$, NULL, $x$phone$x$, now() + make_interval(days => 1), NULL, $x$harness_a6$x$, $x$req-c6$x$);
  IF v_res <> $x$OCCURRED_AT_IN_FUTURE$x$ THEN RAISE EXCEPTION $x$預期 IN_FUTURE,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C7] body 4001×零寬(正規化空 且 超長)⇒ INVALID_BODY(8 先於 9)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, repeat(chr(8203), 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c7$x$);
  IF v_res <> $x$INVALID_BODY$x$ THEN RAISE EXCEPTION $x$預期 INVALID_BODY,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C8] body 4001 + 不存在的單 ⇒ BODY_TOO_LONG(9 先於 10)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note(gen_random_uuid(),
    $x$internal$x$, repeat($x$A$x$, 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c8$x$);
  IF v_res <> $x$BODY_TOO_LONG$x$ THEN RAISE EXCEPTION $x$預期 BODY_TOO_LONG,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C9] 不存在的單 + 已用過的 req ⇒ ORDER_NOT_FOUND(10 先於 11)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$先用掉這個 req$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c9$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$前置 APPENDED 失敗:%$x$, v_res; END IF;
  v_res := public.admin_append_order_note(gen_random_uuid(),
    $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c9$x$);
  IF v_res <> $x$ORDER_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$預期 ORDER_NOT_FOUND,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C10] 已用過的 req(同內容)+ 爛 corrects ⇒ DUPLICATE_REQUEST(11 先於 12;body 同值才走真重送路)" '
DO $t$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$先用掉$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-c10$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$前置 APPENDED 失敗:%$x$, v_res; END IF;
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$先用掉$x$, NULL, NULL, gen_random_uuid(), $x$harness_a6$x$, $x$req-c10$x$);
  IF v_res <> $x$DUPLICATE_REQUEST$x$ THEN RAISE EXCEPTION $x$預期 DUPLICATE_REQUEST,實 %$x$, v_res; END IF;
END $t$;'
case_ok "[C11] 跨單且已被更正 ⇒ CORRECTS_NOT_FOUND(步12 子序:同單查無先於已更正)" '
DO $t$ DECLARE v_res text; v_oid uuid; v_oid2 uuid; v_nb uuid;
BEGIN
  SELECT id INTO v_oid  FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT id INTO v_oid2 FROM public.orders WHERE display_id = $x$PCM-9998-0002$x$;
  INSERT INTO public.order_notes (order_id, note_type, body, author)
  VALUES (v_oid2, $x$internal$x$, $x$B 單原始$x$, $x$harness_a6$x$) RETURNING id INTO v_nb;
  INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
  VALUES (v_oid2, $x$internal$x$, $x$B 單更正$x$, $x$harness_a6$x$, v_nb);
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$指向 B 單已被更正的列$x$, NULL, NULL, v_nb, $x$harness_a6$x$, $x$req-c11$x$);
  IF v_res <> $x$CORRECTS_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$預期 CORRECTS_NOT_FOUND(跨單優先),實 %$x$, v_res; END IF;
END $t$;'

cell 11
echo "-- D 區行為(D⑦ audit 失敗必整筆 rollback;D①-⑥ 斷言在 A1)--"
case_ok "[D⑦] audit INSERT 被 NOT VALID CHECK 弄壞 ⇒ RPC 整筆失敗、note 不落地、audit 零列" '
ALTER TABLE public.admin_audit_log ADD CONSTRAINT a6_boom CHECK (action <> $x$order_note.append$x$) NOT VALID;
DO $t$
DECLARE v_oid uuid; v_n bigint;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT count(*) INTO v_n FROM public.order_notes WHERE order_id = v_oid;
  BEGIN
    PERFORM public.admin_append_order_note(v_oid, $x$internal$x$, $x$audit 失敗測試$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$req-d7$x$);
    RAISE EXCEPTION $x$audit 寫入失敗竟然沒讓 RPC 失敗$x$;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.order_notes WHERE order_id = v_oid) <> v_n THEN
    RAISE EXCEPTION $x$audit 失敗但 note 落地 = 稽核靜默漏筆$x$; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$req-d7$x$) THEN
    RAISE EXCEPTION $x$audit 列竟然存在$x$; END IF;
END $t$;'

cell 8
echo "-- I 區 + 步 1 完整拒收矩陣(關卡2 [12])+ client 角色拒絕(行為面)--"
expect_red "[I①] actor 非 slug(大寫)⇒ RAISE(P0001,而非 raw 23514)" "actor 非法" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,'SEAN','r')"
# 🔴 關卡2 [12]:步 1 原本只有大寫 actor 一個向量 ⇒ 刪掉 request_id NULL guard 之類的守門
#    沒有任何向量會抓(NULL 會一路走到 audit 的 raw 23502)⇒ 六個維度逐一釘住。
expect_red "[I①b] actor NULL ⇒ RAISE 缺 actor" "缺 actor" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,NULL,'r')"
expect_red "[I①c] actor 剝後空(純 NBSP)⇒ RAISE 缺 actor" "缺 actor" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,U&'\\00A0','r')"
expect_red "[I①d] actor 含控制字元 ⇒ RAISE actor 非法" "actor 非法" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,E'a\\tb','r')"
expect_red "[I①e] actor 65 字(slug 上界)⇒ RAISE actor 非法" "actor 非法" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,repeat('a',65),'r')"
expect_red "[I①f] request_id NULL ⇒ RAISE 缺 request_id(否則一路走到 audit raw 23502)" "缺 request_id" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,'harness_a6',NULL)"
expect_red "[I①g] request_id 剝後空 ⇒ RAISE 缺 request_id" "缺 request_id" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,'harness_a6','   ')"
expect_red "[I①h] request_id 超過 200 字 ⇒ RAISE request_id 非法" "request_id 非法" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,'harness_a6',repeat('D',201))"
expect_red "[I①i] request_id 含控制字元 ⇒ RAISE request_id 非法" "request_id 非法" "P0001" \
  "SELECT public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id='PCM-9998-0001'),'internal','x',NULL,NULL,NULL,'harness_a6',E'a\\nb')"
expect_red "anon 不得 EXECUTE(真 SET ROLE;F⑤ 的行為面)" "permission denied" "42501" \
  "SET LOCAL ROLE anon; SELECT public.admin_append_order_note(NULL,'internal','x',NULL,NULL,NULL,'h','r')"
expect_red "authenticated 不得 EXECUTE(真 SET ROLE)" "permission denied" "42501" \
  "SET LOCAL ROLE authenticated; SELECT public.admin_append_order_note(NULL,'internal','x',NULL,NULL,NULL,'h','r')"
expect_red "service_role 直接 INSERT order_notes 仍被擋(RPC 之外沒有第二條路)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; INSERT INTO public.order_notes(order_id,note_type,body,author) VALUES (gen_random_uuid(),'internal','x','h')"
expect_red "service_role 直接 UPDATE order_notes 仍被擋(append-only 的應用面)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; UPDATE public.order_notes SET body='改' WHERE true"
expect_red "service_role 直接 DELETE order_notes 仍被擋" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; DELETE FROM public.order_notes WHERE true"

cell 4
echo "== C. 突變證明(74 個;61 格各 1 + D⑧ 13 + F⑥ 0)=="

echo "-- A 區 14 --"
mutate_fn "[A1m] 步2 前插入無條件 RETURN APPENDED ⇒ 逐欄驗轉紅(零寫入被觀察到)" \
  "$L2" $'  RETURN \'APPENDED\';\n'"$L2" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a1$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.order_notes WHERE order_id = v_oid) THEN
    RAISE EXCEPTION $x$竟然有寫入 ⇒ 這格證不到$x$; END IF;
END $atk$;' 1

mutate_fn "[A2m] 拿掉 ORDER_NOT_FOUND ⇒ 紅在 raw 23503(order FK)" \
  "$L10B" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note(gen_random_uuid(), $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a2$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_order_id_fkey$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A3m] 拿掉 INVALID_INPUT ⇒ NULL order 降級成 ORDER_NOT_FOUND" \
  "$L2" '' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_append_order_note(NULL, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a3$x$);
  IF v_res <> $x$ORDER_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$預期降級 ORDER_NOT_FOUND,實 %$x$, v_res; END IF;
END $atk$;' 1

mutate_fn "[A4m] 拿掉 INVALID_TYPE ⇒ 紅在 raw 23514(type_check)" \
  "$L3" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$bogus$x$, $x$x$x$, $x$phone$x$, now(), NULL, $x$harness_a6$x$, $x$mut-a4$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_type_check$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A5m] 拿掉 INVALID_CHANNEL ⇒ 紅在 raw 23514(channel_check)" \
  "$L4" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$contact_log$x$, $x$x$x$, $x$fax$x$, now(), NULL, $x$harness_a6$x$, $x$mut-a5$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_channel_check$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A6m] 拿掉 CONTACT_FIELDS_REQUIRED ⇒ 紅在 raw 23514(contact_fields_required)" \
  "$L5B" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$contact_log$x$, $x$x$x$, NULL, now(), NULL, $x$harness_a6$x$, $x$mut-a6$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_contact_fields_required$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A7m] 拿掉 INTERNAL_FIELDS_FORBIDDEN ⇒ 紅在 raw 23514(internal_fields_absent)" \
  "$L5A" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$internal$x$, $x$x$x$, $x$line$x$, NULL, NULL, $x$harness_a6$x$, $x$mut-a7$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_internal_fields_absent$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A8m] 拿掉 OUT_OF_RANGE ⇒ 紅在 raw 23514(occurred_at_sane)" \
  "$L6" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$contact_log$x$, $x$x$x$, $x$phone$x$, ($x$2019-06-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$mut-a8$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_occurred_at_sane$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A9m] 拿掉 IN_FUTURE ⇒ 明天的告知時間被寫進去(錯誤成功;DB 擋不住)" \
  "$L7" '' '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$contact_log$x$, $x$未來$x$, $x$phone$x$, now() + make_interval(days => 1), NULL, $x$harness_a6$x$, $x$mut-a9$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_notes WHERE order_id = v_oid AND occurred_at > now()) THEN
    RAISE EXCEPTION $x$未來時間沒被真的寫進去$x$; END IF;
END $atk$;' 1

mutate_fn "[A10m] 拿掉 INVALID_BODY ⇒ 純 U+2800 肉眼全白備註被寫進去(錯誤成功;DB CHECK 不涵蓋)" \
  "$L8" '' '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat(chr(10240), 5), NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a10$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_notes WHERE order_id = v_oid AND body = repeat(chr(10240), 5)) THEN
    RAISE EXCEPTION $x$全白 body 沒被真的寫進去$x$; END IF;
END $atk$;' 1

mutate_fn "[A11m] 拿掉 BODY_TOO_LONG ⇒ 4001 字被寫進去(錯誤成功)" \
  "$L9" '' '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat($x$A$x$, 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a11$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF (SELECT max(char_length(body)) FROM public.order_notes WHERE order_id = v_oid) <> 4001 THEN
    RAISE EXCEPTION $x$超長 body 沒被真的寫進去$x$; END IF;
END $atk$;' 1

mutate_fn "[A12m] 拿掉 DUPLICATE_REQUEST ⇒ 同 req 重送寫出兩筆(冪等失效被觀察到)" \
  "$L11" '' '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$一$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a12$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$第一發失敗(%)$x$, v_res; END IF;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$二$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a12$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE request_id = $x$mut-a12$x$) <> 2 THEN
    RAISE EXCEPTION $x$重送沒有真的寫出兩筆稽核$x$; END IF;
END $atk$;' 1

mutate_fn "[A13m] 拿掉 CORRECTS_NOT_FOUND ⇒ 紅在 raw 23503(複合 FK corrects_same_order)" \
  "$L12A" '' '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$internal$x$, $x$x$x$, NULL, NULL, gen_random_uuid(), $x$harness_a6$x$, $x$mut-a13$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_corrects_same_order_fk$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

mutate_fn "[A14m] 拿掉 ALREADY_CORRECTED ⇒ 紅在 raw 23505(partial unique)" \
  "$L12B" '' '' '
DO $atk$
DECLARE v_res text; v_oid uuid; v_n1 uuid; v_con text;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$原始$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-a14a$x$);
  SELECT id INTO v_n1 FROM public.order_notes WHERE order_id = v_oid;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$更正一$x$, NULL, NULL, v_n1, $x$harness_a6$x$, $x$mut-a14b$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$首次更正失敗(%)$x$, v_res; END IF;
  BEGIN
    v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$更正二$x$, NULL, NULL, v_n1, $x$harness_a6$x$, $x$mut-a14c$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %$x$, v_res;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_corrects_note_id_key$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

echo "-- B 區 7(逐碼位;替換成重複碼位保持長度 7,避開 v_body_zw 自檢)--"
b_mut() {
  local label="$1" newline1="$2" newline2="$3" cp="$4" expect="$5"
  local mfrom mto
  if [ -n "$newline1" ]; then mfrom="$ZW1"; mto="$newline1"; else mfrom="$ZW2"; mto="$newline2"; fi
  if [ "$expect" = "raw" ]; then
    mutate_fn "$label" "$mfrom" "$mto" '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$internal$x$, repeat(chr('"$cp"'), 3), NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-b-'"$cp"'$x$);
    RAISE EXCEPTION $x$突變後竟回固定碼 %(應降級 raw 23514)$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_body_nonempty$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1
  else
    mutate_fn "$label" "$mfrom" "$mto" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, repeat(chr('"$cp"'), 3), NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-b-'"$cp"'$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變後應錯誤成功 APPENDED,實 %$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_notes WHERE order_id = v_oid AND body = repeat(chr('"$cp"'), 3)) THEN
    RAISE EXCEPTION $x$全白 body 沒被真的寫進去$x$; END IF;
END $atk$;' 1
  fi
}
b_mut "[B①m] 200B 移出清單 ⇒ 降級 raw 23514" \
  $'  v_body_zw constant text := U&\'\\200C\' || U&\'\\200C\' || U&\'\\200D\' || U&\'\\FEFF\'' "" 8203 raw
b_mut "[B②m] 200C 移出清單 ⇒ 降級 raw 23514" \
  $'  v_body_zw constant text := U&\'\\200B\' || U&\'\\200B\' || U&\'\\200D\' || U&\'\\FEFF\'' "" 8204 raw
b_mut "[B③m] 200D 移出清單 ⇒ 降級 raw 23514" \
  $'  v_body_zw constant text := U&\'\\200B\' || U&\'\\200C\' || U&\'\\200C\' || U&\'\\FEFF\'' "" 8205 raw
b_mut "[B④m] FEFF 移出清單 ⇒ 降級 raw 23514" \
  $'  v_body_zw constant text := U&\'\\200B\' || U&\'\\200C\' || U&\'\\200D\' || U&\'\\200B\'' "" 65279 raw
b_mut "[B⑤m] 2800 移出清單 ⇒ 錯誤成功 APPENDED(DB CHECK 不涵蓋)" \
  "" $'    || U&\'\\3164\' || U&\'\\3164\' || U&\'\\00AD\';' 10240 success
b_mut "[B⑥m] 3164 移出清單 ⇒ 錯誤成功 APPENDED" \
  "" $'    || U&\'\\2800\' || U&\'\\2800\' || U&\'\\00AD\';' 12644 success
b_mut "[B⑦m] 00AD 移出清單 ⇒ 錯誤成功 APPENDED" \
  "" $'    || U&\'\\2800\' || U&\'\\3164\' || U&\'\\3164\';' 173 success

echo "-- C 區 11(交換相鄰檢查 ⇒ 同一向量改回後碼)--"
mutate_fn "[C1m] 交換步 2/3 ⇒ 向量改回 INVALID_TYPE" \
  "$L2"$'\n'"$L3" "$L3"$'\n'"$L2" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note(NULL, $x$bogus$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mc1$x$);
  IF v_res <> $x$INVALID_TYPE$x$ THEN RAISE EXCEPTION $x$交換後應 INVALID_TYPE,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C2m] 交換步 3/4 ⇒ 向量改回 INVALID_CHANNEL" \
  "$L3"$'\n'"$L4" "$L4"$'\n'"$L3" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$bogus$x$, $x$x$x$, $x$fax$x$, now(), NULL, $x$harness_a6$x$, $x$mc2$x$);
  IF v_res <> $x$INVALID_CHANNEL$x$ THEN RAISE EXCEPTION $x$交換後應 INVALID_CHANNEL,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C3m] 交換步 4/5 ⇒ 向量改回 INTERNAL_FIELDS_FORBIDDEN" \
  "$L4"$'\n'"$L5A" "$L5A"$'\n'"$L4" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$x$x$, $x$fax$x$, NULL, NULL, $x$harness_a6$x$, $x$mc3$x$);
  IF v_res <> $x$INTERNAL_FIELDS_FORBIDDEN$x$ THEN RAISE EXCEPTION $x$交換後應 INTERNAL_FIELDS_FORBIDDEN,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C4m] 交換步 5/6(步 5 = L5A+L5B 整塊搬,只搬半塊會被 L5A 先攔 —— 首跑實測踩到)⇒ 向量改回 OUT_OF_RANGE" \
  "$L5A"$'\n'"$L5B"$'\n'"$L6" "$L6"$'\n'"$L5A"$'\n'"$L5B" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$x$x$, NULL, ($x$2019-06-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$mc4$x$);
  IF v_res <> $x$OCCURRED_AT_OUT_OF_RANGE$x$ THEN RAISE EXCEPTION $x$交換後應 OUT_OF_RANGE,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C5m] 交換步 6/7 ⇒ 2150 向量改回 IN_FUTURE" \
  "$L6"$'\n'"$L7" "$L7"$'\n'"$L6" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$contact_log$x$, $x$x$x$, $x$phone$x$, ($x$2150-01-01$x$)::timestamptz, NULL, $x$harness_a6$x$, $x$mc5$x$);
  IF v_res <> $x$OCCURRED_AT_IN_FUTURE$x$ THEN RAISE EXCEPTION $x$交換後應 IN_FUTURE,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C6m] 交換步 7/8 ⇒ 向量改回 INVALID_BODY" \
  "$L7"$'\n'"$L8" "$L8"$'\n'"$L7" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$contact_log$x$, NULL, $x$phone$x$, now() + make_interval(days => 1), NULL, $x$harness_a6$x$, $x$mc6$x$);
  IF v_res <> $x$INVALID_BODY$x$ THEN RAISE EXCEPTION $x$交換後應 INVALID_BODY,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C7m] 交換步 8/9 ⇒ 4001×零寬向量改回 BODY_TOO_LONG" \
  "$L8"$'\n'"$L9" "$L9"$'\n'"$L8" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, repeat(chr(8203), 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$mc7$x$);
  IF v_res <> $x$BODY_TOO_LONG$x$ THEN RAISE EXCEPTION $x$交換後應 BODY_TOO_LONG,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C8m] 交換步 9/10 ⇒ 向量改回 ORDER_NOT_FOUND" \
  "$L9"$'\n'"$L10" "$L10"$'\n'"$L9" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note(gen_random_uuid(),
    $x$internal$x$, repeat($x$A$x$, 4001), NULL, NULL, NULL, $x$harness_a6$x$, $x$mc8$x$);
  IF v_res <> $x$ORDER_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$交換後應 ORDER_NOT_FOUND,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C9m] 交換步 10/11 ⇒ 向量改走步 11(此向量的備註不在該隨機單上 ⇒ 紅在步 11 的 RAISE 而非 ORDER_NOT_FOUND)" \
  "$L10"$'\n'"$L11" "$L11"$'\n'"$L10" '' '
DO $atk$ DECLARE v_res text; v_red boolean := false; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$先用掉$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mc9$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$前置失敗(%)$x$, v_res; END IF;
  BEGIN
    v_res := public.admin_append_order_note(gen_random_uuid(),
      $x$internal$x$, $x$先用掉$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mc9$x$);
    RAISE EXCEPTION $x$交換後竟回 %(應紅在步 11 RAISE)$x$, v_res;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE $x$%request_id 已被使用%$x$ THEN RAISE; END IF;
    v_red := true;
  END;
  IF NOT v_red THEN RAISE EXCEPTION $x$交換沒有被觀察到$x$; END IF;
END $atk$;' 1
mutate_fn "[C10m] 交換步 11/12 ⇒ 向量改回 CORRECTS_NOT_FOUND" \
  "$L11"$'\n'"$L12" "$L12"$'\n'"$L11" '' '
DO $atk$ DECLARE v_res text; BEGIN
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$先用掉$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mc10$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$前置失敗(%)$x$, v_res; END IF;
  v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
    $x$internal$x$, $x$x$x$, NULL, NULL, gen_random_uuid(), $x$harness_a6$x$, $x$mc10$x$);
  IF v_res <> $x$CORRECTS_NOT_FOUND$x$ THEN RAISE EXCEPTION $x$交換後應 CORRECTS_NOT_FOUND,實 %$x$, v_res; END IF;
END $atk$;' 1
mutate_fn "[C11m] 交換步12 內兩檢查 ⇒ 跨單已更正向量改回 ALREADY_CORRECTED" \
  "$L12A"$'\n'"$L12B" "$L12B"$'\n'"$L12A" '' '
DO $atk$ DECLARE v_res text; v_oid uuid; v_oid2 uuid; v_nb uuid; BEGIN
  SELECT id INTO v_oid  FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  SELECT id INTO v_oid2 FROM public.orders WHERE display_id = $x$PCM-9998-0002$x$;
  INSERT INTO public.order_notes (order_id, note_type, body, author)
  VALUES (v_oid2, $x$internal$x$, $x$B 原始$x$, $x$harness_a6$x$) RETURNING id INTO v_nb;
  INSERT INTO public.order_notes (order_id, note_type, body, author, corrects_note_id)
  VALUES (v_oid2, $x$internal$x$, $x$B 更正$x$, $x$harness_a6$x$, v_nb);
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, v_nb, $x$harness_a6$x$, $x$mc11$x$);
  IF v_res <> $x$ALREADY_CORRECTED$x$ THEN RAISE EXCEPTION $x$交換後應 ALREADY_CORRECTED,實 %$x$, v_res; END IF;
END $atk$;' 1

echo "-- D 區 7 + 13 --"
mutate_fn "[D①m] audit INSERT 導去 sink ⇒ audit 恰 +1 斷言轉紅" \
  'INSERT INTO public.admin_audit_log' 'INSERT INTO public.a6_audit_sink' \
  'CREATE TABLE public.a6_audit_sink (LIKE public.admin_audit_log INCLUDING DEFAULTS);' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d1$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$mut-d1$x$) THEN
    RAISE EXCEPTION $x$audit 仍寫進正表 ⇒ 突變沒生效$x$; END IF;
  IF (SELECT count(*) FROM public.a6_audit_sink) <> 1 THEN RAISE EXCEPTION $x$sink 沒收到$x$; END IF;
END $atk$;' 1
mutate_fn "[D②m] action 寫錯值 ⇒ action 斷言轉紅" \
  "VALUES (v_actor, 'order_note.append'," "VALUES (v_actor, 'order_note.bogus'," '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d2$x$);
  IF (SELECT action FROM public.admin_audit_log WHERE request_id = $x$mut-d2$x$) = $x$order_note.append$x$ THEN
    RAISE EXCEPTION $x$action 仍正確 ⇒ 突變沒生效$x$; END IF;
END $atk$;' 1
mutate_fn "[D③m] target 前綴寫錯 ⇒ target 斷言轉紅" \
  "'order:' || p_order_id::text" "'ordr:' || p_order_id::text" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d3$x$);
  IF (SELECT target FROM public.admin_audit_log WHERE request_id = $x$mut-d3$x$) = $x$order:$x$ || v_oid::text THEN
    RAISE EXCEPTION $x$target 仍正確 ⇒ 突變沒生效$x$; END IF;
END $atk$;' 1
mutate_fn "[D④m] after 掉 body_sha256 鍵 ⇒ after 斷言轉紅" \
  "'body_sha256', pg_catalog.encode" "'body_sha256_x', pg_catalog.encode" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d4$x$);
  IF (SELECT after ? $x$body_sha256$x$ FROM public.admin_audit_log WHERE request_id = $x$mut-d4$x$) THEN
    RAISE EXCEPTION $x$after 仍含 body_sha256 ⇒ 突變沒生效$x$; END IF;
END $atk$;' 1
mutate_fn "[D⑤m] request_id 寫原值不剝 ⇒ 剝後取列斷言轉紅" \
  ", NULL, v_req, 'admin');" ", NULL, p_request_id, 'admin');" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$  mut-d5  $x$);
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$mut-d5$x$) THEN
    RAISE EXCEPTION $x$request_id 仍是剝過的 ⇒ 突變沒生效$x$; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$  mut-d5  $x$) THEN
    RAISE EXCEPTION $x$未剝的 request_id 沒被寫進去$x$; END IF;
END $atk$;' 1
mutate_fn "[D⑥m] source_app 寫成 quote ⇒ source_app 斷言轉紅" \
  "v_req, 'admin');" "v_req, 'quote');" '' '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d6$x$);
  IF (SELECT source_app FROM public.admin_audit_log WHERE request_id = $x$mut-d6$x$) = $x$admin$x$ THEN
    RAISE EXCEPTION $x$source_app 仍為 admin ⇒ 突變沒生效$x$; END IF;
END $atk$;' 1
mutate_fn "[D⑦m] audit INSERT 包 EXCEPTION 吞掉 ⇒ note 落地+audit 缺筆+仍回 APPENDED(D⑦ 測試的紅點)" \
  "$AUD" $'  BEGIN\n'"$AUD"$'\n  EXCEPTION WHEN OTHERS THEN NULL; END;' \
  "ALTER TABLE public.admin_audit_log ADD CONSTRAINT a6_boom CHECK (action <> 'order_note.append') NOT VALID;" '
DO $atk$
DECLARE v_res text; v_oid uuid;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;
  v_res := public.admin_append_order_note(v_oid, $x$internal$x$, $x$吞掉測試$x$, NULL, NULL, NULL, $x$harness_a6$x$, $x$mut-d7$x$);
  IF v_res <> $x$APPENDED$x$ THEN RAISE EXCEPTION $x$突變沒生效(%)$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_notes WHERE order_id = v_oid) THEN
    RAISE EXCEPTION $x$note 沒落地$x$; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$mut-d7$x$) THEN
    RAISE EXCEPTION $x$audit 竟然在$x$; END IF;
END $atk$;' 1

# D⑧(關卡2 R1 [6] 重做):突變 = 該失敗路 RETURN 前洩漏寫入 —— 有合法單的 11 碼**兩表各洩一筆**、
#   order 無效的 2 碼(INVALID_INPUT / ORDER_NOT_FOUND)只洩 audit(note 洩漏會自炸在 NOT NULL/FK)。
#   攻擊 = **重跑該碼原行為斷言的謂詞**(呼叫前後兩表 delta)並要求它轉紅(delta ≠ 0),
#   不是另寫一個「洩漏列存在」的旁證 ⇒「恰 +0」斷言的判別力由此成立。
d8_mut() {
  local code="$1" flavor="$2" vector="$3" leak
  if [ "$flavor" = "full" ]; then
    leak="INSERT INTO public.order_notes (order_id, note_type, body, author) VALUES (p_order_id, 'internal', 'leak', 'mutant'); INSERT INTO public.admin_audit_log (actor, action, request_id, source_app) VALUES ('mutant', 'order_note.leak', 'mut-leak-$code', 'admin'); RETURN '$code';"
  else
    leak="INSERT INTO public.admin_audit_log (actor, action, request_id, source_app) VALUES ('mutant', 'order_note.leak', 'mut-leak-$code', 'admin'); RETURN '$code';"
  fi
  mutate_fn "[D⑧m-$code] 失敗路洩漏寫入($flavor)⇒ 原「兩表恰 +0」謂詞轉紅" \
    "RETURN '$code';" "$leak" '' "$vector" 1
}
# 攻擊模板:D8V <code> <expect_note_delta> <call-SQL(把結果放 v_res;可自帶 setup)>
d8v_head='
DO $atk$ DECLARE v_res text; v_nn bigint; v_na bigint; v_oid uuid; v_n1 uuid; BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$;'
d8v_tail() { cat <<EOT
  IF v_res <> \$x\$$1\$x\$ THEN RAISE EXCEPTION \$x\$碼變了:%\$x\$, v_res; END IF;
  IF (SELECT count(*) FROM public.order_notes) - v_nn <> $2
     OR (SELECT count(*) FROM public.admin_audit_log) - v_na <> 1 THEN
    RAISE EXCEPTION \$x\$洩漏沒讓「恰 +0」謂詞轉紅 ⇒ 這格證不到\$x\$; END IF;
END \$atk\$;
EOT
}
CNT='  SELECT count(*) INTO v_nn FROM public.order_notes; SELECT count(*) INTO v_na FROM public.admin_audit_log;'

d8_mut "ORDER_NOT_FOUND" audit "$d8v_head
$CNT
  v_res := public.admin_append_order_note(gen_random_uuid(), \$x\$internal\$x\$, \$x\$x\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail ORDER_NOT_FOUND 0)"
d8_mut "INVALID_INPUT" audit "$d8v_head
$CNT
  v_res := public.admin_append_order_note(NULL, \$x\$internal\$x\$, \$x\$x\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail INVALID_INPUT 0)"
d8_mut "INVALID_TYPE" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$bogus\$x\$, \$x\$x\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail INVALID_TYPE 1)"
d8_mut "INVALID_CHANNEL" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$contact_log\$x\$, \$x\$x\$x\$, \$x\$fax\$x\$, now(), NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail INVALID_CHANNEL 1)"
d8_mut "CONTACT_FIELDS_REQUIRED" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$contact_log\$x\$, \$x\$x\$x\$, NULL, now(), NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail CONTACT_FIELDS_REQUIRED 1)"
d8_mut "INTERNAL_FIELDS_FORBIDDEN" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$x\$x\$, \$x\$line\$x\$, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail INTERNAL_FIELDS_FORBIDDEN 1)"
d8_mut "OCCURRED_AT_OUT_OF_RANGE" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$contact_log\$x\$, \$x\$x\$x\$, \$x\$phone\$x\$, (\$x\$2019-06-01\$x\$)::timestamptz, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail OCCURRED_AT_OUT_OF_RANGE 1)"
d8_mut "OCCURRED_AT_IN_FUTURE" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$contact_log\$x\$, \$x\$x\$x\$, \$x\$phone\$x\$, now() + make_interval(days => 1), NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail OCCURRED_AT_IN_FUTURE 1)"
d8_mut "INVALID_BODY" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, NULL, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail INVALID_BODY 1)"
d8_mut "BODY_TOO_LONG" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, repeat(\$x\$A\$x\$, 4001), NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail BODY_TOO_LONG 1)"
d8_mut "DUPLICATE_REQUEST" full "$d8v_head
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$同一份\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$同一份\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail DUPLICATE_REQUEST 1)"
d8_mut "CORRECTS_NOT_FOUND" full "$d8v_head
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$x\$x\$, NULL, NULL, gen_random_uuid(), \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail CORRECTS_NOT_FOUND 1)"
d8_mut "ALREADY_CORRECTED" full "$d8v_head
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$原始\$x\$, NULL, NULL, NULL, \$x\$harness_a6\$x\$, \$x\$d8a\$x\$);
  SELECT id INTO v_n1 FROM public.order_notes WHERE order_id = v_oid;
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$更正\$x\$, NULL, NULL, v_n1, \$x\$harness_a6\$x\$, \$x\$d8b\$x\$);
$CNT
  v_res := public.admin_append_order_note(v_oid, \$x\$internal\$x\$, \$x\$再更正\$x\$, NULL, NULL, v_n1, \$x\$harness_a6\$x\$, \$x\$d8\$x\$);
$(d8v_tail ALREADY_CORRECTED 1)"

echo "-- E 區 6(違反單列紀律 ⇒ 文字層計數/形狀斷言轉紅)--"
mutate_fn "[E①m] 加第二句 order_notes INSERT ⇒ 計數 2 被抓到" \
  "RETURN 'APPENDED';" "INSERT INTO public.order_notes (order_id, note_type, body, author) VALUES (p_order_id, 'internal', 'dup', v_actor); RETURN 'APPENDED';" '' '
DO $atk$ BEGIN
  IF (SELECT (length(prosrc) - length(replace(prosrc, $x$INSERT INTO public.order_notes$x$, $x$$x$)))/length($x$INSERT INTO public.order_notes$x$)
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) <> 2 THEN
    RAISE EXCEPTION $x$計數竟然不是 2 ⇒ E① 抓不到$x$; END IF;
END $atk$;' 1
mutate_fn "[E②m] 加第二句 audit INSERT ⇒ 計數 2 被抓到" \
  "RETURN 'APPENDED';" "INSERT INTO public.admin_audit_log (actor, action, request_id, source_app) VALUES (v_actor, 'order_note.dup', v_req, 'admin'); RETURN 'APPENDED';" '' '
DO $atk$ BEGIN
  IF (SELECT (length(prosrc) - length(replace(prosrc, $x$INSERT INTO public.admin_audit_log$x$, $x$$x$)))/length($x$INSERT INTO public.admin_audit_log$x$)
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) <> 2 THEN
    RAISE EXCEPTION $x$計數竟然不是 2 ⇒ E② 抓不到$x$; END IF;
END $atk$;' 1
mutate_fn "[E③m] VALUES 改多列 ⇒ 多列形狀被抓到" \
  "VALUES (p_order_id, p_note_type, p_body, p_channel, p_occurred_at, v_actor, p_corrects_note_id)" \
  "VALUES (p_order_id, p_note_type, p_body, p_channel, p_occurred_at, v_actor, p_corrects_note_id), (p_order_id, 'internal', 'dup', NULL, NULL, v_actor, NULL)" '' '
DO $atk$ BEGIN
  IF (SELECT substring(prosrc from $x$INSERT INTO public\.order_notes.*?RETURNING$x$) !~ $x$\),\s*\($x$
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) THEN
    RAISE EXCEPTION $x$多列形狀竟然沒被抓到 ⇒ E③ 無判別力$x$; END IF;
END $atk$;' 1
mutate_fn "[E④m] VALUES 形改 INSERT…SELECT ⇒ 形狀斷言轉紅" \
  "VALUES (p_order_id, p_note_type, p_body, p_channel, p_occurred_at, v_actor, p_corrects_note_id)" \
  "SELECT p_order_id, p_note_type, p_body, p_channel, p_occurred_at, v_actor, p_corrects_note_id" '' '
DO $atk$ BEGIN
  IF (SELECT substring(prosrc from $x$INSERT INTO public\.order_notes.*?RETURNING$x$) ~ $x$VALUES$x$
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) THEN
    RAISE EXCEPTION $x$SELECT 形竟然仍含 VALUES ⇒ E④ 無判別力$x$; END IF;
END $atk$;' 1
mutate_fn "[E⑤m] 加動態 SQL ⇒ EXECUTE 斷言轉紅" \
  "$L2" $'  EXECUTE \'SELECT 1\';\n'"$L2" '' '
DO $atk$ BEGIN
  IF (SELECT prosrc !~* $x$\mEXECUTE\M$x$
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) THEN
    RAISE EXCEPTION $x$EXECUTE 竟然沒被抓到 ⇒ E⑤ 無判別力$x$; END IF;
END $atk$;' 1
mutate_fn "[E⑥m] 加 LOOP ⇒ LOOP 斷言轉紅" \
  "$L2" $'  FOR i IN 1..1 LOOP NULL; END LOOP;\n'"$L2" '' '
DO $atk$ BEGIN
  IF (SELECT prosrc !~* $x$\mLOOP\M$x$
      FROM pg_proc WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) THEN
    RAISE EXCEPTION $x$LOOP 竟然沒被抓到 ⇒ E⑥ 無判別力$x$; END IF;
END $atk$;' 1

echo "-- F 區 9(catalog 級破壞 ⇒ 對應斷言轉紅;F⑥ 縱深無專屬突變)--"
mutate_cat "[F①m] proacl 置 NULL ⇒ 前置閘轉紅" \
  "UPDATE pg_catalog.pg_proc SET proacl = NULL WHERE oid = '$FNSIG'::regprocedure;" \
  "IF (SELECT proacl IS NOT NULL FROM pg_catalog.pg_proc WHERE oid = '$FNSIG'::regprocedure) THEN RAISE EXCEPTION 'proacl 竟然非 NULL ⇒ 突變沒生效'; END IF;"
mutate_cat "[F②m] 函式 OWNER 改掉 ⇒ owner 對齊斷言轉紅" \
  "ALTER FUNCTION $FNSIG OWNER TO service_role;" \
  "IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = '$FNSIG'::regprocedure) = (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.order_notes'::regclass) THEN RAISE EXCEPTION 'owner 竟然仍相同 ⇒ 突變沒生效'; END IF;"
mutate_cat "[F③m] audit 表 OWNER 漂移(即使補齊表級 GRANT)⇒ owner 對齊斷言轉紅 —— 這正是 has_table_privilege 看不到的形狀(關卡2 [3][4])" \
  "ALTER TABLE public.admin_audit_log OWNER TO anon; GRANT SELECT, INSERT ON public.admin_audit_log TO postgres;" \
  "IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = '$FNSIG'::regprocedure) = (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN RAISE EXCEPTION 'owner 竟然仍對齊 ⇒ 突變沒生效'; END IF; IF NOT has_table_privilege((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = '$FNSIG'::regprocedure), 'public.admin_audit_log'::regclass, 'INSERT') THEN RAISE EXCEPTION '註:此態下 has_table_privilege 應仍回 true(superuser)——它回 false 代表本格前提變了'; END IF;"
mutate_cat "[F④m] audit 被 FORCE ROW LEVEL SECURITY ⇒ FORCE off 斷言轉紅(關卡2 [5])" \
  "ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;" \
  "IF NOT (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN RAISE EXCEPTION 'FORCE 竟然沒開 ⇒ 突變沒生效'; END IF;"
mutate_cat "[F⑤m] GRANT EXECUTE TO anon ⇒ 攤平恰一列斷言轉紅" \
  "GRANT EXECUTE ON FUNCTION $FNSIG TO anon;" \
  "IF (SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_catalog.pg_proc pr CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a WHERE pr.oid = '$FNSIG'::regprocedure AND a.grantee <> pr.proowner) x) = 'service_role:EXECUTE:false' THEN RAISE EXCEPTION '攤平竟然仍恰一列 ⇒ 突變沒生效'; END IF;"
mutate_cat "[F⑦m] GRANT INSERT ON order_notes TO service_role ⇒ 表級攤平斷言轉紅" \
  "GRANT INSERT ON public.order_notes TO service_role;" \
  "IF (SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE c.oid = 'public.order_notes'::regclass AND a.grantee <> c.relowner) x) = 'service_role:SELECT:false' THEN RAISE EXCEPTION '表級攤平竟然仍恰一列 ⇒ 突變沒生效'; END IF;"
mutate_cat "[F⑧m] 欄級 GRANT UPDATE(body) ⇒ 欄級斷言轉紅(且表級攤平仍綠 = ⑦ 的盲點被證明)" \
  "GRANT UPDATE (body) ON public.order_notes TO service_role;" \
  "IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.order_notes'::regclass AND NOT attisdropped AND attacl IS NOT NULL) = 0 THEN RAISE EXCEPTION '欄級 ACL 竟然仍為 0 ⇒ 突變沒生效'; END IF; IF (SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE c.oid = 'public.order_notes'::regclass AND a.grantee <> c.relowner) x) <> 'service_role:SELECT:false' THEN RAISE EXCEPTION '表級攤平竟然變了(它本不該看得到欄級)'; END IF;"
mutate_cat "[F⑨m] DISABLE ROW LEVEL SECURITY ⇒ RLS 斷言轉紅" \
  "ALTER TABLE public.order_notes DISABLE ROW LEVEL SECURITY;" \
  "IF (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.order_notes'::regclass) THEN RAISE EXCEPTION 'RLS 竟然仍啟用 ⇒ 突變沒生效'; END IF;"
mutate_cat "[F⑩m] ALTER FUNCTION SET search_path=public ⇒ proconfig 斷言轉紅" \
  "ALTER FUNCTION $FNSIG SET search_path = public;" \
  "IF (SELECT pg_catalog.array_to_string(proconfig, ',') FROM pg_catalog.pg_proc WHERE oid = '$FNSIG'::regprocedure) = 'search_path=public, pg_temp' THEN RAISE EXCEPTION 'proconfig 竟然沒變 ⇒ 突變沒生效'; END IF;"

echo "-- G 區 3 --"
# 🔴 關卡2 [14]:grep 錨定行首(^)⇒ 被註解掉(-- SET LOCAL…)不算存在;突變加「註解化」形狀
sed "/^SET LOCAL lock_timeout/d" "$MIGFILE" > /tmp/a6-g1-mut.sql
grep -q "^SET LOCAL lock_timeout = '5s';" /tmp/a6-g1-mut.sql \
  && bad "[G①m] 拿掉 lock_timeout 後 grep 竟然仍命中" \
  || ok "突變 [G①m] 拿掉 lock_timeout ⇒ 存在性 grep 轉紅"
sed "s/^SET LOCAL lock_timeout/-- SET LOCAL lock_timeout/" "$MIGFILE" > /tmp/a6-g1b-mut.sql
grep -q "^SET LOCAL lock_timeout = '5s';" /tmp/a6-g1b-mut.sql \
  && bad "[G①m-b] 註解化後 grep 竟然仍命中(未錨定行首)" \
  || ok "突變 [G①m-b] 註解化 lock_timeout ⇒ 錨定 grep 一樣轉紅(關卡2 [14])"
sed "/^SET LOCAL statement_timeout/d" "$MIGFILE" > /tmp/a6-g2-mut.sql
grep -q "^SET LOCAL statement_timeout = '60s';" /tmp/a6-g2-mut.sql \
  && bad "[G②m] 拿掉 statement_timeout 後 grep 竟然仍命中" \
  || ok "突變 [G②m] 拿掉 statement_timeout ⇒ 存在性 grep 轉紅"
rm -f /tmp/a6-g1-mut.sql /tmp/a6-g1b-mut.sql /tmp/a6-g2-mut.sql
MUT=$((MUT+3))
mutate_cat "[G③m] COMMENT 換成空話 ⇒ 14 碼斷言轉紅" \
  "COMMENT ON FUNCTION $FNSIG IS 'x';" \
  "IF (SELECT obj_description('$FNSIG'::regprocedure,'pg_proc') LIKE '%APPENDED%') THEN RAISE EXCEPTION 'COMMENT 竟然仍含碼 ⇒ 突變沒生效'; END IF;"

mutate_fn "[E⑦m] 加第 15 個 RETURN 字面(SURPRISE)⇒ RETURN 集合斷言轉紅(關卡2 [11])" \
  "$L2" $'  IF p_body = \'magic\' THEN RETURN \'SURPRISE\'; END IF;\n'"$L2" '' '
DO $atk$ BEGIN
  IF (SELECT count(DISTINCT m[1]) FROM pg_proc, regexp_matches(prosrc, $x$RETURN $x$ || chr(39) || $x$([A-Z_]+)$x$ || chr(39), $x$g$x$) m
      WHERE oid = to_regprocedure($x$public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)$x$)) <> 15 THEN
    RAISE EXCEPTION $x$RETURN 字面集合竟然不是 15 ⇒ E⑦ 抓不到第 15 出口$x$; END IF;
END $atk$;' 1

echo "-- I 區 1 --"
mutate_fn "[I①m] 拿掉 actor slug regex ⇒ 大寫 actor 從 RAISE 降級成 raw 23514(author_nonempty)" \
  "IF v_actor !~ '^[a-z0-9_]{1,64}\$' THEN" "IF false THEN" '' '
DO $atk$
DECLARE v_res text; v_con text;
BEGIN
  BEGIN
    v_res := public.admin_append_order_note((SELECT id FROM public.orders WHERE display_id = $x$PCM-9998-0001$x$),
      $x$internal$x$, $x$x$x$, NULL, NULL, NULL, $x$SEAN$x$, $x$mut-i1$x$);
    RAISE EXCEPTION $x$突變後竟成功(%)$x$, v_res;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> $x$order_notes_author_nonempty$x$ THEN RAISE EXCEPTION $x$紅錯約束:%$x$, v_con; END IF;
  END;
END $atk$;' 1

echo "== 突變後還原與零留痕 =="
FNDEF_MD5_AFTER="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ -n "$FNDEF_MD5_AFTER" ] && [ "$FNDEF_MD5_AFTER" = "$FNDEF_MD5_BEFORE" ] \
  && ok "函式定義 md5 未變(全部突變經 ROLLBACK 還原)" \
  || bad "函式定義被突變殘留改掉:before=$FNDEF_MD5_BEFORE after=$FNDEF_MD5_AFTER"
[ "$(q "SELECT to_regclass('public.a6_audit_sink') IS NULL")" = "t" ] \
  && ok "突變用的 a6_audit_sink 沒有殘留" || bad "a6_audit_sink 殘留"
[ "$(q "SELECT to_regprocedure('public.admin_append_order_note_selftest_clone(uuid,text,text,text,timestamptz,uuid,text,text)') IS NULL")" = "t" ] \
  && ok "自檢③ 函式複本沒有殘留" || bad "自檢③ 複本殘留"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conname='a6_boom'")" = "0" ] \
  && ok "D⑦ 的 NOT VALID 約束沒有殘留" || bad "a6_boom 約束殘留"

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "DELETE FROM public.orders WHERE display_id IN ('PCM-9998-0001','PCM-9998-0002')" 2>&1)"
[ $? -eq 0 ] && ok "fixture 訂單已刪除(零 note 引用 ⇒ RESTRICT 不擋 = §B 全程零留痕的另一證)" \
  || bad "fixture 刪除失敗(可能有 note 殘留擋住 RESTRICT):$(printf '%s' "$o" | head -1 | cut -c1-140)"
[ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_N0" ] \
  && ok "orders 回到基準 $ORDERS_N0" || bad "orders 列數污染:基準 $ORDERS_N0、現在 $(q "SELECT count(*) FROM public.orders")"
[ "$(q "SELECT count(*) FROM public.order_notes")" = "$NOTES_N0" ] \
  && ok "order_notes 回到基準 $NOTES_N0" || bad "order_notes 污染"
[ "$(q "SELECT count(*) FROM public.admin_audit_log")" = "$AUDIT_N0" ] \
  && ok "admin_audit_log 回到基準 $AUDIT_N0" || bad "admin_audit_log 污染"

echo
echo "== D. 🔴 誠實邊界(不得對外說滿)=="
echo "   🔴 併發「兩連線同時 append 同單」**沒測**(單連線 harness)。FOR UPDATE 序列化是"
echo "      邏輯論證+文字層,不是 barrier 實測(S2-C 那套形狀本片未做)。"
echo "   🔴 DUPLICATE_REQUEST 冪等只在**同單**重送免競態;**跨單併發重送不擋**(plan §4.3 已知洞)。"
echo "   🔴 E 區是文字層:擋不住「兩支函式接力」等 repo 外變體;承重的是 D 區行為面恰 +1/+0。"
echo "   🔴 F③/F④ 在本機的 has_table_privilege 對 superuser owner 恆 true = 零判別力,"
echo "      故本 harness 改斷「同 owner 或顯式 aclitem」;migration 檔內 3g-2/3g-3 保留"
echo "      has_table_privilege(正式站 owner 非 superuser、有判別力)。兩者形狀不同是刻意的。"
echo "   🔴 owner / superuser 可繞過本 RPC 直改兩表(A3 :21-27);稽核降低單點竄改、非不可竄改。"
echo "   🔴 audit 記 sha256 不記全文:提供「可比對的證據」,不是自動告警;要有人去比。"
echo "   🔴 author 是自陳身分(picker cookie),真身分屬 E8-B。"
echo "   🔴 本機 PG17 + C locale ≠ 正式站;[[:cntrl:]] 與 [[:space:]] 隨 lc_ctype 的邊界差異"
echo "      不外推正式站(同 S2 既有邊界)。實錘:U+3000 全形空白在本機 C locale **不屬**"
echo "      [[:space:]](首跑 A10 向量因此假紅)⇒ 「純全形空白 body 被拒」只在正式站 locale 成立,"
echo "      本機測不到;DB CHECK 用同一字元類 ⇒ 兩層在任一環境內行為一致、不會單邊放行。"
echo "      ACL/SET ROLE 結論跑在 d1-supabase-shim 角色圖上,不等於 PostgREST 層結論。"
echo "   🔴 RPC 執行期無 lock_timeout;撞殘留 owner 交易會掛住而非快速失敗。"
echo "   🔴 關卡2 折入後仍**未驗**的:①正式站 role 屬性(owner 是否 superuser / BYPASSRLS)"
echo "      本輪零 read-back ⇒ 檔內 3g-2/3g-3 的 has_table_privilege 在正式站的判別力**未確認**,"
echo "      真正承重的是 3g-4 的 owner 對齊(那條與角色屬性無關)②「無死結」只證單次呼叫,"
echo "      同交易多單多次呼叫仍可互鎖 ③E 區文字層擋不住「兩支函式接力寫入」等 repo 外變體。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP / 格 CELL=$CELL / 突變 MUT=$MUT =="
echo "   釘數:EXPECTED_TOTAL=$EXPECTED_TOTAL EXPECTED_CELL=$EXPECTED_CELL EXPECTED_MUT=$EXPECTED_MUT"
skip_gate "$SKIP" || { echo "🔴 [H2] SKIP 非零"; exit 1; }
[ "$((PASS+FAIL))" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 [H1] 總案例數 $((PASS+FAIL)) ≠ 釘數 $EXPECTED_TOTAL"; exit 1; }
# 🔴 關卡2 [10]:三個獨立計數器 —— 只釘總數的話,「刪一個 mutant + 補一個無關 ok」照樣過。
[ "$CELL" -eq "$EXPECTED_CELL" ] || { echo "🔴 [H1b] manifest 格數 $CELL ≠ 釘數 $EXPECTED_CELL(plan §7.1 與本檔不同步)"; exit 1; }
[ "$MUT" -eq "$EXPECTED_MUT" ] || { echo "🔴 [H1c] 突變數 $MUT ≠ 釘數 $EXPECTED_MUT(有突變被刪或漏跑)"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
