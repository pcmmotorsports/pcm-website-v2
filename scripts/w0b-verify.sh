#!/usr/bin/env bash
#
# W0b 驗收 harness —— `public.pcm_b2_shipping_idempotency`(出貨冪等落腳表)
#
# 用法:scripts/w0b-verify.sh        (自建拋棄式 cluster、跑完自動 teardown)
# 格數:**45 格 + `CELL-ACCOUNT` 自身 = 全綠時 `PASS=46`**。
#      45 凍結在 `EXPECT_TOTAL`;新增/刪格必同批更新,否則 `CELL-ACCOUNT` 紅(已驗:改小立刻紅)。
# 真權威:docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md(v4.2 定稿)§1c-1
# 被測物:supabase/migrations/20260807140000_m4b_e10_b2_w0b_shipping_idempotency.sql
#
# ══ 本檔的兩句判準(主視窗 B-189-A ①;後人補格照抄)══════════════════
#   🔴 **消融必須由紅轉綠,否則判別力歸屬錯。**
#      「負測紅在對的 conname」只證那筆資料會被擋,**沒證是被<u>那一條</u>守門擋的**。
#      拿掉該守門後負測仍紅 ⇒ 它其實是被別的東西接住的,那一格在守別人的門。
#   🔴 **全綠的消融也可能恆真,隔離守門自己要有靶。**
#      若消融的 bad 路徑走不到、或隔離比對永遠成立,那些 PASS 一文不值。
#      ⇒ 本檔有三層靶:被測物(5b)、消融機制(5c)、隔離機制(5b 末的 ISOLATION-SELFTEST)。
#
# ══ boolean 寫法(B-185-A ③;本線第三次踩)═══════════════════════
#   🔴 psql `-qtA` 下 **`bool::text` 印 `true`/`false`,裸 boolean 印 `t`/`f`**。
#      **本檔一律用「裸 boolean、期望 t/f」**,唯一例外是需要 `||` 串接的格,
#      那些格顯式寫 `::text` 並期望 `true`/`false`(目前:DEP-BEHAVIOR / RLS-ENABLED)。
#      混用不註明 = 期望寫錯時**不報錯**,而是斷言恆假或負測恆真。
#      (memory `reference_psql-ta-boolean-cast-renders-true-not-t`)
#
# 拋棄式 cluster,埠 **54367**。
# 🔴 這裡**刻意不抄一份埠黑名單**(code review nit 7):手抄的清單會腐,而且本檔自己佔的 54367
#    早晚會被別人列進去。真權威 = 夜跑當下的交接檔;本檔只負責「跑完自拆、埠殘留 0」(收尾那行在驗)。
# 跑完自拆;不碰 repo、不碰正式站。
set -u
export LC_ALL=C LANG=C
D=/private/tmp/claude-502/-Users-sean-1-pcm-website-v2/b99e71a0-0161-4b7b-9105-7d5364b52299/scratchpad/w0bdb
SOCK=/tmp/w0b67
P=54367
PASS=0; FAIL=0
KEYS=""
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-28s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-28s %s\n' "$1" "$2"; }
# 🔴 對抗審查 F12(nit):沒有這道,**刪掉一格不會紅** —— 檔頭宣稱的格數變成散文。
#    形狀照 `scripts/b2s2b-verify.sh` 的 COVERAGE-ACCOUNT(該檔 R1 nit 8)。
EXPECT_TOTAL=45

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1 || { echo INITDB_FAIL; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log"; exit 1; }
Q() { psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d ' \n'; }
QF() { psql -h "$SOCK" -p $P -U postgres -d postgres -qtA -f "$1" 2>&1; }

# ── 依賴:S1a-1 的空白 helper ────────────────────────────────
# 🔴 **從 migration 檔<u>抽出來</u>,不手抄**(B-185-A ④ 要求「改 replay 驗等價」的更便宜等效解)。
#    手抄的話,S1a-1 那支改了字面、本檔照樣綠 ⇒ 等價性斷言變成散文。
#    抽出來之後,等價性是**構造上成立**的,不需要另一條斷言去追。
#    形狀照 b2s2b 的「DROP 清單從 runbook 抽,不手抄」(R1 must-fix 5)。
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql"
awk '/^CREATE FUNCTION public\.pcm_b2_is_blank/,/^\$fn\$;$/' "$MIG" > "$D/dep.sql"
# 🔴 抽取**必須自我檢查**:抽空了會讓後面每一格都紅在莫名其妙的地方,
#    而「抽取失敗」與「函式真的壞了」在症狀上不可分 ⇒ 這裡先把它分開。
DEPLINES="$(wc -l < "$D/dep.sql" | tr -d ' ')"
case "$(cat "$D/dep.sql")" in
  *'CREATE FUNCTION public.pcm_b2_is_blank'*'$fn$;'*)
     [ "$DEPLINES" -ge 8 ] || { echo "DEP_EXTRACT_TOO_SHORT($DEPLINES 行)"; exit 1; } ;;
  *) echo "DEP_EXTRACT_FAIL:抽不到 pcm_b2_is_blank 定義(migration 改過?)"; exit 1 ;;
esac
printf 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;\n' >> "$D/dep.sql"
# 🔴🔴 **對抗審查 F7(must-fix):沒有這三行,下面整組 ACL 格是<u>恆真</u>的。**
#    實測:裸 initdb 的 cluster 裡,一張**完全沒有 REVOKE** 的表,
#    `has_table_privilege('anon'|'authenticated'|'service_role', …)` 也一律回 `f`
#    ⇒ 把 migration 的 REVOKE 整行刪掉,那些格照樣綠。
#    判別力的來源是「裸 cluster 沒有 Supabase 的 default privileges」,**不是 REVOKE**。
#    ⇒ 引 `scripts/d1-supabase-shim.sql:50-52` 的 default privileges,讓「不 REVOKE 就會有權限」成真。
printf "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;\n" >> "$D/dep.sql"
DEPOUT="$(QF "$D/dep.sql")"; case "$DEPOUT" in *ERROR*) echo "DEP_FAIL: $DEPOUT"; exit 1;; esac
echo "══ -1. helper 來源(⑤-3 那條誠實邊界就是這格) ═══════════════"
ok DEP-FROM-MIGRATION "pcm_b2_is_blank 由 migration 實檔抽出($DEPLINES 行),非手抄 ⇒ 等價性構造上成立"
# 正向鏈:證這支 helper 真的在動(否則 CHK-BLANKKEY 可能紅在別的原因)
BL="$(Q "SELECT public.pcm_b2_is_blank(U&'\\3000')::text || '/' || public.pcm_b2_is_blank('x')::text")"
[ "$BL" = "true/false" ] && ok DEP-BEHAVIOR "helper 行為正確(全形空格=true / 'x'=false)" \
                         || bad DEP-BEHAVIOR "helper 行為不如預期:[$BL](期望 true/false)"

# ── 被測物:**真正的 migration 檔本身**,不是副本 ─────────────────
# 🔴 這裡刻意**不**內嵌一份 DDL 拷貝。內嵌的話,migration 改了、本檔照樣綠
#    ⇒ 「DDL 語法驗過」變成散文。同 `pcm_b2_is_blank` 那條理由:
#    **構造上等價 > 這一跑等價**(plan §12-3 / B-187-A ②)。
# 🔴 可用 env 覆寫 —— **這不是方便功能,是 DDL-SYNTAX 那格的突變入口**:
#    餵一份刻意壞掉的副本進來,該格必須由綠轉紅。沒有這個入口,「語法驗過」無法自證判別力。
W0BMIG="${W0BMIG:-$REPO/supabase/migrations/20260807140000_m4b_e10_b2_w0b_shipping_idempotency.sql}"
[ -f "$W0BMIG" ] || { echo "W0B_MIG_MISSING: $W0BMIG"; exit 1; }
cp "$W0BMIG" "$D/w0b.sql"
# 🔴 同樣要自我檢查:拿到空檔或拿錯檔的症狀,與「DDL 真的壞了」不可分。
case "$(cat "$D/w0b.sql")" in
  *'CREATE TABLE public.pcm_b2_shipping_idempotency'*'COMMIT;'*) : ;;
  *) echo "W0B_MIG_SHAPE_FAIL:檔內找不到建表語句或 COMMIT(拿錯檔?)"; exit 1 ;;
esac

echo "══ 0. DDL 語法(§12-3 那條誠實邊界就是這格) ═══════════════"
OUT="$(QF "$D/w0b.sql")"
case "$OUT" in
  *ERROR*) bad DDL-SYNTAX "DDL 跑不起來:$OUT"; pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"; exit 1 ;;
  *) ok DDL-SYNTAX "**migration 實檔**在 PG 17 實跑成功(表 + **2 函式 + 3 發 trigger** + ACL + RLS;非內嵌副本)" ;;
esac

H='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
I() { Q "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,result_snapshot) VALUES ($1);"; }

echo "══ 1. 正向鏈(先證得進去,否則後面每條負測都恆真) ═════════"
R="$(I "'ship','k-ok','$H','{\"shipment_reference\":\"S-1\"}'::jsonb")"
[ -z "$R" ] && ok POS-INSERT "合法列寫得進去(正向鏈成立)" || bad POS-INSERT "合法列被擋:$R"

echo "══ 2. 四條 CHECK 各自的負測(必紅在<u>自己</u>那個 conname) ══"
chk() { R="$(I "$2")"; case "$R" in *"$3"*) ok "$1" "紅在 $3 ✓";; *) bad "$1" "期望紅在 $3,實得:${R:-（沒紅）}";; esac; }
chk CHK-ACTION   "'bogus','k1','$H','{}'::jsonb"            pcm_b2_shipping_idem_action_known
chk CHK-BLANKKEY "'ship',U&'\3000','$H','{}'::jsonb"        pcm_b2_shipping_idem_key_not_blank
chk CHK-HASH     "'ship','k2','NOTAHASH','{}'::jsonb"       pcm_b2_shipping_idem_hash_sha256
chk CHK-DERIVED  "'ship','k3','$H','{\"shipped_quantity\":1}'::jsonb" pcm_b2_shipping_idem_snapshot_no_derived
chk CHK-PK       "'ship','k-ok','$H','{}'::jsonb"           pcm_b2_shipping_idem_pk

echo "══ 3. B2 的誠實邊界要能被<u>觀察到</u>(不是只寫在散文裡) ═══"
R="$(I "'ship','k-nested','$H','{\"a\":{\"shipped_quantity\":1}}'::jsonb")"
[ -z "$R" ] && ok B2-NESTED-HOLE "🔴 巢狀塞**確實擋不到**(黑名單只看 top-level)—— plan 的誠實邊界屬實、不是保守措辭" \
            || bad B2-NESTED-HOLE "巢狀竟被擋?誠實邊界寫錯了:$R"

echo "══ 4. D2 兩發 trigger（TRUNCATE 那發是本檔存在的理由） ═════"
R="$(Q 'DELETE FROM public.pcm_b2_shipping_idempotency;')"
# 🔴 對抗審查 F10(nit):原本有 `|*ERROR*` 萬用臂 ⇒ **任何**錯誤都算 PASS(RAISE 訊息本文不含函式名,
#    `CONSTRAINT` 欄位預設不印)⇒ 那格其實是靠萬用臂過的。改成比對訊息本文。
case "$R" in *禁止刪除或清空*) ok D2-DELETE "DELETE 被擋、且紅在**本守門的訊息本文**(非任意錯誤)";;
  *) bad D2-DELETE "DELETE 沒被本守門擋:${R:-（空）}";; esac
R="$(Q 'TRUNCATE public.pcm_b2_shipping_idempotency;')"
case "$R" in *禁止刪除或清空*) ok D2-TRUNCATE "TRUNCATE 被擋、且紅在本守門的訊息本文";;
  *) bad D2-TRUNCATE "TRUNCATE 沒被本守門擋:${R:-（空）}";; esac

echo "══ 4b. C3 凍結格的量法:tgtype 逐發(突變<u>前</u>的基準) ═══"
TG_BEFORE="$(Q "SELECT string_agg(tgname||'='||tgtype::text, ' ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND NOT tgisinternal")"
echo "     基準:$TG_BEFORE"
case "$TG_BEFORE" in
  *block_delete=11*block_identity_update=19*block_truncate=34*)
     ok C3-TGTYPE "🔴 **三發** tgtype 各異(DELETE-ROW=11 / UPDATE-ROW=19 / TRUNCATE-STMT=34)⇒ 逐發量才分得出;
                              第三發也被斷言(code review nit 6:漏斷言的話 BEFORE→AFTER UPDATE 的漂移 19→17 不會紅在任何一格)" ;;
  *) bad C3-TGTYPE "tgtype 基準不如預期:$TG_BEFORE" ;;
esac
# 🔴 對抗審查 F11(must-fix):plan §1c-1 逐字要求 C3 oracle 含 `proname / prosecdef / proconfig`
#    **加上** tgtype,harness 原本只做 tgtype ⇒ 把守門函式改成 SECURITY DEFINER
#    或拿掉 SET search_path='' 都不會紅。實測現值:secdef=false / cfg=search_path=""。
for fn in pcm_b2_shipping_idem_no_purge pcm_b2_shipping_idem_freeze_identity; do
  FV="$(Q "SELECT proname||'|'||prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'NULL') FROM pg_proc WHERE proname='$fn'")"
  [ "$FV" = "$fn|false|search_path=\"\"" ] \
    && ok "C3-FNPROPS-$fn" "proname/prosecdef/proconfig 三欄逐字相符 ✓" \
    || bad "C3-FNPROPS-$fn" "函式屬性漂移:[$FV](期望 $fn|false|search_path=\"\")"
done

echo "══ 5. 🔴 突變靶:拿掉 TRUNCATE 那發,D2-TRUNCATE 必須翻面 ══"
Q 'DROP TRIGGER pcm_b2_shipping_idem_block_truncate ON public.pcm_b2_shipping_idempotency;' >/dev/null
R="$(Q 'TRUNCATE public.pcm_b2_shipping_idempotency;')"
N="$(Q 'SELECT count(*) FROM public.pcm_b2_shipping_idempotency;')"
if [ -z "$R" ] && [ "$N" = "0" ]; then
  ok TMUT-TRUNCATE "🔴 拿掉那發 ⇒ TRUNCATE 成功、剩 $N 列 = **D2-TRUNCATE 有判別力**"
else
  bad TMUT-TRUNCATE "突變後仍被擋(R=[$R] 剩[$N])⇒ D2-TRUNCATE 是恆真格、守的不是那發 trigger"
fi
echo "  🔴 對照:此時函式與 DELETE 那發都還在 ⇒ 「函式在不在」「trigger 數 >= 1」兩種斷言在這一刻**全綠**"
echo "     ⇒ 它們對「少掛一發」全盲,C3 的凍結格必須逐發量 tgtype。"
TG_AFTER="$(Q "SELECT string_agg(tgname||'='||tgtype::text, ' ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND NOT tgisinternal")"
echo "     突變後:$TG_AFTER"
CNT_AFTER="$(Q "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.pcm_b2_shipping_idempotency'::regclass AND NOT tgisinternal")"
FN_AFTER="$(Q "SELECT count(*) FROM pg_proc WHERE proname='pcm_b2_shipping_idem_no_purge'")"
# 🔴 這裡刻意用 `-ge 1` 而非硬編碼數字:本格要表達的是「trigger 數這種**存在性**斷言在突變後仍成立」,
#    寫死數字的話,每次新增一發 trigger 就會紅在**本格**而不是紅在該紅的地方(2026-08-07 F4 補第三發時實際踩到)。
if [ "$FN_AFTER" = "1" ] && [ "$CNT_AFTER" -ge 1 ] && [ "$TG_BEFORE" != "$TG_AFTER" ]; then
  ok C3-ONLY-TGTYPE-CATCHES "🔴 突變後:函式仍在(=$FN_AFTER)、trigger 數 $CNT_AFTER>=1 ⇒ 那兩種斷言全綠;**只有 tgtype 集合比對紅了**"
else
  bad C3-ONLY-TGTYPE-CATCHES "判別力對照不成立(fn=$FN_AFTER cnt=$CNT_AFTER before=[$TG_BEFORE] after=[$TG_AFTER])"
fi

echo "══ 5b. 🔴 消融靶:**五條 CHECK 逐條** + PK 改測 conname ═══════"
# 🔴 段標題原本寫「五條 CHECK 的消融靶」,實際只有四條 CHECK 消融 + 一條 PK conname 比對,
#    而 F1 新加的 `snapshot_is_object` **一格消融都沒有**(code review must-fix 3)。
#    ⇒ 本檔 :12-14 自己立的判準「消融必須由紅轉綠」對 F1-NONOBJ-* 三格**當時沒有兌現**。已補 ABL-SNAPOBJ。
# 🔴 §2 只證了「負測紅在對的 conname」——那對「CHECK 被拿掉」全盲嗎?不一定,
#    但**沒測就是不知道**。這裡逐條 DROP CONSTRAINT,再餵同一筆負測資料:
#    **必須由紅轉綠**;沒轉綠 = 那條負測其實是被<u>別的</u>守門接住的(判別力歸屬錯)。
# 🔴 **每格在自己的交易裡消融、跑完 ROLLBACK**(④-4 自裁:選「構造上獨立」而非「斷言互不蘊含」)。
#    理由與 ⑤-3 抽字面同一條:**構造上成立 > 這一跑成立**。
#    互不蘊含斷言只證「這一跑四條沒互相蓋住」;交易隔離讓每格**永遠**看到完整的表,
#    連「未來有人加第五條 CHECK 且它蘊含第二條」都不必重新論證。
CONS_N() { Q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.pcm_b2_shipping_idempotency'::regclass AND contype IN ('c','p')"; }
CONS_FULL="$(CONS_N)"
abl() {  # $1=格名 $2=conname $3=VALUES 字面
  # 🔴 對抗審查 F14(nit):先確認 conname **真的存在** —— 否則「打錯字/被改名」
  #    會被誤診成「判別力歸屬錯」,兩者訊息完全一樣。
  [ "$(Q "SELECT count(*) FROM pg_constraint WHERE conrelid='public.pcm_b2_shipping_idempotency'::regclass AND conname='$2'")" = "1" ] \
    || { bad "$1-CONNAME" "conname [$2] 不存在 ⇒ 本格量不到東西(不是判別力問題)"; return; }
  # 🔴 對抗審查 F13(nit,實測釘住):INSERT 失敗時交易 abort,後面的 `ROLLBACK` 字**會被跳過** ——
  #    交易之所以仍回滾,是因為 `psql -c` 收尾**關掉連線**。
  #    ⇒ 這個前提綁在「每次 Q() 開新連線」上。日後若把 Q() 改成共用連線或 `-f` 單檔,
  #    四格消融會**外洩到後續格**。下面的 CONS_N 比對就是釘住這個前提的那道。
  R="$(Q "BEGIN; ALTER TABLE public.pcm_b2_shipping_idempotency DROP CONSTRAINT $2; INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash,result_snapshot) VALUES ($3); ROLLBACK;")"
  # 🔴 隔離本身要被驗:回滾後約束數必須回到基準,否則後面每一格都在被污染的表上跑
  N="$(CONS_N)"
  [ "$N" = "$CONS_FULL" ] || { bad "$1-ISOLATION" "回滾後約束數 $N != 基準 $CONS_FULL ⇒ 消融外洩、後續格全部不可信"; return; }
  # 🔴 code review nit 5 的同族(F14 我只修了 conname 那一半):
  #    **「我的 SQL 寫壞了」與「被別的守門擋住」原本共用同一句 bad 訊息** ——
  #    2026-08-07 ABL-SNAPOBJ 首跑就被誤報成「判別力歸屬錯」,實際是引號打錯。
  #    ⇒ 語法/型別錯另立訊息,不得混進判別力結論。
  case "$R" in
    "") ok "$1" "拿掉 $2 ⇒ 同一筆負測**寫得進去** = 該格判別力歸屬正確" ;;
    *syntaxerror*|*syntax\ error*|*doesnotexist*|*cannotbematched*)
        bad "$1-SQL" "🔴 本格的 SQL 自己寫壞了(非判別力問題):$R" ;;
    *) bad "$1" "拿掉 $2 後仍被擋:$R ⇒ 原負測其實紅在別的守門,判別力歸屬錯" ;;
  esac
}
abl ABL-ACTION   pcm_b2_shipping_idem_action_known           "'bogus','a1','$H','{}'::jsonb"
abl ABL-BLANKKEY pcm_b2_shipping_idem_key_not_blank          "'ship',U&'\\3000','$H','{}'::jsonb"
abl ABL-HASH     pcm_b2_shipping_idem_hash_sha256            "'ship','a3','NOTAHASH','{}'::jsonb"
abl ABL-DERIVED  pcm_b2_shipping_idem_snapshot_no_derived    "'ship','a4','$H','{\"shipped_quantity\":1}'::jsonb"
abl ABL-SNAPOBJ  pcm_b2_shipping_idem_snapshot_is_object      "'ship','a5','$H','null'::jsonb"
# 🔴 PK 不能用 DROP CONSTRAINT 做消融(它同時是索引與 §1d 分派的錨)⇒ 改測「它撞的是<u>哪個</u> conname」,
#    因為 §1d 的分派靠 conname,認錯名字的後果是「併發被誤判成撞號 ⇒ 重產號新建一箱」。
Q "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash) VALUES ('ship','dup','$H');" >/dev/null
R="$(I "'ship','dup','$H','{}'::jsonb")"
case "$R" in
  *pcm_b2_shipping_idem_pk*) ok ABL-PK-CONNAME "重複鍵紅在 **pcm_b2_shipping_idem_pk** ⇒ §1d 分派認得出來" ;;
  *) bad ABL-PK-CONNAME "重複鍵的 conname 不是預期值:$R" ;;
esac

# 🔴 隔離守門自己也要證明紅得起來(否則 CONS_N 比對是恆真的)。
#    刻意 COMMIT 一次消融 ⇒ 約束數必須真的掉 ⇒ 那個守門的條件確實可觸發。
Q "BEGIN; ALTER TABLE public.pcm_b2_shipping_idempotency DROP CONSTRAINT pcm_b2_shipping_idem_hash_sha256; COMMIT;" >/dev/null
N_AFTER_COMMIT="$(CONS_N)"
if [ "$N_AFTER_COMMIT" != "$CONS_FULL" ]; then
  ok ABL-ISOLATION-SELFTEST "🔴 刻意 COMMIT 消融 ⇒ 約束數 $CONS_FULL→$N_AFTER_COMMIT ⇒ **隔離守門的條件可觸發、非恆真**"
else
  bad ABL-ISOLATION-SELFTEST "COMMIT 掉一條約束後數量竟沒變($N_AFTER_COMMIT)⇒ CONS_N 量錯東西、隔離守門恆真"
fi
Q "ALTER TABLE public.pcm_b2_shipping_idempotency ADD CONSTRAINT pcm_b2_shipping_idem_hash_sha256 CHECK (payload_hash ~ '^[0-9a-f]{64}\$');" >/dev/null
[ "$(CONS_N)" = "$CONS_FULL" ] && ok ABL-ISOLATION-RESTORED "還原後約束數回到基準 $CONS_FULL" \
                              || bad ABL-ISOLATION-RESTORED "還原失敗:$(CONS_N) != $CONS_FULL"

# 🔴 對抗審查 F10(nit)後半:DELETE 那發原本**沒有**對應突變靶(只有 TRUNCATE 有)。
# 🔴 code review nit 8:原本這裡有一行沒取回傳值的死行(下一句完整重跑一次),已刪。
#    併補**事前非零斷言** —— 沒有它,表若剛好空的,`count=0` 會讓本格恆真
#    (memory `feedback_fixture-value-makes-guard-vacuous`:fixture 碰巧的值會讓守門變恆真)。
PRE_N="$(Q 'SELECT count(*) FROM public.pcm_b2_shipping_idempotency')"
[ "$PRE_N" -gt 0 ] || bad TMUT-DELETE-PRECOND "🔴 表是空的($PRE_N 列)⇒ 下一格的 count=0 恆成立、零判別力"
DMUT="$(Q "BEGIN; DROP TRIGGER pcm_b2_shipping_idem_block_delete ON public.pcm_b2_shipping_idempotency; DELETE FROM public.pcm_b2_shipping_idempotency; SELECT count(*) FROM public.pcm_b2_shipping_idempotency; ROLLBACK;")"
[ "$DMUT" = "0" ] && ok TMUT-DELETE "🔴 拿掉 DELETE 那發 ⇒ DELETE 把 $PRE_N 列清光(交易內)= D2-DELETE 有判別力" \
                  || bad TMUT-DELETE "拿掉 DELETE 那發後仍清不掉(得 [$DMUT])⇒ D2-DELETE 守的不是那發"

echo "══ 5c. 🔴 消融 harness 自己的 meta 突變(它紅得起來嗎?) ═════"
# 🔴 5b 五格全綠 —— 但**全綠的消融也可能是恆真的**:若 `abl` 的 bad 路徑根本走不到,
#    那五個 PASS 一文不值(memory feedback_negative-test-harness-self-false-green)。
#    這裡刻意**錯配一次**:拿掉 A 這條 CHECK,卻餵違反 B 的資料 ⇒ 應該仍被擋 ⇒ `abl` 應判 bad。
#    只驗「bad 路徑可達」,不動真正的 PASS/FAIL 計數。
Q "CREATE TABLE public.meta_t(x text, CONSTRAINT c_a CHECK (x <> 'A'), CONSTRAINT c_b CHECK (x <> 'B'));" >/dev/null
Q "ALTER TABLE public.meta_t DROP CONSTRAINT c_a;" >/dev/null
META="$(Q "INSERT INTO public.meta_t VALUES ('B');")"
if [ -n "$META" ]; then
  ok ABL-SELFTEST "🔴 錯配(拿掉 c_a、餵違反 c_b 的資料)**仍被擋** ⇒ abl 的 bad 路徑可達、5b 的五個 PASS 有意義"
else
  bad ABL-SELFTEST "錯配竟然放行 ⇒ **5b 整段是恆真的**,五個 PASS 不成立"
fi
# 反向對照:同一張表拿掉 c_b 再餵 B ⇒ 必須放行(證消融機制本身會動)
Q "ALTER TABLE public.meta_t DROP CONSTRAINT c_b;" >/dev/null
META2="$(Q "INSERT INTO public.meta_t VALUES ('B');")"
[ -z "$META2" ] && ok ABL-SELFTEST-POS "反向對照:拿掉 c_b 後同筆資料放行 ⇒ 消融機制確實在動" \
                || bad ABL-SELFTEST-POS "拿掉 c_b 後仍被擋:$META2"

echo "══ 5d. 🔴 F4/F5/F9:UPDATE 與 replica 兩條路(原本零觀察面) ═══"
Q "INSERT INTO public.pcm_b2_shipping_idempotency(action,idempotency_key,payload_hash) VALUES ('void','f4-probe','$H');" >/dev/null
# F4:改鍵必須被擋(這條原本零錯誤成功 ⇒ 同鍵重來多出一箱貨)
R="$(Q "UPDATE public.pcm_b2_shipping_idempotency SET idempotency_key='f4-probe-x' WHERE idempotency_key='f4-probe';")"
case "$R" in *pcm_b2_shipping_idem_freeze_identity*) ok F4-KEY-FROZEN "改 idempotency_key 被擋、紅在 freeze_identity ✓" ;;
  *) bad F4-KEY-FROZEN "改鍵未被正確擋下:${R:-（零錯誤成功=冪等鍵被釋放）}" ;; esac
for col in action payload_hash created_at; do
  case "$col" in
    action)       V="'ship'" ;;
    payload_hash) V="'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'" ;;
    created_at)   V="now()" ;;
  esac
  R="$(Q "UPDATE public.pcm_b2_shipping_idempotency SET $col=$V WHERE idempotency_key='f4-probe';")"
  case "$R" in *freeze_identity*) ok "F4-FROZEN-$col" "凍結 ✓" ;; *) bad "F4-FROZEN-$col" "未凍結:${R:-（成功）}" ;; esac
done
# 🔴 正向鏈:凍結不得凍過頭 —— shipment_id 回填與 result_snapshot 必須放行,否則 W2 做不了事
R="$(Q "UPDATE public.pcm_b2_shipping_idempotency SET shipment_id='11111111-1111-1111-1111-111111111111', result_snapshot='{\"a\":1}'::jsonb WHERE idempotency_key='f4-probe';")"
[ -z "$R" ] && ok F4-BACKFILL-ALLOWED "shipment_id 回填 + 快照寫入**放行**(凍結沒凍過頭)" \
            || bad F4-BACKFILL-ALLOWED "🔴 凍過頭:W2 的回填被擋了:$R"
R="$(Q "UPDATE public.pcm_b2_shipping_idempotency SET shipment_id='22222222-2222-2222-2222-222222222222' WHERE idempotency_key='f4-probe';")"
case "$R" in *freeze_identity*) ok F4-REPOINT-BLOCKED "已回填的 shipment_id 不可改指別箱 ✓" ;;
  *) bad F4-REPOINT-BLOCKED "改指別箱未被擋:${R:-（成功）}⇒ 重放會回到錯的產物" ;; esac
# F5:session_replication_role=replica 繞過路(ENABLE ALWAYS 才擋得住)
# 🔴 code review nit 5:原本 case 有 `|*ERROR*` 萬用臂 —— **正是 F10 從 D2-DELETE 拿掉的那個形狀**。
#    非 superuser 下 `SET session_replication_role` 會回 `permission denied to set parameter`
#    ⇒ replica **從未生效**、DELETE **從未跑**,而該格仍 PASS。目前跑在 superuser 故不可達,是**潛伏**假綠。
#    ⇒ ①先斷言 SET 真的成立 ②再比對本守門的訊息本文,不接受任意錯誤。
SETR="$(Q "SET session_replication_role='replica'; SHOW session_replication_role;")"
if [ "$SETR" != "replica" ]; then
  bad F5-REPLICA-PRECOND "🔴 `SET session_replication_role` 未生效(得 [$SETR])⇒ 本格量不到東西,不是「擋住了」"
else
  ok F5-REPLICA-PRECOND "前置成立:session_replication_role 確實已切到 replica(否則下一格恆真)"
  R="$(Q "SET session_replication_role='replica'; DELETE FROM public.pcm_b2_shipping_idempotency;")"
  N="$(Q 'SELECT count(*) FROM public.pcm_b2_shipping_idempotency')"
  case "$R" in *禁止刪除或清空*) ok F5-REPLICA-BLOCKED "replica 模式下 DELETE 仍被本守門擋(剩 $N 列)✓" ;;
    *) bad F5-REPLICA-BLOCKED "🔴 replica 繞過、剩 $N 列 ⇒ 三發 trigger 沒有 ENABLE ALWAYS(得:${R:-（零錯誤）})" ;; esac
fi
# F1:非物件快照
# 🔴 三格**必須各自具名**:共用一個 key 會讓覆蓋帳的重複檢查紅,而且看不出是哪一種形狀漏掉
#    (2026-08-07 由本檔新加的 CELL-DUP 當場抓到,正是它該有的作用)。
for v in null:"'null'::jsonb" num:"'123'::jsonb" arr:"'[1,2]'::jsonb"; do
  TAG="${v%%:*}"; VAL="${v#*:}"
  R="$(I "'void','f1-$TAG','$H',$VAL")"
  case "$R" in *snapshot_is_object*) ok "F1-NONOBJ-$TAG" "非物件快照 $VAL 被擋 ✓" ;;
    *) bad "F1-NONOBJ-$TAG" "非物件快照 $VAL 竟寫得進去:${R:-（成功）}" ;; esac
done

echo "══ 6. ACL:零應用層寫入路(F7 判別力對照 + F8 六種權限) ═════"
# 🔴 F7 對照組:同一 cluster 建一張**完全沒 REVOKE** 的表。
#    有了 default privileges 之後它必須是 `t` —— 若也是 `f`,代表下面整組格恆真、判別力歸屬錯。
Q "CREATE TABLE public.acl_control_no_revoke(x int);" >/dev/null
CTLV="$(Q "SELECT has_table_privilege('service_role','public.acl_control_no_revoke','SELECT')")"
[ "$CTLV" = "t" ] && ok ACL-CONTROL-HAS-PRIV "🔴 對照組(未 REVOKE 的表)= **t** ⇒ 下面每一格的綠來自 REVOKE,不是來自環境" \
                  || bad ACL-CONTROL-HAS-PRIV "🔴 對照組也是 [$CTLV] ⇒ **ACL 整組恆真**,判別力歸屬錯(F7 原病灶)"
# 🔴 F8:宣稱是「零**寫入**路」,就不能只量 SELECT。
for r in anon authenticated service_role authenticator; do
  V="$(Q "SELECT string_agg(p||'='||has_table_privilege('$r','public.pcm_b2_shipping_idempotency',p)::text, ' ' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES']) p")"
  case "$V" in
    *true*) bad "ACL-$r" "🔴 有權限:$V" ;;
    *) ok "ACL-$r" "六種權限全 false(SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES)✓" ;;
  esac
done
# 🔴 `::text` 轉的是 `true`/`false`,裸 boolean 才是 `t`/`f` —— 本線第三次踩(前科:EXISTS(...)::text)
V="$(Q "SELECT relrowsecurity::text FROM pg_class WHERE oid='public.pcm_b2_shipping_idempotency'::regclass")"
[ "$V" = "true" ] && ok RLS-ENABLED "RLS 已啟用(零 policy;🔴 owner 不受限,誠實邊界照 S1a-1)" || bad RLS-ENABLED "RLS 未啟用:$V"

pg_ctl -D "$D" -w stop >/dev/null 2>&1; rm -rf "$D" "$SOCK"
echo
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"
  PASS=$((PASS+1))
else
  printf '  FAIL %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或新增未更新凍結值"
  FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-28s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
echo "════ PASS=$PASS FAIL=$FAIL ════  埠殘留:$(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
[ "$FAIL" -eq 0 ] || exit 1
