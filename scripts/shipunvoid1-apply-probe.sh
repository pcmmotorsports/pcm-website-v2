#!/usr/bin/env bash
# ci-self-contained: no  —— 要位置參數/信箱裡的 SQL 檔, CI 裡那些不存在 ⇒ 它跑不起來, 不是不該跑
# ============================================================
# shipunvoid1-apply-probe — ⟦b4-SHIPUNVOID1⟧ 五個世界
#
# 🔴 **本檔驗的是【行為】不是【字面】** —— migration 自己的後置閘已經驗字面在不在,
#    而「字面在」與「那位客人拿得到信」是兩個宣稱。
#
# 世界:
#   W1 作廢 → 出貨信落 skip → **unvoid** ⇒ 掃描 view **回得到**(修好的樣子)
#   W2 作廢 → skip → **不 unvoid**       ⇒ view **回不到**(否則把靜默漏信換成錯誤寄信)
#   W3 🔴 **必死正對照**:不套本片,重跑 W1 ⇒ **必須回不到**(否則整發零判別力)
#   W4 退休那一格自己的突變:把 status 條件拿掉 ⇒ 必須把不該退休的也退休 ⇒ 抓得到
#   W5 🔴 **作廢 → 復原 → 再作廢 → 再復原** ⇒ 每一輪都要對(後綴會疊,那是新的世界)
#
# ⚠️ 效度限制(照 runbook 不放寬):本機 read committed;orders/staff/customers 最小 stub;
#    無 RLS、無正式庫既有資料 ⇒ **本檔過 ≠ 正式庫過**。
# ============================================================
set -uo pipefail
export LC_ALL=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# 🔴 **2026-08-31 22:0x 更正(codex must-fix)**:本檔原本 `test -f` 一支 migration,
#    而那支是【甲2】那一版、已經刪掉 ⇒ **本檔當場 exit 2,而 plan 上還寫著 PASS=13。**
#    📌 **一個當時為真的數字,在它引用的東西被刪掉之後【安靜地變成不可重現】** ——
#       而 rc=2 是「尺沒接上」不是「紅」⇒ 它不會有人發現。
#    ⇒ 丙 是 TS(adapter 一發 UPDATE 多帶一個欄位)⇒ **本檔不依賴任何 migration。**
#    ⇒ 本檔驗的是【那樣的鍵會讓 view 怎麼走】;「adapter 真的送出那個值」由
#       `SupabaseEmailOutboxAdapter.test.ts` 三格 + 三發突變守。
command -v initdb >/dev/null || { echo "🔴 找不到 initdb"; exit 2; }

PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/shipunvoid1.XXXXXX")"
export PGHOST="$PGDIR" PGPORT=54897 PGDATABASE=postgres PGUSER=probe
cleanup(){ pg_ctl -D "$PGDIR/data" stop -m immediate >/dev/null 2>&1; rm -rf "$PGDIR"; }
trap cleanup EXIT
initdb -D "$PGDIR/data" -U probe --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
pg_ctl -D "$PGDIR/data" -o "-k $PGDIR -p 54897 -c listen_addresses=''" -l "$PGDIR/log" start >/dev/null 2>&1
for _ in $(seq 1 40); do psql -qc "select 1" >/dev/null 2>&1 && break; done
psql -qc "select 1" >/dev/null 2>&1 || { echo "🔴 PG 起不來"; tail -5 "$PGDIR/log"; exit 2; }

PASS=0; FAIL=0
q(){ psql -qtAX -c "$1" 2>&1; }
ok(){ PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  🔴 %s — %s\n' "$1" "$2"; }
eq(){ if [ "$2" = "$3" ]; then ok "$1 ⇒ $2"; else bad "$1" "期望 $3 實得 $2"; fi; }

# ── 最小 schema:只造本片碰得到的東西,而**去重鍵函式與 anti-join 從真檔切**
psql -qX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
CREATE TABLE public.orders (id uuid PRIMARY KEY, notification_email text);
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid REFERENCES public.orders(id));
CREATE TABLE public.shipments (id uuid PRIMARY KEY, shipped_at timestamptz, deleted_at timestamptz);
CREATE TABLE public.shipment_items (shipment_id uuid REFERENCES public.shipments(id), order_item_id uuid REFERENCES public.order_items(id));
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL, dedup_key text NOT NULL, status text NOT NULL);
CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key);
CREATE FUNCTION public.pcm_shipped_email_dedup_key(p_shipment_id uuid, p_order_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_shipment_id::text || ':' || p_order_id::text; $$;
CREATE VIEW public.pcm_shipped_email_pending AS
SELECT DISTINCT s.id AS shipment_id, o.id AS order_id
  FROM public.shipments s
  JOIN public.shipment_items si ON si.shipment_id = s.id
  JOIN public.order_items oi ON oi.id = si.order_item_id
  JOIN public.orders o ON o.id = oi.order_id
 WHERE s.shipped_at IS NOT NULL AND s.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.email_outbox e
                    WHERE e.event_type='order_shipped'
                      AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id));
SQL
S1='aaaaaaaa-0000-0000-0000-00000000000a'
O1='bbbbbbbb-0000-0000-0000-00000000000b'
I1='cccccccc-0000-0000-0000-00000000000c'

seed(){
  psql -qX -c "TRUNCATE public.email_outbox; DELETE FROM public.shipment_items; DELETE FROM public.order_items; DELETE FROM public.shipments; DELETE FROM public.orders;" >/dev/null 2>&1
  psql -qX -v ON_ERROR_STOP=1 -c "
    INSERT INTO public.orders(id,notification_email) VALUES ('$O1','a@b.c');
    INSERT INTO public.order_items(id,order_id) VALUES ('$I1','$O1');
    INSERT INTO public.shipments(id,shipped_at,deleted_at) VALUES ('$S1', now(), NULL);
    INSERT INTO public.shipment_items(shipment_id,order_item_id) VALUES ('$S1','$I1');" >"$PGDIR/seed.out" 2>&1 \
    || { echo "  🔴 seed 失敗"; grep -m2 ERROR "$PGDIR/seed.out"; exit 2; }
  # 🔴 seed 自檢:一開始 view 必須看得到那一列(否則後面每一格都是恆假)
  local n; n=$(q "select count(*) from public.pcm_shipped_email_pending")
  [ "$n" = "1" ] || { echo "  🔴 seed 後 view 回 $n 列(期望 1)⇒ 本次作廢"; exit 2; }
}
# 🔴 **丙(2026-08-31 落地版)**:skip 那一發【同時】寫 status 與退休過的鍵。
#    真實對應 `SupabaseEmailOutboxAdapter.markSkippedShipmentVoided` ⇒ `leaveSending(...)` 一發 UPDATE,
#    `dedup_key: ${currentDedupKey}:voided:${id}`。本檔用固定 id 字串代表那一列自己的 uuid。
# ⚠️ **而本檔驗的是【那樣的鍵會讓 view 怎麼走】** —— 「adapter 真的送出那個值」由
#    `SupabaseEmailOutboxAdapter.test.ts` 三格斷言(值逐字、負對照換 id、冪等)+ 三發突變守。
#    📌 兩層各自證一半, 而**兩半都不能省**:一半證值對, 一半證那個值的後果對。
void_and_skip(){   # 作廢 + skip(丙:落地時鍵就已退休)
  psql -qX -c "UPDATE public.shipments SET deleted_at = now() WHERE id='$S1'" >/dev/null 2>&1
  psql -qX -c "INSERT INTO public.email_outbox(event_type,dedup_key,status)
               VALUES ('order_shipped',
                       public.pcm_shipped_email_dedup_key('$S1','$O1') || ':voided:' || '${1:-row-1}',
                       'skipped_shipment_voided')
               ON CONFLICT DO NOTHING" >/dev/null 2>&1
}
void_and_skip_old(){  # 🔴 舊行為(甲2 之前):skip 以【正規鍵】落地 —— 留著當必死正對照
  psql -qX -c "UPDATE public.shipments SET deleted_at = now() WHERE id='$S1'" >/dev/null 2>&1
  psql -qX -c "INSERT INTO public.email_outbox(event_type,dedup_key,status)
               VALUES ('order_shipped', public.pcm_shipped_email_dedup_key('$S1','$O1'), 'skipped_shipment_voided')
               ON CONFLICT DO NOTHING" >/dev/null 2>&1
}
unvoid_raw(){      # 只復原,不退休鍵(= 修法【沒有】套上的世界)
  psql -qX -c "UPDATE public.shipments SET deleted_at = NULL WHERE id='$S1'" >/dev/null 2>&1
}
# 🛑 **`retire()` 是【甲2】那一版的形狀(在 unvoid 那一側清)—— 保留是刻意的**:
#    W3 用它當必死正對照, 而 W4 用它示範**它對「先 unvoid 後 skip」那個順序撲空**。
#    ⇒ 丙 不呼叫它。
retire(){
  psql -qX -c "
    UPDATE public.email_outbox e
       SET dedup_key = e.dedup_key || ':unvoided:' || '$1'
     WHERE e.event_type='order_shipped' AND e.status='skipped_shipment_voided'
       AND e.dedup_key IN (SELECT public.pcm_shipped_email_dedup_key('$S1', o.id)
                             FROM public.shipment_items si
                             JOIN public.order_items oi ON oi.id=si.order_item_id
                             JOIN public.orders o ON o.id=oi.order_id
                            WHERE si.shipment_id='$S1')" >/dev/null 2>&1
}
pending(){ q "select count(*) from public.pcm_shipped_email_pending"; }
rows(){    q "select count(*) from public.email_outbox"; }

echo "── W1 丙:作廢 → skip(鍵當下退休)→ unvoid ⇒ view 要回得到 ──"
seed; void_and_skip row-1; unvoid_raw
eq "W1 view 回得到那一列"              "$(pending)" "1"
eq "W1 那一列沒有被刪(證據留著)"        "$(rows)" "1"

echo "── W2 作廢 → skip → 【不】unvoid ⇒ view 要回不到(否則寄出不該寄的信) ──"
seed; void_and_skip row-1
eq "W2 view 回不到"                    "$(pending)" "0"

echo "── W3 🔴 必死正對照:舊行為(skip 以正規鍵落地)⇒ W1 那一格必須變 0 ──"
seed; void_and_skip_old; unvoid_raw
R3=$(pending)
if [ "$R3" = "0" ]; then ok "W3 舊行為 ⇒ 回不到 ⇒ **W1 的 1 是【退休那把鍵】帶來的**"
else bad "W3 必死正對照" "舊行為也回得到($R3)⇒ W1 那個 1 不是修法造成的 ⇒ 整發零判別力"; fi

echo "── W4 🔴🔴 codex 那個順序:unvoid 落在 worker【讀到】與【寫下 skip】之間 ──"
# 真實形狀:sweep-email-outbox.ts 兩發【分開的】DB round-trip(讀 → 寫),
# 而寫那一發只有 `.eq(attempts, ...)` 世代柵欄, **不重新檢查箱還作不作廢**。
seed
psql -qX -c "UPDATE public.shipments SET deleted_at = now() WHERE id='$S1'" >/dev/null 2>&1
W4READ=$(q "select case when deleted_at is null then 'live' else 'voided' end from public.shipments where id='$S1'")
unvoid_raw                      # ← unvoid 在這裡發生(worker 還沒寫下 skip)
void_and_skip_noVoid(){ :; }    # (占位:下一行直接寫 skip,箱已經是 live 了)
psql -qX -c "INSERT INTO public.email_outbox(event_type,dedup_key,status)
             VALUES ('order_shipped',
                     public.pcm_shipped_email_dedup_key('$S1','$O1') || ':voided:' || 'row-race',
                     'skipped_shipment_voided')
             ON CONFLICT DO NOTHING" >/dev/null 2>&1
eq "W4 worker 那一發讀到的是"          "$W4READ" "voided"
eq "W4 箱現在是好的"                   "$(q "select case when deleted_at is null then 'live' else 'voided' end from public.shipments where id='$S1'")" "live"
W4=$(pending)
if [ "$W4" = "1" ]; then ok "W4 **丙 對這個順序也有效**:鍵在 skip 當下就退休 ⇒ view 仍回得到"
else bad "W4 丙 對競態順序無效" "view 回不到($W4)⇒ 這個順序仍然漏信"; fi

echo "── W4b 🔴 對照:同一個順序,用【甲2 的形狀】(在 unvoid 那側清)⇒ 必須漏 ──"
# 🔴 **2026-08-31 22:0x 更正(codex must-fix)**:本格原本呼叫 `void_and_skip_old`,
#    而那支 helper **會先把箱再作廢一次** ⇒ `pending()=0` 可以完全由 `deleted_at IS NOT NULL` 造成,
#    與「正規鍵有沒有卡住」無關 ⇒ **那個成功條件在錯的前提下恆真,證不到甲2 撲空。**
#    ⇒ 改成:箱保持 live,只寫下【正規鍵】那一列 —— 這樣 0 就只能是鍵造成的。
seed
psql -qX -c "UPDATE public.shipments SET deleted_at = now() WHERE id='$S1'" >/dev/null 2>&1
unvoid_raw; retire 'idem-race'   # ← 甲2:unvoid 時清,而此刻 skip 還沒寫 ⇒ 撲空
# ← worker 才寫下 skip,而箱【已經是 live】⇒ 不動 deleted_at
psql -qX -c "INSERT INTO public.email_outbox(event_type,dedup_key,status)
             VALUES ('order_shipped', public.pcm_shipped_email_dedup_key('$S1','$O1'), 'skipped_shipment_voided')
             ON CONFLICT DO NOTHING" >/dev/null 2>&1
eq "W4b 前提:箱是 live(0 不是 deleted_at 造成的)" "$(q "select case when deleted_at is null then 'live' else 'voided' end from public.shipments where id='$S1'")" "live"
W4B=$(pending)
if [ "$W4B" = "0" ]; then ok "W4b 甲2 在這個順序上**撲空** ⇒ 仍然漏信 ⇒ **證明 W4 的 1 是丙 特有的**"
else bad "W4b 對照" "甲2 在這個順序也擋住了($W4B)⇒ 那兩個設計沒有差別, W4 沒有判別力"; fi

echo "── W5 🔴 作廢→復原→再作廢→再復原(兩輪, 鍵不會互撞) ──"
seed
void_and_skip row-1; unvoid_raw
eq "W5 第一輪復原後 view 回得到"        "$(pending)" "1"
void_and_skip row-2
eq "W5 再作廢後 view 回不到"            "$(pending)" "0"
unvoid_raw
eq "W5 第二輪復原後 view 回得到"        "$(pending)" "1"
eq "W5 兩列證據都留著"                  "$(rows)" "2"
eq "W5 一列都沒被刪"                    "$(q "select count(*) from public.email_outbox where status='skipped_shipment_voided'")" "2"

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL ══"
echo "🛑 射程:本機 read committed;schema 是最小 stub(orders/shipments 只有本片用得到的欄);"
echo "   無 RLS、無正式庫既有資料 ⇒ **本檔過 ≠ 正式庫過**。"
[ "$FAIL" -eq 0 ] || exit 1
