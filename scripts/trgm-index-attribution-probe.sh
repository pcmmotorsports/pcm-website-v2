#!/usr/bin/env bash
# trgm-index-attribution-probe.sh — 「是【誰】讓中文搜尋用不到 trgm 索引?」
# ⟦search-TRGMEXPRIDX⟧ 2026-09-04
#
# ── 🔴🔴 這支檔存在的理由是【我用一個壞掉的量測推翻了一個對的結論】 ──────────
#    2026-09-04 凌晨我量到「文字支函式也 +0」⇒ 我據此宣告「擋住 trgm 的是**函式外殼**」,
#    並**逐條收回**了我原本(正確的)歸因「是料號那條無索引 OR 分支」。
#    🛑 而那一發的 fixture 是我先前自己記過的**被汙染的那一份**(碳纖維命中 22,699/22,804)
#      ⇒ 那個世界裡 **seq scan 本來就是正解** ⇒ 那個 +0 **誠實、而它答的是另一個問題**。
#    ⇒ 📌 **尺是好的, 世界是壞的** —— 而它通過了我當時所有的自檢, 因為自檢只驗尺。
#    ⇒ ⇒ 🎯 **所以本檔的重點不是那個答案, 是【把嫌疑犯一個一個分開】的那個做法。**
#
# ── 🔵 它怎麼分辨 ────────────────────────────────────────────────────────
#    七格, 而它們兩兩之間**只差一樣東西**:
#      A 裸述詞字面 → B 值改從 unnest 的列來 → C 包進 sql 函式(純量參數)
#      → D 函式 + unnest → E 函式 + unnest + OR(兩條文字)
#      → 🎯 G 同上再加【料號那條無索引分支】   ← 只有這一步 +N 掉到 0
#      → 🔵 F 負對照(主鍵查詢, 不該碰 trgm)   ← 少了它, 全部的 0 都不算數
#    🛑 fixture 刻意讓目標詞**只命中 1 列** —— 那樣索引是【自然解】,
#      而不是被 enable_seqscan=off 逼出來的。汙染的 fixture 就是這樣騙過我的。
#
# ── ⚠️ 射程(不要弱化)────────────────────────────────────────────────────
#    · 合成鑽機:一個表 · 兩支 trgm 索引 · 22,800 列。**不是 PCM 真 schema。**
#    · ✅ 它證得了【機制】:一條無索引的 OR 分支會讓整個 BitmapOr 倒掉。
#    · 🛑 它**證不了**效能:這台太小, 含/不含料號分支計時 14.6ms vs 12.4ms **分不出來**。
#      ⇒ 📌 「拿掉之後中文會變快」今天仍然是【推的】, 要正式站 EXPLAIN 才算量到, 而我沒有那個權限。
#    · 🔵 `search_path` 已在【正式站】排除:pg_proc.proconfig = NULL(2026-09-04 唯讀連線實查)。
#
# 用法:bash scripts/trgm-index-attribution-probe.sh
#      PGPORT=55540 bash …            # 用已經起好的鑽機
#      三個世界:0 = 料號分支確為成因 · 1 = 不是(結論要重寫)· 2 = 我自己壞了(起不了 PG)
set -uo pipefail
export LC_ALL=C LANG=C
command -v initdb >/dev/null && command -v psql >/dev/null || { echo "🔴 缺 postgres CLI ⇒ ENV-FAIL"; exit 2; }

PORT="${PGPORT:-}"
OWNED=0
if [ -z "$PORT" ]; then
  PORT=55571; D=/tmp/pcm-trgmprobe-$$
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $PORT 被佔 ⇒ 給 PGPORT 或收攤別人的"; exit 2; }
  mkdir -p "$D" || exit 2
  initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗, 看 $D/initdb.log"; exit 2; }
  pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1 || { echo "🔴 pg_ctl 失敗, 看 $D/pg.log"; exit 2; }
  OWNED=1; sleep 3
fi
q(){ psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -c "$1" 2>/dev/null; }
q "select 1" >/dev/null || { echo "🔴 連不上埠 $PORT ⇒ ENV-FAIL(這【不是】結論, 是我自己量不到)"; exit 2; }

q "CREATE SCHEMA IF NOT EXISTS extensions" >/dev/null
q "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions" >/dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -q >/dev/null 2>&1 <<'SQL'
DROP TABLE IF EXISTS trgmprobe CASCADE;
CREATE TABLE trgmprobe(id serial primary key, name_zh text, name_en text, external_id text);
INSERT INTO trgmprobe(name_zh, name_en, external_id)
SELECT '通用零件 ' || g || ' 樣式甲乙丙', 'generic part ' || g, 'PN-' || g FROM generate_series(1, 22799) g;
INSERT INTO trgmprobe(name_zh, name_en, external_id) VALUES ('碳纖維前土除蓋', 'carbon fender', 'PN-0');
CREATE INDEX trgmprobe_zh ON trgmprobe USING gin (name_zh extensions.gin_trgm_ops);
CREATE INDEX trgmprobe_en ON trgmprobe USING gin (name_en extensions.gin_trgm_ops);
ANALYZE trgmprobe;
CREATE OR REPLACE FUNCTION pf_scalar(v text) RETURNS SETOF int LANGUAGE sql STABLE AS $f$
  SELECT id FROM trgmprobe WHERE name_zh ILIKE '%' || v || '%'; $f$;
CREATE OR REPLACE FUNCTION pf_unnest(v text[]) RETURNS SETOF int LANGUAGE sql STABLE AS $f$
  WITH terms AS (SELECT unnest(v) AS term)
  SELECT t.id FROM trgmprobe t JOIN terms ON t.name_zh ILIKE '%' || terms.term || '%'; $f$;
CREATE OR REPLACE FUNCTION pf_or(v text[]) RETURNS SETOF int LANGUAGE sql STABLE AS $f$
  WITH terms AS (SELECT unnest(v) AS term)
  SELECT t.id FROM trgmprobe t JOIN terms ON (
       t.name_zh ILIKE '%' || terms.term || '%' OR t.name_en ILIKE '%' || terms.term || '%'); $f$;
CREATE OR REPLACE FUNCTION pf_or_partno(v text[]) RETURNS SETOF int LANGUAGE sql STABLE AS $f$
  WITH terms AS (SELECT unnest(v) AS term)
  SELECT t.id FROM trgmprobe t JOIN terms ON (
       t.name_zh ILIKE '%' || terms.term || '%' OR t.name_en ILIKE '%' || terms.term || '%'
    OR ( terms.term ~ '[0-9]' AND terms.term ~ '[A-Za-z]'
         AND upper(regexp_replace(t.external_id,'[^A-Za-z0-9]','','g'))
             LIKE upper(regexp_replace(terms.term,'[^A-Za-z0-9]','','g')) || '%' )); $f$;
SQL

snap(){ q "select coalesce(sum(idx_scan),0) from pg_stat_user_indexes where indexrelname in ('trgmprobe_zh','trgmprobe_en')"; }
LAST=0
probe(){ # $1 標籤  $2 SQL
  local b a
  b=$(snap)
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -c "SET enable_seqscan=off; $2" >/dev/null 2>&1
  sleep 1
  a=$(snap); LAST=$((a-b))
  printf '  %-44s ⇒ trgm idx_scan **+%s**\n' "$1" "$LAST"
}

echo "🔬 trgm 索引歸因探針 · 埠 $PORT · 22,800 列 · 目標詞只命中 1 列"
echo "   (每一格與上一格【只差一樣東西】)"
echo
probe "A 裸述詞 · 字面"                  "SELECT id FROM trgmprobe WHERE name_zh ILIKE '%碳纖維%'";                        A=$LAST
probe "B 裸句 · 值從 unnest 的列來"      "WITH s AS (SELECT unnest(ARRAY['碳纖維']) term) SELECT t.id FROM trgmprobe t JOIN s ON t.name_zh ILIKE '%'||s.term||'%'"
probe "C 函式 · 純量參數"                "SELECT * FROM pf_scalar('碳纖維')"
probe "D 函式 · unnest 列值"             "SELECT * FROM pf_unnest(ARRAY['碳纖維'])"
probe "E 函式 · unnest + OR(兩條文字)"  "SELECT * FROM pf_or(ARRAY['碳纖維'])";                                           E=$LAST
probe "🎯 G 同上 + 【料號那條無索引分支】" "SELECT * FROM pf_or_partno(ARRAY['碳纖維'])";                                    G=$LAST
probe "🔵 F 負對照 · 主鍵(不該碰 trgm)" "SELECT id FROM trgmprobe WHERE id = 5";                                          F=$LAST
echo
N1=$(q "select count(*) from pf_or_partno(ARRAY['碳纖維'])"); N2=$(q "select count(*) from pf_or_partno(ARRAY['PN-5'])")
echo "  正確性:含料號那支 · 碳纖維 ⇒ $N1 列(期望 1) · PN-5 ⇒ $N2 列(期望 1111 = 1+10+100+1000 前綴數學)"
echo
RC=0
if [ "$F" -ne 0 ]; then
  echo "🔴 負對照沒過(主鍵查詢也 +$F)⇒ **上面每一個 0 都不算數**, 這把尺對什麼都說有"; RC=1
elif [ "$A" -lt 1 ]; then
  echo "🔴 正對照沒過(裸述詞都用不到索引)⇒ **世界沒造出來**, 不是結論"; RC=1
elif [ "$E" -ge 1 ] && [ "$G" -eq 0 ]; then
  echo "✅ 成因 = 【料號那條無索引 OR 分支】:同一支函式, 加上它 ⇒ $E ⇒ 0"
  echo "   ⇒ 🎯 函式殼 / plpgsql / 參數 / unnest 列值 **四個嫌疑犯都不是**(A-E 全 ≥1)"
else
  echo "🔴 沒重現(E=$E · G=$G)⇒ **結論要重寫, 不要照舊引用** —— 而這正是本檔上一版死掉的方式"; RC=1
fi
echo "🛑 射程:本檔證【機制】不證【效能】。正式站快多少要 EXPLAIN, 而這裡沒有那個權限。"
[ "$OWNED" -eq 1 ] && { pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1; rm -rf "$D"; }
exit "$RC"
