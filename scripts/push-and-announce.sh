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
announce() {  # $1=sha  $2=窗代號  $3=推之前的 origin/dev  $4=顆數  $5=四綠sha或「無」
  _sha="$1"; _who="$2"; _before="$3"; _n="$4"; _green="$5"
  _short=$(printf '%s' "$_sha" | cut -c1-8)
  _mig=$(git diff --name-only "$_before" "$_sha" 2>/dev/null | grep -c '^supabase/migrations/' || true)
  _f=$(printf '%s/PUSH-%s-%s.md' "$BOX" "$(date '+%Y%m%d-%H%M')" "$_short")
  {
    printf '# PUSH · %s 推了 %s 顆到 dev(%s)\n\n' "$_who" "$_n" "$(date '+%F %T')"
    printf '> 🔴 **本信的讀者是主視窗。不要原封轉給 Sean。**\n'
    printf '> 他要的是「客人會看到什麼變化、後台會不會壞」,而本信答的是「推了什麼」。\n'
    printf '> **翻譯是主視窗的工作。**(沒有這一行,總有一天有人整封貼給他 —— '
    printf '而它讀起來很像一份給老闆的報告。)\n\n'
    printf '```\n'
    printf '執行者        %s\n' "$_who"
    printf '推到          %s\n' "$_sha"
    printf '推之前        %s\n' "$_before"
    printf '顆數          %s\n' "$_n"
    printf '```\n\n'
    printf '## 這批動到什麼(給要判「我要不要重驗」的人)\n\n```\n'
    printf 'apps/ 與 packages/ 的檔數   %s\n' \
      "$(git diff --name-only "$_before" "$_sha" 2>/dev/null | grep -c '^apps/\|^packages/' || true)"
    printf 'supabase/migrations 的檔數  %s\n' "$_mig"
    printf '```\n\n'
    # 🔴 這一段【必須由結果決定】,不可無條件印(CLAUDE.md 終端機紀律:
    #    `cmd; echo "(空 = 零命中)"` 在有命中時照樣印)。
    #    無條件印的代價:每一封信都有一次假警報 ⇒ 讀信的人三次之後就不看它
    #    ⇒ **真的不是 0 的那一次,它失效。**(2026-08-18 主視窗在第一封測試信裡抓到)
    if [ "$_mig" -gt 0 ] 2>/dev/null; then
      printf '🔴 **本批有 %s 支 migration ⇒ 有人要回答「apply 了沒」** —— ' "$_mig"
      printf '先 apply 再 push 的順序若反過來,正式站會壞(2026-08-07 約 8 小時)。\n\n'
    else
      printf '✅ 本批零 migration ⇒ **沒有 apply 順序問題**(這一格由結果決定,不是固定字)。\n\n'
    fi
    # 🔴 四綠那一格【不留白】—— 留白與「沒問題」在這裡是同一種字面
    if [ "$_green" = "無" ] || [ "$_green" = "none" ] || [ "$_green" = "沒有" ]; then
      printf '## 🔴🔴 這批【沒有四綠涵蓋】\n\n'
      printf '推的人明說了沒有。**這不阻止推 —— 推不推是 Sean 的判斷,不是這支腳本的。**\n'
      printf '而它也不留白:**下一個讀這封信的人不必去猜、也不必去問。**\n\n'
    else
      printf '## 這批的四綠\n\n```\n四綠 sha  %s\n```\n' "$_green"
      printf '⚠️ 四綠答的是「這棵樹編得起來、測試綠」,**不答「這些改動是對的」**。\n'
      printf '**涵蓋 ≠ 沒有已知缺陷。**(2026-08-18:一發四項 rc=0 的樹裡住著一個會刪客人收藏的缺陷)\n\n'
    fi
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
  if true && announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" "$HEAD_SHA" >/dev/null; then :; fi
  A=$(find "$T" -name 'PUSH-*.md' | grep -c . || true)
  echo "  信件數 $A   期望 1"

  echo "== 世界二:push【失敗】⇒ 信【不可以】出現 =="
  rm -f "$T"/PUSH-*.md
  # 用 false 模擬 push 失敗;`&&` 讓 announce 不會被執行
  if false && announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" "$HEAD_SHA" >/dev/null; then :; fi
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

  # ── 2026-08-18 新增的兩格:它們守的是【由結果決定】而不是固定字 ──
  echo "== 世界五:本批零 migration ⇒ 【不可以】印那句 apply 警告 =="
  rm -f "$T"/PUSH-*.md
  # HEAD~1..HEAD 是本 repo 的真實區間;它動不動到 migrations 由 repo 決定,所以兩邊都判
  announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" "$HEAD_SHA" >/dev/null
  _f5=$(find "$T" -name 'PUSH-*.md' | head -1)
  _migline=$(grep -c 'supabase/migrations 的檔數  0' "$_f5" || true)
  if [ "$_migline" = "1" ]; then
    E=$(grep -c '有人要回答「apply 了沒」' "$_f5" || true)
    E2=$(grep -c '本批零 migration' "$_f5" || true)
    echo "  這批 migration 數為 0 ⇒ 警告行 $E(期望 0) / 零-migration 行 $E2(期望 1)"
  else
    # 這一發的區間真的有 migration ⇒ 反過來驗
    E2=1; E=0
    _w=$(grep -c '有人要回答「apply 了沒」' "$_f5" || true)
    echo "  這批 migration 數不是 0 ⇒ 警告行 $_w(期望 1)"
    [ "$_w" = "1" ] || { E=1; E2=0; }
  fi

  echo "== 世界六:四綠填「無」⇒ 信裡要印紅,而且【不阻止推】 =="
  rm -f "$T"/PUSH-*.md
  announce "$HEAD_SHA" "SELFTEST" "$PREV" "1" "無" >/dev/null
  _f6=$(find "$T" -name 'PUSH-*.md' | head -1)
  F=$(grep -c '沒有四綠涵蓋' "$_f6" || true)
  F2=$(grep -c '這不阻止推' "$_f6" || true)
  echo "  沒有四綠那句 $F(期望 1) / 不阻止推那句 $F2(期望 1)"

  echo "  (跑的是 $(command -v git) / $(command -v find))"
  if [ "$A" = "1" ] && [ "$B" = "0" ] && [ "$C" -ge 1 ] && [ "$D" = "1" ] \
     && [ "$E" = "0" ] && [ "$E2" = "1" ] && [ "$F" = "1" ] && [ "$F2" = "1" ]; then
    echo "✅ 六個世界都對:成功才寫信、失敗不寫信、量得到印狀態、量不到明說量不到、"
    echo "   零 migration 不印假警報、沒有四綠也不留白"
    exit 0
  fi
  echo "🔴 壞了 —— 不要用這支腳本推東西"
  exit 1
fi

# ── ✅ 2026-08-18 18:5x G1:**push + 廣播 這一半也實測過了** ────────────────
#   在此之前本檔的標法是「只有 deploy_status() 那一半測過」。**現在兩半都測過了。**
#   🔴 **為什麼要在真推之前做**(主視窗的話,採用):下一次真推會是這半支的**第一次執行**,
#      而那一刻 Sean 在場、主視窗在等、六個窗停著 —— **最不該當第一次的時刻。**
#
#   量法(**全程不碰真 origin**;任何人可重跑,約 1 分鐘):
#     T=$(mktemp -d)
#     git init --bare -q "$T/fake-remote.git"
#     git clone --local -q /Users/sean_1/pcm-website-v2 "$T/repo"   # --local 走硬連結，快
#     cd "$T/repo" && git remote set-url origin "$T/fake-remote.git"
#     git remote get-url origin | grep fake-remote || exit 1        # 🔴 這道不可省
#     git push -q origin "$(git rev-parse HEAD~5):refs/heads/dev" && git fetch -q origin
#     PUSH_ANNOUNCE_BOX="$T/box" VERCEL_BIN="$T/no-vercel" \
#       bash scripts/push-and-announce.sh "$(git rev-parse HEAD)" G1-TEST
#
#   量到的四個世界(逐格都有兩個世界會印不同的東西):
#     A 推得動        假 remote 的 dev == 要推的 sha ✅ / 信箱檔數 1 ✅ / rc=0
#     B non-fast-fwd  rc=1 / 信箱檔數 **0** / 假 remote 的 ref 沒被動到
#     B2 同上(另一顆)  rc=1 / 0
#     B3 remote 端 hook 拒絕(在 bare 裡放一支 exit 1 的 pre-receive,且刻意讓它是 fast-forward
#        ⇒ 失敗只能來自 hook;hook 的訊息 grep ⇒ 1)  rc=1 / 0 / ref 沒被動到
#   ⇒ **「push 成功才寫信」這條在三種失敗下都成立,而且 rc 是 1 不是 0。**
#
#   ⚠️ **仍未測到的(不要當成已驗)**:
#     · 本次 VERCEL_BIN 指向一個不存在的路徑 ⇒ 信裡部署那段走的是「量不到」分支。
#       **push 與【真的 vercel 查詢】兩件事沒有在同一次執行裡跑過。**
#     · B 與 B2 的失敗機制其實是同一種(non-fast-forward);真正不同的第三種是 B3。
#     · 沒有測過推到真 remote 之後 deploy_status 的輪詢會不會等到正確的那一發
#       —— 那要真推才走得到,仍等 Sean。
SHA="${1:-}"
WHO="${2:-}"
GREEN="${3:-}"
# 🔴 三個都【必填】,而第三個(四綠 sha)是 2026-08-18 主視窗裁的:
#    信裡有一格叫「它被驗過嗎」而原本沒有人在填 ⇒ 留白會被讀成「沒問題」。
#    ⚠️ **允許的值包含【明確的沒有】** —— 填「無」就好。
#    🔴 而它【不阻止推】:值是「無」只會讓信裡印紅,推不推是 Sean 的判斷,不是這支腳本的。
[ -n "$SHA" ] && [ -n "$WHO" ] && [ -n "$GREEN" ] || {
  echo "用法: bash scripts/push-and-announce.sh <完整sha> <窗代號> <四綠sha|無>"
  echo "      bash scripts/push-and-announce.sh --selftest"
  echo ""
  echo "  第三個參數沒有四綠就填「無」—— 它不會擋你推,只會在信裡印紅。"
  echo "  🔴 不要為了少打一個參數改用裸 git push:那樣【不會有信】,"
  echo "     而別的窗看到 origin/dev 動了會查不出是誰推的(git reflog 不記執行者)。"
  exit 2
}

git rev-parse --verify "${SHA}^{commit}" >/dev/null   # 不存在就死在這裡,不會寫信
BEFORE=$(git rev-parse origin/dev)
N=$(git rev-list --count "${BEFORE}..${SHA}")

echo "推 ${SHA} → origin/dev(目前 ${BEFORE},共 ${N} 顆)"
git push origin "${SHA}:dev" && announce "$SHA" "$WHO" "$BEFORE" "$N" "$GREEN"
