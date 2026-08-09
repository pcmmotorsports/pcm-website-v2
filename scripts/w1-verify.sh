#!/usr/bin/env bash
#
# W1 驗收 harness —— 五支出貨 writer RPC 骨架 + ACL + 產號器
#
# 用法:scripts/w1-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅。
# 真權威:docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md(v4.2 定稿)§2 W1 列 / §1d
# 被測物:supabase/migrations/20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql(**實檔,非內嵌副本**)
#
# ══ 判準三句(承自 scripts/w0b-verify.sh,後人補格照抄)══════════════
#   🔴 **消融必須由紅轉綠,否則判別力歸屬錯。**
#   🔴 **全綠的消融也可能恆真,隔離守門自己要有靶。**
#   🔴 **「我的 SQL 寫壞了」不得與「被別的守門擋住」共用同一句結論**(W0b code review 實錘)。
#
# ══ boolean 寫法 ═══════════════════════════════════════════════
#   🔴 psql `-qtA` 下 `bool::text` 印 `true`/`false`,裸 boolean 印 `t`/`f`。
#      本檔**一律裸 boolean、期望 t/f**;需 `||` 串接的格顯式 `::text` 並期望 true/false。
#      (memory `reference_psql-ta-boolean-cast-renders-true-not-t`)
#
# 🔴 本檔跑在**裸 PG,不是 Supabase** ⇒ ACL 格證不了正式站的最終權限
#    (只有 apply 後在 A 庫驗才消)。但**有** Supabase default privileges shim,
#    否則 ACL 格會恆真(W0b 對抗審查 F7 實錘)。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# 🔴 code review F9:首版路徑與埠全寫死 ⇒ 夜跑多視窗並行會互相 `rm -rf` 資料目錄。
#    改成可覆寫,預設值不變(單窗行為一致)。
D="${W1DB:-/tmp/w1db}"; SOCK="${W1SOCK:-/tmp/w1sk}"; P="${W1PORT:-54375}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=51
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-30s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-30s %s\n' "$1" "$2"; }

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
Q()  { psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QM() { psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }

W1MIG="${W1MIG:-$REPO/supabase/migrations/20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql}"
[ -f "$W1MIG" ] || { echo "W1_MIG_MISSING: $W1MIG"; exit 1; }

# ── 依賴:Supabase shim(角色 + extensions/pgcrypto)+ N3a 產號器 ──
# 🔴 shim **從 repo 實檔載入、不手抄**;N3a 是本片的產號來源(plan §7 F2 裁定重用)。
psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$REPO/scripts/d1-supabase-shim.sql" >/dev/null 2>&1
N3A="$REPO/supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql"
[ -f "$N3A" ] || { echo "N3A_MISSING: $N3A"; exit 1; }
N3AOUT="$(psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$N3A" 2>&1)"
case "$N3AOUT" in *ERROR*) echo "N3A_REPLAY_FAIL: $N3AOUT"; exit 1 ;; esac
# 🔴 default privileges 必須在 W1 的 migration **之前**就位,否則 ACL 格恆真(W0b F7 實錘)。
#    shim 已含那三行(`d1-supabase-shim.sql:50-52`)也已建 `authenticator`(:25)。
#    🔴 **這裡不做驗證** —— 真正驗 default privileges 有沒有生效的是後面的
#    `ACL-CONTROL-HAS-PRIV` 格(建一張未 REVOKE 的函式、要求它是 `t`)。
#    (首版把「此處只驗它真的生效」寫在一行 no-op 的 CREATE ROLE 旁邊,code review F2 指出字面貼錯位置。)

echo "══ 0. DDL 語法(被測物 = migration 實檔) ══════════════════"
OUT="$(psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$W1MIG" 2>&1)"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "migration 跑不起來:$OUT"; exit 1 ;;   # 🔴 收尾交給 trap teardown(原本這裡是無條件 rm -rf = fail-open)
  # 🔴 code review F1/F3:首版訊息寫「1 helper」(產號器被刪後沒跟著改,實為 0)
  #    與寫死的「PG 17」(從不查 server_version,換機即成假宣稱)。兩處都改成**量出來的**。
  *) ok DDL-SYNTAX "migration 實檔在 PG $(Q "SHOW server_version") 實跑成功(0 helper + 5 骨架 + ACL + 權限矩陣斷言)" ;;
esac

FIVE="admin_create_shipment admin_add_shipment_items admin_mark_shipment_shipped admin_void_shipment admin_unvoid_shipment"

echo "══ 1. 五支存在 + 屬性四項逐支量 ═══════════════════════════"
# 🔴 逐支量、不數總數:「函式數 = 5」對「其中一支屬性錯」全盲(W0b C3 同族)。
for fn in $FIVE; do
  V="$(Q "SELECT prosecdef::text||'|'||pg_catalog.array_to_string(proconfig,',')||'|'||prorettype::regtype::text FROM pg_proc WHERE proname='$fn'")"
  # 🔴 期望值是**量出來的**,不是我照 DDL 猜的:`proconfig` 存的是 `search_path=""`(帶引號),
  #    首跑我寫成 `search_path=` 而五格全紅 —— 字面值三來源律,期望值也適用。
  [ "$V" = 'true|search_path="",lock_timeout=5s|jsonb' ] \
    && ok "W1-PROPS-$fn" "SECDEF + search_path='' + lock_timeout=5s + RETURNS jsonb ✓" \
    || bad "W1-PROPS-$fn" "屬性不符:[$V]"
done

echo "══ 1b. 🔴 F4:**簽章**逐支凍結(本片自陳交付「最終簽章」)═══"
# 🔴 首版一格都沒量簽章 —— 把 `p_items` 改名 `p_payload` 仍 33/0(對抗審查實測)。
#    PostgREST 走**具名參數**,這正是 a9h 事故(PGRST202、正式站壞 8 小時)的形狀。
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
  A="$(Q "SELECT pg_catalog.pg_get_function_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")"
  E="$(sig_expect "$fn")"
  [ "$A" = "$E" ] && ok "W1-SIG-$fn" "簽章逐字凍結(參數名 + 型別 + 預設值)✓" \
                  || bad "W1-SIG-$fn" "簽章漂了:[$A] 期望 [$E]"
done

echo "══ 1c. 🔴 F2:錯誤碼 + CONSTRAINT 名逐支斷言(不是比訊息子字串)══"
# 🔴 首版只比訊息子字串 ⇒ 把 P2B20/P2B02 全改 P0001、constraint 名改 bogus 仍 33/0(實測)。
#    W2/W3 要靠這兩碼分派,漂了無人紅。
cap() {  # $1=呼叫式 → 印 "SQLSTATE|CONSTRAINT"
  psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "DO \$\$ DECLARE c text; n text; BEGIN BEGIN PERFORM public.$1; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE, n = CONSTRAINT_NAME; RAISE NOTICE 'CAP|%|%', c, coalesce(n,'(null)'); END; END \$\$;" 2>&1 \
    | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n'
}
for pair in "admin_create_shipment('k',gen_random_uuid(),'{}'::jsonb,'hct')" \
            "admin_add_shipment_items('k',gen_random_uuid(),'[]'::jsonb)" \
            "admin_mark_shipment_shipped('k',gen_random_uuid())" \
            "admin_void_shipment('k',gen_random_uuid(),'r')" \
            "admin_unvoid_shipment('k',gen_random_uuid())"; do
  NM="${pair%%(*}"
  C="$(cap "$pair")"
  [ "$C" = "P2B20|pcm_b2_w1_not_implemented" ] \
    && ok "W1-ERRCODE-$NM" "SQLSTATE=P2B20 + CONSTRAINT=pcm_b2_w1_not_implemented 逐字 ✓" \
    || bad "W1-ERRCODE-$NM" "碼/名漂了:[$C]"
done

echo "══ 2. ACL:五支只有 service_role 可 EXECUTE ════════════════"
# 🔴 F7 對照組:同一庫建一支**完全沒 REVOKE** 的函式。有 default privileges 時它必須是 t;
#    若也是 f,代表下面每一格恆真、判別力來自環境而非 REVOKE。
Q "CREATE FUNCTION public.acl_ctl_no_revoke() RETURNS int LANGUAGE sql AS 'SELECT 1';" >/dev/null
# 🔴 code review F8:首版只對 `anon` 建對照組,訊息卻宣稱「下面的綠來自 REVOKE」,而下面每格量**四個**角色。
#    ⇒ 對照組也量四個。`authenticator` 的預設 EXECUTE 來自 **PUBLIC**(shim 的 default privileges 只給
#    anon/authenticated/service_role)—— 兩條來源都要被對照組涵蓋,結論才是這格證的。
CTL="$(Q "SELECT has_function_privilege('anon','public.acl_ctl_no_revoke()','EXECUTE')::text||'|'||has_function_privilege('authenticated','public.acl_ctl_no_revoke()','EXECUTE')::text||'|'||has_function_privilege('authenticator','public.acl_ctl_no_revoke()','EXECUTE')::text||'|'||has_function_privilege('service_role','public.acl_ctl_no_revoke()','EXECUTE')::text")"
[ "$CTL" = "true|true|true|true" ] \
  && ok ACL-CONTROL-HAS-PRIV "對照組(未 REVOKE 的函式)四個角色全 true ⇒ 下面每格的綠都來自 REVOKE,不是環境" \
  || bad ACL-CONTROL-HAS-PRIV "🔴 對照組是 [$CTL](期望全 true)⇒ ACL 有軸恆真(W0b F7 同族復發)"
for fn in $FIVE; do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.proname='$fn'")"
  V="$(Q "SELECT has_function_privilege('anon','$SIG','EXECUTE')::text||'|'||has_function_privilege('authenticated','$SIG','EXECUTE')::text||'|'||has_function_privilege('authenticator','$SIG','EXECUTE')::text||'|'||has_function_privilege('service_role','$SIG','EXECUTE')::text")"
  [ "$V" = "false|false|false|true" ] \
    && ok "W1-ACL-$fn" "anon/authenticated/authenticator=false、service_role=true ✓" \
    || bad "W1-ACL-$fn" "ACL 不符:[$V](期望 false|false|false|true)"
done
# 🔴 集合比對(W0b n-1:點名格只驗你點到的名字,第五個意外角色只有集合比對抓得到)。
#    **不得 join pg_roles** —— 它會靜默丟掉 PUBLIC(grantee=0)那列(已實測)。
for fn in $FIVE; do
  SIG="$(Q "SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.proname='$fn'")"
  G="$(Q "SELECT coalesce(pg_catalog.string_agg(DISTINCT a.grantee::text, ',' ORDER BY a.grantee::text),'(空)') FROM pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.oid='$SIG'::regprocedure AND a.grantee <> p.proowner")"
  SR="$(Q "SELECT oid::text FROM pg_roles WHERE rolname='service_role'")"
  # 🔴 **「我的 SQL 寫壞了」不得與「真的多一個角色」共用同一句結論**
  #    —— 這族 W0b code review 才剛教過(abl 的 conname),本檔首跑又犯:
  #    `pg_catalog.coalesce` 不存在,而本格當時印的是「有第五個角色拿到 EXECUTE」。
  case "$G" in
    # 🔴 code review F10:這個 `-SQL` 格名不在 KEYS_FROZEN ⇒ 一旦觸發會**同時**讓 CELL-KEYSET
    #    報「格名漂了」,兩個訊號混在一起。改成沿用同一格名、只換訊息,讓凍結清單維持穩定。
    *ERROR*) bad "W1-ACLSET-$fn" "🔴 本格的 SQL 自己寫壞了(非權限問題):$G" ;;
    "$SR")   ok  "W1-ACLSET-$fn" "非 owner grantee 集合 = {service_role} 逐字相符(含 grantee 0 面)✓" ;;
    "(空)")  bad "W1-ACLSET-$fn" "grantee 集合是**空的** ⇒ service_role 的 GRANT 不見了(不是「多一個角色」)" ;;
    *)       bad "W1-ACLSET-$fn" "grantee 集合 [$G] != {service_role}=[$SR] ⇒ 有非預期角色拿到 EXECUTE" ;;
  esac
done

echo "══ 3. 🔴 骨架 fail-closed:任何呼叫必拋 P2B20,零靜默成功 ══"
CALLS="admin_create_shipment('k',gen_random_uuid(),'{}'::jsonb,'hct')
admin_add_shipment_items('k',gen_random_uuid(),'[]'::jsonb)
admin_mark_shipment_shipped('k',gen_random_uuid())
admin_void_shipment('k',gen_random_uuid(),'r')
admin_unvoid_shipment('k',gen_random_uuid())"
echo "$CALLS" | while read -r c; do
  [ -z "$c" ] && continue
  NM="${c%%(*}"
  R="$(QM "SELECT public.$c;")"
  case "$R" in
    *"W1 骨架,業務層尚未實作"*) printf '  PASS %-30s %s\n' "W1-FAILCLOSED-$NM" "呼叫必拋未實作(P2B20)、無靜默成功 ✓" ;;
    *) printf '  FAIL %-30s %s\n' "W1-FAILCLOSED-$NM" "未拋未實作:${R:-（零錯誤=靜默成功!)}" ;;
  esac
done > "$D.failclosed"
cat "$D.failclosed"
FC_PASS="$(grep -c '^  PASS' "$D.failclosed")"; FC_FAIL="$(grep -c '^  FAIL' "$D.failclosed")"
PASS=$((PASS+FC_PASS)); FAIL=$((FAIL+FC_FAIL))
# 🔴 code review F7:首版**無條件**補這五個格名 ⇒ 該族整段沒產出時 CELL-KEYSET 照樣綠。
#    改成按實際產出的行數補,並要求恰為 5 行(那一族跑在 subshell,計數只能從檔案回讀)。
FC_TOT=$((FC_PASS+FC_FAIL))
if [ "$FC_TOT" = "5" ]; then
  for fn in $FIVE; do KEYS="$KEYS W1-FAILCLOSED-$fn"; done
else
  bad "W1-FAILCLOSED-COUNT" "🔴 fail-closed 那族只產出 $FC_TOT 行(期望 5)⇒ 該族有格沒跑到"
fi
rm -f "$D.failclosed"

echo "══ 4. 🔴 隔離閘現在就有可觀察行為(不是等 W3 才生效的死條文)══"
# RR 下必須紅在 P2B02、RC 下才輪到 P2B20 —— 兩個都要,否則分不出「閘生效」與「反正都會拋」。
# 🔴 F3:首版只打一支,而檔頭寫「每支都有」⇒ 拿掉別支的閘仍 33/0(實測)。改逐支。
#    每支都要 RR/RC 兩面:只有 RR 那面 = 分不出「閘生效」與「反正都拋」。
for pair in "admin_create_shipment('k',gen_random_uuid(),'{}'::jsonb,'hct')" \
            "admin_add_shipment_items('k',gen_random_uuid(),'[]'::jsonb)" \
            "admin_mark_shipment_shipped('k',gen_random_uuid())" \
            "admin_void_shipment('k',gen_random_uuid(),'r')" \
            "admin_unvoid_shipment('k',gen_random_uuid())"; do
  NM="${pair%%(*}"
  RRC="$(psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "BEGIN ISOLATION LEVEL REPEATABLE READ; DO \$\$ DECLARE c text; BEGIN BEGIN PERFORM public.$pair; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE; RAISE NOTICE 'CAP|%', c; END; END \$\$; ROLLBACK;" 2>&1 | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n')"
  [ "$RRC" = "P2B02" ] && ok "W1-ISO-$NM" "RR 下紅在隔離閘 P2B02(RC 下為 P2B20,見 W1-ERRCODE-*)⇒ 閘有判別力 ✓" \
                       || bad "W1-ISO-$NM" "RR 下的 SQLSTATE 是 [$RRC],不是 P2B02 ⇒ 該支沒有隔離閘"
done

echo "══ 5. 🔴 動作名對應:五支函式 ↔ W0b 鍵表的五個 action 值 ═══"
# 兩份字面同源與否,靠這格釘住(plan §1c-1 W-c)。
# 🔴 F5:首版是 10 條獨立**存在性 grep** ⇒ 恆真。實測:把某支改名後,`grep -q` 仍命中註解與
#    RAISE 訊息;在 W0b 副本多塞一個 'BOGUS_ACTION' 也照樣綠。它**沒有驗任何「對應」**,也不驗「恰五個」。
#    改法=兩邊都**抽出集合**再比:函式名取自 DB(不是 grep 檔),action 值取自 W0b 的 CHECK 字面。
FN_SET="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%shipment%'")"
W0BMIG="$REPO/supabase/migrations/20260807140000_m4b_e10_b2_w0b_shipping_idempotency.sql"
# 🔴 `.*` 是貪婪的,尾端那個 `)` 會被吃進來(首跑實得 `…,unvoid),void`)⇒ 用非貪婪等價寫法:
#    先切出括號內容,再逐項去引號。抽取結果本身由下一格的集合比對驗,抽壞了會紅、不會靜默。
AC_SET="$(sed -n "s/.*action IN (\([^)]*\)).*/\1/p" "$W0BMIG" | tr -d "'" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sort | tr '\n' ',' | sed 's/,$//')"
EXP_FN="admin_add_shipment_items,admin_create_shipment,admin_mark_shipment_shipped,admin_unvoid_shipment,admin_void_shipment"
EXP_AC="add_items,create_shipment,ship,unvoid,void"
# 🔴 F12(consider):五支帶 DEFAULT 參數 ⇒ W3 若加/改參數,`CREATE OR REPLACE` 會變成
#    **新 overload**,舊 signature 連同它的 `GRANT … TO service_role` 留著、成為活著的舊入口。
#    ⇒ 這格要求**每個 proname 恰好一個 oid**;多一個 overload 立刻紅。
OVER="$(Q "SELECT coalesce(pg_catalog.string_agg(x.proname||'x'||x.n, ',' ORDER BY x.proname),'(空)') FROM (SELECT p.proname, pg_catalog.count(*) AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname LIKE 'admin_%shipment%' GROUP BY p.proname HAVING pg_catalog.count(*) > 1) x")"
[ "$OVER" = "(空)" ] && ok W1-NO-OVERLOAD "五支各自只有一個 signature(無 overload 遺留)✓" \
                    || bad W1-NO-OVERLOAD "🔴 有 overload:[$OVER] ⇒ 舊入口連同舊 GRANT 還活著"
[ "$FN_SET" = "$EXP_FN" ] && ok W1-FN-SET "DB 裡的出貨 RPC 集合**恰為**那五支(多一支少一支都紅)✓" \
                         || bad W1-FN-SET "函式集合 [$FN_SET] != 期望 [$EXP_FN]"
[ "$AC_SET" = "$EXP_AC" ] && ok W1-ACTION-SET "W0b 的 action CHECK **恰為**那五個值(從 CHECK 字面抽,非 grep 存在性)✓" \
                          || bad W1-ACTION-SET "action 集合 [$AC_SET] != 期望 [$EXP_AC]"

echo "══ 5b. 🔴 產號來源 vs shipments 格式(正規式從 s1a1 抽,不手抄)══"
S1A1="$REPO/supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql"
# 🔴 code review F5:這行原本仍是貪婪 `\(.*\)` —— 同檔上面才剛為 AC_SET 記下這個坑卻沒跟著改。
#    CHECK 行若多一個條件,會抽出 `…{6}$' AND shipment_reference <> 'ZZZZZZ`。改 `[^']*`。
RE="$(sed -n "s/.*CHECK (shipment_reference ~ '\([^']*\)').*/\1/p" "$S1A1" | head -1)"
case "$RE" in
  ""|*ERROR*) bad W1-GEN-RE-EXTRACT "🔴 從 s1a1 抽不到 shipment_reference 的正規式(檔改過?)⇒ 下一格量不到東西" ;;
  *) ok W1-GEN-RE-EXTRACT "正規式由 s1a1 實檔抽出:$RE(不手抄 ⇒ 兩邊分岔時本格會紅)" ;;
esac
# 🔴 code review F6:`RE` 若抽成空字串,`!~ ''` 恆 false ⇒ 本格**恆綠**(實測 MISS=0)。
#    ⇒ 先擋掉空字串,不把「抽不到」讀成「全部通過」。
if [ -z "$RE" ]; then
  bad W1-GEN-MATCHES-SHIPMENTS "🔴 RE 為空 ⇒ 本格量不到東西(不是「全部通過」)"
  MISS="-"
else
MISS="$(Q "SELECT pg_catalog.count(*) FROM pg_catalog.generate_series(1,200) WHERE public.pcm_generate_display_id() !~ '$RE'")"
[ "$MISS" = "0" ] && ok W1-GEN-MATCHES-SHIPMENTS "N3a 產的碼 200 連抽全部通過 **s1a1 那條** CHECK ⇒ 跨域格式假設現在被守著 ✓" \
                  || bad W1-GEN-MATCHES-SHIPMENTS "🔴 N3a 有 $MISS 個產出不合 shipments 的格式 ⇒ 兩域已分岔、W3 會在正式站炸"
fi
# 🔴 **誠實邊界(code review 實測)**:本格守得住的是「N3a 漂掉」與「s1a1 收窄」兩個方向;
#    s1a1 若**放寬**(如 `{4,10}`)本格會綠 —— 但那個方向不會讓 W3 的 INSERT 失敗,可接受。
DIST="$(Q "SELECT pg_catalog.count(DISTINCT public.pcm_generate_display_id()) FROM pg_catalog.generate_series(1,200)")"
[ "$DIST" -gt 100 ] && ok W1-GEN-VARIES "200 抽 $DIST 個相異值 ⇒ 不是常數(上一格非恆真)" \
                    || bad W1-GEN-VARIES "200 抽只有 $DIST 個相異 ⇒ 產號近乎常數,格式格恆真"
GACL="$(Q "SELECT coalesce(pg_catalog.string_agg(DISTINCT a.grantee::text, ','),'(空)') FROM pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='pcm_generate_display_id' AND a.grantee <> p.proowner")"
[ "$GACL" = "(空)" ] && ok W1-GEN-ZERO-GRANT "產號器非 owner grantee 集合為空(N3a 的零 GRANT 設計仍成立)✓" \
                     || bad W1-GEN-ZERO-GRANT "🔴 產號器被 GRANT 給 [$GACL] ⇒ 可被取樣、單號可預測性下降"

echo "══ 7. 🔴 突變靶(每一族至少一發,證這些格紅得起來) ═════════"
Q "ALTER FUNCTION public.admin_void_shipment(text, uuid, text) SECURITY INVOKER;" >/dev/null
MV="$(Q "SELECT prosecdef::text FROM pg_proc WHERE proname='admin_void_shipment'")"
[ "$MV" = "false" ] && ok TMUT-PROPS "把一支改成 SECURITY INVOKER ⇒ 屬性格的觀察值真的變了(false)= 該族有判別力" \
                    || bad TMUT-PROPS "改成 INVOKER 後 prosecdef 仍是 [$MV] ⇒ 屬性格量錯東西"
Q "ALTER FUNCTION public.admin_void_shipment(text, uuid, text) SECURITY DEFINER;" >/dev/null
Q "GRANT EXECUTE ON FUNCTION public.admin_unvoid_shipment(text, uuid) TO anon;" >/dev/null
MA="$(Q "SELECT has_function_privilege('anon','public.admin_unvoid_shipment(text,uuid)','EXECUTE')")"
[ "$MA" = "t" ] && ok TMUT-ACL "多 GRANT 一個角色 ⇒ ACL 點名格的觀察值真的變了(t)= 該族有判別力" \
                || bad TMUT-ACL "多 GRANT 之後仍是 [$MA] ⇒ ACL 格量錯東西"
MS="$(Q "SELECT pg_catalog.count(DISTINCT a.grantee::text) FROM pg_proc p, pg_catalog.aclexplode(p.proacl) a WHERE p.proname='admin_unvoid_shipment' AND a.grantee <> p.proowner")"
[ "$MS" = "2" ] && ok TMUT-ACLSET "集合比對同時看到 2 個 grantee ⇒ 「第五個意外角色」確實抓得到" \
                || bad TMUT-ACLSET "集合比對只看到 $MS 個 ⇒ 它對多出來的角色不敏感"
Q "REVOKE ALL ON FUNCTION public.admin_unvoid_shipment(text, uuid) FROM anon;" >/dev/null

# 🔴 F14(nit):首版標題寫「每一族至少一發」,但 GEN / FAILCLOSED / ISO / ACTION-MAP 四族零靶
#    —— 與本檔 :11 自訂判準第一句衝突。以下補齊,全部在交易內或用完即還原。
# ① GEN 族:抽出來的正規式本身要有正負判別力(否則「200 抽全過」可能是因為那條式子什麼都收)
REPOS="$(Q "SELECT ('4TFBFH' ~ '$RE')::text || '|' || ('abc' ~ '$RE')::text || '|' || ('4TFBF' ~ '$RE')::text")"
[ "$REPOS" = "true|false|false" ] && ok TMUT-GEN-RE "抽出的正規式:合法碼過 / 小寫不過 / 短一碼不過 ⇒ 它不是什麼都收 ✓" \
                                 || bad TMUT-GEN-RE "正規式判別力不足:[$REPOS](期望 true|false|false)"
# ② FAILCLOSED 族:把一支換成靜默回傳 ⇒ 該格必須翻面
Q "CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS \$m\$ BEGIN RETURN '{}'::jsonb; END \$m\$;" >/dev/null
MFC="$(QM "SELECT public.admin_unvoid_shipment('k', gen_random_uuid());")"
case "$MFC" in *'尚未實作'*) bad TMUT-FAILCLOSED "換成靜默回傳後仍拋未實作 ⇒ FAILCLOSED 族量錯東西" ;;
  *) ok TMUT-FAILCLOSED "🔴 換成靜默回傳 ⇒ 呼叫**成功**(實得 [$MFC])= FAILCLOSED 族有判別力" ;; esac
# ③ ISO 族:上面那支現在**沒有隔離閘** ⇒ RR 下不該再是 P2B02
MISO="$(psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "BEGIN ISOLATION LEVEL REPEATABLE READ; DO \$\$ DECLARE c text; BEGIN BEGIN PERFORM public.admin_unvoid_shipment('k', gen_random_uuid()); EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS c = RETURNED_SQLSTATE; RAISE NOTICE 'CAP|%', c; END; END \$\$; ROLLBACK;" 2>&1 | sed -n 's/.*CAP|\(.*\)/\1/p' | tr -d '\n')"
[ "$MISO" != "P2B02" ] && ok TMUT-ISO "🔴 拿掉某支的隔離閘 ⇒ RR 下不再是 P2B02(實得 [${MISO:-無錯誤}])= ISO 族有判別力" \
                       || bad TMUT-ISO "拿掉閘之後 RR 仍回 P2B02 ⇒ ISO 族守的不是那段閘"
# ④ ACTION-MAP 族:多長一支同名族的函式 ⇒ 集合格必須紅
Q "CREATE FUNCTION public.admin_bogus_shipment_writer() RETURNS int LANGUAGE sql AS 'SELECT 1';" >/dev/null
MSET="$(Q "SELECT pg_catalog.string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%shipment%'")"
[ "$MSET" != "$EXP_FN" ] && ok TMUT-FN-SET "🔴 多長一支 ⇒ 函式集合真的變了 = W1-FN-SET 抓得到「多一支」" \
                         || bad TMUT-FN-SET "多長一支之後集合沒變 ⇒ W1-FN-SET 恆真"
Q "DROP FUNCTION public.admin_bogus_shipment_writer();" >/dev/null

echo "══ 8. 覆蓋帳 ══════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或新增未更新凍結值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-30s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
# 🔴 F10(consider):只數總數的話,「刪一格 + 別處加一格」= 總數不變、照樣全綠。
#    ⇒ 把**格名集合**也凍結。新增/改名/刪格都必須同批更新這份清單。
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="ACL-CONTROL-HAS-PRIV DDL-SYNTAX TMUT-ACL TMUT-ACLSET TMUT-FAILCLOSED TMUT-FN-SET TMUT-GEN-RE TMUT-ISO TMUT-PROPS W1-ACL-admin_add_shipment_items W1-ACL-admin_create_shipment W1-ACL-admin_mark_shipment_shipped W1-ACL-admin_unvoid_shipment W1-ACL-admin_void_shipment W1-ACLSET-admin_add_shipment_items W1-ACLSET-admin_create_shipment W1-ACLSET-admin_mark_shipment_shipped W1-ACLSET-admin_unvoid_shipment W1-ACLSET-admin_void_shipment W1-ACTION-SET W1-ERRCODE-admin_add_shipment_items W1-ERRCODE-admin_create_shipment W1-ERRCODE-admin_mark_shipment_shipped W1-ERRCODE-admin_unvoid_shipment W1-ERRCODE-admin_void_shipment W1-FAILCLOSED-admin_add_shipment_items W1-FAILCLOSED-admin_create_shipment W1-FAILCLOSED-admin_mark_shipment_shipped W1-FAILCLOSED-admin_unvoid_shipment W1-FAILCLOSED-admin_void_shipment W1-FN-SET W1-GEN-MATCHES-SHIPMENTS W1-GEN-RE-EXTRACT W1-GEN-VARIES W1-GEN-ZERO-GRANT W1-ISO-admin_add_shipment_items W1-ISO-admin_create_shipment W1-ISO-admin_mark_shipment_shipped W1-ISO-admin_unvoid_shipment W1-ISO-admin_void_shipment W1-NO-OVERLOAD W1-PROPS-admin_add_shipment_items W1-PROPS-admin_create_shipment W1-PROPS-admin_mark_shipment_shipped W1-PROPS-admin_unvoid_shipment W1-PROPS-admin_void_shipment W1-SIG-admin_add_shipment_items W1-SIG-admin_create_shipment W1-SIG-admin_mark_shipment_shipped W1-SIG-admin_unvoid_shipment W1-SIG-admin_void_shipment"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-30s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單(換格名/換格都紅得到)"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-KEYSET" "格名集合漂了。多出:[$(comm -13 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')] 少了:[$(comm -23 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')]"; FAIL=$((FAIL+1))
fi

# 🔴 原本這裡有一份行內收尾;已交給 EXIT 的 trap teardown,避免兩條收尾路徑各走各的。
echo
# 🔴 **不再印 TCP「埠殘留」** —— server 只開 unix socket(listen_addresses=)⇒ TCP 恆 0、零判別力。
#    真正的殘留檢查在 teardown(EXIT 時跑、停完才量、量不到 0 就保留 datadir 並印警告)。
echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"
[ "$FAIL" -eq 0 ] || exit 1
