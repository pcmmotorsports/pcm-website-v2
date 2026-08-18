#!/usr/bin/env bash
# 收攤 —— 逐項 pgrep + 逐埠 lsof 驗死,**不看 pkill 的回傳值**(pkill 回 0 不代表它死了)。
# 🔴 2026-08-18 實錘:這支腳本自己的 pkill pattern 曾經寫成 `cors_server.py`(底線)
#    而檔名是 `cors-server.py`(連字號)⇒ 程序沒被殺、而**只有最後那道 lsof 把它抓出來**。
#    ⇒ 這就是為什麼收攤要驗兩層:改了檔名就會讓 pattern 悄悄失效,pkill 一個字都不會說。
pkill -f "next dev -p 3020" || true
pkill -f "pcm-g3-probe/proxy.py" || true
pkill -f "pcm-g3-probe/prest.conf" || true
pkill -f "cors-server.py" || true
pg_ctl -D /tmp/pcm-g3-probe/pg stop -m immediate > /dev/null 2>&1 || true
sleep 2
for pat in "next dev -p 3020" "pcm-g3-probe/proxy.py" "pcm-g3-probe/prest.conf" "cors-server.py" "postgres -p 55533"; do
  printf "%-30s " "$pat"; pgrep -f "$pat" >/dev/null && echo "🔴 還活著" || echo "已停"
done
for p in 3020 3968 3969 3987 55533; do
  printf "埠 %-6s " "$p"
  lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | grep -q . && echo "🔴 還佔著" || echo "已釋放"
done
rm -rf /tmp/pcm-g3-probe
test -e /tmp/pcm-g3-probe && echo "🔴 資料目錄還在" || echo "資料目錄已刪"
