#!/usr/bin/env bash
#
# W4-1 驗收 harness —— 禁批次契約(Q3=A 行為格)+ W0b 兩支 trigger 函式補 REVOKE
#
# 用法:scripts/w4a-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:plan v4.2 §2 W4 列 / §1 **Q3=A** / §0.3 交棒 10
# 被測物:supabase/migrations/20260807220000_m4b_e10_b2_w4a_batch_contract_and_revoke.sql(**實檔,非內嵌副本**)
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
D="${W4ADB:-/tmp/w4adb}"; SOCK="${W4ASOCK:-/tmp/w4ask}"; P="${W4APORT:-54409}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=8   # 🔴 量出來的。全綠時 PASS = 8 + CELL-ACCOUNT + CELL-KEYSET = 10。
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

W4AMIG="${W4AMIG:-$REPO/supabase/migrations/20260807220000_m4b_e10_b2_w4a_batch_contract_and_revoke.sql}"
[ -f "$W4AMIG" ] || die "W4A_MIG_MISSING: $W4AMIG"
# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807220000"

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
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W4AMIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1 ;;
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功" ;;
esac

# ── fixture ───────────────────────────────────────────────────
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w4a@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w4a@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('W4a 供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
OI1='bbbbbbbb-0000-0000-0000-000000000001'
Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI1','$ORD','SKU-1','$PSNAP'::jsonb,20,10,200)" >/dev/null
PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI1',20,'$SUPP') RETURNING id")"
case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement): $PID" ;; esac
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',12,now(),'tester')" >/dev/null
[ "$(Q "SELECT instock_quantity::text FROM public.order_item_quantity_summary WHERE order_item_id='$OI1'")" = "12" ] || die "FIXTURE_FAIL(instock)"
mkbox() { Q "SELECT ('$(Q "SELECT public.admin_create_shipment('$1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')"; }
mkfull() { # $1=前綴 $2=數量 → 印 shipment_id;失敗印空字串、原因寫 $D/mk.err
  B="$(mkbox "$1")"
  case "$B" in ????????-*) : ;; *) printf 'FIXTURE_FAIL(box %s): %s\n' "$1" "$B" >> "$D/mk.err"; return ;; esac
  R="$(QM "SELECT public.admin_add_shipment_items('$1-i','$B','[{\"order_item_id\":\"$OI1\",\"quantity\":$2}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) printf 'FIXTURE_FAIL(add %s): %s\n' "$1" "$R" >> "$D/mk.err"; return ;; esac
  printf '%s' "$B"
}

echo "══ 1. ① W0b 兩支 trigger 函式:REVOKE 之後零 GRANT ════════"
ACLBAD=""
for fn in pcm_b2_shipping_idem_no_purge pcm_b2_shipping_idem_freeze_identity; do
  V="$(Q "SELECT (p.proacl IS NULL)::text||'|'||(SELECT pg_catalog.count(*)::text FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  [ "$V" = "false|0" ] || ACLBAD="$ACLBAD $fn($V)"
done
[ -z "$ACLBAD" ] && ok W4A-REVOKE "W0b 兩支 trigger 函式零非 owner grantee **且 proacl 非 NULL**(NULL = 從沒 REVOKE 過,只數 grantee 對它全盲)✓" \
                 || bad W4A-REVOKE "$ACLBAD"
# 🔴 REVOKE 之後 trigger 還能不能跑 —— 這是我在 migration 註解裡宣稱的事,要量不要推論
BOXR="$(mkfull rv 2)"
case "$BOXR" in ????????-*) : ;; *) die "FIXTURE_FAIL(BOXR): $(tail -1 "$D/mk.err" 2>/dev/null)" ;; esac
C="$(capstmt "DELETE FROM public.pcm_b2_shipping_idempotency WHERE action='create_shipment' AND idempotency_key='rv'")"
[ "$C" = "P0001|pcm_b2_shipping_idem_no_purge" ] \
  && ok W4A-TRIGGER-STILL-FIRES "🔴 REVOKE 之後那兩發 trigger **照常運作**(DELETE 仍被擋)⇒ trigger 執行不看函式的 EXECUTE 權限 —— 這是量的,不是推論的 ✓" \
  || bad W4A-TRIGGER-STILL-FIRES "實得 [$C] ⇒ REVOKE 把 trigger 弄壞了"

echo "══ 2. 🔴 Q3=A 禁批次:**行為格**(不是拿 prosrc 比字串)════"
# 🔴 做法:裝一發 STATEMENT 級 AFTER UPDATE trigger,用 transition table 記下**每一句**改了幾列;
#    跑完五支 RPC 之後看最大值。文字層守門(grep prosrc)對動態 SQL 與別名全盲,行為格不會。
Q "CREATE TABLE public.w4a_rowcounts(n bigint)" >/dev/null
Q "CREATE FUNCTION public.w4a_count_rows() RETURNS trigger LANGUAGE plpgsql AS \$m\$ BEGIN INSERT INTO public.w4a_rowcounts SELECT pg_catalog.count(*) FROM changed; RETURN NULL; END \$m\$" >/dev/null
Q "CREATE TRIGGER w4a_count_stmt AFTER UPDATE ON public.shipments REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION public.w4a_count_rows()" >/dev/null
INSTALLED="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_trigger WHERE tgrelid='public.shipments'::regclass AND tgname='w4a_count_stmt'")"
if [ "$INSTALLED" != "1" ]; then
  bad W4A-NO-BATCH "🔴 本格的**前置**沒成立(計數 trigger 沒裝上)⇒ 這不是禁批次的結論"
  bad TMUT-NO-BATCH "🔴 同上,前置沒成立"
else
  Q "DELETE FROM public.w4a_rowcounts" >/dev/null
  BOXA="$(mkfull b1 3)"; BOXB="$(mkfull b2 3)"
  case "$BOXA:$BOXB" in ????????-*:????????-*) : ;; *) die "FIXTURE_FAIL(BOXA/BOXB): $(tail -1 "$D/mk.err" 2>/dev/null)" ;; esac
  # 🔴🔴 **跨模型審查 F1**:這四支原本走 `Q … >/dev/null 2>&1`、錯誤被吞掉零斷言
  #    ⇒ 任一支靜默失敗(例如 unvoid 被 M4 擋),只要剩下的句子 max=1,本格照樣綠
  #    ⇒ 「**沒跑**」冒充「**沒批次**」。⇒ 逐支斷言回傳、並把語句數釘死。
  RPCBAD=""
  runrpc() { R="$(QM "SELECT $1" | tr '\n' ' ')"; case "$R" in *ERROR*) RPCBAD="$RPCBAD [$2:$(echo "$R"|cut -c1-50)]" ;; esac; }
  runrpc "public.admin_mark_shipment_shipped('sp-a','$BOXA','T-A')" ship-a
  runrpc "public.admin_void_shipment('vd-a','$BOXA','測試')"        void-a
  runrpc "public.admin_unvoid_shipment('uv-a','$BOXA')"             unvoid-a
  runrpc "public.admin_mark_shipment_shipped('sp-b','$BOXB','T-B')" ship-b
  [ -z "$RPCBAD" ] || bad W4A-RPCS-RAN "🔴 有 RPC 沒跑起來:$RPCBAD ⇒ 下面那格量的不是「沒批次」"
  [ -z "$RPCBAD" ] && ok W4A-RPCS-RAN "四支會寫 shipments 的呼叫**逐支都真的成功**(出貨/作廢/復原/出貨)⇒ 下面那格量到的是真的執行過 ✓"
  STMTS="$(Q "SELECT pg_catalog.count(*)::text||'|'||coalesce(pg_catalog.max(n)::text,'(無)') FROM public.w4a_rowcounts")"
  # 🔴 語句數**釘死**(F1):四支各一句 UPDATE shipments ⇒ 恰 4 句。少一句 = 有支沒跑到,不是「沒批次」。
  case "$STMTS" in
    4\|1) ok W4A-NO-BATCH "🔴 四支跑完、**恰 4 句** UPDATE shipments,每句都只改 **1 列** ⇒ Q3=A 的禁批次契約在**語句面**成立 ✓
     🔴 不得讀成更強(跨模型審查 F6):它證的是「每句只改一列」,**不是**「未來不會有 writer 用迴圈逐箱發單列 UPDATE」——
       那種形狀本格照樣綠,而跨箱取鎖序風險會回歸。今天靠五支的簽章都只收單一 uuid 擋著。" ;;
    *\|1) bad W4A-NO-BATCH "🔴 每句都只改 1 列,但語句數是 ${STMTS%%|*}(期望 4)⇒ 有 RPC 沒跑到,這不是「沒批次」的結論" ;;
    *)    bad W4A-NO-BATCH "🔴 有語句改了多列(共 ${STMTS%%|*} 句、最大 ${STMTS##*|})⇒ 契約被違反" ;;
  esac
  # 🔴 突變靶:這格會不會恆真?下一句**故意**改多列,計數器必須看得見
  Q "DELETE FROM public.w4a_rowcounts" >/dev/null
  Q "UPDATE public.shipments SET carrier_note = NULL WHERE customer_user_id='$CUST'" >/dev/null
  M="$(Q "SELECT coalesce(pg_catalog.max(n)::text,'(無)') FROM public.w4a_rowcounts")"
  [ "$M" != "1" ] && [ "$M" != "(無)" ] \
    && ok TMUT-NO-BATCH "🔴 故意下一句多列 UPDATE ⇒ 計數器看到 **$M 列** = 上一格不是恆真、它真的在數 ✓" \
    || bad TMUT-NO-BATCH "多列 UPDATE 之後計數器仍是 [$M] ⇒ W4A-NO-BATCH 恆真"
  # 🔴🔴 **跨模型審查 F2:這一格原本是恆真的。** 它數的是 `carrier_note IS NULL` 的列數,
  #    而三箱的 carrier_note **從建箱起就是 NULL**(非 other 一律寫 NULL)⇒ 那個數字與多列 UPDATE
  #    成敗完全無關;而且它落在 `fi` 之外,計數 trigger 沒裝上時也綠。
  #    ⇒ 改成量**上一句多列 UPDATE 實際影響的列數**(就是 $M),並移進 fi 內。
  [ "$M" != "1" ] && [ "$M" != "(無)" ] \
    && ok W4A-CONTRACT-NOT-GUARD "🔴 那句多列 UPDATE **真的改到 $M 列、DB 沒擋** ⇒ 誠實邊界成立:契約只管應用路徑、DB 層無執行期機制 ✓" \
    || bad W4A-CONTRACT-NOT-GUARD "多列 UPDATE 的影響列數是 [$M] ⇒ 誠實邊界的敘述要改寫"
  Q "DROP TRIGGER w4a_count_stmt ON public.shipments" >/dev/null
fi

echo "══ 3. 🔴 契約字面寫進 catalog(讀 catalog 就看得到)════════"
CBAD=""
for fn in admin_mark_shipment_shipped admin_void_shipment admin_unvoid_shipment; do
  V="$(Q "SELECT (pg_catalog.obj_description(p.oid,'pg_proc') LIKE '%禁批次契約%')::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  [ "$V" = "true" ] || CBAD="$CBAD $fn($V)"
done
[ -z "$CBAD" ] && ok W4A-CONTRACT-IN-CATALOG "**會寫 shipments 的那三支**的 COMMENT 都帶禁批次契約(建箱是 INSERT、掛品項寫 shipment_items ⇒ 不掛,掛了是沒意義的宣告)✓" \
               || bad W4A-CONTRACT-IN-CATALOG "$CBAD"

echo "══ 4. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP]"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="DDL-SYNTAX TMUT-NO-BATCH W4A-CONTRACT-IN-CATALOG W4A-CONTRACT-NOT-GUARD W4A-NO-BATCH W4A-REVOKE W4A-RPCS-RAN W4A-TRIGGER-STILL-FIRES"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-34s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-KEYSET" "格名集合漂了:[$KEYS_NOW]"; FAIL=$((FAIL+1))
fi

pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"
echo
echo "════ PASS=$PASS FAIL=$FAIL ════  埠殘留:$(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
[ "$FAIL" -eq 0 ] || exit 1
