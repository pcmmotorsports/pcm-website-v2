#!/usr/bin/env bash
# scripts/check-anon-grants-prod.sh — 對【正式庫】查 anon/authenticated 的實際權限現值。
#
# 回答兩條上線前缺口(docs/security/2026-08-17-pre-launch-must-close-checklist.md ③ 與 ④):
#   ③ E683-1 新建的表出生就自帶 anon 權限(含 TRUNCATE)  → 查 pg_default_acl 現值
#   ④ E686-1 net 兩表對 anon 全 DML + TRUNCATE、RLS 關   → 查那兩張表的表級 + 欄級權限
#
# 🔴 這支腳本【只讀不寫】:全部是 SELECT,零 DDL、零 DML。
# 🔴 用法(連線字串走 env,不進 argv、不進 shell history):
#     read -rs PGURL && export PGURL
#     bash scripts/check-anon-grants-prod.sh
#     unset PGURL
#   ⚠️ 本腳本【不接受】把連線字串當參數傳 —— 那會讓它出現在 process table(ps)裡。
#   ⚠️ 它也不會把連線字串交給 psql 的 argv:先拆成 PG* 環境變數再呼叫(見 connect_env)。
#
# 🔵 **同一件事現在有【第二把尺】, 而它每天自己跑一次**(2026-09-08 起):
#    `public.pcm_net_exposure_snapshot` —— migration `20260908030000` 排的 `pcm-net-exposure`
#    每天 00:00 UTC 唯讀量同一組東西並落一列。
#    🛑 **而它【尚未 apply】(2026-09-08 寫這行時)** —— 上面那句描述的是【貼下去之後】,
#       不是現在。查法 `bash scripts/is-migration-applied.sh 20260908030000`。
#    🛑 **而它【只記錄, 不告警】** —— 沒有任何東西會因為那個數字叫。
#    🔴 **兩把尺【曾經對同一座庫講相反的故事】** —— 這支手動的印「乾淨」, 而真實是 PUBLIC ALL
#       (成因見 (a) 那格的訂正註解)。⇒ **兩邊不一致時, 先問【它們各自量的是哪一個受詞】。**
#    ⚠️ 而那張表的基線【不是 0】:2026-09-08 由**本次查詢**實量 = 7(平台側的 PUBLIC 授權)
#       —— 🛑 那是【查詢的量測值】, 不是「已經存進那張快照表」(它還沒 apply)。
#       ⇒ 讀它要讀 **delta**, 不要讀絕對值。
#    🔴🔴 **而【只比數量的 delta 會漏掉權限擴大】**(2026-09-08 codex):
#       同一組授權從 `SELECT` 擴成 `ALL`, **ACL 組數與有效權限命中數都可能一格不變**
#       ⇒ delta = 0 而權限變大了。⇒ **要比【權限明細】(那串字母), 不是只比數字。**
#
# 🔴🔴 **`--selftest` 存在, 而它【只驗參數與工具兩層, 一條判準都沒驗】**(2026-09-08, `-1a` 裁甲案)。
#    rc:0=五格全過 / 1=有格子紅或越線 / 2=量具失效(實跑格數 != EXPECT_TOTAL)。
#    🛑 **盤點的人請讀這一段, 不要只看到 `--selftest` 這個字就記成「它的判準有守門」** ——
#       判準層(rc 0 / 6 / 7 / 8)**一格都沒有跑到**;要那個得起一台有表有 GRANT 的 PG
#       (plan §4 乙案, 已開成獨立一列)。
#    📌 **這段寫在檔頭而不只寫在輸出裡** —— P1-1 那類盤點是 `grep` 檔案字面與 `package.json`,
#       **它不執行 selftest** ⇒ 只寫在輸出裡的誠實標籤, 它看不到(R3 抓到)。
#
# rc:0=兩格都查到且對照組正常 / 2=用法錯 / 1=工具問題(psql 沒裝、連不上、量具證不出來)
#     6=這個庫沒有指定的校準表(你可能在跑報價單庫 ⇒ 用 CALIB_YES / CALIB_NO 指定)
#     8=第 ③ 段跑完了,而 net 兩表【不存在】⇒ 第 ④ 段不適用(不是「乾淨」)
#     7=校準表在,但它的權限現值不符預期 ⇒ 🔴 **這是一個【發現】,不是工具壞掉**
#   🔴 rc=1 / 6 都不是「查無」—— 不要當成「權限已經收乾淨了」。
#
# 🔴 **校準表是【網站庫專用】的,而「兩個庫都要跑」需要你先給那個庫自己的校準表**
#    (2026-08-18 主視窗抓到:`:19` 的指示與 `:56` 的校準互相矛盾 —— 報價單庫沒有 legal_terms_versions,
#     對照組在那裡永遠不成立 ⇒ 腳本永遠 rc=1、永遠報不出數。)
#    ⇒ 報價單庫要跑,先指定它自己的兩張表:
#         CALIB_YES=public.<那個庫裡 anon【應該】讀得到的表> \
#         CALIB_NO=public.<那個庫裡 anon【不該】有任何權限的表> bash scripts/check-anon-grants-prod.sh
#    ⚠️ E686 §6 講的是「兩庫的【結果】相同」,**不代表同一支校準在兩個庫都成立** —— 兩件事。
#
# 🔴🔴 **`information_schema` 會依【連線角色】過濾,而 `pg_catalog` 不會**(2026-08-18 G4 實測:
#    非 owner 非 grantee 的角色查 `information_schema.role_table_grants` ⇒ **0**,
#    同一時刻同一張表 `pg_class.relacl` ⇒ **7 項全開**)
#    ⇒ 本腳本第 ④ 段(`net` 兩表)**改走 `relacl` / `attacl`**,`information_schema` 只留作對照。
#    ⇒ **舊版對 `net` 那半印出來的「空」不算數** —— 它可能只是我們這條連線看不到。
#
# 🔴 **為什麼負向對照【不能單獨用】**(同日實錘,值得留在檔頭):
#    `admin_audit_log × anon ⇒ 0` 在「表被鎖好了」與「表根本不存在」兩個世界**印同一個東西**。
#    今天救了這支腳本的是**正向那一格**(表不在時它會掉到 0 而報紅)。
#    ⇒ 只放負向對照的話,它會在報價單庫上印出一個漂亮的綠。(memory `feedback_absence-read-as-verified`)

set -uo pipefail

# ── `--selftest`:A 層(參數/env)+ B 層(工具)的行為證人 ────────────────────
# 主視窗 `-1a` 2026-09-08 裁【甲 + 把乙開成一列】;plan = docs/plans/2026-09-08-check-anon-grants-selftest-plan.md
#
# 🛑🛑 **紅線:本 selftest 在任何情況下都不連正式庫。**
#    理由**不是**「它唯讀所以安全」—— 是 `-1a` 逐字那句:
#    「那條連線會住在一個**每個人每天跑幾十次**的位置, 而**沒有人會再去看它**。
#      一條沒有人在看的正式庫連線, 是最容易被下一次改動悄悄擴權的東西。」
#    ⇒ 判準是【它會待在一個沒有人看的位置】, 不是【它現在的權限】。
#
# 🔴 **每一格比【兩個數】:rc + 一句只有那個世界才會印的字面。**
#    只比 rc 在本腳本上**零判別力** —— `rc=2` 有兩條路(收到參數 / 沒有 PGURL)、
#    `rc=1` 有三條路(psql 不在 / python3 不在 / PGURL 解析失敗)。
#    ⇒ 一格「餵參數 ⇒ 期望 rc=2」會在**接線壞掉**與**接線修好**兩個世界同時綠(plan §0)。
if [ "${1:-}" = "--selftest" ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  _TD="$(mktemp -d)"
  trap 'rm -rf "$_TD"' EXIT
  mkdir -p "$_TD/empty" "$_TD/onlypsql" "$_TD/veto" "$_TD/record"
  # 🛑🛑 **越線警報**(code-reviewer 2026-09-08 R1 nit ⇒ 機制優先律):
  #    紅線「selftest 絕不連正式庫」原本**只靠每一格自己覆蓋 PGURL / PATH** ——
  #    那是紀律不是機制, 而 EXPECT_TOTAL 只抓格數變動,
  #    **抓不到「未來新增的第 6 格忘了覆蓋 PGURL」**。
  #    ⇒ 改成:讓越線這件事**自己出聲** —— 任何一格真的叫到 psql, 就會看到這句 + rc=97。
  #    (`exit 97` 刻意選一個本腳本沒用過的碼 ⇒ 它不會被誤讀成任何一條正常路徑。)
  # 🔴 **訊號寫檔案而不只寫 stderr** —— 而**理由不是我第一版寫的那個**(R3 抓到, 已訂正):
  #    ⛔ ~~「guard 印到 stderr 那句會被 run() 吞掉 ⇒ 傳不到 $out ⇒ veto 抓不到」~~
  #       **那是錯的**:R3 實測 stderr **到得了** `$out` —— `run()` 吞進 `EXIST` 之後,
  #       下面那行 `echo "$EXIST" | head -3 >&2` 又把它原封吐回 stderr, 再被 `2>&1` 收進 `$out`。
  #    🔬 真因(我自己複驗):我第一版測的時候**腳本正壞著**(`3>&2` 那個 `Bad file descriptor`)
  #       ⇒ 解析永遠失敗 ⇒ **那一格根本走不到 psql** ⇒ guard 沒被叫 ⇒ **沒有訊號可讀。**
  #       把第一版的 `$out` 版 veto 放回【修好的】腳本上跑同一格 ⇒ **它抓到了。**
  #    ⇒ 🛑 **我把「那格根本沒越線」誤診成「訊號路徑被吞掉」, 再從誤診推出一條聽起來很對的通則。**
  #       ✅ 保留檔案版的**真**理由:`$out` 版**依賴** `echo "$EXIST" | head -3 >&2` 那一行
  #          剛好把 guard 的話吐回來 —— 那是**巧合不是機制**, 那行改了它就失效。
  #          檔案不依賴任何人的重導。
  _CROSSED="$_TD/CROSSED"
  _REACHED="$_TD/REACHED"

  # ── 兩支 shim, 兩個目錄, 而**預設兩支都不在 PATH 上**(主視窗 `-1a` 2026-09-08 裁 F1 甲時的要求形狀)
  #
  # 🔴🔴 **越線的受詞是【連線】, 不是【檔名】** —— 這一句與「甲」是**成對**的, 不可只取前半:
  #    ⛔ ~~舊字面「叫到任何名為 psql 的檔 = 越線」~~ 是**黑名單形狀**, 它在跟
  #       「下一個沒想到的名字」賽跑(`psql17` / `pg_dump` / 一支包裝腳本…)。
  #       與 CLAUDE.md 那條「credential 命令改成【只印名稱】」同一個病(Sean 2026-08-31 拍過同型)。
  #    ✅ 現行定義:
  #         **越線 = 開出任何對外 socket / 連到任何真實 PG**
  #         **不越線 = 錄音 shim** —— 它不開任何 socket, 印完 `$PGHOST/$PGDATABASE` 就離場
  #    ⇒ 📌 下面兩支**都不連線**;差別是**一支代表「這一格不該走到這裡」、一支代表「我要看它走到」**。
  #
  # ① veto:這一格不該走到連線那一步。走到 ⇒ 一票否決。
  printf '%s\n' "#!/bin/sh
echo \"SELFTEST 越線:這一格走到了連線那一步。紅線是【不連任何真實 PG】。\" >&2
echo crossed >> \"$_CROSSED\"
exit 97" > "$_TD/veto/psql"
  chmod +x "$_TD/veto/psql"
  # ② record:我【要】它走到, 而且要驗參數。**不開 socket**, 印完就離場。
  printf '%s\n' "#!/bin/sh
echo \"REACHED_PSQL host=\$PGHOST db=\$PGDATABASE user=\$PGUSER\" >> \"$_REACHED\"
echo \"REACHED_PSQL host=\$PGHOST db=\$PGDATABASE user=\$PGUSER\" >&2
exit 1" > "$_TD/record/psql"
  chmod +x "$_TD/record/psql"
  # ③ noisypy:一支【會印一行 stderr】再 exec 真 python3 的 shim。
  #    🔴 **為什麼需要它**:C1 用正常的 python3 ⇒ 而 `2>&1` 那個 eval 汙染
  #       **只在 python 印 stderr 時發作** ⇒ C1 對它是**綠的**(2026-09-08 實測)。
  #    ⇒ 📌 **一格守住兩個 bug 的一半, 而它印的綠與守住兩個長得一樣。**
  mkdir -p "$_TD/noisypy"
  printf '%s\n' "#!/bin/sh
echo \"WARN: selftest noisy python3 shim\" >&2
exec $(command -v python3) \"\$@\"" > "$_TD/noisypy/python3"
  chmod +x "$_TD/noisypy/python3"
  cp "$_TD/record/psql" "$_TD/noisypy/psql"

  # B2 那格要「psql 在【而】python3 不在」⇒ 它需要一支存在的 psql。放 veto 版:
  # 它在 `command -v python3` 那行就離場、不會被執行 —— 而萬一被執行了, 它會叫。
  cp "$_TD/veto/psql" "$_TD/onlypsql/psql"

  EXPECT_TOTAL=8
  _pass=0
  _fail=0
  _WANT_RCS=

  _probe() {
    # 🔴 第 4 參 = **這一格宣告它要哪一支 shim**(`-1a` 2026-09-08 裁 F1 甲時要求:每格自己宣告、預設不在 PATH 上)
    #    veto   = 我不該走到連線那一步(絕大多數格)
    #    record = 我【要】走到, 而且要驗參數 —— 守「到達連線之前那一段」那一格用
    local name="$1" want_rc="$2" want_str="$3" shim="$4"
    shift 4
    _WANT_RCS="${_WANT_RCS}${_WANT_RCS:+ · }${name%% *}=rc${want_rc}"
    # 🔴 `local out; out=$(…); rc=$?` 拆三段 —— `local out=$(…)` 會【吞掉】rc。
    local out rc ok_rc ok_str shimdir
    case "$shim" in
      veto)   shimdir="$_TD/veto" ;;
      record) shimdir="$_TD/record" ;;
      noisypy) shimdir="$_TD/noisypy" ;;
      *) echo "  🔴 量具失效:$name 宣告了不認得的 shim「$shim」"; _fail=$((_fail + 1)); return ;;
    esac
    : > "$_CROSSED"
    : > "$_REACHED"
    out="$(PATH="$shimdir:$PATH" "$@" 2>&1)"
    rc=$?
    ok_rc=0
    ok_str=0
    [ "$rc" = "$want_rc" ] && ok_rc=1
    case "$out" in *"${want_str}"*) ok_str=1 ;; esac
    # 🔴🔴 **越線一票否決 —— 這一段沒有的話 guard 完全沒有咬合力**(R2 must-fix)。
    #    ⛔ ~~第一版檢查 `$out`, 而我把它沒生效歸因成「訊號到不了 $out」~~ —— **那個因果是錯的**
    #       (R3 抓到, 我複驗:真因是當時腳本正壞著、那格根本走不到連線那一步)。
    #    ✅ 檔案版留著, 而理由是:`$out` 版**依賴** `echo "$EXIST" | head -3 >&2` 那行
    #       剛好把話吐回來 —— **巧合不是機制**。而 R1 那條 nit 講的病仍然成立:
    #    ⇒ 📌 一格「真的叫到 psql 而 rc 與字面【仍然相符】」的越線 = **完全靜音**
    #       (R2 實測造了這樣一格 ⇒ 6/6 全綠、rc=0、「SELFTEST 越線」出現 **0** 次)。
    #    ⇒ 🎯 **紅線的訊號活不活, 不看 guard 印了什麼, 看有沒有人在讀它。**
    if [ -s "$_CROSSED" ]; then
      : > "$_CROSSED"
      _fail=$((_fail + 1))
      echo "  🔴🔴 $name — **越線**:這一格真的叫到了 psql。紅線是【絕不連正式庫】⇒ 一票否決。"
      return
    fi
    if [ "$ok_rc" = 1 ] && [ "$ok_str" = 1 ]; then
      _pass=$((_pass + 1))
      echo "  ✅ $name — rc=$rc 且字面命中"
    else
      _fail=$((_fail + 1))
      echo "  ❌ $name"
      echo "     rc:期望 $want_rc 實得 $rc"
      # 🔴🔴 **一定要 `${want_str}` 不可以寫 `$want_str」`**(code-reviewer R2 must-fix):
      #    UTF-8 locale 下 bash 3.2 把 `」` 的**首位元組**吃進變數名(`want_str\xe3`)
      #    ⇒ `set -u` 讓 shell **當場離場** ⇒ 後面的格子不跑、結算那一行不印、
      #       `EXPECT_TOTAL` 那道量具失效閘**也不跑**。
      #    🎯 而我的六發突變是在 `LANG` 未設(= C)跑的 ⇒ **整族看不到。**
      echo "     字面:期望「${want_str}」$([ "$ok_str" = 1 ] && echo '命中' || echo '**沒命中**')"
      echo "     實得前二行:$(printf '%s' "$out" | head -2 | tr '\n' '|')"
    fi
  }

  echo "check-anon-grants-prod.sh --selftest"
  echo "── A 層:參數與 env(零 DB)──"
  _probe "A1 收到不該有的參數 ⇒ rc=2「用法錯」" 2 "本腳本不收參數" veto \
    env PGURL=dummy /bin/bash "$SELF" some-arg
  _probe "A2 沒有 PGURL ⇒ rc=2「印用法」" 2 "用法: read -rs PGURL" veto \
    env -u PGURL /bin/bash "$SELF"
  echo "── B 層:工具(零 DB)──"
  _probe "B1 psql 不在 ⇒ rc=1" 1 "找不到 psql" veto \
    env PATH="$_TD/empty" PGURL=dummy /bin/bash "$SELF"
  _probe "B2 psql 在【而】python3 不在 ⇒ rc=1" 1 "找不到 python3" veto \
    env PATH="$_TD/onlypsql" PGURL=dummy /bin/bash "$SELF"
  # 🔬 B3 這一格在 2026-09-08 之前【寫不出來】—— 那條路名存實亡:
  #    舊寫法 `eval "$(python3 …)" || {…}` 裡 python 拋錯 ⇒ stdout 空 ⇒ `eval ""` rc=0 ⇒ `||` 不走。
  #    而它**碰巧仍然 rc=1**(後面 psql 沒有 PG* env 就連不上, 掉進另一個離場點)
  #    ⇒ 📌 對的 rc 配一個完全錯的理由, 而只看 rc 的檢查在這裡是綠的。
  _probe "B3 PGURL 解析失敗 ⇒ rc=1(2026-09-08 才真的存在)" 1 "PGURL 解析失敗" veto \
    env PGURL='postgres://h:notaport/db' /bin/bash "$SELF"

  echo "── C 層:【到達】連線那一步之前那一段(零 DB —— 錄音 shim 不開任何 socket)──"
  # 🔴🔴 **這一格是 R3 的 F1、`-1a` 裁甲補的** —— 它守的正是**今晚兩次自傷所在的那一段**
  #    (`exec 3>&2` + python 解析 + `eval`)。前五格**一格都沒走到那裡**
  #    ⇒ 兩次「整支腳本再也連不上任何庫」的改動, `--selftest` 都印 5/5 全綠。
  #    ✅ 它不只驗「有沒有走到」, 還驗**走到的時候參數對不對**(host/db/user 是解析出來的)。
  _probe "C1 解析成功 ⇒ 帶著對的 PG* 走到連線那一步" 1 "REACHED_PSQL host=127.0.0.1 db=selftestdb user=someuser" record \
    env PGURL='postgres://someuser:pw@127.0.0.1:5432/selftestdb' /bin/bash "$SELF"

  # 🔴🔴 **C2 守的是 C1 守不到的那一半**:`_PGENV` 下一行會被 `eval`
  #    ⇒ 若它把 python 的 **stderr** 收進來, stderr 就變成 shell code 被執行。
  #    🔬 而那個 bug **只在 python 真的印 stderr 時發作** ⇒ C1(正常 python3)對它是綠的。
  #    ✅ 判準:走到連線那一步(證明沒被 eval 弄壞), 而**輸出裡不得出現 `command not found`**。
  _probe "C2 python3 印 stderr ⇒ 不得被 eval 成 shell code" 1 "REACHED_PSQL host=127.0.0.1" noisypy \
    env PGURL='postgres://someuser:pw@127.0.0.1:5432/selftestdb' /bin/bash "$SELF"
  case "$(env PATH="$_TD/noisypy:$PATH" PGURL='postgres://someuser:pw@127.0.0.1:5432/selftestdb' /bin/bash "$SELF" 2>&1)" in
    *"command not found"*)
      _fail=$((_fail + 1))
      echo "  🔴🔴 C2 附加判準 — **stderr 被 eval 成 shell code 了**(輸出含 command not found)" ;;
    *) _pass=$((_pass + 1))
       echo "  ✅ C2 附加判準 — 輸出裡沒有 command not found" ;;
  esac

  echo ""
  # 🔴 ⛔ ~~原本無條件印「rc 0/6/7/8 那四條路一格都沒跑到」~~(R2 nit, 與上一條同族):
  #    **沒有任何東西在量它** ⇒ 未來有人補一格 rc=6 並把 EXPECT_TOTAL 改成 6, 這句照樣印而它變成假的。
  #    ✅ 改成**把每一格的期望 rc 印出來**, 讓「有沒有判準格」由【讀數】回答而不是由這句話。
  echo "🛑 **本 selftest 驗了哪些離場碼** —— 下面是每一格的期望 rc(判準層是 0 / 6 / 7 / 8):"
  echo "   $_WANT_RCS"
  # 🔴 ⛔ ~~「它【證】的是…」~~ —— 那是**結果宣稱**, 而它原本【無條件印】:
  #    code-reviewer 實測 M1 突變 ⇒ 第 3 行是 `❌ A1` 而它第 14 行照樣印;
  #    `rc=2 量具失效`(只跑 4 格)也照樣印。撞 CLAUDE.md「結果標籤要由【結果】決定」。
  #    ✅ 改成「它【要】證的是」(範圍聲明, 恆真)+ 真正的結果由下面的結算行印。
  echo "   它【要】證的是:參數解析與工具檢查那 5 條路會照預期離場(rc 與訊息【兩個都對】)——"
  echo "   而**做到了沒有, 看最後那一行的通過/失敗數**, 不看這一句。"
  echo "   ⇒ 它【不】證明這支腳本判得對不對。要那個得起一台有表有 GRANT 的 PG"
  # 🔴 這一行原本寫 `-1a`(反引號)⇒ **被 shell 當成命令替換執行掉了**,
  #    印出 `-1a: command not found` 而【句子照樣讀得通】。CLAUDE.md 逐字有這條。
  echo "     (plan §4 乙案, 主視窗 -1a 已裁把它開成獨立一列)。"
  echo "   📌 這句寫在【輸出】不是註解 —— 盤點的尺看的是輸出;"
  echo "      而一個只驗參數的 selftest, 會讓下次盤點以為它的判準也被守著。"
  echo ""
  _ran=$((_pass + _fail))
  if [ "$_ran" != "$EXPECT_TOTAL" ]; then
    # 🔴 ⛔ ~~「實際【只】跑了 N 格」~~ —— 那句**預設了方向**, 而它會多跑
    #    (2026-09-08 實測:C2 的附加判準只在失敗時計數 ⇒ 通過 7 格、失敗 8 格
    #     ⇒ 印出「期望 7 格, 實際只跑了 8 格」而那句字面就是錯的)。
    #    ✅ 現在兩邊都計數, 而這句也改成不預設方向。
    echo "🔴 量具失效:期望跑 $EXPECT_TOTAL 格, 實際跑了 $_ran 格(不相等)⇒ 這一發不算數。"
    echo "   ⚠️ 而**這不代表沒有格子抓到東西** —— 上面每一格印的結果仍然要讀;"
    echo "      量具失效說的是【這一發的總計不算數】, 不是【上面全是雜訊】。"
    exit 2
  fi
  echo "格數 $_ran/$EXPECT_TOTAL · 通過 $_pass · 失敗 $_fail"
  [ "$_fail" = 0 ] || exit 1
  exit 0
fi

if [ -n "${1:-}" ]; then
  echo "🔴 用法錯:本腳本不收參數。連線字串請走 PGURL env(read -rs PGURL && export PGURL)。" >&2
  exit 2
fi
if [ -z "${PGURL:-}" ]; then
  echo "用法: read -rs PGURL && export PGURL && bash scripts/check-anon-grants-prod.sh && unset PGURL" >&2
  exit 2
fi
command -v psql > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 psql —— 這不是查詢結果" >&2; exit 1; }
command -v python3 > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 python3 —— 這不是查詢結果" >&2; exit 1; }

# 連線字串拆成 PG* env,psql 的 argv 因此不含任何 secret。
# 🔴🔴 **2026-09-08 修:那個 `||` 從來不會觸發**(⛔ ~~`eval "$(python3 …)" || {…}`~~)。
#    成因:python 拋錯 ⇒ stdout 空 ⇒ `eval ""` 的 **rc 是 0** ⇒ `||` 不走。
#    🔬 實測 `PGURL='postgres://h:notaport/db'` ⇒ 印的是「psql 沒跑起來或連不上」
#       **加上整段 Python traceback**,而不是檔頭承諾的「PGURL 解析失敗」。
#    ⇒ 📌 **rc 碰巧仍是 1**(後面 psql 沒有 PG* env 就連不上, 掉進另一個離場點)
#       ⇒ **一個只看 rc 的檢查在這裡零判別力** —— 對的 rc 配一個完全錯的理由。
#    ✅ 改成先把輸出收進變數:`$(…)` 的 rc **就是** python 的 rc ⇒ `||` 真的會走;
#       stderr 走 `2>&3` + `3>&2` ⇒ **到終端, 不進變數**。
#    🔴 ⛔ ~~第二版寫 `2>/dev/null`~~ —— 那擋掉了 eval 汙染, 而它**把診斷一起丟掉**
#       (R2 nit):python3 在而壞掉(缺 stdlib / wrapper 失敗)⇒ 使用者只看到
#       「PGURL 解析失敗」**零線索, 而那個指名的原因是錯的**。
#    🔴🔴 **這裡【不可以】寫 `2>&1`**(code-reviewer 2026-09-08 R1 must-fix, 我第一版就是那樣寫的):
#       `_PGENV` 下一行會被 `eval` ⇒ **stderr 會變成 shell code 被執行**。
#       🔬 他實測:python3 印一行 stderr 而 PGURL 合法(走成功路)⇒ `line 167: WARN:: command not found`。
#       ⇒ 📌 舊寫法反而沒這個病(traceback 直接噴 terminal, 不進變數)
#          ⇒ **我修一個 bug 的同時造了一個更糟的**, 而 selftest 五格【全綠】——
#          那五格一格都沒有走成功路, 所以看不到它。
# 🔴 fd 3 一定要在命令替換【之前】用 exec 開 —— 寫成 `X=$(… 2>&3) 3>&2` 是**壞的**:
#    那個 `3>&2` 不會套進命令替換內部 ⇒ `Bad file descriptor` ⇒ 解析【永遠】失敗
#    ⇒ 🔴 **整支腳本再也連不上任何庫**, 而 `--selftest` 五格**全綠看不到**
#       (那五格一格都沒走成功路)。2026-09-08 我自己踩的, 這是同一夜第二次
#       「修一個東西的同時弄壞它, 而守門全綠」。
exec 3>&2
_PGENV=$(python3 - <<'PY' 2>&3
import os, shlex, urllib.parse as u
p = u.urlparse(os.environ['PGURL'])
q = dict(u.parse_qsl(p.query))
env = {
    'PGHOST': p.hostname or '',
    'PGPORT': str(p.port or 5432),
    'PGUSER': u.unquote(p.username or ''),
    'PGPASSWORD': u.unquote(p.password or ''),
    'PGDATABASE': (p.path or '/postgres').lstrip('/') or 'postgres',
    'PGSSLMODE': q.get('sslmode', 'require'),
}
for k, v in env.items():
    print('export %s=%s' % (k, shlex.quote(v)))
PY
) || { echo "🔴 工具問題:PGURL 解析失敗 —— 這不是查詢結果(上面那段是 python3 的原話)" >&2; exit 1; }
exec 3>&-
eval "$_PGENV"
unset _PGENV

run() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# ── 0. 對照組:先證明這把尺量得到東西(該綠的一發綠、該紅的一發紅)────────────
CALIB_YES="${CALIB_YES:-public.legal_terms_versions}"   # anon【應該】讀得到的表
CALIB_NO="${CALIB_NO:-public.admin_audit_log}"          # anon【不該】有任何權限的表

# 0-a. 校準表在不在(🔴 表不存在時,權限查詢也回 0 ⇒ 不先問這一句就分不出「鎖好了」與「不在」)
EXIST=$(run "select coalesce(to_regclass('$CALIB_YES')::text,'-') || '|' ||
                    coalesce(to_regclass('$CALIB_NO')::text,'-');")
case "$EXIST" in
  *'|'*) : ;;
  *) echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果" >&2
     echo "$EXIST" | head -3 >&2; exit 1;;
esac
YES_T="${EXIST%%|*}"; NO_T="${EXIST##*|}"
echo "── 對照組(先驗量具,不是結論)──────────────────"
echo "  校準表:$CALIB_YES ⇒ $YES_T / $CALIB_NO ⇒ $NO_T"
if [ "$YES_T" = '-' ] || [ "$NO_T" = '-' ]; then
  echo "🔴 這個庫【沒有】本腳本預設的校準表 ⇒ 你很可能在跑報價單庫,而預設校準是網站庫專用的。" >&2
  echo "   ⇒ 這【不是】查詢結果,也【不是】權限已收乾淨。" >&2
  echo "   ⇒ 指定那個庫自己的兩張表再跑:" >&2
  echo "     CALIB_YES=public.<anon 應該讀得到的表> CALIB_NO=public.<anon 不該有權限的表> \\" >&2
  echo "       bash scripts/check-anon-grants-prod.sh" >&2
  exit 6
fi

# 0-b. 量具自證:這個庫裡 anon 到底有沒有【任何】表權限(與校準表無關,證明查詢看得見 grant)
#
# 🔴🔴 **2026-09-08 `tidy` 訂正:對照組改走 `pg_class.relacl`,不再走 `information_schema`。**
#    ⛔ ~~三發都 `from information_schema.role_table_grants`~~ —— **舊字面留著,因為它讀起來很正常。**
#    🎯 **成因就寫在本檔 `:45-48`**:`information_schema` 依【連線角色】過濾,`pg_catalog` 不會
#       ⇒ 第 ④ 段【早就改走 `relacl`】了,而**對照組還留在它已經放棄的那條路上**。
#    📌 ⇒ **一道對照組,用了它要對照的那個東西【已經不再走】的路** ⇒ 它校準的是一把沒有人在用的尺。
#    🔬 **實測(`pcm_readonly` @ 正式庫,2026-09-08)—— 兩條路同一時刻**:
#         information_schema ⇒ anon_any **0** · 該有的 **0** · 該沒有的 **0**   ← 全 0,尺瞎了
#         pg_class.relacl    ⇒ anon_any **43** · 該有的 **1** · 該沒有的 **0**  ← 雙向都表演得出來
#       ⇒ 🛑 **舊版在唯讀角色下必定 `exit 1`「量具證不出來」** —— 而那句話是對的,
#          **它擋掉的卻是一個本來量得出來的量測**。⇒ 這支腳本因此**只有管理員跑得動**,而它不必是。
#    ⚠️ **射程**:本次只在【網站庫 + `pcm_readonly`】量過。別的庫 / 別的角色沒量。
ANY=$(run "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace,
             lateral aclexplode(c.relacl) a
           where a.grantee::regrole::text='anon';")
POS=$(run "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace,
             lateral aclexplode(c.relacl) a
           where a.grantee::regrole::text='anon'
             and n.nspname=split_part('$CALIB_YES','.',1)
             and c.relname=split_part('$CALIB_YES','.',2);")
NEG=$(run "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace,
             lateral aclexplode(c.relacl) a
           where a.grantee::regrole::text='anon'
             and n.nspname=split_part('$CALIB_NO','.',1)
             and c.relname=split_part('$CALIB_NO','.',2);")
case "$ANY$POS$NEG" in
  *[!0-9]*) echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果" >&2
            echo "$POS" | head -3 >&2; exit 1;;
esac
echo "  量具自證:本庫 anon 的表權限總筆數 ⇒ $ANY(=0 表示這把尺沒看到過任何 grant)"
echo "  該有的:$CALIB_YES × anon ⇒ 期待 >0,實得 $POS"
echo "  該沒有的:$CALIB_NO × anon ⇒ 期待 =0,實得 $NEG"
if [ "$ANY" -eq 0 ]; then
  echo "🔴 這把尺在本庫【一筆 grant 都沒看到】⇒ 量具證不出來(可能連錯庫 / 權限不足)。" >&2
  echo "   ⇒ 這【不是】「權限已經收乾淨了」。" >&2
  exit 1
fi
if [ "$POS" -eq 0 ] || [ "$NEG" -ne 0 ]; then
  echo "🔴 量具是好的(它看得到 $ANY 筆 grant),而**校準表的權限現值不符預期** ⇒ 這是一個【發現】:" >&2
  [ "$POS" -eq 0 ] && echo "   · $CALIB_YES 對 anon 沒有任何權限 —— 預期它有 SELECT(前台要讀)⇒ 少了一條 GRANT 或連錯庫" >&2
  [ "$NEG" -ne 0 ] && echo "   · 🔴🔴 $CALIB_NO 對 anon 有 $NEG 筆權限 —— 那張表應該對 client 全鎖,這是嚴重偏移" >&2
  echo "   ⇒ 先把這一條查清楚再看下面的數字;本次不繼續報數(rc=7)。" >&2
  exit 7
fi
echo "  ✅ 兩發都表演得出來 ⇒ 下面的數字可以讀。"
echo

# ── 1. E683:新表出生會不會自帶 anon/authenticated 權限 ────────────────────
echo "── ③ E683:預設授權(決定【以後】新建的表出生帶什麼)──────────"
echo "  pg_default_acl 現值(空 = 沒有人動過預設;有 anon=... = 新表會自帶):"
run "select coalesce(nsp.nspname,'(所有 schema)') as schema, d.defaclobjtype as objtype,
            pg_catalog.array_to_string(d.defaclacl, E'\n            ') as acl
       from pg_default_acl d left join pg_namespace nsp on nsp.oid = d.defaclnamespace
      order by 1,2;" | sed 's/^/    /'
echo "  🔴 判讀:acl 裡出現 anon= 或 authenticated= ⇒ 【還沒補齊】(新表出生自帶,含 TRUNCATE=D)"
echo "         acl 裡沒有它們 ⇒ 已補齊。空輸出 ⇒ 見 plan §2b,空不等於安全,要配 §1 的斷言一起看"
echo "  📄 docs/specs/2026-08-17-e683-default-privileges-plan.md"
echo

# ── 2. E686:net 兩表的表級 + 欄級權限 ──────────────────────────────────────
echo "── ④ E686:net 兩表對 anon / authenticated 的實際權限 ───────────"
echo "  (0) 🔴 先問【表在不在】—— 表不存在時,下面每一格都會印空,而空會被讀成「已收乾淨」:"
run "select 'net.'||t||' ⇒ '||coalesce(to_regclass('net.'||t)::text,'🔴 不存在(下面的空不算數)')||
            coalesce(' / relacl='||(select case when c.relacl is null then 'NULL(零顯式授權)'
                                              else '有值('||array_length(c.relacl,1)||' 筆)' end
                                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                    where n.nspname='net' and c.relname=t), '')
       from unnest(array['_http_response','http_request_queue']) t;" | sed 's/^/    /'
echo "      🔴 relacl=NULL 對【表】而言 = 零顯式授權 ⇒ anon 真的沒有權限(2026-08-18 實測:"
echo "         relacl NULL 的表 has_table_privilege('anon',…,'TRUNCATE') ⇒ false;"
echo "         而在 anon 預設授權下出生的表,relacl 會被【寫實】成 anon=arwdDxtm ⇒ 下面 (a) 撈得到)"
echo "      ⚠️ 這條【只對表成立】。函式的 proacl 是 NULL 時 PUBLIC 反而【有】EXECUTE ——"
echo "         本腳本不查函式,要查請看 docs/patterns/revoking-function-execute-in-supabase.md" 
NET_N=$(run "select count(*) from unnest(array['_http_response','http_request_queue']) t
             where to_regclass('net.'||t) is not null;")
case "$NET_N" in *[!0-9]*) NET_N=-1;; esac
echo "  (a) 🔴 表級 —— 走 pg_class.relacl(pg_catalog,**不受可見性過濾**):"
# 🔴🔴 **2026-09-08 訂正(⟦tidy-ANONGRANTSFALSEGREEN⟧):舊版漏掉整個 PUBLIC 族**
#    ⛔ ~~where … and a.grantee::regrole::text in ('anon','authenticated')~~
#    成因:`GRANT … TO PUBLIC` 在 aclexplode 裡的 `grantee` 是 **0**,而 `0::regrole::text` 印 `'-'`
#         ⇒ **不 match 任何角色名 ⇒ 整族安靜地不算**。
#    🔴 而那不是理論:2026-09-08 唯讀實量,`net` 兩表的 relacl 各含一筆
#       `=arwdDxtm/supabase_admin`(grantee 為空 = PUBLIC)⇒ **舊版對它印【空】**,
#       而本段下面的判讀逐字寫著「全空 ⇒ 已收乾淨」。
#    🛑 **具名的受害者**:Sean 2026-08-23 親跑過這支腳本, 拿到的就是那個假綠。
#    📌 形狀:**用【誰被具名授權】這把尺去問【誰讀得到】** —— 兩個受詞,
#       而它們在正常的庫裡幾乎總是一致, 所以那個空看起來完全正常。
run "select c.relname||' × '||(case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace,
            lateral aclexplode(c.relacl) a
      where n.nspname='net' and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated'))
      group by c.relname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (b) 欄級 —— 走 pg_attribute.attacl(同上;🔴 has_table_privilege 看不到這一層):"
# 🔴 同一個訂正(欄級那半):PUBLIC 的 grantee 也是 0。
run "select c.relname||'.'||at.attname||' × '||(case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped,
            lateral aclexplode(at.attacl) a
      where n.nspname='net' and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated'))
      group by c.relname, at.attname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (a2) 對照:同一件事走 information_schema(🔴 **它會依連線角色過濾**,兩者不一致以 (a) 為準):"
run "select table_name||' × '||grantee||' ⇒ '||string_agg(privilege_type, ',' order by privilege_type)
       from information_schema.role_table_grants
      where table_schema='net' and grantee in ('anon','authenticated')
      group by table_name, grantee order by 1;" | sed 's/^/    /'
echo "  (c) RLS 開了沒:"
run "select c.relname||' ⇒ rls='||c.relrowsecurity||' / policies='||
            (select count(*) from pg_policy p where p.polrelid=c.oid)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='net' and c.relkind='r' order by 1;" | sed 's/^/    /'
echo "  (d) 🔴 有效權限 —— has_table_privilege(它把【角色繼承】算進去):"
# 🔴🔴 **2026-09-08 新增(⟦tidy-ANONGRANTSFALSEGREEN⟧;來源 codex R3 審 20260908030000 那片)**
#    (a)(b) 走的是【誰被授權】(aclexplode 的 grantee)。而權限可以**授給一個群組角色,
#    由 anon INHERIT 取得** ⇒ 那種情況下 grantee 是那個群組, 不是 anon / PUBLIC
#    ⇒ **(a)(b) 兩把尺整族看不到, 而 anon 真的讀得到。**
#    ✅ has_table_privilege 問的是【有效權限】⇒ 補得起這個洞。
#    🛑 **而它看不到欄級**(見 (b) 那格的註解)⇒ 兩把尺**各補對方的一部分**盲區, 不可以只留一把。
#    🔴🔴 **而它們【沒有】互補完**(2026-09-08 codex 指出, 我原本寫「各補對方的盲區」= 太強):
#       **群組角色持有【欄級】SELECT/UPDATE 而 anon 經繼承取得** ⇒
#       (b) 濾掉群組看不到、(d) 只問表級也看不到 ⇒ **兩把一起漏報。**
#    ⇒ 下面 (e) 補那一格(`has_column_privilege`), 而**它仍然只涵蓋我列舉的那幾個欄位語意**。
D_OUT=$(run "select t||' × '||r||' ⇒ '||
            (case when has_table_privilege(r,'net.'||t,'SELECT')   then 'S' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'INSERT')   then 'I' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'UPDATE')   then 'U' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'DELETE')   then 'D' else '-' end)||
            (case when has_table_privilege(r,'net.'||t,'TRUNCATE') then 'T' else '-' end)
       from unnest(array['_http_response','http_request_queue']) t
       cross join unnest(array['anon','authenticated']) r
      where to_regclass('net.'||t) is not null order by 1;")
# 🔴 2026-09-08 codex:新查詢失敗【會被包成成功】—— run 的輸出接進 sed 之後 rc 就沒了。
#    唯一安全形狀:先收進變數, 立刻取 rc, 中間不准有任何東西。
D_RC=$?
printf '%s\n' "$D_OUT" | sed 's/^/    /'
if [ "$D_RC" -ne 0 ]; then
  echo "🔴 (d) 那一發【沒有跑成功】(rc=$D_RC)⇒ 上面那幾行不是查詢結果, 不要讀成「沒有權限」。" >&2
  exit 1
fi
echo "      🔴 任何一格不是全 '-----' ⇒ 那個角色【真的讀/寫得到】, 不管它是怎麼拿到的。"
echo "      🔵 而 schema USAGE 是另一道門:表權限為 t 而 schema USAGE 為 f ⇒ 那個 t 到不了。"
run "select 'net schema USAGE × '||r||' ⇒ '||has_schema_privilege(r,'net','USAGE')::text
       from unnest(array['anon','authenticated']) r order by 1;" | sed 's/^/    /'
echo "  (e) 🔴 欄級【有效】權限 —— has_column_privilege(補 (b) 與 (d) 一起漏的那一格):"
# 🔴 2026-09-08 加(codex 指出 (b)+(d) 沒有互補完):群組持有欄級權限而 anon 繼承 ⇒ 兩把都看不到。
E_OUT=$(run "select c.relname||'.'||at.attname||' × '||r||' ⇒ '||
            (case when has_column_privilege(r, c.oid, at.attnum, 'SELECT') then 'S' else '-' end)||
            (case when has_column_privilege(r, c.oid, at.attnum, 'INSERT') then 'I' else '-' end)||
            (case when has_column_privilege(r, c.oid, at.attnum, 'UPDATE') then 'U' else '-' end)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped
       cross join unnest(array['anon','authenticated']) r
      where n.nspname='net' and c.relkind='r'
        and (has_column_privilege(r, c.oid, at.attnum, 'SELECT')
          or has_column_privilege(r, c.oid, at.attnum, 'INSERT')
          or has_column_privilege(r, c.oid, at.attnum, 'UPDATE'))
      order by 1;")
E_RC=$?
printf '%s\n' "$E_OUT" | sed 's/^/    /'
if [ "$E_RC" -ne 0 ]; then
  echo "🔴 (e) 那一發【沒有跑成功】(rc=$E_RC)⇒ 上面那幾行不是查詢結果, 不要讀成「沒有欄級權限」。" >&2
  exit 1
fi
echo "      🛑 這一格【零列】不等於安全:它只涵蓋 SELECT / INSERT / UPDATE 三個欄級語意。"
echo "      ⚠️ 而表級有權時, has_column_privilege 對每一欄都回 t ⇒ 它會【跟著 (d) 一起亮】, 那是預期的。"
echo "  🔴 判讀 —— 2026-09-08 重寫(codex 指出舊版三句在新版底下都不成立):"
echo "     ⛔ 舊句一 ~~(a)(b) 任一有 DELETE/TRUNCATE/UPDATE/INSERT ⇒ 還沒補齊~~"
echo "     ⛔ 舊句二 ~~全空 ⇒ 已收乾淨~~ —— 對 (d)(e) 恆假:無權限時它們印的是 '-----',"
echo "        而那是一列有內容的輸出。要問的是【那一列是不是全 '-'】, 不是【有沒有列】。"
echo "     ⛔ 舊句三 ~~(a) 與 (a2) 的列一致~~ —— (a2) 走 information_schema 而它不含 PUBLIC,"
echo "        所以新版 (a) 多出的 PUBLIC 幾列是預期差異;要問的是【具名角色那幾列有沒有少】。"
echo "     ✅ 新判準, 三格分開問:"
echo "        · (a)(b) 要問:ACL 上有沒有任何一列?零列才是 ACL 乾淨。"
echo "        · (d)(e) 要問:有沒有任何一格不是全 '-'?(含角色繼承)"
echo "        · (a2)   只當可見性對照:它比 (a) 少 PUBLIC 是預期的;少掉具名角色那幾列才是問題。"
echo "     🛑 (d)(e) 為真要不要讀成【它讀得到資料】? 要先看上面 (c) 那一格的 RLS:"
echo "        表級 SELECT 與 schema USAGE 都為 t, 而 RLS 開著且沒有適用 policy ⇒ 仍讀不到列。"
echo "        而 TRUNCATE 那一格要單獨問 —— RLS 管不到 TRUNCATE(見 docs/patterns/"
echo "        revoking-function-execute-in-supabase.md)⇒ 它為 t 時 RLS 幫不上忙。"
echo "        ⇒ 要下「anon 真的讀得到」這個結論, (d) 與 (c) 兩格要一起看。"
echo "     ⚠️ 而三格都乾淨也只涵蓋【DB 層】—— 外面叫不叫得到是 PostgREST 有沒有暴露 net,"
echo "        那一格本腳本問不到(⟦tidy-NETPUBLICALL⟧ 那一列記著:四種問法皆拿不到)。"
echo "  📄 docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md"
echo
echo "🔴 本次結果只代表【這個庫、這一刻】。報價單庫要跑 ⇒ 先用 CALIB_YES / CALIB_NO 給它自己的校準表(見檔頭)。"

# ── 5. 🔴 net 兩表都不存在 ⇒ 第 ④ 段【不適用】,不是【乾淨】────────────────────
#    沒有這一段的話:輸出是「④ 全空 + rc=0」,而那正是會被讀成「已收乾淨」的形狀
#    （2026-08-18 G4 自查:同 GR-004 那個「零是濾網壞掉印出來的」家族）
if [ "$NET_N" = "0" ]; then
  echo "🔴 這個庫【沒有 net 那兩張表】(可能沒裝 pg_net)⇒ 第 ④ 段是【不適用】,不是【已收乾淨】。" >&2
  echo "   ⇒ 第 ③ 段(E683 預設授權)的結果仍然有效。" >&2
  exit 8
fi
