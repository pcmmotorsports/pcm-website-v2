#!/usr/bin/env bash
# ci-self-contained: yes
# customers-email-not-blank-probe.sh
#   ⟦b4-NORECIPIENTWINDOW⟧ 乙半(20260905380000)探針:拋棄式 PG, 雙向。
#
# 🛑 它【證不到】什麼(先讀):
#   · fixture 是最小 schema, **刻意建了 auth.users 那道 FK** —— 因為本支第一版的自證
#     就是被那道 FK 咬到的, 而沒有 FK 的探針對它盲。
#   · 它不驗「正式庫今天有沒有空值」(那要唯讀 access;已另量, 見 migration 檔頭)。
set -u
export LC_ALL=C LANG=C
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="${1:-$REPO_ROOT/supabase/migrations/20260905380000_m4b_customers_email_not_blank.sql}"
test -f "$MIG" || { echo "🔴 找不到受測 migration:$MIG"; exit 1; }

pick() {
  if command -v "$1" > /dev/null 2>&1; then printf '%s' "$1"
  elif [ -x "/opt/homebrew/bin/$1" ]; then printf '%s' "/opt/homebrew/bin/$1"
  else echo "🔴 找不到 $1 ⇒ 沒有跑, 不是通過" >&2; exit 1
  fi
}
INITDB=$(pick initdb) || exit 1
PG_CTL=$(pick pg_ctl) || exit 1
PSQL=$(pick psql)     || exit 1

D=$(mktemp -d); P="${PGPORT_PROBE:-54347}"
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
cleanup() { [ -d "$D/pg" ] && "$PG_CTL" -D "$D/pg" -w stop > /dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT INT TERM
# 🔴🔴 **`-E UTF8` 不是裝飾 —— 沒有它這支探針量的是別的東西。**
#   本檔第一版沒帶它 ⇒ `LC_ALL=C` 之下 initdb 建出 **SQL_ASCII** 庫
#   ⇒ migration 裡的 `U&'\3000'` 當場 `ERROR: conversion between UTF8 and SQL_ASCII is not supported`
#   ⇒ 🛑 **而正式庫是 UTF8** —— 證據:`20260905050000`(同樣用 `U&` 寫那組字集)**已在帳本上**
#     (版本欄確認 True、負對照 False)⇒ 那個錯是**探針自己的環境**造成的, 不是 migration 的缺陷。
#   ⇒ 📌 一個把【自己環境的限制】報成【受測物的缺陷】的探針, 比沒有探針糟。
"$INITDB" -D "$D/pg" -U postgres --no-sync -A trust -E UTF8 --locale=C > /dev/null 2>&1
"$PG_CTL" -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start > /dev/null 2>&1 \
  || { echo "起不來"; cat "$D/log"; exit 1; }
Q()  { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>&1; }
QV() { "$PSQL" -U postgres -v ON_ERROR_STOP=1 -X -q "$@" 2>/dev/null; }

FAILED=0
PASSED=0
chk() { if [ "$2" = "$3" ]; then PASSED=$((PASSED + 1)); printf '  ✅ %s = %s\n' "$1" "$2"
        else printf '  🔴 %s = %s   而期望 %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi }

# ── fixture:🔴 **auth.users 那道 FK 一定要建** ────────────────────
Q <<'SQL' > /dev/null
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.customers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email   text NOT NULL UNIQUE);
-- 🔴 本 migration 的自證要拿這支函式的回傳值當【逐字元的分母】⇒ fixture 必須有它。
--    ⚠️ 這裡是**同一組字集的一份 fixture 副本**(正式庫那支由 20260905050000 建)——
--    它證的是「機制會動」, 不是「正式庫那支長這樣」。真正把兩者綁在一起的是 **apply 當下**
--    那段逐字元自證:它讀的是**正式庫裡那支函式**, 不是這份副本。
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS $fx$
  SELECT E' \t\n\r\f'
      || U&'\000b' || U&'\00a0' || U&'\feff' || U&'\3000'
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a'
      || U&'\2028\2029' || U&'\1680' || U&'\202f' || U&'\205f'
$fx$;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a','a@x.test');
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000a','a@x.test');
SQL

Q -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
chk "格1 貼上去 rc" "$RC" 0
# 🔴🔴 **貼失敗就【當場停】, 不要往下跑。**
#   第一版沒停 ⇒ 約束根本沒建出來, 而下游那幾格照樣印 ✅ ——
#   它們的 INSERT 是被 **PK 撞名** 擋下的, 而我讀成「約束擋住了」。
#   ⇒ 📌 **一個沒有前提的綠, 與有前提的綠印同一個字元。**
if [ "$RC" -ne 0 ]; then
  echo "🔴 貼不進去 ⇒ 下游每一格都失去意義, 當場停(不印那些會誤導的 ✅)"
  sed -n '1,10p' "$D/apply.log"
  exit 1
fi

chk "格2 🔴 約束在, 而且是 validated" \
  "$(QV -Atc "SELECT count(*) FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_email_not_blank' AND convalidated")" 1

# ── 真的塞塞看(這一段才是行為)────────────────────────────────
Q -c "INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000b','b');" > /dev/null
ins() { Q -c "INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000b', $1);" > /dev/null 2>&1; echo $?; }
del() { Q -c "DELETE FROM public.customers WHERE user_id='00000000-0000-0000-0000-00000000000b';" > /dev/null 2>&1; }

chk "格3 🔴 空字串 ⇒ 被擋(rc 非 0)" "$(ins "''")" 1
chk "格4 🔴 純空格 ⇒ 被擋" "$(ins "'   '")" 1
chk "格5 🔴 tab + 換行 ⇒ 被擋" "$(ins "E'\t\n'")" 1
chk "格6 🔴 全形空白 ⇒ 被擋(它是本字集比預設 btrim 多出來的那一族)" "$(ins "U&'\3000'")" 1
chk "格7 🟢 正對照:一個真的 email ⇒ 進得去(否則上面四格只證明「什麼都塞不進去」)" "$(ins "'b@x.test'")" 0
del
chk "格8 🟢 正對照:一個【不是信箱但非空】的字 ⇒ 也進得去(本約束不管格式)" "$(ins "'x'")" 0
del

# ── 🧬 突變:把 CHECK 的字集改窄 ⇒ 全形空白那格要紅 ────────────
Q -c "ALTER TABLE public.customers DROP CONSTRAINT customers_email_not_blank;
      ALTER TABLE public.customers ADD CONSTRAINT customers_email_not_blank CHECK (btrim(email) <> '');" > /dev/null
chk "格9 🧬 字集改成預設 btrim(只吃空格)⇒ 全形空白【塞得進去】= 突變生效" "$(ins "U&'\3000'")" 0
del
chk "格9b 🧬 而空格那格照樣被擋 ⇒ 證明格9 紅的是【字集】不是整道約束沒了" "$(ins "'   '")" 1

# ── 🧬 撞名:再貼一次要被前置閘擋 ────────────────────────────
Q -c "ALTER TABLE public.customers DROP CONSTRAINT customers_email_not_blank;" > /dev/null
Q -f "$MIG" > /dev/null 2>&1
Q -f "$MIG" > "$D/dup.log" 2>&1; RC2=$?
chk "格10 🧬 再貼一次 ⇒ 前置閘擋(rc 非 0)" "$([ "$RC2" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qF '已經存在' "$D/dup.log"; then chk "格10b 🧬 而它紅在【前置閘】那一句" yes yes
else chk "格10b 🧬 而它紅在【前置閘】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/dup.log" | sed 's/^/     實際: /'; fi

# ── 🧬 既有空值:前置閘要印出【幾列】────────────────────────
Q -c "ALTER TABLE public.customers DROP CONSTRAINT customers_email_not_blank;
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000c','c');
      INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000c','  ');" > /dev/null
Q -f "$MIG" > "$D/dirty.log" 2>&1; RC3=$?
chk "格11 🔴 表裡已有空白值 ⇒ 貼不進去(rc 非 0)" "$([ "$RC3" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qF '先清乾淨再貼' "$D/dirty.log"; then chk "格11b 🔴 而它紅在前置閘、且訊息帶【幾列】" yes yes
else chk "格11b 🔴 而它紅在前置閘、且訊息帶【幾列】" no yes; grep -m1 -E '^psql:.*ERROR' "$D/dirty.log" | sed 's/^/     實際: /'; fi

# ══ 🔴🔴 前置閘那兩個【被 fixture 遮住】的世界(codex must-fix ①)══════════════
#   本檔一開始就塞了一位正常客戶 ⇒ 「空表」與「全部都空白」這兩個世界**從來沒有被演過**,
#   而我第一版的前置閘正是在那兩個世界上給錯答案。⇒ 各演一次。
Q -c "ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank;
      DELETE FROM public.customers;" > /dev/null
Q -f "$MIG" > "$D/empty.log" 2>&1; RC4=$?
chk "格12 🔴 空表(0 列)⇒ 【貼得進去】(沒有東西會違反它)" "$RC4" 0
if grep -qF '沒有東西會違反' "$D/empty.log"; then chk "格12b 🔵 而它有出聲說「本次前置量測沒有判別力」" yes yes
else chk "格12b 🔵 而它有出聲說「本次前置量測沒有判別力」" no yes; fi

Q -c "ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank;
      INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000a','   ');
      INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000b','  ');" > /dev/null
Q -f "$MIG" > "$D/allbad.log" 2>&1; RC5=$?
chk "格13 🔴 全部都是空白 ⇒ 貼不進去" "$([ "$RC5" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qF '2 位客戶的 email 是空白' "$D/allbad.log"; then chk "格13b 🔴 而訊息說的是【2 位空白】, 不是「空表」" yes yes
else chk "格13b 🔴 而訊息說的是【2 位空白】, 不是「空表」" no yes; grep -m1 -E '^psql:.*ERROR' "$D/allbad.log" | sed 's/^/     實際: /'; fi

# ══ 🧬🧬 **codex R2 那五條的正面回應:把 CHECK 換成恆真式, 自證要當場紅** ══════
#   🎯 這是本片換角度的**唯一驗收**:前兩版的自證(比字面)對下面這一發**全綠**;
#      新版把真的那一式跑一遍 ⇒ 它必須紅, 而且要紅在【逐字元】那一句。
Q -c "ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank;
      DELETE FROM public.customers;
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000d','d@x.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-00000000000d','d@x.test');" > /dev/null
python3 - "$MIG" > "$D/taut.sql" <<'PY3'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index('ADD CONSTRAINT customers_email_not_blank')
j = s.index(');', i)
# 恆真式:形狀仍含 btrim、不含 OR/TRUE ⇒ 前兩版的三道自證全綠
seg = s[i:j]
k = seg.index('CHECK (')
mut = seg[:k] + "CHECK (\n    pg_catalog.btrim(email, ' ') = pg_catalog.btrim(email, ' ')\n  "
sys.stdout.write(s[:i] + mut + s[j:])
PY3
test -s "$D/taut.sql" || { echo "🔴 突變檔是空的"; exit 1; }
Q -f "$D/taut.sql" > "$D/taut.log" 2>&1; RC6=$?
chk "格14 🧬🔴 CHECK 換成恆真式(btrim(x)=btrim(x))⇒ 貼不進去" "$([ "$RC6" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qF '自證①' "$D/taut.log"; then chk "格14b 🧬 而它紅在【自證①逐字元】那一句(不是別的理由)" yes yes
else chk "格14b 🧬 而它紅在【自證①逐字元】那一句(不是別的理由)" no yes; grep -m1 -E '^psql:.*ERROR' "$D/taut.log" | sed 's/^/     實際: /'; fi

# 🧬 恆假式:什麼都擋 ⇒ 正對照那格要紅
python3 - "$MIG" > "$D/never.sql" <<'PY4'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
i = s.index('ADD CONSTRAINT customers_email_not_blank')
j = s.index(');', i)
seg = s[i:j]
k = seg.index('CHECK (')
sys.stdout.write(s[:i] + seg[:k] + "CHECK (\n    email IS NULL\n  " + s[j:])
PY4
Q -c "ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank; DELETE FROM public.customers;" > /dev/null
Q -f "$D/never.sql" > "$D/never.log" 2>&1; RC7=$?
chk "格15 🧬🔴 CHECK 換成恆假式 ⇒ 貼不進去(正對照那格要紅)" "$([ "$RC7" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qF '自證③' "$D/never.log"; then chk "格15b 🧬 而它紅在【自證③正對照】那一句" yes yes
else chk "格15b 🧬 而它紅在【自證③正對照】那一句" no yes; grep -m1 -E '^psql:.*ERROR' "$D/never.log" | sed 's/^/     實際: /'; fi

# ══ 🧬 **突變 fixture 那支函式 ⇒ 自證的分母要跟著動**(R3 nit)═══════════════
#   🎯 本檔前面每一發突變動的都是【約束】, **沒有一發動過那支函式**
#      ⇒ 「函式多一個字元, 這裡就多演一發」這句宣稱**零覆蓋**。這兩格補它。
Q -c "ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank;
      DELETE FROM public.customers;
      DROP FUNCTION public.pcm_js_trim_whitespace();
      CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS \$fx\$
        SELECT E' \t\n\r\f' || U&'\\000b' || U&'\\00a0' || U&'\\feff' || U&'\\3000'
            || U&'\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a'
            || U&'\\2028\\2029' || U&'\\1680' || U&'\\202f' || U&'\\205f' || U&'\\200b'
      \$fx\$;" > /dev/null
Q -f "$MIG" > "$D/fnwide.log" 2>&1; RC8=$?
chk "格16 🧬🔴 把 U+200B 塞進【函式】(字集變 26)⇒ 貼不進去" "$([ "$RC8" -ne 0 ] && echo 1 || echo 0)" 1
if grep -qE '前置閘.*26|自證④' "$D/fnwide.log"; then chk "格16b 🧬 而它紅在【長度前置閘】或【自證④ U+200B 要放行】" yes yes
else chk "格16b 🧬 而它紅在【長度前置閘】或【自證④ U+200B 要放行】" no yes; grep -m1 -E '^psql:.*ERROR' "$D/fnwide.log" | sed 's/^/     實際: /'; fi
# 還原那支函式(後面沒有格了, 而還原是紀律)
Q -c "DROP FUNCTION public.pcm_js_trim_whitespace();
      CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS \$fx\$
        SELECT E' \t\n\r\f' || U&'\\000b' || U&'\\00a0' || U&'\\feff' || U&'\\3000'
            || U&'\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a'
            || U&'\\2028\\2029' || U&'\\1680' || U&'\\202f' || U&'\\205f'
      \$fx\$;" > /dev/null

# ══ 🔵 收尾:格數【當場數】, 不寫死 ═════════════════════════════════════════
#   🛑 我先前對主視窗報「15 格」而實際只有 14 個 runtime 檢查(codex nit)——
#      我把最後那行摘要也數進去了。⇒ 這裡改成印出當場數到的數字, 不再由人抄。
#   🛑 而我第一版**只把寫死的數字拿掉、沒有真的印**(codex R2 nit)——
#      📌 **在一個專治「宣稱與事實不符」的修法裡, 我自己寫了一句不符的宣稱。**
if [ "$FAILED" -eq 0 ]; then echo "🟢 全部通過 —— 當場數到 $PASSED 格 ✅(這個數字是 chk 自己加出來的, 不是我抄的)"; exit 0; fi
echo "🔴 有 $FAILED 格沒過"; exit 1
