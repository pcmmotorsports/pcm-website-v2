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
  world="$1"; foreign="$2"; marker="${3:-yes}"; surface="${4:-yes}"
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

  git commit -q -m exp -- "$M1" "$M2" 2>&1 | grep -E "HOOK:|PCM reviewer gate" | head -3
  RC=$?
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
