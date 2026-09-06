#!/bin/bash
# probe-expire-day-boundary.sh — ⟦b4-EXPIREDAYBOUND⟧ 的【兩個世界】鑽機(可重跑, 會紅)
#
# 用途:在拋棄式 Postgres 上,把 `pcm_cron.expire_unpaid_orders` 的**舊述詞**與**新日界述詞**
#       各餵同一份 fixtures 跑一次,比對兩邊各取消了哪幾張單,並驗 migration 自己的閘。
# 🟢 零外部連線、零正式庫。跑完拆掉叢集並驗埠釋放。
#
# 用法:bash scripts/probe-expire-day-boundary.sh   ⇒ 全過 rc=0;任一格不如預期 rc=1
#
# 🔴🔴 **它會【紅】** —— 第一版不會(codex R1 #9:每一格只印結果、最後照樣 rc=0)
#    ⇒ 那種「可重跑證明」證不到東西:它與「每一格都失敗」印同一個 rc。
#
# ── 斷言(每一條都會讓整支 rc=1)──────────────────────────────────────────
#  A  舊那一代裝好之後, 正規化 md5 = 3a21a5aa1fa0d0f7b8b075c1cacfe85f
#     (🔬 同一個值 2026-09-06 也從**正式庫唯讀**量到 ⇒ 兩個獨立來源)
#  B  世界甲(舊述詞)取消的集合 **包含** b_edge,b_old,c_edge,c_old,t_old
#     🔴 為什麼是「包含」不是「等於」(codex R1 #10):fixture 吃**真實現在時間** ——
#        在台北 23:00 之後跑, `b_late` 也會超過舊版五天 ⇒ 舊世界會多取消一張。
#        ⇒ 那不是壞掉, 是舊述詞的定義。**把它寫進斷言, 不要寫進期望值。**
#  C  世界乙(新日界)取消的集合 **恰好等於** b_old,c_old,t_old
#     🔴 `c_old` 是 codex R3 #8 逼出來的:第三版只有 `c_edge`(cash 保活)而**沒有 cash 的正例**
#        ⇒ 📌 cash 分支若被寫成「永不取消」, 這支鑽機**抓不到**。
#     🔵 這一邊可以用等號:新界一律落在「明天 00:00」之後 ⇒ 與跑的時刻無關。
#  D  貼片 rc=0, 且事後斷言那行 NOTICE 有印出來
#  E  貼完的正規化 md5 = 2c4bbe9c55646f5cb9b4fb5347d87b26
#  F  冪等:同一支再貼一次 rc=0
#  G  負對照:把函式換成一支缺特徵的假版本 ⇒ 前置閘**必須擋下**(rc<>0)
#
# 🛑 它證不到什麼:fixtures 是我造的 ⇒ 它答「述詞對這九種輸入的行為」,
#    **不答**「正式庫裡的單長不長這樣」。真實分佈要另外量。

set -uo pipefail
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
WT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$WT/supabase/migrations/20260906600000_m4b_expire_day_boundary.sql"
SRC="$WT/supabase/migrations/20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql"
OLD_MD5=3a21a5aa1fa0d0f7b8b075c1cacfe85f
NEW_MD5=2c4bbe9c55646f5cb9b4fb5347d87b26
OLD_RAW=b91dc97700d43dd1015dd31ff6eacdfa
NEW_RAW=7e1e6764def6738440a1012cbea44f05
test -f "$MIG" || { echo "🔴 找不到 $MIG"; exit 1; }
test -f "$SRC" || { echo "🔴 找不到 $SRC"; exit 1; }

SP="$(mktemp -d /tmp/expbnd.XXXXXX)"
D=""
PORT=""
# 🔴 codex R1 #11:第一版的 trap 只清 $SP ⇒ PG 起來之後任何中途失敗都會留下叢集,
#    甚至留下一個還在監聽的行程。⇒ trap 要**兩層都收**。
# 🔴 codex R2 #11:第二版的 trap 收兩層了, 而**收攤失敗只印字**
#    ⇒ 它照樣刪掉資料目錄、照樣以 rc=0 結束 ⇒ 「收乾淨了」與「收不掉」印同一個 rc。
#    ✅ 收攤失敗 ⇒ 把整支的結束碼改成 2, 而且**不刪資料目錄**(留給人看)。
cleanup() {
  local rc=$?
  local dirty=0
  if [ -n "$D" ] && [ -d "$D/data" ]; then
    if ! LC_ALL=C pg_ctl -D "$D/data" stop -m immediate > /dev/null 2>&1; then
      echo "🔴 收攤:pg_ctl stop 失敗 —— 叢集留在 $D, 不刪, 自己看 $D/pg.log"
      dirty=1
    fi
    sleep 1
  fi
  if [ -n "$PORT" ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "🔴 收攤:埠 $PORT 仍在監聽 —— 叢集留在 $D, 不刪"
    dirty=1
  fi
  if [ "$dirty" = 0 ] && [ -n "$D" ]; then rm -rf "$D"; fi
  rm -rf "$SP"
  if [ "$dirty" = 1 ]; then exit 2; fi
  exit "$rc"
}
trap cleanup EXIT

FAIL=0
bad() { printf '🔴 FAIL %s\n' "$1"; FAIL=1; }
ok()  { printf '🟢 PASS %s\n' "$1"; }

cat > "$SP/bootstrap.sql" <<'BOOTEOF'
\set ON_ERROR_STOP on
CREATE SCHEMA pcm_cron;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_reason text,
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_channel text NOT NULL DEFAULT 'tappay',
  label text
);
CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  amount integer NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_charge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sweeper_heartbeat (
  job_name text PRIMARY KEY,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
BOOTEOF

cat > "$SP/fixtures.sql" <<'FIXEOF'
\set ON_ERROR_STOP on
TRUNCATE public.orders, public.order_payments, public.payment_charge_attempts;
DO $f$
DECLARE d timestamptz;
BEGIN
  d := pg_catalog.timezone('Asia/Taipei', pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Taipei', pg_catalog.now())));
  INSERT INTO public.orders (label, payment_channel, created_at) VALUES
    ('b_old',   'bank_transfer', d - interval '6 days' + interval '12 hours'),
    ('b_edge',  'bank_transfer', d - interval '5 days'),
    ('b_late',  'bank_transfer', d - interval '5 days' + interval '23 hours'),
    ('c_edge',  'cash',          d - interval '5 days'),
    ('c_old',   'cash',          d - interval '6 days' + interval '12 hours'),
    ('t_old',   'tappay',        pg_catalog.now() - interval '2 days'),
    ('t_new',   'tappay',        pg_catalog.now() - interval '12 hours'),
    ('n_none',  'none',          d - interval '100 days'),
    ('b_paid',  'bank_transfer', d - interval '10 days'),
    ('b_att',   'bank_transfer', d - interval '10 days');
  INSERT INTO public.order_payments (order_id, amount)
    SELECT id, 100 FROM public.orders WHERE label = 'b_paid';
  INSERT INTO public.payment_charge_attempts (order_id, status)
    SELECT id, 'pending' FROM public.orders WHERE label = 'b_att';
END
$f$;
SELECT pcm_cron.expire_unpaid_orders(500) AS expired_count;
SELECT string_agg(label, ',' ORDER BY label) AS cancelled_labels
  FROM public.orders WHERE cancelled_at IS NOT NULL;
SELECT string_agg(label, ',' ORDER BY label) AS alive_labels
  FROM public.orders WHERE cancelled_at IS NULL;
FIXEOF

D=/tmp/pcm-probe-expbnd-$$
[ -e "$D" ] && { echo "🔴 $D 已存在"; exit 1; }
read -r PORT _ < <(bash "$WT/scripts/free-port.sh" --two) || { echo "🔴 取不到埠"; exit 1; }
echo "🔵 PG 埠 = $PORT · 叢集 = $D"
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 \
  || { tail -5 "$D/initdb.log"; exit 1; }
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start > /dev/null
sleep 3
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -tAc "select 1" > /dev/null || { tail -6 "$D/pg.log"; exit 1; }
MD5Q="SELECT pg_catalog.md5(pg_catalog.regexp_replace(pg_catalog.regexp_replace(prosrc,'--[^'||chr(10)||']*','','g'),'\s+','','g')) FROM pg_catalog.pg_proc WHERE oid='pcm_cron.expire_unpaid_orders(integer)'::regprocedure;"
RAWQ="SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='pcm_cron.expire_unpaid_orders(integer)'::regprocedure;"
cancelled() { "${PSQL[@]}" -tAc "SELECT coalesce(string_agg(label,',' ORDER BY label),'(空)') FROM public.orders WHERE cancelled_at IS NOT NULL"; }

echo "=== A. bootstrap + 裝【舊那一代】(sed -n '401,543p' 20260904230000)==="
"${PSQL[@]}" -q -f "$SP/bootstrap.sql" > /dev/null || { echo "🔴 bootstrap 失敗"; exit 1; }
sed -n '401,543p' "$SRC" | "${PSQL[@]}" -q > /dev/null || { echo "🔴 裝舊函式失敗"; exit 1; }
# 🔴 COMMENT 也要裝 —— 本片的前置閘 ③d 會錨它(codex R2 新 #3);少了這一段,
#    拋棄式庫的 COMMENT 是空的 ⇒ ③d 會擋下, 而那是**環境不完整**不是本片有問題。
sed -n '553,564p' "$SRC" | "${PSQL[@]}" -q > /dev/null || { echo "🔴 裝舊 COMMENT 失敗"; exit 1; }
"${PSQL[@]}" -q -c "REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer) FROM PUBLIC;" > /dev/null
GOT=$("${PSQL[@]}" -tAc "$MD5Q")
[ "$GOT" = "$OLD_MD5" ] && ok "A 舊那一代 正規化md5 = $GOT" || bad "A 舊那一代 正規化md5 = $GOT(期望 $OLD_MD5)"
GOTR=$("${PSQL[@]}" -tAc "$RAWQ")
[ "$GOTR" = "$OLD_RAW" ] && ok "A 舊那一代 原始md5 = $GOTR" || bad "A 舊那一代 原始md5 = $GOTR(期望 $OLD_RAW)"

echo "=== B. 世界甲:舊述詞 ==="
"${PSQL[@]}" -q -f "$SP/fixtures.sql" > /dev/null || { echo "🔴 fixtures 失敗"; exit 1; }
OLDSET=$(cancelled); echo "   取消:$OLDSET"
MISS=""
for lbl in b_edge b_old c_edge c_old t_old; do
  case ",$OLDSET," in *",$lbl,"*) ;; *) MISS="$MISS $lbl";; esac
done
[ -z "$MISS" ] && ok "B 舊世界含四張判別單" || bad "B 舊世界少了:$MISS"

echo "=== C. 貼本片 ==="
"${PSQL[@]}" -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "D 貼片 rc=0" || { bad "D 貼片 rc=$RC"; tail -5 "$D/apply.log"; }
grep -q '事後斷言全數通過' "$D/apply.log" && ok "D 事後斷言 NOTICE 有印" || bad "D 事後斷言那行 NOTICE 沒印出來"
GOT=$("${PSQL[@]}" -tAc "$MD5Q")
[ "$GOT" = "$NEW_MD5" ] && ok "E 貼完 正規化md5 = $GOT" || bad "E 貼完 正規化md5 = $GOT(期望 $NEW_MD5)"
GOTR=$("${PSQL[@]}" -tAc "$RAWQ")
[ "$GOTR" = "$NEW_RAW" ] && ok "E 貼完 原始md5 = $GOTR" || bad "E 貼完 原始md5 = $GOTR(期望 $NEW_RAW)"

echo "=== D. 世界乙:新日界(同一份 fixtures)==="
"${PSQL[@]}" -q -f "$SP/fixtures.sql" > /dev/null || { echo "🔴 fixtures 失敗"; exit 1; }
NEWSET=$(cancelled); echo "   取消:$NEWSET"
[ "$NEWSET" = "b_old,c_old,t_old" ] && ok "C 新世界恰好取消 b_old,c_old,t_old" || bad "C 新世界取消 $NEWSET(期望 b_old,c_old,t_old)"

echo "=== E. 冪等:再貼一次 ==="
"${PSQL[@]}" -f "$MIG" > "$D/apply2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "F 冪等重貼 rc=0" || { bad "F 冪等重貼 rc=$RC"; tail -5 "$D/apply2.log"; }

echo "=== F. 負對照:換成一支缺特徵的假函式, 前置閘要擋下 ==="
"${PSQL[@]}" -q -c "CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS \$f\$ BEGIN RETURN 0; END \$f\$;" > /dev/null
"${PSQL[@]}" -f "$MIG" > "$D/apply3.log" 2>&1; RC=$?
[ "$RC" != 0 ] && ok "G 前置閘擋下假版本(rc=$RC)" || bad "G 前置閘【沒有】擋下假版本 ⇒ 那道閘是假的"
grep -oE '前置閘[0-9③②a-b]*[^ ]*' "$D/apply3.log" | head -1

echo "──────────────────────────────"
[ "$FAIL" = 0 ] && echo "🟢 全部斷言通過" || echo "🔴 有斷言失敗(見上面 FAIL 行)"
exit "$FAIL"
