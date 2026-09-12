#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# `20260912020000_m4b_refund_email_lines_cover_all_rails.sql` 的行為驗證(拋棄式 PG)
#
# 要證的一句:**錢每動一次, 恰好一封信講到它** —— 不是零封, 也不是兩封。
#
# 步驟:① 造最小世界 ② 先套【舊】定義(直接跑回退檔, 它就是舊定義的權威抄本)
#      ③ 貼 migration(含它自己的前置閘 / 事後閘)④ 八種單逐格比對 ⑤ 突變 3 發
#
# 🛑 答不出什麼:效能(十幾列資料)· RLS(替身表沒開)· 正式庫那兩張 view 是不是 repo 這一版。
#   🔴 **本檔的 `pcm_order_card_refunded` 是替身, 與正式版不同**(R2 nit):正式版(`20260905310000:108-125`)
#     還含「被更正成 money_moved 的 manual_failed」那一腿, 而替身只有 `status='confirmed' AND backfilled_source IS NULL`。
#     ⇒ 本檔的情境沒踩到那一腿;**要用本檔證 backfill / 更正相關的事之前, 先把替身補齊。**
#
# 用法:bash scripts/20260912020000-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20260912020000_m4b_refund_email_lines_cover_all_rails.sql"
ROLLBACK="$REPO/supabase/rollbacks/20260912020000-rollback.sql"

test -f "$MIG" || { echo "ENV-FAIL:找不到 $MIG"; exit 3; }
test -f "$ROLLBACK" || { echo "ENV-FAIL:找不到 $ROLLBACK"; exit 3; }
command -v initdb >/dev/null 2>&1 || { echo "ENV-FAIL:本機沒有 initdb"; exit 3; }

TMP="$(mktemp -d)"
PGD="$TMP/pgdata"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
cleanup() { pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

echo "(跑的是 $(command -v psql) · port=$PORT)"
initdb -D "$PGD" -U postgres --encoding=UTF8 --locale=C >"$TMP/initdb.log" 2>&1 \
  || { echo "ENV-FAIL:initdb 失敗"; tail -5 "$TMP/initdb.log"; exit 3; }
pg_ctl -D "$PGD" -o "-p $PORT -k $TMP -c listen_addresses=" -l "$TMP/pg.log" -w start >/dev/null 2>&1 \
  || { echo "ENV-FAIL:PG 起不來"; tail -10 "$TMP/pg.log"; exit 3; }
PSQL="psql -h $TMP -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

# ── ① 最小世界 ──────────────────────────────────────────────────────────────
$PSQL >"$TMP/fixture.log" 2>&1 <<'SQL' || { echo "ENV-FAIL:fixture 建不起來"; tail -20 "$TMP/fixture.log"; exit 3; }
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY, display_id text, payment_method text, payment_status text,
  cancelled_at timestamptz, cancelled_reason text, created_at timestamptz DEFAULT now(),
  notification_email text, customer_user_id uuid, order_source text, total integer
);
CREATE TABLE public.customers (user_id uuid PRIMARY KEY, email text);
CREATE TABLE public.order_refunds (
  id uuid PRIMARY KEY, order_id uuid, refund_amount integer, confirmed_at timestamptz,
  status text, backfilled_source text
);
CREATE TABLE public.order_manual_refunds (
  id uuid PRIMARY KEY, order_id uuid, refund_amount integer, occurred_at timestamptz,
  -- 🔴 `created_at` = 登記那一刻的 DB 時鐘;`occurred_at` = 員工填的實際交回時刻(可回填過去)。
  --    去重規則比的是前者(二審 must-fix 2)。
  created_at timestamptz DEFAULT now(), voided_at timestamptz, rail text
);
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, event_type text,
  dedup_key text, last_error_code text, created_at timestamptz DEFAULT now()
);

-- 替身:與正式庫同名同義(卡片退回總額 / 空白字集)
CREATE FUNCTION public.pcm_order_card_refunded(p_order_id uuid) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(sum(r.refund_amount), 0)::integer FROM public.order_refunds r
   WHERE r.order_id = p_order_id AND r.status = 'confirmed' AND r.backfilled_source IS NULL
$f$;
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT ' '::text $f$;

-- ── 八種單。每一種都是為了某一格而在 ─────────────────────────────────────────
--   O1 卡 · 部分退 · 已取消            = G1(今天兩條線都不寄)
--   O2 卡 · 分批退到全額 · 沒取消      = G2(最後那一筆沒信;正式庫真的有一張)
--   O3 卡 · 已取消 · 取消信已排 · 之後又退一筆 = G3
--   O4 非卡 · 人工退款 · 沒取消        = Q2 乙 新納入
--   O5 非卡 · 人工退款 · 已取消        = Q2 乙 新納入(取消信那一側)
--   O6 卡 + 人工退款 · 已取消          = 混合軌, **仍然不寄**(b4-CANCELMAILMIXEDRAIL)
--   O7 卡 · 部分退 · 沒取消            = 今天就會寄的那一種(對照組, 行為不可變)
--   O8 卡 · 部分退 · 沒取消 · 信已排過  = 去重(不可重寄)
INSERT INTO public.customers VALUES ('cccccccc-0000-0000-0000-000000000001', 'customer@example.com');
INSERT INTO public.orders (id, display_id, payment_method, payment_status, cancelled_at, created_at, notification_email, customer_user_id, order_source, total) VALUES
 ('00000000-0000-0000-0000-000000000001','O1','tappay','partiallyRefunded', now() - interval '1 hour', now() - interval '2 day', 'o1@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000002','O2','tappay','refunded',          NULL,                      now() - interval '2 day', 'o2@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000003','O3','tappay','partiallyRefunded', now() - interval '3 hour', now() - interval '2 day', 'o3@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000004','O4',NULL,    'partiallyRefunded', NULL,                      now() - interval '2 day', 'o4@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000005','O5',NULL,    'partiallyRefunded', now() - interval '1 hour', now() - interval '2 day', 'o5@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000006','O6','tappay','refunded',          now() - interval '1 hour', now() - interval '2 day', 'o6@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000007','O7','tappay','partiallyRefunded', NULL,                      now() - interval '2 day', 'o7@example.com', NULL, 'web', 10000),
 ('00000000-0000-0000-0000-000000000008','O8','tappay','partiallyRefunded', NULL,                      now() - interval '2 day', 'o8@example.com', NULL, 'web', 10000),
 -- O9 非卡 · 已取消 · ④ 已排 · 之後才登記一筆(occurred_at 填在過去)= 二審 must-fix 2 的證人
 ('00000000-0000-0000-0000-000000000009','O9',NULL,    'partiallyRefunded', now() - interval '3 hour', now() - interval '2 day', 'o9@example.com', NULL, 'web', 10000),
 -- O10 混合軌變形:payment_method 是 NULL 而**既有卡退又有現金退** = 二審 consider 4 的證人
 ('00000000-0000-0000-0000-000000000010','O10',NULL,   'refunded',          now() - interval '1 hour', now() - interval '2 day', 'o10@example.com', NULL, 'web', 10000);

INSERT INTO public.order_refunds (id, order_id, refund_amount, confirmed_at, status, backfilled_source) VALUES
 ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001', 3000, now() - interval '2 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002', 4000, now() - interval '5 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002', 6000, now() - interval '4 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003', 2000, now() - interval '1 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006', 5000, now() - interval '2 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000007', 2500, now() - interval '2 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000008', 2500, now() - interval '2 hour','confirmed', NULL),
 ('11111111-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000010', 6000, now() - interval '2 hour','confirmed', NULL);

INSERT INTO public.order_manual_refunds (id, order_id, refund_amount, occurred_at, created_at, voided_at, rail) VALUES
 ('22222222-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004', 3000, now() - interval '2 hour', now() - interval '2 hour', NULL, 'cash'),
 ('22222222-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005', 3000, now() - interval '2 hour', now() - interval '2 hour', NULL, 'bank'),
 ('22222222-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006', 5000, now() - interval '2 hour', now() - interval '2 hour', NULL, 'cash'),
 ('22222222-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000004', 1000, now() - interval '9 hour', now() - interval '9 hour', now(), 'cash'),
 -- 🔴 X9(二審 must-fix 2 的證人):非卡已取消單, ④ 已排(1 小時前), 而這一筆**今天才登記**、
 --    `occurred_at` 卻填在 ④ 排隊之前 ⇒ 比 `occurred_at` 會漏掉它;比 `created_at` 才寄得出去。
 ('22222222-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000009', 2000, now() - interval '5 hour', now(), NULL, 'cash'),
 ('22222222-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010', 4000, now() - interval '2 hour', now() - interval '2 hour', NULL, 'cash');

-- O3 的取消信【已排】而且早於那筆退款(G3 的前提);O8 的退款信已排過(去重)
INSERT INTO public.email_outbox (order_id, event_type, dedup_key, created_at) VALUES
 ('00000000-0000-0000-0000-000000000003','order_cancelled','00000000-0000-0000-0000-000000000003', now() - interval '2 hour'),
 ('00000000-0000-0000-0000-000000000009','order_cancelled','00000000-0000-0000-0000-000000000009', now() - interval '1 hour'),
 ('00000000-0000-0000-0000-000000000008','order_partially_refunded','11111111-0000-0000-0000-000000000008', now() - interval '1 hour');
SQL

fail=0
ask() {  # ask <題> <期望> <SQL>
  got="$($PSQL -tAc "$3" 2>"$TMP/q.err" | tr -d '[:space:]')"
  if [ "$got" = "$2" ]; then printf '  PASS %-52s ⇒ %s\n' "$1" "$got"
  else printf '  🔴 FAIL %-49s ⇒ 得 %s 期望 %s\n' "$1" "${got:-<錯誤>}" "$2"; head -3 "$TMP/q.err"; fail=1; fi
}

# ── ② 舊定義(跑回退檔 = 舊定義的權威抄本)──────────────────────────────────
$PSQL -f "$ROLLBACK" >"$TMP/old.log" 2>&1 \
  || { echo "🔴 FAIL:回退檔在最小世界上跑不起來"; tail -20 "$TMP/old.log"; exit 1; }
echo "  PASS ⓪ 回退檔跑得起來(= 舊定義建得回來, 回頭路是活的)"
echo "── 改之前(舊定義)──"
ask "① G1 卡·部分退·已取消 ⇒ 取消信撈不到"    0 "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O1'"
ask "② G1 同一張 ⇒ 退款信也撈不到"              0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O1'"
ask "③ G2 分批退到全額·沒取消 ⇒ 一封都沒有"     0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O2'"
ask "④ 非卡·人工退款 ⇒ 一封都沒有"              0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id IN ('O4','O5')"
ask "⑤ 對照組 O7(今天就會寄)⇒ 1"               1 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O7'"

# ── ③ 貼 migration ─────────────────────────────────────────────────────────
if $PSQL -f "$MIG" >"$TMP/mig.log" 2>&1; then
  echo "  PASS ⑥ migration 貼得上, 事後閘全過 —— $(grep -o '取消信掃描面現在撈到 [0-9]* 列' "$TMP/mig.log" | head -1)"
else
  echo "  🔴 FAIL ⑥ migration 貼不上"; tail -20 "$TMP/mig.log"; exit 1
fi

echo "── 改之後 ──"
ask "⑦ G1 ⇒ 取消信撈到 1(部分退也算)"          1 "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O1'"
ask "⑧ G1 的 refund_kind = partial"             partial "SELECT refund_kind FROM public.pcm_cancelled_email_pending WHERE display_id='O1'"
ask "⑨ G1 ⇒ 退款信【先等】(④ 還沒排)"          0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O1'"
ask "⑩ G2 ⇒ 兩筆退款各一封"                     2 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O2'"
ask "⑪ G2 的 order_state = fully_refunded"      fully_refunded "SELECT DISTINCT order_state FROM public.pcm_partial_refund_email_pending WHERE display_id='O2'"
ask "⑫ G3 ⇒ 取消信之後那筆退款要寄"             1 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O3'"
ask "⑬ G3 的 order_state = cancelled"           cancelled "SELECT order_state FROM public.pcm_partial_refund_email_pending WHERE display_id='O3'"
ask "⑭ 非卡·沒取消 ⇒ 退款信 1(refund_source=manual)" 1 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O4' AND refund_source='manual'"
ask "⑮ 非卡·已作廢的那筆不算"                   0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE refund_id='22222222-0000-0000-0000-000000000009'"
ask "⑯ 非卡·已取消 ⇒ 取消信 1"                  1 "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O5'"
ask "⑰ 非卡·已取消 ⇒ 退款信先等"                0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O5'"
ask "⑱ 混合軌 O6 ⇒ 取消信仍然不寄"              0 "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O6'"
ask "⑲ 混合軌 O6 ⇒ 退款信也不寄(等一封不會來的④)" 0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O6'"
ask "⑳ 對照組 O7 行為不變 ⇒ 1 且 active"        active "SELECT order_state FROM public.pcm_partial_refund_email_pending WHERE display_id='O7'"
ask "㉑ 去重:O8 寄過了 ⇒ 不再撈"                0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O8'"
# ⛔ ~~㉒ 只數 fixture 的退款筆數~~ —— 二審 nit 7:那是**恆真格**(它根本沒問 view)。
# ✅ 改成問 view:同一筆退款不得在退款信裡出現兩次(重複 = 客人收到兩封講同一筆錢)。
ask "㉒ 同一筆退款不得出現兩列(重複寄的形狀)"     0 "SELECT count(*) FROM (SELECT refund_id FROM public.pcm_partial_refund_email_pending GROUP BY refund_id HAVING count(*) > 1) d"
ask "㉔ X9 二審 must-fix 2:後登記而時間填在過去的人工退款 ⇒ 要寄" 1 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O9'"
ask "㉕ X12 二審 consider 4:NULL 付款方式 + 卡退 + 現金退 + 已取消 ⇒ 取消信不寄(混合軌)" 0 "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O10'"

# ── ④ 突變:每一發都要讓某一格從對變錯 ──────────────────────────────────────
mutate() {  # mutate <名稱> <舊字面> <新字面> <驗證SQL> <突變後期望>
  python3 - "$MIG" "$TMP/mut.sql" "$2" "$3" <<'PY'
import sys, io
src = io.open(sys.argv[1], encoding='utf-8').read()
old, new = sys.argv[3], sys.argv[4]
assert src.count(old) >= 1, '突變 anchor 命中 0 份'
io.open(sys.argv[2], 'w', encoding='utf-8').write(src.replace(old, new))
PY
  [ $? -eq 0 ] || { echo "  🔴 FAIL 突變「$1」套不上去"; fail=1; return; }
  $PSQL -f "$ROLLBACK" >/dev/null 2>&1
  if ! $PSQL -f "$TMP/mut.sql" >"$TMP/mut.log" 2>&1; then
    # 🔵 突變讓 migration 自己的事後閘紅 ⇒ 那也算「有東西在守」
    echo "  PASS 突變「$1」⇒ migration 的事後閘自己擋下來了"
    $PSQL -f "$ROLLBACK" >/dev/null 2>&1; $PSQL -f "$MIG" >/dev/null 2>&1; return
  fi
  got="$($PSQL -tAc "$4" 2>/dev/null | tr -d '[:space:]')"
  if [ "$got" = "$5" ]; then echo "  PASS 突變「$1」⇒ 那一格變成 $got(正版是另一個值)"
  else echo "  🔴 FAIL 突變「$1」⇒ 那一格仍是 ${got:-<錯誤>} ⇒ 這格沒有判別力"; fail=1; fi
  $PSQL -f "$ROLLBACK" >/dev/null 2>&1; $PSQL -f "$MIG" >/dev/null 2>&1
}
mutate "取消信不放寬到部分退款" "IN ('refunded', 'partiallyRefunded')" "IN ('refunded')" \
       "SELECT count(*) FROM public.pcm_cancelled_email_pending WHERE display_id='O1'" 0
mutate "退款信不收人工退款" "AND m.voided_at IS NULL
) x" "AND m.voided_at IS NULL AND false
) x" \
       "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O4'" 0
mutate "拿掉去重規則(會與取消信重複)" "        x.cancelled_at IS NULL
     OR EXISTS" "        x.cancelled_at IS NOT NULL
     OR EXISTS" \
       "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O1'" 1

# 收尾:正版再跑一次(突變沒有殘留)
ask "㉓ 換回正版後 G1 的退款信仍然先等" 0 "SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE display_id='O1'"

[ "$fail" = "0" ] && { echo "✅ 全過"; exit 0; } || { echo "🔴 有 FAIL"; exit 1; }
