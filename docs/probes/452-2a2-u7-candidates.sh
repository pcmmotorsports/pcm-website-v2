#!/usr/bin/env bash
# ci-self-contained: no — 需先跑 scripts/452-verify.sh provision 起庫並用 PORT= 指過去
# ============================================================
# #452 片 2a-2 · 探針 2/2 —— U7 候選案(C1 / C2)哪個消得掉 40P01
# ============================================================
# 🔴 這是【證據】不是【工具】。對【拋棄式庫】跑,不對正式庫跑,不進 CI。落點在 docs/ 是刻意的。
# 🔴 前置:本支沿用探針 1 的 fixture 表 `public.probe_fx`,**必須先跑過同目錄的 452-2a2-lockprobe.sh
#    所建的庫**(或自己照它的 §0 建 fixture)。
#
# ── ① 這支量到了什麼(A 側 = 模擬【真 A5a】的兩圈重試)────────
#   | 案            | 40P01 | 外露 23505 | A5a 結果 | 最終狀態      |
#   | 基準線(無機制)|  1   |     0      | CREATED  | 2 列 / 1 未作廢 |
#   | **C1** advisory |  0   |     0      | UPDATED  | 1 列 / 1 未作廢 |
#   | **C2** 先寫後驗 |  0   |     0      | UPDATED  | 1 列 / 1 未作廢 |
#   ⇒ **兩案都消得掉死結**;C1 已由主視窗 2026-08-14 定案(理由見 plan §2.4「為什麼不是 C2」)。
#   ⇒ C2 的數字**刻意留著**:它可行、輸在代價,下一個人不用重跑。
#
#   🔴 **一條沒人預測過的語意後果(兩案皆同)**:競態下 A5a 的結果是 **UPDATED 而非 CREATED**、
#      最終只剩 1 列 ⇒ **Sean 拍的 Q-S1=A「舊的作廢紀錄留著查帳」在競態窗有例外**
#      (那筆作廢被 unvoid 吃掉,`void_reason` 沒了,只剩 admin_audit_log 兩筆)。
#      詳見 plan §8.6「拍板字面的已知例外」。
#
# ── ② 前提 ──────────────────────────────────────────────
#   · 拋棄式 PostgreSQL **17.10**,跑完即拆。
#   · 🔴 void / unvoid RPC 當時**不存在** ⇒ 本支**模擬**它們的鎖形狀
#     ⇒ 證的是**鎖與索引的交互**,不是 RPC 行為。
#   · 🔴 **C1 的 advisory 位置是承重的**:本支只實測「advisory **最先取**」這一種擺位。
#     若排在 U6(order_items NKU)**之後**,理論上是**另一條死結環**(**未實測**)
#     ⇒ plan 已把「advisory 必須是第一把鎖」釘進步表 V0/U0。**要改擺位請先重跑本支。**
#   · 不用 heredoc(同探針 1 的理由),用 FIFO 控制交錯。
#
# ── ③ 🔴 我在這支上量錯過一次(寫下來,免得有人照 v1 的做法重來)──
#   v1 的 A 側是「seek 之後**無條件 INSERT**」⇒ **比真的 A5a 笨**。
#   真 A5a(`20260806200000:313-447`)是 `FOR v_try IN 1..2 LOOP`:找到列 → UPDATE;
#   找不到 → INSERT;撞 unique_violation 且**索引名對得上** → `v_retry=true` → 第二圈。
#   ⇒ **23505 在真 A5a 裡是【被吸收的】,不是使用者看得到的錯。**
#   v1 把它算成「紅」⇒ 我差點回報「兩個候選都還有殘留 23505」而否決掉兩個可行案。
#   🔴 **形狀 = 量具比被量物笨**;而且錯的方向是**偏嚴格** ⇒ **保守方向的錯一樣是錯。**
#   本版(v2)把 A 側換成同形狀的 DO 區塊,兩案的外露 23505 都是 0。
# ============================================================
set -uo pipefail
W=/tmp/452-u7probe
PORT="${PORT:-54462}"
URL="postgresql://postgres@/postgres?host=${W}/sock&port=${PORT}"
P=$W/probe2
rm -rf "$P"; mkdir -p "$P"
q() { psql "$URL" -tAX -c "$1" 2>&1; }
ITEM=$(q "SELECT item::text FROM public.probe_fx"); SUP=$(q "SELECT sup::text FROM public.probe_fx")
[ -n "$ITEM" ] && [ -n "$SUP" ] || { echo "🔴 fixture 空 ⇒ 停"; exit 1; }
echo "fixture: item=$ITEM sup=$SUP"

reset_fx() {
  local out; out=$(psql "$URL" -qtAX -c "
    DELETE FROM public.order_item_procurement p USING public.probe_fx f WHERE p.order_item_id=f.item;
    INSERT INTO public.order_item_procurement
      (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at, voided_at, void_reason)
    SELECT f.item, f.sup, 3, 'confirmed', now(), now(), now(), '探針作廢' FROM public.probe_fx f;" 2>&1)
  printf '%s' "$out" | grep -qi ERROR && { echo "🔴 reset_fx 失敗:$out"; exit 1; }
  [ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NOT NULL")" = "1" ] \
    || { echo "🔴 reset_fx 前提不成立 ⇒ 停"; exit 1; }
}
open_s() {
  rm -f "$P/a.in" "$P/b.in"; mkfifo "$P/a.in" "$P/b.in"
  PGAPPNAME=probeA psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/a.in" > "$P/a.out" 2>&1 & APID=$!
  PGAPPNAME=probeB psql "$URL" -X -a -v ON_ERROR_STOP=0 < "$P/b.in" > "$P/b.out" 2>&1 & BPID=$!
  exec 7> "$P/a.in"; exec 8> "$P/b.in"; sleep 1
}
close_s() { printf '\\q\n' >&7 2>/dev/null; printf '\\q\n' >&8 2>/dev/null; exec 7>&- 2>/dev/null; exec 8>&- 2>/dev/null; wait "$APID" 2>/dev/null; wait "$BPID" 2>/dev/null; }
A() { printf '%s\n' "$1" >&7; }
B() { printf '%s\n' "$1" >&8; }

ADV="SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended('$ITEM'||':'||'$SUP', 0));"
LOCK_ROW="SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' FOR NO KEY UPDATE;"
LOCK_PARENT="SELECT quantity FROM public.order_items WHERE id='$ITEM' FOR NO KEY UPDATE;"
U7="SELECT count(*) AS active_sibling FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL;"
UNVOID="UPDATE public.order_item_procurement SET voided_at=NULL, void_reason=NULL WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NOT NULL;"

# 🔴 A 側 = 真 A5a 的形狀:兩圈、存在性分流、unique_violation 比對索引名後重試
a5a_block() {
cat <<SQLBLOCK
DO \$a\$
DECLARE v_id uuid; v_try int; v_retry boolean; v_res text := NULL;
BEGIN
  FOR v_try IN 1..2 LOOP
    SELECT id INTO v_id FROM public.order_item_procurement
     WHERE order_item_id='$ITEM' AND supplier_id='$SUP' AND voided_at IS NULL FOR UPDATE;
    IF FOUND THEN
      UPDATE public.order_item_procurement SET allocated_quantity=3, status_changed_at=now() WHERE id=v_id;
      v_res := 'UPDATED'; EXIT;
    END IF;
    v_retry := false;
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at, status_changed_at)
      VALUES ('$ITEM','$SUP',3,'confirmed',now(),now());
    EXCEPTION WHEN unique_violation THEN
      DECLARE v_con text;
      BEGIN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN RAISE; END IF;
        v_retry := true;
      END;
    END;
    IF v_retry THEN CONTINUE; END IF;
    v_res := 'CREATED'; EXIT;
  END LOOP;
  RAISE NOTICE 'A5A_RESULT=%', coalesce(v_res,'<未收斂>');
END \$a\$;
SQLBLOCK
}
A5A="$(a5a_block | tr '\n' ' ')"

verdict() {
  local dl dup res
  dl=$(cat "$P/a.out" "$P/b.out" | grep -c 'deadlock detected')
  dup=$(cat "$P/a.out" "$P/b.out" | grep -c 'ERROR:  duplicate key')
  res=$(grep '^NOTICE:  A5A_RESULT=' "$P/a.out" | head -1)
  printf '   %-30s 40P01=%s  外露23505=%s  %s\n' "$1" "$dl" "$dup" "${res:-A5A_RESULT=<無>}"
  cat "$P/a.out" "$P/b.out" | grep -m1 -E 'deadlock detected|ERROR:  duplicate key' | sed 's/^/       /' || true
  printf '   最終狀態:未作廢列數=%s 總列數=%s\n' \
    "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM' AND voided_at IS NULL")" \
    "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")"
}

echo ""
echo "════ 基準線(無機制)════"
reset_fx; open_s
B "BEGIN;"; B "$LOCK_ROW"; B "$LOCK_PARENT"; sleep 2
A "BEGIN;"; A "$A5A"; sleep 3
B "$U7"; B "$UNVOID"; sleep 6
A "COMMIT;"; B "COMMIT;"; sleep 3; close_s
verdict "基準 期望 40P01=1"

echo ""
echo "════ C1:雙方取同一把 advisory xact lock ════"
reset_fx; open_s
B "BEGIN;"; B "$ADV"; B "$LOCK_ROW"; B "$LOCK_PARENT"; sleep 2
A "BEGIN;"; A "$ADV"; A "$A5A"; sleep 3
B "$U7"; B "$UNVOID"; B "COMMIT;"; sleep 6
A "COMMIT;"; sleep 3; close_s
verdict "C1 期望 40P01=0"

echo ""
echo "════ C2:unvoid 先寫、再取 parent、最後驗 ════"
reset_fx; open_s
B "BEGIN;"; B "$LOCK_ROW"; B "$UNVOID"; B "$LOCK_PARENT"; B "$U7"; sleep 2
A "BEGIN;"; A "$A5A"; sleep 3
B "COMMIT;"; sleep 6
A "COMMIT;"; sleep 3; close_s
verdict "C2 期望 40P01=0"
