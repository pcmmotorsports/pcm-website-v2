# 交接:M-4a 通知線 方向轉折 + B-0 PRD 收案 + B-1 已上 prod(2026-07-18)

> **給接手視窗**:本檔是當次唯一交接入口。真權威 plan = `docs/specs/2026-07-18-b0-order-notification-email-prd.md`;拍板 memory = `project_m4a-line-multichannel-pivot`。
> **紀律提醒**:本檔所有「已驗/未驗」標記皆為實測結果,**未驗項不得當已驗用**;接手後任何宣稱請自己用工具重驗(這條線本 session 已抓到 5 次「字面 vs 事實」偏差,詳見 §6)。

## 1. 這個 session 發生什麼(軌跡)

1. 接手「LINE 多通道通知」方向,先誠實查證**網站 LINE 推播現況**(前 session 曾編造「LINE 測試成功」)。
2. Sean 拋出更大的架構問題(LINE 登入該不該留、身分去重、缺架構圖、缺監控)→ 指示「**用 Fable + GPT 研究後再規劃**」。
3. codex + Fable 雙研究 → **獨立收斂**出兩個關鍵判斷(見 §3)→ Sean 拍 Q1-Q4 全 A、方向定為**修正版 D′**。
4. R-1 唯讀盤點(prod counts-only)→ 存量包袱實質為零。
5. B-0 PRD **三輪雙審**(R1 26 條 → R2 13 條 → R3 4 條、新 BLOCKER 歸零)→ Sean 收案三拍板 → 動工。
6. B-1(orders 加欄)實作 → code-reviewer 兩輪 + **Codex CLI 兩輪** → Sean `db push` 上 prod → 覆核 6 項全過。

## 2. 🟢 prod 現況(實測,非推測)

- **`orders.notification_email` 已存在於 production**(migration `20260718120000` 已 apply,遠端 latest = 該筆)。
  `text` / nullable / 無 DEFAULT;既有 **30 筆訂單全為 NULL**(預期);orders 欄數 30 → **31**。
- CHECK `orders_notification_email_valid` `convalidated=true`,**六條件實測全在**:
  可列印 ASCII `^[!-~]+$` / `octet_length<=254` / `rtrim` 去尾點 / `!~~` 擋子網域 / email 形狀 / 合成域精確等值。
- **結帳路徑未受影響**(apply 後交易模擬實證:不含新欄的 INSERT 成功、該欄為 NULL;CHECK 實際擋下合成域;合法值可寫;跑完回滾、零殘留)。
- `create_order` / `confirm_order_payment` **未被本欄字面污染**(=0);orders 使用者 trigger = 0。

## 3. 🔴 方向與拍板(Sean 親口,可信)

**Q1-Q4 全 A**(memory `project_m4a-line-multichannel-pivot` 有全文):
LINE 登入**保留但改造成綁定軌** / **修正版 D′** 保底 / 存量前向堵 + 人工處理 / Phase 1 不做訪客結帳。
**收案三拍板**:明示接受 TapPay 殘餘風險 / outbox PII 保留 **120 天** / 收案動工。

**雙研究獨立收斂的兩個關鍵判斷**:
1. 🔴 **五訊號 dead-man 監控全 repo 查無實作**(只存在 migration 註解/JSDoc)→ email outbox 上線即無監控。
2. 🔴 **email 必填一落地,新單通知孤兒歸零 → 「email/LINE 雙通道分派」暫無服務對象 = 空轉** → 延後。
3. **LINE push 給非好友/封鎖者回 HTTP 200 但靜默不送達、事後無端點可查**(兩份官方查證交叉確認)
   → 交易通知必須 email 為主;**這是前 session「宣稱 LINE 測試成功」的技術根因**。

## 4. 📍 下一步 = B-2(動工前須各自提片級 plan 給 Sean 批)

**B-2 = 改 `create_order` RPC**(8 參數 → 9 參數)。🔴 三個硬性要求(皆由審查逼出、不可省):
1. **同一 migration 內 `DROP` 舊 8-param 簽章 + `CREATE` 9-param**(第 9 參 `DEFAULT NULL` 供過渡)。
   PG 不能用 `CREATE OR REPLACE` 改參數數量 —— 那會**產生 overload**:帶 DEFAULT → 呼叫歧義、**db push 當下結帳全斷**;不帶 → 舊版續存、**必填被永久繞過**。
2. **ACL 鏡像重建 + `has_function_privilege` fail-closed 斷言**(DROP 後權限歸零、PG 還會預設 grant PUBLIC EXECUTE,本 repo 有前科)。
3. 🔴 **函式體必須以 `pg_get_functiondef` 取 prod 當下最新版為基底、逐行 diff 驗證**
   —— 抄舊 migration 會**靜默回滾**既有防護(vehicle snapshot / vehicle type guard / 法律同意 / cart dedup / 價格與敏感欄防護)。**diff 是硬交付物。**
4. 🔴 **鎖保護必須另尋機制**(不可沿用 `SET LOCAL`,理由見 §6-⑤)。B-2 動 RPC 的鎖競爭風險遠高於 B-1 加欄。

**全線拆片圖 + 上線 gate 8 項** = PRD §4 / §6。🔴 **8 項 gate 全數達成前,禁用「通知功能上線」「孤兒已消滅」字面。**

## 5. git / 部署狀態

- branch `dev`。**本批已由 Sean 授權 push**(2026-07-18;`origin/dev` 已對齊本 session 全部 commit)。
  ⚠️ 實際狀態一律以實跑為準、**本檔刻意不寫死 hash 與未推數**:`git rev-list --count origin/dev..HEAD` / `git rev-parse --short origin/dev`。
  (本行原寫「未 push」,push 完當場變假 → 已更正。**自指狀態字面每次操作就失效**,同本檔 §6-③ 教訓。)
- ⚠️ push `dev` 會觸發 **pcm-admin 重部署**(`dev` 是 admin 的 production 分支)。本批為純 `.sql` + `.md`、零 `.ts` 改動 → **admin 行為不變**。
- 本 session 的 commit 序(舊→新):B-1 本體 → Codex R1 findings 修正 → Codex R2 補齊 → apply 覆核+lock_timeout 更正。
- ⚠️ **Sean ownership 凍結檔**(勿動、勿混入 commit):`.gitignore`、`docs/progress-roadmap.html`、各 `*.png`、`docs/handoff/2026-07-1*`(本檔除外)、`docs/specs/2026-07-15|16|19-*`、`docs/reviews/2026-07-16-*`、`docs/superpowers/`。
- **精準 `git add <路徑>`,禁 `git add .` / `-A`**(工作區有大量凍結檔)。

## 6. 🔴 本 session 抓到的「字面 vs 事實」偏差 5 次(接手務必知道)

1. **只看 exit code 就說「三綠過了」** —— 實際 typecheck 是紅的(`pnpm x | tail` 讓 tail 的 exit code 蓋掉真實結果)。→ **一律看輸出內容,不看 exit code。**
2. **D4 定案只改被點名的四處**,漏了銷案表兩列與 §3.4 → Fable 當場抓到。
3. **Packet 寫死行數**;修正那句話時**又寫死一次新數字**,改完檔案再度失效。→ **自指數字/hash 一律不寫死,改附可執行取得方式。**
4. **Packet 聲稱「自帶 migration 全文」實際只貼核心段** → Codex 抓到「問了自己沒附材料的問題」。
5. 🔴 **`SET LOCAL lock_timeout` 的兩次錯誤宣稱**:先寫「no-op 也安全(小表毫秒級)」→ Codex 駁(ACCESS EXCLUSIVE 可被長交易**無限阻擋**、與資料量無關);改寫「經 db push 確定生效」(依據 Codex 親讀 CLI v2.98.1 `ExecBatch` 原始碼)→ **被 apply 實測輸出推翻**(`WARNING 25P01: SET LOCAL can only be used in transaction blocks`)。
   → **教訓:原始碼查證 ≠ 實際執行行為,唯一權威是實跑輸出**(memory `reference_supabase-migration-set-local-is-noop`)。
   → **B-1 apply 實為全程無鎖超時保護** —— 沒出事是運氣,非設計保證。

**同款根因**:「只改被點名那一處」在本片復發 **4 次**。→ 改任何合約/字面前,**先 grep 全樹建立舊字面清單、逐條銷完才准說已同步**。

## 7. 未完成 / 誠實揭示

- ⚠️ **B-1 三項未驗**(檔內以 🟡⚠️ 標記,非宣稱通過):表級 ACL 套檔前後逐項比對、`lock_timeout` 實際超時行為(已知 no-op)、以及**已於 apply 後補做**的真建單測試(此項已完成)。
- ⚠️ **LINE 推播實測從未成功完成**:Sean 跑過一次 `vercel env pull` + node 腳本,因 shell source 格式問題失敗;後改用 `node --env-file` 的版本**尚未回報結果**。→ 腳本在該 session scratchpad,接手若要重跑需重建。
- ⚠️ **pg_cron / email sweeper 排程是否真的在跑 = 未確認**(PRD §6 gate 第 1 項)。
- ⚠️ MEMORY.md 約 25KB,已壓過一輪(122 條一條未刪),**再壓需合併條目、需 Sean 拍板**(候選清單在該次 agent 回報)。

## 8. 接手建議起手

1. `cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5`
2. 讀 `STATUS.md`(最上面一則即本 session)+ 本檔 + PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md`。
3. 動 B-2 前:**先提片級 plan 等 Sean 批**(鐵則 8),並依 §4 三項硬性要求設計;鐵則 12 Packet 於 commit 前產。
