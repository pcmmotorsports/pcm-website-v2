#!/usr/bin/env bash
# ============================================================
# A7b-T · T4-2「ACL 64 格 / rollback 八步實跑 / 鎖窗量測」harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §4.5 / §7.2 / §10
# 用法:scripts/a7bt-acl-rollback-lock.sh all|run <workdir>
#
# 三塊(T4 的其餘三塊;突變證明是 T4-1 = `scripts/a7bt-mutation.sh`):
#   §1 **ACL 完整矩陣**:PG17 的**八種**表權限 × 四個 grantee × 兩張表
#      + 欄級 ACL 必須為零 + 七支函式的 EXECUTE ACL allowlist。
#      🔴 **`PUBLIC` 那一列排最前**(plan §4.5):`GRANT … TO PUBLIC` 會讓 anon/authenticated
#         因繼承轉紅 ⇒ PUBLIC 斷言排在後面的話,**把它整條刪掉仍然全綠**。順序是正確性的一部分。
#      🔴 **PG17 的第八種權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` 仍為 false
#         ⇒ 七格矩陣對它**完全無感**(已實測)。正式站同為 PG17。
#   §2 **rollback 八步(交易內模擬)**:跑 `scripts/a7bt-rollback.sql` 全部八步後驗零殘留、再 ROLLBACK。
#      證明的是**步序正確**、**preflight 的 filter 不會誤 abort 空表**,以及
#      **preflight 真的擋得住外部依賴**(view = pg_class、composite type 參數 = pg_type 兩種形狀各一)。
#      🔴 兩把鑰匙的身分閘也雙向驗:少確認字串、或宣告錯資料庫名,都必須被擋。
#   §3 **隔離庫真跑 + 鎖窗量測**:複製一份資料庫 → 真的 COMMIT 那八步 → 驗零殘留
#      → **重新 apply A7b-M + T1**,期間並行探測結帳所需的鎖 → 量交易總時長 → DROP DATABASE。
#      🔴 「重新 apply 成功」本身就是 rollback 正確性的最強證據(漏 DROP 一支函式就會撞名而死)。
#      🔴 鎖探針**兩支都在本檔**:T1(預期拿得到 = 零鎖面)與 **A7b-M**(預期紅在 55P03)。
#         plan §10 指名的風險是 A7b-M 建 FK 時對 order_items 的鎖 —— 那一格由本檔關閉。
#
# ── 🔴 不證明什麼 ───────────────────────────────────────────────────
#   · ~~舊字面:「鎖窗只量 T1,A7b-M 不在本檔」~~ —— 已作廢,**兩支都在本檔**(見上)。
#     T1 那一支的價值只有「證明它零鎖面」;真正有風險的數字來自 A7b-M 那一支。
#   · A7b-M **已經 apply 到正式站**了 ⇒ 那個鎖窗已經過去。這一格的價值是往前看的:
#     日後任何對 `order_items` 建 FK 的 migration 都要先量時長、排離峰。
#   · 「並行探針沒有被擋」= 在**本機、這一次**沒有被擋;不是所有負載下的保證。
#     依 `feedback_race-test-without-barrier-proves-nothing`,真正可引用的數字是
#     **交易總時長 = 持鎖窗上限**,不是「有沒有觀察到阻塞」。
#   · 本機 PG17.10 非 Supabase;正式站的 `db push` 另有 CLI 自己的交易行為。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/a7bt-fixtures.sh
. scripts/a7bt-fixtures.sh

MODE="${1:?用法: a7bt-acl-rollback-lock.sh all|run <workdir>}"
WORK="${2:?缺 workdir}"
export LC_ALL=C
guard_workdir "$WORK"

MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"
RB="scripts/a7bt-rollback.sql"
# 🔴 第二把鑰匙的值由 DB 自己回報，不在 shell 端寫死
#    （寫死的話「宣告值 == 實際值」就變成兩個都由我填 = 恆真）。
HOSTPORT=""

if [ "$MODE" = "all" ]; then
  log "0/4 provision 拋棄式 PG17"
  stop_stale_cluster "$WORK"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成"
else
  mkdir -p "$WORK"
fi
[ -f "$WORK/.d1t2-harness" ] || die "身分閘:$WORK 沒有 .d1t2-harness 標記,拒絕執行"
[ "$(runsql "SELECT current_setting('port') || '|' || current_database()")" = "54329|postgres" ] \
  || die "身分閘:連到的不是本機 54329 拋棄式 cluster,拒絕執行"
ok "身分閘通過"
HOSTPORT="$(runsql "SELECT coalesce(host(inet_server_addr()), 'local') || ':' || coalesce(inet_server_port()::text, '?')")"
[ "$HOSTPORT" = "127.0.0.1:54329" ] \
  || die "身分閘:連線 host:port = $HOSTPORT,不是本機 54329 拋棄式 cluster"
snapshot "$STRUCT_SQL" "$WORK/struct-before.snap" "起始結構快照"

# ══════════════════════════════════════════════════════════════
# 1. ACL 完整矩陣
# ══════════════════════════════════════════════════════════════
log "1/4 ACL:八種權限 × 四 grantee × 兩表(PUBLIC 排最前)+ 欄級零 + 函式 allowlist"

PRIVS="SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN"
acl_expect() {  # $1=grantee $2=table $3=priv -> t|f
  case "$1" in
    public|anon|authenticated) echo f; return ;;
  esac
  # 🔴 分隔符用 `:` 不用 `|` —— shell `case` 的 `|` 是 pattern **alternation**,
  #    寫成 "$2|$3" 會被拆成一堆不可能命中的候選 ⇒ 整組 service_role 期望值靜默變成 f
  #    (首跑就是這樣紅了 5 格;是我的期望表壞掉,不是 ACL 壞掉)。
  case "$2:$3" in
    order_refund_jobs:SELECT|order_refund_jobs:INSERT|order_refund_jobs:UPDATE) echo t ;;
    order_refund_job_items:SELECT|order_refund_job_items:INSERT) echo t ;;
    *) echo f ;;
  esac
}
acl_bad=0; acl_n=0
# 🔴 grantee 順序:PUBLIC 第一(理由見檔頭)
for g in public anon authenticated service_role; do
  for t in order_refund_jobs order_refund_job_items; do
    for p in $PRIVS; do
      acl_n=$((acl_n + 1))
      want="$(acl_expect "$g" "$t" "$p")"
      got="$(runsql "SELECT has_table_privilege('$g', 'public.$t', '$p')")"
      if [ "$got" != "$want" ]; then
        acl_bad=$((acl_bad + 1))
        bad "ACL:$g × $t × $p 期望 $want,實為 $got"
      fi
    done
  done
done
[ "$acl_bad" -eq 0 ] \
  && ok "ACL 矩陣 $acl_n 格全部符合(4 grantee × 2 表 × 8 權限;PUBLIC 排最前,含 PG17 的 MAINTAIN)" \
  || bad "ACL 矩陣有 $acl_bad 格不符"

# 🔴 `has_table_privilege` 看不到**欄級** ACL(那是另一個目錄欄位)⇒ 必須另外驗它是零。
# 🔴🔴 關卡2 R2：owner 原本只進結構快照 = 只證明「跑之前跑之後一樣」，
#    **不證明它現在是 postgres**。owner 若在跑之前就已漂移到別的角色，
#    那個角色的隱含權限**不會出現在 ACL 64 格或 aclexplode 裡**（owner 不需 GRANT）。
tbl_owner="$(runsql "SELECT coalesce(string_agg(DISTINCT pg_get_userbyid(c.relowner), ','), '(無)') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')")"
[ "$tbl_owner" = "postgres" ] \
  && ok "兩張表的 owner 都是 postgres(owner 的隱含權限不經 ACL ⇒ 必須單獨釘死,不能只靠快照)" \
  || bad "🔴 表 owner 不是 postgres,而是 [$tbl_owner] ⇒ ACL 矩陣量不到它的權限"

col_acl="$(runsql "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items') AND a.attacl IS NOT NULL")"
[ "$col_acl" = "0" ] && ok "欄級 ACL 為零(八格矩陣看不到欄級授權,必須另驗)" \
                     || bad "欄級 ACL 不是零(實為 $col_acl)⇒ 有人對單一欄位開了權限"

# 完整 grantee × privilege × grant-option 集合(aclexplode;八格矩陣抓不到第四個角色以外的 grantee)
acl_set="$(runsql "SELECT coalesce(string_agg(sig, ',' ORDER BY sig), '(空)') FROM (SELECT DISTINCT c.relname||':'||coalesce(pg_get_userbyid(ae.grantee),'PUBLIC')||':'||ae.privilege_type||':'||ae.is_grantable AS sig FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) ae WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')) s")"
acl_want="order_refund_job_items:postgres:DELETE:false,order_refund_job_items:postgres:INSERT:false,order_refund_job_items:postgres:MAINTAIN:false,order_refund_job_items:postgres:REFERENCES:false,order_refund_job_items:postgres:SELECT:false,order_refund_job_items:postgres:TRIGGER:false,order_refund_job_items:postgres:TRUNCATE:false,order_refund_job_items:postgres:UPDATE:false,order_refund_job_items:service_role:INSERT:false,order_refund_job_items:service_role:SELECT:false,order_refund_jobs:postgres:DELETE:false,order_refund_jobs:postgres:INSERT:false,order_refund_jobs:postgres:MAINTAIN:false,order_refund_jobs:postgres:REFERENCES:false,order_refund_jobs:postgres:SELECT:false,order_refund_jobs:postgres:TRIGGER:false,order_refund_jobs:postgres:TRUNCATE:false,order_refund_jobs:postgres:UPDATE:false,order_refund_jobs:service_role:INSERT:false,order_refund_jobs:service_role:SELECT:false,order_refund_jobs:service_role:UPDATE:false"
[ "$acl_set" = "$acl_want" ] \
  && ok "aclexplode 完整集合相等(21 筆:owner 八權 ×2 表 + service_role 3+2;零 WITH GRANT OPTION、零第五個 grantee)" \
  || bad "aclexplode 集合不符 —— 實際:$acl_set"

# 七支函式:EXECUTE 只能有 owner(T1 已 REVOKE PUBLIC/anon/authenticated)
# 🔴🔴 **關卡2 #12:`proacl IS NULL` 這一格原本是假綠。**
#    PostgreSQL 對「從未被 GRANT/REVOKE 過」的函式把 `proacl` 存成 NULL,語意是
#    **預設 ACL = PUBLIC 有 EXECUTE**(最寬鬆的狀態)。而 `aclexplode(NULL)` 回**零列**
#    ⇒ 下面那個 `fn_bad` 會是空字串 ⇒ 印出「只有 owner」。
#    也就是說:權限被恢復成最寬鬆的那一刻,這條斷言反而最綠。
#    ⇒ 先單獨釘死「七支都必須有明文 ACL」,再談 grantee 是誰。
fn_null="$(runsql "SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%' AND p.proacl IS NULL")"
[ -z "$fn_null" ] && ok "七支函式都有明文 proacl(NULL = 恢復預設的 PUBLIC EXECUTE,而 aclexplode 對它回零列 ⇒ 必須單獨擋)" \
                  || bad "🔴 函式 proacl 為 NULL(= PUBLIC 可執行的預設狀態):$fn_null"
fn_n="$(runsql "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%'")"
[ "$fn_n" = "7" ] && ok "pcm_a7bt_* 函式恰 7 支(少一支的話上面那條「全都有 ACL」會空集合成立)" \
                  || bad "pcm_a7bt_* 函式是 $fn_n 支,預期 7"
fn_bad="$(runsql "SELECT coalesce(string_agg(DISTINCT p.proname||':'||coalesce(pg_get_userbyid(ae.grantee),'PUBLIC'), ','), '') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) ae WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%' AND pg_get_userbyid(ae.grantee) <> 'postgres'")"
[ -z "$fn_bad" ] && ok "七支函式的 EXECUTE 只有 owner(PUBLIC / anon / authenticated / service_role 全數 REVOKE)" \
                 || bad "函式 EXECUTE 有 owner 以外的 grantee:$fn_bad"

# ══════════════════════════════════════════════════════════════
# 2. rollback 六步(交易內模擬,最後 ROLLBACK)
# ══════════════════════════════════════════════════════════════
log "2/4 rollback 六步(交易內模擬;驗步序 + preflight filter 不會誤 abort 空表)"

# 🔴 `a7bt-rollback.sql`（八步）自帶 BEGIN/COMMIT ⇒ 模擬版把最後那個 COMMIT 換成 ROLLBACK。
#    這正是 A7「BEGIN→migration 全文→RAISE 的模擬**會真的提交**」那次事故的修法:
#    不要把自帶 COMMIT 的檔案包進外層交易,要**明確處理它自己的 COMMIT**。
sed 's/^COMMIT;$/ROLLBACK;/' "$RB" > "$WORK/rb-dryrun.sql"
grep -q '^ROLLBACK;$' "$WORK/rb-dryrun.sql" && ! grep -q '^COMMIT;$' "$WORK/rb-dryrun.sql" \
  || die "模擬版 rollback 檔沒有把 COMMIT 換成 ROLLBACK ⇒ 硬跑會真的刪掉兩張表"

# 🔴 **身分閘要雙向驗**:不帶確認字串必須被擋(否則那道閘等於不存在)
noconf="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/rb-dryrun.sql" 2>&1)"
case "$noconf" in
  *"身分閘"*) ok "rollback ⓪ 身分閘:未帶 i_know 確認字串時被擋下" ;;
  *) bad "rollback ⓪ 身分閘**沒有擋住**未帶確認字串的呼叫 ⇒ 誤貼到正式站會安靜地 DROP 兩張表" ;;
esac

# 🔴 **關卡2 #18 的第二把鑰匙也要雙向驗**:宣告錯的資料庫名必須被擋。
wrongdb="$(psql "$URL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db=definitely_not_this_db -v hostport="$HOSTPORT" -qtA -f "$WORK/rb-dryrun.sql" 2>&1)"
case "$wrongdb" in
  *"身分閘(第二把)"*) ok "rollback ⓪ 身分閘(第二把):宣告的資料庫名與實際連線不符時被擋下" ;;
  *) bad "rollback ⓪ 第二把鑰匙**沒有擋住**錯的資料庫名 ⇒ 帶著 runbook 的字串誤連 production 仍會放行" ;;
esac

# 🔴 第二把鑰匙的**另一半**也要雙向驗:資料庫名對、但 host:port 講錯,一樣要被擋。
#    （只驗 db 名的版本在「測試庫與正式庫都叫 postgres」時形同虛設 —— 關卡2 R2 的原話。）
wronghp="$(psql "$URL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport=10.0.0.1:5432 -qtA -f "$WORK/rb-dryrun.sql" 2>&1)"
case "$wronghp" in
  *"身分閘(第二把)"*) ok "rollback ⓪ 身分閘(第二把):資料庫名對但 host:port 不符時仍被擋下" ;;
  *) bad "rollback ⓪ 第二把鑰匙的 host:port 那一半**沒有擋住** ⇒ 同名資料庫誤連仍會放行" ;;
esac

out="$(psql "$URL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport="$HOSTPORT" -qtA -f "$WORK/rb-dryrun.sql" 2>&1)"
rc=$?
steps="$(printf '%s\n' "$out" | sed -n 's/.*A7B-RB|//p' | cut -d'|' -f1 | tr '\n' ',')"
if [ "$rc" -eq 0 ] && [ "$steps" = "0,1,2,3,3b,4,5,6,7," ]; then
  ok "rollback 全九步(⓪身分 → ①preflight → ②writer → ③空表 → ③b T 是否已套用 → ④子表 → ⑤主表 → ⑥零殘留 → ⑦ledger)在交易內跑完;① 對**空表**放行 = filter 沒有誤 abort"
else
  bad "rollback 步序模擬失敗(rc=$rc,走到的步驟=[$steps],預期 0,1,2,3,3b,4,5,6,7,)— $(printf '%s\n' "$out" | grep -m1 ERROR | cut -c1-160)"
fi

# 🔴🔴 **關卡2 R2:第 ⑦ 步(刪 migration ledger)原本可以恆真。**
#    拋棄式 cluster 沒有 `supabase_migrations.schema_migrations` ⇒ 本檔每次都走「略過」那一支,
#    真正會在正式站執行的那一支**從來沒被跑過**。把它改成:先種兩列、跑、斷言真的刪到 2 列。
#    🔴 種完之後**不清掉**會影響後面的隔離庫測試 ⇒ 用完即 DROP SCHEMA。
psql "$URL" -v ON_ERROR_STOP=1 -qtA >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260731120000'), ('20260731120100') ON CONFLICT DO NOTHING;
SQL
led="$(psql "$URL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport="$HOSTPORT" -qtA -f "$WORK/rb-dryrun.sql" 2>&1 | sed -n 's/.*A7B-RB|7|//p' | tail -1)"
case "$led" in
  ledger-deleted=2\|want=2) ok "rollback ⑦:ledger 兩列**真的被刪到**(先種再跑再斷言;拋棄式 cluster 平常走「略過」那一支 ⇒ 不種就等於沒測過)" ;;
  *) bad "rollback ⑦ 沒有刪到 2 列 ledger,實為 [$led] ⇒ 正式站漏刪會讓 db push 不重建兩表且無訊號" ;;
esac
# 🔴 負向:少一列時必須 abort(關卡2 R2 要的「DELETE 0/1 不得靜默 commit」)
psql "$URL" -qtA -c "DELETE FROM supabase_migrations.schema_migrations WHERE version='20260731120100'" >/dev/null 2>&1
led1="$(psql "$URL" -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport="$HOSTPORT" -qtA -f "$WORK/rb-dryrun.sql" 2>&1 | tr '\n' ' ')"
case "$led1" in
  *"ledger 應刪掉 2 列"*) ok "rollback ⑦ 負向:ledger 只剩 1 列時當場 abort(版本號打錯 / 少登記都會長這樣)" ;;
  *) bad "rollback ⑦ 負向:ledger 少一列竟然沒有 abort ⇒ schema 與 ledger 會靜默分裂" ;;
esac
# 🔴 ⑦ 的 escape 也要雙向驗(Fable R3 F7):帶了 `skip_ledger_count=YES_I_CHECKED`
#    之後,同一個「少一列」的情境必須降級成 WARNING 而**不是**繼續 abort ——
#    否則那個 escape 只是註解裡的一句承諾。ledger 現在仍是「少一列」的狀態。
led2="$(psql "$URL" -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport="$HOSTPORT" -v skip_ledger_count=YES_I_CHECKED -qtA -f "$WORK/rb-dryrun.sql" 2>&1 | tr '\n' ' ')"
case "$led2" in
  *"明文放行"*) ok "rollback ⑦ escape:帶 skip_ledger_count=YES_I_CHECKED 時降級成 WARNING、回滾得以繼續(半夜真的要退時不會被自己的守門擋死)" ;;
  *) bad "rollback ⑦ escape 沒有生效 ⇒ ledger 對不上時只能改檔案才退得掉 — $(printf '%s' "$led2" | cut -c1-160)" ;;
esac
# 🔴 F19:這個 schema 是本段自己種的。中途 abort 時它會留下來,而下一段的隔離庫是
#    `CREATE DATABASE … TEMPLATE postgres` ⇒ 會把它一起複製過去 ⇒ 隔離庫的 ⑦ 行為改變。
#    ⇒ 這一句必須是無條件的收尾,而且下一段開頭再確認一次(不靠「上面沒出錯」這個假設)。
psql "$URL" -qtA -c "DROP SCHEMA supabase_migrations CASCADE" >/dev/null 2>&1

# 🔴🔴 **關卡2 #21:preflight 原本只測了「放行」那個方向。**
#    「有外部依賴會被擋下」這句話從來沒有證據 —— 而那正是這道 preflight 存在的唯一理由。
#    ⇒ 兩種形狀各測一次,且**必須是 pg_depend 真的記得住的兩種不同 refclassid**:
#      ① 外部 VIEW  → refclassid = pg_class
#      ② 以 composite type 當參數的外部函式 → refclassid = **pg_type**(#19 新補的那一支)
# 🔴 psql 的 `-c` 不接受「SQL + 反斜線 meta-command」混在同一個字串裡 ⇒ 寫成檔案再跑。
#    外層 BEGIN 之後 `\i` 進來的檔案自帶 BEGIN(只會 WARNING)與結尾 ROLLBACK
#    ⇒ 探針建的 view / 函式一併被回滾,零留痕。
for nm in view composite; do
  case "$nm" in
    view)      ddl="CREATE VIEW public.a7b_ext_probe_v AS SELECT id FROM public.order_refund_jobs;" ;;
    composite) ddl="CREATE FUNCTION public.a7b_ext_probe_f(public.order_refund_jobs) RETURNS uuid LANGUAGE sql AS 'SELECT \$1.id';" ;;
  esac
  { printf 'BEGIN;\n%s\n' "$ddl"; printf '\\i %s\n' "$WORK/rb-dryrun.sql"; printf 'ROLLBACK;\n'; } > "$WORK/rb-ext-$nm.sql"
  pf="$(psql "$URL" -v i_know=DROP_A7B_M_AND_T -v db=postgres -v hostport="$HOSTPORT" -qtA -f "$WORK/rb-ext-$nm.sql" 2>&1 | tr '\n' ' ')"
  case "$pf" in
    *"① preflight 失敗"*) ok "preflight 擋得住外部依賴($nm)⇒ 這道閘不是只會對空庫說 OK" ;;
    *) bad "🔴 preflight **沒有擋住**外部依賴($nm)⇒ 硬 DROP 會連帶破壞它 — 實際輸出:$(printf '%s' "$pf" | cut -c1-220)" ;;
  esac
done
# ROLLBACK 之後兩表與七支函式必須都還在
alive="$(runsql "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')) || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%')")"
[ "$alive" = "2/7" ] && ok "模擬之後兩表與七支函式都還在($alive)⇒ ROLLBACK 乾淨" \
                     || bad "模擬之後 catalog 不是 2 表 / 7 函式,而是 $alive"

# 🔴 **反向步序必須被證明會失敗**(code-reviewer M8):
#    只跑「這個順序會成功」不叫步序驗證 —— 那句話要成立,必須有一格證明
#    「先 DROP parent 會被擋」。`feedback_falsifiable-prediction-beats-endorsement`。
# 🔴 **關卡2 #13:原本只比英文字面**(`depends on` / `cannot drop`)——
#    那些字串在別的錯誤裡也會出現(權限、鎖、relation not found 的訊息都可能含 cannot),
#    而「必紅在 2BP01(dependent_objects_still_exist)」這句話從來沒被取得過。
#    ⇒ 改成在 DO block 內抓 SQLSTATE,只認 2BP01。
rev="$(psql "$URL" -qtA -c "BEGIN; DO \$d\$ BEGIN DROP TABLE public.order_refund_jobs RESTRICT; RAISE NOTICE 'REV|(未擋:竟然成功)'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'REV|%', SQLSTATE; END \$d\$; ROLLBACK;" 2>&1 | sed -n 's/.*REV|//p' | tail -1)"
case "$rev" in
  2BP01) ok "反向步序:先 DROP parent(order_refund_jobs)紅在 **SQLSTATE 2BP01**(dependent_objects_still_exist)⇒ 六步的順序不是可有可無的" ;;
  *)     bad "反向步序:先 DROP parent 應紅在 2BP01,實為 [$rev]⇒ 「步序不可調換」這句話沒有證據" ;;
esac

# ══════════════════════════════════════════════════════════════
# 3. 隔離庫:真跑 rollback → 重新 apply T1(並行鎖探針 + 計時)
# ══════════════════════════════════════════════════════════════
log "3/4 隔離庫真跑 rollback + 重新 apply T1 + 鎖窗量測"

CDB="a7bt_t4_rb"
CURL="postgresql://postgres@127.0.0.1:${PORT}/${CDB}"
ADMIN="postgresql://postgres@127.0.0.1:${PORT}/template1"
psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
# 🔴 F19 續:模板庫裡不得殘留上一段種的 ledger schema(中途 abort 會留下)。
[ "$(runsql "SELECT count(*) FROM pg_namespace WHERE nspname='supabase_migrations'")" = "0" ] \
  || die "第 2 段種的 supabase_migrations schema 還在 ⇒ 隔離庫會複製到它、第 3 段的 ⑦ 行為與正式站不同"
if ! psql "$ADMIN" -v ON_ERROR_STOP=1 -qtA -c "CREATE DATABASE $CDB TEMPLATE postgres" >"$WORK/rb-create.log" 2>&1; then
  bad "建立隔離資料庫失敗 ⇒ 第 3 段**未執行**,不得算過"
else
  if psql "$CURL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db="$CDB" -v hostport="$HOSTPORT" -qtA -f "$RB" > "$WORK/rb-real.log" 2>&1; then
    left="$(psql "$CURL" -qtA -c "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')) || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%')")"
    [ "$left" = "0/0" ] \
      && ok "rollback 在隔離庫**真的 COMMIT 過**:兩表與七支函式全數消失($left)" \
      || bad "rollback 真跑後仍有殘留($left)"
  else
    bad "rollback 真跑失敗(見 $WORK/rb-real.log)"
  fi

  # ── 重建:**A7b-M 再 A7b-T 兩支**(rollback 連 M 建的兩張表一起 DROP 了)
  #    🔴 首跑我只重套 T1 ⇒ 當然失敗(T1 的前置閘明說「兩表不存在請先套 A7b-M」)。
  #      那是我的測試設計錯,不是 rollback 漏 DROP —— 已更正為重套兩支。
  #    🔴 「重建成功」才是 rollback 正確性的最強證據:漏 DROP 任何一支函式(尤其**不在
  #      trigger manifest 裡**的 `pcm_a7bt_allowed_delta`),重建會撞「已有同名函式」而死。
  MIG_M="supabase/migrations/20260731120000_m4b_e10_a7b_m_refund_jobs.sql"
  t0="$(psql "$CURL" -qtA -c "SELECT extract(epoch from clock_timestamp())")"
  if psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$MIG_M" > "$WORK/rebuild-m.log" 2>&1 \
     && psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$MIG" > "$WORK/rebuild-t.log" 2>&1; then
    t1="$(psql "$CURL" -qtA -c "SELECT extract(epoch from clock_timestamp())")"
    dur="$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.0f", (b-a)*1000}')"
    ok "**rollback 之後 A7b-M + A7b-T 兩支都重套成功** ⇒ 六步沒有漏 DROP(漏一支函式就會撞名而死)"
    ok "鎖窗上限:M + T 兩支 apply 的牆鐘總時長 = ${dur} ms(這是**上限**,不是實際持鎖時間)"
  else
    bad "重建失敗(見 $WORK/rebuild-m.log / $WORK/rebuild-t.log)⇒ rollback 有漏 DROP"
  fi

  # ── 鎖探針:**用 barrier,不用賽跑** ──
  #    🔴 首跑用「啟動後輪詢」⇒ T1 只跑 50ms、探針還沒進場就結束了,判成「沒探到」。
  #      沒探到就靜靜算過的話這一格會永遠假綠 ⇒ 改成把 T 的交易**停在 COMMIT 之前**,
  #      探完才放行(同 §7.4-6 併發測試的做法)。
  psql "$CURL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db="$CDB" -v hostport="$HOSTPORT" -qtA -f "$RB" > "$WORK/rb-real2.log" 2>&1 \
    && psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$MIG_M" > "$WORK/rebuild-m2.log" 2>&1 \
    || bad "鎖探針前置(再 rollback 一次 + 重套 M)失敗"

  # ══ 🔴🔴 **F6:「M 已 apply、T 未 apply」下的回滾**(Fable R3 判 NO-GO 的第二條)══════
  #    正式站**現在**就是這個狀態。原版第 ④ 步第一句 `DROP TRIGGER … ON order_cancellation_items`
  #    刻意不帶 `IF EXISTS` ⇒ 那支 trigger 根本不存在 ⇒ 42704 ⇒ 同一筆交易全滅
  #    ⇒ **連 A7b-M 都退不掉**。這一格就是把那個情境真的跑一次。
  # 🔴 這裡的 M-only 是**真的**跑 A7b-M 那支 migration 得到的(上面那兩句 rollback + 重套 M),
  #    不是「把 T 的物件手動拆掉」湊出來的 —— 後者證明不了 migration 產生的狀態長什麼樣。
  # 🔴 必須斷言 `t-applied=NO` 這個 NOTICE:否則「跑完沒錯」也可能是它誤判成 T 還在、
  #    而那些 DROP 碰巧都成功(那就不是在測 M-only 這條路徑)。
  mo_out="$(psql "$CURL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db="$CDB" -v hostport="$HOSTPORT" -qtA -f "$RB" 2>&1)"
  mo_rc=$?
  mo_flag="$(printf '%s\n' "$mo_out" | sed -n 's/.*A7B-RB|3b|//p' | tail -1)"
  mo_left="$(psql "$CURL" -qtA -c "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')) || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pcm\\_a7bt\\_%')")"
  [ "$mo_flag" = "t-applied=NO" ] \
    && ok "rollback ③b:M-only 狀態被正確判定為「T 未套用」(這一格若判成 YES,下面的綠是別條路徑的綠)" \
    || bad "rollback ③b 判定錯誤:M-only 狀態下 t-applied=[$mo_flag]"
  { [ "$mo_rc" -eq 0 ] && [ "$mo_left" = "0/0" ]; } \
    && ok "🔴 **F6 關閉**:M 已 apply、T 未 apply 時整包 rollback 跑得完、兩張表真的退掉($mo_left)— 修法前這裡會死在 42704 而連 A7b-M 都退不掉" \
    || bad "F6 未關:M-only 狀態下 rollback 失敗(rc=$mo_rc,殘留=$mo_left)— $(printf '%s\n' "$mo_out" | grep -m1 ERROR | cut -c1-160)"

  # 復原成 M-only,讓下面的 T1 鎖探針有它需要的前置
  psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$MIG_M" > "$WORK/rebuild-m3.log" 2>&1 \
    || bad "F6 之後重套 A7b-M 失敗 ⇒ 下面的 T1 鎖探針前置不成立"

  rm -f "$WORK/t1-started" "$WORK/t1-go"
  python3 scripts/lib/a7bt-barrier-migration.py "$MIG" "$WORK/t1" > "$WORK/t1-barrier.sql" \
    || die "barrier 版 T1 產生失敗 ⇒ 鎖探針不得算過"
  grep -q 't1-started' "$WORK/t1-barrier.sql" || die "barrier 版 T1 沒有插入標記 ⇒ 鎖探針不得算過"

  psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/t1-barrier.sql" > "$WORK/t1-barrier.log" 2>&1 &
  pid_t1=$!
  probe_res="(沒探到)"
  for _ in $(seq 1 300); do [ -f "$WORK/t1-started" ] && break; sleep 0.05; done
  if [ -f "$WORK/t1-started" ]; then
    # 🔴 **正向斷言**(code-reviewer M3):只比對 ERROR 字串的話,連線失敗 / 空輸出 /
    #    非英文 lc_messages 全部會落進「綠」那一格。改成「必須看到 PROBE-OK」。
    probe_res="$(psql "$CURL" -qtA -c "BEGIN; LOCK TABLE public.orders IN ROW EXCLUSIVE MODE NOWAIT; LOCK TABLE public.order_items IN ROW EXCLUSIVE MODE NOWAIT; SELECT 'PROBE-OK'; ROLLBACK;" 2>&1 | tr '\n' ' ')"
  fi
  touch "$WORK/t1-go"
  wait "$pid_t1"; rc_t1=$?
  [ "$rc_t1" -eq 0 ] || bad "barrier 版 T1 沒有正常 COMMIT(見 $WORK/t1-barrier.log)"

  case "$probe_res" in
    *PROBE-OK*)
      ok "鎖探針(barrier 攔住 **T1** 的交易、確定它還沒 COMMIT):第二條連線仍取得 orders + order_items 的 ROW EXCLUSIVE = 結帳 INSERT 需要的那把鎖 ⇒ **T1 對結帳零鎖面**" ;;
    *)
      bad "鎖探針沒有回 PROBE-OK ⇒ T1 交易開著時拿不到結帳需要的鎖,或探針自己壞了 — $probe_res" ;;
  esac

  # ══ 🔴🔴 真正該量的是 **A7b-M**,不是 T1(code-reviewer M1;我親自複驗成立)══════
  #    plan §10 逐字:「真正的風險不是 dormant gate,是**建 FK 時對 order_items 的鎖**」
  #    —— 那是 **A7b-M** 幹的事。T1 只建 trigger/函式、只碰自己那兩張表 ⇒ 對它做探針必綠、零資訊量。
  #    交接檔把這件事指給 A7b-T、本檔第一版又推回 A7b-M = **循環推卸,結果沒人做過**。
  #    ⇒ 這裡對 M 做同一套 barrier 探針,把 plan §10 那個驗收項真的關掉。
  psql "$CURL" -v ON_ERROR_STOP=1 -v i_know=DROP_A7B_M_AND_T -v db="$CDB" -v hostport="$HOSTPORT" -qtA -f "$RB" > "$WORK/rb-real3.log" 2>&1 \
    || bad "M 鎖探針前置(再 rollback 一次)失敗"
  rm -f "$WORK/m-started" "$WORK/m-go"
  python3 scripts/lib/a7bt-barrier-migration.py "$MIG_M" "$WORK/m" > "$WORK/m-barrier.sql" \
    || die "barrier 版 A7b-M 產生失敗 ⇒ 這一格不得算過"
  grep -q 'm-started' "$WORK/m-barrier.sql" || die "barrier 版 A7b-M 沒有插入標記"

  mt0="$(psql "$CURL" -qtA -c "SELECT extract(epoch from clock_timestamp())")"
  psql "$CURL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/m-barrier.sql" > "$WORK/m-barrier.log" 2>&1 &
  pid_m=$!
  m_probe="(沒探到)"
  for _ in $(seq 1 400); do [ -f "$WORK/m-started" ] && break; sleep 0.05; done
  if [ -f "$WORK/m-started" ]; then
    # 🔴 psql 預設不印 SQLSTATE ⇒ 在 DO block 裡抓,才能斷言「55P03」而不是比對英文訊息。
    m_probe="$(psql "$CURL" -qtA -c "BEGIN; SET LOCAL lock_timeout='2s'; DO \$p\$ BEGIN LOCK TABLE public.order_items IN ROW EXCLUSIVE MODE NOWAIT; RAISE NOTICE 'MPROBE|PROBE-OK'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'MPROBE|%', SQLSTATE; END \$p\$; ROLLBACK;" 2>&1 | tr '\n' ' ')"
  fi
  touch "$WORK/m-go"
  wait "$pid_m"; rc_m=$?
  mt1="$(psql "$CURL" -qtA -c "SELECT extract(epoch from clock_timestamp())")"
  [ "$rc_m" -eq 0 ] || bad "barrier 版 A7b-M 沒有正常 COMMIT(見 $WORK/m-barrier.log)"
  # 🔴🔴 **關卡2 #14:原本這裡是「除了 PROBE-OK 與『沒探到』以外,一律當作鎖衝突」。**
  #    那個 `*)` 會把連線失敗、認證錯、語法錯、relation not found、psql 根本沒跑起來
  #    全部翻譯成「鎖真的擋住了」⇒ 探針壞掉的那一刻,結論最漂亮。
  #    ⇒ 只認 PostgreSQL 對 `NOWAIT` 拿不到鎖時給的那一個明確 SQLSTATE:**55P03**
  #      (lock_not_available)。其餘一律當探針故障。
  case "$m_probe" in
    *"沒探到"*) bad "A7b-M 鎖探針**沒有真的探到** ⇒ 這一格什麼都沒證明,不得算過" ;;
    *PROBE-OK*) bad "A7b-M 鎖探針竟然拿得到 order_items 的 ROW EXCLUSIVE — 與 plan §10 的預期相反,請重新檢查探針" ;;
    *55P03*)
      # 🔴 這是**預期中的結果**,不是缺陷:plan §10 早就標了。價值在於它從此有實測數字。
      ok "**plan §10 的驗收項關閉**:A7b-M 的交易開著時,結帳 INSERT 需要的 order_items ROW EXCLUSIVE **確實拿不到**(SQLSTATE 55P03 = lock_not_available)⇒ apply A7b-M 期間結帳會被卡住,卡多久 = 該交易總時長" ;;
    *)
      bad "A7b-M 鎖探針的輸出既不是 PROBE-OK 也不是 55P03 ⇒ **探針自己壞了**,不得當成「鎖擋住了」— $(printf '%s' "$m_probe" | cut -c1-160)" ;;
  esac
  # barrier 版含人為等待 ⇒ 這裡不能拿它當時長。用前面那次「無 barrier 重套 M+T」的數字。
  ok "A7b-M 的持鎖窗上限沿用前面那次無 barrier 重套的量測(M+T 合計 ${dur:-?} ms);barrier 版含人為等待、不可當時長"


  psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS $CDB" >/dev/null 2>&1
  [ "$(psql "$ADMIN" -qtA -c "SELECT count(*) FROM pg_database WHERE datname='$CDB'")" = "0" ] \
    && ok "隔離資料庫已刪除(主庫全程零接觸)" || bad "隔離資料庫沒刪掉"
fi

# ══════════════════════════════════════════════════════════════
# 4. 零留痕 / 結構零漂移
# ══════════════════════════════════════════════════════════════
log "4/4 零留痕 / 結構零漂移"
for t in order_refund_jobs order_refund_job_items order_cancellations \
         order_cancellation_items order_refunds order_refund_items; do
  [ "$(runsql "SELECT count(*) FROM public.$t")" = "0" ] \
    && ok "零留痕:$t 仍為 0 列" || bad "零留痕失敗:$t 不是 0 列"
done
snapshot "$STRUCT_SQL" "$WORK/struct-after.snap" "收尾結構快照"
cmp -s "$WORK/struct-before.snap" "$WORK/struct-after.snap" \
  && ok "結構零漂移:主庫 catalog 一個 byte 都沒變(rollback 真跑只發生在隔離庫)" \
  || bad "結構漂移:主庫被動到了"

[ "$MODE" = "all" ] && count_gate - 36 || count_gate - 35

printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
