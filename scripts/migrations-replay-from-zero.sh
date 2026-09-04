#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 空庫從零依序 apply 全部 migration —— **可重跑的證物**
#
# 🛑 **為什麼有這一支**:板 `#299` / `#907` 記著一發 2026-08-25 的結果
#    (「214 支 ⇒ 195 成功 / 19 失敗」)—— 而那是**寫在散文裡的一次性數字**。
#    ⇒ 📌 **而它三天後就變成一個假的比較基準**:那個 `214` 沒有帶【它是哪一刻的分母】,
#      而今天 `supabase/migrations/` 已經是另一個數。
#    ⇒ **本支每一次都自己重數分母,不寫死任何一個數字。**
#
# ── 三態(照 scripts/greenlight.sh 的紀律)──────────────────────────────────
#   GREEN     全部 apply 成功
#   RED       有失敗 ⇒ **逐支列出是哪幾支**(不是只給一個數)
#   ENV-FAIL  拋棄式 PG 起不來 / 找不到 migrations
#   🔴 **ENV-FAIL 這一格非有不可**:一個「PG 沒起來」會讓每一支都失敗
#     ⇒ 它與「這棵樹真的有 237 支跑不起來」**印同一個數**。
#
# ── 🔴 正對照(沒有它,「0 失敗」與「它根本沒在數」是同一個東西)────────────
#   `--selftest` 會在最後**多插一支一定會失敗的 SQL**,那一支**必須被算進失敗數**。
#   ⇒ 它證明的是【這支腳本數得到失敗】,而不是【這棵樹很乾淨】。
#
# ── 🔴 射程 ──────────────────────────────────────────────────────────────
#   · 🔴 codex 抓(更正,原句作廢留痕):~~「沒有 Supabase 的角色、沒有 auth schema、沒有 extensions」~~
#     **那是假的** —— 本支會套 runbook §2 的 bootstrap,它**就建了**四個角色、`auth` schema、
#     `auth.uid()` 與 `pg_trgm`。⇒ 正確的說法是:**它建的是 runbook 目前列出來的那些,而那份清單
#     runbook 自己逐字說「還是不完整」** ⇒ **失敗的支數裡仍有一部分是【環境缺件】,不是 migration 的錯**
#     ⇒ 📌 **所以這個數字是【上界】,不是「有幾支真的壞了」。** 要分辨得逐支看錯誤訊息。
#   · 它答的是「從零重建這條路通不通」,**不答**「正式庫現在長什麼樣」。
#   · ⛔ ~~「只比對能不能 apply,**不驗 apply 之後的資料正確性**」~~
#     🔴 **2026-09-05 起這句話不再為真** —— apply 完之後多跑一段
#     `scripts/view-behaviour-fixtures.sql`:造資料、把四支寄信掃描 view 的**篩選行為**量一遍。
#     ⇒ ✅ 正確的說法是:**apply 之外, 它另外驗【那四支 view】的篩選, 而其餘每一支 migration
#       的行為仍然沒有被驗。** 📌 那一段有沒有跑, 下面會逐字印出來 —— 它跳過時**不算綠**。
#   · 🔴 codex 抓(寫成已知性質,不改行為):**每一支各自 `psql -f`,沒有把整串包成一個交易**
#     ⇒ 一支【自己沒寫 BEGIN/COMMIT】的 migration 失敗時,會留下前半段已生效的 DDL,
#     而那會改變後面幾支的成敗。**⇒ 所以這個數字不是「原子化 replay」的數字。**
#     ⚠️ **而這是刻意的**:真實的 apply(SQL Editor 手貼 / `db push` 逐支送)就是逐支的
#     ⇒ 包成一個大交易會量到一個【沒有人會遇到】的世界。
#
# 用法: bash scripts/migrations-replay-from-zero.sh [--selftest]
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
SELFTEST=0; STUB=0; KEEPDB=0
for a in "$@"; do
  case "$a" in
    --selftest) SELFTEST=1 ;;
    # 🔴 板 #299 記著的那個緩解:`scripts/d1-fitments-bootstrap.sql`(一支【不在 migrations 裡】的 stub)
    #    ⚠️ 它**不能在最前面套** —— 它對 `public.products` 有 FK ⇒ 2026-08-30 實測直接
    #      `ERROR: relation "public.products" does not exist`。**它必須插在序列中間**:
    #      在第一個引用 product_fitments_effective 的 migration 之前。
    #    ⇒ 📌 **「有沒有套這支 stub」與「在哪裡套」是兩個問題,而只有第二個答對了它才有用。**
    --with-fitments-stub) STUB=1 ;;
    # 🔵 `--keep-db` 只為了【建 fixture 時可以反覆重跑】—— 它不改變任何判定,
    #    只是不要在結尾把 PG 殺掉, 並把連線參數印出來。
    --keep-db) KEEPDB=1 ;;
    *) printf '🔴 不認得的參數: %s\n' "$a"; exit 2 ;;
  esac
done
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MDIR="$REPO/supabase/migrations"
[ -d "$MDIR" ] || { printf '🔴 找不到 %s ⇒ ENV-FAIL\n' "$MDIR"; exit 2; }
for c in initdb pg_ctl psql; do command -v "$c" >/dev/null || { printf '🔴 缺 %s ⇒ ENV-FAIL\n' "$c"; exit 2; }; done

D=$(mktemp -d "${TMPDIR:-/tmp}/replay.XXXXXXXX") \
  || { echo "🔴 建不出暫存目錄(mktemp)⇒ 這不是量測結果, 也不是乾淨 ⇒ ENV-FAIL"; exit 9; }
# 🔴 codex nit:固定埠在八窗並跑時會撞 ⇒ 由 PID 導出,並確認沒人佔用。
PG=$(( 54000 + ($$ % 900) )); KEEP=0
while lsof -nP -iTCP:"$PG" -sTCP:LISTEN >/dev/null 2>&1; do PG=$((PG+1)); done
cleanup(){
  if [ "${KEEPDB:-0}" = 1 ]; then
    printf '\n🔵 --keep-db: PG 沒有停, 目錄沒有刪。反覆跑 fixture 用:\n'
    printf '   psql -h /tmp -p %s -U postgres -d postgres -v ON_ERROR_STOP=1 -f <你的.sql>\n' "$PG"
    printf '   收工:  pg_ctl -D %s/pg stop -m immediate ; rm -rf %s\n' "$D" "$D"
    return
  fi
  pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then printf '🛑 非綠 ⇒ 逐支 log 保留在 %s/logs\n' "$D"; else rm -rf "$D"; fi; }
trap cleanup EXIT
mkdir -p "$D/logs"

initdb -D "$D/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$D/i.log" 2>&1 \
  || { printf '🔴 initdb 失敗 ⇒ ENV-FAIL(這【不是】migration 的問題)\n'; KEEP=1; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PG -k /tmp" -l "$D/pg.log" start >/dev/null 2>&1 \
  || { printf '🔴 PG 起不來 ⇒ ENV-FAIL(這【不是】migration 的問題)\n'; KEEP=1; exit 2; }
psql -h /tmp -p "$PG" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 \
  || { printf '🔴 PG 起了但連不上 ⇒ ENV-FAIL\n'; KEEP=1; exit 2; }

# ── 🔴 PCM 專屬 bootstrap:**從 runbook 原樣抽出,不手抄** ──────────────────
#   理由與本 repo 其他 harness 相同:手抄的兩份一起抄錯時 harness 全綠,而真的世界會炸。
#   🔴 而 runbook 自己逐字警告過兩件事,照抄不簡化:
#     ①「**本清單還是不完整,不要讀成【照著跑就會全綠】**」
#     ②「你要驗的那支若在下游,**先看第一支失敗的錯是什麼**,不要看總數」
#       ⇒ 所以本支把【第一支失敗】獨立印出來,不要只給一個總數。
RB="$REPO/docs/runbooks/throwaway-postgres-for-migration-verification.md"
[ -f "$RB" ] || { printf '🔴 找不到 runbook %s ⇒ ENV-FAIL(bootstrap 沒有來源)\n' "$RB"; KEEP=1; exit 2; }
awk '/^## 2\. .*bootstrap/{s=1} s&&/^```sql$/{f=1;next} f&&/^```$/{exit} f' "$RB" > "$D/bootstrap.raw"
# 🔴 **把【業務型別】那一段切掉 —— 而理由不是我覺得,是 runbook 自己寫的**:
#    那一行逐字標著「業務型別(**依你要驗的那支 migration 需要什麼再加**)」
#    ⇒ 它是為了【單獨驗某一支下游 migration】而預先造的,**不是平台前置**。
#    而本支要做的是【從零依序跑完全部】—— 那些型別由 migration 自己建
#    ⇒ 預先造它 ⇒ 第一支就 `type "member_tier" already exists`(2026-08-30 實測)。
#    ⇒ 📌 **runbook 自己問過一句「你用的是哪一份 bootstrap?」—— 這就是那句話的實例:**
#      同一份 bootstrap,對「驗一支」是對的,對「從零全跑」是錯的。
awk '/^-- 業務型別/{exit} {print}' "$D/bootstrap.raw" > "$D/bootstrap.sql"
BS_BYTES=$(wc -c < "$D/bootstrap.sql" | tr -d ' ')
# 🔴 codex must-fix:上一版只驗「有 service_role 且夠長」⇒ marker(`-- 業務型別`)改名時
#    型別會被一起執行、必要件若被移到 marker 之後會被【靜默切掉】,兩種都通得過那個檢查。
#    ⇒ 逐項點名 bootstrap 必須有的東西;少任何一項就 ENV-FAIL 並說出少了哪一個。
# 🔴🔴 而這些字面必須是【語句形狀】,不能是裸字 —— 2026-08-30 實測踩到:
#    第一版用裸字 `auth.uid` 當哨兵 ⇒ 我在 runbook 裡寫的**解釋性註解**也含那四個字
#    ⇒ 把那個 `CREATE FUNCTION` 整行刪掉,這道檢查**照樣通過**。
#    📌 **哨兵的字面不該與被掃描的內容共用** —— 本 session 第三次撞到同一族,
#      而這一次是我自己寫的註解在冒充那道語句。⇒ 一律錨在行首的 DDL 動詞上。
for need in '^[[:space:]]*CREATE ROLE service_role' '^[[:space:]]*CREATE ROLE anon' \
            '^[[:space:]]*CREATE ROLE authenticated' '^[[:space:]]*CREATE ROLE authenticator' \
            '^[[:space:]]*CREATE SCHEMA auth' '^[[:space:]]*CREATE TABLE auth\.users' \
            '^[[:space:]]*CREATE FUNCTION auth\.uid' '^[[:space:]]*CREATE EXTENSION.*pg_trgm'; do
  grep -qE "$need" "$D/bootstrap.sql" \
    || { printf '🔴 從 runbook 抽出來的 bootstrap 少了「%s」⇒ ENV-FAIL(runbook §2 被改動, 或那一刀切錯位置)\n' "$need"; KEEP=1; exit 2; }
done
grep -qE '^[[:space:]]*CREATE TYPE' "$D/bootstrap.sql" \
  && { printf '🔴 抽出來的 bootstrap 還含 CREATE TYPE ⇒ 那一刀沒切到(marker 改名了?)⇒ ENV-FAIL\n'; KEEP=1; exit 2; }
grep -qE '^[[:space:]]*CREATE ROLE service_role' "$D/bootstrap.sql" && [ "$BS_BYTES" -gt 300 ] \
  || { printf '🔴 從 runbook 抽不到 bootstrap(%s bytes)⇒ ENV-FAIL(不是 migration 的問題)\n' "$BS_BYTES"; KEEP=1; exit 2; }
psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D/bootstrap.sql" >"$D/bs.log" 2>&1 \
  || { printf '🔴 bootstrap 自己跑不起來 ⇒ ENV-FAIL\n'; sed 's/^/    /' "$D/bs.log" | head -3; KEEP=1; exit 2; }
printf '   bootstrap: 從 runbook §2 原樣抽出 %s bytes(不是手抄;已切掉【業務型別】那段, 理由見碼註)\n' "$BS_BYTES"

# 🔴 分母當下重數,不寫死。板上那個 214 就是死在這一格。
LIST="$D/list.txt"
ls "$MDIR"/*.sql 2>/dev/null | sort > "$LIST"
if [ "$SELFTEST" = 1 ]; then
  # 🔴 正對照:一支【一定會失敗】的 SQL。它必須出現在失敗清單裡。
  printf 'SELECT * FROM public.zz_this_table_does_not_exist_on_purpose;\n' > "$D/99999999999999_zz_selftest_must_fail.sql"
  echo "$D/99999999999999_zz_selftest_must_fail.sql" >> "$LIST"
fi
TOTAL=$(grep -c . "$LIST")
[ "$TOTAL" -gt 0 ] || { printf '🔴 一支 migration 都沒數到 ⇒ ENV-FAIL(尺沒接上, 不是樹是空的)\n'; KEEP=1; exit 2; }

printf '══ 空庫從零依序 apply\n'
printf '   分母(本發當下重數): %s 支\n' "$TOTAL"
printf '   來源: %s\n' "$MDIR"
[ "$SELFTEST" = 1 ] && printf '   🔴 --selftest: 已多插 1 支【一定會失敗】的正對照\n'
# 🔴 第一個引用者【當下算】,不寫死 —— 板上那個「插在 #55 之前」是序號,而序號會漂。
# 🔴 codex must-fix ×2:①原本用 `grep -l` ⇒ **註解裡提到也算**、子字串也算
#    ②若日後 `#299` 落地(真的有一支 migration 建它)⇒ 還插 stub 就會撞 duplicate
#    ⇒ 剝掉註解行再找;且先問「有沒有人已經建它」。
if [ "$STUB" = 1 ]; then
  # 🔴 Fable R3 F6:結尾要有邊界 —— 少了它, `product_fitments_effective` 會命中
  #    `..._staging` / `..._sync_log`(板 b4-PFEDDL2 那兩張表落地那天就是引信)。
  CREATOR=$(grep -lE '^[[:space:]]*CREATE[[:space:]]+TABLE([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?[[:space:]]+(public\.)?product_fitments_effective([^a-z_]|$)' "$MDIR"/*.sql 2>/dev/null | head -1)
  FIRST_CONSUMER=$(for m in "$MDIR"/*.sql; do
      # 🔴 同 F6:裸子字串會命中 `..._staging` / `..._sync_log` ⇒ 加尾邊界。
      sed -e 's,--.*,,' "$m" | grep -qE 'product_fitments_effective([^a-z_]|$)' && { basename "$m"; break; }
    done)
  [ -n "$FIRST_CONSUMER" ] || { printf '🔴 找不到任何【非註解】引用 product_fitments_effective 的 migration ⇒ stub 插不進去 ⇒ ENV-FAIL(不要把這一發讀成 without stub)\n'; KEEP=1; exit 2; }
  # 🔴🔴 2026-09-01 線【出貨】改:原本【只要有人建它就 exit 2】—— 而那漏了一個世界。
  #    ⇒ 「有一支 migration 建它」與「那支跑得【夠早】」是**兩個宣稱**,
  #      而原本這道閘把前者當成後者。
  #    ⚠️ 實例:`20260901170000_m4b_pfe_ddl_into_version_control.sql` 建它,
  #      而第一個消費者是 `20260712183000` ⇒ 建表跑在【第 11 個讀它的人之後】⇒ 重放照樣炸。
  #      ⇒ 而原本這道閘會在那個世界回 exit 2 ⇒ **stub 這條【本來會動】的排練路被關掉,**
  #        **而 without-stub 那條照樣在 20260712 炸 ⇒ 兩條路同時斷。**
  #    ⇒ ✅ 判準改成【檔名排序】:creator 排在 first consumer 之前才算真的解掉。
  if [ -n "$CREATOR" ]; then
    CREATOR_B=$(basename "$CREATOR")
    if [ "$CREATOR_B" \< "$FIRST_CONSUMER" ] || [ "$CREATOR_B" = "$FIRST_CONSUMER" ]; then
      printf '🔴 已經有 migration 建 product_fitments_effective(%s), 而它排在第一個消費者(%s)之前 ⇒ --with-fitments-stub 已不適用, 拿掉它重跑\n' "$CREATOR_B" "$FIRST_CONSUMER"
      KEEP=1; exit 2
    fi
    printf '   ⚠️  有一支 migration 建它(%s), 而它排在第一個消費者(%s)【之後】\n' "$CREATOR_B" "$FIRST_CONSUMER"
    printf '   ⇒ 從零重放【仍然】需要 stub。本發繼續插 stub, 而那代表那支 creator 沒有解掉順序問題(板 ⟦b4-PFEREPLAY1⟧)。\n'
    # 🔵 Fable R3 F1 的另一半:stub 與 creator 都用裸 CREATE TABLE ⇒ 本來會在 creator 那一支撞
    #    `relation already exists` ⇒ **那條路會帶一支自傷的紅, 而沒有任何一行說那個紅是預期的**。
    #    ✅ 已解:`scripts/d1-fitments-bootstrap.sql` 現在裝一個【讓位】事件觸發器 ——
    #       creator 來建表時 stub 自己退場(開一次就拆掉自己)。
    #    🛑 而那句話要印出來, 因為**下一個看到 `already exists` 的人不會去讀那支 bootstrap**:
    printf '   🔵 stub 會在 creator 建表時自動讓位(d1-fitments-bootstrap.sql 的事件觸發器)⇒ 不會撞。\n'
    printf '   🛑 若你【真的】看到 relation already exists:那是讓位機制沒生效, 不是要你把 creator 改回 IF NOT EXISTS ——\n'
    printf '      那個改法會推翻 codex R1/R2 兩輪的核心設計(migration-static-checks 規則① 明文禁它)。\n'
  fi
  printf '   🔵 --with-fitments-stub: 第一個引用者(已剝註解) = %s\n' "$FIRST_CONSUMER"
fi


OK=0; NG=0; FAILED="$D/failed.txt"; : > "$FAILED"
STUB_DONE=0
while IFS= read -r f; do
  b=$(basename "$f")
  # stub 插在【第一個消費者】之前。消費者是當下算的,不寫死檔名。
  if [ "$STUB" = 1 ] && [ "$STUB_DONE" = 0 ] && [ "$b" = "$FIRST_CONSUMER" ]; then
    if psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
         -f "$REPO/scripts/d1-fitments-bootstrap.sql" > "$D/logs/_stub.log" 2>&1; then
      STUB_DONE=1; printf '   🔵 已在 %s 之前插入 d1-fitments-bootstrap.sql\n' "$b"
    else
      # 🔴 codex must-fix:上一版只警告然後繼續 ⇒ 那一發的結果其實是【without stub】,
      #    而它頂著 --with-fitments-stub 的標題印出來。⇒ 硬紅,不要讓它冒充。
      printf '   🔴 stub 套用失敗 ⇒ 這一發【不是】with-stub 的結果 ⇒ 中止, 不要拿下面的數字\n'
      sed 's/^/      /' "$D/logs/_stub.log" | head -3; KEEP=1; exit 2
    fi
  fi
  if psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" \
       > "$D/logs/$b.log" 2>&1; then
    OK=$((OK+1))
  else
    NG=$((NG+1)); printf '%s\n' "$b" >> "$FAILED"
  fi
done < "$LIST"

# 🔴 codex must-fix:PG 只在開跑前驗過活。中途斷掉 ⇒ 每一支都失敗,而那會被印成 RED
#    ⇒ 它與「這棵樹真的有 N 支跑不起來」印同一個數。⇒ 跑完再驗一次活。
psql -h /tmp -p "$PG" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 \
  || { printf '🔴 跑完之後 PG 連不上 ⇒ 它中途死了 ⇒ ENV-FAIL(上面每一個數字作廢)\n'; KEEP=1; exit 2; }
# ── 🔴 apply 之後:四支寄信掃描 view 的【行為】fixture(⟦b4-VIEWSQLUNTESTED⟧)────
#    🛑 它為什麼在這裡而不是另起一支:那四支 view 要跑在【從零重放出來的】schema 上,
#      而這顆 PG 就是那個 schema。另起一支 = 另造一份 schema = 兩份會分岔。
FXSQL="$REPO/scripts/view-behaviour-fixtures.sql"
FXNG=0
if [ ! -f "$FXSQL" ]; then
  printf '\n🔴 view 行為 fixture 不存在(%s)⇒ 這一段【沒有跑】, 不要讀成通過\n' "$FXSQL"; FXNG=1
else
  # 🔴 四支 view 有任何一支不在 ⇒ fixture 自己的前置閘會擋下來並說是哪一支。
  #    ⇒ 它與「跑了而且篩對了」**不會**印同一句話。
  if psql -h /tmp -p "$PG" -U postgres -d postgres -f "$FXSQL" > "$D/logs/_fixtures.log" 2>&1; then
    printf '\n── view 行為 fixture: ✅ 通過 %s 格\n' "$(grep -c 'NOTICE:  ✅' "$D/logs/_fixtures.log")"
    printf '   (集合比對 4 + 整段 WHERE 突變 4 + 逐條述詞 19;明細見 %s/logs/_fixtures.log)\n' "$D"
  else
    FXNG=1
    printf '\n🔴🔴 view 行為 fixture 失敗 —— 這與「有幾支 migration apply 不起來」是【兩件事】:\n'
    grep -m3 -E 'ERROR' "$D/logs/_fixtures.log" | sed 's/^/   /'
  fi
fi

printf '\n── 結果: 分母 %s ｜ 成功 %s ｜ 失敗 %s ｜ view 行為 fixture %s\n' \
  "$TOTAL" "$OK" "$NG" "$([ "$FXNG" = 0 ] && echo 通過 || echo 🔴失敗)"
if [ $((OK+NG)) -ne "$TOTAL" ]; then
  printf '🔴 成功+失敗(%s) 不等於分母(%s) ⇒ 有支沒跑到 ⇒ 本發作廢\n' "$((OK+NG))" "$TOTAL"; KEEP=1; exit 1
fi

if [ "$NG" -gt 0 ]; then
  # 🔴 runbook 逐字:「先看【第一支失敗】的錯是什麼, 不要看總數」——
  #    因為第一支斷掉之後, 下游每一支的 `relation does not exist` 都是它的回音,
  #    而那些回音會把總數撐大成一個看起來像「環境很嚴格」的數字。
  FIRST=$(head -1 "$FAILED")
  printf '\n🔴🔴 【第一支失敗】(看這個, 不要看總數):\n'
  printf '   %s\n   %s\n' "$FIRST" "$(grep -m1 -E 'ERROR' "$D/logs/$FIRST.log" | sed 's/.*ERROR:  *//' | cut -c1-100)"
  printf '\n🔴 全部失敗清單(逐支第一行錯誤):\n'
  while IFS= read -r b; do
    printf '  %-64s %s\n' "$b" "$(grep -m1 -E 'ERROR' "$D/logs/$b.log" | sed 's/.*ERROR:  *//' | cut -c1-70)"
  done < "$FAILED"
fi

if [ "$SELFTEST" = 1 ]; then
  printf '\n── --selftest 判定(它驗的是【這支腳本數不數得到失敗】, 不是這棵樹乾不乾淨)\n'
  # 🔴 codex must-fix:上一版 selftest 通過之後仍因 NG>0 回 1
  #    ⇒ 「selftest 通過」與「一般 RED」與「selftest 失敗」三種狀態**同一個 rc**
  #    ⇒ 沒有機器判得出來。⇒ selftest 模式的 rc 只回答【它數不數得到失敗】這一件事。
  if grep -q 'zz_selftest_must_fail' "$FAILED"; then
    printf '  ✅ 正對照那一支被算進失敗數 ⇒ 這支腳本數得到失敗(rc=0)\n'
    printf '  ⚠️ 而這個 rc=0 【不代表這棵樹乾淨】—— 本發實際失敗 %s 支, 見上面的清單。\n' "$NG"
    exit 0
  else
    printf '  🔴 正對照那一支【沒有】被算進失敗數 ⇒ 失敗計數不可信, 這一發所有數字作廢(rc=1)\n'
    KEEP=1; exit 1
  fi
fi

printf '\n🛑 射程: 本機拋棄式 PG + runbook §2 的 bootstrap(它建了角色/auth/pg_trgm, 而 runbook 自陳那份清單【仍不完整】)\n'
printf '   ⇒ 失敗支數裡有一部分是【環境缺件】而不是 migration 的錯 ⇒ 這個數是【上界】不是「有幾支真的壞了」。\n'
printf '   ⇒ 它答「從零重建這條路通不通」, 不答「正式庫現在長什麼樣」。\n'

[ "$FXNG" -eq 0 ] || { printf '\n🔴 view 行為 fixture 沒過 ⇒ rc=1(即使 migration 全部 apply 成功)\n'; KEEP=1; exit 1; }
[ "$NG" -eq 0 ] || { KEEP=1; exit 1; }
exit 0
