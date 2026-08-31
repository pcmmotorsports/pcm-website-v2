#!/usr/bin/env bash
# ⟦b4-PCM03STARS⟧ · 新 migration `20260831010000` 真的 apply 得起來嗎, 而它的斷言真的會紅嗎
#
# 🔴 它在答哪一個問句:
#   問句 A(我有沒有把星號從字面裡拿掉)⇒ 一個 grep 就答得了, 不需要 PG
#   問句 B(那支 migration【跑得起來】, 而它的五道後置斷言【殺得死突變】)⇒ 🔴 本檔在答這一個
#
# ⚠️ 射程(照實寫, 不放寬):
#   · guard 函式與 CREATE TRIGGER 逐字從 `20260824011000` 抽, 新 migration 整支逐字跑
#   · 🔴 而它委給的 `pcm_manual_refund_rail_cap` 與底下的表都是【替身】(沿用 pcm01 probe 的形狀):
#     真的那支吃 `order_payments WHERE rail IN (...)`。⇒ **本檔不驗那道閘算得對不對。**
#   · 🔴 本機 PG 不是正式庫 ⇒ **「這裡 apply 成功」≠「正式庫 apply 會成功」**。apply 是 Sean 的手。
set -u
export LC_ALL=C LANG=C
# 🔴 從腳本自己的位置推, 不要寫死 —— 寫死的話, 從別棵工作樹呼叫它會【安靜地】跑去 pcm-wt-db,
#    而它會讀到那棵樹的 migration、印出一個看起來完全正常的結論。同族舊病見 CLAUDE.md 路由表。
# ⚠️ 這裡是 `/..` 【一層】不是 `/../..` —— 本檔在 `scripts/` 底下, 而 `admin-probe/up.sh` 在
#    `scripts/admin-probe/` 底下【兩層】。照抄那一支的字面會把 REPO 推到 repo 的上一層。
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OLD="$REPO/supabase/migrations/20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql"
NEW="$REPO/supabase/migrations/20260831010000_m4b_866_manual_refund_raise_plaintext.sql"
D=/tmp/pcm03stars-probe
PORT=5601
EXPECT_SLOTS='pre-denom apply stars-gone del-blocked no-stars hint-kept pos-ctl rerun-gate mut-fp7 mut-stars mut-errcode mut-hint mut-hint2 mut-secdef mut-trg'

for c in initdb pg_ctl psql python3; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL(不是紅)"; exit 2; }
done
[ "${1:-}" = "--fresh" ] && rm -rf "$D"
[ -e "$D" ] && { echo "🔴 $D 已存在 ⇒ ENV-FAIL。連跑兩發請帶 --fresh"; exit 2; }
for f in "$OLD" "$NEW"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; exit 2; }; done

PASS=0; FAIL=0; SLOTS=""
# 🔴 codex nit:只數總量的話,「一格重複 ok + 另一格消失」仍然湊得出同一個 N。
#    ⇒ 每一格帶一個【名字】, 收工時比【名字的集合】, 不只比個數。
#    📌 那就是鐵則 11 那句「我餵幾條 vs 它跑幾支」套在 harness 自己身上。
ok()  { printf '  ✅ %s\n' "$2"; PASS=$((PASS+1)); SLOTS="$SLOTS$1\n"; }
bad() { printf '  🔴 %s\n' "$2"; FAIL=$((FAIL+1)); SLOTS="$SLOTS$1\n"; }
cleanup(){ pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT
mkdir -p "$D"
Q(){ psql -h 127.0.0.1 -p $PORT -U postgres -tAc "$1" 2>&1; }
# 🔴 RETURNING 時 psql 會多印一行命令標籤(INSERT 0 1)⇒ 只取第一行
Q1(){ Q "$1" | head -1; }
# 突變前把庫【退回改之前那一代】—— 否則前置閘先開火, 而那不是我要演的那一道
RESET_OLD(){
  psql -h 127.0.0.1 -p $PORT -U postgres -q -c "drop trigger if exists trg_pcm_manual_refund_rail_cap on public.order_manual_refunds" >/dev/null 2>&1
  psql -h 127.0.0.1 -p $PORT -U postgres -q -c "drop function if exists public.pcm_manual_refund_rail_cap_guard()" >/dev/null 2>&1
  psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/old.sql" >/dev/null 2>&1
}

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" >/dev/null 2>&1
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start > "$D/pgctl.log" 2>&1 ; RC=$?
[ "$RC" -eq 0 ] || { echo "🔴 pg_ctl start rc=$RC ⇒ ENV-FAIL"; tail -5 "$D/pg.log"; exit 2; }
sleep 3
# 🔴 身分驗證:rc=0 只答「我的 pg_ctl 沒失敗」, 不答「psql 連到的是它」。
SEEN=$(Q "show data_directory" | tr -d '[[:space:]]')
WANT=$(cd "$D/data" && pwd -P); SEEN_REAL=$(cd "$SEEN" 2>/dev/null && pwd -P)
[ "$SEEN_REAL" = "$WANT" ] || { echo "🔴🔴 我連到的不是我起的那顆 PG ⇒ ENV-FAIL"; exit 2; }
printf '身分驗證 ✅ %s\n' "$WANT"
printf 'PG %s\n\n' "$(Q 'show server_version')"

# ── fixture(沿用 pcm01 probe 的最小世界)──────────────────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 > "$D/fx.log" 2>&1 <<'SQL'
create table public.orders (id uuid primary key default gen_random_uuid(), total bigint not null);
create table public.order_manual_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  rail text not null,
  refund_amount integer not null check (refund_amount > 0),
  request_id uuid not null,
  voided_at timestamptz,
  unique (order_id, request_id));
create table public.order_manual_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount bigint not null);
create function public.probe_order_refundable_remaining(p_order_id uuid) returns bigint
  language sql stable as $$
  select o.total - coalesce((select sum(r.refund_amount) from public.order_manual_refunds r
                              where r.order_id = o.id and r.voided_at is null), 0)
    from public.orders o where o.id = p_order_id $$;
create function public.pcm_manual_refund_rail_cap(p_order_id uuid) returns bigint
  language sql stable as $$
  select coalesce((select sum(p.amount) from public.order_manual_payments p where p.order_id = p_order_id), 0)
       - coalesce((select sum(r.refund_amount) from public.order_manual_refunds r
                    where r.order_id = p_order_id and r.voided_at is null), 0) $$;
SQL
[ $? -eq 0 ] || { echo "🔴 fixture 建不起來 ⇒ ENV-FAIL"; sed -n 1,5p "$D/fx.log"; exit 2; }

# ── 舊那一代:函式 + trigger 逐字抽 ────────────────────────────────────
python3 - "$OLD" > "$D/old.sql" <<'PY'
import io,re,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'CREATE FUNCTION public\.pcm_manual_refund_rail_cap_guard\(\).*?\$fn\$;', s, re.S)
t=re.search(r'CREATE TRIGGER trg_pcm_manual_refund_rail_cap.*?;', s, re.S)
assert m and t, '抽不到 ⇒ 本發作廢'
sys.stdout.write(m.group(0)+'\n'+t.group(0)+'\n')
PY
[ -s "$D/old.sql" ] || { echo "🔴 抽不到舊那一代 ⇒ ENV-FAIL"; exit 2; }
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/old.sql" > "$D/old.log" 2>&1 ; RC=$?
[ "$RC" -eq 0 ] || { echo "🔴 舊那一代裝不上 rc=$RC ⇒ ENV-FAIL"; sed -n 1,5p "$D/old.log"; exit 2; }

echo "── 前置:改之前的世界(所有斷言的分母)──"
S=$(Q "select count(*) from regexp_split_to_table((select prosrc from pg_proc where oid='public.pcm_manual_refund_rail_cap_guard()'::regprocedure), E'\n') l where l !~ '^\s*--' and l like '%**%'")
[ "$S" = "3" ] && ok pre-denom "改之前:非註解行含 ** 的有 3 行(前置閘要的就是這個 3)" || bad pre-denom "改之前是 $S 行, 不是 3 ⇒ 分母不對"

echo
echo "── ① 新 migration 逐字 apply ──"
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" > "$D/new.log" 2>&1 ; RC=$?
[ "$RC" -eq 0 ] && ok apply "apply rc=0(五道後置斷言全過)" || { bad apply "apply rc=$RC"; sed -n 1,8p "$D/new.log"; }

S=$(Q "select count(*) from regexp_split_to_table((select prosrc from pg_proc where oid='public.pcm_manual_refund_rail_cap_guard()'::regprocedure), E'\n') l where l !~ '^\s*--' and l like '%**%'")
[ "$S" = "0" ] && ok stars-gone "改之後:非註解行 0 行含 **" || bad stars-gone "改之後還有 $S 行含 **"

echo
echo "── ② 行為:trigger 還在擋, 而那句話沒有星號 ──"
OID=$(Q1 "insert into public.orders(total) values (1000) returning id")
Q "insert into public.order_manual_payments(order_id, amount) values ('$OID', 1000)" >/dev/null
Q "insert into public.order_manual_refunds(order_id, rail, refund_amount, request_id) values ('$OID','cash',300,gen_random_uuid())" >/dev/null
# DELETE ⇒ 必須被擋, 而訊息裡不得有 **
DEL=$(Q "delete from public.order_manual_refunds where order_id='$OID'")
case "$DEL" in
  *PCM03*|*"不能刪除"*) ok del-blocked "DELETE 被擋(PCM03 仍然開火 —— 換字面沒有把行為改掉)";;
  *) bad del-blocked "DELETE 沒被擋:$DEL";;
esac
case "$DEL" in
  *'**'*) bad no-stars "🔴 員工那句話裡【仍然】有兩顆星星:$DEL";;
  *) ok no-stars "那句話裡沒有 ** (這就是本片要的那一格)";;
esac
case "$DEL" in
  *"要取消請用"*) ok hint-kept "而「要取消請用作廢」那個指示還在(不改罐頭碼的唯一理由)";;
  *) bad hint-kept "指示掉了";;
esac
# 🔵 正對照:超額 INSERT 仍然被擋(證明我沒有把整個 guard 換成空的)
# 🔴 psql 的錯誤【訊息】裡沒有 SQLSTATE ⇒ 拿 'PCM01' 去比訊息永遠不中。
#    改成讓 plpgsql 自己把 SQLSTATE 抓出來 —— 比的是碼, 不是話。
OVER=$(Q "do \$\$ begin insert into public.order_manual_refunds(order_id, rail, refund_amount, request_id) values ('$OID','cash',9999,gen_random_uuid()); exception when others then raise notice 'SQLSTATE=%', SQLSTATE; end \$\$")
case "$OVER" in
  *SQLSTATE=PCM01*) ok pos-ctl "🔵 正對照:超額 INSERT 仍吐 PCM01(比的是碼不是話)⇒ guard 沒被換成空的";;
  *) bad pos-ctl "🔵 正對照失敗, 超額沒被擋:$OVER";;
esac

echo
echo "── ②b 前置閘:同一支重跑必須【紅】(而這一格是上一版意外演出來的)──"
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$NEW" > "$D/again.log" 2>&1 ; RC=$?
if [ "$RC" -ne 0 ] && grep -q "前置閘" "$D/again.log"; then
  ok rerun-gate "重跑 ⇒ 前置閘開火(它答的是【庫裡那支是不是我抄的那一版】, 不是【我跑過沒】)"
else
  bad rerun-gate "重跑沒紅 rc=$RC ⇒ 前置閘沒有判別力"
fi

echo
echo "── ③ 突變:六道斷言【逐一】演一次 ──"
# 🔴 這一段原本要「兩段突變」(改本體 + 把預期指紋一起改對), 因為指紋是第①道 ⇒ 遮住 ②③④。
# ✅ **2026-08-31 指紋搬到最後(第⑦道)⇒ 遮罩消失 ⇒ 每一道都能【單獨】被突變殺死。**
#    📌 而那一步不是我想出來的, 是掃完 239 支 migration 之後發現的:
#       **既有那四支全部把整段來源的指紋放最後 —— 我是唯一放第一道的那個。**
#    🔵 `REFP=yes` 那條路留著沒刪:它仍然是【合法改本體 + 順手更新指紋】那個世界的演法。
NORMSQL="select md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) from pg_proc where oid='public.pcm_manual_refund_rail_cap_guard()'::regprocedure"

# 用法:mut <名字> <python 對 migration 文字的編輯> <要開火的斷言標記> <refp: yes|no>
mut() {
  local NAME="$1" EDIT="$2" MARK="$3" REFP="$4" F="$D/mut_$1.sql"
  RESET_OLD
  python3 - "$NEW" "$F" <<PYEOF
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
$EDIT
io.open(sys.argv[2],'w',encoding='utf-8').write(s)
PYEOF
  if [ "$REFP" = "yes" ]; then
    # 把突變後的本體單獨裝上去、量它的指紋、再把 migration 的預期指紋改成它, 然後退回舊代
    python3 - "$F" > "$D/mf.sql" <<'PYEOF'
import io,re,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
print(re.search(r'CREATE OR REPLACE FUNCTION public\.pcm_manual_refund_rail_cap_guard\(\).*?\$fn\$;', s, re.S).group(0))
PYEOF
    psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/mf.sql" >/dev/null 2>&1
    local FP; FP=$(Q1 "$NORMSQL" | tr -d '[:space:]')
    python3 - "$F" "$FP" <<'PYEOF'
import io,re,sys
p,fp=sys.argv[1],sys.argv[2]
s=io.open(p,encoding='utf-8').read()
# 只改【後置①】那個常數(它在 RAISE EXCEPTION 之前的 IF v_fp <> '…' 那一行)
i=s.index('IF v_fp <> ', s.index('DO $post$'))
s=s[:i]+re.sub(r"'[0-9a-f]{32}'", "'"+fp+"'", s[i:], count=2)
io.open(p,'w',encoding='utf-8').write(s)
PYEOF
    RESET_OLD
  fi
  psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$F" > "$D/mut_$NAME.log" 2>&1 ; local RC=$?
  if [ "$RC" -ne 0 ] && grep -q "$MARK" "$D/mut_$NAME.log"; then
    ok "mut-$NAME" "突變 $NAME ⇒ $MARK 開火"
  else
    bad "mut-$NAME" "突變 $NAME 沒被殺:rc=$RC $(grep -m1 'ERROR' "$D/mut_$NAME.log" | cut -c1-90)"
  fi
}

# ① 指紋:拿掉 OLD.order_id = NEW.order_id(codex must-fix 5 逐字舉的那個突變 —— 跨單假餘裕會復活)
mut fp7 "a=\"IF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL AND OLD.order_id = NEW.order_id THEN\"; assert s.count(a)==1; s=s.replace(a, a.replace(' AND OLD.order_id = NEW.order_id',''))" "後置⑦" no
# ② 星號:把一顆星星塞回訊息(必須連指紋一起改, 否則 ① 先開火)
mut stars "a=\"這是「系統算不出上限」\"; assert s.count(a)==1; s=s.replace(a,\"這是**系統算不出上限**\")" "後置②" no
# ③ USING ERRCODE:把 PCM02 那個碼改掉
mut errcode "assert s.count(chr(34)) >= 0; i=s.index('DO \$post\$'); s=s[:i].replace(\"ERRCODE = 'PCM02'\",\"ERRCODE = 'PCM99'\",1)+s[i:]" "後置③" no
# ④ 指示:拿掉「要取消請用作廢」
mut hint "i=s.index(chr(39)+'人工退款登記'); s=s[:i]+s[i:].replace('要取消請用「作廢」','要取消請走另一個流程',1)" "後置④" no
# ⑤ SECURITY DEFINER:改成 INVOKER
mut secdef "i=s.index('DO \$post\$'); s=s[:i].replace('SECURITY DEFINER','SECURITY INVOKER',1)+s[i:]" "後置⑤" no
# ④b PCM02 的指示:拿掉「請找工程確認」(codex must-fix 6 點名 ④b 沒有突變 —— 補上)
mut hint2 "a=\"這是「系統算不出上限」,請找工程確認。\"; assert s.count(a)==1; s=s.replace(a,\"這是「系統算不出上限」,請自行處理。\")" "後置④b" no
# ⑥ trigger:動詞集合改窄成只有 INSERT(插在後置斷言【之前】)
mut trg "s=s.replace('DO \$post\$', 'DROP TRIGGER IF EXISTS trg_pcm_manual_refund_rail_cap ON public.order_manual_refunds;\nCREATE TRIGGER trg_pcm_manual_refund_rail_cap BEFORE INSERT ON public.order_manual_refunds FOR EACH ROW EXECUTE FUNCTION public.pcm_manual_refund_rail_cap_guard();\nDO \$post\$', 1)" "後置⑥" no

echo
GOT=$(printf '%b' "$SLOTS" | grep -v '^$' | sort | tr '\n' ' ')
WANT=$(printf '%s\n' $EXPECT_SLOTS | sort | tr '\n' ' ')
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
printf '餵 %d 格 ⇒ 跑 %d 格\n' "$(printf '%s\n' $EXPECT_SLOTS | wc -l | tr -d ' ')" "$(printf '%b' "$SLOTS" | grep -vc '^$')"
if [ "$GOT" != "$WANT" ]; then
  echo "🔴 跑到的【格名集合】與期望不同 ⇒ 有格子沒跑到 或 有格子跑了兩次"
  echo "   少跑:$(comm -13 <(printf '%s\n' $GOT) <(printf '%s\n' $WANT) | tr '\n' ' ')"
  echo "   多出:$(comm -23 <(printf '%s\n' $GOT) <(printf '%s\n' $WANT) | tr '\n' ' ')"
  exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全過。🛑 而本機 apply 成功 ≠ 正式庫 apply 成功 —— apply 是 Sean 的手。"
