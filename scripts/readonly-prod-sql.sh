#!/bin/bash
# 唯讀跑一支 .sql 對正式庫。🟢 唯讀 —— 這支【不 apply 任何東西】。
#
# 🔴 為什麼要有這支(2026-09-05 一夜踩三次, 第三次就在我剛把它寫進 memory 之後):
#    `.env.local` 只在主樹, 而施工窗站在 worktree ⇒ 連線字串是空字串
#    ⇒ psql 退回本機 socket ⇒ 印「伺服器是否在本地執行」⇒ 讀起來像【正式庫掛了】。
#    📌 那是【設定缺失】被報成【服務故障】, 而後者會先觸發我去查外面, 不會觸發我看腳下站哪。
#    🛑 而手打的 `cd` 擋不住它 —— 指令是從上一發複製改的, 而 `cd` 那行不在我改的那一段裡。
#       ⇒ 這道閘必須住在腳本裡, 不能住在我的手上。
#
# 🔴 絕不印連線字串。下面每一條路徑都只印【變數名】與【結果】。
set -u
SQL="${1:-}"
if [ -z "$SQL" ] || [ ! -f "$SQL" ]; then
  printf '用法:bash scripts/readonly-prod-sql.sh <要跑的 .sql>\n' >&2
  printf '🔴 檔不存在:%s —— 這是【路徑錯】不是【查無】\n' "$SQL" >&2
  exit 2
fi
SQL_ABS=$(cd "$(dirname "$SQL")" && pwd)/$(basename "$SQL")
cd /Users/sean_1/pcm-website-v2 || exit 3
set -a ; . ./.env.local > /dev/null 2>&1 ; set +a
if [ -z "${PCM_READONLY_DATABASE_URL:-}" ]; then
  printf '🔴 沒載到 PCM_READONLY_DATABASE_URL ⇒ **沒有查, 不是查無**\n' >&2
  printf '   (只印變數名, 不印值。主樹有沒有 .env.local:%s)\n' "$(test -f /Users/sean_1/pcm-website-v2/.env.local && echo 有 || echo 沒有)" >&2
  exit 3
fi
/opt/homebrew/bin/psql "$PCM_READONLY_DATABASE_URL" -f "$SQL_ABS" 2>&1 ; RC=$?
# 🔴 `psql -f` 的 rc 在【有 ERROR】與【全對】兩個世界都是 0 —— 除非那支 .sql 自己 \set ON_ERROR_STOP on。
#    ⇒ 這裡把它講出來, 而【不】替它加:加了會壓掉那些故意要噴錯的負對照格。
# 🔴🔴 **而【叫人去掃】的那句話, 自己會被掃到**(2026-09-07 `-tidy` 撞到、`-ship` 實測複現):
#    舊字面逐字「⛔ ~~自己掃一次輸出裡的 ERROR~~」—— 那句話裡有 `ERROR` 這個字,
#    而它印在**同一份輸出**裡(`>&2`, 而呼叫端多半 `2>&1` 合流)⇒ 📌 **裸 `grep -c ERROR` 會多數到它自己。**
#    🔬 實測(故意噴錯的三句 .sql 對正式庫唯讀跑):真錯誤 **1** 格,
#       裸 `grep -c ERROR` ⇒ **2**(虛報 1)· 行首形狀 `^psql:.*ERROR|^ERROR:` ⇒ **1**(對)。
#    ⇒ 🛑 **一句「你要去量」的提醒, 自己變成了被量到的東西。**
#    ✅ 修法 = 把**掃法的形狀**寫進提醒本身, 而不是只叫人去掃。
#    ⚠️ 而新句子開頭是 `⚠️` ⇒ **它不匹配那兩個行首形狀** ⇒ 提醒不再污染自己要人做的那個量測。
#    🔴🔴 **而我的修法【把裸 grep 的虛報弄得更糟, 不是更好】—— 寫下來, 不假裝沒發生**:
#       改前裸 `grep -c ERROR` ⇒ **2**(真錯 1 + 舊警告 1);**改後 ⇒ 3**(新句子提了兩次那個字)。
#    ✅ **而那【不是回歸】, 因為裸 grep 從來就不是對的尺** —— 任何一句解釋這件事的話都會被它撈到
#       ⇒ 📌 **修法的目標是【讓人換一把尺】, 不是【讓錯的那把變準】** —— 後者做不到。
#       同一發實測:行首形狀 ⇒ **1**(對)· 乾淨 .sql 的行首形狀 ⇒ **0**(負對照)。
#
# 🔵 **`ON_ERROR_STOP` 這一半【不是缺陷, 不要修】** —— 上一段 `:28` 已經寫死理由:
#    替它自動加會**壓掉那些故意要噴錯的負對照格**, 而那些格是我們驗尺的方法。
#    ⇒ 📌 這裡的正確做法是【講出來】, 不是【替它決定】。
grep -q 'ON_ERROR_STOP' "$SQL_ABS" || printf '\n⚠️ 這支沒有 `\\set ON_ERROR_STOP on`(刻意, 見本腳本註解)⇒ 中間某格炸掉後面照樣跑照樣印, 而 rc 仍是 0。\n   自己掃一次輸出, 掃法:grep -nE %s^psql:.*ERROR|^ERROR:%s <輸出>\n   🔴 不要用裸的 grep -c 去數那個字 —— 它會連【這一句話】一起數進去(實測虛報 1)。\n' "'" "'" >&2
printf '\nrc=%s\n' "$RC" >&2
exit "$RC"
