#!/usr/bin/env bash
# 收攤 —— 逐項 pgrep + 逐埠 lsof 驗死,**不看 pkill 的回傳值**(pkill 回 0 不代表它死了)。
#
# 🔴 **兩層都要驗,而理由是實錘**:顧客站那支的 pkill pattern 曾經寫成 `cors_server.py`(底線)
#    而檔名是 `cors-server.py`(連字號)⇒ 程序沒被殺,**只有最後那道 lsof 把它抓出來**。
#    ⇒ 改檔名就會讓 pattern 悄悄失效,而 pkill 一個字都不會說。
#
# 🔴 **另一把會說謊的尺**:`next dev` 啟動後會把自己改名成 `next-server (vX.Y.Z)`
#    ⇒ 拿**啟動時的指令字串**去 `pgrep -f` 匹配不到它(2026-08-19 G5 實錘:
#    報「零命中 ⇒ 已驗死」,30 分鐘後 Next 自己說 `Another next dev server is already running`)。
#    ⇒ **所以埠那一層才是真的判準** —— 程序名可以變,誰在聽那個埠不會。
#
# ⚠️ **只收自己的** —— 同一台機器上可能有別窗的 `next-server` / 別的鑽機。
#    不要 `pkill -f next-server`,pattern 一律帶自己的埠或自己的資料目錄。
#
# 🔴🔴 **2026-08-19 更正上面那句 —— 它對 postgres 不成立,而本檔曾經照它寫、寫出一個恆綠格。**
#    ~~原句讀起來像「埠或資料目錄,挑一個都行」~~ ⇒ **兩者【各自只在一半的起法上有效】**:
#    **本窗實測(同一個活著的 postgres,三把尺各量一次)**:
#    ```
#    cmdline = …/postgres -D /tmp/w3-pgtest2/pg -p 55573 -k /tmp   （pg_ctl -D 起法）
#      pgrep -f "postgres -p 55573"     ⇒ ❌ 沒命中  ← `postgres` 與 `-p` 中間隔著 `-D <路徑>`
#      pgrep -f "/tmp/w3-pgtest2/pg"    ⇒ ✅ 命中
#      postmaster.pid 第一行 + kill -0  ⇒ ✅ 命中
#    而 `export PGDATA=…` 起法的 cmdline【沒有資料目錄】⇒ 資料目錄形反過來失效、埠形有效。
#    ```
#    ⇒ 🔴 **沒有任何一個字面是通用的;`postmaster.pid` 那把尺【與啟動方式無關】** ——
#      所以下面 postgres 那一格**不用 pgrep**,單獨走 `pg_state()`。
#    📌 而這個恆綠格是**本窗自己踩的**:我先前拿一個 `PGDATA` 起法的 postgres 量,
#      得到「埠形有效」,再套到自己這支(`up.sh` 是 `pg_ctl -D` 起法)⇒ **量了 A 拿去答 B。**
set -uo pipefail

# 🔴 路徑可覆寫:多窗平行時各自帶一個 `ADMIN_PROBE_DIR`(up.sh 讀同一個變數、同一個預設值)。
S=${ADMIN_PROBE_DIR:-/tmp/pcm-admin-probe}
WEB=3011; PROXY=3978; PREST=3979; PG=55534

if [ -f "$S/owner.txt" ]; then
  echo "── 這份鑽機的來歷(up.sh 起的時候記的)──"; sed 's/^/   /' "$S/owner.txt"
fi

pkill -f "next dev -p $WEB" || true
pkill -f "$S/proxy.py" || true
pkill -f "$S/prest.conf" || true
pg_ctl -D $S/pg stop -m immediate > /dev/null 2>&1 || true
sleep 2

rc=0
echo "── 第一層:程序(pattern 對不對得上,見檔頭那條實錘)──"
for pat in "next dev -p $WEB" "$S/proxy.py" "$S/prest.conf"; do
  printf "  %-34s " "$pat"
  if pgrep -f "$pat" >/dev/null; then echo "🔴 還活著"; rc=1; else echo "已停"; fi
done

# postgres 不走 pgrep(理由見檔頭):讀 pid 檔,而**沒有 pid 檔時要問埠** ——
# 🔴 否則「從來沒起過」與「pid 檔被刪了而程序還活著」會印出同一句話 = 換一個恆綠格。
pg_state() {
  local dd="$S/pg" pid
  if [ -f "$dd/postmaster.pid" ]; then
    pid=$(head -1 "$dd/postmaster.pid" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then echo "alive:$pid"; else echo "stale"; fi
  elif lsof -nP -iTCP:$PG -sTCP:LISTEN 2>/dev/null | grep -v WARNING | grep -q .; then
    echo "orphan"
  else
    echo "gone"
  fi
}
printf "  %-34s " "postgres(讀 postmaster.pid)"
_st=$(pg_state)
case "$_st" in
  alive:*) echo "🔴 還活著 —— pid ${_st#alive:}"; rc=1 ;;
  orphan)  echo "🔴 pid 檔不見了,而埠 $PG 還有人聽 ⇒ **孤兒 postgres**,手動查 lsof -iTCP:$PG"; rc=1 ;;
  stale)   echo "已停(留了一個過期的 postmaster.pid,無害)" ;;
  gone)    echo "已停" ;;
esac

echo "── 第二層:埠(這一層才是真的判準)──"
for p in $WEB $PROXY $PREST $PG; do
  printf "  埠 %-6s " "$p"
  # 🔴 命中時把【佔用者】印出來(W2 審查 F2)—— 這四個埠沒有界定「只收自己的」,
  #    任何無關程序佔著它,正常收攤照樣會報紅。印出 pid/command 才分得出是誰的。
  #    (碰撞面 W2 量過:這四個埠在 `scripts/` 內各只出現 2 次,顧客站鑽機用另一組 ⇒ repo 內零重疊。)
  owner=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
  if [ -n "$owner" ]; then
    echo "🔴 還佔著 —— 佔用者 pid/command = $owner"; rc=1
  else echo "已釋放"; fi
done

# 🔴🔴 **只有兩層都乾淨才刪資料目錄**(W2 審查 F3)。
#    原本 `rm -rf` 是**無條件**跑在兩層檢查【之後】⇒ 判「🔴 還活著/還佔著」的時候,
#    它仍然把資料目錄刪掉(含還在跑的那個 postgres 的 data dir),
#    然後印「已刪」+ rc=1 ⇒ **下一次 up.sh 會撞上一個沒有 data dir 的活 server**。
#    🔴 形狀:**失敗路徑把你要用來查的東西刪掉了。**
#    📌 這一條 W2 是【讀控制流】得到的,而我 2026-08-19 **實際製造一次失敗驗過**:
#       造一個活的佔埠程序 + 假的 data dir ⇒ 收攤報「沒收乾淨」,而 `/tmp/pcm-admin-probe` **真的被刪了**。
printf "  %-36s " "資料目錄 $S"
if [ "$rc" = "0" ]; then
  rm -rf $S
  if [ -e "$S" ]; then echo "🔴 刪不掉"; rc=1; else echo "已刪"; fi
else
  echo "⏸ 保留供你查(上面有紅,現在刪掉會把證據一起刪了)"
fi

echo
if [ "$rc" = "0" ]; then echo "✅ 收乾淨了(兩層都驗過)。"; else echo "🔴 **沒收乾淨** —— 上面標紅的那幾格要手動處理,不要當作收完了。"; fi
exit $rc
