#!/usr/bin/env bash
# storefront-search-split-reconcile.sh — 「把搜尋拆三塊之後, 它還是同一個東西嗎?」
# ⟦search-TRGMEXPRIDX⟧ 2026-09-04
#
# ── 🔴 為什麼是【兩張表】的鑽機 ──────────────────────────────────────────────
#    我前一支探針(`trgm-index-attribution-probe.sh`)用**一個表**,
#    而主視窗在正式站量到**第二個殺手**:`b.name` 是【JOIN 進來的另一張表】的欄位,
#    一個 OR 裡混進跨表欄位 ⇒ planner 只能先 join 再過濾 ⇒ products 的索引全用不到。
#    🛑 **⇒ 那個形狀在「一個表」的世界裡【造不出來】** —— 不是我量錯, 是世界少一樣東西。
#    ⇒ 📌 而它印的綠是誠實的。**這支檔就是把那個缺口補上。**
#
# ── 🎯 它驗的不是效能, 是【拆完之後語意有沒有變】 ────────────────────────────
#    今天的語意:`HAVING count(DISTINCT t.ord) = n.want`
#      = **每一個【詞】都要中(AND)· 而一個詞可以靠【任何一欄】中(OR)**
#      ⇒ 🔴🔴 而那個 OR 是逐【(商品, 詞) 配對】判的, **不是逐商品判的**。
#    ⇒ ⇒ 拆三塊之後, `UNION` 必須發生在 (商品, 詞) 那一層。搬到商品那一層就錯。
#
# ── 🔴🔴 而本檔真正的重點是【分母】, 不是那些 EXCEPT ─────────────────────────
#    對帳若只餵**單詞**、或**同一塊就能中的多詞** ⇒ 對的拆法與錯的拆法
#    **印一模一樣的空集合** ⇒ 零判別力。
#    ✅ 唯一會紅的形狀:**兩個詞, 而它們【必須】分屬不同塊**。
#    ⇒ 🎯 所以本檔同時建一支**故意拆錯**的函式(`fn_wrong`, 商品層 UNION),
#      並要求:單詞那幾格它**必須也是空的**(= 證明那些格沒有判別力),
#              跨塊那幾格它**必須紅**(= 證明這把尺會分辨)。
#    ⇒ ⇒ 📌 **少了 fn_wrong, 這支檔全綠而它可能什麼都沒在量。**
#
# 用法:bash scripts/storefront-search-split-reconcile.sh
#   0 = 拆法等價且尺會分辨 · 1 = 有格沒過(細節在輸出)· 2 = 我自己壞了(起不了 PG)
set -uo pipefail
export LC_ALL=C LANG=C
command -v initdb >/dev/null && command -v psql >/dev/null || { echo "🔴 缺 postgres CLI ⇒ ENV-FAIL"; exit 2; }
PORT="${PGPORT:-55572}"; D=/tmp/pcm-splitrec-$$
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $PORT 被佔 ⇒ 給 PGPORT"; exit 2; }
mkdir -p "$D" || exit 2
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗 ⇒ $D/initdb.log"; exit 2; }
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 pg_ctl 失敗 ⇒ $D/pg.log"; exit 2; }
sleep 3
cleanup(){ pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
q(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -c "$1" 2>&1; }
q "select 1" >/dev/null || { echo "🔴 連不上埠 $PORT ⇒ ENV-FAIL(這不是結論)"; exit 2; }

psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 > "$D/build.log" 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE brands(id uuid primary key default gen_random_uuid(), name text);
INSERT INTO brands(name) VALUES ('AKRAPOVIČ'),('Öhlins'),('Brembo'),('Rizoma');
INSERT INTO brands(name) SELECT 'BRAND-' || g FROM generate_series(1,21) g;

CREATE TABLE products_public(
  id uuid primary key default gen_random_uuid(),
  title text, subtitle text, description text, external_id text, brand_id uuid);
INSERT INTO products_public(title, subtitle, description, external_id, brand_id)
SELECT '通用零件 ' || g, '副標 ' || g, '說明 ' || g, 'PN-' || g,
       (SELECT id FROM brands WHERE name = 'BRAND-' || (1 + g % 21))
FROM generate_series(1, 4000) g;

-- 🔴 三顆**刻意造的**商品 —— 每一顆對應一個「跨塊」的世界
--    ① 品牌塊 + 四欄塊:標題有「排氣管」而品牌是 AKRAPOVIČ ⇒ 兩個詞分屬兩塊
INSERT INTO products_public(title, subtitle, description, external_id, brand_id)
VALUES ('排氣管 全段', '副標', '說明', 'EXH-1', (SELECT id FROM brands WHERE name='AKRAPOVIČ'));
--    ② 料號塊 + 四欄塊:標題有「碳纖維」而料號存成 `FCAP-06`(帶連字號)
--       ⇒ 搜 `fcap06`(不帶連字號)時, **四欄的 ILIKE 中不了**, 只有正規化那塊中得了
INSERT INTO products_public(title, subtitle, description, external_id, brand_id)
VALUES ('碳纖維前土除蓋', '副標', '說明', 'FCAP-06', (SELECT id FROM brands WHERE name='Brembo'));
--    ③ 只有品牌中的:標題完全不含品牌字
--    ④ 🔴 給【DISTINCT 突變】用的:標題裡就有自己的品牌名
--       ⇒ 搜 `akrapovic` 時, 四欄塊(title)與品牌塊 **同一個 (商品, 詞) 各吐一次**
INSERT INTO products_public(title, subtitle, description, external_id, brand_id)
VALUES ('AKRAPOVIČ 全段排氣', '副標', '說明', 'AKR-9', (SELECT id FROM brands WHERE name='AKRAPOVIČ'));
INSERT INTO products_public(title, subtitle, description, external_id, brand_id)
VALUES ('尾殼', '副標', '說明', 'TAIL-1', (SELECT id FROM brands WHERE name='Öhlins'));

CREATE INDEX pp_title ON products_public USING gin (title extensions.gin_trgm_ops);
CREATE INDEX pp_sub   ON products_public USING gin (subtitle extensions.gin_trgm_ops);
CREATE INDEX pp_desc  ON products_public USING gin (description extensions.gin_trgm_ops);
CREATE INDEX pp_ext   ON products_public USING gin (external_id extensions.gin_trgm_ops);
ANALYZE brands; ANALYZE products_public;

-- ══ ① 現況那支(五欄 OR 含 b.name + 料號分支)· 逐字照 20260903230000:196-247 的形狀 ══
CREATE FUNCTION fn_old(p_terms text[]) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $fn$
  WITH t AS (SELECT DISTINCT ON (term) term, ord
               FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
              WHERE btrim(term) <> ''),
       n AS (SELECT count(*)::bigint AS want FROM t)
  SELECT p.id FROM products_public p
    LEFT JOIN brands b ON b.id = p.brand_id
    CROSS JOIN n
    JOIN t ON (
         p.title       ILIKE '%'||replace(replace(replace(t.term,'\','\\'),'%','\%'),'_','\_')||'%'
      OR p.subtitle    ILIKE '%'||replace(replace(replace(t.term,'\','\\'),'%','\%'),'_','\_')||'%'
      OR p.description ILIKE '%'||replace(replace(replace(t.term,'\','\\'),'%','\%'),'_','\_')||'%'
      OR p.external_id ILIKE '%'||replace(replace(replace(t.term,'\','\\'),'%','\%'),'_','\_')||'%'
      OR b.name        ILIKE '%'||replace(replace(replace(t.term,'\','\\'),'%','\%'),'_','\_')||'%'
      OR ( t.term ~ '[0-9]' AND t.term ~ '[A-Za-z]'
           AND upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')) <> ''
           AND upper(regexp_replace(p.external_id,'[^A-Za-z0-9]','','g'))
               LIKE upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g'))||'%' ))
   WHERE n.want > 0 AND p.id IS NOT NULL
   GROUP BY p.id, n.want
  HAVING count(DISTINCT t.ord) = n.want;
$fn$;

-- ══ ② 新案:三塊, 而 UNION 在【(商品, 詞)】那一層 ══
CREATE FUNCTION fn_new(p_terms text[]) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $fn$
  -- 🔴 `pat` = 逃脫後的完整 LIKE 樣式, **在 `t` 裡算一次**。
  --    三層 replace 的順序有意義(先 `\` 再 `%` 再 `_`)⇒ 抄成三份 = 三份會各自漂。
  --    ⇒ ✅ 而抽成 CTE 欄位是**零新 DB 物件**的一處定義(抽成 SQL 函式要 GRANT/REVOKE/審查)。
  WITH t AS (SELECT DISTINCT ON (term) term, ord,
                    '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' AS pat
               FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
              WHERE btrim(term) <> ''),
       n AS (SELECT count(*)::bigint AS want FROM t),
       -- ② 品牌:brands 只有 25 列 ⇒ 這一發免費, 而它讓 products 那一半不被跨表 OR 拖下水
       bh AS (SELECT t.ord, br.id AS brand_id FROM brands br JOIN t ON br.name ILIKE t.pat),
       hits AS (
         -- ① 四欄 OR ⇒ 🟢 純 products 欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
         SELECT p.id, t.ord FROM products_public p JOIN t ON (
              p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
           OR p.description ILIKE t.pat OR p.external_id ILIKE t.pat)
         UNION ALL
         SELECT p.id, bh.ord FROM products_public p JOIN bh ON p.brand_id = bh.brand_id
         UNION ALL
         -- ③ 料號:兩端正規化比前綴。三個條件缺一不可(理由見 20260903230000 檔內註解)
         SELECT p.id, t.ord FROM products_public p JOIN t ON (
              t.term ~ '[0-9]' AND t.term ~ '[A-Za-z]'
          AND upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')) <> ''
          AND upper(regexp_replace(p.external_id,'[^A-Za-z0-9]','','g'))
              LIKE upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g'))||'%'))
  SELECT h.id FROM hits h CROSS JOIN n
   WHERE n.want > 0
   GROUP BY h.id, n.want
  -- 🔴🔴 **`DISTINCT` 在這裡從【可省】變成【承重】。**
  --    今天(單一 JOIN)一個 (商品, 詞) 只出現一次 ⇒ 寫 `count(ord)` 也會對。
  --    🛑 而 UNION ALL 之後同一對會從多塊各來一次 ⇒ `count(ord)` **會多算** ⇒ `= want` 不成立
  --       ⇒ 🔴 **那一列被【丟掉】** —— 方向是【變窄】不是放寬:客人打料號會拿到 0 筆。
  --    ⇒ 📌 而它在改之前看起來像冗贅 ⇒ 本檔用 `fn_new_nodistinct` 把它釘成一格會紅的東西。
  HAVING count(DISTINCT h.ord) = n.want;
$fn$;

-- ══ ④ 🔴 突變常駐:把上面那個 DISTINCT 拿掉 ══
--    它**不是**筆誤, 它是「那個關鍵字今天有沒有在承重」的量具。
CREATE FUNCTION fn_new_nodistinct(p_terms text[]) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $fn$
  WITH t AS (SELECT DISTINCT ON (term) term, ord,
                    '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' AS pat
               FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
              WHERE btrim(term) <> ''),
       n AS (SELECT count(*)::bigint AS want FROM t),
       bh AS (SELECT t.ord, br.id AS brand_id FROM brands br JOIN t ON br.name ILIKE t.pat),
       hits AS (
         SELECT p.id, t.ord FROM products_public p JOIN t ON (
              p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
           OR p.description ILIKE t.pat OR p.external_id ILIKE t.pat)
         UNION ALL
         SELECT p.id, bh.ord FROM products_public p JOIN bh ON p.brand_id = bh.brand_id
         UNION ALL
         SELECT p.id, t.ord FROM products_public p JOIN t ON (
              t.term ~ '[0-9]' AND t.term ~ '[A-Za-z]'
          AND upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')) <> ''
          AND upper(regexp_replace(p.external_id,'[^A-Za-z0-9]','','g'))
              LIKE upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g'))||'%'))
  SELECT h.id FROM hits h CROSS JOIN n
   WHERE n.want > 0 GROUP BY h.id, n.want
  HAVING count(h.ord) = n.want;
$fn$;

-- ══ ③ 🔴 故意拆【錯】的:UNION 搬到【商品】那一層 ══
--    這不是筆誤, 它是本檔的正對照。少了它, 上面的 EXCEPT 可能什麼都沒在量。
CREATE FUNCTION fn_wrong(p_terms text[]) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $fn$
  WITH t AS (SELECT DISTINCT ON (term) term, ord
               FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
              WHERE btrim(term) <> ''),
       n AS (SELECT count(*)::bigint AS want FROM t),
       a AS (SELECT p.id FROM products_public p CROSS JOIN n JOIN t ON (
              p.title       ILIKE '%'||t.term||'%' OR p.subtitle ILIKE '%'||t.term||'%'
           OR p.description ILIKE '%'||t.term||'%' OR p.external_id ILIKE '%'||t.term||'%')
             WHERE n.want > 0 GROUP BY p.id, n.want HAVING count(DISTINCT t.ord) = n.want),
       b AS (SELECT p.id FROM products_public p JOIN brands br ON br.id = p.brand_id
             CROSS JOIN n JOIN t ON br.name ILIKE '%'||t.term||'%'
             WHERE n.want > 0 GROUP BY p.id, n.want HAVING count(DISTINCT t.ord) = n.want),
       c AS (SELECT p.id FROM products_public p CROSS JOIN n JOIN t ON (
              t.term ~ '[0-9]' AND t.term ~ '[A-Za-z]'
          AND upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')) <> ''
          AND upper(regexp_replace(p.external_id,'[^A-Za-z0-9]','','g'))
              LIKE upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g'))||'%')
             WHERE n.want > 0 GROUP BY p.id, n.want HAVING count(DISTINCT t.ord) = n.want)
  SELECT id FROM a UNION SELECT id FROM b UNION SELECT id FROM c;
$fn$;
SQL
[ $? -eq 0 ] || { echo "🔴 建鑽機失敗 ⇒ $D/build.log"; tail -5 "$D/build.log"; exit 2; }

PASS=0; FAIL=0
ok(){ printf '  %-40s ⇒ ✅ %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad(){ printf '  %-40s ⇒ 🔴 %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
# 兩支的對稱差集(兩個方向), 回總筆數
diff2(){ q "SELECT (SELECT count(*) FROM (SELECT id FROM $1($3) EXCEPT SELECT id FROM $2($3)) x)
              + (SELECT count(*) FROM (SELECT id FROM $2($3) EXCEPT SELECT id FROM $1($3)) y)"; }
cnt(){ q "SELECT count(*) FROM $1($2)"; }

# ── 分母:前四格【同一塊就能中】· 後兩格【必須跨塊】────────────────────────
# 🔴 詞用 `akrapov` 不是 `akrapovic` —— 品牌名是 `AKRAPOVIČ`(帶抑揚符),
#    而 SQL 的 ILIKE **不折變音符號**(折的那一層在 TS `foldSearchTerm`)。
#    ⚠️ 我第一版寫 `akrapovic` ⇒ 跨塊那兩格 old/new/WRONG **全部回 0** ⇒ 三支印同一個空集合
#    ⇒ 🛑 而那看起來像「等價通過」—— 抓到它的是 ③ 那一格(「那顆商品要找得到」), 不是 ①②。
#    ⇒ 📌 **fixture 造不出世界時, 對帳型的檢查【全部】變成恆真。**
SAME=( "ARRAY['碳纖維']" "ARRAY['akrapov']" "ARRAY['fcap06']" "ARRAY['排氣管','全段']" )
CROSS=( "ARRAY['akrapov','排氣管']" "ARRAY['fcap06','碳纖維']" )
EDGE=( "ARRAY[]::text[]" "ARRAY['   ']" "ARRAY['碳纖維','碳纖維']" "NULL::text[]" )

echo "🔬 拆三塊 · 語意對帳(兩張表鑽機 · 埠 $PORT · 4,003 商品 / 25 品牌)"
echo
echo "── ① 新舊等價:每一格【兩個方向】的差集都要是 0 ──"
for a in "${SAME[@]}" "${CROSS[@]}" "${EDGE[@]}"; do
  d=$(diff2 fn_old fn_new "$a")
  [ "$d" = "0" ] && ok "old vs new $a" "差集 0" || bad "old vs new $a" "差集 $d 筆 ⇒ 語意變了"
done
echo
echo "── ② 🔵 這把尺會不會分辨(拿【故意拆錯】那支當正對照)──"
echo "     🛑 前四格【該是 0】—— 那正是它們【沒有判別力】的證明, 不是它們通過了"
for a in "${SAME[@]}"; do
  d=$(diff2 fn_old fn_wrong "$a")
  [ "$d" = "0" ] && ok "old vs WRONG $a" "差集 0 ⇒ 這一格對錯拆法【看不出來】" \
                 || ok "old vs WRONG $a" "差集 $d(這一格意外也有判別力)"
done
echo "     🔴 後兩格【必須紅】—— 少了它們, 上面全部的 0 都不算數"
for a in "${CROSS[@]}"; do
  d=$(diff2 fn_old fn_wrong "$a")
  if [ "$d" != "0" ] && [ -n "$d" ]; then ok "old vs WRONG $a" "差集 $d 筆 ⇒ 尺抓得到錯拆法"
  else bad "old vs WRONG $a" "差集 0 ⇒ **這把尺對錯的拆法也說通過** ⇒ ① 全部不算數"; fi
done
echo
echo "── ③ 那三顆刻意造的商品, 新案真的要找得到 ──"
for a in "${CROSS[@]}"; do
  c=$(cnt fn_new "$a")
  [ "$c" -ge 1 ] 2>/dev/null && ok "fn_new $a" "$c 筆" || bad "fn_new $a" "0 筆 ⇒ 跨塊那顆掉了"
done
echo
echo "── ④ 🔴 常駐突變:把 HAVING 的 DISTINCT 拿掉 ⇒ 必須有一格紅 ──"
echo "     🛑 而**會紅的是【另一組】輸入** —— 同一個 (商品, 詞) 從兩塊各來一次的那種"
echo "        ⇒ 📌 兩個突變, 兩組不同的判別輸入。一組守不住另一組。"
DUP=( "ARRAY['FCAP-06']" "ARRAY['akrapov']" )
DHIT=0
for a in "${DUP[@]}"; do
  d=$(diff2 fn_new fn_new_nodistinct "$a")
  if [ "$d" != "0" ] && [ -n "$d" ]; then ok "去掉 DISTINCT $a" "差 $d 筆 ⇒ 那個關鍵字在承重"; DHIT=$((DHIT+1))
  else printf '  %-40s ⇒ ⚪ %s\n' "去掉 DISTINCT $a" "差 0 ⇒ 這一格分辨不出來"; fi
done
[ "$DHIT" -ge 1 ] && ok "DISTINCT 突變總結" "$DHIT/${#DUP[@]} 格抓到" \
  || bad "DISTINCT 突變總結" "**一格都沒抓到** ⇒ 那個 DISTINCT 今天沒有守門, 只有註解"
echo
echo "── ⑤ 🔵 這個鑽機造得出【跨表 OR 殺掉索引】那個形狀嗎(主視窗正式站量到的第二個殺手)──"
snap(){ q "select coalesce(sum(idx_scan),0) from pg_stat_user_indexes where indexrelname like 'pp_%'"; }
idx(){ local b a; b=$(snap); psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -c "SET enable_seqscan=off; SELECT * FROM $1(ARRAY['碳纖維'])" >/dev/null 2>&1; sleep 1; a=$(snap); echo $((a-b)); }
IO=$(idx fn_old); IN=$(idx fn_new)
[ "$IO" = "0" ] && ok "fn_old(含 b.name 跨表 OR)" "trgm +0 ⇒ 這個世界【重現得出】那個殺手" \
                || bad "fn_old(含 b.name 跨表 OR)" "trgm +$IO ⇒ **本鑽機造不出那個形狀** ⇒ ⑤ 這一族的結論不算數"
[ "$IN" -ge 1 ] 2>/dev/null && ok "fn_new(三塊拆開)" "trgm +$IN ⇒ 拆完吃得到索引" \
                || bad "fn_new(三塊拆開)" "trgm +$IN ⇒ 拆完仍吃不到 ⇒ 這個拆法沒買到東西"

echo
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
echo "🛑 射程:本檔驗【語意等價】, 不驗效能 —— 4,003 列太小, 計時沒有判別力。"
echo "   正式站快多少要那邊的 EXPLAIN ANALYZE, 而本窗沒有那個權限。"
[ "$FAIL" -eq 0 ] || exit 1
