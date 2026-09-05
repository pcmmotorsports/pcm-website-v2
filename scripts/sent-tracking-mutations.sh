#!/usr/bin/env bash
# ci-self-contained: no  (要一台已 apply 完 migrations 的 PG;用 migrations-replay-from-zero.sh --keep-db 起)
# sent-tracking-mutations.sh —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 的【承重點突變】。
#
# 🔴🔴 **它與 `sent-tracking-three-worlds.sql` 的分工**:
#   那一支證「判準在十個世界裡答對了」;**本支證「那些答案是【被哪一行】撐住的」。**
#   ⇒ 📌 十格全綠而某一行其實可以拿掉 ⇒ 那一行不是承重, 而測試不會告訴你。
#
# 🎯 **本支最重要的設計:每一格突變的 view SQL 都是【跑的時候從 migration 抽出來】的,**
#    **然後只做【一次字串取代】** ⇒ **「只差一個變因」是機械保證的, 不是我保證的。**
#    🔴 而那正是我在 `shipped-tracking-two-connection-race-probe.sh` 做錯過的事:
#      我宣稱「兩個世界只差 delay」, 而實際上 hold 也改了(codex 2026-09-05 抓到)。
#      ⇒ **人保證不了「我只改了一個東西」—— 那要由產生它的方式保證。**
#
# ⚠️ **它證不到什麼**:
#   ① 它只證那四行【現在】是承重的, 不證它們涵蓋了所有該擋的世界。
#   ② 它跑在拋棄式 PG 上 ⇒ 答的是判準的邏輯, 不是正式庫的行為。
#   ③ 突變是【字串取代】⇒ 有人改了那幾行的寫法(空白、換行), 錨會找不到 ⇒ **本支會紅**,
#     而那是【對的】:錨找不到就代表我不知道自己在測什麼。
set -u
PORT="${1:-}"
MIG=supabase/migrations/20260905200000_m4b_outbox_record_sent_tracking_number.sql
[ -n "$PORT" ] || { echo "用法: bash $0 <PG port>   (先跑 migrations-replay-from-zero.sh --keep-db)"; exit 2; }
[ -f "$MIG" ] || { echo "🔴 找不到 $MIG"; exit 3; }

FAILED=0; PASSED=0
q1 () { psql -h /tmp -p "$PORT" -U postgres -d postgres -tAc "$1" 2>&1; }
chk () { if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
         else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED+1)); fi ; }

# 🟢 先把十個世界灌進去(它自己是 BEGIN…ROLLBACK, 所以這裡要【不 rollback】的版本)。
#    ⇒ 用 psql 的 -v 讓那支檔跳過結尾的 ROLLBACK 做不到 ⇒ 改成在同一個 session 裡先跑 fixture 再測。
#    🔴 而那正是本支需要一台【專用】PG 的理由:它會留下資料。
# ── 從 migration 抽出真的 view SQL(跑的時候抽, 不是抄一份)──
# 🔴 **順序很重要**:先抽 ⇒ 再灌世界 ⇒ **再還原 view** ⇒ 才量基準。
#    因為那支 fixture 跑完時 view 停在【它自己的突變版】(它靠 ROLLBACK 收尾, 而本支不 rollback)。
python3 - "$MIG" > /tmp/view-real.sql <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
key='CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending\n  WITH (security_invoker = true) AS'
assert s.count(key)==1, f'錨命中 {s.count(key)} 次 ⇒ 拒繼續(我不知道自己抽到什麼)'
i=s.find(key); j=s.find('COMMENT ON VIEW public.pcm_tracking_corrected_email_pending', i)
v=s[i:j].rstrip(); assert v.endswith(';')
sys.stdout.write(v)
PY
[ -s /tmp/view-real.sql ] || { echo "🔴 抽不出 view SQL ⇒ 拒繼續"; exit 3; }

echo "── 灌世界(sent-tracking-three-worlds.sql;ROLLBACK 換成 COMMIT)──"
# 🔴 **換成 COMMIT 不是換成註解** —— 換成註解的話交易永遠不結束,
#    psql 一離開就整批回滾 ⇒ 基準集合是空的, 而**空比空**會讓「還原」那幾格【恆真】。
#    (2026-09-05 當場踩到:PASS=4 全部來自那個恆真。)
sed 's/^ROLLBACK;$/COMMIT;/' scripts/sent-tracking-three-worlds.sql \
  | psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q > /tmp/mut-fixture.log 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then echo "🔴 灌世界失敗 rc=$RC ⇒ 後面每一格都不算數"; tail -3 /tmp/mut-fixture.log; exit 3; fi

# 🔵 把 view 還原成 migration 那一版(fixture 留下的是它自己的突變版)
psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/view-real.sql > /dev/null 2>&1

SET_SQL="SELECT string_agg(display_id, ',' ORDER BY display_id) FROM public.pcm_tracking_corrected_email_pending"
BASE=$(q1 "$SET_SQL")
chk "基準(未突變)集合" "WRD222,WRD333,WRD666,WRD999,WRDB22,WRDD44" "$BASE"

mutate () {  # $1=標籤 $2=舊字面 $3=新字面 $4=期望集合(或 ERROR)
  python3 - "$2" "$3" > /tmp/view-mut.sql <<'PY'
import io,sys
v=io.open('/tmp/view-real.sql',encoding='utf-8').read()
old,new=sys.argv[1],sys.argv[2]
n=v.count(old)
assert n>=1, f'突變錨【找不到】: {old!r} ⇒ 拒繼續(錨找不到就代表我不知道自己在測什麼)'
sys.stdout.write(v.replace(old,new))
PY
  if [ ! -s /tmp/view-mut.sql ]; then chk "$1(錨)" "found" "not-found"; return; fi
  psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/view-mut.sql > /dev/null 2>&1
  local got; got=$(q1 "$SET_SQL")
  case "$got" in *ERROR*) got="ERROR" ;; esac
  chk "$1" "$4" "$got"
  psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/view-real.sql > /dev/null 2>&1
  local back; back=$(q1 "$SET_SQL")
  chk "$1 · 還原" "$BASE" "$back"
}

echo "-- 四格承重點突變(每一格:突變 ⇒ 集合必須【變成預期的樣子】⇒ 還原 ⇒ 必須回到基準)--"

# 🔴 預測寫在跑之前, 逐格附推理 —— 不是抄觀察值。
# A:拿掉綁 order_id ⇒ 一箱兩單共用「最後一封」。SHP888 上兩封 seq 遞增, 後者(WRD999 的)說 A。
#   ⇒ WRD888 的「最後告知」被誤讀成 A ≠ 現在的 B ⇒ 它【多出來】= 誤寄。
mutate "A order 關聯" \
  "             AND last.order_id   = o.id
" "" \
  "WRD222,WRD333,WRD666,WRD888,WRD999,WRDB22,WRDD44"

# B:換回裸 cast ⇒ WRDB22 的 payload 是 'bad' ⇒ PG 不保證求值順序 ⇒ 整張 view 炸掉。
#   🔴 期望是 ERROR 而【不是少一列】—— 那個差別就是本片裁定②的全部。
mutate "B UUID 守門" \
  "public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id" \
  "(last.payload ->> 'shipment_id')::uuid = s.id" \
  "ERROR"

# C:換回用隨機 uuid 決勝 ⇒ WRDC33 兩封 sent_at 相同, 而說 A 那封的 id 是 ffff…
#   ⇒ id DESC 必挑到 A ≠ 現在的 B ⇒ 它【多出來】= 寄一封多餘的更正信。
mutate "C ORDER BY 單調序號" \
  "ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC" \
  "ORDER BY last.sent_at DESC, last.id DESC" \
  "WRD222,WRD333,WRD666,WRD999,WRDB22,WRDC33,WRDD44"

# D:判斷式改回問號碼 ⇒ WRDD44(片 B 寫的而沒帶號碼)被當成「片 B 之前的舊列」
#   ⇒ 落到時間比較 ⇒ 它寄在更正之後 ⇒ 【不寄】⇒ 它消失 = 裁定③ 靜靜失效。
mutate "D 用 seq 分辨兩種 NULL" \
  "          SELECT last.sent_seq
" "          SELECT last.sent_tracking_number
" \
  "WRD222,WRD333,WRD666,WRD999,WRDB22"

printf '\n── 讀數 %s 格:PASS=%s FAIL=%s ──\n' "$((PASSED + FAILED))" "$PASSED" "$FAILED"
if [ "$FAILED" -eq 0 ]; then echo "OK 四格突變全部落在目標上"; else echo "X 有格子紅了"; fi
exit "$FAILED"
