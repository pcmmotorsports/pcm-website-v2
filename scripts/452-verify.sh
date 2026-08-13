#!/usr/bin/env bash
# ============================================================
# #452 驗證 harness —— 採購作廢欄 + 兩處守門述詞(片 2a-1)
# ============================================================
# 規格 = docs/specs/2026-08-13-procurement-undo-plan.md v5
# migration = supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql
#
# 用法(port 自己挑,別跟其他窗撞):
#   PORT=54452 bash scripts/452-verify.sh /tmp/452-work
#
# 形狀照 scripts/352a2-verify.sh / a2b1-verify.sh:
#   身分閘 + 計數器 + 每格獨立 BEGIN…ROLLBACK 零留痕 + DB 內突變(先證突變真的套上了才談紅綠)。
#
# 🔴 本 harness **不建庫**。庫由本檔的 provision 子命令建(照 d1t2-rehearsal 的配方,
#    但不跑 seed 之外的東西);seed 由主樹產(本 worktree 無 node_modules)。
#
# ── 本片能驗什麼、不能驗什麼(誠實邊界,寫在最前面)────────────────────────────
#   ✅ 能驗:結構(欄/CHECK/索引/函式錨)、兩處新述詞的**行為**(額度釋放)、
#           「恆真」前提(零 voided 列 + 三 role 零寫權)、唯一索引違反的 CONSTRAINT_NAME 型別層行為。
#   🔴 **不能驗**:併發首建撞 partial unique index(要兩個 session,單一 DO 區塊構造不出來)
#           ⇒ 誠實缺口 G8,排進 2a-2 的 harness,且照 codex #14 不得用 heredoc 寫那格。
#   🔴 **不能驗**:任何「作廢之後 RPC 會怎樣」—— 本片沒有 void RPC,那是 2a-2 的範圍。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/452-work}"
PORT="${PORT:-54452}"
SOCK="${WORK}/sock"
URL="postgresql://postgres@/postgres?host=${SOCK}&port=${PORT}"
MIG="supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql"

PASS=0; FAIL=0; MUT=0; MUT_BAD=0
EXPECTED_TOTAL=16
EXPECTED_MUT=5

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── provision(可選子命令)──────────────────────────────────────────────────
if [ "${2:-}" = "provision" ] || [ ! -S "${SOCK}/.s.PGSQL.${PORT}" ]; then
  echo "══ provision:建拋棄式庫(PG17)══"
  rm -rf "$WORK"; mkdir -p "$WORK" "$SOCK"
  initdb --version | grep -q ' 17\.' || { echo "🔴 PATH 的 initdb 非 PG17"; exit 1; }
  # 🔴 先確認這個 port 沒有別的 cluster 在聽(d1t2-rehearsal :46-52 的實錘教訓:
  #    不檢查的話,後續 psql 會**靜默連到別的窗的庫**而毫無症狀)
  if psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1; then
    echo "🔴 port ${PORT} 已經有別的 PostgreSQL 在聽 ⇒ 換 port 重跑"; exit 1
  fi
  LC_ALL=C initdb -U postgres --auth=trust --locale=C --encoding=UTF8 -D "$WORK/pgdata" >/dev/null
  LC_ALL=C pg_ctl -D "$WORK/pgdata" -l "$WORK/pg.log" \
    -o "-p ${PORT} -c unix_socket_directories='${SOCK}'" start >/dev/null \
    || { tail -20 "$WORK/pg.log"; exit 1; }
  sleep 2
  # 身分閘:連到的就是我剛建的那台
  [ "$(q "SELECT current_setting('data_directory')")" = "$WORK/pgdata" ] \
    || { echo "🔴 身分閘:連到的不是我剛建的庫"; exit 1; }
  touch "$WORK/.452-harness"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql
  FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
  for f in supabase/migrations/*.sql; do
    case "$f" in *20260723120000*|*20260809170000*) continue ;; esac
    [ "$f" = "$FIRST_FITMENTS" ] && psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "🔴 migration 失敗:$f"; exit 1; }
  done
  # seed 由主樹產(本 worktree 無 node_modules);純 stdout、零寫檔
  ( cd /Users/sean_1/pcm-website-v2 && pnpm exec tsx scripts/d1t2-seed.ts ) > "$WORK/seed.sql"
  [ -s "$WORK/seed.sql" ] || { echo "🔴 seed 產不出來"; exit 1; }
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql" >/dev/null
  echo "provision 完成"
fi

[ -f "$WORK/.452-harness" ] || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }

echo "══ 1. 結構格 ═══════════════════════════════════════════════"

cell() { # $1=名稱 $2=SQL(回 't' 為通過)
  local r; r="$(q "$2")"
  [ "$r" = "t" ] && ok "$1" || bad "$1(實得 [$r])"
}

cell "S1 兩個作廢欄存在且型別對" \
  "SELECT count(*)=2 FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass
     AND NOT attisdropped AND (
       (attname='voided_at'   AND atttypid='timestamptz'::regtype) OR
       (attname='void_reason' AND atttypid='text'::regtype))"

cell "S2 🔴 只加兩欄(Sean 08-13「不要增加太多欄位」)—— voided_by 之類不得存在" \
  "SELECT count(*)=0 FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass
     AND NOT attisdropped AND attname IN ('voided_by','deleted_by','void_count','unvoided_at')"

cell "S3 配對 CHECK 定義逐字(兩欄同進同出 + 理由不得純空白)" \
  "SELECT pg_get_constraintdef(oid) = 'CHECK ((((voided_at IS NULL) = (void_reason IS NULL)) AND ((void_reason IS NULL) OR (NOT pcm_b2_is_blank(void_reason)))))'
     FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass
       AND conname='order_item_procurement_void_pair'"

cell "S4 業務鍵已不在 pg_constraint(換成索引的直接後果)" \
  "SELECT count(*)=0 FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass
     AND conname='order_item_procurement_business_key'"

cell "S5 業務鍵索引定義逐字(同名 + partial 述詞)" \
  "SELECT pg_get_indexdef('public.order_item_procurement_business_key'::regclass)
     = 'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_id) WHERE (voided_at IS NULL)'"

cell "S6 兩支函式的 owner/secdef/proconfig 未被 OR REPLACE 改掉" \
  "SELECT count(*)=2 FROM pg_proc p WHERE p.oid IN
     ('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure,
      'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure)
     AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
     AND array_to_string(p.proconfig,',')='search_path=public, pg_temp,lock_timeout=5s'"

cell "S7 A4a helper 的述詞恰一次(instock 軸刻意不加)" \
  "SELECT (length(d) - length(replace(d,'voided_at IS NULL',''))) / length('voided_at IS NULL') = 1
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef(
             'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),
             '/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t"

cell "S8 w7d3 錨 A1:鎖 order_items 那一整句仍在,且在 oiqs upsert 之前" \
  "SELECT strpos(d, E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;') > 0
      AND strpos(d, E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;')
        < strpos(d, 'INSERT INTO public.order_item_quantity_summary')
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef(
             'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),
             '/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t"

cell "S9 w7d3 錨 A2/A5:無 FOR UPDATE、無 received_quantity" \
  "SELECT strpos(d,'FOR UPDATE')=0 AND strpos(d,'received_quantity')=0
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef(
             'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),
             '/\*.*?\*/','','gs'),'--[^\n]*','','g') AS d) t"

echo "══ 2. 「恆真」前提格(主視窗指定:要被證明,不是被宣稱)═══════════"

cell "P1 全表零 voided 列" \
  "SELECT count(*)=0 FROM public.order_item_procurement WHERE voided_at IS NOT NULL"

cell "P2 三個應用 role 對本表零寫權 ⇒ 沒有 writer 能把它寫成非 NULL" \
  "SELECT count(*)=0 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rn)
     CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(pv)
     WHERE has_table_privilege(r.rn,'public.order_item_procurement',p.pv)"

echo "══ 3. 行為格(真 A5a 呼叫;每格 BEGIN…ROLLBACK 零留痕)══════════"

# 🔴 fixture 前提 fail-closed:suppliers 的 created_at 全同 ⇒ ORDER BY created_at **不是全序**
#    (本 harness 首版就敗在這裡:兩次取到同一家 ⇒ 第二格回 NO_CHANGE 而不是 OVER_ALLOCATION)。
#    ⇒ 一律 ORDER BY id,並斷言兩家不同。
BEHAVE=$(psql "$URL" -tAX <<'SQL' 2>&1
BEGIN;
DO $t$
DECLARE v_item uuid; v_a uuid; v_b uuid; v_r text; v_ord uuid; v_q bigint;
BEGIN
  SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
  SELECT id INTO v_a FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM public.suppliers WHERE is_active ORDER BY id OFFSET 1 LIMIT 1;
  IF v_ord IS NULL OR v_a IS NULL OR v_b IS NULL OR v_a = v_b THEN
    RAISE EXCEPTION 'B0 前提不足:訂單或兩家不同的啟用供應商取不到';
  END IF;
  RAISE NOTICE 'B0 fixture 前提成立(兩家供應商不同)';

  v_item := gen_random_uuid();
  INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_item, v_ord, 'SKU-452H', '{"title":"零件","sku":"S1","spec":{"color":"black"}}'::jsonb, 3, 10, 30);

  v_r := public.admin_upsert_item_procurement(v_item, v_a, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', '452h-a', false);
  IF v_r <> 'CREATED' THEN RAISE EXCEPTION 'B1 預期 CREATED 實得 %', v_r; END IF;
  RAISE NOTICE 'B1 建採購(A 家 3 件)= CREATED';

  v_r := public.admin_upsert_item_procurement(v_item, v_b, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', '452h-b', false);
  IF v_r <> 'OVER_ALLOCATION' THEN RAISE EXCEPTION 'B2 預期 OVER_ALLOCATION 實得 %', v_r; END IF;
  RAISE NOTICE 'B2 額度滿時對 B 家建 3 件 = OVER_ALLOCATION(Sean 的痛點,負對照)';

  -- 模擬 2a-2 的 void(本片沒有 writer ⇒ owner 直寫,只為驗下游語意)
  UPDATE public.order_item_procurement SET voided_at = now(), void_reason = 'key 錯供應商'
   WHERE order_item_id = v_item AND supplier_id = v_a;
  SELECT ordered_quantity INTO v_q FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  IF v_q <> 0 THEN RAISE EXCEPTION 'B3 作廢後 ordered_quantity 預期 0 實得 %', v_q; END IF;
  RAISE NOTICE 'B3 作廢 A 家後 ordered_quantity = 0(A4a 述詞生效)';

  v_r := public.admin_upsert_item_procurement(v_item, v_b, 3, 'confirmed', 'email', NULL, NULL, NULL, NULL, 'staff_1', '452h-c', false);
  IF v_r <> 'CREATED' THEN RAISE EXCEPTION 'B4 預期 CREATED 實得 %(A2b1 述詞沒生效)', v_r; END IF;
  RAISE NOTICE 'B4 作廢後對 B 家建 3 件 = CREATED(額度真的放出來了)';
END $t$;
ROLLBACK;
SQL
)
for k in B0 B1 B2 B3 B4; do
  printf '%s\n' "$BEHAVE" | grep -q "NOTICE:  $k " && ok "$k $(printf '%s\n' "$BEHAVE" | grep "NOTICE:  $k " | sed 's/^NOTICE:  //')" || bad "$k 沒通過:$(printf '%s\n' "$BEHAVE" | grep -m1 ERROR)"
done

echo "══ 4. 突變靶(先證突變真的套上了,才談紅綠)═════════════════"

mut() { # $1=名稱 $2=突變SQL $3=應翻紅的判準SQL(回 't' 表示「仍然通過」=靶沒作用)
  local applied still
  applied="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
$2
-- 正面斷言:突變真的套上了(不是 ALTER 靜默沒生效)
SELECT '<APPLIED>';
SELECT ($3)::text;
ROLLBACK;
SQL
)"
  MUT=$((MUT+1))
  if ! printf '%s\n' "$applied" | grep -q '<APPLIED>'; then
    MUT_BAD=$((MUT_BAD+1)); printf '  MUT-BAD %s(突變本身沒套上:%s)\n' "$1" "$(printf '%s\n' "$applied" | grep -m1 ERROR)"
    return
  fi
  # 🔴 不能用 tail -1 —— 最後一行是 psql 印的 ROLLBACK。取 <APPLIED> 之後的第一行非空輸出。
  still="$(printf '%s\n' "$applied" | sed -n '/<APPLIED>/{n;p;}' | head -1 | tr -d '[:space:]')"
  # 🔴 `(bool)::text` 回的是 'false'/'true'(不是 psql 的 f/t)—— 首版比 'f' 比錯了,
  #    症狀是「五靶全部 MUT-BAD」= 看起來像守門全壞,實際是量具讀錯值。兩種都收。
  case "$still" in
    f|false) printf '  mut  %s ⇒ 對應判準翻紅 ✅\n' "$1" ;;
    t|true)  MUT_BAD=$((MUT_BAD+1)); printf '  MUT-BAD %s ⇒ 判準仍回通過 = 恆真格\n' "$1" ;;
    *)       MUT_BAD=$((MUT_BAD+1)); printf '  MUT-BAD %s ⇒ 判準回了看不懂的值 [%s]\n' "$1" "$still" ;;
  esac
}

mut "M1 拿掉配對 CHECK ⇒ S3 必須翻紅" \
  "ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_void_pair;" \
  "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.order_item_procurement'::regclass AND conname='order_item_procurement_void_pair')"

mut "M2 索引改成非 partial ⇒ S5 必須翻紅" \
  "DROP INDEX public.order_item_procurement_business_key;
   CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement (order_item_id, supplier_id);" \
  "SELECT pg_get_indexdef('public.order_item_procurement_business_key'::regclass) LIKE '%WHERE (voided_at IS NULL)'"

mut "M3 A4a 述詞拔掉 ⇒ S7 必須翻紅" \
  "CREATE OR REPLACE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='5s'
   AS \$\$BEGIN RAISE NOTICE 'mutated'; END\$\$;" \
  "SELECT strpos(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure),'voided_at IS NULL') > 0"

mut "M4 多加一欄 voided_by ⇒ S2(兩欄約束)必須翻紅" \
  "ALTER TABLE public.order_item_procurement ADD COLUMN voided_by text;" \
  "SELECT count(*)=0 FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass
     AND NOT attisdropped AND attname IN ('voided_by','deleted_by','void_count','unvoided_at')"

mut "M5 給 service_role DELETE ⇒ P2(沒有 writer)必須翻紅" \
  "GRANT DELETE ON public.order_item_procurement TO service_role;" \
  "SELECT count(*)=0 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rn)
     CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(pv)
     WHERE has_table_privilege(r.rn,'public.order_item_procurement',p.pv)"

echo "══ 收尾閘 ═══════════════════════════════════════════════════"
TOTAL=$((PASS+FAIL))
echo "PASS=$PASS FAIL=$FAIL 總格=$TOTAL(預期 $EXPECTED_TOTAL) / MUT=$MUT MUT_BAD=$MUT_BAD(預期靶 $EXPECTED_MUT)"
RC=0
[ "$FAIL" -eq 0 ]              || { echo "🔴 有格紅"; RC=1; }
[ "$TOTAL" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 總格數不符 ⇒ 有格被刪或新增沒登記"; RC=1; }
[ "$MUT" -eq "$EXPECTED_MUT" ] || { echo "🔴 突變靶數不符"; RC=1; }
[ "$MUT_BAD" -eq 0 ]           || { echo "🔴 有靶沒作用(恆真格或突變沒套上)"; RC=1; }
[ "$RC" -eq 0 ] && echo "✅ 452 harness 全綠"
exit $RC
