#!/bin/bash
# ============================================================
# L5a-1 verify:`20260810010000` supersede_charge_attempt_for_user 的鎖下前置 + attempt 側各道閘的判別力。
#
# 用法:scripts/l5a1-verify.sh   (自建拋棄式 cluster、跑完自動 teardown;不碰任何正式庫)
# 真權威:母 plan §3.1 + P-280-STOP §5 + 本片 migration 檔頭。
#
# 🔴 三層,缺一層都證不完(數字與檔尾那行**必須逐字一致**;本檔 2026-08-10 因可呼面重設計改過一次,
#    code-reviewer MF3 指出當時只補了檔尾 = `claimed-sync-but-only-patched-touched-lines` 那族):
#   【reach】11 格可呼面守門 —— 證那道 apply 期斷言**攔得住誰、放得過誰**(含正式庫拓樸重演)。
#   【matrix】25 格行為矩陣 —— 對現行定義跑,證明它**做了什麼**(每格只讓一道不成立)。
#   【mutations】17 發突變(11 發閘弱化 + 6 發特殊)—— 每發把**一道弱化、保留結構**(不是整段拿掉),
#                 斷言**恰好**對應的那些格翻掉。只要求「至少一格翻」等於沒有判別力。
#   另有 2 條 provenance 偵測器 + 3 條結構釘 ⇒ 合計 **58**(= 2+11+3+25+17,與檔尾同源)。
#
# 🔴 突變體從 `pg_get_functiondef` 的**當下輸出**生成、不從檔案抄字面(避免縮排/行號漂移那族坑),
#    每個 anchor 都斷言在定義裡**恰好出現一次**,不唯一就 exit(不自行變通)。
#
# ⚠️ 本檔證不到的:app 層真的只在「查無 / 恆 4 PENDING」那兩岔才呼這支(那是 L5a-2 的 harness),
#    以及 TapPay 觀察本身正不正確(那是 L4 probe 的事,且態 -1 至今未確認)。
# ============================================================
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"

ROOT="$(mktemp -d /tmp/l5a1.XXXXXXXX)" || { echo "REFUSE: mktemp 失敗"; exit 1; }
chmod 700 "$ROOT" || { echo "REFUSE: chmod 700 失敗"; exit 1; }
case "$ROOT" in /tmp/l5a1.????????) : ;; *) echo "REFUSE: mktemp 給出非預期路徑 [$ROOT]"; exit 1 ;; esac
D="$ROOT/pgdata"; SOCK="$ROOT/sock"; P=54432

PASS=0; FAIL=0; LABELS=""
ok()  { PASS=$((PASS+1)); LABELS="$LABELS $1"; printf '  PASS %-22s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); LABELS="$LABELS $1"; printf '  FAIL %-22s %s\n' "$1" "$2"; }
# ⚠️ 與 l5am-verify 同款誠實邊界:這份 manifest 與它守的格子住在同一個檔,
#    擋得住**非同步**的漏跑(改一邊忘另一邊),擋不住有意的同步修改。
MANIFEST="ACL-UNIVERSAL REACH-EXTRACT REACH-ALLOW-super REACH-ALLOW-owner REACH-ALLOW-owner-setrole REACH-ALLOW-inert REACH-PROD-SHAPE REACH-DENY-admin REACH-DENY-direct REACH-DENY-inherit REACH-DENY-setrole REACH-DENY-transit G24 G25 MUT-cancel-table MUT-isolation STRUCT-LOCKSET MUT-successor-cancel G1 G10 G11 G12 G13 G14 G15 G16 G17 G18 G19 G20 G21 G22 G23 G2 G3 G4 G5 G6 G7 G8 G9 MUT-atomic MUT-cancelled MUT-order-owner MUT-order_id MUT-orderlock MUT-pending MUT-reason-raise MUT-released-future MUT-successor-live MUT-successor-owner MUT-successor-self MUT-superseded-null MUT-unpaid MUT-user_id SOLE-WRITER STRUCT-ATOMIC STRUCT-ORDERLOCK"

PMPID=""
teardown() {
  TD_RC=$?
  if [ -z "$PMPID" ] && [ -f "$D/postmaster.pid" ]; then PMPID="$(head -1 "$D/postmaster.pid" 2>/dev/null)"; fi
  if [ -z "$PMPID" ]; then
    if [ -e "$D" ]; then
      echo "🔴 TEARDOWN_WARN:拿不到 postmaster PID 但 datadir 存在 ⇒ **不刪**、保留 $ROOT 供診斷"
      if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
    fi
  else
    kill -0 "$PMPID" 2>/dev/null && { pg_ctl -D "$D" -w stop >/dev/null 2>&1 || echo "🔴 TEARDOWN_WARN:pg_ctl stop 非零離場"; }
    if kill -0 "$PMPID" 2>/dev/null; then
      echo "🔴 TEARDOWN_WARN:postmaster PID $PMPID 仍活著 ⇒ 保留 $ROOT 供診斷"
      if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi
    fi
  fi
  rm -rf "$ROOT"
  [ -e "$ROOT" ] && { echo "🔴 TEARDOWN_WARN:rm 之後 $ROOT 仍在"; if [ "$TD_RC" -eq 0 ]; then exit 9; else exit "$TD_RC"; fi; }
  echo "  teardown:postmaster 已停(kill -0 實測)、$ROOT 已收(-e 實測)"
}
trap teardown EXIT

mkdir -p "$SOCK" "$D"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
PMPID="$(head -1 "$D/postmaster.pid" 2>/dev/null)"
[ -n "$PMPID" ] || { echo "🔴 拿不到 postmaster PID"; exit 1; }
die() { echo "🔴 $1"; exit 1; }

PSQL() { psql -X -h "$SOCK" -p "$P" -U postgres -d postgres "$@"; }
Q() {
  local out rc
  out="$(PSQL -v ON_ERROR_STOP=1 -qtA -c "$1" 2>"$SOCK/q.err")"; rc=$?
  [ "$rc" -eq 0 ] || die "psql 查詢失敗(rc=$rc):$1 :: $(tr -d '\n' < "$SOCK/q.err")"
  printf '%s' "$out" | tr -d '\n'
}

PREFIX_TS="20260810010000"
MIG="$REPO/supabase/migrations/20260810010000_m4b_lifecycle_l5a1_supersede_charge_attempt.sql"
FN="public.supersede_charge_attempt_for_user(uuid,uuid,text,uuid)"
[ -f "$MIG" ] || die "MIG_MISSING: $MIG"

cd "$REPO" || die "CD_FAIL"
PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*|*20260809170000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] && continue
  [ "$TS" = "$PREFIX_TS" ] && continue
  [ "$f" = "$FIRST_FITMENTS" ] && { PSQL -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"; }
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
# 🔴 前置閘的判別力自檢:L5a-M 必須已在前綴裡被重放,否則本片的前置閘會擋下、整份 harness 打空。
[ "$(Q "SELECT count(*)::text FROM pg_attribute WHERE attrelid='public.payment_charge_attempts'::regclass AND attname='superseded_at' AND NOT attisdropped")" = "1" ] \
  || die "UPSTREAM_MISSING: L5a-M 三欄不在,先確認 20260809230000 在前綴內"

echo "== L5a-1 verify(port=$P)=="
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>"$D/err" || die "APPLY_FAIL: $(cat "$D/err")"

BASE_DEF="$SOCK/base-def.sql"
PSQL -v ON_ERROR_STOP=1 -qtA -c "SELECT pg_catalog.pg_get_functiondef('$FN'::regprocedure)" > "$BASE_DEF" 2>/dev/null
[ -s "$BASE_DEF" ] || die "BASEDEF_EMPTY"
restore_base() { PSQL -v ON_ERROR_STOP=1 -q -f "$BASE_DEF" >/dev/null 2>&1 || die "RESTORE_FAIL:裝不回原定義,庫已髒"; }

# ── fixture(全在 BEGIN…ROLLBACK 內;U=本人、X=別的會員)────────────────────
U='8e000000-0000-4000-8000-000000000001'
X='8e000000-0000-4000-8000-0000000000ff'
O1='8f000000-0000-4000-8000-000000000001'   # 舊在途單(本人、unpaid)
O2='8f000000-0000-4000-8000-000000000002'   # successor(本人、unpaid)
O3='8f000000-0000-4000-8000-000000000003'   # successor(**別的會員**)
A1='8d000000-0000-4000-8000-000000000001'

# call <attempt_status> <o1_paid> <arg_order> <arg_user> <arg_reason> <arg_successor> [extra_sql] [tail_sql]
# 回:true / false / RAISE_REASON / CHECK:<約束名> / ERR:<摘要>;tail_sql 非空時改回 tail 的查詢結果。
call() {
  local st="$1" o1paid="$2" a_ord="$3" a_usr="$4" a_rsn="$5" a_suc="$6" extra="${7:-}" tail="${8:-}" out rc
  out="$(PSQL -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA <<SQL 2>&1
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('$U','l5a1-u@example.test'), ('$X','l5a1-x@example.test');
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id, payment_status)
VALUES
  ('$O1','PCM-2099-6001','$U', jsonb_build_object('name','l5a1','phone','0900000000','line','x'),
   'general'::public.member_tier,100,0,100,'store', jsonb_build_object('type','personal'), gen_random_uuid(),
   CASE WHEN $o1paid THEN 'paid' ELSE 'unpaid' END::public.payment_status),
  ('$O2','PCM-2099-6002','$U', jsonb_build_object('name','l5a1','phone','0900000000','line','x'),
   'general'::public.member_tier,100,0,100,'store', jsonb_build_object('type','personal'), gen_random_uuid(),'unpaid'),
  ('$O3','PCM-2099-6003','$X', jsonb_build_object('name','l5a1','phone','0900000000','line','x'),
   'general'::public.member_tier,100,0,100,'store', jsonb_build_object('type','personal'), gen_random_uuid(),'unpaid');
INSERT INTO public.payment_charge_attempts
  (id, order_id, customer_user_id, status, fallback_token_hash, rec_trade_id)
VALUES ('$A1','$O1','$U','$st', public.charge_attempt_token_hash('$A1'),
        CASE WHEN '$st' = 'charged' THEN 'l5a1-rec-1' END);
${extra}
SELECT COALESCE((public.supersede_charge_attempt_for_user($a_ord, $a_usr, $a_rsn, $a_suc)->>'superseded'), 'null');
${tail}
ROLLBACK;
SQL
)"; rc=$?
  if [ "$rc" -eq 0 ]; then printf '%s' "$out" | tr -d ' ' | tail -1 | tr -d '\n'; return; fi
  case "$out" in
    *'ERROR:  P5A01:'*) printf 'RAISE_REASON' ;;
    *'violates check constraint "'*) printf 'CHECK:%s' "$(printf '%s' "$out" | sed -n 's/.*violates check constraint "\([^"]*\)".*/\1/p' | head -1)" ;;
    *) printf 'ERR:%s' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-120)" ;;
  esac
}
cell() { local label="$1" want="$2"; shift 2; local got; got="$(call "$@")"
  [ "$got" = "$want" ] && ok "$label" "→ $got" || bad "$label" "得到 [$got],期望 [$want]"; }

# ── L5a-M 檔頭指名轉過來的兩道偵測器(R3 MF-1)────────────────────────────────
# 🔴 L5a-M 自己的 harness 只重放 TS < 它的前綴 ⇒ 它**永遠看不到**本片與之後的任何寫入者。
#    provenance 的失效條件(「出現第二個 superseded_* 寫入者」)因此指名由本片起隨前綴長大地驗。
# 🔴 **宣稱縮窄(codex 關卡2 R2-MF5,主視窗裁 P-290 Q2=A)**:這一格證的是
#    「**public 函式這一面**沒有第二個寫入者」,**不是**「全庫只有受控 RPC 寫得到」。
#    跨 schema 函式、trigger、動態 SQL、migration 直接 UPDATE 都寫得到標記而它照樣綠。
#    把字串掃描當 provenance 保證是錯的;真正的結構保證(append-only 決策紀錄 / writer registry)
#    列為 L5b 的前置設計題。這裡誠實寫出它的射程,不假裝有。
echo "-- provenance 偵測器 --"
SOLE="$(Q "SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.prosrc LIKE '%superseded_%'")"
SOLE_NAME="$(Q "SELECT COALESCE(string_agg(p.proname, ',' ORDER BY p.proname), '-') FROM pg_proc p
                  JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.prosrc LIKE '%superseded_%'")"
{ [ "$SOLE" = "1" ] && [ "$SOLE_NAME" = "supersede_charge_attempt_for_user" ]; } \
  && ok "SOLE-WRITER" "**public 函式面**恰 1 個本體含 superseded_,且就是 supersede RPC(見下方縮窄宣稱)" \
  || bad "SOLE-WRITER" "含 superseded_ 的函式有 $SOLE 支 [$SOLE_NAME] —— provenance 推理的前提破了"
# 全稱 ACL 斷言(非枚舉角色名):非 owner 者一律只有 SELECT、零 GRANT OPTION。
ACL_BAD="$(Q "SELECT COALESCE(string_agg(x, ','), '') FROM (
  SELECT 'tbl:' || CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type AS x
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid='public.payment_charge_attempts'::regclass AND a.grantee <> c.relowner AND a.privilege_type <> 'SELECT'
  UNION ALL
  SELECT 'col:' || att.attname || ':' || CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type
    FROM pg_attribute att JOIN pg_class c ON c.oid=att.attrelid, aclexplode(att.attacl) a
   WHERE att.attrelid='public.payment_charge_attempts'::regclass AND a.grantee <> c.relowner AND a.privilege_type <> 'SELECT'
  UNION ALL
  SELECT 'grantopt:' || CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid='public.payment_charge_attempts'::regclass AND a.grantee <> c.relowner AND a.is_grantable
) t")"
[ -z "$ACL_BAD" ] \
  && ok "ACL-UNIVERSAL" "當期全稱:表級+欄級非 owner 者一律只有 SELECT(不是枚舉三個角色名)" \
  || bad "ACL-UNIVERSAL" "權限面異常:[$ACL_BAD]"

# ── R1-MF7 可呼面守門（2026-08-10 換面重設計）判別力十格 ────────────────
# 🔴 MAIN-005 實錘：正式庫 postgres（函式 owner、又因 CREATEROLE 自動成為 payment_confirmer 成員）
#    炸掉前版「零直接成員」斷言 —— 那是**假警報**（owner 不新增可呼面），不是守太嚴。
#    重設計把守門從「成員面」換到「**可呼面**」：**非 inert 身分取得閉包**（遞迴走 set/inherit/admin 任一）
#    × has_function_privilege（它自己含 inherit_option 那層）；白名單=超級角色 或 閉包含 owner。
# 🔴 **不用 pg_has_role(...,'MEMBER') 當可達性**（PG 17.10 實測，兩個方向都錯）：
#    inert 成員（INHERIT F,SET F）MEMBER=true 卻呼不到 ⇒ 誤擋；
#    owner 的 SET 成員 MEMBER(pc)=false 卻呼得到 ⇒ 漏抓。REACH-EXTRACT 釘死取出段內 pg_has_role 出現 0 次。
# 🔴 跑的是 migration 檔裏**那段字面**（sed 取錨點段），不是這裡抄一份謂詞——抄本證不了守門本尊。
# 🔴 十一格的分工（code-reviewer N4：別再寫「九格各一分支」，那與下面兩個複合格矛盾）：
#    · REACH-EXTRACT      = 靜態檢查（剝註解後掃謂詞存在性），不進 DB
#    · REACH-PROD-SHAPE   = **複合窮舉格**（同一拓樸跑 8 種 option 組合，全要放行）
#    · 其餘 9 格          = 各讓**一個分支單獨**做工（codex R2-MF3/MF4/MF5：裸 GRANT 預設 SET TRUE
#    會讓兩條路徑同時成立=假隔離），所以 fixture **一律顯式寫 WITH INHERIT/SET**，
#    sanity 直接斷言 pg_auth_members 三欄 + has_function_privilege 真假值 + owner 是否在閉包內。
#    每格附 case-specific sanity（SANITY_t），防 fixture 沒立起來而整格空跑恆真。
echo "-- 可呼面守門 --"
GUARD_SQL="$SOCK/inherit-guard.sql"
sed -n '/L5A1-INHERIT-GUARD-BEGIN/,/L5A1-INHERIT-GUARD-END/p' "$MIG" > "$GUARD_SQL"
GB="$(grep -o 'L5A1-INHERIT-GUARD-BEGIN' "$MIG" | wc -l | tr -d ' ')"
GE="$(grep -o 'L5A1-INHERIT-GUARD-END' "$MIG" | wc -l | tr -d ' ')"
# 🔴 code-reviewer N1/N2/N5:這四個存在性斷言原本掃**整段含註解**、且用 grep -c 數行數。
#    取出段裡就有「admin_option 那項是 R3/Fable MF-A」這種註解 ⇒ 就算把謂詞從 SQL 裡拿掉,
#    註解仍會餵飽斷言 = **恆真**。改成先剝掉行內註解再數,且數**出現次數**不是行數。
#    🔴 只剝註解**還不夠**(自驗突變抓到,比 reviewer 指的再深一層):RAISE 訊息裡附了一段診斷 SQL,
#      `admin_option` 這個字在**字串字面**裡也出現 ⇒ 把 SQL 的那一項拿掉、斷言仍為真(實測 3→2、非 0)。
#      所以註解與單引號字串**兩者都要剝**,剝完 admin_option 恰 1;拿掉那一項即 0(突變實測)。
#      ⚠️ 連帶:`server_version_num` 只出現在 current_setting('...') 的字串裡 ⇒ 剝完為 0,
#        不能拿它當版本閘的錨,改錨 `160000`(裸數字、剝不掉)。
GSTRIP="$SOCK/guard-nocomment.sql"
sed 's/--.*$//' "$GUARD_SQL" | sed "s/'[^']*'/''/g" > "$GSTRIP"
CNT() { grep -o "$1" "$GSTRIP" | wc -l | tr -d ' '; }
GP1="$(CNT 'has_function_privilege')"
GP2="$(CNT 'set_option')"
GP3="$(CNT 'pg_has_role')"
GP4="$(CNT 'admin_option')"   # 🔴 R3/Fable MF-A:拿掉它就是對前版的回歸,釘住
GP5="$(CNT '160000')"   # 🔴 code-reviewer MF1:PG16+ 版本閘(錨用裸數字,見上方剝字串那條)
# 🔴 GP3 必須為 0:pg_has_role(...,'MEMBER') 已實測證明**不能**當可達性判準
#    (inert 成員 MEMBER=true 卻呼不到 ⇒ 誤擋;owner 的 SET 成員 MEMBER=false 卻呼得到 ⇒ 漏抓)。
#    這裡把「不准回頭用它」釘成斷言,否則下一代很容易又寫回去。
{ [ "$GB" = "1" ] && [ "$GE" = "1" ] && [ "$GP1" -ge 1 ] && [ "$GP2" -ge 1 ] && [ "$GP3" = "0" ] && [ "$GP4" -ge 1 ] && [ "$GP5" -ge 1 ]; } \
  && ok "REACH-EXTRACT" "**剝掉註解與字串字面後**的取出段:含 has_function_privilege/set_option/admin_option/版本閘(錨 160000)、零 pg_has_role;錨點各恰 1 次" \
  || bad "REACH-EXTRACT" "錨 BEGIN=$GB END=$GE / has_fn_priv=$GP1 / set_option=$GP2 / pg_has_role=$GP3 / admin_option=$GP4 / 版本閘=$GP5(應 1,1,≥1,≥1,0,≥1,≥1)"

# reach_state <fixture_sql> <sanity_bool_sql> → OK / P5A03 / ERR:…
#   sanity 必須為 true,否則該格的 fixture 沒立起來 ⇒ 判為 ERR 而不是靜靜綠掉。
reach_state() {
  local out
  out="$(PSQL -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA <<SQL 2>&1
BEGIN;
$1
SELECT 'SANITY_' || COALESCE(($2)::bool::text, 'null');
\\i $GUARD_SQL
SELECT 'GUARD_OK';
ROLLBACK;
SQL
)"
  case "$out" in
    *SANITY_t*) : ;;
    *) printf 'ERR:fixture sanity 未成立 :: %s' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-100)"; return ;;
  esac
  case "$out" in
    *GUARD_OK*)         printf 'OK' ;;
    # 🔴 codex R2-MF4:只回 'P5A03' 會讓 DENY-transit 假綠(鏈上任一角色被抓都回同一個字串)。
    #    這裡把 RAISE 訊息裡的角色清單一起帶出來,呼叫端才能斷言「**誰**被抓到」。
    *'ERROR:  P5A03:'*) printf 'P5A03|%s' "$(printf '%s' "$out" | tr '\n' ' ' | sed -n 's/.*可呼面異常 — \[\([^]]*\)\].*/\1/p')" ;;
    *) printf 'ERR:%s' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-120)" ;;
  esac
}
# deny_is <got> <期望被抓到的角色,逗號分隔> → 0/1;同時擋「有 RAISE 但抓錯人」
deny_is() { [ "${1%%|*}" = "P5A03" ] && [ "${1#*|}" = "$2" ]; }
FNP="has_function_privilege('%s','$FN','EXECUTE')"
# EDGE <member> <roleid> <set> <inherit>:直接斷言 pg_auth_members 的三欄,不繞 pg_has_role
EDGE() { printf "EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member='%s'::regrole AND m.roleid='%s'::regrole AND m.set_option IS %s AND m.inherit_option IS %s)" "$1" "$2" "$3" "$4"; }
NOEDGE() { printf "NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member='%s'::regrole)" "$1"; }
# EDGE3 <member> <roleid> <set> <inherit> <admin>:三個 option 欄全釘（R3/Fable C-1:不留假設）
EDGE3() { printf "EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member='%s'::regrole AND m.roleid='%s'::regrole AND m.set_option IS %s AND m.inherit_option IS %s AND m.admin_option IS %s)" "$1" "$2" "$3" "$4" "$5"; }
SUPER() { printf "(SELECT r.rolsuper FROM pg_roles r WHERE r.rolname='%s')" "$1"; }
# 🔴 codex R2-MF5:白名單ⓑ 的隔離要用**同一套遞迴閉包**斷言「owner 不可達」,
#    只排除「直接 owner edge」證不了閉包裡沒有更長的路。
OWNER_REACHABLE() { printf "EXISTS (WITH RECURSIVE c AS (SELECT '%s'::regrole::oid AS cur UNION SELECT m.roleid FROM c JOIN pg_auth_members m ON m.member=c.cur AND (m.set_option OR m.inherit_option OR m.admin_option)) SELECT 1 FROM c WHERE c.cur = (SELECT p.proowner FROM pg_proc p WHERE p.oid='$FN'::regprocedure))" "$1"; }
MKOWNER="CREATE ROLE l5a1_owner; GRANT CREATE ON SCHEMA public TO l5a1_owner; ALTER FUNCTION $FN OWNER TO l5a1_owner;"

# ① 白名單ⓐ 超級角色:本身可呼(has_fn_priv=true)、且**閉包不含 owner**(排除ⓑ 分支)⇒ 只有 rolsuper 在放行
got="$(reach_state \
  "CREATE ROLE l5a1_su SUPERUSER; GRANT payment_confirmer TO l5a1_su;" \
  "$(SUPER l5a1_su) AND $(printf "$FNP" l5a1_su) AND NOT $(OWNER_REACHABLE l5a1_su)")"
[ "$got" = "OK" ] \
  && ok  "REACH-ALLOW-super" "超級角色(可呼、閉包不含 owner)⇒ 只有 rolsuper 分支在放行" \
  || bad "REACH-ALLOW-super" "得到 [$got],期望 OK"

# ② 白名單ⓑ 之一:自己就是 owner(非超級、零 membership 邊)⇒ 只有 owner-閉包分支在放行
got="$(reach_state "$MKOWNER" \
  "NOT $(SUPER l5a1_owner) AND $(printf "$FNP" l5a1_owner) AND $(NOEDGE l5a1_owner)")"
[ "$got" = "OK" ] \
  && ok  "REACH-ALLOW-owner" "隔離 owner 白名單分支(非超級、無任何 membership)⇒ 放行" \
  || bad "REACH-ALLOW-owner" "得到 [$got],期望 OK"

# ③ 🔴 codex R1-MF1 的形狀:GRANT owner TO W WITH INHERIT FALSE, SET TRUE
#    W 自己 has_fn_priv=false、也不是 payment_confirmer 成員 ⇒ 舊 pg_has_role 判準**整個漏抓**;
#    新閉包看得到它(可 SET ROLE 成 owner)⇒ 由 owner-閉包白名單明示放行(能力嚴格強於呼這支)。
got="$(reach_state \
  "$MKOWNER CREATE ROLE l5a1_wo; GRANT l5a1_owner TO l5a1_wo WITH INHERIT FALSE, SET TRUE;" \
  "NOT $(printf "$FNP" l5a1_wo) AND $(EDGE l5a1_wo l5a1_owner TRUE FALSE) AND NOT $(SUPER l5a1_wo)")"
[ "$got" = "OK" ] \
  && ok  "REACH-ALLOW-owner-setrole" "可 SET ROLE 成 owner 者(自身 has_fn_priv=false)⇒ 白名單ⓑ 明示放行" \
  || bad "REACH-ALLOW-owner-setrole" "得到 [$got],期望 OK"

# ④ 🔴 codex R1-MF2 的形狀:GRANT payment_confirmer TO r WITH INHERIT FALSE, SET FALSE(inert)
#    實測 pg_has_role MEMBER=true 但呼不到 ⇒ 舊判準會**誤擋**、重演 MAIN-005 假警報;新閉包不誤擋。
got="$(reach_state \
  "CREATE ROLE l5a1_inert; GRANT payment_confirmer TO l5a1_inert WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;" \
  "NOT $(printf "$FNP" l5a1_inert) AND $(EDGE3 l5a1_inert payment_confirmer FALSE FALSE FALSE)")"
[ "$got" = "OK" ] \
  && ok  "REACH-ALLOW-inert" "全假 inert 成員(set/inherit/admin 三欄皆 F:什麼也做不到)⇒ 不誤擋(舊 MEMBER 判準會擋)" \
  || bad "REACH-ALLOW-inert" "得到 [$got],期望 OK —— 守門在誤擋呼不到的角色"

# ④b 🔴 **正式庫真實形狀重演**（唯一直接回答「這次 apply 會不會再炸」的一格）。
#     來源=Sean 2026-08-10 親跑 Supabase SQL Editor、主視窗 `MAIN-007-A` 逐字帶回：
#       postgres           非超級 / 本函式 owner / payment_confirmer 直接成員（usage=false,member=true）
#       cli_login_postgres 非超級 / postgres 的成員（usage=false,member=true）
#       supabase_admin     超級角色 / payment_confirmer 成員（usage=true）
#     🔴 R3/Fable C-1 + code-reviewer MF2：`MAIN-007-A` 只有 usage/member 兩欄，**set/inherit/admin 三欄未知**，
#       且它只枚舉了兩個節點、而守門以**全 pg_roles** 為根 ⇒ 本格證的是「本拓樸下放行」，**不是**「正式庫會放行」。
#       前一版 fixture 直接寫死 SET TRUE = 拿假設當證據。改法不是去猜，是**把未知窮舉掉**：
#       cli→owner 那條邊跑遍 7 種非全假組合 + 1 種 inert，全部都要放行。
#       之所以全都會放行，是因為判準用的是「非 inert 閉包」：
#         邊非 inert ⇒ 閉包含 owner ⇒ 白名單ⓑ；邊 inert ⇒ 那條邊什麼也做不到 ⇒ 根本不進候選。
#       ⚠️ 它證的仍是**拓樸**、不是正式庫現況；現況的唯一來源是 MAIN-007-A 那份輸出。
PROD_OK=1; PROD_BAD=""
for OPT in "SET TRUE, INHERIT TRUE, ADMIN TRUE" "SET TRUE, INHERIT FALSE, ADMIN FALSE" \
           "SET FALSE, INHERIT TRUE, ADMIN FALSE" "SET FALSE, INHERIT FALSE, ADMIN TRUE" \
           "SET TRUE, INHERIT TRUE, ADMIN FALSE" "SET TRUE, INHERIT FALSE, ADMIN TRUE" \
           "SET FALSE, INHERIT TRUE, ADMIN TRUE" "SET FALSE, INHERIT FALSE, ADMIN FALSE"; do
  g="$(reach_state \
    "$MKOWNER GRANT payment_confirmer TO l5a1_owner WITH INHERIT FALSE, SET TRUE;
     CREATE ROLE l5a1_cli; GRANT l5a1_owner TO l5a1_cli WITH $OPT;
     CREATE ROLE l5a1_sa SUPERUSER; GRANT payment_confirmer TO l5a1_sa WITH INHERIT TRUE, SET TRUE;" \
    "NOT $(SUPER l5a1_owner) AND (SELECT p.proowner FROM pg_proc p WHERE p.oid='$FN'::regprocedure) = 'l5a1_owner'::regrole::oid AND $(EDGE l5a1_owner payment_confirmer TRUE FALSE) AND NOT $(SUPER l5a1_cli) AND $(SUPER l5a1_sa)")"
  [ "$g" = "OK" ] || { PROD_OK=0; PROD_BAD="$PROD_BAD [$OPT -> $g]"; }
done
[ "$PROD_OK" = "1" ] \
  && ok  "REACH-PROD-SHAPE" "**本拓樸下**放行:重演 MAIN-007-A 兩節點、cli 邊 8 種 option 全放行(⚠️ 手搭拓樸≠正式庫現況;apply 前另有 prod 唯讀原字面預跑,見 migration 誠實邊界 7)" \
  || bad "REACH-PROD-SHAPE" "有組合被擋:$PROD_BAD —— 本拓樸下就會炸,正式庫更不用談"

# ⑤ 一般 INHERIT 成員:has_fn_priv=true、零 owner 邊 ⇒ 兩個白名單都不適用
got="$(reach_state \
  "CREATE ROLE l5a1_stranger; GRANT payment_confirmer TO l5a1_stranger WITH INHERIT TRUE, SET FALSE;" \
  "$(printf "$FNP" l5a1_stranger) AND $(EDGE l5a1_stranger payment_confirmer FALSE TRUE) AND NOT $(SUPER l5a1_stranger) AND NOT $(OWNER_REACHABLE l5a1_stranger)")"
deny_is "$got" "l5a1_stranger" \
  && ok  "REACH-DENY-inherit" "純繼承成員(INHERIT T,SET F:SET 路徑明文關掉)⇒ 只有 has_function_privilege 那層抓得到" \
  || bad "REACH-DENY-inherit" "得到 [$got],期望 P5A03|l5a1_stranger"

# ⑥ 只靠 SET ROLE 到得了 payment_confirmer(INHERIT F,SET T):has_fn_priv=false
#    ⇒ 這格證的是**閉包那一層有判別力**(單看 has_function_privilege 完全看不到它)
got="$(reach_state \
  "CREATE ROLE l5a1_setonly; GRANT payment_confirmer TO l5a1_setonly WITH INHERIT FALSE, SET TRUE;" \
  "NOT $(printf "$FNP" l5a1_setonly) AND $(EDGE l5a1_setonly payment_confirmer TRUE FALSE)")"
deny_is "$got" "l5a1_setonly" \
  && ok  "REACH-DENY-setrole" "只 SET ROLE 到得了(自身 has_fn_priv=false)⇒ 閉包那層抓到、且抓到的就是它" \
  || bad "REACH-DENY-setrole" "得到 [$got],期望 P5A03|l5a1_setonly —— 閉包那層沒有判別力"

# ⑦ 直接被 GRANT EXECUTE、零 membership 邊 ⇒ 只有 has_function_privilege 那層看得到
got="$(reach_state \
  "CREATE ROLE l5a1_grantee; GRANT EXECUTE ON FUNCTION $FN TO l5a1_grantee;" \
  "$(printf "$FNP" l5a1_grantee) AND $(NOEDGE l5a1_grantee)")"
deny_is "$got" "l5a1_grantee" \
  && ok  "REACH-DENY-direct" "直接被 GRANT EXECUTE、零 membership ⇒ RAISE P5A03 且抓到的就是它" \
  || bad "REACH-DENY-direct" "得到 [$got],期望 P5A03|l5a1_grantee"

# ⑦b 🔴 R3/Fable MF-A:只持 ADMIN OPTION 的 inert 成員（set=F, inherit=F, admin=T）。
#     它自身 has_fn_priv=false、也 SET ROLE 不了，但可以 `GRANT payment_confirmer TO 自己` 之後再呼。
#     🔴 這是**本次重設計自己造出來的回歸**：前版「零直接成員」斷言攔得住它，
#       只走 set_option 的閉包會靜默放過 ⇒ 必須被抓到。
got="$(reach_state \
  "CREATE ROLE l5a1_admin; GRANT payment_confirmer TO l5a1_admin WITH INHERIT FALSE, SET FALSE, ADMIN TRUE;" \
  "NOT $(printf "$FNP" l5a1_admin) AND $(EDGE3 l5a1_admin payment_confirmer FALSE FALSE TRUE)")"
deny_is "$got" "l5a1_admin" \
  && ok  "REACH-DENY-admin" "只持 ADMIN 的 inert 成員(可自授後呼)⇒ 抓到、且抓到的就是它(補回前版能力)" \
  || bad "REACH-DENY-admin" "得到 [$got],期望 P5A03|l5a1_admin —— admin_option 那條邊漏抓(對前版是回歸)"

# ⑧ 兩層 SET 鏈 Y→X→payment_confirmer,全程 INHERIT FALSE。
#    🔴 codex R2-MF4「確定假綠」的折法:X 自己就可 SET ROLE 到 pc ⇒ 光看「有沒有 RAISE」
#      即使遞迴只走一層也會綠。所以這格改成斷言 **RAISE 訊息裡的角色清單逐字等於 `l5a1_x,l5a1_y`**:
#      只有遞迴真的走到第二層,l5a1_y 才會出現在清單裡。
got="$(reach_state \
  "CREATE ROLE l5a1_x; CREATE ROLE l5a1_y; GRANT payment_confirmer TO l5a1_x WITH INHERIT FALSE, SET TRUE; GRANT l5a1_x TO l5a1_y WITH INHERIT FALSE, SET TRUE;" \
  "NOT $(printf "$FNP" l5a1_y) AND NOT $(printf "$FNP" l5a1_x) AND $(EDGE l5a1_x payment_confirmer TRUE FALSE) AND $(EDGE l5a1_y l5a1_x TRUE FALSE) AND NOT $(OWNER_REACHABLE l5a1_y)")"
deny_is "$got" "l5a1_x,l5a1_y" \
  && ok  "REACH-DENY-transit" "兩層 SET 鏈:清單逐字含 l5a1_y ⇒ 遞迴真的走到第二層(不是只抓到 X 就綠)" \
  || bad "REACH-DENY-transit" "得到 [$got],期望 P5A03|l5a1_x,l5a1_y —— 只抓到 X = 遞迴那層沒有判別力"

# ── 原子性結構斷言(R3 MF-4)──────────────────────────────────────────────────
# 🔴 為什麼要結構斷言而不是行為斷言:「釋鎖與標記分兩步」的失敗只在**中間斷掉**時顯現,
#    正常跑完兩步的結果與一步完全相同 ⇒ 任何純行為的觀察都分辨不出來。
#    ⇒ 只能釘結構:本函式必須**恰有一個** UPDATE 打這張表,且那一個 SET 同時寫 status 與 superseded_at。
# 🔴 C2:原本錨綁自己的書寫形狀(`^  UPDATE public.payment_charge_attempts a$`)⇒ 只證了「我這樣寫」。
#    改成數**所有**打本表的 UPDATE(不論縮排/別名),別人換個寫法加第二個 UPDATE 才擋得住。
UPD_N="$(grep -cE 'UPDATE[[:space:]]+public\.payment_charge_attempts' "$BASE_DEF" || true)"
HAS_ST="$(grep -c "^     SET status                    = 'released',$" "$BASE_DEF" || true)"
HAS_SU="$(grep -c '^         superseded_at             = v_now,$' "$BASE_DEF" || true)"
{ [ "$UPD_N" = "1" ] && [ "$HAS_ST" = "1" ] && [ "$HAS_SU" = "1" ]; } \
  && ok "STRUCT-ATOMIC" "恰 1 個 UPDATE 打本表,且同一 SET 內同時寫 status 與 superseded_at" \
  || bad "STRUCT-ATOMIC" "UPDATE 數=$UPD_N / status 寫入=$HAS_ST / superseded_at 寫入=$HAS_SU(各應為 1)"

R="'stuck_pending'"
# order_cancellations 的必填欄:order_id / reason_code(七值 allowlist)/ idempotency_key(uuid)
# / payload_hash(lowercase sha256 hex)/ actor(FK → staff.id)。actor 借既有 staff 列,不自己編。
CANC_SQL="INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
 SELECT '%s', 'customer_request', gen_random_uuid(), encode(sha256('l5a1'::bytea),'hex'), st.id
   FROM public.staff st ORDER BY st.id LIMIT 1;"
CANC_O1="$(printf "$CANC_SQL" "$O1")"
CANC_O2="$(printf "$CANC_SQL" "$O2")"
echo "-- 12 格行為矩陣 --"
cell G1  true          pending  false "'$O1'" "'$U'" "$R"        "'$O2'"
# 🔴 G2/G3 的 successor 一律傳 NULL,不傳 O2 —— 第一版傳 O2 時:
#    G2(p_order_id=O2)會讓「successor 不得等於 p_order_id」那條**先**否決,
#    G3(p_user_id=X)會讓「successor 需同會員」那條**先**否決
#    ⇒ 兩格量到的都不是自己那道閘,弱化閘①/閘② 的突變因此一格都不翻(實跑抓到)。
#    successor 傳 NULL 讓閘⑤ 整條短路,這兩格才只剩自己那道閘在擋。
#    (memory feedback_negative-test-observation-supplied-by-another-mechanism 的教科書形狀。)
cell G2  false         pending  false "'$O2'" "'$U'" "$R"        NULL
# ⚠️ G3 **不是**單閘格(codex R2 nit 校正):p_user_id=X 會同時撞鎖下的 orders-owner 那道
#    與 attempt-owner 閘②,而前者先回 false。真正把兩道隔離開的是 G13 與 G21。
#    留著它是因為它代表最常見的真實輸入(整個呼叫的 user 傳錯),不是為了證明某一道閘。
cell G3  false         pending  false "'$O1'" "'$X'" "$R"        NULL
cell G4  false         charged  false "'$O1'" "'$U'" "$R"        "'$O2'"
cell G5  false         pending  true  "'$O1'" "'$U'" "$R"        "'$O2'"
cell G6  false         pending  false "'$O1'" "'$U'" "$R"        "'$O3'"
cell G7  false         pending  false "'$O1'" "'$U'" "$R"        "'$O1'"
cell G8  true          pending  false "'$O1'" "'$U'" "$R"        NULL
cell G9  false         released false "'$O1'" "'$U'" "$R"        "'$O2'"
cell G10 RAISE_REASON  pending  false "'$O1'" "'$U'" "'bogus'"   "'$O2'"

# G11:happy 之後逐欄核寫入(不是「回 true 就算數」——回傳值證不了它寫對了什麼)
G11_TAIL="SELECT (status='released')::text || ',' || (released_at IS NOT NULL)::text || ',' ||
 (superseded_at IS NOT NULL)::text || ',' || COALESCE(superseded_reason,'-') || ',' ||
 COALESCE((superseded_by_order_id='$O2')::text,'-') || ',' || (settle_attempt_count=0)::text || ',' ||
 (needs_manual_review=false)::text || ',' || (released_manual_review_at IS NULL)::text || ',' ||
 (next_settle_at > pg_catalog.now())::text || ',' || (released_at <= superseded_at)::text
 FROM public.payment_charge_attempts WHERE id='$A1';"
cell G11 "true,true,true,stuck_pending,true,true,true,true,true,true" \
  pending false "'$O1'" "'$U'" "$R" "'$O2'" "" "$G11_TAIL"

# G12:released_at write-once —— 先前被 preflight release 過的列,讓路不得覆蓋它的 released_at,
#      且必須嚴格早於 superseded_at(這同時是 L5a-M CHECK ⑤ 的另一半在真實寫入路徑上的驗證)。
G12_EXTRA="UPDATE public.payment_charge_attempts SET released_at = pg_catalog.now() - interval '1 hour' WHERE id='$A1';"
G12_TAIL="SELECT (released_at < pg_catalog.now() - interval '55 minutes')::text || ',' || (released_at < superseded_at)::text
 FROM public.payment_charge_attempts WHERE id='$A1';"
cell G12 "true,true" pending false "'$O1'" "'$U'" "$R" "'$O2'" "$G12_EXTRA" "$G12_TAIL"

# ── codex 關卡2 R1 新增的八格(每格對應一條 must-fix / nit)────────────────────
# 🔴 G13(MF-1):orders 本尊屬 X、attempt 上那個**反正規化**的 customer_user_id 仍是 U。
#    兩者沒有複合 FK 綁著(20260612150000:89-92)⇒ 只信 attempt 那一欄就會替別人的訂單蓋標記。
cell G13 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.orders SET customer_user_id='$X' WHERE id='$O1';"
# 🔴 G14(MF-5a):released_at 在未來 ⇒ COALESCE 保留它 ⇒ superseded_at=now() 比它早 ⇒ 撞 CHECK ⑤。
#    要的是乾淨的 false,不是 23514(例外會被呼叫端當系統錯誤,而那條路可能釋放按鈕)。
cell G14 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.payment_charge_attempts SET released_at = pg_catalog.now() + interval '1 hour' WHERE id='$A1';"
# 🔴 G15(MF-5b):pending 列**已經帶著**一組合法標記 ⇒ 不得覆寫(真 write-once)。
#    前一版檔頭宣稱「閘③ 就保證了 write-once」是錯的,這格是那句話的反例。
cell G15 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.payment_charge_attempts SET released_at = pg_catalog.now() - interval '2 hours', superseded_at = pg_catalog.now() - interval '1 hour', superseded_reason='record_not_found' WHERE id='$A1';"
# 🔴 G16(MF-6):reason 傳 NULL —— 原本只測 'bogus',NULL 這條路沒有證人。
cell G16 RAISE_REASON pending false "'$O1'" "'$U'" NULL "'$O2'"
# 🔴 G17(MF-6):正向矩陣原本只用 stuck_pending ⇒ 有人把 record_not_found 那支刪掉,全綠。
# 🔴 C3:原本只斷言回 true —— 但真正要證的是那個 reason **寫進欄位了**(L5b 的憑據欄)。
#    傳 record_not_found 卻寫成 stuck_pending 的話,舊版這格照樣綠。
cell G17 "true,true,true,record_not_found,true,true,true,true,true,true" \
  pending false "'$O1'" "'$U'" "'record_not_found'" "'$O2'" "" "$G11_TAIL"
# 🔴 G18(nit-9):舊單已取消 ⇒ 不由本支處理(取消線有自己的語意)。
cell G18 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.orders SET cancelled_at = pg_catalog.now() WHERE id='$O1';"
# 🔴 G19/G20(nit-9):successor 已付款 / 已取消 ⇒ 它受益不了,不該被記成讓路對象。
cell G19 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.orders SET payment_status='paid'::public.payment_status WHERE id='$O2';"
cell G20 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.orders SET cancelled_at = pg_catalog.now() WHERE id='$O2';"
# 🔴 G22/G23(R2-MF1):取消的真相是**兩張表**。只有 order_cancellations 有列、
#    orders.cancelled_at 仍是 NULL 的中間態,前一版會讓路並蓋上退款標記。
cell G22 false pending false "'$O1'" "'$U'" "$R" "'$O2'" "$CANC_O1"
cell G23 false pending false "'$O1'" "'$U'" "$R" "'$O2'" "$CANC_O2"

# 🔴 G21:MF-1 的**反向**不一致 —— orders 本尊屬 U(通得過鎖下那道歸屬),
#    但 attempt 上的反正規化欄是 X ⇒ 只剩閘② 在擋。
#    為什麼要這一格:加了鎖下歸屬檢查之後,G3(p_user_id 傳 X)會被**那道**先擋掉,
#    弱化閘② 的突變一格都不翻 ⇒ 閘② 變成「構造不出只紅它的負測」= 疑似 no-op。
#    但它不是 no-op:它擋的正是反正規化欄與本尊不一致這一種。所以要造出這一格。
cell G21 false pending false "'$O1'" "'$U'" "$R" "'$O2'" \
  "UPDATE public.payment_charge_attempts SET customer_user_id='$X' WHERE id='$A1';"

# 🔴 G24(MF-A):非 READ COMMITTED 一律 RAISE P5A02。
#    沒有這格,「抄了雙真相表卻沒抄配套隔離閘」這個缺口在單 session 測試裡完全隱形。
iso_probe() {
  PSQL -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtA <<SQL 2>&1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT public.supersede_charge_attempt_for_user('$O1', '$U', 'stuck_pending', NULL);
ROLLBACK;
SQL
}
case "$(iso_probe)" in
  *'ERROR:  P5A02:'*) ok  "G24" "REPEATABLE READ ⇒ 隔離閘 RAISE P5A02(fail-closed)" ;;
  *)                  bad "G24" "REPEATABLE READ 下沒被隔離閘擋:$(iso_probe | tr '\n' ' ' | cut -c1-120)" ;;
esac
# 🔴 G25(R3 N2):G11/G12 都用 <= / <,**等號**那一點沒有格子釘到。
#    而等號正是最常見的形狀(released_at 為 NULL ⇒ 兩者同為 v_now)。
G25_TAIL="SELECT (released_at = superseded_at)::text FROM public.payment_charge_attempts WHERE id='$A1';"
cell G25 "true" pending false "'$O1'" "'$U'" "$R" NULL "" "$G25_TAIL"

# ── 結構斷言:orders FOR UPDATE(MF-2 的鎖)────────────────────────────────────
# 🔴 誠實邊界:單 session 的 harness **證不到**鎖真的關閉了 TOCTOU —— 那要兩條連線交錯。
#    這道釘的只有「那句 FOR UPDATE 還在、且排在 attempt UPDATE 之前」,以及鎖序沒被倒過來。
#    寫出來,別把它讀成「併發已驗」。
# 🔴 錨必須排除註解行:函式本體裡有一句「修法 = 先對 order 取 FOR UPDATE…」的中文註解,
#    用寬鬆的 grep 'FOR UPDATE' 會命中它 ⇒ 子句被拿掉也還是綠(恆真)。
#    這個瑕疵是 MUT-orderlock 那一發抓出來的 —— 突變的價值就在這裡。
# 🔴 C1:鎖集那段(把 successor 也拉進 FOR UPDATE、並用 ORDER BY 固定序)本身**零守門** ——
#    刪掉 OR 子句(successor 不進鎖集)或刪掉 ORDER BY(固定序沒了、交叉死結回來),
#    現有兩道結構釘都照樣綠。整段錨才擋得住。
LOCKSET_ANCHOR="     FROM public.orders o
    WHERE o.id = p_order_id
       OR (p_successor_order_id IS NOT NULL AND o.id = p_successor_order_id)
    ORDER BY o.id
      FOR UPDATE;"
LOCKSET_N="$(python3 -c "import sys;print(open(sys.argv[1]).read().count(sys.argv[2]))" "$BASE_DEF" "$LOCKSET_ANCHOR")"
[ "$LOCKSET_N" = "1" ] \
  && ok "STRUCT-LOCKSET" "鎖集整段錨恰 1 次(successor 進鎖集 + ORDER BY 固定序 + FOR UPDATE 三者綁在一起)" \
  || bad "STRUCT-LOCKSET" "鎖集整段錨出現 $LOCKSET_N 次(應 1)⇒ 有人動過鎖集或固定序"

LOCK_LINE="$(grep -n '^      FOR UPDATE;$' "$BASE_DEF" | head -1 | cut -d: -f1)"
UPD_LINE="$(grep -n '^  UPDATE public\.payment_charge_attempts a$' "$BASE_DEF" | head -1 | cut -d: -f1)"
{ [ -n "$LOCK_LINE" ] && [ -n "$UPD_LINE" ] && [ "$LOCK_LINE" -lt "$UPD_LINE" ]; } \
  && ok "STRUCT-ORDERLOCK" "orders FOR UPDATE 在第 $LOCK_LINE 行、attempt UPDATE 在第 $UPD_LINE 行(鎖序 orders→attempt 未被倒置)" \
  || bad "STRUCT-ORDERLOCK" "FOR UPDATE 行=[$LOCK_LINE] / attempt UPDATE 行=[$UPD_LINE](前者須存在且較小)"

# ── 突變:把一個閘弱化成恆真、保留結構 ──────────────────────────────────────
# 🔴 每次產突變前先刪掉舊檔、產完驗它真的存在且與原定義不同。
#    沒有這道:python anchor 打空 → 退非零 → 但 $SOCK/mutant.sql **還是上一發的內容**,
#    後面的 `psql -f` 照樣裝得上去 ⇒ 上一發的突變被當成這一發的結果 = 假綠。
#    (這條是 MUT-successor-self 那次 FAIL 追下去才發現的,不是預想到的。)
gen_mutant() { # $1=代號 → 寫 $SOCK/mutant.sql
  rm -f "$SOCK/mutant.sql"
  python3 - "$1" "$BASE_DEF" "$SOCK/mutant.sql" <<'PYEOF'
import sys
n, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit("anchor 非唯一(%d):%r" % (src.count(anchor), anchor[:60]))
    return src.replace(anchor, repl)
M = {
 'order_id':         ("a.order_id         = p_order_id", "a.order_id         IS NOT NULL"),
 'user_id':          ("a.customer_user_id = p_user_id", "a.customer_user_id IS NOT NULL"),
 'pending':          ("a.status           = 'pending'", "a.status           IS NOT NULL"),
 'unpaid':           ("IF v_order.payment_status <> 'unpaid'::public.payment_status THEN", "IF false THEN"),
 'successor-owner':  ("v_succ.customer_user_id IS DISTINCT FROM p_user_id", "false"),
 'successor-self':   ("p_successor_order_id <> p_order_id", "true"),
 'order-owner':      ("IF v_order.customer_user_id IS DISTINCT FROM p_user_id THEN", "IF false THEN"),
 'cancelled':        ("IF v_order.cancelled_at IS NOT NULL\n     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN", "IF false THEN"),
 'cancel-table':     ("\n     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)", ""),
 'successor-cancel': ("\n       OR v_succ.cancelled_at IS NOT NULL\n       OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_successor_order_id)", ""),
 'superseded-null':  ("AND a.superseded_at IS NULL", "AND true"),
 'released-future':  ("AND (a.released_at IS NULL OR a.released_at <= v_now)", "AND true"),
 'successor-live':   ("v_succ.payment_status <> 'unpaid'::public.payment_status", "false"),
 'orderlock':        ("\n      FOR UPDATE;", ";"),
}
if n not in M: sys.exit("未知突變代號 %s" % n)
a, r = M[n]
open(out_p, 'w').write(sub(a, r))
PYEOF
  local rc=$?
  [ "$rc" -eq 0 ] && [ -s "$SOCK/mutant.sql" ] && ! cmp -s "$SOCK/mutant.sql" "$BASE_DEF"
}
run_matrix_neg() { # 印出「現在回 true」的否決格
  [ "$(call pending  false "'$O2'" "'$U'" "$R" NULL   )" = true ] && printf 'G2 '
  [ "$(call pending  false "'$O1'" "'$X'" "$R" NULL   )" = true ] && printf 'G3 '
  [ "$(call charged  false "'$O1'" "'$U'" "$R" "'$O2'")" = true ] && printf 'G4 '
  [ "$(call pending  true  "'$O1'" "'$U'" "$R" "'$O2'")" = true ] && printf 'G5 '
  [ "$(call pending  false "'$O1'" "'$U'" "$R" "'$O3'")" = true ] && printf 'G6 '
  [ "$(call released false "'$O1'" "'$U'" "$R" "'$O2'")" = true ] && printf 'G9 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.orders SET customer_user_id='$X' WHERE id='$O1';")" = true ] && printf 'G13 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.payment_charge_attempts SET released_at = pg_catalog.now() - interval '2 hours', superseded_at = pg_catalog.now() - interval '1 hour', superseded_reason='record_not_found' WHERE id='$A1';")" = true ] && printf 'G15 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.orders SET cancelled_at = pg_catalog.now() WHERE id='$O1';")" = true ] && printf 'G18 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.orders SET payment_status='paid'::public.payment_status WHERE id='$O2';")" = true ] && printf 'G19 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.orders SET cancelled_at = pg_catalog.now() WHERE id='$O2';")" = true ] && printf 'G20 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.payment_charge_attempts SET customer_user_id='$X' WHERE id='$A1';")" = true ] && printf 'G21 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "$CANC_O1")" = true ] && printf 'G22 '
  [ "$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "$CANC_O2")" = true ] && printf 'G23 '
  true
}
echo "-- 6 發閘弱化突變 --"
for m in order_id user_id pending unpaid successor-owner order-owner cancelled cancel-table successor-cancel superseded-null successor-live; do
  gen_mutant "$m" || { bad "MUT-$m" "突變產不出來(anchor 不唯一或不同構)"; continue; }
  cmp -s "$SOCK/mutant.sql" "$BASE_DEF" && { bad "MUT-$m" "突變沒套上(替換後與原定義相同)"; continue; }
  PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1 || { bad "MUT-$m" "突變裝不上去"; restore_base; continue; }
  flipped="$(run_matrix_neg)"; flipped="$(printf '%s' "$flipped" | sed 's/ *$//')"
  restore_base
  case "$m" in
    order_id)        want="G2" ;;
    user_id)         want="G21" ;;
    # 🔴 拿掉 status='pending' 會同時讓 charged 與 released 兩格通 —— 正確簽名是兩格,不是一格。
    #    (寫成一格會在 charged 那格失去判別力而不自知。)
    pending)         want="G4 G9" ;;
    unpaid)          want="G5" ;;
    successor-owner) want="G6" ;;
    order-owner)     want="G13" ;;
    # 整條 IF 弱化 ⇒ cancelled_at 那格與 order_cancellations 那格都會通
    cancelled)       want="G18 G22" ;;
    cancel-table)    want="G22" ;;
    successor-cancel) want="G20 G23" ;;
    superseded-null) want="G15" ;;
    # 拿掉 successor 的 unpaid 條件 ⇒ 只有 G19 翻(G20 由 cancelled_at 那條擋著,兩條是分開的)
    successor-live)  want="G19" ;;
  esac
  [ "$flipped" = "$want" ] && ok "MUT-$m" "翻掉的格=[$flipped](與期望逐字相同)" \
                           || bad "MUT-$m" "翻掉的格=[$flipped],期望=[$want] ⇒ 該閘判別力不成立"
done

# 🔴 MUT-isolation:拿掉隔離閘 ⇒ G24 不再 RAISE。
rm -f "$SOCK/mutant.sql"
python3 - "$BASE_DEF" "$SOCK/mutant.sql" <<'PYEOF'
import sys
src = open(sys.argv[1]).read()
a = "  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN"
if src.count(a) != 1: sys.exit("isolation anchor 非唯一(%d)" % src.count(a))
open(sys.argv[2], 'w').write(src.replace(a, "  IF false THEN"))
PYEOF
if [ -s "$SOCK/mutant.sql" ] && PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1; then
  ISO_MU="$(iso_probe)"; restore_base
  case "$ISO_MU" in
    *'ERROR:  P5A02:'*) bad "MUT-isolation" "拿掉隔離閘後仍 RAISE P5A02 ⇒ 這道閘沒有判別力" ;;
    *) ok "MUT-isolation" "拿掉隔離閘 ⇒ RR 下不再被擋(該閘確實在做事)" ;;
  esac
else
  restore_base; bad "MUT-isolation" "突變裝不上去"
fi

# 🔴 MUT-released-future:拿掉閘⑦ 之後 UPDATE 會真的跑,然後撞 L5a-M 的 CHECK ⑤
#    ⇒ 結果是 23514,不是 true。這一發證的正是「閘⑦ 存在的意義=把約束例外換成乾淨的 false」。
gen_mutant released-future && PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1 && {
  got="$(call pending false "'$O1'" "'$U'" "$R" "'$O2'" "UPDATE public.payment_charge_attempts SET released_at = pg_catalog.now() + interval '1 hour' WHERE id='$A1';")"
  restore_base
  [ "$got" = "CHECK:payment_charge_attempts_superseded_after_release_chk" ] \
    && ok "MUT-released-future" "拿掉閘⑦ ⇒ 未來 released_at 改由 CHECK ⑤ 擋成 23514(閘⑦ 的作用=換成乾淨 false)" \
    || bad "MUT-released-future" "得到 [$got],期望 CHECK:payment_charge_attempts_superseded_after_release_chk"
} || { restore_base; [ "$PASS$FAIL" = "$PASS$FAIL" ] && grep -q MUT-released-future <<<"$LABELS" || bad "MUT-released-future" "突變裝不上去"; }

# 🔴 MUT-orderlock:拿掉 orders 的 FOR UPDATE。單 session 看不出任何行為差異
#    ——這正是 MF-2 的可怕之處:TOCTOU 缺口在單執行緒測試裡**完全隱形**。
#    能看見它的只有 STRUCT-ORDERLOCK 那道結構釘。
gen_mutant orderlock && PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1 && {
  MU_LOCK="$(PSQL -v ON_ERROR_STOP=1 -qtA -c "SELECT pg_catalog.pg_get_functiondef('$FN'::regprocedure)" 2>/dev/null | grep -c '^      FOR UPDATE;$' || true)"
  MU_BEH="$(call pending false "'$O1'" "'$U'" "$R" "'$O2'")"
  restore_base
  { [ "$MU_LOCK" = "0" ] && [ "$MU_BEH" = "true" ]; } \
    && ok "MUT-orderlock" "拿掉 FOR UPDATE:結構釘會紅(FOR UPDATE 數=$MU_LOCK),行為仍 true ⇒ TOCTOU 缺口在單 session 測試裡隱形" \
    || bad "MUT-orderlock" "FOR UPDATE 數=$MU_LOCK(應 0)、行為=[$MU_BEH](應 true)"
} || { restore_base; grep -q MUT-orderlock <<<"$LABELS" || bad "MUT-orderlock" "突變裝不上去"; }

# 🔴 MUT-atomic:把「一個 UPDATE」拆成兩個(先釋鎖、再蓋標記),STRUCT-ATOMIC 必須紅。
#    這一發證的是那道結構斷言**真的有判別力** —— 沒有它,STRUCT-ATOMIC 只是三個 grep 的存在性檢查。
#    ⚠️ 拆完之後**行為完全相同**(同一交易內兩步都會成功)⇒ 12 格矩陣一格都不會紅。
#    那正是 MF-4 說的「壞了也看不出來」:能看見它的只有結構那道。
rm -f "$SOCK/mutant.sql"
python3 - "$BASE_DEF" "$SOCK/mutant.sql" <<'PYEOF'
import sys, re
src = open(sys.argv[1]).read()
a = "         superseded_at             = v_now,\n         superseded_reason         = p_reason,\n         superseded_by_order_id    = p_successor_order_id,\n"
if src.count(a) != 1: sys.exit("atomic anchor 非唯一(%d)" % src.count(a))
split = src.replace(a, "")
# 在第一個 UPDATE 之後,補上第二個只寫標記的 UPDATE(= 拆成兩步的等價實作)
tail = "  GET DIAGNOSTICS v_n = ROW_COUNT;"
if split.count(tail) != 1: sys.exit("tail anchor 非唯一")
second = ("  GET DIAGNOSTICS v_n = ROW_COUNT;\n"
          "  UPDATE public.payment_charge_attempts a\n"
          "     SET superseded_at = v_now, superseded_reason = p_reason,\n"
          "         superseded_by_order_id = p_successor_order_id\n"
          "   WHERE a.order_id = p_order_id AND a.status = 'released' AND a.superseded_at IS NULL;\n")
open(sys.argv[2], 'w').write(split.replace(tail, second, 1))
PYEOF
if PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1; then
  MU_N="$(PSQL -v ON_ERROR_STOP=1 -qtA -c "SELECT pg_catalog.pg_get_functiondef('$FN'::regprocedure)" 2>/dev/null | grep -cE 'UPDATE[[:space:]]+public\.payment_charge_attempts' || true)"
  MU_BEHAVIOUR="$(call pending false "'$O1'" "'$U'" "$R" "'$O2'")"
  restore_base
  { [ "$MU_N" = "2" ] && [ "$MU_BEHAVIOUR" = "true" ]; } \
    && ok "MUT-atomic" "拆成兩個 UPDATE:STRUCT-ATOMIC 會紅(UPDATE 數=$MU_N),而行為仍回 true ⇒ 只有結構那道看得見" \
    || bad "MUT-atomic" "UPDATE 數=$MU_N(應 2)、行為=[$MU_BEHAVIOUR](應 true)"
else
  restore_base; bad "MUT-atomic" "突變裝不上去"
fi

# 🔴 successor-self 這一發**不能**放進上面的迴圈(第一版放了、實跑抓到):
#    把 `p_successor_order_id <> p_order_id` 弱化成 true 之後,UPDATE 會真的執行,
#    但接著撞上 L5a-M 的 CHECK ④(not_self)⇒ 結果是 **CHECK 違反**、不是 `true`
#    ⇒ 只數「回 true」的 run_matrix_neg 看不到它,那一發會誤報成「閘沒有判別力」。
#    正確的期望是「掉到第二層」——這一發證的就是**兩層都在、且可分辨**。
rm -f "$SOCK/mutant.sql"
python3 - "$BASE_DEF" "$SOCK/mutant.sql" <<'PYEOF'
import sys
src = open(sys.argv[1]).read()
# 🔴 R2 之後這條閘搬到**鎖下的前置檢查**(用 = 不是 <>),舊 anchor 會打空。
a = "    IF p_successor_order_id = p_order_id THEN"
if src.count(a) != 1: sys.exit("successor-self anchor 非唯一(%d)" % src.count(a))
open(sys.argv[2], 'w').write(src.replace(a, "    IF false THEN"))
PYEOF
if PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1; then
  got="$(call pending false "'$O1'" "'$U'" "$R" "'$O1'")"
  restore_base
  [ "$got" = "CHECK:payment_charge_attempts_superseded_not_self_chk" ] \
    && ok "MUT-successor-self" "弱化 RPC 閘 ⇒ 改由 L5a-M 的 not_self CHECK 擋下(兩層可分辨、且都不放行)" \
    || bad "MUT-successor-self" "得到 [$got],期望 CHECK:payment_charge_attempts_superseded_not_self_chk"
else
  restore_base; bad "MUT-successor-self" "突變裝不上去"
fi

# 🔴 reason RAISE 那道單獨一發:拿掉它之後,壞值不會變成「靜靜讓路」,而是掉到 L5a-M 的 CHECK 上。
#    這一發要證的正是**兩層是可分辨的** —— 沒有它,「RAISE 其實沒作用、只是 CHECK 在擋」看不出來。
rm -f "$SOCK/mutant.sql"
python3 - "$BASE_DEF" "$SOCK/mutant.sql" <<'PYEOF'
import sys
src = open(sys.argv[1]).read()
a = "  IF p_reason IS NULL OR p_reason NOT IN ('record_not_found', 'stuck_pending') THEN"
if src.count(a) != 1: sys.exit("reason anchor 非唯一(%d)" % src.count(a))
open(sys.argv[2], 'w').write(src.replace(a, "  IF false THEN"))
PYEOF
if PSQL -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1; then
  got="$(call pending false "'$O1'" "'$U'" "'bogus'" "'$O2'")"
  restore_base
  [ "$got" = "CHECK:payment_charge_attempts_superseded_reason_chk" ] \
    && ok "MUT-reason-raise" "拿掉 RAISE ⇒ 壞值改由 L5a-M 的 reason CHECK 擋下(兩層可分辨、且都不放行)" \
    || bad "MUT-reason-raise" "得到 [$got],期望 CHECK:payment_charge_attempts_superseded_reason_chk"
else
  restore_base; bad "MUT-reason-raise" "突變裝不上去"
fi

echo
GOT="$(printf '%s\n' $LABELS | sort | tr '\n' ' ' | sed 's/ *$//')"
WANT="$(printf '%s\n' $MANIFEST | sort | tr '\n' ' ' | sed 's/ *$//')"
echo "PASS=$PASS FAIL=$FAIL"
[ "$GOT" = "$WANT" ] || { echo "🔴 label 清單不符"; echo "   實跑=[$GOT]"; echo "   期望=[$WANT]"; exit 1; }
[ "$FAIL" = 0 ] || exit 1
echo "✅ L5a-1 全綠(58 條斷言=2+11+3+25+17,與檔頭同源:2 provenance 偵測器 + 11 可呼面守門格 + 3 結構釘 + 25 格矩陣 + 11 發閘弱化突變 + 6 發特殊突變)"
