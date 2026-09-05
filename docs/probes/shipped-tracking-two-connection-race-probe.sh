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
           # 🔴 **`FAILED` 要【累計】不要設成 1**(codex R2 第 20 條)——
           #    設成 1 的話, 三格失敗時結尾印「PASS=17 FAIL=1 / 讀數 18 格」
           #    ⇒ **總格數與失敗數都失真**, 而讀的人會以為只壞了一格。
           else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED+1)); fi; }

psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  label text NOT NULL,
  tracking_number text,
  tracking_corrected_at timestamptz,
  shipped_at timestamptz NOT NULL DEFAULT pg_catalog.now());
-- 🔴🔴 **id 是 uuid, 不是 bigserial** —— codex 抓到我第一版用 bigserial:
--    正式庫是 `id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid()`
--    (`20260717020000_m4a_email_outbox.sql:298` 逐字)。
--    ⇒ 📌 **用 bigserial 的 fixture, 正式的排序問題【在探針上根本不存在】** ——
--      bigserial 天生單調, 而 uuid 是隨機的。那支探針會印綠, 而它測的是另一個世界。
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id),
  event_type text NOT NULL,
  status text NOT NULL,
  sent_at timestamptz,
  -- 🔴 片 A 加的那一欄:【出門紀錄】= 這封信實際寄出去的號碼。
  sent_tracking_number text,
  sent_seq bigint,
  -- 🔴🔴 **第三欄:出處旗標**(2026-09-05 codex R2 之後加)——
  --    正式那支的分代問的是【這一列是不是片 B 寫的】, **不是** `sent_seq` 在不在:
  --    序號由 DB 的 trigger 蓋, 而 trigger 對**舊 writer 寫的列也會蓋**。
  --    ⇒ 本探針原本沒有這一欄 ⇒ 它模擬不出【部署窗口】那個世界(見下面 4-g)。
  sent_tracking_recorded boolean NOT NULL DEFAULT false);
CREATE SEQUENCE public.pcm_email_outbox_sent_seq;

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
-- 🔴🔴 **2026-09-05 codex R1 nit:這裡與正式 migration【判斷式不同】, 而我原本說它是同一個。**
--    ⛔ ~~`WHEN (SELECT l.sent_tracking_number …) IS NOT NULL`~~
--    🛑 正式那支問的是 **`sent_seq IS NOT NULL`**(=「片 B 寫過這一列」),
--      而不是「號碼是不是 NULL」—— 那兩個在**「片 B 寫了而那封信本來就沒帶號碼」**
--      這個世界裡答案相反(裁定③ 整條就住在那個差別上)。
--    ⇒ 📌 **所以本探針原本證到的是一個【簡化模型】, 不是線上那個判準。**
--      而它的結論(兩連線競態會判反)在兩個模型上都成立 ⇒ **結論沒垮, 而射程被我寫寬了。**
-- ✅ 改成與正式那支同一個判斷式;排序也一起對齊(主鍵 `sent_at`, `sent_seq` 只同刻決勝)。
CREATE FUNCTION public.gen2_should_send(p_ship uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT s.tracking_corrected_at IS NOT NULL
     AND CASE
           WHEN (SELECT l.sent_tracking_recorded FROM public.email_outbox l
                  WHERE l.shipment_id = s.id AND l.status = 'sent' AND l.sent_at IS NOT NULL
                    AND l.event_type IN ('order_shipped','shipment_tracking_corrected')
                  ORDER BY l.sent_seq DESC NULLS LAST, l.sent_at DESC LIMIT 1) IS TRUE
           THEN (SELECT l.sent_tracking_number FROM public.email_outbox l
                  WHERE l.shipment_id = s.id AND l.status = 'sent' AND l.sent_at IS NOT NULL
                    AND l.event_type IN ('order_shipped','shipment_tracking_corrected')
                  ORDER BY l.sent_seq DESC NULLS LAST, l.sent_at DESC LIMIT 1)
                IS DISTINCT FROM s.tracking_number
           ELSE EXISTS (SELECT 1 FROM public.email_outbox e
                         WHERE e.shipment_id = s.id AND e.event_type = 'order_shipped'
                           AND e.status = 'sent' AND e.sent_at IS NOT NULL
                           AND e.sent_at < s.tracking_corrected_at)
         END
    FROM public.shipments s WHERE s.id = p_ship;
$$;
SQL

# 🔴 與 gen2 【只差 ORDER BY】的一支 —— 它存在的理由是讓「排序選錯」這件事看得見。
psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 <<'SQL2'
CREATE FUNCTION public.gen2_uuidorder_should_send(p_ship uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
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
           ELSE false
         END
    FROM public.shipments s WHERE s.id = p_ship;
$$;
SQL2

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
    SELECT pg_catalog.pg_sleep($hold);
    UPDATE public.email_outbox
       SET status = 'sent',
           sent_at = pg_catalog.clock_timestamp(),
           sent_tracking_number = (SELECT n FROM seen),
           -- 🔴 **片 B 的 writer 一定同時寫出處旗標**(即使號碼是 NULL)。
           --    這一支模擬的就是片 B ⇒ 它要寫 true。
           sent_tracking_recorded = true,
           sent_seq = pg_catalog.nextval('public.pcm_email_outbox_sent_seq')
     WHERE shipment_id = '$sid' AND event_type = 'order_shipped';
    COMMIT;" > "$D/sweep-$sid.log" 2>&1
}
# 員工那一邊:把號碼改成 B
staff () {
  local sid="$1" delay="$2"
  psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -c "
    SELECT pg_catalog.pg_sleep($delay);
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

echo "-- 世界4 [同毫秒兩封]: 舊排序(隨機 uuid)選錯, 新排序(sent_seq)選對 --"
# 🔴🔴 **這一格是 codex 那條 must-fix 的實物**:`ORDER BY sent_at DESC, id DESC` 的 `id`
#    是 `gen_random_uuid()` ⇒ 同毫秒兩封時, 它決出來的先後**是隨機的**。
# 🎯 而這裡**不靠運氣示範** —— 兩顆 uuid 寫死, 讓舊排序【確定】選錯那一封:
#      出貨信(說 A)id = ffffffff-…  ⇒ `id DESC` 排最前
#      更正信(說 B)id = 00000000-…  ⇒ `id DESC` 排最後
#    兩封 `sent_at` 完全相同, 而真正的先後是 `sent_seq` 1 → 2。
# ⇒ 正確答案:最後告訴客人的是 **B**, 而現在也是 **B** ⇒ **不該寄**。
# 🔴 `q1` 對 INSERT..RETURNING 會多帶一行命令標籤(`INSERT 0 1`)⇒ 只取第一行。
#    不取的話那個 uuid 會變成「uuid + 換行 + INSERT 0 1」, 而 psql 報的是型別錯誤,
#    看起來像 uuid 產錯了。(2026-09-05 當場撞到。)
S4=$(q1 "INSERT INTO public.shipments(label, tracking_number, tracking_corrected_at) VALUES ('W4TIE','B', pg_catalog.clock_timestamp()) RETURNING id" | head -1)
psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.email_outbox(id, shipment_id, event_type, status, sent_at, sent_tracking_number, sent_seq, sent_tracking_recorded)
  VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff','$S4','order_shipped','sent','2026-09-05 12:00:00+08','A',1,true),
         ('00000000-0000-4000-8000-000000000000','$S4','shipment_tracking_corrected','sent','2026-09-05 12:00:00+08','B',2,true);"
check "4-a 兩封 sent_at 完全相同(本格的前提)" "1" "$(q1 "SELECT count(DISTINCT sent_at)::text FROM public.email_outbox WHERE shipment_id='$S4'")"
check "4-b 現在的號碼" "B" "$(q1 "SELECT tracking_number FROM public.shipments WHERE id='$S4'")"
check "4-c 舊排序挑出來的最後一封" "A" "$(q1 "SELECT sent_tracking_number FROM public.email_outbox WHERE shipment_id='$S4' ORDER BY sent_at DESC, id DESC LIMIT 1")"
# 🔴 這一格的排序要與正式那支逐字一致(主鍵 sent_at, sent_seq 同刻決勝)——
#    本格兩封的 sent_at **刻意完全相同**(4-a 在證這件事)⇒ 決勝的就是 sent_seq。
check "4-d 新排序挑出來的最後一封" "B" "$(q1 "SELECT sent_tracking_number FROM public.email_outbox WHERE shipment_id='$S4' ORDER BY sent_at DESC, sent_seq DESC NULLS LAST LIMIT 1")"
check "4-e 用舊排序的判準(會寄一封多餘的)" "true"  "$(q1 "SELECT public.gen2_uuidorder_should_send('$S4')::text")"
check "4-f 用 sent_seq 的判準(不寄)" "false" "$(q1 "SELECT public.gen2_should_send('$S4')::text")"
echo "  -> 兩者只差 ORDER BY 一行:舊的寄一封多餘的更正信給號碼已經正確的客人, 新的不寄。"

# ══ 5 · 🔴🔴 部署窗口:**舊 writer 寫的列, trigger 照樣蓋了 seq** ═══════════════
#    這一組是 2026-09-05 codex R2 那條 must-fix 的量具, 而**上面四組全部量不到它**:
#    它們每一列都同時有 seq 與號碼 ⇒ 「分代看 seq」與「分代看旗標」在那些世界裡答案相同。
echo "── 5 · 部署窗口(migration 已貼、片 B 的碼還沒上)──"
S5=$(q1 "INSERT INTO public.shipments(label, tracking_number, tracking_corrected_at) VALUES ('W5WIN','B', pg_catalog.clock_timestamp()) RETURNING id" | head -1)
psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.email_outbox(shipment_id, event_type, status, sent_at, sent_tracking_number, sent_seq, sent_tracking_recorded)
  VALUES ('$S5','order_shipped','sent', pg_catalog.clock_timestamp() + interval '1 hour', NULL,
          pg_catalog.nextval('public.pcm_email_outbox_sent_seq'), false);"
check "5-a 那一列有 seq(trigger 蓋的, 而它蓋每一列)" "true" "$(q1 "SELECT (sent_seq IS NOT NULL)::text FROM public.email_outbox WHERE shipment_id='$S5'")"
check "5-b 而它沒有號碼、也沒有出處旗標" "false|false" "$(q1 "SELECT (sent_tracking_number IS NOT NULL)::text || '|' || sent_tracking_recorded::text FROM public.email_outbox WHERE shipment_id='$S5'")"
check "5-c 正式判準(問旗標)⇒ 不寄" "false" "$(q1 "SELECT public.gen2_should_send('$S5')::text")"
check "5-d 分代改回問 seq ⇒ 會寄(= 那條 must-fix 的後果)" "true" "$(q1 "
  SELECT (s.tracking_corrected_at IS NOT NULL
     AND CASE WHEN (SELECT l.sent_seq FROM public.email_outbox l
                     WHERE l.shipment_id = s.id AND l.status='sent' AND l.sent_at IS NOT NULL
                     ORDER BY l.sent_seq DESC NULLS LAST LIMIT 1) IS NOT NULL
              THEN (SELECT l.sent_tracking_number FROM public.email_outbox l
                     WHERE l.shipment_id = s.id AND l.status='sent' AND l.sent_at IS NOT NULL
                     ORDER BY l.sent_seq DESC NULLS LAST LIMIT 1) IS DISTINCT FROM s.tracking_number
              ELSE false END)::text
    FROM public.shipments s WHERE s.id='$S5'")"
echo "  -> 兩者只差【分代問哪一欄】:問 seq 的那一版, 在部署窗口裡寄一封多餘的更正信給號碼本來就正確的客人。"

echo "── ⚪ 零留痕 ──"
# 🔴🔴 **這一格的第一版是 `check "..." "$D" "$D"` —— 拿 $D 跟 $D 比 ⇒ 恆綠。**
#    trap 有沒有真的刪掉目錄, 它一個字都沒量到。(codex 2026-09-05 抓到。)
# 🛑 **而【從腳本內部】本來就驗不到 trap 的執行** —— trap 在 exit 時才跑, 那時這裡已經結束了。
#    ⇒ 📌 所以誠實的做法不是編一個看起來在驗的斷言, 是**驗兩件真的驗得到的**, 並把驗不到的寫出來。
is_tmp () { case "$1" in /tmp/*) return 0 ;; /var/folders/*) return 0 ;; esac
            case "$1" in "${TMPDIR:-/nope}"*) return 0 ;; esac ; return 1 ; }
check "5-a 資料庫在系統暫存區底下(它是拋棄式的位置)" "yes" \
  "$(is_tmp "$D" && echo yes || echo no)"
# 🟢 負對照:同一把尺餵一個【不是】暫存區的路徑, 它必須說 no —— 否則 5-a 是恆綠的。
check "5-a 負對照(餵 /Users/sean_1 必須說 no)" "no" \
  "$(is_tmp /Users/sean_1 && echo yes || echo no)"
check "5-b EXIT trap 真的掛上去了(而不是只寫在註解裡)" "yes" \
  "$(trap -p EXIT | grep -q "rm -rf" && echo yes || echo no)"
echo "  🛑 驗不到的:trap 執行【之後】那個目錄在不在 —— 那要另一個行程去看, 不在本檔射程。"
echo "  🔵 資料庫在 $D;本檔全程只連 127.0.0.1:$PORT 那一台, 不碰任何既有的庫。"

printf '\n── 讀數 %s 格:PASS=%s FAIL=%s ──\n' "$((PASSED + FAILED))" "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] && echo "OK 全過" || echo "X 有格子紅了"
exit "$FAILED"
