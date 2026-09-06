#!/bin/sh
# cron 白名單漂移閘 —— ⟦f3-ALLOWLISTMANUAL1⟧(板列 694;2026-09-07 主視窗批 -ship 做)。
#
# 🔴 守的是:有人加了一條排程而 CRON_JOB_WHITELIST 沒跟上
#    ⇒ 那條排程死掉不會有任何訊號, 而「沒有人在看」與「一切正常」在畫面上是同一個東西。
#
# 🔬 codex gpt-5.6-sol 2026-09-07 R1 判 FAIL, 本版是照它修完的。它抓到的四條都在下面留了記號:
#   ① `git diff` 自己失敗不會被 `set -u` 攔 ⇒ 空集合走「跳過」⇒ **量具故障變成 rc=0**
#   ② `grep … || true` 同時吞掉【零命中】與【grep 自己出錯】—— 後者也被當成正常跳過
#   ③ `--diff-filter=ACMR` 漏掉【刪除】;而刪一支 migration 一樣會改變輸入集合
#   ④ 路徑用 shell 斷詞會被含空白/Git C-style quoting 的檔名弄壞 ⇒ 走 `-z` NUL 分隔
#
# ⚠️ 它只在【這次 staged 有碰到那兩邊】時才有話說(沒碰到 ⇒ 自己跳過、印一行)。
# 🛑 而**跳過要印一行** —— 一個安靜的跳過, 與一個安靜的通過, 在輸出上是同一個畫面。
set -u

# 🔴 **本薄殼要求【自己在版控或 index 裡】**(codex must-fix ③):
#    漏 `git add` 這支時, 本次 commit 照樣通過, 而乾淨 checkout 會拿到一支引用不存在檔案的 hook。
#    🛑 而這一格**放在薄殼自己而不是 pre-commit 的主幹** —— 2026-09-07 實測:放主幹會讓
#      `scripts/state-gates-freshness.harness.sh` 的拋棄式世界(其他閘 stub、檔案不進版控)
#      在抵達 lint-staged 之前就被我擋掉 ⇒ 格9a 判紅。
#      📌 **一道正確的閘放錯位置, 會擋掉一條它不該管的路。**
#    🔴 而它也**不能放在「沒命中就早退」之後** —— 2026-09-07 實測:放那裡時, 薄殼未進版控
#      而本次沒 staged 到相關檔 ⇒ 它印「跳過」rc=0, 那一格等於不存在。
#      ⇒ 📌 **一道閘的位置決定它守得到哪些世界, 而「它在檔案裡」不代表「它會被執行到」。**
if git ls-files --error-unmatch .husky/cron-allowlist-drift-gate.sh > /dev/null 2>&1 \
   || git cat-file -e :.husky/cron-allowlist-drift-gate.sh 2>/dev/null; then
  :
else
  printf '%s\n' '🔴 .husky/cron-allowlist-drift-gate.sh 不在版控也不在 index ⇒ 擋下' >&2
  printf '%s\n' '   修法:git add .husky/cron-allowlist-drift-gate.sh' >&2
  exit 1
fi


# 🔴🔴 **不要把 `-z` 的輸出丟進 `$(...)`** —— **命令替換會把 NUL 位元組吃掉**,
#    整串路徑黏成一行 ⇒ 過濾一個都對不上 ⇒ **它安靜地印「跳過」。**
#    🔬 2026-09-07 實測:我為了修 codex 那條「路徑斷詞」而改用 `-z`, 結果 staged 了 cron-jobs.ts
#      而本閘照樣印跳過 —— **一個為了更安全而做的改動, 把整道閘關掉了, 而輸出看起來一切正常。**
#    ✅ 改成:git 的輸出直接寫進暫存檔(不經變數), rc 單獨收, 再讓 grep 讀那支檔。
#      路徑含空白沒問題(逐行讀);Git 對怪字元本來就會加引號 ⇒ 那種路徑不會誤命中我們這兩個樣式。
TMP="$(mktemp -t cron-allowlist-gate)"
trap 'rm -f "$TMP"' EXIT
git diff --cached --name-only --diff-filter=ACMRD > "$TMP" 2>/dev/null
GIT_RC=$?
if [ "$GIT_RC" -ne 0 ]; then
  printf '%s\n' "🔴 cron 白名單漂移閘:git diff --cached 失敗(rc=$GIT_RC)⇒ 擋下(不放行)" >&2
  printf '%s\n' '   量具自己壞掉時, 它印的「沒有命中」與「真的沒有」是同一句話。' >&2
  exit 1
fi

# grep 的 rc 分三態:0 命中 / 1 零命中 / >1 它自己出錯。第三態不可以被當成第二態。
HIT="$(grep -E '^(packages/domain/src/ops/cron-jobs\.ts|supabase/migrations/.+\.sql)$' "$TMP")"
GREP_RC=$?
if [ "$GREP_RC" -gt 1 ]; then
  printf '%s\n' "🔴 cron 白名單漂移閘:grep 自己出錯(rc=$GREP_RC)⇒ 擋下(不放行)" >&2
  exit 1
fi

if [ -z "$HIT" ]; then
  printf '%s\n' '⏭️  cron 白名單漂移閘:本次未 staged cron-jobs.ts 或 migrations/*.sql ⇒ 跳過'
  exit 0
fi

if [ ! -f scripts/cron-allowlist-drift-gate.py ]; then
  printf '%s\n' '🔴 scripts/cron-allowlist-drift-gate.py 不見了 ⇒ 擋下(不放行)' >&2
  printf '%s\n' '   復原:git checkout -- scripts/cron-allowlist-drift-gate.py' >&2
  exit 1
fi

# 🔴 `--staged`:hook 判的是 index, 腳本就必須也讀 index。
#    讀工作樹會在「只 staged 一半」時誤判相等而放行(codex must-fix)。
python3 scripts/cron-allowlist-drift-gate.py --staged
