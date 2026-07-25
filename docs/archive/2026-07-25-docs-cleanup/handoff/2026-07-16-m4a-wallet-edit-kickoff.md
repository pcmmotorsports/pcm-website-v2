# M-4a 客戶線明細收工 + 儲值金編輯片 kickoff(2026-07-16 執行視窗交接)

> 寫者:M-4a 執行視窗(Opus 4.8/Fable、本日下午)。客戶明細-a/b 收工已代推;本檔=下一個執行視窗(儲值金編輯片)的開工依據。
> 入口鏈:`CURRENT.md`(本檔摘要)→ 本檔 → `STATUS.md`(已刷新、主表現況正確)。

## 1. 本 session 完成(3 commit,值班台全 PASS 已代推)

| commit | 內容 | 審查 |
|---|---|---|
| `6c34037` | STATUS 主表 7 欄重寫(V 線收工對齊;V 線流水逐字歸檔 PROGRESS.md) | 值班台 review-lite PASS |
| `30659b8` | **客戶明細-a**:`/customers/[id]` 基本資料+儲值金餘額/流水(唯讀) | code-reviewer R1 FAIL 1 must-fix(docstring)→修→R2 PASS;值班台 Fable PASS(worktree 隔離親跑測試) |
| `675b949` | **客戶明細-b**:訂單歷史+地址+車庫三 section(唯讀;**#278 新開**=訂單歷史沿用 #249 濾 unpaid 已揭示) | code-reviewer R1 FAIL 2 must-fix(unpaid 揭示+docstring)→修→R2 fresh PASS;值班台 Fable PASS |

- Sean 拍板已落檔:優先序 ①客戶線→②Email→③最新商品④小件穿插;明細「全放含儲值金」=override 05-31 前台 hold(範圍僅 admin;memory `project_wallet-deposit-taiwan-legal-hold` 已改寫)。
- verdict 存檔:`pcm-tools/review-inbox/m4a-{status-rewrite,customer-detail-a,customer-detail-b}-done.verdict.md`。

## 2. 現況快照(零待推)

- **branch**:`dev` = `origin/dev` = **`675b949`**;`origin/main` = `b6c97fd`(production 未動,dev 超前 3 commit、dev:main 恆 Sean 明說)。
- **DB**(A庫 `bmpnplmnldofgaohnaok`):migrations 至 `20260716200000` 不變;本 session 零 DB 寫入(僅唯讀 MCP 驗證)。
- **live 已驗(本日 MCP 唯讀)**:`admin_audit_log` migration `20260712210000` **已 apply 且在用**(19 筆、訂單線寫入中)=偵察坑 #1 解除;`customer_wallet_ledger` 表在、**0 筆**(乾淨起點、trigger 同步鏈在)。
- working tree:僅既有凍結 dirty(`.gitignore`/*.png/docs 群);本檔+CURRENT.md 未 commit=下一視窗首 commit 折入(慣例)。
- **Sean 開站驗收點(累積)**:①admin `/customers` 點任一客戶看明細五區塊(訂單連結跳轉/流水空態)②正式站 `/products` 年份卡片(V 線 FF 帶上、仍未驗)。

## 3. 下一片=儲值金編輯(🔴 高風險動錢;新視窗做)

**Sean 已拍(07-16、memory 已落)**:
- **Q1=B**:UI=「加值」「扣款」兩鈕+金額+**備註必填**;**允許扣成負餘額**(內部彈性、負數照記;不做「直接改餘額數字」)。
- **Q2=A**:本片**不做 step-up**,靠每筆紀錄可回查;step-up 等 tier 編輯片一起建。

**實作路線(plan 要寫的骨架;鐵則 8=先提 plan 過值班台關卡1 才動工)**:
- **一支 migration=新 owner RPC**(鏡像 `admin_update_order_workflow`=`supabase/migrations/20260714130000` 樣板):SECURITY DEFINER、`customer_wallet_ledger` INSERT + `admin_audit_log` INSERT **同交易**、EXECUTE 只 GRANT service_role+REVOKE anon/authenticated、fail-closed DO 斷言。
- **語意映射**:加值=`deposit`(amount>0)/扣款=`use`(amount<0)——既有 `wallet_entry_type` enum+`wallet_amount_sign` CHECK 直接支撐,**零 schema 改動**(只加 RPC);`refund` 不開 UI。餘額由既有 `on_wallet_ledger_inserted` trigger 同步,**RPC 不自算、禁裸 UPDATE customers.wallet_balance**。
- **金額紀律**:整數(元位)、UI 收正整數+方向鈕、server 端轉 signed;備註必填 fail-closed;audit target=`customer:{id}`、before/after 帶餘額快照。
- **actor**:沿訂單線現行(過渡 cookie 自報身分=M0-S2 已拍接受殘餘,tier 片再升級)。
- **🔴 部署硬順序(migration 硬閘)**:commit 壓住不推 → Sean db push → 值班台驗(函式在/ACL/交易模擬 BEGIN→加值/扣款/壞輸入→ROLLBACK 零留痕)→ 才放行推。
- 前置參考:`SupabaseWalletAdapter.addEntry` 已存在(明細-a reviewer 記的 poisoned-write-client 選項一併評估);明細頁儲值金卡=編輯入口掛載點。
- 審查鏈:plan 關卡1(值班台)→ 實作 → code-reviewer → 值班台(硬閘=DB 交易模擬)→ 鐵則 12 觸發(動錢+RPC+GRANT)=Codex 第三眼。

**續行序(儲值金編輯後)**:tier 編輯(🔴 高風險件#3;step-up 門檻屆時拍=STATUS 待決策②)→ ②Email 通知片(🔴 動工前先拍「觸發點碰不碰金流 RPC」=STATUS 待決策①)→ ③最新商品 → ④小件穿插。backlog 新增:#278(admin 客戶頁含 unpaid 查法)。

## 4. 風險 / 欠帳(不擋線)

- #278:客戶明細訂單歷史看不到待付款單(已揭示;修=admin 專用查法另片)。
- graphify/roadmap 未刷(07-10 拍板:milestone 收尾或每日收工跑一次;今日收工時跑)。
- M-4a 收尾後記得 raise「流程再優化」正式題(memory `project_reminder-process-optimization-after-m4a`)。

## 5. 新視窗開工三步

1. Sean 跑 `node /Users/sean_1/pcm-tools/scripts/busboy-start.js pcm` 貼 template(注意:snapshot 可能滯後,以本檔 §2 為準)。
2. 讀 `CURRENT.md` → 本檔 §3 → 寫儲值金編輯 plan(骨架照 §3、標 L1/鐵則 8)→ plan 丟 `pcm-tools/review-inbox/m4a-wallet-edit-plan.md` 過值班台關卡1。
3. 關卡1 PASS 才動工;migration 壓住走硬閘;本檔+CURRENT.md 折入首 commit。

— M-4a 執行視窗,2026-07-16
