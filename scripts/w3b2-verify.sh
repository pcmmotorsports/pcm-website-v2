#!/usr/bin/env bash
#
# W3-2 驗收 harness —— `admin_add_shipment_items`(形狀契約 / 交棒 1 前緣拒絕 / 取鎖序 / M3 窗口)
#
# 用法:scripts/w3b2-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W3 列 / §0.3 交棒 1 / §1e M3 + 主視窗 `B-196-A` ② 的附帶格
# 被測物:supabase/migrations/20260807180000_m4b_e10_b2_w3b2_add_shipment_items.sql(**實檔,非內嵌副本**)
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
D="${W3BDB:-/tmp/w3bdb}"; SOCK="${W3BSOCK:-/tmp/w3bsk}"; P="${W3BPORT:-54395}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=34   # 🔴 量出來的。全綠時 PASS = 34 + CELL-ACCOUNT + CELL-KEYSET = 36。(#420-4 加 TMUT-SHAPE;#441②③ 加 SHAPE-12/13)
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
case "$D" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$D])—— [/tmp//] 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
case "$SOCK" in /tmp/[A-Za-z0-9]*|/private/tmp/[A-Za-z0-9]*) : ;; *) echo "REFUSE: 路徑第一段必須以英數開頭(現為 [$SOCK])"; exit 1 ;; esac
case "$SOCK" in *//*) echo "REFUSE: 路徑不得含連續斜線(現為 [$SOCK])—— [/tmp//] 過得了前綴閘但 rm -rf 會刪掉整個 /tmp"; exit 1 ;; esac
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

W3BMIG="${W3BMIG:-$REPO/supabase/migrations/20260807180000_m4b_e10_b2_w3b2_add_shipment_items.sql}"
[ -f "$W3BMIG" ] || die "W3A_MIG_MISSING: $W3BMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807180000"

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
# 🔴 R2 F7:補 -v ON_ERROR_STOP=1,與前綴重放那圈一致 —— 否則中段失敗後續語句照跑,
#    「跑起來了」的觀察會建立在一個半套的狀態上。
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 -f "$W3BMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  # 🔴 W7 跟片② R1 nit(同族):原本「輸出裡沒有 ERROR」就判 PASS —— psql **用戶端層**失敗印的是
  #    小寫 `psql: error:`(不匹配 `*ERROR*`)、`$OUT` 全空也走這裡 ⇒ 又是「沒有壞消息 = 成功」。
  #    加一句正向斷言。🔴 **第一版寫成 `to_regprocedure(...) IS NOT NULL` 是恆真的** ——
  #    `admin_add_shipment_items` 在 W1(`…150000…`)與 W2(`…160000…`)就已建好、兩片都在重放前綴裡,
  #    被測物只是 CREATE OR REPLACE ⇒ 「函式存在」對「被測物有沒有套上」零判別力。
  #    (拿空白假被測物實跑證過:該斷言照樣綠。這一發是突變抓到的,不是想出來的。)
  #    ⇒ 改錨在**只有被測物版本才有**的函式體字面 `pcm_b2_w3b2_items_shape`(前綴內僅 :180000 命中)。
  *) DDLBODY="$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure), 'pcm_b2_w3b2_items_shape') > 0)::text")"   # 🔴 R2 F3:原本尾巴掛 2>/dev/null 是死碼(Q() 已 2>&1),留著會讓人誤以為錯誤被吞、這格 fail-open
     if [ "$DDLBODY" = "true" ]; then
       ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功,且**線上函式體是被測物那一版**(錨 pcm_b2_w3b2_items_shape;不只是「沒看到 ERROR」、也不只是「函式存在」)"
     else
       bad DDL-SYNTAX "🔴 輸出裡沒有 ERROR,但線上函式體不是被測物那一版(錨查得 [$DDLBODY])⇒ migration 沒真的套上去(psql 用戶端層失敗印小寫 psql: error:,[*ERROR*] 抓不到)"; exit 1
     fi ;;
esac

# ── fixture:客人 → 訂單 → 兩個品項 → 到貨(讓 instock > 0)→ 包裹 ──
CUST='11111111-1111-1111-1111-111111111111'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w3b@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w3b@test.local')" >/dev/null
ORD='aaaaaaaa-0000-0000-0000-000000000001'
OI1='bbbbbbbb-0000-0000-0000-000000000001'
OI2='bbbbbbbb-0000-0000-0000-000000000002'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
INV='{"type":"personal"}'
# 🔴 形狀取自 `…m3_s2a_orders_order_items.sql:157-166` 的 order_items_snapshot_whitelist:
#    恰含 title/sku/spec、spec 是物件且值全字串、且不得含 price_store/price_by_tier/cost。
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','$INV'::jsonb,'home')" >/dev/null
ORDOK="$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")"
[ "$ORDOK" = "1" ] || die "FIXTURE_FAIL(orders):$(QM "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,'normal',100,0,100,'home','$INV'::jsonb,'home')" | tr '\n' ' ')"
for pair in "$OI1|SKU-1" "$OI2|SKU-2"; do
  OI="${pair%%|*}"; SKU="${pair#*|}"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI','$ORD','$SKU','$PSNAP'::jsonb,10,10,100)" >/dev/null
done
OIOK="$(Q "SELECT pg_catalog.count(*)::text FROM public.order_items WHERE order_id='$ORD'")"
[ "$OIOK" = "2" ] || die "FIXTURE_FAIL(order_items):$(QM "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI1','$ORD','SKU-1','$PSNAP'::jsonb,10,10,100)" | tr '\n' ' ')"
# 🔴🔴 **instock 必須走真實路徑建(採購 → 到貨),不能手寫摘要列。**
#    首跑我直寫摘要 `instock=5`,結果**任何一次重算都把它算回真值 0** ——
#    出貨那一刻 `pcm_a4a_shipments_summary_recompute` 一跑,instock 變 0、shipped 3 ⇒ C9 當場紅,
#    而那紅的是**我的 fixture**,不是被測物(「前置自證」那道把它抓出來了,沒讓我下錯結論)。
#    ⇒ 改成建 `order_item_procurement` + `..._receipts`,讓 instock 由重算自己算出 5。
# 🔴 A2 的形狀 08-01 已改成 `supplier_id` FK(供應商主檔;memory `project_m4b-supplier-master-decisions`)
#    —— 首跑我照舊的 `supplier_name`/`supplier_canonical_key` 寫,當場不存在。**沒開檔就寫欄名的老病。**
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
mkstock() { # $1=order_item_id $2=到貨數量
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$1',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $1): $PID" ;; esac
  R="$(QM "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$2,now(),'tester')" | tr '\n' ' ')"
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$1'")"
  [ "$N" = "$2" ] || die "FIXTURE_FAIL(instock $1): 實得 [$N] 期望 [$2] :: $R"
}
# 🔴 刻意讓 instock(5)≠ 訂購量(10):值撞在一起的話,前緣格分不出量的是哪一欄
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
mkstock "$OI1" 5
mkstock "$OI2" 5
SHIP="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mk1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
case "$SHIP" in ????????-*) : ;; *) die "FIXTURE_FAIL(shipment): [$SHIP]" ;; esac
ITEMS="[{\"order_item_id\":\"$OI1\",\"quantity\":2},{\"order_item_id\":\"$OI2\",\"quantity\":3}]"

echo "══ 1. 成功路徑 + 排序寫入 + 冪等 ══════════════════════════"
R1="$(Q "SELECT public.admin_add_shipment_items('a-ok','$SHIP','$ITEMS'::jsonb)")"
case "$R1" in
  *'"idempotent": false'*) ok W3B2-ADD-OK "掛品項成功,回 record() 的信封 ✓" ;;
  *) bad W3B2-ADD-OK "回傳不對:[$R1]" ;;
esac
V="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.shipment_items WHERE shipment_id='$SHIP'")"
[ "$V" = "${OI1}x2,${OI2}x3" ] && ok W3B2-ROWS "兩筆品項逐字寫入且依 order_item_id 排序 ✓" || bad W3B2-ROWS "實得 [$V]"
R2="$(Q "SELECT public.admin_add_shipment_items('a-ok','$SHIP','$ITEMS'::jsonb)")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text||'|'||('$R2'::jsonb->>'idempotent')")"
[ "$SAME" = "true|true" ] && ok W3B2-REPLAY-IDENTICAL "重放逐鍵與首次相同、只差 idempotent(to_jsonb 同源契約)✓" || bad W3B2-REPLAY-IDENTICAL "[$SAME]"
N="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items WHERE shipment_id='$SHIP'")"
[ "$N" = "2" ] && ok W3B2-REPLAY-NO-DOUBLE "🔴 重放後品項仍是 2 筆 ⇒ 沒有重複掛 ✓" || bad W3B2-REPLAY-NO-DOUBLE "實得 $N 筆"

echo "══ 2. p_items 形狀契約(本片拍板)════════════════════════"
i=0
SHAPE_ARGS=""; SHAPE_WANT=""   # 🔴 #420-4:供下方 TMUT-SHAPE 重用,見迴圈尾註解
for t in "NULL|pcm_b2_w3b2_items_shape" \
         "'[]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[1,2]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\"}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":1,\"note\":\"x\"}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":0}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":1.5}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":null,\"quantity\":1}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"not-a-uuid\",\"quantity\":1}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":10000000000}]'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":1},{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb|pcm_b2_w3b2_items_duplicate" \
         "'5'::jsonb|pcm_b2_w3b2_items_shape" \
         "'[{\"order_item_id\":\"$OI1\",\"quantity\":\"3\"}]'::jsonb|pcm_b2_w3b2_items_shape"; do
  i=$((i+1)); ARG="${t%%|*}"; WANT="P2B26|${t#*|}"
  C="$(cap "public.admin_add_shipment_items('sh-$i','$SHIP',$ARG)")"
  [ "$C" = "$WANT" ] && ok "W3B2-SHAPE-$i" "形狀契約逐字($WANT)✓" || bad "W3B2-SHAPE-$i" "實得 [$C] 期望 [$WANT]"
  # 🔴 #420-4:把**這一格用過的那個 payload 與期望值**存下來給下方 `TMUT-SHAPE` 重用。
  #    不讓突變靶自己另抄一份清單 —— 抄一份就會漂,而漂了以後靶紅的是「靶自己的輸入」、
  #    不是「這十三格的輸入」(同族=`feedback_assertion-measures-the-wrong-thing` 的冒領形狀)。
  SHAPE_ARGS="$SHAPE_ARGS$ARG@@"; SHAPE_WANT="$SHAPE_WANT$WANT@@"
done

# 🔴 R2 的兩發攻擊 payload(審查者直接給的,原樣貼進來當格)
UP1="$(Q "SELECT pg_catalog.upper('$OI1')")"
C="$(cap "public.admin_add_shipment_items('m1','$SHIP','[{\"order_item_id\":\"$UP1\",\"quantity\":1},{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
[ "$C" = "P2B26|pcm_b2_w3b2_items_duplicate" ] \
  && ok W3B2-DUP-CASE "🔴 同一個 uuid 用**大小寫兩種寫法**送兩筆 ⇒ 仍被重複守門擋(首版用原始文字分組會穿過去、撞 raw 23505)✓" \
  || bad W3B2-DUP-CASE "實得 [$C] ⇒ 大小寫繞得過重複守門"
# 🔴🔴 W7 跟片②(2026-08-09,B-298-Q ②):本格原本**一次都沒真的呼叫過 RPC**,兩個缺陷疊在一起:
#    ① 它引用 `$OI3`,而 OI3 到下方 `W3B2-BOUNDARY` 那格才宣告 ⇒ 本檔 `set -u` 在 `cap` 的
#       **command substitution 子 shell** 裡炸掉;父腳本活著、`$C` 拿到**空字串**。
#    ② 而空字串當時與「放行」共用 PASS 分支 ⇒ harness 把自己的崩潰翻譯成 `PASS …(實得 [放行])`。
#    修法兩件,少一件都還是空轉:
#    ① 用**本格自己的乾淨品項** OI6(不借用 OI3 —— 借了會吃掉下方邊界格的可出量,
#       那格的可出量正是它要量的東西),且宣告就在使用之前。
#    ② `cap` 回空字串**不得單獨判 PASS**:空字串在本檔有兩個來源(真的沒例外 / cap 自己死掉),
#       要配**寫入效果斷言**才分得開(同 F5 對 `W3B2-BOUNDARY` 的處置、檔頭 :15-17 記過的坑)。
OI6='bbbbbbbb-0000-0000-0000-000000000006'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI6','$ORD','SKU-6','$PSNAP'::jsonb,10,10,100)" >/dev/null
mkstock "$OI6" 5
C="$(cap "public.admin_add_shipment_items('m2','$SHIP','[{\"order_item_id\":\"$OI6\",\"quantity\":1.0}]'::jsonb)")"
WN="$(Q "SELECT coalesce(pg_catalog.string_agg(shipped_quantity::text,','),'(無)') FROM public.shipment_items WHERE shipment_id='$SHIP' AND order_item_id='$OI6'")"
case "$C" in
  22P02*) bad W3B2-QTY-SCALE "🔴 實得 raw 22P02 ⇒ 1.0 仍在下游 cast 裸炸" ;;
  "")     [ "$WN" = "1" ] \
            && ok W3B2-QTY-SCALE "🔴 quantity 送 1.0(jsonb 保留 scale)不在 ::int 裸炸,**且真的寫進 shipped_quantity=1** ⇒ 空字串配寫入效果才採信 ✓" \
            || bad W3B2-QTY-SCALE "🔴 cap 回空字串但 shipment_items 沒有這筆(實際寫入=[$WN])⇒ 這是 harness 空轉,不是放行" ;;
  # 🔴 R1(code-reviewer)must-fix:原本這裡有一條 `P2B2*) ok`(「被人話擋下也算沒裸炸」)——
  #    **那是新的假綠面**。判準:本格 fixture 下(qty=1、形狀閘明文接受 1.0、OI6 為本格自建且
  #    可出 5、pending 0、冪等鍵 `m2` 全檔唯一)**唯一的合法結果就是 `C="" ∧ WN=1`**;
  #    任何 P2B2x 都是回歸 ⇒ 讓它落到下面的 `*) bad`。
  # 🔴 R2 更正一句我原本寫錯的理由:**不是**「所有 P2B2x 都 raise 在 cast 之前」——
  #    P2B27(被測物 :254)與 P2B26 rowcount(:272)在 cast(:236)**之後**,
  #    P2B27 甚至是從**含該 cast 的同一個 CTE** 算出來的。所以刪這條分支的理由是
  #    「本格構造不出合法的 P2B2x」,不是「P2B2x 蘊含 cast 沒走到」。後者是假的,別引用。
  *) bad W3B2-QTY-SCALE "實得 [$C](本格唯一合法結果是「無例外 + 寫入 1」;P2B2x 代表擋在 cast 之前 ⇒ 這格量不到它要量的東西)" ;;
esac

echo "══ 3. 包裹狀態 + 品項歸屬的人話前緣 ═══════════════════════"
C="$(cap "public.admin_add_shipment_items('st-1','99999999-9999-9999-9999-999999999999','$ITEMS'::jsonb)")"
[ "$C" = "P2B26|pcm_b2_w3b2_shipment_missing" ] && ok W3B2-SHIP-MISSING "包裹不存在 ⇒ 人話 ✓" || bad W3B2-SHIP-MISSING "[$C]"
CUST2='22222222-0000-0000-0000-000000000002'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST2','w3b2@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST2','w3b2@test.local')" >/dev/null
SHIP2="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mk2','$CUST2','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
C="$(cap "public.admin_add_shipment_items('st-2','$SHIP2','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
[ "$C" = "P2B26|pcm_b2_w3b2_item_not_customers" ] && ok W3B2-CROSS-CUSTOMER "別的客人的品項 ⇒ 人話擋(A7 是真守門,這裡是訊息層)✓" || bad W3B2-CROSS-CUSTOMER "[$C]"

echo "══ 4. 🔴 交棒 1:增量 ≤ instock − shipped ═════════════════"
SHIP3="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mk3','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
C="$(cap "public.admin_add_shipment_items('ex-1','$SHIP3','[{\"order_item_id\":\"$OI1\",\"quantity\":6}]'::jsonb)")"
[ "$C" = "P2B27|pcm_b2_w3b2_exceeds_instock" ] && ok W3B2-EXCEEDS "要 6 件、超過當下可出量 ⇒ P2B27 ✓(可出量會隨 pending 變動,故此處不寫死數字——R2 指出首版寫死的 5 與事實不符)" || bad W3B2-EXCEEDS "[$C]"
MSG="$(QM "SELECT public.admin_add_shipment_items('ex-2','$SHIP3','[{\"order_item_id\":\"$OI1\",\"quantity\":6}]'::jsonb)" | tr '\n' ' ')"
case "$MSG" in
  *"可出 "*" 件"*"你要出 6 件"*) ok W3B2-EXCEEDS-MESSAGE "訊息講得出**可出幾件 / 你要幾件**(交棒 1 的訊息層要求)✓" ;;
  *) bad W3B2-EXCEEDS-MESSAGE "訊息不含可操作數字:[$MSG]" ;;
esac
# 🔴 前緣量的是 instock 不是 quantity:訂 10、instock 5,要 6 被擋、要 5 放行 ⇒ 邊界對在 5
SHIP4="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mk4','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
# 🔴 F5(Fable):`[ -z "$C" ]` 單獨用會把「cap 自己失敗」讀成 PASS —— 本檔 :15-17 自己寫過這個坑。
#    ⇒ 加**寫入效果斷言**。並且 F2 修完之後,邊界的定義變成「instock − shipped − 別箱 pending」,
#    所以這格要用一個**乾淨的品項**(OI2 在別處已被掛 3)才量得準 ⇒ 另建 OI3。
OI3='bbbbbbbb-0000-0000-0000-000000000003'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI3','$ORD','SKU-3','$PSNAP'::jsonb,10,10,100)" >/dev/null
mkstock "$OI3" 5
C="$(cap "public.admin_add_shipment_items('bd-1','$SHIP4','[{\"order_item_id\":\"$OI3\",\"quantity\":5}]'::jsonb)")"
BN="$(Q "SELECT coalesce(pg_catalog.string_agg(shipped_quantity::text,','),'(無)') FROM public.shipment_items WHERE shipment_id='$SHIP4' AND order_item_id='$OI3'")"
case "$C:$BN" in
  :5) ok W3B2-BOUNDARY "邊界值 5(= 可出量)放行**且真的寫了 5 件**進去 ⇒ 量的是可出量、不是訂購量(10)✓" ;;
  *)  bad W3B2-BOUNDARY "邊界值格:例外=[${C:-無}] 實際寫入=[$BN](期望 無例外 + 5)" ;;
esac
# 🔴🔴 F1(Fable):**沒有摘要列**的品項(從未有採購紀錄)——首版 INNER JOIN 會讓它靜默放行
OI4='bbbbbbbb-0000-0000-0000-000000000004'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI4','$ORD','SKU-4','$PSNAP'::jsonb,10,10,100)" >/dev/null
NOSUM="$(Q "SELECT pg_catalog.count(*)::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI4'")"
if [ "$NOSUM" != "0" ]; then
  bad W3B2-NO-SUMMARY-ROW "🔴 本格的**前置**沒成立(OI4 竟然有摘要列)⇒ 這不是守門的結論"
else
  C="$(cap "public.admin_add_shipment_items('ns-1','$SHIP4','[{\"order_item_id\":\"$OI4\",\"quantity\":1}]'::jsonb)")"
  [ "$C" = "P2B27|pcm_b2_w3b2_exceeds_instock" ] \
    && ok W3B2-NO-SUMMARY-ROW "🔴 **沒有摘要列**的品項(可出 0 件)被擋 ⇒ LEFT JOIN + COALESCE 生效(首版 INNER JOIN 會靜默放行)✓" \
    || bad W3B2-NO-SUMMARY-ROW "實得 [$C] ⇒ 惰性建列那條路仍是開的"
fi
# 🔴🔴 F2(Fable):**跨呼叫累加** —— 箱 A 掛 3、箱 B 再掛 3(可出 5)必須被擋
OI5='bbbbbbbb-0000-0000-0000-000000000005'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI5','$ORD','SKU-5','$PSNAP'::jsonb,10,10,100)" >/dev/null
mkstock "$OI5" 5
SHIPA="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mkA','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
SHIPB="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mkB','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
CA="$(cap "public.admin_add_shipment_items('acc-1','$SHIPA','[{\"order_item_id\":\"$OI5\",\"quantity\":3}]'::jsonb)")"
CB="$(cap "public.admin_add_shipment_items('acc-2','$SHIPB','[{\"order_item_id\":\"$OI5\",\"quantity\":3}]'::jsonb)")"
case "$CA:$CB" in
  ":P2B27|pcm_b2_w3b2_exceeds_instock") ok W3B2-PENDING-ACCUM "🔴 箱 A 掛 3 過、箱 B 再掛 3 **被擋**(合計 6 > 可出 5)⇒ 未出貨箱的 pending 量真的有算進去(首版順序操作就繞得過)✓" ;;
  *) bad W3B2-PENDING-ACCUM "A=[${CA:-無}] B=[${CB:-無}](期望 A 放行、B 擋在 P2B27)⇒ 跨呼叫累加仍是洞" ;;
esac
MSGP="$(QM "SELECT public.admin_add_shipment_items('acc-3','$SHIPB','[{\"order_item_id\":\"$OI5\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
case "$MSGP" in
  *"已裝在尚未出貨的包裹裡 "*" 件,含本箱"*) ok W3B2-PENDING-MESSAGE "訊息講得出**有多少件卡在別的未出貨包裹裡** ⇒ 員工知道要去哪裡找 ✓" ;;
  *) bad W3B2-PENDING-MESSAGE "訊息沒說明 pending 去向:[$MSGP]" ;;
esac
# 🔴 N2(Fable):已作廢 / 已寄出兩條人話分支原本零格
# 🔴 R2 F4:這道 setup 原本 `>/dev/null`(而 Q() 已 2>&1 ⇒ 連錯誤一起丟)且**沒有前置自證** ——
#    緊鄰的「已寄出」那格為了同一個坑補過,這邊只補了一半。欄位改名時本格會紅在 `[]`,
#    讀起來像「守門沒擋」,其實是「我的 setup 壞了」(判準第三句)。
UPDV="$(QM "UPDATE public.shipments SET deleted_at = now(), void_reason = 'test' WHERE id='$SHIPB'" | tr '\n' ' ')"
VOIDED="$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$SHIPB'")"
if [ "$VOIDED" != "true" ]; then
  bad W3B2-SHIP-VOIDED "🔴 本格的**前置**沒成立(包裹沒被設成已作廢:$UPDV)⇒ 這不是守門的結論"
else
  C="$(cap "public.admin_add_shipment_items('vd-1','$SHIPB','[{\"order_item_id\":\"$OI5\",\"quantity\":1}]'::jsonb)")"
  [ "$C" = "P2B26|pcm_b2_w3b2_shipment_voided" ] && ok W3B2-SHIP-VOIDED "已作廢的包裹不能再加品項 ⇒ 人話 ✓" || bad W3B2-SHIP-VOIDED "[$C]"
fi
# 🔴 setup **不得靜默失敗**:首跑這裡 `>/dev/null` 吃掉了 UPDATE 的錯,結果本格紅在 23505(撞唯一鍵)
#    而不是「已寄出」——那是「我的 setup 壞了」被讀成「守門沒擋」(判準第三句)。⇒ 前置自證。
UPD="$(QM "UPDATE public.shipments SET shipped_at = now(), tracking_number='T-A' WHERE id='$SHIPA'" | tr '\n' ' ')"
SHIPPED="$(Q "SELECT (shipped_at IS NOT NULL)::text FROM public.shipments WHERE id='$SHIPA'")"
if [ "$SHIPPED" != "true" ]; then
  bad W3B2-SHIP-SHIPPED "🔴 本格的**前置**沒成立(包裹沒被設成已寄出:$UPD)⇒ 這不是守門的結論"
else
  C="$(cap "public.admin_add_shipment_items('sp-1','$SHIPA','[{\"order_item_id\":\"$OI3\",\"quantity\":1}]'::jsonb)")"
  [ "$C" = "P2B26|pcm_b2_w3b2_shipment_shipped" ] && ok W3B2-SHIP-SHIPPED "已寄出的包裹不能再加品項 ⇒ 人話(在撞唯一鍵之前就擋掉)✓" || bad W3B2-SHIP-SHIPPED "[$C]"
fi

echo "══ 5. 🔴🔴 M3 窗口:掛品項當下 C9 **不發火**(B-196-A ② 的附帶格)══"
# 🔴 這格釘的是一個**已知窗口**,不是一個守門。它現在期望「裸錯 / 進得去」;
#    W3-3 的攔截轉譯落地後,期望值改成轉譯後的人話 = W3-3 的驗收之一。
SHIP5="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mk5','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
# 🔴 數量刻意選 **7**:>instock(5)但 ≤quantity(10)⇒ 出貨時**只有** `oiqs_shipped_le_instock` 會紅。
#    首跑用 99 時先撞到同族的 `oiqs_cancelled_shipped_le_quantity`(cancelled+shipped ≤ quantity),
#    那不是本格要證的那一條 —— 一根因多症狀 ≠ 多證據,靶要對準。
C="$(capstmt "INSERT INTO public.shipment_items(shipment_id,order_item_id,shipped_quantity) VALUES('$SHIP5','$OI1',7)")"
# 🔴 W7 跟片②:本格與 QTY-SCALE 同族 —— 原本只有 `[ -z "$C" ]`,而空字串在本檔有兩個來源
#    (真的沒例外 / capstmt 自己死掉)⇒ 「零錯誤進得去」的**「進得去」那半句從來沒被觀察過**。
#    加寫入效果斷言把兩個來源分開;這也讓本格對「W3-3 落地後這裡改成被擋」真的有判別力。
M3N="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items WHERE shipment_id='$SHIP5' AND order_item_id='$OI1' AND shipped_quantity=7")"
case "$C:$M3N" in
  :1) ok W3B2-M3-NO-C9-AT-ADD "🔴 **繞過 RPC 直寫 7 件(超過可出的 5 件)零錯誤進得去、且列真的在** ⇒ 重算 trigger 不掛 shipment_items、掛品項當下 C9 不發火 ⇒ 本片的前緣是唯一擋這件事的東西(檔頭那句已據此更正)" ;;
  :*) bad W3B2-M3-NO-C9-AT-ADD "🔴 capstmt 沒回錯但那一列不在(實得 $M3N 列)⇒ 空轉,不是「進得去」" ;;
  *)  bad W3B2-M3-NO-C9-AT-ADD "實得 [$C] ⇒ 掛品項當下就有守門,檔頭的更正要重寫" ;;
esac
# 🔴 出貨還有一道 `shipments_shipped_needs_tracking`(設 shipped_at 必須同時有單號)——
#    首跑就是紅在它、而不是 C9 ⇒ 那不是本格要的結論(判準第三句)。⇒ 一併給單號,讓 C9 成為唯一可紅的那道。
C="$(capstmt "UPDATE public.shipments SET shipped_at = now(), tracking_number = 'TRACK-1' WHERE id='$SHIP5'")"
case "$C" in
  # 🔴🔴 **W3-3 落地後,本格的期望值「不改」——而且這件事要說清楚**(開工令 B-197-A ④ 要我改,
  #    實際檢查後**不該改**):本格走的是**繞過 RPC 的直寫 UPDATE**,量的是**裸 DB 面**,
  #    而 W3-3 的轉譯掛在 `admin_mark_shipment_shipped` 的**執行路徑上** ⇒ 直寫這條路本來就不經過它。
  #    ⇒ 這裡**仍然**、也**應該**是 raw 23514;真正驗「RPC 路徑已轉譯」的是 `w3c3-verify.sh` 的
  #      `W3C3-TRANSLATE-C9`。兩格量的是兩個不同的面,不得互相冒領。
  23514*oiqs_shipped_le_instock*) ok W3B2-M3-WINDOW-RAW "🔴 到**出貨那一刻**才炸、且是 **raw 23514**(實得 [$C])= 裸 DB 面的窗口;RPC 路徑的轉譯由 w3c3 的 W3C3-TRANSLATE-C9 驗,兩面不互相冒領" ;;
  *) bad W3B2-M3-WINDOW-RAW "實得 [$C](期望 raw 23514 oiqs_shipped_le_instock)⇒ 窗口的形狀與檔頭描述不符" ;;
esac

echo "══ 6. 🔴 突變靶 ═══════════════════════════════════════════"
# ══ #420-4:形狀契約整族本來**零靶**(當時為 `W3B2-SHAPE-1..11`;#441②③ 後擴為 `1..13`)══
# 🔴 為什麼不能「拿掉整段形狀驗證、看十三格一起紅」:那只證明「有東西在擋」,
#    證不到**每一格各自守的那個子條件**還在。這十三格其實打在 **6 道閘**上,
#    而同一道閘裡的子條件彼此蘊含(例:`order_item_id: null` 就算穿過型別那半,
#    也會被同閘的 uuid 正規式接住)⇒ 整族一發打完 = 十三格共用一個結論。
#    ⇒ 靶必須**逐子條件放寬**,而且每一發都要驗「**只**紅它對應的那幾格、其餘保持綠」。
# 🔴 突變體怎麼產:用 `pg_get_functiondef` 回讀**現行定義**、在 SQL 層 `replace` 一個子條件、
#    再 `\gexec` 套回去 —— **不手抄函式本體**(手抄會漂、抄錯還會靜默放行)。
#    整發包在交易裡 ROLLBACK,不留給後面的格。
# 🔴 每一發都有三道自證,少一道就會把「我的突變沒套上」講成「守門歸屬錯」
#    (這正是本檔 `DDL-SYNTAX` 與 `TMUT-FRONTEDGE` 記過的那族,#420-3 也才因此被審回兩輪):
#    ① needle 在定義裡**恰好出現 1 次**(出現 0 次=沒打中;>1 次=順手改壞了別的地方)
#    ② 套用後 needle **真的不見了**  ③ 十三格的觀察值逐格回報,紅格集合要**逐字等於**預期。
# 🔴 payload 不另抄一份,直接重用上面那十三格用過的 `$SHAPE_ARGS`(見 :2 節迴圈尾)。
shape_mut() {   # $1=needle  $2=replacement  $3=(選填)訊息自證 "<格號>:<期望子字串>" → 印「紅格索引」或 ERR:<原因>
  local rest vals a n out i got want mi msub mgot
  rest="$SHAPE_ARGS"; vals=""; n=0
  while [ -n "$rest" ]; do
    a="${rest%%@@*}"; rest="${rest#*@@}"; n=$((n+1))
    vals="$vals,($n,($a)::jsonb)"
  done
  vals="${vals#,}"
  [ "$n" = "13" ] || { echo "ERR:payload 只湊到 $n 個(期望 13)"; return; }
  out="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
          -v ON_ERROR_STOP=1 -v needle="$1" -v repl="$2" -f - 2>&1 <<EOSQL
BEGIN;
SELECT 'UNIQ|' || ((pg_catalog.length(d) - pg_catalog.length(pg_catalog.replace(d, :'needle', ''))) / pg_catalog.length(:'needle'))::text
  FROM (SELECT pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure) AS d) s;
SELECT pg_catalog.replace(d, :'needle', :'repl')
  FROM (SELECT pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure) AS d) s \gexec
SELECT 'GONE|' || (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure), :'needle') = 0)::text;
DO \$p\$
DECLARE r record; c text; nm text; mg text;
BEGIN
  FOR r IN SELECT * FROM (VALUES $vals) v(i, items) ORDER BY 1 LOOP
    -- R1 nit:十三個 payload 跑在同一個交易裡,放寬 quantity 那幾發會讓前面的格**真的寫進列**,
    -- 後面的格就在被前面的格改過的狀態上量。⇒ 每一格跑完都要把自己的寫入收掉。
    -- 🔴 **不能用 SAVEPOINT**:plpgsql 不允許區塊內做交易控制(首版這樣寫 ⇒ DO block 整個炸掉、
    --    當時十一發全報「沒有觀察值」—— 又是被三道自證擋下來的,不是靜默變綠)。
    --    帶 EXCEPTION 的區塊本身就是隱式 savepoint ⇒ 成功路徑**故意擲一個哨兵例外**讓它回滾,
    --    再於 handler 裡把哨兵翻譯回「無例外」。
    BEGIN
      PERFORM public.admin_add_shipment_items('mt'||r.i::text, '$SHIP'::uuid, r.items);
      RAISE EXCEPTION 'ZZPROBE_OK';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, nm = CONSTRAINT_NAME, mg = MESSAGE_TEXT;
      IF mg = 'ZZPROBE_OK' THEN c := '(無例外)'; nm := NULL; mg := ''; END IF;
    END;
    -- R1 nit:第三欄的空值表示法**逐字對齊 cap()**(:120 用 '(null)'),兩個觀察面才可互相比對;
    -- 上面那十三格的期望值就是 cap() 產的,這裡不一致的話比對會在「無 constraint」那類錯上分岔。
    RAISE NOTICE 'SHP|%|%|%', r.i, c, coalesce(nm,'(null)');
    RAISE NOTICE 'SHM|%|%', r.i, coalesce(mg,'');
  END LOOP;
END \$p\$;
ROLLBACK;
EOSQL
        )"
  # ① needle 唯一 ② 套用後真的不見了 —— 兩道都用**這一發自己的輸出**判,不憑推論
  # 🔴 R1 MF-2:這裡**必須先抽值再比等於**。首版寫 `case "$out" in *'UNIQ|1'*)` ⇒ needle
  #    命中 10 次會印 `UNIQ|10`,**含**子字串 `UNIQ|1` ⇒「恰好 1 次」對「10 次」放行 = 打太廣
  #    方向的 fail-open,而註解與 NOTE 都宣稱它驗的是「恰好 1」⇒ 宣稱強於程式碼。
  a="$(printf '%s' "$out" | sed -n 's/.*UNIQ|\([0-9]*\).*/\1/p' | head -1)"
  [ "$a" = "1" ] || { echo "ERR:needle 出現次數不是 1(實得 ${a:-空})"; return; }
  a="$(printf '%s' "$out" | sed -n 's/.*GONE|\(.*\)/\1/p' | head -1)"
  [ "$a" = "true" ] || { echo "ERR:突變沒套上(needle 還在,或 gexec 失敗;GONE 實得 ${a:-空})"; return; }
  # ③ 逐格比對觀察值,收集紅格
  rest="$SHAPE_WANT"; i=0; got=""
  while [ -n "$rest" ]; do
    want="${rest%%@@*}"; rest="${rest#*@@}"; i=$((i+1))
    # 🔴 錨點**不能**用 `^SHP|`:psql 的 NOTICE 帶 `NOTICE:  ` 前綴 ⇒ 行首不是 SHP。
    #    同檔 `cap()`(:120)用的就是 `.*CAP|`,這裡對齊它。首版寫 `^P|` ⇒ 當時十一發全部
    #    回報「沒有觀察值」—— 被自證擋下來了,而不是靜默判成通過(這正是三道自證的用處)。
    a="$(printf '%s' "$out" | sed -n "s/.*SHP|$i|\(.*\)/\1/p" | head -1)"
    [ -n "$a" ] || { echo "ERR:第 $i 格沒有觀察值(DO block 沒跑完)"; return; }
    [ "$a" = "$want" ] || got="$got $i"
  done
  # ④(選填)訊息層自證:給了 `$3` 就要求指定那格的**訊息**含指定子字串。
  # 🔴 用途=當某個子條件被**嚴格蘊含**時(拿掉它,那格照樣被同閘的下一個子條件擋住、
  #    SQLSTATE 與 CONSTRAINT 都不變 ⇒ 紅格集合為空),空的紅格集合會讓這一發變成恆真。
  #    ⇒ 那種發次改用「訊息換人了」當證據:它證明突變**真的生效**、且證明那格的
  #      SQLSTATE/CONSTRAINT 觀察面**看不到**這個子條件(= 那格對它沒有判別力,是發現不是瑕疵)。
  if [ -n "${3:-}" ]; then
    mi="${3%%:*}"; msub="${3#*:}"
    mgot="$(printf '%s' "$out" | sed -n "s/.*SHM|$mi|\(.*\)/\1/p" | head -1)"
    [ -n "$mgot" ] || { echo "ERR:第 $mi 格沒有訊息觀察值"; return; }
    case "$mgot" in *"$msub"*) : ;; *) echo "ERR:第 $mi 格訊息未換人(實得 [$mgot])⇒ 突變沒生效,不能拿空紅格當結論"; return ;; esac
  fi
  printf '%s' "${got# }"
}
SHAPE_MUT_BAD=""; SHAPE_MUT_N=0; SHAPE_NEEDLES=""
while IFS= read -r m; do
  [ -n "$m" ] || continue
  # 🔴 R1 nit:欄位數**固定為 4**、逐行驗。首版用「第四欄等於第三欄就當沒寫」來推斷,
  #    那在兩欄撞值的那天會**靜默把訊息自證關掉**(關掉之後第 3 發的空紅格就變恆真)。
  MFN="$(printf '%s' "$m" | awk -F'~~' '{print NF}')"
  [ "$MFN" = "4" ] || { SHAPE_MUT_BAD="$SHAPE_MUT_BAD [突變表第 $((SHAPE_MUT_N+1)) 行欄位數 $MFN != 4]"; SHAPE_MUT_N=$((SHAPE_MUT_N+1)); continue; }
  NEEDLE="${m%%~~*}"; MREST="${m#*~~}"; REPL="${MREST%%~~*}"; MREST="${MREST#*~~}"
  REDWANT="${MREST%%~~*}"; MSGCHK="${MREST#*~~}"
  SHAPE_NEEDLES="$SHAPE_NEEDLES$NEEDLE@@"   # 供下方「十三發全還原」逐發掃描
  SHAPE_MUT_N=$((SHAPE_MUT_N+1))
  GOT="$(shape_mut "$NEEDLE" "$REPL" "$MSGCHK")"
  case "$GOT" in
    ERR:*) SHAPE_MUT_BAD="$SHAPE_MUT_BAD [第 $SHAPE_MUT_N 發 $GOT]" ;;
    *) [ "$GOT" = "$REDWANT" ] || SHAPE_MUT_BAD="$SHAPE_MUT_BAD [第 $SHAPE_MUT_N 發 紅格($GOT)!=期望($REDWANT)]" ;;
  esac
done <<'EOM'
p_items IS NULL OR ~~~~1~~
 OR pg_catalog.jsonb_array_length(p_items) = 0~~~~2~~
pg_catalog.jsonb_typeof(e.value) <> 'object'~~false~~~~3:每個元素只能有 order_item_id 與 quantity 兩個欄位
NOT (e.value ?& ARRAY['order_item_id','quantity'])~~false~~4~~
(e.value - ARRAY['order_item_id','quantity']) <> '{}'::jsonb~~false~~5~~
(e.value ->> 'quantity')::numeric <= 0~~false~~6~~
(e.value ->> 'quantity')::numeric <> pg_catalog.floor((e.value ->> 'quantity')::numeric)~~false~~7~~
pg_catalog.jsonb_typeof(e.value -> 'order_item_id') <> 'string'~~false~~8~~
(e.value ->> 'order_item_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'~~false~~9~~
(e.value ->> 'quantity')::numeric > 10000~~false~~10~~
IF v_n > 0 THEN~~IF false THEN~~11~~
pg_catalog.jsonb_typeof(p_items) <> 'array' OR ~~~~12~~
pg_catalog.jsonb_typeof(e.value -> 'quantity') <> 'number'~~false~~13~~
EOM
# 🔴 發數也要凍結:少寫一發 = 少一格沒靶,而上面那個迴圈**不會因此變紅**(它只檢查寫下的那幾發)。
[ "$SHAPE_MUT_N" = "13" ] || SHAPE_MUT_BAD="$SHAPE_MUT_BAD [突變發數 $SHAPE_MUT_N != 13]"
# 🔴 R1 nit:十三發都靠交易 ROLLBACK 還原,但「還原了」一路上都是**推論**、沒有常設斷言。
#    補一道正向。🔴 R2 殘 nit:錨**十三發全掃**、不是只挑第一發 —— 只驗第一發的話,
#    第 2..13 發任何一發沒還原都看不到,而那正是這道斷言存在的理由(挑一個成員驗整族
#    = 本檔判準四句的第四句「家族格的靶不得只打一個成員」,自己也不能犯)。
#    壞了併進 SHAPE_MUT_BAD、不另開格(格數維持 34 = `EXPECT_TOTAL`,見 :26)。
SHAPE_RST_BAD=""; rest="$SHAPE_NEEDLES"
while [ -n "$rest" ]; do
  a="${rest%%@@*}"; rest="${rest#*@@}"
  # 🔴 `:'needle'` 的代換**只在 `-f` 路徑成立**,`-c` 下不代換(首版寫 -c ⇒ 當時十一發全報
  #    `syntax error at or near ":"`)。上面的 shape_mut 用的就是 `-f -`,這裡對齊它。
  v="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -v needle="$a" -f - 2>&1 <<'EOSQL2' | tr -d '\n'
SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure), :'needle') > 0)::text;
EOSQL2
)"
  [ "$v" = "true" ] || SHAPE_RST_BAD="$SHAPE_RST_BAD [$(printf '%s' "$a" | cut -c1-30)…=${v:-空}]"
done
[ -z "$SHAPE_RST_BAD" ] || SHAPE_MUT_BAD="$SHAPE_MUT_BAD [十三發跑完後函式沒還原:$SHAPE_RST_BAD ⇒ 後面的格全部不可信]"
# 🔴🔴 **本格的結論要照事實寫,不是照計畫寫**(#420-4 實跑發現,不是設計時就知道的):
#    十三發裡有 **十二發**如預期「只紅它對應的那一格、其餘十二格保持綠」;
#    **第 3 發(元素須為物件)紅格集合是空的** —— 拿掉那個子條件後,`[1,2]` 的元素
#    照樣被同閘的**下一個**子條件(欄位集合須恰為兩欄)擋住,`?&` 對非物件回 false ⇒
#    `NOT (...)` 為真 ⇒ SQLSTATE 與 CONSTRAINT **完全不變**。
#    ⇒ `W3B2-SHAPE-3` 對「元素須為物件」這條規則**沒有判別力**:那條規則刪掉,該格照樣綠。
#    這是**對被測物的發現**,不是本靶的瑕疵;所以那一發改用「訊息換人了」當證據
#    (證明突變真的生效、而那格的觀察面看不到它),並在這裡寫明,不讓空紅格變成恆真。
# 🔴 R1 MF-1:訊息裡**不得用反引號** —— 雙引號內的反引號是命令替換,實跑會吐
#    W3B2-SHAPE-3: command not found 到 stderr、而 PASS 那行的格名**被吃掉印成空白**
#    ⇒ 原始碼寫了、輸出沒有,「已寫明」在執行面不成立。改用中括號。
[ -z "$SHAPE_MUT_BAD" ] && ok TMUT-SHAPE "🔴 十三發逐子條件放寬:**十二發**各自只紅它對應的那一格、其餘保持綠;**第 3 發**紅格為空且由訊息換人自證 ⇒ [W3B2-SHAPE-3] 對「元素須為物件」無判別力(見上方註解,已知並寫明,非恆真)" \
                       || bad TMUT-SHAPE "有發次不成立:$SHAPE_MUT_BAD"

# ① 前緣拒絕族:拿掉那一段 ⇒ 超量**真的裝得進箱**(這正是它守的東西)
Q "CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN INSERT INTO public.shipment_items(shipment_id,order_item_id,shipped_quantity) SELECT p_shipment_id,(e.value->>'order_item_id')::uuid,(e.value->>'quantity')::int FROM pg_catalog.jsonb_array_elements(p_items) e ORDER BY 2; RETURN '{}'::jsonb; END \$m\$" >/dev/null
# 🔴 R2-F-C4:原本沒排除**已作廢**的箱、也沒 ORDER BY ⇒ 若 heap 序改變選中作廢箱,
#    mutant 的 INSERT 會被 S1b 的 parent guard 擋 ⇒ 本格**誤紅**(靠插入序碰巧穩定)。
# 🔴 R2 F5:突變體**換上去了沒有**要自證 —— 這是 DDL-SYNTAX 剛修掉的同一族
#    (「我以為它換上去了」)。若 CREATE OR REPLACE 失敗,原函式仍在 ⇒ M=P2B27、MN=0 ⇒
#    本格紅在「那族守的不是這段」= 把「我的突變沒套上」講成「守門歸屬錯」。
MUTON="$(Q "SELECT (pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_add_shipment_items(text,uuid,jsonb)'::regprocedure), 'pcm_b2_w3b2_items_shape') = 0)::text")"
[ "$MUTON" = "true" ] || die "MUTANT_NOT_APPLIED(TMUT-FRONTEDGE):突變體沒換上去(錨查得 [$MUTON])⇒ 本格的結論不成立,停"
SHIP6="$(Q "SELECT id::text FROM public.shipments WHERE customer_user_id='$CUST' AND shipped_at IS NULL AND deleted_at IS NULL AND id NOT IN (SELECT DISTINCT shipment_id FROM public.shipment_items) ORDER BY created_at, id LIMIT 1")"
if [ -z "$SHIP6" ]; then
  bad TMUT-FRONTEDGE "🔴 本格的**前置**沒成立(找不到空包裹可用)⇒ 不是守門的結論"
else
  M="$(cap "public.admin_add_shipment_items('mut-1','$SHIP6','[{\"order_item_id\":\"$OI1\",\"quantity\":99}]'::jsonb)")"
  MN="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items WHERE shipment_id='$SHIP6' AND shipped_quantity=99")"
  case "$M:$MN" in
    :1) ok TMUT-FRONTEDGE "🔴 拿掉前緣拒絕 ⇒ 99 件**零錯誤裝進箱**(實測寫入 1 筆)= W3B2-EXCEEDS 那族守的就是這件事,而且它不是「只有訊息」" ;;
    *)  bad TMUT-FRONTEDGE "拿掉之後實得 [$M]、寫入 $MN 筆 ⇒ 那族守的不是這段" ;;
  esac
fi

echo "══ 7. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-FRONTEDGE TMUT-SHAPE W3B2-ADD-OK W3B2-BOUNDARY W3B2-CROSS-CUSTOMER W3B2-DUP-CASE W3B2-EXCEEDS W3B2-EXCEEDS-MESSAGE W3B2-M3-NO-C9-AT-ADD W3B2-M3-WINDOW-RAW W3B2-NO-SUMMARY-ROW W3B2-PENDING-ACCUM W3B2-PENDING-MESSAGE W3B2-QTY-SCALE W3B2-REPLAY-IDENTICAL W3B2-REPLAY-NO-DOUBLE W3B2-ROWS W3B2-SHAPE-1 W3B2-SHAPE-10 W3B2-SHAPE-11 W3B2-SHAPE-12 W3B2-SHAPE-13 W3B2-SHAPE-2 W3B2-SHAPE-3 W3B2-SHAPE-4 W3B2-SHAPE-5 W3B2-SHAPE-6 W3B2-SHAPE-7 W3B2-SHAPE-8 W3B2-SHAPE-9 W3B2-SHIP-MISSING W3B2-SHIP-SHIPPED W3B2-SHIP-VOIDED"
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
