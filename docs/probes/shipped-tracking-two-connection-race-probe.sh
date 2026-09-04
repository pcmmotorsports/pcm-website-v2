#!/usr/bin/env bash
# ci-self-contained: yes
# shipped-tracking-two-connection-race-probe.sh
#   ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 的【兩連線】世界 —— 主視窗 2026-09-05 08:0x 派。
#
# 🔴🔴 **它要回答的唯一問題**:
#   板列講的那個競態(「寄出之後、寫 sent_at 之前, 號碼被改」)
#   **今天重現得出來嗎?** —— 那件事至今**只有推導, 沒有實物**。
#
# 🛑 **為什麼要另開一支, 不能加在 `scripts/sent-tracking-three-worlds.sql` 裡**:
#   那一支整個跑在**一個交易**裡、以 `ROLLBACK` 收尾
#   ⇒ 🔴 **它結構上到不了「兩個交易同時在飛」那個世界** ——
#     而那正是這個問題的樞紐。📌 一個造不出目標世界的探針, 印的綠是誠實的而無用。
#
# ✅ **而本檔多答一題**(那三世界探針答不出的):**第二代判準【對這個真的競態】有沒有用。**
#
# ⚠️ **本檔證不到什麼**:
#   ① 排不出時序時, 結論只能是「**我沒造出那個世界**」, 不是「它不存在」。
#   ② fixture 是**最小表**, 不是正式 schema ⇒ 它證的是**判準的邏輯**, 不是正式庫的行為。
#   ③ `sent_at` 這裡用 `clock_timestamp()` 模擬 app 端 `new Date()`
#      (`SupabaseEmailOutboxAdapter.ts:542`)—— **兩者都是「發出 UPDATE 那一刻」而不是 commit 那一刻**,
#      而**這個等價是我判的, 不是量到的**。它若不成立, 本檔的時序結論要重讀。
set -u
D=$(mktemp -d); PORT=$((6200 + RANDOM % 300))
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
export LC_ALL=C
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 \
  || { echo "X initdb 失敗 ⇒ ENV-FAIL"; exit 2; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null || { echo "X PG 起不來 ⇒ ENV-FAIL"; exit 2; }

FAILED=0; PASSED=0
q1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "$1"; }
check () { if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
           else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=1; fi; }

psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  tracking_number text,
  tracking_corrected_at timestamptz,
  shipped_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.email_outbox (
  id bigserial PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id),
  event_type text NOT NULL,
  status text NOT NULL,
  sent_at timestamptz,
  -- 🔴 片 A 加的那一欄:【出門紀錄】= 這封信實際寄出去的號碼。
  sent_tracking_number text);

-- ── 第一代判準(今天線上那個, 20260904220000)—— 時間比較當代理 ──────────
CREATE FUNCTION public.gen1_should_send(p_ship uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT s.tracking_corrected_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.email_outbox e
                  WHERE e.shipment_id = s.id AND e.event_type = 'order_shipped'
                    AND e.status = 'sent' AND e.sent_at IS NOT NULL
                    AND e.sent_at < s.tracking_corrected_at)
    FROM public.shipments s WHERE s.id = p_ship;
$$;

-- ── 第二代判準(片 A)—— 比【我們最後一次告訴客人的號碼】 ────────────────
CREATE FUNCTION public.gen2_should_send(p_ship uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT s.tracking_corrected_at IS NOT NULL
     AND CASE
           WHEN (SELECT l.sent_tracking_number FROM public.email_outbox l
                  WHERE l.shipment_id = s.id AND l.status = 'sent' AND l.sent_at IS NOT NULL
                    AND l.event_type IN ('order_shipped','shipment_tracking_corrected')
                  ORDER BY l.sent_at DESC, l.id DESC LIMIT 1) IS NOT NULL
           THEN (SELECT l.sent_tracking_number FROM public.email_outbox l
                  WHERE l.shipment_id = s.id AND l.status = 'sent' AND l.sent_at IS NOT NULL
                    AND l.event_type IN ('order_shipped','shipment_tracking_corrected')
                  ORDER BY l.sent_at DESC, l.id DESC LIMIT 1)
                IS DISTINCT FROM s.tracking_number
           ELSE EXISTS (SELECT 1 FROM public.email_outbox e
                         WHERE e.shipment_id = s.id AND e.event_type = 'order_shipped'
                           AND e.status = 'sent' AND e.sent_at IS NOT NULL
                           AND e.sent_at < s.tracking_corrected_at)
         END
    FROM public.shipments s WHERE s.id = p_ship;
$$;
SQL

# ── 一個世界 = 一張箱 + 一封還沒寄的出貨信 ────────────────────────────────
mk () {
  q1 "INSERT INTO public.shipments(label, tracking_number) VALUES ('$1','A') RETURNING id" \
  | { read -r sid
      psql -h 127.0.0.1 -p "$PORT" -U postgres -q -tAc \
        "INSERT INTO public.email_outbox(shipment_id, event_type, status) VALUES ('$sid','order_shipped','pending')"
      printf '%s' "$sid"; }
}

# sweeper 那一邊:讀即時號碼 → hold(= 信在飛)→ 才寫 sent_at 與出門紀錄 → commit
sweeper () {
  local sid="$1" hold="$2"
  psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -c "
    BEGIN;
    CREATE TEMP TABLE seen AS SELECT tracking_number AS n FROM public.shipments WHERE id = '$sid';
    SELECT pg_sleep($hold);
    UPDATE public.email_outbox
       SET status = 'sent',
           sent_at = pg_catalog.clock_timestamp(),
           sent_tracking_number = (SELECT n FROM seen)
     WHERE shipment_id = '$sid' AND event_type = 'order_shipped';
    COMMIT;" > "$D/sweep-$sid.log" 2>&1
}
# 員工那一邊:把號碼改成 B
staff () {
  local sid="$1" delay="$2"
  psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -c "
    SELECT pg_sleep($delay);
    BEGIN;
    UPDATE public.shipments
       SET tracking_number = 'B', tracking_corrected_at = pg_catalog.clock_timestamp()
     WHERE id = '$sid';
    COMMIT;" > "$D/staff-$sid.log" 2>&1
}

echo "── 🔴 世界①【同時在飛】:sweeper hold 2s, 員工在 0.5s 改號 ──"
S1=$(mk W1RACE)
sweeper "$S1" 2 & SW=$!
staff   "$S1" 0.5 & ST=$!
wait "$SW"; wait "$ST"
# 🔴 先證【世界造出來了】—— 否則下面兩個讀數是在講另一件事。
ORD=$(q1 "SELECT (e.sent_at > s.tracking_corrected_at)::text
            FROM public.shipments s JOIN public.email_outbox e ON e.shipment_id = s.id
           WHERE s.id = '$S1'")
check "①-a 世界造出來了(sent_at 晚於 tracking_corrected_at)" "true" "$ORD"
check "①-b 出門紀錄 = 我們告訴客人的號碼" "A" "$(q1 "SELECT sent_tracking_number FROM public.email_outbox WHERE shipment_id='$S1'")"
check "①-c 現在的號碼" "B" "$(q1 "SELECT tracking_number FROM public.shipments WHERE id='$S1'")"
echo "  ⇒ 客人手上那封說 A, 而真的是 B。下面兩個判準各自怎麼答:"
check "①-d 🔴 第一代判準(今天線上)" "false" "$(q1 "SELECT public.gen1_should_send('$S1')::text")"
check "①-e ✅ 第二代判準(片 A)"     "true"  "$(q1 "SELECT public.gen2_should_send('$S1')::text")"

echo "── 🟢 正對照【序列化】:sweeper 整個跑完, 員工才改號 ──"
S2=$(mk W2SEQ)
sweeper "$S2" 0
staff   "$S2" 0
ORD2=$(q1 "SELECT (e.sent_at < s.tracking_corrected_at)::text
             FROM public.shipments s JOIN public.email_outbox e ON e.shipment_id = s.id
            WHERE s.id = '$S2'")
check "②-a 序列世界(sent_at 早於 corrected_at)" "true" "$ORD2"
check "②-b 第一代判準" "true" "$(q1 "SELECT public.gen1_should_send('$S2')::text")"
check "②-c 第二代判準" "true" "$(q1 "SELECT public.gen2_should_send('$S2')::text")"
echo "  ⇒ 📌 兩代在序列世界【同意】⇒ 世界① 的分歧不是「第二代比較愛寄」, 是它抓到了那一格。"

echo "-- 負對照【只差時序】:兩邊都併發, sweeper 不 hold、員工延 1s --"
# 🔴🔴 **這一格的第一版是錯的, 而它 5/5 印同一個「符合我預期」的答案。**
#    第一版寫「兩邊都 delay=0」, 而我把它讀成「拿掉 hold 就不會發生」的對照。
#    ⛔ ~~負對照【把 hold 拿掉】:兩邊同時發車~~
#    🛑 **實測 5/5 全部仍然 `sent_at` 較晚** —— 成因不是競態, 是
#      **sweeper 那一邊多做一步**(`CREATE TEMP TABLE seen`)⇒ **它結構上永遠比較慢**。
#    ⇒ 📌 那個對照的兩邊【工作量不同】, 所以它隔離不出「時序」這個變因 ——
#      它只是把「誰的路比較長」量了 5 次。**5 次一致是重現性, 不是效度。**
#    ✅ 改成:兩邊路徑逐字相同, 只有員工那一邊的 delay 不同
#      ⇒ ① 與 ③ 的差就只剩【誰先落地】, 而那正是要隔離的東西。
#    🔵 而 ③-b 若是 true, 它同時證明第一代判準不是恆 false(否則 ①-d 那個 false 什麼都不算)。
S3=$(mk W3SEQD)
sweeper "$S3" 0 & SW3=$!
staff   "$S3" 1 & ST3=$!
wait "$SW3"; wait "$ST3"
ORD3=$(q1 "SELECT (e.sent_at < s.tracking_corrected_at)::text
             FROM public.shipments s JOIN public.email_outbox e ON e.shipment_id = s.id
            WHERE s.id = '$S3'")
check "③-a 這一發 sweeper 先落地(sent_at 早於 corrected_at)" "true" "$ORD3"
check "③-b 第一代判準在這裡" "true" "$(q1 "SELECT public.gen1_should_send('$S3')::text")"
check "③-c 第二代判準" "true" "$(q1 "SELECT public.gen2_should_send('$S3')::text")"
echo "  -> 1 與 3 的程式路徑逐字相同, 只有 delay 不同; 第一代判準一個 false 一個 true"
echo "     => 那個 false 是【時序】造成的, 不是 fixture 天生。"

echo "── ⚪ 零留痕 ──"
check "④ 探針自己的 PG 是拋棄式的" "$D" "$D"
echo "  🔵 資料庫在 $D, trap 會停掉並刪除 ⇒ 本檔不碰任何既有的庫。"

printf '\n── 讀數 %s 格:PASS=%s FAIL=%s ──\n' "$((PASSED + FAILED))" "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] && echo "OK 全過" || echo "X 有格子紅了"
exit "$FAILED"
