#!/usr/bin/env bash
# launch-blocking-count.sh — 數 docs/launch-todo.md 上「擋上線?」token 的分布。
#
# ══ 為什麼是一支腳本, 不是表格的一欄(2026-09-06 tidy 立;主視窗 -f1 裁 Q-tidy1=乙)══
# Sean 2026-09-06 18:5x 要的是「一張自己數得出來的板子」。而板上 755 個有態的列
# 分屬 42 張表, 其中一張(K 節)只有 4 欄 ⇒ 真的加第六欄 = 碰到每一列
# ⇒ 今晚七個窗都在寫板列, 那一顆必撞。
# ⇒ 折衷:值以 token 形式寫進【最後一格】的開頭, 由本支數出來。
#
# ══ 🔴 天花板(先讀, 不要把它讀得比它大)══════════════════════════════════
#  ① 它數的是【token 有沒有寫】, 不是【判得對不對】。判錯擋不擋在這裡零訊號。
#     ⇒ 這正是判準把預設偏向 `未判` 的理由(錯標「不擋」沒有回饋路徑)。
#  ② 🔴 它讀【最後一格】, 而 board-state-consistency.py 已量到板上 24% 的列
#     【不以 `|` 結尾】而 Markdown 照樣渲染 ⇒ 本支兩種行尾都處理, 且把
#     兩種形狀各數幾列印出來 —— 少了那兩個數, 「我漏讀了一整族」與「那族是空的」
#     印同一個東西。
#  ③ 分母 = 態欄落在封閉集的列。態欄不在封閉集的列會被算進 `態不在封閉集`
#     那一格並【印出來】, 不是安靜地不算。
#     🔴 封閉集是【五個】值:open / doing / parked / done / standing。
#        `standing` 是 2026-09-05 Sean 拍板加的第五個(`docs/launch-todo.md:199` 那節)。
#        🛑 本支第一版【只寫了四個】⇒ 那 3 列 standing 被算進「態不在封閉集」那一格,
#        而那一格的數字從 77 變 80 —— **它照樣印, 而沒有人會知道那 3 是什麼。**
#        📌 判別句:**一個「其他」的計數變大, 與「板子髒了」印同一個東西。**
#        ⇒ 是 board-state-consistency.py 數 761 而本支數 758 才撞出來的:
#          **兩把尺不一致才有訊號;只有一把尺的時候, 錯的那個數看起來很正常。**
#  ④ 它不連 DB、不連網、唯讀。
#
# 用法:
#   bash scripts/launch-blocking-count.sh            數 docs/launch-todo.md
#   bash scripts/launch-blocking-count.sh <檔>       數指定檔
#   bash scripts/launch-blocking-count.sh --selftest 兩個世界自檢

set -u

TOK_BLOCK='⟨擋'
TOK_NOBLOCK='⟨不擋'
TOK_UNJUDGED='⟨未判'
TOK_NA='⟨—⟩'

count_file() {
  awk -v tb="$TOK_BLOCK" -v tn="$TOK_NOBLOCK" -v tu="$TOK_UNJUDGED" -v tna="$TOK_NA" '
    function trim(s){ sub(/^[ \t]+/,"",s); sub(/[ \t]+$/,"",s); return s }
    /^\| / {
      line=$0
      # 🔴 板上有 138 列用 `\|` 跳脫(那是【正確】的寫法)。awk 沒有 lookbehind ⇒
      #    先把跳脫的分隔符換成一個不會出現在內容裡的佔位字元, 切完再換回來。
      #    🛑 少了這一步:切出來的「最後一格」是錯的 —— 2026-09-06 實測 82 列因此少算。
      esc=line; gsub(/\\\|/, "\001", esc)
      n=split(esc, f, "|")
      for (q=1; q<=n; q++) gsub(/\001/, "\\|", f[q])
      state=trim(f[2])
      if (state!="open" && state!="doing" && state!="parked" && state!="done" && state!="standing") {
        if (state!="態") notclosed++
        next
      }
      rows++
      if (esc ~ /\|[ \t]*$/) { tail_pipe++; last=f[n-1] } else { tail_nopipe++; last=f[n] }
      last=trim(last)
      hit="none"
      if (index(last, tna)==1)      hit="na"
      else if (index(last, tn)==1)  hit="noblock"
      else if (index(last, tb)==1)  hit="block"
      else if (index(last, tu)==1)  hit="unjudged"
      c[state "/" hit]++
      tot[hit]++
      st[state]++
    }
    END {
      printf "資料列(態在封閉集)  %d\n", rows+0
      printf "態不在封閉集(未算)  %d\n", notclosed+0
      printf "行尾有 |            %d\n", tail_pipe+0
      printf "行尾沒有 |          %d\n", tail_nopipe+0
      print  "----"
      printf "擋                  %d\n", tot["block"]+0
      printf "不擋                %d\n", tot["noblock"]+0
      printf "未判                %d\n", tot["unjudged"]+0
      printf "—(done 不適用)     %d\n", tot["na"]+0
      printf "還沒填 token        %d\n", tot["none"]+0
      print  "----"
      for (s in st) {
        printf "%-7s 共 %4d ⇒ 擋 %4d · 不擋 %4d · 未判 %4d · — %4d · 未填 %4d\n", \
          s, st[s], c[s"/block"]+0, c[s"/noblock"]+0, c[s"/unjudged"]+0, c[s"/na"]+0, c[s"/none"]+0
      }
    }
  ' "$1"
}

selftest() {
  # 🔴 selftest 第一件事:剝掉繼承來的 git 環境(自檢清單;git -C 擋不住它)
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE

  local d rc_a rc_b out_a out_b
  d=$(mktemp -d) || return 2

  # ── 世界 A:token 都填好了 ────────────────────────────────────────────
  {
    printf '%s\n' '| 態 | # | 事 | 誰 | 卡什麼 |'
    printf '%s\n' '|---|---|---|---|---|'
    printf '%s\n' '| open | ⟦x-A⟧ | 甲 | 誰 | ⟨擋(tidy 判)⟩ 客人付不了錢 |'
    printf '%s\n' '| open | ⟦x-B⟧ | 乙 | 誰 | ⟨不擋(tidy 判)⟩ 內部效率'
    printf '%s\n' '| parked | ⟦x-C⟧ | 丙 | 誰 | ⟨未判(tidy · a)⟩ 關閉條件那支檔沒開 |'
    printf '%s\n' '| done | ⟦x-D⟧ | 丁 | 誰 | ⟨—⟩ 已完成 |'
    printf '%s\n' '| standing | ⟦x-F⟧ | 己 | 誰 | ⟨擋(tidy 判)⟩ 常設而殘餘碰錢 |'
    # 🔴 跳脫分隔符那一族(2026-09-06 實錘:82 列曾因此被少算)
    printf '%s\n' '| open | ⟦x-G⟧ | 庚 | 誰 | ⟨擋(tidy 判)⟩ 內文含 `a\\|b\\|c` 而 token 在最後一格 |'
    printf '%s\n' '| open | ⟦x-H⟧ | 辛 | 誰 | 內文含 `a\\|b\\| ⟨擋(壞)⟩ c` 而 token 卡在跳脫中間 |'
    printf '%s\n' '| 亂寫 | ⟦x-E⟧ | 戊 | 誰 | 態不在封閉集 |'
  } > "$d/a.md"

  # ── 世界 B:同一份, 而第一列的 token 被拿掉 ─────────────────────────
  # 🔴 只改【那一列】—— 第一版用全域 sed, 而它把 standing 那列的 token 也拿掉了
  #    ⇒ 世界 B 變成「兩列未填」, 而我期望的是「一列未填」⇒ 自檢當場 FAIL。
  #    📌 那正是本檢查該有的行為:改壞 fixture 與改壞被測物, 在 rc 上長得一樣, 所以要釘期望值。
  sed '/⟦x-A⟧/s/⟨擋(tidy 判)⟩ //' "$d/a.md" > "$d/b.md"

  out_a=$(count_file "$d/a.md"); rc_a=$?
  out_b=$(count_file "$d/b.md"); rc_b=$?

  local fail=0
  _need() {
    local world="$1" pat="$2" body="$3"
    if printf '%s\n' "$body" | grep -qE "$pat"; then
      printf '  ✅ %s  %s\n' "$world" "$pat"
    else
      printf '  🔴 %s  %s  ← 沒印出來\n' "$world" "$pat"; fail=1
    fi
  }

  echo "== 世界 A(token 都填好)=="
  printf '%s\n' "$out_a" | sed 's/^/    /'
  _need A '^擋 +3$'            "$out_a"
  _need A '^還沒填 token +1$'  "$out_a"    # x-H:token 卡在跳脫中間 ⇒ 不該被數到
  _need A '^資料列\(態在封閉集\) +7$' "$out_a"
  _need A '^standing 共 +1'    "$out_a"
  _need A '^不擋 +1$'          "$out_a"
  _need A '^未判 +1$'          "$out_a"
  _need A '^—\(done 不適用\) +1$' "$out_a"

  _need A '^態不在封閉集\(未算\) +1$' "$out_a"
  _need A '^行尾沒有 \| +1$'   "$out_a"

  echo "== 世界 B(第一列的 ⟨擋⟩ 被拿掉)=="
  printf '%s\n' "$out_b" | sed 's/^/    /'
  _need B '^擋 +2$'            "$out_b"
  _need B '^還沒填 token +2$'  "$out_b"

  echo "== 兩個世界必須印不同的東西 =="
  if [ "$out_a" = "$out_b" ]; then
    echo "  🔴 兩個世界印一樣 ⇒ 這把尺沒有判別力"; fail=1
  else
    echo "  ✅ 不同"
  fi

  [ "$rc_a" -eq 0 ] || { echo "  🔴 世界 A rc=$rc_a"; fail=1; }
  [ "$rc_b" -eq 0 ] || { echo "  🔴 世界 B rc=$rc_b"; fail=1; }

  rm -rf "$d"
  if [ "$fail" -eq 0 ]; then echo "SELFTEST PASS"; return 0; fi
  echo "SELFTEST FAIL"; return 1
}

main() {
  if [ "${1:-}" = "--selftest" ]; then selftest; return $?; fi

  local target="${1:-docs/launch-todo.md}"
  if [ ! -f "$target" ]; then
    echo "🔴 查無:$target"; return 2
  fi

  local sha when
  sha=$(git rev-parse --short HEAD 2>/dev/null) || sha="不在 git 樹上"
  when=$(date '+%Y-%m-%d %H:%M %Z')

  echo "檔案 $target"
  echo "量測 sha $sha · 時點 $when"
  echo "===================================="
  count_file "$target"
  echo "===================================="
  echo "🔴 這些數字是【那顆 sha 上的快照】, 不是這份檔的性質。引用前重跑。"
  echo "🔴 它數的是 token 有沒有寫, 不是判得對不對。"
}

main "$@"
