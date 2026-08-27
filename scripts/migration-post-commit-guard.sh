#!/usr/bin/env bash
# migration-post-commit-guard.sh —— `#531`:migration 的最後一個 `COMMIT;` 之後不得再有 DDL/DML。
#
# ============================================================================
# 🔴 這道守門在防什麼(失效形狀,E 窗 `E-640` 實測)
# ----------------------------------------------------------------------------
#   內層 `COMMIT;` 結束外層交易 ⇒ 之後每一句在 autocommit 下【各自提交】
#   ⇒ 斷言失敗時**沒有交易可以回滾**,而 migration 仍然回報失敗
#   ⇒ **人以為整片沒生效,實際上半支已經落地。**
#   ⚠️ 症狀是「看起來失敗了」,而那正是最難察覺的一種:失敗訊息把人指向「重跑一次」,
#      而重跑會撞上「已存在」之類的錯,再把人指向別的地方。
#
# 🔴 本 repo:**零命中**(不是抽樣,是逐支掃)
#   ⚠️ **分母不寫死在這裡 —— 寫死的分母會過期,而它過期時沒有任何訊號。**
#     (2026-08-23 Fable R3 實測:檔頭原本寫死 `175` / `86`,當天真值是 `212` / `107`
#      ⇒ **「零命中」這個結論仍然成立,而它成立在【另一個分母】上。**
#      判詞逐字:**「一個為了幫助讀者而寫的分母,現在會誤導讀者。」**
#      📌 同一天 `MEMORY.md` 檔頭那條寫死的現值也誤導了下一個讀者 —— **同一句話的兩個標本。**)
#   ⇒ 要現值,當場跑這兩行:
#       ls supabase/migrations/*.sql | wc -l
#       grep -liE '^[[:space:]]*COMMIT[[:space:]]*;' supabase/migrations/*.sql | wc -l
#     (🔴 第二行用 `-i`:本檔 2026-08-23 起大小寫不敏感,而**用大寫版數會系統性少算**
#      —— 2026-08-23 當天兩種數法同為 107,**那是巧合不是保證**。)
#   ⇒ 要「有沒有違規」的現值,跑這一支自己:`bash scripts/migration-post-commit-guard.sh`
#     (2026-08-23 實跑 ⇒ 212 支全通過、exit 0)
#   正向對照(證明 pattern 是活的):拿某支的 `BEGIN;` 行當假的 COMMIT 位置,其後 DDL 行數 ⇒ 6(非 0)
#   ⇒ **現在無人踩到,而踩到不會有任何東西叫** —— 這道守門是為了讓「第一次踩到」會紅。
#
# ============================================================================
# ⚠️ 覆蓋界線:它釘得到什麼、釘不到什麼(不要讓它看起來比實際強)
# ----------------------------------------------------------------------------
# ✅ 釘得到
#   · 最後一個 `COMMIT;` 之後,行首(允許前導空白)出現 DDL/DML 關鍵字
#   · `#530` 那組「會沖掉批次」的語句出現在**交易區塊之內**
# 🔴 釘不到 —— 逐條寫出來,不要讓下一個人以為這面已經全包
#   1. **同一行內的多句**:`COMMIT; CREATE TABLE x(...);` 寫在一行 ⇒ 本支只看行首,抓不到。
#      (本 repo 現況零這種寫法,但它不是被守住的,是還沒有人這樣寫。)
#   2. **字串或 dollar-quoted 區塊裡的關鍵字**:`DO $$ … 'CREATE TABLE' … $$;` 的字面
#      —— 本支剝註解但**不解析 SQL**,字串內的關鍵字若出現在行首會誤報。
#   3. **由變數 / psql 代換組出來的語句**:`\i` include、`:'var'` 代換 ⇒ 本支看不到展開後的內容。
#   4. **執行期才決定的分支**:`DO` 區塊裡依條件執行的 DDL ⇒ 本支只看文字,不知道它跑不跑。
#   📎 同族實例(B 窗 2026-08-16):一行寫死在 CSS 裡的 `6px`,它的守門抓不到 ——
#      **因為那是 raw CSS、沒有 class 可釘**。**守門釘的是它看得到的形狀,不是事實。**
#
# 🔴 **剝註解是必要的,不是整潔**:本 repo 有 4 支 migration 在**註解裡**討論
#   「為什麼不用 CONCURRENTLY」(`20260811040000` / `20260811110000` / `20260812130000` /
#   `20260813120000`)。不剝註解 ⇒ 那四支全部誤報,而它們一個字都沒做錯。
#   (寫本支時第一版就這樣誤報了 4 檔 —— 留在這裡當理由,不是當笑話。)
#
# 天花板/範圍: 只掃 migration .sql;抓「最後一個交易結束語之後、行首出現 DDL/DML」+「交易區塊內會沖批次的語句(#530)」。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「不在這兩種形狀、但一樣破壞原子性的第三種寫法」。
# 天花板/量具: 釘不到四種(檔頭「覆蓋界線」逐條):①同一行內多句 ②字串 / dollar-quote 內的關鍵字
#   ③變數 / psql 代換組出來的語句 ④執行期才決定的分支。它釘的是【看得到的形狀】,不是事實。
#   這份清單是我想得到的那些, 而我最可能漏掉的是「一種我沒列進那四條、但字面也騙得過剝註解的寫法」。
# ============================================================================

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DIR="${1:-supabase/migrations}"
FAIL=0

# 🔴🔴 **2026-08-23:以下三件是【接上 hook 的時候】才被發現的,而本檔 2026-08-16 寫好之後
#   零呼叫端 ⇒ 沒有任何人有機會發現。**(codex R2)
#   ① **所有關鍵字比對區分大小寫** ⇒ 合法的小寫寫法 `begin; vacuum …; commit;`
#      **完全不進交易狀態、也不命中 breaker** ⇒ 危險 migration **直接放行**(已實測復現:exit 0)
#   ② 狀態機**只認 `COMMIT;`** 離開交易 ⇒ `ROLLBACK;` / `END;` / `COMMIT WORK;` 之後的
#      **交易外**語句被誤判成交易內(已實測復現:誤紅)
#   ③ **不追蹤 dollar-quote** ⇒ `$$ … BEGIN; … $$` 裡那一行會**錯誤地打開交易狀態**(已實測復現:誤紅)
#   ⇒ **「刪掉它 = 刪掉唯一的守門」與「那個唯一的守門本來就不太管用」同時為真。**
#     而 2026-08-23 那個「不刪」的判斷**仍然對** —— 修得好的東西不該丟掉,而它現在正在被修。
#   📌 形狀:**接上去這個動作,揭露了它從來沒有正確過** —— 一支零呼叫端的守門,
#     它的「正確」從來沒有被任何東西質問過。**檔案在 ≠ 守門有效**,而這是那句話的第二層意思。
#
# 行首 DDL/DML 關鍵字。🔴 字集刻意寬:寧可誤報一次讓人來讀,不要漏放一句 DDL 出去。
# ⚠️ 以下三個樣式一律配 `grep -iE` / awk 的 tolower() 使用 —— SQL 關鍵字**大小寫不敏感**。
DDL='^[[:space:]]*(create|alter|drop|comment|grant|revoke|insert|update|delete|do|truncate|call|analyze|vacuum|refresh|notify|reindex|cluster|security[[:space:]]+label)\b'
# `#530`:會沖掉批次的語句 —— 出現在交易區塊【內】就是原子性斷點。
BATCH_BREAKER='(create[[:space:]]+index[[:space:]]+concurrently|reindex[[:space:]]+[a-z]*[[:space:]]*concurrently|^[[:space:]]*vacuum\b|^[[:space:]]*cluster\b|alter[[:space:]]+system\b)'
# 交易的**開始**與**結束**語族。🔴 結束不只 `COMMIT` ——
#   `END` 是 COMMIT 的同義字、`ROLLBACK` 一樣結束交易,而兩者之後的語句同樣各自 autocommit。
#   後面可接 `WORK` / `TRANSACTION`(SQL 標準的可選字)。
TX_BEGIN='^[[:space:]]*begin([[:space:]]+(work|transaction))?[[:space:]]*;'
TX_END='^[[:space:]]*(commit|end|rollback)([[:space:]]+(work|transaction))?[[:space:]]*;'

# 剝掉「不是 SQL 語句」的東西:`--` 行註解、`/* */` 區塊註解、**以及 dollar-quote 區塊**。
# 🔴 **這支 awk 是從 `scripts/migration-static-checks.sh` 的 `strip_sql()` 搬過來的**,不是重寫 ——
#   那邊的檔頭記著它為什麼要處理 dollar-quote:`DO $x$ … END; $x$` 裡的 `END` 與這裡的
#   交易結束語**字面完全相同**,**字面分不出來,要用結構分**。
# 🔴 取代原本那支 perl 一行版(它不處理 dollar-quote ⇒ 上面缺陷 ③)。
#   ⚠️ 它**逐行輸出**(一行進一行出)⇒ **行號不漂**,下游印的絕對行號仍對得上原檔。
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

for f in "$DIR"/*.sql; do
  [ -e "$f" ] || continue
  # 🔴 **剝註解失敗 ⇒ 擋下,不得靜靜當成「這支沒有東西可違規」**(codex R1 M5,2026-08-23)。
  #   本檔只有 `set -uo pipefail`、**沒有 -e**,而原版不看 `strip_comments` 的回碼
  #   ⇒ `perl` 不在 PATH / 讀檔失敗 ⇒ `body` 變空字串 ⇒ 兩道閘都掃不到任何東西
  #   ⇒ 最後仍印「✅ 通過」並 `exit 0`。
  #   **那是【沒有 body 就沒有東西可違規】型的恆綠 —— 壞掉的那次與乾淨的那次印同一句話。**
  #   ⚠️ 空檔案是合法的(0 byte 的 .sql 剝完本來就是空)⇒ 判準用 **回碼**,不是「body 空不空」。
  if ! body=$(strip_sql "$f"); then
    echo "🔴 $f:剝 SQL 失敗(awk 回非零 —— 它不在 PATH 上?檔案讀不到?)⇒ 擋下,不當成通過。"
    FAIL=1
    continue
  fi

  # ── ① 最後一個「交易結束語」之後不得有 DDL/DML ──────────────────────
  # 🔴 `-i`:SQL 關鍵字大小寫不敏感,而原版只認大寫(見檔頭缺陷 ①)。
  # 🔴 結束語不只 COMMIT:`END` / `ROLLBACK` 一樣結束交易,其後同樣各自 autocommit。
  last=$(printf '%s\n' "$body" | grep -niE "$TX_END" | tail -1 | cut -d: -f1)
  if [ -n "$last" ]; then
    after=$(printf '%s\n' "$body" | awk -v L="$last" 'NR>L' | grep -niE "$DDL" || true)
    if [ -n "$after" ]; then
      echo "🔴 $f:最後一個交易結束語(第 $last 行,剝註解後)之後仍有 DDL/DML:"
      printf '%s\n' "$after" | sed 's/^/     /'
      echo "     ⇒ 那些句子會在 autocommit 下【各自提交】,失敗時沒有交易可回滾。"
      FAIL=1
    fi
  fi

  # ── ② #530:交易區塊內不得出現會沖掉批次的語句 ──────────────────────
  # 🔴 **v2:逐段配對 BEGIN…COMMIT,不再用「第一個 BEGIN 到最後一個 COMMIT」**
  #   (codex R1 M6,2026-08-23;誤紅已實測復現)。
  #   舊版把整個檔當**一段**交易 ⇒ 兩段交易【中間】那個**合法的**(交易外)VACUUM
  #   也被判成「在交易內」:
  #     BEGIN; … COMMIT;  ← 第一段
  #     VACUUM t1;        ← 🔴 舊版報「交易區塊內(第 1–9 行)」而它根本不在任何交易裡
  #     BEGIN; … COMMIT;  ← 第二段
  #   ⇒ **字面「交易區塊內」超出它實際的解析能力** ——
  #     而誤紅那一族的代價不是「多看一眼」,是**訓練人略過這道閘**。
  #   ⇒ 改成一個逐行的狀態機:見 BEGIN 進交易、見 COMMIT 出交易,只在交易內的行上比對。
  #   ⚠️ 能力邊界**沒有**因此變寬,檔頭那四條「釘不到」全部照舊(同一行多句 / 字串與
  #     dollar-quote 內的關鍵字 / \i include 與代換 / DO 區塊的執行期分支)。
  #     檔尾若交易沒關上,其後各行**仍算在交易內**(保守方向,寧可報)。
  # 🔴 順帶修掉一個座標 bug:舊版把切片再餵 `grep -n` ⇒ 印的是**相對行號**
  #   (上例真實在第 5 行,舊版印 `4:`)。相對行號與絕對行號**長得一模一樣**,
  #   而人會拿它去開檔。改成由 awk 直接帶出**絕對行號**。
  # 🔴 **兩段式,而那是被一次失敗逼出來的**:我第一版讓 awk 直接印 `NR ":" $0` 再餵 grep ——
  #   而 `$BATCH_BREAKER` 裡有 `^[[:space:]]*VACUUM` 這種**行首錨定**,
  #   加了 `3:` 前綴之後那些錨定全部失效 ⇒ **交易內的 VACUUM 變成抓不到**(負對照當場紅)。
  #   ⇒ 分成兩步:① awk 只算出「哪些絕對行號在交易內」② grep 在**原始行**上比對(錨定完好)
  #   ③ 取交集。這樣既有絕對行號,錨定也沒被我自己的前綴破壞。
  # 🔴 **awk 這一段用 `tolower($0)` 比對,不是靠 grep -i** —— awk 的 `/…/` 常值樣式
  #   **沒有** case-insensitive 旗標(POSIX awk 無 `IGNORECASE`,那是 gawk 的擴充,
  #   而 macOS 的 awk 不是 gawk)。⇒ 把整行降成小寫再比,樣式本身也全寫小寫。
  #   ⚠️ 這也是為什麼上面 `$TX_BEGIN` / `$TX_END` 一律寫小寫:**同一組樣式要同時餵給
  #     `grep -iE` 與這支 awk**,而只有小寫版在兩邊都成立。
  txlines=$(printf '%s\n' "$body" | awk -v b="$TX_BEGIN" -v e="$TX_END" '
    { lc = tolower($0) }
    lc ~ b { inTx = 1; next }
    lc ~ e { inTx = 0; next }
    inTx { print NR }
  ' | tr '\n' ' ')
  # ⚠️ `tr` 那一段不是整潔:`awk -v` **不吃內嵌換行**(實測 `awk: newline in string`,
  #   而它同時還印了「✅ 通過」⇒ **一個壞掉的量具配上一句通過**)。改成空白分隔。
  inside=$(printf '%s\n' "$body" | grep -niE "$BATCH_BREAKER" \
    | awk -F: -v tx="$txlines" 'BEGIN { n = split(tx, a, " "); for (i = 1; i <= n; i++) m[a[i]] = 1 } m[$1]' \
    || true)
  if [ -n "$inside" ]; then
    echo "🔴 $f:交易區塊內有會沖掉批次的語句(行號為剝註解後的絕對行號):"
    printf '%s\n' "$inside" | sed 's/^/     /'
    echo "     ⇒ 原子性在那一刀就斷了(#530)。要用它就把整支拆成交易外的獨立步驟。"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "✅ migration post-COMMIT 守門:通過($(ls "$DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') 支)"
fi
exit "$FAIL"
