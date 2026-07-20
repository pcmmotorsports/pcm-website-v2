# CURRENT HANDOFF — pcm-website-v2

> 這是新 Codex／Claude session 的當次交接入口。現況衝突時依
> 「可驗證事實 → `STATUS.md` → 本檔 → 歷史 handoff／memory」仲裁。
> **目前只有兩個合法開工入口：主軌 M-4a B-3，或支線 #288-b。**

## 1. 交接快照

- Updated: 2026-07-20, Asia/Taipei
- Agent: Codex
- Mode: M-4a B-3 獨立 review R3 PASS，本片由本 commit 收錄；未 push
- Branch: `dev`
- Implementation base: `54df4ec`
- Git snapshot: HEAD、remote refs 與未推數一律用下方命令即時取得；本輪未 push
- Expected dirty: 本 commit 後應為 clean；若仍有 dirty，先辨認 ownership

每個新 session 仍須自行重跑：

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --short --branch && git log --oneline -5
```

## 2. 已確認現況

### M-4a 通知線（修正版 D′）

- 真權威：`docs/specs/2026-07-18-b0-order-notification-email-prd.md`
- B-0 PRD ✅
- B-1 `orders.notification_email` nullable 欄位 + 六條件 CHECK：repo SSoT 記錄為已 apply production
- B-2 `create_order` 8→9 參：repo SSoT 記錄為已 apply production，且路徑②驗收完成
- B-3：**程式、測試與三輪獨立審查已完成，R3 PASS；由本 commit 收錄，未 push**
- B-2 上線不等於通知功能已上線；第 9 參仍可 `DEFAULT NULL`，必填收緊屬 B-6

### #288 production-build E2E 支線

- #288-a ✅：production config、env preflight、會斷的 smoke、GitHub Actions workflow 已進 git
- 實作 commit：`e700481`
- 下一片：**#288-b（globalSetup 資料合約 + mobile device project）**
- `STATUS.md` 與前版 CURRENT 對 GitHub Secrets／首航結果有漂移：
  - 前版 CURRENT 記錄「Secrets 已設、dev/main 首航皆綠」
  - `STATUS.md` 仍列「Secrets 待設定」
  - 本輪未連 GitHub live 重驗，故不得把任一說法當成當前已確認事實

### 作廢入口

**E2a-2 已於 2026-07-18 D′ 轉折後作廢。**
`docs/specs/2026-07-19-m4a-email-e2a-2-plan.md` 與舊過夜片單只供歷史追溯，
**不得據此規劃、施工或恢復「對帳補寄 + 五訊號」舊路線**。

## 3. 雙軌入口

| 軌道 | 下一片 | 優先序 | 是否互相阻擋 |
|---|---|---|---|
| 主軌 | **M-4a B-4 規劃 checkpoint**：B-3 已由本 commit 收錄；B-4 接真值持久化與 TapPay 三分支 | 全域優先 | 不受 #288-b 阻擋 |
| 支線 | **#288-b**：E2E 資料合約 + mobile device project | 非 M-4a 主線 | 不受 B-3 阻擋 |

兩軌業務上獨立，但共用 `dev` 與同一 working tree；**同一時間只讓一個執行 session 寫入**，
另一條若同時存在只能唯讀，避免 shared index／push 夾帶事故。

## 4. 主軌審查卡：M-4a B-3

### 已實作

結帳收件資料區塊已加入通知 Email 欄、會員真 Email 安全預填／LINE 合成域留白、UI 揭露文案與測試；
client／server 共用同一份 canonical schema。單一 strict opt-in flag 同步控制四層；off 精確 8 參，on 精確 9 參但第 9 值固定 `null`，所以 B-3 **不會持久化真 Email**。flag 仍保持 off。

### 獨立審查依序讀

1. `docs/reviews/2026-07-20-m4a-b3-checkout-notification-email-packet.md`
2. `docs/specs/2026-07-20-m4a-b3-checkout-notification-email-plan.md`
3. `docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.1、§3.4、§4、§5、§6
4. `docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md` §8.2
5. `docs/handoff/2026-07-19-m4a-b2-applied-handoff.md` §1、§3、§5、§7

### 六條件硬紅線

zod／server canonical 驗證必須鏡像 DB 的全部六條件，不能只用一般 `email()`：

1. raw 值先只裁掉前後 ASCII space（U+0020），再驗證 canonical 值；DB 收到的值不得帶 padding
2. 只允許可列印 ASCII `^[!-~]+$`
3. UTF-8 octet 長度 ≤ 254
4. 僅一個 `@`，且 domain 至少含一個 `.`
5. domain 小寫並去尾點後，不得等於 `line.pcmmotorsports.local`
6. domain 小寫並去尾點後，不得是 `*.line.pcmmotorsports.local`

漏任一條會形成「app 放行、DB CHECK 擋下、客人只看到結帳 500」。
client 驗證只改善 UX，server 必須重新驗證；log、錯誤與回應不得帶 email 原值。

### 接線與字面紅線

- 單一 env flag 同時控制四層：UI 顯示、client payload、server schema requirement、RPC 呼叫形態
- flag 預設 off；跨片順序固定：
  `B-1/B-2 完成 → B-3/B-4 部署且 flag off → 開 flag 並記 cutoff → 觀察窗 → B-6`
- B-3／B-4 動 TS 時，逐條核銷 B-2 plan §8.2 的 11 項「8 參數」舊字面
- 兩處假綠高風險斷言：
  - `packages/adapters/src/supabase/mappers/order.test.ts`
  - `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts`
- Q2=A：`packages/adapters/src/supabase/database.types.ts` 刻意留到 B-4 更新，不得在 B-3 誤判為漏做
- `packages/domain/src/order/order.ts` 的 `createOrder()` 是 domain factory，不是 RPC，勿誤改

### 審查與收工 gate

- Sean 已批准精確 slice plan；本輪按該 plan 實作完成
- 涉 order／checkout contract，三輪高風險獨立唯讀審查已完成；Review Packet 已同步
- R1 verdict=`FAIL`：null-only marker、manifest 正式清單、flag-on 桌機／手機實測、active 舊字面四項已全修，且已由 R2 reviewer 確認全數銷案
- R2 verdict=`FAIL`：reviewer 確認 R1 四項全銷案，另抓到 Email input 14px 會觸發 iOS Safari 聚焦縮放；已改 mobile 16px、加 CSS RED→GREEN 守門、`agent-browser` 重驗，並同步其檔頭 nit
- R3 verdict=`PASS`：0 must-fix；R1／R2 findings 全銷案，可進 commit checkpoint
- 動 `.ts/.tsx`：typecheck + lint + build + 相稱測試全綠後才可 commit
- 不開 flag、不 push、不 deploy、不 apply migration；這些保留 Sean checkpoint
- PRD §6 八項 gate 未全數達成前，禁稱「通知功能上線」或「孤兒已消滅」

## 5. 支線開工卡：#288-b

### 目標

為現有 production-build Playwright runner 加：

1. `globalSetup` 資料合約與 fail-fast
2. 完整 mobile device profile project
3. `html[data-mobile="true"]` 斷言

### 動工前依序讀

1. `docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` §3、§6、§7.1、§7.3、§9、§10
2. `docs/phase-1-backlog.md` #288
3. `apps/storefront/playwright.prod.config.ts`
4. `apps/storefront/e2e-prod/runner-smoke.spec.ts`
5. `apps/storefront/scripts/e2e-prod-preflight.mjs`

### 實作紅線

- 收檔以 plan §6 為準：globalSetup 檔 + production config + backlog + `STATUS.md`
- Playwright 執行序是 webServer ready 後才跑 globalSetup；env preflight 已在 webServer command 前綴，不得搬回 globalSetup
- globalSetup 不受一般 test timeout 保護：必設 `globalTimeout`、page/action/navigation timeout
- 失敗訊息只列非敏感計數，不印 URL、key、email 或資料內容
- mobile project 必用完整 Playwright device preset（含 UA），不能只改 viewport
- 必斷言 `html[data-mobile="true"]`，避免 viewport 是手機、server UA 卻仍判桌機的混血態
- 不改既有 `playwright.config.ts`、既有 dev specs、產品邏輯或 `.env*`
- 本機命令：

```bash
cd /Users/sean_1/pcm-website-v2/apps/storefront && pnpm test:e2e:prod
```

`test:e2e:prod` 會自行 build；不要與 dev server 同跑，兩者共用 `.next`。

### 資料策略漂移

- plan §9／§10 寫「不做固定 fixture，先打真 DB + fail-fast contract」
- backlog #288 的依賴卻寫「固定 fixture vs 專用測試頁，移至 #288-b」
- 在 Sean 未另行推翻前，**預設遵守 plan v3.2：#288-b 只做不寫資料的 fail-fast contract**；
  不自行新增 production fixture、專用產品頁或正式資料寫入
- 若實作發現 #288-c 所需 A/B 首屏差異無法靠唯讀 contract 保證，再把資料策略獨立列成 Sean 決策，
  不在 #288-b 暗中擴 scope

### 開工與收工 gate

- #288 全線鐵則 8 已由 Sean 2026-07-20 批准，仍須遵守 plan §6 的單片範圍
- 鐵則 12 已觸發：commit 前產／更新 Codex Review Packet
- typecheck + lint + root tests + production E2E；未實跑不得寫成通過
- 不 push、不改 GitHub Secrets、不 deploy

## 6. Codex 執行端操作坑

- `workspace-write` 的可寫根由**啟動時 cwd**決定；必須從 repo 根啟動 Codex
- 若從子目錄或其他目錄啟動，即使後來 `cd`，也可能無法寫 repo 目標檔
- 執行端使用 `codex exec -s workspace-write`；唯讀審查才使用 `-s read-only`
- 工單要給精確 scope／old-new／驗收，不讓執行端自行擴張
- 若命令長時間無輸出，先檢查 cwd、sandbox 與 subprocess 狀態，不要重複啟動第二個寫入 session

## 7. Git cleanup 收案

Root cause：2026-07-12 至 07-20 多個 session 產出的 handoff、spec、Review Packet、截圖與行銷文件
被持續標成「凍結勿動」，卻沒有進 git，因而逐日累積；不是 Git 自行產生異常。

本輪採 Sean 選定的「保留式整理」：

- `33ccc41`：擴大 `.env*`／`.vercel` 本機檔忽略，保留 `.env.example` 例外
- `cf0dfaa`：收錄 20 份歷史證據；已結案 handoff／截圖／舊設計稿移到
  `docs/archive/2026-07-20-git-cleanup/`
- `a9acb23`：三份 Eazi-Grip 行銷產物獨立收案
- `dd4413f`：進度地圖刷新至 2026-07-20（57 完成／2 進行中／35 未開始）
- 被 migration／測試直接引用的文件保留原路徑，並加「歷史／作廢，不得開工」標記
- E2a-2 明確作廢；現行通知線仍走 D′／B-3
- 沒有刪除任何原始資料，也沒有把 dirty 藏進 stash

新 session 預期從 clean tree 起手。只可精準 stage 自己片內檔案；禁 `git add .`／`git add -A`。
若 status 再出現 dirty，先辨認 ownership；無法解釋才停下問 Sean。

## 8. 已驗證／尚未驗證／需要 Sean

### 本輪已驗證

- B-3 共用六條件 schema、UI／prefill、client payload、server 重驗、domain／mapper／adapter 四層 gate
- flag off 精確 8 RPC 鍵；flag on 精確 9 鍵且 `p_notification_email: null`
- typecheck 8/8、lint 10/10、build 2/2
- full test：235 檔、2589 passed、1 todo
- 五層突變自驗：schema／UI／payload／server／RPC 任一防線拿掉都會轉紅，還原後全綠
- design manifest validate 通過；既有 ProductPage path-token warning 未新增
- 本機 process-only flag-on 瀏覽器流程：1280×1000 桌機與 390×844 手機 2/2 通過；驗預填、揭露、地址切換、錯誤阻擋、canonical、前進／返回、手機固定列與零水平溢出。R2 修後再由 `agent-browser` 實量 Email computed style=`16px`、焦點正確、錯誤存在、scrollWidth=innerWidth=390。臨時 preview／E2E harness 已刪，未改 `.env*`
- 手機肉眼初驗發現錯誤紅字被固定 buybar 遮住；已補 RED test 與 focus + 置中捲動修正，回歸後完整可見
- iOS Safari `<16px` 聚焦縮放風險已由 checkout mobile breakpoint 16px + `checkout.test.ts` 靜態守門鎖住

### 本輪尚未驗證

- B-3 已由本 commit 收錄；push、deploy、正式 flag 與 B-4 尚未執行
- 正式 authenticated `/checkout` 的 flag-on 驗收（正式 flag 仍 off；本輪只驗本機 process-only flag + 真 `CheckoutView`）
- production DB、Vercel 或正式站 runtime；本片不連線、不部署

### 需要 Sean

- 現在不需操作 dashboard、DB、env；本 commit 完成後仍不 push，下一片 B-4 需另行確認範圍
- push、deploy、production migration、env／GitHub Secrets、正式 flag 切換仍由 Sean 操作或逐次明確批准

## 9. 安全邊界

- 不讀、不輸出、不提交 `.env*`、token、service role、TapPay／LINE credential
- email 是 PII；log、告警、錯誤與 handoff 不得記錄原值
- 不碰正式 DB／migration apply／GitHub Secrets／Vercel env／feature flag，除非 Sean 對該動作明確批准
- 不 reset、stash、刪除或順手 commit 其他 session 新增的檔案
- 預設不 push、不 merge、不 deploy

## 10. 相關入口

- 現況 SSoT：`STATUS.md`
- 共用規則：`docs/ops/AI_CONTRACT.md`
- B-3 PRD：`docs/specs/2026-07-18-b0-order-notification-email-prd.md`
- B-3 實作 plan：`docs/specs/2026-07-20-m4a-b3-checkout-notification-email-plan.md`
- B-3 Review Packet：`docs/reviews/2026-07-20-m4a-b3-checkout-notification-email-packet.md`
- B-2 收案：`docs/handoff/2026-07-19-m4a-b2-applied-handoff.md`
- 11 項舊字面：`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md` §8.2
- #288 plan：`docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` v3.2
- #288 backlog：`docs/phase-1-backlog.md` #288
- #288-a 實作：`e700481`
- Git cleanup archive：`docs/archive/2026-07-20-git-cleanup/`
- Git cleanup commits：`33ccc41`、`cf0dfaa`、`a9acb23`、`dd4413f`
- 前版 CURRENT 推齊修正：`cc9ce02`
- 前版雙軌交接：`a0c62c0`

— END —
