#!/bin/sh
# 四綠 RUN-CONTEXT 彙總 —— **唯讀**。撈出每一發的並行數與 rc,印成「並行數 × 紅綠」四格表。
#
# 用法:
#   sh scripts/four-greens-context-table.sh              # 掃 logs/four-greens/
#   sh scripts/four-greens-context-table.sh <目錄>        # 掃指定目錄（給 selftest 餵造好的資料）
#   sh scripts/four-greens-context-table.sh --selftest    # 只驗這支自己
#
# ── 🔴 它為什麼存在,以及它【不做】什麼 ──────────────────────────────────
# `#618`(vitest 隨機紅)要回答的是「紅與並行數有沒有關係」。
# 🔴 而**主視窗裁定不要刻意製造負載**,理由值得寫在這裡,因為它決定了本工具的形狀:
#   **你造的負載形狀是你選的**（N 發並行你的靶）,
#   **而真實的負載形狀是八個窗在做不同的事**（build / vitest / codex / playwright 混著）。
#   **若紅與「形狀」有關而不只與「數量」有關,刻意造出來的那一格會是一個【不存在的世界】。**
#   📎 同族:memory `feedback_green-in-a-world-that-cannot-happen`。
# ⇒ 所以這支是**被動收集**:樣本會自己來,本工具只負責【數現在有幾筆、四格各幾個】。
#
# 🔴 **它刻意不下結論。** 它不說「所以是負載造成的」——
#    四格都有樣本才談得上結論,而那件事由讀表的人判。
#
# ⚠️ **判停條件也寫在這裡(主視窗指定,它本身就是一個結論)**:
#    · 四格都有樣本 ⇒ 可以下結論
#    · 跑了幾小時仍然只有「低×綠」⇒ **那本身是一個發現**
#      (意思是:紅根本不常發生,而先前那三發紅可能是別的原因)
#    🔴 **不要讓「等不到」變成「去製造」。**
#
# ── ⚠️ 兩條射程限定 ────────────────────────────────────────────────────
#   1 `logs/` 在 `.gitignore` 裡 ⇒ **它只看得到【這台機器、這棵樹】跑過的**。
#     別窗的 run 在它們自己的工作樹裡 ⇒ 要合併分析得先把各窗的 RUN-CONTEXT 收到一起。
#   2 **這支儀器在同一晚長過三次**,所以歷史 RUN-CONTEXT 有四種完整度。
#     🔴 **四種【分開數、各自具名】,不合併成一個標籤、不補 0**:
#       欄位名未知        前兩版量具的舊欄位名 ⇒ 那些數字本身已作廢（見 `#618`）
#       僅vitest且rc未知  有 vitest 並行數、沒有 build 欄也沒有 rc 行
#       僅vitest          有 vitest 並行數與 rc、沒有 build 欄（build 欄 22:41 才加）
#       rc未知            兩個並行數都有、缺 rc 行（rc 行 22:5x 才加）
#     🔴 **補 0 會讓「沒量到」長得像「量到 0」** —— 而那正是本工具要服務的那份調查在防的事。
#     ⚠️ 我第一版把前兩種印成同一個「格式未知」⇒ **同一個標籤兩種意思**,
#        而那是今晚一直在修的病發生在這支工具自己身上。格5b/5c 就是為它加的。

set -e
CDPATH= cd "$(dirname "$0")/.."

# 純函式核心:吃一份 RUN-CONTEXT 的內容,印出「<vitest並行數> <build並行數> <紅綠>」。
# 抽出來【只為了讓 selftest 餵得到它】—— 這支檔的整個教訓就是 inline 的東西測不到。
# 印 `- - 格式未知` 表示這份不認識(舊格式/壞檔),**由呼叫端決定怎麼算,本函式不猜**。
parse_context() {
  # 🔴🔴 2026-08-18:欄位名換過一次,而**新舊兩把尺量的不是同一個東西** ——
  #    舊尺 `其他窗四綠…` 的標記檔落在【各自的工作樹】⇒ 它看不見別的窗 ⇒ **每一次都報 0**;
  #    新尺 `全樹並行四綠…` 的標記落在 git common dir 的共用點 ⇒ 才真的跨工作樹。
  #    ⇒ **兩者【絕不合併】,也絕不把舊尺的 0 當成「量到 0」** ——
  #      本檔檔頭自己就寫著「補 0 會讓『沒量到』長得像『量到 0』」,而舊尺整批就是那個形狀。
  #    ⇒ 舊尺的樣本一律標成 `舊尺(看不見別樹)`,不進四格表的並行分檔。
  _vnew="$(printf '%s\n' "$1" | sed -n 's/^全樹並行四綠vitest數(不含自己;[^)]*) .*vitest起跑前=\([0-9]*\).*/\1/p')"
  _bnew="$(printf '%s\n' "$1" | sed -n 's/^全樹並行四綠build數(不含自己;[^)]*) .*vitest起跑前=\([0-9]*\).*/\1/p')"
  _vold="$(printf '%s\n' "$1" | sed -n 's/^其他窗四綠vitest並行數(不含自己) .*vitest起跑前=\([0-9]*\).*/\1/p')"
  if [ -n "$_vold" ] && [ -z "$_vnew" ]; then echo "- - 舊尺(看不見別樹)"; return 0; fi
  _v="$_vnew"
  _b="$_bnew"
  _rc="$(printf '%s\n' "$1" | sed -n 's/^rc typecheck=\([0-9]*\) lint=\([0-9]*\) build=\([0-9]*\) vitest=\([0-9]*\)$/\1\2\3\4/p')"
  # 🔴 三種「不完整」要分開講,不可以用同一個標籤 ——
  #    我第一版把「舊欄位名」與「有 vitest 但沒有 build 欄」都印成「格式未知」,
  #    而那是兩件不同的事:前者沒有可用資料,後者【有 vitest 那半可用】。
  #    同一個標籤兩種意思 = 今晚一直在修的那個病,發生在這支工具自己身上。
  if [ -z "$_v" ]; then echo "- - 欄位名未知"; return 0; fi
  if [ -z "$_b" ]; then
    # build 那一欄是 22:41 才加的 ⇒ 更早的發次只有 vitest 那半。明說,不補 0（補 0 是猜）。
    if [ -z "$_rc" ]; then echo "$_v - 僅vitest且rc未知"; else echo "$_v - 僅vitest"; fi
    return 0
  fi
  if [ -z "$_rc" ]; then echo "$_v $_b rc未知"; return 0; fi
  case "$_rc" in
    0000) echo "$_v $_b 綠" ;;
    *)    echo "$_v $_b 紅" ;;
  esac
}

# 並行數分檔:0 算「低」,>=1 算「高」。
# 🔴 這個門檻是**任意選的**,而它必須被寫出來:**四格表的形狀取決於它**。
#    落筆當下沒有任何資料支持「1 就算高」—— 它只是「有沒有別人在跑」這個最粗的二分。
#    ⇒ 表頭會把它印出來,讀表的人才知道自己在看什麼。
CONCURRENCY_THRESHOLD=1
bucket_of() { if [ "$1" -ge "$CONCURRENCY_THRESHOLD" ] 2>/dev/null; then echo 高; else echo 低; fi; }

collect() {
  root="${1:-logs/four-greens}"
  lo_g=0; lo_r=0; hi_g=0; hi_r=0; unknown_rc=0; unknown_fmt=0; legacy=0; total=0
  only_v=0; only_v_norc=0
  for d in "$root"/*/; do
    [ -f "$d/RUN-CONTEXT" ] || continue
    total=$((total+1))
    set -- $(parse_context "$(cat "$d/RUN-CONTEXT")")
    v=$1; b=$2; verdict=$3
    case "$verdict" in
      欄位名未知)        unknown_fmt=$((unknown_fmt+1)); continue ;;
      rc未知)            unknown_rc=$((unknown_rc+1)); continue ;;
      僅vitest且rc未知)  only_v_norc=$((only_v_norc+1)); continue ;;
      僅vitest)          only_v=$((only_v+1)); continue ;;
      # 🔴 2026-08-18:少了這一行,舊尺的樣本會【掉進四格表】——
      #    `v` 是 `-`、`bucket_of -` 回「低」、`verdict` 不是「綠」⇒ 全部被算成【低×紅】。
      #    ⚠️ 我加完 parse_context 的新標籤【就以為做完了】,而呼叫端沒接 ——
      #    真表當場印「並行低 16 紅」才發現。**同一批改動裡的第三次「只改被指名那一處」。**
      舊尺*)             legacy=$((legacy+1)); continue ;;
    esac
    # 分檔用「vitest 與 build 之中較大的那個」—— 兩者搶同一批 CPU,只看一個會低估。
    m="$v"; [ "$b" -gt "$m" ] 2>/dev/null && m="$b"
    if [ "$(bucket_of "$m")" = 高 ]; then
      [ "$verdict" = 綠 ] && hi_g=$((hi_g+1)) || hi_r=$((hi_r+1))
    else
      [ "$verdict" = 綠 ] && lo_g=$((lo_g+1)) || lo_r=$((lo_r+1))
    fi
  done
  echo "掃描目錄     : $root"
  echo "帶 RUN-CONTEXT 的發次: $total"
  echo "門檻         : 並行數 >= $CONCURRENCY_THRESHOLD 算「高」(🔴 任意選的,見檔頭)"
  echo "分檔依據     : vitest 與 build 取【較大】那個"
  echo
  echo "            綠      紅"
  printf '並行低      %-7s %s\n' "$lo_g" "$lo_r"
  printf '並行高      %-7s %s\n' "$hi_g" "$hi_r"
  echo
  echo "不進四格(五種原因分開數,不合併成一個標籤):"
  echo "  欄位名未知        $unknown_fmt 發   前兩版量具的舊欄位名 ⇒ 那些數字本身已作廢(見 #618)"
  echo "  僅vitest且rc未知  $only_v_norc 發   有 vitest 並行數、沒有 build 欄也沒有 rc 行"
  echo "  僅vitest          $only_v 發   有 vitest 並行數與 rc、但沒有 build 欄(build 欄 22:41 才加)"
  echo "  rc未知            $unknown_rc 發   兩個並行數都有、缺 rc 行(rc 行 22:5x 才加)"
  echo "  🔴舊尺(看不見別樹) $legacy 發   2026-08-18 之前的量法:標記檔落在【各自的工作樹】"
  echo "                              ⇒ 它看不見任何別的窗 ⇒ 那些 0 是【構造上必然】不是量到的"
  echo "                              ⇒ 不得當成「並行 0 的樣本」;救不回來,只能重新收集。"
  echo "  🔴 這五種【不補 0、不猜】—— 補 0 會讓「沒量到」長得像「量到 0」。"
  echo
  # 🔴 判停條件由這支自己印出來 —— 寫在檔頭沒人讀,印在結果旁邊才會被看到。
  if [ "$lo_g" -gt 0 ] && [ "$lo_r" -gt 0 ] && [ "$hi_g" -gt 0 ] && [ "$hi_r" -gt 0 ]; then
    echo "🟢 四格都有樣本 ⇒ 可以開始談結論(而樣本數夠不夠,自己看上面那四個數)。"
  else
    echo "⚠️ 四格【還沒集滿】⇒ 不要下結論。"
    echo "   🔴 而「跑了幾小時仍然只有低×綠」本身就是一個發現 ——"
    echo "      意思是紅根本不常發生,而先前那幾發紅可能是別的原因。"
    echo "   🔴 不要讓「等不到」變成「去製造」:刻意造的負載形狀是你選的,"
    echo "      而真實負載是八個窗在做不同的事 —— 造出來的那一格可能是個不存在的世界。"
  fi
}

selftest() {
  pass=0; fail=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  # 格1-4:parse_context 的四個世界。**餵構造好的字串**,不去讀真的檔。
  ctx_new() { printf '開始 X\n結束 Y\n全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=%s vitest起跑前=%s 結束=%s\n全樹並行四綠build數(不含自己;2026-08-18 起跨工作樹) 開始=%s vitest起跑前=%s\nrc typecheck=%s lint=%s build=%s vitest=%s\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9"; }
  ck "格1 全綠 ⇒ 判綠,並行數取【vitest起跑前】那個" \
     "$(parse_context "$(ctx_new 9 2 9 9 3 0 0 0 0)")" "2 3 綠"
  ck "格2 vitest 非 0 ⇒ 判紅" \
     "$(parse_context "$(ctx_new 9 2 9 9 3 0 0 0 1)")" "2 3 紅"
  # 🔴 格3:紅【不只看 vitest】—— typecheck 紅也是紅。第一版只看第 4 個位置就會漏。
  ck "格3 typecheck 非 0 也算紅(不得只看 vitest 那一位)" \
     "$(parse_context "$(ctx_new 9 2 9 9 3 2 0 0 0)")" "2 3 紅"
  # 格4:缺 rc 那一行 ⇒ 明說 rc未知,**不猜**。
  #    ⚠️ 2026-08-18:本格的 fixture 原本用【舊欄位名】,而舊欄位名現在有它自己的分類
  #    ⇒ 若不改 fixture,這一格測到的會變成「舊尺」那條路,**而它要測的是缺 rc 那條**。
  #    ⇒ fixture 換成新欄位名;舊欄位名另立 `格4b` 專門守。
  old_ctx="$(printf '開始 X\n結束 Y\n全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=0 vitest起跑前=1 結束=0\n全樹並行四綠build數(不含自己;2026-08-18 起跨工作樹) 開始=0 vitest起跑前=2\n')"
  ck "格4 缺 rc 行 ⇒ 回 rc未知(不猜)" \
     "$(parse_context "$old_ctx")" "1 2 rc未知"
  # 🔴 格4b:**舊尺的樣本不得進四格表**(2026-08-18 跨工作樹修正)。
  #    舊尺的標記檔落在各自的工作樹 ⇒ 它看不見別的窗 ⇒ 那些 `0` 是【構造上必然】不是量到的。
  #    ⇒ 必須被標成 `舊尺(看不見別樹)`,而**不是**「並行 0」。
  #    ⚠️ 沒有這一格的話,舊樣本會被讀成「低並行」,而整欄的結論就建在一堆假 0 上。
  legacy_ctx="$(printf '開始 X\n結束 Y\n其他窗四綠vitest並行數(不含自己) 開始=0 vitest起跑前=0 結束=0\n其他窗四綠build並行數(不含自己) 開始=0 vitest起跑前=0\nrc typecheck=0 lint=0 build=0 vitest=0\n')"
  ck "格4b 舊欄位名 ⇒ 標成【舊尺】,不得當成並行 0 的綠樣本" \
     "$(parse_context "$legacy_ctx")" "- - 舊尺(看不見別樹)"
  # 格5:連並行數欄位都不認得(更舊的版本/壞檔)⇒ 格式未知。
  ck "格5 完全不認識的內容 ⇒ 回欄位名未知" \
     "$(parse_context "隨便一段東西")" "- - 欄位名未知"
  # 🔴 格5b/5c:「有 vitest 但沒有 build 欄」是【另一種】不完整,不得與格5 共用標籤。
  #    第一版兩者都印「格式未知」⇒ 同一個標籤兩種意思(今晚一直在修的那個病)。
  only_v_ctx="$(printf '開始 X\n結束 Y\n全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=0 vitest起跑前=3 結束=0\nrc typecheck=0 lint=0 build=0 vitest=0\n')"
  ck "格5b 有 vitest 欄、沒有 build 欄、有 rc ⇒ 回【僅vitest】而不是欄位名未知" \
     "$(parse_context "$only_v_ctx")" "3 - 僅vitest"
  only_v_norc_ctx="$(printf '開始 X\n結束 Y\n全樹並行四綠vitest數(不含自己;2026-08-18 起跨工作樹) 開始=0 vitest起跑前=4 結束=0\n')"
  ck "格5c 只有 vitest 欄、連 rc 都沒有 ⇒ 回【僅vitest且rc未知】" \
     "$(parse_context "$only_v_norc_ctx")" "4 - 僅vitest且rc未知"

  # 格6/7:bucket_of 的兩個世界(門檻那一格)。
  ck "格6 並行 0 ⇒ 低" "$(bucket_of 0)" "低"
  ck "格7 並行 1 ⇒ 高(門檻=1)" "$(bucket_of 1)" "高"

  # 格8-11:collect 的四格分類 —— 造一個假的 logs 目錄餵它,**不碰真的 logs/**。
  t="$(mktemp -d)"
  mkdir -p "$t/a" "$t/b" "$t/c" "$t/d"
  ctx_new 0 0 0 0 0 0 0 0 0 > "$t/a/RUN-CONTEXT"   # 低×綠
  ctx_new 0 0 0 0 0 0 0 0 1 > "$t/b/RUN-CONTEXT"   # 低×紅
  ctx_new 0 4 0 0 0 0 0 0 0 > "$t/c/RUN-CONTEXT"   # 高×綠（vitest 起跑前 4）
  ctx_new 0 0 0 0 5 0 0 0 1 > "$t/d/RUN-CONTEXT"   # 高×紅（build 那欄 5 ⇒ 取較大者）
  out="$(collect "$t")"
  ck "格8 低×綠 算 1" "$(printf '%s\n' "$out" | sed -n 's/^並行低 *\([0-9]*\) .*/\1/p')" "1"
  ck "格9 低×紅 算 1" "$(printf '%s\n' "$out" | sed -n 's/^並行低 *[0-9]* *\([0-9]*\)$/\1/p')" "1"
  ck "格10 高×綠 算 1" "$(printf '%s\n' "$out" | sed -n 's/^並行高 *\([0-9]*\) .*/\1/p')" "1"
  # 🔴 格11 是【分檔依據】那一格:d 那發 vitest 起跑前是 0、build 是 5
  #    ⇒ 只看 vitest 會把它歸成「低」。這一格釘住「取較大者」。
  ck "格11 高×紅 算 1(它只有 build 高 ⇒ 釘住『取較大者』)" \
     "$(printf '%s\n' "$out" | sed -n 's/^並行高 *[0-9]* *\([0-9]*\)$/\1/p')" "1"
  ck "格12 四格集滿 ⇒ 印可以談結論" \
     "$(printf '%s\n' "$out" | grep -c '四格都有樣本')" "1"

  # 格13 [負向對照]:只有一格有樣本 ⇒ 必須印「還沒集滿」與那兩句警告。
  t2="$(mktemp -d)"; mkdir -p "$t2/a"
  ctx_new 0 0 0 0 0 0 0 0 0 > "$t2/a/RUN-CONTEXT"
  out2="$(collect "$t2")"
  ck "格13 [負向對照] 只有低×綠 ⇒ 印【還沒集滿】" \
     "$(printf '%s\n' "$out2" | grep -c '四格【還沒集滿】')" "1"
  ck "格14 而且要印出【不要讓等不到變成去製造】那一句" \
     "$(printf '%s\n' "$out2" | grep -c '不要讓「等不到」變成「去製造」')" "1"
  # 格15:門檻要印在結果裡 —— 四格表的形狀取決於它,沒印出來讀表的人不知道在看什麼。
  ck "格15 門檻值要印在輸出裡" "$(printf '%s\n' "$out2" | grep -c '門檻')" "1"
  rm -rf "$t" "$t2"

  printf '\n合計  PASS=%s  FAIL=%s\n' "$pass" "$fail"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  '') collect ;;
  *) collect "$1" ;;
esac
