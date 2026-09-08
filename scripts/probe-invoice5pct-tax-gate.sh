#!/usr/bin/env bash
# ⟦b4-INVOICE5PCT⟧ · 拋棄式 PG 鑽機:**沒勾開發票, 到底加不加那 5%**
#
# 🔴 它在答哪一個問句:
#   A「函式體裡有沒有那道 IF」   ⇒ migration 自己的事後斷言就答得了, 不需要 PG
#   B「**兩個世界各自算出什麼**」⇒ 🔴 本檔在答這一個。而 A 對 B **零判別力** ——
#      把兩個分支對調、把判準換成 `NOT v_invoice_requested`,那些字面全都還在。
#   C「我算的那個 `md5(prosrc)` 是不是 Postgres 真的會算出來的那個」⇒ 🔴 本檔**順便**答了:
#      世界 0 把第 6 代真的建進一台真 PG,再問它 `md5(prosrc)`。
#      📌 那一格是產生器**在本機無論如何都驗不到**的一格。
#
# ⚠️ 射程(照實寫, 不放寬):
#   · 表全部是**替身**(沿用 `scripts/spec1-fixture.sql` 再補三欄)⇒ 本檔不驗真表的約束。
#   · 本機 PG 不是正式庫 ⇒ **「這裡跑得過」≠「正式庫 apply 會成功」**。apply 是 Sean 的手。
#   · 🔴 它**不驗** `orders_total_balances` —— 替身表上沒有那道 CHECK。
#     ⇒ 「total 的等式對不對」本檔是**自己算一次去比**, 不是讓 DB 擋。
#
# 🔴 收尾一定印【為什麼結束】,不只印「結束了」——
#   一個等到了的迴圈與一個放棄了的迴圈,預設長得一模一樣。
set -u
export LC_ALL=C LANG=C

# ── --selftest:不起 PG 的便宜自檢(pre-commit 用)─────────────────────────
#   🔴 它答兩個問題, 而兩個都是【這支鑽機自己會壞掉】的方式:
#     ① 突變的錨還在不在 —— 錨對不上時突變【不會套用】而 rc 照樣 0 ⇒ 那一發變成裝飾。
#     ② EXPECT 那張清單與實際 ok/bad 的格名對不對得起來 ——
#        加了一格而忘了寫進 EXPECT ⇒ 它不會被算進「從來沒跑到的格子」⇒ 漏掉也不會叫。
#   🛑 **它不驗行為** —— 行為要真的起一台 PG, 那不是 pre-commit 該做的事。
if [ "${1:-}" = '--selftest' ]; then
  SELF="$(cd "$(dirname "$0")/.." && pwd)"
  MIG="$SELF/supabase/migrations/20260909030000_m4b_invoice5pct_tax_only_when_requested.sql"
  RC=0
  test -f "$MIG" || { printf '🔴 找不到 migration:%s\n' "$MIG"; exit 1; }
  # ① 三個突變錨各自在 migration 裡恰好一次
  #   🔴 **M1 的錨是【兩行】的, 不是那一句 `IF`** —— 那一句在檔裡出現兩次:
  #      一次在函式體、一次在事後斷言②a 的 LIKE 樣式裡。
  #      📌 我第一版的自檢就是拿單行去數而報了紅 —— **而那個紅是【自檢自己錯】, 不是檔錯。**
  #      ⇒ 這正是本自檢要防的那件事的鏡像:錨不精確 ⇒ 突變落在錯的地方(或根本不落)。
  python3 - "$MIG" <<'PYEOF' || RC=1
import io, sys
mig = io.open(sys.argv[1], encoding='utf-8').read()
anchors = {
    'M1 判準':   '  IF v_invoice_requested THEN\n    v_tax := pg_catalog.round',
    'M3 稅率':   '* 0.05)::bigint;\n    v_price_tax_mode',
    'M6 id 陣列': '    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);',
}
rc = 0
for name, a in anchors.items():
    n = mig.count(a)
    print(('🟢' if n == 1 else '🔴') + f' 錨命中 {n} 次(期望 1):{name}')
    if n != 1:
        rc = 1
neg = mig.count('ZZQ_NEVER_AN_ANCHOR')
print(('⚪' if neg == 0 else '🔴') + f' 負對照 現造錨 ⇒ {neg}(期望 0, 證明上面那些 1 不是尺壞了)')
if neg != 0:
    rc = 1
sys.exit(rc)
PYEOF
  # ② EXPECT 的格名 ⊇ 實際會用到的格名
  DECLARED=$(grep -m1 "^EXPECT=" "$0" | sed "s/^EXPECT='//; s/'$//")
  USED=$(grep -oE '\b(ok|bad) [a-zA-Z0-9-]+' "$0" | awk '{print $2}' | sort -u)
  MISSING=''
  for u in $USED; do
    case " $DECLARED " in *" $u "*) ;; *) MISSING="$MISSING $u";; esac
  done
  if [ -z "$MISSING" ]; then printf '🟢 EXPECT 涵蓋所有用到的格名(%s 個)\n' "$(echo $USED | wc -w | tr -d ' ')"
  else printf '🔴 這些格名不在 EXPECT 裡 ⇒ 漏掉也不會叫:%s\n' "$MISSING"; RC=1; fi
  [ $RC -eq 0 ] && printf 'selftest PASS\n' || printf 'selftest FAIL\n'
  exit $RC
fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GEN6="$REPO/supabase/migrations/20260905360000_m4b_pricecopytax_p2_manual_order_computes_tax.sql"
NEW="$REPO/supabase/migrations/20260909030000_m4b_invoice5pct_tax_only_when_requested.sql"
D=/tmp/inv5pct-probe
PORT=5639
EXPECT='md5-gen6 apply worldA worldB worldC total-A total-B audit-taxed audit-untaxed audit-missing audit-reject audit-linekey audit-after-edit audit-empty audit-jsonnull mut-M1 mut-M2 mut-M3 mut-M4 mut-M5 mut-M6-ctl mut-M6 rerun'
PASS=''
FAIL=''

say() { printf '%s\n' "$*"; }
ok()  { PASS="$PASS $1"; say "🟢 PASS $1  $2"; }
bad() { FAIL="$FAIL $1"; say "🔴 FAIL $1  $2"; }
q()   { psql -h 127.0.0.1 -p $PORT -U postgres -d probe -At -c "$1" 2>&1; }

cleanup() {
  pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$D"
}
trap cleanup EXIT

# ── 起一台拋棄式 PG ──────────────────────────────────────────────────
rm -rf "$D"; mkdir -p "$D"
initdb -D "$D/data" -U postgres --no-locale -E UTF8 >"$D/initdb.log" 2>&1
if [ $? -ne 0 ]; then say "🛑 initdb 失敗, 看 $D/initdb.log"; exit 1; fi
pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" -w start >/dev/null 2>&1
if [ $? -ne 0 ]; then say "🛑 PG 起不來, 看 $D/pg.log"; exit 1; fi
psql -h 127.0.0.1 -p $PORT -U postgres -q -c 'create database probe' >/dev/null 2>&1
say "(跑的是 $(command -v psql) · $(psql --version))"

# ── 替身世界 = spec1 的 fixture + 第 6 代多要的三欄 ──────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -q -f "$REPO/scripts/spec1-fixture.sql" >"$D/fixture.log" 2>&1
if [ $? -ne 0 ]; then say "🛑 fixture 失敗, 看 $D/fixture.log"; exit 1; fi
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -q >"$D/alter.log" 2>&1 <<'SQL'
alter table public.orders add column invoice_requested boolean not null default true;
alter table public.orders add column notification_email text;
alter table public.orders add column price_tax_mode text not null default 'inclusive'
  constraint orders_price_tax_mode_domain check (price_tax_mode in ('inclusive','exclusive'));
SQL
if [ $? -ne 0 ]; then say "🛑 補欄失敗, 看 $D/alter.log"; exit 1; fi

# ── 世界 0:把【第 6 代】真的建進去, 並問這台 PG 它的 md5(prosrc) 是多少 ──
python3 - "$GEN6" >"$D/gen6.sql" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index('CREATE OR REPLACE FUNCTION public.admin_create_manual_order(')
k = s.index('\n$fn$;', i) + len('\n$fn$;')
sys.stdout.write(s[i:k] + '\n')
PY
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -q -f "$D/gen6.sql" >"$D/gen6.log" 2>&1
if [ $? -ne 0 ]; then say "🛑 第 6 代建不起來, 看 $D/gen6.log"; exit 1; fi
# 🔴 **每次重建函式都要重跑它** —— `DROP` + `CREATE` 之後 `proacl` 回到 NULL,
#    而 NULL 的意思是「PUBLIC 隱含有 EXECUTE」⇒ 斷言⑤ 會紅, **而它紅的是我沒重授權, 不是 migration 有問題**。
#    📌 那正是「同一個紅有兩個原因」的形狀 —— 分不開就會把工具的毛病讀成產品的缺陷。
regrant() {
  # ON_ERROR_STOP is load-bearing (codex R2 must-fix): without it psql returns 0 even when the
  # GRANT failed, and the next step then goes red on assertion 5 (ACL) -- recorded as a killed mutation.
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q >>"$D/prep.log" 2>&1 <<'SQL'
revoke all on function public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text) from public;
revoke all on function public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text) from anon, authenticated;
grant execute on function public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text) to service_role;
SQL
}
regrant
WANT_OLD=$(grep -o "IF v_md5 <> '[0-9a-f]\{32\}' THEN" "$NEW" | head -1 | grep -o "[0-9a-f]\{32\}")
GOT_OLD=$(q "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_create_manual_order'")
if [ "$GOT_OLD" = "$WANT_OLD" ]; then
  ok md5-gen6 "真 PG 算出的第 6 代 prosrc md5 = $GOT_OLD ⇒ 與 migration 前置閘②寫的相同"
else
  bad md5-gen6 "真 PG 算 $GOT_OLD, 而 migration 前置閘②期望 $WANT_OLD ⇒ 貼下去會被自己的閘擋住"
fi

# ── 貼新 migration(整支逐字, 含它自己的前置閘與事後斷言)──────────────
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$NEW" >"$D/apply.log" 2>&1
RC=$?
if [ $RC -eq 0 ]; then ok apply "整支跑完 rc=0(它自己的 3 道前置閘 + 5 道事後斷言都過了)"
else bad apply "rc=$RC —— $(tail -3 "$D/apply.log" | tr '\n' ' ')"; fi

# ── 三個世界 ────────────────────────────────────────────────────────
# 品項:1 件 × 1000;運費 100 ⇒ 稅基 1100 ⇒ 5% = 55
call() {  # $1 = requested 的 jsonb 片段 · $2 = mrid · $3 = 品項那一列額外的鍵(可空)
  local inv="$1" mrid="$2" extra="${3:-}"
  q "select public.admin_create_manual_order(
       '11111111-1111-1111-1111-111111111111'::uuid, '$mrid'::uuid,
       'probe', 'manual_phone', 'cash', 'home',
       '{\"name\":\"A\",\"phone\":\"0900000000\",\"line\":\"x\"}'::jsonb,
       '$inv'::jsonb, 100,
       '[{\"variant_id\":\"22222222-2222-2222-2222-222222222222\",\"sku\":\"PB-SKU-1\",\"title\":\"探針品項\",\"qty\":1,\"unit_price\":1000$extra}]'::jsonb,
       null)"
}

call_lines() {  # $1 = requested 片段 · $2 = mrid · $3 = 整包 lines 的 JSON
  q "select public.admin_create_manual_order(
       '11111111-1111-1111-1111-111111111111'::uuid, '$2'::uuid,
       'probe', 'manual_phone', 'cash', 'home',
       '{\"name\":\"A\",\"phone\":\"0900000000\",\"line\":\"x\"}'::jsonb,
       '$1'::jsonb, 100, '$3'::jsonb, null)"
}

# audit 裡那一列的稅基。**它就是「三個月後那個人要下的那道指令」** ——
# 🔴 而這正是 codex R2 教的那一課的鏡像:**存下來 ≠ 查得出來。**
#    所以這支鑽機問的不是「欄位裡有沒有值」, 是**照那道查詢真的撈一次**。
audit_basis() {  # $1 = mrid
  q "select coalesce(a.after -> 'line_tax_bases' -> 0 ->> 'tax_basis', 'NULL')
       from public.admin_audit_log a
      where a.action = 'order.manual_create' and a.request_id = '$1'"
}
R_A=$(call '{"type":"personal","requested":true}'  'aaaaaaaa-0000-4000-8000-000000000001')
R_B=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000002')
R_C=$(call '{"type":"personal"}'                   'aaaaaaaa-0000-4000-8000-000000000003')

row() { q "select tax_total||'|'||price_tax_mode||'|'||subtotal||'|'||shipping_fee||'|'||total
             from public.orders where manual_request_id='$1'::uuid"; }
A=$(row 'aaaaaaaa-0000-4000-8000-000000000001')
B=$(row 'aaaaaaaa-0000-4000-8000-000000000002')
C=$(row 'aaaaaaaa-0000-4000-8000-000000000003')
say "  世界A 勾了      ⇒ tax|mode|sub|ship|total = $A"
say "  世界B 沒勾      ⇒ tax|mode|sub|ship|total = $B"
say "  世界C 沒送那個鍵 ⇒ tax|mode|sub|ship|total = $C"

[ "$A" = '55|exclusive|1000|100|1155' ] \
  && ok worldA "勾了 ⇒ 稅 55、exclusive" \
  || bad worldA "期望 55|exclusive|1000|100|1155, 實得 $A  (回傳:$R_A)"
[ "$B" = '0|inclusive|1000|100|1100' ] \
  && ok worldB "沒勾 ⇒ **一毛都不加**、inclusive —— 這就是 Sean 09-04 講的那一句" \
  || bad worldB "期望 0|inclusive|1000|100|1100, 實得 $B  (回傳:$R_B)"
[ "$C" = '55|exclusive|1000|100|1155' ] \
  && ok worldC "沒送 requested ⇒ 沿用相容預設 true ⇒ 加稅(**刻意保留**, 不是漏掉)" \
  || bad worldC "期望 55|exclusive|1000|100|1155, 實得 $C  (回傳:$R_C)"

# 🔴 total 的等式自己再算一次 —— 替身表上沒有 orders_total_balances 那道 CHECK
[ "$(q "select (total = subtotal + shipping_fee - discount_total + tax_total) from public.orders where manual_request_id='aaaaaaaa-0000-4000-8000-000000000001'::uuid")" = 't' ] \
  && ok total-A "勾了那張:total = 小計 + 運費 − 折扣 + 稅" || bad total-A "等式不成立"
[ "$(q "select (total = subtotal + shipping_fee - discount_total) from public.orders where manual_request_id='aaaaaaaa-0000-4000-8000-000000000002'::uuid")" = 't' ] \
  && ok total-B "沒勾那張:total = 小計 + 運費(沒有稅那一項)" || bad total-B "等式不成立"

# ══ 稽核:員工選的「未稅 / 含稅」查得回來嗎(Sean 2026-09-09 拍甲加的那一件)═══
#   🔴 兩個世界要印**不同的值** —— 兩張單金額一模一樣(都沒勾、都不換算),
#      差別只在他選了什麼。**少了這兩格, 一個「永遠記 untaxed」的版本會全綠。**
R_T=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000011' ',"tax_basis":"taxed"')
R_U=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000012' ',"tax_basis":"untaxed"')
R_M=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000013' '')
A_T=$(audit_basis 'aaaaaaaa-0000-4000-8000-000000000011')
A_U=$(audit_basis 'aaaaaaaa-0000-4000-8000-000000000012')
A_M=$(audit_basis 'aaaaaaaa-0000-4000-8000-000000000013')
say "  稽核 選含稅 ⇒ [$A_T] · 選未稅 ⇒ [$A_U] · 沒送那個鍵 ⇒ [$A_M]"
[ "$A_T" = 'taxed' ] && ok audit-taxed "選【含稅】⇒ 稽核查得回 taxed" \
  || bad audit-taxed "期望 taxed, 實得 [$A_T](回傳:$R_T)"
[ "$A_U" = 'untaxed' ] && ok audit-untaxed "選【未稅】⇒ 稽核查得回 untaxed(與上一格印不同的值 ⇒ 這把尺會動)" \
  || bad audit-untaxed "期望 untaxed, 實得 [$A_U](回傳:$R_U)"
[ "$A_M" = 'NULL' ] && ok audit-missing "沒送那個鍵 ⇒ 記 null(部署窗:舊版表單不送它, **不報錯**)" \
  || bad audit-missing "期望 NULL, 實得 [$A_M](回傳:$R_M)"
# ⚪ 第三種值必須被拒 —— 「看不懂就當未稅」會讓一個壞掉的表單靜默送出沒有人宣告過的稅基
R_B=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000014' ',"tax_basis":"maybe"')
case "$R_B" in
  *'不是 untaxed / taxed'*) ok audit-reject "第三種值 [maybe] ⇒ 被指名擋下" ;;
  *) bad audit-reject "第三種值沒有被擋, 或訊息不是那一句:$R_B" ;;
esac

# ══ 對得回 `order_items` 那一列嗎(codex R4 ③ + R5 再打一次)══════════════════
#   🔴 R5 逐字打掉我第一版的 `line_key`:它把**可以被改的單價**當成身分的一部分
#      ⇒ 合法改價之後「原本 1,000 那把對不到任何列, 原本 1,200 那把同時命中兩列」。
#   🔴 而 R5 也打掉我第一版的**這一格測試**:它只讀 audit 自己寫的東西、
#      **完全沒有 join `order_items`** ⇒ 📌 audit 寫得漂亮而品項寫錯列, 它照樣綠。
#   ✅ 所以現在這一格【真的 join 過去】, 而且比的是**那一列的規格**。
TWO='[{"sku":"CUSTOM-1","title":"手工品","qty":1,"unit_price":1050,"spec":{"color":"紅"},"tax_basis":"taxed"},
      {"sku":"CUSTOM-1","title":"手工品","qty":1,"unit_price":1050,"spec":{"color":"藍"},"tax_basis":"untaxed"}]'
R_2=$(call_lines '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000021' "$TWO")
JOINED=$(q "select string_agg(
              (oi.product_snapshot -> 'spec' ->> 'color') || '=' || (x.value ->> 'tax_basis'),
              ' | ' order by oi.product_snapshot -> 'spec' ->> 'color')
         from public.admin_audit_log a,
              lateral pg_catalog.jsonb_array_elements(a.after -> 'line_tax_bases') as x(value)
              join public.order_items oi on oi.id = (x.value ->> 'order_item_id')::uuid
        where a.request_id = 'aaaaaaaa-0000-4000-8000-000000000021'")
say "  兩列代購(只有規格不同)⇒ join order_items ⇒ $JOINED"
# 🔵 **比【配對】不比【排列順序】** —— 我第一版寫死了一個順序, 而 `order by` 在 LC_ALL=C 之下
#    是照位元組排的 ⇒ 那一格紅在「順序跟我猜的不同」, 不是紅在「配對錯了」。
#    📌 又一次「紅錯地方」。斷言要問的是**紅配 taxed、藍配 untaxed**, 那與誰先誰後無關。
case "$JOINED" in
  *'紅=taxed'*) case "$JOINED" in
      *'藍=untaxed'*) ok audit-linekey "稽核那一列 join 得到 order_items, 而規格與稅基配對正確" ;;
      *) bad audit-linekey "藍那一列配錯:[$JOINED](回傳:$R_2)" ;;
    esac ;;
  *) bad audit-linekey "紅那一列配錯:[$JOINED](回傳:$R_2)" ;;
esac

# 🔴 **R5 那個失敗情境要真的演一次**:合法改價之後, 稽核【仍然】指得回原本那一列。
#    第一版拿【單價】當身分 ⇒ 改價之後就對不回去了。這一格就是那個突變的替身。
q "update public.order_items set unit_price = 1200, line_total = 1200
    where id = (select (x.value ->> 'order_item_id')::uuid
                  from public.admin_audit_log a,
                       lateral pg_catalog.jsonb_array_elements(a.after -> 'line_tax_bases') as x(value)
                 where a.request_id = 'aaaaaaaa-0000-4000-8000-000000000021'
                   and x.value ->> 'tax_basis' = 'taxed')" >/dev/null 2>&1
AFTER_EDIT=$(q "select string_agg(
              (oi.product_snapshot -> 'spec' ->> 'color') || '=' || (x.value ->> 'tax_basis'),
              ' | ' order by oi.product_snapshot -> 'spec' ->> 'color')
         from public.admin_audit_log a,
              lateral pg_catalog.jsonb_array_elements(a.after -> 'line_tax_bases') as x(value)
              join public.order_items oi on oi.id = (x.value ->> 'order_item_id')::uuid
        where a.request_id = 'aaaaaaaa-0000-4000-8000-000000000021'")
say "  ⚪ 把【紅】那一列的單價合法改成 1200 之後 ⇒ $AFTER_EDIT"
case "$AFTER_EDIT" in
  *'紅=taxed'*) case "$AFTER_EDIT" in
      *'藍=untaxed'*) ok audit-after-edit "改價之後對應【沒有漂掉】—— 因為綁的是 id 不是價格" ;;
      *) bad audit-after-edit "改價之後藍那一列漂了:[$AFTER_EDIT]" ;;
    esac ;;
  *) bad audit-after-edit "改價之後紅那一列漂了:[$AFTER_EDIT] ⇒ 身分綁在會變的值上" ;;
esac

# ══ codex R4 must-fix ④:空字串 / JSON null 不得悄悄變成「缺鍵」 ═════════════
# 🔴 mrid 要是【合法 uuid】—— 第一版我拿名字的第一個字母去拼, `jsonnull` ⇒ `j` ⇒ 不是十六進位
#    ⇒ 那一格紅在「uuid 語法錯」, 不是紅在「沒擋住」。📌 兩種紅要分得開, 所以寫死兩個。
check_basis_value() {  # $1 = 格名 · $2 = mrid · $3 = 要送的 JSON 值 · $4 = 講人話的標籤
  local out
  out=$(call '{"type":"personal","requested":false}' "$2" ",\"tax_basis\":$3")
  case "$out" in
    *'不是 untaxed / taxed'*) ok "$1" "$4 ⇒ 被指名擋下(不是悄悄記成缺鍵)" ;;
    *) bad "$1" "$4 沒有被擋:$out" ;;
  esac
}
check_basis_value audit-empty    'aaaaaaaa-0000-4000-8000-000000000031' '""'   '空字串'
check_basis_value audit-jsonnull 'aaaaaaaa-0000-4000-8000-000000000032' 'null' 'JSON null'

# ── 突變:四發 ───────────────────────────────────────────────────────
#   🔴 **M1/M2 證不到「斷言① 存在」**(codex R1 2026-09-09 must-fix ②, 它對):
#      它們兩發都會被【字面斷言②a/②b】擋住 ⇒ 📌 **把事後斷言① 整段刪掉, 這支鑽機照樣全綠。**
#   ✅ **M3 補的就是那一格**:只把稅率 `0.05` 換成 `0.06`
#      ⇒ ②a/②b/③ 要找的字面**一個都沒少** ⇒ **只有斷言①(md5)抓得到它。**
#   ✅ **M4 打的是另一端**:動【舊函式】的可執行內容 ⇒ 前置閘②(比 md5)必須叫。
#   🔴🔴 **而每一發都要求【命中指定的那一句】, 不是只要 `rc != 0`** ——
#      準備步驟失敗、psql 連不上、SQL 打錯字, 全都是非零 ⇒ 📌 **它們會被記成「突變被殺死」。**
mutate() {  # $1 = sed 的替換式 · $2 = 名字 · $3 = 這一發在演什麼
  cp "$NEW" "$D/mut.sql"
  python3 - "$D/mut.sql" "$1" "$2" <<'PY'
import io, sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
a = a.replace('\\n', '\n')          # 🔴 bash 傳進來的是【兩個字元】, 不是換行
b = b.replace('\\n', '\n')
s = io.open(p, encoding='utf-8').read()
n = s.count(a)
if n != 1:
    print(f'🛑 突變錨命中 {n} 次(期望 1)⇒ 這一發【沒有套用】, 不要讀成綠')
    sys.exit(9)
io.open(p, 'w', encoding='utf-8').write(s.replace(a, b))
PY
}
# 🔴 **準備步驟自己要成功** —— 準備失敗也會讓下一步非零, 而那與「突變被殺死」印同一個東西。
#    ⇒ 準備失敗一律回 `PREP_FAILED`, 呼叫端當【沒跑到】處理, 不當綠也不當紅。
reload_gen6() {  # $1 = 要載入的第 6 代檔(預設原版)
  local src="${1:-$D/gen6.sql}"
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -c \
    "drop function public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text)" >"$D/prep.log" 2>&1 || return 1
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$src" >>"$D/prep.log" 2>&1 || return 1
  # the return value must follow regrant -- it used to be a hard-coded `return 0`, swallowing failures.
  regrant || return 1
  return 0
}
# 跑一發突變, 印「rc|命中的那一句」。命中句抓的是 RAISE 的前綴(前置閘N / 斷言N)。
run_mut() {  # $1 = 要貼的 migration 檔 · $2 = 載入哪一版第 6 代
  if ! reload_gen6 "${2:-}"; then echo "PREP_FAILED|$(tail -1 "$D/prep.log")"; return; fi
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$1" >"$D/mut.log" 2>&1
  local rc=$?
  local hit
  # Only look at the ERROR: line (codex R2 must-fix). psql echoes the offending SQL under
  # LINE/CONTEXT, and that echo contains the very same gate names -- so a whole-log grep can
  # pick up the *source text* instead of the gate that actually stopped it.
  hit=$(grep 'ERROR:' "$D/mut.log" | grep -oE '(前置閘|斷言)[0-9①-⑨⓪]+[a-c]?' | head -1)
  echo "$rc|${hit:-NO_HIT}"
}
# 判一發:要求 rc 非零【而且】命中指定那一句。
judge_mut() {  # $1 名字 · $2 期望命中的句子 · $3 run_mut 的輸出 · $4 這一發在演什麼
  local rc="${3%%|*}" hit="${3#*|}"
  if [ "$rc" = 'PREP_FAILED' ]; then bad "$1" "準備步驟就失敗了 ⇒ 這一發【沒跑到】:$hit"; return; fi
  if [ "$rc" -eq 0 ]; then bad "$1" "$4 —— 而它【照樣過了】⇒ 那一格沒有咬合力"; return; fi
  # Exact match, not a prefix match (codex R2 must-fix): passing the bare prefix with
  # `"$2"*` let assertion 5 (the ACL cell) pass too -- and that is exactly the cell a
  # broken prep step goes red on. One notch too wide reads "my guard stopped working"
  # as "the guard killed the mutation".
  if [ "$hit" = "$2" ]; then
    ok "$1" "$4 ⇒ 被【$hit】擋下(rc=$rc)"
  else
    bad "$1" "$4 紅了(rc=$rc), 而擋它的是【$hit】不是【$2】⇒ 紅在別的地方, 不算"
  fi
}
mutate '  IF v_invoice_requested THEN\n    v_tax := pg_catalog.round' '  IF true THEN\n    v_tax := pg_catalog.round' \
  && judge_mut mut-M1 斷言① "$(run_mut "$D/mut.sql")" '判準拿掉(永遠加稅)'

mutate "v_tax := 0;
    v_price_tax_mode := 'inclusive';" "v_tax := pg_catalog.round(((v_subtotal + p_shipping_fee - 0)::numeric) * 0.05)::bigint;
    v_price_tax_mode := 'exclusive';" \
  && judge_mut mut-M2 斷言① "$(run_mut "$D/mut.sql")" '把「沒勾」那一支也改成加稅'

# 🔴🔴 **M3 —— 這一發是【只有斷言① 抓得到】的那一發**(codex R1 must-fix ②)。
#   把稅率 0.05 換成 0.06:②a 要的 `IF v_invoice_requested THEN`、②b 要的 `v_tax := 0;`、
#   ③ 要的「沒有 constant」**全部原封不動** ⇒ 那三格照樣綠。
#   ⇒ 📌 **它紅不紅, 就等於「斷言①(md5)還在不在」。**
mutate '* 0.05)::bigint;
    v_price_tax_mode' '* 0.06)::bigint;
    v_price_tax_mode' \
  && judge_mut mut-M3 斷言① "$(run_mut "$D/mut.sql")" '稅率偷改成 6%(所有字面都還在)'

# 🔴 **M4 —— 打另一端:動【舊函式】, 前置閘② 必須叫。**
#   它答的是「我貼上去之前, 有沒有人動過正式庫那一版」——
#   而那一格失效的後果是:🛑 **我這一貼會靜靜地蓋掉別人的改動, 而沒有任何東西會紅。**
# 🔴 **錨要落在【本體裡】** —— 第一版我改的是 `RETURNS jsonb`(在 CREATE 的**表頭**),
#    而 `prosrc` **只含兩個 $fn$ 之間那一段** ⇒ md5 一個位元都沒變 ⇒ 前置閘②不叫, 這一格紅。
#    📌 **那個紅是對的:它告訴我「我的突變根本沒有動到那把尺量的東西」。**
sed 's/^DECLARE$/DECLARE -- probe-M4/' "$D/gen6.sql" > "$D/gen6-m4.sql"
if cmp -s "$D/gen6.sql" "$D/gen6-m4.sql"; then
  bad mut-M4 '突變沒有套用(sed 錨沒命中)⇒ 這一發沒跑到, 不要讀成綠'
else
  judge_mut mut-M4 前置閘② "$(run_mut "$NEW" "$D/gen6-m4.sql")" '舊函式被別人動過一行'
fi

# 🔴 **M5 —— 前置閘④(函式屬性)的負對照**(codex R1 nit ③)。
#   `STRICT` 不進 `prosrc` ⇒ **md5 一個位元都不變** ⇒ 前置閘②與斷言① 對它完全失明。
#   而它的後果很具體:repository 對留白的通知信箱送 `NULL`
#   ⇒ 🛑 **函式直接回 NULL、本體一行都不跑 ⇒ 一張單靜靜地沒有被建出來。**
#   📌 少了這一發, 前置閘④ 就是一格【從來沒有紅過】的斷言。
sed 's/^SET search_path = .*$/&\nSTRICT/' "$D/gen6.sql" > "$D/gen6-m5.sql"
if cmp -s "$D/gen6.sql" "$D/gen6-m5.sql"; then
  bad mut-M5 '突變沒有套用(sed 錨沒命中)⇒ 這一發沒跑到, 不要讀成綠'
else
  judge_mut mut-M5 前置閘④ "$(run_mut "$NEW" "$D/gen6-m5.sql")" '舊函式被偷偷加上 STRICT(md5 不變)'
fi

# 🔴 **M6 —— 那道長度不變式【今天走不到】, 所以要現造一個世界讓它叫**(codex R6 nit)。
#   📌 一道現行流程走不到的守門, 若沒有人演一次, 它與「寫了而根本不會執行」印同一個東西。
#   🛑 **而第一版我做錯了, 錯法值得留著**:我去突變【整支 migration】然後貼它 ——
#     而那支 migration 自己的**事後斷言①(比 body md5)**當場把它擋掉、整筆回滾
#     ⇒ 函式還停在第 6 代 ⇒ 那一發**建得出單**, 我差點把它讀成「守門沒有咬合力」。
#     🎯 **那個紅的原因與我要問的問題無關 —— 又一次「紅錯地方」。**
#   ✅ 正確做法:貼真的那一支, 然後**直接 CREATE OR REPLACE 一份突變過的函式**(不經 migration),
#     這樣才繞得過它自己的 md5 斷言, 問到我真正要問的那件事。
python3 - "$NEW" "$D/mut6-fn.sql" <<'PYEOF'
import io, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE OR REPLACE FUNCTION public.admin_create_manual_order(')
k = src.index('\n$fn$;', i) + len('\n$fn$;')
fn = src[i:k]
a = "    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);"
if fn.count(a) != 1:
    print(f'🛑 M6 突變錨命中 {fn.count(a)} 次(期望 1)⇒ 這一發【沒有套用】, 不要讀成綠')
    sys.exit(9)
io.open(sys.argv[2], 'w', encoding='utf-8').write(fn.replace(a, a + "\n" + a) + "\n")
PYEOF
if [ $? -ne 0 ]; then
  bad mut-M6 '突變沒有套用 ⇒ 這一發沒跑到, 不要讀成綠'
else
  # 先把真的那一支貼好(前置閘會要求現在是第 6 代)
  reload_gen6 >/dev/null 2>&1
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$NEW" >/dev/null 2>&1
  # 🟢 正對照先跑:沒突變之前, 同一發建得出單
  OUT6B=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000042' ',"tax_basis":"untaxed"')
  case "$OUT6B" in
    *'display_id'*) ok mut-M6-ctl "🟢 正對照:沒突變時同一發建得出單 ⇒ 下面那個紅可以歸因給突變" ;;
    *) bad mut-M6-ctl "沒突變也建不出單 ⇒ 下面那個紅不可歸因:$OUT6B" ;;
  esac
  # 再把突變過的函式直接蓋上去(繞過 migration 自己的 md5 斷言 —— 那正是這一發要繞的)
  psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$D/mut6-fn.sql" >/dev/null 2>&1
  regrant
  OUT6=$(call '{"type":"personal","requested":false}' 'aaaaaaaa-0000-4000-8000-000000000041' ',"tax_basis":"untaxed"')
  case "$OUT6" in
    *'內部三個陣列長度不一致'*) ok mut-M6 "ids 多一筆 ⇒ 那道長度不變式當場停(而不是靜靜留下指不到品項的稽核)" ;;
    *) bad mut-M6 "ids 多一筆而它【照樣建出單】⇒ 那道閘沒有咬合力:$OUT6" ;;
  esac
fi

# ── 重貼:forward-only 必須拒絕 ──────────────────────────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -q -c \
  "drop function public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text)" >/dev/null 2>&1
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -q -f "$D/gen6.sql" >/dev/null 2>&1
regrant
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$NEW" >/dev/null 2>&1
psql -h 127.0.0.1 -p $PORT -U postgres -d probe -v ON_ERROR_STOP=1 -q -f "$NEW" >"$D/rerun.log" 2>&1
RC=$?
[ $RC -ne 0 ] && grep -q '前置閘⓪' "$D/rerun.log" \
  && ok rerun "重貼被前置閘⓪擋下(rc=$RC)" \
  || bad rerun "重貼 rc=$RC 而訊息不是前置閘⓪:$(tail -2 "$D/rerun.log" | tr '\n' ' ')"

# ── 收尾:印【為什麼結束】 ───────────────────────────────────────────
say ''
say "期望的格子:$EXPECT"
say "過了      :$PASS"
say "沒過      :$FAIL"
MISS=''
for e in $EXPECT; do case " $PASS $FAIL " in *" $e "*) ;; *) MISS="$MISS $e";; esac; done
say "🔴 從來沒跑到的格子(既不綠也不紅, 而它與「全綠」在 rc 上一樣):$MISS"
if [ -n "$FAIL" ] || [ -n "$MISS" ]; then
  say "⇒ 結束原因:有格子紅了或根本沒跑到。"
  exit 1
fi
say "⇒ 結束原因:$(echo $EXPECT | wc -w | tr -d ' ') 個格子全部跑到而且全綠。"
exit 0
