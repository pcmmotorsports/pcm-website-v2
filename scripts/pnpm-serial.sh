#!/usr/bin/env bash
# pnpm-serial.sh — 讓多個施工窗【一次只有一個】在跑 pnpm。
#
# 起因(2026-08-20 Sean 逐字):「很多視窗會同時跑 pnpm 導致 cpu 滿載，cpu 撐不住」
# 實錘(**W1 量的,2026-08-20 深夜,七個窗同時在跑的負載下**):同一份 code 連跑五次
#   ⇒ 1/0/6/5/1 紅，失敗全部是 `Test timed out in 5000ms`，而它沒動過那些檔。
#   🔴 紅燈比綠燈更貴:綠燈只是沒抓到，紅燈會讓人去改一個沒壞的地方。
#
#   🔴🔴 **本項無法在不違反本腳本目的的前提下重量** ——
#     重跑它需要**同時跑好幾發 pnpm**，而那正是本鎖要防的事。
#     ⇒ 它是【單一來源】，而它**不會有第二個來源**。這不是缺陷,是一個要寫出來的性質:
#       否則下一個人會以為它跟本檔其他「實測」同級。
#   ⚠️ 而這個數字在轉述之間漂移過一次:最初是「連跑【三次】⇒ 1/0/6」,後來成為五次
#     ⇒ 前三個一致 ⇒ 多半是又多跑了兩發(合理)，**而那個漂移本身是要盯的形狀**。
#   📌 **若哪天 CPU 不再是瓶頸(換機器 / 少幾個窗)，那時可以重量它 ——
#     而那也正是檢驗這支鎖【還需不需要存在】的時刻。**
#
# 用法:  bash scripts/pnpm-serial.sh typecheck
#        TURBO_FORCE=1 bash scripts/pnpm-serial.sh test
# 環境:  PNPM_SERIAL_WAIT=<秒>  等鎖上限(預設 **240**;不要調高過 600,理由見檔頭)
#        PNPM_SERIAL_WHO=<名字> 讓別人看得出誰佔著(預設 $USER@$$)
#        PNPM_SERIAL_LOCK=<路徑> 鎖的位置(預設 /tmp/pcm-pnpm-serial.lock)
#
# 🔴 退出碼刻意分得開(照 where-is.sh 先例):
#     pnpm 自己的 rc  原樣傳回
#     75              等鎖逾時(EX_TEMPFAIL) —— **這不是測試失敗，是沒輪到你**
#     2               用法錯
#
# 🔴🔴 而 75 這個 sentinel【會撞】—— 實測,不是推論(2026-08-20):
#     pnpm exec sh -c 'exit 75' ⇒ rc=75   'exit 42' ⇒ 42   'exit 0' ⇒ 0（正向對照）
#     ⇒ 真 pnpm 把子行程的 rc **原樣**傳出來 ⇒ 值域 0-255 全開
#     ⇒ **任何 sentinel 都會撞**，因為本包裝器的職責就是原樣傳回任意子代碼。
#     ⇒ 換一個更罕見的數字只是把機率壓低、沒有改變性質 ——
#       而**低機率失效比高機率失效更貴:它出現時沒有人準備好，且事後查不出來**。
#   ⇒ 所以逾時那一發【額外印一行機器讀得懂的標記】:`PNPM_SERIAL_TIMEOUT`
#     判準(也印在那一發的 stderr 上，不是只寫在這裡):
#       **rc=75 且【沒有】PNPM_SERIAL_TIMEOUT 標記 ⇒ 那是 pnpm 自己回的 75。**
#
# ── 🔴 等鎖上限為什麼是 240(理由換過一次,舊的那個【是假的】)────────────────
#   ~~舊理由(2026-08-20 R3,已推翻):「agent 的 Bash 工具 timeout 上限是 600 秒,
#     600 < 1800 ⇒ **工具先把呼叫殺掉** ⇒ 本腳本永遠走不到自己的逾時分支」~~
#   🔴🔴 **那兩句都是假的,同日 R4 實測推翻**:**工具【不殺】它,它把呼叫轉成背景**,
#     並給你輸出檔路徑;`rc` 照樣回得來,等鎖期間的輸出也讀得到(見下一段)。
#   ⚠️ **為什麼把假的留著劃掉而不是靜靜換掉**:下一個人要看得出那個理由被推翻過 ——
#     否則他會照著它把值改回去,或據它推出別的錯結論。
#
#   ✅ **現在的理由**:240 秒還等不到 ⇒ 多半不是【排隊】而是【有人卡住了】。
#      早點把控制權還給呼叫者、讓他去看那把鎖(症狀與查法都印在 stderr 上),
#      比讓他等 30 分鐘有用。
#   ⚠️ **而 240 這個數字沒有量過 —— 它是一個判斷,不是一個量測。**
#
# ── ✅ 等鎖期間的輸出,三種呼叫方式都拿得到(每一句都是量到的)──────────────
#   本腳本的 stderr **是【邊等邊寫】的**(2026-08-20 W5 實測:起假持有者讓它等,
#   逐 5 秒取樣輸出檔 ⇒ t=5s 90 bytes/1 行 … t=30s 182 bytes/2 行 ⇒ **等待期間檔案就長了**)。
#   而你**看不看得到**,取決於你怎麼呼叫:
#     前景 · 未逾時 ⇒ 要等呼叫返回才一次交出來
#     前景 · 逾時   ⇒ **工具自動轉背景**並給你輸出檔路徑 ⇒ 可以讀中途輸出
#                    (2026-08-20 兩窗各自一手觀察到同一件事)
#     主動背景      ⇒ 邊跑邊讀那個檔
#   ⇒ 🔴 **三種都拿得到,只是時機不同。沒有一種是拿不到。**
#
#   📌 背景執行時怎麼拿 rc —— **五種寫法,兩種會靜靜給你錯的答案**(2026-08-20 逐條實測):
#     ❌ `cmd > f 2>&1 &` 之後讀 `$?`       ⇒ 那是【背景化】的 rc,**永遠 0**
#     ✅ `cmd > f 2>&1 & wait $!`           ⇒ 拿得到真 rc(實測 42;`/bin/sh` 下也成立)
#     ✅ `{ cmd; echo "RC=$?"; } > f 2>&1 &` ⇒ rc 落進**檔案裡**
#     🔴 `{ cmd | tail -1; echo "RC=$?"; }`  ⇒ 拿到的是 **tail 的**(幾乎恆 0)
#     ✅ 同上但同一個 `{ }` 裡先 `set -o pipefail`
#   🔴 而 `wait $!` 那一招有**兩個邊界**(我實測到的,不在別人給的清單裡):
#     · 背景的是**整條管線**時 ⇒ `cmd | tail & wait $!` **實測回 0** —— 管線那個坑照樣在
#     · 背景**不只一個工作**時 ⇒ `$!` 是【最後一個】(實測:先 11 後 22 ⇒ `wait $!` 拿到 22)
#       ⇒ 要哪一個就**先把那個 pid 存起來**(`p=$!` … `wait "$p"` ⇒ 實測拿到 11)
#   ⚠️ **不要依賴 harness 的完成通知帶 exit code** —— 那是【那一次呼叫】的產物,
#     **它不在檔案裡** ⇒ 交接、貼給別人看的時候它會消失。自己寫的 `RC=` 換工具換窗都還在。
#   ⚠️ **不要依賴 harness 的完成通知帶 exit code** —— 那是【那一次呼叫】的產物,
#     **它不在檔案裡** ⇒ 交接、貼給別人看的時候它會消失。自己寫的 `RC=` 換工具換窗都還在。
#
# ── 🔴 覆蓋率 ≠ 目標(W6 nit;不寫的話下一個人會以為 CPU 問題解了)──────────
#   本鎖只擋【走這支腳本的呼叫】。直接 `pnpm test` / `npx vitest` / IDE task **全部繞過**;
#   而且 **turbo 在【一個】pnpm 之內就會併發多個 workspace**。
#   ⇒ 達成的是「**一次一個窗**」,**不是**「CPU 不滿載」—— 後者沒有保證。
#
# ── 🔴🔴 本鎖【不修】什麼(W6 2026-08-20 指出的失效方向)──────────────────────
#   **本鎖不修那個 `Test timed out in 5000ms` 太緊的問題，只是讓它不再出現在本機。**
#   🔴 而危險的是:鎖上線 ⇒ timeout 紅燈消失 ⇒ **而消失的自然讀法是「修好了」**。
#      真正的病若是 5000ms 對這台機器在任何負載下都太緊，它會在 CI / 更少 CPU 的地方
#      **原封回來**，而那時沒有人記得它曾經是已知的。
#   ⇒ 要查那個真問題，判別句是:
#       **把鎖拿掉、單獨跑那支測試，它還會 timeout 嗎?**
#       還會 ⇒ 那是真的太緊、與並行無關 ⇒ **那一格仍然沒有人查過。**
#
# ── ⚠️ ~~已知殘餘風險:pid 重用~~ **本段已作廢(2026-08-20),而理由要留著**─────────
#   原本這裡寫:陳舊鎖判定用 `kill -0`,而 **pid 會被重用** ⇒ 持有者死掉、pid 剛好被別人佔走
#   ⇒ `kill -0` 成功 ⇒ 鎖永遠收不回來。
#   🔴 **那個風險隨著【自動回收】一起消失了** —— 現在本腳本不會自己動任何鎖。
#   ⇒ **為什麼要留著這段字而不是靜靜刪掉**:下一個人若沒看到,會以為我們沒想過 pid 重用,
#     然後把自動回收加回來。**刪掉一段風險說明,等於刪掉不加回去的理由。**
#
set -u

LOCK_DIR="${PNPM_SERIAL_LOCK:-/tmp/pcm-pnpm-serial.lock}"
WAIT_MAX="${PNPM_SERIAL_WAIT:-240}"   # 🔴 240 而不是 1800:理由見檔頭「兩個逾時的順序」
WHO="${PNPM_SERIAL_WHO:-${USER:-unknown}@$$}"

if [ "$#" -eq 0 ]; then
  printf '用法: bash scripts/pnpm-serial.sh <pnpm 參數...>\n例:   bash scripts/pnpm-serial.sh typecheck\n' >&2
  exit 2
fi

acquired=0
cleanup() {
  if [ "$acquired" = 1 ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
    rm -rf "$LOCK_DIR"
  fi
}
trap cleanup EXIT INT TERM

waited=0
next_report=0   # 🔴 節流門檻;見下方 W6 must-fix ② 的註解
while :; do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    acquired=1
    printf '%s\n' "$$"  > "$LOCK_DIR/pid"
    printf '%s\n' "$WHO" > "$LOCK_DIR/who"
    date '+%Y-%m-%d %H:%M:%S' > "$LOCK_DIR/since"
    date '+%s'                   > "$LOCK_DIR/since_epoch"
    printf '%s\n' "$*"  > "$LOCK_DIR/cmd"
    break
  fi

  holder_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  holder_who="$(cat "$LOCK_DIR/who" 2>/dev/null || printf '?')"
  holder_cmd="$(cat "$LOCK_DIR/cmd" 2>/dev/null || printf '?')"

  # ── 🔴🔴 陳舊鎖:**只報,不自己動它**(2026-08-20 裁定乙)────────────────────
  #    本段原本會【自動回收】,而那一整族 bug 的唯一來源就是自動回收。經過兩版都沒關上:
  #      v1 直接 rm  ⇒ A 讀到 pid=H → rm → mkdir → 開始跑;
  #                    B(更早就讀到 H)→ **rm 掉 A 剛建的活鎖** → mkdir → 也開始跑
  #      v2 改用 mv  ⇒ ~~`mv` 對同一個來源只有一個人成功(第二個拿到 ENOENT)⇒ 刪不到別人剛建的鎖~~
  #         🔴🔴 **上面這句是假的,2026-08-20 實測推翻**:
  #            A 收回並【重建】鎖之後,那個名字底下【又有東西了】
  #            ⇒ B 那一刻才執行的 mv **會成功**,而它搬走的是 A 正在用的活鎖 ⇒ 兩個同時跑。
  #         📌 **原子性 ≠ 有效性**:`mv` 保證「同時搬同一個名字的人只有一個成功」,
  #            **不保證那個名字底下的東西還是我當初決定要刪的那一個。**
  #      v3 世代標記(mv 後比對 pid、搬錯就搬回去)⇒ 駁回:「搬回去」之前若有第三個人 mkdir
  #         ⇒ 放不回去 ⇒ **窗口更窄而仍然不是零**。而**把機率壓低與把它變成不可能是兩件事**。
  #    ⇒ **乙:整個拿掉自動回收。** 買到的是「省一個人工指令」,
  #      賣掉的是「這把鎖偶爾完全失效,而失效那一刻**沒有任何訊號** —— 兩個窗都以為自己拿到了」。
  #      而這支鎖的定位是**降低 CPU 爭用**、不是保護不可逆動作 ⇒ 它失效的後果 = 回到今晚之前。
  #    ⚠️ 而**這一段不 continue** —— 落到下面的等待與節流,所以症狀會**每 30 秒印一次**,
  #       不會有人等 30 分鐘才發現。
  # 🔴 而 W6 提的「取得鎖之後自檢 pid 是不是自己」在乙之下**不需要**:
  #    沒有任何路徑會搬走別人的鎖,所以不存在「被偷走」這件事。留著會是一道構造不出來的守門。
  if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
    stale_note=1
  else
    stale_note=0
  fi

  # pid 還沒寫出來(對方剛 mkdir 完) ⇒ 再看一次，不要當陳舊
  if [ -z "$holder_pid" ]; then
    sleep 1; waited=$((waited+1))
    [ "$waited" -lt "$WAIT_MAX" ] || {
      printf 'PNPM_SERIAL_TIMEOUT\n' >&2
      printf '等鎖逾時 %ss(對方剛取得、pid 未寫出) ⇒ 不執行 rc=75\n' "$WAIT_MAX" >&2
      printf 'rc=75 且【有】上面那行 PNPM_SERIAL_TIMEOUT ⇒ 沒輪到你;若 rc=75 而【沒有】那行 ⇒ 那是 pnpm 自己回的 75。\n' >&2
      exit 75
    }
    continue
  fi

  # 🔴 節流用 `next_report` 不用 `waited % 30`(W6 must-fix ②)。
  #    主迴圈 +2 ⇒ waited 恆偶數 ⇒ % 30 命中 30/60/90…;
  #    而「pid 還沒寫出來」那一支 **+1** ⇒ waited 從此恆為奇數 ⇒ **% 30 永遠不成立**
  #    ⇒ 那個窗**一行都不再印**,安靜等到逾時 —— 而它正好關掉「等鎖」與「掛住」的區別。
  #    📌 形狀:**一個為了正確性加的分支,順手改掉了一個【被別的邏輯當成不變量】的變數。**
  if [ "$waited" -ge "$next_report" ]; then
    next_report=$((next_report + 30))
    # 🔴 印【持有者已經跑了多久】,不是「前面還有幾個」(W6 丙,主視窗裁)。
    #    理由:「前面還有幾個」看起來有用而**不改變任何人的下一步**(排第 2 或第 4 你都是等);
    #    而「他在跑 test、已經 11 分鐘」會讓你去戳他,「跑 typecheck、20 秒」會讓你再等一下。
    held='?'
    holder_epoch="$(cat "$LOCK_DIR/since_epoch" 2>/dev/null || true)"
    if [ -n "$holder_epoch" ]; then held="$(( $(date '+%s') - holder_epoch ))s"; fi
    printf '等 pnpm 鎖 %ss — 現在是 %s 在跑「%s」,已經跑了 %s(自 %s)\n' \
      "$waited" "$holder_who" "$holder_cmd" "$held" \
      "$(cat "$LOCK_DIR/since" 2>/dev/null || printf '?')" >&2
    # 🔴 陳舊鎖的症狀 + **當場能執行的那一行**(不是「請聯絡某人」)。每 30 秒重印一次。
    # 🔴 ③ 讓「久到不合理」自己說出來,不要人自己算(W6 R3)。
    #    情境:某窗半夜 crash ⇒ 隔天第一個人被擋,而 who/since 指著一個【昨晚就不存在的 session】
    #    ⇒ 他會去找一個找不到的人,而不是去清鎖。
    if [ -n "$holder_epoch" ] && [ "$(( $(date '+%s') - holder_epoch ))" -gt 900 ]; then
      printf '⚠️ 這把鎖已經 %s 分鐘了 —— 持有者多半已經不在(例如那個窗昨晚就關了)。\n' \
        "$(( ($(date '+%s') - holder_epoch) / 60 ))" >&2
    fi
    if [ "$stale_note" = 1 ]; then
      printf '🔴 持有者 pid=%s 已不存在(鎖建於 %s)⇒ 這把鎖是陳舊的。本腳本【刻意不自動回收】。\n' \
        "$holder_pid" "$(cat "$LOCK_DIR/since" 2>/dev/null || printf '?')" >&2
      # 🔴 ② 先給一條【會回答問題】的命令,再給那條會動手的(W6 R3)。
      #    理由:執行清理的人是【已經被擋了十分鐘的人】——
      #    他之所以在這裡,正是因為他想跑 pnpm ⇒ **他的動機與「不要查」同方向**
      #    ⇒ 把「查一下」從【他要記得】移到【印在他眼前那一行】。
      printf '   先查(不要跳過):kill -0 %s 2>/dev/null && echo "還活著,不要清" || echo "確實死了,可以清"\n' "$holder_pid" >&2
      printf '   確定死了才執行:rm -rf %s\n' "$LOCK_DIR" >&2
    fi
  fi
  sleep 2; waited=$((waited+2))
  if [ "$waited" -ge "$WAIT_MAX" ]; then
    printf 'PNPM_SERIAL_TIMEOUT\n' >&2
    printf '等鎖逾時 %ss ⇒ 不執行(rc=75)。持有者 %s「%s」\n' "$WAIT_MAX" "$holder_who" "$holder_cmd" >&2
    printf 'rc=75 不是測試失敗，是沒輪到你 —— 不要據此判斷 code 有問題。\n' >&2
    printf '🔴 判準:rc=75 且【有】上面那行 PNPM_SERIAL_TIMEOUT ⇒ 沒輪到你;\n' >&2
    printf '   若 rc=75 而【沒有】那行 ⇒ 那是 pnpm 自己回的 75(實測:pnpm 會原樣傳回子行程 rc)。\n' >&2
    exit 75
  fi
done

# 🔴 TURBO_FORCE 預設開(2026-08-20 W4 實測抓到假綠):
#    照 `bash scripts/pnpm-serial.sh build` 直覺地跑 ⇒ 第一次得到 rc=0 而 **Cached: 2 cached, 2 total**
#    ⇒ 那是 turbo **replay 的舊綠**,不是這一版真的跑過(重跑帶 TURBO_FORCE=1 ⇒ 0 cached, 2 total)。
#    ⇒ 🔴 鐵則 11 那條「三綠一律加 TURBO_FORCE=1」與本鎖**原本沒有接起來** ——
#       而漏掉它的樣態是【綠】,不是紅 ⇒ 沒有任何東西會提醒你。
#    ⇒ ⇒ 所以預設由本腳本補上,讓【直覺的用法】就是正確的用法。
#    要刻意吃快取(例如只想確認 exit code、不在乎新鮮度)⇒ PNPM_SERIAL_NO_FORCE=1
if [ "${PNPM_SERIAL_NO_FORCE:-0}" = "1" ]; then
  printf '⚠️ PNPM_SERIAL_NO_FORCE=1 ⇒ 不帶 TURBO_FORCE,可能拿到 replay 的舊綠\n' >&2
else
  export TURBO_FORCE=1
fi

printf '取得 pnpm 鎖(%s) ⇒ pnpm %s (TURBO_FORCE=%s)\n' "$WHO" "$*" "${TURBO_FORCE:-unset}" >&2
pnpm "$@"
rc=$?
printf '釋放 pnpm 鎖(%s) ⇒ pnpm rc=%s\n' "$WHO" "$rc" >&2
exit $rc
