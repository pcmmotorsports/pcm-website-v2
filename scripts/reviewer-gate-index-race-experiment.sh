#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# reviewer 閘 · 四世界對照實驗(2026-08-30 線D `-e4` 做;⚠️ **我是那道閘的作者**)
#
# 為什麼有這支:兩個窗對同一道閘給了**相反**的當事人紀錄,而兩份都誠實 ——
#   `-e4`:index 有別窗的檔 ⇒ 帶 pathspec commit ⇒ **擋**
#   `-e9`:index 有別窗的檔 ⇒ 帶 pathspec commit ⇒ **過**
# ⇒ 本支把兩種世界並排造出來,讓它自己說話。
#
# ── 結果(四個世界;`--selftest` 沒有另一套,**跑它就是跑自測**)─────────────
#   | 世界 | 別窗的檔在 index | **我的檔在受審面** | 標記 | 結果 |
#   |  A   | 有 | 是        | 有 | 🛑 擋 |
#   |  B   | 無 | 是        | 有 | ✅ 過 |
#   |  C   | 有 | 是        | **無** | 🛑 擋 ← **正對照:這一格不紅 ⇒ 整發作廢** |
#   |  D   | 有 | **否(docs)** | 有 | ✅ 過 |
#   |  E   | **寫標記【後】才塞進來** | 是 | 有 | ✅ **過** |
#   |  F   | 同 E | 否(docs) | 有 | ✅ 過 |
#   |  G   | 同 E | 是 | **無** | 🛑 擋 ← **第二個正對照** |
#   |  H   | 有(寫標記前) | 是 | 有,**被擋後重寫再送** | 🛑 **兩發都擋** |
#
# ══ 🔴 **世界 H:「被擋再重寫標記再送」這條修法【在世界 A 會鬼打牆】** ══════════
#   實測:第一發標記 tree `3e883e01` ⇒ 擋;重寫後的標記 tree **`3e883e01`(一模一樣)** ⇒ 仍然擋。
#   ⇒ 因為標記算的是**共用 index**,而別人的檔還在裡面 ⇒ **重算幾次都是同一個 tree。**
#   ⇒ 📌 **⇒ 那條修法只在【別人的檔已經離開 index】之後才生效** ——
#     而它離開的原因通常是**別人自己 commit 走了**,不是我做了什麼。
#   ✅ 所以正確的說法是:**直接送、被擋就重送**,而**重送要等別人的檔離開 index**;
#     判別動作 = 比 `sed -n 2p <git-dir>/pcm-reviewer-ran` 與「HEAD + 只有我那幾支」的 tree。
#
# 🔵 **E/F/G 是為了關掉 `-1c` 的競爭假說**(它自己標了「這是推論不是量測」):
#   「決定性的變數是【寫標記到 commit 之間 index 有沒有變】」⇒ **實測:不是。**
#   E 的 index 在寫標記後【確實變了】(多一支別人的檔)而它 **✅ 過** ——
#   因為 hook 看到的暫時 index = HEAD + 只有 pathspec 那幾支,**後來塞進來的那支不在裡面**。
#
# ══ ⇒ **所以判準要寫準,而它比「index 裡有沒有別人的檔」窄一格** ═════════════
#   🔴 **決定性變數 =【寫標記那一刻】共用 index 裡有沒有別人的檔** ——
#     **不是** commit 當下有沒有、**不是** 中間有沒有變。
#   ⇒ 因為標記的 tree 是在**共用 index** 上算的(含別人的),
#     而 hook 的 tree 是**暫時 index**(只含 pathspec)⇒ 兩者只在「寫標記時 index 乾淨」時相等。
#   ⚠️ 而這一切都在**受審面**那道短路之後才發生(世界 D/F)。
#
# 🔴 **世界 D 是解謎的那一格**:tree **不符**(標記 `c2c18a7d` vs hook `98665d8c`)**而它照樣過**
#   ⇒ 因為閘在比 tree 之【前】先判「這顆有沒有碰受審面」,沒碰 ⇒ **靜默放行,連比都沒比**。
#   ⇒ 受審面 = `apps/ packages/ supabase/ scripts/ .github/` + 根層平台設定(`.husky/reviewer-gate.sh:134`)。
#   ✅ 實查:`-e9` 那一顆 `93a7b9e5` = 1 file,`docs/patterns/….md`,落在受審面 **0** ⇒ **她是世界 D、我是世界 A。**
#   ⇒ 📌 **兩份紀錄都完整 —— 少的是第三個變數:我自己的檔在不在受審面。**
#
# ══ 🛑 **而這支工具存在的理由,是它第一版【是死的】** ═══════════════════════
#   第一發:世界 A ✅ 過、世界 B ✅ 過 ⇒ **看起來就是「`-e9` 對、我錯」**,而我差點就那樣回報。
#   ⇒ 加上世界 C(**完全不寫標記,這一格必須紅**)⇒ **它也過** ⇒ **閘從頭到尾沒接上。**
#   ⇒ 成因:測試檔叫 `mine1.txt` / `mine2.txt` —— **`.txt` 不在受審面** ⇒ 閘靜默放行。
#   ⇒ 🔴 **而那個假結果的方向,正好是「我承認我錯了」**
#     ⇒ 📌 **一個讓自己認錯的假綠,最不會被回頭查**(全文 `docs/patterns/traps-inbox/D-20260830.md` D-19)。
#   ⛔ **這一段不刪** —— 它是本支存在的理由,也是「為什麼測試檔名不能隨手取」的實例。
#
# 用法:bash scripts/reviewer-gate-index-race-experiment.sh
#   每個世界各造一個**新的**拋棄式 repo(不共用),跑完刪掉;不碰本 repo 的 index / HEAD / 標記。
# ══════════════════════════════════════════════════════════════════════════════
# 對照實驗:index 有【別人的檔】時, 帶 pathspec 的 commit 會不會被 reviewer 閘擋。
# 作者 = 那道閘的作者(線D -e4)⇒ 結論旁邊要標這一句。
set -u
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY 2>/dev/null || true

REAL=/Users/sean_1/pcm-website-v2
run_world() {
  world="$1"; foreign="$2"; marker="${3:-yes}"; surface="${4:-yes}"; late="${5:-no}"; retry="${6:-no}"
  R=$(mktemp -d "${TMPDIR:-/tmp}/gate-exp-XXXXXX")
  git init -q "$R"; cd "$R" || return 1
  git config user.email probe@x; git config user.name probe
  echo base > base.txt; git add base.txt; git commit -qm base

  mkdir -p .husky
  # 用真的閘, 但把 hook 只留 reviewer 那一段
  cp "$REAL/.husky/reviewer-gate.sh" .husky/reviewer-gate.sh
  mkdir -p .git/hooks
  cat > .git/hooks/pre-commit <<'HK'
#!/bin/sh
echo "HOOK: GIT_INDEX_FILE=${GIT_INDEX_FILE:-<未設>}" >&2
echo "HOOK: write-tree=$(git write-tree)" >&2
. "$(git rev-parse --show-toplevel)/.husky/reviewer-gate.sh"
HK
  chmod +x .git/hooks/pre-commit

  mkdir -p scripts docs
  if [ "$surface" = yes ]; then M1=scripts/mine1.sh; M2=scripts/mine2.sh; else M1=docs/mine1.md; M2=docs/mine2.md; fi
  echo mine1 > "$M1"; echo mine2 > "$M2"
  git add "$M1" "$M2"
  if [ "$foreign" = yes ]; then
    echo theirs > scripts/theirs.sh; git add scripts/theirs.sh
  fi

  echo "── 世界 $world:暫存區 $(git diff --cached --name-only | wc -l | tr -d ' ') 支 ──"
  gd=$(git rev-parse --git-dir)
  st=$(git write-tree)
  if [ "$marker" = yes ]; then
    { git rev-parse HEAD; printf '%s\n' "$st"; echo "reviewed: exp"; } > "$gd/pcm-reviewer-ran"
    echo "   標記 tree(共用 index)= $st"
  else
    rm -f "$gd/pcm-reviewer-ran"
    echo "   標記:完全不寫(正對照, 這一格【必須】紅)"
  fi

  if [ "$late" = yes ]; then
    echo theirs > scripts/late.sh; git add scripts/late.sh
    echo "   🔴 寫標記【之後】才把別人的檔塞進 index ⇒ 現在 index tree = $(git write-tree)"
  fi
  git commit -q -m exp -- "$M1" "$M2" > /dev/null 2>&1
  # 🔴 這一段【不要】掛管線:上一版把 grep 掛在 fi 後面, 把重試那行 echo 一起濾掉了
  #    ⇒ 看起來像「重試沒跑」, 而它其實跑了 —— 又一次「量具吃掉自己的證據」。
  if [ "$retry" = yes ] && ! git log --oneline -1 2>/dev/null | grep -q exp; then
    echo "   🔁 第一發被擋 ⇒ 照【新規矩】重寫標記再送一次(index 沒清)"
    st2=$(git write-tree)
    { git rev-parse HEAD; printf '%s\n' "$st2"; echo "reviewed: retry"; } > "$gd/pcm-reviewer-ran"
    echo "   🔁 重寫後的標記 tree = $st2"
    git commit -q -m exp -- "$M1" "$M2" > /dev/null 2>&1
    if git log --oneline -1 2>/dev/null | grep -q exp; then
      echo "   🔁 重試結果:✅ 過"
    else
      echo "   🔁 重試結果:🛑 仍然擋"
    fi
  fi
  if git log --oneline -1 2>/dev/null | grep -q exp; then
    echo "   ⇒ 結果:✅ 過"
  else
    echo "   ⇒ 結果:🛑 擋"
  fi
  cd /; rm -rf "$R"
}

run_world "A(有別人的檔)" yes
echo
run_world "B(只有我的)" no
echo
run_world "C(正對照:不寫標記)" yes no
echo
run_world "D(有別人的檔, 而我的兩支是 docs 不在受審面)" yes yes no
echo
run_world "E(時序:寫標記【後】才有別人的檔, 我碰受審面)" no yes yes yes
echo
run_world "F(同 E 而我的是 docs)" no yes no yes
echo
run_world "G(第二個正對照:E 的條件但不寫標記)" no no yes yes
echo
run_world "H(被擋後照新規矩【重寫標記再送】, 而 index 沒清)" yes yes yes no yes
