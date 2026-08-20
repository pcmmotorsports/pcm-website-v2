#!/bin/sh
# 免登入後台指令守門(2026-08-20 立;機制優先律)
#
# 背景:`next dev` 預設綁【所有網路介面】,不是 localhost;疊上 ADMIN_DEV_BYPASS=1(免登入)
#   + 這棵樹的 .env.local 指著正式站 ⇒ 一個免登入的正式站後台對整個區網開著
#   (2026-08-19 admin-design-system.md:6-20 實測:區網 IP curl 回 200、負對照 000、開了 5 小時)。
#   修法是指令加 -H 127.0.0.1。三份文件各自抄過這串指令,只有一份記得加旗標
#   (grep -rn --include='*.md' 'next dev' docs/ 2026-08-20 實測命中 6 處,3 處是危險組合缺旗標)。
#   ⇒ 抄指令這件事會一直重演,做成機制擋新增,不再靠人記得。
#
# 判準(刻意窄,只咬危險組合,不咬所有 next dev):
#   這次 commit【新增的一行】同時含 ADMIN_DEV_BYPASS=1 與 next dev,且不含 -H 127.0.0.1 ⇒ 擋。
#   ⚠️ 不擋單獨出現 next dev(docs 裡大量在講別的事,例如拋棄式 PG 版本、pgrep 找程序名)。
#   ⚠️ 不擋「拋棄式 PG」那個安全變體(接本機拋棄式庫,不指正式站)—— 這道閘只看單行字面,
#      分不出後面接的是正式站還是拋棄式庫;若要收窄到那個粒度,拋棄式 PG 那幾處請保留
#      現有寫法(不要加 -H 也不算錯,那條路本來就低風險一級)。
#
# 🔴 分母只看【新增行】,不看整支檔(2026-08-20 修;第一版掃整支 staged 檔案內容,
#   結果 W4 只在 docs/phase-1-backlog.md 檔尾新增 52 行、零碰 :24879,卻被那行【既有的散文】
#   (「那份 runbook 走 next dev + ADMIN_DEV_BYPASS=1…」,一句解釋、不是可執行指令)擋下 ——
#   本檔自己的註解就寫著「做成機制擋新增」,而實作掃了全檔,分母比意圖寬。
#   改法:只掃 `git diff --cached -U0` 的 `+` 行,用 @@ hunk header 換算出真實行號
#   (不是 diff 位移),回報命中時印的行號要對得上檔案裡的行。
#
# 逃生門:PCM_ALLOW_ADMIN_BYPASS_LINE=1 git commit ...(commit body 寫明理由)

set -e

[ "${PCM_ALLOW_ADMIN_BYPASS_LINE:-}" = "1" ] && {
  echo "⚠ 免登入後台指令守門被 PCM_ALLOW_ADMIN_BYPASS_LINE=1 略過 —— 請在 commit body 寫明理由" >&2
  exit 0
}

HITS=""
for f in $(git diff --cached --name-only --diff-filter=ACM); do
  # 本檔自己會在註解/程式碼裡字面提到這兩個字串(它就是在檢查它們)⇒ 排除自己,不然會擋自己
  [ "$f" = ".husky/admin-dev-bypass-gate.sh" ] && continue
  # 只看仍存在於 index 的文字檔;二進位/已刪檔跳過
  git cat-file -e ":$f" 2>/dev/null || continue
  ADDED=$(git diff --cached -U0 --no-ext-diff --no-textconv -- "$f" | awk '
    /^@@/  { match($0, /\+[0-9]+/); line = substr($0, RSTART+1, RLENGTH-1) + 0; next }
    /^\+\+\+/ { next }
    /^\+/  { print line ":" substr($0, 2); line++; next }
  ')
  LINES=$(printf '%s\n' "$ADDED" | grep 'ADMIN_DEV_BYPASS=1' | grep 'next dev' | grep -v -- '-H 127\.0\.0\.1' || true)
  [ -n "$LINES" ] && HITS="$HITS
$f:
$LINES"
done

[ -z "$HITS" ] && exit 0

# 擋案簿(2026-08-20 立):每次真的擋下時,append 一行到 .husky/.gate-blocks.log
#   (.gitignore、不進 repo)。只記【發生了】,不判【是不是誤擋】——閘判不出這件事,
#   自評欄位沒有意義;分母機器記,分子留給後來的人查。寫失敗不得讓 commit 失敗。
LOG_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
LOG_TS=$(date -u +%FT%TZ 2>/dev/null || echo unknown)
{
  for f in $(git diff --cached --name-only --diff-filter=ACM); do
    [ "$f" = ".husky/admin-dev-bypass-gate.sh" ] && continue
    git cat-file -e ":$f" 2>/dev/null || continue
    git diff --cached -U0 --no-ext-diff --no-textconv -- "$f" | awk -v ts="$LOG_TS" -v gate="admin-dev-bypass-gate" -v file="$f" -v head="$LOG_HEAD" '
      /^@@/  { match($0, /\+[0-9]+/); line = substr($0, RSTART+1, RLENGTH-1) + 0; next }
      /^\+\+\+/ { next }
      /^\+/  {
        content = substr($0, 2)
        if (content ~ /ADMIN_DEV_BYPASS=1/ && content ~ /next dev/ && content !~ /-H 127\.0\.0\.1/)
          print ts "\t" gate "\t" file ":" line "\t" head
        line++
        next
      }
    '
  done
} >> .husky/.gate-blocks.log 2>/dev/null || true

cat >&2 <<MSG

🔴 擋下:免登入後台指令缺 -H 127.0.0.1

  下面幾行同時有 ADMIN_DEV_BYPASS=1 與 next dev,卻沒有 -H 127.0.0.1 ——
  next dev 預設綁所有網路介面,這個組合會讓免登入的後台對整個區網開著。
  改成加上 -H 127.0.0.1,或若確定該行接的是拋棄式本機庫(非正式站)可忽略此擋。
$HITS

  真的必要(例如確定安全、要保留原字面示範一個反面案例):
    PCM_ALLOW_ADMIN_BYPASS_LINE=1 git commit ...
    並在 commit body 寫明理由

MSG
exit 1
