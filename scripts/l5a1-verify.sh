#!/bin/bash
# ============================================================
# L5a-1 verify:`20260810010000` supersede_charge_attempt_for_user 的鎖下前置 + attempt 側各道閘的判別力。
#
# 用法:scripts/l5a1-verify.sh   (自建拋棄式 cluster、跑完自動 teardown;不碰任何正式庫)
# 真權威:母 plan §3.1 + P-280-STOP §5 + 本片 migration 檔頭。
#
# 🔴 兩層,缺一層都證不完:
#   【matrix】23 格行為矩陣 —— 對現行定義跑,證明它**做了什麼**(每格只讓一道不成立)。
#   【mutations】16 發突變(11 發閘弱化 + 5 發特殊)—— 每發把**一道弱化、保留結構**(不是整段拿掉),
#                 斷言**恰好**對應的那些格翻掉。只要求「至少一格翻」等於沒有判別力。
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
MANIFEST="ACL-UNIVERSAL G24 G25 MUT-cancel-table MUT-isolation STRUCT-LOCKSET MUT-successor-cancel G1 G10 G11 G12 G13 G14 G15 G16 G17 G18 G19 G20 G21 G22 G23 G2 G3 G4 G5 G6 G7 G8 G9 MUT-atomic MUT-cancelled MUT-order-owner MUT-order_id MUT-orderlock MUT-pending MUT-reason-raise MUT-released-future MUT-successor-live MUT-successor-owner MUT-successor-self MUT-superseded-null MUT-unpaid MUT-user_id SOLE-WRITER STRUCT-ATOMIC STRUCT-ORDERLOCK"

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
echo "✅ L5a-1 全綠(47 條斷言:2 provenance 偵測器 + 3 結構釘 + 25 格矩陣 + 11 發閘弱化突變 + 6 發特殊突變)"
