#!/usr/bin/env bash
#
# W3c-2 驗收 harness —— `admin_unvoid_shipment`(復原 + **M4 順序前緣守門** + 引導訊息)
#
# 用法:scripts/w3c2-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W3c 列 / §1e **M4** / §0.3 交棒 2
# 被測物:supabase/migrations/20260807210000_m4b_e10_b2_w3c2_unvoid_shipment.sql(**實檔,非內嵌副本**)
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
D="${W3UDB:-/tmp/w3udb}"; SOCK="${W3USOCK:-/tmp/w3usk}"; P="${W3UPORT:-54403}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=15   # 🔴 量出來的。全綠時 PASS = 15 + CELL-ACCOUNT + CELL-KEYSET = 17。
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
# 🔴 W7 跟片⑤(2026-08-09,codex #4 MF-4 的另一半):路徑閘只保證「刪的東西在 /tmp 底下」,
#    **擋不住「那個 /tmp 路徑正被別人的 live cluster 用著」** —— 本檔開場無條件 `rm -rf`,
#    兩個視窗用預設路徑並行跑就會互刪。夜跑多視窗是常態,這不是理論風險。
#    ⇒ 刪之前先問:那裡有沒有活著的 postmaster?有就 REFUSE,不猜、不等、不強刪。
# 🔴🔴 **本段必須排在 `trap teardown EXIT` 之前**:teardown 會 `pg_ctl -D "$D" stop`,
#    若這道 REFUSE 排在 trap 之後,`exit 1` 會觸發 teardown 去停掉**別人的** cluster
#    —— 那正是本段要防的事。(第一版我就寫在 trap 之後,自己抓到。)
# 🔴 R1 F2:`pgrep` 不存在/被 PATH 遮蔽時回非 0 ⇒ 連言 false ⇒ **靜默放行 rm -rf** = fail-open。
#    這道護欄的整個價值就在「不確定時不要刪」,所以工具缺席要當成不確定,不當成沒事。
command -v pgrep >/dev/null 2>&1 || { echo "REFUSE: 找不到 pgrep ⇒ 無法判斷 $D 是否正被別人使用,拒絕 rm -rf"; exit 1; }
# 🔴 R1 F3(誠實邊界,別把註解讀成全稱):本護欄只擋**穩態**。別的視窗正卡在 initdb / pg_ctl start
#    到 postmaster.pid 落地之間那個短窗口時,$D 有目錄但沒有 pid 檔 ⇒ 這裡仍會刪掉它。
#    要關那個窗口得改成 ownership marker 制(如 a1-verify / b2s2b 的作法),本片不做。
if [ -f "$D/postmaster.pid" ] && pgrep -f "postgres.*$D" >/dev/null 2>&1; then
  echo "REFUSE: $D 底下有活著的 postmaster(別的視窗正在用?)⇒ 拒絕 rm -rf,也不去停它。"
  echo "        處置:等它跑完,或改用別的 datadir —— 設定點在本檔頂端的 D= / SOCK= / P=(多數 harness 寫在同一行,w0b-verify.sh 是分三行)"
  echo "        (多數 harness 寫成 \${XXXDB:-預設},可用 env 覆寫;少數(如 w0b-verify.sh)是**寫死的**,要改檔)。"
  exit 1
fi
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

W3UMIG="${W3UMIG:-$REPO/supabase/migrations/20260807210000_m4b_e10_b2_w3c2_unvoid_shipment.sql}"
[ -f "$W3UMIG" ] || die "W3A_MIG_MISSING: $W3UMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807210000"

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
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W3UMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w3u@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w3u@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
PIDOF=""
mkitem() { # $1=order_item_id $2=到貨數量 $3=sku  → 順帶把 procurement id 記進 PIDOF
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$1','$ORD','$3','$PSNAP'::jsonb,10,10,100)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$1',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $1): $PID" ;; esac
  RID="$(Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$2,now(),'tester') RETURNING id")"
  case "$RID" in ????????-*) : ;; *) die "FIXTURE_FAIL(receipt $1): $RID" ;; esac
  PIDOF="$RID"
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$1'")"
  [ "$N" = "$2" ] || die "FIXTURE_FAIL(instock $1): 實得 [$N] 期望 [$2]"
}
mkbox() { Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')"; }
# 🔴🔴 **`die` 絕不可以放在 `$( )` 裡**(本片實錘,而且症狀極具誤導性):
#    `mkfull` 被 `B="$(mkfull …)"` 呼叫 ⇒ 它跑在**子 shell**裡 ⇒ `die` 的 `exit 1` 只結束子 shell、
#    **腳本照樣往下跑**、帶著一個空字串當 shipment_id 繼續建 fixture。
#    🔴 歷史註記(2026-08-08 trap 掃掠後**已失效、留著是為了不讓人以為病因消失了**):
#    當時的 `die` 裡還有一句 `pg_ctl stop`,所以症狀更狠 ——
#    ⇒ 後面每一格都在對死掉的連線發問、`cap()` 回空字串、被讀成「**無例外**」
#    ⇒ 一整排看起來像真 finding 的假 FAIL,而真正的原因(fixture 建不起來)印在最後一行。
#    ⇒ 這支只把錯誤寫進檔案、印空字串;**由呼叫端驗形狀**(呼叫端本來就有 `????????-*` 那道)。
mkfull() { # $1=前綴 $2=oi $3=數量 → 印 shipment_id(已掛品項);失敗印空字串、原因寫進 $D/mkfull.err
  B="$(mkbox "$1")"
  case "$B" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(box %s): %s\n' "$1" "$B" >> "$D/mkfull.err"; return ;; esac
  R="$(QM "SELECT public.admin_add_shipment_items('$1-i','$B','[{\"order_item_id\":\"$2\",\"quantity\":$3}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(add %s): %s\n' "$1" "$R" >> "$D/mkfull.err"; return ;; esac
  printf '%s' "$B"
}

echo "══ 1. 草稿箱:作廢 → 復原(數量從頭到尾沒動過)═══════════"
OI1='bbbbbbbb-0000-0000-0000-000000000001'; mkitem "$OI1" 5 SKU-1
BOXD="$(mkfull d1 "$OI1" 2)"
Q "SELECT public.admin_void_shipment('dv-1','$BOXD','草稿作廢')" >/dev/null
R1="$(Q "SELECT public.admin_unvoid_shipment('du-1','$BOXD')")"
case "$R1" in
  *'"idempotent": false'*) ok W3C2-UNVOID-OK "草稿箱復原成功,回 record() 的信封 ✓" ;;
  *) bad W3C2-UNVOID-OK "回傳不對:[$R1]" ;;
esac
V="$(Q "SELECT (deleted_at IS NULL)::text||'|'||coalesce(void_reason,'(null)') FROM public.shipments WHERE id='$BOXD'")"
[ "$V" = "true|(null)" ] && ok W3C2-ROW "deleted_at 與 void_reason **同時**清掉(X7 雙向配對)✓" || bad W3C2-ROW "實得 [$V]"
SUMV="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")"
[ "$SUMV" = "0" ] && ok W3C2-DRAFT-NO-QTY "草稿箱一路作廢→復原,已出貨數始終 0 ⇒ M4 守門對草稿箱不做無謂檢查是對的 ✓" || bad W3C2-DRAFT-NO-QTY "實得 [$SUMV]"
R2="$(Q "SELECT public.admin_unvoid_shipment('du-1','$BOXD')")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text||'|'||('$R2'::jsonb->>'idempotent')")"
[ "$SAME" = "true|true" ] && ok W3C2-REPLAY-IDENTICAL "重放逐鍵與首次相同、只差 idempotent ✓" || bad W3C2-REPLAY-IDENTICAL "[$SAME]"

echo "══ 2. 🔴 已出貨的箱:作廢退量 → 復原**回加**(M4 的前半)═══"
OI2='bbbbbbbb-0000-0000-0000-000000000002'; mkitem "$OI2" 5 SKU-2
BOXS="$(mkfull s1 "$OI2" 3)"
Q "SELECT public.admin_mark_shipment_shipped('sv-1','$BOXS','TRACK-S1')" >/dev/null
A1="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI2'")"
Q "SELECT public.admin_void_shipment('sv-2','$BOXS','出貨後作廢')" >/dev/null
A2="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI2'")"
Q "SELECT public.admin_unvoid_shipment('sv-3','$BOXS')" >/dev/null
A3="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI2'")"
[ "$A1|$A2|$A3" = "3|0|3" ] \
  && ok W3C2-UNVOID-RESTORES-QTY "🔴 出貨 3 → 作廢 **0** → 復原 **3**:復原真的會回加(SHIPPED-TRUTH 只認「已出貨且未作廢」)= M4 守門守的就是這個回加 ✓" \
  || bad W3C2-UNVOID-RESTORES-QTY "三段實得 [$A1|$A2|$A3](期望 3|0|3)"

echo "══ 3. 🔴🔴 M4 順序前緣守門(本片的核心;三步、零併發)═══════"
# 步①出貨 步②作廢(退量) 步③**採購下修 instock** 步④復原 ⇒ 必須被前緣擋住,而不是撞 raw C9
OI3='bbbbbbbb-0000-0000-0000-000000000003'; mkitem "$OI3" 5 SKU-3
RCPT="$PIDOF"
BOXM="$(mkfull m1 "$OI3" 4)"
Q "SELECT public.admin_mark_shipment_shipped('mv-1','$BOXM','TRACK-M1')" >/dev/null
Q "SELECT public.admin_void_shipment('mv-2','$BOXM','要改到貨數量')" >/dev/null
# 🔴 步③:把到貨數量從 5 下修到 2(走真實路徑改 receipt,讓重算自己算)
Q "UPDATE public.order_item_procurement_receipts SET quantity = 2 WHERE id = '$RCPT'" >/dev/null
INS="$(Q "SELECT instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI3'")"
if [ "$INS" != "2" ]; then
  bad W3C2-M4-BLOCKED "🔴 本格的**前置**沒成立(到貨沒下修成 2,實得 [$INS])⇒ 這不是守門的結論"
  bad W3C2-M4-MESSAGE "🔴 同上,前置沒成立"
else
  C="$(cap "public.admin_unvoid_shipment('mv-3','$BOXM')")"
  [ "$C" = "P2B27|pcm_b2_w3c2_unvoid_exceeds_instock" ] \
    && ok W3C2-M4-BLOCKED "🔴🔴 **M4 三步走完(出貨→作廢→下修到貨)⇒ 復原被前緣擋住**(P2B27),不是撞 raw C9 ✓" \
    || bad W3C2-M4-BLOCKED "實得 [$C](期望 P2B27|pcm_b2_w3c2_unvoid_exceeds_instock)"
  MSG="$(QM "SELECT public.admin_unvoid_shipment('mv-4','$BOXM')" | tr '\n' ' ')"
  case "$MSG" in
    *"回加 4 件"*"到貨只有 2 件"*"改回正確的"*"照這箱內容開一張新的"*)
      ok W3C2-M4-MESSAGE "🔴 訊息講得出**要回加幾件 / 現在到貨幾件**,並給兩條出路(改回到貨 / 開新包裹)= 交棒 2 的引導在本方向的對稱版 ✓" ;;
    *) bad W3C2-M4-MESSAGE "訊息不含可操作內容:[$MSG]" ;;
  esac
fi
# 🔴 前緣被繞過時,C9 真的會接手(證「本片不是唯一防線」——雖然它是唯一的**訊息**來源)
Q "UPDATE public.shipments SET deleted_at = NULL, void_reason = NULL WHERE id='$BOXM'" >/dev/null 2>&1
STILL="$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$BOXM'")"
[ "$STILL" = "true" ] \
  && ok W3C2-C9-BACKSTOP "🔴 繞過 RPC **直寫**清 deleted_at ⇒ 被 C9 擋住、箱子仍是作廢態 = 資料層仍有兜底(本片守的是訊息與時機,不是唯一防線)✓" \
  || bad W3C2-C9-BACKSTOP "直寫成功了 ⇒ C9 沒接手,本片變成唯一防線,檔頭要改寫"

# 🔴 F6:**順序多箱** —— 同一品項在兩個作廢箱裡,兩箱都想復原。
#    第一箱復原後摘要含它,第二箱的前緣讀到的是**活的**摘要 ⇒ 第二箱必須被擋。純順序、不需併發。
OI5='bbbbbbbb-0000-0000-0000-000000000005'; mkitem "$OI5" 5 SKU-5
# 🔴 順序不能是「先開兩箱再各自出貨」—— W3-2 的 **pending 累加守門**(我自己在那片加的)會擋住
#    第二箱的掛品項(兩箱同時 pending 3+3 > 5)。⇒ A 走完「掛→出貨→作廢」B 才掛得進去。
BA="$(mkfull ma "$OI5" 3)"
case "$BA" in ????????-*) : ;; *) bad W3C2-SEQUENTIAL-BOXES "🔴 本格前置沒成立(A 箱:$(cat "$D/mkfull.err" 2>/dev/null | tail -1))"; BA="" ;; esac
if [ -n "$BA" ]; then
Q "SELECT public.admin_mark_shipment_shipped('ma-s','$BA','TRACK-MA')" >/dev/null
Q "SELECT public.admin_void_shipment('ma-v','$BA','兩箱測試 A')" >/dev/null
BB="$(mkfull mb "$OI5" 3)"
case "$BB" in ????????-*) : ;; *) bad W3C2-SEQUENTIAL-BOXES "🔴 本格前置沒成立(B 箱:$(cat "$D/mkfull.err" 2>/dev/null | tail -1))"; BB="" ;; esac
fi
if [ -n "${BB:-}" ]; then
Q "SELECT public.admin_mark_shipment_shipped('mb-s','$BB','TRACK-MB')" >/dev/null
Q "SELECT public.admin_void_shipment('mb-v','$BB','兩箱測試 B')" >/dev/null
CA="$(cap "public.admin_unvoid_shipment('ma-u','$BA')")"
CB="$(cap "public.admin_unvoid_shipment('mb-u','$BB')")"
case "$CA:$CB" in
  ":P2B27|pcm_b2_w3c2_unvoid_exceeds_instock") ok W3C2-SEQUENTIAL-BOXES "🔴 同品項兩個作廢箱(各 3 件、到貨 5):第一箱復原過、**第二箱被擋**(3+3>5)⇒ 守門讀的摘要是**活的** ✓" ;;
  *) bad W3C2-SEQUENTIAL-BOXES "A=[${CA:-放行}] B=[${CB:-放行}](期望 A 放行、B 擋在 P2B27)" ;;
esac
fi

echo "══ 4. 前緣人話 ════════════════════════════════════════════"
C="$(cap "public.admin_unvoid_shipment('e1','99999999-9999-9999-9999-999999999999')")"
[ "$C" = "P2B26|pcm_b2_w3c2_shipment_missing" ] && ok W3C2-MISSING "包裹不存在 ⇒ 人話 ✓" || bad W3C2-MISSING "[$C]"
C="$(cap "public.admin_unvoid_shipment('e2','$BOXD')")"
[ "$C" = "P2B26|pcm_b2_w3c2_not_voided" ] && ok W3C2-NOT-VOIDED "沒作廢的箱不需要復原 ⇒ 人話 ✓" || bad W3C2-NOT-VOIDED "[$C]"

echo "══ 5. 🔴 突變靶 ═══════════════════════════════════════════"
# ① M4 守門族:拿掉整段前緣 ⇒ 那條路會改撞 **raw C9**(而不是「還是被擋」)
Q "CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE n bigint; BEGIN UPDATE public.shipments SET deleted_at=NULL, void_reason=NULL WHERE id=p_shipment_id AND deleted_at IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'rc' USING ERRCODE='P2B26', CONSTRAINT='pcm_b2_w3c2_rowcount'; END IF; RETURN '{}'::jsonb; END \$m\$" >/dev/null
M="$(cap "public.admin_unvoid_shipment('mut-1','$BOXM')")"
case "$M" in
  23514*oiqs_shipped_le_instock*) ok TMUT-M4-GUARD "🔴 拿掉 M4 前緣 ⇒ 那條路改撞 **raw 23514 oiqs_shipped_le_instock**(實得 [$M])= 前緣守的就是「不要讓員工看到這個」,而 C9 是兜底" ;;
  P2B27*) bad TMUT-M4-GUARD "拿掉前緣後仍回 P2B27 ⇒ 那格守的不是這段" ;;
  *)      bad TMUT-M4-GUARD "實得 [$M]" ;;
esac
# 🔴🔴 W7 跟片(2026-08-09,codex #7 MF-2):**上面那發突變原本沒有還原** ——
#    它把 `admin_unvoid_shipment` 整支換成沒有 M4 前緣的殘廢版,而下面 `W3C2-DRAFT-SAFE`
#    照樣呼叫同一個名字 ⇒ **那格量到的是 mutant、不是本尊**。殘廢版本來就不會擋任何東西,
#    所以「安全的草稿復原沒被誤擋」這個結論在正式函式上**從來沒有被觀察過**;
#    正式函式真的誤擋草稿的話,本格照樣全綠。
#    ⇒ 重跑被測物 migration 把本尊放回來,並**自證放回來了**(不自證的話,
#      還原失敗會靜靜地讓下面那格繼續量 mutant,跟現在一模一樣)。
# 🔴 R1 F6:錨 `pcm_b2_w3c2_translated` 的唯一性是**時點性質,不是恆真** ——
#    `…w7d1_ship_deadlock_retry.sql` 也 CREATE OR REPLACE 同一支函式、也含這個字面,
#    現在靠 `PREFIX_TS=20260807210000` 把它排除在重放外才唯一。
#    **失效條件**:PREFIX_TS 往後挪到含 w7d1 的那天,這個錨就分不出兩個版本 ⇒ 要換成
#    md5 釘值或改錨在本片獨有的字面。
# 🔴 R1 F5(誠實邊界):這個錨落在**例外轉譯分支**,不是 `W3C2-DRAFT-SAFE` 真正要量的 M4 前緣。
#    整檔重放下兩者同生共死,所以現在不假綠;但守門沒畫在不變量成立的那個面,寫下來不假裝關完。
# 🔴 R1 F7:原本 stderr 丟掉,失敗只拿得到六個字;對齊本檔他處的 2>"$D/err" 慣例。
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$W3UMIG" >/dev/null 2>"$D/restore.err" || die "RESTORE_FAIL(TMUT-M4-GUARD):被測物 migration 重跑失敗,本尊沒放回來 :: $(cat "$D/restore.err" 2>/dev/null | tr '\n' ' ')"
RESTORED="$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_unvoid_shipment(text,uuid)'::regprocedure), 'pcm_b2_w3c2_translated') > 0)::text")"
[ "$RESTORED" = "true" ]   || die "RESTORE_FAIL(TMUT-M4-GUARD):線上函式體不是本尊(錨 pcm_b2_w3c2_translated 查得 [$RESTORED])⇒ 下面每一格都會量到 mutant,停"
# ② 🔴🔴 「只在 shipped_at 非空時才算」那條 —— **我原本從一個沒有判別力的 fixture 讀出了錯的結論**。
#    首版:草稿箱掛 2 件、instock 5 ⇒ 拿掉條件也是 `0+2 ≤ 5` 放行 ⇒ 觀察值不變,
#    我就寫成「那個條件沒有正確性作用、只省算」。**錯了**(跨模型審查 F2)。
#    ⇒ fixture 改成 **instock < 掛的量**:草稿箱掛 2 件、到貨下修到 1
#      ⇒ 有條件時放行(草稿不進 SHIPPED-TRUTH、復原完全安全);拿掉條件會算 `0+2 > 1` ⇒ **誤擋**。
#    這才量得出那個條件在守什麼。
OI4='bbbbbbbb-0000-0000-0000-000000000004'; mkitem "$OI4" 5 SKU-4
RCPT4="$PIDOF"
BOXDR="$(mkfull d4 "$OI4" 2)"
Q "SELECT public.admin_void_shipment('dr-1','$BOXDR','草稿作廢待測')" >/dev/null
Q "UPDATE public.order_item_procurement_receipts SET quantity = 1 WHERE id = '$RCPT4'" >/dev/null
INS4="$(Q "SELECT instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI4'")"
if [ "$INS4" != "1" ]; then
  bad W3C2-DRAFT-SAFE "🔴 本格的**前置**沒成立(到貨沒下修成 1,實得 [$INS4])"
  bad TMUT-DRAFT-CONDITION "🔴 同上,前置沒成立"
else
  C="$(cap "public.admin_unvoid_shipment('dr-2','$BOXDR')")"
  [ -z "$C" ] \
    && ok W3C2-DRAFT-SAFE "🔴 草稿箱掛 2 件、到貨只剩 1 件 ⇒ 復原**仍然放行**(草稿不進 SHIPPED-TRUTH、不回加任何已出貨量)✓" \
    || bad W3C2-DRAFT-SAFE "安全的草稿復原被誤擋了:[$C]"
  Q "SELECT public.admin_void_shipment('dr-3','$BOXDR','再作廢以便打突變')" >/dev/null
  Q "CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE b text; n bigint; BEGIN SELECT pg_catalog.string_agg('x',',') INTO b FROM (SELECT si.shipped_quantity qty, coalesce(q.instock_quantity,0) ins, coalesce(q.shipped_quantity,0) shp FROM public.shipment_items si LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id=si.order_item_id WHERE si.shipment_id=p_shipment_id) w WHERE w.shp + w.qty > w.ins; IF b IS NOT NULL THEN RAISE EXCEPTION 'blocked' USING ERRCODE='P2B27', CONSTRAINT='pcm_b2_w3c2_unvoid_exceeds_instock'; END IF; UPDATE public.shipments SET deleted_at=NULL, void_reason=NULL WHERE id=p_shipment_id AND deleted_at IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; RETURN '{}'::jsonb; END \$m\$" >/dev/null
  M="$(cap "public.admin_unvoid_shipment('dr-4','$BOXDR')")"
  [ "$M" = "P2B27|pcm_b2_w3c2_unvoid_exceeds_instock" ] \
    && ok TMUT-DRAFT-CONDITION "🔴 拿掉「只在已出貨時才算」⇒ **安全的草稿復原被誤擋**(P2B27)= 那個條件是**正確性條件**(防誤擋),不是省算 —— 我原本的自陳被這一發打掉" \
    || bad TMUT-DRAFT-CONDITION "拿掉條件後實得 [$M](期望 P2B27 的誤擋)"
  # 🔴 R1 F8:**突變②同樣沒有還原**。目前無害 —— 它之後只剩 CELL-ACCOUNT / CELL-KEYSET,
  #    兩格都不呼叫 `admin_unvoid_shipment`。但這正是 MF-2 的同型缺陷,只是還沒咬到人;
  #    加格的人不會先讀到這段註解 ⇒ 這裡也還原並自證,不留給下一個人踩。
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$W3UMIG" >/dev/null 2>"$D/restore2.err" || die "RESTORE_FAIL(TMUT-DRAFT-CONDITION):本尊沒放回來 :: $(cat "$D/restore2.err" 2>/dev/null | tr '\n' ' ')"
  R2ED="$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_unvoid_shipment(text,uuid)'::regprocedure), 'pcm_b2_w3c2_translated') > 0)::text")"
  [ "$R2ED" = "true" ] || die "RESTORE_FAIL(TMUT-DRAFT-CONDITION):線上函式體不是本尊(錨查得 [$R2ED])"
fi

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
KEYS_FROZEN="DDL-SYNTAX TMUT-DRAFT-CONDITION TMUT-M4-GUARD W3C2-C9-BACKSTOP W3C2-DRAFT-NO-QTY W3C2-DRAFT-SAFE W3C2-M4-BLOCKED W3C2-M4-MESSAGE W3C2-MISSING W3C2-NOT-VOIDED W3C2-REPLAY-IDENTICAL W3C2-ROW W3C2-SEQUENTIAL-BOXES W3C2-UNVOID-OK W3C2-UNVOID-RESTORES-QTY"
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
[ "$FAIL" -eq 0 ] || exit 1
