#!/usr/bin/env bash
# ============================================================
# 片 D3-b:沖銷 RPC 的【行為】驗證 —— admin_void_manual_refund
# ============================================================
# 🔴 **這支是那個行為的唯一載體。** migration 的後置斷言只回答
#    「我剛才那一發 DDL 做出了我要的東西嗎」,它**不驗行為**;
#    而 repo 測試(refund-remaining-single-source.test.ts)驗的是**函式本體的字面**,也不是行為。
#    ⇒ 冪等、換人必拒、可退餘額差額 —— **只有這裡驗。**
#
# ⚠️ **它不在 CI ⇒ 不會自己紅。** 所以它的路徑寫在兩個「你本來就會打開」的地方:
#    ① `admin_void_manual_refund` 的 COMMENT ON FUNCTION(動那支 RPC 的人一定會讀)
#    ② `refund-remaining-single-source.test.ts` 的檔頭(那道守門紅的時候,人正好在現場)
#
# ── 為什麼不放在 migration 裡(2026-08-20 codex R2 + 主視窗裁定)────────────
#   ① 在 migration 裡要**借正式資料** ⇒ 空庫整支失敗;活庫則兩次餘額查詢之間可能有真流量改帳
#   ② 借不到第二位 active staff 時「換人必拒」那格會靜靜跳過,而總結仍說「四世界皆表演過」
#   ③ 「交易內自己造資料」雙重不通:`INSERT INTO public.orders` 踩 subtotal-writers-allowlist
#      (那張表是金額欄寫入者的登記簿),且片1a 兩支 trigger 會在 COMMIT 時擋
#   ⇒ **拋棄式 PG 沒有這些限制:自己造、造完整台丟掉。**
#
# ── 用法 ────────────────────────────────────────────────
#   bash scripts/d3b-void-probe.sh
#   零參數、不碰任何 .env、不連任何正式庫。跑完自己收攤。
#
# ── 🔴 效度限制(不放寬)────────────────────────────────
#   · 前置是**最小合成 schema**(orders / staff / order_refunds / 一支 stub),不是真 schema
#     ⇒ 它證的是「這支 RPC 在它的前置條件下行為對」,**不是「在正式庫會怎樣」**
#   · 併發只驗單一連線的邏輯分支;兩 session 競態見 W1-085 附錄那支四世界探針
set -uo pipefail
export LC_ALL=C LANG=C
W=/tmp/d3b-void-probe; P=55761
U="postgresql://postgres@127.0.0.1:$P/postgres"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_A="$ROOT/supabase/migrations/20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql"
MIG_B="$ROOT/supabase/migrations/20260820100000_m4b_e10_d3b_void_manual_refund.sql"
# 🔴🔴 **2026-08-30 線A `-e9` 加(D3-d 帳不塗改;R3 對抗審查 F2)**:
#    D3-d 在 `order_manual_refunds` 掛了一支 BEFORE UPDATE trigger(帳體九欄不可變 / 作廢是終態),
#    而**這支 RPC 是全 repo 唯一會 UPDATE 那張表的呼叫端**。
#    ⇒ 在此之前,**「真 RPC × 新 trigger」這一格是空的**:
#      · 本檔套了真 RPC 而**沒有** D3-d ⇒ 它量不到 trigger 會不會擋它
#      · `scripts/d3d-immutable-verify.sh` 有 D3-d 而作廢那一發是**手打的替身 SQL** ⇒ 量的不是真 RPC
#    📌 **兩支各自全綠, 而它們的分母【加起來】仍然漏掉中間那一格。**
#      失敗情境:日後有人在 `20260820100000:358-362` 的 SET 清單多加一欄(例如 updated_at)
#      ⇒ 正式庫的作廢當場 P2B45 全滅, 而**兩支 harness 都不會紅**。
MIG_D3D="$ROOT/supabase/migrations/20260830050000_m4b_e10_d3d_manual_refund_immutable.sql"
q(){ psql "$U" -tAX -c "$1" 2>&1; }
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }

for m in "$MIG_A" "$MIG_B" "$MIG_D3D"; do
  test -f "$m" || { echo "🔴 找不到 $m;拒跑"; exit 1; }
done

pg_ctl -D $W/pg stop -m immediate >/dev/null 2>&1
rm -rf $W && mkdir -p $W/pg
initdb -D $W/pg -U postgres -E UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 1; }
pg_ctl -D $W/pg -o "-p $P -k /tmp" -l $W/log start >/dev/null 2>&1
for i in $(seq 1 30); do q "SELECT 1" >/dev/null 2>&1 && break; sleep 0.3; done
[ "$(q 'SELECT 1')" = "1" ] || { echo "🔴 PG 起不來"; tail -5 $W/log; exit 1; }

# ── 前置:最小合成 schema（自己造,不借任何東西)──────────────────────
q "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
     -- 2026-08-30 線A -e9 補:D3-d 的 REVOKE 點名了 authenticator(照 op2b 家法),
     --    而本檔原本沒建它 ⇒ 套 D3-d 當場報 role authenticator does not exist。
     --    正式庫有這個角色 —— 少的是本檔的合成前置, 不是 migration 寫錯。
     --    🔴 這三行刻意不用反引號:整個 DO 區塊住在一個【雙引號 shell 字串】裡,
     --       反引號會被 bash 當命令替換吃掉(我第一版就是這樣, 畫面上跳出
     --       'line 71: -e9: command not found' 三行, 而 SQL 仍然跑掉了一部分)。
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator; END IF;
   END \$\$;" >/dev/null
q "CREATE FUNCTION public.pcm_b2_is_blank(t text) RETURNS boolean LANGUAGE sql IMMUTABLE
   SET search_path = pg_catalog AS \$fn\$ SELECT pg_catalog.btrim(pg_catalog.translate(COALESCE(t,''),
     E'\t\n\r\v\f' || U&'\00A0' || U&'\3000', '       ')) = '' \$fn\$;" >/dev/null
q "CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), total integer NOT NULL DEFAULT 5000);
   CREATE TABLE public.staff(id text PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
   CREATE TABLE public.order_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
     refund_amount integer NOT NULL, status text NOT NULL, failed_reason text);
   CREATE VIEW public.order_refund_effective_verdict AS
     SELECT id AS refund_id, 'money_moved'::text AS corrected_to FROM public.order_refunds WHERE false;
   CREATE TABLE public.order_manual_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id uuid NOT NULL REFERENCES public.orders(id), request_id uuid NOT NULL,
     rail text NOT NULL CHECK (rail IN ('bank_transfer','cash')),
     refund_amount integer NOT NULL CHECK (refund_amount > 0),
     reason text NOT NULL, actor text NOT NULL, occurred_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now());
   CREATE FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)
     RETURNS jsonb LANGUAGE sql AS \$\$ SELECT '{}'::jsonb \$\$;
   REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz) TO service_role;
   INSERT INTO public.staff(id,is_active) VALUES ('alice',true),('bob',true),('gone',false);
   INSERT INTO public.orders DEFAULT VALUES;" >/dev/null
# 20260820010000 留下的那一版可退餘額函式(三段、尚無作廢分流)
q "CREATE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid) RETURNS bigint
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$
     SELECT o.total::bigint
          - COALESCE(
              (SELECT SUM(r.refund_amount)
                 FROM public.order_refunds r
                WHERE r.order_id = o.id
                  AND r.status IN ('processing', 'confirmed')), 0)
          - COALESCE(
              (SELECT SUM(r.refund_amount)
                 FROM public.order_refunds r
                 JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
                WHERE r.order_id = o.id
                  AND r.status = 'failed'
                  AND r.failed_reason = 'manual_failed'
                  AND v.corrected_to = 'money_moved'), 0)
          - COALESCE(
              (SELECT SUM(m.refund_amount)
                 FROM public.order_manual_refunds m
                WHERE m.order_id = o.id), 0)
       FROM public.orders o
      WHERE o.id = p_order_id \$fn\$;" >/dev/null

echo "── 套用三支 migration(真檔,不是複製品;D3-d 必須排最後 —— 它的欄位分母守門要先有 MIG_A 的三個作廢欄)──"
for m in "$MIG_A" "$MIG_B" "$MIG_D3D"; do
  if psql "$U" -v ON_ERROR_STOP=1 -f "$m" >$W/apply.txt 2>&1; then
    ok "apply $(basename $m)"
  else bad "apply $(basename $m)"; tail -6 $W/apply.txt; fi
done

ORD=$(q "SELECT id FROM public.orders LIMIT 1")
# 🔴 每個世界跑之前先印自檢:那個世界真的被建起來了嗎
# 🔴 `-tAX -c` 對 `INSERT … RETURNING` 會**多印一行 `INSERT 0 1`**(命令狀態)——
#    第一版沒切,那個 uuid 後面黏著換行與狀態行 ⇒ 五格全 FAIL,而錯誤訊息指向 uuid 語法。
#    ⇒ 只取第一行。(而擋下它的是**世界5 對照組仍然通過** ⇒ 尺是活的,壞的是 helper。)
mk(){ q "INSERT INTO public.order_manual_refunds(order_id,request_id,rail,refund_amount,reason,actor,occurred_at)
         VALUES ('$ORD', gen_random_uuid(), 'cash', $1, '探針用', 'alice', now()) RETURNING id" | head -1; }

echo
echo "── 世界1:第一次作廢 ⇒ idempotent 應為 false ──"
RID=$(mk 500)
printf '  自檢[列在=%s 未作廢=%s]\n' "$(q "SELECT count(*) FROM public.order_manual_refunds WHERE id='$RID'")" \
  "$(q "SELECT count(*) FROM public.order_manual_refunds WHERE id='$RID' AND voided_at IS NULL")"
REM0=$(q "SELECT public.pcm_order_refundable_remaining('$ORD')")
R=$(q "SELECT public.admin_void_manual_refund('$RID','登記金額打錯','alice')")
case "$R" in *'"idempotent": false'*|*'"idempotent":false'*) ok "回 idempotent:false  ($R)" ;; *) bad "實得 $R" ;; esac

echo
echo "── 世界2:同人同理由重送 ⇒ idempotent:true,而且【列數不變】──"
N0=$(q "SELECT count(*) FROM public.order_manual_refunds WHERE order_id='$ORD'")
R=$(q "SELECT public.admin_void_manual_refund('$RID','登記金額打錯','alice')")
N1=$(q "SELECT count(*) FROM public.order_manual_refunds WHERE order_id='$ORD'")
case "$R" in *'"idempotent": true'*|*'"idempotent":true'*) ok "回 idempotent:true" ;; *) bad "實得 $R" ;; esac
[ "$N0" = "$N1" ] && ok "列數不變 ($N0 → $N1)" || bad "列數 $N0 → $N1 ⇒ 真的多了一筆"

echo
echo "── 世界3:換【另一位合法 staff】⇒ 必須 RAISE ──"
printf '  自檢[bob 是啟用中的 staff = %s]  ← 若為 f,這一格會因為【錯的理由】而通過\n' \
  "$(q "SELECT EXISTS(SELECT 1 FROM public.staff WHERE id='bob' AND is_active)")"
R=$(q "SELECT public.admin_void_manual_refund('$RID','登記金額打錯','bob')")
case "$R" in *ERROR*已於*) ok "被拒,而且訊息帶出現況" ;; *ERROR*) bad "被拒但訊息沒帶現況: $R" ;; *) bad "竟然通過: $R" ;; esac

echo
echo "── 世界4:🔴 可退餘額必須把這 500 元吐回來(差額必須【正好】是 500)──"
REM1=$(q "SELECT public.pcm_order_refundable_remaining('$ORD')")
printf '  作廢前 %s → 作廢後 %s(差 %s)\n' "$REM0" "$REM1" "$((REM1-REM0))"
[ "$((REM1-REM0))" = "500" ] && ok "差額正好 500" || bad "差額 $((REM1-REM0)) 而非 500"

echo
echo "── 世界5(對照組):🔴 這一格【必須失敗】,否則整組量測作廢 ──"
echo "   假設:把一筆【沒有作廢】的登記算進去 ⇒ 餘額應該【變小】而不是不變"
RID2=$(mk 300)
REM2=$(q "SELECT public.pcm_order_refundable_remaining('$ORD')")
printf '  再登記 300 之後:%s → %s(差 %s)\n' "$REM1" "$REM2" "$((REM2-REM1))"
[ "$((REM2-REM1))" = "-300" ] && ok "未作廢的列確實被扣(-300)⇒ 尺是活的" || bad "未作廢的列沒被扣 ⇒ 世界4 那個 500 沒有判別力"

echo
echo "── 世界6:非法 actor ⇒ 必須被擋(而它擋的是【另一道】,不要與世界3 混淆)──"
RID3=$(mk 100)
R=$(q "SELECT public.admin_void_manual_refund('$RID3','試試','not_a_staff')")
case "$R" in *ERROR*staff*) ok "被 staff 閘擋下" ;; *) bad "實得 $R" ;; esac

pg_ctl -D $W/pg stop -m immediate >/dev/null 2>&1
echo
printf '收攤殘留 process = %s\n' "$(pgrep -f "\-p $P" | wc -l | tr -d ' ')"
printf '\n總計:ok %s / FAIL %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
