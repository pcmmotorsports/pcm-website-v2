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

先依當次任務的模式與授權選擇交付方式；以下收尾、歷史搬移及跨 repo 步驟都受此邊界限制：

- **唯讀審查／檢查：**只在回覆提供交接內容與文件差異，不更新 CURRENT、STATUS、決策文件或其他檔案，也不 commit。未修正的矛盾列為缺口，不為通過完成檢查而改檔。
- **已授權寫入的執行工作：**在批准範圍內更新同一份 `docs/handoff/CURRENT.md`，不要每次都新建一份日期檔。若文件由其他 session 負責或不在批准範圍，交付擬好內容供負責者收錄，並標明尚未落檔；不覆蓋對方修改。

回覆中的交接內容或已授權更新的 CURRENT，都須寫清楚：

1. 更新時間、agent、工作模式、branch、HEAD。
2. 目前目標與已確認事實。
3. 接手前 dirty files 與本次新增 dirty files。
4. 實際完成的檔案、資料庫或部署動作。
5. 真正跑過的驗證及結果；沒跑的列在「尚未驗證」。
6. 下一個最小可執行動作，不寫「繼續處理」這種空話。
7. Sean 待決策、待操作 dashboard、待 push／肉眼驗收與 blocker。
8. secrets、個資、舊系統、正式環境及其他 session 檔案的安全邊界。
9. 相關 commit、規格與程式入口。

已授權寫入且完成一個長期決策時，另寫進 repo 的 `docs/decisions/` 或正式規格；CURRENT 只留當前接手需要的摘要。歷史過長且搬移已在批准範圍內時，可移入日期型 handoff 或 `PROGRESS.md`，依下列方式保存：

1. 存入目的文件前先確認該段可依下方 secrets 與個資限制搬移；若含受限資料，停止該段搬移，只回報受限資料類型及檔案位置，不複製或摘要其值。可搬移的段落先完整保存原文，保留人工決策原文、來源與證據位置、成功及失敗結果、未確認事項和有效例外；不得以摘要或只留成功結果取代原文。
2. 核對來源段落與目的段落的完整內容，確認原文未遺失、來源及證據連結可追溯；CURRENT 摘要須保留未解決事項與仍有效的例外，並附目的文件路徑與章節。
3. 移除來源段落前重新讀取，確認它仍是剛才核對的版本。若有並行修改，保留來源並重新協調及對帳；若保存、連結或內容核對失敗，也保留來源，回報缺口，不宣稱搬移完成。

## 跨 repo 工作

同一任務同時影響 PCM 報價單與 pcm-website-v2 時，以下寫入只適用於各自已授權的範圍；唯讀模式改為在回覆中分 repo 交付：

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

- 依工作模式交付：唯讀只回報；執行模式只在授權及檔案歸屬允許時寫入。
- 本次交接敘述與可驗證事實一致；STATUS／CURRENT 的未修矛盾及尚未落檔內容已明列，不宣稱已同步。
- 交接內容的 dirty ownership 與實查一致；無法確認歸屬者明列，不自行認領。
- 若搬移歷史，完整原文、證據與有效例外已保存並對帳，摘要可回到來源；失敗時來源仍保留。
- 測試敘述有命令或可驗證證據。
- 「已完成」「已驗證」「尚未執行」「需要 Sean」有明確區分。
- 不含 secret、個資或完整正式資料。
- 不因 plan 或文件完成就宣稱產品 bug 已修復。
