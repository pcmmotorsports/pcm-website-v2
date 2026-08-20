#!/bin/sh
# ============================================================
# 「現在有什麼東西是做完了(或做到一半了)而沒有人知道的?」
# ============================================================
# 2026-08-21 W9e 建。主視窗派工;成因來自同一夜連續撞到的 5 個實例:
#   ① E2b 四輪審完、已 apply,而 STATUS 寫「R3 排隊中」
#   ② 片0b 已推,而 STATUS 寫「待推」(且它自陳只做了一半)
#   ③ B1 兩支 migration 已套進報價單正式庫,而零 commit、零信箱檔
#   ④ storefront_catalog_v 的 COMMENT 已套進正式庫,而不在 ledger 裡
#   ⑤ 🔴 一包【專門為了給 Sean 挑而做的視覺決策題】(2026-08-12),做完 9 天,
#      而它只活在一棵沒人在的樹的一個【未追蹤檔】裡 ⇒ 他從來沒看到過。
#
# 🔴 五個的方向【完全相同】:**做完的事沒有訊號,而沒做完的事有一份看起來很完整的清單。**
#    我們的帳本天生只記「要做什麼」,不記「做了什麼」。
#
# ── 為什麼分母是【物理的】不是【文件的】────────────────────────
#   有人動過手而沒交出來 ⇒ **檔案系統上留著痕跡** ⇒ 不依賴任何人記得寫清單。
#   一份「待交清單」要有人記得維護它,而**忘記寫清單**正是這個病本身
#   ⇒ 拿清單當分母 = 拿病當量具。
#
# ── 🔴 這支【不回答】什麼(先講,因為它決定你怎麼讀輸出)────────────
#   它答的是「**這裡有東西沒交出來**」,**不是**「這一條還需不需要做」。
#   後者要人開檔判斷 —— 有些是刻意押著的、有些是別人正在做的、有些真的已經沒用了。
#   ⇒ **清單上的東西不等於待辦。** 這句話也印在輸出裡,不要只寫在這裡。
#
# ── exit code(對齊 where-is.sh / migration-ledger-divergence.sh 的 1/2/3)──
#   0 = 掃完了,沒有撈到未交的東西
#   3 = 撈到了(這是本工具的 finding,不是錯誤)
#   2 = 用法錯
#   1 = 工具自己壞了 / 掃不到(例:git 不在、repo 根推不出來、
#       **或你要求了 `--with-ledger` 而那一族量不到**)
#       🔴 掃不到回 1 不回 0 —— 「查不到」被讀成「沒問題」正是這個病本身。
#       🔴 **而我第一版就是回 0** —— 要求掃 ledger、掃不到、然後回「一切乾淨」。
#          我在一支專門講「沒訊號」的工具裡,親手做了一個沒訊號的洞。
#          2026-08-21 實測抓到並修;四個 exit code 現在**每一個都表演過**,不是只寫在這裡。
#
# ── 判別力保證(哪一格演過、哪一格沒有;不要混講)─────────────────
#   ✅ 演過:0 / 2 / 3 / 1 四個 exit code 各一發真跑
#   ✅ 演過:selftest 四個世界 + **一發突變**(改壞「未追蹤 .md」偵測 ⇒ 只有世界B轉紅)
#   ✅ 演過:`--with-ledger` 兩條分支都跑過 ——
#            有那支腳本 ⇒ 2026-08-21 對正式庫實跑(唯讀)⇒ 子閘回 3 ⇒ 本閘回 3
#            沒那支腳本 ⇒ 拋棄式 fixture repo ⇒ 印「沒有掃到,不是掃到 0」⇒ 本閘回 1
#   ⚠️ 子閘回 2(用法錯)那一格:~~我沒有構造出來~~ **更正(2026-08-21 自審)——
#      是【我的呼叫點構造不出來】,兩者是不同的宣稱。**
#      本檔呼叫它時**一個參數都不帶**(`:348`),而該閘只在「不認得的參數 / 多餘的參數」
#      時回 2(`migration-ledger-divergence.sh:87,90,93`)⇒ **今天不可達,不是我漏測。**
#      ⇒ 它要變成可達,得等 W5 改掉那支的參數契約;而屆時我這裡把它當「沒量到」⇒ exit 1,
#        **方向是對的** —— 呼叫錯了就是沒量到。⇒ 保留這個分支,不是死碼。
#
# ── 用法 ────────────────────────────────────────────────
#   sh scripts/unreported-work-scan.sh              掃本機所有 worktree
#   sh scripts/unreported-work-scan.sh --selftest   雙向表演(該撈到/該撈不到各一發)
#   sh scripts/unreported-work-scan.sh --with-ledger 另外呼叫 W5 的帳本分岔閘(要網路 + supabase CLI link)
#
# ── 🔴 第一次跑會看到什麼(先解釋掉那片紅,否則它會被當成「這工具很吵」)──────
#   本工具第一次上路時**就是紅的**,而那 4 棵是**真報**不是誤報。
#   🔴 一個第一次跑就紅、而沒有人先看過那份紅裡有什麼的工具,會被歸類成「吵」——
#      然後連真的紅也一起被略過。所以下面把它們一一交代掉。
#   ⚠️ **以下 4 棵的判讀是 W5/W3 盤的,我(W9e)沒有逐棵複驗** ⇒ 二手,標明。
#     · `pcm-site-redesign`  已結案 —— W5 已在那份未追蹤檔上加了指標行(指向已入 repo 的那份)
#     · `pcm-vitest-alias`   🔴 **真的要做** —— 兩件都還沒進 dev
#     · `pcm-w3-guards`      W3 判定為殘留
#       ⚠️ **而我這次實跑看到的是 9 項【已追蹤檔被改】,不是 W5 描述的「3 支未追蹤」**
#          ⇒ 兩者對不上。可能是時間差、也可能是我們數的東西不同。**引用前自己重跑。**
#     · `pcm-w4-review2`     1 支未追蹤、dev 上沒有
#   📌 這 4 棵清掉之後,這支工具的常態輸出應該只剩主樹那一格(而主樹判準見下)。
#
# ── 🔴 抓不到什麼(不假裝覆蓋)─────────────────────────────
#   · **只在對話裡的東西,這支撈不到。** 一個窗在訊息裡講完就沒落檔 ⇒ 檔案系統零痕跡。
#     (W3 已經標過這一格。這是本工具的天花板,不是漏寫。)
#   · **已經 commit 且已經推上去的東西**,這支不會撈 —— 而「推了 ≠ 做完了」那一族
#     (實例②:片0b 推了而自陳只做一半)**它看不見**。那要讀檔內容,不是看 git 狀態。
#   · **套進資料庫而沒進 repo 的**(實例③④)⇒ 那是 `--with-ledger` 那半,而它只涵蓋
#     A 庫的 migration ledger;**報價單那個庫、以及任何非 migration 的手動 DDL,不在射程內**。
#   · 別台機器上的樹、已經被 `git worktree remove` 掉的樹 ⇒ 掃不到。
#   · 🔴 **它撈到的是【訊號】不是【結論】** —— dirty 的樹可能是別人此刻正在打字。
#
# 🔴 GIT_INDEX_FILE 的坑(W5 2026-08-21 實際弄壞過一次 commit,我照它的修法):
#   若本檔哪天被 hook / lint-staged 叫起來,會繼承外層那次 commit 的 GIT_INDEX_FILE
#   ⇒ selftest 裡的 `git add` 會寫進【外層那次 commit 的 index】
#   ⇒ 症狀是「一個不存在的檔壞掉了」,而沒有任何一行指向這裡。
unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

set -u

FOUND=0        # 撈到幾條
SCANNED=0      # 掃了幾棵(分母:沒有分母的計數不可引用)
WITH_LEDGER=0

usage() {
  echo "用法: sh scripts/unreported-work-scan.sh [--selftest|--with-ledger]" >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --selftest)    MODE=selftest ;;
    --with-ledger) WITH_LEDGER=1 ;;
    *)             usage ;;
  esac
done
MODE="${MODE:-scan}"

command -v git >/dev/null 2>&1 || { echo "🔴 工具自壞:找不到 git" >&2; exit 1; }

# 主樹用:只留下「超過 STALE_DAYS 天沒被碰過」的檔。
# 🔴 用**檔案自己的 mtime**,不是樹的最後 commit 日期 —— 理由見 scan_one_tree 內那段。
# ⚠️ 讀不到 mtime 的檔(剛被刪、權限問題)⇒ **保留它**,不要靜靜丟掉
#    (丟掉 = 拿一個「量不到」當成「沒問題」,正是本工具在講的那個病)。
STALE_DAYS=3
# 🔴 第二個門檻,只為了【把敏感度印出來】,不參與判定。
#    選 7 是因為它跨過「一週」這個人會自然想到的界線 —— 而它同樣沒有被量過,
#    **它的用途是當對照,不是當更好的答案。**
STALE_DAYS_ALT=7

# 🔴🔴 **`stat -f %m` 與 `date -j -f` 都是 BSD(macOS)專屬** —— Linux 的 GNU coreutils
#   要的是 `stat -c %Y` / `date -d`。實測(2026-08-21,macOS):`stat -c` ⇒ `illegal option`。
#   ⚠️ **而它壞掉的方向正好是我剛剛移除的那個狀態**:
#     · `stat` 失敗 ⇒ 每個檔都落到「讀不到 mtime,保留」⇒ 主樹又變回整片紅
#     · `date` 失敗 ⇒ 每棵樹的「放了幾天」標記整個消失 ⇒ 新舊工作又分不開
#   ⇒ **兩個 fail-safe 疊起來 = 悄悄退回舊行為,而沒有任何一行說它退化了。**
#   ⇒ 所以這裡**先問一次量具在不在**,不在就**大聲講**(而不是讓它靜靜地退化)。
#     🔴 我沒有裝 GNU 版的 fallback —— 我手上沒有 Linux 可以驗它,
#        **而裝一個我驗不了的分支,就是本 repo 記過的那件事**(#2b 那格的同款)。
MTIME_OK=1
if [ -z "$(stat -f %m "$0" 2>/dev/null || true)" ]; then
  MTIME_OK=0
  echo "🔴 這台機器的 \`stat -f %m\` 不能用(非 BSD/macOS?)" >&2
  echo "   ⇒ **主樹的『放著沒動幾天』判準【量不到】** ⇒ 它會退化成列出全部 dirty。" >&2
  echo "   ⇒ 這不是「主樹很亂」,是**這支工具在這台機器上少了一把尺**。" >&2
fi

filter_stale() {
  # 🔴 門檻走【第三個參數】,不用 `VAR=x filter_stale …` 那種前綴賦值 ——
  #    對 shell **函式**而言那個賦值會不會只在函式內生效,各家 sh 行為不一致
  #    ⇒ 可能污染到外層的 STALE_DAYS,而症狀是「主判定悄悄用了對照組的門檻」。
  _fs_dir="$1"; _fs_list="$2"; _fs_days="${3:-$STALE_DAYS}"
  [ -z "$_fs_list" ] && return 0
  _now=$(date +%s)
  _oi="$IFS"; IFS='
'
  for _f in $_fs_list; do
    _m=$(stat -f %m "$_fs_dir/$_f" 2>/dev/null || echo "")
    if [ -z "$_m" ]; then
      echo "$_f  (讀不到 mtime,保留)"
    else
      _d=$(( (_now - _m) / 86400 ))
      [ "$_d" -ge "$_fs_days" ] && echo "$_f  (${_d} 天沒動)"
    fi
  done
  IFS="$_oi"
}

# ── 掃一棵樹 ────────────────────────────────────────────
# 印出這棵樹上「有東西沒交出來」的訊號。回傳 0 = 乾淨,1 = 有東西。
scan_one_tree() {
  _dir="$1"
  _is_main="${2:-0}"
  _hit=0

  [ -d "$_dir" ] || { echo "  ⚠️  $_dir 不見了(worktree 記著而目錄沒了)"; return 1; }

  # 🔴🔴 **共用主樹用不同的判準,而這【不是】為了讓輸出好看** ────────────────
  #   主樹是七個窗共同施工的地方 ⇒ 它**永遠**有 dirty、**永遠**有未推的 commit。
  #   照其他樹的判準去報它,它就是一個【恆真項】——
  #   而恆真項不是「每次要重新解釋」的成本問題,是**它會訓練人略過整份輸出**(W5 更正我的)。
  #
  #   ⇒ 兩格分開處置,各有各的理由:
  #   ① **未推的 commit:主樹【不算 finding】** ——
  #      `CLAUDE.md:89` 逐字:「**不自動 push**:commit + busboy-end 後**不 push**、
  #      Sean 手動推=review checkpoint」。**未推是【被設計成這樣】的狀態,不是異常。**
  #      把它報成「沒人知道的工作」是**分類錯誤**:那些 commit 是知道的,而且是刻意在等他。
  #      ⇒ 仍然印出來當**背景資訊**,但不進 FOUND、不讓工具變紅。
  #   ② **dirty:改用【每個檔自己的 mtime】,不是整棵樹的最後 commit 日期** ——
  #      主樹天天有人 commit ⇒ 樹的日期永遠是今天 ⇒ 那把尺在這裡沒有判別力。
  #      而**一個放著沒動超過 N 天的檔**,在一棵活躍的樹裡仍然是「有人做了一半走了」。
  #      ⇒ 主樹只報「**超過 ${STALE_DAYS} 天沒被碰過**」的那幾個檔。
  #
  #   🔴 **它換掉之後,主樹真的出事時我們會不會知道?**
  #      · 會:本工具要抓的失效(做完了而沒人知道)在主樹上的形狀就是
  #        **一個躺著沒動的檔**(實例⑤那包決策題正是這個形狀)⇒ mtime 抓得到。
  #      · ❌ **不會的那半,寫出來**:一個檔【今天】剛被改、然後那個人就走了 ——
  #        它在 ${STALE_DAYS} 天內看起來與「有人正在打字」完全一樣,**本工具分不出來**。
  #        ⇒ 這一格要等 ${STALE_DAYS} 天後才會浮出來。**它是延遲偵測,不是偵測不到。**
  #      · ❌ 未推的 commit 若真的被遺忘(不是在等 Sean),本工具**不會**報它 —— 見①的取捨。

  # 訊號 A:未追蹤的 .md —— 🔴 這正是實例⑤的形狀
  #   為什麼單獨拉出來:未追蹤的文件【沒有任何人看得到】,
  #   而被改過的已追蹤檔至少在 git status 上是顯眼的。兩者嚴重度不同。
  _untracked_md=$(git -C "$_dir" status --porcelain 2>/dev/null | sed -n 's/^?? //p' | grep '\.md$' || true)
  [ "$_is_main" = 1 ] && _untracked_md=$(filter_stale "$_dir" "$_untracked_md")
  if [ -n "$_untracked_md" ]; then
    echo "  🔴 未追蹤的 .md(沒有人看得到它):"
    echo "$_untracked_md" | sed 's/^/       /'
    _hit=1
  fi

  # 訊號 B:其他 dirty(已追蹤檔被改、或非 .md 的未追蹤檔)
  if [ "$_is_main" = 1 ]; then
    # 主樹:只報「放著沒動 ≥ STALE_DAYS 天」的檔(理由見上面那段)
    _paths=$(git -C "$_dir" status --porcelain 2>/dev/null | grep -v '^?? .*\.md$' | cut -c4- || true)
    _stale=$(filter_stale "$_dir" "$_paths")
    if [ -n "$_stale" ]; then
      _n=$(echo "$_stale" | wc -l | tr -d ' ')
      echo "  ⚠️  $_n 項放著超過 ${STALE_DAYS} 天沒動(前 5 項):"
      echo "$_stale" | head -5 | sed 's/^/       /'
      _hit=1
    fi
    # 🔴🔴 **同時印第二個門檻,讓讀的人自己看這個數字敏不敏感**(W3 審 MF-1)。
    #   為什麼不是「去量一個對的值」:要量就得先有「做一半」的真值,
    #   而那個真值只有【每個窗自己】知道(那個檔是放棄了還是明天要接)。
    #   ⇒ 我造不出那個真值,**而造一個出來會是一個看起來有依據的假權威**。
    #   ⇒ 所以改成把敏感度攤開:兩個門檻的數字都印,差異大就自己去看。
    #   📌 出處要記:`STALE_DAYS=3` 來自 `W3-PP:55`「建議 3」,而 **W3 自陳那個 3
    #      沒有任何量測、沒有任何理由**(2026-08-21)⇒ **它不是一個被驗過的門檻。**
    _stale_alt=$(filter_stale "$_dir" "$_paths" "$STALE_DAYS_ALT")
    _na=$(echo "$_stale_alt" | grep -c . || true)
    _nn=$(echo "$_stale" | grep -c . || true)
    if [ "$_na" != "$_nn" ]; then
      echo "  📏 門檻敏感度:≥${STALE_DAYS} 天 ⇒ $_nn 項 / ≥${STALE_DAYS_ALT} 天 ⇒ $_na 項"
      echo "     🔴 **兩個數字不一樣 ⇒ 這個門檻正在改變答案,而它沒有被量過。**"
    else
      echo "  📏 門檻敏感度:≥${STALE_DAYS} 與 ≥${STALE_DAYS_ALT} 天都是 $_nn 項(這一格不敏感)"
    fi
  else
    _other_dirty=$(git -C "$_dir" status --porcelain 2>/dev/null | grep -v '^?? .*\.md$' || true)
    if [ -n "$_other_dirty" ]; then
      _n=$(echo "$_other_dirty" | wc -l | tr -d ' ')
      echo "  ⚠️  另有 $_n 項改動未 commit(前 5 項):"
      echo "$_other_dirty" | head -5 | sed 's/^/       /'
      _hit=1
    fi
  fi

  # 訊號 C:有 commit 而沒推上去(領先 origin/dev 且不是 dev 本身)
  #   🔴 用 origin/dev 當基準,而不是「這個分支自己的 upstream」——
  #      施工窗的分支多半沒有 upstream,問 upstream 會回空而那個空看起來像乾淨。
  if git -C "$_dir" rev-parse --verify -q origin/dev >/dev/null 2>&1; then
    _ahead=$(git -C "$_dir" rev-list --count origin/dev..HEAD 2>/dev/null || echo "?")
    if [ "$_ahead" != "?" ] && [ "$_ahead" -gt 0 ] 2>/dev/null; then
      if [ "$_is_main" = 1 ]; then
        # 🔴 主樹的未推 commit **不算 finding**(CLAUDE.md:89:Sean 手動推 = review checkpoint)
        #    ⇒ 印出來當背景,不設 _hit。**「等他推」與「沒人知道」是兩件事。**
        echo "  ℹ️  領先 origin/dev $_ahead 顆 —— **主樹的未推是設計如此**(等 Sean 手動推=review checkpoint)"
        echo "      ⇒ 不算 finding。要它變成 finding,得先有人定義「等太久」是幾天。"
      else
        echo "  ⚠️  領先 origin/dev $_ahead 顆(沒被收割?):"
        git -C "$_dir" log --oneline origin/dev..HEAD 2>/dev/null | head -3 | sed 's/^/       /'
        _hit=1
      fi
    fi
  else
    echo "  ⚠️  這棵樹看不到 origin/dev ⇒ 「領先幾顆」這一格【沒有量到】,不是量到 0"
  fi

  return $_hit
}

run_scan() {
  _root="$1"
  echo "── 掃描:有東西做了而沒交出來嗎 ──"
  echo "   分母 = 本機 git worktree 清單(當場取得,不是寫死的名單)"
  echo ""

  _trees=$(git -C "$_root" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
  if [ -z "$_trees" ]; then
    # 🔴 **單引號**:這句話裡有 `git worktree list` 這個字面,而**雙引號內的反引號會被執行**
    #    (CLAUDE.md 逐字記過這個坑)。實測:寫成雙引號時它真的去跑了一次 git,
    #    而那行字變成「工具自壞: 回空」—— **主詞不見了,句子還讀得通**,
    #    外加一行來路不明的 `fatal: not a git repository` 噴在旁邊,
    #    ⇒ 在【這道閘正要說明出了什麼事】的那一刻,它自己把說明弄壞。2026-08-21 自審修。
    echo '🔴 工具自壞:`git worktree list` 回空 —— 掃不到任何樹' >&2
    exit 1
  fi

  # 🔴 IFS 換行:worktree 路徑可能含空白
  # 🔴 `git worktree list` 的**第一筆就是主工作樹**(git 自己保證的順序,不是我猜的)
  _main_tree=$(echo "$_trees" | head -1)

  _oldifs="$IFS"; IFS='
'
  for _t in $_trees; do
    SCANNED=$((SCANNED + 1))
    _mainflag=0
    [ "$_t" = "$_main_tree" ] && _mainflag=1
    _out=$(scan_one_tree "$_t" "$_mainflag"); _rc=$?
    if [ $_rc -ne 0 ]; then
      FOUND=$((FOUND + 1))
      _br=$(git -C "$_t" branch --show-current 2>/dev/null || echo '?')

      # 🔴 最後 commit 日期(W3 規格必要項 1):**沒有日期就分不出「今天在做」與「放了九天」。**
      #    這支不判斷該不該做,但它要把【判斷得了的人需要的那一格】交出來。
      _last=$(git -C "$_t" log -1 --format=%ad --date=short 2>/dev/null || echo '?')
      _age=""
      if [ "$_last" != "?" ] && [ -n "$_last" ]; then
        _lsec=$(date -j -f "%Y-%m-%d" "$_last" +%s 2>/dev/null || echo "")
        if [ -n "$_lsec" ]; then
          _days=$(( ( $(date +%s) - _lsec ) / 86400 ))
          if [ "$_days" -ge 3 ]; then
            _age=" ⇒ 🔴 放了 ${_days} 天(不是今晚的工作)"
          else
            _age=" ⇒ ${_days} 天內(可能有人正在打字)"
          fi
        fi
      fi

      echo "🔴 $_t"
      _tag=""
      [ "$_mainflag" = 1 ] && _tag=" · 🏠 共用主樹(判準不同,見檔頭)"
      echo "  (分支 ${_br:-detached} · 最後 commit $_last$_age$_tag)"
      echo "$_out"
      echo ""
    fi
  done
  IFS="$_oldifs"
}

# ── selftest:雙向表演 ──────────────────────────────────
# 🔴 一把只會說「乾淨」的尺,和一把壞掉的尺,輸出一模一樣。
#    所以【該撈到的要餵一發、該撈不到的也要餵一發】,兩發都印。
run_selftest() {
  _tmp=$(mktemp -d "${TMPDIR:-/tmp}/w9e-unreported-XXXXXX") || { echo "🔴 mktemp 失敗" >&2; exit 1; }
  trap 'rm -rf "$_tmp"' EXIT INT TERM
  _fail=0

  # 世界 A:乾淨的樹 ⇒ 必須【撈不到】
  _a="$_tmp/clean"
  mkdir -p "$_a" && git -C "$_a" init -q 2>/dev/null
  git -C "$_a" config user.email w9e@local; git -C "$_a" config user.name w9e
  echo hi > "$_a/a.txt"; git -C "$_a" add a.txt 2>/dev/null
  git -C "$_a" commit -qm init 2>/dev/null
  if scan_one_tree "$_a" >/dev/null 2>&1; then
    echo "  PASS 世界A [乾淨的樹] ⇒ 撈不到"
  else
    echo "  🔴 FAIL 世界A [乾淨的樹] ⇒ 竟然撈到了(假陽性)"; _fail=1
  fi

  # 世界 B:有未追蹤 .md 的樹 ⇒ 必須【撈到】(這是實例⑤的形狀)
  _b="$_tmp/dirty-md"
  mkdir -p "$_b" && git -C "$_b" init -q 2>/dev/null
  git -C "$_b" config user.email w9e@local; git -C "$_b" config user.name w9e
  echo hi > "$_b/a.txt"; git -C "$_b" add a.txt 2>/dev/null
  git -C "$_b" commit -qm init 2>/dev/null
  echo "# 一包沒人看得到的決策題" > "$_b/docs-decision-package.md"
  if scan_one_tree "$_b" >/dev/null 2>&1; then
    echo "  🔴 FAIL 世界B [未追蹤 .md] ⇒ 沒撈到(假陰性 —— 這正是實例⑤那個檔的形狀)"; _fail=1
  else
    echo "  PASS 世界B [未追蹤 .md] ⇒ 撈到了"
  fi

  # 世界 C:已追蹤檔被改 ⇒ 必須【撈到】
  _c="$_tmp/dirty-tracked"
  mkdir -p "$_c" && git -C "$_c" init -q 2>/dev/null
  git -C "$_c" config user.email w9e@local; git -C "$_c" config user.name w9e
  echo hi > "$_c/a.txt"; git -C "$_c" add a.txt 2>/dev/null
  git -C "$_c" commit -qm init 2>/dev/null
  echo changed >> "$_c/a.txt"
  if scan_one_tree "$_c" >/dev/null 2>&1; then
    echo "  🔴 FAIL 世界C [已追蹤檔被改] ⇒ 沒撈到"; _fail=1
  else
    echo "  PASS 世界C [已追蹤檔被改] ⇒ 撈到了"
  fi

  # 世界 D:目錄不存在 ⇒ 必須【撈到】並說它不見了(不可以靜靜當成乾淨)
  if scan_one_tree "$_tmp/does-not-exist" >/dev/null 2>&1; then
    echo "  🔴 FAIL 世界D [樹不見了] ⇒ 被當成乾淨(掃不到被讀成沒問題)"; _fail=1
  else
    echo "  PASS 世界D [樹不見了] ⇒ 撈到了"
  fi

  echo ""
  if [ $_fail -eq 0 ]; then
    echo "── selftest: 4 PASS / 0 FAIL"; return 0
  else
    echo "── 🔴 selftest 有 FAIL ⇒ 這支尺不可信,它印的東西不要引用"; return 1
  fi
}

# ── main ────────────────────────────────────────────────
if [ "$MODE" = selftest ]; then
  run_selftest || exit 1
  exit 0
fi

# 🔴 repo 根從【腳本自己的位置】推,不是從「你人在哪」推
#    (同 where-is.sh 的形狀,連同它那個方向性警告一起繼承:
#     在別的 repo 底下呼叫它,它會跑去掃這個 repo 的 worktree 清單。)
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || { echo "🔴 推不出腳本位置" >&2; exit 1; }
ROOT=$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null) || {
  echo "🔴 工具自壞:$SELF_DIR 不在 git repo 裡,推不出 repo 根" >&2; exit 1; }

run_scan "$ROOT"

LEDGER_UNMEASURED=0
if [ "$WITH_LEDGER" = 1 ]; then
  echo "── migration 帳本分岔(轉呼 W5 的閘,不重造)──"
  if [ -f "$ROOT/scripts/migration-ledger-divergence.sh" ]; then
    sh "$ROOT/scripts/migration-ledger-divergence.sh"; _lrc=$?
    echo "   (那支自己的 exit code = $_lrc;3 = 有分岔)"
    case "$_lrc" in
      0) : ;;                            # 對得上
      3) FOUND=$((FOUND + 1)) ;;         # 有分岔 = 撈到了
      *)
        # 🔴 它回 1(量不到平台帳本)或 2(用法錯)⇒ **這一族沒有被量到**。
        #    不可以吞掉:吞掉的話我會拿一個「沒量到」去湊成一個「全部乾淨」。
        echo "   🔴 那支回 $_lrc(非 0/3)⇒ 帳本這一族【沒有量到】,不是量到 0"
        LEDGER_UNMEASURED=1 ;;
    esac
  else
    echo "   ⚠️ 找不到 scripts/migration-ledger-divergence.sh ⇒ 這一族【沒有掃到】,不是掃到 0"
    LEDGER_UNMEASURED=1
  fi
else
  echo "── ⚠️ migration 帳本那一族【本次沒有掃】──"
  echo "   要掃:sh scripts/unreported-work-scan.sh --with-ledger(需網路 + supabase CLI link)"
  echo "   不預設跑的理由:它要連線,而一支會因為沒網路就變紅的掃描器,會被習慣性略過。"
fi

echo ""
# 🔴 **第二道(W3 審 MF-2)**:上面 `-z "$_trees"` 已經擋過一次,而這一道擋的是
#    「未來有人重構掉那道閘」。理由是本檔 `:400-403` 自己寫下的那條 ——
#    **【沒量到】絕不可以落到 0**。我對【帳本】那一族實作了它,而【樹列舉】這一族
#    —— 本工具存在的理由 —— 當時只有一道。**知道 ≠ 執行,而這次是同一支檔裡的事。**
if [ "$SCANNED" -le 0 ]; then
  echo '🔴 工具自壞:一棵樹都沒掃到,而前面沒有攔下來 ⇒ 這份輸出不可引用' >&2
  exit 1
fi
echo "── 掃了 $SCANNED 棵樹,撈到 $FOUND 棵有東西沒交出來 ──"
echo ""
echo "🔴 清單上的東西【不等於待辦】。這支只答『這裡有東西沒交出來』,"
echo "   不答『這一條還需不需要做』—— 有些是刻意押著的、有些是別人此刻正在打字。"
echo "   要判斷,開檔看。"
echo "🔴 而【只在對話裡】的東西這支撈不到 —— 檔案系統上零痕跡。這是天花板,不是漏寫。"

# 🔴 順序是承重的:「撈到東西」比「有一族沒量到」更該讓人看到 ⇒ 3 先於 1。
#    而【沒量到】絕不可以落到 0 —— 你要求掃的東西沒被掃,回「一切乾淨」就是說謊。
#    (W5 的帳本閘檔頭逐字:「量不到就回 1,不回 0 —— 查不到被讀成沒問題正是這個病本身。」
#     🔴 我第一版就是回 0,自己踩了自己這支工具在講的那件事,2026-08-21 實測後修。)
[ "$FOUND" -gt 0 ] && exit 3
[ "$LEDGER_UNMEASURED" = 1 ] && {
  echo "🔴 exit 1:你要求掃 migration 帳本,而那一族【沒有量到】⇒ 不回 0(那會被讀成一切乾淨)"
  exit 1
}
exit 0
