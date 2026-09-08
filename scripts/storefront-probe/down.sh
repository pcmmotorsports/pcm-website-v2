#!/usr/bin/env bash
# 收攤 —— 三層驗死,**不看 pkill / pg_ctl 的回傳值**(它們回 0 不代表東西死了)。
#
# 🔴 2026-08-18 實錘:本腳本的 pkill pattern 曾寫成 `cors_server.py`(底線)而檔名是
#    `cors-server.py`(連字號)⇒ 程序沒被殺,**只有最後那道 lsof 把它抓出來**。
#    ⇒ 這就是為什麼收攤要驗多層:改檔名會讓 pattern 悄悄失效,而 pkill 一個字都不會說。
#
# 🔴🔴 2026-08-19 修三個坑(W4 量測 + W6 讀檔 + W3 實測):
#  ① **postgres 那一格【本來是恆綠的】**:pattern 寫 `postgres -p 55533`,
#     而 `up.sh` 用 `pg_ctl -D …` 起,cmdline 是 `postgres -D /tmp/… -p 55533`
#     ⇒ **`postgres` 與 `-p` 中間隔著 `-D <路徑>`,字面不連續 ⇒ 永遠不命中**
#     ⇒ 那一格【不論死沒死都印「已停」】。
#     **W3 2026-08-19 實測**(真的起一個 `-D` 起法的 postgres 再量):
#       cmdline  = `…/postgres -D /tmp/w3-pgtest/pg -p 55571 -k /tmp`
#       `pgrep -f "postgres -p 55571"` ⇒ **沒命中**(恆綠格證實)
#       `postmaster.pid` 第一行 + `kill -0` ⇒ **抓到活著**
#     🔴 **不要改成「另一個 pgrep 字面」** —— 三種起法(`pg_ctl -D` / 直接 `postgres -D` /
#        `export PGDATA`)的 cmdline 形狀不同,**任何字面都只覆蓋一部分**;
#        `postmaster.pid` 那把尺**與啟動方式無關**(W6 逐字)。
#  ② **`rm -rf` 本來是無條件的**:它跑在檢查【之後】而不看檢查結果
#     ⇒ 印完「🔴 還活著」照樣把資料目錄刪掉 ⇒ **失敗路徑把你要用來查的東西刪掉了**,
#        而且會留下一個**沒有 datadir 的活 postgres**(孤兒)。
#  ③ **最後一行本來讀起來像成功**:`test -e` 只問目錄在不在,
#     上面印過「🔴 還活著」它仍然印「資料目錄已刪」⇒ 收尾那句與實情脫鉤。
#     ⇒ 現在**整支有 rc,而且 exit rc** —— 本來這支腳本【永遠 exit 0】。
set -uo pipefail

# 🔴 路徑可覆寫:多窗平行時各自帶一個 `STOREFRONT_PROBE_DIR`,否則兩邊會互相拆台
#    (up.sh 有同名變數與一道前置閘;預設值兩邊必須一致)。
SP_DOWN="$(cd "$(dirname "$0")" && pwd)"
# 🔴 路徑**與埠**住在 `env.sh`,**up 與 down 讀同一份**(2026-08-19 W3)。
#    ⚠️ 落檔前這兩支**各自寫了一份常數,而它們已經不一樣了**:`CORS=3987` 只在本檔那一行,
#       `up.sh` 那一行沒有它(它把 3987 當字面散在三處)⇒ **分歧已經存在,而沒有東西會紅。**
# shellcheck source=./env.sh
. "$SP_DOWN/env.sh"
# 🔴 把這次要收的埠印出來 —— 與 `owner.txt` 那行對不上,就是你收的時候帶錯組合了。
echo "── 這一發要收的埠(來自 env.sh / 你的環境變數)──"
echo "   web $WEB / proxy $PROXY / prest $PREST / cors $CORS / pg $PG   datadir $S"

echo "── 收攤目標:$S ──"
# 🔴🔴 **在【刪之前】就把「當時有沒有 owner.txt」記下來。**
#    2026-08-19 我第一版把這個判斷寫在最後那句話裡 —— 而那時 `rm -rf "$S"` 已經跑過了
#    ⇒ **owner.txt 一定不在** ⇒ 那則警告【無條件】印出來,連正常收攤都印。
#    ⇒ 正對照抓到的:我造一個帶 owner.txt 的假目錄去跑,它照樣印警告。
#    📌 同族:「標籤要由結果決定」——而這一次錯的是**時點**:我問的時候,答案已經被我自己改掉了。
_had_owner=0; [ -f "$S/owner.txt" ] && _had_owner=1
if [ "$_had_owner" = "1" ]; then
  echo "   這份鑽機的來歷(up.sh 起的時候記的):"
  sed 's/^/     /' "$S/owner.txt"
else
  echo "   ⚠️ 沒有 owner.txt ⇒ 它可能不是這支腳本起的,或是舊版起的。"
fi

pkill -f "next dev -p $WEB" || true
pkill -f "$S/proxy.py" || true
pkill -f "$S/prest.conf" || true
# 🔴 **帶埠**:不帶的話這一行會殺掉**別的視窗**起的 cors-server(同一台機器上 cmdline 一模一樣)。
#    2026-08-19 起 `up.sh` 用 argv 把埠傳給它 ⇒ cmdline 含得到這個數字。
pkill -f "cors-server.py $CORS" || true
pg_ctl -D "$S/pg" stop -m immediate > /dev/null 2>&1 || true
sleep 2

# 🔴🔴 **把 `next dev` 產的型別檔清掉(板列 ⟦auth-PROBENEXTRED⟧)。**
#    **症狀**:收攤之後跑 `TURBO_FORCE=1 pnpm typecheck` ⇒ **rc=2**, 紅在
#    `apps/storefront/.next/dev/types/routes.d.ts`(`TS1434` / `TS1128` / `TS1109` 同一行連三發),
#    開檔看是 `e]>` —— **一個被寫到一半就斷掉的產生檔**(上面那發 pkill 把 dev server
#    砍在它正在寫的時候)。
#    🔴 **為什麼它特別毒**:那支檔是 untracked 而且在 `.gitignore` 的 `.next/` 底下
#    ⇒ `git status` 乾淨、`git diff` 空的、`git log` 查不到誰動過它
#    ⇒ 📌 **他找不到是誰改的, 因為【沒有人改】** —— 而紅的檔又不是他這一片動的任何一支
#    ⇒ 讀起來像「別人弄壞了 dev」, 那會讓他去問錯的人、或 revert 錯的東西。
#
#    🔬 **`-sync` 2026-09-09 量的兩件, 各自都要寫下來**:
#    ① **我重跑一次【沒有重現】** —— up ⇒ 看畫面 ⇒ down ⇒ typecheck `rc=0`, 檔尾完整。
#       ⇒ 📌 **它是【間歇】的**(要剛好砍在寫入中途), 不是每次都會。
#       ⇒ 🛑 **而那正是清掉它的理由, 不是不清的理由**:一個間歇的紅比每次都紅難查,
#         因為下一個人重跑一次會看到綠, 然後以為自己修好了。
#    ② **刪掉這一層【不會】弄壞任何東西, 兩個世界都量過**:
#       刪掉後 `TURBO_FORCE=1 pnpm typecheck` ⇒ **rc=0, error TS 命中 0**;
#       而真瀏覽器測試(要 `.next/static` 的編譯 CSS)⇒ **3 格照樣全過**。
#       ⇒ 🔵 **`dev/` 只裝 dev server 的產物;`build` 的產物在 `static/` 與 `types/`, 我沒碰。**
#
#    🛑 **刻意【無條件】跑, 而不是像 `rm -rf "$S"` 那樣只在全綠時跑** ——
#       那一條的理由是「失敗路徑把你要查的證據刪掉了」, 而**這一層不是任何東西的證據**:
#       它是 `next dev` 下次開機自己重產的。留著它才是那個 bug。
rm -rf "$(cd "$(dirname "$0")/../.." && pwd)/apps/storefront/.next/dev"

rc=0

# postgres 的狀態:讀 pid 檔,而**沒有 pid 檔時要問埠** ——
# 🔴 否則「從來沒起過」與「pid 檔被刪了而程序還活著」會印出同一句話(那就是換一個恆綠格)。
pg_state() {
  local dd="$S/pg" pid
  if [ -f "$dd/postmaster.pid" ]; then
    pid=$(head -1 "$dd/postmaster.pid" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then echo "alive:$pid"; else echo "stale:${pid:-?}"; fi
  elif lsof -nP -iTCP:$PG -sTCP:LISTEN 2>/dev/null | grep -v WARNING | grep -q .; then
    echo "orphan"
  else
    echo "gone"
  fi
}

echo "── 第一層:程序(pattern 對不對得上,見檔頭那條實錘)──"
# 🔴🔴 **`next dev` 與 `cors` 兩格改成【讀埠佔用者】**(2026-08-19 W3;`admin-probe` 同款修法):
#    本檔檔頭 :8-11 自己記著 `next dev` 會把自己改名成 `next-server (vX.Y.Z)`
#    ⇒ 拿啟動指令的字面去 `pgrep -f`,**父程序被帶走而 worker 還活著時會印「已停」**。
#    ⇒ 與 postgres 同一個處置:**問【誰在聽那個埠】,那把尺與程序叫什麼名字無關。**
#    ⚠️ 與下面第二層不重複:第二層問「埠釋放了沒」(任何人佔著都紅),
#       這一層問「**還在聽的那個是誰**」—— 兩格的紅指向不同的下一步。
for spec in "next:$WEB" "cors:$CORS"; do
  _nm=${spec%%:*}; _pt=${spec##*:}
  printf "  %-34s " "$_nm(讀埠 $_pt 的佔用者)"
  _own=$(lsof -nP -iTCP:$_pt -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
  if [ -n "$_own" ]; then echo "🔴 還活著 —— pid/command = $_own"; rc=1; else echo "已停"; fi
done
for pat in "$S/proxy.py" "$S/prest.conf"; do
  printf "  %-34s " "$pat"
  if pgrep -f "$pat" >/dev/null; then echo "🔴 還活著"; rc=1; else echo "已停"; fi
done

printf "  %-34s " "postgres(讀 postmaster.pid)"
case "$(pg_state)" in
  alive:*) echo "🔴 還活著 —— pid $(pg_state | cut -d: -f2)"; rc=1 ;;
  orphan)  echo "🔴 pid 檔不見了,而埠 $PG 還有人聽 ⇒ **孤兒 postgres**,手動查 lsof -iTCP:$PG"; rc=1 ;;
  stale:*) echo "已停(留了一個過期的 postmaster.pid,無害)" ;;
  gone)    echo "已停" ;;
esac

echo "── 第二層:埠(這一層才是真的判準)──"
for p in $WEB $PROXY $PREST $CORS $PG; do
  printf "  埠 %-6s " "$p"
  # 🔴 命中時把【佔用者】印出來 —— 這幾個埠沒有界定「只收自己的」,
  #    任何無關程序佔著它,正常收攤照樣會報紅。印出 pid/command 才分得出是誰的。
  owner=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
  if [ -n "$owner" ]; then echo "🔴 還佔著 —— 佔用者 pid/command = $owner"; rc=1; else echo "已釋放"; fi
done

# 🔴🔴 **只有前面全乾淨才刪資料目錄。**
#    本來這行是無條件的 ⇒ 判「還活著」的時候它仍然刪,然後印「已刪」
#    ⇒ 下一次 up.sh 會撞上一個**沒有 datadir 的活 server**,而畫面上看不出來。
# 🔴 **「本來就不存在」與「我刪掉了」不可以印同一句話**(2026-08-19 W3 於 admin-probe 實測):
#    `rm -rf` 對一個不存在的路徑**回 0** ⇒ 舊寫法照樣印「已刪」,而它一個 byte 都沒動過。
#    那個情境不是假想的:**收的時候忘了帶同一組埠/路徑**,這一整支就會對著一個空路徑報全綠。
_existed=0; [ -e "$S" ] && _existed=1

# 🔴🔴 **刪之前先把 `apply.log` 抄出去**(2026-09-07 `front`;板列 `⟦front-PROBEREPLAYGAP⟧`)。
#    實錘:2026-09-07 11:46 `auth` 起 probe, 重放 109 支 migration FAIL;要查是哪幾支的時候,
#    `apply.log` 已經隨這一行 `rm -rf` 一起走了 —— 而**收攤那一發是全綠的**。
#    🎯 **⇒ 病灶不是「忘了留」, 是【證據住在只有收攤流程碰得到的地方, 而收攤看起來完全正常】。**
#    ⇒ 📌 上面 `rc != 0` 那條路已經會保留整個目錄了;**這裡補的是【乾淨收攤】那條路** ——
#      而那條路正是最常走、也最不會有人回頭看的一條。
#    🛑 **標籤由結果決定**(同檔 `_had_owner` 那格的教訓):抄到了、沒東西可抄、抄失敗
#      是三種不同的話, 不可以印同一句。
_APPLY_SRC="$S/apply.log"
_APPLY_DST="$HOME/pcm-mailbox/probe-apply-$(date +%Y%m%d-%H%M%S)-$WEB.log"
# 🔴 **目的地目錄不在就先建**(code-reviewer 2026-09-07 nit)——
#    少了這行, `~/pcm-mailbox` 不存在時 `cp` 失敗 ⇒ 下面判 rc=1 ⇒ 資料目錄不刪 ⇒ 收攤紅。
#    ⚠️ **而這行只消掉【最常見的那個觸發】, 不是「不會發生」**(R2 nit 訂正我原本的字面):
#    `$HOME/pcm-mailbox` 是檔案 / 不可寫 / 磁碟滿, `mkdir -p … || true` 都照樣吞掉,
#    而 `cp` 仍會失敗 ⇒ 同一個紅。📌 **降低機率 ≠ 不會發生**, 兩者在註解裡長得很像。
mkdir -p "$(dirname "$_APPLY_DST")" 2>/dev/null || true
printf "  %-36s " "apply.log 留底"
if [ ! -f "$_APPLY_SRC" ]; then
  echo "⚠️ 沒有 $_APPLY_SRC ⇒ 沒東西可抄(這一發可能沒套過 migration)"
elif cp "$_APPLY_SRC" "$_APPLY_DST" 2>/dev/null; then
  # 🔴🔴 **判成功只看 `cp` 的 rc, ⛔ ~~不要再加 `[ -s "$_APPLY_DST" ]`~~**
  #    (2026-09-07 code-reviewer R2 must-fix;我第一版就是加了那個 `-s`)。
  #    成因:`up.sh:190` 的 `>> $S/apply.log` **不論有沒有輸出都會把檔建出來**,
  #    而 `psql -q` 在**全部 migration 都成功且零 NOTICE** 時**一個字都不印**
  #    ⇒ **0 byte 的 apply.log** ⇒ `cp` 成功而 `-s` 失敗 ⇒ 走紅路 ⇒ **資料目錄從此不刪**。
  #    🎯 **⇒ 那個「保險」會在【一切順利】的那一次把收攤卡死** —— 失敗形狀藏在成功路徑裡。
  #    ⚠️ 射程:「psql 真的會靜默」那一半 reviewer **未實測**, 我也沒有;
  #       而**不論它印不印, `cp` 的 rc 都是對的判準**, 所以這個修法不依賴那一半。
  echo "已抄到 $_APPLY_DST（$(wc -l < "$_APPLY_DST" | tr -d ' ') 行;0 行是合法的 —— 全綠重放不印東西）"
else
  # 🔴 抄不出來要**紅**, 而且**不能繼續往下刪** —— 刪掉就永遠沒了。
  echo "🔴 cp 失敗 ⇒ 不刪資料目錄。來源還在 $_APPLY_SRC(它可能是 0 byte, 那不是壞掉)"
  rc=1
fi

printf "  %-36s " "資料目錄 $S"
if [ "$rc" = "0" ]; then
  rm -rf "$S"
  if [ -e "$S" ]; then echo "🔴 刪不掉"; rc=1
  elif [ "$_existed" = "1" ]; then echo "已刪"
  else echo "⚠️ 本來就不存在(不是我刪的)—— 你可能收錯了一組,見上面那行埠"; fi
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
  echo "✅ **我檢查的那組**($WEB/$PROXY/$PREST/$CORS/$PG)是乾淨的。"
  if [ "$_had_owner" = "0" ]; then
    echo "   ⚠️ 而這一組底下沒有 owner.txt ⇒ **我不知道你要收的是哪一組**。"
    echo "      你剛才若有帶覆寫(埠/路徑),這一發【沒有收到它】—— 拿同一組再跑一次。"
  fi
else
  echo "🔴 **沒收乾淨** —— 上面標紅的那幾格要手動處理,不要當作收完了。"
fi
exit $rc
