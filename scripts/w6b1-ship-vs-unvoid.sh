#!/usr/bin/env bash
#
# W6b-1 · **B2 barrier:`出貨 × unvoid` 併發**(§6a 的第二組)
#
# 用法:scripts/w6b1-ship-vs-unvoid.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §6a 的 B2 列 / §2a(`W6b` 依賴 W6a・W4・W3)
# 編排骨架:照 `scripts/w6a-unvoid-race.sh`(advisory barrier、零 FIFO、全程有界輪詢)
#
# ══ 🔴 W6b 當場再拆(鐵則 4;前例照 W3/W3c/W4)═══════════════════
#   plan 的 W6b 列 = **兩組** barrier(B2 `出貨×unvoid` + B3 `cancel×unvoid`)。
#   兩組的參與者、危險、翻面靶都不同族(一組打 C9、一組打 C6′),各自要自己的 fixture 與突變。
#   ⇒ **W6b-1(本檔)= B2**;**W6b-2 = B3**。縮片界、不縮範圍。
#
# ══ 🔴 B2 危險在哪(§6a 逐字)═══════════════════════════════════
#   A 對品項 X 建箱掛品項並出貨;B 同時 unvoid 另一張也含 X 的包裹
#   ⇒ 兩邊各自的**前緣檢查都過**(READ COMMITTED 下互相看不到對方未提交的寫入),
#     合起來 `shipped > instock` ⇒ 撞 C9(`oiqs_shipped_le_instock`)。
#   ⇒ 要證的不變式有三條(不是一條):
#     ①**恰一個成功**(不是兩個都成功、也不是兩個都被擋)
#     ②輸的那一筆帶的是**人話**(Q8=A 的轉譯),不是 raw `23514`
#     ③收工時 `shipped <= instock` **從未被違反**
#
# ══ 🔴 誠實邊界:哪個守門接住它是**時序決定的**,本檔不預設 ═══════
#   輸的那一筆可能紅在**前緣**(`P2B27`:B 的檢查恰好排在 A 提交之後)
#   也可能紅在 **C9**(`23514` → 轉譯):B 的檢查排在 A 提交之前、到 COMMIT 才撞。
#   🔴 **兩條路都是「拒絕」,不變式一樣成立** ⇒ 本檔的格**只釘不變式,不釘哪條路**。
#      各輪走了哪條路只作**敘述輸出**,不做成格 —— 做成格會變成「量時序」而不是量守門。
#   🔴 因此本檔**不宣稱**「已證明 C9 是併發下的真守門」;若某次跑完 C9 路一次都沒觀察到,
#      那是分佈的事實,不得被讀成「C9 用不到」。分佈逐輪印出來,自己看。
#
# ══ 🔴 為什麼每輪要**各自的 fixture** ═══════════════════════════
#   一輪跑完之後狀態已被寫髒(A 出貨了、或 V 復原了),重置比重建貴且容易重置錯。
#   ⇒ 每輪自建一個新品項 + 兩個新箱子,輪與輪之間零耦合。
#
# ══ 🔴 **申報偏離 §6a 的字面**(跨模型審查 F2)═══════════════════
#   plan §6a 的 B2 列寫的翻面靶是「**拿掉前緣檢查** ⇒ 出現 raw 23514 / **拿掉鎖序** ⇒ 出現 40P01」。
#   本檔**兩個都沒照做**,理由逐條:
#     · 「拿掉前緣 ⇒ raw 23514」的觀察值預測**在 Q8=A 之後就失真了** —— 轉譯層存在,
#       拿掉前緣只會讓它走 C9 路然後**被轉譯成人話**,看不到 raw。要看到 raw 得打轉譯層,不是打前緣。
#     · 「拿掉鎖序 ⇒ 40P01」**沒有東西可拿** —— 本片的兩支 writer 都是 `WHERE id =` 單列,
#       沒有顯式的多列取鎖序可以拆(那是 W6a 打的面,且已證只有 `ORDER BY random()` 能真製造反序)。
#   ⇒ 改打 **C9 本身** 與 **轉譯層本身**:兩者正是本檔三條不變式真正的承重牆。
#   🔴 **這是偏離、不是等價替換** —— §6a 的字面要不要跟著改,**不是我能拍的板**,STOP 列決策題。
#
# ══ 🔴 `HUMAN` 只代表「是人話」,**不代表「引導是對的」**(F3,上游欠款)═══
#   實測 4/4 輪輸的是 unvoid、走 C9 轉譯路,員工看到的是**出貨導向**的引導:
#   「①先作廢這個包裹 ②去採購頁把到貨數量改成正確的 ③再重新開一張包裹出貨」——
#   而那個箱子**本來就是已作廢的**(他正在做的事就是復原它)⇒ 第①步是廢話。
#   🔴 `w3c2` 的**前緣**路正因為這件事特製了對稱訊息;**C9 路繞過了它**
#      (轉譯層只拿得到 sqlstate + conname,沒有呼叫端脈絡)。
#   ⇒ 本檔的 `W6B1-LOSER-HUMAN` 把它記成 HUMAN 放行 = **只證了「不是 raw」**。
#      引導正確性**沒有任何格在守**,而且這條在上游(w3c2/w3c3),不歸本片修。STOP 列為欠款。
#
# ══ 🔴 判準四句(承自 w0b/w1/w2/w3*/w5/w6a)═══════════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase**。🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W6B1DB:-/tmp/w6b1db}"; SOCK="${W6B1SOCK:-/tmp/w6b1sk}"; P="${W6B1PORT:-54421}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=9   # 🔴 量出來的。全綠時 PASS = 9 + CELL-ACCOUNT + CELL-KEYSET = 11。
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

# 🔴 **第四個釘值檔**(b2s2b / w5 / w6a / 本檔)—— 新片落檔要**同批重釘四個**。
#    機制承接仍在 backlog;在那之前這行是人工紀律,而人工紀律已經漏過一次(W4-1 漏了 w6a)。
# 🔴 重釘(2026-08-09 W7d-3 落檔 `20260809030000`):該片是 **assert-only** ——
#    逐條核過 `CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE` **全部零命中**,
#    只有一個 DO block 與一個 `COMMENT ON FUNCTION`。⇒ **結構 oracle 無需增列**
#    (閘要求的第二步在本片是 no-op,但這是查出來的、不是跳過的)。
#    `COMMENT` 不進 `pg_get_functiondef` ⇒ 任何函式體 md5 釘值也不受影響。
# RE-PIN 2026-08-09 pm: lifecycle L2 20260809140000 = payment retry RPC CREATE OR REPLACE
#    (mark_attempt_settle_retry / mark_webhook_retry, allowlist + 'record_not_found' only).
#    Non-shipping functions; grep recompute|order_item_qty|oiqs = 0 hits => shipping oracles
#    unchanged, no md5 re-measure needed. Main-window re-pin + full re-record.
# RE-PIN 2026-08-09 evening: lifecycle L3 20260809160000/170000 = new fn pcm_cron.expire_unpaid_orders
#    (writes orders.cancelled_at only) + pg_cron schedule. No shipping tables/functions touched;
#    grep recompute|order_item_qty|oiqs|shipment = comment-only hit => shipping oracles unchanged.
#    Main-window re-pin + full re-record.
LINE_TIP="20260809190000"
NEWEST_TS="$(ls "$REPO"/supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "$LINE_TIP" ] || die "migration 尾端是 $NEWEST_TS,不是釘住的 $LINE_TIP —— 本檔跑在線的尖端,重釘後再跑。"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac  # skip pg_cron-dependent: settle sweeper + L3b schedule (bare PG has no pg_cron; L3a fn still replayed)
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regprocedure('public.admin_unvoid_shipment(text,uuid)') IS NOT NULL AND pg_catalog.to_regprocedure('public.admin_mark_shipment_shipped(text,uuid,text)') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: W3-3 出貨或 W3c-2 復原不在"
ok W6B1-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 出貨與復原兩支 writer 都在,探針跑在真路徑上 ✓"

# ── 共用 fixture(客戶 / 訂單 / 供應商)────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w6b1@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w6b1@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W6b-1 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac

# 🔴 `mkround` 建一輪的三件:品項 X(到貨恰 3)、**已作廢**的箱 V(曾出貨 3)、**草稿**箱 A(掛 3)。
#    到貨刻意**恰好等於一箱的量** ⇒ 兩邊各自的前緣都過得了、合起來一定超過 ⇒ 危險面可達。
#    (fixture 值讓被測面不可達,是本線一路踩過的老坑;這裡逐字寫出為什麼是 3。)
# 🔴 錯誤不用 `die` —— `mkround` 是在 `$( )` 裡被呼叫的,`die` 的 exit 只會結束子 shell、
#    而它已經把 server 關掉 ⇒ 之後每一格都在對死連線發問、回空字串被讀成「沒有例外」。
#    ⇒ 錯誤寫進 `$D/mk.err`,呼叫端驗形狀。(w6a 實錘過的坑。)
mkround() { # $1=輪次代號 → 印 "OI|BOXV|BOXA"
  local n="$1" oi pid rc b v
  oi="$(Q "SELECT pg_catalog.gen_random_uuid()")"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$oi','$ORD','SKU-$n','$PSNAP'::jsonb,20,10,200)" >/dev/null
  pid="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$oi',20,'$SUPP') RETURNING id")"
  case "$pid" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(procurement %s): %s\n' "$n" "$pid" >>"$D/mk.err"; return ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$pid',3,now(),'tester')" >/dev/null
  rc="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$oi'")"
  [ "$rc" = "3" ] || { printf 'FIXTURE_FAIL(instock %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return; }
  # 箱 V:掛 3 → 出貨 → 作廢(作廢後 shipped 退回 0、instock 仍 3)
  v="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$n-v','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  case "$v" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(boxV %s): %s\n' "$n" "$v" >>"$D/mk.err"; return ;; esac
  for stmt in "admin_add_shipment_items('$n-vi','$v','[{\"order_item_id\":\"$oi\",\"quantity\":3}]'::jsonb)" \
              "admin_mark_shipment_shipped('$n-vs','$v','TRACK-$n')" \
              "admin_void_shipment('$n-vv','$v','W6b-1 fixture')"; do
    rc="$(QM "SELECT public.$stmt" | tr '\n' ' ')"
    case "$rc" in *ERROR*) printf 'FIXTURE_FAIL(V %s / %s): %s\n' "$n" "${stmt%%(*}" "$rc" >>"$D/mk.err"; return ;; esac
  done
  # 箱 A:草稿、掛 3(此刻 avail = instock 3 - shipped 0 - pending 0 = 3 ⇒ 前緣過得了)
  b="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$n-a','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  case "$b" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(boxA %s): %s\n' "$n" "$b" >>"$D/mk.err"; return ;; esac
  rc="$(QM "SELECT public.admin_add_shipment_items('$n-ai','$b','[{\"order_item_id\":\"$oi\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
  case "$rc" in *ERROR*) printf 'FIXTURE_FAIL(A add %s): %s\n' "$n" "$rc" >>"$D/mk.err"; return ;; esac
  printf '%s|%s|%s' "$oi" "$v" "$b"
}

# ── 併發編排(骨架照 w6a:advisory barrier、零 FIFO、有界輪詢)──
race() { # $1=輪次 $2=boxV $3=boxA → 印 barrier 是否成立(1/0);輸出寫 $D/ship.$1 / $D/unvoid.$1
  local n="$1" v="$2" a="$3" ctl barrier=0 _ x
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(43); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(43);" >"$D/ctl.$n" 2>&1 &
  ctl=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=43")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6b1_ship psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(43); SELECT public.admin_mark_shipment_shipped('s-$n','$a','TRACK-A-$n'); COMMIT;" >"$D/ship.$n" 2>&1 &
  PGAPPNAME=w6b1_unvoid psql -X -v VERBOSITY=verbose -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(43); SELECT public.admin_unvoid_shipment('u-$n','$v'); COMMIT;" >"$D/unvoid.$n" 2>&1 &
  for _ in $(seq 1 60); do
    x="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w6b1_ship','w6b1_unvoid')")"
    [ "$x" = "2" ] && { barrier=1; break; }
    sleep 0.05
  done
  wait $ctl 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$barrier"
}
# 🔴 逐邊判定(**存在量詞是坑**:把兩邊串起來找一個 `idempotent` = 一邊成功就綠,
#    而訊息寫著「兩邊都…」。w6a 被跨模型審查抓過這一條。)
side() { case "$1" in *ERROR*) printf 'ERR' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
# 🔴 「人話」= 前緣的自訂碼、或轉譯層產出的引導句;**raw 23514 的字面出現就是沒轉譯**。
human() {
  case "$1" in
    *"到貨數量"*|*"先作廢"*|*"包裹"*|*"品項"*|*"系統忙碌"*) printf 'HUMAN' ;;
    *23514*|*oiqs_*|*"violates check constraint"*) printf 'RAW' ;;
    *) printf 'OTHER' ;;
  esac
}

echo "══ 0. 對照組:**不併發**時前緣自己擋得住 ══════════════════"
# 🔴 這一格不是裝飾:它證「不是本來就擋不住」——序列時前緣看得到對方,直接拒絕。
#    沒有它,下面併發的「恰一個成功」可能只是因為這條路怎樣都只過一個。
R0="$(mkround seq)"
case "$R0" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(seq): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
OI0="${R0%%|*}"; REST="${R0#*|}"; V0="${REST%%|*}"; A0="${REST#*|}"
S0="$(QM "SELECT public.admin_mark_shipment_shipped('seq-s','$A0','TRACK-SEQ')" | tr '\n' ' ')"
C0="$(cap "public.admin_unvoid_shipment('seq-u','$V0')")"
case "$(side "$S0"):$C0" in
  OK:P2B27*) ok W6B1-SEQ-FRONTEDGE "序列時:先出貨成功、後 unvoid 被**前緣**擋下(P2B27)⇒ 這條路不是「怎樣都只過一個」✓" ;;
  *)         bad W6B1-SEQ-FRONTEDGE "序列對照沒成立:ship=[$(side "$S0")] unvoid=[$C0]" ;;
esac
SUM0="$(Q "SELECT shipped_quantity::text||'/'||instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI0'")"
[ "$SUM0" = "3/3" ] && ok W6B1-SEQ-SUM "序列後 shipped/instock = 3/3(沒有超賣)✓" || bad W6B1-SEQ-SUM "實得 [$SUM0]"

echo "══ 1. 🔴🔴 B2 併發:出貨 × unvoid,同一個品項 ══════════════"
ROUNDS=4
BARRIER_BAD=""; BOTH_OK=""; BOTH_ERR=""; NOT_HUMAN=""; OVER=""; PATHS=""
for i in $(seq 1 $ROUNDS); do
  R="$(mkround r$i)"
  case "$R" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(r$i): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  OI="${R%%|*}"; REST="${R#*|}"; V="${REST%%|*}"; A="${REST#*|}"
  B="$(race "r$i" "$V" "$A")"
  [ "$B" = "1" ] || BARRIER_BAD="$BARRIER_BAD r$i"
  OS="$(cat "$D/ship.r$i" | tr '\n' ' ')"; OU="$(cat "$D/unvoid.r$i" | tr '\n' ' ')"
  SS="$(side "$OS")"; SU="$(side "$OU")"
  case "$SS:$SU" in
    OK:OK)   BOTH_OK="$BOTH_OK r$i" ;;
    ERR:ERR) BOTH_ERR="$BOTH_ERR r$i" ;;
    OK:ERR)  [ "$(human "$OU")" = "HUMAN" ] || NOT_HUMAN="$NOT_HUMAN r$i(unvoid:$(human "$OU"))" ;;
    ERR:OK)  [ "$(human "$OS")" = "HUMAN" ] || NOT_HUMAN="$NOT_HUMAN r$i(ship:$(human "$OS"))" ;;
    *)       BOTH_ERR="$BOTH_ERR r$i(判不出:$SS/$SU)" ;;
  esac
  SUM="$(Q "SELECT (shipped_quantity > instock_quantity)::text||':'||shipped_quantity::text||'/'||instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI'")"
  case "$SUM" in true:*) OVER="$OVER r$i($SUM)" ;; esac
  # 🔴 只是敘述,不做成格:哪個守門接住它是**時序決定的**,做成格就變成在量時序。
  # 🔴🔴 **本線第三次踩同一個坑**:`psql` 預設**不印 SQLSTATE / CONSTRAINT NAME**
  #    ⇒ 第一版拿 `*23514*|*P2B29*` 當判準,四輪全部落到 `?` 的 fail-open 預設值,
  #      而我差點把那個預設值當成「四輪都走 C9」寫進 STOP。
  #    ⇒ 兩個 racing session 一律加 `-v VERBOSITY=verbose`,SQLSTATE 與 conname 才會出現在輸出裡。
  #    🔴 敘述也要 fail-closed:落不進兩條已知路徑就印 `?`,不猜。
  case "$OS$OU" in
    *pcm_b2_w3c2_unvoid_exceeds_instock*|*P2B27*) PATHS="$PATHS r$i:前緣" ;;
    *pcm_b2_w3c2_translated*|*P2B29*|*23514*)     PATHS="$PATHS r$i:C9轉譯" ;;
    *)                                            PATHS="$PATHS r$i:?" ;;
  esac
done
printf '  ——  各輪走的拒絕路徑(敘述、非判定):%s\n' "$PATHS"
[ -z "$BARRIER_BAD" ] && ok W6B1-BARRIER "$ROUNDS 輪**每一輪**兩個 session 都真的卡在 barrier 上才被放行 ⇒ **同時起跑**成立(🔴 本格只證這件事,**不證**兩邊在 RPC 內重疊到危險區 —— 那由 TMUT-W6B1-C9 的 6/3 間接證)✓" \
                      || bad W6B1-BARRIER "barrier 沒成立的輪次:$BARRIER_BAD ⇒ 那些輪的觀察不是併發證據"
[ -z "$BOTH_OK" ] && [ -z "$BOTH_ERR" ] \
  && ok W6B1-EXACTLY-ONE "🔴 每一輪都**恰一個成功**(不是兩個都過、也不是兩個都被擋)✓" \
  || bad W6B1-EXACTLY-ONE "兩邊都成功:[$BOTH_OK] / 兩邊都失敗或判不出:[$BOTH_ERR]"
[ -z "$NOT_HUMAN" ] \
  && ok W6B1-LOSER-HUMAN "🔴 每一輪輸的那一筆帶的都是**人話**(前緣自訂碼或轉譯層的引導句),不是 raw 23514 ✓" \
  || bad W6B1-LOSER-HUMAN "有輪次的失敗訊息不是人話:$NOT_HUMAN"
[ -z "$OVER" ] \
  && ok W6B1-NEVER-OVERSOLD "🔴 每一輪收工時 shipped <= instock —— C9 這條不變式**從未被違反** ✓" \
  || bad W6B1-NEVER-OVERSOLD "有輪次超賣了:$OVER"

echo "══ 2. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 不變式族:把 C9 拿掉 ⇒「恰一個成功」與「從未超賣」兩格都必須翻面。
#    🔴 拿掉的是 **C9 一條**,不是整組守門 —— 消融要等長同形,拆到看不出是誰的功勞就沒有歸屬。
# 🔴 **兩發靶都要有界重試**(跨模型審查 F1/F5):某一輪「不走運序列化」不是被測物的性質,
#    但**不得因此自判不適用、也不得因此假 FAIL** —— 前者是逃生口(靶沒生效卻收綠)、後者是抖動。
#    ⇒ 最多試 3 輪;3 輪都沒構造出來就**明說「靶未觸發」並判 FAIL**,不裝作驗過了。
Q "ALTER TABLE public.order_item_quantity_summary DROP CONSTRAINT oiqs_shipped_le_instock" >/dev/null
MHIT=""; OIM=""; AM=""
for t in 1 2 3; do
  RM="$(mkround mut1$t)"
  case "$RM" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(mut1$t): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  OIM="${RM%%|*}"; REST="${RM#*|}"; VM="${REST%%|*}"; AM="${REST#*|}"
  race "mut1$t" "$VM" "$AM" >/dev/null
  MS="$(side "$(cat "$D/ship.mut1$t" | tr '\n' ' ')")"; MU="$(side "$(cat "$D/unvoid.mut1$t" | tr '\n' ' ')")"
  MSUM="$(Q "SELECT shipped_quantity::text||'/'||instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OIM'")"
  case "$MS:$MU:$MSUM" in OK:OK:6/3) MHIT="$t"; break ;; esac
done
[ -n "$MHIT" ] \
  && ok TMUT-W6B1-C9 "🔴 拿掉 C9 ⇒ **兩邊都成功、shipped 變 6 > instock 3**(第 $MHIT 次構造成功)= 上面兩格真的是 C9 撐著,不是恆真" \
  || bad TMUT-W6B1-C9 "3 輪都構造不出超賣(最後一輪 ship=$MS unvoid=$MU sum=$MSUM)⇒ **本靶未觸發**,上面兩格的判別力這次沒被驗證"
# 🔴 **首跑實錘**:直接 `ADD CONSTRAINT` **還原不了** —— 突變輪留下的 6/3 那一列違反 CHECK,
#    PG 會驗既有列然後拒絕。⇒ 先把突變輪的箱 A **作廢**(走真 RPC、讓重算把 shipped 退回 3),
#    再加回 C9。🔴 用 `NOT VALID` 湊過去是錯的:那會讓既有的壞列永遠留著、而且語意跟原本不同。
RVOID="$(QM "SELECT public.admin_void_shipment('mut1-undo','$AM','還原突變輪')" | tr '\n' ' ')"
case "$RVOID" in *ERROR*) die "MUT_RESTORE_FAIL(void): $RVOID" ;; esac
# 🔴 還原的正確斷言是「**全表**沒有列違反 C9」,不是「這一列剛好是 3/3」——
#    靶沒構造成功的那幾種收場下,這一列本來就不是 3/3,拿 3/3 當斷言會在已經 FAIL 的跑次上再 die 一次。
MBAD="$(Q "SELECT pg_catalog.count(*)::text FROM public.order_item_quantity_summary WHERE shipped_quantity > instock_quantity")"
[ "$MBAD" = "0" ] || die "MUT_RESTORE_FAIL(sum): 仍有 $MBAD 列違反 C9,加不回去"
Q "ALTER TABLE public.order_item_quantity_summary ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity)" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint WHERE conname='oiqs_shipped_le_instock' AND convalidated")" = "1" ] \
  || die "MUT_RESTORE_FAIL: C9 沒還原或沒驗證 ⇒ 後面的格會量到殘廢的 schema"
# ② 人話族:把兩支 writer 的轉譯 handler 都拿掉 ⇒ 輸的那一筆必須露出 raw 23514。
#    🔴 **兩支一起打**:哪一支會輸是時序決定的,只打一支的話「沒翻面」可能只是那支剛好贏了。
# 🔴 **突變本身不得被吞**(F1 附帶):其他路徑都 fail-closed,唯獨這條 `>/dev/null` 會遮掉 CREATE 失敗。
MUTOUT="$(QM "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_human_error(p_sqlstate text, p_conname text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT NULL::text \$m\$" | tr '\n' ' ')"
case "$MUTOUT" in *ERROR*) die "MUT_APPLY_FAIL(translation): $MUTOUT" ;; esac
# 🔴 走前緣路(P2B27)時轉譯層根本沒被呼叫到 ⇒ **不得自判「本靶不適用」記 PASS**(那是逃生口:
#    靶沒生效卻收全綠,而 W6B1-LOSER-HUMAN 的判別力那次從未被消融驗證)。⇒ 有界重試 3 次。
T2HIT=""
for t in 1 2 3; do
  RM2="$(mkround mut2$t)"
  case "$RM2" in *"|"*"|"*) : ;; *) die "FIXTURE_FAIL(mut2$t): $(tail -2 "$D/mk.err" 2>/dev/null)" ;; esac
  REST="${RM2#*|}"; VM2="${REST%%|*}"; AM2="${REST#*|}"
  race "mut2$t" "$VM2" "$AM2" >/dev/null
  M2S="$(cat "$D/ship.mut2$t" | tr '\n' ' ')"; M2U="$(cat "$D/unvoid.mut2$t" | tr '\n' ' ')"
  case "$M2S$M2U" in *P2B27*) continue ;; esac
  case "$(human "$M2S"):$(human "$M2U")" in RAW:*|*:RAW) T2HIT="$t"; break ;; esac
done
[ -n "$T2HIT" ] \
  && ok TMUT-W6B1-TRANSLATION "🔴 把轉譯層打成回 NULL ⇒ 輸的那筆**露出 raw 23514/oiqs_**(第 $T2HIT 次構造成功)= W6B1-LOSER-HUMAN 有判別力" \
  || bad TMUT-W6B1-TRANSLATION "3 輪都沒構造出 C9 路的 raw(最後一輪 ship=[$(human "$M2S")] unvoid=[$(human "$M2U")])⇒ **本靶未觸發**,W6B1-LOSER-HUMAN 的判別力這次沒被驗證"

echo "══ 3. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="TMUT-W6B1-C9 TMUT-W6B1-TRANSLATION W6B1-BARRIER W6B1-EXACTLY-ONE W6B1-LOSER-HUMAN W6B1-NEVER-OVERSOLD W6B1-REPLAY W6B1-SEQ-FRONTEDGE W6B1-SEQ-SUM"
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
