#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ⟦db-SEARCHFACETMUTEX⟧ `20260909010000_m4b_search_catalog_keyword_terms.sql` 的行為驗證
#
# 🔴🔴 **為什麼需要這一支**:`scripts/migrations-replay-from-zero.sh` 在這棵樹上
#   **驗不到本片** —— 上游 `20260904160000` 在拋棄式庫裡就失敗了
#   (逐字「斷言④失敗(正對照):排氣系統 0 件 / 煞車系統 0 件」= 那庫裡沒有商品資料),
#   ⇒ 下游整條連鎖擋下, 本片停在**前置閘②**。
#   📌 **⇒ 那一發的讀數是「我的前置閘會擋」, 不是「我的函式對」。兩件事。**
#
# ✅ 本支造一個**最小世界**(六個物件 + 4 筆商品), 把新函式真的**叫起來**, 問九題。
#
# 🔴 **每一題都有對照** —— 沒有對照的「N 筆」與「它根本沒在數」是同一個東西:
#   · 正對照 = 一定要有東西的那幾發
#   · 負對照 = 現造一個不存在的詞 ⇒ 必須 0
#   · 🔴🔴 **突變** = 把「零有效詞」那道守門拿掉 ⇒ 空關鍵字那幾格**必須從 4 掉到 0**
#     ⇒ 那才證明事後閘④ 守的是真的東西, 而不是一句好看的話。
#
# ── 🛑 它答不出什麼(先講)────────────────────────────────────────────────
#   · **效能一個字都沒量** —— 4 筆資料量不出 planner 在 26,402 列上會怎麼走。
#   · 這裡的六個物件是**手造的最小替身**, 不是正式庫那六支(欄少、無 RLS、無索引)。
#   · ⇒ 📌 **它證的是【述詞的邏輯對】, 不證【貼上正式庫會怎樣】。**
#
# 用法:bash scripts/20260909010000-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20260909010000_m4b_search_catalog_keyword_terms.sql"
KW="$REPO/supabase/migrations/20260906950000_m4b_search_exact_match_first.sql"

test -f "$MIG" || { echo "ENV-FAIL:找不到 $MIG"; exit 3; }
test -f "$KW"  || { echo "ENV-FAIL:找不到 $KW"; exit 3; }
command -v initdb >/dev/null 2>&1 || { echo "ENV-FAIL:本機沒有 initdb"; exit 3; }

TMP="$(mktemp -d)"
PGD="$TMP/pgdata"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
cleanup() { pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

echo "(跑的是 $(command -v psql) · port=$PORT · 資料目錄 $PGD)"
initdb -D "$PGD" -U postgres --encoding=UTF8 --locale=C >"$TMP/initdb.log" 2>&1 \
  || { echo "ENV-FAIL:initdb 失敗"; tail -5 "$TMP/initdb.log"; exit 3; }
pg_ctl -D "$PGD" -o "-p $PORT -k $TMP -c listen_addresses=" -l "$TMP/pg.log" -w start >/dev/null 2>&1 \
  || { echo "ENV-FAIL:PG 起不來"; tail -10 "$TMP/pg.log"; exit 3; }
PSQL="psql -h $TMP -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

# 🔴 三個 Supabase 角色要在 fixture 之前就在 —— fixture 會 GRANT 給它們
psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q \
  -c "DO \$r\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END \$r\$;" >"$TMP/roles.log" 2>&1

# ── 最小世界 ────────────────────────────────────────────────────────────────
$PSQL -f "$HERE/20260909010000-fixture.sql" >"$TMP/fixture.log" 2>&1 \
  || { echo "ENV-FAIL:fixture 建不起來"; tail -20 "$TMP/fixture.log"; exit 3; }

# 被委的那支:從真的 migration 裡切出 CREATE FUNCTION 那一段(不手抄)
python3 - "$KW" "$TMP/kw.sql" <<'PY'
import sys, io, re
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE OR REPLACE FUNCTION public.storefront_search_product_ids')
j = src.index('$function$;', i) + len('$function$;')
io.open(sys.argv[2], 'w', encoding='utf-8').write(src[i:j] + '\n')
PY
$PSQL -f "$TMP/kw.sql" >"$TMP/kw.log" 2>&1 \
  || { echo "ENV-FAIL:storefront_search_product_ids 建不起來"; tail -20 "$TMP/kw.log"; exit 3; }

# 受測的那支:同樣從真的 migration 裡切 CREATE 那一段(前置閘要真庫指紋, 這裡跑不了)
extract_fn() {
python3 - "$MIG" "$1" "$2" <<'EXPY'
import sys, io
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle')
j = src.index('$function$;', i) + len('$function$;')
body = src[i:j]
mode = sys.argv[3]
if mode == 'mut_guard':
    # 突變①:拿掉「零有效詞」那道【擋】
    keep, dropped = [], 0
    for ln in body.split('\n'):
        if ln.strip() == "OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')":
            dropped += 1
            continue
        keep.append(ln)
    assert dropped == 2, '突變1 anchor 命中 %d 份(期望 2)⇒ 這一發沒有套用上去' % dropped
    body = '\n'.join(keep)
elif mode == 'mut_filter':
    # 突變②:拿掉【濾】—— 改回把原始 p_terms 整組送出去(= codex R2 抓到的那個病)
    old = "(SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))"
    n = body.count(old)
    assert n == 2, '突變2 anchor 命中 %d 份(期望 2)⇒ 這一發沒有套用上去' % n
    body = body.replace(old, "p_terms) k))")
io.open(sys.argv[2], 'w', encoding='utf-8').write(body + '\n')
print('(本體切出 %d 行, 突變=%s)' % (len(body.split('\n')), mode))
EXPY
}
extract_fn "$TMP/fn.sql" normal || { echo "ENV-FAIL:切不出本體"; exit 3; }
$PSQL -f "$TMP/fn.sql" >"$TMP/fn.log" 2>&1 \
  || { echo "🔴 RED:新函式建不起來(語法/欄位)"; tail -30 "$TMP/fn.log"; exit 1; }
echo "✅ 新函式在真的 PG 上建得起來(這是 replay 那一發【沒有】驗到的第一件)"

fail=0; n=0
ask() {  # ask <題> <期望> <SQL 片段>
  n=$((n+1))
  got="$($PSQL -tAc "SELECT count(*) FROM ($3) z" 2>"$TMP/q.err")"
  if [ "$got" = "$2" ]; then printf '  PASS %-46s ⇒ %s\n' "$1" "$got"
  else printf '  🔴 FAIL %-43s ⇒ 得 %s 期望 %s\n' "$1" "${got:-<錯誤>}" "$2"; head -3 "$TMP/q.err"; fail=1; fi
}
CALL='SELECT * FROM public.search_catalog_by_vehicle'

# 🔴🔴 **檔頭那句「刪 N 行 / 加 M 行」要【當場重算】** ——
#   它是寫在權威位置的數字, 而**不會自己重算的數字會安靜地過期**。
#   🔬 病例就是本檔:第一版寫「三處插入 / 加 29 行」, 改了三輪都沒跟著改, 實際是 70。
#     抓到它的不是任何一輪審查, 是我去驗別的事時順手重算的。
n=$((n+1))
python3 - "$MIG" "$REPO/supabase/migrations/20260906910000_m4b_catalog_rpc_expose_external_id.sql" > "$TMP/diffnum.txt" 2>&1 <<'DIFFPY'
import sys, io, subprocess, re
new_src = io.open(sys.argv[1], encoding='utf-8').read()
old_src = io.open(sys.argv[2], encoding='utf-8').read()
def body(t):
    i = t.index('CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle')
    j = t.index('$function$;', i) + len('$function$;')
    return t[i:j] + '\n'
io.open('/tmp/_vfa.sql','w',encoding='utf-8').write(body(old_src))
io.open('/tmp/_vfb.sql','w',encoding='utf-8').write(body(new_src))
d = subprocess.run(['diff','/tmp/_vfa.sql','/tmp/_vfb.sql'], capture_output=True, text=True).stdout
dele = sum(1 for l in d.split('\n') if l.startswith('< '))
add  = sum(1 for l in d.split('\n') if l.startswith('> '))
m = re.search(r'刪 (\d+) 行(?:[^/]*)/ 加 (\d+) 行', new_src)
want = (int(m.group(1)), int(m.group(2))) if m else (None, None)
print('算出來 刪 %d / 加 %d ｜ 檔頭寫 刪 %s / 加 %s' % (dele, add, want[0], want[1]))
print('MATCH' if (dele, add) == want else 'MISMATCH')
DIFFPY
if /usr/bin/grep -q '^MATCH$' "$TMP/diffnum.txt"; then
  printf '  PASS 檔頭的 diff 數字與當場重算一致 —— %s\n' "$(head -1 "$TMP/diffnum.txt")"
else
  printf '  🔴 FAIL 檔頭的 diff 數字過期了 —— %s\n' "$(head -1 "$TMP/diffnum.txt")"; fail=1
fi

echo "── 九題(受測世界共 4 筆商品)─────────────────────────────────────"
ask "① p_terms 不給          ⇒ 全部"    4 "$CALL(NULL)"
ask "② p_terms = NULL        ⇒ 全部"    4 "$CALL(NULL, p_terms => NULL)"
ask "③ p_terms = 空陣列      ⇒ 全部"    4 "$CALL(NULL, p_terms => ARRAY[]::text[])"
ask "④ p_terms = {''}        ⇒ 全部"    4 "$CALL(NULL, p_terms => ARRAY['']::text[])"
ask "⑤ p_terms = {'  '}      ⇒ 全部"    4 "$CALL(NULL, p_terms => ARRAY['  ']::text[])"
ask "⑥ p_terms = {NULL}      ⇒ 全部"    4 "$CALL(NULL, p_terms => ARRAY[NULL]::text[])"
ask "⑦ 關鍵字 碳纖維         ⇒ 3"       3 "$CALL(NULL, p_terms => ARRAY['碳纖維'])"
ask "⑧ 🔴 關鍵字 AND 分類    ⇒ 1"       1 "$CALL(ARRAY['外觀配件'], p_terms => ARRAY['碳纖維'])"
ask "⑨ 負對照 現造的詞       ⇒ 0"       0 "$CALL(NULL, p_terms => ARRAY['zzq9999x不存在'])"

echo "── 🔴 [codex R3 must-fix] 以 anon 的身分再問一次 —— 上面每一格都是 postgres 跑的 ──"
ask_anon() {
  n=$((n+1))
  local got; got="$($PSQL -tAc "SET ROLE anon; SELECT count(*) FROM ($3) z" 2>"$TMP/anon.err")"
  if [ "$got" = "$2" ]; then printf '  PASS %-34s ⇒ %s\n' "$1" "$got"
  else printf '  🔴 FAIL %-31s ⇒ 得 %s 期望 %s\n' "$1" "${got:-<錯誤>}" "$2"; head -2 "$TMP/anon.err"; fail=1; fi
}
ask_anon "A1 anon · 不給關鍵字   ⇒ 4"  4 "$CALL(NULL)"
ask_anon "A2 anon · 關鍵字 碳纖維 ⇒ 3"  3 "$CALL(NULL, p_terms => ARRAY['碳纖維'])"
ask_anon "A3 anon · 關鍵字+分類   ⇒ 1"  1 "$CALL(ARRAY['外觀配件'], p_terms => ARRAY['碳纖維'])"
ask_anon "A4 anon · 車款+關鍵字   ⇒ 2"  2 "$CALL(NULL, p_brand => 'Ducati', p_terms => ARRAY['碳纖維'])"
n=$((n+1))
if $PSQL -tAc "SET ROLE anon; SELECT 1 FROM public.zzq9999x_no_such_table" >/dev/null 2>&1; then
  printf '  🔴 FAIL ⚪ 負對照 anon 竟然讀得到一張現造的表 ⇒ 上面四格的尺是恆真的\n'; fail=1
else
  printf '  PASS ⚪ 負對照 anon 讀現造的表會錯 ⇒ 上面四格真的是以 anon 在問\n'
fi
echo "   🛑 這幾格證的是【權限那一層通】, 不證 RLS —— 替身表沒開 RLS, 正式庫有"
echo "── 🔴 [codex R2] 混了空白詞的陣列 ────────────────────────────────────"
ask "16 🔴 {碳纖維, tab}       ⇒ 3"    3 "$CALL(NULL, p_terms => ARRAY['碳纖維', E'\\t'])"
ask "17 {碳纖維, NBSP}         ⇒ 3"    3 "$CALL(NULL, p_terms => ARRAY['碳纖維', E'\\u00A0'])"
echo "   🔑 只擋整組空而不濾單一詞時, 空白詞會被當成第二個必要條件 ⇒ 兩格都會是 0"
echo "── 🔴 [codex R1 MF4] 車款那條路 —— 上面十格一格都沒走到它 ────────────"
ask "10 只有車款 Ducati        ⇒ 3"    3 "$CALL(NULL, p_brand => 'Ducati')"
ask "11 🔴 車款 AND 關鍵字     ⇒ 2"    2 "$CALL(NULL, p_brand => 'Ducati', p_terms => ARRAY['碳纖維'])"
ask "12 車款 + 負對照詞        ⇒ 0"    0 "$CALL(NULL, p_brand => 'Ducati', p_terms => ARRAY['zzq9999x不存在'])"
ask "13 車款 + 空字串詞        ⇒ 3"    3 "$CALL(NULL, p_brand => 'Ducati', p_terms => ARRAY['']::text[])"
ask "18 車款 + 分類 + 關鍵字    ⇒ 1"    1 "$CALL(ARRAY['外觀配件'], p_brand => 'Ducati', p_terms => ARRAY['碳纖維'])"
echo "   🔑 11 與 12 若這條路忽略 p_terms 會是 3 與 3 —— 那才是這條路的判別力所在"
echo "   🔑 18 三個條件同時上 —— 少任何一個都不會是 1(只有車款 3 / 只有分類 2 / 只有關鍵字 3)"
echo "── 🔵 [codex R1 nit] 純空白的詞算不算有效詞? ──────────────────────────"
ask "14 p_terms = {tab}        ⇒ 全部"  4 "$CALL(NULL, p_terms => ARRAY[E'\\t']::text[])"
ask "15 p_terms = {全形空格}    ⇒ 全部"  4 "$CALL(NULL, p_terms => ARRAY[E'\\u3000']::text[])"
echo "   🔑 舊的 btrim 判準會把這兩格當有效詞 ⇒ 委出去 ⇒ 回零列 ⇒ 那時會是 0 與 0"

echo "── 🔴 三發突變:每一道守門各退一處, 看行為壞不壞 ──────────────────────"
mutate_and_ask() {
  extract_fn "$TMP/fn-$1.sql" "$1" || { echo "  🔴 突變 $1 切不出來"; fail=1; return; }
  $PSQL -f "$TMP/fn-$1.sql" >"$TMP/fnm-$1.log" 2>&1 || { echo "  🔴 突變 $1 建不起來"; tail -6 "$TMP/fnm-$1.log"; fail=1; return; }
  local got; got="$($PSQL -tAc "SELECT count(*) FROM ($4) z")"
  n=$((n+1))
  if [ "$got" = "$3" ]; then printf '  PASS 突變 %-10s %-28s ⇒ %s(壞了 = 那道守門守的是真東西)\n' "$1" "$2" "$got"
  else printf '  🔴 FAIL 突變 %-10s %-28s ⇒ %s 期望 %s —— 這一發沒有殺死任何東西\n' "$1" "$2" "$got" "$3"; fail=1; fi
}
mutate_and_ask mut_guard  "拿掉擋 · 空字串詞"        0 "$CALL(NULL, p_terms => ARRAY['']::text[])"
mutate_and_ask mut_guard  "拿掉擋 · 車款那條路"      0 "$CALL(NULL, p_brand => 'Ducati', p_terms => ARRAY['']::text[])"
mutate_and_ask mut_filter "拿掉濾 · {碳纖維, tab}"   0 "$CALL(NULL, p_terms => ARRAY['碳纖維', E'\\t'])"
$PSQL -f "$TMP/fn.sql" >/dev/null 2>&1


# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 **第二階段:把【整份 migration】跑一次 —— 含前置閘與事後閘。**
#   上面那些格子只跑了**本體**(python 把 CREATE 那一段切出來)。
#   ⇒ 📌 **前置閘與事後閘一行都沒有被執行過** —— 它們要「12 參數那支在庫上」才走得到,
#     而 `migrations-replay-from-zero.sh` 在這棵樹上停在前置閘②(上游先失敗了)。
#   🛑 **⇒ 一個【語法錯的閘】會在正式庫上讓整份 migration 炸掉, 而上面每一格都是綠的。**
# ✅ 做法:另開乾淨的庫, 先貼**前一代的真本體**(20260906910000:109-444)當 12 參數那支。
# 🔴 只跑正路不夠 —— 三發負對照證明那些閘會叫。
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "══ 第二階段:整份 migration(含閘)真的跑一次 ══"

psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q \
  -c "DO \$r\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END \$r\$;" >"$TMP/roles.log" 2>&1
n=$((n+1))
if [ "$(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")" = "3" ]; then
  printf '  PASS 三個 Supabase 角色建好了(前置閘①b/①c 與 GRANT 都要它們在)\n'
else
  printf '  🔴 FAIL 三個角色沒建齊 ⇒ 下面每一格都不算數\n'; fail=1
fi

PREV="$REPO/supabase/migrations/20260906910000_m4b_catalog_rpc_expose_external_id.sql"
sed -n '109,444p' "$PREV" > "$TMP/prev.sql"
prev_n="$(/usr/bin/grep -c "'external_id', pe.external_id" "$TMP/prev.sql")"
n=$((n+1))
if [ "$prev_n" = "2" ]; then printf '  PASS 前一代本體切出來了(external_id 指紋 %s 份)\n' "$prev_n"
else printf '  🔴 FAIL 前一代本體切錯了(external_id %s 份, 期望 2)⇒ 下面每一格都不算數\n' "$prev_n"; fail=1; fi

# 🔴 [codex R2/R3 must-fix] 檔裡那【兩個】md5 期望值 —— **當場算一次, 不引用檔裡的字面**
#   (那兩個字面是我算完貼進去的 ⇒ 只讀它等於在驗我抄得對不對, 不是在驗它對不對)
#   🔵 helper 那一個另有【正式庫的獨立讀數】背書:板列 ⟦search-VARIANTSKUFIRST⟧ 逐字
#     「62 已貼 … 貼後 prosrc md5 = 8ca57ae35b3c31e5f875919d9abf5061 len 7955」。
mkdb() { psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q -c "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1
         psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q -c "CREATE DATABASE $1;" >/dev/null 2>&1; }
mkdb md5probe
psql -h "$TMP" -p "$PORT" -U postgres -d md5probe -v ON_ERROR_STOP=1 -q -f "$HERE/20260909010000-fixture.sql" >/dev/null 2>&1
psql -h "$TMP" -p "$PORT" -U postgres -d md5probe -v ON_ERROR_STOP=1 -q -f "$TMP/prev.sql" >/dev/null 2>&1
psql -h "$TMP" -p "$PORT" -U postgres -d md5probe -v ON_ERROR_STOP=1 -q -f "$TMP/kw.sql" >/dev/null 2>&1
md5_of() { psql -h "$TMP" -p "$PORT" -U postgres -d md5probe -tAc \
  "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$1'" 2>/dev/null; }
for fn in search_catalog_by_vehicle storefront_search_product_ids; do
  live="$(md5_of "$fn")"
  n=$((n+1))
  if [ -n "$live" ] && /usr/bin/grep -q "$live" "$MIG"; then
    printf '  PASS %s 的 md5 對得上真 PG 存的 prosrc(%s)\n' "$fn" "$live"
  else
    printf '  🔴 FAIL %s:PG 存 %s, 而 migration 裡找不到這個字面 ⇒ 那道閘會擋掉每一次貼板\n' "$fn" "${live:-<空>}"; fail=1
  fi
done
n=$((n+1))
if /usr/bin/grep -q 'deadbeefdeadbeefdeadbeefdeadbeef' "$MIG"; then
  printf '  🔴 FAIL ⚪ 負對照 現造的 md5 竟然在檔裡 ⇒ 上面兩格的尺是恆真的\n'; fail=1
else
  printf '  PASS ⚪ 負對照 現造的 md5 不在檔裡 ⇒ 上面兩格的尺會動\n'
fi

gates_run() {  # gates_run <db> <對前一代本體的 sed 表達式或空> <要不要建 helper yes/no>
  local db="$1" tweak="$2" want_helper="$3"
  mkdb "$db"
  local Q="psql -h $TMP -p $PORT -U postgres -d $db -v ON_ERROR_STOP=1 -q"
  $Q -f "$HERE/20260909010000-fixture.sql" >"$TMP/$db-fx.log" 2>&1 || return 91
  if [ "$want_helper" = yes ]; then
    $Q -f "$TMP/kw.sql" >"$TMP/$db-kw.log" 2>&1 || return 92
    $Q -c "GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;" >>"$TMP/$db-kw.log" 2>&1 || return 93
  fi
  $Q -c "GRANT SELECT ON public.products_public, public.product_variants_public, public.brands TO anon, authenticated, service_role;" >>"$TMP/$db-fx.log" 2>&1 || return 95
  # 🔴🔴 **[codex R3 must-fix] 11 參數那支也要在 —— 正式庫上它從來沒有被 DROP 過。**
  #   🔬 `git grep -l 'DROP FUNCTION public.search_catalog_by_vehicle' supabase/migrations/` ⇒ 只有兩支,
  #     而 20260811040000 DROP 的是【10】參數那支。⇒ 正式庫是 11 參 + 12 參兩支多載。
  #   🛑 **沒有它, 這個世界比正式庫少一支函式** ⇒ 我原本那道「只剩一支多載」的斷言在這裡是綠的,
  #     而在正式庫上會在檔尾拋錯 ⇒ **整筆 rollback**。📌 那正是「我的假世界比較好過」的形狀。
  #   ⚠️ 這裡建的是**空殼**, 不是真本體 —— 本 harness 只需要它**存在**(多載組成), 不呼叫它。
  $Q -c "CREATE FUNCTION public.search_catalog_by_vehicle(p_brand text DEFAULT NULL, p_model text DEFAULT NULL, p_year int DEFAULT NULL, p_offset int DEFAULT 0, p_limit int DEFAULT 25, p_sort text DEFAULT 'recommend', p_category text DEFAULT NULL, p_brand_slugs text[] DEFAULT NULL, p_price_min int DEFAULT NULL, p_price_max int DEFAULT NULL, p_new_since timestamptz DEFAULT NULL) RETURNS TABLE(item jsonb, total bigint) LANGUAGE sql STABLE AS \$s\$ SELECT NULL::jsonb, NULL::bigint WHERE false \$s\$;" >>"$TMP/$db-fx.log" 2>&1 || return 96
  if [ -n "$tweak" ]; then
    sed "$tweak" "$TMP/prev.sql" > "$TMP/$db-prev.sql"
    # 🔴🔴 **突變要先證明它套用上去了。**
    #   🔬 病例就是本檔:我把 `p_limit integer DEFAULT 25` 的 sed 寫成 `int`, **一個字都沒改到**
    #     ⇒ migration 照常成功 rc=0 ⇒ 📌 印出來的是「那道閘沒有咬合力」, 而真相是我的突變沒發生。
    #   ⇒ **「突變沒套用」與「閘沒咬合力」在 rc 上是同一個東西。**
    if cmp -s "$TMP/prev.sql" "$TMP/$db-prev.sql"; then return 97; fi
  else cp "$TMP/prev.sql" "$TMP/$db-prev.sql"; fi
  $Q -f "$TMP/$db-prev.sql" >"$TMP/$db-prev.log" 2>&1 || return 94
  $Q -f "$MIG" >"$TMP/$db-mig.log" 2>&1
  return $?
}

gates_run gates_ok "" yes; rc_ok=$?
n=$((n+1))
if [ "$rc_ok" = "0" ]; then printf '  PASS 🔴 整份 migration 跑得完(前置閘 + DROP + CREATE + GRANT + 事後閘 + NOTIFY)\n'
# 🔴🔴 **貼完之後那支 13 參的 md5 —— 別人要拿它去釘前置閘, 所以它不能只是我算出來的。**
#   📌 我從 repo 檔算得出一個期望值, 而**那是推的**;這一格讓【真的 Postgres】把它印出來。
#   🔵 同一套算法對 12 參算出 336beaff…、對 helper 算出 8ca57ae3…, 而那兩個都有正式庫的獨立讀數背書
#     ⇒ 算法本身驗過兩次, 這一格補的是「這一支也走過真的 PG」。
n=$((n+1))
new_md5="$(psql -h "$TMP" -p "$PORT" -U postgres -d gates_ok -tAc "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND p.pronargs=13" 2>/dev/null)"
want_new="$(python3 -c "
import io,hashlib,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
i=s.index('CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle')
a=s.index('AS \$function\$',i)+len('AS \$function\$'); b=s.index(chr(10)+'\$function\$;',a)+1
print(hashlib.md5(s[a:b].replace(chr(13),'').encode()).hexdigest())" "$MIG")"
if [ -n "$new_md5" ] && [ "$new_md5" = "$want_new" ]; then
  printf '  PASS 貼完後 13 參的 md5 = %s(真 PG 印的, 與從 repo 算的逐字相同)\n' "$new_md5"
else
  printf '  🔴 FAIL 13 參 md5:真 PG 印 %s / 從 repo 算 %s ⇒ 別人拿去釘閘會釘錯\n' "${new_md5:-<空>}" "${want_new:-<空>}"; fail=1
fi

n=$((n+1))
if /usr/bin/grep -q '現在有 2 支多載' "$TMP/gates_ok-mig.log"; then
  printf '  PASS 🔴 貼完仍是【2 支多載】(11 參 + 13 參)—— 舊的「只剩 1 支」斷言在這裡就會炸\n'
else
  printf '  🔴 FAIL 事後閘① 沒印出「現在有 2 支多載」⇒ 這個世界的多載組成與正式庫不同, 上面那個 PASS 不算數\n'; fail=1
fi
else printf '  🔴 FAIL 整份 migration rc=%s:\n' "$rc_ok"; tail -6 "$TMP/gates_ok-mig.log" | sed 's/^/      /'; fail=1; fi

neg() {  # neg <標籤> <db> <tweak> <helper> <期望印出的閘名>
  local label="$1" db="$2" tweak="$3" helper="$4" want="$5" rc
  gates_run "$db" "$tweak" "$helper"; rc=$?
  n=$((n+1))
  if [ "$rc" = "97" ]; then
    printf '  🔴 FAIL 負對照 %-22s 的【突變沒有套用上去】(sed 一個字都沒改到)⇒ 這一發什麼都沒驗到\n' "$label"; fail=1; return
  fi
  if [ "$rc" != "0" ] && [ -f "$TMP/$db-mig.log" ] && /usr/bin/grep -q "$want" "$TMP/$db-mig.log"; then
    printf '  PASS 負對照 %-22s ⇒ %s 擋下(rc=%s)\n' "$label" "$want" "$rc"
  else
    printf '  🔴 FAIL 負對照 %-22s rc=%s 而沒印 %s ⇒ 那道閘沒有咬合力\n' "$label" "$rc" "$want"; fail=1
  fi
}
neg "門檻 100 改 200"   gates_n1 's/c_batch_day_threshold constant int := 100;/c_batch_day_threshold constant int := 200;/' yes '前置閘⑤b'
neg "helper 不在"       gates_n2 '' no '前置閘①'
neg "本體多一個空白字"  gates_n3 's/^BEGIN$/BEGIN /' yes '前置閘⑤c'
# 🔴 [codex R4 must-fix] 預設值那一層 —— **md5 與屬性閘都看不到它**
#   把 12 參那支的 p_limit 預設從 25 改成 50 ⇒ prosrc 一個位元組沒變 ⇒ ⑤b/⑤c 全過
#   ⇒ 只有 ⑤d 擋得住。**它是唯一在那個世界會紅的一道。**
neg "p_limit 預設 25 改 50" gates_n4 's/p_limit integer DEFAULT 25/p_limit integer DEFAULT 50/' yes '前置閘⑤d'

# 🔴🔴 **一道紅了而不說下一步的閘, 等於把問題丟給現場最沒有上下文的那個人。**
#   ⇒ 所以「它會擋」還不夠, 要問「它擋下來的那段字, 半夜貼板的人讀得懂嗎」。
#   🔑 判別句:訊息裡有沒有【兩種可能】與【怎麼分辨】—— 沒有的話它只是一個 32 位的亂碼。
for want in '有人動過線上那支' '我這把尺過期了' '怎麼分辨' 'prod-vs-vc-functions.py' '不要自己改本檔的期望值'; do
  n=$((n+1))
  if [ -f "$TMP/gates_n3-mig.log" ] && /usr/bin/grep -q "$want" "$TMP/gates_n3-mig.log"; then
    printf '  PASS md5 閘紅的時候有講「%s」\n' "$want"
  else
    printf '  🔴 FAIL md5 閘的訊息沒有「%s」⇒ 現場的人看到一串 md5 而不知道下一步\n' "$want"; fail=1
  fi
done
n=$((n+1))
if [ -f "$TMP/gates_n3-mig.log" ] && /usr/bin/grep -q 'zzq9999x' "$TMP/gates_n3-mig.log"; then
  printf '  🔴 FAIL 負對照 現造字串竟然命中 ⇒ 上面五格的尺是恆真的\n'; fail=1
else
  printf '  PASS ⚪ 負對照 現造字串 zzq9999x 在同一份 log 裡查無 ⇒ 上面五格的尺會動\n'
fi

# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 **第三階段:把【對帳檔 108b】真的跑一次。**
#   📌 一份沒有被跑過的對帳檔, 與一份跑起來會炸的對帳檔, 在檔案上長得一樣 ——
#     而它被打開的時刻是【貼板當下】, 那時沒有人有心情 debug 一支 SQL。
#   🛑 而不只問「跑不跑得完」, 還要問**它自己的兩向對照有沒有給出該給的值**:
#     §8a=1 · §8b=t · §8c=0 · §8d=0。任何一格不符 ⇒ 那份對帳的其餘讀數都不算數。
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "══ 第三階段:對帳檔 108b 真的跑一次 ══"
RECON="$HOME/pcm-mailbox/貼板-0909/108b_20260909010000_對帳_唯讀.sql"
n=$((n+1))
if [ ! -f "$RECON" ]; then
  printf '  🔴 FAIL 找不到 108b(%s)\n' "$RECON"; fail=1
else
  psql -h "$TMP" -p "$PORT" -U postgres -d gates_ok -f "$RECON" > "$TMP/recon.out" 2>&1
  rc_recon=$?
  err_n="$(/usr/bin/grep -c '^ERROR' "$TMP/recon.out")"
  seg_n="$(/usr/bin/grep -c '§' "$TMP/recon.out")"
  if [ "$rc_recon" = "0" ] && [ "$err_n" = "0" ] && [ "$seg_n" -ge 9 ]; then
    printf '  PASS 108b 跑得完(rc=%s · ERROR %s · 段落標記 %s 行 ≥ 9)\n' "$rc_recon" "$err_n" "$seg_n"
  else
    printf '  🔴 FAIL 108b rc=%s · ERROR %s · 段落 %s(期望 rc=0 / ERROR 0 / 段落 ≥9):\n' "$rc_recon" "$err_n" "$seg_n"
    /usr/bin/grep '^ERROR' "$TMP/recon.out" | head -3 | sed 's/^/      /'; fail=1
  fi
  # 🔴 它自己那四格對照
  for pair in "應為_1:1" "應為_t:t" "應為_0:0"; do :; done
  # 🔴 psql 的兩欄輸出在【同一行】(段 | 值)—— 我第一版去抓下一行, 四格全抓到空字串,
  #   而那印出來的是「對照給錯值」⇒ 📌 又一次「我的尺壞了」與「被量的東西壞了」印同一個紅。
  val8() { /usr/bin/grep -m1 "$1" "$TMP/recon.out" | awk -F'|' '{gsub(/ /,"",$NF); print $NF}'; }
  a8="$(val8 '§8a')"; b8="$(val8 '§8b')"; c8="$(val8 '§8c')"; d8="$(val8 '§8d')"
  n=$((n+1))
  if [ "$a8" = "1" ] && [ "$b8" = "t" ] && [ "$c8" = "0" ] && [ "$d8" = "0" ]; then
    printf '  PASS 108b 自己的兩向對照都給對值(§8a=%s §8b=%s §8c=%s §8d=%s)\n' "$a8" "$b8" "$c8" "$d8"
  else
    printf '  🔴 FAIL 108b 的對照給錯值(§8a=%s 期望1 · §8b=%s 期望t · §8c=%s 期望0 · §8d=%s 期望0)⇒ 那份對帳的其餘讀數不算數\n' "${a8:-<空>}" "${b8:-<空>}" "${c8:-<空>}" "${d8:-<空>}"; fail=1
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 **第四階段:把【還原檔 108r】真的跑一次 —— 在三個世界裡。**
#   🔬 昨夜的實錘逐字:**「最危險的是還原檔會【誤報成功】」** ——那不是理論, 是這個 repo 上個月真的發生過。
#   📌 **一支從來沒跑過的還原檔, 與一支跑起來會炸的還原檔, 在檔案上長得一樣** ——
#     而它被打開的時刻是【災難當下】, 比對帳檔更糟。
#   🛑 **而第 ③ 問是核心**:填【錯的】md5 會不會擋?
#     一支會把你還原到「一份它沒驗過的碼」的還原檔, **比沒有還原檔更糟** —— 它會印成功,
#     而現場的人會**停止查證**。
#   ⚠️ 射程:這裡跑的是**拋棄式 PG 上的替身世界**, 不是正式庫。
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "══ 第四階段:還原檔 108r 在三個世界裡各跑一次 ══"
RESTORE="$HOME/pcm-mailbox/貼板-0909/108r_20260909010000_還原_災難用.sql"
PH='FILL_ME_FROM_108b_BEFORE_PASTE_SECTION2_12ARG'
GOOD='336beaff1188c7670e85134db5aa623b'
BAD='deadbeefdeadbeefdeadbeefdeadbeef'
if [ ! -f "$RESTORE" ]; then
  n=$((n+1)); printf '  🔴 FAIL 找不到 108r(%s)\n' "$RESTORE"; fail=1
else
  run_restore() {  # run_restore <標籤> <要填的值或 keep> <期望 rc 是否為 0:yes/no> <期望訊息片段>
    local label="$1" fillv="$2" want_ok="$3" want_msg="$4" rc
    if [ "$fillv" = keep ]; then cp "$RESTORE" "$TMP/r.sql"
    else sed "s/$PH/$fillv/" "$RESTORE" > "$TMP/r.sql"
      if cmp -s "$RESTORE" "$TMP/r.sql"; then
        n=$((n+1)); printf '  🔴 FAIL %s 的替換【沒有套用】(sed 一個字都沒改到)⇒ 這一發什麼都沒驗到\n' "$label"; fail=1; return
      fi
    fi
    psql -h "$TMP" -p "$PORT" -U postgres -d gates_ok -v ON_ERROR_STOP=1 -q -f "$TMP/r.sql" > "$TMP/r-$label.out" 2>&1
    rc=$?
    n=$((n+1))
    if [ "$want_ok" = yes ]; then
      if [ "$rc" = "0" ]; then printf '  PASS %-22s ⇒ rc=0(它真的跑完了)\n' "$label"
      else printf '  🔴 FAIL %-22s ⇒ rc=%s 而期望跑得完:\n' "$label" "$rc"; tail -4 "$TMP/r-$label.out" | sed 's/^/      /'; fail=1; fi
    else
      if [ "$rc" != "0" ] && /usr/bin/grep -q "$want_msg" "$TMP/r-$label.out"; then
        printf '  PASS %-22s ⇒ 擋下了(rc=%s, 訊息含「%s」)\n' "$label" "$rc" "$want_msg"
      else
        printf '  🔴 FAIL %-22s ⇒ rc=%s 而沒印「%s」⇒ 它會在這個世界【誤報成功】\n' "$label" "$rc" "$want_msg"; fail=1
      fi
    fi
  }
  run_restore "①預設沒填"   keep   no  "還是 placeholder"
  run_restore "②填錯的 md5" "$BAD" no  "本檔內嵌的 12 參本體只還原得了"
  run_restore "③填對的 md5" "$GOOD" yes ""
  # 還原之後的世界要真的回去了
  n=$((n+1))
  after12="$(psql -h "$TMP" -p "$PORT" -U postgres -d gates_ok -tAc "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND p.pronargs=12" 2>/dev/null)"
  after13="$(psql -h "$TMP" -p "$PORT" -U postgres -d gates_ok -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle' AND p.pronargs=13" 2>/dev/null)"
  if [ "$after12" = "$GOOD" ] && [ "$after13" = "0" ]; then
    printf '  PASS 還原後的世界真的回去了(12 參 md5=%s · 13 參剩 %s 支)\n' "$after12" "$after13"
  else
    printf '  🔴 FAIL 還原後:12 參 md5=%s(期望 %s)· 13 參剩 %s 支(期望 0)⇒ 它印了成功而世界沒回去\n' "${after12:-<空>}" "$GOOD" "${after13:-<空>}"; fail=1
  fi
fi

echo "────────────────────────────────────────────────────────────────"
if [ "$fail" = "0" ]; then echo "✅ GREEN:$n 格全過"; exit 0
else echo "🔴 RED:$n 格裡有紅"; exit 1; fi
