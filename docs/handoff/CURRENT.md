# CURRENT HANDOFF — pcm-website-v2

> 這是新 Codex／Claude session 的當次交接入口。現況衝突時依
> 「可驗證事實 → `STATUS.md` → 本檔 → 歷史 handoff／memory」仲裁。
> **目前三個合法開工入口：主軌 M-4a B-4、M-3 兩步結帳第二片 U1（L0 已收工），或支線 #288-b；同一時間只允許一個寫入 session。**

## 1. 交接快照

- Updated: 2026-07-21, Asia/Taipei
- Agent: Claude Code
- Mode: 執行模式；M-3 兩步結帳 **Slice L0＝本 commit**（docs／註解 only）；未 push、未 deploy、未進 U1
- Branch: `dev`
- Implementation base（兩者不同，勿混用）：
  - **開工基底** = `a53897f`（本輪 preflight 時的 HEAD）
  - 🔴 **L0 commit 的實際 parent** = `0be428e`「docs(docs): 交接 Eazi-Grip 總代理上市規劃 [marketing]」
    —— 該 commit 由**另一條線**於 2026-07-21 19:43 在本輪進行中建立，**不屬於 L0**。
    後續任何 push／revert／review 的範圍計算都必須把它算進去，不可假設 L0 commit 直接接在 `a53897f` 上。
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
- B-3：**程式、測試與三輪獨立審查已完成，R3 PASS；commit `a7ff24d`，未 push**
- B-2 上線不等於通知功能已上線；第 9 參仍可 `DEFAULT NULL`，必填收緊屬 B-6

### #288 production-build E2E 支線

- #288-a ✅：production config、env preflight、會斷的 smoke、GitHub Actions workflow 已進 git
- 實作 commit：`e700481`
- 下一片：**#288-b（globalSetup 資料合約 + mobile device project）**
- `STATUS.md` 與前版 CURRENT 對 GitHub Secrets／首航結果有漂移：
  - 前版 CURRENT 記錄「Secrets 已設、dev/main 首航皆綠」
  - `STATUS.md` 仍列「Secrets 待設定」
  - 本輪未連 GitHub live 重驗，故不得把任一說法當成當前已確認事實

### M-3 兩步結帳方向

- Sean 已批准 A：由三步改成兩步，第二步採單欄連續式。
- 設計真權威：`docs/specs/2026-07-20-m3-two-step-checkout-design.md`。
- 實作計畫：`docs/specs/2026-07-20-m3-two-step-checkout-implementation-plan.md`；已經 Sol High 兩輪唯讀審查，R1 10 項與 R2 4 項 must-fix 均已折入；依 repo 兩輪上限未跑 R3。
- 計畫共 12 片：L0、U1、U2a、U2b、U3a、U3b、U4a、U4b、U5、L1、V1a、V1b。L1 等兩份正式條款與隱私內容取得核准（**核准矩陣＝Sean 必要、法律顧問選配加簽**，非二擇一；詳 backlog #291）；未完成 L1+V1b 前不得稱 production checkout 完成。
- **Slice L0 ✅ ＝本 commit（2026-07-21、docs／註解 only）**：
  - 新開 backlog **#291**「正式服務條款／隱私政策 route + version/hash」，狀態 🔴 **BLOCKED**，acceptance 十條齊備。
  - 修正 #241 對 live #235 的錯誤依賴（live #235 = 「Step3／完成頁退換貨連結 + 客服 LINE 入口」，**不產出法律頁**）；#235 條目加反向 cross-link 防再漂移。
  - 校正 `apps/storefront/src/lib/legal/terms-version.ts` **active 註解**（依賴改指 #291；標明現行 hash provenance 取自 design **草稿**、不得當未來正式內容來源）。`CURRENT_TERMS_VERSION` 值 `'2026-06-30'` **未動**。
  - manifest `CheckoutPage.open_drifts.checkoutLegalPagesDeferred` 改記「已納入 #291／正式來源待核准／不得複製 design 草稿／仍是上線前人工 release checkpoint」；`last_modified_commit` = `a53897f`（**開工時的 preflight HEAD ＝ 可達祖先，不是本 commit 的 parent**；實際 parent 見 §1）、`last_modified_date` 前置新段。
  - 🔴 **未做（硬紅線遵守）**：未自撰法律文案、未杜撰聯絡資訊、未新增 `/terms`／`/privacy` route、未建 migration、未 bump version、未改既有 consent 歷史、未 apply DB、未開 flag、未 deploy、未 push。已 apply 的 `20260630120000` migration 歷史註解**未回改**。
- **下一片 = U1**「兩步骨架 + TapPay active 原子切換」，**待 Sean 放行**；本輪未進 U1。
- checkout code、route、migration、flag、deploy、DB 至今仍全數未動。

### 作廢入口

**E2a-2 已於 2026-07-18 D′ 轉折後作廢。**
`docs/specs/2026-07-19-m4a-email-e2a-2-plan.md` 與舊過夜片單只供歷史追溯，
**不得據此規劃、施工或恢復「對帳補寄 + 五訊號」舊路線**。

## 3. 三個入口

| 軌道 | 下一片 | 優先序 | 是否互相阻擋 |
|---|---|---|---|
| 主軌 | **M-4a B-4 規劃 checkpoint**：B-3 已由 `a7ff24d` 收錄；B-4 接真值持久化與 TapPay 三分支 | 全域優先 | 不受 #288-b 阻擋 |
| M-3 | **兩步結帳 U1**（L0 ✅ 已收工）：由 U1 原子切兩步骨架 + TapPay active | Sean 本輪新批准方向 | L1 受 #291 正式法律內容阻擋；U1–U5 可在 flag-off 平行準備 |
| 支線 | **#288-b**：E2E 資料合約 + mobile device project | 非 M-4a 主線 | 不受 B-3 阻擋 |

三個入口業務上可獨立規劃，但共用 `dev` 與同一 working tree；**同一時間只讓一個執行 session 寫入**，
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

### 本輪已驗證（2026-07-21 Slice L0，實跑）

> 🔴 **並行寫入事故（誠實揭示；同款事故第 2 次）**：2026-07-21 19:12–19:28 期間，**有兩個 Claude session 同時對同一個 working tree 寫入**這五個檔案，違反本檔「同一時間只允許一個寫入 session」。
> 兩邊各自對「誰是正牌寫入者」有**互相矛盾**的紀錄，**從 repo 內無法裁決**（`git reflog` 不記執行者、檔案 mtime 只證明時間不證明身分）→ 本檔**不採信任何一方的歸屬敘述**，只記可查證事實。
> Sean 於 19:35 後確認收斂為單一視窗收尾。**收尾視窗對最終內容重跑全部驗證**（`turbo --force`、0 cached、非 cache hit），不沿用任何一方先前自報的數字；下列每一條都是收尾視窗親跑的輸出。
> **一處**由並行期間留下、經覆核**確認為正確**而保留的修正：#291 的分流標籤改為合規值 `P1-before-launch`（`P1-launch-gate` 不在 backlog 規範四選一內）。此為逐行核對整份 diff 後確認的唯一一處；原先寫「兩處」是筆誤，已由 codex 唯讀審查抓出並更正。
> 🔴 **給下一個 session 的教訓**：開工前除了 `git status`，還要確認沒有第二個視窗掛在同一個 repo；本次是在 commit 前一刻才發現，若當時直接 commit 就會把未經自己驗證的字面收進 SSoT。

- `pnpm exec turbo run typecheck --force` → **8/8 successful、0 cached**
- `pnpm exec turbo run lint --force` → **10/10 successful、0 cached**
- `pnpm exec turbo run build --force` → **2/2 successful、0 cached**
- `node scripts/design-mirror.mjs --validate`：**26 元件／214 path tokens OK／24 `last_modified_commit` 可達 OK**；既有 `ProductPage.related_storefront[8]` 無-token warning 為既存、未新增
- `git diff --check`：clean（exit 0）
- `pnpm exec vitest run apps/storefront/src/app/checkout/charge-actions.test.ts`（**須從 repo 根跑**，從 `apps/storefront/` 跑會 `No test files found`）：**1 檔 66 passed**（`CURRENT_TERMS_VERSION` 的直接消費者）
- `terms-version.ts` 經 diff 實證為**純註解變更**：濾掉註解行後 `+/-` 為空，`CURRENT_TERMS_VERSION = '2026-06-30'` 值未動
- RED→GREEN 字面驗證：改前 grep 證實 #241 誤指 #235、active 註解誤稱 #235、manifest 記「Phase 1 不做 legal pages」；改後全樹 grep 確認三處 active 字面均已更正，殘留者僅存在於**凍結歷史紀錄**且已逐條列入 #291
- manifest 結構完整性：`--validate` 解析成功、214 path tokens 與 B-3 紀錄一致（條目數未淨變）、diff 僅落在 `CheckoutPage` 段
- ⚠️ **上列數字的證據等級（codex R1 nit，誠實標註）**：除 `design-mirror --validate` 的 `26/214/24` 與 `git diff --check` 已被獨立第三方（fresh read-back agent 與 codex）重跑複核外，其餘 `0 cached`／`8-8`／`10-10`／`2-2`／`66 passed` 屬**收尾視窗自報**、terminal 輸出未存成 committed artifact → 對後續 reviewer 而言是 **self-reported**。要完全消除此疑慮須把驗證輸出存檔進 repo（本輪未做）。
- ⚠️ 同理，「未 apply DB／未開 flag／未 deploy」屬**外部系統動作**，repo 內無法自證；可自證的只有「未 push」（remote 查無該 commit）

### 前輪已驗證（M-4a B-3，沿用）

- B-3 共用六條件 schema、UI／prefill、client payload、server 重驗、domain／mapper／adapter 四層 gate
- flag off 精確 8 RPC 鍵；flag on 精確 9 鍵且 `p_notification_email: null`
- typecheck 8/8、lint 10/10、build 2/2
- full test：235 檔、2589 passed、1 todo
- 五層突變自驗：schema／UI／payload／server／RPC 任一防線拿掉都會轉紅，還原後全綠
- design manifest validate 通過；既有 ProductPage path-token warning 未新增
- 本機 process-only flag-on 瀏覽器流程：1280×1000 桌機與 390×844 手機 2/2 通過；驗預填、揭露、地址切換、錯誤阻擋、canonical、前進／返回、手機固定列與零水平溢出。R2 修後再由 `agent-browser` 實量 Email computed style=`16px`、焦點正確、錯誤存在、scrollWidth=innerWidth=390。臨時 preview／E2E harness 已刪，未改 `.env*`
- 手機肉眼初驗發現錯誤紅字被固定 buybar 遮住；已補 RED test 與 focus + 置中捲動修正，回歸後完整可見
- iOS Safari `<16px` 聚焦縮放風險已由 checkout mobile breakpoint 16px + `checkout.test.ts` 靜態守門鎖住

### 本輪尚未驗證／尚未執行（Slice L0）

- ✅ **外部 codex 唯讀 review 已執行**（2026-07-21，`codex exec -s read-only -c service_tier="fast"`，codex-cli 0.144.1；每輪跑前後 `git status --porcelain` 皆 0＝零留痕）。🔴 **Sean 2026-07-21 拍板：往後鐵則 12 觸發時不再產 Review Packet 給 Sean 人工貼 web Codex，一律由主 session 直接跑 `codex exec -s read-only`**（memory `feedback_codex-cli-direct-executor-no-packet` 已更新；`/codex-review` skill 的「產檔給 Sean 貼」流程視為已被取代）。
- **審查輪次與結果（截至本 commit；🔴 至今無任何一輪 PASS）**：

| 輪 | 審查者 | verdict | must-fix |
|---|---|---|---|
| R1 | codex 唯讀 | `NO-GO` | 8（+2 nit）|
| R1 | 另一視窗 code-reviewer | `FAIL` | 4（+2 nit）|
| R2 | codex 唯讀 | `NO-GO` | 3 |
| R3 | codex 唯讀（Sean 明示放行） | `NO-GO` | 4 |
| R4 | codex 唯讀（Sean 明示放行） | `NO-GO` | 9 |
| | | **累計** | **28，全數屬實、全數已修** |

- 🔴 **R4 的修正尚未經第三方覆核**；在有任何一輪 PASS 之前，本 commit 不得被描述為已通過審查。
- 🔴 **最嚴重的單一 finding（R1，code-reviewer 抓）**：commit body 與 STATUS 曾寫「code-reviewer R1 PASS(0 must-fix)」＝**不實** —— 那次 PASS 跑在並行寫入期間的舊 diff 上，其後內容又改過。**審查 verdict 必須綁定它實際看到的版本**，版本變了就重審，不可沿用舊 verdict。
- 🔴 **同一缺陷連續四輪復發**（每輪皆「修了被點名處、漏掉別處等價字面」）。R3 後改用「先建事實×位置清單一次改完 + 逐一 grep 反驗」，**R4 仍抓到 9 條**，根因這輪才看清：我的清單只涵蓋 repo 內檔案，漏了兩個載體 ——
  1. **commit message 本身**：一路 append R2／R3 段落卻從未回頭重讀開頭 → 同一份 message 頭寫「15 條」「a53897f 是父 commit」，尾寫「19 條」。**本輪已整份重寫、非 append 修補**。
  2. **被我判為「凍結歷史／範圍外」而跳過的 active 檔案段落**（STATUS 的 07-20 條目、plan `:56`）—— 它們仍在對讀者傳播舊事實。→ 判定「凍結」不等於可以留著錯的字面，至少要標作廢。
- 🔴 **amend 會讓自指 hash 當場失效**：本片 amend 4 次，STATUS 內寫死的 `d40b059` 早已不可達（死 hash，R4 抓出）→ 自指 commit hash 一律不寫死，改記可執行取得方式。
- ✅ **R3 第 4 條的兩處延伸字面，Sean 已授權處置並完成**：①實作計畫 plan 檔 `:7`／`:56`／`:66` 誠實化（硬閘→人工 release checkpoint、核准矩陣精確化、收檔數更正為 7），該檔因此成為本片第 **7** 個收檔 ②commit subject 改為 `docs(storefront): 建立正式法律頁上線 checkpoint [m-3]`（原「上線硬閘」為任務指定字面，經 R3 判定與實際能力不符；未 push 故零歷史改寫成本）。
- U1 **尚未開始**；route／migration／version bump **尚未做**；DB／env／flag／deploy／push **均未做**
- 未跑 **full** `pnpm test`（本片零 `.ts/.tsx` 行為變更，只動註解與 docs；`typecheck`+`lint`+`build`+manifest validate 已涵蓋，另加跑了 `charge-actions.test.ts` 66 測）
- L0 未驗證任何 runtime／瀏覽器行為（本片不產生 UI 變更）

### 前輪尚未驗證（M-4a B-3，沿用）

- B-3 已由 `a7ff24d` 收錄；push、deploy、正式 flag 與 B-4 尚未執行
- 正式 authenticated `/checkout` 的 flag-on 驗收（正式 flag 仍 off；本輪只驗本機 process-only flag + 真 `CheckoutView`）
- production DB、Vercel 或正式站 runtime；本片不連線、不部署

### 需要 Sean

- 🔴 **正式服務條款與隱私政策內容的來源**（#291 唯一 blocker）：由誰產出／何時可提供、核准人與核准日期。**AI 不自撰、不得複製 `design-reference/components/LegalPage.jsx` 草稿**（該檔自述「草稿待法務 review」、含假電話／假 Email、未實作服務、與 PCM 現行政策衝突的七日退貨說法）
- **是否放行下一片 U1**（L0 已收工、停在 checkpoint）
- ✅ **審查已結（Sean 2026-07-21 拍板：不開 R5、接受現況收工）**：外部 codex 唯讀跑滿 **R1→R4、四輪全數 `NO-GO`**（累計 28 條 must-fix、全數屬實、全數已修；R3／R4 為 Sean 明示放行，repo 預設上限 2 輪）。🔴 **誠實現況＝R4 的 9 條修正尚未經第三方覆核**；在有任何一輪 PASS 之前，不得把本 commit 描述為已通過審查。
- ✅ **結構性根因已拍板並落檔（Sean 2026-07-21 拍 A）**：同一組事實（核准矩陣／parent／審查狀態／checkpoint 定位）重複散落 7 個檔案 + commit message、靠人工同步 —— 四輪審查證明此結構下人工同步會持續漏。採 **A 案＝收斂為單一來源**（#291 為法律頁事實的唯一權威，其餘各處只留一行指標、不複製內容；自指 hash 不寫死；字面反驗須納入 commit message）。已開 **backlog #292** 獨立一片承接，**不塞進 L0 或任何既有 slice**。
- 現在不需操作 dashboard、DB、env；本 commit 完成後仍不 push，主軌下一片 B-4 需另行確認範圍
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
