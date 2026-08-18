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

# ── 部署狀態:push 之後【沒有人在看那個部署】是 2026-08-18 記下的缺口 ──────────
#   `dev` = pcm-admin 的 production 分支 ⇒ 每次 push 都會觸發後台重新部署,
#   而**那件事今天之前不在任何人的常設動作裡**(當天是主視窗事後補查才知道它 Ready)。
#
# 🔴 三條約束(逐條都有理由,不要簡化掉):
#   ① **量不到就寫「量不到」,不要留白** —— 留白會被讀成「沒問題」。
#   ② **Production 與 Preview 分開印** —— 它們在 `vercel ls` 的輸出裡長得幾乎一樣,
#      而「客人看到了沒」只有 Production 那一列答得出來。
#   ③ **等待有上限,而「還在 Building」不是失敗** ⇒ 印成【未完成】,不是【失敗】。
#      (2026-08-18 實測 admin 建置 29 秒,但那不是保證。)
#
# ⚠️ 天花板:本段只在**用這支腳本推**的時候有效;直接 `git push` 一樣沒有人在看。
#
# ── ✅ 2026-08-18 17:5x G1:**這一半【已經對真的 vercel CLI 實測過】** ──────────
#   在此之前本檔整支被標成「零實測」(它只通過自己的 --selftest,而那用的是樁)。
#   🔴 **那個標法現在要拆成兩半講,不要再整支這樣標**:
#     ✅ deploy_status() 這一半  = 真實測過(下面那道命令,任何人可重跑)
#     🔴 push + 廣播 那一半      = 仍然零實測 —— 它需要一次【真的 push】,仍等 Sean
#   量法(不執行主流程、不推任何東西;抽出函式餵真 CLI):
#     sed -n '44,80p' scripts/push-and-announce.sh > /tmp/ds.sh
#     sh -c '. /tmp/ds.sh; deploy_status pcm-admin; deploy_status pcm-website-v2'
#   當時的輸出:兩個專案各印出 Production 與 Preview 兩列 + `⇒ ✅ Production Ready`,rc=0。
#   🔴 **順帶推翻一個我自己先前的擔心**:本函式呼叫的是 `vercel ls <專案名>`、**沒有 `--scope`**,
#      而它照樣解得到 `pcm-motorsports` ⇒ **不需要補 `--scope`**。
#   ⚠️ 射程:這證的是「量得到、格式對、rc=0」,**證不出**「push 之後它會等到正確的那一發」——
#      那條路徑(推完 → 輪詢 → Ready)要真的 push 才走得到。
VERCEL_BIN="${VERCEL_BIN:-vercel}"
DEPLOY_WAIT_MAX="${DEPLOY_WAIT_MAX:-180}"   # 秒;上限,不是保證

deploy_status() {  # $1=vercel 專案名
  _proj="$1"
  if ! command -v "$VERCEL_BIN" >/dev/null 2>&1; then
    printf '%s: 🔴 量不到 —— `%s` 不在 PATH（沒裝或沒登入）。**這一格不是「沒問題」,是沒量到。**\n' \
      "$_proj" "$VERCEL_BIN"
    return 0
  fi
  _waited=0
  while :; do
    _out=$("$VERCEL_BIN" ls "$_proj" 2>&1) || {
      printf '%s: 🔴 量不到 —— `%s ls` 失敗(未登入 / 專案名不對 / 網路)。**沒量到,不是沒問題。**\n' \
        "$_proj" "$VERCEL_BIN"
      return 0
    }
    # 最新那一列 Production
    _prod=$(printf '%s' "$_out" | grep 'Production' | head -1)
    case "$_prod" in
      *Ready*|*Error*|*Canceled*) break ;;
    esac
    [ "$_waited" -ge "$DEPLOY_WAIT_MAX" ] && break
    sleep 10
    _waited=$((_waited + 10))
  done
  _prev=$(printf '%s' "$_out" | grep 'Preview' | head -1)
  # 🔴 兩種環境分開印;各自沒有就明說「這次沒有」,不要留白
  printf '%s Production: %s\n' "$_proj" "${_prod:-🔴 這次的輸出裡沒有 Production 那一列（沒量到，不是沒有部署）}"
  printf '%s Preview   : %s\n' "$_proj" "${_prev:-（本次輸出無 Preview 列）}"
  case "$_prod" in
    *Ready*)  printf '%s ⇒ ✅ Production Ready\n' "$_proj" ;;
    *Error*)  printf '%s ⇒ 🔴 Production Error —— 有人要去看\n' "$_proj" ;;
    *)        printf '%s ⇒ ⏳ **未完成**（等了 %s 秒仍未 Ready）—— 這【不是失敗】,是還沒好或我沒等到\n' \
                "$_proj" "$_waited" ;;
  esac
}

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
    printf '⚠️ 本信只說「推了什麼」,**不說「它被驗過」** —— 那是另一件事,問推的人要四綠的 sha。\n\n'
    printf '## 部署(push 之後量的;`dev` = pcm-admin 的 production 分支)\n\n```\n'
    deploy_status pcm-admin
    printf -- '---\n'
    deploy_status pcm-website-v2
    printf '```\n'
    printf '🔴 **Production 與 Preview 是兩件事** —— storefront 那邊常常只有 Preview,'
    printf '而 Preview 不代表客人看到了。\n'
    printf '⚠️ 出現「量不到」或「未完成」⇒ **那一格沒有人看過**,要有人去補;'
    printf '**留白與「沒問題」在這裡是同一種字面,所以本段不留白。**\n'
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

  echo "== 世界三:部署【量得到】⇒ 信裡要有 Production 那幾行 =="
  # 用一個假的 vercel 樁,兩個世界都不碰真的網路
  cat > "$T/fake-vercel" <<'STUB'
#!/bin/sh
echo "  Age  Project  Deployment  Status  Environment  Duration"
echo "  1m   x/y      https://z   ● Ready  Production   29s"
echo "  2m   x/y      https://z2  ● Ready  Preview      31s"
STUB
  chmod +x "$T/fake-vercel"
  C=$(VERCEL_BIN="$T/fake-vercel" deploy_status pcm-admin | grep -c 'Production' || true)
  echo "  Production 行數 $C   期望 >=1"

  echo "== 世界四:部署【量不到】⇒ 信裡要有「量不到」那句(不可留白) =="
  D=$(VERCEL_BIN="$T/definitely-not-installed-$$" deploy_status pcm-admin | grep -c '量不到' || true)
  echo "  「量不到」行數 $D   期望 1"

  echo "  (跑的是 $(command -v git) / $(command -v find))"
  if [ "$A" = "1" ] && [ "$B" = "0" ] && [ "$C" -ge 1 ] && [ "$D" = "1" ]; then
    echo "✅ 四個世界都對:成功才寫信、失敗不寫信、量得到印狀態、量不到明說量不到"
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
