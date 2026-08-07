#!/usr/bin/env bash
#
# W2 驗收 harness —— 五支出貨 writer RPC 的冪等層(指紋 / 回傳形狀 / 認領 / 重放 / 回填 / 表級守門)
#
# 用法:scripts/w2-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md(v4.2 定稿)§2 W2 列 / §1c 面 1-5 / §1d
# 被測物:supabase/migrations/20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql(**實檔,非內嵌副本**)
#
# 🔴 **本檔 v2 = 對抗審查 R1 修完後的版本**;被打掉的格就地標 `R1-Fn` / `R1-Nn`。
#
# ══ 判準三句(承自 w0b/w1-verify.sh,後人補格照抄)══════════════════
#   🔴 **消融必須由紅轉綠,否則判別力歸屬錯。**
#   🔴 **全綠的消融也可能恆真,隔離守門自己要有靶。**
#   🔴 **「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。**
# ══ 第四句(R1-N4 之後補進來,本檔自訂)═══════════════════════════
#   🔴 **家族格的靶不得只打一個成員** —— 「五格家族用單一成員消融」證的是那一個成員,
#      不是那一族。本檔的 `TMUT-ACL` / `TMUT-WIRED` 因此逐成員打,全部翻面才算。
#
# ══ boolean 寫法 ═══════════════════════════════════════════════
#   🔴 psql `-qtA` 下 `bool::text` 印 `true`/`false`,裸 boolean 印 `t`/`f`。
#      本檔需比對的 boolean **一律顯式 `::text`、期望 true/false**。
#
# ══ 🔴 本檔為什麼要重放**整套 migration** ═════════════════════════
#   W2 的重放路徑要拿 `result_snapshot` 跟**真的 `shipments` 列**比,而快照白名單的權威是
#   `…s1a2.sql` 的 `pcm_b2_shipments_immutable_guard`(R1-F1)⇒ 那些守門必須真的在場。
#   抽一張假表出來比 = 比的是我自己捏的形狀。⇒ 照 `scripts/b2s2b-verify.sh` 的形狀重放全套。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站的最終權限(只有 apply 後在 A 庫驗才消)。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W2DB:-/tmp/w2db}"; SOCK="${W2SOCK:-/tmp/w2sk}"; P="${W2PORT:-54383}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=67   # 🔴 量出來的,不是估的。全綠時 PASS = 67 + CELL-ACCOUNT + CELL-KEYSET = 69。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-34s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-34s %s\n' "$1" "$2"; }

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1 || { echo INITDB_FAIL; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log"; exit 1; }
die() { echo "$1"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1; }
Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }
# 抓 SQLSTATE + CONSTRAINT_NAME(不比訊息子字串 —— W1 的 F2 教訓:比訊息時把碼全改 P0001 仍全綠)
cap() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cap\$ DECLARE c text; n text; BEGIN BEGIN PERFORM $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cap\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}
# 🔴 DEFERRED 的違反只在 **COMMIT** 當下拋 ⇒ 上面的 cap()(單一 DO 區塊)抓不到它。
#    這支跑一個真交易並回報 COMMIT 的結果。
capcommit() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "BEGIN; $1; COMMIT;" 2>&1 | tr '\n' ' '
}
# 🔴 cap() 用 `PERFORM $1`,只吃**運算式**(函式呼叫)。餵 `UPDATE …` 給它會在 plpgsql
#    **編譯期**就爆,`RAISE NOTICE` 根本沒跑到 ⇒ 回空字串,而空字串被讀成「無錯誤 = 沒擋住」。
#    首跑實錘:`W2-SNAPSHOT-BYPASS-BLOCKED` 與 `W2-SNAPSHOTABLE-REALLY-IMMUTABLE` 兩格因此假紅
#    —— 又是判準第三句(「我的 SQL 寫壞了」不得與「守門沒擋住」共用同一句結論)。⇒ 語句用這支。
capstmt() {
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
    "DO \$cs\$ DECLARE c text; n text; BEGIN BEGIN $1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$cs\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}

W2MIG="${W2MIG:-$REPO/supabase/migrations/20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql}"
[ -f "$W2MIG" ] || die "W2_MIG_MISSING: $W2MIG"

# 🔴🔴 **前綴重放(取代原本的 NEWEST_TS 尾端閘)。**
#    原本的做法是「先套所有不是被測物的 migration、最後才套被測物」——
#    那在**被測物之後又多了片**的當天就會出錯:更晚的片會先被套、再被被測物覆蓋回舊版,
#    而本檔照樣全綠(測的是一個現實中不存在的狀態)。W3-1 落檔當天這道閘真的響了。
#    ⇒ 處置照該閘 die 訊息的字面:**重排重放順序** —— 只重放 `TS <= 被測物` 的前綴,
#      被測物自然就是尖端。本檔因此**不再對「目錄尾端」有意見**,新增更晚的片不會再誤紅。
#    🔴 代價寫明:本檔**證不了**「被測物在更晚的片之上仍成立」—— 那是那些片自己的 harness 的事。
PREFIX_TS="20260807160000"

# ── 0. 全套 migration 重放(W2 的檔**先不套**,留給 DDL-SYNTAX 格當被測物)──
cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  # 🔴 被測物留到下面才套。**比 basename、不比路徑** —— 迴圈給相對路徑、`$W2MIG` 是絕對路徑,
  #    直接比會永遠不相等 ⇒ W2 被套兩次、DDL-SYNTAX 紅在「already exists」而非真語法問題(首跑實錘)。
  TS="${f##*/}"; TS="${TS%%_*}"   # 🔴 原本誤寫成 %%%%_*(永不匹配)⇒ TS=完整檔名,下面的 `=` 分支是死的、被測物是靠字典序**碰巧**被排除。Fable 用 od 驗位元組抓到。
  [ "$TS" \> "$PREFIX_TS" ] && continue          # 前綴外的片不套
  [ "$TS" = "$PREFIX_TS" ] && continue            # 被測物留到 DDL-SYNTAX 才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
# 🔴 上游若沒進來,底下每格會紅在莫名其妙的地方,而「上游沒到位」與「W2 真的壞了」症狀不可分 ⇒ 先分開。
[ "$(Q "SELECT (pg_catalog.to_regclass('public.pcm_b2_shipping_idempotency') IS NOT NULL AND pg_catalog.to_regclass('public.shipments') IS NOT NULL AND pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_freeze_identity()') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: W0b 的鍵表 / s1a1 的 shipments / W0b 的 freeze_identity 有缺"

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W2MIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1 ;;
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功(5 helper + 表級守門 + 5 支 REPLACE + 檔內斷言)" ;;
esac

HELPERS="pcm_b2_shipping_idem_payload_hash pcm_b2_shipping_idem_response pcm_b2_shipping_idem_claim pcm_b2_shipping_idem_record pcm_b2_shipping_idem_require_complete pcm_b2_shipping_idem_bad_snapshot_cols pcm_b2_shipping_idem_insert_guard"
FIVE="admin_create_shipment admin_add_shipment_items admin_mark_shipment_shipped admin_void_shipment admin_unvoid_shipment"

# ── fixture(最小可用:auth.users → customers → shipments,**draft 態**)──
SHIP='22222222-2222-2222-2222-222222222222'
CUST='11111111-1111-1111-1111-111111111111'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w2@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w2@test.local')" >/dev/null
FIX="$(Q "INSERT INTO public.shipments(id,shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES('$SHIP','4TFBFH','$CUST','{\"name\":\"A\",\"phone\":\"0900\",\"line\":\"L\"}'::jsonb,'hct') RETURNING id")"
[ "$FIX" = "$SHIP" ] || die "FIXTURE_FAIL: 種不出 shipments 列($FIX)"
# 🔴 fixture 刻意留在 **draft 態**(shipped_at / deleted_at 皆 NULL):
#    R1-F1 的整條論證(carrier_code 等三欄在 draft 態可改)只有在 draft 態才構造得出負測。
#    改成已出貨的列 ⇒ `W2-SNAPSHOTABLE-REALLY-IMMUTABLE` 會因為「反正都被凍」而恆綠
#    (memory `feedback_fixture-value-makes-guard-vacuous`)。
HASH_UNVOID="$(Q "SELECT public.pcm_b2_shipping_idem_payload_hash('unvoid', pg_catalog.jsonb_build_object('shipment_id','$SHIP'::uuid))")"
case "$HASH_UNVOID" in
  [0-9a-f]*) [ "${#HASH_UNVOID}" = "64" ] || die "HASH_SHAPE_FAIL: 長度 ${#HASH_UNVOID}" ;;
  *) die "HASH_SHAPE_FAIL: [$HASH_UNVOID]" ;;
esac
DEFTRG="pcm_b2_shipping_idem_require_complete"
# 🔴 種鍵列必須繞過那發 DEFERRED 閘(它正確地不准 commit 出 shipment_id 仍 NULL 的列)。
#    只在種資料時關、種完立刻開;**閘自身的判別力由 `W2-DEFERRED-COMPLETE` 與 `TMUT-DEFERRED` 兩格證**,
#    不是靠「我沒關過它」。
INSTRG="pcm_b2_shipping_idem_block_bad_snapshot_insert"
plant() { # $1=action $2=key $3=hash $4=shipment_id(或 NULL) $5=snapshot
  Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER $DEFTRG" >/dev/null
  Q "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,shipment_id,result_snapshot) VALUES('$1','$2','$3',$4,'$5'::jsonb)"
  Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER $DEFTRG" >/dev/null
}
# 🔴 種下去的鍵列**刪不掉**(W0b 的 no_purge trigger)⇒ 每格用自己的鍵,不共用、不清理。

echo "══ 1. 五支 helper:存在 / 屬性 / 零 GRANT ═══════════════════"
FN_SET="$(Q "SELECT pg_catalog.string_agg(p.proname,',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\_b2\_shipping\_idem\_%'")"
EXP_HELPERS="pcm_b2_shipping_idem_bad_snapshot_cols,pcm_b2_shipping_idem_claim,pcm_b2_shipping_idem_freeze_identity,pcm_b2_shipping_idem_insert_guard,pcm_b2_shipping_idem_no_purge,pcm_b2_shipping_idem_payload_hash,pcm_b2_shipping_idem_record,pcm_b2_shipping_idem_require_complete,pcm_b2_shipping_idem_response"
# 🔴 期望集合含 W0b 的兩支 trigger 函式 —— 同族同前綴,不列進來會被讀成「多出來的」;
#    列進來的好處:W0b 的守門函式被誰刪掉,本格也紅(兩片共用同一個凍結面)。
[ "$FN_SET" = "$EXP_HELPERS" ] && ok W2-FN-SET "冪等族函式集合恰為 9 支(W2 七支 + W0b 兩支)✓" \
                              || bad W2-FN-SET "集合 [$FN_SET] != 期望 [$EXP_HELPERS]"
for fn in $HELPERS; do
  V="$(Q "SELECT prosecdef::text||'|'||pg_catalog.array_to_string(proconfig,',')||'|'||provolatile::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  case "$fn" in
    pcm_b2_shipping_idem_payload_hash|pcm_b2_shipping_idem_response) E='false|search_path=""|i' ;;
    # 🔴 STABLE 不是 VOLATILE:它讀 catalog(shipments 的欄名)⇒ 同交易內可快取、但不能標 IMMUTABLE。
    pcm_b2_shipping_idem_bad_snapshot_cols)                          E='false|search_path=""|s' ;;
    *)                                                               E='false|search_path=""|v' ;;
  esac
  [ "$V" = "$E" ] && ok "W2-PROPS-$fn" "SECURITY INVOKER + search_path='' + volatility 逐字 ✓" \
                  || bad "W2-PROPS-$fn" "屬性不符:[$V] 期望 [$E]"
done
Q "CREATE FUNCTION public.w2_acl_ctl() RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
CTL="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='w2_acl_ctl' AND a.grantee <> p.proowner")"
[ "$CTL" -gt 0 ] 2>/dev/null && ok ACL-CONTROL-HAS-PRIV "對照組(未 REVOKE 的函式)有 $CTL 個非 owner grantee ⇒ 下面每格的綠來自 REVOKE,不是環境" \
                            || bad ACL-CONTROL-HAS-PRIV "🔴 對照組非 owner grantee = [$CTL](期望 >0)⇒ 零 GRANT 那族恆真"
for fn in $HELPERS; do
  G="$(Q "SELECT coalesce(pg_catalog.string_agg(DISTINCT a.grantee::text,','),'(空)') FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  case "$G" in
    *ERROR*) bad "W2-ACLSET-$fn" "🔴 本格的 SQL 自己寫壞了(非權限問題):$G" ;;
    "(空)")  ok  "W2-ACLSET-$fn" "非 owner grantee 集合為空(零 GRANT、owner-only)✓" ;;
    *)       bad "W2-ACLSET-$fn" "🔴 被 GRANT 給 [$G] ⇒ 開了一條繞過五支 RPC 直接動冪等帳的路" ;;
  esac
done

echo "══ 2. 🔴 五支簽章仍凍結(CREATE OR REPLACE 的 a9h 風險面)═══"
sig_expect() {
  case "$1" in
    admin_create_shipment)       echo 'p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL::text' ;;
    admin_add_shipment_items)    echo 'p_idempotency_key text, p_shipment_id uuid, p_items jsonb' ;;
    admin_mark_shipment_shipped) echo 'p_idempotency_key text, p_shipment_id uuid, p_tracking_number text DEFAULT NULL::text' ;;
    admin_void_shipment)         echo 'p_idempotency_key text, p_shipment_id uuid, p_void_reason text' ;;
    admin_unvoid_shipment)       echo 'p_idempotency_key text, p_shipment_id uuid' ;;
  esac
}
for fn in $FIVE; do
  A="$(Q "SELECT pg_catalog.pg_get_function_arguments(p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  [ "$A" = "$(sig_expect "$fn")" ] && ok "W2-SIG-$fn" "簽章逐字未漂(W2 的 REPLACE 沒生 overload)✓" \
                                   || bad "W2-SIG-$fn" "簽章漂了:[$A]"
done

echo "══ 3. 指紋:canonical jsonb 的四個性質(逐條實測)══════════"
HC="$(Q "SELECT (public.pcm_b2_shipping_idem_payload_hash('x', pg_catalog.jsonb_build_object('b',1,'a',2)) = public.pcm_b2_shipping_idem_payload_hash('x', pg_catalog.jsonb_build_object('a',2,'b',1)))::text")"
# 🔴 R1-N2 誠實化:本格是**性質**格(鍵序無關),不是守門格;它證不了「canonical 勝過串接」
#    —— 那條由下面的 INJECT 格證。它也沒有能翻它的靶(常數指紋那發讓它保持 true),這是已知的。
[ "$HC" = "true" ] && ok W2-HASH-CANONICAL "鍵序不影響指紋 ⇒ 呼叫端排列順序不會誤判成 payload 不符(性質格,非守門格)✓" \
                   || bad W2-HASH-CANONICAL "鍵序影響了指紋:[$HC] ⇒ 合法重試會被誤判"
# 🔴 R1-N11:注入的例子改用**真的可達**的自由文字面(recipient_snapshot 的值),
#    不用 carrier_code —— 它值域限 hct/sf/other(`…s1a1.sql:104`),原例在真實列上不可達。
HI="$(Q "SELECT (public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object('recipient_snapshot', pg_catalog.jsonb_build_object('name','王:大'), 'carrier_note','明')) = public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object('recipient_snapshot', pg_catalog.jsonb_build_object('name','王'), 'carrier_note','大:明')))::text")"
[ "$HI" = "false" ] && ok W2-HASH-INJECT "🔴 分隔符注入不成立(收件人姓名含冒號 —— 這組輸入在真實列上可達)✓" \
                    || bad W2-HASH-INJECT "🔴 兩組不同 payload 指紋相同 ⇒ 同鍵送不同內容通得過比對、重放回錯產物"
HN="$(Q "SELECT (public.pcm_b2_shipping_idem_payload_hash('c', pg_catalog.jsonb_build_object('carrier_note',NULL)) = public.pcm_b2_shipping_idem_payload_hash('c', pg_catalog.jsonb_build_object('carrier_note','')))::text")"
[ "$HN" = "false" ] && ok W2-HASH-NULL-VS-EMPTY "NULL 與空字串指紋不同(A8a1 的 coalesce(x,'') 會混為一談)✓" \
                    || bad W2-HASH-NULL-VS-EMPTY "🔴 NULL 與 '' 指紋相同 ⇒ 兩種不同的請求共用一把鍵"
HA="$(Q "SELECT (public.pcm_b2_shipping_idem_payload_hash('void', pg_catalog.jsonb_build_object('shipment_id','$SHIP'::uuid)) = public.pcm_b2_shipping_idem_payload_hash('unvoid', pg_catalog.jsonb_build_object('shipment_id','$SHIP'::uuid)))::text")"
[ "$HA" = "false" ] && ok W2-HASH-ACTION "action 進指紋:同 payload 跨動作指紋不同 ✓" \
                    || bad W2-HASH-ACTION "🔴 跨動作指紋相同 ⇒ action 沒進指紋"

echo "══ 4. 🔴 五支**真的接上**冪等層(不是只有骨架還在)════════"
# 判別力來源:種一列**指紋不符**的鍵列 ⇒ 有接冪等層紅在 P2B22;沒接(維持骨架)紅在 P2B20。
BOGUS="$(printf 'f%.0s' $(seq 1 64))"
i=0
for fn in $FIVE; do
  i=$((i+1))
  case "$fn" in
    admin_create_shipment)       ACT=create_shipment; CALL="public.admin_create_shipment('wired$i','$CUST','{}'::jsonb,'hct')" ;;
    admin_add_shipment_items)    ACT=add_items;       CALL="public.admin_add_shipment_items('wired$i','$SHIP','[]'::jsonb)" ;;
    admin_mark_shipment_shipped) ACT=ship;            CALL="public.admin_mark_shipment_shipped('wired$i','$SHIP')" ;;
    admin_void_shipment)         ACT=void;            CALL="public.admin_void_shipment('wired$i','$SHIP','r')" ;;
    admin_unvoid_shipment)       ACT=unvoid;          CALL="public.admin_unvoid_shipment('wired$i','$SHIP')" ;;
  esac
  plant "$ACT" "wired$i" "$BOGUS" "'$SHIP'" '{}' >/dev/null
  C="$(cap "$CALL")"
  [ "$C" = "P2B22|pcm_b2_w2_idem_payload_mismatch" ] \
    && ok "W2-WIRED-$fn" "種指紋不符的鍵列 ⇒ 紅在 P2B22(不是骨架的 P2B20)= 該支確實走冪等層 ✓" \
    || bad "W2-WIRED-$fn" "實得 [$C](期望 P2B22|pcm_b2_w2_idem_payload_mismatch)⇒ 該支沒接上冪等層"
done

echo "══ 5. 重放路徑五條 + 回傳形狀契約(§1c 面 2/面 4;R1-F4)════"
plant unvoid rOK "$HASH_UNVOID" "'$SHIP'" '{"shipment_reference":"4TFBFH"}' >/dev/null
R="$(Q "SELECT public.admin_unvoid_shipment('rOK','$SHIP')")"
case "$R" in
  *'"idempotent": true'*'"shipment_id": "'$SHIP'"'*) ok W2-REPLAY-OK "重放**成功回傳**(信封 + 快照),不是拋錯 ✓" ;;
  *) bad W2-REPLAY-OK "重放沒回傳預期形狀:[$R]" ;;
esac
C="$(cap "public.admin_unvoid_shipment('rOK','99999999-9999-9999-9999-999999999999')")"
[ "$C" = "P2B22|pcm_b2_w2_idem_payload_mismatch" ] && ok W2-REPLAY-MISMATCH "同鍵送不同 payload ⇒ P2B22(§1c 面 2:比對在任何寫入之前)✓" \
                                                   || bad W2-REPLAY-MISMATCH "實得 [$C]"
plant unvoid rNULL "$HASH_UNVOID" "NULL" '{}' >/dev/null
C="$(cap "public.admin_unvoid_shipment('rNULL','$SHIP')")"
# 🔴 R1-N8 誠實化:這個狀態在正常流程下**已經 commit 不出來**(下面那發 DEFERRED 閘擋著)。
#    本格是**第二層**的證據:把外層拆掉之後,內層自己擋不擋得住。兩層都留、不互相充數。
[ "$C" = "P2B23|pcm_b2_w2_idem_incomplete" ] && ok W2-REPLAY-INCOMPLETE "半成品存根 ⇒ P2B23,**不回半成品**(內層;外層是 DEFERRED 閘)✓" \
                                             || bad W2-REPLAY-INCOMPLETE "實得 [$C] ⇒ 半成品可能被當成功回去"
plant unvoid rGONE "$HASH_UNVOID" "'99999999-9999-9999-9999-999999999999'" '{}' >/dev/null
C="$(cap "public.admin_unvoid_shipment('rGONE','$SHIP')")"
[ "$C" = "P2B24|pcm_b2_w2_idem_product_gone" ] && ok W2-REPLAY-PRODUCT-GONE "存根指向的包裹不存在 ⇒ P2B24 ✓" \
                                               || bad W2-REPLAY-PRODUCT-GONE "實得 [$C]"
plant unvoid rINV "$HASH_UNVOID" "'$SHIP'" '{"shipment_reference":"WRONG9"}' >/dev/null
C="$(cap "public.admin_unvoid_shipment('rINV','$SHIP')")"
[ "$C" = "P2B24|pcm_b2_w2_idem_invariant_broken" ] && ok W2-REPLAY-INVARIANT "快照與現況逐值不符 ⇒ P2B24 invariant_broken(泛型比對真的在比)✓" \
                                                   || bad W2-REPLAY-INVARIANT "實得 [$C]"
plant unvoid rIGN "$HASH_UNVOID" "'$SHIP'" '{"items":"WHATEVER"}' >/dev/null
R="$(Q "SELECT public.admin_unvoid_shipment('rIGN','$SHIP')")"
case "$R" in
  *'"items": "WHATEVER"'*) ok W2-REPLAY-IGNORES-NONCOLS "🔴 誠實邊界實測:非 shipments 欄名的鍵(items)**沒被比**、原樣回傳 ⇒ 那是 W3/W3c 的責任,本層不假裝有守" ;;
  *) bad W2-REPLAY-IGNORES-NONCOLS "非欄名鍵的行為與檔頭宣告不符:[$R]" ;;
esac
# 🔴 R1-F4:首次成功與重放的形狀必須**逐鍵相同、只差 idempotent 旗標**。
R1="$(Q "BEGIN; SELECT public.pcm_b2_shipping_idem_claim('unvoid','respK','$HASH_UNVOID'); SELECT public.pcm_b2_shipping_idem_record('unvoid','respK','$SHIP','{\"shipment_reference\":\"4TFBFH\"}'::jsonb); COMMIT;")"
R2="$(Q "SELECT public.admin_unvoid_shipment('respK','$SHIP')")"
SAME="$(Q "SELECT (('$R1'::jsonb - 'idempotent') = ('$R2'::jsonb - 'idempotent'))::text || '|' || ('$R1'::jsonb->>'idempotent') || '|' || ('$R2'::jsonb->>'idempotent')" 2>/dev/null)"
[ "$SAME" = "true|false|true" ] && ok W2-RESPONSE-SHAPE "首次成功與重放**逐鍵相同、只差 idempotent**(false → true)⇒ 重試拿到同一個答案 ✓" \
                               || bad W2-RESPONSE-SHAPE "形狀不一致:[$SAME] 首次=[$R1] 重放=[$R2]"

echo "══ 6. 回填 record() 四道 + 職責歸屬(§1c 面 3)════════════"
V="$(Q "SELECT (shipment_id::text='$SHIP')::text||'|'||(result_snapshot->>'shipment_reference') FROM public.pcm_b2_shipping_idempotency WHERE action='unvoid' AND idempotency_key='respK'")"
[ "$V" = "true|4TFBFH" ] && ok W2-RECORD-OK "回填後 shipment_id 與 snapshot 都寫進去了 ✓" || bad W2-RECORD-OK "回填結果 [$V]"
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','respK',NULL,'{}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_record_null_shipment" ] && ok W2-RECORD-NULL "回填 NULL shipment_id ⇒ P2B25 ✓" || bad W2-RECORD-NULL "實得 [$C]"
# 🔴 R1-N13
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','respK','99999999-9999-9999-9999-999999999999','{}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_record_no_such_shipment" ] && ok W2-RECORD-NO-SUCH-SHIPMENT "回填不存在的 shipment_id ⇒ 當場 P2B25(不是事後每次重放都 product_gone)✓" \
                                                     || bad W2-RECORD-NO-SUCH-SHIPMENT "實得 [$C]"
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','NOSUCHKEY','$SHIP','{}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_record_rowcount" ] && ok W2-RECORD-ROWCOUNT "改到 0 列**當場拋**(不是靜默 commit 出一個永遠卡死的存根)✓" \
                                             || bad W2-RECORD-ROWCOUNT "實得 [$C]"
# 🔴 「一旦回填不可改指別箱」由 **W0b 的 trigger** 擋,不是 record()。兩格不互相充數 ⇒ 這裡驗歸屬。
plant unvoid repointK "$HASH_UNVOID" "'$SHIP'" '{}' >/dev/null
Q "INSERT INTO public.shipments(id,shipment_reference,customer_user_id,recipient_snapshot,carrier_code) VALUES('33333333-3333-3333-3333-333333333333','5TFBFH','$CUST','{\"name\":\"B\",\"phone\":\"0901\",\"line\":\"M\"}'::jsonb,'hct')" >/dev/null
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','repointK','33333333-3333-3333-3333-333333333333','{}'::jsonb)")"
[ "$C" = "P0001|pcm_b2_shipping_idem_freeze_identity" ] && ok W2-RECORD-REPOINT-BLOCKED "改指別箱被 **W0b 的 freeze_identity** 擋(P0001)⇒ 職責歸屬正確、非 W2 自己充數 ✓" \
                                                        || bad W2-RECORD-REPOINT-BLOCKED "實得 [$C](期望 W0b 的 freeze_identity)"

echo "══ 7. 🔴 R1-F5:快照契約畫在**表**上,不是畫在函式上 ═══════"
# 🔴 fixture 的 shipment_id 必須種成 **NULL**:R2-F6 之後 write-once 的哨兵是 `OLD.shipment_id IS NOT NULL`
#    ⇒ 種成非 NULL 的話,任何改快照的嘗試都**先撞 write-once**,可變欄那道永遠測不到、變成恆真
#    (memory `feedback_fixture-value-makes-guard-vacuous`:fixture 的值讓另一道守門不可構造)。首跑實錘。
plant unvoid snapK "$HASH_UNVOID" "NULL" '{}' >/dev/null
# ① 可變欄:走 record()
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','snapK','$SHIP','{\"shipped_at\":\"x\"}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_snapshot_mutable_col" ] && ok W2-SNAPSHOT-MUTABLE-COL "快照塞可變欄(shipped_at)⇒ P2B25(擋的正是「永久卡死合法重試」那條路)✓" \
                                                  || bad W2-SNAPSHOT-MUTABLE-COL "實得 [$C]"
# ② 🔴 同一條規則,**繞過 record() 直寫**也必須擋 —— 這才是 R1-F5 的重點。
#    五支是 SECURITY DEFINER、以 owner 執行,body 裡一句 UPDATE 就能繞過函式層。
C="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot='{\"carrier_code\":\"hct\"}'::jsonb WHERE action='unvoid' AND idempotency_key='snapK'")"
case "$C" in
  P2B25*snapshot_mutable_col*) ok W2-SNAPSHOT-BYPASS-BLOCKED "🔴 **繞過 record() 的直寫 UPDATE 照樣被擋**(P2B25 在 trigger 上)⇒ 守門畫在表面、不是函式面 ✓" ;;
  *) bad W2-SNAPSHOT-BYPASS-BLOCKED "實得 [$C] ⇒ 直寫繞得過去,守門仍畫在最窄的面" ;;
esac
# ③ write-once
Q "SELECT public.pcm_b2_shipping_idem_record('unvoid','snapK','$SHIP','{\"shipment_reference\":\"4TFBFH\"}'::jsonb)" >/dev/null
C="$(cap "public.pcm_b2_shipping_idem_record('unvoid','snapK','$SHIP','{\"shipment_reference\":\"4TFBFH\",\"id\":\"$SHIP\"}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_snapshot_write_once" ] && ok W2-SNAPSHOT-WRITE-ONCE "快照寫下即不可再改 ⇒ 重放證據不可被竄改 ✓" \
                                                 || bad W2-SNAPSHOT-WRITE-ONCE "實得 [$C]"
# ④ 🔴 R1-F1 的真正驗收:白名單裡的每一欄,**在 draft 態真的改不動**。
#    這格才是「白名單內容正確」的證據 —— 只比欄名清單是比不出來的。
# 🔴 新值刻意選「**不會被別的守門先擋掉**」的:改成別的合法 uuid / 合法編號格式,
#    這樣紅的原因只能是不可變守門本身,不是 FK 或 CHECK(判準第三句)。
Q "INSERT INTO auth.users(id,email) VALUES('55555555-5555-5555-5555-555555555555','w2b@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('55555555-5555-5555-5555-555555555555','w2b@test.local')" >/dev/null
# 🔴 **R2-F9:只驗「有錯」不夠** —— `id` 是 PK、`customer_user_id` 是 FK,
#    它們的 UPDATE 很可能被 **PK/FK** 擋下而不是被不可變守門擋下 ⇒ 那樣這格的紅來自錯的機制、零判別力。
#    ⇒ 逐欄比 **CONSTRAINT_NAME 必須是 `shipments_immutable_guard`**(`…s1a2.sql:161` 逐字)。
IMM_BAD=""
for pair in "id=44444444-4444-4444-4444-444444444444" "shipment_reference=6TFBFH" "customer_user_id=55555555-5555-5555-5555-555555555555"; do
  col="${pair%%=*}"; val="${pair#*=}"
  RC="$(capstmt "UPDATE public.shipments SET $col = '$val' WHERE id='$SHIP'")"
  [ "$RC" = "P0001|shipments_immutable_guard" ] || IMM_BAD="$IMM_BAD $col(實得[${RC:-無錯誤}])"
done
[ -z "$IMM_BAD" ] && ok W2-SNAPSHOTABLE-REALLY-IMMUTABLE "白名單三欄在 **draft 態**逐欄改都被 **shipments_immutable_guard**(不是 PK/FK)擋 ⇒ 清單內容真的只收不可變欄 ✓" \
                  || bad W2-SNAPSHOTABLE-REALLY-IMMUTABLE "🔴 有欄不是被不可變守門擋的:$IMM_BAD ⇒ 這格的紅來自錯的機制、對「白名單混進可變欄」無判別力"

echo "══ 7b. 🔴 R2-F10:W2 換掉了 W0b 的 trigger 函式體 ⇒ 重測 W0b 的原始行為 ══"
# 🔴 `CREATE OR REPLACE` 掉別片的函式,不能靠「我宣稱有保留」。W0b 的 46 格只跑在**沒有 W2** 的庫上,
#    對「W2 之後那兩條還在不在」全盲 ⇒ 由本片在**套完 W2 的庫**上重測。
plant unvoid inhK "$HASH_UNVOID" "'$SHIP'" '{}' >/dev/null
# 🔴 R3-D1:首版只測 `idempotency_key` 一欄卻宣稱「重測 W0b 的原始行為」= 字面超出事實。
#    W0b 凍的是**四欄**,四欄逐一都要測,少測一欄就等於那一欄的凍結沒人守。
INH_BAD=""
C="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET idempotency_key='inhK2' WHERE action='unvoid' AND idempotency_key='inhK'")"
[ "$C" = "P0001|pcm_b2_shipping_idem_freeze_identity" ] || INH_BAD="$INH_BAD idempotency_key(實得[${C:-無錯誤}])"
for col in action payload_hash created_at; do
  case "$col" in
    action)       NV="'void'" ;;
    payload_hash) NV="'$BOGUS'" ;;
    created_at)   NV="now()" ;;
  esac
  RC="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET $col = $NV WHERE action='unvoid' AND idempotency_key='inhK'")"
  [ "$RC" = "P0001|pcm_b2_shipping_idem_freeze_identity" ] || INH_BAD="$INH_BAD $col(實得[${RC:-無錯誤}])"
done
C="$(capstmt "DELETE FROM public.pcm_b2_shipping_idempotency WHERE action='unvoid' AND idempotency_key='inhK'")"
[ -z "$INH_BAD" ] && ok W2-W0B-INHERITED-IDENTITY "W0b 原本的『身分**四欄**凍結』在 W2 換體之後逐欄仍在 ✓" \
                 || bad W2-W0B-INHERITED-IDENTITY "🔴 W2 的 CREATE OR REPLACE 弄丟了:$INH_BAD"
NP_BAD=""
[ "$C" = "P0001|pcm_b2_shipping_idem_no_purge" ] || NP_BAD="$NP_BAD DELETE(實得[${C:-無錯誤}])"
CT="$(capstmt "TRUNCATE public.pcm_b2_shipping_idempotency")"
[ "$CT" = "P0001|pcm_b2_shipping_idem_no_purge" ] || NP_BAD="$NP_BAD TRUNCATE(實得[${CT:-無錯誤}])"
[ -z "$NP_BAD" ] && ok W2-W0B-INHERITED-NOPURGE "W0b 的『永不清理』在 W2 之後**兩發都仍在**(DELETE + TRUNCATE 各自被擋)✓" \
                 || bad W2-W0B-INHERITED-NOPURGE "🔴 W0b 的 no_purge 在 W2 之後有缺:$NP_BAD" 
# 🔴🔴 跨模型審查(Fable)F2:**INSERT 面**的繞道 —— 直寫一句 INSERT(shipment_id 非 NULL
#    + 快照含可變欄)原本零錯誤 commit,之後同鍵合法重試永久 P2B24。UPDATE 面擋得住不代表擋得住。
C="$(capstmt "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,shipment_id,result_snapshot) VALUES('unvoid','insBypassK','$HASH_UNVOID','$SHIP','{\"shipped_at\":\"x\"}'::jsonb)")"
[ "$C" = "P2B25|pcm_b2_w2_snapshot_mutable_col" ] \
  && ok W2-SNAPSHOT-INSERT-BLOCKED "🔴 **直寫 INSERT 的繞道也被擋**(同一個 conname)⇒ 快照契約兩面都掛,不是只掛 UPDATE ✓" \
  || bad W2-SNAPSHOT-INSERT-BLOCKED "🔴 實得 [$C] ⇒ INSERT 面是開的,守門只搬了一半"
# 🔴 R2-F5:非 object 的 snapshot 不得讓信封的 `||` 翻成陣列串接
C="$(cap "public.pcm_b2_shipping_idem_response('$SHIP'::uuid,'[]'::jsonb,false)")"
[ "$C" = "P2B25|pcm_b2_w2_response_not_object" ] \
  && ok W2-RESPONSE-NOT-OBJECT "餵非 object 的 snapshot ⇒ P2B25(否則 || 變陣列串接、idempotent 旗標消失)✓" \
  || bad W2-RESPONSE-NOT-OBJECT "實得 [$C]"
# 🔴 R2-F6:write-once 的哨兵不得與合法值撞號 —— 第一次就寫 '{}' 的列也必須被鎖住
plant unvoid woK "$HASH_UNVOID" "NULL" '{}' >/dev/null
Q "SELECT public.pcm_b2_shipping_idem_record('unvoid','woK','$SHIP','{}'::jsonb)" >/dev/null
C="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot='{\"id\":\"$SHIP\"}'::jsonb WHERE action='unvoid' AND idempotency_key='woK'")"
[ "$C" = "P2B25|pcm_b2_w2_snapshot_write_once" ] \
  && ok W2-WRITE-ONCE-EMPTY-SNAPSHOT "**第一次就寫 '{}'** 的列照樣鎖得住 ⇒ 哨兵沒有與合法值撞號(R1 首版此處恆不生效)✓" \
  || bad W2-WRITE-ONCE-EMPTY-SNAPSHOT "🔴 實得 [$C] ⇒ 空快照的列 write-once 失效、重放證據可被覆寫"

echo "══ 8. 🔴 R1-F2:commit 當下不准留半成品(DEFERRED 閘)═══════"
OUT2="$(capcommit "SELECT public.pcm_b2_shipping_idem_claim('unvoid','stubK','$HASH_UNVOID')")"
case "$OUT2" in
  # 🔴 psql 的 ERROR 輸出**不含 CONSTRAINT 名** ⇒ 只能比訊息;比的字串要挑改訊息時不會順手改掉的那段。
  *存根仍未回填*) ok W2-DEFERRED-COMPLETE "認領了卻沒回填 ⇒ **COMMIT 當下就拋**,那把鍵不會被燒掉 ✓" ;;
  *) bad W2-DEFERRED-COMPLETE "實得 [$OUT2] ⇒ 半成品 commit 得出去,那把鍵會永久卡死" ;;
esac
OUT2="$(capcommit "SELECT public.pcm_b2_shipping_idem_claim('unvoid','okK','$HASH_UNVOID'); SELECT public.pcm_b2_shipping_idem_record('unvoid','okK','$SHIP','{}'::jsonb)")"
# 🔴 `psql -qtA` **不會印 `COMMIT`** ⇒ 首版拿 `*COMMIT*` 當成功判準,正常流程反而判紅(實錘)。
#    判準改成「沒有 ERROR」+ 事後查那列真的回填了(兩面都要,只看沒 ERROR 分不出「根本沒跑」)。
DONE="$(Q "SELECT (shipment_id IS NOT NULL)::text FROM public.pcm_b2_shipping_idempotency WHERE action='unvoid' AND idempotency_key='okK'")"
case "$OUT2:$DONE" in
  *ERROR*) bad W2-DEFERRED-ALLOWS-NORMAL "🔴 正常流程(認領→回填→commit)被誤殺:[$OUT2] ⇒ 那發 trigger 用了 NEW 而非重讀表" ;;
  *:true)  ok  W2-DEFERRED-ALLOWS-NORMAL "正常流程(同交易回填)順利 commit 且該列真的回填了 ⇒ 上一格不是「什麼都擋」的恆真閘 ✓" ;;
  *)       bad W2-DEFERRED-ALLOWS-NORMAL "commit 沒報錯但那列沒回填(shipment_id 非空=[$DONE])⇒ [$OUT2]" ;;
esac

echo "══ 9. 🔴 §1d 分派:非鍵表的 23505 **不得**被轉成重放 ════════"
# 🔴 首跑實錘:原本把臨時 UNIQUE 加在 `payload_hash` 上,而多筆種下的鍵列共用同一個 hash
#    ⇒ ADD CONSTRAINT 失敗、claim 正常認領、本格卻印「被吞成重放」= 判準第三句。⇒ 前置改成必須自證。
ALT="$(QM "ALTER TABLE public.pcm_b2_shipping_idempotency ADD CONSTRAINT w2mut_uq_key UNIQUE (idempotency_key)" | tr -d '\n')"
if [ "$(Q "SELECT (pg_catalog.to_regclass('public.w2mut_uq_key') IS NOT NULL)::text")" != "true" ]; then
  bad W2-DISPATCH-FOREIGN-23505 "🔴 本格的**前置**沒成立(臨時 UNIQUE 沒建起來:$ALT)⇒ 這不是分派的結論"
else
  C="$(cap "public.pcm_b2_shipping_idem_claim('void','rOK','$HASH_UNVOID')")"
  case "$C" in
    23505*) ok W2-DISPATCH-FOREIGN-23505 "撞到**非鍵表 PK** 的唯一鍵 ⇒ 原封拋回 23505(實得 [$C]),沒被吞成重放 ✓" ;;
    *)      bad W2-DISPATCH-FOREIGN-23505 "🔴 實得 [$C] ⇒ 別的唯一鍵撞了也被當成同鍵併發轉重放" ;;
  esac
  Q "ALTER TABLE public.pcm_b2_shipping_idempotency DROP CONSTRAINT w2mut_uq_key" >/dev/null
fi
# 🔴 **誠實邊界**:`IS DISTINCT FROM` 相對 `<>` 的差別只在 conname 為 NULL 時,而本 schema 內
#    **沒有已知的 NULL 來源** —— 裸 partial unique index 實測也回索引名(R1-F7,首版寫錯已更正)
#    ⇒ 本格證的是「conname 不同就拋回」,**不是**「NULL 也拋回」。後者在此不可構造。

echo "══ 10. 🔴 同鍵真併發:第二個請求轉重放(§1c 面 3)══════════"
CK='concKEY'
# 🔴 R1-N5:不能只問「這座庫上有人被擋」,要問「**擋 B 的是不是 A**」。
#    首版靠 `head -1 A.out` 取 A 的 pid —— psql 的輸出到交易結束才落地,取不到(實錘)。
#    改用 `application_name`:兩條連線各自具名,歸屬直接從 `pg_stat_activity` 讀,不依賴輸出時序。
PGAPPNAME=w2A psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
  "BEGIN; SELECT public.pcm_b2_shipping_idem_claim('unvoid','$CK','$HASH_UNVOID'); SELECT public.pcm_b2_shipping_idem_record('unvoid','$CK','$SHIP','{}'::jsonb); SELECT pg_catalog.pg_sleep(4); COMMIT;" >"$D/A.out" 2>&1 &
sleep 1
PGAPPNAME=w2B psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c \
  "SELECT public.pcm_b2_shipping_idem_claim('unvoid','$CK','$HASH_UNVOID');" >"$D/B.out" 2>&1 &
sleep 1.5
# 期望字面:被擋的是 w2B、擋它的是 w2A(逐字比,不是「有人被擋」)
# 🔴 `pg_blocking_pids(x)[1]` 是**語法錯誤** —— 函式結果要下標必須整個包起來 `(...)[1]`(首跑實錘)。
BLK="$(Q "SELECT coalesce(pg_catalog.string_agg(v.blocked || '<-' || v.blocker, ',' ORDER BY v.blocked),'(無)') FROM (SELECT a.application_name AS blocked, (SELECT b.application_name FROM pg_catalog.pg_stat_activity b WHERE b.pid = (pg_catalog.pg_blocking_pids(a.pid))[1]) AS blocker FROM pg_catalog.pg_stat_activity a WHERE pg_catalog.cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0) v")"
case "$BLK" in
  # 🔴 判準第三句:「我的 SQL 寫壞了」不得與「沒撞上」共用同一句結論。
  *ERROR*)    bad W2-CONC-BLOCKED "🔴 本格的 SQL 自己寫壞了(非併發結論):$BLK" ;;
  "w2B<-w2A") ok  W2-CONC-BLOCKED "被擋的是 **w2B**、擋它的是 **w2A**(逐字)⇒ 下一格量到的是真併發,且擋人的是對的那個 ✓" ;;
  *)          bad W2-CONC-BLOCKED "🔴 阻塞歸屬 [$BLK] != 期望 [w2B<-w2A] ⇒ 沒撞上、或擋 B 的不是 A" ;;
esac
wait
B="$(cat "$D/B.out")"
case "$B" in
  *'"idempotent": true'*) ok W2-CONC-REPLAY "第一個 commit 後,第二個由 23505 轉**重放**並成功回傳(非錯誤、非第二次認領)✓" ;;
  *)                      bad W2-CONC-REPLAY "第二個請求的結果不是重放:[$B]" ;;
esac
# 🔴 R1-F6:原本這裡有一格 `W2-CONC-SINGLE-ROW`(數同鍵列數 = 1)。**它是恆真的** ——
#    PK 是 (action, idempotency_key),那個查詢在任何實作下都不可能 >1;它證的是 PK,不是被測程式。
#    ⇒ **已刪**,不留裝飾格。

echo "══ 11. 🔴 快照白名單的對帳面(枚舉唯一權威 + 對帳格)═══════"
COLS="$(Q "SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.shipments'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped")"
EXP_COLS="carrier_code,carrier_note,created_at,customer_user_id,deleted_at,hct_raw_response,hct_request_id,hct_status,id,recipient_snapshot,shipment_reference,shipped_at,tracking_number,updated_at,void_reason"
[ "$COLS" = "$EXP_COLS" ] && ok W2-SHIPCOLS-FROZEN "shipments 欄集逐字凍結 ⇒ 加欄時白名單會被強制重新裁定 ✓" \
                          || bad W2-SHIPCOLS-FROZEN "shipments 欄集漂了:[$COLS]"

echo "══ 12. 🔴 突變靶(家族格逐成員打;R1-N3/N4/N6)══════════════"
# 🔴 從這裡開始**會破壞被測物**,所有觀察都在本節內取完;不還原(跑完即拆庫)。
# ① SHIPCOLS 族
Q "ALTER TABLE public.shipments ADD COLUMN w2mut_col text" >/dev/null
M="$(Q "SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.shipments'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped")"
[ "$M" != "$EXP_COLS" ] && ok TMUT-SHIPCOLS "加一欄 ⇒ 欄集真的變了 = W2-SHIPCOLS-FROZEN 抓得到「有人動了 shipments」" \
                        || bad TMUT-SHIPCOLS "加欄後欄集沒變 ⇒ 該格恆真"
Q "ALTER TABLE public.shipments DROP COLUMN w2mut_col" >/dev/null
# ② ACL 族 —— 🔴 R1-N4:**逐成員**打,五支全部要翻面
ACL_BAD=""
for fn in $HELPERS; do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
  M="$(Q "SELECT pg_catalog.count(DISTINCT a.grantee::text)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  [ "$M" = "1" ] || ACL_BAD="$ACL_BAD $fn(實得$M)"
  Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
done
[ -z "$ACL_BAD" ] && ok TMUT-ACL "**五支逐一** GRANT ⇒ 每一格的觀察值都翻面(0→1)= 整族有判別力,不是單一成員" \
                  || bad TMUT-ACL "有成員不敏感:$ACL_BAD"
# 🔴🔴 **指紋族的靶(TMUT-HASH)刻意排在本節最後。**
#    首版把它排在這裡,而它把 `payload_hash` 換成常數 ⇒ **後面每一格算出的指紋都不再對得上種好的鍵列**
#    ⇒ `TMUT-INCOMPLETE` / `TMUT-INVARIANT` 觀察到的「翻面」實得 `P2B22 payload_mismatch`,
#      翻面的原因是**上一發突變**、不是它們各自要證的那段守門 —— 兩格因此**假綠**(首跑實錘)。
#    (memory `feedback_negative-test-harness-self-false-green`:負測 harness 自己也會假綠。)
# ④ 🔴 R1-N3:INCOMPLETE 與 INVARIANT **各自一發等長同形**的突變(只拿掉自己那一段,其餘照舊)
CLAIM_BASE="DECLARE v_row public.pcm_b2_shipping_idempotency%ROWTYPE; v_live jsonb; v_bad bigint; BEGIN SELECT * INTO v_row FROM public.pcm_b2_shipping_idempotency WHERE action=p_action AND idempotency_key=p_key; IF NOT FOUND THEN INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash) VALUES(p_action,p_key,p_hash); RETURN NULL; END IF; IF v_row.payload_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'mm' USING ERRCODE='P2B22', CONSTRAINT='pcm_b2_w2_idem_payload_mismatch'; END IF;"
CLAIM_NULLCHK="IF v_row.shipment_id IS NULL THEN RAISE EXCEPTION 'ic' USING ERRCODE='P2B23', CONSTRAINT='pcm_b2_w2_idem_incomplete'; END IF;"
CLAIM_INVCHK="SELECT pg_catalog.to_jsonb(s.*) INTO v_live FROM public.shipments s WHERE s.id=v_row.shipment_id; IF v_live IS NULL THEN RAISE EXCEPTION 'pg' USING ERRCODE='P2B24', CONSTRAINT='pcm_b2_w2_idem_product_gone'; END IF; SELECT pg_catalog.count(*) INTO v_bad FROM pg_catalog.jsonb_each(v_row.result_snapshot) e WHERE v_live ? e.key AND (v_live -> e.key) IS DISTINCT FROM e.value; IF v_bad <> 0 THEN RAISE EXCEPTION 'iv' USING ERRCODE='P2B24', CONSTRAINT='pcm_b2_w2_idem_invariant_broken'; END IF;"
CLAIM_TAIL="RETURN public.pcm_b2_shipping_idem_response(v_row.shipment_id, v_row.result_snapshot, true); END"
mutclaim() { Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_claim(p_action text, p_key text, p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$m\$ $1 \$m\$" >/dev/null; }
mutclaim "$CLAIM_BASE $CLAIM_INVCHK $CLAIM_TAIL"      # 只拿掉 NULL 那一段
M="$(cap "public.admin_unvoid_shipment('rNULL','$SHIP')")"
# 🔴🔴 **R3-E1 更正**:首版這格的訊息寫「半成品被當成功回去」——**那是假的**。
#    `shipment_id` 為 NULL 時,下一段的 `WHERE s.id = NULL` 必然無列 ⇒ **`product_gone` 一定接手**
#    ⇒ 拿掉 incomplete 那道之後實得的是 `P2B24 product_gone`,不是「成功回去」。
#    ⇒ `P2B23 incomplete` 是**被 product_gone 嚴格蘊含**的(memory
#      `feedback_unconstructible-negative-test-means-noop-guard`):它唯一真正的貢獻是
#      **給員工一句準確的話**(「上次那筆沒完成」而不是「包裹不存在」),**不是多一道保護**。
#    本格因此改成斷言「觀察值真的從 P2B23 變成 P2B24」——那才是它實際證得到的事。
[ "$M" = "P2B24|pcm_b2_w2_idem_product_gone" ] \
  && ok TMUT-INCOMPLETE "🔴 只拿掉 incomplete 那道 ⇒ 觀察值變成 P2B24 product_gone(**不是**「成功回去」)= 該道的貢獻是訊息精確度,被 product_gone 嚴格蘊含" \
  || bad TMUT-INCOMPLETE "實得 [${M:-無錯誤}](期望 P2B24|pcm_b2_w2_idem_product_gone)"
mutclaim "$CLAIM_BASE $CLAIM_NULLCHK $CLAIM_TAIL"     # 只拿掉不變式那一段
M="$(cap "public.admin_unvoid_shipment('rINV','$SHIP')")"
# 🔴 R3-E1 的同族教訓:斷言不要寫成「**不是** X」——那對「變成另一種紅」與「真的變綠」不分。
#    這裡要的觀察是「**真的回成功了**」⇒ 斷言 cap 沒抓到任何例外,並另外確認它回得出信封。
RINV="$(Q "SELECT public.admin_unvoid_shipment('rINV','$SHIP')")"
case "$M:$RINV" in
  :*'"idempotent": true'*) ok TMUT-INVARIANT "🔴 **只**拿掉泛型比對(其餘照舊)⇒ 快照與現況不符時**真的回了成功信封**= 該格自己有判別力" ;;
  *) bad TMUT-INVARIANT "拿掉比對後實得例外 [${M:-無}] / 回傳 [$RINV] ⇒ 那格守的不是這段" ;;
esac
# ⑤ 🔴 R1-N6:DISPATCH 族的靶 —— 把 conname 判斷整條拿掉(撞什麼都轉重放)
mutclaim "DECLARE v_row public.pcm_b2_shipping_idempotency%ROWTYPE; BEGIN SELECT * INTO v_row FROM public.pcm_b2_shipping_idempotency WHERE action=p_action AND idempotency_key=p_key; IF NOT FOUND THEN BEGIN INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash) VALUES(p_action,p_key,p_hash); RETURN NULL; EXCEPTION WHEN unique_violation THEN SELECT * INTO v_row FROM public.pcm_b2_shipping_idempotency WHERE action=p_action AND idempotency_key=p_key; END; END IF; RETURN public.pcm_b2_shipping_idem_response(v_row.shipment_id, v_row.result_snapshot, true); END"
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ADD CONSTRAINT w2mut_uq_key2 UNIQUE (idempotency_key)" >/dev/null
M="$(cap "public.pcm_b2_shipping_idem_claim('void','rGONE','$HASH_UNVOID')")"
case "$M" in
  23505*) bad TMUT-DISPATCH "拿掉 conname 判斷後仍拋 23505 ⇒ DISPATCH 格守的不是那段" ;;
  *)      ok  TMUT-DISPATCH "🔴 拿掉 conname 判斷 ⇒ 非鍵表的 23505 **被吞掉了**(實得 [${M:-無錯誤}])= W2-DISPATCH 格有判別力" ;;
esac
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DROP CONSTRAINT w2mut_uq_key2" >/dev/null
# ⑥ RECORD 族:拿掉 ROW_COUNT 斷言
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_record(p_action text, p_key text, p_shipment_id uuid, p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$m\$ BEGIN UPDATE public.pcm_b2_shipping_idempotency SET shipment_id=p_shipment_id, result_snapshot=p_snapshot WHERE action=p_action AND idempotency_key=p_key; RETURN public.pcm_b2_shipping_idem_response(p_shipment_id, p_snapshot, false); END \$m\$" >/dev/null
M="$(cap "public.pcm_b2_shipping_idem_record('unvoid','NOSUCHKEY','$SHIP','{}'::jsonb)")"
[ "$M" != "P2B25|pcm_b2_w2_record_rowcount" ] \
  && ok TMUT-RECORD-ROWCOUNT "🔴 拿掉 ROW_COUNT 斷言 ⇒ 改到 0 列靜默成功(實得 [${M:-無錯誤}])= 那格有判別力" \
  || bad TMUT-RECORD-ROWCOUNT "拿掉斷言後仍拋 rowcount ⇒ 那格量錯東西"
# ⑦ DEFERRED 閘的靶:拆掉它 ⇒ 半成品 commit 得出去
Q "DROP TRIGGER $DEFTRG ON public.pcm_b2_shipping_idempotency" >/dev/null
M="$(capcommit "SELECT public.pcm_b2_shipping_idem_claim('unvoid','stubK2','$HASH_UNVOID')")"
case "$M" in
  *ERROR*) bad TMUT-DEFERRED "拆掉 trigger 後仍拋 [$M] ⇒ W2-DEFERRED-COMPLETE 守的不是那發 trigger" ;;
  # 🔴 R3-E1:**不得**再寫「這也證明 P2B23 是獨立的第二層」—— 那句是假的(見 TMUT-INCOMPLETE)。
  #    本格只證一件事:半成品擋不擋得住,**完全靠這發 trigger**。
  *)       ok  TMUT-DEFERRED "🔴 拆掉 DEFERRED 閘 ⇒ 半成品**真的 commit 出去了** = 擋住半成品的完全是它(P2B23 那層另有結論,見 TMUT-INCOMPLETE)" ;;
esac
# ⑧ 快照守門的靶:把 trigger 函式換成只凍身分(不管快照)⇒ 兩格必翻面
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_freeze_identity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$m\$ BEGIN RETURN NEW; END \$m\$" >/dev/null
# 🔴🔴 **跨模型審查(Fable)F1:本格原本用 `cap`(=`PERFORM (UPDATE …)`)餵語句 ⇒ 保證 42601 語法錯誤,
#    那句 UPDATE **從未執行**;實得 `42601|(null)` 落進 `*)` ⇒ **不管突變成不成功本格都綠 = 恆真**。
#    本檔 :58-61 自己寫下過這個坑、也修了另外兩處,**唯獨漏了這一格**,而 PASS 行印出的
#    `實得 [42601|(null)]` 就擺在實跑輸出裡沒人看。⇒ 換 `capstmt`。
# 🔴 F7:再拆成兩發各自歸屬 —— 同一句 UPDATE 會同時打 write-once 與 mutable-col 兩族,
#    守門在場時只會紅在先檢查的那一道,消融歸因是合併的。
#    ⇒ ①打**未完成列**(shipment_id NULL)的 mutable-col ②打**已完成列**的 write-once。
plant unvoid mutSnapK "$HASH_UNVOID" "NULL" '{}' >/dev/null
MA="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot='{\"shipped_at\":\"x\"}'::jsonb WHERE action='unvoid' AND idempotency_key='mutSnapK'")"
MB="$(capstmt "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot='{\"id\":\"$SHIP\"}'::jsonb WHERE action='unvoid' AND idempotency_key='rOK'")"
case "$MA:$MB" in
  *P2B25*) bad TMUT-SNAPSHOT-GUARD "拿掉快照守門後仍擋(mutable=[$MA] write-once=[$MB])⇒ 那兩格守的不是這段" ;;
  :)       ok  TMUT-SNAPSHOT-GUARD "🔴 把 trigger 換成只放行 ⇒ **可變欄(未完成列)與竄改快照(已完成列)兩發都通過** = 表級守門那族有判別力" ;;
  *)       bad TMUT-SNAPSHOT-GUARD "🔴 突變後實得非空且非 P2B25(mutable=[$MA] write-once=[$MB])⇒ 分不出是守門還是我的 SQL 壞了" ;;
esac
# ⑨ 🔴 指紋族(**必須最後**,理由見本節開頭):換成常數指紋 ⇒ 注入格由紅轉綠
Q "CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_payload_hash(p_action text, p_payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS \$m\$ SELECT pg_catalog.repeat('a',64) \$m\$" >/dev/null
M="$(Q "SELECT (public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object('recipient_snapshot', pg_catalog.jsonb_build_object('name','王:大'), 'carrier_note','明')) = public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object('recipient_snapshot', pg_catalog.jsonb_build_object('name','王'), 'carrier_note','大:明')))::text")"
[ "$M" = "true" ] && ok TMUT-HASH "🔴 換成常數指紋 ⇒ 注入格由紅轉綠(實得 true)= 指紋族有判別力" \
                  || bad TMUT-HASH "換成常數後仍是 [$M] ⇒ 指紋族量錯東西"

echo "══ 13. 覆蓋帳 ═════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或新增未更新凍結值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-34s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="ACL-CONTROL-HAS-PRIV DDL-SYNTAX TMUT-ACL TMUT-DEFERRED TMUT-DISPATCH TMUT-HASH TMUT-INCOMPLETE TMUT-INVARIANT TMUT-RECORD-ROWCOUNT TMUT-SHIPCOLS TMUT-SNAPSHOT-GUARD W2-ACLSET-pcm_b2_shipping_idem_bad_snapshot_cols W2-ACLSET-pcm_b2_shipping_idem_claim W2-ACLSET-pcm_b2_shipping_idem_insert_guard W2-ACLSET-pcm_b2_shipping_idem_payload_hash W2-ACLSET-pcm_b2_shipping_idem_record W2-ACLSET-pcm_b2_shipping_idem_require_complete W2-ACLSET-pcm_b2_shipping_idem_response W2-CONC-BLOCKED W2-CONC-REPLAY W2-DEFERRED-ALLOWS-NORMAL W2-DEFERRED-COMPLETE W2-DISPATCH-FOREIGN-23505 W2-FN-SET W2-HASH-ACTION W2-HASH-CANONICAL W2-HASH-INJECT W2-HASH-NULL-VS-EMPTY W2-PROPS-pcm_b2_shipping_idem_bad_snapshot_cols W2-PROPS-pcm_b2_shipping_idem_claim W2-PROPS-pcm_b2_shipping_idem_insert_guard W2-PROPS-pcm_b2_shipping_idem_payload_hash W2-PROPS-pcm_b2_shipping_idem_record W2-PROPS-pcm_b2_shipping_idem_require_complete W2-PROPS-pcm_b2_shipping_idem_response W2-RECORD-NO-SUCH-SHIPMENT W2-RECORD-NULL W2-RECORD-OK W2-RECORD-REPOINT-BLOCKED W2-RECORD-ROWCOUNT W2-REPLAY-IGNORES-NONCOLS W2-REPLAY-INCOMPLETE W2-REPLAY-INVARIANT W2-REPLAY-MISMATCH W2-REPLAY-OK W2-REPLAY-PRODUCT-GONE W2-RESPONSE-NOT-OBJECT W2-RESPONSE-SHAPE W2-SHIPCOLS-FROZEN W2-SIG-admin_add_shipment_items W2-SIG-admin_create_shipment W2-SIG-admin_mark_shipment_shipped W2-SIG-admin_unvoid_shipment W2-SIG-admin_void_shipment W2-SNAPSHOT-BYPASS-BLOCKED W2-SNAPSHOT-INSERT-BLOCKED W2-SNAPSHOT-MUTABLE-COL W2-SNAPSHOT-WRITE-ONCE W2-SNAPSHOTABLE-REALLY-IMMUTABLE W2-W0B-INHERITED-IDENTITY W2-W0B-INHERITED-NOPURGE W2-WIRED-admin_add_shipment_items W2-WIRED-admin_create_shipment W2-WIRED-admin_mark_shipment_shipped W2-WIRED-admin_unvoid_shipment W2-WIRED-admin_void_shipment W2-WRITE-ONCE-EMPTY-SNAPSHOT"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-34s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單(換格名/換格都紅得到)"; PASS=$((PASS+1))
else
  printf '  FAIL %-34s %s\n' "CELL-KEYSET" "格名集合漂了。多出:[$(comm -13 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')] 少了:[$(comm -23 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')]"; FAIL=$((FAIL+1))
fi

pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"
echo
echo "════ PASS=$PASS FAIL=$FAIL ════  埠殘留:$(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"

# 🔴🔴 **結束碼守門(跨模型審查 F1;家族回歸)**:少了這行,`FAIL>0` 時結束碼仍是 0
#    ⇒ 任何 `&&` 鏈、preflight、收割腳本都會把**紅跑讀成綠**。
#    `w0b-verify.sh` / `w1-verify.sh`(前一個 session 寫的)本來就有這道;
#    我從 `w2-verify.sh` 開始漏掉,然後一路複製到 w3a/w3b2/w3c3/w5 —— **五支全中**。
[ "$FAIL" -eq 0 ] || exit 1
