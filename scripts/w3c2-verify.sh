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

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1 || { echo INITDB_FAIL; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log"; exit 1; }
die() { echo "$1"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1; }
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
  case "$f" in *20260723120000*) continue ;; esac
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
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1 ;;
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
#    **腳本照樣往下跑**,但 `die` 裡的 `pg_ctl stop` **已經把伺服器關掉了**
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

pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"
echo
echo "════ PASS=$PASS FAIL=$FAIL ════  埠殘留:$(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
[ "$FAIL" -eq 0 ] || exit 1
