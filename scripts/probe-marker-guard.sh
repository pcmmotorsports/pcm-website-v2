#!/usr/bin/env bash
# ============================================================================
# probe-marker-guard.sh — docs/probes/ 底下每支探針都要宣告 CI 可跑性
#
# 🔴🔴 本守門【目前未接進 CI ⇒ 不會自動跑 ⇒ 現在「沒有東西在守」】。
#    它是一支【寫好但沒接線】的守門 —— 跟 cf 今天量到的 pcm_op1_acl_not_zero 同族:
#    看起來裝上了,實際上不會替任何人擋任何東西,直到有人把它接進 .github/。
#    ⚠️ 在接線之前,不要在任何 commit/報告寫「探針標記已有守門」—— 那句話現在是假的。
#
#    要接的地方(動 .github/ = 鐵則 12④,由管 .github 的窗做,不在本腳本作者的授權內):
#      · .github/workflows/ci.yml:233  現在只 `find *.sh` ⇒ 分母漏掉 .sql
#      · .github/workflows/ci.yml:272-274  現在【印】無標記檔卻【不 exit】⇒ rc=0、不擋
#    接法 = 在那個 step 裡呼叫本腳本並讓它的非 0 rc 冒泡(bash scripts/probe-marker-guard.sh)。
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
MARKER_RE='^(#|--)[[:space:]]*ci-self-contained:[[:space:]]*(yes|no)([[:space:]]|$)'

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
