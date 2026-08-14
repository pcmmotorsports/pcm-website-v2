#!/usr/bin/env bash
# ============================================================
# #452 片 2a-2 · 探針 1/2 —— unvoid × A5a 併發是否製造 40P01
# ============================================================
# 🔴 這是【證據】不是【工具】。它對【拋棄式庫】跑,不對正式庫跑,也不進 CI。
#    落點在 docs/ 而非 scripts/ 是刻意的(scripts/ 會被 .husky/reviewer-gate.sh:39 的
#    pattern 納入受審面,且會讓人以為這是常設工具)。
#
# ── ① 這支量到了什麼(三發,結果逐字)────────────────────────
#   發① 對照組(拍板前形狀,A5a 存在性查詢【不帶】 voided 述詞)
#        ⇒ **不死結**。A 卡在列鎖 → B 提交 → A 走 UPDATE、`UPDATE 1`、COMMIT 成功。40P01 = 0
#   發② 拍板後形狀(帶 `AND voided_at IS NULL` ⇒ 查不到那列 ⇒ 不留鎖)
#        ⇒ 🔴 **`ERROR: deadlock detected`**,40P01 = 1
#        CONTEXT 逐字 = `while inserting index tuple (0,6) in relation
#                        "order_item_procurement_business_key"`
#        ⇒ 死結發生在【partial unique index 的索引項插入】= 推導的那條路,不是 fixture 自己的鎖
#   發③ 循序、無 U7(A 先提交新列 → B unvoid)
#        ⇒ `ERROR: duplicate key value violates unique constraint
#           "order_item_procurement_business_key"`(裸 23505 + 索引名)
#   ⚠️ 三發重跑過一次,結果相同(0 / 1 / 1)。
#
# ── ② 前提(不寫清楚的話這些數字會被過度引用)──────────────
#   · 拋棄式 PostgreSQL **17.10**(本機 Homebrew),跑完即拆。
#   · 🔴 **void / unvoid 兩支 RPC 當時【還不存在】**(那正是 2a-2 要寫的)
#     ⇒ 本探針**模擬**它們的鎖形狀(plan §2.4 的順序:鎖採購列 NKU → 鎖 order_items NKU
#        → U7 檢查 → UPDATE)。
#   · ⇒ **它證的是「鎖與索引的交互」,不是「那兩支 RPC 的行為」。** 引用時不得混用。
#   · 🔴 不用 heredoc 餵 psql(codex #14:連線到 EOF 就結束、交易回滾 ⇒ 根本沒測到 blocking)
#     ⇒ 改用 FIFO 保持連線常開,由本腳本控制交錯時序。
#   · 「兩個 session 真的交錯了」的觀察點 = 第三條連線讀 `pg_stat_activity`
#     (發① 實際看到 `probeA | state=active | wait=Lock/transactionid`),**不是靠 sleep 猜**。
#
# ── ③ 🔴 兩個假通過(我自己踩過,下一個跑它的人最可能踩同一個)──
#   假通過 1:**fixture 建失敗時,發② 會印出「40P01 命中數 = 0」**
#            —— 那個畫面跟「沒有死結」**一模一樣**。
#            首跑真因 = `order_items_snapshot_whitelist` 要特定 shape,`$ITEM` 變成空字串。
#            ⇒ 已補 fail-closed 前提斷言(item/sup 非空 + order_items 恰 1 列
#               + 每發前驗「恰一列已作廢」)。**不要拿掉那幾道斷言。**
#   假通過 2:**`reset_fixture` 原本用 `>/dev/null 2>&1` 把錯誤吞掉**,
#            真因是我照 A2 的 `CREATE TABLE`(`20260729020000:33-68`)寫欄位,
#            而 **S1b(`20260801150000:138`)早已移除 `supplier_name` / `supplier_canonical_key`**。
#            ⇒ 「查了現況、沒查修訂史」。現在不吞錯誤。
#
# 用法:先 `PORT=54461 bash scripts/452-verify.sh provision /tmp/452-lockprobe`
#       再 `PORT=54461 bash docs/probes/452-2a2-lockprobe.sh`
#       跑完自己拆庫:`pg_ctl -D /tmp/452-lockprobe/pgdata stop -m immediate && rm -rf /tmp/452-lockprobe`
# ============================================================
# ============================================================
# D 窗 lock probe —— unvoid × A5a 併發:Q-S1=A 是否製造 40P01
# ============================================================
# 主視窗裁決:先構造,不要先設計。三發 + 正向對照。
# 🔴 不用 heredoc 餵 psql(codex #14:連線到 EOF 就結束、交易回滾 ⇒ 根本沒測到 blocking)。
#    改用 FIFO 保持連線常開,由本腳本控制交錯時序。
# 🔴 void/unvoid RPC 還不存在(那正是 2a-2 要寫的)⇒ 本探針【模擬】它們的鎖形狀,
#    用的是 plan §2.4 寫的那個順序(鎖採購列 NKU → 鎖 order_items NKU → U7 檢查 → UPDATE)。
#    ⇒ 本探針證的是【鎖與索引的交互】,不是「那兩支 RPC 的行為」。
set -uo pipefail
W=/tmp/452-lockprobe
PORT="${PORT:-54461}"
URL="postgresql://postgres@/postgres?host=${W}/sock&port=${PORT}"
P=$W/probe
rm -rf "$P"; mkdir -p "$P"

q() { psql "$URL" -tAX -c "$1" 2>&1; }

echo "══ 0. fixture(已提交,兩個 session 都要看得到)══════════════"
FX=$(psql "$URL" -tAX <<'SQL' 2>&1
-- #482:上一代是手動建表之後才跑的,全樹 grep 查無 CREATE TABLE probe_fx
--       ⇒ 任何人重跑會當場紅在 relation 不存在。自足化,跟姊妹探針
--       452-2a2-void-lockprobe.sh:72 同一行。
CREATE TABLE IF NOT EXISTS public.probe_fx(item uuid, sup uuid);
DO $b$
DECLARE v_item uuid; v_a uuid; v_ord uuid;
BEGIN
  SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
  SELECT id INTO v_a   FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
  IF v_ord IS NULL OR v_a IS NULL THEN RAISE EXCEPTION '前提不足:取不到訂單或供應商'; END IF;
  DELETE FROM public.probe_fx WHERE true;
  INSERT INTO public.probe_fx(item, sup) VALUES (gen_random_uuid(), v_a);
  INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT item, v_ord, 'SKU-PROBE', '{"title":"零件","sku":"S1","spec":{"color":"black"}}'::jsonb, 3, 10, 30 FROM public.probe_fx;
END $b$;
SQL
)
echo "$FX" | tail -3

reset_fixture() {
  local out
  out=$(psql "$URL" -qtAX -c "
    DELETE FROM public.order_item_procurement p USING public.probe_fx f WHERE p.order_item_id = f.item;
    INSERT INTO public.order_item_procurement
      (order_item_id, supplier_id, allocated_quantity,
       reply_status, first_ordered_at, status_changed_at, voided_at, void_reason)
    SELECT f.item, f.sup, 3, 'confirmed', now(), now(), now(), '探針作廢'
      FROM public.probe_fx f;" 2>&1)
  # 🔴 不吞錯誤:首跑就是被 >/dev/null 2>&1 吞掉「supplier_name 欄不存在」,
  #    害我以為是別的問題(S1b 20260801150000 已移除該欄,A2 的 CREATE TABLE 不是現況)。
  if printf '%s' "$out" | grep -qi 'ERROR'; then
    echo "🔴 reset_fixture 失敗:$(printf '%s' "$out" | grep -i -m1 ERROR)"; exit 1
  fi
}

ITEM=$(q "SELECT item::text FROM public.probe_fx")
SUP=$(q  "SELECT sup::text  FROM public.probe_fx")
echo "  item=$ITEM"
echo "  sup =$SUP"
# 🔴 fail-closed 前提斷言(codex #18 同型;首跑就是栽在這裡:
#    fixture 建失敗 ⇒ ITEM 是空字串 ⇒ 每一發都 ERROR ⇒ 40P01 命中數 = 0
#    ⇒ 畫面長得跟「沒有死結」一模一樣)。
if [ -z "$ITEM" ] || [ -z "$SUP" ]; then
  echo "🔴 fixture 沒建起來(item/sup 為空)⇒ 停。任何「0 命中」在這個狀態下都沒有意義。"
  exit 1
fi
if [ "$(q "SELECT count(*) FROM public.order_items WHERE id='$ITEM'")" != "1" ]; then
  echo "🔴 order_items 沒有這一列 ⇒ 停。"; exit 1
fi

open_sessions() {
  rm -f "$P/a.in" "$P/b.in"; mkfifo "$P/a.in" "$P/b.in"
  PGAPPNAME=probeA psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/a.in" > "$P/a.out" 2>&1 &
  APID=$!
  PGAPPNAME=probeB psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/b.in" > "$P/b.out" 2>&1 &
  BPID=$!
  exec 7> "$P/a.in"; exec 8> "$P/b.in"
  sleep 1
}
close_sessions() {
  printf '\\q\n' >&7 2>/dev/null; printf '\\q\n' >&8 2>/dev/null
  exec 7>&- 2>/dev/null; exec 8>&- 2>/dev/null
  wait "$APID" 2>/dev/null; wait "$BPID" 2>/dev/null
}
A() { printf '%s\n' "$1" >&7; }
B() { printf '%s\n' "$1" >&8; }

# 🔴 交錯證據:第三條連線讀 pg_stat_activity。這是「兩個 session 真的同時卡住」的觀察點,
#    不是靠 sleep 猜的。
witness() {
  echo "  ── 交錯證據($1)──"
  q "SELECT application_name||' | state='||state||' | wait='||coalesce(wait_event_type,'-')||'/'||coalesce(wait_event,'-')||' | '||left(regexp_replace(query,'\s+',' ','g'),52)
       FROM pg_stat_activity WHERE application_name IN ('probeA','probeB') ORDER BY application_name" | sed 's/^/     /'
}

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發① 對照組:拍板【之前】的形狀(A5a 存在性查詢【不帶】 voided 述詞)══"
echo "   期望 = 不死結(A 卡在 B 的列鎖上,B 提交後 A 走 UPDATE)"
reset_fixture
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NOT NULL")" = "1" ] \
  || { echo "🔴 reset_fixture 沒建出【一列已作廢】的採購 ⇒ 停"; exit 1; }
open_sessions
B "BEGIN;"
B "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
B "SELECT quantity FROM public.order_items WHERE id='$ITEM' FOR NO KEY UPDATE;"
sleep 2
A "BEGIN;"
A "SELECT id, allocated_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR UPDATE;"
sleep 3
witness "①:A 應卡在列鎖"
B "UPDATE public.order_item_procurement SET voided_at=NULL, void_reason=NULL WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NOT NULL;"
B "COMMIT;"
sleep 3
A "UPDATE public.order_item_procurement SET allocated_quantity=1, status_changed_at=now() WHERE order_item_id='$ITEM' AND supplier_id='$SUP';"
A "COMMIT;"
sleep 3
close_sessions
cp "$P/a.out" "$P/1a.out"; cp "$P/b.out" "$P/1b.out"
echo "   A 側錯誤:"; grep -i 'ERROR' "$P/1a.out" | head -3 | sed 's/^/     /' || true
echo "   B 側錯誤:"; grep -i 'ERROR' "$P/1b.out" | head -3 | sed 's/^/     /' || true
echo "   40P01 命中數 = $(cat "$P/1a.out" "$P/1b.out" | grep -c '40P01\|deadlock')"

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發② 拍板【之後】的形狀(A5a 存在性查詢【帶】 AND voided_at IS NULL ⇒ 不鎖那列)══"
echo "   期望(我推的)= 40P01"
reset_fixture
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NOT NULL")" = "1" ] \
  || { echo "🔴 reset_fixture 沒建出【一列已作廢】的採購 ⇒ 停"; exit 1; }
open_sessions
B "BEGIN;"
B "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
B "SELECT quantity FROM public.order_items WHERE id='$ITEM' FOR NO KEY UPDATE;"
sleep 2
A "BEGIN;"
A "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL FOR UPDATE;"
A "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at) VALUES ('$ITEM', '$SUP', 3, 'confirmed', now(), now());"
sleep 3
witness "②:A 應卡在 order_items(A2b1 trigger)"
B "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL;"
B "UPDATE public.order_item_procurement SET voided_at=NULL, void_reason=NULL WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NOT NULL;"
sleep 4
witness "②:兩邊都應在等"
sleep 4
A "COMMIT;"
B "COMMIT;"
sleep 3
close_sessions
cp "$P/a.out" "$P/2a.out"; cp "$P/b.out" "$P/2b.out"
echo "   A 側錯誤:"; grep -i 'ERROR' "$P/2a.out" | head -3 | sed 's/^/     /' || true
echo "   B 側錯誤:"; grep -i 'ERROR' "$P/2b.out" | head -3 | sed 's/^/     /' || true
echo "   40P01 命中數 = $(cat "$P/2a.out" "$P/2b.out" | grep -c '40P01\|deadlock')"

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發③ 循序(非併發):A 先提交新列,B 再 unvoid、【沒有】U7 ══"
echo "   期望 = 裸 23505 + 索引名 order_item_procurement_business_key"
reset_fixture
psql "$URL" -qtAX -c "
  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at)
  VALUES ('$ITEM', '$SUP', 3, 'confirmed', now(), now());" 2>&1 | grep -i ERROR && { echo "🔴 發③ fixture 失敗"; exit 1; }
OUT3=$(psql "$URL" -tAX -c "UPDATE public.order_item_procurement SET voided_at=NULL, void_reason=NULL WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NOT NULL;" 2>&1)
echo "$OUT3" | head -4 | sed 's/^/     /'
echo "   23505 命中 = $(printf '%s' "$OUT3" | grep -c 'duplicate key\|23505')"
echo "   索引名出現 = $(printf '%s' "$OUT3" | grep -c 'order_item_procurement_business_key')"

echo ""
echo "══ 收尾 ══"
echo "  三發輸出留在 $P/(1a 1b 2a 2b .out)"
