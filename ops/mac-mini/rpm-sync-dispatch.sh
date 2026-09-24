#!/bin/bash
# Mac mini 每天台灣 07:45 觸發一次商品同步(rpm-sync.yml, daily=true)。
# 計畫:docs/plans/2026-09-24-rpm-sync-dispatch-from-mac-mini-plan.md
# 安裝方式見同目錄 README.md。本檔放在 repo 只是存檔, 不會自己跑。
#
# 做三件事:
#   1. 今天(台灣時間)dev 上已經有一輪 daily【成功或正在跑】⇒ 不再觸發(launchd 睡醒補跑時不會重複)。
#      取消或失敗的不算 ⇒ 會再觸發一次。
#   2. 觸發 `gh workflow run rpm-sync.yml --ref dev -f daily=true`。
#   3. 等 2 分鐘確認 GitHub 上出現【這次觸發之後】的那一輪, 而且不是取消或失敗;
#      否則寄信到同步失敗那個信箱(Sean 2026-09-24 Q2 甲)。
#
# 需要:gh 已登入(只給這個 repo 的 Actions 讀寫權杖);jq;~/.config/pcm/rpm-sync-dispatch.env(權限 600)
#   內有 RESEND_API_KEY、ALERT_EMAIL_FROM、SYNC_ALERT_TO 三個值(與 GitHub secrets 同名同值;
#   SYNC_ALERT_TO 可用逗號分隔多人, 與 rpm-sync.yml 的 notify-failure 同一個拆法)。
set -uo pipefail

REPO="pcmmotorsports/pcm-website-v2"
WF="rpm-sync.yml"
TITLE="Supplier Daily Sync (daily)"
ENV_FILE="$HOME/.config/pcm/rpm-sync-dispatch.env"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

alert() {
  local msg="$1" code
  log "🔴 $msg"
  if [ ! -r "$ENV_FILE" ]; then
    log "🔴 讀不到 $ENV_FILE ⇒ 告警信寄不出去"
    return 1
  fi
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${ALERT_EMAIL_FROM:-}" ] || [ -z "${SYNC_ALERT_TO:-}" ]; then
    log "🔴 $ENV_FILE 缺 RESEND_API_KEY / ALERT_EMAIL_FROM / SYNC_ALERT_TO ⇒ 告警信寄不出去"
    return 1
  fi
  local body
  body=$(printf '%s\n\n這封信由 Mac mini 寄出(ops/mac-mini/rpm-sync-dispatch.sh)。\nGitHub 備援排程會在下午照跑;若也失敗會另外寄信。\n手動補跑:gh workflow run %s --repo %s --ref dev -f daily=true' "$msg" "$WF" "$REPO")
  code=$(jq -n --arg from "$ALERT_EMAIL_FROM" --arg to "$SYNC_ALERT_TO" \
        --arg subject "商品同步沒有正常啟動(Mac mini 07:45)" --arg text "$body" \
        '{from: $from, to: ($to | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))), subject: $subject, text: $text}' |
    curl -sS -o /dev/null -w '%{http_code}' -X POST https://api.resend.com/emails \
      -H "Authorization: Bearer ${RESEND_API_KEY}" -H 'Content-Type: application/json' --data @-)
  case "$code" in
    2*) log "告警信已送出(HTTP $code)" ;;
    *) log "🔴 告警信沒有送出(HTTP ${code:-無回應})"; return 1 ;;
  esac
}

# 台灣今天 00:00 換成 UTC(macOS date)
since=$(TZ=Asia/Taipei date -j -f '%Y-%m-%d %H:%M:%S' "$(TZ=Asia/Taipei date +%F) 00:00:00" +%s) || since=""
if [ -z "$since" ]; then
  alert "算不出台灣今天 00:00,沒有觸發商品同步。"
  exit 1
fi
since_iso=$(date -u -r "$since" +%Y-%m-%dT%H:%M:%SZ)

# 列出 dev 上、某時刻之後建立的 daily:每行「status conclusion」。
# --created 先把範圍縮到今天, --limit 給到 200, 一天內不可能超過。
daily_runs_since() {
  gh run list --repo "$REPO" --workflow "$WF" --branch dev --event workflow_dispatch \
    --created ">=$1" --limit 200 --json createdAt,displayTitle,status,conclusion \
    --jq ".[] | select(.displayTitle == \"$TITLE\" and .createdAt >= \"$1\") | \"\(.status) \(.conclusion)\""
}

# 成功或還在跑的算數;completed 而不是 success(取消、失敗、逾時)不算。
count_live() { grep -cE '^(queued|in_progress|waiting|requested|pending) |^completed success$' || true; }

if ! runs=$(daily_runs_since "$since_iso"); then
  alert "查不到 GitHub 上今天的執行紀錄(gh 出錯或權杖失效),沒有觸發商品同步。"
  exit 1
fi
live=$(printf '%s\n' "$runs" | count_live)
if [ "${live:-0}" -gt 0 ]; then
  log "✅ 今天 dev 上已經有 ${live} 輪 daily 成功或正在跑 ⇒ 不重複觸發"
  exit 0
fi

dispatch_at=$(date -u -v-10S +%Y-%m-%dT%H:%M:%SZ)
if ! gh workflow run "$WF" --repo "$REPO" --ref dev -f daily=true; then
  alert "gh workflow run 失敗(權杖失效、沒有網路或 GitHub 出錯),商品同步沒有啟動。"
  exit 1
fi
log "已送出觸發, 2 分鐘後確認"
sleep 120

if ! runs=$(daily_runs_since "$dispatch_at"); then
  alert "已送出觸發, 但 2 分鐘後查不到 GitHub 執行紀錄,無法確認商品同步有沒有啟動。"
  exit 1
fi
live=$(printf '%s\n' "$runs" | count_live)
if [ "${live:-0}" -gt 0 ]; then
  log "✅ GitHub 上已出現這次觸發的那一輪(成功或正在跑)"
  exit 0
fi
if [ -n "$runs" ]; then
  alert "已送出觸發, 但這一輪已經結束而沒有成功(可能被取消或失敗):$(printf '%s' "$runs" | tr '\n' ';')。"
else
  alert "已送出觸發, 但 2 分鐘後 GitHub 上仍看不到這一輪,商品同步可能沒有啟動。"
fi
exit 1
