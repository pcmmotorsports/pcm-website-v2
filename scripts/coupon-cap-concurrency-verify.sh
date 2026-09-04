#!/usr/bin/env bash
# coupon-cap-concurrency-verify.sh · ⟦b4-COUPONCAP1⟧
#   在【拋棄式 PG】上驗券的三道上限在【兩個交易同時打】時擋不擋得住。
#
# ══════════════════════════════════════════════════════════════════════════════
# 🛑🛑 **在你拿這支的全綠去背書任何事之前 —— 先讀這兩格。**
#    (它們刻意放在檔案最前面。理由:**這支 harness 未來最可能的死法,
#     是有人拿它的全綠去背書一件它沒驗的事。**)
#
#  ① 🔴 **那支「這張單有沒有問題」的述詞在這裡是【替身】**(同簽章、恆回 NULL)。
#     ⇒ **本檔【完全不驗】那支述詞** ——
#       「一張其實已經有問題的單被放行」這一族, 在這裡**結構上不可能出現**。
#     ⇒ **不要因為本檔全綠, 就以為它被涵蓋了。**
#
#  ② 🔴 **兩個交易的交錯是用 `pg_sleep` 逼出來的 ⇒ 時序是【安排的】不是【自然發生的】。**
#     ⇒ 它答得出「**這個交錯下**會怎樣」, **答不出「真實負載下多久撞一次」**。
#     ⇒ **而讀的人會把前者讀成後者。**
#
#  ③ 🔴 **本檔只驗【券那一列】的鎖, 完全不驗【訂單那一列】的鎖**(code-reviewer 抓)。
#     `20260831160000:186` 還有**第二道 `FOR UPDATE`**(鎖 `orders` 那一列),
#     而它旁邊的註解自稱是「R3-must-fix」⇒ **有人判它承重**。
#     ⇒ 而本檔世界③ 用的是**兩張不同的單**(O1 / O2)⇒ 那把鎖在這裡**結構上不可能爭用**
#     ⇒ **它的綠對那道鎖零判別力。** 要驗它得另開一個世界(同一張單、兩個帳號),
#       而本檔**沒有做** —— 這是已知缺口, 不是漏寫。
# ══════════════════════════════════════════════════════════════════════════════
#
# 🔴 為什麼要有它:`docs/probes/coupon-redeem-rules-probe.sh`(360 行)**四發是序列的**
#    —— 實查:背景 `&` 0 次 · `wait` 0 · `PID=` 0 · `pg_sleep` 0 · 顯式 `BEGIN;` 0
#    ⇒ **從來沒有重疊過** ⇒ 那三道上限的並行行為**沒有人量過**。
#
# 🔵 而那一列的標題(「並行洞」)**不精確** —— 開檔查完之後的正確形狀是:
#    三道檢查全在 `SELECT … FOR UPDATE` 鎖券那一列**之後**, INSERT 在檢查之後,
#    而且函式開頭**已經有一道隔離等級閘**(不是 read committed 就 RAISE)。
#    ⇒ **它是一個看起來寫對了而沒有人證過的設計, 不是一個已知的洞。**
#    ⇒ 本檔要做的是【證它】或【推翻它】, 不是重寫一個已經在的東西。
#
# 🛑 **天花板 / 我證不到什麼**(先寫, 不要事後補):
#   · 本機拋棄式庫 ⇒ 證不出正式庫;而 `20260831160000` **不在 `supabase/APPLIED.tsv`**
#     ⇒ **正式庫根本還沒有這支函式** ⇒ 本檔驗的是【repo 裡這一版的設計】。
#   · fixture 的 `orders` / `customers` / `staff` 是最小版(只建 FK 目標與被讀到的欄)
#     ⇒ 「別的 NOT NULL 欄擋住寫入」那一族在這裡量不到。
#   · 不驗 `min_spend` 的算術 —— 它是純算術、**不讀 redemptions** ⇒ 與併發無關(另一支 probe 的事)。
#   · 🔴 **兩個交易的交錯是用 `pg_sleep` 逼出來的 ⇒ 時序是【安排的】不是【自然發生的】**
#     ⇒ 它答得出「這個交錯下會怎樣」, **答不出「真實負載下多久撞一次」**。
#
# 用法:bash scripts/coupon-cap-concurrency-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL / 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG_TABLES="$REPO/supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql"
MIG_RPC="$REPO/supabase/migrations/20260831160000_m4b_coupon_p2_redeem_rpc.sql"

D=$(mktemp -d "${TMPDIR:-/tmp}/ccc.XXXXXXXX") || { echo "🔴 建不出暫存目錄 ⇒ exit 9"; exit 9; }
# 🔴 **port 不寫死** —— 七窗共用一台機器, 別窗的拋棄式 PG 會佔住同一個號碼。
#    (2026-09-02 實際撞到:`could not bind IPv4 address "127.0.0.1": Address already in use`
#     ⇒ 而它的外觀是 `pg_ctl ⇒ ENV-FAIL`, 讀起來像「這台機器不能跑 PG」。)
#    ⇒ 從 54375 起往上找第一個沒人聽的號碼;找不到就明說是【環境】不是【碼】。
PG=""
for p in $(seq 54375 54399); do
  if ! (command -v lsof >/dev/null && lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1); then PG="$p"; break; fi
done
[ -n "$PG" ] || {
  # 🔴 訊息要把人指到【對的地方】—— 見下面 pg_ctl 那一段的完整理由。
  printf '%s\n' "🔴 54375-54399 這個範圍現在找不到空的 port。"
  printf '%s\n' "   判別:是不是有別的視窗在跑拋棄式 PG?(七窗共用一台機器)"
  printf '%s\n' "     是   ⇒ 環境, 不是這支腳本 ⇒ 等它收攤再重跑"
  printf '%s\n' "     不是 ⇒ 那才要查這台機器"
  KEEP=1; exit 2; }
printf '🔵 本發用 port %s(七窗共用機器 ⇒ 號碼是找出來的, 不是寫死的)\n' "$PG"
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
for f in "$MIG_TABLES" "$MIG_RPC"; do
  [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }
done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

export LC_ALL=C LANG=C
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 \
  || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k $D" -l "$D/pg.log" -w start >/dev/null 2>&1 \
  || {
    # 🔴🔴 **真正該修的是【外觀】, 不是 port**(2026-09-02 `-f3` 指出, 我認):
    #    改 port 只讓【我】不撞;**改訊息才讓下一個撞到的人不去查錯的東西。**
    #    第一版這裡只印 `pg_ctl ENV-FAIL` ⇒ **讀起來像「這台機器不能跑 PG」**
    #    ⇒ 下一個人會去查自己的環境, 而答案是「隔壁窗正在跑」。
    printf '%s\n' "🔴 pg_ctl 起不來。下面那幾行是 PG 自己講的, 先讀它:"
    grep -E 'Address already in use|FATAL|could not' "$D/pg.log" 2>/dev/null | tail -3
    printf '%s\n' "   判別:上面有沒有 Address already in use?"
    printf '%s\n' "     有   ⇒ 環境(別的視窗佔住 port $PG)⇒ 重跑一次, 不要查這支腳本"
    printf '%s\n' "     沒有 ⇒ 那才可能是真的 PG 環境問題(版本 / locale / 權限)"
    printf '%s\n' "   完整 log: $D/pg.log"
    KEEP=1; exit 2; }
q(){ psql -h "$D" -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

# 🔴 兩張券表的 DDL **原樣抽出**, 不手抄(2026-09-02 片② 的教訓:手寫 fixture 會把型別不合蓋住)
sed -n '/^CREATE TABLE public\.coupons (/,/^);/p'             "$MIG_TABLES" > "$D/coupons.sql"
sed -n '/^CREATE TABLE public\.coupon_redemptions (/,/^);/p'  "$MIG_TABLES" > "$D/redemptions.sql"
CB=$(wc -c < "$D/coupons.sql" | tr -d ' '); RB=$(wc -c < "$D/redemptions.sql" | tr -d ' ')
grep -q 'max_redemptions' "$D/coupons.sql" && [ "$CB" -gt 800 ] \
  || { printf '🔴 抽不到 coupons DDL(%s bytes)⇒ ENV-FAIL\n' "$CB"; KEEP=1; exit 2; }
grep -q 'reverted_at' "$D/redemptions.sql" && [ "$RB" -gt 500 ] \
  || { printf '🔴 抽不到 coupon_redemptions DDL(%s bytes)⇒ ENV-FAIL\n' "$RB"; KEEP=1; exit 2; }
printf '✅ coupons(%sB)與 coupon_redemptions(%sB)DDL 原樣抽自真 migration\n' "$CB" "$RB"

# 最小 FK 目標(**手寫, 而它們只是 FK 的靶子**;真表的其餘欄本檔量不到 —— 已寫進天花板)
cat > "$D/base.sql" <<'PSQL'
-- Supabase 的三個角色在拋棄式庫裡不存在 ⇒ RPC 檔尾的 GRANT 會 ERROR「role does not exist」。
-- (2026-09-02 實跑撞到:redeem RPC 停在 `role "anon" does not exist`。)
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','partiallyPaid','refunded','partiallyRefunded');
CREATE TABLE public.customers (user_id uuid PRIMARY KEY);
CREATE TABLE public.staff (id text PRIMARY KEY);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  customer_user_id uuid REFERENCES public.customers(user_id),
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  cancelled_at timestamptz);
PSQL
q -q -f "$D/base.sql"      > "$D/b1.log" 2>&1 || { echo "🔴 base 建不起來"; tail -3 "$D/b1.log"; KEEP=1; exit 1; }
q -q -f "$D/coupons.sql"   > "$D/b2.log" 2>&1 || { echo "🔴 coupons 建不起來"; tail -3 "$D/b2.log"; KEEP=1; exit 1; }
q -q -f "$D/redemptions.sql" > "$D/b3.log" 2>&1 || { echo "🔴 redemptions 建不起來"; tail -3 "$D/b3.log"; KEEP=1; exit 1; }
# 🛑🛑 **`coupon_redeem_order_problem` 這裡用【替身】, 而那是本檔最大的一個射程缺口。**
#    成因是量到的:真的那一支(`20260831155000`)讀 **10 個關聯(8 表 + 2 view)**
#    ⛔ ~~原本寫「10 張表 + 2 個 view」(= 12)~~ **作廢**(code-reviewer 抓, 我自己重量複核):
#       對函式體 `grep -oE 'public\.[a-z_]+'` ⇒ distinct **11**, 扣掉自檢用的假名 `zzq_no_such_fn_`
#       ⇒ **10**。而**原本括號裡只列 9 個, 漏了 `orders`** —— 那是它讀得最多的一張。
#    逐一列出(不要再省):orders / order_cancellations / order_manual_refunds /
#      order_payments / order_refunds / payment_charge_attempts /
#      payment_double_charge_anomalies / payment_refunds
#      + 兩個 view:order_refund_effective_verdict / payment_refund_effective_terminal
#    ⇒ 要在拋棄式庫裡建齊它們, 等於再寫一份【幾百行的手寫 fixture】——
#      而 2026-09-02 片② 剛剛證明手寫 fixture 會安靜地製造出不存在的世界。
#    ⇒ **本檔要驗的是【三道上限 + FOR UPDATE 的並行行為】, 不是那支述詞。**
#      ⇒ 用一個同簽章、恆回 NULL(= 這張單沒問題)的替身讓流程走得到三道上限。
# 🔴 **代價明寫**:本檔**完全不驗**那支述詞 ——
#    「一張其實已經有問題的單被放行」這一族, 在這裡**結構上不可能出現**。
#    ⇒ 那一格要另開一片(或由那支自己的 probe 驗), **不要因為本檔全綠就以為它被涵蓋了。**
if q -q -c "CREATE FUNCTION public.coupon_redeem_order_problem(p_order_id uuid)
            RETURNS text LANGUAGE sql STABLE AS \$stub\$ SELECT NULL::text \$stub\$;" > "$D/b4.log" 2>&1; then
  printf '%s\n' "WARN coupon_redeem_order_problem 用【替身】(恆回 NULL)-- 本檔不驗那支述詞, 見檔頭天花板"
else
  echo "RED 述詞替身建不起來"; tail -5 "$D/b4.log"; KEEP=1; exit 1
fi
q -q -f "$MIG_RPC"         > "$D/b5.log" 2>&1 || { echo "🔴 redeem RPC 跑不起來"; tail -5 "$D/b5.log"; KEEP=1; exit 1; }
echo "OK redeem RPC 原檔跑進拋棄式庫(述詞是替身)"

# 🔴 欄位集合比對:期望值從真 migration **獨立解析**(不是拿抽出來的那份比 —— 那會是同一把尺量兩次)
ddl_cols(){ python3 - "$1" "$2" <<'PYC'
import io, re, sys
src, tbl = sys.argv[1], sys.argv[2]
lines = io.open(src, encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('CREATE TABLE public.%s (' % tbl))
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith(');'))
out = []
for l in lines[start + 1:end]:
    l = re.sub(r'--.*$', '', l)
    m = re.match(r'^\s+([a-z_][a-z0-9_]*)\s+\S', l)
    if m and m.group(1).upper() not in ('CONSTRAINT','PRIMARY','UNIQUE','FOREIGN','CHECK'):
        out.append(m.group(1))
print('\n'.join(sorted(set(out))))
PYC
}
for t in coupons coupon_redemptions; do
  ddl_cols "$MIG_TABLES" "$t" > "$D/$t.a"
  q -tAc "SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='$t' ORDER BY 1;" | sort -u > "$D/$t.b"
  n=$(wc -l < "$D/$t.a" | tr -d ' ')
  [ "$n" -ge 5 ] || { printf '  🔴 %s:只解析出 %s 個欄名 ⇒ 解析器壞了 ⇒ ENV-FAIL\n' "$t" "$n"; KEEP=1; exit 2; }
  if diff -q "$D/$t.a" "$D/$t.b" > /dev/null; then
    printf '  ✅ %s 欄位集合一致(%s 欄)—— 真 migration 獨立解析 vs 庫裡\n' "$t" "$n"
  else
    printf '  🔴 %s 欄位不一致 ⇒ 抽到殘段 ⇒ 作廢\n' "$t"; diff "$D/$t.a" "$D/$t.b" | head -6; KEEP=1; exit 1
  fi
done

U1='11111111-0000-0000-0000-000000000001'
U2='11111111-0000-0000-0000-000000000002'
O1='22222222-0000-0000-0000-000000000001'
O2='22222222-0000-0000-0000-000000000002'
O3='22222222-0000-0000-0000-000000000003'

reset(){ # $1=max_redemptions(NULL 或數字) $2=max_per_account
  q -q -c "TRUNCATE public.coupon_redemptions;
           DELETE FROM public.orders; DELETE FROM public.customers; DELETE FROM public.coupons;
           INSERT INTO public.customers VALUES ('$U1'),('$U2');
           INSERT INTO public.staff VALUES ('staff_seed') ON CONFLICT DO NOTHING;
           INSERT INTO public.orders (id,customer_user_id,payment_status) VALUES
             ('$O1','$U1','paid'),('$O2','$U2','paid'),('$O3','$U1','paid');
           INSERT INTO public.coupons (code, discount_type, discount_value, min_spend,
                                       max_redemptions, max_per_account, ends_on, stacks_with_tier,
                                       is_active, created_by)
           VALUES ('CAP1','fixed',100,1,$1,$2, (now() + interval '1 day')::date, true, true, 'staff_seed');
          " > "$D/reset.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ] || grep -q ERROR "$D/reset.log"; then
    printf '  🔴 種不進 fixture(rc=%s)⇒ 本輪作廢\n' "$rc"; head -3 "$D/reset.log"; KEEP=1; FAIL=$((FAIL+1)); return 1
  fi
}
redeem(){ q -tAc "SELECT public.redeem_coupon('CAP1','$1',1000,false,'$2');" 2>&1; }
chk(){ # $1=名 $2=期望片段 $3=實得
  if printf '%s' "$3" | grep -q "$2"; then printf '  %-48s ⇒ ✅ %s\n' "$1" "$(printf '%s' "$3" | head -c 60)"; PASS=$((PASS+1))
  else printf '  %-48s ⇒ 🔴 要「%s」而實得:%s\n' "$1" "$2" "$(printf '%s' "$3" | head -c 90)"; KEEP=1; FAIL=$((FAIL+1)); fi
}

echo "── ① 序列 · max_redemptions=1 · 打 2 次 ⇒ 期望 min(2,1)=1 次成功 ──"
reset 1 NULL && { chk "①a 第 1 次(v_used=0 < 1)"      '"valid": true'  "$(redeem "$U1" "$O1")"
                  chk "①b 第 2 次(v_used=1 >= 1)"     'exhausted'      "$(redeem "$U2" "$O2")"; }

echo "── ② 序列 · max_per_account=1 · 同一帳號打 2 次 ⇒ 期望 min(2,1)=1 ──"
reset NULL 1 && { chk "②a 第 1 次"                      '"valid": true'  "$(redeem "$U1" "$O1")"
                  chk "②b 同帳號第 2 次"                'already_used_by_account' "$(redeem "$U1" "$O3")"; }

# 🔴🔴 **code-reviewer must-fix:③ 本身對「兩交易真的重疊了嗎」零判別力。**
#    它原本沒有任何重疊量測 ⇒ **它的效度整個寄生在 ⑤**(拿掉 FOR UPDATE 會翻)。
#    ⇒ ⑤ 哪天被跳過或搬走, ③ 會**安靜退化成①的翻版**而仍然印 ✅。
#    ✅ 修法:量 B 的牆鐘時間。A 握鎖 2 秒(`pg_sleep(2)`)⇒ B 若真的等過, 它必須 >= 1 秒;
#      B 幾乎瞬間回來 ⇒ **它根本沒有撞上 A** ⇒ 那一發的綠不算數。
echo "── 🔴 ③ 並行 · max_redemptions=1 · 兩交易同時打 ⇒ 期望成功數 = 1 ──"
concurrent(){ # 回傳兩發的輸出, 以 '|' 串起
  reset 1 NULL || return 1
  # A:BEGIN → redeem → 睡 2 秒 → COMMIT(它握著 :209 那道 FOR UPDATE)
  ( q -tAc "BEGIN; SELECT public.redeem_coupon('CAP1','$U1',1000,false,'$O1'); SELECT pg_sleep(2); COMMIT;" ) > "$D/A.out" 2>&1 &
  local pidA=$!
  # 🔴 讓 A 先拿到鎖。這是【安排的時序】, 不是自然發生的 —— 已寫進天花板。
  q -tAc "SELECT pg_sleep(0.7);" > /dev/null 2>&1
  T0=$(date +%s)
  ( q -tAc "BEGIN; SELECT public.redeem_coupon('CAP1','$U2',1000,false,'$O2'); COMMIT;" ) > "$D/B.out" 2>&1 &
  local pidB=$!
  wait "$pidA"; wait "$pidB"
  # 🔴 本函式被 `$( )` 呼叫 ⇒ 它跑在【子殼】⇒ 這裡設的變數**傳不回父殼**。
  #    (第一版就是這樣:③c 印 `B 只花 ? 秒` ⇒ 而那道閘拒絕印綠, 是對的。)
  #    ⇒ 寫進檔案, 由父殼讀回去。
  printf '%s' "$(( $(date +%s) - T0 ))" > "$D/b_sec"
  printf '%s|%s' "$(tr -d '\n' < "$D/A.out")" "$(tr -d '\n' < "$D/B.out")"
}
OUT=$(concurrent)
NOK=$(q -tAc "SELECT count(*) FROM public.coupon_redemptions WHERE reverted_at IS NULL;" | tr -d ' ')
chk "③a 兩發合起來只寫進 1 列(= min(2,1))" '^1$' "$NOK"
chk "③b 而其中一發拿到 exhausted"           'exhausted'     "$OUT"
# 🔵 ③c:證明 B 真的【等過】—— 少了它, ③a 的 1 也可能是「兩發根本沒重疊」
B_SEC=$(cat "$D/b_sec" 2>/dev/null || printf '')
if [ -n "$B_SEC" ] && [ "$B_SEC" -ge 1 ] 2>/dev/null; then
  printf '  %-48s ⇒ OK B 等了約 %s 秒(A 握鎖 2 秒)\n' "③c B 真的撞上 A 那道鎖" "$B_SEC"; PASS=$((PASS+1))
else
  printf '  %-48s ⇒ RED B 只花 %s 秒 ⇒ 兩發沒有重疊 ⇒ ③a 的綠不算數\n' "③c B 真的撞上 A 那道鎖" "${B_SEC:-讀不到}"
  KEEP=1; FAIL=$((FAIL+1))
fi

echo "── 🟢 ④ 隔離閘正對照:REPEATABLE READ 下必須 RAISE ──"
reset 1 NULL && chk "④ repeatable read ⇒ 拒" '隔離等級是' \
  "$(q -tAc "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT public.redeem_coupon('CAP1','$U1',1000,false,'$O1');" 2>&1)"

echo "── 🧬 ⑤ 突變:拿掉 :209 的 FOR UPDATE ⇒ ③a 必須由 1 翻成 2 ──"
python3 - "$MIG_RPC" "$D/mut.sql" <<'PYM'
import io, sys
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
a = "SELECT * INTO v_c FROM public.coupons WHERE code = v_code FOR UPDATE;"
assert s.count(a) == 1, s.count(a)
b = "SELECT * INTO v_c FROM public.coupons WHERE code = v_code;"
s = s.replace(a, b).replace("CREATE FUNCTION public.redeem_coupon(", "CREATE OR REPLACE FUNCTION public.redeem_coupon(")
io.open(dst, 'w', encoding='utf-8').write(s)
print("MUT_DELTA_BYTES=%d" % (len(b) - len(a)))
PYM
MUTRC=$?
if [ $MUTRC -ne 0 ]; then
  echo "  🔴 突變產不出來(rc=$MUTRC)⇒ 這一格證不了任何事"; KEEP=1; FAIL=$((FAIL+1))
elif [ ! -s "$D/mut.sql" ]; then
  echo "  🔴 突變檔是空的 ⇒ 作廢"; KEEP=1; FAIL=$((FAIL+1))
else
  if q -q -f "$D/mut.sql" > "$D/mut.log" 2>&1; then
    concurrent > /dev/null
    NOK2=$(q -tAc "SELECT count(*) FROM public.coupon_redemptions WHERE reverted_at IS NULL;" | tr -d ' ')
    if [ "$NOK2" = "2" ]; then
      printf '  %-48s ⇒ ✅ 由 1 翻成 2 ⇒ 那道鎖【承重】\n' "⑤ 拿掉 FOR UPDATE"; PASS=$((PASS+1))
    else
      printf '  %-48s ⇒ 🔴 仍然是 %s ⇒ **我的 harness 到不了那個世界**(不是「洞不存在」)\n' "⑤ 拿掉 FOR UPDATE" "$NOK2"
      KEEP=1; FAIL=$((FAIL+1))
    fi
    # 🔴 還原不能直接跑原檔 —— 它是 `CREATE FUNCTION`(不是 OR REPLACE), 而函式已經在庫裡
    #    ⇒ 原檔會炸 `already exists`。(第一版就是這樣紅的。)
    #    ⇒ 產一份「只把動詞換成 CREATE OR REPLACE」的還原版, 其餘一字不改。
    sed '1,$s/^CREATE FUNCTION public\.redeem_coupon(/CREATE OR REPLACE FUNCTION public.redeem_coupon(/' \
      "$MIG_RPC" > "$D/orig.sql"
    if [ ! -s "$D/orig.sql" ]; then
      echo "  🔴 還原檔是空的 ⇒ 突變版還留在庫裡"; KEEP=1; FAIL=$((FAIL+1))
    elif q -q -f "$D/orig.sql" > "$D/orig.log" 2>&1; then
      # 🔵 而「跑得起來」不等於「換回去了」⇒ 回頭讀定義, 確認 FOR UPDATE 真的回來了
      BACK=$(q -tAc "SELECT CASE WHEN pg_get_functiondef(p.oid) LIKE '%WHERE code = v_code FOR UPDATE%'
                                 THEN 'yes' ELSE 'no' END
                       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='redeem_coupon';" | tr -d ' ')
      if [ "$BACK" = "yes" ]; then
        printf '  %-48s ⇒ ✅ FOR UPDATE 回來了(回頭讀 pg_get_functiondef 確認)\n' "⑤b 還原"
        PASS=$((PASS+1))
      else
        printf '  %-48s ⇒ 🔴 跑得起來而定義裡沒有 FOR UPDATE(實得 %s)⇒ 突變版還在庫裡\n' "⑤b 還原" "$BACK"
        KEEP=1; FAIL=$((FAIL+1))
      fi
    else
      echo "  🔴 還原不回原版 RPC"; tail -3 "$D/orig.log"; KEEP=1; FAIL=$((FAIL+1))
    fi
  else
    echo "  🔴 突變版 RPC 建不起來 ⇒ 作廢"; tail -3 "$D/mut.log"; KEEP=1; FAIL=$((FAIL+1))
  fi
fi

echo "────────────────────────────────────────────────────────────"
# 🔴🔴 **code-reviewer must-fix:沒有【總數】斷言 ⇒ 整塊被短路或註解掉時,**
#    **它會印 `PASS=7 FAIL=0 rc=0` 全綠。** 那正是鐵則 11 的「我餵幾條 vs 它跑幾支」。
#    ⇒ 釘死應有的格數。**改動格數時這一行要一起改, 而那就是它的用途。**
EXPECT_TOTAL=10
TOTAL=$(( PASS + FAIL ))
if [ "$TOTAL" -ne "$EXPECT_TOTAL" ]; then
  printf 'RED 格數不對:跑了 %s 格, 而本檔應有 %s 格 ⇒ 有一塊沒跑到(而它不會自己紅)\n' "$TOTAL" "$EXPECT_TOTAL"
  KEEP=1; FAIL=$((FAIL+1)); TOTAL=$(( PASS + FAIL ))
fi
printf '結果:PASS=%s FAIL=%s(共 %s 格, 應有 %s)\n' "$PASS" "$FAIL" "$TOTAL" "$EXPECT_TOTAL"
printf '🛑 射程:拋棄式庫。而 20260831160000 **帳本 APPLIED.tsv 未記**\n'
printf '   ⛔ ~~⇒ 正式庫還沒有這支函式~~ ⇒ 那是【無效推論】(2026-09-05 訂正):\n'
printf '   帳本答的是「有沒有人【記】」, 不是「東西在不在」—— 實測有整支跑過正式庫而帳本零紀錄的。\n'
printf '   ✅ 要確定:bash scripts/is-migration-applied.sh 20260831160000\n'
printf '🛑 兩交易的交錯是 pg_sleep 逼出來的 ⇒ 答得出「這個交錯下會怎樣」, 答不出「真實負載下多久撞一次」。\n'
printf '🛑 不驗 min_spend(純算術、不讀 redemptions ⇒ 與併發無關)。\n'
[ "$FAIL" = 0 ] || exit 1
