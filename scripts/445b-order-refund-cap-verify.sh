#!/usr/bin/env bash
# #445b 行為 harness —— 拋棄式 PG。migration 逐字套用,不重打。
# 🔴 本檔照今晚學到的四條寫:①local 拆句 ②儀器走 stderr ③空值當作廢 ④先量 orig 再突變
set -u
export LC_ALL=C LANG=C
REPO=/Users/sean_1/pcm-wt-db
MIG="$REPO/supabase/migrations/20260830210000_m4b_445b_order_refund_cap.sql"
WIN=dbw
D=/tmp/pcm-probe-$WIN
PORT=555$(printf '%02d' $(( $(echo -n "$WIN" | cksum | cut -d' ' -f1) % 90 + 10 )))

lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $PORT 被佔,換 WIN"; exit 1; }
[ -e "$D" ] && { echo "🔴 $D 已存在,本檔不替你 rm"; exit 1; }
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" >/dev/null 2>&1
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1
sleep 3
psql -h 127.0.0.1 -p $PORT -U postgres -tAc "select 1" >/dev/null 2>&1 || { echo "🔴 起不來:"; tail -6 "$D/pg.log"; exit 1; }
printf '叢集 %s · 隔離級別 %s\n' "$PORT" "$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc 'show default_transaction_isolation')"

PASS=0; FAIL=0
Q() { psql -h 127.0.0.1 -p $PORT -U postgres -d "$1" -tAc "$2" 2>&1; }
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }

# ── fixture:只建 migration 讀得到的東西。⚠️ 不是正式庫 schema(射程見交件)
build() {   # $1=db  $2=variant: full | no-neighbour | nullable-amount | no-gate | null-cap
  local db="$1"; local variant="$2"
  psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create database $db" >/dev/null 2>&1
  # 🔴 fixture 要有 Supabase 的三個角色 —— migration 的 REVOKE 指名它們。
  #    少了它們,apply 會在 REVOKE 那幾行紅,而【那不是 migration 的錯,是 fixture 缺角色】。
  for role in anon authenticated service_role; do
    psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create role $role" >/dev/null 2>&1
  done
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=1 > "$D/fx-$db.log" 2>&1 <<SQL
create table public.orders (id uuid primary key default gen_random_uuid(), total bigint not null);
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  refund_amount bigint $( [ "$variant" = nullable-amount ] && echo '' || echo 'not null' ),
  status text not null default 'processing', failed_reason text);
create table public.order_refund_manual_corrections (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.order_refunds(id),
  seq int not null, corrected_to text not null, unique (refund_id, seq));
create view public.order_refund_effective_verdict as
  select distinct on (c.refund_id) c.refund_id, c.corrected_to
    from public.order_refund_manual_corrections c order by c.refund_id, c.seq desc;
-- 🔴 cap 補上【第二段】(已更正為 money_moved 的 failed 列也要扣)—— 與正式庫
--    `20260820100000:231-248` 同形。少了它,「更正競態」那一格根本構造不出金額變化。
create function public.pcm_order_refundable_remaining(p_order_id uuid) returns bigint
  language sql stable as \$\$
  select $( [ "$variant" = null-cap ] && echo 'null::bigint' || echo "o.total::bigint - coalesce((select sum(r.refund_amount) from public.order_refunds r where r.order_id=o.id and r.status in ('processing','confirmed')),0) - coalesce((select sum(r.refund_amount) from public.order_refunds r join public.order_refund_effective_verdict v on v.refund_id=r.id where r.order_id=o.id and r.status='failed' and r.failed_reason='manual_failed' and v.corrected_to='money_moved'),0)" )
    from public.orders o where o.id = p_order_id \$\$;
create function public.pcm_a7c_noop() returns trigger language plpgsql as \$\$ begin return null; end \$\$;
-- 🔴🔴 **正式庫【已經有】一道 BEFORE INSERT guard,而它對 orders 取 FOR SHARE**
--    (`20260803150000:241-249` 逐字,含「鎖順序約定:orders(FOR SHARE)→ order_refunds」)。
--    ⇒ 我第一版的 fixture 沒有它 ⇒ **併發那格量到的鎖序不是正式庫的鎖序**(codex R1 must-fix)。
--    ⇒ 而它比我的 trigger 【排序在前】(a7c < trg_) ⇒ 我的 FOR UPDATE 是一次**鎖升級**。
create function public.pcm_probe_a7c_insert_guard() returns trigger language plpgsql as \$\$
declare v text;
begin
  select o.id::text into v from public.orders o where o.id = NEW.order_id for share;
  return NEW;
end \$\$;
create trigger order_refunds_a7c_insert_guard_bi before insert on public.order_refunds
  for each row execute function public.pcm_probe_a7c_insert_guard();
SQL
  if [ "$variant" != no-neighbour ]; then
    psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=1 >> "$D/fx-$db.log" 2>&1 <<'SQL'
create trigger order_refunds_a7c_block_delete_bd before delete on public.order_refunds
  for each row execute function public.pcm_a7c_noop();
create trigger order_refunds_a7c_immutable_guard_bu before update on public.order_refunds
  for each row execute function public.pcm_a7c_noop();
SQL
  fi
  if grep -qi "^ERROR" "$D/fx-$db.log"; then bad "$db fixture 建不起來"; sed -n '1,3p' "$D/fx-$db.log"; return 1; fi
  if [ "$variant" = earlier-trigger ]; then
    # 種一支【名字排在 a445b 之前】的 BEFORE INSERT trigger ⇒ 後置斷言①b 應該紅
    psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=1 >> "$D/fx-$db.log" 2>&1 <<'SQL'
create trigger order_refunds_a000_probe_bi before insert on public.order_refunds
  for each row execute function public.pcm_a7c_noop();
SQL
  fi
  [ "$variant" = no-gate ] && return 0
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -f "$MIG" > "$D/mig-$db.log" 2>&1
  return 0
}

# 🔴 `grep -c` 零命中時【印 0 而 rc=1】⇒ `$( … || echo 0 )` 會變成 "0 0"(CLAUDE.md 記過這條)。
#    ⇒ 用 `|| true` 讓它只印一次。
migrc() { local n; n=$(grep -c "ERROR:" "$D/mig-$1.log" 2>/dev/null || true); printf '%s' "${n:-0}"; }

mkorder() { local db="$1"; local oid; oid=$(Q "$db" "select gen_random_uuid()")
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -c "insert into public.orders(id,total) values ('$oid',1000)" >/dev/null 2>&1
  printf '%s' "$oid"; }

# 🔴 **回傳 SQLSTATE,不回傳訊息文字。**
#    psql 預設【不印 SQLSTATE】⇒ 用 grep 抓 'PCM04' 永遠找不到,而錯誤訊息長得像「沒擋」。
#    ⇒ 用 plpgsql 捕捉,印出 SQLSTATE 本身。成功則印 OK。
#    📌 這一格是今晚第 N 次同型:**尺看的東西與它宣稱在看的東西不同。**
ins() {  # $1=db $2=oid $3=amount ⇒ 印 'OK' 或 SQLSTATE
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$1" -tAq -c "
    do \$probe\$
    begin
      insert into public.order_refunds(order_id,refund_amount) values ('$2',$3);
      raise notice 'OK';
    exception when others then
      raise notice '%', SQLSTATE;
      raise exception 'PROBE-ROLLBACK' using errcode='P0001';
    end \$probe\$;" 2>&1 \
    | sed -n 's/^.*NOTICE: *//p' | head -1 | tr -d '[[:space:]]'; }
# 🔴 **只取 NOTICE 後面那一段**。第一版用 `grep -oE '…|[0-9A-Z]{5}'`,
#    而那個通用五碼樣式**先命中了 "NOTIC"**(來自 NOTICE 這個字本身)
#    ⇒ 每一格都印 [NOTIC],而它看起來像「回了一個奇怪的 SQLSTATE」。
#    📌 **一個把自己的鷹架當成資料的尺 —— 而它每一格都給你一個答案。**

printf '\n--- A. 單發:上限判準對不對?(訂單 1000)---\n'
build wa full
[ "$(migrc wa)" = "0" ] && ok "migration 套得起來(後置斷言過)" || { bad "migration apply 失敗"; sed -n '1,4p' "$D/mig-wa.log"; }
O=$(mkorder wa)
R=$(ins wa "$O" 1001); [ "$R" = "PCM04" ] && ok "超額 1001 ⇒ 擋,SQLSTATE=PCM04" || bad "超額:期望 PCM04 實得 [$R]"
O=$(mkorder wa)
R=$(ins wa "$O" 1000); [ "$R" = "OK" ] && ok "剛好 1000 ⇒ 放行(正對照;也擋 > 改 >= 的突變)" || bad "剛好等於上限:期望 OK 實得 [$R]"
O=$(mkorder wa)
R=$(ins wa "$O" 300); [ "$R" = "OK" ] && ok "300 ⇒ 放行(正對照)" || bad "300:期望 OK 實得 [$R]"
O=$(mkorder wa); ins wa "$O" 600 >/dev/null 2>&1
R=$(ins wa "$O" 500); [ "$R" = "PCM04" ] && ok "已退 600 後再退 500 ⇒ 擋(累計判準對)" || bad "累計:期望 PCM04 實得 [$R]"

printf '\n--- B. 負對照:沒裝這道閘的世界 ---\n'
build wb no-gate
O=$(mkorder wb); R=$(ins wb "$O" 5000)
[ "$R" = "OK" ] && ok "沒閘 ⇒ 超額 5000 進得去(對照組成立,證明 A 是閘擋的)" || bad "沒閘:期望 OK 實得 [$R]"

printf '\n--- C. 🔴 併發:兩個 session 各 600(本片的本體)---\n'
race() {
  local db="$1"; local oid; oid=$(mkorder "$db")
  local F="$D/fifo-$db"; rm -f "$F"; mkfifo "$F"
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=0 < "$F" > "$D/s1-$db.log" 2>&1 &
  local S1=$!
  exec 9> "$F"
  printf 'BEGIN;\n' >&9
  printf "insert into public.order_refunds(order_id,refund_amount) values ('%s',600);\n" "$oid" >&9
  sleep 2
  # 🔴 **psql 預設不印 SQLSTATE**(今晚第三次踩同一個坑)⇒ 用 plpgsql 捕捉並 RAISE NOTICE 出來,
  #    否則「第二個 session 拿到什麼」這一格永遠是空的,而空的看起來像「沒被我們擋」。
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=0 > "$D/s2-$db.log" 2>&1 <<SQL2 &
BEGIN;
SET LOCAL lock_timeout = '20s';
do \$s2\$ begin
  insert into public.order_refunds(order_id,refund_amount) values ('$oid',600);
  raise notice 'S2-OK';
exception when others then
  raise notice 'S2-SQLSTATE=%', SQLSTATE;
end \$s2\$;
COMMIT;
SQL2
  local S2=$!
  sleep 2
  printf 'COMMIT;\n' >&9
  exec 9>&-
  wait $S1 2>/dev/null; wait $S2 2>/dev/null
  rm -f "$F"
  local cnt; cnt=$(Q "$db" "select count(*) from public.order_refunds where order_id='$oid'")
  printf 'DEBUG race db=%s oid=%s cnt=[%s]\n' "$db" "$oid" "$cnt" >&2
  printf '%s' "$cnt"
}
C=$(race wa)
# 🔴 **只比列數 = 恆綠路**(codex R2 must-fix):第二個 session 因權限錯、timeout、
#    或任何別的 trigger 例外而失敗,列數一樣是 1 ⇒ 印綠而【擋它的不是我們這道閘】。
#    ⇒ 也要比它拿到的**是不是 PCM04**。
C2=$(sed -n 's/.*S2-SQLSTATE=//p' "$D/s2-wa.log" | head -1 | tr -d '[[:space:]]')
if [ -z "$C" ]; then bad "併發:race 沒回東西 ⇒ 作廢(不是結論)"
elif [ "$C" = "1" ] && [ "$C2" = "PCM04" ]; then ok "併發兩筆各 600 ⇒ 只進 1 筆,而第二筆拿到 PCM04(是我們這道閘擋的)"
elif [ "$C" = "1" ]; then bad "併發:只進 1 筆而第二個 session 拿到 [$C2] 不是 PCM04 ⇒ **擋它的可能不是這道閘**"
else bad "併發:進了 $C 筆 ⇒ 🔴 **鎖沒擋住**"; fi

printf '\n--- D. cap 算不出來(NULL)---\n'
build wc null-cap
O=$(mkorder wc); R=$(ins wc "$O" 1)
[ "$R" = "PCM05" ] && ok "cap 為 NULL ⇒ 擋,SQLSTATE=PCM05(與超額分開的碼)" || bad "NULL cap:期望 PCM05 實得 [$R]"

printf '\n--- E. 前置閘:兩道鄰居不在 ⇒ apply 必須紅 ---\n'
build wd no-neighbour
grep -q "order_refunds_a7c_block_delete_bd 不在" "$D/mig-wd.log" && ok "鄰居不在 ⇒ apply 被前置閘擋" || bad "鄰居不在竟然 apply 過了(前置閘沒作用)"

printf '\n--- F. 前置閘:refund_amount 可為 NULL ⇒ apply 必須紅 ---\n'
build we nullable-amount
grep -q "不是 NOT NULL" "$D/mig-we.log" && ok "refund_amount 可 NULL ⇒ apply 被前置閘擋" || bad "可 NULL 竟然 apply 過了"

printf '\n--- G. 🔴 死結:兩個交易【交叉鎖兩張單】會怎樣?(交接檔標的那一格)---\n'
# T1: 先 A 後 B   T2: 先 B 後 A  ⇒ 教科書死結形狀
OA=$(mkorder wa); OB=$(mkorder wa)
FA="$D/fifo-t1"; rm -f "$FA"; mkfifo "$FA"
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 < "$FA" > "$D/t1.log" 2>&1 &
T1=$!
exec 8> "$FA"
printf 'BEGIN;\n' >&8
printf "insert into public.order_refunds(order_id,refund_amount) values ('%s',100);\n" "$OA" >&8
sleep 2
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 > "$D/t2.log" 2>&1 <<SQLT2 &
BEGIN;
SET LOCAL deadlock_timeout = '200ms';
insert into public.order_refunds(order_id,refund_amount) values ('$OB',100);
insert into public.order_refunds(order_id,refund_amount) values ('$OA',100);
COMMIT;
SQLT2
T2=$!
sleep 2
printf "insert into public.order_refunds(order_id,refund_amount) values ('%s',100);\n" "$OB" >&8
printf 'COMMIT;\n' >&8
exec 8>&-
wait $T1 2>/dev/null; wait $T2 2>/dev/null
rm -f "$FA"
DL=$( { cat "$D/t1.log" "$D/t2.log"; } | grep -c "deadlock detected" || true )
NA=$(Q wa "select count(*) from public.order_refunds where order_id='$OA'")
NB=$(Q wa "select count(*) from public.order_refunds where order_id='$OB'")
printf '  死結偵測訊息出現 %s 次 · A 單 %s 列 · B 單 %s 列\n' "${DL:-0}" "$NA" "$NB"
# 🔴 **兩個分支都叫 ok = 恆真格**(codex R1 must-fix,我第一版就是那樣寫的):
#    連鎖互動改到「完全構造不出死結」時,這一格照樣綠 ⇒ 它什麼都沒守。
#    ⇒ 本格的斷言是【這個形狀會構造出死結,而 PG 會處理掉】。
#      構造不出來 ⇒ **紅**,因為那表示我對鎖的理解變了,要有人回來看。
if [ "${DL:-0}" -ge 1 ] && [ "$NA" = "1" ] && [ "$NB" = "1" ]; then
  ok "死結發生 1 次 ⇒ PG 偵測並殺掉一個(40P01);兩張單各留 1 列 ⇒ 錢是安全的"
else
  bad "死結格:期望【偵測到 ≥1 次 且 兩張單各 1 列】,實得 DL=$DL A=$NA B=$NB"
fi

printf '\n--- M. PCM06:隔離級別不是 read committed ⇒ 擋(R3/fable F8 指的那一格)---\n'
MR=$(psql -h 127.0.0.1 -p $PORT -U postgres -d wa -tAq -c "
  begin isolation level repeatable read;
  do \$m\$ begin
    insert into public.order_refunds(order_id,refund_amount) values ('$(mkorder wa)',10);
    raise notice 'M-OK';
  exception when others then raise notice 'M-SQLSTATE=%', SQLSTATE;
  end \$m\$;
  rollback;" 2>&1 | sed -n 's/.*M-//p' | head -1 | tr -d '[[:space:]]')
printf '  repeatable read 下送一筆 ⇒ [%s]\n' "$MR"
[ "$MR" = "SQLSTATE=PCM06" ] && ok "隔離級別不是 read committed ⇒ 擋(PCM06)" \
  || bad "PCM06 沒擋:期望 SQLSTATE=PCM06 實得 [$MR]"

printf '\n--- L. 🔴🔴 更正判定競態:它拿到的是【鎖之後】的 cap 嗎?(R3/fable 指出的那一格)---\n'
# 🔴 **第一版只斷言「有人在等」⇒ 假綠**:把 FOR SHARE 搬到算 cap 之後,兩個世界【都】有人在等,
#    而突變版算到的是舊 cap ⇒ 錢會超。實測:那個突變讓 17 個世界全綠。
#    ⇒ **序列化 ≠ 用了序列化之後的 cap** ⇒ 本格改成斷言【結果】與【落地金額】。
# 形狀:訂單 1000、已有一列 failed+manual_failed 400(未更正 ⇒ 不佔額)
#   T1 鎖那一列 + 插一筆 money_moved 更正(⇒ cap 變 600),未 commit
#   T2 送 700 ⇒ 先鎖再算 ⇒ 等 T1 ⇒ 算到 600 ⇒ 700>600 ⇒ PCM04
#            ⇒ 先算再鎖 ⇒ 算到 1000 ⇒ 放行 ⇒ 落地 400+700=1100 > 1000 🔴
OL=$(mkorder wa)
RID=$(Q wa "insert into public.order_refunds(order_id,refund_amount,status,failed_reason)
            values ('$OL',400,'failed','manual_failed') returning id" | head -1 | tr -d '[[:space:]]')
# 🔴 **`psql -tAc` 對 `INSERT … RETURNING` 仍然會印指令標籤**(實測:回傳
#    `<uuid>\nINSERT 0 1`)⇒ 不 `head -1` 的話,uuid 後面黏著 "INSERT01"
#    ⇒ 每一發都 `invalid input syntax for type uuid`,而那條錯誤被 T1 的 log 吃掉。
# 🔴 **`Q` 的回傳要 trim** —— 帶著換行的 uuid 會讓下面每一發都 `invalid input syntax`,
#    而那條錯誤【被 T1 的 log 吃掉】⇒ 更正沒寫進去 ⇒ T2 拿到 OK
#    ⇒ **看起來像「繞路成立」,而實際上是我的 setup 壞了。**
#    📌 一個壞掉的 setup 與一個真的洞,在結果那一欄印同一個東西。
# 🔴 **而 trim 本身也錯過一次**:`tr -d '[:space:]'`(單層括號)刪的是
#    字元 `[ : s p a c e ]` 這幾個【字母】,不是空白 —— 要 `tr -d '[[:space:]]'`。
#    ⚠️ 而它先前【沒有咬到】,因為 `PCM04` / `OK` 剛好不含那幾個字母
#    ⇒ **一個一直是錯的寫法,靠資料剛好躲過去 —— 直到餵它一個 uuid。**
[ ${#RID} -eq 36 ] || { bad "世界 L:拿不到合法的 refund id(長度 ${#RID})⇒ 本格作廢,不是結論"; RID=""; }
FL="$D/fifo-lock"; rm -f "$FL"; mkfifo "$FL"
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 < "$FL" > "$D/l1.log" 2>&1 &
L1=$!
exec 6> "$FL"
printf 'BEGIN;\n' >&6
printf "select r.id from public.order_refunds r where r.id='%s' for no key update;\n" "$RID" >&6
printf "insert into public.order_refund_manual_corrections(refund_id,seq,corrected_to) values ('%s',1,'money_moved');\n" "$RID" >&6
sleep 2
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 > "$D/l2.log" 2>&1 <<SQLL2 &
BEGIN;
SET LOCAL lock_timeout = '15s';
do \$l2\$ begin
  insert into public.order_refunds(order_id,refund_amount) values ('$OL',700);
  raise notice 'L2-OK';
exception when others then raise notice 'L2-SQLSTATE=%', SQLSTATE;
end \$l2\$;
COMMIT;
SQLL2
L2=$!
sleep 2
printf 'COMMIT;\n' >&6
exec 6>&-
wait $L1 2>/dev/null; wait $L2 2>/dev/null
rm -f "$FL"
L2R=$(sed -n 's/.*L2-//p' "$D/l2.log" | head -1 | tr -d '[[:space:]]')
# 🔴 儀器:先確認【T1 那筆更正真的寫進去了】——
#    「鎖沒擋」與「更正沒落地」會讓 T2 都拿到 OK,而它們是兩件事。
LCORR=$(Q wa "select count(*) from public.order_refund_manual_corrections where refund_id='$RID'")
LCAP=$(Q wa "select public.pcm_order_refundable_remaining('$OL')")
printf 'DEBUG L: 更正列數=[%s] 事後 cap=[%s] T1log=[%s]\n' "$LCORR" "$LCAP" "$(tr '\n' ' ' < "$D/l1.log" | cut -c1-90)" >&2
LSUM=$(Q wa "select coalesce(sum(refund_amount),0) from public.order_refunds
             where order_id='$OL' and (status in ('processing','confirmed')
                or exists (select 1 from public.order_refund_effective_verdict v
                            where v.refund_id=order_refunds.id and v.corrected_to='money_moved'))")
printf '  T2 結果=[%s] · 該單佔額度總計=%s(訂單 1000)\n' "$L2R" "$LSUM"
if [ "$L2R" = "SQLSTATE=PCM04" ] && [ "$LSUM" = "400" ]; then
  ok "T2 拿到 PCM04 且佔額度停在 400 ⇒ 它算的是【鎖之後】的 cap"
else
  bad "🔴 T2=[$L2R] 佔額度=$LSUM ⇒ **它算到的是舊 cap(先算再鎖)** —— 錢超了"
fi

printf '\n--- K. 🔴🔴 第二條繞路?單一 multi-row INSERT(codex R2 指的那條)---\n'
# 一句 INSERT 塞兩列各 600(訂單 1000)。cap 函式是 STABLE ⇒ 它固定用 statement 起點的 snapshot
# ⇒ 兩列都可能讀到 cap=1000 而都放行。而這【在同一個交易裡】,鎖幫不上。
OK2=$(mkorder wa)
KR=$(psql -h 127.0.0.1 -p $PORT -U postgres -d wa -tAq -c "
  do \$k\$ begin
    insert into public.order_refunds(order_id,refund_amount) values ('$OK2',600),('$OK2',600);
    raise notice 'OK';
  exception when others then raise notice '%', SQLSTATE;
  end \$k\$;" 2>&1 | sed -n 's/^.*NOTICE: *//p' | head -1 | tr -d '[[:space:]]')
KN=$(Q wa "select count(*) from public.order_refunds where order_id='$OK2'")
KS=$(Q wa "select coalesce(sum(refund_amount),0) from public.order_refunds where order_id='$OK2'")
printf '  結果=[%s] 列數=%s 總額=%s(訂單 1000)\n' "$KR" "$KN" "$KS"
if [ "$KR" = "PCM04" ] && [ "$KN" = "0" ]; then
  ok "multi-row INSERT 被擋(PCM04)且零列落地 ⇒ 這條繞路【不成立】"
else
  bad "🔴🔴 **multi-row INSERT 繞得過去** —— 結果 $KR、落地 $KN 列、總額 $KS > 1000"
fi

printf '\n--- J. 後置斷言①b:有人插了一支排序在我前面的 trigger ⇒ apply 必須紅 ---\n'
build wj earlier-trigger
if grep -q "第一個 BEFORE INSERT trigger 是" "$D/mig-wj.log"; then
  ok "有人排在我前面 ⇒ apply 被後置斷言①b 擋(那道鎖的順序條件是活的)"
else
  bad "①b 沒有叫 —— 而那表示【鎖升級死結的前提】沒有被守著"
fi

printf '\n--- I. 鎖升級?兩邊都先拿到【與 RPC 同一把】FOR NO KEY UPDATE 再 INSERT ---\n'
# 正式庫的真形狀:admin_initiate_order_refund 步 3 先取 orders FOR NO KEY UPDATE ⇒ 才 INSERT
# ⇒ 我的 trigger 若取【更強】的鎖就是升級 ⇒ 死結;取【同一把】就是 no-op ⇒ 不死結。
OU=$(mkorder wa)
FU="$D/fifo-up"; rm -f "$FU"; mkfifo "$FU"
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 < "$FU" > "$D/u1.log" 2>&1 &
U1=$!
exec 7> "$FU"
printf 'BEGIN;\n' >&7
printf "select id from public.orders where id='%s' for no key update;\n" "$OU" >&7
sleep 2
psql -h 127.0.0.1 -p $PORT -U postgres -d wa -q -v ON_ERROR_STOP=0 > "$D/u2.log" 2>&1 <<SQLU2 &
BEGIN;
SET LOCAL deadlock_timeout = '200ms';
select id from public.orders where id='$OU' for no key update;
insert into public.order_refunds(order_id,refund_amount) values ('$OU',100);
COMMIT;
SQLU2
U2=$!
sleep 2
printf "insert into public.order_refunds(order_id,refund_amount) values ('%s',100);\n" "$OU" >&7
printf 'COMMIT;\n' >&7
exec 7>&-
wait $U1 2>/dev/null; wait $U2 2>/dev/null
rm -f "$FU"
UD=$( { cat "$D/u1.log" "$D/u2.log"; } | grep -c "deadlock detected" || true )
UN=$(Q wa "select count(*) from public.order_refunds where order_id='$OU'")
printf '  死結偵測 %s 次 · 該單留下 %s 列\n' "${UD:-0}" "$UN"
# 🔴 **只斷言「沒死結」= 恆綠路**(codex R2 must-fix):把 trigger 改成 `RETURN NULL`
#    ⇒ 兩列都不落地、也沒有死結 ⇒ 照樣綠。⇒ **要同時斷言【兩筆都真的寫進去了】。**
#    (兩筆各 100、訂單 1000 ⇒ 都合法 ⇒ 期望 2 列。)
if [ "${UD:-0}" -ge 1 ]; then
  bad "🔴🔴 **鎖升級死結成立** ⇒ 正式庫上同一張單的併發退款會互相死結"
elif [ "$UN" = "2" ]; then
  ok "沒有死結,而且兩筆各 100 都真的落地(2 列)⇒ 鎖是序列化不是擋掉"
else
  bad "沒死結,但只落地 $UN 列(期望 2)⇒ 有東西把它們吃掉了,這一格不算綠"
fi

printf '\n--- H. 突變:每一格都要有東西咬得到 ---\n'
# 🔴 **第一版只印不比、也不加 FAIL**(codex R1 must-fix)⇒ 兩個突變都沒翻格,
#    整支 harness 仍然 FAIL=0。⇒ 現在帶【期望值】,對不上就 FAIL。
mut() {  # $1=標籤 $2=樣式 $3=替換 $4=期望剛好上限 $5=期望併發列數
  local label="$1" pat="$2" rep="$3"
  local want1="$4" want2="$5"
  local MUTMIG="$D/mut.sql"
  python3 - "$MIG" "$pat" "$rep" > "$MUTMIG" 2>"$D/mut.err" <<'PYEOF'
import io,sys
src=io.open(sys.argv[1],encoding='utf-8').read()
if sys.argv[2] not in src:
    sys.stderr.write('PATTERN-MISS\n'); sys.exit(3)
sys.stdout.write(src.replace(sys.argv[2], sys.argv[3], 1))
PYEOF
  if [ $? -ne 0 ]; then bad "$label 突變樣式沒命中 ⇒ 作廢(不是綠)"; return; fi
  local db="mut$$_$RANDOM"; db=$(printf '%s' "$db" | tr -cd 'a-z0-9_')
  psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create database $db" >/dev/null 2>&1
  for role in anon authenticated service_role; do psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create role $role" >/dev/null 2>&1; done
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create table public.orders (id uuid primary key default gen_random_uuid(), total bigint not null);
create table public.order_refunds (id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id), refund_amount bigint not null,
  status text not null default 'processing', failed_reason text);
create function public.pcm_order_refundable_remaining(p_order_id uuid) returns bigint language sql stable as $$
  select o.total::bigint - coalesce((select sum(r.refund_amount) from public.order_refunds r
    where r.order_id=o.id and r.status in ('processing','confirmed')),0) from public.orders o where o.id=p_order_id $$;
create function public.pcm_a7c_noop() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger order_refunds_a7c_block_delete_bd before delete on public.order_refunds for each row execute function public.pcm_a7c_noop();
create trigger order_refunds_a7c_immutable_guard_bu before update on public.order_refunds for each row execute function public.pcm_a7c_noop();
SQL
  psql -h 127.0.0.1 -p $PORT -U postgres -d "$db" -q -f "$MUTMIG" >/dev/null 2>&1
  local oid; oid=$(mkorder "$db")
  local r1; r1=$(ins "$db" "$oid" 1000)
  local c; c=$(race "$db")
  psql -h 127.0.0.1 -p $PORT -U postgres -tAc "drop database $db" >/dev/null 2>&1
  if [ "$r1" = "$want1" ] && [ "$c" = "$want2" ]; then
    ok "$label ⇒ 翻了(剛好上限 $r1 · 併發 $c 筆)⇒ 那一行是承重的"
  else
    bad "$label ⇒ **沒翻**:期望[剛好上限=$want1 併發=$want2] 實得[$r1 / $c] ⇒ 該格不承重或突變沒生效"
  fi
}
#     標籤                    樣式                                    替換                                     期望剛好上限  期望併發列數
mut "M1 拿掉那道鎖      " "     FOR NO KEY UPDATE;" "     ;"                                                  "OK"    "2"
mut "M2 > 改成 >=      " "IF NEW.refund_amount > v_cap THEN" "IF NEW.refund_amount >= v_cap THEN"               "PCM04" "1"

printf '\n--- 收攤 ---\n'
LC_ALL=C pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D"
printf 'PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
