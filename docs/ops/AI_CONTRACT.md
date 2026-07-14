# PCM AI Collaboration Contract

> Contract-Version: 1.0.0
>
> Last-Synced: 2026-07-14
>
> 本檔是 Codex 與 Claude 共用的協作契約。兩個 PCM repo 應保持 byte-equal。

## 1. 核心原則

Codex 與 Claude 都是完整開發夥伴。一般任務中，兩者都可以規劃、實作、測試、修改文件及 commit；角色由「這次任務的模式」決定，不由模型名稱永久綁定。

Sean 是唯一的產品與業務拍板者。AI 可以提出推薦、風險及選項，但不能替 Sean 決定會改變業務方向、資料語意或正式環境的事項。

## 2. 四種工作模式

### 執行模式

- 適用：一般建置、修 bug、文件、測試及經批准的 migration。
- Codex 或 Claude 都可擔任執行者。
- 執行者負責檢查現況、提出必要 plan、完成驗證、留下可接手的 handoff。

### 審查模式

- 只有在 Sean 或任務明確寫「審查」「Review Packet」「唯讀」時啟用。
- 審查者不得修改檔案、資料庫、部署或 commit，只回 findings、風險與是否可繼續。
- 審查可以由 Codex 或 Claude 擔任；高風險工作優先使用不同模型作第二視角。

### 設計模式

- 處理視覺方向、品牌稿與互動示意。
- 設計輸出不等於已實作；進 repo 前仍須經執行模式落地及測試。

### 決策模式

- Sean 拍板方向、正式環境操作、資料覆蓋例外及破壞性動作。
- AI 必須提供 2–4 個可選方案並標出推薦，不以開放式問題把技術負擔丟回 Sean。

## 3. 真相層級

### 固定政策

1. Sean 當前明確指示與不可鬆綁的安全紅線。
2. `docs/ops/AI_CONTRACT.md`。
3. `AGENTS.md` 或 `CLAUDE.md` 的 agent 專屬入口。
4. 專案內對應領域規格與操作文件。

### 現況與進度

1. 可驗證的 git、程式碼、測試、資料庫與正式環境事實。
2. 根目錄 `STATUS.md`。
3. `docs/handoff/CURRENT.md`。
4. 歷史 handoff、對話、Claude memory、Codex memory。

memory 只用來找線索。若 memory 與 repo 或正式狀態衝突，必須重新查證，不得因為「記得以前是這樣」就覆蓋現況。

## 4. 每次接手順序

1. 檢查 branch、working tree、HEAD 及 remote 差異。
2. 讀 `STATUS.md`。
3. 讀本檔。
4. 讀 `docs/handoff/CURRENT.md`。
5. 依任務路由讀相關規格、程式、測試與近期 diff。
6. 對不熟悉或高風險領域做盲點掃描，再提出 plan。

有 dirty worktree 時，先把檔案分成：接手前已存在、本次任務產生、無法解釋。只有第三類需要停下問 Sean；不得清除、stash、reset 或順手 commit 前兩類。

## 5. Handoff 必填內容

下列任一情況都要更新 `docs/handoff/CURRENT.md`：

- 工作尚未完成但要換 agent 或換 session。
- 完成一個可驗收 slice。
- working tree 保留未提交修改。
- 等 Sean 操作 dashboard、push、肉眼驗收或提供外部資訊。
- 發現文件、memory 與實際狀態互相衝突。

CURRENT 必須包含：

- 更新時間、執行 agent、工作模式。
- 目前目標與已確認事實。
- 接手前 dirty files 與本次新增 dirty files。
- 實際跑過的驗證及結果；沒跑的不能寫成通過。
- 下一個最小可執行動作。
- Sean 待決策、外部操作與 blocker。
- 不能碰的資料、檔案或正式環境。
- 相關 commit、規格與程式入口。

新 session 接手後可以更新同一份 CURRENT；舊細節若有長期價值，移到 `docs/decisions/`、`PROGRESS.md` 或日期型 handoff，不讓 CURRENT 無限膨脹。

## 6. 共用安全紅線

- 不讀出、不回傳、不提交 `.env*`、token、API key、service role key 或客戶個資。
- 不執行 `rm -rf`、`git reset --hard`、force push、DROP、無 WHERE delete 或 production env 修改，除非 Sean 對該動作明確批准。
- 不覆蓋 Sean 或員工人工填寫、人工翻譯、人工定價與人工 mapping；資料操作預設只補空值。
- 不把既有 dirty changes 當成可清理垃圾。
- 預設不 push、不 deploy production。Repo 若明訂 Auto mode 可 push，只放寬 push；兩 session 交接時執行端仍不得 push，production deploy／env 仍需明確授權。
- Sean 說「停」「等等」時立即停止，不再執行任何工具。
- Obsidian 不在 PCM 正式工作流中；Sean 未重新明確授權前不得建立或寫入 Vault。

## 7. MCP、Plugins 與 Skills

- 每次依當前 session 實際可用工具判斷，不假設另一個 agent 的 MCP 已登入。
- Supabase、Vercel、GitHub、Google Drive 等寫入操作必須符合當次任務授權；production、migration、merge、push 與 env 變更維持人工 checkpoint。
- 憑證只留在 OAuth、Keychain 或環境變數，不寫入 Markdown、skill 或 `.codex/config.toml`。
- 專案重複流程優先做 repo skill；跨專案穩定後再提升成全域 skill 或 PCM plugin。
- 同一 skill 應維持單一實體來源，另一個 agent 入口使用 symlink 或可驗證的同步機制。

## 8. 收尾標準

- 產品程式有相稱的測試；docs-only 變更至少跑連結、格式及 `git diff --check`。
- 報告區分「已完成」「已驗證」「尚未執行」「需要 Sean」。
- commit 精準收檔，不混入接手前 dirty changes。
- 不因寫完文件就宣稱產品 bug 已修復。
- 更新 `STATUS.md` 與 `docs/handoff/CURRENT.md` 後停在 review checkpoint。
