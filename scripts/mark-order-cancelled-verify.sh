#!/usr/bin/env bash
# mark-order-cancelled-verify.sh
#   在【拋棄式 PG】上驗 `20260902140000_m4b_mark_order_cancelled.sql` 的**行為**。
#
# 🔴 為什麼要有它:那支 migration 的四道事後閘驗的是【定義】(欄的形狀 / COMMENT 的字面 /
#    函式存在且 SECURITY DEFINER / ACL)。**一個函式建起來了, 與它擋不擋得住東西, 是兩個宣稱。**
#    而正式庫上不做行為探針, 是 Sean 2026-08-30 拍板【甲】的既有裁決。⇒ 行為那一層落在這裡。
#
# 🛑 **天花板/射程(先讀, 不要外推)**
#   · **本機拋棄式庫** ⇒ 證不出正式庫的行為(未知觸發器 / RULE / RLS / 殘留約束)。
#   · 🔴🔴 **`admin_audit_log` 與 `staff` 現在是【從真 migration 原樣抽出】的, 不是手寫。**
#     成因是量到的:第一版把 `admin_audit_log.request_id` 手寫成 `uuid`,而**真表是 `text`**
#     (`20260712210000` 檔內 `request_id  text        NOT NULL`)
#     ⇒ 函式裡 `g.request_id = p_idempotency_key`(沒 cast)在真表上會炸
#     `ERROR: operator does not exist: text = uuid`,**而 harness 17/17 全綠**。
#     📌 **⇒ 一個手寫的 fixture, 會把「型別不合」這種 bug 蓋得剛剛好。**
#   · ⚠️ **而 `orders` / `order_items` / `order_cancellation_items` 仍是最小手寫版** ——
#     前兩者沒有單一 `CREATE TABLE`(跨十幾支 migration 演化), 第三者的複合 FK 指向本檔沒有的表。
#     ⇒ 它們的欄型別逐一對過真 DDL(見 fixture 內每一欄旁的出處), **而那是【人核】不是【機械核】**
#     ⇒ 這一格仍然是本檔最可能出錯的地方。
#   · 它**不驗** RLS、不驗 outbox、不驗任何 TS。
#
# 用法:bash scripts/mark-order-cancelled-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL / 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260902140000_m4b_mark_order_cancelled.sql"
D=$(mktemp -d "${TMPDIR:-/tmp}/moc.XXXXXXXX") || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是乾淨 ⇒ exit 9"; exit 9; }
PG=54374
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
[ -f "$M" ] || { echo "🔴 找不到 $M ⇒ ENV-FAIL"; KEEP=1; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

# 🔴 LC_ALL 一定要給:少了它 PG 17 在 macOS 起不來("postmaster became multithreaded during startup")。
export LC_ALL=C LANG=C
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" -w start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL(log: $D/pg.log)"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0
OID_A='00000000-0000-0000-0000-0000000000a1'
KEY1='11111111-1111-1111-1111-111111111111'
KEY2='22222222-2222-2222-2222-222222222222'

cat > "$D/fixture.sql" <<'PSQL'
-- Supabase 的三個角色在拋棄式庫裡不存在 ⇒ REVOKE/GRANT 會 ERROR「role does not exist」。
-- 🔵 這一格是實跑撞到的, 不是預想的:第一發 migration 停在 `role "anon" does not exist`。
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
END $r$;
DROP TYPE IF EXISTS public.payment_status CASCADE;
DROP TABLE IF EXISTS public.admin_audit_log, public.order_cancellation_items,
                     public.order_items, public.orders, public.staff CASCADE;
DROP FUNCTION IF EXISTS public.admin_mark_order_cancelled(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.admin_cancel_order(uuid,uuid,text,text,text,jsonb);
-- staff:原樣抽出(下面那個佔位由 shell 用 sed 從真 migration 填進來)
__STAFF_DDL__
-- 🔴🔴 **逐欄對過真表**(2026-09-02;R1 抓到 request_id、R3 抓到 payment_status ⇒ **同一支檔第二次**
--    ⇒ 那不是巧合, 是這份 fixture 的建法有問題 ⇒ 主視窗要求把每一欄對一次並把結果寫進檔案)。
--    出處 = `20260604120000_m3_s2a_orders_order_items.sql` 與 `20260712203000_m4a_orders_admin_columns.sql`。
--    ✅ 已對且相同 / ⚠️ 刻意簡化(下面逐欄標)
--      orders.id                uuid                       ✅
--      orders.payment_status    **enum payment_status**     ✅ 本版起用真 enum(舊版手寫 text = R3 F3)
--      orders.payment_method    text(可 NULL)              ✅
--      orders.cancelled_at      timestamptz(可 NULL)       ✅(20260712203000 ADD COLUMN)
--      orders.cancelled_reason  text(可 NULL)              ✅(同上)
--      orders.updated_at        timestamptz NOT NULL now()  ✅
--      ⚠️ orders 真表**還有幾十欄**(金額 / 客戶 / 物流 …)—— 本 fixture **刻意只建函式用得到的**
--         ⇒ **「欄不存在」那一族的 bug 在這裡永遠不會出現**。這是已知缺口, 不是漏做。
--      order_items.id / order_id / quantity                 ✅ 型別相同
--      ⚠️ order_items.quantity 真表有 `CHECK (quantity > 0)` ⇒ 本版補上(舊版沒有)
--      ⚠️ order_items 真表還有 variant_sku / product_snapshot / unit_price / line_total 等 NOT NULL 欄
--         ⇒ 本 fixture 沒有 ⇒ **「插一列 order_items 會不會被別的 NOT NULL 擋住」在這裡量不到**
CREATE TYPE public.payment_status AS ENUM ('unpaid', 'paid', 'partiallyPaid', 'refunded', 'partiallyRefunded');
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_method text,
  cancelled_at timestamptz,
  cancelled_reason text,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id),
  quantity integer NOT NULL CHECK (quantity > 0));
-- order_cancellation_items:最小手寫版(真表有指向本檔沒有的表的複合 FK)。
-- 欄型別出處(逐一對過):`20260730130000` 檔內 CREATE TABLE public.order_cancellation_items ——
--   id uuid / cancellation_id uuid / order_id uuid / order_item_id uuid / cancelled_quantity integer
--      order_cancellation_items.id / order_item_id / cancelled_quantity  ✅ 型別相同
--      ⚠️ 真表另有 `cancellation_id uuid NOT NULL` 與 `order_id uuid NOT NULL`(冗餘欄, 給複合 FK 用)
--         ⇒ 本 fixture 沒有 ⇒ **那兩道複合 FK 的行為在這裡量不到**
--      ⚠️ 真表有 `CHECK (cancelled_quantity > 0)` ⇒ 本版補上
CREATE TABLE public.order_cancellation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  cancelled_quantity integer NOT NULL CHECK (cancelled_quantity > 0));
-- admin_audit_log:原樣抽出。🔴 **這一張就是第一版手寫錯的那一張**
--    (request_id 手寫成 uuid, 而真表是 text)⇒ 從今以後不手寫。
__AUDIT_DDL__
-- 前置閘④ 要求 admin_cancel_order 在場(本片抄它的七值映射表)⇒ 種一支空殼。
CREATE FUNCTION public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)
  RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$;
INSERT INTO public.staff (id, label, is_active) VALUES ('staff_on','在職',true), ('staff_off','離職',false);
PSQL

# 🔴 把兩張真表的 DDL 原樣抽進 fixture(不手抄)。抽不到 ⇒ ENV-FAIL, 不要用一份殘缺的 fixture 去量。
AUD="$REPO/supabase/migrations/20260712210000_m4a_admin_audit_log.sql"
STF="$REPO/supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql"
for f in "$AUD" "$STF"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
sed -n '/^CREATE TABLE public\.admin_audit_log (/,/^);/p' "$AUD" > "$D/aud.sql"
sed -n '/^CREATE TABLE public\.staff (/,/^);/p'           "$STF" > "$D/stf.sql"
AB=$(wc -c < "$D/aud.sql" | tr -d ' '); SB=$(wc -c < "$D/stf.sql" | tr -d ' ')
grep -q 'request_id' "$D/aud.sql" && [ "$AB" -gt 400 ] || { printf '🔴 抽不到 admin_audit_log DDL(%s bytes)⇒ ENV-FAIL\n' "$AB"; KEEP=1; exit 2; }
grep -q 'is_active'  "$D/stf.sql" && [ "$SB" -gt 200 ] || { printf '🔴 抽不到 staff DDL(%s bytes)⇒ ENV-FAIL\n' "$SB"; KEEP=1; exit 2; }
printf '  ✅ admin_audit_log(%sB)與 staff(%sB)DDL 從真 migration 原樣抽出, 不是手抄\n' "$AB" "$SB"
python3 - "$D/fixture.sql" "$D/aud.sql" "$D/stf.sql" <<'PYX'
import io, sys
fx, aud, stf = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(fx, encoding='utf-8').read()
assert s.count('__AUDIT_DDL__') == 1 and s.count('__STAFF_DDL__') == 1
s = s.replace('__AUDIT_DDL__', io.open(aud, encoding='utf-8').read().rstrip())
s = s.replace('__STAFF_DDL__', io.open(stf, encoding='utf-8').read().rstrip())
io.open(fx, 'w', encoding='utf-8').write(s)
PYX

# 種一張單 · $1=id $2=payment_status $3=payment_method $4=cancelled_at(NULL 或 'now()')
# 🔴 R3 consider:上一版**丟掉 rc** ⇒ 種資料被 NOT NULL / CHECK 擋掉時**完全安靜**,
#    接著函式回「查無單」的同一句 generic ⇒ **紅的理由會指錯地方**。⇒ 收 rc,種不進去就當場作廢。
seed(){
  q -q -c "INSERT INTO public.orders (id,payment_status,payment_method,cancelled_at)
           VALUES ('$1','$2',$3,$4);
           INSERT INTO public.order_items (id,order_id,quantity)
           VALUES ('$1'::uuid,'$1',3);" > "$D/seed.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ] || grep -q ERROR "$D/seed.log"; then
    printf '  🔴 種不進單 %s(rc=%s)⇒ 後面那一格量的不是它宣稱的東西 ⇒ 作廢\n' "$1" "$rc"
    head -2 "$D/seed.log"; KEEP=1; FAIL=$((FAIL+1)); return 1
  fi
}

# $1=世界名 $2=期望 OK|ERR $3=期望訊息片段(可空) $4=SQL
w(){
  local out rc
  out=$(q -tAc "$4" 2>&1); rc=$?
  if [ "$2" = OK ]; then
    if [ $rc -eq 0 ]; then
      if [ -n "${3:-}" ] && ! printf '%s' "$out" | grep -q "$3"; then
        printf '  %-46s ⇒ 🔴 過了但回值不含「%s」(實得 %s)\n' "$1" "$3" "$out"; KEEP=1; FAIL=$((FAIL+1)); return
      fi
      printf '  %-46s ⇒ ✅ %s\n' "$1" "$out"; PASS=$((PASS+1))
    else
      printf '  %-46s ⇒ 🔴 預期成功而它炸了:%s\n' "$1" "$(printf '%s' "$out" | head -1)"; KEEP=1; FAIL=$((FAIL+1))
    fi
  else
    if [ $rc -eq 0 ]; then
      printf '  %-46s ⇒ 🔴 預期被擋而它【過了】(回 %s)\n' "$1" "$out"; KEEP=1; FAIL=$((FAIL+1))
    elif [ -n "${3:-}" ] && ! printf '%s' "$out" | grep -q "$3"; then
      # 🔴 對的紅在錯的地方, 與對的紅長得一樣 ⇒ 一定要比訊息。
      printf '  %-46s ⇒ 🔴 紅了但不是那道閘(要「%s」)\n' "$1" "$3"; KEEP=1; FAIL=$((FAIL+1))
    else
      printf '  %-46s ⇒ ✅ 被擋\n' "$1"; PASS=$((PASS+1))
    fi
  fi
}

base(){ q -q -f "$D/fixture.sql" > "$D/b.log" 2>&1 && q -q -f "$M" > "$D/m.log" 2>&1; }

echo "── 起手:fixture + migration ────────────────────────────────"
if ! base; then
  echo "🔴 fixture 或 migration 跑不起來 ⇒ 全部作廢"; tail -5 "$D/b.log" "$D/m.log" 2>/dev/null; KEEP=1; exit 1
fi
grep -q ERROR "$D/m.log" && { echo "🔴 migration 有 ERROR ⇒ 全部作廢"; grep ERROR "$D/m.log" | head -3; KEEP=1; exit 1; }
echo "  ✅ migration 五道閘全過(欄形狀 / COMMENT 三句 / 函式 / 收權 / ACL)"

# 🔴 R2 must-fix:上一版只驗「關鍵字有出現 + bytes 夠多」——
#    一段**保留了 request_id 卻漏掉別的欄**的可執行殘段照樣過, 而它會印「原樣抽出」。
#    ⇒ 改成【比欄位集合】:從抽出來的 DDL 文字解析欄名, 再從 information_schema 讀實際欄名, 兩邊必須相同。
# 🔴🔴 **第一版這裡是【同一把尺量兩次】,而突變當場證明它近乎恆真**:
#    它拿「抽出來的 `$D/aud.sql`」去比「庫裡的欄」——
#    **而庫裡的欄就是用那份抽出來的檔建的** ⇒ 兩邊永遠一致。
#    實測:把 sed 範圍改成【只抽到 request_id 為止】(保留 request_id ⇒ 舊的關鍵字閘照樣過)
#    ⇒ 我的比對印 **「✅ 欄位集合一致(9 欄)」**,而真表是 10 欄。
#    ⇒ 抓到那一發的是世界① 炸了 `column "source_app" does not exist`,**不是這道閘**。
#    📌 **⇒ 一把尺如果兩端都來自同一個來源, 它量的是「我自己一致嗎」, 不是「我對嗎」。**
# ✅ 修法:期望值改成【直接從真 migration 檔用 python 獨立解析】——
#    與 sed 抽取**是兩個不同的實作**, 抽取截斷時兩邊就會對不上。
ddl_cols(){ # $1=真 migration 檔  $2=表名
  python3 - "$1" "$2" <<'PYC'
import io, re, sys
src, tbl = sys.argv[1], sys.argv[2]
lines = io.open(src, encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('CREATE TABLE public.%s (' % tbl))
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith(');'))
out = []
for l in lines[start + 1:end]:
    l = re.sub(r'--.*$', '', l)
    m = re.match(r'^\s+([a-z_][a-z0-9_]*)\s+\S', l)
    if m and m.group(1).upper() not in ('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'):
        out.append(m.group(1))
print('\n'.join(sorted(set(out))))
PYC
}
db_cols(){ q -tAc "SELECT column_name FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='$1' ORDER BY 1;" | sort -u; }
for t in admin_audit_log staff; do
  f="$AUD"; [ "$t" = staff ] && f="$STF"
  ddl_cols "$f" "$t" > "$D/$t.ddl.cols"; db_cols "$t" > "$D/$t.db.cols"
  nd=$(wc -l < "$D/$t.ddl.cols" | tr -d ' '); nb=$(wc -l < "$D/$t.db.cols" | tr -d ' ')
  if [ "$nd" -lt 4 ]; then
    printf '  🔴 %s:從 DDL 只解析出 %s 個欄名 ⇒ 解析器壞了(不是表壞了)⇒ ENV-FAIL\n' "$t" "$nd"; KEEP=1; exit 2
  fi
  if ! diff -q "$D/$t.ddl.cols" "$D/$t.db.cols" > /dev/null; then
    printf '  🔴 %s:DDL 欄名(%s)與庫裡實際欄名(%s)不一致 ⇒ 抽到殘段 ⇒ 本輪作廢\n' "$t" "$nd" "$nb"
    diff "$D/$t.ddl.cols" "$D/$t.db.cols" | head -6; KEEP=1; exit 1
  fi
  printf '  ✅ %s 欄位集合一致(%s 欄)—— 【真 migration 獨立解析】與庫裡的相同\n' "$t" "$nd"
done

echo "── 三道業務閘 ───────────────────────────────────────────────"
seed "$OID_A" refunded "'tappay'" NULL
w "① 刷卡 + 全額退款 + 未取消 ⇒ 標得起來" OK '"marked": true' \
  "SELECT public.admin_mark_order_cancelled('$OID_A','$KEY1','staff_on','customer_request',NULL);"

seed '00000000-0000-0000-0000-0000000000a2' refunded "'bank_transfer'" NULL
w "② 匯款的單 ⇒ 拒" ERR '只開放刷卡' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a2','$KEY2','staff_on','customer_request',NULL);"

# 🔴 codex R1 must-fix:少了 NULL 那一格 ⇒ 有人把 `IS DISTINCT FROM` 誤改成 `<>` 時,
#    NULL 會**穿過**業務閘(`NULL <> 'tappay'` 求值 NULL ⇒ IF 不成立 ⇒ 放行), 而其餘世界全綠。
seed '00000000-0000-0000-0000-0000000000a9' refunded NULL NULL
w "②b 付款方式是 NULL ⇒ 拒(NULL 不得穿過)" ERR '只開放刷卡' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a9','$KEY2','staff_on','customer_request',NULL);"

# 🛑 **舊的世界③b(payment_status = NULL)已刪除, 而理由要留著**(R3 F3):
#    ① 它是**假綠** —— `seed` 把 `$2` 包在單引號裡 ⇒ 送進去的是字串 `'NULL'` 不是 SQL NULL
#       ⇒ 那一格**從來沒有測到 NULL**, 而它宣稱擋的是 `IS DISTINCT FROM`→`<>` 的突變
#       ⇒ 對 payment_status 那一半**兩個世界印同一個綠**(`'NULL' <> 'refunded'` 照樣真)。
#    ② 而更下面一層:真表 `payment_status` 是 **enum 且 NOT NULL**
#       ⇒ **那個世界在正式庫結構上不存在** —— 它是手寫 fixture 造出來的。
#    📌 **⇒ 兩個理由都要留:①說它沒測到, ②說它不該存在。只留②會讓人以為那道尺是好的。**
#    🔵 而 `payment_method` 那一半(②b)**留著** —— 真表那一欄是 `text` 且**可以是 NULL**。

seed '00000000-0000-0000-0000-0000000000a3' partiallyRefunded "'tappay'" NULL
w "③ 只退了一部分 ⇒ 拒(部分退款不涵蓋)" ERR '還沒有全額退款' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a3','$KEY2','staff_on','customer_request',NULL);"

seed '00000000-0000-0000-0000-0000000000a4' refunded "'tappay'" 'now()'
w "④ 已經取消過的單 ⇒ 拒" ERR '已經取消過' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a4','$KEY2','staff_on','customer_request',NULL);"

seed '00000000-0000-0000-0000-0000000000a5' refunded "'tappay'" NULL
w "⑤ 離職員工 ⇒ 拒" ERR '標記失敗' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a5','$KEY2','staff_off','customer_request',NULL);"

echo "── 🔴 第四道閘(R3 F1;主視窗判甲, 不是 Sean 拍板)────────────"
# 🛑 **這一格的宣稱在 2026-09-02 被【翻面】了, 舊字面留著** ——
#    ~~「⑥ 先前被部分取消過而沒關單 ⇒ **仍可標記**」(而檔頭把它寫成「最重要的一格」)~~
#    🔴 R3 抓到:`20260830020000` 把「`cancelled_at` 非空 ⟺ 每個品項都被取消完」當**硬不變式**在驗。
#       那類單有舊的 `order.cancel` 稽核列 ⇒ 舊冪等鍵重放會撞上它而炸;
#       而對方步5 的「已取消 ⇒ 拒」會讓**剩下那幾個品項永遠再也取消不了**(不釋庫存, 而後台看不出來)。
#    📌 **⇒ 我當初用來反對「= 0」的那張唯一的牌, 就是製造那個洞的那個輸入。**
#    ✅ ⇒ 加第四道閘拒掉它。**而斷言【不改】** —— 閘擋「進來之前就有」, 斷言擋「交易中途插進來」。
seed '00000000-0000-0000-0000-0000000000a6' refunded "'tappay'" NULL
q -q -c "INSERT INTO public.order_cancellation_items (order_item_id,cancelled_quantity)
         VALUES ('00000000-0000-0000-0000-0000000000a6'::uuid, 1);" > "$D/seed6.log" 2>&1 \
  || { echo "  🔴 種不進取消列 ⇒ 世界⑥ 量的不是它宣稱的東西 ⇒ 作廢"; KEEP=1; FAIL=$((FAIL+1)); }
w "⑥ 先前被部分取消過 ⇒ 拒(第四道閘)" ERR '先前被部分取消過' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a6','$KEY2','staff_on','out_of_stock',NULL);"
w "⑥b 而它那 1 列數量沒有被動過(閘擋在寫之前)" OK '^1$' \
  "SELECT count(*)::text FROM public.order_cancellation_items ci JOIN public.order_items oi ON oi.id=ci.order_item_id WHERE oi.order_id='00000000-0000-0000-0000-0000000000a6';"
# 🔵 **負對照**:世界① 那張乾淨的單走同一條路 ⇒ **通過** ⇒ 證明這道閘不是「全部都擋」。
w "⑥c 負對照:乾淨的單走同一條路 ⇒ 通過" OK '^0$' \
  "SELECT count(*)::text FROM public.order_cancellation_items ci JOIN public.order_items oi ON oi.id=ci.order_item_id WHERE oi.order_id='$OID_A';"

echo "── 訊號欄與稽核 ─────────────────────────────────────────────"
# 🔴 psql 對 boolean 的 `::text` 印的是 **true/false**, 不是 t/f
#    (第一版寫 '^t$' ⇒ 它紅了, 而紅得對:錯的是我的期望字面。**今天同一個坑第三次。**)
w "⑦ 標過的單 cancel_items_untouched = true" OK '^true$' \
  "SELECT cancel_items_untouched::text FROM public.orders WHERE id='$OID_A';"
# 🔴 R3 nit:`^order.mark_cancelled$` 走 grep ⇒ 那兩個 `.` 是**萬用字元**(`orderXmarkYcancelled` 也會中)。
#    ⇒ 改成跳脫。(不用 `-F`, 因為還要留 `^` `$` 錨。)
w "⑧ 稽核 action 是 order.mark_cancelled(不是 order.cancel)" OK '^order\.mark_cancelled$' \
  "SELECT action FROM public.admin_audit_log WHERE target='order:$OID_A';"
w "⑨ 對客文字照七值映射表" OK '依您要求取消' \
  "SELECT cancelled_reason FROM public.orders WHERE id='$OID_A';"

echo "── 冪等與輸入驗 ─────────────────────────────────────────────"
w "⑩ 同一把鑰匙重放 ⇒ idempotent" OK '"idempotent": true' \
  "SELECT public.admin_mark_order_cancelled('$OID_A','$KEY1','staff_on','customer_request',NULL);"
w "⑩b 而稽核【沒有多一列】" OK '^1$' \
  "SELECT count(*)::text FROM public.admin_audit_log WHERE target='order:$OID_A';"
w "⑩c 同鑰匙但換了取消理由 ⇒ fail-loud" ERR '標記失敗' \
  "SELECT public.admin_mark_order_cancelled('$OID_A','$KEY1','staff_on','other','另一段理由');"
w "⑪ 同鑰匙不同人 ⇒ fail-loud" ERR '標記失敗' \
  "SELECT public.admin_mark_order_cancelled('$OID_A','$KEY1','staff_off','customer_request',NULL);"
seed '00000000-0000-0000-0000-0000000000a7' refunded "'tappay'" NULL
w "⑫ 未知原因碼 ⇒ 拒" ERR '未知取消原因碼' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a7','$KEY2','staff_on','zz_not_a_code',NULL);"
w "⑬ other 沒填說明 ⇒ 拒" ERR 'other 需填取消說明' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a7','$KEY2','staff_on','other',NULL);"
w "⑭ 非 other 卻填了說明 ⇒ 拒" ERR '非 other 不得填說明' \
  "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a7','$KEY2','staff_on','out_of_stock','多餘的話');"

echo "── 🔵 正對照:那道【前後相等】斷言真的會炸嗎 ────────────────"
# 🔴 這一格是本檔的核心 —— 少了它,「函式不動數量」只是「我沒寫那段碼」,不是「它擋得住」。
#    做法:把函式改成【偷插一列 cancellation_item】,其餘一字不改 ⇒ 步10 必炸。
#    ⚠️ 突變只改函式本體那一處,**不碰步7/步10 的斷言本身**(否則會把偵測器一起關掉)。
# 🔴 code-reviewer must-fix:這一發 **丟 rc**。它建不起來時, 庫裡留著【上一支】突變函式,
#    而兩發期望的錯字面**同樣是**「動到了品項數量」⇒ 下一格照樣 ✅ ⇒ **條件性假綠**。
#    (R3 給 `seed()` 的同一帖處方, 這兩個姊妹呼叫點當時沒套到。)
mutfn(){ # $1=函式體 SQL
  q -q -c "$1" > "$D/zz.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ] || grep -q ERROR "$D/zz.log"; then
    printf '  🔴 突變函式建不起來(rc=%s)⇒ 下一格量的不是它宣稱的東西 ⇒ 作廢\n' "$rc"
    head -2 "$D/zz.log"; KEEP=1; FAIL=$((FAIL+1)); return 1
  fi
}
mutfn "
CREATE OR REPLACE FUNCTION public.zz_mutant(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS \$z\$
BEGIN
  INSERT INTO public.order_cancellation_items (order_item_id, cancelled_quantity)
  SELECT oi.id, 1 FROM public.order_items oi WHERE oi.order_id = p_order_id LIMIT 1;
END \$z\$;"
MUT="$D/mut.sql"
python3 - "$M" "$MUT" <<'PYEOF'
import io, sys
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
anchor = "  -- 步9 稽核。"
assert s.count(anchor) == 1, s.count(anchor)
s = s.replace(anchor, "  PERFORM public.zz_mutant(p_order_id);\n" + anchor)
s = s.replace("CREATE FUNCTION public.admin_mark_order_cancelled(",
              "CREATE OR REPLACE FUNCTION public.admin_mark_order_cancelled(")
io.open(dst, 'w', encoding='utf-8').write(s)
print("MUTBYTES=%d" % (len(s) - len(io.open(src, encoding='utf-8').read())))
PYEOF
MB=$(python3 -c "
import io,sys
a=len(io.open('$M',encoding='utf-8').read()); b=len(io.open('$MUT',encoding='utf-8').read()); print(b-a)")
# 🔴 印出【突變改了幾 bytes】—— 沒改到東西時, 下面那一發會正常通過而看起來像通過。
if [ "$MB" -le 0 ]; then
  printf '  %-46s ⇒ 🔴 突變一個 byte 都沒改到(diff=%s)⇒ 這一格證不了任何事\n' "⑮ 突變:函式偷插一列數量" "$MB"; KEEP=1; FAIL=$((FAIL+1))
else
  # 只重建函式(migration 其餘部分 forward-only 會擋)⇒ 抽出 CREATE OR REPLACE 那一段。
  awk '/^CREATE OR REPLACE FUNCTION public\.admin_mark_order_cancelled\(/,/^\$fn\$;$/' "$MUT" > "$D/mutfn.sql"
  # 🔴 code-reviewer nit:空檔 ⇒ `psql -f` 回 rc=0 ⇒ ⑮ 會拿【原版】函式去跑
  #    (方向安全 —— 它會紅 —— 但紅的理由是假的)。R3 那帖只套到 origfn, 這裡補上。
  if [ ! -s "$D/mutfn.sql" ]; then
    printf '  %-46s ⇒ 🔴 抽不到突變版函式(空檔)⇒ 本輪作廢\n' "⑮ 突變:函式偷插一列數量"; KEEP=1; FAIL=$((FAIL+1))
  elif ! q -q -f "$D/mutfn.sql" > "$D/mutfn.log" 2>&1; then
    printf '  %-46s ⇒ 🔴 突變版函式建不起來 ⇒ 本輪作廢\n' "⑮ 突變:函式偷插一列數量"; KEEP=1; FAIL=$((FAIL+1))
  else
    seed '00000000-0000-0000-0000-0000000000a8' refunded "'tappay'" NULL
    w "⑮ 突變:函式偷插一列數量 ⇒ 斷言必炸(改了 ${MB}B)" ERR '動到了品項數量' \
      "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000a8','$KEY2','staff_on','customer_request',NULL);"
    # 🛑🛑 **世界⑯ 與 ⑱ 在 2026-09-02 變成【構造上不可達】, 而理由要留著**:
    #    它們都要求「呼叫之前該單就已經有 order_cancellation_items」——
    #    而**第四道閘(R3 F1;主視窗判甲)現在把那種單擋在門外** ⇒ 走不到斷言那一行。
    #    ⇒ 兩發突變原本演的是:⑯ 改寫既有一列的數量(列數不變)· ⑱ 取消量搬到同單另一個品項。
    # 🔴 **而這是【甲】的一個代價, 要明寫**:斷言的可觸及攻擊面變窄了 ——
    #    進門時必然 0 列 ⇒ 「改寫既有列」這一族只能發生在【我這一發交易中途先插再改】,
    #    而那一種**列數會變** ⇒ 世界⑮ 就抓得到。
    # ✅ **而摘要仍然比單純數列數強, 證據是世界⑰**:改 `order_items.quantity`
    #    **一個 count 都不會變** ⇒ 只有把 `oi.quantity` 放進摘要才看得見。
    # 📌 ⇒ **刪掉一個測試時, 要留下「它為什麼不再需要」, 而不是只留下它消失了。**

    # 🔴 R2 must-fix:上面兩發只演「新增一列」與「改寫既有一列的數量」。
    #    而 R2 指出兩種摘要看不到的動法:①改 order_items.quantity ②把取消量【搬到同單另一個品項】。
    #    ⇒ 這兩格演那兩種。分母因此從 order_cancellation_items 改成 order_items LEFT JOIN。
    mutfn "
CREATE OR REPLACE FUNCTION public.zz_mutant(p_order_id uuid) RETURNS void LANGUAGE plpgsql AS \$z\$
BEGIN
  UPDATE public.order_items oi SET quantity = oi.quantity + 1 WHERE oi.order_id = p_order_id;
END \$z\$;"
    seed '00000000-0000-0000-0000-0000000000ac' refunded "'tappay'" NULL
    w "⑰ 突變:改 order_items.quantity ⇒ 斷言必炸" ERR '動到了品項數量' \
      "SELECT public.admin_mark_order_cancelled('00000000-0000-0000-0000-0000000000ac','$KEY2','staff_on','customer_request',NULL);"

    # 還原:把原版函式裝回去, 免得後面的世界拿突變版去量。
    awk '/^CREATE FUNCTION public\.admin_mark_order_cancelled\(/,/^\$fn\$;$/' "$M" \
      | sed '1s/^CREATE FUNCTION/CREATE OR REPLACE FUNCTION/' > "$D/origfn.sql"
    # 🔴 R3 nit:awk 錨若漂移會產出**空檔**, 而 `psql -f 空檔` 回 **rc=0** ⇒ 印「還原成功」而突變版仍在庫裡。
    #    ⇒ 先驗它非空(今天後面沒有世界所以無害, 而片③/④ 續寫就會咬人)。
    if [ ! -s "$D/origfn.sql" ]; then
      echo "  🔴 抽不到原版函式(空檔)⇒ 還原沒有發生 ⇒ 之後的量測作廢"; KEEP=1; FAIL=$((FAIL+1))
    else
      q -q -f "$D/origfn.sql" > /dev/null 2>&1 || { echo "  🔴 還原不回原版函式 ⇒ 之後的量測作廢"; KEEP=1; FAIL=$((FAIL+1)); }
    fi
  fi
fi

echo "────────────────────────────────────────────────────────────"
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
printf '🛑 射程:本機拋棄式庫。admin_audit_log 與 staff 的 DDL【原樣抽自真 migration】;\n'
printf '   而 orders / order_items / order_cancellation_items 仍是【最小手寫版】——\n'
printf '   ⇒ 那三張的欄型別是【人核】不是機械核, 這一格仍是本檔最可能出錯的地方。\n'
printf '🛑 它【不驗】RLS / outbox / 任何 TS —— 信在片④, 各自帶自己的測試。\n'
[ "$FAIL" = 0 ] || exit 1
