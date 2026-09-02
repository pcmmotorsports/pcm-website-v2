#!/usr/bin/env bash
# email-outbox-unpaid-cancelled-verify.sh
#   在【拋棄式 PG】上驗 `20260903040000_m4b_outbox_order_unpaid_cancelled_event.sql` 的**行為**。
#
# 🔴 為什麼要有它:那支 migration 自己的閘驗的是【定義】(CHECK 的字面、validated、COMMENT 的字面)。
#    **一個 CHECK 的字面對了,與它擋不擋得住東西、放不放得進去,是兩個宣稱。**
#
# 🔵 **本檔【不重複】兄弟檔 `email-outbox-order-cancelled-verify.sh` 已經蓋掉的世界**
#    (恆真 CHECK / 約束不見 / NOT VALID / 別名 CHECK / whole-row / FK —— 那六個世界打的是
#     **同一組前置閘的形狀**,而我這支抄的就是它)。⇒ 本檔只驗**我這一支獨有**的四格。
#    🛑 **而「不重複」是一個選擇,不是「已經驗過了」** —— 兄弟檔驗的是它自己那支 migration。
#
# 🔴 **本檔最重要的一格是世界③** —— 我這支的前置閘③(「三個舊值都要在」)。
#    少了它,一支現況只有兩值的庫跑我這支 ⇒ 我的 `IN(...)` 會**把第三個值悄悄加回去或刪掉**,
#    而**四道定義層閘全綠**(它們只問「我列的那四個在不在」,不問「我有沒有動到別的」)。
#
# 用法:bash scripts/email-outbox-unpaid-cancelled-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL / 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M_PREV="$REPO/supabase/migrations/20260902120000_m4b_outbox_order_cancelled_event.sql"
M="$REPO/supabase/migrations/20260903040000_m4b_outbox_order_unpaid_cancelled_event.sql"
MIG_TABLE="$REPO/supabase/migrations/20260717020000_m4a_email_outbox.sql"

D=$(mktemp -d "${TMPDIR:-/tmp}/eouc.XXXXXXXX") || { echo "🔴 建不出暫存目錄 ⇒ exit 9"; exit 9; }
PG=54374   # 🔴 與兄弟檔的 54373 錯開 ⇒ 兩支可以同時跑而不互相殺
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT

for f in "$M" "$M_PREV" "$MIG_TABLE"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

# 🔴 建表 DDL 原樣抽出,不手抄(手抄的兩份一起抄錯時 harness 全綠,而正式的世界會炸)
sed -n '/^CREATE TABLE public\.email_outbox (/,/^);/p' "$MIG_TABLE" > "$D/ddl.sql"
DDL_BYTES=$(wc -c < "$D/ddl.sql" | tr -d ' ')
grep -q 'email_outbox_event_type_check' "$D/ddl.sql" && [ "$DDL_BYTES" -gt 800 ] \
  || { printf '🔴 抽不到建表 DDL(%s bytes)⇒ ENV-FAIL\n' "$DDL_BYTES"; KEEP=1; exit 2; }
printf '✅ 建表 DDL 從 20260717020000 原樣抽出 %s bytes(不是手抄)\n' "$DDL_BYTES"

export LC_ALL=C LANG=C   # 🔴 少了它 PG 17 在 macOS 起不來(postmaster became multithreaded)
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" -w start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL(log: $D/pg.log)"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0
ok(){ printf '  %-46s ⇒ ✅ %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad(){ printf '  %-46s ⇒ 🔴 %s\n' "$1" "$2"; FAIL=$((FAIL+1)); KEEP=1; }

# base:乾淨的表 + 一張訂單。**每個世界都從這裡重來**(否則上一個世界的殘留會當成這個世界的前提)
base(){
  { printf 'DROP TABLE IF EXISTS public.email_outbox;\n'
    printf 'DROP TABLE IF EXISTS public.orders;\n'
    printf 'CREATE TABLE public.orders (id uuid primary key default gen_random_uuid());\n'
    cat "$D/ddl.sql"
    printf 'INSERT INTO public.orders DEFAULT VALUES;\n'
  } > "$D/base.sql"
  q -q -f "$D/base.sql" >"$D/base.log" 2>&1
  # 🔴 fixture 的 rc 要看 —— 建不起來時,下一格會拿【舊表】去量而照樣印綠(兄弟檔記過這一格)
  [ $? -eq 0 ] || { bad "fixture" "base 建不起來(log: $D/base.log)"; return 1; }
}

# 探針:寫一列 <值>,**然後回頭讀它** —— INSERT 沒拋錯 ≠ 那一列在表裡
probe(){ # $1 = event_type 值
  cat > "$D/probe.sql" <<PSQL
INSERT INTO public.email_outbox (order_id, event_type, dedup_key, recipient_email, subject, payload)
SELECT o.id, '$1', '_pcm_probe_$1', 'probe@example.invalid', '_pcm_probe', '{}'::jsonb
  FROM public.orders o ORDER BY o.id LIMIT 1;
SELECT count(*) FROM public.email_outbox WHERE dedup_key = '_pcm_probe_$1';
PSQL
  q -tA -f "$D/probe.sql" 2>"$D/probe.err" | tail -1
}

echo "── 本支獨有的四個世界 ──────────────────────────────────"

# ① 正常世界:前一支 + 我這支都跑得過, 而第四值寫得進去, 且**前三值仍然寫得進去**
base || true
if q -q -f "$M_PREV" >"$D/w1a.log" 2>&1 && q -q -f "$M" >"$D/w1b.log" 2>&1; then
  n4=$(probe order_unpaid_cancelled)
  n1=$(probe order_created); n2=$(probe order_shipped); n3=$(probe order_cancelled)
  if [ "$n4" = "1" ] && [ "$n1" = "1" ] && [ "$n2" = "1" ] && [ "$n3" = "1" ]; then
    ok "① 正常:四個值【都】寫得進去" "四格皆 1 列"
  else
    bad "① 正常:四個值都要寫得進去" "created=$n1 shipped=$n2 cancelled=$n3 unpaid=$n4"
  fi
else
  bad "① 正常:兩支 migration 都要過" "見 $D/w1a.log / $D/w1b.log"
fi

# ② forward-only:我這支跑第二次要被前置閘② 擋
if q -q -f "$M" >"$D/w2.log" 2>&1; then
  bad "② forward-only:重跑要紅" "它居然過了"
else
  grep -q '前置閘②' "$D/w2.log" && ok "② forward-only:重跑" "被前置閘② 擋" \
    || bad "② forward-only:重跑" "紅了但不是前置閘②(見 $D/w2.log)"
fi

# ③ 🔴 本支最重要的一格:現況只有兩值(沒跑前一支)⇒ 前置閘③ 必須擋
#    少了這道閘, 我的 IN(...) 會【悄悄把 order_cancelled 加進去】而四道定義層閘全綠。
base || true
if q -q -f "$M" >"$D/w3.log" 2>&1; then
  bad "③ 現況兩值(缺 order_cancelled)" "它居然過了 ⇒ 會悄悄改寫白名單"
else
  grep -q '前置閘③' "$D/w3.log" && ok "③ 現況兩值 ⇒ 拒跑" "被前置閘③ 擋" \
    || bad "③ 現況兩值 ⇒ 拒跑" "紅了但不是前置閘③(見 $D/w3.log)"
fi

# ④ 🔵 負對照:沒跑我這支時, 第四值【必須】被舊 CHECK 拒 —— 否則 ① 的綠沒有判別力
base || true
q -q -f "$M_PREV" >"$D/w4a.log" 2>&1
n=$(probe order_unpaid_cancelled)
if [ "$n" = "1" ]; then
  bad "④ 負對照:沒跑本支時第四值要被拒" "居然寫進去了 ⇒ ① 的綠沒有判別力"
else
  # 🔴 **量具訂正(2026-09-03,本檔第一版寫錯)**:psql 預設【不印 SQLSTATE】,只印訊息文字
  #    ⇒ 原本 grep '23514' 永遠不會命中, 而拒絕本身是對的 ⇒ **那是我的尺錯,不是行為錯**。
  #    改成問那句訊息裡指名的**那一條約束**(比 grep 'check constraint' 更窄, 別的約束不會冒充)。
  grep -q 'check constraint "email_outbox_event_type_check"' "$D/probe.err" \
    && ok "④ 負對照:第四值被舊 CHECK 拒" "違反 email_outbox_event_type_check" \
    || bad "④ 負對照:第四值被拒" "被拒了但不是那條 CHECK(見 $D/probe.err)"
fi

# ⑤ 🔴 事後閘⑤ 的正對照:把 COMMENT 裡的射程句拿掉, 那道閘必須紅
#    (證明事後閘⑤ 不是恆真 —— 它只是在問一個字串在不在)
base || true
q -q -f "$M_PREV" >"$D/w5a.log" 2>&1
# 🔴🔴 **突變只能改【被檢查的那一半】,不可以改【檢查的那一半】**(本檔第一版就是這樣錯的)。
#    原本 `sed s/.../g` 把 **事後閘⑤ 自己那行 `strpos(v_com, 'expire_unpaid_orders')`** 也改掉了
#    ⇒ 閘去找那個**被改過的**名字, 而 COMMENT 裡也是那個名字 ⇒ **它找到了 ⇒ 綠**。
#    📌 **突變把自己的偵測器一起改掉了 ⇒ 全綠是誠實的, 而它什麼都沒證明。**
#    ⇒ 修法:**跳過含 `strpos` 的行**(那是閘;COMMENT 那一行不含它)。
sed '/strpos/! s/expire_unpaid_orders/zz_removed_anchor/g' "$M" > "$D/mut.sql"
# 🔵 而突變【有沒有真的落在目標上】要當場驗 —— 不驗的話, 上面那個錯會再發生一次而看不出來
MUTN=$(grep -c 'zz_removed_anchor' "$D/mut.sql")
GATEN=$(grep -c "strpos(v_com, 'expire_unpaid_orders')" "$D/mut.sql")
[ "$MUTN" -ge 1 ] && [ "$GATEN" -eq 1 ] \
  || { bad "⑤ 突變自檢" "突變沒落在目標上(改了 $MUTN 處 / 閘還在 $GATEN 處)"; }
if q -q -f "$D/mut.sql" >"$D/w5.log" 2>&1; then
  bad "⑤ 正對照:射程句被拿掉要紅" "它居然過了 ⇒ 事後閘⑤ 恆真"
else
  grep -q '事後閘⑤' "$D/w5.log" && ok "⑤ 正對照:射程句被拿掉" "事後閘⑤ 紅了" \
    || bad "⑤ 正對照:射程句被拿掉" "紅了但不是事後閘⑤(見 $D/w5.log)"
fi

echo "────────────────────────────────────────────────────────"
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
echo "🛑 射程:本機拋棄式庫 ⇒ 證不出正式庫的行為(未知觸發器/RULE/殘留約束)。"
echo "🛑 本檔【不驗】enqueue / 模板 / 後台入口 —— 那三片各自帶自己的測試。"
echo "🔵 本檔刻意不重跑兄弟檔已蓋的六個世界(恆真/約束不見/NOT VALID/別名/whole-row/FK)。"
[ "$FAIL" -eq 0 ] || exit 1
