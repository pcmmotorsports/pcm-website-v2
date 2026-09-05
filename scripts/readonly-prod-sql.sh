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
grep -q 'ON_ERROR_STOP' "$SQL_ABS" || printf '\n⚠️ 這支沒有 `\\set ON_ERROR_STOP on` ⇒ 中間某格炸掉後面照樣跑照樣印, 而 rc 仍是 0。自己掃一次輸出裡的 ERROR。\n' >&2
printf '\nrc=%s\n' "$RC" >&2
exit "$RC"
