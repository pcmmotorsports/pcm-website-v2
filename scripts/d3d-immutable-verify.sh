#!/usr/bin/env bash
# ============================================================
# `D3-d` 帳不塗改守門的驗證 harness(拋棄式 PG,零 DB、零網路、零正式庫)
# ============================================================
# 標的 = supabase/migrations/20260830050000_m4b_e10_d3d_manual_refund_immutable.sql
# 用法 = bash scripts/d3d-immutable-verify.sh
#
# 🔴🔴 **它【不在 CI 跑】** —— 需要一台本機 postgres(自己起、自己收),CI 上沒有
#    ⇒ **沒有任何東西會在你改壞那支 trigger 的時候自動變紅。**
#    ⇒ 動 `20260830050000` 的人:**你要自己跑這一支。**
#
# 🔴 **為什麼這支存在**:那支 migration 自帶的 A1-A6 涵蓋的是**結構**——
#    兩支 trigger 的【掛上了 / 事件位元 / 綁對函式 / 沒有 WHEN / ENABLE ALWAYS】,
#    兩支函式的【invoker / search_path 釘住 / 五個角色皆無 EXECUTE】。
#    ⚠️ ~~上一版這裡寫「只涵蓋…ACL 非 NULL」~~ —— **那是 codex R1 之前的舊描述, 已過期**
#       (現在 A6 是逐角色 `has_function_privilege`, 不是 `proacl IS NOT NULL`)。
#    🔴 **而它們一個字都不涵蓋【行為】** ⇒ 「它會擋」與「它恆綠」在 A1-A6 底下仍印同一個字。
#
# 🔴 **schema 逐字切自真 migration,一個字不重打**(照 `scripts/866-rail-cap-verify.sh`
#    2026-08-24 codex must-fix 的做法):我自己造的替身只會照我理解的樣子回答我。
#    ⚠️ 而這仍有限度:FK 指到的 `orders` 是最小 stub;沒有 RLS、沒有正式庫的 GRANT、
#      沒有既有資料 ⇒ **本檔過 != 正式庫過**
#      (`docs/runbooks/throwaway-postgres-for-migration-verification.md`)。
# ============================================================
set -uo pipefail
export LC_ALL=C

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG_CAP="$REPO/supabase/migrations/20260824010000_m4b_866_manual_refund_rail_cap.sql"
MIG_CAP2="$REPO/supabase/migrations/20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql"
MIG_D3D="$REPO/supabase/migrations/20260830050000_m4b_e10_d3d_manual_refund_immutable.sql"
SRC_PAY="$REPO/supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql"
SRC_MR="$REPO/supabase/migrations/20260820010000_m4b_manual_refunds.sql"
SRC_BLANK="$REPO/supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql"

for f in "$MIG_CAP" "$MIG_CAP2" "$MIG_D3D" "$SRC_PAY" "$SRC_MR" "$SRC_BLANK"; do
  test -f "$f" || { printf '🔴 找不到 %s\n' "$f"; exit 1; }
done
command -v initdb >/dev/null || { printf '🔴 找不到 initdb(brew install postgresql@17)\n'; exit 1; }

PGDIR=$(mktemp -d /tmp/pcd3dXXXX)
export PGHOST="$PGDIR" PGPORT=54873 PGDATABASE=postgres PGUSER=probe
cleanup() { pg_ctl -D "$PGDIR/data" stop -m immediate >/dev/null 2>&1; rm -rf "$PGDIR"; }
trap cleanup EXIT

initdb -D "$PGDIR/data" -U probe --encoding=UTF8 --locale=C >/dev/null 2>&1 || { printf '🔴 initdb 失敗\n'; exit 1; }
pg_ctl -D "$PGDIR/data" -o "-k $PGDIR -p 54873 -c listen_addresses=''" -l "$PGDIR/log" start >/dev/null 2>&1
sleep 2
psql -qc "select 1" >/dev/null 2>&1 || { printf '🔴 PG 起不來\n'; tail -5 "$PGDIR/log"; exit 1; }

printf '══ 本次跑在:%s ══\n' "$(postgres --version 2>/dev/null || psql --version)"
printf '   Supabase 正式庫版本【未確認】⇒ 與版本有關的結論不自動適用\n'

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  🔴 FAIL %s — %s\n' "$1" "$2"; }
q()   { psql -qtAX -c "$1" 2>&1; }

# 回傳 `OK` 或 psql 報的 SQLSTATE 五碼。
# 🔴 `\set VERBOSITY verbose` 才會把 SQLSTATE 印進 ERROR 那一行。
# 🔴🔴 **這支量具自己有過一個【只在某一種輸入上瞎掉】的版本, 留著當標本。**
#    舊版錨在行首:`grep -q '^ERROR:'`。
#    · 用 `-c "SQL"` 跑 ⇒ psql 印 `ERROR:  P2B45: …`      ⇒ 抓得到
#    · 用 `\i <檔>` 跑 ⇒ psql 印 `psql:/path/x.sql:110: ERROR:  P2B47: …` ⇒ **抓不到**
#    ⇒ 那一格回 `OK`, 而 `OK` 的意思是「**沒有錯**」——
#      於是「守門沒有叫」與「我看不見它叫」印**同一個字**, 而我當時判成前者、去看 migration。
#    📌 **一把尺在 19 個輸入上都對, 不代表它在第 20 個上還是同一把尺。**
#      (而它瞎掉的那一種, 恰好是本檔唯一用來驗【欄位分母守門】的那一種。)
sqlstate() {
  local out
  out=$(printf '%s\n%s\n' '\set VERBOSITY verbose' "$1" | psql -qX -v ON_ERROR_STOP=1 2>&1)
  if printf '%s' "$out" | grep -qE '(^|:[0-9]+: )ERROR:'; then
    printf '%s' "$out" | sed -nE 's/.*ERROR:  ([A-Z0-9]{5}):.*/\1/p' | head -1
  else
    printf 'OK'
  fi
}

# ══ schema:機械掃全部 migration 的 ALTER TABLE,不用位置式 ═══════════════
cut_table() { sed -n "/^CREATE TABLE $1 (/,/^);/p" "$2"; }
{
  # 🔴 `authenticator` 也要建 —— 本片的 REVOKE 點名了它(照 op2b 家法),
  #    而 866 那支 harness 沒有建它(它的標的沒有 REVOKE 到 authenticator)。
  #    📌 **抄一份 harness 的骨架時,抄到的是【它的標的需要什麼】,不是【我的標的需要什麼】。**
  #       這一發是本 harness 自己在第一次跑就抓到的:D3-d apply 直接紅在 REVOKE 那一行。
  printf 'CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator;\n'
  printf 'CREATE TABLE public.orders (id uuid PRIMARY KEY);\n'
  printf 'CREATE TABLE public.staff  (id text PRIMARY KEY);\n'
  cut_table "public.order_payments" "$SRC_PAY"
  cut_table "public.order_manual_refunds" "$SRC_MR"
  sed -n '/^CREATE FUNCTION public.pcm_b2_is_blank(/,/^\$fn\$;/p' "$SRC_BLANK"
  python3 - "$REPO/supabase/migrations" <<'PY'
import sys, re, glob, os
tgt = re.compile(
    r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?'
    r'public\.(?:order_manual_refunds|order_payments)\b[^;]*;', re.I | re.S)
dollar = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*|)\$.*?\$\1\$', re.S)
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.sql'))):
    src = open(f, encoding='utf-8').read()
    src = dollar.sub('', src)
    src = re.sub(r'--[^\n]*', '', src)
    for m in tgt.finditer(src):
        stmt = m.group(0)
        # 🔴 **只排除【整句都是 trigger 佈線】的語句**,不是「句中出現 ENABLE TRIGGER 就丟」。
        #    用途:本掃描是要【重建表的形狀】,不重播 trigger 接線;
        #    而 D3-d 的 `ALTER TABLE … ENABLE ALWAYS TRIGGER …` 若原樣接進 schema.sql,
        #    trigger 還不存在 ⇒ 整份 schema 套不起來。
        #    🔴🔴 **而第一版的過濾器【太寬】(codex R2 must-fix #4)**:
        #      `ALTER TABLE x ADD COLUMN c text, ENABLE TRIGGER foo;` 是**合法的一句兩動作**,
        #      舊寫法會把它整句 `continue` ⇒ **連那個欄一起漏掉, 而 schema 照樣印綠。**
        #      📌 一個為了修「多收了東西」而加的過濾器, 它的失效方式是【它少收了東西】——
        #         而少收的那一側**不會有人來告訴你**(schema 套得起來, 只是少一欄)。
        #    ⇒ 改成:動作清單**每一項都是** ENABLE/DISABLE … TRIGGER 才跳過。
        _m = re.match(r'\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?\S+\s+(.*);\s*$',
                      stmt, re.I | re.S)
        if _m:
            _acts = [a.strip() for a in _m.group(1).split(',')]
            if _acts and all(re.match(r'(EN|DIS)ABLE\b.*\bTRIGGER\b', a, re.I) for a in _acts):
                continue
        print(f"-- from {os.path.basename(f)}")
        print(stmt)
PY
} > "$PGDIR/schema.sql"

for token in "REFERENCES public.orders(id)" "voided_at" "request_id uuid NOT NULL" \
             "order_manual_refunds_void_trio" "FUNCTION public.pcm_b2_is_blank"; do
  grep -qF "$token" "$PGDIR/schema.sql" || { printf '🔴 切出來的 schema 少了 [%s] ⇒ 本次結果作廢\n' "$token"; exit 1; }
done
SCHEMA_OUT=$(psql -qX -v ON_ERROR_STOP=1 -f "$PGDIR/schema.sql" 2>&1) \
  || { printf '🔴 真 schema 套不起來(第一發輸出)\n'; printf '%s' "$SCHEMA_OUT" | grep -i error | head -4; exit 1; }
printf '══ schema 逐字切自真 migration,承重約束自檢通過 ══\n'

printf '\n══ 0. 量具本身分得出兩個世界嗎?(先驗尺, 再用它量)══\n'
# 🔴🔴 **R3 對抗審查 F8:這一節原本排在【最後】** ——
#    前面每一格都是用一把**還沒被驗過的尺**量的。FAIL!=0 會 exit 1 所以結論不會假綠,
#    而尺壞掉時它仍會先印出一整排 ok。⇒ 移到最前面。
# 🔴 codex R1 nit #9:更早的版本這裡是「量到的碼 != 一個現造的隨機字面」——
#    那是【恆綠格】(守門有效時 `P2B45 != 隨機`、失效時 `OK != 隨機`, 兩個世界都印 ok)。
#    ⇒ 改成量 `sqlstate()` 這把尺自己:餵一句必定成功與一句必定失敗且碼已知的 SQL。
S_OK=$(sqlstate "SELECT 1")
S_ERR=$(sqlstate "SELECT 1/0")
[ "$S_OK" = "OK" ] && ok "量具:必定成功的 SQL ⇒ OK" || bad "量具(成功側)" "得到 [$S_OK] 期望 OK"
[ "$S_ERR" = "22012" ] && ok "量具:除以零 ⇒ 22012(它真的抽得到 SQLSTATE, 不是只會回 OK)" \
  || bad "量具(失敗側)" "得到 [$S_ERR] 期望 22012"
[ "$S_OK" != "$S_ERR" ] && ok "量具:兩個世界印不同的東西" || bad "量具" "兩個世界印同一個字 ⇒ 下面每一格都不算數"

printf '\n══ 1. 套 migration ══\n'
psql -qX -v ON_ERROR_STOP=1 -f "$MIG_CAP"  >/dev/null 2>&1 && ok "866 片1(算式)" || bad "866 片1" "$(psql -qX -f "$MIG_CAP" 2>&1 | grep -m1 ERROR | cut -c1-90)"
psql -qX -v ON_ERROR_STOP=1 -f "$MIG_CAP2" >/dev/null 2>&1 && ok "866 片2(cap trigger)" || bad "866 片2" "$(psql -qX -f "$MIG_CAP2" 2>&1 | grep -m1 ERROR | cut -c1-90)"
psql -qX -v ON_ERROR_STOP=1 -f "$MIG_D3D"  >/dev/null 2>&1 && ok "D3-d apply(A1-A6 同交易通過)" || bad "D3-d apply" "$(psql -qX -f "$MIG_D3D" 2>&1 | grep -m1 ERROR | cut -c1-120)"

# 🔴 發火序:同 timing 依名稱字母序 ⇒ 本片必須排在 cap trigger 之前
FIRST=$(q "select tgname from pg_trigger where tgrelid='public.order_manual_refunds'::regclass and not tgisinternal order by tgname limit 1")
[ "$FIRST" = "order_manual_refunds_immutable_bu" ] \
  && ok "發火序:D3-d 排在 cap trigger 之前 [$FIRST]" \
  || bad "發火序" "第一個是 [$FIRST] ⇒ 塗改會先撞到額度檢查, 錯誤訊息會指錯成因"

# ══ 2. 種資料 ═════════════════════════════════════════════════════════════
O1=11111111-1111-1111-1111-111111111111
# 🔴 第二張單:給「改 order_id 到一個【真的別的值】」那一格用的。
#    第一版只驗了「改成同一個值 ⇒ 放行」, 而那**不是不可變負測**(codex must-fix #6)。
O2=22222222-2222-2222-2222-222222222222
# 🔴 `order_payments.actor` 有 FK 指到 `staff(id)`(`20260810100000:243`)——
#    少了它就是 23503 foreign_key_violation, 而**那個碼不會告訴你缺的是 staff**。
#    (`order_manual_refunds.actor` 沒有這個 FK, 所以只有收款那一發需要。)
SEED_S=$(sqlstate "INSERT INTO public.staff(id) VALUES ('tester')")
SEED_O=$(sqlstate "INSERT INTO public.orders(id) VALUES ('$O1'), ('$O2')")
# 🔴 **O2 也要有實收** —— 否則「把 refund 的 order_id 改到 O2」會讓 O2 的額度變負,
#    當場撞到 **rail-cap 那道閘(PCM01)**, 而不是本片的 P2B45。
#    ⇒ 第 7 節拔掉本片的 trigger 之後那一格仍然紅, 而**紅的理由與本片無關**。
#    📌 **一個負對照若被【別人的守門】擋住, 它證明不了「擋它的是我」。**
#      (這一發是第 7 節逐欄突變之後才顯形的 —— 只突變兩格的版本看不到它。)
SEED_P=$(sqlstate "INSERT INTO public.order_payments(order_id,rail,amount,received_at,actor,request_id)
                   VALUES ('$O1','cash',5000,now(),'tester',gen_random_uuid()),
                          ('$O2','cash',5000,now(),'tester',gen_random_uuid())")
# 🔴🔴 **種資料要當場驗,不能吞掉錯誤。**
#    第一版我把兩發 INSERT 都 `>/dev/null 2>&1` 了 ⇒ 實收那一筆失敗、額度算出來是 0
#    ⇒ 後面每一格的登記都被額度閘擋掉 ⇒ `$R1` 裡裝的是一段錯誤訊息不是 uuid
#    ⇒ **19 格同時紅,而真正壞掉的是第 0 步。**
#    📌 **一個沒有被驗過的前置步驟,會讓它下游的每一格都變成雜訊 ——
#       而雜訊看起來像「這片做壞了」,不像「我沒種進去」。**
CAP0=$(q "select public.pcm_manual_refund_rail_cap('$O1')")
if [ "$SEED_S" = "OK" ] && [ "$SEED_O" = "OK" ] && [ "$SEED_P" = "OK" ] && [ "$CAP0" = "5000" ]; then
  ok "種資料:staff + 訂單 + 實收 5000 都進去了, 額度算出 5000"
else
  bad "種資料" "staff=[$SEED_S] orders=[$SEED_O] payments=[$SEED_P] 額度=[$CAP0] ⇒ **前置沒成立, 下面每一格都不算數**"
  printf '  🛑 前置失敗 ⇒ 停在這裡, 不印一整排會誤導人的紅。\n'
  printf '\n══ 結果:PASS=%s FAIL=%s(前置失敗)══\n' "$PASS" "$FAIL"
  exit 1
fi

mk_row() {  # mk_row <金額> ⇒ 回傳新列的 id
  q "INSERT INTO public.order_manual_refunds(order_id,rail,refund_amount,reason,actor,occurred_at,request_id)
     VALUES ('$O1','cash',$1,'測試','tester',now(),gen_random_uuid()) RETURNING id"
}

printf '\n══ 3. 現行流程還走得通嗎?(正對照)══\n'
R1=$(mk_row 100)
[ ${#R1} -eq 36 ] && ok "INSERT 一筆新的(= 本片叫人去走的那條路)" || bad "INSERT" "拿到 [$R1]"
CODE=$(sqlstate "UPDATE public.order_manual_refunds SET voided_at=now(), void_reason='登錯了', voided_by='tester' WHERE id='$R1'")
[ "$CODE" = "OK" ] && ok "作廢(NULL ⇒ 非 NULL)⇒ 放行" || bad "作廢被擋了" "SQLSTATE=$CODE ⇒ **本片弄壞了現行流程**"

printf '\n══ 4. 作廢是不是終態?(期望 P2B46)══\n'
for t in "復活:SET voided_at=NULL, void_reason=NULL, voided_by=NULL" \
         "只清 voided_at:SET voided_at=NULL" \
         "改作廢理由:SET void_reason='改一下'" \
         "改作廢的人:SET voided_by='someone_else'"; do
  name=${t%%:*}; frag=${t#*:}
  CODE=$(sqlstate "UPDATE public.order_manual_refunds $frag WHERE id='$R1'")
  [ "$CODE" = "P2B46" ] && ok "$name ⇒ P2B46" || bad "$name" "得到 [$CODE] 預期 P2B46"
done

printf '\n══ 5. 帳體改得動嗎?(期望 P2B45)══\n'
# 🔴🔴 **codex must-fix #6:第一版九欄只打了五欄** —— 漏測 id / order_id 真的改值 / reason / created_at。
#    失敗情境:把 migration 對任一漏測欄的比較刪掉 ⇒ A1-A6 與本 harness 仍可全綠, 而那一欄已可塗改。
#    📌 **一份「逐欄列出」的守門, 它的驗收也必須逐欄** —— 否則清單長度與測試格數的差, 就是盲區大小。
R2=$(mk_row 200)
IMMUTABLE_CASES=(
  "改 id:SET id=gen_random_uuid()"
  "改 order_id(換一張真的別的單):SET order_id='$O2'::uuid"
  "改軌別:SET rail='bank_transfer'"
  "改金額:SET refund_amount=999"
  "改理由:SET reason='改一下理由'"
  "改經手人:SET actor='someone_else'"
  "改發生時刻:SET occurred_at=now() - interval '3 days'"
  "改建立時刻:SET created_at=now() - interval '3 days'"
  "改 request_id:SET request_id=gen_random_uuid()"
)
NCASE=0
for t in "${IMMUTABLE_CASES[@]}"; do
  name=${t%%:*}; frag=${t#*:}
  CODE=$(sqlstate "UPDATE public.order_manual_refunds $frag WHERE id='$R2'")
  [ "$CODE" = "P2B45" ] && ok "$name ⇒ P2B45" || bad "$name" "得到 [$CODE] 預期 P2B45"
  NCASE=$((NCASE + 1))
done
# 🔴 **我餵幾條 vs 它跑幾支**:清單長度要對上 migration 裡的不可變欄數(9)。
NDECL=$(grep -cE 'CASE WHEN NEW\.[a-z_]+ +IS DISTINCT FROM OLD\.' "$MIG_D3D")
[ "$NCASE" = "9" ] && ok "測了 9 欄(與 migration 的不可變清單同長)" || bad "欄位覆蓋" "只測了 $NCASE 欄"
[ "$NDECL" = "12" ] && ok "migration 裡的逐欄比較共 12 條(帳體 9 + 作廢 3)⇒ 分母對得上" \
  || bad "分母" "migration 裡數到 $NDECL 條逐欄比較, 期望 12(帳體 9 + 作廢 3)"
# 🔴 這一格證的是「守的是【值有沒有變】,不是【有沒有出現在 SET 裡】」——
#    `IS DISTINCT FROM` 是 NULL-safe 的等值比較。寫成 allowlist 式的欄位名比對就會在這裡誤擋。
CODE=$(sqlstate "UPDATE public.order_manual_refunds SET order_id='$O1'::uuid WHERE id='$R2'")
[ "$CODE" = "OK" ] && ok "把 order_id 設成【同一個值】⇒ 放行(比的是值不是欄位名)" \
  || bad "同值 UPDATE 被擋" "得到 [$CODE] —— 那代表它比的是欄位名不是值"

printf '\n══ 6. 本片有沒有搶別人的工作?(負對照)══\n'
CODE=$(sqlstate "DELETE FROM public.order_manual_refunds WHERE id='$R2'")
[ "$CODE" = "PCM03" ] && ok "DELETE 仍由 866 那支擋(PCM03)" || bad "DELETE" "得到 [$CODE] 預期 PCM03"
R3=$(mk_row 300)
[ ${#R3} -eq 36 ] && ok "作廢過的單之後仍能登新的一筆(那是拍板指名的路)" || bad "再登一筆" "拿到 [$R3]"

printf '\n══ 6b. TRUNCATE 擋得住嗎?(期望 P2B48)══\n'
# 🔴🔴 **codex must-fix #3**:`FOR EACH ROW` 的 trigger 對 TRUNCATE **一律不觸發** ——
#    既有的 DELETE 守門(866 那支)也是 row-level ⇒ 它同樣擋不住。
#    ⇒ 沒有這一格的話, 本片會宣稱 append-once 而 TRUNCATE 一句就把整本帳清掉。
N_BEFORE=$(q "select count(*) from public.order_manual_refunds")
CODE=$(sqlstate "TRUNCATE public.order_manual_refunds")
N_AFTER=$(q "select count(*) from public.order_manual_refunds")
[ "$CODE" = "P2B48" ] && ok "TRUNCATE ⇒ P2B48" || bad "TRUNCATE" "得到 [$CODE] 預期 P2B48"
# 🔴 **擋下來 != 沒落地**:碼對而列數少了, 那比放行更糟(有錯誤訊息, 而資料真的沒了)。
[ "$N_BEFORE" = "$N_AFTER" ] && ok "TRUNCATE 被擋而列數沒變($N_BEFORE)" \
  || bad "TRUNCATE 落地了" "列數 $N_BEFORE ⇒ $N_AFTER"
# 🔴 突變:拆掉那支 statement trigger ⇒ TRUNCATE 必須成功, 否則擋它的不是本片
psql -qX -c "DROP TRIGGER order_manual_refunds_no_truncate_bt ON public.order_manual_refunds" >/dev/null 2>&1
CODE=$(sqlstate "TRUNCATE public.order_manual_refunds")
N_MUT=$(q "select count(*) from public.order_manual_refunds")
if [ "$CODE" = "OK" ] && [ "$N_MUT" = "0" ]; then
  ok "突變:拆掉之後 TRUNCATE 成功且清空(列數 $N_BEFORE ⇒ 0)⇒ 擋它的真的是本片"
else
  bad "TRUNCATE 突變" "拆掉之後 code=[$CODE] 列數=[$N_MUT] ⇒ 擋它的不是本片, 診斷要重看"
fi
# 還原資料與 trigger(下面幾節還要用)
# 🔴 **還原要還原成【一樣的東西】**(codex R2 nit #5):上一版只 `CREATE TRIGGER`,
#    而那樣建出來的是 `tgenabled='O'` 不是 migration 的 `'A'`
#    ⇒ 「還原」之後的世界與 migration 套完的世界**不同**, 而下面幾節在那個世界裡量。
#    (本檔第 8 節會整支重套, 所以最終狀態沒被污染 —— 但**那是運氣, 不是設計**。)
RST1=$(sqlstate "CREATE TRIGGER order_manual_refunds_no_truncate_bt BEFORE TRUNCATE ON public.order_manual_refunds FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_d3d_manual_refund_no_truncate()")
RST2=$(sqlstate "ALTER TABLE public.order_manual_refunds ENABLE ALWAYS TRIGGER order_manual_refunds_no_truncate_bt")
RST3=$(q "select tgenabled from pg_trigger where tgrelid='public.order_manual_refunds'::regclass and tgname='order_manual_refunds_no_truncate_bt'")
if [ "$RST1" = "OK" ] && [ "$RST2" = "OK" ] && [ "$RST3" = "A" ]; then
  ok "還原:TRUNCATE 守門裝回去且是 ENABLE ALWAYS(tgenabled=$RST3)"
else
  bad "還原不忠實" "create=[$RST1] always=[$RST2] tgenabled=[$RST3] ⇒ 下面幾節量的世界與 migration 不同"
fi
R1=$(mk_row 100)
# 🔴🔴 **R3 對抗審查 F3:這一發的 rc 原本被吞掉了, 而 §7 的 M1 依賴它。**
#    失敗情境:若這一發沒作廢成(R1 的 voided_at 仍 NULL), §7 那句
#    `SET voided_at=NULL, void_reason=NULL, voided_by=NULL` 對它是**零變更** ⇒ 回 OK
#    ⇒ §7 照樣印「復活成功 ⇒ 擋它的真的是本片」。
#    📌 **⇒「trigger 真的被拔掉了」與「前置根本沒種進去」印同一個字。**
#    ⚠️ 它今天成立(trigger 已裝、R1 是新列)—— 這是**潛伏的**恆綠格, 不是現在紅的。
#    而它牴觸本檔 §種資料 自己立的規矩「種資料要當場驗, 不能吞掉錯誤」。⇒ 補齊。
VD=$(sqlstate "UPDATE public.order_manual_refunds SET voided_at=now(), void_reason='登錯了', voided_by='tester' WHERE id='$R1'")
VD_OK=$(q "select voided_at is not null from public.order_manual_refunds where id='$R1'")
[ "$VD" = "OK" ] && [ "$VD_OK" = "t" ] && ok "前置:R1 真的作廢了(§7 的作廢突變依賴這一格)" \
  || bad "前置(作廢 R1)" "code=[$VD] voided_at 非空=[$VD_OK] ⇒ §7 那格的結論不算數"
R2=$(mk_row 200)

printf '\n══ 7. 🔴 拔掉 trigger 之後,【那 9 格帳體欄】會不會全部翻綠?══\n'
printf '     沒有這一節的話,「它會擋」與「它恆綠」分得出來嗎?\n'
# ⚠️ codex R1 nit #10:第一版只突變兩格而標題寫「全部」⇒ 改成逐格。
# ⚠️ codex R2 nit #6:改完之後標題仍寫「上面每一格」, 而本節**只**突變那 9 格帳體欄 ——
#    作廢那三欄另外一發, 而「只清 voided_at」在拔掉本片 trigger 之後**仍會紅**(23514,
#    那是表上的 `void_trio` CHECK, 不是本片)⇒ 把它算進「應該翻綠」會是假的期望。
#    ⇒ 標題收窄成「那 9 格帳體欄」。
psql -qX -c "DROP TRIGGER order_manual_refunds_immutable_bu ON public.order_manual_refunds" >/dev/null 2>&1
R4=$(mk_row 400)
MUT_BAD=0; MUT_N=0
for t in "${IMMUTABLE_CASES[@]}"; do
  name=${t%%:*}; frag=${t#*:}
  CODE=$(sqlstate "UPDATE public.order_manual_refunds $frag WHERE id='$R4'")
  MUT_N=$((MUT_N + 1))
  if [ "$CODE" != "OK" ]; then
    MUT_BAD=$((MUT_BAD + 1)); printf '     ⚠️ [%s] 拔掉之後仍是 [%s]\n' "$name" "$CODE"
  fi
  # 🔴 每一格用**一列新的**, 免得下一格的比較基準被前一格污染。
  #    ⚠️ 這裡刻意**不寫「把它改回來」**(codex R2 nit #6):`DELETE` 會被 866 那支擋(PCM03)、
  #       列其實沒有被刪掉 —— 舊註解說的「改回來」不成立。真正做到隔離的是【每格換一列】。
  R4=$(mk_row 400)
done
[ "$MUT_BAD" = "0" ] && ok "突變:9 格帳體欄拔掉 trigger 後【全部放行】(跑了 $MUT_N 格)⇒ 擋它們的真的是本片" \
  || bad "突變" "$MUT_BAD/$MUT_N 格拔掉之後仍被擋 ⇒ **擋它的不是本片, 診斷要重看**"
M1=$(sqlstate "UPDATE public.order_manual_refunds SET voided_at=NULL, void_reason=NULL, voided_by=NULL WHERE id='$R1'")
[ "$M1" = "OK" ] && ok "突變:作廢那三欄拔掉之後【復活成功】⇒ 擋它的真的是本片" || bad "突變(作廢)" "拔掉之後仍是 [$M1]"

printf '\n══ 8. 🔴 有人 ADD COLUMN 而沒回來改清單時, 本片會不會叫?══\n'
printf '     它守的是【本片自己】—— 沒有它的話, 新欄會安靜地可竄改。\n'
# 🔴 每一步都收 rc —— 這一節的前置若失敗, 分母守門會「正確地什麼都不做」,
#    而那個 OK 看起來與「守門壞了」一模一樣。(第一版就是這樣紅的,而我當時以為是守門壞了。)
# 🔴 **兩支 trigger、兩支函式都要拆** —— 第一版只拆了 UPDATE 那一組,
#    而 TRUNCATE 那支函式還在 ⇒ 第二發 apply 撞 `42723 duplicate_object`,
#    而那個紅**看起來像「欄位分母守門壞了」**。⇒ 前置沒清乾淨,下游的紅就會指錯地方。
D1=$(sqlstate "DROP TRIGGER IF EXISTS order_manual_refunds_immutable_bu ON public.order_manual_refunds;
               DROP TRIGGER IF EXISTS order_manual_refunds_no_truncate_bt ON public.order_manual_refunds")
D2=$(sqlstate "DROP FUNCTION IF EXISTS public.pcm_d3d_manual_refund_immutable();
               DROP FUNCTION IF EXISTS public.pcm_d3d_manual_refund_no_truncate()")
D3=$(sqlstate "ALTER TABLE public.order_manual_refunds ADD COLUMN zzq_probe_col text")
NCOL=$(q "select count(*) from pg_attribute where attrelid='public.order_manual_refunds'::regclass and attnum>0 and not attisdropped")
if [ "$D1" = "OK" ] && [ "$D2" = "OK" ] && [ "$D3" = "OK" ] && [ "$NCOL" = "13" ]; then
  ok "第 8 節前置:trigger/函式已拆、探針欄已加(欄數 $NCOL)"
else
  bad "第 8 節前置" "drop_trg=[$D1] drop_fn=[$D2] add_col=[$D3] 欄數=[$NCOL] ⇒ 下面那一格不算數"
fi
CODE=$(sqlstate "\\i $MIG_D3D")
[ "$CODE" = "P2B47" ] && ok "多一個欄 ⇒ 套不上去, P2B47(逼下一個人當場決定)" || bad "欄位分母" "得到 [$CODE] 預期 P2B47"
psql -qX -c "ALTER TABLE public.order_manual_refunds DROP COLUMN zzq_probe_col" >/dev/null 2>&1
CODE=$(sqlstate "\\i $MIG_D3D")
[ "$CODE" = "OK" ] && ok "拿掉那個欄 ⇒ 又套得上去(證明剛才是【欄位】擋的, 不是別的錯)" || bad "欄位分母還原" "得到 [$CODE]"

printf '\n══ 結果:PASS=%s FAIL=%s ══\n' "$PASS" "$FAIL"
printf '🛑 射程:本檔過 != 正式庫過。FK 指到的 orders 是最小 stub;無 RLS、無正式庫 GRANT、無既有資料。\n'
printf '🛑 本片零資料修補 —— 正式庫若已有被復活過的列, 本檔看不到也答不出。\n'
[ "$FAIL" -eq 0 ] || exit 1
