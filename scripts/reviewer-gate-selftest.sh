#!/usr/bin/env bash
# reviewer-gate-selftest.sh —— `.husky/reviewer-gate.sh` + `scripts/write-reviewer-marker.sh` 的七世界自檢
#
# 🔴 **為什麼有這支檔**(2026-08-30 線D):那道閘的標記檔是【單一槽位】,
#    而唯一的比對是「第1行 == 當下 HEAD」⇒ **A 窗寫的標記會讓 B 窗的 commit 通過**。
#    實錘(當天 cat 出來的):標記檔第1行是線D 的 migration commit、第2行是另一窗的片名
#    ⇒ 它同時宣稱「那顆 migration 已審,理由是別人的片」——**兩半各自都是真的,合起來是假話**。
#    ⚠️ 而它的**紅也不承重**(別窗 commit 讓 HEAD 動 ⇒ 假擋)⇒ **綠與紅都不代表「這片審過了」。**
#
# 🔴 **它每次都自己建一個全新的拋棄式 repo** —— 而那不是潔癖,是量到的:
#    第一版沿用同一個 repo,而上一輪跑成功的 commit 讓那些檔變成 tracked
#    ⇒ 下一輪 `echo 同樣內容 > 同一支檔` **什麼都沒 staged**
#    ⇒ 閘在「沒碰受審面」就 exit 0 ⇒ **整張表印一排 ✅ 而它什麼都沒證。**
#    📌 抓到它的是 `need_staged()` 那個正對照(第一版沒有它)。
#
# ⚠️ **射程**:它驗的是**這兩支檔的邏輯**,不是主樹的部署態;
#    也不驗 husky 的接線(本腳本自己接 core.hooksPath)。
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# 🔴 codex must-fix:`mktemp` 失敗時 `W=""` ⇒ 第 28 行會變成 `rm -rf /r`。
#    ⇒ 明檢, 而且【在 trap 裝上去之前】檢。
W="$(mktemp -d "${TMPDIR:-/tmp}/gate-selftest.XXXXXX")" || { echo "ENV-FAIL: mktemp 失敗" >&2; exit 2; }
[ -n "$W" ] && [ -d "$W" ] || { echo "ENV-FAIL: mktemp 回了空的或不是目錄" >&2; exit 2; }
FAIL=0
trap 'rm -rf "$W"' EXIT

say() { printf '%-4s %-56s %s\n' "$1" "$2" "$3"; }

fresh() {   # 每一格一個全新的 repo —— 見檔頭
  rm -rf "$W/r"; mkdir -p "$W/r/.husky" "$W/r/scripts" "$W/r/packages/x"
  cd "$W/r" || exit 2
  git init -q . && git config user.email t@t && git config user.name t
  echo seed > seed.txt && git add seed.txt && git commit -qm seed >/dev/null 2>&1
  cp "$REPO/.husky/reviewer-gate.sh" .husky/
  cp "$REPO/scripts/write-reviewer-marker.sh" scripts/
  printf '#!/bin/sh\nsh "$(dirname "$0")/reviewer-gate.sh"\n' > .husky/pre-commit
  chmod +x .husky/pre-commit
  git config core.hooksPath .husky
  # 🔴 codex must-fix:setup/cp 任一步失敗 ⇒ hook 根本沒接上
  #    ⇒ 所有「預期被擋」的世界都會【假綠】(它們不是被擋, 是根本沒有閘)。
  #    ⇒ 每一格開場自我證明:hook 檔在、可執行、而且【真的會擋一次】。
  [ -x .husky/pre-commit ] && [ -s .husky/reviewer-gate.sh ] && [ -s scripts/write-reviewer-marker.sh ] \
    || { echo "ENV-FAIL: 拋棄式 repo 的 hook 沒接好 ⇒ 整支作廢" >&2; exit 2; }
  echo probe > packages/x/__probe.ts && git add packages/x/__probe.ts
  if git commit -qm __probe >/dev/null 2>&1; then
    echo "ENV-FAIL: 開場自檢 —— 沒有標記卻 commit 成功 ⇒ 這個 repo 的閘沒有生效, 整支作廢" >&2; exit 2
  fi
  git reset -q; rm -f packages/x/__probe.ts
}
# 🔴 正對照:每一格開始前確認【真的有東西 staged】。少了它,整張表會印一排無意義的 ✅。
need_staged() {
  n=$(git diff --cached --name-only | grep -c .)
  [ "$n" -ge "$1" ] && return 0
  say "$2" "$3" "🔴 前提不成立:staged=$n(預期 ≥$1)⇒ 本格作廢"; FAIL=1; return 1
}

fresh; echo a1 > packages/x/a.ts; git add packages/x/a.ts
if need_staged 1 V1 "同窗 add→標記→commit"; then
  bash scripts/write-reviewer-marker.sh "V1" >/dev/null 2>&1
  git commit -qm V1 >/dev/null 2>&1 && say V1 "同窗 add→標記→commit" "✅ 過(預期過)" || { say V1 "同窗 add→標記→commit" "🔴 被擋(預期過)"; FAIL=1; }
fi

# 🔴🔴 這一格是本次修法的證人:少了「釘內容」那一行, 它會過。
fresh; echo a2 > packages/x/a2.ts; git add packages/x/a2.ts
if need_staged 1 V2 "A 寫標記 → B add → B commit"; then
  bash scripts/write-reviewer-marker.sh "A 窗的片" >/dev/null 2>&1
  echo b2 > packages/x/b2.ts; git add packages/x/b2.ts
  need_staged 2 V2 "A 寫標記 → B add → B commit" || true
  git commit -qm V2 >/dev/null 2>&1 && { say V2 "A 寫標記 → B add → B commit" "🔴 過了(必須被擋)"; FAIL=1; } || say V2 "A 寫標記 → B add → B commit" "✅ 被擋(預期擋)"
fi

# 🔴 codex must-fix:前一版的 V3 **同時**改了 HEAD 與 staged 內容
#    ⇒ 就算把 HEAD 比對整個拿掉, 它照樣會因為 tree id 變了而被擋
#    ⇒ **那一格沒有驗到 HEAD 釘選**, 它驗的是內容釘選(而那是 V2 的工作)。
#    ✅ 改成:寫完標記之後, **用 plumbing 把 HEAD 移走而【index 一個位元都不動】**
#      (commit-tree + update-ref ⇒ 不跑 hook、不碰 index)。
fresh; echo a3 > packages/x/a3.ts; git add packages/x/a3.ts
if need_staged 1 V3 "標記後【只有 HEAD 動】→ commit"; then
  bash scripts/write-reviewer-marker.sh "V3" >/dev/null 2>&1
  base_tree=$(git rev-parse HEAD^{tree})
  newc=$(git commit-tree "$base_tree" -p HEAD -m "別窗插的一顆(不跑 hook、不碰 index)")
  git update-ref HEAD "$newc"
  # 🔴 正對照:index 真的沒被動到(tree id 與寫標記當下相同)
  if [ "$(git write-tree)" != "$(sed -n 2p .git/pcm-reviewer-ran)" ]; then
    say V3 "標記後【只有 HEAD 動】→ commit" "🔴 前提不成立:index 也變了 ⇒ 這一格沒隔離出 HEAD"; FAIL=1
  else
    git commit -qm V3b >/dev/null 2>&1 && { say V3 "標記後【只有 HEAD 動】→ commit" "🔴 過了(必須被擋)"; FAIL=1; } || say V3 "標記後【只有 HEAD 動】→ commit" "✅ 被擋(預期擋 ⇒ HEAD 釘選承重)"
  fi
fi

fresh; echo a4 > packages/x/a4.ts; git add packages/x/a4.ts
if need_staged 1 V4 "沒標記 + 動 packages/"; then
  git commit -qm V4 >/dev/null 2>&1 && { say V4 "沒標記 + 動 packages/" "🔴 過了(必須被擋)"; FAIL=1; } || say V4 "沒標記 + 動 packages/" "✅ 被擋(預期擋)"
fi

fresh; echo doc > note.md; git add note.md
if need_staged 1 V5 "沒標記 + 只動 .md(誤擋面不得擴大)"; then
  git commit -qm V5 >/dev/null 2>&1 && say V5 "沒標記 + 只動 .md(誤擋面不得擴大)" "✅ 放行(預期放行)" || { say V5 "沒標記 + 只動 .md(誤擋面不得擴大)" "🔴 被擋(預期放行)"; FAIL=1; }
fi

# 🔴 codex nit:fresh repo 本來就沒有標記 ⇒ 前一版的 `rm -f` 什麼都沒移除, 實質重複 V4。
#    ✅ 改成:先寫一個【本來會過的】標記, 再刪掉它 —— 這樣才驗得到「標記檔不存在 ⇒ 擋」。
fresh; echo a6 > packages/x/a6.ts; git add packages/x/a6.ts
bash scripts/write-reviewer-marker.sh "V6 先寫一個會過的" >/dev/null 2>&1
[ -f .git/pcm-reviewer-ran ] || { say V6 "標記檔不存在" "🔴 前提不成立:標記沒寫成 ⇒ 本格作廢"; FAIL=1; }
rm -f .git/pcm-reviewer-ran
if need_staged 1 V6 "標記檔不存在"; then
  git commit -qm V6 >/dev/null 2>&1 && { say V6 "標記檔不存在" "🔴 過了(必須被擋)"; FAIL=1; } || say V6 "標記檔不存在" "✅ 被擋(預期擋)"
fi

# 🔵 **這一格原本是「已知殘留、預期會過」, 而實測它【被擋了】** ⇒ 已改成正式驗收(過了就是紅)。
#    機制(實測):git 在 partial commit 時給 hook 一個**暫時 index**(GIT_INDEX_FILE=…next-index-*.lock)
#    ⇒ hook 的 `git write-tree` 回的是【這一顆會產生的 tree】, 不是共用 index 的 tree ⇒ 對不上 ⇒ 擋。
#    📌 **它是換成 git write-tree 之後才關掉的 —— 雜湊 diff 那一版關不掉。**
# 🔴 codex must-fix:前一版的 V7 **沒有 stage A 的檔、也沒有用 pathspec commit**
#    ⇒ 它根本沒演到宣稱的那個世界(A+B 都在 index、B 用 pathspec 只收自己那半)。
#    ⚠️ 而 codex 另外指出一格我不知道的:**git 對 partial commit(帶 pathspec)會餵給 hook
#      一個【暫時的假 index】** ⇒ 那正是這一格要量的東西, 不能用想的。
fresh
echo b7 > packages/x/b7.ts; git add packages/x/b7.ts            # B 窗先 add 自己的
echo a7 > packages/x/a7.ts; git add packages/x/a7.ts            # A 窗也 add 自己的
if need_staged 2 V7 "A+B 都在 index → A 寫標記 → B 用 pathspec commit"; then
  bash scripts/write-reviewer-marker.sh "A 窗的片(此時 index 含 A+B)" >/dev/null 2>&1
  git commit -qm V7 -- packages/x/b7.ts >/dev/null 2>&1 \
    && { say V7 "A+B 在 index → A 寫標記 → B pathspec commit" "🔴 過了 ⇒ 洞又開了(它 2026-08-30 實測是關的)"; FAIL=1; } \
    || say V7 "A+B 在 index → A 寫標記 → B pathspec commit" "✅ 被擋(git 給 hook 一個暫時 index ⇒ tree 對不上)"
fi

printf '\n總判:'
[ "$FAIL" -eq 0 ] && printf 'V1-V7 全部符合預期\n' || printf '🔴 有格不符預期\n'
printf '🛑 本發證不到:主樹的部署態 / husky 接線 / 「這片到底審過了沒」—— 那不是任何一道閘答得出來的。\n'
exit "$FAIL"
