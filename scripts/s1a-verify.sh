#!/usr/bin/env bash
# S1a 供應商主檔 — 驗收 harness
#
# 用法:bash scripts/s1a-verify.sh [<work-dir>]     預設 /tmp/a5b-work
#
# 三段:A 結構/ACL(獨立重跑,不倚賴 migration 檔內驗收)/ B 行為負測 / C 突變證明。
# 🔴 §0 harness 自我測試在最前面:先證明這支腳本抓得到失敗,否則後面全綠沒有意義。
#
# 🔴 本 harness **不宣稱**「每條守門都有突變證明」——
#    §C 逐條列出「有突變」與「只有結構斷言、無突變」兩類,不含混。(關卡2 #11)

set -uo pipefail

WORK="${1:-/tmp/a5b-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

q() { psql "$URL" -tAX -c "$1" 2>&1; }

# ── 身分閘 ───────────────────────────────────────────────────
# 🔴 marker 只綁資料夾擋不住「同名 marker + URL 指向別的庫」(關卡2 #13)
#    ⇒ 另外綁 DB identity:cluster 必須是本 harness provision 出來的那顆。
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下 —— 這不是本 harness 的拋棄式庫;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }

# ── 判定原語 ────────────────────────────────────────────────
# 🔴 同時比對「錯誤文字」與「SQLSTATE」(關卡2 #8:只比文字 ⇒ 同訊息配錯 SQLSTATE 仍通過)
#    註:`out="$(...)"` 之後的 $? 取的是 command substitution 的退出碼(關卡2 實測確認正確)。
expect_red() {
  local label="$1" want_txt="$2" want_state="$3" sql="$4" out rc state
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label — 竟然成功了(期望被擋)"; return; fi
  state="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$sql" 2>&1 | sed -n 's/^ERROR:.*SQLSTATE:[[:space:]]*\([0-9A-Z]*\).*/\1/p' | head -1)"
  [ -n "$state" ] || state="$(psql "$URL" -tAX <<SQL 2>&1 | tr -d ' \n'
DO \$\$ BEGIN
  BEGIN $sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLSTATE; END;
END \$\$;
SQL
)"
  case "$out" in
    *"$want_txt"*) : ;;
    *) bad "$label — 紅了但訊息不符;實際:$(printf '%s' "$out" | head -1)"; return ;;
  esac
  case "$state" in
    *"$want_state"*) ok "$label(紅在 $want_txt / $want_state)" ;;
    *)               bad "$label — 訊息對但 SQLSTATE 不符:期望 $want_state、實際 $state" ;;
  esac
}
expect_green() {
  local label="$1" sql="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "$sql" 2>&1)"
  if [ $? -eq 0 ]; then ok "$label"; else bad "$label — 應成功卻失敗:$(printf '%s' "$out" | head -1)"; fi
}

echo "== 0. harness 自我測試 =="
# 🔴 逐案獨立判定,不用「FAIL 淨增量」——後者兩個相反的誤判會互相抵銷(關卡2 #9)
st_ok=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT FROM WHERE;" 2>&1)"; [ $? -ne 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1;" 2>&1)";        [ $? -eq 0 ] || st_ok=0
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT 1/0;" 2>&1)"
case "$o" in *"division by zero"*) : ;; *) st_ok=0 ;; esac
[ "$st_ok" = "1" ] && ok "自我測試:壞 SQL 判紅、好 SQL 判綠、錯誤訊息取得正確" \
  || { echo "🔴 harness 自我測試失敗 — 後面結果不可信"; exit 1; }

echo "== A. 結構與 ACL =="
[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers'")" = "5" ] \
  && ok "恰 5 欄" || bad "欄數不符"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND conname IN ('suppliers_label_nonempty','suppliers_label_trimmed','suppliers_label_unique','suppliers_pkey')")" = "4" ] \
  && ok "四個具名約束齊全" || bad "具名約束缺漏"
[ "$(q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND contype IN ('c','u','p') AND conname NOT IN ('suppliers_label_nonempty','suppliers_label_trimmed','suppliers_label_unique','suppliers_pkey')")" = "0" ] \
  && ok "無非預期約束" || bad "出現非預期約束"
[ "$(q "SELECT relrowsecurity FROM pg_class WHERE oid='public.suppliers'::regclass")" = "t" ] && ok "RLS 已啟用" || bad "RLS 未啟用"
[ "$(q "SELECT count(*) FROM pg_policy WHERE polrelid='public.suppliers'::regclass")" = "0" ] && ok "zero-policy" || bad "不該有 policy"
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.suppliers'::regclass AND NOT tgisinternal AND tgenabled='O'")" = "3" ] \
  && ok "三支 trigger 啟用" || bad "trigger 數或啟用態不符"
[ "$(q "SELECT relacl IS NOT NULL FROM pg_class WHERE oid='public.suppliers'::regclass")" = "t" ] \
  && ok "relacl 非 NULL(否則整組 ACL 斷言是假綠)" || bad "relacl 為 NULL"
[ "$(q "SELECT has_table_privilege('service_role','public.suppliers','SELECT')")" = "t" ] && ok "service_role 有 SELECT" || bad "service_role 缺 SELECT"
[ "$(q "SELECT has_table_privilege('service_role','public.suppliers','INSERT') OR has_table_privilege('service_role','public.suppliers','UPDATE') OR has_table_privilege('service_role','public.suppliers','DELETE') OR has_table_privilege('service_role','public.suppliers','TRUNCATE')")" = "f" ] \
  && ok "service_role 只有 SELECT" || bad "service_role 權限過寬"
[ "$(q "SELECT has_table_privilege('anon','public.suppliers','SELECT') OR has_table_privilege('authenticated','public.suppliers','SELECT')")" = "f" ] \
  && ok "client 三角色讀不到" || bad "client 角色能讀"

# 🔴 seed 內容比對,不只列數(關卡2 #6:只驗 26 列 ⇒ 把 AKOSO 換成任意名稱仍通過)
# 🔴 用**集合對稱差**而非排序後字串:排序結果依 collation 而定,手寫一份等於再造一個
#    會漂移的真相(施工中實際踩到 —— 我憑印象把「阿毅物流/陳蔚仁」的位元組序寫反)。
EXPECTED_SEED_SQL="VALUES ('WRS s.r.l'),('Extreme-Components'),('Omnia Racing'),('Webike TW'),('Webike JP'),('Webike EU'),('IMPEX'),('E PLOT'),('WoodCraft'),('阿毅物流'),('安豐達'),('豪元國際'),('老吳精品'),('Gbracing'),('FOWLER'),('RaceBikeBitz'),('PROTI'),('MAPD'),('陳蔚仁'),('RaceSeats'),('MOTOBIKE TH'),('AKOSO'),('RPM Carbon'),('KINEO IN-MOTION'),('S2-Concept'),('VDM PARTS')"
seed_diff() {
  q "WITH want(label) AS ($EXPECTED_SEED_SQL), got AS (SELECT label FROM public.suppliers)
     SELECT count(*) FROM ((SELECT label FROM want EXCEPT SELECT label FROM got)
                            UNION ALL
                           (SELECT label FROM got EXCEPT SELECT label FROM want)) d"
}
[ "$(seed_diff)" = "0" ] \
  && ok "seed 26 名集合完全相符(對稱差為 0,與排序無關)" \
  || bad "seed 內容不符 — 對稱差 $(seed_diff) 筆"
[ "$(q "SELECT count(*) FROM public.suppliers WHERE label <> btrim(label)")" = "0" ] && ok "seed 全部已 trim" || bad "有未 trim 的 label"

echo "== B. 行為負測 =="
# 🔴 兩個判別向量刻意分開(關卡2 #10):
#    ''     → 只違反 nonempty(btrim('')='' 故 trimmed 通過)
#    'X '   → 只違反 trimmed
expect_red "空字串 label(只打 nonempty)" "suppliers_label_nonempty" "23514" "INSERT INTO public.suppliers(label) VALUES ('')"
expect_red "尾隨空白 label(只打 trimmed)" "suppliers_label_trimmed"  "23514" "INSERT INTO public.suppliers(label) VALUES ('AKOSO ')"
expect_red "重複 label"                    "suppliers_label_unique"   "23505" "INSERT INTO public.suppliers(label) VALUES ('AKOSO')"
expect_red "owner 直接 DELETE"             "不可刪除"                  "P0001" "DELETE FROM public.suppliers WHERE label='AKOSO'"
expect_red "owner TRUNCATE"                "不可刪除"                  "P0001" "TRUNCATE public.suppliers"
# 🔴 service_role 的「不可刪」要真的用該身分測,不能只看權限表(關卡2 #7)
expect_red "service_role DELETE(真 SET ROLE)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; DELETE FROM public.suppliers WHERE label='AKOSO'"
expect_red "service_role INSERT(真 SET ROLE)" "permission denied" "42501" \
  "SET LOCAL ROLE service_role; INSERT INTO public.suppliers(label) VALUES ('偷加的')"

expect_green "合法新增" "INSERT INTO public.suppliers(label) VALUES ('負測臨時')"
expect_green "合法改名" "UPDATE public.suppliers SET label='負測臨時2' WHERE label='負測臨時'"
expect_green "合法停用" "UPDATE public.suppliers SET is_active=false WHERE label='負測臨時2'"
# 🔴 停用要驗「值真的變了」,不是「UPDATE 沒報錯」(關卡2 #12)
[ "$(q "SELECT is_active FROM public.suppliers WHERE label='負測臨時2'")" = "f" ] \
  && ok "停用後 is_active 實際為 false" || bad "is_active 沒有變成 false"
[ "$(q "SELECT updated_at > created_at FROM public.suppliers WHERE label='負測臨時2'")" = "t" ] \
  && ok "updated_at 被 trigger 推進" || bad "updated_at 沒動 = 會說謊的欄位"
psql "$URL" -q -c "ALTER TABLE public.suppliers DISABLE TRIGGER suppliers_no_delete;
                   DELETE FROM public.suppliers WHERE label='負測臨時2';
                   ALTER TABLE public.suppliers ENABLE TRIGGER suppliers_no_delete;" >/dev/null 2>&1
[ "$(seed_diff)" = "0" ] \
  && ok "清理後回到原本 26 名(對稱差為 0)" || bad "清理後名單不符"
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.suppliers'::regclass AND NOT tgisinternal AND tgenabled='O'")" = "3" ] \
  && ok "清理後三支 trigger 仍啟用" || bad "清理後 trigger 未還原"

echo "== C. 突變證明(拿掉守門 ⇒ 對應攻擊必須成功)=="
mutate() {
  local label="$1" drop="$2" attack="$3" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$drop
$attack
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "突變 $label ⇒ 攻擊成功 = 該守門承重"
  else bad "突變 $label ⇒ 攻擊仍失敗 = 可能是死碼或被別道蘊含;實際:$(printf '%s' "$out" | head -1)"; fi
}
# 🔴 每個突變只拿掉「一條」守門,攻擊向量選只被那條擋住的(關卡2 #10)
mutate "label_nonempty" "ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_label_nonempty;" \
                        "INSERT INTO public.suppliers(label) VALUES ('');"
mutate "label_trimmed"  "ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_label_trimmed;" \
                        "INSERT INTO public.suppliers(label) VALUES ('AKOSO ');"
mutate "label_unique"   "ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_label_unique;" \
                        "INSERT INTO public.suppliers(label) VALUES ('AKOSO');"
mutate "no_delete"      "DROP TRIGGER suppliers_no_delete ON public.suppliers;" \
                        "DELETE FROM public.suppliers WHERE label='AKOSO';"
mutate "no_truncate"    "DROP TRIGGER suppliers_no_truncate ON public.suppliers;" \
                        "TRUNCATE public.suppliers;"
mutate "touch_updated"  "DROP TRIGGER suppliers_touch_updated_at ON public.suppliers;" \
                        "UPDATE public.suppliers SET label='AKOSO2' WHERE label='AKOSO';
                         DO \$\$ BEGIN IF (SELECT updated_at > created_at FROM public.suppliers WHERE label='AKOSO2') THEN RAISE EXCEPTION 'trigger 還在'; END IF; END \$\$;"
mutate "service_role_acl" "GRANT DELETE ON public.suppliers TO service_role; DROP TRIGGER suppliers_no_delete ON public.suppliers;" \
                        "SET LOCAL ROLE service_role; DELETE FROM public.suppliers WHERE label='AKOSO';"

echo
echo "== 🔴 只有結構斷言、**沒有**突變證明的項目(不得宣稱已證承重)=="
echo "   · PRIMARY KEY / 各欄 NOT NULL(被型別與 PK 蘊含,構造不出只紅它的向量)"
echo "   · RLS enable 與 zero-policy(owner 連線不經 RLS ⇒ 本 harness 身分下無可觀察差異)"
echo "   · anon / authenticated 零權限(同上:需以該身分連線才測得到,本片無該憑證)"

echo
echo "== 誠實邊界(實測,非推論)=="
echo "   ✅ owner 直接 DELETE 與 owner TRUNCATE **都被擋下**(兩支 trigger 各自實測 + 突變證明)"
echo "   🔴 owner 仍可繞過:ALTER TABLE ... DISABLE TRIGGER / DROP TRIGGER / DROP 或替換 block 函式 / DROP TABLE"
echo "      ⇒ 本片保證的是【應用程式路徑不可刪】。表擁有者手動繞過擋不住 —— 任何 DB 層控制皆然。"
echo "   🔴 session_replication_role=replica:本機 superuser 下可繞;正式站 postgres 非 superuser 且無該 SET 權"
echo "      ⇒ 現況走不通,但 PG17 允許另行授予該參數的 SET 權 ⇒ **不是永久保證**。"
echo "   🔴 本機 C locale ≠ 正式站 en_US.UTF-8(#305);字母排序屬讀取/UI 片,本片未建立亦未測試。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] || exit 1
