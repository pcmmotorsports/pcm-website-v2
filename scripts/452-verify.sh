#!/usr/bin/env bash
# ============================================================
# #452 驗證 harness —— 採購作廢欄 + 兩處守門述詞(片 2a-1)
# ============================================================
# 規格 = docs/specs/2026-08-13-procurement-undo-plan.md v5
# migration = supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql
#
# 用法:
#   PORT=54455 bash scripts/452-verify.sh provision /tmp/452-work   # 建庫
#   PORT=54455 bash scripts/452-verify.sh run       /tmp/452-work   # 跑格(跑完自動拆庫)
#   PORT=54455 bash scripts/452-verify.sh run       /tmp/452-work --keep   # 跑完不拆(debug)
#
# 🔴 **`provision` 是唯一會 `rm -rf` 的子命令,而且它只肯刪「不存在」或「帶本 harness marker」的目錄**
#    (關卡2 M4:首版在檢查 marker **之前**就 rm ⇒ 傳錯路徑會刪掉別人的東西)。
#
# 🔴 **突變的判準是「重跑整張格表」**(關卡2 important):只跑一條另外寫的 boolean,
#    證不到「只有該紅的那格翻紅、零 collateral red」。本版每發突變都重跑全部格子並比對紅集合。
#
# ── 能驗什麼 / 不能驗什麼(誠實邊界)────────────────────────────────────────
#   ✅ 結構(欄集合/CHECK/索引/函式錨/proacl)、兩處新述詞的行為、「零 voided 列」現況、
#      **真的撞一次唯一索引並讀 CONSTRAINT_NAME**(B6)。
#   🔴 **不能驗**:併發首建撞 partial unique index(要兩個 session)⇒ 誠實缺口 G8,排 2a-2,
#      且照 codex #14 不得用 heredoc 寫那格(連線到 EOF 就結束、交易回滾 = 根本沒測到 blocking)。
#   🔴 **不能驗**:任何 void/unvoid RPC 的行為 —— 本片沒有那兩支,那是 2a-2 的範圍。
#   🔴 **P2 的作用域**(關卡2 important):它只證「三個應用 role 的**表級**寫權為零」,
#      **不等於「沒有 writer」** —— owner / SECDEF / 欄級 grant / cron 都不在這條查詢裡。
#      「沒有應用層 writer」的完整依據是 migration 檔頭那張五個寫入面的窮舉表。
# ============================================================
set -uo pipefail

MODE="${1:-run}"
WORK="${2:-/tmp/452-work}"
KEEP="${3:-}"
PORT="${PORT:-54455}"
SOCK="${WORK}/sock"
URL="postgresql://postgres@/postgres?host=${SOCK}&port=${PORT}"
MARKER="${WORK}/.452-harness"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PASS=0; FAIL=0; MUT=0; MUT_BAD=0
EXPECTED_CELLS=20
EXPECTED_MUT=6

q() { psql "$URL" -tAX -c "$1" 2>&1; }

# ══════════════════════════════════════════════════════════════════════════
# 格表:`名稱===SQL`(每條回 boolean)。**突變時整張表重跑**,所以只寫這一份。
# ══════════════════════════════════════════════════════════════════════════
CELLS=$(cat <<'GRID'
S1 兩個作廢欄存在且型別對===SELECT count(*)=2 FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped AND ((attname='voided_at' AND atttypid='timestamptz'::regtype) OR (attname='void_reason' AND atttypid='text'::regtype))
S2 欄位全集逐字凍結===SELECT string_agg(attname,',' ORDER BY attnum)='id,order_item_id,allocated_quantity,received_quantity,contact_channel,submitted_at,supplier_order_no,reply_status,exception_reason,expected_arrival_date,first_ordered_at,status_changed_at,created_at,supplier_id,supplier_order_no_upper,voided_at,void_reason' FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND attnum>0 AND NOT attisdropped
S3 配對 CHECK 定義逐字===SELECT pg_get_constraintdef(oid)='CHECK ((((voided_at IS NULL) = (void_reason IS NULL)) AND ((void_reason IS NULL) OR (NOT pcm_b2_is_blank(void_reason)))))' FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_void_pair'
S4 業務鍵已不在 pg_constraint===SELECT count(*)=0 FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_business_key'
S5 業務鍵索引定義逐字===SELECT pg_get_indexdef('public.order_item_procurement_business_key'::regclass)='CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_id) WHERE (voided_at IS NULL)'
S6 兩支函式 owner-secdef-proconfig 未被改掉===SELECT count(*)=2 FROM pg_proc p WHERE p.oid IN ('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure,'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure) AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND array_to_string(p.proconfig,',')='search_path=public, pg_temp,lock_timeout=5s'
S6b 兩支函式 proacl 恰為 owner 自己的 EXECUTE===SELECT count(*)=2 FROM pg_proc p WHERE p.oid IN ('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure,'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure) AND COALESCE(array_to_string(p.proacl,','),'<null>')='postgres=X/postgres'
S7 A4a 的 voided 述詞恰一次===SELECT (length(d)-length(replace(d,'voided_at IS NULL','')))/length('voided_at IS NULL')=1 FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t
S7b A2b1 的 voided 述詞恰一次===SELECT (length(d)-length(replace(d,'voided_at IS NULL','')))/length('voided_at IS NULL')=1 FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.pcm_a2b1_procurement_allocation_guard()'::regprocedure),'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t
S8 w7d3 錨 A1 鎖序===SELECT strpos(d,E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;')>0 AND strpos(d,E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;')<strpos(d,'INSERT INTO public.order_item_quantity_summary') FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t
S9 w7d3 錨 A2-A5 否定面===SELECT strpos(d,'FOR UPDATE')=0 AND strpos(d,'received_quantity')=0 FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t
S9b w7d3 錨 A4-A5-A6 肯定面===SELECT strpos(d,'FROM public.order_item_procurement_receipts r')>0 AND strpos(d,'ON CONFLICT (order_item_id) DO UPDATE')>0 AND strpos(d,'s.deleted_at IS NULL')>0 AND strpos(d,'s.shipped_at IS NOT NULL')>0 FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t
P1 全表零 voided 列===SELECT count(*)=0 FROM public.order_item_procurement WHERE voided_at IS NOT NULL
P2 三個應用 role 對本表零表級寫權===SELECT count(*)=0 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rn) CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(pv) WHERE has_table_privilege(r.rn,'public.order_item_procurement',p.pv)
GRID
)
# 🔴 P1 的定位:它是 **apply preflight 的一格**,不是事後證明。
#    它擋的是「有人手動塞了一筆」那個唯一還開著的口(見 migration 檔頭的五個寫入面窮舉表)。
#    **apply 前跑才有意義;apply 後跑只是證明歷史。**

grid_sql() {
  local first=1 out="" name sql esc
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="${line%%===*}"; sql="${line#*===}"; esc="${name//\'/\'\'}"
    [ $first -eq 1 ] && first=0 || out="$out UNION ALL "
    out="$out SELECT '$esc' AS n, (COALESCE(($sql),false))::text AS v"
  done <<< "$CELLS"
  printf '%s' "$out"
}
GRID_SQL="$(grid_sql)"

# ══ provision ═════════════════════════════════════════════════════════════
if [ "$MODE" = "provision" ]; then
  # 🔴 M4:marker 檢查在 rm 之前
  if [ -e "$WORK" ] && [ ! -f "$MARKER" ]; then
    echo "🔴 $WORK 已存在但沒有本 harness 的 marker($MARKER)⇒ 拒絕 rm -rf。"
    echo "   若確定要用這個路徑,請自己先刪,或換一個不存在的路徑。"; exit 1
  fi
  rm -rf "$WORK"; mkdir -p "$WORK" "$SOCK"; touch "$MARKER"
  initdb --version | grep -q ' 17\.' || { echo "🔴 PATH 的 initdb 非 PG17"; exit 1; }
  if psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    echo "🔴 port ${PORT} 已有別的 PostgreSQL 在聽 ⇒ 換 port"; exit 1
  fi
  LC_ALL=C initdb -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null
  LC_ALL=C pg_ctl -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${SOCK}'" start >/dev/null || { tail -20 "$WORK/pg.log"; exit 1; }
  sleep 2
  [ "$(q "SELECT current_setting('data_directory')")" = "$WORK/pgdata" ] || { echo "🔴 身分閘失敗"; exit 1; }
  psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql
  FF="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*|*20260809170000*) continue ;; esac
    [ "$f" = "$FF" ] && psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "🔴 migration 失敗:$f"; exit 1; }
  done
  ( cd /Users/sean_1/pcm-website-v2 && pnpm exec tsx scripts/d1t2-seed.ts ) > "$WORK/seed.sql"
  [ -s "$WORK/seed.sql" ] || { echo "🔴 seed 產不出來"; exit 1; }
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null
  echo "✅ provision 完成 —— 接著:PORT=${PORT} bash scripts/452-verify.sh run ${WORK}"
  exit 0
fi

# ══ run ═══════════════════════════════════════════════════════════════════
[ -f "$MARKER" ] || { echo "🔴 $WORK 缺 marker;先跑 provision"; exit 1; }
# 🔴 關卡2 important:首版「socket 活著就跳過 provision」⇒ 可能測到舊庫。
#    改成:run 先確認這個庫確實含本片產物,不含就叫人重 provision。
[ "$(q "SELECT count(*)=1 FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_void_pair'")" = "t" ] \
  || { echo "🔴 這個庫沒有本片的產物(migration 改過但沒重 provision?)⇒ 重跑 provision"; exit 1; }

teardown() {
  if [ "$KEEP" = "--keep" ]; then echo "(--keep:庫留著;自己拆 → pg_ctl -D $WORK/pgdata stop)"; return; fi
  LC_ALL=C pg_ctl -D "$WORK/pgdata" stop -m immediate >/dev/null 2>&1
  rm -rf "$WORK"
  echo "(拋棄式庫已拆:殘留目錄數 = $(ls -d "$WORK" 2>/dev/null | wc -l | tr -d ' '))"
}

echo "══ 1. 格表(結構 + 前提)════════════════════════════════════"
BASE_RED=""
while IFS='|' read -r n v; do
  [ -z "$n" ] && continue
  if [ "$v" = "true" ]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$n"
  else FAIL=$((FAIL+1)); BASE_RED="$BASE_RED$n;"; printf '  FAIL %s\n' "$n"; fi
done <<< "$(psql "$URL" -tAX -c "$GRID_SQL" 2>&1)"

echo "══ 2. 行為格(真 A5a;每格獨立交易、NULL-safe)══════════════"
# 🔴 關卡2 M3:首版用 `v_r <> '預期'`,RPC 回 NULL 時 IF 條件是 NULL ⇒ **不執行、仍印成功**。
#    那是「量具讀錯值」同族的第四個,方向最毒:前三個讓靶報失敗(看起來守門爛),
#    這個讓格子**印成功**(看起來守門好)。⇒ 一律 `IS DISTINCT FROM`,查列另外驗 FOUND。
behave() {
  local out
  out="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
DO \$b\$
DECLARE v_item uuid; v_a uuid; v_b uuid; v_r text; v_ord uuid; v_q bigint; v_con text; v_ok boolean;
BEGIN
  SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
  SELECT id INTO v_a FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM public.suppliers WHERE is_active ORDER BY id OFFSET 1 LIMIT 1;
  IF v_ord IS NULL OR v_a IS NULL OR v_b IS NULL OR v_a = v_b THEN
    RAISE EXCEPTION '前提不足:取不到訂單或兩家【不同】的啟用供應商';
  END IF;
  v_item := gen_random_uuid();
  INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_item, v_ord, 'SKU-452H', '{"title":"零件","sku":"S1","spec":{"color":"black"}}'::jsonb, 3, 10, 30);
$2
END \$b\$;
ROLLBACK;
SQL
)"
  if printf '%s' "$out" | grep -q 'ERROR'; then
    FAIL=$((FAIL+1)); printf '  FAIL %s —— %s\n' "$1" "$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-170)"
  else PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; fi
}

behave "B1 建採購(A 家 3 件)= CREATED" "
  v_r := public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b1', false);
  IF v_r IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'B1 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

behave "B2 額度滿時對 B 家建 3 件 = OVER_ALLOCATION(Sean 的痛點,負對照)" "
  PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b2a', false);
  v_r := public.admin_upsert_item_procurement(v_item, v_b, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b2b', false);
  IF v_r IS DISTINCT FROM 'OVER_ALLOCATION' THEN RAISE EXCEPTION 'B2 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

behave "B3 作廢 A 家後 ordered_quantity = 0(查不到摘要列也算紅)" "
  PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b3a', false);
  UPDATE public.order_item_procurement SET voided_at = now(), void_reason = 'key 錯供應商'
   WHERE order_item_id = v_item AND supplier_id = v_a;
  SELECT ordered_quantity INTO v_q FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'B3 查不到摘要列(這正是 NULL 假綠的來源)'; END IF;
  IF v_q IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'B3 實得 [%]', COALESCE(v_q::text,'<NULL>'); END IF;"

behave "B4 作廢後對 B 家建 3 件 = CREATED(額度真的放出來)" "
  PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b4a', false);
  UPDATE public.order_item_procurement SET voided_at = now(), void_reason = 'x'
   WHERE order_item_id = v_item AND supplier_id = v_a;
  v_r := public.admin_upsert_item_procurement(v_item, v_b, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b4b', false);
  IF v_r IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'B4 實得 [%]', COALESCE(v_r,'<NULL>'); END IF;"

# 🔴 B5 = plan §3-4 那張表的第⑤格。首版 plan 宣稱「harness 已觀察」,但腳本在 B4 就結束
#    (關卡2 抓到的字面 vs 事實)⇒ 補上,讓宣稱與腳本一致。
#
# 🔴🔴 **規格變更於 2a-2 甲(不是「把紅的格子調綠」)**
#   出處 = `docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md` §3.2
#        + `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql`
#   Sean 2026-08-14 拍 `Q-S1 = A`,逐字:「**當成全新的一筆收下來,舊的作廢紀錄留著查帳**」
#   ⇒ A5a 存在性查詢加 `AND voided_at IS NULL` ⇒ 已作廢列**視同不存在、走新建**
#   ⇒ 本格期望值 `UPDATED` → `CREATED`。
#   ⚠️ **舊註解預告的是「若 2a-2 改成【拒絕】」—— 那個方向沒有發生**,該預告是過期字面,已刪。
#      改期望值的正當性來自 Sean 的正式裁定,**不來自那句預告**(plan §3.2 R1 important 折)。
#   🔴 codex R1「條件式同意」的三格證明一併補齊:①舊列一個欄位都沒被動 ②新 active 列真的建起來
#      ③摘要 ordered_quantity 是新列的量。
behave "B5 對【已作廢的 A 家】再下單 = CREATED(Q-S1=A;規格變更於 2a-2 甲)" "
  PERFORM public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b5a', false);
  UPDATE public.order_item_procurement SET voided_at = now(), void_reason = 'x'
   WHERE order_item_id = v_item AND supplier_id = v_a;
  v_r := public.admin_upsert_item_procurement(v_item, v_a, 1, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b5b', false);
  IF v_r IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'B5 實得 [%](期望 CREATED;出處 = 2a-2 甲 + Sean Q-S1=A)', COALESCE(v_r,'<NULL>'); END IF;
  SELECT voided_at IS NOT NULL AND allocated_quantity = 3 INTO v_ok
    FROM public.order_item_procurement
   WHERE order_item_id = v_item AND supplier_id = v_a AND voided_at IS NOT NULL;
  IF NOT FOUND OR v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'B5-1 舊作廢列不見了、或被改動過(作廢紀錄必須原封留著查帳)'; END IF;
  SELECT allocated_quantity = 1 INTO v_ok FROM public.order_item_procurement
   WHERE order_item_id = v_item AND supplier_id = v_a AND voided_at IS NULL;
  IF NOT FOUND OR v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'B5-2 新的生效中列沒建起來、或量不對'; END IF;
  SELECT count(*) INTO v_q FROM public.order_item_procurement
   WHERE order_item_id = v_item AND supplier_id = v_a;
  IF v_q IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'B5-3 同鍵應共存 2 列(一作廢一生效),實 %', v_q; END IF;
  SELECT ordered_quantity = 1 INTO v_ok FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  IF NOT FOUND OR v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'B5-4 摘要 ordered_quantity 應等於新列的量(作廢列不得計入)'; END IF;"

# 🔴 B6:檔頭原本宣稱「驗到 unique-index 違規的 CONSTRAINT_NAME」但全檔沒有這格(字面 vs 事實)⇒ 真的撞一次。
behave "B6 真的撞一次唯一索引:CONSTRAINT_NAME 必須回索引名(A5a :435 的名字比對靠它)" "
  PERFORM public.admin_upsert_item_procurement(v_item, v_a, 1, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', 'b6a', false);
  BEGIN
    INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity, reply_status)
    VALUES (v_item, v_a, 1, 'confirmed');
    RAISE EXCEPTION 'B6 竟然沒撞鍵 ⇒ partial unique 沒生效';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN
      RAISE EXCEPTION 'B6 CONSTRAINT_NAME 回 [%] ⇒ A5a 的名字比對會失效', COALESCE(v_con,'<NULL>');
    END IF;
  END;
  UPDATE public.order_item_procurement SET voided_at = now(), void_reason = 'x'
   WHERE order_item_id = v_item AND supplier_id = v_a;
  INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity, reply_status)
  VALUES (v_item, v_a, 1, 'confirmed');"

echo "══ 3. 突變靶(每發重跑整張格表,比對「只有該紅的翻紅」)══════"
mut() { # $1=名稱 $2=突變SQL $3=期望翻紅的格名(分號結尾串接)
  MUT=$((MUT+1))
  local out red n v
  out="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
$2
SELECT '<APPLIED>' AS n, 'x' AS v;
$GRID_SQL;
ROLLBACK;
SQL
)"
  printf '%s' "$out" | grep -q '<APPLIED>' || {
    MUT_BAD=$((MUT_BAD+1)); printf '  MUT-BAD %s(突變本身沒套上:%s)\n' "$1" "$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-130)"; return; }
  red=""
  while IFS='|' read -r n v; do
    # 🔴 psql 會把 `BEGIN` / `ALTER TABLE` / `ROLLBACK` 這些 command tag 也印出來,
    #    它們**沒有 `|`** ⇒ `v` 會是空字串。首版沒濾掉 ⇒ 六發全部被誤判成 collateral red
    #    (畫面又長得像「守門全壞」——「量具讀錯值偽裝成守門失效」同族的第五個)。
    [ -z "$n" ] && continue
    [ -z "$v" ] && continue
    [ "$n" = "<APPLIED>" ] && continue
    [ "$v" = "true" ] || red="$red$n;"
  done <<< "$out"
  if [ "$red" = "$3" ]; then printf '  mut  %s ⇒ 恰好只有期望的那格翻紅 ✅\n' "$1"
  else MUT_BAD=$((MUT_BAD+1)); printf '  MUT-BAD %s\n        期望紅 [%s]\n        實際紅 [%s]\n' "$1" "$3" "$red"; fi
}

mut "M1 拿掉配對 CHECK" \
  "ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_void_pair;" \
  "S3 配對 CHECK 定義逐字;"
mut "M2 索引改成非 partial" \
  "DROP INDEX public.order_item_procurement_business_key;
   CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement (order_item_id, supplier_id);" \
  "S5 業務鍵索引定義逐字;"
mut "M3 多加一欄(名字取什麼都要抓到 —— 不是排除幾個猜到的名稱)" \
  "ALTER TABLE public.order_item_procurement ADD COLUMN void_actor text;" \
  "S2 欄位全集逐字凍結;"
mut "M4 給 service_role DELETE" \
  "GRANT DELETE ON public.order_item_procurement TO service_role;" \
  "P2 三個應用 role 對本表零表級寫權;"
mut "M5 給 A2b1 函式一個外部 grantee" \
  "GRANT EXECUTE ON FUNCTION public.pcm_a2b1_procurement_allocation_guard() TO service_role;" \
  "S6b 兩支函式 proacl 恰為 owner 自己的 EXECUTE;"
# 🔴 M6 = predicate-specific:只拔 A2b1 那一個述詞,其餘逐字不動。
#    (關卡2:首版把整支 helper 換成 no-op ⇒ S7/S8/S9b 會一起紅,歸因不成立。)
#    做法:取現行 functiondef、只 replace 那一段、EXECUTE 回去;並先斷言「真的換掉了」。
mut "M6 只拔掉 A2b1 的 voided 述詞(其餘逐字不動)" \
  "DO \$m\$
   DECLARE d text; d2 text;
   BEGIN
     d := pg_catalog.pg_get_functiondef('public.pcm_a2b1_procurement_allocation_guard()'::regprocedure);
     d2 := pg_catalog.replace(d,
             E'   WHERE p.order_item_id = NEW.order_item_id\n     AND p.voided_at IS NULL;',
             E'   WHERE p.order_item_id = NEW.order_item_id;');
     IF d2 = d THEN RAISE EXCEPTION 'M6 突變沒套上:找不到要拔的那一段'; END IF;
     EXECUTE d2;
   END \$m\$;" \
  "S7b A2b1 的 voided 述詞恰一次;"

echo "══ 收尾閘 ═══════════════════════════════════════════════════"
TOTAL=$((PASS+FAIL))
echo "PASS=$PASS FAIL=$FAIL 總格=$TOTAL(預期 $EXPECTED_CELLS)/ MUT=$MUT MUT_BAD=$MUT_BAD(預期靶 $EXPECTED_MUT)"
RC=0
[ "$FAIL" -eq 0 ]                  || { echo "🔴 有格紅:$BASE_RED"; RC=1; }
[ "$TOTAL" -eq "$EXPECTED_CELLS" ] || { echo "🔴 總格數不符 ⇒ 有格被刪或新增沒登記"; RC=1; }
[ "$MUT" -eq "$EXPECTED_MUT" ]     || { echo "🔴 突變靶數不符"; RC=1; }
[ "$MUT_BAD" -eq 0 ]               || { echo "🔴 有靶沒作用,或翻紅範圍不對(collateral red)"; RC=1; }
[ "$RC" -eq 0 ] && echo "✅ 452 harness 全綠"
teardown
exit $RC
