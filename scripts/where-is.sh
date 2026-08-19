#!/bin/sh
# where-is — 「我引用的這個檔到底在不在?不在的話是誰手上?」
#
# 用法:
#   bash scripts/where-is.sh docs/security/2026-08-17-xxx.md
#   bash scripts/where-is.sh --selftest
#
# exit code:  0=有命中(在某處找得到)   3=查無   2=用法錯   1=它自己壞了(setup 失敗等)
#   🔴 **查無刻意用 3 不用 1,而理由不是「逼人讀輸出」** ——
#      R2 實測推翻了那個說法:`rc=3` 之下 `where-is x && echo 存在` **一樣短路**,與 `rc=1` 行為相同。
#      3 真正買到的是:**「查無(3)」/「你用錯(2)」/「工具自己壞了(1)」三種分得開。**
#      拿 1 當查無的話,工具崩潰與「檔不存在」會回同一個碼。
#
# ── 🔴 它存在的理由(2026-08-17 實錘)────────────────────────────────────
# 主視窗轉了一條出處路徑給我,我落檔後才查,`git ls-files` 零命中 ⇒ 我寫「全樹不存在」。
# **而那個檔一直都在** —— 它在 `customers` 分支上,**從沒進過 dev**。
# 🔴 **`git ls-files` / `test -e` 看的是【當前 checkout】,不是整個 repo。**
# 成因全文 `docs/lessons-learned.md` §12-43。
#
# ── ⚠️ 這支自己的射程(code-reviewer 2026-08-17 打出來的,逐條寫在這裡)────
#   · ③ 掃 **分支 + remote-tracking + tag**(`refs/heads/` + `refs/remotes/` + `refs/tags/`)。
#     🔴 R2 C2:上一版漏了 tag,而判決句寫「任何 ref」⇒ 只在 tag 上的檔會被判成不存在。
#     🔴 remote-tracking 只反映**上次 `git fetch` 的狀態** —— 沒 fetch 過的新分支它看不到。
#   · ④ 信箱是**輔助訊號,不算「檔存在」** —— 它只證「有人提過這個字串」。
#     ⇒ ④ 命中**不會**取消「①②③ 皆查無」那個判決。
#   · ④ 掃的是 `~/pcm-mailbox/**/*.md`(含子目錄),用 `grep -F` **比對你給的完整路徑字面**。
#     打錯字、或信裡只寫檔名沒寫路徑 ⇒ 它就掃不到。**這一格漏報是常態,不是異常。**
#   · 它**不**判斷那個檔該不該存在,也**不**替你決定要不要收割那支分支。
#
# ── 🔴🔴 本工具的分母【不含 Open Design】(2026-08-17 晚,C 窗實錘)──────────
#   OD 專案的檔**不在 git 裡**,而本工具四格全部在 git 與信箱裡找
#   ⇒ **對設計產物下「查無」會是一個【假的查無】**,而上面那句判決讀起來像掃遍了所有地方。
#
#   實例(可重跑):
#     bash scripts/where-is.sh design-reference/shipping-picking-doc-a4.html
#     ⇒ ①工作樹 ✗ ②dev ✗ ③所有 ref ✗(掃了 48 支,含 tag)④信箱 ✗(掃了 3009 封)
#     **而它一直在 OD 專案 `pcm-print-docs` 裡、571 行。**
#   那次差點造成的錯:`§4b` 的「樣張沒答這一條,是新設計」——
#   而樣張 `:291` 逐字就寫著做法。**它不只是找不到檔,是會讓人去發明一個已經存在的東西。**
#
#   ⇒ **對任何【設計產物】下「查無」之前,先跑 OD:**
#       `list_projects` → `search_files`(換兩種以上叫法) → `get_file`
#     判別句:**我要找的東西,它的家是 git 嗎?** 不是 ⇒ 這支工具的四個 ✗ 什麼都沒證明。
#
# ── 🔴🔴 本工具的分母【只有一個 repo】(2026-08-20 W6 發現 + W5 實查加深)──────────
#   它查的那棵樹是從**腳本自己的位置**推的(`cd "$(dirname "$0")/.."`),
#   **不是** `git rev-parse --show-toplevel`、**也不是你現在人在哪**。
#   ⇒ 你在報價單 repo 底下跑 `bash ~/pcm-website-v2/scripts/where-is.sh <path>`,
#     它會**安靜地**跑去 pcm-website-v2 找,然後回「查無」——**而你以為你在查手上這個 repo**。
#   實錘:W6 拿五個真實存在、只是住在報價單 repo 的路徑餵它 ⇒ **全數回「不存在」**。
#   ⇒ 本機是多 repo 的(報價單 / 老闆腦 / design-reference 各自是獨立的 git)
#     ⇒ **跨 repo 路徑不是邊緣情況,是常態。**
#   ⇒ 修法:①結論句印出它到底查了哪一棵樹 ②從樹外呼叫時**開頭就警告**(不等你讀到結論)。

set -e
ORIG_PWD=$(pwd)
# 🔴 `$0` 是【未解析的字串】,而下一行就 cd 走了 ⇒ 相對呼叫時它會失效。
#    R2 實測:`cd docs && bash ../scripts/where-is.sh --selftest` ⇒ cp 失敗、零測試結果。
#    而「複製到別處再突變」正是本 repo 的突變驗證流程 ⇒ 那個修的目的會達不到。
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
cd "$(dirname "$0")/.."
REPO=$(pwd)
MAILBOX="${WHERE_IS_MAILBOX:-$HOME/pcm-mailbox}"
# 🔴 只給「你人在不在這棵樹裡」的比較用。用 `pwd -P` 解掉 symlink ——
#    macOS 的 $TMPDIR 就是 /var/folders → /private/var/folders 的 symlink,
#    純字串比對會在那裡給出一個【假的方向性警告】,而假警告會訓練人忽略真警告。
ORIG_PWD_P=$(cd "$ORIG_PWD" 2>/dev/null && pwd -P) || ORIG_PWD_P=$ORIG_PWD
REPO_P=$(cd "$REPO" 2>/dev/null && pwd -P) || REPO_P=$REPO

# 把使用者給的路徑換算成 repo 相對路徑。
# 🔴 為什麼要這一步:本檔開頭 `cd` 到 repo root,而使用者可能是從 `docs/` 底下呼叫的
#    ⇒ 不換算的話,一個【真的存在】的相對路徑會被重新解讀成別的東西,然後印「四處皆查無」。
#    (code-reviewer 2026-08-17 M1:`cd docs && bash ../scripts/where-is.sh sub/x.md` ⇒ 假查無)
# 「這個路徑在【任何我們掃得到的地方】存在嗎」—— resolve_target 用它當判準。
# 🔴 R2 C1:上一版用 `[ -e ]`(只看工作樹)當判準,而「不在工作樹」正是本工具的存在理由
#    ⇒ 檔只在別的 ref 上時,換算會回退成錯的那個候選,然後【無聲】印查無。
seen_anywhere() {
  [ -e "$1" ] && return 0
  for r in $(all_refs); do
    git ls-tree -r --name-only "$r" -- "$1" 2>/dev/null | grep -q . && return 0
  done
  return 1
}

all_refs() { git for-each-ref --format='%(refname:short)' refs/heads/ refs/remotes/ refs/tags/ 2>/dev/null; }

resolve_target() {
  case "$1" in
    /*) printf '%s' "${1#"$REPO"/}" ;;                    # 絕對路徑 ⇒ 去掉 repo 前綴
    *)  if [ "$ORIG_PWD" = "$REPO" ]; then printf '%s' "$1"
        else
          cand="${ORIG_PWD#"$REPO"/}/$1"
          if seen_anywhere "$cand"; then printf '%s' "$cand"; else printf '%s' "$1"; fi
        fi ;;
  esac
}

where_is() {
  raw=$1
  target=$(resolve_target "$raw")
  echo "───── where-is: $target ─────"
  echo "(本 repo:$REPO ← 🔴 本工具【只】查這一棵樹)"
  # 🔴 方向性警告:它查的樹是從腳本位置推的,與「你人在哪」無關 ⇒ 兩者不同時要【開頭就講】,
  #    不能等使用者讀到結論 —— 而他跑這支的時機,正好是他要下「這個不存在」那種斷言的時候。
  case "$ORIG_PWD_P" in
    "$REPO_P"|"$REPO_P"/*) : ;;
    *)
      echo "🔴🔴 方向性警告:你人在 $ORIG_PWD_P,而本工具查的是 $REPO_P —— 這是【兩個不同的 repo】。"
      echo "   ⇒ 底下所有 ✗ 都只是說「$REPO_P 裡沒有」,對你手上那個 repo 什麼都沒證明。"
      ;;
  esac
  [ "$target" = "$raw" ] || echo "(你給的是 \`$raw\`;從 $ORIG_PWD 呼叫 ⇒ 換算成 repo 相對路徑)"
  echo "(掃四處:工作樹 / dev / 所有 ref(分支・remote-tracking・tag) / 信箱;每一處各自報,不合併成一個是非題)"
  exists=0      # ①②③ 任一命中 —— 只有這個算「檔存在」
  mentioned=0   # ④ 命中 —— 只是「有人提過」，不算存在

  echo
  echo "① 工作樹(當前 checkout)"
  if [ -d "$target" ]; then
    echo "   ⚠️ 它是【目錄】不是檔案 —— 本工具是為單一檔案路徑設計的,以下各格結果照字面比對"
    exists=1
  elif [ -e "$target" ]; then
    echo "   ✅ 有 —— $(wc -l < "$target" | tr -d ' ') 行"
    exists=1
  else
    echo "   ✗ 沒有(這【只代表當前 checkout】,往下看)"
  fi

  echo
  echo "② dev 分支"
  if ! git rev-parse --verify --quiet dev >/dev/null; then
    echo "   ⚠️ 這個 repo 沒有叫 dev 的分支 ⇒ 本格【沒掃】,不要當成「dev 上沒有」"
  elif git ls-tree -r --name-only dev -- "$target" | grep -q .; then
    echo "   ✅ 在 dev 上"
    exists=1
  else
    echo "   ✗ dev 上沒有"
  fi

  echo
  echo "③ 所有 ref(分支 + remote-tracking + tag;🔴 這一格就是今天那個坑)"
  refs=$(all_refs | grep -v '^dev$' || true)
  n_refs=$(printf '%s\n' "$refs" | grep -c . || true)
  if [ "$n_refs" = 0 ]; then
    echo "   ⚠️ 一支 ref 都列不出來 ⇒ 本格【沒掃】(這裡是不是 git repo?)"
  else
    found=0
    for b in $refs; do
      if git ls-tree -r --name-only "$b" -- "$target" 2>/dev/null | grep -q .; then
        ahead=$(git rev-list --count dev.."$b" 2>/dev/null || echo '?')
        echo "   ✅ $b (tip $(git rev-parse --short "$b"), 領先 dev $ahead 顆)"
        found=1; exists=1
      fi
    done
    # 🔴 只列「dev 以外」的 ref —— 不然 dev 上的檔會列出全部 ref、真答案被洗版
    [ "$found" = 0 ] && echo "   ✗ dev 以外沒有任何 ref 有它(掃了 $n_refs 支;含 tag)"
  fi

  echo
  echo "④ 信箱 $MAILBOX(🔴 輔助訊號,【不算】檔存在)"
  if [ ! -d "$MAILBOX" ]; then
    echo "   ⚠️ 信箱目錄不存在 ⇒ 本格【沒掃】—— 不要當成「沒提過」"
  else
    total=$(find "$MAILBOX" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
    # -F 固定字串:basename 裡的 `.` 當 regex 會匹配任意字元(reviewer M3)
    # 比對完整路徑而不是檔名:不同目錄的同名檔不該算命中(reviewer M2/M3)
    names=$(find "$MAILBOX" -name '*.md' -type f -exec grep -lF -- "$target" {} + 2>/dev/null || true)
    n_hit=$(printf '%s\n' "$names" | grep -c . || true)
    if [ "$n_hit" != 0 ]; then
      printf '%s\n' "$names" | head -5 | sed 's|^|   ✅ 提過:|'
      [ "$n_hit" -gt 5 ] && echo "   …(共 $n_hit 封,只印前 5 封)"
      mentioned=1
    else
      echo "   ✗ 信箱沒提過這個【完整路徑】字面(掃了 $total 封;信裡若只寫檔名,這格就掃不到)"
    fi
  fi

  echo
  if [ "$exists" = 0 ]; then
    echo "🔴 ①②③ 皆查無 ⇒ 這個路徑在【本 repo($REPO)的 工作樹 / dev / 本機掃得到的所有 ref(分支・remote-tracking・tag)】上都不存在。"
    echo "   ⚠️ 掃不到的:別台機器上未 push 的分支、未 fetch 的遠端分支、stash、別的 worktree 專屬 ref。"
    echo "   🔴 也掃不到:【別的 repo】—— 報價單 / 老闆腦 / design-reference 各自是獨立的 git,本工具一格都沒碰。"
    [ "$mentioned" = 1 ] && echo "   ⚠️ 但信箱提過它 ⇒ 可能是【還沒被建出來】或【路徑字面寫錯】,不是「沒人提過這件事」。"
    echo "   掃過的分母就是上面①②③④那四格;它是【字面比對】,不做模糊匹配。"
    return 3
  fi
  echo "📌 有命中。🔴 **引用時要帶【它在哪一格】** ——"
  echo "   「在 <branch> 上、尚未收割進 dev」與「不存在」是兩件完全不同的事,"
  echo "   而 2026-08-17 它們被混成同一句話過一次(§12-43)。"
  return 0
}

# ── selftest ────────────────────────────────────────────────────────────
# 🔴 它在【自己造的拋棄式 repo】上跑,不吃任何生產分支的狀態。
#    上一版把探針綁在「那個檔只在 customers 上」這個【會過期的世界狀態】——
#    reviewer 實測:那批一收割,格2 就假紅,而紅的原因不是 bug。
selftest() {
  pass=0; fail=0; skip=0
  ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1";
         else fail=$((fail+1)); printf 'FAIL  %s  得到「%s」預期「%s」\n' "$1" "$2" "$3"; fi; }

  tmp=$(mktemp -d) || { echo "mktemp 失敗"; return 1; }
  # 造一個世界:dev 有 in-dev.md / sub/nested.md;side 分支有 only-side.md;
  #            tag v-only 有 tagged.md;fake-remote 有 remote-only.md;誰都沒有 ghost.md
  # 🔴 `-c commit.gpgsign=false`:R2 C6 逐顆隔離證實,使用者若全域開了簽章,
  #    這個 temp repo 的 commit 會 rc=128,而 setup 的診斷被 `>/dev/null 2>&1` 吞掉
  #    ⇒ 使用者看到「什麼都沒有」。init.defaultBranch / core.hooksPath 實測免疫。
  # 🔴 具名 add 不用 `git add -A`:CLAUDE.md Git 紀律逐字禁它,而字面稽核會掃到這裡。
  setup_log=$tmp/.setup.log
  (
    set -e
    cd "$tmp"
    git init -q -b dev .
    git config user.email t@t; git config user.name t
    mkdir -p sub
    echo hi > in-dev.md; echo hi > sub/nested.md
    git add in-dev.md sub/nested.md; git -c commit.gpgsign=false commit -qm base
    git checkout -qb side
    echo hi > only-side.md; git add only-side.md; git -c commit.gpgsign=false commit -qm side
    git checkout -qb tagged-src
    echo hi > tagged.md; git add tagged.md; git -c commit.gpgsign=false commit -qm tagged
    git tag v-only; git checkout -q dev; git branch -qD tagged-src
    git checkout -qb remote-src
    echo hi > remote-only.md; git add remote-only.md; git -c commit.gpgsign=false commit -qm remote
    # 假的 remote-tracking ref:直接寫 refs/remotes/,不需要真的 remote
    git update-ref refs/remotes/origin/feat "$(git rev-parse HEAD)"
    git checkout -q dev; git branch -qD remote-src
    rm -f only-side.md tagged.md remote-only.md
  ) > "$setup_log" 2>&1 || {
    # 🔴 R2 C5:上一版 skip 沒有任何 writer ⇒ `[ "$skip" = 0 ]` 是恆真守門，
    #    而合計行印「SKIP=0」讀起來像「查過了、沒跳過」。這裡是它唯一的 writer。
    skip=$((skip+1))
    echo "SKIP  temp repo 建不起來 ⇒ 13 格【一格都沒跑】。setup 輸出:"
    sed 's/^/      /' "$setup_log" | head -10
    printf '\n合計  PASS=%s  FAIL=%s  SKIP=%s\n' "$pass" "$fail" "$skip"
    return 1
  }
  # 🔴 複製【本檔自己】($0)，不是 "$REPO/scripts/where-is.sh" ——
  #    寫死路徑的話，selftest 測的是 repo 裡那一份、不是【正在跑的這一份】
  #    ⇒ 突變版跑 --selftest 會去測原版，永遠全綠。這是「量具測到別的東西」的形狀。
  mkdir -p "$tmp/scripts"; cp "$SELF" "$tmp/scripts/where-is.sh"
  mkdir -p "$tmp/fakebox"; echo "提到 only-side.md 這個檔" > "$tmp/fakebox/L-001.md"
  # 🔴 兩個 helper 都要 `|| true` / `|| r=$?` —— 本檔 `set -e`，而查無時 rc=3。
  #    不接的話：問一個不存在的檔，selftest 自己會【當場死掉】，
  #    而輸出長得像「跑到一半就沒了」不像「這格紅了」（這支的作者今天在四綠腳本上剛踩過同一個）。
  run() { ( cd "$tmp${2:+/$2}"; WHERE_IS_MAILBOX="$tmp/fakebox" bash "$tmp/scripts/where-is.sh" "$1" 2>&1 ) || true; }
  rc_of() { rcv=0; ( cd "$tmp${2:+/$2}"; WHERE_IS_MAILBOX="$tmp/fakebox" bash "$tmp/scripts/where-is.sh" "$1" >/dev/null 2>&1 ) || rcv=$?; echo "$rcv"; }

  # 格1 [正測] dev 上就有的 ⇒ 工作樹 ✅、rc=0
  out=$(run in-dev.md)
  case "$out" in *"① 工作樹"*"✅ 有"*) r=yes ;; *) r=no ;; esac
  ck "格1 dev 上就有 ⇒ ① ✅" "$r" "yes"
  ck "格1b rc=0" "$(rc_of in-dev.md)" "0"

  # 格2 [關鍵負測] 只在別支上 ⇒ ①✗ ②✗ 而 ③ 指名 side、rc=0
  out=$(run only-side.md)
  case "$out" in *"② dev 分支"*"✗ dev 上沒有"*) r=yes ;; *) r=no ;; esac
  ck "格2a 只在別支上 ⇒ ② ✗" "$r" "yes"
  case "$out" in *"✅ side "*) r=yes ;; *) r=no ;; esac
  ck "格2b 只在別支上 ⇒ ③ 指名 side" "$r" "yes"
  ck "格2c rc=0(找得到)" "$(rc_of only-side.md)" "0"

  # 格3 [負測] 真的不存在 ⇒ 印「①②③ 皆查無」+ 分母,rc=3
  out=$(run ghost.md)
  case "$out" in *"①②③ 皆查無"*) r=yes ;; *) r=no ;; esac
  ck "格3 不存在 ⇒ 印①②③皆查無" "$r" "yes"
  case "$out" in *"掃過的分母就是上面"*) r=yes ;; *) r=no ;; esac
  ck "格3b 查無要印分母" "$r" "yes"
  ck "格3c rc=3(與用法錯的 2、工具自壞的 1 分得開)" "$(rc_of ghost.md)" "3"

  # 格4 [負測] 有命中時【不可以】印查無
  out=$(run in-dev.md)
  case "$out" in *"皆查無"*) r=printed ;; *) r=not_printed ;; esac
  ck "格4 有命中 ⇒ 不可印查無" "$r" "not_printed"

  # 格5 [負測 · reviewer M2] 信箱提過【不算】檔存在 ⇒ 仍要判查無、rc=3
  #     fakebox 裡提到 only-side.md，而我們問的是一個誰都沒有的路徑同名檔
  echo "提到 ghost.md" >> "$tmp/fakebox/L-001.md"
  out=$(run ghost.md)
  case "$out" in *"①②③ 皆查無"*) r=yes ;; *) r=no ;; esac
  ck "格5a 信箱命中【不】取消查無判決" "$r" "yes"
  ck "格5b 且 rc 仍是 3" "$(rc_of ghost.md)" "3"

  # 格6 [負測 · reviewer M1] 從子目錄呼叫,相對路徑不可以被讀成別的東西
  ck "格6 從 sub/ 呼叫 nested.md ⇒ rc=0" "$(rc_of nested.md sub)" "0"

  # 格8 [負測 · R2 C3] remote-tracking 那半要真的被掃到
  #     上一版把 refs/remotes/ 加進去了，而 temp repo 沒有 remote ⇒ 那個修法【零覆蓋】，
  #     改回 refs/heads/ 仍然 13 PASS。這一格就是那個洞。
  out=$(run remote-only.md)
  case "$out" in *"✅ origin/feat "*) r=yes ;; *) r=no ;; esac
  ck "格8 只在 remote-tracking 上 ⇒ ③ 指名 origin/feat" "$r" "yes"
  ck "格8b rc=0(找得到)" "$(rc_of remote-only.md)" "0"

  # 格9 [負測 · R2 C2] tag 上的檔也要找得到 —— 判決句寫「任何 ref」，那 tag 就不能漏
  out=$(run tagged.md)
  case "$out" in *"✅ v-only "*) r=yes ;; *) r=no ;; esac
  ck "格9 只在 tag 上 ⇒ ③ 指名 v-only" "$r" "yes"
  ck "格9b rc=0(找得到)" "$(rc_of tagged.md)" "0"

  # 格10 系列 [正測 · R2 C4] ④ 信箱那一格【本身】要有正向斷言 ——
  #      上一版只驗「④ 不取消查無判決」，於是整格死掉都測不出來(R2 三發突變存活)。
  out=$(run only-side.md)
  case "$out" in *"✅ 提過:"*) r=yes ;; *) r=no ;; esac
  ck "格10a ④ 真的會命中(fakebox 提過 only-side.md)" "$r" "yes"
  out=$(run in-dev.md)
  case "$out" in *"✗ 信箱沒提過"*) r=yes ;; *) r=no ;; esac
  ck "格10b ④ 沒提過時要說沒提過(不是恆命中)" "$r" "yes"
  # 格10c:mentioned 旗標真的有被設 —— 查無 + 信箱提過 ⇒ 那句補充要出現
  echo "提到 ghost.md" >> "$tmp/fakebox/L-002.md" 2>/dev/null || echo "提到 ghost.md" > "$tmp/fakebox/L-002.md"
  out=$(run ghost.md)
  case "$out" in *"但信箱提過它"*) r=yes ;; *) r=no ;; esac
  ck "格10c 查無+信箱提過 ⇒ 印那句補充(證 mentioned 有被設)" "$r" "yes"

  # 格11 [負測 · R2 C1] 只在別支上的檔，從子目錄用相對路徑呼叫也要找得到
  #      上一版 resolve_target 用 `[ -e ]`(只看工作樹)當判準 ——
  #      而「不在工作樹」正是本工具的存在理由 ⇒ 那個回退會【無聲】印查無。
  ( cd "$tmp" && mkdir -p sub && git checkout -q side 2>/dev/null && \
    cp only-side.md sub/only-side-sub.md 2>/dev/null && git add sub/only-side-sub.md && \
    git -c commit.gpgsign=false commit -qm subside && git checkout -q dev ) >/dev/null 2>&1
  ck "格11 子目錄相對路徑 + 只在別支上 ⇒ rc=0" "$(rc_of only-side-sub.md sub)" "0"

  # 格7 [負測 · reviewer M7] 沒有 dev 分支時,② 要說「沒掃」不可說「dev 上沒有」
  ( cd "$tmp" && git branch -qm dev trunk ) >/dev/null 2>&1
  out=$(run in-dev.md)
  case "$out" in *"沒有叫 dev 的分支"*) r=said ;; *) r=silent ;; esac
  ck "格7 無 dev 分支 ⇒ ② 明說沒掃" "$r" "said"
  ( cd "$tmp" && git branch -qm trunk dev ) >/dev/null 2>&1


  # 格12 系列 [2026-08-20 W6 發現 + W5 加深] 方向性警告:本工具查的樹是從【腳本位置】推的,
  #        與「你人在哪」無關 ⇒ 從樹外呼叫時,所有 ✗ 對使用者手上那個 repo 什麼都沒證明。
  #        🔴 12a 是【對照組】—— 沒有它,一個恆真的警告也會讓 12b 綠。
  out=$(run ghost.md)
  case "$out" in *"方向性警告"*) r=printed ;; *) r=not_printed ;; esac
  ck "格12a 在樹【內】呼叫 ⇒ 不可印方向性警告(對照組)" "$r" "not_printed"
  case "$out" in *"本 repo:$tmp"*) r=yes ;; *) r=no ;; esac
  ck "格12b 結論區要印出它查的是哪一棵樹" "$r" "yes"

  outside=$(mktemp -d) || outside=''
  if [ -z "$outside" ]; then
    skip=$((skip+1)); echo "SKIP  格12c/d 造不出樹外目錄(mktemp 失敗)"
  else
    out=$( cd "$outside" && WHERE_IS_MAILBOX="$tmp/fakebox" bash "$tmp/scripts/where-is.sh" ghost.md 2>&1 || true )
    case "$out" in *"方向性警告"*) r=printed ;; *) r=not_printed ;; esac
    ck "格12c 從樹【外】呼叫 ⇒ 必須印方向性警告" "$r" "printed"
    rcv=0; ( cd "$outside" && WHERE_IS_MAILBOX="$tmp/fakebox" bash "$tmp/scripts/where-is.sh" ghost.md >/dev/null 2>&1 ) || rcv=$?
    ck "格12d 從樹外呼叫,rc 不變(仍 3;有東西在吃這個碼)" "$rcv" "3"
    rm -rf "$outside"
  fi

  rm -rf "$tmp"

  printf '\n合計  PASS=%s  FAIL=%s  SKIP=%s\n' "$pass" "$fail" "$skip"
  # 🔴 SKIP 也算沒過 —— reviewer M4:上一版 SKIP 不進 exit code 也不進合計行,
  #    ⇒ 可以「全 PASS、rc=0」而最重要那一格根本沒跑。
  [ "$fail" = "0" ] && [ "$skip" = "0" ]
}

case "${1:-}" in
  --selftest) selftest ;;
  -h|--help) echo "用法: bash scripts/where-is.sh <路徑>  |  bash scripts/where-is.sh --selftest"; exit 0 ;;
  '') echo "用法: bash scripts/where-is.sh <路徑>  |  bash scripts/where-is.sh --selftest" >&2; exit 2 ;;
  *) where_is "$1" ;;
esac
