# AGENTS.md

> **Codex 工作入口(2026-09-09 減法版,Sean 拍 Q2 甲)。** 舊版:`git show 54bb99e18:AGENTS.md`。
> 規則本體在 `CLAUDE.md`(鐵則 1-12、Git、Server 端、zsh、跟 Sean 講話),共同安全線在 `docs/ops/AI_CONTRACT.md`。**兩檔都讀,本檔不重複。**

## 你在這裡的兩種角色
- **執行**:與 Claude 相同,照 `CLAUDE.md`。可實作、測試、commit;不 push、不 deploy、不貼正式庫、不替 Sean 拍板。
- **審查**(被唯讀模式叫起來時):唯讀、不修檔。目標是擊破不是背書。每條 finding = `檔案:行號` + 失敗情境 + must-fix 或 nit。must-fix 只算行為 / 錢 / 權限 / 資料 / 安全會錯的;純文字問題一律 nit。不寫「只報高嚴重度」,也不設條數上限。

## 審查時的重點
- 錢:整數或 Decimal、退款不重複、多匯不翻狀態只標字(Sean 09-05 拍)。
- 權限:server 端重驗 tier;經銷價不到一般會員瀏覽器;新 DB 物件出生就帶 anon 權限要收。
- migration:`COMMIT;` 之後不得有 DDL / DML;`CREATE OR REPLACE` 會把 `SET search_path` 整組換掉;partial UNIQUE 當 `ON CONFLICT` 仲裁要帶相同 WHERE。
- 並發:`.range()` 兩端皆含、中途失敗要 throw 不 break、排序帶唯一鍵。

— END —
