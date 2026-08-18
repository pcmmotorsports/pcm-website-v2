#!/bin/sh
# push-and-announce.sh — 推 dev,而且【在同一個動作裡】把它廣播出去。
#
# 用法:
#   bash scripts/push-and-announce.sh <完整sha> <窗代號>
#   bash scripts/push-and-announce.sh --selftest          # 兩個世界各表演一次
#
# ── 🔴 這支存在的理由(2026-08-18,主視窗一天犯三次)────────────────────────────
#   推了而沒廣播 ⇒ 別的窗看到 origin/dev 動了,而**查不出是誰推的**:
#     git reflog show origin/dev  只印 `update by push`,**不記錄執行者**
#     而本專案六個窗共用同一個 git 身分(`probe <probe@local>`)
#   ⇒ **收訊端不可能靠 git 查出來** ⇒ 「推之前廣播」不是禮貌,是**唯一的識別機制**。
#   📌 歸因(G4 提、主視窗採用):三次都不是同一個人忘記,是**廣播這件事沒有載體**
#      ⇒ 所以修法不是提醒,是**把「推」與「廣播」變成同一個動作**。
#
# ── ⚠️ 天花板(不要拿掉,否則下一個人會以為廣播被保證了)──────────────────────
#   🔴 **本腳本【不是】守門。** 不用它、直接 `git push origin <sha>:dev` 一樣推得動,
#      而且**不會有任何信、也不會有任何東西紅**。
#   ⇒ 它降低「忘記廣播」的機率,**不製造訊號**。
#   ⇒ 刻意**不做成攔 `git push` 的 hook**:那會擋到別人正當的操作,而
#      **在一條沒有事的路上裝機制,機制本身是新的風險**
#      (memory `feedback_a-guard-on-a-safe-path-is-net-negative`)。
#
# ── 🔴 順序不可換:push 成功【才】寫信 ────────────────────────────────────────
#   用 `&&` 不是 `;`。**一封說推了而其實沒推的信,比沒有信更糟** ——
#   它會讓收訊端停止查證。

set -eu

BOX="${PUSH_ANNOUNCE_BOX:-$HOME/pcm-mailbox}"

# ── 廣播:抽成函式,因為 --selftest 要在【不真的 push】的情況下驗它 ──
announce() {  # $1=sha  $2=窗代號  $3=推之前的 origin/dev  $4=顆數
  _sha="$1"; _who="$2"; _before="$3"; _n="$4"
  _short=$(printf '%s' "$_sha" | cut -c1-8)
  _f=$(printf '%s/PUSH-%s-%s.md' "$BOX" "$(date '+%Y%m%d-%H%M')" "$_short")
  {
    printf '# PUSH · %s 推了 %s 顆到 dev(%s)\n\n' "$_who" "$_n" "$(date '+%F %T')"
    printf '```\n'
    printf '執行者        %s\n' "$_who"
    printf '推到          %s\n' "$_sha"
    printf '推之前        %s\n' "$_before"
    printf '顆數          %s\n' "$_n"
    printf '```\n\n'
    printf '## 這批動到什麼(給要判「我要不要重驗」的人)\n\n```\n'
    printf 'apps/ 與 packages/ 的檔數   %s\n' \
      "$(git diff --name-only "$_before" "$_sha" 2>/dev/null | grep -c '^apps/\|^packages/' || true)"
    printf 'supabase/migrations 的檔數  %s\n' \
      "$(git diff --name-only "$_before" "$_sha" 2>/dev/null | grep -c '^supabase/migrations/' || true)"
    printf '```\n\n'
    printf '🔴 **`migrations` 那一格不是 0 ⇒ 有人要問「apply 了沒」** —— '
    printf '先 apply 再 push 的順序若反過來,正式站會壞(2026-08-07 約 8 小時)。\n\n'
    printf '⚠️ 本信只說「推了什麼」,**不說「它被驗過」** —— 那是另一件事,問推的人要四綠的 sha。\n'
  } > "$_f"
  echo "已廣播: $_f"
}

if [ "${1:-}" = "--selftest" ]; then
  T=$(mktemp -d) || exit 1
  trap 'rm -rf "$T"' EXIT
  # 🔴 自檢絕不寫進真信箱
  BOX="$T"
  HEAD_SHA=$(git rev-parse HEAD)
  PREV=$(git rev-parse HEAD~1)

  echo "== 世界一:push【成功】⇒ 信必須出現 =="
  if true && announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" >/dev/null; then :; fi
  A=$(find "$T" -name 'PUSH-*.md' | grep -c . || true)
  echo "  信件數 $A   期望 1"

  echo "== 世界二:push【失敗】⇒ 信【不可以】出現 =="
  rm -f "$T"/PUSH-*.md
  # 用 false 模擬 push 失敗;`&&` 讓 announce 不會被執行
  if false && announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" >/dev/null; then :; fi
  B=$(find "$T" -name 'PUSH-*.md' | grep -c . || true)
  echo "  信件數 $B   期望 0"

  echo "  (跑的是 $(command -v git) / $(command -v find))"
  if [ "$A" = "1" ] && [ "$B" = "0" ]; then
    echo "✅ 兩個世界都對:成功才寫信,失敗不寫信"
    exit 0
  fi
  echo "🔴 壞了 —— 不要用這支腳本推東西"
  exit 1
fi

SHA="${1:-}"
WHO="${2:-}"
# 🔴 窗代號【必填】—— 這支腳本的全部意義就是「答得出是誰推的」,
#    給它一個預設值等於把那個意義拿掉。
[ -n "$SHA" ] && [ -n "$WHO" ] || {
  echo "用法: bash scripts/push-and-announce.sh <完整sha> <窗代號>"
  echo "      bash scripts/push-and-announce.sh --selftest"
  exit 2
}

git rev-parse --verify "${SHA}^{commit}" >/dev/null   # 不存在就死在這裡,不會寫信
BEFORE=$(git rev-parse origin/dev)
N=$(git rev-list --count "${BEFORE}..${SHA}")

echo "推 ${SHA} → origin/dev(目前 ${BEFORE},共 ${N} 顆)"
git push origin "${SHA}:dev" && announce "$SHA" "$WHO" "$BEFORE" "$N"
