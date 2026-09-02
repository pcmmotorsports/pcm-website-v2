#!/usr/bin/env bash
# greenlight.sh — 三綠一鍵,每一道自己收 rc,而輸出【自帶分母】。
#
# 🔴 **為什麼是腳本不是規則**(來源:`~/pcm-mailbox/R3-提案-B線訊號設計修法-20260829.md` M1):
#    2026-08-29 一夜 13 件失效事件,約 11 件共用同一個形狀 ——
#    **每一個訊號送達時不帶它自己的分母,而讀的人預設分母 = 全部。**
#    而「收 rc」這條規矩當晚才立就已經要人記五步 ⇒ **腳本讓對的那條路變成最便宜的路。**
#    (規則採用率當晚實測 0/9,hook 4/4 —— `00-work-rules.md` §4 機制優先律。)
#
# 用法:
#   bash scripts/greenlight.sh            # 三綠(⇒ 最多只到 PARTIAL, **不會印 GREEN**)
#   bash scripts/greenlight.sh --tests    # 三綠 + vitest 全套(⇒ 這一條才印得出 GREEN)
#   bash scripts/greenlight.sh --selftest # 兩個世界 + 一發突變
#
# 🔴 **rc 四態**(2026-09-02 由三態擴成四態;**既有三個號碼一格都沒動**):
#     GREEN(0)   三綠過 **而且** 測試也過
#     RED(1)     有東西是紅的
#     ENV-FAIL(2) 工具自己跑不起來 ⇒ 不要查你的碼
#     PARTIAL(4) 三綠過, **而測試沒跑** ⇒ 🛑 **這不是綠**
#   🔵 為什麼新的那一態拿 4 不擠既有的:`latest-definition-of.sh:77` /
#      `md-table-overflow.py:886` / `migrations-replay-from-zero.sh:11` 三支的註解
#      逐字引這組三態當先例 ⇒ 改既有號碼會讓那三支的註解變成假的。
#
# 🔴 **它自己的分母**:輸出印【我跑了哪幾道、幾點、對哪個 HEAD】——
#    涵蓋欄印的是**實跑清單**不是宣稱。
#    ⇒ 一個防「訊號沒帶分母」的工具,自己的輸出若沒帶,它就是第 14 件。

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1

RUN_TESTS=0
[ "${1:-}" = "--tests" ] && RUN_TESTS=1

# ── 🔴 撞窗偵測:八窗共用一棵樹,`pnpm build` 的紅有兩種而它們的 rc 一樣 ──────────
#    2026-08-29 實測:`@pcm/admin:build: Suggestion: Wait for the build to complete.`
#    + `@pcm/storefront:build: exit code 130` ⇒ **那不是缺陷,是別的窗在 build。**
#    ⇒ 探法是機械的(`pgrep` + log 字面),不是憑感覺等。
is_collision() {  # is_collision <log 檔>
  grep -qE 'already running|Wait for the build to complete|exit code 130' "$1" 2>/dev/null
}

# ── 🔴🔴 2026-09-01:上面那個字面【不足以下結論】, 而它下的結論是【解除警戒】的那一種 ──────
#    實錘(`-a0` 當天撞到):一個真的 build 錯(`'use server'` 檔匯出了非 async 的東西)
#      ⇒ `@pcm/admin:build` rc=1
#      ⇒ **turbo 砍掉並行的 `@pcm/storefront:build` ⇒ 它印 `exit code 130`**
#      ⇒ `is_collision` 命中 ⇒ 本工具印「撞窗, 不是缺陷, 等一下重跑」
#    📌 **那個 130 是【我自己的錯造成的】, 不是別的窗。**
#
# 🛑 **而這個誤判的方向是最貴的那一種**:一個誤報只是吵;
#    **一句「這個紅可以忽略」會把真錯變成環境雜訊** —— 而當時五條線都在用這支工具。
#    ⚠️ 抓到它的是**本工具自己輸出裡的矛盾**(說撞窗、而它自己數到 0 個 build 在跑)
#    ⇒ 📌 **若它只印結論、不印那個數, 沒有人會去查。**
#
# ⇒ 改法:**那個字面只是【線索】, 要配上「現在真的有別的 build 在跑」才准下撞窗的結論。**
live_builds() {
  pgrep -fc 'next build' 2>/dev/null || printf '0'
}

# collision_verdict <log 檔> <現在有幾個 build 在跑> ⇒ 印 collision | real
#   🔵 拆成一支吃參數的函式, 是為了讓自檢演得到【數到 0】那個世界 ——
#      直接測 `is_collision` 只測得到那個字面, 測不到這個決定。
collision_verdict() {
  if is_collision "$1" && [ "${2:-0}" -gt 0 ]; then printf 'collision'; else printf 'real'; fi
}

# ── 🔴 `$?` 是每一個指令都會覆寫的全域變數 ⇒ 那一行前後不准有任何東西 ────────────
#    (2026-08-29 實測 40 種寫法:會蓋掉 40 / 不會 0。)
#    而 `local X=$(cmd)` 會【吞掉】rc ⇒ 必須拆兩行。
run_one() {  # run_one <名稱> <log 路徑> <指令…>
  local NAME="$1" LOG="$2"; shift 2
  local RC
  "$@" > "$LOG" 2>&1 ; RC=$?
  printf '%s' "$RC"
}

# ── --selftest:兩個世界 + 判定本身 ────────────────────────────────────────
#    🔴 沒有負對照,「它會抓」與「它恆綠」印同一個字。
if [ "${1:-}" = "--selftest" ]; then
  SRC=0
  printf '=== greenlight --selftest ===\n'

  # ① rc 收得到嗎(正對照:真的失敗)
  R="$(run_one probe /dev/null false)"
  if [ "$R" = "1" ]; then printf '  ✅ 正對照 rc:餵一個真的失敗 ⇒ 收到 rc=1\n'
  else printf '  🔴 正對照 rc:期望 1,實得 %s ⇒ 收不到 rc\n' "$R"; SRC=1; fi

  # ② 負對照:真的成功 ⇒ 必須 0
  R="$(run_one probe /dev/null true)"
  if [ "$R" = "0" ]; then printf '  ✅ 負對照 rc:餵一個成功 ⇒ 收到 rc=0\n'
  else printf '  🔴 負對照 rc:期望 0,實得 %s\n' "$R"; SRC=1; fi

  # ③ 撞窗偵測分得開嗎 —— 兩個 log,一個含撞窗字面一個不含
  TD="$(mktemp -d -t glself)"
  printf 'Suggestion: Wait for the build to complete.\n' > "$TD/hit.log"
  printf 'src/x.ts(1,1): error TS2322: nope\n'          > "$TD/miss.log"
  if is_collision "$TD/hit.log"; then printf '  ✅ 撞窗正對照:含「Wait for the build」⇒ 判為撞窗\n'
  else printf '  🔴 撞窗正對照沒被判出來\n'; SRC=1; fi
  if is_collision "$TD/miss.log"; then printf '  🔴 撞窗負對照:一個真的 TS error 被誤判成撞窗\n'; SRC=1
  else printf '  ✅ 撞窗負對照:真的 TS error ⇒ 不判成撞窗\n'; fi
  # 🔴 2026-09-01 補:上面兩格只驗【那個字面】, 驗不到【那個決定】。
  #    真正咬人的世界是:log 有撞窗字面(turbo 砍並行任務印的 130), 而現在【沒有】別的 build 在跑。
  printf '@pcm/storefront:build: ELIFECYCLE Command failed with exit code 130.\n' > "$TD/c130.log"
  if [ "$(collision_verdict "$TD/c130.log" 0)" = "real" ]; then
    printf '  ✅ 撞窗判定:有字面而【0 個 build 在跑】⇒ 判 real(不准說撞窗)\n'
  else printf '  🔴 撞窗判定:數到 0 還說撞窗 ⇒ 那句話會叫人忽略一個真錯\n'; SRC=1; fi
  # 🔵 負對照:數 > 0 時仍然要判得出撞窗(不要把功能改沒)
  if [ "$(collision_verdict "$TD/c130.log" 2)" = "collision" ]; then
    printf '  ✅ 撞窗判定負對照:有字面而【2 個 build 在跑】⇒ 仍判 collision\n'
  else printf '  🔴 撞窗判定負對照:功能被改沒了\n'; SRC=1; fi
  rm -rf "$TD"

  # ④ 🔴 突變:把判定的其中一半拿掉,結論必須改變
  #    (照 before-asking-sean.sh 的前例 —— 沒有這一發,自檢與恆綠印同一個字。)
  if [ "0" = "0" ] && [ "1" = "0" ]; then M=GREEN; else M=RED; fi
  if [ "$M" = "RED" ]; then printf '  ✅ 判定突變:任一道非 0 ⇒ 結論 RED(它不是恆綠)\n'
  else printf '  🔴 判定突變:有一道 rc=1 而結論仍是 GREEN\n'; SRC=1; fi

  # ⑤ 🔴 三態分得開嗎 —— 「工具壞了」不可以被印成「你的碼壞了」
  #    (2026-08-29 主視窗問「人分得出是它壞了還是碼壞了嗎」⇒ 當場演出來是【分不出】,才補的。)
  TD2="$(mktemp -d -t glenv)"
  PATH=/usr/bin:/bin GL_SELFTEST_CHILD=1 bash "$0" > "$TD2/env.log" 2>&1 ; R=$?
  if [ "$R" = "2" ] && grep -q 'ENV-FAIL' "$TD2/env.log"; then
    printf '  ✅ 三態:工具跑不起來 ⇒ rc=2 且印 ENV-FAIL(不是 RED)\n'
  else printf '  🔴 三態:工具跑不起來時 rc=%s ⇒ 它被讀成「碼壞了」\n' "$R"; SRC=1; fi
  # ⑤b 🔴🔴 **沒加 --tests 時, 那一行不准出現 GREEN** —— 而這一格是 2026-09-02 的事故補的。
  #    🛑 它【不能】只驗「有沒有印 PARTIAL」:一個同時印 PARTIAL 與 GREEN 的輸出會照樣過。
  #       ⇒ 所以兩件都要驗:**PARTIAL 在** 且 **GREEN 不在**。
  #    ⚠️ 而本格用的是【上面 ⑤ 那一發的 log】—— 那一發是 PATH 被剝掉的世界(ENV-FAIL),
  #       它答不了本格。⇒ 所以本格自己再跑一發, 用【正常的 PATH】。
  TD3="$(mktemp -d -t glpart)"
  GL_SELFTEST_CHILD=1 bash "$0" > "$TD3/part.log" 2>&1 ; RP=$?
  # 🔴 計數先落進變數再印 —— `$(grep -c … || printf 0)` 在【零命中】時會拼出 `00`,
  #    而 `grep -c` 印 0 的同時 rc=1 ⇒ 那一族在 CLAUDE.md 記過(「一個合法的零」)。
  #    ⇒ 而它只在【這一格紅的時候】才會印 ⇒ 那正是最不會被人看到它壞掉的位置。
  NP="$(grep -c 'PARTIAL' "$TD3/part.log" 2>/dev/null)" || NP=0
  NG="$(grep -c 'GREEN'   "$TD3/part.log" 2>/dev/null)" || NG=0
  if [ "$NP" -gt 0 ] && [ "$NG" -eq 0 ] && [ "$RP" = "4" ]; then
    printf '  ✅ 未加 --tests:印 PARTIAL、**沒有那個綠字**、rc=4\n'
  else
    printf '  🔴 未加 --tests:rc=%s(期望 4) · PARTIAL 出現 %s 次(期望 >0) · 那個綠字出現 %s 次(期望 0)\n' \
      "$RP" "$NP" "$NG"
    SRC=1
  fi
  rm -rf "$TD3"

  # ⑥ 🔴 非綠時 log 要留著 —— 它剛剛印了那個路徑
  if grep -q 'log 留著沒刪' "$TD2/env.log"; then
    LD="$(grep -o '📎 log 留著沒刪: .*' "$TD2/env.log" | sed 's/.*: //')"
    if [ -d "$LD" ]; then printf '  ✅ 證據:非綠時 log 目錄還在\n'; rm -rf "$LD"
    else printf '  🔴 證據:它印了 log 路徑而那個目錄已經不存在\n'; SRC=1; fi
  else printf '  🔴 證據:非綠而沒有印 log 落點\n'; SRC=1; fi
  rm -rf "$TD2"

  if [ "$SRC" -eq 0 ]; then printf '⇒ selftest PASS(每一格的兩個世界都印不同的東西)\n'
  else printf '⇒ selftest FAIL\n'; fi
  exit "$SRC"
fi

STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null)"
HEAD_SHA="${HEAD_SHA:-未知}"
D="$(mktemp -d -t greenlight)"

RC_TC="$(run_one typecheck "$D/tc.log" env TURBO_FORCE=1 pnpm typecheck)"
RC_LT="$(run_one lint      "$D/lt.log" env TURBO_FORCE=1 pnpm lint)"
RC_BD="$(run_one build     "$D/bd.log" env TURBO_FORCE=1 pnpm build)"
RC_VT="skip"
FED="—"
RAN="—"
if [ "$RUN_TESTS" -eq 1 ]; then
  # 🔴 第四個數:【我餵幾條】vs【它跑幾支】——
  #    總計行只印「它跑了幾支」,不印「你餵了幾條」⇒ 少跑的那一支完全沒有形狀。
  # 🔴 **不要用 `git ls-files`** —— 它【漏掉未追蹤的測試檔】,而別的窗手上常常有。
  #    2026-08-29 我自己第一版就是這樣:印「餵 703 / 跑 704」而那個差是【我的分母太窄】,
  #    不是少跑了 ⇒ **一個防假綠的工具,自己製造了一發假紅。**
  #    ⇒ 用 `find`(vitest 收的是檔案系統,不是 git index)。
  FED="$(find apps packages scripts -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) \
          -not -path '*/node_modules/*' 2>/dev/null | grep -c '')"
  RC_VT="$(run_one tests "$D/vt.log" npx vitest run)"
  RAN="$(grep -oE 'Test Files.*\(([0-9]+)\)' "$D/vt.log" | grep -oE '\([0-9]+\)$' | tr -d '()')"
  RAN="${RAN:-讀不到}"
fi

# ── 逐道列出,不印「三綠通過」四個字 ────────────────────────────────────────
printf '\n═══ greenlight @ %s · HEAD %s ═══\n' "$STAMP" "$HEAD_SHA"
one_line() {  # one_line <名稱> <rc> <log>
  local N="$1" R="$2" L="$3"
  if [ "$R" = "0" ]; then
    printf '  ✅ %-10s rc=0\n' "$N"
  elif [ "$(collision_verdict "$L" "$(live_builds)")" = "collision" ]; then
    printf '  🛑 %-10s rc=%s ⇒ 【可能是撞窗】現在有 %s 個 next build 在跑,等一下重跑\n' \
      "$N" "$R" "$(live_builds)"
    printf '     ⚠️ 而「可能」不是「確定」—— 重跑仍紅就去讀 %s\n' "$L"
  else
    printf '  🔴 %-10s rc=%s ⇒ 去讀 log %s\n' "$N" "$R" "$L"
    if is_collision "$L"; then
      printf '     ⚠️ log 裡有撞窗字面(exit code 130 之類), 而現在【沒有別的 build 在跑】\n'
      printf '        ⇒ 那個 130 多半是 turbo 砍掉並行任務造成的 —— **它是你自己的錯的副作用, 不是撞窗**\n'
    fi
    grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx)\([0-9,]+\): error [A-Z0-9]+' "$L" 2>/dev/null | head -3 | sed 's/^/       /'
  fi
}
one_line typecheck "$RC_TC" "$D/tc.log"
one_line lint      "$RC_LT" "$D/lt.log"
one_line build     "$RC_BD" "$D/bd.log"
if [ "$RUN_TESTS" -eq 1 ]; then
  one_line tests "$RC_VT" "$D/vt.log"
  # 🔴 三態,不是兩態 —— 「不相等」有兩個方向,而它們的處置相反。
  if [ "$FED" = "$RAN" ]; then
    printf '     ✅ 第四個數:我餵 %s 條 / 它跑 %s 支 —— 相等\n' "$FED" "$RAN"
  elif [ "$RAN" != "讀不到" ] && [ "$FED" -gt "$RAN" ] 2>/dev/null; then
    printf '     🔴 第四個數:我餵 %s 條 / 它跑 %s 支 ⇒ **少跑了 %s 支**,而總計行不會說\n' \
      "$FED" "$RAN" "$((FED - RAN))"
  else
    printf '     ⚠️ 第四個數:我餵 %s 條 / 它跑 %s 支 ⇒ 跑得比餵的多 ⇒ **是我的分母太窄**,不是少跑\n' \
      "$FED" "$RAN"
  fi
fi

# ── 🔴 一行摘要:它自己的分母就在這一行裡 ───────────────────────────────────
# 🔴🔴 **三態,不是兩態**(2026-08-29 主視窗問「它出錯時人分得出是它壞了還是碼壞了嗎」——
#    當場演一發 `PATH=/usr/bin:/bin bash scripts/greenlight.sh` ⇒ **它印 `RED …=127`**
#    ⇒ **把「工具跑不起來」印成了「你的碼壞了」。**)
#    ⇒ 照 `.husky/scripts-whitelist-gate.sh` 的成例分三態:0 綠 / 1 真的紅 / 2 量具自己壞了。
#    📌 **一支被六個窗信任的工具,它自己的錯會被讀成六份碼的錯。**
ENVFAIL=0
for R in "$RC_TC" "$RC_LT" "$RC_BD"; do
  case "$R" in 126|127) ENVFAIL=1 ;; esac
done
VERDICT=RED
if [ "$ENVFAIL" -eq 1 ]; then
  VERDICT=ENV-FAIL
elif [ "$RC_TC" = "0" ] && [ "$RC_LT" = "0" ] && [ "$RC_BD" = "0" ]; then
  # 🔴🔴 **沒加 `--tests` 時, 結論【不准是 GREEN】—— 而那是 2026-09-02 量到的, 不是設計潔癖。**
  #    當天 CI 在 dev 上連紅三發(`33561058560` / `33559202282` / `33557637523`, 兩支守門真紅),
  #    而沒有人發現。撞到的那個窗自陳逐字:
  #      「我跑 greenlight.sh 兩次, 兩次都印 GREEN … tests=skip
  #        而它自己逐字寫著『skip 是沒跑不是綠』—— 那句話寫在那裡, 而我讀了兩次, 兩次都往下走了」
  #    🎯 ⇒ **那不是紀律問題**:一個印 `GREEN` 而測試沒跑的輸出, **不管旁邊寫什麼**, 都會被讀成綠。
  #    📌 ⇒ ⇒ 而依機制優先律, 這一格【機制做得到】⇒ 把那個字拿掉, 不要再寫一句提醒。
  #    🛑 **而既有三態 `GREEN(0) / RED(1) / ENV-FAIL(2)` 一格都沒動** ——
  #       它們是別的腳本抄過去的契約(`latest-definition-of.sh:77` / `md-table-overflow.py:886`
  #       / `migrations-replay-from-zero.sh:11` 三支的註解逐字引它當先例)。
  #       ⇒ 所以新的那一態拿【第四個】號碼, 不去擠既有的任何一個。
  #    🔵 2026-09-02 實查:全 repo 沒有任何**非 .md** 的東西【執行】或【解析】本支的輸出
  #       (`git grep -ln greenlight -- . ':!*.md' ':!scripts/greenlight.sh'` ⇒ 4 支, 逐支開檔
  #        看過 ⇒ **四支都只是註解在引用這組三態當先例**, 沒有一支呼叫它)。
  if [ "$RUN_TESTS" -eq 0 ]; then VERDICT=PARTIAL
  elif [ "$RC_VT" = "0" ]; then VERDICT=GREEN; fi
fi
if [ "$VERDICT" = "ENV-FAIL" ]; then
  printf '\n🛑🛑 ENV-FAIL —— **這【不是】你的碼壞了,是這支工具跑不起來**(rc=126/127 = 找不到或不能執行)。\n'
  printf '     先確認 `pnpm` 在 PATH 上、而且你人在 repo 根;修好再跑一次。\n'
  printf '     ⇒ 本次【不對這棵樹下任何判斷】。\n'
fi
if [ "$VERDICT" = "PARTIAL" ]; then
  printf '\n🟡🟡 PARTIAL —— **三綠過了, 而【測試沒有跑】。⇒ 這不是綠。**\n'
  printf '     要綠請加:bash scripts/greenlight.sh --tests\n'
  # 🔴🔴 **這幾行【不准出現那個綠字的英文】** —— 本支的 selftest ⑤b 斷言的是
  #    「未加 --tests 的輸出裡, 那個字一次都不能出現」, 而**一句解釋它的散文也算一次**。
  #    ⇒ 📌 2026-09-02 第一版就踩到了:我把它寫進這段說明 ⇒ 自己的守門紅。
  #    ⇒ ⇒ 而那是對的紅:讀的人只會看到那個字, 不會看到它站在哪一句裡。
  printf '     🔴 而 2026-09-02 那天 CI 在 dev 上連紅三發, 而兩個窗各跑了兩次本工具、四次都往下走了\n'
  printf '        —— 因為當時這一行印的是【綠】。⇒ 那個字現在不會再出現在這個世界裡。\n'
fi
printf '\n%s typecheck=%s lint=%s build=%s tests=%s | 涵蓋: turbo + tsc scripts%s | @ %s HEAD %s\n' \
  "$VERDICT" "$RC_TC" "$RC_LT" "$RC_BD" "$RC_VT" \
  "$( [ "$RUN_TESTS" -eq 1 ] && printf ' + vitest 餵%s跑%s' "$FED" "$RAN" || printf ' (未跑測試)' )" \
  "$STAMP" "$HEAD_SHA"

# ── 🔵 把【已經算出來的撞窗判斷】落地一行 TSV ─────────────────────────────
# 🔴 **為什麼**(2026-09-02 線 -7d 量到):本支【早就答得出】「這一發的紅是不是別人造成的」
#    (`collision_verdict` + `live_builds`,而它自帶正負對照,見 selftest ③)——
#    🛑 **而那個判斷只印在 stdout,而 stdout 去哪由跑的人決定** ⇒ 跑完就沒了。
#    ⇒ 📌 於是今晚問「一發三綠有多大機率量到別人的中間狀態」時:
#       **分子有四個(四個窗的回報),而分母【一個來源都沒有】** —— 四種都試過:
#       `.next/BUILD_OK` 只留最後一次 · `logs/greenlight*` 不存在 ·
#       mktemp 那三個是 selftest 的且已清 · `/tmp/gl*.log` 是各窗自己取的檔名(很弱的下界)。
#    🎯 ⇒ ⇒ **不是沒有人量,是【量了而沒有落地】。**
# 🔵 而這一行比「每窗一棵 worktree」便宜一個量級:一週之後分子與分母都可數,
#    再拿數字去決定要不要動流程 —— 而不是拿四個故事去拍板。
# ⚠️ 射程:它記的是【本支被跑的那些發】。有人不用本支直接跑 `pnpm typecheck` ⇒ 這裡看不到。
#    ⇒ 所以這個分母是【下界】,不是全部。而那一格要跟著數字走,不要只寫在這裡。
# 🔴 **selftest 的子跑不准寫進來**(2026-09-02 第一版就踩到):
#    selftest 會 spawn 兩發子跑(ENV-FAIL 與 PARTIAL 各一)⇒ 它們也會落一行
#    ⇒ ⇒ 而那兩行**看起來就是真的量測** ⇒ 分母被工具自己的對照組灌水。
#    📌 同夜線 -7d 撈 log 時撈到 2 支「含撞窗訊號」的, 開檔一看是 `=== greenlight --selftest ===`
#       ⇒ **真正的分子是 0 不是 2** —— 一模一樣的病, 換一個載體。
if [ "${GL_SELFTEST_CHILD:-0}" = "1" ] || [ "${1:-}" = "--selftest" ]; then GL_RUNLOG=""; fi
GL_RUNLOG="${GL_RUNLOG-logs/greenlight-runs.tsv}"
[ -z "$GL_RUNLOG" ] && GL_RUNLOG=/dev/null
[ "$GL_RUNLOG" != "/dev/null" ] && mkdir -p "$(dirname "$GL_RUNLOG")" 2>/dev/null || true
if [ ! -s "$GL_RUNLOG" ]; then
  printf 'stamp\thead\tverdict\trc_tc\trc_lt\trc_bd\trc_vt\tfed\tran\tlive_builds\tcollide_tc\tcollide_lt\tcollide_bd\n' \
    >> "$GL_RUNLOG" 2>/dev/null || true
fi
GL_LIVE="$(live_builds)"
# 🔵 逐道各自問一次 —— 而 rc=0 那道問了沒有意義,所以印 `-`(空白會與「判不出來」混在一起)
gl_col() { [ "$2" = "0" ] && { printf -- '-'; return; }; collision_verdict "$1" "$GL_LIVE"; }
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$STAMP" "$HEAD_SHA" "$VERDICT" "$RC_TC" "$RC_LT" "$RC_BD" "$RC_VT" \
  "$FED" "$RAN" "$GL_LIVE" \
  "$(gl_col "$D/tc.log" "$RC_TC")" "$(gl_col "$D/lt.log" "$RC_LT")" "$(gl_col "$D/bd.log" "$RC_BD")" \
  >> "$GL_RUNLOG" 2>/dev/null || true
[ "$GL_RUNLOG" != "/dev/null" ] && \
  printf '\n📎 本發已記一行:%s(%s 行)\n' "$GL_RUNLOG" "$(wc -l < "$GL_RUNLOG" 2>/dev/null | tr -d ' ')"

# ── ⚠️ 射程印在眼前,不是躺在檔頭 ──────────────────────────────────────────
cat <<'SCOPE'

🛑 這一發【證不到】什麼:
   · 它證的是【它跑的那一瞬間】—— 八窗共用一棵樹,下一秒別人 commit 就不成立
   · `.sql` / `.json` / `.sh` / `.css` 對 typecheck 與 lint 恆綠、零判別力
   · 不含 CI 那一層（playwright、真 postgres 的 SQL 探針）—— 那層只有 CI 有
   · 未加 --tests 時，tests=skip 的意思是【沒跑】，不是【綠】
   · 🔴 用 `pnpm --filter <app> build` 跑的那一發【拿不到 `Cached:` 那一行】——
     而它跑起來一樣綠 ⇒ 它不是「壞掉」,是「證不出來」⇒ **不得宣稱「真跑」,要寫「未證」**
     ⚠️ 而理由要補完整(2026-08-29 線-b4 量到、我先前只寫了一半):
        `apps/admin` 的 build 是 `bash ../../scripts/build-with-stamp.sh admin`
        ⇒ **那條路根本不走 turbo** ⇒ 沒有 turbo 就沒有快取可以 replay
        ⇒ 📌 **所以它不只是「拿不到那一行」,是【那一行對它沒有意義】** ——
           要證那一發真跑, 看的是 `rc` 與 `BUILD_OK` 戳記, 不是 `Cached:`。
SCOPE
# 🔴 **非綠時【不要刪 log】** —— 上面每一道紅都印了 log 路徑,
#    而第一版在這裡 `rm -rf "$D"` ⇒ **它指的那個檔在它印完的下一刻就不存在了。**
#    (2026-08-29 演 ENV-FAIL 時當場撞到:三行 log 路徑,三個都已經被刪。)
#    📌 **一個訊號指向一個【它自己剛剛毀掉】的證據,比不給證據更糟。**
if [ "$VERDICT" = "GREEN" ]; then
  rm -rf "$D"
  exit 0
fi
# 🟡 `PARTIAL` 的三道【都過了】⇒ 沒有紅 log 可以指 ⇒ 與 GREEN 一樣清掉, 只有 rc 不同。
#    🔴 而它【不是】綠:rc=4, 而總結那一行沒有 GREEN 這個字。
if [ "$VERDICT" = "PARTIAL" ]; then
  rm -rf "$D"
  exit 4
fi
printf '\n📎 log 留著沒刪: %s\n' "$D"
[ "$VERDICT" = "ENV-FAIL" ] && exit 2
exit 1
