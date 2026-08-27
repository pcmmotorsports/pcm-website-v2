#!/usr/bin/env bash
# ============================================================================
# probe-marker-guard.sh — docs/probes/ 底下每支探針都要宣告 CI 可跑性
#
# 🔵 **2026-08-27 由下手窗 `-de` 接進 CI**(鐵則 12④:code-reviewer + codex 兩輪皆 FAIL、findings 已折)。
#    ~~原文:「本守門目前未接進 CI ⇒ 現在沒有東西在守」~~ ⇒ **那句話不再成立, 留字為證。**
#    🔴 **本行不是證據, 當場自己驗**(錨到【呼叫本身】, 不是檔名字串 —— code-reviewer must-fix:
#       原自驗寫 `grep -c 'probe-marker-guard.sh' ci.yml` ⇒ 命中 2, 其中一個是註解
#       ⇒ **把真正的呼叫刪掉, 它仍會印 1 仍會說「已接線」**):
#         grep -cE '^[[:space:]]*bash scripts/probe-marker-guard\.sh$' .github/workflows/ci.yml
#         負對照 grep -cE '^[[:space:]]*bash scripts/zzz-no-such-guard\.sh$' .github/workflows/ci.yml
#    🔴 **不寫行號** —— 接線那天量到本 repo 有數處引用 `rpm-sync.yml:73` 而 matrix 在 `:72`,
#       而 `:73` 仍解析得出東西(`steps:`)⇒ **一個死掉的行號引用與一個活的長得一模一樣。**
#       ⚠️ 那個處數我報過 5、code-reviewer 用它自己的範圍量到 3 ⇒ **兩個數沒有跟著範圍走**
#          ⇒ 這裡不寫數字, 要用當場跑:grep -rn 'rpm-sync\.yml:73' --include='*.ts' --include='*.tsx' \
#             --include='*.sql' --include='*.md' . | grep -v node_modules
#
#    ⚠️ 接線時**沒有**把 `.sql` 加進 ci.yml 那個 `find`(理由寫在 ci.yml 該處):
#      那個 find 餵的是 `bash "$P"` 執行迴圈 ⇒ 放 `.sql` 進去會被 bash 當腳本跑,
#      且標記語法不同(`--` vs `#`)⇒ `.sql` 會兩張清單都不進、靜默消失, 比原狀更糟。
#      `.sql` 的分母由**本腳本**顧;ci.yml 那邊另擋一種假承諾:標了 `yes` 的 `.sql`。
#
# 為什麼要它:.github/workflows/ci.yml 的「Run self-contained SQL probes」step 靠
#   `# ci-self-contained: yes|no` 這個標記認領要跑的探針。缺標記的探針【永遠不會被跑】,
#   而 rc=0、沒有東西紅 ⇒ 一支保護某條路的探針靜靜地從沒執行過。名字說 SQL、尺卻只看 .sh。
#
# 本守門做的:掃 docs/probes/*.sh 與 *.sql,每一支的前 5 行必須有一行
#   `# ci-self-contained: yes|no`(.sh)或 `-- ci-self-contained: yes|no`(.sql)。
#   缺任何一支 ⇒ 列出來 + exit 1。全部有 ⇒ exit 0。
#   🔴 這裡只驗「有沒有宣告」,不驗「宣告得對不對」—— 對不對要人看檔頭(見那兩支的理由行)。
#
# 用法:
#   bash scripts/probe-marker-guard.sh            # 掃真正的 docs/probes/
#   PROBE_DIR=/tmp/fixtures bash scripts/probe-marker-guard.sh   # 掃指定目錄(給驗收用)
# ============================================================================
set -u

DIR="${PROBE_DIR:-docs/probes}"

if [ ! -d "$DIR" ]; then
  echo "🔴 找不到目錄:$DIR" >&2
  exit 2
fi

# 標記正則:comment leader(# 或 --)+ ci-self-contained: + 明確的 yes|no。
# 只寫 key 不寫 yes/no(例 `ci-self-contained: maybe`)也算缺 —— 宣告要能被機器讀。
# 🔴 **2026-08-27 收緊(code-reviewer must-fix):原式允許 `#ci-self-contained: yes`(無空白)
#    與多空白, 而 ci.yml 的 `case` 比的是子字串 `'# ci-self-contained: yes'`(單空白)
#    ⇒ 那種寫法【守門說 PASS 而 CI 兩張清單都不進、靜默不跑】。**兩把尺不同寬 = 假綠。**
#    收緊後現有 19 支仍 19/19 通過(當場量);負對照三種寫法皆被擋:
#      '#ci-self-contained: yes' / '#  ci-self-contained: yes' / '-- ci-self-contained: maybe'
#    ⚠️ 標記行【後面可以接理由】(現有 18/19 都接了)—— 收的是前綴空白, 不是行尾。
MARKER_RE='^(# |-- )ci-self-contained: (yes|no)([[:space:]]|$)'

missing=""
total=0
# find 而非 glob:空目錄不會吐出字面 '*.sh';逐一 read,不靠變數斷詞。
while IFS= read -r f; do
  total=$((total + 1))
  if ! head -5 "$f" | grep -qE "$MARKER_RE"; then
    missing="${missing}${f}"$'\n'
  fi
done < <(find "$DIR" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.sql' \) | sort)

echo "掃描目錄:$DIR(.sh + .sql 共 $total 支)"

if [ -n "$missing" ]; then
  echo "🔴 FAIL — 下列探針前 5 行【沒有 ci-self-contained 標記】,永遠不會被 CI 認領:"
  printf '%s' "$missing" | while IFS= read -r m; do
    [ -n "$m" ] || continue
    echo "  $m"
  done
  echo "  ⇒ 每支補一行(.sh 用 '# ci-self-contained: yes|no'、.sql 用 '-- ci-self-contained: yes|no')"
  exit 1
fi

echo "✅ PASS — 全部 $total 支都有標記。"
exit 0
