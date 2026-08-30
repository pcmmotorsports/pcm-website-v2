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

# 🔴 路徑**與埠**都可覆寫,而定義住在 `env.sh` —— **up 與 down 讀同一份**(W6 `W6-043` n2)。
#    ⚠️ 為什麼不能兩邊各寫一份 `${VAR:-預設}`:起的時候覆寫、收的時候忘了帶 ⇒ 這支拿【預設埠】去查
#    ⇒ **兩層都印「已釋放」而鑽機還活著**;而埠層之所以是「真的判準」正是因為它原本寫死
#    ⇒ 參數化做錯**會把最後那道保險一起拿掉**。全文在 `env.sh` 檔頭。
SP_DOWN="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./env.sh
. "$SP_DOWN/env.sh"
# 🔴 **把這次用的四個埠印出來** —— 與 `owner.txt` 那行對不上,就是你收的時候帶錯了組合
#    (而那正是上面那個形狀唯一看得見的徵兆)。
echo "── 這一發要收的埠(來自 env.sh / 你的環境變數)──"
echo "   web $WEB / proxy $PROXY / prest $PREST / pg $PG   datadir $S"

# 🔴🔴 **在【刪之前】就把「當時有沒有 owner.txt」記下來。**
#    2026-08-19 我第一版把這個判斷寫在最後那句話裡 —— 而那時 `rm -rf "$S"` 已經跑過了
#    ⇒ **owner.txt 一定不在** ⇒ 那則警告【無條件】印出來,連正常收攤都印。
#    ⇒ 正對照抓到的:我造一個帶 owner.txt 的假目錄去跑,它照樣印警告。
#    📌 同族:「標籤要由結果決定」——而這一次錯的是**時點**:我問的時候,答案已經被我自己改掉了。
_had_owner=0; [ -f "$S/owner.txt" ] && _had_owner=1
if [ "$_had_owner" = "1" ]; then
  echo "── 這份鑽機的來歷(up.sh 起的時候記的)──"; sed 's/^/   /' "$S/owner.txt"
else
  # 🔴🔴 **這個 else 是我自己實測出來的**(2026-08-19,做埠參數化的當下):
  #    用非預設埠起了鑽機、收攤時**忘了帶同一組** ⇒ 這支拿預設埠去查
  #    ⇒ 每一格都印「已停 / 已釋放 / 已刪」、最後印「✅ 收乾淨了」——
  #    **而那份鑽機一個程序都沒少。** 那是這次參數化引進的新失敗模式(W6 事前就警告過)。
  #    ⇒ 沒有 owner.txt = 這個 datadir 底下**從來沒有人起過鑽機** ⇒ 先講出來,不要靜靜往下跑。
  echo "⚠️ 找不到 $S/owner.txt —— 這個資料目錄底下沒有 up.sh 留下的來歷。" >&2
  echo "   兩種可能,而它們的下一步相反:" >&2
  echo "     ① 本來就沒有東西在跑(那下面全綠是對的)" >&2
  echo "     ② 🔴 **你起的時候覆寫了埠/路徑,收的時候忘了帶同一組**" >&2
  echo "        ⇒ 下面每一格都會印綠,而你的鑽機還活著。" >&2
  # 🔴 這一行**曾經用反引號包那個命令,而它當場被 shell 執行掉了**(2026-08-19 實測:
  #    輸出變成「判別法:/tmp/pcm-admin-probe-w3fix 看看…」)。CLAUDE.md 那條「雙引號內禁反引號」
  #    講的正是這個 —— 而**這一次它印出來的東西剛好是對的**,所以差點看不出來。
  echo '        判別法:ls -d /tmp/pcm-admin-probe* 看看還有沒有別的,並比對它的 owner.txt。' >&2
  # 🔴🔴 **2026-08-30:這裡從「印警告然後照收」改成【停下不收】**(`-48` 批准)。
  #    成因是實錘,不是假設:`-08` 當晚 19:0x 用 `env $E bash down.sh`(`$E` 是一整串 env),
  #    而 **zsh 不對未加引號的變數斷詞** ⇒ 整串被當成一個 `ADMIN_PROBE_DIR`
  #    ⇒ 覆寫全部失效 ⇒ 落回預設埠 ⇒ **它把【別人】跑在 3011 的鑽機停掉了**。
  #    📌 **而上面那段警告【當時就印出來了】** —— 它印完照樣往下跑,而人不會為了一則警告停手。
  #    ⇒ ⇒ **警告與閘的差別就在這一行:一個要人做決定,一個替人做決定。**
  #    ⚠️ 同一位作者在**一小時前**才把「裸跑 down.sh 會殺到別人」寫進 runbook §13
  #       ⇒ **他寫了那條規則,然後從另一條路徑走進同一個坑** ⇒ 這格是「機制優先律」的實證。
  if [ "${ADMIN_PROBE_FORCE_DOWN:-}" != "1" ]; then
    echo "" >&2
    echo "🛑 **停下,不收。**這個 datadir 底下沒有 owner.txt ⇒ 我無法確認這一組埠是你的。" >&2
    echo "   🔴 而這些埠上若有東西,它可能是【別人】的鑽機 —— 停掉它是不可逆的。" >&2
    echo "" >&2
    echo "   ── 怎麼往下走(三選一)──" >&2
    echo "   ① 你起的時候帶了自訂埠 ⇒ **帶同一組再跑一次**。忘了帶什麼:" >&2
    echo "        ls -dt /tmp/pcm-admin-probe*/ && head -6 <那個目錄>/owner.txt" >&2
    echo "      🔴 而【逐個 VAR=值 直接前綴】,不要塞進一個變數再展開(zsh 不斷詞)。" >&2
    echo "   ② 本來就沒有東西在跑 ⇒ 那就不需要收,直接離開。" >&2
    echo "   ③ 確定要收這一組(而你接受它可能是別人的)⇒ ADMIN_PROBE_FORCE_DOWN=1 再跑。" >&2
    echo "      ⚠️ 它會停掉埠 $WEB / $PROXY / $PREST / $PG 上的東西,**而我分不出那是誰的**。" >&2
    exit 2
  fi
  echo "⚠️ ADMIN_PROBE_FORCE_DOWN=1 ⇒ 明知沒有 owner.txt 仍往下收(埠 $WEB/$PROXY/$PREST/$PG)。" >&2
fi

pkill -f "next dev -p $WEB" || true
pkill -f "$S/proxy.py" || true
pkill -f "$S/prest.conf" || true
pg_ctl -D $S/pg stop -m immediate > /dev/null 2>&1 || true
sleep 2

rc=0
echo "── 第一層:程序(pattern 對不對得上,見檔頭那條實錘)──"
# 🔴🔴 **`next dev` 那一格不走 pgrep(W6 `W6-043` n1)** —— 檔頭 8-11 自己記著 worker 會改名成
#    `next-server (vX.Y.Z)` ⇒ 拿啟動指令的字面去比對,**父程序被帶走而 worker 還活著時會印「已停」**。
#    ⇒ 與 postgres 同一個處置:**問【誰在聽那個埠】,那把尺與程序叫什麼名字無關。**
#    ⚠️ 而它與下面第二層**不是重複**:第二層問「埠釋放了沒」(任何人佔著都算紅),
#       這一層問「**還在聽的那個是不是 next**」—— 兩格的紅指向不同的下一步。
printf "  %-34s " "next(讀埠 $WEB 的佔用者)"
_next_owner=$(lsof -nP -iTCP:$WEB -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
if [ -n "$_next_owner" ]; then echo "🔴 還活著 —— pid/command = $_next_owner"; rc=1; else echo "已停"; fi
for pat in "$S/proxy.py" "$S/prest.conf"; do
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
# 🔴 **「本來就不存在」與「我刪掉了」不可以印同一句話**(2026-08-19 實測踩到):
#    `rm -rf` 對一個不存在的路徑**回 0**,而舊寫法照樣印「已刪」
#    ⇒ 收錯一組埠的那個情境下,它會說「已刪」而它一個 byte 都沒動過。
_existed=0; [ -e "$S" ] && _existed=1
if [ "$rc" = "0" ]; then
  rm -rf "$S"   # 🔴 引號:`${ADMIN_PROBE_DIR:-…}` 只擋空字串,擋不了空白/glob(W6 `W6-043` n3)
  if [ -e "$S" ]; then echo "🔴 刪不掉"; rc=1
  elif [ "$_existed" = "1" ]; then echo "已刪"
  else echo "⚠️ 本來就不存在(不是我刪的)—— 見上面那則 owner.txt 警告"; fi
else
  echo "⏸ 保留供你查(上面有紅,現在刪掉會把證據一起刪了)"
fi

echo
# 🔴🔴 **這句話的【射程】2026-08-19 改過(W6 Q2)** —— 舊版說「收乾淨了」,
#    而那是一句關於**你要收的那組**的宣稱;這支檢查的卻是**你帶進來的那組**。
#    帶錯組的時候,那兩組不是同一組 ⇒ 話沒說錯它量到的,說錯了它涵蓋的範圍。
#    ⚠️ **rc 維持不變**:「本來就沒東西在跑」是合法情境,判紅會製造假紅。
#       ⇒ 只改字,不改判定。(主視窗傾向判紅、W6 判 rc 綠而改字;我採 W6,理由寫在這裡。)
if [ "$rc" = "0" ]; then
  echo "✅ **我檢查的那組**($WEB/$PROXY/$PREST/$PG)是乾淨的。"
  if [ "$_had_owner" = "0" ]; then
    echo "   ⚠️ 而這一組底下沒有 owner.txt ⇒ **我不知道你要收的是哪一組**。"
    echo "      你剛才若有帶覆寫(埠/路徑),這一發【沒有收到它】—— 拿同一組再跑一次。"
  fi
else
  echo "🔴 **沒收乾淨** —— 上面標紅的那幾格要手動處理,不要當作收完了。"
fi
exit $rc
