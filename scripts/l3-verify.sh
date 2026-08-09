#!/usr/bin/env bash
# ============================================================
# L3 驗證 harness:pcm_cron.expire_unpaid_orders(未付款訂單自動失效)
#   + 補跑 L2(20260809140000)欠的行為斷言(D 區 4 格)
# ============================================================
# plan = docs/specs/2026-08-09-order-payment-lifecycle-plan.md 件①
# 用法:scripts/d1t2-rehearsal.sh provision /tmp/l3-work
#       scripts/l3-verify.sh [workdir]
#
# 形狀照 a2b1-verify.sh / a5a-verify.sh:計數器 + 身分閘 + 每格自包 BEGIN…ROLLBACK 零留痕
# + DB 內突變格(改壞函式 → 驗**對應那些格**翻面 → 還原)。
# ⚠️ 每個突變只重跑「最能代表它」的那一格,**不宣稱「只翻一格」**(codex 關卡2:拿掉 NOT EXISTS
#   實際會同時翻 A3/A4/A8)。要證明的是「拿掉守門 ⇒ 對應斷言會紅」,不是「其他斷言不受影響」。
#
# 🔴 為什麼補跑 L2 的格:`20260809140000` 的檔頭原先把「T1-T5 交易模擬」寫成過去式語氣,
#    但**實際上一格都沒跑**(P 窗自曝、P-240-STOP)。主視窗裁定(P-241):該片的權限兩格已隨
#    apply 跑過,行為格改在此補。本檔 D1=原 T1、D4=原 T4,D2/D3 補 ELSE 守門與既有碼零回歸。
#
# ⚠️ 誠實邊界:
#   · 本機 vanilla PG17 ≠ Supabase(無 pg_cron / 無 RLS 情境 / auth.uid() 回 NULL)。
#     ⇒ **排程那半(L3b `20260809170000`)零本機證據**,只有它自己 apply 當下的 fail-closed 斷言。
#   · 本 harness 測的是「函式在什麼條件下改了哪些列」,不是併發與鎖行為。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="${1:-/tmp/l3-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
FN="pcm_cron.expire_unpaid_orders(integer)"
MIGFILE="supabase/migrations/20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql"
PASS=0; FAIL=0; MUT=0
# 🔴 突變是在交易外改真函式(CREATE OR REPLACE 不能在被別的連線讀的同時回滾)⇒ 中斷於還原前,
#    這個隔離 DB 會永久留著壞函式,而之後任何人再跑別的 harness 都在測錯的東西(codex 關卡2)。
#    trap 保證 Ctrl-C / kill 也會還原。
RESTORE_ON_EXIT=""
cleanup() {
  if [ -n "$RESTORE_ON_EXIT" ]; then
    printf '%s' "$RESTORE_ON_EXIT" | psql "$URL" -qtA -v ON_ERROR_STOP=1 -f - >/dev/null 2>&1 \
      && echo "  ♻️  trap:函式已還原" >&2 || echo "  🔴 trap:還原失敗,這個 cluster 已污染" >&2
  fi
}
trap cleanup EXIT
# 🔴 INT/TERM 要**明確退出**(codex 確認輪):只掛 cleanup 的話,還原完腳本會繼續往下跑、再突變一次。
#    退出時 EXIT trap 會再跑一次 cleanup,那時 RESTORE_ON_EXIT 已清空、是無害的 no-op。
trap 'echo "  ⚠️ 收到中斷訊號,還原後結束" >&2; cleanup; RESTORE_ON_EXIT=""; exit 130' INT TERM

q() { psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
qf() { psql "$URL" -qtA -v ON_ERROR_STOP=1 -f "$1" 2>&1; }

cell() { # cell <名稱> <期望> <實得>
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); printf '  ✅ %-58s = %s\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %-58s 期望 %s 實得 %s\n' "$name" "$want" "$got"
  fi
}

# ── 身分閘(跑錯庫比跑錯斷言更糟)────────────────────────────────────────────
echo "== 身分閘 =="
if ! q "SELECT 1" >/dev/null 2>&1; then
  echo "🔴 連不上 $URL —— 先跑 scripts/d1t2-rehearsal.sh provision $WORK"; exit 1
fi
HAS_FN="$(q "SELECT count(*) FROM pg_proc p WHERE p.oid='${FN}'::regprocedure")"
[ "$HAS_FN" = "1" ] || { echo "🔴 ${FN} 不存在(L3a 未套用?);拒繼續"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 找不到 $MIGFILE"; exit 1; }
NORD="$(q "SELECT count(*)::text FROM public.orders")"
if [ "${NORD:-0}" -lt 3 ]; then
  echo "🔴 orders 只有 ${NORD} 筆 —— B 區的批次上限格需要至少 3 筆才有判別力(1 筆時「退回 1」與「無上限」給同一個答案);拒繼續"
  exit 1
fi
# 🔴 DB 上那支函式必須是**本檔案這一版**(codex 關卡2):否則對舊函式跑出 21/0 也毫無意義。
#    用兩個本片特徵字串當指紋(它們同時出現在 migration 與函式體內)。
# 🔴 指紋要涵蓋「安全性所在的那幾行」,不能只挑兩個好認的字串(codex 確認輪):
#    改壞 WHERE、拿掉 SECURITY DEFINER、或動 search_path/owner,都必須讓這道閘紅。
#    ⚠️ 誠實邊界:這是**錨點比對**、不是 exact pin —— 沒用 functiondef 的 md5,因為它會隨 PG 版本的
#    格式化差異假紅。少一個錨就擋得住,但錨以外的改動(例如換掉 RAISE LOG 的訊息)它看不見。
DEF_OK="$(q "SELECT (p.prosecdef AND p.proowner = 'postgres'::regrole
                     AND p.proconfig @> ARRAY['search_path=\"\"'])::text
                FROM pg_proc p WHERE p.oid = '${FN}'::regprocedure")"
ANCHORS_OK="$(q "SELECT (position('payment_expired' in d) > 0
                      AND position('expire_unpaid_orders] expired' in d) > 0
                      AND position('status <> ''failed''' in d) > 0
                      AND position('interval ''1 day''' in d) > 0
                      AND position('SKIP LOCKED' in d) > 0)::text
                 FROM (SELECT pg_get_functiondef('${FN}'::regprocedure) AS d) s")"
if [ "$DEF_OK" != "true" ] || [ "$ANCHORS_OK" != "true" ]; then
  echo "🔴 DB 上的 ${FN} 不是本片這一版(secdef/owner/search_path=$DEF_OK、錨=$ANCHORS_OK)—— 重跑 provision;拒繼續"
  exit 1
fi
echo "  ok:${FN} 在且為本片版本、migration 檔在、orders=${NORD} 筆(≥3)、workdir=${WORK}"

# 造資料共用片段:把「所有既有 orders」推到失效條件之外(created_at=now()),
# 再把指定那筆設成想要的形狀 ⇒ 每格只有一筆候選,計數可判別。
SETUP='UPDATE public.orders SET created_at = pg_catalog.now(), cancelled_at = NULL;'
PICK="(SELECT id FROM public.orders ORDER BY id LIMIT 1)"
PICK2="(SELECT id FROM public.orders ORDER BY id OFFSET 1 LIMIT 1)"

BEFORE_SNAP="$(q "SELECT (SELECT count(*) FROM public.orders)::text || '|' ||
                        (SELECT count(*) FROM public.payment_charge_attempts)::text || '|' ||
                        (SELECT coalesce(max(created_at)::text,'-') FROM public.orders) || '|' ||
                        (SELECT count(*) FROM public.orders WHERE cancelled_at IS NOT NULL)::text || '|' ||
                        -- 🔴 真的「全欄」(codex 確認輪:原本只挑 5 欄/3 欄,其餘欄位被改仍會假綠)——
                        --    用整列的 ::text,任何一欄變動都會改變指紋。
                        (SELECT md5(string_agg(o::text, ',' ORDER BY o.id)) FROM public.orders o) || '|' ||
                        (SELECT coalesce(md5(string_agg(a::text, ',' ORDER BY a.id)),'-')
                           FROM public.payment_charge_attempts a)")"

echo
echo "== A 區:失效條件(每格自包 BEGIN…ROLLBACK)=="

# A1 超過 1 天 + 零非終態 attempt → 失效
cell "A1 超過1天+零非終態attempt → 失效" "1|payment_expired" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '2 days' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A2 剛好差一點(23 小時)→ 不動(邊界另一側)
cell "A2 建立 23:59:59(差 1 秒未滿)→ 不動(精確邊界)" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '23 hours 59 minutes 59 seconds' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A3 🔴 安全核心:有 pending attempt(錢可能在途)→ 一律不碰
cell "A3 🔴 有 pending attempt → 不動(安全核心)" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'pending', repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A4 有 charged attempt → 不動
cell "A4 🔴 有 charged attempt → 不動" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
-- 🔴 CHECK payment_charge_attempts_check:status='charged' 必須帶 rec_trade_id
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash, rec_trade_id)
SELECT o.id, o.customer_user_id, 'charged', repeat('a',64), 'D-L3VERIFY-1' FROM public.orders o WHERE o.id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A5 attempt 全 failed → 失效(證明判準是「非終態」而不是「有沒有 attempt」)
cell "A5 attempt 全 failed → 失效(判準是非終態)" "1|payment_expired" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'failed', repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A6 已被客服取消 → 冪等不覆寫(reason 保持原值)
cell "A6 已取消 → 不覆寫(冪等)" "客服取消" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days',
       cancelled_at=pg_catalog.now()-interval '3 days', cancelled_reason='客服取消' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT cancelled_reason FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A7 已付款 → 不動
cell "A7 payment_status=paid → 不動" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='paid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A8 released attempt → 不動(`<> 'failed'` 也擋 released;拿掉它這格會翻)
cell "A8 🔴 有 released attempt → 不動" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'released', repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"

# A9 其餘三個 payment_status 值都不得被失效
#    🔴 只測 paid 是不夠的(codex 關卡2):把條件寫成「非 paid」時,partiallyPaid / refunded /
#    partiallyRefunded 會被誤殺,而只有 paid 那格的 harness 照樣全綠。
for PS in partiallyPaid refunded partiallyRefunded; do
cell "A9 payment_status=$PS → 不動" "0|-" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='$PS', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int || '|' || coalesce(cancelled_reason,'-') FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"
done

echo
echo "== B 區:批次上限與排序 =="

# B1 p_limit=1 → 只處理一筆,且是最舊那筆
cell "B1 p_limit=1 → 只 1 筆,且取最舊" "1|old" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id IN ($PICK, $PICK2);
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '30 days' WHERE id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '2 days'  WHERE id = $PICK2;
SELECT pcm_cron.expire_unpaid_orders(1);
SELECT (SELECT count(*) FROM public.orders WHERE cancelled_reason='payment_expired')::text
       || '|' || CASE WHEN (SELECT cancelled_at FROM public.orders WHERE id = $PICK) IS NOT NULL
                      THEN 'old' ELSE 'wrong' END;
ROLLBACK;" | tail -1)"

# B2 p_limit=0 / NULL → 退回 1(不得變成無上限、也不得 0 筆都不做)
cell "B2 p_limit=0 → 退回 1(不是 0、也不是無上限)" "1" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id IN ($PICK, $PICK2);
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '30 days' WHERE id IN ($PICK, $PICK2);
SELECT pcm_cron.expire_unpaid_orders(0);
SELECT count(*)::text FROM public.orders WHERE cancelled_reason='payment_expired';
ROLLBACK;" | tail -1)"

cell "B2b p_limit=NULL → 退回 1" "1" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id IN ($PICK, $PICK2);
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '30 days' WHERE id IN ($PICK, $PICK2);
SELECT pcm_cron.expire_unpaid_orders(NULL);
SELECT count(*)::text FROM public.orders WHERE cancelled_reason='payment_expired';
ROLLBACK;" | tail -1)"

# M9:RPC 的回傳值原本一格都沒驗 —— 函式恆回 0 也會全綠。這格直接讀回傳值。
#     ⚠️ 更正(codex 關卡2):回傳值**不會**出現在 cron.job_run_details.return_message ——
#     pg_cron 對 SELECT 記的是 command tag。筆數的觀測點是函式內的 RAISE LOG 與 orders 查詢。
cell "B3 回傳值 = 實際改動筆數(不是恆 0)" "2|2" "$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id IN ($PICK, $PICK2);
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '30 days' WHERE id IN ($PICK, $PICK2);
-- 🔴 兩件事必須拆成兩句:同一句 SELECT 裡的子查詢看的是**語句開始時**的快照,
--    函式在同句內做的 UPDATE 看不到 ⇒ 會恆得 0(本 harness 實測踩過,差點把好的回傳值判成壞的)。
CREATE TEMP TABLE l3ret AS SELECT pcm_cron.expire_unpaid_orders(500) AS n;
SELECT (SELECT n FROM l3ret)::text || '|' ||
       (SELECT count(*) FROM public.orders WHERE cancelled_reason='payment_expired')::text;
ROLLBACK;" | tail -1)"

echo
echo "== C 區:權限(client role 一格都不得有)=="
cell "C1 anon/authenticated/service_role/payment_confirmer 零 EXECUTE" "false|false|false|false" "$(q "
SELECT has_function_privilege('anon','${FN}','EXECUTE')::text || '|' ||
       has_function_privilege('authenticated','${FN}','EXECUTE')::text || '|' ||
       has_function_privilege('service_role','${FN}','EXECUTE')::text || '|' ||
       has_function_privilege('payment_confirmer','${FN}','EXECUTE')::text;")"

# 🔴 誠實標註(code-reviewer M7):新建 schema 本來就沒有給 PUBLIC USAGE ⇒ §1 的 REVOKE 對 USAGE 是 no-op,
#    **這格今天恆真、零判別力**。留著的理由是回歸:未來有人 GRANT USAGE ON SCHEMA pcm_cron 時它會紅。
#    ⚠️ 不得把它當「權限有被鎖上」的證據 —— 真正有判別力的是 C1(拿掉 REVOKE 會翻紅,已實測)。
cell "C2 pcm_cron 零 USAGE(回歸格、今天恆真、非證據)" "false|false|false" "$(q "
SELECT has_schema_privilege('anon','pcm_cron','USAGE')::text || '|' ||
       has_schema_privilege('authenticated','pcm_cron','USAGE')::text || '|' ||
       has_schema_privilege('service_role','pcm_cron','USAGE')::text;")"

echo
echo "== D 區:補跑 L2(20260809140000)的行為格 =="
# 造一筆 unpaid order + pending attempt,呼 retry RPC 看 last_settle_error 存了什麼。
cell "D1(L2-T1)reason=record_not_found → 存 record_not_found" "1|record_not_found" "$(q "
BEGIN;
UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL WHERE id = $PICK;
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, settle_attempt_count, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'pending', 0, repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT public.mark_attempt_settle_retry(
  (SELECT id FROM public.payment_charge_attempts WHERE order_id = $PICK), 0, 'record_not_found');
SELECT (SELECT count(*) FROM public.payment_charge_attempts WHERE order_id = $PICK)::text
       || '|' || (SELECT last_settle_error FROM public.payment_charge_attempts WHERE order_id = $PICK);
ROLLBACK;" | tail -1)"

cell "D2(ELSE 仍守)reason=bogus_xyz → 存 unknown" "unknown" "$(q "
BEGIN;
UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL WHERE id = $PICK;
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, settle_attempt_count, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'pending', 0, repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT public.mark_attempt_settle_retry(
  (SELECT id FROM public.payment_charge_attempts WHERE order_id = $PICK), 0, 'bogus_xyz');
SELECT last_settle_error FROM public.payment_charge_attempts WHERE order_id = $PICK;
ROLLBACK;" | tail -1)"

cell "D3(既有碼零回歸)reason=record_unverified → 原值" "record_unverified" "$(q "
BEGIN;
UPDATE public.orders SET payment_status='unpaid', cancelled_at=NULL WHERE id = $PICK;
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, settle_attempt_count, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'pending', 0, repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT public.mark_attempt_settle_retry(
  (SELECT id FROM public.payment_charge_attempts WHERE order_id = $PICK), 0, 'record_unverified');
SELECT last_settle_error FROM public.payment_charge_attempts WHERE order_id = $PICK;
ROLLBACK;" | tail -1)"

cell "D4(L2-T4)webhook reason=record_not_found → 存 record_not_found" "record_not_found" "$(q "
BEGIN;
INSERT INTO public.payment_webhook_events (rec_trade_id, order_number, raw_hash, processed, attempt_count)
VALUES ('L3VERIFY-REC-1', (SELECT id::text FROM public.orders ORDER BY id LIMIT 1), repeat('b',64), false, 0);
SELECT public.mark_webhook_retry('L3VERIFY-REC-1', 0, 'record_not_found');
SELECT last_error FROM public.payment_webhook_events WHERE rec_trade_id='L3VERIFY-REC-1';
ROLLBACK;" | tail -1)"

echo
echo "== E 區:突變(證明上面那些格真的有判別力)=="
mutate() { # 套用一份完整的 CREATE OR REPLACE 定義;🔴 不得吞錯:
  #   吞掉的話,「突變根本沒套用」會長得跟「守門有效」一模一樣(假綠的經典形狀)。
  local out
  if ! out="$(psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" 2>&1)"; then
    echo "  🔴 突變/還原 SQL 失敗,harness 停止(否則後續每一格都在測錯的東西):"
    echo "$out" | head -3
    exit 1
  fi
}
# 原始定義備份(用 pg_get_functiondef 取,還原時原樣灌回)
ORIG_DEF="$(q "SELECT pg_get_functiondef('${FN}'::regprocedure)")"
RESTORE_ON_EXIT="$ORIG_DEF"

# E1 拿掉「無非終態 attempt」那條 ⇒ A3(pending)必須翻面
MUT_DEF="$(printf '%s' "$ORIG_DEF" | python3 -c "
import sys,re
s=sys.stdin.read()
s=re.sub(r'AND NOT EXISTS \(.*?\)\n', '', s, flags=re.S)
print(s)")"
mutate "$MUT_DEF"
GOT="$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash)
SELECT o.id, o.customer_user_id, 'pending', repeat('a',64) FROM public.orders o WHERE o.id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"
if [ "$GOT" = "1" ]; then MUT=$((MUT+1)); echo "  ✅ E1 拿掉 NOT EXISTS ⇒ A3 翻面(pending 單被失效)= A3 有判別力"
  echo "     ⚠️ 這個突變同時也會翻 A4/A8(charged/released)—— 本格只重跑 A3 情境,不宣稱「只翻一格」"
else FAIL=$((FAIL+1)); echo "  ❌ E1 突變後 A3 沒翻面(實得 $GOT)⇒ A3 證明不了那條守門"; fi
mutate "$ORIG_DEF"

# E2 把 1 day 改成 1 second ⇒ A2(23 小時)必須翻面
MUT_DEF="$(printf '%s' "$ORIG_DEF" | sed "s/interval '1 day'/interval '1 second'/")"
mutate "$MUT_DEF"
GOT="$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '23 hours 59 minutes 59 seconds' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"
if [ "$GOT" = "1" ]; then MUT=$((MUT+1)); echo "  ✅ E2 1 day→1 second ⇒ A2 翻面 = 天數邊界有判別力"
else FAIL=$((FAIL+1)); echo "  ❌ E2 突變後 A2 沒翻面(實得 $GOT)⇒ A2 證明不了天數邊界"; fi
mutate "$ORIG_DEF"

# E3 拿掉 payment_status='unpaid' 閘 ⇒ A7(paid 單)必須翻面
MUT_DEF="$(printf '%s' "$ORIG_DEF" | sed "s/o.payment_status = 'unpaid'::public.payment_status/true/")"
mutate "$MUT_DEF"
GOT="$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='paid', created_at=pg_catalog.now()-interval '9 days' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT (cancelled_at IS NOT NULL)::int FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"
if [ "$GOT" = "1" ]; then MUT=$((MUT+1)); echo "  ✅ E3 拿掉 unpaid 閘 ⇒ A7 翻面 = A7 有判別力"
else FAIL=$((FAIL+1)); echo "  ❌ E3 突變後 A7 沒翻面(實得 $GOT)"; fi
mutate "$ORIG_DEF"

# E4 拿掉 cancelled_at IS NULL(冪等閘)⇒ A6 必須翻面(reason 被覆寫成 payment_expired)
MUT_DEF="$(printf '%s' "$ORIG_DEF" | sed "s/o.cancelled_at IS NULL/true/")"
mutate "$MUT_DEF"
GOT="$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '9 days',
       cancelled_at=pg_catalog.now()-interval '3 days', cancelled_reason='客服取消' WHERE id = $PICK;
SELECT pcm_cron.expire_unpaid_orders(500);
SELECT cancelled_reason FROM public.orders WHERE id = $PICK;
ROLLBACK;" | tail -1)"
if [ "$GOT" = "payment_expired" ]; then MUT=$((MUT+1)); echo "  ✅ E4 拿掉 cancelled_at IS NULL ⇒ A6 翻面 = 冪等閘有判別力"
else FAIL=$((FAIL+1)); echo "  ❌ E4 突變後 A6 沒翻面(實得 $GOT)"; fi
mutate "$ORIG_DEF"

# E5 排序反轉(ORDER BY created_at DESC)⇒ B1「取最舊」必須翻面
#    🔴 直接拿掉 ORDER BY 不算突變:堆序可能碰巧仍回最舊那筆 = 假綠(code-reviewer N1)。反轉才必然翻面。
MUT_DEF="$(printf '%s' "$ORIG_DEF" | sed "s/ORDER BY o.created_at/ORDER BY o.created_at DESC/")"
mutate "$MUT_DEF"
GOT="$(q "
BEGIN;
$SETUP
DELETE FROM public.payment_charge_attempts WHERE order_id IN ($PICK, $PICK2);
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '30 days' WHERE id = $PICK;
UPDATE public.orders SET payment_status='unpaid', created_at=pg_catalog.now()-interval '2 days'  WHERE id = $PICK2;
SELECT pcm_cron.expire_unpaid_orders(1);
SELECT CASE WHEN (SELECT cancelled_at FROM public.orders WHERE id = $PICK) IS NOT NULL THEN 'old' ELSE 'new' END;
ROLLBACK;" | tail -1)"
if [ "$GOT" = "new" ]; then MUT=$((MUT+1)); echo "  ✅ E5 排序反轉 ⇒ B1 翻面(改成處理最新那筆)= 排序有判別力"
else FAIL=$((FAIL+1)); echo "  ❌ E5 突變後 B1 沒翻面(實得 $GOT)"; fi
mutate "$ORIG_DEF"
RESTORE_ON_EXIT=""

# 還原確認(突變殘留 = 之後每一格都在測錯的東西)。
# 🔴 不比整段字面:pg_get_functiondef 會重排空白與換行,逐字比對恆假 = 假紅(本 harness 實測踩過)。
#    改比「兩個被突變拿掉的錨都回來了」——正是 E1/E2 各自改掉的那兩處。
BACK="$(q "SELECT (position('NOT EXISTS' in pg_get_functiondef('${FN}'::regprocedure)) > 0 AND position('1 day' in pg_get_functiondef('${FN}'::regprocedure)) > 0 AND position('unpaid' in pg_get_functiondef('${FN}'::regprocedure)) > 0 AND position('cancelled_at IS NULL' in pg_get_functiondef('${FN}'::regprocedure)) > 0 AND position('ORDER BY o.created_at' in pg_get_functiondef('${FN}'::regprocedure)) > 0)::text")"
if [ "$BACK" = "true" ]; then PASS=$((PASS+1)); echo "  ✅ E9 突變已還原(NOT EXISTS / 1 day / unpaid / cancelled_at IS NULL / ORDER BY 五個錨都回來了)"
else FAIL=$((FAIL+1)); echo "  ❌ E9 突變未還原 —— DB 現在是壞的,別用這個 cluster 跑別的 harness"; fi

echo
echo "== F 區:零留痕 =="
# 🔴 只查「新增型標記」是不夠的(code-reviewer M8):SETUP 對**全表** orders 做 UPDATE、
#    各格另有 DELETE attempts —— 那兩類留痕在「count payment_expired」裡 100% 看不見。
#    故改比對前後快照(筆數 + created_at/cancelled_at 的聚合指紋),對齊 scripts/a5a-verify.sh 慣例。
AFTER_SNAP="$(q "SELECT (SELECT count(*) FROM public.orders)::text || '|' ||
                        (SELECT count(*) FROM public.payment_charge_attempts)::text || '|' ||
                        (SELECT coalesce(max(created_at)::text,'-') FROM public.orders) || '|' ||
                        (SELECT count(*) FROM public.orders WHERE cancelled_at IS NOT NULL)::text || '|' ||
                        -- 🔴 真的「全欄」(codex 確認輪:原本只挑 5 欄/3 欄,其餘欄位被改仍會假綠)——
                        --    用整列的 ::text,任何一欄變動都會改變指紋。
                        (SELECT md5(string_agg(o::text, ',' ORDER BY o.id)) FROM public.orders o) || '|' ||
                        (SELECT coalesce(md5(string_agg(a::text, ',' ORDER BY a.id)),'-')
                           FROM public.payment_charge_attempts a)")"
cell "F0 全庫快照與開跑前逐字相同(筆數/最新 created_at/已取消數)" "$BEFORE_SNAP" "$AFTER_SNAP"
RESID="$(q "SELECT count(*)::text FROM public.orders WHERE cancelled_reason='payment_expired'")"
cell "F1 全庫零 payment_expired 殘留(每格都 ROLLBACK 了)" "0" "$RESID"
RESID2="$(q "SELECT count(*)::text FROM public.payment_webhook_events WHERE rec_trade_id='L3VERIFY-REC-1'")"
cell "F2 webhook fixture 零殘留" "0" "$RESID2"

echo
echo "================ 結果 ================"
echo "PASS=$PASS  FAIL=$FAIL  突變命中=$MUT"
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全綠"
