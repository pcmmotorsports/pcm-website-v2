#!/usr/bin/env bash
# ci-self-contained: yes
# coupon-redeem-rules-probe.sh
#
# 證人:`public.redeem_coupon()`(`20260831160000_m4b_coupon_p2_redeem_rpc.sql`)的
#      【八個拒絕理由 + 兩種模式 + 三道上限 + 訂單歸屬】在真的 PostgreSQL 上跑起來是對的。
#
# ══ 🔴 為什麼需要它 ═══════════════════════════════════════════════════════════
# 2026-09-01 量到:全 repo 測試檔提到 `redeem_coupon` ⇒ **0 支**
#   🟢 正對照 同法找 `create_order` ⇒ 15 支  🔵 負對照 現造名 `zzq_no_such_fn_0901` ⇒ 0
# 而它**面對客人、直接減錢**,正確性依賴一個隔離等級 + 三道上限 + `FOR UPDATE` + 歸屬驗證。
#
# 🛑 **而 vitest 那一層測不到它**:`packages/adapters/.../PgChargeAttemptAdapter.test.ts`
#    是 **mock**(`vi.mock` / `makeClient`)⇒ 它測的是「adapter 怎麼組 SQL」,
#    **不是那支函式在 PG 裡的行為**。兩件事。
#
# ══ 🔴 突變打在哪(範本 `admin-customer-list-view-birthday-probe.sh` 的教訓, 照抄)═══
#   那支檔頭逐字:「拿『跑整支 migration』當突變載體 —— 而 REVOKE 在 DO 區塊【之前】
#   ⇒ 自己把突變清掉了再斷言 ⇒ **突變要打在【被測的那一段】上,
#   不是打在「包含被測那段的整個流程」上。**」
#   ⇒ 本檔的被測段 = **那支函式本體**。突變 = 改函式體的一個條件, 只重建那支函式。
#   ⇒ 而 base(建表 + 角色 + 種子)**不重跑** —— 重跑會把突變清掉。
#
# 🔴 **函式從 migration 檔本身切出來, 不抄一份** —— 範本的理由照抄:
#    「抄一份會漂, 而漂了之後這支 probe 仍然全綠。」
#
# ══ 天花板 / 範圍 ════════════════════════════════════════════════════════════
#   只驗**這一支函式**的邏輯。不驗:別支 migration、不驗真表上的欄位互動、不驗效能、
#   不驗 PostgREST 那一層、不驗 RLS(本函式 SECURITY DEFINER ⇒ RLS 對它不生效, 它自己驗歸屬)。
#
# 🔴 **替身缺了什麼(這一段是產出的一部分, 不是免責)**:
#   · `orders` / `customers` / `staff` 是**最小形狀**, 只有本函式讀得到的那幾欄
#     ⇒ 真表的 CHECK(`orders_total_balances` / `orders_invoice_whitelist` …)**都不在**
#     ⇒ 一個違反那些 CHECK 的情境, 本 probe 量不到。
#   · `coupon_redemptions` 是照真表建的(含 `UNIQUE (order_id)` 與 `CHECK (discount_applied > 0)`)
#     —— 那兩條是本函式的行為依賴, 少了它們好幾格會假綠。
#   · `coupon_redeem_order_problem()` 是**真的那一支**(從 `20260831155000` 切出來)。
#   · 隔離等級:本檔跑在預設的 `read committed`。**其他等級下的行為沒有量。**
#   · 併發:本檔是**單連線**⇒ 三道上限的 `FOR UPDATE` 在真正並行下的行為**沒有量**。
#     ⇒ 那需要兩條連線互相卡住, 而那是另一支 probe。**寫出來, 不假裝這裡涵蓋了。**
#   這份清單是我想得到的那些, 而我最可能漏掉的是「一個我沒想到要餵的輸入 ——
#   它的沉默不代表那個形狀安全」。
#
# 🔴🔴 **上面那份「缺了什麼」由【撞到它的人】增補, 不是由我維護。**
#   ⇒ 所以它**不是完整清單**, 是第一版的猜測 + 後來每個打中它的人補的那幾行。
#   ⚠️ **最貴的誤讀:以為沒列到的方向【已經被想過而排除了】。**
#   📌 一個人標得出自己盲區的【方向】, 標不出自己盲區的【分母】。
#   ⇒ 打中它的人請直接在上面加一行、署自己的名 —— **守住與記住是兩件事**:
#     修好一格是守住【這一種】, 寫進上面那份清單才防得了【同族的下一種】。
#
# 🔵 **併發那一族已經有落點**(不在這裡重寫全文, 照「同一教訓不寫兩處全文」):
#   `docs/launch-todo.md` 那一列, 錨 = 標題逐字
#   **「券的三道上限在【並行】下沒有被驗過 —— 而三道上限存在的理由就是並行」**
#   ⇒ 用標題查, 不要用行號(板子行號會漂)。
#
# 🔴🔴 **檔名叫 `rules` 不叫 `redeem-coupon` 是刻意的** ——
#   本檔驗的是【券的規則對不對】, **不是【規則在被同時撞的時候還在不在】**。
#   ⇒ 而三道上限存在的理由就是並行 ⇒ **錢的 bug 最常住在那裡, 而這裡量不到。**
#   ⇒ CI 紅的時候人先看到的是檔名 ⇒ 名字要說得出它涵蓋哪一族。
#
# 用法:bash docs/probes/coupon-redeem-rules-probe.sh
# 環境:拋棄式 Postgres(docs/runbooks/throwaway-postgres-for-migration-verification.md)
set -uo pipefail

# 🔴 LC_ALL=C 不是裝飾:不設的話 macOS 上 postmaster 會「became multithreaded during startup」
#    而 FATAL —— 而 pg_ctl start 的 rc 是 1、錯誤只在 log 檔裡, 外面看起來只是「連不上」。
export LC_ALL=C
export LANG=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260831160000_m4b_coupon_p2_redeem_rpc.sql"
PRED="$REPO/supabase/migrations/20260831155000_m4b_coupon_order_problem_predicate.sql"
[ -f "$MIG" ]  || { echo "找不到 migration: $MIG"; exit 2; }
[ -f "$PRED" ] || { echo "找不到 predicate: $PRED"; exit 2; }

PORT="${PGPORT_PROBE:-55441}"
D="$(mktemp -d)"
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT

# 🔴🔴 **`--encoding=UTF8 --locale=C` 兩個都要 —— 而我抄的範本只有 `LC_ALL=C`。**
#    `LC_ALL=C` 那一格是為了 postmaster 起得來(macOS multithreaded);
#    而它同時會讓 `initdb` 把資料庫建成 **SQL_ASCII** ⇒ 本函式的 Unicode 跳脫
#    (`U&\'\\00A0\'` 那組空白字元集)當場炸:
#      `ERROR: conversion between UTF8 and SQL_ASCII is not supported`
#    ⇒ 📌 **兩個獨立的坑, 而修第一個會製造第二個。**
#    ✅ runbook 早就記過(`throwaway-postgres-for-migration-verification.md:174-175` 逐字
#       「兩個都要(2026-08-25 cf 實測)」)—— **而範本那支沒帶, 我照抄就漏了。**
#    📌 **抄一個能跑的範本, 抄得到它做對的事, 抄不到它沒遇過的事。**
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 1; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 40); do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && break
  sleep 0.25
done
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "🔴 起不了拋棄式 PG。log:"; cat "$D/pg.log"; exit 1; }

pq  () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
pv  () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }

FAIL=0
PASS=0
ok   () { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad  () { FAIL=$((FAIL+1)); printf '  🔴 %s\n' "$1"; }

# ── 切檔:把兩支函式從 migration 本身切出來(不抄) ─────────────────────────────
python3 - "$MIG" "$PRED" "$D" <<'PYEOF'
import io, sys
mig, pred, d = sys.argv[1], sys.argv[2], sys.argv[3]

s = io.open(mig, encoding='utf-8').read()
i = s.index('CREATE FUNCTION public.redeem_coupon(')
j = s.index('\n$$;', i) + len('\n$$;')
io.open(d + '/fn.sql', 'w', encoding='utf-8').write(s[i:j])

p = io.open(pred, encoding='utf-8').read()
pi = p.index('CREATE FUNCTION public.coupon_redeem_order_problem(')
pj = p.index('\n$$;', pi) + len('\n$$;')
io.open(d + '/pred.sql', 'w', encoding='utf-8').write(p[pi:pj])

print('fn bytes=%d  pred bytes=%d' % (j - i, pj - pi))
PYEOF

# 🔴 切法自檢:切出來的東西必須真的是那兩支函式, 而且【不含】檔尾的 DO 自檢與 REVOKE
#    (含了的話, 每一次重建函式都會把突變連同 ACL 一起重置 ⇒ 突變被自己清掉 = 假綠)
for f in fn pred; do
  if ! head -1 "$D/$f.sql" | grep -q '^CREATE FUNCTION public\.'; then
    bad "切法自檢:$f.sql 第一行不是 CREATE FUNCTION ⇒ 切錯了"
  fi
  if grep -q 'REVOKE\|GRANT\|DO \$' "$D/$f.sql"; then
    bad "切法自檢:$f.sql 含 REVOKE/GRANT/DO ⇒ 重建函式會把突變清掉(範本記過的假綠)"
  else
    ok "切法自檢:$f.sql 只有函式本體(無 REVOKE/GRANT/DO)"
  fi
done

# ── base:最小世界 ────────────────────────────────────────────────────────────
pq >/dev/null 2>&1 <<'SQL'
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded');
CREATE TYPE public.member_tier    AS ENUM ('general','store');

CREATE TABLE public.staff (id text PRIMARY KEY);
INSERT INTO public.staff VALUES ('s1');

CREATE TABLE public.customers (user_id uuid PRIMARY KEY);
INSERT INTO public.customers VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES public.customers(user_id),
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  cancelled_at timestamptz,
  subtotal integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0
);

-- 🔴 這幾張是 predicate 讀的落點。**最小形狀, 只有它讀得到的欄。**
-- 🔴 這幾張表的欄**不是憑印象寫的** —— 用一支小腳本從 predicate 本體抓出
--    每個 `alias.欄` 的實際命中(剝掉註解之後), 逐張對齊:
--      order_cancellations              ⇒ order_id
--      order_manual_refunds             ⇒ order_id, voided_at
--      order_refunds                    ⇒ id, order_id, status
--      orders                           ⇒ cancelled_at, id, payment_status
--      payment_charge_attempts          ⇒ id, order_id
--      payment_double_charge_anomalies  ⇒ old_order_id
--      payment_refunds                  ⇒ attempt_id, id
-- ⚠️ 我前兩版是**一次猜一張、被 PG 一個一個炸出來的**(view 的欄猜錯、`voided_at` 漏掉)
--    ⇒ 📌 **打地鼠會停在「它終於建起來了」那一刻, 而那不等於欄對齊了** ——
--       只是剛好沒有再撞到而已。⇒ 換成一次把清單抓完。
-- 🔴🔴 **而我的第一支抽取器【也是錯的】** —— 它只認 `alias.欄`, 而 predicate 裡有
--    **沒有 alias 的裸欄名**(`WHERE order_id = p_order_id AND reverses_payment_id IS NULL`)
--    ⇒ 它漏掉 `order_payments.reverses_payment_id`, 而**我以為那份清單是完整的**。
--    ⇒ 📌 **一把「一次抓完」的尺, 它的分母由它認得的【語法形狀】決定** ——
--       而我拿它取代打地鼠, 正是因為相信它比較完整。
--    ✅ 第二支抽取器補上裸欄名 ⇒ 兩版的**聯集**才是這裡用的清單
--      (`order_payments` 的 `amount` 只有第一版抓到、`reverses_payment_id` 只有第二版抓到)。
CREATE TABLE public.order_cancellations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
CREATE TABLE public.order_refunds       (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text);
CREATE TABLE public.order_manual_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, voided_at timestamptz);
CREATE TABLE public.order_payments      (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, amount integer, reverses_payment_id uuid);
CREATE TABLE public.payment_charge_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text);
CREATE TABLE public.payment_refunds     (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid);
CREATE TABLE public.payment_double_charge_anomalies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), old_order_id uuid, status text);
-- 🔴 這兩支 view 的欄**不是猜的** —— 從 predicate 本體抓它實際讀的 `alias.欄`:
--      order_refund_effective_verdict    ⇒ corrected_to, refund_id
--      payment_refund_effective_terminal ⇒ indicates_refund, refund_id
-- ⚠️ 我第一版憑印象寫成 `order_id / verdict` ⇒ predicate **當場建不起來**。
--    📌 **而那是好事:它大聲炸了。**若我剛好猜對欄名而型別不同, 它可能安靜地錯。
CREATE VIEW  public.order_refund_effective_verdict AS
  SELECT NULL::uuid AS refund_id, NULL::text AS corrected_to WHERE false;
CREATE VIEW  public.payment_refund_effective_terminal AS
  SELECT NULL::uuid AS refund_id, NULL::boolean AS indicates_refund WHERE false;

-- 🔴 券的兩張表【照真表建】—— UNIQUE(order_id) 與 CHECK(discount_applied > 0)
--    是本函式的行為依賴, 少了它們好幾格會假綠。
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('fixed','percent')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  ends_on date,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_per_account integer CHECK (max_per_account IS NULL OR max_per_account > 0),
  min_spend integer NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
  stacks_with_tier boolean NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id),
  order_id  uuid NOT NULL REFERENCES public.orders(id),
  user_id   uuid NOT NULL REFERENCES public.customers(user_id),
  discount_applied integer NOT NULL CHECK (discount_applied > 0),
  reverted_at timestamptz,
  reverted_by text REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_one_per_order UNIQUE (order_id)
);
SQL

pq -f "$D/pred.sql" >/dev/null 2>&1 || { echo "🔴 predicate 建不起來"; pq -f "$D/pred.sql"; exit 1; }
pq -f "$D/fn.sql"   >/dev/null 2>&1 || { echo "🔴 redeem_coupon 建不起來"; pq -f "$D/fn.sql"; exit 1; }
ok "兩支函式從 migration 切出來並建起來了"

# ── 種子 ─────────────────────────────────────────────────────────────────────
pq >/dev/null <<'SQL'
INSERT INTO public.coupons (id, code, discount_type, discount_value, min_spend, stacks_with_tier, is_active, created_by) VALUES
 ('c0000000-0000-0000-0000-00000000000a','OK100','fixed',   100, 0,    true,  true,  's1'),
 ('c0000000-0000-0000-0000-00000000000b','PCT10','percent',  10, 0,    true,  true,  's1'),
 ('c0000000-0000-0000-0000-00000000000c','OFF',  'fixed',   100, 0,    true,  false, 's1'),
 ('c0000000-0000-0000-0000-00000000000d','MIN5K','fixed',   100, 5000, true,  true,  's1'),
 ('c0000000-0000-0000-0000-00000000000e','NOTIER','fixed',  100, 0,    false, true,  's1'),
 ('c0000000-0000-0000-0000-00000000000f','ONCE', 'fixed',   100, 0,    true,  true,  's1'),
 ('c0000000-0000-0000-0000-000000000010','LIMIT1','fixed',  100, 0,    true,  true,  's1');
UPDATE public.coupons SET ends_on = current_date - 1 WHERE code = 'OK100' AND false;
INSERT INTO public.coupons (id, code, discount_type, discount_value, ends_on, stacks_with_tier, is_active, created_by)
 VALUES ('c0000000-0000-0000-0000-000000000011','GONE','fixed',100, current_date - 1, true, true, 's1');
UPDATE public.coupons SET max_per_account = 1 WHERE code = 'ONCE';
UPDATE public.coupons SET max_redemptions = 1 WHERE code = 'LIMIT1';

INSERT INTO public.orders (id, customer_user_id, payment_status, subtotal, total) VALUES
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','paid',  1000, 1000),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','paid',  1000, 1000),
 ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','unpaid',1000, 1000),
 ('00000000-0000-0000-0000-0000000000a4','22222222-2222-2222-2222-222222222222','paid',  1000, 1000);
SQL
ok "種子建好(8 張券 · 4 張單)"

U1=11111111-1111-1111-1111-111111111111
U2=22222222-2222-2222-2222-222222222222

# ── 一格 = 一個世界。`want` 是【期望在回傳裡看到的字串】 ────────────────────────
cell () {  # cell <說明> <期望字串> <SQL>
  local desc="$1" want="$2" sql="$3" got
  got="$(pv -c "$sql")"
  case "$got" in *"$want"*) ok "$desc  ⇒ $got" ;;
                 *)         bad "$desc  期望含【$want】而實得:$got" ;;
  esac
}

echo ""
echo "── 試算(dry-run:p_order_id 不傳)──────────────────────────────────────────"
cell "定額券折 100"            '"discount_applied": 100' "select public.redeem_coupon('OK100','$U1',1000,false)"
cell "百分比券 10% of 1000"     '"discount_applied": 100' "select public.redeem_coupon('PCT10','$U1',1000,false)"
cell "🔵 查無此券 ⇒ not_found"  '"reason": "not_found"'   "select public.redeem_coupon('ZZQNOPE','$U1',1000,false)"
cell "🔵 已停用 ⇒ inactive"     '"reason": "inactive"'    "select public.redeem_coupon('OFF','$U1',1000,false)"
cell "🔵 已過期 ⇒ expired"      '"reason": "expired"'     "select public.redeem_coupon('GONE','$U1',1000,false)"
cell "🔵 低消未達 ⇒ below_min_spend" '"reason": "below_min_spend"' "select public.redeem_coupon('MIN5K','$U1',1000,false)"
cell "🔵 不可疊經銷價 ⇒ tier_conflict" '"reason": "tier_conflict"' "select public.redeem_coupon('NOTIER','$U1',1000,true)"

echo ""
echo "── 🔴 上限:折抵夾在 [1, 小計] ────────────────────────────────────────────"
cell "折抵不得超過小計(定額 100 而小計 50)" '"discount_applied": 50' "select public.redeem_coupon('OK100','$U1',50,false)"
# 🔴🔴 **小計要挑 4, 不是 5** —— 我第一版寫 5, 而那一格【沒有觸發下限】:
#    `round(5 * 10 / 100)` = `round(0.5)` = **1**(PG 實測)⇒ 折抵本來就是 1
#    ⇒ 拿掉 `greatest(v_calc, 1)` 之後它**仍然是 1** ⇒ 突變殺不掉它 ⇒ 那一格恆綠。
#    ✅ 小計 4 ⇒ `round(0.4)` = **0** ⇒ 下限那一行才真的被用到。
#    📌 **一個「看起來會觸發邊界」的輸入, 與一個真的觸發它的輸入, 在測試碼上長得一樣** ——
#       而分辨它們要去算那個中間值, 不是讀那一行條件。
cell "🔴 最低折 1 元(Sean 拍甲;10% of 4 ⇒ round(0.4)=0 ⇒ 夾到 1)" '"discount_applied": 1' "select public.redeem_coupon('PCT10','$U1',4,false)"

echo ""
echo "── 真的兌換(p_order_id 有值)──────────────────────────────────────────────"
cell "兌換成功"                '"valid": true' "select public.redeem_coupon('OK100','$U1',1000,false,'00000000-0000-0000-0000-0000000000a1')"
cell "同單同券重送 ⇒ 冪等"      '"valid": true' "select public.redeem_coupon('OK100','$U1',1000,false,'00000000-0000-0000-0000-0000000000a1')"
cell "🔵 未付款的單 ⇒ 被 predicate 擋" 'not_paid' "select public.redeem_coupon('OK100','$U1',1000,false,'00000000-0000-0000-0000-0000000000a3')"
cell "🔵 別人的單 ⇒ 拒"        '不屬於這個帳號' "select public.redeem_coupon('OK100','$U1',1000,false,'00000000-0000-0000-0000-0000000000a4')"

echo ""
echo "── 🔴 三道上限:每人 / 總量 ───────────────────────────────────────────────"
# 🔴🔴 **前提要自己會叫 —— 我第一版在這裡寫了 `|| true`, 而它吞掉了前提沒建成。**
#    成因:`a1` 那張單在上面「兌換成功」那一格**已經被寫過一列 redemption** ⇒
#    `coupon_redemptions` 的 `UNIQUE (order_id)` 擋住第二列 ⇒ INSERT 失敗
#    ⇒ 而 `|| true` 讓它安靜跳過 ⇒ **下面那一格測到的是「這張券還沒有人用過」那個世界**
#    ⇒ 📌 它印的紅是對的(函式沒有理由回 already_used_by_account), 而**紅的原因不是函式** ——
#       是我的前提沒有建起來。**一個吞掉錯誤的前提, 會讓下一格量錯一個世界。**
#    ✅ 改用 `a2`(還沒被兌換過的單), 而且**不吞錯誤**:建不成就當場紅。
seed_used () {  # seed_used <coupon_id> <order_id> <user>
  if ! pq >/dev/null -c "insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied) values ('$1','$2','$3',100)" 2>"$D/seed.err"; then
    bad "前提建不起來(coupon=$1 order=$2)⇒ 下面那一格會量到錯的世界:$(head -2 "$D/seed.err" | tr '\n' ' ')"
    return 1
  fi
  ok "前提:那張券已經被 $3 用過一次(coupon=$1)"
}
seed_used c0000000-0000-0000-0000-00000000000f 00000000-0000-0000-0000-0000000000a2 "$U1"
cell "🔵 每人上限 1 次 ⇒ already_used_by_account" '"reason": "already_used_by_account"' \
  "select public.redeem_coupon('ONCE','$U1',1000,false)"
# 🔵 這一格用 a4(U2 的單), 而不是 a2 —— a2 剛剛被上面那個前提佔掉了(UNIQUE(order_id))。
seed_used c0000000-0000-0000-0000-000000000010 00000000-0000-0000-0000-0000000000a4 "$U2"
cell "🔵 總量上限 1 張 ⇒ exhausted" '"reason": "exhausted"' \
  "select public.redeem_coupon('LIMIT1','$U1',1000,false)"

echo ""
echo "── 🔴🔴 突變:打在【函式本體】上, 而 base 不重跑 ───────────────────────────"
mutate () {  # mutate <說明> <sed 表達式> <該紅的 SQL> <該紅時不該出現的字串>
  local desc="$1" expr="$2" sql="$3" nowant="$4" got
  sed "$expr" "$D/fn.sql" > "$D/mut.sql"
  if cmp -s "$D/fn.sql" "$D/mut.sql"; then
    bad "突變【$desc】沒有改到任何東西 ⇒ 這一發沒有判別力(anchor 錯了)"
    return
  fi
  pq -c "DROP FUNCTION public.redeem_coupon(text,uuid,integer,boolean,uuid)" >/dev/null 2>&1
  pq -f "$D/mut.sql" >/dev/null 2>&1 || { bad "突變【$desc】讓函式建不起來 ⇒ 那是語法錯, 不是守門抓到"; }
  got="$(pv -c "$sql")"
  case "$got" in *"$nowant"*) bad "突變【$desc】之後行為沒變(仍含 $nowant)⇒ 那一格是恆綠的" ;;
                 *)           ok "突變【$desc】⇒ 行為變了(實得 $got)" ;;
  esac
  pq -c "DROP FUNCTION public.redeem_coupon(text,uuid,integer,boolean,uuid)" >/dev/null 2>&1
  pq -f "$D/fn.sql" >/dev/null 2>&1
}

mutate "把 is_active 檢查改成恆真" \
  "s/IF NOT v_c.is_active THEN/IF false THEN/" \
  "select public.redeem_coupon('OFF','$U1',1000,false)" '"reason": "inactive"'

mutate "拿掉折抵下限(最低折 1 元)" \
  "s/v_calc := greatest(v_calc, 1);/v_calc := v_calc;/" \
  "select public.redeem_coupon('PCT10','$U1',4,false)" '"discount_applied": 1'

mutate "拿掉折抵上限(不得超過小計)" \
  "s/v_calc := least(v_calc, p_subtotal);/v_calc := v_calc;/" \
  "select public.redeem_coupon('OK100','$U1',50,false)" '"discount_applied": 50'

echo ""
echo "── 🟢 還原驗證:突變全部還原之後, 好世界要回到原樣 ─────────────────────────"
cell "還原後 定額券仍折 100" '"discount_applied": 100' "select public.redeem_coupon('OK100','$U1',1000,false)"

echo ""
printf '════ 結果:%s 綠 / %s 紅 ════\n' "$PASS" "$FAIL"
if [ "$FAIL" != "0" ]; then exit 1; fi
exit 0
