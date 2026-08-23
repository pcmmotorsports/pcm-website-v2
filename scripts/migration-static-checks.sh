#!/usr/bin/env bash
# migration-static-checks.sh — migration 檔的三道靜態檢查(不用連 DB)
#
# 用法:bash scripts/migration-static-checks.sh <migration.sql>
#
# 出處:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §7.5 步驟 2。
# 🔴 這三道 2026-08-16 全部改過 —— 原版在【合格的檔上誤報】,
#    是寫完第一支真的 migration 才發現的。原版錯在哪寫在各道的註解裡。
#
# 🔴 為什麼要有這支檔:那三道原本只寫在規格與 STOP 信裡。
#    規格會被讀,但【不會被執行】—— 而檢查不被執行就等於不存在。
set -uo pipefail

# ── --selftest:規則①的證人(2026-08-23 修閘時一併立;#854 同母題:一道閘要有東西看著它自己)──
# 拋棄式 fixture 只驗規則①的字面輸出(fixture 沒 COMMIT ⇒ 規則②必紅 ⇒ 不能拿總 RC 當判準);
# fixture 數與 check 數以 --selftest 自己印的 N/N 為準,不在這裡寫死(寫死的數字會漂)。
if [ "${1:-}" = "--selftest" ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  FX="$(mktemp -d)"; trap 'rm -rf "$FX"' EXIT
  # 基底(更早檔):foo 裸 CREATE / view v / trigger trg ON a / pcm_cron.foo2 / 以及一支【只在 dollar-quote
  # 字串裡】提到 CREATE FUNCTION public.ghost 的檔(那不是定義,是 DO block 自檢的字串常數)。
  printf 'CREATE FUNCTION public.foo() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\nCREATE VIEW public.v AS SELECT 1;\nCREATE TRIGGER trg BEFORE INSERT ON public.a FOR EACH ROW EXECUTE FUNCTION public.foo();\nCREATE FUNCTION pcm_cron.foo2() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n' > "$FX/20200101000000_base.sql"
  printf 'DO $d$ BEGIN IF pg_get_functiondef(1) NOT LIKE %s THEN RAISE EXCEPTION %s; END IF; END $d$;\n' "'%CREATE FUNCTION public.ghost()%'" "'x'" > "$FX/20200101500000_ghost_in_string.sql"
  printf 'CREATE OR REPLACE FUNCTION public.foo() RETURNS void LANGUAGE sql AS $f$ SELECT 2 $f$;\n' > "$FX/20200102000000_redef.sql"
  printf 'CREATE OR REPLACE FUNCTION public.bar() RETURNS void LANGUAGE sql AS $f$ SELECT 3 $f$;\n' > "$FX/20200103000000_new.sql"
  printf 'CREATE TABLE IF NOT EXISTS public.t (id int);\n' > "$FX/20200104000000_ine.sql"
  printf 'CREATE OR REPLACE FUNCTION public.x-y() RETURNS void LANGUAGE sql AS $f$ SELECT 4 $f$;\n' > "$FX/20200105000000_badname.sql"
  printf 'CREATE OR REPLACE FUNCTION public.foo() RETURNS void LANGUAGE sql AS $f$ SELECT 5 $f$;\n' > "$FX/20200100000000_before_base.sql"
  printf 'CREATE OR REPLACE FUNCTION public.ghost() RETURNS void LANGUAGE sql AS $f$ SELECT 6 $f$;\n' > "$FX/20200106000000_ghost_real.sql"
  printf 'CREATE OR REPLACE FUNCTION public.foo2() RETURNS void LANGUAGE sql AS $f$ SELECT 7 $f$;\n' > "$FX/20200107000000_schema_mismatch.sql"
  printf 'CREATE\nOR REPLACE FUNCTION public.baz() RETURNS void LANGUAGE sql AS $f$ SELECT 8 $f$;\n' > "$FX/20200108000000_multiline_new.sql"
  printf 'CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON public.b FOR EACH ROW EXECUTE FUNCTION public.foo();\n' > "$FX/20200109000000_trigger_other_table.sql"
  printf 'CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON public.a FOR EACH ROW EXECUTE FUNCTION public.foo();\n' > "$FX/20200110000000_trigger_same_table.sql"
  printf 'CREATE OR REPLACE VIEW public.v AS SELECT 2;\n' > "$FX/20200111000000_view_redef.sql"
  printf 'CREATE OR REPLACE FUNCTION public."Foo"() RETURNS void LANGUAGE sql AS $f$ SELECT 9 $f$;\n' > "$FX/20200112000000_quoted.sql"
  printf '/* 舊版曾這樣寫:\nCREATE FUNCTION public.cm() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n*/\nSELECT 1;\n' > "$FX/20200101600000_cm_in_block_comment.sql"
  printf 'CREATE OR REPLACE FUNCTION public.cm() RETURNS void LANGUAGE sql AS $f$ SELECT 10 $f$;\n' > "$FX/20200113000000_cm_real.sql"
  # 剝殼順序三格(code-reviewer must-fix 1 / 假紅 3 / 反向):更早檔的真定義不得被註解裡的開頭符號吃掉。
  printf -- '-- 說明:見 eslint scripts/*.ts 那條 /* 這裡只是註解\nCREATE FUNCTION public.eat1() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n' > "$FX/20200101700000_linecomment_opens_block.sql"
  printf -- '-- 見檔尾 DO $gate$ 六道守門\nCREATE FUNCTION public.eat2() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\nDO $gate$ BEGIN NULL; END $gate$;\n' > "$FX/20200101800000_linecomment_opens_dollar.sql"
  printf '/* 備註 -- 說明 */ CREATE FUNCTION public.eat3() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;\n' > "$FX/20200101900000_block_with_dashdash.sql"
  printf 'CREATE OR REPLACE FUNCTION public.eat1() RETURNS void LANGUAGE sql AS $f$ SELECT 2 $f$;\n' > "$FX/20200114000000_eat1_redef.sql"
  printf 'CREATE OR REPLACE FUNCTION public.eat2() RETURNS void LANGUAGE sql AS $f$ SELECT 2 $f$;\n' > "$FX/20200115000000_eat2_redef.sql"
  printf 'CREATE OR REPLACE FUNCTION public.eat3() RETURNS void LANGUAGE sql AS $f$ SELECT 2 $f$;\n' > "$FX/20200116000000_eat3_redef.sql"
  # ── 規則②的證人(2026-08-23 加;在此之前規則②【從來沒有人證明過它會紅】)──
  # 🔴 時間戳一律 2021+:規則①只回頭看【更早】的檔,用更晚的戳才不會污染上面那 16 格。
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$FX/20210101000000_r2_clean.sql"
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- 結語:零留痕驗證見 runbook\n-- 本 repo 的常態寫法\n' > "$FX/20210102000000_r2_trailing_comment.sql"
  printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- 註解\nSELECT 2;\n' > "$FX/20210103000000_r2_comment_then_sql.sql"
  printf 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n' > "$FX/20210104000000_r2_midcommit.sql"
  printf 'BEGIN;\nROLLBACK;\nSELECT 2;\nCOMMIT;\n' > "$FX/20210105000000_r2_midrollback.sql"
  printf 'BEGIN;\nDO $x$ BEGIN NULL; END $x$;\nCOMMIT;\n-- 尾註\n' > "$FX/20210106000000_r2_plpgsql_end.sql"
  fail=0; n=0
  check() { # $1 fixture  $2 須命中的字面  $3 不得命中的字面(可空)  $4 案名
    local out; out="$(bash "$SELF" "$FX/$1" 2>&1)"; n=$((n+1))
    if ! printf '%s' "$out" | grep -q -- "$2"; then echo "❌ $4:期望含「$2」"; fail=1; fi
    if [ -n "$3" ] && printf '%s' "$out" | grep -q -- "$3"; then echo "❌ $4:不得含「$3」"; fail=1; fi
  }
  check 20200102000000_redef.sql          '合法,不紅'          '新物件'    '重定義既有函式 ⇒ 綠'
  check 20200103000000_new.sql            '新物件'             '合法,不紅' '真新物件用 OR REPLACE ⇒ 紅'
  check 20200104000000_ine.sql            'IF NOT EXISTS 命中' ''          'IF NOT EXISTS ⇒ 照紅'
  check 20200105000000_badname.sql        '解析失敗'           ''          '爛名字 ⇒ fail-closed 紅'
  check 20200100000000_before_base.sql    '新物件'             ''          '定義只在【更晚】的檔 ⇒ 此刻仍是新物件 ⇒ 紅(時間方向)'
  check 20200106000000_ghost_real.sql     '新物件'             '合法,不紅' '更早檔只在字串裡提到它 ⇒ 不算定義 ⇒ 紅(剝 dollar-quote)'
  check 20200107000000_schema_mismatch.sql '新物件'            '合法,不紅' '更早是 pcm_cron.foo2、本檔 public.foo2 ⇒ 不同身分 ⇒ 紅'
  check 20200108000000_multiline_new.sql  '新物件'             ''          'CREATE⏎OR REPLACE 多行寫法的新物件 ⇒ 仍紅(不得零命中變綠)'
  check 20200109000000_trigger_other_table.sql '新物件'        '合法,不紅' '同名 trigger 但 ON 不同表 ⇒ 新物件 ⇒ 紅'
  check 20200110000000_trigger_same_table.sql  '合法,不紅'     '新物件'    '同名 trigger 同表 ⇒ 重定義 ⇒ 綠'
  check 20200111000000_view_redef.sql     '合法,不紅'          '新物件'    'VIEW 重定義 ⇒ 綠'
  check 20200112000000_quoted.sql         '解析失敗'           ''          '引號識別字 ⇒ fail-closed 紅'
  check 20200113000000_cm_real.sql        '新物件'             '合法,不紅' '更早檔只在 /* */ 區塊註解裡提到它 ⇒ 不算定義 ⇒ 紅(剝區塊註解)'
  check 20200114000000_eat1_redef.sql     '合法,不紅'          '新物件'    '更早檔的 -- 註解含 /* ⇒ 不得開區塊吃掉下面的真定義(must-fix 1)'
  check 20200115000000_eat2_redef.sql     '合法,不紅'          '新物件'    '更早檔的 -- 註解含 $gate$ ⇒ 不得開 dollar 吃掉下面的真定義(假紅 3)'
  check 20200116000000_eat3_redef.sql     '合法,不紅'          '新物件'    '更早檔 /* -- */ 同一行 ⇒ 先剝 -- 會砍掉 */;誰先出現誰算數'
  check 20210101000000_r2_clean.sql            '恰好 1 次'          '🔴'        '規則②:BEGIN…COMMIT 收在最後 ⇒ 綠'
  check 20210102000000_r2_trailing_comment.sql '恰好 1 次'          '🔴'        '規則②:COMMIT 後面只有註解 ⇒ 綠(修掉 23 支誤擋的那一格)'
  check 20210103000000_r2_comment_then_sql.sql '不是最後一句 SQL'   ''          '規則②:COMMIT 後面還有真 SQL ⇒ 照樣紅(上一格的負對照,證明沒放寬)'
  check 20210104000000_r2_midcommit.sql        '命中 2 次'          ''          '規則②:同一行 select 1; commit; ⇒ 紅'
  check 20210105000000_r2_midrollback.sql      '命中 2 次'          ''          '規則②:中段 ROLLBACK ⇒ 紅'
  check 20210106000000_r2_plpgsql_end.sql      '恰好 1 次'          '🔴'        '規則②:plpgsql 的 END; 在 dollar-quote 裡 ⇒ 不得誤報'
  # ── 多檔那段的證人:一乾淨 + 一違規,順序【違規在後】(被忽略的就是後面那些)──
  n=$((n+1))
  if bash "$SELF" "$FX/20210101000000_r2_clean.sql" "$FX/20210104000000_r2_midcommit.sql" >/dev/null 2>&1; then
    echo "❌ 多檔:第二支違規卻回 0 ⇒ 多餘參數被安靜忽略"; fail=1
  fi
  n=$((n+1))
  if ! bash "$SELF" "$FX/20210101000000_r2_clean.sql" "$FX/20210102000000_r2_trailing_comment.sql" >/dev/null 2>&1; then
    echo "❌ 多檔:兩支都乾淨卻回非 0 ⇒ 該綠沒綠"; fail=1
  fi
  [ "$fail" = "0" ] && echo "✅ migration-static-checks --selftest $n/$n(規則①雙向 + 規則②雙向 + 多檔雙向)"
  exit "$fail"
fi

# ── 多檔:逐支跑、任一支紅就整體紅(2026-08-23 加)────────────────────────────
# 🔴 為什麼要有這段:本檔原本只讀 `$1`,多餘的參數【安靜地被忽略】。
#    實測(2026-08-23):第一支乾淨、第二支中段 COMMIT ⇒ 印「✅ 四道靜態檢查全過」、`rc=0`。
#    ⇒ **第二支從來沒有被檢查過,而畫面上與「兩支都過」長得一模一樣。**
#    這在今天是無害的(沒有呼叫端會餵多支),但只要有人把它掛進 lint-staged 就會變成承重的 ——
#    lint-staged 把【所有命中的檔】一次接在命令後面。⇒ 先修,不要等它變成事故。
if [ "$#" -gt 1 ]; then
  multi_rc=0
  for one in "$@"; do
    bash "$0" "$one" || multi_rc=1
  done
  exit "$multi_rc"
fi

F="${1:-}"
if [ -z "$F" ] || [ ! -f "$F" ]; then
  echo "用法:bash scripts/migration-static-checks.sh <migration.sql>" >&2
  exit 2
fi

RC=0

# ── 共用:剝掉 dollar-quoted 區塊($tag$…$tag$)────────────────────────────
# 🔴 為什麼一開始就剝:plpgsql 函式體裡有一堆長得像禁詞的東西 ——
#    `IF NOT EXISTS (SELECT …)` 是條件判斷、`END;` 是區塊結尾,
#    **兩者都與「CREATE 時跳過」「結束交易」完全無關,而字面一模一樣。**
#    ⇒ 用結構分,不用「出現」分。這是本 repo patterns 檔在教的同一條。
# 抽成函式(codex 2026-08-23 HIGH):規則①要對【更早的 migration】做同樣的剝殼 —— 不剝的話,
# 更早檔 DO block 自檢裡的字串常數 `'… CREATE FUNCTION public.bar …'`(本 repo 約 43 行這種東西)
# 會被當成 bar 的定義,讓之後真正首次建立的 OR REPLACE bar 被誤放行。
# 🔴 三種「不是 code 的東西」—— dollar-quote / `--` 行註解 / `/* */` 區塊註解 —— **一趟掃描、照它們在
#    這一行出現的順序處理**,不分三段跑(code-reviewer 2026-08-23 must-fix 1 + 假紅 3):
#    · 分三段跑,先跑的那段會把【後面那段的註解內容】當成真的:區塊註解剝殼先跑 ⇒ `-- 說明 /*` 這種
#      行註解開了一個永不關閉的區塊 ⇒ 整檔往下吃光(真資料 207 支裡 4 支被吃光、29 行有這形狀);
#      dollar 剝殼先跑 ⇒ `-- 見下方 DO $gate$` 這種行註解開了一個 dollar 區塊 ⇒ 吃到 300 行外的真 `$gate$`
#      (20260815040000:173 → :506,把 :325 的真定義吃掉 = 假紅 3)。
#    · 反過來「先剝 `--` 再剝區塊」一樣錯:`/* 備註 -- 說明 */` 同一行會把 `*/` 砍掉 ⇒ 區塊永不關閉
#      (真資料實測 0 行,但 fixture 釘住它)。⇒ 唯一對的做法是誰先出現誰算數。
#    行數守恆:每一行照印(被剝的部分變空),行號不漂。⚠️ 跨行單引號字串不剝(已知限度)。
strip_sql() {
  awk '
    {
      line = $0; out = ""
      while (length(line) > 0) {
        if (state == "dollar") {
          i = index(line, tag)
          if (i > 0) { line = substr(line, i + length(tag)); state = "" } else { line = "" }
        } else if (state == "block") {
          i = index(line, "*/")
          if (i > 0) { line = substr(line, i + 2); state = "" } else { line = "" }
        } else {
          pd = index(line, "--"); pb = index(line, "/*")
          pq = match(line, /\$[A-Za-z_0-9]*\$/) ? RSTART : 0; ql = RLENGTH
          best = 0
          if (pd > 0) best = pd
          if (pb > 0 && (best == 0 || pb < best)) best = pb
          if (pq > 0 && (best == 0 || pq < best)) best = pq
          if (best == 0) { out = out line; line = "" }
          else if (best == pd) { out = out substr(line, 1, pd - 1); line = "" }
          else if (best == pb) { out = out substr(line, 1, pb - 1); line = substr(line, pb + 2); state = "block" }
          else { out = out substr(line, 1, pq - 1); tag = substr(line, pq, ql); line = substr(line, pq + ql); state = "dollar" }
        }
      }
      print out
    }
  ' "$1"
}
# 規則①專用視圖:把單獨一行的 `CREATE` 接到下一行(合法 SQL 可寫成 CREATE⏎OR REPLACE …,
# 只看單行會讓真新物件零命中直接綠 = fail-open)。接合後在 CREATE 那一行印、下一行留空 ⇒ 行號不漂。
join_create() {
  awk '
    pending != "" { print pending " " $0; pending = ""; print ""; next }
    /^[ \t]*[Cc][Rr][Ee][Aa][Tt][Ee][ \t]*$/ { pending = $0; next }
    { print }
    END { if (pending != "") print pending }
  '
}
STRIPPED="$(mktemp)"
JOINED="$(mktemp)"
EARLIER_CACHE="$(mktemp -d)"
trap 'rm -rf "$STRIPPED" "$JOINED" "$EARLIER_CACHE"' EXIT
strip_sql "$F" > "$STRIPPED"
join_create < "$STRIPPED" > "$JOINED"

echo "── ① CREATE … IF NOT EXISTS 一律禁;OR REPLACE 只准【重定義既有物件】──"
# 🔴 三次誤報的修法都在這一段:
#    原版 ①:沒剝行註解 ⇒ 抓到【檔頭那段解釋這條規則的註解】
#    原版 ②:只找裸字面 ⇒ 抓到 plpgsql 的 `IF NOT EXISTS (SELECT …)`(條件判斷,不是 DDL)
#    原版 ③(2026-08-23 主視窗判修閘):無條件禁 OR REPLACE ⇒ 對兩支【已上線】的檔誤報
#      (20260820100000 / 20260810170000 —— 它們是重定義既有函式,OR REPLACE 是正確寫法)。
#      一道長期紅著的閘會訓練人略過整張清單 ⇒ 改成:**OR REPLACE 的物件名在【更早的
#      migration】查無定義才算違規**(新物件才必須裸 CREATE;重定義本來就該 OR REPLACE)。
# 🔴 本段的限度(不要只當它過了):
#    · 「更早」= 同目錄裡檔名字典序在前(= 時間戳在前);**分母是磁碟不是 git** ⇒
#      共用樹上鄰窗 untracked 的更早檔也算 —— 真新物件可能因此被放行,反向誤報則不會。
#    · 身分 = 型別 + schema(省略視為 public)+ 名字;TRIGGER 另加 ON 目標(trigger 名以表為範圍)。
#      🔴 刻意不分 overload 簽章(codex R2 HIGH;主視窗 2026-08-23 裁【甲】= 層級停在「物件名」):
#      代價寫清楚 —— 更早有 foo(integer)、本檔 OR REPLACE foo(text) 是【真正的新 overload】,
#      本規則會判「重定義」而放行 ⇒ 一個沒有前世代的新物件靜靜通過。
#      不修的理由:PCM 函式參數多行 + DEFAULT + 型別別名(timestamptz / timestamp with time zone),
#      比簽章會在合法重定義上大量假紅,而假紅訓練人略過整張清單 —— 正是本次修閘的病。
#      🔴 判甲的分母(2026-08-23 量,可重跑):同名多簽章的函式名 ⇒ 7(admin_cancel_order /
#      admin_record_item_receipt / get_payment_anomaly_alert_summary / admin_search_orders /
#      admin_upsert_item_procurement / search_catalog_by_vehicle / create_order);逐個核:6 個有
#      DROP FUNCTION 配對(= 換簽章的演化,不並存)、1 個(admin_record_item_receipt)是型別別名拼法差
#      ⇒ **真正並存的 overload = 0**。量法:對每個 CREATE FUNCTION 擷取到參數括號閉合、去 DEFAULT、
#      正規化空白後按名分組數簽章,再對多簽章者 grep '^DROP FUNCTION … <name>(' 配對
#      (完整 awk 在 docs/phase-1-backlog.md #855)。**那個 0 變成非 0 的那天,甲要重估。**
#      更早檔與本檔都剝 dollar-quote 與 /* */ 區塊註解 ⇒ 字串/註解裡的定義兩邊都看不見(對稱);
#      跨行單引號字串不剝(已知限度,PG 函式體慣用 dollar-quote)。
#    · 只懂 FUNCTION / PROCEDURE / VIEW / TRIGGER 的重定義判定;其他型別、引號識別字、解析不出
#      ⇒ 一律 fail-closed 紅(請用裸 CREATE 或小寫無引號命名),不靜默放行。
#    · 本 repo 實測分母(2026-08-23,207 支;**用與本規則同一把尺 = 行首錨定**,code-reviewer must-fix 4:
#      前一版用不錨定 grep 量到 VIEW 40 / TRIGGER 2,是另一把尺的數):
#        非 public schema 定義 4(pg_temp / pcm_cron):
#          grep -hiE '^CREATE (OR REPLACE )?(FUNCTION|VIEW|PROCEDURE|TRIGGER)[[:space:]]+[a-z_]+\.' supabase/migrations/*.sql | grep -viE '[[:space:]]public\.' | wc -l
#        OR REPLACE VIEW 18 / TRIGGER **0** / 多行 CREATE⏎OR REPLACE 0 / 引號識別字 0:
#          grep -ciE '^[[:space:]]*CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+VIEW' supabase/migrations/*.sql | awk -F: '{s+=$2} END{print s}'(TRIGGER 同式換字)
#      🔴 TRIGGER 分支(ON 目標解析 + FAIL 路徑)在真資料上樣本 = 0 ⇒ **只有 selftest fixture 驗過它**。
# 🔴 修閘當天量到的【真陽性】(與規則 ④ 的「歷史檔會紅」同形狀,處置也同):
#    20260820100000_d3b_void_manual_refund.sql:292 用 OR REPLACE 建了【無更早世代】的
#    admin_void_manual_refund(grep 全 migrations ⇒ 只此一處定義)⇒ 改後它仍紅,而那是對的:
#    當年規則沒分出這一格、它就這樣上線了。**紅在已上線的舊檔 = 規則變準了,不代表要回頭改那支檔**
#    (已 apply 的 migration 不動);本工具只在新檔手跑,歷史檔不會被它擋住任何人。
# 🔴 而它【不是只有一筆】(code-reviewer must-fix 2:規則④ 在下面揭了 8 支歷史檔會紅,本規則要揭同一個數):
#    2026-08-23 對 207 支全量跑本規則 ⇒ **48 檔 / 71 筆「新物件用 OR REPLACE」+ 3 檔 IF NOT EXISTS**
#    (20260723120000 / 20260809160000 / 20260816010000)。量法:
#      for f in supabase/migrations/*.sql; do bash scripts/migration-static-checks.sh "$f" 2>/dev/null | awk '/^── ①/{a=1;next} /^── ②/{a=0} a && /^🔴 :/'; done | wc -l
#    歷史上「新函式用 OR REPLACE」是常態寫法,不是 1 筆意外 —— 本規則從此紅的是【新檔】,舊檔照 ④ 的處置。
INE_HITS=$(grep -niE '^[[:space:]]*create[[:space:]].*if[[:space:]]+not[[:space:]]+exists' "$STRIPPED" || true)
R1_OK=1
if [ -n "$INE_HITS" ]; then
  echo "🔴 IF NOT EXISTS 命中(剝註解後):"; echo "$INE_HITS" | sed 's/^/     /'
  echo "   ⇒ 撞名要當場紅,不要靜靜跳過。跳過之後,你的 REVOKE 與斷言會對著那個既有物件跑"
  echo "      而且很可能通過 —— 拿到綠燈,而這支 migration 什麼都沒建。"
  RC=1; R1_OK=0
fi
# 從一行 `CREATE [OR REPLACE] <型別> <名字> … [ON <目標>]` 抽出 型別 / schema.名字 / ON 目標。
# 輸出三個以 TAB 分隔的欄位;解析不出或不支援 ⇒ 印 `FAIL<TAB>原因`。
parse_create_line() {
  printf '%s\n' "$1" | awk '
    {
      # 全行先 tolower(BSD awk 沒有 IGNORECASE;名字反正要小寫、引號識別字已拒絕 ⇒ 不失真)
      line = tolower($0)
      sub(/^[ \t]*create[ \t]+(or[ \t]+replace[ \t]+)?/, "", line)
      if (match(line, /^[A-Za-z]+/) == 0) { print "FAIL\t抓不到型別"; exit }
      type = tolower(substr(line, RSTART, RLENGTH)); line = substr(line, RLENGTH + 1)
      if (type != "function" && type != "procedure" && type != "view" && type != "trigger") { print "FAIL\t不支援的型別 " type "(本規則只懂 FUNCTION/PROCEDURE/VIEW/TRIGGER;請用裸 CREATE)"; exit }
      sub(/^[ \t]+/, "", line)
      if (match(line, /^[^ \t(]+/) == 0) { print "FAIL\t抓不到名字"; exit }
      name = substr(line, RSTART, RLENGTH); line = substr(line, RLENGTH + 1)
      if (index(name, "\"") > 0) { print "FAIL\t引號識別字不支援(請用小寫無引號命名)"; exit }
      if (name !~ /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/) { print "FAIL\t名字含不支援的字元"; exit }
      name = tolower(name); if (index(name, ".") == 0) name = "public." name
      target = ""
      if (type == "trigger") {
        if (match(line, /[ \t]on[ \t]+[^ \t(]+/) == 0) { print "FAIL\tTRIGGER 同一行抓不到 ON 目標(請把 ON <表> 與 CREATE 寫在同一行)"; exit }
        target = substr(line, RSTART, RLENGTH); sub(/^[ \t]on[ \t]+/, "", target)
        if (index(target, "\"") > 0) { print "FAIL\t引號識別字不支援"; exit }
        target = tolower(target); if (index(target, ".") == 0) target = "public." target
      }
      printf "%s\t%s\t%s\n", type, name, target
    }'
}
# 更早的 migration 裡有沒有同身分的定義(bare CREATE 或 OR REPLACE 都算)。更早檔同樣剝殼+接合。
# 印出【最早】含同身分定義的檔名(空 = 查無)。診斷與判定用同一把尺(codex R2 INFO)。
defined_earlier() { # $1 type  $2 schema.name  $3 trigger-target(可空)
  local t="$1" n="$2" tg="$3" schema="${2%%.*}" base="${2#*.}" pat
  if [ "$schema" = "public" ]; then pat="(public\\.)?${base}"; else pat="${schema}\\.${base}"; fi
  if [ "$t" = "trigger" ]; then
    local tsch="${tg%%.*}" tbase="${tg#*.}" tpat
    if [ "$tsch" = "public" ]; then tpat="(public\\.)?${tbase}"; else tpat="${tsch}\\.${tbase}"; fi
    pat="^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?trigger[[:space:]]+${pat}[[:space:]].*[[:space:]]on[[:space:]]+${tpat}([[:space:](]|\$)"
  else
    pat="^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?${t}[[:space:]]+${pat}([[:space:](]|\$)"
  fi
  grep -liE "$pat" "$EARLIER_CACHE"/*.sql 2>/dev/null | sort | head -1 | xargs -n1 basename 2>/dev/null
}
OR_HITS=$(grep -niE '^[[:space:]]*create[[:space:]]+or[[:space:]]+replace' "$JOINED" || true)
if [ -n "$OR_HITS" ]; then
  MIG_SIBLING_DIR=$(dirname "$F")
  THIS_BASE=$(basename "$F")
  for mf in "$MIG_SIBLING_DIR"/*.sql; do
    mb=$(basename "$mf")
    [ "$mb" \< "$THIS_BASE" ] || continue
    strip_sql "$mf" | join_create > "$EARLIER_CACHE/$mb"
  done
  while IFS= read -r hit; do
    LNO=${hit%%:*}
    LINE=${hit#*:}
    PARSED=$(parse_create_line "$LINE")
    OTYPE=""; ONAME=""; OTARGET=""
    IFS="$(printf '\t')" read -r OTYPE ONAME OTARGET <<< "$PARSED"
    if [ "$OTYPE" = "FAIL" ]; then
      echo "🔴 :$LNO OR REPLACE 解析失敗(fail-closed 照紅):$ONAME —— $LINE"
      RC=1; R1_OK=0
      continue
    fi
    FOUND=$(defined_earlier "$OTYPE" "$ONAME" "$OTARGET")
    if [ -n "$FOUND" ]; then
      echo "   ⚠️ :$LNO OR REPLACE ${OTYPE} ${ONAME}${OTARGET:+ ON $OTARGET} = 重定義(最早見 ${FOUND})⇒ 合法,不紅"
    else
      echo "🔴 :$LNO CREATE OR REPLACE ${OTYPE} ${ONAME}${OTARGET:+ ON $OTARGET} —— 同身分在更早的 migration 查無定義 ⇒ 它是【新物件】"
      echo "   ⇒ 新物件一律裸 CREATE:撞名要當場紅。OR REPLACE 會把撞名靜靜蓋掉,"
      echo "      而你的 REVOKE 與斷言照樣綠 —— 拿到綠燈,卻蓋掉了一個你不知道存在的東西。"
      RC=1; R1_OK=0
    fi
  done <<EOF_OR
$OR_HITS
EOF_OR
fi
if [ "$R1_OK" = "1" ] && [ -z "$INE_HITS" ]; then
  if [ -n "$OR_HITS" ]; then
    echo "✅ 無 IF NOT EXISTS;OR REPLACE 全部是重定義既有物件"
  else
    echo "✅ 零命中"
  fi
fi

echo "── ② 結束交易:commit / end / rollback 三種寫法 ───────────────────"
# 🔴 原版只找 '^ *commit;'。四臂實測它放行三種毒檔:
#      同一行 select 1; commit;  → 看不見(回 0)
#      中段 ROLLBACK;            → 過關(回 1)
#      中段 END;(COMMIT 同義字)  → 過關(回 1)
#    ROLLBACK 與 END 的毒性等同「中段 COMMIT」:交易中途結束,後面每句各自 autocommit。
#
# 🔴🔴 而把 END 加進來之後【誤報了】:plpgsql 的 `DO $x$ … END; $x$` 那個 END 也是這個字面。
#    ⇒ **字面分不出來,要用結構分**:用檔頭那個已經剝過 dollar-quote 的 $STRIPPED。
#    這正是本 repo patterns 檔在教的:用位置或結構判,不用「出現」判。
PAT='(^|;)[[:space:]]*(commit|end|rollback)[[:space:]]*;'
N=$(grep -ciE "$PAT" "$STRIPPED" || true)
# 🔴 LAST 必須量【剝殼後的最後一個有內容的行】,不是原始檔的總行數(2026-08-23 乾跑抓到)。
# 原版 `wc -l < "$F"` 拿【原始檔行數】去比對【$STRIPPED 的行號】—— 那是兩個座標系。
# 剝殼保留行數但把註解變成空行 ⇒ COMMIT 後面接一段結語註解(本 repo 的常態寫法)就會被判
# 「不在最後一行」。乾跑 212 支實測:這個形狀誤擋 23 支,而那 23 支全部是【COMMIT 之後只有註解】。
# ⇒ 誤擋的後果是有人照規矩寫而被工具懲罰,然後他下次繞過去。
# 語意沒有放寬:COMMIT 之後只要還有【真的 SQL】,那一行就是新的 LAST ⇒ 照樣紅(selftest 有負對照釘住)。
LAST=$(grep -n '[^[:space:]]' "$STRIPPED" | tail -1 | cut -d: -f1)
LINE=$(grep -niE "$PAT" "$STRIPPED" | tail -1 | cut -d: -f1)
if [ "$N" != "1" ]; then
  echo "🔴 命中 $N 次,預期恰好 1:"
  grep -niE "$PAT" "$STRIPPED" | sed 's/^/     /'
  echo "   ⇒ 檔頭 BEGIN、檔尾 COMMIT,中間不得有任何結束交易的語句。"
  RC=1
elif [ "$LINE" != "$LAST" ]; then
  echo "🔴 命中 1 次但不是最後一句 SQL(它在第 $LINE 行,而最後一句 SQL 在第 $LAST 行)"
  RC=1
else
  echo "✅ 恰好 1 次,且在最後一行(第 $LINE 行)"
fi

echo "── ③ 可授權物件數 vs 收權斷言清單長度 ────────────────────────────"
# 🔴 原版把 CREATE TRIGGER 也數進去 ⇒ 在合格檔上 3 vs 2 誤報漏列。
#    trigger 沒有 ACL,列進斷言清單反而會 to_regclass 找不到而紅。
OBJ=$(sed 's/--.*$//' "$F" | grep -cE '^CREATE (TABLE|VIEW|MATERIALIZED VIEW|FUNCTION)' || true)
# 🔴 必須支援【跨行的 ARRAY[...]】。原版只抓 `v_xxx text[] :=` 那一行,
#    而清單一旦換行(元素多了自然會換行),後面幾行就數不到
#    ⇒ 在一個【清單其實是對的】檔上誤報「有漏列」。2026-08-16 實際發生過。
#    ⇒ 從 `v_relations|v_functions` 那一行起,一路吃到 `]::text[]` 為止。
LST=$(awk '
  /^[[:space:]]*v_(relations|functions)[[:space:]]+text\[\][[:space:]]*:=/ { inlist=1 }
  inlist { print }
  inlist && /\]::text\[\]/ { inlist=0 }
' "$F" | grep -oE "'[^']+'" | wc -l | tr -d ' ')
if [ "$OBJ" != "$LST" ]; then
  echo "🔴 可授權物件 $OBJ 個,斷言清單列了 $LST 個 ⇒ 有漏列"
  echo "   ⇒ 收權斷言【只檢查你列出來的物件】:它防「忘記收權」,不防「忘記列」。"
  RC=1
else
  echo "✅ 兩邊都是 $OBJ 個"
fi

echo "── ④ 建了表就必須明寫 GRANT ───────────────────────────────────────"
# 🔴 2026-08-18 新增(G5 提案、主視窗批准)。它擋的是【下一個人】,不是這一支:
#    `E683-1` 收掉 public schema 對 anon/authenticated 的【預設】授權之後,
#    **新建的表不再自動帶授權** ⇒ 建表卻沒明寫 GRANT ⇒ 那張表對 service_role 以外的角色是隱形的,
#    而症狀是【上線後某個頁面讀不到東西】,不是 apply 當下紅。
#    ⇒ 量法依據(2026-08-18 當場跑):最近 10 支 migration 裡唯一有 CREATE TABLE 的那支(心跳表)
#      本來就明寫了 GRANT ⇒ 這條規則不是新規矩,是把既有慣例變成會紅的東西。
#
# 🔴🔴 **這道檢查的天花板,寫在它旁邊(主視窗要求)**:
#    · 它是**靜態字面比對** ⇒ **抓不到「GRANT 給錯角色」**(給了 anon 也算過)
#    · **抓不到「GRANT 寫在另一支檔」**(那是合法做法,而這裡會誤紅 ⇒ 用下方的豁免註解)
#    · 它只看「有沒有一行 GRANT 提到那張表」,**不驗權限集合** —— 那要靠 migration 自己的收權斷言
#    ⇒ **看到 ④ 綠,不代表這張表的權限是對的。**
#
# 🔴 **它會讓一批【歷史檔】變紅,而那不是那些檔有問題** —— 2026-08-18 當場量:
#    全 182 支 migration 裡 **8 支**會紅(`init_brands_categories` / `init_products` /
#    `init_product_variants` / `3ds_r1b1a_double_charge_anomaly_tables` / `241_checkout_consent` /
#    `w0b_shipping_idempotency` / `op1_order_payments_m` / `l5b_refund_ledger`)。
#    抽驗兩支確認**真的零 GRANT**(不是我的 regex 誤判)。
#    ⇒ 它們建表的時候 ADP 還在自動授權 ⇒ **紅在舊檔代表【規則變了】,不代表那支壞了。**
#    ⇒ ~~pre-commit 只掃**這次 staged 的檔**~~(2026-08-23 code-reviewer 更正:全 repo 零 pre-commit /
#      lint-staged 對 staged .sql 跑本工具;本工具是【新檔手跑】)⇒ 實務上不會擋住任何人,除非你手跑那 8 支。
#
# 豁免:同一支檔內寫 `-- static-checks:no-grant-needed <理由>` 即跳過(理由必填,會被印出來)。
CREATED=$(grep -oiE '^CREATE[[:space:]]+TABLE[[:space:]]+[a-z0-9_."]+' "$STRIPPED" \
          | grep -viE 'CREATE[[:space:]]+(TEMP|TEMPORARY|UNLOGGED)' \
          | awk '{print $3}' | tr -d '"' | sed 's/.*\.//' | sort -u || true)
EXEMPT=$(grep -iE -- '--[[:space:]]*static-checks:no-grant-needed' "$F" || true)
if [ -z "$CREATED" ]; then
  echo "✅ 本檔沒有 CREATE TABLE,這道不適用"
elif [ -n "$EXEMPT" ]; then
  echo "⚠️ 本檔宣告豁免(理由要看得懂,不然就是免責貼紙):"
  echo "$EXEMPT" | sed 's/^/     /'
else
  MISS=""
  for t in $CREATED; do
    grep -qiE "^GRANT[[:space:]].*[[:space:].\"]${t}([[:space:]]|\(|;|\"|$)" "$STRIPPED" || MISS="$MISS $t"
  done
  if [ -n "$MISS" ]; then
    echo "🔴 這些表建了、而本檔沒有一行 GRANT 提到它們:$MISS"
    echo "   ⇒ E683-1 之後,新表【不再自動帶授權】 ⇒ 沒明寫 GRANT = 它對 service_role 以外的角色是隱形的。"
    echo "   ⇒ 症狀不是 apply 當下紅,是【上線後某個頁面讀不到東西】。"
    echo "   ⇒ 若這張表【本來就不該給任何人】,或 GRANT 刻意寫在別支檔 ⇒"
    echo "      在本檔加一行:-- static-checks:no-grant-needed <理由>"
    RC=1
  else
    echo "✅ 建了 $(echo $CREATED | wc -w | tr -d ' ') 張表,每一張都有對應的 GRANT 行"
  fi
fi

echo "──────────────────────────────────────────────────────────────────"
if [ "$RC" = "0" ]; then
  echo "✅ 四道靜態檢查全過:$F"
else
  echo "🔴 有檢查未過:$F"
fi
echo "⚠️ 靜態檢查【不驗行為】—— 它證的是「我沒寫那個字面」,"
echo "   不證「撞名時會紅」。後者要在拋棄式 PG 上重跑一次同一支 SQL。"
exit "$RC"
