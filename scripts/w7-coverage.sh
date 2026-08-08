#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# W7 · 出貨 writer 線的**跑過帳**(covering account = 「這 17 支到底有沒有被跑過」)
#
#   check(預設):驗收據 —— 17 支每支都有一張、都綠、跑的是**現在這個版本**的 harness、
#                 跑的時候 migration 尾碼**就是現行的**。任何一條不成立就紅。
#   record <支|all>:真的跑 harness、把結果寫成收據。慢(每支要 initdb + 重放全套 migration),
#                 這是 **apply preflight 的本分**,不是每次 commit 都要做的事。
#
# ══ 🔴🔴 本檔為什麼是這個形狀(R3 打掉了前一版,理由要留著)══════════════
#   前一版守的是「**帳被偷改**」:凍結每支的 `EXPECT_TOTAL` 與靶清單,有人改小就紅。
#   R3 用 `git log -p` 實查全線史 ⇒ `EXPECT_TOTAL` **只上升過、零下降、零靶被刪**
#   —— 那個威脅模型在本線**零實例**,而真實發生過的失效有四種,它一種都守不到:
#     ① 天生零靶族(w1 五族 / w3b2 SHAPE 族)—— 出生就缺,不是後來被改小
#     ② 承諾了不存在的靶(`w2:18` 的 `TMUT-WIRED`)—— 凍結表會把「這族零靶」照實凍住、全綠
#     ③ 跨線釘值過期(08-08 02:15 實錘:附件線 migration 落檔沒同批重釘 ⇒ W7b 當場紅)
#     ④ 🔴 **跑都沒跑** —— `docs/handoff/CURRENT.md:19` 逐字:
#        「⛔ apply=Sean 停點,preflight 必跑 b2s2b 全套(**現只重釘未重跑**)」
#   ⇒ 本版改守 ③④(它們真的會咬人),①② 不是守門守得住的、是欠款,寫在
#     `docs/reviews/2026-08-08-w-line-mutation-matrix.md` §3。
#   ⇒ 附帶好處:**天然免維護**。加一格、補一發靶都不用改本檔任何數字
#     (前一版要同步約 16 處字面 + 兩次心算加總 = 本 repo 復發第一名那個病的最大化版本)。
#
# ══ 🔴 證得了什麼 / 證不了什麼 ═══════════════════════════════════════════
#   ✅ 這 17 支**被跑過**、跑的是現在這份程式碼、當時 migration 尾碼是現行的、結果全綠。
#   ❌ **證不了**那些格「有判別力」—— 那是各支自己的靶在證(全線現況見 matrix.md §1)。
#   ❌ **證不了**「該有的守門都想到了」。欠款清單在 matrix.md §3。
#   ❌ 收據是**自陳**:它證的是「有人跑了並記下結果」,不是「結果沒被手改」。
#      擋手改的是 code review 與 git 歷史,不是本檔。
#
# 用法:
#   bash scripts/w7-coverage.sh              驗收據(快,<1s)
#   bash scripts/w7-coverage.sh record all   跑全線 17 支並重寫收據(慢,~15-25 分)
#   bash scripts/w7-coverage.sh record w2-verify.sh   只重跑一支
# ══════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$REPO/scripts"
LEDGER="$SCRIPTS/w7-receipts.tsv"
TMPD="${W7TMP:-/tmp/w7cov}"
MODE="${1:-check}"

# 目錄裡的 W 線 harness 檔案集合。🔴 排除本檔自己(它沒有被測物、不是 harness)與收據檔。
# 🔴 `^w[0-9]` 是命名慣例不是機制:未來若有人把 harness 取成別的開頭,它對本檔隱形。
#    今天 17 支全部符合(逐支實查),這是**慣例債**、寫下來不假裝沒有。
harness_set() { ls "$SCRIPTS" 2>/dev/null | grep -E '^w[0-9].*\.sh$' | grep -v '^w7-coverage\.sh$' | sort; }
# 現行 migration 時間序尾碼(與 b2s2b-verify.sh 的 NEWEST_TS 閘同一個量法)
newest_ts() { ls "$REPO"/supabase/migrations/*.sql 2>/dev/null | sed 's|.*/||; s|_.*||' | sort | tail -1; }
sha_of() { shasum "$SCRIPTS/$1" 2>/dev/null | cut -d' ' -f1; }

# ══════════════════════════ record 模式 ══════════════════════════════════
if [ "$MODE" = "record" ]; then
  TARGET="${2:-all}"
  TS="$(newest_ts)"
  [ -n "$TS" ] || { echo "找不到 supabase/migrations ⇒ 不敢記帳"; exit 1; }
  if [ "$TARGET" = "all" ]; then LIST="$(harness_set)"; else LIST="$TARGET"; fi
  [ -f "$LEDGER" ] || printf '# W7 跑過帳。一行一支:harness\\tPASS\\tFAIL\\texit\\tnewest_ts\\tharness_sha\n# 由 `bash scripts/w7-coverage.sh record` 產生,勿手改。\n' > "$LEDGER"
  for h in $LIST; do
    [ -f "$SCRIPTS/$h" ] || { echo "SKIP $h(檔案不存在)"; continue; }
    printf '跑 %s … ' "$h"
    OUT="$(cd "$REPO" && bash "scripts/$h" 2>&1)"; EX=$?
    # 🔴 兩軌都讀(退出碼三連坑):字面的 PASS=/FAIL= **與** 結束碼,任一不對就是不綠。
    P="$(printf '%s' "$OUT" | sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\1/p' | tail -1)"
    F="$(printf '%s' "$OUT" | sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\2/p' | tail -1)"
    [ -n "$P" ] || P=0
    [ -n "$F" ] || F=-1   # 抓不到總結行 = 不當作 0,當作壞掉
    printf 'PASS=%s FAIL=%s exit=%s\n' "$P" "$F" "$EX"
    grep -v "^$h	" "$LEDGER" > "$LEDGER.tmp" 2>/dev/null || true
    mv "$LEDGER.tmp" "$LEDGER"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$h" "$P" "$F" "$EX" "$TS" "$(sha_of "$h")" >> "$LEDGER"
  done
  echo "收據已寫入 $LEDGER"
  exit 0
fi

# ══════════════════════════ check 模式 ═══════════════════════════════════
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=23   # 🔴 量出來的(17 逐支 + SET-MATCH + 四發靶 + NO-WRITEBACK)。全綠 PASS = 23 + 2 = 25。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-28s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-28s %s\n' "$1" "$2"; }
rm -rf "$TMPD"; mkdir -p "$TMPD"
trap 'rm -rf "$TMPD"' EXIT INT TERM

TS_NOW="$(newest_ts)"

# ── 對帳原語:吃一份收據檔,回一支的問題描述(空 = 這支的帳是好的)────────
# 🔴 參數化成吃檔案,是為了 §3 四發靶能對「動過手腳的副本」跑**同一份判定式**
#    —— 靶與被靶用兩套判定,翻面證的只是我寫了兩套。
check_one() { # $1=收據檔 $2=harness 檔名
  local led="$1" h="$2" row p f ex ts sha problems=""
  row="$(grep "^$h	" "$led" 2>/dev/null | tail -1)"
  [ -n "$row" ] || { printf '沒有收據 ⇒ **這支從來沒被跑過**(或收據被刪)'; return; }
  p="$(printf '%s' "$row" | cut -f2)"; f="$(printf '%s' "$row" | cut -f3)"
  ex="$(printf '%s' "$row" | cut -f4)"; ts="$(printf '%s' "$row" | cut -f5)"
  sha="$(printf '%s' "$row" | cut -f6)"
  # ① 綠不綠 —— 字面與退出碼**兩軌都要**(本線教訓:五支 verify 曾「紅跑回 exit 0」)
  [ "$f" = "0" ]  || problems="$problems 收據記 FAIL=$f(非 0);"
  [ "$ex" = "0" ] || problems="$problems 收據記 exit=$ex(非 0);"
  [ "${p:-0}" -gt 0 ] 2>/dev/null || problems="$problems 收據記 PASS=$p ⇒ 一格都沒跑到;"
  # ② 跑的是不是**現在這份**程式碼(用內容 sha,不用 mtime —— git checkout 會動 mtime)
  [ "$sha" = "$(sha_of "$h")" ] || problems="$problems harness 內容已改但**沒重跑**(收據 sha ${sha:0:8}… vs 現行 $(sha_of "$h" | cut -c1-8)…);"
  # ③ 跑的時候 migration 尾碼是不是現行的 —— 這條打的是 08-08 02:15 那次真事故:
  #    新 migration 落檔、釘值檔沒同批重跑 ⇒ 帳面全綠但釘的是舊世界
  [ "$ts" = "$TS_NOW" ] || problems="$problems 跑的時候 migration 尾碼是 $ts、現行是 $TS_NOW ⇒ 釘值過期,要重跑;"
  printf '%s' "$problems"
}

echo "══ 1. 逐支跑過帳(有沒有跑 / 綠不綠 / 跑的是不是這版 / 釘值對不對)═══"
if [ ! -f "$LEDGER" ]; then
  echo "  🔴 收據檔不存在:$LEDGER"
  echo "     ⇒ 先跑 bash scripts/w7-coverage.sh record all(慢,apply preflight 的本分)"
fi
for h in $(harness_set); do
  KEY="RECEIPT-$(printf '%s' "$h" | sed 's/-.*//')"
  PROB="$(check_one "$LEDGER" "$h")"
  if [ -z "$PROB" ]; then
    ROW="$(grep "^$h	" "$LEDGER" | tail -1)"
    ok "$KEY" "$h:$(printf '%s' "$ROW" | cut -f2) 綠 / 釘值 $(printf '%s' "$ROW" | cut -f5) ✓"
  else
    bad "$KEY" "$h:$PROB"
  fi
done

echo "══ 2. 集合帳 ═════════════════════════════════════════════"
# 🔴 這條抓「新片落檔沒進帳」:harness 集合與收據集合必須逐字相等。
#    (前一版靠手維護的凍結清單抓同一件事;現在兩邊都是量出來的,免維護。)
HS="$(harness_set | tr '\n' ' ' | sed 's/ *$//')"
RS="$(grep -v '^#' "$LEDGER" 2>/dev/null | cut -f1 | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
[ "$HS" = "$RS" ] \
  && ok SET-MATCH "harness 集合($(printf '%s' "$HS" | wc -w | tr -d ' ') 支)與收據集合逐字相等 ⇒ 新片落檔沒記帳會紅在這裡" \
  || bad SET-MATCH "集合不符。有 harness 沒收據:[$(comm -23 <(printf '%s' "$HS" | tr ' ' '\n' | sort) <(printf '%s' "$RS" | tr ' ' '\n' | sort) | tr '\n' ' ')] 有收據沒 harness:[$(comm -13 <(printf '%s' "$HS" | tr ' ' '\n' | sort) <(printf '%s' "$RS" | tr ' ' '\n' | sort) | tr '\n' ' ')]"

echo "══ 3. 🔴 靶(四類真實失效各一發;在副本上動手腳)═══════════"
# 🔴 判別力的形狀:**改壞值、保留結構**。四發各打一種**本線真的發生過**的失效,
#    不是打「有人惡意改帳」那個零實例的威脅模型(R3 打掉前一版的理由)。
FP_BEFORE="$(shasum "$LEDGER" 2>/dev/null | cut -d' ' -f1)"
PROBE="$(harness_set | head -1)"

# ① 「跑都沒跑」:抽掉一張收據
grep -v "^$PROBE	" "$LEDGER" > "$TMPD/led-missing.tsv" 2>/dev/null
M1="$(check_one "$TMPD/led-missing.tsv" "$PROBE")"
case "$M1" in
  *"從來沒被跑過"*) ok TMUT-COV-MISSING "🔴 抽掉 $PROBE 的收據 ⇒ 當場紅並說「這支從來沒被跑過」= 對「沒人跑」有判別力" ;;
  "")               bad TMUT-COV-MISSING "收據被抽掉後仍回報帳是好的 ⇒ 這條恆真" ;;
  *)                bad TMUT-COV-MISSING "紅了但理由不是缺收據:[$M1]" ;;
esac

# ② 「跑了但紅」:把 FAIL 改成 1
sed "s/^\($PROBE	[0-9]*	\)0	/\11	/" "$LEDGER" > "$TMPD/led-red.tsv"
if ! grep -q "^$PROBE	[0-9]*	1	" "$TMPD/led-red.tsv"; then
  bad TMUT-COV-RED "sed 沒把 FAIL 改成 1(非 BSD sed?)⇒ 本靶自己壞了,不是帳的結論"
else
  M2="$(check_one "$TMPD/led-red.tsv" "$PROBE")"
  case "$M2" in
    *"收據記 FAIL=1"*) ok TMUT-COV-RED "🔴 把收據的 FAIL 改成 1 ⇒ 當場紅 = 對「跑了但沒綠」有判別力" ;;
    "")                bad TMUT-COV-RED "收據記 FAIL=1 仍回報帳是好的 ⇒ 這條恆真" ;;
    *)                 bad TMUT-COV-RED "紅了但理由不是 FAIL:[$M2]" ;;
  esac
fi

# ③ 「改了 harness 沒重跑」:把收據的 sha 改掉(等價於 harness 內容變了)
sed "s/^\($PROBE	.*	\)[0-9a-f]\{40\}$/\1deadbeefdeadbeefdeadbeefdeadbeefdeadbeef/" "$LEDGER" > "$TMPD/led-stale.tsv"
if ! grep -q "^$PROBE	.*deadbeef" "$TMPD/led-stale.tsv"; then
  bad TMUT-COV-STALE "sed 沒把 sha 改掉 ⇒ 本靶自己壞了,不是帳的結論"
else
  M3="$(check_one "$TMPD/led-stale.tsv" "$PROBE")"
  case "$M3" in
    *"沒重跑"*) ok TMUT-COV-STALE "🔴 收據的 sha 與現行 harness 不符 ⇒ 當場紅 = 對「改了沒重跑」有判別力(用內容 sha,不是 mtime)" ;;
    "")         bad TMUT-COV-STALE "sha 不符仍回報帳是好的 ⇒ 這條恆真" ;;
    *)          bad TMUT-COV-STALE "紅了但理由不是 sha:[$M3]" ;;
  esac
fi

# ④ 🔴 「新 migration 落檔、釘值檔沒同批重跑」= 08-08 02:15 那次真事故的形狀
sed "s/^\($PROBE	[0-9]*	[0-9]*	[0-9]*	\)[0-9]*	/\120000101000000	/" "$LEDGER" > "$TMPD/led-ts.tsv"
if ! grep -q "^$PROBE	.*20000101000000" "$TMPD/led-ts.tsv"; then
  bad TMUT-COV-TSDRIFT "sed 沒把釘值改舊 ⇒ 本靶自己壞了,不是帳的結論"
else
  M4="$(check_one "$TMPD/led-ts.tsv" "$PROBE")"
  case "$M4" in
    *"釘值過期"*) ok TMUT-COV-TSDRIFT "🔴 收據的 migration 尾碼比現行舊 ⇒ 當場紅 = 對「新 migration 落檔沒同批重跑」有判別力(08-08 02:15 實錘事故)" ;;
    "")           bad TMUT-COV-TSDRIFT "釘值過期仍回報帳是好的 ⇒ 這條恆真" ;;
    *)            bad TMUT-COV-TSDRIFT "紅了但理由不是釘值:[$M4]" ;;
  esac
fi

# 🔴 零回寫自證:四發靶只動 $TMPD 裡的副本,真收據一個位元都不該變。
#    (守在**不變量面**,不是某個瞬間的 git 狀態 —— 那是 R2 打掉前一版的理由。)
FP_AFTER="$(shasum "$LEDGER" 2>/dev/null | cut -d' ' -f1)"
[ "$FP_BEFORE" = "$FP_AFTER" ] \
  && ok COV-NO-WRITEBACK "四發靶跑完,真收據檔指紋逐位元不變 ⇒ 手腳只動到副本" \
  || bad COV-NO-WRITEBACK "真收據檔在本節前後變了(${FP_BEFORE:0:8}… → ${FP_AFTER:0:8}…)"

echo "══ 4. 覆蓋帳 ═════════════════════════════════════════════"
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"; PASS=$((PASS+1))
else
  printf '  FAIL %-28s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或 harness 支數變了卻沒更新本值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-28s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="COV-NO-WRITEBACK RECEIPT-w0b RECEIPT-w1 RECEIPT-w2 RECEIPT-w3a RECEIPT-w3b2 RECEIPT-w3c1 RECEIPT-w3c2 RECEIPT-w3c3 RECEIPT-w4a RECEIPT-w4b RECEIPT-w5 RECEIPT-w6a RECEIPT-w6b1 RECEIPT-w6b2 RECEIPT-w6b3 RECEIPT-w6c RECEIPT-w7b SET-MATCH TMUT-COV-MISSING TMUT-COV-RED TMUT-COV-STALE TMUT-COV-TSDRIFT"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-28s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單(換格名/換格都紅得到)"; PASS=$((PASS+1))
else
  printf '  FAIL %-28s %s\n' "CELL-KEYSET" "格名集合漂了。多出:[$(comm -13 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')] 少了:[$(comm -23 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')]"; FAIL=$((FAIL+1))
fi

printf '\n════ PASS=%d FAIL=%d ════\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
exit 0
