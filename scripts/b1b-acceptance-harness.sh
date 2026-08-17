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

# 🔴 **`-X` 是承重的,不是潔癖**(adversarial-reviewer 2026-08-17 `F1`,已量到的假綠路徑):
#    不加 `-X` ⇒ psql 讀 `~/.psqlrc`。那裡若有 `\set ECHO all`,**輸入的 SQL 會被回印進輸出**
#    ⇒ 下面 A20 用 `grep 'RLS 沒開'` 掃輸出時,會掃到 **B2 檔案自己那句字串**、而不是真正的錯誤訊息
#      ⇒ **B2 明明紅在別的原因(例如找不到 relation),那一格照樣印 ✅。**
#    📎 形狀 = **偵測字串自命中**(本 repo `feedback_assertion-measures-the-wrong-thing` 有記)。
#    ⚠️ Sean 這台目前沒有 `~/.psqlrc`(查無)⇒ **今天不會發作**;而這支檔的賣點就是「下一個人重跑」。
#    ⇒ 五處 psql 一律 `-X`,且該格的 grep 另外錨到 `ERROR:`(**不帶 `^`**)—— 兩道都做,不擇一。
# ⚠️🔴 **這一行原本寫「錨到 `^ERROR:`」,那是【已被證偽】的字面,2026-08-17 改掉**
#    (code-reviewer 抓;同檔 A20 那格的註解早就寫明「`^ERROR:` 永遠不會命中」——
#     psql 的錯誤行是 `psql:<檔>:<行>: ERROR:  …`,**前面有前綴**)。
#    🔴 **檔頭是「指示」,下一個人會照它把 code 修齊** ⇒ 留一個被證偽的字面在這裡,
#      等於指示別人**裝回一個永遠不會叫的偵測器**。這比註解過期嚴重一級。
psqlq() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }

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

# cell_red_msg <名稱> <訊息片段> <sql 檔>  —— 「紅」而且「紅對地方」
# 🔴 2026-08-17 B 窗審 B2 加:原本 S1/S3/S5 三格用 `cell … red`,那只驗【有沒有紅】。
#    具體會壞的例子(已量,不是假想):S1 把 uuid 換成 `00000000-…-0001/0002`,
#    而那兩個 uuid **不在樁的 auth.users 裡** ⇒ 0.3(uuid 不存在)也會紅。
#    今天紅在 0.2 純粹因為 0.2 排在 0.3 前面 —— **任何人重排 DO 區塊內的順序,
#    S1 就悄悄改成在測 0.3,而它照樣印 ✅**。這一格從此測錯東西,零訊號。
# 🔴 兩道錨都要:`ERROR:`(不帶 `^`,psql 的錯誤行前面有 `psql:<檔>:<行>: ` 前綴)+ 訊息片段。
cell_red_msg() {
  local name="$1" needle="$2" f="$3" out rc
  out="$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 沒紅(預期 red)\n" "$name"
  elif printf '%s' "$out" | grep -q 'ERROR:' && printf '%s' "$out" | grep -qF "$needle"; then
    PASS=$((PASS+1)); printf "  ✅ %-34s 紅,且訊息含「%s」\n" "$name" "$needle"
  else
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 紅了但訊息沒有「%s」⇒ 紅錯地方\n" "$name" "$needle"
    printf '%s\n' "$out" | tail -2 | sed 's/^/       /'
  fi
}

# assert_anchor <期望命中數> <pattern> <檔>  —— 突變前先證錨點唯一
# 🔴 B-580 §3-2:本線兩次被它擋下(`^UPDATE public.staff$` 命中 2 次、`IS DISTINCT FROM` 命中 4 次)。
#    沒有這道,產出的是「紅得理直氣壯但測錯東西」的格。
assert_anchor() {
  local want="$1" pat="$2" f="$3" got
  # ⚠️ code-reviewer 2026-08-17 [nit]:`grep -c` 數的是【行數】不是【出現次數】——
  #    同一行出現兩次會回報 1。另外這裡用 `-F`(固定字串)而下游 sed 吃 BRE,
  #    錨點若帶 regex 元字元,兩者的判斷會不一致。目前 S11/S12 的錨點無元字元 ⇒ 今天不發作。
  got=$(grep -cF "$pat" "$f")
  [ "$got" = "$want" ] && return 0
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 錨點命中 %s 次(預期 %s):%s\n" "錨點唯一性" "$got" "$want" "$pat"
  return 1
}

run_sql_file() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$1" > /dev/null 2>&1; }

# apply_b1b —— 前置用的 B1-b apply,失敗一律 **exit 2**(= harness 自壞),不進 FAIL 計數
# 🔴 2026-08-17 主視窗轉 E 窗的守門四要件第 ② 條:
#    「輸出層:通道分得出【通過】【真發現】【工具自壞】嗎?綠燈不可以同時代表『沒問題』和『沒檢查成』」
#    本檔的 rc 本來就分三段(0=通過 / 1=有格紅 / **2=自壞**),而 **B1-b apply 失敗以前會落進 1**
#    ⇒ 讀 rc 的人(CI、上層腳本)會把「migration 根本沒裝起來」讀成「斷言抓到問題」——
#      兩件相反的事共用一個出口。⇒ 這一支把前置失敗改判 2。
#    ⚠️ 誠實邊界(數字都是當場 `grep -c` 出來的,不是估的):
#       換成 `apply_b1b` 的行首前置 = **19** 處(`grep -c '^\(drop_objs; \)\?apply_b1b$'`)。
#       仍留 `run_sql_file "$B1B"` 的 **17** 處(`grep -c 'run_sql_file "\$B1B"'` 扣掉本註解那 2 行)組成:
#         · **4** 處在 `cell … red/green` 內(A0/A4/A12/A1)—— 那幾格 B1-b 失敗**才是正確結果**,不能 exit;
#         · **10** 處帶 `> /dev/null 2>&1` 或寫在 `if` 條件裡 —— 換成會 `exit` 的版本,`exit` 未必傳得出子殼;
#         · 其餘為 `apply_b1b` 自己內部那一行 + 註解引用。
#       🔴 **那 10 處尚未收**:它們自壞時靠 `cell_red_msg` 的訊息錨報「紅錯地方」——
#          **會叫**(不會靜靜變綠,第 ② 條的關鍵半邊是守住的),**但會被歸到 rc=1** ⇒ 通道仍未完全分開。
apply_b1b() {
  run_sql_file "$B1B" && return 0
  echo "🔴 harness 自壞:B1-b 原檔 apply 失敗(不是斷言抓到東西)。" >&2
  echo "   ⇒ 這一發 exit 2 而不是 1,讓讀 rc 的人分得出「工具沒起來」與「真發現」。" >&2
  psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$B1B" 2>&1 | tail -3 | sed 's/^/   /' >&2
  exit 2
}
run_sql()      { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -c "$1" > /dev/null 2>&1; }

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
                       drop role if exists col_only_writer;
                       drop role if exists outsider_writer;
                       drop role if exists col_insert_outsider;
                       drop role if exists zero_priv_reachable;
                       drop role if exists ma2_inherit_writer;
                       drop role if exists ma2_setonly_writer;
                       drop role if exists ma2_setonly_maint;"; }
# 🔴 **上面的角色登記漏掉任何一個,症狀【不在它自己那一格】**:
#    (數法:`grep -c 'drop role if exists' <本檔>`;與 `grep -c 'create role' <本檔>` 對照,
#     後者含同一角色在不同格重建 ⇒ 兩數不必相等,但**每個被 create 的名字都要在上面出現過**。)
# ⚠️ 2026-08-17 兩處修正(code-reviewer 抓):
#    · 原句寫「上面**三個**是新增的」而實際新增 **6** 個
#      (outsider_writer / col_insert_outsider / zero_priv_reachable /
#       ma2_inherit_writer / ma2_setonly_writer,加上已移除的 reach_inserter)
#    · `reach_inserter` 已刪:全檔**零處** `create role reach_inserter`(A18 拆除後的遺留)
#      ⇒ 留著無害,但會讓下一個人去找一個不存在的格子。
#    `DROP ROLE` 在角色仍持有物件權限時**會失敗**,而 `run_sql` 吞 stderr ⇒ 角色悄悄留著
#    ⇒ 它仍可達、仍有 INSERT ⇒ **後面每一次 `run_sql_file "$B1B"` 的斷言都會紅**
#    ⇒ 表建不起來 ⇒ **壞掉的是 B2 seeding 那幾格**(實際症狀:S4 報「relation does not exist」)。
#    📎 形狀:**清理沒做乾淨,而帳算在下游** —— 讀 S4 的人會以為 B2 有問題。
#    ⇒ 角色一律登記在 drop_objs(它先 `drop table … cascade`,權限跟著走,DROP ROLE 才不會被擋)。

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
echo "     ↑ 🔴 A12b 紅 + A12c 綠 = **同一個世界,新查法看得到、舊查法看不到**"
echo "       這一對才是 F-R3-2 的證據;只有 A12b 的話證不了「換了才抓得到」"
# ⚠️ 這兩行 2026-08-17 從檔尾搬回這裡(adversarial-reviewer `N1`):
#    它們原本印在 **MA-2 的輸出正下方**(距 A12c 約 430 行)⇒ 讀的人會把它讀成 MA-2 的結論。
#    📎 解說要黏在它解說的那一格旁邊,不是黏在**寫的時候游標所在的位置**。
# 🔴🔴 A13 家族:第三道的【欄級那一半】—— V 窗 2026-08-16 完整性註記,而我原本要當 nil 收掉。
#    構造:某個可 SET ROLE 過去的角色【只有】欄級權限,沒有表級。
#    ⚠️ 這幾格的存在理由不是可達性高(它很低),是**改那些欄 = 動到誰是誰**。
#       低可達性 × 高後果 = 正好是沒人會去看的那一格。
#
# ⚠️🔴 **2026-08-17 V-020 `F-V20-2` 折:這幾格原本跑的是【手抄複本】。**
#    複本當時抄了 UPDATE 臂,而 migration 本體有 UPDATE/DELETE/TRUNCATE/REFERENCES 四臂
#    ⇒ **把本體的 REFERENCES 臂整條刪掉,格子照樣全綠**(該臂零負測),
#      而且日後有人改本體、複本不跟著動,這裡照紅照給信心。
#    🔴 **「A13 紅」證的是【這個查法形狀】抓得到,不證【migration 檔裡那道】會抓到。**
#
#    ⇒ **修法不是「補一格 REFERENCES」** —— 那只修掉今天這一個症狀,而病(複本會漂)還在。
#      **改成從 migration 本體【抽】那段 DO block 來跑,複本消失。**
GUARD_SQL="$D/newobj_guard.sql"
extract_guard() {
  # 🔴 **抽之前先證錨點是唯一的**(codex `harness:210`):dollar tag **可以合法重複** ——
  #    來源若先出現另一個同名 block(例如有人複製這段去改),awk 會**抽到第一個**,
  #    而「逐字找得回」與「尾行是 $newobj_guard$;」**兩道檢查都會過**,所有 A13 格照樣全綠。
  #    ⇒ 那是一個抽錯段而完全沒有症狀的世界。數法在下,不是靠讀的:
  local n_open n_close
  n_open=$(grep -c '^DO \$newobj_guard\$'  "$B1B")
  n_close=$(grep -c '^\$newobj_guard\$;'   "$B1B")
  if [ "$n_open" != "1" ] || [ "$n_close" != "1" ]; then
    echo "🔴 錨點不唯一:開頭 $n_open 個 / 結尾 $n_close 個(各要恰好 1)⇒ awk 會抽錯段而且不會有症狀"
    return 1
  fi
  # 錨點 = dollar-quote tag 本身(穩定、不是我另外加的標記;唯一性由上面那道現數現證)
  awk '/^DO \$newobj_guard\$/{i=1} i{print} i && /^\$newobj_guard\$;/{exit}' "$B1B" > "$GUARD_SQL"
  [ -s "$GUARD_SQL" ] || { echo "🔴 抽取產物是空的"; return 1; }
  # 🔴 自我驗①:抽出來的必須能在來源檔【逐字】找回(不是「看起來像」)。多行 ⇒ 用 python 不用 grep。
  # 🔴 用 `return 1` 不用 `exit 1`(adversarial-reviewer 2026-08-17 `N4`):
  #    本檢查住在 `extract_guard()` 裡,`exit 1` 會**直接結束整支腳本**
  #    ⇒ 呼叫端的 `|| { echo "🔴 A13 家族的 SQL 抽取失敗 ⇒ 停…"; exit 2; }` **永遠跑不到**,
  #      操作者看到的是另一則訊息 + exit 1。**錯誤處理寫了但到不了 = 和沒寫一樣。**
  python3 - "$B1B" "$GUARD_SQL" <<'PY' || { echo "🔴 抽出來的內容不能在來源檔逐字找回"; return 1; }
import io,sys
src=io.open(sys.argv[1],encoding='utf-8').read()
got=io.open(sys.argv[2],encoding='utf-8').read()
sys.exit(0 if got and got in src else 1)
PY
  # 🔴 自我驗②:必須抽到【結尾】。抽到一半的產物可能語法剛好合法 ⇒ 跑起來綠而斷言不完整。
  [ "$(tail -1 "$GUARD_SQL")" = "\$newobj_guard\$;" ] || { echo "🔴 抽取沒抽到 block 結尾"; return 1; }
  # 📌 **各道斷言的完整性【刻意不在這裡做字面檢查】**(2026-08-17 第一版做了,當場自己打回):
  #    ⚠️ 這句原本寫「**四臂**的完整性」—— 四臂已被丙案換掉(見下面 `:260` 自己說了),
  #       屬過期措辭,2026-08-17 改掉(adversarial-reviewer `N2`)。
  #    字面檢查會【嚴格蘊含】下面的 A13/A13c/A13d —— 整臂被刪時這裡先紅、那三格永遠跑不到,
  #    ⇒ 它們就變成**寫不出「只紅它」的負測**的裝飾格
  #      (本 repo `feedback_unconstructible-negative-test-means-noop-guard` 記的正是這個形狀)。
  #    🔴 實測過:第一版拿掉 REFERENCES 臂 ⇒ 只有這道叫、A13d 一次都沒跑。
  #    ⇒ 改由【行為格】守,每一格都能被單獨打紅。字面層只留「有沒有抽完」。
  #
  # ⚠️🔴🔴 **下面這張表 2026-08-17 由 B 窗整個重測重寫 —— 舊版是【過期字面】。**
  #    舊版逐臂寫「欄級 UPDATE → A13/A13c 各自可單獨打紅(突變 B)」「欄級 REFERENCES → A13d(突變 A)」。
  #    那些話是對**舊的手寫四臂結構**說的,而丙案已經把四臂換成【儲存層直讀三層制】——
  #    **臂沒了,而宣稱留著。** 讀的人會以為那三格在守第 2 層的欄級查法,它們沒有。
  #
  # 🔴 **現況以【停用某一段 ⇒ 誰翻綠】實測重建**(B 窗 2026-08-17,PG 17.10 拋棄式樁,
  #    每發的錨點唯一性都在突變當下 assert)。
  #
  # 📌📌 **完整的突變覆蓋表【正本在別的檔】,這裡不複製一份:**
  #        `docs/specs/2026-08-17-b1-apply-preflight.md` §「突變覆蓋」
  #        (含六發的錨點、替換方式、翻綠的格、兩個不同基線的註記,以及可重跑的步驟)
  #
  # ⚠️🔴 **這裡原本抄了一份五列的表,而它在我加了第六發之後就過期了**
  #    (code-reviewer 2026-08-17 抓;分類=**複本不同步**,不是「無斷言」)。
  #    ⇒ 修法是**讓複本指回正本**,不是兩邊各補一次 ——
  #      兩份都維護的東西,遲早只有一份被維護,而另一份讀起來一樣有說服力。
  #
  # 只留一句對讀這支腳本的人最要緊的結論:
  #    **`v_reach` 的欄級臂零行為格,那是【構造不出來】不是漏做**(欄級授權必進 attacl
  #    ⇒ 第 1 層必定搶先紅 ⇒ 沒有「只有欄級臂會紅」的世界)。**不要把它讀成待補的格。**
  #
  # 🔴🔴 **`A13` / `A13c` / `A13d` 在上面三發突變裡【全部照樣紅】** ——
  #    它們的世界(可達角色 + 欄級授權)**同時**被 `attacl` sweep 與 `v_reach` 抓到
  #    ⇒ **雙重覆蓋 ⇒ 它們隔離不出任何一段。** 它們證的是「這個世界會被擋下來」(仍有價值),
  #    **不證「哪一道在擋」**。⚠️ 不要再拿它們當某一段的專屬負測。
  #    📎 附帶作廢:檔內原有兩句 echo「A13c 是 F-V20-1 的負測:換回兩欄枚舉這一格就綠」
  #       「A13d 是 F-V20-2 的負測:REFERENCES 臂刪掉這一格就綠」—— **兩句都已不成立**,
  #       現行 `v_reach` 的欄級那半是 `has_any_column_privilege` 掃四種權限、**沒有逐欄枚舉、沒有 REFERENCES 臂**。
  #       (推導依據:停用**整段** `v_reach` 後 A13d 仍紅;單調性 ⇒ 更弱的突變不可能讓它翻綠。
  #        🔴 **這一條是【推出來的】不是單獨量到的** —— 我量的是整段停用那一發。)
  #    · **表級推導集的 owner 來源 → 【本 harness 覆蓋不到】= 樁的限制,不是忘了。**
  #      本檔的 `initdb -U postgres` **寫死了 superuser 叫 postgres** ⇒ 樁上永遠有 `postgres` 這個角色
  #      ⇒ 「`acldefault('r','postgres'::regrole)` 在沒有該角色的叢集上會 ERROR」這件事
  #      **在這支 harness 裡構造不出來**(要改 initdb 的 -U,而那會換掉每一格的世界)。
  #      🔴 B 窗 2026-08-17 **另起一顆 `initdb -U bossman` 的叢集**實測過:
  #        `pg_roles` 內 `postgres` 計數 **0** / `bossman` 計數 **1**(正向對照)
  #        ⇒ 寫死版當場 `ERROR: role "postgres" does not exist`;改用 `relowner` 版正常回 8 項。
  #      ⇒ **已改用 `oc.relowner`**(`b1b-migration-draft.sql` 第 2 層表級那段),
  #        但**這個回歸在本 harness 內沒有格子守著** —— 認列為缺口,不假裝有覆蓋。
  #    · **表級 DELETE / TRUNCATE   → 【沒有專屬負測】= 未做,不是做不到。**
  #      ⚠️🔴 **這裡原本寫「不是漏做,是構造不出來」,那句已被推翻(codex R2 `harness:242`)。**
  #      它給了構造法:**讓一個 SET-only 可達的普通角色成為【表 owner】**,撤掉一般權限後只授其中一項
  #      ⇒ `v_extra` 段明文排除 owner ⇒ **只有指定的那一臂會紅**。
  #      (官方:owner 可以撤掉自己的普通權限 https://www.postgresql.org/docs/17/ddl-priv.html)
  #      📎 教訓照本 repo `feedback_unconstructible-negative-test-means-noop-guard` 的反向坑:
  #        **宣告「構造不出」之前要窮舉維度** —— 我只想到「授權給誰」,沒想到「**誰是 owner**」。
  #        A14 之所以假紅是因為我把角色留在 v_extra 的射程內,而 owner 正好在射程外。
  #      ⇒ **待補格,已列入待辦。在補上之前,那兩臂是零覆蓋。**
  #    · `v_extra` 白名單段          → `A16`          ← 可單獨打紅(突變 G 實測,只有它翻綠)
  #      ⚠️ **窄義**:A16 的世界是【表級】outsider;**欄級 outsider 它抓不到**(codex R2 `b1b:476`)。
  #    · service_role 權限清單完整性 → `A15`          ← 可單獨打紅(突變 F 實測,只有它翻綠)
  #      ⚠️ **窄義**:A15 只守 **service_role 那一份**清單;
  #        **anon/authenticated 那一份清單漏掉 MAINTAIN,A15 不會發現**(codex R2 `harness:326`)。
  #
  # 🔴🔴 **還有一條【我主張過而被推翻】的,留痕**:我曾主張「欄級前提可被表級冒充」由 A13b 守住,
  #    ⇒ **不成立**(codex R2 逐條核對第 4 項):A13b 只守**它自己那個世界**;
  #    **只要 A13c 或 A13d 的世界漂成表級授權,欄級前提仍為真、本體由 `v_extra` 報紅、A13b 照綠 ⇒ 整支全綠。**
  #    📎 形狀:**我用「既有格守得住」取代了「新增一格」,而那個既有格的射程比我以為的窄。**
  #    ⇒ **待補**:A13c / A13d 各自需要「這個世界真的是欄級」的守門(不能共用 A13b 那一格)。
  return 0
}
extract_guard || { echo "🔴 A13 家族的 SQL 抽取失敗 ⇒ 停,不要用手抄版頂替"; exit 2; }
echo "     ℹ️  A13 家族跑的是【從 $B1B 抽出的本體】($(wc -l < "$GUARD_SQL" | tr -d ' ') 行),不是手抄複本"

# 🔴 A13e:**乾淨世界跑本體 ⇒ 必須綠**。這一格接住「抽取產物壞掉」那條路 ——
#    抽到一半 / 語法壞 ⇒ 這裡紅。沒有它的話,壞掉的產物在下面三格會【紅在錯的地方】,
#    而那三格預期就是紅 ⇒ **看起來全部通過**。
drop_objs
run_sql "create role col_only_writer;"
run_sql_file "$B1B" > /dev/null 2>&1
cell "A13e 乾淨世界跑本體(應綠=沒有可達角色時不誤報)" green run_sql_file "$GUARD_SQL"
# ⚠️ **A13e 的界限,明寫免得它被當成比它強的東西**(codex `harness:232`,`nit`):
#    它只證「抽出物**跑得動**、且乾淨世界**不誤報**」。它**不證**抽出物的斷言完整 ——
#    一段**語法合法但少了斷言**的片段在這一格照樣綠。
#    而且前面的格早就跑過來源本體 ⇒ **這一格不能當「抽取正確」的證據**。
#    抽取正確性靠的是另外兩道:錨點唯一性(數法在 extract_guard)+ 逐字找得回。

# 各格【各自獨立的世界】:三種權限若授在同一個世界,任一臂都能讓其他格紅
# ⇒ 拿掉某一臂也不會有格子變綠 = 互相遮蔽。每格必須重置。
# 🔴🔴 **欄位選 `created_at` 不是 `label`** —— V-020 `F-V20-1` 的**結論對、失敗情境錯**:
#    它寫「角色只被授 UPDATE(label) ⇒ 枚舉盲」,而 **`admin_user_staff_map` 沒有 `label` 欄**
#    (欄位只有 auth_user_id / staff_id / created_at;`label` 住在 **A 庫的 staff 表**,是另一張表)。
#    ⇒ 我第一版照它的情境寫,`grant update (label)` **失敗**、而 run_sql 把 stderr 吞掉
#      ⇒ 沒有可達角色 ⇒ **格子綠了,看起來像「修法沒生效」**。
#    📎 **理由錯而結論對不代表沒事**:枚舉 ['auth_user_id','staff_id'] 對 **`created_at` 現在就盲**,
#      對未來新增的欄同樣盲 ⇒ 該換 has_any_column_privilege 這個結論**成立**。
for spec in "A13|update (auth_user_id)|UPDATE|auth_user_id|欄級 UPDATE(識別欄,枚舉內)" \
            "A13c|update (created_at)|UPDATE|created_at|欄級 UPDATE(枚舉外的欄)" \
            "A13d|references (created_at)|REFERENCES|created_at|欄級 REFERENCES"; do
  IFS='|' read -r cid cgrant cpriv ccol cdesc <<< "$spec"
  drop_objs
  run_sql "create role col_only_writer;"
  run_sql_file "$B1B" > /dev/null 2>&1
  run_sql "grant $cgrant on public.admin_user_staff_map to col_only_writer;
           grant col_only_writer to service_role;"
  # 🔴 **前提斷言:先證這一格的世界真的被構造出來了。**
  #    run_sql 一律吞 stderr ⇒ `grant` 打錯欄名會【靜默失敗】,
  #    而失敗的世界與「守門沒抓到」**在格子上長得一模一樣**(都是綠)。
  #    ⇒ 沒有這一道,下一個人會去修守門,而壞掉的是測試。
  if [ "$(psqlq -c "select has_column_privilege('col_only_writer','public.admin_user_staff_map','$ccol','$cpriv')")" != "t" ]; then
    FAIL=$((FAIL+1))
    printf "  🔴 %-34s 前提沒成立:col_only_writer 沒拿到 %s(%s)⇒ 本格的綠沒有意義\n" "$cid 前提" "$cpriv" "$ccol"
    continue
  fi
  cell "$cid 本體要抓到【只有】$cdesc 的可達角色" red run_sql_file "$GUARD_SQL"
done
# 🔴 對照組:手寫一個【只查表級】的版本 ⇒ **必須綠**。
#    這一格【刻意是手寫的】:它要表達的是「本體【沒有】做的那件事」,抽本體抽不出這個。
#
# ⚠️🔴 **2026-08-17 折 `V-023 F2` + codex `harness:269`(兩方獨立抓到同一條)**:
#    這一格原本**沒有自己的世界**,它跟在上面那個 for 迴圈後面 ⇒ **停在迴圈最後一格的世界**。
#    我加了 A13c/A13d 之後,最後一格從「欄級 UPDATE」變成了 **REFERENCES 世界**
#    ⇒ 它變成「在 REFERENCES 世界查表級 UPDATE」⇒ **恆綠**,而它本來要證的是
#      「**同一個**欄級 UPDATE 世界裡,表級查法看不到」⇒ **對照配對整個斷掉,而它照樣印綠。**
#    📎 形狀:**我改的是 A13 家族的世界順序,而 A13b 的正確性依賴那個順序** ——
#      「我改的是 X,那 Y 還成立嗎」,這次 Y 沒有跟著我改。
#    ⇒ 修法:**給它自己的世界**,與 A13 同構(欄級 UPDATE(auth_user_id)),不再依賴迴圈殘留狀態。
drop_objs
run_sql "create role col_only_writer;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant update (auth_user_id) on public.admin_user_staff_map to col_only_writer;
         grant col_only_writer to service_role;"
# 前提:這一格的意義完全依賴「這個世界跟 A13 是同一個」⇒ 先證欄級授上去了
# 🔴 **這一格【不是恆綠】,已實測**:把上面那句 grant 從欄級漂成表級(`grant update on …`)
#    ⇒ A13b **紅**(29/1)。⇒ 它同時是 codex `harness:262`(欄級前提可被表級冒充)的那道守門:
#    **A13 家族的世界若整組漂成表級,前提斷言不會發現(表級也讓 has_column_privilege 回 t),而 A13b 會。**
if [ "$(psqlq -c "select has_column_privilege('col_only_writer','public.admin_user_staff_map','auth_user_id','UPDATE')")" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提①沒成立:沒拿到欄級 UPDATE ⇒ 本格的綠沒有意義\n" "A13b 前提"
# 🔴 前提②(codex R2 `harness:314` 補):**角色必須真的可達**。
#    少了這道,把 `grant col_only_writer to service_role` 拿掉之後 ——
#    欄級前提①仍為真,而表級查法因為**角色根本不可達**而照樣綠
#    ⇒ 這一格會用「對的顏色」通過一個**它根本沒在測的世界**。
elif [ "$(psqlq -c "select pg_has_role('service_role','col_only_writer','SET')")" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②沒成立:service_role 切換不過去 ⇒ 綠來自不可達而非表級盲\n" "A13b 前提"
else
cell "A13b 與 A13 同世界只留表級(應綠=表級看不到欄級)" green run_sql \
  "DO \$t\$ DECLARE v_reach text; BEGIN
     SELECT string_agg(r.rolname, ', ') INTO v_reach FROM pg_roles r
      WHERE pg_has_role('service_role', r.oid, 'SET') AND r.rolname <> 'service_role'
        AND has_table_privilege(r.oid, to_regclass('public.admin_user_staff_map'), 'UPDATE');
     IF v_reach IS NOT NULL THEN RAISE EXCEPTION 'A13b: %', v_reach; END IF; END \$t\$;"
fi
echo "     ↑ A13/A13c/A13d 紅 + A13b 綠 = 這個世界【會被擋下來】,而且跑的是本體不是複本"
echo "       ⚠️🔴 **不證「哪一道在擋」**:B 窗 2026-08-17 三發突變(attacl sweep / v_reach / 表級迴圈)"
echo "         逐一停用,這三格【全部照樣紅】⇒ 它們被 attacl sweep 與 v_reach **雙重覆蓋**。"

# 🔴🔴 A15:**`MAINTAIN`** —— PG 17 新增的表權限,而本檔斷言宣稱 service_role「恰好 {SELECT, INSERT}」。
#    **「恰好等於某個清單」的斷言,清單漏一項就整條失效,而漏的方式是靜默的。**
#    官方(2026-08-17 當場查):https://www.postgresql.org/docs/17/ddl-priv.html
#      Table 5.2 表物件權限字串 `arwdDxtm` 共 **8** 項,`m` = MAINTAIN(VACUUM/ANALYZE/CLUSTER/
#      REFRESH MATVIEW/REINDEX/LOCK TABLE)。本檔原清單只有 7 項 ⇒ **直接授 MAINTAIN 會通過斷言**。
#    來源:codex 對抗審查 `b1b:343`;主視窗裁定「這不是既有債,是 apply 的前置」。
# 📌 **這一格【不會】是 A14 那種假紅**:`v_extra` 段明文排除 `service_role`(它只抓「除了 owner 與
#    service_role 以外」的角色)⇒ 授給 service_role 自己的權限,只有那段「恰好 {SELECT,INSERT}」查得到。
drop_objs
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant maintain on public.admin_user_staff_map to service_role;"
if [ "$(psqlq -c "select has_table_privilege('service_role','public.admin_user_staff_map','MAINTAIN')")" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提沒成立:service_role 沒拿到 MAINTAIN ⇒ 本格的綠沒有意義\n" "A15 前提"
else
  cell "A15 本體要抓到 service_role 多拿的 MAINTAIN" red run_sql_file "$GUARD_SQL"
  echo "     ↑ 🔴 把 MAINTAIN 從斷言的清單裡拿掉,這一格就綠 ⇒ 它守的是【清單的完整性】"
  echo "       (突變 F 拿掉 MAINTAIN ⇒ 只有這一格翻綠。當時總數 30 格 ⇒ 記為 30/1;"
  echo "        **那個分母已過期(本檔基線見結尾那行「通過 N 格」),集合仍成立** —— 數字要帶著量測現場走)"
fi

# 🔴🔴 A16:**`v_extra` 白名單段**的專屬負測(codex `harness:249` —— 它自己標為
#    「第三種【三格都抓不到】的退化」:刪掉 `v_extra` 段,三個欄級世界仍由 UPDATE/REFERENCES 臂報紅,
#     但**任意其他角色的表級授權不再受擋**,而沒有任何一格會發現)。
# 構造的關鍵 = **一個 service_role【切換不過去】的角色**:
#    · 三個欄級臂查的都是「可 `SET ROLE` 到的角色」⇒ 它們看不到這個 outsider
#    · `v_extra` 查的是「除了 owner 與 service_role,還有誰持有權限」⇒ **只有它抓得到**
#    ⇒ 這一格與 A13 家族**沒有互相遮蔽**,刪掉 `v_extra` 段它就綠。
drop_objs
run_sql "drop role if exists outsider_writer; create role outsider_writer;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant select, update on public.admin_user_staff_map to outsider_writer;"
# 前提 ①:真的授上去了  前提 ②:**service_role 切換不過去**(否則這格會被欄級臂搶先抓到=遮蔽)
if [ "$(psqlq -c "select has_table_privilege('outsider_writer','public.admin_user_staff_map','UPDATE')")" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提①沒成立:outsider 沒拿到表級 UPDATE\n" "A16 前提"
elif [ "$(psqlq -c "select pg_has_role('service_role','outsider_writer','SET')")" != "f" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②沒成立:service_role 切換得過去 ⇒ 本格會被欄級臂遮蔽\n" "A16 前提"
else
  cell "A16 本體要抓到【切換不過去】的角色持有表級權限" red run_sql_file "$GUARD_SQL"
  echo "     ↑ 🔴 這一格是 v_extra 白名單段的【專屬】負測 —— 刪掉那段它就綠,而三個欄級格都不會動"
fi
run_sql "drop role if exists outsider_writer;"

# ══ A17:**第 1 層 `attacl` sweep** 的專屬負測(丙案第一塊落地的驗收)══
# 構造要同時躲開【其他三道】,否則紅了也證不了是 sweep 抓的(本線今晚已有 A14 假紅的前例):
#   · 授的是 **欄級 INSERT** ⇒ 舊版那圈只查 `SELECT` ⇒ 看不到(codex R2 `b1b:309` 的世界)
#   · 角色 **service_role 切換不過去** ⇒ 第 2 層可達性迴圈掃不到(codex R2 `b1b:476` 的世界)
#   · 欄級授權**不進 `relacl`** ⇒ `v_extra` 看不到(V 窗 S1 實測:表級授權才進 relacl)
#   ⇒ **只剩 attacl sweep 會紅。**
drop_objs
run_sql "drop role if exists col_insert_outsider; create role col_insert_outsider;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant insert (staff_id) on public.admin_user_staff_map to col_insert_outsider;"
if [ "$(psqlq -c "select has_column_privilege('col_insert_outsider','public.admin_user_staff_map','staff_id','INSERT')")" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提①沒成立:沒拿到欄級 INSERT\n" "A17 前提"
elif [ "$(psqlq -c "select pg_has_role('service_role','col_insert_outsider','SET')")" != "f" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②沒成立:角色可達 ⇒ 會被第 2 層搶紅,證不了 sweep\n" "A17 前提"
elif [ "$(psqlq -c "select (count(*) > 0) from pg_attribute where attrelid=to_regclass('public.admin_user_staff_map') and attacl is not null")" != "t" ]; then
  # 🔴 **fail-closed 寫法**(adversarial-reviewer 2026-08-17 `N3`):
  #    原本寫 `= "0"`,而 `psqlq` 把 stderr 併進 stdout ⇒ 查詢報錯時字串既不是 "0" 也不是數字
  #    ⇒ **前提被判成通過** = 全檔唯一一道 fail-open 的前提。
  #    改成問布林、比 `!= "t"`:報錯字串 ≠ "t" ⇒ 記 FAIL,與兄弟前提一致。
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提③沒成立:attacl 是空的或查詢失敗 ⇒ 這個世界沒有欄級授權可測\n" "A17 前提"
else
  cell "A17 attacl sweep 要抓到不可達角色的欄級 INSERT" red run_sql_file "$GUARD_SQL"
  echo "     ↑ 🔴 這一格是【丙案第 1 層】的專屬負測。**實測突變 I**(把 attacl sweep 關掉):"
  echo "       翻綠的是 **A17 + A3 兩格** —— 我原本預測只有 A17,**預測錯了而且是好消息**:"
  echo "       A3(既有格「只給欄級授權」)原本靠舊版那圈守,換成 sweep 之後改由 sweep 守"
  echo "       ⇒ 證明 sweep **完整接手了舊功能**,不只是加了新覆蓋。預測與實得的差刻意留痕。"
  echo "       ⚠️ 當時記為 31/2 ⇒ **分母已過期**(2026-08-17 複驗:集合仍是 A17+A3,當時基線 39 格 ⇒ 37/2)"
fi
run_sql "drop role if exists col_insert_outsider;"

# ══ A19 / A19m:**第 2 層【自己會不會炸】的負測**(2026-08-17 B 窗補;code-reviewer Critical 的回歸格)══
#
# 🔴 這一格守的**不是「本體抓不抓得到壞人」,是「本體問問題的時候會不會自己死」。**
#    病:第 2 層把 `acldefault('r',…)` 推導的**完整 8 項**同時餵給兩個 `has_*`,
#    而 `has_any_column_privilege` **只吃 SELECT/INSERT/UPDATE/REFERENCES**,其餘四種丟
#    `ERROR: unrecognized privilege type` ⇒ **整支 apply 當場死。**
#
# ⚠️🔴 **為什麼 33 格全綠而它還是活著** —— 這格存在的全部理由:
#    WHERE 那段**只在有列可求值時才會跑**。樁上沒有任何 service_role 可 `SET ROLE` 到的角色
#    ⇒ 一列都沒有 ⇒ **非法權限型別從來沒被餵進去** ⇒ 全綠。
#    B 窗雙世界實測(PG 17.10,修法前的檔,同一顆叢集):
#      零可達角色           ⇒ rc=0
#      一個【零權限】可達角色 ⇒ rc=3,`ERROR: unrecognized privilege type: "TRUNCATE"`
#    ⇒ **那個角色有沒有權限完全不影響** —— 死的是【問這個問題】本身。
#    ⇒ 正式庫只要存在任何一個可 SET ROLE 的角色,apply 當場死。**這是 apply 當天才會遇到的世界。**
#
# ⚠️🔴 **而那個條件今天【不成立】,這件事必須跟這段話一起讀**(2026-08-17 05:12 UTC 實測):
#    報價單庫(本檔的落點)`select rolname from pg_roles where pg_has_role('service_role',oid,'SET')
#    and rolname<>'service_role'` ⇒ **0 列**(正向對照:`authenticator` 可 SET 到三個角色 ⇒ 機制是活的)。
#    ⇒ **第 2 層 v_reach 在正式庫上判別力為零;上面那個 Critical 在正式庫上也【不會發作】。**
#    ⇒ **本段那幾格(MA-2b / MA-2c / A19m)是「綠在一個今天不存在的世界」** ——
#      它們證的是「這段 code 的邏輯對」,**不是**「這段 code 今天在正式庫有作用」。兩件事分開講。
#    ⇒ 那為什麼還要修、還要留?**角色是後台點一下就能加的,而這支 migration 只跑一次不會重跑**
#      ⇒ 危險窗口正好落在 apply 那一刻。**今天的 0 只保證今天。**
#    📎 完整脈絡與 apply 當天的重跑步驟:`docs/specs/2026-08-17-b1-apply-preflight.md` §`#8`
#
# 📌 前提要兩道,少任何一道這格的綠都沒有意義:
#    ① 角色**真的可達**(否則 WHERE 一列都不求值 ⇒ 綠來自「沒有列」,不是「查法對」)
#    ② 角色對本表**零權限**(否則它本來就該紅,測到的就不是「自爆」這件事)
drop_objs
run_sql "drop role if exists zero_priv_reachable; create role zero_priv_reachable;"
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "grant zero_priv_reachable to service_role;"
A19_REACH=$(psqlq -c "select pg_has_role('service_role','zero_priv_reachable','SET')")
A19_PRIVS=$(psqlq -c "select count(*) from unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
                       where has_table_privilege('zero_priv_reachable','public.admin_user_staff_map',p)")
if [ "$A19_REACH" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提①沒成立:角色不可達 ⇒ WHERE 一列都不求值,本格恆綠\n" "A19 前提"
elif [ "$A19_PRIVS" != "0" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②沒成立:角色持有 %s 項表級權限 ⇒ 它本來就該紅\n" "A19 前提" "$A19_PRIVS"
else
  cell "A19 存在【零權限可達角色】時本體不自爆" green run_sql_file "$GUARD_SQL"
  # 🔴 A19m:把 A19 的判別力**當場證出來**,不靠註解宣稱。
  #    突變 = 把欄級那半的具名四項灌回完整 8 項 ⇒ **重現同一個症狀**。
  # ⚠️ 措辭:這裡原本寫「**精確重現**修法前的病」,已改(adversarial-reviewer 2026-08-17 `N5`)——
  #    那個壞掉的中間版**從未 commit**(HEAD 是更舊的四臂版)⇒ repo 內無從核對「精確」二字;
  #    而 A19m 用的是**另一種結構**(獨立 EXISTS + 硬寫 8 項),不是那一版的複本。
  #    ⇒ 它證的是「同一個症狀會被抓到」,不是「和當時那份 code 一模一樣」。
  sed "s|ARRAY\['SELECT','INSERT','UPDATE','REFERENCES'\]|ARRAY['SELECT','INSERT','UPDATE','REFERENCES','DELETE','TRUNCATE','TRIGGER','MAINTAIN']|" \
      "$GUARD_SQL" > "$D/a19m.sql"
  if [ "$(grep -c "'REFERENCES','DELETE','TRUNCATE','TRIGGER','MAINTAIN'" "$D/a19m.sql")" != "1" ]; then
    echo "  🔴 A19m 突變沒生效(找不到欄級具名四項的錨點)—— A19 的判別力未證,不算通過"; FAIL=$((FAIL+1))
  else
    cell "A19m 同世界灌回 8 項 ⇒ 必須紅(證 A19 有判別力)" red run_sql_file "$D/a19m.sql"
    # 🔴 **紅了不等於紅對地方**(本檔 MA-2a 段的教訓,這裡把它套用上):
    #    A19m 期望的紅【必須】是 `unrecognized privilege type`,不能是任何其他錯。
    #    少了這道,抽取產物壞掉 / 樁沒建好 ⇒ 它照樣紅、照樣「通過」。
    A19M_ERR=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$D/a19m.sql" 2>&1 \
                 | grep -c 'unrecognized privilege type')
    if [ "$A19M_ERR" -ge 1 ]; then
      PASS=$((PASS+1)); printf "  ✅ %-34s 錯誤訊息含 unrecognized privilege type\n" "A19m 紅對地方"
    else
      FAIL=$((FAIL+1)); printf "  🔴 %-34s 紅了但訊息不是 unrecognized privilege type ⇒ 紅錯地方\n" "A19m 紅對地方"
    fi
  fi
  echo "     ↑ 🔴 A19 綠 + A19m 紅 = **這一對才是證據**。只有 A19 的話它與「WHERE 沒被求值」分不出來。"
  echo "       ⚠️ 界限:這對格證的是【第 2 層不會自爆】,**不證第 2 層抓得到任何壞人**(見 A18 那段)。"
fi
run_sql "drop role if exists zero_priv_reachable;"

# ══ MA-2a / MA-2b:**第 2 層【唯一不可替代】的那個世界**(2026-08-17 B 窗補)══
#
# 🔴 A18 那段(見下)已經指認過:第 2 層在「表級 / 欄級授權」這兩個維度上被第 1 層嚴格蘊含
#    ⇒ 在那些維度上構造不出獨立世界。**B 窗 2026-08-17 用突變把這件事量出來了,不是照抄結論**:
#      把第 2 層整段停用(`pg_has_role('service_role', r.oid, 'SET')` → `false`,錨點唯一性當場數過)
#      ⇒ 翻綠的是 `A19m`(兩格)+ `MA-2b` + `MA-2c`(基線 39 格 ⇒ 35 pass / 4 fail),
#        而 A13 / A13c / A13d / A15 / A16 / A17 **全部照樣紅**。
#      ⚠️🔴 **這句被改過兩次,兩次都是「寫下之後才加格子,而句子沒跟著動」:**
#         v1 寫「35 格裡只有 A19m 翻綠」⇒ 分母是加 MA-2 之前的、且漏了 MA-2b(code-reviewer 抓)
#         v2 寫「A19m + MA-2b 兩格」   ⇒ 漏了後來補的 MA-2c(本窗自己複跑時抓到)
#         📎 **這種句子的壽命比它描述的東西短。** 完整覆蓋表在下面那張(以它為準)。
#      ⇒ 那六格對第 2 層是**零覆蓋**;它們的紅來自第 1 層(attacl sweep / v_extra)。
#      ⚠️ 而 A19m 翻綠只證「第 2 層**存在且被求值**」,**不證它抓得到任何人** —— 兩件事別混。
#
# ⇒ 第 2 層唯一不可替代的是 **predefined roles 的隱含權限**:
#    `pg_write_all_data` 給的 INSERT/UPDATE/DELETE **不寫進 relacl,也不寫進 attacl**
#    ⇒ 第 1 層兩道**都看不到**,只有問【有效權限】的第 2 層看得到。
#
# 兩格打**不同的偵測器**,而「哪一個偵測器」這件事我**連錯兩次**,兩次都是突變當場打回的:
#    MA-2a `pg_maintain` + `WITH INHERIT TRUE, SET FALSE`
#          ⇒ 切換不過去 ⇒ `v_reach` 盲;`MAINTAIN` **不是欄級可授權限** ⇒ 欄級迴圈盲
#          ⇒ **只剩【表級有效權限迴圈】抓**
#    MA-2b `pg_write_all_data` + 預設 membership(樁的 service_role 是 NOINHERIT ⇒ SET-only)
#          ⇒ service_role 自查是 f ⇒ 表級與欄級兩個迴圈都盲
#          ⇒ **只剩 `v_reach` 那段抓**
#
# ⚠️🔴 **我在這兩格上連錯兩次,兩次的「紅」看起來都一模一樣:**
#    第一版 `pg_write_all_data` + 只寫 `WITH INHERIT TRUE`
#      ⇒ membership **預設同時給 INHERIT 與 SET** ⇒ `v_reach` 也看得到 ⇒ 與 MA-2b 同一個偵測器。
#      (停用 `v_reach` ⇒ MA-2a 照樣紅 = 打回)
#    第二版 `pg_write_all_data` + `WITH INHERIT TRUE, SET FALSE`
#      ⇒ `v_reach` 確實盲了,**而 `pg_write_all_data` 含 UPDATE** ⇒ service_role 繼承到表級 UPDATE
#      ⇒ `has_column_privilege(service_role, 每一欄, 'UPDATE')` 全為真 ⇒ **欄級迴圈搶先抓**。
#      (停用表級迴圈 ⇒ MA-2a 照樣紅,翻綠的是 **A15** = 又打回)
#    ⇒ 第三版換 `pg_maintain`:`MAINTAIN` 在 PG 17 **不能欄級授權** ⇒ 欄級迴圈**在型別上就看不到它**。
#    📎 形狀:**註解說它守什麼,斷言說它真表達得出什麼。** 三個版本的 MA-2a **全部都是紅的**,
#       而只有第三版紅在我宣稱的那個地方。**「紅了」從來不是「紅對地方了」。**
#    📎 這也是為什麼下面每一格都要跑「停用某一段 ⇒ 它必須翻綠」的突變 —— 光看紅分不出三個版本。
# ⚠️🔴 另一個坑:繼承旗標**在授與當下決定**,事後 `ALTER ROLE … INHERIT` **不會**改既有 membership
#    (本線 2026-08-16 實測踩過)⇒ 一定要寫在 GRANT 上。
# 📌 MA-2a 與 A15 打**同一個偵測器**(表級迴圈的 MAINTAIN 那一項),但**世界不同**:
#    A15 是**明文** GRANT 給 service_role(進 relacl);MA-2a 是**隱含**權限(不進 relacl/attacl)。
#    ⇒ 它證的是「第 1 層對隱含權限全盲,而第 2 層接得住」,不是「MAINTAIN 有沒有在清單裡」。
#
# 欄位:id | predefined role | GRANT 附加子句 | 探測權限 | service_role 自查應為 | 切得過去應為 | 說明
# 🔴🔴 **MA-2c 是 adversarial-reviewer 2026-08-17 抓出來的第三個世界,而它守的那一臂原本零覆蓋:**
#    `v_reach` 內部其實有**兩臂**(表級 `has_table_privilege` / 欄級 `has_any_column_privilege`),
#    而 MA-2a、MA-2b 都不守表級那一臂:
#      · MUT-B 停用 service_role 表級有效權限迴圈 ⇒ **MA-2a 翻綠**(它的偵測器是那個迴圈,不是 v_reach)
#      · MUT-2 只拆掉 `v_reach` 的**表級**臂        ⇒ **MA-2b 照樣紅**(它被 v_reach 的欄級臂接住)
#    ⇒ 把 `v_reach` 表級臂整個換成 `false` ⇒ **37 格全綠**(reviewer 實測)= 那一臂零覆蓋。
#    而它**是承重的**:pg_maintain + SET-only 的可達角色,原版 rc=3、拆臂版 rc=0(**靜默放行**)。
# 構造 = `pg_maintain`(MAINTAIN 不能欄級授權 ⇒ 欄級臂看不到)+ **SET-only**
#    (`INHERIT FALSE, SET TRUE` ⇒ service_role 自查為 f ⇒ 表級有效權限迴圈看不到)
#    ⇒ **只剩 `v_reach` 的表級臂。** 實測:拆表級臂 ⇒ **只有 MA-2c 翻綠**(39 格中 38/1)。
#
# ⚠️🔴 **而 `v_reach` 的【欄級臂】沒有行為負測 —— 那是【構造不出來】,不是漏做:**
#    B 窗 2026-08-17 實測拆掉欄級臂 ⇒ **零格翻綠**(只有 A19m 報「突變沒生效」= 它的錨點被我拿掉了,
#    那是**字面**檢查不是行為格)。原因是結構性的:
#      · 欄級授權**一定**寫進 `pg_attribute.attacl` ⇒ **第 1 層 attacl sweep 必定先紅**
#        (A17 正是這個世界,實測紅;A13 家族同理,三發突變全紅 = 雙重覆蓋)
#      · predefined roles 的隱含權限是**表級**的,不產生 attacl ⇒ 走不到欄級臂
#      ⇒ **沒有「只有欄級臂會紅」的世界。** 它在今天的結構下【嚴格冗餘】。
#    ⇒ 保留它的理由只有一個:**第 1 層 attacl sweep 若日後被改窄或拿掉,它是第二道。**
#      🔴 這是【推導】不是單一次量到的:依據 = 上面那發拆臂實測 + attacl 的儲存位置。
#      本 repo `feedback_unconstructible-negative-test-means-noop-guard` 記的就是這個形狀 ——
#      **寫不出「只紅它」的負測 ⇒ 不准把它當成一道獨立的檢查來引用。**
MA2_RAN=0
for spec in "MA-2a|pg_maintain|WITH INHERIT TRUE, SET FALSE|MAINTAIN|t|f|繼承但切換不過去(只剩表級有效權限迴圈抓)" \
            "MA-2b|pg_write_all_data||UPDATE|f|t|只能 SET ROLE(證 v_reach 這一【段】承重,不指定臂)" \
            "MA-2c|pg_maintain|WITH INHERIT FALSE, SET TRUE|MAINTAIN|f|t|只能 SET ROLE 的 MAINTAIN(只剩 v_reach 表級臂抓)"; do
  IFS='|' read -r mid mprerole mgrant mpriv minherit mset mdesc <<< "$spec"
  case "$mid" in
    MA-2a) mrole=ma2_inherit_writer ;;
    MA-2b) mrole=ma2_setonly_writer ;;
    MA-2c) mrole=ma2_setonly_maint ;;
  esac
  drop_objs
  run_sql "create role $mrole; grant $mprerole to $mrole;"
  run_sql_file "$B1B" > /dev/null 2>&1
  run_sql "grant $mrole to service_role $mgrant;"
  # 前提①:這個世界真的是【隱含權限】—— 第 1 層兩道都必須是空的,否則紅了也不知道誰紅的
  M_RELACL=$(psqlq -c "select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
                        where c.oid=to_regclass('public.admin_user_staff_map') and a.grantee='$mrole'::regrole")
  M_ATTACL=$(psqlq -c "select count(*) from pg_attribute where attrelid=to_regclass('public.admin_user_staff_map') and attacl is not null")
  # 前提②:service_role 自己查得到 / 查不到 —— 這一行決定表級迴圈盲不盲
  M_INH=$(psqlq -c "select has_table_privilege('service_role','public.admin_user_staff_map','$mpriv')")
  # 前提②b:**切得過去 / 切不過去** —— 這一行決定 v_reach 盲不盲。
  #    少了它,`SET FALSE` 打錯字會靜默退回「兩格同一個偵測器」(第一版就是這樣過的)。
  M_SET=$(psqlq -c "select pg_has_role('service_role','$mrole','SET')")
  # 前提②c(**只有 MA-2a 要**):欄級迴圈必須也盲。第二版就是栽在這裡而前提全過。
  M_COL=$(psqlq -c "select has_column_privilege('service_role','public.admin_user_staff_map','auth_user_id','UPDATE')")
  # 前提②d(**只有 MA-2c 要**):`v_reach` 的【欄級臂】必須也盲,否則證不了表級臂。
  #    MAINTAIN 不能欄級授權 ⇒ 這裡預期四種全 f。少了這道,MA-2c 會退化成 MA-2b 的複本。
  M_ANYCOL=$(psqlq -c "select bool_or(has_any_column_privilege('$mrole','public.admin_user_staff_map',p))
                         from unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p")
  # 前提③:那個角色**真的**拿到了隱含權限(沒拿到的話下面的紅會是別人給的)
  M_HAS=$(psqlq -c "select has_table_privilege('$mrole','public.admin_user_staff_map','$mpriv')")
  if [ "$M_RELACL" != "0" ] || [ "$M_ATTACL" != "0" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提①沒成立:relacl %s / attacl %s ⇒ 第 1 層看得到,證不了第 2 層\n" "$mid 前提" "$M_RELACL" "$M_ATTACL"
  elif [ "$M_HAS" != "t" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提③沒成立:%s 沒拿到隱含 %s ⇒ 這個世界沒有壞人\n" "$mid 前提" "$mrole" "$mpriv"
  elif [ "$M_INH" != "$minherit" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②沒成立:service_role 自查 %s=%s,要的是 %s ⇒ 量到的是另一格的世界\n" "$mid 前提" "$mpriv" "$M_INH" "$minherit"
  elif [ "$M_SET" != "$mset" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②b沒成立:service_role 切得過去=%s,要的是 %s ⇒ 兩格會退回同一個偵測器\n" "$mid 前提" "$M_SET" "$mset"
  elif [ "$mid" = "MA-2a" ] && [ "$M_COL" != "f" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②c沒成立:欄級 UPDATE=%s ⇒ 欄級迴圈會搶紅,證不了表級迴圈\n" "$mid 前提" "$M_COL"
  elif [ "$mid" = "MA-2c" ] && [ "$M_ANYCOL" != "f" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提②d沒成立:%s 有欄級權限(%s)⇒ v_reach 欄級臂會搶紅,證不了表級臂\n" "$mid 前提" "$mrole" "$M_ANYCOL"
  else
    cell "$mid 隱含權限 · $mdesc" red run_sql_file "$GUARD_SQL"
    MA2_RAN=$((MA2_RAN+1))
  fi
  run_sql "drop role if exists $mrole;"
done
# 🔴 這段解說**只在兩格都真的跑了**才印。前提失敗時印它 = 在 🔴 底下緊接著說「這格是專屬負測」。
#    (CLAUDE.md:輸出的標籤要由【結果】決定,不能無條件印。)
if [ "$MA2_RAN" = "3" ]; then
  echo "     ↑ 🔴 這三格是**第 1 層無論如何都看不到**的世界(隱含權限不進 relacl/attacl)"
  echo "       · MA-2a → service_role【表級有效權限迴圈】(拆它才翻綠,實測)"
  echo "       · MA-2c → v_reach【表級臂】(拆它才翻綠,實測;這一臂在 MA-2c 之前是零覆蓋)"
  echo "       · MA-2b → 證 v_reach 這一【段】承重,**但不指定臂** —— 拆整段它翻綠,"
  echo "         拆任一臂它照樣紅(兩臂都抓得到它)。不要把它讀成某一臂的專屬負測。"
  echo "       ⚠️ v_reach 的【欄級臂】沒有行為負測,而那是【構造不出來】不是漏做 —— 見上方說明。"
else
  echo "     ⚠️ MA-2 只跑了 $MA2_RAN / 3 格 ⇒ 上面那幾句偵測器歸屬本輪【沒有成立】。"
fi

# ══ A18:**第 2 層改用完整 8 項之後補上的那個【真洞】** ══
# 🔴 這一格測的不是「更嚴格」,是一個 V 窗 2026-08-17 實測指認出來的**可利用路徑**:
#    · 本表白名單有一個**沒綁的空位**(`staff_1` 刻意不綁,規格 §3)
#    · 可達角色只要持有 **INSERT**,就能把**任意 auth_user 綁上 `staff_1`**
#      ⇒ **憑空造出一個員工身分**
#    · 而 `no_rebind` trigger **只攔 UPDATE**;`no_delete`/`no_truncate` 攔不到 INSERT
#    ⇒ **舊版手寫四臂(DELETE/TRUNCATE/欄級 UPDATE/欄級 REFERENCES)對這條路徑全盲。**
# 📌 前提②(不可達則跳過)沿用本檔既有做法:這一格要的是**可達**角色,與 A16/A17 相反。
#
# ⚠️🔴 **授的是【欄級】INSERT,不是表級 —— 這一行是我第三次踩同一個機制之後才對的。**
#    第一版我寫 `grant insert on …`(**表級**)⇒ 表級授權進 `relacl` ⇒ **`v_extra` 段先抓到它**
#    ⇒ 突變 J(把推導集限回舊四臂)時 **A18 照樣紅、34 格全綠** ⇒ **它證不了第 2 層有沒有在做事。**
#    📎 **與 A14 家族假紅同一個機制,方向也一樣**:我把角色留在 `v_extra` 的射程內。
#       V 窗 R3 說過「B 擔心的第三次站錯機制兩邊」——**就是這裡,而且它說對了。**
#    ⇒ 改用**欄級** INSERT:欄級授權寫進 `attacl` **不進 relacl** ⇒ `v_extra` 看不到
#      ⇒ 只剩第 2 層的 `has_any_column_privilege(…, 'INSERT')` 會抓 ⇒ **紅得有來源。**
# ⛔⛔ **A18 已於 2026-08-17 拆除 —— 它在丙案結構下【構造不出獨立的世界】。實測兩次:**
#
#   第一版 表級 INSERT + 可達 ⇒ 表級授權進 `relacl` ⇒ **`v_extra` 段搶先紅**
#   第二版 欄級 INSERT + 可達 ⇒ 欄級授權進 `attacl` ⇒ **第 1 層 attacl sweep 搶先紅**
#   兩版的驗法都是突變 J(把第 2 層推導集限回舊四臂):**A18 都照樣紅、34 格全綠**
#   ⇒ 它證不了第 2 層有沒有在做事。
#
# 🔴 **這是我在同一個機制上第三、第四次站錯邊**(A14 假紅 → 「構造不出」被推翻 → 這裡兩版)。
#    V 窗 R3 預言過「B 擔心的第三次站錯機制兩邊」—— **它說對了,而且不只第三次。**
#
# 📎 **而拆掉它的同時要看見一件【設計上的好消息】,否則這段只剩挫折**:
#    A18 構造不出來的原因,正是**第 1 層真的把表級與欄級兩條路都吃掉了** ——
#    `relacl` 管表級、`attacl` 管欄級,**兩者聯集涵蓋所有「寫進儲存層的授權」**。
#    ⇒ 第 2 層在**這些維度上本來就是冗餘的**;它**唯一不可替代**的是
#      **predefined roles 的隱含權限**(不進 relacl/attacl,V 窗實測)。
#    ⇒ **第 2 層的驗收應該由 MA-2 那兩格(inherit true / SET-only)來做,不是由 A18。**
#
# ⚠️ **那第 2 層改用完整 8 項還有意義嗎?有,而且理由要寫準**:
#    它的價值**不在本表現在測得出來的地方**,在於
#    **第 2 層日後若要獨立於第 1 層存在(例如某物件沒有 attacl 可讀),清單不會是窄的**。
#    🔴 **這是【推論】不是【量到】** —— 目前沒有一格證明它。**不要寫成「已驗證」。**

# ⛔⛔ **A14 家族(表級三臂)已於 2026-08-17 拆除 —— 它們是【假紅】。**
#
# 我原本加了三格(A14u/A14d/A14t):授表級 UPDATE / DELETE / TRUNCATE 給可達角色 ⇒ 期望本體報紅。
# 三格都紅了,我據此對主視窗宣稱「A14u 是【移除 has_table_privilege(UPDATE) 那一行】的實測依據」。
#
# 🔴 **codex 對抗審查(2026-08-17,`b1b:382`)指出那個紅可能來自別的地方,我實測後確認它是對的:**
#    把 DELETE / TRUNCATE 兩臂**整個改成 `false`** 之後重跑 ⇒ **A14d / A14t 仍然全紅、33 格全綠。**
#    ⇒ 它們紅的原因是斷言**後面**的 `v_extra` 白名單段(「除了 owner 與 service_role,還有誰持有權限」),
#      **不是那三臂**。表級授權一定會進 `relacl` ⇒ `v_extra` 一定看得到 ⇒ **這三格永遠紅,測什麼都紅。**
#
# 📎 **為什麼 A13 家族沒有這個問題**:欄級授權寫進 `attacl` 不寫進 `relacl`
#    ⇒ `v_extra` 看不到 ⇒ A13/A13c/A13d 的紅確實來自欄級臂(兩發突變各只紅一格,已驗)。
#
# 🔴 **留下來的真問題(不是「寫下來然後走開」,是它需要一個設計決定,我不自己拍):**
#    在「可達角色」這個維度上,**任何持有表級 DELETE/TRUNCATE 的角色都會被 `v_extra` 抓到**
#    ⇒ 那兩臂**可能被 `v_extra` 嚴格蘊含**(與我剛移除的表級 UPDATE 那行是同一個形狀)。
#    ⇒ 要嘛它們是冗餘的、要嘛它們守的是「`v_extra` 被改掉之後」的防禦深度。
#    **這兩個答案會導向不同的動作,而我沒有證據選邊 ⇒ 已在回報中列為待答,不在這裡假裝有格子守著。**
#
# ⚠️ **拆掉而不是留著標「已知假紅」的理由**:假紅格比沒有格更糟 ——
#    它會讓下一個人以為 DELETE/TRUNCATE 兩臂有負測覆蓋,而它連一次都沒真的測過那兩臂。
echo "       ⛔ 這裡原有兩句「A13c 是 F-V20-1 的負測 / A13d 是 F-V20-2 的負測」已於 2026-08-17 作廢:"
echo "          丙案沒有逐欄枚舉、也沒有 REFERENCES 臂可刪,那兩個突變在現行結構下構造不出來。"


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
# 🔴 標題用單引號:雙引號內的反引號會被 shell 當【命令替換】吃掉。
#    第一版寫成 "══ A20:`ENABLE ROW LEVEL SECURITY` 這一行…" ⇒ 實跑印出
#    「══ A20: 這一行有沒有人在守 ══」—— **那段字直接消失,而句子還讀得通、只是掉了主詞。**
#    (CLAUDE.md 明列此坑,本窗 2026-08-17 當場踩了一次、由實跑輸出抓到。)
# ⚠️ 標題 2026-08-17 改過(reviewer `F3`):新構造**完全不碰** ENABLE 那一行
#    (改成「B1-b 跑完後才 DISABLE」)⇒ 舊標題會讓人以為 A20 還在測檔案完整性。
#    **守那一行的現在是 A21。**
echo '══ A20:RLS 被關掉時,下游 B2 會不會擋 ══'
# 🔴 起因(2026-08-17 B 窗查 apply preflight `#7` 時實測):把 B1-b 的
#    `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` 註解掉重跑 ⇒ **零格翻綠**,
#    但 **S2 由 green 變 red、S4 抓不到列**。
#    ⇒ **它其實是被守住的** —— 守它的是 `B2-seed` 自己的前提斷言
#      (`2026-08-16-m4b-e8b-b2-seed-migration-draft.sql` 內
#       `IF NOT (SELECT relrowsecurity …) THEN RAISE '…RLS 沒開。表被改過,拒繼續。'`)。
#    ⚠️ **但那個紅【說不出自己是誰】**:讀的人看到的是「B2 seeding 壞了」,
#       要翻三層才知道真因是「RLS 被關掉」。本線今晚整晚在修的就是這個形狀。
#    ⇒ 這一格把那道守門**具名**:不是新增保護,是讓既有保護的紅【講得出自己是誰】。
#    📎 順帶擋掉一條很可能發生的錯修:有人看到 S2 紅,會想去把 B2 的前提斷言放寬。
# ⚠️🔴 **A20 的構造 2026-08-17 改過一次,理由本身就是一個發現:**
#    舊構造是「把 `ENABLE ROW LEVEL SECURITY` 那行從 B1-b 刪掉再跑」。
#    **加了 A21(B1-b 自己的 RLS 落地斷言)之後,那個構造失效了** ——
#    B1-b 會在建表後**當場自己紅**,表整支回滾 ⇒ 表根本不存在 ⇒ 前提檢查印
#    `relrowsecurity=`(空字串)而不是 `f`。**前提 fail-closed 擋住了,沒有變成假綠。**
#    ⇒ 新構造:**讓 B1-b 正常跑完(RLS 有開),再把 RLS 關掉**,然後跑 B2。
#    📎 而新構造**更接近真實世界**:它模擬的正是 preflight §`#7` 講的那個缺口 ——
#      **apply 之後有人下 `DISABLE ROW LEVEL SECURITY`**。
drop_objs
run_sql_file "$B1B" > /dev/null 2>&1
run_sql "alter table public.admin_user_staff_map disable row level security;"
A20_RLS=$(psqlq -c "select relrowsecurity from pg_class where oid=to_regclass('public.admin_user_staff_map')")
if [ "$A20_RLS" != "f" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 前提沒成立:relrowsecurity=%s(要的是 f)⇒ RLS 沒真的被關掉\n" "A20 前提" "$A20_RLS"
else
    cell "A20 RLS 被關掉時 B2 必須拒絕 seeding" red run_sql_file "$B2"
    # 🔴 紅了還要紅對地方:訊息必須指名 RLS,否則它與「B2 因為別的原因壞掉」分不出來。
    # 🔴 錨到 `ERROR:` 而不是裸字串:少了這個錨,任何**回印 SQL 原文**的路徑都會自命中
    #    (見檔頭 psqlq 的 `-X` 註解)。`-X` 與這個錨兩道一起做,不擇一。
    # ⚠️🔴 **不能用 `^ERROR:`** —— psql 的錯誤行是 `psql:<檔>:<行>: ERROR:  …`,**前面有前綴**
    #    ⇒ `^ERROR:` **永遠不會命中** = 一個裝上去就再也不會叫的偵測器。
    #    我第一版就是寫 `^ERROR:`,**是這一格自己的正向對照把它抓出來的**
    #    (實跑:A20 紅對地方 由 ✅ 變 🔴)—— 只驗「該回 0 的回 0」不會發現這件事。
    A20_MSG=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$B2" 2>&1 \
                | grep -cE 'ERROR:.*RLS 沒開')
    if [ "$A20_MSG" -ge 1 ]; then
      PASS=$((PASS+1)); printf "  ✅ %-34s 錯誤訊息指名「RLS 沒開」\n" "A20 紅對地方"
    else
      # ⚠️ 字面要涵蓋兩種失敗:B2 根本沒紅、或紅了但紅在別的地方(reviewer `N2`:
      #    突變 6 之下 B2 其實是【綠的】,而舊字面寫「紅了但…」= 計數對、字面錯)。
      FAIL=$((FAIL+1)); printf "  🔴 %-34s B2 沒紅、或紅了但訊息沒指名 RLS ⇒ 紅錯地方\n" "A20 紅對地方"
    fi
fi
echo "     ↑ 🔴 這一格守的是【既有保護的可讀性】,不是新保護。"
echo "       拿掉 B2 的 RLS 前提斷言 ⇒ 這一格翻綠,而 S2/S4 也會一起壞 —— 兩者一起看才知道真因。"

# ══ A21:B1-b 自己的 RLS 落地斷言(2026-08-17 B 窗補,主視窗已批)══
# 🔴 它與 A20 守的**不是同一件事**,兩格都要:
#    · A20 → 「RLS 沒開時 **B2** 會拒絕 seeding」(下游、隔一支檔)
#    · A21 → 「RLS 沒開時 **B1-b 自己當場就紅**」(同一層、指向真正那一行)
#    失敗的**位置**決定下一個人會去改什麼:紅在 B2 ⇒ 最可能的錯修是放寬 B2 的前提斷言。
# ⚠️ **兩格都【不】守「apply 之後有人 DISABLE RLS」** —— 那個缺口仍開著,見 preflight §#7。
drop_objs
sed 's|^ALTER TABLE public.admin_user_staff_map ENABLE ROW LEVEL SECURITY;$|-- A21 MUTATED OUT|' \
    "$B1B" > "$D/a21.sql"
if [ "$(grep -c '^-- A21 MUTATED OUT' "$D/a21.sql")" != "1" ]; then
  echo "  🔴 A21 突變沒生效:B1-b 內找不到 ENABLE ROW LEVEL SECURITY 那一行"
  echo "     ⇒ ①錨點漂了(本格失去判別力)②**那一行真的被拿掉了 ⇒ 先去確認 B1-b**"; FAIL=$((FAIL+1))
else
  A21_MSG=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$D/a21.sql" 2>&1 \
              | grep -c 'RLS 沒有開起來')
  if [ "$A21_MSG" -ge 1 ]; then
    PASS=$((PASS+1)); printf "  ✅ %-34s 紅,且訊息指名「RLS 沒有開起來」\n" "A21 B1-b 自己抓到 RLS 沒開"
  else
    FAIL=$((FAIL+1)); printf "  🔴 %-34s 沒紅、或紅了但訊息沒指名 RLS ⇒ 紅錯地方\n" "A21 B1-b 自己抓到 RLS 沒開"
  fi
fi
# 🔴 正向對照:原檔(RLS 有開)⇒ 這道斷言必須【不叫】。
#    少了它,一個「無論如何都 RAISE」的斷言也會讓上面那格綠。
drop_objs
# ⚠️🔴 **A21b 不能只是「再跑一次原檔」**(adversarial-reviewer 2026-08-17 `F2`):
#    第一版與 `A0 原檔跑` **逐字同一條命令、同一個預期** ⇒ reviewer 實測:把新斷言整段刪掉,
#    **A21b 照樣綠** ⇒ 它控不到「這道斷言存在且沒誤報」,只控到「整支檔綠」(A0 already 在做)。
#    **它是 +1 計數,不是 +1 判別力。** ⇒ 改成斷言那道 NOTICE 的**新字面**。
#
# ⚠️🔴 **而它守得到什麼、守不到什麼,我量過了,寫準:**
#    實測(把 `IF v_rls IS DISTINCT FROM true` 改成 `IF false AND …`)⇒ **只有 `A21` 紅,`A21b` 照樣綠。**
#    ⇒ **A21b【不】偵測「那道 IF 被停用」** —— NOTICE 是**另一條 statement**,IF 停掉它照印。
#    ⇒ 它真正守的是:**`$rls_premise$` 整個區塊有跑完**(整段被刪 / 中途 abort ⇒ NOTICE 不會出現)。
#    ⇒ 「那道 IF 還活著」由 `A21` 守(上面那發突變已證它單獨會紅)。**兩格分工寫清楚,不要互相冒充。**
#    📎 我第一版註解寫「斷言不在了 ⇒ NOTICE 也不會是這一句」—— **那是錯的,被這發突變打回。**
A21B_OUT=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$B1B" 2>&1)
A21B_RC=$?
if [ "$A21B_RC" -ne 0 ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 原檔跑不過 ⇒ 不是「不誤報」,是整支壞了\n" "A21b 正向對照"
elif echo "$A21B_OUT" | grep -q "RLS 已開"; then
  PASS=$((PASS+1)); printf "  ✅ %-34s 綠,且 NOTICE 含「RLS 已開」(證斷言真的跑過)\n" "A21b 正向對照"
else
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 綠了但 NOTICE 沒有「RLS 已開」⇒ 那道斷言根本沒執行\n" "A21b 正向對照"
fi

echo ""
echo "══ 第三段:B2 seeding ══"
drop_objs
apply_b1b
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
  cell_red_msg "S1 還原成佔位符後跑" "還是草稿裡的佔位符" "$S1_FILE"
fi
cell "S2 B2 原檔(真 uuid)" green run_sql_file "$B2"
cell_red_msg "S3 重跑(表已非空)" "不是空的" "$B2"
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
apply_b1b
sed -e "s/('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean')/('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'sean')/" \
    -e "s/('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'staff_2')/('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'staff_2')/" \
    "$B2" > "$D/seed_swapped.sql"
if diff -q "$B2" "$D/seed_swapped.sql" > /dev/null; then
  echo "  🔴 S5 突變沒生效(兩份檔一樣)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S5 兩個 uuid 對調" "配對不符" "$D/seed_swapped.sql"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  第四段:B2 前提斷言的行為負測(2026-08-17 B 窗審 B2 新增)
#
#  🔴 為什麼要有這一段:B2 是三支裡【唯一沒被單獨審過】的,只在上面當下游跑過。
#     盤點它自己的 9 道斷言,原本只有 4 道有格:
#       0.1d RLS 沒開(A20)/ 0.2 佔位符(S1)/ 0.5 表非空(S3)/ §2 精確配對(S5)
#     以下這一段補的是剩下那些。**方向是「拆掉那道斷言守的東西 ⇒ 必須紅、而且紅對地方」。**
#     🔴 本段新增 **22** 格(全支 43 → 65;兩個數字都是腳本最後一行印的,重跑即得)。
#        ⛔ 這行原本寫「以下 6 格」—— code-reviewer 2026-08-17 抓,那是本段最早的版本沒跟著改。
#           **這行是下一個人判斷「這段補了多少」的唯一依據**,寫錯等於給他一個假的分母。
#
#  ⛔ 這裡原有一段寫「§2 那句『表裡出現不該登入的帳號』刻意不補」——
#     **已於 2026-08-17 同一筆 commit 作廢**(code-reviewer 抓):
#     那道斷言本身已經在 B2 裡被【刪掉】了(它永遠走不到:精確配對已把表釘死成恰好那兩列)。
#     原句讀起來像「它還在,只是沒格」⇒ 下一個人會去 B2 找一道不存在的斷言。
#     ⇒ 現在守「系統帳號 / test_01 綁不了」的是 **0.6 的白名單行為探針**,負測 = S15 / S18 / S21 / S24。
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "══ 第四段:B2 前提斷言的行為負測 ══"

# S6 · 0.1a 表根本不存在(B1-b 沒 apply,或連錯庫)
drop_objs
cell_red_msg "S6 B1-b 沒跑過就 seed" "找不到 public.admin_user_staff_map" "$B2"

# S7 · 0.1b CHECK 白名單被拆掉
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;"
if [ "$(psqlq -c "select count(*) from pg_constraint where conrelid='public.admin_user_staff_map'::regclass and conname='admin_user_staff_map_staff_whitelist';")" != "0" ]; then
  echo "  🔴 S7 突變沒生效(CHECK 還在)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S7 CHECK 白名單被拆掉" "CHECK 白名單約束不見了" "$B2"
fi

# S8 · 0.1c 禁重綁的 trigger 被拆掉
#    🔴 這一格是【新覆蓋】:原版斷言只驗 no_delete 一道 ⇒ 拆 no_rebind 在改動前是【綠的】。
drop_objs; apply_b1b
run_sql "DROP TRIGGER admin_user_staff_map_no_rebind_trg ON public.admin_user_staff_map;"
cell_red_msg "S8 no_rebind trigger 被拆" "admin_user_staff_map_no_rebind_trg" "$B2"

# S9 · 0.1c 禁刪的 trigger 被拆掉 —— 防回歸:那道檢查改寫成列名版之後,原本就守得住的要繼續守得住
drop_objs; apply_b1b
run_sql "DROP TRIGGER admin_user_staff_map_no_delete_trg ON public.admin_user_staff_map;"
cell_red_msg "S9 no_delete trigger 被拆" "admin_user_staff_map_no_delete_trg" "$B2"

# S10 · 0.3 uuid 不在 auth.users(帳號還沒開,或 uuid 貼錯)
#    🔴 這一格【改到樁本身】⇒ 收尾必須還原並【當場驗還原成功】。
#       B-580 §3-5:改動會讓別的格的構造失效,而症狀出現在下游、帳算在別人頭上。
drop_objs; apply_b1b
run_sql "DELETE FROM auth.users WHERE id = '63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f';"
cell_red_msg "S10 uuid 不在 auth.users" "在 auth.users 裡找不到" "$B2"
run_sql "INSERT INTO auth.users VALUES ('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f') ON CONFLICT DO NOTHING;"
if [ "$(psqlq -c "select count(*) from auth.users where id='63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f';")" = "1" ]; then
  PASS=$((PASS+1)); printf "  ✅ %-34s 樁已還原(S10 沒有把下游弄壞)\n" "S10b 還原驗證"
else
  FAIL=$((FAIL+1)); printf "  🔴 %-34s 樁沒還原 ⇒ 後面每一格都會紅在錯的地方\n" "S10b 還原驗證"
fi

# S11 · 0.4 兩個 uuid 貼成同一個(複製貼上最容易犯的錯)
#    只改 §0 DECLARE 那一處,不動 INSERT ⇒ 紅在 0.4 而不是紅在 PK 衝突。
drop_objs; apply_b1b
S11_ANCHOR="v_staff_2 uuid := '63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f'"
if assert_anchor 1 "$S11_ANCHOR" "$B2"; then
  sed "s/${S11_ANCHOR}/v_staff_2 uuid := 'f5fb22ee-29f8-4af9-83b8-7fc9121eb533'/" "$B2" > "$D/seed_same_uuid.sql"
  cell_red_msg "S11 兩個 uuid 貼成同一個" "兩個 uuid 相同" "$D/seed_same_uuid.sql"
fi

# S12 · §2 落地列數 —— 少插一列時 v_n<>2 必須叫
drop_objs; apply_b1b
# 🔴 錨點踩過一次(2026-08-17,當場被 assert_anchor 擋下):`'staff_2');` 命中【2】次 ——
#    第二處是檔頭 :24 的退場說明 `DELETE … WHERE staff_id IN ('sean','staff_2');`。
#    用它當 sed 錨點 ⇒ 會把那行【註解】一起刪掉,而突變檔照樣紅在 v_n<>2 ⇒ 格子是綠的、測的東西是錯的。
#    ⇒ 錨點帶上 uuid 才唯一(已量:兩個都是 1)。
S12_DEL="'63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'staff_2');"
S12_SUB="'f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean'),"
if assert_anchor 1 "$S12_DEL" "$B2" && assert_anchor 1 "$S12_SUB" "$B2"; then
  sed -e "/${S12_DEL}/d" -e "s/${S12_SUB}/'f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean');/" "$B2" > "$D/seed_one_row.sql"
  cell_red_msg "S12 只插一列時列數斷言要叫" "預期 2 列,實際" "$D/seed_one_row.sql"
fi

# ── 以下三格來自 codex 對抗審查 2026-08-17 的三條 must-fix ──────────────────
# S14 · no_truncate 也要有自己的負測
#    🔴 我原本判「與 S8/S9 同一條 code path ⇒ 一個證據複印三份」而跳過它。
#       codex 指出那個判斷答錯了題:它守的不是「斷言會不會叫」,是**清單本身的回歸** ——
#       日後有人從 VALUES 清單裡拿掉 no_truncate,S8/S9 照樣綠,而保護少了一道、零訊號。
drop_objs; apply_b1b
run_sql "DROP TRIGGER admin_user_staff_map_no_truncate_trg ON public.admin_user_staff_map;"
cell_red_msg "S14 no_truncate trigger 被拆" "admin_user_staff_map_no_truncate_trg" "$B2"

# S15 · CHECK 白名單被【改成恆真】而名字沒變 —— 0.1 只比對 conname,看不見
drop_objs; apply_b1b
# 🔴 2026-08-17 這格的構造被【第四輪加的那道 pg_get_constraintdef 名字檢查】弄失效過一次:
#    原本用 `CHECK (true)`,而它定義裡沒有那三個名字 ⇒ 紅在「名單被縮掉了」而不是紅在探針。
#    **是 cell_red_msg 的訊息錨當場叫出來的**(只驗「有沒有紅」的話,這一格會靜靜地改測別的東西)。
#    ⇒ 誘餌改成【名字都在、但恆真】,才走得到探針那一段。
run_sql "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;
         ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist CHECK (staff_id IN ('sean','staff_1','staff_2') OR true);"
if [ "$(psqlq -c "select count(*) from pg_constraint where conrelid='public.admin_user_staff_map'::regclass and conname='admin_user_staff_map_staff_whitelist';")" != "1" ]; then
  echo "  🔴 S15 突變沒生效(同名約束沒加回來)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S15 白名單被換成恆真(同名)" "白名單擋不住 test_01" "$B2"
fi

# S16 · trigger 被【停用】而不是被刪 —— pg_trigger 那一列還在,而 trigger 不會跑
#    🔴 這條路是 B2 檔頭 :23-26 的退場程序自己造出來的(第 1 步 DISABLE、第 3 步忘了 ENABLE)。
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map DISABLE TRIGGER admin_user_staff_map_no_delete_trg;"
if [ "$(psqlq -c "select tgenabled from pg_trigger where tgrelid='public.admin_user_staff_map'::regclass and tgname='admin_user_staff_map_no_delete_trg';")" != "D" ]; then
  echo "  🔴 S16 突變沒生效(tgenabled 不是 D)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S16 trigger 被停用而非刪除" "admin_user_staff_map_no_delete_trg" "$B2"
fi

# ── 以下兩格來自 codex 對抗審查【第二輪】2026-08-17 的兩條 must-fix ──────────
# S17 · trigger 設成 ENABLE REPLICA(tgenabled='R')—— 正常操作下等同停用
#    🔴 第一輪的修法寫 `tgenabled <> 'D'`,這一格證明那是半套的:`R` 會過。
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map ENABLE REPLICA TRIGGER admin_user_staff_map_no_rebind_trg;"
if [ "$(psqlq -c "select tgenabled from pg_trigger where tgrelid='public.admin_user_staff_map'::regclass and tgname='admin_user_staff_map_no_rebind_trg';")" != "R" ]; then
  echo "  🔴 S17 突變沒生效(tgenabled 不是 R)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S17 trigger 設成 REPLICA-only" "admin_user_staff_map_no_rebind_trg" "$B2"
fi

# S18 · 白名單被掏空,而【另一道 CHECK】剛好也擋下探針 —— 探針被遮蔽
#    🔴 沒有 GET STACKED DIAGNOSTICS 那一段,這一格是【綠的】,而白名單已形同虛設。
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;
         ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist CHECK (staff_id IN ('sean','staff_1','staff_2') OR true);
         ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT zz_decoy_blocks_test01 CHECK (staff_id <> 'test_01');"
if [ "$(psqlq -c "select count(*) from pg_constraint where conrelid='public.admin_user_staff_map'::regclass and conname='zz_decoy_blocks_test01';")" != "1" ]; then
  echo "  🔴 S18 突變沒生效(誘餌約束沒加上)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S18 探針被別的 CHECK 遮蔽" "zz_decoy_blocks_test01" "$B2"
fi

# ── 以下三格來自 codex 對抗審查【第三輪 · 換模型 gpt-5.6-sol · 換角度】的 must-fix ──
#    🔴 病:`CREATE OR REPLACE FUNCTION` **不換 OID** ⇒ 函式本體被掏空,而 tgfoid 一個位元都沒變。
#       ⇒ S8/S9/S14/S16/S17 那五格【全部看不見這個世界】(它們動的是 trigger,不是函式本體)。
#    ⚠️ 三格都必須先證「突變真的把本體換掉了」—— 不然它們是恆綠的。
GUT="RETURNS trigger LANGUAGE plpgsql AS \$g\$ BEGIN RETURN NEW; END \$g\$;"
for T in no_truncate no_delete no_rebind; do
  drop_objs; apply_b1b
  run_sql "CREATE OR REPLACE FUNCTION public.admin_user_staff_map_${T}() $GUT"
  if [ "$(psqlq -c "select position('RETURN NEW' in prosrc) > 0 from pg_proc where proname='admin_user_staff_map_${T}';")" != "t" ]; then
    echo "  🔴 S19-$T 突變沒生效(函式本體沒被換掉)—— 這一格失去判別力"; FAIL=$((FAIL+1))
  else
    case "$T" in
      no_truncate) NEEDLE="TRUNCATE 沒有被擋下" ;;
      no_delete)   NEEDLE="DELETE 沒有被擋下" ;;
      no_rebind)   NEEDLE="UPDATE 沒有被擋下" ;;
    esac
    cell_red_msg "S19-$T 函式本體被掏空(OID 不變)" "$NEEDLE" "$B2"
  fi
done

# ── 以下兩格來自 codex 對抗審查【第四輪 · 質疑框架本身】的 must-fix ──────────
# S20 · 🔴🔴 **誤紅守門(唯一一格「預期 green」的負向情境)**
#    第二輪為了關「遮蔽」而用錯誤訊息的字認人 ⇒ 第四輪指出那讓【只改文案】變成 apply 失敗。
#    ⇒ 這一格構造「保護完全正常、只有措辭不同」的世界,B2 **必須照樣綠**。
#    ⚠️ 這格不是可有可無的對照:它守的是【Sean 在 apply 當天裝不裝得上去】。
drop_objs; apply_b1b
run_sql "CREATE OR REPLACE FUNCTION public.admin_user_staff_map_no_delete() RETURNS trigger LANGUAGE plpgsql AS \$w\$ BEGIN RAISE EXCEPTION '措辭換過了,但照樣不給刪'; END \$w\$;"
if [ "$(psqlq -c "select position('措辭換過了' in prosrc) > 0 from pg_proc where proname='admin_user_staff_map_no_delete';")" != "t" ]; then
  echo "  🔴 S20 突變沒生效(文案沒換掉)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell "S20 只改文案·保護正常 ⇒ 不可誤紅" green run_sql_file "$B2"
fi

# S21 · 白名單被換成「只擋 test_01」的同名約束 —— 單一探針測不出來
#    🔴 沒有第二個探針代號,這一格是【綠的】,而 x9 之類的代號綁得了帳號。
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;
         ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist CHECK (staff_id IN ('sean','staff_1','staff_2') OR staff_id <> 'test_01');"
# 🔴 這個誘餌【刻意】做成能通過前兩道:定義裡三個名字都在(過得了 pg_get_constraintdef 那道)、
#    test_01 也照樣擋(過得了第一個探針)⇒ 只有第二個探針代號抓得到它。
cell_red_msg "S21 白名單只擋 test_01(同名)" "擋不住 b2_probe_not_whitelisted" "$B2"

# ── 以下三格來自 code-reviewer 2026-08-17 的三條 Critical ────────────────────
#    🔴 它對 B2 下了突變證明:把 `tgtype` 那行刪掉 + `tgfoid` 換成 `AND true` ⇒ **62 格全綠**。
#       ⇒ 那兩道斷言是我自己加的,而我**一格負測都沒配**,還在 commit body 裡把它們寫成「已修」。
#       📎 形狀 = 「看到 → 寫下來 → 處理掉」停在第二步(memory feedback_seen-written-handled-are-three-steps)。

# S22 · tgtype:同名同函式的 trigger 被重建成 BEFORE INSERT ⇒ 禁刪根本沒在守
drop_objs; apply_b1b
run_sql "DROP TRIGGER admin_user_staff_map_no_delete_trg ON public.admin_user_staff_map;
         CREATE TRIGGER admin_user_staff_map_no_delete_trg BEFORE INSERT ON public.admin_user_staff_map
           FOR EACH ROW EXECUTE FUNCTION public.admin_user_staff_map_no_delete();"
if [ "$(psqlq -c "select tgtype from pg_trigger where tgrelid='public.admin_user_staff_map'::regclass and tgname='admin_user_staff_map_no_delete_trg';")" = "11" ]; then
  echo "  🔴 S22 突變沒生效(tgtype 還是 11)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S22 trigger 改掛 BEFORE INSERT" "admin_user_staff_map_no_delete_trg" "$B2"
fi

# S23 · tgfoid:同名同事件的 trigger 被重綁到【另一個函式】
drop_objs; apply_b1b
run_sql "DROP TRIGGER admin_user_staff_map_no_delete_trg ON public.admin_user_staff_map;
         CREATE TRIGGER admin_user_staff_map_no_delete_trg BEFORE DELETE ON public.admin_user_staff_map
           FOR EACH ROW EXECUTE FUNCTION public.admin_user_staff_map_no_rebind();"
if [ "$(psqlq -c "select p.proname from pg_trigger g join pg_proc p on p.oid=g.tgfoid where g.tgrelid='public.admin_user_staff_map'::regclass and g.tgname='admin_user_staff_map_no_delete_trg';")" != "admin_user_staff_map_no_rebind" ]; then
  echo "  🔴 S23 突變沒生效(還綁在原函式)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S23 trigger 被重綁到別的函式" "admin_user_staff_map_no_delete_trg" "$B2"
fi

# S24 · 白名單被【縮短】成兩個代號(同名)—— 兩個探針代號照樣被擋,只有名字檢查抓得到
drop_objs; apply_b1b
run_sql "ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;
         ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist CHECK (staff_id IN ('sean','staff_2'));"
if [ "$(psqlq -c "select position('staff_1' in pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.admin_user_staff_map'::regclass and conname='admin_user_staff_map_staff_whitelist';")" != "0" ]; then
  echo "  🔴 S24 突變沒生效(staff_1 還在定義裡)—— 這一格失去判別力"; FAIL=$((FAIL+1))
else
  cell_red_msg "S24 白名單被縮短(同名)" "名單被縮掉了" "$B2"
fi

# 🔴 收尾:把樁與物件回到「B1-b 剛跑完 + B2 跑完」的正常狀態,並驗它真的正常
#    (不是潔癖:上面 S6-S12 每一格都刻意弄壞了某個東西。)
drop_objs; apply_b1b
cell "S13 全部負測跑完後 B2 仍能正常 seed" green run_sql_file "$B2"

echo ""
echo "══════════════════════════════════════════════════════════"
printf "通過 %s 格 / 失敗 %s 格\n" "$PASS" "$FAIL"
echo "⚠️ 這些綠只證『SQL 與約束邏輯對』——【樁與真 Supabase 有落差】"
echo "   (樁沒有真 auth schema 的角色/權限/trigger)。真的驗要在等價 baseline 上做。"
[ "$FAIL" = "0" ] || exit 1
exit 0
