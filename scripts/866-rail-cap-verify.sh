#!/usr/bin/env bash
# ============================================================
# `#866` 上限函式的驗證 harness(拋棄式 PG,零 DB、零網路、零正式庫)
# ============================================================
# 標的 = supabase/migrations/20260824010000_m4b_866_manual_refund_rail_cap.sql(算式)
#      + supabase/migrations/20260824011000_..._enforce.sql(trigger 行為;§3b + M4)
# 用法 = bash scripts/866-rail-cap-verify.sh
#
# 🔴🔴 **它【不在 CI 跑】—— 它是人手動跑的,不是自動守門。**
#    需要一台本機 postgres(拋棄式;它自己起、自己收),而 CI 上沒有
#    ⇒ **沒有任何東西會在你改壞那支函式的時候自動變紅。**
#    ⇒ 動 `20260824010000` / `20260824011000` 那兩支的人:**你要自己跑這一支。**
#      預期 `PASS=48 FAIL=0`;跑之前確認沒有殘留:`pgrep -f "postgres.*pc866"`。
#
# 🔴 **為什麼它仍然進版控**(2026-08-24,窗 A 選甲、主視窗 `25` 收):
#    那兩支 migration 自己**指著這個路徑**,四處逐字:
#      `20260824010000_..._rail_cap.sql:221` / 同檔 `:230` 的 RAISE NOTICE
#      `20260824011000_..._enforce.sql:10`  / 同檔 `:314` 的 RAISE NOTICE
#    ⇒ 收了 migration 而不收這一支 = **版控裡有四處指向一個不存在的檔**。
#    📌 而前科是同一夜的 `d3e01216`:一道守門的對照組依賴一支沒進版控的實驗檔
#      ⇒ **本機永遠綠、CI 永遠紅**。
#    🔴 一份 harness 的價值在【別人也跑得動】;留在工作樹上的 harness,
#      證明的是【那一台機器那一刻】,而它產出的綠與一個沒有 harness 的綠,在報告上長得一樣。
#
# 🔴 **本檔的每一個結論都綁在【它跑在哪個 PG 版本上】** —— 版本由下面這行當場印出,
#    不寫死在註解裡(寫死的版本號在下一個人讀到時就過期了)。
#    ⚠️ **而 Supabase 正式庫的版本【未確認】** —— 本檔量到的行為(尤其是
#       「單一語句多列會不會被擋」這一類與快照有關的)**不自動適用於正式庫**。
#
# 🔴 **為什麼這支存在**:那支 migration 自帶的 A1-A4 只涵蓋【權限】與【零列回 0】——
#    它**不涵蓋算式對不對**。2026-08-24 突變實測:
#      拿掉 `AND m.voided_at IS NULL`     ⇒ 值從 1000 變 600,而 **A1-A4 一道都沒響**
#      拿掉 `AND p.rail IN (…)`           ⇒ 純刷卡單從 0 變 18400,**一樣沒響**
#    ⇒ **權限對、不是 NULL、而算出來的數字是錯的 —— 那三件事互不蘊含。**
#    ⇒ 算式那一半的證人在【本檔】,不在那支 migration 裡。**改那支函式的人要跑這支。**
#
# 🔴🔴 **schema 是從真 migration【切】出來的,不是我照理解重打的** ────────────
# 第一版我手打了一套簡化 schema,四發突變全綠 —— 而那套 DDL **沒有 FK、沒有那些 CHECK**
# ⇒ 我在裡面塞的探針列(捏的 order_id、憑空的負數列)在正式庫**一定會被拒**,
#   而本機不會告訴我。**我自己造的替身,只會照我理解的樣子回答我。**
# ⇒ 所以本檔用 `sed` 從那兩支建表 migration 逐字切 `CREATE TABLE`,**一個字不重打**。
# ⚠️ **而這仍有限度,照實寫**:
#    · FK 指到的 `orders` / `staff` 是本檔造的**最小 stub**(只有 id)⇒ 那兩張表自己的
#      約束**不在射程內**
#    · 沒有 RLS、沒有 GRANT 的正式庫現況、沒有既有資料
#    · ⇒ **本檔過 ≠ 正式庫過**(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)
# ============================================================
set -uo pipefail
export LC_ALL=C

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations/20260824010000_m4b_866_manual_refund_rail_cap.sql"
MIG2="$REPO/supabase/migrations/20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql"
SRC_PAY="$REPO/supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql"
SRC_MR="$REPO/supabase/migrations/20260820010000_m4b_manual_refunds.sql"
# 🔴 `voided_at` **不在建表那支** —— 它是 `20260820090000` 用 ALTER TABLE 後加的。
#    第一版我只切了建表那支,而**本檔自己的量具自檢當場擋下**(少了 voided_at ⇒ 結果作廢)。
#    📌 形狀:**「這張表長怎樣」的分母,是【所有寫過它的 migration】,不是建立它的那一支。**
#       (同款已記在 `supabase/APPLIED.tsv:281`:比對線上是哪一版時,分母要含所有會寫同一物件的檔。)
SRC_MR_ALTER="$REPO/supabase/migrations/20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql"
for f in "$MIG" "$MIG2" "$SRC_PAY" "$SRC_MR" "$SRC_MR_ALTER"; do
  test -f "$f" || { echo "🔴 找不到 $f"; exit 1; }
done

command -v initdb >/dev/null || { echo "🔴 找不到 initdb(brew install postgresql@17)"; exit 1; }

# socket 路徑要短 —— UNIX socket 有長度上限,mktemp 預設路徑會爆
PGDIR=$(mktemp -d /tmp/pc866XXXX)
export PGHOST="$PGDIR" PGPORT=54871 PGDATABASE=postgres PGUSER=probe
cleanup() { pg_ctl -D "$PGDIR/data" stop -m immediate >/dev/null 2>&1; rm -rf "$PGDIR"; }
trap cleanup EXIT

initdb -D "$PGDIR/data" -U probe --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo "🔴 initdb 失敗"; exit 1; }
pg_ctl -D "$PGDIR/data" -o "-k $PGDIR -p 54871 -c listen_addresses=''" -l "$PGDIR/log" start >/dev/null 2>&1
sleep 2
psql -qc "select 1" >/dev/null 2>&1 || { echo "🔴 PG 起不來"; tail -5 "$PGDIR/log"; exit 1; }

echo "══ 本次跑在:$(postgres --version 2>/dev/null || psql --version) ══"
echo "   ⚠️ Supabase 正式庫版本【未確認】⇒ 與快照有關的結論不自動適用"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  🔴 FAIL %s — %s\n' "$1" "$2"; }
q()    { psql -qtAX -c "$1" 2>&1; }
eq()   { [ "$2" = "$3" ] && ok "$1 [$2]" || bad "$1" "得到 [$2] 預期 [$3]"; }

# ══ schema:逐字切自真 migration ══════════════════════════════════════════
#
# 🔴🔴 **第二版(2026-08-24 codex must-fix):切法從【位置式】改成【機械式】。**
#
# 舊版怎麼壞的:
#   · `head -4` 取那三個作廢欄的 ALTER ⇒ **位置式** ⇒ 後面的 ALTER / CHECK 一律不會進來
#   · 而 token 自檢只找 `voided_at` ⇒ **切漏了照樣全綠**
#   ⇒ 實際漏掉兩樣**承重**的東西(codex 指名,本窗機械掃過確認):
#       `20260820021000` ADD COLUMN request_id uuid **NOT NULL**
#       `20260820090000` ADD CONSTRAINT **order_manual_refunds_void_trio** CHECK (…)
#   ⇒ 🔴 **本檔的每一發 INSERT 在正式庫都會因為缺 `request_id` 而失敗**,而本機全綠。
#
# 📌 **這是同一句話的第三次**:
#    「這張表長怎樣」的分母,是**所有寫過它的 migration**,不是建立它的那一支。
#    🔴 而前兩次我**已經把這句話寫在這個檔的註解裡了** —— 知道一條規矩,
#       擋不住你在下一段用一個位置式的 `head -4` 掉進去。**規矩要變成程式,不是變成註解。**
#
# ✅ 現在的做法:掃**全部** migration(檔名排序),剝掉 dollar-quoted 區塊與 `--` 註解,
#    把所有頂層 `ALTER TABLE public.{order_payments,order_manual_refunds} … ;` 原文接上去。
#    ⇒ 之後誰再加一支 ALTER,本檔**自動**跟上,不必有人記得回來改。
cut_table() { sed -n "/^CREATE TABLE $1 (/,/^);/p" "$2"; }

{
  echo "CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;"
  # FK stub —— 只有 id,而它的限度寫在檔頭
  echo "CREATE TABLE public.orders (id uuid PRIMARY KEY);"
  echo "CREATE TABLE public.staff  (id text PRIMARY KEY);"
  cut_table "public.order_payments" "$SRC_PAY"
  cut_table "public.order_manual_refunds" "$SRC_MR"
  # 🔴 `order_manual_refunds_void_trio` 那道 CHECK **呼叫一個 helper 函式**
  #    (`pcm_b2_is_blank`,定義在 `20260805170000:56`)⇒ 少了它,CHECK 建不起來。
  #    📌 **這是「分母」那句話的第四種形狀**:一張表的形狀,連**它的約束呼叫到的函式**都算在內。
  #       (而這一格不是我想到的 —— 是機械掃把 CHECK 拉進來之後,PG 自己報出來的。)
  sed -n '/^CREATE FUNCTION public.pcm_b2_is_blank(/,/^\$fn\$;/p' \
    "$REPO/supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql"
  python3 - "$REPO/supabase/migrations" <<'PY'
import sys, re, glob, os
tgt = re.compile(
    r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?'
    r'public\.(?:order_manual_refunds|order_payments)\b[^;]*;', re.I | re.S)
dollar = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*|)\$.*?\$\1\$', re.S)
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.sql'))):
    src = open(f, encoding='utf-8').read()
    src = dollar.sub('', src)                 # 函式本體 / DO 區塊裡的不算
    src = re.sub(r'--[^\n]*', '', src)        # 註解裡的不算
    for m in tgt.finditer(src):
        stmt = m.group(0)
        # 🔴🔴 **2026-08-30 線A `-e9` 補(是我把這支弄紅的, 由我修)**:
        #    D3-d(`20260830050000`)加了兩句 `ALTER TABLE … ENABLE ALWAYS TRIGGER …`,
        #    而本掃描把它們原樣接進 `schema.sql` ⇒ **trigger 還不存在** ⇒ 整份 schema 套不起來
        #    (`ERROR: trigger "order_manual_refunds_immutable_bu" … does not exist`)。
        #    ⇒ 本掃描的用途是【重建表的形狀】, 不是重播 trigger 接線 ⇒ 佈線語句要排除。
        #    📌 **而這一格最值得記的是它的來源**:上面那段註解自誇
        #      「之後誰再加一支 ALTER, 本檔**自動**跟上, 不必有人記得回來改」——
        #      而**正是那個自動跟上, 讓一支完全合法的新 ALTER 把它弄紅了**。
        #      一個為了「不必有人記得」而做的機制, 它的失效方式是【它記得太多】。
        #    🔴🔴 **而第一版的過濾器【太寬】(codex R2 must-fix #4)**:
        #      `ALTER TABLE x ADD COLUMN c text, ENABLE TRIGGER foo;` 是合法的一句兩動作,
        #      舊寫法會把它整句丟掉 ⇒ **連那個欄一起漏, 而 schema 照樣印綠。**
        #    ⇒ 改成:動作清單每一項都是 ENABLE/DISABLE … TRIGGER 才跳過。
        _m = re.match(r'\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?\S+\s+(.*);\s*$',
                      stmt, re.I | re.S)
        if _m:
            _acts = [a.strip() for a in _m.group(1).split(',')]
            if _acts and all(re.match(r'(EN|DIS)ABLE\b.*\bTRIGGER\b', a, re.I) for a in _acts):
                continue
        # 🔴 RLS 在本 harness 沒有意義(跑的人是 owner),而**留著它才是原文** ——
        #    它不改變任何一格的答案,拿掉它反而是我在替 schema 做判斷。
        print(f"-- from {os.path.basename(f)}")
        print(stmt)
PY
} > "$PGDIR/schema.sql"

# 🔴 量具自檢:切出來的 DDL 要真的含那些**承重**約束,否則本檔在驗一個假的 schema。
#    ⚠️ 這張清單是**人列的**,它只證明「這幾樣在」,不證明「沒有別的漏掉」——
#       真正防漏的是上面那段機械掃,這裡只是它的煙霧偵測器。
for token in "REFERENCES public.orders(id)" "order_payments_rail_fields" "reverses_payment_id" \
             "voided_at" "request_id uuid NOT NULL" "order_manual_refunds_void_trio" \
             "DROP CONSTRAINT order_payments_dormant_until_triggers" \
             "FUNCTION public.pcm_b2_is_blank"; do
  grep -qF "$token" "$PGDIR/schema.sql" || { echo "🔴 切出來的 schema 少了 [$token] ⇒ 沒切到真表,本次結果作廢"; exit 1; }
done

# 🔴 **報錯要報【第一發】的輸出,不能失敗後再跑一次**:
#    第一發已經部分成功(角色建了、表建了)⇒ 第二發的錯誤是「already exists」,
#    它**蓋掉真正的成因**。2026-08-24 本檔就這樣自己騙了自己一次。
SCHEMA_OUT=$(psql -qX -v ON_ERROR_STOP=1 -f "$PGDIR/schema.sql" 2>&1) \
  || { echo "🔴 真 schema 套不起來(以下是【第一發】的輸出)"; echo "$SCHEMA_OUT" | grep -i error | head -4; exit 1; }
echo "══ schema 逐字切自真 migration,承重約束自檢通過 ══"

echo
echo "══ 1. 套 migration(片1 的 A1-A4 / 片2 的 B1-B3 都在同一交易內跑)══"
if psql -qX -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1; then ok "片1 apply 成功"; else
  bad "片1 apply" "$(psql -qX -f "$MIG" 2>&1 | grep -m1 ERROR | cut -c1-90)"; fi
if psql -qX -v ON_ERROR_STOP=1 -f "$MIG2" >/dev/null 2>&1; then ok "片2 apply 成功(trigger 掛上)"; else
  bad "片2 apply" "$(psql -qX -f "$MIG2" 2>&1 | grep -m1 ERROR | cut -c1-90)"; fi

# 🔴 **兩支 migration 2026-08-24 起是 fail-closed 的裸 `CREATE`**(不是 `CREATE OR REPLACE`)
#    ⇒ 已存在就炸。而本檔的突變節要**反覆重套** ⇒ 重套前必須先拆掉。
#    📌 這**不是為了測試而放寬 migration**,是 harness 自己做一次它文件裡寫的那個回退動作。
drop_mig()  { psql -qX -c "DROP FUNCTION IF EXISTS public.pcm_manual_refund_rail_cap(uuid)" >/dev/null 2>&1; }
drop_mig2() { psql -qX -c "DROP TRIGGER IF EXISTS trg_pcm_manual_refund_rail_cap ON public.order_manual_refunds" >/dev/null 2>&1
              psql -qX -c "DROP FUNCTION IF EXISTS public.pcm_manual_refund_rail_cap_guard()" >/dev/null 2>&1; }
# 重套 = 先拆再套(片2 綁著片1,拆片1 要連片2 一起拆再依序套回)
reapply_mig()  { drop_mig2; drop_mig; psql -qX -f "$MIG" >/dev/null 2>&1; psql -qX -f "$MIG2" >/dev/null 2>&1; }
reapply_mig2() { drop_mig2; psql -qX -f "$MIG2" >/dev/null 2>&1; }
apply_mut()    { drop_mig2; drop_mig; psql -qX -f "$1" >/dev/null 2>&1; psql -qX -f "$MIG2" >/dev/null 2>&1; }
apply_mut2()   { drop_mig2; psql -qX -f "$1" >/dev/null 2>&1; }

# ── 種資料:每一列都滿足真 CHECK(這正是第一版做不到的事)────────────────
O1=11111111-1111-1111-1111-111111111111   # 現金 + 沖銷 + 卡
O2=22222222-2222-2222-2222-222222222222   # 純刷卡(攻擊路徑那張)
O3=33333333-3333-3333-3333-333333333333   # 匯款
psql -qX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
INSERT INTO public.staff(id) VALUES ('tester');
INSERT INTO public.orders(id) VALUES ('$O1'),('$O2'),('$O3');
-- 現金收款兩筆(cash 軌:rec_trade_id/bank_reference 必空、request_id 必填)
INSERT INTO public.order_payments(id,order_id,rail,amount,received_at,actor,request_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','$O1','cash',1000,now(),'tester',gen_random_uuid()),
       ('aaaaaaaa-0000-0000-0000-000000000002','$O1','cash',1000,now(),'tester',gen_random_uuid());
-- 🔴 沖銷列:**必須指向一筆真的收款**,且三個識別欄一律空、要有理由
INSERT INTO public.order_payments(order_id,rail,amount,received_at,actor,reverses_payment_id,reversal_reason)
VALUES ('$O1','cash',-1000,now(),'tester','aaaaaaaa-0000-0000-0000-000000000002','測試沖銷');
-- 卡軌:rec_trade_id 必填
INSERT INTO public.order_payments(order_id,rail,amount,received_at,actor,rec_trade_id)
VALUES ('$O1','card',99999,now(),'tester','tp-1'),('$O2','card',18400,now(),'tester','tp-2');
-- 匯款軌:bank_reference + request_id 必填
INSERT INTO public.order_payments(order_id,rail,amount,received_at,actor,bank_reference,request_id)
VALUES ('$O3','bank_transfer',1500,now(),'tester','BANKREF-1',gen_random_uuid());
SQL
[ "$(q "select count(*) from public.order_payments")" = "6" ] \
  && ok "種了 6 筆收款列,而它們過了【真的】CHECK 與 FK" \
  || bad "種資料" "筆數不對 ⇒ 真約束擋掉了某幾筆"

echo
echo "══ 2. 驗收值(印值不印判斷)══"
eq "① 零列的單 ⇒ 0 不是 NULL"        "$(q "select coalesce(public.pcm_manual_refund_rail_cap('00000000-0000-0000-0000-000000000000')::text,'NULL')")" "0"
eq "② 🔴 純刷卡未付款單 ⇒ 0"          "$(q "select public.pcm_manual_refund_rail_cap('$O2')")" "0"
eq "③ 匯款實收 1500 ⇒ 1500"           "$(q "select public.pcm_manual_refund_rail_cap('$O3')")" "1500"
eq "④ 收1000+收1000-沖1000 ⇒ 1000"    "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "1000"
eq "⑤ 卡軌 99999 不計入(同上單)"     "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "1000"

# ⚠️ 這一筆是為了驗【上限函式的算式】,不是驗 trigger ⇒ 暫時關掉 trigger 再塞。
#    (400 <= 1000 其實過得了,這裡關掉是為了讓上下兩節【各驗各的】,不互相遮蔽。)
psql -qX -c "ALTER TABLE public.order_manual_refunds DISABLE TRIGGER trg_pcm_manual_refund_rail_cap" >/dev/null 2>&1
psql -qX -c "INSERT INTO public.order_manual_refunds(order_id,rail,refund_amount,reason,actor,occurred_at,request_id) VALUES ('$O1','cash',400,'測試','tester',now(),gen_random_uuid())" >/dev/null 2>&1
psql -qX -c "ALTER TABLE public.order_manual_refunds ENABLE TRIGGER trg_pcm_manual_refund_rail_cap" >/dev/null 2>&1
eq "⑥ 登記 400(未作廢)⇒ 600"        "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "600"
psql -qX -c "UPDATE public.order_manual_refunds SET voided_at = now(), void_reason='測試作廢', voided_by='tester' WHERE order_id='$O1'" >/dev/null 2>&1
eq "⑦ 作廢那筆 ⇒ 額度還回來 1000"      "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "1000"

echo
echo "══ 3. 權限 ══"
eq "service_role EXECUTE"   "$(q "select has_function_privilege('service_role','public.pcm_manual_refund_rail_cap(uuid)','EXECUTE')")" "t"
eq "anon 無 EXECUTE"        "$(q "select has_function_privilege('anon','public.pcm_manual_refund_rail_cap(uuid)','EXECUTE')")" "f"
eq "authenticated 無 EXECUTE" "$(q "select has_function_privilege('authenticated','public.pcm_manual_refund_rail_cap(uuid)','EXECUTE')")" "f"
eq "PUBLIC/anon ACL 筆數"   "$(q "select count(*) from pg_proc p, aclexplode(p.proacl) a where p.oid='public.pcm_manual_refund_rail_cap(uuid)'::regprocedure and (a.grantee=0 or a.grantee=(select oid from pg_roles where rolname='anon'))")" "0"

echo
echo "══ 3b. 🔴 trigger 行為(片 2/2)══"
# 此刻 O1 的 cap = 1000(那筆 400 已作廢)、O2 = 0(純刷卡)、O3 = 1500(匯款)
# ══════════════════════════════════════════════════════════════════════
# 🔴🔴 **本節的量具在 2026-08-24 被 codex 判定是壞的,這是修好的版本。**
#
# 壞法(照實寫,不含糊):原本每一格「被擋」都只問「**有沒有 error**」——
#   · `ins()`  抓不到我們那句中文 ⇒ 回空字串 ⇒ `!= "OK"` 成立 ⇒ **判 ok**
#   · 三處 UPDATE 更直接:`grep -qi error` ⇒ **連裝都沒裝**
#   ⇒ FK / CHECK / NOT NULL / 權限 / 連線斷掉,**全部都會冒充成「上限命中」**。
# 📌 **形狀**:那幾格證明的是「**有東西擋住了**」,不是「**是我們那道閘擋住了**」——
#    而它們印出來的畫面,與真的被 rail-cap 擋下**一模一樣**。
#
# ✅ 修法 = 一格「被擋」要**同時**成立兩件,少一件就不算:
#    ① SQLSTATE == `PCM01`(那道閘自己的碼,不是中文字面 —— 字面會被文案改動)
#    ② `order_manual_refunds` 的**列數沒有變**(擋下了 ≠ 沒落地)
# ══════════════════════════════════════════════════════════════════════

# 回傳 `OK`,或 psql 報的 SQLSTATE 五碼。
# 🔴 `\set VERBOSITY verbose` 才會把 SQLSTATE 印進 ERROR 那一行;少了它只有中文。
sqlstate() {
  local out
  out=$(printf '%s\n%s\n' '\set VERBOSITY verbose' "$1" | psql -qX -v ON_ERROR_STOP=1 2>&1)
  if echo "$out" | grep -q '^ERROR:'; then
    echo "$out" | sed -n 's/^ERROR:  \([A-Z0-9][A-Z0-9]*\):.*/\1/p' | head -1
  else
    echo OK
  fi
}
nrows() { q "select count(*) from public.order_manual_refunds where order_id='$1'"; }

# $1=標題 $2=要看列數的訂單 $3=SQL 〔$4=期望 SQLSTATE,預設 PCM01〕
must_block() {
  local want="${4:-PCM01}" before after code
  before=$(nrows "$2"); code=$(sqlstate "$3"); after=$(nrows "$2")
  if [ "$code" = "OK" ]; then
    bad "$1" "**放行了**"
  elif [ -z "$code" ]; then
    bad "$1" "有錯但**讀不到 SQLSTATE** ⇒ 量具壞了,本格不算數"
  elif [ "$code" != "$want" ]; then
    bad "$1" "被擋了,而 SQLSTATE=[$code] 不是 [$want] ⇒ **不是那道閘擋的,是別的東西**"
  elif [ "$before" != "$after" ]; then
    bad "$1" "SQLSTATE 對,而列數 $before → $after ⇒ **有東西落地了**"
  else
    ok "$1 ⇒ SQLSTATE=$want、列數不變($before)"
  fi
}
# $1=標題 $2=SQL
must_pass() {
  local code; code=$(sqlstate "$2")
  [ "$code" = "OK" ] && ok "$1" || bad "$1" "被擋了 [SQLSTATE=$code]"
}

# 🔴 `request_id` **必填**(`20260820021000` ADD COLUMN … NOT NULL)——
#    2026-08-24 之前本檔的 schema 漏了那支 ALTER,所以少了它照樣綠。
#    ⇒ **每一發 INSERT 在正式庫都會 23502**,而本機一路綠燈。
ins_sql() { echo "INSERT INTO public.order_manual_refunds(order_id,rail,refund_amount,reason,actor,occurred_at,request_id) VALUES ('$1','cash',$2,'測試','tester',now(),gen_random_uuid())"; }

must_block "🔴 純刷卡單退 1 元"        "$O2" "$(ins_sql "$O2" 1)"
must_pass  "匯款實收 1500 ⇒ 退 1500 放行"      "$(ins_sql "$O3" 1500)"
must_block "🔴 額度用完後再退 1 元"     "$O3" "$(ins_sql "$O3" 1)"
must_block "🔴 超過 1 元(邊界)"        "$O1" "$(ins_sql "$O1" 1001)"
must_pass  "🟢 剛好等於上限 ⇒ 放行(不是「接近就擋」)" "$(ins_sql "$O1" 1000)"

# 🔴 UPDATE 餘裕:把剛剛那筆 1000 改成 1000(原地不動)——
#    少了 `+ OLD.refund_amount` 那一項,它會把自己扣兩次而拒絕,而那是誤擋。
must_pass "UPDATE 把 1000 改成 1000 ⇒ 放行(OLD 有被加回餘裕)" \
  "UPDATE public.order_manual_refunds SET refund_amount=1000 WHERE order_id='$O1' AND voided_at IS NULL"
must_block "🔴 UPDATE 改大到 1001" "$O1" \
  "UPDATE public.order_manual_refunds SET refund_amount=1001 WHERE order_id='$O1' AND voided_at IS NULL"

# 🔴 作廢那條路【不得】被擋住
# 🔴 作廢**不是「只動 voided_at」** —— `order_manual_refunds_void_trio` 要求
#    `num_nonnulls(voided_at, void_reason, voided_by) IN (0,3)` ⇒ **三欄一起動,否則 CHECK 擋。**
#    (本檔 2026-08-24 之前的 schema 沒有這道 CHECK ⇒ 單欄作廢照樣過 ⇒ 又一格假綠。)
must_pass "🔴 作廢(voided 三欄一起動)⇒ 不被 rail-cap 擋" \
  "UPDATE public.order_manual_refunds SET voided_at=now(), void_reason='測試作廢', voided_by='tester' WHERE order_id='$O1' AND voided_at IS NULL"

# ══ 🔴 F5 鏡像格:作廢的【反向動作】——「復活」
# 一道閘只驗了「該放的有放」、沒驗「該擋的有擋」⇒ 那個綠沒有判別力。
must_pass "作廢後額度歸還 ⇒ 可再登記 1000(不誤擋)" "$(ins_sql "$O1" 1000)"
# 🔴 **這個探針第一版壞在【分母】**:第一版寫 `WHERE voided_at IS NOT NULL`,
#    而此刻 O1 上有**兩筆**已作廢的列 ⇒ 它一次動兩列,而「被擋」那一格完全看不出來。
#    ⇒ 改成**釘住一個 id**:探針要動幾列,由我指定,不由資料現況決定。
VR=$(q "select id::text from public.order_manual_refunds
         where order_id='$O1' and voided_at is not null and refund_amount=1000 limit 1")
[ -n "$VR" ] && ok "釘住要復活的那一列 [$VR]" || bad "釘 id" "**找不到剛作廢的那筆 1000 ⇒ 下面兩格作廢**"
UNVOID_SQL="UPDATE public.order_manual_refunds SET voided_at=NULL, void_reason=NULL, voided_by=NULL WHERE id='$VR'"
unvoid()  { sqlstate "$UNVOID_SQL"; }
revoid()  { psql -qX -c "UPDATE public.order_manual_refunds SET voided_at=now(), void_reason='測試作廢', voided_by='tester' WHERE id='$VR'" >/dev/null 2>&1; }
must_block "🔴 復活已作廢的那筆(否則總退 2000 / 實收 1000)" "$O1" "$UNVOID_SQL"
eq "復活被擋之後 cap 仍是 0(沒有留下半套狀態)" "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "0"

# ══ 🔴 量具自檢:這把新尺要能【分辨】兩種錯,否則它只是換一個寫法的舊尺 ══
#
# 🔴🔴 **第一版的自檢自己就錯了,而它【當場紅了】—— 留著,因為那個紅有內容。**
#   第一版餵「不存在的 order_id」期待 FK 違反 `23503`,拿到的卻是 `PCM01`。
#   成因不是尺壞,是**我對執行順序的圖是錯的**:
#     BEFORE trigger 在 FK / CHECK / NOT NULL **之前**跑
#     ⇒ 不存在的單 ⇒ cap 算出 0 ⇒ 1 > 0 ⇒ **這道閘先擋下,FK 永遠輪不到**。
#   📌 **順帶一個真結論**:對這張表,**FK 違反在有金額時是看不到的** —— 先被上限擋住。
#      (所以正式庫上「捏一個假 order_id」也插不進來,而擋它的不是 FK。)
#
# ✅ 改用一個**會穿過這道閘、然後在後面失敗**的探針,那才問得到「尺分不分得開」:
#    金額 0 ⇒ `0 > cap(0)` 不成立 ⇒ **trigger 放行** ⇒ 撞上建表的 `refund_amount > 0` CHECK
#    ⇒ 期望 `23514`。舊尺在這裡會說「擋下了 ✅」,而那是**反過來的答案**。
# ══ 🔴 換單:把 A 單一筆已退的列搬到零實收的 B 單 ══(2026-08-24 codex must-fix)
#   這**不是併發** —— 單一交易裡的一個合法 UPDATE,一個人就做得到。
#   少了 `OLD.order_id = NEW.order_id` 那一項 ⇒ cap 算 B(=0)而餘裕加回 A 那筆 ⇒ 放行。
MOVE_ID=$(q "select id::text from public.order_manual_refunds
              where order_id='$O1' and voided_at is null and refund_amount=1000 limit 1")
[ -n "$MOVE_ID" ] && ok "釘住要搬的那一列 [$MOVE_ID]" || bad "釘搬移 id" "**找不到 O1 上生效的那筆 1000**"
must_block "🔴 把已退 1000 的列搬到零實收的 O2" "$O2" \
  "UPDATE public.order_manual_refunds SET order_id='$O2' WHERE id='$MOVE_ID'"
eq "搬移被擋之後那列仍在 O1" \
  "$(q "select count(*) from public.order_manual_refunds where id='$MOVE_ID' and order_id='$O1'")" "1"

# 3b-DELETE:2026-08-24 R3 F2。與「作廢後復活」同一族的第二個成員 ——
#   刪掉一筆退款登記 ⇒ 額度憑空回來,而且【零痕跡】(作廢至少留 voided_at)。
DEL_ID=$(q "select id::text from public.order_manual_refunds where order_id='$O1' limit 1")
[ -n "$DEL_ID" ] && ok "釘住要刪的那一列 [$DEL_ID]" || bad "釘刪除 id" "**O1 上一列都沒有**"
must_block "🔴 DELETE 一筆退款登記 ⇒ 被擋" "$O1" \
  "DELETE FROM public.order_manual_refunds WHERE id='$DEL_ID'" "PCM03"
eq "被擋之後那一列還在" \
  "$(q "select count(*) from public.order_manual_refunds where id='$DEL_ID'")" "1"
# 🔴 正對照:**作廢那條路仍然走得通** —— 否則這道只是把功能關掉,不是把洞補起來。
must_pass "🟢 正對照:作廢(三欄一起動)仍放行 ⇒ 不是把功能關掉" \
  "UPDATE public.order_manual_refunds SET voided_at=now(), void_reason='測試作廢2', voided_by='tester' WHERE id='$DEL_ID' AND voided_at IS NULL"

CODE_CHK=$(sqlstate "$(ins_sql "$O1" 0)")
[ "$CODE_CHK" = "23514" ] \
  && ok "🔴 尺的自檢:穿過閘之後撞 CHECK ⇒ [23514] 不是 PCM01 ⇒ 兩種錯分得開" \
  || bad "尺的自檢" "餵一個該撞 CHECK 的輸入卻拿到 [$CODE_CHK] ⇒ **本節所有「被擋」都不算數**"
# 🔴 而反方向也要一發:一個**確定是這道閘**的輸入必須回 PCM01 ——
#    只驗「分得出別的錯」的話,一把「什麼都回 23514」的壞尺會照樣過上面那格。
CODE_CAP=$(sqlstate "$(ins_sql "$O2" 1)")
[ "$CODE_CAP" = "PCM01" ] \
  && ok "🔴 尺的自檢(反方向):確定命中上限的輸入回 [PCM01]" \
  || bad "尺的自檢(反方向)" "拿到 [$CODE_CAP] ⇒ 尺讀不到我們的碼"

echo
echo "══ 3d. 🔴 前置閘與 fail-closed:它們【該擋的時候會擋嗎】══"
# 這一節不是驗功能,是驗**那些新加的斷言不是裝飾**。每一格都要它真的炸。
# 🔴 第一版這裡用 `grep -oE '#866[^"]{0,52}'` 取訊息 —— **它把要比對的關鍵字截掉了**,
#    於是兩格報「重套沒炸」,而閘其實**炸得好好的**。
#    📌 又一次:**紅的是我的尺,不是被測的東西**。⇒ 比對用【完整輸出】,顯示才截斷。
gate_out() { psql -qX -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
gate_show() { echo "$1" | grep -m1 -oE '#866.{0,40}'; }

# (a) fail-closed:函式已存在 ⇒ 重套必須炸(而不是靜靜覆寫)
E=$(gate_out "$MIG")
case "$E" in *已存在*) ok "🔴 片1 重套 ⇒ 被前置閘擋下 [$(gate_show "$E")]";; *) bad "片1 fail-closed" "重套沒炸 ⇒ **它會靜靜覆寫**";; esac
E=$(gate_out "$MIG2")
case "$E" in *已存在*) ok "🔴 片2 重套 ⇒ 被前置閘擋下 [$(gate_show "$E")]";; *) bad "片2 fail-closed" "重套沒炸";; esac

# (b) 承重約束真的被驗:拆掉 void_trio ⇒ 片1 前置閘必須炸
drop_mig2; drop_mig
psql -qX -c "ALTER TABLE public.order_manual_refunds DROP CONSTRAINT order_manual_refunds_void_trio" >/dev/null 2>&1
# 先把還原用的 trio.sql 切出來(逐字從真 migration,不重打)—— (c) 也要用它
python3 - "$REPO/supabase/migrations/20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql" "$PGDIR/trio.sql" <<'PY'
import sys, re, io
src = re.sub(r'--[^\n]*', '', io.open(sys.argv[1], encoding='utf-8').read())
m = re.search(r'ALTER\s+TABLE\s+public\.order_manual_refunds\s+ADD\s+CONSTRAINT\s+order_manual_refunds_void_trio[^;]*;', src, re.S)
assert m, 'anchor'
io.open(sys.argv[2], 'w', encoding='utf-8').write(m.group(0))
PY
E=$(gate_out "$MIG")
case "$E" in *void_trio*) ok "🔴 拆掉 void_trio ⇒ 片1 前置閘擋下 [$(gate_show "$E")]";; *) bad "void_trio 前置閘" "沒擋 ⇒ **那道斷言是裝飾**";; esac
# (c) F4 的承重件:拆掉 refund_amount 的 NOT NULL ⇒ 片2 前置閘必須炸
# 🔴 **先把片1 套回去** —— 上一格把兩支都拆了,而片2 的【第一道】前置閘是「片1 在不在」
#    ⇒ 不先套回去,炸的是那一道,訊息根本不是我們要比對的那句。
#    📌 又一次「紅了,但紅在別的地方」—— 本格第一版就是這樣報「沒擋」的。
psql -qX -f "$PGDIR/trio.sql" >/dev/null 2>&1
psql -qX -f "$MIG" >/dev/null 2>&1
psql -qX -c "ALTER TABLE public.order_manual_refunds ALTER COLUMN refund_amount DROP NOT NULL" >/dev/null 2>&1
E=$(gate_out "$MIG2")
case "$E" in *"不是 NOT NULL"*) ok "🔴 拆掉 refund_amount NOT NULL ⇒ 片2 前置閘擋下 [$(gate_show "$E")]";; *) bad "NOT NULL 前置閘" "沒擋 ⇒ **那道斷言是裝飾,而 NULL 金額會靜靜放行**";; esac
psql -qX -c "ALTER TABLE public.order_manual_refunds ALTER COLUMN refund_amount SET NOT NULL" >/dev/null 2>&1

# 還原:約束與兩支 migration 都回去
psql -qX -f "$PGDIR/trio.sql" >/dev/null 2>&1
psql -qX -f "$MIG" >/dev/null 2>&1; psql -qX -f "$MIG2" >/dev/null 2>&1
eq "還原:兩支都套回去了" "$(q "select count(*) from pg_proc where proname in ('pcm_manual_refund_rail_cap','pcm_manual_refund_rail_cap_guard')")" "2"
eq "還原:void_trio 回來了" "$(q "select count(*) from pg_constraint where conname='order_manual_refunds_void_trio'")" "1"

echo
echo "══ 4. 🔴 突變:每一個口徑都要證明它承重 ══"
# 🔴 **判準是「突變前後的值不同」,不是寫死一個數字。**
#    第一版寫死預期值,而上面 3b 那節會改動資料 ⇒ 期望值過期 ⇒ 報成「口徑不承重」,
#    **而實際上它承重得好好的**。⇒ 寫死的期望值把「資料變了」誤報成「碼壞了」。
mutate_and_probe() { # $1=標題 $2=old $3=new $4=量哪張單 $5=(保留,不再使用)
  local tmp="$PGDIR/mut.sql"
  python3 - "$MIG" "$tmp" "$2" "$3" <<'PY' || { echo "  🔴 anchor 失敗"; return; }
import sys, io
src, dst, old, new = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = io.open(src, encoding='utf-8').read()
assert s.count(old) == 1, f"anchor 命中 {s.count(old)} 次,不是 1"
io.open(dst, 'w', encoding='utf-8').write(s.replace(old, new))
PY
  local before; before=$(q "select coalesce(public.pcm_manual_refund_rail_cap('$4')::text,'NULL')")
  apply_mut "$tmp"
  local got; got=$(q "select coalesce(public.pcm_manual_refund_rail_cap('$4')::text,'NULL')")
  reapply_mig   # 還原
  local after; after=$(q "select coalesce(public.pcm_manual_refund_rail_cap('$4')::text,'NULL')")
  if [ "$got" = "$before" ]; then
    bad "$1" "突變前後都是 [$before] ⇒ **那個口徑不承重,或突變沒套上**"
  elif [ "$after" != "$before" ]; then
    bad "$1" "還原後是 [$after] 而突變前是 [$before] ⇒ **還原沒回去,本發作廢**"
  else
    ok "$1 ⇒ [$before] → [$got] → 還原 [$after](證明那個口徑承重)"
  fi
}

mutate_and_probe "M1 拿掉 voided_at IS NULL" \
  "               AND m.voided_at IS NULL), 0)::bigint;" "               ), 0)::bigint;" "$O1" "600"
mutate_and_probe "M2 拿掉 rail 篩選(卡軌被算進來)" \
  "               AND p.rail IN ('bank_transfer', 'cash')), 0)::bigint" "               ), 0)::bigint" "$O2" "18400"
mutate_and_probe "M3 拿掉收款側 COALESCE(零列變 NULL)" \
  "  SELECT COALESCE(
           (SELECT SUM(p.amount)
              FROM public.order_payments p
             WHERE p.order_id = p_order_id
               AND p.rail IN ('bank_transfer', 'cash')), 0)::bigint" \
  "  SELECT (SELECT SUM(p.amount)
              FROM public.order_payments p
             WHERE p.order_id = p_order_id
               AND p.rail IN ('bank_transfer', 'cash'))::bigint" \
  "00000000-0000-0000-0000-000000000000" "NULL"

# ── M4 🔴 修法本身要承重:把 `OF refund_amount` **裝回去**,復活那條路必須重新打開 ──
#    這一發不是量函式的值,是量 trigger 的**觸發面** ⇒ 用另一套探針,不共用 mutate_and_probe。
#    📌 判準同上:比對突變前後,不寫死期望值。
cap_before=$(q "select public.pcm_manual_refund_rail_cap('$O1')")
python3 - "$MIG2" "$PGDIR/mut2.sql" <<'PY' && {
import sys, io
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
# 🔴 anchor 在 2026-08-24 過期過一次:trigger 那一行加了 `OR DELETE`(F2)
#    ⇒ 舊 anchor 命中 0 ⇒ **本格當場報 anchor 失敗**。那個 count==1 斷言又擋下一次。
old = "  BEFORE INSERT OR UPDATE OR DELETE ON public.order_manual_refunds"
assert s.count(old) == 1, f"anchor 命中 {s.count(old)} 次,不是 1"
io.open(dst, 'w', encoding='utf-8').write(
    s.replace(old, "  BEFORE INSERT OR UPDATE OF refund_amount OR DELETE ON public.order_manual_refunds"))
PY
  apply_mut2 "$PGDIR/mut2.sql"
  out=$(unvoid)
  reapply_mig2                                                           # 還原 trigger
  cap_mut=$(q "select public.pcm_manual_refund_rail_cap('$O1')")
  revoid
  cap_after=$(q "select public.pcm_manual_refund_rail_cap('$O1')")
  # 🔴 **這一格差點被我自己改壞**:`unvoid()` 原本回 psql 的原始輸出,這裡用 `grep -qi error` 判。
  #    我把 `unvoid()` 改成回 **SQLSTATE** 之後,回傳值再也不含 "error" 這個字
  #    ⇒ 這個 `grep` **恆為 false** ⇒「仍然被擋」那條分支變成死碼,而 M4 照樣印綠。
  #    📌 **改一個 helper 的回傳合約,消費端不會報錯,它會安靜地換一個意思。**
  #       (救回它的是下面那兩格 cap 比對 —— 一格壞掉時,旁邊還有另一種證據。)
  if [ "$out" != "OK" ]; then
    bad "M4 裝回 OF refund_amount" "復活【仍然】被擋(SQLSTATE=$out)⇒ **那不是洞源,F1 的診斷要重看**"
  elif [ "$cap_mut" = "$cap_before" ]; then
    bad "M4 裝回 OF refund_amount" "突變前後 cap 都是 [$cap_before] ⇒ **突變沒套上**"
  elif [ "$cap_after" != "$cap_before" ]; then
    bad "M4 裝回 OF refund_amount" "還原後 [$cap_after] 而突變前 [$cap_before] ⇒ **還原沒回去,本發作廢**"
  else
    ok "M4 裝回 OF refund_amount ⇒ 復活放行、cap [$cap_before] → [$cap_mut] → 還原 [$cap_after](證明拿掉它承重)"
  fi
} || bad "M4 anchor" "改不到那一行"

# ── M5 🔴 換單那個修法要承重:拿掉 `OLD.order_id = NEW.order_id` ⇒ 搬移必須放行 ──
python3 - "$MIG2" "$PGDIR/mut3.sql" <<'PY' && {
import sys, io
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
old = "  IF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL AND OLD.order_id = NEW.order_id THEN"
assert s.count(old) == 1, f"anchor 命中 {s.count(old)} 次,不是 1"
io.open(dst, 'w', encoding='utf-8').write(
    s.replace(old, "  IF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL THEN"))
PY
  apply_mut2 "$PGDIR/mut3.sql"
  code_mut=$(sqlstate "UPDATE public.order_manual_refunds SET order_id='$O2' WHERE id='$MOVE_ID'")
  reapply_mig2                                                          # 還原 trigger
  psql -qX -c "UPDATE public.order_manual_refunds SET order_id='$O1' WHERE id='$MOVE_ID'" >/dev/null 2>&1
  back=$(q "select count(*) from public.order_manual_refunds where id='$MOVE_ID' and order_id='$O1'")
  if [ "$code_mut" != "OK" ]; then
    bad "M5 拿掉 order_id 那一項" "搬移【仍然】被擋(SQLSTATE=$code_mut)⇒ **那一項不承重,診斷要重看**"
  elif [ "$back" != "1" ]; then
    bad "M5 拿掉 order_id 那一項" "搬回去失敗(仍在 O1 的筆數=$back)⇒ **還原沒回去,本發作廢**"
  else
    ok "M5 拿掉 order_id 那一項 ⇒ 搬移【放行】⇒ 還原後那列回到 O1(證明那一項承重)"
  fi
} || bad "M5 anchor" "改不到那一行"

# ── M6 🔴 DELETE 那道分支要承重:拿掉它 ⇒ 刪除必須放行 ──
python3 - "$MIG2" "$PGDIR/mut4.sql" <<'PY' && {
import sys, io
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()
old = "  IF TG_OP = 'DELETE' THEN"
assert s.count(old) == 1, f"anchor 命中 {s.count(old)} 次,不是 1"
io.open(dst, 'w', encoding='utf-8').write(s.replace(old, "  IF FALSE THEN"))
PY
  n_before=$(q "select count(*) from public.order_manual_refunds where order_id='$O1'")
  apply_mut2 "$PGDIR/mut4.sql"
  code_del=$(sqlstate "DELETE FROM public.order_manual_refunds WHERE id='$DEL_ID'")
  n_mut=$(q "select count(*) from public.order_manual_refunds where order_id='$O1'")
  reapply_mig2
  # 🔴🔴 **本格第一版的期望是錯的,而它錯得有價值 —— 留著,因為結論比原本要驗的更重要。**
  #
  # 第一版期望:拿掉 DELETE 分支 ⇒ 刪除「放行」⇒ 列數變少。**實測不是。**
  #   實測:`code_del=OK`(沒有任何錯誤)**而列數完全沒變**。
  # 成因(順著 plpgsql 的規則走一遍):
  #   DELETE trigger 裡 `NEW` 是 NULL ⇒ `NEW.voided_at IS NOT NULL` 為 false ⇒ 往下走
  #   ⇒ `NEW.order_id` 是 NULL ⇒ cap 算出 0 ⇒ `NEW.refund_amount > 0` 是 `NULL > 0` = NULL
  #   ⇒ `IF` 不成立 ⇒ 走到最後 `RETURN NEW`,而 **NEW 是 NULL**
  #   ⇒ 🔴 **BEFORE ROW trigger 回 NULL = 取消這個動作** —— 而它**不報錯**。
  #
  # ⇒ **所以沒有那道分支時,這張表的 DELETE 是「靜靜地什麼都沒發生」。**
  #   那比「擋下來」更糟:操作的人以為刪掉了,而資料還在;
  #   也比「放行」更難查:沒有錯誤訊息、沒有 SQLSTATE、沒有任何痕跡。
  # 📌 **這道分支承重的方式,不是「把放行變成擋下」,是「把【沉默】變成【一句說得出理由的拒絕】」。**
  if [ "$code_del" = "OK" ] && [ "$n_mut" = "$n_before" ]; then
    ok "M6 拿掉 DELETE 分支 ⇒ **零錯誤而零效果**(列數 $n_before 不變)⇒ 證明那道分支把沉默換成 PCM03"
  elif [ "$code_del" != "OK" ]; then
    bad "M6 拿掉 DELETE 分支" "拿掉之後仍丟錯 [$code_del] ⇒ **擋它的不是那道分支,診斷要重看**"
  else
    bad "M6 拿掉 DELETE 分支" "列數 $n_before → $n_mut 真的刪掉了 ⇒ **與實測的『靜靜取消』不符,重新診斷**"
  fi
} || bad "M6 anchor" "改不到那一行"

echo
eq "還原後 ④ 回到 0(O1 一筆生效的 1000 對上實收 1000)" "$(q "select public.pcm_manual_refund_rail_cap('$O1')")" "0"

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL ══"
[ "$FAIL" -eq 0 ] || exit 1
