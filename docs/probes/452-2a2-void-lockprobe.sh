#!/usr/bin/env bash
# ============================================================
# #452 片 2a-2 · 探針 3/3 —— 🔴 C 案專用:void × A5a 併發是否製造 40P01
# ============================================================
# 🔴 這是【證據】不是【工具】。對【拋棄式庫】跑,不對正式庫跑,也不進 CI。
#
# ── 為什麼需要這一支(不是「多測一點比較安心」)────────────────
#   Sean 2026-08-14 拍 `Q-452-換路` = C:**只做作廢,不做取消作廢。**
#   ⇒ `C1 advisory lock` 整包消失(它是為 `unvoid × A5a` 的死結而設)。
#   ⇒ 唯一擋在「沒有死結」與「有死結」之間的,變成 plan 的**假設 `A7`**:
#      「void × A5a 由採購列 row lock 就序列化 ⇒ 拿掉 void 的 advisory 無可觀察紅」。
#   🔴 `A7` 是 **R3 讀 code 推的,不是量的**。姊妹探針 `452-2a2-lockprobe.sh` 只量過
#      `unvoid × A5a`(基準線 40P01=1),**`void × A5a` 從來沒有人量過。**
#   ⇒ 以前 `A7` 錯了沒關係(advisory 為 unvoid 而在,void 順便被保護);
#      **C 案下它承重** ⇒ 必須從推論變成觀察。
#
# ── 三發 ────────────────────────────────────────────────
#   發⓪ 正向對照(unvoid 形狀)          期望 40P01 = 1  ← 證明本 harness 抓得到死結
#   發④ void × A5a(void 先持列鎖)      期望 40P01 = 0  + A 真的被擋的證據
#   發⑤ void × A5a(A5a 先持列鎖+parent)期望 40P01 = 0  + B 真的被擋的證據
#
# 🔴 **發⓪ 不可省**:沒有它,發④⑤ 的「40P01 = 0」與「fixture 根本沒併發」長得一模一樣
#    ⇒ 那是本 repo 明文禁止的**恆綠格**。主視窗 `D-902-A.md:19` 逐字要求第二觀察。
#
# ── 為什麼另開一支、不改姊妹探針 ──────────────────────────
#   ① 姊妹探針的檔頭已把三發結果(0/1/1)寫成**凍結證據**,附加第四發會改寫那份紀錄。
#   ② 姊妹探針**假設 `probe_fx` 已存在**(全樹 grep 查無 `CREATE TABLE … probe_fx`
#      ⇒ 上一代是手動建的)⇒ 它現在不是可重跑的。本支自己建,是自足的。
#
# ── 前提(不寫清楚這些數字會被過度引用)────────────────────
#   · 拋棄式 PostgreSQL 17.10(本機 Homebrew),跑完即拆。
#   · 🔴 void RPC **還不存在**(那正是 2a-2 要寫的)⇒ 本探針**模擬**它的鎖形狀,
#     用 plan §2.4 C 案版步表:鎖採購列 NKU → (**不顯式鎖 order_items**) → UPDATE。
#     ⇒ 它證的是【鎖與索引的交互】,不是「那支 RPC 的行為」。引用時不得混用。
#
#   🔴🔴 **更正(2026-08-14,codex 對抗審查抓到,我原本寫錯)**:
#     舊字面寫「void **全程不取** order_items 鎖」—— **那是假的**。
#     `pcm_a4a_recompute_order_item_summary(uuid)` 的函式體內有
#     `FROM public.order_items oi … FOR NO KEY UPDATE`(實查該函式定義第 17-19 行)
#     ⇒ void 的 UPDATE 觸發 A4a 重算,**A4a 會替它取 parent NKU**。
#     ⇒ 正確的說法是「void **不顯式、不提前**取 parent 鎖」,不是「不取」。
#
#     **那為什麼還是不死結?**(以下區分「量到的」與「推的」)
#       · 量到的:發④⑤ 兩個方向、跑四次(最後一次為現行版本),40P01 皆 0;被擋的那一方等的是
#         `transactionid ShareLock`(= 採購列的列鎖),不是 parent 鎖。
#       · 推的(機制解釋,未直接觀察):死結環需要「持 parent ∧ 等索引項」。
#         unvoid 是**先**顯式取 parent(U6)、**再**讓 UPDATE 去插索引項 ⇒ 兩者同時成立。
#         void 相反:①它不提前取 parent(A4a 是在列 UPDATE **之後**才取)
#         ②voided_at 由 NULL 變非 NULL ⇒ 新列版**不再滿足** partial index 的
#         `WHERE voided_at IS NULL` ⇒ **void 根本不插索引項、也就無從等它**。
#     ⚠️ 這是「折 finding 時順手寫的新理由」的實例 —— 結論(不死結)是量到的,
#        但我當時給的**理由**沒驗過就寫下去了。留著這段是為了不要再犯。
#   · 🔴 不用 heredoc 餵 psql(codex #14:連線到 EOF 就結束、交易回滾 ⇒ 沒測到 blocking)
#     ⇒ 用 FIFO 保持連線常開,由本腳本控制交錯時序。
#   · 「兩個 session 真的交錯了」的觀察點 = 第三條連線讀 `pg_stat_activity`,不是靠 sleep 猜。
#
# 用法:  PORT=54461 bash scripts/452-verify.sh provision /tmp/452-lockprobe
#         PORT=54461 bash docs/probes/452-2a2-void-lockprobe.sh
# 拆庫:  pg_ctl -D /tmp/452-lockprobe/pgdata stop -m immediate && rm -rf /tmp/452-lockprobe
# ============================================================
set -uo pipefail
W=/tmp/452-lockprobe
PORT="${PORT:-54461}"
URL="postgresql://postgres@/postgres?host=${W}/sock&port=${PORT}"
P=$W/voidprobe
rm -rf "$P"; mkdir -p "$P"

q() { psql "$URL" -tAX -c "$1" 2>&1; }

echo "══ 0. fixture(已提交,兩個 session 都要看得到)══════════════"
FX=$(psql "$URL" -tAX -c "
CREATE TABLE IF NOT EXISTS public.probe_fx(item uuid, sup uuid);
DO \$b\$
DECLARE v_a uuid; v_ord uuid; v_item uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_ord FROM public.orders ORDER BY id LIMIT 1;
  SELECT id INTO v_a   FROM public.suppliers WHERE is_active ORDER BY id LIMIT 1;
  IF v_ord IS NULL OR v_a IS NULL THEN RAISE EXCEPTION '前提不足:取不到訂單或供應商'; END IF;
  DELETE FROM public.probe_fx WHERE true;
  INSERT INTO public.probe_fx(item, sup) VALUES (v_item, v_a);
  INSERT INTO public.order_items(id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_item, v_ord, 'SKU-VOIDPROBE',
          '{\"title\":\"零件\",\"sku\":\"S1\",\"spec\":{\"color\":\"black\"}}'::jsonb, 9, 10, 90);
END \$b\$;" 2>&1)
if printf '%s' "$FX" | grep -qi 'ERROR'; then
  echo "🔴 fixture 建失敗:$(printf '%s' "$FX" | grep -i -m1 ERROR)"; exit 1
fi

ITEM=$(q "SELECT item::text FROM public.probe_fx")
SUP=$(q  "SELECT sup::text  FROM public.probe_fx")
echo "  item=$ITEM"
echo "  sup =$SUP"
# 🔴 fail-closed 前提斷言(姊妹探針的「假通過 1」:fixture 建失敗 ⇒ ITEM 空字串
#    ⇒ 每發都 ERROR ⇒ 40P01 命中數 = 0 ⇒ 畫面跟「沒有死結」一模一樣)。
[ -n "$ITEM" ] && [ -n "$SUP" ] || { echo "🔴 fixture 沒建起來(item/sup 為空)⇒ 停"; exit 1; }
[ "$(q "SELECT count(*) FROM public.order_items WHERE id='$ITEM'")" = "1" ] \
  || { echo "🔴 order_items 沒有這一列 ⇒ 停"; exit 1; }
# quantity=9 是刻意的:發⑤ 的 A5a 要把 allocated 3→5,額度必須容得下,否則會紅在 A2b1 總量式而不是鎖。
[ "$(q "SELECT quantity FROM public.order_items WHERE id='$ITEM'")" = "9" ] \
  || { echo "🔴 order_items.quantity 不是 9 ⇒ 停(發⑤ 會誤紅在 A2b1 總量式)"; exit 1; }

# fixture 兩型:voided(給發⓪ unvoid 用)/ active(給發④⑤ void 用)
reset_voided() {
  local out; out=$(psql "$URL" -qtAX -c "
    DELETE FROM public.order_item_procurement p USING public.probe_fx f WHERE p.order_item_id = f.item;
    INSERT INTO public.order_item_procurement
      (order_item_id, supplier_id, allocated_quantity, reply_status,
       first_ordered_at, status_changed_at, voided_at, void_reason)
    SELECT f.item, f.sup, 3, 'confirmed', now(), now(), now(), '探針作廢' FROM public.probe_fx f;" 2>&1)
  printf '%s' "$out" | grep -qi 'ERROR' && { echo "🔴 reset_voided 失敗:$(printf '%s' "$out" | grep -i -m1 ERROR)"; exit 1; }
  [ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NOT NULL")" = "1" ] \
    || { echo "🔴 reset_voided 沒建出【一列已作廢】⇒ 停"; exit 1; }
}
reset_active() {
  local out; out=$(psql "$URL" -qtAX -c "
    DELETE FROM public.order_item_procurement p USING public.probe_fx f WHERE p.order_item_id = f.item;
    INSERT INTO public.order_item_procurement
      (order_item_id, supplier_id, allocated_quantity, reply_status,
       first_ordered_at, status_changed_at)
    SELECT f.item, f.sup, 3, 'confirmed', now(), now() FROM public.probe_fx f;" 2>&1)
  printf '%s' "$out" | grep -qi 'ERROR' && { echo "🔴 reset_active 失敗:$(printf '%s' "$out" | grep -i -m1 ERROR)"; exit 1; }
  [ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NULL")" = "1" ] \
    || { echo "🔴 reset_active 沒建出【一列未作廢】⇒ 停"; exit 1; }
}

open_sessions() {
  rm -f "$P/a.in" "$P/b.in"; mkfifo "$P/a.in" "$P/b.in"
  PGAPPNAME=probeA psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/a.in" > "$P/a.out" 2>&1 & APID=$!
  PGAPPNAME=probeB psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/b.in" > "$P/b.out" 2>&1 & BPID=$!
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

# 🔴 這是「兩個 session 真的同時卡住」的觀察點,不是靠 sleep 猜。
# 期望值 = 保持綠 的格必須自帶第二觀察(D-902-A.md:19),這就是那個第二觀察。
witness() {
  echo "  ── 交錯證據($1)──"
  q "SELECT application_name||' | state='||state||' | wait='||coalesce(wait_event_type,'-')||'/'||coalesce(wait_event,'-')||' | '||left(regexp_replace(query,'\s+',' ','g'),52)
       FROM pg_stat_activity WHERE application_name IN ('probeA','probeB') ORDER BY application_name" | sed 's/^/     /'
  # 🔴 鎖【身份】—— 只數「有沒有人卡住」證明不了卡在什麼上面(codex 2026-08-14 nit,對)。
  # 🔴🔴 **第二次更正**(codex R2):列一堆 granted 的 relation lock **不是**「正在等的鎖身份」。
  #    row-lock 等待在 `pg_locks` 的長相是 `locktype='transactionid'` + `relation IS NULL`
  #    ⇒ 光看那一列**看不出等的是哪張表的哪一列**。
  #    真正說得出身份的是這兩樣,所以改成印它們:
  #      ① `pg_blocking_pids()` —— **誰在擋誰**(把等待者接到持有者)
  #      ② 等待者同時持有的 `tuple` 鎖 —— 那一列的 `relation` 就是**它正在排隊要的那張表**
  #         (PG 取 row lock 前會先在該 tuple 上排隊)
  q "SELECT '等待者 '||w.application_name
            ||' 卡在 '||wl.locktype||'/'||wl.mode
            ||' | 排隊中的目標表='||coalesce((SELECT c2.relname FROM pg_locks tl JOIN pg_class c2 ON c2.oid=tl.relation
                                              WHERE tl.pid=w.pid AND tl.locktype='tuple' LIMIT 1),'(無 tuple 鎖)')
            ||' | 被誰擋='||coalesce((SELECT string_agg(b.application_name,',')
                                      FROM unnest(pg_blocking_pids(w.pid)) bp
                                      JOIN pg_stat_activity b ON b.pid=bp),'(無)')
       FROM pg_stat_activity w
       JOIN pg_locks wl ON wl.pid=w.pid AND NOT wl.granted
      WHERE w.application_name IN ('probeA','probeB')" | sed 's/^/     🔒 /'
}
blocked_count() {  # 有幾個 probe session 正卡在 Lock 上
  q "SELECT count(*) FROM pg_stat_activity
      WHERE application_name IN ('probeA','probeB') AND wait_event_type='Lock'"
}

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發⓪ 正向對照:unvoid × A5a(姊妹探針的發②形狀)══"
echo "   期望 = 40P01 = 1 —— 🔴 這一發【必須紅】,否則發④⑤ 的綠沒有意義"
reset_voided
open_sessions
B "BEGIN;"
B "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
B "SELECT quantity FROM public.order_items WHERE id='$ITEM' FOR NO KEY UPDATE;"
sleep 2
A "BEGIN;"
A "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL FOR UPDATE;"
A "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at) VALUES ('$ITEM', '$SUP', 3, 'confirmed', now(), now());"
sleep 3
W0=$(blocked_count); witness "⓪:A 應卡在 order_items(A2b1 trigger)"
B "UPDATE public.order_item_procurement SET voided_at=NULL, void_reason=NULL WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NOT NULL;"
sleep 4
witness "⓪:兩邊都應在等"
sleep 4
A "COMMIT;"; B "COMMIT;"
sleep 3
close_sessions
cp "$P/a.out" "$P/0a.out"; cp "$P/b.out" "$P/0b.out"
echo "   A 側錯誤:"; grep -i 'ERROR' "$P/0a.out" | head -2 | sed 's/^/     /' || true
echo "   B 側錯誤:"; grep -i 'ERROR' "$P/0b.out" | head -2 | sed 's/^/     /' || true
D0=$(cat "$P/0a.out" "$P/0b.out" | grep -c '40P01\|deadlock')
echo "   🔴 40P01 命中數 = $D0(期望 1)"

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發④ void × A5a:void 先持採購列 NKU(void【不】鎖 order_items)══"
echo "   期望 = 40P01 = 0,且 A 真的被 B 的列鎖擋過"
reset_active
open_sessions
B "BEGIN;"
B "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
# 🔴 這裡【故意沒有】 order_items 的 NKU —— C 案下 void 沒有 U6,這正是環斷掉的那條邊。
sleep 2
A "BEGIN;"
A "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL FOR UPDATE;"
sleep 3
W4=$(blocked_count); witness "④:A 應卡在 B 的採購列鎖上"
B "UPDATE public.order_item_procurement SET voided_at=now(), void_reason='探針作廢' WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL;"
B "COMMIT;"
sleep 3
A "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at) VALUES ('$ITEM', '$SUP', 3, 'confirmed', now(), now());"
A "COMMIT;"
sleep 3
close_sessions
cp "$P/a.out" "$P/4a.out"; cp "$P/b.out" "$P/4b.out"
echo "   A 側錯誤:"; grep -i 'ERROR' "$P/4a.out" | head -2 | sed 's/^/     /' || true
echo "   B 側錯誤:"; grep -i 'ERROR' "$P/4b.out" | head -2 | sed 's/^/     /' || true
D4=$(cat "$P/4a.out" "$P/4b.out" | grep -c '40P01\|deadlock')
echo "   40P01 命中數 = $D4(期望 0)"
echo "   🔴 第二觀察 · A 曾被擋住的 session 數 = $W4(期望 >=1;=0 表示根本沒併發 ⇒ 這一發無效)"
echo "   最終狀態:$(q "SELECT count(*)||' 列 / '||count(*) FILTER (WHERE voided_at IS NULL)||' 未作廢' FROM public.order_item_procurement WHERE order_item_id='$ITEM'")"

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 發⑤ void × A5a:反向 —— A5a 先持列鎖【且】持 order_items(走 UPDATE 路徑)══"
echo "   期望 = 40P01 = 0,且 B(void)真的被 A 的列鎖擋過"
reset_active
open_sessions
A "BEGIN;"
A "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL FOR UPDATE;"
# A5a 走 UPDATE 路徑:調升 allocated ⇒ A2b1 不早退 ⇒ 它會去鎖 order_items(parent)
A "UPDATE public.order_item_procurement SET allocated_quantity=5, status_changed_at=now() WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL;"
sleep 3
B "BEGIN;"
B "SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
sleep 3
W5=$(blocked_count); witness "⑤:B 應卡在 A 的採購列鎖上"
A "COMMIT;"
sleep 3
B "UPDATE public.order_item_procurement SET voided_at=now(), void_reason='探針作廢' WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL;"
B "COMMIT;"
sleep 3
close_sessions
cp "$P/a.out" "$P/5a.out"; cp "$P/b.out" "$P/5b.out"
echo "   A 側錯誤:"; grep -i 'ERROR' "$P/5a.out" | head -2 | sed 's/^/     /' || true
echo "   B 側錯誤:"; grep -i 'ERROR' "$P/5b.out" | head -2 | sed 's/^/     /' || true
D5=$(cat "$P/5a.out" "$P/5b.out" | grep -c '40P01\|deadlock')
echo "   40P01 命中數 = $D5(期望 0)"
echo "   🔴 第二觀察 · B 曾被擋住的 session 數 = $W5(期望 >=1;=0 表示根本沒併發 ⇒ 這一發無效)"
echo "   最終狀態:$(q "SELECT count(*)||' 列 / '||count(*) FILTER (WHERE voided_at IS NULL)||' 未作廢' FROM public.order_item_procurement WHERE order_item_id='$ITEM'")"

# ══════════════════════════════════════════════════════════════
echo ""
echo "══ 判讀 ══"
echo "  發⓪(正向對照,期望 1)= $D0"
echo "  發④(期望 0,阻擋數 >=1)= $D4 / 阻擋 $W4"
echo "  發⑤(期望 0,阻擋數 >=1)= $D5 / 阻擋 $W5"
if [ "$D0" -ge 1 ] && [ "$D4" -eq 0 ] && [ "$D5" -eq 0 ] && [ "${W4:-0}" -ge 1 ] && [ "${W5:-0}" -ge 1 ]; then
  echo "  ✅ 假設 A7 成立(已成為觀察):harness 抓得到死結(⓪紅),而 void × A5a 兩個方向都不死結、且兩發都真的併發過。"
  PROBE_RC=0
else
  echo "  🔴 判讀失敗 —— 逐項對照上面三行,不要只看有沒有 ERROR。"
  echo "     ⓪=0 ⇒ harness 壞了或 fixture 沒建對,發④⑤ 的綠【無效】。"
  echo "     阻擋數=0 ⇒ 沒有真的併發,那個 0 是恆綠格。"
  PROBE_RC=1
fi
echo "  輸出留在 $P/(0a 0b 4a 4b 5a 5b .out)"
# 🔴 **exit code 必須反映判讀結果**(codex R2 must-fix,對):
#    舊版判讀失敗只印訊息就結束 ⇒ `$?` = 0 ⇒ 任何自動化(夜跑 / CI / 收割腳本)
#    會把「探針證明失敗」讀成「探針通過」。**印給人看 ≠ 回給機器看。**
exit "${PROBE_RC:-1}"
