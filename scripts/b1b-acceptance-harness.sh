#!/usr/bin/env bash
# b1b-acceptance-harness.sh — B1-b / B2 migration 的 A 組驗收,可重跑
#
# 用法:bash scripts/b1b-acceptance-harness.sh [port]
#
# 出處:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §6 A 組。
# 🔴 為什麼要有這支檔:那九格原本是我手打的一次性命令,**壓縮/換 session 之後就沒了**。
#    「看到風險 → 寫下風險 → 處理風險」是三步,而寫下來不等於處理掉。
#
# 🔴🔴 本檔含【假綠實例】(F-FALSE-GREEN 那一格):
#    A2 在【沒有模擬 Supabase ALTER DEFAULT PRIVILEGES】的樁上【不會紅】。
#    那不是 bug,是樁的效度問題:原廠 PG 的新表本來就不會自動授權給 anon,
#    所以「拿掉一道 REVOKE」在樁上根本沒有事情可做。
#    ⇒ 這一格【刻意留在腳本裡】。拿掉它,下一個人重跑會看到漂亮的九格全綠,
#      而那正是我當時看到的假象。
set -uo pipefail

PORT="${1:-55699}"
D="/tmp/pgprobe_harness_$$"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B1B="$REPO/docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql"
B2="$REPO/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql"
PASS=0; FAIL=0

for f in "$B1B" "$B2"; do
  [ -f "$f" ] || { echo "🔴 找不到 $f" >&2; exit 2; }
done

psqlq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }

cell() { # cell <名稱> <預期 red|green> <命令...>
  local name="$1" expect="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  local got; if [ "$rc" -eq 0 ]; then got=green; else got=red; fi
  if [ "$got" = "$expect" ]; then
    PASS=$((PASS+1)); printf "  ✅ %-34s 預期 %-5s 實際 %-5s\n" "$name" "$expect" "$got"
  else
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 預期 %-5s 實際 %-5s\n" "$name" "$expect" "$got"
    echo "$out" | tail -2 | sed 's/^/       /'
  fi
}

run_sql_file() { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$1" > /dev/null 2>&1; }
run_sql()      { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -c "$1" > /dev/null 2>&1; }

cleanup() { pg_ctl -D "$D/data" stop -m fast > /dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT

echo "══ 起拋棄式 PG(port $PORT)══"
mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
# 🔴 macOS 上不加 LC_ALL=C 會報 postmaster became multithreaded during startup
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" start > /dev/null 2>&1
sleep 3
psqlq -c "select 1" > /dev/null || { echo "🔴 叢集起不來,看 $D/pg.log"; exit 2; }

# ── 樁 ────────────────────────────────────────────────────────────────────
# 🔴 這幾張表少建任何一張,對應的格子就會【紅在錯的地方】= 假紅:
#    auth_state/totp_devices/recovery_codes 缺 ⇒ A1 紅在「查無此表」而不是紅在 2FA 斷言
#    auth.users 缺或沒 seed 列               ⇒ A7 紅在 FK,對照組失效
mk_stub_base() {
  # 🔴 service_role 必須帶 BYPASSRLS —— 真 Supabase 是這樣,而樁不加的話
  #    「RLS 開 + 零 policy」會把 service_role 自己也擋掉,A9c 那格會紅。
  #    2026-08-16 就是這樣抓到「service_role 走 BYPASSRLS」是一個沒驗過的假設。
  run_sql "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
           create schema auth; create table auth.users (id uuid primary key);
           insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'),('aaaaaaaa-0000-0000-0000-000000000002'),('aaaaaaaa-0000-0000-0000-000000000003'),
             ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533'), ('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f');
           create table public.auth_state (id boolean primary key default true, require_2fa boolean not null default false);
           insert into public.auth_state (id, require_2fa) values (true,false);
           create table public.totp_devices (id uuid primary key default gen_random_uuid());
           create table public.recovery_codes (id uuid primary key default gen_random_uuid());"
}
mk_stub_adp() {
  # 🔴 模擬 Supabase 對 public schema 掛的 ALTER DEFAULT PRIVILEGES。
  #    少了這一行,A2 那格是恆綠的(見檔頭)。
  # 🔴🔴 **必須含 service_role**(關卡2 R2 實錘):真 Supabase 的 ADP 是
  #    `GRANT ALL … TO anon, authenticated, service_role` 三個。
  #    原版只給前兩個 ⇒ **A9 那格量的是一個 service_role 只有明文 GRANT 的世界**,
  #    而正式庫上 service_role 由 ADP 拿到 ALL ⇒ A9 在正式庫會是 green(UPDATE 成功)。
  #    **樁少了一個 grantee,對應的那一格就量錯世界。**
  run_sql "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
           alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;"
}
# 🔴 每加一個新物件,這裡要跟著加。2026-08-16 就是漏了 no_truncate ⇒ A0 之後全部連鎖紅,
#    而症狀看起來像「migration 壞了」,真因是【上一格沒清乾淨】。
drop_objs() { run_sql "drop table if exists public.admin_user_staff_map cascade;
                       drop function if exists public.admin_user_staff_map_no_delete();
                       drop function if exists public.admin_user_staff_map_no_truncate();
                       drop function if exists public.admin_user_staff_map_no_rebind();
                       drop role if exists inherited_writer;
                       drop role if exists col_only_writer;"; }

mk_stub_base

echo ""
echo "══ 第一段:【假綠實例】A2 在沒有 ADP 的樁上不會紅 ══"
drop_objs
sed '/^REVOKE ALL ON TABLE    public.admin_user_staff_map FROM anon, authenticated, service_role;$/d' "$B1B" > "$D/a2.sql"
if [ "$(diff <(wc -l < "$B1B") <(wc -l < "$D/a2.sql") > /dev/null; echo $?)" = "0" ]; then
  echo "  🔴 突變沒生效(行數沒變)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell "F-假綠 A2(無 ADP 樁)" green run_sql_file "$D/a2.sql"
  echo "     ↑ 預期就是 green。**拿掉一道 REVOKE 卻沒紅** —— 樁少了 ADP,那道 REVOKE 沒事情可做。"
fi

echo ""
echo "══ 第二段:補上 ADP 之後,九格才有判別力 ══"
mk_stub_adp
drop_objs
cell "A2 拿掉具名 REVOKE" red run_sql_file "$D/a2.sql"

drop_objs
cell "A0 整支跑" green run_sql_file "$B1B"

cell "A4 重跑同一支(撞名)" red run_sql_file "$B1B"

cell "A6 系統帳號 op4_backfill" red run_sql \
  "insert into public.admin_user_staff_map(auth_user_id,staff_id) values ('aaaaaaaa-0000-0000-0000-000000000001','op4_backfill');"
cell "A7 合法列 sean(對照)" green run_sql \
  "insert into public.admin_user_staff_map(auth_user_id,staff_id) values ('aaaaaaaa-0000-0000-0000-000000000001','sean');"
cell "A8 delete(被 trigger 擋)" red run_sql "delete from public.admin_user_staff_map;"
# 🔴🔴 A9 在 2026-08-16 關卡2 之後【反過來】了。
#    舊版:`update` 期望 green,理由寫「對照組,排除 trigger 把整張表鎖死」。
#    而關卡2 [高] finding 指出:UPDATE 可以直接換掉 auth_user_id/staff_id
#    ⇒ **與 DELETE+INSERT 完全相同的重綁效果** ⇒ 舊版 A9【在驗證一個漏洞是好的】。
#    現在 service_role 只有 SELECT/INSERT,UPDATE 必須紅。
# 🔴 必須 SET ROLE service_role 才量得對:harness 跑在 postgres(owner/superuser)身分下,
#    owner 無視 GRANT ⇒ 不切角色的話這一格【永遠 green】,而那正是它要抓的漏洞。
cell "A9 update as service_role(要紅)" red run_sql \
  "set role service_role; update public.admin_user_staff_map set staff_id='staff_1';"
cell "A9c insert as service_role(對照)" green run_sql \
  "set role service_role; insert into public.admin_user_staff_map(auth_user_id,staff_id) values ('aaaaaaaa-0000-0000-0000-000000000002','staff_1');"
# A8 真正的對照組是「表沒被鎖死」⇒ 用 SELECT,不用 UPDATE
cell "A9b select(對照:表沒鎖死)" green run_sql "select 1 from public.admin_user_staff_map limit 1;"
# 🔴🔴 A10:TRUNCATE —— 關卡2 R2 實跑證明它【不受 RLS 管、也不觸發 BEFORE DELETE trigger】
#    ⇒ 在 REVOKE 掉 TRUNCATE 之前,service_role 可以整表清空而零攔截。
#    兩層防護:主防線是 REVOKE、第二層是 BEFORE TRUNCATE trigger。這一格兩層一起驗。
cell "A10 truncate as service_role(要紅)" red run_sql \
  "set role service_role; truncate public.admin_user_staff_map;"
# 🔴🔴 A11(關卡2 R3 F-R3-1):UPDATE 的【持久】防線。
#    A9 證的是「service_role 現在沒有 UPDATE 權限」;A11 證的是
#    「**就算日後有人把 UPDATE 授回去,識別欄仍然改不動**」——
#    那正是我 justify no_truncate 時用的威脅模型(權限會被改回來),而我原本沒套到 UPDATE。
#    ⇒ 這一格【先把權限授回去】,再看 trigger 擋不擋得住。
# 🔴 GRANT 必須【單獨一次呼叫】,不能和會失敗的 UPDATE 放在同一個 run_sql ——
#    `psql -c` 的多語句是**單一隱式交易**(我 2026-08-16 六臂實測過的那條),
#    UPDATE 失敗會把前面的 GRANT 一起回滾 ⇒ 下一格 A11b 就沒有 UPDATE 權限、
#    紅在「permission denied」而不是紅在它要驗的東西。**那是假紅。**
run_sql "grant update on public.admin_user_staff_map to service_role;"
cell "A11 授回 UPDATE 後仍改不動識別欄" red run_sql \
  "set role service_role; update public.admin_user_staff_map set staff_id='staff_1';"
# 🔴 對照組:同一個世界(UPDATE 已授回)下,改【非識別欄】要成功 ——
#    沒有這一格,A11 的紅可能只是「trigger 把整張表鎖死」。
cell "A11b 同世界改非識別欄(對照)" green run_sql \
  "set role service_role; update public.admin_user_staff_map set created_at = created_at;"
run_sql "revoke update on public.admin_user_staff_map from service_role;"

# 🔴🔴 A12(關卡2 R3 F-R3-2):**角色繼承**的負向對照。
#    原斷言用 aclexplode(relacl) ⇒ 只看直接 ACL ⇒ 繼承來的權限它看不見。
#    這一格構造一個「service_role 繼承一個持有 UPDATE 的角色」的世界,
#    **新斷言(has_table_privilege / has_column_privilege)必須抓到。**
#    ⚠️ 沒有這一格,我只是把一個證不了的東西換成另一個。
drop_objs
run_sql "create role inherited_writer;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant update on public.admin_user_staff_map to inherited_writer;
         grant inherited_writer to service_role;"
cell "A12 繼承來的 UPDATE 要被斷言抓到" red run_sql_file "$B1B"
echo "     ↑ 這一格重跑整支:前提斷言先撞名紅之前,收權斷言不會跑到"
echo "       ⇒ 若它紅在撞名而不是紅在收權,這格【沒有判別力】,見下方單獨的斷言重跑"
# 🔴 上一格會先撞名 ⇒ 判別力不足。單獨把【收權斷言那一段】抽出來重跑才算數。
cell "A12b 單獨重跑收權斷言(繼承世界)" red run_sql \
  "DO \$t\$ DECLARE v_reach text; BEGIN
     SELECT string_agg(r.rolname, ', ') INTO v_reach FROM pg_roles r
      WHERE pg_has_role('service_role', r.oid, 'SET') AND r.rolname <> 'service_role'
        AND has_table_privilege(r.oid, to_regclass('public.admin_user_staff_map'), 'UPDATE');
     IF v_reach IS NOT NULL THEN RAISE EXCEPTION 'A12b: 可 SET ROLE 到的角色持有 UPDATE: %', v_reach; END IF; END \$t\$;"
# 🔴🔴 A12b2:證明【R3 建議的那個修法單獨用還不夠】——
#    has_table_privilege 對 NOINHERIT 成員身分是【看不到】的(2026-08-16 實測:
#    set role 過去真的 UPDATE 1,而 has_table_privilege 回 f)。
cell "A12b2 只用 has_table_privilege(應綠=看不到)" green run_sql \
  "DO \$t\$ BEGIN
     IF has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), 'UPDATE')
       THEN RAISE EXCEPTION 'A12b2: has_table_privilege 看到了'; END IF; END \$t\$;"
cell "A12c 同段對【舊查法】(relacl)—— 應該綠(證明舊查法看不到)" green run_sql \
  "DO \$t\$ DECLARE v_sr text; BEGIN
     SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) INTO v_sr
       FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = to_regclass('public.admin_user_staff_map')
        AND a.grantee::regrole::text = 'service_role';
     IF coalesce(v_sr,'') <> 'INSERT,SELECT' THEN RAISE EXCEPTION 'A12c: %', v_sr; END IF; END \$t\$;"
# 🔴🔴 A13:第三道的【欄級那一半】—— V 窗 2026-08-16 完整性註記,而我原本要當 nil 收掉。
#    構造:某個可 SET ROLE 過去的角色【只有】欄級 UPDATE(auth_user_id),沒有表級。
#    ⚠️ 這一格的存在理由不是可達性高(它很低),是**改那一欄 = 把某人的登入重綁到別人的員工身分**。
#       低可達性 × 高後果 = 正好是沒人會去看的那一格。
drop_objs
run_sql "create role col_only_writer;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant update (auth_user_id) on public.admin_user_staff_map to col_only_writer;
         grant col_only_writer to service_role;"
cell "A13 第三道(含欄級)要抓到【只有欄級】的可達角色" red run_sql \
  "DO \$t\$ DECLARE v_reach text; BEGIN
     SELECT string_agg(r.rolname, ', ') INTO v_reach FROM pg_roles r
      WHERE pg_has_role('service_role', r.oid, 'SET') AND r.rolname <> 'service_role'
        AND (has_table_privilege(r.oid, to_regclass('public.admin_user_staff_map'), 'UPDATE')
          OR EXISTS (SELECT 1 FROM unnest(ARRAY['auth_user_id','staff_id']::text[]) AS c(col)
                      WHERE has_column_privilege(r.oid, to_regclass('public.admin_user_staff_map'), c.col, 'UPDATE')));
     IF v_reach IS NOT NULL THEN RAISE EXCEPTION 'A13: 可達角色持有欄級 UPDATE: %', v_reach; END IF; END \$t\$;"
# 🔴 對照組:同一個世界,把欄級那一半拿掉 ⇒ **必須綠**,否則 A13 的紅不是欄級抓到的。
cell "A13b 同世界只留表級(應綠=表級看不到欄級)" green run_sql \
  "DO \$t\$ DECLARE v_reach text; BEGIN
     SELECT string_agg(r.rolname, ', ') INTO v_reach FROM pg_roles r
      WHERE pg_has_role('service_role', r.oid, 'SET') AND r.rolname <> 'service_role'
        AND has_table_privilege(r.oid, to_regclass('public.admin_user_staff_map'), 'UPDATE');
     IF v_reach IS NOT NULL THEN RAISE EXCEPTION 'A13b: %', v_reach; END IF; END \$t\$;"
echo "     ↑ 🔴 A13 紅 + A13b 綠 = 欄級那一半【真的在做事】,不是抄來的裝飾"

echo "     ↑ 🔴 A12b 紅 + A12c 綠 = **同一個世界,新查法看得到、舊查法看不到**"
echo "       這一對才是 F-R3-2 的證據;只有 A12b 的話證不了「換了才抓得到」"

drop_objs
# 🔴 突變要錨在【現在真的存在】的那一行。2026-08-16 移除 UPDATE 授權之後,
#    舊 pattern(含 UPDATE)不再命中 ⇒ 突變靜默沒生效 ⇒ 這一格顯示 green 而它該 red。
#    ⇒ 下面加一道【突變生效檢查】,不靠人記得。
sed 's|^GRANT SELECT, INSERT ON TABLE public.admin_user_staff_map TO service_role;|&\nGRANT SELECT (staff_id) ON TABLE public.admin_user_staff_map TO anon;|' "$B1B" > "$D/a3.sql"
if [ "$(grep -c 'GRANT SELECT (staff_id)' "$D/a3.sql")" != "1" ]; then
  echo "  🔴 A3 突變沒生效(找不到錨點行)—— 這一格失去判別力,不是通過"; FAIL=$((FAIL+1))
else
  cell "A3 只給欄級授權" red run_sql_file "$D/a3.sql"
fi

drop_objs
run_sql "update public.auth_state set require_2fa=true;"
cell "A1 require_2fa=true" red run_sql_file "$B1B"
# A1 的第二半:整支必須回滾 —— 紅了但表建出來就沒有原子性
N=$(psqlq -c "select count(*) from pg_tables where tablename='admin_user_staff_map';")
if [ "$N" = "0" ]; then
  PASS=$((PASS+1)); printf "  ✅ %-34s 表未被建出(整支回滾)\n" "A1b 原子性"
else
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 表被建出來了(%s)⇒ 沒有原子性\n" "A1b 原子性" "$N"
fi
run_sql "update public.auth_state set require_2fa=false;"

echo ""
echo "══ 第三段:B2 seeding ══"
drop_objs
run_sql_file "$B1B"
# 🔴 2026-08-16 B2 已填入真 uuid ⇒ 這幾格全部改寫。
#    原版是照【佔位符】寫的:把 00000000-… 換成樁裡的 aaaaaaaa-…。
#    檔案填了真值之後,那個替換【一個字都沒換到】⇒ S2/S4/S5 全部失去判別力,
#    而 S5 甚至直接報「突變沒生效」。**harness 自己叫了,不是事後才發現。**
#    ⇒ 現在改成:樁直接 seed 那兩個【真 uuid】,B2 原檔照跑。
S1_FILE="$D/seed_placeholder.sql"
sed -e "s/'f5fb22ee-29f8-4af9-83b8-7fc9121eb533'/'00000000-0000-0000-0000-000000000001'/g" \
    -e "s/'63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f'/'00000000-0000-0000-0000-000000000002'/g" \
    "$B2" > "$S1_FILE"
if [ "$(grep -c '00000000-0000-0000-0000-00000000000' "$S1_FILE")" -lt 4 ]; then
  echo "  🔴 S1 突變沒生效(找不到真 uuid 可換)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell "S1 還原成佔位符後跑" red run_sql_file "$S1_FILE"
fi
cell "S2 B2 原檔(真 uuid)" green run_sql_file "$B2"
cell "S3 重跑(表已非空)" red run_sql_file "$B2"
IDS=$(psqlq -c "select string_agg(auth_user_id::text||'='||staff_id,',' order by staff_id) from public.admin_user_staff_map;")
EXPECT='63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f=sean,f5fb22ee-29f8-4af9-83b8-7fc9121eb533=staff_2'
EXPECT_OK='f5fb22ee-29f8-4af9-83b8-7fc9121eb533=sean,63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f=staff_2'
# 🔴 驗【精確配對】不是驗集合 —— 兩個 uuid 對調之後集合一樣,而每個人拿到別人的身分。
if [ "$IDS" = "$EXPECT_OK" ]; then
  PASS=$((PASS+1)); printf "  ✅ %-34s %s\n" "S4 兩列精確配對" "sean/staff_2 各就各位"
else
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 實際 '%s'\n" "S4 兩列精確配對" "$IDS"
fi

# 🔴🔴 S5:關卡2 [高] finding —— 兩個 uuid 對調之後,若只驗集合就【仍然全綠】。
#    這一格證明落地斷言抓得到對調。
drop_objs
run_sql_file "$B1B"
sed -e "s/('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean')/('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'sean')/" \
    -e "s/('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'staff_2')/('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'staff_2')/" \
    "$B2" > "$D/seed_swapped.sql"
if diff -q "$B2" "$D/seed_swapped.sql" > /dev/null; then
  echo "  🔴 S5 突變沒生效(兩份檔一樣)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell "S5 兩個 uuid 對調" red run_sql_file "$D/seed_swapped.sql"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
printf "通過 %s 格 / 失敗 %s 格\n" "$PASS" "$FAIL"
echo "⚠️ 這些綠只證『SQL 與約束邏輯對』——【樁與真 Supabase 有落差】"
echo "   (樁沒有真 auth schema 的角色/權限/trigger)。真的驗要在等價 baseline 上做。"
[ "$FAIL" = "0" ] || exit 1
exit 0
