#!/bin/bash
# ci-self-contained: no — 需外部連線字串,且內嵌 CASE 是 #522 之前的舊分母(見檔頭)
# 🔴🔴 **2026-08-16 起本檔的 T3/T4 內嵌 CASE 是【過期版本】** —— `#522` 已把貨品軸的分母
#    從 `oi.quantity` 改成 `oi.quantity − cancelled_quantity`
#    (`supabase/migrations/20260816050000_m4b_522_goods_axis_subtract_cancelled.sql`)。
#    本檔造的 `order_item_quantity_summary` 連 `cancelled_quantity` 欄都沒有
#    ⇒ **它自我一致、照樣全綠,而它證的是一個已經被廢掉的版本。**
#    ⇒ 要驗現行貨品軸請跑 `docs/probes/order-goods-axis-parity-probe.sh`(對共用真值表比)。
# 484a 探針:在**拋棄式庫**上做三件事 —— 解析真 SQL / 真跑 DROP / 四值 oracle(含負向對照)
# 用法: bash docs/probes/484a-view-probe.sh <PGURL> <migration路徑>
set -uo pipefail
FAILS=0
fail(){ echo "🔴 FAIL: $*"; FAILS=$((FAILS+1)); }
D="$1"; MIG="$2"
q(){ psql "$D" -v ON_ERROR_STOP=0 -Atc "$1" 2>&1; }

echo "── T1 真 SQL 解析 + 真 DROP(在 public,零資料寫入)────────────"
# 從 migration 抽出 CREATE VIEW ... ; 那一段(到第一個分號結束)
awk '/^CREATE OR REPLACE VIEW/,/^FROM public\.orders o;/' "$MIG" > /tmp/484a-createview.sql
echo "抽出行數: $(wc -l < /tmp/484a-createview.sql)"
# 🔴 抽不到就是抽不到 —— 空檔餵給 psql 會回 0,那會讓整支探針假綠(我自己的負測抓到的)
[ -s /tmp/484a-createview.sql ] || fail "T1 從 migration 抽不到 CREATE VIEW 區段(空檔)"
grep -q "^CREATE OR REPLACE VIEW" /tmp/484a-createview.sql || fail "T1 抽出的區段沒有 CREATE VIEW 開頭"
OUT=$(psql "$D" -v ON_ERROR_STOP=1 -f /tmp/484a-createview.sql 2>&1); RC=$?
echo "CREATE VIEW EXIT=$RC ${OUT}"
[ "$RC" = "0" ] || fail "T1 CREATE VIEW 失敗(EXIT=$RC)"
VEXIST=$(q "select count(*) from information_schema.views where table_schema='public' and table_name='admin_order_list_v'")
echo "view 存在?: $VEXIST"
[ "$VEXIST" = "1" ] || fail "T1 建完之後 view 不存在(建了個寂寞)"
echo "-- 真跑 DROP --"
OUT2=$(psql "$D" -v ON_ERROR_STOP=1 -c "DROP VIEW IF EXISTS public.admin_order_list_v;" 2>&1); RC2=$?
echo "DROP VIEW EXIT=$RC2 ${OUT2}"
[ "$RC2" = "0" ] || fail "T1 DROP VIEW 失敗(EXIT=$RC2)"
echo "DROP 後零留痕(必須 0): $(q "select count(*) from information_schema.views where table_schema='public' and table_name='admin_order_list_v'")"

echo "-- T1b 整個 migration 檔跑一次(涵蓋 REVOKE / GRANT / COMMENT —— T1 的 awk 抽不到那幾行)--"
OUT1b=$(psql "$D" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1); RC1b=$?
echo "整檔 EXIT=$RC1b"
[ "$RC1b" = "0" ] || fail "T1b 整個 migration 檔跑不過:$OUT1b"
psql "$D" -q -c "DROP VIEW IF EXISTS public.admin_order_list_v;" >/dev/null 2>&1

echo
echo "── T2 負向對照:兩種錯要分得出來 ──────────────────────────────"
echo "語法就錯 → 期望 42601: $(q "CREATE VIEW public.zz_bad AS SELEKT 1")"
echo "語法對表不在 → 期望 42P01: $(q "CREATE VIEW public.zz_bad2 AS SELECT * FROM public.table_that_does_not_exist_484a")"

echo
echo "── T3 四值 oracle(獨立 schema,不碰 public 的資料)────────────"
echo "⚠️ 誠實:T3/T4 的 CASE 是 migration 那段的**等價重寫**(schema 換成 e484a),**不是**從 migration 抽出來的原文;"
echo "   驗原文的是 T1/T1b。⇒ migration 的 CASE 若抄漏一行判序,T3/T4 照樣全綠(code-reviewer 抓到)。"
psql "$D" -q -v ON_ERROR_STOP=1 > /tmp/484a-t3.out 2>&1 <<'EOF'
DROP SCHEMA IF EXISTS e484a CASCADE;
CREATE SCHEMA e484a;
CREATE TABLE e484a.orders (id int primary key, display_id text);
CREATE TABLE e484a.order_items (id int primary key, order_id int, quantity int);
CREATE TABLE e484a.order_item_quantity_summary (order_item_id int, ordered_quantity int, instock_quantity int, shipped_quantity int);

-- 五種情形:none / ordered / instock / shipped / 零品項單
INSERT INTO e484a.orders VALUES (1,'none'),(2,'ordered'),(3,'instock'),(4,'shipped'),(5,'zero-items'),(6,'partial-ordered');
INSERT INTO e484a.order_items VALUES (11,1,2),(21,2,2),(31,3,2),(41,4,2),(61,6,2),(62,6,3);
INSERT INTO e484a.order_item_quantity_summary VALUES
  (11,0,0,0),          -- none
  (21,2,0,0),          -- ordered
  (31,2,2,0),          -- instock
  (41,2,2,2),          -- shipped
  (61,2,0,0),(62,0,0,0); -- 一件訂滿一件沒訂 ⇒ 訂單層必須退回 none

CREATE VIEW e484a.v AS
SELECT o.*, (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM e484a.order_items oi WHERE oi.order_id = o.id) THEN 'none'
    WHEN (SELECT bool_and(COALESCE(s.shipped_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'shipped'
    WHEN (SELECT bool_and(COALESCE(s.instock_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'instock'
    WHEN (SELECT bool_and(COALESCE(s.ordered_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'ordered'
    ELSE 'none' END) AS goods_axis
FROM e484a.orders o;

SELECT display_id AS 期望, goods_axis AS 實際,
       CASE WHEN display_id = goods_axis OR (display_id='zero-items' AND goods_axis='none')
                 OR (display_id='partial-ordered' AND goods_axis='none') THEN 'PASS' ELSE 'FAIL' END AS 判定
FROM e484a.v ORDER BY id;
EOF

cat /tmp/484a-t3.out
T3FAIL=$(grep -c 'FAIL' /tmp/484a-t3.out || true); T3PASS=$(grep -c 'PASS' /tmp/484a-t3.out || true)
[ "$T3FAIL" = "0" ] || fail "T3 oracle 有 $T3FAIL 格 FAIL"
[ "$T3PASS" = "6" ] || fail "T3 應有 6 格 PASS,實得 $T3PASS(格數不對 = 沒跑完或多跑)"

echo
echo "── T4 突變:把判序倒過來(先問 ordered)⇒ shipped 那筆必須變錯 ──"
psql "$D" -q -v ON_ERROR_STOP=1 > /tmp/484a-t4.out 2>&1 <<'EOF'
CREATE VIEW e484a.v_mut AS
SELECT o.*, (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM e484a.order_items oi WHERE oi.order_id = o.id) THEN 'none'
    WHEN (SELECT bool_and(COALESCE(s.ordered_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'ordered'
    WHEN (SELECT bool_and(COALESCE(s.instock_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'instock'
    WHEN (SELECT bool_and(COALESCE(s.shipped_quantity,0) >= oi.quantity) FROM e484a.order_items oi
          LEFT JOIN e484a.order_item_quantity_summary s ON s.order_item_id = oi.id WHERE oi.order_id = o.id) THEN 'shipped'
    ELSE 'none' END) AS goods_axis
FROM e484a.orders o;
SELECT display_id AS 期望, goods_axis AS 突變後,
       CASE WHEN display_id <> goods_axis THEN '✅ 這格抓得到判序倒置' ELSE '⚠️ 這格抓不到' END AS 判定
FROM e484a.v_mut WHERE display_id IN ('ordered','instock','shipped') ORDER BY id;
EOF
cat /tmp/484a-t4.out
T4HIT=$(grep -c '抓得到判序倒置' /tmp/484a-t4.out || true)
[ "$T4HIT" = "2" ] || fail "T4 突變應**恰好**抓到 2 格(instock/shipped),實得 $T4HIT"
psql "$D" -q -c "DROP SCHEMA IF EXISTS e484a CASCADE;" 2>&1
echo "T3/T4 收尾:e484a schema 已刪 → 剩 $(q "select count(*) from information_schema.schemata where schema_name='e484a'")"

echo
echo "── 收斂:逐條硬斷言(fail-closed,不是印完就算)───────────────"
# codex 關卡2 must-fix 5:原版只有 set -u、psql 又接 tail ⇒ SQL 失敗或 oracle 印 FAIL 也會 exit 0。
[ "$(q "select count(*) from information_schema.views where table_schema='public' and table_name='admin_order_list_v'")" = "0" ] \
  || fail "T1 後 public 仍留著 admin_order_list_v"
[ "$(q "select count(*) from information_schema.schemata where schema_name='e484a'")" = "0" ] \
  || fail "T3/T4 後 e484a schema 沒清乾淨"
if [ "$FAILS" -ne 0 ]; then echo "❌ 探針失敗 $FAILS 項"; exit 1; fi
echo "✅ 探針全數通過(硬斷言:T1 建/刪 EXIT、T3 六格全 PASS、T4 恰兩格紅、兩項零留痕)"
echo "⚠️ 誠實邊界:本腳本驗的是**這支 SQL 在 Postgres 上的行為**,證不到 PostgREST 的 embed;"
echo "   後者只有 apply 之後問得到(runbook 檢查 1)。"
