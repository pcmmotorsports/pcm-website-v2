#!/usr/bin/env bash
#
# W3c-1 驗收 harness —— `admin_void_shipment`(作廢 + 退量觸發 + 已出貨可作廢)
#
# 用法:scripts/w3c1-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W3c 列 / §1e M4 + Sean 08-05 Q3=A(作廢退量)
# 被測物:supabase/migrations/20260807200000_m4b_e10_b2_w3c1_void_shipment.sql(**實檔,非內嵌副本**)
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
# 🔴 **誠實邊界(跨模型審查 F7)**:本檔對轉譯路徑(P2B29)**零行為格** —— 作廢方向的 C9 近乎不可達
#    (作廢只會讓 shipped 變小)⇒ 依 `w3c3-verify.sh` 的轉譯格背書,本檔不重複也不假裝有測。
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W3VDB:-/tmp/w3vdb}"; SOCK="${W3VSOCK:-/tmp/w3vsk}"; P="${W3VPORT:-54401}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=13   # 🔴 量出來的。全綠時 PASS = 13 + CELL-ACCOUNT + CELL-KEYSET = 15。
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
# 🔴🔴 W7 跟片⑦(2026-08-09,R2 抓的):上面的 `/tmp/?*` **擋不住 `/tmp//`** ——
#    glob 的 `?` 吃得下 `/`,四道閘全過(前綴符合、無 `..`、字元集全合法),
#    而 `rm -rf "/tmp//"` 實測**會把整個 /tmp 刪掉**(含別窗還活著的 PG datadir),
#    且 `$D/postmaster.pid` = `/tmp//postmaster.pid` 不存在 ⇒ 併發護欄也不會響 = 靜默。
#    ⇒ 兩道一起補:①第一個字元必須是英數(順帶擋掉 `/tmp/.`、`/tmp/-x`)②路徑中不得有 `//`。
case "$D" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$D])"; exit 1 ;; esac
case "$D" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$D])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
case "$SOCK" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$SOCK])"; exit 1 ;; esac
case "$SOCK" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$SOCK])—— `/tmp//` 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
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

W3VMIG="${W3VMIG:-$REPO/supabase/migrations/20260807200000_m4b_e10_b2_w3c1_void_shipment.sql}"
[ -f "$W3VMIG" ] || die "W3A_MIG_MISSING: $W3VMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807200000"

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
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W3VMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

# ── fixture:客人 → 訂單 → 品項 → 真實到貨 → 包裹 → 掛品項 ──
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w3v@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w3v@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
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
mkbox() { Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')"; }
# 🔴🔴 **`die` 絕不可以放在 `$( )` 裡**(W3c-2 實錘,回頭修本檔的同型):
#    `mkfull` 被 `B="$(mkfull …)"` 呼叫 ⇒ 跑在**子 shell** ⇒ `die` 的 `exit 1` 只結束子 shell、
#    **腳本照樣往下跑**、帶著一個空字串當 shipment_id 繼續建 fixture。
#    🔴 歷史註記(2026-08-08 trap 掃掠後**已失效、留著是為了不讓人以為病因消失了**):
#    當時的 `die` 裡還有一句 `pg_ctl stop`,所以症狀更狠 ——
#    ⇒ 後面每格對死連線發問、`cap()` 回空字串、被讀成「無例外」= 一整排假 FAIL,真因印在最後一行。
mkfull() { # $1=前綴 $2=oi $3=數量 → 印 shipment_id;失敗印空字串、原因寫進 $D/mkfull.err
  B="$(mkbox "$1")"
  case "$B" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(box %s): %s\n' "$1" "$B" >> "$D/mkfull.err"; return ;; esac
  R="$(QM "SELECT public.admin_add_shipment_items('$1-i','$B','[{\"order_item_id\":\"$2\",\"quantity\":$3}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(add %s): %s\n' "$1" "$R" >> "$D/mkfull.err"; return ;; esac
  printf '%s' "$B"
}
OI1='bbbbbbbb-0000-0000-0000-000000000001'; mkitem "$OI1" 5 SKU-1

echo "══ 1. 作廢成功路徑 + 冪等 ═════════════════════════════════"
BOX1="$(mkfull v1 "$OI1" 2)"; case "$BOX1" in ????????-*) : ;; *) die "FIXTURE_FAIL: $(tail -1 "$D/mkfull.err" 2>/dev/null)" ;; esac
R1="$(Q "SELECT public.admin_void_shipment('vd-1','$BOX1','裝錯東西')")"
case "$R1" in
  *'"idempotent": false'*) ok W3C1-VOID-OK "作廢成功,回 record() 的信封 ✓" ;;
  *) bad W3C1-VOID-OK "回傳不對:[$R1]" ;;
esac
V="$(Q "SELECT (deleted_at IS NOT NULL)::text||'|'||coalesce(void_reason,'(null)') FROM public.shipments WHERE id='$BOX1'")"
[ "$V" = "true|裝錯東西" ] && ok W3C1-ROW "deleted_at 與 void_reason **同時**寫進去了(X7 是雙向配對)✓" || bad W3C1-ROW "實得 [$V]"
R2="$(Q "SELECT public.admin_void_shipment('vd-1','$BOX1','裝錯東西')")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text||'|'||('$R2'::jsonb->>'idempotent')")"
[ "$SAME" = "true|true" ] && ok W3C1-REPLAY-IDENTICAL "重放逐鍵與首次相同、只差 idempotent ✓" || bad W3C1-REPLAY-IDENTICAL "[$SAME]"

echo "══ 2. 🔴 退量:不是本片寫的,但要證它真的發生 ═════════════"
# 🔴 本片零行退量程式碼 —— 它在 S2b 的重算裡。本格量的是**結果**,不是我寫了什麼。
BOX2="$(mkfull v2 "$OI1" 3)"; case "$BOX2" in ????????-*) : ;; *) die "FIXTURE_FAIL: $(tail -1 "$D/mkfull.err" 2>/dev/null)" ;; esac
Q "SELECT public.admin_mark_shipment_shipped('sp-2','$BOX2','TRACK-2')" >/dev/null
BEFORE="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")"
Q "SELECT public.admin_void_shipment('vd-2','$BOX2','出貨後發現裝錯')" >/dev/null
AFTER="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")"
[ "$BEFORE" = "3" ] && [ "$AFTER" = "0" ] \
  && ok W3C1-VOID-RESTOCKS "🔴 出貨 3 件 → 作廢 ⇒ 摘要的已出貨數 **3 → 0**(退量真的發生)= Sean 08-05 Q3=A 的實作在 S2b 的重算裡,本片只是觸發它 ✓" \
  || bad W3C1-VOID-RESTOCKS "退量沒發生:before=[$BEFORE] after=[$AFTER]"

echo "══ 3. 🔴 已出貨的箱**可以**作廢(這是唯一的補救路,不是漏擋)══"
# 上一格的 BOX2 就是「已出貨後作廢」⇒ 這裡驗它真的成立、且 shipped_at 仍在(X2 write-once)
V="$(Q "SELECT (shipped_at IS NOT NULL)::text||'|'||(deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$BOX2'")"
[ "$V" = "true|true" ] \
  && ok W3C1-SHIPPED-VOIDABLE "🔴 已出貨的箱作廢成功,而且 **shipped_at 仍在**(X2 write-once 清不掉)⇒ s1a2:170「撤銷出貨的唯一路徑 = 作廢」成立 ✓" \
  || bad W3C1-SHIPPED-VOIDABLE "實得 [$V]"

echo "══ 4. 前緣人話 ════════════════════════════════════════════"
C="$(cap "public.admin_void_shipment('e1','$BOX1','   ')")"
[ "$C" = "P2B26|pcm_b2_w3c1_reason_required" ] && ok W3C1-REASON-BLANK "純空白理由被擋(含全形空格族由 pcm_b2_is_blank 判)⇒ 人話 ✓" || bad W3C1-REASON-BLANK "[$C]"
C="$(cap "public.admin_void_shipment('e2','99999999-9999-9999-9999-999999999999','理由')")"
[ "$C" = "P2B26|pcm_b2_w3c1_shipment_missing" ] && ok W3C1-MISSING "包裹不存在 ⇒ 人話 ✓" || bad W3C1-MISSING "[$C]"
C="$(cap "public.admin_void_shipment('e3','$BOX1','換個理由再作廢一次')")"
[ "$C" = "P2B26|pcm_b2_w3c1_already_voided" ] \
  && ok W3C1-ALREADY-VOIDED "🔴 已作廢再作廢 ⇒ **人話拒絕、不做成 no-op**(第二次帶的是另一個理由,吞掉等於丟稽核資訊)✓" \
  || bad W3C1-ALREADY-VOIDED "[$C]"

# 🔴 跨模型審查 F4:冪等 payload 構造原本零格 —— hash 若漏掉 `void_reason`,12 格全綠。
C="$(cap "public.admin_void_shipment('vd-1','$BOX1','換一個理由')")"
[ "$C" = "P2B22|pcm_b2_w2_idem_payload_mismatch" ] \
  && # 🔴 訊息裡**不得有反引號**:雙引號內的反引號會被 bash 當命令替換(本線第四次踩)。
  ok W3C1-HASH-INCLUDES-REASON "同鍵**不同理由** ⇒ P2B22 = void_reason 真的進了指紋(漏掉的話這裡會靜默重放)✓" \
  || bad W3C1-HASH-INCLUDES-REASON "實得 [$C](期望 P2B22)⇒ 指紋沒含 void_reason"

echo "══ 5. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 前緣「已作廢」那道:拿掉之後會發生什麼(不是「還是紅」而是紅在**別的地方**)
Q "CREATE OR REPLACE FUNCTION public.admin_void_shipment(p_idempotency_key text, p_shipment_id uuid, p_void_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE n bigint; BEGIN UPDATE public.shipments SET deleted_at=now(), void_reason=p_void_reason WHERE id=p_shipment_id AND deleted_at IS NULL; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'rc' USING ERRCODE='P2B26', CONSTRAINT='pcm_b2_w3c1_rowcount'; END IF; RETURN '{}'::jsonb; END \$m\$" >/dev/null
M="$(cap "public.admin_void_shipment('mut-1','$BOX1','再作廢')")"
[ "$M" = "P2B26|pcm_b2_w3c1_rowcount" ] \
  && ok TMUT-ALREADY-VOIDED "🔴 拿掉「已作廢」前緣 ⇒ 改由 **WHERE 的 0 列**接手(實得 rowcount)= 兩道各有各的話要說,前緣那道守的是**訊息品質**不是資料安全" \
  || bad TMUT-ALREADY-VOIDED "實得 [$M]"
# ② WHERE 的 `deleted_at IS NULL`(W3-3 F6 的同族):拿掉它 ⇒ 重複作廢會**改寫既有理由**
Q "CREATE OR REPLACE FUNCTION public.admin_void_shipment(p_idempotency_key text, p_shipment_id uuid, p_void_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN UPDATE public.shipments SET deleted_at=now(), void_reason=p_void_reason WHERE id=p_shipment_id; RETURN '{}'::jsonb; END \$m\$" >/dev/null
Q "SELECT public.admin_void_shipment('mut-2','$BOX1','被蓋掉的新理由')" >/dev/null 2>&1
M="$(Q "SELECT void_reason FROM public.shipments WHERE id='$BOX1'")"
[ "$M" = "被蓋掉的新理由" ] \
  && ok TMUT-WHERE-GUARD "🔴 拿掉 WHERE 的 deleted_at 條件 ⇒ 既有的作廢理由**被蓋掉了**(實得「$M」)= 那個條件守的是稽核資訊不被覆寫" \
  || bad TMUT-WHERE-GUARD "理由沒被蓋:[$M]"
# ③ 退量族:把重算 trigger 拆掉 ⇒ 退量格必須翻面
Q "CREATE OR REPLACE FUNCTION public.admin_void_shipment(p_idempotency_key text, p_shipment_id uuid, p_void_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN UPDATE public.shipments SET deleted_at=now(), void_reason=p_void_reason WHERE id=p_shipment_id AND deleted_at IS NULL; RETURN '{}'::jsonb; END \$m\$" >/dev/null
OI2='bbbbbbbb-0000-0000-0000-000000000002'; mkitem "$OI2" 5 SKU-2
BOX3="$(mkfull v3 "$OI2" 3)"; case "$BOX3" in ????????-*) : ;; *) die "FIXTURE_FAIL: $(tail -1 "$D/mkfull.err" 2>/dev/null)" ;; esac
Q "SELECT public.admin_mark_shipment_shipped('sp-3','$BOX3','TRACK-3')" >/dev/null
# 🔴 跨模型審查 F3:前面兩發突變把 RPC 換掉了、沒還原 ⇒ 這一發若直接跑,
#    消融**一次改了兩個變數**(拆 trigger + 用 mutant RPC)⇒ 它證的是「mutant 不退量」,
#    證不到「**實檔** RPC 沒偷寫退量」。⇒ 拆 trigger 之前先把實檔套回來。
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W3VMIG" >/dev/null 2>&1
RESTORED="$(cap "public.admin_void_shipment('restore-probe','99999999-9999-9999-9999-999999999999','x')")"
[ "$RESTORED" = "P2B26|pcm_b2_w3c1_shipment_missing" ] || die "CELL_SETUP_FAIL(實檔沒還原成功:$RESTORED)"
Q "DROP TRIGGER shipments_summary_recompute_ac ON public.shipments" >/dev/null
Q "SELECT public.admin_void_shipment('mut-3','$BOX3','拆了 trigger 之後作廢')" >/dev/null 2>&1
M="$(Q "SELECT shipped_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI2'")"
[ "$M" = "3" ] \
  && ok TMUT-RESTOCK "🔴 拆掉 S2b 的重算 trigger ⇒ 作廢之後已出貨數**停在 3、沒退回**= W3C1-VOID-RESTOCKS 量的真的是那發 trigger,不是我寫的程式" \
  || bad TMUT-RESTOCK "拆掉 trigger 後已出貨數是 [$M](期望停在 3)"

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
KEYS_FROZEN="DDL-SYNTAX TMUT-ALREADY-VOIDED TMUT-RESTOCK TMUT-WHERE-GUARD W3C1-ALREADY-VOIDED W3C1-HASH-INCLUDES-REASON W3C1-MISSING W3C1-REASON-BLANK W3C1-REPLAY-IDENTICAL W3C1-ROW W3C1-SHIPPED-VOIDABLE W3C1-VOID-OK W3C1-VOID-RESTOCKS"
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
