#!/usr/bin/env bash
# scripts/revert-runbook-gate.selftest.sh —— `.husky/prepare-commit-msg` 的四個世界
#
# 🔴 為什麼需要這一支:那道 hook 只在【有人 revert 一顆帶 runbook 提示的 commit】時才動,
#    而那件事一年可能發生一次 ⇒ **它壞掉之後, 要到最需要它的那天才會被發現。**
#    而它壞掉的樣子是【安靜】—— 與「不該叫時安靜」印同一個東西。
#
# 🔴 本檔跑在【拋棄式 repo】裡, 不碰任何真的樹。
#    剝掉繼承來的 git 環境變數(快速自檢清單那一格;`git -C` 擋不住它們)。
set -u
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE 2>/dev/null || true

HOOK_SRC="$(cd "$(dirname "$0")/.." && pwd)/.husky/prepare-commit-msg"
[ -f "$HOOK_SRC" ] || { printf '🔴 找不到 %s\n' "$HOOK_SRC" >&2; exit 1; }

FAILS=0
ck() {  # ck <名字> <實得> <期望>
  if [ "$2" = "$3" ]; then printf '  ✅ %s:%s\n' "$1" "$2"
  else printf '  🔴 %s:%s(期望 %s)\n' "$1" "$2" "$3"; FAILS=$((FAILS+1)); fi
}

T=$(mktemp -d "${TMPDIR:-/tmp}/revrb.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1
# 🔴 比 inode, 不比字串 —— macOS 的 /var 是 /private/var 的 symlink ⇒ `pwd` 回實體路徑,
#    而 `$T` 帶著 symlink ⇒ 字串比對【必然不相等】, 那道守門會在每一台 mac 上誤擋。
[ . -ef "$T" ] || { printf '🔴 cd 失敗, 不在拋棄式樹裡 ⇒ 停\n' >&2; exit 1; }

git init -q . && git config user.email t@t && git config user.name t && git config commit.gpgsign false
mkdir -p .githooks docs/runbooks
cp "$HOOK_SRC" .githooks/prepare-commit-msg && chmod +x .githooks/prepare-commit-msg
git config core.hooksPath .githooks

printf '不要只做:先把 env 拿掉 —— 那救不了已經簽出去的票\n要做:換 ADMIN_SESSION_SECRET ⇒ 全員重登\n沒有任何機制在執行這一條。\n' \
  > docs/runbooks/2026-08-24-b5a-identity-rollout.md
echo base > f0.txt
git add f0.txt docs/runbooks/2026-08-24-b5a-identity-rollout.md && git commit -qm one
# 🔴 每一顆動【不同的檔】—— 第一版讓三顆都動同一支檔, 結果每一發 revert 都是【衝突】,
#    revert 根本沒產生 commit, 而 grep 咬到 git 自己 hint 裡的字, 印出一個假的 PASS。
echo x > fA.txt && git add fA.txt \
  && git commit -qm 'B5-a 後台吃身分 —— revert 前先讀 runbook 2026-08-24-b5a-identity-rollout'
echo y > fB.txt && git add fB.txt && git commit -qm 'feat(ui): 換個按鈕顏色'
echo z > fC.txt && git add fC.txt && git commit -qm 'chore: revert 前先讀 runbook zzq-nonexistent-9999'

printf -- '-- 世界 A · revert 一顆帶 runbook 提示的 --\n'
git revert --no-edit HEAD~2 > /dev/null 2> a.err
RC_A=$?
ck 'revert 真的成功了(不是卡在衝突)' "$RC_A" 0
ck '它出聲了'                    "$(grep -c '你正在 revert' a.err)" 1
ck '而且貼出 runbook 的逐字內容'  "$(grep -c '救不了已經簽出去的票' a.err)" 1
ck 'commit body 零汙染'          "$(git log -1 --format=%B | grep -c '^#')" 0

printf -- '-- 世界 B · revert 一顆普通的(必須安靜)--\n'
git revert --no-edit HEAD~2 > /dev/null 2> b.err
ck 'stderr 位元組'               "$(wc -c < b.err | tr -d ' ')" 0

printf -- '-- 世界 C · runbook 名抽得到而檔案在不在 --\n'
git revert --no-edit HEAD~2 > /dev/null 2> c.err
ck '誠實說找不到, 不假裝有內容'   "$(grep -c '找不到它' c.err)" 1
ck 'commit body 零汙染'          "$(git log -1 --format=%B | grep -c '^#')" 0

printf -- '-- 世界 D · 一般 commit(必須安靜)--\n'
echo w > fD.txt && git add fD.txt && git commit -qm '一般片' 2> d.err
ck 'stderr 位元組'               "$(wc -c < d.err | tr -d ' ')" 0

if [ "$FAILS" -eq 0 ]; then printf 'SELFTEST PASS\n'; exit 0; fi
printf 'SELFTEST FAIL:%s 格\n' "$FAILS"; exit 1
