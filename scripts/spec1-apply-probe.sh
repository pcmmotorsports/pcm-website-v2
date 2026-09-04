#!/usr/bin/env bash
# ⟦b4-SPEC1⟧ · 那支 migration 跑得起來嗎, 而它的斷言殺得死突變嗎
#
# 🔴 它在答哪一個問句:
#   問句 A(權威 spec 有沒有被抄進去)⇒ 一個 grep 就答得了, 不需要 PG
#   問句 B(它【跑得起來】, 而四個世界的行為對, 而斷言【殺得死突變】)⇒ 🔴 本檔在答這一個
#
# ⚠️ 射程(照實寫, 不放寬):
#   · 函式逐字從 20260829140000 抽, 新 migration 整支逐字跑
#   · 🔴 而它委給的表(orders / order_items / product_variants / customers …)是【替身】
#     —— 只建到讓這支函式跑得完的最小形狀。⇒ **本檔不驗那些表的真實約束。**
#   · 🔴 本機 PG 不是正式庫 ⇒ **「這裡 apply 成功」≠「正式庫 apply 會成功」**。apply 是 Sean 的手。
#
# ══ 🛑🛑 本檔【證明不了】的那一格 —— codex R3 逐字, 原樣保留 ══════════════════
#   「fixture 自己放進正確的紅色, probe 只證明它被**成功複製** ——
#    **零證據證明正式資料的語意／來源／新鮮度正確;證明的是「忠實抄寫」, 不是「抄到真相」。**」
#
#   📌 ⇒ 這是本片的【前提】不是缺陷 —— 而**前提沒寫下來就會變成無條件的**。
#   🔴 而 2026-08-31 正式庫實跑把它從抽象變成一個數:
#      54,000 列裡 **13,112 列(24%)的 spec 是 `{}`**, 其中**有貨的 10,786 列**。
#      ⇒ 對那些列, 本片會用 `{}` 蓋掉員工手打的規格, **而員工看不到**(見世界 E)。
#   🔴🔴 而本檔還有一種【演了也沒用】的錯:**替身的 schema 是我照「我以為的」建的**
#      ⇒ 兩個世界都站在同一個錯的前提上 ⇒ 它們一致, 而**一致的是那個錯**。
#      (實例:同日我寫了一支查詢用 `delisted_at`, 而那個欄根本不在 `product_variants` 上 ——
#       它在 `products`;兩個欄在同一支 migration 隔 13 行, 而去了不同的表。)
#      ⇒ **可執行:要對正式庫跑的查詢, 先撈 `information_schema.columns` 對一次真欄位名, 帶負對照。**
# 🔴 REPO 從腳本自己的位置推(本檔在 scripts/ ⇒ 一層), 不寫死。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GEN2="$REPO/supabase/migrations/20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql"
NEW="$REPO/supabase/migrations/20260831180000_m4b_spec1_manual_order_authoritative_spec.sql"
D=/tmp/spec1-probe
PORT=5621
EXPECT='pre-gate apply worldA worldB worldC worldD worldE worldF pos-ctl rerun rollback mut-M1 mut-M2 mut-M3 mut-M4 sources-untouched'

# ══ 🔴 來源檔零留痕:**先量, 不是先宣稱** ═════════════════════════════════════
#   本 harness 的設計是「讀來源檔 → 把突變寫到 /tmp 的副本 → 餵那份副本」
#   ⇒ **來源檔從頭到尾只被讀。**
#   🛑 而上面那句是【設計意圖】—— 它與「今天真的沒被寫到」是兩個宣稱。
#      一個 `sed -i` 打錯目標、一個未來被加進來的 `>`,都會讓那句話變成假的,
#      **而它變假的那一天, 沒有任何東西會叫。**
#   ⇒ 📌 **這不是新教訓, 是既有那一條的一個特例** —— 不在這裡重寫全文:
#        · `memory/feedback_mutation-harness-needs-both-pre-and-post-checks.md`
#          逐字要求兩道獨立檢查, 而**後置那一道問的正是「上一發真的還原乾淨了嗎(檔案與環境狀態)」**
#        · `docs/patterns/mutation-harness-restore.md`:病灶不是「忘了還原」,
#          是**用一個會殺掉還原的方式跑它** ⇒ 那不是提醒防得了的, 要量。
#      🔵 本格加的只有一句特化:**「設計上不會寫」也算一種還原宣稱, 而它一樣要被量。**
#   ⇒ 開跑前記兩支的 sha256, 跑完再比一次(見檔尾 `sources-untouched` 那一格)。
SHA(){ python3 -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"; }
SHA_GEN2_BEFORE=$(SHA "$GEN2")
SHA_NEW_BEFORE=$(SHA "$NEW")

for c in initdb pg_ctl psql python3; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL(不是紅)"; exit 2; }
done
[ "${1:-}" = "--fresh" ] && rm -rf "$D"
[ -e "$D" ] && { echo "🔴 $D 已存在 ⇒ ENV-FAIL。連跑兩發請帶 --fresh"; exit 2; }
for f in "$GEN2" "$NEW"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; exit 2; }; done

PASS=0; FAIL=0; SLOTS=""
ok(){ printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); SLOTS="$SLOTS $1"; }
bad(){ printf '  🔴 %s\n' "$2"; FAIL=$((FAIL+1)); SLOTS="$SLOTS $1"; }
cleanup(){ pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT
mkdir -p "$D"
Q(){ psql -h 127.0.0.1 -p $PORT -U postgres -tAc "$1" 2>&1; }

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" >/dev/null 2>&1
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start > "$D/pgctl.log" 2>&1 || { echo "🔴 pg_ctl start 失敗 ⇒ ENV-FAIL"; tail -5 "$D/pg.log"; exit 2; }
sleep 3
SEEN=$(Q "show data_directory" | tr -d '[:space:]'); WANT=$(cd "$D/data" && pwd -P)
[ "$(cd "$SEEN" 2>/dev/null && pwd -P)" = "$WANT" ] || { echo "🔴🔴 我連到的不是我起的那顆 PG ⇒ ENV-FAIL"; exit 2; }
printf '身分驗證 ✅ %s\nPG %s\n\n' "$WANT" "$(Q 'show server_version')"

psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/spec1-fixture.sql" > "$D/fx.log" 2>&1 \
  || { echo "🔴 fixture 建不起來 ⇒ ENV-FAIL"; sed -n 1,8p "$D/fx.log"; exit 2; }

python3 - "$GEN2" > "$D/gen2.sql" <<'PY'
import io,re,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'CREATE OR REPLACE FUNCTION public\.admin_create_manual_order\(.*?\$fn\$;', s, re.S)
assert m, '抽不到 ⇒ 本發作廢'
sys.stdout.write(m.group(0)+'\n')
PY
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/gen2.sql" >/dev/null 2>&1 \
  || { echo "🔴 gen2 裝不起來 ⇒ ENV-FAIL"; exit 2; }
# 🔴 我抽的只有函式本體, 而真檔還有【兩道 REVOKE】(20260824020000:642-643)——
#    在 public 建的函式**出生就把 EXECUTE 給了 PUBLIC** ⇒ 不補的話後置④c 會在替身世界誤紅。
#    📌 而那個紅是【我的替身少一樣東西】不是【被觀察對象壞了】——兩者在畫面上長得一樣。
psql -h 127.0.0.1 -p $PORT -U postgres -q -c "REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) FROM PUBLIC" >/dev/null 2>&1
psql -h 127.0.0.1 -p $PORT -U postgres -q -c "GRANT EXECUTE ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) TO service_role" >/dev/null 2>&1

echo "── ⓪ 前置閘:庫裡是 gen2 ⇒ 本檔應該過 ──"
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" > "$D/apply.log" 2>&1
if [ $? -eq 0 ]; then ok pre-gate "前置閘放行(庫裡確實是 gen2)"; ok apply "apply rc=0(五道後置斷言全過)";
else bad pre-gate "apply 失敗"; bad apply "$(head -3 "$D/apply.log")"; fi

# 🔴 SQL 寫進檔案再餵 —— 內嵌會讓 shell 吃掉 JSON 的雙引號(本檔第一版就是這樣壞的)。
#    而 printf 不用 echo:echo 遇到反斜線序列會停止輸出(CLAUDE.md 那條)。
CALL(){
  printf '%s\n' "select public.admin_create_manual_order(" \
    "'11111111-1111-1111-1111-111111111111'::uuid, gen_random_uuid(), 'probe'," \
    "'manual_phone', 'bank_transfer', 'home'," \
    "'{\"name\":\"A\",\"phone\":\"0900000000\",\"line\":\"x\"}'::jsonb," \
    "'{\"type\":\"personal\",\"requested\":true}'::jsonb, 0," \
    "'$1'::jsonb);" > "$D/call.sql"
  psql -h 127.0.0.1 -p $PORT -U postgres -tA -f "$D/call.sql" >> "$D/calls.log" 2>&1
}
SPEC_OF(){ Q "select oi.product_snapshot->'spec' from public.order_items oi order by oi.ctid desc limit 1"; }

echo ""
echo "── ① 四個世界 ──"
CALL '[{"variant_id":"22222222-2222-2222-2222-222222222222","sku":"SKU-A","title":"A","qty":1,"unit_price":100,"spec":{}}]' >/dev/null
[ "$(SPEC_OF)" = '{"color": "red"}' ] && ok worldA "世界A 送空 spec ⇒ 快照是權威那一份 $(SPEC_OF)" || bad worldA "世界A 得到 $(SPEC_OF)"
CALL '[{"variant_id":"22222222-2222-2222-2222-222222222222","sku":"SKU-A","title":"A","qty":1,"unit_price":100,"spec":{"color":"WRONG"}}]' >/dev/null
[ "$(SPEC_OF)" = '{"color": "red"}' ] && ok worldB "世界B 送錯的 spec ⇒ 仍是權威那一份" || bad worldB "世界B 得到 $(SPEC_OF)"
CALL '[{"sku":"SKU-X","title":"代購","qty":1,"unit_price":50,"spec":{"note":"custom"}}]' >/dev/null
[ "$(SPEC_OF)" = '{"note": "custom"}' ] && ok worldC "世界C 代購(無 variant_id)⇒ 維持呼叫端那一份、不 RAISE" || bad worldC "世界C 得到 $(SPEC_OF)"
# ── 🔴 世界D:codex R1 MF1 那一格 —— 冪等重送, 而期間權威 spec 被改過 ──
#    本檔第一版把權威查詢放在冪等比對【之前】⇒ 指紋跟著可變狀態跑 ⇒ 合法重送被拒。
RID=$(Q "select gen_random_uuid()")
printf '%s\n' "select public.admin_create_manual_order(" \
  "'11111111-1111-1111-1111-111111111111'::uuid, '$RID'::uuid, 'probe'," \
  "'manual_phone', 'bank_transfer', 'home'," \
  "'{\"name\":\"A\",\"phone\":\"0900000000\",\"line\":\"x\"}'::jsonb," \
  "'{\"type\":\"personal\"}'::jsonb, 0," \
  "'[{\"variant_id\":\"22222222-2222-2222-2222-222222222222\",\"sku\":\"SKU-A\",\"title\":\"A\",\"qty\":1,\"unit_price\":100,\"spec\":{}}]'::jsonb);" > "$D/idem.sql"
psql -h 127.0.0.1 -p $PORT -U postgres -tA -f "$D/idem.sql" >> "$D/calls.log" 2>&1
Q "update public.product_variants set spec = '{\"color\":\"blue\"}'::jsonb where id = '22222222-2222-2222-2222-222222222222'::uuid" >/dev/null
R2=$(psql -h 127.0.0.1 -p $PORT -U postgres -tA -f "$D/idem.sql" 2>&1)
case "$R2" in *'"idempotent": true'*) ok worldD "世界D 期間 spec 被改 ⇒ 合法重送仍回既有那張單(指紋沒跟著可變狀態跑)";;
  *) bad worldD "世界D 重送被拒:$(printf '%s' "$R2" | head -1)";; esac
Q "update public.product_variants set spec = '{\"color\":\"red\"}'::jsonb where id = '22222222-2222-2222-2222-222222222222'::uuid" >/dev/null

# ── 🔴 世界E:**目錄那一列的 spec 是空的**, 而員工自己打了規格 ──
#    正式庫實測(主視窗 2026-08-31 唯讀跑):54,000 列裡有 **13,112 列(24%)** 的 spec 是 `{}`
#    ⇒ 這【不是】邊緣情況, 它是四分之一。
Q "insert into public.product_variants (id, spec) values ('33333333-3333-3333-3333-333333333333'::uuid, '{}'::jsonb)" >/dev/null
CALL '[{"variant_id":"33333333-3333-3333-3333-333333333333","sku":"SKU-E","title":"E","qty":1,"unit_price":100,"spec":{"color":"員工打的"}}]' >/dev/null
GOT_E=$(SPEC_OF)
# ══ 🔴🔴 2026-09-01 期望值【翻面】—— Sean 當天拍板推翻了這一格 ═══════════════════
#   ⛔ ~~舊期望:`{}` = PASS(「員工打的那份被丟掉」)~~ **作廢**
#   ✅ 新期望:員工打的那份**留著**。
#   他的原話一個字:「甲」;題目與選項見
#   `~/pcm-mailbox/決策-手動建單目錄沒填規格時用誰的-20260901.md`
#     甲 留員工打的(目錄有填才用目錄的)  ← 他選這個
#     乙 一律用目錄的(目錄空的就寫空的)  ← 舊期望寫的是這個
#   🔴 **而「空」有兩個意思, 他分開答了兩次 —— 本世界測的是第一種**:
#     ① 空的 jsonb `{}`(沒有任何鍵)      ⇒ 留員工打的   (12:0x 原話「甲」)
#     ② 鍵在、值是空字串 `{"color":""}`   ⇒ 用目錄的空白 (12:1x 原話「算有填(用目錄的空白)」)
#   ⇒ 本世界 E 餵的是 `{}` = 第一種;第二種另開**世界F**(緊接在下面)。
#   🔴 **注意:這支檔舊註解裡的「甲」指的是【它自己當時的甲乙編號】, 不是 Sean 的。**
#      ⇒ 兩套編號同一個字, 而它們指相反的東西 ⇒ 舊字面留著加刪除線, 不要只改結果。
#   📌 而這一格是 codex R1 抓的:**碼改了而它的測試合約沒跟著改**
#      ⇒ 跑新版會 FAIL, 而 FAIL 的訊息會說「與讀碼的結論相反」—— 指向錯的地方。
case "$GOT_E" in
  '{"color": "員工打的"}') ok worldE "世界E 目錄空 ⇒ 快照留住員工打的那份(Sean 2026-09-01 拍【甲】)";;
  '{}') bad worldE "世界E 得到 {} ⇒ **員工打的被丟掉** = Sean 已推翻的行為;那個 CASE 的空值條件不見了";;
  *) bad worldE "世界E 得到 $GOT_E(既不是員工那份也不是 {})";;
esac

# ── 🔴 世界F:**目錄那一列【有鍵而值是空字串】** —— Sean 12:1x 親自拍的那一格 ──
#    他的原話逐字:「**算有填(用目錄的空白)**」⇒ 目錄贏, 員工那份被覆蓋。
#    🔴 **為什麼這一格要有自己的世界**:它與世界E 在畫面上長得幾乎一樣(兩邊目錄都「看起來沒東西」),
#       **而答案相反** ⇒ 沒有這一格, 一個把條件寫成「值是空的就留員工的」的改動會全綠。
#    ⚠️ 它進得來的理由:`m3_jsonb_values_all_string` 要求值全是字串, 而 `""` **是**字串。
Q "insert into public.product_variants (id, spec) values ('44444444-4444-4444-4444-444444444444'::uuid, '{\"color\":\"\"}'::jsonb)" >/dev/null
CALL '[{"variant_id":"44444444-4444-4444-4444-444444444444","sku":"SKU-F","title":"F","qty":1,"unit_price":100,"spec":{"color":"員工打的"}}]' >/dev/null
GOT_F=$(SPEC_OF)
case "$GOT_F" in
  '{"color": ""}') ok worldF "世界F 目錄有鍵值是空字串 ⇒ 用目錄的空白(Sean 2026-09-01 12:1x 原話「算有填」)";;
  '{"color": "員工打的"}') bad worldF "世界F 留了員工那份 ⇒ 條件把【值是空字串】也當成【沒填】, 而 Sean 拍的是相反";;
  *) bad worldF "世界F 得到 $GOT_F";;
esac

CALL '[{"variant_id":"22222222-2222-2222-2222-222222222222","sku":"SKU-A","title":"A","qty":1,"unit_price":100,"spec":{"color":"red"}}]' >/dev/null
[ "$(SPEC_OF)" = '{"color": "red"}' ] && ok pos-ctl "🔵 正對照 送對的 spec ⇒ 結果不變(新閘不改本來就對的那條路)" || bad pos-ctl "正對照得到 $(SPEC_OF)"

echo ""
echo "── ② 重跑閘 ──"
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" > "$D/again.log" 2>&1
# 🔴🔴 2026-09-01 期望字面【翻面】(codex R2 抓的)——
#   前置閘原本是「指紋 = 改後那一版 ⇒ RAISE EXCEPTION『已經套用過了』」;
#   而 codex R1 指出那個早退會讓後置 ④/④b/④c 永遠跑不到 ⇒ 改成 RAISE NOTICE + 往下跑。
#   ⛔ ~~舊期望:log 裡有『已經套用過了』~~ **作廢** ⇒ 那句話已經不會出現。
#   ✅ 新期望:log 裡有『指紋已是改後那一版』, **而且整支重跑成功(rc=0)**。
#   🔴 **而這是同一個病的第二次**(第一次是世界E):
#      **我改了碼, 而【量它的那個東西】沒有跟著改** ——
#      ⇒ 而它不會靜靜過, 它會紅, 訊息說「重跑沒被擋」⇒ **指向一個不存在的缺陷。**
#      📌 一個期望值過期時, 它產生的是【假指控】, 不是漏報 —— 而假指控會動員人去查。
grep -q '指紋已是改後那一版' "$D/again.log" && ok rerun "重跑 ⇒ 前置閘認出已套用並改走 NOTICE(不早退, 後置檢查照跑)" || bad rerun "重跑的 log 裡沒有那句 NOTICE:$(head -2 "$D/again.log")"

echo ""
echo "── ②b 🔴 rollback 真的演一次(不是「我想過了」)──"
#   要證的不是「函式換得回去」(那顯然可以), 是 **【退版不會退資料】** ——
#   而那一句若只寫在註解裡, 它與「我想過了」印同一個東西。
ROLL_BEFORE=$(Q "select now()")
# 🔴 用【目錄有值】那個變體, 不用空的那個 —— 空的話快照是 {}, 而「沒退回去」與「退回去了」
#    都會印 {} ⇒ 那一格零判別力。用有值的:新版寫 red, 員工送 blue
#    ⇒ 退版若真的退了資料, 它會變成 blue;維持 red 才證明【資料沒有跟著退】。
CALL '[{"variant_id":"22222222-2222-2222-2222-222222222222","sku":"SKU-R","title":"R","qty":1,"unit_price":100,"spec":{"color":"blue"}}]' >/dev/null
SNAP_NEW=$(SPEC_OF)
# 退版:把 gen2 原樣裝回去
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/gen2.sql" > "$D/rollback.log" 2>&1
RB=$?
# 撈受影響訂單(migration 檔頭步驟 1 那支查詢的最小形狀)
AFFECTED=$(Q "select count(*) from public.orders o join public.order_items oi on oi.order_id=o.id where o.manual_request_id is not null and o.created_at >= '$ROLL_BEFORE'::timestamptz")
SNAP_AFTER=$(SPEC_OF)
if [ "$RB" -eq 0 ] && [ "$SNAP_NEW" = '{"color": "red"}' ] && [ "$SNAP_AFTER" = '{"color": "red"}' ] && [ "$AFFECTED" -ge 1 ]; then
  ok rollback "退版 rc=0 · 受影響訂單撈得到($AFFECTED 列)· 快照維持 red【沒有變回員工送的 blue】⇒ 資料沒跟著退版"
else
  bad rollback "退版演失敗:rc=$RB 受影響=$AFFECTED 退版前=$SNAP_NEW 退版後=$SNAP_AFTER"
fi
# 裝回新版, 後面的突變格才有東西可以突變
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" >/dev/null 2>&1

echo ""
echo "── ③ 突變:四發 ──"
MUT(){ # $1=名 $2=sed-python $3=期望字樣(空=期望不紅)
  psql -h 127.0.0.1 -p $PORT -U postgres -q -c "drop function if exists public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)" >/dev/null 2>&1
  psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/gen2.sql" >/dev/null 2>&1
  # 🔴 `DROP FUNCTION` + 重建 ⇒ **PUBLIC 又拿回 EXECUTE** ⇒ 後置④c 會在每一發突變上恆紅。
  #    📌 而那個紅【指向被測物】(它說權限錯了), 實際是**我的 harness 每一輪重置了權限**
  #    ⇒ 與本檔上面那個 proconfig 寫錯的坑同族:**一個環境問題穿著被測物的外衣。**
  psql -h 127.0.0.1 -p $PORT -U postgres -q -c "REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) FROM PUBLIC" >/dev/null 2>&1
  psql -h 127.0.0.1 -p $PORT -U postgres -q -c "GRANT EXECUTE ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) TO service_role" >/dev/null 2>&1
  python3 - "$NEW" "$2" > "$D/mut_$1.sql" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
exec(sys.argv[2])
sys.stdout.write(s)
PY
  psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/mut_$1.sql" > "$D/mut_$1.log" 2>&1
  RC=$?
  if [ -n "$3" ]; then
    grep -q "$3" "$D/mut_$1.log" && ok "mut-$1" "突變 $1 ⇒ $3 開火" || bad "mut-$1" "突變 $1 沒紅(rc=$RC):$(head -2 "$D/mut_$1.log")"
  else
    [ "$RC" -eq 0 ] && ok "mut-$1" "🔵 負對照 $1(純註解)⇒ 沒有任何斷言紅" || bad "mut-$1" "負對照竟然紅了:$(head -2 "$D/mut_$1.log")"
  fi
}
# 🔴 M1 要改【全部】的 public.product_variants —— 只改一處的話, 我新加的權威驗證那一段
#    仍含該字面 ⇒ ① 放行、⑤ 開火。實測過:那會讓 ① 看起來有效而其實沒被考。
MUT M1 "s=s.replace('public.product_variants','public.product_variants_ZZQ')" '後置①'
# 🔴 M2 2026-09-01 換靶(codex R1 抓的):舊 M2 替換的是**單行版**的 CASE,
#    而拍【甲】之後那個字面在檔裡已經不存在 ⇒ `replace` 什麼都沒換 ⇒ **那一發突變是 no-op**,
#    而 no-op 突變的結果與「守門有效」**印同一個綠**。
#    ⇒ 新靶打在 Sean 那一格上:把「目錄空就不覆蓋」的兩個條件拿掉(退回【乙】)。
MUT M2 "s=s.replace(\"WHEN pv.id IS NULL\n                OR pv.spec IS NULL\n                OR pv.spec = '{}'::jsonb\n\",\"WHEN pv.id IS NULL\n\")" '後置⑥c'
MUT M3 "s=s.replace(\"jsonb_set(it -> 'product_snapshot', '{spec}', pv.spec)\",\"it -> 'product_snapshot'\")" '後置⑥'
MUT M4 "s=s.replace('-- ⟦b4-SPEC1⟧ · 手動建單的品項規格','-- ZZQ-M4-負對照-純註解 ⟦b4-SPEC1⟧ · 手動建單的品項規格')" ''

echo ""
echo "── 🔴 來源檔零留痕(跑前跑後比 sha256, 不是宣稱)──"
SHA_GEN2_AFTER=$(SHA "$GEN2")
SHA_NEW_AFTER=$(SHA "$NEW")
if [ "$SHA_GEN2_BEFORE" = "$SHA_GEN2_AFTER" ] && [ "$SHA_NEW_BEFORE" = "$SHA_NEW_AFTER" ]; then
  ok sources-untouched "兩支來源 migration 跑前跑後 sha256 相同(gen2 $(printf %s "$SHA_GEN2_AFTER" | cut -c1-12)… / new $(printf %s "$SHA_NEW_AFTER" | cut -c1-12)…)"
else
  bad sources-untouched "🔴 來源檔被改到了 —— gen2 $SHA_GEN2_BEFORE ⇒ $SHA_GEN2_AFTER / new $SHA_NEW_BEFORE ⇒ $SHA_NEW_AFTER;**停下來, 不要 commit**"
fi
# 🔵 而這一格自己的判別力:把上面 `SHA_NEW_BEFORE` 改成一個現造字串, 本格必須紅。
#    ⚠️ 未做成自動突變 —— 它要動 harness 自己, 而那正是本節在防的事。**寫出來, 不假裝驗過。**

echo ""
printf 'PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
FED=$(echo $EXPECT | wc -w | tr -d ' '); RAN=$(echo $SLOTS | wc -w | tr -d ' ')
printf '餵 %s 格 ⇒ 跑 %s 格\n' "$FED" "$RAN"
[ "$FED" = "$RAN" ] || { echo "🔴 格數對不上 ⇒ 本發作廢"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全過。🛑 而本機 apply 成功 ≠ 正式庫 apply 成功 —— apply 是 Sean 的手。"
