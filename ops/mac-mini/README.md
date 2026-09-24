# Mac mini：每天 07:45 觸發商品同步

計畫：`docs/plans/2026-09-24-rpm-sync-dispatch-from-mac-mini-plan.md`。本目錄只存檔，**還沒有安裝到 Mac mini**。

## 安裝（由負責 Mac mini 的人做）

1. 確認 `gh`、`jq`、`curl` 都裝好，而且 `gh auth status` 已登入。權杖只給 `pcmmotorsports/pcm-website-v2` 的「Actions：讀寫」，由 Sean 在 GitHub 建立。
2. 建 `~/.config/pcm/rpm-sync-dispatch.env`，權限設 600，內容三行：`RESEND_API_KEY=…`、`ALERT_EMAIL_FROM=…`、`SYNC_ALERT_TO=…`。三個值跟 GitHub secrets 同名同值。值不要貼進對話或 repo。
3. 把 `rpm-sync-dispatch.sh` 複製到 `~/pcm-ops/`。
4. 把 `com.pcm.rpm-sync-dispatch.plist` 裡的 `__HOME__` 換成家目錄，放到 `~/Library/LaunchAgents/`，然後執行 `launchctl load ~/Library/LaunchAgents/com.pcm.rpm-sync-dispatch.plist`。
5. **先確認 GitHub 上的 workflow 已經有 `daily` 輸入**（`rpm-sync.yml` 那一顆推上 dev 之後）。還沒推就觸發，GitHub 會拒絕，並寄出告警信。

## 手動試一次

`bash ~/pcm-ops/rpm-sync-dispatch.sh`。今天已經有一輪 daily 時，它只會記一行「不重複觸發」就結束。

## 停用（退回）

`launchctl unload ~/Library/LaunchAgents/com.pcm.rpm-sync-dispatch.plist`。停用之後，GitHub 備援排程會在下午照跑。

## 紀錄

`~/Library/Logs/pcm-rpm-sync-dispatch.log`
