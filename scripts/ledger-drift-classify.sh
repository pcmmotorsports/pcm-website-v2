#!/bin/sh
# scripts/ledger-drift-classify.sh —— 「帳本 sha 對不上時, 那到底是哪一種」的【單一來源】
# ============================================================
# 🔴 **為什麼是單一來源**(主視窗 `-f8` 2026-09-06 逐字「不要再手寫一份等價迴圈」):
#    這個判斷有兩個消費端 —— `scripts/deploy-order-gate.sh` 的修法丙(要不要降級成警告)
#    與 `scripts/ledger-col2-census.py` 的 ③a/③b 分類(要不要算進升乙的分子)。
#    **兩份等價的碼會分岔, 而分岔時沒有東西會叫。**
#
# 用法:  sh scripts/ledger-drift-classify.sh <repo 內路徑> <帳本記的 raw sha> <被比的 rev>
# 印出:  `drift <找到的 rev>`     ⇒ 歷史上那一版存在, 而剝掉整行註解與空行之後【碼相同】
#        `changed <找到的 rev>`   ⇒ 歷史上那一版存在, 而剝完【不同】= 它真的變了
#        `notfound`               ⇒ 歷史上找不到 raw sha 等於帳本那一格的那一版 ⇒ **不猜**
# rc:    一律 0(它是分類器不是閘)。參數不足 / 讀不到 ⇒ 印 `notfound`。
#
# 🔴 **歷史只查 `origin/dev`, 而且寫死** —— `--all` 看得到的 ref 集合每台機器不一樣
#    ⇒ 同一支檔 A 的機器降得了、B 的降不了 = 不對稱(2026-09-06 `-f8` 裁)。
# 🛑 **降級要兩個條件同時成立**:①那一版的 raw sha **逐字元**等於帳本那一格 ②剝完之後相同。
#    少了①就是拿一個沒人記過的版本去背書。
set -u
CDPATH= cd "$(dirname "$0")/.." || { echo notfound; exit 0; }
STRIP="scripts/lib-ledger-drift-strip.sh"
[ -f "$STRIP" ] || { echo notfound; exit 0; }   # 剝法那支不在 ⇒ 不猜

f="${1:-}"; rec="${2:-}"; rev="${3:-}"
[ -n "$f" ] && [ -n "$rec" ] && [ -n "$rev" ] || { echo notfound; exit 0; }

LEDGER_HISTORY_REF='origin/dev'
found=''
for r in $(git log "$LEDGER_HISTORY_REF" --format=%H -- "$f" 2>/dev/null); do
  if [ "$(git show "$r:$f" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)" = "$rec" ]; then
    found="$r"; break
  fi
done
[ -n "$found" ] || { echo notfound; exit 0; }

# 🔵 `<rev>` 給 `WORKTREE` = 比【工作樹那一份】(census 用;閘給的是被推的那棵樹的 rev)。
if [ "$rev" = "WORKTREE" ]; then
  cur="$(sh "$STRIP" < "$f" 2>/dev/null)"
else
  cur="$(git show "$rev:$f" 2>/dev/null | sh "$STRIP")"
fi
old="$(git show "$found:$f" 2>/dev/null | sh "$STRIP")"
# 🔴 兩邊都剝成空的話 sha 也會相等 ⇒ 那不是「碼相同」, 是「沒有碼」。擋掉。
[ -n "$cur" ] || { echo "changed $found"; exit 0; }
cs="$(printf '%s' "$cur" | shasum -a 256 | cut -d' ' -f1)"
os="$(printf '%s' "$old" | shasum -a 256 | cut -d' ' -f1)"
# 🔴 兩條 checksum 管線同時失敗會讓空字串相等而放行 ⇒ 兩個值都要長得像 sha256。
case "$cs" in *[!0-9a-f]*) echo "changed $found"; exit 0 ;; esac
case "$os" in *[!0-9a-f]*) echo "changed $found"; exit 0 ;; esac
[ "${#cs}" = "64" ] && [ "${#os}" = "64" ] || { echo "changed $found"; exit 0; }
[ "$cs" = "$os" ] && echo "drift $found" || echo "changed $found"
