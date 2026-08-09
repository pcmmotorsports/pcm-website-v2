#!/usr/bin/env bash
#
# W5 · **出貨線的線級 harness**(結構 oracle + 端到端行為;外部 oracle 形狀照 b2s2b-verify.sh)
#
# 用法:scripts/w5-line-verify.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:plan v4.2 §2 W5 列 / §2a(`W5` 依賴 W1、且**排在 W6a 之前**——W6a 要用它跑探針)
#
# ══ 🔴 這支存在的理由(不是「再寫一次 w2/w3a/w3b2/w3c3」)═══════════
#   那四支各自**只重放 `TS <= 自己` 的前綴**(W3-1 落檔那天 w2 的尾端閘響了、處置就是改前綴重放)。
#   代價當時就寫明了:**每一支都證不了「被測物在更晚的片之上仍成立」**。
#   ⇒ 於是出現一個沒人守的面:**「五支 writer 在<u>全部片都在</u>的尖端一起跑」從來沒被測過。**
#   本檔就是補那一面:
#     · 重放**整個 migration 目錄**(無前綴),不留尾巴
#     · **結構 oracle**:出貨線的物件集合 + ACL + trigger 啟用態,凍成**一份**清單
#     · **端到端行為**:建箱 → 掛品項 → 出貨,**全程只走五支 RPC**(不直寫任何一張表)
#   🔴 **本檔不重複各片的守門格** —— 那些是各片自己的責任。本檔只問兩件:
#      ①「全部片疊起來之後,線還是完整的嗎」②「一個員工從頭做到尾,做得完嗎」。
#
# ══ 🔴 尾端閘:本檔**必須**釘在線的尖端 ═════════════════════════
#   前綴重放是各片的選擇;**本檔刻意相反** —— 它就是那個「必須跟著線一起長」的檔。
#   新片落檔 ⇒ 這道閘會 die ⇒ **處置是重釘 + 把新片的物件加進結構 oracle**,不是把閘拿掉。
#
# ══ 判準四句(承自 w0b/w1/w2/w3* )═══════════════════════════════
#   🔴 消融必須由紅轉綠,否則判別力歸屬錯。
#   🔴 全綠的消融也可能恆真,隔離守門自己要有靶。
#   🔴 「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。
#   🔴 家族格的靶不得只打一個成員。
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站最終權限,只有 apply 後在 A 庫驗才消。
# 🔴 **格數全綠證的是「寫下的守門有判別力」,證不了「該有的守門都想到了」。**
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W5DB:-/tmp/w5db}"; SOCK="${W5SOCK:-/tmp/w5sk}"; P="${W5PORT:-54399}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=28   # 🔴 量出來的。全綠時 PASS = 28 + CELL-ACCOUNT + CELL-KEYSET = 30。
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
  pg_ctl -D "$D" -w stop >/dev/null 2>&1
  LEFTOVER="$(pgrep -f "postgres.*$D" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -f "$D/postmaster.pid" ] || [ "$LEFTOVER" != "0" ]; then
    echo "🔴 TEARDOWN_WARN:postmaster 沒停乾淨(殘留程序 $LEFTOVER 支)⇒ **保留 datadir 與 socket 目錄供診斷**:$D / $SOCK"
    return
  fi
  rm -rf "$D" "$SOCK"
  # 🔴 rm 之後**實測 -e**、不要只印「已收」——「宣稱」不是「檢查」(本 repo 記過的恆真格家族)。
  if [ -e "$D" ] || [ -e "$SOCK" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後仍看得到 資料目錄=$([ -e "$D" ] && echo 殘留 || echo 0) / socket 目錄=$([ -e "$SOCK" ] && echo 殘留 || echo 0)"
    return
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

# 🔴 尾端閘(本檔的意義所在,見檔頭)
# 🔴🔴 **第一次重釘(W3c-1 落檔)—— 這道閘照設計 die 了,處置就是這裡寫的**:
#    重釘 + 把新片的物件加進 oracle。W3c-1 是 `CREATE OR REPLACE` 既有的 `admin_void_shipment`
#    ⇒ 物件集合不變(仍是五支),但**端到端多了一段作廢**(void 從「只有存在性」變成有行為)。
# 🔴 **第二次重釘(W3c-2 落檔)**:unvoid 也有行為了 ⇒ 端到端補「復原」那一步,
#    鍵表期望值四列 → **五列**、誠實邊界那句「unvoid 只有存在性」作廢。
# 🔴🔴 **第三次重釘(W4-1 落檔)**:W4-1 把 W0b 那兩支 trigger 函式的 REVOKE 補上了
#    ⇒ **下面的 `ACL_EXEMPT` 具名例外必須撤掉**。當初留例外時就寫了「修掉那天本格會紅、逼人回收例外」——
#    這次就是那一天。例外留著不撤 = 它會從「誠實的記帳」變成「永久的謊」。
# 🔴 重釘(2026-08-09 W7d-3 落檔 `20260809020000`):該片是 **assert-only** ——
#    逐條核過 `CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE` **全部零命中**,
#    只有一個 DO block 與一個 `COMMENT ON FUNCTION`。⇒ **結構 oracle 無需增列**
#    (閘要求的第二步在本片是 no-op,但這是查出來的、不是跳過的)。
#    `COMMENT` 不進 `pg_get_functiondef` ⇒ 任何函式體 md5 釘值也不受影響。
LINE_TIP="20260809020000"
NEWEST_TS="$(ls "$REPO"/supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "$LINE_TIP" ] \
  || die "migration 目錄的尾端是 $NEWEST_TS,不是本檔釘住的 $LINE_TIP ——
   本檔是**線級** harness,它的職責就是跟著線一起長。
   處置 = 重釘本行 **並把新片的物件加進下面的結構 oracle**,**不是把這道閘拿掉**。"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
ok LINE-REPLAY "**整個 migration 目錄**(無前綴、含尖端 $LINE_TIP)從零重放成功 ⇒ 五支 writer **存在且可疊**。🔴 五支 writer **全部**在端到端裡有行為(W3c-2 落檔後,unvoid 也有了)"

echo "══ 1. 結構 oracle:出貨線的物件集合凍結 ═══════════════════"
# 🔴 一份清單、一個權威。各片自己的凍結格守的是各片;本格守的是**線的完整性**
#    —— 任何一片被誰改掉/漏套/多長一支,這裡會紅。
FIVE="admin_add_shipment_items,admin_create_shipment,admin_mark_shipment_shipped,admin_unvoid_shipment,admin_void_shipment"
RPCS="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin\_%shipment%'")"
[ "$RPCS" = "$FIVE" ] && ok LINE-RPC-SET "出貨 RPC 集合**恰為五支**(多一支少一支都紅)✓" || bad LINE-RPC-SET "實得 [$RPCS]"
HELPERS_EXP="pcm_b2_shipping_human_error,pcm_b2_shipping_idem_bad_snapshot_cols,pcm_b2_shipping_idem_claim,pcm_b2_shipping_idem_freeze_identity,pcm_b2_shipping_idem_insert_guard,pcm_b2_shipping_idem_no_purge,pcm_b2_shipping_idem_payload_hash,pcm_b2_shipping_idem_record,pcm_b2_shipping_idem_require_complete,pcm_b2_shipping_idem_response"
HELPERS="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'pcm\_b2\_shipping\_%')")"
[ "$HELPERS" = "$HELPERS_EXP" ] && ok LINE-HELPER-SET "出貨線 helper 集合逐字凍結(10 支:W2 七 + W0b 兩 + W3-3 轉譯層)✓" || bad LINE-HELPER-SET "實得 [$HELPERS]"
# 🔴 ACL:五支只有 service_role;十支 helper 零 GRANT(含 proacl IS NULL 那面)
ACLBAD=""
for fn in $(printf '%s' "$FIVE" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  V="$(Q "SELECT has_function_privilege('anon','$SIG','EXECUTE')::text||has_function_privilege('authenticated','$SIG','EXECUTE')::text||has_function_privilege('authenticator','$SIG','EXECUTE')::text||has_function_privilege('service_role','$SIG','EXECUTE')::text")"
  [ "$V" = "falsefalsefalsetrue" ] || ACLBAD="$ACLBAD $fn($V)"
done
[ -z "$ACLBAD" ] && ok LINE-RPC-ACL "五支逐支:三個對外角色無 EXECUTE、service_role 有 ✓" || bad LINE-RPC-ACL "ACL 漂了:$ACLBAD"
# 🔴🔴 **線級 oracle 首跑就抓到一條上游缺口(實查證實)**:
#    `…w0b_shipping_idempotency.sql:210` **只 REVOKE 了表**,它自己建的兩支 trigger 函式
#    (`_no_purge` / `_freeze_identity`)**沒 REVOKE** ⇒ 它們留著 shim 的 default privileges,
#    非 owner grantee = 4(PUBLIC + anon/authenticated/service_role)。
#    🔴 **實害有限**:trigger 函式被直呼時 PG 會擋(「只能當 trigger 呼叫」)⇒ 不是可用的洞。
#    🔴 **但我的線級宣稱「十支零 GRANT」是假的** ⇒ 據實編碼成**具名例外**,不假裝它零 GRANT。
#    ⇒ 修法是一行 REVOKE,最省的落點是 W4 的 migration(順路)。STOP 列為欠款;
#      修掉的那天本格會紅(例外清單對不上)、逼人回來拿掉例外 —— 與 M3 窗口同一形狀。
ACL_EXEMPT=""   # 🔴 W4-1 已補 REVOKE ⇒ 例外清空(見上面第三次重釘的說明)
HBAD=""
for fn in $(printf '%s' "$HELPERS_EXP" | tr ',' ' '); do
  NULLACL="$(Q "SELECT (p.proacl IS NULL)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  case " $ACL_EXEMPT " in
    # 🔴 跨模型審查 F6:比**數**不比**名** ⇒ 有人 REVOKE PUBLIC 又 GRANT 另一個角色、數還是 4、本格照樣綠。
    #    ⇒ 逐字比 grantee 名單。
    *" $fn "*)
       GN="$(Q "SELECT pg_catalog.string_agg(DISTINCT coalesce(r.rolname,'PUBLIC'), ',' ORDER BY coalesce(r.rolname,'PUBLIC')) FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
       [ "$GN" = "PUBLIC,anon,authenticated,service_role" ] || HBAD="$HBAD $fn(已知缺口的 grantee 名單應為 PUBLIC,anon,authenticated,service_role,實得 [$GN])" ;;
    # 🔴 `aclexplode(NULL)` 回零列 ⇒ 只數 grantee 對「proacl IS NULL(=預設 EXECUTE to PUBLIC)」全盲
    *) { [ "$NULLACL" = "false" ] && [ "$G" = "0" ]; } || HBAD="$HBAD $fn(null=$NULLACL,g=$G)" ;;
  esac
done
[ -z "$HBAD" ] && ok LINE-HELPER-ACL "**十支 helper 全部**零 GRANT 且 proacl 非 NULL(W4-1 補完 W0b 那兩支之後,具名例外已撤)✓" \
                || bad LINE-HELPER-ACL "$HBAD"
# 🔴 鍵表的五發 trigger 全 ALWAYS
# 🔴🔴 **W4-2 落檔補的兩格(跨模型審查 F3 點名的尖端盲區)**:
#    上面的 helper 集合凍結用的 pattern 是 `pcm_b2_shipping_%`,而 W4-2 的兩支叫
#    `pcm_b2_add_items_impl` / `pcm_b2_shipments_no_batch_update` ⇒ **不在 pattern 內、整組全盲**。
#    失敗情境:下一片落檔那天起 w4b 的前綴 < 尖端,之後任何片 `CREATE OR REPLACE` 掉薄封裝、
#    或 `DROP`/降級禁批次 trigger ⇒ **零 harness 會紅**(w4b 在自己前綴永遠綠、w5 看不見)。
#    🔴 **殘餘**:再新增一支別的 `pcm_b2_*` helper 仍然逃得掉(逐名凍結不是 pattern 凍結)。寫下來,不假裝關完。
W4B_FN="pcm_b2_add_items_impl,pcm_b2_shipments_no_batch_update"
WBAD=""
for fn in $(printf '%s' "$W4B_FN" | tr ',' ' '); do
  V="$(Q "SELECT (p.proacl IS NOT NULL)::text || ':' || (SELECT pg_catalog.count(*)::text FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  [ "$V" = "true:0" ] || WBAD="$WBAD $fn($V)"
done
[ -z "$WBAD" ] && ok LINE-W4B-HELPERS "W4-2 兩支新 helper 在尖端**存在且零 GRANT**(proacl 非 NULL)✓" || bad LINE-W4B-HELPERS "$WBAD"
nbstate() { Q "SELECT coalesce(pg_catalog.string_agg(t.tgenabled::text, ','),'(無)') FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.shipments'::pg_catalog.regclass AND t.tgname='shipments_no_batch_update_as' AND NOT t.tgisinternal"; }
NB="$(nbstate)"
[ "$NB" = "A" ] \
  && ok LINE-NOBATCH-TRIGGER "🔴 禁批次那發(shipments_no_batch_update_as)在尖端**存在且 ENABLE ALWAYS** ⇒ 被 DROP 或降級時本格會紅 ✓" \
  || bad LINE-NOBATCH-TRIGGER "實得 [$NB](期望 A)"
# 🔴 `tgenabled` 是 `"char"` 型別,`text || "char"` 的運算子**不唯一** ⇒ 要顯式 `::text`(首跑實錘)。
trgstate() { Q "SELECT pg_catalog.string_agg(t.tgname||':'||t.tgenabled::text, ',' ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.pcm_b2_shipping_idempotency'::pg_catalog.regclass AND NOT t.tgisinternal"; }
TRG="$(trgstate)"
TRG_EXP="pcm_b2_shipping_idem_block_bad_snapshot_insert:A,pcm_b2_shipping_idem_block_delete:A,pcm_b2_shipping_idem_block_identity_update:A,pcm_b2_shipping_idem_block_truncate:A,pcm_b2_shipping_idem_require_complete:A"
case "$TRG" in
  *ERROR*)     bad LINE-IDEM-TRIGGERS "🔴 本格的 SQL 自己寫壞了(非 trigger 問題):$TRG" ;;
  "$TRG_EXP")  ok  LINE-IDEM-TRIGGERS "鍵表五發 trigger 逐字 + 全部 ENABLE ALWAYS ✓" ;;
  *)           bad LINE-IDEM-TRIGGERS "實得 [$TRG]" ;;
esac

echo "══ 2. 端到端:一個員工從頭做到尾(全程只走 RPC)═══════════"
# 🔴 **不直寫任何一張業務表** —— 各片的 harness 為了構造負測會直寫,本檔刻意不;
#    它要回答的是「這條線串起來真的走得通嗎」。
CUST='11111111-1111-1111-1111-111111111111'
ORD='aaaaaaaa-0000-0000-0000-000000000001'
SNAP='{"name":"王大明","phone":"0900000000","line":"L1"}'
PSNAP='{"title":"零件","sku":"S1","spec":{"color":"black"}}'
Q "INSERT INTO auth.users(id,email) VALUES('$CUST','w5@test.local')" >/dev/null
Q "INSERT INTO public.customers(user_id,email) VALUES('$CUST','w5@test.local')" >/dev/null
Q "INSERT INTO public.orders(id,display_id,customer_user_id,shipping_address_snapshot,tier_at_checkout,subtotal,shipping_fee,total,shipping_method,invoice,shipping_method_at_checkout) VALUES('$ORD','4TFBFH','$CUST','$SNAP'::jsonb,(SELECT enumlabel::text::public.member_tier FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='member_tier' LIMIT 1),100,0,100,'home','{\"type\":\"personal\"}'::jsonb,'home')" >/dev/null
[ "$(Q "SELECT pg_catalog.count(*)::text FROM public.orders WHERE id='$ORD'")" = "1" ] || die "FIXTURE_FAIL(orders)"
SUPP="$(Q "INSERT INTO public.suppliers(label) VALUES('線級測試供應商') RETURNING id")"
case "$SUPP" in ????????-*) : ;; *) die "FIXTURE_FAIL(suppliers): $SUPP" ;; esac
OI1='bbbbbbbb-0000-0000-0000-000000000001'
OI2='bbbbbbbb-0000-0000-0000-000000000002'
for pair in "$OI1|SKU-1|4" "$OI2|SKU-2|3"; do
  OI="${pair%%|*}"; R="${pair#*|}"; SKU="${R%%|*}"; QTY="${R#*|}"
  Q "INSERT INTO public.order_items(id,order_id,variant_sku,product_snapshot,quantity,unit_price,line_total) VALUES('$OI','$ORD','$SKU','$PSNAP'::jsonb,10,10,100)" >/dev/null
  PID="$(Q "INSERT INTO public.order_item_procurement(order_item_id,allocated_quantity,supplier_id) VALUES('$OI',10,'$SUPP') RETURNING id")"
  case "$PID" in ????????-*) : ;; *) die "FIXTURE_FAIL(procurement $OI): $PID" ;; esac
  Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) VALUES('$PID',$QTY,now(),'tester')" >/dev/null
  N="$(Q "SELECT coalesce(pg_catalog.max(instock_quantity)::text,'(無列)') FROM public.order_item_quantity_summary WHERE order_item_id='$OI'")"
  [ "$N" = "$QTY" ] || die "FIXTURE_FAIL(instock $OI): 實得 [$N] 期望 [$QTY]"
done

R="$(QM "SELECT public.admin_create_shipment('e2e-1','$CUST','$SNAP'::jsonb,'hct')" | tr '\n' ' ')"
case "$R" in *ERROR*) bad E2E-CREATE "建箱失敗:$R"; SHIP="" ;; *) SHIP="$(Q "SELECT ('$R'::jsonb ->> 'shipment_id')")"; ok E2E-CREATE "①建箱成功 ✓" ;; esac
if [ -z "$SHIP" ]; then
  bad E2E-ADD "🔴 前一步沒成立 ⇒ 這不是掛品項的結論"
  bad E2E-SHIP "🔴 前一步沒成立 ⇒ 這不是出貨的結論"
  bad E2E-SUMMARY "🔴 前一步沒成立 ⇒ 這不是摘要的結論"
else
  # 🔴 跨模型審查 F3:原本兩個品項都**掛滿**(4=instock、3=instock)⇒ 下面的 `4/3` 分不出
  #    「重算讀的是 shipment_items」還是「誤讀 instock」。⇒ 改成**部分出貨**(OI1 掛 3、instock 4),
  #    讓 shipped(3)≠ instock(4)≠ 訂購量(10),三個數字互相分得開。
  R="$(QM "SELECT public.admin_add_shipment_items('e2e-2','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":3},{\"order_item_id\":\"$OI2\",\"quantity\":3}]'::jsonb)" | tr '\n' ' ')"
  case "$R" in *ERROR*) bad E2E-ADD "掛品項失敗:$R" ;; *) ok E2E-ADD "②掛兩個品項(一個部分、一個掛滿)成功 ✓" ;; esac
  # 🔴 F3/F4:W4-2 的 23505 轉譯在**尖端**是否還在。w4b 只證了「它自己的前綴」那一刻;
  #    下一片落檔後 w4b 的前綴就 < 尖端 ⇒ 沒有這一格的話,薄封裝被誰蓋掉不會有人紅。
  C="$(cap "public.admin_add_shipment_items('e2e-2b','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
  [ "$C" = "P2B29|pcm_b2_w4b_translated" ] \
    && ok LINE-23505-TRANSLATED "🔴 同箱補掛在**尖端**仍被轉譯成 P2B29(W4-2 的薄封裝沒被後面的片蓋掉)✓" \
    || bad LINE-23505-TRANSLATED "實得 [$C](期望 P2B29|pcm_b2_w4b_translated)"
  R="$(QM "SELECT public.admin_mark_shipment_shipped('e2e-3','$SHIP','TRACK-E2E')" | tr '\n' ' ')"
  case "$R" in *ERROR*) bad E2E-SHIP "出貨失敗:$R" ;; *) ok E2E-SHIP "③出貨成功 ⇒ **一條線從頭到尾走得通**(全程只走 RPC、零直寫)✓" ;; esac
  V="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  # 🔴 W3c-1 落地後補的第五步:作廢 ⇒ 退量。放在 SUMMARY 之後,不影響前面那格量的東西。
  [ "$V" = "${OI1}x3,${OI2}x3" ] && ok E2E-SUMMARY "④摘要重算成 3 / 3:OI1 的 **shipped(3)≠ instock(4)≠ 訂購量(10)** ⇒ 重算讀的真的是 shipment_items,不是別的欄 ✓" || bad E2E-SUMMARY "摘要實得 [$V]"
fi

  # 🔴 F5:本格原本落在 `fi` 之外 ⇒ 前一步失敗時它會紅在「uuid 語法錯」而不是作廢的結論。
  R="$(QM "SELECT public.admin_void_shipment('e2e-4','$SHIP','線級測試:作廢')" | tr '\n' ' ')"
  V2="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  case "$R:$V2" in
    *ERROR*) bad E2E-VOID "作廢失敗:$R" ;;
    *":${OI1}x0,${OI2}x0") ok E2E-VOID "⑤作廢成功且**退量真的發生**(3/3 → 0/0)✓" ;;
    *) bad E2E-VOID "作廢後摘要實得 [$V2](期望全 0)" ;;
  esac
  R="$(QM "SELECT public.admin_unvoid_shipment('e2e-5','$SHIP')" | tr '\n' ' ')"
  V3="$(Q "SELECT pg_catalog.string_agg(order_item_id::text||'x'||shipped_quantity::text, ',' ORDER BY order_item_id) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$OI1','$OI2')")"
  case "$R:$V3" in
    *ERROR*) bad E2E-UNVOID "復原失敗:$R" ;;
    *":${OI1}x3,${OI2}x3") ok E2E-UNVOID "⑥復原成功且**回加真的發生**(0/0 → 3/3)⇒ **五支 writer 串起來的一整條線走得通**(建箱→掛品項→出貨→作廢→復原)✓" ;;
    *) bad E2E-UNVOID "復原後摘要實得 [$V3](期望回到 3/3)" ;;
  esac

echo "══ 3. 🔴 線級不變式(跨片,各片自己看不到的)═══════════════"
# 🔴 冪等鍵表:每個動作各一列、且**全部都有 shipment_id**(DEFERRED 閘的線級後果)
IDEM="$(Q "SELECT pg_catalog.string_agg(action||':'||(shipment_id IS NOT NULL)::text, ',' ORDER BY action) FROM public.pcm_b2_shipping_idempotency")"
[ "$IDEM" = "add_items:true,create_shipment:true,ship:true,unvoid:true,void:true" ] \
  && ok LINE-IDEM-COMPLETE "端到端跑完後,鍵表**五列**全部都有 shipment_id(零半成品)⇒ 五支的回填都真的發生了 ✓" \
  || bad LINE-IDEM-COMPLETE "鍵表實得 [$IDEM]"
# 🔴 三支的回傳信封形狀一致(W2 的 R1-F4 契約在**線級**成立)
SHAPES="$(Q "SELECT pg_catalog.count(DISTINCT k)::text FROM (SELECT pg_catalog.string_agg(key,',' ORDER BY key) AS k FROM public.pcm_b2_shipping_idempotency i, pg_catalog.jsonb_object_keys(i.result_snapshot) key GROUP BY i.action) t")"
[ "$SHAPES" = "1" ] && ok LINE-SNAPSHOT-SHAPE "五支寫下的快照**鍵集合完全相同** ⇒ to_jsonb 同源的形狀契約在線級成立(W3-2/W3-3/W3c-1/W3c-2 沒有各自漂)✓" \
                    || bad LINE-SNAPSHOT-SHAPE "快照鍵集合有 $SHAPES 種不同形狀 ⇒ 有片沒照 W3-1 的形狀抄"
# 🔴 重放:三支都再打一次同鍵,產物一律零增長
B4="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")|$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items")"
Q "SELECT public.admin_create_shipment('e2e-1','$CUST','$SNAP'::jsonb,'hct')" >/dev/null 2>&1
Q "SELECT public.admin_add_shipment_items('e2e-2','$SHIP','[{\"order_item_id\":\"$OI1\",\"quantity\":4},{\"order_item_id\":\"$OI2\",\"quantity\":3}]'::jsonb)" >/dev/null 2>&1
Q "SELECT public.admin_mark_shipment_shipped('e2e-3','$SHIP','TRACK-E2E')" >/dev/null 2>&1
AF="$(Q "SELECT pg_catalog.count(*)::text FROM public.shipments")|$(Q "SELECT pg_catalog.count(*)::text FROM public.shipment_items")"
[ "$B4" = "$AF" ] && ok LINE-REPLAY-NO-GROWTH "🔴 五支(建箱/掛品項/出貨/作廢/復原)各再打一次同鍵 ⇒ 包裹數與品項數**零增長**($AF)= 這條線的 at-most-once 在端到端成立 ✓" \
                  || bad LINE-REPLAY-NO-GROWTH "🔴 重放後產物長大了:$B4 → $AF"

echo "══ 4. 🔴 突變靶 ═══════════════════════════════════════════"
# ① 結構 oracle 族:多長一支同名族的函式 ⇒ 集合格必須紅
Q "CREATE FUNCTION public.admin_bogus_shipment_x() RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
M="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin\_%shipment%'")"
[ "$M" != "$FIVE" ] && ok TMUT-RPC-SET "🔴 多長一支 ⇒ RPC 集合真的變了 = LINE-RPC-SET 抓得到「多一支」" || bad TMUT-RPC-SET "集合沒變 ⇒ 恆真"
Q "DROP FUNCTION public.admin_bogus_shipment_x()" >/dev/null
# ② trigger 啟用態族:把一發改成 ORIGIN ⇒ 凍結格必須紅
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE REPLICA TRIGGER pcm_b2_shipping_idem_block_delete" >/dev/null
M="$(trgstate)"
[ "$M" != "$TRG_EXP" ] && ok TMUT-TRIGGER-STATE "🔴 把一發 trigger 改成 REPLICA ⇒ 啟用態真的變了 = LINE-IDEM-TRIGGERS 抓得到「被降級」" || bad TMUT-TRIGGER-STATE "啟用態沒變 ⇒ 恆真"
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_delete" >/dev/null
# ③ helper ACL 族:**逐支**打(家族格的靶不得只打一個成員)
ABAD=""
for fn in $(printf '%s' "$HELPERS_EXP" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  # 🔴 例外那兩支基準就是 4(anon 已在內)⇒ 對它們改用 `REVOKE 一個角色`當突變,方向相反、一樣翻面。
  case " $ACL_EXEMPT " in
    *" $fn "*)
      Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
      G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
      [ "$G" = "3" ] || ABAD="$ABAD $fn(REVOKE 後應為 3,實得 $G)"
      Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null ;;
    *)
      Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
      G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
      [ "$G" = "1" ] || ABAD="$ABAD $fn($G)"
      Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null ;;
  esac
done
[ -z "$ABAD" ] && ok TMUT-HELPER-ACL "🔴 **十支逐一** GRANT ⇒ 每支的觀察值都翻面 = 零 GRANT 那族整族有判別力" || bad TMUT-HELPER-ACL "有成員不敏感:$ABAD"
# ③-b 🔴 W4-2 兩個新不變量的靶(F3 同批補;沒有靶的話上面兩格只是「看起來有守」)
Q "ALTER TABLE public.shipments ENABLE REPLICA TRIGGER shipments_no_batch_update_as" >/dev/null
M="$(nbstate)"
[ "$M" != "A" ] && ok TMUT-NOBATCH-TRIGGER "🔴 把禁批次那發降成 REPLICA ⇒ 啟用態真的變了(實得 [$M])= LINE-NOBATCH-TRIGGER 抓得到「被降級」" || bad TMUT-NOBATCH-TRIGGER "降級後啟用態沒變 ⇒ 該格恆真"
Q "ALTER TABLE public.shipments ENABLE ALWAYS TRIGGER shipments_no_batch_update_as" >/dev/null
# 🔴 **草稿箱**(E2E 那個已出貨,補掛會先撞 frozen_after_ship、走不到 23505)。本段必須排在 ④ 之前:
#    ④ 會把 admin_create_shipment 換成回空信封的殘廢版,之後就建不出箱子了。
MBOX="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mut-2a','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
case "$MBOX" in ????????-*) : ;; *) die "MUT_FIXTURE_FAIL(mbox): $MBOX" ;; esac
Q "SELECT public.admin_add_shipment_items('mut-2b','$MBOX','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)" >/dev/null
# 🔴 **首跑實錘**:直接打同一箱同一品項,紅的是 **P2B27(超過到貨量)** 不是 23505 ——
#    OI1 的 instock=4、E2E 已出 3、草稿箱又佔 1 ⇒ 可用量 0,**前緣先擋、根本走不到 UNIQUE**。
#    ⇒ 突變要打的那條路必須先通:補一筆到貨讓 instock 到 10,可用量才夠。
#    (這正是判準四句第三條:「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論。)
Q "INSERT INTO public.order_item_procurement_receipts(procurement_id,quantity,received_at,received_by) SELECT id,6,now(),'mut' FROM public.order_item_procurement WHERE order_item_id='$OI1'" >/dev/null
# 🔴 把薄封裝換成「沒有 handler 的封裝」⇒ 轉譯格必須翻回 raw 23505(形狀照 ④ TMUT-E2E)
Q "CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN public.pcm_b2_add_items_impl(p_idempotency_key, p_shipment_id, p_items); END \$m\$" >/dev/null
M="$(cap "public.admin_add_shipment_items('mut-2c','$MBOX','[{\"order_item_id\":\"$OI1\",\"quantity\":1}]'::jsonb)")"
case "$M" in
  23505*) ok TMUT-23505-TRANSLATED "🔴 拿掉薄封裝的 handler ⇒ 同箱補掛**又變回 raw 23505**(實得 [$M])= LINE-23505-TRANSLATED 有判別力" ;;
  *)      bad TMUT-23505-TRANSLATED "拿掉 handler 後實得 [$M] ⇒ 那格守的不是這段" ;;
esac
# 🔴 helper ACL 那兩支同樣逐支打(家族格的靶不得只打一個成員)
WMBAD=""
for fn in $(printf '%s' "$W4B_FN" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
  G="$(Q "SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='$fn' AND a.grantee <> p.proowner")"
  [ "$G" = "1" ] || WMBAD="$WMBAD $fn($G)"
  Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
done
# 🔴 **此後 `admin_add_shipment_items` 是殘廢版(無 handler)**,與 ④ 之後的 `admin_create_shipment` 同樣單向不還原。
#    現行後續格只讀 ACL / regprocedure,不受影響;**再往後加格的人請先還原或另建 fixture**。
[ -z "$WMBAD" ] && ok TMUT-W4B-HELPERS "🔴 **兩支逐一** GRANT ⇒ 觀察值都翻面 = LINE-W4B-HELPERS 有判別力" || bad TMUT-W4B-HELPERS "有成員不敏感:$WMBAD"

# ④ 端到端族:把建箱換成靜默回傳 ⇒ E2E 那族必須看得出來
Q "CREATE OR REPLACE FUNCTION public.admin_create_shipment(p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN '{}'::jsonb; END \$m\$" >/dev/null
M="$(Q "SELECT ('$(Q "SELECT public.admin_create_shipment('mut-1','$CUST','$SNAP'::jsonb,'hct')")'::jsonb ->> 'shipment_id')")"
[ -z "$M" ] && ok TMUT-E2E "🔴 把建箱換成靜默回空信封 ⇒ 拿不到 shipment_id(E2E-CREATE 的「前一步沒成立」分支會接手)= 端到端那族不會把失敗讀成成功" \
            || bad TMUT-E2E "換成空信封後仍拿到 [$M] ⇒ E2E 族量錯東西"

# ⑤ 🔴 跨模型審查 F2:`LINE-RPC-ACL` 原本**零靶** ⇒ 逐五支打(家族格的靶不得只打一個成員)
RBAD=""
for fn in $(printf '%s' "$FIVE" | tr ',' ' '); do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  Q "GRANT EXECUTE ON FUNCTION $SIG TO anon" >/dev/null
  V="$(Q "SELECT has_function_privilege('anon','$SIG','EXECUTE')::text")"
  [ "$V" = "true" ] || RBAD="$RBAD $fn($V)"
  Q "REVOKE ALL ON FUNCTION $SIG FROM anon" >/dev/null
done
[ -z "$RBAD" ] && ok TMUT-RPC-ACL "🔴 **五支逐一** GRANT 給 anon ⇒ 每支的觀察值都翻面 = LINE-RPC-ACL 整族有判別力" || bad TMUT-RPC-ACL "有成員不敏感:$RBAD"
# ⑥ 🔴 F2:第 3 節的線級不變式原本整族零靶 ⇒ 補兩發(各自只動自己那一格要看的東西)
# 🔴🔴 **R2 抓到的恆真(本片自己造的)**:③-b 為了構造 23505 建了 `mut-2a` / `mut-2b` 兩把鍵,
#    它們成功後各寫一列進鍵表 ⇒ 到這裡鍵表是**七列、action 重複**,`M` 在突變**還沒生效前**就已 ≠ 五列基準
#    ⇒ 下面兩格雙雙**恆真**(綠不反證)。這正是 12 行前那段註解記過的坑再犯一次,這次來源是 fixture 不是期望值。
#    ⇒ 兩格的觀察範圍一律收成 `idempotency_key LIKE 'e2e-%'`(只看端到端那五把鍵),與突變段的 fixture 隔離。
Q "ALTER TABLE public.pcm_b2_shipping_idempotency DISABLE TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null
Q "UPDATE public.pcm_b2_shipping_idempotency SET shipment_id = NULL WHERE action='ship' AND idempotency_key LIKE 'e2e-%'" >/dev/null
M="$(Q "SELECT pg_catalog.string_agg(action||':'||(shipment_id IS NOT NULL)::text, ',' ORDER BY action) FROM public.pcm_b2_shipping_idempotency WHERE idempotency_key LIKE 'e2e-%'")"
# 🔴🔴 **跨模型審查 F1**:我把 `LINE-IDEM-COMPLETE` 的期望值從三列改成四列,
#    **卻沒改它配對的這個靶** ⇒ 基準字串還是舊三列,而鍵表現在恆有四列
#    ⇒ `M != 舊三列` **恆真**,突變就算完全沒生效本格照樣綠 = 判別力歸零。
#    改斷言就要改它的靶,這兩個是一對。
[ "$M" != "add_items:true,create_shipment:true,ship:true,unvoid:true,void:true" ] \
  && ok TMUT-IDEM-COMPLETE "🔴 把一列的 shipment_id 打回 NULL ⇒ 觀察值真的變了(實得 [$M])= LINE-IDEM-COMPLETE 抓得到半成品" \
  || bad TMUT-IDEM-COMPLETE "打回 NULL 後觀察值沒變 ⇒ 該格恆真"
Q "UPDATE public.pcm_b2_shipping_idempotency SET result_snapshot = '{\"only_one_key\":1}'::jsonb WHERE action='ship' AND idempotency_key LIKE 'e2e-%'" >/dev/null
M="$(Q "SELECT pg_catalog.count(DISTINCT k)::text FROM (SELECT pg_catalog.string_agg(key,',' ORDER BY key) AS k FROM public.pcm_b2_shipping_idempotency i, pg_catalog.jsonb_object_keys(i.result_snapshot) key WHERE i.idempotency_key LIKE 'e2e-%' GROUP BY i.action) t")"
[ "$M" != "1" ] \
  && ok TMUT-SNAPSHOT-SHAPE "🔴 把一支的快照改成別的鍵集合 ⇒ 形狀種類數變成 $M = LINE-SNAPSHOT-SHAPE 抓得到「有片自己漂了」" \
  || bad TMUT-SNAPSHOT-SHAPE "改了鍵集合之後種類數仍是 1 ⇒ 該格恆真"
# 🔴 `LINE-REPLAY-NO-GROWTH` **沒有靶,而且我窮舉過維度才這樣寫**(不是懶):
#    要讓它翻面得讓「同鍵重放真的長出產物」,而擋住那件事的**不只冪等層** ——
#    ①claim 回 NULL ⇒ record() 撞 W0b 的 freeze_identity(改指別箱)整筆回滾
#    ②連 freeze 一起拆 ⇒ add_items 撞 S1b 的 UNIQUE(同箱同品項)整筆回滾
#    ③再拆 UNIQUE ⇒ 拆到這一步,被測的已經不是這條線了
#    ⇒ 它是**被多層嚴格蘊含**的格(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
#    誠實結論:它證的是「端到端的 at-most-once 成立」這個**結果**,不獨占任何一層的歸屬。
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_identity_update" >/dev/null

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
KEYS_FROZEN="E2E-ADD E2E-CREATE E2E-SHIP E2E-SUMMARY E2E-UNVOID E2E-VOID LINE-23505-TRANSLATED LINE-HELPER-ACL LINE-HELPER-SET LINE-IDEM-COMPLETE LINE-IDEM-TRIGGERS LINE-NOBATCH-TRIGGER LINE-REPLAY LINE-REPLAY-NO-GROWTH LINE-RPC-ACL LINE-RPC-SET LINE-SNAPSHOT-SHAPE LINE-W4B-HELPERS TMUT-23505-TRANSLATED TMUT-E2E TMUT-HELPER-ACL TMUT-IDEM-COMPLETE TMUT-NOBATCH-TRIGGER TMUT-RPC-ACL TMUT-RPC-SET TMUT-SNAPSHOT-SHAPE TMUT-TRIGGER-STATE TMUT-W4B-HELPERS"
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
