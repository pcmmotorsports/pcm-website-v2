#!/usr/bin/env bash
#
# A7 驗證 harness —— 讓 A7-1 / A7-2 的「全綠 + 突變全紅」可被任何人重跑。
#
# 存在理由(codex 關卡2 must-fix):第一次做這些驗證時,突變 runner 是臨時打在對話裡的 bash,
# repo 內查無 ⇒ 「15 條 / 13 條突變全紅」這個宣稱**沒有任何可重現證據**,審查者只能選擇相信或不信。
# 依「可反駁預測驗根因、實測驗修法」與「字面 vs 事實」,證據必須是別人跑得出來的東西。
#
# 用法:
#   scripts/a7-verify.sh all <workdir>        # provision → 全部驗證 → teardown
#   scripts/a7-verify.sh run <workdir>        # 對已 provision 的庫只跑驗證(不建不拆)
#
# 🔴 workdir 必須是**短路徑**(例:/tmp/a7v):PG 的 Unix socket 路徑上限 103 bytes,
#    scratchpad 全路徑會讓 postmaster 啟動即死(實測踩過)。
#
# 🔴 判定紀律(關卡2 nit + 實測踩到的假綠):
#    ①一次執行算「綠」的條件 = **兩句成功 NOTICE 都出現**(探針全通過 + 交易外零殘留複驗)。
#      只 grep 第一句的話,rollback 後的零殘留驗證若失敗會被判綠。
#    ②**不能只 grep 自家的錯誤訊息** —— 正向探針失敗時噴的是 PG 原生 check/unique violation,
#      不帶「探針 N 失敗」字樣;只認自家訊息的 runner 會把「腳本其實炸了」判成綠(實測:
#      加數量上限、改 UNIQUE 兩條都是這樣被誤判的)。
#
# 🔴 誠實邊界(與 plan §8 一致,不放寬):
#    本機 PG17 非 Supabase、auth.uid() 是 shim、**C locale ≠ 正式站 en_US.UTF-8**(見 backlog #305)。
#    ⇒ 本腳本證明「SQL 邏輯與約束行為正確」,**不證明** Supabase CLI ledger 原子性、真實鎖競爭、
#      正式站併發安全。A7 的兩條字元判定已刻意改成不依賴 locale ⇒ 那兩條的結果可轉移。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a7-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7v)}"
MIG="supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql"
PROBE="scripts/a7-behavior-probe.sql"
PORT=54329
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log()  { echo "== $* =="; }

[ ${#WORK} -le 40 ] || { echo "🔴 workdir 太長(${#WORK} 字元)—— socket 路徑上限 103 bytes,請用 /tmp/a7v 這類短路徑"; exit 2; }

if [ "$MODE" = "all" ]; then
  log "0/5 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  rm -rf "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" >/dev/null 2>&1 || { echo "🔴 provision 失敗"; exit 1; }
fi

psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上 $URL(先跑 all 模式 provision)"; exit 1; }
CID="$(psql "$URL" -qtA -c 'SELECT system_identifier FROM pg_control_system()')"

log "1/5 建白名單標記(A7-2 的正向環境閘要求;只在拋棄式庫做)"
psql "$URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS public.pcm_a7_probe_allowed (note text);" \
  -c "COMMENT ON TABLE public.pcm_a7_probe_allowed IS '此庫允許 A7 探針寫入合成資料(拋棄式)';" >/dev/null

reapply() {
  psql "$URL" -qtA -c "DROP TABLE IF EXISTS public.order_cancellation_items; DROP TABLE IF EXISTS public.order_cancellations;" >/dev/null 2>&1
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" 2>&1
}

log "2/5 A7-1 結構驗收(零突變必須綠)"
OUT="$(reapply)"
if echo "$OUT" | grep -q 'A7-1 結構驗收全數通過'; then ok "A7-1 apply + 結構驗收綠"; else bad "A7-1 未通過:$(echo "$OUT" | grep -m1 ERROR)"; fi

# A7-1 的驗收 DO block(抽出來當突變靶)
awk '/^DO \$\$$/{f=1} f{print} /^\$\$;$/{if(f) exit}' "$MIG" > "$WORK/a7-1-assertions.sql"

s1() {  # A7-1 結構突變:期望紅
  local name="$1" ddl="$2"
  { echo "BEGIN;"; echo "$ddl"; cat "$WORK/a7-1-assertions.sql"; echo "ROLLBACK;"; } > "$WORK/m.sql"
  local o; o="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/m.sql" 2>&1)"
  if echo "$o" | grep -q 'A7-1 結構驗收全數通過'; then bad "S:$name —— 突變未被抓到(假綠)"
  else ok "S:$name → $(echo "$o" | grep -m1 -oE 'A7-1 驗收失敗[^\"]{0,52}')"; fi
}

log "3/5 A7-1 結構突變(每條都必須紅,且被自己那條斷言抓到)"
s1 "數量加 A2 式上限"        "ALTER TABLE public.order_cancellation_items ADD CONSTRAINT x_up CHECK (cancelled_quantity <= 100000);"
s1 "數量 CHECK 改 >= 0"      "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_quantity_positive; ALTER TABLE public.order_cancellation_items ADD CONSTRAINT order_cancellation_items_quantity_positive CHECK (cancelled_quantity >= 0);"
s1 "複合 FK 改單欄"          "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_order_item_fk; ALTER TABLE public.order_cancellation_items ADD CONSTRAINT order_cancellation_items_order_item_fk FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;"
s1 "header FK 改 CASCADE"    "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_order_id_fkey; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;"
s1 "actor FK 改 CASCADE"     "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_actor_fkey; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_actor_fkey FOREIGN KEY (actor) REFERENCES public.staff(id) ON DELETE CASCADE;"
s1 "reason_code 砍一個值"    "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_reason_code_check; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_reason_code_check CHECK (reason_code IN ('customer_request','out_of_stock','long_leadtime','price_change','duplicate_order','other'));"
s1 "reason_code 加第八值"    "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_reason_code_check; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_reason_code_check CHECK (reason_code IN ('customer_request','out_of_stock','long_leadtime','price_change','duplicate_order','internal_error','other','vip_override'));"
s1 "hash CHECK 放寬 {64,}"   "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_payload_hash_shape; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_payload_hash_shape CHECK (payload_hash ~ '^[0123456789abcdef]{64,}\$');"
s1 "hash 型別改 varchar(64)"  "ALTER TABLE public.order_cancellations ALTER COLUMN payload_hash TYPE varchar(64);"
s1 "碼位清單拿掉 U+180E"     "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_reason_detail_rule; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_reason_detail_rule CHECK (CASE WHEN reason_code = 'other' THEN reason_detail IS NOT NULL AND pg_catalog.translate(reason_detail, U&'\\0009\\000A\\000B\\000C\\000D\\0020\\0085\\00A0\\00AD\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\200B\\200C\\200D\\2028\\2029\\202F\\205F\\2060\\2800\\3000\\3164\\FEFF', '') <> '' ELSE reason_detail IS NULL END);"
s1 "偷加 clamp trigger"      "CREATE FUNCTION pg_c1() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NEW; END \$f\$; CREATE TRIGGER x_c BEFORE INSERT ON public.order_cancellation_items FOR EACH ROW EXECUTE FUNCTION pg_c1();"
s1 "GRANT INSERT service_role" "GRANT INSERT ON TABLE public.order_cancellations TO service_role;"
s1 "GRANT SELECT authenticated" "GRANT SELECT ON TABLE public.order_cancellations TO authenticated;"
s1 "索引欄序反轉"            "DROP INDEX public.order_cancellations_order_created_idx; CREATE INDEX order_cancellations_order_created_idx ON public.order_cancellations (created_at DESC, order_id);"
s1 "索引加 WHERE false"      "DROP INDEX public.order_cancellation_items_order_item_idx; CREATE INDEX order_cancellation_items_order_item_idx ON public.order_cancellation_items (order_item_id) WHERE false;"
s1 "idempotency_key 改 text" "ALTER TABLE public.order_cancellations ALTER COLUMN idempotency_key TYPE text;"
s1 "關掉 RLS"                "ALTER TABLE public.order_cancellation_items DISABLE ROW LEVEL SECURITY;"
s1 "加一條 policy"           "CREATE POLICY xp ON public.order_cancellations FOR SELECT TO authenticated USING (true);"
s1 "created_at default 換掉"  "ALTER TABLE public.order_cancellations ALTER COLUMN created_at SET DEFAULT '2020-01-01'::timestamptz;"
s1 "reason_detail 改 NOT NULL" "ALTER TABLE public.order_cancellations ALTER COLUMN reason_detail SET NOT NULL;"
s1 "加欄級 ACL"              "GRANT SELECT (id) ON TABLE public.order_cancellations TO authenticated;"

log "4/5 A7-2 行為探針(零突變必須綠 = 兩句成功 NOTICE 都要出現)"
reapply >/dev/null
probe_run() {  # 回傳 0 = 綠(兩句 NOTICE 都在)
  local extra="${1:-}"
  if [ -n "$extra" ]; then
    { echo "BEGIN;"; echo "SET LOCAL statement_timeout='300s';"; echo "$extra";
      awk '/^DO \$\$$/{n++} n==2{print} n==2 && /^\$\$;$/{exit}' "$PROBE"; echo "ROLLBACK;"; } > "$WORK/p.sql"
    psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/p.sql" 2>&1
  else
    psql "$URL" -v ON_ERROR_STOP=1 -v a7_allow_dml=yes-throwaway-db -v a7_expect_cluster="$CID" -qtA -f "$PROBE" 2>&1
  fi
}
OUT="$(probe_run)"
if echo "$OUT" | grep -q '行為驗收全數通過' && echo "$OUT" | grep -q '零殘留複驗通過'; then
  ok "A7-2 36/36 + 零殘留(兩句 NOTICE 都出現)"
else
  bad "A7-2 未全綠:$(echo "$OUT" | grep -m1 ERROR)"
fi

s2() {  # A7-2 行為突變:期望紅(任何錯誤都算紅;不只認自家訊息)
  local name="$1" ddl="$2"
  local o; o="$(probe_run "$ddl")"
  if echo "$o" | grep -q '行為驗收全數通過'; then bad "B:$name —— 突變未被任何探針抓到(假綠)"
  else ok "B:$name → $(echo "$o" | grep -m1 -oE '(探針 [0-9-]+ 失敗|ERROR:[^\"]{0,44})')"; fi
}

log "5/5 A7-2 行為突變"
s2 "拿掉 reason_detail 雙向規則" "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_reason_detail_rule;"
s2 "拿掉 reason_code allowlist"  "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_reason_code_check;"
s2 "拿掉 payload_hash 形狀"      "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_payload_hash_shape;"
s2 "拿掉 actor FK"               "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_actor_fkey;"
s2 "拿掉冪等 UNIQUE"             "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_idempotency_key;"
s2 "拿掉數量 > 0"                "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_quantity_positive;"
s2 "加 A2 式數量上限"            "ALTER TABLE public.order_cancellation_items ADD CONSTRAINT x_up CHECK (cancelled_quantity <= 100000);"
s2 "UNIQUE 誤設成單內品項"       "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_cancellation_item_key; ALTER TABLE public.order_cancellation_items ADD CONSTRAINT order_cancellation_items_cancellation_item_key UNIQUE (order_id, order_item_id);"
s2 "cancellation 複合 FK 改單欄" "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_cancellation_fk; ALTER TABLE public.order_cancellation_items ADD CONSTRAINT order_cancellation_items_cancellation_fk FOREIGN KEY (cancellation_id) REFERENCES public.order_cancellations(id) ON DELETE RESTRICT;"
s2 "order_item 複合 FK 改單欄"   "ALTER TABLE public.order_cancellation_items DROP CONSTRAINT order_cancellation_items_order_item_fk; ALTER TABLE public.order_cancellation_items ADD CONSTRAINT order_cancellation_items_order_item_fk FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;"
s2 "header FK 改 CASCADE"        "ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_order_id_fkey; ALTER TABLE public.order_cancellations ADD CONSTRAINT order_cancellations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;"
# 🔴 這條是「讀回寫入值」的存在理由:clamp trigger 不會讓任何約束轉紅,只有讀回比對抓得到。
s2 "clamp trigger 改值"          "CREATE FUNCTION pg_c2() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN NEW.cancelled_quantity := least(NEW.cancelled_quantity, 100000); RETURN NEW; END \$f\$; CREATE TRIGGER x_c2 BEFORE INSERT ON public.order_cancellation_items FOR EACH ROW EXECUTE FUNCTION pg_c2();"
s2 "拿掉 orders 的 RF2a-0 trigger" "DROP TRIGGER orders_freeze_shipping_snapshot_bi ON public.orders;"

log "對照組:零突變(必須綠)—— 沒有這條,上面全紅毫無意義"
OUT="$(probe_run "SELECT 1;")"
if echo "$OUT" | grep -q '行為驗收全數通過'; then ok "對照組綠(harness 會分辨,不是恆紅)"; else bad "對照組竟然紅 —— harness 本身壞了"; fi

if [ "$MODE" = "all" ]; then
  log "teardown"
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || true
fi

echo
echo "════ A7 驗證結果:通過 ${PASS} / 失敗 ${FAIL} ════"
[ "$FAIL" -eq 0 ] || exit 1
