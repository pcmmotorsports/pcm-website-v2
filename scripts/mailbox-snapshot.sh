#!/usr/bin/env bash
# mailbox-snapshot — 把 ~/pcm-mailbox 照相存一份, 因為那裡【沒有版控】。
#
# 用法:
#   bash scripts/mailbox-snapshot.sh              照一張
#   bash scripts/mailbox-snapshot.sh --selftest   離線自檢(不碰真的信箱)
#
# exit code (三態分得開是硬要件, 對齊 scripts/where-is.sh):
#   0 = 成功           1 = 工具自壞(來源不存在/空/複製不完整/磁碟)      2 = 用法錯
#   🔴 「工具自壞」與「照到了但內容有問題」必須是不同的碼 ——
#      合流的話, 一個 rc=0 會同時代表兩件相反的事。
#
# 🔴 為什麼不在 ~/pcm-mailbox 跑 `git init`(主視窗 2026-08-30 裁, 理由是今天踩過的):
#    本 repo 有多支腳本【從自己的位置往上爬找 repo root】(`where-is.sh` /
#    `admin-probe/up.sh` 都是這個形狀)⇒ 那裡多一個 `.git` 之後,
#    在 mailbox 底下呼叫的腳本會【安靜地】把那裡當成 repo。
#
# ⚠️ 它不是版控 —— 射程印在每次輸出的末尾, 不躺在這裡。
#
# 🔴 --selftest 演到的四個世界:正常 / 空來源(突變) / 來源不存在 / 參數亂打。
#    ⚠️ 而【它沒有演到】的一格, 寫在這裡不藏:**「cp 成功但複製不完整」那條路**
#       (檔數對不上 ⇒ rc=1 且不刪任何舊快照)—— 我構造不出一個穩定的世界來演它
#       (要在複製途中改動來源, 那是 race)。
#    ⇒ ⇒ 那段碼【存在而沒有被證明會紅】。引用本工具時不得把它算成「已驗過的守門」。


set -u

SRC="${MAILBOX_SRC:-$HOME/pcm-mailbox}"
SNAP_ROOT="${MAILBOX_SNAP_ROOT:-$HOME/pcm-mailbox-snapshots}"

# 🔴 N=24 的理由(寫出來, 不留「感覺」):
#    主視窗的存檔節拍是【每小時】⇒ 24 份 = 涵蓋完整一天。
#    而本工具要防的那個病(範圍取代吃掉一整節), 今天的實例都是【幾小時內】
#    被下一步撞到的 ⇒ 一天的射程夠, 更多份只是佔磁碟。
#    ✅ 而它的【成本】是量到的(2026-08-30):`du -sh ~/pcm-mailbox` ⇒ **132M**
#       ⇒ 24 份 ≈ **3.2G**;當時 `df` 顯示家目錄可用 **278Gi** ⇒ 約佔 **1.1%**。
#    ⚠️ 而【24 這個數本身】沒有量測背書 —— 有量測的是「24 份的代價可以接受」,
#       不是「24 份剛好夠」。改它不需要問任何人。
#    🔴 兩者差一格, 而混起來會變成「這個數是算出來的」—— 它不是。
KEEP="${MAILBOX_SNAP_KEEP:-24}"

die_tool() { printf '🔴 工具自壞:%s\n' "$1" >&2; exit 1; }
die_usage() { printf '🔴 用法錯:%s\n' "$1" >&2; exit 2; }

count_files() {
  # 只數【檔案】, 不數目錄。目錄不存在時回 0 而不是報錯 —— 由呼叫端判。
  d="$1"
  if [ -d "$d" ]; then
    find "$d" -type f | wc -l | tr -d ' '
  else
    printf '0\n'
  fi
}

print_scope() {
  cat <<'SCOPE'

──────────────────────────────────────────────────────────
🛑 它【不是版控】—— 這一段印在你眼前, 不躺在檔頭:
   · 它答得出「某個時間點那個目錄長什麼樣」
   · 🔴 它答【不】出「是誰改的 / 改了什麼 / 為什麼」
   · 兩份快照【之間】發生的事, 它一格都看不到
   · 它只照 MAILBOX_SRC 那一個目錄 —— 別的 repo、別的信箱、工作樹都不在裡面
──────────────────────────────────────────────────────────
SCOPE
}

snapshot() {
  [ -d "$SRC" ] || die_tool "來源目錄不存在:$SRC"
  n_src=$(count_files "$SRC")
  # 🔴 空來源要【叫】, 不能靜靜產生一份空快照 ——
  #    那正是本工具要防的形狀:一個乾淨的 rc=0, 而裡面什麼都沒有。
  [ "$n_src" -gt 0 ] || die_tool "來源目錄是空的(0 個檔):$SRC ⇒ 不產生快照"

  mkdir -p "$SNAP_ROOT" || die_tool "建不出快照根目錄:$SNAP_ROOT"
  stamp=$(date '+%Y%m%d-%H%M%S')
  dest="$SNAP_ROOT/$stamp"
  [ -e "$dest" ] && die_tool "目的地已存在(同一秒重跑?):$dest"

  cp -R "$SRC" "$dest" > /dev/null 2>&1 ; RC=$?
  # 🔴 `$?` 只認【緊接在後面】那一行 —— 中間不准有任何東西(連純指派都會蓋掉)。
  if [ "$RC" -ne 0 ]; then
    rm -rf "$dest"
    die_tool "cp 回 rc=$RC ⇒ 已清掉半成品 $dest"
  fi

  n_dst=$(count_files "$dest")
  # 🔴 驗「複製完整」不用「指令沒報錯」—— 比兩個數。
  if [ "$n_src" != "$n_dst" ]; then
    rm -rf "$dest"
    die_tool "檔數對不上:來源 $n_src / 快照 $n_dst ⇒ 已清掉那份不完整的快照, 且【沒有刪任何舊快照】"
  fi

  printf '✅ 快照 %s\n   來源 %s(%s 個檔)⇒ 快照 %s(%s 個檔)\n' \
    "$stamp" "$SRC" "$n_src" "$dest" "$n_dst"

  # ── 保留最近 N 份 ────────────────────────────────────────────
  # 🔴 「刪舊的」不可逆, 而它的前提是【新的那份是好的】⇒ 這裡再擋一次。
  [ "$n_dst" -gt 0 ] || die_tool "內部矛盾:快照檔數 0 而上面檢查過了 ⇒ 不刪任何舊快照"

  total=$(ls -1 "$SNAP_ROOT" | wc -l | tr -d ' ')
  if [ "$total" -le "$KEEP" ]; then
    printf '   現有 %s 份 / 上限 %s ⇒ 這一輪沒有東西要刪\n' "$total" "$KEEP"
  else
    LIST=$(mktemp) || die_tool "mktemp 失敗"
    ls -1 "$SNAP_ROOT" | sort | head -n "$((total - KEEP))" > "$LIST"
    # 🔴 迴圈一律 while read —— zsh 對未加引號的變數【不】斷詞(本 repo 已記)
    while IFS= read -r old; do
      [ -n "$old" ] || continue
      rm -rf "${SNAP_ROOT:?}/$old" && printf '   刪掉舊快照 %s\n' "$old"
    done < "$LIST"
    rm -f "$LIST"
  fi

  # 🔴 2026-08-31:這一段是【跑它的人要付什麼】—— 而它先前只印「刪掉舊快照 X」
  #    成因(哨兵量到):一小時內【四個不同的行為者】各自跑了它一次 ⇒ 燒掉 5 格,
  #    而它設計是每小時 1 格 ⇒ 覆蓋從 24 小時掉到約 18 小時。
  #    📌 而沒有人是粗心:它名字叫 snapshot、輸出是兩個數字, **看起來像唯讀**;
  #       而「再跑一次看清楚」是一個人在不確定時最自然的反應。
  #    ⇒ 所以它自己要說出來, 不能靠別人記得。
  oldest=$(ls -1 "$SNAP_ROOT" | sort | head -1)
  newest=$(ls -1 "$SNAP_ROOT" | sort | tail -1)
  now_total=$(ls -1 "$SNAP_ROOT" | wc -l | tr -d ' ')
  printf '\n🔴 這一支【會永久刪掉歷史】—— 它不是唯讀的\n'
  printf '   目前 %s / %s 份 · 最舊 %s · 最新 %s\n' "$now_total" "$KEEP" "$oldest" "$newest"
  printf '   ⇒ 你能回查的最早時點就是【最舊那一份】; 每多跑一次, 那個時點就往後移一格。\n'
  printf '   🛑 【再跑一次看清楚】不是免費的。要看清楚 ⇒ 把輸出導進檔案再讀, 不要重跑。\n'
  print_scope
  return 0
}

# 判定一格:兩個世界要印不同的東西 ⇒ 這裡把【實得】與【期望】比完才印字,
# 🔴 不印任何無條件的結論標籤(那句話在不成立時照樣印, 就是一個恆真的守門)。
verdict() {
  if [ "$1" = "$2" ]; then printf '✅'; else printf '🔴'; fi
}

selftest() {
  base=$(mktemp -d) || die_tool "mktemp 失敗"
  t_src="$base/src"; t_snap="$base/snap"
  mkdir -p "$t_src" "$t_src/sub"
  # 🔴 負對照字面【現造】—— 一個被用過的負對照, 已經散在別的檔裡了(本 repo 已記)
  NEG="ZZQ$$-$(date '+%s')-nowhere"
  printf '%s\n' "這是正對照內容 POSCTRL-$$" > "$t_src/a.md"
  printf '%s\n' "巢狀檔也要被照到" > "$t_src/sub/b.md"

  printf '=== --selftest:四個世界必須印不同的東西 ===\n'

  # 世界一:正常來源
  MAILBOX_SRC="$t_src" MAILBOX_SNAP_ROOT="$t_snap" MAILBOX_SNAP_KEEP=5 bash "$0" > /dev/null 2>&1 ; RC1=$?
  POS=$(grep -rl "POSCTRL-$$" "$t_snap" 2>/dev/null | wc -l | tr -d ' ')
  NEGHIT=$(grep -rl "$NEG" "$t_snap" 2>/dev/null | wc -l | tr -d ' ')
  AFTER1=$(ls -1 "$t_snap" 2>/dev/null | wc -l | tr -d ' ')
  POSOK=0; [ "$POS" -ge 1 ] && POSOK=1
  printf '  世界一 正常來源     rc=%s %s   正對照命中 %s %s   負對照命中 %s %s\n' \
    "$RC1" "$(verdict "$RC1" 0)" "$POS" "$(verdict "$POSOK" 1)" "$NEGHIT" "$(verdict "$NEGHIT" 0)"

  # 世界二(突變):來源是空目錄 —— 它必須叫, 而且【不得多出一份空快照】
  mkdir -p "$base/empty"
  MAILBOX_SRC="$base/empty" MAILBOX_SNAP_ROOT="$t_snap" bash "$0" > /dev/null 2>&1 ; RC2=$?
  AFTER2=$(ls -1 "$t_snap" 2>/dev/null | wc -l | tr -d ' ')
  printf '  世界二 空來源(突變) rc=%s %s   快照份數 %s→%s %s\n' \
    "$RC2" "$(verdict "$RC2" 1)" "$AFTER1" "$AFTER2" "$(verdict "$AFTER2" "$AFTER1")"

  # 世界三:來源不存在(與「空」是兩個不同的訊息, 而 rc 相同 —— 這一格刻意留著)
  MAILBOX_SRC="$base/nowhere" MAILBOX_SNAP_ROOT="$t_snap" bash "$0" > /dev/null 2>&1 ; RC3=$?
  printf '  世界三 來源不存在   rc=%s %s\n' "$RC3" "$(verdict "$RC3" 1)"

  # 世界四:參數亂打 ⇒ 它必須與「工具自壞」分得開
  bash "$0" --這不是參數 > /dev/null 2>&1 ; RC4=$?
  printf '  世界四 參數亂打     rc=%s %s\n' "$RC4" "$(verdict "$RC4" 2)"

  rm -rf "$base"
  if [ "$RC1" -eq 0 ] && [ "$POSOK" -eq 1 ] && [ "$NEGHIT" -eq 0 ] \
     && [ "$RC2" -eq 1 ] && [ "$AFTER2" = "$AFTER1" ] \
     && [ "$RC3" -eq 1 ] && [ "$RC4" -eq 2 ]; then
    printf '⇒ selftest PASS(四個世界印出不同的答案, 而突變那一格沒有多出空快照)\n'
    return 0
  fi
  printf '⇒ selftest FAIL —— 上面標 🔴 的那一格就是壞掉的那一格\n' >&2
  return 1
}

case "${1:-}" in
  '')          snapshot ;;
  --selftest)  selftest ;;
  -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
  *)           die_usage "不認得的參數:$1(只吃 空參數 / --selftest / --help)" ;;
esac
