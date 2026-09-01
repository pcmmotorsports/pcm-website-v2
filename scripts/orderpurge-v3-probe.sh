#!/usr/bin/env bash
# ci-self-contained: no  —— 要位置參數/信箱裡的 SQL 檔, CI 裡那些不存在 ⇒ 它跑不起來, 不是不該跑
# orderpurge-v3-probe.sh — v3(單一 DO 區塊)的拋棄式 PG 實演 + codex 七條的回歸突變
# 🛑 它用【自動生成的 stub schema】演 v3 的控制流(快照→停用→刪→還原→整包比對),
#    不是正式庫的真 schema ⇒ 它證的是【流程】, 不是【那 27 張表的欄位對不對】。
set -u
export LC_ALL=C LANG=C
SQLF="${1:-$HOME/pcm-mailbox/未批-真的刪-清空訂單-v3-20260901.sql}"
WIN=v3
D=/tmp/pcm-probe-$WIN
PORT=555$(printf '%02d' $(( $(echo -n "$WIN" | cksum | cut -d' ' -f1) % 90 + 10 )))
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "埠 $PORT 被佔"; exit 2; }
[ -e "$D" ] && { echo "$D 已存在 —— 自己看, 不要 rm"; exit 2; }
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/i.log" 2>&1 || { tail -5 "$D/i.log"; exit 2; }
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1
sleep 3
trap 'LC_ALL=C pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" >/dev/null 2>&1 || { tail -6 "$D/pg.log"; exit 2; }

# 從受測 SQL 自己抽出要建的表 ⇒ 分母由【它】決定, 不是我另外列一份
# 🔴 [a-z_]+ 會漏掉含【數字】的表名(pcm_b2_shipping_idempotency 的 b2)
#    2026-09-01 本 probe 自己踩到:少建那張表 ⇒ 世界1 紅在「relation does not exist」,
#    而那個紅【指向受測腳本】, 實際是我的產生器漏了它。⇒ 字集要含 0-9。
grep -oE 'DELETE FROM public\.[a-z0-9_]+' "$SQLF" | awk '{print $3}' | sed 's/public\.//' | sort -u > "$D/tables.txt"
grep -oE "'[a-z0-9_]+'" "$SQLF" | tr -d "'" | grep -E '^(order|payment|shipment|pcm)|^orders$' | sort -u >> "$D/tables.txt"
sort -u "$D/tables.txt" -o "$D/tables.txt"
printf '  受測檔:%s\n  它會刪的表:%s 張\n' "$(basename "$SQLF")" "$(wc -l < "$D/tables.txt" | tr -d ' ')"

mkdb(){ # $1=dbname  $2=要不要放那兩個單號(yes/no)
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "drop database if exists $1" >/dev/null
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "create database $1" >/dev/null
  { echo "CREATE FUNCTION blk() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'blocked'; END \$\$;"
    while IFS= read -r t; do
      echo "CREATE TABLE public.$t(id serial primary key, order_id int, display_id text);"
    done < "$D/tables.txt"
    # 三支守門, 其中一支是 ALWAYS(降級回歸)
    echo "CREATE TRIGGER g1 BEFORE DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION blk();"
    echo "CREATE TRIGGER g2 BEFORE DELETE ON public.order_refunds FOR EACH ROW EXECUTE FUNCTION blk();"
    echo "CREATE TRIGGER g3 BEFORE DELETE ON public.shipments FOR EACH ROW EXECUTE FUNCTION blk();"
    echo "ALTER TABLE public.shipments ENABLE ALWAYS TRIGGER g3;"
    echo "INSERT INTO public.orders(display_id) VALUES ('AAA111'),('BBB222');"
    [ "$2" = yes ] && echo "INSERT INTO public.orders(display_id) VALUES ('8X3N5Q'),('VXTQV2');"
    echo "INSERT INTO public.order_payments(order_id) VALUES (1),(2);"
    echo "INSERT INTO public.order_refunds(order_id) VALUES (1);"
    echo "INSERT INTO public.shipments(order_id) VALUES (1);"
  } | psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" > "$D/mk-$1.log" 2>&1
}
# 🔴 -v ON_ERROR_STOP=1 不可省:psql 預設【出錯照樣回 0】
#    (2026-09-01 本 probe 自己踩到:世界1 印 "ok rc=0" 而 orders 一列都沒刪 ——
#     那是【我的尺】壞了, 不是受測腳本壞了。少了它, 這支 probe 會放行一支壞掉的 SQL。)
run(){ psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" -f "$SQLF" > "$D/run-$1.log" 2>&1; echo $?; }
q(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" -tAc "$2" 2>&1; }

echo "=== 世界 0(必失敗對照):守門真的會擋 ==="
mkdb w0 yes
case "$(q w0 'DELETE FROM public.order_payments')" in *blocked*) ok "不關守門就刪 ⇒ 被擋";; *) no "守門沒擋 ⇒ 模型是假的, 後面作廢";; esac

echo "=== 世界 1:正常跑完 ==="
mkdb w1 yes
RC=$(run w1); [ "$RC" = 0 ] && ok "rc=0" || { no "rc=$RC"; grep -E 'ERROR|例外|取消' "$D/run-w1.log" | head -2 | sed 's/^/        /'; }
[ "$(q w1 'SELECT count(*) FROM public.orders')" = 0 ] && ok "orders 清空" || no "orders 還剩 $(q w1 'SELECT count(*) FROM public.orders')"
[ "$(q w1 "SELECT tgenabled FROM pg_trigger WHERE tgname='g3'")" = A ] && ok "🔴 ALWAYS 守門仍是 A(沒被降級)" || no "g3 變成 $(q w1 "SELECT tgenabled FROM pg_trigger WHERE tgname='g3'")"
[ "$(q w1 "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'")" = 0 ] && ok "沒有守門留在 D" || no "有守門留在 D"

echo "=== 世界 2:🔴 codex⑥ 貼錯庫(schema 相同, 沒有那兩個單號)⇒ 必須紅 ==="
mkdb w2 no
RC=$(run w2)
[ "$RC" != 0 ] && ok "rc=$RC 非 0 ⇒ 擋下了" || no "🔴 假庫竟然跑完了 —— 那道身分斷言沒有判別力"
grep -q '貼錯 Supabase 專案分頁' "$D/run-w2.log" && ok "訊息指向【貼錯分頁】而不是別的" || no "訊息沒指出成因"
[ "$(q w2 'SELECT count(*) FROM public.orders')" = 2 ] && ok "假庫的資料【一列都沒少】" || no "假庫被動到了"

echo "=== 世界 3:🔴 codex② 執行中憑空多一支守門 ⇒ 整包比對必須紅 ==="
mkdb w3 yes
# 在同一個庫另開一條連線, 於腳本跑之前加一支新 trigger ⇒ 快照拍完後才存在的情境
# 這裡用「先跑腳本到快照之後」不可行(單一交易)⇒ 改測比對本身:先拍照、加 trigger、再比
CMP=$(q w3 "
DO \$\$
DECLARE b jsonb; a jsonb;
BEGIN
  SELECT jsonb_agg(x ORDER BY x->>'trg') INTO b FROM (
    SELECT jsonb_build_object('trg',t.tgname,'en',t.tgenabled,'fn',t.tgfoid::regprocedure::text) x
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal) s;
  CREATE TRIGGER gNEW BEFORE DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION blk();
  SELECT jsonb_agg(x ORDER BY x->>'trg') INTO a FROM (
    SELECT jsonb_build_object('trg',t.tgname,'en',t.tgenabled,'fn',t.tgfoid::regprocedure::text) x
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal) s;
  IF a IS DISTINCT FROM b THEN RAISE NOTICE 'CAUGHT'; ELSE RAISE NOTICE 'MISSED'; END IF;
END \$\$;")
case "$CMP" in *CAUGHT*) ok "🔴 多出一支守門 ⇒ 整包比對【抓得到】(LEFT JOIN 抓不到的那一格)";; *) no "多出一支守門 ⇒ 比對沒抓到 [$CMP]";; esac

echo "=== 世界 4:🔴 codex③ 同名守門被改掛到別的函式 ⇒ 必須紅 ==="
mkdb w4 yes
CMP=$(q w4 "
DO \$\$
DECLARE b jsonb; a jsonb;
BEGIN
  SELECT jsonb_agg(x ORDER BY x->>'trg') INTO b FROM (
    SELECT jsonb_build_object('trg',t.tgname,'en',t.tgenabled,'fn',t.tgfoid::regprocedure::text) x
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname='g1') s;
  CREATE FUNCTION noop() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END';
  DROP TRIGGER g1 ON public.order_payments;
  CREATE TRIGGER g1 BEFORE DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION noop();
  SELECT jsonb_agg(x ORDER BY x->>'trg') INTO a FROM (
    SELECT jsonb_build_object('trg',t.tgname,'en',t.tgenabled,'fn',t.tgfoid::regprocedure::text) x
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname='g1') s;
  IF a IS DISTINCT FROM b THEN RAISE NOTICE 'CAUGHT'; ELSE RAISE NOTICE 'MISSED'; END IF;
END \$\$;")
case "$CMP" in *CAUGHT*) ok "🔴 同名守門改掛空殼函式 ⇒ 比 tgfoid【抓得到】(只比 tgenabled 抓不到)";; *) no "改掛函式沒抓到 [$CMP]";; esac

echo "=== 世界 5:🔴 codex⑤ 分段貼 ⇒ 不得半套執行 ==="
mkdb w5 yes
head -40 "$SQLF" > "$D/part1.sql"
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d w5 -f "$D/part1.sql" > "$D/part1.log" 2>&1; P1=$?
[ "$P1" != 0 ] && ok "只貼前半 ⇒ rc=$P1 非 0(語法不完整, 不會半套執行)" || no "🔴 只貼前半竟然成功了 ⇒ 可能已經關掉守門而沒裝回去"
[ "$(q w5 "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'")" = 0 ] && ok "分段之後沒有守門留在 D" || no "🔴 分段之後有守門留在 D"

echo "=== PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = 0 ] || exit 1
