#!/usr/bin/env bash
# ci-self-contained: yes   ← 🔴 這一行是 CI 的【認領標記】,見 .github/workflows/ci.yml
# sibling-lookup-bank-pending-probe.sh — 匯款單那條路的【資料世界】驗證(M-4b 段 1 片 A + 片 B)
#   片 A = find_active_sibling_own 看得見未付款匯款單
#   片 B = begin_charge_attempt 在客人改用刷卡時把它取消
#   🔵 **片 B 用這支加格子, 不另起一套** —— 📌 一支被第二片用到的探針,
#      才證明它不是為了通過驗收而寫的。
#
# 🔴🔴 **這支探針存在的理由是量到的, 不是預防性的**:
#   片 A 的三支 TS 測試**都直接 mock `bank_pending`** ⇒ 它們**結構上到不了 SQL**。
#   而 codex 關卡2 在同一輪抓到兩個 SQL bug, 兩個都會【放行一張刷卡單】:
#     ① `payment_status <> 'paid'` 收進四個值(unpaid/partiallyPaid/refunded/partiallyRefunded)
#        ⇒ 一張**已部分收款**的匯款單會被判成 bank_pending
#     ② `ORDER BY … DESC` 預設 **NULLS FIRST** ⇒ 匯款單(a.status 為 NULL)**排在 charged 之前**
#        ⇒ 客人同時有刷卡在途與未匯款單時, 匯款那張會贏 ⇒ 繞過 settle 那道裁決
#   📌 **⇒ 那兩個是【剛好有人在場】抓到的, 不是我們的閘抓到的。這支探針把它變成閘。**
#
# 🔴 **本檔【不抄一份函式】, 它從 migration 檔裡把那支函式抽出來跑** ——
#    抄一份會分岔, 而分岔的那天沒有東西會叫。
#
# 天花板/範圍:只驗這支函式在**最小形狀**的資料上算得對。
#   結構不變式與 ACL 歸 migration 的事後斷言, 不在這裡。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「最小形狀下不出現、真表上才有的欄位互動」。
# 天花板/量具:本機 PG **不是 Supabase** —— `auth.uid()` 在這裡是我造的樁、RLS 預設授權不同、
#   PostgREST 的名稱解析完全不在這個世界裡 ⇒ **它證不了那條網路路徑通不通。**
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgprobe-siblingbank
PORT=55521
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$REPO/supabase/migrations/20260904040000_m4b_sibling_lookup_sees_bank_orders.sql"

trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
wait_pg () {
  local i
  for i in $(seq 1 30); do
    psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "X Postgres 30 秒內沒起來。pg.log 最後 10 行:"; tail -10 "$D/pg.log" 2>&1 || true; return 1
}
wait_pg
pq () { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
q1 () { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "$1"; }

# ── bootstrap(Supabase 平台給的東西, 本機沒有)────────────────────────────
UID_FIXED='11111111-1111-4111-8111-111111111111'
pq -q <<SQL
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
-- auth.uid() 樁:本機沒有 JWT。**這正是本探針量不到的那一層**, 檔頭已標。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT '${UID_FIXED}'::uuid \$\$;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL,
  cart_session_id  uuid,
  display_id       text NOT NULL,
  payment_status   public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_channel  text NOT NULL DEFAULT 'tappay',
  cancelled_at     timestamptz,
  cancelled_reason text,
  -- 片 B 的取消會寫它(逾期那支同一行也寫)。
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- 片 B 的函式會讀它(取消守門);最小形狀。
CREATE TABLE public.order_cancellations (order_id uuid PRIMARY KEY);
CREATE TABLE public.payment_charge_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- 🔵 真表這一欄有 DEFAULT 'pending'(那支函式的 INSERT 不寫它)⇒ 最小形狀要跟著。
  status              text NOT NULL DEFAULT 'pending',
  -- 片 B 的 begin_charge_attempt 會投影這兩欄(needs_settle 帶給上層做 Record 反查鍵)。
  rec_trade_id        text,
  bank_transaction_id text,
  -- per-user 閘會用這兩欄(異單、10 分鐘窗)。
  customer_user_id    uuid,
  fallback_token_hash text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- 🔵 最小形狀:那道 ON CONFLICT 需要這個部分唯一索引才成立。
CREATE UNIQUE INDEX pca_one_active ON public.payment_charge_attempts (order_id)
  WHERE status IN ('pending', 'charged');
-- 🛑 **樁**:真的那支做雜湊, 而本探針量的不是雜湊。
--    ⇒ 📌 那也表示**本探針證不了 token 那條路**, 檔頭的天花板那一節涵蓋它。
CREATE FUNCTION public.charge_attempt_token_hash(t uuid) RETURNS text
  LANGUAGE sql IMMUTABLE AS \$stub\$ SELECT md5(t::text) \$stub\$;
SQL

# ── 把那支函式從 migration 檔裡抽出來(不抄一份)───────────────────────────
awk '/^CREATE OR REPLACE FUNCTION public\.find_active_sibling_own/,/^\$fn\$;/' "$MIG" > "$D/fn.sql"
LINES=$(wc -l < "$D/fn.sql" | tr -d ' ')
if [ "$LINES" -lt 40 ]; then
  echo "X 從 migration 抽出來的函式只有 $LINES 行, 抽取失敗(anchor 沒命中?)⇒ 不是探針通過, 是探針壞了"
  exit 1
fi
pq -q -f "$D/fn.sql"
echo "  (抽出 $LINES 行函式定義, 來源 = $(basename "$MIG"))"

# ── 片 B:同樣【從 migration 抽】begin_charge_attempt, 不抄一份 ────────────
MIGB="$REPO/supabase/migrations/20260904050000_m4b_supersede_bank_order_on_card.sql"
awk '/^CREATE OR REPLACE FUNCTION public\.begin_charge_attempt/,/^\$fn\$;/' "$MIGB" > "$D/fnb.sql"
LINESB=$(wc -l < "$D/fnb.sql" | tr -d ' ')
if [ "$LINESB" -lt 60 ]; then
  echo "X 片 B 函式只抽到 $LINESB 行, 抽取失敗 ⇒ 不是探針通過, 是探針壞了"; exit 1
fi
pq -q -f "$D/fnb.sql"
echo "  (抽出 $LINESB 行 begin_charge_attempt, 來源 = $(basename "$MIGB"))"

CART='22222222-2222-4222-8222-222222222222'
reset_data () { pq -q -c "TRUNCATE public.payment_charge_attempts, public.orders CASCADE;"; }
kind_of () { q1 "SELECT public.find_active_sibling_own('${CART}'::uuid) ->> 'kind';"; }
FAILED=0
PASSED=0
check () { # $1=格名 $2=期望 $3=實得
  if [ "$2" = "$3" ]; then printf '  OK   %s ⇒ %s\n' "$1" "$3"; PASSED=$((PASSED+1))
  else printf '  FAIL %s ⇒ 期望 %s 而得到 %s\n' "$1" "$2" "$3"; FAILED=1; fi
}

echo "== find_active_sibling_own 資料世界 =="

# 格1:未付款匯款單, 零 attempt ⇒ bank_pending(本片新增的那條路)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-1','unpaid','bank_transfer');"
check "格1 未付款匯款單" "bank_pending" "$(kind_of)"

# 格2 🔴 殺 bug①:**已部分收款**的匯款單, 零 attempt ⇒ 絕不可以是 bank_pending
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-2','partiallyPaid','bank_transfer');"
K=$(kind_of)
if [ "$K" = "bank_pending" ]; then
  printf '  FAIL 格2 已部分收款的匯款單被判成 bank_pending(= bug①)⇒ 它會放行一張刷卡單\n'; FAILED=1
else
  # 🔴 這一格【不走 check】(它的判準是「不等於某值」而不是「等於某值」)
  #    ⇒ 📌 所以計數要在這裡自己加一次。**少了這一行, 那個總數會少報一格,
  #      而它印出來的仍然是一個合理的數字** —— 那正是本檔今晚修掉的同一種病。
  printf '  OK   格2 已部分收款的匯款單 ⇒ %s(不是 bank_pending)\n' "$K"; PASSED=$((PASSED+1))
fi

# 格3 🔴 殺 bug②:同一車【刷卡在途】+【未付款匯款單】⇒ 必須是 active(刷卡那張優先裁決)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel, created_at)
          VALUES ('33333333-3333-4333-8333-333333333333','${UID_FIXED}','${CART}','PCM-CARD-1','unpaid','tappay', now() - interval '1 hour');
          INSERT INTO public.payment_charge_attempts (order_id, status)
          VALUES ('33333333-3333-4333-8333-333333333333','charged');
          INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel, created_at)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-3','unpaid','bank_transfer', now());"
check "格3 刷卡在途 + 未匯款單 同車" "active" "$(kind_of)"

# 格4 正對照:只有刷卡在途 ⇒ active(舊行為逐字不變)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('44444444-4444-4444-8444-444444444444','${UID_FIXED}','${CART}','PCM-CARD-2','unpaid','tappay');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('44444444-4444-4444-8444-444444444444','pending');"
check "格4 正對照 只有刷卡在途" "active" "$(kind_of)"

# 格5 正對照:已付款 ⇒ paid(不論管道)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-PAID-1','paid','bank_transfer');"
check "格5 正對照 已付款匯款單" "paid" "$(kind_of)"

# 格6 負對照:什麼都沒有 ⇒ none(證明尺不亂報)
reset_data
check "格6 負對照 空的" "none" "$(kind_of)"

# 格7 負對照:已取消的匯款單 ⇒ none(cancelled_at 那道守門還在)
reset_data
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel, cancelled_at)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-4','unpaid','bank_transfer', now());"
check "格7 負對照 已取消的匯款單" "none" "$(kind_of)"

echo "== 片 B:begin_charge_attempt 改用刷卡時取消匯款單 =="

CARD='55555555-5555-4555-8555-555555555555'
begin_card () { q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'acquired';"; }
bank_cancelled () { q1 "SELECT (cancelled_at IS NOT NULL)::text FROM public.orders WHERE display_id='PCM-BANK-B';"; }
bank_reason () { q1 "SELECT COALESCE(cancelled_reason,'<null>') FROM public.orders WHERE display_id='PCM-BANK-B';"; }
seed_card () { pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${CARD}','${UID_FIXED}','${CART}','PCM-CARD-B','unpaid','tappay');"; }
seed_bank () { pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');"; }

# 格8:同車有未付款匯款單 ⇒ 刷卡拿得到鎖, 而那張匯款單被取消
reset_data; seed_card; seed_bank
check "格8 刷卡取得鎖" "true" "$(begin_card)"
check "格8b 匯款單被取消" "true" "$(bank_cancelled)"
check "格8c 取消原因分得出來" "superseded_by_card" "$(bank_reason)"

# 格9 🔴 不變量:匯款單【有 active attempt】⇒ 不可以被取消(放寬它 = 雙扣)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('66666666-6666-4666-8666-666666666666','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('66666666-6666-4666-8666-666666666666','pending');"
begin_card > /dev/null
check "格9 有 attempt 的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格10 正對照:同車有刷卡在途 ⇒ 仍然回 needs_settle(舊行為逐字不變)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('77777777-7777-4777-8777-777777777777','${UID_FIXED}','${CART}','PCM-CARD-C','unpaid','tappay');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('77777777-7777-4777-8777-777777777777','pending');"
check "格10 正對照 刷卡在途仍 needs_settle" "needs_settle" "$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")"

# 格10b 🔴 **格10 的缺口**(codex 關卡2 R2 PARTIAL ③):格10 那個世界【沒有匯款 sibling】
#   ⇒ 一支「在回 needs_settle 之前就先把匯款單取消掉」的壞碼, 格10 看不到它。
#   ⇒ 📌 **格10 證的是「回什麼」, 這一格證的是「回那個之前有沒有先動手」。**
#   🔴 **而我第一版把這三格全寫壞了**(codex R4 抓到, 而它對):我用了四參數簽章
#      `begin_charge_attempt(id, uid, 't', 'x')` 與一個**從未定義的 `${BANK}`** ——
#      🔬 而本檔既有形狀是 `begin_charge_attempt('${CARD}'::uuid)` **一個參數**,
#         那張匯款單用 `display_id='PCM-BANK-B'` 找(見 `bank_cancelled()`), 不是變數。
#      🎯 **⇒ 我照著 codex 舉例的簽章打, 沒有對照【本檔既有的用法】。**
#        ⇒ 📌 **一個抄來的座標在它自己的來源那裡是對的, 而它到不了我這裡。**
#        ⇒ 🔴 **而三格會【全部跑不起來】—— 而跑不起來與跑過了都不會印綠, 是 codex 讀出來的。**
reset_data; seed_card; seed_bank
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('77777777-7777-4777-8777-777777777777','${UID_FIXED}','${CART}','PCM-CARD-C','unpaid','tappay');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('77777777-7777-4777-8777-777777777777','pending');"
check "格10b 早退仍是 needs_settle" "needs_settle" \
  "$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason'")"
check "格10b 而匯款單【不可】被取消(needs_settle 前不得動手)" "false" "$(bank_cancelled)"

# 格16b 🔴 **格16 的缺口**(同上 ③):格16 只驗回傳值是 not_card_order, **沒驗零副作用**
#   ⇒ 一支「先取消了東西、才發現目標是匯款單而回 not_card_order」的壞碼, 格16 印綠。
#   ⇒ 📌 **早退路徑的驗收要驗兩件:回對了什麼 · 有沒有留下痕跡。**
#   ⚠️ **射程(codex R4 明寫)**:它只殺得死「先取消再早退」, **殺不死別種副作用**。
reset_data; seed_card; seed_bank
BANK_ID=$(q1 "SELECT id::text FROM public.orders WHERE display_id='PCM-BANK-B'")
BEFORE16=$(q1 "SELECT count(*)::text FROM public.orders WHERE cancelled_at IS NOT NULL")
q1 "SELECT public.begin_charge_attempt('${BANK_ID}'::uuid) ->> 'reason'" > /dev/null
check "格16b not_card_order 早退時零副作用(取消數不變)" "$BEFORE16" \
  "$(q1 "SELECT count(*)::text FROM public.orders WHERE cancelled_at IS NOT NULL")"

# 🛑 **格20(`user_in_flight`)本輪【拿掉, 不留半成品】**
#   我第一版寫了它, 而 codex R4 指出 fixture **沒有填 attempt 的會員 id** ⇒ **正確的碼也過不了**。
#   ⇒ 🔴 一格「正確的碼也會紅」的測試, 比沒有那一格糟 —— 它會訓練下一個人去繞過它。
#   ⇒ 📌 **⇒ 那條路仍然沒有格子, 而我把這件事寫在這裡而不是假裝補上了。**
#     落點:⟦b4-PIECEBGATEGAPS⟧ ③(`user_in_flight` / `duplicate` 兩條路都還缺格子)。

# 格11 正對照:同車什麼都沒有 ⇒ 刷卡照常拿到鎖
reset_data; seed_card
check "格11 正對照 乾淨車" "true" "$(begin_card)"

# ── 片 B 第二批:codex 關卡2 說「探針打不到那些風險」而它對 ──────────────
# 格12 🔴 released attempt:canonical 條件是 `status <> 'failed'`, 不是 IN('pending','charged')
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('88888888-8888-4888-8888-888888888888','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('88888888-8888-4888-8888-888888888888','released');"
begin_card > /dev/null
check "格12 帶 released attempt 的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格13 🟢 而 failed 是終態 ⇒ 帶 failed 的匯款單【可以】被取消(證明上一格不是「一律不取消」)
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('99999999-9999-4999-8999-999999999999','${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer');
          INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('99999999-9999-4999-8999-999999999999','failed');"
begin_card > /dev/null
check "格13 帶 failed 的匯款單可以被取消(尺不是一律不取消)" "true" "$(bank_cancelled)"

# 格14 🔴 早退路徑:目標單被別的 active attempt 佔住(order_locked)⇒ 匯款單【不可】被取消
reset_data; seed_card; seed_bank
pq -q -c "INSERT INTO public.payment_charge_attempts (order_id, status) VALUES ('${CARD}','pending');"
R=$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")
check "格14a 早退 = order_locked" "order_locked" "$R"
check "格14b 早退時匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格15 🔴 跨客人:別人的匯款單不可以被我取消
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('22222222-1111-4111-8111-111111111111','${CART}','PCM-BANK-B','unpaid','bank_transfer');"
begin_card > /dev/null
check "格15 別人的匯款單【不可】被取消" "false" "$(bank_cancelled)"

# 格16 🔴 目標單本身是匯款單 ⇒ 不得開刷卡 attempt(not_card_order)
reset_data
pq -q -c "INSERT INTO public.orders (id, customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${CARD}','${UID_FIXED}','${CART}','PCM-BANK-TARGET','unpaid','bank_transfer');"
check "格16 目標單是匯款單 ⇒ not_card_order" "not_card_order" "$(q1 "SELECT public.begin_charge_attempt('${CARD}'::uuid) ->> 'reason';")"

# 格17 🔵 多張:同車兩張未付款匯款單 ⇒ **兩張都被取消**(明寫這是刻意的, 不是只取消一張)
#       🟢 **2026-09-04 Sean 拍板【甲 全部一起取消】**(拍板檔第二十四題)⇒ 本格守的是【被批准的行為】,
#          不再只是「鎖住現行行為」。🛑 改成只取消一張 = 推翻拍板, 不是改一道測試。
#
#   🔴🔴 **而我(線【信】`-mail`)2026-09-05 一度把這格改寫成「沒有人授權過」—— 那是錯的。**
#      🔬 我的依據:開檔查規格 ⇒ plan `:148/:154` 的「那張」講的是**客人看不到那張已建好的匯款單**,
#         不是「取消哪一張」⇒ 我據此寫下「規格從來沒有講過取消的單複數」。
#      🎯 **而那句話【對規格而言是真的】, 對【拍板】而言是假的。**
#         ⇒ 📌 **我掃的是 `docs/`, 而他的拍板住在 `~/pcm-mailbox/`** ——
#           **一把只掃 repo 的尺, 對「他說過沒有」這個問題結構上失明。**
#         ⇒ 🔴 **判別句:要斷言「沒有人說過」之前, 分母要含 mailbox, 不只 repo。**
#      🔵 而 codex R3 判它 PARTIAL 是**對的**(它審的那一刻確實還沒拍),
#         **而它在同一晚被拍掉了** ⇒ 📌 **一個 finding 可以在你折它的期間過期。**
#      📎 全文投稿 `docs/patterns/traps-inbox/mail-20260905a-零命中第四種-網撒錯載體.md`
#      🔵 合併紀錄:線【身分】`-auth` `a5e7e4f30` 那半是對的, 本格取它;上面這段是我留下的病歷。
reset_data; seed_card
pq -q -c "INSERT INTO public.orders (customer_user_id, cart_session_id, display_id, payment_status, payment_channel)
          VALUES ('${UID_FIXED}','${CART}','PCM-BANK-B','unpaid','bank_transfer'),
                 ('${UID_FIXED}','${CART}','PCM-BANK-B2','unpaid','bank_transfer');"
begin_card > /dev/null
check "格17 同車兩張匯款單都被取消" "2" "$(q1 "SELECT count(*)::text FROM public.orders WHERE display_id LIKE 'PCM-BANK-B%' AND cancelled_at IS NOT NULL;")"

# 格18 🔴 `updated_at` 真的被寫了(codex 關卡2 R2 的 PARTIAL ⑤)
#   🎯 那一項原本【沒有任何格子驗它】⇒ 從 UPDATE 裡刪掉 `updated_at = now()` 這一行,
#      十七格【全部照樣綠】。
#   🔵 而這一格刻意**不驗「非 NULL」** —— `updated_at` 本來就 NOT NULL, 那樣寫是恆真。
#      驗的是【它有沒有跟著這次取消動】:取消前先記下舊值, 取消後必須嚴格變新。
#   📌 兩個世界會印不同的值:有寫 ⇒ `t`;那一行被刪掉 ⇒ `f`。
reset_data; seed_card; seed_bank
#   🔴 **而我第一版這裡也用了未定義的 `${BANK}`**(codex R4;與格10b/16b 同一個病)——
#      改用本檔既有的做法:`display_id='PCM-BANK-B'`。
OLD_UPD=$(q1 "SELECT updated_at::text FROM public.orders WHERE display_id='PCM-BANK-B'")
pq -q -c "SELECT pg_sleep(0.01);"
begin_card > /dev/null
# 🔴🔴 **CI 從 2026-09-05 17:14 UTC 起每發紅, 紅在這兩格**(主視窗抓到, 逐字:
#      `FAIL 格18 … 期望 t 而得到 true`)。
#   🎯 成因:**psql 對【裸 boolean】印 `t`, 而加了 `::text` 之後印的是 `true`。**
#      ⇒ 我把「psql 印 boolean 的樣子」記成一種, 而它其實取決於**有沒有轉型**。
#   ✅ 修法照**本檔既有慣例**(全檔 9 處都是 `::text` + `"true"`/`"false"`,
#      只有我這兩格寫 `"t"`)⇒ 改期望值, 不動 SQL。
#   🛑 **為什麼不是拿掉 `::text`**:那會讓這兩格與全檔另外 9 處長得不一樣,
#      而**下一個人抄哪一種是隨機的**。⇒ 📌 統一形狀比省一個轉型重要。
check "格18 取消匯款單時 updated_at 有跟著動" "true" \
  "$(q1 "SELECT (updated_at > '${OLD_UPD}'::timestamptz)::text FROM public.orders WHERE display_id='PCM-BANK-B'")"

# 格19 🟢 格18 的負對照:**沒有被取消的單, updated_at 不該動**
#   🛑 少了這一格, 一支「無條件把每張單的 updated_at 都刷新」的壞碼會讓格18 印綠。
#   ⇒ 📌 格18 證的是「有動」, 格19 證的是「只動該動的那張」—— 兩個不同的宣稱。
#   🔴 **而我第一版寫成 `updated_at > OLD` 期望 `f`** —— codex R4 逐字:
#      「用【不大於】冒充【完全相等】」⇒ 一個把它改小的壞碼也會印 `f` ⇒ 假綠。
#      ✅ 改成問**完全相等**。🔵 而 codex 也排除了我擔心的那格:seed / sleep / begin
#         各是獨立 psql 交易, fixture 是未降精度的 timestamptz ⇒ **不是同交易 now() 的問題。**
reset_data; seed_card; seed_bank
OTHER=$(q1 "SELECT updated_at::text FROM public.orders WHERE id='${CARD}'")
pq -q -c "SELECT pg_sleep(0.01);"
begin_card > /dev/null
check "格19 沒被取消的那張 updated_at 完全沒動" "true" \
  "$(q1 "SELECT (updated_at = '${OTHER}'::timestamptz)::text FROM public.orders WHERE id='${CARD}'")"

if [ "$FAILED" -ne 0 ]; then echo "X 有格子紅了(見上)"; exit 1; fi
# 🔴🔴 **這一行原本寫死「二十格全過」, 而 2026-09-05 實跑是【24 格】** ——
#   而它還提到「格20」, 🛑 **那一格今晚已經被移掉了**(它半殘, 移掉比留著好)。
#   ⇒ 📌 **一句寫死的總結, 在格子被增刪時【不會有任何東西叫】** ——
#     它在 20 格與 24 格的世界裡印同一句話。
#   ✅ 改成【自己數】:數的是本次真的印出來的 OK 行, 所以它不可能過期。
#   🔵 格號仍然不連續(10b / 16b / 8b / 8c / 14a / 14b 是後補的), **刻意不重排** ——
#     重排會讓引用舊格號的紀錄全部指錯。
echo "OK 全過:$PASSED 格(格號不連續, 刻意不重排 —— 重排會讓引用舊格號的紀錄全部指錯)"
