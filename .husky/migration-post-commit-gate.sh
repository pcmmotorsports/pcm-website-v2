#!/usr/bin/env bash
# migration post-COMMIT 守門的【接線】(2026-08-23 立;`#531` / `#530`)
#
# 本檔只做一件事:把**這次 staged 的 migration** 餵給 `scripts/migration-post-commit-guard.sh`。
# 守門邏輯(兩道閘、剝註解、覆蓋界線)全部在那支,本檔不重寫、不複製它的字集。
#
# 🔴 **本檔是 bash 不是 sh**,而那是承重的:下面用 `read -r -d ''` 讀 NUL 分隔的檔名清單,
#   那個 `-d` 是 bash 專有。`.husky/pre-commit` 因此以 `bash` 呼叫本檔(其餘各閘仍是 `sh`)。
#   ⚠️ 改回 `sh` 會讓檔名處理**靜靜退化**回按空白斷詞 —— 見下方 M1。
#
# ══ 🔴 為什麼是「只看 staged 的」而不是「掃整個目錄」════════════════════════════
# 那支守門的介面是**掃一個目錄底下全部 .sql**($1,預設 supabase/migrations)。
# 直接把它掛上去 = 每顆 commit 掃全部 212 支,而那有兩個代價:
#   ① 🔴 **一旦有任何一支既有 migration 違規,所有人的所有 commit 會被擋死** ——
#      而 migration 是 append-only、既有檔改不得 ⇒ 那道紅**做不完**。
#      這正是 .husky/migration-ts-gate.sh 檔頭記著的實錘:admin-dev-bypass-gate 第一版
#      掃整支 staged 檔 ⇒ 632 條的 backlog 沒有人 commit 得動。
#      **既有的違規(如果哪天有)是歷史,不是這次的錯。**
#   ② 實測掃全庫 **4.3 秒**(2026-08-23,212 支)。而那支的 commit body 寫的是「毫秒級」——
#      那句寫在 175 支的時候。**一個當時為真的效能宣稱會隨分母長大而過期,而它過期時沒有訊號。**
#      每顆 commit 多 4.3 秒 = 訓練所有人用 --no-verify,那比沒有閘更糟。
# ⇒ 只把 staged 的那幾支複製進暫存目錄再餵給它 ⇒ 成本與這次改了幾支成正比。
#
# ══ codex R1 六條 must-fix 在本檔的落點(2026-08-23)════════════════════════════
#   M1 檔名  改用 `-z` NUL 分隔 —— 原版靠換行 + 詞分割,而 git 對非 ASCII 路徑走
#            core.quotePath(引號 + 八進位轉義)、空白又會被拆詞 ⇒ **合法的 migration 被誤擋**。
#            🔴 我自己先量到 exit 128,而我第一版的「修法」是把那些檔名擋掉並給一句清楚的訊息 ——
#            **那還是誤擋**,只是換了一句話。codex 要的是讓它們**正常通過**。
#   M2 fail-open  原版 `$(… || true)` 把 git 故障吞成「沒有 migration」⇒ **放行**。
#   M3 順序  守門本體的存在性檢查原本排在「沒有 staged migration 就 exit 0」之後
#            ⇒ **單獨刪掉本體的那一顆 commit 剛好不會被擋**(而 fail-closed 的理由正是「有人提過要刪它」)。
#   M4 掉包  `-f` 只證明工作樹有一支檔,不證明 **index 要提交的那一份**是同一支
#            ⇒ 改成**直接跑 index 的那一份**。
#   M5 / M6 在守門本體那支,不在本檔。
#
# 🔴 用 index 的內容(`git show ":$f"`)不是工作樹的:
#   工作樹可能比 staged 新(改了但沒 add)⇒ 讀工作樹會驗到一份**不是這次要提交的**東西。
#
# ══ 🔴 這道閘的證據是【兩半】,而它們不是同一發 ══════════════════════════════════
#   本檔立起來的時候(2026-08-23),驗過的是「**這支腳本被呼叫時會做對的事**」——
#   七個情境逐一實跑(無 staged / 乾淨 / 閘①違規 / 閘②違規 / 守門在 index 被刪 /
#   逃生門 / 非 ASCII 檔名),全部在**拋棄式 git repo** 裡做,沒有碰共用樹的 index。
#   🔴 **而「husky 到底會不會呼叫它」是另一半,那一半不是我驗的** ——
#     它掛在 `.husky/_/h:17` 那一行(`sh -e "$s"`),由 codex 對抗審查獨立確認過。
#   ⇒ **兩半各有證據,只是不是同一發。**
#     ⚠️ 所以**沒有任何一次真的 `git commit` 走完整條路被觀察過** ——
#     第一顆帶 migration 的 commit 才是那一發。看到這段的人不要把它讀成「已經端到端驗過」。
#
# 逃生門:PCM_ALLOW_MIGRATION_POST_COMMIT=1 git commit …
#   ⚠️ **它只在當次 stderr 留一行警告,沒有任何機械驗證 commit body 真的寫了理由**(codex R1 nit)。
#   任何能啟動 git commit 的人 / IDE / shell 設定都設得起來 ⇒ 它是**方便**不是**控制**。
#   📌 **這一格【已經立案】:`#872`(`docs/phase-1-backlog.md`,實查該檔第 30299 行有此條目)。**
#     ⇒ 它不是我們決定不管,是**它不在本片的範圍裡** —— 要把它變成控制得動 `commit-msg` hook,
#       那是另一片、另一個平台設定、另一輪對抗審查。
#   🔴 **而那條條目自己帶一個反向風險,寫在這裡免得有人「順手把它做嚴」**:
#     治理逃生門的機制**若本身難用,人會改用 `--no-verify`,而那個連這一行警告都不會留**。
#     判別句:**這個機制讓「照規矩用逃生門」比「繞過整個 hook」更容易嗎?**
#     不是 ⇒ 它會把人推向更暗的路。

set -uo pipefail

if [ "${PCM_ALLOW_MIGRATION_POST_COMMIT:-}" = "1" ]; then
  echo "⚠ migration post-COMMIT 守門被 PCM_ALLOW_MIGRATION_POST_COMMIT=1 略過 —— 請在 commit body 寫明理由" >&2
  exit 0
fi

MIGDIR="supabase/migrations"
GUARD="scripts/migration-post-commit-guard.sh"

if ! TMP=$(mktemp -d); then
  echo "🔴 mktemp -d 失敗 ⇒ 擋下(不放行)" >&2
  exit 1
fi
# 🔴 nit(codex R1):原版只掛 EXIT,而實測 sh 收到 TERM 時**不會**跑 EXIT trap ⇒ 暫存 SQL 殘留。
#   ⚠️ 仍**不涵蓋 KILL**(那個攔不到)⇒ 「trap 會刪」不是所有退出路徑都成立。
# 🔴🔴 **而 R1 那一版的 handler 只清目錄、【不 exit 也不重送訊號】**(codex R2)——
#   ⇒ 中斷後 shell **可以繼續往下跑**;而被殺的 canary 子程序回的那個非零,
#     在舊版還會被當成「canary 成功」⇒ **使用者按 Ctrl-C 不保證取消 commit**。
#   ⇒ 訊號 handler 要**自己結束**,而且用「128 + 訊號值」這個慣例回碼,
#     讓上游(husky / git)看得出它是被中斷的,不是被守門擋的。
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'cleanup; trap - INT; kill -INT $$' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 129' HUP

# ══ M3 + M4:**最前面**就驗守門本體,而且驗的是 index 那一份 ══════════════════════
#   這兩條是同一件事的兩半:M3 是【什麼時候檢查】,M4 是【檢查哪一份】。
#   放最前面 ⇒ 「單獨刪掉本體」那一顆 commit 也會被擋(原版排在 exit 0 之後,剛好放它過)。
#   跑 index 那一份 ⇒ 「stage 一個恆綠版、工作樹留正常版」的掉包**驗得出來**
#   (原版的 `-f` 只看工作樹 ⇒ 正常版會替掉包版背書)。
#   📌 那支守門開頭會 `cd` 到它自己所在目錄的上一層;本檔一律傳**絕對路徑**當掃描目錄,
#     所以從 $TMP 跑那份複本不影響它找得到檔案(已實測)。
if ! git show ":$GUARD" > "$TMP/guard.sh" 2>/dev/null; then
  {
    echo "🔴 $GUARD 在 index 裡取不到(被刪除、或從未加入版控)⇒ 擋下(不放行)"
    echo "   本閘 fail-closed:那支守門【被提議刪除過】(docs/launch-todo.md),"
    echo "   而它的第二道閘(#530 交易內批次沖斷語句)全 repo 零人涵蓋。"
    echo "   fail-open 會讓這道閘被「刪掉那支 .sh」這個動作靜靜關掉。"
    echo "   復原:git checkout -- $GUARD"
  } >&2
  exit 1
fi
chmod +x "$TMP/guard.sh"

# ══ M4 的**真**修法:先讓它表演一次「該紅」,再相信它 ══════════════════════════════
#   🔴 我第一版把 M4 讀成「跑 index 那一份就好」—— **而那正好把攻擊放行**:
#     stage 一個 `echo 通過; exit 0` 的恆綠版 ⇒ 我忠實地跑了 index 那一份 ⇒ 它說通過 ⇒ 過。
#     實測過:工作樹 90 行 / index 3 行 ⇒ 舊版 `exit = 0`。
#     **「跑對的那一份」與「那一份是對的」是兩件事。**
#   ⇒ 正解是**不預設它會做事**:餵一支已知違規的檔,它**必須**回非零。
#     回 0 ⇒ 它不再偵測得到一個它本來抓得到的東西 ⇒ 擋下。
#   📌 這一發同時接住 codex M5(守門本體內部的假 0):`strip_comments` 失敗讓 body 變空、
#     於是「什麼都沒違規」而印通過 —— 那種恆綠**在這裡會被同一發抓到**,
#     因為 canary 那支違規檔也會變成「沒有違規」。
#   ⚠️ 它證的是「這支守門對【canary 這幾種形狀】還有判別力」,**不是**「它對所有形狀都對」。
#
# ══ 🔴 codex R2 把這一段的第一版拆了三條,而三條是同一個病:【非零 ≠ 抓到】═══════════
#   R2-a 兩支 canary **合併跑、只看總 exit** ⇒ 守門若仍抓得到①但已漏掉② ⇒ 總回碼仍非零 ⇒ 過
#   R2-b **任何非零都被當成成功** ⇒ 守門只剩 `exit 1`、語法壞掉、工具故障,同樣獲得信任
#   R2-c 🔴 最毒的一條:**M5 的正確行為(剝 SQL 失敗 ⇒ 回非零)被讀成「canary 成功」**
#        ⇒ 一個**修好的東西**被另一個機制讀成它想要的訊號
#        ⚠️ 而洞的觸發條件要寫準(這一句 codex 沒說,是本窗補的):
#          有 staged migration ⇒ 真檔那一掃也會因同一個故障回非零 ⇒ commit 仍被擋、沒有放行
#          **無 staged migration ⇒ 後面 exit 0 ⇒ 一顆「把守門改壞」的 commit 就這樣過了**
#          而那正是**最可能發生的形狀**:改工具的人通常不會同時加 migration。
#
#   ⇒ 三格,不是兩格(主視窗 2026-08-23 把「兩個方向」升成常設,而這裡需要第三個):
#       毒 A  單獨跑 ⇒ 必須非零,**而且輸出要含閘① 的字樣**(驗它抓到的是哪一條)
#       毒 B  單獨跑 ⇒ 必須非零,**而且輸出要含閘② 的字樣**
#       🔴 乾淨  單獨跑 ⇒ **必須回 0**
#   📌 **第三格才是把「故障」與「有效偵測」分開的那一格**:
#       一支「對什麼都紅」的守門(perl/awk 不見、語法壞、被改成 `exit 1`)——
#       **只跑前兩格時它看起來完美**,而第三格會當場拆穿它。
#       「該紅有紅」證明它看得到東西;「該綠有綠」證明**它看得到的不是全部東西**;
#       兩個一起,才證明它**在分辨**。
CANARY="$TMP/canary"
mkdir -p "$CANARY/a" "$CANARY/b" "$CANARY/ok"
{
  echo "BEGIN;"
  echo "CREATE TABLE public.__canary (id int);"
  echo "COMMIT;"
  echo "DROP TABLE public.__canary;"
} > "$CANARY/a/00000000000000_canary_after_commit.sql"
{
  echo "BEGIN;"
  echo "CREATE TABLE public.__canary2 (id int);"
  echo "VACUUM public.__canary2;"
  echo "COMMIT;"
} > "$CANARY/b/00000000000001_canary_batch_breaker.sql"
{
  echo "BEGIN;"
  echo "CREATE TABLE public.__canary3 (id int);"
  echo "COMMIT;"
} > "$CANARY/ok/00000000000002_canary_clean.sql"

canary_fail() {
  {
    echo "🔴 $GUARD(index 那一份)沒通過自我檢查 ⇒ 擋下(不放行)"
    echo "   失敗的那一格:$1"
    echo "   本閘在信任那支守門之前先讓它跑三格(這次要提交的那一份,不是你工作樹上那一份):"
    echo "     毒 A  COMMIT 之後還有 DROP TABLE      ⇒ 必須紅,且要說得出是「之後仍有 DDL/DML」"
    echo "     毒 B  交易區塊內有 VACUUM             ⇒ 必須紅,且要說得出是「沖掉批次」"
    echo "     乾淨  一支完全合法的 migration        ⇒ 必須綠"
    echo "   🔴 三格的用意不同:前兩格證明它【看得到東西】,第三格證明它【看得到的不是全部東西】。"
    echo "      少了第三格,一支「對什麼都紅」的守門(awk 不見 / 語法壞 / 被改成 exit 1)看起來會很完美。"
    echo "   可能的原因:被換成恆綠版或恆紅版 / awk 不在 PATH 上 / 它自己被改壞了。"
    echo "   下面是它這一格的原始輸出(不轉述):"
    printf '%s\n' "$2" | sed 's/^/     | /'
  } >&2
  exit 1
}

CA_OUT=$(bash "$TMP/guard.sh" "$CANARY/a" 2>&1); CA_RC=$?
if [ "$CA_RC" -eq 0 ]; then
  canary_fail "毒 A 應該紅而它回 0(exit $CA_RC)" "$CA_OUT"
fi
case "$CA_OUT" in
  *"之後仍有 DDL/DML"*) : ;;
  *) canary_fail "毒 A 紅了(exit $CA_RC),但它報的【不是】閘①那條 —— 非零不等於抓到" "$CA_OUT" ;;
esac

CB_OUT=$(bash "$TMP/guard.sh" "$CANARY/b" 2>&1); CB_RC=$?
if [ "$CB_RC" -eq 0 ]; then
  canary_fail "毒 B 應該紅而它回 0(exit $CB_RC)" "$CB_OUT"
fi
case "$CB_OUT" in
  *"沖掉批次"*) : ;;
  *) canary_fail "毒 B 紅了(exit $CB_RC),但它報的【不是】閘②那條 —— 非零不等於抓到" "$CB_OUT" ;;
esac

OK_OUT=$(bash "$TMP/guard.sh" "$CANARY/ok" 2>&1); OK_RC=$?
if [ "$OK_RC" -ne 0 ]; then
  canary_fail "乾淨那一支應該綠而它回 $OK_RC —— 這是【故障】不是【偵測】" "$OK_OUT"
fi

if [ ! -d "$MIGDIR" ]; then
  exit 0
fi

# ══ M1 + M2:NUL 分隔讀檔名;git 自己失敗要擋,不能吞 ═════════════════════════════
#   -z ⇒ git 不做 quotePath 轉義、以 NUL 分隔 ⇒ 空白與非 ASCII 都原樣拿到。
LIST="$TMP/.staged-list"
if ! git diff --cached --name-only -z --diff-filter=ACMR -- "$MIGDIR/*.sql" > "$LIST"; then
  {
    echo "🔴 git diff --cached 失敗 ⇒ 擋下(不放行)"
    echo "   空結果【不得】被當成「這次沒有動 migration」—— 那是 fail-open。"
  } >&2
  exit 1
fi
if [ ! -s "$LIST" ]; then
  exit 0
fi

SCAN="$TMP/staged"
mkdir -p "$SCAN"
COUNT=0
while IFS= read -r -d '' f; do
  if ! git show ":$f" > "$SCAN/$(basename "$f")"; then
    echo "🔴 讀不到 index 裡的 $f ⇒ 擋下(不放行)" >&2
    exit 1
  fi
  COUNT=$((COUNT + 1))
done < "$LIST"

if [ "$COUNT" -eq 0 ]; then
  exit 0
fi

# 🔴 **把訊息裡的暫存路徑換回真路徑**(2026-08-23 掛上去時當場量到的缺陷):
#   守門印的是它掃到的那個檔,而那是暫存目錄底下的複本 ——
#   **而那份複本在人讀到訊息的時候已經被 trap 刪掉了** ⇒ 他去 cat 會得到「查無此檔」,
#   而那會把他指向「是不是工具壞了」,不是「我那支 migration 寫錯了」。
#   ⚠️ **不接管線直接跑** —— `bash … | sed` 之後的 $? 會是 sed 的(CLAUDE.md 終端機紀律那條),
#   而 pre-commit 靠的正是 exit code。
#   ⚠️ nit(codex R1):路徑進 sed 是當**正規式**用 ⇒ 裡面的 `.` 會匹配任意字元。
#     mktemp 產生的那一段是 [A-Za-z0-9],實際只有 TMPDIR 那段可能帶特殊字元 ⇒ 逐字轉義它。
OUT=$(bash "$TMP/guard.sh" "$SCAN" 2>&1)
RC=$?
SCAN_ESC=$(printf '%s' "$SCAN" | sed 's/[][\.*^$|/&]/\\&/g')
printf '%s\n' "$OUT" | sed "s|$SCAN_ESC/|$MIGDIR/|g"
exit $RC
