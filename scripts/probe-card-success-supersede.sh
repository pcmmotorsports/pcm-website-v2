#!/bin/bash
# probe-card-success-supersede.sh — ⟦b4-CARDPENDINGWINDOW⟧ 的鑽機(可重跑, 會紅)
#
# 兩部分, 各答不同的問題:
#   甲【接線】拋棄式 PG(check_function_bodies=off)裝舊三支 + 它們的 COMMENT ⇒ 貼本片
#      ⇒ 前置閘與事後斷言【真的跑】, 含「三段逐字相同」那道。不需要任何資料表。
#   乙【行為】最小 fixtures + 把那 45 行區塊包成一支測試函式 ⇒ 驗它到底取消了哪幾張單。
# 🛑 乙為什麼不直接呼三支正牌函式:它們要 staff / session_user='payment_confirmer' /
#    payment_double_charge_anomalies … 一整串前置。而**本片的改動就是那 45 行**,
#    三支的其餘部分由 md5 減法證明逐字未動 ⇒ 乙量的是改動本身。
#    ⚠️ **而「它真的被接進三支裡」是甲在答**, 不是乙。兩部分缺一不可。
#
# 用法:bash scripts/probe-card-success-supersede.sh   ⇒ 全過 rc=0;任一格不如預期 rc=1
set -uo pipefail
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
WT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$WT/supabase/migrations/20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql"
MIG="$WT/supabase/migrations/20260906700000_m4b_card_success_supersedes_bank.sql"
test -f "$SRC" || { echo "🔴 找不到 $SRC"; exit 1; }
test -f "$MIG" || { echo "🔴 找不到 $MIG"; exit 1; }
SP="$(mktemp -d /tmp/cardsup.XXXXXX)"
D=""; PORT=""
cleanup() {
  local rc=$?; local dirty=0
  if [ -n "$D" ] && [ -d "$D/data" ]; then
    LC_ALL=C pg_ctl -D "$D/data" stop -m immediate > /dev/null 2>&1 || { echo "🔴 收攤:pg_ctl stop 失敗, 叢集留在 $D"; dirty=1; }
    sleep 1
  fi
  if [ -n "$PORT" ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "🔴 收攤:埠 $PORT 仍在監聽, 叢集留在 $D"; dirty=1
  fi
  [ "$dirty" = 0 ] && [ -n "$D" ] && rm -rf "$D"
  rm -rf "$SP"
  [ "$dirty" = 1 ] && exit 2
  exit "$rc"
}
trap cleanup EXIT
FAIL=0
bad() { printf '🔴 FAIL %s\n' "$1"; FAIL=1; }
ok()  { printf '🟢 PASS %s\n' "$1"; }

D=/tmp/pcm-cardsup-$$
[ -e "$D" ] && { echo "🔴 $D 已存在"; exit 1; }
read -r PORT _ < <(bash "$WT/scripts/free-port.sh" --two) || { echo "🔴 取不到埠"; exit 1; }
echo "🔵 PG 埠 = $PORT · 叢集 = $D"
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/i.log" 2>&1 || { tail -5 "$D/i.log"; exit 1; }
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c check_function_bodies=off" \
  -l "$D/pg.log" start > /dev/null
sleep 3
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -tAc "select 1" > /dev/null || { tail -6 "$D/pg.log"; exit 1; }

echo "=== 甲-1 裝舊三支 + 它們的 COMMENT(逐字 sed 抽自 20260810170000)==="
{ sed -n '127,234p' "$SRC"; sed -n '236,237p' "$SRC";
  sed -n '241,320p' "$SRC"; sed -n '322,323p' "$SRC";
  sed -n '328,520p' "$SRC"; sed -n '522,539p' "$SRC"; } > "$SP/old3.sql"
"${PSQL[@]}" -q -f "$SP/old3.sql" > "$D/old3.log" 2>&1 || { bad "甲-1 裝舊三支失敗"; tail -5 "$D/old3.log"; }
for pair in "mark_charge_attempt_charged 13dfcc0a3c7f8e35b53063ca9babf8e5" \
            "mark_charge_attempt_charged_fallback ca9a7593ca05b2991d295ce93be692f4" \
            "confirm_order_payment 184204e35edb0dba1b6d4d0909136f3c"; do
  set -- $pair
  GOT=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='$1'")
  [ "$GOT" = "$2" ] && ok "甲-1 $1 舊 md5 = $GOT" || bad "甲-1 $1 舊 md5 = $GOT(期望 $2)"
done

echo "=== 甲-1b 正對照:ACL 沒收乾淨時, 前置閘③c 必須擋下 ==="
# 🔴 拋棄式 PG 剛建的函式**預設 PUBLIC 有 EXECUTE** ⇒ 這正好是 codex R1 #5 那道閘要擋的世界。
#    ⇒ 📌 先在這個世界貼一次(必須紅), 再收權、再貼(必須綠)—— 兩個世界都演到,
#      那道閘才不是「反正線上本來就對, 它永遠綠」。
"${PSQL[@]}" -f "$MIG" > "$D/apply0.log" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q '前置閘③c' "$D/apply0.log" \
  && ok "甲-1b ACL 沒收時被前置閘③c 擋下(rc=$RC)" \
  || bad "甲-1b ACL 沒收而它【沒有】被③c 擋下 ⇒ 那道閘是假的(rc=$RC)"
echo "   收權(讓環境對齊正式庫:owner 以外沒有授權)"
for f in "mark_charge_attempt_charged(uuid,uuid,text)" \
         "mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)" \
         "confirm_order_payment(uuid,integer,text)"; do
  "${PSQL[@]}" -q -c "REVOKE ALL ON FUNCTION public.$f FROM PUBLIC;" > /dev/null 2>&1
done

echo "=== 甲-2 貼本片(前置閘 + 事後斷言真的跑)==="
"${PSQL[@]}" -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "甲-2 貼片 rc=0" || { bad "甲-2 貼片 rc=$RC"; tail -6 "$D/apply.log"; }
grep -q '事後斷言全數通過' "$D/apply.log" && ok "甲-2 事後斷言 NOTICE 有印" || bad "甲-2 事後斷言那行 NOTICE 沒印"
grep -q '前置閘:三支都通過' "$D/apply.log" && ok "甲-2 前置閘 NOTICE 有印" || bad "甲-2 前置閘那行 NOTICE 沒印"

echo "=== 甲-3 冪等:再貼一次 ==="
"${PSQL[@]}" -f "$MIG" > "$D/apply2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "甲-3 冪等重貼 rc=0" || { bad "甲-3 冪等重貼 rc=$RC"; tail -6 "$D/apply2.log"; }

echo "=== 甲-4 負對照:只改【一支】的區塊, 三段 diff=0 那道必須紅 ==="
"${PSQL[@]}" -q -c "DO \$m\$ DECLARE s text; BEGIN
  SELECT prosrc INTO s FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND proname='mark_charge_attempt_charged_fallback';
  s := replace(s, 'superseded_by_card', 'superseded_by_QQQQ');
  EXECUTE format('CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged_fallback(p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text, p_fallback_token uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '''' AS %L', s);
END \$m\$;" > /dev/null 2>&1
"${PSQL[@]}" -f "$MIG" > "$D/apply3.log" 2>&1; RC=$?
# 🔴 codex R1 #4:只判 rc != 0 是免費的綠 —— 語法錯、連線斷、任何錯誤都會讓它過。
#    ⇒ 要斷言【紅在哪一格】。
[ "$RC" != 0 ] && ok "甲-4 閘擋下了被改掉的那一支(rc=$RC)" || bad "甲-4 沒有擋下 ⇒ 那道閘是假的"
grep -q '前置閘③' "$D/apply3.log" && ok "甲-4 紅的是【前置閘③ md5 錨】那一格" || { bad "甲-4 紅了而不是前置閘③"; grep -oE 'ERROR:.{0,80}' "$D/apply3.log" | head -1; }

echo "=== 甲-5 負對照(專打事後③):把【migration 檔裡】三段其中一段改掉 ==="
# 🔴 甲-4 是被【前置閘③ md5】擋下的 ⇒ 那一發**沒有演到**「三段逐字相同」那道。
#    ⇒ 這一格改的是 **migration 檔本身**:前置閘看的是線上那三支(還是舊的, 會過),
#      而貼完之後三段就不相等 ⇒ **只有事後③ 抓得到**。
python3 - "$MIG" "$SP/mig-mutated.sql" <<'PYM'
import io, sys
L = io.open(sys.argv[1], encoding='utf-8').read().split('\n')
# 🔴 只改【第三段區塊裡】那一行 —— 用整行比對, 不要用 rindex 找字面:
#    那個字面在事後④ 的斷言與錯誤訊息裡也各有一次, rindex 會打到那裡(第一版就是這樣, 甲-5 當場紅)。
hits = [i for i, l in enumerate(L) if l.strip() == "cancelled_reason = 'superseded_by_card',"]
assert len(hits) == 3, '期望三段各一行, 實得 %d' % len(hits)
L[hits[2]] = L[hits[2]].replace('superseded_by_card', 'superseded_by_ZZZZ')
io.open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(L))
PYM
"${PSQL[@]}" -q -f "$SP/old3.sql" > /dev/null 2>&1   # 先把線上三支還原成舊版
"${PSQL[@]}" -f "$SP/mig-mutated.sql" > "$D/apply4.log" 2>&1; RC=$?
[ "$RC" != 0 ] && ok "甲-5 三段不相等被擋下(rc=$RC)" || bad "甲-5 三段 diff=0 那道沒有擋下 ⇒ 它是假的"
grep -oE '事後③[^,]*' "$D/apply4.log" | head -1
grep -q '事後③' "$D/apply4.log" && ok "甲-5 紅的是【事後③】那一格" || bad "甲-5 紅了, 而紅的不是事後③ ⇒ 這一格沒演到它要演的東西"
"${PSQL[@]}" -q -f "$SP/old3.sql" > /dev/null 2>&1   # 還原, 讓乙-1 從乾淨狀態開始
"${PSQL[@]}" -q -f "$MIG" > /dev/null 2>&1

echo "=== 乙-1 最小 fixtures + 把那 45 行包成測試函式 ==="
"${PSQL[@]}" -q <<'BOOT' > /dev/null
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_user_id uuid, cart_session_id uuid,
  cancelled_at timestamptz, cancelled_reason text, updated_at timestamptz NOT NULL DEFAULT now(),
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_channel text NOT NULL DEFAULT 'tappay', label text);
CREATE TABLE public.payment_charge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending');
BOOT
# 🔴 測試函式的區塊【從 migration 本人抽出來】—— 不是另外抄一份。
#    另抄一份的話, 這支鑽機驗的就不是要上線的那段字(它們會分岔而沒有東西會叫)。
python3 - "$MIG" > "$SP/blkfn.sql" <<'PYX'
import io, re, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'(  -- .SUPERSEDE-BLOCK-BEGIN.*?  -- .SUPERSEDE-BLOCK-END.)', src, re.S)
assert m, '抽不到區塊'
print("CREATE OR REPLACE FUNCTION public.zz_test_supersede(p_order_id uuid) RETURNS void")
print(" LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $t$")
print("BEGIN")
print(m.group(1))
print("END;")
print("$t$;")
PYX
test -s "$SP/blkfn.sql" || { bad "乙-1 抽不出區塊"; }
"${PSQL[@]}" -q -f "$SP/blkfn.sql" > "$D/blkfn.log" 2>&1 || { bad "乙-1 測試函式建不起來"; tail -5 "$D/blkfn.log"; }
cat > "$SP/fx.sql" <<'FX'
TRUNCATE public.orders, public.payment_charge_attempts;
DO $f$
DECLARE u uuid := gen_random_uuid(); v uuid := gen_random_uuid();
        c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
        e uuid := gen_random_uuid(); k uuid; kb uuid;
BEGIN
  INSERT INTO public.orders (customer_user_id, cart_session_id, payment_channel, payment_status, label)
    VALUES (u, c, 'tappay', 'unpaid', 'K_card') RETURNING id INTO k;
  -- 🔴 keeper 是【匯款單】的世界:codex R1 #1 —— confirm_order_payment 沒驗目標是不是刷卡單,
  --    誤傳一張匯款單進去時, 本區塊不得順手取消同 cart 的其他匯款單。
  INSERT INTO public.orders (customer_user_id, cart_session_id, payment_channel, payment_status, label)
    VALUES (u, e, 'bank_transfer', 'unpaid', 'K_bank') RETURNING id INTO kb;
  INSERT INTO public.orders (customer_user_id, cart_session_id, payment_channel, payment_status, label)
    VALUES (u, e, 'bank_transfer', 'unpaid', 'e_sib');
  INSERT INTO public.orders (customer_user_id, cart_session_id, payment_channel, payment_status, label) VALUES
    (u, c, 'bank_transfer', 'unpaid', 'b_sib'),
    (u, c, 'bank_transfer', 'unpaid', 'b_attempt'),
    (u, c, 'bank_transfer', 'paid',   'b_paid'),
    (u, d, 'bank_transfer', 'unpaid', 'b_othercart'),
    (v, c, 'bank_transfer', 'unpaid', 'b_otheruser'),
    (u, c, 'cash',          'unpaid', 'c_sib');
  INSERT INTO public.orders (customer_user_id, cart_session_id, payment_channel, payment_status, label, cancelled_at, cancelled_reason)
    VALUES (u, c, 'bank_transfer', 'unpaid', 'b_already', pg_catalog.now(), 'payment_expired');
  INSERT INTO public.payment_charge_attempts (order_id, status)
    SELECT id, 'pending' FROM public.orders WHERE label='b_attempt';
  PERFORM public.zz_test_supersede(k);
  PERFORM public.zz_test_supersede(kb);   -- keeper 是匯款單 ⇒ 這一發【不該】取消任何東西
END
$f$;
SELECT coalesce(string_agg(label, ',' ORDER BY label),'(空)') AS 被本次取消
  FROM public.orders WHERE cancelled_reason = 'superseded_by_card';
SELECT coalesce(string_agg(label, ',' ORDER BY label),'(空)') AS 仍活著
  FROM public.orders WHERE cancelled_at IS NULL;
FX
"${PSQL[@]}" -tAq -f "$SP/fx.sql" > "$D/fx.out" 2>&1 || { bad "乙-1 fixtures 跑失敗"; tail -5 "$D/fx.out"; }
CANC=$(sed -n '1p' "$D/fx.out"); ALIVE=$(sed -n '2p' "$D/fx.out")
echo "   被本次取消:$CANC"
echo "   仍活著:    $ALIVE"
[ "$CANC" = "b_sib" ] && ok "乙-1 只取消 b_sib(同人同 cart 的匯款單, 無 attempt)" || bad "乙-1 取消了 $CANC(期望 b_sib)"
[ "$ALIVE" = "K_bank,K_card,b_attempt,b_othercart,b_otheruser,b_paid,c_sib,e_sib" ] \
  && ok "乙-1 八張負例全部活著(含 keeper 是匯款單那組 K_bank/e_sib)" || bad "乙-1 活著的是 $ALIVE(期望 K_bank,K_card,b_attempt,b_othercart,b_otheruser,b_paid,c_sib,e_sib)"
"${PSQL[@]}" -tAqc "SELECT cancelled_reason FROM public.orders WHERE label='b_already'" > "$D/al.out"
[ "$(cat "$D/al.out")" = "payment_expired" ] && ok "乙-1 已取消那張的理由沒被蓋掉" || bad "乙-1 b_already 的理由變成 $(cat "$D/al.out")"

echo "=== 乙-2 鎖順序:兩個 session 真的併發跑一次(codex R1 #2/#3)==="
# 🔴 這一格是本片**改設計的理由**:區塊從「函式尾」搬到「函式頭」是為了鎖順序。
#    ⇒ 📌 只有兩個 session 真的撞一次, 才證得了那個搬移有效。
#    世界甲(舊順序:先鎖列、再拿 advisory)⇒ 期望 40P01 死結
#    世界乙(新順序:先拿 advisory、再鎖列)⇒ 期望不死結
KID=$("${PSQL[@]}" -tAc "SELECT id FROM public.orders WHERE label='K_card'")
UID_=$("${PSQL[@]}" -tAc "SELECT customer_user_id FROM public.orders WHERE label='K_card'")
if [ -z "$KID" ] || [ -z "$UID_" ]; then
  bad "乙-2 拿不到 K_card 的 id/uid ⇒ 這一格沒跑到"
else
  run_world() {   # $1=world  $2=S1 的第一句  $3=S1 的第二句
    ( "${PSQL[@]}" -v ON_ERROR_STOP=0 -tAc "BEGIN; $2 SELECT pg_sleep(2); $3 COMMIT;" > "$D/s1-$1.log" 2>&1 ) &
    local P1=$!
    sleep 0.5
    ( "${PSQL[@]}" -v ON_ERROR_STOP=0 -tAc "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('$UID_', 0)); SELECT pg_sleep(2); UPDATE public.orders SET updated_at = pg_catalog.now() WHERE id = '$KID'; COMMIT;" > "$D/s2-$1.log" 2>&1 ) &
    local P2=$!
    wait "$P1"; wait "$P2"
  }
  run_world old "UPDATE public.orders SET updated_at = pg_catalog.now() WHERE id = '$KID';" "SELECT public.zz_test_supersede('$KID');"
  if grep -q '40P01\|deadlock' "$D/s1-old.log" "$D/s2-old.log"; then
    ok "乙-2 世界甲(舊順序)真的死結了 ⇒ 這一格有判別力"
  else
    bad "乙-2 世界甲【沒有】死結 ⇒ 這個測試構造不出它要演的世界, 下面那格的綠是免費的"
  fi
  run_world new "SELECT public.zz_test_supersede('$KID');" "UPDATE public.orders SET updated_at = pg_catalog.now() WHERE id = '$KID';"
  if grep -q '40P01\|deadlock' "$D/s1-new.log" "$D/s2-new.log"; then
    bad "乙-2 世界乙(新順序)仍然死結 ⇒ 搬到函式頭沒有解決鎖順序"
  else
    ok "乙-2 世界乙(新順序)沒有死結"
  fi
fi

echo "=== 甲-6 還原檔:貼下去三支要回到舊 md5 ==="
RB="$WT/docs/specs/2026-09-06-card-success-supersede-ROLLBACK.sql"
if [ -f "$RB" ]; then
  "${PSQL[@]}" -f "$RB" > "$D/rb.log" 2>&1; RC=$?
  [ "$RC" = 0 ] && ok "甲-6 還原檔 rc=0" || { bad "甲-6 還原檔 rc=$RC"; tail -6 "$D/rb.log"; }
  for pair in "mark_charge_attempt_charged 13dfcc0a3c7f8e35b53063ca9babf8e5" \
              "mark_charge_attempt_charged_fallback ca9a7593ca05b2991d295ce93be692f4" \
              "confirm_order_payment 184204e35edb0dba1b6d4d0909136f3c"; do
    set -- $pair
    GOT=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='$1'")
    [ "$GOT" = "$2" ] && ok "甲-6 $1 還原後 md5 = $GOT" || bad "甲-6 $1 還原後 md5 = $GOT(期望 $2)"
  done
  # 🔵 還原的正對照:區塊真的不見了
  # 🔴 只數【那三支】—— 第一版數全庫, 而 `zz_test_supersede`(乙-1 的測試外殼)也帶著同一段區塊
  #    ⇒ 它回 1 而那不是缺陷。**這一格當場紅過一次, 修的是尺不是碼。**
  N=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('mark_charge_attempt_charged','mark_charge_attempt_charged_fallback','confirm_order_payment') AND pg_catalog.strpos(p.prosrc,'SUPERSEDE-BLOCK-BEGIN')>0")
  [ "$N" = "0" ] && ok "甲-6 還原後那三支已無 supersede 區塊(0 支)" || bad "甲-6 還原後那三支仍有 $N 支帶著區塊"
  # 🟢 同一把尺的正對照:測試外殼 zz_test_supersede 本來就帶著它 ⇒ 必須數得到 1
  NP=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='zz_test_supersede' AND pg_catalog.strpos(p.prosrc,'SUPERSEDE-BLOCK-BEGIN')>0")
  [ "$NP" = "1" ] && ok "甲-6 正對照:同一把尺對測試外殼數到 1(它不是恆 0)" || bad "甲-6 正對照失敗:對測試外殼數到 $NP(期望 1)"
else
  bad "甲-6 找不到還原檔 $RB"
fi

echo "──────────────────────────────"
[ "$FAIL" = 0 ] && echo "🟢 全部斷言通過" || echo "🔴 有斷言失敗"
exit "$FAIL"
