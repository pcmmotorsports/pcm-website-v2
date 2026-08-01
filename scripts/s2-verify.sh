#!/usr/bin/env bash
# S2 供應商寫入 RPC(admin_upsert_supplier)— 驗收 harness
#
# 用法:bash scripts/s2-verify.sh [<work-dir>]     預設 /tmp/s2-work
#   前置:bash scripts/d1t2-rehearsal.sh provision /tmp/s2-work
#
# 段落:§0 harness 自我測試 / §A 結構與 ACL / §B 行為 / §C 突變證明 / §D 誠實邊界。
# 🔴 §0 在最前面:先證明這支腳本抓得到失敗,否則後面全綠沒有意義。
# 🔴 §B 每個案例都跑在 BEGIN … ROLLBACK 裡 ⇒ 零留痕;唯一例外是 §B-atomic,
#    它**故意**要觀察交易收掉之後的狀態(那正是它要證明的事)。
# 🔴 本 harness 不宣稱「每條具名守門都有突變證明」——§D 逐條列出沒有突變的那些與原因。

set -uo pipefail

WORK="${1:-/tmp/s2-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
FNSIG="public.admin_upsert_supplier(uuid,text,boolean,text,text,text)"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

q() { psql "$URL" -tAX -c "$1" 2>&1; }

# ── 身分閘(對齊 s1a-verify:marker + data_directory + db 名三重)────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下 —— 這不是本 harness 的拋棄式庫;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }

# ── 判定原語 ────────────────────────────────────────────────
# case_ok:整段跑在 BEGIN…ROLLBACK 裡,body 內用 DO 區塊自我斷言(不符就 RAISE)。
#   ⇒ 退出碼 0 = 全部斷言通過。零留痕由 ROLLBACK 保證。
case_ok() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "$label"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

# expect_red:期望這段 SQL 紅,且訊息與 SQLSTATE **兩者都要**對得上
#   (只比訊息 ⇒ 同訊息配錯 SQLSTATE 照樣過;s1a-verify 關卡2 #8 的教訓)
expect_red() {
  local label="$1" want_txt="$2" want_state="$3" sql="$4" out rc state
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label — 竟然成功了(期望被擋)"; return; fi
  state="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$sql" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  case "$out" in
    *"$want_txt"*) : ;;
    *) bad "$label — 紅了但訊息不符;實際:$(printf '%s' "$out" | head -1 | cut -c1-140)"; return ;;
  esac
  case "$state" in
    *"$want_state"*) ok "$label(紅在 $want_txt / $want_state)" ;;
    *)               bad "$label — 訊息對但 SQLSTATE 不符:期望 $want_state、實際 $state" ;;
  esac
}

# ── 突變區塊:唯一一份 ────────────────────────────────────────
# 🔴 §0 的三道自我測試與 §C 的每一格**共用這一份**(關卡2 抓:原本 §0 自己抄了一份簡化版
#    ⇒ 證明的是那份複本會發火,不是真正在用的這份;而兩者的檢查順序當時還不一樣)。
# 三道自檢的順序是刻意的,每一道都要有「只有它會發火」的形狀存在:
#   ① anchor 完全沒命中(replace 是 no-op ⇒ md5 不變)—— 必須排在②前面,
#      否則出現次數 0 vs 宣告 1 會先發火,①永遠碰不到 = 死碼。
#   ② 出現次數與宣告不符(anchor 有命中但命中處數不對)。
#      `replace()` 會**全部**換掉 ⇒ 一個 anchor 命中兩處時,那格證到的是「這一對一起承重」。
#   ③ EXECUTE 之後 catalog 定義沒變(例:改到了 CREATE 那行的函式名 ⇒ 建出複本而非替換)。
mut_block() {
  cat <<MUTSQL
DO \$mut\$
DECLARE
  v_oid oid := '$FNSIG'::regprocedure;
  v_def text; v_new text; v_md5 text; v_from text; v_occ integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_def;
  v_md5  := pg_catalog.md5(v_def);
  v_from := current_setting('harness.mut_from');
  v_new  := pg_catalog.replace(v_def, v_from, current_setting('harness.mut_to'));
  IF pg_catalog.md5(v_new) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:anchor 未在函式定義中命中';
  END IF;
  v_occ := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_from, '')))
           / pg_catalog.length(v_from);
  IF v_occ <> current_setting('harness.mut_occ')::integer THEN
    RAISE EXCEPTION '突變 anchor 出現 % 次,與宣告的 % 次不符 —— 這格會變成過量/不足突變',
      v_occ, current_setting('harness.mut_occ');
  END IF;
  EXECUTE v_new;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:catalog 定義沒有改變';
  END IF;
END
\$mut\$;
MUTSQL
}

# 用法:mutate_fn <label> <mfrom> <mto> <setup> <attack> <期望出現次數>
mutate_fn() {
  local label="$1" mfrom="$2" mto="$3" setup="$4" attack="$5" want_occ="$6" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="$mfrom" -v mto="$mto" -v mocc="$want_occ" <<SQL 2>&1
BEGIN;
$setup
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
$attack
ROLLBACK;
SQL
)"
  # 🔴 訊息刻意中性:§C 有兩種格 —— 守門突變(攻擊成立 = 承重)與原子性方向(觀察成立)。
  #    用同一句「= 該守門承重」會讓後者被讀成它不是的東西。
  if [ $? -eq 0 ]; then ok "突變 $label ⇒ 預期觀察成立"
  else bad "突變 $label ⇒ $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

# run_mut_selftest:餵一組會踩到某一道自檢的參數,驗它真的發火。用的是**同一份** mut_block。
run_mut_selftest() {
  local label="$1" mfrom="$2" mto="$3" mocc="$4" want="$5" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="$mfrom" -v mto="$mto" -v mocc="$mocc" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
  case "$out" in
    *"$want"*) ok "自我測試:$label" ;;
    *) bad "$label 沒有發火 — 實際:$(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-140)" ;;
  esac
}

echo "== 0. harness 自我測試 =="
st_ok=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT FROM WHERE;" 2>&1)"; [ $? -ne 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1;" 2>&1)";        [ $? -eq 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1/0;" 2>&1)"
case "$o" in *"division by zero"*) : ;; *) st_ok=0 ;; esac
[ "$st_ok" = "1" ] && ok "自我測試:壞 SQL 判紅、好 SQL 判綠、錯誤訊息取得正確" \
  || { echo "🔴 harness 自我測試失敗 — 後面結果不可信"; exit 1; }

sqlstate_primary="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "SELECT 1/0;" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
[ "$sqlstate_primary" = "22012" ] && ok "自我測試:SQLSTATE 解析路徑可用" \
  || bad "SQLSTATE 解析失效 — 取得 [$sqlstate_primary],整組 SQLSTATE 判定形同虛設"

# 🔴 case_ok 自我測試:證明「body 內 RAISE ⇒ 判 FAIL」。
#    沒有這道的話,一個永遠回 0 的 case_ok 會讓 §B 全綠而什麼都沒測。
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
BEGIN;
DO $t$ BEGIN RAISE EXCEPTION '故意失敗'; END $t$;
ROLLBACK;
SQL
)"; [ $? -ne 0 ] && ok "自我測試:case_ok 的 body 內 RAISE 會被判 FAIL" \
  || bad "case_ok 抓不到 body 內的 RAISE — §B 全部結果不可信"

# 三道突變自檢各自的「只有它會發火」形狀 —— 全部走真正的 mut_block
run_mut_selftest "突變自檢① anchor 失配會當場中止" \
  "ANCHOR_THAT_CANNOT_EXIST_9x7" "X" "1" "anchor 未在函式定義中命中"
run_mut_selftest "突變自檢② 出現次數不符會當場中止(真的 2 次、宣告 1 次)" \
  "INSERT INTO public.admin_audit_log" "X" "1" "出現 2 次,與宣告的 1 次不符"
run_mut_selftest "突變自檢③ catalog 未變會當場中止(建出複本而非替換)" \
  "FUNCTION public.admin_upsert_supplier(" "FUNCTION public.admin_upsert_supplier_selftest_clone(" "1" \
  "catalog 定義沒有改變"

echo "== A. 結構與 ACL(獨立重查,不倚賴 migration 檔內的 DO 區塊)=="
[ "$(q "SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('$FNSIG')")" = "1" ] \
  && ok "函式存在且簽章可解析" || { bad "函式不存在 — 後面全部無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }
[ "$(q "SELECT prosecdef FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "SECURITY DEFINER" || bad "不是 SECURITY DEFINER ⇒ 以呼叫者身分跑 ⇒ service_role 無寫入權、整支形同虛設"
[ "$(q "SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "search_path=public, pg_temp" ] \
  && ok "search_path 釘死為 public, pg_temp(pg_temp 在最後 ⇒ 暫存物件蓋不掉 public)" \
  || bad "proconfig 不符 — 實為 $(q "SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid='$FNSIG'::regprocedure")"
[ "$(q "SELECT pg_get_function_identity_arguments('$FNSIG'::regprocedure)")" = "p_supplier_id uuid, p_label text, p_is_active boolean, p_note text, p_actor text, p_request_id text" ] \
  && ok "參數簽章逐字相符(含參數名)" \
  || bad "參數簽章不符 — 實為 $(q "SELECT pg_get_function_identity_arguments('$FNSIG'::regprocedure)")"
[ "$(q "SELECT prorettype::regtype::text FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "text" ] \
  && ok "回傳型別 text(固定碼)" || bad "回傳型別不符"
# 🔴 併發序列化的結構面(關卡2 抓:拿掉 FOR UPDATE 後原本 66 條全綠)。
#    這是**文字層**斷言 —— 它只證明那個字還在,證不到併發行為;行為測試見 §D。
[ "$(q "SELECT position('FOR UPDATE' in prosrc) > 0 FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "更新路徑仍有 FOR UPDATE(文字層;拿掉它現有行為測試一條都不會紅)" || bad "FOR UPDATE 不見了"

# 🔴 proacl IS NULL = 預設 EXECUTE TO PUBLIC。在那個狀態下攤平比對會是 '<無>',
#    一不小心就被讀成「乾淨」⇒ 必須先單獨擋掉這個假綠(對齊 S1a 的 relacl IS NOT NULL)。
[ "$(q "SELECT proacl IS NOT NULL FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "proacl 非 NULL(否則整組函式 ACL 斷言是假綠)" || bad "proacl 為 NULL = EXECUTE TO PUBLIC 預設"
FN_ACL_SQL="SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE pr.oid='$FNSIG'::regprocedure AND a.grantee <> pr.proowner) x"
[ "$(q "$FN_ACL_SQL")" = "service_role:EXECUTE:false" ] \
  && ok "函式 ACL 攤平:非 owner 授權恰為 service_role:EXECUTE:false(含 is_grantable ⇒ 不可轉授)" \
  || bad "函式 ACL 不符 — 實為 $(q "$FN_ACL_SQL")"
# 🔴 更正(S2 R1 實測):PUBLIC **會**出現在上面的角色名比對裡 —— pg_get_userbyid(0) 回
#    'unknown (OID=0)' ⇒ 上一條本來就會紅。這條是縱深第二層。
[ "$(q "SELECT count(*) FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE pr.oid='$FNSIG'::regprocedure AND a.grantee=0")" = "0" ] \
  && ok "PUBLIC 零 EXECUTE(grantee=0 單獨查 = 縱深第二層)" || bad "PUBLIC 仍可 EXECUTE"
# 🔴 owner 是誰(S2 R1 抓):上面攤平時把 owner 那列排掉了 ⇒ 它成為唯一沒被釘住的欄位,
#    而 SECURITY DEFINER 的全部安全語意就是「以 owner 身分跑」。
[ "$(q "SELECT (SELECT proowner FROM pg_proc WHERE oid='$FNSIG'::regprocedure) = (SELECT relowner FROM pg_class WHERE oid='public.suppliers'::regclass)")" = "t" ] \
  && ok "函式 owner 與 suppliers 表 owner 相同(= SECURITY DEFINER 跑起來真的有寫表的權)" \
  || bad "函式 owner 與表 owner 不同 — 函式=$(q "SELECT proowner::regrole::text FROM pg_proc WHERE oid='$FNSIG'::regprocedure") 表=$(q "SELECT relowner::regrole::text FROM pg_class WHERE oid='public.suppliers'::regclass")"
# 🔴 owner 也必須寫得進稽核表(關卡2 抓):只數欄位在不在的話,audit 表 owner 漂移會在
#    apply 時全綠、上線第一次呼叫才 42501。
[ "$(q "SELECT has_table_privilege((SELECT proowner FROM pg_proc WHERE oid='$FNSIG'::regprocedure),'public.admin_audit_log'::regclass,'INSERT')")" = "t" ] \
  && ok "函式 owner 對 admin_audit_log 有 INSERT(稽核寫得進去)" || bad "函式 owner 對 admin_audit_log 無 INSERT ⇒ 上線即 42501"

# 🔴 本片的安全論證整個掛在「suppliers 對 service_role 只有 SELECT」上。
TBL_ACL_SQL="SELECT coalesce(string_agg(g||':'||p||':'||gr, ', ' ORDER BY g, p),'<無>') FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.suppliers'::regclass AND a.grantee <> c.relowner) x"
[ "$(q "$TBL_ACL_SQL")" = "service_role:SELECT:false" ] \
  && ok "suppliers 表級 ACL 未被本片放寬(仍恰為 service_role:SELECT:false)" \
  || bad "suppliers 表級 ACL 已被放寬 — 實為 $(q "$TBL_ACL_SQL")"
# 🔴🔴 欄級 ACL(關卡2 抓到的真洞、主對話親驗成立):`relacl` **只放表級授權** ⇒
#    做一次 `GRANT UPDATE (is_active) ON suppliers TO service_role`,上面那條攤平**完全看不到**
#    (實測仍回 service_role:SELECT:false),而 service_role 從此可直接停用供應商、零稽核。
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL")" = "0" ] \
  && ok "suppliers 零欄級 ACL(表級收斂擋不住欄級後門,這條才擋得住)" || bad "有欄位帶欄級 ACL = 繞過 RPC 的後門"

[ "$(q "SELECT count(*) FROM public.suppliers")" = "26" ] \
  && ok "基準:seed 26 家在位(§B 的相對差額都以此為準)" || bad "seed 基準不是 26 列,後面的差額斷言不可信"

# §C 收尾要比對的還原基準(在任何突變之前取)
FNDEF_MD5_BEFORE="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ -n "$FNDEF_MD5_BEFORE" ] && ok "已取得函式定義 md5 基準(§C 收尾用它證明突變確實被還原)" \
  || bad "取不到函式定義 md5,§C 的還原檢查會失去意義"
# 🔴 稽核表列數基準(S2 R1 抓):§B-atomic 是全 harness 唯一刻意不包交易的幾發,
#    而收尾原本只查 suppliers 列數 ⇒ 稽核表的零留痕是「這次剛好對」而不是有守門。
AUDIT_N_BEFORE="$(q "SELECT count(*) FROM public.admin_audit_log")"
[ -n "$AUDIT_N_BEFORE" ] && ok "已取得 admin_audit_log 列數基準($AUDIT_N_BEFORE 列;收尾要比對回來)" \
  || bad "取不到 admin_audit_log 列數基準"

echo "== B. 行為(每案跑在 BEGIN…ROLLBACK 內)=="

case_ok "B1 新增 happy ⇒ CREATED + suppliers +1 + audit 恰 +1 且欄位逐個對" '
DO $t$
DECLARE v_res text; v_id uuid; v_a public.admin_audit_log%ROWTYPE; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ 測試供應商$x$, NULL, $x$新增測試$x$, $x$harness$x$, $x$req-b1$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$預期 CREATED,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.suppliers) <> 27 THEN RAISE EXCEPTION $x$suppliers 沒有 +1$x$; END IF;
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$ZZ 測試供應商$x$;
  IF (SELECT is_active FROM public.suppliers WHERE id = v_id) IS NOT TRUE THEN
    RAISE EXCEPTION $x$新增的供應商預設應為啟用$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n + 1 THEN
    RAISE EXCEPTION $x$audit 不是恰 +1 列$x$; END IF;
  -- 🔴 用 request_id 取列,不用「ORDER BY created_at DESC LIMIT 1」:created_at 的 DEFAULT 是
  --    now(),交易內恆定 ⇒ 同交易寫的多列 created_at 完全相同,再用隨機 uuid 當第二排序鍵
  --    等於隨機挑一列。同交易多次呼叫時那種寫法會靜默挑錯列。
  SELECT * INTO v_a FROM public.admin_audit_log WHERE request_id = $x$req-b1$x$;
  IF v_a.action <> $x$supplier.create$x$ THEN RAISE EXCEPTION $x$action 錯:%$x$, v_a.action; END IF;
  IF v_a.target <> $x$supplier:$x$ || v_id::text THEN RAISE EXCEPTION $x$target 錯:%$x$, v_a.target; END IF;
  IF v_a.before IS NOT NULL THEN RAISE EXCEPTION $x$新增的 before 應為 NULL$x$; END IF;
  IF v_a.after->>$x$label$x$ <> $x$ZZ 測試供應商$x$ THEN RAISE EXCEPTION $x$after.label 錯$x$; END IF;
  IF (v_a.after->>$x$is_active$x$)::boolean IS NOT TRUE THEN RAISE EXCEPTION $x$after.is_active 錯$x$; END IF;
  IF v_a.actor <> $x$harness$x$ OR v_a.request_id <> $x$req-b1$x$ OR v_a.source_app <> $x$admin$x$
     OR v_a.reason <> $x$新增測試$x$ THEN RAISE EXCEPTION $x$稽核欄位不符$x$; END IF;
  -- 稽核事件時間來自 DB 的交易時鐘(函式沒有塞自己的值)。
  -- 🔴 判別力界線(關卡2 抓):這條擋得住「塞常數 / 塞 clock_timestamp」,
  --    擋不住「顯式寫 created_at = transaction_timestamp()」—— 那種寫法值一樣。見 §D。
  IF v_a.created_at <> transaction_timestamp() THEN
    RAISE EXCEPTION $x$稽核 created_at 不是 DB 的交易時鐘(實 %)$x$, v_a.created_at; END IF;
END $t$;'

case_ok "B2 新增撞名 ⇒ DUPLICATE_LABEL(不是例外)+ 零寫入 + 交易仍可用" '
DO $t$
DECLARE v_res text; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(NULL, $x$AKOSO$x$, NULL, NULL, $x$harness$x$, $x$req-b2$x$);
  IF v_res <> $x$DUPLICATE_LABEL$x$ THEN RAISE EXCEPTION $x$預期 DUPLICATE_LABEL,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.suppliers) <> 26 THEN RAISE EXCEPTION $x$suppliers 竟然變動$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n THEN RAISE EXCEPTION $x$撞名不該寫稽核$x$; END IF;
END $t$;
-- 交易仍可用(plpgsql 例外處理只回滾子交易):撞名之後照樣能成功新增
DO $t$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ撞名後$x$, NULL, NULL, $x$harness$x$, $x$req-b2b$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$撞名後交易不可用,實 %$x$, v_res; END IF;
END $t$;'

case_ok "B3 改名 ⇒ UPDATED + id/created_at 不動 + updated_at 被推進 + 稽核八欄逐個對" '
DO $t$
DECLARE v_res text; v_id uuid; v_c timestamptz; v_u timestamptz; v_a public.admin_audit_log%ROWTYPE; v_n bigint;
BEGIN
  -- 🔴 判準是「前後值有沒有變」,不是「updated_at > created_at」——後者假設這列從未被改過,
  --    任何前面的動作碰過它就會靜默誤判(S1a harness 實際踩過)。
  --    也不能先把 updated_at 回填到過去:touch trigger 會在同一句 UPDATE 裡把它蓋成 now()。
  SELECT id, created_at, updated_at INTO v_id, v_c, v_u FROM public.suppliers WHERE label = $x$AKOSO$x$;
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(v_id, $x$AKOSO 改名後$x$, NULL, NULL, $x$harness$x$, $x$req-b3$x$);
  IF v_res <> $x$UPDATED$x$ THEN RAISE EXCEPTION $x$預期 UPDATED,實 %$x$, v_res; END IF;
  IF (SELECT label FROM public.suppliers WHERE id = v_id) <> $x$AKOSO 改名後$x$ THEN
    RAISE EXCEPTION $x$label 沒有真的改掉$x$; END IF;
  IF (SELECT created_at FROM public.suppliers WHERE id = v_id) <> v_c THEN
    RAISE EXCEPTION $x$created_at 被動到 = 違反「不得寫時間欄」$x$; END IF;
  IF (SELECT count(*) FROM public.suppliers WHERE id = v_id) <> 1 THEN
    RAISE EXCEPTION $x$id 被改掉了$x$; END IF;
  IF (SELECT updated_at FROM public.suppliers WHERE id = v_id) <= v_u THEN
    RAISE EXCEPTION $x$updated_at 沒被 trigger 推進$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n + 1 THEN RAISE EXCEPTION $x$audit 不是恰 +1$x$; END IF;
  SELECT * INTO v_a FROM public.admin_audit_log WHERE request_id = $x$req-b3$x$;
  -- 🔴 更新分支的稽核欄位原本只驗了 action 與 before/after(關卡2 抓)⇒ 把更新分支寫成
  --    錯 actor 或 source_app=quote 仍會全綠。這裡與 B1 一樣逐欄驗。
  IF v_a.action <> $x$supplier.update$x$ THEN RAISE EXCEPTION $x$action 錯:%$x$, v_a.action; END IF;
  IF v_a.target <> $x$supplier:$x$ || v_id::text THEN RAISE EXCEPTION $x$target 錯:%$x$, v_a.target; END IF;
  IF v_a.actor <> $x$harness$x$ THEN RAISE EXCEPTION $x$actor 錯:%$x$, v_a.actor; END IF;
  IF v_a.source_app <> $x$admin$x$ THEN RAISE EXCEPTION $x$source_app 錯:%$x$, v_a.source_app; END IF;
  IF v_a.created_at <> transaction_timestamp() THEN RAISE EXCEPTION $x$稽核 created_at 錯$x$; END IF;
  IF v_a.before->>$x$label$x$ <> $x$AKOSO$x$ OR v_a.after->>$x$label$x$ <> $x$AKOSO 改名後$x$ THEN
    RAISE EXCEPTION $x$before/after label 不對稱$x$; END IF;
  IF (v_a.before->>$x$is_active$x$)::boolean IS NOT TRUE
     OR (v_a.after->>$x$is_active$x$)::boolean IS NOT TRUE THEN
    RAISE EXCEPTION $x$只改名時 is_active 應前後皆 true$x$; END IF;
  IF v_a.reason IS NOT NULL THEN RAISE EXCEPTION $x$沒給備註時 reason 應為 NULL$x$; END IF;
END $t$;'

case_ok "B4 停用 ⇒ UPDATED + is_active 真的變 false + label 不動 + 可再啟用" '
DO $t$
DECLARE v_res text; v_id uuid; v_n bigint;
BEGIN
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(v_id, NULL, false, $x$不再往來$x$, $x$harness$x$, $x$req-b4$x$);
  IF v_res <> $x$UPDATED$x$ THEN RAISE EXCEPTION $x$預期 UPDATED,實 %$x$, v_res; END IF;
  IF (SELECT is_active FROM public.suppliers WHERE id = v_id) IS NOT FALSE THEN
    RAISE EXCEPTION $x$is_active 沒有變成 false$x$; END IF;
  IF (SELECT label FROM public.suppliers WHERE id = v_id) <> $x$AKOSO$x$ THEN
    RAISE EXCEPTION $x$只切停用卻把 label 改掉了$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n + 1 THEN RAISE EXCEPTION $x$audit 不是恰 +1$x$; END IF;
  IF (SELECT (after->>$x$is_active$x$)::boolean FROM public.admin_audit_log WHERE request_id = $x$req-b4$x$)
     IS NOT FALSE THEN RAISE EXCEPTION $x$audit after.is_active 應為 false$x$; END IF;
  v_res := public.admin_upsert_supplier(v_id, NULL, true, NULL, $x$harness$x$, $x$req-b4b$x$);
  IF v_res <> $x$UPDATED$x$ THEN RAISE EXCEPTION $x$重新啟用預期 UPDATED,實 %$x$, v_res; END IF;
  IF (SELECT is_active FROM public.suppliers WHERE id = v_id) IS NOT TRUE THEN
    RAISE EXCEPTION $x$重新啟用沒生效$x$; END IF;
END $t$;'

case_ok "B5 同值 ⇒ NO_CHANGE + 零寫入零稽核(updated_at 不動 = 真的沒 UPDATE)" '
DO $t$
DECLARE v_res text; v_id uuid; v_u timestamptz; v_n bigint;
BEGIN
  SELECT id, updated_at INTO v_id, v_u FROM public.suppliers WHERE label = $x$AKOSO$x$;
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(v_id, $x$AKOSO$x$, true, $x$應該不寫$x$, $x$harness$x$, $x$req-b5$x$);
  IF v_res <> $x$NO_CHANGE$x$ THEN RAISE EXCEPTION $x$預期 NO_CHANGE,實 %$x$, v_res; END IF;
  IF (SELECT updated_at FROM public.suppliers WHERE id = v_id) <> v_u THEN
    RAISE EXCEPTION $x$NO_CHANGE 竟然動了 updated_at = 其實有跑 UPDATE$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n THEN
    RAISE EXCEPTION $x$NO_CHANGE 不該產生稽核噪音列$x$; END IF;
END $t$;'

case_ok "B6 查無 ⇒ NOT_FOUND + 零稽核" '
DO $t$
DECLARE v_res text; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier($x$00000000-0000-0000-0000-000000000000$x$::uuid,
             $x$隨便$x$, NULL, NULL, $x$harness$x$, $x$req-b6$x$);
  IF v_res <> $x$NOT_FOUND$x$ THEN RAISE EXCEPTION $x$預期 NOT_FOUND,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n THEN RAISE EXCEPTION $x$查無不該寫稽核$x$; END IF;
END $t$;'

case_ok "B7 改名撞既有名 ⇒ DUPLICATE_LABEL + 原名不動 + 零稽核" '
DO $t$
DECLARE v_res text; v_id uuid; v_n bigint;
BEGIN
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(v_id, $x$PROTI$x$, NULL, NULL, $x$harness$x$, $x$req-b7$x$);
  IF v_res <> $x$DUPLICATE_LABEL$x$ THEN RAISE EXCEPTION $x$預期 DUPLICATE_LABEL,實 %$x$, v_res; END IF;
  IF (SELECT label FROM public.suppliers WHERE id = v_id) <> $x$AKOSO$x$ THEN
    RAISE EXCEPTION $x$撞名失敗卻把原名改掉了$x$; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n THEN RAISE EXCEPTION $x$撞名不該寫稽核$x$; END IF;
END $t$;'

case_ok "B8 label 前後空白被剝掉(存進去的是乾淨字串)" '
DO $t$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$   ZZ帶空白   $x$, NULL, NULL, $x$harness$x$, $x$req-b8$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$預期 CREATED,實 %$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE label = $x$ZZ帶空白$x$) THEN
    RAISE EXCEPTION $x$前後空白沒被剝掉$x$; END IF;
END $t$;'

case_ok "B9 尾隨 tab / NBSP / 全形空白 / 零寬 / BOM 都被剝到與既有同名 ⇒ DUPLICATE_LABEL" '
DO $t$
DECLARE v_res text; v_ch text;
BEGIN
  -- 🔴 用 chr() 取字元:E$$..$$ 與 U&$$..$$ 這兩種前綴只能配單引號字串,
  --    配 dollar-quote 是語法錯誤(本片實測踩到)。chr() 在 UTF8 庫下回的就是那個碼位。
  --    tab(9)/ NBSP(160)/ 全形空白(12288)/ ZWSP(8203)/ BOM(65279)
  FOREACH v_ch IN ARRAY ARRAY[chr(9), chr(160), chr(12288), chr(8203), chr(65279)] LOOP
    v_res := public.admin_upsert_supplier(NULL, $x$AKOSO$x$ || v_ch, NULL, NULL, $x$harness$x$, $x$req-b9$x$);
    IF v_res <> $x$DUPLICATE_LABEL$x$ THEN
      RAISE EXCEPTION $x$尾隨字元 U+% 沒被剝掉,結果 %$x$, upper(to_hex(ascii(v_ch))), v_res; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.suppliers) <> 26 THEN RAISE EXCEPTION $x$竟然多出了近似重複的供應商$x$; END IF;
END $t$;'

case_ok "B10 備註非必填:不給 / 給純空白 都成立,且 reason 記 NULL" '
DO $t$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ無備註$x$, NULL, NULL, $x$harness$x$, $x$req-b10$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$不給備註應成立,實 %$x$, v_res; END IF;
  IF (SELECT reason FROM public.admin_audit_log WHERE request_id = $x$req-b10$x$) IS NOT NULL THEN
    RAISE EXCEPTION $x$沒給備註時 reason 應為 NULL$x$; END IF;
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ空白備註$x$, NULL, chr(12288), $x$harness$x$, $x$req-b10b$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$純空白備註應等同沒給,實 %$x$, v_res; END IF;
  IF (SELECT reason FROM public.admin_audit_log WHERE request_id = $x$req-b10b$x$) IS NOT NULL THEN
    RAISE EXCEPTION $x$純空白備註應收斂成 NULL$x$; END IF;
END $t$;'

case_ok "B11 service_role 真身分:RPC 走得通(= 唯一寫入路真的可用)" '
SET LOCAL ROLE service_role;
DO $t$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ服務角色$x$, NULL, NULL, $x$harness$x$, $x$req-b11$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$service_role 呼叫 RPC 預期 CREATED,實 %$x$, v_res; END IF;
END $t$;
SET LOCAL ROLE NONE;
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                  WHERE request_id = $x$req-b11$x$ AND action = $x$supplier.create$x$) THEN
    RAISE EXCEPTION $x$service_role 路徑沒有留下稽核$x$; END IF;
END $t$;'

case_ok "B12 actor / request_id 寫進稽核前會被剝空白(否則同一個人會被拆成兩個稽核鍵)" '
DO $t$
DECLARE v_res text; v_a public.admin_audit_log%ROWTYPE;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ剝空白$x$, NULL, NULL, $x$  alice  $x$, $x$  req-trim  $x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$預期 CREATED,實 %$x$, v_res; END IF;
  SELECT * INTO v_a FROM public.admin_audit_log WHERE request_id = $x$req-trim$x$;
  IF v_a IS NULL THEN RAISE EXCEPTION $x$request_id 沒被剝空白(用剝過的值找不到那一列)$x$; END IF;
  IF v_a.actor <> $x$alice$x$ THEN RAISE EXCEPTION $x$actor 沒被剝空白,實 [%]$x$, v_a.actor; END IF;
END $t$;'

case_ok "B12b 新增時可直接建成停用 + 同一呼叫改名與停用可並行(檔頭宣稱「兩者可同時給」的合約面)" '
DO $t$
DECLARE v_res text; v_id uuid;
BEGIN
  -- R3 抓:migration 檔頭明文宣稱這兩件事,但 §B 一格都沒有 ⇒ 合約沒被釘住
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ建立即停用$x$, false, NULL, $x$harness$x$, $x$req-b12b1$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$建立即停用預期 CREATED,實 %$x$, v_res; END IF;
  IF (SELECT is_active FROM public.suppliers WHERE label = $x$ZZ建立即停用$x$) IS NOT FALSE THEN
    RAISE EXCEPTION $x$新增時給 false 卻建成啟用的$x$; END IF;
  IF (SELECT (after->>$x$is_active$x$)::boolean FROM public.admin_audit_log WHERE request_id = $x$req-b12b1$x$)
     IS NOT FALSE THEN RAISE EXCEPTION $x$稽核 after.is_active 應為 false$x$; END IF;

  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  v_res := public.admin_upsert_supplier(v_id, $x$AKOSO 併改$x$, false, NULL, $x$harness$x$, $x$req-b12b2$x$);
  IF v_res <> $x$UPDATED$x$ THEN RAISE EXCEPTION $x$改名+停用同時預期 UPDATED,實 %$x$, v_res; END IF;
  IF (SELECT label FROM public.suppliers WHERE id = v_id) <> $x$AKOSO 併改$x$
     OR (SELECT is_active FROM public.suppliers WHERE id = v_id) IS NOT FALSE THEN
    RAISE EXCEPTION $x$兩欄沒有一起改掉$x$; END IF;
  IF (SELECT after->>$x$label$x$ FROM public.admin_audit_log WHERE request_id = $x$req-b12b2$x$) <> $x$AKOSO 併改$x$
     OR (SELECT (after->>$x$is_active$x$)::boolean FROM public.admin_audit_log WHERE request_id = $x$req-b12b2$x$)
        IS NOT FALSE THEN RAISE EXCEPTION $x$稽核 after 沒有同時反映兩欄$x$; END IF;
END $t$;'

case_ok "B12c 🔴 id 掉成 NULL 的改名會靜默降級成新增(R3 抓的合約債,這裡把它釘成已知行為)" '
DO $t$
DECLARE v_res text;
BEGIN
  -- 這格**不是**在測「有守門」——是在把「沒有守門」這件事釘住,免得日後有人以為它被擋了。
  -- 真正的防線在 S3b:改名/停用 action 必須斷言回傳碼 ∈ {UPDATED, NO_CHANGE}。
  v_res := public.admin_upsert_supplier(NULL, $x$AKOSO 改名後$x$, NULL, NULL, $x$harness$x$, $x$req-b12c$x$);
  IF v_res <> $x$CREATED$x$ THEN
    RAISE EXCEPTION $x$行為變了:id=NULL 的改名現在回 % —— 若已加守門請同步更新 plan §6 的契約債$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.suppliers) <> 27 THEN RAISE EXCEPTION $x$應多出一家(垃圾列)$x$; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE label = $x$AKOSO$x$) THEN
    RAISE EXCEPTION $x$原本那家應該原封不動$x$; END IF;
  IF (SELECT action FROM public.admin_audit_log WHERE request_id = $x$req-b12c$x$) <> $x$supplier.create$x$ THEN
    RAISE EXCEPTION $x$稽核應記成 create(這正是 S3b 該察覺的訊號)$x$; END IF;
END $t$;'

echo "-- B13/B14 拒收矩陣(每條都要紅在自己那句訊息)--"
expect_red "B13a 缺 actor"            "缺 actor"        "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,NULL,'r')"
expect_red "B13b actor 純 Unicode 空白" "缺 actor"      "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,U&'\00A0','r')"
expect_red "B13c 缺 request_id"        "缺 request_id"  "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,'h',NULL)"
expect_red "B13d 新增沒給 label"       "新增時必須給 label" "P0001" "SELECT public.admin_upsert_supplier(NULL,NULL,NULL,NULL,'h','r')"
expect_red "B13e label 純空白"         "供應商名稱必填"   "P0001" "SELECT public.admin_upsert_supplier(NULL,'   ',NULL,NULL,'h','r')"
expect_red "B13f label 純零寬字元"     "供應商名稱必填"   "P0001" "SELECT public.admin_upsert_supplier(NULL,U&'\200B',NULL,NULL,'h','r')"
expect_red "B13g label 超過 100 字"    "供應商名稱過長"   "P0001" "SELECT public.admin_upsert_supplier(NULL,repeat('A',101),NULL,NULL,'h','r')"
expect_red "B13h label 內含控制字元"   "含控制字元"       "P0001" "SELECT public.admin_upsert_supplier(NULL,E'AK\tOSO',NULL,NULL,'h','r')"
expect_red "B13i label 內含換行"       "含控制字元"       "P0001" "SELECT public.admin_upsert_supplier(NULL,E'AK\nOSO',NULL,NULL,'h','r')"
expect_red "B13j 備註超過 200 字"      "備註非法"         "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,repeat('B',201),'h','r')"
expect_red "B13k 備註含控制字元"       "備註非法"         "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,E'a\tb','h','r')"
expect_red "B13l actor 超過 200 字"    "actor 非法"       "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,repeat('C',201),'r')"
expect_red "B13m actor 含控制字元"     "actor 非法"       "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,E'a\tb','r')"
expect_red "B13n request_id 超過 200 字" "request_id 非法" "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,'h',repeat('D',201))"
expect_red "B13o request_id 含控制字元"  "request_id 非法" "P0001" "SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,'h',E'a\nb')"
expect_red "B14 空 patch(有 id 但兩欄皆 NULL)" "沒有要變更的欄位" "P0001" \
  "SELECT public.admin_upsert_supplier((SELECT id FROM public.suppliers WHERE label='AKOSO'),NULL,NULL,NULL,'h','r')"
expect_red "B15 anon 不得 EXECUTE(真 SET ROLE)" "permission denied" "42501" \
  "SET LOCAL ROLE anon; SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,'h','r')"
expect_red "B16 authenticated 不得 EXECUTE(真 SET ROLE)" "permission denied" "42501" \
  "SET LOCAL ROLE authenticated; SELECT public.admin_upsert_supplier(NULL,'ZZ',NULL,NULL,'h','r')"
expect_red "B17 service_role 直接 INSERT 仍被擋(RPC 之外沒有第二條路)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; INSERT INTO public.suppliers(label) VALUES ('繞過RPC')"
expect_red "B18 service_role 直接 UPDATE 仍被擋" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; UPDATE public.suppliers SET label='繞過RPC' WHERE label='AKOSO'"
expect_red "B19 service_role 直接改 is_active 也被擋(欄級後門的行為面)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; UPDATE public.suppliers SET is_active=false WHERE label='AKOSO'"

echo "-- B-atomic 稽核原子性(plan §5-12):故意觀察交易收掉之後的狀態 --"
# 🔴 這一案不能包在 case_ok 裡 —— 它要證明的正是「交易收掉之後兩邊一起消失」。
# 🔴 必須檢查 psql 退出碼(關卡2 抓):RPC 若當場失敗,連線關閉一樣會 rollback,
#    事後查仍是 0/0 ⇒ 沒有這道檢查就會把「根本沒寫成功」誤判成「原子性通過」。
#    交易內先斷言「真的寫進去了」,才有資格去看事後有沒有消失。
psql "$URL" -v ON_ERROR_STOP=1 -q -tAX <<'SQL' >/dev/null 2>&1
BEGIN;
DO $t$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, 'ZZ原子性', NULL, NULL, 'harness-atomic', 'req-atomic');
  IF v_res <> 'CREATED' THEN RAISE EXCEPTION 'B-atomic 前提不成立:預期 CREATED,實 %', v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE label = 'ZZ原子性') THEN
    RAISE EXCEPTION 'B-atomic 前提不成立:交易內看不到那一列'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = 'req-atomic') THEN
    RAISE EXCEPTION 'B-atomic 前提不成立:交易內看不到稽核列'; END IF;
END $t$;
ROLLBACK;
SQL
atomic_rc=$?
n_sup="$(q "SELECT count(*) FROM public.suppliers WHERE label='ZZ原子性'")"
n_aud="$(q "SELECT count(*) FROM public.admin_audit_log WHERE request_id='req-atomic'")"
if [ "$atomic_rc" -ne 0 ]; then
  bad "B-atomic 前提不成立(交易內根本沒寫成功)⇒ 事後的 0/0 沒有意義"
elif [ "$n_sup" = "0" ] && [ "$n_aud" = "0" ]; then
  ok "B-atomic 交易內確認兩邊都寫進去了、回滾後**一起**消失(零留痕)"
else
  bad "B-atomic 回滾後仍有殘留:suppliers=$n_sup audit=$n_aud"
fi
# 反面:寫入失敗的那一發不得留下孤兒稽核列
psql "$URL" -v ON_ERROR_STOP=0 -q -tAX -c \
  "SELECT public.admin_upsert_supplier(NULL,'AKOSO',NULL,NULL,'harness-atomic','req-atomic-dup')" >/dev/null 2>&1
[ "$(q "SELECT count(*) FROM public.admin_audit_log WHERE request_id='req-atomic-dup'")" = "0" ] \
  && ok "B-atomic 撞名(寫入未發生)⇒ 零稽核列 = 不會有「稽核說改了、其實沒改」的孤兒" \
  || bad "撞名卻留下了稽核列"

echo "== C. 突變證明(拿掉守門 ⇒ 對應攻擊必須成立)=="

mutate_fn "label_trim(Unicode 空白剝除)" \
  'pg_catalog.btrim(p_label, v_ws)' 'p_label' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  -- 尾隨 NBSP(chr(160)):不是控制字元(躲得過 cntrl 那道),而單參數 btrim 也剝不掉
  --  ⇒ 只有本片的 trim 擋得住,是這條守門的專屬向量
  v_res := public.admin_upsert_supplier(NULL, $x$AKOSO$x$ || chr(160), NULL, NULL, $x$h$x$, $x$mut-trim$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%),這條守門可能是死碼或被別道蘊含$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.suppliers) <> 27 THEN
    RAISE EXCEPTION $x$突變後沒有真的多出一家近似重複的供應商$x$; END IF;
END $atk$;' 1

mutate_fn "label_cntrl(拒控制字元)" \
  "v_label ~ '[[:cntrl:]]'" 'false' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$AK$x$ || chr(9) || $x$OSO$x$, NULL, NULL, $x$h$x$, $x$mut-cntrl$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE label ~ $x$[[:cntrl:]]$x$) THEN
    RAISE EXCEPTION $x$突變後沒有真的寫進含控制字元的名稱$x$; END IF;
END $atk$;' 1

mutate_fn "label_max(長度上限)" \
  'pg_catalog.char_length(v_label) > v_label_max' 'false' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, repeat($x$A$x$, 101), NULL, NULL, $x$h$x$, $x$mut-max$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF (SELECT max(char_length(label)) FROM public.suppliers) <> 101 THEN
    RAISE EXCEPTION $x$突變後沒有真的寫進超長名稱$x$; END IF;
END $atk$;' 1

# 🔴 「actor 必填 / request_id 必填」那兩道**沒有**突變格 —— 見 §D:剝空白之後它們被
#    admin_audit_log 自己的 NOT NULL / CHECK 嚴格蘊含,構造不出只紅它們的向量。
#    真正有獨立貢獻的是長度與控制字元那兩道,突變如下。
mutate_fn "actor 長度/控制字元上限" \
  "pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]'" 'false' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ長actor$x$, NULL, NULL, repeat($x$C$x$, 201), $x$mut-actor$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF (SELECT char_length(actor) FROM public.admin_audit_log WHERE request_id = $x$mut-actor$x$) <> 201 THEN
    RAISE EXCEPTION $x$突變後沒有真的寫進超長 actor$x$; END IF;
END $atk$;' 1

mutate_fn "request_id 長度/控制字元上限" \
  "pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]'" 'false' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ長reqid$x$, NULL, NULL, $x$h$x$, repeat($x$D$x$, 201));
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE char_length(request_id) = 201) THEN
    RAISE EXCEPTION $x$突變後沒有真的寫進超長 request_id$x$; END IF;
END $atk$;' 1

# 🔴 actor 與 request_id 的剝空白**各自**要有突變(R3 抓:原本一格叫「actor/request_id 剝空白」
#    但 anchor 只動 v_actor、攻擊也只看 actor ⇒ request_id 那半是格名 overclaim)。
mutate_fn "actor 剝空白" \
  'v_actor := pg_catalog.btrim(p_actor, v_ws);' 'v_actor := p_actor;' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ不剝a$x$, NULL, NULL, $x$  alice  $x$, $x$mut-trim-actor$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF (SELECT actor FROM public.admin_audit_log WHERE request_id = $x$mut-trim-actor$x$) <> $x$  alice  $x$ THEN
    RAISE EXCEPTION $x$突變後 actor 竟然還是被剝過的 ⇒ B12 對 actor 的斷言沒有判別力$x$; END IF;
END $atk$;' 1

mutate_fn "request_id 剝空白" \
  'v_req := pg_catalog.btrim(p_request_id, v_ws);' 'v_req := p_request_id;' '' '
DO $atk$
DECLARE v_res text;
BEGIN
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ不剝r$x$, NULL, NULL, $x$h$x$, $x$  mut-trim-req  $x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$突變後仍被擋(%)$x$, v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$mut-trim-req$x$) THEN
    RAISE EXCEPTION $x$突變後 request_id 竟然還是被剝過的 ⇒ B12 對 request_id 的斷言沒有判別力$x$; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$  mut-trim-req  $x$) THEN
    RAISE EXCEPTION $x$突變後沒有寫進未剝的 request_id$x$; END IF;
END $atk$;' 1

mutate_fn "NO_CHANGE 冪等(零稽核噪音)" \
  "RETURN 'NO_CHANGE';" 'NULL;' '' '
DO $atk$
DECLARE v_res text; v_id uuid; v_n bigint;
BEGIN
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(v_id, $x$AKOSO$x$, true, NULL, $x$h$x$, $x$mut-nochange$x$);
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n + 1 THEN
    RAISE EXCEPTION $x$突變後同值呼叫仍沒產生稽核列 ⇒ B5 的「零稽核」斷言沒有判別力$x$; END IF;
END $atk$;' 1

# 🔴 以下三格的 anchor 各命中 2 處(新增路 + 改名路)⇒ 它們是**成對突變**,
#    證到的是「這一對一起承重」。攻擊刻意**兩條路都走一次**(關卡2 抓:原本只走新增路
#    ⇒ 改名路那一份完全沒被觀察到)。
mutate_fn "同交易稽核(把 audit INSERT 導去別張表;新增路 + 改名路都驗)" \
  'INSERT INTO public.admin_audit_log' 'INSERT INTO public.audit_sink' \
  'CREATE TABLE public.audit_sink (LIKE public.admin_audit_log INCLUDING DEFAULTS);' '
DO $atk$
DECLARE v_res text; v_id uuid; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_audit_log;
  v_res := public.admin_upsert_supplier(NULL, $x$ZZ稽核突變$x$, NULL, NULL, $x$h$x$, $x$mut-sink-c$x$);
  IF v_res <> $x$CREATED$x$ THEN RAISE EXCEPTION $x$新增路預期 CREATED,實 %$x$, v_res; END IF;
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  v_res := public.admin_upsert_supplier(v_id, $x$AKOSO 突變改名$x$, NULL, NULL, $x$h$x$, $x$mut-sink-u$x$);
  IF v_res <> $x$UPDATED$x$ THEN RAISE EXCEPTION $x$改名路預期 UPDATED,實 %$x$, v_res; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log) <> v_n THEN
    RAISE EXCEPTION $x$稽核仍寫進 admin_audit_log ⇒ 突變沒生效$x$; END IF;
  IF (SELECT count(*) FROM public.audit_sink) <> 2 THEN
    RAISE EXCEPTION $x$sink 只收到 % 列(應為新增+改名共 2)⇒ 有一條路的 audit 沒被觀察到$x$,
      (SELECT count(*) FROM public.audit_sink); END IF;
END $atk$;' 2

mutate_fn "DUPLICATE_LABEL 收斂(新增路 + 改名路撞名都不冒 23505 給 UI)" \
  'WHEN unique_violation THEN' "WHEN sqlstate 'XX000' THEN" '' '
DO $atk$
DECLARE v_res text; v_id uuid; v_c integer := 0;
BEGIN
  BEGIN
    v_res := public.admin_upsert_supplier(NULL, $x$AKOSO$x$, NULL, NULL, $x$h$x$, $x$mut-dup-c$x$);
    RAISE EXCEPTION $x$新增路突變後撞名竟然沒冒例外(回 %)$x$, v_res;
  EXCEPTION WHEN unique_violation THEN v_c := v_c + 1;
  END;
  SELECT id INTO v_id FROM public.suppliers WHERE label = $x$AKOSO$x$;
  BEGIN
    v_res := public.admin_upsert_supplier(v_id, $x$PROTI$x$, NULL, NULL, $x$h$x$, $x$mut-dup-u$x$);
    RAISE EXCEPTION $x$改名路突變後撞名竟然沒冒例外(回 %)$x$, v_res;
  EXCEPTION WHEN unique_violation THEN v_c := v_c + 1;
  END;
  IF v_c <> 2 THEN RAISE EXCEPTION $x$兩條路只有 % 條被觀察到$x$, v_c; END IF;
END $atk$;' 2

# 🔴 稽核原子性方向二(關卡2 抓:plan §5-12 要的是「RPC 中途失敗 ⇒ 零留痕」,
#    而 B-atomic 只測了「供應商寫入失敗 ⇒ 零稽核」)。
#    構造法 = 把 source_app 的 'admin' 換成違反 CHECK 的值 ⇒ 稽核 INSERT 當場炸,
#    此時供應商列**已經寫進去了** ⇒ 它留不留下來才是「同交易」真正在保證的事。
mutate_fn "原子性方向二:稽核寫入失敗 ⇒ 已寫的供應商列不得留(新增路 + 改名路)" \
  "'admin'" "'bogus'" '' '
DO $atk$
DECLARE v_red integer := 0; v_id uuid; v_before text;
BEGIN
  BEGIN
    PERFORM public.admin_upsert_supplier(NULL, $x$ZZ稽核失敗$x$, NULL, NULL, $x$h$x$, $x$mut-af-c$x$);
  EXCEPTION WHEN check_violation THEN v_red := v_red + 1;
  END;
  IF EXISTS (SELECT 1 FROM public.suppliers WHERE label = $x$ZZ稽核失敗$x$) THEN
    RAISE EXCEPTION $x$新增路:稽核寫入失敗、供應商列卻留下來了 = 原子性破裂$x$; END IF;
  SELECT id, label INTO v_id, v_before FROM public.suppliers WHERE label = $x$AKOSO$x$;
  BEGIN
    PERFORM public.admin_upsert_supplier(v_id, $x$AKOSO 改不掉$x$, NULL, NULL, $x$h$x$, $x$mut-af-u$x$);
  EXCEPTION WHEN check_violation THEN v_red := v_red + 1;
  END;
  IF (SELECT label FROM public.suppliers WHERE id = v_id) <> v_before THEN
    RAISE EXCEPTION $x$改名路:稽核寫入失敗、改名卻留下來了 = 原子性破裂$x$; END IF;
  IF v_red <> 2 THEN RAISE EXCEPTION $x$只有 % 條路的稽核真的失敗了$x$, v_red; END IF;
END $atk$;' 2

# 🔴 稽核原子性方向三(關卡2 抓:我原本宣稱「稽核寫完之後才失敗構造不出來」是**錯的**)。
#    把 audit INSERT 之後的 RETURN 換成 RAISE ⇒ 失敗點確實落在稽核之後。
mutate_fn "原子性方向三:稽核寫完之後才失敗 ⇒ 兩邊一起不留" \
  "RETURN 'CREATED';" "RAISE EXCEPTION 'post-audit-boom';" '' '
DO $atk$
DECLARE v_red boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_upsert_supplier(NULL, $x$ZZ後置失敗$x$, NULL, NULL, $x$h$x$, $x$mut-post$x$);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> $x$post-audit-boom$x$ THEN RAISE; END IF;
    v_red := true;
  END;
  IF NOT v_red THEN RAISE EXCEPTION $x$突變後竟然沒在稽核之後失敗 ⇒ 這格證不到方向三$x$; END IF;
  IF EXISTS (SELECT 1 FROM public.suppliers WHERE label = $x$ZZ後置失敗$x$) THEN
    RAISE EXCEPTION $x$供應商列留下來了 = 原子性破裂$x$; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id = $x$mut-post$x$) THEN
    RAISE EXCEPTION $x$稽核列留下來了 = 原子性破裂$x$; END IF;
END $atk$;' 1

echo "-- 突變後還原檢查 --"
FNDEF_MD5_AFTER="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ -n "$FNDEF_MD5_AFTER" ] && [ "$FNDEF_MD5_AFTER" = "$FNDEF_MD5_BEFORE" ] \
  && ok "突變全部跑完後函式定義 md5 未變(ROLLBACK 確實還原,零留痕)" \
  || bad "函式定義被突變殘留改掉了:before=$FNDEF_MD5_BEFORE after=$FNDEF_MD5_AFTER"
[ "$(q "SELECT count(*) FROM public.suppliers")" = "26" ] \
  && ok "全程結束後 suppliers 仍為 26 列(§B/§C 零留痕)" || bad "suppliers 列數被污染"
[ "$(q "SELECT count(*) FROM public.admin_audit_log")" = "$AUDIT_N_BEFORE" ] \
  && ok "全程結束後 admin_audit_log 仍為 $AUDIT_N_BEFORE 列(§B-atomic 那幾發真的零留痕)" \
  || bad "admin_audit_log 被污染:基準 $AUDIT_N_BEFORE、現在 $(q "SELECT count(*) FROM public.admin_audit_log")"
[ "$(q "SELECT to_regclass('public.audit_sink') IS NULL")" = "t" ] \
  && ok "突變用的 audit_sink 沒有殘留" || bad "audit_sink 殘留在庫裡"
[ "$(q "SELECT to_regprocedure('public.admin_upsert_supplier_selftest_clone(uuid,text,boolean,text,text,text)') IS NULL")" = "t" ] \
  && ok "§0 自檢③ 用的函式複本沒有殘留" || bad "自檢③ 的複本殘留在庫裡"
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL")" = "0" ] \
  && ok "全程結束後 suppliers 仍零欄級 ACL" || bad "欄級 ACL 殘留"

echo
echo "== D. 🔴 只有結構/行為斷言、**沒有**突變證明的項目(不得宣稱已證承重)=="
echo "   · label 必填(v_label = '' 那道):被 S1a 的 suppliers_label_nonempty 嚴格蘊含 ——"
echo "     拿掉它之後空字串照樣紅在 CHECK(23514)⇒ 構造不出只紅它的向量。"
echo "     它的價值是把 23514 收斂成給 UI 看的訊息,**不是**多一層防護。"
echo "   · actor / request_id **必填**那兩道:同理被 admin_audit_log 自己的 NOT NULL 與"
echo "     actor<>'' / request_id<>'' CHECK 嚴格蘊含(剝空白之後空值一定紅在那裡)⇒ 無專屬向量。"
echo "     有獨立貢獻、也真的有突變的是它們的**長度與控制字元上限**那兩道。"
echo "   · SELECT … FOR UPDATE:§A 只有**文字層**斷言(prosrc 裡那個字還在)。"
echo "     🔴 併發行為完全沒測 —— 拿掉 FOR UPDATE,除了那條文字斷言以外一條都不會紅。"
echo "     兩條連線同改一列會讀到相同 before ⇒ lost update + 稽核鏈斷。要真的關掉這個洞"
echo "     需要兩連線 + barrier 的併發 harness(a7bt 那套形狀),本片未做。"
echo "   · 稽核 created_at:斷言的是「值 = 交易時鐘」。它擋得住塞常數或塞 clock_timestamp,"
echo "     **擋不住**函式顯式寫 created_at = transaction_timestamp()(值一樣)⇒ 證不到"
echo "     「INSERT 欄位清單裡沒有 created_at」這件事本身。"
echo "   · 「不得改 id / 不得寫時間欄」:參數簽章(結構)+ created_at 前後相等(行為)。"
echo "     🔴 兩者合起來證的是「這些欄的**值**沒有被改動」,不是「SET 清單裡沒有它們」——"
echo "     無作用的自我賦值(SET id = id)通得過,但那也觀察不到、無危害。"
echo "   · SECURITY DEFINER / search_path / 函式 owner / 回傳型別 / 欄級 ACL 零:皆結構斷言,"
echo "     沒有突變 —— 改掉它們是換一個安全語意,不是「某個攻擊會成功」那種可觀察形狀。"
echo "   · anon / authenticated 的 EXECUTE 拒絕有真 SET ROLE 負測(B15/B16),但沒有突變。"
echo
echo "== 誠實邊界(實測,非推論)=="
echo "   🔴 近似重複**三種形狀都不擋**,防線一律是 S3b 的 typeahead(人眼),不在本片:"
echo "      ① 內部空白:'Eazi  Grip' vs 'Eazi Grip'  ② 大小寫:'akoso' vs 'AKOSO'(實測 CREATED)"
echo "      ③ 標點:'Eazi-Grip' vs 'Eazi Grip'。這是「已知不擋」清單,不是窮舉。"
echo "   🔴 撞到**已停用**的同名供應商也回 DUPLICATE_LABEL,而 listSuppliers 預設不回停用的"
echo "      ⇒ 員工會看到「已存在」卻找不到它 = UI 死路。已登記為 S3b 契約債(plan §6 + migration 檔頭)。"
echo "   🔴 稽核 actor **不是經過驗證的身分** —— apps/admin/src/lib/session/actor.ts:6-7 逐字"
echo "      「以 cookie 承載、內容來自使用者自行選擇……不是登入 / 授權邊界」。本片保證的是"
echo "      「稽核列一定有一個非空 actor 字串」,不是「那個字串是真的操作者」。真身分屬 E8-B。"
echo "   🔴 稽核原子性證了三個方向(供應商寫入失敗 / 稽核寫入失敗 / 稽核之後才失敗)。"
echo "      ~~原本宣稱「稽核寫完之後才失敗構造不出來」~~ 已被關卡2 推翻並補測。"
echo "   🔴🔴 **id 掉成 NULL 的改名會靜默降級成新增**(R3 抓;B12c 已把這個行為釘住)——"
echo "      實測回 CREATED、26→27 家、原本那家原封不動 ⇒ 多一筆**永久垃圾列**(供應商不可刪除)"
echo "      而且沒有人會收到錯誤。這是「一支函式靠參數 NULL 分流三種動作」的固有代價。"
echo "      防線在 S3b:改名/停用 action 必須斷言回傳碼 ∈ {UPDATED, NO_CHANGE}。已登記 plan §6。"
echo "   🔴 owner 路徑不受本 RPC 限制。**不只是「手動下 SQL」**(R3 抓:原字面低估)——"
echo "      pg_cron job 與任何持 owner 憑證的常駐服務都算。本片保證的是【service_role 路徑】唯一。"
echo "   🔴 稽核**不能反過來當「真的有寫入」的證據**(R3 抓):service_role 對 admin_audit_log"
echo "      有 INSERT ⇒ 同一把 service key 可以不碰 suppliers 就寫一列假稽核。本片保證"
echo "      「經由本 RPC 的寫入一定留稽核」,不是「稽核列一定對應一次真寫入」。"
echo "   🔴 RPC 執行期**沒有** lock_timeout(R3 抓):檔頭那個 SET LOCAL 只保護 apply 那一刻;"
echo "      函式本體的 FOR UPDATE 在 runtime 吃角色層 statement_timeout ⇒ 撞上殘留交易會掛住而非快速失敗。"
echo "   🔴 B12 的「剝空白」只涵蓋**空白類**字元;控制字元(如內含 tab/換行)是直接拒收不是剝掉。"
echo "      兩者行為不同,不要把 B12 讀成「任何髒字元都會被清乾淨」。"
echo "   🔴🔴 全部 ACL 與 SET ROLE 結論跑在 scripts/d1-supabase-shim.sql 手造的角色圖上"
echo "      (anon/authenticated/service_role 皆 NOLOGIN、零 membership、**沒有 PostgREST 這一層**)"
echo "      ⇒ 證的是「PG 角色層擋得住」,**不等於**「拿 anon key 打 /rest/v1/rpc/ 擋得住」。"
echo "   🔴 本機 PG17.10 + **C locale** ≠ 正式站 en_US.UTF-8(#305)。本片零排序斷言 ⇒ collation 面不受影響,"
echo "      🔴 但 **\`[[:cntrl:]]\` 這類 POSIX 字元類會隨 lc_ctype 變**(R3 抓:原字面只講 collation、"
echo "      把「不受影響」講得比實際大)⇒ U+0080-U+009F 這段在兩邊的判定可能不同。"
echo "      後果是奇字元擋或不擋的邊界有差,不影響 UNIQUE 與資料正確性,但本片的控制字元結論**不外推正式站**。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] || exit 1
