#!/usr/bin/env bash
# ============================================================
# A7b-M 可重現驗證 harness — order_refund_jobs + order_refund_job_items
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7
# 用法:scripts/a7bm-verify.sh all /tmp/a7bmv   (從零 provision,最完整)
#      scripts/a7bm-verify.sh run /tmp/a7bmv   (重用既有拋棄式 cluster)
#
# ── 這支腳本在證明什麼、不證明什麼(誠實邊界)────────────────
# 證明:①migration 疊在全部既有 migration 之上可套用 ②檔內結構驗收 DO block 全過
#      ③dormant gate **雙向**(在 ⇒ 擋;拿掉 ⇒ 同一筆改紅在 FK)
#      ④下列 N 條**承重**結構斷言各有一個突變能單獨打紅它。
# 🔴 **不證明**:
#      · 狀態機行為(七態 16 條 edge 的守門全在 A7b-T,本片是 M 型、零 trigger)
#      · 36 條 CHECK 的**逐條**負向行為(那是 A7b-T 的 §7.2 一對一矩陣,約 90 格)
#      · 正式站行為(本機 PG17.10 非 Supabase、C locale ≠ en_US.UTF-8)
#      · 鎖窗上限(barrier lock probe 在 A7b-T,plan §10)
#      ⇒ **本片不得宣稱「狀態機已鎖對」或「退款不會退兩次」。**
#
# 🔴 判定紀律(A7 / A7-t / A1 三片的教訓,不重蹈)
#  ① 突變必須**紅在指定的那條斷言**,不是「反正紅了就算抓到」。
#  ② 每個 sed 突變都要驗「真的改到東西」(cmp),否則 sed 沒命中 = 零突變卻宣稱紅了。
#  ③ 對照組必跑:沒有對照組,全紅毫無意義。
#  ④ 任何當基準的查詢都要 fail-closed(驗退出碼 + stderr 空 + sentinel)。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a7bm-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7bmv)}"
MIG="supabase/migrations/20260731120000_m4b_e10_a7b_m_refund_jobs.sql"
PORT=54329
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }

# workdir 身分閘(這支腳本會 rm -rf 它)
case "$(cd / && printf '%s' "$WORK")" in
  /tmp/?*) : ;;
  *) echo "🔴 workdir 必須在 /tmp 底下(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;; esac

runsql() { psql "$URL" -qtA -c "$1" 2>&1; }

# 🔴 fail-closed 快照(A1 的教訓:查詢自己語法錯誤時 base 與 after 會是同一則 ERROR ⇒
#    diff 為空 ⇒ 判成「零漂移」。三道:退出碼 / stderr 空 / 補 sentinel)。
snapshot() {  # $1=SQL $2=輸出檔 $3=用途
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$1" > "$2" 2>"$2.err"
  local rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$2.err" ]; then
    echo "🔴 快照查詢失敗($3,rc=$rc):$(head -1 "$2.err" 2>/dev/null)"; exit 1
  fi
  printf 'SNAPSHOT-OK\n' >> "$2"
}

if [ "$MODE" = "all" ]; then
  log "0/6 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成(全部既有 migration + A7b-M 依序套用)"
else
  mkdir -p "$WORK"
fi

# ── harness 自我測試:壞掉的快照 SQL 必須當場中止 ──────────────
( snapshot "SELECT this_column_does_not_exist FROM pg_class" "$WORK/selftest.snap" "自我測試" ) >/dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "🔴 harness 自我測試失敗:壞掉的快照 SQL 竟然沒有讓 snapshot() 中止"; exit 1
fi
ok "harness 自我測試:壞掉的快照 SQL 會當場中止(不會變成假的零漂移)"

log "1/6 對照組:零突變下,migration 的結構驗收必須通過"
apply_out="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" 2>&1)"
# 表已存在 ⇒ 重套會 42P07。改用「物件已在且驗收曾通過」當對照組。
if echo "$apply_out" | grep -q 'already exists'; then
  # run 模式重用既有 cluster ⇒ 表已存在、重套必然 42P07。
  # 🔴 **這裡不去讀 provision.log 當證據** —— run 模式的 workdir 可能根本沒跑過 provision,
  #    那樣會變成「找不到檔案 = 判紅」的假失敗。真正的對照組是第 5 步(同一條 DROP→重建路徑)。
  ok "對照組(重用既有 cluster):A7b-M 物件已存在;真正的對照組在第 5 步"
elif echo "$apply_out" | grep -q 'A7b-M 結構驗收全數通過'; then
  ok "對照組:apply + 結構驗收綠"
else
  bad "對照組:apply 未通過 — $(echo "$apply_out" | grep -m1 ERROR)"
fi

log "2/6 物件盤點(數字型斷言:改了必須有人發現)"
[ "$(runsql "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_refund_jobs'::regclass AND attnum>0 AND NOT attisdropped")" = "42" ] \
  && ok "order_refund_jobs = 42 欄" || bad "order_refund_jobs 欄數不是 42"
[ "$(runsql "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_refund_job_items'::regclass AND attnum>0 AND NOT attisdropped")" = "7" ] \
  && ok "order_refund_job_items = 7 欄" || bad "items 欄數不是 7"
[ "$(runsql "SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.order_refund_jobs'::regclass,'public.order_refund_job_items'::regclass) AND NOT tgisinternal")" = "0" ] \
  && ok "M 型:零 user trigger(守門全在 A7b-T)" || bad "本片竟有 user trigger"
[ "$(runsql "SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.order_refund_jobs'::regclass,'public.order_refund_job_items'::regclass) AND contype='f' AND confdeltype<>'r'")" = "0" ] \
  && ok "七支 FK 全部 ON DELETE RESTRICT" || bad "有 FK 不是 RESTRICT"
[ "$(runsql "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('orj_one_current_per_cancellation_idx','orj_one_current_per_rec_trade_idx','orj_one_job_per_refund_idx')")" = "3" ] \
  && ok "三道 partial unique 存在(U2/U3/U5)" || bad "partial unique 缺漏"

log "3/6 dormant gate 雙向(plan §1.1:只測一個方向等於沒證明它被移除過)"
H="$(printf 'a1b2c3d4%.0s' 1 2 3 4 5 6 7 8)"
LEGAL_INSERT="INSERT INTO public.order_refund_jobs
  (cancellation_id, order_id, rec_trade_id, bank_refund_id, payload_hash,
   refund_amount, items_amount, shipping_fee_before, shipping_fee_after, shipping_delta,
   reason, actor, request_id)
 VALUES (gen_random_uuid(), gen_random_uuid(), 'REC0000000000000001', 'BRF0000000000000001', '$H',
   900, 1000, 0, 100, 100, '客人要求取消', 'nobody', 'req-0001');"

# 方向①:gate 在 ⇒ 一筆「所有 CHECK 都合法」的 INSERT 必須紅在 gate 本身(不是別的 CHECK)。
out="$(psql "$URL" -qtA -v ON_ERROR_STOP=0 -c "BEGIN; $LEGAL_INSERT ROLLBACK;" 2>&1)"
echo "$out" | grep -q 'order_refund_jobs_dormant_until_triggers' \
  && ok "方向①:gate 在 ⇒ 合法列被擋,且紅在 order_refund_jobs_dormant_until_triggers" \
  || bad "方向①:沒有紅在 dormant gate — $(echo "$out" | head -1)"

# 方向②:gate 拿掉(模擬 A7b-T 的最後一步)⇒ 同一筆必須**通過全部 36 條 CHECK**、改紅在 FK。
# 🔴 這個方向同時證明兩件事:①gate 是 CHECK 層唯一的擋點 ②複合 FK 真的接對了。
out="$(psql "$URL" -qtA -v ON_ERROR_STOP=0 -c \
  "BEGIN; ALTER TABLE public.order_refund_jobs DROP CONSTRAINT order_refund_jobs_dormant_until_triggers; $LEGAL_INSERT ROLLBACK;" 2>&1)"
echo "$out" | grep -q 'orj_cancellation_fk' \
  && ok "方向②:gate 拿掉 ⇒ 同一筆通過全部 CHECK、改紅在 orj_cancellation_fk" \
  || bad "方向②:預期紅在 orj_cancellation_fk — $(echo "$out" | head -1)"

# 零留痕:上面兩個交易都 ROLLBACK 了。
[ "$(runsql "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_refund_jobs'::regclass AND conname='order_refund_jobs_dormant_until_triggers'")" = "CHECK (false)" ] \
  && ok "零留痕:gate 仍在且定義未變" || bad "零留痕失敗:gate 不見了或被改過"
[ "$(runsql "SELECT count(*) FROM public.order_refund_jobs")" = "0" ] \
  && ok "零留痕:jobs 表仍為空" || bad "零留痕失敗:jobs 表有殘留列"

log "4/6 結構突變(每條承重斷言各一個突變;必須紅在**指定的**那條)"
# 🔴 每個突變都先 cmp 驗「sed 真的改到東西」—— sed 沒命中會變成「零突變卻宣稱紅了」。
mutate() {  # $1=sed 表達式  $2=預期錯誤訊息片段  $3=說明
  local tmp="$WORK/mut.sql"
  sed "$1" "$MIG" > "$tmp"
  if cmp -s "$MIG" "$tmp"; then bad "突變沒命中(sed 未改到任何東西):$3"; return; fi
  # 在乾淨交易裡套用突變版:先 DROP 兩表再重建,全程 ROLLBACK ⇒ 對 cluster 零留痕。
  local out
  out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
DROP TABLE public.order_refund_job_items;
DROP TABLE public.order_refund_jobs;
$(sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$tmp")
ROLLBACK;
SQL
)"
  if echo "$out" | grep -qF "$2"; then
    ok "突變「$3」⇒ 紅在指定斷言"
  else
    bad "突變「$3」⇒ 沒有紅在指定斷言(實:$(echo "$out" | grep -m1 -E 'ERROR|A7b-M' | cut -c1-120))"
  fi
}

mutate 's/CHECK (false)$/CHECK (true)/' \
       'dormant gate 定義不是 CHECK (false)' \
       'gate 改成 CHECK (true)(約束仍存在、但完全失效)'
mutate 's/ON DELETE RESTRICT,\n/ON DELETE CASCADE,\n/; s/REFERENCES public.staff (id) ON DELETE RESTRICT,$/REFERENCES public.staff (id) ON DELETE CASCADE,/' \
       '不是 ON DELETE RESTRICT' \
       'staff FK 改成 CASCADE(刪員工會連退款工作一起刪)'
mutate 's/WHERE status <> .completed. AND reviewed_at IS NULL;/WHERE status <> '"'"'completed'"'"';/' \
       'U2 定義不符' \
       'U2 拿掉 reviewed_at IS NULL(未複核的 dead 不再擋新 job = 退第二次錢)'
mutate "s/AT TIME ZONE 'Asia\/Taipei')::date/)::date/g" \
       'D9b 隔日閘沒有 Asia/Taipei 日界' \
       'D9b 拿掉 Asia/Taipei(改隨 session TimeZone 走)'
# 🔴 連同它的 COMMENT ON CONSTRAINT 一起刪 —— 否則會先炸在 COMMENT(「constraint does not exist」),
#    那也是 fail-closed,但**紅在錯的地方**,證明不了 DO block 的具名清單斷言有效。
mutate '/CONSTRAINT orj_retry_auth_next_day_gate CHECK (/,/^  ),$/d; /^COMMENT ON CONSTRAINT orj_retry_auth_next_day_gate/,+1d' \
       'CHECK 約束 orj_retry_auth_next_day_gate 不存在' \
       '整條刪掉 D9b 隔日閘'
mutate 's/GRANT SELECT, INSERT         ON TABLE public.order_refund_job_items TO service_role;/GRANT SELECT, INSERT, UPDATE ON TABLE public.order_refund_job_items TO service_role;/' \
       'service_role 竟持有 order_refund_job_items.UPDATE' \
       '子表多給 UPDATE(凍結快照的第一層被拆掉)'
mutate '/ENABLE ROW LEVEL SECURITY;$/d' \
       '未啟用 RLS' \
       '拿掉兩表的 RLS'

# ── 🔴 專打 codex 關卡2 指名的四條「假綠」路徑(v2 新增的指紋斷言是否真的承重)──
mutate 's/  refund_amount     integer     NOT NULL CHECK (refund_amount > 0),/  refund_amount     bigint      NOT NULL CHECK (refund_amount > 0),/' \
       '欄位指紋不符' \
       'refund_amount 改成 bigint(舊版只數 42 欄 ⇒ 全綠)'
mutate 's/    OR retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before/    OR true OR retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before/' \
       '兩表約束指紋不符' \
       'D9d 改成恆真但字面全留(舊版只驗「同名存在」⇒ 全綠)'
mutate 's/CONSTRAINT orj_cancellation_generation_key UNIQUE (cancellation_id, generation),/CONSTRAINT orj_cancellation_generation_key UNIQUE (order_id, generation),/' \
       '兩表約束指紋不符' \
       'U1 欄組改成 (order_id, generation)(第二次退款防線消失、舊版全綠)'
mutate '/^CREATE INDEX orj_due_submitted_idx/d' \
       '兩表索引指紋不符' \
       '刪掉一個排程索引(舊版完全沒有索引斷言)'

# 🔴🔴 **本 harness 仍抓不到的(誠實揭示,不是待辦)**:
#    上面第 2 條證明了「恆真但字面仍留」現在會被**約束指紋**抓到 ——
#    但指紋只說得出「有東西變了」,**說不出「D9d 這條規則實際上還擋不擋得住錢」**。
#    🔴 那件事唯一的證明方式是**行為負測**(塞一筆該被它擋下的列),
#    而 A7b-M 期間 **dormant gate 擋住所有 INSERT** ⇒ **本片物理上做不到**。
#    ⇒ **錢面四條的「承重性」明文歸屬 A7b-T 的 §7.2 一對一矩陣**;
#      本片只證明到「它們的定義沒有被悄悄改掉」。

log "5/6 對照組再跑一次(證明上面的紅不是因為 harness 自己壞了)"
out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
DROP TABLE public.order_refund_job_items;
DROP TABLE public.order_refund_jobs;
$(sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$MIG")
ROLLBACK;
SQL
)"
echo "$out" | grep -q 'A7b-M 結構驗收全數通過' \
  && ok "對照組(零突變、同一條路徑)⇒ 結構驗收仍然全過" \
  || bad "對照組失敗 — $(echo "$out" | grep -m1 ERROR | cut -c1-160)"

log "6/6 結果"
printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
