#!/usr/bin/env bash
# ci-self-contained: no  —— 要位置參數/信箱裡的 SQL 檔, CI 裡那些不存在 ⇒ 它跑不起來, 不是不該跑
# orderpurge-apply-probe.sh — 清空訂單那份 SQL 的拋棄式 PG 實演 + 三發突變
#
# 🔴 它證什麼:①刪除順序在 FK 底下走得通 ②防刪守門要先關、關了才刪得動
#              ③🔴 **中途【真的】炸掉 ⇒ ROLLBACK 之後守門必須全部回到啟用**
# 🛑 它【不證】什麼:正式庫的守門【函式體】與這裡不同(這裡用最小同構模型);
#    「哪些守門會擋」那一格的來源是【對正式庫的唯讀查詢】, 不是這支腳本。
#
# 起法整段【貼自】docs/runbooks/throwaway-postgres-for-migration-verification.md §1
# (那份 runbook 自己記著:手打的那次就是踩到 LC_ALL 的那次)
set -u
export LC_ALL=C LANG=C

WIN=2d
D=/tmp/pcm-probe-$WIN
PORT=555$(printf '%02d' $(( $(echo -n "$WIN" | cksum | cut -d' ' -f1) % 90 + 10 )))

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
q(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge -tAc "$1" 2>&1; }

lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $PORT 已被佔用, 換 WIN 再來"; exit 2; }
[ -e "$D" ] && { echo "🔴 $D 已存在 —— 可能是別人的或你上次沒收攤的。自己看, 不要 rm"; exit 2; }

mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗"; tail -6 "$D/initdb.log"; exit 2; }
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start > /dev/null 2>&1
sleep 3
psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1" > /dev/null 2>&1 || { echo "🔴 起不來, pg.log 最後 6 行:"; tail -6 "$D/pg.log"; exit 2; }
trap 'LC_ALL=C pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT

psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "create database purge" > /dev/null

# ── 最小同構 schema:CASCADE / RESTRICT / 無 FK / 防刪守門 四種形狀各要有 ──
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > "$D/schema.log" 2>&1 <<'SQL'
CREATE TABLE orders(id int PRIMARY KEY, code text);
CREATE TABLE order_items(id int PRIMARY KEY, order_id int REFERENCES orders(id) ON DELETE CASCADE);
CREATE TABLE order_payments(id int PRIMARY KEY, order_id int REFERENCES orders(id) ON DELETE RESTRICT);
CREATE TABLE order_refunds(id int PRIMARY KEY, order_id int REFERENCES orders(id));
CREATE TABLE shipments(id int PRIMARY KEY, ref text);
CREATE TABLE shipment_items(id int PRIMARY KEY, shipment_id int REFERENCES shipments(id),
                            order_item_id int REFERENCES order_items(id) ON DELETE RESTRICT);
CREATE TABLE shipping_idem(id int PRIMARY KEY, shipment_id int REFERENCES shipments(id));
-- 🔴 無 FK 指向 orders, 只有一個 order_id 欄 ⇒ 資料庫【不會替我們擋也不會替我們刪】
CREATE TABLE order_refund_items(id int PRIMARY KEY, order_id int, refund_id int REFERENCES order_refunds(id));

CREATE FUNCTION block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only: % 不得刪除', TG_TABLE_NAME; END $$;

CREATE TRIGGER order_payments_no_delete_bd  BEFORE DELETE ON order_payments  FOR EACH ROW EXECUTE FUNCTION block_delete();
CREATE TRIGGER order_refunds_block_delete_bd BEFORE DELETE ON order_refunds  FOR EACH ROW EXECUTE FUNCTION block_delete();
CREATE TRIGGER shipments_block_delete_bd     BEFORE DELETE ON shipments      FOR EACH ROW EXECUTE FUNCTION block_delete();
CREATE TRIGGER shipment_items_block_delete_bd BEFORE DELETE ON shipment_items FOR EACH ROW EXECUTE FUNCTION block_delete();
CREATE TRIGGER shipping_idem_block_delete_bd BEFORE DELETE ON shipping_idem  FOR EACH ROW EXECUTE FUNCTION block_delete();
CREATE TRIGGER ori_block_delete_bd           BEFORE DELETE ON order_refund_items FOR EACH ROW EXECUTE FUNCTION block_delete();
SQL

seed(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > /dev/null 2>&1 <<'SQL'
SET session_replication_role = replica;
TRUNCATE shipping_idem, shipment_items, shipments, order_refund_items, order_refunds, order_payments, order_items, orders;
SET session_replication_role = origin;
INSERT INTO orders VALUES (1,'A'),(2,'B');
INSERT INTO order_items VALUES (10,1),(11,1),(12,2);
INSERT INTO order_payments VALUES (20,1),(21,2);
INSERT INTO order_refunds VALUES (30,1);
INSERT INTO shipments VALUES (40,'S1'),(41,'孤兒');
INSERT INTO shipment_items VALUES (50,40,10);
INSERT INTO shipping_idem VALUES (60,40),(61,41);
INSERT INTO order_refund_items VALUES (70,1,30);
SQL
}

# ── 受測腳本本體:關【具名】守門(不是 TRIGGER USER)→ 葉往根刪 → 開回來 ──
DISABLE="ALTER TABLE order_payments DISABLE TRIGGER order_payments_no_delete_bd;
ALTER TABLE order_refunds DISABLE TRIGGER order_refunds_block_delete_bd;
ALTER TABLE shipments DISABLE TRIGGER shipments_block_delete_bd;
ALTER TABLE shipment_items DISABLE TRIGGER shipment_items_block_delete_bd;
ALTER TABLE shipping_idem DISABLE TRIGGER shipping_idem_block_delete_bd;
ALTER TABLE order_refund_items DISABLE TRIGGER ori_block_delete_bd;"
ENABLE=$(echo "$DISABLE" | sed 's/DISABLE TRIGGER/ENABLE TRIGGER/')
DELETES="DELETE FROM shipping_idem;
DELETE FROM shipment_items;
DELETE FROM shipments;
DELETE FROM order_refund_items;
DELETE FROM order_refunds;
DELETE FROM order_payments;
DELETE FROM order_items;
DELETE FROM orders;"

run(){ printf 'BEGIN;\n%s\n%s\n%s\n%s\nCOMMIT;\n' "$DISABLE" "$DELETES" "${1:-}" "$ENABLE" \
       | psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > "$D/run.log" 2>&1; echo $?; }
enabled(){ q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'"; }
rows(){ q "SELECT (SELECT count(*) FROM orders)+(SELECT count(*) FROM order_items)+(SELECT count(*) FROM order_payments)+(SELECT count(*) FROM order_refunds)+(SELECT count(*) FROM shipments)+(SELECT count(*) FROM shipment_items)+(SELECT count(*) FROM shipping_idem)+(SELECT count(*) FROM order_refund_items)"; }

echo "=== 世界 0:守門真的會擋(對照組 —— 沒有它, 下面每一格都沒有意義)==="
seed
BLK=$(q "DELETE FROM order_payments" ); case "$BLK" in *append-only*) ok "不關守門就刪 order_payments ⇒ 被擋";; *) no "守門沒擋 ⇒ 這個模型是假的, 後面全部作廢 [$BLK]";; esac
[ "$(enabled)" = "6" ] && ok "六個守門起始都是啟用" || no "起始啟用數 = $(enabled), 應 6"

echo "=== 世界 1:正常跑完 ==="
seed; RC=$(run); [ "$RC" = "0" ] && ok "腳本 rc=0" || { no "腳本 rc=$RC"; tail -3 "$D/run.log"; }
[ "$(rows)" = "0" ] && ok "八張表全部清空(合計 0)" || no "還剩 $(rows) 列"
[ "$(enabled)" = "6" ] && ok "🔴 跑完後六個守門【全部回到啟用】" || no "跑完後只有 $(enabled) 個啟用"

echo "=== 世界 2:M1 突變 —— 把「開回守門」那段拿掉 ⇒ 收尾檢查必須紅 ==="
seed
printf 'BEGIN;\n%s\n%s\nCOMMIT;\n' "$DISABLE" "$DELETES" | psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > /dev/null 2>&1
[ "$(enabled)" != "6" ] && ok "M1 ⇒ 啟用數掉到 $(enabled) ⇒ 我的收尾檢查抓得到" || no "M1 ⇒ 仍然 6 ⇒ 🔴 那個檢查【殺不掉突變】"
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge -c "$ENABLE" > /dev/null 2>&1

echo "=== 世界 3:M2 突變 —— 漏掉那張【沒有 FK】的表 ⇒ 孤兒檢查必須紅 ==="
seed
D2=$(echo "$DELETES" | grep -v 'order_refund_items')
printf 'BEGIN;\n%s\n%s\n%s\nCOMMIT;\n' "$DISABLE" "$D2" "$ENABLE" | psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > "$D/m2.log" 2>&1
LEFT=$(q "SELECT count(*) FROM order_refund_items")
[ "$LEFT" != "0" ] && ok "M2 ⇒ order_refund_items 留下 $LEFT 列孤兒 ⇒ 抓得到" || no "M2 ⇒ 它自己不見了 ⇒ 這個模型沒有代表無 FK 的形狀"

echo "=== 世界 4:🔴 M3 —— 中途【真的】炸(不是模擬)⇒ ROLLBACK 後守門必須全復原 ==="
seed
printf 'BEGIN;\n%s\n%s\nSELECT 1/0;\n%s\nCOMMIT;\n' "$DISABLE" "$DELETES" "$ENABLE" | psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > "$D/m3.log" 2>&1
grep -q 'division by zero' "$D/m3.log" && ok "M3 真的炸了(division by zero, 不是模擬)" || no "M3 沒炸 ⇒ 這一格沒有演到"
[ "$(enabled)" = "6" ] && ok "🔴🔴 M3 之後六個守門【全部仍然啟用】⇒ 交易性成立" || no "🔴🔴 M3 之後只剩 $(enabled) 個啟用 ⇒ 守門被留在關閉狀態"
[ "$(rows)" != "0" ] && ok "M3 之後資料還在($(rows) 列)⇒ 整筆回捲" || no "M3 之後資料不見了 ⇒ 沒有回捲"

echo "=== 世界 5:🔴 ENABLE 是【覆寫】不是【還原】—— 它把 ALWAYS 降級(2026-09-01 正式庫實錘的回歸) ==="
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > /dev/null 2>&1 <<'SQL'
CREATE TABLE IF NOT EXISTS aw(id int);
DROP TRIGGER IF EXISTS aw_g ON aw;
CREATE TRIGGER aw_g BEFORE DELETE ON aw FOR EACH ROW EXECUTE FUNCTION block_delete();
ALTER TABLE aw ENABLE ALWAYS TRIGGER aw_g;
SQL
S0=$(q "SELECT tgenabled FROM pg_trigger WHERE tgname='aw_g'")
[ "$S0" = "A" ] && ok "起始是 A(ALWAYS)" || no "起始是 $S0, 應 A"
q "ALTER TABLE aw DISABLE TRIGGER aw_g" > /dev/null
q "ALTER TABLE aw ENABLE TRIGGER aw_g" > /dev/null
S1=$(q "SELECT tgenabled FROM pg_trigger WHERE tgname='aw_g'")
[ "$S1" = "O" ] && ok "🔴 plain ENABLE 之後變成 O ⇒ 【降級】確實存在, 不是我誤讀" || no "plain ENABLE 之後是 $S1, 那本機重現不出這個 bug"

echo "=== 世界 5b:降級的【後果】—— 兩個世界各餵一發 ==="
q "DELETE FROM aw" > /dev/null; q "INSERT INTO aw VALUES (1)" > /dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge -tAc "set session_replication_role=replica" -tAc "delete from aw" > /dev/null 2>&1
[ "$(q "SELECT count(*) FROM aw")" = "0" ] && ok "🔴 O 之下 replica 角色刪得掉(守門沒擋)⇒ 剩 0 列" || no "O 之下竟然擋住了 ⇒ 這個模型與正式庫不同"
q "ALTER TABLE aw ENABLE ALWAYS TRIGGER aw_g" > /dev/null
q "INSERT INTO aw VALUES (2)" > /dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge -tAc "set session_replication_role=replica" -tAc "delete from aw" > /dev/null 2>&1
[ "$(q "SELECT count(*) FROM aw")" = "1" ] && ok "✅ A 之下同一發被擋 ⇒ 剩 1 列(正對照:尺會動)" || no "A 之下也刪掉了 ⇒ 這一組對照沒有判別力"

echo "=== 世界 6:v2 的【拍快照 → 原樣還原 → 逐格比對】 ==="
q "ALTER TABLE aw ENABLE ALWAYS TRIGGER aw_g" > /dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge > "$D/w6.log" 2>&1 <<'SQL'
BEGIN;
CREATE TEMP TABLE _b ON COMMIT DROP AS
  SELECT c.relname::text tbl, t.tgname::text trg, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname='aw';
ALTER TABLE aw DISABLE TRIGGER aw_g;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM _b LOOP
    EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I', r.tbl,
      CASE r.tgenabled WHEN 'O' THEN 'ENABLE' WHEN 'A' THEN 'ENABLE ALWAYS'
                       WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'D' THEN 'DISABLE' END, r.trg);
  END LOOP; END $$;
COMMIT;
SQL
[ "$(q "SELECT tgenabled FROM pg_trigger WHERE tgname='aw_g'")" = "A" ] && ok "✅ 快照還原之後仍然是 A ⇒ v2 的修法成立" || no "快照還原之後是 $(q "SELECT tgenabled FROM pg_trigger WHERE tgname='aw_g'"), 應 A"

echo "=== 世界 6b:🔴 那道【逐格比對】的斷言, 抓不抓得到降級 ==="
q "ALTER TABLE aw ENABLE ALWAYS TRIGGER aw_g" > /dev/null
DIFF=$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d purge -tAc "
BEGIN;
CREATE TEMP TABLE _b2 ON COMMIT DROP AS
  SELECT c.relname::text tbl, t.tgname::text trg, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname='aw';
ALTER TABLE aw DISABLE TRIGGER aw_g;
ALTER TABLE aw ENABLE TRIGGER aw_g;
SELECT count(*) FROM _b2 b LEFT JOIN (
  SELECT c.relname::text tbl, t.tgname::text trg, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal) a
  ON a.tbl=b.tbl AND a.trg=b.trg
 WHERE a.tbl IS NULL OR a.tgenabled IS DISTINCT FROM b.tgenabled;
ROLLBACK;" 2>&1 | tr -d ' \n')
case "$DIFF" in *1*) ok "🔴 用【錯的】還原法(plain ENABLE)⇒ 比對印 1 ⇒ 那道斷言殺得掉這個突變";; *) no "比對印 [$DIFF] ⇒ 🔴 那道斷言【殺不掉】降級這個突變";; esac
q "ALTER TABLE aw ENABLE ALWAYS TRIGGER aw_g" > /dev/null

echo "=== PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] || exit 1
