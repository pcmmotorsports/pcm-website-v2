#!/usr/bin/env bash
# ============================================================
# #452 片 2a-2「甲」harness —— 兩個相鄰 writer 的 voided 分流(行為證據)
# ============================================================
# 對應 = supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql
# plan  = docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md(C 案瘦身版 v3)§5.3(Q-P3=A)
#
# 🔴 **為什麼要另開一支,而不是塞進 452-verify.sh**:
#    兩支各自證明自己那一片。`452-verify.sh` 是 2a-1 的證明,不把 2a-2 的證明搬進去。
#    (2a-1 那支只改一格:B5 的期望值隨 Q-S1=A 從 UPDATED 變 CREATED,已同批改、註解釘了出處。)
#
# 🔴 **這支存在的理由是 codex 對抗審查的 must-fix**(2026-08-14 關卡2 R1):
#    migration 裡的字面錨**只是 tripwire**,它證明不了行為。
#    codex 明確示範了兩種繞法(把守門那行註解掉 / 整段被改回舊形狀),
#    字面錨在「剝註解」之後擋得住第一種,**第二種只有行為格擋得住**。
#    ⇒ 「錨全綠」不等於「功能對」。**行為證據在這裡。**
#
# 🔴 **每個突變格都必須先證明「這格紅的時候是誰讓它紅的」**:
#    本檔的做法 = 突變前先跑一次全部行為格(必須全綠),突變後再跑(必須有指定的格翻紅),
#    還原後再跑(必須回綠)。**三段都跑**,否則分不出「守門有效」與「這格根本恆紅」。
#
# 用法:  bash scripts/452b-verify.sh provision [/tmp/452b-work]
#         bash scripts/452b-verify.sh run       [/tmp/452b-work] [--keep]
# ============================================================
set -uo pipefail

MODE="${1:-run}"
WORK="${2:-/tmp/452b-work}"
KEEP="${3:-}"
PORT="${PORT:-54471}"
SOCK="${WORK}/sock"
URL="postgresql://postgres@/postgres?host=${SOCK}&port=${PORT}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$MODE" = "provision" ]; then
  # 直接沿用 2a-1 harness 的 provision(同一套 migrations,不重造)
  exec bash scripts/452-verify.sh provision "$WORK"
fi

PASS=0; FAIL=0
q() { psql "$URL" -tAX -c "$1" 2>&1; }

# ── 前提閘:沒有這兩樣,下面每一格的「綠」都沒有意義 ──────────
GUARD=$(q "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('admin_upsert_item_procurement','admin_record_item_receipt'))::text")
if [ "$GUARD" != "2" ]; then
  echo "🔴 前提閘:兩支 writer 應各恰 1 支(實 $GUARD)⇒ 停。庫沒 provision 或 migration 沒套上。"; exit 1
fi
# 🔴 比 'true' 不是 't':`boolean::text` 回的是 **'true'**,`psql` 直接印 boolean 才是 't'。
#    首版寫成 != "t" ⇒ 這道閘在**正確的庫上恆紅**(方向是 fail-closed 所以沒放行錯的東西,
#    但它會把對的擋掉、而且訊息說「甲沒套上」= 說謊)。實測時當場踩到,留著記。
# 🔴🔴 **兩段剝(先 `/* */` 再 `--`)—— 這是同一個錯的【第三輪】。**
#    R1 抓「沒剝註解」、R2 抓「只剝 `--` 沒剝 `/* */`」(我在 migration `:965-971` 自己寫下判詞),
#    而**這道前提閘我當時沒跟著改** ⇒ `code-reviewer` 2026-08-14 nit 2 抓到,對。
#    不修的話 `/* AND voided_at IS NULL */` 就能騙過這道閘 ⇒ 整個 harness 在沒套上甲片的庫上全綠。
if [ "$(q "SELECT (strpos(regexp_replace(regexp_replace(prosrc,'/\*.*?\*/','','gs'),'--[^'||chr(10)||']*','','g'),'AND voided_at IS NULL')>0)::text FROM pg_proc WHERE oid='public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'::regprocedure")" != "true" ]; then
  echo "🔴 前提閘:A5a 沒有 voided 分流 ⇒ 2a-2 甲沒套上,跑下去只是證明歷史。停。"; exit 1
fi

# 🔴 格數守門(`code-reviewer` nit 1;姊妹檔 `452-verify.sh:42-43,308-309` 有雙守、本檔原本零守)。
#    沒有它,**刪掉一整格**(例如 C3 或 C7)不會有任何紅 —— 其他格照樣全綠 ⇒ 零訊號。
EXPECTED_CELLS=9
EXPECTED_MUTS=2

# ══════════════════════════════════════════════════════════════
# 行為格。每格獨立交易 + ROLLBACK(零留痕);一律 IS DISTINCT FROM(NULL-safe)。
# 🔴 fixture 用【兩家供應商】:兄弟列撐著 ordered 才不會誤撞 C5
#    —— 單列 fixture 下「作廢一筆已收貨的採購」會當場 23514,那是 plan §2.2 預測的行為,
#       不是本片的守門。用錯 fixture 會把 C5 的紅誤讀成守門有效。
# ══════════════════════════════════════════════════════════════
behave() {
  local name="$1" body="$2" out
  out="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
DO \$b\$
DECLARE v_item uuid; v_a uuid; v_b uuid; v_ord uuid;
        v_r text; v_ok boolean; v_q bigint; v_p1 uuid; v_p2 uuid;
        v_snap jsonb; v_snap2 jsonb;
BEGIN
  SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
  SELECT id INTO v_a FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM public.suppliers WHERE is_active ORDER BY id OFFSET 1 LIMIT 1;
  IF v_ord IS NULL OR v_a IS NULL OR v_b IS NULL OR v_a = v_b THEN
    RAISE EXCEPTION '前提不足:取不到訂單或兩家【不同】的啟用供應商';
  END IF;
  v_item := gen_random_uuid();
  INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_item, v_ord, 'SKU-452B', '{"title":"零件","sku":"S1","spec":{"color":"black"}}'::jsonb, 20, 10, 200);
$body
END \$b\$;
ROLLBACK;
SQL
)"
  local tag="${name%% *}"          # 格名(C1 / C2 …),給「只紅哪一格」的判定用
  if printf '%s' "$out" | grep -qi 'ERROR'; then
    FAIL=$((FAIL+1)); RED_CELLS="$RED_CELLS$tag "
    printf '  FAIL %s\n       %s\n' "$name" "$(printf '%s' "$out" | grep -i -m1 ERROR | cut -c1-150)"
  else
    PASS=$((PASS+1)); printf '  ok   %s\n' "$name"
  fi
  CELL_COUNT=$((CELL_COUNT+1))
}

run_cells() {
  PASS=0; FAIL=0; RED_CELLS=""; CELL_COUNT=0

  behave "C1 A5a 對已作廢列重下單 = CREATED(Q-S1=A)" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL,NULL,NULL,NULL, 'staff_1','c1a', false);
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE order_item_id=v_item AND supplier_id=v_a;
    v_r := public.admin_upsert_item_procurement(v_item, v_a, 4, 'confirmed', 'email', NULL,NULL,NULL,NULL, 'staff_1','c1b', false);
    IF v_r IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'C1 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

  behave "C2 舊作廢列【逐欄未變】+ 新 active 列建起 + 摘要只算新列" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL,NULL,NULL,NULL, 'staff_1','c2a', false);
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE order_item_id=v_item AND supplier_id=v_a;
    -- 🔴 **真的逐欄**:整列 to_jsonb 快照,不是挑一兩個欄位比。
    --    舊版只比 allocated_quantity + 作廢狀態,卻在格名寫「逐欄未變」= 宣稱大於事實
    --    (codex R2 must-fix,對)。其他欄(reply_status / contact_channel / 時間戳…)被改壞不會紅。
    SELECT to_jsonb(p.*) INTO v_snap FROM public.order_item_procurement p
     WHERE p.order_item_id=v_item AND p.supplier_id=v_a AND p.voided_at IS NOT NULL;
    IF v_snap IS NULL THEN RAISE EXCEPTION 'C2-0 取不到作廢列快照'; END IF;
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 4, 'confirmed', 'email', NULL,NULL,NULL,NULL, 'staff_1','c2b', false);
    SELECT to_jsonb(p.*) INTO v_snap2 FROM public.order_item_procurement p
     WHERE p.order_item_id=v_item AND p.supplier_id=v_a AND p.voided_at IS NOT NULL;
    IF v_snap2 IS NULL THEN RAISE EXCEPTION 'C2-1 舊作廢列不見了'; END IF;
    IF v_snap2 IS DISTINCT FROM v_snap THEN
      RAISE EXCEPTION 'C2-1 舊作廢列【有欄位被動過】:前 % / 後 %', v_snap::text, v_snap2::text; END IF;
    SELECT allocated_quantity=4 INTO v_ok FROM public.order_item_procurement
     WHERE order_item_id=v_item AND supplier_id=v_a AND voided_at IS NULL;
    IF NOT FOUND OR v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'C2-2 新 active 列沒建起或量不對'; END IF;
    SELECT count(*) INTO v_q FROM public.order_item_procurement WHERE order_item_id=v_item AND supplier_id=v_a;
    IF v_q IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'C2-3 同鍵應共存 2 列,實 %', v_q; END IF;
    SELECT ordered_quantity=4 INTO v_ok FROM public.order_item_quantity_summary WHERE order_item_id=v_item;
    IF NOT FOUND OR v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'C2-4 摘要應只算新列'; END IF;"

  behave "C3 receipt 對【已作廢】採購登錄到貨 = PROCUREMENT_VOIDED" "
    v_r := public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c3a',false);
    SELECT id INTO v_p1 FROM public.order_item_procurement WHERE order_item_id=v_item AND supplier_id=v_a;
    PERFORM public.admin_upsert_item_procurement(v_item, v_b, 10, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c3b',false);
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE id=v_p1;
    v_r := public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c3c');
    IF v_r IS DISTINCT FROM 'PROCUREMENT_VOIDED' THEN RAISE EXCEPTION 'C3 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

  behave "C4 receipt 對【生效中】採購 = RECORDED(證明沒有誤擋 —— 收窄的反面)" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c4a',false);
    SELECT id INTO v_p1 FROM public.order_item_procurement WHERE order_item_id=v_item AND supplier_id=v_a;
    v_r := public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c4b');
    IF v_r IS DISTINCT FROM 'RECORDED' THEN RAISE EXCEPTION 'C4 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

  # 🔴 C5 是本檔最承重的一格:它證明「作廢守門排在冪等【之後】」。
  #    守門若被搬到冪等之前,C3/C4 照樣全綠,只有這一格會紅。
  #
  # 🔴🔴 **fixture 已改成【可達狀態】**(codex R3 must-fix,對):
  #    舊版用 `UPDATE … SET voided_at` 直接造出「**已有到貨卻已作廢**」——
  #    而那正是乙片的 `V7`(已有到貨不准作廢)**會擋掉**的狀態
  #    ⇒ 舊版在測一個乙片上線後**不存在**的世界(= 在不可達場景上做功)。
  #    改成走真實路徑:**登錄到貨 → 撤到貨 → 作廢 → 用原 request_id 重放**。
  #    這正是 plan §3.1 講的那條員工路徑,而且乙片上線後**仍然成立**。
  behave "C5 位置證明:登錄→撤到貨→作廢→【同】request_id 重放 = DUPLICATE_REQUEST" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c5a',false);
    SELECT id INTO v_p1 FROM public.order_item_procurement WHERE order_item_id=v_item AND supplier_id=v_a;
    PERFORM public.admin_upsert_item_procurement(v_item, v_b, 10, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c5b',false);
    v_r := public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c5c');
    IF v_r IS DISTINCT FROM 'RECORDED' THEN RAISE EXCEPTION 'C5 前置-登錄失敗 [%]', COALESCE(v_r,'<NULL>'); END IF;
    SELECT id INTO v_p2 FROM public.order_item_procurement_receipts WHERE procurement_id=v_p1 LIMIT 1;
    IF v_p2 IS NULL THEN RAISE EXCEPTION 'C5 前置:取不到到貨列'; END IF;
    v_r := public.admin_delete_item_receipt(v_p2, 'staff_1', 'c5d');
    IF v_r IS DISTINCT FROM 'DELETED' THEN RAISE EXCEPTION 'C5 前置-撤到貨實得 [%]', COALESCE(v_r,'<NULL>'); END IF;
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE id=v_p1;
    v_r := public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c5c');
    IF v_r IS DISTINCT FROM 'DUPLICATE_REQUEST' THEN
      RAISE EXCEPTION 'C5 實得 [%] —— 期望 DUPLICATE_REQUEST。作廢守門被排到冪等【之前】了:員工撤完到貨拿同一個提交編號重按會永遠做不成', COALESCE(v_r,'<NULL>'); END IF;"

  # ══ 以下三格為 codex R3「缺什麼格」補上(2026-08-14)══
  behave "C7 供應商停用 × 已作廢 × 重下同家 = SUPPLIER_INACTIVE(不得把舊列的 no-op 語意套到新建)" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c7a',false);
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE order_item_id=v_item AND supplier_id=v_a;
    UPDATE public.suppliers SET is_active=false WHERE id=v_a;
    v_r := public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c7b',false);
    IF v_r IS DISTINCT FROM 'SUPPLIER_INACTIVE' THEN
      RAISE EXCEPTION 'C7 實得 [%] —— 期望 SUPPLIER_INACTIVE(走新建路徑必須過供應商閘)', COALESCE(v_r,'<NULL>'); END IF;
    SELECT count(*) INTO v_q FROM public.order_item_procurement WHERE order_item_id=v_item AND voided_at IS NULL;
    IF v_q IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'C7 竟建出了生效列(% 列)', v_q; END IF;"

  # 🔴 額度邊界 + 多品項隔離。fixture 的 quantity=20 太寬 ⇒ 本格自己建一個【剛好用滿】的品項。
  behave "C8 額度剛好用滿 × 作廢放出額度 × 多品項互不影響" "
    DECLARE v_item2 uuid := gen_random_uuid(); v_ord2 uuid;
    BEGIN
      SELECT order_id INTO v_ord2 FROM public.order_items WHERE id=v_item;
      INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
      VALUES (v_item2, v_ord2, 'SKU-452B2', '{\"title\":\"零件2\",\"sku\":\"S2\",\"spec\":{}}'::jsonb, 3, 10, 30);
      PERFORM public.admin_upsert_item_procurement(v_item2, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c8a',false);
      v_r := public.admin_upsert_item_procurement(v_item2, v_b, 1, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c8b',false);
      IF v_r IS DISTINCT FROM 'OVER_ALLOCATION' THEN
        RAISE EXCEPTION 'C8-1 額度已用滿時對另一家下單應 OVER_ALLOCATION,實得 [%]', COALESCE(v_r,'<NULL>'); END IF;
      UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x'
       WHERE order_item_id=v_item2 AND supplier_id=v_a;
      v_r := public.admin_upsert_item_procurement(v_item2, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c8c',false);
      IF v_r IS DISTINCT FROM 'CREATED' THEN
        RAISE EXCEPTION 'C8-2 作廢後重下【剛好用滿】的量應 CREATED,實得 [%]', COALESCE(v_r,'<NULL>'); END IF;
      v_r := public.admin_upsert_item_procurement(v_item2, v_b, 1, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c8d',false);
      IF v_r IS DISTINCT FROM 'OVER_ALLOCATION' THEN
        RAISE EXCEPTION 'C8-3 重下後額度應再度用滿,實得 [%]', COALESCE(v_r,'<NULL>'); END IF;
      SELECT ordered_quantity INTO v_q FROM public.order_item_quantity_summary WHERE order_item_id=v_item2;
      IF v_q IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'C8-4 品項2 摘要 ordered 應為 3,實 %', v_q; END IF;
      SELECT count(*) INTO v_q FROM public.order_item_quantity_summary WHERE order_item_id=v_item;
      IF v_q IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'C8-5 品項1 竟被品項2 的操作影響(摘要列數 %)', v_q; END IF;
    END;"

  # 🔴 稽核逐欄:A13 只數 INSERT 次數 ⇒ 寫錯 target / before / after 全綠(codex R3 must-fix)
  behave "C9 稽核逐欄:走新建時 action/target/before/after 必須指向【新列】" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c9a',false);
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE order_item_id=v_item AND supplier_id=v_a;
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 7, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c9b',false);
    SELECT id INTO v_p1 FROM public.order_item_procurement
     WHERE order_item_id=v_item AND supplier_id=v_a AND voided_at IS NULL;
    SELECT (action='procurement.create'
            AND target='procurement:'||v_p1::text
            AND before IS NULL
            AND (after->>'allocated_quantity')='7'
            AND request_id='c9b'
            AND actor='staff_1'
            AND source_app='admin') INTO v_ok
      FROM public.admin_audit_log WHERE request_id='c9b';
    IF NOT FOUND THEN RAISE EXCEPTION 'C9 查無 request_id=c9b 的稽核列'; END IF;
    IF v_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'C9 稽核欄位不對(必須 action=procurement.create / target 指向【新列 id】/ before=NULL / after.allocated=7)'; END IF;"

  behave "C6 作廢後【新】request_id = PROCUREMENT_VOIDED(證明 C5 不是把守門整個關掉)" "
    PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c6a',false);
    SELECT id INTO v_p1 FROM public.order_item_procurement WHERE order_item_id=v_item AND supplier_id=v_a;
    PERFORM public.admin_upsert_item_procurement(v_item, v_b, 10, 'confirmed','email',NULL,NULL,NULL,NULL,'staff_1','c6b',false);
    PERFORM public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c6c');
    UPDATE public.order_item_procurement SET voided_at=now(), void_reason='x' WHERE id=v_p1;
    v_r := public.admin_record_item_receipt(v_p1, 1, 0, now(), NULL, 'staff_1', 'c6d');
    IF v_r IS DISTINCT FROM 'PROCUREMENT_VOIDED' THEN RAISE EXCEPTION 'C6 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"
}

# ══════════════════════════════════════════════════════════════
# 突變:改壞一個守門,期望【指定的格】翻紅。
#   做法 = 讀現行定義 → 字串替換 → EXECUTE 重建;還原用事前快照。
#   🔴 快照/還原都在 SQL 內完成,不依賴外部檔 ⇒ 中途失敗也還原得回來。
# ══════════════════════════════════════════════════════════════
snapshot() { q "SELECT pg_get_functiondef('$1'::regprocedure)" ; }
restore_fn() { psql "$URL" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null 2>&1; }

MUT_BAD=0   # 🔴 突變存活 / 突變沒套上的累計數。**它決定 exit code。**

# 🔴 **錨點與替換字串一律走 psql 變數(`-v` + `-f`),不做字串內插。**
#    首版用 `-c "… '$2' …"` 內插 ⇒ **錨點裡的單引號會提前關掉 SQL 字面**
#    (C8/C9 的錨點含 `'OVER_ALLOCATION'` / `'procurement.create'` ⇒ 當場語法錯,
#     而 C7 沒引號所以「看起來成功」⇒ **一半假通過、一半真失敗**,最毒的組合)。
# ⚠️ `:'var'` 代換**只在 `-f` 生效、`-c` 不生效**
#    (memory `reference_measure-tool-dialect-and-silence-traps`)⇒ 必須寫檔再 `-f`。
cat > "$WORK/mutate.sql" <<'MUTSQL'
-- 🔴 值必須在【dollar-quote 之外】交給 SQL:psql 的 :'var' 代換
--    ①只在 -f 生效(-c 不生效)②**不會進入 $$ … $$ 內部**。
--    首版把 :'sig' 寫在 DO $m$ 裡面 ⇒ 三發全部「syntax error at or near :」= 突變一發都沒套上,
--    而外層若只看「有沒有紅」會把它讀成「守門很強」。⇒ 用 set_config 送進去、用 current_setting 取。
SELECT set_config('mut.sig',  :'sig',  false);
SELECT set_config('mut.from', :'from', false);
SELECT set_config('mut.to',   :'to',   false);
DO $m$
DECLARE v text; n integer; v_from text; v_to text;
BEGIN
  v_from := pg_catalog.current_setting('mut.from');
  v_to   := pg_catalog.current_setting('mut.to');
  SELECT pg_get_functiondef(pg_catalog.current_setting('mut.sig')::regprocedure) INTO v;
  -- 🔴 恰 1 次,不是「存在就好」(code-reviewer nit 3)。命中 2 次 ⇒ replace 一次改兩處
  --    ⇒ 突變體不是我以為的那個,而後面的紅會被當成「守門有效」的證據。
  -- 🔴 用【長度差】數不用 regexp_matches:錨點含 ( ) . 等字元,當 regex 會被誤解析(錯得靜默)。
  n := (pg_catalog.length(v) - pg_catalog.length(pg_catalog.replace(v, v_from, '')))
       / pg_catalog.length(v_from);
  IF n <> 1 THEN
    RAISE EXCEPTION '突變錨點命中 % 次(須恰 1)—— 突變沒套上或套到多處,下面的綠沒有意義', n;
  END IF;
  EXECUTE pg_catalog.replace(v, v_from, v_to);
END
$m$;
MUTSQL

mutate() { # $1=signature $2=from $3=to
  local out rc
  out="$(psql "$URL" -tAX -v ON_ERROR_STOP=1 \
          -v sig="$1" -v from="$2" -v to="$3" -f "$WORK/mutate.sql" 2>&1)"
  rc=$?
  # 🔴 **看 psql 的 exit code,不是只 grep 'ERROR'**(codex R2 must-fix,對):
  #    連線失敗之類的訊息不含 'ERROR' 字樣 ⇒ 舊寫法會落到 return 0
  #    ⇒ 「突變沒套上」被當成「突變已套上」⇒ 後面的全綠變成**假的突變被殺**。
  if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qi 'ERROR'; then
    printf '   🔴 突變【沒套上】:%s\n' "$(printf '%s' "$out" | head -2 | tr '\n' ' ' | cut -c1-160)"
    MUT_BAD=$((MUT_BAD+1)); return 1
  fi
  return 0
}

A5A_SIG='public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)'
RCP_SIG='public.admin_record_item_receipt(uuid,integer,integer,timestamptz,text,text,text)'

echo "══ 1. 基準線(突變前必須全綠,否則突變的紅沒有判別力)═══════"
run_cells
BASE_PASS=$PASS; BASE_FAIL=$FAIL
echo "   基準線:綠 $BASE_PASS / 紅 $BASE_FAIL / 實跑格數 $CELL_COUNT(宣告 $EXPECTED_CELLS)"
if [ "$BASE_FAIL" -ne 0 ]; then
  echo "🔴 基準線就有紅格 ⇒ 停。突變測試在這個狀態下讀不出東西。"; exit 1
fi
# 🔴 格數守門:少一格 = 有人刪了整格,而**刪格是不會有任何紅的**(其他格照樣綠)。
if [ "$CELL_COUNT" -ne "$EXPECTED_CELLS" ]; then
  echo "🔴 實跑格數 $CELL_COUNT ≠ 宣告 $EXPECTED_CELLS ⇒ 有格被刪或新增而沒更新 EXPECTED_CELLS。停。"; exit 1
fi

mkdir -p "$WORK/snap"
snapshot "$A5A_SIG" > "$WORK/snap/a5a.sql"; echo ";" >> "$WORK/snap/a5a.sql"
snapshot "$RCP_SIG" > "$WORK/snap/rcp.sql"; echo ";" >> "$WORK/snap/rcp.sql"
# 🔴 快照必須非空,否則「還原」會是 no-op、突變體留在庫裡而沒人發現
for f in "$WORK/snap/a5a.sql" "$WORK/snap/rcp.sql"; do
  [ "$(wc -c < "$f")" -gt 200 ] || { echo "🔴 快照 $f 太小 ⇒ 抓不到定義,不敢突變。停。"; exit 1; }
done

# 🔴 **中斷也要還原**(codex R2 must-fix,對):突變寫進真的庫,
#    Ctrl-C / 被 kill 的話,沒有 trap 就會把突變體留在庫裡,
#    而下一個人跑 harness 會看到莫名其妙的紅、或更糟 —— 拿突變體當基準線。
restore_all() {
  restore_fn "$WORK/snap/a5a.sql" 2>/dev/null || true
  restore_fn "$WORK/snap/rcp.sql" 2>/dev/null || true
}
trap 'echo ""; echo "⚠️ 中斷 —— 正在把兩支函式還原回快照"; restore_all' INT TERM

echo ""
echo "══ 2. MUT-A5a:拿掉 A5a 的 voided 分流 ═════════════════════"
echo "   期望翻紅 = C1 / C2(對已作廢列會回 UPDATED、而且會改到那筆作廢列)"
# 🔴 錨點必須**唯一**:`AND voided_at IS NULL` 在 functiondef 出現 **2 次** ——
#    一次是程式,一次是我自己寫的 MF-1 更正註解裡**引用**了它。
#    nit 3 那道「恰 1 次」守門第一次跑就攔到這件事(否則 replace 會把註解也改掉)。
#    ⇒ 改用帶前一行的多行錨,那組合只出現在程式裡。
if mutate "$A5A_SIG" "$(printf '       AND supplier_id   = p_supplier_id\n       AND voided_at IS NULL')" "$(printf '       AND supplier_id   = p_supplier_id\n       AND true')"; then
  run_cells
  echo "   突變後:綠 $PASS / 紅 $FAIL"
  if [ "$FAIL" -eq 0 ]; then
    echo "   🔴🔴 突變存活 —— 拿掉分流竟然沒有任何格翻紅 = 這些格對 A5a 的分流【零覆蓋】"
    MUT_BAD=$((MUT_BAD+1))
  else
    echo "   ✅ 突變被殺"
  fi
fi
restore_fn "$WORK/snap/a5a.sql"

echo ""
echo "══ 3. MUT-RCPT:拿掉 receipt 的作廢分流 ════════════════════"
echo "   期望翻紅 = C3 / C6。🔴 注意 fixture 有兄弟列撐著 ordered ⇒ C5 不會發作"
echo "      ⇒ 沒有守門時是【靜默成功】(到貨掛在已作廢的採購上),不是報錯。"
echo "      判準是「回了 RECORDED 而不是 PROCUREMENT_VOIDED」,不是「有沒有 error」。"
if mutate "$RCP_SIG" 'IF v_proc.voided_at IS NOT NULL THEN' 'IF false THEN'; then
  run_cells
  echo "   突變後:綠 $PASS / 紅 $FAIL"
  if [ "$FAIL" -eq 0 ]; then
    echo "   🔴🔴 突變存活 —— 已作廢列可以收貨而沒有任何格翻紅"
    MUT_BAD=$((MUT_BAD+1))
  else
    echo "   ✅ 突變被殺"
  fi
fi
restore_fn "$WORK/snap/rcp.sql"

echo ""
echo "══ 3b. 定向突變:每發只准紅【一格】═══════════════════════"
# 🔴 `code-reviewer` 2026-08-14 指出:C7/C8/C9 的判別力目前是**論證**不是**量到** ——
#    MUT-A5a 一次紅五格,證不了「C7 有它自己的判別力」(可能只是被 C1/C2 蘊含)。
#    ⇒ 每格配一發**只打它那道守門**的突變,期望**恰好只有它紅**。
targeted() { # $1=格名 $2=簽章 $3=from $4=to
  local name="$1" sig="$2"
  if ! mutate "$sig" "$3" "$4"; then echo "   🔴 $name 定向突變沒套上"; return; fi
  run_cells > /dev/null 2>&1
  local reds; reds="$(echo "$RED_CELLS" | xargs)"
  if [ "$reds" = "$name" ]; then
    echo "   ✅ $name:恰好只有它翻紅"
  else
    echo "   🔴 $name:期望只紅 [$name],實紅 [$reds] ⇒ 判別力不獨立(或該格恆綠)"
    MUT_BAD=$((MUT_BAD+1))
  fi
  restore_fn "$WORK/snap/a5a.sql"
}
targeted "C7" "$A5A_SIG" \
  'IF (NOT v_exists) OR (p_allocated_quantity > v_before.allocated_quantity) THEN' \
  'IF false THEN'
# 🔴 C8 的錨點要用【多行版】:`RETURN 'OVER_ALLOCATION';` 在 A5a 出現 **2 次**
#    (UPDATE 路徑與 INSERT 路徑各一)⇒ 單行錨會一次改掉兩處。
#    這是 nit 3 那道「恰 1 次」守門當場擋下來的 —— 它不是裝飾,第一次跑就攔到了。
targeted "C8" "$A5A_SIG" \
  "$(printf "RETURN 'OVER_ALLOCATION';\n      WHEN unique_violation THEN")" \
  "$(printf "RETURN 'INVALID_INPUT';\n      WHEN unique_violation THEN")"
targeted "C9" "$A5A_SIG" \
  "CASE WHEN v_result = 'CREATED' THEN 'procurement.create' ELSE 'procurement.update' END" \
  "'procurement.update'"

echo ""
echo "══ 4. 還原確認(必須回到基準線,否則前面的紅是我自己弄壞的)═"
run_cells
echo "   還原後:綠 $PASS / 紅 $FAIL"
if [ "$PASS" -ne "$BASE_PASS" ] || [ "$FAIL" -ne 0 ]; then
  echo "🔴 還原後與基準線不一致 ⇒ 突變沒還原乾淨,本次結果不可信。"; exit 1
fi

trap - INT TERM

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 5. G8 併發首建(兩條真連線 rendezvous)═════════════════"
# 🔴 plan §5.2 明訂 G8「排進 2a-2」且**不得再列為誠實缺口** ——
#    兩個 psql + FIFO 就構造得出來,姊妹探針 `docs/probes/452-2a2-lockprobe.sh` 已經在用這個手法。
#    ⇒ 用「誠實缺口」豁免它,正是 memory `feedback_honest-gap-is-for-unconstructible-not-for-cheap`
#      禁止的那一手。**我上一版就是那樣寫的,這裡補回來。**
# 🔴 **不得用 heredoc 餵 psql**(codex #14 的教訓:連線讀到 EOF 就結束、交易回滾
#    ⇒ 根本沒測到 blocking)⇒ 用 FIFO 保持連線常開,由本腳本控制交錯。
G8W="$WORK/g8"; rm -rf "$G8W"; mkdir -p "$G8W"
G8FX=$(psql "$URL" -tAX -c "
  DO \$b\$
  DECLARE v_ord uuid; v_a uuid; v_item uuid := gen_random_uuid();
  BEGIN
    SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
    SELECT id INTO v_a FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
    CREATE TABLE IF NOT EXISTS public.g8_fx(item uuid, sup uuid);
    DELETE FROM public.g8_fx WHERE true;
    INSERT INTO public.g8_fx VALUES (v_item, v_a);
    INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
    VALUES (v_item, v_ord, 'SKU-G8', '{\"title\":\"零件\",\"sku\":\"S1\",\"spec\":{}}'::jsonb, 20, 10, 200);
  END \$b\$;" 2>&1)
printf '%s' "$G8FX" | grep -qi ERROR && { echo "  🔴 G8 fixture 失敗:$(printf '%s' "$G8FX" | grep -i -m1 ERROR)"; MUT_BAD=$((MUT_BAD+1)); }
G8ITEM=$(q "SELECT item::text FROM public.g8_fx"); G8SUP=$(q "SELECT sup::text FROM public.g8_fx")
if [ -n "$G8ITEM" ] && [ -n "$G8SUP" ]; then
  rm -f "$G8W/a.in" "$G8W/b.in"; mkfifo "$G8W/a.in" "$G8W/b.in"
  PGAPPNAME=g8A psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$G8W/a.in" > "$G8W/a.out" 2>&1 & G8A=$!
  PGAPPNAME=g8B psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$G8W/b.in" > "$G8W/b.out" 2>&1 & G8B=$!
  exec 7> "$G8W/a.in"; exec 8> "$G8W/b.in"; sleep 1
  CALL="SELECT public.admin_upsert_item_procurement('$G8ITEM','$G8SUP',3,'confirmed','email',NULL,NULL,NULL,NULL,'staff_1',"
  printf '%s\n' "BEGIN;" >&7; printf '%s\n' "${CALL}'g8a',false);" >&7
  sleep 2
  printf '%s\n' "BEGIN;" >&8; printf '%s\n' "${CALL}'g8b',false);" >&8   # B 應卡在 A 未提交的索引項上
  sleep 2
  W=$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name='g8B' AND wait_event_type='Lock'")
  printf '%s\n' "COMMIT;" >&7; sleep 2; printf '%s\n' "COMMIT;" >&8; sleep 2
  printf '\\q\n' >&7; printf '\\q\n' >&8; exec 7>&- ; exec 8>&-
  wait "$G8A" 2>/dev/null; wait "$G8B" 2>/dev/null
  G8ROWS=$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$G8ITEM' AND voided_at IS NULL")
  G8ERR=$(cat "$G8W/a.out" "$G8W/b.out" 2>/dev/null | grep -ci 'ERROR' || true)
  G8RES=$(grep -hoE 'CREATED|UPDATED|NO_CHANGE' "$G8W/a.out" "$G8W/b.out" 2>/dev/null | sort | tr '\n' ' ')
  echo "   B 曾卡在 Lock 的 session 數 = $W(期望 >=1:證明真的併發,不是先後跑)"
  # 🔴 期望值 = `CREATED NO_CHANGE`(排序後),**不是 CREATED + UPDATED**。
  #    我第一版把期望寫成 UPDATED,實得 NO_CHANGE,而**格子照樣綠**
  #    —— 因為通過條件裡根本沒有檢查這一項 ⇒ 印出來的「期望」只是裝飾。
  #    (這正是主視窗要我掃的「宣稱大於事實」,我在自掃時抓到自己。)
  #    為什麼是 NO_CHANGE:兩側送的是**完全相同的 payload** ⇒ 輸家重試圈讀到贏家已提交的同值列
  #    ⇒ A5a 步 11a 的同值 no-op 生效(零寫入、零稽核)。這才是正確行為。
  echo "   兩側回傳 = [$G8RES](期望 'CREATED NO_CHANGE ':同 payload ⇒ 輸家走重試圈後命中同值 no-op)"
  echo "   外露 ERROR 數 = $G8ERR(期望 0:23505 必須被 A5a 的重試圈吃掉,不得外露)"
  echo "   最終未作廢列數 = $G8ROWS(期望 1:partial unique index 真的擋住了雙列)"
  if [ "${W:-0}" -ge 1 ] && [ "$G8ERR" -eq 0 ] && [ "$G8ROWS" = "1" ] && [ "$G8RES" = "CREATED NO_CHANGE " ]; then
    echo "   ✅ G8 通過"
  else
    echo "   🔴 G8 FAIL —— 逐項對照上面四行(W=0 表示根本沒併發,那個綠是假的)"
    MUT_BAD=$((MUT_BAD+1))
  fi
  psql "$URL" -q -c "DELETE FROM public.order_item_procurement WHERE order_item_id='$G8ITEM'; DELETE FROM public.order_items WHERE id='$G8ITEM'; DROP TABLE IF EXISTS public.g8_fx;" >/dev/null 2>&1
fi

echo ""
echo "══ 判讀 ══════════════════════════════════════════════════"
echo "  基準線全綠 → 兩個突變各自被殺 → 還原回綠。三段都跑到才算數。"
echo "  ⚠️ 本檔只證【甲】(兩個相鄰 writer 的分流)。作廢 RPC 本身(乙)還沒寫,不在這裡。"
echo "  G8 併發首建:**已實作**(§5,兩條真連線 rendezvous)—— 不再是缺口。"
echo ""
echo "  MUT_BAD=$MUT_BAD(突變沒套上 + 突變存活的總數;必須為 0)"
# 🔴 **exit code 必須反映結果**(codex R2 must-fix,對):
#    舊版突變存活只印紅字就往下走、最後 exit 0
#    ⇒ 自動化(CI / 夜跑)會把「守門零覆蓋」讀成通過。**印給人看 ≠ 回給機器看。**
if [ "$MUT_BAD" -ne 0 ] || [ "$FAIL" -ne 0 ]; then
  echo "🔴 452b harness FAIL(MUT_BAD=$MUT_BAD / 最終紅格=$FAIL)"
  [ "$KEEP" = "--keep" ] || { LC_ALL=C pg_ctl -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1; rm -rf "$WORK"; }
  exit 1
fi
echo "✅ 452b harness 全綠"
if [ "$KEEP" = "--keep" ]; then
  echo "(--keep:庫留著 → pg_ctl -D $WORK/pgdata stop -m immediate && rm -rf $WORK)"
else
  LC_ALL=C pg_ctl -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1
  rm -rf "$WORK"
  echo "(拋棄式庫已拆:殘留目錄數 = $(ls -d "$WORK" 2>/dev/null | wc -l | tr -d ' '))"
fi
