# Plan v3.2 — #288 商品目錄 production build E2E 守門(2026-07-20)

> **v3.2 = 實作 #288-a 期間,code-reviewer R1 判 FAIL(6 must-fix)後的回寫。**
> 三項實質變更:①Sean 拍 A **接 CI**(§9,含推翻理由)②smoke 由「驗首頁骨架」改為
> 「驗 `/products` 真有資料」(§5.3,**原版已實測證實為假綠**)③**拆五片(a / b / c / d / e)**
> —— 理由:#288-a 若沒有一條「資料斷掉會紅」的 smoke,**它自己無法被驗證**,
> 拆更細反而製造一個不可驗證的中間狀態,故 #288-a 內含接線 + 會斷的 smoke 為單一片。

> 真權威 plan。對應 backlog `#288`(`docs/phase-1-backlog.md:7109-7143`)。
> **審查史**:v1 關卡1 R1 雙審 NO-GO(codex 9 must-fix / Fable 2 must-fix + 5 consider)→
> v2 關卡1 R2 雙審**仍 NO-GO**(codex 9 must-fix / Fable 2 must-fix + 5 consider)→ 本 v3。
> **Sean 07-20 拍 B:破例開第三輪審查** → **R3 結果分歧**:
> Fable = `GO-with-comments`(0 must-fix)/ codex = `NO-GO`(4 must-fix,並明示
> 「依第三輪例外規則應升級 owner 決策、不再開 R4」)。
> **v3.1 = 採納 codex 全部 4 條 + Fable 全部 6 條**(兩審共識 2 條、codex 獨有 2 條、Fable 獨有 4 條)。
> 🔴 **Sean 07-20 拍 A:拆五片(a / b / c / d / e),不走 55 分鐘例外**(此拍板取代並更正
> v3.1 當時記錄的「再拆 a1/a2」字面——實際落地為單一 #288-a 內含接線+會斷 smoke,
> 非另立 a1/a2 兩片;§6 同步更正)。
> 狀態:**已核准開工**(鐵則 8 = Sean 07-20 口頭批准;**不開 R4**)。

## 0. 本版的核心變更:大幅縮小範圍

v2 被打回的 11 條 must-fix 中,**至少 5 條的根因是同一個** —— 我把太多東西塞進第一片,
於是每一輪審查都在更深的實作細節上找到新問題(findings 12 → 11,幾乎沒收斂)。

⇒ **v3 把 #288-a 砍到「只證明 production build E2E 跑得起來」**,其餘全部後推。
被後推的部分,其對應的 findings 自然消滅(不做就沒有做錯的空間)。

## 1. 🔴 實測事實(本 session 實跑,推翻兩個審查員的推理)

### 1.1 突變對照表(硬事實,非推理)

對 `apps/storefront/src/components/products-url-state.tsx` 逐一施加單行 mutation,
跑 `products-url-state.hooks.test.tsx`(基準 10 測全綠):

| 突變 | 結果 | 對應 bug |
|---|---|---|
| `:302` 刪 `if (collides) router.refresh()` | **2 測紅**(案例①⑤) | `61f45b6` 品牌 ✅ |
| `:275` 刪還原波 early return | **1 測紅**(案例⑩) | `49afb07` 深連結 ✅ |
| `:281` `if (filtersChanged) params.delete('page')` → 無條件 | **🔴 10 測全綠** | `630b7a6` 分頁 ❌ |

**兩個審查員在此題上皆錯**:
- Fable R2 MF-2 判斷「`:281` 突變被 `:275` 遮蔽」→ **方向對**,但它建議的替代修法
  (改成 `if (!filtersChanged)`)經讀碼推論**同樣會被 `:275` 遮蔽**、未經實測。
- codex R2 ruling D 判「三個最小 mutation 都可行、各自打紅對應案例」→ **直接被實測推翻**。

還原後 10 測全綠、`git diff` 對該檔**零改動**已驗證。

### 1.2 由此推出的結論:分頁案例**延後成獨立片 #288-e**(v3.1 修正)

> 🔴 **v3 原寫「本版不做」,經 codex R3 must-fix #3 指正、我接受並更正。**
> codex 的反駁成立:「`:281` 單行 mutation 被 `:275` 遮蔽,只能證明**該 mutation 不適任**,
> **不能證明分頁沒有黑箱不變式**」——我把「找不到 mutation」誤等同於「講不清楚要守什麼」,
> 是兩件事。且 Fable R3 亦承認不變式講得出來(只是主張已被 `:275` 單元測試涵蓋)。
> **決定性論據**:單元測試守的是 hook 邏輯、**守不到瀏覽器行為**,而後者正是本 plan 存在的理由。
> 若 #288 全部結案卻缺這條,「Next production router 再次把內容退回第 1 頁」時,
> **品牌與車款案例會全綠**(codex 原話)。

🔴 **限定性字面(codex R3 nit-7)**:`:275` 只證明在**現有十個單元測試案例中**遮蔽了 `:281`;
**不得**無限定性宣稱 `:281` 是冗餘防禦(v3 原字面已超出證據,此處更正)。故 `:281` **不刪**。

**#288-e 的黑箱不變式(codex R3 提供、我採納為該片規格)**:
從第 1 頁點到第 2 頁後 →
① URL 為 `page=2` ② 分頁 UI `aria-current="page"` 落在 2
③ 商品集合**不同於**第 1 頁 ④ **reload 後仍保持同一頁 2 集合**

⇒ 此不變式**不依賴任何單行 mutation 可打紅** —— 它是行為契約,
突變自驗改以「把 `:275` + `:281` 同時還原」為 mutation(容許多行,因本片守的是**組合後的外顯行為**,
非某一行的內部邏輯)。⚠️ 此 mutation 的有效性**須於 #288-e 實作時實測確認**,不得憑推理寫死。

### 1.3 更正我自己的錯誤宣稱

v2 §0 寫「程式化 `.click()` 不會展開,React combobox 只吃真實 pointer 事件」——**錯**。
實際機制是 `VehicleSelect.tsx:134-137` 的 **`onFocus` → `setOpen(true)`**。
我先前的實驗之所以讀到 `aria-expanded=false`,是因為在**同一個 tick 內同步讀 DOM**、
React 尚未 re-render;是**我的測量方法有誤**,不是元件行為。
(codex R2 ruling A 指出此點,經自驗成立。)
⇒ E2E 用 playwright 原生 `click()` 即可(它會 focus + 等待);
但**斷言必須用 `expect(...).toHaveAttribute` 這類會自動重試的 API**,不可同步讀。

## 2. 目標與動機

上週商品目錄連出三個 bug,**全部只在 `next build && next start` 下重現**、`next dev` 看不到
(`docs/handoff/2026-07-19-catalog-url-state-three-bugs-handoff.md:88-89` —— v2 引 `:85-86` 有誤,已更正)。
現有 playwright `webServer.command` = `pnpm exec next dev --port 3100`
(`apps/storefront/playwright.config.ts:28`)→ **結構上擋不到這一層**。

## 3. 分級與鐵則判定

- **鐵則 8 = 觸發**(跨 3+ 檔)→ **已 Sean 口頭批准 07-20**。
- **鐵則 12 = 觸發**(由鐵則 8 連動)→ commit 前必產 Codex Review Packet。
- **鐵則 4**:見 §6 五片拆法(v2 三片、v3 四片皆被判 #288-a 超時;v3.1 再拆五片)。
- L1/L2/L3:不適用。

## 4. 🔴 修訂:env 前置檢查**不可**放 globalSetup(codex MF-1 / Fable MF-1)

**兩個審查員獨立親讀本機安裝的 Playwright 1.60.0 原始碼,結論一致**:
執行序 = **webServer plugin setup(`pnpm build && next start` 整條跑完)→ globalSetup**。
(Fable 引 `node_modules/.pnpm/playwright@1.60.0/.../runner/index.js:5828-5834` 與 `:791-809`。)

⇒ v2 §7「globalSetup 內於 build 前檢查 env」**機制上不可能**:
env 缺失時會先白燒一次 build+start,才在別處撞出執行期錯誤。

**修法**:env 檢查放進 `webServer.command` 的**前綴**:
```
node scripts/e2e-prod-preflight.mjs && pnpm build && pnpm exec next start --port 3200
```
`preflight` 只檢查 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
**存在**、**絕不印值**,缺少即非零退出。

🔴 **v3.1 硬修訂(codex R3 must-fix #1、Fable R3 F1 — 兩審獨立命中同一條)**:
`apps/storefront/.env.local` **確實存在**(兩審皆以 `test -f` 核實、皆未讀內容)。
`next build/start` 由 **Next 自己**載入 `.env.local`,故該兩鍵**很可能不在 `process.env`**;
獨立 Node 腳本**不會自動套用 Next 的 env 載入規則**。
⇒ preflight 若照字面只查 `process.env`,在**完全合法的環境下也會恆假紅、本片開工即卡死**。
**規格**:preflight **不可只驗鍵名**、也**不可自行重新實作**一份優先序解析——
必須直接呼叫 **Next 自己載入 env 用的 `@next/env`(`loadEnvConfig`)**,
取它算出來的 `combinedEnv`(已套用 process.env 優先序 + dotenv 解析 + `${VAR}` 展開),
再檢查必要鍵是否為**非空值**。理由(codex #288-a MF1,已實測坐實):自行重寫解析規則
會在「高優先來源空、低優先有值」「`KEY= # comment`」「`KEY=$UNSET_VAR`」三種情境下
誤判為非空(假陰,build 仍會失敗但白跑一次);只有呼叫 Next 實際使用的同一份實作,
才能保證 preflight 看到的與 build 時 Next 看到的是同一個值。
**絕不讀出/印出實際值、絕不寫入任何檔案**。
🔴 錯誤訊息一律寫 **stderr**(Fable F3:webServer stdout 預設 ignore、stderr 預設 pipe;
⚠️ 該預設值 Fable 標「未讀原始碼核實」→ **實作時實測確認**)。

✅ **附帶好處(Fable 指出)**:此順序讓「資料合約需要 server 已起」變成可行 ——
資料合約可安心放 globalSetup(server 那時已 ready)。

## 5. 🔴 修訂:斷言設計(codex MF-2/MF-3、Fable C-3/C-4)

### 5.1 商品卡集合斷言的假紅風險 → **本版不做集合比對**

codex MF-2:商品卡只顯示**當前頁**;若 A 品牌商品全排在 B 的前 25 張之後,
`A+B → B` 時總數正確變動、但**第一頁 slug 集合合法地完全相同** → 斷言誤紅。
Fable C-3 補一條更嚴重的:**品牌案例必須從無 `?page` 的 URL 出發**,
否則 URL 帶 page 時刪 page 本身就換 segment key、**buggy 版也會重抓** → 突變自驗**假綠**。

⇒ 集合比對需要「先挑出首屏確實不同的 A/B」這層資料保證,本版**不做**(隨品牌案例一起後推)。

### 5.2 RSC 請求數守門的致命縫(codex MF-3)

v2 寫「碰撞情境 ≤2」—— 🔴 **原 bug 的 0 次請求也 ≤2、會通過**。
守門本身放行它要抓的那個 bug。

⇒ 修法(納入後續片的規格):碰撞情境 **`1..2`**、非碰撞 **`=1`**;
計數須**精準過濾**:`pathname === '/products'`(exact,非 prefix)+ RSC header / `_rsc` 判別。
🔴 prefix match 會被 `ProductCard.tsx:242` 的 `next/link` viewport prefetch
對 `/products/[slug]` 的請求污染(Fable C-4)。

🔴 **v3.1 補:觀測區間必須明訂**(codex R3 #5「handle during implementation」)——
exact pathname 仍不足:若計數器涵蓋初始載入或下一次操作,**同一路徑**的 RSC 請求仍會污染。
**#288-c 規格**:①每次操作**前清零** ②判別式 = 「RSC header 命中 **OR** 帶 `_rsc` 查詢參數」
③待 URL + 件數 + 商品集合**三者皆達終態後**才結算。
🔴 **另一個 exact-pathname 污染源(Fable R3 F4,已 grep 核實)**:
`MobileTabBar.tsx:49` 的 `href: '/products'` —— mobile 視窗下 tab bar 可見、
viewport prefetch 會對 `/products` **exact 命中**。
⇒ #288-c 須額外以 **query 指紋比對**(斷言該筆請求的 `pbrand` 參數 == 動作後狀態)排除之。
✅ 好消息:`Pagination.tsx` **無 `next/link`/`href`**(Fable grep 零命中)→ 分頁鈕無 prefetch 污染。

### 5.3 #288-a 的 smoke 斷言(v3.2 強化:原版是假綠)

🔴 **v3.2 修訂根因(code-reviewer R1 MF-5,已實測坐實)**:原設計只驗**首頁** 200 + 骨架錨點。
但首頁三個資料來源**全部自帶 catch 並 fallback 成空**
(`lib/products.ts:249-256` featured / `:482-489` categories / `:535-542` taxonomy,
外加 `app/page.tsx:85-88` garage)→ **資料庫完全沒設定時首頁照樣 200 + 骨架可見 = 綠**。
合併「GitHub secret 未設定會內插成空字串」→ **整條 CI 在零資料庫下全綠**。
⇒ 本片差點親手造出它要防的假綠。

**改為驗 `/products`**(`force-dynamic`、每請求真打 Supabase;🔴 **它一樣有 fallback** —— `lib/products.ts:387-390` catch 後回 `{ products: [], total: 0, error: true }`、畫面顯示「載入失敗」而 **HTTP 仍是 200**。⇒ 防線**不是**「沒有 fallback」,而是下列兩條在 error 態必然不成立的斷言):
- `/products` HTTP 2xx
- `.pp-grid a[href^="/products/"]` 首張**可見**且 `count() > 0`(限縮在 `.pp-grid` 內,codex 指出)
- `.pp-count`(`ProductsPage.tsx:154`)解析出的數字 **> 0**(資料庫斷線時此處為 0 或不存在)
- ⚠️ **不斷言**「無 error overlay」—— 那是 dev 概念,production build 無此物(Fable N-10)

**已實測的反假綠證據**:`NEXT_PUBLIC_SUPABASE_URL` 指向不存在主機 → **測試轉紅、exit 1**
(舊版在同情境為綠)。preflight 亦補三負向:空字串 secrets / env 檔內 `KEY=""` / 鍵名拼錯,皆擋。

🔴 **精確字面(codex #288-a MF4 指正,原「DB 壞掉會紅」句式範圍過大、已更正)**:
這條 smoke 只斷言卡片數 >0 與 `.pp-count` >0,精確攔住的是
**「CI 冷快取下,核心商品 RPC 無法提供非零商品」**這一種情況。
**攔不住**:①taxonomy/分類/品牌統計個別失敗、但核心商品 RPC 本身成功
②錯接到另一個「也有商品」的 Supabase project ③本機殘留 warm cache 掩蓋失敗。
本檔與 commit 訊息一律以此精確字面為準,不再寫「DB 壞掉會紅」這類過寬宣稱。

## 6. 🔴 修訂:拆五片(codex R3 實估 v3 的 #288-a 仍約 55 分)

> 🔴 **v3.1(Sean 07-20 拍 A)**:codex R3 must-fix #4 實估 #288-a **約 55 分**
> (v3 漏算 STATUS 七欄 + Review Packet 等規矩要求的收工工作;Fable 估 30-45 分**亦漏算同一批**)
> → **再拆五片**,不走「批准 55 分例外」。共**五片**(#288-a 內含接線 + 會斷 smoke,
> 不另立 a1/a2 兩片——見上方 v3.2 標頭更正)。

| 片 | 範圍 | 檔案清單(🔴 **收檔以本欄為準**) |
|---|---|---|
| **#288-a** | 接線 + **會斷的** smoke:`playwright.prod.config.ts`(port 3200 / `reuseExistingServer:false` / timeout 180s / **`trace: retain-on-failure`**)+ `scripts/e2e-prod-preflight.mjs`(§4 規格,**驗非空值**)+ root `vitest.config.ts` 補 `e2e-prod` exclude + `package.json` script + `.github/workflows/e2e-prod.yml` + `e2e-prod/runner-smoke.spec.ts`(§5.3) | 上列 6 檔 + `docs/phase-1-backlog.md` + `STATUS.md` |
| **#288-b** | 資料合約 globalSetup(含 §7.1 逾時)+ mobile device project(含 `html[data-mobile="true"]` 斷言) | globalSetup 檔 + config + `docs/phase-1-backlog.md` + `STATUS.md` |
| **#288-c** | 品牌兩組(`A→A+B→B` / `A+B→A`)+ 件數 + 集合(需 §5.1 的 A/B 挑選保證)+ RSC 計數(§5.2 全部規則) | spec 檔 + `docs/phase-1-backlog.md` + `STATUS.md` |
| **#288-d** | `?page=3` 時選車:桌面 combobox + 手機 FAB→抽屜「選擇車款」(§7.4 `?vehicle=` 合約);深連結(舊格式)還原波 | spec 檔 + `docs/phase-1-backlog.md` + `STATUS.md` |
| **#288-e** | **分頁黑箱守門**(§1.2 四條不變式) | spec 檔 + `docs/phase-1-backlog.md` + `STATUS.md` |

🔴 **檔案清單為何每片都含 backlog 與 STATUS**(codex R3 must-fix #2):
v3 §7.5 宣稱「把 backlog 明列進檔案清單」但表格**沒真的列**,且完全漏了 STATUS ——
**同款「只改被點名那一處」在 v3 內部縮小復發**(Fable R3 F5 亦獨立命中)。
依 CLAUDE.md 收工清單,**STATUS 七欄必須同 commit 更新**,故每片皆列。

**順序 a → b → c → d → e**,任一片卡住後續不動(不空轉)。
**rollback**:每片各自一個 commit,`git revert` 對應 commit;對 production 零影響
(測試檔不進 build 產物、不改任何 runtime 行為)。

## 7. 其餘逐條修訂

### 7.1 globalSetup 逾時(codex MF-9)
globalSetup **不受一般 test timeout 保護**,手動開 browser 後的 locator 等待可能無限卡住。
⇒ #288-b 必須設 `globalTimeout` + page/action/navigation timeout,失敗訊息列出**非敏感計數**。

### 7.2 port 處置(codex MF-6)
v2 自相矛盾:D4 說「3200 被占用即明確失敗」,§5 突變程序卻叫 `kill` 3200。
⇒ **不自寫 kill、不自寫占用檢查**。Playwright 1.60 在 `reuseExistingServer:false` 下
本就會偵測占用並 throw(Fable N-8 指出內建行為)。突變流程改為
「**讓 playwright 自己起 / 自己收**每一輪」,不手動殺 port(避免誤殺他人程序)。

### 7.3 mobile project 必須是完整 device profile(codex MF-7、Fable C-5)
`app/layout.tsx` 以 **UA 正則**判 `isMobile` 並輸出 `<html data-mobile={...}>`
(自驗:`isMobile = /iPhone|Android|Mobile/i.test(ua)`)。
⇒ 只改 viewport = `data-mobile="false"` + 媒體查詢 mobile 的**混血態**,與真機不一致。
**必須用 playwright 的 mobile device preset(含 UA),並斷言 `html[data-mobile="true"]`。**
v2「或 per-test viewport」這個選項**刪除**。

### 7.4 `?vehicle=` URL 合約(codex MF-8)
自驗 `products-url-state.tsx:353-358`:`segs=[brandObj.id]`,有 model 則 push `modelObj.id`,
有 year 再 push year,最後 `segs.join(':')`
⇒ 格式 = **`brandId:modelId[:year]`**;**只選品牌 = `brandId` 單段**。
#288-d 必須斷言:選車後 URL 的 `vehicle` 為 **taxonomy id 格式**(非人類可讀名稱)、且 `page` 消失。

### 7.5 範圍自相矛盾(codex MF-5)
v2 D5 要求把「手動觸發時機」寫進 `products-url-state.tsx` 檔頭 + backlog,
但 §9 宣稱「不動產品程式碼」、拆片表也沒收這兩個檔 → 執行者照片單做完會漏落檔。
⇒ **修法**:手動觸發時機**只寫進 backlog #288 條目**(不動產品碼檔頭),
並把 `docs/phase-1-backlog.md` **明列進 #288-a 的檔案清單**。§9 同步改為
「不動產品**邏輯**;`products-url-state.tsx` 僅在突變自驗時暫時修改、不進 commit」。

### 7.6 行號更正(codex nit-10、Fable N-9;**四處皆經我自驗**)
| v2 寫 | 正確 | 自驗結果 |
|---|---|---|
| handoff `:85-86` | **`:88-89`** | 該處才是「只在 build 下重現」 |
| `ProductsPage.tsx:367-368` | **`:366`**(href 建立)/ **`:367`**(ProductCard) | ✅ |
| `vitest.config.ts:44` | **`:48`** | `:44` 是 `design-reference/**`、`:48` 才是 `**/e2e/**` |
| backlog `:7130` / `:7197` | 更正內容在 **`:7131-7134`** / **`:7199-7202`** | 原行仍是歷史錯誤句 |

### 7.7 測試數字差異(Fable N-11)
v2 §1 寫 2540、`STATUS.md` 寫 2539 —— **非矛盾**:2539 是 `799a733` **之前**的數字,
本 commit 新增 1 測(FilterDrawer tab 標籤)→ 2540。兩者各自正確。

## 8. 本片將新開/更新的 backlog

- 🆕 **#288-e 分頁黑箱守門**(不變式見 §1.2;🔴 `:275` 僅在**現有十個單元測試案例中**遮蔽 `:281`,**不得**無限定稱後者冗餘);
  在能說清楚「分頁測試要守什麼」之前不寫該測試(附本 plan §1.1 突變對照表為證據)。
- 更新 **#288**:加入「手動觸發時機」四條(Next 大版本升級前 / 動 `products-url-state.tsx` /
  動篩選 URL 層 / #287 落地時)+ 「未進 CI 是已知缺口」。
- 沿用 **#287** 驗收須含「保留舊格式 `?pbrand=` E2E 案例」(#288-d 產出後才適用)。

## 9. 不做什麼(範圍護欄)

- ❌ 不動產品**邏輯**;`products-url-state.tsx` 僅突變自驗時暫時修改、**不進 commit**
  🔴 **v3.1 補復原閘門(codex R3 #6)**:v3 只有「不進 commit」的**宣告**、沒有機制 ——
  精準 stage 別的檔雖能讓它不進 commit,**殘留仍會污染下一片**。
  ⇒ 每輪突變前存原始 `git hash-object`,結束後必須 `git diff --quiet -- <該檔>`;
  **失敗即停止、不繼續下一輪**。
- ❌ 不加 `data-testid`
- ⚠️ ~~不接 CI~~ → **推翻。Sean 2026-07-20 拍 A:接 CI,且由 GitHub Actions 自己 build。**
  🔴 **推翻理由(Sean 當場的判斷)**:不接 CI 會做出「只有人記得才跑」的東西 ——
  而那正是過去兩個月失敗的原因:Playwright 2026-05-27 引進(`435baa4`)後
  **config 建立至今零修改、e2e 停在 2 檔、從未進 CI**,當初註解自寫的
  「CI gate 留後續 slice(T-2+)」兩個月沒發生 → 三個 bug 仍由 Sean 逛正式站發現。
  **做一個沒人跑的守門 = 沒做。**
  🔴 **為何自己 build 而非打 Vercel 預覽網址**:預覽網址有 SSO(實測 302 → `vercel.com/sso-api`),
  繞過需 Protection Bypass for Automation,**該功能 Hobby 方案是否可用查證未果**;
  而本機 `next build` 實測冷啟僅 19 秒 → 自己 build 成本極低且零方案依賴。
  ⇒ `#288-a` 檔案清單**增列** `.github/workflows/e2e-prod.yml`。
  ⚠️ **流程自省**:此拍板 07-20 當場作出,但我**先寫了 workflow 才回頭改 plan**,
  違反「拍板即落檔」;code-reviewer R1 MF-1 因此判本片與 plan 打架、判定成立。
- ❌ 不改既有 `playwright.config.ts` 與既有兩個 dev spec
- ⚠️ ~~不做分頁案例~~ → **改為延後至 #288-e**(§1.2,codex R3 must-fix #3 指正後更正)
- ❌ 不做固定 fixture(codex 指出 fail-fast 只證明「現在勉強可測」;真 fixture 另立議題)
- ❌ 不讀不輸出 `.env*` 內容

## 10. 誠實揭示的未解項

1. **固定測試資料未解決**(codex)。本片走「打真 DB + fail-fast 合約」,
   ⇒ 測試會隨上架狀況波動。真 fixture 是獨立議題、不在本片。
2. **`19s cold / 11s warm` 與 `1440×64 / 54 options`**:兩個審查員皆標 **unverified**
   (它們唯讀、未跑 build/瀏覽器)。這些數字**來自我本 session 實跑**,
   但**未留存輸出於 repo** → 依三來源律,標為「我方實測、審查方未複驗」。
3. **`:281` 是否真為死碼**:§1.1 只證明「現有十個單元測試案例中無法被單行 mutation 打紅」,
   **未證明**它在所有真實情境下都冗餘。故 **`:281` 不刪**;
   且**不因此免除分頁守門** —— 改由 #288-e 以黑箱不變式覆蓋(§1.2)。

## 11. 相關既有紀錄與連動面(SOP ② 必附)

**graphify query**(`"playwright e2e 測試 產品目錄篩選 品牌 分頁 URL 狀態"`,BFS depth=2、42 節點):
命中 `products-url-state.tsx` / `useCatalogFilterUrlSync()`(`:196`)/
`products-url-state.hooks.test.tsx` / `ProductExtraFilters`(`filter-state.ts:42`)。
⚠️ 其餘命中(`lib/auth/line.ts` 群)是 `url` 泛用節點名造成的**假連動**。
🔴 **誠實記錄查詢覆蓋不足**:`Pagination.tsx` / `FilterSide.tsx` / `ProductCard.tsx` /
`CascadeFilterTop.tsx` / `VehicleSelect.tsx` **未出現在結果中** →
本 plan 錨點來自**直接讀碼 + 瀏覽器實測 + 突變實驗**,非 graphify。

**相關紀錄**:#287(本片為其前置守門)/ #288(本片規格,`:7131-7134` 已更正)/
#289 ✅(移交案例 = #288-d)/ #290 ✅(chip 已刪,`799a733`)。

## 12. R3 請重點看

1. §1 的突變實驗結論與「分頁案例不做」的取捨是否成立
2. §6 五片拆法後,#288-a 是否終於在 45 分內
3. §4 env preflight 放 `webServer.command` 前綴是否真的解決順序問題
4. §5.2 的 RSC 計數修訂(`1..2` / `=1` + exact pathname)是否還有縫
5. §7.5 的範圍矛盾是否真的消除(檔案清單 vs §9 護欄)
6. 本版是否還有「宣稱了但沒被任何機制保證」的字面
