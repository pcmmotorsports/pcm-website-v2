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
# 🔴 REPO 從腳本自己的位置推(本檔在 scripts/ ⇒ 一層), 不寫死。
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GEN2="$REPO/supabase/migrations/20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql"
NEW="$REPO/supabase/migrations/20260831140000_m4b_spec1_manual_order_authoritative_spec.sql"
D=/tmp/spec1-probe
PORT=5621
EXPECT='pre-gate apply worldA worldB worldC worldD pos-ctl rerun mut-M1 mut-M2 mut-M3 mut-M4'

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
    "'{\"type\":\"personal\"}'::jsonb, 0," \
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

CALL '[{"variant_id":"22222222-2222-2222-2222-222222222222","sku":"SKU-A","title":"A","qty":1,"unit_price":100,"spec":{"color":"red"}}]' >/dev/null
[ "$(SPEC_OF)" = '{"color": "red"}' ] && ok pos-ctl "🔵 正對照 送對的 spec ⇒ 結果不變(新閘不改本來就對的那條路)" || bad pos-ctl "正對照得到 $(SPEC_OF)"

echo ""
echo "── ② 重跑閘 ──"
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" > "$D/again.log" 2>&1
grep -q '已經套用過了' "$D/again.log" && ok rerun "重跑 ⇒ 前置閘開火" || bad rerun "重跑沒被擋:$(head -2 "$D/again.log")"

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
MUT M2 "s=s.replace(\"CASE WHEN pv.id IS NULL THEN it -> 'product_snapshot'\",\"CASE WHEN pv.id IS NULL OR (it -> 'product_snapshot' -> 'spec') <> '{}'::jsonb THEN it -> 'product_snapshot'\")" '後置⑥b'
MUT M3 "s=s.replace(\"jsonb_set(it -> 'product_snapshot', '{spec}', pv.spec)\",\"it -> 'product_snapshot'\")" '後置⑥'
MUT M4 "s=s.replace('-- ⟦b4-SPEC1⟧ · 手動建單的品項規格','-- ZZQ-M4-負對照-純註解 ⟦b4-SPEC1⟧ · 手動建單的品項規格')" ''

echo ""
printf 'PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
FED=$(echo $EXPECT | wc -w | tr -d ' '); RAN=$(echo $SLOTS | wc -w | tr -d ' ')
printf '餵 %s 格 ⇒ 跑 %s 格\n' "$FED" "$RAN"
[ "$FED" = "$RAN" ] || { echo "🔴 格數對不上 ⇒ 本發作廢"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全過。🛑 而本機 apply 成功 ≠ 正式庫 apply 成功 —— apply 是 Sean 的手。"
