#!/bin/sh
# `.husky/status-owner-gate.sh` 的負向對照 harness
#
# ── 版本 2(2026-08-16 夜,折 A 窗 code-reviewer 的 B1/B2/B3)────────────────
# v1 被抓到三個問題,都是**同一個病的不同面**:
#   B1  cell4 是假通過 —— 它跑在 cell3 之後、吃了上一格的殘留狀態,
#       而且它是【唯一沒有 branch 斷言的一格】。把逃生門整段刪掉,它照樣 PASS。
#       🔴 而那與作者自己在 v1 抓到的 cell2 **完全同形狀** ——
#          作者修好 cell2、漏掉隔壁的 cell4。「折 finding 只處理被指名那一處」。
#   B2  條件②(自分岔未動過)整條刪掉 ⇒ v1 全綠  ⇒ 那條註解說很重要的行，零站崗
#   B3  `[ -n "$BASE" ]` 改成 true    ⇒ v1 全綠  ⇒ 同上
#
# ⇒ v2 的兩個結構改動:
#   ① **每一格自己建狀態**(`setup_*`),不繼承上一格的殘留;每一格都有 branch 斷言。
#   ② **加一層「突變」**:把 hook 的每一條關鍵行各弄壞一次,**斷言整套至少有一格轉紅**。
#      沒有這一層,「這行很重要」永遠只是註解裡的宣稱。
#
# 用法: sh scripts/status-gate-probe.sh
# 前提: 主樹跑;自建/自刪拋棄式 worktree,不碰任何人的樹。exit 非 0 = 有格沒過。

set -e
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
TMP=$(mktemp -d); WT="$TMP/probe"; BR="status-gate-probe-$$"
BASELINE="$TMP/baseline.sh"; cp "$REPO/.husky/status-owner-gate.sh" "$BASELINE"
HOOK="$BASELINE"          # 當前受測版本(突變層會換掉它)
PASS=0; FAIL=0

cleanup() {
  git -C "$WT" merge --abort 2>/dev/null || true
  git worktree remove --force "$WT" 2>/dev/null || true
  git branch -D "$BR" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# 🔴 基底不能用 origin/dev —— dev == origin/dev 時 `merge dev` 帶不進任何 STATUS 差異,
#    cell2 會走到「根本沒偵測到 STATUS」而 rc 照樣 0 ⇒ 假通過(v1 第一跑實際撞到)。
PROBE_BASE=$(git rev-parse "$(git log -1 --format=%H -- STATUS.md)^")
[ "$(git diff --no-ext-diff "$PROBE_BASE" dev -- STATUS.md | wc -l | tr -d ' ')" = "0" ] && {
  echo "SETUP-FAIL: 基底與 dev 的 STATUS 無差異,cell2 會假通過,中止" >&2; exit 8; }

git worktree add -q -b "$BR" "$WT" "$PROBE_BASE"
git -C "$WT" config user.email probe@local
git -C "$WT" config user.name probe

# ── 每格自建狀態:一律先回到乾淨基底,再堆這一格要的東西 ──────────────────
reset_clean() {
  git -C "$WT" merge --abort 2>/dev/null || true
  git -C "$WT" reset -q --hard "$PROBE_BASE"
  git -C "$WT" clean -qfd
}
enter_merge() {                       # 造出「側分支 merge dev、STATUS 純繼承」的狀態
  reset_clean
  ( cd "$WT" && echo probe > probe.txt && git add probe.txt \
    && git -c core.hooksPath=/dev/null commit -q -m probe \
    && git merge --no-commit --no-ff dev >/dev/null 2>&1 ) || true
}

# run <期望rc> <期望分支 allow|block|bypass|none> <名稱>
run() {
  want_rc=$1; want_br=$2; name=$3
  cp "$HOOK" "$WT/.husky/status-owner-gate.sh"
  out=$( (cd "$WT" && ${ENVPREFIX:-} sh .husky/status-owner-gate.sh) 2>&1 ) && rc=0 || rc=$?
  br=other
  case "$out" in
    *"是 merge 繼承"*)                        br=allow  ;;
    *"擋下:子窗"*)                            br=block  ;;
    *"PCM_ALLOW_STATUS_IN_WORKTREE=1 略過"*)  br=bypass ;;
  esac
  [ -z "$out" ] && br=none
  if [ "$rc" = "$want_rc" ] && [ "$br" = "$want_br" ]; then
    PASS=$((PASS+1)); [ -n "$QUIET" ] || printf 'PASS  %-32s rc=%s branch=%s\n' "$name" "$rc" "$br"
  else
    FAIL=$((FAIL+1)); [ -n "$QUIET" ] || printf 'FAIL  %-32s rc=%s(want %s) branch=%s(want %s)\n' \
      "$name" "$rc" "$want_rc" "$br" "$want_br"
    # 🔴 記下【哪一格】紅了(2026-08-17 折 V-022 `F-V22-1`)——
    #    突變層要比對的不只是「紅幾格」,還有「紅的是不是預期那一格」。
    KILLED_NAMES="$KILLED_NAMES${KILLED_NAMES:+,}$(printf '%s' "$name" | awk '{print $1}')"
  fi
}

# ── 整套:每格自建狀態、每格都有 branch 斷言 ───────────────────────────────
suite() {
  reset_clean
  ( cd "$WT" && printf '\n<!--p-->\n' >> STATUS.md && git add STATUS.md )
  run 1 block "cell1 作者真的手改"

  reset_clean
  ( cd "$WT" && git mv STATUS.md STATUS-R.md )
  run 1 block "cellA rename 繞過"

  enter_merge
  run 0 allow "cell2 純 merge 繼承"

  enter_merge
  ( cd "$WT" && git update-index --chmod=+x STATUS.md )
  run 1 block "cellB merge 後 mode 變更"

  enter_merge
  ( cd "$WT" && printf '\n<!--q-->\n' >> STATUS.md && git add STATUS.md )
  run 1 block "cell3 merge 中途又手改"

  # 🔴 cell4 修法有三半(B1):①自建狀態,不吃 cell3 殘留
  #    ②狀態刻意用【本來會被擋】的那一種 —— 否則放不放行分不出是逃生門還是別的路
  #    ③加 branch 斷言 bypass —— v1 缺的就是這個
  reset_clean
  ( cd "$WT" && printf '\n<!--r-->\n' >> STATUS.md && git add STATUS.md )
  ENVPREFIX="env PCM_ALLOW_STATUS_IN_WORKTREE=1" run 0 bypass "cell4 逃生門"
  ENVPREFIX=

  # 🔴 cellC:作者把 STATUS 改成【跟 dev 一模一樣】再 merge dev
  #    ⇒ 條件① 成立(index == MERGE_HEAD)、條件② 不成立(本分支動過 STATUS)⇒ 必須擋。
  #    這一格存在的唯一理由 = 讓突變 M2(拿掉條件②)殺得掉;
  #    v1 沒有它 ⇒ 註解宣稱「只有①會漏掉『作者改成跟對方一樣』」而那個 case 零站崗(A 窗 B2)。
  #    ⚠️ 構造要用【真實情境】:作者改了 STATUS → merge dev 撞衝突 → 解衝突時選了對方那版。
  #       (第一版我讓兩邊內容相同再 merge ⇒ merge 根本不 stage STATUS ⇒ branch=none、測不到東西。
  #        那正是「rc 對而路徑錯」的又一次,是 branch 斷言抓到的。)
  reset_clean
  ( cd "$WT" && printf '\n<!--側分支自己寫的-->\n' >> STATUS.md && git add STATUS.md \
    && git -c core.hooksPath=/dev/null commit -q -m "側分支動過 STATUS" \
    && git merge --no-commit --no-ff dev >/dev/null 2>&1
    cd "$WT" && git checkout -q MERGE_HEAD -- STATUS.md && git add STATUS.md ) || true
  # 🔴 一律用 `git checkout MERGE_HEAD --`,不要先試 `--theirs`:
  #    這個 merge 是【乾淨自動合併】(零衝突),`--theirs` 不報錯也不做事 ⇒ fallback 永遠不跑
  #    ⇒ index 留著自動合併的內容(兩邊都不是)⇒ 條件①也不成立
  #    ⇒ 那一格會【因為①而擋】,而我以為它在測② ⇒ 突變 M2 照樣存活。
  #    (2026-08-16 實際踩到,是「M2 為什麼殺不掉」逼出來的。)
  run 1 block "cellC 改成跟對方一樣"

  # A2:自己 merge 自己 ⇒ 必須擋(MERGE_HEAD 不是 origin/dev 的祖先)
  reset_clean
  ( cd "$WT" && git checkout -q -b "${BR}-side" \
    && printf '\n<!--side 自己寫的收帳行-->\n' >> STATUS.md && git add STATUS.md \
    && git -c core.hooksPath=/dev/null commit -q -m side \
    && git checkout -q "$BR" \
    && git merge --no-commit --no-ff "${BR}-side" >/dev/null 2>&1 ) || true
  run 1 block "cellS 自己 merge 自己"
  ( cd "$WT" && git merge --abort 2>/dev/null || true; git branch -qD "${BR}-side" 2>/dev/null || true )
}

echo "── 基準(未突變)────────────────────────────"
suite
BASE_FAIL=$FAIL
[ "$BASE_FAIL" = "0" ] || { printf '\n🔴 基準就有 %s 格沒過,突變層不跑(結果會沒有意義)\n' "$BASE_FAIL"; exit 1; }

# ── 🔴 突變層(B2/B3):每條關鍵行弄壞一次,斷言【至少一格轉紅】────────────
#    沒有這層,「這行很重要」永遠只是註解裡的宣稱。
echo ""
echo "── 突變層:每條關鍵行拿掉,至少要有一格紅 ───"
mutate() {
  label=$1; sedexpr=$2; want_killed=$3; want_cell=$4
  M="$TMP/mut.sh"; sed "$sedexpr" "$BASELINE" > "$M"
  if cmp -s "$M" "$BASELINE"; then
    FAIL=$((FAIL+1)); printf 'FAIL  %-40s 突變沒打上去(sed 沒改到任何東西)\n' "$label"; return
  fi
  # 🔴 突變體必須是【合法腳本】(2026-08-17 折 V-021 `F-V21-1`):
  #    否則殺掉那些格的是「sh 語法錯誤」而不是「缺了那道檢查」——
  #    **突變層照樣印「PASS 被殺掉」,用錯的理由給對的答案。**
  #    這道 `sh -n` 是最便宜的一半;真正擋住它的是下面那個 killed 數斷言。
  if ! sh -n "$M" 2>/dev/null; then
    FAIL=$((FAIL+1)); printf 'FAIL  %-40s 🔴 突變體語法就壞了 ⇒ 它殺掉的是腳本不是守門\n' "$label"; return
  fi
  HOOK="$M"; before=$FAIL; KILLED_NAMES=; QUIET=1; suite; QUIET=; HOOK="$BASELINE"
  killed=$((FAIL-before)); FAIL=$before      # 突變造成的紅不算最終失敗,它是預期的
  # 🔴 斷言【殺掉幾格】,不只斷言「有沒有殺到」(V-021 `F-V21-1`):
  #    語法殺的症狀就是「殺太多格」(M4 舊版殺 7 格,含與 A2 完全無關的 cell1/cellA/cell3),
  #    而舊寫法 `killed -gt 0` 對 1 格與 7 格**回同一個答案** ⇒ 零判別力。
  #    ⚠️ 這個數字是**實跑量出來的**,不是設計值 —— 改了 hook 或加了格就要重量、不要照抄。
  if [ "$killed" = "$want_killed" ] && [ "$KILLED_NAMES" = "$want_cell" ]; then
    PASS=$((PASS+1)); printf 'PASS  %-40s 被殺掉(%s 格轉紅 = %s,數量與身分皆相符)\n' "$label" "$killed" "$KILLED_NAMES"
  elif [ "$killed" = "$want_killed" ]; then
    # 🔴 V-022 `F-V22-1` 的殘留形狀:數字對而【殺錯格】——
    #    PoC 實錘:敵意 M4(語法合法、把 A2 整條拿掉)殺的是 `cell2` 而 `cellS` 綠著,
    #    舊版照印「與預期相符」40/0 ⇒ **替一個沒被測到的守門背了書。**
    FAIL=$((FAIL+1))
    printf 'FAIL  %-40s 🔴 殺 %s 格【數量對】但紅的是 %s,預期 %s —— 殺錯格\n' \
      "$label" "$killed" "${KILLED_NAMES:-<無>}" "$want_cell"
    printf '      %-40s   ⇒ 這道突變【沒有】打到它宣稱在測的那道守門,別讓它替那道守門背書\n' ""
  elif [ "$killed" = "0" ]; then
    FAIL=$((FAIL+1)); printf 'FAIL  %-40s 🔴 存活 —— 這行【零負測】,註解說它重要而沒人守\n' "$label"
  else
    FAIL=$((FAIL+1))
    printf 'FAIL  %-40s 🔴 殺掉 %s 格(%s)但預期 %s(%s) —— 數字不符\n' \
      "$label" "$killed" "${KILLED_NAMES:-<無>}" "$want_killed" "$want_cell"
    printf '      %-40s   常見成因:突變體語法壞掉 ⇒ 殺的是腳本不是守門;或這道守門的射程變了\n' ""
  fi
}

# 🔴 M1 已【降級為非突變】:實測證明 `--no-renames` 不是修好 F1 的那個東西 ——
#    pathspec 形式 `--quiet -- STATUS.md` 自己就抓得到 rename(rc=1)。
#    ⇒ 拿掉它不會有格轉紅,那不是「零負測」,是**它本來就不負載**。
#    留著它當防禦深度,但**不假裝有斷言在守它**。
mutate "M1 改回舊的 --name-only|grep 寫法（真正的 F1）" \
  's|^git diff --cached --quiet --no-ext-diff --no-textconv --no-renames -- STATUS.md \&\& exit 0|[ "$(git diff --cached --name-only \| grep -c "^STATUS\\.md$" \|\| true)" = "0" ] \&\& exit 0|' 1 cellA
mutate "M2 拿掉條件②（自分岔未動過）" \
  's|^     && git diff --quiet --no-ext-diff --no-textconv --no-renames "\$BASE" HEAD -- STATUS.md; then|     ; then|' 1 cellC
# 🔴 M3 已【移出突變集,並明寫理由】:`[ -n "$BASE" ]` 只在【不相關歷史】時才為空
#    (需 --allow-unrelated-histories),本工作流構造不出來
#    ⇒ 這是**無法在本環境構造負測的防禦性檢查**,不是「有 harness 守著」。
#    ⚠️ 不要把它從註解裡刪掉,也不要假裝它被測過。
# 🔴 M4 的 replacement 是 `&& true \` 不是【空行】(2026-08-17 折 V-021 `F-V21-1`):
#    舊版把整行清空 ⇒ `if [ -n "$BASE" ] \` 接空行 ⇒ **sh 語法錯誤、每格 rc=2 ⇒ 7 格轉紅**,
#    而突變層照樣印「PASS 被殺掉」。**紅了看起來像成功** —— 那 7 格裡有 cell1/cellA/cell3,
#    它們與 A2 一點關係都沒有。
#    ⇒ 判別句(house `feedback_false-red-mutation-restored-the-implementation`):
#      **紅的時候要問「紅在哪一格、訊息是不是我預期那條」,不是看到紅就收。**
mutate "M4 拿掉 MERGE_HEAD 來源約束（A2）" \
  's|^     && git merge-base --is-ancestor MERGE_HEAD dev 2>/dev/null \\|     \&\& true \\|' 1 cellS
mutate "M5 拿掉逃生門整段" \
  's|^\[ "\${PCM_ALLOW_STATUS_IN_WORKTREE:-}" = "1" \] && {|[ "no" = "yes" ] \&\& {|' 1 cell4

printf '\n合計  PASS=%s  FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
