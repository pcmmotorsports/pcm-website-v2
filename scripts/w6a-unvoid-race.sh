#!/usr/bin/env bash
#
# W6a · **早期判別力探針**:組① `2×unvoid` 真併發 barrier
#
# 用法:scripts/w6a-unvoid-race.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §2a(W6a 依賴 W0b/W1/W2/W3c/W5,**排在 W4 之前**)+ 主視窗 `B-180-A` ② 裁乙 + R3 A2。
#
# ══ 🔴 本檔要回答的問題(注意它**不是**「證據本身」)═══════════════
#   §2a 逐字:「提前的是『**rig 有沒有判別力**』,不是證據本身」。
#   ⇒ 本檔問的是:**這套併發編排,到底抓不抓得到「取鎖順序退化」這種回歸?**
#     抓得到 ⇒ W6b/W6c 可以拿它當底座繼續堆證據。
#     抓不到 ⇒ **現在就要知道**,而不是等 W6c 堆完才發現整座 rig 是空的。
#
# ══ 🔴 被測的那條不變量 ═════════════════════════════════════════
#   `pcm_a4a_shipments_summary_recompute()`(`…s2b.sql:338-345`)逐字:
#     `SELECT DISTINCT si.order_item_id … ORDER BY si.order_item_id` → 逐個 `recompute(order_item_id)`,
#   而 `pcm_a4a_recompute_order_item_summary()` 會對 parent 取 `FOR NO KEY UPDATE`。
#   ⇒ **兩張含重疊品項的包裹併發動狀態時,若兩邊的迭代序相反 ⇒ 反序取鎖 ⇒ 真 40P01。**
#   該檔 COMMENT 逐字:「迴圈的 ORDER BY si.order_item_id 不是裝飾」。
#
# ══ 🔴🔴 走到能用的編排,中間踩了**四個**坑(全部實跑打臉,逐一記下)═══
#   ① v1 只在「進入 RPC 那一刻」設 barrier ⇒ 迴圈跑太快,兩邊沒重疊過 ⇒ 12 輪零死結。
#   ② v2 把同步點注入迴圈中途 —— 但**突變靶本身是非法 SQL**:`ORDER BY random()` 直接掛在
#      `SELECT DISTINCT` 上會拋「ORDER BY expressions must appear in select list」
#      ⇒ 突變函式**每次呼叫都錯**、什麼都沒跑到,而我的自證只看**定義文字**、看不出它跑不動。
#   ③ 自證升級成「真的觸發一次」之後,又**假設了箱子的狀態**(硬寫死作廢→復原)⇒ 箱子在另一邊時誤判。
#   ④ 中間還有一格假綠:`W6A-ORDERED-NO-DEADLOCK` 原本只看「有沒有 40P01」,
#      而「**兩邊根本沒執行**」也沒有 40P01 ⇒ 已改成「兩邊都真的成功」+「沒死結」兩件都要。
#   ⇒ 結論:**這套 rig 有判別力**(見 `TMUT-LOCK-ORDER`),但它是被上面四個坑逼出來的,
#     不是一次寫對的。後人改這支時,那四道自證一個都不要拿掉。
#
# ══ 🔴 v1 編排為什麼沒有判別力(留著當反例)═══════════════════
#   v1:只在「進入 RPC 那一刻」設 barrier,然後把迭代序打亂、跑滿輪數 —— **一次都沒抓到死結**。
#   原因不是輪數不夠:barrier 一放行,**整個迴圈跑得太快**,一邊往往在另一邊開始之前就跑完了
#   ⇒ 兩交易根本沒有在「各持一把、互相要對方那把」的狀態下重疊過。
#   ⇒ v2 的作法:**把同步點注入迴圈中途** —— 兩邊各自取到**第一把** parent 鎖之後,
#     卡在共享 advisory 上等對方也取到第一把,控制端才放行。這時才有反序死結的可能。
#   🔴 這是**編排**的改動,不是把守門放寬:基準與突變**用同一套注入字面**,唯一的差是**迭代序**。
#     🔴 **但「等長同形」只到字面為止**(跨模型審查):正確序下第二個 session 會卡在**第一把 parent 鎖**上、
#       物理上到不了同步點 ⇒ 基準臂的同步點**必然退化**。那不是瑕疵,那正是被測的性質本身
#       (「有序 ⇒ 搶同一把 ⇒ 序列化」)。歸因仍成立:正確序下反序取鎖被構造性排除,40P01 只能出自序。
#
# ══ 🔴🔴 突變靶為什麼**不能**用「拿掉 ORDER BY」或「改 DESC」═══════
#   · **拿掉 ORDER BY**:plan §2a 已記載實測**翻不了面** —— PG 把 `DISTINCT` 規劃成 Sort+Unique,
#     輸出序等同 ORDER BY。「今天擋住反序取鎖的是 DISTINCT 的排序,不是 ORDER BY 那幾個字」。
#   · **改成 `DESC`**:兩個 session 呼叫的是**同一支函式** ⇒ 兩邊一起 DESC ⇒ 順序仍然一致、不會死結。
#     (這是我開工時差點寫下去的錯靶。)
#   ⇒ 唯一能真正製造反序的突變 = **讓每次呼叫的序都不一樣**:`ORDER BY random()`。
#     它代表的回歸語意是「排序保證沒了」,而不是「換一個固定的序」。
#
# ══ 🔴 編排刻意不用 FIFO(舊 probe 就死在那)═══════════════════════
#   `scripts/b2s1-concurrency-probe.sh`(未追蹤遺留檔)實跑**會卡死**:控制端 psql 讀的 FIFO
#   收不到 EOF(`exec 5>&-` 之後仍有子行程持著寫端)⇒ `wait $PC` 永不返回。
#   ⇒ 本檔:每個 session = **一句** `psql -c "BEGIN; … COMMIT;"` 丟背景、輸出寫檔;
#     barrier 用 `pg_advisory_xact_lock_shared(42)`,控制端持獨佔鎖後自己 `pg_sleep` 再解鎖、**自己會結束**。
#     全程**零 FIFO、零 `wait` 依賴外部 EOF**,所有輪詢都有界。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase**。🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W6ADB:-/tmp/w6adb}"; SOCK="${W6ASOCK:-/tmp/w6ask}"; P="${W6APORT:-54407}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=10   # 🔴 量出來的。全綠時 PASS = 10 + CELL-ACCOUNT + CELL-KEYSET = 12。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-34s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-34s %s\n' "$1" "$2"; }

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1 || { echo INITDB_FAIL; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log"; exit 1; }
die() { echo "$1"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1; }
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }

# 🔴 **第一次重釘(W4-1 落檔)**:本檔與 `w5-line-verify.sh` 是同族(都釘在線的尖端)——
#    W4-1 那次我重釘了 W5、**忘了這一支**,是它自己 die 才發現。
#    ⇒ 新片落檔要**同批重釘兩個檔**;這條與 b2s2b 的釘值屬同一族欠款。
LINE_TIP="20260808000000"
NEWEST_TS="$(ls "$REPO"/supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "$LINE_TIP" ] || die "migration 尾端是 $NEWEST_TS,不是釘住的 $LINE_TIP —— 本檔跑在線的尖端,重釘後再跑。"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*) continue ;; esac
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
ok W6A-REPLAY "全 migration 重放(尖端 $LINE_TIP)⇒ 五支 writer 都在,探針跑在真路徑上 ✓"

# ── fixture ───────────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w6a@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w6a@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W6a 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
# 🔴 instock 要**夠大讓兩箱都復原得了**(各 3 件 ⇒ 6 ≤ 10),否則 M4 前緣會先擋掉第二箱,
#    本檔就變成在測 M4 而不是測取鎖序(fixture 讓被測面不可達的老坑)。
mkitem() { # $1=oi $2=到貨 $3=sku
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$1','$ORD','$3','$PSNAP'::jsonb,20,10,200)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$1',20,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $1): $PID" ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$2,now(),'tester')" >/dev/null
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$1'")"
  [ "$N" = "$2" ] || die "FIXTURE_FAIL(instock $1): 實得 [$N] 期望 [$2]"
}
# 🔴 兩個品項的 id 刻意一小一大 ⇒ 「升序」與「降序」是兩個看得出來的不同序。
OIA='aaaa1111-0000-0000-0000-00000000000a'
OIB='ffff9999-0000-0000-0000-00000000000f'
mkitem "$OIA" 10 SKU-A
mkitem "$OIB" 10 SKU-B

# 🔴 兩箱必須**序列**建(掛→出貨→作廢),因為 W3-2 的 pending 累加守門會擋「兩箱同時 pending」。
mkvoided() { # $1=前綴 → 印 shipment_id(含 OIA+OIB 各 3 件、已出貨、已作廢)
  B="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
  case "$B" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(box %s): %s\n' "$1" "$B" >> "$D/mk.err"; return ;; esac
  R="$(QM "SELECT public.admin_add_shipment_items('$1-i','$B','[{\"order_item_id\":\"$OIA\",\"quantity\":3},{\"order_item_id\":\"$OIB\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(add %s): %s\n' "$1" "$R" >> "$D/mk.err"; return ;; esac
  R="$(QM "SELECT public.admin_mark_shipment_shipped('$1-s','$B','TRACK-$1')" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(ship %s): %s\n' "$1" "$R" >> "$D/mk.err"; return ;; esac
  R="$(QM "SELECT public.admin_void_shipment('$1-v','$B','W6a fixture')" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(void %s): %s\n' "$1" "$R" >> "$D/mk.err"; return ;; esac
  printf '%s' "$B"
}
BOX1="$(mkvoided r1)"; BOX2="$(mkvoided r2)"
case "$BOX1:$BOX2" in
  ????????-*:????????-*) ok W6A-FIXTURE "兩張含**相同兩個品項**的包裹都已「出貨→作廢」(各 3 件、到貨 10)⇒ 兩箱都復原得了(6≤10),被測面是取鎖序不是 M4 ✓" ;;
  *) die "FIXTURE_FAIL: BOX1=[$BOX1] BOX2=[$BOX2] :: $(cat "$D/mk.err" 2>/dev/null | tail -2)" ;;
esac

# ── 併發編排(零 FIFO、全程有界輪詢)──────────────────────────
# 控制端:持獨佔 advisory 42 → 睡 → 解鎖。**它自己會結束**,不靠外部關 FD。
# 兩個 session:各自 `BEGIN; 取 shared 42(卡住); 呼 unvoid; COMMIT;`
#   ⇒ 兩邊都卡在 barrier 上,控制端一解鎖,兩邊**同時**放行進入 RPC。
race_once() { # $1=輪次 → 把兩邊的輸出寫進 $D/a.$1 / $D/b.$1
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(42); SELECT pg_catalog.pg_sleep(1.2); SELECT pg_catalog.pg_advisory_unlock(42);" >"$D/ctl.$1" 2>&1 &
  CTL=$!
  # 等控制端真的拿到鎖(有界)
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=42")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6a_a psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(42); SELECT public.admin_unvoid_shipment('u1-$1','$BOX1'); COMMIT;" >"$D/a.$1" 2>&1 &
  PGAPPNAME=w6a_b psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock_shared(42); SELECT public.admin_unvoid_shipment('u2-$1','$BOX2'); COMMIT;" >"$D/b.$1" 2>&1 &
  # 等兩邊都卡在 barrier 上(= 編排真的成立;沒卡上就不是併發證據)
  BARRIER=0
  for _ in $(seq 1 60); do
    n="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('w6a_a','w6a_b')")"
    [ "$n" = "2" ] && { BARRIER=1; break; }
    sleep 0.05
  done
  wait $CTL 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$BARRIER"
}

echo "══ 1. 基準:取鎖序在場 ⇒ 兩邊都成功、零 40P01 ════════════"
B1="$(race_once base)"
[ "$B1" = "1" ] && ok W6A-BARRIER "兩個 session **都真的卡在 barrier 上**才被放行 ⇒ 這是真併發,不是先後執行 ✓" \
                || bad W6A-BARRIER "barrier 沒成立(兩邊沒同時卡上)⇒ 下面的觀察不是併發證據"
OUTA="$(cat "$D/a.base")"; OUTB="$(cat "$D/b.base")"
# 🔴 判準與 §2 同款(逐邊、要求成功證據)—— 兩格不同款會讓「哪一格比較嚴」變成偶然。
sidewise0() { case "$1" in *40P01*|*deadlock*) printf 'DEADLOCK' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
case "$(sidewise0 "$OUTA"):$(sidewise0 "$OUTB")" in
  DEADLOCK:*|*:DEADLOCK) bad W6A-BASELINE-NO-DEADLOCK "🔴 基準就死結了" ;;
  OK:OK)                 ok  W6A-BASELINE-NO-DEADLOCK "取鎖序在場 ⇒ 兩個 unvoid 併發**逐一都成功、零 40P01** ✓" ;;
  *)                     bad W6A-BASELINE-NO-DEADLOCK "有一邊沒真的跑起來:A=[$(echo "$OUTA"|tr '\n' ' '|cut -c1-70)] B=[$(echo "$OUTB"|tr '\n' ' '|cut -c1-70)]" ;;
esac
SUM="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OIA','$OIB')")"
[ "$SUM" = "${OIA}x6,${OIB}x6" ] \
  && ok W6A-BASELINE-SUM "兩箱都復原後,兩個品項的已出貨數各回到 **6**(3+3)⇒ 併發下的重算沒有互相蓋掉 ✓" \
  || bad W6A-BASELINE-SUM "摘要實得 [$SUM](期望各 6)"

echo "══ 2. 🔴🔴 判別力:rig 抓不抓得到「取鎖序退化」════════════"
# 🔴 注入版重算 trigger:迭代序可參數化,且**取到第一把鎖之後卡在同步點**等對方。
#    基準與突變共用這套注入 ⇒ 唯一的差是 `$1`(迭代序)。
# 🔴 **注入必須自證**:v1 有這道、v2 我弄丟了 —— 沒有它,「抓不到死結」與「突變根本沒套上」
#    共用同一句結論(判準第三句)。這是我在同一份檔案裡把自己的規矩弄丟的一次。
install_probe() { # $1 = ORDER BY 運算式
  Q "CREATE OR REPLACE FUNCTION public.pcm_a4a_shipments_summary_recompute() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS \$m\$
DECLARE r record; i int := 0;
BEGIN
  -- 🔴 ORDER BY random() 直接掛在 SELECT DISTINCT 上是非法 SQL
  --    (🔴 這一行是寫在 bash 雙引號字串裡的 SQL 註解 ⇒ **絕不能有反引號**,
  --     否則 bash 會把它當命令替換。同一個坑本線第五次,前四次都在 ok/bad 的訊息裡。)
  --    (「ORDER BY expressions must appear in select list」)⇒ 首版的突變函式**每次呼叫都錯**,
  --    什麼都沒跑到,而我的自證只看定義文字、看不出它跑不動。⇒ DISTINCT 包成子查詢、外層再排。
  FOR r IN SELECT t.order_item_id FROM (SELECT DISTINCT si.order_item_id FROM public.shipment_items si WHERE si.shipment_id = NEW.id) t ORDER BY $1
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.order_item_id);
    i := i + 1;
    -- 🔴 同步點:第一把鎖到手之後卡住,等控制端放行(兩邊都到齊才繼續拿第二把)
    IF i = 1 THEN PERFORM pg_catalog.pg_advisory_xact_lock_shared(77); END IF;
  END LOOP;
  RETURN NULL;
END \$m\$" >/dev/null
  DEF="$(Q "SELECT (pg_catalog.pg_get_functiondef('public.pcm_a4a_shipments_summary_recompute()'::regprocedure) LIKE '%advisory_xact_lock_shared(77)%')::text")"
  [ "$DEF" = "true" ] || die "PROBE_INSTALL_FAIL(序=$1):注入版沒套上去,後面每一格都不是結論"
  # 🔴🔴 **文字對不等於跑得動**:首版的 `ORDER BY random()` 定義文字完全正確、但每次呼叫都拋
  #    「ORDER BY expressions must appear in select list」⇒ 自證放行、後面全部空轉。
  #    ⇒ 注入之後**真的觸發一次**(拿一個不相干的箱子作廢再復原),跑不動就當場 die。
  # 🔴 自證要**看當下狀態**再決定做哪一動(硬寫死一個方向,箱子剛好在另一邊時就會誤判成「跑不動」——
  #    我已經在這支上連踩兩次同一種:先是靶本身非法 SQL、再是自證假設了狀態)。
  SK="$RANDOM"
  ST="$(Q "SELECT (deleted_at IS NOT NULL)::text FROM public.shipments WHERE id='$BOX1'")"
  if [ "$ST" = "true" ]; then
    SMOKE="$(QM "SELECT public.admin_unvoid_shipment('smokeu-$SK','$BOX1')" | tr '\n' ' ')"
    case "$SMOKE" in *ERROR*) die "PROBE_INSTALL_FAIL(序=$1):注入版在**復原**方向跑不動 ⇒ $SMOKE" ;; esac
    SMOKE="$(QM "SELECT public.admin_void_shipment('smokev-$SK','$BOX1','注入自證')" | tr '\n' ' ')"
  else
    SMOKE="$(QM "SELECT public.admin_void_shipment('smokev-$SK','$BOX1','注入自證')" | tr '\n' ' ')"
    case "$SMOKE" in *ERROR*) die "PROBE_INSTALL_FAIL(序=$1):注入版在**作廢**方向跑不動 ⇒ $SMOKE" ;; esac
    SMOKE="$(QM "SELECT public.admin_unvoid_shipment('smokeu-$SK','$BOX1')" | tr '\n' ' ')"
  fi
  case "$SMOKE" in *ERROR*) die "PROBE_INSTALL_FAIL(序=$1):注入版在第二個方向跑不動 ⇒ $SMOKE" ;; esac
}
# 🔴 race_once 的 barrier(42)換成同步點(77)的編排:控制端持 77 的獨佔鎖,
#    兩邊各自取到第一把 parent 鎖後卡在 77 上,控制端睡完解鎖 ⇒ 兩邊同時去搶第二把。
race2() { # $1=輪次 → 印 "barrier旗標" ;輸出寫 $D/a.$1 / $D/b.$1
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT pg_catalog.pg_advisory_lock(77); SELECT pg_catalog.pg_sleep(1.5); SELECT pg_catalog.pg_advisory_unlock(77);" >"$D/ctl.$1" 2>&1 &
  CTL=$!
  for _ in $(seq 1 40); do
    [ "$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objid=77")" != "0" ] && break
    sleep 0.05
  done
  PGAPPNAME=w6a_a psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT public.admin_unvoid_shipment('x1-$1','$BOX1');" >"$D/a.$1" 2>&1 &
  PGAPPNAME=w6a_b psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA \
    -c "SELECT public.admin_unvoid_shipment('x2-$1','$BOX2');" >"$D/b.$1" 2>&1 &
  SYNC=0
  for _ in $(seq 1 60); do
    n="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND l.objid=77 AND a.application_name IN ('w6a_a','w6a_b')")"
    [ "$n" = "2" ] && { SYNC=1; break; }
    sleep 0.05
  done
  wait $CTL 2>/dev/null || true
  wait 2>/dev/null || true
  printf '%s' "$SYNC"
}
reset_boxes() { # 🔴 不得靜默:重置失敗 ⇒ 後面每一格都不是結論(實測就是這樣被騙的)
  R1="$(QM "SELECT public.admin_void_shipment('z1-$1','$BOX1','重置')" | tr '\n' ' ')"
  R2="$(QM "SELECT public.admin_void_shipment('z2-$1','$BOX2','重置')" | tr '\n' ' ')"
  case "$R1$R2" in *ERROR*) printf '    [重置失敗 %s] A=%s B=%s\n' "$1" "$(echo "$R1"|cut -c1-70)" "$(echo "$R2"|cut -c1-70)" ;; esac
}

# ── ① 基準(正確序 + 同步點):不該死結 ──
reset_boxes b0
install_probe "t.order_item_id"
S1="$(race2 ord)"
OA="$(cat "$D/a.ord")"; OB="$(cat "$D/b.ord")"
# 🔴🔴 **這一格原本是假綠**:它只看「有沒有 40P01」,而「**兩邊根本沒執行**」也沒有 40P01。
#    實測就是這樣被騙的:`reset_boxes` 沒把箱子作廢成功 ⇒ 兩邊紅在「本來就沒有作廢」⇒ 本格照樣綠。
#    ⇒ 判準改成「**兩邊都真的成功復原**」+ 沒有死結,兩件事都要。
# 🔴🔴 **坑⑤(跨模型審查)**:上一版把 `$OA` 與 `$OB` **串起來**再找一個 `idempotent`
#    —— 那是**存在量詞**,不是「兩邊都成功」。一邊成功、另一邊在 psql client 層失敗
#    (輸出是小寫 `psql: error:`、不含大寫 ERROR)⇒ 本格照樣綠,而訊息寫著「兩邊都真的成功」。
#    ⇒ **逐邊各自判**。這是本檔第五次踩「判定式比宣稱寬」。
sidewise() { case "$1" in *40P01*|*deadlock*) printf 'DEADLOCK' ;; *idempotent*) printf 'OK' ;; *) printf 'BAD' ;; esac; }
SA="$(sidewise "$OA")"; SB="$(sidewise "$OB")"
case "$SA:$SB" in
  DEADLOCK:*|*:DEADLOCK) bad W6A-ORDERED-NO-DEADLOCK "🔴 **正確序**下也死結了:A=$SA B=$SB" ;;
  OK:OK)                 ok  W6A-ORDERED-NO-DEADLOCK "正確序 + 迴圈中途同步點 ⇒ **兩邊逐一都真的復原成功、零 40P01**(搶同一把、序列化)✓" ;;
  *)                     bad W6A-ORDERED-NO-DEADLOCK "🔴 有一邊沒真的跑起來(A=$SA B=$SB)⇒ 這不是「沒死結」的結論:A=[$(echo "$OA"|tr '\n' ' '|cut -c1-70)] B=[$(echo "$OB"|tr '\n' ' '|cut -c1-70)]" ;;
esac

# ── ② 突變(亂序 + 同一套同步點):等長同形,唯一的差是序 ──
HIT=0; ROUNDS=0; SYNCOK=0; RAN=0
install_probe "pg_catalog.random()"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  ROUNDS=$i
  reset_boxes "m$i"
  S="$(race2 "m$i")"
  [ "$S" = "1" ] && SYNCOK=1
  OA="$(cat "$D/a.m$i")"; OB="$(cat "$D/b.m$i")"
  case "$OA$OB" in *40P01*|*deadlock*) HIT=1 ;; esac
  # 🔴 同族(跨模型審查):RAN 也曾是單邊量詞 ⇒ 逐邊都 OK 才算「兩邊都執行了」
  [ "$(sidewise "$OA")" != "BAD" ] && [ "$(sidewise "$OB")" != "BAD" ] && RAN=1
  [ "$HIT" = "1" ] && break
  [ "$i" = "1" ] && printf '    [診斷] 第1輪 A=[%s] B=[%s] 同步旗標=%s\n' "$(echo "$OA" | tr '\n' ' ' | cut -c1-90)" "$(echo "$OB" | tr '\n' ' ' | cut -c1-90)" "$S"
done
[ "${RAN:-0}" = "1" ] || bad W6A-MUTANT-RAN "🔴 突變輪裡**沒有任何一輪兩邊真的跑起來**(都紅在前緣)⇒ 下面兩格量的不是併發,是 fixture 沒重置"
[ "${RAN:-0}" = "1" ] && ok W6A-MUTANT-RAN "突變輪至少有一輪兩邊都真的執行了復原 ⇒ 下面兩格量到的是真的併發面 ✓"
[ "$SYNCOK" = "1" ] && ok W6A-SYNC-REACHED "至少有一輪**兩邊都卡在迴圈中途的同步點**上 ⇒ 編排真的把交錯製造出來了(不是先後執行)✓" \
                    || bad W6A-SYNC-REACHED "🔴 沒有任何一輪讓兩邊同時卡在同步點 ⇒ 下面那格量到的不是交錯"
if [ "$HIT" = "1" ]; then
  ok TMUT-LOCK-ORDER "🔴🔴 同一套同步點、只把迭代序打亂 ⇒ 第 $ROUNDS 輪抓到 **40P01 真死結** = 這套編排**對「序不穩定」型的退化有判別力**。
     🔴 **不得讀成更強**(跨模型審查):兩型**真實**回歸本編排抓不到 ——
       ①「拿掉 ORDER BY」在本環境被 Sort+Unique 遮蔽(planner 行為、非 SQL 語意),小表環境永遠構造不出;
       ②「改成另一個固定序」兩邊會一起改、自身一致無死結,危險在**跨路徑**(unvoid × cancel、backfill 升序 vs A8a2 未驗)。
     ⇒ 跨路徑那一格是 W6b/W6c 的事,本檔不冒領。"
else
  bad TMUT-LOCK-ORDER "🔴🔴 注入同步點之後、跑滿 $ROUNDS 輪仍抓不到死結 ⇒ rig 對取鎖序退化仍是盲的。
     v1(只在進入 RPC 時 barrier)已證無效;v2(迴圈中途同步點)也無效的話,
     下一步是換被測面(例如直接對 recompute 函式做兩交易的手動編排),不是加輪數。"
fi
# 🔴🔴 **坑⑥(跨模型審查)**:上一版用「重跑整份 s2b.sql」還原 —— 那是**恆敗**的:
#    該檔有前置指紋閘(重放後 helper 已是四軸 ⇒ P2B10 整檔 ROLLBACK),而且它用的是
#    `CREATE FUNCTION` 不是 `OR REPLACE`(42723)。錯誤被 `>/dev/null 2>&1` 吞掉 ⇒ **靜默沒還原**。
#    今天無害(下一行就拆庫),但本檔明文邀 W6b/W6c 拿它當底座 ——
#    任何人在這行之後加格,量到的都是 `ORDER BY random()` 的突變函式。
#    ⇒ 改成把**真字面**重新裝回去,並**自證**它不再含 random。
install_probe "t.order_item_id"   # 先用注入版的正確序把行為換回「有序」
Q "CREATE OR REPLACE FUNCTION public.pcm_a4a_shipments_summary_recompute() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS \$r\$ DECLARE r record; BEGIN FOR r IN SELECT DISTINCT si.order_item_id FROM public.shipment_items si WHERE si.shipment_id = NEW.id ORDER BY si.order_item_id LOOP PERFORM public.pcm_a4a_recompute_order_item_summary(r.order_item_id); END LOOP; RETURN NULL; END \$r\$" >/dev/null
REST="$(Q "SELECT (pg_catalog.pg_get_functiondef('public.pcm_a4a_shipments_summary_recompute()'::regprocedure) LIKE '%random%')::text")"
[ "$REST" = "false" ] || die "RESTORE_FAIL:重算 trigger 還停在突變版(含 random)⇒ 後面任何格都不是結論"
ok W6A-RESTORED "突變過的重算 trigger 已還原成有序版(自證不再含 random)⇒ W6b/W6c 在本檔之後加格是安全的 ✓"

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
KEYS_FROZEN="TMUT-LOCK-ORDER W6A-BARRIER W6A-BASELINE-NO-DEADLOCK W6A-BASELINE-SUM W6A-FIXTURE W6A-MUTANT-RAN W6A-ORDERED-NO-DEADLOCK W6A-REPLAY W6A-RESTORED W6A-SYNC-REACHED"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-34s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"
echo
echo "════ PASS=$PASS FAIL=$FAIL ════  埠殘留:$(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
[ "$FAIL" -eq 0 ] || exit 1
