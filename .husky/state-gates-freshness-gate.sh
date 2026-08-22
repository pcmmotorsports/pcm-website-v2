#!/bin/sh
# state-gates-freshness-gate.sh — 動 migration(或產生器、或表本身)而表沒跟上 ⇒ 擋下 commit
# (Sean 2026-08-23 批「甲」。病:docs/reference/order-state-gates.md 九天沒重產,期間至少
#  五支相關 migration 上線,pcm_order_refundable_remaining 被指到錯的版本 —— 照它算「還能退
#  多少」會算大。而它沒人管的原因不是偷懶:沒有任何收工清單管過它,是「沒有規矩」不是「規矩失效」。)
#
# 🔴 比對基準 = 【index(staged)視圖】,不是工作樹:
#    這棵樹多窗共用,別窗 untracked 的 in-flight migration 會漏進工作樹重產的表
#    (2026-08-23 當場實例:工作樹那份 M 的表引用著一支還沒 commit 的 migration)。
#    用工作樹比對,這道閘會因別人的檔亂紅;用 index 比對,閘守的才是
#    「commit 進去的表 = f(commit 進去的 migrations, 產生器)」這個真正的不變量。
# 🔴 觸發不只 migrations(code-reviewer MF3):f 本身(產生器)與表被單獨改,同樣要驗 ——
#    「表 = f(migrations)」的等式三個成員都在 pathspec 裡,少一個就是單邊守門。
# 🔴 重產走【非 --stdout 模式】(code-reviewer MF2):產生器的守門①(UTF-8)與守門②
#    (三支關鍵函式自測)只住在非 --stdout 分支 —— 走 --stdout 的話,掃描 pattern 退化時
#    這道閘會紅、訊息教人 --write、退化的表被寫進去、閘轉綠:**修復指令把病灶固化,
#    閘自己替固化後的結果背書。** 非 --stdout 讓退化在產生器內部就 exit 非 0 ⇒ 本閘回 2。
#
# 要讓它綠:sh .husky/state-gates-freshness-gate.sh --write
#          然後 git add docs/reference/order-state-gates.md
# (⚠️ 不要直接跑 bash scripts/state-gates.sh —— 它讀工作樹,會把別窗 untracked 掃進表裡。)
#
# 三態(照 .husky/pre-commit 檔頭的 || exit $? 約定):
#   0 = 本次 commit 沒動 migration/產生器/表,或表是新鮮的
#   1 = 動了而表落後
#   2 = 量具自壞(產生器缺席、自身守門紅、空輸出、git 管線失敗)—— 輸出作廢,不是「表新鮮」

set -u
DOC='docs/reference/order-state-gates.md'
GEN='scripts/state-gates.sh'
SELF='.husky/state-gates-freshness-gate.sh'

# 🔴 自我一致性(codex R1 High):pre-commit 跑的是【工作樹】的本檔,而 commit 進去的是
#    【staged】的本檔 —— 兩者不一致時,現在放行的閘不是要被提交的那道
#    (攻擊形狀:stage 一份 exit 0 的閹割版、工作樹留正常版 ⇒ 正常版替閹割版背書)。
#    ⚠️ 這是整個 .husky 框架的共同性質,本檔只守得住自己;--no-verify 仍繞得過一切。
if ! git diff --quiet -- "$SELF" 2>/dev/null; then
  echo "🔴 $SELF 的 staged 與工作樹版本不一致 ⇒ 現在跑的不是要被 commit 的那份;對齊(全部 add 或全部還原)後再 commit" >&2
  exit 2
fi

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM HUP
EXPECTED="$TMP/$DOC"

# 從 index 重建「staged 的 migrations + staged 的產生器」視圖(untracked 一律不進來),
# 用非 --stdout 模式重產 ⇒ 產生器自己的守門①②在路徑上。
regen_from_index() {
  # 拆兩步、各驗 rc(codex R1 Medium):POSIX sh 無 pipefail,接管線時 ls-files 半途死掉
  # 會被 checkout-index 的 0 吞掉 ⇒ 不完整的 migrations 產出一張「合法」的表 ⇒ 錯的 0/1。
  git ls-files --cached -z -- 'supabase/migrations/*.sql' "$GEN" > "$TMP/filelist.z" || return 2
  git checkout-index --prefix="$TMP/" -z --stdin < "$TMP/filelist.z" || return 2
  [ -f "$TMP/$GEN" ] || { echo "🔴 index 裡沒有 $GEN ⇒ 量具缺席,本閘輸出作廢" >&2; return 2; }
  ( cd "$TMP" && bash "$GEN" >/dev/null ) \
    || { echo "🔴 產生器自身守門未過(見上方訊息)⇒ 量具壞了,本閘輸出作廢 —— 先修產生器,不要想辦法讓表過" >&2; return 2; }
  # 第二層 belt(產生器內部已有空檔檢查;這裡防「它成功卻沒寫出檔」的未知形態)。
  [ -s "$EXPECTED" ] || { echo "🔴 產生器回 0 但產物缺席/為空 ⇒ 量具壞了,本閘輸出作廢" >&2; return 2; }
  return 0
}

if [ "${1:-}" = "--write" ]; then
  regen_from_index || exit 2
  cp "$EXPECTED" "$DOC" || exit 2
  echo "✅ 已用 index 視圖重產 $DOC —— 接著 git add $DOC 再 commit" >&2
  echo "⚠️ 這一步【覆寫了工作樹的表】—— 七窗共用一棵樹,若剛才 git status 顯示它是 M,那可能是別窗" >&2
  echo "   的重產(2026-08-23 真實發生過一次)。表是自動產生物、可隨時重跑,但通報一聲比較好。" >&2
  exit 0
fi

STAGED_TRIGGERS=$(git diff --cached --name-only -- 'supabase/migrations/*.sql' "$GEN" "$DOC") || exit 2
[ -n "$STAGED_TRIGGERS" ] || exit 0

regen_from_index || exit 2
# 「index 沒有表」與「git 讀取故障」分開(codex R1 Medium + R2 殘餘):
# --error-unmatch 三態也要分 —— 0=存在、1=不存在、其餘(如 128)=git 自己壞 ⇒ 2。
git ls-files --cached --error-unmatch -- "$DOC" > /dev/null 2>&1
LS_RC=$?
if [ "$LS_RC" = "0" ]; then
  git show ":$DOC" > "$TMP/staged-doc.md" || { echo "🔴 讀 staged 的表失敗 ⇒ 量具壞了,本閘輸出作廢" >&2; exit 2; }
elif [ "$LS_RC" = "1" ]; then
  : > "$TMP/staged-doc.md"
else
  echo "🔴 git ls-files 回 $LS_RC ⇒ 量具壞了,本閘輸出作廢" >&2
  exit 2
fi

# cmp 三態分開(codex R1 Medium):0=相同、1=不同、其餘=I/O 故障 ⇒ 量具壞,不是表落後。
cmp -s "$EXPECTED" "$TMP/staged-doc.md"
CMP_RC=$?
if [ "$CMP_RC" = "0" ]; then
  exit 0
elif [ "$CMP_RC" != "1" ]; then
  echo "🔴 cmp 回 $CMP_RC(讀取/IO 故障)⇒ 量具壞了,本閘輸出作廢" >&2
  exit 2
fi

{
  echo '🔴 這次 commit 動了下列檔案,而狀態閘表與 staged 內容對不上(表落後或被手改):'
  printf '%s\n' "$STAGED_TRIGGERS" | sed 's/^/     /'
  echo "   表是自動產生的、只認 code 不認 docs —— 它落後時,「還能退多少」這類判斷會照舊版算。"
  echo '   ⚠️ 表落後的部分【不一定是你造成的】—— 七窗共用同一棵工作樹,更早的片可能漏了重產;'
  echo '      --write 會把 staged 基準一次補齊,你的 commit body 只需替你自己那幾行說話。'
  echo '   修法(兩步):'
  echo '     sh .husky/state-gates-freshness-gate.sh --write'
  echo "     git add $DOC"
  echo '   (不要直接跑 bash scripts/state-gates.sh:它讀工作樹,別窗 untracked 的 migration 會被掃進表裡。)'
} >&2
exit 1
