#!/usr/bin/env bash
#
# W4-2 驗收 harness —— body 抽 helper + 23505 接線 + **禁批次機制版(GUC 旗標)**
#
# 用法:scripts/w4b-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W4 列 / §1 **Q3=A** / §0.3 交棒 10
# 被測物:supabase/migrations/20260807230000_m4b_e10_b2_w4b_impl_extract_and_no_batch.sql(**實檔,非內嵌副本**)
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
# ══ 🔴 判別力的誠實帳(跨模型審查 F6 逼出來的,不是我自己盤的)══
#   · **`W4B-FLAG-TXN-LOCAL` 對被測物是恆真格**:它驗的是 PG `SET LOCAL` 的語意,
#     任何「無旗標就擋多列」的實作都會綠;唯一能弄紅它的是 **harness 自己**把 SET LOCAL 寫成 SET。
#     ⇒ 它是**寫給 harness 看的自檢**,不進被測物的判別力帳。留著,但不冒領。
#   · **零靶的兩族**(寫下來,不假裝有):
#       ~~①GUC / break-glass 族~~ **已於 R3 關掉**:`W4B-FLAG-WRONG-VALUE`(值不是 '1' 就照擋)
#         直接釘住 `= '1'` 那個判定式,判定式被鬆成存在性檢查時該格會紅。
#       ②pass-through 族 —— 它**本質上**分不出「handler 的 WHEN 清單窄」與「轉譯表窄」:
#         就算 handler 改成 `WHEN OTHERS`,P2B26 查 human_error 得 NULL ⇒ 裸 RAISE 原封重拋、該格照綠。
#     ⇒ 依本檔判準四句「家族格的靶不得只打一個成員」,這兩族是**零靶**,不是一靶。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W4BDB:-/tmp/w4bdb}"; SOCK="${W4BSOCK:-/tmp/w4bsk}"; P="${W4BPORT:-54411}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=18   # 🔴 量出來的。全綠時 PASS = 18 + CELL-ACCOUNT + CELL-KEYSET = 20。
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

W4BMIG="${W4BMIG:-$REPO/supabase/migrations/20260807230000_m4b_e10_b2_w4b_impl_extract_and_no_batch.sql}"
[ -f "$W4BMIG" ] || die "W4A_MIG_MISSING: $W4BMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807230000"

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

# 🔴🔴 **跨模型審查 F1**:檔頭原本宣稱「harness 有格比對兩者」——**那格當時不存在**。
#    洞的形狀:W 線是未 apply 的 pending 批,有人改 W3-2 的 body 沒改 impl ⇒
#    w3b2-verify 在自己的前綴下測到「改過的版本」照樣綠、尖端真正在跑的是**沒改的 impl**、零 harness 紅。
#    ⇒ 此刻(前綴套完、被測物未套)catalog 裡的 `admin_add_shipment_items` **就是 W3-2 版**,
#      先把它的 `prosrc` 指紋抓下來,等被測物套完再與 impl 逐字比。
W3B2_SRC="$(Q "SELECT pg_catalog.md5(pg_catalog.btrim(p.prosrc, E' \n\t')) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_add_shipment_items'")"
case "$W3B2_SRC" in [0-9a-f][0-9a-f]*) : ;; *) die "W3B2_SRC_FAIL: [$W3B2_SRC]" ;; esac

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W4BMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w4b@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w4b@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W4b 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
OI1='bbbbbbbb-0000-0000-0000-000000000001'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI1','$ORD','SKU-1','$PSNAP'::jsonb,20,10,200)" >/dev/null
PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI1',20,'$SUPP') RETURNING id")"
case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement): $PID" ;; esac
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',12,now(),'tester')" >/dev/null
[ "$(Q "SELECT instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")" = "12" ] || die "FIXTURE_FAIL(instock)"
mkbox() { Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')"; }

echo "══ 1. ① body 抽 helper:薄封裝仍然完整運作 ═══════════════"
IMPL_SRC="$(Q "SELECT pg_catalog.md5(pg_catalog.btrim(p.prosrc, E' \n\t')) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pcm_b2_add_items_impl'")"
# 🔴 **退場觸發(R2 nit-5)**:本格把 impl 綁在 **W3-2 那份 migration 的字面**上。
#    日後有片**合法**改了 impl(那才是正路:body 只剩一份、改 impl)⇒ 本格會紅。
#    🔴 那時的處置是**改成與那片的字面比對、或撤格並在此寫下撤的理由**,
#       **不是**回頭去改已 apply 的歷史 migration 來湊綠。(形狀照本線 ACL_EXEMPT 的自我退場約定。)
[ "$W3B2_SRC" = "$IMPL_SRC" ] \
  && ok W4B-BODY-SAME-AS-W3B2 "🔴 impl 的 body 與 **W3-2 版 admin_add_shipment_items 的 prosrc 逐字相同**(md5 $IMPL_SRC)⇒ 抽取零漏零多;日後有人只改一邊,本格會紅 ✓" \
  || bad W4B-BODY-SAME-AS-W3B2 "🔴 兩份 body 已經漂了:W3-2=[$W3B2_SRC] impl=[$IMPL_SRC] ⇒ 有人只改了一邊"
BOX1="$(mkbox b1)"; case "$BOX1" in ????????-*) : ;; *) die "FIXTURE_FAIL(box1): $BOX1" ;; esac
R="$(QM "SELECT public.admin_add_shipment_items('a1','$BOX1','[{\"order_item_id\":\"$OI1\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
case "$R" in *'"idempotent": false'*) ok W4B-THIN-WRAPPER "薄封裝呼 impl ⇒ 掛品項照常成功、回同一個信封 ✓" ;; *) bad W4B-THIN-WRAPPER "[$R]" ;; esac
# 🔴 前緣的自訂碼(P2B26/P2B27)**不得**被 handler 吞成 P2B29 —— 它們不在 WHEN 清單裡
C="$(cap "public.admin_add_shipment_items('a2','$BOX1','[]'::jsonb)")"
[ "$C" = "P2B26|pcm_b2_w3b2_items_shape" ] && ok W4B-CUSTOM-CODES-PASS-THROUGH "impl 的自訂碼(P2B26)**原封穿過**薄封裝、沒被轉譯吞掉 ✓" || bad W4B-CUSTOM-CODES-PASS-THROUGH "實得 [$C]"
C="$(cap "public.admin_add_shipment_items('a3','$BOX1','[{\"order_item_id\":\"$OI1\",\"quantity\":99}]'::jsonb)")"
[ "$C" = "P2B27|pcm_b2_w3b2_exceeds_instock" ] && ok W4B-FRONTEDGE-INTACT "M4/交棒 1 的前緣(P2B27)在抽 helper 之後仍在 ✓" || bad W4B-FRONTEDGE-INTACT "實得 [$C]"

echo "══ 2. 🔴 ② 23505 接線:同箱補掛終於有人話了 ═══════════════"
# 🔴 這就是 W3-3 當時申報偏離、說「要在 W4 做」的那條。W3-3 的 harness 有一格釘著「今天仍是 raw」,
#    🔴 那格**不會翻面、也不該翻面**:w3c3 是**前綴重放**(到 W3-3 為止),本片的薄封裝不在那一疊
#       ⇒ 在它的前綴下「仍是 raw」永遠是真的。我一度去改它、結果整支紅在 DDL-SYNTAX,已還原並更正那句預測。
#    🔴 **更正那次紅的因果(跨模型審查 F7)**:當時**連 `PREFIX_TS` 也一起動了**(把本片拉進 w3c3 的前綴)
#       ⇒ DDL-SYNTAX 重套 W3-3 時 `CREATE FUNCTION pcm_b2_shipping_human_error` 撞 42723。
#       只改期望值字串的話只會紅在該格,不會紅 DDL-SYNTAX。事故紀錄會被後人當權威讀,因果要寫準。
#    ⇒ 「已接上」的證據 = 本檔這一格 + 線級 w5 的 `LINE-23505-TRANSLATED`(它重放整個目錄)。
#       🔴 那一格是本片同批加進 w5 的 —— **F4 點名前**,w5 對 P2B29 是零覆蓋,那句話當時是半假的。
C="$(cap "public.admin_add_shipment_items('a4','$BOX1','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
[ "$C" = "P2B29|pcm_b2_w4b_translated" ] \
  && ok W4B-23505-TRANSLATED "🔴 同箱補掛的 raw 23505 **終於被轉譯**成 P2B29(裁定 B-197-A ②-2 到此結清)✓" \
  || bad W4B-23505-TRANSLATED "實得 [$C](期望 P2B29|pcm_b2_w4b_translated)"
MSG="$(QM "SELECT public.admin_add_shipment_items('a5','$BOX1','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)" | tr '\n' ' ')"
case "$MSG" in *"已經在這箱裡了"*) ok W4B-23505-MESSAGE "訊息是 W3-3 轉譯層早就寫好的那句人話(不是新發明的調性)✓" ;; *) bad W4B-23505-MESSAGE "[$MSG]" ;; esac
# 🔴 不認得的碼仍要原封拋回(W3-3 立的規矩,薄封裝不得破壞它)
Q "CREATE FUNCTION public.w4b_unknown() RETURNS trigger LANGUAGE plpgsql AS \$m\$ BEGIN RAISE EXCEPTION 'unknown' USING ERRCODE='P0001', CONSTRAINT='w4b_no_such_guard'; END \$m\$" >/dev/null
Q "CREATE TRIGGER w4b_unknown_bi BEFORE INSERT ON public.shipment_items FOR EACH ROW EXECUTE FUNCTION public.w4b_unknown()" >/dev/null
BOX2="$(mkbox b2)"; case "$BOX2" in ????????-*) : ;; *) die "FIXTURE_FAIL(box2)" ;; esac
C="$(cap "public.admin_add_shipment_items('a6','$BOX2','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
[ "$C" = "P0001|w4b_no_such_guard" ] \
  && ok W4B-UNKNOWN-RETHROW "🔴 薄封裝對**不認得的碼**仍原封拋回(不吞成 P2B29)⇒ W3-3 立的規矩沒被破壞 ✓" \
  || bad W4B-UNKNOWN-RETHROW "實得 [$C]"
Q "DROP TRIGGER w4b_unknown_bi ON public.shipment_items" >/dev/null

echo "══ 3. 🔴🔴 ② 禁批次機制版(取代 W4-1 的 harness 版)════════"
BOX3="$(mkbox b3)"; BOX4="$(mkbox b4)"
case "$BOX3:$BOX4" in ????????-*:????????-*) : ;; *) die "FIXTURE_FAIL(box3/4)" ;; esac
C="$(capstmt "UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'")"
[ "$C" = "P2B30|pcm_b2_shipments_no_batch_update" ] \
  && ok W4B-NO-BATCH-BLOCKED "🔴🔴 多列 UPDATE shipments **被 DB 擋住了**(P2B30)⇒ W4-1 的「DB 層沒有執行期機制」那句**不再成立**,已改機制版 ✓" \
  || bad W4B-NO-BATCH-BLOCKED "實得 [$C](期望 P2B30)"
# 🔴 單列照常(不是「什麼都擋」的恆真閘)
C="$(capstmt "UPDATE public.shipments SET carrier_note = NULL WHERE id='$BOX3'")"
[ -z "$C" ] && ok W4B-SINGLE-ROW-OK "單列 UPDATE 照常放行 ⇒ 上一格不是「什麼都擋」✓" || bad W4B-SINGLE-ROW-OK "單列被誤擋:[$C]"
# 🔴 break-glass:GUC 旗標放行(這是機制版能成立的關鍵 —— 沒有它就是把災難日的手綁起來)
OUT2="$(QM "BEGIN; SET LOCAL pcm_b2.batch_shipments = '1'; UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'; COMMIT;" | tr '\n' ' ')"
case "$OUT2" in
  *ERROR*) bad W4B-BREAKGLASS "🔴 旗標放行失敗:[$OUT2] ⇒ 機制版把 break-glass 綁死了,這正是 W4-1 擔心的事" ;;
  *)       ok  W4B-BREAKGLASS "🔴 SET LOCAL 旗標之後多列 UPDATE **放行** ⇒ 機制與逃生口兼得(形狀照 A4a 的 GUC 旗標制)✓" ;;
esac
# 🔴 旗標是 **txn-local**:交易結束後不得殘留(A4a 那條 nullif 眉角就是在防這個)
C="$(capstmt "UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'")"
[ "$C" = "P2B30|pcm_b2_shipments_no_batch_update" ] \
  && ok W4B-FLAG-TXN-LOCAL "🔴 上一個交易結束後旗標**沒有殘留**(多列又被擋)⇒ 旗標真的是 txn-local ✓" \
  || bad W4B-FLAG-TXN-LOCAL "實得 [$C] ⇒ 旗標洩漏到後續交易"
# 🔴 **R3 F3:GUC 族原本零靶** —— 沒有任何格在打判定式本身,把它鬆成 `IS NOT NULL` 的話 16 格全綠。
#    ⇒ 補一格:旗標值**不是 '1'** 時必須照擋(這正是 `= '1'` 那個判定式的內容)。
OUT2="$(QM "BEGIN; SET LOCAL pcm_b2.batch_shipments = '0'; UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'; COMMIT;" | tr '\n' ' ')"
# 🔴 **首跑實錘**:`psql` 預設**不印 SQLSTATE** ⇒ 拿 `*P2B30*` 當判準是**恆假**(兩格都紅在「竟然放行了」,
#    而實際上兩次都擋住了)。⇒ 改比那句 RAISE 獨有的字面。判準四句第三條的反面版:
#    「我的判準寫壞了」不得與「守門沒生效」共用同一句結論。
case "$OUT2" in
  *"不得改多列 shipments"*) ok W4B-FLAG-WRONG-VALUE "🔴 旗標值是 '0'(不是 '1')⇒ **照擋** = 判定式真的在比值,不是「有設就放行」✓" ;;
  *)                        bad W4B-FLAG-WRONG-VALUE "旗標值 '0' 竟然放行了:[$OUT2] ⇒ 判定式被鬆成存在性檢查" ;;
esac
# 🔴🔴 **R3 F1 的失敗情境,做成行為格**:`SET LOCAL` **在顯式交易之外是 no-op**(只發 WARNING)。
#    災難日的人在互動式 psql 逐句跑、或 Supabase SQL Editor 逐句執行,就是走這條路 ——
#    他照錯誤訊息設了旗標、UPDATE 仍被擋、訊息又教他做同一件事 = 死循環。
#    🔴 用**多個 -c**(每個各自送出、各自 implicit txn)重現「逐句」;單一 -c 內用分號串會被包成一個 implicit txn、重現不出來。
OUT2="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
  -c "SET LOCAL pcm_b2.batch_shipments = '1'" \
  -c "UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'" 2>&1 | tr '\n' ' ')"
# 🔴 **兩個條件都要**:①PG 真的發了 `SET LOCAL can only be used in transaction blocks`
#    (證明沒生效的是 SET LOCAL 本身、不是別的東西擋住)②UPDATE 真的被擋。缺一就不是這個結論。
case "$OUT2" in
  *"can only be used in transaction blocks"*"不得改多列 shipments"*)
      ok W4B-FLAG-NEEDS-TXN "🔴 逐句(無 BEGIN)下 SET LOCAL 是 no-op(PG 自己發 WARNING)⇒ 多列**仍被擋** = 訊息與 COMMENT 必須逐字寫出 BEGIN/COMMIT,已寫 ✓" ;;
  *)  bad W4B-FLAG-NEEDS-TXN "沒同時觀察到 WARNING 與擋下:[$OUT2]" ;;
esac
# 🔴 ENABLE ALWAYS:replica 模式不得一句繞過(W0b F5 的實測教訓)
# 🔴 訊息裡**不得有反引號**(雙引號內會被 bash 當命令替換)—— 本線第八次,前七次分佈在各片的 ok/bad 與 SQL 註解裡。
OUT2="$(QM "BEGIN; SET LOCAL session_replication_role = 'replica'; UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'; COMMIT;" | tr '\n' ' ')"
case "$OUT2" in
  *P2B30*|*no_batch_update*) ok W4B-ALWAYS-VS-REPLICA "🔴 session_replication_role=replica **繞不過**(仍紅在 P2B30)⇒ ENABLE ALWAYS 真的有掛上 ✓" ;;
  *) bad W4B-ALWAYS-VS-REPLICA "replica 模式繞過了:[$OUT2]" ;;
esac

echo "══ 4. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 禁批次族:把 trigger 降成 ORIGIN ⇒ replica 那格必須翻面
Q "ALTER TABLE public.shipments ENABLE REPLICA TRIGGER shipments_no_batch_update_as" >/dev/null
OUT2="$(QM "BEGIN; SET LOCAL session_replication_role = 'replica'; UPDATE public.shipments SET carrier_note = 'x' WHERE customer_user_id='$CUST'; COMMIT;" | tr '\n' ' ')"
case "$OUT2" in
  *P2B30*) bad TMUT-ALWAYS "降成 REPLICA 之後仍擋 ⇒ ALWAYS 那格量錯東西" ;;
  *)       ok  TMUT-ALWAYS "🔴 把 trigger 降成 REPLICA ⇒ replica 模式**真的繞過去了** = W4B-ALWAYS-VS-REPLICA 有判別力" ;;
esac
Q "ALTER TABLE public.shipments ENABLE ALWAYS TRIGGER shipments_no_batch_update_as" >/dev/null
# ② 薄封裝族:把 handler 拿掉 ⇒ 23505 那格必須翻回 raw
Q "CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN public.pcm_b2_add_items_impl(p_idempotency_key, p_shipment_id, p_items); END \$m\$" >/dev/null
M="$(cap "public.admin_add_shipment_items('a7','$BOX1','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
case "$M" in
  23505*) ok TMUT-HANDLER "🔴 拿掉薄封裝的 handler ⇒ 同箱補掛**又變回 raw 23505**(實得 [$M])= 轉譯接線那族有判別力" ;;
  *)      bad TMUT-HANDLER "拿掉 handler 後實得 [$M] ⇒ 那格守的不是這段" ;;
esac

# ③ body 比對族:證明那個比對器**有解析度** —— 同一支函式的 prosrc 只多一個註解就必須翻面。
#    🔴 這裡刻意**不真的去改 impl**(改了後面沒有格再跑,而且 200 行的替換本身會變成新的漂移源);
#       打的是「判定式對輸入的敏感度」,等長同形。
M="$(Q "SELECT pg_catalog.md5(pg_catalog.btrim(p.prosrc, E' \n\t') || '--x') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pcm_b2_add_items_impl'")"
# 🔴 R2 nit-3:`M` 為空(proname 打錯 / 函式不在)時 `!= $W3B2_SRC` 也成立 ⇒ 本格自己 fail-open。加 32-hex 形狀閘。
case "$M" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;; *) M="" ;; esac
[ -n "$M" ] && [ "$M" != "$IMPL_SRC" ] \
  && ok TMUT-BODY-DRIFT "🔴 impl 的 body 只多三個字元 ⇒ 指紋真的變了 = W4B-BODY-SAME-AS-W3B2 對任何字面漂移都紅" \
  || bad TMUT-BODY-DRIFT "實得 [$M](空 = 本格自己的 SQL 壞了;等於 $IMPL_SRC = 比對格恆真)"

echo "══ 5. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-ALWAYS TMUT-BODY-DRIFT TMUT-HANDLER W4B-23505-MESSAGE W4B-23505-TRANSLATED W4B-ALWAYS-VS-REPLICA W4B-BODY-SAME-AS-W3B2 W4B-BREAKGLASS W4B-CUSTOM-CODES-PASS-THROUGH W4B-FLAG-NEEDS-TXN W4B-FLAG-TXN-LOCAL W4B-FLAG-WRONG-VALUE W4B-FRONTEDGE-INTACT W4B-NO-BATCH-BLOCKED W4B-SINGLE-ROW-OK W4B-THIN-WRAPPER W4B-UNKNOWN-RETHROW"
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
