#!/usr/bin/env bash
# ============================================================
# A7c RW1b:RW1a(20260803150000 退款寫入 RPC 對 + schema 增補)verify harness 全套
# ============================================================
# 片級 plan = docs/specs/2026-08-03-a7c-refund-wire-plan.md v3.2 §1 RW1b 列:
#   from-zero + 格 + 逐守門突變 + 兄弟 A→B→A + G8×G12 barrier 交錯 + rollback 實跑;
#   fixture 三釘防恆真(fable N1)+ deferred×failed_consistency 相容格(N6)。
#
# 用法:
#   bash scripts/a7c-rw1b-verify.sh all /tmp/rw1b   # 從零 provision(port 54331)→ 全套
#   bash scripts/a7c-rw1b-verify.sh run /tmp/rw1b   # 重用既有 54331 拋棄式 cluster
#   ⚠️ run 模式在 §6(barrier)committed 收案後不可重複 —— §6 開頭有守門會擋;
#     要再跑全套請用 all 重 provision。
#
# 🔴 port=54331(不是 54329):54329 是 d1t2 家族的約定 port,2026-08-03 被平行施工
#    視窗①的 cluster 佔用中 —— 本 harness 全程不碰 54329。兄弟 a7c-verify.sh 以
#    A7C_VERIFY_PORT=54331 指過來(該檔本片同步加了 env 覆寫)。
#
# ── 🔴 誠實邊界(先寫,免得數字被當成比它實際更強的證據)──────────────────
# · 本機 PG17 非 Supabase:role 繼承 / BYPASSRLS / pgbouncer / PostgREST 不在覆蓋內。
# · 「格全綠」證明的是**這些輸入走到指定出口**,不是「所有輸入都對」。
# · 突變一格轉綠只證明**該守門對該案例**承重(a7bt-mutation.sh 同一句誠實邊界)。
# · G11 的 [[:cntrl:]] 判定吃 lc_ctype —— 本機 C locale 的結論**不外推正式站**(plan G11 ⚠️)。
# · 併發只做 plan 指定的 `finalize G8 翻轉 × initiate G12` 一種交錯;
#   「兩 finalize 同單搶 SUM」在 S5 下物理不可達(同單僅一 processing 列;同列雙
#   finalize 由 G5 CAS 決勝)—— 不造假場景(fable F5 原文照錄)。initiate×initiate
#   序列化由 G1 鎖 + S5 蘊含,單 session 格 c06/c21 已釘其出口。
# · RPC 內部的 5a(hold 友善 RAISE)與 G5(CAS RAISE)**不做文字手術消融**:
#   兩者的觀察各自**可歸因**(5a=RPC 訊息、P7C15=trigger constraint 名,由 c20/n14
#   分別釘;G5=「CAS 失敗」訊息,由 c08 釘、與狀態機 trigger 訊息不同)——
#   🔴 歸因 ≠ 承重:c08 不證明「拿掉 G5 的 CAS WHERE 會出事」(拿掉後同值冪等重寫
#   會靜默二次結案+二次 audit),該承重消融**沒做**(code-reviewer R1 N1 誠實登記);
#   對 1050 行 RPC 本體做 sed 手術的失配風險(#306 教訓)高於它能新證明的事。
# · 稽核行為格(audit 鍵形/筆數/hold 第七值)= RW1a 檔頭承諾的「audit payload 行為
#   驗證屬 RW1b」——在 §2 c50/c51 關閉。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a7c-rw1b-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/rw1b —— unix socket 路徑上限)}"
case "$MODE" in all|run) : ;; *) echo "🔴 mode 只接受 all|run(收到:$MODE)"; exit 2 ;; esac

PORT=54331
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
AURL="${URL}?application_name=rw1b_sess_a"
BURL="${URL}?application_name=rw1b_sess_b"
MIG="supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql"
OLD_LEDGER="supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql"
OLD_GUARDS="supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql"
export LC_ALL=C

PASS=0; FAIL=0
log() { echo "== $* =="; }
die() { printf '  🔴🔴 當場中止:%s\n' "$1"; exit 1; }
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }

# 🔴 workdir 閘(codex K2 MF1 + R2 再擊破折入):
#    R1:/tmp// 穿過 /tmp/?* glob(? 可匹配 /)⇒ rm -rf /tmp//。
#    R2:/tmp/<symlink>/ 的尾斜線讓 [ -L ] 循鏈判 false ⇒ 可對別的 marked cluster 動手。
#    ⇒ 先剝光尾斜線(-L 才真的看 symlink 本體),再:非 symlink + 恰一層 /tmp 直屬 + 無 ..。
while [ "${WORK%/}" != "$WORK" ]; do WORK="${WORK%/}"; done
[ -L "$WORK" ] && die "workdir 不得是 symlink(收到:$WORK)"
case "$WORK" in /tmp/?*) : ;; *) die "workdir 必須在 /tmp 底下(收到:$WORK)" ;; esac
case "$WORK" in /tmp/*/*) die "workdir 必須是 /tmp 的直屬子目錄、不得含多層或連續斜線(收到:$WORK)" ;; esac
case "$WORK" in *..*) die "workdir 不得含 ..(收到:$WORK)" ;; esac
case "$(basename "$WORK")" in ''|.|..) die "workdir basename 非法(收到:$WORK)" ;; esac

test -f "$MIG"        || die "找不到 $MIG"
test -f "$OLD_LEDGER" || die "找不到 $OLD_LEDGER"
test -f "$OLD_GUARDS" || die "找不到 $OLD_GUARDS"

# ══ 0. provision(from-zero:initdb PG17 + shim + 全套 migrations 重放 + d1t2 seed)══
PGBIN="$(dirname "$(command -v initdb)")"
if [ "$MODE" = "all" ]; then
  log "0/9 provision 拋棄式 PG17(port ${PORT})"
  # 既存目錄必須帶 ownership marker 才准 stop/rm(codex K2 MF1 後半:
  # 不對「不是本 harness 建的」pgdata 動手 —— d1t2 teardown 同紀律)
  if [ -e "$WORK" ] && [ ! -f "$WORK/.d1t2-harness" ]; then
    die "$WORK 已存在但缺 .d1t2-harness marker —— 不是本 harness 建的目錄,拒 stop/rm"
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    [ -f "$WORK/.d1t2-harness" ] && [ -d "$WORK/pgdata" ] \
      && "$PGBIN/pg_ctl" -D "$WORK/pgdata" stop -m fast >/dev/null 2>&1
    sleep 1
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 \
      && die "埠 $PORT 被佔用且不是 $WORK/pgdata 這台 —— 不硬殺別人的 postmaster,停下"
  fi
  rm -rf "$WORK"; mkdir -p "$WORK"
  "$PGBIN/initdb" --version | grep -q ' 17\.' || die "PATH 的 initdb 非 PG17"
  "$PGBIN/initdb" -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null 2>&1
  touch "$WORK/.d1t2-harness"   # 拋棄式 harness cluster 的 ownership marker(d1t2 家族同款)
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${WORK}'" start >/dev/null \
    || { cat "$WORK/pg.log" >&2; die "pg_ctl 啟動失敗"; }
  psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql || die "shim 失敗"
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*) continue ;; esac
    if [ "$f" = "$FIRST_FITMENTS" ]; then
      psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql || die "fitments bootstrap 失敗"
    fi
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "migration 失敗:$f"
  done
  ok "全套 migrations 重放綠(含 $MIG 檔內驗收塊)"
  pnpm exec tsx scripts/d1t2-seed.ts > "$WORK/seed.sql" 2>"$WORK/seed.err" || die "seed 產生失敗(見 $WORK/seed.err)"
  test -s "$WORK/seed.sql" || die "seed.sql 為空"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" || die "seed 套用失敗"
  for pair in "orders 31" "order_items 41" "customers 2" "order_refunds 0" "order_refund_items 0"; do
    set -- $pair
    [ "$(q "SELECT count(*) FROM public.$1")" = "$2" ] || die "seed 筆數不符:$1 應 $2"
  done
  ok "d1t2 seed 已佈(兄弟 a7c-verify 的 fixture 訂單來源)"
else
  # run 模式不建目錄:workdir 必須是先前 all 建好的 cluster(缺 marker 直接死,
  # 不留一個空殼目錄 —— code-reviewer R2 nit)
  [ -f "$WORK/.d1t2-harness" ] || die "run 模式需要既有 harness cluster($WORK 缺 marker);先跑 all"
fi

# ── 身分閘(marker / datadir / port / db / RC / lc_messages)────────────────
test -f "$WORK/.d1t2-harness" || die "$WORK 缺 ownership marker;拒跑"
canon() { [ -d "$1" ] && (cd "$1" && pwd -P) || echo "$1"; }
ACTUAL_DATADIR="$(canon "$(q 'SHOW data_directory')")"
[ "$ACTUAL_DATADIR" = "$(canon "$WORK")/pgdata" ] || die "port ${PORT} 的 data_directory=[$ACTUAL_DATADIR] 不是 $WORK/pgdata;拒跑"
[ "$(q 'SELECT current_database()')" = "postgres" ] || die "db 名不符"
[ "$(q 'SHOW default_transaction_isolation')" = "read committed" ] || die "非 READ COMMITTED 預設"
[ "$(q 'SHOW lc_messages')" = "C" ] || die "lc_messages 非 C"
ok "身分閘通過(54331 拋棄式 cluster)"

# ── 結構指紋(harness 自己的零漂移基準;涵蓋 proacl/relacl/policy/owner/COMMENT)──
STRUCT_SQL="SELECT md5(concat(
  (SELECT coalesce(string_agg(pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, E'\n' ORDER BY t.tgname), '')
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items') AND NOT t.tgisinternal),
  (SELECT coalesce(string_agg(p.proname || '|' || md5(p.prosrc) || '|' || p.prosecdef::text || '|'
            || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || pg_get_userbyid(p.proowner) || '|'
            || coalesce(p.proacl::text, '(null)') || '|' || coalesce(md5(obj_description(p.oid,'pg_proc')), '-'),
            E'\n' ORDER BY p.proname), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('admin_initiate_order_refund','admin_finalize_order_refund','pcm_a7c_refund_insert_guard',
       'pcm_a7c_refund_immutable_guard','pcm_order_refund_status_transition','pcm_order_refundable_remaining')),
  (SELECT coalesce(string_agg(c.relname || '.' || con.conname || '=' || pg_get_constraintdef(con.oid), E'\n'
            ORDER BY c.relname, con.conname), '')
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items')),
  (SELECT coalesce(string_agg(indexdef, E'\n' ORDER BY indexdef), '')
     FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('order_refunds','order_refund_items')),
  (SELECT coalesce(string_agg(c.relname || '|' || coalesce(c.relacl::text, '(null)') || '|'
            || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || pg_get_userbyid(c.relowner),
            E'\n' ORDER BY c.relname), '')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items')),
  (SELECT coalesce(string_agg(c.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
            || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
            || '|' || coalesce(a.attacl::text, '-'), E'\n' ORDER BY c.relname, a.attnum), '')
     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items')
      AND a.attnum > 0 AND NOT a.attisdropped),
  (SELECT coalesce(string_agg(c.relname || '.' || pol.polname, E'\n' ORDER BY c.relname, pol.polname), '(zero-policy)')
     FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items')),
  (SELECT coalesce(string_agg(k.conname || '|' || md5(des.description), E'\n' ORDER BY k.conname), '')
     FROM pg_description des JOIN pg_constraint k ON k.oid = des.objoid
     JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE des.classoid = 'pg_constraint'::regclass
      AND n.nspname = 'public' AND c.relname IN ('order_refunds','order_refund_items'))))"

snapshot() {  # $1=輸出檔 $2=用途(fail-closed:退出碼 / stderr 空 / sentinel)
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$STRUCT_SQL" > "$1" 2>"$1.err"
  local rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$1.err" ]; then
    die "結構快照失敗($2,rc=$rc):$(head -1 "$1.err" 2>/dev/null)"
  fi
  printf 'SNAPSHOT-OK\n' >> "$1"
}
snapshot "$WORK/struct-0.snap" "基準"
ok "結構指紋基準已取"

# ══ 1. 兄弟 A(a7c-verify.sh 全套;RW1a 增欄後的相容性 = 本片對帳的一半)══════════
log "1/9 兄弟 harness A:a7c-verify.sh(A7c 十四道守門 + 突變)"
if A7C_VERIFY_PORT="$PORT" bash scripts/a7c-verify.sh "$WORK" > "$WORK/sibling-1.log" 2>&1 \
   && grep -q '🎉 全綠' "$WORK/sibling-1.log"; then
  ok "兄弟 A 全綠($(grep -c '✅' "$WORK/sibling-1.log") ✅;log=$WORK/sibling-1.log)"
else
  bad "兄弟 A 紅了(見 $WORK/sibling-1.log 末段):$(tail -3 "$WORK/sibling-1.log" | tr '\n' ' ' | cut -c1-200)"
fi

# ══ 2. 行為格(單一交易、收尾 ROLLBACK = 零留痕、可重複執行)═══════════════════
# 🔴 fixture 三釘(fable N1)以**可執行斷言**落地,不是註解:
#    釘① c09 斷言 record_refunded_before = 40 > 0;
#    釘② c07/c23 斷言 0 < SUM < total 的 partiallyRefunded 分支真的走到;
#    釘③ c02 斷言 refund_amount(40) ≠ orders.total(97)(避撞號 —— 總額 97/89/73/53
#        全取質數,退款額 40/57/30/29/15/10 無一等於所在訂單總額)。
build_cells() { cat > "$WORK/cells.sql" <<'CELLS'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  -- IS NOT TRUE:條件為 NULL(查無列)也算失敗 = fail-closed
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'RW1B 斷言失敗:%', p_msg; END IF;
END $fn$;

CREATE FUNCTION pg_temp.cell(p_id text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN RAISE NOTICE 'CELL-OK|%', p_id; END $fn$;

-- expect_raise:p_sql 必須 RAISE 且訊息命中 p_pat(LIKE 樣式);沒紅或紅錯地方都算失敗
CREATE FUNCTION pg_temp.expect_raise(p_id text, p_sql text, p_pat text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'RW1B0', MESSAGE = 'no-raise';
  EXCEPTION
    WHEN SQLSTATE 'RW1B0' THEN
      RAISE EXCEPTION '%:應 RAISE 而竟成功', p_id;
    WHEN OTHERS THEN
      IF SQLERRM LIKE p_pat THEN
        PERFORM pg_temp.cell(p_id);
      ELSE
        RAISE EXCEPTION '%:紅錯地方 [%][%]', p_id, SQLSTATE, SQLERRM;
      END IF;
  END;
END $fn$;

-- expect_red:p_sql 必須紅在指定 CONSTRAINT_NAME + SQLSTATE(a7bt「紅對地方」紀律)
CREATE FUNCTION pg_temp.expect_red(p_id text, p_sql text, p_conname text, p_state text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_c text; v_s text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'RW1B0', MESSAGE = 'no-raise';
  EXCEPTION
    WHEN SQLSTATE 'RW1B0' THEN
      RAISE EXCEPTION '%:應紅在 % 而竟成功', p_id, p_conname;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME, v_s = RETURNED_SQLSTATE;
      IF v_c = p_conname AND v_s = p_state THEN
        PERFORM pg_temp.cell(p_id);
      ELSE
        RAISE EXCEPTION '%:紅在 [%|%],預期 [%|%]', p_id, v_c, v_s, p_conname, p_state;
      END IF;
  END;
END $fn$;

-- ── fixture:六張訂單(customer 取 seed 現有;總額全質數 —— 釘③ 避撞號)────────
CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT (SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1) AS cust;
SELECT pg_temp.assert((SELECT cust FROM fx) IS NOT NULL, 'fixture:seed customers 為空');

INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, shipping_method_at_checkout, invoice,
  payment_channel, payment_status, tappay_rec_trade_id)
SELECT x.id::uuid, x.did, (SELECT cust FROM fx),
       '{"name":"RW1B","phone":"0900000000","line":"harness"}', 'general',
       x.amt, 0, x.amt, 'home', 'home', '{"type":"donate","donateCode":"123"}',
       'tappay', x.ps::public.payment_status, x.rec
FROM (VALUES
  ('0b000000-0000-4000-8000-00000000000a', 'BCDFG2', 97, 'paid',   'RECRW1BA'),
  ('0b000000-0000-4000-8000-00000000000b', 'BCDFG3', 89, 'paid',   'RECRW1BB'),
  ('0b000000-0000-4000-8000-00000000000c', 'BCDFG4', 41, 'unpaid', 'RECRW1BC'),
  ('0b000000-0000-4000-8000-00000000000d', 'BCDFG5', 43, 'paid',   NULL),
  ('0b000000-0000-4000-8000-00000000000e', 'BCDFG6', 73, 'paid',   'RECRW1BE'),
  ('0b000000-0000-4000-8000-00000000000f', 'BCDFG7', 53, 'paid',   'RECRW1BF')
) AS x(id, did, amt, ps, rec);

-- ══ A 組(訂單 A:97):initiate/冪等/single-flight/G8 兩段翻轉 ═══════════════
-- c01 INITIATED(partial 40)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED' AND (r->>'refund_amount')::int = 40 AND r->>'status' = 'processing'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'partial', 40, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a01') AS r) t),
  'c01 initiate partial 40 應 INITIATED');
SELECT pg_temp.cell('c01');

-- c02 列形狀 + brid 形狀 + 釘③(refund_amount ≠ orders.total)
SELECT pg_temp.assert(
  (SELECT r.kind = 'partial' AND r.record_refunded_before = 0
      AND r.bank_refund_id ~ '^[A-Za-z0-9]{20}$'
      AND r.refund_amount <> o.total
     FROM public.order_refunds r JOIN public.orders o ON o.id = r.order_id
    WHERE r.request_id = 'cc000000-0000-4000-8000-000000000a01'),
  'c02 列形狀/brid 20 字/避撞號釘失敗');
SELECT pg_temp.cell('c02');

-- c03 同 token 同指紋重放 → DUPLICATE_REQUEST(status=processing)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'DUPLICATE_REQUEST' AND r->>'status' = 'processing'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'partial', 40, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a01') AS r) t),
  'c03 同 token 重放應 DUPLICATE_REQUEST');
SELECT pg_temp.cell('c03');

-- c04 同 token 指紋不符(金額 41)→ RAISE
SELECT pg_temp.expect_raise('c04',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
    'partial', 41, 0, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-000000000a01')$$,
  '%指紋不符%');

-- c05 同 token 換訂單(S4 全域)→ RAISE 指紋不符
SELECT pg_temp.expect_raise('c05',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 40, 0, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-000000000a01')$$,
  '%指紋不符%');

-- c06 新 token 同單 → REFUND_IN_FLIGHT(S5)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'REFUND_IN_FLIGHT'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'partial', 10, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a02') AS r) t),
  'c06 新 token 同單應 REFUND_IN_FLIGHT');
SELECT pg_temp.cell('c06');

-- c07 finalize accepted wire=40 → FINALIZED;partiallyRefunded(釘② 0<40<97);
--     tappay 與證據同值;remaining=57
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'status_after' = 'confirmed'
      AND r->>'payment_status_after' = 'partiallyRefunded'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000a01'),
           'accepted', 'DRA40', 40, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a03') AS r) t),
  'c07 finalize accepted 40 應 FINALIZED+partiallyRefunded');
SELECT pg_temp.assert(
  (SELECT o.payment_status::text = 'partiallyRefunded'
      AND r.tappay_refund_id = 'DRA40' AND r.provider_refund_id_evidence = 'DRA40'
      AND public.pcm_order_refundable_remaining(o.id) = 57
     FROM public.orders o JOIN public.order_refunds r ON r.order_id = o.id
    WHERE o.id = '0b000000-0000-4000-8000-00000000000a'),
  'c07 後訂單/列/remaining 形狀不符');
SELECT pg_temp.cell('c07');

-- c08 對已終結列重呼 finalize → G5 CAS RAISE(訊息可歸因,與狀態機 trigger 訊息不同)
SELECT pg_temp.expect_raise('c08',
  $$SELECT public.admin_finalize_order_refund(
    (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000a01'),
    'accepted', 'DRA40', 40, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-000000000a04')$$,
  '%CAS 失敗%');

-- c09 initiate full(baseline 40、Record 剩餘 57)→ 凍結 57;釘①(baseline > 0)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED' AND (r->>'refund_amount')::int = 57
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'full', NULL, 40, 57, 'rw1b full', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a05') AS r) t),
  'c09 initiate full 應凍結 57');
SELECT pg_temp.assert(
  (SELECT kind = 'full' AND record_refunded_before = 40 AND record_refunded_before > 0
     FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000a05'),
  'c09 釘①失敗:record_refunded_before 應為 40(>0)');
SELECT pg_temp.cell('c09');

-- c10 finalize accepted wire=57 → refunded、remaining=0
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'payment_status_after' = 'refunded'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000a05'),
           'accepted', 'DRA57', 57, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a06') AS r) t),
  'c10 finalize accepted 57 應 FINALIZED+refunded');
SELECT pg_temp.assert(
  (SELECT payment_status::text = 'refunded'
      AND public.pcm_order_refundable_remaining(id) = 0
     FROM public.orders WHERE id = '0b000000-0000-4000-8000-00000000000a'),
  'c10 後 remaining 應為 0');
SELECT pg_temp.cell('c10');

-- c11 refunded 後「新」token → REFUND_LEDGER_FULL(G12;Sean Q1=A)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'REFUND_LEDGER_FULL'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'partial', 1, 97, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a07') AS r) t),
  'c11 refunded 後新 token 應 REFUND_LEDGER_FULL');
SELECT pg_temp.cell('c11');

-- c12 refunded 後「舊」token 重放 → DUPLICATE_REQUEST(G4 先於 G12;K2 MF4 合約)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'DUPLICATE_REQUEST' AND r->>'status' = 'confirmed'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000a'::uuid,
           'full', NULL, 40, 57, 'rw1b full', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000a05') AS r) t),
  'c12 舊 token 重放應 DUPLICATE_REQUEST(不被 LEDGER_FULL 遮蔽)');
SELECT pg_temp.cell('c12');

-- ══ B 組(訂單 B:89):deferred 三態 / hold 全鏈 / 恢復出口 ══════════════════
-- c13 initiate 30
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 30, 0, NULL, 'rw1b b', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b01') AS r) t),
  'c13 應 INITIATED');
SELECT pg_temp.cell('c13');

-- c14 finalize deferred → deferred 終態;failed_reason NULL(N6 相容格);tappay NULL;訂單不動
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'status_after' = 'deferred'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b01'),
           'deferred_not_captured', NULL, NULL, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b02') AS r) t),
  'c14 finalize deferred 應 FINALIZED');
SELECT pg_temp.assert(
  (SELECT r.status = 'deferred' AND r.failed_reason IS NULL AND r.tappay_refund_id IS NULL
      AND o.payment_status::text = 'paid'
     FROM public.order_refunds r JOIN public.orders o ON o.id = r.order_id
    WHERE r.request_id = 'cc000000-0000-4000-8000-000000000b01'),
  'c14 deferred 列形狀(failed_reason 必 NULL = failed_consistency 相容)不符');
SELECT pg_temp.cell('c14');

-- c15 deferred 不佔額度(S6 remaining allowlist 正向格)
SELECT pg_temp.assert(
  public.pcm_order_refundable_remaining('0b000000-0000-4000-8000-00000000000b') = 89,
  'c15 deferred 後 remaining 應仍為 89');
SELECT pg_temp.cell('c15');

-- c16 deferred 的 token 重放 → RAISE(終結態不得同鍵重放)
SELECT pg_temp.expect_raise('c16',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 30, 0, NULL, 'rw1b b', 'rw1b_tester', 'cc000000-0000-4000-8000-000000000b01')$$,
  '%已終結為 deferred%');

-- c17 deferred 釋出 single-flight → 再 initiate 成功;rotation-always 兩把鍵不同
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 30, 0, NULL, 'rw1b b2', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b03') AS r) t),
  'c17 deferred 後再 initiate 應 INITIATED');
SELECT pg_temp.assert(
  (SELECT count(DISTINCT bank_refund_id) = 2 FROM public.order_refunds
    WHERE order_id = '0b000000-0000-4000-8000-00000000000b'),
  'c17 rotation-always:兩列 bank_refund_id 應不同');
SELECT pg_temp.cell('c17');

-- c18 新鮮 processing 列直呼恢復出口 → 異常列閘 RAISE(5b)
SELECT pg_temp.expect_raise('c18',
  $$SELECT public.admin_finalize_order_refund(
    (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b03'),
    'recovered_confirmed', 'DRFAKE99', NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-000000000b04')$$,
  '%只對異常列開放%');

-- c19 finalize accepted 金額不符(29≠30)→ HELD;證據寫入;留 processing;訂單不動
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'HELD_AMOUNT_MISMATCH' AND r->>'status_after' = 'processing'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b03'),
           'accepted', 'DRB30', 29, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b05') AS r) t),
  'c19 wire=29 應 HELD_AMOUNT_MISMATCH');
SELECT pg_temp.assert(
  (SELECT r.status = 'processing' AND r.provider_refund_id_evidence = 'DRB30'
      AND r.tappay_refund_id IS NULL AND o.payment_status::text = 'paid'
     FROM public.order_refunds r JOIN public.orders o ON o.id = r.order_id
    WHERE r.request_id = 'cc000000-0000-4000-8000-000000000b03'),
  'c19 hold 列形狀不符');
SELECT pg_temp.cell('c19');

-- c20 hold 列走零動錢終態 → RAISE(5a;RPC 層訊息 —— P7C15 trigger 由 n14 直寫獨立釘)
SELECT pg_temp.expect_raise('c20',
  $$SELECT public.admin_finalize_order_refund(
    (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b03'),
    'not_sent', NULL, NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-000000000b06')$$,
  '%不得標成零動錢終態%');

-- c21 hold 列仍佔 single-flight → REFUND_IN_FLIGHT
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'REFUND_IN_FLIGHT'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 5, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b07') AS r) t),
  'c21 hold 列在時應 REFUND_IN_FLIGHT');
SELECT pg_temp.cell('c21');

-- c22 hold 列 recovered_confirmed 帶「錯的」DR 碼 → P7C13(證據一致閘,RPC 路徑)
SELECT pg_temp.expect_red('c22',
  $$SELECT public.admin_finalize_order_refund(
    (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b03'),
    'recovered_confirmed', 'DRZZZ', NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-000000000b08')$$,
  'a7c_confirm_evidence_mismatch', 'P7C13');

-- c23 hold 列 recovered_confirmed 同 DR 碼 → FINALIZED;partiallyRefunded(釘② 0<30<89)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'payment_status_after' = 'partiallyRefunded'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b03'),
           'recovered_confirmed', 'DRB30', NULL, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b09') AS r) t),
  'c23 恢復結案應 FINALIZED+partiallyRefunded');
SELECT pg_temp.assert(
  (SELECT r.status = 'confirmed' AND r.tappay_refund_id = 'DRB30'
      AND o.payment_status::text = 'partiallyRefunded'
     FROM public.order_refunds r JOIN public.orders o ON o.id = r.order_id
    WHERE r.request_id = 'cc000000-0000-4000-8000-000000000b03'),
  'c23 後列/訂單形狀不符');
SELECT pg_temp.cell('c23');

-- c24 full 且 Record 剩餘 0 → REFUND_NOTHING_LEFT(fable F2:不凍 0 元撞 CHECK)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'REFUND_NOTHING_LEFT'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'full', NULL, 89, 0, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0a') AS r) t),
  'c24 full+record_amount=0 應 REFUND_NOTHING_LEFT');
SELECT pg_temp.cell('c24');

-- ══ C/D/隨機:其餘 initiate 業務碼 ═══════════════════════════════════════════
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'ORDER_NOT_REFUNDABLE'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000c'::uuid,
           'partial', 5, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000c01') AS r) t),
  'c25 unpaid 訂單應 ORDER_NOT_REFUNDABLE');
SELECT pg_temp.cell('c25');

SELECT pg_temp.assert(
  (SELECT r->>'result' = 'ORDER_NO_CARD_TRANSACTION'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000d'::uuid,
           'partial', 5, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000d01') AS r) t),
  'c26 無 rec_trade 應 ORDER_NO_CARD_TRANSACTION');
SELECT pg_temp.cell('c26');

SELECT pg_temp.assert(
  (SELECT r->>'result' = 'ORDER_NOT_FOUND'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-dead-4000-8000-000000000000'::uuid,
           'partial', 5, 0, NULL, 'rw1b cell', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000e01') AS r) t),
  'c27 不存在訂單應 ORDER_NOT_FOUND');
SELECT pg_temp.cell('c27');

SELECT pg_temp.assert(
  (SELECT r->>'result' = 'REFUND_NOT_FOUND'
     FROM (SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
           'accepted', 'DRX', 5, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000e02') AS r) t),
  'c28 不存在退款列應 REFUND_NOT_FOUND');
SELECT pg_temp.cell('c28');

-- ══ E 組:G8 來源態 allowlist(資料異常 → RAISE 整筆回滾)═══════════════════════
-- 訂單 E initiate 後,owner 直改 payment_status 模擬資料漂移(具名注入,隨交易回滾)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000e'::uuid,
           'partial', 10, 0, NULL, 'rw1b e', 'rw1b_tester',
           'cc000000-0000-4000-8000-00000000e001') AS r) t),
  'c29 前置 initiate 應 INITIATED');
UPDATE public.orders SET payment_status = 'unpaid'
 WHERE id = '0b000000-0000-4000-8000-00000000000e';
SELECT pg_temp.expect_raise('c29',
  $$SELECT public.admin_finalize_order_refund(
    (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-00000000e001'),
    'accepted', 'DRE10', 10, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-00000000e002')$$,
  '%不允許進入退款轉移%');

-- ══ F 組:G8 單調不降級(refunded 永不被翻回 partiallyRefunded)═══════════════
-- 佈景:paid 下直寫一列 confirmed(20)→ owner 把訂單標 refunded(模擬 Portal/歷史態)
--   → 直寫第二列 processing(15;P7C02 刻意放行 refunded = 其註解「取決於尚未存在的
--   程式」的那一格)→ RPC finalize → SUM=35 < 53 但 refunded 必須保持。
INSERT INTO public.order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before)
VALUES ('0f000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000f',
  'BRF2000000000000000A', 'RECRW1BF', 20, 'processing', 'rw1b f1', 'rw1b_tester',
  'cc000000-0000-4000-8000-00000000f001', 'partial', 0);
UPDATE public.order_refunds SET status = 'confirmed', tappay_refund_id = 'DRF20'
 WHERE id = '0f000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'refunded'
 WHERE id = '0b000000-0000-4000-8000-00000000000f';
INSERT INTO public.order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before)
VALUES ('0f000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-00000000000f',
  'BRF2000000000000000B', 'RECRW1BF', 15, 'processing', 'rw1b f2', 'rw1b_tester',
  'cc000000-0000-4000-8000-00000000f002', 'partial', 20);
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'payment_status_after' = 'refunded'
     FROM (SELECT public.admin_finalize_order_refund('0f000000-0000-4000-8000-000000000002'::uuid,
           'accepted', 'DRF15', 15, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-00000000f003') AS r) t),
  'c30 finalize 應 FINALIZED 且 payment_status_after 仍 refunded');
SELECT pg_temp.assert(
  (SELECT payment_status::text = 'refunded' FROM public.orders
    WHERE id = '0b000000-0000-4000-8000-00000000000f'),
  'c30 單調失敗:refunded 被降級(SUM 35 < 53 不得翻回 partiallyRefunded)');
SELECT pg_temp.cell('c30');

-- ══ G11 輸入衛生:initiate ═════════════════════════════════════════════════════
SELECT pg_temp.expect_raise('c31',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, 0, NULL, 'rw1b cell', 'BAD ACTOR!', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%actor 非法%');
SELECT pg_temp.expect_raise('c32',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, 0, NULL, 'rw1b cell', 'rw1b_tester', 'CC000000-0000-4000-8000-0000000000FF')$$,
  '%request_id 非法%');
SELECT pg_temp.expect_raise('c33',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, 0, NULL, E'a\nb', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%reason 非法%');
SELECT pg_temp.expect_raise('c34',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, 0, NULL, repeat('x', 201), 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%reason 非法%');
SELECT pg_temp.expect_raise('c35',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'bogus', 5, 0, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%kind 須為 full|partial%');
SELECT pg_temp.expect_raise('c36',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, -1, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%record_refunded_before 須為非負整數%');
SELECT pg_temp.expect_raise('c37',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 0, 0, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%partial 必須帶正整數 amount%');
SELECT pg_temp.expect_raise('c38',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'partial', 5, 0, 10, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%partial 不得帶 record_amount%');
SELECT pg_temp.expect_raise('c39',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'full', 5, 0, 10, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%full 不得帶 amount%');
SELECT pg_temp.expect_raise('c40',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'full', NULL, 0, NULL, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%full 必須帶非負 record_amount%');
SELECT pg_temp.expect_raise('c41',
  $$SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
    'full', NULL, 0, 2147483648, 'rw1b cell', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%record_amount 超出 integer 範圍%');

-- ══ G6/G11 輸入衛生:finalize(步 1-2 先於列查找 ⇒ refund_id 可用任意 uuid)══════
SELECT pg_temp.expect_raise('c42',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'exploded', NULL, NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%outcome 非法%');
SELECT pg_temp.expect_raise('c43',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', NULL, 5, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%必須帶合法 tappay_refund_id%');
SELECT pg_temp.expect_raise('c44',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'deferred_not_captured', 'DRX', NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%不得帶 tappay_refund_id%');
SELECT pg_temp.expect_raise('c45',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', 'DRX', NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%accepted 必須帶 refund_amount_wire%');
SELECT pg_temp.expect_raise('c46',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'rejected_out_of_range', NULL, 5, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%不得帶 refund_amount_wire%');
SELECT pg_temp.expect_raise('c47',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'manual_failed', NULL, NULL, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%manual_failed 必須帶 failed_detail%');
SELECT pg_temp.expect_raise('c48',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', 'DRX', 5, 'x', 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%不得帶 failed_detail%');
SELECT pg_temp.expect_raise('c49',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'rejected_out_of_range', NULL, NULL, repeat('x', 501), 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%failed_detail 超長%');
-- codex K2 MF3 補格:finalize 自己的 actor/request regex、非 NULL 壞 DR 碼、負數 wire
-- (c43/c45 只測 NULL 分支 —— 拿掉這四道獨立判斷原本仍全綠)
SELECT pg_temp.expect_raise('c56',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'not_sent', NULL, NULL, NULL, 'BAD ACTOR!', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%actor 非法%');
SELECT pg_temp.expect_raise('c57',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'not_sent', NULL, NULL, NULL, 'rw1b_tester', 'CC000000-0000-4000-8000-0000000000FF')$$,
  '%request_id 非法%');
SELECT pg_temp.expect_raise('c58',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', 'DR X', 5, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%必須帶合法 tappay_refund_id%');
SELECT pg_temp.expect_raise('c59',
  $$SELECT public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', 'DRX', -1, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff')$$,
  '%accepted 必須帶 refund_amount_wire%');

-- ══ B 組尾聲:failed 兩碼正向 + manual_failed(經 hold)+ remaining 總帳 ═══════
-- c52 rejected_out_of_range(detail 選填有給)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 5, 30, NULL, 'rw1b b3', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0b') AS r) t),
  'c52 前置 initiate 應 INITIATED');
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'status_after' = 'failed'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0b'),
           'rejected_out_of_range', NULL, NULL, 'TapPay 10051', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0c') AS r) t),
  'c52 finalize rejected 應 FINALIZED+failed');
SELECT pg_temp.assert(
  (SELECT failed_reason = 'rejected_out_of_range' AND failed_detail = 'TapPay 10051'
     FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0b'),
  'c52 failed 列 machine code 形狀不符');
SELECT pg_temp.cell('c52');

-- c53 not_sent(detail 不給)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 7, 30, NULL, 'rw1b b4', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0d') AS r) t),
  'c53 前置 initiate 應 INITIATED');
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0d'),
           'not_sent', NULL, NULL, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0e') AS r) t),
  'c53 finalize not_sent 應 FINALIZED');
SELECT pg_temp.assert(
  (SELECT failed_reason = 'not_sent' AND failed_detail IS NULL
     FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0d'),
  'c53 failed 列形狀不符');
SELECT pg_temp.cell('c53');

-- c54 manual_failed:經 hold(證據非空)→ 人工標失敗(P7C15 刻意放行此出口,
--     理由=RW4 Record 差額為 0 的證據在 detail;plan §4-1)
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'INITIATED'
     FROM (SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-00000000000b'::uuid,
           'partial', 9, 30, NULL, 'rw1b b5', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b0f') AS r) t),
  'c54 前置 initiate 應 INITIATED');
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'HELD_AMOUNT_MISMATCH'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0f'),
           'accepted', 'DRB9', 8, NULL, 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b10') AS r) t),
  'c54 前置 hold 應 HELD_AMOUNT_MISMATCH');
SELECT pg_temp.assert(
  (SELECT r->>'result' = 'FINALIZED' AND r->>'status_after' = 'failed'
     FROM (SELECT public.admin_finalize_order_refund(
           (SELECT id FROM public.order_refunds WHERE request_id = 'cc000000-0000-4000-8000-000000000b0f'),
           'manual_failed', NULL, NULL, 'Record delta=0(before=30, now=30)', 'rw1b_tester',
           'cc000000-0000-4000-8000-000000000b11') AS r) t),
  'c54 manual_failed 應 FINALIZED+failed');
SELECT pg_temp.assert(
  (SELECT failed_reason = 'manual_failed' FROM public.order_refunds
    WHERE request_id = 'cc000000-0000-4000-8000-000000000b0f'),
  'c54 failed_reason 應為 manual_failed');
SELECT pg_temp.cell('c54');

-- c55 remaining 總帳:B = 89 − confirmed(30);deferred/failed 全不佔
SELECT pg_temp.assert(
  public.pcm_order_refundable_remaining('0b000000-0000-4000-8000-00000000000b') = 59,
  'c55 remaining(B) 應為 59(89−30;deferred 與 failed 不佔)');
SELECT pg_temp.cell('c55');

-- ══ 稽核行為格(RW1a 檔頭承諾歸 RW1b 的那半)═══════════════════════════════════
-- c50 鍵形:initiate 恰 8 鍵、finalize 恰 6 鍵、reason 全 NULL、before 全 NULL、
--     hold 稽核第七值恰 2 筆(c19 + c54)、outcome 值域恰 7 種全出現
SELECT pg_temp.assert(
  (SELECT bool_and(
      (SELECT count(*) FROM jsonb_object_keys(a.after)) = 8
      AND a.after ?& ARRAY['order_id','refund_row_id','kind','refund_amount','rec_trade_id',
                           'bank_refund_id','record_refunded_before','request_id']
      AND a.reason IS NULL AND a.before IS NULL AND a.source_app = 'admin')
     FROM public.admin_audit_log a WHERE a.action = 'order_refund.initiate'
      AND a.request_id LIKE 'cc000000-%'),
  'c50 initiate 稽核鍵形不符(應恰 8 鍵 + reason/before NULL)');
SELECT pg_temp.assert(
  (SELECT bool_and(
      (SELECT count(*) FROM jsonb_object_keys(a.after)) = 6
      AND a.after ?& ARRAY['refund_row_id','outcome','tappay_refund_id',
                           'provider_refund_id_evidence','refund_amount_wire','request_id']
      AND a.reason IS NULL AND a.before IS NULL AND a.source_app = 'admin')
     FROM public.admin_audit_log a WHERE a.action = 'order_refund.finalize'
      AND a.request_id LIKE 'cc000000-%'),
  'c50 finalize 稽核鍵形不符(應恰 6 鍵 + reason/before NULL)');
SELECT pg_temp.assert(
  (SELECT count(*) = 2 FROM public.admin_audit_log
    WHERE action = 'order_refund.finalize' AND after->>'outcome' = 'accepted_amount_mismatch_hold'
      AND request_id LIKE 'cc000000-%'),
  'c50 hold 稽核第七值應恰 2 筆');
-- 🔴 集合相等、不是只數 7(codex K2 MF2:錯字 outcome 也能湊滿 7 個 distinct)
SELECT pg_temp.assert(
  (SELECT array_agg(DISTINCT after->>'outcome' ORDER BY after->>'outcome')
        = ARRAY['accepted','accepted_amount_mismatch_hold','deferred_not_captured',
                'manual_failed','not_sent','recovered_confirmed','rejected_out_of_range']
     FROM public.admin_audit_log
    WHERE action = 'order_refund.finalize' AND request_id LIKE 'cc000000-%'),
  'c50 finalize 稽核 outcome 值域應與七值全集逐字相等');
SELECT pg_temp.cell('c50');

-- c51 筆數:INITIATED 8 次(c01/c09/c13/c17/c29前置/c52/c53/c54)⇒ initiate 稽核恰 8;
--     finalize 稽核恰 10(c07/c10/c14/c19/c23/c30/c52/c53/c54-held/c54-manual);
--     業務碼短路(DUPLICATE/IN_FLIGHT/LEDGER_FULL/NOTHING_LEFT/NOT_FOUND)零稽核;
--     RAISE 格(c04/c05/c08/c16/c18/c20/c22/c29)零殘留稽核 —— 都被上兩數涵蓋。
SELECT pg_temp.assert(
  (SELECT count(*) FILTER (WHERE action = 'order_refund.initiate') = 8
      AND count(*) FILTER (WHERE action = 'order_refund.finalize') = 10
     FROM public.admin_audit_log
    WHERE action LIKE 'order_refund.%' AND request_id LIKE 'cc000000-%'),
  'c51 稽核筆數不符(initiate 應 8 / finalize 應 10;cc 前綴 scope —— barrier 走 ee 前綴)');
SELECT pg_temp.cell('c51');

ROLLBACK;
CELLS
}

run_cells() {  # $1=標籤
  build_cells
  local out n
  if ! out="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/cells.sql" 2>&1)"; then
    bad "行為格($1)psql 失敗:$(printf '%s\n' "$out" | grep -m2 -E 'ERROR|斷言失敗' | tr '\n' ' ' | cut -c1-220)"
    return 1
  fi
  n="$(printf '%s\n' "$out" | grep -c 'CELL-OK|')"
  if [ "$n" = "$EXPECT_CELLS" ]; then
    ok "行為格($1)$n/$EXPECT_CELLS 全綠(單一交易 ROLLBACK 零留痕)"
  else
    bad "行為格($1)CELL-OK $n 條,釘死值 $EXPECT_CELLS ⇒ 有格被刪或沒跑到"
  fi
}

EXPECT_CELLS=59   # 直呼 cell() 28 + expect_raise 30 + expect_red 1(含 codex MF3 補的 c56-c59)
log "2/9 行為格(59 格語意、$EXPECT_CELLS 個 CELL-OK;含 fixture 三釘 + N6 相容格 + 稽核行為格)"
run_cells "第一輪"

# 隔離閘(G8 前置):REPEATABLE READ 下 finalize 必 RAISE —— 獨立交易才能設隔離級
if out="$(psql "$URL" -v ON_ERROR_STOP=1 -q <<'SQL' 2>&1
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $iso$
BEGIN
  PERFORM public.admin_finalize_order_refund('0b000000-dead-4000-8000-000000000001'::uuid,
    'accepted', 'DRX', 5, NULL, 'rw1b_tester', 'cc000000-0000-4000-8000-0000000000ff');
  RAISE EXCEPTION 'RW1B-FAIL:RR 下 finalize 竟未被隔離閘擋下';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE '%READ COMMITTED%' THEN RAISE NOTICE 'CELL-OK|iso1';
  ELSE RAISE; END IF;
END $iso$;
ROLLBACK;
SQL
)"; then
  printf '%s\n' "$out" | grep -q 'CELL-OK|iso1' \
    && ok "隔離閘:REPEATABLE READ 下 finalize 準確 RAISE(P2B02 同型防護)" \
    || bad "隔離閘輸出無法判讀:$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
else
  bad "隔離閘格失敗:$(printf '%s\n' "$out" | grep -m1 ERROR | cut -c1-180)"
fi

# ══ 3. 直寫負測(新 DB 守門逐條紅對地方;檔案同時是 §4 突變的輸入)══════════════
log "3/9 直寫負測(n00 對照組 + n01-n16;committed fixture 訂單 N1/N2)"

# 負測用 committed 訂單(負測交易全 ROLLBACK ⇒ 只有這兩張訂單本身留下;收尾清點)
psql "$URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "負測 fixture 訂單佈設失敗"
INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, shipping_method_at_checkout, invoice,
  payment_channel, payment_status, tappay_rec_trade_id)
SELECT x.id::uuid, x.did, (SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1),
       '{"name":"RW1B-N","phone":"0900000000","line":"harness"}', 'general',
       x.amt, 0, x.amt, 'home', 'home', '{"type":"donate","donateCode":"123"}',
       'tappay', 'paid', x.rec
FROM (VALUES
  ('0b000000-0000-4000-8000-0000000000a1', 'BCDFH2', 67, 'RECRW1BN1'),
  ('0b000000-0000-4000-8000-0000000000a2', 'BCDFH3', 71, 'RECRW1BN2')
) AS x(id, did, amt, rec)
ON CONFLICT (id) DO NOTHING;
SQL

NEGDIR="$WORK/rw1b-neg"; rm -rf "$NEGDIR"; mkdir -p "$NEGDIR"

# 共用 seed:一列合法 processing 帳本列(N1;直寫通過全部 trigger = 合法 edge)
SEED_N1="INSERT INTO public.order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before)
VALUES ('aa000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000a1',
  'BRN1000000000000000A', 'RECRW1BN1', 23, 'processing', 'rw1b neg seed', 'rw1b_tester',
  'dd000000-0000-4000-8000-000000000001', 'partial', 0);"

# emit_neg <id> <expect_constraint> <expect_sqlstate> <attack SQL> [setup SQL]
# 形狀同 a7c-verify:setup 在 DO 之外(setup 自己失敗不得被誤判成「攻擊被擋」)
emit_neg() {
  local id="$1" expect="$2" state="$3" attack="$4" setup="${5:-}"
  cat > "$NEGDIR/neg-$id.sql" <<NEGSQL
BEGIN;
$setup
DO \$NEG\$
DECLARE v_c text; v_s text; v_caught boolean := false;
BEGIN
  BEGIN
    $attack
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME, v_s = RETURNED_SQLSTATE;
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE NOTICE 'NEG-OPEN $id';
  ELSIF v_c = '$expect' AND v_s = '$state' THEN
    RAISE NOTICE 'NEG-PASS $id';
  ELSE
    RAISE NOTICE 'NEG-OTHER $id — 紅在 [%|%],預期 [$expect|$state]', v_c, v_s;
  END IF;
END \$NEG\$;
ROLLBACK;
NEGSQL
}

# 🔴 刻意不含右括號 —— n10 要追加一欄(a7c-verify 的 INS_COLS 同型;含括號會讓追加欄語法錯)
INS_N2="INSERT INTO public.order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
  status, reason, actor, request_id, kind, record_refunded_before"

# n00 對照組:合法直寫必須「進得去」——外殼若把一切都判紅,這格會抓到
emit_neg n00 '(對照組不應紅)' 'XXXXX' \
"$INS_N2)
 VALUES ('aa000000-0000-4000-8000-0000000000f0', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2CONTROL000000000', 'RECRW1BN2', 11, 'processing', 'ctl', 'rw1b_tester',
   'dd000000-0000-4000-8000-0000000000f0', 'partial', 0);"

# n01 S1 kind CHECK
emit_neg n01 order_refunds_kind_check 23514 \
"$INS_N2)
 VALUES ('aa000000-0000-4000-8000-000000000011', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2000000000000000B', 'RECRW1BN2', 11, 'processing', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-000000000011', 'bogus', 0);"

# n02 S2 baseline 非負 CHECK
emit_neg n02 order_refunds_record_baseline_nonneg 23514 \
"$INS_N2)
 VALUES ('aa000000-0000-4000-8000-000000000012', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2000000000000000C', 'RECRW1BN2', 11, 'processing', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-000000000012', 'partial', -5);"

# n03 S3 形狀 CHECK(首寫含空白;UPDATE 路徑 —— INSERT 路徑被 3.6 擋在前面)
emit_neg n03 order_refunds_evidence_shape 23514 \
"UPDATE public.order_refunds SET provider_refund_id_evidence = 'a b'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

# n04 S7 長度 CHECK(轉 failed 同時塞 501 字)
emit_neg n04 order_refunds_failed_detail_len 23514 \
"UPDATE public.order_refunds
    SET status = 'failed', failed_reason = 'not_sent', failed_detail = repeat('x', 501)
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

# n05 S7 only_failed CHECK(processing 列塞 detail)
emit_neg n05 order_refunds_failed_detail_only_failed 23514 \
"UPDATE public.order_refunds SET failed_detail = 'x'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

# n06 S6 deferred_clean CHECK(deferred 列帶對帳碼)
emit_neg n06 order_refunds_deferred_clean 23514 \
"UPDATE public.order_refunds SET status = 'deferred', tappay_refund_id = 'DRX'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

# n07 S6 status CHECK 本體(三支 trigger 交易內停用 ⇒ 證明 CHECK 獨立於 trigger 承重)
emit_neg n07 order_refunds_status_check 23514 \
"$INS_N2)
 VALUES ('aa000000-0000-4000-8000-000000000017', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2000000000000000D', 'RECRW1BN2', 11, 'exploded', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-000000000017', 'partial', 0);" \
"ALTER TABLE public.order_refunds DISABLE TRIGGER USER;"

# n08 S4 request_id 全域唯一(跨單同 token)
emit_neg n08 order_refunds_request_id_key 23505 \
"$INS_N2)
 VALUES ('aa000000-0000-4000-8000-000000000018', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2000000000000000E', 'RECRW1BN2', 11, 'processing', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-000000000001', 'partial', 0);" "$SEED_N1"

# n09 S5 single-flight(同單第二列 processing、不同 token)
emit_neg n09 order_refunds_single_processing_per_order 23505 \
"INSERT INTO public.order_refunds (id, order_id, bank_refund_id, rec_trade_id, refund_amount,
   status, reason, actor, request_id, kind, record_refunded_before)
 VALUES ('aa000000-0000-4000-8000-000000000019', '0b000000-0000-4000-8000-0000000000a1',
   'BRN1000000000000000F', 'RECRW1BN1', 7, 'processing', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-000000000019', 'partial', 0);" "$SEED_N1"

# n10 3.6 INSERT 證據必留空(P7C08 家族第二道;constraint 名可歸因)
emit_neg n10 a7c_insert_evidence_must_be_empty P7C08 \
"$INS_N2, provider_refund_id_evidence)
 VALUES ('aa000000-0000-4000-8000-00000000001a', '0b000000-0000-4000-8000-0000000000a2',
   'BRN2000000000000000G', 'RECRW1BN2', 11, 'processing', 'neg', 'rw1b_tester',
   'dd000000-0000-4000-8000-00000000001a', 'partial', 0, 'DRFORGED');"

# n11 4.7 證據 write-once(P7C12)
emit_neg n11 a7c_update_evidence_write_once P7C12 \
"UPDATE public.order_refunds SET provider_refund_id_evidence = 'DR2'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" \
"$SEED_N1
UPDATE public.order_refunds SET provider_refund_id_evidence = 'DR1'
 WHERE id = 'aa000000-0000-4000-8000-000000000001';"

# n12 4.8 confirmed 時證據與對帳碼一致(P7C13;直寫路徑 —— RPC 路徑由 c22 釘)
emit_neg n12 a7c_confirm_evidence_mismatch P7C13 \
"UPDATE public.order_refunds SET status = 'confirmed', tappay_refund_id = 'DRZ'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" \
"$SEED_N1
UPDATE public.order_refunds SET provider_refund_id_evidence = 'DR1'
 WHERE id = 'aa000000-0000-4000-8000-000000000001';"

# n13 4.9 failed_detail write-once(P7C14)
emit_neg n13 a7c_update_failed_detail_write_once P7C14 \
"UPDATE public.order_refunds SET failed_detail = 'b'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" \
"$SEED_N1
UPDATE public.order_refunds
   SET status = 'failed', failed_reason = 'not_sent', failed_detail = 'a'
 WHERE id = 'aa000000-0000-4000-8000-000000000001';"

# n14 4.10 hold 列不得走零動錢終態(P7C15;直寫路徑 —— RPC 5a 由 c20 釘,兩層各自可歸因)
emit_neg n14 a7c_hold_row_requires_recovery_exit P7C15 \
"UPDATE public.order_refunds SET status = 'deferred'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" \
"$SEED_N1
UPDATE public.order_refunds SET provider_refund_id_evidence = 'DR1'
 WHERE id = 'aa000000-0000-4000-8000-000000000001';"

# n15 4.2 擴列:kind 不可變(P7C05)
emit_neg n15 a7c_update_identity_columns_immutable P7C05 \
"UPDATE public.order_refunds SET kind = 'full'
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

# n16 4.2 擴列:record_refunded_before 不可變(P7C05;同守門第二案例,不重複突變)
emit_neg n16 a7c_update_identity_columns_immutable P7C05 \
"UPDATE public.order_refunds SET record_refunded_before = 999
  WHERE id = 'aa000000-0000-4000-8000-000000000001';" "$SEED_N1"

NEG_N=0
for f in "$NEGDIR"/neg-*.sql; do
  id="$(basename "$f" .sql)"; id="${id#neg-}"
  NEG_N=$((NEG_N + 1))
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)" || { bad "負測 $id psql 失敗:$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-160)"; continue; }
  if [ "$id" = "n00" ]; then
    printf '%s\n' "$out" | grep -q 'NEG-OPEN n00' \
      && ok "n00 對照組:合法直寫進得去(外殼不是恆紅)" \
      || bad "n00 對照組被擋:$(printf '%s' "$out" | grep -m1 'NEG-' | cut -c1-160)"
    continue
  fi
  case "$out" in
    *"NEG-PASS $id"*)  ok "負測 $id 紅對地方" ;;
    *"NEG-OPEN $id"*)  bad "負測 $id 攻擊完全沒被擋" ;;
    *NEG-OTHER*)       bad "負測 $id $(printf '%s\n' "$out" | grep -m1 'NEG-OTHER' | sed 's/^NOTICE:  //' | cut -c1-180)" ;;
    *)                 bad "負測 $id 無法判讀:$(printf '%s' "$out" | head -2 | tr '\n' ' ' | cut -c1-160)" ;;
  esac
done
EXPECT_NEG=17
[ "$NEG_N" = "$EXPECT_NEG" ] && ok "負測檔數 $NEG_N 符合釘死值" \
  || bad "負測檔數 $NEG_N ≠ $EXPECT_NEG ⇒ 覆蓋流失"

# ══ 4. 逐守門突變(15 具名守門 + 2 版本回退消融)═══════════════════════════════
# 🔴 覆蓋宣稱收窄(codex K2 nit):本段=15 個具名 DB 物件突變 + 2 個版本回退消融;
#    RPC 內部守門(G4/G5/G8/G11/G12/5a/5b)**未逐一消融**,由 §2 固定回傳碼/訊息格釘行為。
#    已知未測:G4 真併發同 token(步 8 unique_violation 重查驗分支;單 session 構造不出)、
#    5b「逾 30 分且無證據」的正向放行(created_at 受 P7C05 不可變保護、無法注入 —— RW4 片再測)。
log "4/9 突變證明(15 具名物件 + 2 消融;破壞後專屬負測必轉 NEG-OPEN;NOOP 自檢;零留痕)"

# 突變前置:MIG 內 constraint 名不得重複(重複 ⇒ 只換到第一個 RAISE、誤判死規則)
DUP="$(grep -o "CONSTRAINT = '[a-z0-9_]*'" "$MIG" | sort | uniq -d || true)"
[ -z "$DUP" ] || die "MIG 內 constraint 名重複,突變無法歸因:$(echo "$DUP" | tr '\n' ' ')"

mutate_fn_sql() {  # <constraint_id> —— 把該具名 RAISE 整句換成 NULL;(CREATE OR REPLACE 版)
  python3 - "$MIG" "$1" <<'PY'
import re, sys
mig, cid = sys.argv[1], sys.argv[2]
src = open(mig, encoding='utf-8').read()
blocks = [(m.start(), m.end(), m.group(0)) for m in
          re.finditer(r"CREATE OR REPLACE FUNCTION public\.[\s\S]*?\n\$\$;", src)]
target = None
for s, e, b in blocks:
    if ("CONSTRAINT = '%s'" % cid) in b:
        target = b; break
if not target:
    sys.stderr.write("找不到含 %s 的函式區塊\n" % cid); sys.exit(3)
key = "CONSTRAINT = '%s';" % cid
k = target.find(key)
rs = target.rfind("RAISE EXCEPTION", 0, k)
if k < 0 or rs < 0:
    sys.stderr.write("定位 %s 的 RAISE 失敗\n" % cid); sys.exit(3)
mutated = target[:rs] + "NULL;" + target[k + len(key):]
if mutated == target:
    sys.stderr.write("突變沒有改到任何字元\n"); sys.exit(3)
print(mutated)
PY
}
fn_of_cid() {  # <constraint_id> → 函式名
  python3 - "$MIG" "$1" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\n\$\$;", src):
    if ("CONSTRAINT = '%s'" % sys.argv[2]) in m.group(0):
        print(m.group(1)); sys.exit(0)
sys.exit(3)
PY
}
fingerprint() { q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$1'"; }

MUT_OPEN=0; MUT_BAD=0; MUT_N=0
run_mutation() {  # $1=neg id  $2=kind(constraint|index|function)  $3=物件名/constraint id
  local nid="$1" kind="$2" obj="$3" mut f out
  MUT_N=$((MUT_N + 1))
  case "$kind" in
    constraint)
      mut="ALTER TABLE public.order_refunds DROP CONSTRAINT $obj;
DO \$FP\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '$obj'
              AND conrelid = 'public.order_refunds'::regclass) THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$obj 沒被刪掉';
  END IF;
END \$FP\$;" ;;
    index)
      mut="DROP INDEX public.$obj;
DO \$FP\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname = '$obj') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$obj 沒被刪掉';
  END IF;
END \$FP\$;" ;;
    function)
      local fn before body
      fn="$(fn_of_cid "$obj")" || { bad "突變 $obj:抽不出所屬函式"; return; }
      before="$(fingerprint "$fn")"
      body="$(mutate_fn_sql "$obj")" || { bad "突變 $obj:產生突變 SQL 失敗"; return; }
      mut="$body
DO \$FP\$ DECLARE v text; BEGIN
  SELECT md5(prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='$fn';
  IF v = '$before' THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$obj 的突變沒改到函式本體(指紋未變)';
  END IF;
END \$FP\$;" ;;
  esac
  f="$NEGDIR/neg-$nid.sql"
  # ON_ERROR_STOP=1(R1 N5):突變語句自己失敗時交易轉 aborted、後面全是 25P02 噪音
  # ⇒ 停在第一個錯、rc 非零,下面用獨立訊息報「執行失敗」而不是誤導的「守門判定」。
  local rc
  out="$(psql "$URL" -q -v ON_ERROR_STOP=1 <<MUTSQL 2>&1
BEGIN;
$mut
$(sed -e '1{/^BEGIN;$/d;}' -e '${/^ROLLBACK;$/d;}' "$f")
ROLLBACK;
MUTSQL
)"; rc=$?
  if printf '%s\n' "$out" | grep -q 'MUTATION-NOOP'; then
    bad "突變 $obj($kind)沒真的套上 ⇒ 這格什麼都沒證明"; MUT_BAD=$((MUT_BAD + 1))
  elif [ "$rc" -ne 0 ]; then
    bad "突變 $obj($kind)執行失敗(rc=$rc,非守門判定):$(printf '%s\n' "$out" | grep -m1 ERROR | cut -c1-140)"
    MUT_BAD=$((MUT_BAD + 1))
  elif printf '%s\n' "$out" | grep -q "NEG-OPEN $nid"; then
    ok "突變 $obj($kind)→ $nid 轉 NEG-OPEN ⇒ 該守門承重"; MUT_OPEN=$((MUT_OPEN + 1))
  else
    bad "突變 $obj($kind)後 $nid 沒轉 OPEN(死規則或被別道接住,逐格看):$(printf '%s\n' "$out" | grep -m1 'NEG-' | cut -c1-160)"
    MUT_BAD=$((MUT_BAD + 1))
  fi
}

run_mutation n01 constraint order_refunds_kind_check
run_mutation n02 constraint order_refunds_record_baseline_nonneg
run_mutation n03 constraint order_refunds_evidence_shape
run_mutation n04 constraint order_refunds_failed_detail_len
run_mutation n05 constraint order_refunds_failed_detail_only_failed
run_mutation n06 constraint order_refunds_deferred_clean
run_mutation n07 constraint order_refunds_status_check
run_mutation n08 index order_refunds_request_id_key
run_mutation n09 index order_refunds_single_processing_per_order
run_mutation n10 function a7c_insert_evidence_must_be_empty
run_mutation n11 function a7c_update_evidence_write_once
run_mutation n12 function a7c_confirm_evidence_mismatch
run_mutation n13 function a7c_update_failed_detail_write_once
run_mutation n14 function a7c_hold_row_requires_recovery_exit
run_mutation n15 function a7c_update_identity_columns_immutable

# ── 消融①:狀態機「deferred 合法轉入」是 RW1a 的改版承重(回退到 20260725130100 舊版
#    ⇒ processing→deferred 必轉紅);同交易先證新版綠、再回退證紅 = 一格自帶判別力
extract_old_fn() {  # <file> <fnname>
  python3 - "$1" "$2" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r"CREATE OR REPLACE FUNCTION public\.%s\([^)]*\)[\s\S]*?\n\$\$;" % re.escape(sys.argv[2]), src)
if not m:
    sys.stderr.write("在 %s 找不到 %s\n" % (sys.argv[1], sys.argv[2])); sys.exit(3)
print(m.group(0))
PY
}
MUT_N=$((MUT_N + 1))
OLD_TRANS="$(extract_old_fn "$OLD_LEDGER" pcm_order_refund_status_transition)" || die "消融①:抽不出舊狀態機函式"
FP_TRANS="$(fingerprint pcm_order_refund_status_transition)"
out="$(psql "$URL" -q <<ABL1 2>&1
BEGIN;
$SEED_N1
SAVEPOINT s1;
UPDATE public.order_refunds SET status = 'deferred' WHERE id = 'aa000000-0000-4000-8000-000000000001';
DO \$A\$ BEGIN RAISE NOTICE 'ABL1-NEW-GREEN'; END \$A\$;
ROLLBACK TO SAVEPOINT s1;
$OLD_TRANS
DO \$FP\$ DECLARE v text; BEGIN
  SELECT md5(prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refund_status_transition';
  IF v = '$FP_TRANS' THEN RAISE EXCEPTION 'MUTATION-NOOP:舊版狀態機沒套上'; END IF;
END \$FP\$;
DO \$A\$ BEGIN
  UPDATE public.order_refunds SET status = 'deferred' WHERE id = 'aa000000-0000-4000-8000-000000000001';
  RAISE NOTICE 'ABL1-OLD-OPEN';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE '%狀態轉移非法%' THEN RAISE NOTICE 'ABL1-OLD-RED';
  ELSE RAISE; END IF;
END \$A\$;
ROLLBACK;
ABL1
)"
if printf '%s\n' "$out" | grep -q 'ABL1-NEW-GREEN' && printf '%s\n' "$out" | grep -q 'ABL1-OLD-RED'; then
  ok "消融①:新版狀態機放行 processing→deferred、回退舊版即紅 ⇒ S6 轉移改版承重"
  MUT_OPEN=$((MUT_OPEN + 1))
else
  bad "消融①判定失敗:$(printf '%s\n' "$out" | grep -m2 -E 'ABL1|ERROR|NOOP' | tr '\n' ' ' | cut -c1-200)"
  MUT_BAD=$((MUT_BAD + 1))
fi

# ── 消融②:remaining 的 allowlist(deferred 不佔額度)—— 回退 20260801120000 舊版
#    (<> 'failed')⇒ 同一列 deferred 開始佔額度、回傳值必變小
MUT_N=$((MUT_N + 1))
OLD_REMAIN="$(extract_old_fn "$OLD_GUARDS" pcm_order_refundable_remaining)" || die "消融②:抽不出舊 remaining 函式"
FP_REMAIN="$(fingerprint pcm_order_refundable_remaining)"
out="$(psql "$URL" -q <<ABL2 2>&1
BEGIN;
$SEED_N1
UPDATE public.order_refunds SET status = 'deferred' WHERE id = 'aa000000-0000-4000-8000-000000000001';
DO \$A\$ DECLARE v bigint; BEGIN
  SELECT public.pcm_order_refundable_remaining('0b000000-0000-4000-8000-0000000000a1') INTO v;
  IF v = 67 THEN RAISE NOTICE 'ABL2-NEW-67'; ELSE RAISE EXCEPTION 'ABL2:新版 remaining=%(應 67)', v; END IF;
END \$A\$;
$OLD_REMAIN
DO \$FP\$ DECLARE v text; BEGIN
  SELECT md5(prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refundable_remaining';
  IF v = '$FP_REMAIN' THEN RAISE EXCEPTION 'MUTATION-NOOP:舊版 remaining 沒套上'; END IF;
END \$FP\$;
DO \$A\$ DECLARE v bigint; BEGIN
  SELECT public.pcm_order_refundable_remaining('0b000000-0000-4000-8000-0000000000a1') INTO v;
  IF v = 44 THEN RAISE NOTICE 'ABL2-OLD-44'; ELSE RAISE EXCEPTION 'ABL2:舊版 remaining=%(應 44=67-23)', v; END IF;
END \$A\$;
ROLLBACK;
ABL2
)"
if printf '%s\n' "$out" | grep -q 'ABL2-NEW-67' && printf '%s\n' "$out" | grep -q 'ABL2-OLD-44'; then
  ok "消融②:deferred 列在新版不佔額度(67)、舊版佔(44)⇒ remaining allowlist 改版承重"
  MUT_OPEN=$((MUT_OPEN + 1))
else
  bad "消融②判定失敗:$(printf '%s\n' "$out" | grep -m2 -E 'ABL2|ERROR|NOOP' | tr '\n' ' ' | cut -c1-200)"
  MUT_BAD=$((MUT_BAD + 1))
fi

EXPECT_MUT=17
[ "$MUT_N" = "$EXPECT_MUT" ] && ok "突變/消融總數 $MUT_N 符合釘死值(乾淨轉綠 $MUT_OPEN / 異常 $MUT_BAD)" \
  || bad "突變/消融總數 $MUT_N ≠ $EXPECT_MUT ⇒ 覆蓋流失"

# ══ 5. 結構零漂移(突變與消融全部 ROLLBACK 後,catalog 必須一個 byte 沒變)══════════
log "5/9 結構零漂移"
snapshot "$WORK/struct-1.snap" "突變後"
cmp -s "$WORK/struct-0.snap" "$WORK/struct-1.snap" \
  && ok "突變/消融/負測之後結構指紋與基準一致" \
  || bad "結構漂移:突變沒被 ROLLBACK 乾淨(diff struct-0/struct-1)"

# ══ 6. G8 翻轉 × G12 barrier 交錯(plan RW1b 指定的唯一併發格)═══════════════════
# 本格的承重觀察 = ①pg_blocking_pids 綁定「擋住 B 的就是 A」+ ②B 解鎖後的回傳值
#   REFUND_LEDGER_FULL(= B 讀到 A 已 commit 的 refunded)。
# 世界線對照(**另兩條是未實測推論**,列出只為讀者定位、不當證據 —— R1 N2):
#   REFUND_IN_FLIGHT   ≈ B 沒等鎖(讀到 pre-commit 的 processing 列)
#   INITIATED          ≈ B 等了鎖卻讀到舊快照(paid)
# ⚠️ 「B 被擋」這個觀察可由 finalize 的 step4 鎖或 step7 UPDATE orders 供給,
#   本格不細分兩者(G1 鎖的單獨消融沒做);結論由回傳值扛,不由「有等鎖」扛。
log "6/9 併發交錯:session A 持鎖翻轉 refunded,session B 的 initiate 必須等鎖後被 G12 擋"

psql "$URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "barrier fixture 佈設失敗"
INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, shipping_method_at_checkout, invoice,
  payment_channel, payment_status, tappay_rec_trade_id)
SELECT '0b000000-0000-4000-8000-0000000000b1'::uuid, 'BCDFH4',
       (SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1),
       '{"name":"RW1B-G","phone":"0900000000","line":"harness"}', 'general',
       61, 0, 61, 'home', 'home', '{"type":"donate","donateCode":"123"}',
       'tappay', 'paid', 'RECRW1BG'
ON CONFLICT (id) DO NOTHING;
SQL
# barrier 用 ee 前綴 token(cells 的稽核計數格以 cc 前綴 scope —— barrier 的 committed
# 稽核不得污染 §7 第二輪的筆數斷言)
# 🔴 §6 會 committed 收案 ⇒ 同一 cluster 上 run 模式跑過一次就不能再跑 §6(R1 N4):
[ "$(q "SELECT count(*) FROM public.order_refunds WHERE request_id = 'ee000000-0000-4000-8000-000000000001'")" = "0" ] \
  || die "§6 已在本 cluster 跑過(ee…01 列已存在)—— run 模式不可重複 §6,重跑請用 all 重 provision"
GINIT="$(q "SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-0000000000b1'::uuid,
  'full', NULL, 0, 61, 'rw1b barrier', 'rw1b_tester', 'ee000000-0000-4000-8000-000000000001')->>'result'")"
[ "$GINIT" = "INITIATED" ] || die "barrier 前置 initiate 失敗:[$GINIT]"
ROWG="$(q "SELECT id FROM public.order_refunds WHERE request_id = 'ee000000-0000-4000-8000-000000000001'")"
[ -n "$ROWG" ] || die "barrier 前置:找不到退款列"

PA=""; PB=""
wait_idle() {  # $1=a|b
  local who="$1" i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name='rw1b_sess_${who}' LIMIT 1" 2>/dev/null)"
    case "$st" in idle|'idle in transaction') return 0 ;; esac
    sleep 0.25
  done
  die "barrier 逾時:session $who 30s 未回 idle(state=$st)"
}
wait_blocked_by() {  # waiter 必須 active + 等 Lock + pg_blocking_pids 恰含 blocker(判別力紀律)
  local waiter="$1" blocker="$2" i bpid n
  bpid="$(q "SELECT pid FROM pg_stat_activity WHERE application_name='rw1b_sess_${blocker}' LIMIT 1")"
  [ -n "$bpid" ] || { bad "barrier:找不到 blocker pid"; return 1; }
  for i in $(seq 1 120); do
    n="$(q "SELECT count(*) FROM pg_stat_activity w WHERE w.application_name='rw1b_sess_${waiter}' AND w.wait_event_type='Lock' AND pg_blocking_pids(w.pid) @> ARRAY[${bpid}::integer] AND cardinality(pg_blocking_pids(w.pid)) = 1")"
    [ "$n" = "1" ] && return 0
    sleep 0.25
  done
  bad "barrier 逾時:$waiter 未被 $blocker 擋住"
  return 1
}
rm -f "$WORK/rw1b-fa" "$WORK/rw1b-fb"; mkfifo "$WORK/rw1b-fa" "$WORK/rw1b-fb"
# die 路徑不留殭屍(R1 N6):trap 收兩個背景 psql(關 FIFO 寫端 ⇒ 讀端 EOF 自然退場,
# 再 TERM 補刀)—— 正常收尾後 PA/PB 清空,trap 變 no-op。
barrier_cleanup() {
  exec 3>&- 2>/dev/null || true; exec 4>&- 2>/dev/null || true
  [ -n "$PA" ] && kill "$PA" 2>/dev/null; [ -n "$PB" ] && kill "$PB" 2>/dev/null
  rm -f "$WORK/rw1b-fa" "$WORK/rw1b-fb"
}
trap barrier_cleanup EXIT
( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/rw1b-fa" > "$WORK/rw1b-outa.txt" 2>&1 ) & PA=$!
( psql "$BURL" -tA  -v ON_ERROR_STOP=0 -f "$WORK/rw1b-fb" > "$WORK/rw1b-outb.txt" 2>&1 ) & PB=$!
kill -0 "$PA" 2>/dev/null && kill -0 "$PB" 2>/dev/null \
  || die "barrier:背景 psql 沒起來(exec 開 FIFO 寫端會永久阻塞,先停)"
exec 3>"$WORK/rw1b-fa"; exec 4>"$WORK/rw1b-fb"
wait_idle a; wait_idle b
sa() { printf '%s\n' "$1" >&3; wait_idle a; }
sb_raw() { printf '%s\n' "$1" >&4; }

sa "BEGIN;"
# 🔴 finalize 這一步不能用 wait_idle 當 barrier(R1 N3:寫入 FIFO 後立刻輪詢可能讀到
#    前一句留下的 idle 態=陳舊狀態競態)⇒ 用 query 字面錨定:pg_stat_activity.query
#    顯示的是「最後完成的語句」,錨到 finalize 且 state=idle in transaction 才算執行完。
printf '%s\n' "SELECT public.admin_finalize_order_refund('${ROWG}'::uuid, 'accepted', 'DRG61', 61, NULL, 'rw1b_tester', 'ee000000-0000-4000-8000-000000000002')->>'result';" >&3
FIN_DONE=0
for i in $(seq 1 120); do
  [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name='rw1b_sess_a' AND state = 'idle in transaction' AND query LIKE '%admin_finalize_order_refund%'")" = "1" ] \
    && { FIN_DONE=1; break; }
  sleep 0.25
done
[ "$FIN_DONE" = "1" ] \
  && ok "barrier:A 的 finalize 已執行完畢且停在未提交交易(query 錨定,非陳舊狀態)" \
  || bad "barrier:A 的 finalize 30s 內未完成"
[ "$(q "SELECT status FROM public.order_refunds WHERE id = '${ROWG}'")" = "processing" ] \
  && ok "barrier:主連線仍看到 processing(A 的翻轉尚未 commit —— 待測窗口真的開著)" \
  || bad "barrier:主連線竟已看到 A 的未提交變更"
sb_raw "SELECT public.admin_initiate_order_refund('0b000000-0000-4000-8000-0000000000b1'::uuid, 'partial', 5, 61, NULL, 'rw1b barrier b', 'rw1b_tester', 'ee000000-0000-4000-8000-000000000003')->>'result';"
if wait_blocked_by b a; then
  ok "barrier:B 正在等 Lock 且 pg_blocking_pids(B) 恰含 A(擋住 B 的就是 A 的翻轉交易)"
fi
# (R1 MF1:原「B 在 A commit 前零輸出」一格已刪 —— psql 導檔 block-buffered,
#  空檔案近乎恆真、零判別力;「B 尚未返回」已由上面的 wait_blocked_by 蘊含。)
sa "COMMIT;"
wait_idle b
exec 3>&- 2>/dev/null || true; exec 4>&- 2>/dev/null || true
[ -n "$PA" ] && wait "$PA" 2>/dev/null; [ -n "$PB" ] && wait "$PB" 2>/dev/null; PA=""; PB=""
trap - EXIT
# 整行精確比對 + 兩檔零 ERROR(codex K2 MF4:substring grep 連 NOT_FINALIZED 都放行)
if grep -qx 'FINALIZED' "$WORK/rw1b-outa.txt" && ! grep -q 'ERROR' "$WORK/rw1b-outa.txt"; then
  ok "barrier:A 的 finalize 回傳恰 FINALIZED、零 SQL 錯誤(close 後驗字面)"
else
  bad "barrier:A 輸出非恰 FINALIZED 或含 ERROR:$(head -3 "$WORK/rw1b-outa.txt" | tr '\n' ' ')"
fi
if grep -qx 'REFUND_LEDGER_FULL' "$WORK/rw1b-outb.txt" && ! grep -q 'ERROR' "$WORK/rw1b-outb.txt"; then
  ok "barrier:B 解鎖後拿到恰 REFUND_LEDGER_FULL(等到翻轉 commit、G12 讀到 refunded)"
else
  bad "barrier:B 的結果不是恰 REFUND_LEDGER_FULL 或含 ERROR:$(head -2 "$WORK/rw1b-outb.txt" | tr '\n' ' ')(IN_FLIGHT≈沒等鎖;INITIATED≈讀到舊快照)"
fi
[ "$(q "SELECT payment_status::text FROM public.orders WHERE id = '0b000000-0000-4000-8000-0000000000b1'")" = "refunded" ] \
  && ok "barrier 收尾:訂單 G 已 refunded、confirmed 列與兩筆稽核為本段唯一 committed 留存(下方 §8 清點)" \
  || bad "barrier 收尾:訂單 G 狀態不對"
rm -f "$WORK/rw1b-fa" "$WORK/rw1b-fb"

# ══ 7. 兄弟 A→B→A 收尾 + 行為格重放 ═══════════════════════════════════════════
log "7/9 兄弟 A'(我方全套跑完後,a7c-verify.sh 必須仍然全綠)+ 行為格第二輪"
if A7C_VERIFY_PORT="$PORT" bash scripts/a7c-verify.sh "$WORK" > "$WORK/sibling-2.log" 2>&1 \
   && grep -q '🎉 全綠' "$WORK/sibling-2.log"; then
  ok "兄弟 A' 全綠 ⇒ 本 harness 對兄弟零污染(A→B→A 閉環)"
else
  bad "兄弟 A' 紅了(A→B→A 抓到污染;見 $WORK/sibling-2.log):$(tail -3 "$WORK/sibling-2.log" | tr '\n' ' ' | cut -c1-200)"
fi
run_cells "第二輪(兄弟與突變之後)"

# ══ 8. rollback 實跑(plan §6:REVOKE → DROP RPC ×2 → DROP INDEX ×2;帳本與稽核不動)══
log "8/9 rollback 實跑(整段在單一交易內,收尾 ROLLBACK 還原)"
REFUNDS_N="$(q 'SELECT count(*) FROM public.order_refunds')"
AUDIT_N="$(q "SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'order_refund.%'")"
out="$(psql "$URL" -q <<RB 2>&1
BEGIN;
REVOKE ALL ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.admin_finalize_order_refund(uuid, text, text, bigint, text, text, text) FROM service_role;
DROP FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text);
DROP FUNCTION public.admin_finalize_order_refund(uuid, text, text, bigint, text, text, text);
DROP INDEX public.order_refunds_request_id_key;
DROP INDEX public.order_refunds_single_processing_per_order;
DO \$RB\$
DECLARE v_c text; v_s text;
BEGIN
  IF to_regprocedure('public.admin_initiate_order_refund(uuid,text,integer,bigint,bigint,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'RB:RPC 沒刪乾淨';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname IN ('order_refunds_request_id_key','order_refunds_single_processing_per_order')) THEN
    RAISE EXCEPTION 'RB:index 沒刪乾淨';
  END IF;
  IF (SELECT count(*) FROM public.order_refunds) <> ${REFUNDS_N}
     OR (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'order_refund.%') <> ${AUDIT_N} THEN
    RAISE EXCEPTION 'RB:rollback 動到帳本或稽核(永不刪的那兩張)';
  END IF;
  -- 舊守門在 RPC 拆除後必須原地健在(forward-only 的底線):金額不可變 P7C04 實測一發
  BEGIN
    UPDATE public.order_refunds SET refund_amount = refund_amount + 1
     WHERE order_id = '0b000000-0000-4000-8000-0000000000b1';
    RAISE EXCEPTION 'RB:P7C04 竟未觸發';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME, v_s = RETURNED_SQLSTATE;
    IF v_c = 'a7c_update_money_columns_immutable' AND v_s = 'P7C04' THEN
      RAISE NOTICE 'RB-LEGACY-GUARD-OK';
    ELSE
      RAISE EXCEPTION 'RB:金額凍結紅錯地方 [%|%]', v_c, v_s;
    END IF;
  END;
  RAISE NOTICE 'RB-OK';
END \$RB\$;
ROLLBACK;
RB
)"
if printf '%s\n' "$out" | grep -q 'RB-OK' && printf '%s\n' "$out" | grep -q 'RB-LEGACY-GUARD-OK'; then
  ok "rollback 四物件可整組拆除、帳本/稽核零觸碰、舊守門(P7C04)原地健在"
else
  bad "rollback 實跑失敗:$(printf '%s\n' "$out" | grep -m2 -E 'ERROR|RB' | tr '\n' ' ' | cut -c1-220)"
fi
snapshot "$WORK/struct-2.snap" "rollback 還原後"
cmp -s "$WORK/struct-0.snap" "$WORK/struct-2.snap" \
  && ok "rollback 演練 ROLLBACK 後結構指紋回到基準" \
  || bad "rollback 演練留下結構漂移"

# ══ 9. 收尾:留存清點 + 總數釘死 ═══════════════════════════════════════════════
log "9/9 留存清點與總結"
# 本 harness 的 committed 留存 = 3 張 fixture 訂單(N1/N2/G)+ G 的 1 列 confirmed 帳本
# + G 的 2 筆稽核;其餘(§2 格 / §3 負測 / §4 突變 / §8 演練)全在 ROLLBACK 交易內。
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id IN ('BCDFH2','BCDFH3','BCDFH4')")" = "3" ] \
  && ok "留存清點:恰 3 張 harness 訂單(含 barrier 的 G)" || bad "留存清點:harness 訂單數不對"
[ "$(q "SELECT count(*) || '|' || coalesce(string_agg(DISTINCT status, ','), '-') FROM public.order_refunds")" = "1|confirmed" ] \
  && ok "留存清點:帳本恰 1 列 confirmed(barrier 的 G;格與負測零殘留)" \
  || bad "留存清點:order_refunds 殘留不符($(q 'SELECT count(*) FROM public.order_refunds') 列)"
[ "$(q "SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'order_refund.%'")" = "2" ] \
  && ok "留存清點:稽核恰 2 筆(barrier 的 initiate + finalize)" || bad "留存清點:稽核筆數不符"

# all 比 run 多 2 條(migrations 重放綠 + seed 已佈)。改動任何斷言時本區必須跟著改 ——
# 那正是它要擋的事(a7bt 數量閘同款:驗證面縮水的唯一症狀就是這個數字變小)。
# (R1 MF1 刪「B 零輸出」一格後 58/56 → 57/55。)
if [ "$MODE" = "all" ]; then EXPECT_PASS=57; else EXPECT_PASS=55; fi
if [ "$PASS" = "$EXPECT_PASS" ]; then
  printf '  ✅ 數量閘:通過斷言 %s 條,與釘死值相符\n' "$PASS"
else
  printf '  🔴 數量閘:通過斷言 %s 條,預期 %s ⇒ 驗證面漂移(改了斷言就同步改 EXPECT_PASS)\n' "$PASS" "$EXPECT_PASS"
  FAIL=$((FAIL + 1))
fi

echo
echo "════════ RW1b 驗收總結 ════════"
echo "  通過 $PASS / 失敗 $FAIL(突變+消融:$MUT_N 格、乾淨承重 $MUT_OPEN、異常 $MUT_BAD)"
[ "$FAIL" -eq 0 ] || exit 1
echo "  🎉 全綠"
