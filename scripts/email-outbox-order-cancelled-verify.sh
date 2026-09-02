#!/usr/bin/env bash
# email-outbox-order-cancelled-verify.sh
#   在【拋棄式 PG】上驗 `20260902120000_m4b_outbox_order_cancelled_event.sql` 的**行為**。
#
# 🔴 為什麼要有它:那支 migration 自己的【六道】閘(前置 ①-⑤ + 事後 ①-⑥)驗的是【定義】
#    (CHECK 的字面、是否 validated、COMMENT 的字面)。
#    **一個 CHECK 的字面對了,與它擋不擋得住東西、放不放得進去,是兩個宣稱。**
#    而正式庫上不做行為探針,是 Sean 2026-08-30 拍板【甲】的既有裁決
#    (理由在 20260830060000:230-270:探針最有用的世界正好也最危險 + 結構性死結環)。
#    ⇒ 行為那一層落在這裡。
#
# 天花板/範圍:十個世界(見下)。**本機拋棄式庫** ⇒ 它證不出正式庫的行為
#   (正式庫可能有我們不知道的觸發器/RULE/殘留約束)。那一格今天沒有人在證,
#   而那是【甲】這個選擇**明知的代價**,不是疏漏。
# 天花板/量具:它驗「CHECK 換掉了、而且第三個值真的寫得進去」;
#   它**不驗** enqueue、模板、後台入口 —— 那三片各自帶自己的測試。
#
# 用法:bash scripts/email-outbox-order-cancelled-verify.sh
# 出口:0=全綠 / 1=有世界不如預期 / 2=ENV-FAIL(工具或檔案不在,不是碼的問題)/ 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260902120000_m4b_outbox_order_cancelled_event.sql"
MIG_TABLE="$REPO/supabase/migrations/20260717020000_m4a_email_outbox.sql"

# mktemp 失敗時 D 會是空字串 ⇒ 後面每個 "$D/x" 變成 "/x"(同 email-outbox-seventh-state-verify.sh 那格)。
D=$(mktemp -d "${TMPDIR:-/tmp}/eoc.XXXXXXXX") || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是乾淨 ⇒ exit 9"; exit 9; }
PG=54373
KEEP=0
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT

for f in "$M" "$MIG_TABLE"; do [ -f "$f" ] || { echo "🔴 找不到 $f ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL"; KEEP=1; exit 2; }; done

# 🔴 建表 DDL 原樣抽出,不手抄(手抄的兩份一起抄錯時 harness 全綠,而正式的世界會炸)
sed -n '/^CREATE TABLE public\.email_outbox (/,/^);/p' "$MIG_TABLE" > "$D/ddl.sql"
DDL_BYTES=$(wc -c < "$D/ddl.sql" | tr -d ' ')
grep -q 'email_outbox_event_type_check' "$D/ddl.sql" && [ "$DDL_BYTES" -gt 800 ] \
  || { printf '🔴 抽不到建表 DDL(%s bytes)⇒ ENV-FAIL\n' "$DDL_BYTES"; KEEP=1; exit 2; }
printf '✅ email_outbox 建表 DDL 從 20260717020000 原樣抽出 %s bytes(不是手抄)\n' "$DDL_BYTES"

# 🔴 LC_ALL 一定要給:少了它 PG 17 在 macOS 起不來,錯誤是
#    "postmaster became multithreaded during startup"(2026-09-02 實測)。
export LC_ALL=C LANG=C
initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 || { echo "🔴 initdb ⇒ ENV-FAIL"; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" -w start >/dev/null 2>&1 || { echo "🔴 pg_ctl ⇒ ENV-FAIL(log: $D/pg.log)"; KEEP=1; exit 2; }
q(){ psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAIL=0

base(){
  { # 🔴 世界⑧ 種的那支函式**吃 email_outbox 這個列型別** ⇒ 不先丟它, DROP TABLE 會被相依性擋住
    #    ⇒ 下一個世界的 fixture 建不起來。而那一格是【M2 那道新的 fixture-rc 檢查當場抓到的】——
    #    在加它之前, 這個失敗會安靜地讓世界⑥ 拿舊表去量而照樣印 ✅。
    #    ⚠️ 而順序有一個環:約束依賴函式、函式的參數型別依賴表 ⇒ 先丟【約束】才解得開。
    printf 'ALTER TABLE IF EXISTS public.email_outbox DROP CONSTRAINT IF EXISTS zz_wholerow;\n'
    printf 'DROP FUNCTION IF EXISTS public.zz_rej(public.email_outbox);\n'
    printf 'DROP TABLE IF EXISTS public.email_outbox;\n'
    printf 'DROP TABLE IF EXISTS public.zz_kinds;\n'
    printf 'DROP TABLE IF EXISTS public.orders;\n'
    printf 'CREATE TABLE public.orders (id uuid primary key default gen_random_uuid());\n'
    cat "$D/ddl.sql"
    printf 'INSERT INTO public.orders DEFAULT VALUES;\n'
  } > "$D/base.sql"
  q -q -f "$D/base.sql"
}

# 探針:寫一列 order_cancelled,**然後回頭讀綁 dedup_key 的那一列**。
# 「INSERT 沒有拋錯」不等於「那一列在表裡」(BEFORE 觸發器 RETURN NULL / RULE 導去影子表都不拋錯)。
cat > "$D/probe.sql" <<'PSQL'
INSERT INTO public.email_outbox (order_id, event_type, dedup_key, recipient_email, subject, payload)
SELECT o.id, 'order_cancelled', '_pcm_cancel_probe',
       'probe@example.invalid', '_pcm_probe', '{}'::jsonb
  FROM public.orders o ORDER BY o.id LIMIT 1;
PSQL
cat > "$D/readback.sql" <<'PSQL'
SELECT count(*) FROM public.email_outbox
 WHERE event_type = 'order_cancelled' AND dedup_key = '_pcm_cancel_probe';
PSQL

# $1=世界名 $2=種阻擋的額外SQL(可空) $3=期望 GREEN|MIG-RED|PROBE-RED $4=期望命中的閘字樣(可空)
w(){
  base > "$D/b.log" 2>&1 || { printf '  %-44s ⇒ 🔴 fixture 建不起來 ⇒ 本輪作廢\n' "$1"; KEEP=1; FAIL=$((FAIL+1)); return; }
  grep -q ERROR "$D/b.log" && { printf '  %-44s ⇒ 🔴 fixture 有 ERROR ⇒ 本輪作廢\n' "$1"; KEEP=1; FAIL=$((FAIL+1)); return; }
  if [ -n "$2" ]; then
    # 🔴 rc 與字面兩個都收:psql 非零 rc 不保證輸出裡有 ERROR 這個字。
    q -q -c "$2" > "$D/a.log" 2>&1 ; arc=$?
    if [ $arc -ne 0 ] || grep -q ERROR "$D/a.log"; then
      printf '  %-44s ⇒ 🔴 前置 SQL 失敗(rc=%s)⇒ 本輪作廢\n' "$1" "$arc"; KEEP=1; FAIL=$((FAIL+1)); return
    fi
  fi

  local g mo mrc po prc n
  mo=$(q -f "$M" 2>&1); mrc=$?
  if [ $mrc -ne 0 ]; then
    # 非零 rc 要歸因:訊息裡沒有「閘」的,是無關的錯誤在冒充命中。
    if printf '%s' "$mo" | grep -q '前置閘\|事後閘'; then g=MIG-RED; else g=MIG-OTHER-ERR; fi
  else
    po=$(q -f "$D/probe.sql" 2>&1); prc=$?
    if [ $prc -ne 0 ]; then g=PROBE-RED
    else
      n=$(q -tAf "$D/readback.sql" 2>/dev/null | tr -d ' ')
      if [ "$n" = "1" ]; then g=GREEN; else g=PROBE-GONE; fi
    fi
  fi

  if [ "$g" = "$3" ]; then
    # 🔴 期望 MIG-RED 時還要比【是哪一道閘】—— 對的紅在錯的地方,與對的紅長得一樣。
    if [ -n "${4:-}" ] && ! printf '%s' "$mo" | grep -q "$4"; then
      printf '  %-44s ⇒ 🔴 紅了但不是那道閘(要 %s)\n' "$1" "$4"; KEEP=1; FAIL=$((FAIL+1)); return
    fi
    printf '  %-44s ⇒ ✅ %s\n' "$1" "$g"; PASS=$((PASS+1))
  else
    printf '  %-44s ⇒ 🔴 得到 %s、預期 %s\n' "$1" "$g" "$3"; KEEP=1; FAIL=$((FAIL+1))
  fi
}

echo "── 十個世界(⑦⑧⑨ = 前置閘⑤ · ⑩ = 事後閘⑤ 的正對照)──────"
w "① 正常世界:migration 過, 第三值寫得進去"      ""                                                                          GREEN
w "② forward-only:同一支跑第二次"                 "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check, ADD CONSTRAINT email_outbox_event_type_check CHECK (event_type IN ('order_created','order_shipped','order_cancelled'))" MIG-RED  "前置閘②"
w "③ 恆真世界:CHECK 被換成 TRUE OR …"            "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check, ADD CONSTRAINT email_outbox_event_type_check CHECK (TRUE OR event_type IN ('order_created','order_shipped'))" MIG-RED "前置閘④"
w "④ 約束不見了"                                   "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check"                     MIG-RED  "前置閘①"
w "⑤ 現行約束是 NOT VALID"                        "ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check; ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_event_type_check CHECK (event_type IN ('order_created','order_shipped')) NOT VALID" MIG-RED "前置閘③"

w "⑦ 這一欄上另有一條別名 CHECK 擋著"        "ALTER TABLE public.email_outbox ADD CONSTRAINT zz_other_check CHECK (event_type <> 'order_cancelled')" MIG-RED "前置閘⑤"

w "⑧ whole-row CHECK(conkey={0})擋著"       "CREATE OR REPLACE FUNCTION public.zz_rej(public.email_outbox) RETURNS boolean LANGUAGE sql IMMUTABLE AS \$zz\$ SELECT \$1.event_type <> 'order_cancelled' \$zz\$; ALTER TABLE public.email_outbox ADD CONSTRAINT zz_wholerow CHECK (public.zz_rej(public.email_outbox.*))" MIG-RED "前置閘⑤"

# 🔴 世界⑨:FOREIGN KEY —— 它不是 CHECK, 而它一樣擋得住第三個值(23503)。
#    加它的理由:R2 的第二條 must-fix 把閘從 `contype='c'` 放寬成 `IN ('c','f')`,
#    而**一道沒有世界演過的保護, 與沒有寫的行為相同** ⇒ 這一格就是它的正對照。
w "⑨ event_type 上有 FK 指向只含舊兩值的表"  "CREATE TABLE public.zz_kinds (k text PRIMARY KEY); INSERT INTO public.zz_kinds VALUES ('order_created'),('order_shipped'); ALTER TABLE public.email_outbox ADD CONSTRAINT zz_fk FOREIGN KEY (event_type) REFERENCES public.zz_kinds(k)" MIG-RED "前置閘⑤"

# 🔴 世界⑩:**事後閘的正對照** —— 前面九個世界全打前置閘與 happy path,事後閘②③④⑤⑥ 一個世界都沒有。
#    而本檔 :132 自己寫著「一道沒有世界演過的保護, 與沒有寫的行為相同」⇒ 那條準則要套用在自己身上。
#    做法:複製 migration 到暫存、把 COMMENT 裡的「3 值」換成「三值」、跑那一份 ⇒ 事後閘⑤ 必紅。
#    🔵 它同時是【事後閘真的會跑】的證人 —— 少了它,事後閘全部是「寫了而沒有人演過」。
# 🔴🔴 **突變要【只改被測的東西】,不能連量它的尺一起改**(2026-09-02 我第一版就踩了):
#    第一版寫 `sed "s/3 值/三值/"` ⇒ 它同時改掉 COMMENT **和事後閘⑤ 自己的 strpos 字面**
#    ⇒ 閘改成找「三值」、而 COMMENT 也變成「三值」⇒ **兩邊一起改 ⇒ 它照樣通過 ⇒ rc=0**
#    ⇒ 📌 **一個把偵測器一起關掉的突變, 印出來的是「這道閘不存在」, 而它讀起來像「這道閘沒有用」。**
#    ⇒ 只鎖 COMMENT 那一行的形狀(`3 值:` 帶冒號;閘那兩處是 `'3 值'` 帶單引號)。
mutM(){ sed "s/3 值:/三值:/" "$M" > "$D/mut.sql"; }
echo "── 🔴 世界⑩(事後閘⑤ 的正對照:COMMENT 被改成「三值」)──"
base > "$D/b10.log" 2>&1; b10rc=$?
mutM
MUTDIFF=$(diff "$M" "$D/mut.sql" | grep -c '^<')
if [ "$b10rc" -ne 0 ] || grep -q ERROR "$D/b10.log"; then
  printf '  %-44s ⇒ 🔴 fixture 建不起來(rc=%s)⇒ 本輪作廢\n' "⑩ COMMENT 改成「三值」" "$b10rc"; KEEP=1; FAIL=$((FAIL+1))
elif [ "$MUTDIFF" -lt 1 ]; then
  # 🔴 突變沒改到東西時, 下面那一發會【正常通過】而看起來像通過 —— 那正是「一個綠代表什麼都沒跑」。
  printf '  %-44s ⇒ 🔴 突變一行都沒改到(diff=%s)⇒ 這一格證不了任何事\n' "⑩ COMMENT 改成「三值」" "$MUTDIFF"; KEEP=1; FAIL=$((FAIL+1))
else
  mo=$(q -f "$D/mut.sql" 2>&1); mrc=$?
  if [ $mrc -ne 0 ] && printf '%s' "$mo" | grep -q '事後閘⑤'; then
    printf '  %-44s ⇒ ✅ 事後閘⑤ 紅了(突變改了 %s 行)\n' "⑩ COMMENT 改成「三值」" "$MUTDIFF"; PASS=$((PASS+1))
  else
    printf '  %-44s ⇒ 🔴 得到 rc=%s 而不是事後閘⑤ ⇒ 事後閘沒有在跑\n' "⑩ COMMENT 改成「三值」" "$mrc"; KEEP=1; FAIL=$((FAIL+1))
  fi
fi

# 🔵 世界⑥ = 正對照:證明「寫得進去」是**這支 migration 換來的**,不是本來就寫得進去。
#    少了它,世界①的綠與「這張表本來就不擋第三個值」印同一個結果。
echo "── 🔵 世界⑥(正對照:不跑 migration, 第三值必須被拒)────"
# 🔴 codex R1 must-fix:上一版**沒收 base 的 rc** ⇒ fixture 建不起來時,
#    世界⑤ 留下的那張表還在(而它的 CHECK 是 NOT VALID 的兩值版 —— NOT VALID 仍然擋新列)
#    ⇒ probe 照樣被拒 ⇒ 這一格照樣印 ✅。
#    📌 **「被舊 CHECK 擋住」與「我根本沒把新 fixture 建起來」印同一個結果。**
#    ⇒ 收 rc + 字面,**再加一道**:動手前先確認這張表現在真的是【兩值且 validated】。
EXPECT6="CHECK ((event_type = ANY (ARRAY['order_created'::text, 'order_shipped'::text])))|true"
base > "$D/b6.log" 2>&1; b6rc=$?
if [ $b6rc -ne 0 ] || grep -q ERROR "$D/b6.log"; then
  printf '  %-44s ⇒ 🔴 fixture 建不起來(rc=%s)⇒ 本輪作廢\n' "⑥ 沒跑 migration 就寫 order_cancelled" "$b6rc"
  KEEP=1; FAIL=$((FAIL+1)); PRE6=skip
else
  PRE6=$(q -tAc "SELECT pg_get_constraintdef(c.oid) || '|' || c.convalidated
                   FROM pg_constraint c WHERE c.conrelid='public.email_outbox'::regclass
                    AND c.conname='email_outbox_event_type_check';" 2>/dev/null)
fi
case "${PRE6:-}" in
  skip) ;;
  "$EXPECT6") ;;   # 逐字全等 ⇒ 這才是⑥要的起點
  # 🔴 R2 nit:上一版用 glob 只比「舊兩值那段有出現」——
  #    而 `CHECK (event_type IN (舊兩值) OR event_type = 'foo')` 也會通過,
  #    那不是它宣稱的「兩值 validated」。⇒ 改成**逐字全等**。
  # 🔴 而更早一版寫 "|t" —— psql 對 boolean 印的是 **true/false**, 不是 t/f。
  #    它印的紅是**對的**:那一格在說「起點不是我以為的樣子」, 而真相是【我的期望字面錯了】。
  #    📌 一把新尺的第一個讀數不是結論, 是它的自檢。
  *) printf '  %-44s ⇒ 🔴 起點不是【兩值 validated】⇒ 本輪作廢(實得:%s)\n' "⑥ 起點自檢" "${PRE6:-空}"
     KEEP=1; FAIL=$((FAIL+1)); PRE6=skip ;;
esac
po=$(q -f "$D/probe.sql" 2>&1); prc=$?
if [ "${PRE6:-}" = skip ]; then :
elif [ $prc -ne 0 ] && printf '%s' "$po" | grep -q 'email_outbox_event_type_check'; then
  printf '  %-44s ⇒ ✅ 被舊 CHECK 拒(23514)\n' "⑥ 沒跑 migration 就寫 order_cancelled"; PASS=$((PASS+1))
else
  printf '  %-44s ⇒ 🔴 竟然沒被拒(rc=%s)⇒ 世界①的綠證不了任何事\n' "⑥ 沒跑 migration 就寫 order_cancelled" "$prc"; KEEP=1; FAIL=$((FAIL+1))
fi

echo "────────────────────────────────────────────────────────"
printf '結果:PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
printf '🛑 射程:本機拋棄式庫 ⇒ 證不出正式庫的行為(未知觸發器/RULE/殘留約束)。\n'
printf '🛑 本檔【不驗】enqueue / 模板 / 後台入口 —— 那三片各自帶自己的測試。\n'
[ "$FAIL" = 0 ] || exit 1
