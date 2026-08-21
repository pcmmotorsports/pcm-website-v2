#!/bin/sh
# backlog 號碼原子配號 —— 用 git ref 的 compare-and-swap
#
# 用法:
#   sh scripts/reserve-backlog.sh '員工登入逾時處理'    配一個號
#   sh scripts/reserve-backlog.sh --init                 建立計數器（只做一次）
#   sh scripts/reserve-backlog.sh --show                 只看目前值，不配號
#   sh scripts/reserve-backlog.sh --selftest             三格自測（用臨時 ref，不碰正式計數器）
#
# ── 為什麼是 git ref(來源:codex,2026-08-17)────────────────────────────────
# 🔴 **所有 worktree 共用同一個 git common directory** ⇒ 本機的 git ref 就是一個
#    現成的、跨 worktree 的原子計數器,不需要中央伺服器或常駐服務。
#    這個洞見是 codex 給的(Sean 2026-08-17 開放 codex 之後第一個我們沒想到的東西)。
#
# 機制:`git update-ref <ref> <new> <expected-old>` 是 compare-and-swap。
#   實測(I 窗 2026-08-17,兩窗同時從同一個 expected-old 推進):
#     窗A ⇒ rc=0 成功
#     窗B ⇒ fatal: cannot lock ref …: is at <A的值> but expected <舊值>
#   ⇒ **只有一個會成功,另一個【必須重讀】。** 這不是提案,是量過的。
#
# ── 🔴 三條已知限制(寫在這裡,不要只留在信裡)──────────────────────────────
# 1. **`.git` 遺失 / 重新 clone ⇒ 計數器 ref 消失。** 本腳本對此 **fail closed**
#    (見 `require_counter`):不自動重建,因為自動重建會**靜默地從頭配號**、
#    產生與既有 backlog 重複的號 —— 那正是本腳本要防的事。
# 2. **`git commit --no-verify` 仍可繞過任何 pre-commit 檢查。** 這是 client hook
#    的固有限制。本腳本只保證「**走它配的號不會撞**」,不保證沒有人手寫號碼。
# 3. 🔴 **跨機器那半【沒有解】。** 這個 ref 只存在本機。報價單真身在 mac mini
#    (memory `reference_quote-repo-truth-moved-to-mac-mini`)⇒ **兩台機器同時配號會撞**,
#    本腳本射程之外。
# 4. 🔴 **配號成功之後、條目 commit 之前,舊的檔案掃描閘【看不到】這個號。**
#    (2026-08-17 E 窗第一個真實使用者當場量到:配掉 `#600` 之後 `--show` 回「目前 600」,
#     而 `docs/phase-1-backlog.md` 尚未 commit ⇒ `next-backlog-number.sh` 掃檔案內容
#     ⇒ 它會回報 `#600` 可用 ⇒ 撞號。)
#    **這是【結構性的交接期缺口】,不是那一次的意外** —— CAS 把號寫進 git ref,
#    舊閘讀的是檔案,**兩者之間永遠有一個時間窗**。
#    ⇒ **兩套並行期間,以 `--show` 為準,不以舊閘為準。**
#    ⇒ 判別句:**我這個「可用」是從【檔案】看出來的,還是從【計數器】看出來的?**
#    🔴🔴 **上面這兩行已於 2026-08-21 失效,照做會撞號**(逐字保留不改寫 —— 它還在證明
#       「一句當時正確的指示會變成陷阱」)。當天實測:計數器 641、檔案 822,`--show` 說下一個是
#       #642,而 #642 在 2026-08-18(fa3d1683)就被用掉了。**權威已改回檔案側**:
#       要號跑 `bash scripts/claim-backlog-number.sh`。本檔下方已加落後守門,會擋住這條路。
#
# ── 🔴 `#556`~`#599` 那個空洞是【故意的】────────────────────────────────────
# 舊號(至 `#555`)全部凍結、不改號,外部引用不斷。新世代從 `#600` 起配。
# 中間那 44 個號**永遠不會被配出來**。它有**兩個**用途:
#
#   ① 世代標記:`< #556` = 人工掃描配的(可能撞過)、`>= #600` = CAS 配的
#      ⇒ 那個斷點本身就是「這一號是哪一套機制配的」的自我說明
#   ② 🔴 **給舊機制【掃不到的那一類號】留的緩衝**(2026-08-17 主視窗補,比 ① 強):
#      `next-backlog-number.sh` 自己印著它的限度 —— 掃不到「只存在於 remote 而本機無對應
#      branch」的號、掃不到「只活在某封信或某段對話裡」的號 ⇒ **它給的是下限。**
#      那些號若日後浮出來,落點會在 `556`~`599` 這一段 ⇒ **不會撞到 CAS 配出來的。**
#
# **不要以為掉了 44 個號。**
#
# ── ⚠️ 舊閘暫時並存,不要拆 ──────────────────────────────────────────────
# `scripts/next-backlog-number.sh` 與 `grep -rn '#5xx' ~/pcm-mailbox/*.md` **繼續跑**。
# 理由:本腳本只保護「走它的人」,而**信裡手寫的佔位號它看不到** —— 那正是舊閘在擋的。
#
# 🔴 **但 2026-08-17 第一次實配當場暴露一個結構性缺口**(E 窗配走 `#600`):
#    **CAS 配號成功 → 條目 commit 進 `docs/phase-1-backlog.md`,中間有一個時間窗。**
#    舊閘掃的是**檔案內容** ⇒ **在那個窗裡它一定少報** ⇒ 它會回答「`#600` 可用」而其實已被配走。
#    ⇒ **兩套並行期間,號碼可不可用以 `--show` 為準,不以舊閘為準。**
#    🔴🔴 **上面這兩行已於 2026-08-21 失效,照做會撞號**(逐字保留不改寫 —— 它還在證明
#       「一句當時正確的指示會變成陷阱」)。當天實測:計數器 641、檔案 822,`--show` 說下一個是
#       #642,而 #642 在 2026-08-18(fa3d1683)就被用掉了。**權威已改回檔案側**:
#       要號跑 `bash scripts/claim-backlog-number.sh`。本檔下方已加落後守門,會擋住這條路。
#    ⇒ 舊閘的角色因此收窄成:**只補「信裡手寫佔位號」那一類本腳本看不到的**,
#      **它不再是「這個號可不可用」的權威。**
#
# **拆舊閘的條件(2026-08-17 重訂)**:
#   ① 連續一輪全陣配號零手寫(原條件)
#   ② **且**「我先在信裡佔一個號」這個需求有替代出口 ——
#      否則拆掉之後那個需求**沒有出口**,一定回到手寫。
#      📎 同 `run-rc.sh` 那條教訓:**規則擋住一個沒有替代出口的需求 ⇒ 一定被繞過。**

set -e

# 測試接縫(只給 harness 用,平常不要設):換一顆拋棄式 ref,不碰正式計數器
REF="${PCM_BACKLOG_REF:-refs/pcm/counters/backlog}"
GENESIS=599            # 第一個配出來的號 = GENESIS + 1 = 600

cd "$(git rev-parse --show-toplevel)"

die() { printf '%s\n' "$@" >&2; exit 1; }

read_counter() {   # <ref> -> 印出目前號碼
  git cat-file -p "$(git rev-parse "$1")"
}

require_counter() {  # ref 不存在 ⇒ fail closed,並印出人看得懂的下一步
  git show-ref --verify --quiet "$1" && return 0
  die "" \
    "🔴 計數器 ref 不存在:$1" \
    "" \
    "   這【不是】叫你重跑一次就會好 —— 本腳本**刻意不自動重建**。" \
    "   自動重建會靜默地從 #$((GENESIS+1)) 重新配號,而那些號可能已經被用掉了。" \
    "" \
    "   可能原因:重新 clone / .git 被刪 / 這台不是原來那台機器。" \
    "" \
    "   下一步(要有人判斷,不要照抄):" \
    "     1. 先確認目前實際最大號:sh scripts/next-backlog-number.sh" \
    "     2. 確認它 >= $GENESIS 之後,才初始化:" \
    "          sh scripts/reserve-backlog.sh --init <目前最大號>" \
    "     3. 若最大號 < $GENESIS,直接用 --init $GENESIS(新世代起點)" \
    ""
}

# ── 🔴 落後守門(2026-08-21 立;由本線 backlog 制度線加,主視窗裁「閘」)────────
#
# 病:2026-08-21 實測 `--show` 回「目前 641 ⇒ 下一個是 #642」,而
#     `grep -c '^### #642' docs/phase-1-backlog.md` ⇒ 1 —— #642 在 2026-08-18(fa3d1683)
#     就有人用了。計數器停在 641,檔案已走到 822,**差 181 個號**。
#     08-18 之後沒有人再走這支,大家直接把條目寫進檔案,而**計數器不會知道這件事**。
#
# 🔴 為什麼這比「落後」本身貴:本檔上面第 33-38 行與第 59 行寫著
#     「兩套並行期間,以 `--show` 為準,不以舊閘為準」。**那句話在 2026-08-17 是對的。**
#     今天照它做 = 必撞。而它讀起來完全像一個還在運作的機制(有 selftest、有三條已知限制、
#     有 CAS 實測數據)⇒ **它不是壞掉的樣子,它是健康的樣子。**
#     ⇒ 一把尺量了 181 次都沒紅過,因為沒有人再看它。
#
# 判準只有一條:**計數器要配出去的下一個號(cur+1)如果 <= 檔案側的最大號,那個號一定已經有人用了。**
#   ⇒ 也就是 `cur < floor` ⇒ 擋。
# 🔴 反方向【不擋】,而且是刻意的:`cur > floor` 是本檔「已知限制 4」描述的**正常交接期** ——
#   配號成功、條目還沒 commit,檔案側必然少報。做成「兩邊不等就紅」的閘,
#   會在對齊之後天天誤擋,而**誤擋會把人趕出守門的視野,那比漏擋更難發現**。
#   (這一格是主視窗 2026-08-21 指定要驗的第三發,harness 裡有。)
#
# 🔴 射程(不要讓本閘讀起來像擋得住全部):
#   · floor 來自 `next-backlog-number.sh`,它自己印著限度 —— **掃不到只存在於 remote
#     而本機無對應 branch 的號、掃不到只活在某封信或某段對話裡的號** ⇒ 它給的是**下限**。
#     ⇒ 本閘因此只擋得住「已經落檔的號」,擋不住「別人剛配走還沒落檔的號」。
#   · 本閘擋的是**這支腳本的使用者**;有人手寫號碼進 backlog,它看不到(檔頭限制 2)。
#   · 🔴🔴 **本閘擋得住「這個號被用過」,擋不住「這個號被寫進去的時候我不在場」**
#     (2026-08-21 實錘,窗 C2 自陳,逐字):
#       「`grep -c '^### #823' docs/phase-1-backlog.md ⇒ 0` 是**完全正確的量測**,
#         而它證明的東西**在它印出來的那一刻就過期了**。
#         病不在誰跑錯,在於:**「某個東西還沒進檔」這種宣稱,只在「沒有別人正在寫那支檔」
#         的前提下成立,而那個前提沒有寫在數字旁邊。**」
#     ⇒ **「我查過了,沒有」與「我查過之後沒有人再動它」是兩個宣稱,而一個 grep 只證得了前一個。**
#     ⇒ 當天真的發生:號已 release,而它同時進了 `d4768eb2`。
#     🔴 這一格**刻意不補機制**(主視窗 2026-08-21 裁:那會變成第四支腳本)。
#       **守門誠實標自己照不到的地方,比再加一層閘值錢。** 要真的擋,唯一的形態是
#       `claim-backlog-number.sh` 那種**佔著不放的鎖**,而它同樣只在單機、走它的人之間成立。
#   · 🔴 **發號只保證「號不撞」,保證不了「這件事沒有人登記過」**(窗 -81 2026-08-21 供)。
#     後者要跑 `python3 scripts/backlog-duplicate-scan.py --search <症狀關鍵字>`,
#     **而那不是發號流程的一步,要人記得** ⇒ 當天兩次:一次接住(`#528`)、一次**判錯**
#     (`#821` 命中最高分而被人為判成「不同件」)⇒ **工具沒失效,失效的是看著命中做的那一步判斷。**
#   · 🔴 **分母會在你數它的時候變** —— 九窗共用一棵樹,floor 是量測那一瞬間的值。
#     (2026-08-21 實例:一支未追蹤的 migration 被回報時真的在,主視窗去看時已經不在。)
#
# 逃生門:PCM_ALLOW_STALE_BACKLOG_COUNTER=1(要在交件寫明理由)
#
# exit 1 = 計數器落後(擋)   exit 2 = 本閘自己判不出來(輸出作廢,一樣不放行)

die2() { printf '%s\n' "$@" >&2; exit 2; }

require_not_behind() {   # <ref>
  # 🔴 逃生門【只跳過比較,不跳過健全性檢查】(2026-08-21 R1 BL-2 折;原版在這裡就 return 0)。
  #   原版的病:逃生門開著 + ref 被寫壞 ⇒ 整個 require_not_behind 被跳過 ⇒ 下一行算術吃到非數字
  #   ⇒ **rc=1,與「計數器落後」同碼** ⇒ 上面剛修好的「量具壞了與量到東西分不開」從這條路復活。
  #   實測(2026-08-21 本機 macOS sh,逃生門開 + ref 寫壞):
  #     `line 281: 這不是數字+1: syntax error: operand expected` ⇒ **rc=1**
  #     ⚠️ R1 審查者用 `sh -c` 模擬得到 rc=127 —— 那是模擬,不是跑本腳本。以實跑為準。
  #   ⇒ 逃生門放行的是「我知道它落後、我就是要配」,**不是**「這顆 ref 是不是壞的」。
  _cur=$(read_counter "$1" 2>/dev/null || true)
  case "$_cur"   in ''|*[!0-9]*) die2 "🔴 落後守門:讀不到計數器值(得到 '"'"'$_cur'"'"')⇒ 判不出來,exit 2" ;; esac
  if [ "${PCM_ALLOW_STALE_BACKLOG_COUNTER:-}" = "1" ]; then
    printf '%s\n' "⚠ backlog 計數器落後守門被 PCM_ALLOW_STALE_BACKLOG_COUNTER=1 略過 —— 請在交件寫明理由" >&2
    return 0
  fi
  _floor=$(bash scripts/next-backlog-number.sh --floor 2>/dev/null || true)
  # 🔴 兩個值任一不是純數字 ⇒ 本閘判不出來 ⇒ exit 2,不放行。
  #    (空字串在 shell 比大小會被當 0 而【安靜地放行】—— 那正是量具壞掉時最不該發生的事。)
  case "$_floor" in ''|*[!0-9]*) die2 "🔴 落後守門:next-backlog-number.sh --floor 沒回數字(得到 '"'"'$_floor'"'"')⇒ 判不出來,exit 2" \
                                       "   自己跑一次看它印什麼:bash scripts/next-backlog-number.sh --floor" ;; esac
  [ "$_cur" -ge "$_floor" ] && return 0
  die "" \
    "🔴 擋下:backlog 計數器落後檔案,它要配的號【已經有人在用】" \
    "" \
    "   計數器目前      = $_cur   ($1)" \
    "   它下一個要配    = #$((_cur+1))" \
    "   檔案側最大號    = $_floor   (bash scripts/next-backlog-number.sh --floor)" \
    "   落後            = $((_floor - _cur)) 個號" \
    "" \
    "   驗一下這不是誤擋(兩個世界會印不同的東西):" \
    "     grep -c '"'"'^### #$((_cur+1))'"'"' docs/phase-1-backlog.md     ⇒ 1 代表真的被用了" \
    "" \
    "   🔴 本檔上面寫的「以 --show 為準,不以舊閘為準」**已於 2026-08-21 失效**,不要照做。" \
    "" \
    "   現在要號怎麼辦(本閘只說你撞到了,不說該誰怎麼改 —— 那是別人的判斷):" \
    "     bash scripts/claim-backlog-number.sh     ← 三層掃描 + mkdir 原子佔位" \
    "   計數器要不要對齊到 $_floor,發號權在主視窗(它是十窗共用的 ref,動的當下有人在配號會撞)。" \
    ""
}

set_counter() {  # <ref> <新值> <expected-old-blob 或 空字串>
  new_blob=$(printf '%s\n' "$2" | git hash-object -w --stdin)
  if [ -n "$3" ]; then
    git update-ref "$1" "$new_blob" "$3"
  else
    git update-ref "$1" "$new_blob"
  fi
}

reserve() {  # <ref> <標題> -> 印出配到的號;撞到就重試
  ref=$1; title=$2; tries=0
  while [ "$tries" -lt 20 ]; do
    tries=$((tries+1))
    old_blob=$(git rev-parse "$ref")
    cur=$(read_counter "$ref")
    next=$((cur+1))
    # 🔴 CAS:expected-old 不符 ⇒ 另一個窗在這幾毫秒內配掉了 ⇒ 重讀重試。
    #    **這就是整支腳本唯一在做的事**,其他都是包裝。
    if set_counter "$ref" "$next" "$old_blob" 2>/dev/null; then
      printf 'RESERVED #%s\n' "$next"
      [ -n "$title" ] && printf '標題    %s\n' "$title"
      printf '貼進 docs/phase-1-backlog.md:\n\n### #%s · %s\n\n' "$next" "${title:-<標題>}"
      return 0
    fi
    [ -n "$QUIET_RETRY" ] || printf '（第 %s 次被別的窗搶先，重讀後重試）\n' "$tries" >&2
  done
  die "🔴 重試 20 次都被搶先 —— 這不正常,可能有東西在迴圈裡配號。先查是誰。"
}

# ── 三格自測:用臨時 ref,不碰正式計數器 ────────────────────────────────────
selftest() {
  T=refs/pcm/counters/selftest-$$
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  git update-ref -d "$T" 2>/dev/null || true

  # 格1:ref 不存在 ⇒ fail closed(這格是主視窗指名要的負測)
  # 🔴 `|| true` 要放在【賦值外面】,不能放進 `$( )` 裡:
  #    `die` 用的是 `exit`,而 `exit` 在 subshell 內【直接結束 subshell】——
  #    `... || true` 那半根本不會執行 ⇒ 賦值 rc=1 ⇒ `set -e` 當場把整支腳本殺掉,
  #    症狀是「**零輸出、rc=1**」,看起來像自測沒跑而不是像有 bug。(2026-08-17 實際踩到)
  out=$(require_counter "$T" 2>&1) || true
  case "$out" in
    *"計數器 ref 不存在"*) r=closed ;;
    *)                      r=other  ;;
  esac
  ck "格1 ref 不存在 ⇒ fail closed" "$r" "closed"
  # 🔴 這格不只看它失敗,還看它【印了下一步】—— 一個只丟 git 錯誤就結束的守門,
  #    會讓撞到的人以為是工具壞了而不是「這裡需要人判斷」。
  case "$out" in *"下一步"*) r2=has_guidance ;; *) r2=bare_error ;; esac
  ck "格1b 失敗訊息有下一步" "$r2" "has_guidance"

  # 格2:正常配號遞增
  set_counter "$T" "$GENESIS" ""
  QUIET_RETRY=1 reserve "$T" 自測 > /dev/null
  ck "格2 第一個號 = GENESIS+1" "$(read_counter "$T")" "$((GENESIS+1))"

  # 格3:CAS 真的擋得住 —— 拿【過期的 expected-old】寫 ⇒ 必須失敗
  stale=$(git rev-parse "$T")
  QUIET_RETRY=1 reserve "$T" 自測2 > /dev/null      # 讓 ref 前進，stale 因此過期
  if set_counter "$T" 9999 "$stale" 2>/dev/null; then r=wrote; else r=blocked; fi
  ck "格3 過期的 expected-old ⇒ 被擋" "$r" "blocked"
  # 🔴 正向對照:同一支 set_counter 用【當下的】expected-old ⇒ 必須成功。
  #    沒有這格,格3 的「blocked」可能只是 set_counter 根本壞了。
  fresh=$(git rev-parse "$T")
  if set_counter "$T" 8888 "$fresh" 2>/dev/null; then r=wrote; else r=blocked; fi
  ck "格3b 正向對照:新鮮的 expected-old ⇒ 寫得進去" "$r" "wrote"

  git update-ref -d "$T" 2>/dev/null || true
  git show-ref --verify --quiet "$T" && { printf 'FAIL  收尾:臨時 ref 沒清乾淨\n'; fail=$((fail+1)); } \
                                     || { printf 'PASS  收尾:臨時 ref 已清\n'; pass=$((pass+1)); }

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  --init)
    [ -n "${2:-}" ] || die "用法: sh scripts/reserve-backlog.sh --init <起始號>"
    git show-ref --verify --quiet "$REF" && die "🔴 計數器已存在(目前 $(read_counter "$REF"))—— 不覆蓋。要重設請人工判斷後 git update-ref -d $REF"
    set_counter "$REF" "$2" ""
    printf '已建立 %s,目前值 %s ⇒ 下一個配出來的號是 #%s\n' "$REF" "$2" "$(($2+1))" ;;
  --show)   require_counter "$REF"
            # 🔴 先驗再印,而不是先印再驗(2026-08-21 harness 格5 抓到,原本反過來):
            #    下一行對計數器值做算術。值若不是數字(ref 被寫壞),算術在 set -e 下先炸,
            #    **rc=1 —— 與「計數器落後」同碼** ⇒ 量具壞了與量到東西分不開。
            #    被擋的人仍看得到現值:落後訊息裡就印著「計數器目前 = …」。
            require_not_behind "$REF"
            printf '目前 %s ⇒ 下一個是 #%s\n' "$(read_counter "$REF")" "$(($(read_counter "$REF")+1))" ;;
  "")       die "用法: sh scripts/reserve-backlog.sh '<標題>'   （或 --init / --show / --selftest）" ;;
  *)        require_counter "$REF"; require_not_behind "$REF"; reserve "$REF" "$1" ;;
esac
