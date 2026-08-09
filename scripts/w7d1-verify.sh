#!/usr/bin/env bash
# ============================================================
# W7d-1 驗證 harness:出貨側三支 writer 的 40P01 有界重試
#                    + 轉譯層補登三條 + unvoid 的 C9 方向覆寫
#
# 被測物 = supabase/migrations/20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql
# plan   = docs/specs/2026-08-08-e10-b2-w7d1-ship-deadlock-and-translator-direction-plan.md(v3)
#
# 🔴🔴 **本檔證的是「重試邏輯本身會迴圈」,不是「真死結會被吸收」。**
#   迭代是用**恆拋 40P01 的注入樁**(BEFORE UPDATE trigger)製造的,不是真併發。
#   真併發演示需要 `add × ship` 的雙 session 編排 = W6 形狀(…w3c3….sql:48 逐字),
#   而既有五支併發 harness(w6a/w6b1/w6b2/w6b3/w7b)**沒有任何一支測這一對** ⇒ 已立欠款,不在本檔。
#   ⇒ 本檔全綠**不得**被讀成「add×ship 的死結已經被證明會自動復原」。
#
# 🔴 **前綴重放**:PREFIX_TS = 被測物自己。只重放 TS <= 被測物 的前綴,被測物是尖端。
#   本檔因此**不對「目錄尾端」有意見**,新增更晚的片不會誤紅;
#   代價=證不了「被測物在更晚的片之上仍成立」(那是那些片自己的 harness 的事)。
#
# 🔴 **NOTICE 是本檔的核心觀察點**:子交易回滾會吃掉迴圈內任何寫入(GUC/temp table 皆然),
#   只有已送出的 NOTICE 撤不回來 ⇒ 迭代數只能這樣量。
#   ⇒ 連線一律顯式 `client_min_messages=notice`(不靠環境預設;R2-nit2)。
#
# 🔴 格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。
# ============================================================
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W7D1DB:-/tmp/w7d1db}"; SOCK="${W7D1SOCK:-/tmp/w7d1sk}"; P="${W7D1PORT:-54402}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=21   # 🔴 實跑量出來的(關卡2 後新增 ROWCOUNT-GATE-LIVE 與 EXHAUST-NO-TRACE 兩格)。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-36s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-36s %s\n' "$1" "$2"; }

# 🔴 **`rm -rf` 前先把路徑釘死在 /tmp**(關卡2 must-fix):`W7D1DB` / `W7D1SOCK` 是環境變數,
#    誤指到 repo 或家目錄時下面那句 `rm -rf` 會直接刪掉它。這道閘沒有成本,不設才是問題。
# 🔴 白名單**與**路徑穿越各擋一次:`/tmp/?*` 單獨用擋不住 `/tmp/../Users/…`
#    (`?` 吃到 `.`、`*` 吃掉其餘)—— 關卡2 R2 抓到。
# 🔴 `/private/tmp` 也要收:macOS 的 `/tmp` 是 `/private/tmp` 的 symlink,
#    而本線有 harness 的預設 datadir 就落在 scratchpad 的 `/private/tmp/...`(w0b:32)
#    ⇒ 只認字面 `/tmp/` 會把合法路徑擋掉。**這道閘是本次掃掠自己踩到的**,已修。
case "$D"    in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: datadir 必須在 /tmp 或 /private/tmp 底下(現為 [$D])"; exit 1 ;; esac
case "$SOCK" in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: socket 目錄必須在 /tmp 或 /private/tmp 底下(現為 [$SOCK])"; exit 1 ;; esac
case "$D"    in *..*) echo "REFUSE: W7D1DB 不得含 .. (現為 [$D])"; exit 1 ;; esac
case "$SOCK" in *..*) echo "REFUSE: W7D1SOCK 不得含 .. (現為 [$SOCK])"; exit 1 ;; esac
case "$D$SOCK" in *[!A-Za-z0-9/._-]*) echo "REFUSE: 路徑只允許 A-Za-z0-9/._- (pgrep -f 會把其餘字元當 regex ⇒ 殘留那道靜默失效)"; exit 1 ;; esac

# 🔴 誰起的誰收(b2s2b teardown 欠款那條教訓,dbc9a1f5)。三個修正都來自關卡2:
#   ① trap **裝在 `pg_ctl start` 之前** —— 原本裝在 start 成功之後,
#      而 `-w start` 可能「postmaster 已經起來、只是等待逾時」就走 START_FAIL 分支 ⇒ 留下孤兒程序。
#   ② `pg_ctl stop` 失敗時**不刪 datadir** —— 否則會變成「postmaster 還活著、資料目錄卻沒了」。
#   ③ 殘留檢查改用 **postmaster.pid + pgrep 綁本 datadir**,不用 TCP 埠 ——
#      本檔的 server 是 `listen_addresses=`(只開 unix socket)⇒ **TCP 永遠是 0**,
#      拿它當「殘留 0」的證據是**零判別力**(關卡2 抓到,原版真的這樣寫)。
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
die() { echo "$1"; exit 1; }

# 🔴 顯式釘死 client_min_messages,否則 NOTICE 計數格的環境前提是隱含的
PSQL_BASE="psql -X -h $SOCK -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -c client_min_messages=notice"
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
# QN:回傳「NOTICE 行 + 錯誤碼」的合併輸出,給重試格數 NOTICE 用
QN() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SET client_min_messages = notice" -c "$1" 2>&1
}
cap() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cap\$ DECLARE c text; n text; BEGIN BEGIN PERFORM $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cap\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}
# capn:同時取回「CAP 結果」與「W7D1-RETRY NOTICE 筆數」
capn() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SET client_min_messages = notice" -c \
    "DO \$cap\$ DECLARE c text; n text; BEGIN BEGIN PERFORM $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cap\$;" 2>&1
}
retries_of() { printf '%s' "$1" | grep -c 'W7D1-RETRY|' | tr -d ' '; }
capcode_of() { printf '%s' "$1" | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'; }

PREFIX_TS="20260808100000"
W7D1MIG="${W7D1MIG:-$REPO/supabase/migrations/20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql}"
[ -f "$W7D1MIG" ] || die "W7D1_MIG_MISSING: $W7D1MIG"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] && continue          # 前綴外的片不套
  [ "$TS" = "$PREFIX_TS" ] && continue            # 被測物留到 DDL-SYNTAX 才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.admin_mark_shipment_shipped(text,uuid,text)') IS NOT NULL
        AND pg_catalog.to_regprocedure('public.admin_void_shipment(text,uuid,text)') IS NOT NULL
        AND pg_catalog.to_regprocedure('public.admin_unvoid_shipment(text,uuid)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: 三支 writer 有缺"

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W7D1MIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功(含檔內 fail-closed 斷言)" ;;
esac

# ── fixture ──────────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
INV='{"type":"personal"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w7d1@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w7d1@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','W7DBCD','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','$INV'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] \
  || die "FIXTURE_FAIL(orders)"
# 🔴 display_id 字母表排除 0/1/A/E/I/L/O/U(20260729010000:78 逐字
#    `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`)—— 隨手取的 6 碼會被 CHECK 擋掉,別亂改上面那個字面。
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac

mkitem() { # $1=order_item_id $2=到貨數量 $3=sku
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$1','$ORD','$3','$PSNAP'::jsonb,10,10,100)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$1',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $1): $PID" ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$2,now(),'tester')" >/dev/null
}
mkbox() { # $1=冪等鍵前綴 → 印 shipment_id
  Q "SELECT (public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct') ->> 'shipment_id')"
}
mkfull() { # $1=鍵前綴 $2=order_item_id $3=數量 → 建箱並掛品項,印 shipment_id
  local b; b="$(mkbox "$1")"
  case "$b" in ????????-*) : ;; *) printf '%s' "$b"; return ;; esac
  Q "SELECT public.admin_add_shipment_items('$1-ai','$b','[{\"order_item_id\":\"$2\",\"quantity\":$3}]'::jsonb)" >/dev/null
  printf '%s' "$b"
}

OI1='bbbbbbbb-0000-0000-0000-000000000001'; mkitem "$OI1" 10 SKU-1

# ── 注入樁:恆拋 40P01 的 BEFORE UPDATE trigger ──────────────
# 🔴 這是**注入**不是真死結。`RAISE … USING ERRCODE='40P01'` 與真死結在 plpgsql handler 眼中
#    同樣是 `deadlock_detected`(條件名以 SQLSTATE 比對)⇒ 足以驅動重試邏輯,
#    但**證不到**真死結情境下的鎖釋放與倖存者行為。誠實邊界見檔頭。
Q "CREATE FUNCTION public.w7d1_fake_deadlock() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RAISE EXCEPTION 'injected fake deadlock' USING ERRCODE='40P01'; END \$t\$" >/dev/null
inject_on()  { Q "CREATE TRIGGER w7d1_fake_dl BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.w7d1_fake_deadlock()" >/dev/null; }
inject_off() { Q "DROP TRIGGER IF EXISTS w7d1_fake_dl ON public.shipments" >/dev/null; }

echo "══ 1. 正向前置:沒有死結時不重試 ══════════════════════════"
# 🔴 這一節是 R1-7 要求的正向前置 —— 沒有它,下面兩節可能量到的是「永遠在重試」。
B1="$(mkfull p1 "$OI1" 2)"; case "$B1" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p1): $B1" ;; esac
O="$(capn "public.admin_mark_shipment_shipped('s1','$B1','TRACK-1')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
if [ "$R" = "0" ] && [ -z "$C" ] && [ "$(Q "SELECT (shipped_at IS NOT NULL)::text FROM public.shipments WHERE id='$B1'")" = "true" ]; then
  ok W7D1-SUCCESS-NO-RETRY-SHIP "無死結 ⇒ NOTICE 0 筆、零錯誤、shipped_at 真的寫進去了 ✓"
else
  bad W7D1-SUCCESS-NO-RETRY-SHIP "NOTICE=$R 錯誤=[$C]"
fi

B2="$(mkfull p2 "$OI1" 1)"; case "$B2" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p2): $B2" ;; esac
O="$(capn "public.admin_void_shipment('v1','$B2','測試作廢')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
if [ "$R" = "0" ] && [ -z "$C" ] && [ "$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$B2'")" = "true" ]; then
  ok W7D1-SUCCESS-NO-RETRY-VOID "無死結 ⇒ NOTICE 0 筆、作廢成功 ✓"
else
  bad W7D1-SUCCESS-NO-RETRY-VOID "NOTICE=$R 錯誤=[$C]"
fi

O="$(capn "public.admin_unvoid_shipment('u1','$B2')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
if [ "$R" = "0" ] && [ -z "$C" ] && [ "$(Q "SELECT (deleted_at IS NULL)::text FROM public.shipments WHERE id='$B2'")" = "true" ]; then
  ok W7D1-SUCCESS-NO-RETRY-UNVOID "無死結 ⇒ NOTICE 0 筆、復原成功 ✓"
else
  bad W7D1-SUCCESS-NO-RETRY-UNVOID "NOTICE=$R 錯誤=[$C]"
fi

echo "══ 2. 🔴 承重格:注入 40P01 ⇒ 真的迴圈 3 次後以 P2B28 收 ══"
inject_on
B3="$(mkfull p3 "$OI1" 1)"; case "$B3" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p3): $B3" ;; esac
O="$(capn "public.admin_mark_shipment_shipped('s3','$B3','TRACK-3')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
[ "$R" = "3" ] && [ "$C" = "P2B28|pcm_b2_w3c3_deadlock_exhausted" ] \
  && ok W7D1-RETRY-ITERATES-SHIP "🔴 注入恆拋 40P01 ⇒ **NOTICE 恰 3 筆**(真的迭代過,不是換句話說)+ 耗盡碼 P2B28 ✓" \
  || bad W7D1-RETRY-ITERATES-SHIP "NOTICE=$R(期望 3)錯誤=[$C](期望 P2B28|pcm_b2_w3c3_deadlock_exhausted)"

B4="$(mkfull p4 "$OI1" 1)"; case "$B4" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p4): $B4" ;; esac
O="$(capn "public.admin_void_shipment('v4','$B4','測試')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
[ "$R" = "3" ] && [ "$C" = "P2B28|pcm_b2_w3c1_deadlock_exhausted" ] \
  && ok W7D1-RETRY-ITERATES-VOID "🔴 注入 ⇒ NOTICE 恰 3 筆 + P2B28 ✓" \
  || bad W7D1-RETRY-ITERATES-VOID "NOTICE=$R 錯誤=[$C]"

# unvoid 需要一個已作廢的箱:注入樁會擋住作廢本身 ⇒ 先關注入、作廢、再開注入
inject_off
B5="$(mkfull p5 "$OI1" 1)"; case "$B5" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p5): $B5" ;; esac
Q "SELECT public.admin_void_shipment('v5','$B5','先作廢好讓復原有對象')" >/dev/null
[ "$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$B5'")" = "true" ] || die "CELL_SETUP_FAIL(B5 沒作廢成功)"
inject_on
O="$(capn "public.admin_unvoid_shipment('u5','$B5')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
[ "$R" = "3" ] && [ "$C" = "P2B28|pcm_b2_w3c2_deadlock_exhausted" ] \
  && ok W7D1-RETRY-ITERATES-UNVOID "🔴 注入 ⇒ NOTICE 恰 3 筆 + P2B28 ✓" \
  || bad W7D1-RETRY-ITERATES-UNVOID "NOTICE=$R 錯誤=[$C]"
inject_off

echo "══ 3. 🔴 突變:拿掉 handler / 改上限 ═══════════════════════"
# 🔴 R1-6 的誠實描述:本節的突變**不是**「每個只紅自己」——
#    拿掉 handler 會同時影響 ITERATES 與 BOUNDED。兩格共用同一注入樁,
#    靠**觀察值不同**(有沒有 NOTICE / NOTICE 幾筆)區分,而不是靠突變互斥。
SHIPDEF="$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_mark_shipment_shipped(text,uuid,text)'::regprocedure))")"

# ① 拿掉 deadlock handler ⇒ 0 筆 NOTICE + 裸 40P01
Q "CREATE OR REPLACE FUNCTION public.admin_mark_shipment_shipped(p_idempotency_key text, p_shipment_id uuid, p_tracking_number text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE n bigint; BEGIN UPDATE public.shipments SET shipped_at=now(), tracking_number=p_tracking_number WHERE id=p_shipment_id AND deleted_at IS NULL AND shipped_at IS NULL; GET DIAGNOSTICS n = ROW_COUNT; RETURN '{}'::jsonb; END \$m\$" >/dev/null
inject_on
B6="$(Q "SELECT (public.admin_create_shipment('p6','$CUST','$SNAP'::jsonb,'hct') ->> 'shipment_id')")"
O="$(capn "public.admin_mark_shipment_shipped('s6','$B6','T6')")"
R="$(retries_of "$O")"; C="$(capcode_of "$O")"
[ "$R" = "0" ] && case "$C" in 40P01*) true ;; *) false ;; esac \
  && ok TMUT-NO-HANDLER "🔴 拿掉 deadlock handler ⇒ **NOTICE 0 筆 + 裸 40P01**(實得 [$C])= ITERATES 那格量的是真的重試,不是字面" \
  || bad TMUT-NO-HANDLER "NOTICE=$R 錯誤=[$C](期望 0 筆 + 裸 40P01)"
inject_off
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W7D1MIG" >/dev/null 2>&1
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_mark_shipment_shipped(text,uuid,text)'::regprocedure))")" = "$SHIPDEF" ] \
  || die "RESTORE_FAIL: 突變 ① 之後實檔沒還原成功"

# ② 上限改 5 ⇒ NOTICE 變 5 筆(證上限那個常數真的承重)
Q "CREATE OR REPLACE FUNCTION public.admin_mark_shipment_shipped(p_idempotency_key text, p_shipment_id uuid, p_tracking_number text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE c_max constant int := 5; v_try int := 0; n bigint; BEGIN LOOP v_try := v_try + 1; BEGIN UPDATE public.shipments SET shipped_at=now() WHERE id=p_shipment_id AND deleted_at IS NULL AND shipped_at IS NULL; GET DIAGNOSTICS n = ROW_COUNT; EXIT; EXCEPTION WHEN deadlock_detected THEN RAISE NOTICE 'W7D1-RETRY|%|%', 'ship', v_try; IF v_try >= c_max THEN RAISE EXCEPTION 'exhausted' USING ERRCODE='P2B28', CONSTRAINT='pcm_b2_w3c3_deadlock_exhausted'; END IF; END; END LOOP; RETURN '{}'::jsonb; END \$m\$" >/dev/null
inject_on
B7="$(Q "SELECT (public.admin_create_shipment('p7','$CUST','$SNAP'::jsonb,'hct') ->> 'shipment_id')")"
O="$(capn "public.admin_mark_shipment_shipped('s7','$B7','T7')")"
R="$(retries_of "$O")"
[ "$R" = "5" ] \
  && ok TMUT-BOUND-IS-LOAD-BEARING "🔴 上限改 5 ⇒ NOTICE 變 **5 筆**(實得 $R)= 「3」那個常數真的決定迭代數,不是裝飾" \
  || bad TMUT-BOUND-IS-LOAD-BEARING "NOTICE=$R(期望 5)"
inject_off
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W7D1MIG" >/dev/null 2>&1
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_mark_shipment_shipped(text,uuid,text)'::regprocedure))")" = "$SHIPDEF" ] \
  || die "RESTORE_FAIL: 突變 ② 之後實檔沒還原成功"

echo "══ 4. 前緣語意 + rowcount 閘 ══════════════════════════════"
B8="$(mkfull p8 "$OI1" 1)"; case "$B8" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p8): $B8" ;; esac
Q "SELECT public.admin_mark_shipment_shipped('s8','$B8','T8')" >/dev/null
C="$(cap "public.admin_mark_shipment_shipped('s8b','$B8','T8')")"
[ "$C" = "P2B26|pcm_b2_w3c3_already_shipped" ] \
  && ok W7D1-FRONT-GUARD-INTACT "重複出貨仍走**前緣**人話(P2B26 already_shipped)⇒ 加了重試迴圈沒有動到前緣語意 ✓(🔴 這一格只證前緣,**證不到 rowcount 閘** —— 那一格在下面)" \
  || bad W7D1-FRONT-GUARD-INTACT "實得 [$C]"

# 🔴 關卡2 must-fix:上面那格走不到 rowcount 閘(第二次呼叫在前緣 already_shipped 就結束)
#    ⇒ 把 migration 的 GET DIAGNOSTICS 與 rowcount RAISE 整條刪掉,整支 harness 照樣綠 = 那條沒人守。
#    真正要構造的是「**前緣過了、UPDATE 卻改到 0 列**」= TOCTOU 面。
#    注入法:BEFORE UPDATE trigger 回 NULL ⇒ 抑制該列 ⇒ ROW_COUNT = 0,而前緣早就讀過、放行了。
Q "CREATE FUNCTION public.w7d1_suppress_row() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$" >/dev/null
B8b="$(mkfull p8b "$OI1" 1)"; case "$B8b" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p8b): $B8b" ;; esac
Q "CREATE TRIGGER w7d1_suppress BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.w7d1_suppress_row()" >/dev/null
C="$(cap "public.admin_mark_shipment_shipped('s8c','$B8b','T8c')")"
SH="$(Q "SELECT (shipped_at IS NULL)::text FROM public.shipments WHERE id='$B8b'")"
[ "$C" = "P2B26|pcm_b2_w3c3_rowcount" ] && [ "$SH" = "true" ] \
  && ok W7D1-ROWCOUNT-GATE-LIVE "🔴 前緣放行、UPDATE 卻改到 0 列(BEFORE trigger 抑制)⇒ **rowcount 閘真的擋下並回 P2B26 rowcount**、shipped_at 仍是空 = 「零列冒充成功」被守住(拿掉那條 RAISE 就會回成功信封)✓" \
  || bad W7D1-ROWCOUNT-GATE-LIVE "實得 [$C](期望 P2B26|pcm_b2_w3c3_rowcount)/ shipped_at 仍空=[$SH]"
Q "DROP TRIGGER IF EXISTS w7d1_suppress ON public.shipments" >/dev/null

# 🔴 關卡2 must-fix:plan 承諾過「耗盡之後不留痕」但 harness 沒有這一格。
#    耗盡(P2B28)是從迴圈往外拋 ⇒ 整個函式呼叫回滾 ⇒ 冪等鍵那一列與 shipped_at 都不該留下任何東西。
B8c="$(mkfull p8c "$OI1" 1)"; case "$B8c" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p8c): $B8c" ;; esac
inject_on
C="$(cap "public.admin_mark_shipment_shipped('s8d','$B8c','T8d')")"
inject_off
IDEMN="$(Q "SELECT pg_catalog.count(*)::text FROM public.pcm_b2_shipping_idempotency WHERE action='ship' AND idempotency_key='s8d'")"
SH="$(Q "SELECT (shipped_at IS NULL)::text FROM public.shipments WHERE id='$B8c'")"
[ "$C" = "P2B28|pcm_b2_w3c3_deadlock_exhausted" ] && [ "$IDEMN" = "0" ] && [ "$SH" = "true" ] \
  && ok W7D1-EXHAUST-NO-TRACE "🔴 重試耗盡回 P2B28,且冪等鍵表 0 列、shipped_at 仍空 ✓(🔴 **判別力誠實界**:後兩個觀察在「錯誤已拋出」的前提下是 **PG 交易語意給的**、不是本片程式碼給的 ⇒ 它們近乎恆真;本格真正承重的是 **P2B28 那個碼**。留著後兩項是為了讓「鍵被消耗掉」這種未來迴歸看得見)" \
  || bad W7D1-EXHAUST-NO-TRACE "錯誤=[$C] 冪等列=[$IDEMN](期望 0)shipped_at 仍空=[$SH]"

echo "══ 5. 轉譯層:三條補登 + 拆分 ═════════════════════════════"
K="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('23514','shipments_shipped_needs_tracking'),'(NULL)')")"
case "$K" in
  *貨運單號*) ok W7D1-TRACKING-TRANSLATED "🔴 補登 23514 shipped_needs_tracking ⇒ **轉譯表對這個碼有人話**(MF-3)✓(🔴 誠實邊界:本格直呼轉譯層、只證映射存在;**證不到**「員工真的不會再看到裸噴」—— 那要 writer 在該路徑上真的撞到它,本片未構造)" ;;
  *) bad W7D1-TRACKING-TRANSLATED "實得 [$K]" ;;
esac
K="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipment_items_parent_open'),'(NULL)')")"
case "$K" in
  *作廢*) ok W7D1-PARENTOPEN-TRANSLATED "🔴 補登 P0001 parent_open ⇒ **轉譯表對這個碼有人話**(MF-5 / B-224 MF-6)✓(🔴 同上:只證映射,不證端到端;該碼的呼叫端是 w4b 薄 wrapper,本片未動它)" ;;
  *) bad W7D1-PARENTOPEN-TRANSLATED "實得 [$K]" ;;
esac
KW="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipments_write_once'),'(NULL)')")"
KF="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipments_frozen_after_ship'),'(NULL)')")"
# 🔴 關卡2 nit:原本只要求「兩句不同」⇒ write_once 被改成任意錯話、只要與 frozen 不同仍會過。
#    ⇒ 加第三個條件:write_once **自己那句的指紋**也要還在(它對 write_once 是對的,不該被動到)。
if [ "$KW" != "$KF" ] \
   && case "$KW" in *"不要**去作廢它"*) true ;; *) false ;; esac \
   && case "$KF" in *作廢*) case "$KF" in *新的*) true ;; *) false ;; esac ;; *) false ;; esac; then
  ok W7D1-FROZEN-SAYS-VOID-REOPEN "🔴 三件都驗:兩句**不同** + write_once **自己那句沒被動到**(仍說不要去作廢)+ frozen 方向改成「作廢重開」= 與守門自己的訊息(…s1a2….sql:135-136)一致(MF-4)✓"
else
  bad W7D1-FROZEN-SAYS-VOID-REOPEN "write_once=[$KW] frozen=[$KF]"
fi
# 🔴 突變:把兩碼併回同一分支 ⇒ 上一格必須紅
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(p_sqlstate text, p_conname text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT CASE WHEN p_sqlstate='P0001' AND p_conname IN ('shipments_write_once','shipments_frozen_after_ship') THEN '合併回同一句' ELSE NULL END \$m\$" >/dev/null
KW="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipments_write_once'),'(NULL)')")"
KF="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('P0001','shipments_frozen_after_ship'),'(NULL)')")"
[ "$KW" = "$KF" ] \
  && ok TMUT-FROZEN-MERGED "🔴 併回同一分支 ⇒ 兩碼拿到同一句(實得都是「$KF」)= 上一格量的是**拆開了沒有**,不是字面存在" \
  || bad TMUT-FROZEN-MERGED "併回後兩碼仍不同:[$KW] vs [$KF]"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W7D1MIG" >/dev/null 2>&1

echo "══ 6. unvoid 的 C9 方向覆寫 ═══════════════════════════════"
# 🔴 可達性:M4 前緣(P2B27)會先擋掉常態路徑 ⇒ 這裡用**注入**構造 TOCTOU 面:
#    暫時把前緣拿掉、讓 C9 由重算 trigger 在 UPDATE 當下拋出,走到 handler。
OI2='bbbbbbbb-0000-0000-0000-000000000002'; mkitem "$OI2" 5 SKU-2
B9="$(mkfull p9 "$OI2" 5)"; case "$B9" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p9): $B9" ;; esac
Q "SELECT public.admin_mark_shipment_shipped('s9','$B9','T9')" >/dev/null
Q "SELECT public.admin_void_shipment('v9','$B9','作廢以便下修到貨')" >/dev/null
# 到貨下修到 1 ⇒ 復原會讓 shipped(5) > instock(1) ⇒ 撞 C9
Q "DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement p WHERE r.procurement_id=p.id AND p.order_item_id='$OI2'" >/dev/null
PID2="$(Q "SELECT id FROM public.order_item_procurement WHERE order_item_id='$OI2' LIMIT 1")"
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID2',1,now(),'tester')" >/dev/null
# 先確認常態路徑真的被前緣擋住(這一格同時證明覆寫路徑**平常走不到**)
C="$(cap "public.admin_unvoid_shipment('u9','$B9')")"
[ "$C" = "P2B27|pcm_b2_w3c2_unvoid_exceeds_instock" ] \
  && ok W7D1-UNVOID-FRONT-GUARD-FIRST "🔴 常態路徑由 M4 前緣(P2B27)擋下 ⇒ 轉譯層那條**只在 TOCTOU 窗內可達**,誠實邊界成立 ✓" \
  || bad W7D1-UNVOID-FRONT-GUARD-FIRST "實得 [$C](期望 P2B27)"

# 🔴🔴 構造 TOCTOU —— **走實檔函式,不換樁**(關卡2 must-fix)。
#   初版把 admin_unvoid_shipment 換成一支「自己硬寫正確答案」的 stub 才驗訊息 ⇒
#   實檔的覆寫就算失效、只要關鍵字還在,靜態錨與這個行為格**都可能綠**。零判別力。
#   ⇒ 改成:**函式一行不換**,用 BEFORE UPDATE trigger 在「前緣已經讀完、UPDATE 正要生效」的
#     那一瞬間把到貨紀錄刪掉 —— 這正是前緣守門與重算 trigger 之間那個真實的 TOCTOU 窗。
#     前緣讀到 instock=3 放行 → UPDATE → 注入的 trigger 把 receipts 刪光 → AFTER 重算 shipped(3) > instock(0)
#     → C9 由**實檔的 handler** 接住 → 走**實檔的覆寫**。
UNVDEF="$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_unvoid_shipment(text,uuid)'::regprocedure))")"
OI3='bbbbbbbb-0000-0000-0000-000000000003'; mkitem "$OI3" 3 SKU-3
B10="$(mkfull p10 "$OI3" 3)"; case "$B10" in ????????-*) : ;; *) die "FIXTURE_FAIL(mkfull p10): $B10" ;; esac
Q "SELECT public.admin_mark_shipment_shipped('s10','$B10','T10')" >/dev/null
Q "SELECT public.admin_void_shipment('v10','$B10','作廢,等一下復原時製造 TOCTOU')" >/dev/null
Q "CREATE FUNCTION public.w7d1_toctou_drop_receipts() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement pr WHERE r.procurement_id=pr.id AND pr.order_item_id='$OI3'; RETURN NEW; END \$t\$" >/dev/null
Q "CREATE TRIGGER w7d1_toctou BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.w7d1_toctou_drop_receipts()" >/dev/null
MSG="$(Q "DO \$d\$ BEGIN PERFORM public.admin_unvoid_shipment('u10','$B10'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MSG|%', SQLERRM; END \$d\$" 2>&1)"
case "$MSG" in
  *它現在就是作廢狀態*)
    case "$MSG" in
      *到貨數量*) ok W7D1-UNVOID-C9-DIRECTION "🔴 **實檔函式**在真 TOCTOU 面上撞 C9 ⇒ 走到實檔的覆寫、拿到**復原方向**的話(含「不要再去作廢它」+ 指向到貨數量)= B-220-A MF-1 已修 ✓" ;;
      *) bad W7D1-UNVOID-C9-DIRECTION "方向對但補救對象不對(oiqs_shipped_le_instock 該指向到貨數量):[$MSG]" ;;
    esac ;;
  *先作廢這個包裹*) bad W7D1-UNVOID-C9-DIRECTION "🔴 仍教「先作廢這個包裹」= 方向仍然寫反" ;;
  *)                bad W7D1-UNVOID-C9-DIRECTION "實得 [$MSG]" ;;
esac

# 🔴 突變:回到「沒有覆寫」的行為 ⇒ 上一格必須回到共用層的 ship 味字面。
# 🔴 **誠實描述突變體**(關卡2 R2 抓到我原本寫「其餘逐字照實檔」= 字面為假):
#    下面這支 mutant **只保留 UPDATE + 四類 handler**,前緣守門、冪等層、重試迴圈、隔離閘**都砍掉了**
#    ⇒ 它**不是**「實檔 minus 覆寫」的等長同形消融,不符本線「消融等長同形」的判準。
#    判別力仍成立(觀察只依賴「沒有覆寫 ⇒ 拿到共用層的 ship 味字面」,那條路不經過被砍掉的部分),
#    但**證據等級要照這個描述讀**:它證的是「那句話來自覆寫」,不是「實檔的其他部分不影響這句話」。
Q "CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ DECLARE v_msg text; v_state text; v_con text; n bigint; BEGIN BEGIN UPDATE public.shipments SET deleted_at=NULL, void_reason=NULL WHERE id=p_shipment_id AND deleted_at IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; EXCEPTION WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME; v_msg := public.pcm_b2_shipping_human_error(v_state, v_con); IF v_msg IS NULL THEN RAISE; END IF; RAISE EXCEPTION '%', v_msg USING ERRCODE='P2B29', CONSTRAINT='pcm_b2_w3c2_translated'; END; RETURN '{}'::jsonb; END \$m\$" >/dev/null
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) SELECT pr.id,3,now(),'tester' FROM public.order_item_procurement pr WHERE pr.order_item_id='$OI3'" >/dev/null
MSG="$(Q "DO \$d\$ BEGIN PERFORM public.admin_unvoid_shipment('u10b','$B10'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MSG|%', SQLERRM; END \$d\$" 2>&1)"
case "$MSG" in
  *先作廢這個包裹*) ok TMUT-UNVOID-NO-OVERRIDE "🔴 拿掉覆寫那幾行 ⇒ 真的回到共用層的**出貨方向**字面(教已作廢的箱「先作廢」)= 上一格量的是覆寫本身,不是字面存在 ✓" ;;
  *) bad TMUT-UNVOID-NO-OVERRIDE "實得 [$MSG](期望回到「先作廢這個包裹」)" ;;
esac
Q "DROP TRIGGER IF EXISTS w7d1_toctou ON public.shipments" >/dev/null
psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W7D1MIG" >/dev/null 2>&1
[ "$(Q "SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef('public.admin_unvoid_shipment(text,uuid)'::regprocedure))")" = "$UNVDEF" ] \
  || die "RESTORE_FAIL: unvoid 實檔沒還原成功"

echo "══ 7. 共用路徑沒被誤改 + ACL 沿用 ═════════════════════════"
K="$(Q "SELECT coalesce(public.pcm_b2_shipping_human_error('23514','oiqs_shipped_le_instock'),'(NULL)')")"
case "$K" in
  *先作廢這個包裹*) ok W7D1-SHIP-C9-UNCHANGED "🔴 共用轉譯層對 C9 的**出貨方向**字面逐字沒被動到(改 unvoid 時沒誤改共用路徑)✓" ;;
  *) bad W7D1-SHIP-C9-UNCHANGED "實得 [$K]" ;;
esac
# 🔴🔴 **極性**:`proacl IS NULL` = **預設 EXECUTE to PUBLIC** = 壞掉,不是好的(w3c3:252-256 逐字立過)。
#    本檔初版把這格寫成「IS NULL 才算過」—— 那會讓它在函式**對 PUBLIC 全開時恰好變綠**,
#    是往危險方向的假綠。被 migration 檔內的 fail-closed 斷言當場抓到,已更正。
# 🔴 **兩道都要**:aclexplode(NULL) 回零列 ⇒ 只數 grantee 那道在 proacl IS NULL 時**恆過**。
ANULL="$(Q "SELECT (p.proacl IS NULL)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_human_error'")"
AGRANT="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace, pg_catalog.aclexplode(p.proacl) a WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_human_error' AND a.grantee <> p.proowner")"
# 🔴 第三道:owner 本身(關卡2 must-fix)—— 只驗「非 NULL + 零非 owner grantee」時,
#    owner 若漂成別的角色、而 ACL 裡剛好只剩那個新 owner,兩道**都會綠**,但實際上已經換人掌權。
AOWN="$(Q "SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pcm_b2_shipping_human_error'")"
if [ "$ANULL" = "false" ] && [ "$AGRANT" = "0" ] && [ "$AOWN" = "postgres" ]; then
  ok W7D1-TRANSLATOR-ACL "🔴 三道都驗:proacl **非 NULL**(REVOKE 痕跡還在;IS NULL 才是 PUBLIC 全開)+ 非 owner grantee = 0 + owner 仍是 postgres ⇒ 零 GRANT、owner-only,**實測不是推論** ✓"
else
  bad W7D1-TRANSLATOR-ACL "proacl IS NULL=[$ANULL](期望 false)/ 非 owner grantee=[$AGRANT](期望 0)/ owner=[$AOWN](期望 postgres)"
fi

echo "══ 8. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-36s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-36s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-36s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-BOUND-IS-LOAD-BEARING TMUT-FROZEN-MERGED TMUT-NO-HANDLER TMUT-UNVOID-NO-OVERRIDE W7D1-EXHAUST-NO-TRACE W7D1-FRONT-GUARD-INTACT W7D1-FROZEN-SAYS-VOID-REOPEN W7D1-PARENTOPEN-TRANSLATED W7D1-RETRY-ITERATES-SHIP W7D1-RETRY-ITERATES-UNVOID W7D1-RETRY-ITERATES-VOID W7D1-ROWCOUNT-GATE-LIVE W7D1-SHIP-C9-UNCHANGED W7D1-SUCCESS-NO-RETRY-SHIP W7D1-SUCCESS-NO-RETRY-UNVOID W7D1-SUCCESS-NO-RETRY-VOID W7D1-TRACKING-TRANSLATED W7D1-TRANSLATOR-ACL W7D1-UNVOID-C9-DIRECTION W7D1-UNVOID-FRONT-GUARD-FIRST"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-36s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-36s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

echo
# 🔴 這裡**不再印「埠殘留」** —— 本檔的 server 只開 unix socket(`listen_addresses=`),
#    TCP 量到 0 是恆真、零判別力(關卡2 抓到)。真正的殘留檢查在 `teardown`,
#    它在 EXIT 時跑、停完才量、量不到 0 就**保留 datadir 並印警告**。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"
[ "$FAIL" -eq 0 ] || exit 1
