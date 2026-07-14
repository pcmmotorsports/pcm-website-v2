---
name: pcm-handoff
description: Safely transfer ongoing PCM project work between Codex and Claude using repository state instead of private memory. Use when Sean asks to hand off, continue another agent's work, end or resume a session, leave uncommitted changes, wait for Sean's external action, or switch between execution and review mode.
---

# PCM Handoff

以 repo 內共同真相完成雙向交接。不要把 Claude memory、Codex memory 或舊對話當成唯一依據。

## 接手

1. 讀根目錄 `AGENTS.md` 或 `CLAUDE.md`。
2. 讀 `STATUS.md`、`docs/ops/AI_CONTRACT.md`、`docs/handoff/CURRENT.md`。
3. 檢查 branch、working tree、HEAD 與近期 commit。
4. 把 dirty files 分成：
   - CURRENT 已標示的接手前內容。
   - 當次任務新增內容。
   - 無法解釋的內容。
5. 第三類存在時停下回報 Sean；不得 reset、stash、刪除或順手 commit 任何既有內容。
6. 用程式碼、測試、資料庫或部署事實驗證 handoff 的重要敘述。memory 只用來找搜尋線索。

## 判斷工作模式

- 一般任務使用執行模式：Codex 或 Claude 都可規劃、修改、測試及 commit。
- Sean 或任務明確寫「審查」「Review Packet」「唯讀」時使用審查模式：不修改檔案或外部系統。
- 模式不清楚時，依使用者動詞判斷；「檢查／審查／分析」不自動包含修復，「修正／建置／完成」才包含實作。

## 收尾

更新同一份 `docs/handoff/CURRENT.md`，不要每次都新建一份日期檔。必須寫清楚：

1. 更新時間、agent、工作模式、branch、HEAD。
2. 目前目標與已確認事實。
3. 接手前 dirty files 與本次新增 dirty files。
4. 實際完成的檔案、資料庫或部署動作。
5. 真正跑過的驗證及結果；沒跑的列在「尚未驗證」。
6. 下一個最小可執行動作，不寫「繼續處理」這種空話。
7. Sean 待決策、待操作 dashboard、待 push／肉眼驗收與 blocker。
8. secrets、個資、舊系統、正式環境及其他 session 檔案的安全邊界。
9. 相關 commit、規格與程式入口。

完成一個長期決策時，另寫進 repo 的 `docs/decisions/` 或正式規格；CURRENT 只留當前接手需要的摘要。歷史過長時移入日期型 handoff 或 `PROGRESS.md`，不要讓 CURRENT 無限增長。

## 跨 repo 工作

同一任務同時影響 PCM 報價單與 pcm-website-v2 時：

- 兩邊各自更新 `STATUS.md` 或目前採用的狀態真相。
- 兩邊各自更新 `docs/handoff/CURRENT.md`。
- 記錄跨 repo contract、同步順序與尚未落地的一側。
- 不用一邊的 handoff 宣稱另一邊已完成。
- 分 repo 精準 commit，不把兩個 working tree 的既有 dirty changes 混在一起。

## 安全規則

- 不讀、不複製、不摘要 `.env*`、token、API key、service role、客戶對話或個資。
- 不為了讓另一個 agent 使用 MCP 而輸出憑證；只記錄需要哪一類 connector 與是否尚待登入。
- 預設不 push、不 deploy production、不做 destructive action。
- Sean 說「停」「等等」時立即停止。
- Obsidian 不屬於 PCM handoff 流程，除非 Sean 重新明確授權。

## 完成檢查

- `STATUS.md` 與 CURRENT 沒有互相矛盾。
- CURRENT 的 dirty ownership 與 `git status` 一致。
- 測試敘述有命令或可驗證證據。
- 「已完成」「已驗證」「尚未執行」「需要 Sean」有明確區分。
- 不含 secret、個資或完整正式資料。
- 不因 plan 或文件完成就宣稱產品 bug 已修復。
