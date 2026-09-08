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
  mkdir -p "$_TD/empty" "$_TD/onlypsql" "$_TD/guard"
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
  _GUARD_PSQL="#!/bin/sh
echo \"🔴🔴 SELFTEST 越線:它叫了 psql。紅線是【絕不連正式庫】,這一發不算數。\" >&2
echo crossed >> \"$_CROSSED\"
exit 97"
  printf '%s\n' "$_GUARD_PSQL" > "$_TD/guard/psql"
  chmod +x "$_TD/guard/psql"
  # B2 那格要「psql 在【而】python3 不在」⇒ 它需要一支存在的 psql。
  # 用同一支 guard:它在 `:command -v python3` 那行就離場, 從頭到尾不會被執行
  # (reviewer 逐路徑追過)—— 而萬一有一天被執行了, 它會叫。
  cp "$_TD/guard/psql" "$_TD/onlypsql/psql"

  EXPECT_TOTAL=5
  _pass=0
  _fail=0
  _WANT_RCS=

  _probe() {
    local name="$1" want_rc="$2" want_str="$3"
    shift 3
    _WANT_RCS="${_WANT_RCS}${_WANT_RCS:+ · }${name%% *}=rc${want_rc}"
    # 🔴 `local out; out=$(…); rc=$?` 拆三段 —— `local out=$(…)` 會【吞掉】rc。
    local out rc ok_rc ok_str
    # 🔴 guard 前置給【沒有自己覆蓋 PATH】的那幾格(A1 / A2 / B3)——
    #    自己帶 `env PATH=…` 的格子(B1 / B2)會蓋掉它, 而它們的目錄裡本來就沒有真 psql。
    : > "$_CROSSED"
    out="$(PATH="$_TD/guard:$PATH" "$@" 2>&1)"
    rc=$?
    ok_rc=0
    ok_str=0
    [ "$rc" = "$want_rc" ] && ok_rc=1
    case "$out" in *"${want_str}"*) ok_str=1 ;; esac
    # 🔴🔴 **越線一票否決 —— 這一段沒有的話 guard 完全沒有咬合力**(R2 must-fix)。
    #    ⛔ ~~第一版檢查 `$out` 裡有沒有那句話~~ —— **那個訊號到不了 `$out`**(見 guard 那段註解);
    #    ✅ 改讀 guard 寫的**檔案**。而 R1 那條 nit 講的病仍然成立:
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
  _probe "A1 收到不該有的參數 ⇒ rc=2「用法錯」" 2 "本腳本不收參數" \
    env PGURL=dummy /bin/bash "$SELF" some-arg
  _probe "A2 沒有 PGURL ⇒ rc=2「印用法」" 2 "用法: read -rs PGURL" \
    env -u PGURL /bin/bash "$SELF"
  echo "── B 層:工具(零 DB)──"
  _probe "B1 psql 不在 ⇒ rc=1" 1 "找不到 psql" \
    env PATH="$_TD/empty" PGURL=dummy /bin/bash "$SELF"
  _probe "B2 psql 在【而】python3 不在 ⇒ rc=1" 1 "找不到 python3" \
    env PATH="$_TD/onlypsql" PGURL=dummy /bin/bash "$SELF"
  # 🔬 B3 這一格在 2026-09-08 之前【寫不出來】—— 那條路名存實亡:
  #    舊寫法 `eval "$(python3 …)" || {…}` 裡 python 拋錯 ⇒ stdout 空 ⇒ `eval ""` rc=0 ⇒ `||` 不走。
  #    而它**碰巧仍然 rc=1**(後面 psql 沒有 PG* env 就連不上, 掉進另一個離場點)
  #    ⇒ 📌 對的 rc 配一個完全錯的理由, 而只看 rc 的檢查在這裡是綠的。
  _probe "B3 PGURL 解析失敗 ⇒ rc=1(2026-09-08 才真的存在)" 1 "PGURL 解析失敗" \
    env PGURL='postgres://h:notaport/db' /bin/bash "$SELF"

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
    echo "🔴 量具失效:期望跑 $EXPECT_TOTAL 格, 實際只跑了 $_ran 格 ⇒ 這一發不算數。"
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
ANY=$(run "select count(*) from information_schema.role_table_grants where grantee='anon';")
POS=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema=split_part('$CALIB_YES','.',1)
             and table_name=split_part('$CALIB_YES','.',2);")
NEG=$(run "select count(*) from information_schema.role_table_grants
           where grantee='anon' and table_schema=split_part('$CALIB_NO','.',1)
             and table_name=split_part('$CALIB_NO','.',2);")
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
run "select c.relname||' × '||a.grantee::regrole||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace,
            lateral aclexplode(c.relacl) a
      where n.nspname='net' and a.grantee::regrole::text in ('anon','authenticated')
      group by c.relname, a.grantee order by 1;" | sed 's/^/    /'
echo "  (b) 欄級 —— 走 pg_attribute.attacl(同上;🔴 has_table_privilege 看不到這一層):"
run "select c.relname||'.'||at.attname||' × '||a.grantee::regrole||' ⇒ '||string_agg(a.privilege_type,',' order by a.privilege_type)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute at on at.attrelid=c.oid and at.attnum>0 and not at.attisdropped,
            lateral aclexplode(at.attacl) a
      where n.nspname='net' and a.grantee::regrole::text in ('anon','authenticated')
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
echo "  🔴 判讀:(a)(b) 任一有 DELETE/TRUNCATE/UPDATE/INSERT ⇒ 【還沒補齊】"
echo "         全空 ⇒ 已收乾淨,**但要三個條件同時成立**:(0) 兩張表都存在、上面的對照組過了、"
echo "         且 (a) 與 (a2) 的【列】一致。🔴 (a2) 少了一整列 ⇒ 那是【可見性過濾】不是【權限被收掉】"
echo "         ⚠️ 已知的良性差異:(a) 會多一個 MAINTAIN(PG17 新權限,information_schema 不報)"
echo "            ⇒ 只差 MAINTAIN 這個字 = 正常;差【整列】才是可見性問題"
echo "         (2026-08-18 實測:非 owner 非 grantee 的角色查 information_schema 得 0,同時 relacl 看得到 7 項)"
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
