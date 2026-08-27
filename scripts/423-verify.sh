#!/usr/bin/env bash
# ============================================================
# #423 行為 harness —— 手動收款(OP5)與沖銷(OP-A12)的**同交易稽核**
# ============================================================
# 規格 = 信箱 D-568-PLAN v3 §6(關卡1 Fable 九條全折、主視窗 D-574-A 窄確認 PASS)。
# migration = supabase/migrations/20260812150000_m4b_e10_423_payment_audit.sql
#
# 分工照 op5-verify.sh:migration 檔尾只做不依賴業務資料的**結構**斷言;
# 真正的行為(稽核落一列、逐欄正確、重放留痕、失敗零稽核、敏感值不外洩)在這裡。
#
# 🔴 判定紀律:每格自己比數量與欄位值;fail-closed;每格跑完 ROLLBACK 零留痕。
#    突變格的語意 = 攻擊 SQL 在 mutant 下觀察到行為翻面則 ok;殺不死 = 該格紅。
#
# 用法:PORT=54387 bash scripts/423-verify.sh all /tmp/423-work
#       all = 自己 provision 一座拋棄式叢集再跑;run = 用既有的
# ⚠️ **本腳本不 teardown**(照姊妹腳本 d1t2-rehearsal.sh 的慣例):叢集與 workdir 留著給人事後查,
#    跑完自己收 —— `bash scripts/d1t2-rehearsal.sh teardown /tmp/423-work`。
#    留著不收的話下一輪 `all` 會撞 port 佔用閘(那道閘會擋、不會靜默共用別人的庫)。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: 423-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(/tmp 底下的短路徑)}"
PORT="${PORT:-54387}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

# 🔴 自檢:SQL 註解內不得出現反引號 / ASCII 雙引號(照抄 op5-verify.sh 的機制)。
SELF_BAD="$(grep -nE '^[[:space:]]+--.*[`"]' "${BASH_SOURCE[0]}" || true)"
if [ -n "$SELF_BAD" ]; then
  echo "🔴 自檢失敗:SQL 註解含反引號或 ASCII 雙引號"; printf '%s\n' "$SELF_BAD" | head -5; exit 2
fi

PASS=0; FAIL=0; MUT=0
EXPECTED_TOTAL=21
EXPECTED_MUT=6
# 🔴 MUT 的定義(關卡2 R2 codex P4-①② 抓到,已修):MUT 只算**真的構造出壞版本、並觀察到行為翻面**
#    的格。原本靶④/靶⑤ 只讀健康碼就 MUT+1 —— 那是虛報(與 R1 抓到的靶⑦ 同一個病、當時只改被點名處)。
#    現在健康碼那兩格降級成一般 PASS 格(P3/P7),真突變另立 靶④M / 靶⑤a / 靶⑤b。
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log()  { echo "== $* =="; }
q()    { psql "$URL" -tAX -c "$1" 2>&1; }
# 🔴 取查詢結果**不靠行位置**:psql 會把 BEGIN/ROLLBACK 這些指令標籤也印出來,
#    第一版用 tail -1 撈到的是 ROLLBACK ⇒ 八格假紅(計數閘當場抓到,見 D-578-NOTE)。
#    改成在 SELECT 裡自帶 sentinel 前綴,再用 grep 挑出來。
res()  { psql "$URL" -tAX -c "$1" 2>&1 | grep '^R423|' | head -1 | sed 's/^R423|//'; }

case "$WORK" in
  /tmp/[!/]*) : ;;
  *) echo "🔴 workdir 必須是 /tmp/<名字>(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in
  */) echo "🔴 workdir 不得以斜線結尾"; exit 2 ;;
  *//*|*..*) echo "🔴 workdir 形狀不合法"; exit 2 ;;
esac
[ -L "$WORK" ] && { echo "🔴 workdir 是 symlink"; exit 2; }

if [ "$MODE" = "all" ]; then
  command -v lsof >/dev/null 2>&1 || { echo "🔴 找不到 lsof ⇒ fail-closed"; exit 2; }
  [ -z "$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)" ] \
    || { echo "🔴 port ${PORT} 被佔用 ⇒ 換 PORT 重跑"; exit 2; }
  # 🔴 ownership marker(照 d1t2-rehearsal.sh:249 同款):形狀檢查擋得住 /、$HOME 這類,
  #    擋不住「打錯一個字、剛好是別人的 /tmp/<名字>」。存在但不是本 harness 建的 ⇒ 拒刪。
  if [ -e "$WORK" ]; then
    [ -f "$WORK/.d1t2-harness" ] \
      || { echo "🔴 $WORK 存在但沒有 ownership marker(.d1t2-harness)⇒ 拒絕遞迴刪除"; exit 2; }
  fi
  rm -rf "$WORK"
  PORT="$PORT" bash scripts/d1t2-rehearsal.sh provision "$WORK" >/dev/null 2>&1 \
    || { echo "🔴 provision 失敗"; exit 2; }
fi

# ── 身分閘:確認連到的就是這座拋棄式叢集(不是別窗的、更不是正式庫)────────────
log "身分閘"
DD="$(q "SELECT current_setting('data_directory')")"
[ "$DD" = "$WORK/pgdata" ] || { echo "🔴 身分閘:data_directory=$DD,期望 $WORK/pgdata ⇒ 拒繼續"; exit 2; }
ok "連到的是 $WORK/pgdata"

# ── G1 對照組:本片已套 ────────────────────────────────────────────────────
log "G1 對照組"
# 🔴 prosrc **含註解**(repo 老坑):實作刪掉但說明註解還留著這串字時,直接搜 prosrc 這格恆綠。
#    比之前先剝掉行內註解,作法逐字照 20260810210000:345-346。
G1="$(q "SELECT (position('payment.record.replay' in
             regexp_replace(p.prosrc, '--[^'||chr(10)||']*', '', 'g')) > 0)::text
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='admin_record_manual_payment'")"
[ "$G1" = "true" ] && ok "OP5 已套 #423" || bad "OP5 未套 #423(拿到:$G1)"

OID="$(q "SELECT id FROM orders WHERE cancelled_at IS NULL ORDER BY created_at LIMIT 1")"
[ -n "$OID" ] || { echo "🔴 找不到 fixture 訂單 ⇒ 拒繼續(seed 沒跑?)"; exit 2; }
ok "fixture order = $OID"

# 🔴 sentinel 值刻意獨特(Fable N2):用常見字串的話,「沒出現」可能因為撞到別的內容而恆真。
REF='CTBC-SENTINEL-77341'
NOTE='NOTE-SENTINEL-99527'
K1='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
K2='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

pay() { echo "SELECT admin_record_manual_payment('$OID'::uuid,'$1'::uuid,'sean','bank_transfer',$2,'2026-08-12T00:00:00+08:00'::timestamptz,'$REF','$NOTE');"; }
# 🔴 現金軌(關卡2 R2 codex P4-③):上面 pay() 的兩個敏感欄**永遠有值** ⇒ has_* 恆為 true
#    ⇒ 把那兩個布林寫死成 true 的壞版本,在只有 pay() 的世界裡殺不死(fixture 讓守門恆真的老坑)。
#    cash 軌的 bank_reference 依 OP1 rail_fields 必須是 NULL、payer_note 這裡也不送 ⇒ 兩個 has_* 都是 false。
#    received_at 用 now():cash 軌的 G7 下限是訂單成立的**精確時點**(不是台北曆日),now() 必定晚於它。
paycash() { echo "SELECT admin_record_manual_payment('$OID'::uuid,'$1'::uuid,'sean','cash',$2,now(),NULL,NULL);"; }

# ── P1 正常路徑:恰一列、逐欄正確 ─────────────────────────────────────────
log "P1 正常路徑"
# 🔴 target 比的是**完整字串**不是 payment: 前綴,after 逐欄比**帳本那一列自己的值** ——
#    只比前綴的話,指到別筆收款、或 after 的金額/軌別/時點寫錯,這格照樣全綠(關卡2)。
#    兩個 count 先釘住 1|1 ⇒ 下面的 cross join 只可能是一列,head -1 沒有東西可藏。
R="$(res "BEGIN; $(pay "$K1" 1180)
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log)
       ||'|'||(SELECT count(*) FROM order_payments WHERE order_id='$OID'::uuid)
       ||'|'||a.action||'|'||a.actor||'|'||a.request_id
       ||'|'||(a.target = 'payment:'||p.id::text)::text
       ||'|'||(a.after->>'order_id' = p.order_id::text)::text
       ||'|'||(a.after->>'rail' = p.rail)::text
       ||'|'||((a.after->>'amount')::int = p.amount)::text
       ||'|'||((a.after->>'received_at')::timestamptz = p.received_at)::text
       ||'|'||(a.before IS NULL)::text
    FROM admin_audit_log a, order_payments p
   WHERE p.order_id='$OID'::uuid; ROLLBACK;")"
case "$R" in
  "1|1|payment.record|sean|$K1|true|true|true|true|true|true")
    ok "恰 1 列;action/actor/request_id 對、target=payment:<那列 id>、after 的 order/rail/amount/received_at 逐欄等於帳本列、before 為 NULL" ;;
  *) bad "P1 拿到:$R" ;;
esac

# ── N2 敏感值不得進稽核(只准 has_*)───────────────────────────────────────
log "N2 敏感值"
# 🔴 掃**三條路徑**(正常 / 重放 / 沖銷)的 before **與** after ——
#    舊版只掃正常路徑的 after,值搬到重放或沖銷的 before 去洩漏時整份 harness 仍全綠(關卡2)。
#    第一格釘住稽核總列數 = 3,少一條路徑沒跑到就會紅(不然「沒掃到」與「沒外洩」分不開)。
R="$(res "BEGIN; $(pay "$K1" 1180) $(pay "$K1" 1180)
  SELECT admin_reverse_manual_payment(
    (SELECT id FROM order_payments WHERE order_id='$OID'::uuid AND reverses_payment_id IS NULL
      ORDER BY created_at DESC LIMIT 1), 'sean', '登錄時金額打錯');
  SELECT 'R423|'||count(*)
       ||'|'||bool_or(coalesce(before::text,'')||coalesce(after::text,'') LIKE '%$REF%')::text
       ||'|'||bool_or(coalesce(before::text,'')||coalesce(after::text,'') LIKE '%$NOTE%')::text
       ||'|'||count(*) FILTER (WHERE after->>'has_bank_reference' = 'true')
       ||'|'||count(*) FILTER (WHERE after->>'has_payer_note' = 'true')
    FROM admin_audit_log; ROLLBACK;")"
[ "$R" = "3|false|false|1|1" ] \
  && ok "正常/重放/沖銷三條路徑的 before+after 全掃過:單號/備註的值零外洩,has_* 恰在正常路徑那列" \
  || bad "N2 拿到:$R(期望 3|false|false|1|1)"

# ── P4 重放:**每一次**各一列(N 次 = N 列;Fable N3)、收款列不增 ──────────
log "P4 重放"
R="$(res "BEGIN; $(pay "$K1" 1180) $(pay "$K1" 1180) $(pay "$K1" 1180)
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log WHERE action='payment.record')||'|'
       ||(SELECT count(*) FROM admin_audit_log WHERE action='payment.record.replay')||'|'
       ||(SELECT count(*) FROM order_payments WHERE order_id='$OID'::uuid); ROLLBACK;")"
[ "$R" = "1|2|1" ] && ok "1 正常 + 2 重放 = 2 列 replay、收款列仍 1" || bad "P4 拿到:$R(期望 1|2|1)"

# ── P5 重放路徑的稽核筆數守(plan §6 C2 格)─────────────────────────────────
log "P5 重放稽核筆數守"
# 🔴 靶② 打的是**正常**路徑;`pcm_op5_audit_replay_row_count` 在這格之前**零行為覆蓋**
#    —— 在本格加進來**之前**,這支 harness 沒有任何一格會讓它翻紅
#    (本註解本身就含那串字,所以「grep 命中 = 0」這種數法寫下當天就過期,別再那樣寫)。
#    當時只有 migration 檔尾②驗了「這串字還在」= 存在性斷言。
#    失敗情境:trigger 吞列時**重放**路徑靜默回 `idempotent: true` + 稽核零列 ——
#    而 Q-D16=B「重放要留痕」整條裁定就是為這條路存在的。
# 🔴 構造:先成功登一筆(此時還沒掛 trigger)→ 掛 swallow → **同鍵**再送一次 ⇒ 走冪等分支。
# 🔴 錨用**「重放稽核落 0 列」全字串**:「稽核落 0 列」是它的子字串(正常路徑那道的訊息),
#    拿子字串當錨會與靶② 混淆 ⇒ 這格對「重放守被拿掉、正常守照樣發火」零判別力。
# 🔴 健康碼對照組 = 上面 P4 那格(同樣的同鍵重送、沒有 trigger,拿到 1|2|1 而非例外)。
R="$(q "BEGIN; $(pay "$K1" 1180)
  CREATE FUNCTION pg_temp.swallow5() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
  CREATE TRIGGER zz_swallow5 BEFORE INSERT ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION pg_temp.swallow5();
  $(pay "$K1" 1180)
  ROLLBACK;" | grep -c '重放稽核落 0 列')"
[ "$R" -ge 1 ] && ok "P5:重放稽核被吞 ⇒ 重放筆數守發火(不是靜默回 idempotent:true)" \
  || bad "P5:重放守沒發火(「重放稽核落 0 列」命中數 $R ⇒ 那條路的守門殺不死)"

# ── N1 失敗路徑:零稽核 ───────────────────────────────────────────────────
log "N1 失敗路徑"
# 🔴 用 DO 區塊接住例外,**不能**用 SAVEPOINT + 多句 -c:psql 的 -c 是一個查詢字串,
#    第一個錯誤會中止整批 ⇒ 後面的 ROLLBACK TO 與 SELECT 根本沒跑(第一版就是這樣假紅)。
# 🔴 同時斷言**收款列也是 0**:只驗 audit=0 的話,「呼叫根本沒送出」也會過(恆真)。
R="$(res "BEGIN;
  DO \$n1\$ BEGIN
    PERFORM admin_record_manual_payment('$OID'::uuid,'$K2'::uuid,'sean','bank_transfer',0,
      '2026-08-12T00:00:00+08:00'::timestamptz,'$REF','$NOTE');
    RAISE EXCEPTION 'N1-NO-RAISE:金額 0 竟然通過了';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'N1-NO-RAISE%' THEN RAISE; END IF;
  END \$n1\$;
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log)||'|'
       ||(SELECT count(*) FROM order_payments WHERE order_id='$OID'::uuid); ROLLBACK;")"
[ "$R" = "0|0" ] && ok "金額 0 被擋 ⇒ 稽核零列且收款零列" || bad "N1 拿到:$R(期望 0|0)"

# ── P2 沖銷 + F1 request_id 規格 ──────────────────────────────────────────
log "P2 沖銷 / F1"
# 🔴 前兩格先釘住列數(總 2 列、其中 payment.reverse 恰 1)——
#    舊版沒有總數斷言、又是無關聯 cross join 配 res() 的 head -1:多寫一列稽核、
#    或配到別筆沖銷列時,多出來的那些列直接被丟掉、這格照樣綠(關卡2)。
#    沖銷的 actor 刻意用 staff_1(不是登錄那筆的 sean)⇒ 證明它來自 p_actor 而非抄前一列。
R="$(res "BEGIN; $(pay "$K1" 5000)
  SELECT admin_reverse_manual_payment(
    (SELECT id FROM order_payments WHERE order_id='$OID'::uuid AND reverses_payment_id IS NULL
      ORDER BY created_at DESC LIMIT 1), 'staff_1', '登錄時金額打錯');
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log)
       ||'|'||(SELECT count(*) FROM admin_audit_log WHERE action='payment.reverse')
       ||'|'||a.actor||'|'||a.reason
       ||'|'||(a.target = 'payment:'||p.id::text)::text
       ||'|'||(a.request_id = p.id::text)::text
       ||'|'||(a.before->>'payment_id' = p.reverses_payment_id::text)::text
       ||'|'||((a.before->>'amount')::int = 5000)::text
       ||'|'||((a.after->>'amount')::int = -5000)::text
       ||'|'||(a.after->>'reversal_id' = p.id::text)::text
    FROM admin_audit_log a, order_payments p
   WHERE a.action='payment.reverse' AND p.reverses_payment_id IS NOT NULL
     AND p.order_id='$OID'::uuid; ROLLBACK;")"
[ "$R" = "2|1|staff_1|登錄時金額打錯|true|true|true|true|true|true" ] \
  && ok "沖銷稽核:總 2 列/沖銷恰 1 列、actor 來自 p_actor、reason 對、target 與 request_id=沖銷列 id(F1)、before 指向被沖那列且金額 5000、after 為 -5000" \
  || bad "P2/F1 拿到:$R"

# ── P8 沖銷稽核筆數守(A12 的行為覆蓋;R3 Fable MF1)─────────────────────────
log "P8 沖銷稽核筆數守"
# 🔴 這格補的洞與 P5 完全同形,只是換另一支函式:`pcm_opa12_audit_row_count` 在這格之前
#    只被 migration 檔尾② 驗過「這串字還在」= 存在性斷言,沒有任何一格會讓它翻紅。
#    存活突變 = 把 A12 的 `IF v_audit_n <> 1` 改恆假(約束名字面留著)⇒ 檔尾斷言與其餘各格全綠。
# 🔴 P5 那格的立論(拒絕拿靶② 當「機制已證明」)**對 A12 一樣適用** —— 我原本只做了 OP5 那一半,
#    這正是「同族只改被點名處」。
# 🔴 錨用**帶函式名的全前綴** `admin_reverse_manual_payment: 稽核落 0 列`:
#    「稽核落 0 列」是 OP5 正常路徑那道的訊息本文、也是「重放稽核落 0 列」的子字串,
#    三者互吃 ⇒ 不帶函式名的話這格對「A12 那道被拿掉」零判別力。
# 🔴 健康碼對照組 = 上面 P2 那格(同樣的登錄+沖銷、沒有 trigger ⇒ 拿到完整那串而不是例外)。
R="$(q "BEGIN; $(pay "$K1" 5000)
  CREATE FUNCTION pg_temp.swallow12() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
  CREATE TRIGGER zz_swallow12 BEFORE INSERT ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION pg_temp.swallow12();
  SELECT admin_reverse_manual_payment(
    (SELECT id FROM order_payments WHERE order_id='$OID'::uuid AND reverses_payment_id IS NULL
      ORDER BY created_at DESC LIMIT 1), 'staff_1', '登錄時金額打錯');
  ROLLBACK;" | grep -c 'admin_reverse_manual_payment: 稽核落 0 列')"
if [ "$R" -ge 1 ]; then ok "P8:沖銷稽核被吞 ⇒ A12 筆數守發火(不是靜默回 reversed:true)"; MUT=$((MUT+1));
else bad "P8:A12 稽核守沒發火(全前綴錨命中數 $R ⇒ 那條路的守門殺不死)"; fi

# ── P9 重放列逐欄內容(R3 Fable C4 + nit8)──────────────────────────────────
log "P9 重放列逐欄"
# 🔴 P4 只數了重放列的**筆數**、N2 只掃了它有沒有洩敏感值 —— 沒有一格看過它**寫了什麼**。
#    replay 的 target/request_id/before 三個欄位寫錯時,兩格都還是綠的。
# 🔴 併 nit8:順便釘 source_app 與「record 路徑的 reason 必須是 NULL」(表單沒有原因欄)。
R="$(res "BEGIN; $(pay "$K1" 1180) $(pay "$K1" 1180)
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log WHERE action='payment.record.replay')
       ||'|'||a.request_id
       ||'|'||(a.target = 'payment:'||p.id::text)::text
       ||'|'||(a.before->>'payment_id' = p.id::text)::text
       ||'|'||((a.before->>'amount')::int = p.amount)::text
       ||'|'||(a.after = a.before)::text
       ||'|'||a.source_app
       ||'|'||(a.reason IS NULL)::text
       ||'|'||(SELECT bool_and(reason IS NULL) FROM admin_audit_log WHERE action='payment.record')::text
    FROM admin_audit_log a, order_payments p
   WHERE a.action='payment.record.replay' AND p.order_id='$OID'::uuid; ROLLBACK;")"
[ "$R" = "1|$K1|true|true|true|true|admin|true|true" ] \
  && ok "P9:重放列 request_id/target/before 逐欄指回既有那筆、after 與 before 同形、source_app=admin、兩條 record 路徑的 reason 皆 NULL" \
  || bad "P9 拿到:$R(期望 1|$K1|true|true|true|true|admin|true|true)"

# ── P3 actor 逐字來自 p_actor(靶④M 的健康碼對照組)────────────────────────
log "P3 actor 來源"
# 🔴 列數要自己釘:單看 max(actor) 的話,多寫一列 sean 也還是 staff_1(max 取字典序大的)⇒
#    這格單獨零判別力、只靠 P1/N2 的列數斷言撐著。釘了 1 就不必依賴別格。
# 🔴 這格**不計 MUT**:它是健康碼觀察,不是突變。真的殺突變在下面的 靶④M。
R="$(res "BEGIN;
  SELECT admin_record_manual_payment('$OID'::uuid,'$K2'::uuid,'staff_1','bank_transfer',1180,
    '2026-08-12T00:00:00+08:00'::timestamptz,'$REF','$NOTE');
  SELECT 'R423|'||count(*)||'|'||max(actor) FROM admin_audit_log; ROLLBACK;")"
[ "$R" = "1|staff_1" ] && ok "P3:恰 1 列且 actor 逐字來自 p_actor(不是寫死)" || bad "P3 拿到:$R(期望 1|staff_1)"

# ── P6 現金軌:兩個 has_* 都是 false(靶⑤b 的健康碼對照組)─────────────────
log "P6 現金軌 has_* 為 false"
# 🔴 這格是整份 harness 裡**唯一**能看見 has_* 為 false 的觀察點 —— 沒有它,
#    「把 has_* 寫死成 true」這種壞版本在所有 bank_transfer 格底下都是全綠的(fixture 恆真坑)。
# 🔴 count(*) 走子查詢、不與非聚合欄同層(同層會缺 GROUP BY 直接是 SQL 錯 ⇒ res() 撈到空字串、
#    這格紅。第一版就是這樣紅的,是計數閘先發現的,照 P1 的寫法修。)
R="$(res "BEGIN; $(paycash "$K1" 640)
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log)
       ||'|'||(after->>'has_bank_reference')||'|'||(after->>'has_payer_note')
    FROM admin_audit_log; ROLLBACK;")"
[ "$R" = "1|false|false" ] \
  && ok "P6:現金軌恰 1 列且兩個 has_* 皆 false(值不存在時布林確實跟著翻)" \
  || bad "P6 拿到:$R(期望 1|false|false)"

# ── P7 has_* 是布林(靶⑤a 的健康碼對照組)──────────────────────────────────
log "P7 has_* 型別"
R="$(res "BEGIN; $(pay "$K1" 1180)
  SELECT 'R423|'||jsonb_typeof(after->'has_bank_reference')||'|'||jsonb_typeof(after->'has_payer_note')
    FROM admin_audit_log; ROLLBACK;")"
[ "$R" = "boolean|boolean" ] && ok "P7:has_* 是 boolean(不是把值換個欄名塞進來)" || bad "P7 拿到:$R"

# ══ 突變靶 ═══════════════════════════════════════════════════════════════
# 🔴 每個靶各自只准紅它宣稱那一格;跑完一律 ROLLBACK,零留痕。
log "突變靶"

# 靶②:BEFORE INSERT RETURN NULL 吞掉 audit 列 ⇒ 筆數守必須發火
R="$(q "BEGIN;
  CREATE FUNCTION pg_temp.swallow() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
  CREATE TRIGGER zz_swallow BEFORE INSERT ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION pg_temp.swallow();
  $(pay "$K2" 1180)
  ROLLBACK;" | grep -c ': 稽核落 0 列')"
# 🔴 錨只留訊息本文:舊版還或了 `pcm_op5_audit_row_count`,但 psql **預設不印 CONSTRAINT 名**
#    (VERBOSITY=default;memory 有案)⇒ 那半邊是死條件、讀起來卻像兩道錨。
#    冒號前綴不可省:去掉它就成了「重放稽核落 0 列」的子字串 ⇒ 與 P5 那格混淆。
if [ "$R" -ge 1 ]; then ok "靶②:正常路徑 audit 被吞 ⇒ 筆數守發火"; MUT=$((MUT+1)); else bad "靶②:守門沒發火(殺不死)"; fi

# 靶② 對照組:沒有那支 trigger 時同一句必須成功 ⇒ 證明紅的是 trigger 不是別的
R="$(q "BEGIN; $(pay "$K2" 1180) ROLLBACK;" | grep -c 'recorded')"
[ "$R" -ge 1 ] && ok "靶② 對照組:拿掉 trigger 同一句成功" || bad "靶② 對照組失敗 ⇒ 上一格的紅不可歸因"

# 靶⑦:replay 的 action 改成與正常路徑同碼(plan §6 靶⑦ 逐字規格)⇒ P4 的 1|2|1 必須翻面成 3|0|1
# 🔴 這裡**真的改函式**(交易內 CREATE OR REPLACE,DDL 可回滾),不是查詢層模擬:
#    上一版的判準是「數 action LIKE payment.record% = 3」,而健康碼與同碼突變**都是 3**
#    ⇒ 零判別力、卻替 MUT 加了一分(關卡2 抓到的虛報)。突變靶要看到**行為翻面**才算殺死。
#    健康碼的對照組 = 上面 P4 那格(同樣三次呼叫、同樣三個計數,拿到 1|2|1)。
R="$(res "BEGIN;
  DO \$m7\$ DECLARE d text; BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_record_manual_payment';
    EXECUTE replace(d, 'payment.record.replay', 'payment.record');
  END \$m7\$;
  $(pay "$K1" 1180) $(pay "$K1" 1180) $(pay "$K1" 1180)
  SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log WHERE action='payment.record')||'|'
       ||(SELECT count(*) FROM admin_audit_log WHERE action='payment.record.replay')||'|'
       ||(SELECT count(*) FROM order_payments WHERE order_id='$OID'::uuid); ROLLBACK;")"
if [ "$R" = "3|0|1" ]; then ok "靶⑦:replay 同碼 ⇒ P4 的 1|2|1 翻面成 3|0|1(action 區隔是承重的)"; MUT=$((MUT+1));
else bad "靶⑦ 拿到:$R(期望 3|0|1;健康碼在 P4 那格是 1|2|1)"; fi

# 靶④M:**真的**把 actor 寫死(交易內 CREATE OR REPLACE)⇒ P3 的 1|staff_1 必須翻面成 1|sean
# 🔴 為什麼要建壞版本(關卡2 R2 codex P4-①):舊版只跑健康碼、拿到 1|staff_1 就 MUT+1 ——
#    那只證明「健康碼是對的」,沒證明「壞掉時這格會紅」。與 R1 抓到的靶⑦ 是同一個病。
# 🔴 錨唯一性在交易內自己驗(子字串互吃的老坑):正常路徑錨帶 'payment:' 尾綴,
#    與重放那句 (p_actor, 'payment.record.replay', ... 不同串;不唯一就當場 RAISE、不讓它靜默半殺。
R="$(res "BEGIN;
  DO \$m4\$ DECLARE d text; a text := \$anc\$(p_actor, 'payment.record', 'payment:'\$anc\$; BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_record_manual_payment';
    IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
      RAISE EXCEPTION '靶四M 錨不唯一,拒絕半殺的突變';
    END IF;
    EXECUTE replace(d, a, \$rep\$('sean', 'payment.record', 'payment:'\$rep\$);
  END \$m4\$;
  SELECT admin_record_manual_payment('$OID'::uuid,'$K2'::uuid,'staff_1','bank_transfer',1180,
    '2026-08-12T00:00:00+08:00'::timestamptz,'$REF','$NOTE');
  SELECT 'R423|'||count(*)||'|'||max(actor) FROM admin_audit_log; ROLLBACK;")"
if [ "$R" = "1|sean" ]; then ok "靶④M:actor 寫死 ⇒ P3 的 1|staff_1 翻面成 1|sean(actor 真的來自 p_actor)"; MUT=$((MUT+1));
else bad "靶④M 拿到:$R(期望 1|sean;健康碼在 P3 那格是 1|staff_1)"; fi

# 靶⑤a:把 has_bank_reference 的布林換成**值本身** ⇒ P7 的 boolean|boolean 翻面成 string|boolean,
#       且 N2 那道值掃也會看到 sentinel ⇒ 一次證明兩層都活著
R="$(res "BEGIN;
  DO \$m5a\$ DECLARE d text; a text := \$anc\$'has_bank_reference', v_bank_ref IS NOT NULL\$anc\$; BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_record_manual_payment';
    IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
      RAISE EXCEPTION '靶五a 錨不唯一';
    END IF;
    EXECUTE replace(d, a, \$rep\$'has_bank_reference', v_bank_ref\$rep\$);
  END \$m5a\$;
  $(pay "$K1" 1180)
  SELECT 'R423|'||jsonb_typeof(after->'has_bank_reference')||'|'||jsonb_typeof(after->'has_payer_note')
       ||'|'||(after::text LIKE '%$REF%')::text
    FROM admin_audit_log; ROLLBACK;")"
if [ "$R" = "string|boolean|true" ]; then ok "靶⑤a:布林換成值 ⇒ 型別翻面 string 且 sentinel 外洩(P7 與 N2 兩層都有判別力)"; MUT=$((MUT+1));
else bad "靶⑤a 拿到:$R(期望 string|boolean|true;健康碼在 P7 是 boolean|boolean)"; fi

# 靶⑤b:把兩個 has_* 寫死成 true ⇒ **只有現金軌那格看得出來**(P6 的 false|false 翻面成 true|true)
# 🔴 這格存在的理由(關卡2 R2 codex P4-③):bank_transfer 的 fixture 兩欄永遠有值 ⇒ has_* 恆 true
#    ⇒ 寫死 true 的壞版本在只有 P1/N2/靶⑤a 的世界裡**完全殺不死**,四道全綠。
# 🔴 錨只挖 jsonb_build_object 裡那兩句:v_bank_ref IS NOT NULL 這串在 G3 的現金軌守門也有一份
#    (IF p_rail = 'cash' AND v_bank_ref IS NOT NULL THEN)—— 連那句一起換掉的話現金軌會恆被拒,
#    突變就變成「換一種紅法」而不是這格要打的靶。
R="$(res "BEGIN;
  DO \$m5b\$ DECLARE d text; a text := \$anc\$'has_bank_reference', v_bank_ref IS NOT NULL\$anc\$;
                          b text := \$anc\$'has_payer_note', v_payer_note IS NOT NULL\$anc\$; BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_record_manual_payment';
    IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1
       OR (length(d) - length(replace(d, b, ''))) / length(b) <> 1 THEN
      RAISE EXCEPTION '靶五b 錨不唯一';
    END IF;
    EXECUTE replace(replace(d, a, \$rep\$'has_bank_reference', true\$rep\$),
                    b, \$rep\$'has_payer_note', true\$rep\$);
  END \$m5b\$;
  $(paycash "$K2" 640)
  SELECT 'R423|'||(after->>'has_bank_reference')||'|'||(after->>'has_payer_note')
    FROM admin_audit_log; ROLLBACK;")"
if [ "$R" = "true|true" ]; then ok "靶⑤b:has_* 寫死 true ⇒ P6 的 false|false 翻面(現金軌是唯一看得出來的觀察點)"; MUT=$((MUT+1));
else bad "靶⑤b 拿到:$R(期望 true|true;健康碼在 P6 是 false|false)"; fi

# ── 零留痕 ───────────────────────────────────────────────────────────────
log "零留痕"
# 🔴 兩張表都要數(R3 Fable nit7):只數 admin_audit_log 的話,某格漏了 ROLLBACK 卻剛好沒寫稽核時
#    (例如在 G1-G8 就噴掉的路徑)會留下 order_payments 殘列而這格照樣綠。
R="$(res "SELECT 'R423|'||(SELECT count(*) FROM admin_audit_log)
       ||'|'||(SELECT count(*) FROM order_payments WHERE order_id='$OID'::uuid)")"
[ "$R" = "0|0" ] \
  && ok "零殘列:admin_audit_log 與本單 order_payments 皆 0(全部在交易內 ROLLBACK)" \
  || bad "殘留 $R(期望 0|0)⇒ 有格沒有 ROLLBACK"

# ── 三計數閘 ─────────────────────────────────────────────────────────────
echo
echo "== 結算:PASS=$PASS FAIL=$FAIL MUT=$MUT =="
RC=0
[ "$FAIL" -eq 0 ] || { echo "🔴 有 $FAIL 格紅"; RC=1; }
# 🔴 計數閘防「格被刪掉卻全綠」:跑到的格數必須恰等於預期。
[ "$PASS" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 PASS=$PASS 但預期 $EXPECTED_TOTAL ⇒ 有格被刪或新增未更新期望值"; RC=2; }
[ "$MUT" -eq "$EXPECTED_MUT" ] || { echo "🔴 MUT=$MUT 但預期 $EXPECTED_MUT"; RC=2; }
[ "$RC" -eq 0 ] && echo "✅ #423 行為驗收全過"
exit "$RC"
