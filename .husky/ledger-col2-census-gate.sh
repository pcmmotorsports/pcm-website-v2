#!/bin/sh
# .husky/ledger-col2-census-gate.sh —— 薄殼:帳本第二欄「在量哪一個東西」的普查閘
# 🔴 為什麼要這層薄殼:照 `.husky/applied-ledger-dup-gate.sh` 檔頭那句 ——
#    `scripts/state-gates-freshness.harness.sh` 的 stub 射程是【.husky/*.sh】
#    ⇒ 直接在 pre-commit 叫 scripts/… 會讓那份 harness 紅, 而理由與它要驗的事無關。
#
# 🎯 **它擋什麼**:`supabase/APPLIED.tsv` 第二欄有兩種用途共用一欄 ——
#    ① repo 那支 migration 檔的 sha(部署閘比的就是它)
#    ② 貼給 Sean 的那一份的 sha(= repo 檔 + 白話抬頭)
#    2026-09-06 逐列量到 ①334 / ②5 / ③兩者都不是 5(三數和 = 344 = 資料列數)。
#    主視窗 `-f8` 裁:**②+③ ≤ 10 維持甲(不動欄位格式);> 10 ⇒ 乙(加第三欄)要重開。**
#
# 🛑 **它答不出什麼**(跟著輸出一起印):它只答「那一欄在量哪個東西」, **不答帳本對不對** ——
#    一列記了一支根本沒 apply 的 migration, 這道閘照樣綠。
#
# ⚠️ **射程**:只在 `supabase/APPLIED.tsv` **被 staged** 時才有話說;沒 staged ⇒ 自己跳過、印一行。
#    ⇒ 📌 **它讀的是【staged 那一份】不是工作樹那一份** —— 兩者不同時, 讀工作樹會答錯
#      「這一顆 commit 會不會讓數字過線」。
set -eu
CDPATH= cd "$(dirname "$0")/.." || exit 1

if [ ! -f scripts/ledger-col2-census.py ]; then
  printf '%s\n' '🔴 scripts/ledger-col2-census.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/ledger-col2-census.py' >&2
  exit 1
fi

# 🔴🔴 code-reviewer R1 #2:原本是 `git diff … | grep -qx …` ——
#    `#!/bin/sh` **給不了 `pipefail`** ⇒ git 失敗時 grep 收到空輸入 ⇒ 不命中 ⇒ 走去印「跳過」rc=0
#    ⇒ 📌 **「git 壞了」與「沒 stage 帳本」印同一句、同一個 rc。**
#    ✅ 先把清單落檔並且 `|| exit 1`, 再對【檔】grep。
# 🔴 R1 #3:`mktemp -t <prefix>` 沒有 `XXXXXX` 是 **BSD-only**(`shell-dialect-gate` 命中 2 處)
#    ⇒ GNU 上會失敗 ⇒ `|| exit 1` ⇒ **每一顆動帳本的 commit 都被擋**。✅ 補 `.XXXXXX`。
STAGED="$(mktemp -t ledgercol2.staged.XXXXXX)" || exit 1
TMP="$(mktemp -t ledgercol2.blob.XXXXXX)" || { rm -f "$STAGED"; exit 1; }
trap 'rm -f "$STAGED" "$TMP"' EXIT

if ! git diff --cached --name-only --diff-filter=ACMR > "$STAGED"; then
  printf '%s\n' '🔴 讀不出 staged 檔案清單(git 失敗)⇒ 擋下 —— 這【不是】「沒 stage 帳本」' >&2
  exit 1
fi
if ! grep -qx 'supabase/APPLIED.tsv' "$STAGED"; then
  printf '%s\n' 'ledger-col2-census:本次沒有 stage supabase/APPLIED.tsv ⇒ 跳過(不是「檢查過而乾淨」)' >&2
  exit 0
fi
# 🔴 讀 index 那一份。讀不出來一律擋下 —— 靜默退回工作樹會讓這道閘量到【另一個東西】。
if ! git show :supabase/APPLIED.tsv > "$TMP" 2>/dev/null; then
  printf '%s\n' '🔴 讀不出 staged 的 supabase/APPLIED.tsv ⇒ 擋下(不猜, 不退回工作樹那一份)' >&2
  exit 1
fi
# 🔴 R1 #4:原本用 `exec` ⇒ **行程被換掉 ⇒ EXIT trap 永遠不跑** ⇒ 每次真跑漏一個約 240KB 的暫存檔
#    (reviewer 實測 before=2 after=3)。✅ 收 rc、自己刪、再用那個 rc 退出。
# 🔴 R2 nit ①:上面是 `set -eu` ⇒ **裸呼叫一失敗就【當場退出】**, `rc=$?` / `rm` / `exit` 三行根本跑不到
#    ⇒ 註解說「收 rc、自己刪」而**擋下的那條路上暫存檔還是會漏**(而 EXIT trap 這時才是唯一收拾的人)。
#    ✅ `|| rc=$?` 讓那次失敗算「被檢查過」⇒ `set -e` 不會中斷, 而 rc 收得到。
rc=0
python3 scripts/ledger-col2-census.py --gate --ledger "$TMP" || rc=$?
rm -f "$STAGED" "$TMP"
exit $rc
