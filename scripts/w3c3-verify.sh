#!/usr/bin/env bash
#
# W3-3 驗收 harness —— `admin_mark_shipment_shipped` + 共用轉譯層(Q8=A / 交棒 2 引導 / 交棒 10 批次面)
#
# 用法:scripts/w3c3-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W3 列 / §1e Q8=A / §0.3 交棒 2・交棒 10 + 主視窗 `B-197-A` ② 的三條裁定
# 被測物:supabase/migrations/20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql(**實檔,非內嵌副本**)
#
# ══ 判準四句(承自 w0b/w1/w2-verify.sh)══════════════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
# 🔴 `cap()` 只吃**運算式**;語句(UPDATE/INSERT/DELETE)一律用 `capstmt()`
#    —— 餵錯會在 plpgsql 編譯期爆、`RAISE NOTICE` 沒跑到 ⇒ 回空字串被讀成「無錯誤」。
#    (w2-verify 在這個坑上跌過兩次,第二次是跨模型審查才抓到的恆真格。)
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W3CDB:-/tmp/w3cdb}"; SOCK="${W3CSOCK:-/tmp/w3csk}"; P="${W3CPORT:-54397}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=23   # 🔴 量出來的。全綠時 PASS = 23 + CELL-ACCOUNT + CELL-KEYSET = 25。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-34s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-34s %s\n' "$1" "$2"; }

# ══ 🔴 W7 跟片(2026-08-08):路徑閘 + trap teardown + fail-closed 殘留檢查 ══
#   參考實作 = scripts/w7d1-verify.sh(關卡2 兩輪審過);四件一起做,少任何一件都留破口。
#   🔴 **為什麼一定要 trap**(實測,不是推論):本檔 `set -u`,而**頂層**的 unbound variable
#      會讓 shell 當場中止 —— `die()` 不會跑、檔尾也到不了 ⇒ **留一支活叢集**。
#      B-301 的前置證據:在 w3c1 的 provision 之後注入一個頂層 unbound,
#      實測留下 `postgres -D /tmp/w3vdb -p 54401`(PID 69587)。Ctrl-C 同理。
#   🔴 trap 裝在 `pg_ctl start` **之前**:`-w start` 可能「postmaster 已起、只是等待逾時」
#      就走 START_FAIL 分支 ⇒ 那條路原本也漏。
#   🔴 `stop` 失敗時**不刪 datadir**,否則會變成「postmaster 還活著、資料目錄卻沒了」。
#   🔴 殘留用 `postmaster.pid` + `pgrep` 綁本 datadir,**不用 TCP 埠** ——
#      本檔的 server 是 `listen_addresses=`(只開 unix socket)⇒ TCP 恆為 0、零判別力。
# 🔴 `/private/tmp` 也要收:macOS 的 `/tmp` 是 `/private/tmp` 的 symlink,
#    而本線有 harness 的預設 datadir 就落在 scratchpad 的 `/private/tmp/...`(w0b:32)
#    ⇒ 只認字面 `/tmp/` 會把合法路徑擋掉。**這道閘是本次掃掠自己踩到的**,已修。
case "$D"    in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: datadir 必須在 /tmp 或 /private/tmp 底下(現為 [$D])"; exit 1 ;; esac
case "$SOCK" in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: socket 目錄必須在 /tmp 或 /private/tmp 底下(現為 [$SOCK])"; exit 1 ;; esac
case "$D"    in *..*) echo "REFUSE: datadir 不得含 .. (現為 [$D])"; exit 1 ;; esac
case "$SOCK" in *..*) echo "REFUSE: socket 目錄不得含 .. (現為 [$SOCK])"; exit 1 ;; esac
case "$D$SOCK" in *[!A-Za-z0-9/._-]*) echo "REFUSE: 路徑只允許 A-Za-z0-9/._- (pgrep -f 會把其餘字元當 regex ⇒ 殘留那道靜默失效)"; exit 1 ;; esac
teardown() {
  TD_RC=$?   # 🔴 W7 跟片③:第一句就接住本來要離場的碼(EXIT trap 進來時的 $?)
  pg_ctl -D "$D" -w stop >/dev/null 2>&1
  LEFTOVER="$(pgrep -f "postgres.*$D" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -f "$D/postmaster.pid" ] || [ "$LEFTOVER" != "0" ]; then
    echo "🔴 TEARDOWN_WARN:postmaster 沒停乾淨(殘留程序 $LEFTOVER 支)⇒ **保留 datadir 與 socket 目錄供診斷**:$D / $SOCK"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  rm -rf "$D" "$SOCK"
  # 🔴 rm 之後**實測 -e**、不要只印「已收」——「宣稱」不是「檢查」(本 repo 記過的恆真格家族)。
  if [ -e "$D" ] || [ -e "$SOCK" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後仍看得到 資料目錄=$([ -e "$D" ] && echo 殘留 || echo 0) / socket 目錄=$([ -e "$SOCK" ] && echo 殘留 || echo 0)"
    # 🔴 W7 跟片③(2026-08-09,B-226 MF-3):原本這裡只 `return` —— 畫面上有紅字、**exit 仍是 0**
    #    ⇒ 跑過帳、CI、人眼掃 exit 全部看不到殘留。W5 那片修的是**主體**的 exit 守門,
    #    teardown 這條出口整條漏,含本支共 19 支同一個缺陷。⚠️ 在 EXIT trap 裡 `exit` 會覆寫
    #    離場碼且**不會遞迴觸發 trap**(bash 3.2.57 實測)。🔴 **限正常離場路徑** —— R1 F1 實測:
    #    由信號(INT/TERM/HUP/PIPE)觸發時 bash 會 re-raise,最終碼是 130/143/129/141,
    #    這個 `exit 9` 會被蓋掉(仍非 0,不是假綠,但別把這句讀成全稱)。本來就非 0 時保留原碼 —— 殘留不該把
    #    FAIL=1 洗成 9,那會弄丟「哪一格紅了」這個資訊。
    if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
  fi
  echo "  teardown:postmaster 已停、殘留程序 0、datadir 與 socket 目錄已收(-e 實測)"
}
trap teardown EXIT

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }   # 🔴 R2 nit:原本 stderr 直接丟 /dev/null ⇒ 失敗只拿到六個字。隔壁 START_FAIL 有 cat log,這裡對齊。
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
die() { echo "$1"; exit 1; }   # 🔴 收尾一律交給 EXIT 的 trap teardown(單一離場路徑)
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }
cap() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cap\$ DECLARE c text; n text; BEGIN BEGIN PERFORM $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cap\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}
capstmt() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cs\$ DECLARE c text; n text; BEGIN BEGIN $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cs\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}

W3CMIG="${W3CMIG:-$REPO/supabase/migrations/20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql}"
[ -f "$W3CMIG" ] || die "W3A_MIG_MISSING: $W3CMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807190000"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"   # 🔴 原本誤寫成 %%%%_*(永不匹配)⇒ TS=完整檔名,下面的 `=` 分支是死的、被測物是靠字典序**碰巧**被排除。Fable 用 od 驗位元組抓到。
  [ "$TS" \> "$PREFIX_TS" ] && continue          # 前綴外的片不套
  [ "$TS" = "$PREFIX_TS" ] && continue            # 被測物留到 DDL-SYNTAX 才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NOT NULL AND pg_catalog.to_regclass('public.shipment_items') IS NOT NULL AND pg_catalog.to_regclass('public.order_item_quantity_summary') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: W2 冪等層 / shipment_items / 摘要表 有缺"

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W3CMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

# ── fixture:客人 → 訂單 → 品項 → 真實到貨 → 包裹 → 掛品項 ──
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
INV='{"type":"personal"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w3c@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w3c@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','$INV'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
mkitem() { # $1=order_item_id $2=到貨數量 $3=sku
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$1','$ORD','$3','$PSNAP'::jsonb,10,10,100)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$1',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $1): $PID" ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$2,now(),'tester')" >/dev/null
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$1'")"
  [ "$N" = "$2" ] || die "FIXTURE_FAIL(instock $1): 實得 [$N] 期望 [$2]"
}
OI1='bbbbbbbb-0000-0000-0000-000000000001'; mkitem "$OI1" 5 SKU-1
mkbox() { # $1=idem 前綴 → 印 shipment_id
  Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')"
}
SHIP="$(mkbox mk1)"; case "$SHIP" in ????????-*) : ;; *) die "FIXTURE_FAIL(shipment): $SHIP" ;; esac
Q "SELECT public.admin_add_shipment_items('ai1','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":2}]'::jsonb)" >/dev/null

echo "══ 1. 出貨成功路徑 + 冪等 ═════════════════════════════════"
R1="$(Q "SELECT public.admin_mark_shipment_shipped('s-ok','$SHIP','TRACK-001')")"
case "$R1" in
  *'"idempotent": false'*) ok W3C3-SHIP-OK "出貨成功,回 record() 的信封 ✓" ;;
  *) bad W3C3-SHIP-OK "回傳不對:[$R1]" ;;
esac
V="$(Q "SELECT (shipped_at IS NOT NULL)::text||'|'||coalesce(tracking_number,'(null)') FROM public.shipments WHERE id='$SHIP'")"
[ "$V" = "true|TRACK-001" ] && ok W3C3-ROW "shipped_at 與單號都寫進去了 ✓" || bad W3C3-ROW "實得 [$V]"
SUMV="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")"
[ "$SUMV" = "2" ] && ok W3C3-RECOMPUTE "出貨那一刻摘要真的被重算(shipped 0→2)⇒ 這一句確實觸發了 S2b 的 trigger ✓" || bad W3C3-RECOMPUTE "摘要 shipped=[$SUMV]"
R2="$(Q "SELECT public.admin_mark_shipment_shipped('s-ok','$SHIP','TRACK-001')")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text||'|'||('$R2'::jsonb->>'idempotent')")"
[ "$SAME" = "true|true" ] && ok W3C3-REPLAY-IDENTICAL "重放逐鍵與首次相同、只差 idempotent ✓" || bad W3C3-REPLAY-IDENTICAL "[$SAME]"

echo "══ 2. 前緣人話 ════════════════════════════════════════════"
C="$(cap "public.admin_mark_shipment_shipped('e1','99999999-9999-9999-9999-999999999999','T')")"
[ "$C" = "P2B26|pcm_b2_w3c3_shipment_missing" ] && ok W3C3-MISSING "包裹不存在 ⇒ 人話 ✓" || bad W3C3-MISSING "[$C]"
C="$(cap "public.admin_mark_shipment_shipped('e2','$SHIP','T')")"
[ "$C" = "P2B26|pcm_b2_w3c3_already_shipped" ] && ok W3C3-ALREADY "已寄出(異鍵)⇒ 人話「別人剛按過」✓" || bad W3C3-ALREADY "[$C]"
EMPTY="$(mkbox mk2)"
C="$(cap "public.admin_mark_shipment_shipped('e3','$EMPTY','T')")"
[ "$C" = "P2B26|pcm_b2_w3c3_no_items" ] && ok W3C3-NO-ITEMS "空箱不能出貨 ⇒ 人話(X1 是真守門,這裡是訊息層)✓" || bad W3C3-NO-ITEMS "[$C]"
BOX3="$(mkbox mk3)"; Q "SELECT public.admin_add_shipment_items('ai3','$BOX3','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)" >/dev/null
C="$(cap "public.admin_mark_shipment_shipped('e4','$BOX3',NULL)")"
[ "$C" = "P2B26|pcm_b2_w3c3_tracking_required" ] && ok W3C3-TRACKING "hct 沒單號不能出貨 ⇒ 人話 ✓" || bad W3C3-TRACKING "[$C]"
VOIDED="$(mkbox mk4)"; Q "UPDATE public.shipments SET deleted_at=now(), void_reason='t' WHERE id='$VOIDED'" >/dev/null
C="$(cap "public.admin_mark_shipment_shipped('e5','$VOIDED','T')")"
[ "$C" = "P2B26|pcm_b2_w3c3_shipment_voided" ] && ok W3C3-VOIDED "已作廢不能出貨 ⇒ 人話 ✓" || bad W3C3-VOIDED "[$C]"

echo "══ 3. 🔴 Q8=A 攔截轉譯 + 交棒 2 引導訊息 ══════════════════"
# 🔴 構造超量:繞過 RPC 直寫 7 件(instock 5、已出 2 ⇒ 出這箱會讓 shipped 變 9 > 5)
OVER="$(mkbox mk5)"
Q "INSERT INTO public.shipment_items(shipment_id,order_item_id,shipped_quantity) VALUES('$OVER','$OI1',7)" >/dev/null
C="$(cap "public.admin_mark_shipment_shipped('t1','$OVER','TRACK-OVER')")"
[ "$C" = "P2B29|pcm_b2_w3c3_translated" ] \
  && ok W3C3-TRANSLATE-C9 "🔴 C9 的 raw 23514 **被轉譯**成 P2B29(不再裸露 SQLSTATE)✓" \
  || bad W3C3-TRANSLATE-C9 "實得 [$C](期望 P2B29|pcm_b2_w3c3_translated)"
MSG="$(QM "SELECT public.admin_mark_shipment_shipped('t2','$OVER','TRACK-OVER')" | tr '\n' ' ')"
case "$MSG" in
  *"先作廢這個包裹"*"改成正確的"*"重新開一張包裹"*) ok W3C3-GUIDANCE "🔴 訊息就是**交棒 2 的引導**:先作廢 → 改到貨 → 重新出貨 ✓" ;;
  *) bad W3C3-GUIDANCE "訊息不含交棒 2 的三步引導:[$MSG]" ;;
esac
# 🔴 轉譯層**不得吞掉不認識的碼**
U="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('42P01','no_such_thing'),'(NULL)')")"
[ "$U" = "(NULL)" ] && ok W3C3-UNKNOWN-NULL "不認得的碼回 NULL ⇒ 呼叫端會原封拋回,不會給誤導的舊人話 ✓" || bad W3C3-UNKNOWN-NULL "實得 [$U]"
K="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('55P03',NULL),'(NULL)')")"
case "$K" in *"系統忙碌"*) ok W3C3-BUSY "55P03 走**通用**訊息(環境性錯誤不逐箱解釋,裁定 ⑦-3)✓" ;; *) bad W3C3-BUSY "實得 [$K]" ;; esac
# 🔴 F4(跨模型審查):C6′ 那條分支原本**零格** ⇒ conname 打錯一個字母,21 格照樣全綠、員工看 raw。
K2="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('23514','oiqs_cancelled_shipped_le_quantity'),'(NULL)')")"
case "$K2" in *"已取消 + 已出貨"*) ok W3C3-C6-TEXT "C6′(取消+出貨超過訂購量)有人話 ⇒ conname 打錯會紅在這格 ✓" ;; *) bad W3C3-C6-TEXT "實得 [$K2]" ;; esac
# 🔴 F7:真併發雙擊會落在 X2 的 write-once 上,不轉譯會把員工導去作廢一個剛正確出貨的箱
K3="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipments_write_once'),'(NULL)')")"
case "$K3" in *"不要"*"作廢"*) ok W3C3-WRITEONCE-TEXT "真併發雙擊的 X2 有人話,且明說**不要去作廢**(否則會作廢掉剛正確出貨的箱)✓" ;; *) bad W3C3-WRITEONCE-TEXT "實得 [$K3]" ;; esac
K="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('23505','shipment_items_shipment_order_item_unique'),'(NULL)')")"
case "$K" in *"已經在這箱裡了"*) ok W3C3-DUP-TEXT "同箱補掛的 23505 **已有人話**(裁定 ⑦-2 的轉譯本體)✓" ;; *) bad W3C3-DUP-TEXT "實得 [$K]" ;; esac

echo "══ 4. 🔴 偏離申報的兩個已知窗口(釘成可觀察事實)══════════"
# 🔴 ① 轉譯層雖已涵蓋 23505,但**還沒接到 add_items 的執行路徑上** ⇒ 那條今天仍是 raw。
#    接上去的那天本格會紅、逼人回來改期望值(與 W3B2-M3-WINDOW-RAW 同形)。
# 🔴 用**自己的乾淨品項**:首跑共用 OI1,而到這一格時它的可出量早被前面幾格用光
#    ⇒ W3-2 的前緣(P2B27)先擋住,本格根本走不到 UNIQUE —— 那不是本格要的結論。
OI2='bbbbbbbb-0000-0000-0000-000000000002'; mkitem "$OI2" 5 SKU-2
BOX6="$(mkbox mk6)"
D1="$(QM "SELECT public.admin_add_shipment_items('d1','$BOX6','[{\"order_item_id\":\"$OI2\",\"quantity\":1}]'::jsonb)" | tr '\n' ' ')"
case "$D1" in *ERROR*) die "CELL_SETUP_FAIL(d1): $D1" ;; esac
C="$(cap "public.admin_add_shipment_items('d2','$BOX6','[{\"order_item_id\":\"$OI2\",\"quantity\":1}]'::jsonb)")"
# 🔴🔴 **這格的期望值「不會」翻面 —— 而我一度以為它會,還真的去改了它。**
#    W3-3 落檔時我在這格寫「接上轉譯那天本格會紅」。W4-2 確實把轉譯接上了,
#    於是我把期望值改成 P2B29,**而且連 `PREFIX_TS` 也一起往後推**(想把 W4-2 拉進這一疊)
#    —— **結果整支 harness 紅在 DDL-SYNTAX**。
#    🔴 **因果要寫準(跨模型審查 F7)**:紅在 DDL-SYNTAX 的**不是**改期望值那個動作 ——
#       只改期望值字串只會紅在本格(走「實得 23505」那個 bad 分支)。
#       紅 DDL-SYNTAX 的是**動 `PREFIX_TS`**:前綴把 W3-3 自己也重放了一次,
#       `CREATE FUNCTION pcm_b2_shipping_human_error` 撞 42723(already exists)⇒ 被測物整檔跑不起來。
#    真正的原因:本檔是**前綴重放**(`PREFIX_TS` = 本片自己),它測的是「W3-3 當時那一疊」,
#    而 W4-2 的薄封裝**不在那一疊裡** ⇒ 在本檔的前綴下,「同箱補掛仍是 raw 23505」**永遠是真的**。
#    ⇒ 期望值維持 raw;那句「接上轉譯那天本格會紅」是**當時寫錯的預測**,已在此更正。
#    ⇒ 「已經接上了」的證據在 `scripts/w4b-verify.sh` 的 `W4B-23505-TRANSLATED`
#      與線級 `w5-line-verify.sh` 的 `LINE-23505-TRANSLATED`(它重放整個目錄)
#      —— **兩個面各自有各自的 harness,不互相冒領。**
case "$C" in
  23505*) ok W3C3-ADDITEMS-23505-STILL-RAW "🔴 在**本檔的前綴**(到 W3-3 為止)下,同箱補掛仍是 raw 23505(實得 [$C])= 當時的事實被釘住;接上轉譯的證據在 w4b/w5,不在這裡" ;;
  P2B29*) bad W3C3-ADDITEMS-23505-STILL-RAW "🔴 前綴裡竟然有轉譯 ⇒ 前綴重放的界線漂了" ;;
  *)      bad W3C3-ADDITEMS-23505-STILL-RAW "實得 [$C]" ;;
esac
# 🔴 ② 交棒 10:本 RPC 一次只動一箱是**契約不是 DB 守門** —— owner 一句多列 UPDATE 照樣做得到。
# 🔴 F5(跨模型審查):原本用「capstmt 回空」判 PASS —— 正是本檔 :15-16 自己警告的坑
#    (DO 塊編譯錯、mkbox 失敗都回空 ⇒ 假 PASS),而這格是交棒 10 誠實邊界的**唯一**釘。
#    ⇒ ①A/B 的形狀自證 ②改成**正向觀察**(改完回讀,真的兩列都被動到)。
A="$(mkbox mk7)"; B="$(mkbox mk8)"
case "$A:$B" in ????????-*:????????-*) : ;; *) die "CELL_SETUP_FAIL(mk7/mk8): A=[$A] B=[$B]" ;; esac
Q "UPDATE public.shipments SET carrier_note = NULL WHERE id IN ('$A','$B')" >/dev/null
BOTH="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments WHERE id IN ('$A','$B') AND carrier_note IS NULL")"
C="$(capstmt "UPDATE public.shipments SET carrier_note = NULL WHERE id IN ('$A','$B')")"
case "$C:$BOTH" in
  :2) ok W3C3-BATCH-CONTRACT-NOT-GUARD "🔴 owner 的**多列 UPDATE shipments 照樣做得到、且真的動到 2 列** ⇒ 交棒 10 在本片是**應用層契約、不是 DB 守門**(行為層守門在 W4)—— 誠實邊界已釘" ;;
  *)  bad W3C3-BATCH-CONTRACT-NOT-GUARD "例外=[${C:-無}] 受影響列數=[$BOTH](期望 無例外 + 2)" ;;
esac

# 🔴 F3(跨模型審查):「不認得 → RAISE; 原封拋回」是檔頭核心宣稱,但原本**零端對端靶** ——
#    把那行刪掉、或從 WHEN 清單拿掉 lock_not_available,21 格照樣全綠(另兩格只打函式本體、不打接線)。
#    ⇒ 掛一發拋**未知 conname** 的 BEFORE trigger,期望 RPC 回的是 **raw、不是 P2B29**。
Q "CREATE FUNCTION public.w3c3_unknown_raise() RETURNS trigger LANGUAGE plpgsql AS \$m\$ BEGIN RAISE EXCEPTION 'unknown guard' USING ERRCODE='P0001', CONSTRAINT='w3c3_no_such_guard'; END \$m\$" >/dev/null
Q "CREATE TRIGGER w3c3_unknown_bu BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.w3c3_unknown_raise()" >/dev/null
BOXU="$(mkbox mkU)"
OIU='bbbbbbbb-0000-0000-0000-000000000009'; mkitem "$OIU" 5 SKU-U
MU="$(QM "SELECT public.admin_add_shipment_items('mu','$BOXU','[{\"order_item_id\":\"$OIU\",\"quantity\":1}]'::jsonb)" | tr '\n' ' ')"
case "$MU" in *ERROR*) die "CELL_SETUP_FAIL(mu): $MU" ;; esac
C="$(cap "public.admin_mark_shipment_shipped('unk','$BOXU','TRACK-U')")"
[ "$C" = "P0001|w3c3_no_such_guard" ] \
  && ok W3C3-UNKNOWN-RETHROW "🔴 **接線層**實證:未知 conname 被**原封拋回**(不是被吞成 P2B29)⇒ 新守門上線那天員工看到的是看得出來的錯,不是誤導的舊人話 ✓" \
  || bad W3C3-UNKNOWN-RETHROW "實得 [$C](期望 P0001|w3c3_no_such_guard)⇒ 轉譯層吞掉了不認識的碼"
Q "DROP TRIGGER w3c3_unknown_bu ON public.shipments" >/dev/null

echo "══ 5. 🔴 突變靶 ═══════════════════════════════════════════"
# 🔴 還原用的真定義**先存檔**(照 w3a 的教訓:`Q()` 會 tr -d 換行,多行定義會被 `--` 註解吃掉;
#    也不能靠重跑整個 migration —— 那支是 `CREATE FUNCTION` 不是 OR REPLACE,重跑會整批 abort)。
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
  -c "SELECT pg_catalog.pg_get_functiondef('public.pcm_b2_shipping_human_error(text,text)'::regprocedure)" > "$D/tr.sql" 2>&1
grep -q 'CREATE OR REPLACE FUNCTION' "$D/tr.sql" || die "TRANSLATOR_SNAPSHOT_FAIL"
# ① 轉譯族:把轉譯層換成「什麼都回同一句」⇒ 未知碼會被吞掉(這正是檔頭說不准的事)
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(p_sqlstate text, p_conname text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT '出錯了'::text \$m\$" >/dev/null
M="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('42P01','no_such_thing'),'(NULL)')")"
[ "$M" != "(NULL)" ] && ok TMUT-UNKNOWN-SWALLOW "🔴 把轉譯層換成「什麼都回一句」⇒ 未知碼**被吞掉了**(實得 [$M])= W3C3-UNKNOWN-NULL 有判別力" \
                     || bad TMUT-UNKNOWN-SWALLOW "突變後仍回 NULL ⇒ 那格量錯東西"
# ② rowcount 族(W3-2 交接 ⑦-5:Fable 說構造得出來卻沒寫 ⇒ 本片補上)
#    做法:掛一發 BEFORE UPDATE 抑制單列的 trigger ⇒ ROW_COUNT 變 0,守門必須紅在自己的碼上
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(p_sqlstate text, p_conname text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT NULL::text \$m\$" >/dev/null
Q "CREATE FUNCTION public.w3c3_suppress() RETURNS trigger LANGUAGE plpgsql AS \$m\$ BEGIN RETURN NULL; END \$m\$" >/dev/null
Q "CREATE TRIGGER w3c3_suppress_bu BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.w3c3_suppress()" >/dev/null
# 🔴 同上:本格也要乾淨品項,而且 add_items 的結果**不得靜默丟掉**(首跑就是它失敗、
#    本格卻紅在 no_items,把「我的 setup 壞了」讀成「守門沒擋」)。
OI3='bbbbbbbb-0000-0000-0000-000000000003'; mkitem "$OI3" 5 SKU-3
BOX9="$(mkbox mk9)"
M9="$(QM "SELECT public.admin_add_shipment_items('m9','$BOX9','[{\"order_item_id\":\"$OI3\",\"quantity\":1}]'::jsonb)" | tr '\n' ' ')"
case "$M9" in *ERROR*) die "CELL_SETUP_FAIL(m9): $M9" ;; esac
M="$(cap "public.admin_mark_shipment_shipped('rc1','$BOX9','TRACK-RC')")"
[ "$M" = "P2B26|pcm_b2_w3c3_rowcount" ] \
  && ok TMUT-ROWCOUNT "🔴 掛一發抑制單列的 BEFORE trigger ⇒ ROW_COUNT 變 0、守門紅在自己的碼上 = 筆數那格有判別力(W3-2 交接 ⑦-5 補完)" \
  || bad TMUT-ROWCOUNT "實得 [$M](期望 P2B26|pcm_b2_w3c3_rowcount)"
Q "DROP TRIGGER w3c3_suppress_bu ON public.shipments" >/dev/null
# 🔴 F8:突變過的轉譯層要還原,否則日後在本節之後補格會**靜默測到 stub**。
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$D/tr.sql" >/dev/null 2>&1
RESTORED="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('55P03',NULL),'(NULL)')")"
case "$RESTORED" in *"系統忙碌"*) ok W3C3-MUT-RESTORED "突變過的轉譯層已還原(後面若補格,量到的是真的那支)✓" ;; *) bad W3C3-MUT-RESTORED "還原失敗:[$RESTORED]" ;; esac

echo "══ 6. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-ROWCOUNT TMUT-UNKNOWN-SWALLOW W3C3-ADDITEMS-23505-STILL-RAW W3C3-ALREADY W3C3-BATCH-CONTRACT-NOT-GUARD W3C3-BUSY W3C3-C6-TEXT W3C3-DUP-TEXT W3C3-GUIDANCE W3C3-MISSING W3C3-MUT-RESTORED W3C3-NO-ITEMS W3C3-RECOMPUTE W3C3-REPLAY-IDENTICAL W3C3-ROW W3C3-SHIP-OK W3C3-TRACKING W3C3-TRANSLATE-C9 W3C3-UNKNOWN-NULL W3C3-UNKNOWN-RETHROW W3C3-VOIDED W3C3-WRITEONCE-TEXT"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-34s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

# 🔴 原本這裡有一份行內收尾;已交給 EXIT 的 trap teardown,避免兩條收尾路徑各走各的。
echo
# 🔴 **不再印 TCP「埠殘留」** —— server 只開 unix socket(listen_addresses=)⇒ TCP 恆 0、零判別力。
#    真正的殘留檢查在 teardown(EXIT 時跑、停完才量、量不到 0 就保留 datadir 並印警告)。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"

# 🔴🔴 **結束碼守門(跨模型審查 F1;家族回歸)**:少了這行,`FAIL>0` 時結束碼仍是 0
#    ⇒ 任何 `&&` 鏈、preflight、收割腳本都會把**紅跑讀成綠**。
#    `w0b-verify.sh` / `w1-verify.sh`(前一個 session 寫的)本來就有這道;
#    我從 `w2-verify.sh` 開始漏掉,然後一路複製到 w3a/w3b2/w3c3/w5 —— **五支全中**。
[ "$FAIL" -eq 0 ] || exit 1
