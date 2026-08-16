# Phase 1 Backlog

> ✅ **撞號已全數解決(2026-08-13 / #376,B 窗)——本檔目前零撞號。** 對照表(舊號 → 新號,**保留原號的那條列在左**):
>
> | 原撞號 | 保留原號的條目(標題關鍵字) | 改號的條目(標題關鍵字) | 新號 |
> |---|---|---|---|
> | `#308` | 品牌頁 band logo 的 alt 與 h1 重複 | 採購表單的供應商選單沒有 typeahead | **#453** |
> | `#341` | `products-url-state.tsx` 479 行拆檔 | W 線靶族零靶欠款 | **#420**(2026-08-11 先行解決) |
> | `#342` | 卡片快速加購「只會導頁、不能直接加」 | 冪等層「部分接線」維度全線零覆蓋 | **#454** |
> | `#343` | `customer_addresses` 可被客人直接寫入 | 購物車 `found:false` 幽靈行清不掉 | **#455** |
>
> 保留/改號的裁決理由(機械判準,非偏好)= **哪一條的引用面動不得**:`#308` a11y 那條有 7 處 `.tsx`/`.test.tsx` 引用 + #309-#312 同族交叉網;`#342` 加購鈕那條有 `ProductCard.tsx` 引用 + `docs/handoff/CURRENT.md` 未結拍板;`#343` DB 那條被**已 apply 的 migration** `20260809004000_m4b_line3ds_address_email.sql:37` 引用,而**已跑過的 migration 檔不得竄改**(同一條立場見 `docs/specs/2026-08-10-352-receipt-recording-plan-v3.md:123`)。
>
> ⚠️ **引用 backlog 一律釘「編號 + 標題關鍵字」,永遠不要釘行號。** 本檔一直在長,行號釘了就會爛 —— 這行原本釘的六個行號到 2026-08-13 已全數過期,是實錘。
> ⚠️ **`#220` 不是撞號**:`#220` / `#220b` / `#220c` 是同一族的三條。用 `grep -oE '^### #[0-9]+'` 掃會把字尾字母吃掉、把它們算成同號 —— **那是量具的錯,不是資料的錯**。要數撞號請用 `grep -oE '^### #[0-9]+[a-z]*\.'`。
> **角色:** 收錄 Phase 1 期間發現的「未做、待做、需評估」事項
> **不是 STATUS:** STATUS 是當前 slice、本檔是「未來要做、現在不做的清單」
> **不是 PROGRESS:** PROGRESS 是已完成里程碑、本檔是「未完成的雜項」
>
> 衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔 > 對話歷史

---

## 寫法規範(strict)

### 必含元素(每條 backlog)

1. **編號**(`#1` / `#2` 從 1 起跳、不重用)
2. **標題**(精準、不抽象)
3. **狀態**:⏳ 待執行 / 🔴 立即啟動 / ✅ 完成 / ❌ 棄用
4. **優先級**:🔴 高 / 🟠 中 / 🟡 低 / 🟢 觀察
5. **問題**(是什麼狀況)
6. **觸發事件**(何時 / 為何發現)
7. **預期解法**(想怎麼解)
8. **不修會痛在**(三視角:擴充性 / 可維護性 / bug 可追蹤性、**禁空泛、必具體場景**)
9. **估時**(範圍即可)
10. **依賴**(前置條目 / Sean 決策 / 外部因素)
11. **發現於**(日期 + 哪個 slice / session)
12. **相關**(其他相關條目編號)
13. **分流標籤**(待執行條目必標、WO-5 落地):`P1-now` / `P1-before-launch` / `P2-later` / `wont-do`、定義見下方「分流標籤」段

### 禁止寫法

| 禁 | 為什麼 |
|---|---|
| 「待 Sean 決定」 | 空泛、Sean 不知道要決定什麼 |
| 「未來考慮」 | 沒明確時機 |
| 「需評估」 | 評估什麼?標準是什麼? |
| 「建議改進」 | 不修會怎樣? |

詳細範例見 `docs/patterns/pcm-specific.md` §8。

### 分流標籤(待執行條目必標)

每條待執行(⏳ / 🔴)條目在 `- **狀態:**` 行下方加一行 `- **分流:** <標籤>`、四選一:

| 標籤 | 意思 | 判定 |
|---|---|---|
| `P1-now` | 當前 milestone(M-1)就要處理 | 依賴指向 M-1 剩餘 slice(M-1-10~16)或 M-1 範圍內 |
| `P1-before-launch` | Phase 1 範圍、上線前要做 | 依賴指向 M-2~M-6 / 已過期 milestone / 無依賴的文件補強類 |
| `P2-later` | 推遲到 Phase 2 | 條目本身指向 Phase 2 / 換廠商 / Phase 1 完工後 |
| `wont-do` | 不做 | 已被取代 / 過時 / 決定不做 |

✅ 完成 / ❌ 棄用 條目不需分流標籤。新增條目必標(對齊上方必含元素 #13)。

WO-5(2026-05-19)落地:148 條中 115 條待執行已逐條標記(P1-now 17 / P1-before-launch 91 / P2-later 6 / wont-do 1)。

---

## 編號分配

從 `#1` 起跳。**不繼承舊 repo `pcmmotorsports/pcm-website` 的 #1-#90 編號**(Sean 04-29 拍板)。

舊 repo backlog 編號僅供歷史參考、若舊條目要進新 repo、用新編號重新登記、註記「源自舊 repo #N」。

---

## 條目

### #1. ✅ busboy template 指錯舊 repo 路徑

- **狀態:** ✅ 完成
- **優先級:** 🟠 中(已解決)
- **問題:**
  - busboy-start.js / busboy-end.js mapping `'pcm'` 指 `/Users/sean_1/pcm-website` 舊 repo
  - 三來源 STATUS 更新規則不一致(CLAUDE.md vs busboy-end vs 舊慣例)
- **觸發事件:**
  - 2026-04-30 slice 5 前置檢查發現、Sean 拍板 A(覆蓋 mapping)+ P(對齊 CLAUDE.md 鐵則)
- **預期解法:**
  - mapping `'pcm'` → `/Users/sean_1/pcm-website-v2`、移除 `'api'`
  - busboy-end 指示文字改 amend / 6 欄位 / 不另開 docs(status):
- **不修會痛在(已解決前):**
  - 擴充性:每個 slice 結束 busboy-end 跑會去更新舊 repo
  - 可維護性:三來源規則不一致、新 Claude Code 困惑「該照誰」
  - bug 可追蹤性:每個 slice 兩個 commit、git log 雙胞胎噪音
- **解法落點:**
  - pcm-tools commit `9a996f8`(busboy 修好)
  - pcm-website-v2 commit `e43398b`(slice 5 + STATUS amend、驗證 amend 路徑通)
- **估時:** 實際 ~25 分鐘
- **依賴:** 無
- **發現於:** 2026-04-30 / slice 5 前置檢查
- **相關:** #2 / #3

---

### #2. ✅ design-reference submodule 補 .gitignore

- **狀態:** ✅ 完成
- **優先級:** 🟡 低(已解決)
- **問題:**
  - submodule 無 .gitignore、macOS .DS_Store 未排除
  - parent repo 顯示 `modified: design-reference (untracked content)`
- **觸發事件:**
  - 2026-04-30 slice 5 前置檢查首次觸發、Sean 拍板 A(submodule 自己管自己)
- **預期解法:**
  - 在 pcm-website-design repo 加 .gitignore(.DS_Store / IDE / Logs / node_modules / uploads)
  - parent repo 更新 submodule 指針
- **不修會痛在(已解決前):**
  - 擴充性:Claude Design 未來新環境再生 .DS_Store、噪音復發
  - 可維護性:每個 slice 前置檢查都被噪音卡、Sean 每次要解釋一次
  - bug 可追蹤性:真改動時被噪音遮蔽、看不出是真的 untracked
- **解法落點:**
  - pcm-website-design submodule commit `d5ea3aa`(加 .gitignore)
  - pcm-website-v2 parent commit `d692553`(更新 submodule 指針 d700ca4 → d5ea3aa)
- **估時:** 實際 ~10 分鐘
- **依賴:** 無
- **發現於:** 2026-04-30 / slice 5 前置檢查
- **相關:** #1 / #3

---

### #3. ✅ STATUS.md「Busboy 機制」段字面 stale

- **狀態:** ✅ 完成
- **優先級:** 🟡 低
- **問題:**
  - STATUS.md 行 104-110「Busboy 機制」段、字面與 backlog #1 修完後的實際行為不一致
  - 寫「自動更新本檔 4 個欄位」← 應為 6 欄位
  - 寫「repo 參數:`pcm`(本 repo)/ `api`(舊 pcm-website)/ `tools`(pcm-tools)」← `api` 已移除
- **觸發事件:**
  - 2026-04-30 backlog #1 修完後、Claude Code 收尾驗收偵察出
- **預期解法:**
  - 更新該段:「自動更新 6 個欄位」「repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)」
  - 同步補一句:「busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit」
- **不修會痛在:**
  - 擴充性:新 Claude Code 讀此段以舊規則操作、雖跑 busboy-end 會被新指示文字校正、但會浪費時間對照差異
  - 可維護性:文件與實際行為 drift、未來 debug 哪個是真的?讀者要兩邊看、規則來源不單一
  - bug 可追蹤性:若有人主張「按 STATUS.md 寫 4 欄就好」、會跟新 busboy-end 鐵則衝突、誰對誰錯不明
- **估時:** 5 分鐘
- **依賴:** 無
- **發現於:** 2026-04-30 / backlog #1 收尾驗收
- **相關:** #1
- **完成於:** 2026-05-01 / STATUS-fix slice 處理

---

### #4. ⏳ GCP JSON key 路徑安全規範

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - GCP Service Account JSON key 是 sync-engine 認證憑證、洩漏 = SA 完全失控、客戶資料 + Sheets 全洩漏
  - setup §10 紀錄 key 已放 `~/Documents/pcm-credentials/gcp-sync-engine.json`、但「規範」沒明文寫進 repo 文件
  - 新 Claude Code session 看不到約定、可能誤把 key 放 repo 內(例如 `apps/sync-engine/.env` 或 `apps/sync-engine/credentials.json`)
- **觸發事件:**
  - 2026-04-30 setup §10.5「安全紅線維持」紀錄、writing-plans review 時 Sean 提出進 backlog
- **預期解法:**
  - 寫 `docs/patterns/credentials-management.md` 明文規範:
    - 所有第三方 JSON key / token 一律放 `~/Documents/pcm-credentials/`(不在 repo)
    - sync-engine 用環境變數 `GCP_CREDENTIALS_PATH` 指向該路徑
    - `.gitignore` 全 repo 掃過、確保 `*.json`(含 credentials)不入 git
    - 例外清單(allow list):design-reference/data/stores.json 等公開資料 JSON
  - 在 M-5-02 slice(adapters/sheets-api 實作)前完成
- **不修會痛在:**
  - 擴充性:Phase 2 加更多 adapter(LINE OA / 物流 API)、每個都要 SA key、無規範會散落各處、有的進 git 有的沒
  - 可維護性:Sean / 員工 / 新 Claude Code 不知道 key 在哪、找一次學一次、半年後找不回
  - bug 可追蹤性:若 key 真進 git、檢查歷史 commit 找洩漏點時、git log 內可能含 key 字面、需要 git filter-branch 重寫(成本高)
- **估時:** 30 分鐘
- **依賴:** 無、可獨立做、建議在 M-5-01 啟動前完成
- **發現於:** 2026-04-30 / writing-plans skill review
- **相關:** `docs/architecture/security-timeline.md` §3 M-0 / M-5 對應條目 C2 / C9

---

### #5. ⏳ dev → main baseline 設立時機紀錄

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟡 低
- **問題:**
  - setup §10.2(a) 紀錄「dev merge main 是 Phase 1 baseline」事件:Vercel import 預設讀 main、main 是空的、Sean 在 Terminal 跑 `git merge dev --ff-only && git push origin main` 解
  - 9f609b0 已 push 到 main、main 與 dev 同步
  - 但「Phase 1 baseline 何時 merge dev → main」沒有規範:每個 slice 都 merge?每個 milestone merge 一次?上線時才 merge?
  - 缺規範會導致:有時 main 落後 dev 很久、有時 main 跟 dev 太頻繁(失去 review checkpoint 意義)
- **觸發事件:**
  - 2026-04-30 setup §10.2(a) Vercel deploy 事件、writing-plans review 時 Sean 提出進 backlog
- **預期解法:**
  - 寫 `docs/patterns/branching-strategy.md` 明文規範:
    - dev → main 觸發點:**每個 milestone 結束**(M-0 / M-1 / ... / M-6 完成)
    - 不在 slice 結束 merge(slice 是 dev 內單元、main 是 milestone 級別)
    - 不在「想到」就 merge(失去 review checkpoint 意義)
    - 上線當天 main 跟 dev 同步、production 走 main(對齊 NORTHSTAR §1.1 部署)
  - 補 STATUS.md 「最後 milestone main HEAD」欄位、追蹤 main 落後 dev 多少
- **不修會痛在:**
  - 擴充性:Phase 2 啟動時、新 Claude Code 不知道何時 merge、可能誤 push dev 的不穩定 commit 到 main
  - 可維護性:main HEAD 跟 dev HEAD 差距無預期、Vercel main branch deploy 可能跟員工看到的 dev preview 不同步
  - bug 可追蹤性:production 出包時、main 與 dev 差幾個 milestone 不明、無法快速定位 production HEAD = 哪個 milestone
- **估時:** 30 分鐘
- **依賴:** 無、可獨立做、建議在 M-1 結束前完成(M-0 結束時 main 跟 dev 已同步、可 baseline)
- **發現於:** 2026-04-30 / writing-plans skill review
- **相關:** 無

---

### #6. ✅ M-0-01a 字面 vs 事實:typescript 套件實際未裝(主洞已補)

- **狀態:** ✅ 主洞完成(M-0-01b Phase B 補裝完畢)+ ⏳ 子項 6.1 / 6.2 待執行
- **優先級:** 🟠 中(主洞已解、衍生子項中等優先)
- **問題:**
  - M-0-01a commit `dd7b606` 訊息聲稱「建 root TS 環境 + turbo typecheck pipeline」
  - 實際只建了 `tsconfig.base.json` + `turbo.json` typecheck task、**typescript 套件本身沒安裝**
  - M-0-01b Phase A 跑 `pnpm typecheck` 時 6 packages 全部 `tsc: command not found`
  - 字面 vs 事實 drift、commit 訊息誤導後續 slice 規劃
- **觸發事件:**
  - 2026-05-01 M-0-01b Phase A 跑 pnpm typecheck 第一次失敗、Sean 偵察 4 件字面後拍板
- **預期解法(主洞已落地):**
  - 用 pnpm catalog 機制(pnpm 9.5+):
    - `pnpm-workspace.yaml` 加 `catalog: typescript: ^5.7.0` 集中宣告
    - 6 個 packages 各自 `devDependencies` 加 `"typescript": "catalog:"` 引用
  - 避開 `.npmrc shamefully-hoist=false` 的嚴格隔離問題
  - 升 TS 版本只動 `pnpm-workspace.yaml` 一處、不需翻 6 個 package.json
- **根因(供未來避雷):**
  - M-0-01a 把「TS 環境」概念限縮在「設定檔就位」、未驗證實際工具鏈可執行
  - turbo typecheck task 設定了 pipeline、但未要求每個 package 真能跑 tsc
  - Claude.ai 寫 slice 指令無 sandbox 驗證、依靠「邏輯推斷」slice 順序、無實跑 checkpoint
- **不修會痛在(已解決前):**
  - 擴充性:未來其他 milestone 若也用「commit 訊息聲稱完成」當依據、不驗證實跑、會累積技術債
  - 可維護性:`git log` 翻 `dd7b606` 看不到「typescript 未裝」線索、本 backlog 條目作為交叉索引
  - bug 可追蹤性:未來 typecheck 異常先查此條目、確認 typescript 版本與 catalog 設定
- **解法落點:**
  - pcm-website-v2 commit(本檔同 commit、M-0-01b 補丁完整版)
- **估時:** 主洞實際 ~2 工時(含偵察 + 架構評估 + 補裝);子項 6.1 / 6.2 各 15-30 分鐘
- **依賴:** 無
- **發現於:** 2026-05-01 / M-0-01b Phase A typecheck 失敗
- **相關:** 子項 6.1(NORTHSTAR §1.1 補註)/ 子項 6.2(lessons-learned 候選)

#### #6.1 — NORTHSTAR §1.1 過時敘述補註(衍生子項、✅ 完成、由 M-0-07 處理)

- **狀態:** ✅ 完成
- **優先級:** 🟠 中(已解決)
- **完成日:** 2026-05-01 / M-0-07
- **問題(已解決前):**
  - `docs/PHASE-1-NORTHSTAR.md` §1.1 仍寫「用 Medusa 內建 Admin UI、不客製」
  - 但 `docs/decisions/0002-architecture-pivot.md` §1.1 已推翻為「Next.js 自寫 `apps/admin/`、Medusa Admin 完全不用」
  - NORTHSTAR §1.1 字面 vs 0002 ADR 衝突、後續 Claude Code session 讀到舊 NORTHSTAR 可能走錯方向
- **解法落點:**
  - NORTHSTAR §1.1 字面替換為「依 0002 ADR、後台 admin 由 `apps/admin` Next.js 寫、用 `@pcm/ui` design tokens 自組、不用 Medusa Admin 內建 UI(0001 ADR §4『Phase 1 不寫客製 admin』已被 0002 ADR 推翻)」
  - 字面內含 0001 §4 推翻歷史脈絡、不另加註解段、單行整合
  - pcm-website-v2 commit(M-0-07)
- **不修會痛在(已解決前):**
  - 可維護性:未來 session 起手讀 NORTHSTAR、走錯 admin 路線、再回頭發現浪費時間
  - bug 可追蹤性:NORTHSTAR vs 0002 衝突誰對誰錯不明、需另外 grep 比對
- **估時:** 實際 ~5 分鐘(純文件、單行替換)
- **發現於:** 2026-05-01 / M-0-01b 架構深度評估
- **相關:** #6 主條目

#### #6.2 — lessons-learned 立規範:slice 完成驗收必跑實際命令(候選、未滿足條件)

- **狀態:** 🟢 觀察(再發生 1-2 次類似事件才啟動)
- **優先級:** 🟡 低(觀察期)
- **觸發條件:**
  - 若 M-0 / M-1 期間再發生 ≥1 次「commit 訊息字面 vs 實際工具鏈不符」事件
- **預期解法:**
  - 進 `docs/lessons-learned.md` 立規範:
    - 「TS / lint / build 環境 slice 完成驗收必須跑一次實際命令、不只看設定檔」
    - 「commit 訊息禁寫『建 X 環境』之類抽象語、必寫『裝了什麼套件 + 實跑哪個命令通過』具體事實」
- **不修會痛在(若不立規範):**
  - 擴充性:Claude.ai 寫 slice 無 sandbox 持續存在、systemic 風險無 mitigate
  - 可維護性:每次踩坑要重新整理一次教訓、teach 不 over time
- **估時:** 30 分鐘(寫進 lessons-learned)
- **發現於:** 2026-05-01 / M-0-01b 架構深度評估
- **相關:** #6 主條目

---

### #7. ⏳ GitHub Actions CI gate(C5 L3 設施層)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中(C5 L1+L2 已落地、L3 是第三層保險)
- **問題:**
  - 即使 L1(規則層、`docs/patterns/slice-checkpoint.md`)+ L2(busboy-end pre-flight、M-0-09 落地)雙保險、本地 commit 仍可能有 drift:
    - busboy-end pre-flight 被 force-skip 或 bypass
    - Sean 跨機器跑(假設未來)、機器環境不一致
    - main branch 被誤推、無 gate 攔
    - Vercel preview URL 是 runtime 真實驗、本地 build 過不代表 runtime 過(`ignoreBuildErrors` lessons-learned 教訓)
- **觸發事件:**
  - 2026-05-01 / C5 拍板選 L1+L2、L3 留 backlog 等 follow-up slice
- **預期解法:**
  - 寫 `.github/workflows/ci.yml`
  - push 自動跑 typecheck + lint + build
  - PR / push to main 必須全綠才允許 merge
  - Vercel preview URL deploy 起得來為終驗
  - main branch protection rule 要求所有 status check 通過
- **不修會痛在:**
  - 擴充性:Phase 2 75+ slice 規模、L1 + L2 漏網會 systemic accumulate、無第三層 catch、漏網率隨 slice 數線性升高
  - 可維護性:沒有「CI history view」、debug 時不知道哪個 commit 起壞、要 git bisect 慢
  - bug 可追蹤性:Vercel preview URL 是 runtime 真實驗、本地 build 過 ≠ runtime 過、上線前才發現 = 第一輪 `ignoreBuildErrors` 教訓重演
- **估時:** 60-90 min(寫 workflow + 跑通 CI + 配 Vercel preview hook + branch protection rule)
- **依賴:** M-0-09(busboy-end L2)完成後排
- **發現於:** 2026-05-01 / C5 拍板選 L1+L2、L3 留 backlog
- **相關:** #6(M-0-01a 字面 vs 事實事件)、`docs/patterns/slice-checkpoint.md` §6、`docs/architecture/security-timeline.md` §3.D 依賴安全 / §5 三綠 checkpoint 交集點

---

### #8. ⏳ ADR-0003 衝突處置表 7.9 / 7.10 補入

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 低
- **問題:**
  - M-0-07 指令驗證階段發現:`docs/recon/design-reference-recon-2026-04-30.md` §7 實際 7.1 ~ 7.10(10 條)
  - M-0-07 指令採 7.1 ~ 7.8 + (新)order status = 9 條表、漏 §7.9(VehicleFinder 篩選器 vs Phase 2 vehicles entity)+ §7.10(HANDOFF docs 數量名單)
  - Sean 拍板「9 條表為準、§7.9/§7.10 進 backlog 後續 follow-up」
- **觸發事件:**
  - 2026-05-01 / M-0-07 指令驗證階段、Code 報「漏 §7.9 / §7.10」、Sean 選 A1 接續執行(本條目記錄為 follow-up)
- **預期解法:**
  - 讀 recon §7.9 / §7.10 字面
  - 補入 ADR-0003 §4 衝突處置表為 #10(VehicleFinder 篩選器 vs Phase 2 vehicles entity 命名)+ #11(HANDOFF docs 為 meta-doc 議題、處置=非技術衝突、不需 adapter)
  - ADR-0003 §4 表頭從「9 個」改「11 個」、表後說明文字同步更新
  - 變更紀錄欄位加新行
- **不修會痛在:**
  - 擴充性:M-1 寫 Catalog spike 若踩 §7.9 處置邊界(motoBrands 篩選器 vs vehicles entity 命名重疊)、ADR-0003 沒覆蓋、Code 沒有對應依據要回頭修
  - 可維護性:9 條表自稱完整(§4 標題「9 個衝突點處置表」)、實際 90% 覆蓋、新人讀 ADR 假設覆蓋全、走到漏條 case 才發現
  - bug 可追蹤性:落後條目散落兩處(ADR-0003 9 條 + recon §7 10 條)、未來 review 來源不單一、需 grep 比對
- **估時:** 30 min(讀字面 + 補表 + 同步說明)
- **依賴:** 無
- **發現於:** 2026-05-01 / M-0-07 指令驗證
- **相關:** ADR-0003 §4、recon §7.9 / §7.10

---

### #9. ✅ STATUS.md 30 行上限政策待 Sean 重新拍板

- **狀態:** ✅ Resolved
- **優先級:** 🟡 低
- **問題:** CLAUDE.md「STATUS.md 維護」段字面寫「上限 30 行(含空行)。超過 → 精簡 content 但保留六大欄位結構。」但 STATUS.md 實際使用約 70+ 行(因為 6 欄位結構 + 文件交叉引用 + 速查段 + Busboy 機制 + 變更紀錄等內容自然需要的篇幅)、30 行上限明顯不貼合實際。STATUS-fix slice(2026-05-01)Q2 拍板 C「視為待重新拍板、不本次處理」、開本條目追蹤。
- **觸發事件:** 2026-05-01 / STATUS-fix slice review
- **預期解法:** Sean 重新檢視 30 行上限規則、選一:
  - (a)放寬上限至 60-80 行、貼合實際
  - (b)改規則為「主表 30 行 + 速查段不限」、結構性區分
  - (c)拆 STATUS.md 為兩檔(短版 hub + 長版 detail)
  - (d)其他
- **不修會痛在:**
  - 擴充性:未來新 Claude Code 讀 CLAUDE.md 鐵則 vs STATUS.md 實際字面衝突、不知該以哪邊為準
  - 可維護性:每次寫 STATUS.md 都得在「精簡到 30 行」與「保留 6 欄結構」間妥協、低優先但每次發生
  - bug 可追蹤性:若有人依鐵則字面強砍 STATUS.md 到 30 行、會損失 Busboy 機制 / 速查段 / 變更紀錄等重要資訊、屬「規範誤用」事故
- **估時:** 拍板 5 min + 若選 (b)/(c) 額外文件改 30-60 min
- **依賴:** 無、Sean 看到本條目隨時可拍
- **發現於:** 2026-05-01 / STATUS-fix slice Q2
- **相關:** CLAUDE.md「STATUS.md 維護」段、STATUS-fix slice commit
- **Resolution:** 2026-05-17 / M-1-07 STATUS-shrink slice / Sean 拍選項 (b) 路線「主表(7 欄)≤30 + 附屬區不限」、CLAUDE.md「STATUS.md 維護」段字面同步改、STATUS.md 254 行重組落地;附屬區含變更紀錄表 / Busboy 機制 / 文件交叉引用 / 速查、不限長度

---

### #10. ⏳ IShopAdapter Phase 1 補一個 slice 候選

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - ADR-0003 §4 #4 字面:「Phase 1 ShopAdapter 介面 + StaticJsonShopAdapter 實作」
  - PHASE-1-MILESTONES.md M-0-04 字面只列 5 ports(IProductRepository / ICustomerRepository / IOrderRepository / ISheetsAdapter / ITapPayAdapter)
  - 兩字面衝突、M-0-04 拍板 Q1=A 維持 PHASE-1-MILESTONES 字面 5 個、IShopAdapter 等真寫 stores.json adapter 那 slice 才補
- **觸發事件:**
  - 2026-05-01 / M-0-04 brainstorm Q1 拍板 A
- **預期解法:**
  - 在 M-1 後段或 Phase 2 寫 stores.json adapter 那 slice、開頭加「補 IShopAdapter 介面 + Shop entity type」步驟
  - 不單獨開 slice 補介面、跟 adapter 實作併包
  - 預期落點:M-1 結束前(若 storefront 需要店家列表 UI)或 Phase 2 開工前
- **不修會痛在:**
  - 擴充性:stores.json adapter 可能 M-1 後段或 Phase 2 才寫、屆時補介面 + 實作雙工(同 slice 內合理、跨 slice 拆 = 雙工)
  - 可維護性:不修 OK、ADR §4 #4 處置表已記、不會掉(本條目為交叉錨點)
  - bug 可追蹤性:本條目為追蹤錨點、未來 stores.json adapter slice 開工時 grep 此條目知道有未補介面
- **估時:** 30-45 min(寫進 stores.json adapter slice 的開頭步驟、不單獨估)
- **依賴:** 無、跟 stores.json adapter slice 一起做
- **發現於:** 2026-05-01 / M-0-04 brainstorm Q1
- **相關:** ADR-0003 §4 #4、PHASE-1-MILESTONES §3.5 M-0-04

---

### #11. ⏳ TapPay 純度全面重檢:type 位置 + ITapPayAdapter 命名抽象化(待 M-3-08)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - M-0-04 把 TapPayChargePayload / TapPayChargeResult / TapPayRefundPayload / TapPayRefundResult / Cardholder / ChargeStatus 放 packages/domain/src/payment/types.ts
  - 嚴格 ports 純度應放 packages/ports/src/tappay/types.ts(Sean 拍板 Q4=X 暫放 domain)
  - domain 看 TapPay 字眼會困惑(domain 應為 PCM 業務語意、TapPay 是 third-party 廠商)
- **觸發事件:**
  - 2026-05-01 / M-0-04 brainstorm Q4=X 拍板暫放 domain
- **預期解法:**
  - M-3-08 寫 ITapPayAdapter 實作時、跟 adapter 一起重檢
  - **type 位置選一:**
    - (a) 維持現狀(domain/payment 含 TapPay 字眼、註解清楚)
    - (b) 搬到 packages/ports/src/tappay/types.ts(嚴格 ports 純度)
    - (c) 搬到 packages/adapters/src/tappay/types.ts(廠商私域、不入 domain / ports)
  - **介面命名抽象化:**
    - ITapPayAdapter → IPaymentAdapter(對齊 ADR-0003 §3.4 廠商 wire 困在 adapter、ports 抽象 + 業務語意)
    - 實作命名:TapPayPaymentAdapter(廠商前綴 + 介面名稱)
    - 未來換金流(藍新 / 綠界 / Stripe)只動 adapter 實作、不動 ports / use-case
  - **ChargeStatus enum 補 'pending':**
    - 來源:M-0-04 第一輪 engineering:code-review skill audit
    - TapPay 真實流程含 3DS / OTP async、結果可能 pending(非立即 succeeded / failed)
    - M-3-08 寫實作時、ChargeStatus 加 'pending' member、processCharge use-case 處理 async polling
  - 不單獨開 slice 改、跟 M-3-08 adapter 實作合併
- **不修會痛在:**
  - 擴充性:PCM 沒換金流計畫、不修 OK(若未來換金流、本條目 trigger 重檢)
  - 可維護性:domain 跟 ports 邊界目前模糊、看 domain code 看到 TapPay 字眼會困惑(M-1 / M-2 寫 entity 的人需註解才知道為何 payment context 含 third-party type)
  - bug 可追蹤性:本條目 + M-3-08 adapter slice 開工點明確、不會漏
- **估時:** 15-30 min(M-3-08 內附帶處理、若選 b/c 加 grep + 移動)
- **依賴:** M-3-08 啟動
- **發現於:** 2026-05-01 / M-0-04 brainstorm Q4
- **相關:** ADR-0003 §3.4 adapter 邊界、PHASE-1-MILESTONES M-3-08

---

### #12. ✅ Claude.ai 指令撰寫 — 跨 package import slice 前必檢 .npmrc 嚴格模式 + 預留 workspace deps 例外條款

- **狀態:** ✅ 完成
- **完成於:** 2026-05-02 / M-0-09b(integrate 進 working-style.md §6.3 第 8 條)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - M-0-04 執行階段 Code 抓到禁止清單字面「不可動 package.json」與執行步驟字面「ports 引用 domain types via @pcm/domain」衝突
  - .npmrc shamefully-hoist=false 嚴格隔離下、跨 package import 必須 workspace dep 前置;Claude.ai 指令禁止清單字面忽略此前置
  - 後續 M-1 / M-2 / M-3 跨 package import slice 多、不修每個都會重蹈覆轍(每個都觸發中斷 + 衝突回報 + 重新拍板)
- **觸發事件:**
  - 2026-05-01 / M-0-04 執行階段、Code 抓到禁止清單 vs 步驟字面衝突、Sean 拍板 A 加 dep 解、教訓進此條目
- **預期解法:**
  - 待 M-0 全清(M-0-09 完成)後、寫進 docs/working-style.md「Claude.ai 指令發送前自檢」第 8 條:
    - 「跨 package import slice 前必檢 .npmrc 嚴格模式;若有 shamefully-hoist=false / strict-peer-dependencies / 等嚴格設定、執行步驟必含 workspace deps 前置;禁止清單必預留例外條款」
  - 不中斷當前 milestone、待 M-0 收尾時補
- **不修會痛在:**
  - 擴充性:M-1 / M-2 / M-3 跨 package import slice 估 ≥ 10 個(M-1-02 / M-1-03 / M-1-14 / M-2-01 / M-3-02 / M-3-04 / M-3-08 / M-4a-08 / M-5-02 / M-5-03 等)、不修每個都會中斷一次
  - 可維護性:自檢清單第 8 條補上即可、不複雜
  - bug 可追蹤性:本條目為追蹤錨點、M-0-09 完工 trigger 補
- **估時:** 15-30 min(寫 working-style.md 第 8 條 + grep 既有指令樣板核對)
- **依賴:** M-0-09 完成
- **發現於:** 2026-05-01 / M-0-04 衝突回報
- **相關:** docs/working-style.md(待補第 8 條)、.npmrc shamefully-hoist=false

---

### #13. ✅ Money.amount 守門策略待 M-1-02 重檢

- **狀態:** ✅ 完成
- **完成於:** 2026-05-03 / M-0-10b / ADR-0004 Q4=A3 拍板選 (c) brand type MoneyAmount + helper toMoneyAmount(n);docs/patterns/money-handling.md 落地規範字面、packages/domain/src/shared/types.ts 落地實作字面
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - M-0-04 Q4=A 拍板 Money.amount 用 number 整數 + JSDoc + 運算層守門
  - 違反 CLAUDE.md「Server 端鐵則」字面「禁用 number 處理價格」
  - 精神對齊(整數運算避免浮點誤差)、但守門責任分散到各 use-case
  - 不拍守門策略、各 use-case 自由心證、守門品質難 audit
- **觸發事件:**
  - 2026-05-01 / M-0-04 brainstorm Q4=A 拍板
- **預期解法:**
  - M-1-02 第一個用 Money 運算的 use-case(InMemoryProductRepository test 或 calculate-something use-case)時拍板:
    - (a) 維持 number + 各 use-case 寫 `Number.isInteger(amount)` guard
    - (b) 升 bigint(運算精確、但 JSON serialization 要 toString 處理)
    - (c) 升 brand type MoneyAmount + helper toMoneyAmount(n) 守門(集中守門、type-level 防混用)
  - 拍板後寫進 docs/patterns/money-handling.md、所有 use-case 統一遵守
- **不修會痛在:**
  - 擴充性:M-2 / M-3 起 Money 運算 slice 多(calculate-shipping / 折扣 / 退款 / premium_store 升級判斷 / 等)、不拍守門策略每個 slice 自由心證、規範不一致
  - 可維護性:守門責任分散到各 use-case 風險中(漏守門 = 浮點 bug 復發)、未來 audit 找漏點靠 grep 但語法散亂
  - bug 可追蹤性:本條目 + M-1-02 trigger 為錨點、M-1-02 開工時 grep 此條目決議
- **估時:** 30-60 min(M-1-02 內附帶決議 + 寫 docs/patterns/money-handling.md)
- **依賴:** M-1-02 啟動
- **發現於:** 2026-05-01 / M-0-04 brainstorm Q4
- **相關:** CLAUDE.md「Server 端鐵則」、shared/types.ts Money 註解

---

### #14. ⏳ SheetRangeSpec / SheetRow wire-aligned 抽象化待 Phase 2 換廠商前重檢

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟢 觀察
- **問題:**
  - SheetRangeSpec.spreadsheetId / SheetRow.rowIndex 等 Google Sheets API 字面放在 packages/domain/src/sync/types.ts
  - 對比 ADR-0003 §3.4 wire 字面該困在 adapter、ports 介面用 PCM 業務語意
  - 未來換 Airtable / Notion / 等資料源 type 不適用
- **觸發事件:**
  - 2026-05-01 / M-0-04 audit 議題 4
- **預期解法:**
  - Phase 2 換廠商前重檢、抽象成 DataSourceQuery / DataRow 業務語意 type
  - Phase 1 只有 Sheets、stub 階段不阻塞
  - 修法時機:Phase 2 啟動前、跟 sync-engine 重新規劃一起做
  - **SheetRow.values 假設全字串:**
    - 來源:M-0-04 第一輪 engineering:code-review skill audit
    - 現:SheetRow.values: string[](假設 Sheets API valueRenderOption=FORMATTED_VALUE)
    - 若 Phase 2 改用 valueRenderOption=UNFORMATTED_VALUE 模式、API 會返 number / boolean / 等
    - 屆時 type 改 (string | number | boolean)[] 對齊 Google API 字面、或進一步抽象 DataRow.values: unknown[]
- **不修會痛在:**
  - 擴充性:Phase 2 真換廠商時、domain/sync/types.ts 全改、跨 use-case 影響面大
  - 可維護性:看 domain code 看到 spreadsheetId 字眼以為綁死 Google、降低跨平台移植性
  - bug 可追蹤性:本條目 + Phase 2 trigger 為錨點
- **估時:** 30-45 min(抽象 type + grep 全 use-case 修 + 更新 sync-engine adapter mapping)
- **依賴:** Phase 2 啟動 + 換廠商需求明確
- **發現於:** 2026-05-01 / M-0-04 audit
- **相關:** ADR-0003 §3.4、PHASE-1-MILESTONES §8 M-5-02 sheets-api adapter

---

### #15. ✅ Sean skill audit 反查工作流納入 working-style.md(M-0-09 完工 trigger 補)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-02 / M-0-09b(integrate 進 working-style.md §6.3 第 10 條 + Subagent 限制段)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - M-0-04 commit 後 Sean 用 skill audit 反查 Code 產出、抓出 5 議題 + 細節 6-8、觸發 amend
  - 新工作模式(Sean slice-level audit + Code 評估 amend / backlog 處置)vs 既有 working-style.md「Sean 看 milestone 級驗收、異常才找」不同
  - 後續 slice commit 後 Sean audit 是常態、若不寫進規範、下個 Claude.ai / Code session 不知此流程、可能誤以為「commit 是 final」抗拒 amend
- **觸發事件:**
  - 2026-05-01 / M-0-04 audit 反查 + Q3=D 拍板「skill 流程化等 M-0 收尾」
- **預期解法:**
  - M-0-09 全清完(含 #12 / #15)時、補 docs/working-style.md 一節「Sean skill audit 反查工作流」、含:
    - 框架定位:Sean 二次驗收手段、不是 Claude.ai 自動化流程
    - Claude.ai 處置邏輯:audit 抓到問題後評估 amend / backlog 處置(本次模板:🔴 設計缺陷 amend / 🟠 範圍補強 backlog / 🟡 細節 stub 一致不動 / 🟢 已拍板 trade-off 不動)
    - slice 種類 → skill 對應表(security / DDD / UI / 計算 / PR;Code 已分析、見 M-0-04 對話)
    - M-1-02 試跑 architecture-patterns / M-2-02 試跑 /security-review 驗證盲區、把實測結果回填本工作流
  - **條 1:雙跑 skill 結論(來源 M-0-04 兩輪 audit 實測):**
    - 所有有實質 code 的 slice(含 type stub)→ engineering:code-review + simplify 雙跑
    - 純 docs slice(M-0-07 / M-0-08 / M-0-05 規範文件等)→ 不需 skill
    - 依據:M-0-04 雙輪實測 engineering 抓 5 / simplify 抓 12、互不重疊、各有獨家視角(security / correctness vs reuse / quality / efficiency)。Claude.ai 之前預測「type stub 階段 skill 邊際效益遞減」實測打臉。
  - **條 2(N4 並入):JSDoc cross-reference tag 統一規範**
    - 來源:M-0-04 第二輪 simplify N4。跨 12+ 處改、需先拍 tag 規範(@adr vs @see、何時用哪個、是否引入 @adr 0003-§3.1 路徑風格)、跟 #15 working-style 規範同檔同時機補
    - 修法:working-style.md M-0-09 完工 trigger 補時、加一節「JSDoc cross-reference 規範」、跨 6 個 domain context types.ts + 5 個 ports interface 統一 tag 風格
  - **Subagent 限制(2026-05-02 補):** subagent 內不能直接 invoke Skill tool(Skill 是 main-conversation 工具)、所以 skill audit 必須主 session sequential 跑、不能並行 subagent。M-0-04 雙輪實測對齊此限制(主 session 跑 engineering:code-review → 跑 simplify、互不重疊抓 17 議題)。
- **不修會痛在:**
  - 擴充性:M-1 起 75 slice 都可能 audit、不寫規範、Code session 換手時對流程不一致
  - 可維護性:M-0-04 是第一次 audit amend、下次 Claude.ai 可能誤以為「commit 是 final」抗拒 amend(amend 安全的判準是 ahead-of-origin、不是 commit 在不在;此判準需明文寫進規範)
  - bug 可追蹤性:本條目 + M-0-09 trigger 為錨點
- **估時:** 30-45 min(寫 working-style.md 一節 + 範例 + 跟 #12 一起補)
- **依賴:** M-0-09 完成
- **發現於:** 2026-05-01 / M-0-04 audit Q3=D 拍板
- **相關:** docs/working-style.md(待補新節)、backlog #12(Claude.ai 跨 package import 自檢、同 trigger M-0-09)

---

### #16. ⏳ TapPay Cardholder PII logging mask 規範待 M-3-08 寫實作前補

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - Cardholder.email / phoneNumber 是 PII、type 層無 mask 守門
  - rawResponse: unknown 也含 cardholder 資訊(TapPay wire 原樣保留)
  - 來源:M-0-04 第一輪 engineering:code-review skill audit + 第二輪 simplify N8 補強
  - 未來 use-case logging 需特別處理、否則違 GDPR / 個資法
- **觸發事件:**
  - 2026-05-01 / M-0-04 雙輪 skill audit
- **預期解法:**
  - M-3-08 寫 ITapPayAdapter 實作前、必須立 PII logging mask 規範、選一:
    - (a) brand type:`type Email = string & { __brand: 'Email' }`、使用 toEmail() / mask 統一
    - (b) mask helper:`function maskPII(payload: TapPayChargePayload): string`、logging 統一呼叫
    - (c) logging guideline:寫進 docs/patterns/logging.md、所有 logger 必走 mask middleware
  - 配合 M-3-08 實作 slice 一起補、不單獨開 slice
- **不修會痛在:**
  - 擴充性:不立規範、後續 logging 寫法各自為政、PII 洩漏點散
  - 可維護性:個資法風險、寫實作前必補(audit 找漏點靠 grep 但 logger 變體多)
  - bug 可追蹤性:本條目 + M-3-08 前置點明確
- **估時:** 30-60 min(M-3-08 啟動前 + 寫 docs/patterns/logging.md + brand type / helper 任一)
- **依賴:** M-3-08 啟動
- **發現於:** 2026-05-01 / M-0-04 第一輪 engineering:code-review + 第二輪 simplify N8
- **相關:** payment/types.ts Cardholder JSDoc(已加 @see #16)、CLAUDE.md「敏感資訊」段

---

### #17. ✅ export type * 跨 context 命名衝突防護待 M-1-02 寫第一個 entity 時拍

- **狀態:** ✅ 完成
- **完成於:** 2026-05-04 / M-1-02 / Q2=A3 拍板維持 export type * 現狀 + ADR-0003 §3.1.1 補業務規則「跨 context 不准用同名 type」(3 條具體禁止例:sync 不准 Product / order 不准 Customer / payment 不准 Order)+ 順手補「runtime helper 跨 package re-export 規則」(M-1-02 撞 toMoneyAmount typecheck fail 教訓);Phase 2 真撞名再 migrate(加 namespace prefix 或具名 export)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - domain/src/index.ts + ports/src/index.ts 用 export type * 跨 6 個 context 同名 type silent collision 風險
  - 例:若 sync 加 Product (sheet row mapping)、catalog Product 被遮蓋、TS 不報錯
  - 來源:M-0-04 第一輪 engineering:code-review skill audit
- **觸發事件:**
  - 2026-05-01 / M-0-04 第一輪 engineering:code-review
- **預期解法:**
  - M-1-02 寫第一個 entity 時拍命名規範、選一:
    - (a) 加 namespace prefix:`export type * as Catalog from './catalog/types'` → `import { Catalog } from '@pcm/domain'`
    - (b) 改用具名 export:`export type { Product } from './catalog/types'` 顯式列出每個 type、collision 編譯時報錯
    - (c) domain/sync 不放業務 entity 概念類型(只放 Adapter wire types)、避免 sync.Product 衝突
  - 拍板後寫進 docs/patterns/cross-context-naming.md、本 commit 跟之後 entity 統一遵守
- **不修會痛在:**
  - 擴充性:M-1 起寫 entity 加 type 必撞、不立規範自由心證
  - 可維護性:silent collision 看 type 不報錯、debug 困難(需 grep 找重名)
  - bug 可追蹤性:本條目 + M-1-02 trigger 為錨點
- **估時:** 15-30 min(M-1-02 內附帶決議 + 寫 docs/patterns/cross-context-naming.md)
- **依賴:** M-1-02 啟動
- **發現於:** 2026-05-01 / M-0-04 第一輪 engineering:code-review
- **相關:** domain/src/index.ts、ports/src/index.ts、ADR-0003 §3.1 命名分區

---

### #18. ⏳ RawResponseEnvelope<T> generic 抽 TapPay verbs 增加時拍

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - TapPayChargeResult + TapPayRefundResult 共享 envelope { status, <id>: string, rawResponse: unknown }、現各自定義
  - 來源:M-0-04 第二輪 simplify S3(Reuse / Efficiency)
  - Q3=A 最小集精神反對預先抽 generic、留 verbs 增加時拍
- **觸發事件:**
  - 2026-05-01 / M-0-04 第二輪 simplify
- **預期解法:**
  - M-3-08 寫 TapPay adapter 時、若 verbs(void / inquiry / capture 等)增加 ≥ 3 個共享 envelope:
    - 抽 `type RawResponseEnvelope<T> = T & { rawResponse: unknown }`
    - TapPayChargeResult / RefundResult / VoidResult / 等 reuse
  - Phase 1 只 charge / refund 兩個 verbs、不抽
- **不修會痛在:**
  - 擴充性:TapPay verbs 後續可能 ≥ 5 個、不抽 envelope 重複定義
  - 可維護性:預先抽是過度設計、Q3=A 反對
  - bug 可追蹤性:本條目 + M-3-08 verbs 增加 trigger
- **估時:** 5-10 min(M-3-08 verbs 增加時抽 generic、低成本)
- **依賴:** M-3-08 寫 verbs ≥ 3 個共享 envelope
- **發現於:** 2026-05-01 / M-0-04 第二輪 simplify S3
- **相關:** payment/types.ts、backlog #11(TapPay 純度全面重檢)

---

### #19. ✅ Repository<T,ID> base interface 預抽決議待 M-1-02 寫第一個 repo 實作撞重複時拍

- **狀態:** ✅ 完成
- **完成於:** 2026-05-04 / M-1-02 / Q3=A2 拍板選 (b) 維持各 port 各自定義 — 本 slice 加 `IProductRepository.save` 字面落地 (b) 候選精神;未來撞重複 ≥ 3 處(`IProductRepository.save` + `ICustomerRepository.save` M-1-14 + `IOrderRepository.save` M-3-02)再回頭抽 base interface
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟢 觀察
- **問題:**
  - 3 ports findById / save 簽名重複、可抽 `interface Repository<T, ID> { findById; save }` base、各 ports extends
  - 來源:M-0-04 第二輪 simplify N1(Reuse 視角)
  - Q3=A 最小集精神反對預先抽
- **觸發事件:**
  - 2026-05-01 / M-0-04 第二輪 simplify
- **預期解法:**
  - M-1-02 寫第一個 repo 實作時、若實作工作真撞到 findById / save 重複定義模式 ≥ 3 處、拍是否預抽 base interface:
    - (a) `interface Repository<T, ID> { findById(id: ID): Promise<T | null>; save(entity: T): Promise<T> }`、IProductRepository extends Repository<Product, ProductId>、IOrderRepository extends Repository<Order, OrderId>、ICustomerRepository extends Repository<Customer, CustomerId>
    - (b) 維持各 port 各自定義(顯式優於隱式、stub 階段對齊 Q3=A)
  - 拍板時看 use-case + adapter 層真實 import / type 用法決定
- **不修會痛在:**
  - 擴充性:M-1 寫實作必撞 findById / save 重複(InMemory / Medusa adapter 內 method 簽名 copy-paste 3 次)
  - 可維護性:預先抽是過度設計、實際撞到再抽更精準
  - bug 可追蹤性:本條目 + M-1-02 repo 實作 trigger 為錨點
- **估時:** 15-30 min(M-1-02 內附帶決議 + 若選 a 抽 Repository<T, ID> 加進 packages/ports/src/Repository.ts)
- **依賴:** M-1-02 啟動
- **發現於:** 2026-05-01 / M-0-04 第二輪 simplify N1
- **相關:** ports interfaces、ADR-0003 §3.3 ports 介面字面要求

---

### #20. ✅ PaginationParams + Paginated<T> 預定義決議待 M-1-03 寫第一個分頁 use-case 時拍

- **狀態:** ✅ 完成
- **完成於:** 2026-05-04 / M-1-03-pre1(`4f064ac`、`packages/domain/src/shared/types.ts:72-106` 落地 PaginationParams + Paginated\<T\> 泛型 + IProductRepository.searchByKeyword 簽名 (query, params) → Paginated\<Product\> + InMemoryProductRepository 對齊新簽名 + 7-product limit-3 boundary test);M-1-03-prep verify 通過 typecheck 6/6 + lint 10/10 + test 12/12
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟢 觀察
- **問題:**
  - 4 處 TODO 補分頁(IProductRepository.searchByKeyword / IOrderRepository.listByCustomer / listByStatus / listByDateRange)共享同一未來 contract、現各自 TODO 標
  - 來源:M-0-04 第二輪 simplify N2(Reuse 視角)
  - Q3=A 最小集精神反對預先定義
- **觸發事件:**
  - 2026-05-01 / M-0-04 第二輪 simplify
- **預期解法:**
  - M-1-03 寫第一個分頁 use-case 時、預定義 PaginationParams + Paginated<T>:
    - `type PaginationParams = { limit: number; offset?: number; cursor?: string }`
    - `type Paginated<T> = { items: T[]; total?: number; nextCursor?: string }`
    - 放 packages/domain/src/shared/types.ts(跨 context 共用、對齊 MemberTier 模式)
  - 同步更新 4 處 TODO 為實際 method 簽名:`searchByKeyword(query: string, params: PaginationParams): Promise<Paginated<Product>>`
- **不修會痛在:**
  - 擴充性:M-1 起寫分頁 use-case 多、不預定義各自寫法不一致
  - 可維護性:預先定義是過度設計、實際撞到再定義更精準(對齊真實 use-case 需求)
  - bug 可追蹤性:本條目 + M-1-03 trigger 為錨點
- **估時:** 15-20 min(M-1-03 內附帶定義 + 4 處 TODO 換實簽名)
- **依賴:** M-1-03 啟動
- **發現於:** 2026-05-01 / M-0-04 第二輪 simplify N2
- **相關:** ports interfaces 4 處 TODO 分頁註解、shared/types.ts MemberTier 模式

---

### #21. ⏳ SluggedEntity 抽 utility type 決議待 M-1 寫到第二個 slugged entity 撞重複時拍

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟢 觀察
- **問題:**
  - Brand / 未來 MotoBrand / 可能的 CategoryEntity 共享 { id; name; slug } shape、可抽 `type SluggedEntity = { id: string; name: string; slug: string }`
  - 來源:M-0-04 第二輪 simplify N3(Reuse 視角)
  - Q3=A 最小集精神反對預先抽
- **觸發事件:**
  - 2026-05-01 / M-0-04 第二輪 simplify
- **預期解法:**
  - M-1 寫到第二個 slugged entity 時(可能 M-1 升級 MotoBrand value-object 或 M-1-09 SEO 相關 entity)、若實作工作真撞到第二個 { id; name; slug } 模式:
    - 抽 `type SluggedEntity = { id: string; name: string; slug: string }` 進 shared/types.ts
    - Brand / MotoBrand / 等 entity extends SluggedEntity、加自己特殊欄位
  - 不預先抽、留 trigger 點實作撞到再抽
- **不修會痛在:**
  - 擴充性:M-1 起 slugged entity 多、不抽 utility 重複定義
  - 可維護性:預先抽是過度設計、Q3=A 反對
  - bug 可追蹤性:本條目 + M-1 第二 slugged entity trigger 為錨點
- **估時:** 5-10 min(M-1 第二 slugged entity slice 內附帶抽 utility)
- **依賴:** M-1 寫第二個 slugged entity slice
- **發現於:** 2026-05-01 / M-0-04 第二輪 simplify N3
- **相關:** catalog/types.ts Brand、catalog/types.ts FitmentSpec @see M-1 升級 MotoBrand

### #22. ⏳ 字串 leak ESLint rule(ADR-0003 §3.4 對應、Phase 1 不馬上加)

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟡 低(Phase 1 靠 review 流程攔、Phase 2 視需要補)
- **問題:**
  - ADR-0003 §3.4 字面寫「不允許 wire 字串 leak 出 adapter 邊界」+「列入 backlog #8 候選、Phase 1 本決策不馬上加 lint rule」
  - 但實際 backlog #8 為他事(ADR-0003 衝突處置表 7.9 / 7.10 補入)、字串 leak 條目從未建立
  - M-0-03 落地 ESLint 邊界守門時發現此 backlog 編號錯置、本條目補開
  - M-0-03 的 `eslint.config.js` 只守 7 條依賴方向、不守字串 leak
- **觸發事件:**
  - 2026-05-02 / M-0-03 落地 ESLint 邊界守門 + engineering:code-review audit C2 揭示
- **預期解法:**
  - Phase 2 啟動時(或 M-1+ 若提早遇到 wire leak 風險),寫 custom ESLint rule `pcm/no-wire-leak-in-ports`
  - 檢查 packages/ports/ 與 packages/domain/ src 中 string literal 不含 Medusa wire 命名(`metadata.fits` / `region_id` / `shipping_options.metadata.*` 等)
  - 或用既有 `no-restricted-syntax` rule 配 AST selector 攔截
  - 落地時更新 `docs/architecture/dependency-rules.md` §4 移除「未守」標記
- **不修會痛在:**
  - 擴充性:Phase 2 加 use-case 時、若 use-case 拿到 ports 介面回傳值含 wire 字串、整個 Clean Architecture 邊界破功
  - 可維護性:lint 不擋、只能靠 review、人力成本高、易漏
  - bug 可追蹤性:本條目 + ADR-0003 §3.4 + dependency-rules.md §4 三點為錨點
- **估時:** 30-60 min(寫 custom rule + 7 條 wire pattern dry-run + 文件 update)
- **依賴:** 無前置(可獨立做)、建議與 M-1-01 第一個 ports 介面實作 slice 同期或之後做
- **發現於:** 2026-05-02 / M-0-03 audit
- **相關:** ADR-0003 §3.4、`docs/architecture/dependency-rules.md` §4、#23(import resolver、可同 slice 順手做)

### #23. ✅ ESLint typescript-aware import resolver 配置(M-1 第一次跨 package import 前必補)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-04 / M-1-02-prep(裝 eslint-import-resolver-typescript@4.4.4 進 catalog + root devDeps;eslint.config.js settings 配 `import/resolver.typescript = { project: ['packages/*/tsconfig.json'] }`;6 條 dry-run 重跑全 CAUGHT 用相對路徑無副檔名 + typescript resolver、不再用 .ts 副檔名 hack;Rule 5 apps→apps 跳過 apps 純殼對齊 backlog #54 Supersede 待 M-1-01-true / M-4a-01 / M-5-01 apps 真寫 .ts 時補;dependency-rules.md §5.1 從「未配置」改「已落地(packages/* 範圍)」+ §7 變更紀錄加新行)
- **補強註(2026-05-08 / M-1-03-main-d-pre):** project glob 從 `['packages/*/tsconfig.json']` 補強為 `['packages/*/tsconfig.json', 'apps/storefront/tsconfig.json']`(對齊原 L730 預期解法字面 + #54 storefront 部分解開);apps/storefront/tsconfig.json 同 slice 新建對齊 packages/* 模板;apps/api / apps/admin / apps/sync-engine 仍純殼、留 M-4a-01 / M-5-01 各自補時加進 glob
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中(M-1 第一次跨 package import 前必補、否則 boundaries 規則失效)
- **問題:**
  - M-0-03 落地的 boundaries plugin 用 node 預設 resolver、不認 `.ts` 副檔名
  - 無法解析 workspace alias `@pcm/ports`(走 package.json `main: './src/index.ts'`、node 不認 `.ts`)
  - 無法解析無副檔名相對路徑 `'../../ports/src/index'`(node resolver 找不到 `.ts`)
  - M-0-03 dry-run 用 `.ts` 副檔名繞過(`'../../ports/src/index.ts'`)是 transient hack、production code 不會這樣寫
  - **影響**:M-1+ 用 `import { X } from '@pcm/ports'` 寫跨 package import 時、boundaries 可能無法解析 target、不擋違規
- **觸發事件:**
  - 2026-05-02 / M-0-03 落地時發現 + engineering:code-review audit S1 揭示
- **預期解法:**
  - 加 `eslint-import-resolver-typescript` 進 catalog + root devDeps
  - `eslint.config.js` 加 `settings['import/resolver'].typescript = { project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'] }`
  - 重跑 dry-run 7 條(改用 `@pcm/ports` alias + 無副檔名)、確認 boundaries 仍 catch
  - 更新 `docs/architecture/dependency-rules.md` §5.1 標 ✅ 完成、移除 limitation
- **不修會痛在:**
  - 擴充性:M-1 跨 package import 時、boundaries 看不出 target element、規則失效
  - 可維護性:limitation 不修、所有 cross-package import 都得用 .ts 副檔名繞、不合 ts 慣例
  - bug 可追蹤性:本條目 + dependency-rules.md §5.1 為錨點
- **估時:** 20-30 min(裝套件 + 配 settings + 7 條 dry-run 重跑 + 文件 update)
- **依賴:** 各 package 已有 tsconfig.json(M-0-01b 已建)、無其他前置
- **發現於:** 2026-05-02 / M-0-03 audit
- **相關:** `docs/architecture/dependency-rules.md` §5.1、#22(字串 leak、可同 slice 順手做)

### #24. ✅ dependency-rules.md §6.2 補 apps→apps 預設禁的維運說明

- **狀態:** ✅ 完成 2026-06-16(§6.2 加步驟 4 ⚠️ apps→apps default disallow 維運註、對稱 §6.1;同批 doc-drift 清掃)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(doc 維運盲點、不阻塞但維運者可能踩雷)
- **問題:**
  - `docs/architecture/dependency-rules.md` §6.2「加新 app」流程只說「不需動 boundaries/elements」、未提 **apps 之間預設不可互相 import**(default disallow)
  - 若維運者新 app 真的需要 import 既存 app(罕見場景)、會遇到 lint error 不知所以然
  - dry-run 5 已驗證 apps storefront → apps medusa 被擋、但 §6.2 沒提
- **觸發事件:**
  - 2026-05-02 / M-0-03 engineering:code-review audit S2 揭示
- **預期解法:**
  - dependency-rules.md §6.2 補一行:「⚠️ 注意:apps 之間預設不可互相 import(default disallow)。若新 app 真的需要 import 既存 app(罕見場景)、需要在 `boundaries/dependencies.rules` 補 `from: { type: 'apps', app: 'X' }, allow: { to: { type: 'apps', app: 'Y' } }` 規則。」
  - 順手在 §1 實作映射段落加一行說 apps→apps 也禁
- **不修會痛在:**
  - 擴充性:加新 app 時若想 import 既存 app、卡關不知為何
  - 可維護性:doc 維運須知不完整
  - bug 可追蹤性:本條目為錨點、未來實際遇到時可參考
- **估時:** 5 min(改 dependency-rules.md 兩段)
- **依賴:** 無
- **發現於:** 2026-05-02 / M-0-03 audit
- **相關:** `docs/architecture/dependency-rules.md` §6.2、§1

### #25. ✅ dependency-rules.md §5.3 字面前後一致統一

- **狀態:** ✅ 完成 2026-06-16(§5.3 L189 改轉態語氣:storefront 已有 .tsx〔100+ 個〕、flag 從必要降保險;同批 doc-drift)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(doc 字面 polish)
- **問題:**
  - dependency-rules.md §5.3「apps 純殼用 `--no-error-on-unmatched-pattern`」段落字面前後語氣不一致
  - 開頭寫「為讓 8 個 task 都跑通」(必要)、結尾寫「flag 仍可保留(無副作用、保險用)」(降級為保險)
  - reader 讀完不確定 M-1+ 後此 flag 該保留還是該移除
- **觸發事件:**
  - 2026-05-02 / M-0-03 engineering:code-review audit S5 揭示
- **預期解法:**
  - dependency-rules.md §5.3 結尾改為:「M-1 / M-2 裝完 Next.js / Medusa 後、apps 會有 .tsx 檔、本 flag 從必要降為保險、可選保留」
  - 統一語氣、明確標出何時轉態
- **不修會痛在:**
  - 可維護性:doc 字面前後語氣不一致、reader 困惑
  - bug 可追蹤性:本條目為錨點
- **估時:** 2 min
- **依賴:** 無
- **發現於:** 2026-05-02 / M-0-03 audit
- **相關:** `docs/architecture/dependency-rules.md` §5.3

### #26. ✅ partiallyRefunded transition 評估

- **狀態:** ✅ **已收(2026-07-25、M-3 RF2a)** — 評估結論 = **擴 enum**。已落地三項:①`payment_status` 加第 5 值(migration `20260725130000`)②domain `PaymentStatus` union + `PAYMENT_TRANSITIONS`(🔴 Sean Q1=A **允許自我轉移**,支援同一單多次部分退,為 5 值中唯一例外)③**ADR-0003 §3.2 對照表已同步**(wire 欄為 `—`:ADR-0005 已 pivot custom Supabase、無 Medusa 對應需求,不憑記憶填字面)。⚠️ **未 apply production、未 push**,待 Sean `db push`;🔴 `ADD VALUE` **不可逆**。adapter mapping 為直接 passthrough、無需額外映射。詳 `docs/specs/2026-07-25-m3-rf2a-refund-ledger-plan.md`。
- **原狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - PaymentStatus 4 條無 `partiallyRefunded` enum 字面、部分退款結果保留 `paid`(僅退一部分)
  - TapPay 支援 partial refund、客服可能跑「退一半保留 paid」流程、無細粒度狀態追蹤
- **觸發事件:**
  - 2026-05-02 / M-0-06 §8.4 deep audit
- **預期解法:**
  - M-3-08 TapPay refund 實作時依 TapPay 實況評估擴 enum
  - 若擴、加 `partiallyRefunded` enum 字面 + ADR-0003 §3.2 對照表 + adapter mapping 同步
- **不修會痛在:**
  - 擴充性:enum 加值低成本(string literal type 加一條)、Phase 1 客服流程未定型避免過設計
  - 可維護性:M-3-08 直接對 TapPay 字面定形時、enum 字面同步、避免重複決策
  - bug 可追蹤性:客服無細粒度狀態時、「全退 vs 退一半」混在 `paid` / `refunded` 兩態、admin 看不出
- **估時:** M-3-08 同 slice 評估 / 若擴額外 30 min
- **依賴:** M-3-08(TapPay refund 實作)
- **發現於:** 2026-05-02 / M-0-06 §8.4 deep audit
- **相關:** `docs/architecture/medusa-schema-design.md` §8.4「未列 transitions」、`packages/domain/src/order/types.ts:20`、`docs/decisions/0003-domain-entity-naming.md` §3.2

### #27. ⏳ B2B 月結 markPartiallyPaid 分多次累積評估

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 現介面 `markPartiallyPaid` invariant 只支援 `unpaid → partiallyPaid` 單次進入
  - B2B store / premium_store tier 月結客戶可能多次部分付款、無法精確記錄累積金額
  - tier 升級閾值依賴累積金額時、依賴鏈不完整
- **觸發事件:**
  - 2026-05-02 / M-0-06 §8.4 deep audit
- **預期解法:**
  - M-3-02 Order entity 落地時加 `markPartiallyPaid(order, amount)` 參數
  - 介面允許從 `partiallyPaid → partiallyPaid` 累積、不變狀態只更新累積 amount
- **不修會痛在:**
  - 擴充性:M-3-02 同 slice 加 amount 參數零時間差
  - 可維護性:Order entity 完整欄位 M-3-02 才補、避免承諾未驗證 entity 欄位
  - bug 可追蹤性:欄位 ↔ 介面同時定形、避免欄位先有但介面後加的不一致
- **估時:** M-3-02 同 slice 加 30 min
- **依賴:** M-3-02(Order entity 落地)
- **發現於:** 2026-05-02 / M-0-06 §8.4 deep audit
- **相關:** `docs/architecture/medusa-schema-design.md` §8.4「未列 transitions」、§8.3 Wallet row(累積金額欄位)

### #28. ⏳ split shipment line-item-level fulfillment 評估

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟡 低
- **問題:**
  - 目前 `Order.fulfillmentStatus` 是 order-level
  - 一筆訂單拆多次出貨(品項分批到貨)無法精確追蹤
  - Medusa 內建有 line-item-level fulfillment、Phase 1 簡化用 order-level
- **觸發事件:**
  - 2026-05-02 / M-0-06 §8.4 deep audit
- **預期解法:**
  - Phase 1 維持 order-level、Phase 2 大訂單再加 line-item-level
  - 或 M-3-02 Order entity 落地時、`OrderItem` 預留 `fulfillmentStatus` 欄位、預設等於 order-level
- **不修會痛在:**
  - 擴充性:Medusa line-item-level 可漸進啟用、不破壞 order-level 介面
  - 可維護性:Phase 1 簡化清楚、Phase 2 大訂單時再加細粒度
  - bug 可追蹤性:line-item metadata 補齊後、客人查詢「我的部分商品在哪」admin 有分包資訊
- **估時:** Phase 2 評估 / 若擴額外 4-6 hr
- **依賴:** Phase 2 啟動 / 或 Phase 1 出現大訂單需求
- **發現於:** 2026-05-02 / M-0-06 §8.4 deep audit
- **相關:** `docs/architecture/medusa-schema-design.md` §8.4「未列 transitions」、`packages/domain/src/order/types.ts:34`

### #29. ⏳ Order paymentMethod 欄位評估

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 目前 PaymentStatus 不分支付方式(信用卡 / 儲值金 / 月結)
  - Phase 2 Wallet 啟用後、儲值金回饋邏輯需要區分支付方式才能判斷觸發條件
  - tier 升級閾值依賴「累積消費金額」、需要區分「儲值金支付」vs「信用卡支付」
- **觸發事件:**
  - 2026-05-02 / M-0-06 §8.4 deep audit
- **預期解法:**
  - M-3-02 Order entity 落地時加 `Order.paymentMethod: PaymentMethod` 欄位
  - 字面待定:候選 `'tappay' | 'wallet' | 'invoice'`(對齊 PaymentStatus camelCase 風格)
- **不修會痛在:**
  - 擴充性:M-3-02 同 slice 加 paymentMethod 欄位零時間差
  - 可維護性:Wallet Phase 2 啟用前必有此欄位、避免 Phase 2 啟用時回頭 migrate
  - bug 可追蹤性:支付方式 ↔ 儲值金回饋邏輯 ↔ tier 升級依賴鏈完整、Phase 2 啟用時邏輯清晰
- **估時:** M-3-02 同 slice 加 15 min
- **依賴:** M-3-02(Order entity 落地)/ Wallet Phase 2 啟用
- **發現於:** 2026-05-02 / M-0-06 §8.4 deep audit
- **相關:** `docs/architecture/medusa-schema-design.md` §8.4「未列 transitions」、§8.3 Wallet row、`docs/features/vehicle-service-ecosystem.md` §4.6

### #30. ⏳ fitment 篩選 scale 風險評估

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `Product.fitments: FitmentSpec[]` 落 Medusa `metadata.fits[]` 自由字串 array
  - Medusa metadata 無 native 索引(JSONB 預設無索引)
  - 10 萬商品 × 多 fitment 篩選 query 可能掃全表、Catalog adapter 落地必踩
  - Phase 1 上線後 fitment 篩選慢到不能用(query > 5s)、客人搜不到適用零件、第一個 scale 爆炸點
- **觸發事件:**
  - 2026-05-02 / M-0-06 全專案 audit sneak peek(對應 Sean「販售上架破 10w 商品」訴求)
- **預期解法:**
  - M-1-03 Catalog adapter 落地時測 scale 後決定方案
  - 候選 A:Postgres GIN index on JSONB(`CREATE INDEX ... USING GIN (metadata jsonb_path_ops)`)
  - 候選 B:抽 fitments 為獨立表 entity(`product_fitments` 表 + FK)、走 Medusa custom module
  - 候選 C:走 search engine(Algolia / Meilisearch)、Phase 2 規模時加
- **不修會痛在:**
  - 擴充性:scale 解法選 A 改 schema 最少、選 B 對 fitment query 最快、選 C 對 search UX 最好
  - 可維護性:M-1-03 落地時測 scale 後再決定方案、避免過早優化
  - bug 可追蹤性:scale issue 必須有 query 時間 monitoring(p50 / p95 / p99)、否則上線後爆才發現
- **估時:** M-1-03 評估 30 min / 若選 A 額外 1 hr / 若選 B 額外 4-6 hr / 若選 C 額外 1-2 週(Phase 2 啟動時)
- **依賴:** M-1-03(Catalog adapter 落地)/ 上線後 product 數 > 10000
- **發現於:** 2026-05-02 / M-0-06 全專案 audit sneak peek
- **相關:** `docs/architecture/medusa-schema-design.md` §2(Product)、`docs/decisions/0003-domain-entity-naming.md` §4 第 3 條(fits)、`docs/PHASE-2-VISION.md` §1 #1(大量上架)

### #31. ⏳ 客服 schema 預留評估

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - `vehicle-service-ecosystem.md` §4.8 字面「客服人工管道」、Phase 1 不入系統
  - `Customer.metadata` 沒預留客訴 / SLA / dispute 欄位
  - Phase 2 客服 inbox(`security-timeline.md` §3 #C8)落地時要回頭 migrate
  - 客訴歷史散落 LINE / email / Slack、admin 無系統紀錄查歷史
- **觸發事件:**
  - 2026-05-02 / M-0-06 全專案 audit sneak peek(對應 Sean「客人也很難搞」訴求)
- **預期解法:**
  - M-3 Customer entity 落地時、`Customer.metadata` 預留 `supportTickets[]` 欄位(空 array)
  - Phase 1 不啟用業務邏輯、只留欄位、Phase 2 客服 inbox 啟用時直接 backfill
- **不修會痛在:**
  - 擴充性:M-3 customer.metadata 預留 supportTickets[] 零成本
  - 可維護性:Phase 1 不啟用業務邏輯、只留欄位、避免過設計
  - bug 可追蹤性:難搞客人歷史紀錄完整可追溯、admin 一查就知道過往爭議
- **估時:** M-3 同 slice 加 5 min(欄位預留)/ Phase 2 客服 inbox 啟用 1-2 週
- **依賴:** M-3(Customer entity 落地)/ Phase 2 客服 inbox 啟用
- **發現於:** 2026-05-02 / M-0-06 全專案 audit sneak peek
- **相關:** `docs/architecture/security-timeline.md` §3 #C8、`docs/features/vehicle-service-ecosystem.md` §4.8 / §11.3

### #32. ⏳ IPricingRepository / IPricingService 抽象(Pricing context port 缺位)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - schema-design §5 + ADR-0003 §4 #6 規劃 Pricing 走 Medusa price_list + customer_group、但 5 ports 不含 Pricing
  - storefront server-side render 直接讀 `Product.priceByTier[customer.tier]`、邏輯散在 storefront / use-case / adapter、無集中 PricingService
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T1)
- **預期解法:**
  - M-2-08 落地時抽 `IPricingService.computePriceForCustomer(productId, customerId): Money`、storefront 走 service 不直接讀 Product.priceByTier
- **不修會痛在:**
  - 擴充性:Phase 2 「廠牌折扣 + VIP + tier」三層 stack(0002 §4.3)、無 IPricingService = storefront server bundle 含計算邏輯
  - 可維護性:M-2-09 / M-3-06 兩處算 price 邏輯、改規則(NT$ 1000 滿減運費)需改兩處
  - bug 可追蹤性:客訴「某商品價格不對」、查 storefront log / use-case log / adapter log 三處才能定位
- **估時:** M-2-08 同 slice 加 60-90 min(IPricingService 抽 + storefront 改路徑)
- **依賴:** M-2-08(Pricing Price List)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/medusa-schema-design.md` §5、`docs/decisions/0003-domain-entity-naming.md` §4 第 6 條、`docs/audits/2026-05-02-full-audit.md` Audit-F16

### #33. ⏳ IInventoryRepository 缺位(inventory context port + entity 欄位)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - PHASE-1-MILESTONES §8 M-5-05 規劃 auto-update-inventory use-case、schema-design §2.1 寫「inventory 推延到 M-1-02 補」、但無 IInventoryRepository
  - 10w 商品庫存批次同步、靠 `IProductRepository.save(product)` 整 entity 覆寫、N 次 round-trip 效能差
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T2)
- **預期解法:**
  - M-1-02 / M-5-05 啟動前抽 `IInventoryRepository.updateStock(productId, quantity)` + `getStock(productId)`
- **不修會痛在:**
  - 擴充性:Phase 2 多倉庫(PCM 倉 + 合作店家倉)inventory 分散、無 IInventoryRepository = inventory 跨倉邏輯散
  - 可維護性:sync-engine 改庫存走 IProductRepository.save 整體 update、N 次 round-trip
  - bug 可追蹤性:「客人下單顯示有貨實際缺」、查 product update log 找不到 inventory 變動 trace
- **估時:** M-1-02 同 slice 加 30-45 min(介面字面)、M-5-05 落地實作 60 min
- **依賴:** M-1-02 / M-5-05
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/medusa-schema-design.md` §2.1、`docs/audits/2026-05-02-full-audit.md` Audit-F17
- **Supersede 註(2026-05-04 / M-1-02):**
  - **業務訊號推翻原推薦處置:** Sean 2026-05-04 業務訊號(PCM 訂貨型業務、商品基本無庫存、需訂貨 3-6 週)、客人只需看「可訂 / 訂不到」、不需要數字
  - **解法變更:** 不抽 IInventoryRepository、不加 inventoryQuantity 數字欄位;改加 `Product.availability: 'in-stock' | 'out-of-stock'`(語意化)、走 `IProductRepository.save` 改值(M-1-02 拍板 Q4=A1)
  - **trigger 變更:** 從「M-1-02 / M-5-05 啟動前」**精修為**「Phase 2 真撞高頻 availability 變動 / 多倉庫業務(PCM 倉 + 合作店家倉)需求時」
  - **audit-F17 處置:** 原 audit 推薦「N round-trip 效能差」對 200 SKU + 訂貨型業務不適用、留錨點供 Phase 2 重評

### #34. ⏳ Order.total 缺 breakdown(subtotal / shipping / discount / tax)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `packages/domain/src/order/types.ts:76-77` 只 total: Money 一條
  - 退款 / dispute 時無法拆 subtotal / shipping / discount / tax;發票自動化拆 line 也無法依靠
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T3)
- **預期解法:**
  - M-3-02 加 `Order.subtotal / shippingFee / discount / total` 4 個 Money 欄位
- **不修會痛在:**
  - 擴充性:A3 發票自動化拍板要做時、發票拆 line 必有金額 breakdown、Order.total 一條無法切
  - 可維護性:M-3-08 partial refund 跑 amount 計算複雜、邊算邊查 wire 還原而非 entity
  - bug 可追蹤性:客服「我的訂單退款少 300」、查 Order.total 看不到拆解、必須 grep TapPay rec_trade_id 找原始 amount
- **估時:** M-3-02 同 slice 加 30 min
- **依賴:** M-3-02(Order entity)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/order/types.ts:76-77`、`docs/audits/2026-05-02-full-audit.md` Audit-F2

### #35. ⏳ search engine plan 未拍(searchByKeyword 對 10w 商品 PG ILIKE 慢)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `packages/ports/src/IProductRepository.ts:20` searchByKeyword 介面已存、但 Phase 1 預期 PG ILIKE 對 10w 商品必慢(p99 > 5s)
  - fitment 篩選 scale(#30)只解 fitment、keyword search(品名 / brand / category 自由打)是另一條 query path
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T4)
- **預期解法:**
  - 候選 A:M-1-03 落地時用 PG `tsvector` + GIN(零外部依賴、TWD 中文需 `pg_jieba` extension)、Phase 2 觸發再升 Meilisearch【推薦】
  - 候選 B:Phase 1 直上 Meilisearch / Algolia(管理成本但 search UX 即用)
  - 候選 C:維持 PG ILIKE、上線後監控、超過閾值再升(風險高)
- **不修會痛在:**
  - 擴充性:Algolia / Meilisearch / PG GIN 三方案、改架構成本不一、不先決就直接 PG ILIKE 上線後爆
  - 可維護性:Phase 2 換 search engine、storefront search bar / VehicleFinder 改寫
  - bug 可追蹤性:客人「搜某商品搜不到」、不知是 ILIKE 大小寫敏感 / encoding / metadata 欄位差異、無 search query log
- **估時:** M-1-03 拍板 30 min / 若選 A 額外 60 min(GIN index)/ 若選 B 額外 4-6 hr(Meilisearch 接入)
- **依賴:** M-1-03(MedusaProductAdapter)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/ports/src/IProductRepository.ts:20`、`docs/phase-1-backlog.md` #30(fitment scale)、`docs/audits/2026-05-02-full-audit.md` Audit-F18

### #36. ⏳ monitoring / alerting plan 缺(p99 latency / error rate / 慢查詢)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `docs/architecture/security-timeline.md` §7 劃線「監控不足屬 OWASP 但無 specific plan」
  - p99 latency / error rate / 慢查詢 / TapPay 失敗率 / sync-engine 跑批失敗 都無 monitoring;F1 兩層保險只覆蓋 sync-engine
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T5)
- **預期解法:**
  - M-6-08 上線前加 Sentry(error monitoring)+ Vercel Analytics(p99)、最小可行;Phase 2 視需要升 OpenTelemetry
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter(LINE / 物流 API / 廠商爬蟲)加進來、無 monitoring 框架、新 adapter 各自 print log 散落
  - 可維護性:錯誤分散在 Vercel log / Railway log / sync-engine local log、找 1 個錯走 3 處
  - bug 可追蹤性:客人「下單失敗」、無 distributed tracing、不知是 storefront / Medusa / TapPay / Supabase 哪一段失敗
- **估時:** M-6-08 加 2-3 hr(Sentry 接入 + Vercel Analytics 設定)
- **依賴:** M-6-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/security-timeline.md` §7、`docs/phase-1-backlog.md` #30(fitment scale 提及 query 時間 monitoring)、`docs/audits/2026-05-02-full-audit.md` Audit-F19

### #37. ⏳ OrderItem 缺 lineTotal + tierAtCheckout(B2B 對帳 / dispute 追溯)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `packages/domain/src/order/types.ts:42-51` OrderItem 結帳當下 customer.tier 未記錄、tier 變動歷史對帳找不出
  - 客訴「我那時是 store tier、admin 看到我訂單 unitPrice 是 retail price?」無法回溯
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T6)
- **預期解法:**
  - M-3-02 加 `OrderItem.lineTotal: Money` + `OrderItem.tierAtCheckout: MemberTier`
- **不修會痛在:**
  - 擴充性:Phase 2「premium_store 自動降級」(累積消費低於閾值)、查歷史訂單 tier 變動軌跡需 OrderItem.tierAtCheckout
  - 可維護性:M-3-11 premium_store 自動升級邏輯依賴歷史訂單金額、若 unitPrice 是 retail 但客人那時是 store、計算錯
  - bug 可追蹤性:稽核「為何同商品同時段 admin 看到的 unitPrice 不同」、無 tier 紀錄找不到 root cause
- **估時:** M-3-02 同 slice 加 15 min
- **依賴:** M-3-02
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/order/types.ts:42-51`、`docs/audits/2026-05-02-full-audit.md` Audit-F7

### #38. ⏳ listByFitment(spec) 單數 vs 多選衝突(篩選器多車型 OR)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🔴 高
- **問題:**
  - `packages/ports/src/IProductRepository.ts:18` 介面字面 spec 單數
  - design 篩選器(VehicleFinder + FilterSide cascade)允許「Yamaha CBR600RR + Honda CB1000R」多選 OR、需 specs[]
  - Product.fitments: FitmentSpec[] 是 array、query 介面卻單 spec、不一致
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T7)
- **預期解法:**
  - 改 `listByFitment(specs: FitmentSpec[]): Promise<Product[]>` 表達 OR 多選
- **不修會痛在:**
  - 擴充性:Phase 1 storefront 4 篩選器(M-1-09/10/11/12)只能單車型搜、客人多車主場景搜不出
  - 可維護性:M-1-03 adapter 落地時、要解構單 spec 為 metadata_filters wire query、若改多 spec 要改 wire query 邏輯
  - bug 可追蹤性:無
- **估時:** M-1-03 / M-1-12 同 slice 加 15 min(介面字面 + adapter wire query 改)
- **依賴:** M-1-03(MedusaProductAdapter)/ M-1-12(ProductsPage 4 篩選整合)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/ports/src/IProductRepository.ts:18`、`docs/audits/2026-05-02-full-audit.md` Audit-F3

### #39. ⏳ Order.fulfillmentMethod 欄位缺(寄家 / 寄店家 / 自取)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `packages/domain/src/order/types.ts:69-78` Order entity 字面無 fulfillmentMethod
  - M-3-05 calculate-shipping use-case「滿 4000 免運 + 偏遠 + 寄店家固定 100」需要知道客人選哪種運送
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T8)
- **預期解法:**
  - M-3-02 加 `Order.fulfillmentMethod: 'home' | 'shop' | 'pickup'`
- **不修會痛在:**
  - 擴充性:Phase 2 加宅配 / 超商 / 機車快遞、enum 加值、現在加成本零、之後 migrate 成本高
  - 可維護性:calculate-shipping 內 hardcode 三 case、Order 看不到、admin 詳情頁要 derive
  - bug 可追蹤性:客人「我選寄家但收到簡訊去店家領」、Order 無紀錄、靠 metadata 解
- **估時:** M-3-02 同 slice 加 10 min
- **依賴:** M-3-02
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/order/types.ts:69-78`、`docs/phase-1-backlog.md` #29(paymentMethod、不同欄位)、`docs/audits/2026-05-02-full-audit.md` Audit-F4

### #40. ⏳ Customer phoneNumber + address 欄位缺

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - `packages/domain/src/identity/types.ts:13-17` Customer 只 id / email / tier、結帳必填 phoneNumber + address 欄位字面無
  - security-timeline §C7 寫客人手機 / 地址 PII server-side 才查全、但 entity 缺欄位不知哪個 PII 是 customer-level / 哪個 order-level
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T9)
- **預期解法:**
  - M-2-04 落地時加 `Customer.phoneNumber: string` + `Customer.addresses: Address[]` + `Order.shippingAddress: Address`(snapshot)
- **不修會痛在:**
  - 擴充性:M-2-04 AccountPage 6 tab(profile / address / vehicles)需 Customer.address 結構、不先定設計散
  - 可維護性:訂單下單表單 vs Customer profile 兩處填地址、不同步
  - bug 可追蹤性:客人「我地址改了但訂單通知用舊地址」、address 是 Customer-level 還是 Order-level snapshot 不清
- **估時:** M-2-04 同 slice 加 30 min
- **依賴:** M-2-04(AccountPage 6 tab)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/identity/types.ts:13-17`、`docs/architecture/security-timeline.md` §3 #C7、`docs/audits/2026-05-02-full-audit.md` Audit-F20

### #41. ⏳ ChargeStatus 缺 disputed / chargedBack(production dispute 場景)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `packages/domain/src/payment/types.ts:18` ChargeStatus = 'succeeded' | 'failed' 不夠用
  - production 銀行 dispute 是非同步、可能 2 週後 issuer 撤回 charge、需 disputed / chargedBack 字面
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T10)
- **預期解法:**
  - M-3-08 落地前加 `'succeeded' | 'failed' | 'pending' | 'disputed' | 'chargedBack'`
- **不修會痛在:**
  - 擴充性:Phase 2 dispute 場景、enum 加值零成本、現加比後改
  - 可維護性:M-3-08 sandbox 預設不會回 pending、production dispute 漏處理
  - bug 可追蹤性:dispute 發生時、admin 看 ChargeStatus 仍 succeeded 但實際銀行已撤回、PCM 收不到錢
- **估時:** M-3-08 同 slice 加 10 min(enum + adapter mapper)
- **依賴:** M-3-08(TapPay sandbox 整合)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/payment/types.ts:18`、`docs/audits/2026-05-02-full-audit.md` Audit-F5

### #42. ⏳ logging strategy / PII masking utility(集中 mask / log format)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - `docs/architecture/`(無 logging-strategy.md)、各 adapter 各自 log、無集中規範(level / format / 敏感欄位 mask)
  - security-timeline §C7 / §C8 / §C6 三條都依賴 logging mask、但無 utility
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T11)
- **預期解法:**
  - M-3-08 啟動前寫 `packages/use-cases/src/utils/log-masking.ts`(maskPhone / maskEmail / maskAddress / maskTapPayCardholder)+ 各 adapter 必呼叫
- **不修會痛在:**
  - 擴充性:Phase 2 加 LINE / 物流 / claude-api adapter、各 adapter 各 log 不一致格式、aggregator 無法 parse
  - 可維護性:每個 adapter 自己決定 mask 邏輯、改 mask 規則(例追加身分證遮蔽)散在多處
  - bug 可追蹤性:dispute 客訴「PCM 把我電話 log 出來」、grep log 找不到統一遮蔽點
- **估時:** M-3-08 啟動前 90-120 min(utility + 各 adapter 接入規範)
- **依賴:** M-3-08(TapPay PII 落地)、優先於 backlog #16
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/security-timeline.md` §3 #C7 / #C8、`docs/phase-1-backlog.md` #16(範圍擴展)、`docs/audits/2026-05-02-full-audit.md` Audit-F8

### #43. ⏳ image CDN / storage strategy(10w 商品 50w 圖)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - schema-design §2.1 寫「images 推延 M-1-02」但只是欄位、CDN 不在那
  - 10w 商品每個 1-5 張圖 = 50w 圖、PG storage 不適合大量 binary、必走 S3 / Cloudflare R2 / Vercel Blob
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T12)
- **預期解法:**
  - 候選 A:M-1-02 啟動前拍板 Cloudflare R2 + image transform CDN(免費額度大)【推薦】
  - 候選 B:Phase 1 直上 Vercel Blob、Phase 2 換
  - 候選 C:Medusa default storage Phase 1 容忍、上線後再換
- **不修會痛在:**
  - 擴充性:image upload 走哪個 service 不拍、Phase 2 換 CDN 必 migrate 全 image URL
  - 可維護性:image transform(resize / webp)在 backend 做還是 CDN 做不一致
  - bug 可追蹤性:客人「圖載很慢」、無 image performance log
- **估時:** M-1-02 拍板 30 min / 若選 A 額外 2-3 hr(R2 接入 + transform 設定)
- **依賴:** M-1-02(Product entity images 落地)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/medusa-schema-design.md` §2.1、`docs/audits/2026-05-02-full-audit.md` Audit-F21
- **Supersede 註(2026-05-04 / M-1-02-prep):**
  - **推薦處置變更:** ADR-0004 Q2=A2 拍板 Image storage = **Supabase Storage**(跟 Q1 同生態、上線時同步升 Pro)、推翻原候選 A 推薦的 Cloudflare R2;候選 B Vercel Blob / 候選 C Medusa default storage 仍可作為 Phase 2 重新評估時的對照案
  - **trigger 變更:** 從「M-1-02 啟動前」**精修為**「M-1-13(ProductPage 顯示)/ M-1-16(種子 import 真上傳圖)啟動前」(M-1-02 只寫 images URL string field、不真實 upload)

### #44. ⏳ 種子 200 SKU → ongoing import transition plan(合併 sync conflict 風險)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🔴 高
- **問題:**
  - PHASE-1-MILESTONES §4 M-1-16 規劃 200 SKU 一次性 import、§8 M-5-03 才落 sync-engine ongoing
  - M-1 ~ M-4 期間(6-9 週)若 Sean 想加新 SKU、走哪個流程?無規範
  - 同一商品在「種子」與「sync-engine 寫候選」兩流程觸發、可能重複建商品 / 蓋寫 metadata(合併 R16 conflict 風險)
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T13)+ operations:risk-assessment(R16 合併)
- **預期解法:**
  - M-1-16 啟動前寫 `docs/runbooks/manual-product-upload.md`(M-1 ~ M-4 期間 Medusa Admin 直接上)+ dedupe key(SKU code)、sync-engine 同 key matcher 不重建
- **不修會痛在:**
  - 擴充性:Phase 2 加 vendor crawler、source-of-truth 衝突更多
  - 可維護性:M-1 ~ M-4 期間若新品上架需求、員工沒流程、走 ad-hoc 慣例後續沿用
  - bug 可追蹤性:重複商品出現時、查哪邊是 source 不易;某 SKU 是 M-1-16 一次性還是 M-3 員工手動 admin 上、無 trace
- **估時:** M-1-16 啟動前 60 min(runbook + dedupe key 設計)
- **依賴:** M-1-16(種子 import)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` §4 M-1-16 / §8 M-5-03、`docs/audits/2026-05-02-full-audit.md` Audit-F6

### #45. ✅ testing-strategy.md 待寫(0002 ADR §7 列待寫)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-03 / M-0-10a / ADR-0004 Q5=A3(minimum 版);docs/architecture/testing-strategy.md 落地(test 位置 / vitest / mock 風格 / description 慣例);coverage / E2E 範圍留 G2 / M-6 拍板後擴
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - `docs/architecture/`(無 testing-strategy.md)、0002 ADR §7 列「待寫(M-6 / G2 拍板後)」
  - M-1-02 起寫 test 前無集中規範(test 位置 / vitest / mock 風格 / coverage 目標 / contract test 框架)
  - 各 slice 自由發揮、test 風格散
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T14)
- **預期解法:**
  - M-1-02 啟動前寫 testing-strategy.md(test 位置 / vitest 設定 / mock 風格 / contract test 框架是否 Phase 1)、不等 G2 拍板
- **不修會痛在:**
  - 擴充性:Phase 2 9 大 contexts 各自 test 風格、後續整合 E2E 苦
  - 可維護性:M-1-02 寫的 test 風格 vs M-3-02 寫的不同、回頭 review 不知道誰是對標
  - bug 可追蹤性:test 失敗時、不知道測了什麼、test description 風格不一致
- **估時:** M-1-02 啟動前 60-90 min
- **依賴:** M-1-02 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §7、STATUS Sean 待決策 #2(G2 測試覆蓋率)、`docs/audits/2026-05-02-full-audit.md` Audit-F22

### #46. ✅ bounded-contexts.md 待寫(0002 ADR §7 列待寫)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-03 / M-0-10a / ADR-0004 Q6=A3(minimum 版);docs/architecture/bounded-contexts.md 落地(9 contexts × 一句話定義 × Medusa 蓋面對照表);ubiquitous language 完整字典 / context 間 message contract 留 Phase 2 啟動前擴
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - `docs/architecture/`(無 bounded-contexts.md)、0002 ADR §7 列「待寫」
  - 9 contexts 邊界目前散在 schema-design §8.3(7 條簡述)+ ADR-0003 §3.1(命名規則)+ PHASE-2-VISION + 0002 §4.3、無集中文件
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T15)
- **預期解法:**
  - M-1-02 啟動前寫 bounded-contexts.md(9 contexts × ubiquitous language × Medusa 蓋面 × milestone)
- **不修會痛在:**
  - 擴充性:Phase 2 加 Booking / Wallet entity、邊界決策歷史散落、不知為何 Vehicle 走 PCM 自家 / Catalog 走 Medusa-as-API
  - 可維護性:domain 改命名(motoBrand → vehicleBrand)、要 grep 全 repo + 4 ADR + schema-design + 各 context types.ts、無單一 source
  - bug 可追蹤性:bug「下單後 Vehicle entity 沒 created」、不知 Vehicle 屬 Order 還 Identity、邊界不明
- **估時:** M-1-02 啟動前 90-120 min
- **依賴:** M-1-02 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §7、`docs/audits/2026-05-02-full-audit.md` Audit-F23

### #47. ⏳ Phase 2 三層折扣疊加 schema 預留(Order.discountsApplied)

- 🔴 **Sean 2026-08-15 已定:經銷價與商品特價都走 `orders.discount_total` —— 設計前先讀 `#513`**
  (那條記著依據,以及「事後補不了」的機制原因:金額四欄只在 `create_order` 寫一次,
  且 `orders_total_balances` CHECK 讓「只補折扣不動 total」不可能)。
- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 0002 ADR §4.3 寫「Pricing Phase 1 雙 tier、Phase 2 三層折扣疊加(廠牌 / VIP)」
  - ADR-0003 §4 #6 只規劃 priceByTier、無 Discount entity / DiscountRule struct
  - Phase 2 啟用時 Order.total 計算邏輯改大、若 Order.total 已上線、歷史 Order 無 discount breakdown 無法回溯
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T16)
- **預期解法:**
  - M-3-02 Order entity 加 `discountsApplied: DiscountSnapshot[]`(空 array、Phase 1 不啟用業務邏輯、只留欄位)
- **不修會痛在:**
  - 擴充性:Phase 2 折扣疊加上線時、回頭加欄位、歷史 Order 無此欄位
  - 可維護性:結帳邏輯重寫、cart 計算 / Order entity / TapPay charge amount 三處改
  - bug 可追蹤性:Phase 2 客人「我有 VIP 折扣但沒應用」、Order 無 discount breakdown 找不到
- **估時:** M-3-02 同 slice 加 15 min(欄位預留 + DiscountSnapshot type stub)
- **依賴:** M-3-02
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §4.3、`docs/decisions/0003-domain-entity-naming.md` §4 第 6 條、`docs/audits/2026-05-02-full-audit.md` Audit-F24

### #48. ⏳ adapters 子目錄結構規劃(ports-and-adapters.md 待寫)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - `packages/adapters/src/`(空殼、無子目錄)、0002 ADR §4.1 列 medusa / supabase / sheets-api / tappay 四 adapter 範圍但無子目錄規劃
  - M-1-03 第一個 adapter 落地時臨機決定子目錄結構、可能跑出不一致
  - **補(2026-05-07 / M-1-03 main-b sub-slice 5 simplify Q-3 Minor):** `packages/adapters/src/index.ts:1` 註解字面「殼、M-1-03 起落地」stale(SupabaseProductAdapter sub-slice 1-4 已落地、`package.json:5` description 已更新「(M-1-03 main-b SupabaseProductAdapter 落地)」、index.ts:1 未同步)、子目錄結構拍時順手對齊 L1 字面
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T17)
- **預期解法:**
  - M-1-03 啟動前寫 `docs/architecture/ports-and-adapters.md`(對齊 0002 §7 待寫)、含 adapters 子目錄結構模板 + 命名規則 + mapper 位置
- **不修會痛在:**
  - 擴充性:Phase 2 加 claude-api / image-processor / vendor-crawler、各自取名 random
  - 可維護性:M-1-03 / M-3-04 / M-3-08 / M-5-02 四 adapter 結構不一致
  - bug 可追蹤性:bug「Medusa adapter mapping 錯」、要找 mapper 在哪
- **估時:** M-0 收尾 / M-1-03 啟動前 60 min
- **依賴:** M-1-03 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §4.1 / §7、`docs/audits/2026-05-02-full-audit.md` Audit-F25

### #49. ⏳ MotoBrand 升級 value-object trigger(JSDoc 已提無對應 slice)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟡 低
- **問題:**
  - `packages/domain/src/catalog/types.ts:55-56` JSDoc 提及「M-1 升級 MotoBrand value-object」、但 milestone 字面無對應 slice
  - 篩選器需結構化(motoBrand 對應 logo / 中英對照)時、升級時機未定
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T18)
- **預期解法:**
  - M-1-09 ~ M-1-11 篩選器搬時若 design 真權威需要結構化、再升級為 MotoBrand value-object
- **不修會痛在:**
  - 擴充性:Phase 2 車輛履歷需 motoBrand 結構化(年份 / 排氣量分類)
  - 可維護性:JSDoc 寫了但無對應 slice、容易漏
  - bug 可追蹤性:無
- **估時:** M-1-09 ~ M-1-11 同 slice 加 15-30 min(看 design 真權威需求)
- **依賴:** M-1-09 ~ M-1-11(篩選器搬)
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/catalog/types.ts:55-56`、`docs/phase-1-backlog.md` #17(命名衝突)、`docs/audits/2026-05-02-full-audit.md` Audit-F37

### #50. ⏳ SyncResult.errors 結構化(rowIndex / sourceRow 對應)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `packages/domain/src/sync/types.ts:39` errors 是 string[]、無 row 對應
  - sync-engine batch sync 某 row 失敗、admin 看不到「哪一 row」「什麼欄位」「原始值」
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T19)
- **預期解法:**
  - M-5-03 落地前改 `errors: { rowIndex: number; reason: string; sourceRow?: SheetRow }[]`
- **不修會痛在:**
  - 擴充性:Phase 2 vendor crawler 加進來、errors 結構不變、各 source 統一格式好
  - 可維護性:sync-engine sub-use-case 各自寫 error string、format 不一致
  - bug 可追蹤性:某 row 失敗找原因要還原 SheetRow
- **估時:** M-5-03 同 slice 加 15 min
- **依賴:** M-5-03
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/sync/types.ts:39`、`docs/phase-1-backlog.md` #14(SheetRangeSpec 抽象化、不同議題)、`docs/audits/2026-05-02-full-audit.md` Audit-F38

### #51. ⏳ list 三方法分頁 TODO 一致性(IProductRepository JSDoc)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `packages/ports/src/IProductRepository.ts:16-18` listByCategory / listByBrand / listByFitment 三方法 JSDoc 無分頁 TODO 標記
  - searchByKeyword 已標 TODO M-1-03 補分頁、但其他三方法 10w 商品列表頁同樣面臨 scale
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T20)
- **預期解法:**
  - M-0 收尾前 / M-1-03 落地前在三方法 JSDoc 加 TODO M-1-03 補分頁
- **不修會痛在:**
  - 擴充性:#20 PaginationParams 預定義決議時、若漏 list 三方法、回頭補
  - 可維護性:M-1-03 落地時靠 grep TODO 列、漏一條方法
  - bug 可追蹤性:無
- **估時:** 5-10 min(JSDoc 加註)
- **依賴:** M-0 收尾 / M-1-03 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/ports/src/IProductRepository.ts:16-18`、`docs/phase-1-backlog.md` #20(PaginationParams 預定義)、`docs/audits/2026-05-02-full-audit.md` Audit-F39

### #52. ⏳ Order.total JSDoc drift(對齊 #34 後 sync 字面)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `packages/domain/src/order/types.ts:76` JSDoc 寫「items + 運費」但無 discount 提示
  - schema-design §8.4 也未提 discount、JSDoc vs schema-design drift
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T21)
- **預期解法:**
  - M-3-02 Order entity 落地時 sync JSDoc(對齊 #34 breakdown 後字面)
- **不修會痛在:**
  - 擴充性:Phase 2 折扣加進來、JSDoc 不更新、新 dev 看 JSDoc 不知道 total 含哪些
  - 可維護性:JSDoc 與 schema-design §8.4 不一致
  - bug 可追蹤性:無
- **估時:** M-3-02 同 slice 加 5 min(JSDoc 字面同步)
- **依賴:** M-3-02 + #34 落地
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/domain/src/order/types.ts:76`、`docs/phase-1-backlog.md` #34、`docs/audits/2026-05-02-full-audit.md` Audit-F40

### #53. ⏳ packages 空殼 README / file-level JSDoc(use-cases / adapters / schemas)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `packages/{use-cases,adapters,schemas}/`(均空殼、僅 package.json + index.ts)
  - 各 package 為什麼存在、何時填、怎麼填、無 README
  - 新 dev 看 packages/use-cases/ 空殼、不知道是 M-1-02 起填、還是 M-3-02 起填
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T22)
- **預期解法:**
  - M-0 收尾前各 package src/index.ts 加 file-level JSDoc、註明何時填、對應 ADR § 編號
- **不修會痛在:**
  - 擴充性:Phase 2 加新 dev、學 monorepo 結構靠 grep ADR
  - 可維護性:三 package 寫 file-level JSDoc + 對應 milestone 引用、新 dev 一看就懂
  - bug 可追蹤性:無
- **估時:** M-0 收尾 30 min(三 package src/index.ts 加 JSDoc)
- **依賴:** M-0 收尾
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `packages/use-cases/src/index.ts`、`packages/adapters/src/index.ts`、`packages/schemas/src/index.ts`、`docs/audits/2026-05-02-full-audit.md` Audit-F41

### #54. ⏳ admin/sync-engine ESLint dry-run 補(M-0-02 啟動時)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - `apps/`(只 storefront / medusa)、`docs/architecture/dependency-rules.md` §3 dry-run 只覆蓋 storefront / medusa
  - admin / sync-engine 對 packages/* import 邊界守門未驗
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T23)
- **預期解法:**
  - M-0-02 啟動時加 admin / sync-engine 對 packages/* 違規 dry-run(對齊現有 7 條 dry-run)
- **不修會痛在:**
  - 擴充性:M-4a / M-5 啟動時 boundaries 對 admin / sync-engine 未測、可能漏
  - 可維護性:現有 ADR 字面假設 4 apps、實體 2 apps、字面 vs 事實 drift
  - bug 可追蹤性:M-4a-01 落地時、若 boundaries 對 admin 失靈、debug 多繞路
- **估時:** M-0-02 同 slice 加 15-20 min(2 apps × dry-run + dependency-rules.md §3 表格更新)
- **依賴:** M-0-02
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/dependency-rules.md` §3、`docs/audits/2026-05-02-full-audit.md` Audit-F26
- **Supersede 註(2026-05-02 / commit 686afc8 audit follow-up):** trigger 從本條原寫的「M-0-02 啟動時補 dry-run」**修正延後至**「M-1-01 / M-4a-01 / M-5-01 三點分別補(apps 真寫 .ts 時 boundaries 才有檔可掃、現補無實質效果)」。
- **Supersede 解開註(2026-05-08 / M-1-03-main-d-pre):** storefront 部分解開。apps/storefront/tsconfig.json 補齊(對齊 packages/* 模板)+ 進 `import/resolver.typescript.project` glob、boundaries Rule 5 對 storefront 真實生效;dependency-rules.md §5.1 同步更新。**apps/admin / apps/sync-engine 仍 ⏳ 待 M-4a-01 / M-5-01 補(同模板:tsconfig + glob);本條目維持 ⏳ 至兩 apps 全部解開**。

### #55. ⏳ contract test 框架(Phase 2 觸發)

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟢 觀察
- **問題:**
  - 5 ports 介面、現規劃 InMemory(test)+ Medusa(real)兩實作對
  - 但兩實作的「行為」要對齊(InMemory 跑通 Medusa 也要跑通)、無 contract test 框架
  - M-1-03 Medusa adapter 落地時、對齊 InMemory 靠 review 防呆、邊界 case 漏
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T24)
- **預期解法:**
  - Phase 2 觸發時補(等 9 contexts 都有 adapter 再投入框架成本)
- **不修會痛在:**
  - 擴充性:Phase 2 加新 adapter(SupabaseProductAdapter)、行為對齊靠 review、不靠 test
  - 可維護性:M-1-03 的 Medusa adapter 與 M-1-02 InMemory 兩處改 invariant、不同步
  - bug 可追蹤性:bug「InMemory test 過、Medusa adapter 上 production 出 schema 違規」、無 contract test 早抓
- **估時:** Phase 2 評估 / 若做 4-6 hr(框架 + 第一個 contract test 樣本)
- **依賴:** Phase 2 啟動 / M-6-08 上線後觀察 review 防呆是否足
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/audits/2026-05-02-full-audit.md` Audit-F43

### #56. ⏳ disaster recovery plan(backup / restore SOP)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - `docs/architecture/`(無 disaster-recovery.md)
  - Supabase 自帶 backup、但 retention(免費版 7 天 / Pro 30 天)、restore 流程、災難演練 都無規範
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / engineering:tech-debt(T25)
- **預期解法:**
  - M-6-08 上線前寫 `docs/runbooks/disaster-recovery.md`(restore 流程 + 模擬演練 1 次)/ Phase 2 後再做(觀察 Phase 1 是否有事)
- **不修會痛在:**
  - 擴充性:Phase 2 加自家 PG 表(Vehicle / Booking / Wallet)、backup 範圍擴
  - 可維護性:無
  - bug 可追蹤性:資料庫崩、員工慌、走 Supabase support
- **估時:** M-6-08 90 min(runbook 寫 + 1 次 restore 演練)
- **依賴:** M-6-08 / Phase 2
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/audits/2026-05-02-full-audit.md` Audit-F44

### #57. ✅ Supabase free tier 容量升級拍板(Critical / 10w 商品)

- **狀態:** ✅ 完成(拍板)
- **完成於:** 2026-05-03 / M-0-10c / ADR-0004 Q1=A2 拍板「上架完畢 / 上線前升 $25/月」;trigger 推遲到 M-6-08 上線前 checklist(實際升級動作)、不再開新條目;security-timeline.md §3 加 #F6 對應、PHASE-1-MILESTONES.md M-6-08 任務名補 + §11 拍板項目登記
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🔴 Critical
- **問題:**
  - Supabase 免費版 500MB DB / 5GB bandwidth / socket 連線限制
  - 10w 商品 + 50w image refs + Phase 2 訂單 + 客人 row 上看 1M+
  - Phase 1 階段 1 上線 200 SKU 看不出問題、上線後 SKU 上千接近 quota 靜默崩
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R1)
- **預期解法:**
  - M-1-16(200 SKU 種子)落地前 Sean 拍板升 Supabase Pro($25/mo)
  - M-6-08 上線前 checklist 加 quota 驗證
- **不修會痛在:**
  - 擴充性:Phase 2 加 Vehicle / Booking / Wallet 表、row 數爆、不升級無法擴
  - 可維護性:免費版突 quota、Sean 不會立即知道直到 user 抱怨
  - bug 可追蹤性:quota 紅燈在 Supabase Dashboard、admin / Sean 沒看、靜默 fail
- **估時:** Sean 拍板 + 升級 30 min / M-6-08 quota 驗證 15 min
- **依賴:** M-1-16 啟動前 Sean 拍板
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/2026-04-30-handoff-to-claude-ai.md` §10(setup)、`docs/audits/2026-05-02-full-audit.md` Audit-F1

### #58. ⏳ sync-engine 本機 redundancy(SMS 通知 + Phase 2 雲端 cron)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - PHASE-1-MILESTONES §8.7 風險 1 已知「本機機器壞了會停」、F1 兩層保險(被動紅燈 + daily email)只是告警、不是 continuity
  - 電腦壞 / 停電 / Sean 出差中斷數天、商品候選不更新 / 報價不告警 / 庫存不自動更新
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R2)
- **預期解法:**
  - M-5-09 daily summary email 加「2 hr 無 ping → SMS 通知 Sean」+ Phase 2 移雲端(GCP Cloud Run cron)
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter(LINE / 物流 / 廠商爬蟲)進來、本機機器更不能停
  - 可維護性:Sean 出差時無人 sync、員工只能等
  - bug 可追蹤性:電腦失聯時、admin 看到紅燈但不知為何、要 Sean 回家確認
- **估時:** M-5-09 同 slice 加 60-90 min(SMS 接入 + 2hr no-ping 邏輯)/ Phase 2 雲端遷移 1-2 週
- **依賴:** M-5-09 / Phase 2
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` §8.7、`docs/audits/2026-05-02-full-audit.md` Audit-F9

### #59. ⏳ TapPay sandbox→production env vars 切換驗證機制

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - NORTHSTAR §1.2「上線時切 production 是 Phase 1 收尾事件」
  - Vercel + Railway 兩處 env vars 改、漏一處 production 走 sandbox = 付款不收錢 + 客人收貨
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R3)
- **預期解法:**
  - M-6-08 上線前 checklist 加「TapPay env var = production key 自動驗證」(curl TapPay verify endpoint、回 production confirm)
- **不修會痛在:**
  - 擴充性:Phase 2 加 LINE Pay / Apple Pay 同類風險、無自動化驗證機制
  - 可維護性:無 production cutover 自動化驗證
  - bug 可追蹤性:charge 0 元異常時、查 logs 才知道走 sandbox、上線當天才發現
- **估時:** M-6-08 同 slice 加 30 min(curl script + checklist 字面)
- **依賴:** M-6-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-NORTHSTAR.md` §1.2、`docs/architecture/security-timeline.md` §3 #F5、`docs/audits/2026-05-02-full-audit.md` Audit-F10

### #60. ⏳ Railway free tier 容量升級拍板(cold start)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - Railway 免費版 $5/mo credit、Medusa 啟動 RAM ~512MB、idle 限制、container 自動 sleep
  - 客人凌晨下單、Medusa cold start 30s、TapPay redirect 超時、結帳失敗
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R4)
- **預期解法:**
  - M-3-01 啟動前升 Railway Pro($20/mo、no sleep)
- **不修會痛在:**
  - 擴充性:Phase 2 後台流量上升、free tier 完全不夠
  - 可維護性:cold start 是 silent fail、客人不投訴看不出問題範圍
  - bug 可追蹤性:「凌晨下單失敗」無 log、reproduce 困難
- **估時:** Sean 拍板 + 升級 15 min
- **依賴:** M-3-01 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-3-01、`docs/audits/2026-05-02-full-audit.md` Audit-F11

### #61. ⏳ TapPay production 申請時序(M-3 啟動時同步申請)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - TapPay 申請 production 流程 1-2 週(商業登記 / 銀行帳戶 / 商家代號)
  - 上線當下若 production 沒批 = 上線只能 sandbox(實際不收錢)、客人下單免費送商品
  - STATUS Sean 待決策 #3 涵蓋 sandbox 沿用、但 production 啟用時序不在
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R5)
- **預期解法:**
  - M-3 啟動時 Sean 同步申請 production TapPay(申請 ≠ 啟用、可平行 backend dev)
- **不修會痛在:**
  - 擴充性:Phase 2 加新支付 channel 同類問題
  - 可維護性:無 production 拿到時程、其他 milestone 收尾不明
  - bug 可追蹤性:無
- **估時:** Sean 申請 production 時間 1-2 週(背景進行、不阻 dev)
- **依賴:** M-3 啟動前 Sean 動作
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** STATUS Sean 待決策 #3、`docs/PHASE-1-MILESTONES.md` §11、`docs/audits/2026-05-02-full-audit.md` Audit-F12

### #62. ⏳ 客服退款 SOP(customer-refund-sop.md runbook)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - M-3-08 TapPay refund 介面落地、但「客服收到客訴 → 判斷 → 退款 → 通知客人」整套 SOP 缺
  - 員工不知:多久內回應 / 哪些情況可全退 / 哪些部分退 / 誰拍板 / 退款後客人通知 channel
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R6)
- **預期解法:**
  - M-4a-12 客服 inbox 落地時同步寫 `docs/runbooks/customer-refund-sop.md`
- **不修會痛在:**
  - 擴充性:Phase 2 多 channel 客訴(LINE / Email / 電話)、SOP 沒先定、各 channel 處理不同
  - 可維護性:員工換人 / 訓練成本高
  - bug 可追蹤性:客訴歷史散在 channel、無系統紀錄
- **估時:** M-4a-12 同 slice 加 60-90 min(SOP doc + admin inbox 模板)
- **依賴:** M-4a-12
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-4a-12、`docs/phase-1-backlog.md` #31(客服 schema、不同議題)、`docs/audits/2026-05-02-full-audit.md` Audit-F13

### #63. ⏳ dispute / chargeback SOP(dispute-response-sop.md runbook)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - production 上線後客人銀行 dispute 發生、PCM 員工 24-48h 內必回應(銀行限時)
  - 無 SOP = 員工不知怎回 = 預設輸 = TapPay 強制扣回 + 商品已出 = PCM 雙輸
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R7)
- **預期解法:**
  - M-6-08 上線前寫 `docs/runbooks/dispute-response-sop.md`(48h response template + 證據清單)
- **不修會痛在:**
  - 擴充性:Phase 2 訂單量上升、dispute 頻率必升、無 SOP 各個臨機
  - 可維護性:員工不知收哪些證據(出貨單 / 簽收單 / 客人通訊紀錄)
  - bug 可追蹤性:dispute 失敗後、無 retrospective 找改善點
- **估時:** M-6-08 同 slice 加 90 min
- **依賴:** M-6-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-6-08、`docs/phase-1-backlog.md` #41(ChargeStatus disputed enum、schema)、`docs/audits/2026-05-02-full-audit.md` Audit-F14

### #64. ⏳ 發票自動化未拍 — 不拍會痛在哪(STATUS #1 補三視角)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🔴 高
- **問題:**
  - STATUS Sean 待決策 #1 / PHASE-1-MILESTONES §11 拍板項目 A3
  - Phase 1 階段 1 不做 = 員工每天額外 1-2 hr 開發票、累積成本爆
  - B2B 月結客戶要求合併發票、手動易錯
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R8、補 STATUS #1 三視角)
- **預期解法:**
  - 候選 A:M-3 啟動前 Sean 拍板選綠界(產業標)、自動串接、估 1 週 dev【推薦】
  - 候選 B:Phase 1 階段 1 純手動、Phase 2 補(累積成本高)
  - 候選 C:外包(成本中)
- **不修會痛在:**
  - 擴充性:Phase 2 訂單量上升、手動成本指數上升
  - 可維護性:漏開 / 開錯統編 / 跳號成本高
  - bug 可追蹤性:發票號碼跳號 / 漏號、國稅局查時無法解
- **估時:** Sean 拍板 + 若選 A:綠界接入 1 週 dev / 若選 B / C:Phase 1 不做
- **依賴:** M-3 啟動前 Sean 拍板
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** STATUS Sean 待決策 #1、`docs/PHASE-1-MILESTONES.md` §11、`docs/audits/2026-05-02-full-audit.md` Audit-F15

### #65. ⏳ Vercel / Railway / Supabase 部署 region 規劃

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - Vercel global edge / Railway 預設可能 US / Supabase SG
  - Phase 1 客人主要台灣 + 歐洲、跨 region latency 累積
  - 部分 overlap STATUS #4(部署是否新建)、本條 focus region
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R9)
- **預期解法:**
  - M-6-06 / M-6-07 啟動前 Sean 拍板部署 region(Railway 改 SG;Vercel 維持 global edge)
- **不修會痛在:**
  - 擴充性:Phase 2 客人量大、p99 latency 上升 200-500ms 客人感受
  - 可維護性:Railway region 改後 IP / DNS 連帶變
  - bug 可追蹤性:跨 region 慢時、log 在 region A 查 region B 找不到
- **估時:** Sean 拍板 + 改 region 30-60 min
- **依賴:** M-6-06 / M-6-07 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** STATUS Sean 待決策 #4(部分 overlap)、`docs/audits/2026-05-02-full-audit.md` Audit-F27

### #66. ✅ Medusa-as-API spike verification checklist(0002 §6.1 強訊號 #1)

- **狀態:** ✅ 完成(廢)
- **完成於:** 2026-05-04 / M-1-03-prep / Sean 拍板 Q1=A1 / Q2=A2 / Q3=A1 / Q4=A2;`docs/architecture/medusa-spike-verification-checklist.md` 落地(§1 範圍 = Catalog 4 條核心 Product / Brand / Category / Tier Price + 排除項;§2 過判斷 = 真實 round-trip 5 步 + 通過條件 + 不在 spike 驗項;§3 decision tree 自判「設計錯」vs「裝錯」+ 模糊地帶處置;§4 rollback 路徑重述 ADR-0002 §6.3 自包含 + 文件處置 + Sean 通知時機;§5 變更紀錄)
- **廢於:** 2026-05-04 / M-1-03-pre0b / ADR-0005「Custom + Supabase 直寫架構」採用、Medusa-as-API spike 不再進行;spike checklist 字面保留為歷史紀錄(decision tree 設計錯 vs 裝錯邏輯仍可參考、適用於未來其他 framework spike)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - 0002 ADR §6.1 強訊號 #1 列「M-1 spike 出現 Medusa schema 完全無法對應 PCM 業務」為 rollback 訊號
  - 但 M-0 階段 schema-design 純 docs、未 spike 驗證
  - M-1-02 / M-1-03 落地時若發現 mapping 套不上、整 0002 翻盤、Phase 1 延宕 4-6 週
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R10)
- **預期解法:**
  - M-1-02 / M-1-03 落地前 Sean 確認 spike 驗證標準(metadata 套上 = 過 / 套不上 = 觸發 §6.3 rollback)、寫 verification checklist
- **不修會痛在:**
  - 擴充性:Phase 2 啟動時若 0002 假設仍未驗、Vehicle / Booking 補上時才發現
  - 可維護性:rollback 路徑 0002 §6.3 已寫、但回退成本 ~1 週是樂觀估
  - bug 可追蹤性:spike 失敗時、辨識「設計錯」vs「實作錯」需文件
- **估時:** M-1-02 / M-1-03 啟動前 30-45 min(verification checklist + 拍板字面)
- **依賴:** M-1-02 / M-1-03 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §6.1 / §6.3、`docs/audits/2026-05-02-full-audit.md` Audit-F28
- **Supersede 註(2026-05-04 / M-1-02-prep):**
  - **trigger 變更:** 從「M-1-02 / M-1-03 啟動前」**精修為**「M-1-03 啟動前」(M-1-02 是 in-memory ProductRepository、不接 Medusa schema、spike 驗證真實壓力在 M-1-03 MedusaProductAdapter 落地)

### #67. ⏳ submodule design-reference 失靈 fallback 流程

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - design-reference submodule 來自 pcmmotorsports/pcm-website-design repo、若被誤刪 / 改 access / 倉庫 force push、submodule pointer 找不到、storefront 無法 build
  - NORTHSTAR §2.2 / CLAUDE.md submodule 操作無 fallback 流程
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R11)
- **預期解法:**
  - 候選 A:NORTHSTAR §2.2 加「submodule 失靈 fallback」流程(Phase 1 起每月 mirror 到 PCM repo `design-reference-snapshot/` 只讀 backup)【推薦】
  - 候選 B:不做、容忍
- **不修會痛在:**
  - 擴充性:Phase 2 design 持續進化、submodule 是長期依賴
  - 可維護性:無 submodule fallback 流程、新 Claude Code 不知道走哪
  - bug 可追蹤性:submodule 失靈時、新 Claude Code 不知道是 PCM 端錯還 design 端錯
- **估時:** NORTHSTAR 修訂 30 min + 建 design-reference-snapshot 流程 30 min
- **依賴:** M-1 啟動前 / M-6-08 上線前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-NORTHSTAR.md` §2.2、`docs/audits/2026-05-02-full-audit.md` Audit-F29

### #68. ⏳ oncall / incident response runbook(P0/P1/P2 escalation)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 上線後 production 出事、誰接電話?哪個時段?升級 Sean 的 trigger?無流程
  - Phase 1 階段 1 員工少 2-3 人、Sean 出差時 production 中斷 4 hr 沒人察覺
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R12)
- **預期解法:**
  - M-6-08 上線前寫 `docs/runbooks/incident-response.md`(P0/P1/P2 嚴重程度 + escalation 階梯 + on-call schedule)
- **不修會痛在:**
  - 擴充性:Phase 2 員工增加、SLA 流程沒先定、tier-up 時混亂
  - 可維護性:incident 處理散在 LINE 對話、無 retrospective
  - bug 可追蹤性:incident 後找 root cause、無 timeline trace
- **估時:** M-6-08 同 slice 加 60-90 min
- **依賴:** M-6-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-6-08、`docs/phase-1-backlog.md` #36(monitoring、不同議題)、`docs/audits/2026-05-02-full-audit.md` Audit-F30

### #69. ⏳ 個資法資料權利流程(取出 / 刪除、30 天回應)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 台灣個資法第 11 條客人有權「請求刪除個資」「請求複本」、PCM 收到後 30 天內回
  - 無流程 = 收到刪除請求時員工不知道:刪 Customer entity?Order 留嗎?支付紀錄 PII?
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R13)
- **預期解法:**
  - M-4a-10(admin/customers)階段寫 `docs/runbooks/data-rights-sop.md`(刪除請求處理 + 保留範圍 + 法律保存規則)
- **不修會痛在:**
  - 擴充性:Phase 2 個資量爆增、刪除流程沒自動化、員工每件 30+ 分鐘
  - 可維護性:刪除 Customer 時 Order 是否需保留(法律保存 5 年要求)、無規範
  - bug 可追蹤性:法律稽核時、無流程紀錄無法證明合規
- **估時:** M-4a-10 / M-6-08 同 slice 加 60-90 min(SOP + 與 Customer entity 對應)
- **依賴:** M-4a-10 / M-6-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/architecture/security-timeline.md` §3 #C7 / #C8、`docs/audits/2026-05-02-full-audit.md` Audit-F31

### #70. ⏳ B2B 月結對帳 SOP(月底跑列表 + 加總)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - store / premiumStore tier 月結客戶、月底結帳、admin 怎麼產對帳單?無 SOP
  - 對應 backlog #27(markPartiallyPaid 多次累積)是 schema 端、本條是流程端
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R14)
- **預期解法:**
  - M-4a-08 admin 訂單列表落地時同步寫 SOP(月底跑 listByCustomer + listByDateRange + sum 月結金額)
- **不修會痛在:**
  - 擴充性:Phase 2 多店家 tier、月結 SOP 沒先定、各 tier 處理散
  - 可維護性:月結對帳每月跑一次、若 SOP 漏定則每月返工
  - bug 可追蹤性:客戶質疑對帳金額、無 query log 還原
- **估時:** M-4a-08 同 slice 加 30-45 min(SOP + admin 訂單列表月結 query 樣本)
- **依賴:** M-4a-08
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-4a-08、`docs/phase-1-backlog.md` #27(schema 端)、`docs/audits/2026-05-02-full-audit.md` Audit-F32

### #71. ⏳ TapPay 商家合約檢核(月交易上限 / 高風險商品禁令)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - TapPay 商家合約有月交易額度上限 / 特定商品(機車改裝零件部分品類可能算高風險)、合約細節 PCM 端應該驗
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R15)
- **預期解法:**
  - M-3-08 啟動前 Sean 跟 TapPay 確認商品類別 OK 簽約
- **不修會痛在:**
  - 擴充性:Phase 2 加新商品類別(可能含禁令)、要重核合約
  - 可維護性:無 compliance checklist、員工新增商品不知是否合規
  - bug 可追蹤性:被凍結帳戶時、不知是哪個商品觸發
- **估時:** Sean 跟 TapPay 對接 1-2 hr
- **依賴:** M-3-08 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-3-08、`docs/audits/2026-05-02-full-audit.md` Audit-F33

### #72. ⏳ 篩選器資料 source-of-truth(design mock vs Medusa)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中
- **問題:**
  - design 端有 mock data(brands.js / vehicles.js)、Medusa 端商品建好後實際 brand / motoBrand 來自商品 metadata
  - Phase 1 早期 storefront 篩選器可能還是直讀 design mock、後期改 fetch Medusa list
  - Phase 過渡時、篩選器選項與商品實際 metadata 不一致(篩選顯示「Brembo」但 Medusa 沒商品)
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R17)
- **預期解法:**
  - M-1-12(ProductsPage 整合 4 篩選)落地前明確規範「篩選選項從 IProductRepository.listBrands() 拿、不從 design mock」
- **不修會痛在:**
  - 擴充性:Phase 2 加新 brand、篩選器自動同步嗎?
  - 可維護性:design mock 改一處、Medusa 改一處、不同步
  - bug 可追蹤性:客人投訴「篩選沒結果」、查不出是 mock 漏還是 Medusa 漏
- **估時:** M-1-12 同 slice 加 30 min(規範字面 + listBrands port 補)
- **依賴:** M-1-12
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/PHASE-1-MILESTONES.md` M-1-12、`docs/audits/2026-05-02-full-audit.md` Audit-F34

### #73. ⏳ sync-engine 寫 Medusa metadata race condition 預防(0002 §6.1 #4)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - sync-engine 跑 hourly cron、若同 hour 內 admin 員工也手動改商品(M-4a-06)、兩個 source 同時寫、後寫者覆蓋前者
  - 0002 ADR §6.1 強訊號 #4 已列為 rollback 訊號、但無預防策略
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R18)
- **預期解法:**
  - M-5-03 落地時加「last-write-wins + audit log」流程、sync-engine 寫前查 timestamp、admin 改後 1 hr 內 sync 跳過該 SKU
- **不修會痛在:**
  - 擴充性:Phase 2 加 vendor crawler、source 變 3 個、race 風險指數上升
  - 可維護性:無 audit log policy、覆蓋還原靠 Medusa Admin 歷史(若有)
  - bug 可追蹤性:metadata 突然變、不知是 sync 還是員工改
- **估時:** M-5-03 同 slice 加 45-60 min(timestamp check + audit log + 1hr 跳過邏輯)
- **依賴:** M-5-03
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** `docs/decisions/0002-architecture-pivot.md` §6.1、`docs/audits/2026-05-02-full-audit.md` Audit-F35

### #74. ⏳ admin / sync-engine 部署 plan(Vercel / Railway / 本機規劃)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - apps/admin 部署在哪?Vercel 同 storefront 還是 Railway?apps/sync-engine 部署本機已知、是否雲端 cron 備援?
  - setup §10.x 只規劃 storefront / medusa、無 admin / sync-engine 部署 plan
- **觸發事件:**
  - 2026-05-02 / 全專案 audit / operations:risk-assessment(R19)
- **預期解法:**
  - M-4a-01 啟動前 Sean 拍板部署 plan(admin 走 Vercel、sync-engine 維持本機)、寫進 setup §10
- **不修會痛在:**
  - 擴充性:Phase 2 admin 流量上升、若 free tier 不夠回頭遷
  - 可維護性:多 app 部署在不同 platform、env vars / secrets 分散
  - bug 可追蹤性:cross-app log 散在 Vercel / Railway / local、debug 多走幾處
- **估時:** Sean 拍板 + setup §10 補 30 min
- **依賴:** M-4a-01 / M-5-01 啟動前
- **發現於:** 2026-05-02 / 全專案 audit
- **相關:** STATUS Sean 待決策 #4(部分 overlap)、`docs/audits/2026-05-02-full-audit.md` Audit-F36

### #75. ✅ 4 空殼 packages JSDoc 格式對稱化

- **狀態:** ✅ 完成 2026-06-16(packages/ui/src/index.ts header 加「對應 ADR-0002 §4.1」對齊 use-cases/adapters/schemas;同批 doc-drift)
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - M-0-02 落地的 `packages/{use-cases,adapters,schemas}/src/index.ts` JSDoc 用「對應 ADR-XXX §X」結構化格式
  - `packages/ui/src/index.ts` 仍是「殼、M-1-04 起裝 tokens」單行 placeholder、無 ADR 引用
  - 4 個空殼 packages JSDoc 格式不對稱、新 dev 讀 packages 不知哪個是標準
- **觸發事件:**
  - 2026-05-02 / M-0-02 audit follow-up / 第一輪 engineering:code-review CR-5
- **預期解法:**
  - M-1-04(ui 裝 tokens slice)啟動時順手把 ui src/index.ts JSDoc 升級成「對應 ADR § X」結構化格式、對齊其他 3 個 packages
- **不修會痛在:**
  - 擴充性:Phase 2 加新 dev、學 monorepo 結構靠各 src/index.ts JSDoc、4 個格式不一不知哪個對標
  - 可維護性:M-1-04 ui 真開工時順手對齊零成本、現在強改無 tokens 上下文
  - bug 可追蹤性:本條目 + M-1-04 trigger 為錨點
- **估時:** M-1-04 同 slice 加 5 min
- **依賴:** M-1-04(ui 裝 tokens)
- **發現於:** 2026-05-02 / M-0-02 audit follow-up
- **相關:** `packages/ui/src/index.ts`、Audit findings CR-5

### #76. ✅ M-0-09 完工 trigger 補:4 套編號規範 + JSDoc trigger 抽象化規範

- **狀態:** ✅ 完成
- **完成於:** 2026-05-02 / M-0-09b(integrate 進 working-style.md §6.3 第 11-13 條 + 4 套編號 + JSDoc trigger 兩節擴三節)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - **CR-7 編號系統紀律:** 4 套編號系統(backlog #N / Audit-F\<N\> / Tech-debt T\<N\> / Risk R\<N\>)未明確區分、commit body / JSDoc / .md 引用 audit 時編號交叉錯(M-0-02 commit body 寫「audit #65 / T22」、實際 #65 是部署 region 無關;JSDoc 寫「audit #60 / T17」、實際 #60 是 Railway 容量無關)
  - **S-C JSDoc trigger 抽象化規範:** JSDoc trigger 字面用具體 milestone ID(M-1-02 / M-1-03 / M-1-14)、現在已 drift(CR-2 / CR-3 抓出)+ 未來 milestone 重編號 / 拆分時會持續 drift
- **觸發事件:**
  - 2026-05-02 / M-0-02 audit follow-up / 第一輪 CR-7 + 第二輪 S-C
- **預期解法:**
  - M-0-09 完工 trigger 補時、跟既有 #12 / #15 一起進 `working-style.md`、加兩節:
  - **節 1:4 套編號引用紀律** — commit body / JSDoc / .md 引用 audit 時必明確標 source(例:「Audit-F25」/「Tech-debt T17」/「Backlog #48」)、禁混用「audit #N」+「#N」短語(因 #N 易誤指 backlog)
  - **節 2:JSDoc trigger 寫法紀律** — trigger 用抽象描述(「M-1 期間第一個 X 落地時」)、避免具體 milestone ID(易 drift);若必寫 ID、加「(目前對應 M-X)」括號註、milestone ID 重編號 / 拆分工序時必同步 grep JSDoc trigger 字面
  - **節 3:寫指令前 grep 真權威紀律(對應指令發送前自檢第 11-13 條)** — Claude.ai 寫指令前必先 grep ADR / dependency-rules / 既有 config 字面、不憑印象、不憑 audit finding 字面當聖旨。
    - **第 11 條:** 寫指令前先 grep ADR / config 字面、不憑 audit finding 當聖旨(M-0-02 教訓:audit #54 字面寫「補 admin/sync-engine dry-run」、Claude.ai 憑字面寫成「apps→adapters BLOCK」、跟 ADR-0002 §4.2 line 172「apps ← 可 import 任何 packages/*」直接矛盾、Code sanity-check 抓出停回報)
    - **第 12 條:** 寫「對齊既有 X pattern」前先確認 pattern 真存在、不憑印象(M-0-02 教訓:Claude.ai 假設 storefront / medusa 有 tsconfig / src / README pattern、實際是純殼僅 package.json + lint script、dependency-rules.md §5.3 已明文設計)
    - **第 13 條:** 寫章節編號 / 編號系統引用前先 grep 真實對應、不憑印象(M-0-02 教訓:三處編號錯、commit body「audit #65 / T22」+ JSDoc「audit #60 / T17」+ ADR-0002 §5 引用、4 套編號系統未明確區分)
- **不修會痛在:**
  - 擴充性:Phase 2 編號系統擴(可能加 Vehicle / Booking 議題編號)、不立紀律會繼續混
  - 可維護性:JSDoc trigger drift 不斷、每次 milestone 調整都要 grep 修
  - bug 可追蹤性:本條目 + M-0-09 trigger 為錨點
- **估時:** M-0-09 完工 trigger 補時加 30-45 min(寫兩節 + 範例)
- **依賴:** M-0-09 完成
- **發現於:** 2026-05-02 / M-0-02 audit follow-up
- **相關:** 既有 backlog #12 / #15(同 M-0-09 trigger 補時機)、Audit findings CR-7 + S-C

### #77. ⏳ 8 lint script 字面重複(觀察、未來 lint 工序升級評估)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(by-design、不阻塞)
- **問題:**
  - 8 個 package(4 apps + 4 packages)package.json lint script 字面重複定義 `eslint . --max-warnings 0 --no-error-on-unmatched-pattern`、本 commit 加 admin / sync-engine 重複 2 次
  - `dependency-rules.md` §5.3 / §6.1-6.2 設計就是 per-package 各定義(維運字面要求加新 app 必加 script)、是 by-design 不是疏失
  - 但加新 package 時容易忘加、是維運盲點
- **觸發事件:**
  - 2026-05-02 / M-0-02 audit follow-up / 第二輪 simplify S-A
- **預期解法:**
  - 未來 lint 工序升級時(例 ESLint v11 / 加 typescript-aware import resolver / Phase 2 多 adapter 加進來)、評估集中於 turbo.json 或 root package.json 的 lint script preset、降低 per-package 重複
- **不修會痛在:**
  - 擴充性:目前 8 個重複可控、Phase 2 加 contexts 後 12-15 個重複會更明顯
  - 可維護性:加新 package 忘加 lint script 是維運盲點、`dependency-rules.md` §6.1 已寫但靠人工守
  - bug 可追蹤性:本條目為錨點、未來工序升級評估時 grep
- **估時:** 評估 30 min / 若實作集中 1-2 hr
- **依賴:** 無、未來 lint 工序升級時 trigger
- **發現於:** 2026-05-02 / M-0-02 audit follow-up
- **相關:** `docs/architecture/dependency-rules.md` §5.3 / §6.1-6.2、Audit findings S-A

### #78. ⏳ 商品名硬規範 + concat helper(M-5-03 sync-engine 上架 pipeline)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - Sean 真實業務報價單格式「{零件廠牌} {變體} {零件名} {車廠} {車型} {年份範圍}」(對齊 wrs.it IA 報告 §5)
  - Phase 1 後台用 Medusa Admin 內建表單上架、員工手動填、不能硬規範格式
  - M-5-03 sync-engine 上架 pipeline 才有實作上下文(Sheet row 拉欄位 + concat 寫 product.title)
- **觸發事件:**
  - 2026-05-03 / ADR-0004 wrs Q4 拍板「進 backlog」
- **預期解法:**
  - M-5-03(sync-product-candidates use-case)落地時、寫商品名 concat helper:
    - 輸入:`{ manufacturer, variant, partName, motoBrand, modelCode, yearStart, yearEnd }`
    - 輸出:標準格式商品名 string(對齊 FitmentSpec yearStart/yearEnd 雙向 mapping、yearEnd null 出 "2025+")
  - sync-engine 從 Sheet row 拉欄位 + concat、Medusa product.title 寫入規範格式
  - Phase 1 階段 1 員工手動上架不強制(只 sync-engine pipeline 走)
- **不修會痛在:**
  - 擴充性:Phase 2 加 vendor crawler、商品名格式不一致 → SEO / search 受影響(對齊 ADR-0004 Q3 search 兩階段切 tsvector 後尤其重要)
  - 可維護性:員工手動上架時格式自由、後續 audit 找不一致靠 grep、規範靠人工守
  - bug 可追蹤性:客人「搜某 SKU 找不到」、可能商品名格式偏離規範、本條目 + M-5-03 trigger 為錨點
- **估時:** M-5-03 同 slice 加 30-45 min(concat helper + sync 流程整合)
- **依賴:** M-5-03(sync-product-candidates)
- **發現於:** 2026-05-03 / ADR-0004 wrs Q4 拍板
- **相關:** `docs/research/wrs-ia-decomposition.md` §5、`docs/decisions/0004-m1-pre-launch-decisions.md` wrs Q4

### #79. ⏳ wrs.it IA 競品研究觀察條目(Phase 1 完工後 Sean 評估)

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟢 觀察
- **問題:**
  - wrs.it IA 報告 6 拍板題、Sean 拍板處置:Q1=A1 修 schema(已落地 ADR-0004 + M-0-10b FitmentSpec)/ Q4=backlog #78 / Q5=撤銷不做
  - **Q3(4 軸 selector)** + **Q6(雙 breadcrumb)** Sean 拍 A2 / B2 維持 design 現狀、留 Phase 1 完工後實際操作再決定
  - 視覺真權威紀律:wrs.it 不是真權威、修動 storefront 應走 Claude Design 流程(對齊 NORTHSTAR §2 視覺真權威鐵則)
- **觸發事件:**
  - 2026-05-03 / ADR-0004 wrs Q3 / Q6 拍板
- **預期解法:**
  - Phase 1 完工後 / 上線實際 user 行為觀察後、Sean 跟 Claude Design 對話評估「HomePage hero 4 軸 selector」/「ProductDetailPage 雙 breadcrumb」是否需要
  - 若需要、走 Claude Design 改 design-reference → submodule update → storefront 對應 slice(對齊 NORTHSTAR §2.2 真權威更新流程)
  - 若不需要、條目標 ❌ 棄用、紀錄理由
- **不修會痛在:**
  - 擴充性:上線後若 user 篩選器使用率 / 轉換率指標顯示有需要、現在不修也 OK、之後 1-2 hr Claude Design 改 + 4-8 hr storefront 實作可承受
  - 可維護性:維持 design 真權威單一基準、不被外部研究啟發污染、wrs.it 不是真權威
  - bug 可追蹤性:本條目為 anchor、未來 Sean 想到時 grep「wrs」找此條目決議
- **估時:** 評估 30 min / 若改 Claude Design 1-2 hr + storefront 對應 4-8 hr
- **依賴:** Phase 1 完工 / 上線後 user 行為觀察
- **發現於:** 2026-05-03 / ADR-0004 wrs Q3 / Q6 拍板
- **相關:** `docs/research/wrs-ia-decomposition.md` §10 / §11、`docs/decisions/0004-m1-pre-launch-decisions.md` wrs Q3 / Q6、`docs/PHASE-1-NORTHSTAR.md` §2 視覺真權威紀律

### #80. ⏳ design-reference submodule Vercel deploy fetch warning

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中(M-1-05 啟動前必修、之前不阻)
- **問題:**
  - M-1-01 push 後 Vercel deploy log 出現 `Warning: Failed to fetch one or more git submodules`
  - 成因:design-reference submodule 是 SSH-only(`git@github.com:pcmmotorsports/pcm-website-design.git`)、Vercel build 環境無 SSH key、clone submodule fail
  - 現在不阻塞:apps/storefront 純殼、未 import design-reference 內容
  - M-1-05 起(Header.tsx 直接搬)storefront 會 import design-reference 內容、Vercel build 找不到 submodule 內容必爆
- **觸發事件:**
  - 2026-05-03 / M-1-01 push 後 Vercel deploy log warning(commit abf5089 對應 deploy)
- **預期解法:**
  - **候選 A(推薦):** GitHub deploy key 配對機制(GitHub design repo Settings → Deploy keys 加 Vercel public key、Vercel Settings → Git → Deploy Keys / Custom Git Configuration 配對)
    - 對齊 SSH only 紀律(不切 HTTPS / 不用 token、對齊 lessons-learned 04-23 token 事件後 SSH 鐵則)
  - **候選 B:** 把 design repo 改 public、Vercel HTTPS clone 不需 key
    - 違反 SSH only 紀律 + 商業設計圖不該 public
  - **候選 C:** 把 design-reference 內容 vendoring 進 main repo(不用 submodule)
    - 違反 NORTHSTAR §2.2「design-reference 是 submodule、視覺真權威」
  - 推薦 A、實作流程在 M-1-05 啟動前一個獨立 slice 處理(估 30-45 min:Vercel 文件研究 + GitHub deploy key 加 + Vercel 配對 + push 觸發 deploy 驗證)
- **不修會痛在:**
  - 擴充性:M-1-05 ~ M-1-15 共 11 個 slice 全部需要 design-reference、Vercel deploy 全爆
  - 可維護性:是 Vercel + GitHub 兩端設定問題、設一次永久、不是 code 改;不修每次 deploy 都看到 warning、心理麻痺、真錯訊號被噪音淹
  - bug 可追蹤性:M-1-05 撞坑時不知道是 submodule fetch 還是元件搬錯、繞路偵察 30+ min;本條目為錨點、撞坑時 grep 立刻定位
- **估時:** 30-45 min(Vercel deploy key 文件研究 + GitHub Settings 操作 + Vercel Dashboard 配對 + 驗證 deploy)
- **依賴:** 無前置、M-1-05 啟動前必修、可獨立做(建議在 M-1-04 與 M-1-05 之間插一個獨立 slice)
- **發現於:** 2026-05-03 / M-1-01 deploy log review
- **相關:** M-1-05、`docs/PHASE-1-NORTHSTAR.md` §2.2(submodule 機制)、`docs/lessons-learned.md`(SSH only 紀律 04-23 事件)、Vercel deploy abf5089

### #81. ⏳ Product variants schema 設計(規格變體 1-20 種選項 × 雙層 / 三層)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中(M-5-03 sync engine 啟動前真撞才 spike、Q1=A 2026-05-20 拍板推延)
- **問題:**
  - Sean 2026-05-04 業務訊號:同個商品多規格(顏色 × 材質 × 年式對應)、員工後台自行新增、1-20 種選項、雙層或三層巢狀
  - design ProductPage.jsx 字面只 hardcode `state: color / size / qty`、size options 依 product.category 字串(排氣 / 碳纖 / 避震 / 卡鉗)分支動態算、color options 主色 + 額外 2 色從 pool slice
  - design 字面遠遠不夠覆蓋 Sean 業務需求(1-20 種規格、巢狀)
  - M-1-13 ProductPage 直接搬時、必踩此 gap
- **觸發事件:**
  - 2026-05-04 / M-1-02 拍板 Q1=A2 推延 variants(本 slice 不補)
  - 2026-05-20 / M-1-13d 啟動前 audit:Q1=A 拍板推延、對齊鐵則 1 直接搬 design hardcoded 3 選項落地(M-1-13d ProductInfo 已搬 COLOR_MAP 8 色 + sizeOptions 4 category 分支);真撞時點推到 M-5-03 員工後台 admin / sync engine 上架階段、屆時 Sean 親口講 1-20 種規格業務細節 + spike 候選 A/B/C 拍板
- **預期解法:**
  - **候選 A:** Medusa v2 內建 product_option + product_variant(spike 驗證能否蓋雙層 / 三層)
  - **候選 B:** PCM 自家 schema、走 metadata.variants jsonb(完全自由、設計成本高、Medusa Admin UI 不支援)
  - **候選 C:** 混合(產品基本層 Medusa option / variant、複雜層 PCM 自家 metadata 補)
  - 啟動順序:M-1-13 hardcoded 落地後、M-5-03 sync engine 啟動前獨立 slice spike + 拍板候選、估時 60-90 min
  - 配合 Claude Design 補設計(design 字面不足、需擴 ProductPage UI 顯示 1-20 種規格)
- **不修會痛在:**
  - 擴充性:M-1-13d hardcoded 3 選項落地、員工後台真要上架 1-20 種規格商品時無法存;Phase 2 vendor crawler 抓變體資料、schema 不就位無法落地
  - 可維護性:design 字面 hardcode color + size、sync-engine 上架 pipeline(M-5-03)無法寫變體、員工手動 admin 上架走 ad-hoc
  - bug 可追蹤性:客人「我要紅色不鏽鋼長 200mm」、Order 看不到完整變體選擇、客服回溯困難
- **估時:** spike 60-90 min + 落地 90-120 min(獨立 slice)
- **依賴:** M-1-02 完成、M-1-13 hardcoded 落地後(M-1-13d ✅)、M-5-03 sync engine 啟動前獨立 slice 處理
- **發現於:** 2026-05-04 / M-1-02 拍板 Q1
- **相關:** `packages/domain/src/catalog/types.ts` Product variants 推延欄位、`design-reference/components/ProductPage.jsx`(state color / size / qty)、`apps/storefront/src/components/ProductInfo.tsx`(M-1-13d 落地、COLOR_MAP 8 色 + sizeOptions 4 分支 hardcode)、`docs/PHASE-1-MILESTONES.md` M-1-13 / M-5-03

### #82. ✅ design `inStock: boolean` ↔ domain `ProductAvailability` mapper(M-1-13 ProductPage 啟動前)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-20 / M-1-13e-pre-2(`packages/adapters/src/storefront-mappers/availability.ts` 新檔含雙向 helper `availabilityToBool(a: ProductAvailability): boolean` + `boolToAvailability(b: boolean): ProductAvailability`、純函式無 server-only;`packages/adapters/src/index.ts` 新增 export;`apps/storefront/src/lib/products.ts` L100 inline `availability === 'in-stock'` 改 `availabilityToBool(product.availability)` 呼叫;`availability.test.ts` 4 test pass 雙向覆蓋)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中(M-1-13 ProductPage 直接搬時必撞、之前不阻)
- **問題:**
  - design 真權威字面用 `inStock: boolean`(design-reference/components/{ProductCard,ProductPage,FilterTop,FilterSide,FilterDrawer,Pages,ProductsPage}.jsx + data/PRODUCTS-README.md)
  - M-1-02-audit L1 立即修把 domain 改 `ProductAvailability = 'in-stock' | 'out-of-stock'` string union type alias
  - **跨層 mapping 缺位:** M-1-13 ProductPage 直接搬 design 時、storefront component 必須 map domain enum ↔ design boolean、否則 component 散寫 ternary (`product.availability === 'in-stock' ? ... : ...`)
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit reuse agent R1 抓出
  - 2026-05-20 / M-1-13e-pre-2 Sean Q2=A 拍板執行(對齊 Q4=A 拆 3 段、純架構抽工具、無 UI 動;位置選 packages/adapters/src/storefront-mappers/ 新子目錄、跨 package 共用準備)
- **預期解法:**
  - M-1-13 啟動前抽 mapper:`availabilityToBool(a: ProductAvailability): boolean` + `boolToAvailability(b: boolean): ProductAvailability`
  - 放置候選:`packages/adapters/src/storefront-mappers/`(新子目錄)/ 或 component 內部 inline + 集中 import
  - 不能讓 storefront component 散寫 ternary、必過 mapper
- **不修會痛在:**
  - 擴充性:Phase 2 加第三 availability state(例 `'discontinued'`)、storefront component 全要改 ternary;mapper 集中改一處
  - 可維護性:design 字面 vs domain 字面雙軌不對齊、grep 找對應靠記憶
  - bug 可追蹤性:客人「有貨顯示 Out of stock」、不知是 mapper 錯還 backend 錯、層次不分
- **估時:** M-1-13 同 slice 加 30 min(mapper + 集中 import)
- **依賴:** M-1-13 啟動前(可獨立 slice、或合進 M-1-13 主實作)
- **發現於:** 2026-05-04 / M-1-02-audit reuse R1
- **相關:** `packages/domain/src/catalog/types.ts` ProductAvailability、`design-reference/components/ProductCard.jsx` / `ProductPage.jsx`、ADR-0003 §3.2(string literal union type alias 規則)

### #83. ✅ matchFitment yearStart/yearEnd 範圍重疊邏輯(M-1-03 真實 adapter)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-05 / M-1-03-prep 件 #4(`packages/adapters/src/in-memory/InMemoryProductRepository.ts` private matchFitment method 補完整 3 規則:motoBrand + modelCode + 年份重疊;narrowing 取代 `!` non-null assertion、yearEnd null = Infinity、yearEnd undefined = 單年;`InMemoryProductRepository.test.ts` describe('matchFitment year-range') 段 4 個 test 涵蓋範圍重疊 / 開放式 / spec 無年份 / false-positive 防線;對齊 supabase-schema-design.md §2.4 4 種狀態)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中(M-1-03 真實 adapter 落地時補、之前 in-memory 簡化版可)
- **問題:**
  - InMemoryProductRepository.matchFitment 簡化版只判 motoBrand + modelCode、yearStart/yearEnd silently 忽略(對齊 M-1-02 slice 字面簡化)
  - false-positive 風險:若 actual = Ducati Panigale V4 / 2018-2020、spec = Ducati Panigale V4 / 2025、應該不 match 但目前會 match
  - M-1-02-audit engineering:code-review M1 抓出
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit engineering:code-review M1
- **預期解法:**
  - M-1-03 MedusaProductAdapter 落地時、補完整年份範圍邏輯:
    - actual yearStart-yearEnd 與 spec 年份(或 spec yearStart-yearEnd)有重疊 = match
    - actual yearEnd null(開放式 "2025+") = 與任何 ≥ yearStart 的 spec match
    - spec 無年份 = match 任意 yearRange
  - InMemoryProductRepository 同步補(對齊 ADR-0002 §4.1 in-memory 真實作精神、或標 simplified、test 補 false-positive case 證明)
  - 補 false-positive test case(actual 2018-2020 vs spec 2025 預期不 match)
- **不修會痛在:**
  - 擴充性:M-1-03+ 客人查「2025 Panigale 配件」會看到 2018-2020 only 商品、誤購率高
  - 可維護性:InMemory 簡化版隱藏 risky behavior、test 不抓
  - bug 可追蹤性:客人投訴「配件不適用」、查 fitment matching 邏輯需 deep dive
- **估時:** M-1-03 真實 adapter 同 slice 加 30-45 min(邏輯 + InMemory 同步 + 補 test case)
- **依賴:** M-1-03(MedusaProductAdapter)
- **發現於:** 2026-05-04 / M-1-02-audit engineering:code-review M1
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts` matchFitment、`packages/domain/src/catalog/types.ts` FitmentSpec yearStart/yearEnd | null、ADR-0004 wrs Q1=A1

### #84. ⏳ Timestamped utility type 第 3 處撞才抽(對齊 #19 trigger 哲學)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - M-1-02 catalog Product 加 `createdAt: Date; updatedAt: Date;` 是第一處
  - PHASE-1-MILESTONES 預告 Order 補 createdAt(M-3-02)、Customer 必有(會員時間戳、M-1-14)、Vehicle M-2-05 也必有
  - 對齊 backlog #19 「未來撞重複 ≥ 3 處再回頭抽」trigger 字面
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit reuse agent R2
- **預期解法:**
  - 第 3 處撞時(預期 = M-1-14 Customer、或 M-2-05 Vehicle、或 M-3-02 Order),抽 `Timestamped = { createdAt: Date; updatedAt: Date; }` 進 `packages/domain/src/shared/types.ts`
  - 各 entity 用 `Product extends Timestamped` 或 `& Timestamped` 合成
  - 同步補 ADR-0003 §3.1.1 規範說明「跨 entity 共用結構抽到 shared/」
- **不修會痛在:**
  - 擴充性:第 3 / 4 處撞時改 4 entity、對應 mapper / test fixture 也 4 處改
  - 可維護性:第 3 處撞才抽、避免過度設計(對齊 #19 拍板 Q3=A2 最小集精神)
  - bug 可追蹤性:本條目為錨點、第 3 處撞時 grep 找抽
- **估時:** 第 3 處撞同 slice 加 15-20 min(抽 type + 各 entity 改 + ADR 補)
- **依賴:** M-1-14 / M-2-05 / M-3-02 任一作為「第 3 處」trigger
- **發現於:** 2026-05-04 / M-1-02-audit reuse R2
- **相關:** `packages/domain/src/catalog/types.ts` Product createdAt/updatedAt、backlog #19(同 trigger 哲學「撞重複再抽」)

### #85. ⏳ createFakeProduct test fixture 抽到共用位置(第 3 處撞才抽)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - M-1-02 InMemoryProductRepository.test.ts 內 inline `createFakeProduct(overrides)` helper
  - 對齊 Q3=A 最小集精神不抽到 packages/adapters/test-fixtures/ 是合規
  - 但本 fixture 將被 placeOrder use-case test(M-1-15)、ProductPage server-render test(M-1-13)、searchByKeyword Medusa adapter test(M-1-03)複用
  - 第 3 處 test 需要時必複製貼上、第三處撞才抽
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit reuse agent R3
- **預期解法:**
  - 第 3 處 test 需要 createFakeProduct 時、抽到 `packages/adapters/test-fixtures/createFakeProduct.ts`(或 packages/domain/src/catalog/test-fixtures.ts)
  - 各 test 檔 `import { createFakeProduct } from '...'`
  - 對齊 testing-strategy.md §3 補規範「fixture 抽到共用位置 trigger 點 = 第 3 處 test 需要」
- **不修會痛在:**
  - 擴充性:第 3 處 test 撞時若沒抽、4 / 5 處 test 都複製貼上、fixture drift
  - 可維護性:Product entity 加新欄位時、若 fixture 散在多 test 檔、改一處漏其他
  - bug 可追蹤性:本條目為錨點、第 3 處 test 撞時 grep 找抽
- **估時:** 第 3 處 test 撞同 slice 加 15-20 min(抽 fixture + 各 test 改 import)
- **依賴:** M-1-03 / M-1-13 / M-1-15 任一 test 落地作為「第 3 處」trigger
- **發現於:** 2026-05-04 / M-1-02-audit reuse R3
- **trigger 重評於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d(雙 audit simp-13 揭示 createFakeProduct 第 2 處撞、pricing.test.ts L14-37 + InMemoryProductRepository.test.ts L12-35、對齊既有「第 3 處撞才抽 fixture」trigger 哲學、留條目觀察、第 3 處撞時啟動)
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts` createFakeProduct、`packages/domain/src/catalog/pricing.test.ts` createFakeProduct(sub 8d simp-13 第 2 處)、backlog #19 / #84(同 trigger 哲學「撞重複再抽」)、`docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` simp-13

### #86. ✅ M-1-03 啟動前 in-memory adapter 樣板 leak 防 + contract test + edge cases 三合一(thematic)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-05 / M-1-03-prep 三軸合一:
  - 軸 1(樣板 leak 防):2026-05-04 / M-1-02-audit Q2/E2/E5 落地 `docs/architecture/testing-strategy.md` §3.4「in-memory 樣板不搬到真實 adapter」L94-107(prep 件 #3 子項 A verify 已落地、跳過)
  - 軸 2(contract test):2026-05-05 / prep 件 #3 子項 B+C 落地 `packages/ports/src/IProductRepository.contract.ts`(81 行純架子、6 method + matchFitment 4 it.todo + JSDoc + example、Sean Q1=A3 拍板純架子 + TODO marker、待 main-b SupabaseProductAdapter 落地時 callsite 注入 factory 跑實際 assertion)
  - 軸 3(edge cases):2026-05-05 / prep 件 #4 落地 `InMemoryProductRepository.test.ts` describe('matchFitment year-range') 段 4 個 test(對齊 軸 2 contract 4 個 it.todo)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟠 中(M-1-03 啟動前必處理、之前不阻)
- **問題:**
  - M-1-02-audit 抓 3 個 thematic 互補議題、合併處置以對齊 backlog #15「同檔同時機補可合併」精神:
    - **A) 樣板 leak 防(Q2 + E2 + E5):** in-memory 4 method 用 `Array.from(values()).filter(...)` + `toLowerCase().includes()` 樣板、規範類已落 testing-strategy.md §3.4(M-1-02-audit 已修)、但需 M-1-03 開發者 review checklist 確認 MedusaProductAdapter 不照抄(走 SDK / SQL 過濾)
    - **B) save contract test 補(E3):** IProductRepository.save 字面已寫 contract、但無 contract test 確保 M-1-03 真實 adapter 補完樂觀鎖 / idempotency / audit trail(對齊 backlog #73 race + security-timeline §C7);M-1-03 啟動前在 IProductRepository.ts 文件加「contract test 必補項目」清單
    - **C) test edge cases 補(M3):** InMemoryProductRepository.test.ts 7 test 全 happy path、缺 empty Map / null / 邊界 case;M-1-03 啟動前統一補(連同 #83 false-positive case 一起做)
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit simplify quality + efficiency 雙 agent 抓出
- **預期解法:**
  - M-1-03 啟動前獨立 slice 跑 3 件:
    - A) MedusaProductAdapter review checklist(SDK / SQL 過濾、不照抄 in-memory)
    - B) IProductRepository.save contract test 必補項目清單寫進文件 + InMemory 補 race / idempotency stub test
    - C) InMemoryProductRepository.test 補 edge cases:empty Map listByX / empty query / null 邊界 / #83 false-positive
- **不修會痛在:**
  - 擴充性:M-1-03 開發者照 InMemory 樣板抄、Medusa adapter 完全走偏 ADR-0004 Q3=A1 拍板路徑;contract test 不就位、樂觀鎖漏補不抓
  - 可維護性:edge case 不補、bug 復發無 regression test
  - bug 可追蹤性:M-1-03 撞 race / over-fetch / 邊界 bug 時、無 anchor 條目
- **估時:** M-1-03 啟動前獨立 slice 60-90 min(A 30 min + B 20-30 min + C 30 min)
- **依賴:** M-1-03 啟動前
- **發現於:** 2026-05-04 / M-1-02-audit simplify Q2 / E2 / E3 / E5 / M3
- **相關:** `packages/ports/src/IProductRepository.ts`、`packages/adapters/src/in-memory/InMemoryProductRepository.ts`、`docs/architecture/testing-strategy.md` §3.4、backlog #73(sync-engine race)、`docs/architecture/security-timeline.md` §C7、backlog #83(yearStart/yearEnd)

### #87. ⏳ in-memory adapter dev singleton lifecycle(Map.clear / HMR / dev wire-up)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(test scope 內 test isolated 無問題、dev singleton wire-up 才浮現)
- **問題:**
  - InMemoryProductRepository.ts 的 Map 無 `clear()` method、無 dev singleton lifecycle 規範
  - 對 vitest test scope 不是問題(每個 describe `new InMemoryProductRepository()`、test 完 GC)
  - 但 class doc 字面寫「dev 期 spike:M-1-02 商品瀏覽流程不接 Medusa 也能 round-trip」
  - 若 dev server 把 InMemoryProductRepository 當 singleton inject、HMR / 多 request 跨 process boundary 就會累積
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit efficiency E4
- **預期解法:**
  - storefront wire-up slice(M-1-02 後續 / M-1-13 / 視 storefront 第一個用 InMemoryProductRepository 的 slice)啟動前:
    - 加 `clear(): void` method 到 InMemoryProductRepository(`this.products.clear()`)
    - 加 dev singleton lifecycle 規範文件(HMR 觸發 reset / multi-request 同 instance 處置)
    - 對齊 testing-strategy.md §3.3 補「in-memory adapter dev wire-up 紀律」段
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter 進 dev wire-up、無一致 lifecycle 規範、各 adapter 自由心證
  - 可維護性:HMR 跨 reload 累積資料、dev 期看不出 bug、上線後 (Medusa 真實 adapter) 才發現邏輯靠 stale state
  - bug 可追蹤性:本條目為錨點、storefront wire-up 撞時 grep 找
- **估時:** storefront wire-up slice 加 15-20 min(clear method + 規範 1 段)
- **依賴:** storefront 第一次用 InMemoryProductRepository wire-up(對齊 dev spike 假設)
- **發現於:** 2026-05-04 / M-1-02-audit efficiency E4
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts`、`docs/architecture/testing-strategy.md` §3.3 / §3.4

### #88. ⏳ 規格照片切換實作

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中
- **問題:**
  - 商品頁選不同規格時、gallery 需切換到該規格的照片組(多張)、滑完後回商品主圖
  - 目前設計只有單一 gallery、無規格照片群組概念
- **觸發事件:**
  - 2026-05-04 / Sean 拍板 `docs/product-import-spec.md` §6
- **預期解法:**
  - 商品頁 gallery 元件支援「規格照片群組」、選規格 → gallery source 切換
  - 無規格圖片則 fallback 商品主圖
- **不修會痛在:**
  - 擴充性:碳纖維 / 顏色類商品照片無法區分規格、體驗退化為普通電商
  - 可維護性:gallery 邏輯若寫死單一 source、之後插入規格群組需大改
  - bug 可追蹤性:客人選錯規格圖不知是資料問題還是元件問題
- **估時:** 45-60 min(M-1 商品頁 slice 內附帶)
- **依賴:** M-1 商品頁 slice、`docs/product-import-spec.md` §6
- **發現於:** 2026-05-04 / 商品上架規範討論
- **相關:** `docs/product-import-spec.md` §6

### #89. ⏳ 前台庫存只顯示有貨/缺貨

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中
- **問題:**
  - 庫存數字不對外顯示、前台只顯示「有貨」/「缺貨(售完)」
- **觸發事件:**
  - 2026-05-04 / Sean 拍板
- **預期解法:**
  - 商品頁 / 商品列表、stock > 0 顯示「有貨」、stock = 0 顯示「缺貨(售完)」、不渲染數字
- **不修會痛在:**
  - 擴充性:庫存數字外露、競爭對手可探知庫存水位
  - 可維護性:邏輯簡單、但若散落多個元件需多處修
  - bug 可追蹤性:顯示邏輯集中在一個 helper、易定位
- **估時:** 15 min(M-1 商品頁 slice 內附帶)
- **依賴:** M-1 商品頁 slice
- **發現於:** 2026-05-04 / 商品上架規範討論
- **相關:** `docs/product-import-spec.md` §7

### #90. ⏳ Phase 1 CSV 批次匯入腳本

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - 第一波 1000-2000 筆商品需批次匯入、不可能手動單筆建立
- **觸發事件:**
  - 2026-05-04 / Sean 拍板 `docs/product-import-spec.md` §9
- **預期解法:**
  - 寫 `scripts/import-products.ts`、讀符合 `docs/product-import-spec.md` 格式的 CSV
  - groupBy 主商品貨號、解析 fitments / images、upsert 進 Supabase
  - 重複執行安全
- **不修會痛在:**
  - 擴充性:格式已定案、Phase 2 批次 UI 吃同一格式、腳本可直接複用解析邏輯
  - 可維護性:一次性腳本、Phase 2 做 UI 時抽 parse 邏輯進 shared util
  - bug 可追蹤性:CSV 格式標準化後、資料問題容易定位到哪一行哪一欄
- **估時:** 90-120 min(M-1-03 主實作完成後獨立 slice)
- **依賴:** M-1-03 主實作完成(Supabase schema 穩定後才寫匯入腳本)、`docs/product-import-spec.md` §9
- **發現於:** 2026-05-04 / 商品上架規範討論
- **相關:** `docs/product-import-spec.md` §9、`docs/architecture/supabase-schema-design.md` §2-§5

### #91. ⏳ Phase 1 簡易匯出腳本(CSV 雙向格式)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - Sean 整理資料時可能會發現錯字、價格要改、車種要補
  - 直接從 Supabase Dashboard 撈 CSV、欄位順序與 `docs/product-import-spec.md` 不對齊
  - 需要「下載 → Excel 改 → 重新上傳」的閉環
- **觸發事件:**
  - 2026-05-05 / Sean Claude.ai 拍板(雙向格式 + Phase 1 提前補)
- **預期解法:**
  - 寫 `scripts/export-products.ts`、從 Supabase 撈 products + fitments + variants + images
  - 按 `docs/product-import-spec.md` §2 19 欄反向組裝
  - 多車種合併 Alt+Enter(對應 §4)
  - 多規格展開多行(對應 §3)
  - 多圖片分號隔開(對應 §5)
  - 輸出檔名 `products-export-YYYY-MM-DD.csv`
  - 與匯入腳本(#90)共用 parse / serialize 邏輯(抽 shared util)
- **不修會痛在:**
  - 擴充性:Phase 2 後台批次工具吃同邏輯、序列化邏輯可直接複用
  - 可維護性:不寫匯出、Sean 修資料只能進後台單筆改、1000 筆改不動
  - bug 可追蹤性:雙向往返驗證可早期抓出 import / export 邏輯不一致
- **估時:** 60-90 min(依賴 #90 匯入腳本完成、共用 serialize 邏輯)
- **依賴:** #90 匯入腳本完成、`docs/product-import-spec.md` §10/§11
- **發現於:** 2026-05-05 / Claude.ai 拍板
- **相關:** `docs/product-import-spec.md` §10/§11、backlog #90、`docs/architecture/supabase-schema-design.md` §2-§5

---

### #92. ✅ resolveEnd helper 抽到 packages/domain/src/catalog/year-range.ts

- **狀態:** ✅ 完成(2026-05-07 / M-1-03-main-b sub-slice 3)
- **優先級:** 🟠 中
- **問題:**
  - InMemoryProductRepository.matchFitment 內 `actual.yearEnd === null ? Infinity : actual.yearEnd ?? actual.yearStart` 對 actual / spec 兩端對稱重複
  - 兩行三狀態(null / undefined / number)擠一行、reader 需理解 `??` 不會吞 null
  - 來源:M-1-03-prep audit Round 1 F4 + Round 2 F12 + F15(三視角同向命中)
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit
- **預期解法:**
  - main-b SupabaseProductAdapter 落地時、PG range query 也需 yearEnd null/undefined 處理、第二個使用點出現
  - 抽 `resolveEnd(start: number, end: number | null | undefined): number` helper 到 `packages/domain/src/catalog/year-range.ts`
  - InMemory + Supabase 兩 adapter 共用、避免雙寫
  - 兼解 yearEnd null vs undefined 雙語意 type guard
- **不修會痛在:**
  - 擴充性:main-b 落地時 InMemory + Supabase 各寫一份相同邏輯、雙語意 type guard 散兩處
  - 可維護性:未來改邏輯(例支援更精確的範圍匹配)需改兩處、易遺漏
  - bug 可追蹤性:邏輯不一致時難對齊、客人投訴「同 product 兩 adapter 行為不同」debug 成本高
- **估時:** main-b 同 slice 加 30 min(抽 helper + 兩 adapter 替換 + JSDoc)
- **依賴:** main-b SupabaseProductAdapter 落地(M-1-03 主實作)
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 2 F12
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts` matchFitment、`docs/architecture/supabase-schema-design.md` §2.4、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F4/F12/F15

---

### #93. ✅ matchFitment 補 8 個 boundary case test

- **狀態:** ✅ 完成 2026-06-16(commit 5fb914e:InMemoryProductRepository.test 補 8 邊界 case〔單年/相鄰年/inclusive 上下界/空 fitments/多 fitment OR/open-ended 下界/actual 無年份〕、code-reviewer mutation-test 逐一驗對)
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - M-1-03-prep 件 #4 落地 4 個 yearRange test、覆蓋 4 種主要狀態(範圍重疊 / null 開放式 / 無年份 / false-positive)
  - audit Round 1 F6 抓出 8 個 boundary case 漏測:
    - 單年 actual(yearEnd=undefined)+ 範圍 spec → 應 match
    - 單年 actual + 單年 spec、相同年 → 應 match
    - 單年 actual + 單年 spec、相鄰年 → 不應 match
    - 邊界 inclusive(actual.yearEnd=2020 vs spec.yearStart=2020)→ 應 match(驗 `≤` 含等於)
    - 空 fitments[] → some() 回 false、不 match
    - 多 fitments[] OR(product 有 fit1+fit2、spec 只 match fit2)→ 應 match
    - yearEnd null 開放式 + spec 早於 yearStart(actual=2025+ vs spec=2024)→ 不應 match
    - actual 無年份的鏡像(test case 3 只測 spec 無年份、沒測 actual 無年份)
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 1 F6
- **預期解法:**
  - main-b SupabaseProductAdapter 落地時、確保 InMemory + Supabase 兩 adapter 行為對齊
  - 補 8 個 boundary case 到 InMemoryProductRepository.test.ts「listByFitment year-range matching」describe 內
  - main-b SupabaseProductAdapter 落地後 contract test 跑同樣 8 case 驗 PG range query 行為
- **不修會痛在:**
  - 擴充性:main-b 兩 adapter 行為對不齊、未來加第三 adapter 又漏 boundary
  - 可維護性:漏測 boundary 不知、改邏輯時 silent regression
  - bug 可追蹤性:客人投訴「2025 配件出現 2018-2020 商品」邏輯查找成本高、無 boundary test 證明邏輯
- **估時:** 60-90 min(main-b 落地後獨立 slice、含 8 case 寫 + InMemory + Supabase 雙跑)
- **依賴:** main-b SupabaseProductAdapter 落地、#92(resolveEnd helper 共用)
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 1 F6
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts` listByFitment year-range matching、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F6

---

### #94. ✅ matchFitment JSDoc 補 spec 端對稱處理說明

- **狀態:** ✅ 完成(2026-05-07 / M-1-03-main-b sub-slice 3、合進 #92 同 slice)
- **優先級:** 🟡 低
- **問題:**
  - InMemoryProductRepository.matchFitment JSDoc 規則 3 只寫 actual.yearEnd 三狀態、沒明寫 specEnd 也走同樣處理
  - 程式碼第 112 行 specEnd 邏輯實際存在、但 JSDoc 漏寫對稱性
  - reader 讀 JSDoc 不知道 spec 端如何處理、需讀程式碼推斷
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 1 F5
- **預期解法:**
  - #92 抽 resolveEnd helper 時順手改 JSDoc
  - 規則 3 補:「actual / spec 兩端對稱處理 yearEnd null/undefined」
- **不修會痛在:**
  - 擴充性:未來加第三維度(例 trim level)、JSDoc 對稱性沒立、易漏寫
  - 可維護性:reader 讀 JSDoc 推斷不出 spec 端處理、需 grep 程式碼
  - bug 可追蹤性:JSDoc 與實作 drift 時無 anchor 抓出
- **估時:** 5 min(合進 #92 同 slice)
- **依賴:** #92
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 1 F5
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts` matchFitment、#92、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F5

---

### #95. ⏳ fitment motoBrand / modelCode case-sensitivity normalize

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - matchFitment line 103-104 用 strict equality(`actual.motoBrand !== spec.motoBrand`)
  - case 不一致會 silent miss:'Yamaha' !== 'yamaha' = false negative
  - 廠商報價單可能用 'YAMAHA' / 'Yamaha' / 'yamaha' 等不一致 case
  - 對齊 ADR-0004 wrs Q1=A1 字面(自由字串)、但實作策略未定
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 1 F7
- **預期解法:**
  - M-5-03 sync engine 上架時 normalize 進 DB('Yamaha' 統一格式、Title Case)
  - InMemory + Supabase 兩 adapter 維持 strict equality(normalize 是 sync engine 責任、不在 adapter)
  - sync engine 補 normalizeMotoBrand / normalizeModelCode helper
- **不修會痛在:**
  - 擴充性:廠商資料源多、case 不一致將來會撞、不 normalize 全資料層污染
  - 可維護性:sync engine 責任、不在 InMemory;混淆責任會撒進 multiple layers
  - bug 可追蹤性:silent miss 無 log、客人「找不到我的車的配件」reproduce 困難
- **估時:** 15-30 min(M-5-03 內附帶)
- **依賴:** M-5-03 sync engine
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 1 F7
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts:103-104`、`docs/decisions/0004-m1-pre-launch-decisions.md` Q1=A1、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F7

---

### #96. ⏳ fitment yearStart > yearEnd 資料異常防呆

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - matchFitment 範圍重疊判定無 yearStart > yearEnd 防呆
  - 若資料 yearStart=2024, yearEnd=2018(廠商輸入錯)、邏輯不報錯、回 false negative
  - 屬資料層責任、但無 log / no warning
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 1 F8
- **預期解法:**
  - M-5-03 sync engine validation 階段檢測 yearStart > yearEnd
  - 報錯停下、寫進 sync error log(對齊 sync-engine error structure)
  - 不在 adapter / domain 層加防呆(責任在資料源驗證)
- **不修會痛在:**
  - 擴充性:未來廠商上架自動化、資料異常頻率上升、無防呆會 silent miss
  - 可維護性:sync engine validation 集中、不散落各 adapter
  - bug 可追蹤性:客人投訴「找不到 2018 配件」、查 fitment 才發現 yearStart=2024 錯資料
- **估時:** 15 min(M-5-03 validation 階段附帶)
- **依賴:** M-5-03 sync engine
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 1 F8
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts:99`、#95(同 M-5-03 trigger)、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F8

---

### #97. ⏳ listByFitment 結果排序契約定義

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - InMemoryProductRepository.listByFitment 用 `Array.from(this.products.values()).filter(...)` 回 Map insertion order
  - V8 stable insertion 是實作細節、契約上無排序保證
  - caller 若期待按某順序(例 yearStart desc / 庫存 desc)、需自行 sort
  - 第一個 caller 未定(M-1 商品列表頁 / M-2 篩選頁)
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 1 F9
- **預期解法:**
  - 第一個 caller 真撞到順序需求時、再定義排序契約
  - 候選方向:
    - A:listByFitment 加 `sort?: 'yearStart-desc' | 'stock-desc'` 參數(推薦、明確)
    - B:caller 自行 sort、listByFitment 無排序保證(簡單、但每個 caller 重複)
  - 拍板後更新 IProductRepository.listByFitment JSDoc + InMemory + Supabase 同步實作
- **不修會痛在:**
  - 擴充性:第一個 caller 隨意定排序、第二個 caller 又重定義、契約散
  - 可維護性:JSDoc 字面寫排序保證、實作隨意、drift
  - bug 可追蹤性:客人「為什麼這個排序看起來怪怪的」debug 成本高
- **估時:** 30 min(第一個 caller 同 slice 拍板 + 落地)
- **依賴:** 第一個 listByFitment caller 真撞到順序需求(可能 M-1 商品列表頁 / M-2 篩選頁)
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 1 F9
- **相關:** `packages/ports/src/IProductRepository.ts` listByFitment、`packages/adapters/src/in-memory/InMemoryProductRepository.ts`、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F9

---

### #98. ⏳ matchFitment test setup it.each table-driven 重構

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - M-1-03-prep 件 #4 落地 4 個 yearRange test、setup 模式重複(createFakeProduct + new InMemoryProductRepository + listByFitment + expect)
  - audit Round 2 F17 建議 it.each table-driven、或抽 helper expectFitmentMatch
  - #93 補 8 個 boundary case 後總 test 數 12+、表格化提升維護性
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep audit Round 2 F17
- **預期解法:**
  - #93 補完 boundary cases 後、總 test 數 12+ 時評估
  - 候選方向:
    - A:it.each([...]) table-driven、列 motoBrand / modelCode / yearStart / yearEnd / expected 維度
    - B:helper expectFitmentMatch(fitments, query, expectedIds)
  - 4 個 test 各自表達意圖反而清楚、12+ test 才有重構價值
- **不修會痛在:**
  - 擴充性:8 個 boundary case 補完不重構、加新 dimension(trim / displacement)會擴成 16+ 個 test
  - 可維護性:table-driven 在多維度時可讀性可能變差、需評估
  - bug 可追蹤性:test 失敗時 table row 比 it 名抽象、debug 成本看設計
- **估時:** 30 min(合進 #93 同 slice、或 #93 後獨立 slice)
- **依賴:** #93 補完 8 個 boundary case
- **發現於:** 2026-05-05 / M-1-03-prep audit Round 2 F17
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts`、#93、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F17

---

### #99. ✅ lessons-learned.md 結構整理(「偵察 slice 方法論」段歸位)

- **狀態:** ✅ 完成(2026-06-17 A 方向 docs slice;原懸於附錄 B 後無編號的「偵察 slice 方法論」段〔2026-04-30 立〕歸位為 §13〔放 §12-37 後、附錄前、編號區段連續〕,內容逐字保留 + 加 §13.1/§13.2 錨點;他處僅以字面引用、無 § 錨點需同步;純文件)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - `docs/lessons-learned.md` 結構在「附錄 B」後還有一段沒編號的「偵察 slice 方法論」(line 348-369、原立於 2026-04-30)
  - 邏輯上應歸併到 §10 或新章節、現散在附錄後造成結構混亂
  - 來源:M-1-03-prep-audit follow-up reality check V1(本 slice 不動既有結構、Sean Q12=L1)
- **觸發事件:**
  - 2026-05-05 / M-1-03-prep-audit follow-up reality check V1
- **預期解法:**
  - 獨立 slice 整理 `docs/lessons-learned.md` 結構
  - 「偵察 slice 方法論」歸併到 §10 或開新 §13(依語意判斷)
  - 順手 review 全檔結構一致性
- **不修會痛在:**
  - 擴充性:lessons-learned 持續累積、結構混亂會放大
  - 可維護性:reader 找「為什麼這樣設計」的歷史教訓、附錄後段被忽略
  - bug 可追蹤性:未來引用「偵察 slice 方法論」字面、無 § 編號錨點
- **估時:** 30-45 min(獨立 slice)
- **依賴:** 無(隨時可做、優先級低)
- **發現於:** 2026-05-05 / M-1-03-prep-audit follow-up reality check V1
- **相關:** `docs/lessons-learned.md`、`docs/reviews/M-1-03-prep-audit-2026-05-05.md` reality check V1

---

### #100. ✅ 全 catalog 表 §10.1 vs .sql drift(brands / categories / products / 未來 variants)

- **狀態:** ✅ 完成(2026-06-17 A 方向 docs slice;§10.1 補 `idx_categories_parent_category_id`〔對齊 a2-1 migration 20260505130758 line 121〕+ brands/categories auto-unique-index 備註〔name+slug / raw_path UNIQUE 不重列〕;純文件記錄既有 migration 事實、非改 DB、零 schema 變更)
- **分流:** P1-before-launch
- **優先級:** 🟡 低(doc 補洞、不阻擋實作、有 a2-1 .sql 為事實依據)
- **問題:**
  - `docs/architecture/supabase-schema-design.md §10.1 Phase 1 階段 1` 既有 12 條索引(products / orders / order_items / customers)
  - brands / categories 表 0 條索引列入 §10.1
  - a2-1 SQL migration 實際加 1 條:`idx_categories_parent_category_id ON categories(parent_category_id)`
  - brands 表自承「靠 name + slug UNIQUE 自動 unique index、不需額外索引」(a2-1 commit body 揭示)
  - categories.raw_path UNIQUE 也自動 unique index、a2-1 不重列
  - 真權威 §10.1 vs a2-1 .sql 實作有 drift
- **觸發事件:**
  - 2026-05-05 / M-1-03-main-a2-1 期間 Sean 拍板 Q4=D2「加 idx 不擴張改 docs」、本 slice 不補真權威字面、開條目追蹤
  - 2026-05-06 / M-1-03-main-a2-1-followup-recon C1 偵察揭示 §10.1 既有 12 條 + a2-1 SQL 實際加 1 條
  - 2026-05-06 / a2-2 v3 落地揭示 products 同 drift(§10.1 真權威列 5 條 explicit、a2-2 v3 §7 對齊 a2-1 慣例寫 3+2)
- **預期解法:**
  - 在 supabase-schema-design.md §10.1 line 498(idx_customers_tier 之後)、line 499 空行之前、補 1 條:
    `CREATE INDEX idx_categories_parent_category_id ON categories(parent_category_id);`(註:categories 樹查詢)
  - §10.1 結尾或表頭備註說明:「brands 表靠 name + slug UNIQUE 自動 unique index;categories.raw_path UNIQUE 也自動 unique index、不重列顯式 CREATE INDEX」
  - 落點:下次涉及 §10.1 修改的 slice(M-1-03-main-a2-2 / main-b / main-d 任一)順手補、或獨立 docs slice
- **不修會痛在:**
  - 擴充性:後續 slice 加 brands / categories / products 索引時、若依 §10.1 真權威會以為「沒既有索引」、可能重複加 idx_categories_parent_category_id 或 products explicit index 衝突;a2-2 follow-up slice 若同樣踩 drift(§10.1 真權威 vs a2-1+a2-2 落地 .sql 慣例)、reader 信任受損連鎖、新加入者讀 doc 對齊狀態時錨點失準
  - 可維護性:reader 讀 §10.1 假設「Phase 1 階段 1 完整索引列表」、實際 SQL migration 比 doc 多 1 條、信任受損
  - bug 可追蹤性:未來 categories 查詢效能 issue 排查、§10.1 沒 idx_categories_parent_category_id 字面、誤判「沒索引」走重建
- **估時:** 15-30 min(獨立 docs slice;併進其他 docs slice 5 min)
- **依賴:** 無、隨時可做
- **發現於:** 2026-05-05 / M-1-03-main-a2-1 拍板 Q4=D2、2026-05-06 followup-recon C1 偵察揭示
- **相關:** `docs/architecture/supabase-schema-design.md` §10.1、`supabase/migrations/20260505130758_init_brands_categories.sql`、M-1-03-main-a2-1 commit body 第 5 點

---

### #101. ⏳ Supabase advisor 2 WARN 處置 — public.rls_auto_enable() function

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中(SECURITY 類 WARN、暴露給 anon + authenticated、上線前必處置)
- **問題:**
  - Supabase advisor 抓 2 條 SECURITY 類 WARN、都指向同一個 function:`public.rls_auto_enable()`
  - WARN-1 `anon_security_definer_function_executable`:`anon` role 可呼叫 `/rest/v1/rpc/rls_auto_enable`
  - WARN-2 `authenticated_security_definer_function_executable`:`authenticated` role 可呼叫 `/rest/v1/rpc/rls_auto_enable`
  - function 是 SECURITY DEFINER、無參數、plpgsql
  - 不在 a2-1 SQL migration 字面內(grep 確認、a1 setup 或 Supabase project bootstrap 期間建立、起源待後續 slice grep a1 commits .sql 檔或查 Supabase 文件確認)
- **觸發事件:**
  - 2026-05-05 / M-1-03-main-a2-1 §G Dashboard 驗順手 advisor 抓 2 WARN
  - 2026-05-06 / M-1-03-main-a2-1-followup-recon C2 偵察跑 supabase MCP get_advisors 撈完整字面
- **預期解法(兩方向、後續 slice 拍板):**
  - **方向 A:REVOKE EXECUTE 斷權**
    - SQL:`REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;`
    - 利:技術上較安全、anon + authenticated 完全不能呼叫;保留 SECURITY DEFINER 屬性、function 仍可被 service_role 以 owner 權限執行(維持 RLS auto-enable 工具運作);不改 function 本體、變更面小
    - 弊:若未來新 role 加入需再 grant、額外維護;REVOKE 是 explicit deny、若 schema migration 重建需重跑
  - **方向 B:改 SECURITY INVOKER**
    - SQL:`ALTER FUNCTION public.rls_auto_enable() SECURITY INVOKER;`
    - 利:function 跟 caller 權限走、自動繼承 caller policy;不需 explicit REVOKE、語義更清楚
    - 弊:RLS auto-enable 工具需 owner 權限才能 ALTER TABLE ENABLE ROW LEVEL SECURITY、改 INVOKER 後 anon / authenticated 呼叫仍會因權限不足跑不動、但語義模糊(從「拒絕」變「跑不動」);若 service_role 呼叫、SECURITY INVOKER 也是 service_role 權限、行為跟 DEFINER 等價、看似無差別、實際是「無人能用」;跟 function 設計意圖(provide RLS bootstrap helper for service_role)衝突
    - **方向 B 不推**
  - **建議方向:A REVOKE EXECUTE**
- **不修會痛在:**
  - 擴充性:future role(如 dashboard_user)加入時需 explicit deny、若忘了會繼承 PUBLIC default、再次暴露
  - 可維護性:advisor 持續 warn 噪音、Sean 跑 dashboard 看到一直要解釋為何「無視」、心智成本累積
  - bug 可追蹤性:若 anon / authenticated 真呼叫 rls_auto_enable() 觸發 RLS 變更事件、無 audit log、Phase 2 排查無 anchor
- **估時:** 15-30 min(寫 migration + apply + 重跑 advisor 確認 2 WARN 消失;若選方向 A 跑 REVOKE 簡單)
- **依賴:** 無、上線前必處置
- **發現於:** 2026-05-05 / M-1-03-main-a2-1 §G、2026-05-06 followup-recon C2
- **相關:** `docs/architecture/security-timeline.md` §C5 RLS policy、`docs/architecture/supabase-schema-design.md` §9.2 RLS、M-1-03-main-a2-1 commit body 第 8 點

---

### #102. ⏳ busboy-end script L29 hash drift 治本

- **狀態:** ⏳ 待執行
- **分流:** wont-do
- **優先級:** 🟡 低(non-blocking、累積性 drift、不影響 build / runtime / 部署)
- **問題:**
  - `/Users/sean_1/pcm-tools/scripts/busboy-end.js`(74 行純 echo 腳本、無函式封裝、Claude Code 依步驟手動執行)
  - L50-51 echo 提示「最近 3 commit:hash + 訊息 + 時間」+「amend 後 slice commit 的 hash 會變、寫當下值即可、下個 slice 會再覆蓋」(L51 字面已承認此 drift 機制)
  - busboy-end.js 自身不抓 hash;Claude Code 在 step 4 用 `git log --oneline -3` 拿 amend 前 HEAD hash 寫 STATUS L29、step 6(L65)`git commit --amend --no-edit` 後 commit hash 變、L29 已寫死 → drift
  - 結果:每個 slice 收工的 L29 都是 amend 前快照 hash、需下個 slice 順手修(M-1-01-followup / M-1-02 / M-1-03-pre0b / pre0c / pre0d / pre1 / side / prep / prep-audit follow-up / main-a1 / main-a2-1 / main-a2-1-followup / a2-2 v3 連續多輪重複手動修、教訓 lessons §12-2 reality check + §12-3 維度 B)
- **觸發事件:**
  - 2026-05-06 / M-1-03-a2-2 v3 PRD review 階段 mini-slice、amend 後 busboy-end 收工寫 L29 為 amend 前快照 hash 而非實際 commit hash、Code 偵察揭示根因
  - Anchor:`docs/lessons-learned.md` §12-3 line 408 起(字面 vs 事實守則延伸 — 雙維度共通字面寫死前必先校準事實、維度 B 揭示 amend 後 hash drift 修正不只「美觀」是事實追溯能力的維護)
- **預期解法(主修方向 + 替代方向、後續 slice 拍板):**
  - **主修方向:雙 amend(改 busboy-end.js L50-65 echo 步驟順序)**
    - L50-51 改:step 4 寫 STATUS 6 欄位但 L29 用 placeholder(如 `<<HEAD>>`、不寫實 hash)
    - L65 後追加新步驟:step 6.1 第一次 amend 後 `HEAD_NEW=$(git rev-parse --short HEAD)` 拿新 hash → step 6.2 sed 把 `<<HEAD>>` 替換成 `$HEAD_NEW` → step 6.3 第二次 `git commit --amend --no-edit`
    - 利:STATUS L29 hash = 實際 push 後 commit hash、無 drift、單次 slice 收工根治
    - 弊:增加一次 amend、執行步驟複雜度上升、新人 / 跨 session 易誤跳;`<<HEAD>>` placeholder 需明確 echo 提示否則 Claude Code 可能誤填實 hash
  - **替代方向 A:STATUS L29 不寫 hash(改穩定 anchor)**
    - L29 表格欄改成「commit subject + 時間」、移除 hash 欄
    - 利:從根本消除 drift、L29 不需任何 amend 後修
    - 弊:hash 是 commit 唯一標識、移除後追溯 milestone commit 需另跑 `git log --grep`、降低 STATUS 即時可讀性
  - **替代方向 B:接受 drift、只在下個 slice 順手修(現況)**
    - 不改 busboy-end.js、依賴每個 slice 觸發 lessons §12-2 reality check 字面修
    - 利:不改 script、流程不變
    - 弊:drift 累積、每個 slice 都需 commit body 揭示「順手修上輪 hash drift」、認知負擔持續(現況痛點)
  - **建議方向:主修方向(雙 amend)**
- **不修會痛在:**
  - 擴充性:每次 amend 後 busboy-end 收工都會留 drift、累積後 L29 與 git HEAD 偏離越來越遠;新增第三方 trigger amend(如 hooks / pre-commit)時 drift 機制更隱蔽、追根更難
  - 可維護性:Sean / 新加入者讀 STATUS 對齊狀態時 L29 不可信、需另跑 `git log` 對比、破壞 STATUS = single source of truth 設計;每個 slice commit body 重複揭示「順手修上輪 hash drift」屬機械性負擔、跟 working-style 原則 9「不憑記憶 / 不重複手動修」精神衝突
  - bug 可追蹤性:回查 milestone 時 L29 hash 對應不到實際 commit、追溯 amend 前後差異成本提高;dangling commit object(amend 前 commit、git gc 後字面不再可解)使「為何當時 STATUS 寫此 hash」追根斷線、對應 lessons §12-3 維度 B 教訓
- **估時:** 30-60 min(改 busboy-end.js L50-65 echo 字面 + 雙 amend 步驟 + 跨 repo 同步至 pcm-tools / pcm-website-v2 + 測試一次 slice 收工驗 L29 = 實際 commit hash)
- **依賴:** 無、隨時可做(獨立 ops slice、不阻擋 M-1-03 主實作)
- **發現於:** 2026-05-06 / M-1-03-a2-2 v3 PRD review mini-slice(處置 a2-2 v3 review 遺留事項時 Code 偵察 busboy-end.js 字面)
- **相關:** `/Users/sean_1/pcm-tools/scripts/busboy-end.js` L50-51 + L65、`docs/lessons-learned.md` §12-2(reality check)+ §12-3 line 408 起(字面 vs 事實守則延伸維度 B)、`docs/working-style.md` 原則 9(不憑記憶 / 不重複手動修)、跨 repo:pcm-tools

---

### #103. ⏳ products updated_at UPDATE 不自動更新風險

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟡 低(non-blocking、application 端可補、不阻擋 a2-2 / Slice A1+A2 落地)
- **問題:**
  - UPDATE 操作不會自動更新 `updated_at`(欄位 `DEFAULT now()` 只在 INSERT 觸發、UPDATE 不重新 evaluate DEFAULT)
  - a2-2 v3 PRD §5 拍板 Q2=B「不寫 trigger、updated_at 由 application 端 server-side 寫入時手動 set」
  - 需 application 端統一處理、否則 updated_at 失準、無法當「資料最後變更時間」可信來源
- **觸發事件:**
  - 2026-05-06 / a2-2 v3 PRD §5 拍板 Q2=B 不寫 trigger、開條目記風險錨點供 M-1-14 application 端啟動時拍板
- **預期解法(三選項並列、後續 slice 拍板):**
  - **(a) application 端 SupabaseAdapter update 時統一 set updated_at = now()**:M-1-14 SupabaseAdapter 落地時實作、所有 update 路徑強制經 adapter
  - **(b) 補 BEFORE UPDATE trigger 在 PostgreSQL 層**:集中、跨 application 路徑統一、SQL 直接 UPDATE 也涵蓋
  - **(c) 其他**:如 audit log 替代、updated_at 不再可靠、改用 audit_log 表記錄變更時序
  - **建議方向:** M-1-14 application 端啟動時評估拍板、本條目暫不預設方向
- **不修會痛在:**
  - 擴充性:M-1-14 之後若有 SQL 直接 UPDATE 路徑(SQL admin / migration data fix / Supabase Dashboard 手改)、updated_at 不更新、後續 audit log 追溯失效;若 (a) 落地後新加 adapter 路徑忘記補 set、漏洞累積
  - 可維護性:application 端散落 `set updated_at = now()` vs DB 層 trigger 集中、選擇後維護心智負擔差異大;reader 看 schema 預期 updated_at 自動準確、實際需查 application 端是否補、信任受損
  - bug 可追蹤性:updated_at 不準時、debug「資料何時改的」失效、出事故無法定位時間線;Phase 2 加 audit log 時若依賴 updated_at 當基準時間、誤判事件序
- **估時:** 評估 5 min + 若選 (b) 額外 30-60 min(BEFORE UPDATE trigger + 全表 ALTER + a2-1 brands / categories falls back 補)
- **依賴:** M-1-14 啟動(application 端 SupabaseAdapter 統一補時)
- **發現於:** 2026-05-06 / a2-2 v3 PRD review 階段拍板 Q2=B
- **相關:** `docs/specs/M-1-03-products-schema-prd-v3.md` §5 / §9 #3、`docs/architecture/supabase-schema-design.md` §2.1 updated_at 字面、a2-2 v3 Slice 0 commit body 第 4 點

---

### #104. ⏳ Claude Code IDE 自動 spawn worktree + 殘留處置(2026-05-06 兩次事故反覆)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中(反覆事故 2 次、影響工作流穩定性與起手檢查心智、不阻擋實作)
- **問題:**
  - 2026-05-06 兩次 Code session 起手、IDE 自動 spawn `.claude/worktrees/admiring-nightingale-811ca4` worktree(branch: `claude/admiring-nightingale-811ca4` / HEAD: `9f609b0` = origin/main 最新 commit)
  - memory 條 1 已寫「Desktop Phase 1 全程關 Worktree」、設定即便已關仍 spawn(根因不明、待偵察)
  - 現有殘留:`.claude/worktrees/admiring-nightingale-811ca4` 工作目錄 + `claude/admiring-nightingale-811ca4` branch ref 仍存在
  - Code 自身在主 worktree(toplevel = `/Users/sean_1/pcm-website-v2`)、可正常工作、不阻擋本 slice;但屬「未預期 worktree 殘留」、需揭示
- **觸發事件:**
  - 2026-05-06 第一次 Code session 起手、Sean 補 5 項驗證揭示 `.claude/worktrees/admiring-nightingale-811ca4` 存在
  - 2026-05-06 同日 Slice 0 v2 起手再驗、同樣偵察揭示子 worktree 仍存、屬反覆事故第 2 次
- **預期解法(三選項並列、後續 slice 拍板):**
  - **(a) 偵察 IDE 自動 spawn 機制根因 + 治本關閉 + 殘留清理**:查 Desktop Settings + extension config + `~/.claude.json`、找出「即便關 Worktree 仍 spawn」根因、治本關閉;`git worktree remove --force .claude/worktrees/admiring-nightingale-811ca4` + `git branch -D claude/admiring-nightingale-811ca4` 清殘留
  - **(b) 接受 worktree spawn 為環境特性、不治本**:每次起手前置 5 項驗證偵察、確認 Code 自身在主 worktree 即繼續、現況維持(memory 條 1 現狀)
  - **(c) 改起手檢查邏輯 + CLAUDE.md 對齊**:Code 起手檢查改為「偵測殘留 worktree、警示但不阻擋(若 Code 自身在主 repo)」、CLAUDE.md「第一天起手檢查清單」3 條 → 5 條同步升級對齊 memory 條 1 規範、消除規範漂移
  - **建議方向:** (a) — 治本最徹底、避免反覆累積殘留、降低後續 git 操作(branch listing / push --all 自動化腳本)意外干擾風險
- **不修會痛在:**
  - 擴充性:每次新 Code session 都可能 spawn、累積 `.claude/worktrees/` 殘留;若 IDE 升版改機制、行為再變、難預測;新加入者(同事 / 未來 collaborator)踩同一坑無錨點
  - 可維護性:Code 起手檢查需考慮兩種情境(自身在子 worktree 偏離 vs 自身在主 repo 但有殘留)、邏輯複雜化;CLAUDE.md「第一天起手檢查清單」3 條 vs memory 條 1 5 項規範漂移、規範雙軌、新 session 易誤判
  - bug 可追蹤性:殘留 worktree branch 可能在某 git 操作意外干擾(`git branch -a` 看到 `claude/xxx` 干擾識讀、`git push --all` 不小心推到 origin 上、未來若有 CI 自動化腳本踩雷無錨點)
- **估時:** 偵察根因 30-60 min + 若選 (a) 治本 60-90 min(含 Desktop Settings + extension config 偵察 + 殘留清理 + 跨 session 驗) / 若選 (b) 0 min / 若選 (c) 30 min(改 CLAUDE.md + working-style + memory 條 1 對齊)
- **依賴:** Sean 拍板選 (a) / (b) / (c)
- **發現於:** 2026-05-06 / 新 session 起手 5 項驗證(Sean 補)+ Code 偵察(`.claude/worktrees/admiring-nightingale-811ca4 / 9f609b0`)、第 2 次反覆
- **相關:** memory 條 1(Desktop Phase 1 全程關 Worktree)、`CLAUDE.md`「第一天起手檢查清單」(舊版 3 條 vs memory 5 項規範漂移)、a2-2 v3 Slice 0 commit body 第 5 + 8 點揭示

---

### #105. ⏳ PROJECT-OVERVIEW / tools-and-skills 字面 drift(apps/medusa + Medusa 後台 + Railway vs ADR-0005 Supabase + apps/api/)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低(不阻擋實作、僅影響新 Code session 讀套件入門時的真權威指引)
- **問題:**
  - ADR-0005 拍板(2026-05-04 / M-1-03-pre0c 落地)「Custom + Supabase 直寫架構、apps/medusa/ → apps/api/」、但下列字面尚未同步:
    - `docs/PROJECT-OVERVIEW.md` §3.1 monorepo 結構仍寫 `apps/medusa/` + §3.2 技術棧寫「後台 Medusa.js v2 + Prisma」+「後台部署 Railway」+ §3.3「為什麼選這套」Medusa v2 段
    - `docs/tools-and-skills.md` §1.2 busboy repo 參數註提「新 medusa repo」+ §6.1 Supabase「Medusa 用 service role key 連、bypass RLS」+ §8.x Railway 後台部署 + Medusa Admin UI URL 字面
  - **補(2026-05-07 / M-1-03 main-b sub-slice 5 simplify Q-5 Nit、對齊 PRD §10.1 D3 推遲指定收容處):** ADR-0003 §3.3-§3.5+§4 多處 Medusa 字面屬 D3 推遲範圍、已在 PRD §10.1 列「併 backlog #105 後續 docs slice」,具體擴範圍包含:
    - `docs/decisions/0003-domain-entity-naming.md` §3.3 ports 介面字面 example 段「Medusa wire 字串 leak」表述(屬 ADR 引用 wire 概念、語境為 Medusa-as-API pivot 時期遺留、ADR-0005 後該維持但補敘)
    - §3.4 wire 紀律 Medusa 引用、§3.5 example block `class MedusaProductAdapter implements IProductRepository`(reader copy-paste 風險)、§4 cross-context 命名表 Medusa 列
    - 對齊 ADR-0005 §7「9 衝突仍適用、wire 端改 Supabase」
- **觸發事件:**
  - 2026-05-07 M-1-03-a2-2 v3 Slice A1 起手 Code 讀 7 份必讀套件偵察揭示(對齊 Slice 0 v2 已揭示 backlog #100「全 catalog 表 §10.1 vs .sql drift」同方向、本條補揭示 PROJECT-OVERVIEW + tools-and-skills 同 trigger 連鎖、屬 ADR-0005 落地後文件同步遺漏)
- **預期解法:**
  - 獨立 docs slice 同步字面對齊 ADR-0005:
    - `docs/PROJECT-OVERVIEW.md` §3.1 monorepo 結構 + §3.2 技術棧 + §3.3「為什麼選這套」(Medusa v2 / Railway 段)
    - `docs/tools-and-skills.md` §1.2 busboy repo 參數 + §6.x Supabase 段(Medusa service role 字面)+ §8.x Railway 段(整節評估保留 / 重寫 / 刪除)+ §13 硬規則
  - 落點候選:M-0-09 docs sync follow-up / 或新 mini-slice 獨立做、與 backlog #100 全 catalog drift 同 trigger 合併處理可能更省工
- **不修會痛在:**
  - 擴充性:新 Code session 讀套件看舊 Medusa + Railway 字面、誤判技術棧、後續決策依舊字面走偏(例:設計 SupabaseProductAdapter 時誤以為要對齊 Medusa adapter pattern、或誤以為後台部署在 Railway)
  - 可維護性:ADR-0005 是頂層架構決策、PROJECT-OVERVIEW + tools-and-skills 是新 Code 套件入門必讀、不同步 = 規範新人困惑(雙軌真權威 ADR vs 套件入門無單一答案、CLAUDE.md「第一天起手檢查清單」9 份必讀引向不一致)
  - bug 可追蹤性:出現「為什麼 PROJECT-OVERVIEW 寫 Medusa 但 supabase-schema-design 寫 Supabase 直寫」追究、無單一錨點、需跨多檔對照才能釐清真權威
- **估時:** 30-45 min(獨立 docs slice 跑 PROJECT-OVERVIEW + tools-and-skills 字面同步)/ 60-90 min(與 #100 全 catalog drift 合併同 trigger 一起處理)
- **依賴:** ADR-0005 落地(已完成 / M-1-03-pre0c)
- **發現於:** 2026-05-07 / M-1-03-a2-2 v3 Slice A1 起手 Code 套件偵察
- **相關:** ADR-0005、M-1-03-pre0c、`docs/PROJECT-OVERVIEW.md` §3.1-§3.3、`docs/tools-and-skills.md` §1.2/§6/§8/§13、backlog #100(全 catalog 表 .sql vs 真權威 drift、同 trigger 連鎖揭示)

---

### #106. ✅ Supabase typed Database schema(supabase gen-types)— 解 adapter 雙 cast escape hatch

- **狀態:** ✅ 完成(2026-06-17 A 方向中型 code slice)。落地:① 生成 `packages/adapters/src/supabase/database.types.ts`〔`supabase gen types typescript --project-id bmpnplmnldofgaohnaok`、991 行 + 檔頭註記;⚠️ 反映 LIVE prod schema、db push bundle 未套用→不含 cart_session_id/webhook_events/4a-2 欄/5-param create_order,db push 後須重 gen〕② `client.ts` 兩 factory 注入 `SupabaseClient<Database>` generic ③ 6 個 supabase-js adapter client 欄位型別化 `SupabaseClient<Database>`〔.from/.select/.eq/.rpc 欄名/查詢/RPC 入參 compile 期檢〕④ customer/address/vehicle/wallet 4 mapper Row **derive 自 `Database['public']['Tables'][...]['Row']`**〔schema 改→重 gen→mapper 讀 row.xxx 即 compile 期抓 drift〕。**cast 消除實況**:19 雙 cast 中**消除 13**〔customer 3 / address 3 / vehicle 3 / wallet 4,4 adapter 完全 cast-free、含 wallet getBalance 2 inline cast〕;**保留 6**〔product 5 read + order 1 RPC〕為 rich-Json / RPC-Json 投射的**正當**邊界 cast〔products_public view 投射把 jsonb fitments→FitmentSpec[]/images→string[]/segments→string[] narrow 成 domain 形、create_order RPC `Returns: Json`→DTO,生成型別僅給 `Json`、無法 derive,皆 documented 非 type-safety 漏洞〕;另 product save 新增 1 documented `as products Insert` cast〔read products_public view nullable brand_id ↔ write base products NOT NULL 落差收斂〕。**意外揭示**:型別化 client 抓出手寫 `SupabaseProductRow.brand_id: string|null` 比 base 表 NOT NULL 鬆〔正是 #106 該抓的型別精度〕。三綠 typecheck/lint/build + 完整 vitest 1128〔零 runtime 變更、純型別+消 cast〕+ code-reviewer PASS。codex N/A〔非鐵則12:純型別、無金流/RLS/schema 行為變更〕。**follow-up**:db push 後重 gen database.types.ts、新表/欄才入型別。
- **分流:** P1-before-launch
- **優先級:** 🟡 低-中(不阻擋 main-b 落地、影響 type safety + 未來跨 adapter)
- **問題:**
  - SupabaseProductAdapter.findById 用 `data as unknown as SupabaseProductRow` 雙 cast bypass type safety(audit 三視角共識:engineering M1 + simplify Q4 + efficiency E7 同向命中)
  - 根因:supabase-js v2 `.from('products').select(...)` 預設返 `any` / generic 推不出 wire shape、需 `Database` generic 型 typed 才能避 cast
  - main-b sub-slice 2-4 + future Customer / Order adapter 都會撞同問題、雙 cast 模式跨 adapter 散
  - **補(2026-05-07 / M-1-03 main-b sub-slice 5 simplify R-3 Nit cumulative 確認):** 跨 5 callsite 雙 cast pattern 落地計數:findById(sub-slice 1)+ listByCategory(sub-slice 2)+ listByBrand(sub-slice 2)+ listByFitment(sub-slice 3)+ searchByKeyword(sub-slice 4)+ resolveCategoryId 私有 helper(sub-slice 2)= 6 處 escape hatch、本 #106 落地時可同時消除全部 cast、同時評估 mapRows helper 抽出(列表 method dup pattern)
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 1 雙 audit 抓出(engineering:code-review + simplify Phase 2 三 agent 共識);main-b sub-slice 5 cumulative 確認 6 callsite 範圍
- **預期解法:**
  - 跑 `supabase gen types typescript --linked > packages/adapters/src/supabase/database.types.ts` 生成 typed schema
  - 改 `client.ts` 用 `SupabaseClient<Database>` generic 注入
  - SupabaseProductAdapter / 未來 SupabaseCustomerAdapter / SupabaseOrderAdapter 全部受益、單 cast(或無 cast)即可
  - 替代:zod 在 adapter 邊界 runtime 驗(對齊 M-1-13 contract test slice 候選、雙保險)
- **不修會痛在:**
  - 擴充性:每個新 adapter / 新 method(sub-slice 2-4 listByCategory / listByBrand / listByFitment / searchByKeyword / save)都重複 `as unknown as XxxRow` 雙 cast、type safety escape hatch 散
  - 可維護性:supabase schema 改(加欄位 / 改型)、TypeScript 不擋、runtime 才炸;雙 cast 規避 strict 模式價值
  - bug 可追蹤性:wire row 結構錯(JOIN 缺欄位 / nullable 漏 check)只 runtime mapper throw、無 compile-time guard
- **估時:** 60-90 min(獨立 slice、含 gen-types CLI 跑 + client.ts 改 generic + adapter 改 cast + 重跑 typecheck + 驗 round-trip)
- **依賴:** Supabase project linked(已完成 / M-1-03-main-a1)、無其他依賴
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 1 雙 audit
- **相關:** `packages/adapters/src/supabase/SupabaseProductAdapter.ts:findById`、`packages/adapters/src/supabase/mappers/product.ts:SupabaseProductRow`、Q4(simplify)+ M1(engineering)+ E7(efficiency)三視角共識、未來 SupabaseCustomerAdapter / SupabaseOrderAdapter 受益

---

### #107. ⏳ parseWireFitment trailing tokens silent drop + 邊界 case 補強

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低(M-5 sync engine 啟動前必修、Phase 1 storefront 用不到 parseWireFitment)
- **問題:**
  - `packages/adapters/src/supabase/helpers/fitment.ts` parseWireFitment regex `/(\d{4})(?:-(\d{4})|(\+))?/` 只匹配第一個年份 token、後續 token 進 segments 但只取前 2 段為 motoBrand + modelCode
  - 範例 silent drop:`'Brand X 2018 Y'` → motoBrand='Brand'、modelCode='X'、yearStart=2018、yearEnd=undefined、'Y' silent drop
  - 範例 silent drop:`'Honda CBR1000RR-R 2024'` → 數字 1000 不被當年份(regex 需 4-digit)、modelCode='CBR1000RR-R' 對、但 'CBR1000RR-R' 含 4-digit 'CBR1' 失敗(實際 \d{4} 是 1000、會偽匹配 1000 為 yearStart;真實年份 2024 殘留 segments)
  - 範例 silent drop:`'YamahaCBR600RR2018-2024'` 無空格 → yearMatch='2018-2024'、remaining='YamahaCBR600RR'、motoBrand='YamahaCBR600RR'、modelCode=''
  - 範例 silent drop:多 4-digit token(model 本身含 4-digit 如 'CB1000R 2024')→ 第一個 \d{4} 匹配 model 數字段、年份段失準
  - 來源:M-1-03-main-b sub-slice 3 雙 audit engineering:code-review CR-1(Major)
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit 抓出
- **預期解法:**
  - M-5 sync engine 啟動前實測廠商真實報價單 wire format、收集 30+ 樣本範圍
  - 強化 regex:從尾端取 4-digit 年份段(避免 model 數字干擾)、或 model + year 用明確分隔符規範
  - 補 fitment.ts unit test:覆蓋 `'Brand X 2018 Y'`、`'CB1000R 2024'`、無空格、多空格、缺年份等 8-10 case
  - 替代方案:wire format 上游規範化(廠商報價單轉檔時加分隔符 / 結構化 csv)、parseWireFitment 簡化
- **不修會痛在:**
  - 擴充性:M-5 sync engine 上架時實測廠商輸入 silent drop、import 後 fitment 缺 token 客人「找不到我的車」抱怨
  - 可維護性:JSDoc @example 不涵蓋邊界、reader 不知 silent drop 條件、改邏輯時無 test 驗
  - bug 可追蹤性:silent drop 無 log、客人投訴「2024 年份配件查不到」reproduce 困難、需 grep 整段 wire string + regex 追蹤
- **估時:** 60-90 min(M-5 sync engine spike slice 內附帶 + 8-10 test case)
- **依賴:** M-5-03 sync engine 廠商輸入解析啟動、廠商真實報價單樣本 30+
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit
- **相關:** `packages/adapters/src/supabase/helpers/fitment.ts:parseWireFitment`、CR-1(engineering:code-review Major)、#95 case-sensitivity normalize(同 M-5 sync engine 範圍)、ADR-0004 wrs Q1=A1(自由字串)

---

### #108. ⏳ fitment helpers + matchFitmentYear 行為等價 contract test 補

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟡 低(M-1-13 storefront ProductPage / FilterSide 啟動前必修)
- **問題:**
  - `packages/adapters/src/supabase/helpers/fitment.ts` 三 public helper(fitmentToWireString / parseWireFitment / matchFitmentYear)無對應 .test.ts
  - JSDoc @example 是文檔不是 executable 驗證、未來改邏輯無 test 抓 silent regression
  - matchFitmentYear 與 InMemoryProductRepository.matchFitment 規則 3 行為等價但無 cross-adapter contract test 證明
  - 來源:M-1-03-main-b sub-slice 3 雙 audit simplify R1 + Q1
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit 抓出
- **預期解法:**
  - 建 `packages/adapters/src/supabase/helpers/fitment.test.ts`(對齊 in-memory __tests__ 結構)
  - test cases:
    - fitmentToWireString 4 種 yearEnd 狀態 round-trip + 空段過濾 + trim
    - parseWireFitment regex 邊界(納入 #107 8-10 case)
    - matchFitmentYear 對齊 InMemoryProductRepository.matchFitment year-range 4 既有 it.todo case + #93 8 boundary case
  - 跨 adapter 行為等價驗:同 input 走 InMemory.matchFitment(rule 3 部分)+ Supabase.matchFitmentYear、output 一致
  - **(2026-05-07 / sub-slice 3 補強)補 SDK regression sub-task:** SupabaseProductAdapter.listByFitment 內 `.contains('fitments', JSON.stringify([{...}]))` workaround 字面對齊真權威 jsonb @>(supabase-schema-design.md §10.2);test 走真 Supabase / supabase local 跑 round-trip、防 supabase-js 升版/重構不小心改回 array 直傳(commit 9d8ef93 揭示 array 直傳會撞 PG 22P02);對齊 sub-slice 3 雙 audit code-review #4 finding
- **不修會痛在:**
  - 擴充性:M-1-13 ProductPage 顯示用 fitmentToWireString、format 改動無 test 抓 silent regression、storefront 顯示錯字面
  - 可維護性:reader 改 matchFitmentYear 邏輯、無 test 驗等價性、InMemory 跟 Supabase silent drift
  - bug 可追蹤性:cross-adapter 行為不一致時、客人投訴「同 product 兩 adapter 行為不同」debug 成本高、無 contract test 證明
- **估時:** 30-45 min 原(+ ~15 min SDK regression sub-task = 45-60 min 含補強範圍、M-1-13 啟動前獨立 slice)
- **依賴:** #107(parseWireFitment 邊界補強)、#93(matchFitment 8 boundary case test)
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit(simplify R1 + Q1);sub-slice 3 補強 SDK regression(雙 audit code-review #4)
- **相關:** `packages/adapters/src/supabase/helpers/fitment.ts`、`packages/adapters/src/in-memory/InMemoryProductRepository.test.ts`、`packages/adapters/src/supabase/SupabaseProductAdapter.ts:listByFitment`(SDK literal regression test 補強範圍)、#93、#107、M-1-13 ProductPage 啟動前、commit 9d8ef93(SDK 字面修)

---

### #109. ⏳ matchFitmentYear / matchFitment 規則 3 行為 dup — Defer(2 處、第 3 處撞才抽)

- **狀態:** ⏳ Defer(達 2 處、第 3 處撞才抽 trigger 對齊 sub-slice 1+2 listByColumn / unwrapSingle Defer 模式)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察
- **問題:**
  - `packages/adapters/src/supabase/helpers/fitment.ts` matchFitmentYear(規則 3 年份範圍重疊)
  - `packages/adapters/src/in-memory/InMemoryProductRepository.ts` matchFitment(規則 1+2+3 全跑、規則 3 內嵌)
  - 規則 3 字面接近但不完全 identical:InMemory matchFitment 含規則 1+2 motoBrand+modelCode + 規則 3 年份;Supabase matchFitmentYear 只規則 3
  - 兩處共用 resolveEnd helper、行為等價、但 5 行 yearStart undefined check + 2 resolveEnd + range comparison 仍各寫一份
  - 來源:M-1-03-main-b sub-slice 3 雙 audit simplify Q1(Major)
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit Q1 抓出、達 2 處 Defer
- **預期解法(第 3 處撞才抽):**
  - InMemory.matchFitment 內聯 motoBrand+modelCode check 後 delegate matchFitmentYear(InMemory 跨 import @pcm/adapters/supabase/helpers/fitment 同 package 內可、但 architectural awkwardness)
  - 替代:matchFitmentYear 移 packages/domain/src/catalog/year-range.ts 與 resolveEnd 同檔(純 logic、跨 adapter neutral)、PRD §5.5 字面 path drift 揭示
  - 第 3 處撞 trigger:加 GraphQL adapter / API mock adapter / FE-only adapter 重複規則 3 字面、即抽
- **不修會痛在:**
  - 擴充性:第 3 個 adapter 出現時雙寫漂移風險(規則 3 邏輯 silent drift)
  - 可維護性:resolveEnd 改三狀態語意(rare)需同步兩處
  - bug 可追蹤性:cross-adapter 行為不一致時 debug 成本(由 #108 contract test 緩解)
- **估時:** 15-30 min(第 3 處撞時 / matchFitmentYear 移 domain + adapter 改 import + JSDoc 對齊)
- **依賴:** 第 3 個 adapter 出現
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 3 雙 audit
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts:matchFitment`、`packages/adapters/src/supabase/helpers/fitment.ts:matchFitmentYear`、`packages/domain/src/catalog/year-range.ts:resolveEnd`、Q1(simplify)、Defer 模式對齊 #84 / #85 / sub-slice 1+2 listByColumn / unwrapSingle

---

### #110. ⏳ searchByKeyword count: 'exact' → 'planned'/'estimated' 切換(M-6 tsvector 同期)

- **狀態:** ⏳ 待執行(M-6 切 tsvector + GIN + pg_jieba 同期、不獨立啟動)
- **分流:** P1-before-launch
- **優先級:** 🟡 低(Phase 1 200 SKU dev 可接受、上線前必修)
- **問題:**
  - SupabaseProductAdapter.searchByKeyword 用 `count: 'exact'` 每次 query 強制 PG 對 result set 做 full count
  - 200 SKU Phase 1 可接受、5w SKU production 規模會撞 latency budget
  - count 唯一用途 = UI 顯示 total 頁數、不需要 row-precise(±10% 可接受)
  - 來源:M-1-03 main-b sub-slice 4 雙 audit simplify E2(Medium)
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 4 雙 audit 抓出
- **預期解法:**
  - M-6 切 tsvector + GIN + pg_jieba slice 同期、改 `count: 'planned'`(query planner estimate)或 `count: 'estimated'`(table stats estimate)
  - 替代:UI 改顯示「N+ 筆」(估計值)、不顯示精確總頁數
  - JSDoc TODO 在 searchByKeyword 已預告 M-6 切換、本條 backlog 補 count 子項對齊
- **不修會痛在:**
  - 擴充性:5w SKU 撞 search latency p99 budget、tsvector 切換時 count 仍跑 full scan
  - 可維護性:M-6 切換 slice 漏改 count 字面、upgrade 後性能不如預期
  - bug 可追蹤性:Phase 1 客人投訴「搜尋慢」、無 trigger pointer 找 count 元凶
- **估時:** 5-10 min(M-6 切 tsvector slice 內附帶、單字面修正)
- **依賴:** M-6-08 上線前 checklist + Supabase Pro(對齊 ADR-0004 Q3=A1 + security-timeline #F6)
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 4 雙 audit
- **相關:** `packages/adapters/src/supabase/SupabaseProductAdapter.ts:searchByKeyword`、IProductRepository.searchByKeyword JSDoc 兩階段、ADR-0004 Q3=A1、supabase-schema-design.md §2.5、E2(simplify Medium)

---

### #111. ⏳ parseCategoryPath helper orphan 風險 + JSDoc trigger 字面修

- **狀態:** ⏳ 待執行 / 🟢 觀察(0-caller、未撞 trigger)
- **分流:** P1-now
- **優先級:** 🟡 低
- **問題:**
  - `packages/adapters/src/supabase/helpers/category-path.ts` parseCategoryPath helper(sub-slice 2 落地)目前 0 caller
  - JSDoc 自承「落地後暫無 importer ... save 落地時 import」、但 sub-slice 4 save 已落地、走 resolveCategoryId(raw_path UNIQUE query)不解析 segments、parseCategoryPath 仍無 importer
  - 風險:預先抽象 vs 真 trigger 模糊、helper 0-caller 累積 → JSDoc/實況 drift、後人讀 helper 不知何時可刪
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 5 雙 audit / simplify R-1 Minor
- **預期解法:**
  - 候選 A:JSDoc trigger 字面改「M-1-16 seed slice 啟動時 import」(現字面「save 落地時 import」誤導)、確保 trigger 點明確、5-10 min(輕量字面修)
  - 候選 B:M-1-13 ProductPage / FilterSide 啟動前再評,若 seed slice 也走 raw_path UNIQUE 不解析 segments、考慮刪 helper 等真正 trigger
  - 候選 C:M-1-16 seed slice 啟動時實測「name + segments」結構對 import 是否必要、對齊 supabase-schema-design.md §4.3「處理「·」與全形空格分隔」實作落點
- **不修會痛在:**
  - 擴充性:0-caller helper 累積、未來 audit 不知 helper 是「待用」還是「廢棄」
  - 可維護性:JSDoc 字面「save 落地時 import」與實況偏離(sub-slice 4 save 不用)、reader 困惑
  - bug 可追蹤性:0-caller 不會被測、若 silent regression 沒 test 抓
- **估時:** 5-10 min(候選 A 輕量字面修)/ 30-45 min(候選 B+C 實測 + 決策刪/留 + 對齊 supabase-schema-design.md §4.3)
- **依賴:** M-1-13 storefront ProductPage / FilterSide 啟動 / M-1-16 seed slice 啟動
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 5 雙 audit
- **相關:** `packages/adapters/src/supabase/helpers/category-path.ts:parseCategoryPath`、supabase-schema-design.md §4.3、R-1(simplify Minor)

---

### #112. ✅ PRD M-1-03-main-b §8 第 4 條 @TODO 字面 vs sub-slice 5 Code 字面偏離 PRD 同步

- **狀態:** ✅ 完成 2026-06-16(PRD §8 L228 LRU TODO 改「未在 sub-slice 4 落地、改依 #84/#85 Defer、見 adapter JSDoc L97」對齊落地;同批 doc-drift)
- **分流:** P1-before-launch
- **優先級:** 🟡 低(commit body 已揭示偏離、PRD 字面同步留 trigger)
- **問題:**
  - `docs/specs/M-1-03-main-b-PRD.md` §8 第 4 條 @TODO 字面:「@TODO brand / category resolve cache:LRU cache 名稱→ID(本 main-b sub-slice 4 落地)」
  - sub-slice 5 SupabaseProductAdapter.ts class JSDoc 第 4 條 @TODO 落地揭示:「LRU cache 抽出待第 3 處撞才抽 trigger(對齊 lessons #84/#85 Defer 模式)、Phase 1 dev 200 SKU 規模 round-trip 開銷可接受」
  - 偏離:PRD 說「sub-slice 4 落地 LRU cache」、Code 說「Defer 至第 3 處撞」、未在 PRD §10.2「預期偏離」標註
  - 鐵則 11「字面 vs 事實守則」:sub-slice 5 commit body 已揭示偏離、但 PRD 字面未同步
- **觸發事件:**
  - 2026-05-07 / M-1-03 main-b sub-slice 5 雙 audit / simplify Q-4 Minor
- **預期解法:**
  - 候選 A:PRD §8 第 4 條 inline 標註「(註:sub-slice 5 落地依 lessons #84/#85 Defer 模式、改 LRU cache 待第 3 處撞 trigger;見 SupabaseProductAdapter.ts class JSDoc)」
  - 候選 B:PRD §10.2「預期偏離」加第 4 條「§8 第 4 條 @TODO 字面落地時調整為 Defer 模式」+ §11 變更紀錄補一行
  - 候選 C:main-c 啟動前 PRD 大版本更新時一併處理(順 main-c 帶)
- **不修會痛在:**
  - 擴充性:PRD = 規格藍圖、Code = 實作、兩者字面偏離未揭示違反鐵則 11
  - 可維護性:後續 audit 對齊 PRD §8 vs Code 字面時誤判 drift
  - bug 可追蹤性:PRD 變更紀錄未記、未來 reader 對照 PRD §8 vs Code 困惑
- **估時:** 5 min(候選 A inline 標註)/ 10 min(候選 B §10.2 + §11 加條)
- **依賴:** main-b sub-slice 5 落地後(本條目寫入時)
- **發現於:** 2026-05-07 / M-1-03 main-b sub-slice 5 雙 audit
- **相關:** `docs/specs/M-1-03-main-b-PRD.md` §8 + §10.2 + §11、`packages/adapters/src/supabase/SupabaseProductAdapter.ts` class JSDoc 第 4 條 @TODO、Q-4(simplify Minor)、鐵則 11

---

### #113. ✅ 後台 products 表 brand_id + category_id 改 NOT NULL(B1 schema 對齊 domain 必填)

- **狀態:** ✅ 完成(2026-05-07 / M-1-03-main-c drift-fix)
- **優先級:** 🟠 中(已解決)
- **問題:**
  - schema §2.1 `brand_id` + `category_id` 無 NOT NULL = schema 允許 nullable
  - wire `SupabaseProductRow`(`packages/adapters/src/supabase/mappers/product.ts:L56-57`)顯式 nullable(`brand_id: string | null` / `category_id: string | null`)
  - mapper L78-80 + L81-83 兩處 `throw new Error('Product ... missing brand/category JOIN')`(資料完整性違反、不 silent ignore)
  - domain `Product.brand: Brand` + `Product.category: CategoryPath` 必填(non-nullable、catalog/types.ts:L120-149)
  - 四角字面在 nullable 行為設計層 drift
- **觸發事件:**
  - 2026-05-07 / M-1-03-main-c sub-slice 2 reconnaissance Step 1 字面確認後揭示 C5 字面 vs 事實偏離(指令字面 C5「不 throw」vs mapper L81-83 真實 throw 字面)
  - Sean Q1=A1 拍板揭示 + cross-check 揭示 brand_id 同類對稱
  - Sean 推翻 main-c sub-slice 2 raise B4 推遲方向、拍板「資料有缺就擋下、不准存」業務直覺、走 B1 schema NOT NULL 從根本解
- **解法落點:** 本 commit hash(本 slice 落地)
  - `supabase/migrations/20260507222633_products_brand_category_not_null.sql`:`ALTER TABLE products ALTER COLUMN brand_id` + `category_id` `SET NOT NULL`
  - 預檢 SELECT NULL count = 0(Step 1)、ALTER 安全
  - 驗證 `column is_nullable='NO'` 兩欄(Step 4)+ INSERT 漏填 `ERROR 23502 null value in column "brand_id" of relation "products" violates not-null constraint`(Step 5、BEGIN/ROLLBACK 不持久化)
  - migration record 寫入 `supabase_migrations.schema_migrations` 第 4 條 `20260507222633 / products_brand_category_not_null`
- **不修會痛在(已解決前):**
  - 擴充性:M-1-13 ProductPage 啟動時若 schema 有 NULL row、findById 全 throw、客人看不到該 product
  - 可維護性:schema/wire/mapper/domain 四角字面不一致、新進開發看 mapper throw 困惑為何 schema 允許 NULL
  - bug 可追蹤性:M-1-16 種子資料若漏填 brand/category、上線後 findById 炸、log 才追到 mapper 邊界
- **估時:** 實際 ~10-15 分鐘
- **依賴:** 無
- **發現於:** 2026-05-07 / M-1-03-main-c sub-slice 2 reconnaissance(Step 1 真權威字面確認後)
- **相關:** `supabase/migrations/20260507222633_products_brand_category_not_null.sql`、`docs/architecture/supabase-schema-design.md` §2.1(原寫無 NOT NULL、字面修留 docs sync slice 統一處理對齊 D3 推遲精神)、`packages/adapters/src/supabase/mappers/product.ts:L56-57+L78-83`(wire type + mapper throw 字面、留 #106 typed Database schema gen-types 落地時自動對齊)、#106(雙 cast)、#100(全 catalog drift)、#105(docs sync)、ADR-0003 §3.5、ADR-0005 §7
- **Phase 2 例外考量:** 廠商報價單匯入「待審商品候選」可能還沒對應 PCM 分類/品牌、屆時用獨立的 `product_candidates` 表 / 或 `product_status='pending'` 欄位區隔、不影響正式 products 表 NOT NULL 規則(對齊 PHASE-2-VISION #1 + Sean 拍板「Phase 2 PRD 一起想」)

---

### #114. ⏳ Vehicle Finder 通用零件呈現策略待拍板

- **狀態:** ⏳ 待 trigger
- **分流:** P1-now
- **優先級:** 🟡 中(M-1-13 啟動時必拍)
- **問題:**
  - 客人在 Vehicle Finder 選了車型後、**通用零件**(`fitments=[]` 空陣列、代表任何車適用)要不要出現在篩選結果頁?
  - 當前 SupabaseProductAdapter.listByFitment server-side `.contains('fitments', JSON.stringify([{motoBrand, modelCode}]))` 對 empty fitments=[] 直接 false、通用零件不在篩選結果(對齊 main-c spike C6a 行為驗 PASS);**業務拍板未定**、客人 UX 體驗不一致
- **三選項並列(Sean M-1-13 啟動時拍):**
  - **A.** 結果含通用零件(客人選 R1 → 結果頁同時看到 R1 專用 + 通用配件)
  - **B.** 結果只含專用、通用另闢入口(分類頁 / 商品列表頁有「通用配件」獨立入口)
  - **C.** Vehicle Finder 加「通用 / Universal」車款選項(三層篩選旁多一個按鈕、客人主動選看通用)
- **觸發事件:**
  - 2026-05-07 / M-1-03-main-c sub-slice 2 spike C6 empty fitments 驗證後 Sean raise UX 業務拍板需求
  - 推遲到 M-1-13 商品列表頁 + Vehicle Finder UI 啟動時資訊更全再拍(現預設行為 = B 選項)
- **預期解法:**
  - 依 design 真權威 ProductsPage filterProducts string match 邏輯對齊(目前 design 字面通用零件 fits='通用款'、客人選具體車型不會出現 = 等同選項 B)
  - 或 Sean 拍板改 A:adapter listByFitment client filter 加 `||fitments.length===0`(含通用)
  - 或 Sean 拍板改 C:Vehicle Finder UI 加新按鈕 + adapter 新方法 listUniversal()(返 fitments=[] 商品)
- **不修會痛在(三視角):**
  - 擴充性:M-1-13 Vehicle Finder UX 啟動時、通用零件呈現策略影響商品列表頁結構 + 客人選購流程 + adapter listByFitment / listUniversal 方法切割
  - 可維護性:不拍板 = 工程師三選一憑感覺實作 / 改 design 真權威 / 留兩種行為實作交織、後續 bug fix 沒有共識基準
  - bug 可追蹤性:不拍 = 客人投訴「為什麼選 R1 看不到/看到通用配件」客服回應方向不一致、影響業務口徑
- **估時:** 30-45 min(M-1-13 啟動時拍板 + 設計確認)+ 0-60 min(本身工程修改視策略 A/B/C、A=15 min adapter / B=0 min 對齊既有 / C=30-60 min 新方法 + UI 入口)
- **依賴:** M-1-13 ProductPage / FilterSide / Vehicle Finder UI 啟動時觸發
- **發現於:** 2026-05-07 / M-1-03-main-c sub-slice 2 spike C6 empty fitments 驗證後 Sean 業務 raise
- **相關:** `design-reference/` ProductsPage filterProducts string match 邏輯、`packages/adapters/src/supabase/SupabaseProductAdapter.ts:listByFitment`、Phase 2 vehicle ecosystem PRD `docs/features/vehicle-service-ecosystem.md`

---

### #115. ⏳ SupabaseProductAdapter listByFitment filter-before-map hot path 優化

- **狀態:** ⏳ 待 trigger
- **分流:** P1-now
- **優先級:** 🟡 中(M-1-13 啟動時改、Phase 1 ~200 SKU 規模目前 OK)
- **問題:**
  - 當前 `SupabaseProductAdapter.listByFitment`(L177-189)先 map 全部 server-side prefilter row → domain Product[]、再 client filter cross-check brand+model+year
  - hot path 應 filter row 在 map 前(`data.filter(rawRowCrossCheck).map(mapSupabaseProductToDomain)`)、減少不必要 mapper 工作(server-side `.contains` 通過 row 數 vs 通過 client cross-check 的差距 = 跨車型 false-positive 範圍)
  - Phase 1 ~200 SKU dev 規模 mapping 全部 row 開銷 negligible;5w SKU production 規模 mapping cost 撞 latency budget
- **觸發事件:**
  - 2026-05-07 / M-1-03-main-c sub-slice 3 雙 audit 共識(simplify E-1 + engineering:code-review #5 雙視角命中)
- **預期解法:**
  - 重排 listByFitment 內部:`(data as unknown as SupabaseProductRow[]).filter(row => row.fitments.some(f => f.motoBrand===spec.motoBrand && f.modelCode===spec.modelCode && matchFitmentYear(f, spec))).map(mapSupabaseProductToDomain)`
  - 範圍純 listByFitment method 內、不影響其他 method
  - 補 contract test 一個 perf 觀察 case(可選、對齊 #108 fitment helpers contract test 範圍)
- **不修會痛在(三視角):**
  - 擴充性:5w SKU 規模 mapping 全部 row 撞 ProductPage 首頁列表 latency budget(p99 < 500ms 預期)
  - 可維護性:hot path 邏輯應 filter-before-map、reader 看到先 map 後 filter 困惑為何不是反過來
  - bug 可追蹤性:production 真實流量打入後 latency 監控才看到、非單元 test 抓得到
- **估時:** 15-30 min(method 內重排 + 跑 spike 驗 round-trip 仍 PASS + 補 contract test 一個 perf 觀察 case)
- **依賴:** M-1-13 storefront ProductPage 啟動 trigger / 或 200+ SKU 種子資料規模 trigger / 或 #108 fitment helpers contract test 落地時順手
- **發現於:** 2026-05-07 / M-1-03-main-c sub-slice 3 雙 audit(simplify E-1 + engineering:code-review #5)
- **相關:** `packages/adapters/src/supabase/SupabaseProductAdapter.ts:listByFitment`、#108(fitment helpers contract test)、#106(typed Database schema)、M-1-13 ProductPage hot path readiness、commit 2e9abfb(cross-車型 false positive 修)

---

### #116. ⏳ server-client boundary 優化:純展示 sections 改用 next/link

- **狀態:** ⏳ 待 trigger
- **分流:** P1-before-launch
- **優先級:** 🟡 中(Phase 1 Polish)
- **問題:**
  - main-d-d1 階段 design 真權威字面**全 8 sections 都含 onNav callback prop**(L25 HomeHero / L131 FeatureEditorial / L174 CategoryGrid / L210 HomeSelect / L245 HomeStatement / L277 BrandIndex / L311+ HomeFooter)
  - Next.js 16 RSC 規矩**不可從 server component 傳 function prop 給 client component**(server-client boundary 字面限制)
  - 本 slice 維持全 'use client'(對齊 d1 指令 Step 4.1「className / onClick / onNav 字面維持」精神 + lessons §1.1「直接搬」)
  - hydration 成本:8 sections + Header + ProductCard 都 client、Phase 1 ~200 SKU 規模可接受、未來規模擴張可能撞 first-load JS budget
- **觸發事件:**
  - 2026-05-08 / M-1-03-main-d-d1 commit body 註記 8 揭示偏離 + Sean Q2=B1+B3 拍板留 backlog
- **預期解法(M-1-04 trigger 順手評估):**
  - **候選分流:** 純展示 sections(無 onClick / 無 useState 互動)→ 改 server component + `<Link href>` 取代 onNav callback
    - HomeHero / FeatureEditorial / HomeStatement / HomeFooter / CategoryGrid / BrandIndex(純展示、僅 onNav)→ 改 Link
    - VehicleFinder / Header / ProductCard(含互動 useState / window dispatchEvent / hover state)→ 維持 'use client'
  - 配 `Link.prefetch`、降首頁 hydration 成本 + 提升路由切換速度
  - 拆「server with Link」vs「client with onNav」雙路徑、需 boundary 文件化(可能加 ADR-0006 / docs/architecture/server-client-boundary.md)
- **不修會痛在(三視角):**
  - 擴充性:M-1-04+ 接 next/navigation router 後 onNav callback → router.push、保留全 client 浪費 RSC 機會、規模擴張後 first-load JS 上升
  - 可維護性:全 client 簡單一致、改混合模式增加 boundary 認知負擔、需文件化 + e2e 驗 hydration mismatch
  - bug 可追蹤性:hydration mismatch 風險、改 Link 後需配 e2e test 驗 router 行為
- **估時:** M-1-04 接 next/navigation router 時順手評估、實際遷移 30-60 min(6 sections × ~5-10 min + 配 Link.prefetch + e2e 驗)
- **依賴:** M-1-04 接 next/navigation 真 router(目前 onNav 是 console.log stub)
- **發現於:** 2026-05-08 / M-1-03-main-d-d1(commit body 註記 8、Sean Q2=B1+B3 拍板)
- **相關:** `apps/storefront/src/components/{HomeHero,FeatureEditorial,HomeStatement,HomeFooter,CategoryGrid,BrandIndex}.tsx`(候選改 Link)、`{VehicleFinder,Header,ProductCard}.tsx`(維持 client)、d1 指令 Step 4.1 字面維持精神 + lessons §1.1 直接搬精神 + Next.js 16 RSC server-client boundary

---

### #117. ⏳ id NaN cast 故障鏈 anchor — string ProductId → number 串接(audit 雙命中)

- **狀態:** ⏳ 待執行
- **分流:** P1-now
- **優先級:** 🟠 中(NaN 路徑只在 Supabase 0 row → mock fallback 落地時 hit、M-1-16 種子前需修;真資料模式下 mock fallback 路徑廢、視 ProductPage M-1-13 啟動再評)
- **問題:**
  - `apps/storefront/src/lib/products.ts:77` `id: product.id as unknown as number` 把 string ProductId cast 成 number(MockProduct.id 字面 number)
  - `apps/storefront/src/components/ProductImage.tsx:50-52` `PRODUCT_IMG_POOL[seed % n] ?? ''` 若 seed === NaN → NaN % n = NaN → array index NaN → undefined → '' → broken
    (⚠️ **2026-08-12 拆檔後座標更正**:原寫 `ProductCard.tsx:34-42`,該段已整組搬到 `ProductImage.tsx`、程式碼逐字未變) URL
  - `apps/storefront/src/components/ProductCard.tsx:141` `seed={p.id}` 三處字面互關(page L65 `data-tier` + ProductCard **L141** + lib L77)、debug 鏈未明示
    (⚠️ **2026-08-12 拆檔後座標更正**:呼叫點仍在 `ProductCard.tsx`、但由 L129 位移至 **L141**;被呼叫的 `ProductImage` 本體已搬到 `ProductImage.tsx`)
- **觸發事件(任一觸發即啟動實作):**
  - M-1-13 ProductPage 啟動前(ProductCardProps 真改造時機)
  - M-1-16 種子前(0 row fallback 路徑廢之前)
- **預期解法:**
  - ProductCardProps.p.id 接 string(對齊 domain ProductId)
  - ProductImage seed 改 hash 函式(string → number 確定性映射、避免 NaN)
  - 三處字面 debug 鏈 JSDoc 連結(page L65 / ProductCard L129 / lib L77)
- **不修會痛在:**
  - 擴充性:M-1-13 ProductCardProps 真改造時必撞、現在不修留三處字面 drift
  - 可維護性:NaN 故障鏈三處字面散落、debug 時需多處交叉比對
  - bug 可追蹤性:NaN propagation 路徑(eng-1 root cause → eng-8 NaN 傳播 → simp-12 三處字面散落)、Phase 1 0 row 路徑下 hit
- **估時:** 30-45 min
- **依賴:** M-1-13 ProductPage 啟動前(對齊 ProductCardProps 真改造時機)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d 雙 audit 命中(eng-1 + eng-8 + simp-6 + simp-12)、本對話 sub 8c Q1=A1 拍板 skip 撤回(sub 8d findings 揭示有實質內容可填、anchor 化比缺號空白更有 trace value)
- **相關:** `docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` eng-1 / eng-8 / simp-6 / simp-12 + `apps/storefront/src/lib/products.ts:77` + `apps/storefront/src/components/ProductCard.tsx:34-42` + `apps/storefront/src/components/ProductCard.tsx:129` + `apps/storefront/src/app/page.tsx:65` + d2 commit body「id cast trade-off 揭示」

---

### #118. ✅ SupabaseProductAdapter 6 method 切換讀 products_public view

- **狀態:** ✅ 完成
- **完成於:** 2026-05-16 / M-1-05 刀 2 Sub-slice 2-3 完工(commit `650279a`、Sean A 拍板「5 read method 全切 products_public detail view、避免 list view 9 欄不足組 Product entity」)
- **實際解法 vs 原預期解法:**
  - 原預期:6 method 切 view + InMemory 對齊 view 形狀 + contract test 加 case
  - 實際:5 read method 切 products_public detail view(A 拍板)、save 維持 base 表雙寫、InMemory 維持 ADR-0002 真實作精神不對齊 view 形狀(Sub-slice 2-4 B 拍板)、contract test 接線 #143 independent milestone(空殼揭示)
  - 偏離理由:list view 9 欄不足組完整 Product entity(無 description / images / created_at / updated_at)、A 拍板「都用 detail view、誠實 mapper、零假資料」
- **依賴消除:** 雙寫過渡期穩定後評估 NOT NULL + 退場 price_by_tier jsonb(M-2-08 IPricingService anchor)
- **(原狀態保留以下記錄)**
- **狀態(原):** 🔴 立即啟動(刀 4 sub 7 公式 dispatch 落地、sub 8c 重評確認 trigger 條件已熟、隨時可啟動)
- **優先級:** 🟠 中(M-1-16 種子前必修、種子上線後 storefront 仍走 base products 表 = 經銷價洩漏)
- **問題:**
  - slice-A 已建 products_public view 排除 price_by_tier
  - 但 SupabaseProductAdapter 6 method(findById / searchByKeyword / listByFitment / listByCategory / listByBrand / save)仍讀 base products 表
  - storefront 端目前靠 main-d-d2 application 層 priceByTier strip 防線、若漏 strip 仍洩
  - 切到 view 後、防線下沉到 DB 層、application 層 strip 為輔助而非主防線
- **觸發事件:**
  - 2026-05-10 / M-1-03-audit Slice A 完成 view、留接縫待 adapter 切換
- **預期解法:**
  - SupabaseProductAdapter 6 method 全切到 `.from('products_public')`
  - InMemoryProductRepository 同步調整(testing 對齊 view 形狀、不回 priceByTier)
  - 對應 contract test 加 case「products_public view 不回 price_by_tier」
- **不修會痛在:**
  - 擴充性:Phase 2 加分類頁 / 品牌頁、application 層漏 strip 機率上升、view 防線下沉前每頁都要重做
  - 可維護性:防線散兩層(adapter + application strip)、未來 review 不易定位
  - bug 可追蹤性:洩漏時不知道是 adapter 漏 view 還是 application 漏 strip
- **估時:** 60-90 min(6 method 切換 + InMemory 對齊 + contract test 補)
- **依賴:** 刀 4 storefront 公式 dispatch 落地後配合切(原 M-1-16 種子前 anchor、修正為 view 切配合 priceByTier strip 路徑落地時機;單獨切 view 會撞 mapper priceByTier 三 tier 設計意圖、2026-05-12 / M-1-03-main-a 刀 2 偵察揭示)
- **發現於:** 2026-05-10 / M-1-03-audit Slice A audit follow-up(slice-A-fix amend 開立)
- **trigger 重評於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8c(刀 4 sub 7 storefront 公式 dispatch 落地、依賴條件成立、改 ⏳ → 🔴)
- **相關:** `supabase/migrations/20260510134708_products_public_view.sql`、ADR-0003 §C2 RLS column-level、`docs/architecture/supabase-schema-design.md` §6.1 / §9.2

---

### #119. ✅ products_public view 拆分:list-projection vs detail-projection

- **狀態:** ✅ 完成
- **完成於:** 2026-05-16 / M-1-05 刀 2 Sub-slice 2-2 完工(commit `f7f72fc`、提前因 #118 mapper 處置強耦合、同 M-1-05 完成)
- **實際解法 vs 原預期解法:**
  - 原預期:拆 list view 排除 description / fitments / 取 images[0]、findById 維持 detail view、4 list method 切 list view
  - 實際:list view 已建(products_list_public 9 欄、含 fitments、含 price_general、排除 description / images / price_by_tier / price_store / metadata / external_id / timestamps)、但 adapter 5 method 全切 detail view(A 拍板字面、避免 list view 9 欄不足組 Product entity)、list view 暫擺著等未來 sub-slice 接線
  - 偏離理由:
    - fitments 由「排除」改「含」:Sean 拍板「fitments=A 露」(Vehicle Finder + toUIProduct 讀 fitments[0]、不露會破壞既有 UI)、migration 20260516072210 檔頭字面紀錄
    - images 由「取 [0]」改「完全排除」:Sean 拍板「images=A 不露」(toUIProduct 不讀 product.images、ProductCard 走 Unsplash by seed、露了 over-fetch 零價值)
    - adapter 5 method 全切 detail view(非「4 list 切 list」):同 #118 完成 Resolution、A 拍板字面、list view 9 欄不足組 Product
- **依賴消除:** 分類頁 / 品牌頁 milestone 啟用前(M-2-XX、原依賴條件)由本刀提前完成
- **trigger 重評於:** 2026-05-16 / M-1-05 刀 2 Sub-slice 2-2 mapper 處置耦合(spike §5 揭示與 #118 強耦合、同 M-1-05 完成)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **優先級:** 🟢 低(Phase 1 規模(M-1-16 200 SKU)可接受、規模長大才痛)
- **問題:**
  - 目前 products_public view 投射 description / images / fitments 三 jsonb 全字段
  - list 頁 query(50 SKU)實測 ~7KB jsonb / row × 50 = ~350KB / query
  - 實際 list 卡片只需 ~50KB(title / handle / images 第 1 張縮圖)
  - 7x over-fetch、Phase 1 規模可接受、分類頁 / 品牌頁啟用後痛
- **觸發事件:**
  - 2026-05-10 / M-1-03-audit Slice A audit follow-up / simplify D5 finding
- **預期解法:**
  - 拆 `products_list_public` view(僅 list 必需欄位、排除 description / fitments / 取 images[0])
  - 維持 `products_public` view(detail 用、全公開欄位)
  - adapter listByCategory / listByBrand / searchByKeyword 切到 list view
  - adapter findById 維持 detail view
- **不修會痛在:**
  - 擴充性:分類頁 / 品牌頁啟用後 query 變慢、客戶體驗下降
  - 可維護性:現在不拆、未來拆需動 adapter 多 method 切換、commit 跨多檔
  - bug 可追蹤性:慢 query 來源易定位、但 view 不分時要 join 多 query 才能優化
- **估時:** 30-45 min(2 view DDL + adapter 對應切換)
- **依賴:** 分類頁 / 品牌頁 milestone 啟用前(M-2-XX、待 milestone 排程拍板)
- **發現於:** 2026-05-10 / M-1-03-audit Slice A simplify audit D5 finding(slice-A-fix amend 開立)
- **相關:** `supabase/migrations/20260510134708_products_public_view.sql`、#118(adapter 切換、為 view 拆分後 adapter 對應切換的前置)

---

### #120. 🔴 @pcm/adapters server subpath export + server-only enforce(議題 2 anchor)

- **狀態:** 🔴 立即啟動(Slice B 三 sub-slice 中)
- **分流:** P1-now
- **優先級:** 🔴 高(M-1-13 ProductPage 啟動前必修、避免 service_role key 進 client bundle)
- **問題:**
  - `packages/adapters/src/index.ts` root export 包 `createSupabaseServiceClient`、storefront 任何位置 import 都拿得到、含 client component
  - service_role key 進 client bundle = 整個 Supabase DB 完全淪陷(bypass RLS)
  - 目前防線:lib/products.ts 開頭 runtime guard `if (typeof window !== 'undefined') throw`(運行時擋)、但 build time 不擋、bundler 仍可能 trace import graph 把 service factory 打包進 client chunk
  - 三層防需要:server-only npm 套件(編譯期擋)+ subpath export 拆 public/server(import path 級隔離)+ ESLint rule(寫 code 即時警示)
- **觸發事件:**
  - 2026-05-10 / M-1-03-audit Slice B(議題 2 處置):雙 audit findings R1 #2 Critical 揭示 service factory 從 root export 暴露給 client bundle 風險
- **預期解法(三 sub-slice 拆法、Slice B):**
  - **sub-slice B-1**(本 sub):server-only npm 套件 deps 加進 packages/adapters + apps/storefront、`import 'server-only'` 加 packages/adapters/src/supabase/client.ts 檔頭
  - **sub-slice B-2**:packages/adapters/package.json `exports` field 加 `./server` subpath、新建 packages/adapters/src/server.ts export 含 service factory、root index.ts 移除 service factory export、apps/storefront/src/lib/products.ts import path 改 `@pcm/adapters/server`
  - **sub-slice B-3**:eslint.config.js 加 boundaries / no-restricted-imports rule 擋 client component(`'use client'` 標記)import `@pcm/adapters/server`、dry-run 7 條(server import OK / client import CAUGHT)
- **不修會痛在:**
  - 擴充性:M-1-13 加 client component(ProductPage 互動 / FilterSide 篩選器)、若手抖 import 到 service factory、整 Supabase 淪陷;sub-slice B-3 ESLint rule 是 IDE 即時警示、避免 review 漏抓
  - 可維護性:三層防分散在 deps / exports / lint config、無 anchor 條目追蹤連帶關係、未來 audit 找不到「為何 server.ts 拆出去」
  - bug 可追蹤性:若 service_role key 真進 client bundle 上線後洩漏、查 webpack stats / Vercel build output 才知道、回溯 commit history 無此 anchor 條目找根因
- **估時:** 三 sub-slice 合計 60-90 min(B-1 15-20 min + B-2 20-30 min + B-3 25-40 min)
- **依賴:** 無前置(Slice A products_public view 已 push、本 slice 從乾淨 base 起跑)
- **發現於:** 2026-05-10 / M-1-03-audit Slice B 議題 2 處置
- **相關:** Slice A 議題 1+6(view 防漏經銷價、不同層次防)、ADR-0003 §C2 RLS column-level、ADR-0005 §7 service_role key 紀律

---

### #121. ⏳ spike script API surface 規範(workspace 範圍限制處理)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低(spike 是 dev tool、現有 deep import 仍能跑、不阻擋)
- **問題:**
  - `scripts/spikes/*.ts` 不在 `pnpm-workspace.yaml` include 範圍(`apps/*` + `packages/*`)
  - `.npmrc` 設 `shamefully-hoist=false` 嚴格隔離、`@pcm/*` 不 hoist 進 root node_modules
  - spike script 從 root context 跑、無法 resolve `@pcm/adapters` / `@pcm/adapters/server` 等 package name
  - 目前 4 個 deep import:`createSupabaseServiceClient` / `SupabaseProductAdapter` / `matchFitmentYear` / `@pcm/domain` types
    (其中 `@pcm/domain` 為何能 resolve 待偵察 — 可能 tsx 解析機制 + workspace deps 透過 @pcm/adapters 傳遞)
  - 規範缺位:未來新人寫 spike 不知道「能不能用 package name」、可能踩同坑(sub-slice B-2 即踩過、Sean Q-G4-spike=A1 拍板還原)
- **觸發事件:**
  - 2026-05-10 / sub-slice B-2 §G.4 偵測:Code 將 createSupabaseServiceClient 改為 @pcm/adapters/server、tsx 解析失敗、Sean 拍板還原
- **預期解法(三選項並列、後續 slice 拍板):**
  - **(a) workspace 擴張**:`pnpm-workspace.yaml` 加 `'scripts/**'` 或類似 include、將 spike 納入 workspace、可 resolve package name;但 scripts/ 通常無 package.json、要新建一個或結構調整、scope 大
  - **(b) root devDeps 加 @pcm/* alias**:root `package.json` 加 `"@pcm/adapters": "workspace:*"` 等 devDeps、讓 root context 能 resolve;scope 中等、對 root 影響面要評估
  - **(c) spike 維持 deep import 慣例**:寫進 working-style.md「spike script 用 deep relative import、不走 package name(workspace 範圍限制)」;scope 最小、但留「未來新人可能仿 deep import」風險
  - **建議方向:** 拍板時依 spike 數量 + 規模評估;若 spike 持續累積(M-1-13 / M-2-XX 各有自己 spike)選 (a) 最徹底;若是 dev tool 一次性精神選 (c) 最簡
- **不修會痛在:**
  - 擴充性:Phase 2 各 milestone spike 累積、無規範各 spike 自由發揮;若有人寫 spike 用 package name 會踩同坑
  - 可維護性:spike script 4 個 import 風格不一致(假設未來部分改 package name 部分留 deep)、新人困惑哪個是對的
  - bug 可追蹤性:本條目為 anchor、未來 spike 撞 resolution 議題時 grep 找此條目決議
- **估時:** 拍板 + 落地 30-60 min(視選 a/b/c 工作量不同)
- **依賴:** 無、隨時可做
- **發現於:** 2026-05-10 / M-1-03-audit sub-slice B-2 §G.4
- **相關:** `scripts/spikes/M-1-03-main-c-roundtrip.ts`、backlog #120(議題 2 anchor、本條目從 #120 sub-slice B-2 衍生)、`pnpm-workspace.yaml`、`.npmrc` shamefully-hoist=false

---

### #122. ⏳ brand name→ID cache + invalidation(adapter / sync-engine / admin 三層連動)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低(adapter 內 Brand value-object 已含 id、無使用點;sync-engine / admin 廠商導入啟動才有 brand name 字串需 resolve)
- **問題:**
  - SupabaseProductAdapter Brand resolve 無 name → id cache(`SupabaseProductAdapter.ts` L69-72 + L241-244 兩處 JSDoc anchor 明示「第 3 處撞才抽」Defer 模式、對齊 lessons #84/#85)
  - `docs/architecture/supabase-schema-design.md` §3.3 設計意圖描述「adapter 邊界雙向 resolve FK ↔ name string;cache 名稱→ID」、刀 2 偵察揭示無使用點:adapter Brand value-object 已含 id、save 直接用 product.brand.id、findById / list / search 走 JOIN 拿 brands(*) 結構、無 name → id resolve 路徑
  - 未來 sync-engine 廠商爬蟲 / Sheets 雙寫 / admin 手動 import 啟動時、會從廠商 wire 字串(brand name)resolve brand id、需 cache 防重複 query(N+1 預防)
- **觸發事件(任一觸發即啟動實作):**
  - sync-engine 廠商爬蟲 / Sheets 雙寫啟動(需從廠商 wire 字串 resolve brand id)
  - admin 手動 import 流程啟動(需從 CSV / 表單字串 resolve brand id)
  - 同 brand name 字串 → id resolve 場景累積第 3 處(對齊 lessons #84/#85 + `SupabaseProductAdapter.ts` L69-72 既有 anchor)
- **預期解法:**
  - 結構:`Map<string, string>`(brand name → brand id)、容量上限 100(Phase 1 廠牌數 < 50、buffer ×2)
  - invalidation 二選一(拍板時定):TTL(短期過期、簡單)/ admin write hook 主動清(精準、需 admin / sync-engine 加 hook)
  - 位置:`packages/adapters/src/supabase/helpers/brand-cache.ts`(對齊 helpers/ 既有 pattern:category-path.ts / fitment.ts)
  - 整合點:SupabaseProductAdapter 加 private `resolveBrandId(name)` method、整合 cache 邏輯
  - 不引入新 npm dep(用內建 Map、防 package.json drift)
- **不修會痛在:**
  - 擴充性:brand rename / 刪除時 cache stale 返錯 id、sync-engine 廠商更名 / admin 改 brand 無 cache invalidation → product wrong-brand 連鎖
  - 可維護性:既有 JSDoc 兩處 anchor(L69-72 + L241-244)散落 code、條目化集中追蹤;新人寫 sync-engine / admin 不知道既有「Defer 模式」設計、可能重複 resolve 無 cache(N+1 query)
  - bug 可追蹤性:cache stale → product wrong-brand bug、log 需 brand id resolve 路徑追蹤;條目編號便於 grep 找決議
- **估時:** 60-90 min(實作 cache + invalidation policy + adapter / sync-engine 整合 test)
- **依賴:** 任一 trigger 觸發即啟動(無前置 milestone 依賴)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 2 偵察(Sean Q-brand-cache=A4 拍板不實作 cache、條目化開立)
- **相關:** `packages/adapters/src/supabase/SupabaseProductAdapter.ts` L69-72 + L241-244 既有 JSDoc anchor、`docs/architecture/supabase-schema-design.md` §3.3 cache 描述、`docs/lessons-learned.md` 第 84 / 85 條 Defer 模式、`docs/working-style.md` §6.3 第 14+ 條教訓

---

### #123. ✅ zeroMoney helper 候選(placeholder Money 場景收斂)

- **狀態:** ✅ closed
- **優先級:** 🟡 低(目前 1 處使用、刀 4 後重評)
- **問題:**
  - placeholder Money(`{ amount: 0, currency }`)場景累積、無共用 helper、各處字面分散
  - 當前 1 處用例:mappers/product.ts L113 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4` placeholder(amount 0、currency 對齊 store tier)
  - 刀 4 公式 dispatch 落地後此處將被重寫、placeholder 自然消失;若刀 4 後仍累積其他 placeholder Money 場景、需評估抽 helper
- **觸發事件(任一觸發即啟動實作):**
  - 刀 4 公式 dispatch 落地後、placeholder Money 仍需求第 2 處
  - 同模式 placeholder Money 累積第 3 處(對齊 lessons #84/#85 Defer 模式)
- **預期解法:**
  - 結構:`export function zeroMoney(currency: Currency): Money`、收斂 placeholder amount + currency 取用路徑
  - 位置:`packages/domain/src/shared/types.ts`(與 `toMoneyAmount` 同檔、對齊既有 helper 風格)
  - 替換點:mappers/product.ts L113 + 未來 placeholder Money 場景
- **不修會痛在:**
  - 擴充性:placeholder 邏輯散落、各處 currency 取用路徑可能 drift
  - 可維護性:無共用 anchor、grep placeholder 場景需多處比對
  - bug 可追蹤性:placeholder amount 字面 0 易與商業價 0 混淆(目前 lifecycle marker `_DEFERRED_TO_SLICE_4` 緩解、但僅 mapper 內)
- **估時:** 10-15 min(helper + 替換 + JSDoc)
- **依賴:** 刀 4 完工後重評(若 placeholder 自然消失、條目可關)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 3 雙 audit findings(simplify R2 reuse 揭示 zeroMoney helper 缺失、Sean Q-audit-disposition=X4+Y1+Z3 拍板)
- **相關:** `packages/adapters/src/supabase/mappers/product.ts` L113 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4`、`packages/domain/src/shared/types.ts` toMoneyAmount + Money type、`docs/lessons-learned.md` 第 84/85 條 Defer 模式、累積教訓 #6 audit 處置
- **✅ 關閉於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8a
- **關閉原因:** 刀 4 公式 dispatch 落地後 mapper L67-68 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4` placeholder 整段移除、L113 trigger 自然消失;sub 8a wire-only narrow 後 mapper 內無新 placeholder Money 累積需求、zeroMoney helper 不抽

---

### #124. ✅ Claude.ai 寫 slice 指令字面涉 script 啟動方式必先 grep shebang + 既有 .md 實測

- **狀態:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12 + working-style §6.3 第 22 條落地)
- **優先級:** 🟠 中(每個 slice 指令發送都可能觸發、防 Code raise 成本)
- **問題:**
  - Claude.ai 寫 slice 指令字面涉「執行檔 / script 啟動方式」(bash / node / python / sh / pnpm exec 等)時、若憑記憶寫死啟動命令、可能與 script 實況 / 既有 .md / CLAUDE.md 字面真權威 drift
  - 痛點實況:sub 6 收工指令字面 `bash /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm`、實況該 script L1 無 shebang、必須 `node` 跑、Code 上一輪 raise 才修正
  - 違反原則 10「不憑記憶寫具體技術字面」、累積教訓 §12-N3 第 4 條 helper 簽名類似精神、本條擴張到「script 啟動命令字面」維度
- **觸發事件(任一觸發即啟動實作):**
  - 每次 slice 指令發送前自檢項加入此條(working-style §6.3 第 N 條)
  - 同類錯第二次出現觸發 lessons §12 條目落地
- **預期解法:**
  - working-style §6.3 自檢清單新增條:「指令字面涉 script 啟動方式時、必先 grep script L1 shebang + 既有 .md 既有實測字面、不憑記憶」
  - sub 8e 落地對應 lessons §12-N 條目
- **不修會痛在:**
  - 擴充性:未來新工具 script 入鍊(busboy v3 / 新 audit script / 新 deploy script 等)都可能踩同類錯、單條 trigger 涵蓋全範圍
  - 可維護性:每個 slice 指令發送前自檢一行、預防成本極低、事後修正成本高(Code raise + 重組指令 + 字面 vs 事實註記)
  - bug 可追蹤性:啟動字面錯導致 Code raise、累積多次造成「Claude.ai 指令不可信」印象、自檢項立後可追蹤 trigger 觸發歷史
- **估時:** 5 min(working-style §6.3 加 1 條 + lessons §12 對應)
- **依賴:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12~16 + working-style §6.3 第 22-26 條落地、跨專案明示)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 6(busboy-end `bash` 字面踩雷、Sean Q-execution-deviations 拍板)
- **相關:** `CLAUDE.md` Busboy 流程段、`/Users/sean_1/pcm-tools/scripts/busboy-end.js` L1 shebang 真權威、原則 10、累積教訓 §12-N3 第 4 條、`docs/lessons-learned.md` §12-12 + `docs/working-style.md` §6.3 第 22 條(sub 8e-2 落地)

---

### #125. ✅ Claude.ai 寫 git push 字面 / 處置選項必先 grep ahead 狀態 + 評估 push 範圍 = HEAD

- **狀態:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-13 + working-style §6.3 第 23 條落地)
- **優先級:** 🔴 高(誤判 push 範圍導致已 push 狀態不可逆、補救成本高)
- **問題:**
  - Claude.ai 寫含 `git push` 字面 / 評估 push 處置選項時、若假設 push 只推單一目標 commit、實況 push 推所有 ahead commit、可能導致未完成狀態被推到 origin
  - 痛點實況:sub 6 Q-busboy-multi-commit 處置 C 字面「Sean push sub 4b、ahead 變 1、我再 amend」、Sean 執行後把 sub 4b + sub 6 兩個都推到 origin(sub 6 還未收工 STATUS 6 欄位)、走 docs(status) 獨立 commit 補救
  - 違反原則 10「不憑記憶寫具體技術字面」、git push 行為屬具體技術細節
- **觸發事件(任一觸發即啟動實作):**
  - 每次 slice 指令含 git push 字面 / push 處置選項前自檢項加入此條
  - 同類錯第二次出現觸發 lessons §12 條目落地
- **預期解法:**
  - working-style §6.3 自檢清單新增條:「寫含 git push 字面 / 評估 push 處置選項時、必先 grep `git log origin/dev..HEAD --oneline` 確認 local ahead 狀態、評估 push 推所有 ahead commit 後果、不可假設 push 只推單一目標 commit」
  - **特別在 ahead≥2 環境寫 push 處置選項時**、所有選項字面都要明確標示「push 範圍 = HEAD」而非「push 單一 commit」
  - sub 8e 落地對應 lessons §12-N 條目
- **不修會痛在:**
  - 擴充性:未來所有 git push 字面指令 + 含 push 處置選項都適用、條目涵蓋面廣
  - 可維護性:每個 push 字面 / 選項前自檢一行、預防 push 後 origin 狀態不一致 / 補救 docs(status) 獨立 commit / 重做 sub 等高成本場景
  - bug 可追蹤性:push 行為一旦發生不可逆、事後 force-push 補救破 history;trigger 落地後 push 處置設計時即考慮 ahead 範圍、降低事故率
- **估時:** 5 min(working-style §6.3 加 1 條 + lessons §12 對應)
- **依賴:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12~16 + working-style §6.3 第 22-26 條落地、跨專案明示)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 6 Q-busboy-multi-commit C 處置事故
- **相關:** sub 6 docs(status) 補救 commit `81eff40`、原則 10、累積教訓 §12-N3 第 1/2 條、`docs/lessons-learned.md` §12-13 + `docs/working-style.md` §6.3 第 23 條(sub 8e-2 落地)

---

### #126. ✅ Claude.ai 寫 monorepo 設定處置字面必先 web_fetch 官方文件 + grep 本地實況

- **狀態:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-14 + working-style §6.3 第 24 條落地)
- **優先級:** 🟠 中(每次 monorepo 設定變更都可能觸發、防憑記憶踩過時/錯誤慣例)
- **問題:**
  - Claude.ai 寫含 monorepo 設定(env / config / build / deploy)處置字面時、若憑記憶或既有慣例推測、可能與官方真權威 drift、踩過時或錯誤慣例
  - 痛點實況:sub 7 dev server F3 揭示 monorepo root .env.local 無法被 Next.js inherit、Q-env-fix-timing 拍板前完全沒查官方文件、靠 sub 8b 偵察 web_fetch 才揭示 Next.js + Turborepo 雙官方推薦 per-package 模型
  - 違反原則 10「不憑記憶寫具體技術字面」、monorepo 工具設定屬具體技術細節
- **觸發事件(任一觸發即啟動實作):**
  - 每次 slice 指令含 monorepo 設定字面前自檢項加入此條
  - 新 app 加入 monorepo(admin / sync-engine 等)觸發 env / build / deploy 設定時
  - 同類錯第二次出現觸發 lessons §12 條目落地
- **預期解法:**
  - working-style §6.3 自檢清單新增條:「寫含 monorepo 設定(env / config / build / deploy)的處置字面時、必先 web_fetch 對應工具官方文件(Next.js / Turborepo / Vercel / pnpm 等)+ grep 本地當前實況、不憑記憶或既有慣例推測」
  - sub 8e 落地對應 lessons §12-N 條目
- **不修會痛在:**
  - 擴充性:未來所有 monorepo 工具設定(Next.js 17/18 升級 / Turborepo 新版本 / Vercel deploy 設定 / pnpm catalog 變更等)都適用
  - 可維護性:web_fetch + grep 雙真權威成本低(5-10 min)、預防 Q-X 拍板字面錯需 rollback 重做高成本場景
  - bug 可追蹤性:設定字面錯導致 dev server / build / deploy 失敗、debug 從應用層往 monorepo 層追耗時、trigger 落地後設計時即考慮真權威、降低事故率
- **估時:** 5 min(working-style §6.3 加 1 條 + lessons §12 對應)
- **依賴:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12~16 + working-style §6.3 第 22-26 條落地、跨專案明示)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 7 dev server F3 HTTP 500 + sub 8b 偵察 web_fetch Next.js + Turborepo 雙官方真權威揭示
- **相關:** sub 8b commit、Next.js 16 docs env-variables、Turborepo docs using-environment-variables、原則 10、`docs/lessons-learned.md` §12-14 + `docs/working-style.md` §6.3 第 24 條(sub 8e-2 落地)

---

### #127. ✅ Claude.ai 操作含 env / secret / token 字面檔案前強制 redaction、絕不讀整檔內容

- **狀態:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-15 + working-style §6.3 第 25 條落地、🔴 高優先級保留 history)
- **優先級:** 🔴 高(本對話最嚴重事故、Supabase keys 洩露需走切新版 + disable Legacy 雙步驟補救)
- **問題:**
  - Claude.ai 操作含 `.env` / `secret` / `token` / `apikey` / `password` 字面檔案時、若用 `read_multiple_files` / `read_file` / `view` 整檔、檔案內容(含 keys / tokens / passwords)會被拉進對話上下文、不可逆洩露
  - 痛點實況:本對話 sub 8 前置偵察期間、Claude.ai 用 `Filesystem:read_multiple_files` 讀 `.env.local` 整檔、Supabase anon + service_role JWT keys 洩露到對話上下文、走 Supabase 切新版 API keys(sb_publishable / sb_secret)+ disable Legacy keys 雙步驟補救
  - 補救字面錯:原處置「Dashboard rotate anon + service_role key」字面、實況 Supabase 2025 後 Legacy keys 不可 rotate、必須走 disable + 切新版雙步驟、Sean Dashboard 找不到 rotate 入口才揭示
  - 違反安全規則第 1 條「API key / token / 密碼不出現在對話、只在終端機處理」+ 第 5 條「.env 等命令必加 redaction」
- **觸發事件(任一觸發即啟動實作):**
  - 每次 slice 指令涉 .env / secret / token / apikey / password 字面檔案操作前自檢項加入此條
  - 安全事故第二次發生觸發 lessons §12 條目落地(本對話已立、不等第二次)
- **預期解法:**
  - working-style §6.3 自檢清單新增條:「操作含 `.env` / `secret` / `token` / `apikey` / `password` 字面檔案前、強制 redaction(grep -v / sed mask)或改讀結構(`get_file_info` 看 metadata / `git check-ignore` / `ls -la`、絕不 `read_multiple_files` / `read_file` / `view` 整檔。Sean 端 terminal 操作時、Claude.ai 指令字面只可說「在 terminal 跑」、不可說「Claude.ai 幫你看內容」」
  - **擴張條款**:Claude.ai 寫安全事故補救字面時、必先 web_search 確認當前 Dashboard / 工具操作真權威、不憑記憶寫死「點哪個按鈕」(對齊本事故補救字面錯)
  - sub 8e 落地對應 lessons §12-N 條目
- **不修會痛在:**
  - 擴充性:未來所有 env / secret 檔案操作(新 app .env / GCP credentials / API tokens / Supabase service role 等)都適用、條目涵蓋面廣
  - 可維護性:redaction 操作 30 秒、預防 keys 洩露事故補救 30-60 min(Dashboard 切新版 + 更新所有 env + disable Legacy)
  - bug 可追蹤性:keys 洩露不可逆、補救期間 production / 其他部署點同步更新風險高;trigger 落地後 env 操作即走 metadata-only 路徑、根本性消除事故源
- **估時:** 10 min(working-style §6.3 加 1 條主體 + 1 條擴張條款 + lessons §12 對應)
- **依賴:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12~16 + working-style §6.3 第 22-26 條落地、跨專案明示)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8 前置偵察期間 Supabase keys 洩露事故 + 補救字面錯雙重觸發
- **相關:** Supabase keys 補救 commit / 安全規則第 1 條 + 第 5 條 / 原則 10、累積教訓 §12-N3 第 1-5 條精神擴張、`docs/lessons-learned.md` §12-15 + `docs/working-style.md` §6.3 第 25 條(sub 8e-2 落地、🔴 高優先級)

---

### #128. ✅ Claude.ai 寫 slice 指令前置必先讀 Code/Sean 上輪訊息全文 + 驗 git log

- **狀態:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-16 + working-style §6.3 第 26 條落地)
- **優先級:** 🟠 中(每次 slice 指令前置都可能觸發、防 Code raise + Sean 二次確認成本)
- **問題:**
  - Claude.ai 寫 slice 指令前置(A 段狀態檢查)字面時、若憑記憶寫 HEAD hash / 進度 / 上一個 sub 完成狀態、可能與實況 drift、導致 Code raise「實際狀態已是 sub X+1 完成、不重複執行」
  - 痛點實況:sub 8b 落地後、Claude.ai 寫 Step 3 指令前置「HEAD = 6f9c072 sub 8a」、實況 Code 上一輪已收工 sub 8b(amend 後 `1f934a2`)、Code 跑 A 段預期 vs 實際偏離、raise Q-sub8b-redo
  - 違反原則 10「不憑記憶寫具體技術字面」、累積教訓 §12-N3 第 1/2 條精神擴張到「跨訊息上下文同步」維度
- **觸發事件(任一觸發即啟動實作):**
  - 每次 slice 指令發送前自檢項加入此條
  - 同類錯第二次出現觸發 lessons §12 條目落地
- **預期解法:**
  - working-style §6.3 自檢清單新增條:「寫 slice 指令前置(A 段狀態檢查)字面前、必先讀 Code / Sean 上一輪訊息全文 + 用 filesystem `get_file_info` 看 STATUS.md 修改時間 + 或 grep 驗 git log 字面、不憑記憶寫 HEAD hash / 進度 / 上一個 sub 完成狀態」
  - sub 8e 落地對應 lessons §12-N 條目
- **不修會痛在:**
  - 擴充性:未來所有 slice 指令前置 + 含 HEAD/sub 進度字面都適用、條目涵蓋面廣
  - 可維護性:讀上輪訊息全文 + filesystem metadata 驗證成本低(2-3 min)、預防 Code raise + Sean 二次確認 + 指令重發成本(10-15 min)
  - bug 可追蹤性:憑記憶寫死導致跨訊息上下文 drift、Code 難判斷是否該執行、trigger 落地後前置字面與實況同步、降低事故率
- **估時:** 5 min(working-style §6.3 加 1 條 + lessons §12 對應)
- **依賴:** ✅ 完成於 2026-05-12 / M-1-03-main-a 刀 4 sub 8e-2(lessons §12-12~16 + working-style §6.3 第 22-26 條落地、跨專案明示)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8b 收工後 Claude.ai Step 3 指令前置 HEAD 字面錯、Code raise Q-sub8b-redo
- **相關:** sub 8b commit `1f934a2`、原則 10、累積教訓 §12-N3 第 1/2 條精神擴張、`docs/lessons-learned.md` §12-16 + `docs/working-style.md` §6.3 第 26 條(sub 8e-2 落地)

---

### #129. ⏳ 'NT$' currency → symbol helper(Phase 2 多幣別準備)

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟢 觀察
- **問題:**
  - `apps/storefront/src/components/Price.tsx` L43 / L45 / L56 / L58 / L67 `'NT$'` hardcode 5 處、未來多幣別需散修
  - 對齊 PRD §7.2 預估「'NT$' currency → symbol helper Phase 2 多幣別」、本對話 sub 8c #125 編號已被 git push 處置佔用、新編號 #129
- **觸發事件(任一觸發即啟動實作):**
  - Phase 2 多幣別啟動(USD / EUR / JPY 等加入)
  - 同 currency symbol hardcode 場景累積第 3 處
- **預期解法:**
  - 結構:`export function currencySymbol(currency: Currency): string`、收斂 'NT$' / 'US$' / '€' 等 symbol 字面
  - 位置:`packages/domain/src/shared/types.ts`(與 Currency / Money 同檔)
  - 替換點:Price.tsx 5 處 + 未來 LinePrice / CheckoutPage 等
- **不修會痛在:**
  - 擴充性:Phase 2 多幣別啟動時、5+ 處 hardcode 散修
  - 可維護性:無共用 anchor、grep 'NT$' 找散落點
  - bug 可追蹤性:幣別新增時、漏改一處 → UI 顯示錯幣別
- **估時:** 30-45 min(helper + Price.tsx 替換 + JSDoc)
- **依賴:** Phase 2 多幣別啟動(無前置 milestone)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d 雙 audit eng-6
- **相關:** `docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` eng-6、`apps/storefront/src/components/Price.tsx` L43/45/56/58/67、PRD §7.2 預估清單、`packages/domain/src/shared/types.ts` Currency / Money 同檔

---

### #130. ✅ tier resolution helper(第 3 處撞才抽、Defer 模式 — Sean Q1=B 業務拍板覆寫)

- **狀態:** ✅ 完成
- **完成於:** 2026-05-20 / M-1-13e-pre-1(`apps/storefront/src/lib/tier.ts` 抽 `resolveTierFromRequest(searchParams, cookieStore): Promise<MemberTier>` helper + 檔頭 `import 'server-only';` 編譯期擋 client bundle;`app/page.tsx` L42-58 inline 邏輯移除、改用 helper、移除 `designTierToSchema` import;`app/products/[slug]/page.tsx` 加 server-side resolve + TODO 註預埋 13e 真接 ProductPage prop;`lib/tier.test.ts` 5 test pass)
- **(原狀態保留以下記錄)**
- **狀態(原):** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `apps/storefront/src/app/page.tsx` L42-58 `tierOverride / cookie / 'general'` priority + `designTierToSchema` guard、tier 解析邏輯第 1 處落地
  - 未來 ProductPage(M-1-13)/ CheckoutPage(M-1-XX)各 page server-side render 需 resolve tier、各自重寫
- **觸發事件(任一觸發即啟動實作):**
  - 第 3 處撞(ProductPage / CheckoutPage 累積到 3 處)(對齊 lessons §84/§85 Defer 模式)
  - 2026-05-20 / M-1-13e-pre-1 Sean Q1=B 業務拍板覆寫:金額頁面必須區分會員(商品頁 / 品牌頁 / 特價 / 購物車 / 結帳 / 訂單 / 任何金額頁面)、helper 立即抽、不等第 3 處撞 trigger;Q5=A 拍板「商品頁短期顯一般零售價接受、M-1-16 真資料來時自動生效」
- **預期解法:**
  - 結構:`export async function resolveTierFromRequest(searchParams, cookies, options?): Promise<MemberTier>`
  - 位置:`apps/storefront/src/lib/tier.ts`(新檔)或 `@pcm/domain/identity`(視 cross-app 共用需求)
  - 整合點:各 server page 開頭 `const tier = await resolveTierFromRequest(...)`
- **不修會痛在:**
  - 擴充性:各 page 自己 resolve、邏輯散落、防 tier=store override env guard 漏配
  - 可維護性:M-1-14 真 auth 落地時、各 page 解析路徑需同步改
  - bug 可追蹤性:tier 解析漏 fallback 'general' → server throw 500、debug 路徑散落
- **估時:** 30-45 min(helper + 第 1 處 page.tsx refactor + 其他 page 改造)
- **依賴:** 第 3 處撞(無前置 milestone、視 ProductPage / CheckoutPage 啟動時機)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d simp-10
- **相關:** `docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` simp-10、`apps/storefront/src/app/page.tsx` L42-58、`docs/lessons-learned.md` 第 84/85 條 Defer 模式

---

### #131. ⏳ toMoney helper 集中至 packages/adapters/src/supabase/helpers/(第 3 處撞才抽)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `packages/adapters/src/supabase/mappers/product.ts` L171-175 `toMoney` helper 私有 module-level、僅 mapper 內使用
  - 未來其他 adapter(OrderAdapter / CustomerAdapter 等)wire→Money 轉換可能重複
- **觸發事件(任一觸發即啟動實作):**
  - 第 3 處撞(其他 adapter mapper 需 wire→Money 轉換、達 3 處)(對齊 lessons §85)
- **預期解法:**
  - 結構:`export function toMoney(wire: { amount: number; currency: Currency }): Money`
  - 位置:`packages/adapters/src/supabase/helpers/money.ts`(新檔、對齊 helpers/ 既有 pattern:category-path.ts / fitment.ts)
  - 替換點:mappers/product.ts L171-175 + 未來其他 mapper
- **不修會痛在:**
  - 擴充性:其他 mapper 各自寫 toMoney、字面 drift 風險(amount/currency 字面拼錯)
  - 可維護性:Money brand type 改造時(toMoneyAmount guard 調整)、散修
  - bug 可追蹤性:guard 邊界 case 抓不到、單元 test 散落各 mapper
- **估時:** 20-30 min(helper + mapper refactor + test)
- **依賴:** 第 3 處撞(無前置 milestone、視其他 adapter 落地時機)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d simp-11
- **相關:** `docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` simp-11、`packages/adapters/src/supabase/mappers/product.ts` L171-175、`docs/lessons-learned.md` 第 85 條 Defer 模式

---

### #132. ✅ TierLabel union type alias 抽出

- **狀態:** ✅ 完成 2026-06-16(commit 50d35d7:`export type TierLabel = 'P價'|'店價'|null` 放 mock-products.ts、Price.tsx/lib/products.ts 共用;純型別零洩漏〔UI badge 字串非經銷價〕;manifest 不 bump〔純型別 list-item〕)
- **分流:** P1-before-launch
- **優先級:** 🟠 中(達 ADR-0003 §3.2 規範類門檻、可立即執行)
- **問題:**
  - `apps/storefront/src/components/Price.tsx` L19 + `apps/storefront/src/lib/products.ts` L73 + `apps/storefront/src/data/mock-products.ts` L24 三處重複 `'P價' | '店價' | null` union 字面
  - 對齊 ADR-0003 §3.2「entity 內 string literal union ≥ 2 個 consumer 必抽 type alias」規範類、目前 3 處已達門檻
- **觸發事件(任一觸發即啟動實作):**
  - 隨時可執行(已達規範類門檻、不需 trigger 等待)
  - 新增 tier label(例:'Premium' / 'VIP' 等)時必先抽 alias 再加值
- **預期解法:**
  - 結構:`export type TierLabel = 'P價' | '店價' | null;`
  - 位置:`apps/storefront/src/data/mock-products.ts`(對齊 MockProduct.tierLabel 既有定義位置)
  - 替換點:Price.tsx L19 PriceProps.tierLabel + lib/products.ts L73 toUIProduct 返回字面 + mock-products.ts L24 MockProduct.tierLabel 三處 import
- **不修會痛在:**
  - 擴充性:新 tier label 時、3 處散修易漏
  - 可維護性:union 字面散落、grep 找消費點需多處比對
  - bug 可追蹤性:字面拼錯('P價' 半形 / 全形)、TypeScript narrow 抓不到
- **估時:** 15-20 min(抽 type alias + 3 處 import + lint)
- **依賴:** 隨時可執行(已達規範類門檻)
- **發現於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d simp-14
- **相關:** `docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` simp-14、`apps/storefront/src/components/Price.tsx` L19 + `apps/storefront/src/lib/products.ts` L73 + `apps/storefront/src/data/mock-products.ts` L24、`docs/decisions/0003-domain-entity-naming.md` §3.2 規範類

---

### #133. ⏳ mock-brands logo 檔補 + 4 新 brands(akrapovic/brembo/ohlins/termignoni)

- **狀態:** ⏳ 待 trigger
- **分流:** P1-before-launch
- **優先級:** 🟡 中(BrandDetailPage / brand 詳情頁啟動時必撞)
- **問題:**
  - mock-brands.ts JSDoc 頂部已預告 25d3a2a design 加 5 新 brands(rizoma/akrapovic/brembo/ohlins/termignoni + premium_extra_pct)、本刀 1b2 只補 rizoma 1 條(對齊 FeatureEditorial L48 字面)、其他 4 條 mock data 未補
  - `apps/storefront/public/assets/brand-logos/` 不存在、所有 17 brand 的 logo path 字面如 'assets/brand-logos/bonamici.webp' 對應 storefront/public/ 0 命中(dormant 因 BrandIndex 不讀 b.logo、Phase 2 真資料未撞)
  - rizoma.webp 同樣 dormant(本刀 1b2 audit b1 揭示)
- **觸發事件(任一觸發即啟動實作):**
  - BrandDetailPage / brand 系列頁啟動時必撞
  - 25d3a2a design 4 brand 補對齊 mock data 時
- **預期解法:**
  - storefront/public/assets/brand-logos/ 補實際 .webp / .avif / .png logo 檔(17 brands × 1 logo)
  - mock-brands.ts 補 akrapovic / brembo / ohlins / termignoni 4 條(對齊 25d3a2a JSDoc 預告字面 + premium_extra_pct 欄位)
  - 或:改寫 BrandIndex 不讀 b.logo(若 Phase 1 design 字面不需 logo、純文字 wall)
  - 對齊 #137 patterns/mock-data-handling.md 規範(若已落地)
- **不修會痛在:**
  - 擴充性:BrandDetailPage / brand 系列頁啟動時統一 logo 規範、避免每頁分散補
  - 可維護性:logo path 字面 vs storefront/public/ 實況 drift、開發者讀檔誤判已有 asset
  - bug 可追蹤性:dormant 404 訊號(asset 缺)在 BrandIndex 不讀 b.logo 時不顯、啟動時撞才現
- **估時:** 30-60 min(取決於是否同步補 4 brand 完整 schema、和 #137 是否先落地)
- **依賴:** BrandDetailPage milestone(M-1-04 後 / Phase 2)/ #137 patterns/mock-data-handling.md(可同期)
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit b1(requesting-code-review Important #2 + Minor #5)
- **相關:** `apps/storefront/src/data/mock-brands.ts` JSDoc + L33 RIZOMA / `apps/storefront/src/components/BrandIndex.tsx` / `apps/storefront/public/assets/brand-logos/`(不存在)/ #137

---

### #134. ⏳ ADR-0006 + docs/architecture/server-client-boundary.md

- **狀態:** ⏳ 待 trigger
- **分流:** P1-before-launch
- **優先級:** 🟠 中(候選刀 4 純 docs slice、可獨立啟動)
- **問題:**
  - M-1-04 刀 1 完成後、storefront 6 sections server / 4 sections client(VehicleFinder / Header / ProductCard / HomeSelect)混合模式落地
  - 缺一份單一 ADR + architecture doc 紀錄「為何 server / 為何 client」決策規矩
  - backlog #116 預期解法字面已預告「可能加 ADR-0006 / docs/architecture/server-client-boundary.md」
  - recon §7 候選刀 4 預埋對應字面
- **觸發事件(任一觸發即啟動實作):**
  - 候選刀 3 互動 sections router.push 啟動前(避免「為何不用 server 拆?」反覆問)
  - 多人協作 / future Claude session 對齊 server-client boundary 規矩時撞
- **預期解法:**
  - 寫 ADR-0006「server-client boundary」decision record(short version、純 ADR)
  - 寫 docs/architecture/server-client-boundary.md(long version、含選擇樹 + 邊界規矩 + e2e 驗 hydration mismatch 紀律)
  - 內容:何時 server / 何時 client / function prop 不可跨 boundary / Link vs router.push 選擇樹 / RSC trade-off 紀錄
- **不修會痛在:**
  - 擴充性:Phase 2 / M-1-13 ProductPage 啟動時、開發者沒依循 → 隨意拆 server/client、boundary 認知散落
  - 可維護性:多人協作 / future Claude session 對齊 boundary 規矩、需多處 grep / commit body 讀
  - bug 可追蹤性:hydration mismatch / function prop boundary error 出現時、無單一 doc 對齊 root cause
- **估時:** 60-90 min(ADR-0006 short + architecture long 雙檔)
- **依賴:** M-1-04 刀 1 完成(本 slice 已收口、可隨時啟動)
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit b2(requesting-code-review Important #3)/ 對齊 backlog #116 預期解法字面 + recon §7 候選刀 4
- **相關:** backlog #116 / docs/recon/M-1-04-recon.md §7 / `apps/storefront/src/app/page.tsx` L7-L10 註解 / `apps/storefront/src/components/*.tsx` 6 sections + 4 client mix

---

### #135. ✅ 9 處 `→` arrow span 加 aria-hidden="true"

- **狀態:** ✅ 已解 / 2026-05-17 / M-1-06
- **優先級:** 🟡 中(a11y polish slice 入口、不阻 Phase 1)
- **問題:**
  - 6 sections 內裝飾性 `→` arrow span(`<span className="ed-link-arrow">→</span>` / `<span className="ed-brand-arrow">→</span>`)共 9 處
  - screen reader 會讀出「right arrow」/「to」、與已有 link text 重複、噪音
  - 本刀 1 改 client → server + Link 後、Link semantic 變正確、arrow 噪音變顯眼(原 `<a href="#">` 整個 link 都壞、現在 link 正常但 arrow 多餘)
  - BrandIndex link accessible name 5 spans concat verbose(num + arrow 加 aria-hidden 可清乾淨)
- **觸發事件:**
  - 2026-05-14 / M-1-04-slice-1b2 audit b3(accessibility-review Major R1 + Minor R2)
- **預期解法:**
  - 9 處 arrow span 加 `aria-hidden="true"` 屬性
  - BrandIndex.tsx 加 `.ed-brand-num` span aria-hidden(對齊 R2)
  - 範圍:HomeHero / FeatureEditorial / HomeStatement(×2)/ CategoryGrid / BrandIndex(num + arrow)/ HomeFooter section-head / 對齊 design 字面「保留 className / 文字 100%」精神、僅加 a11y 屬性
  - 實際落地範圍(2026-05-17 / M-1-06):9 處 = 8 處 ed-link-arrow / ed-brand-arrow + 1 處 ed-finder-go-arrow(VehicleFinder 搜尋部品 button 內裝飾、M-1-06 偵察補入、原 backlog 預期 grep pattern 未涵蓋)
  - ed-brand-num(BrandIndex.tsx 源碼 1 行、runtime 17 處)M-1-06 未動、屬獨立議題(brand link accessible name verbose、accessibility-review R2 Minor)、留後續或開新條目
- **解法落地:** 2026-05-17 / M-1-06 a11y polish slice — 9 處 arrow span 加 `aria-hidden="true"`、screen reader 不再讀出多餘「→」;storefront 加、design-reference 不動(design 真權威 9 處本無 aria-hidden、a11y 屬性為純 storefront 工程層補強、Sean Q3=A 拍板兩層分權)
- **不修會痛在:**
  - 擴充性:未來新增 link with arrow、無 a11y polish 規範、開發者沒依循
  - 可維護性:跨 6 檔 9 處散落、polish 時 grep `ed-link-arrow|ed-brand-arrow|ed-brand-num` 統一補
  - bug 可追蹤性:screen reader 噪音輸出、自動化 a11y test 抓出時 root cause 不明
- **估時:** 30-45 min(9 處 arrow + 17 處 brand-num + a11y polish slice 並 #138 觸控目標同期)
- **依賴:** a11y polish slice 啟動時統一補
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit b3(accessibility-review Major R1 + Minor R2)
- **相關:** `apps/storefront/src/components/HomeHero.tsx` / `FeatureEditorial.tsx` / `HomeStatement.tsx` / `CategoryGrid.tsx` / `BrandIndex.tsx` / `HomeFooter.tsx`、accessibility-review WCAG 4.1.2 + 1.3.1

---

### #136. ✅ HomeFooter 4 條 `<a href="#">` placeholder 處置(Facebook/Instagram/LINE/聯絡客服)

- **狀態:** ✅ 已解 / 2026-05-17 / M-1-06;**🔵 2026-07-03 部分 supersede**:Sean 決策批次 Q2=A → 三條 social 改走本條目候選 B(site-config SOCIAL_URLS 真 href + target=_blank rel=noopener noreferrer、拍板前提〔真 destination〕已滿足);聯絡客服仍候選 A disabled。見 manifest HomeFooter `socialLinksLive` override
- **優先級:** 🟡 中(a11y polish slice + PRD 決策同期)
- **問題:**
  - HomeFooter.tsx L13-L15 三條 social links(Facebook / Instagram / LINE)+ L42 聯絡客服 = 4 條 `<a href="#">` 殘留 placeholder
  - 與本刀 1 修的 11 條 `<a href="#" onClick={handle}>` 是同類 a11y 問題(右鍵/中鍵/Cmd+click/hover URL/screen reader 全部空轉)
  - 屬 design 字面 placeholder、後續 PRD 拍板真 destination 才可決
- **觸發事件:**
  - 2026-05-14 / M-1-04-slice-1b2 audit b4(accessibility-review Major O1)
- **預期解法:**
  - 候選 A(推薦):replace `<a href="#">` with `<button type="button" disabled aria-label="Facebook(尚未上線)">` 語意聲明「未上線」
  - 候選 B:真 href + target="_blank" rel="noopener"(需 PRD 拍板真 destination)
  - 候選 C:omit 4 條 placeholder 直到 PRD 拍板再加
- **解法落地:** 2026-05-17 / M-1-06 a11y polish slice — 候選 A:4 條 `<a href="#">` 改 `<button type="button" disabled aria-label="...(尚未上線)">`、語意聲明未上線(Sean Q2=A 拍板)
- **CSS 副作用揭示:** 4 條 placeholder 跨**兩個容器**(Facebook / Instagram / LINE 在 `.ed-footer-social`、聯絡客服 在 `.ed-footer-cols`)、`<a>` → `<button>` 後原 `.ed-footer-social a` / `.ed-footer-cols a` 選擇器不再 match。`apps/storefront/src/styles/home.css` 修 3 處:(1) 新增 `.ed-footer button` reset(background / border / padding / text-align / cursor / font、排在容器規則前、讓兩容器 contextual 規則蓋回)(2) `.ed-footer-social a` 選擇器加 `button`(3) `.ed-footer-cols a, .ed-footer-cols p` 選擇器加 `.ed-footer-cols button`。`design-reference/styles/home.css` 未同步加 button 規則(design 字面仍是 `<a>`)、storefront vs design CSS 短期偏離屬 button 化必要連動、後續若 Claude Design 同步 button 化、design CSS 同步加 button 規則
- **不修會痛在:**
  - 擴充性:PRD 拍板真 destination 後、4 處散修 vs 統一改 button 半成本差
  - 可維護性:placeholder 字面 vs 真功能不一致、新人讀檔不知該 click 還是該等
  - bug 可追蹤性:點不動 placeholder 在 a11y audit / UX test 重複命中
- **估時:** 20-45 min(取決於 A/B/C 哪個)
- **依賴:** PRD 拍板真 destination(社群平台連結策略 + 聯絡客服路由)
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit b4(accessibility-review Major O1)
- **相關:** `apps/storefront/src/components/HomeFooter.tsx` L13-L15 + L42、accessibility-review WCAG 2.1.1 + 2.4.4

---

### #137. ⏳ 立 docs/patterns/mock-data-handling.md(mock data logo/image path 規範)

- **狀態:** ⏳ 待 trigger
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(規範類、不急、Phase 1 後期或下次 mock data 補新 entity 時觸發)
- **問題:**
  - mock-brands.ts / mock-products.ts / mock-moto-brands.ts 的 logo / image path 字面 = design-reference asset path 直接搬
  - storefront/public/ 不必同步存在(Phase 2 真資料替換階段)、但每次 audit / sanity-check 都重新討論慣例
  - 缺一份 patterns/ 規範 anchor、規範散落 commit body
- **觸發事件(任一觸發即啟動實作):**
  - 下次 mock data 補新 entity(brand / category / product)時撞同問
  - #133 logo+brand schema 啟動時(可同期落地)
- **預期解法:**
  - 寫 docs/patterns/mock-data-handling.md(短 doc)
  - 內容:mock-* 資料 logo/image path 慣例 = design-reference asset path / storefront/public/ 不必同步 / Phase 2 真資料替換階段 / commit body 揭示「mock data、Phase 2 真資料替換」
  - 對齊既有 patterns/ 目錄結構慣例
- **不修會痛在:**
  - 擴充性:未來 mock entity 補檔(akrapovic / brembo 等)、每次都重新討論 logo path 慣例
  - 可維護性:規範散落、新人 / future Claude 對齊需多處 commit body grep
  - bug 可追蹤性:audit 紀錄 mock-* path drift 屬「設計性 anchor」、無單一 doc 對齊
- **估時:** 15-30 min(純 docs slice、短檔)
- **依賴:** 隨時可執行(獨立 docs slice)/ #133 logo+brand schema 補時可同期落地
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit Q3=C / working-style §6.3 trigger 改進(規範類議題進 backlog 不立 lessons)
- **相關:** `apps/storefront/src/data/mock-brands.ts` JSDoc / `mock-products.ts` / #133 brand logo

---

### #138. ⏳ WCAG 2.5.5 觸控目標 < AA — HomeFooter 21.6px

- **狀態:** ⏳ 待 trigger
- **分流:** P1-before-launch
- **優先級:** 🟡 中(a11y polish slice 統一處理、與 #135 #136 同期)
- **問題:**
  - HomeFooter column links(`.ed-footer-cols a`)CSS 字面:font-size 13.5px / line-height 1.6 / margin-bottom 10px / 無 padding
  - effective click target 高度 = 13.5 × 1.6 = 21.6px(text only、margin 不算 click range)
  - WCAG 2.5.8 AA(2.2+)規定 ≥ 24px、實際 21.6px 邊際 fail
  - WCAG 2.5.5 AAA 推薦 ≥ 44px、明顯 fail
  - BrandIndex(~80px desktop / 62px mobile)+ CategoryGrid(~350px)PASS、僅 HomeFooter 此問題
  - 2026-05-16 / M-1-06 偵察揭示:storefront `.ed-footer-cols a`(home.css L657)與 `design-reference/styles/home.css` 同區段 **byte-for-byte 一致**(font-size 13.5px / line-height 1.6 / margin-bottom 10px / 無 padding)、21.6px 觸控目標屬 design 真權威決定、storefront 對齊 design 無偏離
- **觸發事件:**
  - 2026-05-14 / M-1-04-slice-1b2 audit Q4-2 觸控目標 Code CSS 估算
- **預期解法:**
  - apps/storefront/src/styles/home.css L657 區改:加 padding-top / padding-bottom 各 ≥ 12px(讓 effective height ≥ 44px AAA)、或 ≥ 6px(讓 ≥ 24px AA)
  - 對齊 design-reference/styles/home.css 真權威字面、避免 storefront vs design drift
  - 若 design 字面也是 21.6px、屬 design issue、需 Claude Design 拍板更新 design vs storefront 雙改
  - **議題歸位(2026-05-17 / M-1-06):** 偵察既證實 design 真權威本身即 21.6px、需 Claude Design 先改 `design-reference/styles/home.css` 加 padding / 調 line-height、storefront 再 submodule sync 對齊。屬視覺真權威範圍、**不能單方面在 storefront 改 CSS 製造 drift**
- **不修會痛在:**
  - 擴充性:未來 footer 加新 link、繼承同樣 fail / 移動裝置使用體驗差
  - 可維護性:跨 home.css 規範散修
  - bug 可追蹤性:a11y AAA audit / Lighthouse 抓出時 root cause 不明
- **估時:** 15-30 min(CSS 字面 + 視覺驗 design vs storefront)
- **依賴:** Claude Design 拍板更新 `design-reference/styles/home.css` 真權威(加 padding / 調 line-height)、storefront 再 submodule sync 對齊
- **發現於:** 2026-05-14 / M-1-04-slice-1b2 audit Q4-2 觸控目標 Code CSS 估算
- **相關:** `apps/storefront/src/styles/home.css` L657 `.ed-footer-cols a` / `design-reference/styles/home.css` 真權威對比、WCAG 2.5.5 AAA + 2.5.8 AA、#135 / #136(a11y polish slice 同期)

---

### #139. ⏳ 回收 ADR-0001 ~ 0005 Status 欄位風格、統一改用 0006 格式

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - ADR-0001 `> **狀態:** 已拍板 / 2026-04-29`(中文「狀態」、無 emoji)
  - ADR-0002 `> **狀態:** 已拍板 / 2026-04-30`(同 0001)
  - ADR-0003 `> **狀態:** Accepted / 2026-05-01`(中文「狀態」+ 英文「Accepted」混)
  - ADR-0004 `> **Status:** 🟢 拍板 / 2026-05-03`(英文「Status」+ 中文「拍板」+ 🟢)
  - ADR-0005 同 0004 `> **Status:** 🟢 拍板 / 2026-05-04`
  - ADR-0006 `Status: 🟢 Accepted (2026-05-14)`(無 blockquote / 無 bold / 英文 Accepted / 括號分隔、開新風格)
  - 跨 6 ADR 共 **4 種** 風格、命名 / 語意 / 分隔符不一致
- **觸發事件(任一觸發即啟動實作):**
  - 下次 ADR(0007+)落地時、若仍維持 0006 風格、開獨立小 slice 統一回收 0001-0005
  - ADR 索引 / 摘要自動化需求出現時(例:script 解析 ADR status 列、dashboard 顯示 ADR 狀態)
- **預期解法:**
  - ADR-0001 / 0002 / 0003 / 0004 / 0005 五檔 Status 行統一改 ADR-0006 風格 `Status: 🟢 Accepted (YYYY-MM-DD)`
  - 字面 5 處單一行替換、無 content 變動
  - 各檔不重發 ADR、只字面風格回收、commit body 揭示「字面 vs 事實」對齊鐵則 11
- **不修會痛在:**
  - 擴充性:風格不一致持續累積、新 ADR(0007+)落地對齊困惑、命名 / 語意需查每檔
  - 可維護性:ADR 索引 / 摘要不易自動化、無法統一 grep `^Status:`
  - bug 可追蹤性:Status 字面非統一語意、ADR 狀態 dashboard 無法直接 derive
- **估時:** 15-20 min(5 檔字面更新、純 docs slice、無 code 邏輯)
- **依賴:** 無
- **發現於:** 2026-05-14 / M-1-04 slice 4 主刀(ADR-0006 落地揭示風格 drift)
- **相關:** ADR-0001 / 0002 / 0003 / 0004 / 0005 / 0006

---

### #140. ⏳ STATUS.md L17「當前 slice」字面密度重構(commit body 摘要拆段)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - L17「當前 slice」單行內嵌大段 commit body 摘要(本次 M-1-04 slice 4 主刀 ~30 行單行)
  - 可讀性低、Claude.ai / Claude Code 新對話前置檢查讀 L17 時、需快速 grep 主旨困難
  - 跨多 slice 累積、L17 字面密度持續攀升
- **觸發事件(任一觸發即啟動實作):**
  - 下次 STATUS 格式重構需求出現時(例:新增欄位 / 改 column / 重組章節)
  - L17 單行超 50 行時(本次 ~30 行、保留 buffer)
  - 新人 onboarding 反映 STATUS 難讀時
- **預期解法:**
  - L17 改一句話摘要(slice 名 + commit hash + 一句話結果)
  - commit body 摘要拆獨立段「## 本次 slice 詳情」、置於「## 當前狀態」下方
  - 變更紀錄表保留現格式(對齊歷史 single source of truth)
- **不修會痛在:**
  - 擴充性:L17 字面密度持續累積、未來 slice 4 倍以上摘要塞單行不可讀
  - 可維護性:Claude Code 5 綠檢查讀 STATUS 時、L17 grep 主旨困難、易誤判 slice 主軸
  - bug 可追蹤性:大段內嵌摘要藏字面 vs 事實偏離不易發現
- **估時:** 20-30 min(STATUS 結構重構 + 1 commit、純 docs)
- **依賴:** 無
- **發現於:** 2026-05-14 / M-1-04 slice 4 主刀 amend review(Claude.ai Q29 推薦 c)
- **相關:** STATUS.md / lessons §12-22 / §12-23(STATUS 字面 drift 相關)

---

### #141. ⏳ Claude.ai 引用 STATUS 行號 / 字面位置必先 grep 確認

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 中(Claude.ai 端規範修改、影響後續 slice 指令字面準確度)
- **問題:**
  - Claude.ai 寫 slice 指令引用 STATUS 具體行號 / 字面位置時、憑跨 session 對話印象推、未先請 Code grep 字面位置確認
  - 引入字面失準 → Code 偵察階段 raise → 增加跨 session 來回成本
  - 屬 lessons §12-30「Claude.ai 連環誤判」前置場景之一(行號 / 字面位置引用為起點)
- **觸發事件:**
  - 2026-05-15 / M-1-04 刀 3-a(`eb5196e`)指令字面寫 STATUS L17 偏離實況、實況刀 3-a 當下 L17 為 ADR-0006 amend 描述、Header 字面在 L35;eb5196e commit body 完整揭示歷史快照(對齊 lessons §12-30 事故脈絡引用字面源)
  - 2026-05-15 / 刀 3-c.1(`b7b755b`)Claude.ai 在 commit body 把 eb5196e 歷史快照重新詮釋成「Sean 跨 session 失準」、未 view 字面源、屬連環誤判(對齊 lessons §12-30)
- **預期解法:**
  - Claude.ai 寫 slice 指令前置自檢加 1 條:引用 STATUS 行號 / 具體字面位置前、必請 Code grep 確認位置、不憑跨 session 對話印象推
  - 對應 working-style §6.3 第 39 條(Claude.ai 引用 commit body 必先 view)自身延伸至 STATUS 行號引用
  - 整合進 Claude.ai 端 prompt template / slice 指令模板自檢清單
- **不修會痛在:**
  - 擴充性:未來引用 STATUS 字面失準、Code 連環 raise 增加來回成本
  - 可維護性:Claude.ai 公信力下降、Sean 對指令字面信任度降低
  - bug 可追蹤性:行號引用失準與字面失準難區分、根因定位困難(本條目為 anchor)
- **估時:** Sean 評估(Claude.ai 端 prompt / 自檢規範修改、無 Code 端實作)
- **依賴:** lessons §12-30(Claude.ai 連環誤判立法、已 `e4935cc` 落地)、§12-25(跨 session 字面內嵌義務)
- **發現於:** 2026-05-15 / M-1-04 刀 3-a 指令字面偏離事故(`eb5196e` commit body 揭示)+ 刀 3-c.2.1(`e4935cc`)立 §12-30 揭示連環誤判前置場景
- **相關:** #142(STATUS L31 自動填表)、lessons §12-25 / §12-30、working-style §6.3 第 34 / 39 條

---

### #142. ✅ STATUS L31「最近 3 commit」表格 hash drift 治本(雙 amend 機制)

- **狀態:** ✅ 完成(2026-05-17 WO-1)
- **優先級:** 🟡 低(Busboy 腳本端、跨 repo 議題、不阻塞主開發)
- **問題:**
  - STATUS L31「最近 3 commit」表格目前手動維護
  - 每次 slice 收工 Code 手動更新表格欄位(hash + message + 時間)
  - amend 流程引入 1 step stale:本 commit 寫 `XXXXXXX` placeholder、amend 後撈真 hash sed 修;但本 commit STATUS 內 hash = amend 前 hash、與 git log 真 hash 1 step stale(對齊 lessons §12-3 維度 B 滾動修正慣例)
  - 慣例累積:M-1-04 刀 3 series 已累積二十七先例(每 amend 累積一步 stale)
- **觸發事件:**
  - 2026-05-15 / M-1-04 刀 3-a(`eb5196e`)偵察揭示 STATUS L29 表格寫「`7fa9f42` | docs(M-1-04-slice-4): ADR-0006...」實況 7fa9f42 message 為 `docs(working-style+lessons): §6.3 補...`、屬純 sed 後表格 message drift(歷史快照、為觸發事件、無 Sean 失準);eb5196e commit body 揭示
  - 2026-05-15 / 刀 3-c.1(`b7b755b`)/ 3-c.2.1(`e4935cc`)/ 3-c.2.2(本 commit)amend 慣例累積二十六 / 二十七先例(每 slice STATUS L29 hash 留 1 step stale 給下個 slice 順手修)
- **預期解法:**
  - Busboy end 流程加 `git log -3 --format="%h | %s | %cd" --date=short` 自動填表、取代手動維護
  - 或評估更簡單方案:STATUS L31 改為「最後一 commit」單列(`git log -1 --format`)、不維護表格、消除 hash vs message mismatch + amend stale 兩個問題
  - 需 view `/Users/sean_1/pcm-tools/scripts/busboy-end.js` 確認 Busboy 既有 hook 點(屬跨 repo 議題)
- **不修會痛在:**
  - 擴充性:每次 slice 收工 Code 手動更新 STATUS L31、累積 drift、跨 session 對齊失準
  - 可維護性:amend 後 hash 永遠 1 step stale、留給下個 slice 順手修、慣例累積無上限
  - bug 可追蹤性:hash vs message mismatch / amend stale 兩類 drift 混在同個 commit body、字面 vs 事實揭示複雜度上升
- **估時:** Sean 評估(Busboy 腳本端、需 view `/Users/sean_1/pcm-tools/scripts/busboy-end.js` 跨 repo)
- **依賴:** 無
- **發現於:** 2026-05-15 / M-1-04 刀 3 series amend 慣例累積二十六先例
- **相關:** #141(Claude.ai STATUS 行號自檢)、Busboy 腳本(`/Users/sean_1/pcm-tools/scripts/busboy-end.js`)、lessons §12-3 維度 B(滾動修正慣例)
- **解法落點:**
  - pcm-tools commit `5446d5b`(busboy-end.js 雙 amend 機制、WO-1)
  - 實際解法 vs 預期解法:預期「`git log -3` 自動填表」→ 實際採更精準方案「<<HEAD>> placeholder + 雙 amend sed 替換」
  - Step 4 最新 commit 欄改寫 `<<HEAD>>` placeholder;Step 6 拆成 6a(第一次 amend)→ 6b(sed 替換)→ 6c(第二次 amend)
  - 累積 10+ 次手動修終結;STATUS 最近 commit hash 永遠對齊實際 amend 後真值

---

### #143. ⏳ contract test infra independent milestone(框架接線 + 11 it.todo 填真 it + Supabase 測試 client)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 中(M-1-05 刀 2 完工後 view 切換已落地、但無 contract test 守 regression、未來 #118 預期解法字面「contract test 加 case」靠本 milestone 落地)
- **問題:**
  - `runProductRepositoryContract(factory)` 框架已建(M-1-03-prep 件 #3 落地)、但全 repo 0 個測試檔呼叫、`factory` 參數被 `void factory;` 釋放、形同空殼
  - `IProductRepository.contract.ts` 11 個 it.todo 佔位、原訂 main-b 落地填真 it、實際未填
  - 無 SupabaseProductAdapter 測試檔、無 Supabase 測試 client / 測試 DB seed / CI 配置
  - M-1-05 刀 2 Sub-slice 2-4 原規劃「contract test 加 6 it」、撞空殼揭示、Sean B 拍板跳 2-4 創本 milestone
- **觸發事件:**
  - 2026-05-16 / M-1-05 刀 2 Sub-slice 2-4 偵察揭示 contract test 空殼
  - 2026-05-16 / Sean B 拍板「contract 框架接線入 #143 independent milestone」
- **預期解法:**
  - 步驟 1:InMemory 測試檔呼叫 `runProductRepositoryContract(() => new InMemoryProductRepository())`、驗框架接線
  - 步驟 2:填 11 個 it.todo 為真 it(對齊 IProductRepository 6 method + 既有 listByFitment year-range matching 4 case + 跨車型 1 case)
  - 步驟 3:建 Supabase 測試 client(獨立於 production client、用 test schema 或 test DB project ref)
  - 步驟 4:建 SupabaseProductAdapter.test.ts、呼叫 `runProductRepositoryContract(() => new SupabaseProductAdapter(testClient))`
  - 步驟 5:CI 配置(Vercel CI / GitHub Actions、跑 contract test)
  - 步驟 6:M-1-05 view-projection case 補(對齊 #118 + #119 預期解法字面「contract test 加 case」)
- **不修會痛在:**
  - 擴充性:#118 預期解法字面「contract test 加 case 驗 view 不回敏感欄位」未落地、未來 view DDL 改動無自動防線
  - 可維護性:adapter regression 靠 typecheck + 手動驗、無雙 adapter 一致性自動驗
  - bug 可追蹤性:adapter 行為差異(view 路徑 dummy vs InMemory 完整)無 test 量化、未來 IPricingService 接入時退場路徑無明確 anchor
- **估時:** 4-6 hr(跨多 sub-slice、獨立 milestone 級工作)
- **依賴:** M-1-05 刀 2 完工(本 milestone 必要前置、已達成)
- **發現於:** 2026-05-16 / M-1-05 刀 2 Sub-slice 2-4 偵察揭示
- **相關:** `packages/ports/src/IProductRepository.contract.ts`(11 it.todo 佔位)、`packages/adapters/src/in-memory/InMemoryProductRepository.ts`、未建 `packages/adapters/src/supabase/SupabaseProductAdapter.test.ts`、lessons §12-1(contract subpath export)+ §12-2(contract 命名以 port public method 為錨)

---

### #144. ⏳ migration apply SOP 工作風格條目化

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(M-1-05 已踩過、流程已熟、條目化讓未來新 Code session 不重踩)
- **問題:**
  - M-1-05 刀 1.5 揭示:MCP `apply_migration` 用當下 timestamp 套用、若 commit 落地的 migration timestamp 早於 remote 最新、會製造版本倒掛
  - M-1-05 刀 1.5 修法:改走 Supabase CLI `supabase db push`(必要時加 `--include-all` flag)
  - M-1-05 後續 sub-slice 沿用 CLI 路徑、未撞坑
  - 但無 docs 條目化、新 Code session 接手仍可能誤用 MCP apply_migration
- **觸發事件:**
  - 2026-05-12 / M-1-05 刀 1.5 揭示
  - 2026-05-16 / M-1-05 刀 2 完工、流程已驗證、條目化時機到
- **預期解法:**
  - 在 `docs/working-style.md` 或 `docs/tools-and-skills.md` 加段「Supabase migration apply SOP」、條目化:
    - commit 落地 ≠ apply 落地(兩階段、commit body 字面區分)
    - apply 路徑:`supabase db push`(必要時 `--include-all`)、不用 MCP `apply_migration`
    - Sean 手動跑、Code 不代跑(對齊四方分工)
    - dry-run 先驗:`supabase db push --dry-run` 確認待推清單
  - 對齊 §12-31(commit 落地 ≠ apply 落地)+ §12-32(MCP / CLI 工具行為紀律)、本刀 3-a(`36ffede`)立法落地;working-style §6.3 第 40 + 41 條對應落地
  - 本條目為「規範化條目」(立法 → 工作風格條目 雙落地)、立法已完成;本 #144 trigger 條件:M-5-03 sync-engine pipeline 落地時、該 slice 必引用 §12-31 + §12-32 確認執行
- **不修會痛在:**
  - 擴充性:Phase 2 多 milestone 動 schema、新 Code session 不重踩需條目化
  - 可維護性:lessons §12 立法 + working-style / tools-and-skills 條目化 雙落地、單點修正易飄
  - bug 可追蹤性:踩坑路徑明確(MCP vs CLI 抉擇)、條目化即一查就知
- **估時:** 30-45 min(加段字面 + 對齊 §12-31 / §12-32 引用、刀 3 立法收工同 session 完成)
- **依賴:** 刀 3 立法收工(§12-31 + §12-32 落地)
- **發現於:** 2026-05-12 / M-1-05 刀 1.5
- **相關:** `docs/lessons-learned.md` §12-31 + §12-32(刀 3 立法目標)、`docs/working-style.md` / `docs/tools-and-skills.md`、刀 1.5 commit body 字面

---

### #145. ✅ PHASE-1-MILESTONES §4.5 M-1-08 字面校準(useCascadeFilter → cascadeFilterReducer)

- **狀態:** ✅ 完成 2026-06-16(PHASE-1-MILESTONES L215/249/271/276「useCascadeFilter/cascade hook」→「cascadeFilterReducer 純函式」;同批 doc-drift)
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `docs/PHASE-1-MILESTONES.md` §4.5 M-1-08 原字面「packages/ui useCascadeFilter hook 抽出(三 Filter 共用邏輯)」
  - M-1-08 實作偵察揭示:`packages/ui` 為純 TS 套件、零 React 依賴(與 @pcm/domain / @pcm/adapters 同調);React hook 需 react 依賴 + jsdom + @testing-library 測試 infra、違反鐵則 4 / 8
  - Q2-redo=B 拍板:改為 framework-free `cascadeFilterReducer` 純函式 + `makeInitialCascadeState()` + action creators、三 Filter 元件自己 `useReducer` 接
  - §4.5 字面仍寫「useCascadeFilter hook」、與實作 `cascadeFilterReducer` drift
- **觸發事件(下次 PHASE-1-MILESTONES 修改 slice 順手即校準):**
  - 2026-05-17 / M-1-08 Q2-redo=B 拍板揭示
- **預期解法:**
  - 校準 §4.5 M-1-08 字面:`useCascadeFilter hook` → `cascadeFilterReducer 純函式`
  - 順手檢視 M-1-09 / M-1-10 / M-1-11 描述、若提及 hook 接法、對齊 `useReducer(cascadeFilterReducer, …)`
- **不修會痛在:**
  - 擴充性:Phase 2 新人依 §4.5 字面找「useCascadeFilter hook」會找不到、誤判功能未做
  - 可維護性:milestone 規劃文件字面 vs 實作 drift、文件失去 audit 價值
  - bug 可追蹤性:M-1-09/10/11 接 reducer 時若依 §4.5 舊字面推 hook 接法、撞型別錯
- **估時:** 10-15 min(§4.5 一行 + M-1-09/10/11 描述順手檢視)
- **依賴:** 無(下次動 PHASE-1-MILESTONES.md 順手)
- **發現於:** 2026-05-17 / M-1-08
- **相關:** #146、`packages/ui/src/filters/cascadeFilterReducer.ts`

---

### #146. ✅ cascadeFilterReducer useReducer bail-out 最佳化

- **狀態:** ✅ 完成 2026-06-16(commit 10f1c79:7 處「真 no-op → return state 原參考」bail-out〔重選同值且下層已空/clear 已空/clear-all 已空〕、React 跳重渲染;🔴 不誤殺 cascade reset〔model/year/sub 有值時重選上層仍清〕、3 回歸測 + code-reviewer 對抗推演零誤 bail)
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `cascadeFilterReducer` 對「邏輯上未改變狀態」的 input(重選已選的同一品牌 / 同一大分類、對空狀態 dispatch `clear-all`)仍配新物件回傳
  - 新參考使 React `useReducer` 無法 bail-out、強制 consumer 元件多餘 re-render
  - M-1-08 skill audit Round 2 效率 agent 揭示;A3 拍板:本刀不寫 guard、進 backlog
- **觸發事件:**
  - 2026-05-17 / M-1-08 skill audit Round 2 揭示
  - M-1-09 `FilterSide.tsx` 接 reducer 時啟動(consume reducer、真實 render 行為可驗 guard 精細度)
- **預期解法:**
  - `select-brand` / `select-main` / `select-model` 加「重選同值」檢查 guard(=== 比對 + 下層 ===undefined 確認)
  - `clear-vehicle` / `clear-category` / `clear-all` 加 isAlreadyEmpty guard
  - 寫 6 case 對應測試(3 重選 no-op + 3 clear no-op、`reducer(s, a) === s` 參考斷言)
  - guard 精細度對真實 render 驗、不可誤殺合法 cascade reset(重選同品牌時若已有 model/year 仍須清空)
- **不修會痛在:**
  - 擴充性:M-1-09/10/11 三 Filter + Phase 2 admin filter consume reducer、皆受多餘 re-render
  - 可維護性:`cascadeFilterReducer.ts` 註解校準後明示「全配新物件」為現行契約、bail-out 屬效能優化非正確性契約、延後不影響行為正確
  - bug 可追蹤性:consumer 多餘 render 屬微優化、生產環境 React DevTools profiler 可量、未做不阻功能
- **估時:** 30-45 min(M-1-09 內附帶)
- **依賴:** M-1-09 FilterSide.tsx 接 reducer
- **發現於:** 2026-05-17 / M-1-08 skill audit Round 2
- **相關:** #145、`packages/ui/src/filters/cascadeFilterReducer.ts`(reducer + L171 註解)

### #147. ⏳ mock-categories.ts L2 內容真實分類來源

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - M-1-09 新增 `apps/storefront/src/data/mock-categories.ts`(11 大分類巢狀、字面從 `design-reference/data/products.js` L73-157 直接搬)
  - 分類資料屬內容分級 L2(偶爾季度調整)、目前 hardcode mock、無後台來源
  - `count` 欄為 design mock 靜態值、與真實商品數無連動
- **觸發事件(任一觸發即啟動實作):**
  - 2026-05-18 / M-1-09 FilterSide.tsx CategoryTree 需巢狀 categories、storefront 無對應 mock 故新建
  - Phase 2 category 後台 CRUD / Supabase category 來源建立時
- **預期解法:**
  - mock-categories.ts 接 Supabase category 真資料(對齊 `mock-brands.ts` / `mock-products.ts` 同 d1-era mock → d2 adapter 模式)
  - `count` 改由真實商品數聚合、非靜態值
- **不修會痛在:**
  - 擴充性:Phase 2 後台改分類、前台 mock 不同步、FilterSide / FilterTop / FilterDrawer 三處顯示舊分類
  - 可維護性:分類調整需手改 mock-categories.ts、無單一真權威
  - bug 可追蹤性:`count` 與真實商品數不符時、難判是 mock 舊或聚合錯
- **估時:** 30-60 min(視 Supabase category schema)
- **依賴:** Supabase category 來源 / Phase 2 category CRUD
- **發現於:** 2026-05-18 / M-1-09
- **相關:** #148、`apps/storefront/src/data/mock-categories.ts`、`apps/storefront/src/data/mock-brands.ts`(同 d1-era mock 模式)

---

### #148. ⏳ dev-preview/* 臨時驗證 route 部署前移除

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - M-1-09 新增 `apps/storefront/src/app/dev-preview/filter-side/page.tsx` 作為 FilterSide 元件肉眼驗 harness(ProductsPage M-1-12 尚未做、無宿主頁)
  - M-1-10 / M-1-11(FilterTop / FilterDrawer)預期同樣新增 dev-preview route
  - dev-preview/* 屬開發臨時頁、不應上 production
- **觸發事件(任一觸發即啟動實作):**
  - M-1-12 ProductsPage 完成、Filter 元件有正式宿主頁、dev-preview 失去用途
  - M-6 / 部署前最終清理
- **預期解法:**
  - 刪除 `apps/storefront/src/app/dev-preview/` 整個目錄
  - 或保留但加 production 環境 404(視部署前討論)
- **不修會痛在:**
  - 擴充性:dev-preview route 隨 M-1-10 / 11 累積、不清理越來越多臨時頁
  - 可維護性:production 暴露 /dev-preview/* 開發頁、非預期對外
  - bug 可追蹤性:臨時頁混入正式 route、sitemap / SEO 掃描出非預期頁面
- **估時:** 10 min(刪目錄)
- **依賴:** M-1-12 ProductsPage 完成 / 或 M-6 部署前
- **發現於:** 2026-05-18 / M-1-09
- **相關:** #147、`apps/storefront/src/app/dev-preview/`

---

### #149. ✅ pcm-website-v2 與 pcm-line-bot 共用 Supabase DB 處置評估

- **狀態:** ✅ 完成(2026-05-19)
- **2026-05-19 完成:** LINE bot 併入 `pcm-quote-v2`、`line_*` 表搬去 pcm-quote-v2 的 Supabase(ref `dllwkkfanaebrsuyuedy`)。執行前檢查抓到 split-brain 分岔、已把 A 庫獨有 1 對話 + 10 訊息補進 pcm-quote-v2;A 庫殘留 5 張 `line_*` 表 + 7 筆孤兒 ledger 紀錄已清(migration `20260519152353_drop_orphan_line_tables`、走 Codex Review),`supabase db push` 已恢復正常。詳見 `docs/SUPABASE-LINE-BOT-MOVED.md`。
- **分流:** P1-before-launch
- **優先級:** 🟠 中
- **問題:**
  - pcm-website-v2 與另一專案 `/Users/sean_1/pcm-line-bot` 共用同一個 Supabase 專案(`bmpnplmnldofgaohnaok`)
  - 兩 repo 各有獨立 `supabase/migrations/`:pcm-line-bot 的 7 支 `line_*` migration 在 remote DB、不在本 repo;本 repo 的 `products` 系列 migration 不在 line-bot repo
  - 後果:`supabase db push` 從本 repo 跑會偵測到「remote 有 local 沒有的 migration」直接拒絕(Slice A 實測);本 repo 不再是 DB schema 完整真權威
- **觸發事件:**
  - 2026-05-19 Codex 審查後續處置 Slice A(products 欄位級 GRANT)套用時、`supabase db push` 失敗、改用 MCP `apply_migration` 繞過
- **預期解法(待 Sean 拍板,對應先前 Q2=A 延後決策):**
  - 方案 A:pcm-line-bot 併入本 monorepo(成 `apps/line-bot`)、單一 `supabase/migrations/`
  - 方案 B:維持兩 repo、指定本 repo 為 Supabase schema 唯一擁有者
  - 方案 C:pcm-line-bot 改用獨立 Supabase 專案、徹底解耦
  - 方案 D:維持現狀 + migration 紀律(見下)
  - 由 Claude Code 先偵察 pcm-line-bot(結構 / 技術棧 / 部署)再提完整 plan
- **操作紀律(立即生效、不待方案拍板):**
  - 任一 repo **絕不**跑 `supabase db pull` / `supabase db reset` / `supabase migration repair` —— 會試圖對齊而清掉另一專案的 migration
  - migration 一律走 MCP `apply_migration` 或精準手動套用、且 migration 檔版本對齊 remote ledger
- **不修會痛在:**
  - 擴充性:未來任一專案加 migration 都撞同樣的 db push 拒絕、每次繞過
  - 可維護性:兩 repo schema 真權威分裂、新人 clone 任一 repo 重建 DB 都不完整
  - bug 可追蹤性:DB schema 變更散在兩 repo + MCP 直套、出錯難定位是哪邊改的
- **估時:** 偵察 + 提 plan 30 min;方案落地視拍板(合併 repo 可能數小時)
- **依賴:** Sean 拍板選方案;Codex 審查後續處置 Slice A / B 收尾後啟動偵察
- **發現於:** 2026-05-19 / Codex 審查後續處置 Slice A
- **相關:** `supabase/migrations/20260519031049_products_base_table_column_grants.sql`、`docs/SUPABASE-LINE-BOT-MOVED.md`

---

### #150. 🧹 遺留未追蹤檔 triage(每 session 起手檢查雜訊)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - working tree 長期帶數筆遺留未追蹤檔 + 一個 auto-drift 檔,每個 Claude Code session 起手檢查都不全綠、要逐次人工判讀「哪些該管、哪些是噪音」
  - `.claude/` — session 設定資料夾,應進 `.gitignore`
  - `docs/progress-roadmap.html` — `/pcm-roadmap` skill 產物,需 decide commit 或 gitignore
  - `docs/recon/M-1-03-*.md`、`docs/recon/M-1-04-*.md` — 先前 slice 偵察文件,需 decide commit 或刪
  - `packages/adapters/scripts/` — 未追蹤腳本,需 decide commit 或刪
  - `apps/storefront/next-env.d.ts` — Next.js 自動產生檔,import 路徑被 build 改寫(`.next/dev/types` → `.next/types`),需 decide 還原或接受
- **觸發事件:**
  - 2026-05-19 M-1-10 起手檢查,工作樹不全綠;確認非 M-1-10 造成、屬先前 slice / skill 遺留,Sean 拍板 triage 獨立一輪做、不併進 M-1-10
- **預期解法:**
  - 獨立一輪逐檔 triage:`.claude/` 加 `.gitignore`;recon 文件 / `progress-roadmap.html` / `adapters/scripts/` 各自 decide commit 或刪;`next-env.d.ts` 還原(Next 會自動再產)
- **不修會痛在:**
  - 擴充性:遺留檔只會越積越多,未來 session 起手檢查雜訊更大
  - 可維護性:每 session 都要人工判讀「哪些該管哪些是噪音」、重複成本
  - bug 可追蹤性:真正該 commit 的產物(如 recon 文件)混在噪音裡、可能漏 commit
- **估時:** 20-30 min
- **依賴:** 無;Sean 對各檔去留拍板
- **發現於:** 2026-05-19 / M-1-10 起手檢查
- **相關:** #147

---

### #151. ⏳ 全站「目前車款」記憶(跨頁 + 跨次造訪持久化)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - 目前車款選擇(品牌 / 車型 / 年份)只活在 ProductsPage 元件 state、且被「清除全部」一併清除;換頁、重整、關閉再開都會遺失
  - PCM 核心使用情境是「找**我的車**能裝的零件」—— 車款理應像「目前車款 context」全站黏著:選一次後跨所有頁面 + 跨次造訪都記得,使用者不必每頁重選
  - design-reference 原有對應機制(`vehicleFilter` 為車款唯一真相 + `localStorage` 持久化 + `pcm-vehicle-filter-change` 跨頁事件),M-1-12 偵察判定屬 design harness 機制、Phase 1 未搬(見 `docs/recon/M-1-12-products-page-recon.md` §4)
- **觸發事件(任一觸發即啟動實作):**
  - M-1-12c-1 肉眼驗 Sean 提出「車款應像背景設定黏著、不被清除全部清掉」;2026-05-20 拍板 A:Phase 1 先用簡單版(車款隨清除全部清除)、本功能獨立 backlog 日後正式做
  - Phase 2「車輛履歷 / 車輛服務生態系」啟動時(車款 context 是其前置基礎)
- **預期解法:**
  - 先走 brainstorming / PRD 釐清:車款 context 存放層(未登入 localStorage / 登入後綁帳號)、跨頁讀取點、與「清除全部」「清除車輛」的範圍界線、與 Phase 2 車輛履歷 entity 的關係
  - 實作:全站「目前車款」context(provider 或持久化 store)+ 各頁讀取 + ProductsPage 的「清除全部」改為只清零件篩選、車款改由專屬「清除車輛」清
- **不修會痛在:**
  - 擴充性:Phase 2 車輛履歷以「使用者車輛」為一等公民,若車款 context 未先立,履歷功能要回頭補地基
  - 可維護性:現況車款 state 散在單頁,日後要全站化等於跨頁重接線,越晚做牽動面越大
  - bug 可追蹤性:車款若散落多頁各自 state,跨頁不一致的 bug 難定位;單一 context 真相源好追
- **估時:** PRD 0.5-1 天 + 實作待 PRD 拆;非單一 slice
- **依賴:** 無硬前置;建議與 Phase 2 車輛履歷 PRD 一起想
- **發現於:** 2026-05-20 / M-1-12c-1 肉眼驗
- **相關:** #147 / M-1-12 偵察報告 §4 / `docs/features/vehicle-service-ecosystem.md`

---

### #152. ⏳ ProductsPage 篩選未依車款 / 分類過濾商品

- **狀態:** 🟡 vehicle 部分 ✅ 完成(2026-07-03、S1 車輛篩選 slice:`matchesVehicle` 依真 fitment 逐層過濾〔品牌/車型/年份〕、清單由 `buildVehicleTaxonomy` 動態衍生、FilterSide hideVehicle 解除;缺年 fitment 語意 Sean 同日拍 **Q1=A** = 「該車型全年份適用、選了年份亦命中」、與 domain matchFitmentYear 統一、分歧解除〔資料查證:缺年非通用件、係車型專用 body work、546/3484 fitment 缺年〕);**category 部分仍 ⏳**(單一分類「碳纖維部品」、分類樹無意義、多分類上架 #212 後再議)
- **優先級:** 🟠 中
- **問題:**
  - ProductsPage 的 `filterProducts` 只依 brands / 現貨 / 新品 / 特價 / 顏色 / 價格過濾,**不依 cascade.vehicle / cascade.category**;使用者選車款或分類後,頁首標題、麵包屑、ActiveChips 標籤會變,但商品數與商品列表不變
  - 此為照搬 design ProductsPage.jsx —— design `filterProducts`(L85-116)本身就不過濾 vehicle / category
  - 根因:mock 資料未對映 —— 商品 `p.category` 為自由字串(如「操控部品 · 腳踏後移」)、與分類樹(`mock-categories`)節點名不對應;`p.fits` 為車輛適用自由字串(如「CBR600RR」「通用款」)、與 cascade.vehicle 結構化品牌/車型/年份無對映表
- **觸發事件(任一觸發即啟動實作):**
  - M-1-16 種子資料 import(200 SKU)落地 —— 真資料若帶結構化分類 id / 車輛適用對照,即可實作此過濾
  - 商品分類 schema / 車輛適用(fitment)schema 正式定義時
- **預期解法:**
  - 商品需帶結構化分類 id(對映分類樹 mainId/subId)+ 結構化車輛適用清單(品牌/車型/年份);`filterProducts` 補 category / vehicle 兩段過濾
  - 過渡期可考慮 UI 揭示(選了車款/分類但結果未變時提示),或暫時隱藏不生效的入口
- **不修會痛在:**
  - 擴充性:車款 / 分類是 PCM「依車找零件」核心,長期必須真的過濾,愈晚補牽動商品 schema 愈大
  - 可維護性:現況「UI 變、結果不變」對使用者是隱性 bug,易被誤報為故障
  - bug 可追蹤性:篩選邏輯與商品 schema 對映散落,無單一對照表時跨層 bug 難定位
- **估時:** 待商品分類 / fitment schema 定義後評估;非單一 slice
- **依賴:** M-1-16 種子資料 + 商品分類 / fitment schema
- **發現於:** 2026-05-20 / M-1-12 Codex review finding 4
- **相關:** #151 / M-1-12 偵察報告 §3 / M-1-16

---

### #153. ⏳ 3 篩選元件介於 300-400 行硬警戒區,候選拆子元件

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - FilterSide.tsx 336 行 / FilterTop.tsx 351 行 / FilterDrawer.tsx 350 行 —— 均落在鐵則 6「>300 行硬警戒、>400 行硬上限」之間,未超上限但長期應拆
  - 內含可獨立的子元件:FilterSide 的 `Accordion` / `VehicleTree` / `CategoryTree` / `CheckboxList` / `PriceRangeSlider`;FilterTop 的 `CategoryPanel`(L284 已是子函式)+ 5 個 dropdown 面板;FilterDrawer 的 6 個 tab panel
- **觸發事件(任一觸發即啟動實作):**
  - 任一檔案下次新增功能後接近或超過 400 行硬上限
  - M-1 段落間有空檔(M-1-13~16 完成後 / M-2 之前)
- **預期解法:**
  - FilterSide:抽出 `filter-side-parts.tsx` 或拆 5 子元件檔(Accordion 已可獨立)
  - FilterTop:`CategoryPanel` 抽檔;5 個 dropdown 面板抽 `filter-top-panels.tsx`
  - FilterDrawer:6 個 tab panel 抽 `filter-drawer-tabs.tsx`
- **不修會痛在:**
  - 擴充性:下一次加篩選欄位或子元件就會撞 400 上限,屆時被迫拆 + 新功能耦合
  - 可維護性:單檔 300+ 行讀起來吃力,定位某個 panel 要捲很遠
  - bug 可追蹤性:子元件 inline 在主檔,單元測試只能透過 Harness 整體測,不易精準 isolate
- **估時:** 各檔 30-45 min,3 檔合計 ~2 小時(可分 3 個 sub-slice 做)
- **依賴:** 無;建議 M-1-13~16 完成後一輪做完
- **發現於:** 2026-05-20 / M-1-12 Codex review round-2 次要觀察
- **相關:** 鐵則 6 / M-1-12

### #154. ⏳ 商品 not found 自訂 404 頁延後 M-6 SEO 統一(Q5=C 拍板)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(M-6-01 SEO 統一處理時 trigger)
- **問題:**
  - M-1-13b `/products/[slug]` 用 Next.js 預設 `notFound()` → 英文「This page could not be found.」、無自訂中文文案
  - 與既有 M-1-03 main-d-d2 拍板「目前沒有商品」/「載入失敗、請稍後再試」中文風格不一致
- **觸發事件:**
  - 2026-05-20 / M-1-13b 啟動前 audit 發現、Sean Q5 拍 C(延後處理 + 開 backlog 防 lose)
  - 觸發實作:M-6-01「SEO meta tags 各 page type」啟動時、連同 product / brand / category not-found 自訂頁一輪做完
- **預期解法:**
  - 沿用 d2 拍板字面風格、新建 `app/products/[slug]/not-found.tsx`(Next.js 16 慣例)
  - 文案類似:「商品不存在 — 請回商品目錄逛逛」+ Link 回 `/products`
  - 一併處理 brand / category / order not-found(M-6-01 範圍)
- **不修會痛在:**
  - 擴充性:Phase 1 上線後使用者遇到舊連結失效會看到英文 404、品牌一致性差
  - 可維護性:M-6-01 啟動時若忘記 backlog、會 lose 掉「沿用 d2 拍板字面」共識
  - bug 可追蹤性:無(純 UX)
- **估時:** 30-45 min(M-6-01 範圍內順手做)
- **依賴:** M-6-01 SEO meta tags 各 page type
- **發現於:** 2026-05-20 / M-1-13b 啟動前 audit
- **相關:** M-1-03 main-d-d2(d2 拍板 Q-empty=b / Q-error=b)/ M-6-01 / Q5=C

---

### #155. ⏳ 抽共用 PRODUCT_IMG_POOL + productGallery + swipe useRef hook(第 3 處撞才抽、Defer 模式)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低
- **問題:**
  - `ProductImage.tsx` 已有 PRODUCT_IMG_POOL(`:28-44`)+ productGallery(`:46-54`)(M-1-04-mini-slice 搬入;
    ⚠️ **2026-08-12 拆檔後座標更正**:原寫「ProductCard.tsx 已有」,該段已整組搬到 `ProductImage.tsx`、逐字未變 ⇒ 本條的「第 1 處」現在指新檔)
  - ProductPage.tsx M-1-13c 第 2 處 inline 同字面(因 13c 範圍小、不擴大動既有元件)
  - M-1-13c 新立 swipe useRef + onTouchStart/End pattern、storefront 第 1 處;第 3 處撞抽 hook
- **觸發事件(任一觸發即啟動實作):**
  - 第 3 處撞(對齊 lessons §84/§85 Defer 模式 + backlog #130 慣例)
  - M-1-16 真資料種子上線、PRODUCT_IMG_POOL + productGallery 整支廢、本條順手收
- **預期解法:**
  - lib:`apps/storefront/src/lib/product-gallery.ts`(共用 helper)/ `apps/storefront/src/hooks/useSwipeGesture.ts`(共用 hook)
- **不修會痛在:**
  - 擴充性:第 3 處撞需各自 inline、不一致風險
  - 可維護性:Unsplash photo id pool 變動需 2 處同步
  - bug 可追蹤性:swipe threshold(40px / 8px / 280ms)散落
- **估時:** 30-45 min
- **依賴:** 第 3 處撞 / M-1-16(任一)
- **發現於:** 2026-05-20 / M-1-13c
- **相關:** ProductCard.tsx line 17-41、ProductPage.tsx M-1-13c、backlog #130 Defer 模式

---

### #156. ⏳ 店家會員申請流程 PRD(Q-1=B 拍板)

- **狀態:** ⏳ 待執行(PRD 階段)
- **分流:** P1-before-launch(Sean 拍板 Phase 1 做)
- **優先級:** 🟠 中
- **問題:**
  - Customer schema(M-0-04)只有 id / email / tier 三欄、預設 tier='general'
  - 變 store / premium_store 目前**唯一**路徑 = 後台手動改 tier 欄位(無稽核紀錄)
  - 缺前台「店家申請」入口 + 後台「審核」介面 + 升等通知流程
  - 業務真實情境:店家不會「升等」、而是「原本就是店家、註冊後申請」(Sean 2026-05-20 業務語意澄清)
- **觸發事件(任一觸發即啟動 PRD):**
  - M-1-14 Customer schema 落地前 audit(register flow + tier 預設邏輯撞點)
  - M-1-15 LoginPage / RegisterPage 落地前 audit(前台註冊流程入口分流 — 一般客人 vs 店家入口)
- **預期解法(PRD 草稿方向):**
  - 申請表前台頁面(公司名 / 統編 / 聯絡人 / 營業地址 / 期望 tier)
  - Customer schema 擴欄:`application_status` enum(none / pending / approved / rejected)+ `requested_tier` + `applied_at` + `reviewed_at` + `reviewed_by`
  - 後台 admin 審核介面(apps/admin 新建 ApplicationsPage)
  - 通過 → 自動升等 tier + email / line 通知
  - 拒絕 → 註明原因 + 客戶可重新申請
- **不修會痛在:**
  - 擴充性:店家想申請只能打電話 / line 業務、無 self-service
  - 可維護性:後台手動改 tier 留無稽核紀錄、誰改的 / 何時改 / 為何改全失
  - bug 可追蹤性:某客人為何是 store tier 沒記錄、爭議時無據
- **估時:** PRD 60-90 min + 落地 3-5 個 slice(~3-4 hr)
- **依賴:** M-1-14 Customer schema
- **發現於:** 2026-05-20 / M-1-13c slice 對話岔題
- **相關:** Sean 拍板 Q-1=B、`packages/domain/src/identity/types.ts` Customer、M-1-14 / M-1-15

---

### #157. ⏳ 促銷活動系統 PRD(Q-2=B 拍板、B 路徑、L3 強制 PRD)

- **狀態:** ⏳ 待執行(PRD 階段、L3 內容、鐵則 9 強制 PRD)
- **分流:** P1-before-launch(Sean 拍板 Phase 1 做、推翻 NORTHSTAR v2 範圍)
- **優先級:** 🟠 中
- **問題:**
  - mock-products.ts 有 isSale + origPrice、但 Supabase products 表**無對應欄**(SALE 標純 mock 驅動)
  - 缺品牌層級促銷(LIGHTECH 全品牌 8 折)、缺分類層級促銷(避震全打 7 折)
  - 缺活動期間機制(雙 11 / 黑五 / 季末 5/20-5/27)
  - 跟三級 tier 折扣需獨立系統(身份折扣 vs 活動折扣不同維度)
  - 屬 L3 內容(每週可能新建活動、強制需後台 CRUD)、依鐵則 9 必先 PRD
- **觸發事件(任一觸發即啟動 PRD):**
  - **早 trigger:** M-1-16 真資料種子上架前(產品經理 admin 上架時需 SALE 機制)— Sean 拍 Phase 1 做、應為此 trigger
  - **晚 trigger:** Phase 2 M-3 期間獨立做(若 Sean 之後反悔回 NORTHSTAR v2 留 Phase 2)
- **預期解法(PRD 草稿方向):**
  - 新建 `promotions` 表:`id / type(product/brand/category) / target_id / discount_pct / start_at / end_at / active`
  - Promotion entity + IPromotionRepository port + SupabasePromotionAdapter
  - `computeEffectivePrice` 擴充:tier 算完價 × 適用 promotion 折扣(疊加邏輯需 PRD 拍板)
  - 後台 admin UI(apps/admin 新建 PromotionsPage、CRUD + 期間預覽)
  - 前台:ProductCard / ProductPage SALE 標來源從 product.isSale 改 promotion 查詢
  - ProductsPage 篩選器加「促銷中」分類
  - 首頁 Banner / 活動區塊(可選)
- **不修會痛在:**
  - 擴充性:雙 11 / 黑五靠人工逐筆改 origPrice、不可重複用、不可預先排程
  - 可維護性:活動結束要 unset、忘了 unset 變永久打折
  - bug 可追蹤性:某商品為何打折(身份 tier vs 活動 promotion 來源混)
- **估時:** PRD 90-120 min + 落地 5-7 個 milestone(~6-10 hr、屬獨立系列)
- **依賴:** M-1-14(Customer 含 tier、確認 server-side dispatch)/ M-1-16 種子前(若早 trigger)
- **發現於:** 2026-05-20 / M-1-13c slice 對話岔題
- **相關:** Sean 拍板 Q-2=B / 推翻 NORTHSTAR v2 / 鐵則 9 L3 強制 PRD / backlog #47(Order 層折扣)獨立議題 / `design-reference/components/Pricing.jsx` getPriceForTier

---

### #158. ✅ 手機底部 5 tab bar(MobileTabBar)漏元件補搬(2026-05-28 / #192 順手完成)

- **狀態:** ✅ 完成(2026-05-28、#192 slice 合搬;commit body 記錄)
- **實作摘要:** MobileTabBar.tsx + mobile-tabbar.css 字面從 design App.jsx L166-190 + tweaks.css L376-417 搬;routing 改 usePathname + <Link>;找車 + 購物車 tab 路由未建、暫 disabled(fold #195 / #194);product 詳情頁 .is-hidden 走 pathname.startsWith('/products/') && segments.length >= 2
- **分流:** P1-before-launch
- **優先級:** 🟠 中(M-1-14 / M-1-15 啟動前處理、不阻 13d~g 主線)
- **問題:**
  - design `App.jsx` line 162-193 有完整 `<nav className="mobile-tabbar">` 字面、5 個 tab(首頁 / 商品 / 找車 / 會員 / 購物車)+ SVG icon + label + active dot
  - storefront 完全沒搬(`apps/storefront/src/components/Mobile*` 不存在)
  - 為什麼漏:design 把 MobileTabBar 放在 `App.jsx`(SPA harness 容器)、不像 Header / Footer 是獨立 .jsx 檔;之前 audit 沒抓到「藏在 App.jsx 裡的元件」
  - 2026-05-20 / M-1-13c 收工肉眼驗階段 Sean 發現缺漏
- **觸發事件(任一觸發即啟動實作):**
  - M-1-14 Customer schema 落地後(會員 tab 連結需要登入頁存在)
  - M-1-15 LoginPage / RegisterPage 落地前 audit(那時補最自然、5 tab 連結指向 3 個未落地頁:找車 / 會員 / 購物車)
- **預期解法:**
  - 新建 `apps/storefront/src/components/MobileTabBar.tsx`(對齊 design `mobile-tabbar` className 字面)
  - 新建 `apps/storefront/src/styles/mobile-tabbar.css`(對齊 design styles/app.css 或 home.css 內 `.mobile-tabbar*` selectors)
  - 5 tab 用 Next.js `<Link href>` + `usePathname` 判定 active(取代 design SPA setPage state)
  - tab 路由對映:首頁 `/` / 商品 `/products` / 找車 `/vehicle-search`(待 M-1-15+ 建)/ 會員 `/account`(待 M-1-15)/ 購物車 `/cart`(待 M-3)
  - **特殊邏輯:** 商品詳細頁需**隱藏** tab bar(design line 193 字面:「Hide tabbar on product page — sticky buy bar is the primary control there」、跟 13e mobile-buy-bar 二選一);用 usePathname 判 `/products/[slug]` 隱藏
  - 接點:各 page layout / root layout 加 `<MobileTabBar />`(只在 < 900px 顯示、CSS @media query 控)
- **不修會痛在:**
  - 擴充性:手機體驗缺核心 nav、客人沒有快速跳 5 大區的入口
  - 可維護性:design 真權威字面落地不全、後台 / 前台對齊出 gap
  - bug 可追蹤性:Sean 肉眼驗已發現「沒做」、未來 audit / Codex Review 也會抓
- **估時:** 30-45 min(MobileTabBar.tsx + CSS + 商品頁隱藏 + 各 page 接)
- **依賴:** 無前置(可在 M-1-14 啟動前獨立 slice 跑、或合進 M-1-15 啟動前 audit 後)
- **發現於:** 2026-05-20 / M-1-13c 收工肉眼驗 Sean raise
- **相關:** `design-reference/components/App.jsx` line 162-193、M-1-14 / M-1-15、13e mobile-buy-bar 隱藏邏輯撞點

---

### #159. ⏳ filter-top.css 手機 responsive 字級漏(design 缺、storefront 對齊一致)

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(Phase 1 內手機字小但仍可讀、Phase 1 收尾 premortem 階段重評是否影響 conversion)
- **問題:**
  - design `filter-top.css` 全檔字面用 11/12/13/14 px 桌機字級階梯、**沒設計 @media 手機 fallback**(M-1-13d-fix-1 audit 證實 design 全 `styles/` 目錄無任何 `@media` 規則對 `.cft-*` / `.ft-*` selector)
  - storefront `filter-top.css` 100% 對齊 design 字面(對齊鐵則 1「design 是成品、直接搬」)、所以手機 viewport 看就是縮小看桌機字、字偏小
  - Sean 2026-05-20 M-1-13d 收工肉眼驗在 iPhone 14 Pro Max 模擬器發現:ProductsPage CascadeFilterTop 3 下拉「DUCATI 大 / Monster 中 / 2023 小、手機更小」、提及「之前就說過要修復」(可能涵蓋全站手機 responsive 字級、本條目僅 filter-top、其他元件若有同類問題另開條目)
- **觸發事件:**
  - 2026-05-20 / M-1-13d 收工肉眼驗 + M-1-13d-fix-1 audit 證實 design 缺手機 responsive
- **預期解法:**
  - **候選 A(Q2=A 拍板採用):** 報 Claude Design 補 `design-reference/styles/filter-top.css` 手機 @media fallback、storefront 跟著搬(對齊鐵則 1「design 是成品、直接搬」)
  - **候選 B:** storefront 自加手機 responsive、偏離 design、Design 補回對齊時雙軌清理(技術債、不採用)
- **不修會痛在:**
  - 擴充性:手機用戶選車款體驗差、字小難讀、可能影響 conversion(Phase 1 80% 流量來自手機假設下風險高)
  - 可維護性:全站可能有其他元件同類問題(Header / ProductCard / FilterDrawer 等)、若不立 backlog 系統追蹤、零星發現散落、未來全站盤點時要重做
  - bug 可追蹤性:Sean 提及「之前說過」表示已 lose 過一次、需立 backlog 確保下次不再 lose
- **估時:** Claude Design 補 + storefront 搬 30-45 min(視 design 字面複雜度)
- **依賴:** Claude Design 補完 `design-reference/styles/filter-top.css` 手機 @media fallback
- **發現於:** 2026-05-20 / M-1-13d 收工肉眼驗(Q2=A 拍板 audit)
- **相關:** `design-reference/styles/filter-top.css`、`apps/storefront/src/styles/filter-top.css`、`apps/storefront/src/components/CascadeFilterTop.tsx`、`apps/storefront/src/components/FilterTop.tsx`、M-1-13g responsive 收口時對齊評估

---

### #160. ⏳ ProductInfo 未來擴張清單(說明書連結 / 適用車款列表 / 影片 / 額外說明圖片)

- **狀態:** ⏳ 待 trigger
- **分流:** P1-now 或 Phase 2(待 13f audit 確認)
- **優先級:** 🟡 低(13f Tabs 啟動 / Phase 2 vehicle-service-ecosystem 啟動時撞)
- **問題:**
  - Sean 2026-05-20 M-1-13e Q3=A 拍板時補述、ProductInfo 商品資訊區未來除商品描述外、還會有:
    1. 商品說明書連結
    2. 適用車款列表(不只一台車、多車款結構化)
    3. 影片連結
    4. 額外提供的說明圖片
  - 本 backlog 為錨點、追蹤:
    - design `ProductPage.jsx` 字面有沒對應(Tabs L382-460 內 description / specs panel 可能含部分)
    - 是 Phase 1(隨 13f Tabs 處理、簡單版 hardcode mock 字面)還 Phase 2(屬 vehicle-service-ecosystem、影響商品 schema)
    - schema 預留欄位(若 Phase 2、影響 `packages/domain/src/catalog/types.ts` Product 結構)
- **觸發事件(任一觸發即啟動實作):**
  - 13f Tabs 啟動前 audit(對照 design Tabs 字面 + Sean 補述、判定 Phase 1 / 2 範圍)
  - Phase 2 `vehicle-service-ecosystem` PRD 啟動時(若 schema 預留欄位需就位)
- **預期解法:**
  - 13f 啟動前 audit `design-reference/components/ProductPage.jsx` L382-460(Tabs section、4 個 panel:description / specs / install / warranty)字面、對照 Sean 4 項補述清單
  - 判定:每項是 Phase 1 隨 13f hardcode mock 字面落地 / Phase 2 真實 schema 落地
  - 若 Phase 2、補 schema 預留欄位(`Product` entity 加可選欄位 `manuals: ManualLink[] | null` / `fits: VehicleFitment[]`(已存)/ `videos: VideoLink[] | null` / `extraImages: string[] | null`)
- **不修會痛在:**
  - 擴充性:Tabs schema 不就位、Phase 2 補時要回頭改商品 entity 與 mapper、影響面大
  - 可維護性:Sean 業務情報散在對話歷史、無 backlog 錨點易遺失(對齊鐵則 10「backlog 條目必寫」)
  - bug 可追蹤性:本條為錨點、防 lose、13f 啟動前自動觸發 audit
- **估時:** audit 30-45 min(13f 啟動前 + Sean 4 項補述對齊 + Phase 1/2 範圍拍板)
- **依賴:** 13f Tabs 啟動 / Phase 2 `vehicle-service-ecosystem` PRD 啟動
- **發現於:** 2026-05-20 / M-1-13e Q3=A 拍板補述(Sean 親口講 ProductInfo 未來擴張內容)
- **相關:** `design-reference/components/ProductPage.jsx` L382-460 Tabs section、`docs/features/vehicle-service-ecosystem.md`、`apps/storefront/src/components/ProductInfo.tsx`、`packages/domain/src/catalog/types.ts` Product entity

---

### #161. ⏳ storefront 偏離 design 字面 — 待 Claude Design 補對齊(方向反轉:design 跟 storefront 業務拍板)

- **狀態:** ⏳ 待 trigger
- **分流:** P1-now(影響 13e + 後續金額頁面 + 全站 UX 一致性)
- **優先級:** 🟠 中(防 design ↔ storefront 雙軌長期 drift、新 Claude Code session 進入 repo 讀 design 真權威時困惑)
- **問題:** Sean 業務拍板使 storefront 暫時為準、design 字面待補對齊、共 **4 處** 偏離:
    1. **ProductCard 沒貨徽章**(M-1-13e-pre-3 落地):
       - design `ProductCard.jsx` L101-103 仍含 `{!p.inStock && <div className="pcard-oos"><span>補貨中</span></div>}`
       - storefront `ProductCard.tsx` L141-145 已移除 JSX + `product-card.css` L58-75 已刪 `.pcard-oos` CSS
    2. **ProductPage Buy Btn conditional**(M-1-13 真做時將偏離):
       - design `ProductPage.jsx` L340-342 `pd-add-btn` conditional className + disabled + 「加入購物車/補貨中·通知我」conditional text
       - design L351 `pd-buynow-btn` disabled when !inStock
       - design L502-545 `pd-mobile-buybar` cart + buynow btn 同樣 disabled
       - storefront 13e 將寫死「加入購物車」永遠可點、無 disabled / 無 conditional text
    3. **現貨 filter UI 入口**(M-1-13e-pre-3 落地):
       - design `ProductsPage.jsx` / `FilterTop.jsx` / `FilterSide.jsx` / `FilterDrawer.jsx` 含「現貨」chip / checkbox
       - storefront 用 `SHOW_IN_STOCK_FILTER = false` feature flag 隱藏 UI、邏輯 / state / 過濾函式刻意保留(對齊鐵則 9 業務試水溫精神、未來 revisit 0 成本)
    4. **免運門檻 NT$ 5,000**(M-1-13H-3 落地、新增):
       - design `ProductPage.jsx` L302 字面「滿 NT$ 4,000 免運」
       - design `ProductPage.jsx` L358 / VariantCFull.jsx L85+L97 字面「NT$ 3,000」+「NT$ 4,000 免運」(同 design 檔內已不一致)
       - design VariantCFull L85 字面「含稅 · 滿 NT$ 4,000 免運」+ L97 字面「滿額免運 NT$ 3,000 以上」
       - storefront `.pd-price-sub` + `ProductServices` 統一 NT$ 5,000(M-1-13H-2 + M-1-13H-3 落地、對應 Sean 2026-05-21 M-1-13H plan Q1 業務拍板永久化)
       - **方向反轉(對齊 PRD §4 slice-3 字面):** storefront 為準、design 待 Sean 在 Claude Design 補對齊 NT$ 5,000(屬鐵則 1 例外、業務邏輯 = 價格、走 docs/decisions/ 仲裁)
- **觸發事件(任一觸發即啟動實作):**
  - 2026-05-21 / M-1-13e-pre-3 Sean 業務拍板「不顯庫存」+ Q=A「storefront 短期偏離 design」+ 補述「隱藏 filter」(實質 3 處偏離正式落地)
  - 2026-05-22 / M-1-13H-3 落地免運門檻 NT$ 5,000(第 4 處偏離正式立)
  - Sean 在 Claude Design 補 design 字面對齊(刪沒貨徽章 / 改 buy btn 字面無 conditional / 刪現貨 filter UI / 改免運門檻 5,000)、推 pcm-website-design GitHub 後、storefront 走 `git submodule update --remote design-reference/` 同步、grep 驗對齊
- **預期解法:**
  - Sean 在 Claude Design 修改 ProductCard.jsx / ProductPage.jsx / ProductsPage.jsx / FilterTop.jsx / FilterSide.jsx / FilterDrawer.jsx / VariantCFull.jsx(免運字面 4,000/3,000 → 5,000)對應字面、刪不顯庫存相關 UI / state branch
  - 推完後 storefront `git submodule update --remote design-reference/` + grep 驗對齊 + 刪 `SHOW_IN_STOCK_FILTER` flag(若 design 確定對齊、邏輯 / state 也可順手清:`extras.inStock` 欄、`products-filter-logic.ts` L52、ActiveChips 條件、ProductsPage / FilterDrawer 計數)
- **不修會痛在:**
  - 擴充性:design ↔ storefront 字面長期 drift、未來新功能對齊真權威時要先判斷「design 字面是 stale 還新」、開發成本上升
  - 可維護性:新 Claude Code session 進入 repo 讀 design 真權威時、發現 storefront 字面與 design 不一致、可能誤判 storefront 是 bug
  - bug 可追蹤性:本條為錨點、storefront 偏離 design 點明確記錄、未來 revisit 時 grep `SHOW_IN_STOCK_FILTER` / `.pcard-oos` / `補貨中` 即可找回偏離歷史
- **估時:** Claude Design 補(Sean 操作、視時間)+ storefront submodule update + grep 驗 30-45 min(視 design 補完範圍)
- **依賴:** Sean 在 Claude Design 修改 + 推 pcm-website-design GitHub
- **發現於:** 2026-05-21 / M-1-13e-pre-3 規劃階段 self-check audit(grep 抓出全站「現貨」filter 7 處使用點 + ProductCard 沒貨徽章 + ProductPage buy btn conditional 等多處偏離點)
- **相關:** design-reference/components/ProductCard.jsx L101-103 / ProductPage.jsx L340-342, L351, L502-545 / ProductsPage.jsx / FilterTop.jsx / FilterSide.jsx / FilterDrawer.jsx;storefront `ProductCard.tsx`(徽章移除)/ `product-card.css`(.pcard-oos 刪)/ `filter-state.ts`(SHOW_IN_STOCK_FILTER flag)/ `FilterTop.tsx` `FilterSide.tsx` `FilterDrawer.tsx`(flag 條件包);Sean 2026-05-21 業務拍板

---

### #162. ⏳ brand 表 country 欄位(副標「原裝進口」原產國)— Phase 2 接 Supabase

- **狀態:** ⏳ 待 trigger
- **分流:** P2-later(Phase 1 hardcoded 對沖、Phase 2 啟動商品 schema 上 Supabase 時順手)
- **優先級:** 🟡 低(顯示層美觀問題、不影響業務流程;但長期 drift 累積影響品牌資訊正確性)
- **問題:** M-1-13H-2 落地 ProductInfo `.pd-sub` 副標字面 `適用 {product.fits} · 義大利原裝進口`、brandCountry L2 hardcoded「義大利」對齊 design VariantCFull.jsx L83 字面;MOCK_PRODUCTS 20 件約 60% 義大利品牌(Lightech / CNC Racing / Brembo / Rizoma / Termignoni)、其餘 4 個品牌非義大利:
    - `AKRAPOVIČ` — 斯洛維尼亞
    - `ÖHLINS` — 瑞典
    - `GB RACING` — 英國
    - 其他可能新增品牌
- **觸發事件(任一觸發即啟動實作):**
  - Phase 2 商品 schema 上 Supabase(M-1-16 或之後、brand 表加 country 欄位)
  - Sean 拍板要求商品頁副標真區分原產國(改業務優先級)
- **預期解法:**
  - Supabase brand 表加 `country: text` 欄位(或 enum:義大利 / 斯洛維尼亞 / 瑞典 / 英國 / 日本 / 德國 / 美國 / ...)
  - ProductInfo `.pd-sub` 副標字面改 `適用 {product.fits} · {product.brand.country}原裝進口`(`MockProduct` type 也對應加 `brandCountry?: string` 過渡欄、Phase 1 不接表階段可選 hardcoded fallback「義大利」)
  - design 字面也需 Claude Design 補對齊(L83 字面從 hardcoded「義大利」改變數)、本條目觸發時連動推 Sean 動 Claude Design
- **不修會痛在:**
  - 擴充性:Phase 2 接 Supabase 真做時若才發現「副標 hardcoded」、要回頭追 ProductInfo 副標字面、開發成本上升
  - 可維護性:hardcoded「義大利」對非義大利品牌(Akrapovič 等)字面誤導、新 Code session 讀 storefront 可能誤判品牌
  - bug 可追蹤性:本條為錨點、未來 grep `義大利原裝進口` 或 `.pd-sub` 即可找回偏離歷史
- **估時:** brand 表 country 欄位 migration 5-10 min + ProductInfo 副標字面改 5 min + Claude Design 補對齊 30-45 min(Sean 端、視時間)
- **依賴:** Phase 2 商品 schema 上 Supabase / M-1-16 商品 fetcher + toUIProduct(p, tier) helper
- **發現於:** 2026-05-22 / M-1-13H-2 ProductInfo 副標落地(PRD docs/specs/M-1-13H-product-page-overhaul-plan.md §4 slice-2 字面拍板 Phase 1 hardcoded + backlog Phase 2)
- **相關:** apps/storefront/src/components/ProductInfo.tsx `.pd-sub`;apps/storefront/src/data/mock-products.ts MockProduct type;design-reference/components/explorations/VariantCFull.jsx L83 hardcoded「義大利」;Phase 2 Supabase brand 表 schema

---

### #163. ⏳ dev tier override 機制 — env 路徑被 turbo strict env 過濾、dev 驗用 cookie 繞過

- **狀態:** ⏳ 待 trigger(dev 工具缺陷、不影響 production)
- **分流:** P2-later(dev 體驗、不影響上線;但未來開發者驗會員價會再踩同坑)
- **優先級:** 🟡 低(production tier 來自真實登入 cookie、不受影響;純 dev 驗證便利性)
- **問題:** M-1-13H-7 收尾肉眼驗 tier-aware 經銷價時、Sean 用 `PCM_DEV_TIER_OVERRIDE=1 pnpm dev` + URL `?tier=store` 永遠看不到「經銷價」tag、來回 debug 半小時;根因:
    1. **turbo 2.x strict env mode 過濾**:`pnpm dev` → `turbo run dev` → `next dev`;turbo 2.9.7 預設 strict envMode、只傳 `turbo.json` 宣告過的 env 給子 task;`PCM_DEV_TIER_OVERRIDE` 未宣告 → 命令行帶的 env 被 turbo 攔下、`next dev` 的 `process.env.PCM_DEV_TIER_OVERRIDE` 是 undefined → `resolveTierFromRequest`(lib/tier.ts L38-41)的 URL `?tier=` override 路徑從頭沒開
    2. **`.env.local` 補寫亦未確實生效**(Sean 端 echo + 重啟仍無效、未深究是 dotenv 順序 / 路徑 / cwd)
    3. **tier 字面格式陷阱**:`designTierToSchema`(packages/domain/src/shared/utils.ts L43-56)只認 design snake_case `general` / `store` / `premium_store`;URL / cookie 傳 camelCase `premiumStore` → throw → catch fallback `general`(初期驗收 URL 誤寫 camelCase 加劇混亂)
- **dev 驗證正解(已驗證可用、繞過所有 env 問題):**
  - DevTools Console 設 cookie:`document.cookie = "pcm-tier=store; path=/"; location.reload()`
  - `resolveTierFromRequest` 的 cookie `pcm-tier` 路徑**不受** `PCM_DEV_TIER_OVERRIDE` flag 限制(flag 只 gate URL `?tier=`)、設 cookie 即觸發、不用 env / 不改 URL / 不重啟 dev
  - premium 版:`pcm-tier=premium_store`(snake_case);還原:設空 + expires 過去
- **觸發事件(任一觸發即啟動實作):**
  - 未來開發者 / Sean 再次需 dev 驗會員價 tier-aware 顯示
  - turbo / Next.js 版本升級重評 env 傳遞機制時
- **預期解法(二選一或併):**
  - A(讓 URL `?tier=` 路徑可用):`turbo.json` dev task 加 `"passThroughEnv": ["PCM_DEV_TIER_OVERRIDE"]`、讓 `PCM_DEV_TIER_OVERRIDE=1 pnpm dev` 命令行 env 傳得進 `next dev`;入版控、正規 turbo 解法
  - B(文件化 cookie 驗法):docs / README 記 dev 驗 tier 用 cookie `pcm-tier`、不依賴 env override(零 code 改動、最低成本)
  - 推薦:B 先文件化(立即可用)、A 視未來頻率評估(動 turbo.json config 屬鐵則 8、需 mini-slice)
- **不修會痛在:**
  - 擴充性:M-1-16 接 Supabase 真實會員登入後 tier 來自真 cookie、env override 路徑漸無用;但 dev 階段(M-1-14/15/16 前)驗 tier-aware UI 仍需便捷 override
  - 可維護性:env override 路徑「看似存在實則失效」、新開發者讀 lib/tier.ts 以為 `?tier=` 能用、實際被 turbo 過濾、誤判 code bug
  - bug 可追蹤性:本條為錨點、未來 grep `PCM_DEV_TIER_OVERRIDE` / `passThroughEnv` / `pcm-tier` 即可找回機制與正解
- **估時:** A turbo.json 加 passThroughEnv 5 min + 驗 10 min;B 文件化 10 min
- **依賴:** 無(獨立 dev 工具修正)
- **發現於:** 2026-05-22 / M-1-13H-7 收尾 Sean 肉眼驗 tier-aware 經銷價時 debug(Cowork bash grep tier.ts + turbo.json 確認 strict env 過濾 + designTierToSchema snake_case 格式)
- **相關:** turbo.json(dev task envMode);apps/storefront/src/lib/tier.ts L34-49 resolveTierFromRequest;packages/domain/src/shared/utils.ts L43-56 designTierToSchema;apps/storefront/src/app/products/[slug]/page.tsx(M-1-13H-7 searchParams hydrate fix);apps/storefront/.env.local(本機、gitignore)

---

### #164. ⏳ design vehicle-drawer.css 抽屜選車器 storefront 未建

- **狀態:** ⏳ 待 trigger(design 有、storefront 未對應建)
- **分流:** P2-later(視 design 全站對 vehicle-drawer 使用頻率;低頻 Phase 2 可接受、高頻評估搬 Phase 1)
- **優先級:** 🟡 低(VehicleFinder 桌機 inline 三 select bar 已建並運作、抽屜為另一入口形式、不阻塞 Phase 1)
- **問題:**
  - 真權威字面:design-reference/styles/vehicle-drawer.css(.vf-overlay 抽屜式右側滑入選車器、37 處 .vf-* 樣式)
  - storefront 現況:VehicleFinder 元件已建(.ed-finder 樣式、桌機 inline 三 select bar、真權威 = home.css 的 .ed-finder* 21 處)、但 design 另有抽屜式選車器(.vf-overlay)未對應建
  - 影響:視 design 全站對 vehicle-drawer 的使用頻率而定;若僅特定流程觸發、屬 Phase 2 範圍可接受;若高頻則需評估搬到 Phase 1
- **觸發事件(任一觸發即啟動實作):**
  - Phase 2 啟動車種跨頁全站同步、需統一選車器入口
  - design 全站 vehicle-drawer 使用頻率經確認為高頻
- **預期解法:**
  - port design vehicle-drawer.css(.vf-overlay)+ 對應抽屜元件(右側滑入)、作為全站車種選擇統一入口、收斂目前 VehicleFinder(首頁)+ cascade(FilterTop / FilterDrawer)雙來源
- **不修會痛在:**
  - 擴充性:抽屜式選車器設計獨立、未來可作為「全站車種選擇」統一入口、收斂目前 VehicleFinder 桌機 + cascade 雙重來源
  - 可維護性:目前 VehicleFinder 只在首頁、抽屜在全站可重用;不建則維持雙來源
  - bug 可追蹤性:不建 = 全站車種選擇行為不一致(首頁 ed-finder vs cascade FilterTop vs FilterDrawer)
- **估時:** 待評估(取決於抽屜元件互動複雜度 + 全站接入點數量)
- **依賴:** 無(獨立元件、可隨時補)
- **發現於:** 2026-05-22 / M-1-13I V1 manifest audit
- **相關:** design-reference/styles/vehicle-drawer.css;apps/storefront/src/components/VehicleFinder.tsx;apps/storefront/src/styles/home.css(.ed-finder* 21 處);#151(URL 格式雙格式並存)

---

### #165. ⏳ ProductPage / ProductsPage 過 300 行警戒線、未來拆檔評估

- **狀態:** ⏳ 待 trigger(未過 400 必拆線、暫不拆)
- **優先級:** 🟡 低(功能正常、純檔案大小衛生)
- **問題:**
  - ProductPage.tsx 336 行 / ProductsPage.tsx 348 行、皆過鐵則 6「>300 行硬警戒」、未過「>400 行必拆」線
  - commit `1d82425`(M-1-13I)body 已揭示警戒;本條目作穩定追蹤錨點、避免後 audit 從 commit log 翻找
- **觸發事件(任一觸發即啟動實作):**
  - ProductPage / ProductsPage 任一 sub-slice 預估加完 > 400 行
  - 下次大改這兩檔時順手評估
- **預期解法(拆檔候選):**
  - ProductsPage:parseVehicleFromUrl helper 抽 utils(如 product-list-url.ts)
  - ProductPage:withVehicle helper 抽 utils(如 product-page-utils.ts)
  - 其他 inline 子元件 / helper 視情況外移
- **不修會痛在:**
  - 擴充性:helper 已是明確抽檔入口、預先規劃拆法、未來不在 hot path 臨時拆
  - 可維護性:超過 400 行的元件難讀難改
  - bug 可追蹤性:本條目讓未來 audit 看到警戒置頂、不必翻 commit log
- **估時:** 拆檔 30-45 分(觸發時)
- **依賴:** 無
- **發現於:** 2026-05-22 / M-1-13I 階段 C code-reviewer
- **相關:** apps/storefront/src/components/ProductPage.tsx;apps/storefront/src/components/ProductsPage.tsx;鐵則 6

---

### #166. ⏳ vehiclePill 巢狀互動元素 a11y 長遠重構

- **狀態:** ⏳ 待 trigger(Phase 2 a11y review)
- **優先級:** 🟡 低(行為與 a11y 正確、純 HTML 規範潔淨度)
- **問題:**
  - vehiclePill 結構 = 外層 `<button onClick=導航>` 內嵌 `<span role="button" tabIndex={0} onClick=清車 onKeyDown>`、屬巢狀互動元素(2 個 interactive)
  - 行為與 a11y 正確(× 子節點可 Tab 聚焦、Enter/Space 觸發清車、stopPropagation 阻止外層導航)、但 HTML 規範上 button 不應含互動後代
  - 背景:design ProductPage.jsx 原結構即 span 外層 + button 內層(button 嵌 button、亦違規);M-1-13I 改 storefront 為 button + span role=button、屬必要修正(commit `1d82425` body 揭示)
- **觸發事件(任一觸發即啟動實作):**
  - Phase 2 a11y audit
  - 未來導入 jsx-a11y 嚴格 lint(若命中 no-nested-interactive 類規則)
- **預期解法(候選):**
  - (a) 拆 flex 兩獨立按鈕(膠囊本體 + ×、視覺並排看似連體)
  - (b) 外層改非互動容器(div/span)+ 兩個內層 button
  - (c) 不修、接受偏離(行為與螢幕閱讀器皆正常)
- **不修會痛在:**
  - 擴充性:結構候選已列、未來重構有方向
  - 可維護性:本條目避免下 session 誤判已最佳解
  - bug 可追蹤性:a11y audit 不會誤以為無待辦
- **估時:** 重構 20-30 分(觸發時)
- **依賴:** 無
- **發現於:** 2026-05-22 / M-1-13I 階段 C code-reviewer
- **相關:** apps/storefront/src/components/ProductPage.tsx(vehiclePill);commit `1d82425`

---

### #167. ✅ react-hooks 字面誤導註解掃清 + CLAUDE.md 段對齊實況(repo 未裝 plugin)

- **狀態:** ✅ 完成 2026-06-16(source prose 誤導註解已隨檔重寫消失〔ProductInfo/ProductsPage grep 零殘留〕、CLAUDE/AGENTS 已對齊;本批補修 docs/lessons-learned.md §2-5 把未開 v7 規則〔purity/set-state-in-effect〕加「未開、見 #168」限定 → 全收;同批 doc-drift)
- **優先級:** 🟡 低(不影響運作、純註解 / 文件準確度)
- **M-1-13Z 更新(2026-05-23):** install slice 已裝 eslint-plugin-react-hooks v7.1.1 + 開 rules-of-hooks / exhaustive-deps,下方「問題」所述「repo 未裝 plugin」「CLAUDE.md 描述 purity…」皆隨之解決;ProductInfo.tsx L54/L61 deps 多餘 product.id 已於本 slice 修。**下方問題段指針作廢提醒:** ProductsPage 原 M-1-13I「明述 repo 未裝 plugin」那段 mount-effect 註解(問題段所指 L209)已於本 slice 改寫為 `eslint-disable-next-line` + 冪等理由,該 L209 舊字面已不存在於 source、勿照舊行號 grep。**剩餘範圍縮為:** ProductInfo.tsx L7/L75 兩段 prose 註解措辭校準 + 全 repo `grep react-hooks` 殘留字面掃清,留 follow-up slice 獨立處理。
- **問題(以下為 2026-05-22 發現時記錄、部分已由 M-1-13Z 解決、見上方更新):**
  - repo ESLint **未裝** eslint-plugin-react-hooks(eslint.config.js 僅 boundaries + no-restricted-imports);CLAUDE.md L418-424「### React 19 hooks 嚴格」段卻描述 react-hooks/purity + set-state-in-effect + 用 eslint-disable-line 追蹤、讀來像規則 active
  - 源碼現況(已無 disable 指令殘留):ProductInfo.tsx L7 / L75 有 **prose 註解**提及「防 React 19 react-hooks/exhaustive-deps stale closure」(說明為何補 deps、非 disable 指令);ProductsPage.tsx L209 已是 M-1-13I 改寫的正確註解(明述 repo 未裝 plugin)
  - M-1-13I 已修:原指令含 `// eslint-disable-next-line react-hooks/exhaustive-deps`、code-reviewer 抓出 repo 未註冊該規則(disable 不存在規則會 lint 報錯)、Code amend 移除(commit `1d82425`)
- **觸發事件(任一觸發即啟動實作):**
  - 決定裝 react-hooks plugin 時(先掃清舊誤導註解 + 升級 CLAUDE.md 段)
  - 下次有人新加 react-hooks 相關註解、reviewer 重抓時
- **預期解法:**
  - `grep -rn "react-hooks" apps/*/src packages/*/src`(排除 .next / dist / node_modules)列出全部出現點
  - ProductInfo.tsx 等 prose 註解改述事實(補 deps 是工程判斷、非 react-hooks 規則強制)、或保留但明示「repo 未裝 plugin」
  - CLAUDE.md L418-424 段升級:標明「目前 repo 未裝 react-hooks plugin、若新增需評估」、或直接裝 plugin 名實相符(屬另一獨立 slice、Cowork 規劃中)
- **不修會痛在:**
  - 擴充性:本條目作為「裝 plugin 前先掃清」依據
  - 可維護性:誤導註解讓讀者以為 plugin 在守、行為理解偏差
  - bug 可追蹤性:有條目下 session 看到同類註解不會誤判
- **估時:** 15-25 分(視 grep 出幾處;不含裝 plugin 本身)
- **依賴:** 與 react-hooks plugin install slice(Cowork 規劃中)連動
- **發現於:** 2026-05-22 / M-1-13I 階段 C code-reviewer
- **相關:** memory project-eslint-no-react-hooks-plugin;CLAUDE.md L418-424;apps/storefront/src/components/ProductInfo.tsx;eslint.config.js

---

### #168. ⏳ eslint-plugin-react-hooks v7 新規則開啟評估

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟡 低(plugin 已裝、現開 2 條規則已護欄 React 基線;新規則屬「升一級嚴格」、不修不影響運作)
- **問題:**
  - M-1-13Z install slice(2026-05-23)裝 eslint-plugin-react-hooks v7.1.1、只開 rules-of-hooks + exhaustive-deps 兩條 v5 老規則(Sean Q2=A 拍板保守設定)
  - v7 內含未開的新規則(從 npm pack 抽 .d.ts):
    - `react-hooks/purity` — 拒絕 render body 內 `Date.now()` / `Math.random()` 等不純呼叫
    - `react-hooks/set-state-in-effect` — useEffect 內 setState 邏輯(對 `try/finally` vs `.catch()` AST 敏感)
    - `react-hooks/no-deriving-state-in-effects` — 打 useState + useEffect 同步衍生 state 的 pattern
    - `react-hooks/immutability` — props / state 不可變紀律
    - (其他:`refs` / `static-components` / `use-memo` / `preserve-manual-memoization` / `component-hook-factories` / `error-boundaries` 等、完整清單從 npm pack 抽 `.d.ts`)
  - 開啟時機未定、需 follow-up slice 評估
- **觸發事件(任一觸發即啟動實作):**
  - M-1-14 之前 / Sean 主動拍
  - v7 升 0.x.y 出新規則時
  - 新加 React code 撞到該擋的 pattern(case-by-case 視 review 結果決定)
- **預期解法:**
  - follow-up slice 評估每條新規則對 storefront 現有 code 的違規數
  - 預估冒 10-30 條違規(purity 打 render body、set-state-in-effect 打 useEffect 內 setState、no-deriving-state 打 useState + useEffect 同步衍生)
  - 違規逐條評估修法:useMemo / useRef / 重構 logic;case-by-case
  - 規則開啟批次 vs 漸進(可一次全開或分階段、視違規數)
- **不修會痛在:**
  - 擴充性:Phase 2 多人協作時、新加 React code 可能踩 v7 新規則該擋的坑、回去修費時
  - 可維護性:現開 2 條已能擋 stale closure / 漏 deps 大宗 bug、新規則屬「再嚴一級」、不開短期不痛、累積愈晚開愈痛
  - bug 可追蹤性:不開 = 多潛在 React bug 入口(render body 不純呼叫 / setState 在 effect 內未防 / state 衍生 pattern 等)、開 = 違規清單明確
- **估時:** 60-90 分鐘(install slice 多 4-6 倍時間、視違規數)
- **依賴:** 無前置;可獨立啟動
- **發現於:** 2026-05-23 / M-1-13Z install slice(Sean Q2=A 拍板路徑)
- **相關:** #167(react-hooks 字面誤導註解掃清);CLAUDE.md L418-424;eslint.config.js React block

---

### #169. ✅ next-env.d.ts 加 .gitignore 評估(Next 16 自動生成檔)

- **狀態:** ✅ 完成(2026-06-17 A 方向 config slice;root .gitignore Next.js 段加 `apps/storefront/next-env.d.ts` + `git rm --cached` 從 tracking 移除〔本機檔保留〕;實證 pnpm build 後 next-env.d.ts 重生但被 gitignore、工作樹零 tracked dirty;三綠 typecheck/lint/build 全綠)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(不影響運作、影響工作樹 cleanliness)
- **問題:**
  - apps/storefront/next-env.d.ts 是 Next.js 自動生成檔(檔頭明寫 `// NOTE: This file should not be edited`)
  - 當前 repo 把它 tracked(歷史 commit 含)、Next 16 build 觸發自動更新會導致 dirty
  - M-1-13Z install slice 跑 build 後本機 dirty、Sean Q1=A 拍納入該 slice commit 跟上狀態、但長遠每次 build 都 dirty 不是根治
  - Next.js 官方 docs 建議 next-env.d.ts 加 .gitignore(讓每次 build 自動生成、不入版控)、PCM repo 沒對齊
- **觸發事件(任一觸發即啟動實作):**
  - 下次因 next-env.d.ts dirty 觸發 Sean / Code 處置時
  - Next 16 patch 升級 + next-env.d.ts 字面變更時
  - 工作流升級評估 working tree cleanliness 紀律時
- **預期解法:**
  - 加 `apps/storefront/next-env.d.ts` 進 .gitignore(或 root .gitignore + apps/storefront/.gitignore 視結構)
  - `git rm --cached apps/storefront/next-env.d.ts` 從 tracking 移除(保檔在本機)
  - commit 一刀「chore(infra): next-env.d.ts 加 gitignore、Next 16 自動生成不入版控」
  - 跑 build 確認下次不再 dirty
- **不修會痛在:**
  - 擴充性:每次 Next 升級 / build 流程動就觸發 dirty、長遠累積誤判
  - 可維護性:每 session 起手 5 綠檢查可能 fail 在這檔、要每次處置(納入 / restore)、浪費判斷時間
  - bug 可追蹤性:dirty file 混進 commit 容易污染歷史、未來 audit 時找不到原因
- **估時:** 10-15 分鐘(改 .gitignore + git rm --cached + 跑 build 驗 + commit)
- **依賴:** 無前置
- **發現於:** 2026-05-23 / M-1-13Z install slice(外部 reviewer M3 抓 dirty file + Sean Q1=A 拍納入時順手記)
- **相關:** apps/storefront/next-env.d.ts;Next.js 官方 docs

### #170. ✅ M-1-14f2 LINE OAuth email 缺失 / collision 處理(Codex C1 → f2 內解決)

- **狀態:** ✅ 於 M-1-14e-f2-a2 解決(Sean 2026-05-25 Q2=A/Q3=A 拍板 + codex 關卡1 finding-2 補強;collision 守衛已落地 line-admin.ts authenticateLineUser + 註冊端 denylist field-validation.ts)
- **分流:** P1-before-launch
- **優先級:** 🟠 中(原 M-1-14f2 阻塞、已隨 f2 一併處理)
- **問題(原):**
  - handle_new_auth_user trigger 把 NEW.email 寫入 customers.email NOT NULL UNIQUE
  - LINE OAuth 用戶若拒 email scope → NEW.email = NULL → trigger 寫 NOT NULL fail → auth.users insert rollback
  - email collision(已有同 email 用戶用 email/password 註冊、後用 LINE 拿同 email)→ UNIQUE 違反 → rollback
- **實際解法(採「選項 B 變體」、不改 trigger):**
  - **合成 email 以 line_user_id(OIDC sub)為鍵**:`line_{sub}@line.pcmmotorsports.local`(固定常數網域、非 env)。
  - **永不為 NULL** → 解掉 NOT NULL rollback;**命名空間隔離** → 與真實 email/password/Google 帳號永不撞號 → 解掉 cross-provider UNIQUE rollback。
  - 真實 LINE email(若 scope 核准)只存 `user_metadata.line_email`、**永不用於對應**(LINE 無 email_verified、不可 by-email 併帳)。
  - **防冒登入守衛(codex 關卡1 finding-2)**:合成 email 撞 already-registered 時、須查既有 user 確認 `provider==='line'` 且 `line_user_id===sub` 才放行;另註冊端封鎖合成網域(雙重防線)。
  - 不改 trigger / schema / 不產 migration(既有 DB 已支援)。
- **遺留 follow-up:** LINE 會員 `customers.email` 為合成值、AccountPage 顯示策略 + OAuth 會員補真實 email/phone → 併入 [[#179]] item 3(OAuth 補 phone 流程)同一 stage g 處理。
- **依賴:** M-1-14f2 LINE OAuth、handle_new_auth_user trigger(M-1-14a)
- **發現於:** 2026-05-23 / M-1-14a-patch / Codex Review C1 · **解決於:** 2026-05-25 / M-1-14e-f2
- **相關:** M-1-14f2 LINE OAuth、handle_new_auth_user trigger、#179 item 3

### #171. ⏳ RLS policy 性能優化:auth.uid() 包 (select auth.uid())(Codex C3)

- **狀態:** ⏳ 待執行(性能優化、非阻塞)
- **分流:** P1-before-launch
- **優先級:** 🟢 低(Phase 1 規模不卡、Phase 2 量大才痛)
- **問題:**
  - M-1-14a migration RLS policies(customers / addresses / vehicles / wallet_ledger)直接用 auth.uid()
  - Supabase 建議改 (select auth.uid()) 避免 per-row function call、單次查詢計算 1 次
  - 4 表 × 4-5 policy = 16+ 處需改
- **觸發事件:** M-1-14 完整收尾後 / 或量大撞性能時
- **預期解法:**
  - 新 migration 全改 `(select auth.uid()) = ...`
- **不修會痛在:**
  - 擴充性:Phase 2 規模上來、large-set query 每 row 跑 auth.uid() 慢
  - 可維護性:後續 RLS 沿用此 pattern、不修一次到位後改更累
  - bug 可追蹤性:性能問題、不易在 dev 發現
- **估時:** 30 min(新 migration 全改)
- **依賴:** M-1-14a RLS policies(已落地)
- **發現於:** 2026-05-23 / M-1-14a-patch / Codex Review C3
- **相關:** docs/architecture/supabase-schema-design.md §9 RLS、Phase 2 規模觸發

### #172. 🟡 rls_auto_enable / ensure_rls event trigger 納管 + EXECUTE 收斂(Sean Q1=A)

- **狀態:** 🟡 部分完成(M-1-16a 2026-05-31:function 定義 `CREATE OR REPLACE` 納管 + `REVOKE EXECUTE FROM PUBLIC,anon,authenticated` ✅、advisor 0028/0029 已清 ✅;**剩 `ensure_rls` event trigger 可重播納管未做**〔D2=A 輕量版、event trigger 已在線上運作 owner=postgres、重建有權限 + 安全網瞬斷風險〕)
- **分流:** P1-before-launch
- **優先級:** 🟠 中(安全網本身有用、但「未進版控的隱形 infra」是技術債 + 2 個 advisor WARN)
- **問題:**
  - DB 有一個 event trigger `ensure_rls` + function `public.rls_auto_enable()`(owner postgres、SECURITY DEFINER、`SET search_path='pg_catalog'`):監聽 `CREATE TABLE` / `CREATE TABLE AS` / `SELECT INTO`,自動對 public schema 新表跑 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`(安全網、防漏鎖)。
  - **不在任何 migration 檔內** = DB 物件未進版控的 drift(`supabase db reset` 重播會遺失、誰建的查不到)。
  - advisor security 2 個 WARN:`anon`/`authenticated_security_definer_function_executable`(0028/0029)— public SECURITY DEFINER function 被 PostgREST 暴露成 `/rest/v1/rpc/rls_auto_enable` 可呼叫(實際風險低:event trigger function 單獨呼叫等於空轉、`pg_event_trigger_ddl_commands()` 在非 DDL context 無資料,但 best practice 仍應收斂)。
- **觸發事件:** Sean Q1=A 拍板「該做」、專門 slice(不擋 M-1-14c~h 進度)
- **預期解法:**
  - ✅(M-1-16a `20260531142534_govern_rls_auto_enable.sql`)`rls_auto_enable()` function 定義 `CREATE OR REPLACE` 納管(逐字抄線上 pg_get_functiondef、同義重建)
  - ✅(M-1-16a)同 migration `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated`(收斂 0028/0029、對齊 M-1-14a 對 handle_new_auth_user / sync_wallet 的處置)
  - ✅(M-1-16a)get_advisors security 確認 0028/0029 兩 WARN 清除
  - ⏳ 剩:`ensure_rls` event trigger 可重播納管(`CREATE EVENT TRIGGER` 無 OR REPLACE、需 idempotent DO block 先 DROP;owner=postgres 權限 + DROP 瞬間安全網消失風險)— D2=A 輕量版暫不做、留此子項
- **不修會痛在:**
  - 擴充性:未進版控的 infra、新環境 / db reset 無法重建這層安全網、新表可能漏鎖
  - 可維護性:誰建的、為何建查不到;後續想改安全網行為(如擴 schema 範圍)無檔可改
  - bug 可追蹤性:advisor 長期掛 2 WARN、淹沒未來真正的新 WARN、降低 advisor 信噪比
- **估時:** 20-30 min(新 migration 抽現有定義 + REVOKE + advisor 驗)
- **依賴:** 無前置(獨立 migration);可與 #171 RLS 性能優化合併一個 migration
- **發現於:** 2026-05-23 / M-1-14a / advisor 掃描時發現既有 infra、Sean Q1=A 拍板納管
- **相關:** #171(同屬 RLS migration 範疇、可合併)、M-1-14a handle_new_auth_user / sync_wallet REVOKE EXECUTE 處置

### #173. ⏳ Phase 1「Confirm email OFF」上線交易前須補回 email 驗證(M-1-14e Q1=A)

- **狀態:** ⏳ 待執行(上線含 email 交易前必處理)
- **分流:** P1-before-launch
- **優先級:** 🟠 中(Phase 1 開發 / demo 不卡;一旦寄交易信 / 開放真實註冊就成風險)
- **問題:**
  - M-1-14e Q1=A 拍板「註冊後直接登入」(對齊 design AccountPages.jsx L263-266 `loggedIn:true → onNav('account')`、PRD §8.1 L739 只 signUp 未強制驗證、鐵則 1 真權威)。
  - 落地需 Sean 在 Supabase Auth 後台關閉「Confirm email」→ signUp 後 session 立即可用、不寄驗證信。
  - 代價(Confirm email OFF 後遺症):
    1. **無效 / 拼錯 email 也能註冊** → 後續訂單通知信 / 交易信寄不到。
    2. **email 找不回帳號** → 無驗證 = 不確定 email 真屬該用戶,密碼重設 / 帳號救援不可靠。
    3. **他人 email 冒名註冊** → 可用別人 email 開帳號(無 ownership 證明)。
- **觸發事件:** 上線開放真實註冊 / 開始寄 email 交易通知前(M-1 收尾 premortem step-2 排「最晚拍板日」候選)。
- **預期解法:**
  - 上線前 Supabase 後台重開「Confirm email」+ storefront 補「請收信驗證」UI 流程(register 後不直接登入、改顯示驗證提示)。
  - AuthResult 已預留 `needsEmailConfirmation` 欄位(M-1-14e-1),開驗證後 UI 直接分支、不需改 port 契約。
- **不修會痛在:**
  - 擴充性:Phase 2 履歷 / 訂單 / 儲值都靠可信 email 通知,未驗證 email 整條通知鏈不可信。
  - 可維護性:愈晚補、累積的未驗證帳號愈多,回填驗證 / 清假帳號成本愈高。
  - bug 可追蹤性:寄不到信的客訴難定位(是 email 錯還是寄信系統錯,無驗證無從區分)。
- **估時:** 30-45 min(後台開關 + register 後「請收信」UI 分支)
- **依賴:** M-1-14e-1 register use-case(AuthResult.needsEmailConfirmation 已預留)、Supabase Auth 後台設定(Sean)
- **發現於:** 2026-05-23 / M-1-14e-1 codex 關卡1 must-fix #3 + 陪審 second opinion(Q1=A 代價)
- **相關:** M-1-14e-1 AuthResult DTO、M-1-14f1 RegisterPage UI、M-1 premortem step-2 最晚拍板日

### #174. ⏳ busboy-end STATUS 頂端 hash orphan 根因修(寫 pre-amend hash → 改 post-amend / 不可變引用)

- **狀態:** ⏳ 待執行(tooling、Sean 處理 pcm-tools 時)
- **分流:** P1-before-launch
- **優先級:** 🟢 低(cosmetic;但每 slice 手抓累 + Codex push-readiness 可能誤判 orphan = FAIL)
- **問題:**
  - busboy-end(及現行手動 STATUS 流程)把「pre-amend hash」寫進 STATUS「最近 3 commit」頂列;slice commit amend 後該 hash 變 dangling orphan(≠ HEAD、`git merge-base --is-ancestor` 判 not-ancestor)。
  - 每 slice 都要手動補校正(獨立 commit 指向可達 parent hash),否則 Codex push-readiness 審判 orphan = FAIL(見 memory project_status-top-hash-off-by-one-normal)。
  - 根因:STATUS 是 commit 內容,無法含自身最終 hash;amend 必令先前寫入的 hash orphan。
- **觸發事件:** Sean 改 pcm-tools 時 / orphan 手工校正成本累積到痛。
- **預期解法(擇一):**
  - busboy-end 改寫:頂列固定寫 **parent commit hash**(可達、會 stick、不需再 amend);或
  - 頂列改用 **slice-id / milestone 引用** 而非 commit hash(避免 self-reference);或
  - 接受 orphan 為慣例、但在 SOP 明確「push 前跑一個獨立 STATUS 校正 commit 指向可達 parent」(本 slice 手動採此 workaround、M-1-14e-1b)。
- **不修會痛在:**
  - 擴充性:每新 slice 複製手工校正步驟、SOP 膨脹。
  - 可維護性:pre-amend hash 邏輯散在 busboy + 手動流程、無單一真相。
  - bug 可追蹤性:STATUS 頂 hash 與 HEAD 不一致誤導讀者 + Codex push-readiness 誤判 orphan = FAIL、降信噪比。
- **估時:** 30-60 min(改 busboy-end.js + 驗 3 slice)
- **依賴:** pcm-tools repo(外部、Sean)
- **發現於:** 2026-05-24 / M-1-14e-1a~1b 每 slice 手動校正 orphan、陪審 raise 根因
- **相關:** memory project_status-top-hash-off-by-one-normal、CLAUDE.md「Busboy 流程」、#142(hash drift)

### #175. 🟢 graphify 知識地圖:M-1-16 真價/真 SKU 進 repo 後重審 .graphifyignore

- **狀態:** ⏳ 待執行(條件觸發:M-1-16 真實商品/經銷價落地 repo 時)
- **分流:** P1-before-launch
- **優先級:** 🟢 觀察(現安全;條件成立才升級)
- **問題:**
  - graphify 採用時(2026-05-24)拍板 `.graphifyignore` **納入** `design-reference/data/products.js`(`priceByTier.store` 經銷價),理由:該檔依鐵則 2 是 **design mock 假價、非真經銷價**,真價在後端、且 graphify code 走本機 AST 不外送(Codex 關卡1 兩輪確認此判斷成立)。
  - 但 graph.json 會含 pricing 結構/概念節點(MemberTier / Money / computeEffectivePrice / priceByTier)。
- **觸發事件:** M-1-16(真實 SKU/真經銷價 seed 進 repo,如 Supabase seed row 或前台可達真價檔)落地時。
- **預期解法:**
  - 重審 `.graphifyignore`:真價來源檔(seed / 真 products 資料)是否該排除,避免真經銷價進 graph.json。
  - 重建圖前先跑 detect dry-run 安全驗(真值未進 graph),如本次採用流程。
- **不修會痛在:**
  - 擴充性:真價落地後沿用「假價安全」假設 → 真經銷價可能被抽進本機 graph.json。
  - 可維護性:採用當下的安全前提(mock=假)無人複查 → 前提靜默失效。
  - bug 可追蹤性:graph.json 雖本機不入 git,但若未來改成共享/committed,真價洩漏難回溯。
- **估時:** 20-30 min(重審 ignore + detect dry-run + 重建)
- **依賴:** M-1-16 真實商品資料落地
- **發現於:** 2026-05-24 / graphify 採用 slice、Codex 關卡1 round-2 future-watch
- **相關:** 鐵則 2(design mock 合約)、Server 端鐵則(經銷價不外洩)、`docs/patterns/slice-checkpoint.md` §3.4、`.graphifyignore`

### #176. ✅ 會員 use-case ownership 違規統一 typed error(目前丟 plain Error)

- **狀態:** ✅ 完成 2026-06-16(commit 874b526:新 NotOwnedError domain typed error〔resource 判別欄、鏡像 OrderError〕取代 4 處 plain throw〔verifyAddressOwned/verifyVehicleOwned/deleteAddress/deleteVehicle〕、6 use-case 測試斷言改 instanceof+resource;延後 codex〔quota 6/18、純型別重構〕)
- **優先級:** 🟡 低(陪審 e-2a nit、不擋)
- **問題:**
  - M-1-14e-2a/2b address/vehicle use-cases 的 ownership 違規(`verifyOwnedThenUnsetOthers` / `verifyOwnedThenUnsetOtherPrimary` / delete 驗 ownership)目前丟 `new Error('... 不屬於目前 customer')` plain Error。
  - delivery 層(f1)難用 instanceof / code 精準分辨「越權/不存在」與其他 DB error → HTTP 狀態碼/UI 訊息不好對應。
- **觸發事件:** f1 wiring use-case 需精準錯誤分流時 / 重構 domain error。
- **預期解法:** 定義 domain typed error(如 `NotOwnedError` / 沿用 e-1a AuthError 模式)、use-case 拋它、delivery instanceof 分流。
- **不修會痛在:**
  - 擴充性:錯誤分流靠字串比對、脆。
  - 可維護性:訊息字串改一次到處改。
  - bug 可追蹤性:plain Error 跟 DB error 混在一起難定位。
- **估時:** 20-30 min(定 error 型別 + 改 use-case + delivery instanceof)
- **依賴:** 無(可獨立)
- **發現於:** 2026-05-24 / M-1-14e-2a 陪審 nit
- **相關:** e-1a AuthError 模式、`packages/use-cases/src/_address-default.ts` / `_vehicle-primary.ts`

### #177. ✅ vehicle service 空值 '' → null 正規化(f1 wiring 前必修)

- **狀態:** ✅ 完成 2026-06-16(commit 5a80574:VehicleInput.service 加 .transform 把 '' → null、schema 層;對齊 design `<input type="date">` 空字串、防 DB date 欄 invalid input syntax;add/update 共用同一 safeParse 兩路徑全涵蓋)
- **優先級:** 🟠 中(會 runtime 炸:空保養日期 '' 進 DB date 欄)
- **問題:**
  - DB `customer_vehicles.service` 是 nullable `date`;`VehicleInput` zod(`packages/schemas/src/index.ts:79` `z.string().default('')`)空值輸出 `''`;adapter `mapVehicleToInsertRow`/`mapVehiclePatchToRow` 把 `service` 直送、不轉 null。
  - M-1-14e-2b use-case 守 boundary A 只收已驗證 domain 型別(`service: string | null`、null 合法)、pass-through、**不負責正規化**。
  - 結果:若 f1 用 VehicleInput 產生 `service: ''` 送 use-case → mapper → DB date 欄 → runtime error。
- **觸發事件:** f1(storefront)wiring vehicle add/update 表單時。
- **預期解法(擇一):** VehicleInput schema `.transform(s => s === '' ? null : s)`(delivery 層、首選);或 adapter `mapVehicleToInsertRow`/`mapVehiclePatchToRow` 對 service '' → null(DB 轉譯層)。
- **不修會痛在:**
  - 擴充性:每個碰 vehicle service 的入口都要記得轉。
  - 可維護性:domain 型別 string|null 與 DB date 的 '' 落差無單一守門。
  - bug 可追蹤性:空保養日才炸、edge case 難測到。
- **估時:** 15 min(schema transform + 測試)
- **依賴:** 無(可獨立、但 f1 vehicle wiring 前須完成)
- **發現於:** 2026-05-24 / M-1-14e-2b codex 關卡1 must-fix
- **相關:** `packages/schemas/src/index.ts` VehicleInput、`packages/adapters/src/supabase/mappers/vehicle.ts`、M-1-14e-2b use-cases

### #178. 🟢 會員 UI(f1 登入註冊 / g 會員中心)藍圖歸屬待決(f1 開工時定)

- **狀態:** ⏳ 待執行(f1 開工時拍)
- **優先級:** 🟢 觀察(純地圖/藍圖歸屬、不影響實作)
- **問題:**
  - STATUS「下一步」把 M-1-14e 後續排成 f1(登入註冊頁)/ f2(LINE)/ g(會員中心 7 tab)/ h(MobileTabBar)。
  - 但藍圖 `PHASE-1-MILESTONES.md` 把這些放別處:登入註冊頁 = **M-1-15**、會員中心分頁 = **M-2-03 / M-2-04**(在 M-2 段)。
  - 2026-05-24 刷新進度地圖時 Sean 拍 **Option A**:只展開 M-1-14 後端資料邏輯(a~e-3),f1/g **暫留藍圖原位**(M-1-15 / M-2-03/04)、避免雙重計算;**未決**:要不要把 f1/g 正式併進 M-1-14 大區(Option B、需改 roadmap-data.json 跨段 + 更新 PHASE-1-MILESTONES.md)。
- **觸發事件:** f1(登入註冊頁)開工時。
- **預期解法:** f1 開工前拍:(A) 維持現狀(f1=M-1-15、g=M-2-03/04、地圖跨段引用)或 (B) 把會員 UI 整區併進 M-1-14、同步更新藍圖文件。
- **不修會痛在:**
  - 擴充性:會員區工作散在 M-1-14 / M-1-15 / M-2,新人對不上「會員大區」的真實邊界。
  - 可維護性:STATUS(M-1-14e 含 f1/g)與藍圖(M-1-15/M-2)命名不一致、易誤讀。
  - bug 可追蹤性:地圖進度與實際工作分段不對齊。
- **估時:** 10 min 拍板 +(若 B)30 min 改 json + 藍圖
- **依賴:** 無
- **發現於:** 2026-05-24 / 進度地圖刷新 Option A
- **相關:** `~/.claude/skills/pcm-roadmap/roadmap-data.json`、`docs/PHASE-1-MILESTONES.md` M-1-14/15 + M-2-03/04、STATUS「下一步」

### #179. 🟡 f1 登入註冊衍生的 stage g follow-up(4 項、g 開工前必處置)

- **狀態:** ⏳ 待執行(stage g〔AccountPage 7 tab〕開工時處置)
- **優先級:** 🟡 中(各自不修會痛、但都屬 g-scope、f1 不碰)
- **來源:** M-1-14e-f1 plan v4(codex 關卡1 4 輪 + 陪審腦 verdict flags [B]/[H]/final-2 + code-reviewer consider);plan 全文 `docs/handoff/2026-05-24-m-1-14e-f1-plan.md`
- **4 項:**
  1. **Header 登入態條件式 account 路由**(flag [B]):f1-a D-f=A 把 Header 會員圖示 NAV_ROUTE_MAP.account 改 →`/login` 是 stopgap(不分登入態)。stage g 須補「已登入→/account、未登入→/login」會員態判斷。不修會痛:登入後點會員圖示仍去 /login(體驗錯)。
  2. **ap-page / ap-mono shared base CSS 抽取**(flag [H]、鐵則 10):f1 把 `account.css L5-16`(.ap-page/.ap-mono)放進 `auth.css`;stage g 的 Cart/Account 頁也用同 base。須規劃共用 base 落點避免重複定義。不修會痛:多檔重複定義、改一處漏其他。
  3. **OAuth 會員補 phone 流程**(final-2):Google/LINE OAuth 會員 `phone=''`(DB DEFAULT ''、可空;D-g「手機必填」只約束 email 表單)。stage g profile tab 須提供補 phone(或下單前強制補)。不修會痛:無手機會員下單/配送缺資料。
  4. **storefront requireEnv 去重**(code-reviewer consider):`lib/supabase/server.ts` + `browser.ts` 各一份 requireEnv(+ adapters/client.ts 第三份)。f1 收尾或 g 若再多一處 env 讀取、抽 storefront 共用 env helper(鐵則 10)。
- **估時:** 1+2+4 各 ~15-20 min;3 視 profile 完成流程設計(g-scope PRD)
- **依賴:** stage g(AccountPage)
- **發現於:** 2026-05-24 / M-1-14e-f1 plan codex 關卡1 + 陪審 + code-reviewer
- **相關:** `apps/storefront/src/components/Header.tsx`、`apps/storefront/src/styles/auth.css`(f1-a 後)、`apps/storefront/src/lib/supabase/*`、design AccountPages.jsx 會員中心、`docs/handoff/2026-05-24-m-1-14e-f1-plan.md`

---

### #180. ✅ manifest last_modified_commit off-by-one 復發模式(已 2 例、SOP 固化)

- **狀態:** ✅ 完成(2026-06-17 A 方向 SOP slice;固化**案 A「記可達祖先」**〔廢 PENDING_HASH + amend、廢案 B〕+ 加機械可達性 gate)。落地:① `docs/patterns/slice-checkpoint.md` 新「last_modified_commit 寫法:案 A 固化」段〔拍板 + 為何廢 amend + 機械 gate 說明〕+ 變更紀錄 row;② `scripts/design-mirror.mjs --validate` 加可達性檢查〔每個非佔位 last_modified_commit 必 `git merge-base --is-ancestor <hash> HEAD`、orphan/非法 hash → exit 1;HASH_RE 格式驗防 shell 注入〕+ --help/header 同步;③ `docs/design-storefront-manifest.yaml` header 註解去舊 PENDING_HASH/amend 字面改案 A;④ 本地 `~/.claude/skills/slice-checkpoint/SKILL.md` manifest-sync 段加案 A + 可達性步驟〔repo 外、不入 commit〕。**變異測試證 gate 有效**:bogus hash `deadbee` → validate 報 unreachable exit 1、現有 20 個 last_modified_commit 全可達〔0 unreachable〕。**附帶揭示**:--validate 對多檔「+」串接欄位有 pre-existing path-check false-positive〔10 broken link、與本 #180 可達性無關、我未碰 path-check 邏輯〕→ 開 [[#238]] 追蹤,不擴本 slice scope。
- **優先級:** 🟡 中(單例可容忍、但已復發 2 次 + orphan 有 GC 死引用風險)
- **問題:**
  - design-mirror SOP 現行作法:manifest 元件 `last_modified_commit` 寫 `PENDING_HASH`、commit 後 `git commit --amend` 補真 hash。但 amend 寫入「自身 commit 的 hash」git 數學上不可能(commit hash 依內容〔含 manifest〕計算)→ 補進去的永遠是 pre-amend hash = amend 後變 orphan/dangling。
  - 已 2 例:`1b61a9d`(M-1-13H-7、ProductsPage/ProductPage、可達雙生 `ee509fa`)、`38001e8`(M-1-14e-f1-a、Header/AccountPages、可達雙生 `7ea5f26`)。兩例皆於 f1-b 順手改回可達 hash(MUST-DO #1/#2)。
- **觸發事件(任一觸發即啟動實作):**
  - 下一個「manifest 元件 amend 進 slice commit」的 slice;或 M-1-16 上線前統一處置(避免 orphan 累積 + 90 天 GC)。
- **預期解法(擇一固化進 design-mirror SOP + slice-checkpoint manifest-sync 檢查):**
  - 案 A「記可達祖先」:`last_modified_commit` 記「前一個已落地可達 commit」(f1-b 已試行:Header/AccountPages 記父 commit `7ea5f26`)。語意略 understate〔該 slice 本身的 commit 未被記〕但永遠可達、無 orphan、無需 amend。
  - 案 B「commit 後非 amend 校正」:下個 slice 開頭把上個 slice 的 PENDING/orphan hash 改成「已落地可達 hash」(f1-b 已對兩例做)。語意精確但每個 slice 殘留一個待修 orphan 直到下次。
  - 評估後擇一寫死進 SOP;同步更新 `slice-checkpoint` manifest-sync 段的驗證(現只檢「有沒有改 last_modified_commit」、未檢可達性)+ 加 `git merge-base --is-ancestor` 可達性 gate。
- **不修會痛在:**
  - 擴充性:新元件持續 amend → orphan 線性累積、manifest hash 半數變死引用。
  - 可維護性:每個動 storefront 的 slice 都要記得「順手修上一個 orphan」、靠人腦自律易漏(本次靠陪審 MUST-DO 才修)。
  - bug 可追蹤性:orphan 90 天後 `git gc` 清掉 → `git show <hash>` 找不到「最後改此元件的 commit」、design↔code 稽核斷鏈、回溯偏離無從查起。
- **估時:** 評估兩案 + SOP / skill 固化 ~30-45 min
- **依賴:** 無(可獨立做);最遲 M-1-16 上線前
- **發現於:** 2026-05-25 / M-1-14e-f1-a + f1-b(陪審 MUST-DO #3)
- **相關:** `docs/design-storefront-manifest.yaml`、`docs/patterns/`(design-mirror SOP)、`~/.claude/skills/slice-checkpoint/`(manifest-sync 段)、memory `project_status-top-hash-off-by-one-normal`

---

### #181. 🟠 註冊頁 + 登入頁表單 UX 強化(全欄必填標 + 逐欄 inline error、business override)

- **狀態:** ✅ 完成(2026-05-25 #181 slice、PCM 自驅;Sean Q1=B「必填」字面 + Q2=B 前端逐欄 + 後端也逐欄)
- **優先級:** 🟠 中(business 拍板要做、非阻擋 f1-c;f1-b 已先落地單欄「手機（必填）」過渡)
- **問題:**
  - design AccountPages.jsx L256-308(註冊)/ L181-253(登入)= 單一頂部錯誤 `.auth-err` + 欄位無必填標記。客人填錯/漏填時只看到一條頂部訊息、不知是哪一欄。
  - f1-b 已就 D-g 手機加「手機（必填）」label(registerPhoneRequired override),但其餘必填欄(姓名/Email/密碼)仍無標記、且錯誤仍頂部單一。
- **觸發事件:**
  - f1-c(Google OAuth 完整閉環)commit 收尾後,即啟動本 slice。
- **預期解法(spec 時定案細節):**
  - **全欄必填標:** 每個必填欄 label 標「必填」(Sean 指定字面);**spec 時提「紅星 `*`」替代給 Sean 二選**(若「必填」字面視覺太吵)。涵蓋 RegisterPage 姓名/Email/手機/密碼 + LoginPage Email/密碼。
  - **逐欄 inline error:** 改 per-field inline error(顯示在該欄位下/上),取代目前頂部單一 `.auth-err`;client 改逐欄 error state(取代現行 first-error-wins 單條)。
  - **server 對應:** RegisterInput/LoginInput 的 ZodError 目前 server action 只回 `issues[0]`;**spec 時定「client 為主逐欄 vs server 也逐欄回對應」**(client 為主較簡、server 逐欄需改 action 回傳形狀)。
  - **範圍(鐵則 5 CSS+TSX 同 slice):** `RegisterPage.tsx` + `LoginPage.tsx` + `auth.css`(field-level error 樣式新增)。
  - **偏離記錄:** 偏離 design L256-308 / L181-253(單一頂部錯誤、欄位無必填標)→ 記 manifest override(同 D-g `registerPhoneRequired` 模式)+ 本 backlog 註明 = **business 拍板(Q1=B)、非誤翻譯、鐵則 1 設計仍為基底**。
- **不修會痛在:**
  - 擴充性:未來新增表單欄位時,逐欄 error 機制已備、不必再重構頂部單一錯誤。
  - 可維護性:頂部單一錯誤 + first-error-wins 難擴充多欄提示、改一處易顧此失彼。
  - bug 可追蹤性:客人回報「填不過去」時,逐欄 error 能定位是哪一欄驗證擋下、頂部單一訊息無法。
- **估時:** ~30-45 min(CSS + 雙頁 client error state 改造;spec 決策 2 處〔必填標字面 vs 紅星、client-only vs server 逐欄〕一次性問 Sean)
- **依賴:** f1-c 收尾後;不動 schema(RegisterInput/LoginInput 不改、只改 server action 回傳形狀若採 server 逐欄)
- **發現於:** 2026-05-25 / M-1-14e-f1-b 收尾(Sean Q1=B/Q2=B 拍板表單 UX override)
- **相關:** `apps/storefront/src/components/RegisterPage.tsx`、`apps/storefront/src/components/LoginPage.tsx`、`apps/storefront/src/styles/auth.css`、`apps/storefront/src/app/{register,login}/actions.ts`、`apps/storefront/src/lib/auth/field-validation.ts`(新建共用驗證)、design AccountPages.jsx L181-308、`docs/design-storefront-manifest.yaml`(AccountPages override:requiredFieldLabels + inlineFieldErrors)
- **完成摘要(2026-05-25):**
  - **Q1=B 全欄必填標**:RegisterPage 姓名/Email/手機/密碼 + LoginPage Email/密碼,label 一律加全形「（必填）」(沿用 f1-b 手機既有格式、6 欄統一)。
  - **Q2=B 前後端逐欄**:新建共用純函式 `lib/auth/field-validation.ts`(`validateRegister`/`validateLogin`,client 即時 + server 重驗同一份);server action 回傳形狀由 `{ error }` 改 `{ fieldErrors?, formError? }`。逐欄錯 `.auth-field-err` 顯示在各欄 input 下方。
  - **釘死 1 空欄專屬訊息**:空欄顯示「請填寫姓名/Email/手機/密碼」(presence 優先、不沿用 zod「格式不正確」);非空但格式錯才沿用 zod 訊息(「Email 格式不正確」「手機格式不正確」「密碼至少 8 碼」)。
  - **釘死 2 雙通道並存**:頂部 `.auth-err` 保留給帳號層級錯(此 Email 已註冊 / Email 或密碼錯誤 / OAuth 失敗 = formError),逐欄 `.auth-field-err` 給欄位驗證錯(fieldErrors);兩通道互不取代、可同時顯示。
  - **釘死 3**:必填標記 6 欄統一全形「（必填）」(RegisterPage 4 欄 + LoginPage 2 欄)、沿用現行手機格式。
  - **釘死 4**:Q2=B 動 server 回傳形狀 → commit 前跑 codex 關卡2 對抗審查。
  - **驗證真相一致**:client/server 共用同一 validateXxx,空欄專屬 + 非空走 @pcm/schemas zod 訊息;safeParse data 仍 strip 未知欄(tier/wallet 信任邊界沿用)。boundary 綠(apps→schemas 允許)。
  - **測試**:4 檔更新(LoginPage/RegisterPage smoke + login/register actions),補逐欄 + 雙通道 + 空欄專屬 + 信任邊界 strip 斷言。manifest 加 requiredFieldLabels + inlineFieldErrors override。
  - **codex 關卡2 round1 FAIL→修(2 must-fix + 1 consider)**:① 密碼 presence 改拒全空白(`!trim()`、防 8 空白過 zod min(8) 註冊純空白密碼;傳 use-case 值仍不 trim、允許密碼含空白)② STATUS 7 欄同 commit 更新(SSoT 一致)③ zod issue → fieldErrors 走 allowlist(防 LoginInput.remember 等「schema 內非顯示欄」型別錯塞契約外 key)+ ok invariant 改依賴 parsed.success + server action 對「ok=false 但無逐欄錯」回 formError fallback 防無聲失敗;補全空白密碼 + remember 非 boolean 測試。三綠 + 測試重跑;codex round2 確認 3 項程式修補已修妥、另抓 2 文件字面偏差(manifest authErrorCopyNetNew 舊 presence 描述 + 釘死 3 欄數 4→6)→ 修齊自驗對齊(達 SOP ≤2 輪自修、文件字面低風險未再 round3)。
  - **🔧 肉眼驗修補(同 #181 commit、Sean dev 實機抓)**:Sean 報「只見『請同意服務條款』紅字」、其餘逐欄錯誤看似沒出現。根因=CSS specificity:欄位內錯誤 `.auth-field-err` 是 `.auth-field` label 內的 `<span>`、同時 match `.auth-field > span`(label 文字樣式:灰色 mono uppercase、specificity 0,1,1 > `.auth-field-err` 0,1,0)→ 錯誤紅字被灰色蓋成像 label(訊息其實有出、只是灰色不顯眼);agree 錯誤在 label 外故未被蓋、正常紅色。修=加提權 `.auth-field > .auth-field-err`(0,2,0)覆寫 color/font-family/letter-spacing/text-transform/margin-bottom。playwright 取 computed style 驗 5 欄錯誤全 `rgb(220,38,38)` 紅色 + Inter 正常字體 + 無 uppercase;三綠重跑綠。(教訓:逐欄錯誤 span 嵌在既有 label 樣式作用域內、單元測試〔jsdom 不算 CSS specificity〕抓不到、靠瀏覽器肉眼驗、同 #182 類「build/test 綠只瀏覽器炸」模式。)

---

### #182. ✅ eslint 禁動態 process.env 存取(防 client bundle env inlining bug 復發)

- **狀態:** ✅ 完成(2026-06-17 A 方向 config slice;eslint.config.js 加 `no-restricted-syntax` 規則〔selector 抓 `process.env[computed]`、放行 `process.env.STATIC`〕scope=packages/** + apps/**;2 處 server-only 動態 requireEnv〔adapters/supabase/client.ts L24、storefront lib/payment/composition.ts L31〕加受控 eslint-disable + 意圖註解放行〔server 不進 client bundle、無 inlining 風險、#179 item 4 dedup 追蹤〕;test/spec 已全域 ignores 豁免;**變異測試證規則有效**〔臨時 computed `process.env['X']` 被抓、同檔 static `process.env.NEXT_PUBLIC_OK` 不報〕;三綠 typecheck/lint/build 全綠;code-reviewer PASS。**已知限界**:規則只抓直接 `process.env[x]` 字面、間接別名〔`const e=process.env; e[x]`〕不抓〔常見 footgun=requireEnv 直接式已覆蓋〕)
- **優先級:** 🟠 中(已踩過一次 runtime bug、有 lint 防線才不復發;但已即時修、非阻擋)
- **問題:**
  - Next.js 只把**靜態字面** `process.env.NEXT_PUBLIC_*` inline 進 client bundle;**動態存取** `process.env[name]`(name 為變數,如 helper `requireEnv(name)`)不會被 inline → client 端取到 `undefined` → 執行期 throw。
  - M-1-14e-f1-c 已踩:`lib/supabase/browser.ts` 的 `requireEnv(name)` 動態存取令 client bundle 取不到 Supabase URL(.next 前端 chunks 出現 0 次)、點 Google 登入即 throw「NEXT_PUBLIC_SUPABASE_URL not set」。已修為靜態存取(browser.ts + server.ts 一併改靜態)。
  - **但無 lint 防線**:未來任何 client 檔再寫 `process.env[變數]` 讀 NEXT_PUBLIC_* 會重蹈覆轍,且 **build 綠 + 單元測試綠(Node env 動態查有值)、只在瀏覽器炸** → 極難追。
- **觸發事件(任一觸發即啟動):**
  - 新增 client 端 env 讀取的 slice;或 M-1-16 上線前統一加防線;或順手做。
- **預期解法(評估擇一):**
  - eslint `no-restricted-syntax` 禁 client 檔內 computed `process.env[...]`(`MemberExpression[computed=true][object.object.name='process'][object.property.name='env']`),配 message 指向本條與靜態存取要求。
  - 或更寬:全 repo 禁 computed process.env(server 端動態雖無害、但統一靜態更安全 + 防 client/edge runtime 誤用)。
  - 範圍:`eslint.config.js`(storefront client block 或全域);順帶評估 `packages/adapters/src/supabase/client.ts` 第三份 `requireEnv` 動態存取(server-side、現無害、對齊 #179 item 4 dedup 一併處置)。
- **不修會痛在:**
  - bug 可追蹤性:此類「build 綠 + test 綠 + 只瀏覽器炸」無防線時靠人肉眼驗才抓、回歸風險高。
  - 可維護性:靜態存取要求只存在註解 / 人腦,無機械守門。
  - 擴充性:新 client env(如未來第三方 SDK public key)讀取無防線、易再踩。
- **估時:** 評估 + 規則 + 驗 ~20-30 min
- **依賴:** 無
- **發現於:** 2026-05-25 / M-1-14e-f1-c 肉眼驗(Sean + 陪審實機抓 client env inlining bug)
- **相關:** `apps/storefront/src/lib/supabase/browser.ts`、`server.ts`、`packages/adapters/src/supabase/client.ts`、`eslint.config.js`、backlog #179 item 4(requireEnv dedup)

### #183. ⏳ 搜尋日誌蒐集 search query log(【時間敏感】上線起記錄、不可回填)

- **狀態:** ⏳ 待評估(建議 M-6 上線前落地)
- **分流:** P1-before-launch
- **優先級:** 🔴 高(行為資料不可回填、不從上線起記錄即永久缺歷史語料)
- **問題:**
  - 不從上線起記錄搜尋詞、永遠拿不到「客人搜什麼 / 搜什麼搜不到(= 缺貨商機)」的歷史。
  - 對齊既有 #35 已點出的缺口:客人「搜某商品搜不到」、無 search query log 可回查。
- **觸發事件:**
  - 2026-05-26 / ChatGPT「Vehicle-First 平台藍圖」對照 PCM 現況評估 / 行為資料時間敏感缺口。
- **預期解法(評估擇一):**
  - 候選 A【推薦】:上線前加一張 `search_queries` 表(query / normalized 預留 / result_count / customer_user_id nullable / created_at)+ 搜尋路徑一個 insert。零外部依賴。
  - 候選 B:只送 GA4 事件、不落自家 DB(可分析、無法 join 自家訂單 / 會員資料)。
  - 候選 C:不做、上線後補(= 放棄上線前歷史語料)。
- **不修會痛在:**
  - 擴充性:Phase 2 keyword 正規化(#185)+ Phase 3 推薦引擎 / 語意搜尋(#187)缺最關鍵真實語料起步。
  - 可維護性:單表單一 insert、改動面小;延後反而要回頭再動一次搜尋路徑。
  - bug 可追蹤性:客人「搜不到」客訴無 query log 可回查、無法定位是 encoding / 大小寫 / metadata 欄位差異。
- **估時:** 評估 30 min / 落地 1-2 hr
- **依賴:** 搜尋路徑落地(#35 searchByKeyword / M-1-03)
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** #35(search engine plan、明指「無 search query log」)、#184(GA4 事件)、#185(keyword 正規化、依賴本條語料)

### #184. ⏳ GA4 基礎行為事件埋設(【時間敏感】上線起埋、不可回填)

- **狀態:** ⏳ 待評估(建議 M-6 上線前落地)
- **分流:** P1-before-launch
- **優先級:** 🔴 高(行為數據不能回填、沒埋就是永久空白)
- **問題:**
  - 行為數據不能回填、沒埋就是永久空白。
  - 缺最小可用電商事件 + PCM 特有 vehicle / fitment 事件、Phase 2/3 行為分析無歷史起步。
- **觸發事件:**
  - 2026-05-26 / ChatGPT「Vehicle-First 平台藍圖」對照 PCM 現況評估 / 行為資料時間敏感缺口。
- **預期解法(評估擇一):**
  - 候選 A【推薦】:上線前埋最小集合(view_item / search / add_to_cart / begin_checkout / purchase + PCM 特有 select_vehicle / fitment_fail)。
  - 候選 B:只埋 GA4 預設電商事件、不含 vehicle / fitment 特有事件。
  - 候選 C:不埋、上線後補。
- **不修會痛在:**
  - 擴充性:Phase 2/3 行為分析 + 推薦引擎(#187)沒有歷史數據起步。
  - 可維護性:集中一個 analytics util、後續加事件改動面小;散落各元件後難維護。
  - bug 可追蹤性:轉換漏斗哪一步掉(view → cart → checkout → purchase)無事件無法定位。
- **估時:** 評估 30 min / 落地 2-3 hr
- **依賴:** 無(可獨立於 search log 落地)
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** #183(search query log)、#187(BigQuery 行為分析、依賴本條數據)

### #185. ⏳ keyword 正規化別名表(中文重機改裝俗稱 → 標準詞)

- **狀態:** ⏳ Phase 2
- **分流:** P2-later
- **優先級:** 🟡 低(Phase 2、依賴 #183 語料)
- **問題:**
  - 中文重機改裝俗稱多(後移 → rearset / 牛角 / 卡夢 / 蠍子管 / 防倒球 等)、不正規化即搜不到。
- **觸發事件:**
  - 2026-05-26 / ChatGPT 平台藍圖對照評估 / 站內搜尋智能缺口。
- **預期解法:**
  - `keyword_aliases` 表(alias → normalized)+ 搜尋前正規化層。
- **不修會痛在:**
  - 擴充性:正規化層是後續語意搜尋(#187)前置;不先建、自由打俗稱命中率低。
  - 可維護性:別名集中一表、小編可維護;散在程式碼 hardcode 難改。
  - bug 可追蹤性:「打俗稱搜不到」客訴可對照別名表定位是否缺詞。
- **估時:** Phase 2 評估
- **依賴:** #183(search query log 餵料、知道客人實際打什麼俗稱)
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** #35(search engine plan)、#183(語料來源)、#186(他站爬蟲補詞)

### #186. ⏳ 爬蟲蒐集他站搜尋語意(Webike / 蝦皮 autocomplete)

- **狀態:** ⏳ Phase 2/3
- **分流:** P2-later
- **優先級:** 🟢 觀察(探索性、借外站補搜尋詞庫冷啟動)
- **問題:**
  - 自家 search log(#183)初期量少、可借他站 autocomplete 補搜尋詞庫 / 別名候選(#185)。
- **觸發事件:**
  - 2026-05-26 / ChatGPT 平台藍圖對照評估 / 站內搜尋智能冷啟動缺口。
- **預期解法:**
  - 爬 Webike / 蝦皮等站的 autocomplete「搜尋詞 / 語意」、補進 keyword 別名候選(#185)。
- **不修會痛在:**
  - 擴充性:解決搜尋語料冷啟動(自家量少時的補充來源)。
  - 可維護性:**須與 PHASE-2-VISION 藍圖 #1「廠商進貨爬蟲」明確區分** —— 那是抓商品資料、本條是抓「搜尋詞 / 語意」、兩條 pipeline 不同、別共用誤判。
  - bug 可追蹤性:詞庫來源標記(自家 log vs 他站爬蟲)、出錯可分流定位。
- **估時:** Phase 2/3 評估
- **依賴:** #185(別名表)、#183(自家語料)
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** PHASE-2-VISION 藍圖 #1(廠商進貨爬蟲 / API 同步、**抓搜尋詞 ≠ 抓商品**)、#185(別名表)

### #187. ⏳ BigQuery 行為分析 + 推薦引擎 + AI semantic search

- **狀態:** ⏳ Phase 3
- **分流:** P2-later
- **優先級:** 🟢 觀察(遠期、依賴前期累積資料)
- **問題:**
  - cross-sell / vehicle trends / lost sales / fitment 退貨率分析;向量語意搜尋(打描述找零件)。
- **觸發事件:**
  - 2026-05-26 / ChatGPT 平台藍圖對照評估 / 資料智能遠期願景。
- **預期解法:**
  - 行為資料匯 BigQuery 做分析;推薦引擎(cross-sell / 同車型熱門);AI 向量語意搜尋(embedding)。
- **不修會痛在:**
  - 擴充性:平台級資料智能的終點站、但完全依賴前期(#183 + #184)資料累積。
  - 可維護性:遠期才接、現只記能力缺口、不預先選型(避免猜錯方向)。
  - bug 可追蹤性:推薦 / 語意搜尋結果可回溯到來源行為事件(#184)+ 搜尋語料(#183)。
- **估時:** Phase 3 評估
- **依賴:** #183(search log)+ #184(GA4 行為數據)累積歷史
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** #183、#184(資料來源)、#185(正規化餵語意搜尋)

### #188. ⏳ vehicle schema 深層正規化(generations / variants / aliases)

- **狀態:** ⏳ Phase 2/3
- **分流:** P2-later
- **優先級:** 🟡 低(平台級精準 fitment 前置、Phase 2/3)
- **問題:**
  - 目前 `customer_vehicles` 只有基礎欄位;平台級精準 fitment 匹配需「代別 / 變體 / 別名」分層(R9 / YZF R9 / YZFR9 → 同一車)。
- **觸發事件:**
  - 2026-05-26 / ChatGPT 平台藍圖對照評估 / 車輛資料正規化缺口。
- **預期解法:**
  - vehicle 主檔加 generations(代別)/ variants(變體)/ aliases(別名)分層、別名 → 標準車型映射。
- **不修會痛在:**
  - 擴充性:精準 fitment 匹配 + 車輛履歷(PHASE-2-VISION 藍圖 #5)跨代別查詢的前置。
  - 可維護性:別名映射集中、避免每處各自處理 R9 / YZFR9 字串。
  - bug 可追蹤性:「同車不同寫法 fitment 配不上」可回溯到別名表是否缺映射。
- **估時:** Phase 2/3 評估
- **依賴:** vehicles 主檔(PHASE-2-VISION 藍圖 #5、Phase 2 落地)
- **發現於:** 2026-05-26 / ChatGPT 平台藍圖對照評估
- **相關:** #81(Product variants = 產品規格變體、已推延 M-5-03;本條 = 車輛 schema 正規化、**兩者不同**)、PHASE-2-VISION 藍圖 #5(車輛履歷跨代別查詢)

### #189. ⏳ Webwright agentic 探索式 QA 評估(微軟 web agent、未來測試層)

- **狀態:** ⏳ Phase 1 後 / 測試基建穩定後評估
- **優先級:** 🟢 觀察(探索性附加層、非 CI 把關閘門)
- **問題:**
  - 測試基建 T-1 已建 Playwright 確定性 E2E(CI 把關閘門、驗「寫過的 case 沒壞」)。若未來想再要「AI 像真人自己逛網站、找出沒預期到的 bug」這種探索式 QA、Webwright(微軟 2026-05 開源 terminal-native web agent)是候選——但它是非確定性 LLM agent、每跑燒 token、Python、發布僅數天。
- **觸發事件:**
  - 2026-05-27 / 測試基建 T-1 工具選型 / Sean 問「是否改用或也用 Webwright」、評估後拍 A(T-1 先用 Playwright、Webwright 歸檔待評估)。
- **預期解法:**
  - 待 Playwright E2E 地基穩固 + Webwright 成熟度提升後、評估納為「探索式 / agentic QA」附加層(AI 自主操作網站找 bug),與 Playwright 確定性回歸閘門**互補、非取代**。Webwright 底層本就用 Playwright、故 T-1 裝 Playwright 對未來路線不浪費。
- **不修會痛在:**
  - 擴充性:補「AI 自主探索找未預期 bug」能力——確定性 E2E 只驗寫過的 case、補不到沒想到的操作路徑。
  - 可維護性:須明確定位為探索層、非 CI 紅綠燈(非確定性不可當 pass/fail gate);與 Playwright 職責分清、別混用。
  - bug 可追蹤性:Webwright 每個 task 產可重跑 Python script、發現問題可回溯;但 LLM 步驟非確定、結果需人判讀。
- **估時:** Phase 1 後評估(視 Playwright 地基 + Webwright 成熟度)
- **依賴:** Playwright E2E 地基(測試基建 T-1 已起)、Webwright 成熟度
- **發現於:** 2026-05-27 / 測試基建 T-1(Sean Q=A)
- **相關:** microsoft/Webwright(底層用 Playwright)、測試基建 T-1(Playwright 確定性閘門)、#169(next-env gitignore 評估、同屬測試/工具雜務)

### #190. ✅ 登入後導回原頁(post-login next-param redirect、same-origin 白名單)

- **狀態:** ✅ **完成(2026-06-17、codex 關卡2 PASS)**(A 方向 7=A、Sean 拍;鐵則 12 auth/open-redirect。codex quota 提早恢復 → 2026-06-17 main session 跑 codex 關卡2 = **PASS、0 must-fix**〔codex 自建 payload 以 node REPL 實證 `/%2f%2fevil.com`·`/%252f%252fevil.com`·`/%E2%80%83//evil.com` 皆無逃逸、same-origin〕;2 條 consider〔encoded/Unicode 同源字面 + register next regression〕已 fold 進後續測試 commit;[[project_codex-k2-pending-2026-06-18]] 已結。實作 commit cbb05f0 已 push origin/dev)。落地:① 新 `apps/storefront/src/lib/auth/safe-redirect.ts` `sanitizeNextParam()` 同源白名單〔只放行單一 '/' 開頭站內路徑;擋絕對 URL/scheme、protocol-relative `//`·`/\`、反斜線/控制字元/空白;30 對抗測〕② account/page.tsx 未登入 → `/login?next=/account` ③ login/register action 加 `next` 獨立參數〔validateXxx strip 未知欄故走獨立參數〕、成功 redirect(sanitizeNextParam(next)) ④ login/register page 讀 ?next 傳元件、LoginPage/RegisterPage 穿 next ⑤ Google OAuth:LoginPage signInWithOAuth redirectTo 帶 `?next=`、callback 讀 next sanitize 導回 ⑥ LINE OAuth:start 讀 next sanitize 存 cookie〔LINE_NEXT_COOKIE、同 state/nonce 短效+用後即刪〕、callback 讀 next cookie sanitize 導回。🔴 **防護縱深**:client 先 sanitize 一次〔不送 garbage 給 Google/LINE〕、sink 端〔action/callback〕為權威白名單再驗。三綠 typecheck/lint/build + 完整 vitest 1128→1166〔+38:safe-redirect 30 + login 2 + Google 2 + LINE start 2 + LINE callback 2〕+ code-reviewer PASS。✅ **codex 關卡2(2026-06-17)PASS**:已審 protocol-relative/scheme 繞過、next 穿 OAuth state/cookie 不重開 f1-c/f2 open-redirect 傷口、CSRF state 完整性、encoded/double-encoded/Unicode 空白 → 無逃逸;2 consider(test 覆蓋)已 fold(safe-redirect encoded/em-space 同源字面 3 案 + register next 合法/惡意 2 案、完整 vitest 1166→1171)+ code-reviewer 複審 PASS。
- **優先級:** 🟡 低(體驗優化、非阻擋)
- **問題:**
  - g-1 決策 1=A:未登入點會員中心 → 導 `/login` → 登入成功一律回首頁(`POST_AUTH_REDIRECT='/'`)。體驗上「我本來要去會員中心、卻被丟回首頁」略不順。
- **觸發事件:**
  - 2026-05-27 / g-1 codex 關卡1 finding #8 / Sean 決策 1=A、B 列本條 backlog。
- **預期解法:**
  - 受保護頁 redirect 帶 next(`/login?next=/account`)、登入 / OAuth 成功後優先回 next。
  - **【硬要求】next 參數必做 same-origin 白名單驗證**(只允許站內相對路徑、拒絕絕對 URL / 跨站),別重開 M-1-14e-f1-c(Google OAuth)+ f2(LINE callback)修過的 open-redirect 傷口(兩處 codex 關卡2 must-fix 已治)。
- **不修會痛在:**
  - 擴充性:g 之後多個受保護頁(admin / checkout)都需「登入後回原處」、統一 next 機制比每頁各自硬導好。
  - 可維護性:next 白名單驗證集中單點、避免每個 redirect 點各自寫驗證、各自留漏洞。
  - bug 可追蹤性:open-redirect 攻擊面集中審(白名單單點)、出事好定位。
- **估時:** 30-45 min(含白名單驗證 + 測試)
- **依賴:** 登入流程(`login/actions.ts` + `POST_AUTH_REDIRECT`)、OAuth callback
- **發現於:** 2026-05-27 / g-1 codex 關卡1(Sean 決策 1=A、B 此條)
- **相關:** M-1-14e-f1-c(Google OAuth open-redirect 修)、f2(LINE callback redirect 紀律)、`POST_AUTH_REDIRECT`

### #191. ⏳ 收藏清單(favorites)後端待建

- **狀態:** ⏳ 後端待建(g-3 已落地空狀態 UI、本條追蹤後端 entity / RLS / use-case / UI 接線)
- **優先級:** 🟡 低(會員黏著、非核心交易;Phase 1 後 / M-3+ 評估)
- **問題:**
  - 會員中心「收藏清單」tab(design AccountPages.jsx L561-578)無對應後端 —— domain / ports / use-cases / schema 皆無 favorites entity。g-3 先搬空狀態 markup、真資料無源。
- **觸發事件:**
  - 2026-05-27 / g-1 規劃 Sean Q1=A(favorites 先空狀態 + 開 backlog 記後端待建);codex 關卡2 揪 FavoritesTab 註解誤引 #189(Webwright)→ 本條補正。
  - 2026-05-28 / g-3 落地空狀態 UI(FavoritesTab.tsx + FavoritesTab.test.tsx;沿用 OrdersTab pattern + acc-empty 既有 CSS、不新增 CSS、不搬 design mock 6 件商品字面);本條後端工作不變、僅 UI 殼到位。
- **預期解法:**
  - favorites entity(customer_id × product_id + 加入 / 移除 / 列表)+ RLS auth.uid()=customer_user_id 自讀自寫 + use-case + storefront 接 g-3 tab + 商品頁 / 卡片「加入收藏」鈕。
- **不修會痛在:**
  - 擴充性:收藏是會員黏著基礎(再行銷、推薦冷啟動參考);與 #187 行為分析互補。
  - 可維護性:favorites 與 cart(localStorage mock)語義不同、應各自 entity、別混。
  - bug 可追蹤性:收藏增刪走 use-case + RLS、出錯可回溯 ownership。
- **估時:** Phase 1 後 / M-3+ 評估(entity + RLS + use-case + UI 接線)
- **依賴:** customers schema(已備)、products 真資料(M-1-16 種子後較有意義)
- **發現於:** 2026-05-27 / g-1 規劃(Sean Q1=A)+ codex 關卡2(FavoritesTab #189 誤引修正)
- **相關:** g-3(favorites tab 空狀態)、#187(行為分析 / 推薦)、design AccountPages.jsx L561-578

### #192. ✅ data-mobile 全站 RWD 啟動機制疑點(2026-05-28 完成、修法 d 雙保險)

- **狀態:** ✅ 完成(2026-05-28、Claude Code 自驅 slice、Cowork 不在 loop)
- **實作摘要:** 修法 d 雙保險(Sean 拍 + codex k1 確認):
  - **A1** 5 個 CSS 檔加 `@media (max-width: 1079px)` 鏡像 block 並存既有 `[data-mobile]` 規則(account.css 14 + auth.css 3 + filter-drawer.css 1 + filter-top.css 34 + header.css 1 = 53 條)、不刪既有(向後相容 dev-preview)
  - **A2** layout.tsx 改 async + Next 16 `headers()` 讀 user-agent、SSR 在 `<html data-mobile={...}>` 設值(向後相容 Header.tsx L57 querySelector);非完整 UA parser、iPad「請求桌面」由 @media 兜底
  - **B** 順手搬 MobileTabBar(fold #158)+ mobile-tabbar.css(business override:position fixed + safe-area-inset-bottom);找車 / 購物車 tab disabled(fold #195 / #194)
  - 順手修 .acc-head h1 加 `word-break: break-word` 修 g-2 肉眼驗發現的「Sean-PCM重機零件販售」斷行
- **對抗審查紀錄:** codex k1 r1 找 4 must-fix(selector 不命中 / /cart 不實 / 鐵則 12 觸發 / 鐵則 4 豁免依據)、plan v2 全採納;code-reviewer + codex k2 紀錄見 commit body
- **優先級:** 🟠 中(上線前必確認 / 必修;影響全站手機 RWD、「完整手機 RWD」為專案價值)
- **問題:**
  - storefront 多支 CSS(filter-top.css / account.css 等)用 `[data-mobile="true"]` 屬性選擇器套手機版樣式(忠實搬自 design),但 grep 全 repo 發現**真實頁面(home / products / account)無任何處設 `data-mobile="true"`**(只 dev-preview/filter-drawer 手動設;Header autoMobile 僅「讀」data-mobile 或 `innerWidth < 1080` 自判)。→ design 的 `[data-mobile]` 手機 CSS 在真實頁可能根本不啟動、真實頁手機版恐渲染桌機 layout。
- **觸發事件:**
  - 2026-05-27 / g-1a 偵察(account.css mobile 樣式搬入時發現)/ Sean 拍「開 backlog、優先級拉高、獨立 slice、不折進 g」。
- **預期解法:**
  - ① 先確認現況:窄視窗實測 home/products/account 手機版是否真壞(或有我沒找到的全域 data-mobile 設定機制)。② 若真壞、擇一全站方案 Sean 拍:(a) 全域在 layout/body 依視窗寬設 `data-mobile`(JS、對齊 design 既有屬性選擇器、改動最小)或 (b) 把 `[data-mobile="true"]` 改真 `@media` query(較標準、但跨多 CSS 檔)。
- **不修會痛在:**
  - 擴充性:全站每頁手機版都靠此機制;不修則 g 之後每個新頁(admin/checkout)手機都壞。
  - 可維護性:選定單一全站機制(data-mobile setter vs @media)、避免每頁各自 hack。
  - bug 可追蹤性:「手機版沒生效」可回溯單一啟動點、非散落各 CSS。
- **估時:** 調查 30 min + 修(視方案)30-60 min
- **依賴:** 無(獨立、跨頁;建議 g 收尾或上線前處理)
- **發現於:** 2026-05-27 / g-1a(Sean 拍獨立 slice)
- **相關:** Header autoMobile(innerWidth<1080 自判)、filter-top.css / account.css 等 [data-mobile] 樣式、「完整手機 RWD」專案價值

---

### #193. ⏳ 跨 provider identity linking 政策(Email / Google / LINE 三方撞同人)

- **狀態:** ⏳ 待實作(**最晚 g-5(地址)/ g-6(愛車)前必修**、Sean 已拍 C 中庸引導;g-2 / g-3 / g-4 不擋)
- **優先級:** 🟠 中(影響真資料接入後的 UX 完整性、上線前必修)
- **問題:**
  - 同一個人用 Email / Google / LINE 三種方式登入,目前**會建 3 個各自獨立的 auth.users + customers row**,業務資料(地址 / 愛車 / 儲值金)各自為政、不互通。g-1 肉眼驗確認此 UX 災難雛形(Sean 戳到「3 方法 = 3 帳號、資料會不會錯亂?」)。
  - LINE 端已有「拒絕跨 provider 併帳」的硬擋(`apps/storefront/src/lib/auth/line-admin.ts` L81:撞 email_exists 只驗 LINE 身分鍵才放行、Q2=A 拍板)。
  - Email + Google 互撞**完全沒寫處置**(`apps/storefront/src/app/auth/callback/route.ts` 只 exchangeCodeForSession 後 redirect、零 email 撞檢測)、靠 Supabase 預設行為、結果不可預測(同 email 走 Google 註冊可能 silently merge 也可能 fail)。
- **觸發事件:**
  - 2026-05-28 / Sean g-1 肉眼驗時戳到「3 方法 = 3 帳號?資料會不會錯亂?」/ 陪審腦查證後揪出 Email+Google 撞處置缺漏 + Sean 拍 C 中庸引導。
- **拍板:** **C 中庸引導**(2026-05-28 Sean):
  - LoginPage 加引導文案「之前用過 X 嗎?請繼續用 X」(三方法都看得到)
  - 註冊 server-side 擋同 email 跨 provider 撞(Email/Google 互撞時拋具體錯誤訊息)
  - **不做 Supabase auto-link**(避免動到 f1-b「Confirm email OFF 直登」拍板)
- **預期解法:**
  - ① LoginPage 加引導文案(純前端、單頁改動)
  - ② Email 註冊 server action 加跨 provider 撞檢測(查 auth.users 既有 user 的 `app_metadata.pcm_provider`、不是 `'email'` 就拋「請改用 X 登入」)
  - ③ Google OAuth `/auth/callback` route 撞既有 email 處置(若既有 user 是 `'email'` / `'line'` provider、拋錯回 `/login?error=oauth-conflict`)
  - ④ LINE 端**現狀已足夠**(`line-admin.ts` 已硬擋)、本案不動 LINE 代碼
- **LINE 的非對稱限制(必須在 #193 + Sean 心智模型釘清楚):**
  - LINE OAuth scope 不取 email(Q4=A、不等 LINE email 權限審核)、系統拿不到 LINE 用戶真 email
  - 因此**無法自動偵測「LINE 帳號 vs 既有 email / Google 帳號是否同人」**
  - LoginPage 引導文案 LINE 用戶看得到(共享頁面);但「撞 email 自動擋」對 LINE 不適用、撞不到
  - LINE 帳號想連通既有 email 帳號 → 走另一軌「會員中心補綁 email」(擴 backlog #179)
- **架構決策依賴(必須先決才能實作、對應 codex k1 round2 #193 consider):**
  - 解法 ② / ③ 都要「查 auth.users 既有 user 的 `app_metadata.pcm_provider`」。auth.users 預設不對 anon / authenticated 開查詢、必須走 Supabase admin API(`supabase.auth.admin.listUsers` / `getUserByEmail`)、需要 **service_role key**。
  - 三條路擇一(實作前 Sean 拍):
    - (a) **storefront 開第二個受控小門** 注入 service_role 給 Email/Google 註冊路徑(對齊 f2 `line-admin.ts` ADR-0005 §8.4 同款護欄四條:server-only + runtime=nodejs + 受控 eslint-disable + commit 前 grep client bundle)
    - (b) **改放 apps/api 服務端**(目前 PCM 還無 apps/api;Phase 1 不該為此開新 app)
    - (c) **DB 端 unique constraint + helper view**(view 對 anon 受控 SELECT 只 expose email + provider 兩欄;不需要 service_role、但要寫 migration + RLS)
  - (a) 是最低成本、與 f2 對齊;(c) 是最對齊 Supabase pattern。需 Sean 拍。
  - 任一選擇都觸發鐵則 8(重大改動)+ 鐵則 12(動 security)→ 必走 plan + codex 雙關卡。
- **不修會痛在:**
  - 擴充性:g-5 / g-6 接真資料後、Sean 跨方法登入會看到資料分裂、UX 災難明顯;新增 provider(Apple / Facebook)時撞處置策略 = 反覆寫一次
  - 可維護性:三方法的撞處置政策必須統一寫死、否則散落各 provider 邏輯(register action / OAuth callback / 各 adapter)都要記得處置
  - bug 可追蹤性:「為什麼我的愛車不見了」回溯困難、除非政策明文化
- **估時:** 架構決策拍板 30 min + LoginPage 引導文案 30 min + Email/Google 撞處置(視解法 a/b/c)60-120 min + 測試 30 min;合計 ~2.5-3.5 hr
- **依賴:** Email + Google 已 wired(f1-b / f1-c ✅);LINE 已硬擋(f2 ✅)、本案不再動 LINE;auth admin lookup 路徑必須先拍(見上方架構決策依賴)
- **發現於:** 2026-05-28 / g-1 肉眼驗 / Sean 拍 C 中庸引導
- **相關:** #179(會員中心補綁 email 子題)、line-admin.ts L81(LINE 現有硬擋)、f1-b / f1-c(Email/Google 註冊路徑)、g-5 / g-6(資料分裂顯現時點)、ADR-0005 §8.4(受控小門 service_role 護欄)

### #194. ✅ /cart 路由建立(MobileTabBar 購物車 tab disabled 解除)

- **狀態:** ✅ 完成(2026-06-06 M-3-S2-b2-d:新 app/cart route〔page.tsx + CartView.tsx + actions.ts〕+ cart.css〔搬 design AccountPages.jsx CartPage L11-178、非 CartPage.jsx〕;MobileTabBar 購物車 tab 改 `<Link href="/cart">` + matches=startsWith('/cart')、解除 disabled;同步 MobileTabBar.test.tsx〔找車仍 disabled、購物車 enabled + /cart active〕。Header NAV_ROUTE_MAP.cart='/cart' 早已就位、無需改)
- **優先級:** 🟡 低(M-3 訂單流程一併處理、Phase 1 階段無真結帳流程)
- **問題:**
  - storefront `apps/storefront/src/app/cart/` 路由 0 處(grep 驗、2026-05-28),但 Header.tsx L27-31 NAV_ROUTE_MAP.cart = '/cart' 字面已寫、點下去會 404
  - #192 搬 MobileTabBar 時暴露此漏:購物車 tab 需 disabled(`<span aria-disabled="true">`)、待 #194 完成後改 `<Link href="/cart">`
- **觸發事件:**
  - 2026-05-28 / #192 codex k1 FIX-2(grep 驗 app/cart 0 處、plan 字面不實)
- **預期解法:**
  - 新建 `apps/storefront/src/app/cart/page.tsx`(對齊 design CartPage.jsx 字面)
  - 字面從 `design-reference/components/CartPage.jsx` 搬
  - 移除 MobileTabBar.tsx 購物車 tab 的 `disabled: true`(改 href: '/cart' + matches 函式)
  - 移除 Header NAV_ROUTE_MAP 註解(目前 cart 已在 map 內、無需改)
- **不修會痛在:**
  - 擴充性:Phase 1 結帳流程一定要 cart 入口、不修等於核心電商流程缺一角
  - 可維護性:Header / MobileTabBar 兩處 cart 入口都假裝 disabled、容易忘
  - bug 可追蹤性:Sean 點購物車 = 404 / disabled 點不到、不知道是 bug 還是設計
- **估時:** 30-60 min(取決於 design CartPage 複雜度)
- **依賴:** M-3 真訂單流程啟動;或先做純前端 mock(從 CartContext 讀)、結帳留 M-3
- **發現於:** 2026-05-28 / #192 codex k1 FIX-2
- **相關:** Header.tsx L27-31 NAV_ROUTE_MAP / MobileTabBar.tsx cart tab disabled / design CartPage.jsx

### #195. ✅ ~~/vehicle-search 路由建立~~(MobileTabBar 找車 tab disabled 解除)

- **狀態:** ✅ 完成 2026-08-03(片 A1;**沒有建 `/vehicle-search` 路由** —— Sean 08-03 拍 B 案
  「同落地+開燈」:找車 tab 改連 `/products?pick=vehicle`,落地即開燈〔桌機聚焦廠牌欄、
  手機自動開 MobileVehicleSheet〕。本條的「依賴:Sean 拍板 hash anchor 還是獨立路由」由此回答,
  而且**兩個都不是** —— 是第三條路,比原估的 15-60 分鐘更省、也不留一條只為了 tab 而存在的路由。
  同片一併移除 `MobileTabBar.tsx` 整個 `disabled` 分支〔找車是它最後一個使用者〕。
  計畫 = `docs/specs/2026-08-03-vehicle-picker-unification-wire-plan.md` §5.2)
- **優先級:** ~~🟡 低(M-1-15 或 Phase 2 處理)~~
- **問題:**
  - storefront `/vehicle-search` 路由未建,#192 搬 MobileTabBar 時找車 tab 必 disabled
  - design App.jsx L170 MobileTabBar 第 3 tab 是 `vehicle-search`
- **觸發事件:**
  - 2026-05-28 / #192 plan v2(原註解寫 fold #189、後修正為 #195、避撞 #189 = Webwright)
- **預期解法:**
  - 新建 `apps/storefront/src/app/vehicle-search/page.tsx`(對齊 design 字面、若 design 有對應頁)
  - 或:沿用 VehicleFinder 元件(/ 內 hash anchor #vehicle-finder、Header 用此 pattern)、tab 改 `<Link href="/#vehicle-finder">`
  - 移除 MobileTabBar.tsx 找車 tab 的 `disabled: true`
- **不修會痛在:**
  - 擴充性:design 真權威 5 tab 缺一、UX 漂移
  - 可維護性:Header.tsx L94 既有 navItem `vehicle` 已用 `/#vehicle-finder` pattern、兩處不對齊
  - bug 可追蹤性:Sean 點找車 = disabled 不能點、不知道是 bug 還是設計
- **估時:** 15-30 min(若用 hash anchor pattern)或 60 min(若新建獨立頁)
- **依賴:** Sean 拍板「找車」是 hash anchor 還是獨立路由
- **發現於:** 2026-05-28 / #192 codex k1 FIX-2 衍生
- **相關:** Header.tsx L94(`vehicle` navItem 已用 `/#vehicle-finder`)、MobileTabBar.tsx 找車 tab disabled / VehicleFinder.tsx

---

### #196. ✅ ProfileTab saveProfile setTimeout 無 unmount cleanup(Nit、codex 關卡2)

- **狀態:** ✅ 完成 2026-06-16(commit d884f55:saved-timer 改 effect-driven useEffect([saved])、cleanup 於 unmount/saved-變更 clearTimeout、消 setState-after-unmount;零 eslint-disable)
- **優先級:** 🟢 觀察(極低優先)
- **問題:**
  - `ProfileTab.tsx` submit 成功後 `setTimeout(() => setSaved(false), 1800)`(對齊 design saveProfile L419-420)復原「✓ 已儲存」按鈕態、無 timer cleanup
  - 切 tab 離開 profile 頁(AccountView 條件 render 卸載 ProfileTab)時、pending timer 仍會在 1800ms 後對已卸載元件 setState
- **觸發事件:**
  - 2026-05-29 / M-1-14e-g-4b codex 關卡2 finding(Nit、非阻擋、Sean 拍 A 延後)
- **預期解法:**
  - `useRef` 存 timer id + submit 前清舊 timer + 元件 unmount(或 effect cleanup)清 timer
- **不修會痛在:**
  - 擴充性:React 18+ 下 setState-after-unmount 目前是 no-op 無害;未來改 state 管理(如搬 reducer / Suspense transition)或 React 行為變動時,殘留 timer 可能 console warn / 記憶體殘留
  - 可維護性:後人看到「無 cleanup 的 setTimeout + setState」會懷疑是漏寫、需翻 git 才知是刻意對齊 design 行為
  - bug 可追蹤性:若未來真冒 warn、「為何切 tab 後 1800ms 報 setState on unmounted」難一眼定位到此 timer
- **估時:** 10-15 min
- **依賴:** 無
- **發現於:** 2026-05-29 / M-1-14e-g-4b codex 關卡2
- **相關:** ProfileTab.tsx(saveProfile saved 態切換、Q3=A)

---

### #197. ✅ ProfileInput phone/birthday 無格式驗證(Consider、codex 關卡2)

- **狀態:** ✅ 完成 2026-06-16(commit cf8ee65:ProfileInput phone/birthday 加選填格式 refine〔空字串放行、phone 沿用 RegisterInput pattern、birthday YYYY-MM-DD〕、透過既有 #181 雙通道給精準欄位錯)。殘:birthday regex 不驗真實日期〔2026-13-45 過 regex、native input 保證、繞過被 DB 擋成通用錯〕屬可接受 backstop 取捨
- **優先級:** 🟡 低
- **問題:**
  - `packages/schemas/src/index.ts:86` ProfileInput 的 phone / birthday 僅 `z.string().default('')`、無格式 refine
  - 用戶填錯格式(如生日非 `YYYY-MM-DD`)→ DB date 欄解析錯 → updateProfileAction generic catch 吞成帳號層級「儲存失敗,請稍後再試」、而非該欄逐欄紅字
- **觸發事件:**
  - 2026-05-29 / M-1-14e-g-4b codex 關卡2 finding(Consider)+ 審查 session 同步觀察(Sean 拍 A 延後)
- **預期解法:**
  - `ProfileInput.birthday` 加 `YYYY-MM-DD` regex/refine(允許空字串)、`phone` 加長度/字元限制
  - 讓格式錯走 #181 fieldErrors 逐欄通道(client/server 同一份)、不被 generic catch 吞成帳號層級錯
- **不修會痛在:**
  - 擴充性:profile 之後接更多欄(地址 / 統編)時、無欄位格式驗證 pattern 可循
  - 可維護性:「儲存失敗」帳號層級錯掩蓋真因(哪欄格式錯)、客服難複現
  - bug 可追蹤性:DB date 解析錯被 generic catch 吞、log 只見「儲存失敗」、定位需翻 server 端 raw error
  - (非安全問題:格式驗證缺失改不到越權欄、五層信任邊界仍守住)
- **估時:** 20-30 min(動 @pcm/schemas 契約 + 補 schema/action 測試、獨立小 slice)
- **依賴:** 無(可獨立做、不擋 g-5~g-7)
- **發現於:** 2026-05-29 / M-1-14e-g-4b codex 關卡2
- **相關:** packages/schemas/src/index.ts:86 ProfileInput / app/account/profile/actions.ts updateProfileAction / #181 雙通道

---

### #198. ⏳ customer_addresses 統編 DB CHECK(invoice_tax_id ^\d{8}$、company 模式)(Consider、codex 關卡2)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - company 發票模式統編 8 碼格式目前只在 server zod(**canonical `CheckoutInvoiceInput` 的 superRefine** `/^\d{8}$/`;U3a 起 AddressInput 與 CheckoutInput 共用同一實例、不再各抄一份)守、DB 層無 CHECK
  - 直打 Supabase REST/RPC API(繞 storefront server action)可寫入 malformed 統編(如 7 碼 / 含字母);現有 DB CHECK 只有 `addresses_invoice_company_has_data`(title/taxId 非空)、不驗 8 碼格式
- **觸發事件:**
  - 2026-05-29 / M-1-14e-g-5b codex 關卡2 round1 finding(Consider、非阻擋、不擋 g-5b)
- **預期解法:**
  - migration 加 `ALTER TABLE customer_addresses ADD CONSTRAINT addresses_invoice_taxid_format CHECK (invoice_type <> 'company' OR invoice_tax_id ~ '^\d{8}$')`(forward + rollback + advisor check)
  - 與 server zod superRefine 對齊(雙層守:server 主驗、DB 不變式最後防線)
- **不修會痛在:**
  - 擴充性:之後接電子發票 API(財政部)時、malformed 統編會在開票端撞錯、難回溯來源
  - 可維護性:資料層無不變式、「為何有 7 碼統編」需翻 server 驗證史
  - bug 可追蹤性:報表 / 開發票時撞 malformed 統編、根因(繞 server 寫入)難定位
  - (非跨 user 越權問題:RLS 仍守自己 row;格式缺失影響資料品質非安全)
- **估時:** 20-30 min(動 migration + advisor check;鐵則 12 觸發 = 獨立 slice)
- **依賴:** 無(可獨立做、不擋 g-5c~g-7)
- **發現於:** 2026-05-29 / M-1-14e-g-5b codex 關卡2 round1
- **相關:** packages/schemas/src/index.ts **`CheckoutInvoiceInput`**(U3a 起的 canonical 發票 schema;原分散在 AddressInput / CheckoutInputBase 兩份、已收斂)/ customer_addresses 表(M-1-14a migration)/ 鐵則 12(動 migration / schema)

---

### #199. ✅ updateAddress 純編輯(非 isDefault)patch 加 app 層 ownership 檢查(Consider、codex 關卡2 g-5c)

- **狀態:** ✅ 完成 2026-06-16(commit c178459:抽 verifyAddressOwned/verifyVehicleOwned helper、updateAddress/updateVehicle plain-update 分支加 app 層 ownership backstop〔defense-in-depth on RLS、Sean Q2=A 接受 RLS 為邊界之上〕;updateVehicle 鏡像同修〔g-6c 同病〕;延後 codex〔quota 6/18、只增不減的 ownership gate〕)
- **優先級:** 🟡 低
- **問題:**
  - g-5c updateAddressAction 純編輯(patch 非 isDefault)路徑目前只靠 RLS `addresses_update_own`(USING + WITH CHECK)守 ownership;use-case `updateAddress` 僅在 `patch.isDefault` 時才跑 `verifyOwnedThenUnsetOthers`(app 層 listByCustomer 驗本人)
  - delete / isDefault 兩路徑另有 use-case app 層防線(listByCustomer / verifyOwnedThenUnsetOthers);唯獨 plain-update 無 app 層 backstop
- **觸發事件:**
  - 2026-05-31 / M-1-14e-g-5c codex 關卡2 finding(Consider、非阻擋);Sean 拍 Q2=A 接受 RLS(authenticated client、非 service_role)為 server 端 ownership 邊界、暫不在 g-5c 補 app 層
- **預期解法:**
  - 與 e-2a `updateAddress` use-case 同 slice 評估:plain-update 也先 `listByCustomer` 驗本人、非本人 patch → 拋
  - 改動需補「非本人 plain-patch → 拋」測試、並移除現有「非 isDefault 不查清單(省 round-trip)」斷言
- **不修會痛在:**
  - 擴充性:之後若新增非 authenticated 寫入路徑(service_role job / admin),plain-update 失去 app 層守、跨會員編輯防線單點
  - 可維護性:三條寫入路徑(delete / isDefault / plain-update)ownership 驗證不一致、後人易誤判「都有 app 層守」
  - bug 可追蹤性:RLS 若被誤改 / 停用,plain-update 跨會員編輯不會在 app 層擋、難在 use-case 測試捕捉
  - (非當前安全漏洞:RLS USING+WITH CHECK 現守 own row;此為 defense-in-depth backstop)
- **估時:** 20-30 min(動 packages/use-cases/src/update-address.ts + 測試;非本 g-5c-fix1 範圍)
- **依賴:** 無(可獨立做、不擋 g-6~g-7)
- **發現於:** 2026-05-31 / M-1-14e-g-5c codex 關卡2
- **相關:** packages/use-cases/src/update-address.ts `updateAddress` / `_address-default.ts` verifyOwnedThenUnsetOthers / RLS addresses_update_own(M-1-14a)/ #198(同 codex address review 系列)

---

### #200. ⏳ 「我的愛車」車款 → products filter 快速帶入(跨 bounded context 連動、綁 Phase 2 結構化 vehicles)

- **狀態:** ⏳ 待實作(Sean 2026-05-31 g-6 規劃時提:在 filter 附近加功能、讓 filter 快速帶入我的愛車車款;拍 ③.5=A 連動綁 Phase 2、g-6 先照 design 自由文字)
- **優先級:** 🟠 中(真會員資料接入後的 UX 完整性;Phase 1 不擋 g-6、屬 Phase 1.5 / Phase 2 範圍)
- **問題:**
  - 會員中心「我的愛車」(`customer_vehicles.name`)是**自由文字**(例「YAMAHA YZF-R6」、design InlineVehicleForm L760 text input);
  - products filter / 商品適用車款是**結構化**(`vehicleFilter:{brand,model,year}`、design HANDOFF-OVERVIEW L133;`FitmentSpec{motoBrand,modelCode,yearStart,yearEnd}`、catalog/types.ts L75);
  - graphify 結構驗證(2026-05-31、graph@76c40bc):`CustomerVehicle`(Identity context、community 28)與 `FitmentSpec`(Catalog context、community 19)**零邊相連** → 連動需跨 bounded context 架橋、非小改;
  - 自由文字 → 結構化對映不可靠(backlog 既記「R9 / YZF R9 / YZFR9 → 同一車」別名分層難題、見 #177 周邊);硬接會「YZF-R6 vs R6 對不上 = 空」。
- **觸發事件:**
  - 2026-05-31 / M-1-14e-g-6 規劃 / Sean 提「filter 附近快速帶入愛車車款」+ 拍 ③.5=A(graph + 紀錄佐證連動天生 Phase 2)
- **預期解法(Phase 2、跟結構化 vehicles 一起):**
  - ① customer_vehicles → Phase 2 獨立結構化 Vehicle entity(brand / model / year 分離、對齊 docs/features/vehicle-service-ecosystem.md §5.1 + bounded-contexts.md L29);
  - ② products filter 真按車款過濾啟用(依賴 #152、現照搬 design 不過濾);
  - ③ 會員中心 / products 頁加「用我的愛車找配件」鈕 → 寫 design 既有 `pcm-vehicle-filter` localStorage SoT + dispatch `pcm-vehicle-filter-change`(HANDOFF-OVERVIEW L141)→ 跨頁帶入;
  - ④ 車款名稱正規化(品牌 / 型號別名分層、#177 周邊)確保 filter ↔ fitment ↔ 愛車三方對齊。
  - (Phase 1.5 替代:若 Sean 要早看到、可先做「盡力版」free-text→filter best-effort prefill、但對映不保證準、且依賴 #152 先啟用;成本/效果權衡待 Sean 拍)
- **不修會痛在:**
  - 擴充性:愛車與商品搜尋永遠隔離、會員「用我的車找配件」這條轉化路徑斷掉;
  - 可維護性:若 Phase 1 硬塞結構化欄位、Phase 2 重構 vehicles 時變兩套 schema 對映;
  - bug 可追蹤性:自由文字硬接 filter、對不上時 silently 回空、難回溯是資料問題還是邏輯問題。
- **估時:** Phase 2 範圍(結構化 vehicles + filter 過濾 + 帶入鈕 + 正規化合計數天);Phase 1.5 盡力版約 2-3 hr(依賴 #152)。
- **依賴:** Phase 2 結構化 vehicles entity;#152(filter 真過濾);#177(vehicle service 正規化周邊);#195(/vehicle-search 找車路由)。
- **發現於:** 2026-05-31 / g-6 規劃 / graphify 結構驗證(Identity↔Catalog 零邊)
- **相關:** packages/domain/src/identity/vehicle.ts(CustomerVehicle 自由文字)/ packages/domain/src/catalog/types.ts FitmentSpec / apps/storefront/src/components/FilterSide.tsx + filter-state.ts / design-reference/design-reference/HANDOFF-OVERVIEW.md L133/L141(vehicleFilter SoT)/ docs/features/vehicle-service-ecosystem.md(Phase 2 PRD)/ #152 / #177 / #195

---

### #201. ✅ 表單必填欄純空白字串驗證(name trim、跨 address/vehicle schema 一致)(Consider、codex 關卡2 g-6b)

- **狀態:** ✅ 完成 2026-06-16(commit bb31d97:AddressInput name+line、VehicleInput name 改 .trim().min(1)〔純空白 reject、入庫去頭尾空白〕、對齊 design L705/L774;RegisterInput/ProfileInput name design 無 trim〔L261/saveProfile〕刻意不擴〔鐵則 1 不比 design 嚴〕、已補刻意省略註解)
- **優先級:** 🟡 低(邊角 UX、非安全)
- **問題:**
  - design InlineAddressForm L703 / InlineVehicleForm L777 submit 用 `!form.name.trim()` 擋純空白;
  - 但 server schema `AddressInput.name` / `VehicleInput.name` 用 `z.string().min(1)`(packages/schemas/src/index.ts L43/L74)、**只擋空字串不擋純空白**(「   」min(1) 通過)。
  - 跨表單一致(address + vehicle 同樣 min(1) 非 trim)、同源差異。
- **觸發事件:**
  - 2026-05-31 / M-1-14e-g-6b codex 關卡2 finding(Consider、非阻擋);g-5b/g-5c address 同議題未爆、此次 vehicle 一併記。
- **預期解法:**
  - schema name 改 `z.string().trim().min(1)`(zod v4 trim transform);address + vehicle 同步、補純空白 → fieldErrors 測試。
- **不修會痛在:**
  - 可維護性:client design trim 與 server min(1) 行為不一致、後人易誤判「server 已擋空白」;
  - bug 可追蹤性:純空白車型/收件人入庫、清單顯空白卡、難回溯是輸入問題。
- **估時:** 15-20 min(動 packages/schemas/src/index.ts 2 處 + 測試)
- **依賴:** 無
- **發現於:** 2026-05-31 / M-1-14e-g-6b codex 關卡2
- **相關:** packages/schemas/src/index.ts AddressInput/VehicleInput name / InlineAddressForm L703 / InlineVehicleForm L777

---

### #202. ⏸ 儲值金 deposit 功能 hold(台灣儲值法規未定)+ g-7 wallet 頁推延

- **狀態:** ⏸ HOLD(Sean 2026-05-31 拍:儲值法規+商業模式未定、不做 deposit、g-7 推延)
- **優先級:** ⏸ 暫不排程(Sean 主動解 hold 才動)
- **問題 / 背景:**
  - 台灣「儲值」踩法規邊緣 —— 多用途儲值金可能落入《電子支付機構管理條例》、需金管會核准/牌照。Sean 還沒想清楚商業+法規模式。
  - 在定案前不該先把儲值功能(連 mock 寫 ledger)做出來、避免架構/UI 先承諾未定模式。
  - 連帶:g-7「儲值金」wallet 頁推延、不在 g-6 批次內;WalletTab 維持 stub。
- **現況地基(已備、不接 UI):**
  - e-3 depositWallet(packages/use-cases/src/deposit-wallet.ts、mock、走 service_role writeClient)、customer_wallet_ledger 表 + RLS、IWalletRepository.addEntry/getBalance/listEntries、SupabaseWalletAdapter(雙 client)。
  - 純顯示:OverviewTab 已顯 wallet_balance(直查 customers.wallet_balance)、nav 有「儲值金」tab —— 既有 balance 欄位顯示、無 deposit 動作、暫留(要下架另拍)。
  - g-7 recon(2026-05-31)確認:讀餘額+ledger 明細在 storefront 可行(authenticated 直查 customers+customer_wallet_ledger、g-2 pattern);deposit 寫入卡 service_role(storefront 不持)。
- **解 hold 後的兩條路(待 Sean 定案):**
  - (純讀)g-7 只顯示餘額卡+會員等級卡+ledger 明細(authenticated 直查、零架構改動);「立即儲值」鈕降級/不渲染。
  - (含 deposit)另開 service_role 受控小門(ADR-0005 §8.4 護欄)+ deposit server action 接 e-3 —— 鐵則 8+12、需 plan + codex 雙關卡;且真扣款仍要等 TapPay(#3)+ 法規定案。
- **不修的影響(可接受):** 會員中心少一個 wallet tab 內容、但 balance 已在 overview 顯;愛車 CRUD(g-6)不受影響、批次照常。
- **依賴:** 台灣儲值法規/商業模式定案(Sean) + TapPay sandbox(#3) + 真扣款合規。
- **發現於:** 2026-05-31 / g-7 規劃 / Sean 主動提台灣儲值法規邊緣
- **相關:** memory project_wallet-deposit-taiwan-legal-hold / e-3 depositWallet / #3 TapPay sandbox / docs/PHASE-1-NORTHSTAR.md(儲值金 mock 定位)/ STATUS 待決策

### #203. ⏳ product_variants_public adapter 接線 + contract test(M-1-16a view 立、待 16c 切)

- **狀態:** ⏳ 待執行(M-1-16c、同 M-1-16 milestone 緊接、不跨 milestone)
- **優先級:** 🟠 中(view 立但 adapter 未切 = working-style 第 35 條反模式、不允許跨 milestone 遺留)
- **問題:**
  - M-1-16a 建 `product_variants` 表 + `product_variants_public` view(security_invoker、排除 price_store/metadata),但 Sean D1=A 拍板把「adapter 讀變體接線」移到 16c。
  - 現況:view 已立、base 表防護三層已上,但 application 層尚未讀 view(adapter 5 read method / PRODUCT_SELECT_DETAIL 投射本片不動)。詳情頁尚無法顯變體。
- **觸發事件:** M-1-16c 前台接真變體(詳情頁規格選擇器吃真 variants)— view 立必跟 adapter 切換、最遲同 milestone(working-style 第 35 條 L445/L448)。
- **預期解法:**
  - `SupabaseProductAdapter`:detail 查詢(findById + 新增 findByHandle)投射 embed `product_variants_public(...)`(不含 price_store);list 路徑維持不帶變體(避免 N+1 jsonb 膨脹)。
  - mapper 加 `mapVariantRow`:從兩整數欄重組 priceByTier(general 從 price_general、store dummy、premiumStore placeholder、鏡像 mapSupabaseProductToDomain);Product.variants 填真值。
  - **images shape 正規化**(codex 關卡2 consider 2):DB `product_variants.images` jsonb 對齊 domain `ProductVariant.images: string[]`(URL 字串陣列、**非 `[{url}]`**);16b 從來源 `[{url}]` 抽 url 寫成 string[]、16c `mapVariantRow` 直送 string[](防 16b/16c 兩種 shape 不一致;migration A inline 註解 `[{url}]` 為來源 shape、商城存 string[] 為準)。
  - `save` 變體獨立 upsert(onConflict sku、service_role 雙寫 general+store);`updated_at` app 端帶。
  - **contract test 驗 view 不回敏感欄**(working-style 第 35 條 L446):直接測 `product_variants_public` DDL 投射清單不含 price_store / metadata、+ adapter mapVariantRow 不洩經銷價。
- **不修會痛在:**
  - 擴充性:view 立 adapter 未切跨 milestone 遺留 → application strip 為主、view 為輔的反向倒置(第 35 條明禁)。
  - 可維護性:16c 不接則詳情頁變體永遠空陣列、16b 灌的 7277 變體無消費端、形同死資料。
  - bug 可追蹤性:無 contract test 驗 view,未來改投射欄位若誤加 price_store 無自動防線、經銷價洩漏不會被 CI 擋。
- **估時:** 60-90 min(adapter embed + mapVariantRow + findByHandle + save 變體 + contract test;list/detail 投射拆分)
- **依賴:** M-1-16a schema 落地(✅ 本片)
- **發現於:** 2026-05-31 / M-1-16a / codex 關卡1 consider 2(working-style 第 35 條 view-adapter 時序)
- **相關:** #81(variants 落地)/ working-style 第 35 條 / M-1-16 handoff §4 16c / docs/design-storefront-manifest.yaml

### #204. ⏳ storefront service_role key legacy JWT → 新式 Secret key 全站遷移(M-1-16b-2 Sean 拍)

- **狀態:** ⏳ 待執行(Sean 2026-06-01 拍:16b import 用新式 SECRET_KEY、storefront 既有 SERVICE_ROLE_KEY 留全站遷移)
- **優先級:** 🟡 低(legacy JWT 仍有效、Supabase 未停用;新式 Secret key 是建議走向)
- **問題:**
  - Supabase 推新式 API key(`sb_secret_…` / publishable)取代 legacy service_role JWT。
  - 16b-2 import 腳本已用新式 `SUPABASE_SECRET_KEY` / `SOURCE_SUPABASE_SECRET_KEY`;但 storefront 既有 `createSupabaseServiceClient`(packages/adapters/src/supabase/client.ts)+ line-admin.ts 仍讀 legacy `SUPABASE_SERVICE_ROLE_KEY`。
  - 兩套 key 並存(import 新式、storefront legacy)= 過渡態、最終應全站統一。
- **觸發事件:** Supabase 宣布停用 legacy JWT / 全站 key 統一整理時(不急、legacy 仍有效)。
- **預期解法:**
  - storefront `createSupabaseServiceClient` + line-admin + `.env.example` 改讀新式 Secret key
  - 確認新式 Secret key 對 RLS bypass / service_role 權限等效
  - 各環境(local/preview/prod).env 同步換 key、legacy JWT 退場
- **不修會痛在:**
  - 擴充性:兩套 key 並存、新人不知哪個該用哪個
  - 可維護性:legacy JWT 若被 Supabase 停用、storefront service 路徑斷
  - bug 可追蹤性:key 類型混用、權限問題排查多一層
- **估時:** 30-60 min(改 client.ts + line-admin + .env.example + 各環境 key)
- **依賴:** 無前置(legacy 仍有效、不急)
- **發現於:** 2026-06-01 / M-1-16b-2 / Sean 拍 import 用新式 SECRET_KEY、storefront 遷移留 backlog
- **相關:** scripts/rpm-import.ts(已用新式)/ packages/adapters/src/supabase/client.ts / apps/storefront line-admin.ts

### #205. ⏳ featured 首頁推薦改用適當機制(featured 旗標 / 跨分類查全站)(M-1-16b 肉眼驗 Sean 拍 A、B 正解留)

- **狀態:** ⏳ 待執行(未來多分類 / 後台要控精選時)
- **優先級:** 🟡 低(Phase 1 只「碳纖維部品」一類、現 hardcode 查該分類夠用)
- **問題:**
  - `fetchFeaturedProducts`(lib/products.ts)hardcode 查單一 category(原 mock「操控部品」placeholder → 2026-06-01 Sean 拍 A 改「碳纖維部品」讓 RPM 顯示)。
  - 隨上架更多分類,「首頁編輯精選」應改用更通用機制、非綁死單一分類:
    (a) products 加 `featured` boolean 旗標(後台標精選)、featured 查旗標
    (b) 跨分類查全站前 N(adapter 加 listFeatured / listAll method)— 即肉眼驗時 B 選項
- **觸發事件:** 上架第二個分類 / 後台要控精選內容時。
- **預期解法:** A=featured 旗標(後台 CRUD 控、最貼「編輯精選」語意)或 B=adapter listFeatured 跨分類查全站;2026-06-01 當下用 hardcode「碳纖維部品」(最小、讓 Sean 肉眼驗)、通用機制留此。
- **不修會痛在:**
  - 擴充性:多分類時首頁只顯一類、精選不可控
  - 可維護性:category 字面 hardcode 在 code、改精選內容要改 code 重部署
  - bug 可追蹤性:featured 空白難判(查的 category 無商品 vs 真無精選)— 本次肉眼驗踩過此坑
- **估時:** 1-2 hr(featured 旗標 migration + 後台標記 + adapter method + featured 改查 + 三綠)
- **依賴:** 多分類上架 / 後台精選控制需求
- **發現於:** 2026-06-01 / M-1-16b 肉眼驗 featured 空白(featured 查不存在的「操控部品」)/ Sean 拍 A 暫改 category、B 正解留 backlog
- **相關:** apps/storefront/src/lib/products.ts `fetchFeaturedProducts` / HomeSelect N°02 編輯精選 / SupabaseProductAdapter

---

### #206. 🗺️ 詳情頁 ISR / 靜態快取 vs JSON-LD/OG 即時價一致性

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - M-1-16c-4c 詳情頁維持 dynamic(每請求查 + JSON-LD/OG 即時 general 價)、不設 revalidate。
  - 未來若為效能引入 ISR / 靜態快取,JSON-LD `offers.price` / OG 會被快取成舊價;後台改價後快取未刷新 → Google Merchant 商品結果顯舊價(政策風險)。
- **觸發事件:** 詳情頁要上 ISR / `revalidate` / 靜態化時。
- **預期解法:** 引入時評估 on-demand revalidate(改價 webhook 刷頁)或維持 dynamic;並重跑經銷洩漏驗證(快取 HTML 也要 grep)。
- **不修會痛在:**
  - 擴充性:盲目加 ISR 會讓結構化資料價格與後台脫鉤
  - 可維護性:價格不一致 bug 難從前台察覺(JSON-LD 是隱藏標籤)
  - bug 可追蹤性:Google Merchant 退件時才發現舊價、回溯成本高
- **估時:** 0.5-1 hr(評估 + on-demand revalidate 接線或維持 dynamic 決策)
- **依賴:** 詳情頁效能需求 / ISR 導入
- **發現於:** 2026-06-01 / M-1-16c-4c SEO 審查 CONSIDER 6
- **相關:** apps/storefront/src/app/products/[slug]/page.tsx / lib/product-jsonld.ts

### #207. 🔬 詳情頁 JSON-LD 經銷洩漏 rendered-HTML 自動化驗證(Playwright e2e + preview/prod 持續)

- **狀態:** 🟢 觀察(M-1-16c-4c 本 session 已**手動驗證 PASS**:`next start` :3100 + curl 真 handle `rpm-dcc01` → 經銷字串〔price_store/price_by_tier/priceByTier/premiumStore/cost/shopee/dealer/經銷〕全 0、JSON-LD offers=general 11800-14600 === 頁面顯示 general 價;留條目轉為「自動化 + preview/prod 持續驗證」)
- **優先級:** 🟡 低(手動已驗、降級)
- **問題:**
  - M-1-16c-4c JSON-LD 是 server-render 進 HTML(非 client static chunk)、`.next/static` grep 涵蓋不到;本 session 已手動 curl 驗證,但無**自動化迴歸**(未來改 JSON-LD/toUIProduct 可能再引入)。
  - preview/production 環境(真實網域 + canonical 啟用)尚未驗證。
- **觸發事件:** preview / production 部署時 / 改 JSON-LD builder 或 toUIProduct strip 邏輯時。
- **預期解法:** Playwright e2e 斷言 rendered HTML 無經銷字串 + JSON-LD offer 價 === 頁面 general 價;或 preview 部署後 curl 真 handle grep。
- **不修會痛在:**
  - 擴充性:未驗 rendered HTML = 經銷洩漏最終防線缺口
  - 可維護性:未來改 JSON-LD 無 rendered 層迴歸測
  - bug 可追蹤性:洩漏只在 SSR 出現時,單測 + static grep 抓不到
- **估時:** 0.5 hr(curl grep)/ 1-2 hr(Playwright e2e)
- **依賴:** preview 部署(#4)/ 或本機 live Supabase server
- **發現於:** 2026-06-01 / M-1-16c-4c SEO 審查 CONSIDER 5 + codex k1 MUST-FIX 4
- **相關:** apps/storefront/src/lib/product-jsonld.ts / page.tsx / 鐵則 12

### #208. 🧩 JSON-LD 型別化(schema-dts)

- **狀態:** ⏳ 待執行
- **優先級:** 🟢 觀察
- **問題:**
  - `buildProductJsonLd` 現回 `Record<string, unknown>`(白名單靠程式 + 單測守);引入 `schema-dts` 可在型別層防欄位漂移。
- **觸發事件:** JSON-LD 擴充(aggregateRating / gtin / 多 @type)時。
- **預期解法:** 加 `schema-dts` dep、builder 回 `Product`(schema-dts)型別。
- **不修會痛在:**
  - 擴充性:欄位多了靠人工白名單易漏
  - 可維護性:無型別約束、改錯欄名 runtime 才知
  - bug 可追蹤性:同上
- **估時:** 0.5 hr
- **依賴:** 無
- **發現於:** 2026-06-01 / M-1-16c-4c codex k1 NIT
- **相關:** apps/storefront/src/lib/product-jsonld.ts

---

### #209. 🌐 商品中文描述 pipeline workstream(baoyu-translate → 台灣校對)

- **狀態:** 🔵 方向升級 + 設計完成、報價單側已開 PRD v2(2026-06-03 設計 doc → 2026-06-04 PRD v2、見末段兩次升級;上方「預期解法」baoyu-translate 路線已被取代;權威 = 報價單 repo PRD v2)
- **優先級:** 🟠 中
- **問題:**
  - 報價單乾淨 view `storefront_catalog_v` 的 `description` 欄對 RPM **全空**(親驗 8878 列 0 描述);現有網站 933 商品描述是 16b 從 raw `description_origin` 灌的**英文 HTML 全文**(掛中文站本就不理想)。
  - S3b 決定 description **移出同步 scope**(不抓不寫、現有原地保留、新品 NULL);商品描述需獨立中文化來源。
- **觸發事件(任一觸發即啟動實作):**
  - S3b 上線後新 ~190 商品無描述、需補;或 Sean 要中文化既有英文 HTML 描述;或 pilot 驗證 baoyu-translate→台灣校對品質可接受。
- **預期解法:**
  - 獨立 workstream:英文來源 → `baoyu-translate`(精翻模式)→ 台灣繁中校對(taiwan-traditional-chinese)→ 寫回網站 `products.description`(非經 view 同步路徑、避免被每日 batch 覆寫;或設 description 為「sync 不覆寫」鎖值欄)。
  - pilot 先測少量、確認語氣/術語/規格正確再放量。
- **不修會痛在:**
  - 擴充性:其他 5 供應商上架同樣需描述中文化、無 pipeline 會逐家手工。
  - 可維護性:描述散落英文 HTML、無統一中文化流程 → 品質不一。
  - bug 可追蹤性:若描述誤入每日 sync 覆寫路徑、中文描述會被 view 空值洗掉(S3b 已用「不同步 description」隔離、但 pipeline 寫回點需明確標記不被覆寫)。
- **估時:** pilot 2-3 hr;放量視量。
- **依賴:** S3b(description 已隔離出同步路徑);baoyu-translate / taiwan-traditional-chinese skill。
- **發現於:** 2026-06-02 / S3b-1 dry-run(view.description 全空)+ Sean Q-desc 定案。
- **相關:** #205 / scripts/rpm-transform.ts(description 移出 scope)/ docs/specs/2026-06-02-S3b-sync-rewrite-plan.md §2.2
- **⬆️ 2026-06-03 重大升級(方向轉向、取代上方「預期解法」的 baoyu-translate 翻譯路線):**
  - **路線改為「結構化賣場內容生成」、非 prose 翻譯**(Sean 拍):baoyu-translate 直翻不滿意,根因=賣場文案要消四怕硬資訊而非漂亮翻譯、原文有 bug、5 家無原文。
  - **關鍵發現**:RPM `description_origin` 英文原文 **100% 在手**(均 760 字、爬蟲早抓、view 未投射);其他 5 家 **0 原文**(需爬官網補、第一版不做)。`translation_locked` 鎖定機制已存在(人工值爬蟲不覆蓋)。
  - **🔴 車種正確性鐵律**:AI 文案**完全不碰車種**、車款/年式走校正 `fitment_parsed` 直出(原文車種常錯:BMW 複製貼上 / 年份打架 / 名稱≠描述);適用車款表絕對強制(無資料顯「LINE 詢問」)。
  - **第一版範圍(Sean 拍 A/B/B)**:只 RPM、只商品級(brand_story 第一版不做)、其他家爬原文之後再排;做 **PCM 專屬 skill**(封裝賣場規則+RPM品牌通則+濾bug)批量跑。
  - **完整設計 + 3 件 pilot 範例 + 報價單側/網站側影響面 → 設計 doc**:`docs/specs/2026-06-03-storefront-content-model-design.md`(自包含、已寫交接橋接文字交報價單 session 開 PRD)。
  - 詳 memory `project_storefront-content-model-design`;報價單系統現況(dashboard /translations·/audit、spec jsonb、鎖定機制)見該 memory + 設計 doc §1。
- **⬆️ 2026-06-04 再升維(權威轉移到報價單 PRD v2、網站審查 session workflow 驗證):**
  - 報價單 session 已開立 **PRD v2**(`/Users/sean_1/API大量上架/PCM報價單-V2/docs/PRD-storefront-content-pipeline-v2-2026-06-04.md`),取代 2026-06-03 設計 doc 的「逐件 skill + 標題主車型」假設:主引擎改**程式範本工廠打底(zero AI 全量)+ AI 只補頭部 5–15%**、工作單位 = `main_sku` 群、範本鍵 = `major_category`、**標題車種 = 三叉 deterministic 規則**(Sean 2026-06-04 拍 A、取代「標題主車型」)、GEO 去重靠 DB 事實織入內文;上線前必修 fetcher DELETE 砍鎖 bug + 防殭屍下架(v2 §8/§11)。
  - **權威 = 報價單 repo PRD v2**;網站設計 doc(`docs/specs/2026-06-03-storefront-content-model-design.md`)已標 superseded + 對齊三叉標題(2026-06-04 網站審查 session)。
  - 網站側執行範圍(跨庫消費鏈 5 斷點 + 去 RPM 化前置 + contract-drift 測試)獨立記於 **#212**。
  - 經網站審查 session 對抗 workflow 驗證(30 findings、0 blocker);審查記錄 `docs/reviews/2026-06-04-v2prd-website-review.md`。

---

### #210. 🛡️ S5 同步抓取完整性:<5% 靜默截斷持久基線防線

- **狀態:** ⏳ 待執行(殘留缺口、誠實標)
- **優先級:** 🟠 中
- **問題:**
  - S5 W1 抓取完整性 gate(`rpm-preflight.ts` checkFetchIntegrity)用「target active 商品 − source main_sku 差集」+ 5% 門檻(嚴於 S4 下架 10%)抓 5–10% 靜默截斷。
  - 但 **<5% 的靜默截斷單次快照無法與「日常 <5% 合法下架」區分** → 仍會誤軟下架(規模小、≤5% active 商品)。fallback 對抗審查 W1-2 指出:根治需逐次比對「上次成功 fetch 基線」、非單次門檻。
- **觸發事件(任一觸發即啟動實作):**
  - 無人值守 cron 出現「商品莫名少量被下架但源頭其實有」事件;或要把誤下架風險壓到 0;或多供應商上架放大絕對筆數風險。
- **預期解法:**
  - 持久化「上次成功 fetch 的 RPM 商品/變體基線數」(小表 `sync_baseline` 或 artifact),每次 fetch 後比**上次基線**(非當下 target)、低於閾值 abort;成功 run 才更新基線。
  - 或請報價單側提供「來源預期總數」端點(view count)當權威基線、fetch 後核對。
- **不修會痛在:**
  - 擴充性:多供應商後絕對誤下架筆數放大(5% of N 變大)。
  - 可維護性:現靠「日常增量遠 <5%」假設、假設破裂(大改版日)無防線。
  - bug 可追蹤性:<5% 誤下架靜默發生、無基線比對難回溯是截斷還是真下架。
- **估時:** 2-4 hr(含 baseline 持久層)。
- **依賴:** S5(W1 gate 已落地 5–10% 帶)。
- **發現於:** 2026-06-03 / S5 fallback 對抗審查 W1-2(codex 替代)+ Sean 拍 A 留 backlog。
- **相關:** scripts/rpm-preflight.ts / scripts/rpm-reconcile.ts(S4 10% gate)/ docs/specs/2026-06-03-S5-scheduling-plan.md §5

---

### #211. 🧩 fitments 分組對髒字串敏感 — 匯入端車廠/車型正規化防未來拆堆

- **狀態:** ⏳ 待執行
- **優先級:** 🟢 觀察(當前資料 0 異常、非阻;新來源大批匯入前再評估)
- **問題:**
  - OD-12d 把適用車款表改成**依車廠+車型精準字串歸堆**(groupFitments)顯示。若匯入資料同一台車的 motoBrand/modelCode 字串不一致(尾空格 / 大小寫變體 / `RSV4` vs `RSV 4`),會被當成不同車、**拆成兩堆/兩列**(看起來重複、非報錯)。
  - **2026-06-03 唯讀實查正式庫(`bmpnplmnldofgaohnaok`)驗證:fitments 共 2873 筆、10 車廠 / 96 車型、`trim` 空格異常 **0**、`lower(trim())` case-fold 衝突 **0**、1123 商品 **100%** 有 fitments → 當前資料乾淨、零拆堆風險、OD-12d 分組對真資料正確(SQL 端模擬 groupFitments = 前端輸出 = 截圖)。**
  - 但**匯入端(S6 fitment 寫入 / rpm-import)無字串正規化守門** → 未來髒批可冒出拆堆。
- **觸發事件:**
  - OD-12d 重設計(扁平表→分組)後 Sean 問「DIV 分組撈 DB 一樣對嗎」→ 實查驗證資料乾淨,但發現分組比扁平表對字串一致性敏感、匯入端無 guard。
- **預期解法:**
  - 優先**匯入端**:rpm-import / S6 fitment 寫入時對 motoBrand/modelCode 做 `trim` + 統一大小寫(canonical case)正規化 — 根治、保護所有下游(不只 fitments UI、含 listByFitment `@>` 查詢、車款篩選)。
  - 治標備案:前端 `groupFitments` key 做防禦性 `trim`(便宜、但不解 fitment 篩選/查詢層)。
- **不修會痛在:**
  - 擴充性:未來新增別品牌 / 別供應商批次、不保證每批字串乾淨 → 髒批一進、fitments UI 立刻冒「同車款拆兩堆」+ 車款篩選 `@>` 精準比對漏命中(查 `RSV4` 漏 `RSV4 `)。
  - 可維護性:無正規化守門 → 每批匯入要人工肉眼檢查車款字串、無自動防線。
  - bug 可追蹤性:拆堆 / 漏命中是「看起來重複 / 查不到」非報錯、靜默發生、需人發現才知哪批髒。
- **估時:** 1-2 hr(匯入端 normalize + 測 + 既有資料一次性 backfill 驗)。
- **依賴:** 無(現資料乾淨、非阻);未來引入新 fitment 來源前處理較佳。
- **發現於:** 2026-06-03 / OD-12d 後 Sean 提問 + 唯讀實查驗證。
- **相關:** OD-12d(ProductFitments.groupFitments)/ scripts/rpm-import.ts / S6 fitment plumb / SupabaseProductAdapter.listByFitment(`fitments @>` jsonb 精準比對)

---

### #212. 🌉 賣場內容上網站:跨庫消費鏈網站側工作(PRD v2 §16 升格、報價單側改 view 必要非充分)

- **狀態:** ⏳ 待執行(綁報價單 PRD v2 pipeline;報價單側 P1/P5 schema+view 落地後啟動)
- **優先級:** 🟠 中(排 P2、LINE CTA + M-3 之後;但放量到非 RPM 家前「去 RPM 化」是硬前置)
- **問題:**
  - 網站**不直接讀**報價單 B 庫 `storefront_catalog_v`,中間隔每夜同步腳本(`scripts/rpm-import.ts` / `rpm-transform.ts`)從 B 庫撈 → 寫網站自有庫(`bmpnplmnldofgaohnaok`)products 表 → `products_public` view → adapter。報價單側把新欄投影進它的 view **不會自動讓網站看到**(2026-06-04 審查實證:`SupabaseProductAdapter.ts` 全走 `products_public`、零 `storefront_catalog_v`)。
  - **5 個斷點**(新內容要上網站須逐一改):① `rpm-fetch.ts` VIEW_COLS(寫死白名單、非 SELECT *)加新欄 ② `rpm-transform.ts` 映射進 ProductRow ③ 網站 products 表 migration 加欄 + `products_public` view 投影 ④ adapter `PRODUCT_SELECT_DETAIL` + `mappers/product.ts` 還原 domain ⑤ UI(MockProduct 型別 + ProductTabs / ProductSpotlight 接真值)。
  - **去 RPM 化**:`ProductInfo.tsx` 變體選擇器寫死 RPM key(weave/finish/special)、`ProductTabs.tsx` 規格表是**靜態 JSX 字面**(「真碳纖維/泰國/紋路」)。放量到非 RPM 家前必須先改 data-driven(schema-less key/value + 白名單 + 中文標籤 + 空兜底),否則 RPM 字面張冠李戴掛到非碳纖維商品。
  - **description 刻意停同步**:`rpm-fetch.ts:50` + Sean Q-desc 舊拍板「描述走獨立 workstream」→ 上中文文案前須先確認推翻該拍板。
  - **雙下架機制疊加**:網站庫已有自己的 `delisted_at` + RLS `USING(delisted_at IS NULL)` + `rpm-reconcile.ts` 對賬(S4 已上線、by-construction 安全);報價單側 v2 §11 若在 view WHERE 加 `delisted_at IS NULL`,等於提前移除缺席品 → 網站 reconcile 再判一次 → 雙重去抖延遲。需在合約 doc 釘死「缺席判定權威在哪側、N 天怎麼算」。
- **跨側決議(Sean 2026-06-04 拍 A/A):**
  - **description 同步**:停同步舊拍板「之後再推翻」—— 綁內容 pipeline 真接到網站那一步(P2 後)才改 `rpm-fetch.ts`;現在僅記意圖、不空接(避免搬一個還沒生出來的文案)。
  - 🔴🔴 **已於 2026-08-15 被推翻,見 `docs/specs/2026-08-15-products-manual-listing-override-plan.md`**
    —— Sean 拍板 `Q-B-2=甲`(把自動下架關掉、改成只標記)+ `Q-關哪一條=乙`(鏡射與對賬兩條都關)。
    業務理由逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」。
    ⇒ **下架權威不再在來源側**;同步管線已完全不寫 `delisted_at`(`#20` 片2b)。
    ⚠️ 下面這條原文保留當歷史,**不要照它做**:
  - **下架權威**(❌ 已作廢):來源側(報價單)單一裁判 —— 報價單跑 N=3 去抖 + `delisted_at` + 明星品 keep 卡;網站 `rpm-reconcile` 改「信任來源、不自己再判一輪」。最乾淨 = 報價單 view 投影 `delisted_at` 欄、網站直接鏡射(不從「缺席」自己重推),消雙重去抖延遲 + 避免網站獨留來源已下架品。
  - **下架機制細節(報價單 2026-06-04 釘 + 合約 §10 planned)**:view **不過濾**下架品、改投影 `delisted_at` 欄(下架品留 view 帶時間戳)、網站鏡射、由網站自身 RLS `USING(delisted_at IS NULL)` 隱藏;N=3 去抖只在報價單側算一次(合約 doc 已加 version + changelog)。⚠️ **網站 `rpm-reconcile` 的「缺席判定」不可整個移除** —— 它仍服務「非鎖/非 mc 被硬 DELETE 真消失」的品(PRD §11:那類維持缺席即下架、不走 delisted_at);「不重判」只針對受保護/已 stamp 的鏡射品。兩條路徑不相交、不會雙重去抖。
  - **標題後門(③)**:已完成 —— 網站設計 doc 已對齊三叉標題(commit `7b51234`、本 backlog 上方 #209 已記)。
- **觸發事件(任一觸發即啟動實作):** 報價單 PRD v2 pipeline P1(schema)+ P5(view 投影)落地、要把第一批範本內容上網站時;或放量到非 RPM 家前(去 RPM 化硬前置)。
- **預期解法:**
  - PRD v2 §16 升格成「網站側 5 斷點執行清單」,逐斷點開 slice。
  - **contract-drift 測試**:網站端對 `storefront_catalog_v` select 新欄,view 缺欄就紅(防跨庫漏接靜默);合約 doc `STOREFRONT_CATALOG_CONTRACT.md` 加 version + changelog、P5 改版 bump。
  - 去 RPM 化:重寫 ProductTabs 規格 pane data-driven + ProductInfo 選擇器不寫死 key。
- **不修會痛在:**
  - 擴充性:每加一家供應商、新內容欄都要手動同步 5 斷點;漏一斷點內容上不了網站。
  - 可維護性:VIEW_COLS / transform / migration / adapter / UI 五處分散兩個 repo,無 contract 測試則跨庫交接靠人記。
  - bug 可追蹤性:漏接是**靜默**的(不報錯、不 build 紅、前台空白),且 RPM description 本就空 → 沒人會發現新內容沒上;去 RPM 化漏做則非 RPM 商品顯示「真碳纖維/泰國」張冠李戴、誤導客人。
- **估時:** 5 斷點接線 pilot 4-6 hr;去 RPM 化(ProductTabs/ProductInfo 重構)元件級半天-1 天;contract-drift 測試 1-2 hr。
- **依賴:** 報價單 PRD v2 P1(schema)+ P5(view 投影 + 合約 doc);Sean 拍板推翻 description 停同步。
- **發現於:** 2026-06-04 / 網站審查 session 對抗 workflow(PCM-1~4 + C-1、`docs/reviews/2026-06-04-v2prd-website-review.md`)。
- **相關:** PRD v2 §10/§16(報價單 repo)/ scripts/rpm-fetch.ts / scripts/rpm-transform.ts / scripts/rpm-reconcile.ts / packages/adapters/src/supabase/SupabaseProductAdapter.ts / ProductTabs.tsx / ProductInfo.tsx / STOREFRONT_CATALOG_CONTRACT.md / #209

### #213. 🛡️ order_items.product_snapshot.spec 鍵名層:DB blacklist 擋已知 3 欄名、改名鍵仍靠 RPC 主控(非全封、誠實揭示)

- **狀態:** 🟢 觀察(blacklist 已加〔擋已知 3 欄名〕+ RPC 主控〔擋改名鍵〕雙防、誠實標 blacklist 不完整)
- **優先級:** 🟢 觀察
- **問題:**
  - S2-a `order_items_snapshot_whitelist` CHECK + helper `m3_jsonb_values_all_string` 已把 spec 的「值型別」鎖成 string scalar(拒 number/object/array/bool/null 藏經銷價)。spec 是 domain `ProductSnapshot.spec: Record<string,string>`(自由鍵名規格欄)→ DB 層**無法用正向白名單列舉鍵名**。
  - **S2-a round2 已加 blacklist**:`NOT ((spec) ?| array['price_store','price_by_tier','cost'])` 擋這 3 個**真實敏感欄名**(即使值為字串、補字串值殘餘)。
  - **殘餘(非全封、誠實揭示)**:blacklist 只擋**已知 3 欄名**;若有人用**改名鍵**(如 `{"dealer_p":"999"}` / `{"成本":"500"}` 等非清單字串)塞字串值,DB CHECK 仍放行。改名鍵殘餘**靠 RPC 主控**(非 DB)。
- **觸發事件:** 2026-06-04 S2-a 審查側 codex 關卡2 MUST-FIX 修復後、code-reviewer 複審點名字串值殘餘;Sean 拍 A 加 spec 鍵名 blacklist 補強。
- **預期解法:**
  - 主防線:create_order RPC(S2-b1)為 product_snapshot 唯一寫入者,`jsonb_build_object('title',...,'sku',...,'spec',<僅取 catalog 規格欄>)` 控鍵名來源 = spec 只來自 catalog 規格欄、來源無任何價格欄,故 RPC 永不會塞出任何經銷價鍵名(含改名)。
  - DB 縱深(已就緒):blacklist 擋已知 3 欄名。
  - 可選強化(若日後放寬直接 INSERT 或 RPC 不再唯一寫入者):RPC 對 spec 鍵名做正向白名單(對齊 catalog variant option keys);或 DB 改正向白名單(與 `Record<string,string>` 自由欄型別合約張力 → 需先重議型別)。
- **不修會痛在:**
  - 擴充性:若未來新增「非 RPC 的訂單寫入路徑」(如後台補單、批次匯入),此路徑繞過 RPC 鍵名控制,spec 字串鍵殘餘即成真開口。
  - 可維護性:DB CHECK 字面看似「全鎖」,實際鍵名層交 RPC 控;接手者需讀 L149-150 註解才知分工,否則誤以為 DB 已全封。
  - bug 可追蹤性:此殘餘是**靜默**的(不報錯、CHECK 放行),只有審計 product_snapshot 內容才會發現異常鍵名;但因 spec 是公開規格、非真經銷價欄滲漏(真 price_store 整數欄在 product_variants、快照建構從不讀),實害低。
- **估時:** RPC 鍵名白名單 0.5-1 hr(併入 S2-b1 或定價階段);DB 黑名單需先議型別合約。
- **依賴:** S2-b1 create_order RPC(確立 spec 來源僅 catalog 規格欄);若型別層強化則牽動 domain ProductSnapshot 合約。
- **發現於:** 2026-06-04 / M-3-S2-a codex k2 MUST-FIX 修復後 code-reviewer 複審。
- **相關:** supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql / packages/domain/src/order/types.ts(ProductSnapshot.spec)/ S2-b1 create_order RPC / 鐵則 12

### #214. 🛡️ create_order RPC 兩個 follow-up:① availability 缺貨閘(✅ 2026-06-14 #214a 移閘解)+ ② 訂單 idempotency(階段② 付款前收斂)

- **狀態:** ① ✅ 移閘已解(2026-06-14 #214a、migration 20260614130000);② 🟠 idempotency 仍延階段②
- **優先級:** 🟢 觀察(idempotency 升 🟠 中、付款片〔階段②〕前必收斂)
- **問題:**
  - ① ✅ **availability 二值耦合 — 2026-06-14 #214a 移閘已解**:`create_order` 不再對 availability RAISE(對齊前端 #161 訂貨型、海外調貨缺貨可賣);改於 `order_items.availability_at_checkout` 單欄派生快照(群層+變體層任一非 in-stock 即 out-of-stock)供後台識別調貨單(migration 20260614130000、CREATE OR REPLACE 0b 版移 2 條 availability RAISE、保留 delisted)。原「未來加第三態會過嚴 fail-closed」疑慮隨閘移除而 moot(走移除非擴值域)。
  - ② **訂單 idempotency 缺**:`create_order` 無 idempotency key / cart nonce → 同一 cart 併發或前端重送會建立多張 unpaid 訂單(codex k2 round1 consider)。Phase 1（未接金流）可接受;接 TapPay 付款(階段②)前必收斂、否則重複扣款風險。
- **觸發事件:** 2026-06-04 S2-b1 create_order RPC、code-reviewer + codex 關卡2 round1 點名(① Minor 觀察 ② consider 延付款)。
- **預期解法:**
  - ① ~~availability 值域擴張回看~~ **作廢**(2026-06-14 #214a 走移除缺貨閘、非擴值域;真停產品項靠 quote 同步 delisted 兜底)。
  - ② idempotency:加 `p_idempotency_key`(client cart token)或 `orders(customer_user_id, idempotency_key)` partial unique;重送回同一張未付款單(或 RETURN 既有 order)。階段② TapPay charge 前落地。
- **不修會痛在:**
  - 擴充性:①(已解)殘餘風險反向 —— 移閘後真停產品項仍可下單,靠 quote 同步正確 delisted 兜底(products 無第三停產訊號、見 migration 20260614130000 §設計);idempotency 缺則重複訂單堆積。
  - 可維護性:availability 顯示判斷散在多處(前台 + adapter);RPC 端缺貨判斷已移除(#214a)。
  - bug 可追蹤性:重複下單在無金流時靜默(只是多筆 unpaid),接金流後變「重複扣款」客訴、難回溯源頭。
- **估時:** ① 0.5 hr(值域擴張時);② idempotency 1-2 hr(階段② 付款片併做)。
- **依賴:** ② 綁階段② TapPay 付款流程(confirm_order_payment / charge route)。
- **發現於:** 2026-06-04 / M-3-S2-b1 create_order RPC codex 關卡2 round1 + code-reviewer。
- **相關:** supabase/migrations/20260604130000_m3_s2b1_create_order_rpc.sql / supabase/migrations/20260614130000_m3_create_order_stock_snapshot.sql(#214a 移閘+快照) / packages/domain/src/catalog/types.ts(ProductAvailability)/ 階段② 付款 / 鐵則 12

### #215. 🔴 pcm-tier cookie 非身分權威 — M-2-08 接真經銷價前必改 server 端認證查 DB tier(經銷價洩漏地雷)

- 🔴 **經銷價落地時走 `orders.discount_total`,不是給經銷商不同的 `unit_price` —— 動手前先讀 `#513`**
  (Sean 2026-08-15 拍。⚠️ **這件在 code 裡看不出來**:`create_order:10` 只寫「刻意不做 tier 價格分支」,
  讀起來像「還沒選形狀」,而形狀已經定了。)
- **狀態:** ⏳ 待執行(2026-06-05 已釘樁:tier.ts JSDoc + inline 註解、未改行為;真正認證化留 M-2-08)
- **優先級:** 🔴 高(**M-2-08〔server-side tier-aware pricing〕開工前硬前置、blocker**)
- **問題:**
  - `apps/storefront/src/lib/tier.ts:resolveTierFromRequest` 的 tier 來源 = `?tier=`(僅 `PCM_DEV_TIER_OVERRIDE=1` 生效)> cookie `pcm-tier` > `'general'`,只驗字面合法性(general|store|premium_store)、**不向 DB `customers.tier` 查證身分**。全 repo grep 無任何 `cookieStore.set('pcm-tier')` / 從 session 派生 tier → **任何匿名訪客可 `document.cookie='pcm-tier=store'` 把自己當經銷會員**。違反 CLAUDE.md「會員等級驗證必在 server 端重新檢查、不信任 client」。
  - **目前無洩漏(緩解 = 間接副作用、非刻意控制)**:read 路徑走 `products_public` view(物理排除 `price_store`)+ mapper 對 store/premiumStore 硬寫 dummy 0(`mappers/product.ts`)。偽造 tier 最多讓首頁卡片顯示「店價 NT$0」破圖、**看不到真經銷價**。詳情頁(`page.tsx`)+ 帳號頁(`account/page.tsx`)皆釘 general、不受影響。
- **觸發事件(任一觸發即啟動實作):** ① M-2-08 接 server-side tier-aware pricing(讀真 `price_store`)前;② 任何讓 store/premiumStore 取到真價的路徑落地前。
- **預期解法:**
  - tier 解析改為 `await supabase.auth.getUser() → customerRepo.findById(user.id).tier`,**未登入恆 general**;移除/降級 cookie 路徑為純非金額顯示 hint(或 server 簽章且仍 DB 複驗)。
  - pricing endpoint/RPC **不收 tier**(由 server 查),輸出到 client 僅「單一已算好的 effective price number」,**絕不序列化 `priceByTier` 結構**給 client。
  - 同步補測試錨點(backlog 對應稽核 M-12):tier 偽造場景 + 「非 general tier 的價格輸出必經身分驗證」不變式測試。
- **不修會痛在:**
  - 擴充性:M-2-08 接真經銷價時若沿用 cookie 為唯一 tier 來源,一般會員偽造 cookie 即可取得真實經銷價 = **直接違反專案最高安全不變式(此 finding 由 HIGH 升 CRITICAL)**。
  - 可維護性:現狀「不洩漏」靠下游 mapper dummy 0 的間接副作用、非靠 tier 被認證;接手者若只看 tier.ts 不知此脆弱依賴,M-2-08 改 mapper 取真價時會無聲打開洩漏口。
  - bug 可追蹤性:洩漏一旦成立是「正常頁面正常顯示」、無錯誤無 log,只有比對「該訪客身分 vs 顯示的價格層級」才會發現,難回溯。
- **估時:** 認證化改造 M(綁 M-2-08 pricing slice、鐵則 8+12 → plan + codex 雙關卡);本次釘樁 S(已完成)。
- **依賴:** M-2-08 server-side tier-aware pricing endpoint / auth session(getUser)/ customers.tier RLS row。
- **發現於:** 2026-06-05 / 安全稽核(Claude 多模型 access-control/dealer-price/test-gaps + codex 跨廠 RLS/IDOR + 經銷價 pass 五角度共識 H-1)。
- **相關:** docs/reviews/2026-06-05-security-audit-report.md(H-1)/ apps/storefront/src/lib/tier.ts / apps/storefront/src/lib/products.ts(toUIProduct)/ packages/adapters/src/supabase/mappers/product.ts / M-2-08 / 鐵則 12 + 鐵則 8

### #216. ✅ 運費門檻雙處 hardcode 同步無 CI gate — domain shipping.ts(TS)↔ create_order RPC §7(SQL)

- **狀態:** ✅ 完成 2026-06-16(commit 3f70032:新 shipping-rpc-drift.test 讀最新 create_order migration §7、regex 抽門檻/運費 assert == TS 常數;code-reviewer 雙向 mutation-test 證真能抓 drift;現三 migration 含 CASE〔0604/0613-0b/0614〕值均 5000/100、gate 取最新)
- **優先級:** 🟢 觀察(季度調整頻率低、改動時須兩處同步;升 🟠 中若加第三配送方式或門檻動態化)
- **問題:**
  - 運費規則 hardcode 在**兩個語言兩個檔**:① `packages/domain/src/order/shipping.ts`(`FREE_SHIPPING_THRESHOLD=5000` / `HOME_SHIPPING_FEE=100`、前台顯示鏡像)② `supabase/migrations/20260604130000_m3_s2b1_create_order_rpc.sql` §7(`v_subtotal >= 5000 ? 0 : 100`、結帳權威值)。
  - 兩處算法目前逐分支一致(store→0 / home subtotal>=5000?0:100),但**無編譯期 / CI 守門**保證同步。plan §3.0f 的 CI grep gate 只抓「真經銷價數字 + 敏感欄名」、**不涵蓋運費數字**。
  - 改一處漏改另一處 → 前台顯示運費 ≠ 結帳實際成交運費(client 送的運費被 RPC 忽略、RPC §7 為權威)→ 客人看到 A 卻被收 B。
- **觸發事件:** 2026-06-05 M-3-S2-b2-a 補 calculateShippingFee(domain)、code-reviewer WARN-2 點名(雙處同步無 CI gate、鐵則 10)。
- **預期解法:**
  - 短:改門檻 / 金額時同步兩處 + 跑 shipping.test.ts(已覆蓋 boundary 5000)+ MCP 對 RPC 實測;commit body 標兩處同步。
  - 中:運費門檻 / 金額抽單一真相(如 config 表或共用常數注入 RPC),或加 CI 對比測試(讀 SQL §7 數字 vs domain 常數)守門;若門檻改「動態 / 分區 / 偏遠加價」(backlog 既有 #M-3-05 calculate-shipping 三 case 規劃)一併重構。
- **不修會痛在:**
  - 擴充性:加第三配送方式(超商取貨 Phase 2、plan §3.3)或偏遠加價時,兩處各改易漏、且無測試逼同步。
  - 可維護性:運費邏輯散在 TS + SQL 兩語言、改規則須跨語言同步、無單一真相。
  - bug 可追蹤性:漂移後是「顯示運費與帳單運費不符」客訴、無錯誤無 log、難回溯是哪次只改了一邊。
- **估時:** 短(同步)即時;中(CI 對比測試 / 抽共用)1-2 hr。
- **依賴:** 無(現可獨立做 CI 對比測試);若綁配送方式擴張則隨該 slice。
- **相關:** packages/domain/src/order/shipping.ts / supabase/migrations/20260604130000_m3_s2b1_create_order_rpc.sql §7 / plan §6(L2 運費門檻)+ §3.0f(CI grep 未涵蓋運費)/ 既有 #M-3-05 calculate-shipping 三 case 規劃 / 鐵則 10

### #217. 🧩 order_items 無 product_id → domain OrderItem.productId 無法忠實重建(訂單讀路徑 stage ③ 前必解)

- **狀態:** ⏳ 待決(寫路徑 S2-b2-b 不受影響;讀路徑〔findById/listByCustomer 重建 Order〕延 stage ③ 訂單查詢、開工前必拍解法)
- **優先級:** 🟠 中(階段③ 訂單查詢〔plan §7〕硬前置;不阻階段①〔建單寫路徑〕)
- **問題:**
  - domain `OrderItem`(`packages/domain/src/order/types.ts`)`productId: ProductId` **必填**;但 `order_items` 表(migration 20260604120000)**只有 `variant_id`、無 `product_id`**(create_order RPC insert L253-263 親證只寫 variant_id/variant_sku/product_snapshot/qty/unit_price/line_total)。
  - 且 `order_items.variant_id` 是 `ON DELETE SET NULL`(變體刪除後變 NULL)→ 即使想 join `product_variants` 回推 product_id 也不可靠。
  - ∴ `SupabaseOrderAdapter` 的讀路徑(`findById`/`listByCustomer` → `mapSupabaseOrderToDomain` 重建 domain Order)**無法忠實填 `OrderItem.productId`**。
  - 這是 S1(domain entity 含 productId)↔ S2-a(order_items schema 無 product_id)的設計 gap、S2-a sign-off 時未被點到(審查聚焦金額/RLS/jsonb backstop)。
- **觸發事件:** 2026-06-05 S2-b2-b1(IOrderRepository reshape)偵察、UNDERSTAND workflow 親讀 schema 發現;讀路徑因此延 stage ③。
- **預期解法(stage ③ 訂單查詢開工前批次拍):**
  - A. **domain OrderItem.productId 改 optional / 移除**(歷史訂單看 title/sku/spec 快照即可、productId 非必要;最小、不動 DB)。
  - B. **order_items 加 product_id 欄**(RPC insert 時一併寫;需改已簽核 S2-a migration + db push + RPC,動 schema)。
  - C. **讀路徑 join product_variants 補 product_id**(variant_id NULL 時 fallback null;不可靠、且歷史訂單依賴現存變體,語意差)。
  - **傾向 A**(歷史快照不該依賴可變外鍵、productId 對訂單查詢無實際用途、零 schema 動)。
- **不修會痛在:**
  - 擴充性:stage ③ 實作讀路徑時若沒先拍,會卡在「重建 Order 無 productId 可填」、或被迫硬塞假值(破 domain 契約)。
  - 可維護性:domain 型別(有 productId)與 DB(無)長期不一致、接手者重建時誤判。
  - bug 可追蹤性:若硬 join 補 productId,變體刪除後歷史訂單讀取會 NULL/錯指,難回溯。
- **估時:** A 0.5 hr(改型別 + 重建路徑);B 1-2 hr(migration + RPC + db push、動已簽核 schema);決策 + 實作綁 stage ③ 訂單查詢首片。
- **依賴:** stage ③ 訂單查詢(plan §7);若選 B 綁 S2-a migration 再版 + db push。
- **相關:** packages/domain/src/order/types.ts(OrderItem.productId)/ supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql(order_items 無 product_id)/ packages/ports/src/IOrderRepository.ts(findById/listByCustomer 讀宣告)/ plan §7 階段③ / 鐵則 8(選 B 動 schema)+ 鐵則 10

### #218. ✅ createSupabaseAnonClient「可進 client bundle」註解 stale — 與 client.ts `import 'server-only'` 矛盾(doc-drift)

- **狀態:** ✅ 完成 2026-06-16(adapters/index.ts + client.ts 3 處「可進 client bundle/storefront client」改「server-only〔頂層 import 'server-only'〕、伺服器端公開 SELECT、瀏覽器公開讀走 lib/supabase/browser.ts」;釐清 env KEY 公開值 vs factory server-only;同批 doc-drift)
- **優先級:** 🟢 觀察(無安全/行為風險、僅誤導讀者)
- **問題:**
  - `packages/adapters/src/index.ts:7` + `packages/adapters/src/supabase/client.ts:13` 兩處註解寫 `createSupabaseAnonClient`「可進 client bundle」,但 `client.ts:1` 頂層有 `import 'server-only'` → 整個 @pcm/adapters root barrel(含 anon factory)被 server-only 約束、**不可進 client bundle**(import 即 build error)。瀏覽器端公開讀實際走 storefront `lib/supabase/browser.ts`(@supabase/ssr),非此 anon factory。
  - 推測前因:某 slice 給 client.ts 加 `import 'server-only'` 時未同步這兩處註解。
- **觸發事件:** 2026-06-05 S2-b2-b2 SupabaseOrderAdapter codex 關卡2 NIT(掃 index.ts 時點名 L7;client.ts L13 為同源 sibling drift)。
- **預期解法:** 兩處註解改為「server-only(client.ts 頂層 import 'server-only')、伺服器端 anon 讀取、RLS-protected;瀏覽器端公開讀走 storefront browser entry」;順手核對 README.md / 其他引用是否有同 stale 字面。
- **不修會痛在:** 可維護性 —— 接手者讀「可進 client bundle」誤以為 anon factory client-safe,在 client component import @pcm/adapters 撞 server-only build error、或誤判邊界做錯架構決策。
- **估時:** S(純註解、2 處 + sweep,~10 min)。
- **依賴:** 無(可獨立做;非 S2-b2 scope,刻意不混進建單 security slice 避 scope creep)。
- **相關:** packages/adapters/src/index.ts L7 / packages/adapters/src/supabase/client.ts L13 / 鐵則 11(字面 vs 事實)+ 鐵則 10

---

### #219. 🔒 直打 create_order RPC 看原始 RAISE — RPC 層 threat-model harden(階段② 付款 RPC 前)

- **狀態:** ⏳ 待修(非 e3b 本片;階段② 付款 RPC 前一併處理;Sean ratify 中)
- **優先級:** 🟠 中(非經銷洩漏、非 IDOR;屬資訊揭露面、付款 RPC 會繼承)
- **問題:**
  - authenticated 使用者持 anon/authenticated key 可直接 `supabase.rpc('create_order', ...)` 繞過 app 層,看到 RPC `RAISE` 原文(下架/錯價/重複變體 + variant_id 等內部細節;🔴 #214a 後缺貨 RAISE 已移除)。
  - e3b app path 的 `placeOrderAction` catch 已吞錯回通用字面、**不透傳**;但 RPC **層本身**的 RAISE 對直打者可見。e3b commit body「catch 吞 RPC RAISE 絕不透傳原文」字面**只對 app path 成立**,直打 RPC path 屬 RPC 層 threat-model。
  - codex 關卡2 round1 報 → 審查側親讀逐行裁定:**非經銷洩漏**(零 price_store/price_by_tier/cost)、**IDOR-safe**(auth.uid() 重查歸屬)、且是 **b2-b1 已簽核 create_order RPC**(非 e3b diff)→ 降級 backlog。
- **觸發事件:** 2026-06-07 M-3-S2-b2-e3b codex 關卡2 round1(降級 WARN→backlog、Sean ratify 中)。
- **預期解法:**
  - 階段② 付款 RPC(charge/confirm)前,評估 create_order RPC 的 RAISE 訊息泛化:對外回穩定錯誤碼 / 通用訊息、內部細節寫 server log 不入 RAISE;或限制 authenticated 直打面。一併檢視 confirm/charge RPC 同模式。
- **不修會痛在:**
  - bug 可追蹤性 / 安全:直打者可由 RAISE 推敲下架 / 變體結構等內部狀態(資訊揭露;🔴 #214a 後缺貨/庫存 RAISE 已移除);階段② 付款 RPC 繼承同模式、風險更高(可探測金額/付款狀態邏輯)。
  - 可維護性:app path 與 RPC path 的錯誤透傳邊界不一致,接手者易誤判整條鏈都不透傳。
- **估時:** M(RPC RAISE 泛化 + threat-model 評估,階段② 同批)。
- **依賴:** 階段② 付款 RPC(charge/confirm)設計;Sean ratify 本降級。
- **發現於:** 2026-06-07 / M-3-S2-b2-e3b codex 關卡2 round1
- **相關:** #214(create_order RPC)/ M-3-S2-b1 簽核 RPC / 鐵則 12 + 鐵則 11(字面 vs 事實:catch 不透傳只對 app path)

---

### #220. 🛒 /products 商品列表頁仍用 MOCK_PRODUCTS — 遷真 Supabase 目錄(對齊詳情頁)

- **狀態:** ✅ 完成(2026-06-09、本 slice 實作;品牌側欄真資料化分出 #220c、VehicleFinder 留 #220b)
- **優先級:** 🟠 中(阻礙真實逛街動線 + 肉眼驗需繞道;不影響結帳/建單正確性)
- **問題:**
  - `/products` 列表頁(components/ProductsPage.tsx)仍 import 渲染 MOCK_PRODUCTS(假資料)、未接真 Supabase 目錄(實證:ProductsPage.tsx:50 import + L214 `filterProducts(MOCK_PRODUCTS, …)`)。
  - M-1-16c-3 只把詳情頁(/products/[slug])遷到 fetchProductByHandle(真 DB)、首頁 featured 亦真(fetchFeaturedProducts→listByCategory);**列表頁漏遷**。
  - 後果:從列表頁點 mock 商品 → 詳情頁拿 mock slug 查真 DB → 查無 → notFound/404;無法從目錄正常逛到真商品加購(M-3 階段① 肉眼驗需繞首頁 featured / 直連真 handle URL)。
  - 🔍 驗證補充(2026-06-09):非-test source 中 MOCK_PRODUCTS 另一引用 = `components/HomeSelect.tsx`(首頁車種/品牌選單)→ 遷真時一併評估;`*.test.tsx` 引用屬正常 fixture、不動。
- **觸發事件:** 2026-06-09 M-3 階段① 結帳肉眼驗(Sean 發現目錄假資料、無法加購)。
- **預期解法:**
  - ProductsPage.tsx 改 server-side fetch 真目錄(SupabaseProductAdapter.listByCategory / 分頁 / 篩選)、對齊詳情頁 toUIProduct general-only strip;移除 MOCK_PRODUCTS 渲染(ProductPage 相關商品區 MOCK_PRODUCTS.filter + HomeSelect.tsx 一併評估)。
  - 內容分級 L3(目錄高頻瀏覽面)→ 真 DB、補空/錯/分頁 UI 字面。
- **不修會痛在:**
  - 擴充性:目錄是賣場主動線、長期掛 mock = 無法上線真逛街、新商品不顯。
  - bug 可追蹤性:列表(mock)vs 詳情(真)資料源不一致、mock slug 點擊 404 = 隱性壞連結。
  - 維護性:MOCK_PRODUCTS 與真 schema 漂移易積腐。
- **估時:** M~L(列表 server fetch + 分頁/篩選 + 空錯 UI + 測試)。
- **依賴:** SupabaseProductAdapter.listByCategory(已存、首頁用)。
- **發現於:** 2026-06-09 / M-3 階段① 肉眼驗
- **相關:** M-1-16c-3(詳情頁遷真)/ lib/products.ts fetchFeaturedProducts / 鐵則 9 內容分級 L3

---

### #220c. ✅ /products 品牌篩選側欄仍用 MOCK_BRANDS — 真資料單一品牌、選其他 chip 0 結果

- **狀態:** ✅ 完成 —— 兩個消費端都早已換掉寫死名單(2026-08-11 S 窗實查關檔)。
  - `ProductsPage.tsx` 檔頭逐字:「品牌(C3/#220c):`buildBrandTaxonomy(products)` ←(只列**有真商品**的品牌、
    **取代寫死 MOCK_BRANDS**)」。
  - `BrandIndex.tsx` 檔頭逐字:資料源已從 `MOCK_BRANDS`(17 家)換成 `BRAND_CONTENT`(20 家),
    並記著「前一版的既有落差(akrapovic / ebc / k-speed **有商品卻不在 17 家名單上**)**本片一併消失**」。
  - `MOCK_BRANDS` 今天只剩 `app/dev-preview/filter-{top,side,drawer}` 三個預覽頁在用,**不在客人路徑上**。
  - ⚠️ 本條原文的前提「真資料 p.brand 恆為 'RPM CARBON'(目錄唯一品牌)」也早已過期 ——
    2026-08-11 實查可見商品共 **16 家供應商**。引用本條前先看這一行。
- **優先級:** 🟡 低(已解決)
- **問題:**
  - #220 把 /products 商品列表遷真 Supabase 目錄,但品牌篩選側欄(FilterSide/CascadeFilterTop 的 data.brands)仍用 MOCK_BRANDS(17 個 design 品牌:LIGHTECH/RIZOMA/BREMBO…)。
  - filterProducts 用品牌名比對(MOCK_BRANDS id→name→lowercase vs p.brand.toLowerCase());真資料 p.brand 恆為 'RPM CARBON'(目錄唯一品牌)→ 只勾「RPM CARBON」chip 有結果、選其他 16 個 chip silently 回 0 商品。
  - 非 crash、非經銷洩漏;UX:側欄列了沒有商品的品牌 = 死篩選。
- **觸發事件:** 2026-06-09 #220 列表遷真實作(Sean Q1=A:側欄本片不動、開本 backlog 明確記錄、不留靜默壞篩選)。
- **預期解法:**
  - 品牌側欄 data.brands 改由真目錄推導(只渲染有真商品的品牌 = RPM CARBON),或接真 brands 表;一併評估 MOCK_CATEGORIES 分類側欄(同類 mock/真不一致 #152)。
  - 多品牌上架(#212 多品牌範本)後品牌篩選才有實質意義 → 可與 #212 合併評估。
- **不修會痛在:**
  - bug 可追蹤性 / UX:使用者點品牌 chip 得 0 結果、誤以為缺貨或壞站;隨多品牌上架若不接真會持續錯位。
  - 維護性:MOCK_BRANDS 與真品牌漂移、積腐。
- **估時:** S~M(側欄品牌源由真目錄推導 + 測試;接真 brands 表則 M)。
- **依賴:** #220(列表遷真、已做)/ 多品牌上架 #212(品牌篩選實質意義)。
- **發現於:** 2026-06-09 / #220
- **相關:** #220 / #220b(VehicleFinder 真資料化)/ #212(多品牌)/ #152(分類/車種篩選 no-op)

### #220b. 🏍 首頁/列表頁車種選單(VehicleFinder)真資料化 — 延 Phase 2 車輛服務生態

- **狀態:** ✅ 完成(2026-07-03、S1+S2 車輛篩選 slice;Sean 2026-07-02 拍 Q1=A「fitment 動態直出、不用報價單主表」推翻原「延 Phase 2」:走原選項 B fitments 反向聚合 —— `lib/vehicle-taxonomy.ts buildVehicleTaxonomy` 從真 fitment 衍生 品牌→車型→年份〔只列有商品的車、無空選單;年份區間展開 + MAX_YEAR_SPAN 60 防爆炸 = 原顧慮兩點皆解〕;VehicleFinder 改 props 接 server `fetchVehicleTaxonomy`、push 短版 ?vehicle=、37/94 無年車型顯「不限年份」;/products 端同一衍生函式 + matchesVehicle 真過濾 = #152 vehicle 部分同步關閉。fitment 字串正規化仍看 #211)
- **優先級:** 🟡 低(逛街輔助、非主動線阻擋;#220 列表 product 已真)
- **問題:**
  - VehicleFinder.tsx import MOCK_MOTO_BRANDS(design data/products.js 虛構 8 廠牌~35 車型),首頁「01 輸入你的車輛」+ /products 頂部「確認適用車款」三層 select(品牌→車型→年份)全 mock。
  - 真資料無 vehicle/moto_brands 表;真商品 fitments 廠牌集合 ≠ mock 8 廠牌;fitments yearStart-yearEnd 區間需展開單年(option 爆炸);直 query fitments 聚合可能列出無商品廠牌 → 空選單 UX 破。
- **觸發事件:** 2026-06-09 #220 列表頁遷真 recon 挖出(車種選單與列表 product 是兩件、車種是硬問題)。
- **預期解法:**
  - 選項:(A)維持 mock 延 Phase 2 一起做【Sean 拍】(B)fitments 反向聚合(準但複雜+年份爆炸+空選單)(C)建 vehicles/moto_models 表(快但新 schema+維護)。Phase 2 車輛服務生態前置時設計車輛真資料源 + VehicleFinder 接真。
- **不修會痛在:**
  - 擴充性:車種選單長期 mock = 無法真實「依車搜部品」、與 fitments 真資料脫節。
  - bug 可追蹤性:mock 廠牌導去 /products?brand=... 與真 fitments 對不上、篩選 no-op(#152)。
- **估時:** L(車輛資料源決策 + 聚合/表 + VehicleFinder 接真 + #152 篩選接真)。
- **依賴:** Phase 2 車輛服務生態 / fitments 真資料(S6 已 plumb)/ #152。
- **發現於:** 2026-06-09 / #220 recon
- **相關:** #220 / #220c(品牌側欄)/ #152(分類車種篩選 no-op)/ Phase 2 vehicle-service-ecosystem

### #221. 🧹 filter-top.css 621 行 > 鐵則 6 400 上限 — 拆檔

- **狀態:** ✅ 完成(2026-06-10、本 slice #221、Claude Code 自驅執行側):filter-top.css(621 行)拆成 3 連續行段檔 filter-top.css(238、`.ft-*` 篩選頂欄核心)/ filter-cascade.css(178、`.cft-*` Cascade + `.ac-*` ActiveChips)/ filter-responsive.css(205、FAB + `@media(1079)`/`[data-mobile]` 響應式 + cascade 間距 + `.ft-pills`),各 <400;layout.tsx 接在 filter-top→filter-side 之間維持序。🔴 **concat-diff 逐 byte 證等價**(3 檔按 import 序串接 = 原檔 byte 全等 → cascade 數學上零變化)、三綠 + 完整 pnpm test 744 零回歸 + code-reviewer PASS（0 BLOCKER、獨立重跑 concat-diff 空、行數 619→621 NIT 已修齊）。非鐵則 12。manifest 兩處純文件對應註。未 push。
- **優先級:** 🟡 低(維護性、無功能影響)
- **問題:**
  - apps/storefront/src/styles/filter-top.css 達 621 行、破鐵則 6「樣式/元件檔 >400 行必拆」。歷次 slice(#220-B1 / RWD toggle 修)各只 +少行、co-locate 在 grid-lock 旁合理,但檔本身已超限。
- **觸發事件:** 2026-06-10 #220-B1 + RWD toggle 修審查發現(filter-top.css 621 行)。
- **預期解法(原構想):**
  - 拆出獨立檔(brand-grid / cat-grid / sortbar / mobile-rwd 區塊),各 <400;保留 grid-lock 與 toggle-hide co-location(同範圍同步)。
- **實際解法(偏離原構想、理由=cascade 安全):**
  - 改走「連續行段切割、零重排」(filter-top / filter-cascade / filter-responsive,各對應原檔連續區段),**非**按 brand-grid/cat-grid/sortbar 語意切。原因:brand-grid/cat-grid/page-grid 的規則散落在兩段手機 `@media` 區塊內、與 `.cft-*`/`.pp-grid`/`.fs-side` 等交錯;若按語意抽出會重排規則順序、有改變 cascade 風險(正是本 backlog 起因的同類陷阱)。連續行段切 + concat-diff 可**機械證明**零 cascade 變化(逐 byte 等價),比語意切 + 人工驗 cascade 安全。toggle-hide/grid-lock co-location 仍保留在 filter-responsive.css 內同範圍。
- **不修會痛在:**
  - 可維護性:大檔難改、cascade/RWD 規則散落難追(本次 toggle cascade override bug 就因規則分散兩檔 filter-top + products-page)。
  - bug 可追蹤性:跨檔同 selector 規則(.pp-grid-toggle)易漏看 cascade。
- **估時:** S(純 CSS 拆檔 + import + 三綠驗無回歸)。
- **依賴:** 無。
- **發現於:** 2026-06-10 / #220-B1 + RWD toggle 修審查
- **相關:** 鐵則 6 / memory feedback_css-visibility-review-verify-cascade-not-just-rule-present

### #222. 🔌 報價單/sync 側確認 291 件下架是否合理(267 集中 SKU migration 日)

- **狀態:** ⏳ 待報價單側查(跨系統、非網站 bug)
- **優先級:** 🟠 中(資料正確性、可能影響上架商品數/營收)
- **問題:**
  - 商城 products_public 1406 件中 291 件 delisted(RLS 對公開隱藏、anon 可見 1115)。下架日期:06-03=1 / 06-04=23 / **06-07=267**。267 件集中 06-07 單日 = sync 線 SKU migration 那天(471c099 `--allow-large-delist` + f46d264、該旗標正為放行此大下架)。
  - 網站端 RLS 正確隱藏(非網站 bug);需確認 267 件是「真該下架」還是「SKU 改名誤把舊 SKU 孤兒化」。
- **觸發事件:** 2026-06-10 #220 列表頁 1000-cap 診斷 + Sean 問下架率 ~21%。
- **預期解法:**
  - 報價單/sync 側查 06-07 SKU migration 那批 SKU 改名映射(舊→新),確認 267 件下架是預期(SKU 變更退場)還是誤孤兒(漏映射);誤孤兒則修 migration/映射、重新上架。
- **不修會痛在:**
  - 擴充性/營收:若 267 件是誤孤兒 = 本該上架卻被隱藏、少賣。
  - bug 可追蹤性:單看「291 下架」看不出是單日 migration 造成、易誤判常態。
- **估時:** S~M(報價單側查映射 + 抽驗;誤孤兒則修 migration)。
- **依賴:** 報價單/sync 線(SKU migration 471c099/f46d264)。
- **發現於:** 2026-06-10 / #220 診斷
- **相關:** #220 / rpm-sync SKU migration(471c099/f46d264)

### #223. 🅰️ 商品詳情頁文案排版整理(標點全形 + 換行寬統一 + 手機段落靠左修)

- **狀態:** ✅ 完成(2026-06-10、Sean 直接指定 + 拍板 Q1=A/Q2=B/Q3 批准)
- **優先級:** 🟡 低(視覺/可讀性、無功能影響)
- **做了什麼:**
  - **標點全形化(Q2=B)**:商品詳情頁渲染散文家族半形 `, : ? ;` → 全形 `，：？；`;反轉 OD-6/7a「半形逗號家族慣例」(業務 override、鐵則 1 例外、3 元件註解 + manifest cross_cutting `productPageFullwidthPunctuation` 已標)。保留半形:時間 `10:00` / 數字範圍 `2–6` / 金額 `$100` / 英文 / 程式碼。影響:ProductTabs / ProductFAQ / ProductHighlights / ProductSpotlight / ProductSwatchWall / ProductFitments + rpm-policies.ts。
  - **換行寬統一(Q1=A)**:product-page.css `.pd-tab-pane` max-width 820→960 對齊 `.faq-body`(4 分頁 + FAQ 同寬最寬)。
  - **手機段落靠左修**:移除 `.pd-body/.pd-lead/.pd-feature-desc/.faq-body` 的 `text-wrap: pretty`(iOS WebKit 對 CJK 段落縮行致右側留白 62px、與清單不一致;greedy wrap 填滿 = 用最寬;標題 balance 保留)。
- **驗證:** 三綠(typecheck 7/7 / lint 10/10 / build 1/1)+ 完整 pnpm test 744 + code-reviewer PASS(0 BLOCKER)+ Playwright webkit 402px 量證(段落右白 62→4px)+ Sean iPhone 真機確認。
- **教訓(memory):** [[reference_ios-webkit-text-wrap-cjk-and-mobile-repro]](iOS WebKit CJK text-wrap 縮行 + 真機重現須用 webkit 引擎 + 量文字填充非元件寬)。
- **發現於:** 2026-06-10 / Sean 商品頁文案肉眼驗
- **相關:** OD-6/7a(原半形慣例)/ manifest cross_cutting productPageFullwidthPunctuation

### #224. 🔒 payment_charge_attempts stale pending 鎖須 ②-⑥ 對帳解鎖

- **狀態:** ⏳ 待執行(綁 M-3 ②-⑥ webhook 片)
- **優先級:** 🔴 高(真卡上線前必備)
- **問題:**
  - ②-③a 防雙扣鎖 fail-closed:charge 結果未知(transport 斷)時 attempt 永停 pending、該單 per-order 鎖不自動釋(寧卡單勿雙扣、plan v6 §2 拍定)。
- **預期解法:**
  - ②-⑥ webhook notify 自癒(主)+ TapPay Record API 掃 pending attempts 以 order_number 反查(輔、②-⑥ 驗收硬項)後標 failed/補 confirm。
- **不修會痛在:**
  - 可維護性:卡單客訴只能人工 SQL 解鎖(對 production 下手、高風險)。
  - bug 可追蹤性:pending 殭屍累積令對帳簿雜訊增、Record API 掃描成本上升。
- **發現於:** 2026-06-12 / ②-③ plan codex 關卡1(round1 F2 / round5 MF1 系列)
- **拍板:** Sean 2026-06-12 拍 A —— begin 回應斷線變體(DB 佔鎖成功但 server 未收到回應 → 卡單 + 會員閘 ≤10 分鐘)同樣接受、靠本條 ②-⑥ 對帳解、不自動釋鎖(寧卡單勿雙扣)。
- **相關:** plan docs/specs/2026-06-12-m3-stage2-3-charge-action-plan.md §9.2;migration 20260612150000

### #225. 🧟 卡拒重試產生 unpaid 殭屍單 — M-4a 前補清理/標記

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - ②-③ charge action 每次重送 = 建新單;卡拒(charge_failed)後使用者重試會留下 unpaid 殭屍單(無庫存佔用、Phase 1 接受)。
- **預期解法:**
  - M-4a admin 訂單列表前:殭屍 unpaid 單清理 cron 或列表標記/過濾(例:unpaid 且無 attempt 或 attempt=failed 且 >7 天)。
- **不修會痛在:**
  - 可維護性:admin 訂單列表雜訊、客服查單誤判。
  - 擴充性:報表失真(轉換率/客單價含殭屍單)。
- **發現於:** 2026-06-12 / ②-③ plan codex 關卡1 round1 F3(Sean Q2=A 拍 per-user 閘後殘餘)
- **相關:** plan §9.3;#220(M-4a admin 線)

---

### #226. 💚 LINE Pay 結帳(TapPay 加值里程碑 1/4、最輕)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(post-M-3、Sean 拍「M-3 單筆 3DS 先收尾再開」)
- **問題:**
  - PCM 客群重度集中 LINE,結帳僅信用卡 3DS(M-3);無 LINE Pay → LINE 客群少一個最順手的付款選項。
- **觸發事件(各 PRD 啟動時實作):**
  - 2026-06-14 Sean 拍板「TapPay 加值功能做 LINE Pay」+ 處置 A(先落 backlog/roadmap、M-3 收尾後開獨立 PRD)。
- **預期解法:**
  - TapPay LINE Pay 介接(電子支付類、**卡號不過商戶**、PCI 面最小);**商務開通由 Sean 辦**(TapPay 客服 02-2366-0080)。
  - 🔴 結算對帳**全複用 M-3 webhook inbox(b50bd62)+ settleCharge、非重做**;wallet 子頁/介接細節 PRD 啟動時逐行細讀 TapPay SDK(SPA 需點分頁渲染或問客服)、「需再核實」不憑記憶斷言。
  - 命中鐵則 8+12 → 獨立 PRD + plan + Codex Packet。
- **不修會痛在:**
  - 擴充性:LINE 導購流量到結帳斷點(無慣用付款)→ 轉換流失,且越晚做 settleCharge 對帳分支越難回頭塞。
  - 可維護性:多付款方式若不在同一對帳脊椎(settleCharge)收斂 → 各自對帳邏輯散落、難維護。
  - bug 可追蹤性:無統一 webhook inbox 落地 → LINE Pay 斷線卡單無 durable 記錄可追。
- **估時:** PRD + 實作(PRD 啟動時估;最輕的一個)。
- **依賴:** M-3 單筆刷卡 3DS 收尾(地基)+ Sean 商務開通(可現在平行辦)+ 獨立 PRD 經 Sean 批。
- **發現於:** 2026-06-14 / Sean 拍板 TapPay 加值功能。
- **相關:** #228(錢包)/ #229(卡片記憶);M-3 webhook inbox b50bd62 + settleCharge(3DS-1b)。
- **分流標籤:** `P2-later`

---

### #228. 🍎 Apple Pay / Google Pay 結帳(TapPay 加值里程碑 2-3/4、錢包)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(post-M-3)
- **問題:**
  - 行動端結帳無錢包快速付款(Apple Pay / Google Pay);手機客群須手動輸卡號 → 摩擦高、棄單率高。
- **觸發事件(各 PRD 啟動時實作):**
  - 2026-06-14 Sean 拍板「做 Apple Pay / Google Pay」+ 處置 A。
- **預期解法:**
  - 🔴 **2 個里程碑(Apple Pay、Google Pay)、共用 TapPay Pay-by-Prime 後端**(DPAN、**真卡號不過商戶**);PRD 可合一(錢包共用)或各別,啟動時 Sean 定。
  - 開通由 Sean 辦:Apple = Apple Developer + 網域驗證 + 付款憑證;Google = Google 商家註冊 + 正式環境審查。
  - 結算對帳**複用 M-3 webhook inbox + settleCharge**;SDK/wallet 介接細節 PRD 啟動時細讀官方(SPA 渲染)、需再核實。
  - 命中鐵則 8+12 → 獨立 PRD + plan + Codex Packet。
- **不修會痛在:**
  - 擴充性:手機結帳無錢包 → 行動轉換率受限(錢包是行動結帳主流)。
  - 可維護性:Apple/Google 共用 Pay-by-Prime,若不與 LINE Pay/卡片記憶同脊椎收斂 → 多 prime 來源對帳分裂。
  - bug 可追蹤性:錢包付款失敗無統一 inbox 記錄 → 難追手機端斷線卡單。
- **估時:** PRD + 實作(共用後端、比卡片記憶輕)。
- **依賴:** 🔴 **平台開通 gated on「M-3 3DS 收尾 + 新賣場結帳頁部署上線」**(Sean 2026-06-14 後續拍板):Apple/Google 網域驗證需 **live HTTPS 站 serve 驗證檔** + 平台審查**實際結帳流**(可 test/sandbox + flag 關真刷卡、Apple/Google 看得到即可 = 非開放真實收款)→ **不能在部署前平行辦**(比 #226/#229 多一道部署門檻)。+ Sean 平台開通(Apple Developer / Google 商家)+ 獨立 PRD。
- **發現於:** 2026-06-14 / Sean 拍板(依賴於 2026-06-14 後續拍板補正)。
- **相關:** #226(LINE Pay)/ #229(卡片記憶);共用 Pay-by-Prime;M-3 settleCharge。
- **分流標籤:** `P2-later`

---

### #229. 🔐 卡片記憶(Pay by Card Token)+ Remove Card(TapPay 加值里程碑 4/4、最重)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(post-M-3、最重、法規前置多)
- **問題:**
  - 回頭客每次重輸卡號;無「記住卡片」一鍵重扣。但這是**唯一讓商戶自存可重扣憑證**的功能 → 碰 PCI + 台灣 card-on-file 法規。
- **觸發事件(各 PRD 啟動時實作):**
  - 2026-06-14 Sean 拍板「做卡片記憶(Pay by Card Token)」+ 處置 A;**排除定期定額/自動週期扣款**(Sean 拍不做)。
- **預期解法:**
  - TapPay Pay by Card Token:`remember=true` → 取得 `card_key`/`card_token` → 後續重扣;Remove Card 刪卡。
  - 🔴 **正式做前置(Sean+法務)**:① 書面問 TapPay(自存 token 的 PCI / 合約義務)② 同意流程 + 刪卡流程設計。
  - 🔴 **鐵則 12 要害(存可重扣憑證)**:`card_key`/`card_token` **server-only + 加密 at rest + 零進 client bundle/log/git**;重扣前**驗 token 歸屬登入會員(防 IDOR)**;結算複用 M-3 webhook inbox + settleCharge。
  - 命中鐵則 8+12 → 獨立 PRD + plan + **commit 前產 Codex Packet**(碰 PCI/憑證儲存,審查最用力)。
- **不修會痛在:**
  - 擴充性:無記憶卡 → 回頭客結帳摩擦,且日後做時 token 儲存 schema/加密/IDOR 防護要從頭設計。
  - 可維護性:card-on-file 法規/PCI 義務若未先書面釐清 → 上線後被要求改儲存/同意流程 = 大改。
  - bug 可追蹤性:token 歸屬若無 server 端會員驗證 → IDOR 漏洞難事後追(他人重扣你的卡)。
- **估時:** PRD + 法規前置 + 實作(最重;法規前置可能拉長)。
- **依賴:** M-3 3DS 收尾 + Sean+法務(問 TapPay PCI/合約 + 同意/刪卡流程)+ 獨立 PRD + Codex Packet。
- **發現於:** 2026-06-14 / Sean 拍板。
- **相關:** #226 / #228;M-3 settleCharge;**排除**定期定額。
- **分流標籤:** `P2-later`

> **共通(#226/#228/#229)**:皆 TapPay 加值、鐵則 8+12、各走獨立 PRD(建議序輕→重:LINE Pay → 錢包 → 卡片記憶);結算對帳**全複用 M-3 webhook inbox(b50bd62)+ settleCharge、非重做**;**不做** 延遲請款 / 自動週期扣款(Sean 2026-06-14 拍除外)。業務開通:**可現在平行辦** = #226 LINE Pay(客服帳號申請、sandbox 可開發)+ #229 卡片記憶(書面問 TapPay PCI/合約)〔皆不需 live 站〕;🔴 **等部署** = #228 Apple/Google Pay(網域驗證/平台審查需 **live 結帳頁** serve 驗證檔 + 看得到實際結帳流 → gated on「新賣場結帳頁部署上線」、**不能部署前辦**)。**實作皆須等 M-3 單筆 3DS 收尾**。逐行 SDK 細讀於各 PRD 啟動時做(TapPay docs SPA、需點分頁或問客服),wallet 介接「需再核實」勿憑記憶。(#227 保留給 cross-tab D3 BroadcastChannel、見 cross-tab plan §7。)

---

### #230. 🔒 bank_transaction_id 被 settleCharge 當免時間窗 strong key,但 0c 欄 nullable 無 UNIQUE/格式 CHECK — 3DS-5b 寫入前必補

- **狀態:** ⏳ 待執行(3DS-5b 前置)
- **優先級:** 🟠 中(現況 benign:0c bank_transaction_id 恆 null、3DS-1b 不受影響;3DS-5b 真寫入時升為要害)
- **問題:**
  - settleCharge `recordMatchesOrder` 把「本機有 rec_trade_id 或 bank_transaction_id」視為 strong key → **免弱識別時間窗**(前提:rec/bank 唯一識別本 attempt 自身交易、CANCEL/ERROR 即本交易失敗、釋鎖安全)。
  - 但 3DS-0c migration 只把 `attempt.bank_transaction_id` 加成 **nullable、無 UNIQUE constraint、無格式 CHECK**(前向欄、現恆 null)。
  - 3DS-5b 真把 bank_transaction_id 寫入後,若該欄非唯一/格式不受控 → 「bank 單獨作為 strong key 唯一識別本 attempt 交易」前提不成立 → 失敗釋鎖路徑可能誤採信非本 attempt 的同 bank 值記錄 → 退回 3DS-1b must-fix 同類釋鎖向量(走 bank 而非 order_number)。
- **預期解法:**
  - 3DS-5b 實作 bank_transaction_id 寫入前,DB 加 **UNIQUE(bank_transaction_id) WHERE not null** + **格式 CHECK**(TapPay bank_transaction_id 格式);否則 `recordMatchesOrder` 不可單獨把 bank 視為 strong key(須降級為弱識別、套弱識別時間窗)。
  - 🔴 **S1(2026-06-20「授權即成立」)已部分 supersede 本解法**:弱識別時間窗下界已統一 = attempt、`recordMatchesOrder` 對 paid+failed 雙 terminal 同款硬化(`forFinalFail`/`SETTLE_CLOCK_SKEW_MS` 已移除)→ 降級路徑天然零 pre-attempt 容忍、**不再需 forFinalFail 不對稱失敗下界**。**本條剩餘要害 = bank UNIQUE + 格式 CHECK 前置**(S1 未碰、3DS-5b 仍須補,否則「bank 單獨作 strong key 免窗」前提失效)。
- **不修會痛在:**
  - bug 可追蹤性 / 鐵則 12:bank strong-key 免窗前提失效 → 失敗終態誤釋當前 attempt 鎖 → 重刷雙扣(與 3DS-1b must-fix 同類向量)。
  - 可維護性 / 擴充性:5b 寫入端與 1b 讀裁決端對 bank 強度假設不一致、越晚補 constraint 越難(既有資料可能已有重複/髒格式)。
- **發現於:** 2026-06-14 / 3DS-1b must-fix 審查側 codex 關卡2 #3(future consider)。
- **相關:** 3DS-1b settleCharge(`recordMatchesOrder`/弱識別時間窗)/ S1 收緊(下界統一 attempt、`forFinalFail`/`SETTLE_CLOCK_SKEW_MS` 已移除)/ 3DS-0c migration(bank_transaction_id 欄)/ master plan v5;3DS-5b plan 啟動時併入。
- **分流標籤:** `P2-later`

---

### #231. 🧹 3DS-4 sweeper prod 上線前硬前置(Q4-B 跨路徑 skip / 告警 channel / heartbeat / 轉人工流程)

- **狀態:** ⏳ 待執行(`TAPPAY_3DS_ENABLED` flag-on 前必 land、master plan §9 已 amend)
- **優先級:** 🟠 中(Phase I 零真流量 benign;Phase II 開 prod 真刷卡前升為硬前置)
- **問題:**
  - 3DS-4 sweeper Phase I 落地降級版:① recently-settled skip 僅 in-memory 單 run 去重(Q4=A)、**不**覆蓋 callback/webhook/sweeper 跨路徑 Record 放大;② 告警僅 `console.error` + durable `needs_manual_review` 旗標、**無真 alert channel**;③ 無 cron 靜默死偵測(heartbeat);④ 轉人工僅 durable 旗標、無人工結案流程/後台 UI。
  - Phase I 零真刷卡 → 撞三路機率≈0、無告警對象 → 降級可接受;但 Phase II 開 prod 真流量後,缺這些 = 對帳放大打爆 Record 額度 / 失敗單靜默卡死無人知 / sweeper 死了沒人發現。
- **預期解法:**
  - ① Q4-B:`payment_charge_attempts.last_settle_attempt_at` 欄 + callback/webhook/sweeper 三路 settle 前查窗 skip(回改已上線 3DS-2/3)。
  - ② 告警 channel:notify×5 全失敗 / `needs_manual_review` 達標 / Record final-failed → LINE/email alert。
  - ③ heartbeat / dead-man's-snitch:sweeper 長時間沒跑 → 告警。
  - ④ 轉人工:durable 旗標接後台/SQL 查 + 人工結案流程。
  - ⑤ 🆕 4a-2 殘餘窄 TOCTOU 清理(**Sean 2026-06-15 拍 A=留現狀、Phase II 後台 UI 順手清、非 4b**):expirer/mark 語句快照讀到 unpaid 後、並發 callback/confirm 才 commit order→paid → 可留 `paid + needs_manual_review=true` cosmetic 假告警(無雙扣/無金錢/無安全影響、人工複查即清)。歸入本條 ④ 後台轉人工流程一併處理(成交路徑或後台批次清同單 active attempt 的 needs_manual_review);4a-2 migration 檔頭已誠實揭示、不阻 bundle。
  - ⑥ 🆕 (對抗複驗 wbpvvr5b7 nit、benign 前瞻防禦)4a-1/4a-2 的 ALTER ADD COLUMN 後**未重 assert 表層 SELECT ACL**(s2d L124-146 有完整 table-ACL fail-closed assert、4a-1/4a-2 僅 assert RPC EXECUTE 矩陣 + payment_confirmer 全域 grants=0)。現況零實害:新欄皆 sweeper 簿記 / `last_settle_error` allowlist 錯誤碼集(零 PII)、service_role 本就唯讀;4a-2 與已簽核 4a-1 對稱(同省此 assert)。可選統一 polish=4a-1/4a-2 ALTER 後補 `has_table_privilege` anon/authenticated SELECT=false + service_role 唯 SELECT assert(對齊 s2d 防漂風格);非阻擋、非缺陷、forward-only migration 不會再編輯故價值邊際。
- **不修會痛在:**
  - bug 可追蹤性 / 鐵則 12:失敗單靜默卡死、sweeper 死無人知 → 客人已扣款訂單未成立、客訴才發現。
  - 擴充性:Q4-B 越晚補越痛(回改已上線 callback/webhook、且真流量下已發生放大)。
  - 可維護性:Phase I 降級若無「flag-on 前必補」硬 gate → 容易隨 Phase II 上線被遺忘。
- **估時:** 中(② 告警 channel 接入 + ① Q4-B 回改三路 各自獨立 slice)
- **依賴:** 3DS-4 sweeper 落地;`TAPPAY_3DS_ENABLED` flag-on(Phase II);master plan §9
- **發現於:** 2026-06-15 / 3DS-4 sweeper cron plan 三模型審查(Opus+Codex+Gemini)群6
- **相關:** 3DS-4 plan(`docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md` Q4)/ master plan §9 / 3DS-2/3(Q4-B 回改點)
- **分流標籤:** `P2-later`

---

### #232. 📱 LINE in-app browser × 3DS redirect 銜接(掉單)

- **狀態:** ⏳ 待執行(Phase II、3DS 啟動後)
- **優先級:** 🟠 中(台灣買家大量從 LINE 內建瀏覽器進店;3DS 啟動前 benign)
- **問題:**
  - 台灣買家常在 LINE in-app webview 開店;3DS `frontend_redirect_url` 跳外部銀行驗證頁後,webview 可能無法正確導回(或導回開新分頁→SPA state 斷)→ 付款卡住、買家以為失敗重新下單→重複扣款風險。
- **預期解法:**
  - 偵測 LINE webview(UA / `Line` 標記)→ 引導「以外部瀏覽器開啟結帳」或確保 callback 導回 webview;sandbox 實測 LINE webview × 3DS 端到端銜接。
- **不修會痛在:**
  - bug 可追蹤性:webview 導回失敗在桌機測不出、上線才爆掉單;可維護性:redirect 流程已上線後回改成本高。
- **發現於:** 2026-06-15 / Gemini 結帳流程廣度檢視(審查側 review-log §3 #2);Sean 拍「進行(backlog、Phase II prod 前)」。
- **相關:** 3DS-3 callback page / 3DS-6 client redirect(Phase II)/ `installment-not-doing` 無關
- **分流標籤:** `P2-later`

---

### #233. 🎧 客服 by email+時間 反查 orphan/unknown/manual 單工具

- **狀態:** ⏳ 待執行(Phase II;與 #231 ④ 轉人工流程合流)
- **優先級:** 🟠 中
- **問題:**
  - settleCharge pending/unknown 單 + sweeper `needs_manual_review` 單需人工結案;客服第一線只有客人 email + 大概時間,無工具反查對應訂單/付款狀態。
- **預期解法:**
  - 後台/SQL 查詢(by email + 時間範圍 + payment_status / needs_manual_review)撈待處理單;接 #231 ④ 人工結案流程。
- **不修會痛在:**
  - 可維護性 / bug 可追蹤性:客訴來了查不到單、人工對帳靠硬翻 DB。
- **發現於:** 2026-06-15 / Gemini 結帳廣度檢視(review-log §3 #3)。
- **相關:** #231(轉人工流程)/ sweeper needs_manual_review / settleCharge unknown
- **分流標籤:** `P2-later`

---

### #234. 📡 前端付款錯誤遙測(ready=error/unknown → 上報、零 PII)

- **狀態:** ⏳ 待執行(Phase II)
- **優先級:** 🟠 中
- **問題:**
  - useChargePayment `ready=error` / `unknown` 終態目前只進 client state、無遙測 → 線上付款失敗/回應遺失看不到分布、無法主動發現掉單。
- **預期解法:**
  - error/unknown 終態上報遙測 channel:user id + 錯誤碼/階段(零 PII、零卡資料、零金額);對齊既有 server-only log 紀律。
- **不修會痛在:**
  - bug 可追蹤性:付款掉單無觀測訊號、只能等客訴;擴充性:Phase II 真流量後無遙測=盲飛。
- **發現於:** 2026-06-15 / Gemini 結帳廣度檢視(review-log §3 #4)。
- **相關:** useChargePayment 六態 / 3DS callback unknown / #233 客服撈單
- **分流標籤:** `P2-later`

---

### #235. 🔁 Step3 / 完成頁 退換貨連結 + 客服 LINE 入口

- **狀態:** ⏳ 待執行(Phase II;依賴退換貨/政策頁建立)
- **優先級:** 🟡 低
- **問題:**
  - 結帳 Step3 / CheckoutSuccess 缺退換貨政策連結 + 客服 LINE 入口 → 買家付款後遇問題找不到求助管道。
- **預期解法:**
  - Step3 / 完成頁加退換貨政策連結(共用 rpm-policies 單一真相)+ 客服 LINE deep link。
- **不修會痛在:**
  - 可維護性 / UX:客人卡住只能自己亂找、客服負擔增;擴充性:政策頁建立後順手接。
- **發現於:** 2026-06-15 / Gemini 結帳廣度檢視(review-log §3 #5)。
- **相關:** rpm-policies / CheckoutSuccess / [[#291]](法律頁 route + version/hash;**本條目與法律頁無關**,2026-07-21 L0 更正 #241 曾把本條目誤當法律頁工作單)
- **分流標籤:** `P2-later`

---

### #236. 🏬 合作店家取貨 Store Picker(O2O、商業)

- **狀態:** ⏳ 待執行(Phase II / 商業;需店家資料源)
- **優先級:** 🟢 觀察(商業決策 + 無資料源)
- **問題:**
  - design 有合作店家取貨(地圖選店 StorePickerModal);storefront 現 override 為僅宅配(manifest `checkoutShippingHomeOnly`、後端 create_order 白名單已保留 `store` 供未來)、因無店家地圖/資料源。
- **預期解法:**
  - 有合作店家資料源後接 StorePickerModal + store 配送(co-pickup-* CSS 補搬);後端白名單已就緒。
- **不修會痛在:**
  - 擴充性:O2O 取貨是商業機會、資料源備齊後可快速接(後端已留口)。
- **發現於:** 2026-06-15 / Gemini 結帳廣度檢視(review-log §3 #7)。
- **相關:** manifest `checkoutShippingHomeOnly` override / create_order store 白名單 / design StorePickerModal
- **分流標籤:** `P2-later`

---

### #237. ⚡ TapPay SDK 預載(Step1/2 idle prefetch)

- **狀態:** ⏳ 待執行(Phase II / nice-to-have、效能)
- **優先級:** 🟡 低
- **問題:**
  - useTapPayCard 只在 step3 active 才動態載 TapPay SDK script → 進 step3 才下載、首次卡欄 iframe 出現有延遲。
- **預期解法:**
  - Step1/2 idle 時 prefetch TapPay SDK script(`<link rel=preload>` 或 idle 注入)、step3 即時 setup;不改 active gating 邏輯(仍 step3 才 setup)。
- **不修會痛在:**
  - 可維護性 / UX:首次卡欄延遲小雷;擴充性:純前端 prefetch、低風險可後補。
- **發現於:** 2026-06-15 / Gemini 結帳廣度檢視(review-log §3 #8)。
- **相關:** useTapPayCard(SDK 動態載入)/ #232 iOS 16px(同 hook)
- **分流標籤:** `P2-later`

---

### #238. ✅ design-mirror --validate / --target 多檔「+」串接欄位 path-check 失準

- **狀態:** ✅ 完成(2026-06-17、案 A root-anchored token 抽取)。落地:新 `extractPathTokens(val)`〔regex 抽「以 repo 根 apps/packages/design-reference/supabase(+docs 備用)開頭、副檔名結尾」的 token、root-anchored 故跳純描述片段如 `RegisterPage.tsx`/`tabs/{…}.tsx`/`L166-190`/退役提及的 `app/…`·`hooks/…` 簡寫〕;`cmdValidate` 改逐 token 驗存在 + 「0-token 欄位逐一列出」安全網〔鐵則 10:漏列 root 不再靜默〕、`findComponentsByPath`(--target)改「target 在欄位 token 集合內」比對。**驗證**:`--validate` exit 0〔133 path tokens OK + 0 跳過、0 broken,消除 #180 揭示的 10 條 pre-existing 假陽性〕+ mutation test ×2〔apps 根 + supabase 根各注入 bogus token→exit 1 精準抓、manifest 還原零留痕〕+ 三綠〔typecheck 7/lint 10;build 跳=無 .ts/.tsx〕+ code-reviewer **r1 FAIL→r2 PASS**〔r1 逮真 false-negative:root allow-list 原漏 `supabase`、CheckoutPage related_storefront[10] 真 migration 路徑會被靜默漏驗 → 補 supabase + 加 0-token 安全網 → r2 PASS〕。⚠️ design-mirror.mjs 為 .mjs、不在 typecheck(tsc)/lint(`scripts/*.ts`)glob,真驗證靠 --validate+mutation〔對齊 #180 commit-body 誠實先例〕。未 push。
- **原狀態:** ⏳ 待執行(pre-existing 工具限界、#180 可達性 gate 落地時揭示)
- **優先級:** 🟡 低(不阻擋實作;只令 `--validate` 對多檔元件 exit 1、可達性判讀靠輸出行區分)
- **問題:**
  - `docs/design-storefront-manifest.yaml` 部分元件(AccountPages / CartPage / CheckoutPage / MobileTabBar 等)的 `storefront.component` / `storefront.css` / `design.component` / `design.css` 欄存「A.tsx + B.tsx + ...(長描述)」這種「+」串接 + 括號描述的人讀字串、非單一可解析路徑。
  - `scripts/design-mirror.mjs` 的 `checkFileExists(val)`(--validate)與 `normPath(sf.component) === target` 精確比對(--target)對這類欄位本來就失準:--validate 報 broken link(2026-06-17 實測 10 條)、--target 對這些多檔元件用單檔路徑查不到對應條目。
  - 屬 pre-existing manifest 資料模型 ↔ 工具設計落差、非 #180 引入(#180 只加 last_modified_commit 可達性 gate、未碰 path-check 邏輯)。
- **觸發事件:**
  - 2026-06-17 / #180 案 A 可達性 gate 落地跑 `--validate`、揭示 path-check 對多檔欄位的 pre-existing false-positive。
- **預期解法(評估擇一):**
  - 案 A:`checkFileExists`/`findComponentsByPath` 改抽欄位內 path token(regex 抓 `(?:apps|packages|design-reference)/…\.\w+`)逐一驗存在 / 比對,跳純描述片段。
  - 案 B:manifest 資料模型分「主路徑欄(單一、機器讀)」vs「描述欄(人讀)」,工具只驗主路徑欄。
  - 案 C:多檔元件改用陣列欄位(`components: [a.tsx, b.tsx]`)、工具迭代驗。
- **不修會痛在:**
  - 擴充性:多檔元件越多、--validate 噪音越大、broken link 計數失真。
  - 可維護性:--validate / --target 對多檔元件不可靠、人得靠肉眼分辨真假 broken。
  - bug 可追蹤性:真有路徑斷掉時、淹沒在多檔欄位的 false-positive 裡難察。
- **估時:** 評估 + 改工具 + 驗 ~45-60 min
- **依賴:** 無(獨立、可隨時做)
- **發現於:** 2026-06-17 / #180 案 A 可達性 gate 落地
- **相關:** `scripts/design-mirror.mjs`(cmdValidate / findComponentsByPath)、`docs/design-storefront-manifest.yaml`、[[#180]]

### #239. 🔁 3DS redirect interstitial 無 fallback「手動繼續」連結

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(Phase I sandbox-only、0 真流量;`TAPPAY_3DS_ENABLED` flag 對外開啟前補)
- **問題:**
  - `CheckoutRedirecting`(3DS-6b)mount 即 `window.location.assign(payment_url)` 整頁導向 TapPay;若瀏覽器擋導向(彈窗攔截 / JS disabled / assign 失敗),使用者停在「正在前往安全付款頁面」interstitial、無手動出路。
- **觸發事件(任一觸發即啟動實作):**
  - `TAPPAY_3DS_ENABLED` 要在 sandbox/staging 以外開啟前;或 sandbox 3DS E2E 實測發現導向被擋。
- **預期解法:**
  - interstitial 加「N 秒後仍未跳轉?點此手動前往」**按鈕**:🔴 用 `<button onClick={() => window.location.assign(redirectUrl)}>`、**非** `<a href={redirectUrl}>` —— href 會把 payment_url token 落進 DOM 屬性(頁面源碼 / DevTools / analytics 可見)、違反「payment_url 零入 DOM」鐵則(codex 關卡2 N-d)。redirectUrl 全程不落 DOM(不入文字、不入 href)、不 log;若要 `<meta refresh>` 亦不可帶 token URL。
- **不修會痛在:**
  - 擴充性:未來多金流 redirect 共用此 interstitial、無 fallback 模式會重複缺。
  - 可維護性:導向失敗無自助出路 → 全導客服 LINE、人力成本。
  - bug 可追蹤性:使用者「卡住」無明確訊號、難分辨導向失敗 vs 正常網路延遲。
- **估時:** ~20-30 min(加連結 + 測 + 肉眼驗)
- **依賴:** 3DS-6b(CheckoutRedirecting、已落地)
- **發現於:** 2026-06-19 / 3DS-6b(審查側 N2 + codex 關卡2 nit)
- **相關:** `apps/storefront/src/components/CheckoutRedirecting.tsx`、[[#231]](flag-on 前置群)

---

### #241. ⚠️ 結帳「同意服務條款」未勾選仍可付款、無提醒

- **狀態:** ✅ 已實作(2026-07-01、worktree=dev、待 Sean db push;真權威 `docs/specs/2026-06-30-m3-241-checkout-consent-plan.md`)
  - 實作:charge-actions ②e `raw.agreed !== true` server 驗(不信任 client、置於所有付款/建單/settle 副作用前)+ best-effort IP/UA(headers、截 128/1024)→ create_order 5→8 param 同 transaction 原子寫 `order_legal_consents`(新 1:1 表、RLS 零 policy + REVOKE ALL = IP/UA PII 隔離)+ `legal_terms_versions` 版本登錄表(content_hash provenance、FK)+ `terms-version.ts` 常數。前端鈕已 payDisabled=!agreed(對齊 design、不加 inline 提示)。
  - 審查:Gemini scope/設計 + codex 關卡1(FAIL→9 finding 全修)+ 關卡2(zero-regression 乾淨)+ code-reviewer + adversarial-reviewer(皆 PASS-WITH-NITS)+ L1 安全輕掃 0 finding + migration MCP 零留痕 + 三綠 + vitest 1507。
  - ⚠️ **2026-07-22 更正(Slice U3b)**:上一行「前端鈕已 payDisabled=!agreed」**自 U3b 起不再成立**。
    兩步結帳依 design §7.3「未填完整時仍可按,用來觸發清楚的錯誤導引」移除該前端硬擋,改為按下後跑
    non-card validation、未勾同意顯示逐欄紅字並 early return(**不呼 getPrime、不呼 server action**)。
    影響:`charge-actions` ②e 的 `raw.agreed !== true` 由「縱深」升格為**唯一**權威守門(server 邏輯未改)。
    本條目「預期解法」寫的是「付款鈕 disabled **或** inline 提示」→ U3b 走的是後者,驗收仍成立。
  - 🔴 **誠實邊界**:本片 = 同意訊號 + 內容雜湊 provenance,**非完整法律效力** —— 完整效力需 **[[#291]]**(正式服務條款／隱私政策 route + version/hash;結帳條款連結目前仍是 `href="#"` no-op → 接可讀條款/隱私頁)。
    ⚠️ **2026-07-21 更正(Slice L0)**:本行原寫「完整效力需 **#235**」= **錯誤依賴**。live #235 的實際標題是
    「🔁 Step3 / 完成頁 退換貨連結 + 客服 LINE 入口」,不是法律頁工作單、也不會產出 `/terms`、`/privacy`。
    法律頁的唯一工作單是 **#291**。(已 apply 的 migration `20260630120000` 內歷史註解**不回改**。)
  - 🔴 **db push sequencing**:code 期待 8-param、live 仍 5-param 未推 → **Sean db push 在先、才驗 checkout**(prod 未部署=零影響);db push 後 `generate_typescript_types` 重生兩表 Row 型別。
  - 殘留 NIT(可接受):terms version + content_hash 雙處(terms-version.ts + migration seed)手動同步 bump(已雙處 callout 緩解、無自動斷言);條款改版時注意。
- **優先級:** 🟠 中(上線前必補;合規/爭議面)
- **問題:**
  - 結帳頁「我已閱讀並同意 PCM Motorsports 的 服務條款 與 隱私政策」checkbox **未勾選也能按「確認付款」**、且無任何提醒或阻擋。2026-06-20 sandbox 3DS 實測:未勾選直接刷卡成功建單。
- **觸發事件(任一觸發即啟動實作):**
  - prod checkout 對外開啟前;或結算重設計(`docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md`)動到 CheckoutView 時順手補。
- **預期解法:**
  - 確認付款前驗證 checkbox 已勾:未勾 → 付款鈕 disabled 或 inline 提示「請先閱讀並同意服務條款」。前端先擋 + 🔴 server action(charge-actions)亦驗(不信任 client、對齊 server 端鐵則)。可順帶記同意時間戳供日後舉證。
- **不修會痛在:**
  - 擴充性/合規:客人未同意條款即成交,日後消費/退貨爭議無「已同意」紀錄、法律站不住。
  - 可維護性:同意機制無集中驗證點,未來條款改版難追溯誰同意了哪版。
  - bug 可追蹤性:無同意時間戳,爭議時無法舉證客人確實看過/同意。
- **估時:** ~20-30 min(前端驗證 + server 驗 + 測 + 肉眼驗)
- **依賴:** `CheckoutView` / `charge-actions`
- **發現於:** 2026-06-20 / sandbox 3DS E2E 實測(Sean 觀察)
- **相關:** `apps/storefront/src/components/CheckoutView.tsx`、`apps/storefront/src/app/checkout/charge-actions.ts`、[[#250]](雙扣告警、同屬上線前 gate)、`docs/reviews/2026-06-24-gemini-payment-flow-third-eye-review.md`(Gemini 第三眼確認此為上線前必補)

---

### #242. ✅ Google/LINE 登入 OAuth redirect 指向舊 `localhost:3001`

- **狀態:** ✅ 完成 —— 2026-08-08 Sean 改 Supabase 後台設定後,**在正式站親驗通過**。
  - **關檔依據**:`STATUS.md:99` 逐字:「Sean 改 Supabase 後台 Site URL→shop.pcmmotorsports.com
    + Redirect URLs 加 `/auth/callback` ⇒ Sean 真站點『可以了』(**不再跳 localhost:3001**)」。
    根因不在 code 也不在 Vercel env(`NEXT_PUBLIC_SITE_URL` 當時實查是對的),
    而是 **Supabase 後台 Site URL 欄位仍是 dev 值** —— 兩處設定、只改一處會靜默失效。
  - ⚠️ **本條原文的「LINE 登入疑同類」不成立、走的是另一條機制**:LINE 不走 Supabase OAuth redirect,
    而是自家的 `/api/auth/line/start` → `/api/auth/line/callback`(見 `LoginPage.tsx` 的 LINE 分支),
    不吃 Supabase 的 Site URL。要查 LINE 的回跳問題不要來翻這一條。
  - 🔴 **引用更正**:2026-08-11 S 窗在 `S-002-STOP` 裡把出處寫成「STATUS:94」,**行號引錯**
    (正確是 `:99`);內容無誤。行號類字面會被後續編輯推移,引用前重查。
- **優先級:** 🟠 中(已解決)
- **問題:**
  - Google OAuth 登入完成後導回 `http://localhost:3001/?code=...` → `ERR_CONNECTION_REFUSED`(網站實際跑在 3000 / tunnel / 正式網域),redirect URI 設定指向舊的 `localhost:3001`、與實際運行網域不符 → Google 登入失敗。LINE 登入疑同類。2026-06-20 sandbox 測試以一般會員(email/密碼)登入繞過。
- **觸發事件(任一觸發即啟動實作):**
  - 多環境(staging/tunnel/prod)需社群登入時;或 prod 上線前。
- **預期解法:**
  - OAuth redirect URI 改用動態 base(對應 `NEXT_PUBLIC_SITE_URL` / 執行環境),不寫死 port;在 Supabase Auth + Google/LINE console 的 Redirect URLs allowlist 補正確網域(含 tunnel 測試網域 + 正式網域)。與 [[#190]](safe-redirect next 同源白名單)同鏈、勿弱化開放重導防護。
- **不修會痛在:**
  - 擴充性:多環境 redirect 寫死,每換網域(staging/tunnel/prod)就壞一次。
  - 可維護性:登入入口壞、客人無法用社群帳號登入 → 註冊/回訪流失。
  - bug 可追蹤性:`localhost 拒絕連線` 對客人是無意義錯誤頁、無自助出路、全導客服。
- **估時:** ~30-45 min(含 console 設定 + 各環境測)
- **依賴:** `auth/callback` route、`api/auth/line`
- **發現於:** 2026-06-20 / sandbox 3DS E2E 實測(Sean 觀察)
- **相關:** `apps/storefront/src/app/auth/callback`、`apps/storefront/src/app/api/auth/line`、[[#190]]

---

### #240. 📄 會員訂單詳情頁(OrdersTab「查看詳情 →」接行為)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(M-3 訂單列表已落地、列表→詳情是會員自然下一步;非阻塞上線)
- **問題:**
  - M-3 OrdersTab(訂單列表)的「查看詳情 →」鈕(Q1=A)照 design 渲染但**無 onClick**(明細頁本 slice 範圍外);會員點了無反應。
  - 訂單詳情需顯完整品項(`OrderItem[]`),但 domain `OrderItem.productId` 為 required、`order_items` 表**無 `product_id` 欄**(只有 `variant_id`)→ 無法忠實重建 `Order.items[]`(此即 #217)。M-3 列表用 `OrderListItem` 摘要投影繞過,詳情頁則**必須先解 #217**。
- **觸發事件(任一觸發即啟動實作):**
  - 會員回饋想看訂單明細 / 客服需引導會員自查單;或 M-4a admin 訂單功能連帶需單筆讀路徑。
- **預期解法:**
  - 先解 [[#217]](domain `OrderItem.productId` 改 optional 或詳情用獨立 read DTO);
  - 啟用 `SupabaseOrderAdapter.findById`(目前 deferred-stub)+ 讀 mapper 重建單筆 + RLS own-only(`orders_select_own` / `order_items_select_own` 既有);
  - 新增訂單詳情頁路由 + OrdersTab/Overview「查看詳情 →」接導頁(button onClick router.push 或 Link;沿 #239 N-d 紀律:不把敏感 token 落 DOM,但訂單 id 非敏感、可走正常路由);
  - 經銷價/cost 零洩漏:詳情投影同樣只白名單(`product_snapshot` title/sku/spec、`unit_price`/`line_total` 為會員自己訂單金額可顯)。
- **不修會痛在:**
  - 擴充性:退換貨 / 重新購買 / 物流追蹤都掛在詳情頁,無詳情頁這些都無處落。
  - 可維護性:會員查單一律導客服 LINE、人力成本;「查看詳情」死鈕長期掛著是 UX 債。
  - bug 可追蹤性:客服無自助查單畫面、只能口頭對單號,易對錯單。
- **估時:** ~60-90 min(含解 #217 + findById 實作 + 詳情頁 + 測;鐵則 8 需 plan + codex)
- **依賴:** [[#217]](order_items 無 product_id)、M-3 訂單列表(已落地)
- **發現於:** 2026-06-20 / M-3 OrdersTab 接真訂單(Q1=A 拍板:列表先渲染無行為鈕、詳情頁另開 slice)
- **相關:** `apps/storefront/src/components/account/tabs/OrdersTab.tsx`(查看詳情鈕)、`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`(findById deferred-stub)、[[#217]]

---

### #243. 🔒 confirm_order_payment RPC 綁「扣款證據」(縱深防憑證外洩偽造 paid)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中高(prod 結帳開放前 top 3 之一;縱深防線、非無前提可利用)
- **問題:**
  - `confirm_order_payment`(`supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql` PF-D 樹 L149-184)只驗:① order 為 unpaid ② `p_amount = orders.total`(整數)③ `rec_trade_id` 非空且未跨單重用 —— **不要求「同 order/rec 存在一筆 status='charged' 的 payment_charge_attempt」當扣款證據**。
  - 設計刻意把扣款證據驗證委派給 use-case 編排層(migration header L20-24 PF-X1/X2/X3 自承「純 DB RPC 無法獨力解」);正常運作下 confirm 被編排層保護。
  - **縱深缺口:** 若 `payment_confirmer` 憑證(server-only env)外洩,攻擊者繞過 use-case 直連 DB 呼 confirm,只要給「正確 order_id + 正確 amount(可從 order 讀)+ 任一未用過的 rec_trade_id」即可把任意未付單翻 paid;同步路徑 markCharged 失敗後仍會續呼 confirm。
- **觸發事件(任一觸發即啟動實作):**
  - prod 結帳開放規劃啟動;或 payment_confirmer 信任邊界擴張(多 caller / 多環境)。
- **預期解法:**
  - confirm RPC 改收 `attempt_id`,臨界區內 `FOR UPDATE` 驗該 attempt 屬同 order + status='charged' + rec 相符,再翻 paid;
  - **更佳:** 把 markCharged + confirm 併成單一原子 `settle_paid_attempt` RPC(一個臨界區驗扣款證據 + 翻 paid,消除兩步之間信任缺口);
  - 維持 payment_confirmer 窄權四性(零 table 權限 / 雙向 never-GRANT-role / search_path='' / SECDEF)+ 函式權限矩陣 fail-closed assert。
- **不修會痛在:**
  - 擴充性:未來新增 settle caller(退款 / 人工補單 / admin)若都信任「order unpaid + 金額」就翻 paid,信任面只會擴大、無 DB 層自證扣款。
  - 可維護性:confirm 的安全完全靠「呼叫者已驗 charge」這個外部約定,任何繞過 use-case 的呼叫(腳本 / 緊急修單)都是裸奔。
  - bug 可追蹤性:偽造/誤標 paid 後,DB 內無「對應 charged attempt」可反查,對帳查不出是真扣款還是憑證濫用。
- **估時:** ~90-120 min(改 RPC 簽章 + 編排層接線 + MCP 交易模擬 + 鐵則 8/12 plan + codex 雙關卡)
- **依賴:** `payment_charge_attempts` 表(已存在)、settleCharge / confirmPayment use-case
- **發現於:** 2026-06-21 / 金流流程四方安全審查(Codex 跨模型 code 對抗獨抓、Claude 親讀屬實;`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md` §三 #2)
- **相關:** `supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql`、`packages/use-cases/src/{confirm-payment,settle-charge}.ts`、`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`

---

### #244. 🔁 四路 settleCharge 共用 per-order settle lease(防 Record API 查詢放大)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中高(prod 結帳開放前 top 3 之一;穩定性/配額、非資金安全)
- **問題:**
  - settleCharge 由四路共呼(callback / webhook / sweeper / 輪詢)。只有**輪詢**那路有 durable per-order throttle(`claim_order_poll_settle`,S2b migration `20260621120000`);callback / webhook / sweeper **無共用 lease**。
  - OTP 成功瞬間四路幾乎同時觸發、各自打 TapPay Record API 反查 → Record API 查詢放大、配額消耗、卡單。⚠️ **非「雙重標 paid」**(那層已由 confirm PF-B `FOR UPDATE` + PF-C `WHERE unpaid` + PF-D 冪等樹防護,四方交叉驗證確認 ✅)—— 是「查詢放大」。
- **觸發事件(任一觸發即啟動實作):**
  - prod 結帳開放(真流量四路併發成常態);或 TapPay Record API 配額/rate-limit 告警。
- **預期解法:**
  - 抽共用 `claim_order_settle(order_id, caller, throttle)` 窄權 RPC,四路都先 claim 再 settle;
  - 對齊 S2b 輪詢已有的 per-order throttle family(`claim_order_poll_settle` / 4a-2 sweeper RPC 同表閘),用獨立欄不重用既有欄(沿 memory `new-rpc-align-sibling-gates` 紀律餵 sibling 給 codex)。
- **不修會痛在:**
  - 擴充性:每新增一條 settle 觸發源(未來 retry / admin 補對帳)都各自打 Record API,放大係數隨來源數線性增長。
  - 可維護性:Record API 配額耗盡/被 TapPay 限流時,四路無協調、難定位是哪路風暴。
  - bug 可追蹤性:無共用 lease,同 order 的併發 settle 無單一序列化點,log 散在四路、對帳時序難重建。
- **估時:** ~90-120 min(新 RPC + 窄 port/adapter + 四路接線 + MCP 模擬 + 鐵則 8/12 plan + codex)
- **依賴:** S2b `claim_order_poll_settle`(同表 sibling 閘)、settleCharge 四路 caller
- **發現於:** 2026-06-21 / 金流流程四方安全審查(Codex code 對抗 + Gemini 並發互補;`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md` §三 #3)
- **相關:** `supabase/migrations/20260621120000_m3_3ds_s2b_poll_settle_throttle.sql`、`packages/use-cases/src/settle-charge.ts`、[[#243]]、`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`

---

### #245. 🛡️ client cart_session_id 讀取時補 UUID 格式驗證(防 localStorage 污染卡死結帳)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(自我 DoS / UX robustness;**非雙扣、非安全**——normal flow 永遠是 `crypto.randomUUID()` 合法值,server 對非法值已 fail-closed 拒)
- **問題:**
  - `CartContext.tsx` `readSessionId()`(L123-130)只驗 localStorage `pcm-cart-session-v1` **非空**、**未驗 UUID 格式**;mount 還原同款。
  - 若該 key 被污染成「非空但非 UUID」(使用者刻意改 localStorage / 未來某 code 往 SESSION_KEY 寫進非 UUID),會被讀回當 `cartSessionId` 送 server。charge-actions ②d server 端 `UUID_RE` 驗 + 非空 fail-closed(L137-139)會安全拒絕(零扣款、零雙扣、零安全洞),但回 formError「請重新整理頁面後再試」。
  - **重整不自癒:** 重新整理後 `readSessionId()` 又讀回**同一污染值** → 結帳恆 formError、卡死,直到手動清 localStorage 或清車。
- **觸發事件(任一觸發即啟動實作):**
  - 收到「結帳一直失敗、清快取/換瀏覽器才好」客訴;或未來新增任何往 `SESSION_KEY` 寫值的路徑(跨分頁同步 / 匯入 / migration)。
- **預期解法:**
  - `readSessionId()`(及 mount 還原)讀回值若不過 `UUID_RE` → 丟棄視同無 key(空車則 `null`、有品項則 `crypto.randomUUID()` 補生);沿用 charge-actions / callback 同層 `UUID_RE` 慣例(byte 一致)。
- **不修會痛在:**
  - 擴充性:未來任何往 `SESSION_KEY` 寫值的新路徑若寫進非 UUID,client 無自癒、直接卡結帳,且每條新寫入路徑都要各自記得守格式。
  - 可維護性:client 與 server 對 key 合法性「標準不一致」(client 只非空 / server 要 UUID)= 沉默分歧,排查客訴要同時翻 client + server 兩層才看得出。
  - bug 可追蹤性:卡死症狀(結帳恆 formError)不留 client log、不會自動跟「localStorage 污染」連起來,易誤判成 server / 金流 bug 往錯方向追。
- **估時:** ~20-30 min(`readSessionId` + mount 還原加 UUID guard + smoke test;純 client、零後台、零 migration)
- **依賴:** 無(CartContext 7a `d77a6e2` 已落地)
- **發現於:** 2026-06-21 / 3DS-7 codex K2 審查(should;codex 自定性=自我 DoS / UX、非雙扣漏洞)
- **相關:** `apps/storefront/src/contexts/CartContext.tsx`、`apps/storefront/src/app/checkout/charge-actions.ts`、`apps/storefront/src/app/checkout/callback/page.tsx`

---

### #246. 🧹 退役 usePlaceOrder / placeOrderAction 死碼清理(消「兩條 cart_session_id 來源語意並存」)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(死碼、生產零呼叫、非安全;清理 / 降誤用面)
- **問題:**
  - 唯一 live 結帳鏈 = `CheckoutView` → `useChargePayment` → `chargePaymentAction`(`CheckoutView.tsx:8` 註「usePlaceOrder 退役、本檔不再呼叫」)。
  - `usePlaceOrder.tsx` + `placeOrderAction`(`app/checkout/actions.ts`)**生產零呼叫**(僅自身 + test 引用),其 `cart_session_id` 仍走 option A 的 server `randomUUID()`(`actions.ts:113`),且殘留舊註解「Phase II 3DS-7 改 client CartContext 產」(`actions.ts:111-113`)—— 3DS-7(7b `df04625`)後此字面已不成立(live 路徑早改 client key)。
- **觸發事件(任一觸發即啟動實作):**
  - ②-⑤ 結帳收尾評估;或有人誤改 / 誤接退役檔(兩條 cart_session_id 來源語意並存 = 易誤用)。
- **預期解法:**
  - grep 全 repo 確認 `usePlaceOrder` / `placeOrderAction` 無 live import(只剩自身 + test)後刪除該兩檔 + 對應 test;若有型別 / util 被 live 路徑共用則保留、其餘移除;一併消除 `actions.ts:111-113` 殘留舊註解。
- **不修會痛在:**
  - 擴充性:兩條建單路徑(live charge / 退役 place)語意分叉,未來改 cart_session_id / 建單契約要同步兩處,或只改一處留下不一致。
  - 可維護性:退役檔殘留「3DS-7 將改 client」舊註解與事實相反,讀者會誤以為 server `randomUUID()` 是現行設計。
  - bug 可追蹤性:`grep cartSessionId` 來源會同時命中 `randomUUID()`(退役)+ client key(live)兩處,排查雙扣 / 去重來源時是噪音、易追錯路徑。
- **估時:** ~30-45 min(刪檔 + 清 test + 確認 live 無依賴 + 三綠)
- **依賴:** 確認 `CheckoutView` 及全 repo 無 live import(grep 驗)
- **發現於:** 2026-06-21 / 3DS-7 plan §6 範圍外(退役死碼候選)+ codex K2 nit(`actions.ts:111-113` 殘字)
- **相關:** `apps/storefront/src/hooks/usePlaceOrder.tsx`、`apps/storefront/src/app/checkout/actions.ts`、`apps/storefront/src/components/CheckoutView.tsx`

---

### #247. 🗺️ sitemap 商品來源治本(全品類覆蓋 ✅ C4 已解 / 效能輕量列舉待)

- **狀態:** 🟡 **覆蓋缺口已解(C4 2026-07-04)、效能治本待執行**(降級:覆蓋層原「多品牌上架前必補」已由 C4 補上、不再是硬前置;剩效能優化)。
- **優先級:** 🟢 低(覆蓋已全、無靜默漏頁風險;剩效能屬優化非正確性)。
- **問題:**
  - ~~GEO P0 借用 `fetchCatalogProducts()` → `listAllByCategory()` category-scoped 硬編碳纖維部品~~ → **C4/#205 已改 `fetchCatalogProducts()` → `SupabaseProductAdapter.listAllProducts()` 撈全目錄(不綁分類)**,sitemap 天然涵蓋所有品類、多品牌(#212)上架後不再靜默漏頁。**覆蓋缺口(本 #247 主痛點)已消除。**
  - **仍未治本(降級後剩餘範圍)= 效能**:`listAllProducts()` 撈 `PRODUCT_SELECT_DETAIL` 全欄(sitemap 只需 `handle`),重量級查詢僅為取 slug;輕量 `listAllHandlesPublic()`(走 `products_list_public` 只取 id+handle、免撈 detail)+ `<lastmod>` 補欄仍為正解。屬 stopgap(對齊 #51),Phase-1 ~1117 件 + 每日 revalidate 快取可接受。
- **觸發事件:** 目錄規模顯著長大 sitemap 撈 detail 成本痛時;或與 #51 server-side 分頁一併治。
- **預期解法(剩餘效能層):**
  - 新增輕量 public 列舉 `SupabaseProductAdapter.listAllHandlesPublic()`(走未接線的 `products_list_public` view、只取 `id + handle`、免撈 detail 全欄);`app/sitemap.ts` 改吃它。
  - 順帶評估 `<lastmod>`(`products_list_public` 無 `updated_at`,需走 `products_public` 或 view 補欄)。
- **不修會痛在:**
  - 擴充性:多品牌一上架,sitemap 立即漏掉新品類全部商品,卻不會報錯。
  - bug 可追蹤性:「為何新品牌商品沒被 Google/AI 收錄」會難排查(sitemap 看起來正常產出,只是少了那些 URL)。
- **估時:** ~30-45 min(新增 adapter 列舉方法 + port 對齊 sibling + 改 sitemap.ts + 測試;跨 ports/adapters 層觸鐵則 8)
- **依賴:** #212 多品牌 schema / 上架時序
- **發現於:** 2026-06-21 / GEO P0「大門+地圖」slice(借用 fetchCatalogProducts 的已知技術債)
- **相關:** `apps/storefront/src/app/sitemap.ts`、`apps/storefront/src/lib/products.ts`、`packages/adapters/src/supabase/SupabaseProductAdapter.ts`、#212

---

### #248. 🟡 site-config 商家資料 L2 hardcode → 待後台來源(內容分級降級)

- **狀態:** ⏳ 待執行
- **優先級:** 🟢 低(現況正確;季度級異動、手改一處可接受)
- **問題:**
  - GEO P0「商家身分證」(`lib/site-config.ts` + `lib/org-jsonld.ts`)的商家資料(店名 / 登記名 / 統編 / 電話 / email / 地址 / 營業時間 / 社群 / logo)目前 **hardcode**(L2:hardcode + TODO + backlog)。
  - 真值來源 = Sean 2026-06-21 親自提供,集中於 `site-config.ts` 單一真相(已消除站名散在 4 檔的問題)。
- **觸發事件(任一觸發即啟動實作):**
  - 商家資料需高頻異動、或有後台 CMS / settings 來源可接時。
- **預期解法:**
  - 若上後台:`site-config.ts` 改讀後台 / settings 來源,Organization JSON-LD builder 簽名不變。
  - 可補的缺漏(本次未放,待 Sean 提供):精確 geo 座標(現用 design mock 近似值未放)、favicon / 預設 OG image(目前僅作 Organization logo)。(英文登記名 `PCM MOTOR PARTS LTD` 已於 2026-06-22 由 Sean 確認、落 `alternateName`。)
  - **HomeFooter 佔位對齊**(code-reviewer 2026-06-21 nice-to-fix):`HomeFooter.tsx:54` 仍顯 `統編 · xxxxxxxx` 佔位、電話亦為 `02-2998-xxxx` 佔位,而 `site-config.ts` 已落真統編 `90003020` / 真電話。後續讓 footer 改讀 `site-config.ts`(對齊「商家事實單一真相、勿各元件重複硬寫」),消佔位。**屬 footer 視覺/內容(Sean 主場 + design-mirror),本 GEO slice 未動。**
- **不修會痛在:**
  - 可維護性:商家資料異動需改 code + 重新部署(非後台即時)。低頻故可接受,但高頻會痛。
- **估時:** 視後台方案(~1-2h 起)
- **發現於:** 2026-06-21 / GEO P0「門牌+商家身分證」slice
- **相關:** `apps/storefront/src/lib/site-config.ts`、`apps/storefront/src/lib/org-jsonld.ts`

---

### #249. 🏛️ 孤兒單治本架構議題(reuse 小補丁 vs 學 Shopify「付成才建單」大重構)

- **狀態:** 🟢 **方向已定(Sean 2026-07-02 拍 A+甲)**:治本走**方案 B = Shopify「付款成功才建正式訂單」、定調為 Phase 2 目標架構**;**Phase 1 維持現況「先建單(unpaid)+ 3DS 對帳脊椎」+ 本次顯示層藏孤兒、先上線**,不採方案 A(create_order reuse 補丁)、**不推翻 M-3 3DS 主線**。Phase 2 啟動才走專屬 PRD + codex 雙關卡 + Sean 批(方案 B 影響面 = 整個 3DS 子系統重構、見下)。🔴 孤兒/未付款單**絕不硬刪**(late-success 可能晚扣款 → 刪單=客人被扣款查無單=靜默多扣);Phase 1 處置固定=留紀錄 + 藏(顯示層已做)+ 對帳掃描器收斂到終態。
- **原狀態(歷史):** ⏳ 待評估(本次已做顯示層治標=會員列表藏 unpaid;治本兩方案待時機評估)
- **優先級:** 🟠 中(現定調 Phase 2;Phase 1 現況顯示層已藏、客人端無感,不急)
- **問題:**
  - 現架構=客人按結帳當下、扣款**之前**就 INSERT 一筆正式 `orders`(`payment_status` DEFAULT `'unpaid'`;`charge-actions.ts:176` 先 placeOrder 後 charge)。客人放棄付款 → 該單**永久停 unpaid**(payment_status enum 僅 `unpaid/paid/partiallyPaid/refunded`、**無 cancelled/expired**、`20260604120000_...:50`),sweeper 只終結 attempt 不終結 order → DB 累積孤兒 unpaid 單。
  - **本次已做(治標、顯示層)**:會員訂單列表 `listSummariesByCustomer` 加 `.neq('payment_status','unpaid')` 藏孤兒單(= Shopify 客人端體驗);但 DB 內孤兒單仍在(sweeper 標終態、不刪)。
  - **安全前提**:藏 unpaid 僅在「絕大多數 unpaid 都是沒付成的孤兒」時正確 —— 現況 PCM 僅 TapPay 即時刷卡、無「下單後線下轉帳 / 貨到付款」之合法待付款單,前提成立;**未來若新增線下付款方式,此過濾須重審**(否則藏掉合法待付款單)。**已知短暫窗**:3DS 付成後到 `settleCharge` 翻 paid 之間在途單短暫仍 unpaid 會被暫藏、對帳收斂(秒~分鐘)後自然顯示 —— 顯示層治標的可接受延遲、非孤兒、非本次引入的回歸(`confirm_order_payment` 為 unpaid→paid 唯一寫路徑、`20260611120000`)。
- **觸發事件(任一觸發即啟動評估):**
  - prod 真實開放刷卡前;或真流量上來孤兒單堆積、sweeper / Record API 對帳成本顯著;或要重做付款系統(與 3DS「放棄交易重買」parked 線一起當「付款系統 v2」升級時)。
- **預期解法(兩方案、傾向互斥擇一):**
  - **方案 A(reuse 小補丁、在「先建單」架構內治本)**:`create_order` 對同 `(customer_user_id, cart_session_id)` + 同購物車內容 → 回既有 unpaid 單、不每次建新孤兒(3DS-7 cart_session_id 已建半套防重基礎)。少建,但「真放棄」殘留仍在;動 create_order RPC(鐵則 8/12)。
  - **方案 B(學 Shopify、付成才建正式 order)**:付款成功才把訂單升級成正式 `orders`,未付款用一個不算正式訂單的中間態(pre-order / checkout 物件)承載(購物車內容 / 金額 / 地址快照 / cart dedup 記憶)。從根本消滅孤兒單 + 列表天然乾淨(= Shopify 官方模型:third-party gateway「orders are created as soon as Shopify receives payment confirmation」、未付款=abandoned checkout 不進客戶訂單歷史)。
  - **B 影響面(2026-06-22 唯讀偵察實證、結構性深度依賴)**:整套 3DS 對帳脊椎建立在「order 付款前已存在」之上 → `order_id` 當 `order_number` 送 TapPay 為唯一對帳鍵(`TapPayChargeAdapter.ts:91/162`)、`payment_charge_attempts.order_id NOT NULL REFERENCES orders(id)` 硬 FK、callback / webhook / sweeper 三路全持 order_id 回查既有 order、`begin_charge_attempt` cart 防雙扣靠反查既有 order rows、`settleCharge` 靠 orderId 只更新不建單、`confirm_order_payment` PF-D「order 不存在→拒」。改 B=反轉建單與付款因果 + 重定對帳主鍵 + 拆 attempt↔orders FK,涉 `charge-actions.ts` + initiate / confirm / settle / sweep 四 use-case + callback / webhook / sweeper 三路 + ≥5 RPC + 2 表 ≈ 整個 3DS 子系統。最高等級重大改動(獨立 plan + codex 雙關卡 + Sean 批)。
  - **⚠️ 澄清**:方案 B 消滅「孤兒單 / 列表雜訊」(資料模型乾淨度),**不消滅 TapPay 雙扣牆**(放棄的 3DS 授權之後能否被扣=TapPay 端授權生命週期、與建單時機無關)。別期待 B 解決雙扣。
- **不修會痛在:**
  - 擴充性:維持「先建單」+ reuse 補丁,每加一條付款功能(放行重買 / 多付款方式)都要在 unpaid 卡單併發症上打補丁;走 B 則這類問題從根本變簡單。
  - 可維護性:孤兒 unpaid 與真訂單同表混居,報表(轉換率 / 客單價)、客服查單、後台列表(#225 admin 線)長期帶「過濾 unpaid」隱性負擔。
  - bug 可追蹤性:「未付款」一直借正式 order 表達,卡 unpaid 的各種成因(放棄 / 對帳延遲 / 卡拒)混在同表同狀態,難一眼分辨。
- **估時:** 方案 A ~2-4h(改 create_order RPC + reuse 裁決 + MCP 模擬 + 鐵則 8/12 plan + codex);方案 B = 大型重構(多 slice、付款系統 v2 等級、專屬 plan + 完整 codex + Sean 批)
- **依賴:** 3DS 對帳脊椎現況(settleCharge / payment_charge_attempts / create_order)、cart_session_id 防重(3DS-7)、Sean 對「付款系統 v2」時機拍板
- **發現於:** 2026-06-22 / 3DS「放棄交易重買」探索副產品 + Shopify(Evotech)PayPal 流程對照 + 唯讀架構偵察(建單時機 / 對帳依賴 / 中間態零件盤點)
- **相關:** #225(admin 後台 unpaid 殭屍單清理、同源問題不同 surface)、`docs/specs/2026-06-22-m3-3ds-abandoned-reorder-refund-design.md` §3、`docs/handoff/2026-06-22-3ds-abandoned-reorder-tappay-blocked-handoff.md`、`packages/use-cases/src/settle-charge.ts`、`apps/storefront/src/app/checkout/charge-actions.ts`

---

### #250. 🔔 雙扣 anomaly / refunding 缺主動推播告警(pull→push、上線前營運就緒)

- **狀態:** ✅ 已實作(2026-07-01、worktree=dev、未 push、未 db push、`ANOMALY_ALERT_ENABLED` 預設 false 休眠;真權威 `docs/specs/2026-07-01-m3-250-anomaly-alert-plan.md`)
  - 實作:新 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds)`(payment_confirmer cron 對 anomaly 兩表零表權 → 經此受控窗讀**零 PII 計數**:open/refunding/refunding_stuck/oldest_open_age/attempt_manual_review〔needs_manual_review+pending+unpaid〕/released_stuck〔released_manual_review_at,Phase1 producer-gated 0〕)+ cron route `app/api/cron/anomaly-alert`(鏡像 settle-sweep:CRON_SECRET Bearer + `ANOMALY_ALERT_ENABLED` gate 預設 false=200 no-op + errors>0→503 不偽 200)+ use-case `checkAnomalyAlerts`(門檻踩 → 對所有已設定管道推播、Promise.allSettled 一管道掛不阻另一、reader/notifier throw→503 fail-closed)+ 兩 notifier adapter(LINE Messaging API push〔Q1=A〕/ Email Resend〔Q1=C〕、原生 fetch 零新依賴、密鑰不入 log/訊息)+ `getAnomalyAlertDeps`(依 env 存在性組管道、enabled 但零管道 throw)+ vercel.json 加 cron(`0 1 * * *` UTC=台灣 09:00、晚 settle-sweep 1h 讓對帳先收斂)。
  - 審查鏈:關卡1 Gemini + codex K1 + adversarial-reviewer(6 findings 全折入:死卡列拆兩計數 / 文案不宣稱已確認雙扣 / Vercel tier 現實 / ACL 5 角色 REVOKE / CRON_SECRET sequencing / 揭示可調營運參數非 SLA)+ 關卡2 codex K2 跨模型 PASS〔2 MED+1 NIT 折入:use-case 零管道 guard / effective-privilege assert / oldest age plumb〕+ code-reviewer PASS + adversarial-reviewer PASS-with-comments + pcm-security-audit L1〔0 CRITICAL/0 HIGH/1 LOW→#254〕。DDL MCP BEGIN..ROLLBACK 零留痕模擬〔ACL 矩陣 + role-hygiene + effective-privilege + 行為 delta open2→3/refunding0→1/stuck@24h=1/stuck@30d=0 + residue=0〕+ 三綠 + vitest 145 檔 1568。
  - 🔴 **誠實邊界**:告警門檻(refunding_stuck 秒數)= route 常數營運參數、**揭示可調、非 PRD SLA**(W1 runbook line150 不杜撰 SLA);open = 雙扣**候選、待查證**(runbook line51、非已確認雙扣);released_stuck Phase1 恆 0(前瞻接線);**無 per-anomaly 去重**→ 未解決前每輪持續提醒(刻意)→ 去重狀態表列 **#255** follow-up。頻率 daily=最壞 24h 延遲 vs 黃金期為盡力非保證、真黃金期需 Vercel Pro 改 hourly(launch 時 Sean 決)。
  - 🔴 **db push sequencing**:migration `20260701120000` code 已期待、live 未套用 → **Sean db push 在「驗 cron / 部署」之前**(prod 未部署 + gate false=零影響);db push 後 Claude 唯讀 MCP 驗函式簽名/SECDEF/ACL/role-hygiene。
- **優先級:** 🟠 中(上線前必補;prod 開放結帳前 gate)
- **分流標籤:** `P1-before-launch`
- **問題:**
  - 3DS 乙路退款版(canonical plan v9)雙扣偵測 + 退款 lifecycle 資料齊全(`released→charged` 同交易建 open anomaly §4 R1b1c、W1 報表 §7 列 open + SLA/責任人欄),但整份 plan **grep 不到任何 email/Line/Slack 主動推播** = pull-based(「有空才查報表」)。§14 step45 監控指上線後 flag-rollback 運維、非雙扣客訴黃金期的營運推播 → 雙扣發生時 Sean 不會被通知、只能自己查。
  - 同源殘餘(A1/A2):`refunding` 卡逾 SLA(人工退款未閉環)、`released_manual_review_at` / 連續 `record_unreachable` / 12h 孤兒等「死卡列」plan 只寫成欄位/旗標,**未指定誰用什麼介面看見**。
- **觸發事件(任一觸發即啟動實作):**
  - anomaly/refund 子系統(R1b1a-c + W1)實作時;或 prod 開放 `TAPPAY_3DS_ENABLED=true` 前(rollout gate);最遲 = anomaly/refund dedicated PRD(§14 step11-12)建立時一併納入。
- **預期解法:**
  - 沿用既有 settle-sweep cron pattern(`app/api/cron/settle-sweep` + `CRON_SWEEPER_ENABLED` gate)加一條排程查詢:`open anomaly 數 > 0` 或 `refunding 逾 SLA 時數` 或死卡列 → 自動發 email/Line/Slack 給 Sean。**不動 anomaly 表 RPC 安全層**(anomaly 表 append-only + owner/postgres 受控,告警走 owner-run 查詢)。A1/A2 死卡固定查詢同 cron/SQL pattern 一起做。
  - **Sean 決策題:** 報表 only vs 報表 + 主動推播(Gemini 強烈建議 +推播、防錯過客訴黃金期;傾向 +推播=輕量 cron 不動安全層)。
  - **明確否決** Gemini 第二建議「把 auto-refund Refund API 提前」= 與 §0 Q1 拍板「過渡走手動 Dashboard、Refund API 上線前 backlog」衝突,為罕見路徑提前自動化是反決策過度投資。
- **不修會痛在:**
  - 擴充性:雙扣/卡死偵測有了但無觸達層,每加一種異常都要 Sean 記得手動巡查,無法規模化。
  - 可維護性:罕見雙扣窗一旦發生、營運靠人工巡查易漏,客訴黃金期過了才發現 → 公關/退款糾紛。
  - bug 可追蹤性:死卡(record_unreachable / 12h 孤兒 / refunding 卡住)只在 DB 欄位、無人主動看見 = 沉默故障,出事才回溯。
- **估時:** ~30-45 min(cron 查詢 + 推播 webhook + 測;與 A1/A2 死卡查詢同 pattern 可合併)
- **依賴:** anomaly/refund 子系統(R1b1a-c / W1)先實作;Sean 決策(報表 only vs +推播);通知管道(Line Notify / email / Slack webhook)選定
- **發現於:** 2026-06-24 / Gemini 金流第三眼審查 + Claude 11-agent triage(canonical plan v9 過 Codex round11 後)
- **相關:** canonical plan §7/W1 + §14 step11-12、[[#241]](同意條款 server 驗、同屬上線前 gate)、`docs/reviews/2026-06-24-gemini-payment-flow-third-eye-review.md`、`app/api/cron/settle-sweep`、`packages/use-cases/src/settle-charge.ts`

---

### #251. 🔧 DB reason allowlist 補 `released_failure_observed`(TS↔DB allowlist 對齊、flag-on 前)

- **狀態:** 🟢 **完成(2026-07-02、dev、已 push origin/dev〔commit `8b12757`〕、db push ✅ live、flag 全 false)**:CREATE OR REPLACE 兩支 SECDEF retry RPC(`mark_attempt_settle_retry` live 基線 20260624120008 / `mark_webhook_retry` live 基線 20260615120000),**唯一改動 = allowlist `IN(...)` 加第 4 碼 `released_failure_observed`**(可執行 SQL 除該行零行為漂移)。順帶更新 `sweep-settlements.ts` docstring 對齊(暫不對齊→#251 已補、db push 生效)。**DDL MCP 零留痕模擬 PASS**:T1 attempt released→存原值 / T2 未知碼→unknown / T3 既有碼零回歸 / T4 webhook released→原值 / T5 webhook 未知→unknown + ACL 矩陣 + role-hygiene,末端 RAISE 強制 rollback、函式 live 定義仍 3 碼版 + synthetic 殘留 0/0/0;另唯讀驗 live=repo 基線無漂移(attempt 有 R1c1 溢位 cap、兩支 3 碼、ACL pc=T/svc=F)。**三模型審查全過 0 must-fix**:codex K2 PASS-with-nits + code-reviewer PASS + adversarial-reviewer(Fable 5、9 次擊破全擋)PASS-WITH-NITS,nits 全折入(byte-identical→可執行 SQL 零漂移措辭 / producer 收斂〔實際 producer 待 R2b/flag-on〕/ 檔頭「零 release CAS caller」過時修正〔R3 preflight 已是 caller 受 flag gate〕/ docstring 對齊)。三綠 typecheck 7/7 + lint 10/10 + build 1/1。🔴 診斷欄純遙測、不影響重試/結算/雙扣裁決;Phase 1 producer-gating 零觸發。**收尾 ✅(2026-07-02 校正)**:已 push(`8b12757`∈origin/dev=`2e4fd31`)+ db push live + Claude 唯讀 MCP 復驗兩支 RPC allowlist=4 碼〔record_unreachable / record_unverified / auth_or_pending / released_failure_observed〕+ ACL payment_confirmer=T·anon/authenticated/service_role=F → **PASS**。
- **原狀態(歷史):** ⏳ 待執行
- **優先級:** 🟡 低(Phase 1 producer-gating 零觸發;flag-on 前對齊即可)
- **分流標籤:** `P1-before-launch`
- **問題:**
  - canonical plan §5 規定 R2a 同時改「normalizeReason **與** DB allowlist 加 `released_failure_observed`」,但 §9 標 R2a「無 migration(✗)」、且 R1 migration bundle 已 db push 落 prod(守線禁動 live migration)= 計畫書 §5/§9 內部矛盾。R2a(Q1=A)只改了 TS 側(`packages/use-cases/src/sweep-settlements.ts` `SWEEP_REASON_CODES`),**DB 側未補**。
  - live DB 的 `mark_attempt_settle_retry`(migration `20260624120008` R1c1)+ webhook `mark_*_retry`(`20260615120000` R1c1 前身)reason allowlist 仍只認 `('record_unreachable','record_unverified','auth_or_pending')` → released attempt 讀 -1/5 走 `markSettleRetry('released_failure_observed')` 時,DB `WHEN p_reason_code IN (...)` 落 ELSE → 診斷欄 `last_settle_error` 存成 `'unknown'`(而非 `released_failure_observed`)。
  - **非正確性 bug**:`last_settle_error` 純診斷遙測欄(零 PII),不影響重試是否發生(token-guard UPDATE)、不影響結算/雙扣裁決;僅 ops 觀測時看不出「這筆是 released 失敗觀察」。
- **觸發事件(任一觸發即啟動實作):**
  - prod 開放 `TAPPAY_3DS_ENABLED=true` 前(rollout gate);或下一次有金流 RPC migration 要動時順手帶;最遲 = §14 步30 B1a 第二次 db push 窗(可獨立小 migration 一起 push)。
- **預期解法:**
  - 獨立小 migration:`CREATE OR REPLACE` 兩支 retry RPC,allowlist `IN (...)` 加 `'released_failure_observed'`(其餘逐字不改、零漂移);DDL MCP 模擬驗 released reason 不再被正規化成 unknown + ACL 沿用基線;補後 TS↔DB allowlist 對齊。
  - 不單獨開 slice、不急(producer-gating 零觸發);搭既有 db push 窗或金流 migration 順帶。
- **不修會痛在:**
  - 可維護性:flag-on 後若真出 released 失敗觀察,ops 在 `last_settle_error` 看到 `'unknown'` 無法直接區分是「released 失敗觀察」還是「真未知碼」,排查多一層。
  - bug 可追蹤性:TS 與 DB allowlist 不對齊是隱性漂移,後人 grep TS 以為 DB 也認得 → 誤判遙測完整性。
- **估時:** ~20 min(小 migration + DDL MCP 模擬 + 三綠)
- **依賴:** 下一次金流 migration db push 窗(B1a 第二次 push 或獨立);R2a TS 側已先行(`released_failure_observed` 入 SWEEP_REASON_CODES)
- **發現於:** 2026-06-25 / R2a(§14 步23)關卡1 plan 自審(canonical §5「R2a 改 DB allowlist」vs §9「R2a 無 migration」內部矛盾)
- **相關:** canonical plan §5/§2.5、Q1=A(2026-06-25 Sean 拍)、`packages/use-cases/src/sweep-settlements.ts`(`SWEEP_REASON_CODES`)、`supabase/migrations/20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql`、`supabase/migrations/20260615120000_m3_3ds_4a1_webhook_sweeper_rpc.sql`

---

### #252. 🔔 3DS flag 緊急關閉中間態:pending 3DS 兄弟單靠舊版 begin cart-dedup 兜底(開 prod flag 前驗)

- **狀態:** 🟢 已驗證 **PASS-WITH-CAVEAT + GAP2 處置已拍(Sean 2026-07-01 = B+A)**(唯讀 MCP + DDL MCP 六場景零留痕模擬 + adversarial-reviewer + codex 跨模型二度確認、報告 `docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md`);**B(縱深)已落 canonical §14 步45**、**A(治本)排 [[#256]]**。#252 驗證本體收尾;剩 A=#256 flag-on 前補。
- **優先級:** 🟠 中(prod flag=false 期間不可達;flag-on 前必決 GAP2)
- **問題:**
  - Q1=A:preflight 只在 3DS flag on 跑。若未來 prod 開了 3DS、客人有 pending 3DS 兄弟單時被緊急關閉 flag(§14 步45 rollback 第一動作),客人走同步路徑重付 → **跳過 preflight**。
  - 此中間態靠舊版 `begin_charge_attempt` cart-dedup(同 cart_session_id 的 pending/charged 兄弟單 → duplicate/needs_settle → adjudicateSettlement)兜底,**非** preflight。**驗證證實**:同 cart 走 needs_settle/duplicate、異 cart 且 <10min 走 **user_in_flight 安全網(cart-agnostic)**攔截 → #252 主場景(立即重付)守住。
  - 殘餘缺口(二度確認修正):① **GAP1 released 兄弟單**(begin dedup + user_in_flight 皆排除 released)→ rollback 場景**可達**(flag-on 已產生的 released row),但其 `released→charged` late-success **觸發 anomaly genesis** → #250 `open` 偵測 + W1 **可退**。② 🔴 **GAP2 純 pending 兄弟單 + 異 cart + >10min**(user_in_flight 窗過期 + dedup 異 cart 漏)→ 取新鎖雙扣,且兄弟 late-success 走 `pending→charged`(**非** released→charged)→ **不觸發 genesis → 零 anomaly → #250/W1 完全看不見 = 靜默雙扣偵測盲區**。〔初稿與本 backlog 舊版皆誤稱「②由 anomaly/W1 下游覆蓋」,經 2026-07-01 二度確認 triage(全 repo anomaly 主表唯一 INSERT gate `status='released'`)修正。〕
- **觸發事件(開 prod flag 前必啟動):**
  - 開 prod `TAPPAY_3DS_ENABLED=true` 前(§14 步44);Gemini 廣度第三眼 + adversarial-reviewer R3 關卡2 已點(2026-06-26)。
- **預期解法:**
  - ✅ begin-dedup 六場景 MCP 模擬已驗(2026-07-01、零留痕、殘留 0/0/0):同 cart pending/charged→needs_settle、paid→duplicate、異 cart <10min→user_in_flight;GAP1(released)/GAP2(異 cart >10min)→ acquired=true(印證缺口)。
  - **不採 Q1=C**(二度確認雙方 HOLDS:own-only lookup 仍綁 cart_session_id + active-only,救不了 released/異 cart/>10min,對主場景又冗餘)。
  - ✅ **GAP2 盲區處置已拍(Sean 2026-07-01 = B+A)**:**B(縱深、已落)**= canonical §14 步45 加「關 flag 縱深」條目(計畫性關 flag 先跑 settle-sweep 收斂 in-flight pending→終態;緊急關 flag 後立即跑 + 人工比對同 user 多筆 paid,壓縮盲窗、非零窗)。**A(治本、排程)**= [[#256]] pending-based 雙扣偵測(同 user 短窗多筆 paid → anomaly + 告警,關閉盲區)。**不採單純 C(informed-accept)**〔靜默雙扣對客人最傷〕。
- **不修會痛在:**
  - 擴充性:未來真開 3DS 後若需緊急 rollback,GAP1 in-flight 客人重付可能雙扣(可偵測+退、增退款工單);**🔴 GAP2 純 pending 雙扣則靜默(無告警無工單)**。
  - 可維護性:gating 依賴「begin dedup + user_in_flight 兜底」是隱性契約,後人改 begin/user_in_flight predicate 可能無意打破;anomaly genesis 只認 released→charged 亦為隱性偵測邊界。
  - bug 可追蹤性:GAP2 盲區雙扣不進 anomaly 報表,對帳時憑「同 user 兩筆 paid」人工發現,難溯根因。
- **估時:** ✅ 驗證已完成(~實花較久:MCP 模擬 + 雙審 + triage);剩 GAP2 決策落定 + 對應落檔(runbook/偵測/accept)。
- **依賴:** 開 prod flag 前(§14 步44);R3 已落(§14 步25);驗證已完成(2026-07-01)
- **發現於:** 2026-06-26 / R3(§14 步25)關卡2 adversarial-reviewer F-T2 + Gemini 廣度第三眼 vector 6;**GAP2 盲區發現於 2026-07-01 驗證二度確認(adversarial-reviewer F1 HIGH + codex must-fix)**
- **相關:** canonical §2.3 / §14 步44-45、Q1=A(2026-06-25 Sean 拍)、`begin_charge_attempt`、`adjudicateSettlement`、anomaly genesis `20260624120005`、#250 summary `20260701120000`、[[#255]](盲區偵測可併)、#251、驗證報告 `docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md`

---

### #253. 🟡 B1 manual=false 12h 孤兒再確認後仍 pending 未升級 needs_manual_review(canonical §8 case ④ defer)

- **狀態:** ⏳ 待執行(Sean 2026-06-27 拍 defer = 本輪 B;canonical §8 defer 契約要求明示編號、不可默默略過)
- **優先級:** 🟡 低-中(實務由既有 sweeper ceiling 兜底、非永久遺失;開 prod flag 前評估補)
- **問題:**
  - canonical §8 行280 case ④「manual=F + Record 4 → 維持 pending **並進 manual**」要求 B1 把「manual=false 的 12h+ 孤兒、再確認仍 pending」升級 `needs_manual_review=true`(進人工 queue)。
  - B1b `reconfirmExpiredOrphans` pending 分支只 tally、**未寫 manual**(B1a claim RPC 只蓋 throttle 戳、明訂「不動 manual」)。
  - 🔴 canonical 用詞**自相矛盾**:行278「原本 false **可**標 true」(permissive)vs 行280 case ④「**並進** manual」(mandatory)→ B 線 §14 步35 整體複審 adversarial-reviewer F-INT1 抓到(slice 級雙審未見)。
- **實務影響(LOW):**
  - 既有 sweeper `claim_stuck_unsettled_attempts` 本就處理 manual=false 孤兒、約 8 個掃描週期達 ceiling → `mark_attempt_settle_retry` 標 manual=true → manual=false 孤兒**仍會被升級、只是由 sweeper 非 B1**。B1 主目標(sweeper 放棄的 manual=TRUE 孤兒)已覆蓋。
- **預期解法(若補做):**
  - 新窄權 SECDEF RPC(payment_confirmer-only、`search_path=''`)`flag_expired_orphan_manual(p_attempt_id,p_order_id)`:`WHERE status='pending' AND order unpaid AND id+order 雙鍵符 → needs_manual_review=true`(冪等、不動其他欄)+ has_function_privilege 矩陣 + role-hygiene assert + DDL MCP 模擬。
  - B1b pending 分支:該 orphan `needsManualReview=false` 時呼 flag RPC 升級(記 escalated 計數)+ 測試。
  - 或評估直接併進 sweeper(避免 B1/sweeper 兩路重複升級)。
- **不修會痛在:**
  - 擴充性:manual=false 孤兒升級依賴 sweeper ~8 週期慢兜;若未來停用/改 sweeper ceiling,B1 不補則升級無備援。
  - 可維護性:canonical §8 與實作有已知偏離(本條 defer 落檔),後人讀 case ④ 會誤以為已做。
  - bug 可追蹤性:manual=false 孤兒升級時機由 sweeper(8 週期)非 B1(12h)決定,對帳時間軸混兩來源。
- **估時:** ~30-45 min(新 RPC migration + DDL 模擬 + B1b 接線 + 測 + 雙審)
- **依賴:** B1a/B1b 已落(`8197fca`/`4866817`);開 prod flag 前評估
- **發現於:** 2026-06-27 / B 線 §14 步35 整體複審 adversarial-reviewer F-INT1
- **相關:** canonical §8 行278/280 case ④、Sean 2026-06-27 拍 defer(本輪 B)、`reconfirm-expired-orphans.ts`、`claim_expired_pending_attempts`、既有 sweeper `mark_attempt_settle_retry` ceiling 升級

---

### #254. 🔧 告警 cron 加簡易限流 + 評估獨立 secret(#250 縱深 hardening)

- **狀態:** 🟢 **已實作(2026-07-02、dev、純 TS 無 migration、無需 db push、flag 全 false)**:新增共用 in-memory sliding-window 限流器 `apps/storefront/src/lib/cron/rate-limit.ts`(視窗 60s / 每窗 MAX 5、per-route key、被擋不佔額度不延長鎖定),兩個 cron route(anomaly-alert + settle-sweep)於**認證通過後、enabled gate 前**呼 `checkCronRateLimit` 超限回 **429**。**「評估獨立 secret」結論 = 不做**(Vercel cron 平台只帶單一 CRON_SECRET、要獨立 secret 須自訂 header 驗對 LOW hardening 過重)→ 走「限流 + 洩漏時輪替 secret」收口。**審查鏈全過 0 must-fix**:codex K2 跨模型 PASS-with-comments + code-reviewer PASS + adversarial-reviewer(Fable 5、真跨模型)PASS-WITH-NITS,findings 全折入(補 disabled+flood→429 排序釘死測 / 軟化過度承諾 + 誠實邊界#4 告警壓制窗 / 半開窗措辭 / `import 'server-only'` / Date.now 倒退跳自愈註)。三綠 typecheck 7/7 + lint 10/10 + build 1/1 + 完整 vitest 146 檔 1585。🔴 誠實邊界:per-instance best-effort、**非全域硬上限**(真硬上限需 DB-durable throttle→升級路徑併 [[#255]]);活躍 flood 期間合法 cron 同窗亦 429(同 secret 不可區分)、收口靠輪替 secret。
- **原狀態(歷史):** ⏳ 待執行(上線前評估;非阻擋)
- **優先級:** 🟢 低(LOW hardening、非可即利用破口)
- **分流標籤:** `P1-before-launch`
- **問題:**
  - #250 告警 cron(`app/api/cron/anomaly-alert`)認證硬驗正確(CRON_SECRET Bearer + timingSafeEqual、無 secret 不可觸發),但**無應用層 per-window 限流**,且 `CRON_SECRET` 與 settle-sweep 共用(Vercel cron 單一 env、平台設計)。
  - 若 `CRON_SECRET` 洩漏 → 攻擊者可高頻觸發真告警 → 消耗 LINE/Resend quota + 告警轟炸 Sean(economic/abuse,**非資料外洩**)。**鏡像既有 settle-sweep 範式、非 #250 新增弱點**;Vercel cron 平台側有排程頻率保護。
- **預期解法:**
  - 評估 route 端簡易 per-window 節流(記憶體/DB throttle);或評估獨立 secret(需自訂 header 驗、因 Vercel cron 只帶單一 CRON_SECRET)。
- **不修會痛在:**
  - 可維護性:secret 洩漏面隨 cron 數增長;無限流時單點洩漏放大成告警 DoS。
- **估時:** ~20-30 min(限流 middleware + 測)
- **依賴:** #250 已落
- **發現於:** 2026-07-01 / #250 關卡2 adversarial-reviewer F2 + pcm-security-audit L1 LOW-1
- **相關:** `app/api/cron/anomaly-alert/route.ts`、`app/api/cron/settle-sweep/route.ts`、[[#250]]

---

### #255. 🔧 雙扣告警 per-anomaly 去重(避每輪重推;#250 follow-up)

- **狀態:** ⏳ 待執行(觀察;#250 刻意無去重)
- **優先級:** 🟢 低(daily 頻率下重複推播壓力低)
- **分流標籤:** `P1-before-launch`
- **問題:**
  - #250 `checkAnomalyAlerts` **刻意無 per-anomaly 去重**:未解決前每輪 cron 只要門檻仍踩就再推一次 = 持續提醒(雙扣不可被遺忘的設計取捨)。代價 = 同一筆 open anomaly 每天重複推播到 Sean 處理掉為止。
  - daily 頻率下噪音低可接受;若日後升 hourly(Vercel Pro)或 anomaly 累積,重複推播壓力上升。
- **預期解法:**
  - 去重狀態表(記「已告警的 anomaly id + 首告警時戳」)或 last-alerted 水位,只推「新出現」或「跨 escalation 門檻」的;或每日一則彙總取代逐輪重推。**注意**:去重不得讓「持續未處理」靜默(需保留週期性 re-nag、只是降頻)。
  - 可與 Sean 日後「系統檢測監控面板」(Q2 拍板 heartbeat/平安符歸此)一併設計。
- **不修會痛在:**
  - 可維護性:升頻後重複告警使 Sean 對告警麻痺(狼來了)→ 真新雙扣被淹沒。
- **估時:** ~30-45 min(去重表 migration + use-case 接線 + 測;或併入監控面板)
- **依賴:** #250 已落;Sean 監控面板規劃(Q2 heartbeat 歸此)
- **發現於:** 2026-07-01 / #250 關卡1 adversarial-reviewer F5 + Sean Q2 拍板(heartbeat 歸未來監控面板)
- **相關:** `check-anomaly-alerts.ts`、[[#250]]、Sean 系統檢測監控面板(未來)

---

### #256. 🔴 pending-based 雙扣偵測(GAP2 靜默雙扣盲區治本;#252 二度確認發現)

- **狀態:** 🟢 **已實作(2026-07-01、dev、未 push、未 db push〔migration 20260701130000〕、flag 全 false)**:擴 #250 聚合 RPC 加第 7 計數 `pending_double_charge_candidate_count`(卡住指紋 + 同額 + 12h 窗)+ TS 全鏈 + runbook Report C。真權威 plan `docs/specs/2026-07-01-m3-256-pending-double-charge-detection-plan.md`(codex K1 r1 FAIL→r2 PASS-WITH-CONCERNS)。審查鏈:DDL MCP 零留痕 6 模擬〔S1 卡700s同額=1 / S2 秒扣30s同額=0〔Sean 顧慮解〕/ S3 異額 / S4 超窗 / S5 單筆 =0、殘留0〕+ 三參 overload ACL/effective-priv(含 orders)全 PASS + 三綠 typecheck7/lint10/build1 + vitest 145 檔 1569 + **codex K2 跨模型 PASS-WITH-NITS + adversarial-reviewer PASS / 可 commit + code-reviewer PASS-WITH-NITS**(NIT 全折入:stale 註解三參化 + runbook 多 charged attempt 判讀註)。**下一動 = Sean db push `20260701130000` + 推 dev**。誠實:候選待查證非確認、卡住指紋降誤報非零、退款目標人工查證(GAP2 無 released 錨點)。
- **優先級:** 🟠 中(現行 anomaly 偵測的**唯一結構盲區**、對客人最傷〔靜默多扣〕;flag=false 期間不可達但上線前必補)
- **問題:**
  - #250 anomaly 偵測(open/W1)的**唯一 genesis** = `mark_charge_attempt_charged` 於 `status='released'` 寫主表(`20260624120005:118/128`,全 repo 唯一 `payment_double_charge_anomalies` INSERT)。
  - GAP2(begin-dedup + user_in_flight 兜底漏接:異 cart + >10min + 純 pending 兄弟單)的雙扣,兄弟 late-success 走 `pending→charged`(主軌 `mark_charge_attempt_charged` 或備軌 `..._fallback`,後者護欄 `WHERE status='pending'`)**皆不觸發 genesis** → 零 anomaly → **#250 六計數逐一驗無一抓得到 = 靜默雙扣**(客人被多扣、系統無告警無退款工單)。
  - 二度確認(adversarial-reviewer F1 HIGH + codex + round2)證實,並修正 backlog #252/報告初稿「GAP2 由 anomaly/W1 下游覆蓋」的過度承諾。
- **預期解法(A 治本):**
  - 新增 **pending-based 雙扣偵測**:偵測「同 `customer_user_id` 短窗(如 ≤N 分鐘)內 ≥2 筆 `paid` order」→ 視為雙扣候選、寫 anomaly 主表(或獨立候選表)→ 併入 #250 summary 計數 + 告警。
  - 設計要點:① 與既有 released→charged genesis **互補不重複**(released 路徑已覆蓋、本條補 pending 路徑)② 避免正常「同客人隔日兩筆真實訂單」誤報(窗 + 金額/品項相似度 hint、對齊 W1 sibling 判準)③ SECDEF/RLS/ACL 對齊既有 anomaly 兩表 zero-policy + REVOKE 5 角色 ④ 可與 W1 報表銜接(候選 → 人工查證 → 退款)。
  - 落地後:canonical §14 步45 的「關 flag 縱深(B settle-sweep)」條目降為次要防線(治本上線後盲區關閉)。
- **不修會痛在:**
  - 擴充性:未來 3DS 上線後 GAP2 雙扣**靜默**發生、客人被多扣卻無告警無退款,信任受損 + 客訴。
  - 可維護性:偵測邊界「只認 released→charged」是隱性契約,後人以為 anomaly 全覆蓋雙扣、實則有 pending 盲區。
  - bug 可追蹤性:GAP2 雙扣不進 anomaly 報表,只能靠對帳人工撈「同 user 兩筆 paid」,難溯根因與時間軸。
- **估時:** ~45-60 min(偵測 RPC/掃描 migration + #250 summary 接線 + 測 + 雙審 + DDL MCP 模擬)+ 需 Sean db push
- **依賴:** #250 已落;#252 驗證已完成(2026-07-01);開 prod flag 前(canonical §14 步44)
- **發現於:** 2026-07-01 / #252 begin-dedup 兜底驗證二度確認(adversarial-reviewer F1 HIGH + codex must-fix)
- **相關:** [[#252]]、[[#250]]、[[#255]](去重可一併設計)、canonical §14 步45(B 縱深)、anomaly genesis `20260624120005`、W1 runbook `docs/runbooks/2026-06-26-m3-3ds-double-charge-refund-runbook.md`、驗證報告 `docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md`

### #257. 🟡 RPM 33 商品來源缺圖 → 前台顯 placeholder(資料缺口、非程式 bug)

- **狀態:** ⏳ 待 Sean/RPM 補圖(Claude 端無可修)
- **優先級:** 🟡 低(placeholder 已可看、商品資料本身正確)
- **問題:**
  - live 站 33 個 RPM 商品(如 `rpm-bmsx-03` 頭罩 / `rpm-dmuv201` 儀表板內飾蓋 / `rpm-dpv42536` 尾殼)卡片與商品頁顯 `/placeholder-product.png`。
  - 2026-07-03 唯讀 MCP 雙庫查證:報價單來源 `storefront_catalog_v` 該 33 群 `image_url`/`images` **皆空**(1,117 群中 33 群 groups_no_image、與網站 33 筆完全對上)→ **來源缺圖、re-sync 救不了**。
- **觸發事件:** 2026-07-03 Sean 開站實測回報「幾個商品是舊假圖」(#5 調查拆出 #5a)。
- **預期解法:** Sean/RPM 補該 33 群真圖進報價單側 → 每日同步自動帶上;或 Sean 拍接受 placeholder。
- **不修會痛在:**
  - 擴充性:多品牌放量後「來源缺圖 → placeholder」是常態路徑,需要來源端補圖 SOP,否則每家都累積無圖商品。
  - bug 可追蹤性:缺圖與「假圖 bug」易混(本次即混報),有此條可直接對照 33 清單。
- **估時:** Claude 端 0(資料工作在報價單側);清單可隨時用 SQL 重產。
- **依賴:** 報價單側補圖流程。
- **發現於:** 2026-07-03 / #5 調查。
- **相關:** #5b(HomeSelect 導航修、已修)/ #258。

### #258. 🔴 ProductPage「相關商品」吃 MOCK_PRODUCTS 假資料(多品牌上線即爆的休眠地雷)

- **狀態:** ⏳ 待執行(已納入 Phase 0/Phase 1 gate:`docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`)
- **優先級:** 🔴 高(GB/Bonamici 上架「前」必修;現況休眠無症狀)
- **問題:**
  - `ProductPage.tsx:201-208` 相關商品區塊 = `MOCK_PRODUCTS.filter(同大類)`(20 筆手寫 demo、無 image 欄→必假 Unsplash 圖、slug 如 `lightech-1` 在真 DB 無 handle→點了 404)。
  - 現況不觸發:真商品全在「碳纖維部品」、與 mock 大類(操控部品/精品配件/…)零交集 → `relatedProducts.length===0` 整段不渲染。
  - 🔴 GB/Bonamici 一上架(分類=操控部品等 16 大類)即與 mock 大類**命中** → 所有新品牌商品頁冒出假圖+死連結卡。
- **觸發事件:** 2026-07-03 #5 調查(candidate 2);同日 Phase 0 multibrand plan 獲批。
- **預期解法:** 相關商品改真資料(同分類 Supabase query、排除自身、取 4)或先整段移除待真資料版;於 Phase 1 寫入 prod 前完成(P0-C 或 Phase 1 前置片)。
- **不修會痛在:**
  - 擴充性:多品牌上線被此地雷連坐,每個商品頁尾都是假卡。
  - bug 可追蹤性:症狀(假圖+404)與 #5a/#5b 相似,不記此條會再次混報。
- **估時:** 15-30 分鐘(移除)/ 30-45 分鐘(接真同分類 query)。
- **依賴:** Phase 0 plan(已批);與 #205(featured 旗標)、#220c(品牌側欄)同屬前台目錄接線家族。
- **發現於:** 2026-07-03 / #5 調查 candidate 2。
- **相關:** #212 / #257 / Phase 0 plan §2.6。

### #259. ✅ prod 殘留 `supplier_slug='test'` 測試商品 **正在 live 首頁精選第 1 格對客人展示**

- **狀態:** ✅ 完成 —— **那筆商品已經不在正式庫了,不需要 Sean 再點頭。**
  - **關檔依據(2026-08-11 S 窗正式庫唯讀實查)**:`handle = 'test-1nt-payment'` → **0 筆**;
    `supplier_slug = 'test'` → **0 筆**;可見商品的 `supplier_slug` 共 **16 家、無幽靈供應商**
    (條目擔心的 per-supplier 對賬干擾一併消失)。
  - 清除的時點與執行者本條目沒有記到(2026-07-03 立案 → 2026-08-11 實查已不存在)。
  - 🔴🔴 **給未來的人:不要順手清「測試接線盒」。** 用「測試 / test」搜正式庫,今天只會命中兩筆
    **motogadget 真商品**(`motogadget-1005040` / `motogadget-1005041`,NT 3800 / 4900)——
    那是真的商品名稱(機車電路測試工具),**不是測試資料**。
    本條目標題含「測試商品」,很容易讓下一個人拿關鍵字掃一遍就把真商品刪掉;
    判準是 `supplier_slug` 與 `handle`,**不是商品名稱裡有沒有「測試」兩個字**。
- **優先級:** 🔴 高(已解決)
- **問題:** prod `products` 有 1 筆 `supplier_slug='test'`:「【測試】1元金流測試商品(測完即刪)」handle `test-1nt-payment`。它掛在「碳纖維部品」分類 → 被 `fetchFeaturedProducts`(取該分類前 4)撈中 → **live 首頁「編輯精選」第 1 格就是它**(Playwright 實證 `.ed-select-grid` 第一張卡)。商品名自標「測完即刪」= M-3 金流測試遺留。另:多供應商化後 per-supplier 對賬/統計被幽靈供應商干擾。
- **預期解法:** Sean 點頭 → 單筆 DELETE(或 delisted_at 軟下架)+ 事後唯讀驗證;動作納 Phase 0/P0-D 順手清單。
- **不修會痛在:** 可維護性:per-supplier 報表/reconcile 出現幽靈供應商;bug 可追蹤性:未來查「為什麼有 12 家」浪費一輪。
- **估時:** 5 分鐘(含驗證)。
- **依賴:** Sean 授權(prod 寫入)。
- **發現於:** 2026-07-03 / #5 調查 MCP 盤點。
- **相關:** Phase 0 plan / #257。

### #260. 🔴 試點 description 混批 upsert 會把「省欄」列寫成 NULL(試點寫入前 must-fix)

- **狀態:** ⏳ 待執行(試點 `--confirm-write` 前必修;P0-A-3 乾跑零寫入、暫不觸發)
- **優先級:** 🔴 高(資料完整性、對外可見描述被靜默抹除)
- **問題:**
  - `syncDescription=true` 的試點(gbracing/bonamici),`rpm-transform.ts` 對來源 null/空白描述「省 key」以求不覆寫。但 `rpm-load.ts` `upsertBatched` 走 postgrest-js `.upsert(陣列)`:`?columns` 取**全批 key 聯集** + `defaultToNull=true`(親驗 `PostgrestQueryBuilder.ts:1087-1090`、無 `Prefer: missing=default`)→ 同一批混「有 description」與「省 key」兩種列時,省 key 列被寫 **NULL**(ON CONFLICT DO UPDATE 覆寫),非保留現值。
  - plan §2.9:88 述試點描述覆蓋 ~99.9%、各僅 1 缺 → 必然混批 → 該缺值商品(或日後人工補的描述)每夜同步被靜默抹 NULL。
  - RPM **不受影響**(全批一致 `syncDescription=false` 省欄 → 聯集不含 description → 不觸碰;byte 等價成立)。
- **觸發事件(任一觸發即啟動實作):** 任一試點供應商要跑 `--confirm-write` 正式寫入(Phase 1 試點上架)前。
- **預期解法:**
  - 擇一:① `upsertBatched` 按 key-signature 分批(有/無 description 各自成批);② description 欄改「統一帶 key」(syncDescription=true 時 null 亦顯式帶、語意=source 為權威);③ 傳 `{ defaultToNull: false }` 走 `Prefer: missing=default`(但 missing=default → DEFAULT=NULL,對本欄無效、需搭 DB DEFAULT 評估)。方案 ② 最簡且與「試點新品 source 即權威」一致,但須 Sean 拍板夜跑覆寫語意(保留 vs 鏡射)。
- **不修會痛在:**
  - 擴充性:每加一家 syncDescription=true 供應商都繼承此地雷。
  - 可維護性:「省欄=保留」的直覺與 load 層實際行為相反,除錯者會被誤導。
  - bug 可追蹤性:描述被抹 NULL 無告警(delta gate 只看價格)、要靠客訴或人工比對才發現。
- **估時:** 1-2 小時(含 DDL MCP BEGIN→混批 upsert→驗→ROLLBACK 零留痕實證 + 分批單元測)。
- **依賴:** 併 Phase 1 試點寫入片;方案 ② 需 Sean 拍夜跑覆寫語意。
- **發現於:** 2026-07-03 / P0-A-3 對抗審查(Fable F1 must-fix、postgrest-js 原始碼親驗)。
- **相關:** Phase 0 plan §2.9 / #261 / P0-A-4。

### #261. 🟠 試點 category_id=null 寫入硬 gate + 逐群「未對上分類」dry-run 彙整報告

- **狀態:** ⏳ 待執行(P0-A-4 dry-run 報告 + 試點寫入前 gate)
- **優先級:** 🟠 中(fail-loud 無 corruption,但盲進寫入 = 整批 abort、除錯耗時)
- **問題:**
  - per-group 供應商經 `resolveIdOrNull` 解析分類:P0-B seed 前全 null、seed 後遇空/未登記 major_category_zh 亦 null。`products.category_id` 為 **NOT NULL**(migration `20260507222633:6`)→ null 進 upsert = 23502、該 500 列批全敗(gbracing 186 群單批全滅)。
  - dry-run 目前僅印 `productRows[0]` 樣本(`rpm-import.ts` DRY_RUN 段),**無「未對上分類:N 群 × major_category_zh 值」聚合報告** → 操作者看不到有多少群解析失敗就盲進 `--confirm-write`。
- **觸發事件(任一觸發即啟動實作):** P0-A-4 產試點 dry-run 報告時 / 任一試點 `--confirm-write` 前。
- **預期解法:**
  - dry-run 加印「未對上分類」聚合表(major_category_zh 值 × 群數 + 樣本 handle);
  - 寫入前加 null-category 硬 gate(abort 列清單、或跳過該群並列報、不靜默寫)。
- **不修會痛在:**
  - 擴充性:16 大類外的子類/新值都會靜默落入 null。
  - 可維護性:整批 23502 abort 的錯誤訊息不指向「哪些群沒對上」,除錯要自己撈。
  - bug 可追蹤性:P0-B seed 漏一類 → 該類商品全部寫不進、無彙整線索。
- **估時:** 1 小時(dry-run 報告 + gate + 單元測)。
- **依賴:** P0-B(16 分類 seed)先落地;併 P0-A-4 / 試點寫入片。
- **發現於:** 2026-07-03 / P0-A-3 對抗審查(Fable F2 consider)。
- **相關:** Phase 0 plan §2.3/§2.7 / #260 / P0-A-4。

### #262. 🟡 `rpm-*` 模組/檔名 → 多供應商中性命名(認知成本)

- **狀態:** 🟢 觀察(非阻塞;命名 churn 大、擇低流量時機做)
- **優先級:** 🟡 低
- **問題:** 同步管線(`rpm-fetch/transform/import/load/delta/reconcile/preflight` + `rpm-sync.yml`)P0-A-3 起已由 `--supplier` + supplier-config 全量驅動、非 rpm-only,但檔名/模組名仍 `rpm-*`,新讀者會誤以為只跑 RPM。
- **觸發事件:** 試點正式上架、管線確定長期多供應商後,擇一次低流量時機批次 rename。
- **預期解法:** `rpm-*` → `catalog-sync-*`(或類似中性名)、同步更新 import 路徑 + `rpm-sync.yml` + tsconfig/eslint glob;純機械 rename、行為不變、一次 slice 收。
- **不修會痛在:**
  - 可維護性:檔名與職責不符,新 session 判斷「這是不是只跑 rpm」浪費一輪。
- **估時:** 30-45 分鐘(機械 rename + 三綠)。
- **依賴:** 無(但建議等試點寫入穩定後,避免 rename 與功能改動混 commit)。
- **發現於:** 2026-07-03 / P0-A-3 對抗審查(Fable F5 nit)。
- **相關:** Phase 0 plan §4 / #260 / #261。

### #263. 🟡 非 RPM 商品頁服務橫條 3 卡在 4 欄 grid 留空欄(P0-C-a 去碳後版面、試點上架才可見、Sean 拍板)

- **狀態:** 🟢 觀察(非阻塞;今日 catalog RPM-only、非 RPM 商品頁不可達,試點品牌上架日才可見)
- **優先級:** 🟡 低(視覺品味題、Sean 掌舵)
- **問題:** P0-C-a 去碳把 `ProductServices` 的「泰國原廠 / RPM Carbon 授權代理」卡改**卡級守門**(非 RPM 只剩滿額免運/專業安裝/LINE 諮詢 3 卡);但 CSS `.pd-services { grid-template-columns: repeat(4,1fr) }`(`apps/storefront/src/styles/product-page.css:530-532`)+ 720px 斷點 2×2(`:562`)未隨之調整 → 非 RPM 頁桌機右側留 1/4 空欄、720px 下 2+1 孤卡。OD 模板僅 RPM 4 卡版、3 卡態**無 design 真權威**。
- **觸發事件:** 試點品牌(GB/Bonamici)寫入 prod + 前台目錄接線可見(Phase 1、#205/#220c 之後)。
- **預期解法(Sean 拍板):** `repeat(3,1fr)` 變體 / `auto-fit minmax` / 接受留白 三擇一;屬視覺設計 = Sean 掌舵([[feedback_sean-owns-visual-design]])、Code 不自行 polish。
- **不修會痛在:**
  - UX:非 RPM 商品頁服務橫條版面不對稱(桌機空欄 / 手機孤卡),品牌上架首日客人即可見。
- **估時:** 10-20 分鐘(CSS 單檔 + 720px 斷點調整 + Sean 肉眼驗)。
- **依賴:** 試點寫入 + 前台目錄接線(Phase 1);建議併 P0-C-b 或試點上架前處理。
- **發現於:** 2026-07-04 / P0-C-a adversarial-reviewer(Fable 跨模型 C1 consider)。
- **相關:** Phase 0 plan §2.6/§4 P0-C / #212 / ProductServices manifest business_override(`servicesContent4Conditions`)。

### #264. 🟠 試點變體 spec=NULL → 商品頁 adapter 層整頁 500(P0-C-b2 資料驅動前提、試點寫入前 must-verify)

- **狀態:** ✅ **已治本(2026-07-04)**——adapter `mapVariantRow` harden:`SupabaseVariantRow.spec`/`images` 型別標 nullable + `Object.entries(row.spec ?? {})`/`(row.images ?? []).map()` 防禦,jsonb 來源 null 視為空、不再 throw 整頁 500;3 個新單元測試坐實(spec=null/images=null/兩者 null → 回空、不 throw)。commit(見 git log);完整 vitest 1674 全綠。**雙保險**:匯入端 rpm-transform 仍 `spec ?? {}`(寫入寫 `{}` 非 NULL)+ adapter 讀取端 harden(防歷史/手動 NULL 列)。**原記錄**保留於下,供追溯。
- (原)狀態:🟢 觀察(現行 RPM DB `null_spec=0` 已唯讀驗證、無現存風險;Phase 1 試點寫入才可能觸發)
- **優先級:** 🟠 中(觸發即整頁 500、客人看不到該商品、非明顯錯誤需查 adapter log)
- **問題:** P0-C-b2 非 RPM 規格表資料驅動 `buildSpecRows` + 上游 adapter `mapVariantRow` 皆假設 `variant.spec` 為物件(型別 `UIVariant.spec = Record<string,string>`);但 view `product_variants_public.spec` 型別為 `Json | null`。若 gbracing/bonamici 匯入寫入 `spec=NULL` 的變體列,adapter `mapVariantRow`(`packages/adapters/src/supabase/mappers/product.ts` 約 :232)遇 null 會 throw → 該商品詳情頁**整頁 500**(非只該列 graceful 降級)。前台 `buildSpecRows` 已補 `typeof !== 'string'` 防線,但真正 gate 在 adapter/匯入端。
- **驗證(2026-07-04 唯讀 MCP `bmpnplmnldofgaohnaok`):** `product_variants_public` 9283 變體、`null_spec=0`(RPM 全有 spec、無現存風險)、`empty_spec=1`(空物件 `{}` 安全、buildSpecRows 不吐列)。
- **觸發事件:** gbracing/bonamici 試點 `--confirm-write` 寫入 prod 前。
- **預期解法:** 匯入 transform 保證 `spec` 恆為物件(來源無 spec → 寫 `{}` 非 NULL);或 adapter `mapVariantRow` 對 null 降級為 `{}`(graceful 不 throw)。二擇一、建議匯入端寫 `{}`(對齊 #260/#261 寫入 gate 精神)。
- **不修會痛在:**
  - 上線品質 / bug 可追蹤性:試點某品牌若有 NULL spec 變體,該商品頁上線即 500、客人看不到、且錯誤不明顯(需查 adapter log 才知)。
- **估時:** 10-20 分鐘(匯入 transform 補 `spec ?? {}` + 乾跑驗)、併試點寫入 gate 批次處理。
- **依賴:** gbracing/bonamici 試點寫入(Phase 1);同 #260/#261 寫入前 gate。
- **發現於:** 2026-07-04 / P0-C-b2 adversarial-reviewer(Fable 跨模型 C1 + WOULD-CHANGE-VERDICT)。
- **相關:** #260 / #261 / Phase 0 plan §2.10 / ProductTabs `buildSpecRows` / adapter `mapVariantRow`。

### #265. 🟡 ProductInfo 變體選擇器 + ProductSwatchPreview 泛化(支援非 RPM 規格形狀、P0-C-c 延 Phase 1)

- **狀態:** 🎯 **主體完成(2026-07-04、#267 W2)**——選擇器泛化(RPM 形狀走現行合成維 byte 不變、12 舊測全綠;非 RPM 泛型維 spec key 資料驅動)+ SwatchPreview 非 RPM 降級不渲染;雙審過(code-reviewer + adversarial opus,F1 空值濾除已修、F2 源頭保留字治理)。**剩**:①試點寫入後 Sean 開站肉眼驗(現無非 RPM 真資料頁可看)②hex_color 真色塊(CNC 官方色碼、需報價單 raw_jsonb→網站 metadata→UIVariant 三層鏈路、獨立 slice)。
- (原始狀態)🟢 觀察(非阻塞、非去碳;去碳已由 P0-C-a/b1/b2 完成、ProductInfo 無寫死碳纖字)。Sean 2026-07-04 拍 A 延 Phase 1。
- **優先級:** 🟡 中(bonamici 上架前必做,否則其顏色變體顧客選不了)
- **問題:** ProductInfo 變體選擇器目前寫死 RPM 形狀 —— `Dim='pattern'|'finish'`、pattern=weave+special 合併(`patternKey`)、WEAVE_LABEL/FINISH_LABEL/SPECIAL_LABEL + 固定排序(WEAVE_ORDER/FINISH_ORDER)。非 RPM 規格形狀(bonamici `{color,material}`)→ `variantDimValue` 讀不到 weave/finish → specGroups 全空 → **選擇器不渲染**(非 crash、但顧客選不了顏色)。ProductSwatchPreview(選擇器預覽卡)亦為 RPM 紋路樣品圖形狀,非 RPM 變體(無 weave)可能顯 fallback / RPM 碳纖樣品圖 → 潛在去碳-adjacent 洩漏(需 Phase 1 真資料時驗)。
- **觸發事件:** bonamici(色彩變體)/ 其他多規格軸品牌試點上架(Phase 1)。
- **預期解法(Phase 1、有真資料時做):** 選擇器泛化為資料驅動 —— 依 variant spec 實際 key 動態產生維度(🔴 **RPM 維持 pattern=weave+special 合併 + 排序 byte 不變**;非 RPM 讀 color/material… + label map);ProductSwatchPreview 對非 RPM 降級(無 weave → 不顯 RPM 碳纖樣品、或改通用色塊)。RPM byte 不變是硬約束。
- **不修會痛在:**
  - 功能 / 轉換率:bonamici 等多規格品牌上架後,顧客無法在頁面選顏色/材質(只能 LINE 問)。
- **估時:** 60-90 分鐘(選擇器泛化 + ProductSwatchPreview 降級 + 測 + 雙審;RPM byte 不變高風險、需真資料肉眼驗)。
- **依賴:** bonamici 試點寫入(Phase 1)—— 有真顏色變體才能建 + 驗(現在盲改 RPM 選擇器風險高、無法驗非 RPM,故 Sean 拍延)。
- **發現於:** 2026-07-04 / P0-C 去碳收尾(ProductInfo 無碳字、picker 泛化非去碳、Sean 拍 A 延 Phase 1)。
- **相關:** Phase 0 plan §2.5/§4 P0-C(§125)/ #212 / ProductInfo DIM_LABEL / ProductSwatchPreview / #264。

### #266. 🟠 gbracing 25 筆 handle charset(小數點/空格/斜線)→ 寫入模式 abort 整批(試點寫入前 must-fix)

- **狀態:** 🟢 觀察(P0-D 全量乾跑首次揭露;dry-run 只列清單不阻,`--confirm-write` 才 abort 整批 gbracing)
- **優先級:** 🟠 中(不處置則 gbracing 整批無法寫入 prod、試點卡關;非正確性/安全風險)
- **問題:** gbracing 942 群中 25 個 SKU 產生的 handle 含 URL 危險字元,F4 handle preflight(`rpm-import.ts:215`)寫入模式會 throw abort 整批。三類:① **小數點**(~19 筆,螺牙規格件牙距,如 `M10X1.25`→`gbracing-m10x1.25`、`M12X1.25X40`)② **空格**(5 筆:`M6 HEX HEAD`/`M6 TORX`/`M6 COUNTER SINK`/`M6 SOCKET CAP HEAD`/`M12 ZINC CAP HEAD`)③ **斜線**(1 筆:`FS-CBR600-2008-R/L`,R/L=左右)。均為五金螺絲件(非主力商品線)。bonamici 全過(底線已由 P0-A-4c 放寬)。
- **驗證(2026-07-04 P0-D 乾跑、唯讀):** gbracing dry-run handle preflight 報告「🔴 25 筆問題(charset 25 / 批內重複 0 / target 撞 0)」逐筆列出;報告存 `docs/reviews/2026-07-04-p0d-dryrun-validation-report.md` §5-A。
- **觸發事件:** gbracing 試點 `--confirm-write` 寫入 prod 前。
- **預期解法(Phase 1、Sean 擇一):**
  - **A** handle 正規化:小數點/空格/斜線 → 移除或轉 hyphen(需重跑 preflight 驗正規化後無新碰撞;handle 偏離原 SKU、SEO key 較不直觀)。
  - **B** 修來源 SKU:報價單 B 庫清這 25 筆 SKU(handle 對齊 SKU、根治;但動來源、須 Sean 協調報價單端)。
  - **C** 排除試點:這 25 群排除、先上 917 群(最小風險、最快上線;25 群留後續處理)。
- **不修會痛在:**
  - 上線進度:不處置則 gbracing 無法 `--confirm-write`(F4 fail-closed abort 整批),試點卡在 gbracing。
  - 資料一致性:handle 若走 A 正規化,須保留 SKU 於 external_id、handle 僅 SEO key(現行架構已如此、風險可控)。
- **估時:** A/C 約 20-30 分鐘(改 handle 正規化或加排除清單 + 重跑乾跑驗);B 視報價單端清理工時。
- **依賴:** gbracing 試點寫入(Phase 1);同 #260/#261/#264 寫入前 gate。
- **發現於:** 2026-07-04 / P0-D gbracing 全量乾跑驗證(前序 P0-A-4b 部分乾跑未觸及全量 handle;P0-A-4c 只處理 bonamici 底線)。
- **相關:** #260 / #261 / #264 / Phase 0 plan §4 P0-D(§129)/ `rpm-import.ts` F4 preflightHandles / `scripts/rpm-preflight.ts`。

### #267. 🔴 報價單源頭變體模型不完整 → 4 家 75 群 pv_spec 碰撞(放量 Phase 3 前 gate、跨專案報價單側修)

- **狀態:** 🎯 **Q 線(報價單源頭)全部完成(2026-07-04)**——合約引擎+CNC 合併(同 var_code=同料通則、兩輪 DB 遷移 139 聚合全收斂、CNC 4549→4376)+三家 spec 補值 12 群全修+規範落地(報價單 repo 5 commit:ed00561/2ecc9b0/63ae109/72e0527/eeb34d8、未 push)。**四家 fetcher 已落地驗證(2026-07-04)**:bonamici/materya/cncracing 合約掃描 0 違規(目標 12 群歸零)、CNC 冪等(4376 列不變、CA210 10 色 sku=var_code 完好);eazigrip 目標 4 群(CENTREPAD design)已修,但曝光存量債 137 筆 → **#268**。剩 W 線(網站側:W1 重乾跑/W2 #265/W3 變體圖)。真權威:`docs/specs/2026-07-04-variant-model-unification-plan.md`(含全部拍板與遷移記錄)。
- (原記錄)方向已拍(2026-07-04 Sean:**Q1=A 源頭統一修**、本 session Fable 領頭多代理跨兩專案;盤點=唯讀 MCP 全 11 家掃描;非阻塞 Phase 1 試點〔僅 bonamici 3 群〕、阻塞 Phase 3 放量〔cncracing 63 群〕)
- **🔴 Sean 拍板(2026-07-04、產品知識):** CA210 型 = 報價單**刻意合併**主料號(顯示方便、多顏色/特仕版+適用多車款)→ 網站呈現 = **一個商品、多種版本(變體)**:顏色/特仕版(Pramac、Troy Bayliss…)= 變體軸;**車型不拆商品、進 fitments 聯集**。修法必須保留報價單合併顯示、同時讓網站變體可區分。
- **🔴 Sean 四個注意點(plan 驗收項):** ① 網站變體圖片依規格點擊連動(選色→圖跟著換)② 既有報價單 quote.pcmmotorsports.com 功能零影響 ③ 報價單側立規範/修 skill 或備註,防之後新增品牌重蹈(統一性)④ 每日同步撈到新產品能否順利自動上架完整。
- **優先級:** 🔴 高(放量前必解;不解則 cncracing 等家整批寫入被 pv_spec_unique gate abort、或客人看到分不出的重複變體)
- **問題(根因=報價單 DB `storefront_catalog_v.spec` 不完整、非網站/匯入端):** 全 11 家掃描,變體存法**不統一**(三型:full-spec / null-spec / empty `{}`)。多變體群中 `spec` 無法區分變體的碰撞群 **75 群集中 4 家**:cncracing 63 / materya 5 / eazigrip 4 / bonamici 3(rpm 1117 多變體群 / lightech 1184 / samco 709 **0 碰撞** = 源頭做得到正確存)。**真重複 SKU = 0**(全部是真不同商品、無去重案例)。兩類根因:
  - **A. fitment-as-axis(cncracing 主導、56/63 群加 `vehicle_label` 即區分):** SKU 中段 `_01/_02/_03` = 不同車型(實例 CA210 黑色同價 9500,`_01`=Panigale V4 / `_02`=Streetfighter V4 / `_03`=Diavel V4),但 `spec` 只存 color、車型軸沒進 spec(車型其實已在 `vehicle_label`/`fitment_parsed`)→ grouping 把不同車型併一個 main_sku、pv_spec 看到重複顏色。
  - **B. spec 值缺漏/壓縮(bonamici/eazigrip/materya + cncracing 其餘 7):** 真軸在 SKU 尾碼但 spec 沒存好——bonamici CHAD18 `{color:null}`(值沒填)/ PU_001 8 色 `{color:黑色}` 全同(值填錯)/ eazigrip CENTREPAD 8 design 壓成 `{design:"Various"}` / materya C-N 尾碼 `{}` 空。
- **不修會痛在:**
  - 上線進度(放量):cncracing 等家 `--confirm-write` 撞 pv_spec_unique 整批 abort。
  - 客人體驗:若放寬約束強寫,客人在商品頁看到 3× 個「黑色」選項(實為不同車型/款式)分不出、選錯 → 退貨。
  - 統一性(Sean 關切):每家源頭編碼不同(SKU 中段/尾碼/vehicle_label),無統一變體模型 → 每家匯入都要 bespoke 補丁 = 碎片化。
- **預期解法(方向待 Sean 拍、跨專案 pcm-quote-v2 為主):**
  - **A 源頭統一變體模型(推薦、根治):** 報價單 parser 定「spec 必完整區分每個變體」規範 + 修 4 家;fitment 型(cncracing)決定「拆成 per-車型商品」或「fitment 併入變體身分」;值缺漏型補真值。放量統一性最佳。
  - **B 源頭僅補值(不定規範):** 只修這 75 群資料、不立規範,快但會復發。
  - **C 下游匯入端吸收(不推薦):** 匯入把 SKU 尾碼合成進 spec 避碰撞,快但每家 heuristic 脆弱、客人看到醜變體標籤 = Sean 要避的碎片化。
- **估時:** A 需報價單側 parser 專案(逐家、Sean + pcm-quote-v2 session);B 資料清理數小時;C 匯入端每家 heuristic。
- **依賴:** Phase 3 放量前必解(Phase 1 試點 bonamici 3 群可先一次性處理、不卡)。跨專案:根因與修法在報價單 `pcm-quote-v2`(fetcher/parser),非本 repo。
- **發現於:** 2026-07-04 / P0-D 延伸(Sean 要求盤點其他品牌變體存法、判斷源頭是否需修)。
- **相關:** #264(spec=NULL→adapter 500 下游症狀)/ #265(選擇器泛化)/ Phase 0 plan §5 C3 / bonamici spec 碰撞 3 群 / P0-D 報告 §5-B。

### #268. 🟠 eazigrip 137 筆 + lightech 39 筆變體合約存量債(#267 合約掃描 gate 首掃曝光、報價單側)

- **狀態:** ⏳ 待執行(2026-07-04 #267 Q 線收工驗證時曝光;三型問題已定位、修法在報價單 repo)。**Sean 拍板(2026-07-04 Q2=A):入 backlog、該兩家(eazigrip/lightech)上架前再修,不安排近期專輪。**
- **優先級:** 🟠 中(兩家皆非網站近程上架線、不擋 Phase 1 試點;但掃描 gate 基線殘留 176 筆噪音會淹沒新品牌違規 = gate 信噪比劣化)
- **問題(三型、全部 active 列非殘影、驗證=唯讀 SQL + 合約掃描 2026-07-04):**
  1. **eazigrip CENTREPAD 40 筆 mergeable_duplicate(8 撞號群):** 來源 feed 本身兩種 SKU 命名並存(舊式 `EVOCENTREPADABL` vs 新式 `EVOCENTREPADABLBLK`),兩列同 spec 同價、都在 feed 活著(last_synced 2026-07-04)。Q3 修好 design/color 解析後重複才被看見。修法=fetcher 端合併(類 CNC `merge_color_variant_rows`)或向 feed 端確認 canonical SKU。
  2. **eazigrip HOSE/WRAP 97 筆 incomplete_spec:** 主 SKU 列 spec=`{}` 空、色彩變體列正常(例 `HOSEBMW001`=`{}` vs `HOSEBMW001BLUE`=`{color:Blue}`)。主列語意需查 feed:是「標準色可買品」該補 spec、還是「父列」該踢出變體群,不可瞎補。
  3. **lightech FTR* 39 群 incomplete_spec:** fetcher 寫出 `"color": null` 違反省 key 規範(`version` 軸有值:標準版/R 版/W 版可折式)。修=fetcher 省略 null key(一行)+ 下次排程自然收斂,最便宜。
- **不修會痛在:**
  - 上線進度:eazigrip/lightech 於 Phase 3 上架時撞 pv_spec gate 整批 abort(同 #267 原始症狀重演)。
  - 可維護性:`variant_contract_scan.py` 是 NEW_SUPPLIER_ONBOARDING 上線 gate,基線 176 筆殘留 = 新品牌違規混在噪音裡看不見,gate 形同虛設。
  - 客人體驗:eazigrip CENTREPAD 重複 SKU 若上架 = 同商品出現兩次。
- **估時:** lightech 約 20 分鐘(一行+測試);eazigrip mergeable 需 merge 設計約 1-2 小時;HOSE/WRAP 主列語意查證後定案。
- **依賴:** 修法全在報價單 repo(fetchers/eazigrip_codes.py、lightech fetcher);落地需跑該家 pipeline(Sean 或 launchd 排程)。
- **發現於:** 2026-07-04 / #267 四家 fetcher 落地後首次全站合約掃描(bonamici/materya/cncracing/gbracing/rpm/samco/evotech/front3d/motogadget 全 0 違規)。
- **相關:** #267(合約引擎與掃描器出處)/ 報價單 repo `scripts/variant_contract_scan.py`、`docs/NEW_SUPPLIER_ONBOARDING.md` ③段第4點。

---

### #269. 🔗 首頁殘餘死連結:~~/install /stores~~ + ~~?filter=new~~|~~sale~~

- **狀態:** ✅ **2026-08-11 全數解決**(當日先拆兩半、依賴不同、非縮範圍;a/b 兩半都已完成)
  - **269-a `?filter=sale`(特價)= ✅ 完成** —— Sean 拍板「特價概念還不存在」⇒ **入口全數移除**,
    不做篩選。移除清單、恢復條件、刻意保留的樣式鉤子 → **見 #390**。
    同片一併移除 `lib/sort-options.ts` 的「折扣優先」(同樣是白名單外的靜默 no-op)。
  - **269-b `?filter=new`(新品)= ✅ 2026-08-11 全案完**(段一 migration `20260811040000` 已 apply、
    過六格真 anon 閘 + T+20 複跑;段二接線 `84a497ed` 已收割入 dev)
    —— Sean 定義「新品 = 本週新增的商品」、**要做真的篩選**。
    🔴 **本條以下多處寫於落地之前、時態是「還沒做」**,當歷史讀;現行行為以
    `lib/catalog-query.ts` 與 `lib/products.ts` 的註解為準。
    🔴 **段二審查未折的三條**:MF-2 跨頁快取分裂 → 判定併 **#393**(同根 = OFFSET 無跨請求快照,
    探查解決不了)/ MF-8 區段件數無守門 → **已補**(`FilterSide.test.tsx` 的
    「#269-b Q21=B」describe;刻意沒照字面併進 #306 的 helper,理由寫在那裡)/
    MF-10 `database.types.ts` 缺 `p_new_since` → **待 D 重 regen**,S 窗不動生成檔。
    - **Sean 2026-08-11 晨批**:`Q15 = C` 排除供應商批次、門檻 **N = 500 起手**
      (明文「**N 可調、委任 S 窗**」);`Q15b = rolling 近 7 天`(不是自然週)。
    - 🔴 **實際落 N = 100(委任範圍內的調整,不是改拍板)**,兩個獨立理由:
      ① 匯入器 `scripts/rpm-load.ts:15` 是 `BATCH_SIZE = 500`,門檻若寫成 `> 500` 則
      「剛好一批 500」永遠不會被判為批次日 ⇒ 比較改成 `>=`、門檻也拉離 500 這個數字。
      ⚠️ **我原本在這裡寫的「不變量:門檻必須嚴格小於 BATCH_SIZE」是錯的,已撤回**
      (codex R2 抓到):500 是**每批送出的列數**,不是**新建的列數**;那批 500 列若只有
      99 筆是新品,那天就只增加 99 列、不到門檻 ⇒ 推不出「不會露半批」。
      🔴 **誠實殘留**:匯入進行中,該台灣日累計跨過 N 之前,已寫入的那些會**短暫出現在新品頁**、
      跨過後整天一起消失。N 小只縮短曝光窗、不是消掉;要真消得換判準(爆量指紋/匯入旗標)=**要問 Sean 的題**。
      ② 全歷史 22 個有商品進來的日子(**只數 visible**,因為批次日 CTE 讀的是已被 RLS 濾過的 view):
      16 天 <30 件(最大 = 7/21 的 **18 件**)、**30–185 件是 0 天**、≥186 件 6 天
      ⇒ 真正的空隙是 **18 → 186**,100 坐在正中。
      ⚠️ **這個數字我前後錯三次、錯法不同**:①N=500 時的「正常日最大 29」只掃近 60 天卻寫成全域事實
      (時間軸作用域錯);②全歷史撈出 2026-06-03 的 **186 件**(2 個時戳、同一 supplier、差 0.44 秒
      = 機器批次)⇒ N=200 會讓它整批漏進新品;③「天花板 29」是**含下架**的計數、判準只數 visible
      ⇒ **母體錯**,正確是 **18**。共同根:**引用統計前要先答「這是哪個母體、哪段時間」**。
    - **段一 = `supabase/migrations/20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql`**:
      view 加 `created_at`、RPC **DROP 10 參數簽章改建 11 參數版**(加 `p_new_since`)、
      `p_sort='new'` 走 `created_at DESC`。新參數有預設值 ⇒ 現行呼叫端零改動照跑,
      所以段一可先於段二上庫(跨 apply 停點紀律)。
    - 🔴 **段二解鎖硬閘**:apply 後用**真 PostgREST anon**量**五格**
      (① 不帶 `p_new_since`+recommend ② 不帶+recommend+**車輛分支**(facet 一次 fan-out 最多 108 次、
      最可能被新 CTE 放大的路徑)③ 不帶+`sort=new` ④ 帶 `p_new_since` ⑤ 帶+車輛)全 <3s 才接線。
      `products.created_at` **無索引**、anon 逾時是 **3s 不是 8s**。
      沒過 ⇒ 開索引 migration(**不能用 `CREATE INDEX CONCURRENTLY`**,本 repo migration 走交易),
      **不是先接 app**。
    - **Sean 2026-08-11 `Q19 = B`**:**照現版上 + 另立 backlog 換寫入端標記** ⇒ 債 = **#395**。
      🔴 **翻面缺陷**(某天 99 件全顯 → 第 100 件進來全消失 → 下架一件又全部回來)= 已知且已拍板,
      不是待辦的疑慮。四症同根(邊界翻面 / 下架改變歷史判定 / `created_at` 是建列時間非上架時間 /
      部分匯入曝光)與修法方向全在 **#395**。
      ⚠️ **`20260811040000` 檔頭第 127 行的「已整理成決策題回報」是過期字面** —— 那題已由 Sean
      拍 Q19=B。該檔已凍結送審且 R4 PASS,**不為一句註解解凍**;以本條為準。
    - ⚠️ **審查員觀察(留檔,不另立條目)**:商品**下架後再復架**永遠不會再出現在「新品」——
      `created_at` 不會因復架而更新。這是 `created_at` 語意的固有結果,不是 bug,同樣併入 #395 一起解。
    - **Sean 2026-08-11 `Q18 = A`**:040000 **照常 apply(離峰時段)**,apply 後立刻跑五格閘,
      任一格爆 = 馬上開 rollback migration。
      🔴 **但「爆了怎麼辦」要分格,不能一律 rollback**(Fable R4 F2):
      | 爆的格 | 那條路徑今天有人在用嗎 | 動作 |
      |---|---|---|
      | ①② 不帶 `p_new_since`(含車輛分支) | **有**,就是現行正式站型錄 | **rollback**(照 Q18=A) |
      | ③④⑤ `sort=new` / 帶 `p_new_since` | **沒有**,段二還沒接線 | **開索引片、不接段二、不 rollback** |
      ③④⑤ 爆代表「新功能還不夠快」,不代表既有功能壞了;此時 rollback = 零收益的自毀。
      🔴 **爆之前先分辨錯誤碼**(F3):`57014 canceling statement due to statement timeout` = 真的慢 ⇒ 照上表;
      `PGRST202`(schema cache 找不到函式/參數)= **只是 PostgREST 沒 reload** ⇒ 重送 `NOTIFY pgrst, 'reload schema'`,
      **不是 rollback**。兩者都是 HTTP 500,不看碼會把後者誤判成前者而白白回捲。
      🔴 **T+20 分鐘要再跑一次格②**(F4):`CATALOG_REVALIDATE_SECONDS = 900`(products.ts:120)
      ⇒ apply 後最長 15 分鐘流量才全部換到新函式。**T+2 分鐘全綠不等於滿載下存活**,
      早期樣本大多還打在舊快取上。
      🔴 **apply 一律走 `supabase db push`,不要貼 Supabase SQL Editor**(F5):
      貼 Editor 會讓 migration ledger 與正式庫失同步(DDL 生效但沒登記),
      之後任何人重跑都會撞到 040000 檔內那段「已生效但未登記」的診斷訊息。
      🔴 這題會存在,是因為**真函式的效能在 apply 前量不到**(函式要 apply 後才存在)——
      apply 完成的瞬間正式站流量就開始吃新函式,而閘是 apply 之後才跑 ⇒ 中間有空窗。
      該殘餘風險**由 Sean 拍板承擔、不是 S 窗自宣接受**(未採:B=先在 Supabase branch 量、C=索引一起上)。
    - ⚠️ **本條原本寫「正常日 ≤29、500 落在空隙正中」——那句是錯的,已更正**:
      29 既是**近 60 天**的最大值、又是**含下架**的計數(判準只數 visible ⇒ 正確天花板 **18**)。
      全歷史還有 2026-06-03 的 **186 件**(2 個時戳、同一 supplier、差 0.44 秒的機器批次)。
      真實分佈=22 個有商品進來的日子裡,16 天 <30 件、**30–185 件 0 天**、≥186 件 6 天 ⇒ 空隙是 **18 → 186**(visible 母體),故 N=100。
      產生這些數字的查詢留在 `scripts/269b-evidence.sql`(唯讀可重跑)。
    🔴 它**不是純前端**:目錄列表走 RPC `search_catalog_by_vehicle`,實查它回的 `item` jsonb
    13 個鍵**沒有 `created_at`**(`products_list_public` view 也沒有)⇒ 要動 RPC 投影或加參數
    ⇒ **鐵則 12③ migration 片**,排在 #277 段二旁邊。
    ~~⚠️ 排序下拉的「最新上架」(`sort-options.ts` 的 `value: 'new'`)**今天也是假的**~~
    ✅ **已於段二加進 `CATALOG_SORT_VALUES` 白名單、是真的排序**(RPC `p_sort='new'` → `created_at DESC`)。
    **若 269-b 被 rollback,那一行要跟著拿掉**(綁定關係寫在 `catalog-query.ts:1-5`)。
  - 🔴 **269-b 的失效條件(plan 與問 Sean 時都要帶)**:`created_at` 是「進我們 DB 的時間」,
    不是「這台車新上市」。實查:近 7 天新增 = **25 筆**(合理),但 **2026-07-24 一天灌了 6,188 筆**、
    07-19 灌了 648 筆 ⇒ **供應商上架週會讓「本週新品」瞬間變成六千筆**。
    照 Sean 字面(本週新增)做是對的,但要用**具體情境**問他:
    「上架週那七天新品頁會是六千筆,要不要加上限或排除供應商批次?」
- **🔶 2026-08-06 全站重設計第2批解除一半:**
  - `/install`、`/stores` 兩條路由**已建**(`app/install/page.tsx`、`app/stores/page.tsx`),
    掛設計端的「新功能即將上線」頁(`ComingSoon` 元件)⇒ 上表 `/install` 3 處、`/stores` 3 處
    共 6 個連結**全部不再 404**,`Header.tsx` 那兩顆(全站每頁都有)也一併活了。
  - 🔴 **本條剩下的範圍 = 只有 `?filter=new|sale`**(4 + 2 = 6 個連結,仍點了無效果)。
  - ⚠️ 這兩頁目前是「即將上線」佔位,不是完整的店家 / 安裝頁 —— 完整稿(`stores-page.html`、
    `install-page.html`)設計端保留著,等 Sean 給店家名單與工時費率才切回(見該兩支 page 檔頭)。
- **優先級:** 🟡 低
- **問題:**
  - Q4-S5(2026-07-05)修首頁「分類卡無過濾 + 品牌牆 404」時順帶掃出**其餘死連結**(本輪 scope 外、未動):
    - `/install`、`/stores` → 路由不存在 = 404。
    - `?filter=new` / `?filter=sale` → 全站無人讀 `?filter=`(products-url-state 只讀 sort)→ 點了無效果。
  - 🔴 **2026-08-05 D5a 重數,原本的出處清單漏了兩個元件**(原寫「`/install`(HomeFooter)、
    `/stores`(HomeFooter)」「`?filter=new`(HomeHero/HomeSelect/HomeFooter)」,並自稱「本條已列全」——
    **那句是假的**)。首頁服役 HTML 精確 `href="..."` 比對(production build,**已排除 RSC flight payload
    的重複字串** —— 直接數原始出現次數會多算,`?filter=new` 原始 7 次但真 href 只有 4 次):

    | 連結 | 首頁實際 href 數 | 出處 |
    |---|---|---|
    | `/install` | **3** | `Header.tsx:115` / `HomeStatement.tsx:40` / `HomeFooter.tsx:59` |
    | `/stores` | **3** | `Header.tsx:116` / `HomeStatement.tsx:44` / `HomeFooter.tsx:60` |
    | `/products?filter=new` | **4** | `Header.tsx:113` / `HomeHero.tsx:29` / `HomeSelect.tsx:47` / `HomeFooter.tsx:54` |
    | `/products?filter=sale` | **2** | `Header.tsx:114` / `HomeFooter.tsx:55` |

    ⚠️ `Header` 是**全站**共用 ⇒ 那兩顆不只首頁有,每一頁都有;修法要一起算進去。
    另 `ProductBreadcrumb.tsx:63,65` 也產 `?filter=` 連結(商品頁麵包屑),不在首頁但同一條契約債。
- **觸發事件:** 上線前完整首頁點擊審(或 Sean 指定)。多品牌上線後瀏覽量增、踩到機率上升。
- **預期解法:**
  - `/install`、`/stores`:建對應資訊頁(仿 `/info/shipping`)或暫移除連結(需 Sean 定內容)。
  - `?filter=new|sale`:products-url-state 加 `?filter=` 解析 → 對映 SortBar 'new'/'sale' 或 isNew/isSale extra filter(與 sort/vehicle/category/brand 入站 idiom 一致)。
- **不修會痛在:**
  - 擴充性:未接的 `?filter=` 是半成品 URL 契約,新頁面沿用會複製壞連結。
  - 可維護性:死連結散落多元件,愈晚修愈難盤點 —— **本條 2026-07-05 自稱「已列全」但實際漏了 Header 與 HomeStatement**,正是這個風險的實例。
  - bug 可追蹤性:客人回報「點了沒反應/404」時無單一出處對照。
- **估時:** ?filter 接線 ~20min;/install /stores 視內容頁範圍(需 Sean 定)。
- **發現於:** 2026-07-05 / Q4-S5 首頁死連結修復(recon §5)。
- **相關:** #147(首頁真資料化族)/ #205(featured/目錄接線)。

---

### #270. 🔗 RPM 商品內容連動報價單(目前兩層寫死、要接真同步)

- **狀態:** ⏳ 待執行(gate:報價單翻譯優化完成後)
- **優先級:** 🟠 中(Sean 2026-07-05 明確要 RPM 也連動)
- **問題:** gbracing/bonamici 的內文已連動報價單(改翻譯→隔天同步→前台顯);**RPM 沒有,且是兩層凍結**:
  1. **DB 同步層**:`scripts/supplier-config.ts` rpm `syncDescription=false` → 每夜 cron **不**把來源繁中描述寫進 `products.description`(現存英文 HTML 原地保留;F2/#260 保護縫)。**注意 RPM 品名 title 是無條件同步的(product_name_zh 會流)**,凍結的只有**描述**。
  2. **前台顯示層**:`apps/storefront/src/components/ProductTabs.tsx` 商品介紹 `isRpmCarbon` 分支渲染**寫死碳纖維框架**(「採用真碳纖維材質…」),**完全不讀 `product.description`**(Sean Q1 拍板碳纖框架、與非 RPM 分支渲染真描述不同)。→ 即使 DB 有描述,RPM 頁也不顯。
- **觸發事件:** Sean 2026-07-05 交接時要求「RPM 翻譯寫死但要連動」;報價單側正在優化 RPM 繁中翻譯(完成後啟動)。
- **預期解法(兩步 + 一個 Sean 決策)**:
  1. **DB 同步**:rpm `syncDescription=true`(執行既有 **Q4=B「RPM 描述切繁中」**拍板)。🔴 **鐵則 12 事件**:下次夜跑會把 ~1,117 RPM 頁英文描述覆寫成來源繁中(對外可見)、須產 Codex Packet + Sean 批 + 先確認報價單 RPM 繁中翻譯品質 OK。
  2. **前台顯示(Sean 決策)**:RPM 商品介紹是否由「碳纖維框架」改渲染 `product.description`(對齊非 RPM)?—— 這會**移除**Sean Q1 拍板的碳纖 brand-story 框架;或折衷(框架 + 真描述並存)。**Sean 拍板才動**(視覺/品牌敘事、R6 品味題)。
  3. 只做 (1) 不做 (2) = DB 有繁中描述但 RPM 頁仍顯碳纖框架(沒意義);兩步都做才真正「連動且顯示」。
- **不修會痛在:** 擴充性—RPM 內容永遠與報價單源脫節、Sean 改翻譯 RPM 不動;可維護性—RPM/非 RPM 兩套描述路徑分歧;bug 可追蹤性—「改了報價單 RPM 沒變」會被當同步 bug 反覆查。
- **估時:** DB 同步切換 ~15min(+ 鐵則 12 Packet + re-sync 驗);前台顯示視 Sean 決策(小改~30min / 折衷設計另議)。
- **依賴:** 🔴 報價單側 RPM 繁中翻譯優化完成(Sean 進行中);跨 repo 協調見下方交接建議。
- **發現於:** 2026-07-05 / 上架後交接(Sean 問 RPM 連動)。
- **相關:** #260(描述 NULL 語意)/ Q4=B(RPM 描述切繁中拍板)/ 多品牌 plan §2.9 F2。

---

### #271. 🏁 品牌形象區信任狀/徽章數字後台化(目前 L2 hardcode)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - GB Racing 信任狀四格(創立 2007 / FIM 認證 2009 / 2 項英國專利 / 支援 450+ 車型)與 Bonamici N°02 徽章(20 年精工 等)屬「年度/車型數會變」的內容,目前 hardcode 於 `GbRacingShowcase.tsx`(N°02 pd-gb-stat)/ `BonamiciShowcase.tsx`(S5、pd-bona badge)。L2(鐵則 9)、無後台 CRUD。
- **觸發事件(任一觸發即啟動實作):**
  - 任一數字過時需更新(支援車型數增長、專利數變動、年資遞增)且不想改 code 重發版時。
  - 品牌形象區擴增到第 3 個以上品牌、數字散落多檔難維護時。
- **預期解法:**
  - 最小做法=集中到單一 `brand-showcase-content.ts` 常數檔先收斂(降散落);完整=進後台品牌內容表(brand_showcase_stats 或並入既有品牌設定)、元件改 data-driven。
- **不修會痛在:**
  - 擴充性:每加一個品牌形象區就多一份散落 hardcode 數字、無單一真相。
  - 可維護性:數字過時要工程改 code + 重發版、非營運可自助;多品牌後成本線性上升。
  - bug 可追蹤性:數字散在各 Showcase 元件、對不上「哪個數字該幾」的單一來源。
- **估時:** 常數檔收斂 ~0.5h;後台化 2-4h(需 schema)。
- **依賴:** 無(可先做常數檔收斂、後台化待多品牌放量)。
- **發現於:** 2026-07-09 / #270 B S4(code-reviewer + 鐵則 9 L2 判定)。
- **相關:** #270(RPM 內容連動)/ 鐵則 9 L2 / GbRacingShowcase.tsx / BonamiciShowcase.tsx(S5)。

---

### #272. 🔒 rpm-import 大改組情境 F3 雙旗標互斥 deadlock(下架 >10% 且縮編 >5% 時 CLI 走不完)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(#267 W 線每家供應商收斂上線時都會再撞)
- **問題:**
  - 報價單大改組(如 #267 變體統一合併重複頁)會同時觸發兩道安全閘:抓取完整性(縮編 >5%、需 `--allow-fetch-shrink`)+ 下架對賬(>10%、需 `--allow-large-delist`);但 F3 護欄(rpm-preflight `assertBypassFlagsExclusive`)禁止同一次帶兩支旗標 → CLI 內任何組合都走不完(單帶 shrink=寫入成功但下架 abort;單帶 delist=preflight 先擋)。
- **觸發事件:**
  - 2026-07-10 bonamici #267 合併同步(1252→590 群、663 重複頁下架):乾跑/人工雙驗證合法後仍 deadlock,最終以一次性腳本(scratchpad、複用 computeDelist/applyDelist + 硬斷言 590/663)分步完成。
- **預期解法:**
  - 方案 A:新增 `--restructure` 模式=兩道閘各自要求「乾跑報告 hash 確認」後單次走完(保留 F3 對盲寫的防護、把「已看過乾跑」變成機器可驗的前置)。
  - 方案 B:分步官方化——`--allow-fetch-shrink` 寫入後,提供 `--delist-only --allow-large-delist` 子模式(preflight 跳過、只跑對賬段)。
- **不修會痛在:**
  - 擴充性:#267 W 線 cnc/lightech/samco…每家收斂上線都要再手寫一次性腳本(易抄錯 scope=誤刪別家)。
  - 可維護性:一次性腳本散在 scratchpad、不在 repo 審計軌內。
  - bug 可追蹤性:cron 在來源收斂後會每日 preflight abort(非零退出)直到有人手動分步,告警噪音掩蓋真異常。
- **估時:** 0.5-1 天(含測試兩情境:正常同步不受影響 / 大改組走新路)。
- **依賴:** 無。
- **發現於:** 2026-07-10 / bonamici #267 合併同步 ops session。
- **相關:** #267(變體統一)/ P0-A-4a F3 護欄 / scripts/rpm-preflight.ts / scripts/rpm-reconcile.ts。

---

### #273. 🎬 安裝資源多支影片 UI(現行單支 video_url)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(單支已覆蓋主場景;多支來源家上線後評估)
- **問題:**
  - `products.video_url` 為單支 text、`pickInstallVideo` 只取第一支可解析影片;來源 `video_urls` 為陣列,同商品多支安裝影片(不同車款各一支)時其餘被丟棄。
- **觸發事件:**
  - 2026-07-10 品牌放量 kickoff §2 明文「多支=follow-up 記 backlog」;cncracing 來源部分群有多支 Vimeo。
- **預期解法:**
  - `products.videos jsonb` 陣列欄(或沿用 manuals 形狀)+ InstallResources 多支列表(首支大、其餘 chip);遷移 video_url→videos[0] 相容期雙讀。
- **不修會痛在:**
  - 擴充性:多車款商品只顯第一支、客人找不到自己車款的安裝影片會退貨詢問。
  - 可維護性:單/多支雙軌越晚收斂、資料遷移面越大。
  - bug 可追蹤性:客服回報「官網影片跟我的車不符」難溯源到「被丟棄的第 2 支」。
- **估時:** 0.5-1 天(schema+管線+UI+測試)。
- **依賴:** 網站 migration(鐵則 8)。
- **發現於:** 2026-07-10 / 品牌放量 Slice 1。
- **相關:** #270 / scripts/rpm-transform.ts pickInstallVideo。

---

### #274. 🧩 eazigrip/materya 乾跑撞鍵 triage(handle 批內重複 1 + pv_spec 42 群)

- **狀態:** 🟡 近完成(2026-07-11 源頭治本上 prod:ebc 填 spec/materya 分群分家/eazigrip view 去重、三家 pv_spec 乾跑 0 撞;**剩 eazigrip handle 批內重複 1 筆** `TANKBMW006-` 尾 hyphen=spec 驗收8 未清,eazigrip confirm-write 前必解;真權威 `docs/specs/2026-07-11-quote-source-spec-variant-modeling.md`)
- **優先級:** 🟠 中(eazigrip/materya confirm-write 前必解)
- **問題:**
  - eazigrip:①handle 批內重複 1 筆(`TANKBMW006` vs `TANKBMW006-`、尾 hyphen 正規化後同 handle)②pv_spec_unique 撞鍵 40 群(CENTREPAD 家族:同 spec 兩 SKU 尾碼 BL/BLBLK、CL/CLCLR=來源疑似重複列或子款差異不在 spec);materya:2 群(MTY059CG vs CG-1)。
  - 乾跑報告完整清單:scratchpad dryruns/eazigrip.log、materya.log(2026-07-10 夜)。
- **預期解法:**
  - A=報價單側修源(重複列合併/尾 hyphen SKU 清理;同 #267 精神)/ B=網站管線排除清單(跳過撞鍵群、其餘先上)/ C=spec 補區分軸。
- **不修會痛在:**
  - 擴充性:兩家全量卡住(1,740+54 群不能寫);bug 可追蹤性:硬上會 23505 部分寫髒中間態(preflight 已擋)。
- **估時:** 報價單側查根因 0.5 天。
- **依賴:** Sean triage 方向。
- **發現於:** 2026-07-10 / 品牌放量逐家乾跑。
- **相關:** #266(handle charset 前例)/ C3(bonamici spec 碰撞前例、#267 源頭修復)。

---

### #275. ✅ lightech 變體圖大宗 http://(mixed content、寫入後前台破圖風險)

- **狀態:** ✅ 完成 —— **從來沒有落地成真破圖;本條是寫入前的風險評估,而該風險已在源頭消除。**
  - **關檔依據(2026-08-11 S 窗正式庫唯讀實查)**:全 16 家供應商、`delisted_at IS NULL` 的變體圖
    含 `http://` 的列 = **0**;lightech 舊 host `www.lightechmarketplace.com` = **0 列**;
    lightech 8788 列 = 8062 列 https + 726 列空陣列(和相符)。
    19017 筆可見商品的群層 `images` 與 `description` 含 `http://` = **0**。
  - **為什麼**:本條的 A/B 兩案(fetcher 改寫 host / 網站 transform 層)**都已於 2026-07-24 晚間被 Sean 推翻**,
    改走「**源頭下載→轉存 Cloudflare R2→DB 存乾淨 https 網址**、storefront 零改動」
    (memory `project_brand-line-kspeed-extreme-lightech-decisions`)。報價單側做完了。
  - 🔴 **本條「lightech.it 有 https 鏡像」的前提當時就已抽 40 張 0/40 實測推翻** —— 若有人日後想沿用
    「改寫 host 到鏡像」這條路,它是死路,不要重走。
  - ⚠️ 那 **726 列空陣列 = 缺圖**(memory 記的「726 群無圖 8.3%」),與 mixed content 無關,不要合併看待。
  - storefront 這側零殘留(`next.config.ts` 無 `images` 區塊、無 transform 層);唯一還帶 `http://` 的是
    `app/dev-preview/brands/fixtures.ts` 的一行 dev fixture,不在客人路徑上。
- **優先級:** 🟠 中(已解決)
- **問題:**
  - lightech 來源變體圖大量為 `http://www.lightechmarketplace.com/...`(實測該 host https 連線 reset、僅 http 可用);寫入後 https 正式站 `<img>` 觸發 mixed content——Chrome 自動升級失敗破圖、Safari/Firefox 擋。
  - 抽查同檔名在 `https://lightech.it/images_web/...` 多有可用鏡像(品牌版面已改用、code-reviewer R1 Critical 前例)。
- **預期解法:**
  - A=報價單 fetcher 抓圖時改寫 host 為 lightech.it 鏡像(驗 200 才收)/ B=網站 transform 層 URL 改寫 + 失敗 fallback 群代表圖。
- **不修會痛在:**
  - 擴充性:lightech 4,566 群上線即大面積破圖;bug 可追蹤性:破圖散在變體層、肉眼驗只看群代表圖會漏。
- **估時:** 0.5 天(含抽樣驗證鏡像覆蓋率)。
- **依賴:** Sean 拍 A(報價單側)或 B(網站側)。
- **發現於:** 2026-07-10 / 品牌放量(code-reviewer R1 + 乾跑)。
- **相關:** #270 / #212。

---

### #276. 🗂 分類一致化 v1.2 實作(14 大類/77 子類、報價單當大腦)

- **狀態:** ⏳ 分類體系已定稿(v1.2、07-11 Sean 拍板);實作 plan 已提報價單 repo `docs/PLAN-category-taxonomy-v12-2026-07-11.md`、**待 Sean 批(鐵則 8)**。
- **優先級:** 🟠 中(客人視角分類=轉換率地基;不擋品牌放量)
- **問題:**
  - 兩庫分類漂移+現行 18 大櫃是倉管視角(「操控部品」12,037 筆等於沒分)。定稿=14 大類/77 子類、台灣口語、順序=側欄 sort_order;真權威 `docs/specs/2026-07-11-category-taxonomy-v1-draft.md` + assets JSON。
- **預期解法:**
  - 報價單側:對照表落 DB + categorizer v2(關鍵字補丁+兜底+日報)+ 平行寫入新欄 + view 增欄 + 篩選器切 14 類;網站側:砍手抄 seed、categories 兩層同步、resolveIdOrNull 吃新欄、RPM fixed 策略退役(見 plan §2F)。
- **不修會痛在:**
  - 擴充性:每接一家新供應商都往錯體系堆、日後遷移成本線性放大;可維護性:兩庫各自手抄永久漂移;bug 可追蹤性:分類錯只能人肉對帳。
- **估時:** 報價單側 S1-S8 約 8 slice;網站側另提。
- **依賴:** Sean 批 plan + Q1-Q3(對照落 DB/計算落點/切換節奏)。
- **發現於:** 2026-07-11 / 側欄「零件分類」讀哪追查。
- **相關:** #212(多品牌)/ #51/#247(category count N+1、兩層後查詢面翻倍)。

---

### #277. 🚗 車輛下拉/taxonomy 只讀 direct fitment(純 inherited 子款選不到、S1-F11)

- **狀態:** 🔶 **2026-08-11 段一已 apply、段二 code 已寫完並測過,但卡在一條實測抓到的回歸**
  - 🔴🔴 **換源會弄丟 1 個車型:Ducati Panigale 959**(18 件未下架商品標著它;
    `product_fitments` 18 列、`product_fitments_effective` **0 列**)。
    ⇒ **`product_fitments_effective` 不是 `product_fitments` 的超集**,本條原本
    「effective = direct + inherited」的假設**是錯的** —— 家族樹字典查無的車型不會有 effective 列。
    本條「預期解法」原文寫的就是**兩表 UNION**,`20260811020000` 只取了 effective 那半。
    **數法(2026-08-11 唯讀實跑,可重跑複驗;「1 個」= `lost` 的列數)**:

    ```sql
    WITH old_path AS (   -- 舊路徑(products_public.fitments,未下架 + direct)
      SELECT DISTINCT trim(e->>'motoBrand') AS b, trim(e->>'modelCode') AS m
      FROM products p, jsonb_array_elements(p.fitments) e
      WHERE p.delisted_at IS NULL AND jsonb_typeof(p.fitments)='array'
        AND nullif(trim(e->>'motoBrand'),'') IS NOT NULL
        AND nullif(trim(e->>'modelCode'),'') IS NOT NULL),
         new_path AS (   -- 新路徑(vehicle_taxonomy_public)
      SELECT DISTINCT moto_brand AS b, model_code AS m FROM vehicle_taxonomy_public
      WHERE moto_brand IS NOT NULL AND model_code IS NOT NULL),
         lost AS (SELECT b,m FROM old_path EXCEPT SELECT b,m FROM new_path)
    SELECT (SELECT count(*) FROM lost) AS lost_models, * FROM lost;
    -- 2026-08-11 結果:lost_models = 1、Ducati / Panigale 959(四欄粒度 = 3 組)
    ```
  - **修法(已預先驗過,不是紙上提案)**:view 改成 `effective UNION direct` 的四欄 DISTINCT。
    `EXPLAIN (ANALYZE, BUFFERS)` 實測 **445ms / 13,144 列 / 含 959**,兩側都是 Index Only Scan
    (`ix_pfe_lookup` + `ix_pf_lookup`)⇒ 在 anon 的 3s 內。
    (比 effective-only 的 52ms 慢 8.5 倍,主因是 `product_fitments` 那側 `Heap Fetches: 11147`
    = visibility map 沒設滿;VACUUM 後應會降,但**沒實測過、不當成事實**。)
  - 🔴🔴 **第二條、而且 UNION 修不掉:年份維度換到了一個已知會放大的來源。**
    `product_fitments_effective` 的年份最終來自報價單 B 庫 view `storefront_fitments_v`
    (每日 16:10 `sync_storefront_fitments.py` 同步),那支 view 對每個展開車款**一律投影商品群
    min/max 聯集年份**、不是該車款自己的年份 ——
    `docs/archive/2026-07-20-git-cleanup/handoffs/2026-07-14-quote-fitment-year-bug-verification.md:9-11`
    逐字寫「**已確認、會影響顧客搜尋結果的 production bug**」,且明載 `product_fitments`(direct)
    **不受影響**。
    🔴 **2026-08-11 傍晚更正口徑(舊數字是我們自己的查詢造出來的)**:原本寫的「母體 123,920 列、
    年份不一致 36,062 列(29.1%)、起始更早 19,689、結束更晚 14,205、另有 1,187 列封閉變開放」
    **全部作廢** —— 那支比對查詢在 `(product_id, moto_brand, model_code)` 上 JOIN,而兩邊對同一個鍵
    都可能有多列年段 ⇒ 交叉積;「母體 123,920」其實是 `sum(direct列數 × effective列數)`。
    **改成「年段集合 vs 年段集合」的鍵層口徑(同一時刻並跑,兩支獨立寫法一致)**:
    母體 **81,437 個鍵**、不一致 **7,110(8.7%)**;其中 **7,012 是 effective 為 direct 的嚴格超集**
    (= 報價單側裁定的「子款繼承父年段 + 多年段多列是設計」),起年更早 5,412、迄年更晚 2,040、
    **起年更晚 0、迄年更早 0**(effective 只放大、從不縮小),封閉→開放 516。
    完整分桶與 SQL = 信箱 `S-056-NOTE.md`(回拋報價單側)。
    ⚠️ **債(主視窗 `S-060-A` 裁「不為註解開 migration」)**:migration
    `20260811100000_m4b_storefront_277c_vehicle_taxonomy_direct_years.sql` 的檔頭 `:13-15` 與
    DB `COMMENT`(該檔 `:140`)仍是舊口徑的 29.1%。**已 apply 的檔不就地改**(收據閘吃檔案 sha;
    COMMENT 要更正得走新 migration + apply 停點)⇒ 下次動該檔家族時順手帶。
    同形先例 = #347-3 的「正式站 COMMENT 過期字面待修」也是掛帳。
    ⇒ 換源 = 拿「198 組車型」去換「**8.7%** 的年份差異」,而差異方向是**放大**(保守面在 direct)。
    **修復屬報價單側**(修好後每日同步自動更正、網站端不必改 code)。
  - 🔴 **影響面不只下拉**:`app/account/vehicle/actions.ts:41-53` 的 `validateDictPair` 拿
    `fetchVehicleTaxonomy()` 當**寫入路徑的 fail-closed 字典** ⇒ 959 車主連「儲存我的愛車」
    都會被拒;反向地,含下架的幽靈車款會變成可寫入。
  - ⛔ **這是 migration ⇒ 要向主視窗要號 + apply,S 窗不自己收**。段二 code 在 `storefront-line`,
    **view 修好之前不該進 dev**(否則 959 車主直接從下拉消失)。
  - ⇒ **這已經不是「補一支 migration 就收工」,是要重裁的方向題**(見 S-029-STOP 三選項)。
  - **段一 = migration 先行**:新增 `vehicle_taxonomy_public` view
    (`supabase/migrations/20260811020000_…`),**已 apply**。
  - **段二 = app 層接線**:`lib/products.ts` 的 `getVehicleTaxonomyCached` 換源 +
    快取鍵 `vehicle-taxonomy-v1` → `v2`,守門 = `products-vehicle-taxonomy.test.ts`(6 格,
    5 個突變逐格驗過判別力)。
    🔴 **接線時實測到、plan 沒寫的一件事**:`product_fitments` 建表把「yearEnd 省略(單年)」與
    「yearEnd = null(開放式)」**壓成同一個 NULL**(`20260708130000:92` 的 CASE 要求兩欄都是四位數字)
    ⇒ 對映時得選一邊。查了來源 jsonb 才敢定:未下架商品 87,427 個 fitment 元素裡
    **省略 yearEnd = 0 個**(numeric 73,175 / json null 14,252)⇒ NULL 一律當開放式與現況等價。
    ⚠️ 這是**時點觀察**:匯入端哪天開始送沒有 yearEnd 鍵的單年 fitment,單年會被默默展開到資料上界。
  - **效能**:換源後反而更省 —— 真 anon PostgREST 實測新路 14 頁 × 0.52-1.44s,
    舊路(products_public 全 fitments)20 頁 × 約 0.85s、每頁約 450KB。
  - 🔴 **為什麼拆**:`database.types.ts` 是產生的,view 沒 apply 前它不存在 ⇒ 接線 typecheck 紅。
    不繞過型別的正解就是等 apply → 重 gen 型別 → 再接線;這也正是
    memory `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 正式站壞 8 小時)那條規則。
  - **量化**:direct 2,196 組 vs effective 2,390 組 ⇒ **198 組(8.3%)客人選不到**
    (MT-07 ABS / Ninja 400 SE / CB650R Neo Sports Cafe / GL 1800 Gold Wing Tour…)。
  - **取捨與代價**:見 migration 檔頭 §2/§3 與 **#389**(正解 matview)。
    主視窗 2026-08-11 裁 B1、以更正後口徑(37 組幽靈)重新確認,**待 Sean 晨間追認**。
- **優先級:** 🟠 中
- **問題:**
  - `buildVehicleTaxonomy` / `fetchVehicleTaxonomy` 只掃 `products_public.fitments`(direct 原始值);S1 後搜尋層已含 `product_fitments_effective` 展開(inherited),但**只存在展開層的子款**(某車系純推導、無商品 direct 標它)不會出現在車輛下拉 → 客人選不到、RPC 能力被入口閘住。年份同理(direct 2021-2024 + inherited 補 2025 → 2025 選不到)。
- **觸發事件:**
  - 2026-07-12 S1 變體補足盲點掃描 F11;MT-09 SP 因有 74 件 direct 仍在下拉、未擋 S1 驗收,通則缺口留此。
- **預期解法:**
  - 網站庫加輕量 view(`vehicle_options_v` = SELECT DISTINCT moto_brand, model_code, year_start, year_end FROM product_fitments ∪ product_fitments_effective、security_invoker、anon SELECT),`fetchVehicleTaxonomy` 改讀它 → 下拉與搜尋 RPC 同一資料面=「下拉有的、搜了一定有」不變式。
- **不修會痛在:**
  - 擴充性:報價單家族樹每新增純推導子款,搜尋層支援但下拉看不到,S1 展開價值被入口截半。
  - 可維護性:下拉與搜尋兩層資料面不同源,「選項出現/命中與否」對稱性推理變難。
  - bug 可追蹤性:客訴「找不到我的車」得先分辨是沒商品還是下拉源缺、多一層排查。
- **估時:** 30-45 分(view DDL + fetchVehicleTaxonomy 改讀 + 測試)
- **依賴:** S1 已落地(effective 表 + 每日同步)✅
- **發現於:** 2026-07-12 / S1 變體補足第二段
- **相關:** #212 / docs/specs/2026-07-12-search-vehicle-work-plan.md §2

---

### #278. 🧾 admin 客戶明細「訂單歷史」沿用 #249 濾 unpaid(待付款單在客戶頁查無)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - 客戶明細-b 訂單歷史復用 storefront 的 `listSummariesByCustomer`(`SupabaseOrderAdapter.ts:190` 隱含 `.neq('payment_status','unpaid')`=#249 治標、會員視角藏放棄付款孤兒單)。後台客戶明細因此**看不到該客的待付款單**(含 late-success 扣款爭議單=🔴 memory 明載必須查得到的類型),但 admin `/orders` 列表有「待付款」篩選看得到同一單 → 兩後台頁互相矛盾。
- **觸發事件:**
  - 2026-07-16 客戶明細-b code-reviewer R1 must-fix 1(揭示即收、修法另片);本片已在 sections.tsx 註解 + commit body 揭示。
- **預期解法:**
  - admin 專用查法(新 port method 或參數化 includeUnpaid、白名單投影不變),客戶明細顯全量+「待付款」標示;不動 storefront 共用 method 語意。
- **不修會痛在:**
  - 可維護性:支援場景「這客人說被扣款但看不到單」在客戶頁查無、得繞去訂單列表換篩選,雙軌心智。
  - bug 可追蹤性:金流爭議(雙扣/late-success)排查以客戶為錨最自然,此頁缺 unpaid=排查斷鏈。
  - 擴充性:未來客戶頁掛「未完成結帳跟進」類營運功能時必回頭補這條。
- **估時:** 20-30 分(port method + adapter + 頁面標示 + 測試)
- **依賴:** 無(#249 治本=Shopify 付成才建單為 Phase 2、不互擋)
- **發現於:** 2026-07-16 / M-4a 客戶明細-b
- **相關:** #249 / M-4a 客戶線

### #279. 💰 儲值金 ledger DB 級 idempotency 去重(admin 調整 back-resubmit 重複入帳)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - `admin_adjust_wallet` RPC(`20260716210000`)無 DB 級去重:PRG redirect 吸收一般 double-submit、submit 鈕 island pending disable 擋雙擊(皆前端縱深),但**瀏覽器 back-resubmit / 網路重送**仍可重複入帳(同金額同備註插兩列 ledger)。tier 編輯 RPC 無此問題(同值 NO_CHANGE 天然冪等);錢是「加法語意」無法用同值判重。
- **觸發事件:**
  - 2026-07-16 儲值金編輯片 codex 關卡2 F1(強烈建議 DB 級);Sean 拍 D1=A(island 保留、DB 去重進 backlog 隨 tier 片評=本條)。
- **預期解法:**
  - `customer_wallet_ledger` 加 `request_id text` 欄(nullable、人工調整路必填)+ partial UNIQUE index(`WHERE request_id IS NOT NULL`);RPC 改收 p_request_id 入列、撞唯一鍵回 'DUPLICATE' 固定碼(UI 顯「已處理過、未重複入帳」)。既有列 NULL 不受影響、零回填。
- **不修會痛在:**
  - bug 可追蹤性:重複入帳發生時 ledger 兩列字面完全合法,只能靠 audit request_id 人工比對抓重,對帳成本高。
  - 可維護性:每次動儲值金 UI(如未來批次調整)都要重新論證前端縱深夠不夠,DB 級一次解決。
  - 擴充性:未來儲值金接自動化來源(匯款對帳機器人等)時,呼叫端重試=必然事件,無 DB 冪等鍵不敢接。
- **估時:** 30-40 分(migration 加欄+index+RPC 改+模擬驗證;動錢=走硬閘全程)
- **依賴:** 無(獨立 migration;與 #214 訂單層 idempotency 同思路不同表)
- **發現於:** 2026-07-16 / M-4a 儲值金編輯(codex F1→D1 拍板)
- **相關:** #214 / #202 / M-4a 客戶線

### #280. 🧹 儲值金 RPC v_ws 空白集補全 + ledger service_role 直插 ACL 收斂評估(tier 片 codex 同洞外溢)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - tier 編輯片 codex 關卡2 F2 抓出:`admin_adjust_wallet`(`20260716210000`、已 apply)的 v_ws 空白集只有 12 字元,漏 U+1680/U+2000-200A/U+205F/U+200C/U+200D/U+2060/U+180E 等 → 持 service key 直呼可用冷門 Unicode 空白繞過「備註必填」。tier RPC(`20260717010000`)已用 31 字元全集,兩支同 family 字面漂移。
  - 同思路 F1 外溢:service_role 對 `customer_wallet_ledger` 有 INSERT(RLS policy `wallet_insert_service_role`+表級權限)→ 持 service key 可直插 ledger 繞過 audit(app 層已毒化 write 槽=縱深,DB 層未封;tier 片已把 customers 表級 UPDATE 收斂成欄級、ledger 是否同收斂需評估 deposit-wallet use-case 未來接線需求)。
- **觸發事件:**
  - 2026-07-16 tier 編輯片 codex 關卡2 F2(v_ws 補全集)落地於 tier RPC;wallet 同洞因動錢硬閘不夾帶、開本條。
- **預期解法:**
  - 新 migration `CREATE OR REPLACE admin_adjust_wallet` 只換 v_ws 為 31 字元全集(拒收面變嚴、fail-closed 方向、無行為放寬);順評 ledger INSERT ACL 收斂(若收=deposit-wallet use-case 接線時改走 RPC)。動錢=走硬閘全程(plan 關卡1→codex→Sean db push→值班台模擬)。
- **不修會痛在:**
  - 可維護性:同 family 兩支 RPC 驗證強度不一致,審下一支時要記兩套基準。
  - bug 可追蹤性:視覺空白備註一旦寫入,對帳時「這筆為什麼沒原因」查無字面線索。
  - 擴充性:ledger 直插洞在接自動化來源前必須收,晚收=接線時被迫重審整條。
- **估時:** 20-30 分(migration+模擬清單;可與 #279 idempotency 同 migration 一次收)
- **依賴:** 建議與 #279 併片(同支 RPC、一次硬閘流程)
- **發現於:** 2026-07-16 / M-4a tier 編輯(codex 關卡2 F2/F1 外溢)
- **相關:** #279 / #202 / M-4a 客戶線

### #281. 🧹 email_outbox 保留政策 + 清理 job(PII `recipient_email` 目前無限期滯留)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(E3 上線、開始有真實列之後升 🔴 高)
- **問題:**
  - `email_outbox`(`20260717020000`)存 `recipient_email` = 真實客戶信箱(本表唯一預期存在的 PII 欄),**目前沒有任何清理機制**:表只會長大、`sent` 終態列永久留存。
  - E1a 刻意**不給 service_role DELETE**(最小權限;清理只走 owner)→ **現況連「誰能刪、依什麼保留期刪」都還沒定義**,不是「有機制但沒排程」,是**完全沒有**。
  - 🔴 **本條開立前,migration 與 plan 三處寫「outbox 清理 job 已在 backlog」= 字面 vs 事實錯誤**(當時 backlog 最大只到 #280、根本無此條)—— 由 codex 關卡2 R5 抓出,本條即為補實。
- **觸發事件:**
  - 2026-07-17 / M-4a Email 片 E1a codex 關卡2 R5:「文件宣稱已在 backlog,實際查無」+ 鐵則 10「backlog 條目必寫不修未來痛在哪」。
  - (任一觸發即啟動實作)①E3 上線開始寫入真實 recipient ②表列數 > 10,000 ③個資盤點/稽核需求出現。
- **預期解法:**
  - 定保留政策(建議:`sent` / `skipped_*` 終態列保留 N 天後刪或匿名化 `recipient_email`;`failed` 死列保留較久供追查)。
  - 走 owner 排程(pg_cron,與 E2b 同族)或 owner-only SECURITY DEFINER 清理函式;**不放寬 service_role 的 DELETE**(否則等於為了清理擴大 blast radius)。
  - 一併評估 `cron.job_run_details` 清理(見 #282)。
- **不修會痛在:**
  - bug 可追蹤性:PII 無限期滯留 → 個資範圍隨時間單調擴大,日後要回答「我們存了誰的信箱、多久」時查無政策可引。
  - 可維護性:等到表大了才補刪除,得先補 owner 路徑 + 保留期決策 + 回填式清理,比現在定政策貴得多。
  - 擴充性:E2a 的對帳 `NOT EXISTS` 與 dead-man 訊號 4 都掃這張表,表無上限成長 → 掃描成本單調上升(`email_outbox_order_idx` 只能緩解、不能解決)。
- **估時:** 30-45 分(政策決策 + migration + 模擬)
- **依賴:** E3 上線後才有真實資料;建議與 #282 併片(同為 pg_cron 族清理)
- **發現於:** 2026-07-17 / M-4a Email 片 E1a(codex 關卡2 R5)
- **相關:** #282 / M-4a Email 片 E1a `20260717020000` / plan v3.1 §3.4

### #282. 🧹 `cron.job_run_details` 清理(pg_cron 執行紀錄無預設保留期、會長大拖效能)

- **狀態:** ⏳ 待執行(**E2b 啟用 pg_cron 之後才有意義**)
- **優先級:** 🟡 低(E2b 上線後升 🟠 中)
- **問題:**
  - Email 片 E2b 會以 `pg_cron` 每 5 分鐘打 sweeper = **每月約 8,640 筆** `cron.job_run_details`;官方**未給預設保留期**(=未確認),需自行清理。
- **觸發事件:**
  - (任一觸發即啟動)①E2b 的 `cron.schedule('*/5 * * * *')` 上線 ②`cron.job_run_details` 列數 > 100,000 ③DB 效能巡檢發現該表異常大。
- **預期解法:**
  - owner 排程定期刪除 N 天前的 `cron.job_run_details`;保留期須 > dead-man 的偵測窗(否則排程死亡的證據先被自己刪掉 = 反而害了偵測)。
- **不修會痛在:**
  - 可維護性:該表是「pg_cron 到底有沒有在跑」的唯一證據來源(E2b 連通實證即靠它);放它無限長大,日後查排程問題時查詢本身變慢。
  - bug 可追蹤性:保留期若沒跟 dead-man 偵測窗對齊,會出現「告警說排程死了、但執行紀錄已被清掉查不到何時死的」。
  - 擴充性:日後若再加 pg_cron job(E4/清理 job 本身),同一張表被多方寫入、成長更快。
- **估時:** 15-20 分
- **依賴:** 🔴 **E2b 必須先上線**(現況 pg_cron 尚未啟用,本條無對象)
- **發現於:** 2026-07-17 / M-4a Email 片 E1a(plan v3.1 §9 backlog 清單落實)
- **相關:** #281 / M-4a Email 片 E2b

### #283. 📧 Resend bounce webhook 接入(退信目前零回饋、只能靠 Resend 後台人工看)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(E3 上線後升 🟠 中)
- **問題:**
  - E1a 的假信箱 gate(`skipped_no_real_email`)只擋**已知合成域** `line.pcmmotorsports.local`;**真實但打錯/已停用的信箱**(客人自己填錯)仍會被寄、被 Resend 判 bounce,而系統**完全收不到這個回饋** → outbox 標 `sent`(從 Resend API 角度確實接受了),客人實際沒收到。
  - Resend 要求 **bounce rate < 4%**,超標會 suspend 寄送 → 影響的是**已驗證網域 `pcmmotorsports.com` 的寄件信譽**(全站告警信 + 未來所有信的共用資產)。
- **觸發事件:**
  - (任一觸發即啟動)①Resend 後台 bounce rate > 2%(逼近 4% 上限的一半)②客訴「沒收到訂單信」但 outbox 顯示 sent ③E3 上線滿一個月。
- **預期解法:**
  - 接 Resend bounce webhook → 記錄退信 → 標記該 recipient(或該客戶)信箱不可投遞 → 後續事件走 gate 不再寄;並提供 admin 可見的「此客戶信箱退信」訊號。
- **不修會痛在:**
  - bug 可追蹤性:`sent` 目前的語意是「Resend 接受了」,不是「客人收到了」;沒有 bounce 回饋 → 這兩者的落差永遠無法被觀測,客訴時無從查起。
  - 擴充性:寄件信譽是全站共用資產,一旦被 suspend,連 #250 的雙扣 anomaly 告警信都寄不出去 = 金流告警一起啞掉。
  - 可維護性:愈晚接,累積的壞信箱愈多,補接時要一次回填清理。
- **估時:** 40-60 分(webhook route + 狀態欄 + gate 接線)
- **依賴:** E3 上線(有真實寄信量才有 bounce 資料)
- **發現於:** 2026-07-17 / M-4a Email 片 E1a(plan v3.1 §9 backlog 清單落實)
- **相關:** #281 / #250 / M-4a Email 片 E3

### #286. 📮 死信人工重送工具(Email outbox)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(E3 上線後升 🟠 中 — 屆時才有真信會死)
- **問題:**
  - outbox 列 `attempts >= max_attempts` 後即為**死信**:不進 due 索引、不會再被認領、**對帳補寄看到列已存在就不補寄** → 該客人永遠收不到信。目前**無任何工具可救回**(無 reset attempts、無手動重送入口)。
  - 觸發情境(Sean 2026-07-17 拍 **Q9=A 時已知悉此缺口才拍**):撞 Resend 月額度 → 每日重試 → **連 5 天未升級** → 死信。dead-man 訊號 2/5 會告警,但告警之後**沒有下一步動作可做**。
- **觸發事件:**
  - (任一)①真的出現死信(訊號 2 告警)②E3 上線後 Sean 要求「補寄那幾封」③outbox 保留政策 #281 實作時一併評估。
- **預期解法:**
  - admin 側最小工具:列出死信(零 PII counts + outbox id)+ 單筆/批次 reset(`attempts=0`、`next_retry_at=now()`、`status='pending'`)+ audit log。
  - 🔴 **紅線**:reset **不可清 `attempts` 以外的世代語意** —— `attempts` 同時是 ABA 世代柵欄的 token(見 `IEmailOutbox` JSDoc);reset 必須在**確認該列非 `sending`** 下進行,否則與在途持有者撞車 → 重複寄信。
- **不修會痛在:**
  - bug 可追蹤性:系統知道信死了、也叫了,但**人收到告警後無事可做** = 告警淪為噪音。
  - 可維護性:唯一替代路徑是手動下 SQL 改 prod 資料表(繞過 audit、且要人記得 `attempts` 的世代語意)。

### #285. 📮 Email sender 傳出 provider-neutral retry hint(未知 429 精準退避)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - E1c-1 的合約:**未知 429**(body 非 JSON / 無 `name` / `name` 非三字面)→ `http_429` → **保守長退避 ≥24h**。
  - 🔴 **已知代價(codex 關卡2 R2 must-fix 抓出、Sean 2026-07-17 拍 Q11=A 明示接受)**:若該 429 實際只是瞬時限流(CDN/WAF 抖動、Resend 秒級 rate limit),該封信會**白等約 24 小時**才重試(信仍會寄出、不會消失)。
  - **拍板理由(Sean 已知悉才拍)**:PCM 量級(10-30 單/日、sweeper 每 5 分鐘一輪)距 Resend 限流門檻(官方 5 req/s;⚠️ 另一頁寫 10 req/s、**官方兩頁矛盾未收斂**)差數個量級 → 撞 429 幾乎必然是額度耗盡而非打太快 → 「未知即當額度」對本專案是合理預設。
  - ⚠️ **此代價的上界取決於一個未確認事實**:429 body 是否必然含 `name`(**兩官方 SDK 不一致** —— resend-node `ErrorResponse` 宣告含 `name`、resend-go 的 429 分支解 `DefaultError{Message}` 不含 `Name`)。若實際不含 → **所有** 429 都落未知格 → 全部 24h 延遲。
- **觸發事件:**
  - (任一)①實測發現正常交易信被延遲 24h(E3 上線後觀察)②Resend 客服/文件確認 429 body 形狀 ③升級 Resend 方案後仍見 `http_429` 告警。
- **預期解法:**
  - adapter 解析 `Retry-After` / `ratelimit-reset` header → **解析 + 驗證 + 上限約束**後,以 **provider-neutral retry hint**(秒數)擴進 `SendEmailResult`;E2a「有 hint 用 hint、無 hint 才長退避」。
  - 🔴 **紅線**:**不得透傳原始 header 字串**(對齊 REQUIRED-E1b「provider 自由文字不進錯誤碼」的立法意圖);hint 須有上限約束(防 provider 回超長值卡死重試)。
  - 需擴 `ResendFetchLike` 回應型別以承載 headers(E1c-1 刻意未做 = 範圍控制)。
- **不修會痛在:**
  - 可維護性:退避策略對「未知」一律取最壞,精度受限於分類能力;分類前提(429 含 `name`)一旦被證偽,整批 429 都吃 24h 延遲而無人察覺。

### #284. 📮 Email 文案後台可改(L2 → L3 升級路徑)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - Sean 07-16 拍 **Q4=A:文案 L2 hardcode**(要改找 Claude 改)。🔴 此題**兩審查員意見相反**(Fable 判 L2 成立;codex 判「頻率未經證實、按鐵則 9 拿不準應預設 L3」)→ 由 Sean 親自拍板銷案。
  - 即:本條是**已知的、被 Sean 明示接受的取捨**,不是遺漏。
- **觸發事件:**
  - (任一觸發即啟動)①Sean 一季內要求改文案 ≥ 2 次(= L2 假設被證偽、實為 L3)②要做 A/B 或多語系 ③行銷要自己改。
- **預期解法:**
  - 文案移後台 CRUD(對齊鐵則 9 的 L3 處理);需先寫 PRD。
- **不修會痛在:**
  - 可維護性:每次改一句話都要走完整 slice 流程(三綠+審查+commit),對「改錯字」這種需求成本過高。
  - 擴充性:多語系/A-B 測試在 hardcode 下無法做。
  - bug 可追蹤性:文案散在 code 裡,「這封信為什麼這樣寫」沒有單一真相來源。
- **估時:** 需先寫 PRD(L3 強制前置)
- **依賴:** E3 已上線且文案穩定
- **發現於:** 2026-07-17 / M-4a Email 片 E1a(Q4 拍板的升級路徑落實)
- **相關:** #281 / M-4a Email 片 E3 / 鐵則 9

### #287. 🧹 商品目錄品牌參數改單值(`?pbrands=a,b`)— 消除 Next segment key 碰撞的治本解

- **狀態:** ✅ **已實作(2026-08-11 / S 窗四代;plan = 信箱 `S-043-PLAN.md`,Sean `S-044-A` 批准)**
  - **落地形狀**:寫出端只產 `?pbrands=a,b`(單一鍵);讀取端**新舊格式都吃**,單一定義點 =
    `lib/catalog-query.ts` 的 `parseBrandSlugsFromUrl`,三個讀取端(server `parseCatalogQuery`、
    client `parseBrandFiltersFromUrl`、寫回段的 #315 未知值保留)全部改吃它。
  - **🔴 附帶必修的一條(照本條字面做會踩)**:`normalizedQuery` 要**先把品牌軸收斂成同一種表示
    再比對**。少了它,客人帶**舊格式**連結進站時,重建結果(新格式)與網址(舊格式)永遠不相等
    ⇒ #289 的還原波早退不觸發 ⇒ `page` 被吃掉且不自癒。**站內連結全是新格式 ⇒ 自己怎麼點都
    測不出來**,只有客人手上的舊連結會踩。回歸鎖 = hooks 測試案例⑩(舊格式)+⑯(新格式對照)。
  - **⚠️ 網址列實際字面是 `?pbrands=a%2Cb`**:`URLSearchParams` 是 form-urlencoded 序列化器、
    逗號不在安全集合裡 ⇒ 必然被編碼。功能等價(讀回自動解碼、server 同一支 parser),但**本條
    標題那個未編碼字面是格式描述、不是序列化結果**,拿它去 grep 或寫斷言會落空。
  - **殘留與邊界(誠實清單)**:
    1. **站內連結仍產舊格式** —— `lib/brand-url.ts` 的 `brandCatalogueUrl` 維持 `/products?pbrand=X`。
       刻意不改:單一品牌不可能碰撞(本條要治的是重複鍵),而那個字面同時是 `BrandAboutRedirect`
       的**設計稿契約**(`BrandAboutRedirect.tsx` 檔頭引的 `brand-page.html:1606`
       ——⚠️ **該座標未確認**:本樹 `grep -rln "brand-about" design-reference/` 只命中
       `components/Pages.jsx:150` 與 `styles/pages.css`,查無 `brand-page.html`;
       非本片引入,契約本身仍以那支元件的行為邊界為準)⇒ 改它要一起動
       設計稿契約與**16 支測試檔**(數法=`grep -rln "brandCatalogueUrl\|pbrand=" --include='*.test.ts'
       --include='*.test.tsx' apps packages | wc -l`,2026-08-11 實跑),收益是零。
       相容路徑因此在正式站每天都被走到(不是只有舊分享連結)。
    2. **條件式 `router.refresh()` 沒有拆掉** —— 本條原本寫的「可移除條件式 refresh()」**不採用**:
       重複鍵不只品牌軸產得出來,手打/外站的 `?category=A&category=B` 同樣會讓新舊 segment key 相同
       (server 讀第一個值、segment key 取最後一個)。判別力回歸鎖 = hooks 測試案例⑰
       (拿掉 `if (collides) refresh()` 只有它會紅)。品牌軸本身則已恆一次查詢(案例①②③⑤)。
    3. **`#288`(production build E2E)仍未做,而本條的框架層行為只有 production build 驗得到**
       —— 單元測試驗得到「送出去的網址對不對」,驗不到「Next 有沒有真的重抓」。本片**未跑**真瀏覽器
       production 實測(S 樹沒有 `.env.local`,跨樹複製 secret 不在施工窗權限內)⇒ 已在信箱
       `S-050-STOP` 列為待辦/待裁,~~不是已驗~~。
       **→ 框架層已驗(2026-08-11 晚,主視窗代跑於主樹,S-051-A B 變體)**:`next build`+`next start`
       (port 3111)+真瀏覽器實測——勾三品牌逐步 `?pbrands=akrapovic`→`,bonamici`→`,cnc-racing` 單鍵演進;
       取消非字母序最後的 BONAMICI ⇒ **恰 1 個 RSC 請求**(`/products?pbrands=akrapovic,cnc-racing&_rsc=…`,
       數法=performance resource entries 前後差)、URL 與卡片內容同步正確;舊格式分享連結
       `?pbrand=cnc-racing&pbrand=akrapovic&page=2` 進站=URL 原樣不改寫、兩品牌勾選還原、
       **page=2 保住**(#289 回歸鎖 production 實證)。#288 的 E2E 自動化仍未做(本條驗的是一次性手測)。
- **舊狀態(留存):** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - 現況品牌篩選以**重複 query key** 寫 URL(`products-url-state.tsx:220` 的 `params.append('pbrand', …)`)。
  - 🔴 Next 16.2.6 產生 page segment cache key 走 `Object.fromEntries(new URLSearchParams(...))`
    (`next/dist/esm/client/route-params.js` `getCacheKeyForDynamicParam`,code-reviewer 2026-07-19 於
    node_modules 實查確認)→ **重複 key 只留最後一個值**。故 `?pbrand=a&pbrand=b` 與 `?pbrand=b`
    的 segment key **相同** → `router.replace` 判定同一 segment、重用舊 CacheNode、零 RSC 請求。
  - 症狀(Sean 2026-07-19 回報、正式站+本地 production build 皆穩定重現):勾多個品牌後**取消非
    「字母序最後」的那個**,該品牌商品不消失、件數停在舊值(取消 akrapovic 停在 1103、應為 455)。
  - 已修(本片):`useCatalogFilterUrlSync` 在**偵測到 segment key 碰撞時**補一次 `router.refresh()`。
    正確性已補齊,但碰撞情境仍需 **2 次型錄查詢**(replace 抓一次無效 + refresh 抓一次有效)。
  - ⚠️ 本條是**已知且被明示揭示的殘餘成本**,不是遺漏。
- **觸發事件:**
  - (任一)①型錄頁效能被實測指出瓶頸在重複查詢 ②Next 升級後 `router.refresh()` 行為改變或
    replace 開始正常重抓(屆時現行條件式 refresh 需重評)③品牌篩選新增更多可複選軸、重複 key 擴散。
- **預期解法:**
  - 品牌改**單一值逗號分隔**(`?pbrands=akrapovic,bonamici`)→ 每個組合的 segment key 天然不同
    → 可移除條件式 `refresh()`、恆一次查詢。
  - 🔴 讀取端須**同時相容**舊的重複 `?pbrand=` 格式(客人已分享的連結、站內既有入口),輸出端只產新格式。
  - 涉及檔(**2026-08-11 實作時更正:條目原寫的三個座標全部被 #341 拆檔推移過**;
    以下是實作後的實際位置):寫出端 `use-catalog-filter-url-sync.tsx`(原寫 `products-url-state.tsx:220`,
    該檔今天只有 143 行)、client 讀取端 `products-url-parsers.ts` 的 `parseBrandFiltersFromUrl`、
    server 讀取端 `lib/catalog-query.ts` 的 `parseCatalogQuery`(原寫 `:64-66`,那裡今天是型別宣告)、
    共用解析 `lib/catalog-query.ts` 的 `parseBrandSlugsFromUrl` + 對應測試三支。
  - 屬鐵則 8 重大改動(跨 3 檔 + 動對外可見的 URL 合約)→ **須先提 plan 等 Sean 批准**。
- **不修會痛在:**
  - 擴充性:任何新的「可複選」篩選軸若沿用重複 key,會複製同一個 bug;現行修法是偵測碰撞後補救,
    不是從結構上消除碰撞。
  - 可維護性:`useCatalogFilterUrlSync` 內留著一段依賴 Next 內部快取實作細節的 `segmentKey` 比對,
    Next 升級即可能失效(升級時需重跑本片的六步實測)。
  - bug 可追蹤性:碰撞情境的雙查詢在效能圖上會像「偶發的重複請求」,不看註解無法解釋為何只有
    某些操作才雙查。
- **估時:** 60-90 分鐘(含舊格式相容 + 測試 + production build 實測)
- **依賴:** 無(可獨立進行)
- **發現於:** 2026-07-19 / Sean 回報品牌篩選取消無效
- **相關:** #288(E2E 守門)/ 鐵則 8
- **順帶記錄(既有漂移、非本次引入):✅ 2026-08-11 已修** —— 那句 dangling 引用(「產品品牌深連結
  改獨立 key…見 backlog #269」,而 #269 實為「首頁殘餘死連結」)隨 #341 拆檔搬到
  `products-url-parsers.ts` 的 `parseBrandFiltersFromUrl` doc comment;本片把它改成指向本條(#287),
  並把敘述更新成事實:消歧**已經做了**(`?pbrands=`,舊的 `?pbrand=` 仍讀得懂)。

### #288. 🧪 前台篩選加 production build E2E 回歸測試(現有 playwright 只跑 `next dev`)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中
- **問題:**
  - #287 那個 bug **只在 production build 顯現**(dev 與 production 的 router 快取行為不同),且
    「hook 有正確呼叫 router API、但 App Router 沒重抓」這種**框架層**回歸,單元測試在本質上擋不住
    —— 單元測試只能驗「有沒有呼叫」,驗不到「呼叫後畫面有沒有真的更新」。
  - 現有 `playwright.config.ts:28` 啟動的是 `next dev` → 守不住這條路徑(codex 2026-07-19 指出)。
  - 本片已補的單元測試(`products-url-state.hooks.test.tsx`)擋得住「有人拿掉/改成無條件 refresh」
    (雙向突變實測驗證過),但擋不住「Next 升級後行為改變」。
- **觸發事件:**
  - (任一)①Next 大版本升級前 ②再次出現「網址對但畫面沒更新」類型的客訴 ③篩選器重構。
- **預期解法:**
  - 新增一條走真 `next build && next start` 的 Playwright 測試,對品牌篩選跑
    `A → A+B → B`(取消非最後值)與 `A+B → A`(取消最後值)兩組,斷言**畫面上的商品件數與
    商品卡內容**真的變了(而非只驗 URL);另計 `/products` 的 RSC 請求數當成本守門。
  - 需要固定的測試資料(現行斷言吃真 DB 件數,會隨上架變動)。
  - 🔴 **由 #289 移交的必測案例(2026-07-19)**:「**`?page=3` 時選車**」——`filterKey` 不含
    vehicle,選車時 `useCatalogFilterUrlSync` 不再刪 page、`useVehicleUrlSync` 會帶著舊 page
    導覽一次,收斂靠 `usePageResetOnFilterChange` 的 `setPage(1)`。#289 收案時**未能實測**
    (當時判定「`/products` 桌面版無車款選單」)。
  - 🔴 **2026-07-20 production build 實測推翻上述前提**:桌面車款選單 `.cft-bar` 可見可用
    (1440×64、三個 combobox「選擇品牌/選擇車型/選擇年份」、點擊展開 54 個選項);當時量到
    寬高 0 的是**另一個元件** `.cft-mobile-bar`(全尺寸皆 `display:none` 的死碼,見 #290)。
    → **桌面路徑改走 `.cft-bar` combobox 真互動**,不需 mobile drawer。
  - 本條目仍須**桌面 + mobile 兩種視窗**各測一次;🔴 **mobile 入口 = 「篩選」FAB
    `.pp-mobile-fab`**(`ProductsPage.tsx:187-197`),**不是**「選擇車款」chip。
- **不修會痛在:**
  - bug 可追蹤性:同類 bug 只能靠 Sean 肉眼在正式站發現,而這次就是這樣被發現的。
  - 可維護性:每次動篩選 URL 層都要人工跑一次 production build 手測(本片就跑了 5 次 rebuild)。
- 🔴 **2026-07-20 拆片與進度**(plan 真權威 = `docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` v3.2,
  經關卡1 **三輪**雙審 + code-reviewer R1):
  - **#288-a ✅ 本次完成**:production config + preflight(驗**非空值**)+ vitest exclude +
    package script + **GitHub Actions**(Sean 07-20 拍 A 推翻原「不接 CI」)+ 會斷的 smoke。
  - **#288-b ✅ 完成(2026-07-24、未 push)**:`e2e-prod/global-setup.ts` 資料合約 fail-fast(開跑前驗
    /products 真有卡片+件數、每操作顯式 timeout、config 加 `globalTimeout`/`actionTimeout`)+ mobile
    device project = **Pixel 5**(chromium 系、UA 含 Android → `data-mobile="true"`;🔴 **非 iPhone**——iPhone
    preset 是 webkit、本機未裝會啟動失敗)。斷言落既有 `runner-smoke.spec.ts`(project-aware:
    chromium→`'false'` / mobile→`'true'`,比只驗 mobile 更強)= **plan §6 檔案清單外的揭示偏離**(斷言必須落 spec、
    重用既有 smoke=最少檔)。三綠 + E2E `2 passed`(desktop+mobile)+ 突變 2/2:改斷言恆 false→mobile 紅、
    壞 globalSetup 選擇器→整套 fail-fast 中止 0 test。
  - **#288-c** 品牌兩組 + 件數 + 卡集合 + RSC 計數(規則見 plan §5.2:碰撞 `1..2` / 非碰撞 `=1`、
    exact pathname、每次操作前清零;🔴 `MobileTabBar.tsx:49` 的 `/products` prefetch 會污染 exact 命中)。
  - **#288-d** `?page=3` 時選車(桌面 `.cft-bar` combobox 真互動 + 手機 FAB→抽屜「選擇車款」)。
  - **#288-e** 分頁黑箱守門(不變式見 plan §1.2)。
- 🔴 **手動觸發時機**(#288-a 已接 CI、每次 push/PR 自動跑;下列情境**額外**須手動跑一次):
  ①Next 大版本升級前 ②動 `products-url-state.tsx` 任一片 ③動篩選 URL 層 ④#287 落地時。
- 🔴 **已知缺口**:`.github/workflows/e2e-prod.yml` 需 GitHub Secrets
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`(兩者為 `NEXT_PUBLIC_`、
  本即隨 client bundle 公開,非新增暴露面)。**未設定時 preflight 會硬紅**(已實測:
  空字串亦擋)—— 刻意不做 skip,避免「沒設定卻顯示通過」的假綠。
- CI 邊界(web-Codex 2026-07-20 審查指出):fork PR 被 if 條件跳過時 GitHub 回報 Success 而非 Failure,即使設為 required check 也不擋 merge -> fork PR 等於完全繞過這條 E2E(目前無外部貢獻者、風險低);未來若引入 Dependabot,其 PR 拿不到一般 Actions secrets,會固定紅,屆時需改用 pull_request_target + 顯式 gate 或 Dependabot secrets。
- **估時:** 90-120 分鐘(含測試資料固定化)→ a/b 已完成,餘 c/d/e
- **依賴:** 需先決定測試資料策略(固定 fixture vs 專用測試頁)→ #288-b 已採「打真 DB + globalSetup fail-fast 合約」
  (plan §10.1:固定 fixture 是獨立議題、不擋 c/d/e);⚠️ 故 c/d/e 的斷言會隨上架狀況波動,設計時避免寫死具體件數/slug
- **發現於:** 2026-07-19 / Sean 回報品牌篩選取消無效
- **相關:** #287

### #289. 🐛 帶 `?page=N` 的深連結進站 → 頁碼被吃掉(內容第 1 頁、分頁 UI 停在舊頁碼)

- **狀態:** ✅ **完成(2026-07-19,Sean 拍 Q10=B 當場接著修)**
  - 修法 = 在 `useCatalogFilterUrlSync` 內、刪 page **之前**先用「**不動 page**」的版本比對:
    若已等於當前 URL,代表 state 只是**剛追上 URL**(還原波)→ 直接收手,不刪 page 也不導覽。
    此判準不需 skip-once 旗標,故不會與 `usePageResetOnFilterChange` 的 `skipOnceRef` 互搶。
  - 驗證:production build 實測 `/products?pbrand=akrapovic&page=2` 進站 → URL 保持
    `?pbrand=akrapovic&page=2`、第一張卡 `akrapovic-sm-k10so1t`(**≠** 第 1 頁的
    `akrapovic-s-d9so14-hifft`)= 真的停在第 2 頁;分頁 UI 與內容一致。
    突變測試:拿掉該判斷 → 測試案例⑩轉紅。品牌六步與分頁 1/2/3 頁皆無回歸。
  - 🔴 下方問題敘述保留為**歷史紀錄**(含被實測推翻的「會自癒」假設之更正),供日後追溯。
- **原優先級:** 🟠 中
  - 🔴 **2026-07-19 優先級上修**:初版寫「🟡 低」的依據是「最終仍由 `useBrowseUrlSync` 收尾落回
    正確頁」——該句**未經實測、且已被實測推翻**(code-reviewer R2 must-fix 抓出)。實際不會自癒。
- **問題:**
  - `useCatalogFilterUrlSync` 以 `lastFilterKeyRef` 的**篩選值指紋**判斷是否 `delete('page')`,
    但該指紋**無法區分「使用者改篩選」與「深連結還原波」**。
  - 失敗情境:`/products?pbrand=akrapovic&page=2` 進站 → mount 首輪走 `initialized` 守衛(指紋=空)
    → `useDeepLinkRestore` dispatch 讓 `cascade.brands` 變非空 → 第二輪指紋由空變非空 →
    誤判為使用者操作 → `delete('page')` → `router.replace('/products?pbrand=akrapovic')`
    → **多打一次全型錄 RSC**;隨後 `usePageResetOnFilterChange`(有 `skipOnceRef` 守)保住 page=2、
    `useBrowseUrlSync` 再 replace 回 `page=2`。
  - 🔴 **不會自癒(已實測、非推論)**:`useBrowseUrlSync` 的 deps 是
    `[currentPage, sort, perPage, router]` —— 還原波刪掉 page 後,`page` state 仍是 2、
    `currentPage = min(page, totalPages)` 未變、sort/perPage 未變 → **effect 不重跑** →
    `page=2` 永不寫回。(`usePageResetOnFilterChange` 因 `skipOnceRef` 被吞掉,也不會 setPage(1)。)
  - **實測終態**(本地 production build,`/products?pbrand=akrapovic&page=2` 進站,等 6 秒):
    URL = `?pbrand=akrapovic`、內容 = **第 1 頁**(第一張卡與直接載入第 1 頁的對照組同為
    `akrapovic-s-d9so14-hifft`)、分頁 UI **停在第 2 頁** → **與 Sean 原本回報的症狀同形**。
  - ✅ 已對照 `61f45b6`(未含 2026-07-19 分頁修法)實測,**行為完全相同** → 確為既有 bug。
  - 🔴 **既有行為、非 2026-07-19 分頁修復引入**(舊版無條件 `delete('page')` 同樣會在還原波刪掉
    page);該片只是把這條路徑**明文化**,並未擴大或縮小它。code-reviewer R1 must-fix-1 指出。
- **觸發事件:**
  - (任一)①實測發現帶 `?page=N` 的分享連結進站會閃第 1 頁 ②型錄頁 RSC 請求數被列為效能瓶頸
    ③要再新增會寫入 URL 的篩選軸(屆時三處「篩選是否變動」的判斷會更難對齊)。
- **預期解法:**
  - 比照 `usePageResetOnFilterChange` 的 `skipOnceRef` idiom:讓 `useCatalogFilterUrlSync` 也吞掉
    還原波一次;或在 restore 消化後(`pendingRestoreRef.current` 由 null 轉 false 那一刻)
    重新 seed `lastFilterKeyRef`,使還原造成的指紋變動不被計為使用者操作。
  - 🔴 更根本的方向:`page` 的權威寫入者是 `useBrowseUrlSync`,但 `useCatalogFilterUrlSync` 也寫它
    (為省一次往返)。兩個寫入者 + 三處「篩選是否變動」判斷(`filterKey` /
    `usePageResetOnFilterChange` 的 key / 還原窗口守衛)是本檔的結構性複雜度來源,可一併收斂。
- **不修會痛在:**
  - 可維護性:三處「篩選是否變動」的判斷各自維護,`filterKey` 是
    `JSON.stringify([cascade, extras, sort, perPage])` 的子集;任何人往其中一處加軸而未同步其他處,
    就會靜默漂移(改該軸後停在舊頁碼、或還原波行為改變)。
  - bug 可追蹤性:症狀是「偶爾閃一下第 1 頁 + 多一次請求」,不看註解無法歸因。
- 🔴 **同類路徑:仍未實測、義務移交 #288(不得視為隨 #289 一併銷案)**
  - 內容:`filterKey` 不含 vehicle,故在 `?page=3` **選車**時本 effect 不再刪 page,
    `useVehicleUrlSync` 會帶著 `page=3` 導覽一次,收斂靠 `setPage(1)`。舊版(無條件刪)會在
    選車時順手清掉 page = **行為有差異**。
  - ⚠️ **未實測的原因(2026-07-19 當時的判定)**:收案時嘗試補測,判定 `/products` 桌面
    版**沒有**車款選單——「選擇車款」是 mobile-only chip(`cft-mobile-chip`,桌面實測寬高為 0),
    要走 mobile drawer 才點得到。判斷硬湊一次操作不如據實記錄,故**明寫未驗證**並移交。
  - 🔴 **2026-07-20 更正:上述原因不成立**。production build 實測:桌面車款選單 `.cft-bar`
    可見可用(1440×64、三個 combobox、點擊展開 54 個選項);當時量到寬高 0 的是**同頁另一個
    元件** `.cft-mobile-bar`(全尺寸皆 `display:none` 的死碼,見 #290)→ **當時桌面即可實測**,
    延期並非必要。教訓=下「找不到某 UI」的結論前,須先確認量到的是不是目標元件本身。
  - 移交對象:**#288**(production build E2E 守門)——該條目本就要涵蓋各篩選軸,請把
    「`?page=3` 時選車」列為必測案例之一(桌面 + mobile 兩種視窗)。
  - 風險評估:此路徑**不會**造成 #289 那種「內容與頁碼不一致」——`usePageResetOnFilterChange`
    的 key 含整個 `cascade`(涵蓋 vehicle),選車必觸發 `setPage(1)`;最壞情況是多一次帶舊
    `page=3` 的導覽往返。**此評估來自讀碼,未經實測。**
- **估時:** 40-60 分鐘(含還原波的單元測試)
- **依賴:** 無
- **發現於:** 2026-07-19 / 分頁失效修復的 code-reviewer R1 + R2(R2 推翻了 R1 處置時的「會自癒」假設)
- **相關:** #287 / #288

### #290. 🧟 `.cft-mobile-bar`(「選擇車款」chip)全尺寸皆 display:none = 死碼

- **狀態:** ✅ **完成(2026-07-20)** —— Sean 看過 production build 強制顯示截圖後拍 A **刪除**。
  移除範圍:`CascadeFilterTop.tsx` markup + `onOpenDrawer` prop + `vehShort` 衍生值、
  `filter-cascade.css` 四段樣式 + `:147` 隱藏規則、`filter-responsive.css` 兩條隱藏規則。
  手機車款入口不減(`.cft-bar` 三層 VehicleSelect + 「篩選」FAB → 抽屜「選擇車款」tab)。
  記錄於 manifest `business_overrides.mobileVehicleChipRemoved`(含 design 端即死碼的實證)。
- **優先級:** 🟡 低
- **問題:**
  - `.cft-mobile-bar` 在**所有**螢幕尺寸皆 `display:none`,無任何規則將其改回可見 →
    使用者永遠看不到這個元件。
  - **實證(2026-07-20 production build + 瀏覽器實測,桌面 1440px)**:`.cft-mobile-bar` =
    `display:none` / 0×0;同頁 `.cft-bar`(真正的桌機車款列)= `display:block` / 1440×64、
    三個 combobox 可互動、展開 54 個選項。
  - 四條隱藏規則出處:`apps/storefront/src/styles/filter-cascade.css:95-96`(base
    `display:none`)、`filter-cascade.css:147`(≤1023px 再次 none)、
    `filter-responsive.css:62`(≤1079px none)、`filter-responsive.css:109`
    (`[data-mobile="true"]` none)。markup 在 `apps/storefront/src/components/CascadeFilterTop.tsx:93`。
  - 🔴 **承自 design-reference、非實作走樣**:`design-reference/styles/filter-top.css:322-323`
    本身即 base `display:none`(註解「手機版精簡 chip」),且該檔 `:372` / `:476` 兩處亦為
    none、**全檔無任何規則讓它顯示**。依鐵則 1(design 直接搬、不翻譯),storefront 照搬正確。
  - ~~待確認:這是 design 刻意廢棄,還是 design 漏寫了顯示規則~~ → **已由 Sean 2026-07-20
    拍板解答:刪除**(看過 production build 強制顯示截圖後決定;判定為與 `.cft-bar` 三層
    VehicleSelect 功能重複的冗餘入口)。偏離 design 已記入 manifest
    `business_overrides.mobileVehicleChipRemoved`,非違規。
- **不修會痛在:**
  - 可維護性:死碼會讓後人誤判頁面結構(**已實際造成一次誤判**:#289 因此把「`?page=3` 時
    選車」測試案例延期,理由事後證實不成立)。
- **估時:** ~~30 分鐘~~ → 實際已完成(與抽屜 tab 改名同片)
- **依賴:** ~~需 Sean 或 design 端確認意圖~~ → 已解除(Sean 2026-07-20 拍 A 刪除)
- **發現於:** 2026-07-20 / #288 plan 的關卡1 對抗審查(Fable 指出桌面 `.cft-bar` 未被隱藏,經
  production build 實測確認)
- **相關:** #288 / #289 / 鐵則 1

---

### #291. ⚖️ 正式服務條款／隱私政策 route + version/hash(production checkout 上線前人工 release checkpoint)

- ✅ **狀態:2026-07-24 全鏈上線** —— commit `5d5af4c` 已推 dev+main、Vercel production 部署 READY、`shop.pcmmotorsports.com/terms`+`/privacy` 實測 **HTTP 200 + 內容正確**、兩支 migration 皆 apply(DB 版本列 hash=`eca6a241…` 與程式常數逐字一致)。原 BLOCKED(等內容核准)+ 「未 commit 未 deploy / migration 未 apply」皆已解除。🔴 **唯一剩項不結案**:`/terms` `/privacy` 渲染後 payload Sean 尚未逐字肉眼看過(drift `legalRenderedPayloadNotEyeballed`);未經律師簽核(明示不用)。
  - ✅ **已交付**:`/terms`、`/privacy` route(`app/terms|privacy/page.tsx` + `components/LegalDocPage.tsx`;
    內容 SSoT=`data/legal-content.ts`,取自 `docs/specs/2026-07-23-pcm-legal-terms-privacy-draft.md` 已核准版、
    剝除內部註記;聯絡/登記資訊自 `lib/site-config` 衍生、零硬編碼)+ **兩個消費端連結都改完**
    (`CheckoutStep2ReviewSections.tsx` 的 `CheckoutOrderReview` + `RegisterPage.tsx`,
    皆 `target=_blank` 與 `rel=noopener noreferrer`),另加 footer 入口 + smoke test(8 測、突變驗證過真會紅)。
    ⇒ **部署後**客人才讀得到條款;在 commit + deploy 之前,正式站仍是死連結、缺口未補。
  - ✅ **version/hash 機制已建立(程式碼層)**:`canonicalLegalPayload()`(只序列化真的渲染給客人看的字,
    不含註解/程式碼)+ `data/legal-content-hash.test.ts` 守門(改字沒 bump 版本就紅、含章節順序敏感度突變自驗)。
    `CURRENT_TERMS_VERSION` = `'2026-07-24'`、`CURRENT_TERMS_CONTENT_HASH` =
    `d6117ee59b6536d156e4bcf78ce3bb2fea30abe8111a49eadb87a08e026bcd6c`;
    `CURRENT_TERMS_CONTENT_HASH` = `eca6a2415d0599c16fbea7ed81316584dab6ba6c7856e4c48f9e5c89514cb6ab`(定稿)。
    🔴 **兩支 migration 皆已 apply(2026-07-24)**:`20260724120000`(首登 hash fd26ac4e…401d)+ `20260724130000`(定稿 hash eca6a241…b6ab;文字因 codex 關卡2 must-fix + Sean Q2/Q3 拍板再次異動)。
    兩支皆經**交易模擬(BEGIN→驗→ROLLBACK、零留痕)**與**突變自驗**(前者:hash 不符確實 RAISE P0001;
    後者:指向已有同意紀錄的版本確實 RAISE、證明「不得覆寫客人簽過的版本」是機制不是註解)。
  - ✅ **已上線(2026-07-24)**:commit 5d5af4c 推 dev+main、production READY、/terms+/privacy 實測 HTTP 200 + 內容正確、DB 版本列 hash=`eca6a241…` 與程式常數逐字一致。本條目**唯一不結案項** = Sean 肉眼驗渲染後 payload。
    ⚠️ **給未來改版的人(現況已滿足)**:改對外文字硬序 = 改文字→取新 hash→寫 migration seed→
    Sean db push 並確認→bump 常數→部署(db push 是 Sean 終端動作:supabase CLI 讀 `.env.local`、Claude 被 settings.json 擋)。
    顛倒的風險**不是「結帳全斷」**(版本列已存在、不 FK 失敗),而是**成功建單但把同意掛到 hash 錯誤的列 = 靜默舉證錯配**(比斷線更難發現);且期間一旦產生 consent,修正檔守衛會拒絕覆寫、只能改開新版本鍵收拾。
    🔴 **db push 會連帶推 S2 pg_cron(`20260723120000`)** —— 該支尚未 apply 且需先建 vault secret,
    故指令須先把它暫移開;S2 之後單獨推時因版本序在前,需 `--include-all`。
  - ⚠️ **未經律師簽核 —— Sean 2026-07-24 答「不用」**(核准矩陣中律師屬選配;Sean 逕行核准發布)。
    不得記為「已完成法務審閱」。
  - ⚠️ **核准對象落差(誠實)**:#291 驗收要求核准「**渲染後完整 payload**」,Sean 核准的是**草稿文字**;
    → 請 Sean 實開 `/terms` `/privacy` 看過後才可收斂;現記為 manifest open_drift `legalRenderedPayloadNotEyeballed`。
  - 🔴 **Sean 2026-07-24 三拍板(codex 關卡2 R2 後)**:**Q1=A** 覆寫既有版本列(牴觸 backlog #291 驗收條件「只能新增不得修改既有列」→ Sean 裁定例外;理由=該版本 0 筆同意、storefront 從未部署,且今天已是 07-24、開新鍵只能用假日期)。**Q2=A** 統一交期口徑三處:`ProductTabs` LINE 提醒去掉「現貨庫存流動快」斷言、`InfoShippingPage` 與 `CheckoutStep1` 的「1-3 個工作天」加「出貨後」前綴(與條款的訂貨 2-12 週分清楚)。**Q3=A** 隱私政策 Cookie/localStorage 段據實改寫為兩段式(頁面載入即背景查價、結帳另送車輛資訊),接受因此再推一次 db push。
  - ⚖️ **七日鑑賞期口徑 = Sean 2026-07-24 拍板 B(三度確認、風險自負)**:全站主張「客製化委任代購商品
    不適用消保法 19 條七日解除權」。⇒ `/terms` 第 10 條已改寫為與 `/info/shipping`
    (`data/rpm-policies.ts`)**同一口徑**,原「站內法律文案自相矛盾」已消除。
    🔴 但一致的是**被查證為站不住的那一側**:準則第 2 條 7 款例外**無「代購」**,
    行政院總說明附表第二款明文「消費者依現有顏色或規格中加以指定或選擇者,**非屬**客製化給付」。
    Claude 建議之選項 D(僅對真客製品逐項標示排除)未獲採納。
    **法源、反駁理由、Sean 已知悉之事實**全部存於 memory `project_seven-day-withdrawal-stance-decision`。
    **Claude 不得自行把口徑改回法律建議版**(那會推翻拍板);要改先問 Sean。
    ⚠️ **未查證項(下次碰法律頁先查)**:「零售業網路交易定型化契約應記載及不得記載事項」是否把
    「排除/拋棄七日解除權」列為**不得記載事項** —— 若是,除該條款無效外另有主管機關限期改正/罰鍰風險
    (準則第 3 條會讓該公告優先適用)。
  - ✅ **已解消**:原「條款承諾各商品頁明確標示客製品、實際沒做」的落差(code-reviewer 抓出)——
    B 案改為**全站一體主張**、條款不再承諾逐項標示,故該不實陳述已不存在。
    per-product「不適用七日」欄位改為選項 D 的配套,僅在 Sean 未來改採 D 時才需要。
- 🔴 **本條目的性質(誠實定位;codex 唯讀審查 R1 must-fix)**:以下所有「不得／必須」目前**只是 prose,
  沒有任何機械守門** —— 沒有 CI 檢查、沒有 deploy preflight、沒有 feature flag 條件會擋下
  「複製 design 草稿建 route 上線」。因此本條目是**人工 release checkpoint**,不是技術上的硬閘;
  真正機械化(deterministic release check:核准內容 artifact/hash ↔ routes ↔ `CURRENT_TERMS_VERSION`
  ↔ `legal_terms_versions` row 四者一致才准 deploy)本身也是 L1 plan 的交付項之一。
  🔴 **2026-07-24 進度與仍缺的那一段(codex 關卡2 must-fix #4)**:四者中的**前三者已機械化** ——
  `legal-content-hash.test.ts` 釘住「對外文字 ↔ `CURRENT_TERMS_CONTENT_HASH` ↔ migration `.sql` 內的 INSERT」,
  三者不同步即三綠紅。**仍缺第四者**:沒有任何檢查會去問**正式 DB** 是否真的存在該 version/hash 那一列 ——
  測試只證明 repo 裡有一支 migration 寫了它,不證明它被 apply 過。
  ⇒ 「apply 前不得部署」目前**仍只是 prose**;要真正機械化需 deploy preflight 連線查 DB(未做、非本片範圍)。
  **因此本條目不得記為「只剩 db push」** —— 正確說法是「只剩 db push,且部署順序仍靠人遵守」。
- **狀態:** ✅ **2026-07-24 全鏈上線**(原 BLOCKED 已解除;兩支 migration apply、推 dev+main、production READY、實測 200)。唯一不結案 = Sean 肉眼驗渲染後 payload。詳本條目頂端。
  (對應實作計畫 `docs/specs/2026-07-20-m3-two-step-checkout-implementation-plan.md` Slice L1)
- **優先級:** 🔴 高(production checkout 開放付款的硬前置)
- **問題(⚠️ 以下為 2026-07-24 之前的原始問題陳述、保留供追溯;現況見本條目頂端「狀態」):**
  - ~~storefront **沒有** `/terms`、`/privacy` route;結帳同意條款的兩個連結是
    `href="#"` + `preventDefault()` 的 no-op placeholder~~ → **2026-07-24 已建 route 並接真連結**
    (🔴 2026-07-22 U2a 起該 markup 位於 `apps/storefront/src/components/CheckoutStep2ReviewSections.tsx`
    的 `CheckoutOrderReview`,原在 `CheckoutStep3.tsx`;定位用 `rg -n '服務條款' apps/storefront/src`
    ——**不寫死行號**,U1/L0 已示範寫死的自指行號會當場變假)→ 客人勾「我已閱讀並同意」時
    **實際讀不到任何條款內容**。
  - #241 已落地的是**同意訊號 + 版本 + 內容雜湊 provenance**,不是完整法律效力;
    其「完整效力需 #235」的字面是**錯誤依賴** —— live #235 的實際標題是
    「🔁 Step3 / 完成頁 退換貨連結 + 客服 LINE 入口」,不是法律頁工作單、
    也不會產出 `/terms`、`/privacy`。本條目(#291)才是法律頁的唯一工作單。
  - 🔴 **`design-reference/components/LegalPage.jsx` 不得直接複製上線**:該檔內容多處明寫
    「草稿待法務 review」,並含假電話／假 Email、尚未實作的服務,以及與 PCM 現有政策衝突的
    七日退貨說法。它**只能**當視覺結構參考。
- **觸發事件(任一觸發即啟動實作):**
  - 兩份正式服務條款與隱私政策內容取得核准(**Sean 必要、法律顧問選配加簽**);或
  - production checkout 準備對外開放付款(此時本條目為**上線前必過的人工 release checkpoint**、
    不得跳過;注意目前無機械守門會自動擋下,見上方「本條目的性質」)。
- **預期解法(未來 plan 的驗收條件,逐條可 yes/no):**
  1. 兩份正式內容經**核准**,plan 內記錄核准人與核准日期;AI 不自行撰寫、不杜撰任何條文。
     🔴 **核准矩陣(不得留「或」的解釋空間,codex R1 must-fix)**:**Sean 為必要核准人**(兩份皆須);
     法律顧問為**選配加簽**(Sean 可自行決定是否送外部法務,但送了就必須把顧問意見一併記錄)。
     即「Sean 核准=必要且最低條件;法律顧問核准=Sean 可加不可省的第二層」。
     ⚠️ **核准對象=實際渲染後的完整頁面 payload**(含由 SSoT 插值進去的所有字面),
     不是只核准兩份原始文字檔。
  2. route 固定為 **`/terms`、`/privacy`**(不另立命名)。
  3. 兩個 route **可匿名讀取**(未登入即可完整閱讀),並有測試證明。
  4. 頁面內的**聯絡資訊取自既有 SSoT**(`apps/storefront/src/lib/site-config.ts` 的
     `LEGAL_NAME`／`TAX_ID`／`CONTACT_PHONE`／`CONTACT_EMAIL`／`STORE_ADDRESS` 等)
     → **零杜撰聯絡方式**。
     🔴 **`apps/storefront/src/data/rpm-policies.ts` 不算已核准來源**(codex R1 must-fix):
     該檔 `:5-6` 自述「該鑑賞期免除是對客戶的法律主張、**Sean 仍在確認準確性**」→
     若法律頁要引用退換貨/鑑賞期字面,**必須先解除該檔的待確認狀態、或把該段納入本條目的核准範圍**,
     否則會出現「兩份主文已核准、但頁面插入了另一段未核准政策」的破口。
  5. 兩份內容使用**唯一一套 canonicalization 與 hash 合成規則**(單一實作 + 測試,
     不得在腳本/migration/前端各寫一份同義公式)。
     🔴 **該規則必須在 L1 plan 內明文定義到可重現**(codex R1 must-fix:目前只寫「唯一」不夠判定):
     至少須指定 ①canonical payload 是什麼(原始 markdown/純文字/渲染後 DOM 文字)②兩份內容的
     **串接順序與 separator** ③SSoT 插值是在 hash 前或後 ④換行/空白/編碼正規化方式。
     未定義完成前不得宣稱條件 5 已滿足。
  6. 新 terms version **不得沿用 `2026-06-30`**(該值已對應舊 provenance)。
  7. `CURRENT_TERMS_VERSION`(`apps/storefront/src/lib/legal/terms-version.ts`)、
     **實際顯示內容**算出的 hash、`legal_terms_versions` 對應 row **三者一致**,並有守門證據。
  8. migration **只能 forward-only 新增版本 row**;不得修改或刪除既有 `legal_terms_versions`
     與 `order_legal_consents` 歷史。
  9. production `supabase db push` **保留 Sean checkpoint**(AI 不自行 apply)。
  10. **所有**同意條款連結改為**新分頁開啟**:`target="_blank"` + `rel="noopener noreferrer"`,
      避免清掉結帳中的資料。🔴 **必改消費端清單(全部都是 blocker、不得只改 checkout;codex R1 must-fix
      指出原文與下方「相關」欄的 RegisterPage 敘述自相矛盾)**:
      ①`apps/storefront/src/components/CheckoutStep2ReviewSections.tsx` 的 `CheckoutOrderReview`
      (結帳同意條款,兩個連結;🔴 **2026-07-22 U2a 起**,原在 `CheckoutStep3.tsx`——
      該檔已於同日 U2b 退役刪除,本條目指向的位置為現役、無需再改)
      ②`apps/storefront/src/components/RegisterPage.tsx`(註冊頁同意條款,兩個連結)。
      🔴 兩處一律不寫死行號(自指行號會當場變假),用 `rg -n '服務條款' apps/storefront/src` 定位。
      兩者皆為現行 `href="#"`;條件 10 要成立**必須兩處都改完**。
- **不修會痛在:**
  - 擴充性:條款頁不存在 → production checkout 無法合規開放付款,整條金流線卡在最後一哩。
  - 可維護性:`CURRENT_TERMS_VERSION` 與 content_hash 目前靠人工雙處同步;沒有「顯示內容 ⇄ hash
    ⇄ DB row」三方守門,下次改版必然漂移且無人察覺。
  - bug 可追蹤性:客人簽的是「看不到內容的同意」。爭議時 `order_legal_consents` **可以**證明
    同意的版本字串與其 FK 指向的 `legal_terms_versions.content_hash`(provenance 這層是有的),
    但**無法證明客人實際可讀到／看到的渲染內容** —— 因為連結是 no-op、頁面根本不存在 →
    舉證鏈斷在最關鍵的一環。
- **估時:** 內容到位後 ~90-120 分鐘(route + 內容搬運 + canonical/hash + 測試 + migration 草案);
  **不含**法律內容產出時間(外部依賴)。
- **依賴:** 🔴 **兩份正式內容取得核准**(唯一 blocker;**Sean 必要、法律顧問選配加簽**,核准對象=渲染後完整 payload);
  其後 = 新 forward-only migration + Sean `db push`。
- **發現於:** 2026-07-20 / M-3 兩步結帳設計 §10「法律頁硬閘」;
  2026-07-21 Slice L0 落為正式 backlog 條目並修正 #241 的錯誤依賴。
- **相關:** [[#241]](同意條款 server 驗 + 同意紀錄;其「完整效力需 #235」字面已於 L0 更正為本條目)、
  [[#235]](退換貨連結 + 客服 LINE 入口;**與法律頁無關**、不得當成法律頁工作單)、
  `docs/specs/2026-07-20-m3-two-step-checkout-design.md` §10、
  `docs/specs/2026-07-20-m3-two-step-checkout-implementation-plan.md` Slice L1、
  `apps/storefront/src/lib/legal/terms-version.ts`、
  `supabase/migrations/20260630120000_m3_241_checkout_consent.sql`(已 apply、歷史註解不回改)、
  `apps/storefront/src/components/RegisterPage.tsx`(註冊頁同意條款連結同為 `href="#"`;
  🔴 **2026-07-21 更正**:原寫「非本條目 blocker」與上方驗收條件 10 自相矛盾 ——
  依條件 10,RegisterPage 與**結帳同意條款所在檔**〔🔴 2026-07-22 U2a 起 =
  `CheckoutStep2ReviewSections.tsx`,原 `CheckoutStep3.tsx`〕**兩處都必須改完**本條目才算完成)
- **🔴 已知殘留舊字面 = 5 個檔案／6 個 line-level 命中(2026-07-21 L0 全樹 grep 後誠實揭示,
  刻意不改、非漏改;數字經 codex 唯讀審查複核):**
  下列位置仍寫「完整效力需 #235」,因屬**凍結歷史紀錄**、L0 範圍不回改;
  未來引用時一律以本條目(#291)為準:
  - `supabase/migrations/20260630120000_m3_241_checkout_consent.sql:23`(已 apply 的 migration,依規不回改)
  - `docs/specs/2026-06-30-m3-241-checkout-consent-plan.md:105`(#241 當次已收案的 slice plan)
  - `PROGRESS.md:323`、`:392`(歷史變更紀錄)
  - `docs/design-storefront-manifest.yaml` `CheckoutPage.last_modified_date` 內
    「前:2026-07-01」歷史段(該欄為逐片累積日誌,新段已於頂端註明作廢)
  - `docs/reviews/2026-06-24-gemini-payment-flow-third-eye-review.md:47`(凍結 review log;
    字面為「條款連結 `href="#"` → backlog #235」,同屬把條款連結指向 #235 的舊指涉)
- **分流標籤:** `P1-before-launch`

---

### #292. 🧩 SSoT 事實重複散落多檔 → 收斂為單一來源(Sean 2026-07-21 拍 A)

- **狀態:** ⏳ 待執行(獨立一片、不塞進任何既有 slice)
- **優先級:** 🟠 中(不擋線,但每次改動都在課稅)
- **問題:**
  - 同一組事實目前**同時寫在 7 個檔案 + commit message** 裡,靠人工同步:
    核准矩陣、commit parent、審查狀態、#291 的定位(人工 checkpoint vs 硬閘)。
  - 🔴 **實證(非推測)**:M-3 Slice L0 為此跑了**四輪外部審查、累計 28 條 must-fix**,
    **每一輪的 findings 都是同一句話**——「修了被點名那一處,漏掉別處等價字面」。
    R3 後已改用「先建事實×位置清單再一次改完 + 逐一 grep 反驗」,**R4 仍抓到 9 條**。
  - 根因不是不夠仔細,是**結構**:N 個副本 × 人工同步 = 漏改機率隨副本數線性上升;
    且有兩個載體特別容易漏 ——**commit message**(用 append 修補、不會回頭重讀開頭)與
    **被判為「凍結歷史/範圍外」而跳過的 active 段落**。
  - 另一個結構坑:**`git commit --amend` 會讓所有自指 hash 當場失效**,SSoT 內寫死的
    commit hash 會變成死 hash(L0 實際發生、由 R4 抓出)。
- **預期解法(Sean 拍 A):**
  - **單一來源制**:每個事實只在**一處**寫全文(法律頁相關=#291),其餘位置一律只留
    **一行指標**(如「核准矩陣詳 #291」),**不複製內容**。
  - 自指數字/hash **一律不寫死**,改記可執行取得方式(`git log --oneline -1` 等),
    對齊既有教訓(STATUS「最近 3 commit」欄已有先例)。
  - 收工前的字面反驗**必須納入 commit message 本身**(它是最常被漏的載體)。
  - 適用範圍先限縮在**本次已知會重複的四類事實**,不做全 repo 大掃除。
- **不修會痛在:**
  - 可維護性:每次改一個事實都要人工掃 7 處;L0 實測代價=四輪審查、28 條 must-fix。
  - bug 可追蹤性:副本之間互相矛盾時,接手者無從判斷哪個是真的(L0 期間 commit message
    頭尾自相矛盾即為實例)。
  - 擴充性:U1-U5 每片都會再產生同類事實,不治本則每片複製一次這個成本。
- **估時:** ~45-60 分(盤點四類事實的所有副本 → 定單一來源 → 其餘改指標 → grep 反驗)
- **依賴:** 無(L0 已收工;建議在 U1 之前或之後獨立做,不與產品線混片)
- **發現於:** 2026-07-21 / M-3 Slice L0 四輪審查後 Sean 拍板
- **相關:** [[#291]](法律頁,本次的單一來源候選)、`docs/handoff/CURRENT.md`、`STATUS.md`
- **分流標籤:** `P1-before-launch`

---

### #293. 🔒 真機驗收缺 HTTPS 通道 → secure-context-only API 在 LAN HTTP 逐個踩雷

- **狀態:** 🅿️ **擱置**(2026-07-22 Sean 拍:真機測試**走正式站、開 1 元商品直接實刷**,不走本地區網;本地 HTTPS 通道對他的實際驗收方式沒有價值)
- **復活條件:** 若日後改回「用手機連本機測結帳互動」,或本地區網又撞到 secure-context-only API 擋路,再回來看本條
- **發現於:** 2026-07-22,Sean 用手機驗收 M-3 U2b 時撞到 `crypto.randomUUID` crash
- **依賴:** 無(可獨立執行);與 M-3 U3a-U5 無先後關係
- **分流:** P2-later(擱置中;Sean 的驗收路徑不經過本地區網,故不擋任何事)
- **優先級:** 🟡 低(不影響客人;擋住「真手機驗收結帳互動」這條路)
- **問題:**
  - 真機驗收目前走 `http://<LAN-IP>:3001`(區域網路 + 純 HTTP)= **非安全環境**
    (實測 `window.isSecureContext === false`)。
  - 瀏覽器的 **secure-context-only API 在此一律不存在**。2026-07-22 已實際撞到第一個:
    `crypto.randomUUID` → `addItem` 直接 throw、整頁 crash、購物車完全不能用
    (該次已用 `crypto.getRandomValues` fallback 修掉,見 `CartContext.tsx` 的 `newCartSessionId`)。
  - 🔴 **但那只是點狀修補**:Fable 對抗審查明確指出「下一個在 LAN HTTP 壞掉的不會是 randomUUID,
    而是 TapPay SDK / secure cookie 之類」——那些**不是我方 code、fallback 救不了**。
- **不修未來會痛在哪:**
  - **真手機驗收結帳互動這條路會再次撞牆**,而且下一次撞到的很可能是第三方 SDK,
    當場無解、只能停下來重新想辦法 —— 正好發生在最需要驗收的時刻(上線前)。
  - 每撞一次就要開一片高風險修補(本次這片就是:動到雙扣去重子、跑滿 codex 兩關 + Fable)。
- **修法方向(擇一,需 Sean 定):**
  - A. 本機自簽憑證跑 HTTPS(如 `next dev --experimental-https` 或自備 cert/key)——
    效果 = **解除 secure-context 前提**,`crypto.*` 這類瀏覽器 API 一次到位。
    🔴 **執行前必查證(未確認、不得直接照做)**:憑證的 SAN 是否涵蓋**手機要連的 LAN IP**。
    codex 關卡2 指出 Next 在未指定 hostname 時,憑證可能只含 `localhost`/`127.0.0.1`/`::1`,
    手機用 LAN IP 連會憑證 hostname 不符 —— 光信任 CA 不夠。需查當版是否支援指定 hostname,
    或自行產生含 LAN IP SAN 的憑證。
    ⚠️ 也**不等於「修好所有問題」**:TapPay 等第三方 SDK 在該環境的行為仍須另外實測。
    代價 = 每台要驗收的裝置都要信任 CA(Sean 手動步驟)。
  - B. tunnel(cloudflared / ngrok)給一個真 HTTPS 網址 —— 零裝置設定;
    代價 = **把 dev build 對外公開**,屬對外可見動作、需 Sean 明確批准,且不應長期開著。
  - C. 維持現況,只在撞到時逐個點狀修 —— 成本分攤但總量最高,且會在驗收當下才爆。
- **關聯:** memory `reference_pcm-mobile-device-verify-dev-vs-prod`(真機驗互動必用 production build);
  本次 fallback 修補見 `CartContext.tsx` `newCartSessionId` 與其 commit。
- **估時:** A 約 30-60 分鐘(含 Sean 裝憑證);B 約 15 分鐘但需批准;C = 0 但持續課稅。

### #294. 🔑 CRON_SECRET 三 route 共用 → 拆獨立 secret(或 email-sweep 補獨立 secret + durable throttle)

- **狀態:** ⏳ 待執行(S4 前評估;不擋 S2)
- **優先級:** 🟠 中(洩漏放大面;非即時金流風險)
- **問題:**
  - 單一 `CRON_SECRET` 同時保護 **settle-sweep + anomaly-alert + email-sweep** 三支 cron route(三者各自 `requireCronSecret()` 讀同一 `process.env.CRON_SECRET`)。🔴 `apps/storefront/src/lib/cron/rate-limit.ts:3` 的威脅模型註解只列 **settle-sweep 與 anomaly-alert 兩支、漏 email-sweep** → 本條一併順修該註解。
  - 其中 **email-sweep 無 `*_ENABLED` flag**(firing 由 pg_cron 是否存在控制)→ 持有洩漏之 CRON_SECRET 者可觸發客戶寄信(outbox 有列時);限流僅 **per-instance best-effort**(非全域硬上限)。
  - ⇒ CRON_SECRET 洩漏衝擊**大於**「僅冪等 sweeper 觸發」。(settle/anomaly 偽觸發仍不能偽造付款——settleCharge 冪等、Record 唯一權威。)
- **觸發事件:** 2026-07-24 S2 pg_cron 落地時 codex 關卡2 抓出(原 S2 migration 頭註誤述 cron_secret「僅守冪等 sweeper」)。
- **預期解法:**
  - A. 三把獨立 secret(payment / anomaly / email),各 route 讀各自 env、pg_cron wrapper 帶各自 Bearer。
  - B. 至少給 email-sweep 獨立 secret + durable(跨 instance)throttle,縮小「無 flag + best-effort 限流」的放大面。
- **不修會痛在:**
  - 擴充性:未來任一 cron route 洩漏或需輪替,牽動全部三支(一把 secret = 一次全換、全部重設 pg_cron/Vercel env)。
  - 可維護性:blast radius 難界定,事故時要同時盤三支 route 的影響。
  - bug 可追蹤性:三支共用同源,log/告警無法從 secret 區分是哪支被濫用。
- **估時:** A 約 60-90 分鐘(動三 route env + pg_cron wrapper + Vercel + 事故 SOP);B 約 30-45 分鐘。
- **依賴:** email-sweep 的 pg_cron(email 線 E2b,尚未落地)一併考量;與 S2 pg_cron 基礎設施相鄰。
- **發現於:** 2026-07-24 / M-3 S2 codex 關卡2。
- **相關:** `supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql` 頭註殘餘風險;`apps/storefront/src/lib/cron/rate-limit.ts`;S2 slice plan §11。

### #295. 🚚 免運門檻／運費金額改後台可管理(取代雙處 hardcode)

- **狀態:** ⏳ 待評估(Sean 2026-07-25 提出;**明確不進退刷自動化線**、該線收工後再評)
- **優先級:** 🟡 中低(今日零痛點——門檻自 2026-06-04 定為 5000/100 後從未調整;痛點在「Sean 想自己調價卻得找 AI 改 code + Sean db push」)
- **問題:**
  - 免運門檻 `5000` 與宅配運費 `100` 是**雙處 hardcode**:TS 側 `packages/domain/src/order/shipping.ts:26,32`、SQL 側 `create_order` RPC §7(`20260716190000_m4a_v3a_create_order_vehicle_whitelist.sql:260`)。#216 已建 drift gate 守兩處同步,但**兩處都要改 code**。
  - 內容分級目前標 **L2**(`shipping.ts:9` 自述「季度可能調整」= hardcode + backlog 合規)。若 Sean 實際調整頻率上升,分級應重判;**頻率拿不準預設當 L3**(鐵則 9)。
  - Sean 2026-07-25 原話:「免運門檻、運費多少 是不是應該改成我可以在後台管理修改反而比較簡單?還是更難....」
- **觸發事件:** 2026-07-25 退刷線 Q6(退款重算運費要用當下規則還是下單凍結規則)拍 B=凍結 → 引出「規則本身該不該可管理」。
- **預期解法:**
  - A. **規則表 + 生效版本**(推薦最終型):新表 `shipping_fee_policies`(threshold / home_fee / effective_from / active)+ admin CRUD;`create_order` §7 改讀當前生效列;前台 `calculateShippingFee` 由 server 傳入當前規則。🔴 **必須 CREATE OR REPLACE 654 行、9 參的 `create_order` 金流 RPC** = 鐵則 12 ①錢+③DB,需交易模擬 + 四層審。
  - B. **只做 admin 唯讀顯示 + 改動 runbook**:不動 RPC,把「改運費要動哪兩處 + 怎麼驗 drift gate」寫成 SOP,Sean 提需求由 AI 執行。成本極低、但沒解決 Sean 的自助需求。
- **不修會痛在:**
  - 擴充性:未來要做「滿額免運活動」「不同配送方式各自費率」「離島加價」時,雙處 hardcode 會變成雙處 if-else 疊加,create_order 每次都得動。
  - 可維護性:每次調價=一次 code 改動 + Sean db push + 部署,調價從「填個數字」變成一次完整發版風險。
  - bug 可追蹤性:調價後無任何「何時改的、誰改的、舊值多少」紀錄;對帳看到舊單運費與現行規則不符時無從查證(RF2a-0 的凍結欄只解退款側、不解稽核側)。
- **估時:** A 約 4-6 小時(表 + seed + create_order RPC 改寫 + backfill + 前台傳遞 + admin CRUD + 交易模擬 + 四層審);B 約 30 分鐘。
- **依賴:** 🔴 **退刷自動化線全線收工後才評估**——理由:A 案要動的 `create_order` 正是 07-24「補差額商品免運」片 Sean 拍 A 案(走自取路)刻意避開的高風險函式;退刷線本身已是最高風險線(錢+權限+DB),中途疊加動建單 RPC = 兩個高風險同時在飛。RF2a-0(凍結欄)先落地後,本條的 A 案與凍結欄**不衝突**(凍結欄=歷史快照、規則表=當前設定,兩者並存)。
- **發現於:** 2026-07-25 / M-3 退刷線 Q6 拍板當下(Sean 主動提問)。
- **相關:** #216(運費門檻雙處 hardcode drift gate);PRD `docs/specs/2026-07-24-refund-automation-line-prd.md` §0c + §4 RF2a-0;`packages/domain/src/order/shipping.ts`;鐵則 9 內容分級。

### #296. 💸 儲值金表單按 Enter 會變成「扣款」(隱式提交選到第一顆 submit)

- **狀態:** ✅ **完成**(2026-07-26,Sean 拍 **A 的 reorder 變體**〔非下方併列的 hidden-submit 變體〕;**既有問題、非 E11-2 引入**,E11-2 對抗審查時由 opus 順帶挖出)
- **修法(已落地):** `wallet-adjust-submit.tsx` 兩顆 submit 的 DOM 順序對調 ⇒「加值」第一顆、「扣款」第二顆,Enter 落在安全方向。守門斷言 = `shared/admin-form-consumers.test.tsx`「第一顆 submit 必須是 deposit」(**突變 5/5 全紅**:改回原順序 / 在前面插一顆新 submit / 插 `<button type="">` / 插 `<button type="garbage">` / 加值鈕掛 `formAction` 覆寫,五種都被抓到)。
- 🔴 **殘留 → 已另立 #297**:對調後「扣款」落在 `justify-end` 動作列的**最右**=慣用主要動作位置,而扣款**無二次確認**、RPC 無下界(可扣成負餘額)⇒ 照肌肉記憶點最右仍會直接扣款。opus C3 與 codex 關卡2 must-fix 1 獨立雙命中。**Sean 2026-07-26 看過可互動比較頁後拍 C=現況收案**,完整解走 **#297**。
- 🔴 **承重事實(親讀 Blink 原始碼確認,非引述)**:Enter 打到誰,只看**第一顆 submit 鈕**。第一顆若被 disable,規範與 Blink 都是**整個放棄隱式提交、不往後找下一顆**(`HTMLFormElement::SubmitImplicitly` 的 `// Default (submit) button is not activated; no implicit submission.` 分支)⇒ 單純 disable 加值**不危險**,Enter 會什麼都不做。真正的迴歸風險是**有人移走加值或改排序**讓扣款變第一顆,那正是守門測試鎖的。
- ⚠️ **查證教訓**:codex 關卡2 R1 曾稱「2026-04 Chromium 已改成往後找第一顆 non-disabled submitter」(引 WPT 同步 commit `ef936beb`),我照抄進註解;**R2 codex 自行更正、主對話再親讀 chromium/main 原始碼確認 R1 說法錯誤**。⇒ 外部行為事實不可只憑 commit message 或 subagent 轉述。
- **優先級:** 🟠 中(不影響客人;是**員工誤操作直接動到錢**的路徑,且錯的方向是扣款)
- **問題:**
  - **(以下為修正前的狀態,已於 2026-07-26 修掉;現況=加值第一顆)** `wallet-adjust-submit.tsx:15-23` —「扣款」(`value='use'`)**曾是** form 內第一顆 `type='submit'`,「加值」(`value='deposit'`)第二顆。
  - HTML 隱式提交規則:在單行文字欄按 Enter,瀏覽器選**第一顆 submit** 當 submitter ⇒ 員工在金額欄打完數字直接按 Enter,**當時**送出的是 `direction=use`、扣款。
  - 🔴 親驗:`wallet-form.ts:74` `signedAmount: direction === 'use' ? -amount : amount` ⇒ 真的會寫成負數入帳。當時唯一的攔阻是「備註必填」——但備註若已填,Enter 就直接扣款成功。
- **觸發事件:** 2026-07-26 / E11-2 `<AdminForm>` 積木片,opus 對抗審查 C3(該檔不在該片 diff 內,故不擋該片 commit)。
- **預期解法:**
  - A. 在兩顆之前放一顆 `hidden` 的預設 submit(或把「加值」排第一顆)⇒ 讓 Enter 落在**安全方向**。🔴 排序會改變視覺,屬 Sean 拍板範圍。
  - B. form 加 `onKeyDown` 攔 Enter 不隱式提交(需 client 化,較重)。
  - C. 維持現狀 + 依賴二次確認(目前**沒有**二次確認 ⇒ 等於不處理)。
- **不修會痛在:**
  - 擴充性:未來任何「兩顆方向相反的 submit」表單(退款/取消、進貨/退貨)都會複製同一個地雷,沒有共用防護。
  - 可維護性:**(修正前)** 此行為由 HTML 規範 + DOM 順序隱式決定,當時不在任何測試或註解裡 ⇒ 有人調整按鈕排版就會靜默改變 Enter 的語意。**現已補上檔頭承重註解 + 守門測試,此痛點解除。**
  - bug 可追蹤性:誤扣款與正常扣款在 `wallet_ledger` 完全同形(同 `entryType='use'`、同操作者),事後**無法從資料分辨是誤按 Enter 還是刻意扣款**,只能靠客訴。
- **估時:** A 約 15-20 分鐘(含 Sean 拍板按鈕順序 + smoke test);B 約 40 分鐘。
- **依賴:** 無;可獨立執行。與 E11-2 積木無耦合(該檔未被積木化)。
- **發現於:** 2026-07-26 / M-4b E11-2 opus 對抗審查 C3。
- **相關:** `apps/admin/src/components/customers/wallet-adjust-form.tsx`;`apps/admin/src/lib/customers/wallet-form.ts:54-74`;D1 決策題(儲值金 DB 級去重)。

### #297. ⚠️ 破壞性金錢動作缺二次確認(儲值金扣款為首例;#296 的完整解)

- **狀態:** ⏳ 待執行(Sean 2026-07-26 拍板:**#296 走 C 先收、本條立 backlog**)
- **優先級:** 🟠 中(不影響客人;是員工誤操作直接動到錢,且無自動回復)
- **問題:**
  - `wallet-adjust-submit.tsx` 的「扣款」**沒有二次確認**,按下即寫 `wallet_ledger`(`wallet-form.ts:74` 負數入帳),且 RPC **無下界、可扣成負餘額**。
  - #296 已把「在金額欄按 Enter 會變扣款」修掉(加值改排第一顆),但**點擊路徑仍無防護**:扣款現在落在動作列**最右**=這套後台的慣用主要動作位(訂單頁的「儲存」也在最右)⇒ 照肌肉記憶點最右會直接扣款。
  - 🔴 **Sean 知情接受此殘留**(2026-07-26 看過可互動比較頁後拍 C):判準=Enter 的洞危險在於**完全沒有視覺提示**,而點擊需要瞄準一顆紅框、寫著「扣款」的按鈕,性質不同。
  - 🔴 **明確否決 CSS `order` 方案(原 A 案)**:它把畫面順序與 DOM 順序拆開,Enter 安全性靠 DOM 順序、視覺分隔靠 CSS ⇒ 未來有人看到扣款在左邊會「順手修正」而改回,洞**無聲重開**。**不用「靠人不看錯」的防護守錢。**
- **觸發事件:** 2026-07-26 / #296 修正後,opus 對抗審 C3 與 codex 關卡2 must-fix 1 **獨立雙命中**「Enter 地雷換成點擊地雷」。
- **預期解法:**
  - A. 扣款加確認 Modal,列出**影響範圍**(客人、目前餘額、扣款金額、扣後餘額、可為負)—— 接 E11 積木的「破壞性確認 Modal + 影響範圍內容槽」(UX 審查 §5 #24、§8 E11 驗收加項),**不要為儲值金單獨刻一個**。
  - B. 只加純文字二次確認(較輕,但無法重用)。
- **不修會痛在:**
  - 擴充性:退款、取消訂單、部分退款都是同一類「按下去就不可逆的錢面動作」,現在一個共用確認積木都沒有 ⇒ 每個域各刻一次。
  - 可維護性:防護目前只存在於「按鈕排列順序」這個隱式約定裡(靠 `admin-form-consumers.test.tsx` 一條測試守),加一顆按鈕就可能破功。
  - bug 可追蹤性:誤扣款與正常扣款在 `wallet_ledger` **完全同形**(同 `entryType='use'`、同操作者、同備註欄)⇒ 事後無法從資料分辨是誤點還是刻意,只能靠客訴。
- **估時:** A 約 60-90 分鐘(含 E11 Modal 積木本體 + 儲值金接第一個消費端 + 測試);B 約 25 分鐘。
- **依賴:** 建議與 **E11 `<AdminModal>` 積木**同片做(規格 §3.3;目前尚無消費端,本條正好是第一個真實消費端)。
- **發現於:** 2026-07-26 / M-4b #296 修正片,opus + codex 雙審獨立命中。
- **相關:** #296(Enter 路徑已修);`docs/specs/2026-07-26-admin-ux-operability-review.md` §5 #24(高風險動作「影響範圍」複核頁)+ §8 E11 驗收加項;`apps/admin/src/components/customers/wallet-adjust-submit.tsx`;D1 決策題(儲值金 DB 級去重)。

### #298. 🧾 CI 擋 migration 版本漂移(本地施工單 vs 資料庫登記簿對不上)

- **狀態:** ⏳ 待執行(**Sean 2026-07-29 拍板 A = 加**;原為 STATUS「非阻擋舊題」,報價單實測壞掉後價值上升)
- **優先級:** 🟠 中(不影響客人;壞掉時的症狀是「整條 migration 路徑不能用」,且發現時通常已無法回頭)
- **問題:**
  - 目前「本地 `supabase/migrations/` 檔案」與「remote `schema_migrations` 登記簿」是否一致,**完全靠人記得手動比對**,沒有任何機器守門。
  - 🔴 **同組織內已有壞掉的樣本**:報價單 repo 本地 **146 檔 vs ledger 160 筆、版本號零重疊** ⇒ 該 repo **`supabase db push` 已完全不可用**(memory `reference_quote-repo-migration-ledger-desync`)。壞法不是一次爆掉,是長期無人比對累積出來的。
> 🔴 **`146` / `160` 這兩個數字 2026-08-16(I 窗)實查已過期 —— 但【過期的是理由,不是結論】。**
> **`supabase db push` 的禁令仍然成立、不得因為本註解而放行。**
> 真因未變:MCP `apply_migration` **自動生成時間戳**,與手工命名檔**仍會再分歧**
> (鐵則出處 memory `reference_quote-repo-migration-ledger-desync`)。
> ⚠️ **本註解【不填新數字】** —— 正確的雲端筆數要 DB access(即未解的 `§5③`),硬填會把一個過期數字換成一個沒來源的數字。
> **現況以報價單 repo `docs/ops/DB_BASELINE.md` 為準**(該檔記載 2026-07-30 已重建帳本、雲端 ledger 重置為單筆 baseline)。
> **可重跑量法**:`git -C /Users/sean_1/API大量上架/PCM報價單-V2 ls-tree --name-only origin/main supabase/migrations/ | wc -l`(2026-08-16 實得 `16`)。
> ⚠️ **另注**:`DB_BASELINE.md` 自己記的重建前狀態是 **`158` 檔 / `176` 筆**,**與本處的 `146`/`160` 對不上**
>   ⇒ **本處這組數字在重建之前可能就已經是舊的**。兩組都不要引用,一律回去看來源檔。

  - 本 repo 現況乾淨(2026-07-29 實查:`migration list` **85 支**、local-only 0、remote-only 0、版本號不一致 0),但**乾淨的原因是人有記得,不是機器擋著** —— 換一個 session、換一個人就重演報價單的路徑。
- **觸發事件:** 2026-07-27 查報價單 2FA 線時撞到「報價單不能跑 `db push`」,回頭發現本 repo 用的是同一套沒有守門的流程;2026-07-29 Sean 拍板加。
- **預期解法:**
  - CI job 對每個 PR / push 跑一次比對:列出 local-only 與 remote-only 版本號,任一非零即紅。
  - 🔴 **需要 remote 讀取憑證** ⇒ secret 管理是本條的真難點,不是比對邏輯。若不想把憑證放進 CI,退而求其次 = 純本地 pre-commit hook 只驗檔名格式與單調遞增(**擋不住真漂移**,採用前必須照 memory `feedback_control-named-beyond-its-actual-power` 寫明它擋不住什麼)。
- **不修會痛在:**
  - 擴充性:第 2/3 批還有大量 migration 要上,漂移一旦發生,後面每一支都推不動。
  - 可維護性:報價單已證明「補救成本」遠高於「預防成本」—— 那邊現在要人工重建 160 筆對應關係。
  - bug 可追蹤性:漂移沒有告警,發現的方式一律是「某天 `db push` 突然失敗」,而那時已經分不清哪幾支是真的沒 apply。
- **估時:** 60-90 分鐘(比對腳本 30 分 + CI 接線與 secret 40 分 + 負向測試:故意造一支 local-only 驗證它真的紅)
- **依賴:** 🔴 **動 CI = 鐵則 12 ④平台設定 = 高風險片**,且屬鐵則 8「重大改動」⇒ **先提 plan 等 Sean 批准、commit 前必過 codex 關卡2**。不插隊 E10 第 1 批。
- **發現於:** 2026-07-27 / 報價單 2FA 線偵察;2026-07-29 Sean 拍板 A。
- **相關:** memory `reference_quote-repo-migration-ledger-desync`(壞掉的樣本)/ `project_supabase-migration-version-drift`(正式 schema 用 `db push` 不用 MCP)/ `reference_supabase-cli-reads-env-local-blocker`(CLI 被 `.env.local` 擋住的繞法,CI 環境要一併考慮)。

### #299. 🔴 `product_fitments_effective` 整張正式資料表不在版控裡(repo 無法從零重建資料庫)

- **狀態:** 🔴 立即啟動(**2026-07-29 D1a6 演練實測撞到**;#298 的守門**抓不到這一類**)
- **優先級:** 🔴 高(不影響客人;但「災難時用 repo 重建 schema」這條路現在是斷的)
- **問題:**
  - `public.product_fitments_effective` 在正式站是一張**完整的資料表** —— 148,716 列、PK、3 個索引、5 個 CHECK、對 `products` 的 FK(`ON DELETE CASCADE`)、RLS 已開。
  - **`supabase/migrations/` 裡沒有任何一支建立它。** 它只存在於正式站,是當初在 SQL Editor / MCP 手動建的。
  - **4 支 migration 引用它**:`20260712183000_products_catalog_page_public.sql` / `20260712193000_catalog_rpc_expose_fitments.sql` / `20260712213000_p4_catalog_rpc_split_generic_plan_replay.sql` / `20260719150000_catalog_product_image_trim.sql`。其中 `search_catalog_by_vehicle` 是 `LANGUAGE sql`,函式本體**在建立當下就會解析** ⇒ 表不存在即整支 migration 失敗。
  - **實測證據(2026-07-29)**:建 preview branch `d1a6-restore-rehearsal` → 狀態 `MIGRATIONS_FAILED`、**85 支只跑了 54 支**、卡在 `20260712142722` 之後;缺 `order_legal_consents` / `email_outbox` / `order_refunds` / `order_refund_items` 四張表。手動補上該表後 rebase 即繼續往下跑。
- **🔴 為什麼 #298 抓不到:** #298 比對的是「本地檔名 vs remote `schema_migrations` 版本號」,而這兩邊**完全一致**(85 支、local-only 0、remote-only 0)—— 它會回報「乾淨」。**版本號對齊不等於 migrations 建得出這個 schema。** 真正抓得到的檢查只有一種:**把全部 migration 套到空資料庫,再把結果與正式站的 schema 逐項 diff**。
  ⇒ 這正是 memory `feedback_control-named-beyond-its-actual-power` 那條:防護的名字比它實際擋得住的範圍大。#298 上線前必須先寫明「它擋不住整張表沒進版控」。
- **不修會痛在:**
  - 擴充性:任何新環境(preview branch / 新開發庫 / 災難重建)都建不起來,而且失敗點在 2026-07-12,後面 31 支全部連帶不跑。
  - 可維護性:同一個坑幾乎一定不只這一張 —— 需要一次全面 diff,不是補完這張就結束。
  - bug 可追蹤性:症狀是「新分支 migration 失敗」,而錯誤訊息指向的是**引用它的那支 migration**、不是缺失的那張表,查起來會先懷疑錯地方(本次實測即如此)。
- **預期解法:**
  1. 先做**全面 diff**:空庫套完 85 支 → 與正式站 schema 逐項比對(表 / 欄 / 索引 / 約束 / 函式 / view / RLS policy),產出完整缺漏清單。**先知道有幾張,再決定怎麼補。**
  2. 對每個缺漏補一支**冪等**的補登 migration(`CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE`),使其對正式站是 no-op、對空庫是建立。
  3. 補登後重建一次 preview branch 驗證 85 支全綠 = 可機械複驗的驗收條件。
- **估時:** diff 60-90 分鐘(多半是比對腳本)+ 補登視缺漏數量而定
- **依賴:** 🔴 **動 migration = 鐵則 12 ③ = 高風險片**,須先提 plan 等 Sean 批准、commit 前過 codex 關卡2。與 #298 互為前後:**先補齊(#299)再上守門(#298)**,否則守門一上線就紅、或更糟 —— 綠著卻沒在守。
- **發現於:** 2026-07-29 / D1a6 還原演練建 preview branch 時實測撞到。
- **相關:** #298(版本號守門,抓不到本條)/ memory `project_supabase-migration-version-drift` / `feedback_control-named-beyond-its-actual-power`。

### #300. 🔔 訂單編號產號用盡時無告警(N3b-app 未做)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - `create_order` 產 6 碼訂單編號時,若連續 5 次撞號會 `RAISE`(SQLSTATE `P0001`、
    message 含 token `pcm_display_id_exhausted`),客人看到一般結帳失敗、**沒有任何人被通知**。
  - master-plan v2 §5.4b 原本有一片 **N3b-app** 專門處理:`placeOrder` use-case catch 該 token →
    走既有 `packages/adapters/src/payment/LineAlertNotifierAdapter` 送 LINE 告警 + server log,
    對客回一般結帳失敗(不洩內部細節)。規格 R7 逐字要求「**N3b-app 先於 N3b 部署**」。
- **觸發事件:**
  - 2026-07-30 N3a/N3b 施工前,Sean 拍板 **Q1=A 延後**、只做 N3a + N3b 兩片(後加 N2)。
  - 延後依據(明寫,以免日後被當成「不需要」):碰撞機率 ≈ `(N / 4.82e8)^5`,N = 新格式單數、
    上線當下為 **0**;且**不比現狀差** —— 現在任何 RPC `RAISE` 同樣是無告警的一般結帳失敗。
  - 🔴 **不是因為它不需要,是因為它此刻不緊急。** N 隨營運成長,這條的價值隨之上升。
- **預期解法:**
  - 照 master-plan v2 §5.4b 的 **N3b-app** 片實作(A 片型):catch token → LINE 告警 + server log。
  - 附負向測試:模擬 RPC `RAISE`,assert 告警確實送出**且**對客錯誤不含內部細節。
  - admin 手動建單 action 的同款 catch = 第 3 批建單片 DoD(§5.3 項 10)。
- **不修會痛在:**
  - 擴充性:日後訂單量成長、或字母表/長度被改短(降低空間)時,撞號從「天文數字」變成
    「偶發」,而系統仍然不會告警 —— 缺口會在最需要它的那一天才被發現。
  - 可維護性:`pcm_generate_display_id()` 的 `RAISE` token 是刻意設計的告警接口,
    沒有消費端 = 一個宣稱存在但沒接線的機制(與 `feedback_control-named-beyond-its-actual-power` 同型)。
  - bug 可追蹤性:客人回報「結帳失敗」時,無法區分是產號用盡還是其他 RPC 錯誤,
    只能靠翻 server log 猜。
- **估時:** 30-45 分鐘(含負向測試)
- **依賴:** N3b 已上線(否則該 token 不存在);`LineAlertNotifierAdapter` 已就緒(已在)
- **發現於:** 2026-07-30 / N3a-N3b slice plan §7 開放項 1
- **相關:** master-plan v2 §5.4a/§5.4b、`docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md`

### #301. 🔴 TapPay Record API 三處欄位假設經實測為誤(`wire.ts:68` 宣稱不實)

- **狀態:** ✅ **已修(2026-07-30;Sean 拍板 Q1=A 身分閘改比 `original_amount` / Q2=A 順手改對已退場的 D1 矩陣。
  另有一題 Q3 只決定「這片送誰審」= 先試 codex,不是本條的技術決策、不影響修法)**
  - 🔴 **codex 關卡2 R1 判 NO-GO:6 must-fix + 5 nit,全數接受、駁回 0**,最重一條是
    **本次修法自己新增的洞** —— 改比 `original_amount` 之後,`{original_amount=orders.total, amount=0,
    record_status=1}` 這種「錢已退光卻宣稱交易完成」的矛盾紀錄會被判 **paid**(status 5 則 markFailed 釋鎖),
    而舊碼的 amount 閘擋得住。已加兩道閘(**非退款態** `amount` 必須完好、`refunded_amount` 必為 0),
    並補四條矛盾紀錄測試。
    🔴 **措辭更正(R2-6)**:折入的第一版寫成「官方守恆式 `amount + refunded_amount = original_amount`」——
    **官方欄位表沒有這條式子**,那是從三欄語意推導的;且若 `refunded_amount` 對多次部分退款回單次金額,
    合法紀錄會被擋在退款告警之前。已收斂成只約束非退款態(等價於「退款額必為 0」),**code 裡沒有那條等式**。
  - 🔴 **本片實際改到的範圍(比 #301 標題大,逐條列出以免日後誤以為只改了欄名)**:
    ①身分閘改比 `original_amount`(**Sean 唯一拍板的一項**)②③ 上述兩道收尾閘
    ④**hint 回核**(用 hint 查詢時,回應的 `rec_trade_id` 必須就是那把 hint)
    ⑤**弱識別不得 markFailed 釋鎖**(審查過程中新增的行為變更;**Sean 2026-07-30 拍板 A 追認留著** ——
    逐字取捨:「寧可你多花時間處理幾張單,也不要客人被扣兩次錢」)。
    ④⑤ 都因為「弱識別路徑在 #301 之前恆 fail-closed、本片讓它活了」才需要;
    Fable R3 已獨立確認 ⑤ = **維持正式站現行行為**(git 查證欄名自 `3286a30` 引入後從未改過 ⇒ 該路從未 terminal)。
  - ⚠️ **退款告警的涵蓋範圍(Fable R3 F6;避免日後誤信)**:`settleCharge` 對已 `paid` 的訂單會**先短路**、
    不查 Record ⇒ 真實世界最常見的退款形態(已付款訂單事後被退款,= 0102/0104 本尊)**永遠不會觸發**這條告警。
    本片讓告警會響的母體只有「unpaid + 有 active attempt + Record 顯退款態」。已 paid 單的退款屬退款線(RF)。
  - 🔴 **上線後要驗一件事(Fable R3 F4)**:`time` 欄的毫秒單位**只有官方文件背書、實際值從未被觀察**。
    若它其實是秒,弱識別時間窗恆 false ⇒ 本片主要修復在正式站**靜默無效**(與 #301 原病同型)。
    ⇒ 已在 `settleCharge` 補非 PII `console.warn`(`reason: 'window'`)當活性信號;
    上線後看到大量 `window` 就是這個病,或用 `d1-readback` 對已知紀錄驗一次量級。
  - 官方文件已親讀(自抓 `reference.html` 原始 HTML 解析,非小模型摘要)。
  - 🔴 **證據分層(關卡2 R2-11 更正,原寫「與 07-30 實測逐格對照」不成立)**:實測只證明了
    **鍵存在**(33 鍵)與**四個欄位的值**(`amount`=0 / `refunded_amount` / `record_status`=3 /
    `is_captured`=false);`original_amount` 與 `time` 的**值從未被觀察**(當時 parser 沒讀)⇒
    這兩欄只有官方語意背書,測試 fixture 內的數字是合成的。
  - 🔴 **本條原文第 ② 點是誤推、已更正**:`refunded_amount` 官方逐字就是「**退款金額**」(已退多少),
    不是「原本金額」。07-30 只有**全額退款**樣本,那種情況下「已退金額」與「原始金額」**恆等**
    ⇒ 該樣本在型式上分辨不出兩種解讀,是當時直接從 101/1180 下的結論。語意以官方文件為準。
  - 真正的第 ② 點是:**原始金額在 `original_amount`**(官方逐字「不會因款項被退款而受影響」),
    而 `amount`「會因退款而減少」⇒ 拿 `amount` 當授權金額對帳才是錯的那一步。
  - 🔴 **順帶抓到一個未知的真 bug**:`settle-charge.ts` 的弱識別時間窗讀不存在的欄位 ⇒ 值恆 undefined
    ⇒ **弱識別路徑(無 rec_trade_id / bank_transaction_id、靠 order_number 反查)從未成立過、一律卡 pending**;
    而 10 條測試在 fixture 裡自帶那個不存在的欄位 ⇒ 全綠、測的是一條現實中到不了的路。
  - 修正範圍:`wire.ts` / `TapPayTradeRecord` / `TapPayChargeAdapter` / `settle-charge.ts`(身分閘改比
    `original_amount ?? amount`、時間改讀 `time`)/ `scripts/d1-readback.ts` 矩陣 / `docs/reference/tappay-reference.md` §2.2。
- **原狀態:** 🔴 立即啟動(退款線 RF2b 開工前的硬前置)
- **優先級:** 🔴 高
- **問題:**
  - `packages/adapters/src/tappay/wire.ts:68` **逐字宣稱**欄名「以官方 Record API reference 核實」,
    但 2026-07-30 對**真 TapPay 正式商戶**實測,三處與實回應不符:
    1. 已**全額退款**的紀錄 `amount` 回 **0**,原始金額在 `original_amount`
    2. `refunded_amount` 放的是**原本金額**(= `orders.total`),而非規格假設的「已退金額 = amount」
    3. 🔴 **`transaction_time_millis` 這個欄位根本不存在** ——
       實有 `time` / `cap_millis` / `transaction_complete_millis` / `bank_transaction_*_millis`
  - ⇒ 那行註解是一條**未經驗證卻被寫成已核實**的斷言(`feedback_falsifiable-prediction-beats-endorsement`
    的實例:註解裡的「已核實」也是一條沒被測的斷言)。
- **觸發事件:**
  - 2026-07-30 D1b1 首次對真 TapPay 正式商戶執行 Record API 查詢時發現(該次判定 `readback-aborted`)。
  - 🔴 **退款線 RF2b-RF8 會直接踩到** —— 任何用 Record API 判定「是否已退款 / 退了多少」的邏輯,
    建立在上述三個錯誤假設上都會算錯錢。
- **預期解法:**
  1. **先重查官方文件**(親讀、附 URL,不憑記憶、不憑舊註解)並與 07-30 實測回應逐格對照。
  2. 更正 `wire.ts` 的欄名與型別;宣稱改成「**2026-07-30 對正式商戶實測 + 官方文件雙來源**」,
     並標出兩者不一致處(若仍不一致,以實測為準並明寫)。
  3. 補一組以**真實回應形狀**為 fixture 的測試(至少涵蓋:未退款 / 全額已退款 兩種形狀)。
  4. 連帶檢查 `scripts/d1-readback.ts` 的判定矩陣(它要求 `refunded_amount = amount`,
     在全額退款情境下實際是 `refunded_amount = orders.total`、`amount = 0` ⇒ 該條件永遠不成立)。
- **不修會痛在:**
  - 擴充性:退款自動化(RF2b-RF8)整條線的判定基礎是這三個欄位,錯的假設會擴散到每一片。
  - 可維護性:程式碼裡有一句**明確的假保證**,後人會信它而不去重查 —— 比沒有註解更危險。
  - bug 可追蹤性:金額判定錯誤不會拋錯,會**靜默算錯錢**(退多或退少),
    且錯的方向取決於是全額退款還是部分退款,難以從結果反推根因。
- **估時:** 1-2 小時(查證 + 改 + 測);屬鐵則 12 ①錢 ⇒ 需對抗審查
- **依賴:** 無(可獨立進行);但**必須排在 RF2b 之前**
- **發現於:** 2026-07-30 / D1b1 首次真實商戶取證
- **相關:** memory `project_m4b-d1c-delete-cancelled`、`docs/reference/tappay-reference.md`、RF2b-RF8

### #302. 💸 補差額用 1 元商品仍被收 NT$100 運費(免運從未實作)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(它讓「補差額」這個用途實際上不可用)
- **問題:**
  - 賣場的 1 元商品(handle `pcm-balance-payment`、變體 `PCM-BALANCE-1`)是給客人**補付差額**用的,
    不是真的買東西。但結帳仍照一般規則加運費 ⇒ 客人要補 NT$1 卻付 NT$101。
  - 🔴 **2026-07-30 實錘**:真刷單 `PTNGY2` = `subtotal=1 / shipping_fee=100 / total=101`。
  - **這不是 bug,是規則照設計運作**:`shipping_free_threshold=5000`、`shipping_home_fee=100`、
    `shipping_method=home`、`subtotal=1 < 5000` ⇒ 收 NT$100。RF2a-0 的凍結欄位如實生效。
    缺的是「這個商品應該免運」這條**從未被實作過**的例外。
- **觸發事件:**
  - 2026-07-24 首筆真刷(`PCM-2026-0102`)當下就發現並記在
    memory `project_m3-first-real-charge-success-2026-07-24`(逐字「🔴 缺免運…用途待解」),
    但**沒有開 backlog 編號** ⇒ 2026-07-30 Sean 再次指出時,它只存在 memory 裡。
    (本條就是為了讓它不再只靠 memory 存活。)
- **預期解法(需 Sean 先拍板走哪條):**
  - **A. 商品層免運旗標**:`product_variants` 或 `products` 加 `shipping_exempt boolean`,
    `create_order` 段 7 計運費時若整車全是免運品項 ⇒ 運費 0。
    🔴 動 `create_order` = 鐵則 12 ③,且要處理「免運品 + 一般品混車」的語意(誰付運費)。
  - **B. 不動結帳,改用途**:補差額不走賣場,改由後台手動建單 / 手動收款
    (E10 的「後台手動建單」片本來就要做)⇒ 零金流 code 改動。
  - **C. 維持現狀 + 對客說明**:補差額時告知含運費。最省工、但體驗差。
  - 🟡 **我的傾向 = B**:A 要動 654 行金流函式並新增一個混車語意問題;
    而 E10 遲早要做後台手動建單,補差額本來就更像「後台開一張單」而不是「客人下單」。
- **不修會痛在:**
  - 擴充性:A 案若日後要做,「免運品混車」的語意會變成必須回答的新問題(誰付、算誰的門檻)。
  - 可維護性:1 元商品現在是一個**實際不能用於宣稱用途**的商品,留在賣場會被誤用。
  - bug 可追蹤性:客人補 NT$1 被收 NT$101,會以為系統算錯錢 —— 客服無從解釋(規則是對的)。
- **估時:** B 案 = 隨 E10 後台建單片(零額外);A 案 = 1-2 片高風險
- **依賴:** A 案需 Sean 先答「免運品混車誰付運費」;B 案需 E10 後台手動建單片
- **發現於:** 2026-07-24 首筆真刷 / 2026-07-30 Sean 再次指出並實錘 `PTNGY2`
- **相關:** memory `project_m3-first-real-charge-success-2026-07-24`、#295(運費後台管理)、
  `docs/specs/2026-07-24-m3-balance-payment-product-seed.sql`

### #303. 🔒 達 ceiling 的卡單沒有自動釋鎖,且後台沒有解鎖工具

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(真實客人可能被永久擋住重刷,但需先踩到 ceiling)
- **問題:**
  - `expire_stuck_attempts_at_ceiling()` 逐字**只做 `SET needs_manual_review = true`**
    (`supabase/migrations/20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:92`),
    attempt 的 `status` 仍停在 `pending`/`charged` = **仍然 active**。
  - 而 `initiate-payment.ts:59-63` 對同單存在 active attempt 一律回
    `duplicate → settlement_required` ⇒ **那張單鎖到有人手動介入為止、沒有任何自動釋鎖路徑**。
  - 🔴 **後台完全沒有清 `needs_manual_review` 的工具**:實查 `apps/admin/src/` 對
    `needs_manual_review` / `needsManualReview` **零命中** ⇒ 標記出來了也沒有畫面可以處理。
  - 告警 cron 每日一次 ⇒ 最壞情況約 **24 小時**才有人知道有單卡住。
- **觸發事件:**
  - 2026-07-30 修 #301 時,Fable R3 更正主對話寫在 `settle-charge.ts` 註解裡的一句錯話
    (原寫「仍有 `expireStuckAtCeiling` 天花板可回收」)才發現這條路根本不回收。
  - 🔴 **非 #301 造成**,是既有狀態;#301 只是讓它被看見。
- **預期解法:**
  - **A. 給後台一個處理入口**:`needs_manual_review` 清單畫面 + 人工判定後釋鎖的 owner RPC
    (查 TapPay Record → 確認未扣款才釋鎖)。🔴 動金流 = 鐵則 12①,必過對抗審查。
  - **B. 只補告警頻率**:cron 改高頻 + 卡單即時推 LINE。最省工,但人還是只能進 DB 手改。
  - **D. 接線既有但從未被呼叫的自動再確認 use-case**(2026-07-30 codex 關卡2 補列):
    `packages/use-cases/src/reconfirm-expired-orphans.ts` **已經寫好**(12h 孤兒專用人工列再確認、
    barrel 有 export),但**生產呼叫端零命中**(實查:只有 barrel 與註解引用)。
    接上它可以自動收斂**一部分**卡單,不必等 A 案的完整 UI。
  - 🟡 **我的傾向 = D 先、A 後**(原傾向 A,經 codex 提醒後修正):D 的成本最低且用的是既有已寫好的東西;
    但它只涵蓋「12h 孤兒」這一類,**不覆蓋** `expire_stuck_attempts_at_ceiling` 標記的那一類
    ⇒ 仍需要 A 才有「知道了就有工具處理」。B 單獨做不解決任何事。
- **不修會痛在:**
  - 擴充性:E10 第 3 批的「今日對帳」若不含卡單,員工得同時看兩個地方才知道錢的事有沒有卡住。
  - 可維護性:唯一處理方式是工程師進 DB 手改欄位 —— 正是 M-4b 北極星(員工不找工程師)要消滅的那種事。
  - bug 可追蹤性:客人回報「我付不了款」,客服看不到任何異常畫面(單子外觀正常)。
- **估時:** A 案 = 2-3 片(RPC + 讀模型 + UI);B 案 = 1 片
- **依賴:** A 案建議與 E10 第 3 批「待辦檢視 / 今日對帳」同批做;需 Sean 先答 A/B
- **發現於:** 2026-07-30 / #301 對抗審查 R3(Fable)
- **相關:** #294(CRON_SECRET 三 route 共用)、#304、`docs/handoff/2026-07-30-301-tappay-record-handoff.md` §7

### #304. 🔇 退款告警的母體很小 —— 最常見的退款情境永遠不會觸發

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(告警缺口,不影響金額正確性)
- **問題:**
  - `settleCharge` 對 `payment_status === 'paid'` 的訂單**先短路、不打 Record API**
    (`packages/use-cases/src/settle-charge.ts:68`,短路是為了省 rate-limit、設計如此)。
  - ⇒ 真實世界最常見的退款 = **已付款之後才在 TapPay 端退款**(`PCM-2026-0102` / `0104` 本尊)
    **永遠不會走到**退款偵測那段程式 ⇒ 那條告警的母體只有
    「unpaid + 有 active attempt + Record 顯示退款態」這個窄集合。
  - ⚠️ 誠實邊界:這**不是** bug —— 短路有它的理由,而且 #301 補的 5 道閘在該窄集合內是有效的。
    缺的是「已付款單的 TapPay 端退款」這件事在系統裡**沒有任何偵測管道**。
- **觸發事件:**
  - 2026-07-30 修 #301 時順帶盤出。🔴 **非 #301 造成**。
- **預期解法:**
  - ~~**A. 接 TapPay Notify webhook**~~ 🔴 **2026-07-30 codex 關卡2 駁回、已作廢**:TapPay 的 Backend Notify
    只定義「**交易完成**」事件,**沒有退款事件**;退款依官方規定是**隔日**用 Portal 或 Record API 複核
    (`docs/reference/tappay-reference.md:112-118`)。照 A 案施工會等一個不存在的 webhook,
    而原本寫的「含 webhook 驗簽」也與「官方無簽章機制」的現況衝突。**不要再提這個選項。**
  - **B. 低頻對帳掃描**:每日對已 `paid` 的近期訂單抽查 Record,發現 `record_status=3` 就告警 + 標記。
  - **C. 不做**:退款一律由員工在後台操作(E10 第 3 批退款線),TapPay 後台單邊退款視為不該發生的事。
  - 🟡 **我的傾向 = C 先、B 後**(A 案已作廢 ⇒ 實際只剩 B / C):E10 第 3 批做完之後,退款本來就該從後台發起(有帳本、有 job、有稽核);
    那時「TapPay 後台單邊退款」就從「常態」變成「異常」,B 才有明確的告警語意。
    現在做 B 會對著一堆合法的手動退款一直響。
- **不修會痛在:**
  - 擴充性:A 案的 Notify 端點若日後要接,要先定「退款事件」的冪等與權威(誰是真相:webhook 或帳本)。
  - 可維護性:目前「DB 說 paid、TapPay 說已退」這種不一致沒有任何自動偵測,只能靠人記得。
  - bug 可追蹤性:對帳差異會在很久以後才被發現,那時已經無從還原是哪一天退的。
- **估時:** B 案 = 1-2 片;A 案 = 2-3 片(含 webhook 驗簽與冪等)
- **依賴:** 建議排在 E10 第 3 批退款線之後(理由見預期解法 C)
- **發現於:** 2026-07-30 / #301 收工盤點
- **相關:** #301、#303、`docs/reference/tappay-reference.md`、
  `docs/handoff/2026-07-30-301-tappay-record-handoff.md` §7

### #305. 🌐 隔離庫是 C locale、正式站是 en_US.UTF-8 —— POSIX 字元類在兩邊行為不同

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(它讓「隔離庫驗過」的效力打折,而那是本專案主要的驗證手段)
- **問題:**
  - 驗證用的拋棄式隔離庫是 `initdb --locale=C`(`scripts/d1t2-rehearsal.sh:39`,理由逐字
    「macOS + zh_TW locale 會讓 postmaster 啟動即死」)。
  - **正式站實查 = `en_US.UTF-8`**(`pg_database.datcollate`/`datctype`,2026-07-30 唯讀查)。
  - 🔴 **PostgreSQL 的 POSIX 字元類跟著 locale 走** ⇒ 同一條 CHECK 兩邊行為不同。實測:
    - 隔離庫(C):`'　' ~ '[[:space:]]'` = **false**
    - 正式站(en_US.UTF-8):同式 = **true**
  - ⇒ 用 `[[:space:]]` / `[[:alpha:]]` 這類字元類寫的約束,**在隔離庫驗綠不代表正式站同行為**,
    反之亦然。這是整套「本機隔離庫實跑」驗證策略的一個**系統性折扣**,而先前沒人知道。
  - 🔴 **不只字元類 —— `[0-9]` / `[a-f]` 這種 range 也是 collation-dependent**(2026-07-30 codex 關卡2 補列;
    PG 官方明文警告 range 依 collation 排序解讀)⇒ 「改用 range 就沒事」是錯的。
    A7 因此把 `payload_hash` 也改成**明列 16 個字元**;凡是要跨環境同語意的判定,
    **字元類與 range 都不能用**,只能明列。
  - ⚠️ **A2 / A3 目前沒有實際破口**:它們的 `[[:space:]]` 判定在正式站是有效的(實查
    `translate(…) ~ '[^[:space:]]'` 對一格全形空白回 false = 正確拒絕)。
    但 ①它們的註解把這件事寫成無條件事實、沒標 locale 依賴 ②它們的行為探針在隔離庫
    **因空表而被略過**(provision log 逐字「行為探針已略過」)⇒ **那條防護從未在任何環境被實測過**。
- **觸發事件:**
  - 2026-07-30 施工 A7-1 時,我沿用 A2/A3 的 `[[:space:]]` 寫法,**被自己寫的行為探針當場抓到**:
    `other` 配一格全形空白竟然寫得進去。追根因才發現是 locale。
  - A7 已改成**明列碼位**(不依賴字元類)⇒ A7 的約束在兩個環境逐字元同行為;本條是為**其他片**開的。
- **預期解法:**
  - **A. 把隔離庫改成 `en_US.UTF-8`**:與正式站對齊,驗證效力直接可轉移。
    🔴 需先實測 macOS 上該 locale 是否重現「postmaster 啟動即死」(當初只證明 zh_TW 會死,**沒證明
    en_US.UTF-8 也會**)—— 這是本案的唯一未知。
  - **B. 立規則:migration 一律不用 locale-dependent 字元類**,改明列碼位(A7 的做法)。
    好處=兩邊同行為且不依賴環境設定;代價=寫起來囉嗦,且要回頭處理既有的 A2/A3。
  - **C. 兩者都做**:A 對齊環境、B 對新片立規則。
  - 🟡 **我的傾向 = C**,理由:A 單獨做的話,未來換驗證環境又會漂回來;B 單獨做的話,
    既有片與 `create_order` 這類大函式裡的字元類仍然只在正式站才是真的。
- **不修會痛在:**
  - 擴充性:後續每一片只要用到字元類,就多一個「harness 綠但正式站未知」的縫,而且沒人會記得它。
  - 可維護性:A2/A3 的註解現在是「在特定 locale 下才成立」的斷言卻寫成無條件事實,
    下一個人照抄就會複製這個假設。
  - bug 可追蹤性:這類差異**不會報錯**,只會讓某個 CHECK 在正式站悄悄放行或悄悄擋掉,
    事後從 log 完全看不出來(與 #301 同型:接線錯但長得完全正確)。
- **估時:** A 案 = 1 片(改 initdb 參數 + 重跑一次既有 harness 驗證);B 案 = 隨各片;C = 兩者
- **依賴:** A 案需先實測 macOS + en_US.UTF-8 能否啟動;B 案需 Sean 同意立規則(判準類)
- **發現於:** 2026-07-30 / A7-1 施工(被自己的行為探針抓到)
- **相關:** #299(repo 無法從零重建 DB)、`scripts/d1t2-rehearsal.sh`、
  `supabase/migrations/20260729020000`(A2)、`20260729030000`(A3)、
  `docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md`

### #306. 🔢 分類數字沒有跟著所選車款走 —— 選了車仍顯示全站總數(會誤導)

- **狀態:** ✅ **已完成(2026-07-31,#306-a + #306-b 兩片,Sean 肉眼驗收通過、逐字「可以,成功了」;未 push、零 DB)。**
  Sean 2026-07-31 五拍板:**Q1=A 授權動正式資料查詢**(唯讀)/ **Q2=A 0 件灰掉且點不下去** /
  **Q3=A 選好車當下就算、手機桌機同一套機制**(不做「開面板才算」的裝置分支)/
  **Q4=A** 新 worktree 的 `.env.local` 由 Sean 自己建 symlink(AI 不讀寫 `.env*`)/
  **Q5=A** 公開端點的放大面**先這樣上、觀察**(見下方殘餘風險)。
  🔴 **本線在獨立 worktree `/Users/sean_1/pcm-website-v2-306` / 分支 `catalog-facet-counts` 做**
  (兩個 session 同 repo 互撞;**同資料夾 `checkout -b` 不會隔離**,只有 worktree 才行),
  已合回 `dev`。完整交接 = `docs/handoff/2026-07-31-306-catalog-facet-counts-handoff.md`。
- **優先級:** 🔴 高(Sean 2026-07-30 逐字「我最希望還是可以即刻算出來」;過渡措施=選車後隱藏,但那不是他要的終態)
- **問題:**
  - 分類清單的數字來自 `fetchCategories()` → `adapter.listCategories()`
    (`products_public` head:true exact count)= **全站總數,與 `?vehicle=` 無關**。
  - 實測(2026-07-30、正式資料、390px):選到 `?vehicle=kawasaki:ninja-zx-10r` 後商品數
    是 **198 件**,而手機分類面板仍顯示「碳纖維部品 **2130**、拉桿與把手 **1824**、
    腳踏後移與傳動 **1076**」等 15 個全站數字。
  - Sean 逐字:「選好車款後,分類後面數字有辦法即時顯示該分類對應的篩選有多少商品,
    方便快速辨別客人選擇的車款有多少分類商品可以看,而不是點進去後才發現沒東西」。
  - 🔴 桌機左側欄吃的是同一份 `data.categories` ⇒ **同一個病灶、同一個修法涵蓋兩端**。
- **關鍵事實(已查證,決定修法可行性):**
  - 既有 RPC `search_catalog_by_vehicle` **已經接受 `p_category` 並回 `total`**
    (`packages/adapters/src/supabase/database.types.ts` 的 Args/Returns)
    ⇒ **不需要新 migration** 就能取得「某車款 × 某分類」的件數。
  - ~~分類數 = **15**(2026-07-30 實測面板列數)⇒ A 案是 15 次併發查詢。~~
    🔴 **2026-07-31 實測推翻**:15 只是「側欄收合時看得到的大類數」,分類 facet key 實為 **92**
    (15 大類 + 77 子類)⇒ A 案是 **108 次**(含 16 品牌)。詳下方「#306-a 實測」。
  - 某分類 0 件時該 RPC 回**零列** ⇒ 讀不到 total,直接當 0 處理(正好就是要灰掉的那些)。
- 🔴 **2026-07-30 晚 Sean 追加(逐字)**:「如果無法跟該選擇車款即時算出來數量,那**都不要**」、
  「**包含桌機也是**」、「我**最希望**還是可以即刻算出來,當有選擇車款時候,分類或者品牌即時更新
  適用商品數字」。⇒ 三點連動:
  - **範圍擴大到品牌**:品牌件數來自 `catalog_brand_counts()` RPC(`lib/products.ts:410-431`),
    **同樣不吃任何車輛參數** ⇒ 與分類是同一個病灶,本片一起做。
  - **範圍擴大到桌機**:`FilterSide` 左側欄吃同一份資料,同樣要即時計數。
  - **過渡措施已上**(本次 UX 片內):選了車就**隱藏**分類與品牌的件數(手機 `FilterDrawer` +
    桌機 `FilterSide` 兩處的 `showCounts = cascade.vehicle === null`);未選車時全站數=實際數、照常顯示。
    🔴 **#306 完成後應把隱藏改回顯示真實件數**,不是繼續隱藏 —— 隱藏只是「不給錯的」,
    Sean 要的是「給對的」。
- **Sean 拍板 = A 案(開面板才查 / lazy):**
  - 點「分類」時才併發查該車款下每個分類的件數 → 數字換成真實件數、**0 件的分類灰掉**。
  - 選它的理由:零 migration、`/products` 首次載入速度不變;代價 = 面板打開要多等一下。
  - 未採用:B 頁面載入就查(每次進商品頁多 108 個查詢〔原寫 15、見上方更正〕、TTFB 變慢)/ C 新增 GROUP BY RPC
    (最省但要動 DB 結構 = 鐵則 12 ③高風險片)/ D 選了車就藏數字(只擋錯數字、不解決辨別)。
  - 🟡 若 A 案實測太慢,升級路徑 = C 案(先量再升,不預先做)。
- **開工前置(不可省):**
  - 動到「正式資料查詢」= 型錄選車 UX 交接檔明文凍結的邊界 ⇒ 需 Sean 重新授權該邊界。
  - 跨 3+ 檔(server 查詢 + 資料流 + 分類面板/側欄)⇒ **鐵則 8:先提 plan 等批准**。
  - client 要拿到數字 ⇒ 需要 server action 或 route handler(目前分類數字是 server props
    一次帶下來的,面板內沒有取數的管道)。
- **#306-a 實測(2026-07-31、production build、本機打正式 Supabase、正式資料):**
  - 🔴 **查詢數是 108,不是本條原本寫的「15」**:分類 facet key 實際 **92 個(15 大類 + 77 子類)**
    —— 原本的 15 只數了側欄收合時看得到的大類,而子類件數在展開時同樣要顯示;加 16 品牌 = **108**。
    ⇒ 凡引用「15 次查詢」的敘述皆已作廢,以 108 為準。
  - **正確性對真頁面逐項驗過**(facet 數字 = 點進去那頁 `pp-count` 的實際件數):
    `?vehicle=yamaha:mt-09:2021` → 拉桿與把手 **39=39** / 拉桿與把手 · 煞車離合器拉桿 **14=14** /
    外觀與後視鏡 · 短牌架 **15=15** / 懸吊與車架 **0=0** / 騎士用品與配件 **33=33** /
    品牌 lightech **84=84** · evotech **47=47** · k-speed **0=0**;
    **15 個大類件數加總 = 198 = 該車款總件數**;品牌-only `?vehicle=yamaha` 加總 **2349 = 2349**。
  - **延遲**:併發 6 → 冷 2.83/3.85/3.57/3.47s;**併發 16 → 冷 2.57/1.62/1.57/2.27s**;
    命中 900s 快取後一律 **~0.19s**。最壞情況 = 品牌-only `?vehicle=yamaha`(2349 件)冷 **4.76s**。
    🔴 本機到 Supabase 每條往返約 150ms、正式站同區域應更快,但**未量過**、不得當已驗證結論。
- **#306-b 真瀏覽器實測(2026-07-31、production build、真資料、agent-browser 0.33.0):**
  - 前提斷言先建立:CSS chunk **200 / 103,652 bytes 且逐字含兩條新規則**;每次 eval 自帶 viewport 斷言。
  - **桌機 1365**:15 大類顯示 13/6/**39**/6/3/4/27/6/15/**0**/15/31/33/**0**/**0**,
    三個 0 件皆 `disabled=true` + `opacity=0.38`;**加總 198 = `pp-count` 198 件商品**。
  - **端到端**:點「拉桿與把手(39)」→ 頁面變 **39 件商品**;子類 14/11/14/**0**/**0**,0 件 disabled。
  - **品牌 16 個**:LIGHTECH 84 / EVOTECH 47 / GB RACING 19…;四個 0 件灰掉停用。
  - **手機 390**:桌機側欄 `display:none`、`.pmc-sticky` 在,抽屜 15 個數字與桌機**逐格相同**;
    點 0 件列 → URL **完全沒變**(真的點不動)。**未選車回歸**:仍是 2130/1076/1824、`pp-count` 19037。
  - **等待**:從進頁面到數字出現 **2948 / 2205 / 1666 / 998 ms**(四台全新未快取車款);熱 ~0.19s。
    頁面與商品**不等它**,數字是後補上去的。
- 🔴 **在沒有憑證的 worktree 實跑,抓到一條既有漏洞**:`fetchCatalogBrandTaxonomy` /
  `fetchProductsByVehicle` 的 `createSupabaseAnonClient()` 寫在 `try` **外面**(`lib/products.ts`)
  ⇒ 環境變數缺漏時是**未捕捉的 throw**、整頁 500,它們的 catch **保護不到 client 建構**。
  已在 facet route 自己再包一層收斂成 503;**`products.ts` 未改**(那條路徑影響 `/products` 頁、屬既有行為)。
  🟡 若日後要治本,這是獨立一片。
  - **升級路徑(尚未做、不預先做)**:兩段式 —— 先算 15 大類 + 16 品牌(31 條),
    展開某大類時才算它的子類。C 案(GROUP BY RPC)仍是最後手段。
  - **#306-b 審查**:code-reviewer(opus)**FAIL 3 must-fix + 9 nit,全折入、駁回 0**(修法 `fded9bc`)。
    🔴 **M1 客人可見**:件數的兩個輸入分屬不同時間軸(`hasVehicle` 讀 `cascade.vehicle` =
    post-hydration 才還原,件數讀 URL 的 `?vehicle=`)⇒ 深連結 / 首頁選車進站時,SSR 與整段
    hydration 期間**先閃一次全站數**(2130 配 198 件列表)= #306 的病灶本身。
    🔴 **我先前的真瀏覽器實測全是「等數字回來之後」才讀,從沒看過第一幀** —— 這類「只在最初幾百毫秒
    存在」的錯誤,量測時機本身就是斷言的一部分。修法 = resolver 由 `ProductsPage` 建立一次
    (輸入只認 URL)再下傳兩端;證據 = SSR HTML 對照(未選車 19037 + 側欄 `[2130,…]`、
    選了車 198 + 側欄 `[]`)。
    🔴 **M2 客人可見**:已選中的分類 0 件時**取消不掉** —— 品牌寫了 `&& !checked` 且是對的,
    分類漏了 ⇒ 換車後列表空白,而手機抽屜是全屏遮罩、ActiveChips 在它底下 ⇒ 客人無出路。
    **M3** 接線層四行 prop 任意刪掉仍全綠 ⇒ 補三條 ProductsPage 級守門。
    🔴 **突變 7/7 各紅在指定斷言,但第一輪有 2 條是我的新測試自己假綠**:拿「件數 3 的列」去測
    `count === 0 && !isMainActive` ⇒ 前半恆假、拿掉修法照樣綠(0 件的列是 disabled 的,
    用點擊**永遠到不了**那個組合)⇒ 改成直接注入已選中的 cascade。**同型教訓第三次。**
  - **關卡2 codex(換模型、Sean 2026-07-31 拍板補跑;`-m gpt-5.6-sol -s read-only`、跑前後零留痕已驗)**:
    **FAIL 8 must-fix,逐條核對後全數成立、駁回 0**。🔴 **前兩輪 Claude 審查一條都沒重疊。**
    ①🔴 **長版書籤 `?brand=&model=` 復發全站數**:server 端 `page.tsx:60` 把長版**當車**,
    取數只讀 `?vehicle=` ⇒ 判「沒車」⇒ 顯示全站數。**我在交接檔寫的「退回不顯示」是錯的。**
    改用既有 `vehicleUrlParam()`(短版直出、長版合成);合成字串被形狀白名單擋下 ⇒ 400 ⇒ 不顯示。
    ②🔴 **`design-storefront-manifest.yaml` 未同步 = 違反 `slice-checkpoint` 強制 gate**;
    更嚴重的是**前一輪 Claude 審查者說「本 repo 無 manifest」、我沒查證就接受**(該檔 297KB)。
    ③ hook 無 owner guard(abort 擋不住已進入完成序列的 promise)④ `unstable_cache` 不是 single-flight
    ⑤ **品牌 taxonomy 沒快取** ⇒ 熱請求每次打全站聚合(修後實測 **~190ms → 3.4ms**)
    ⑥ 車輛驗證前就讀分類品牌 ⑦ fan-out slot 不保證歸還 ⑧ ProductsPage 405 行破鐵則 6。
    突變 5/5 各紅在指定斷言(🔴 第一輪長版 URL 那條全綠 = 零覆蓋,補測試才轉紅)。
  - **#306-a 審查**:code-reviewer(opus)R1 **FAIL 7 must-fix + 11 nit,全數折入、駁回 0**。
    最重的三條都是**上游失敗會變成「錯的答案」**:①三支 taxonomy fetcher 都自己 catch 回 `[]`
    ⇒ 一次瞬時 DB 錯會回 200 分類全空,而 #306-b 依 Q2=A 會把**整個分類面板灰掉且點不下去**
    ②車輛字典失敗被回報成 400(永久錯誤語意)⇒ client 不知道該重試 ③`p_offset` 零斷言:
    改成 1 時 total 仍對、但「恰好 1 件」的 facet 會回零列 ⇒ 被判 0 件而全綠。
    另修:facet key 未過 `?category=` 同一道白名單(算得出來卻點不進去)、空字串品牌 slug 會
    fail-open 成「不過濾品牌」。
  - **突變測試 19/19 各紅在指定斷言**(還原經 shasum 逐檔驗)。🔴 第一輪有 **3 條是 harness
    自己假綠** —— sed 樣式因程式碼改寫而失配、突變根本沒套用卻報「全綠 = 沒抓到」;
    已補「突變必須真的改到檔案(shasum before≠after)否則判 FATAL」。
  - 🔴 **順帶更正一條我自己寫錯的註解**:原寫「用 `allSettled` 是為了避免 unhandled rejection」
    —— **實測不成立**(`Promise.all` 本來就會對陣列裡每個 promise 掛處理器)。真正的理由是
    **收乾淨**:`Promise.all` 在第一個 reject 當下就往外拋,其餘查詢還在飛。斷言已改成測這件事。
  - 🔴 **殘餘風險(未解、交 Sean 判斷、不自宣接受)**:這是**公開端點**,三道白名單擋的是
    **key 空間**不是速率,而車輛字典本來就整份送到瀏覽器 ⇒ 合法車款可被逐一枚舉、每個 108 條查詢。
    已加 process 層 fan-out 閘(`MAX_CONCURRENT_FANOUTS=3`,滿了回 503),但它是 **per-process**
    ⇒ 實際上限 = 3 × instance 數,**不是全站硬上限**。真正的速率限制要平台層(WAF / rate limit)。
- **不修未來會痛在哪:** 客人看到「碳纖維部品 2130」點進去只有 3 件,會直接認為網站資料不準;
  而這個數字出現在**選車之後**,正是最需要它可信的時刻。

## 紀錄模板

### #307. 🔒 帳本主從一致 trigger 在「有人刪改明細」時擋不住 —— 現行 append-only 寫法不觸發

- **狀態:** ⏳ 待執行(**條件式**:只有在有片要刪改明細時才必須做,見「觸發條件」)
- **優先級:** 🟠 中(今天觸發不了;但一旦有人做「退款更正 / 取消更正」功能就是硬前置)
- **問題:**
  - 取消帳本(`order_cancellations` / `order_cancellation_items`,A7-t `20260730140000`)與
    退款帳本(`order_refunds` / `order_refund_items`,RF2a-2 `20260725130100`)的主從一致 trigger
    都是「`SELECT count(*) … WHERE <parent_id> = ?` 為 0 就 RAISE」的形狀,**沒有鎖 parent、沒有隔離級閘**。
  - 🔴 **實測**(本機 PG 17.10,harness = `scripts/a7t-concurrency-probe.sh`,**6/0**):
    header 有兩列明細、兩個交易**各刪一列**時 ——
    - `REPEATABLE READ`:兩邊都放行 ⇒ **零明細 header 真的落地**(該防護的存在理由當場失效)
    - `REPEATABLE READ` + **鎖 parent(`FOR UPDATE`)**:🔴 **仍然漏** —— 鎖修得了「併發執行」,
      修不了「快照過期」(後續 `count(*)` 仍用交易自己的舊快照)
    - `READ COMMITTED`(PG 預設)且兩筆 commit 序列化:擋得住
    - `SERIALIZABLE`:PostgreSQL 自己擋(`could not serialize access due to read/write dependencies`)
  - ⇒ 有效修法是**兩層**:①鎖 parent(關掉 READ COMMITTED 下併發 trigger 執行的窗)
    ②**隔離級 fail-closed 閘**(trigger 內斷言 `transaction_isolation` ∈ {read committed, serializable})。
    只做①就宣稱「空 header 擋住了」= 防護命名超出它的實際能力。
- **為什麼今天不修:**
  - 觸發前提是「有人 DELETE 或 UPDATE 明細」,而四張表都是 **append-only**:
    兩組表皆零寫入 GRANT(只有 `GRANT SELECT TO service_role`);**production writer 路徑**
    (`apps/` + `packages/`,排除測試與探針)零命中;master plan 的寫入片(A8a1 寫 header /
    A8a2 寫 items / A9g 只讀)與退款線規劃皆無刪改既有列;多次部分取消 = 累積新 header。
  - ⇒ 不為一條目前不存在的路徑蓋防禦工事,改立本條當閘。
- 🔴 **這個結論是條件性的(關卡2 codex 兩條 must-fix)**:
  - 「零寫入 GRANT」**不等於**「無人能刪改」—— table owner、superuser、以及
    **A8a1/A8a2 那種 SECURITY DEFINER owner RPC 都不受表級 GRANT 限制**。
  - 正確講法是「**目前沒有任何 application writer 實作**」,不是「物理上不可能」。
  - ⇒ **A8a1/A8a2 只要寫下第一個 `UPDATE`/`DELETE`,本條當天可達。**
- **觸發條件(命中任一 ⇒ 本條升為該片的硬前置):**
  - 任何片要 `DELETE` 或 `UPDATE` `order_cancellation_items` / `order_refund_items` 的**既有列**
    (退款更正 / 沖銷 / 取消更正 / 資料修補腳本皆算)
  - 任何片給這四張表開出 `INSERT` 以外的寫入權限
  - 任何 writer 打算跑在 `REPEATABLE READ`
- **已落點(A7-t commit `54cbc64` 內):**
  - `supabase/migrations/20260730140000_…sql` 的函式 COMMENT
  - master plan §5.1 的 **A8a2** 列與 **A7b** 列
  - `docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md` §2.2
- **觸發事件:**
  - 2026-07-30 A7-t 關卡1,codex `gpt-5.6-sol` xhigh 抓到併發面;主對話實測確認漏洞為真,
    **但同時實測證偽了它提的修法**(鎖 parent 不足)。再查觸發前提後判定為「目前不可達」⇒ 縮範圍改立本條。
  - 退款側同型洞由獨立調查確認:同樣 append-only、同樣零寫入端、消費端 RF5/RF6/RF2b 皆未實作。
    其 trigger 含 `DELETE` 事件純屬防禦性完備寫法(`20260725130100:182-184` 註解只說「刪明細後 sum 會失衡」),
    非對應某個會刪改明細的流程。


### #453. 🔍 採購表單的供應商選單沒有 typeahead —— 純 `<select>`,家數長大後會難找

- 🔢 **原號 `#308`,2026-08-13 由 #376 改為 `#453`**(與「品牌頁 band logo alt/h1 重複」撞號;那條引用面含 7 處 `.tsx` 故留原號)。舊文件寫 `#308` 又在講 typeahead 的,指的是本條。

- **狀態:** ⏳ 待執行(Sean 2026-08-04 拍板 **A:這期不做**,開本條當家)
- **優先級:** 🟡 低(現況可用;隨供應商家數成長而升溫)
- **問題:**
  - master plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:404`(row 57)原文明列
    供應商選擇要「`S3a` 的讀模型供料、字母序、**typeahead**」。A10b 實作只做到前兩項:
    純 `<select>` + zh-TW 字母序(`apps/admin/src/lib/supplier.ts:44-52` 的共用排序),**沒有 typeahead**。
  - 🔴 這是「**未做**」不是「不做」—— 關卡2 codex 抓到我原本在 row 57 註記寫成「另開片」,
    等於施工端自己把一條契約需求關掉。需求的家在這裡。
- **觸發事件:**
  - 2026-08-04 A10b(採購表單 UI)施工;關卡2 codex `gpt-5.6-sol` 指出「記錄未實作不等於關閉需求」;
    Sean 當日拍板 A(這期不做、開具名後續片)。
- **預期解法:**
  - `<select>` 換成可輸入過濾的元件(datalist 或既有 UI 積木);資料來源不變(S3a `listSuppliers()`),
    排序仍走 `sortSuppliersByLabel` 單一入口,**不得**另建 collator。
  - 🔴 沿用 A10b 既有約束:**本品項已有採購列指向的停用供應商仍要選得到**
    (`procurement-suppliers.ts:buildSupplierChoices`),否則那一列永遠改不了。
- **不修會痛在:**
  - 擴充性:供應商成長到 **50+ 家**時,純下拉要捲很久才找得到一家;現況 **26 家**(Sean 名單)
    在字母序下還找得動,所以今天不痛。
  - 可維護性:不修沒有維護成本(少一個元件);真正的成本是日後改元件時要同時保住
    「停用者仍可選」與「單一排序入口」兩條約束,愈晚做這兩條愈容易被漏掉。
  - bug 可追蹤性:選錯供應商不會被系統擋(A5a 只驗 id 存在與是否停用)⇒ 難找 = 選錯風險,
    而選錯的後果是採購事實掛到別家、要靠人眼在明細頁發現。
- **估時:** 0.5-1 天(含既有兩條約束的回歸測試)
- **依賴:** S3a(已完成)/ A10b(2026-08-04 完成)
- **發現於:** 2026-08-04 / A10b 關卡2
- **相關:** #295(後台管理面)/ master plan row 57

```markdown
### #N. <Emoji> 標題

- **狀態:** ⏳ 待執行 / 🔴 立即啟動 / ✅ 完成 / ❌ 棄用
- **優先級:** 🔴 高 / 🟠 中 / 🟡 低 / 🟢 觀察
- **問題:**
  - (描述)
- **觸發事件(可加「(任一觸發即啟動實作)」變體、對齊 #122/#118 等既有條目格式):**
  - (何時、為何發現)
- **預期解法:**
  - (想怎麼解)
- **不修會痛在:**
  - 擴充性:(具體場景)
  - 可維護性:(具體場景)
  - bug 可追蹤性:(具體場景)
- **估時:** (範圍)
- **依賴:** (前置)
- **發現於:** YYYY-MM-DD / slice 編號
- **相關:** #X / #Y
```

— END —

---

### #308. 🔊 品牌頁 band logo 的 alt 與 h1 重複 — 讀屏客人每頁聽兩次品牌名

- **狀態:** ✅ **已完成(2026-08-04 / D2f;Sean 拍 A = 程式側直接修、不等設計側回寫)**
- **修法:** 兩處都改。①`BrandPageHeader.tsx` 的 band logo → `alt=""`(空字串,不是拿掉屬性 ——
  拿掉會讓報讀器改唸檔名、不等價)②`BrandPageWhy.tsx` 的 `.bp-why-num` → `aria-hidden="true"`。
  守門:`BrandPageHeader.test.tsx`(alt='' + 屬性仍在 + 同頁 h1 真的還唸得到品牌名,三條各擋一種退化)、
  `BrandPageWhy.test.tsx`(四張卡逐個驗,不用 querySelectorAll().length —— 只有第一張掛到時它也非零)。
  突變 4 個全轉紅(改回品牌名 / 拿掉 alt / 拿掉 aria-hidden / 只有第一張掛到)。
- **分流:** ✅ 已結案(原 P2-later)
- **優先級:** ✅ 已結案(原 🟢 觀察(a11y 體驗,非阻斷))
- **問題:**
  - `BrandPageHeader.tsx` 的 band logo `alt={brand.name}`,而同一個橫幅裡的
    `<h1 className="bp-title">` 也是 `{brand.name}` ⇒ 螢幕閱讀器會連續播報兩次品牌名。
  - 這是**照設計稿搬**的結果:`brand-page.html:1642` 的 `alt="${esc(brand.name)}"`。
    設計稿是純前端 demo、沒有 a11y 稽核,鐵則 1 要求字面直接搬,所以 D2b 沒有自行偏離。
- **觸發事件:**
  - 2026-08-04 / D2b 關卡2(信箱 C-04-A MF3)修正時發現;C-05-A nit-2 要求開編號。
- **預期解法:**
  - logo 在這裡是**裝飾**(品牌名已由 h1 承擔語意)⇒ 正解多半是 `alt=""`。
  - 🔴 但那是**偏離設計稿字面**,依鐵則 1 要先確認:走 Sean 拍板,或由設計側在
    Open Design 的 `brand-page.html` 改掉再搬過來(後者較乾淨,不必開鐵則 1 的口)。
  - 同類檢查:`.bp-aside-card img` 的 alt 走資料的 `aside.alt`(有實質描述),沒有這個問題。
  - **同族第二處(2026-08-04 / D2d-1 關卡2 N3 加入)**:`BrandPageWhy.tsx` 的 `.bp-why-num`
    序號 01-04 是**裝飾**(元件註解自己寫的:等寬字視覺對齊),報讀器會在每張卡標題前多唸一次序號。
    正解多半是 `aria-hidden="true"`;設計稿 `brand-page.html:1976` 沒有 ⇒ 同樣走本條的拍板路徑一起處理。
- **不修會痛在:**
  - 擴充性:20 家品牌頁 × 每頁重複一次;之後 D4 品牌總覽頁若沿用同一個 logo 元件會擴散。
  - 可維護性:現在只落在 commit body 與程式碼註解裡,沒有編號就不會進任何盤點。
  - bug 可追蹤性:用讀屏的客人不會回報「聽到兩次」,只會覺得這站囉嗦 —— 零訊號的缺陷。
- **估時:** 10 分鐘(改一個字)+ 拍板往返
- **依賴:** 鐵則 1 偏離的拍板路徑(Sean 或設計側)
- **發現於:** 2026-08-04 / D2b 關卡2 折入
- **相關:** `apps/storefront/src/components/brand/BrandPageHeader.tsx`(logo alt)/
  Open Design `pcm-home-redesign/brand-page.html:1642` / 信箱 C-04-A MF3、C-05-A nit-2

---

### #309. ⌨️ 品牌頁影片播放後鍵盤焦點掉回頁面最上面

- **狀態:** ⏳ 待執行
- **分流:** P2-later
- **優先級:** 🟢 觀察(a11y 體驗,非阻斷)
- **問題:**
  - `BrandPageMedia.tsx` 按下封面 → 封面按鈕整個從 DOM 移除、換成播放器。
    React 不會轉移焦點 ⇒ 用鍵盤按 Enter 播放的人,焦點當場掉回 `<body>`,
    要從整頁最上面重新 Tab 回來才能繼續。
  - 這是**照設計稿搬**的結果:`brand-page.html:1926` 的 `poster.remove()` 同樣不轉移焦點。
    設計稿是純前端 demo、沒做過 a11y 稽核。
- **觸發事件:**
  - 2026-08-04 / D2c-2 關卡2(code-reviewer nit)。同批的另一條(焦點框被
    `overflow:hidden` 裁掉)已在本片直接修掉 —— 那條是「完全看不見」等級,這條是「要重按很多次」等級。
- **預期解法:**
  - 掛載播放器時把焦點移到播放器容器(`.bp-film-frame` 給 `tabIndex={-1}` 後 `.focus()`),
    或直接聚焦 `<video>`(它本身可聚焦)。
  - 🔴 兩種都是**新增設計稿沒有的行為**,依鐵則 1 要走拍板路徑;
    另一個更乾淨的解是由設計側先在 Open Design 補,再搬過來(同 #308 的處理方式)。
  - 一併評估:`blocked` 退路面板出現時焦點也在同一個位置消失。
- **不修會痛在:**
  - 擴充性:20 家品牌頁裡 11 家有影片;D4 品牌總覽頁若沿用同一個播放器會擴散。
  - 可維護性:現在只落在 commit body 與程式碼註解,沒有編號就不會進任何盤點。
  - bug 可追蹤性:純鍵盤使用者不會回報「焦點不見了」,只會放棄用鍵盤 —— 零訊號的缺陷。
- **估時:** 20 分鐘(含焦點轉移的測試)+ 拍板往返
- **依賴:** 鐵則 1 偏離的拍板路徑(Sean 或設計側)
- **發現於:** 2026-08-04 / D2c-2 關卡2 折入
- **相關:** `apps/storefront/src/components/brand/BrandPageMedia.tsx`(封面按鈕與播放器切換)/
  Open Design `pcm-home-redesign/brand-page.html:1926` / #308(同族 a11y 偏離拍板)

---

### #310. 📏 品牌頁數字條:手機單欄下,四個數字的品牌少一條分隔線

- **狀態:** ✅ **已完成(2026-08-04 / D2f;Sean 拍 A = 程式側直接修、不等設計側回寫)**
- **修法:** ≤620 區塊補一行
  `.bp-nums[data-n="4"] .bp-num:nth-last-child(2){border-bottom:1px solid var(--c-border)}`。
  真瀏覽器 390 實測:data-n=4 由 `[1,1,0,0]` → **`[1,1,1,0]`**;data-n=3 維持 `[1,1,0]` 未受影響;
  1000px 兩欄版維持 `[1,1,0,0]` 未受影響。守門在 `brand-page.test.ts`,除正面斷言外還有三條:
  ①≤620 的還原規則必須**恰 1 條、且 selector 必含 `[data-n="4"]`**(否則 3 個數字那 6 家會多一條線)
  ②值不得是 0 ③順序必須排在 ≤1024 那條收線之後(同權重靠先後決勝)。
  🔴 這條反面斷言我連錯兩次、兩次都是「量錯東西」:第一版用 `(?!…)` lookahead,而 `[data-n="4"]` 在
  `nth-last-child(2)` **前面** ⇒ 往後看的 lookahead 永遠幫不上忙、對自己那條正確規則誤紅;
  改用大括號走訪器後仍寫成「不含 `[data-n=`」⇒ **放行 `[data-n="3"]` 版本**(關卡2 nit 抓到)
  ⇒ 第三版改成正面條件「必含 `[data-n="4"]`」,並補一個突變「還原線改掛 data-n=3」證明它會紅。
- **分流:** ✅ 已結案(原 P2-later)
- **優先級:** ✅ 已結案(原 🟢 觀察(視覺瑕疵,非阻斷))
- **問題:**
  - `brand-page.css` 的 ≤620 區塊把數字條收成單欄,但**沒有還原 `.bp-num` 的 `border-bottom`**;
    而 ≤1024 的 `.bp-nums[data-n="4"] .bp-num:nth-last-child(2) { border-bottom: 0 }`
    在 ≤620 仍然命中(`max-width:1024` 涵蓋 620)。
  - ⇒ **有 4 個數字的 8 家品牌**,手機單欄下第 3、4 格之間沒有分隔線,兩格黏在一起。
    390 實測:`data-n="4"` → 每格底線 `[1px, 1px, 0px, 0px]`;`data-n="3"` → `[1px, 1px, 0px]`(3 個的 6 家正確)。
  - ≤1024 那條規則本身是對的 —— 它為的是**兩欄**版的「最後一列」;單欄下「最後一列」只有最後一格。
- **觸發事件:**
  - 2026-08-04 / D2d-1 關卡2(code-reviewer M3)。審查者由 CSS 推導出來,主對話再用真瀏覽器量到。
- **預期解法:**
  - ≤620 區塊補一行 `.bp-nums[data-n="4"] .bp-num:nth-last-child(2) { border-bottom: 1px solid var(--c-border) }`
    (單欄下把 ≤1024 那條收掉的線還回來)。
  - 🔴 **設計稿 `brand-page.html:1183-1185` 有同一個洞** ⇒ 補這一行 = 偏離設計字面,
    依鐵則 1 要走拍板:Sean 拍板,或由設計側先在 Open Design 補再搬過來(後者較乾淨,同 #308/#309)。
- **不修會痛在:**
  - 擴充性:20 家裡 8 家中;之後新增品牌只要填滿 4 個數字就會加入受影響名單。
  - 可維護性:兩個斷點的規則互相干擾,不寫下來的話 D2e/D3 有人動 ≤1024 會以為那是筆誤。
  - bug 可追蹤性:少一條 1px 的線沒有人會回報,只會覺得那一區「排得有點鬆散」。
- **估時:** 5 分鐘(一行 CSS + 一條守門)+ 拍板往返
- **依賴:** 鐵則 1 偏離的拍板路徑(Sean 或設計側)
- **發現於:** 2026-08-04 / D2d-1 關卡2 折入
- **相關:** `apps/storefront/src/styles/brand-page.css`(≤620 與 ≤1024 兩個區塊)/
  Open Design `pcm-home-redesign/brand-page.html:1183-1185` / #308、#309(同族:設計稿繼承的缺陷走拍板)

---

### #311. 🔢 品牌介紹頁的標題階層跳級:h1 → h3 → h2

- **狀態:** ✅ **已完成(2026-08-04 / D2f;Sean 拍 A = 程式側直接修、不等設計側回寫)**
- **修法:** 選**候選①**(產品照卡標題改非標題元素):`<h3>` → `<p className="bp-aside-title">`,
  CSS 選擇器同步 `.bp-aside-card h3` → `.bp-aside-card .bp-aside-title`(宣告一字未動)。
  **選它的理由**:那一格是產品照的圖說、不是文件章節,改成非標題在語意上更正確、也是最小 diff;
  候選②(補視覺隱藏的 h2)會與同區塊已存在的視覺標籤 `.bp-sec-label` "About" 對報讀器重複播報,
  正是 #308 在修的毛病;候選③(整頁降級重排)動最多檔而收穫相同。
  真瀏覽器實測大綱:`h1 KINEO → h2 為什麼是 Kineo → h3×4 → h2 經典的樣子 → h3×4`,跳級消失;
  標題樣式量到 14px/600/19.6px/#121214/margin 12px 0 5px = 與原 h3 規則逐項相同 ⇒ 視覺零改動。
  ⚠️ 連帶:這張卡現在有**兩個** `<p>`,基礎規則改成 `.bp-aside-card p:not(.bp-aside-title)`
  (原本靠特異度 0-2-0 > 0-1-1 剛好贏,寫死排除免得日後重算)。
  守門:About 區整段不得有任何 `h1-h6` + `.bp-aside-title` 的 tagName 必須是 P(缺一都會假綠)。
  🔴 **整頁大綱本身沒有單一守門**(關卡2 nit):正式路由要 D3 才有,現在唯一組裝點是 dev-preview 的
  server component;在測試裡照同樣順序自己排一次 = 守門與真頁各自漂移。改成**局部不變式**,
  涵蓋 `page.tsx:37-44` 的**全部 7 支**:Header 恰一 h1 且無其他標題 / About(**兩條右欄分流都驗**)
  與 Media、Categories 零標題 / Why·Craft·Timeline·BrandWall 首個標題是 h2 且只准 h2+h3。
  序列 = `[1] ++ [] ++ B ++ B ++ B? ++ [] ++ B`,每個 B 首項=2 且 ⊆ {2,3} ⇒ 無跳級、**與組裝順序無關**。
  🔴 **第一版只守 5 支、而且 About 只驗了 8 家那條分流**(關卡2 R2 抓到):另外 12 家走
  `BrandPageMedia`(materya 從本片起也在裡面),在它裡面加一個 `<h3>` 圖說就是 h1→h3、而測試全綠。
  七個對應突變(Why h2→h3 / Craft h2→h1 / Timeline h3→h4 / Header 多一個 h2 /
  Media 加 h3 ×2 條路 / Categories 加 h4 / BrandWall h2→h3)全轉紅。
  **D3 接上正式路由後仍值得補一支真的整頁大綱測試** —— 局部不變式擋得住「某支自己壞掉」,
  擋不住「新增第 8 支元件而沒人給它不變式」。
- **分流:** ✅ 已結案(原 P2-later)
- **優先級:** ✅ 已結案(原 🟢 觀察(a11y 體驗,非阻斷))
- **問題:**
  - 目前品牌頁的文件序是:`BrandPageHeader.tsx` 的 `<h1>`(品牌名)→
    `BrandPageAbout.tsx` 產品照卡的 `<h3>` → `BrandPageWhy.tsx` 的 `<h2>` → 四張卡的 `<h3>`。
  - ⇒ ①h1 直接跳到 h3(缺 h2)②About 那個 h3 出現在它「應該屬於」的 h2 之前。
    用標題導覽的讀屏使用者會拿到一份對不上內容結構的大綱。
  - 這是**照設計稿搬**的結果:`brand-page.html` 的 `.bp-aside-card h3`(:1964)與
    `.bp-why h2`(:1417)在設計稿裡就是這個階層,設計稿是純前端 demo、沒做過 a11y 稽核。
- **觸發事件:**
  - 2026-08-04 / D2d-1 關卡2(R1 N4、R2 再次點名要開編號)。D2c-1 帶進 h3,D2d-1 的 h2 讓它顯形。
- **預期解法:**
  - 三個候選:①About 產品照卡改用 `<p class="bp-aside-title">` 之類的非標題元素
    ②替 About 區補一個視覺隱藏的 h2 ③把卡片標題降成 `<h4>` 之後統一重排。
  - 🔴 三個都**偏離設計稿字面**,依鐵則 1 走拍板:Sean 拍板,或設計側先在 Open Design 改再搬過來。
  - 🔴 **要等 D2e 收完再定案** —— Craft / Timeline / Categories / 其他品牌各自還會帶 h2/h3 進來,
    現在只看得到一半的階層,改了很可能要再改一次。
- **不修會痛在:**
  - 擴充性:20 家品牌頁都是同一份版型,錯一次錯二十次;D4 品牌總覽頁也會沿用同一批元件。
  - 可維護性:每片各自搬各自的標題,沒有一個地方寫著「整頁的階層長什麼樣」。
  - bug 可追蹤性:用標題導覽的人不會回報「大綱怪怪的」,只會找不到東西就離開。
- **估時:** 30 分鐘(含跨片重排與測試)+ 拍板往返
- **依賴:** D2e 收完(整頁標題才齊)/ 鐵則 1 偏離的拍板路徑
- **發現於:** 2026-08-04 / D2d-1 關卡2 折入
- **相關:** `apps/storefront/src/components/brand/BrandPageHeader.tsx`(h1)/ `BrandPageAbout.tsx`(h3)/
  `BrandPageWhy.tsx`(h2 + h3)/ #308、#309、#310(同族:設計稿繼承的 a11y/視覺缺陷走拍板)

---

### #312. 🔊 品牌頁年表的「關鍵事件」對讀屏使用者完全不存在

- **狀態:** ✅ **已完成(2026-08-04 / D2f;Sean 拍 A = 程式側直接修、不等設計側回寫)**
- **修法:** 年表 = key 列在 `<h3>` **裡面**補 `<span class="bp-sr-only">關鍵事件:</span>`
  (放 h3 外面的話,用標題跳讀的人照樣聽不到 —— 守門有對應突變)。影片列 = 拿掉 `title`、留 `aria-label`。
  `.sr-only` 落點:**`brand-page.css` 裡的 `.bp-sr-only`**(帶 `bp-` 前綴)——
  本站站台級的 `.sr-only` 不存在(grep `apps/storefront/src` + `packages/ui/src` 零命中),
  而本檔是普通 stylesheet 不是 CSS Module ⇒ 在這裡寫裸 `.sr-only` 等於替全站宣告一個全域工具 class,
  那是 D5 整站語彙的事(同 `--c-red` 走 scope 的理由)。**站台級 `.sr-only` 仍未建 = 留待 D5**。
  真瀏覽器實測:標記盒 1×1、`position:absolute` + `clip-path:inset(50%)` + `overflow:hidden`
  且 `visibility:visible`(= 看不見但唸得到);key 列與一般列的 h3 左緣同為 441px、可見寬同為 959px
  ⇒ 視覺零位移。守門含反面:不得出現 `display:none` / `visibility:hidden` / `font-size:0`;
  另用走訪器驗 `.bp-sr-only` **恰 1 條、且不包在任何 `@media` 裡**(關卡2 nit:規則被搬進斷點區塊、
  或多出第二條蓋回去,那組宣告斷言全部照樣綠)。兩個對應突變都轉紅。
- **分流:** ✅ 已結案(原 P2-later)
- **優先級:** ✅ 已結案(原 🟢 觀察(a11y 資訊遺失,非阻斷))
- **問題:**
  - `BrandPageTimeline.tsx` 的 `is-key` 標記「這是該品牌真正的轉折點」,但它**只有顏色差異**:
    桌機是圓點由白轉橘 + 年份由半透明轉全白;手機只有年份由白轉橘。
  - ⇒ 用讀屏的人拿到的是 13 條完全一樣的年表,**設計上想強調的那 4 條在語意層不存在**。
    這是真的資訊遺失(不是冗贅),也過不了「不能只用顏色傳達資訊」那條(WCAG 1.4.1)。
  - 同批還有一條較輕的:`BrandPageCraft.tsx` 影片列的 `aria-label` 與 `title` 是**同一個字串**,
    部分輔具會先念 name 再念 description = 同一句聽兩次(設計稿 `brand-page.html:1999` 逐字如此)。
- **觸發事件:**
  - 2026-08-04 / D2d-2 關卡2(code-reviewer 對 Q5 的回答)。兩條都是照設計稿搬的結果。
- **預期解法:**
  - 年表:給 key 列一個視覺隱藏的語意標記(`<span class="sr-only">關鍵事件</span>`)或
    改用 `<strong>` 包年份;兩者都不動視覺。
  - 影片列:`title` 與 `aria-label` 擇一(留 `aria-label`、拿掉 `title`,或反之)。
  - 🔴 兩者都**偏離設計稿字面**,依鐵則 1 走拍板:Sean 拍板,或設計側先在 Open Design 改再搬過來。
  - 🔴 本站目前**沒有 `.sr-only` 這個共用 class** —— 要一起決定放哪(tokens.css 或各頁 CSS)。
- **不修會痛在:**
  - 擴充性:年表目前只有 2 家(akrapovic / gb-racing),但每新增一家有年表的品牌就多一份;
    `is-key` 這個「只用顏色」的模式若被 D2e 的其他區塊沿用會擴散。
  - 可維護性:現在只落在 commit body 與程式碼註解,沒有編號就不會進任何盤點。
  - bug 可追蹤性:讀屏使用者不會回報「我沒聽到重點」—— 他們根本不知道有重點。
- **估時:** 20 分鐘(含 sr-only 的落點決定)+ 拍板往返
- **依賴:** 鐵則 1 偏離的拍板路徑 / `.sr-only` 共用 class 的落點
- **發現於:** 2026-08-04 / D2d-2 關卡2 折入
  - ~~**第三條(2026-08-04 / D2d-2 關卡2 R2 加入)**:影片淡入 `bp-media-in` 不受 reduced-motion 保護~~
    ✅ **已於 2026-08-04 / D2e-2 解決,本條作廢**:Sean 拍板 **Q1=B**,
    `brand-page.css` 的動效層區塊補了一條有 scope 的
    `.bp-film-frame > iframe, .bp-film-frame > video { animation: none }`
    (真瀏覽器實測:開啟 reduced-motion 後 `animation-name: none` + opacity 1;
     對照組未開時同一支影片 `bp-media-in` 0.32s 在跑 ⇒ 那條規則確實有作用)。
    ⚠️ 原文寫的行號 `:461-464` 也不對,實查是 **`:461-465`**。
    🔴 **剩下的那一半(全站級的 `*`+`!important`)移到 `#318` 追**,不要在這條裡繼續追
    —— 這條的主題是「年表的關鍵事件對讀屏不存在」,reduced-motion 只是當時借掛的。
- **相關:** #318(第三條移交過去的全站級 reduced-motion)/
  `apps/storefront/src/components/brand/BrandPageTimeline.tsx`(is-key)/
  `BrandPageCraft.tsx`(影片列 aria-label + title)/ Open Design `pcm-home-redesign/brand-page.html:1999`、`:2011`/
  #308、#309、#310、#311(同族:設計稿繼承的 a11y/視覺缺陷走拍板)

---

### #313. 🎬 RIZOMA 的直式製程影片被 16:9 版位裁掉三分之二

- **狀態:** ⏳ 待執行
- **分流:** P1-before-launch
- **優先級:** 🟠 上線前(客人看得到、而且是按下播放才發生)
- **問題:**
  - `brand-content.ts` 的 rizoma craft row 2「02 — The Look」用
    `assets/brand-video/rizoma-fashion.mp4`,實測 **720×1280(9:16 直式)**,
    封面 `video-fashion.jpg` 900×1600 同樣直式。
  - 版位是 `brand-page.css` 的 `.bp-craft-media video { aspect-ratio: 16/9; object-fit: cover }`
    ⇒ 直式內容塞進橫式裁切框,可見面積 = (9/16) ÷ (16/9) ≈ **31.6%**,只剩畫面中間一條橫帶。
  - 🔴 **靜態封面看起來沒事**(裁出來的橫帶像是刻意構圖),`preload="none"` 之下不點播就看不出來
    ⇒ 真瀏覽器驗證看過 rizoma 但沒有人按下播放,所以沒被發現。
  - 另一支 `rizoma-scrambler.mp4` 是 1280×720 橫式,沒有這個問題。
- **觸發事件:**
  - 2026-08-04 / D2d-2 關卡2 **R3 換模型換角度**(前兩輪都在「字面搬對了嗎」那一層,
    這條是量資產像素才現形的)。設計稿 `brand-page.html` 自己也是同一個版位,**上游同樣有這個問題**。
- **預期解法(三選一,需 Sean 拍板):**
  - A. **換素材**:向 rizoma 取一支橫式的形象影片替換(最乾淨,不動任何 code)
  - B. **設計側加直式版位**:比照 About 右欄影片那套 `is-portrait`(3:4 → 9:16 + 欄寬重配),
    由設計側先在 Open Design 補進 craft 面板,再搬過來
  - C. **接受裁切**:那一格改放 `rizoma-scrambler.mp4` 的同款橫式素材,或直接拿掉那一列
    (craft 步數必須偶數 ⇒ 拿掉一列要連帶處理成 2 步)
  - 🔴 三個都是**產品/素材決定**,不是實作選擇 ⇒ 不由 Claude 拍。
- **不修會痛在:**
  - 擴充性:未來任何一家用 IG Reel 當製程素材都會踩到同一格;craft 目前沒有直式分支。
  - 可維護性:CSS 註解已寫明「42 列裡只有 5 列是 16:9」,但版位只有一種比例。
  - bug 可追蹤性:**它只在有人按下播放時才發生** —— 靜態截圖、三綠、突變、CSS 守門全部看不到。
- **估時:** A 案 = 取得素材的時間;B 案 = 設計側 + 一片實作約 40 分鐘;C 案 = 15 分鐘
- **依賴:** Sean 拍板(素材/產品決定)
- **發現於:** 2026-08-04 / D2d-2 關卡2 R3(Fable 換角度)
- **相關:** `apps/storefront/src/styles/brand-page.css`(`.bp-craft-media video`)/
  `apps/storefront/src/data/brand-content.ts`(rizoma craft rows)/
  Open Design `pcm-home-redesign/brand-page.html:1124`(上游同一個版位)/
  #312(同族:設計稿繼承的缺陷走拍板)

### #314. 🔗 品牌介紹頁走 A 案新 route,但設計稿字面連結 `?pbrand=X#brand-about` 沒有 redirect

- **狀態:** ✅ **已完成(2026-08-05 / D3c-5)** —— redirect 本體落地,A 案的配套債還清。
  - ✅ **redirect 本體 = `components/brand/BrandAboutRedirect.tsx`**(client;掛在 `app/products/page.tsx`)。
    決策邏輯抽成純函式 `resolveBrandAboutTarget(search, hash)` 以便單測;行為邊界逐條寫在該檔檔頭。
    🔴 **只能 client 側**:設計稿契約帶 hash,而 **hash 不送到 server** —— server 看到的
    `/products?pbrand=X` 是一個完全合法的目錄篩選網址,在那裡 redirect 會把正常用法一起劫走。
    (D3a 實查、信箱 C-25-Q Q1 → C-26-A 核可。)
  - **2026-08-05 真瀏覽器實測**(production build + 真 DB):
    `?pbrand=akrapovic#brand-about` → `/brands/akrapovic`;`?pbrand=kineo#brand-about`(目錄零商品
    那 5 家之一)→ `/brands/kineo` 且頁面完整(8 區塊、0 破圖、只有商品區不渲染);
    **無 hash 的 `?pbrand=akrapovic` 留在目錄頁**;查無 slug 與原型鏈字串都不動作;
    `replace` 不是 `push`(`/brands` → hash 網址 → 上一頁 ⇒ 回到 `/brands`,不會被彈回中間網址)。
  - ⚠️ **已知代價**:`/products` 是 `force-dynamic` ⇒ 轉走前會有一次商品目錄閃現。
    這是 client 側方案的固有代價,核可時已知。
- ~~**狀態:** 🔶 部分完成(2026-08-04 / D3a `5763934`)—— **兩條驗收前置已結、redirect 本體改歸 D3c**~~
  - ✅ **route 本體已建**:`app/brands/[slug]/page.tsx`(20 家全活;`/brands/<slug>` 不再是 404)。
  - ✅ **前置一「帶站台 Header 重量六寬度」已做**:1440/1180/961/960/620/390 真瀏覽器 + production
    build 全量 —— overflowX 皆 0、Header sticky `z-index:50` 且麵包屑起點恰在其底線(零重疊)、
    `.bp-page` 內**零**元素 `z-index>=50` 或 fixed/sticky、捲動後 Header 仍在最上層。
    底部 70px 是全域 `body padding-bottom`(`/products` 同值),非品牌頁引入。
  - ✅ **前置二「`.bp-page` scope 上機制」已做**:本條逐字建議的 `BrandPageRoot` wrapper 已抽
    (`components/brand/BrandPageRoot.tsx`),八支 `bp-*` 元件的 CSS import 一併收斂進去 ⇒
    拿得到樣式就一定有 scope。另補一條**讀原始碼**的守門釘住「只有這一支 import」兩個方向。
  - 🔴 **redirect 本體仍未做,歸屬 D3c**(=接線計畫 §8.2 的 D4,與 `/brands` 總覽頁同片):
    D3a 實查確認**hash 永遠不會送到 server**(HTTP fragment 不進請求),而 server 只看得到
    `/products?pbrand=X` —— 那個字面同時是合法的目錄品牌篩選(`lib/catalog-query.ts:84`)⇒
    **server 端無法分辨**,只能做 client 側。本條原本要求「同片」完成,**改為延後是 2026-08-04
    視窗 C↔主視窗信箱 `C-25-Q` Q1 → `C-26-A` 的核可**(理由:client 側 15 行、不碰
    `products-url-state.tsx` 這個 #287/#288/#289 的現場,與 `/brands` 同片收比較完整)。
    ⚠️ 在 D3c 落地前,`/products?pbrand=X#brand-about` 仍會停在商品目錄頁首、零錯誤訊息。
  - 🔴 **D3c 順帶要補**:`/brands/<slug>` 目前**不在 `sitemap.xml`**(`app/sitemap.ts:22-24` 只列
    靜態路徑 + 商品 handle)。A 案選它的理由就是 SEO,少了地圖等於少一半。
- ~~**狀態:** ⏳ 待執行~~
- **分流:** P1-before-launch
- **優先級:** 🟠 上線前(客人按了會落在錯的頁面,而且沒有錯誤訊息)
- **問題:**
  - 設計稿的網址契約是 `/products?pbrand=X#brand-about`(`brand-page.html:1604-1606` 的
    `intro()` 逐字,`:1605` 註解自稱「正式站的網址契約」;`prototype-router.js:25-34` 也照這條走)。
  - 接線計畫 §3 推薦 **A 案** = 新 route `/brands/<slug>` + **對舊字面加一條 `redirect()`**
    (`docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md:88` 逐字)。
  - D2e-1 的磚牆已經改指 `/brands/<slug>`(`lib/brand-url.ts` 的 `brandIntroUrl`),
    但 **redirect 那一半沒做**,而且 D3 開 route 前 `/brands/<slug>` 本身也還是 404。
  - 🔴 沒有 redirect 的症狀:`?pbrand=X#brand-about` 會落在**商品目錄**、`#brand-about`
    沒有對應錨點 ⇒ 停在頁首。畫面「有東西」、零錯誤,只是不是客人要的那一頁。
- **觸發事件:** 2026-08-04 / D2e-1 關卡2 R1 must-fix(我原本把對照基準寫成
  `brand-content-data.js:1188` 的 `PCM_introUrl` —— 那個函式在設計稿裡**零引用**)。
- **預期解法:** D3 建 `app/brands/[slug]/page.tsx` 時,同片在 `/products` 側加
  `?pbrand=X` + `#brand-about` 的 redirect(hash 不會送到 server ⇒ 需要 client 側或改用 query)。
  🔴 **「hash 收不到」這件事本身要先確認做得到**,做不到就是回頭改計畫 §3 的 A 案,不是硬幹。
- **🔴 D3 的兩條驗收前置(D2e-1 關卡2 R3 補;不寫下來 D3 會照抄「已驗過」而漏掉):**
  - **帶站台 Header 重量六寬度**:D2b-D2e 的真瀏覽器量測全部跑在
    `dev-preview/brand-page/[slug]` 這個**沒有 `<Header>` 的裸頁**上(Header 在本 repo 是
    逐頁掛的,見 `app/page.tsx`;root layout 只有 MobileTabBar)。D3 加上 sticky Header 後,
    首屏高度、`#brand-about` 之類錨點的落點、z-index 疊層**全部是未量測狀態**。
  - **`.bp-page` scope 上機制、不靠人記**:整頁色票(`--cat-*` / `--c-sunken` / 全套灰階)
    都掛在 `.bp-page`,而那個 class 由路由**手掛**;漏掛時只有兩處有 fallback(`--c-graphite`
    與 chip 的 `--c-border-control`),其餘整組沉默降級、沒有任何東西會紅。
    🔶 **2026-08-06 更正**:`--c-graphite` 已升上 `tokens.css` 的 `:root`(首頁 N°04 片)——
    `.bp-page` 漏掛時 `var(--c-graphite, …)` 現在會先吃到繼承自 `:root` 的同值,不再是「沉默
    降級成看不見」;明寫的 fallback 值變成第二層防線,不是唯一防線。`--cat-*` / `--c-sunken` /
    `--c-border-control` 等其餘 token 未升級,原本描述的風險對它們仍成立、機制建議不變。
    ⇒ 機制優先律:抽一個 `BrandPageRoot` wrapper 讓 scope 跟元件走,或補一條 route-level
    斷言「route 輸出的 HTML 含 `.bp-page`」。
- **不修會痛在:**
  - 擴充性:設計稿與原型的連結全部走那個字面,D4 品牌總覽頁也會產同款連結。
  - bug 可追蹤性:落錯頁沒有任何訊號 —— 三綠、CSS 守門、元件測試全部看不到。
- **估時:** 20 分鐘(含確認 hash 的處理方式)
- **依賴:** D3(route 本體)
- **發現於:** 2026-08-04 / D2e-1 關卡2 R1
- **相關:** `apps/storefront/src/lib/brand-url.ts`(`brandIntroUrl`)/
  `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md` §3 /
  Open Design `pcm-home-redesign/brand-page.html:1606`

### #315. 🔇 品牌頁分類 chip 對不上正式目錄的分類名時,會靜默退回「不篩選」

- **狀態:** ✅ **根因已修(2026-08-11 / E 窗;Sean Q1=A「留在網址上」)**
  - **修法**:`use-catalog-filter-url-sync.tsx` 寫回 URL 時,把 URL 上**認不得**的 `pbrand` / `category`
    原樣留著,不再刪。⇒ 下文實測的兩個症狀都消失:`?pbrand=dbk` 再動任何篩選,`pbrand` **不再蒸發**;
    `?pbrand=akrapovic&category=輪框與傳動` 的 `category` 也留著。終態 = **0 筆 + 空狀態**(看得見、
    可自我解釋),而不是「靜默顯示全站商品」。server 只驗形狀不驗對照表(`lib/catalog-query.ts:161`)
    ⇒ 未知但形狀合法的值真的進查詢、真的回 0 筆。
  - **為什麼是「留」不是「清」**:兩者在 URL 上長得一模一樣,程式手上只有「在不在對照表裡」一個位元
    (`products-url-parsers.ts:94`),**分辨不出意圖**;而清掉的代價是看不見的誤導。
    ⚠️ 這**反轉了**原本刻意的設計(舊註解逐字「垃圾參數同 vehicle 語意清掉」),故走 Sean 拍板、
    不由實作端自行決定。plan = 信箱 `E-110-PLAN.md`。
  - **附帶好處(非預期)**:保留後,重建結果與當前 URL **值層等值**(排序後比對、忽略參數順序)
    ⇒ #289 的等值早退通常命中 ⇒ 那一輪連 `router.replace` 都不送,比舊行為少一次往返。
    ⚠️ 不是「一定不送」:`?pbrand=dbk&pbrand=dbk` 這種重複鍵會被收斂成一個 ⇒ 仍送一次收斂導覽
    (無害、一步到定點)。原字面寫「逐字相等」是過度宣稱,跨模型審查 F3 抓到。
  - **守門**:`products-url-state.hooks.test.tsx` **⑪-⑮ 五格**(⑭ 是正向對照,證明「認得的照舊
    要刪」;⑮ 釘住「品牌對照表空掉時照樣保留」)。**四個突變靶**在最終版上全數重跑,靶與紅綠數
    寫在該檔 ⑪ 上方的註解區塊。
    🔴 其中第 ④ 靶(「把空表停用保留的守衛加回去」)是**回歸鎖**:那道守衛在 R1 折入時真的被
    寫進來過,理由聽起來很對(防 RPC 中斷),但**前提是假的** —— 商品過濾走
    `search_catalog_by_vehicle` 的 `p_brand_slugs`(`lib/products.ts:402`),與掛掉的
    `catalog_brand_counts`(:528)是兩支不同的 RPC ⇒ 側欄清單掛掉不影響篩選正確性;
    有那道守衛反而會在中斷期把**有效**品牌刪掉 = 本條的病本身,且不可自癒。跨模型 adversarial
    輪擊破後拆除。
  - ⚠️ **未一併處理(刻意)**:形狀不合法(含 `,()"` 等)的值 server 會丟掉 ⇒ 留在 URL 上會是
    「網址有、卻沒生效」。既有行為、與本條的傷害不同型,要處理是另一條。
  - 🔴 **Q1=A 的必然後果:未知值進了網址,客人在畫面上清不掉**(R1 nit-3;非實作偏離):
    · 只有未知值時,篩選 pill 那一列整列不渲染(`hasAnyFilter` 純由 state 推導,未知值不在 state);
    · 混有真篩選時,「清除全部」只清 state、網址上的未知值仍在 ⇒ 清完仍是 0 筆;
    · 空狀態文案不指名「是哪個值在篩」。
    ⇒ 「看得見」這件事**目前只對網址列成立**,不對畫面成立。這正是 Sean 當時沒選的 C 案
    (「留著且額外顯示一句『找不到這個品牌/分類』」)要解的部分。要補就是補 C 案那半、另開一條;
    **Sean 肉眼驗前主視窗會先講**,免得他當成 bug 回報。
  - ⚠️ 本條下文的 `products-url-state.tsx:NN` 行號**早於 #341-B 拆檔**、現已不指向那段程式碼;
    現行位置 = `use-catalog-filter-url-sync.tsx`(寫回與還原窗口)+ `products-url-parsers.ts`(濾表)。
    下文保留原字面當歷史敘事,不逐行改寫。
- **舊狀態(留存):** 🔶 兩題已拍板並落地(2026-08-05 / D3c-4);本條的根因未修、不關閉
  - 沿革:2026-08-04 / D3b 實測兩軸 → 兩題轉 Sean → **08-05 全拍**(Q1 泛白入口 = D3c-1/-2/-3、
    Q3+Q4 KINEO 分類名 = D3c-4)。⇒ **設計側已無已知不匹配**;
    但「比對不到 = 靜默退回不篩選」這個**機制**一行沒改,客人手打或舊連結進來照樣中。
  - 量測方法:production build + 真 DB(`next start`),真瀏覽器逐條開網址讀最終 URL、卡片數與 active chips。
  - **分類軸:12 個名稱有 11 個命中正式 taxonomy 的「大類」;`輪框與傳動` 兩層都查無。**
    正式 taxonomy 實查 15 個大類 / 75 個子類,`輪框與傳動` 不在其中(最接近的 `腳踏後移與傳動` 是另一回事)。
    🔴 **而且「查無」在與有效 `pbrand` 併用時是靜默的,實測**:
    `/products?pbrand=akrapovic&category=輪框與傳動` → 網址被 **client 端改寫成**
    `/products?pbrand=akrapovic`、顯示該品牌**全部 648 件**、chips 只剩品牌那顆、零錯誤訊息
    (= 本條原本描述的症狀,確認為真)。
    對照:單獨 `/products?category=輪框與傳動` → 0 件 + 空狀態(看得見)。
    差別在 `useCatalogFilterUrlSync` 會把 cascade 狀態寫回網址,而未命中的 category 沒進 cascade。
  - **品牌軸:20 個 slug 有 5 個在目錄零商品 —— `dbk` / `gilles` / `kineo` / `rizoma` / `wrs`**
    (`catalog_brand_counts` 實回 16 家,含一個 `pcm` 測試品牌)。
    🔴 **這一半也是靜默的,而且症狀完全符合本條原文。**(⚠️ 我在 D3b 第一版寫成「不是靜默的」,
    那是**錯的** —— 只看了冷載入的第一畫面就下結論;關卡2 R1 指出後實測推翻。以此版為準。)
    實測(production build + 真 DB,1440):
      · `/products?pbrand=dbk` **冷載入** → 網址不變、0 張卡(看起來像「這家沒商品」)。
      · **接著動任何一個篩選**(實測改排序下拉)→ 網址變成 **`?sort=new`**、`pbrand` **整個不見**、
        列表跳成**全站目錄 50 張**。客人以為還在看 DBK,看到的是全站商品。
      · 對照組 `/products?pbrand=akrapovic`(有商品)同樣操作 → `?pbrand=akrapovic&sort=new`、
        品牌**留著**。⇒ 差別就在「slug 在不在 `fetchCatalogBrandTaxonomy()` 回的 16 家裡」。
    機制:`products-url-state.tsx:98` 的 `parseBrandFiltersFromUrl` 會把不在表裡的 slug 濾掉,
    該結果同時餵 `:249` 的 `restorable` 判斷;首輪有 `initialized` 守衛擋著,所以冷載入那次沒事,
    第二次往返就被 `useCatalogFilterUrlSync` 寫回一個沒有 `pbrand` 的網址。
    ⚠️ **上面的數字全部量在 production build**;`next dev` 的 StrictMode 第二次 invoke
    **會繞過那道首輪守衛**(`products-url-state.tsx:210-212` 逐字)⇒ dev 下冷載入當場就掉,
    看起來比 production 更早壞。重現時先確認自己跑的是哪一種,別因此誤判整段分析。
    （點分類 chip、瀏覽器上一頁走的是同一段程式碼,結局相同 —— 都被「動任何一個篩選」涵蓋。)
    ⇒ **與分類軸是同一條機制、同一段程式碼**,只差在觸發時機。
    ⚠️ 原文寫的來源 `buildBrandTaxonomy(products)` 不是這條路徑實際吃的東西 ——
    `/products` 傳的是 `fetchCatalogBrandTaxonomy()`(server RPC 全站聚合);兩者對「零商品品牌」的
    結論相同(都不在表裡),但引用要更正。
  - **今天客人碰得到的實害**:那 5 家的品牌頁,橫幅兩顆 CTA(`brandCatalogueUrl` / `brandVehiclePickUrl`)
    與磚牆點進去先是**空目錄**,**再動一下篩選就變成全站目錄**(上一段實測)。`輪框與傳動` 那條靜默失效**今天碰不到** —— 它只掛在 KINEO,
    而 KINEO 正好是 0 商品 ⇒ 那條 chip 進去先撞空目錄。**KINEO 一旦上架商品,它就會變成靜默失效。**
  - **D3b 已做的**:商品區 0 筆整區不渲染(不留空骨架、不自編文案);
    `lib/brand-products.test.ts` 釘住設計側的 20 slug + 12 分類名清單(改動時會紅、提示重新比對)。
  - ~~🔴 **還沒做、需要拍板的兩題**(見 D3b 收工信 `C-29-STOP`)~~ ✅ **兩題 Sean 都拍了**:
    - **① 那 5 家零商品品牌 → Sean 2026-08-04 拍板(信箱 `C-31-A`):頁照上,但入口的
      磚/列泛白且不可點,有商品自動恢復**(三個原選項都沒選,是第四種)。
      落地:**D3c-1** 品牌頁磚牆(`BrandPageBrandWall`)、**D3c-2** 首頁那一排(`BrandIndex`)。
      「哪幾家」由 `lib/brand-products.fetchBrandsWithProducts()` 從 `catalog_brand_counts`
      衍生、**不寫死名單**;撈取失敗 fail-closed(全部當成沒商品)。
      🔴 **這只擋住入口、沒修本條的根因** —— 客人手打或從舊連結進 `/products?pbrand=dbk`
      仍會踩到上面那段靜默失效。**本條不因此關閉。**
      ⚠️ 而且**兩個 key 都會踩**:首頁那一排連的是 legacy 的 `?brand=`
      (`products-url-state.tsx:95-97` 仍收),與 `?pbrand=` 走**同一支**
      `parseBrandFiltersFromUrl`、同一個「濾掉不存在的 slug ⇒ 寫回沒有品牌的網址」結果。
    - **② `輪框與傳動` → Sean 2026-08-04 拍 Q2=A:改成最接近的正式分類名。**
      D3c-2 實查候選(production build + 真 DB,讀 `/products` 側欄分類樹):正式目錄**沒有**
      單層的「輪框」大類;`懸吊與車架` 底下有子類 **`輪圈`(8 件)**,而原名裡的「傳動」
      落在另一個大類的 `齒盤與傳動`(128 件)—— **一顆 chip 對不到兩個地方**。
      ⚠️ 而且 `parseCategoryFromUrl`(`products-url-state.tsx:59-78`)拿 raw **只比大類**,
      子類必須寫成 `大類 · 子類`(分隔符逐字 ` · `,同檔 :51)⇒ 直接填 `輪圈` 會是**同一種
      靜默失效**。⇒ 多候選且各有取捨 ⇒ 依拍板「多候選寫信箱」轉 Sean、**未自行挑**
      (信箱 `C-38-STOP`)。
      ✅ **Sean 2026-08-05 拍 Q3=A / Q4=A**:指到 `輪圈` 子分類、標籤字面就照顯示
      `懸吊與車架 · 輪圈`(零資料形狀改動)。**D3c-4 已落地** —— `brand-content.ts` 的 KINEO
      `categories` 改成該字面,並配一條**直接餵正式站那支 `parseCategoryFromUrl`** 的驗證
      (證明兩層真的解得出來;而且對「只填子類」「舊字面」「分隔符少一個空格」三種壞值
      會回 null 或只回大類 —— 前提有判別力才算數)。
      ⇒ 12 個分類名**目前沒有已知的不匹配**,但這句話要帶量測層級與日期錨才誠實
      (關卡2 R1 must-fix 更正,我原本寫成無日期的「全部命中」):
      **11 個依 2026-08-04 實測命中「大類」**(不是子類)、**KINEO 那個依 2026-08-05 實測
      命中「大類 · 子類」兩層**。兩批都是當天的一次性量測,**沒有機制持續比對**(見本條末段)。
      根因(比對不到 = 靜默退回不篩選)一行沒改 ⇒ 本條仍不關閉。
  - 🔴 **「設計側清單 vs 真目錄」目前沒有機制**:單元測試沒有 DB 連線,抄成 fixture 只會變成
    會過期的假真相。要變成機制得先有能連 DB 的 CI job。這是已知能力邊界、不是漏做。
- ~~**狀態:** ⏳ 待執行~~
- **分流:** P1-before-launch
- **優先級:** 🟠 上線前(客人按了以為篩了,其實沒有)
- **問題:**
  - D2e-1 的 chip 產 `/products?pbrand=X&category=<分類名>`(設計稿 `brand-content-data.js:1187`
    的 `PCM_catalogueUrl` 同式),讀取端是 `components/products-url-state.tsx:63-79`。
  - 🔴 `parseCategoryFromUrl` 對 catalog taxonomy 走 `c.name === raw || c.id === raw`,
    **比對不到就 `return null`** ⇒ 整個 category 軸靜默消失,客人看到的是
    「該品牌全部商品」,**和沒按 chip 長得一模一樣**、零錯誤訊息。
  - 設計側的 12 個分類名(`brand-content.ts` 共 52 筆)**與正式目錄 taxonomy 對不對得上,
    截至 D2e-1 未驗** —— D2e-1 只保證網址形狀正確(`lib/brand-url.test.ts` 有守)。
  - 🔴🔴 **`pbrand` 那一半是同一個病、而且更容易中**(D2e-1 關卡2 R3 換角度抓到,
    我原本只釘了 category 軸):`components/products-url-state.tsx:98` 的
    `parseBrandFiltersFromUrl` 把 pbrand 過濾成
    `requested.filter((slug) => productBrands.some((b) => b.id === slug))`,
    而 `productBrands` 來自 `lib/brand-taxonomy.ts:27` 的 `buildBrandTaxonomy(products)`
    —— **由「目前目錄裡真的有商品」的品牌衍生**(`:30-42` 逐筆分組,零商品的品牌根本不進表)。
    ⇒ 20 家裡任何一家在目錄還沒有商品時,`pbrand` 被**整個丟掉**、只剩 category
    ⇒ 客人在 Akrapovic 品牌頁按「排氣系統」chip,看到的是**全品牌**的排氣商品(含競品),
    而且畫面上完全沒有「品牌篩選被丟掉了」的訊號。
    ⚠️ 這一半連橫幅那兩顆 CTA(`brandCatalogueUrl` / `brandVehiclePickUrl`,D2b 就上線了)
       也一起中 —— 不是 D2e-1 新引入的,是本片讓它多了 52 個入口。
- **觸發事件:** 2026-08-04 / D2e-1 關卡2 R1(審查指出「零改動」的說法沒有涵蓋 miss 的失敗模式)。
- **預期解法(兩個軸都要做,只做一半等於沒做):**
  - **category 軸**:D3 接線時逐一比對 12 個名稱 vs 正式 taxonomy,對不上的走「改資料」
    還是「加對照表」由 Sean 拍;補一條測試:12 個名稱都能命中(對不上時**測試紅**、不是畫面靜默)。
  - **pbrand 軸**:同樣補一條測試 —— **20 個 slug 全部要在 `buildBrandTaxonomy` 的輸出裡命中**;
    對不上的(= 目錄裡還沒有商品的品牌)要拍板:是先不掛那家的品牌頁、還是讓 `pbrand`
    在 miss 時走 fail-visible(顯示「這個品牌目前沒有商品」)而不是靜默丟掉。
  - 🔴 兩條測試都要跑在**真目錄資料**上,不是 mock —— 用 mock 的話兩邊永遠對得上、守門恆綠。
- **不修會痛在:**
  - 可維護性:分類表改名時沒有任何東西會紅,chip 會一批一批默默失效。
  - bug 可追蹤性:失敗長得和成功一樣,只有逐個點過才發現。
- **估時:** 45 分鐘(兩個軸的比對 + 兩條守門);要改資料另計
- **依賴:** D3
- **發現於:** 2026-08-04 / D2e-1 關卡2 R1(category 軸)+ R3 換模型換角度(pbrand 軸)
- **相關:** `apps/storefront/src/lib/brand-url.ts`(`brandCatalogueUrl`)/
  `apps/storefront/src/components/products-url-state.tsx:63-79` /
  `apps/storefront/src/data/brand-content.ts`(52 筆 categories)/
  `apps/storefront/src/lib/brand-taxonomy.ts:27-42`(pbrand 那半邊的根源)/ #287(`?pbrand=` 未消歧)

### #316. 🎞️ 品牌頁的「捲動揭示」設計稿寫好了但刻意不搬 — 上線後 Sean 逛過再決定

- **狀態:** ⏳ 待決定(**已拍板延後,不是漏掉**)
- **分流:** P2-after-launch
- **優先級:** 🟡 上線後(純體感,不影響任何功能)
- **問題:**
  - 設計稿**自己前後矛盾**:動效層抬頭 `brand-page.html:794` 逐字寫「**刻意不做捲動揭示**
    —— 這頁是購物動線、內容密,揭示動畫只會延後閱讀」;但同一份檔案
    `:821-825` 有 `.js-reveal` / `.is-in` / 三段 `data-reveal-delay` 的 CSS、
    `:2033-2071` 有整段 IntersectionObserver,涵蓋**七個群組**
    (`#bp-facts` / `#bp-about-inner` / `#bp-why .bp-why-card` / `#bp-craft .bp-craft-panel` /
    `#bp-time` / `#bp-cats` / `#bp-others`)。
  - **Sean 2026-08-04 拍板 = C:先不做,上線後實際逛過再決定加不加。**
    ⇒ 矛盾按抬頭解,七群組的 CSS/JS 不搬;D2e-2 的動效層只做「橫幅入場 + 互動回饋」兩段。
- **觸發事件:** 2026-08-04 / D2e 開工前偵察(視窗 C 發現矛盾 → 信箱 C-16-STOP → Sean 拍 C)。
- **預期解法:** 上線後 Sean 逛過真站再回來決定。要做的話程式已備:
  設計稿 `:821-825`(CSS)+ `:2033-2071`(JS,一次性 observer、`prefers-reduced-motion`
  或無 IntersectionObserver 時完全不介入),七群組裡有五個屬已落地的 D2b/D2c/D2d 區塊
  ⇒ 要在那些元件上加 class + 一支 client 元件,**影響面是整頁**。
- **不修會痛在:**
  - 不修不痛(這就是拍板延後的理由);但**紀錄不留會痛** —— 設計稿裡那段程式碼會被
    下一個人當成「漏搬」而重新翻案,或反過來被當成死碼刪掉。
- **估時:** 要做的話約 40 分鐘(七群組 + reduced-motion 兩層 + 守門)
- **依賴:** 上線 + Sean 實際逛過
- **發現於:** 2026-08-04 / D2e 偵察;Sean 同日拍板 C
- **相關:** Open Design `pcm-home-redesign/brand-page.html:794`(抬頭)與 `:821-825` / `:2033-2071`(程式)/
  `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md` §5.2 動效層那段 /
  信箱 `C-16-STOP.md` ③ 與 `C-15-A.md` 第 2 板

### #317. 📏 品牌磚牆在 ≤620:長品牌名撐到三行,那幾列的磚比別列高、而且會斷在字中間

- **狀態:** ⏳ 待執行
- **分流:** P2-after-launch
- **優先級:** 🟡 上線後(純視覺,不影響點擊與內容)
- **問題:**
  - 390 實測(2026-08-04,production build):20 磚分 7 列,列高 **127 / 128 / 143 三種**。
    143 的兩列各含一個三行名字:`DBK SPECIAL PARTS`、`EVOTECH PERFORMANCE`。
    (同一列內是齊高的 —— flex 預設 `align-items: stretch`;差的是列與列之間。)
  - 同時 `overflow-wrap: anywhere`(設計稿 `:1314`)會把 `PERFORMANCE` 斷成
    `PERFORMANC` + `E` —— 一個字母孤零零占一行。
  - 🔴 **兩個都是設計稿自己的行為**:`.bp-others-name` 在 ≤620 是 `min-height:30px`(= 兩行),
    三行名字必然超過;而 `anywhere` 是設計稿刻意選的(`break-word` 在 min-content 計算階段
    不生效 ⇒ 3 欄會直接爆成 2 欄 + 一個洞,那個更難看)。改任何一邊都是偏離設計字面 = 鐵則 1。
- **觸發事件:** 2026-08-04 / D2e-1 真瀏覽器量測(390 逐磚量 `getBoundingClientRect`)。
- **預期解法(需 Sean 拍板,三選一):**
  - A. **接受**(現況;上游設計稿同樣如此)
  - B. `.bp-others-name` 在 ≤620 改成固定三行高(`min-height:46px`)⇒ 全部列等高,代價是短名字底下多一行空白
  - C. 縮字級或加 `hyphens` / 改用 `word-break: keep-all` + 縮 `letter-spacing` ⇒ 讓長名字塞得進兩行
- **不修會痛在:**
  - 可維護性:新增品牌時名字一長就會多一種列高,沒有任何守門會提醒。
  - 擴充性:首頁磚牆(`.b-brand-wall`,grid 5 欄)是另一套排法,同一個字串在那邊的斷點不同 ⇒ 兩邊要分開判。
- **估時:** B 案 5 分鐘 / C 案 15 分鐘(都要重量 390 與 620 兩個寬度)
- **依賴:** Sean 拍板(視覺品味)
- **發現於:** 2026-08-04 / D2e-1
- **相關:** `apps/storefront/src/styles/brand-page.css`(≤620 的 `.bp-others-name`)/
  Open Design `pcm-home-redesign/brand-page.html:941` 與 `:1314` /
  #308(品牌頁 band logo 的 alt 與 h1 重複)、#310、#311、#312、#313
  (同族:設計稿繼承的 a11y/視覺缺陷走拍板)

### #318. ♿ 全站級的 `prefers-reduced-motion` 沒有統一 — home / filter-drawer 的動畫零保護

- **狀態:** ⏳ 待執行
- **分流:** P2-after-launch
- **優先級:** 🟡 上線後(對前庭敏感的使用者是真的不舒服,但不影響功能與交易)
- **問題:**
  - 設計稿有**兩層** `prefers-reduced-motion`:
    ① 動效層自帶的 scope 版(`brand-page.html:860-866`,逐條點名 `.bp-*`)
    ② **全域版**(`:461-465`)`*,*::before,*::after{transition-duration:.01ms!important;
      animation-duration:.01ms!important}`
  - D2e-2 搬了 ①,並依 **Sean 2026-08-04 拍板 Q1=B** 補了一條 scope 版的影片淡入保護
    (`brand-page.css` 的 `.bp-film-frame > iframe, .bp-film-frame > video { animation: none }`)
    ⇒ **品牌頁自己已經沒有缺口**。
  - ❌ 但 ② **沒搬**,而全站的 reduced-motion 是**逐檔各做各的、沒有統一**。
    🔴 **實查(2026-08-04;方法 = 用 `brand-page.test.ts` 那支 `cssRules()` 走訪器對
       `apps/storefront/src/styles/*.css` 全掃,不是 grep 印象)**:
      · **有** scope 版 reduce 區塊:`checkout.css` / `product-page.css` / `products-page.css` / `brand-page.css`
      · **零 reduce 但有動態**(缺口,5 支):
        `home.css`(animation 1 + 互動位移 5)/ `filter-drawer.css`(animation 5)/
        `cart.css`(位移 2)/ `line-cta.css`(位移 2)/ `product-card.css`(位移 2)
    ⚠️ 這條的範圍我改過**兩次**,兩次都是往「比我說的大」的方向:
       · 第一版「品牌頁以外**完全沒有任何**保護」= 錯(關卡2 R1 打掉;lessons §13:
         下「X 未覆蓋」的斷言前必 grep)
       · 第二版只點 `home.css` / `filter-drawer.css` = **仍然太窄**,因為我當時只篩 `@keyframes`,
         而**互動位移才是主要的動效軸**(關卡2 R2 打掉,那正是本片自己剛學到的教訓)
    ⚠️ 關卡2 R2 報的是 7 支(多算 `filter-cascade` / `filter-side` / `header` / `pages-shipping`)——
       **那四支我逐檔看過,是 `translate(-50%)` 這類靜態置中、不是動態**,關掉反而會讓版面歪掉。
       這裡採 5 支;判準 = 「互動狀態選擇器(`:hover`/`:active`/`:focus`)上的 transform」與
       「非 `@keyframes` 內的 animation 宣告」,與本片守門用的是同一把尺。
  - 🔴 不搬 ② 的理由 = `*` + `!important` 會蓋掉**全站每一條** transition 與 animation,
    影響面遠超任何單一片的範圍(鐵則 8),值得它自己一次拍板。
- **觸發事件:**
  - 2026-08-04 / D2e-2。⚠️ 我一度把這題說成「全域那層是唯一保護、所以非搬不可」,
    **那個前提是錯的**(信箱 `C-20-Q.md` 的更正):實查後動效層自帶的 scope 版已覆蓋絕大多數,
    真正的缺口只剩影片淡入一條。題目縮小之後 Sean 才拍 B。
  - 順帶記錄設計稿自身的張力:動效層那層的註解寫「顏色/邊框的狀態切換**保留**」,
    但全域那層的 `!important` 會把顏色過渡也壓成瞬間 ⇒ 設計稿裡兩層並存的淨效果是全部瞬間。
    要做 ② 的時候得先決定要哪一種語意,**不能兩層照搬了事**。
- **預期解法(需 Sean 拍板,影響面大):**
  - A. 把 ② 放進 `styles/tokens.css`,全站一次到位(最正確;但要逐頁看過有沒有哪個動畫
    被關掉之後反而變得難懂 —— 例如「載入中」的轉圈、抽屜開合的方向感)
  - B. 只補那 5 支缺口(各補一個 scope 版區塊),其餘維持逐檔各做 ——
    工最少,但「全站語意一致」這件事仍然沒人負責;而且判準要跟著寫下來,
    否則下一個人又會只看 `@keyframes`、漏掉互動位移(本條自己踩過兩次)
  - 🔴 兩案都要先回答「顏色過渡要不要一起關」那一題(見上面的張力)。
- **不修會痛在:**
  - 擴充性:每新增一個動畫就多一個沒保護的點,而且沒有任何守門會提醒
    (品牌頁有 `brand-page.test.ts` 的反向守門,**其他頁沒有** ——
     而且那條守門自己也只涵蓋 `animation`,不涵蓋 transform 過渡,見該檔註解)。
  - 可維護性:同一件事將來會在 N 個檔案裡各做一次,語意還可能不一致。
  - bug 可追蹤性:開了「減少動態」的使用者不會回報「網站還在動」,只會覺得不舒服然後離開。
- **估時:** A 案 30 分鐘 + 逐頁目視;B 案視頁數
- **依賴:** Sean 拍板
- **發現於:** 2026-08-04 / D2e-2(Sean 同日拍板 Q1=B,把品牌頁那半邊收掉)
- **相關:** `apps/storefront/src/styles/brand-page.css`(動效層那段的 @media 區塊)/
  `apps/storefront/src/styles/home.css` / `filter-drawer.css` / `cart.css` / `line-cta.css` /
  `product-card.css`(5 支缺口)/ `brand-page.test.ts` 的 `cssRules()`(掃描方法可直接重用)/
  `apps/storefront/src/styles/tokens.css`(A 案的落點)/
  Open Design `pcm-home-redesign/brand-page.html:461-465` 與 `:860-866` /
  信箱 `C-19-A.md`(拍板)與 `C-20-Q.md`(我的前提更正)/ #312 第三條(原本在追這件事)

---

### #319. 🔁 storefront 對 Open Design 的**回寫債**:D2f 五處偏離只在 repo、設計稿側未同步

- **狀態:** ✅ 已完成(2026-08-04 主視窗執行,Sean 拍 A=五處全部回寫)。
  materya `video` 進 `brand-content-data.js`(產生器實跑驗證:輸出與 repo 逐字同、20 家完整);
  `brand-page.html` 四處(alt=""/aria-hidden/#310 規則/#311 改 p + #312 sr-only+去 title)
  逐項在 OD 預覽真瀏覽器驗過;repo 兩檔頭過時警告同步更正。
  ⚠️ mp4/poster 實體檔仍只在 repo,OD 預覽該格播不動=正常(資料檔註解已載明)。
- **分流:** P2-later
- **優先級:** 🟠 上線前(其中 materya 影片那條會**被重新產生靜默刪掉**,不是純潔癖)
- **問題:**
  - 2026-08-04 / D2f 一片裡有五處內容/程式與 Open Design `pcm-home-redesign` **不再一致**,
    全部是 Sean 當天拍板要的、全部只落在 repo 這一側:
    | # | 偏離 | repo 位置 | OD 來源 |
    |---|---|---|---|
    | 1 | **materya 換影片**(About 右欄產品照 → 直式 IG reel) | `data/brand-content.ts` 的 materya `video` | `brand-content-data.js` |
    | 2 | band logo `alt=""`(#308) | `BrandPageHeader.tsx` | `brand-page.html:1642` |
    | 3 | `.bp-why-num` `aria-hidden`(#308) | `BrandPageWhy.tsx` | `brand-page.html:1976` |
    | 4 | ≤620 數字條補分隔線(#310) | `styles/brand-page.css` | `brand-page.html:1183-1185` |
    | 5 | 產品照卡標題改 `<p>`(#311)+ 年表 sr-only、craft 去 `title`(#312) | 四支元件 + CSS | `:1964` / `:2011` / `:1999` |
  - ⚠️ 連帶:`data/brand-content-types.ts` 檔頭的求值統計(video 11→12、file 4→5、source 4→5)
    也跟著只在 repo 這側更新 —— 拿 OD 求值仍會得到舊的三個數字。
  - 🔴 **第 1 條有真正的資料遺失風險,其餘四條只是「設計稿還留著舊寫法」**:
    `brand-content.ts` 檔頭寫明【機器產生】並附重新產生指令,**照著重跑會把 materya 的
    `video` 整塊刪掉**,而在 D2f 之前沒有任何測試會紅 —— `brand-assets.test.ts` 只驗
    「資料引用的檔案存在」,少一筆引用它不會知道;video 互斥性那條對「沒有 video」是
    `continue` 直接跳過。**D2f 已補一條守門**(`brand-content.test.ts` 的
    「materya 的 About 右欄影片還在」),但守門只會讓你**知道**被刪了,不會幫你把它加回去。
- **觸發事件:**
  - 2026-08-04 / D2f。Sean 指定素材(IG reel `DVeM7gWDB3F`,720×1280 直式 72 秒含聲音)
    + 拍 A「四條繼承瑕疵程式側直接修」,兩件事都明說 OD 側未同步 = 已知留債。
- **預期解法:**
  - A. **把五處回寫進 OD 來源**(乾淨解):`brand-content-data.js` 補 materya 的 `video`、
    `brand-page.html` 改那四處。之後 `brand-content.ts` 可以無顧慮重新產生。
  - B. 只回寫第 1 條(資料),其餘四條留在 repo 當「storefront 比設計稿新」的常態。
  - 🔴 兩案都要決定**誰有權改 OD**(設計側是 Design session 的地盤,分工上 Claude Code 不做視覺設計;
    但這五處都不是視覺決定 —— 四條是 a11y/CSS 修正、一條是 Sean 指定的素材)⇒ 走 Sean 拍板。
- **不修會痛在:**
  - 擴充性:D3 之後只要有人照檔頭重新產生 `brand-content.ts`,materya 的影片就沒了;
    而每多一次這種手改,回寫成本就再高一層(現在是 5 處,還數得完)。
  - 可維護性:「OD 是真權威」(鐵則 1 例外、Sean 08-03 拍 Q1=B)與「repo 才是最新」並存,
    下一棒 grep 設計稿字面時會拿到舊寫法、以為 repo 搬錯了 —— 兩邊的檔頭都已加註記,但註記不是機制。
  - bug 可追蹤性:第 1 條被刪掉時客人看到的是「右欄變回一張靜態產品照」,沒有人會回報。
- **估時:** A 案 30-40 分鐘(含 OD 側逐處驗)/ B 案 10 分鐘
- **依賴:** Sean 拍板(誰改 OD)
- **發現於:** 2026-08-04 / D2f
- **相關:** `apps/storefront/src/data/brand-content.ts`(檔頭 🔴🔴 那段記了同一件事)/
  `apps/storefront/src/data/brand-content.test.ts`(materya 影片守門)/
  `apps/storefront/src/styles/brand-page.css`(檔頭「反方向」那段列了 CSS 側三處)/
  #308(品牌頁 band logo 的 alt 與 h1 重複)、#310、#311、#312(四條偏離的本體)/
  Open Design `pcm-home-redesign/brand-content-data.js` 與 `brand-page.html`

---

### #320. 🔇 品牌頁影片「點播有聲」在 iOS Safari 可能不成立(React 掛載晚於手勢)

- **狀態:** ✅ 已結案(2026-08-04 Sean 拿 iPhone 實機開 materya 品牌頁按播放=**有聲音**;
  疑慮未成真,現行寫法在真機上可用。元件內錯誤註解已由 D2f 更正,不另改行為)。
- **分流:** P1-before-launch
- **優先級:** 🟠 上線前(**Sean 會拿自己的手機驗,而這正是最可能失敗的裝置**)
- **問題:**
  - `BrandPageMedia.tsx` 的播放流程 = 點封面 → `setPlaying(true)` → React 重繪 →
    `<video autoPlay>`(**不設 muted**)才掛進 DOM。元件註解寫「自動播有聲之所以不會被
    瀏覽器拒,是因為掛載必定發生在使用者點下封面之後(同一個手勢鏈)」。
  - 🔴 **那句對 iOS Safari 不成立**。WebKit 官方逐字:「when we say that an action must have
    happened "as a result of a user gesture", we mean that the JavaScript which resulted in the
    call to `video.play()` … must have **directly** resulted from a handler」
    ⇒ 要求**同步**發生在手勢處理器裡。React 的 state 更新讓 `<video>` 在**之後**的
    渲染工作才進 DOM,手勢額度可能已經不在。
  - ⇒ 客人按了封面,可能得到**靜音播放**或**根本不播**。桌機 Chromium 實測是好的
    (2026-08-04 / D2f:`muted=false`、`webkitAudioDecodedByteCount>0`)——
    **但那證不了 iOS**,兩者的政策不同。
  - **影響 5 家自架片品牌**(cnc-racing / front3d / gilles / lightech / materya),
    不是 materya 一家;materya 是 D2f 新加入的第 5 家。
- **觸發事件:**
  - 2026-08-04 / D2f 關卡2 R3(換角度:真實使用者與執行面)。**前兩輪都沒看到這一面**
    —— 它們打的是字面正確性與守門判別力,而這條是「桌機綠、客人的手機上壞掉」。
- **預期解法(需驗證,不是三選一那種):**
  - A. 在 click handler 裡**同步**呼叫 `play()`:改成播放器常駐(隱藏)、點擊時 `ref.current.play()`,
    而不是點擊後才建元素。🔴 但這與設計稿記載的「點了才掛播放器」行為(D2c-2 為了修
    Sean 2026-08-02 回報的「youtube 影片點不開」而搬的)直接衝突 —— **自架 mp4 與
    第三方 iframe 可以分開處理**,前者沒有跨網域框架被擋的問題。
  - B. 接受靜音起播 + 讓客人自己按喇叭(`controls` 已經在)。最省事、但不符 Sean 的驗收條件。
  - 🔴 **兩案都必須在真的 iOS 裝置上驗過才算數** —— 這條的成因就是「在錯的裝置上量」。
- **不修會痛在:**
  - 擴充性:每多一家自架片品牌就多一個中招點;D3 上正式路由後是 20 家品牌頁的常態入口。
  - 可維護性:元件註解目前**寫著一個錯的理由**(「同一個手勢鏈」),下一個人會照著信。
  - bug 可追蹤性:客人不會回報「影片沒聲音」,只會以為這支影片本來就沒聲音。
- **估時:** A 案 40 分鐘 + 真機驗;B 案 10 分鐘
- **依賴:** 一台真的 iPhone(Sean 的手機即可)
- **發現於:** 2026-08-04 / D2f 關卡2 R3
- **相關:** `apps/storefront/src/components/brand/BrandPageMedia.tsx:155-171`(`BrandFilmPlayer` 的
  `video.file` 分支 + `:157-160` 那段寫錯理由的註解)/
  WebKit 官方 <https://webkit.org/blog/6784/new-video-policies-for-ios/> /
  #319(materya 影片那條偏離)/ memory `reference_pcm-mobile-device-verify-dev-vs-prod`

### #322. 🔁 storefront 對 Open Design 的回寫債(第二批):D3b / D3c-1 / D3c-2 / D3c-3 的偏離只在 repo

- **狀態:** ⏳ 待執行
- **分流:** P2-after-launch(不影響客人,影響的是「設計稿還能不能當真權威」)
- **優先級:** 🟡 D5 開工前(D5 要重排首頁、會大量讀 OD;那時兩邊不一致最容易誤判)
- **問題:**
  - #319 是**第一批**(D2f 五處)、已於 2026-08-04 回寫完成並結案。
    **本條是第二批** —— D3b 與 D3c-1 又長出四處 repo 先行、OD 未跟進的偏離(⚠️ 第 1 項已於 2026-08-07 失效、**實際待回寫剩三處**,見該項):
    1. ~~**D3b · 選擇器改名**:設計稿的窄螢幕隱藏規則寫 `.bp-grid .bp-slot:nth-child(n+4)`,
       正式站改成 `.bp-grid > :nth-child(n+4), .bp-grid > :nth-child(n+4) .pcard`。~~
       ✅ **本項已失效、不必回寫**(2026-08-07 manifest 收尾片查證):
       **R-2 把品牌頁熱門商品整區改成共用的 `<ProductRail variant="inset">`**,
       `.bp-grid` 磚牆整族退場 —— 實查 `brand-page.css` **剝掉註解後 `.bp-grid` / `.bp-slot` 零命中**
       ⇒ 正式站已經沒有這個選擇器了,沒有東西要回寫給 OD。
       ⚠️ 本條其餘各項(尤其第 2 項 `.bp-page` 的 `--ed-c-ink`)**仍然成立**:
       同一次實查確認 `--ed-c-ink` 在 `brand-page.css` 仍有一條活宣告。
    2. **D3b · `.bp-page` 補一份 `--ed-c-ink`**:設計稿靠外層 `.ed-page` 提供這個 token,
       正式站的品牌頁**刻意不掛 `.ed-page`**(它在 storefront 是首頁專屬的 token 作用域)
       ⇒ 不補的話「查看全部」的底線整條消失。
    3. **D3c-1 · 選擇器改名**:`.bp-others-list a` → `.bp-others-list > *`(9 條),
       因為磚現在可能是 `<a>` 也可能是 `<span>`;`.is-cur` 三條用 `:is(a, span)` 保住特異度。
    4. 🔴 **D3c-1 · `.is-empty` 三條規則 —— 設計稿完全沒有這個狀態**。
       依 **Sean 2026-08-04 拍板**(信箱 `C-31-A`):目錄零商品的品牌,磚要泛白且不可點。
    5. **D3c-2 · `home.css` 也長出同款三處**(同一拍板在**首頁品牌清單**的一致執行,
       主視窗 `C-33-A` 裁示):`.ed-brand-list a` → `.ed-brand-list > li > :is(a, span)`(兩處、
       宣告一字未動)/ `.is-empty` 三條 / `.ed-sr-only` 一條。**設計稿三者皆零命中。**
       ⇒ 本條的範圍因此**從 `brand-page.html` 擴到 `home.css` 對應的 OD 來源**。
    6. **D3c-3 · `/brands` 總覽頁(`brand-directory.css`)的四類偏離**——
       ① **全部 class 加 `bd-` 前綴**:設計稿用 `.wrap` / `.grid` / `.brand` / `.eyebrow` /
       `.outro` / `.directory` 這種極通用的裸名,在原型的單檔單頁沒問題,搬進正式站的
       **全域 stylesheet** 等於在全站語彙裡插一顆 `.grid`(宣告一字未動)。
       ② **兩個入口改指 `/brands/<slug>`**:設計稿 `aboutHref` 是原型時期的
       `/products?pbrand=X#brand-about`,本線已拍 A 案。
       ③ **家數字面改由資料求值**(設計稿寫死「20 家」「20 BRANDS」)。
       ④ **設計稿全域 reset 只補了兩條、且改成 scope**:`ul` reset 補在 `.bd-grid` 上、
       `:focus-visible` 焦點環補在 `.bd-page` 內(設計稿是全域)。
       ⛔ 另有**兩處刻意不搬**(不是偏離、但回寫時要一起講):站台 chrome（正式站用既有
       `<Header>` / `<HomeFooter>`)、`.intro` 那一族(設計稿自己的 markup 零命中、是改版死碼)。
  - 三支 CSS 的檔頭都已同步列出自己那份清單:`brand-page.css`(四處;第一批那句
    「兩邊現在一致」只涵蓋 D2f、不要讀成整個檔的現況)、`home.css`(三處)、
    `brand-directory.css`(四類偏離 + 兩處刻意不搬)。
  - ⚠️ **順帶記一筆不同性質的債(D3c-2 關卡2 R1 nit)**:`.ed-sr-only` 與 `.bp-sr-only`
    現在是**三份逐字相同**的 sr-only 實作(`.bp-sr-only` / `.ed-sr-only` / `.bd-sr-only`),而三支的註解都寫「站台級要放哪不該由單一頁面
    開先例」—— 出現第二份的當下,那個理由本身已被推翻。**乾淨解 = D5 前在 `tokens.css`
    放一支站台級 `.sr-only`、三邊改吃它**(三處刪除、零新增)。放這裡是因為它與回寫債
    同一批被翻出來;真要做時可獨立成片,不必等 OD 回寫。
- **觸發事件:** 2026-08-04 / D3c-1 關卡2 R1 must-fix 4 —— 我在 commit body 與兩處程式註解
  都寫「OD 回寫債照 #319 前例併記」,但 #319 當時**已經結案**,等於這筆債沒有任何落點。
- **預期解法:** 與 #319 同樣的做法:把 1-4 回寫進 OD 的 `brand-page.html`、把 5 回寫進
  首頁對應的 OD 來源,回寫後把三支 CSS 檔頭的清單各自改成「已回寫」。
  ⚠️ 第 4 項(`.is-empty`)回寫時要一併把「哪些品牌泛白」這個**狀態的存在**告訴設計側 ——
  它不是樣式細節,是一個 OD 目前沒畫過的頁面狀態。
- **不修會痛在:**
  - 可維護性:D5 重排首頁時會大量讀 OD;兩邊不一致會讓「設計稿怎麼寫的」這個問題答錯。
  - bug 可追蹤性:下一個人照 OD 重新產生任何東西,這四處會被靜默蓋掉(#319 踩過同一個坑)。
- **估時:** 60 分鐘(六項都有精確位置;第 5 / 6 項各多一個 OD 來源檔)
- **依賴:** 無(可獨立做);建議與 D5 開工前的 OD 對帳一起
- **發現於:** 2026-08-04 / D3c-1 關卡2 R1
- **相關:** #319(第一批,已結案)/ `apps/storefront/src/styles/brand-page.css` 檔頭兩張清單 /
  信箱 `C-31-A`(Sean 拍板原文)

### #321. 🔒 mark 家族三支金流 RPC 鎖序統一 orders-first — begin×genesis 的已知死結面根治路

- **狀態:** ⏳ 待執行
- **分流:** P2-after-launch(Sean 2026-08-04 拍板 Q1=A:A8c1 照 row 34 上線、本題立 backlog 待排程)
- **優先級:** 🟡 罕見、自癒、零錢風險 —— 但屬「環的組合面」結構債
- **問題:**
  - A8c1 讓 `begin_charge_attempt` 成為第一個「持 `orders` FOR UPDATE、後觸 `payment_charge_attempts`」的函式,
    打破 r1c3 檔頭(`20260624120010:24-27`)自陳的全庫不變式「無 order→attempt 反向鎖序 ⇒ 無死結」。
  - **實測(2026-08-04,真 RPC、拋棄式 PG17,腳本收編於 `scripts/a8c1-verify.sh` L3/L4 格)**:
    · `mark_charge_attempt_failed` × begin = **只阻塞、零 40P01**(它的 UPDATE 在 orders 鎖後;
      begin 的 `ON CONFLICT DO NOTHING` 對 lock-only pending 列不等待);`close_released_attempt` 同構。
    · `mark_charge_attempt_charged` released→charged genesis × begin = **真死結 40P01**
      (genesis 先 UPDATE→charged 產生投機索引項、再等 orders KEY SHARE;begin 持 orders 等投機項=環)。
  - 觸發前提=同一張單同秒「late-success 對帳收斂」×「客人重試結帳」;後果=PG 1s 偵測、
    **單方 victim** 原子回滾(通用錯誤、fail-closed)、重試即癒;量級 100-300 單/月下罕見。
  - **零新增錢風險的證明(2026-08-04 v3 更正,非「雙方回滾」)**:`payment_charge_attempts_order_lock_idx`
    述詞含 `released` ⇒ genesis 當 victim 回滾後 released 列仍佔鎖索引 ⇒ 倖存 begin 的 arbiter
    必 conflict ⇒ `order_locked`、開不出收款路徑;begin 當 victim=通用錯誤。兩向零新增終態。
- **隱含不變式(R3-N4,2026-08-04 逐支親驗成立、未來會靜默失效)**:「倖存 begin 必 order_locked」
  依賴「所有把列移出 `order_lock_idx` 述詞的轉移(mark_failed pending→failed、close released→failed)
  都先取 orders FOR UPDATE」——家族未來若新增**不鎖 orders 的退出轉移**,A8c1 migration 寫進三支
  COMMENT 的死結面描述會被靜默證偽,零測試翻紅。
- **不修未來會痛在哪:**
  - 每新增一支「orders-先」持鎖者(A8c2/A8a1/A8a2 都是)或 attempt 側新的投機索引寫入路徑,
    環的組合面就**再長一格**,而每格都要靠人記得跑一次死結分析——漏掉的那格不會在測試綠燈裡現形,
    只會在正式站深夜以 40P01 出現在結帳路徑。
  - 已知死結面存在期間,r1c3/mark_failed/r1b1c 的「無死結」舊字面已由 A8c1 migration 更正 COMMENT;
    但**新加入者沒有機制強制宣告自己的鎖序**,不變式只剩文件約定。
- **修法(排程時)**:`mark_charge_attempt_failed` / `mark_charge_attempt_charged` / `close_released_attempt`
  三支同批翻「orders FOR UPDATE 第一動作」(只翻一支會在家族內開新反向環——2026-08-04 分析);
  各附回歸格 + 鐵則 12① 對抗審查;A8c1 的 L3/L4 格屆時翻 oracle(零 40P01)。
- **出處:** A8c1 plan §3.7/§3.8(`docs/specs/2026-08-04-e10-a8c1-begin-cancel-guard-plan.md`)、
  信箱 A-09-Q/A-09-A、codex 關卡1 R1 MF4/MF5 + 主對話實測裁決。
### #323. 🏷️ 子分類篩選膠囊改雙顆(主分類+子分類)— Sean 2026-08-05 拍板 Q8=A

- **現況**:選子分類(側欄點「輪圈」、或 KINEO 品牌頁 chip)後,商品頁上方只出一顆「輪圈 ×」;
  Sean 預期兩顆「懸吊與車架 ×」「輪圈 ×」。
- **拍板語意(Q8=A)**:點掉子分類顆 → 退回大類篩選(顯示大類全量,例:懸吊與車架 202 件);
  點掉大類顆 → 兩顆一起消失、篩選全清。
- **範圍**:`/products` 篩選膠囊共用顯示邏輯(`products-url-state` 族 + 膠囊渲染元件);
  通用行為、不只 KINEO 入口。
- **排程**:併入首頁線 ③A-engine(新視窗 C)早期一片 —— 同一族檔案,分開做會重讀兩次脈絡。
- **不修會痛在哪**:客人點掉唯一膠囊=整個分類脈絡消失,想「退一層看大類」做不到,
  只能重新從側欄找;且膠囊字面「輪圈」缺大類脈絡,多個大類下有同名子分類時會歧義。

### #324. 🔀 「清車+清分類」同一波會產生兩發 router.replace,先發的把剛清掉的軸寫回去(會自癒)

- **狀態:** ⏳ 待執行(A7 發現、**非 A7 引入**)
- **分流:** 🏁 Sean 2026-08-05 拍 Q9=B:排本 backlog、首頁線做完再修(缺陷已降級=自癒/終態正確)
- **優先級:** 🟡 客人看得到一次錯誤結果閃爍 + 多一次 RSC 往返;**會自癒、終態正確、零資料風險**
  (2026-08-05 真瀏覽器實測後由 🟠 降級 —— 原先誤以為終態就是錯的)
- **問題:**
  - `ProductsPage.tsx` 依序掛 `useVehicleUrlSync` 與 `useCatalogFilterUrlSync`;兩支都用
    `new URLSearchParams(window.location.search)` **現讀 URL**、只改寫自己那幾軸、其餘原樣拷貝,
    然後各自 `router.replace`。
  - Next 的 `router.replace` **不同步更新 `window.location`**(走 `startTransition` + app-router
    自己的 effect),所以同一次 flush 裡兩支讀到的是**同一份舊 URL**、後發的整份蓋掉先發的。
  - **實測①(2026-08-05,拋棄式 probe,renderHook 直呼兩支 hook、router 為 spy)**:
    起點 `?vehicle=yamaha&category=排氣系統`,一次把 vehicle 與 category 同時清空 ⇒
    `REPLACE CALLS = [["/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1"], ["/products?vehicle=yamaha"]]`。
  - 🔴 **實測②(同日,真瀏覽器 production build、`agent-browser` 攔 `history.replaceState`)——
    修正實測①推出的終態結論**:同一情境在真站上的寫入序列是
    `["/products?vehicle=yamaha", "/products"]`,**終態 `/products`(乾淨、兩軸都清掉)**。
    ⇒ 壞的那一發**確實會發生**(第一發把剛清掉的 vehicle 寫回來),但**會自癒**、終態正確。
    probe 之所以停在壞值,是因為 `renderHook` 裡 `motoBrands` identity 恆定 ⇒
    `useVehicleUrlSync` 的 effect 不會再跑一輪;真站上 server 回新 props 就補正了。
    **原本本條寫「終態 ?vehicle=yamaha、與 Q3=A 意圖相反」是錯的,已更正。**
    真正的症狀 = 一次多餘的 RSC 往返 + 用舊車輛條件查一次的結果閃過去(客人看得到、但會自己好)。
  - ⚠️ probe 要先讓兩支 hook 的 `initialized` / `pendingRestoreRef` 安定(多 rerender 一輪)才重現;
    只跑兩輪會被 catalog hook 的「還原窗口」early return 吞掉 = harness 假象、不是產品行為。
  - 自癒路徑:server 回新 props → `motoBrands` 換 identity → `useVehicleUrlSync` 再跑一輪把 vehicle 刪掉。
    代價 = 一次用舊條件的錯誤查詢結果閃過去。
- **觸發點(兩處,同一根因)**:`ProductsMobileControls.tsx` 的 `clearVehicleAndCategory`(2026-07-30 起就在)、
  `CascadeFilterTop.tsx` 的「清除車輛」(A7 / Q3=A 之後)。**單獨清一軸不受影響**(只有一發 replace)。
- **不修未來會痛在哪:**
  - 任何「一次動兩軸以上」的新操作都會踩到同一顆,而且**測試看不到**:
    `products-url-state.hooks.test.tsx` 的 router 是純 spy、不動 `window.location`,
    兩支 hook 也從沒被放在同一個 harness 裡一起跑過 —— 這層縫天生在守門之外。
  - 每多一支 URL 同步 hook,「誰最後 replace 誰贏」的組合面就多一格,且沒有任何機制強制宣告寫入軸。
- **修法(排程時,擇一)**:
  - (a) 兩支合併成單一 URL 同步點(所有軸一次算完再一發 replace)—— 根治,但動 `products-url-state.tsx`
    這支有 #287/#288 歷史的高風險檔,要獨立片 + 對抗審查。
  - (b) 共用一個「本波待寫 URL」的 ref 當單一真相,兩支都讀它而非 `window.location.search` —— 較小,
    但仍是雙寫、只是把競態從 URL 搬到 ref。
  - 兩案都必須先補一支「兩支 hook 同 harness」的守門,否則修完沒有東西證明修好了。
  - 🔴 **那支守門的硬前提(R2-I6;不寫進去就是複製一次害本線翻車的同型假象)**:
    守門**必須能觀察到「props identity 換手後的第二輪 effect」**。
    理由=本條的兩次 probe 都用 `renderHook` 直呼兩支 hook,那裡 `motoBrands` identity 恆定
    ⇒ `useVehicleUrlSync` 不會再跑第二輪 ⇒ 停在壞值,於是**兩個獨立來源都推出了錯的終態**
    (真站上 server 回新 props 就補正了,終態其實乾淨)。
    ⇒ 只斷言「第一發 replace 寫了什麼」= 重現 harness 假象,不是產品行為。
    最低要求:①每輪 rerender 要換一個新的 `motoBrands` 參考(模擬 server 回新 props)
    ②斷言對象是**寫入序列 + 終態**兩者,不是單一發 ③修好的判準是「壞的那一發不再出現」,
    而不是「終態是乾淨的」—— 終態現在就已經是乾淨的,拿它當判準會直接假綠。
- **出處:** A7 code-reviewer R1 must-fix(opus, fresh context)+ 主對話獨立 probe 重現(2026-08-05)。
- 🔴 **編號沿革**:本條原開為 #323,與主視窗 `4386624` 的 #323(子分類篩選膠囊雙顆)撞號 ⇒
  依主視窗 C-58-A 指示改為 **#324**。`2ccbadb`(A7)的 commit body 內仍寫 #323、不 amend,
  收割時由主視窗在 STATUS 註記勘誤。之後一律引用 #324。

### #325. 📏 PostgREST `max-rows` 漂移偵測 — 全 repo 內嵌 limit 截斷判定的共同前提

- **狀態:** ⏳ 待執行(A 窗片 2 R3 Fable 明確要求立案;2026-08-05)
- **現況**:所有讀模型的內嵌截斷判定(取 N+1 筆、回傳 ≥N+1 ⇒ truncated)都隱含前提
  「伺服器端 `max-rows` ≥ 我們的常數」。Supabase PostgREST 預設 max-rows 遠大於現用常數,
  但它是 dashboard 可調的伺服器設定 —— 被調低到常數以下時,回傳筆數永遠小於 N+1,
  截斷判定**判不出截斷**(A9g-2 的在途扣款閘會誤回 `'clear'`)。
- **範圍**:非單片問題 —— notes / items / procurement / charge_attempts 每個 embed limit 都一樣;
  單元測試對伺服器設定全盲(mock 層看不到)。
- **候選解**:啟動時或健檢端點對一張已知 >N 列的表做一次真 probe(取 N+1 驗回傳筆數),
  不符即 fail-closed 告警;或把 max-rows 現值納入 read-back/runbook 檢查清單。
- **不修會痛在哪**:一次 dashboard 調整(可能為了別的效能原因)會讓全站「資料不完整」的
  防護靜默失效 —— 員工看到的是「正常、無在途扣款」而不是「讀取不完整」,
  與「把不知道偽裝成正常值」同族,且無任何測試會轉紅。

### #326. 🧰 worktree / 乾淨環境跑 root `pnpm typecheck` 必紅 — root 未宣告 typescript

- **狀態:** ✅ 已修(2026-08-06 主視窗;root `package.json` 宣告 `"typescript": "catalog:"`(=5.9.3),`.bin/tsc` 恢復、`pnpm typecheck` 全綠;codex 對抗審查照 12④ 受審面標記跑訖。E 窗+B 窗同日各撞一次是催修主因;worktree 補救=各自 `pnpm install` 帶入)
- **原現況**:root script `tsc -p tsconfig.scripts.json --noEmit` 依賴 root `node_modules/.bin/tsc`,
  但 root `package.json` 未宣告 typescript;主庫能跑是因為殘留 2026-07-13 的舊 binary。
  worktree `pnpm install --frozen-lockfile` 回「Already up to date」不會補 ⇒ 任何乾淨 install
  環境(含未來 CI)跑 root typecheck 都紅在最後一步。
- **workaround(A 窗片 2 實用中)**:改呼叫 `./packages/adapters/node_modules/.bin/tsc`,
  該步真的有跑、非跳過。
- **正解**:root devDependencies 顯式宣告 typescript(版本對齊各 package)——
  動 package.json+lockfile 屬鐵則 12④ 受審面,需 codex 對抗審查,獨立小片處理。
- **不修會痛在哪**:哪天主庫 node_modules 重建(升 node、清快取、換機),三綠的 typecheck
  一半(scripts 面)直接紅;CI 一接上就會撞;各 worktree 現在就得各自帶 workaround,
  同一步驟三個環境三種跑法=數字對帳的隱形分歧源。

### #327. 🧪 `a7-verify.sh` 突變段既有缺陷 — 所有突變都「紅」在同一個不相關的閘,對照組也紅

- **狀態:** ✅ **已修(2026-08-11 E 窗)** —— 實跑對照,不是宣稱:
  **修前** 13 發突變**全部**「✅」在同一句 `ERROR: 閘 -1 失敗:缺 -v a7_allow_dml`(與突變內容無關)、
  且對照組紅;**修後** 13 發**各自紅在自己那條探針**(`探針 9 失敗:allowlist 外的 reason_code…` /
  `探針 10-12 失敗:other 竟可搭配空…` / `探針 14-16 失敗:非法 payload_hash…` / `探針 25` / `探針 29` …),
  **對照組轉綠**。總計 35/2 → **36/1**(剩下那 1 是另一個病,見下一條)。
  - **根因**:抽取用 `n==2` = **位置**定位,而本檔第 2 個 `DO` 是 DML/cluster 前置閘,行為探針在第 3 個。
    ⇒ 改成**按內容錨定**(抽含「行為驗收全數通過」的那塊),位置再變也抓得對。
  - 🔴 **光改抽取還不夠**:原本 `s2` 把「沒看到成功 NOTICE」一律判成「突變被抓到」——
    那正是「腳本壞了」被當成「守門有效」的機制本身。現在拆三種成因(抽取失敗 / 紅在前置閘 / 探針抓到),
    **只有第三種算綠**;前兩種會出聲。
  - ⚠️ **我自己在這裡量錯過一次**:前置閘偵測第一版寫 `閘 -?[0-9]+ 失敗`(含正號),把
    「拿掉 RF2a-0 trigger」這發**真的被抓到**的突變誤判成 harness 壞掉 —— 因為行為區塊自己的第一道
    是 `閘 0:trigger inventory`,那是正當斷言。窄化成**只認負號閘與 port 閘**才對得上;理由寫在腳本內。
- ~~**原狀態**~~:⏳ 待執行(B 窗 2026-08-05 `PORT=54376` 複驗時露出;**非 PORT 修法造成**)
- **現況(修前)**:`scripts/a7-verify.sh:106-108` 的突變路徑抽出第 2 個 `DO` 區塊(**正好是 DML 閘**)
  並且**不傳** `-v a7_allow_dml=yes-throwaway-db` / `-v a7_expect_cluster`;而乾淨對照跑(`:110`)有傳
  ⇒ 每一條突變都紅在「閘 -1 失敗:缺 -v a7_allow_dml」,**而且對照組也紅**。
  ⇒ **整個突變段目前證明不了任何事**:所有突變「被偵測到」的理由都不是它們被偵測到。
- **歸因(B 窗先假設是 PORT 修法造成、再自己證偽)**:`ed00be7` 對該檔 diff 只有兩行(port 比較式),
  前後 `DO` 區塊數皆為 4 ⇒ 假設證偽。真因是既有的參數傳遞不對稱;PORT 修法只是把它從
  「死在 port 閘」推進到「死在 DML 閘」,**讓既有缺陷露出來**。
- ~~**修法**:突變路徑補傳與對照組相同的 `-v` 參數~~ ⚠️ **這個修法方向是錯的**(2026-08-11 實作時證偽):
  補 `-v` 只會讓突變**繼續跑那個前置閘**、只是這次通過而已 —— 行為探針**仍然一次都沒跑到**。
  真正要換的是**抽錯區塊**。原條目「修完要證明突變真的紅在它該紅的斷言」那句要求是對的,已照做。
- **不修會痛在哪**:A7 那批的突變證據**現在是空的** —— 未來任何人引用「a7 突變 N 組全紅」
  當作守門有判別力的依據都會是假的;而對照組同時紅,正是它自己在喊「harness 壞了」。

### #400. ✅ 作廢(號不回收)—— #352-b-2 N1 的守門缺口在落地前就消滅了

- **狀態:** ✅ 作廢。立案當下的前提(「V1 突變全綠 ⇒ 沒有負測」)**是錯的**:
  我的突變腳本錨點命中了另一支 deps 長得一樣的 effect,`remaining` 從沒被加進要突變的那個 effect。
  用行號錨點正確套上後 ⇒ `shipment-launcher.test.tsx` **2 格紅**(`expected 3 to be less than or equal to 2`)
  ⇒ 守門本來就有判別力。經緯見該檔 `describe('OrderShipButton — 成功只被處理一次(N1 守門)')` 檔頭與 commit body。
- **號不回收**:留著防撞號(信箱與 STATUS 已引用過 #400)。

### #394. 🧪 `a7-verify.sh` 的 A7-1 結構驗收恆紅 —— `reapply()` 的 DROP 沒 CASCADE、且錯誤被吞

- **狀態:** ⏳ 待執行(2026-08-11 E 窗修 #327 時**在乾淨環境重現**;**與 #327 無關、修 #327 前後都紅**)
- **現況**:`scripts/a7-verify.sh` 的 `reapply()` 先
  `DROP TABLE IF EXISTS public.order_cancellation_items; DROP TABLE IF EXISTS public.order_cancellations;`
  再重套 migration,**沒有 CASCADE**、而且整行的錯誤被 `>/dev/null 2>&1` **吞掉**
  ⇒ `20260731120000_m4b_e10_a7b_m_refund_jobs.sql:181` 的 FK 參照 `public.order_cancellations`
  讓 DROP 失敗、被吞,接著重套時撞
  `ERROR: relation "order_cancellations" already exists`(migration `:177`)。
- **證據**:全新 workdir + 全新 port(`PORT=54333 bash scripts/a7-verify.sh all /tmp/a7v-e2`)**單跑一次即重現**。
- 🔴 **修法不要順手加 CASCADE**:那會把 refund_jobs 那條 FK 一起無聲拆掉,**改變後面 36 道檢查的意思**。
  正解是按依賴序 drop、或整庫重建;要想清楚再動,屬另一片。
- **不修會痛在哪**:harness 現在 **exit 1**,跑完看到紅的人會連帶不信任剛修好的突變段;
  而它紅的原因與 A7 的正確性無關 —— 訊號被雜訊淹掉,正是 #327 那一族的孿生病。
- **編號註**:E 窗不自行發號(主視窗維護發號帳),先掛 `#N`;發號後把標題與本行一起改掉。
- **🔗 共同根因**:見 **#401** 族譜條目(重放式 harness vs 非冪等 migration);本條是該族**最早立案**、
  且是三支裡**診斷權威**的一支(#401 的 a7 段整段指回這裡,不重述)。同族另有 #396(op1p)、#399(a7t)。

### #328. 🕳️ A9a-1 notes 投影 `?? []` fail-open — 投影退版時畫面會說「時間軸完整、未告知客人」

- **狀態:** ✅ **已修(2026-08-11 E 窗)** —— `?? []` 拿掉,mapper 收 `null | undefined` 並回
  `customerNotified: null`(無法判定);畫面另闢「讀取失敗」橫幅。**仍待 Sean 肉眼驗**(要構造投影退版才看得到,見下)。
  - 🔴 **不新增欄位**:`customerNotified === null && notesTruncated === false` 已經是「讀取失敗」的
    **唯一簽章**(截斷那條路 `notesTruncated` 必為 true)⇒ 判別式具名一次
    (`apps/admin/src/lib/orders/note-timeline.ts` 的 `isNotesUnreadable`),不散在各處重寫。
  - **文案跟著分兩種**(文案與程式是同一條不變式):舊的 `unknown` 只寫「備註筆數超過載入上限」——
    那句在「整段沒讀到」時是**假的**,還會把員工引去找不存在的舊紀錄、而不是叫他重新整理。
  - **畫面三處**都改了,因為三處各自會說謊:徽章文案 / 空清單改成紅底「讀取失敗」橫幅 /
    右上角筆數 **`0 筆` → `筆數未知`**(那是這條 bug 最短的一句謊話)。
  - **守門 + 突變四靶,全部有判別力**(🔴 **紅數為 R1 更正後的實測值**,見下):
    ①`?? []` 加回去 ⇒ **2 格**(`order.test.ts` 的中間那一跳 + `SupabaseOrderAdapter.test.ts` 的
    jsonb 腐壞那格;而 mapper 與畫面**各自的**測試在這個突變下**照樣全綠** —— 那正是本條當初能存活的原因)
    ②mapper 對 null 回 false ⇒ **4 格** ③判別式只看 `customerNotified === null` ⇒ 截斷被誤報成讀取失敗
    ④畫面拿掉分支 ⇒ 只紅畫面那格。
  - ⚠️ **R1 審查抓到我把①②的紅數低報**(原寫 1 格 / 3 格)。**方向是守得比宣稱多,但字面錯就是錯**;
    病因是**我跑突變時餵的測試檔清單比我宣稱的範圍窄**(漏了 `SupabaseOrderAdapter.test.ts`)——
    量測範圍 ≠ 宣稱範圍,同族於本人提案裡的「全稱句範圍錯」。已親跑複量、上面的數字是複量值。
  - 📌 **留給未來的一條**(R1 觀察):全樹目前**沒有任何寫入決策**讀 `customerNotified`。
    若日後出現「未告知才准取消 / 才寄信」這類閘,**`unreadable` 必須一併擋** ——
    否則讀取失敗會被那個閘當成「沒告知過」而放行,傷害比顯示錯字更大。
  - 🔴 **順手修掉一格「把 bug 寫成規格」的測試**:`SupabaseOrderAdapter.test.ts` 原本
    逐字寫 `order_notes: undefined` 且斷言 `customerNotified === false`、註解還寫「→ 空時間軸」
    ⇒ 它**在替這個 fail-open 站崗**。已改成斷言 `null` 並把理由寫在格內。
- ~~**原狀態**~~:⏳ 待執行(A 窗片 3 R3 審查發現既有問題;2026-08-05 主視窗立案)
- **現況(修前)**:`packages/adapters/src/supabase/mappers/order.ts:609` 的 `row.order_notes ?? []`
  把「select 投影缺鍵(根本沒讀到)」翻成「讀到了、真的零筆」⇒
  `mapSupabaseOrderNoteRowsToProjection([])` 回 `notesTruncated=false`、`customerNotified=false`(實測)。
  同函式下一行的 cancellations **刻意不加** `?? []`(缺鍵→`null`=「沒讀到」),兩行語意不一致;
  `:612-617` 註解已如實記載本條(R3 抓到原註解宣稱安全的理由是假的)。
- **修法**:notes 改走 cancellations 同款 fail-closed(缺鍵→`null`,UI 顯示「讀取失敗」而非空時間軸);
  要自己一片 + 自己的審查(A9g-3 明文不順手改),動 mapper 需同步 U6 告知義務的消費點與測試。
- **不修會痛在哪**:`ADMIN_ORDER_DETAIL_SELECT` 哪天退版漏掉 `order_notes` 內嵌 —— 無測試轉紅、
  無畫面錯誤,員工看到的是「時間軸完整、未告知客人」,U6 告知義務判斷建立在假資料上
  (該補告知的不會補)。與 memory「守門絕不可讀惰性衍生快取」的 fail-open 同族。

### #329. 🕳️ 洩漏守門「受守表清單」是手維護的 meta 閘 — 新 service-role-only 表忘登記不會紅

- **狀態:** ⏳ 待執行(主視窗 R3 指出真實失效路徑=B2 新表忘登記;2026-08-05 立案)
- **現況**:`scripts/storefront-projection-leak-guard.test.ts:46` 的 `SERVICE_ROLE_ONLY_TABLES`
  六張表為手工列舉。守門只證「清單內的表沒出現在 storefront 原始碼」,**不證「清單=全部
  service-role-only 表」**。最近的真實案例:B2 出貨線三支 migration(shipments / shipment_items,
  含 `hct_request_id`/`hct_raw_response` 送單證據)apply 後若忘登記,守門對它們全盲且全綠。
- **候選解**:補 meta 閘 —— 掃 `supabase/migrations/` 的「RLS enable + 零 policy + 只授 service_role」
  pattern 產出應守清單,與 `SERVICE_ROLE_ONLY_TABLES` 比對,缺一張紅一張。文字層掃描有已知洞族
  (memory `feedback_text-level-guard-blind-to-invalid-syntax`),可接受 —— 它只是 meta 閘,
  主守門(字面掃描 + runtime 42501 + eslint `/server` 邊界)仍在。
- **不修會痛在哪**:下一張內部表上線時「有沒有被守」取決於施工者記不記得登記;忘了=該表
  對 storefront 洩漏**零防護且零訊號**,而清單的存在反而給所有人「已有守門」的假安心。

### #330. 🎲 `note-compose-form.test.tsx` [5] confirm 閘非決定性紅 — C-204-STOP §五那條「無法指認的 1 紅」已捕捉到名字

- **狀態:** ⏳ 待執行(2026-08-05 主視窗收割 D 0a 時全套首跑 1 紅捕獲;單檔 3 次綠、全套重跑綠)
- **簽名(完整 log 在收割留檔)**:`apps/admin/src/components/orders/note-compose-form.test.tsx:118`
  `confirmSpy.mock.calls.length` 得 3 期望 2,而 `:117` `actionMock` 恰 2 次先通過
  ⇒ 第三發 submit(rerender 成非更正模式後)走了**更正模式的舊 handler**(confirm 被多問一次、
  回 true 後 action 照發)——兩個計數合起來只有這一種走法。
- ~~**假說(未證實)**~~ 🔴 **2026-08-11 E 窗:這個假說被兩次構造證偽,不要再從它開始。**
  原假說=「第二發 submit 的 form action 仍 in-flight 時 `rerender()`,props 提交與第三發 submit
  的先後翻轉」。**構造重現失敗兩次**:把第二發的 `actionMock` 換成延遲 resolve
  (`mockImplementationOnce` + `setTimeout` **25ms** 一次、**200ms** 一次;後者連跑 6 遍)
  ⇒ `rerender()` 發生時 action **確實仍在飛**,而 **11 格全綠、一次都沒紅**。
  ⇒ **「action 仍 in-flight」不是充分條件**;真因還需要別的東西(疑似真正的執行緒競爭影響 React
  scheduler 的 commit 時機,而不是 promise 的 pending 狀態本身)。
  另:本日全套跑了約 6 次(含刻意在機器忙碌時跑),**這格一次都沒紅** ⇒ 頻率很低,不適合用重跑碰運氣。
- 🔴 **刻意不套「第三發前先等 transition 安定」那個硬化**(E 窗判斷,請覆核):在**根因未證**的情況下
  硬化只會讓它更罕見、看起來像修好了 —— 那正是 memory `feedback_fix-that-moves-gate-earlier-erases-evidence`
  的形狀:原本「怎麼知道它壞」的那條觀測會消失。要動它之前先把根因釘住。
- **下一步建議**(給接手的人,別重跑上面兩個已證偽的構造):
  ①在 CI/滿載下對**單檔**跑數十輪(`--repeat`/迴圈)並保留完整 log,先把頻率量出來;
  ②若能重現,在第三發 submit 前後印 React commit 順序(或改用 `act()` 包住 rerender 對照),
  分辨「props 沒 commit」與「舊 handler 仍綁在 form 上」兩種走法 —— 目前的簽名兩者都相容。
- **不修會痛在哪**:全套「N 綠」是收割對帳的唯一依據(同族=`WalletTab` 缺 `afterEach(cleanup)`,
  `ec4d629` 已修);這條每隔幾輪隨機紅一次,每次都要人工重跑判定「flaky 還是真壞」,
  且它蓋掉的可能是同檔真回歸。C-204-STOP §五那筆懸案到此指認、不再是幽靈。

- 🔴 **2026-08-11 E 窗偵察結論:本條不適合直接開工,要先出 plan**(理由與已收斂的修法方向如下)。
  - **修法收斂到一句**:`parseBrandFiltersFromUrl`(`components/products-url-state.tsx:92-104`)
    把不在對照表裡的 slug **濾掉**,而 `useCatalogFilterUrlSync` 的寫回是以 **state** 為準
    ⇒ 那個值在第二次往返被寫沒了。**網址是使用者的意圖,不該被靜默改掉** ——
    正解方向 = 寫回時**保留** URL 上認不得的值(讓它自然變成 0 筆 + 空狀態,
    與「單獨帶未知 category」時**看得見**的行為一致),而不是新增一個提示元件。
  - **為什麼要 plan 不直接做**:那支檔 **479 行、四支互相咬合的 hook**(它同時是 #341),
    寫回路徑上有一條逐字寫著的安全前提「`params` 只改寫 pbrand/category/price/pmin/pmax 五軸,
    **不得在該行之前新增任何 `params.set/delete`**」(`:295-300`),而「保留未知值」正好要碰那裡;
    旁邊還壓著 #287 的 Next segment-key 碰撞、#289 的深連結還原波、Q28① 的 vehicle 讓路守衛。
    ⇒ 改這裡是**跨三條既有 race 修法的因果推理**(R1 升級判準命中),不是一行。
  - **建議排序**:與 #341(拆那四支 hook)一起排,或至少在 #341 之後 —— 在 479 行的糾纏裡動寫回路徑,
    回歸風險大於本條的傷害;而本條今天的實害面已由 D3c-4 的拍板把「設計側不匹配」清掉。

### #331. 📐 四處 sticky 側欄仍寫死「隱含頁首高」的 top 值 — 下次調頁首高會再漂

- **狀態:** 🔶 **四處修了三處(2026-08-11 / E 窗;主視窗裁 Q3=A 獨立成片)。第四處 `.co-aside`
  查出前提不同、退出本片 ⇒ 轉 `#408`,本條不因此關閉。**
  - **修法(三處)**:`top` 改吃 `calc(var(--shell-header-h) + <該處呼吸空間>)` ——
    `.acc-nav` / `.cart-summary` = +27px(原 100 = 73+27);`.pd-info` = +23px(原 96 = 73+23)。
  - **零視覺變化,而且是可論證的**:這三道 sticky **只在 ≥1080 生效**(≤1079 轉 `position: static`;
    `.acc-nav` 與 `.cart-summary` 還各有 `@media` 與 `[data-mobile="true"]` 兩路)⇒ 那裡 token 恆為 73px
    ⇒ 替換前後逐值相等。換掉的是「以後會不會跟著動」,不是現在長什麼樣。
  - 🔴🔴 **`.co-aside`(checkout)為什麼退出**(R1 抓到;**本條最該被下一個人讀到的一段**):
    它轉 static 的斷點是 **≤900**,不是其他三處的 ≤1079(`checkout.css` 的
    `@media (max-width: 900px)`;design 原稿同值)⇒ **901-1079 這段它仍然 sticky**,
    而 `--shell-header-h` 在 ≤1079 早已是 60px ⇒ 換成 `+23px` 會讓它 96 → 83、**位移 13px**。
    ⇒「逐值等價」對它**是假的**,那 13px 該不該動是**視覺題**,不在收斂 token 的片裡沉默決定。
    ⚠️ 我原本的前提斷言**看不見這個維度**:它只找「檔案裡有沒有一條 `.co-aside` static」,
    沒綁那條 static 住在哪個媒體查詢裡;而我當時打的靶拿掉的正是 ≤900 那條 ⇒ **靶紅了、
    證明的卻是別的事**。教訓逐字:**查斷點寫在哪 ≠ 查斷點是多少**(#333 家族第三型)。
    ⇒ 現在前提斷言一律綁 `(max-width: 1079px)` 字面,斷點本身成為被斷言的一部分。
    ⇒ 另配**回歸鎖**:`.co-aside` 若被「順手補齊」成吃 token、或斷點被改掉,兩條斷言各自會紅
      (兩靶實跑證過),逼下一個人先撞紅一次再想。
  - 🔴 **為什麼 0b 的守門沒抓到它們(本片真正的收穫)**:`shell-detail.test.ts` 的 `CONSUMERS` 那條
    禁的是 `69/73/64/65` —— **頁首高本身**被寫成字面。但這四處寫的是 `100`/`96`,是
    「頁首高 **+ 自己的呼吸空間**」的**合成值**,裡面沒有任何一個被禁的數字 ⇒ 那條守門對它們
    **恆綠、零判別力**,而它們壞掉的方式與被守住的五支一模一樣。
    ⇒ 守門畫在「哪個數字不准出現」上,只擋得住把常數**直接**寫出來那一種;
      把常數**算進另一個數字裡**是同一個病的變形,要靠「這個位置必須吃 token」才擋得住。
  - **守門**:`shell-detail.test.ts` 新增 `#331` describe —— 三格「該選擇器那條 `position:sticky`
    規則的 `top` 必須是 `calc(var(--shell-header-h) + Npx)`」+ 前提①「在 `@media ≤1079` 轉 static」
    三格 + 前提②「`[data-mobile="true"]` 兜底那路也轉 static」兩格 + checkout 回歸鎖兩格
    (維持 96px / 斷點仍在 ≤900)。地基垮了要重挑呼吸空間,不是讓斷言繼續假裝守著同一件事。
    **共 10 個突變靶逐一實跑、每靶只紅它那格**:三支檔各自改回寫死(3)、`.acc-nav` 與
    `.cart-summary` 的**兩條 static 路各拆開單獨拿掉**(4)、`.pd-info` 唯一那路(1)、
    checkout 兩條鎖(2)。
    ⚠️ 「兩條路各自證紅」是補上來的:第一版只驗其中一條,**另一條被刪掉時那格照樣綠** ——
    存在性斷言對「還在但失效」全盲,這次是我自己的守門中招。
    ⚠️ 斷言鎖在「宣告了 `position: sticky` 的那一條規則」,不是該選擇器的第一個 `{...}` ——
    初稿寫成後者,當場被 `product-page.css` 媒體查詢段的 `.pd-info { align-self: stretch; }` 打紅。
  - ⚠️ 原條目寫的四個行號(`:84`/`:166`/`:475`/`:262`)**全部已過期**,實際在
    `account.css:100`/`cart.css:170`/`checkout.css:547`/`product-page.css:277`(修前值)。
  - 🔴 **程序偏離(誠實記錄)**:本片跨 **6 檔**(四支 CSS + `shell-detail.test.ts` + 本檔)
    = 命中鐵則 8「跨 3+ 檔」,**動手前沒提 plan**。⚠️ 我第一版在這裡寫「5 檔」——
    **少算了 backlog 自己**,而少算的那一檔正好把數字壓在判準的邊界感上,R2 抓到。
    主視窗裁 Q3=A 是範圍裁示、不等於 plan 批准,兩邊都沒攔住;R1 裁定段補位當 plan。
    ⇒ 而這次 plan 本來就會攔下 checkout —— plan 要寫「預期影響面」,寫的時候就得逐處查斷點。
- ~~**狀態:** ⏳ 待執行(0b 確認輪 R2 點名;2026-08-05 立案)~~
- **現況(立案時)**:0b 已把五支 CSS 的頁首偏移收斂進 `--shell-header-h`,但 `account.css:84`、
  `cart.css:166`(`top:100px`)、`checkout.css:475`、`product-page.css:262`(`top:96px`)四處
  sticky 側欄的 top 值隱含依賴頁首高、仍寫死。現值均 >73 故 0b 的 44px 連動**無重疊迴歸**。
- **修法**:改吃 `calc(var(--shell-header-h) + <呼吸空間>)`;動哪頁順手併該頁的重設計批次即可,
  不必獨立成片。
- **不修會痛在哪**:與 0b 修掉的那五支同病:下次任何人動頁首高(logo 換尺寸、padding 調整),
  三綠+全套測試對「側欄被頁首蓋住幾 px」全盲,只有真瀏覽器看得到——0b 這次就是這樣撞出來的。

### #332. 🧹 九碼退場殘餘死碼收尾片 — 三筆「無主」死碼集中收,走 plan

- **狀態:** ✅ 三筆全清(#332-1 純刪死碼;#332-2 兩支 banner 硬化 + 死詞彙清除,Sean 2026-08-06 拍 plan §6 Q1=A / Q2=A)。plan=`docs/specs/2026-08-06-result-banner-cleanup-plan.md`(2026-08-06 落檔;E 裁定三筆均不依賴 A9w4a/c,~~A11 全鏈完成後排~~ 敘事序非依賴序)
- **內容(三筆,拆 #332-1/#332-2 兩片)**:
  ① ✅ **已清(`85f12c1`,dev `e635bf5`)**:`WORKFLOW_STATUS_CODE_RE` export 與過期註解純刪 14 行,
  Δ 對帳 0/0、全樹 grep 剩 2 處歷史敘事註解(=plan M2 預期字面)。~~合併它與 `workflow-form.ts` 的同字面
  local RE 一併評~~ → plan §2.3 裁定**不合併**(三份 RE 對齊三個不同 DB 契約,且 `workflow-form.ts:29` 已排定隨 A9w4c 後半整檔刪除)。
  ② ✅ **已清(#332-2)**:`settings-result-banner.tsx` 的預設 `MESSAGES`(order-statuses CRUD 詞彙)
  ——A9w2 刪掉唯一吃預設值的頁面後成死碼;整份刪除,`messages` 依 Sean 2026-08-06 拍板 **Q2=A**
  轉必填(漏帶=編譯期報錯,不再靜默套一份沒人維護的詞彙)。
  ③ ✅ **已清(#332-2)**:兩支 result-banner 的 `Object.hasOwn` 修法
  (memory `reference_js-index-lookup-hits-prototype-chain`)——Sean 2026-08-02 拍板 B 逐字
  「要再修的話,兩支元件要一起、並且走 plan」,2026-08-06 拍板 **Q1=A** 依該 plan 兩支一起修;
  五個原型鏈向量逐字入測,兩支各自釘在自己的元件層測試檔。
- **當初不修會痛在哪(留存)**:死詞彙是「看起來有守門」的假安心(下個人以為預設文案有人維護);
  `__proto__` 族查詢參數在 **6 個**頁面畫得出空 banner 框(A9w2 前為 7 個;08-02 事故當下記為 5 個,
  之後 RW4 退款異常清單 +1、S3b 供應商頁 +1);零 consumer export 誘導未來誤用。

### #333. 📐 TabBar 讓位 padding 與「藏 TabBar」不同步 — 藏的頁面底部留 70px 死空間

- **狀態:** ⏳ 待重新設計(2026-08-06 D 批2 R1 點名;**2026-08-11 S 窗實作後撤回 —— 原病灶描述是錯的**)
- 🔴🔴 **2026-08-11 病灶更正(S 窗實作 → code-reviewer FAIL → 逐檔親驗 → `git checkout --` 撤回、零 commit)**:
  - **`/products/[slug]` 那 70px 在主帶上不是死空間,是承重牆。**
    `ProductPage.tsx` 的 `<HomeFooter />` 在 `</main>` **之後**,`.pd-mobile-buybar` 又在它之後、
    `position: fixed; bottom: 0; z-index: 50`;而 `product-page.css` 的
    `@media (max-width: 1079px) { .pd-mobile-buybar { display: flex } }`
    **與 body 那條讓位 padding 是同一個斷點**。
    ⇒ 頁尾下方唯一的讓位就是那 70px,歸零 = **商品頁頁尾被購買列永久蓋住**。
  - **真正有死空間的只有一個窄帶**:手機 UA(`html[data-mobile="true"]`,該條沒有 media query)
    + viewport ≥1080px(此時 buybar 是 `display:none`)—— 例如 Android 平板橫放。
  - **另有一個容易被忽略的競爭者**:`checkout.css` 的 `body:has(.co-mobile-buybar)` =
    `calc(80px + safe-area)`,權重與「掛在 `.mobile-tabbar.is-hidden` 上的歸零規則」**兩層都相等**,
    而 `app/layout.tsx` 先 import checkout.css、後 import mobile-tabbar.css ⇒ **平手後載勝、會把它歸零**。
    那 80px 的註解逐字寫著是「R2 用真瀏覽器 fixture 量出來的」,不可覆蓋。
- **修法(原 D 批2 R1 建議已作廢)**:~~藏 TabBar 時標旗標、讓位 padding 吃同一個條件~~
  —— 那個修法會同時打掉上面兩條承重。若仍要修,**條件必須是「這一頁有沒有自己的 fixed 底欄」
  而不是「TabBar 藏了沒」**,並且只針對那個窄帶;範圍與收益都遠小於原條目的想像,值不值得做請先拍。
- 🔴 **給下一個接手的人的檢查步驟**(這輪的教訓:查「這條規則是什麼」≠ 查「拿掉它誰會死」):
  動任何 `body { padding-bottom }` 之前,先把**三條 hidden 路徑逐頁列出**
  「這一頁底部有沒有 fixed 元素、它的讓位是誰在出」,再列全所有競爭選擇器(含別的 CSS 檔)。
  這兩件事都是純文字層查得到的,**不需要真瀏覽器** —— 上一輪就是漏了這兩件,而不是漏了量測。
- **不修會痛在哪**:每新增一個藏 TabBar 的頁面就重演一次「底部神祕空白」,深色頁直接露白條,
  三綠與單元測試全盲、只有真瀏覽器看得到。

### #334. 🎲 全套「檔紅、零測試紅」非決定性 1 紅 — **其中一個成因已找到並修掉(2026-08-11)**;CheckoutView 那條仍開著

- **狀態:** 🔧 **部分收斂**(2026-08-06 立案;2026-08-11 E 窗四代找到並修掉**一個可重現的成因**,
  但**不是全部** —— 見下方「涵蓋範圍」)。
- 🔴 **已確認並修掉的成因:兩支 browser harness 的 `afterAll` 沒有 timeout。**
  - `cancel-forms-browser.test.tsx` 與 `cancel-forms-hydrated.test.tsx` 兩支都是
    `beforeAll(async () => { browser = await chromium.launch(); }, 120_000)` **給了 120 秒**,
    而 `afterAll(async () => { await browser?.close(); })` **沒給** ⇒ 吃 vitest 預設的 **10 秒**。
  - 機器一忙,關 chromium 超過 10 秒就 file-level FAIL,而**測試本身全過**。
  - ✅ **構造重現(不是推論)**:在 `afterAll` 內插一段 11 秒延遲 —— 沒有 timeout 那版吐
    **`Test Files 1 failed` + `Tests 7 passed`**(**逐字就是 S 窗記下的那個簽名**);
    補上 `, 120_000` 那版 pass。修法 = 兩支各補一個參數。
  - 📋 E 窗四代 2026-08-11 全套跑**兩次**撞到,兩次不同檔、同一個病
    (`cancel-forms-browser` 一次、`cancel-forms-hydrated` 一次;後者 5 格全過、耗時 13045ms 後倒在收尾)。
- ⚠️ **涵蓋範圍(刻意不宣稱修完 #334)**:
  - **2026-08-06 E 窗那次目擊指認的是 `apps/storefront/src/components/CheckoutView.test.tsx`**,
    而該檔**沒有 chromium、沒有 `afterAll`**(實查:只有一個同步的 `beforeAll`)
    ⇒ **上面這個成因解釋不了它**,`#330` 那條「多次 submit / 非同步 race」的候選**不撤**。
  - S 窗 2026-08-11 那次**沒抓到檔名**,只留下簽名 ⇒ 無法歸給任何一邊;它的簽名與本成因一致,
    但簽名一致不等於同因(本條現在證明了**至少有兩種東西**會產生同一個簽名)。
  - D 窗 2026-08-06 那次同樣沒抓到檔名。
- 🔴 **給下一個目擊者的判別順序(改自原本的「先看 Tests 那行」)**:
  1. 先看 `Tests` 那行有沒有 failed。**有** ⇒ 是真的測試紅,照一般回歸查。
  2. **沒有**(檔紅、零測試紅)⇒ 先看失敗檔**是不是 browser harness**(`grep chromium.launch`)。
     是 ⇒ 先確認它的 `beforeAll`/`afterAll` timeout 是否對稱(本條已把已知兩支修掉)。
     不是 ⇒ 才往 collect / unhandled rejection / race 方向查,並**務必留下檔名**。
- 🔴 **機制修法(比「請下一個人記得」可靠)**:跑全套一律先落檔再過濾 ——
  `npx vitest run > /tmp/vitest-full.log 2>&1; echo "exit=$?"` 然後 grep 那個檔,
  **不要直接 `npx vitest run | grep ...`**:一濾就把唯一一次的證據丟掉,而 flake 依定義不會有第二次。
  (四次目擊有三次因為這個原因沒留下檔名。)
- **不修會痛在哪**:非決定性紅會讓「全套 N 綠」失去收割對帳的意義——每次紅都要人工判斷 flake 還是真回歸,判斷疲勞後遲早把真紅當 flake 放行。

### #335. 🧬 auth-error.ts 原型鏈查表 — 全 repo 最後一筆同型命中(當前不可觀察)

- **狀態:** ⏳ 待執行(2026-08-06 E 線 packages 盤點發現;併進下一個動 `packages/adapters/supabase/` 的片、不單開)
- **現況**:`packages/adapters/src/supabase/mappers/auth-error.ts:35` `SUPABASE_CODE_MAP[error.code] ?? 'unknown'`——`??` 只擋 null/undefined,擋不住 `__proto__` 等原型鏈 truthy 值。**今天不可觀察**:兩個消費端(`login/actions.ts:65`、`register/actions.ts:68`)走 `authErrorCopy` 的 `switch`+`default`,非預期 code 一律落 default。盤點全文=`docs/reviews/2026-08-06-packages-index-lookup-audit.md`(201 檔母數、含四類未掃形狀)。
- **修法**:照 repo 唯一主動防禦範本 `ResendEmailSenderAdapter.ts:110-117`(ReadonlyMap+六鍵負測)。
- **不修會痛在哪**:型別謊言+陷阱——哪天有人把消費端 switch 改成查表就現形;修一行加一測,順手片成本。

### #336. 📧 M-4a E4「order_shipped」通知觸發點隨 A9w4a 拆除 — 重啟時需重定觸發設計

- **狀態:** ⏳ 待執行(2026-08-06 A9w4a code-reviewer 抓到活的下游依賴;M-4a 通知線=暫緩非作廢)
- **現況**:`2026-07-16-m4a-email-notify-plan.md:257/:363` 的 E4 觸發點逐字掛在 `updateOrderItemWorkflowAction`——該 action 已於 A9w4a(`01478a2`)拆除;plan 兩處已補紅字。殘留的 `admin_update_order_item_workflow` RPC 與 port 方法都在退場鏈上(A9w4c 後半/A9v),**不宜改掛**。
- **修法方向**:E4 開工時重定觸發點——候選=出貨線 B2 的 `shipped_at` 寫入路徑(S2 之後才存在);與 #334 無關。
- **不修會痛在哪**:通知線解凍時照舊 plan 施工會掛到不存在的 action 上,或更糟——把觸發器掛回正在退場的 RPC,擋住 A9v。

### #337. 🧪 首頁分類區「進榜分類缺 icon」E2E 轉紅 — 需真資料環境

- **狀態:** ⏳ 待執行(2026-08-06 H3 補片立案;D worktree 無 DB 做不了)
- **現況**:單元測試對「真目錄前 11 名都有 icon」結構上恆真(categories 是 fixture 餵的)⇒ 刻意不掛;現行防線=執行期告警(上榜查無 icon 即 server log 含分類名+件數,自身有正反測+3 突變紅)。告警擋不住:首頁快取非即時/沒人看 log 等於沒叫/不分新分類與改名。
- **修法方向**:接真 DB 的 E2E(對 production build 抓 server log 或渲染斷言);與 #288(E2E 基建)同族可併評。
- **不修會痛在哪**:分類改名或新分類竄榜時,首頁那一格靜默變純文字 chip,只有翻 log 才知道。

### #338. 🔎 供應商單號搜尋沒有供應商 filter 軸 — 結果可能混入另一家供應商的訂單(#338 已讓畫面說出是哪幾家)

- **狀態:** ✅ **已修(2026-08-11 E 窗,做 ① 不做 ②;主視窗裁定)**。
  - 🔴🔴 **要驗之前必須先開 flag,否則「什麼都沒變」**(R2 must-fix 2):整條供應商單號搜尋掛在
    `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH === '1'`(`apps/admin/src/app/orders/page.tsx:77`),
    **未設 = 關**,而關著的時候連搜尋框都不吃這個參數 ⇒ 照本條字面去點會以為沒做。
    ⇒ **開法**:Vercel(或本機 `.env.local`)設 `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH=1` 後重新部署/重啟。
    **本條的「待 Sean 肉眼驗」以開 flag 為前提**;flag 要不要在正式站常開,是另一個決定、不在本片。
  - **② 為什麼不做(裁定理由,不另立案)**:員工的實境是「供應商寄來一張單號、他回後台找單」——
    **他正是因為不知道是哪一家才來搜**。② 的供應商下拉要他先選一家,在真正會出事的那一刻幫不上忙;
    ① 是把答案直接顯示出來。日後真出現「我要看 A 家全部的單」那個**別的**用途時再做。
  - 🔴 **條目原本把 ① 的成本估高了**:原文寫「新增第二段讀模型…依 order_ids 批次讀」,
    但**那段查詢本來就存在** —— `SupabaseOrderAdapter.ts` 為了把單號換成 order id,早就
    `from('order_item_procurement')` 了 ⇒ ① 只是那個 select 多兩欄、**同一次往返**,
    **完全不碰 `ADMIN_ORDER_LIST_SELECT` 白名單**(條目的 🔴 禁區)。
  - **三態顯示**:一家 ⇒「這組單號屬於供應商 A」/ 多家 ⇒ ⚠️ 示警並列名 + 要求點進去核對 /
    **認不出來 ⇒ 退回原本那句警語,不假裝知道**。語意在 `lib/orders/supplier-match-notice.ts`。
  - 🔴 **少報比不報危險**:任一列認不出 `supplier_id` ⇒ 整份回 `[]`(退回警語),
    **不回「我認得的那幾家」** —— 後者會讓員工看到「只有 A 家」就放心登錄,而實際上還有 B 家。
    同理 UI 對「有任何一家沒有名字」也整組退回,不做半吊子顯示。
  - **守門與突變**:adapter 5 格 + 純函式 6 格 + 頁面 3 格;突變三靶(拿掉去重 / 認不出就濾掉 /
    濾掉沒名字的照顯示)**各只紅該紅的**。另 `SupabaseOrderAdapter.test.ts` 那道釘住探測 select
    的守門**同步改並把理由寫進格內** —— 它紅過一次,而且**紅得對**。
- ~~**原狀態**~~:⏳ 待執行(2026-08-07 A10c2 立案;A9b2-A 階段 C must-fix 4 的產品面缺口)
- **現況(修前)**:`order_item_procurement.supplier_order_no` 在 DB 層**沒有跨供應商唯一性**
  (A2 `20260729020000:70` 的業務鍵是 `(order_item_id, supplier_canonical_key)`,A9b2-M 的索引也只有單號本身)
  ⇒ 兩家供應商各自用了同一組單號時,搜尋會把兩家的訂單**一起列出**,而列表投影
  `ADMIN_ORDER_LIST_SELECT` 沒有供應商欄可以標示是哪一家。
  現行緩解 = A10c2 在搜尋有命中時常駐一句「此搜尋不區分供應商…請先點進訂單核對」(`app/orders/page.tsx`)。
- **修法方向**(兩條,都超出 UI 片):①新增第二段讀模型
  (`order_item_procurement → suppliers(label)` 依 order_ids 批次讀)把供應商帶進結果列;
  ②擴 `AdminOrderFilter` 加供應商軸,讓使用者直接指定是哪一家。
  🔴 **不建議**把供應商欄加進 `ADMIN_ORDER_LIST_SELECT` —— 那條是鐵則 12 的 byte-equal 白名單,
  A9w3 才剛付代價移除同族的第二份投影。
- **不修會痛在哪**:員工照搜尋結果把 A 供應商的貨,登記到其實屬於 B 供應商的那張訂單上。
  常駐提醒只是「請自己核對」,擋不住趕時間時的誤操作;而到貨登錄正是這個搜尋唯一的用途(UX §2 #7)。

### #397. 🚩 A10c2 的 flag 閘理由已消失 —— 註解說「兩欄不在生成型別」,實查兩欄都在

- **狀態:** ⏳ 待執行(2026-08-11 #338 R2 審查發現;主視窗發號 #397、E 窗立條目)
- **現況**:`SupabaseOrderAdapter.ts:565-571` 與 `:588-591` 的註解逐字寫「`supplier_order_no_upper`
  目前**不在** `database.types.ts`(欄位尚未 apply、型別未重生)⇒ **apply 前不得開 A10c2 flag**」。
  **實查兩欄都在**(`database.types.ts:1445` / `:655`;2026-08-09 重 gen 已帶入)
  ⇒ 那個 flag 閘當初的**技術理由已經消失**,但註解仍寫著,而 flag 也仍是關的。
- **不修會痛在哪**:①**理由過期的閘最難拆** —— 下一個人讀到那句話會以為還有 apply 前置,
  不敢開;而真正該問的問題(「這功能要不要對員工開」)被一句技術理由蓋住,沒有人在回答它。
  ②#338 剛把這條搜尋做得更有用了(顯示是哪一家),但它整條掛在這個沒人敢開的 flag 後面。
- **修法**:實查後把兩處註解改成現況;順帶把「這個 flag 現在還存在的理由是什麼 / 要不要拆掉」
  當一題問 Sean(是產品決定,不是技術決定)。
- **編號註**:#338 R2 的第三條 nit,reviewer 明寫「前輪既有、另立 backlog 不塞本片」;主視窗發號 #397。

### #341(拆檔). ✅ `products-url-state.tsx` 479 行(>400)— 四支互相咬合的 URL 同步 hook(已拆)

- **狀態:** ✅ 已完成(2026-08-11 12:57 `f80fca40`「#341-B products-url-state 480 行拆成五支,零行為變更」;
  **已在 dev 也已在 main**〔`git merge-base --is-ancestor f80fca40 origin/main` 通過〕)。
  ⚠️ 本行狀態在 2026-08-11 21:3x 之前一直停在「⏳ 待執行」,害主視窗照舊字面又派了一次
  ——**收工的人沒回頭改條目狀態**,而 backlog 是唯一的派工依據。教訓同族:#416 立案時只有號碼進 STATUS、條目沒落檔。
- **實際拆法(與本條原本寫的「三組」不同,以 commit 為準)**:五支 +
  `products-url-state.tsx` 保留成 re-export barrel(全樹 import 一行不用改)——
  `products-url-parsers.ts` 94 / `use-catalog-filter-url-sync.tsx` 169 / `use-vehicle-url-sync.tsx` 95 /
  `use-deep-link-restore.tsx` 86 / barrel 143(數字取自該 commit body;現行行數本窗實查:143 / 237 / 95 / 86)。
  ⚠️ `use-catalog-filter-url-sync.tsx` 現行 **237 行**(commit 當下 169)—— 已被後續片長大,但仍未過 400。
- **驗收(本窗 2026-08-11 21:39 實跑複驗)**:`use-deep-link-restore.test.tsx` **15 案全綠**。
- **🔴 號碼撞號(已解決)**:本條原與「W 線 harness 的零靶族」同號;**2026-08-11 主視窗裁定
  W 線那條改號 `#420`**(B-462-A ②),本條保留 #341。⇒ 現在 `grep -n '^### #341' docs/phase-1-backlog.md` 只剩一條。
- ~~**狀態:** ⏳ 待執行(2026-08-08 Q28① 立案;鐵則 6「判斷不拆 → 寫理由」的那個理由就在下面)~~
- **現況**:該檔 **479 行**(Q28① 前 449、更早 379),內容=URL parsers + `useBrowseUrlState` /
  `useBrowseUrlSync` / `useCatalogFilterUrlSync` / `useVehicleUrlSync` / `useDeepLinkRestore` /
  `usePageResetOnFilterChange`。鐵則 6 對元件檔的線是 400、對 hook 檔是「>200 評估拆分」,兩條都過了。
- **為何不在 Q28① 順手拆**:那一片的 R1 剛好證明這幾支 hook 之間有**非顯而易見的競態**——
  `useVehicleUrlSync` 與 `useCatalogFilterUrlSync` 會在同一輪各送一個 `router.replace`、後送的覆蓋先送的
  (Q28① MF-1)。在同一個 commit 裡疊上「搬檔案」的風險,等於把一個剛被實證過脆弱的接縫再動一次,
  而搬移本身**不會**有測試告訴你搬壞了(hook 的相對呼叫序、`window.location` 的讀取時機都不在斷言裡)。
- **修法方向**:單獨開一片**純搬移**(零行為變更):按「URL 讀」/「URL 寫」/「入站還原」三組拆,
  每組一檔;驗收=全套回歸 Δ=0 + `use-deep-link-restore.test.tsx` 的 15 案全綠(它是目前唯一
  把五支 hook 串起來跑的 harness、拆檔後要跟著改 import 但斷言一字不動)。
- **同族第二筆 ✅ 已拆(2026-08-11 深夜,B 九代;主視窗 `B-469-A` 批)**:
  `apps/storefront/src/components/ProductCard.tsx` 294 → 345 → 360 行
  → **拆後 207 行 + 新檔 `ProductImage.tsx` 194 行**(`wc -l` 實測、含 R1/R2 折 findings 補的註解;>300 警戒解除、兩支都遠低於 400)。
  🔴 **實際拆的不是本條原本設想的那條線**——原文寫的不拆理由是針對「把 `quickAdd` / `hasVariants`
  抽出去」,那條線**至今仍不划算、也確實沒做**(它們與唯一消費者=同檔那顆鈕內聚,抽出要多傳 4 個值、
  且會把「導頁 vs 直加」那個出過 Critical 的判斷推到別的檔)。這次切的是**另一條零耦合的線**:
  圖區元件 `ProductImage` + 它三個 module-level const(`PRODUCT_IMG_POOL` / `productGallery` / `PALETTES`)
  整組搬走 —— 那半邊與卡片本體**零共用狀態**、唯一介面就是 `<ProductImage {...} />` 那一行 props。
  ⇒ 原不拆理由與本次拆檔不衝突,兩者講的是同一個檔案的兩條不同切線。
- **本次拆檔的驗收(2026-08-11 實跑)**:①**純搬移逐字證明**=拆前 `ProductCard.tsx:21-187`(167 行)
  與新檔對應段 `diff` **零差異**;保留段 `:189-360`(172 行)與拆後對應段 `diff` 亦**零差異**。
  ②`ProductCard.tsx` 保留 `export { ProductImage }` re-export(#341-B barrel 手法)⇒ 全樹零 import 改動
  (數法=`grep -rn "from '\./ProductImage'\|from '@/components/ProductImage'` --include='*.tsx'
  --include='*.ts' apps packages | grep -v node_modules`,真正的 import 呼叫點 **1 個**〔`ProductCard.tsx` 自己那行〕;
  ~~「四處提及全是註解」~~ **2026-08-12 窄 R2 更正**:那個數字是錯的,而且「數提及」本來就是
  數字串出現位置、不是數語法位置——註解提及實查 14 處,與「有幾個 import」無關)。③三綠:typecheck 8/8、lint 10/10、
  build 2/2(0 cached);④全套 **449 檔 7429 綠 +1 todo**、與拆檔前基準 **Δ=0**;
  ⑤**突變證判別力**:把新檔的 `'#ffffff'` 改成 `'#000000'` ⇒ `ProductCard.test.tsx` **2 紅**
  (證明既有測試真的跑到被搬走的那段,不是「綠但沒覆蓋」),已還原並複驗逐字相同。

- **不修會痛在哪**:每加一條 URL 軸都要在這 479 行裡找「該插在哪一個 effect 的哪一行之前」,
  而該檔已經有三處註解在寫「**不得**在本行之前再新增任何 `params.set/delete`」這種順序契約
  (`:272-274` 是其中最嚴的一條)。檔案越長,下一個人越可能插錯位置、而三綠不會紅。

### #342. 🛒 `/products` 商品目錄與品牌頁的卡片快速加購「只會導頁、不能直接加」

- **狀態:** ⏳ 待執行(2026-08-08 加購鈕線 R2 立案;**需 Sean 拍板才能開**——要動 DB 函式)
- **現況**:五個掛載面走**兩條資料路**。走 `toUIProduct` 的三面(首頁 rail / 相關商品 / 會員中心推薦)
  拿得到 `variantCount` ⇒ 無規格商品可在卡片直接加入。走 RPC `search_catalog_by_vehicle` →
  `apps/storefront/src/lib/catalog-page.ts:54` `catalogRowToUIProduct` 的兩面
  (**`/products` 商品目錄**、品牌頁)⇒ 那支 mapper **沒有 `variantCount` 欄** ⇒ 卡片拿到 `undefined`
  ⇒ 依安全側規則當作「有規格」⇒ **一律導商品頁**,快速加購在那兩面等於不能用。
- **為什麼是安全側而不是直接加**:未知若當「沒規格」而直加,有規格的商品會送出無 `variantId` 的行,
  購物車 server 端 fail-closed 丟掉它(`app/cart/actions.ts:168-170` → `hooks/useResolvedCart.tsx:110`)
  ⇒ 客人看到「✓ 已加入」+ 徽章 +1、進購物車卻沒那筆**而且刪不掉**(幽靈品項)。
  兩種猜錯代價不對稱:猜「有規格」最差多跳一次商品頁,猜「沒規格」做出刪不掉的髒行。
- **修法方向**:讓 RPC `search_catalog_by_vehicle` 回傳每列的變體數(或一個 `has_variants` 布林),
  `CatalogListRow` 與 `catalogRowToUIProduct` 跟著帶。⇒ **動 DB 函式 = migration = 鐵則 12③ + 鐵則 8**,
  要 plan + codex 對抗審查,不在 UI 片範圍。
- **不修會痛在哪**:Sean 回報的原始症狀是「**商品目錄**的加入購物車沒反應」。現在它不再是壞的
  (不會製造幽靈品項),但也還不是他要的「按了就加進去」——在那一面只是換成跳頁。
  這條沒做完,他的原始需求就只完成了三/五。


### #455. 🧹 購物車清不掉 `found:false` 的殘行(版本偏移/下架商品的幽靈行)

- 🔢 **原號 `#343`,2026-08-13 由 #376 改為 `#455`**(與「`customer_addresses` 可被客人直接寫入」撞號;那條被**已 apply 的 migration** 引用、不得竄改故留原號)。`useResolvedCart.tsx`/`.test.tsx` 與 `#375` 相關紀錄裡寫 `#343` 又在講幽靈行的,指的是本條。

- **狀態:** ✅ **已修(08-10 #375-B `999ebb54`,與 #375 同一顆根因一次解)**——resolve 成功後自動移除該次明確回報 `found:false` 的行(`.catch()` 分支一行不刪=防網路抖動清車;跨實例 healSeq 守衛);待推送+Sean 肉眼驗(購物車頁角標自回正)。誠實邊界=`actions.ts:102-119` continue 畸形行不產 row、清不到(明文設計);trim 分歧行不在覆蓋面(commit body 五條偏離全列)。原文留下供比對:⏳ 待執行(2026-08-08 加購鈕線 R3 F4 立案;族級問題、非本片引入)
- **現況**:`apps/storefront/hooks/useResolvedCart.tsx:110` 對 `!r.found` 的行 `return null` ⇒ **整條從畫面消失**,
  但那筆 `CartItem` 仍在 `localStorage` 的購物車裡。畫面上既然看不到它,**就沒有刪除鈕可以按** ⇒ 客人清不掉。
- **可達路徑(不只本片)**:①商品下架/改 handle ⇒ server 端查無 ②變體被刪或換 id ⇒ `variantId` 對不上
  ③本片修法之前的卡片直加(已修,但**已經寫進客人 localStorage 的殘行不會自己消失**)。
- **修法方向**:`found:false` 的行不要靜默丟掉 —— 在購物車列出一個「此商品已無法購買,移除」的降級列
  (帶 `productId`/`variantId` 讓 `removeItem` 打得到),或在 hydrate 時就把查無的行掃掉並告知。
  前者較誠實(客人知道自己曾加過什麼),後者較安靜。
- **不修會痛在哪**:客人的購物車裡有一筆他看不見、刪不掉、也不會被結帳的東西;`totalQty` 徽章會一直
  多算它(徽章讀原始 `items`、不看 resolve 結果)⇒ **右上角數字與購物車內容永遠對不上**,而且他無法自救。


### #339. ✅ 已完成(2026-08-07)guarded-edit 進 repo + 三條防護做進腳本本體

> **銷帳**:`scripts/guarded-edit.sh` + `scripts/guarded-edit.test.ts`(10 格)。
>
> 🔴 **開工後實查,與本條原始描述有出入(記在這裡免得下次又誤判規模)**:
> - 腳本**不在 repo、也不是不存在** —— 它在 B 窗某 session 的 scratchpad
>   (`B-257-STOP:24` 逐字「在我窗的 scratchpad,還沒進 repo」),試跑過並真的擋下一次。
> - 三條的實況是 **①已做 ②只做一半 ③完全沒做**,不是「三條都沒做」。
> - **另有一個原始描述沒寫到的洞**:對 **untracked 新檔**,`git diff --numstat` 回空
>   ⇒ Δ 恆為 0-0=0 ⇒ **守門恆真且靜默**;而失敗時走的 `git checkout --` 對 untracked 檔會失敗,
>   腳本卻照樣印「已自動還原」= 字面與事實不符。
>
> **修法(一次解掉三個問題)**:對帳基準改成「**編輯前的備份 vs 現檔**」(`git diff --no-index`),
> 不再用 `git diff` 對 HEAD 的總量;還原**一律用備份**,程式裡完全不出現 `git checkout`。
> 第三條的語意警告寫進**失敗與成功兩種訊息**(通過那一刻最容易被當成「已驗過」)。
>
> **🔴 code-reviewer R1 FAIL 6 must-fix,共同形狀都是「守門自己靜默失效」**(全部親驗復現後修):
> ①備份 `cp` 不驗退出碼 ⇒ 備份失敗仍繼續跑(實測:`cp: Permission denied` 後照樣印 `✅ 相符` rc=0)
> ②`restore()` 不驗 `cp`,且「已用備份還原」印在 restore **之前** ⇒ **與舊版 `git checkout` 失敗照印已還原是同一個形狀**,
> 我換了手段卻犯同一個病 ③量測失敗被吞成「0 變更」⇒ binary 檔整個改寫 + 宣告 `0 0` 仍印 `✅ 相符`(實測)
> ④新建檔還原留下 **0 byte 幽靈檔**(實測)⑤無 `trap`,中斷後半成品留檔且備份路徑從未印出 ⇒ 不可回復
> ⑥STATUS 7 欄 —— 該條對施工窗不適用(紅線由主視窗收割時處理)。
> **修法統一為一條紀律**:這支守門的每一步失敗都必須是**吵的** ——
> 備份失敗=拒絕執行、量不到=不敢判定、還原失敗=大聲說失敗並**保留備份**(新增 `finish()` 確保還原失敗時絕不刪備份)。
>
> **突變證據(精確口徑)**:
> - 對帳基準改回 HEAD → 紅 4 格(含 untracked 那格)
> - 還原改回 `git checkout` → 紅 4 格(含「不得吃掉別人未提交改動」那格)
> - 刪失敗路徑語意警告 → **只紅 1 格**;刪成功路徑語意警告 → **只紅 1 格**
> - binary 守門改回「映成 0」→ **只紅 1 格**;新建檔還原改回 `cp` → **只紅 1 格**
> - ⚠️ **備份檢查那條沒有乾淨的突變證據**:兩次構造一次破壞語法、一次造成廣泛失敗,
>   都不是單點突變 ⇒ 該條目前只有正向測試 + 手動復現過的 `cp: Permission denied` 情境支撐,
>   **不宣稱它有突變證明**。
> ⚠️ 過程中兩次「突變沒打中」:第一次 sed pattern 假設有縮排、實際頂格而全綠,
> 差點誤判成「這格沒判別力」——`feedback_negative-test-harness-self-false-green` 現場中兩次。
> 下方為原始立案內容,保留。

### ~~#339(原始立案)~~ 🛠 guarded-edit 三條防護做進腳本本體 — 目前只有工法共識、沒有機制

- **來源**:2026-08-07 夜跑收線立法彙整 `docs/reviews/2026-08-07-night-legislation-draft.md` §5.2 包①-7
  (試跑報告 `B-163-A` 三條全收)。落檔時判定「腳本本體=機制、playbook 文字=補充」,本片只做 docs、腳本未動。
- **要做什麼**(三條全部進 `guarded-edit` 腳本本體,不只寫在 playbook):
  ①基準差值用「預期 Δ vs 實際 Δ」對帳、**不是比總量**(比總量會讓「刪 3 加 3」靜默過關)
  ②還原用備份檔、**不得用 `git checkout`**(未 commit 的新檔會被清掉 ⇒ 假紅;memory `reference_bash-background-kill-and-mutation-restore-traps`)
  ③Δ 對帳擋不了語意錯 —— 這句要寫進**守門自己的失敗訊息字串**,不是只寫在文件
- **不修會痛在哪**:Δ 對帳是目前唯一能抓到「區間刪除吃掉鄰居」的機制(2026-08-06 A9w2 實錘:三綠全綠零紅、
  只有 Δ 對帳抓得到)。它現在靠人每次記得手動比對;漏一次就是靜默吃掉相鄰內容,而且**事後看 diff 也不容易發現**
  (被吃掉的那段在 diff 裡長得像「本來就沒有」)。

### #340. ✅ 已完成(2026-08-07)lint-staged → check-syntax-nonts 的接線「真效果測」

> **銷帳**:`scripts/check-syntax-nonts.gate.test.ts`(**9 格**)。在拋棄式 scratch git repo 實跑 `lint-staged`。
> 格數組成:前提存在性釘 1 + 壞檔被擋 3(三種副檔名各一,斷 `exit=1` **且** stderr 含
> `檢查 1 檔、1 個不過` ⇒ 同時釘住「跑到了 / 是這支判的」)+ 好檔放行 3 + glob 挑檔 1 + husky 呼叫釘 1。
> 🔴 **關鍵設計**:scratch repo 的 lint-staged 設定與被呼叫的腳本路徑,**都是從主 repo 的
> `package.json` 讀進去/抽出來**,不手抄、不硬編 —— 手抄等於測自己抄的那份,就又變回存在性釘了。
>
> **突變證據(精確口徑,別引用成比實際更強)**:
> - glob 打成 `slq` → **紅 2 格** = `bad.sql` 效果格 + 前提存在性釘;`.sh`/`.yaml` 仍在涵蓋內故正確地綠
> - entry 整條刪 → **紅 4 格** = 三個壞檔效果格 + 前提釘
> - glob 放寬成 `*` → `beforeAll` throw、9 格顯示 skipped,**但 exit=1**(已實測,非假綠)
> - 「glob 挑檔」那格的斷言判別力另以 probe 實證:真 glob 下 lint-staged 輸出
>   `could not find any staged files`,放寬成 `*` 後該句消失 ⇒ 斷言會紅
>
> ⚠️ **仍未覆蓋**:`.husky/pre-commit` 有沒有被 husky 真的安裝、hook 有沒有執行權限 —— 那格只是存在性釘。
> 下方為原始立案內容,保留。

### ~~#340(原始立案)~~ 🧪 lint-staged → check-syntax-nonts 的接線缺「真效果測」— 現有只是存在性釘

- **來源**:2026-08-07 三綠補洞片(`34099c01` / `b171fc01`)Fable R2 F2。
- **現況**:`scripts/check-syntax-nonts.test.ts` 有一格讀 `package.json` 斷言
  `lint-staged['*.{sh,yaml,yml,sql}']` 的字面 —— 那只擋「entry 被刪掉 / glob 打錯字」,
  **證明不了 lint-staged 真的呼叫得成**(例如 `tsx` 不在 PATH、cwd 不對、micromatch 行為變更,都不會被抓到)。
- **要做什麼**:在拋棄式 scratch repo 裡實跑一次 `lint-staged`(staged 一個壞 `.sql`)、斷言非 0 退出;
  或等價地在 CI 加一格。**不要**為此在主 repo 造探針檔後刪除(那條路已試過,會與 reviewer gate 互相干擾)。
- **不修會痛在哪**:這是整條 gate 唯一沒有效果證明的一層。它若靜默失效,底下 26 格測試照樣全綠、
  零訊號 —— 形狀正是 `feedback_guard-checks-existence-not-effect`(守門存在 ≠ 守門接著),
  而這道 gate 存在的理由本身就是「補一個恆真的洞」,自己再開一個恆真層特別諷刺。

### #420. 🎯 W 線 harness 的零靶族與單成員靶族(W7 突變矩陣盤出的欠款)

> 🔴 **2026-08-11 改號 #341 → #420**(主視窗 B-462-A ②裁):原與「#341(拆檔)`products-url-state.tsx`」同號,
> 兩條都活著、內容無關,而引用「#341」時二義。子項編號 `#341-1`…`#341-4` 一併變成 `#420-1`…`#420-4`;
> 已改的引用點:本條、`scripts/w0b-verify.sh`(兩處)、`docs/reviews/2026-08-08-w-line-mutation-matrix.md`(四列+一處內文)、
> `docs/specs/2026-08-08-e10-b2-w7d1-…-plan.md:363`、`docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md:433`。
> 數法:`grep -rn '#341' --include='*.md' --include='*.sh' . | grep -v node_modules`(改前 W 線脈絡命中 9 處)。

- **來源**:2026-08-08 W7 片(突變矩陣+跑過帳)。全線盤點=17 支 / 379 格 / 66 發靶,
  逐條理由與誠實界在 `docs/reviews/2026-08-08-w-line-mutation-matrix.md` §3。
  🔴 立案理由(R3-FW7):欠款寫在 review 檔裡而沒有 backlog 編號 = 罪惡感清單,
  出貨線 apply 之後就不再是每日焦點、沒人會回頭認領。
- **要做什麼**(四件,可各自獨立排,由便宜到貴):
  1. **`w0b-verify.sh` 補 `KEYS_FROZEN`** —— 它是 17 支裡唯一沒有的,45 格只有格數守得住、
     格名集合無人守(換掉一格名字同時刪掉另一格 ⇒ `CELL-ACCOUNT` 照綠)。照其他 16 支抄一行。
     **併 W7d 做**(W7d 本來就要動 w0b 那批釘值)。
  2. **`w1-verify.sh` 五個單成員靶族改逐支打** —— `W1-PROPS-*`/`ACL-*`/`ACLSET-*`/`ISO-*`/
     `FAILCLOSED-*` 各 5 格,靶只打其中一支。照 `w2-verify.sh` 的 `TMUT-ACL` 迴圈形狀改,機械。
  3. **`w1` 兩個零靶族補靶** —— `W1-SIG-*` / `W1-ERRCODE-*` 各 5 格,**完全沒有東西在背書**。
     這是補靶不是改迴圈,與上一件不同工。
  4. **`w3b2-verify.sh` 的 `W3B2-SHAPE-1..11` 整族補靶** —— 31 格對 1 靶、全線最稀;
     要先想清楚 11 格各自守什麼才寫得出靶,最貴。
- **不修會痛在哪**:這些格今天**看起來**在守五支 writer 的簽章、錯誤碼、ACL 與掛品項的回傳形狀,
  但沒有任何證據顯示它們紅得起來。真正的風險不是「它們是錯的」,而是**出事時它們不會叫** ——
  出貨 RPC 改版(W7d 要動兩支 writer 加 deadlock handler)時,若某支的簽章或錯誤碼被改壞,
  全綠的 harness 會給出「沒事」的假訊號,而那正是 Sean 唯一看得懂的訊號。
  形狀=`feedback_guard-checks-existence-not-effect` 與「家族格的靶不得只打一個成員」
  (w2-verify.sh 自訂判準第四句)——**規則已經立在檔頭了,只是 w1/w3b2 沒回頭補**。

### #454. 🧪 冪等層「部分接線」維度全線零覆蓋

- 🔢 **原號 `#342`,2026-08-13 由 #376 改為 `#454`**(與「卡片快速加購只會導頁」撞號;那條有 `ProductCard.tsx` 引用與 CURRENT.md 未結拍板故留原號)。W 線欠款清單寫的 `#420`/`#342` 配對,後者指的是本條。

- **來源**:2026-08-08 W7 片補 `TMUT-WIRED` 時發現(`scripts/w2-verify.sh` §12 ⓪ 誠實界②)。
- **現況**:`W2-WIRED-*` 五格證的是「該支 writer 走了冪等層」,靶(W7 補)打的是
  「該支**完全不走**冪等層(換回骨架版)」⇒ 兩端都是全有全無。
- **缺什麼**:**部分接線**沒有任何格在量 —— 例如某支有 `claim` 卻漏 `require_complete`、
  或有指紋比對卻漏了產物集不變式重驗。另外那五格釘的是**朝外可觀察的 SQLSTATE + constraint 名**,
  一支自己 `RAISE … ERRCODE='P2B22' CONSTRAINT 'pcm_b2_w2_idem_payload_mismatch'` 的假 writer
  一樣會讓五格全綠。
- **要做什麼**:這是**補格不是補靶**(要新設計觀察點,例如從 `pg_proc.prosrc` 驗呼叫序列,
  或用 GUC 探針記錄冪等層各段是否真的執行到)。開工前先評估「值不值得」——
  現況五支 writer 都是同一次落檔、同一份樣板,部分接線的機率低。
- **不修會痛在哪**:未來若有人改寫某一支 writer(W7d 就要動兩支),把冪等層拆成一半,
  現有五格與它們的靶**都不會紅**。今天風險低是因為五支同源;一旦開始分頭演化,這個洞就會張開。

### #343. 🔒 `customer_addresses` 可被客人直接寫入,email 在 DB 層無任何約束

- **來源**:2026-08-09 M-4b LINE 3DS 修復片,codex 關卡2 抓到我在 plan 與 migration 註解裡
  宣稱「應用層必填 = 全部寫入路徑無旁路」;實查 GRANT 後坐實**該宣稱是錯的**,已就地更正字面。
- **現況(實查,非推論)**:
  - `20260523034911_init_customers_and_subtables.sql:236` — `GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE customer_addresses TO authenticated`(表級、全欄)。
  - 同檔 `:166-179` — RLS own-only 四條(只擋跨會員,不擋值本身)。
  - ⇒ **登入的客人可以直接打 PostgREST 寫自己的地址列**,把 `email` 塞成 NULL、空字串、
    畸形字串或超長值,完全繞過 `AddressInput` 這支 zod。
  - ⇒ 連帶:**NULL 不能證明「這筆地址從未被要求填過」**(本片一度以此為由設計 nullable,
    字面已更正;見 `20260809030000_*_comment_fix.sql`)。
- **今天為什麼還安全**:金流端不吃這個保證 —— `lib/payment/cardholder.ts` 的 `pickUsableEmail`
  對取到的值**用同一支 `AddressEmailInput` 重驗一次**,髒值一律擋下、不送 TapPay
  (負測:短合成域、畸形格式、tab/全形空白、41 字元,各有一條)。所以髒資料進得了 DB、進不了金流。
- **要做什麼(擇一,開工前先評估)**:
  1. 加 CHECK:允許既有列 NULL,但非 NULL 時擋畸形/超長(要先**唯讀盤點既有髒資料**,
     否則 ALTER 會被現存列擋下)。
  2. 收回 `authenticated` 的直接 INSERT/UPDATE,改走受驗證的 SECURITY DEFINER RPC。
- **為什麼不在 M-4b 這片做**:①動既有 GRANT 會影響地址簿現行功能(新增/編輯/刪除四條路徑)
  ②加 CHECK 前必須盤點正式庫既有髒資料、屬不可逆風險面 ③本片的金流缺口已由出口重驗關上。
- **不修未來會痛在哪**:第二個消費端出現時就會炸 —— 今天只有 cardholder 在讀這個欄,
  它自己重驗所以安全;但 B-4 要把地址 email 餵進 `orders.notification_email`(寄信),
  屆時若那條路徑沒有自己重驗一次,客人塞進去的畸形值就會直接進到寄信系統。
  **每多一個消費端,就要多記得重驗一次** —— 這正是「約束該畫在資料層」的典型情境。

### #344. 🛡️ `a8a2:567` 的「零全函式 EXCEPTION handler」守門名不副實 — 只認兩個字面

- **來源**:2026-08-09 W7d-2 撤片偵察副產物(`B-307-STOP` ⑤、`B-308-A` Q2=B 裁准立條)。
- **現況**:`supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql:567`

  ```sql
  IF position('WHEN OTHERS' in v_def) <> 0 OR position('WHEN unique_violation' in v_def) <> 0 THEN
    RAISE EXCEPTION 'A8a2 結構 assert:出現全函式 EXCEPTION handler;拒繼續';
  ```

  錯誤訊息宣稱它擋的是「**全函式 EXCEPTION handler**」,但它實際只比對兩個字面。
  `WHEN deadlock_detected` / `WHEN check_violation` / `WHEN lock_not_available` /
  `WHEN raise_exception` 等任何其他 handler **都會靜默通過**。
- **形狀**:`feedback_control-named-beyond-its-actual-power`(防護的命名超出它真正的能力)。
  同族還有 `feedback_guard-checks-existence-not-effect`。
- **要做什麼**:把判準改成「函式體內出現 `EXCEPTION` 區塊就拒」,或明列白名單並讓訊息
  與實際判準逐字一致(**訊息縮到它真正擋得住的範圍**也是合格修法,不一定要擴大守門)。
  修完必附負測:塞一個 `WHEN deadlock_detected` handler 進突變體,**該守門要紅**;
  現況它是綠的,那就是這條的判別力證明。
- **不修會痛在哪**:下一個想給 `admin_cancel_order` 加 handler 的片(W7d-2 若因失效條件觸發而重開,
  正是這件事)會讀到「零全函式 EXCEPTION handler」這句 assert 與 `COMMENT ON FUNCTION` 的同款字面,
  **以為有守門在把關**,於是不再自己檢查;而守門其實放行。
  這不是「守門太鬆」的一般問題,是**字面誤導後人不去查** —— 危害發生在人身上,不在機器上。

### #345. 🌗 深色模式上線前置掃描 — 三族已知債(現在不修,深色模式立案時=硬前置)

- **來源**:2026-08-09 Q4=B 片(`6ceb6982`)執行時 D 窗逐處 triage 的副產物;主視窗合併立條。
- **三族**:
  1. `background: #fff` 8 處語意未定(`--c-bg` vs `--c-surface`;其中 `.pcard-img-wrap`/`.pd-bs-mcard-img`
     是**商品照襯底**——白底去背圖深色下變黑襯底會出白框,正解可能是「永遠不翻」,與其餘 6 處**答案相反**;
     問法=「深色模式上線時商品照襯底要跟著變黑還是保持白底?」屬 Sean 品味題)。
  2. `brand-page.css:87` scoped 重定義 `--c-text: #121214` 無深色覆寫 ⇒ 深色上線該 scope 停在淺色值。
  3. `product-page.css:1686` `.pd-install-btn:hover { background:#fff }` 而非 hover 態吃 `var(--c-surface)`
     ⇒ 深色下 hover 從深跳純白。
- **現況protections**:`color-tokens.test.ts` 9 條守門已釘「text-inverse 底色必為 var(--c-text)」雙向+
  深色覆寫前提條(`--c-text-inverse` 若不再翻,整組要重估)。
- **不修會痛在哪**:三族在淺色模式全綠零症狀,**症狀全部延到深色模式上線日爆**;屆時若沒有這條索引,
  要重掃全站才找得回來。深色模式片開工時本條=硬前置清單。

### #346. 🗺️ 三支 CSS 完全不在 design manifest 追蹤內 — brand-directory / coming-soon / filter-responsive

- **來源**:2026-08-09 h1 收斂片(`03fd5b74`)改到這三支卻無處 bump,grep manifest 全檔零命中而現形;既有缺口非該片造成。
- **現況**:任何動這三支的片都不會被 manifest 可達性稽核罩到;「0 unreachable」的宣稱對它們=真空。
- **要做什麼**:對回 design 端決定歸屬元件(brand-directory→品牌總覽?coming-soon→ComingSoonPage?filter-responsive 疑跨元件要拆或立獨立條目),新增條目+初始 hash。
- **不修會痛在哪**:這三支的視覺回歸永遠不觸發 manifest 檢查,design 漂移無聲;h1 這片已實際發生「改了無處記帳」一次。

### #347. 🔍 admin 訂單搜尋大一統 — 一個框搜八個維度(Sean 08-09 拍板立案)

- **來源**:Sean 2026-08-09 逐字「目前是搜尋訂單編號跟供應商單號,可以結合搜尋 訂單編號、供應商單號、客人姓名、電話、商品料號、品牌、收件地址、品名,做到同一個搜尋框就好了」。
- **範圍**:admin 訂單列表搜尋框擴充為八維度 OR 搜尋:訂單編號 / 供應商單號(既有)+ 客人姓名 / 電話 / 商品料號(variant_sku)/ 品牌 / 收件地址 / 品名。
- **技術面預判**(開工時偵察定案):跨表 join(customers 名+電話、order_items sku/snapshot 品名、brands、shipping_address_snapshot)⇒ 大機率要一支搜尋 RPC 或擴 `ADMIN_ORDER_LIST_SELECT` 查詢面;🔴 動 admin 投影=經銷價白名單守門連動(比照 2b-0 customer_user_id 前例:byte-equal 期望值同步+forbidden 清單零碰撞+codex 審);電話/地址=個資,結果只給 admin(SSO 閘後)、log 不落搜尋詞。
- **派工**:等 D(出貨 UI)或 E(取消畫面)先收線,騰出的窗接;標準片以上、預計 2-3 片(RPC/adapter 一片+UI 接線一片+索引評估)。
- **不修會痛在哪**:員工接客服電話時只有單號能查,拿姓名/電話/商品都得人肉翻列表;訂單量月 100-300 筆下每天都痛。

### #348. 👤 客人 360 頁 — 從訂單列表點客人名進入(Sean 08-09 提出)

- **來源**:Sean 2026-08-09 逐字「客人名稱之後可以點擊進去看這位客人的所有資訊包含歷史訂單、愛車等等資訊,也包含可以更改儲值金之類等客戶功能」。
- **範圍**:admin 新頁 `/customers/[id]`:基本資料+歷史訂單列表+愛車(customer_vehicles)+儲值金餘額與調整(接既有 admin_adjust_wallet_rpc)+等級調整(接既有 set_tier RPC)。訂單列表/詳情的客人名改成連進此頁。
- **連動**:完成地圖第 25 項(改客人資料,現況⚠️只能改等級+儲值金)的載體;經銷價/PII=SSO 閘後 server-render,比照 orders 白名單慣例。
- **派工**:等出貨線+取消線收線後排;預計 3-4 片(讀模型+頁面+訂單列表接線)。
- **不修會痛在哪**:員工接電話查客人要在訂單列表人肉翻;儲值金調整現在藏在別處、動線斷裂。

### #349. 💳 既有 preflight-release CAS 的同型雙扣風險(P 窗 08-09 盤出,L5 補償線範圍外)

- **來源**:P-250-STOP §7(c)。客人自己按「重新付款」觸發的 preflight release CAS 會產生 `released` attempt——它與 L5 殭屍讓路有**一模一樣**的雙扣形狀(舊的 3DS 之後被完成=第二次扣款),但不在 Q9 拍板授權範圍內、L4/L5 刻意不碰。
- **要做什麼**:評估把 L5b 的補償盯梢(轉 AUTH 自動退)擴大到 preflight-release 產生的 released attempt;需先確認與既有 released 低頻對帳(R1c1)的分工、以及 durable 標記語意如何區分兩種 released。
- **不修會痛在哪**:L5 上線後「系統讓路的」有補償、「客人自己重刷的」沒有——同一種雙扣兩種結局,客服無法解釋;發生率隨零等待上線可能上升。
- **前置**:L5b 完工+標記欄 schema 落定。

### #350. 🖥️ admin 訂單工作區佈局改版:側欄預設收窄+訂單詳情右側分割視窗(Sean 08-09 拍板)

- **來源**:Sean 08-09 18:0x 逐字:「1. 左邊側邊欄位預設窄一些,變成跟文字對齊,盡量放大訂單顯示空間 2. 點擊訂單內容我不要切換視窗,而是做視窗分割,變成點擊訂單編號後,直接在右邊切一個畫面,畫面大約是現在視窗的一半,可以調整,我們90%時間都會是跟截圖一樣的狀態下工作」。
- **要做什麼**:①側邊欄預設窄版(icon+文字對齊寬度),訂單列表吃回空間;②訂單列表點編號改為右側 split pane 開詳情(預設約 50%、可拖曳調整),不整頁跳轉;手機行為維持現狀(小螢幕沒有分割的空間)。
- **Sean 08-09 追加(逐字)**:③「點擊客戶名稱時候,可以變成該客人資訊欄位,一樣是分割畫面方式顯示」=#348 客人 360 的顯示容器定為同一個右側分割面板;④「點擊料號變成該商品的內容,包含圖片、車款等資訊…如果商品已經變更價錢或者任何因素,連結會是新的東西…可能要另外建立快照系統,這部分要討論一下」。
- **快照現況(主視窗實查,`packages/domain/src/order/types.ts:87`)**:`order_items.product_snapshot` 已存在且結帳當下凍結——title/sku/spec 逐欄白名單(改名改價不影響歷史單)、`unit_price`/`line_total` 凍結、`vehicle_snapshot` 存車款;**唯一沒凍結的是商品圖片**(現行圖存 R2)。⇒「另建快照系統」不需要,缺口只有圖片一欄。**Sean 08-09 拍 Q1=A**:分割畫面商品卡=下單當下凍結資料(品名/料號/規格/單價/車款)+現行商品圖+「開賣場頁」鈕,畫面標清楚「下單當下」vs「現行」。
- **不修會痛在哪**:員工日常 90% 時間在「列表↔詳情」來回,整頁跳轉每單多兩次導航與捲動位置遺失;這是操作順手性的主幹,不是裝飾。(08-10 主視窗收割註:此兩行原被錯置於 #355 尾,歸位)
- **狀態(2026-08-12 重數,逐顆 `git merge-base --is-ancestor <sha> dev` 驗過)**:
  **①②已完工上線**、**③④未做**。
  - ① 側欄收窄 16rem→9rem = `07974229`(350a)
  - ② 右側分割面板 = `08e56014`(350b 殼+可拖曳調寬+寬度持久化)+ `fe3973bb`(350c 訂單面板接線)
    + `e0e8bcc2` / `5690b771` / `6b2eaf20` / `e533025e`(350d-1〜4 面板內動作 return_to 全線)
  - ③ 點客名開客人面板 = **未做**:客名今天是純文字(`orders-table.tsx:217`、手機卡 `:354`),
    且無 `app/@panel/customers/` 槽頁;但整頁版 `app/customers/[id]/page.tsx` 已存在(完整度未確認)。
  - ④ 點料號開商品卡 = **未做**:料號是列表第 5 欄純文字(`orders-table.tsx:447`),無商品面板槽頁。
  🔴 **前置**:③④ 都要在 `orders-table.tsx` 加可點欄位,而該檔是雙 markup(#447)⇒ **先拍 #447 再做 ③④**,
  否則列表要重排兩次。(③④ 的選項與推薦已成題、交主視窗排隊給 Sean,見信箱 `D-632-STOP`。)
- ~~**排程**:D 窗 #347 搜尋線收尾後接手~~ **(08-09 字面,已過期:①② 已於 08-09 晚〜08-10 午完工)**。

### #351. 📦 出貨錯誤文案白話化+彈窗「還能出」與 DB「可出」口徑對齊(Sean 08-09 實測抓)

- **來源**:Sean 真按建箱,DB 拒因全文(P2B27 掛品項超量)整段吐進彈窗,Sean 逐字「這個文字太難懂,精簡一點」。同時暴露口徑不一致:**彈窗顯示「還能出 1」但 DB 判「可出 0」**——彈窗算的是「訂購量−已裝箱」,DB 算的是「已到貨−已出貨−已裝箱」(`…w4b_impl….sql:218` 字面),彈窗沒扣「未到貨」⇒ 按鈕看起來能按、按了才被拒。
- **要做什麼**:①出貨線 DB 錯誤碼(P2B2x 家族)建 UI 白話對照表(同 E 窗取消線 11 碼表的模式),彈窗顯示一句人話+摘要,原始訊息收進「詳細」摺疊;②彈窗「還能出」改用 DB 口徑(需把到貨量帶進彈窗資料源),0 件品項不預選+標「未到貨」;③半成品箱提示保留但精簡;④🔴 **空箱(建箱成功、掛品項失敗)在訂單頁出貨卡不可見**——出貨卡由品項反查箱畫(D 之 R3 已知盲點),空箱員工找不到也作廢不了(Sean 08-09 實測撞上,逐字「我也找不到那個箱子在哪裡」)⇒ 出貨卡下方加一區列**本客人**未完成的空箱(標「空箱」+作廢鈕)。
  🔴 **2026-08-10 更正(D 窗開工實查 + 主視窗裁 A)**:原文寫「本單全部未作廢箱」是**做不到的** ——
  `shipments` **沒有 `order_id`**(只有 `customer_user_id`;`order-shipments.ts:5` 檔頭早就寫著這件事),
  出貨卡是**從品項反查箱**,而空箱沒有品項 ⇒ 它與這張訂單之間**一條線都沒有**。
  而 `order_id` **本來就不該加**:Sean 08-05 Q1=B 拍「併箱同客人」⇒ 一箱可裝多張訂單的品項。
  ⇒ 改成**客人層**,文案必須說實話(「此客人未完成的空箱,可能來自別張訂單」),不假裝是本單的。
  ⚠️ 這只是**可見化、不是止血**;源頭治本見 **#359**。
- **不修會痛在哪**:員工每次被拒都要讀一段工程師文案猜原因;口徑不一致會讓員工以為系統壞了(明明寫還能出 1)。
- **排程**:E 窗 A13a/b(取消文案表)收線後接手=同模式直接複用;②的資料源改動若動白名單照機制走審。
- **進度**:🔴 **2026-08-12 更正(D 窗十一代接單重數,本行原本落後三片)**:①②③④+排序**全數完成**。逐片可達 hash(`git merge-base --is-ancestor <sha> dev` 逐顆驗過)——
  ① `885c3d01`(08-10 凌晨,白話層僅覆蓋可證一碼一義的碼);② `e05508d9`(彈窗改 DB 口徑 avail=instock−already+出不了品項標原因 blockedReason 四值+數量框停用);排序 `f984881b`(能出的排前面、出不了的沉底,server 端 stable sort);③ `61155d70`(半成品箱提示精簡+補上它原本一格都沒有的守門);④ `5d891eb3`(出貨卡加客人層空箱區,標「空箱」+作廢鈕)。
  ⚠️ 舊字面「③④未動」「排序=D 窗待做小片」是 08-10 白天寫的,當天傍晚那四片就落地了、沒人回來改這行 ⇒ **D-609-A 的派工是照這行下的**。教訓同族:條目的「進度」欄不是事實,`git log` 才是。
  **③ 的收尾片(2026-08-12,D 十一代)**:③ 當初刪掉「去哪作廢」的**地點**,理由是那時空箱在訂單頁畫不出來(指一個找不到東西的地方 = 字面與事實不符),commit body 逐字留了「④ 落地後再把地點加回來」。④ 已落地 ⇒ 地點加回來(指到 `shipment-section.tsx` 的「未收尾的空箱」區、講明是**這位客人任一張訂單頁**),並補上它的前提:半成品箱走**失敗路徑**、不呼叫 `onDone` ⇒ 關窗後頁面沒重取、那一區不會出現 ⇒ `onClose` 改帶「有沒有建出箱」、launcher 據此 `router.refresh()`。

### #359. 🧯 建箱與掛品項不在同一原子單位 ⇒ 持續產生孤兒空箱(D 窗 08-10 實查、主視窗裁 C 立案)

- **來源**:#351 ④ 的**根因**。Sean 08-09 實測撞到「建箱成功、掛品項失敗」,留下一個他自己找不到的空箱(逐字「我也找不到那個箱子在哪裡」)。
- **為什麼是 B 窗的域**:這是**寫入路徑**的交易性缺陷(建箱與掛品項不是同一個原子單位),不是 UI 查詢問題;出貨線 DB 面歸 B 窗。
- **要做什麼**:讓「建箱 + 掛品項」成為一個原子單位(同一交易 / 或掛品項失敗時回滾建箱);
  既有孤兒空箱的清理策略另議(不可無腦刪 —— `shipment_reference` 可能已對外給過)。
- **不修會痛在哪**:🔴 **孤兒空箱會持續產生**。#351 ④ 的客人層空箱區**只是可見化、不是止血** ——
  員工看得到、作廢得掉,但每次掛品項失敗還是會多一個,而且它會出現在**每一張**該客人的訂單頁上。
- **編號說明**:取 #359(原取 #358,主視窗改派——#358 已被 note-compose flaky 佔用 30282524;防撞號要查 dev 最新+信箱兩邊) —— #357 已被 E 窗使用(`E-049-STOP:20`),#356 無法證明未被佔;
  撞號比留空號貴(E-041 實錘:同號兩封信互不可見、改令被漏讀)。

### #352. 📥 「登錄到貨」功能整條(v3 重設計;Sean 08-10 拍 Q1=A 甲+乙/Q2=A 兩入口/Q3=A 刪除)

- **來源**:Sean 實測「沒進貨就不能出貨嗎?」。🔴 **前提更正(D-435/D-443 親驗)**:原句「呼叫**既有**採購/到貨寫入面」為假——`order_item_procurement_receipts` 零寫入路徑(ACL `20260729020000:237-238` REVOKE 全部+只 GRANT SELECT;app 層零 INSERT)⇒ 正式站已到貨恆 0、一件都出不了=系統現況非現貨特例。v2 特殊通道案(虛擬供應商搬配額)四麻煩全是繞路產物,廢棄。
- **要做什麼(v3)**:先做「登錄到貨」,現貨只是其一來源。**#352-a(DB)**=「店內現貨」供應商種子列+`admin_record_item_receipt`+`admin_delete_item_receipt`+harness(新表寫入面+ACL=**鐵則 12③ codex 不降級**;不新寫建列 RPC,用既有 A5a `20260803160000:107-119`)。**#352-b(app)**=共用「登錄到貨」小視窗+兩入口(採購區塊每列/出貨彈窗「貨到了」)+server action+smoke test;**a 未 apply 前 b 不上線**。溢餘=甲+乙:當場請員工調降供應商訂購量(系統不背著搬)+真多到允許登記「溢收」(查得到、不能自動出別單;獨立庫存=#374 不偷跑)。刪除守門唯一一條=不得刪到低於已裝箱/已出貨量+稽核 log。
- **不修會痛在哪**:出貨線整條卡死(每品項恆「未到貨」);現貨/急件員工最高頻動作繞遠路。
- **排程**:✅ **整條完工(08-12 盤整輪對帳更正;原「D 窗施工中」字面落後三天)**:a=migration `20260810233000`(admin_record_item_receipt/admin_delete_item_receipt,已 apply=APPLIED.tsv :169)+`scripts/352a2-verify.sh`;b-1=`577cae48`、b-2=`ce91891e` 皆在 dev。拍板全文=memory `project_m4b-352-spot-stock-supplier-decision`。⚠️ 本條目其餘段落的「現況描述」為立案當時字面,引用前以 git log/catalog 為準。

### #356. 🕳️ 多分頁重複部分取消可疊加(換 token 重送同 payload,殘量夠就再扣一次)(原取 #353,08-10 主視窗改派 #356 解三重撞號)

- **來源**:A13b 關卡1 R2 + E-021-STOP Q3;`cancel-actions.ts:113-124` 逐字已寫明=**現況、非 PRG 新洞**。主視窗 08-09 裁 A:誠實認列、本線不動。
- **為什麼可容忍**:實害=多取消品項,不是多退錢——現況防線**只有一道**(RPC 擋超量取消);🔴 Q13 退款雙上限公式=08-09 拍板**尚未實作**(E 窗 08-10 實查全樹零命中,主視窗原敘述寫滿已更正)⇒ **退款線實作時 Q13 上界=硬驗收**,實作前退款側無上界。取消帳本 append-only 全程可稽。
- **要做什麼(日後)**:跨 token 的原子防線(同單同品項的並發取消序列化或冪等鍵改綁業務鍵)=動 RPC/DB,獨立提 plan 走鐵則 12。
- **不修會痛在哪**:員工多分頁操作時可能取消超出本意的數量,需人工用復原/重建流程收拾。

### #354. 🎯 w7 收據帳的 exits_of 放寬與 inconc 凍結=零常設靶(B 窗 08-10 盤出)

- **來源**:B-330-STOP ⑦(a7t 收編時盤出):`w7-coverage.sh` 的四發常設靶沒有一發打 `exit` 欄 ⇒ `exits_of` 集合放寬或 inconc 凍結值被改時,check 不會紅。
- **要做什麼**:補一發常設靶(改壞 exits_of 允許集合 → check 必紅)+一發 inconc 凍結靶。
- **升級條件**:下次任何片要動 `exits_of` 語意=本條升級為該片硬前置。
- **不修會痛在哪**:收據帳對「離場碼語意悄悄放寬」全盲,假綠家族最後一個沒關的窗。

### #355. 🧾 出貨冪等收據的內容指紋(B-224 MF-2 的 B 案;併 W8 鍵契約設計)

- **來源**:B-333-STOP triage:假收據攻擊現況=owner 級才構造得出(表 ACL 全 REVOKE+零 policy RLS+helper EXECUTE 全收,三層各有出處),判 **P2**;但 INSERT 守門與 deferred 閘「看到鍵在≠查驗過產物」成立(memory `feedback_idempotency-key-must-be-verified-not-just-present` 同形)。
- **已做的前兩步**(B 窗 08-10 片):D=守門盯到期條件 4/5(新 SECDEF 餵可控值進 record/動態 SQL 寫表)+A=deferred 閘產物存在斷言。
- **本條要做**:快照存產物識別欄 hash,重放回信封前重驗——真正關掉「空快照/張冠李戴」。設計併 W8 鍵契約(canonical jsonb scale=B-224 MF-1 同場)。
- **不修會痛在哪**:owner 級誤操作(migration 寫錯/DBA 手滑)可留下永遠回「成功」的幽靈收據,對帳查不出。

### #353. 💳 `record_status = -1 ERROR` 的「舊 3DS URL 已死」前提**未驗**+真實發卡行行為差異(2026-08-10 L4 probe 遺留;主視窗 P-275-A 裁 B 立案)

- **來源**:L4 前提 probe(`docs/specs/2026-08-10-l4-stale-3ds-url-probe-plan.md` §7)。`classifyRecordStatus`(`packages/use-cases/src/settle-charge.ts`)把 `-1 ERROR` 與 `5 CANCEL` 判成**同一個** `explicit_failed` → 上游 `markFailed` 釋鎖放行重刷,靠的是「Record 落 -1/5 後舊 `payment_url` 送 OTP 必定失敗」。probe 只證到**一半**:`5` 在 sandbox 實測成立(含正向對照),**`-1` 未確認**——sandbox **構造不出**該態(已試 OTP 連錯 5 次/放置逾時/找模擬失敗鈕三路,前兩路 Record 都停在 `4`,第三路 sandbox 頁只有送出/取消兩鈕)。
- **🔴 第二個缺口(與 -1 獨立、別合併處理)**:即使 `5` 那半,證的也只是「**TapPay sandbox 的狀態機**這樣走」。sandbox 3DS 頁是 TapPay 自己的模擬頁,**不等於真實發卡行的驗證頁**——真卡驗證頁多久失效、取消後還能不能回送,完全未知。
- **不修會痛在哪**:這兩個缺口任一成真 = **雙扣窗口重開**。情境:客人的 3DS 交易落 `-1`(或真發卡行的 `5`),我方判 failed、釋鎖、放客人重刷成功;此時客人回頭在舊分頁把原本那張的 OTP 送出去,若發卡行仍認 ⇒ **同一筆訂單被扣兩次**,而且兩筆都是「合法授權」,對帳上看不出是重複,只能靠客訴發現。⚠️ 這**不是 L4b 引進的**:既有已上線的 cart dedup 路徑吃的是同一句假設 ⇒ 這格的風險**現在就在正式站上**,L4b 只是繼續沿用。
- **要做什麼**:①找到能構造 `-1` 的路(向 TapPay 客服問 sandbox 有無誘發手法,或在正式環境用 1 元真卡設計零風險觀測——**需 Sean 拍板**、不可自行動正式站);②真實發卡行的 URL 失效行為取得任何一手證據;③在此之前,`settle-charge.ts` 的註解與所有轉述**必須**維持「`5` 已驗 / `-1` 未確認 / 只證 sandbox」三段口徑。
- **排程**:M-3 金流線,**不擋 L4b 上線**(主視窗 P-275-A 裁 B 已定:擋 L4b 不會讓正式站更安全,只會少一層守門)。真環境一旦觀測到「-1/5 之後舊 URL 仍成交」= 立即升為 blocker、重估 `classifyRecordStatus` 整格。
- **編號註**:立案當下最大編號 = #352(`grep` 實查),故取 #353。(08-10 主視窗收割註:三重撞號實錘——本條、多分頁條、取消前提條同取 #353;本條有 code 級引用(`cancel-actions.ts`/`settle-charge.ts`)保 #353,多分頁條改 #356、取消前提條改 #357。)

### #357. 🔁 取消 `miss_complete` 說「可以重送」的兩個未證前提 — 跨單 token 與導頁後讀取新鮮度(原 E 窗取 #353,主視窗改派 #357)

- **狀態:** ⏳ 待執行(A13b D3 codex R2 抓出、主視窗 08-10 裁 A+D 立案;前提③假完整已由 **#325** 管,本條不重造)
- 🔗 **動手前先讀 `#373` §4**(08-10 教義判斷的附帶產出):取消線 bfcache 死巷的修法**未必要 client 鑄鍵** —— 退款線示範了「`pageshow` 只 `router.refresh()`、不鑄鍵」這條路,它不牴觸「渲染期鑄」義務(`refund-section.tsx:83-88`)。⚠️ 該候選的空窗安全性**未驗**,要修的人自己驗。
- **來源**:`apps/admin/src/lib/orders/cancel-ledger-classifier.ts` 的 `miss_complete` 是全站**唯一一句「可以重送」**,而它踩在兩個 D3 結構上證明不了的前提上(檔頭「結構上擋不住」清單逐條有依據行號)。
- **前提①(跨單)**:冪等鍵唯一性是 `UNIQUE (order_id, idempotency_key)`(`supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:118-119`)= **跨單不唯一**。classifier 只收到「某一張單的帳本」,看不出 token 原本屬於哪張單 ⇒ 帶著 A 單的 `rt` 落在 B 單頁,B 單帳本當然沒有它。**可達性字面見下面「08-10 E 二代前置研究更正」——「舊書籤」那條已證偽,別再引用本行原本的三個構型。**
- **前提②(新鮮度)**:「導頁之後那一頁拿到的是重新算過的資料」**沒人量過**(`apps/admin/src/lib/orders/cancel-action-state.ts:113-115` = 義務 A/B 後面「⚠️ 兩條都踩在同一個未實測前提上」那段逐字;`E-031-A` 已把「要起真 admin 才量得到」排到 #350 線下)。已 commit 但這次渲染沒讀到,與「沒寫進去」在畫面上長得一模一樣。**未排除的層只剩一個,見下面更正段。**
- **候選解**:① 讓表單鑄 token 時把 `order_id` 一起綁進去(或另存一份 token→order 對照),D5 顯示面板前先驗綁定,驗不過回 `unreadable` ② 導頁後那次讀取走強制新鮮 / primary read,並補一條真的量得到「重算有沒有發生」的觀測點。
  🔴 **①的「綁進 token 本體」那個變體實查不可行**:`idempotency_key` 是 `uuid`(`20260730130000:86`),而同檔驗收段用 `format_type` **釘死型別必 uuid**(`:317-322`,該段自陳「型別本身就是第一道守門 —— 它是免形狀 CHECK 的理由」)⇒ `${orderId}:${uuid}` 放不進去,要放就得改欄型 + 拆驗收 + 連動 a8a1 冪等格與 hash(`20260805100000:195-202`)= **鐵則 12③**,而換來的防護等級與純 app 層那案**相同**(D5 比的是「URL 上這顆 `rt` 宣稱屬於誰」,DB 端不參與那次比對)。⇒ 走 app 層,別動 DB。
- **不修會痛在哪 —— 🔴 ①與②的傷害形狀不同,不要合寫**:
  - **②(新鮮度)= 第二筆刪不掉的取消**:已 commit 但這次渲染沒讀到 ⇒ 員工被告知「查不到」⇒ 對**同一張單**重送(取消明細表 append-only,`20260805100000_m4b_e10_a8a2_partial_cancel.sql:17`)。
  - **①(跨單)= 取消到錯的那張單**(08-10 更正,比原字面更糟):員工帶著 A 的 `rt` 落在 **B 單頁**,面板說「查不到」⇒ 他若照文案重送,送出的是 **B 單頁上的表單**,而那支表單為 B **鑄一顆全新 token**(`components/orders/cancel-order-forms.tsx:124` 每次 render 新的)⇒ 冪等格完全撞不到 ⇒ 取消掉一張本來不該取消的單。
  - 兩者共同:代價落在錢與客訴那一面,且**四閘與測試數都看不見它** —— 純函式對它的輸入是不是可信完全無知。
- **現行緩解(已上線,不等本條)**:`miss_complete` 的文案不得寫成斷言句,要寫「目前查不到這筆,重新整理再確認一次;仍然沒有才重送」(主視窗裁 A;義務已寫死在該格 docstring,D5 實作時承接)。
- **排程**:取消線 D4/D5/D6 收工後評估;與 #325(max-rows 漂移偵測)同屬「截斷/完整性判定的共同前提」族,可合併一次做。
- **08-10 350d 後更正(E 會簽備註①)**:revalidate 已跟 return_to 走(order-revalidate.ts)⇒ 前提②的失效原因**少了一個**(「它不可能是新的」已拿掉),但「導頁後真的讀到重算資料」的**觀測仍是零**;#357 開工時以此為現況基準。
- **🔴 08-10 E 二代前置研究更正(全文 `E-068-STOP`,主視窗裁決 `MAIN-026-A` = Q1 先不修 code)**:
  - **前提①的可達性:原字面三個構型裡「舊書籤」已證偽。** 逐支讀完 orders 域全部會產生「開另一張單 / 換視圖」連結的 builder:`buildOrderListHref` 只吃 `Record<keyof AdminOrderFilter>` + `[panel, id]`(`lib/orders/order-list-view.ts:572`、`:619-627` → `lib/shared/list-params.ts:99-116`,**只走傳進來的 entries**);`order-filter-controls` 的 `href()` 全量由 client state 導出(`components/orders/order-filter-controls.tsx:27-28`);`buildPanelCloseHref` / `buildPanelSelfHref` 會抄 raw query 但把 `panel`/`r`/`rt`/`correct` 剝掉(`order-list-view.ts:497` + `order-return-to.ts:32-40`)且指的是**同一張單**。⇒ 書籤存的是當時那條完整網址 ⇒ path/`panel` 與 `rt` **同單**,錯配不成立;點列表另一張單 / 翻頁 / 改任何篩選也帶不動 `rt`。**真正剩下的構型 = 手改網址、或把結果網址貼到別張單的網址上**;JS 開著時 `rt` 在面板顯示後就被抹掉(`components/orders/cancel-result-url-cleanup.tsx:52-54`),JS 關掉才會一直留在網址上。
  - ⚠️ **誠實邊界(引用上面那段的人必須一起帶走)**:證的是「**這四支 builder 不會帶著 `rt` 跨單**」,**不是**「跨單不可能」。方法=四支原始碼逐支讀 + 兩支剝除清單逐字,**零實測**(沒起 admin、沒開瀏覽器)。**沒有量過**的是人因路徑:網址列自動補全 / 歷史建議把一條舊結果網址接到新單上、複製貼上只貼一半 —— 那些不在 code 的可控面上,不因本段而消失。
  - **前提②:未排除的層從四層縮到一層,而那一層 = #364。** 已排除三層(方法=靜態證據 + 官方文件親讀,同樣**零實測**):①Full Route Cache —— 兩頁都 `force-dynamic`(`app/orders/[id]/page.tsx:18`、`app/@panel/orders/page.tsx:23`)②Data Cache —— `next@16.2.6`(`apps/admin/package.json:20`)、admin `next.config.ts` 空物件(無 `fetchCache`/`cacheComponents`/`staleTimes` 覆寫)、Next 官方文件字面「預設 fetch 不快取」與「`force-dynamic` similar to setting `cache: 'no-store'` for all `fetch()`」③revalidate 與導頁的**順序**是對的(`lib/orders/cancel-actions.ts:208`→`:217`、`:231`→`:240` 都是先 revalidate 再導頁)。**排不掉的那一層** = `revalidateOrderViews` 用 `returnToPathname` 把面板 `return_to` 砍成 `/orders`(`lib/orders/order-revalidate.ts:35` + `order-return-to.ts:218-221`)⇒ `revalidatePath('/orders')` 到底刷不刷 `@panel/orders` 插槽零觀測點 = **#364 同一件事,同場量**。
  - ⚠️ 三個「排除」是排除**具名機制**,不是「真站上一定新鮮」的證明;前提②的觀測**仍然是零**這句沒有變。
  - **🏁 .ts 側字面已同步(主視窗 08-10 18:0x **門鈴裁決** Q1=A,純註解片,與本條目同一個工作段;⚠️ 該裁決**沒有信號** —— 我原本引成 `MAIN-029` 是錯的,那個號實際上是同日給 P 窗的另一封信)**:①`cancel-ledger-classifier.ts` 的跨單可達性段已改掉「舊書籤」那個構型、並補上四支 builder 的依據 + 誠實邊界 + 傷害方向(取消錯單)②三處指向 `cancel-action-state.ts` 的過期行號(`:93-95` ×2、`:69-71` ×2,含 `cancel-ledger-classifier.test.ts`)已改成**以段名為錨、行號為輔**(`:113-115` / `:106` 起)—— 改錨點形狀是為了讓它**不會再漂**:行號被同檔後續編輯推移時沒有任何東西會紅。
    ⚠️ 順手查過但**沒動**的一處:`cancel-actions.ts` 引 `cancel-action-state.ts:14-20` 談 payload_hash 綁定 —— 實查該段落確實涵蓋(精確在 `:16-22`),起點早兩行、不構成誤導,不在本次範圍。

### #358. 🎲 note-compose-form 測試 [5] confirm 閘 flaky(全套偶紅、單檔恆綠)

- **來源**:2026-08-10 夜跑收割 D5 時 root 全套第一輪紅(`confirmSpy` 3≠2,`note-compose-form.test.tsx:118`)、單檔隔離 10/10 綠、全套第二輪綠 ⇒ 時序敏感 flaky,非 D5 引入(該檔上次改動在 M-3 era);觸發疑=檔數 417 改變執行次序/併發時序。
- **要做什麼**:修測試 [5] 的競態(fireEvent.submit 兩次之間的 confirm spy 計數窗口;改用逐步 await 或收斂斷言時點),不改產品碼。
- **不修會痛在哪**:夜跑收割與 CI 的全套偶紅=假警報,狼來了效應會讓真紅被當 flaky 略過(e2e-prod 已有「單次紅不管」判準,本地全套再加一顆 flaky 會擴大灰區)。
- **編號註**:立案當下最大=#357(grep 實查)。

### #360. 🕳️ 整頁版訂單動作遇「單被同時刪掉」= 裸 404 零回饋(350d-1 立案)

- **來源**:D 窗 350d-1(`e0e8bcc2`)。面板側已補(`PanelMessage` 畫橫幅),整頁版 `/orders/{id}` 對 A 單做取消/退款當下單被刪 ⇒ 裸 404,員工看不到「做完了沒」。既有行為、不在 350d 片界。
- **要做什麼**:整頁版 not-found 邊界加結果回饋(至少「這張單已不存在;你剛送出的動作結果=?」的判別資訊或指路)。
- **不修會痛在哪**:員工在整頁版做完動作看到 404,分不清「動作成功後單被別人刪」vs「動作根本沒送出去」⇒ 重做一次=重複退款/重複取消的入口;訂單量 100-300/月下屬低頻但錢面。
- **編號註**:立案當下最大=#359(主視窗 grep repo+信箱兩邊實查)。

### #361. 🔁 通用 `r` 結果碼無 URL cleanup ⇒ 重整/上一頁在面板重複播報(350d-1 立案)

- **來源**:D 窗 350d-1。取消碼有 cleanup、通用 `r`(saved 等)沒有 ⇒ `/orders?panel=X&r=saved` 黏在網址,重整或上一頁會再說一次「已儲存變更」;C2 把橫幅搬進面板後讀起來更像「這張單剛剛又被存過」。
- **要做什麼**:通用 `r` 掛上與取消碼同一支 URL cleanup(小片)。
- **不修會痛在哪**:員工誤信重複播報=以為又存了一次/懷疑重複扣動作,期中期後都會製造無謂求證;放久了「橫幅」的可信度整體貶值。
- **編號註**:同上,#360 之次。

### #362. ✅ `scripts/a7bm-verify.sh` workdir 閘 `/tmp/?*` 放行 `/tmp//` ⇒ `rm -rf` 可清整個 /tmp(B 窗 08-10 順帶回報立案)

- **狀態:** ✅ 完成(2026-08-11 W-c1,B 窗七代;修的那顆自己銷帳)
- **🔴 銷帳註**:閘已改寫、現址 `scripts/a7bm-verify.sh:50-61`(舊標題引的 `:42-45` 已失效);
  負測五格在 `:258-264`、消融四格在 `:301-304`,`__pathguard_probe` 讓負測跑的是**同一段閘程式碼**、不抄第二份。
  W7 收據已依規矩重錄(a7bm 33/0),全 w7 = PASS=46 FAIL=0。
  ⚠️ 下面「來源」欄那句「a7bm-verify.sh 未修=不在片界且動它要重錄 W7 收據帳」**已被這顆推翻**:
  W-c1 正好就是那個片界(本來就在重錄收據)⇒ 當初的擱置理由當時成立、現在不成立,原句保留只為留下判斷軌跡。
- **來源**:B 窗 OP1 補丁片修自家 op1p-verify.sh 同款洞時發現(六條路徑負測那組);a7bm-verify.sh 未修=不在片界且動它要重錄 W7 收據帳。
- **要做什麼**:照 op1p-verify.sh 已驗的修法搬過去(`/tmp/[!/]*`+拒尾斜線/連續斜線/`..`/symlink+各自訊息),並依 W7 規矩重錄該支收據。
- **不修會痛在哪**:任何人以 `WORK=/tmp//` 跑它,teardown 那行就是 `rm -rf /tmp//`=清空整機 /tmp(本機所有 session 的 socket/中繼檔全滅,多窗當場斷訊);這不是理論,B 在自家那支已實測構造出來。
- **編號註**:同上,#361 之次。

### #364. 📐 契約 §5 前提未量:`revalidatePath('/orders')` 是否真的刷新平行插槽 `@panel/orders`(350d-2 立案)

- **來源**:D 窗 350d-2(`5690b771`)。本片測試只量「mock 收到什麼參數」,不是 Next 真的重取了什麼;契約 §5(revalidate 隨視圖)與它防的 `miss_complete` 誤導整條踩在這個未量前提上。
- **要做什麼**:真站(或真 admin dev server)量一次:取消動作後導回面板視圖時,平行插槽的資料到底刷沒刷;與 #357 前提②(導頁後新鮮度)同族,可同場做。
- **不修會痛在哪**:若 revalidatePath 刷不到平行插槽,員工在面板看到的取消帳本可能是舊的 ⇒ `miss_complete` 那句「查不到請重整確認」出現機率上升,最壞路徑=員工重送一筆刪不掉的取消(append-only)。
- **🔴 08-10 E 二代升級(`E-068-STOP` §2、裁決 `MAIN-026-A` Q2=C)**:本條**已經是 #357 前提②唯一還排不掉的那一層** —— 另外三層(Full Route Cache / Data Cache / revalidate 與導頁的順序)已由靜態證據 + Next 官方文件排除,逐條錨點在 #357 的「08-10 E 二代前置研究更正」段。⇒ 量到這一條就等於把 #357② 一起定案,**兩條同場做、不要各排一片**。量法兩案:**案 B**(最小 repro app,不需真單)只當**證偽器** —— repro 層刷不到 ⇒ PCM 必刷不到 = 兩條直接定案;repro 層刷得到 ⇒ **推不出任何 PCM 結論**(PCM 這側多了 `returnToPathname` 砍 query、`@panel` 槽、真資料層),**不得寫成「應該會刷」**;**案 A**(真 admin + 一張真單)與 **D6-b 併同一個 Sean 停點**。
- **🔴🔴 08-10 案 B 最小 repro 已跑完(全文 `E-070-STOP`,主視窗 08-10 18:0x **門鈴裁決** Q2=A(**該裁決沒有信號**;原引的 `MAIN-029` 是誤引,那號是同日給 P 窗的另一封信);repro 在 `~/repro364-20260810/`,附 README + `start.sh`)**:
  - **repro 層的答案 = 會刷。** `revalidatePath('/orders')` **確實刷到了 `@panel/orders` 插槽**。撐住這句的是**單變數對照**:同一份 build、同一個 server、同樣**不改網址**,只差 `revalidatePath` 一個變數 ⇒ 有 = 插槽新鮮、無 = **插槽 stale**。
  - **判別力證明(沒有這個,「新鮮」就是恆真)**:在 `experimental.staleTimes.dynamic = 30`(刻意造出 client Router Cache)之下,「無 revalidate + 網址不變」那格量到**真的 stale** —— 插槽顯示動作前的值、**per-render nonce 一個字沒變**(⇒ 那份 DOM 就是動作前那次 render),而同一顆 tab 硬重整立刻看到新值(⇒ 寫入發生了、是畫面沒跟上)。
  - 🔴 **`PCM 現況 config`(admin `next.config.ts` 空物件)那一組四格全新鮮、含對照格 ⇒ 該組零判別力**,不得拿它當 PCM 的任何保證。
  - **副產物**:光是「導頁網址變了」就足以讓插槽新鮮(不需要 revalidate)。而取消線**每次導頁都會改網址**(必 append `r`,`sentResultQuery`/`cancelledResultQuery` 兩支都必帶 `rt`)⇒ PCM 有**兩個彼此獨立**的理由會新鮮;**兩個都沒有在 PCM 上量過**。
  - ⚠️ **`repro ≠ PCM`,推不出本站結論**(證偽器的觸發條件是「repro 層都刷不到」,沒有成立 ⇒ 依 `MAIN-026-A` 字面**不寫「應該會刷」**)。已知差異:資料層(本機檔案 vs PostgREST+service_role)、插槽內容(一顆數字 vs `OrderDetailRoute` 三路 `Promise.allSettled`+四組容錯旗標)、執行環境(`next start` 單程序 vs Vercel 多實例)、面板 `return_to` 夾帶的篩選 query。**版本是對齊的**(`next@16.2.6` / `react@19.2.6`,直接接 admin 的 `node_modules`)。
  - **案 A(真站)照這個形狀做**,兩個觀測點缺一不可:①**per-render nonce**(有沒有重新 render)②**帳本那一列**(重新 render 之後讀不讀得到)。🔴 **先建立判別力再下結論** —— 案 A 也要有「stale 構造得出來」的那一格(最便宜=本機 dev/預覽暫時調高 `staleTimes.dynamic` 跑負向格,**不動正式設定**),否則會複製上面那種零判別力的全綠。與 **D6-b 併同一個 Sean 停點**。
  - 🔴 **harness 自己的三個坑(都會產出假的「全新鮮」,寫下來讓案 A 不要重踩)**:①prod build 把 server 端 `process.env` **編譯期內聯** ⇒ 變體從未生效而四格看起來全正常(修法=變體走 formData,並把「實際走的分支」寫回 DOM 當斷言)②port 被殘留程序佔住 ⇒ `next start` 靜默 `EADDRINUSE`、探針打到**別的 build**,而 **「curl 回 200」與「HTML 有那顆 hidden 欄」兩道都攔不住**(唯一有效守門 = `start.sh` 裡「聽 port 的必須是我們剛啟動的 PID」)③「有沒有重抓 `main-app.js` chunk」判斷整頁重載**恆為 true**=假警報,要改用「送出前插的 JS 全域還在不在」。
- **編號註**:立案當下最大=#363(E 窗 token 守門,已派號)。

### #363. ✅ 已完成(2026-08-10)token 產生點的守門從文字層升級成機制層(server-only)(A13b E1 立案;E 窗草稿原文)

🔴 **完工摘要與下面「立案當下原文」的兩處差異(單獨讀本條的人必看)**:
1. **「這不是取消線專屬:備註線、退款線的 token 產生點吃同一個形狀」= 已被推翻**,見 **#373**。形狀相同,但**備註線今天有一條刻意的 client 端換鍵路徑**(bfcache),教義未經重新驗證 ⇒ **不可搭同一片**。本片**只做取消線**。
2. **「代價:要動 vitest alias 或測試 setup」= 估錯方向**。實查:repo 既有處置是**逐檔一行 `vi.mock('server-only', () => ({}))`**(payment 五支前例 + jsdom 前例),root `vitest.config.ts` 無 `setupFiles`,本片**刻意不開**全域 setup。真成本在原文**沒提到**的地方:`cancel-forms-hydrated.test.tsx` 那支 esbuild harness 會把整棵樹打包進瀏覽器 ⇒ 要在它的 stub plugin 裡換掉 `server-only`。
3. **落地範圍**:新模組 `lib/orders/cancel-request-token.ts`(`import 'server-only'`)+ 呼叫端一處改 import + 文字層那條守門**改守 inline 產生器面**(機制層擋 import、文字層擋 inline,**兩層守不同的面**)。能力邊界逐字寫在該模組檔頭:**「不可能經由 import 這支共用產生器在 client 產生」,不是「不可能在 client 產生」。**

現況:`cancel-order-forms.test.tsx` 用「掃 components/orders/*.tsx、含 generateCancelRequestToken( 的檔不得有 'use client'」擋。已知四種繞法它都抓不到:改名 import(`as makeToken`)、換行呼叫、把呼叫點搬進 .ts、搬到 components/orders/ 以外。
修法:把 token 產生器拆成獨立模組 + `import 'server-only'` ⇒ 從 client 元件 import 會在 build 期紅。
代價:`server-only` 在 jsdom 測試環境會拋(A13b E1 的 spike 已實際撞到 `server-only/index.js:1` "cannot be imported from a Client Component"),要動 vitest alias 或測試 setup。
不修未來會痛在哪:取消線的 token 是冪等鍵。它一旦在 client 端鑄,同一個人重整兩次會拿到兩把鍵、重送保護失效;而更糟的是**沒有任何東西會紅**——文字層守門對「換個寫法」全盲,而行為層在 jsdom 分辨不出來(`React.cache` 純透傳,D4 已實跑證過 17 測全綠)。這不是取消線專屬:備註線、退款線的 token 產生點吃同一個形狀。

### #365. 🕳️ 取消線外 8 處單值欄位用 `formData.get()` 取第一筆(A13b E1 複審外溢立案)

- **來源**:codex 複審 E1 抓到取消線三處 `formData.get()`(已修=getAll 恰一);E 窗掃出**同形狀未修 8 處**:`procurement-actions.ts`(3)、`keyword-search-action.ts`(2)、`note-actions.ts`(2)、`item-procurement-form.tsx`(1)。
  🔴 **範圍更正(2026-08-10 E 三代動手前實查;原「8 處 / 4 檔」是低估,不是筆誤而是掃描範圍太窄)**:全 `apps/admin` 非測試檔的**單值 `form.get()` / `formData.get()` 共 43 處、分佈 17 檔**,而且**已經長出 11 個各自為政的本地 helper、三種形狀**(`asString` ×5 檔、非取消線的 `readString` ×5 檔、只有 `cancel-form.ts:148` 的 `readSingle` 是「`getAll()` 恰一筆」的正確形狀)。逐檔數(`grep` 後排除測試檔與註解命中):`workflow-form.ts` 7 / `wallet-form.ts` 5 / `supplier-form.ts` 4 / `procurement-actions.ts` 4 / `tier-form.ts` 4 / `staff-form.ts` 3 / `note-actions.ts` 3 / `refund-actions.ts` 2 / `procurement-form.ts` 2 / `keyword-search-action.ts` 2 / `actor-actions.ts` 1 / `refund-recovery-form.ts` 1 / `refund-recovery-actions.ts` 1 / `refund-form.ts` 1 / `note-form.ts` 1 / `cancel-actions.ts` 1 / `item-procurement-form.tsx` 1。
  ⇒ **這不是一片的體積、且跨 3+ 檔又碰錢面(wallet/tier/refund/procurement)⇒ 命中鐵則 8(先提 plan 等批)與鐵則 12①**。拆片提案見 `E-088-STOP`。
  ⚠️ **風險口徑要誠實、別照抄取消線那句**:取消線的後果是「員工看到 2、系統取消 5」;但 admin 這些路徑的送出者**本來就是已登入員工**,重複欄位**不給他任何新權限**(他直接送任意值也行)。真正的痛是另外兩個:①**表單重構意外**渲染出兩個同名欄位 ⇒ 靜默採第一筆、零紅燈 ②**畫面顯示值 ≠ 送出值**這條路在未來任何「代填 / 分享連結 / 嵌入」情境會變成真的洞。⇒ 修它的理由是**可防的正確性與 fail-closed 一致性**,不是「今天有人偷得到錢」。
- **形狀**:單值欄位送兩份時由送出者決定採哪一筆;取消線的後果是放大取消數量/導錯單,其他線各自評(採購=錢面優先)。
- **要做什麼**:統一 `getAll()` 恰一筆字串的讀取 helper(取消線已有現成形狀可抄),逐線套+順序互換負測。
- **不修未來會痛在哪**:重複欄位=竄改或未來表單重構失誤都構造得出;採購/備註線被採第一筆時是寫入錯誤資料的入口,且零紅燈。
- **編號註**:立案當下最大=#364(grep 實查)。

### #367. 🧪 eslint ignore 涵蓋 *.test.ts ⇒ 三綠的 lint 道對測試碼零覆蓋(350d-3 順帶揭示立案)

- **來源**:D 窗 350d-3 誠實揭示:eslint 設定的 ignore pattern 蓋掉測試檔 ⇒ 鐵則 11 三綠裡 lint 那道**從來沒看過任何 `*.test.ts(x)`**;非本片造成、全 repo 既有。
- **要做什麼**:評估把測試檔納入 lint(可能要 test 專屬 ruleset,直接開會炸一堆既有警告);或至少把「lint 不含測試碼」寫進 slice-checkpoint.md 的三綠說明=誠實計價。
- **不修會痛在哪**:測試碼的品質問題(未 await、dead assertion、誤用 API)只剩 tsc 和 reviewer 肉眼在看;恆真測試那族(本週抓到 3+ 例)有一部分本可被 lint 規則(如 no-floating-promises、expect-expect)機械抓到。
- **編號註**:立案當下最大=#366(P 線 reviewer-gate soft-skip,已派號待條目)。

### #368. 📜 L5a-1 migration 誠實邊界 7 的 apply 前置指示照字面不可執行(P 窗自查立案)

- **來源**:`supabase/migrations/20260810010000_m4b_lifecycle_l5a1_supersede_charge_attempt.sql:379-382`。兩處與事實不符:①寫「原字面 SELECT」但該段是 **DO block**;②`::regprocedure` 在函式建立前必炸 function does not exist。08-10 apply 實際跑的是主視窗改寫的預演版(EXECUTE 持有集代入 {owner postgres, payment_confirmer}),預跑 NULL、apply 放行,零損害——但錯誤指示仍留在已 apply 的檔案裡。
- **修法**:邊界 7 改成預演版口徑:「apply 前預跑=把守門段的查詢部分抽出、v_fn/v_owner 兩個 DECLARE 換成當下已知 EXECUTE 持有集再跑,斷言回 NULL;不可直接貼原段」。一行文件修正,隨下次動該檔或 P 線任一 docs 片帶走。
- **不修會痛在哪**:下一代照字面預跑 ⇒ 撞 function does not exist ⇒ 誤判為「守門又發火」= MAIN-005 假警報重演一次,浪費一輪診斷。
- **編號註**:立案當下最大=#367(grep 實查;P 草稿自派 #367 已被佔用,主視窗改派)。

### #366. 🚪 `.husky/pre-commit` 對 reviewer-gate 缺檔採 fail-open,gate 被刪即靜默放行(P 窗草稿,主視窗代錄)

- **現況**(`.husky/pre-commit:1-5` 逐字):`if [ -f .husky/reviewer-gate.sh ]` 存在才跑,不存在只印一行 stderr 警告**照樣放行**。
- **失敗情境**:誤刪/rebase 掉/worktree 漏帶/checkout 到舊 commit ⇒ reviewer gate 完全不執行、commit 照過;警告行易被 lint-staged 輸出淹掉 ⇒ Sean 08-04 拍板 Q3=A 的存在理由(擋「先 commit 後審」)該情境下歸零。
- **修法**(2 行):`else` 分支改印明話並 `exit 1`(fail-closed)。
- 🔴 **需 Sean 點頭**:改的是他拍板過的守門行為(fail-open→fail-closed),「gate 檔暫時不在」會從可 commit 變不可 commit。
- **不修未來會痛在哪**:reviewer gate 是唯一擋「先 commit 後審」的機制;它靜默失效時沒有任何訊號說審查被跳過了。
- **編號註**:#366 為 12:2x 預派號(P-308 §4 裁 A 當下),條目 13:0x 補錄;當下最大實錄=#368。

### #369. 📜 L5a-M 檔頭「補償紀錄=attempt 另一組欄」承諾與 L5b ledger 設計矛盾,已落檔宣告作廢(P 窗草稿,主視窗代錄)

- **現況**:`supabase/migrations/20260809230000_*.sql:56-57`(已 apply)逐字承諾「已補償過/用了哪把鍵/結果=attempt 另一組欄、L5b 自己那片加」;L5b 設計(Sean 08-10 拍四點)改為一律進 `payment_refund_ledger`,該句已由 `20260810140000` 檔頭與表註解宣告作廢。
- **失敗情境**:未來讀 L5a-M 註解者在 attempt 上再開第二組補償欄 ⇒ 補償紀錄雙寫、兩邊分岔;舊句在已 apply 檔內改不了、零指標,唯一發現機制=本條掛帳+新檔宣告。
- **編號註**:#369 為 14:0x 預派號(P-314),條目 14:4x 補錄;當下最大實錄=#368。

### #370. 🧟 a8c2/a8a1/a8a2-verify 三支在全量 migration 庫上跑不動且不在 W7 帳(B 窗 08-10 查清立案)

- **來源**:B 窗 OP3 期間實測:三支 verify 在全量 provision 庫上拒跑(a8c2 紅在 begin 閘=L4a-1 08-09 改過 `begin_charge_attempt` 的既有債,非 OP3 打破;B 先前「我打破了三支」已更正)。三支都不在 w7-coverage 帳上=帳面永遠看不到它們壞著。
- **要做什麼**:①修三支的前置(對齊 L4a-1 後的 begin 定義)②收進 W7 帳或寫明排除理由(照 EXCLUDED-REASONS 慣例)。
- **不修會痛在哪**:取消守門(a8c2)與 A8a 系的回歸驗證形同不存在;未來動 confirm/cancel 線時以為有網,實際上那三張網從 08-09 起就是破的。
- **編號註**:立案當下最大=#369(grep 實查)。
- **08-10 OP3 後補註**:OP3(20260810160000)使修復需連帶=改三支用 SET SESSION AUTHORIZATION+重釘 confirm 的兩個 md5(MD5_NEW/CMT_MD5_NEW)+對齊 begin 閘;三支已入 w7 EXCLUDED-REASONS 附失效條件(修好=刪該段收進帳)。


### #371. 🩺 `classifyPgError` 只認 P0001 ⇒ P2B36/P2B37/P8C01 被歸「連線失敗可重試」誤導值班(OP3 立案,Sean 裁 A=另片修)

- **來源**:OP3 codex R2-MF2;`packages/adapters/src/payment/PaymentConfirmerAdapter.ts` `classifyPgError` 非 P0001 一律 unreachable「付款確認連線失敗(可重試)」且原錯誤零 cause 鏈。
- **失敗情境**:P2B36(部署 DSN 身分錯)=全部刷卡確認紅,值班照「可重試」去查網路,**重試永遠不會好**;P2B37(吞列)與既有 P8C01(隔離閘)同形。app log 零診斷、要去 DB log 撈 RAISE 原文。
- **修法**:三碼(P2B36/P2B37/P8C01)歸 rejected(不可重試)+cause 鏈+單元測=一片 adapter 金流片(鐵則 12①,獨立審查)。
- **不修會痛在哪**:OP3 已 apply 後第一次部署設定錯誤發生時,診斷被 app 層抹平、恢復時間 ×N;OP3 migration 檔頭已誠實計價此缺口。
- **編號註**:立案當下最大=#370(grep 實查)。
- **08-10 晚增補(OP5 線)**:清單擴為 **P2B38(🔴 一碼兩義:`pcm_op5_received_at_future` 與 `pcm_op5_received_at_before_order` 兩個 CONSTRAINT 共用,按 CONSTRAINT 名分)/P2B39(actor 無效)/P2B40(吞列)/P2B41(退款態具名拒)/42501(分期開權期間呼叫=還沒開權非壞掉)**;來源=OP5 審查鏈 Fable R3-#4/#7。
- **08-10 晚增補(OP-A12 線)**:再擴 **P2B42(actor 無效 `pcm_opa12_actor_invalid`)/P2B43(落帳 row_count `pcm_opa12_row_count`)/P2B44(🔴 一碼兩義:`pcm_opa12_card_rail` 卡軌拒 vs `pcm_opa12_already_reversed` 已沖拒)**;來源=A12 migration(`20260810210000`:54/:102/:136/:148/:165)。🔴 `pcm_opa12_already_reversed` 的映法要求見 #372 A12 條目(終態非可重試)。
  - 🔴 **2026-08-12 更正(A12 入口片 v4,關卡1 三輪)**:原句寫「**按 CONSTRAINT 分**」——**這個前提從來沒有被實測過**,而 repo 內對它有兩份互相打架的字面:`payment-action-state.ts:149` 逐字**斷言**「app 層拿不到 constraint 名(PostgREST 的錯誤物件不帶它)」,`shipment-error-view.ts:28` 逐字自陳「**前提未驗**…我沒有實測」。⇒ **入口片的設計刻意不依賴它**:一碼一句、句子同時涵蓋兩義、**不宣稱成因**。要真的分開講,得先有一套 PostgREST 錯誤形狀的實測 harness,那是另一片。**下一代不要照原句去做「按 constraint 分派」,會撞同一堵牆。**

### #372. 🕳️ OP5 四個具名缺口登記:OP-A12 沖銷入口/A13 退款態補收/A14 已收款單可被取消/A15 待認領款暫存帳(B 窗 08-10,主視窗立案)

- **來源**:OP5 登錄 RPC 審查鏈(B-395→B-400,codex×3+Fable 四輪 34+ 條)。四缺口字面已寫在 `20260810200000` migration 檔頭;**OP1 檔頭不補寫**(已 apply 檔+W7 收據翻攪成本,主視窗 08-10 裁)⇒ 本條=repo 內可 grep 的登記處。
- **OP-A12 沖銷入口**(`admin_reverse_manual_payment`):同片 ①GRANT 兩支(登錄+沖銷)②翻 op5-verify ⑰/⑳ ACL 極性(零 EXECUTE→service_role only)+重錄 W7 收據 ③`has_function_privilege` 有效權限斷言。**沖銷不受 payment_status allowlist 限制**(沖銷是更正不是收錢)。=OP5 的開權解鎖點(GRANT 分離設計,取代「同批 apply」)。🔴 **接 UI 時 adapter 必把 `P2B44/pcm_opa12_already_reversed` 映成「已沖成,勿重試」終態**——G8 無冪等,網路逾時後重送得此碼=前一次已成功,誤歸「失敗可重試」會誘發沖銷之沖銷(08-10 雙線審 opus#10/Fable F5)。
- ✅ **A12 入口片已做(2026-08-12)**,本條的映射要求**做到的形狀與原字面不同,逐字更正如下**:
  - `P2B44` 映成**終態、零重試指令**(核可句 D),但**不宣稱是哪一義** —— 拿不到 constraint 名(見 #371 條目的 08-12 更正)。做得到的是「不叫他重按」,做不到的是「告訴他已沖成」。
  - 🔴 **原句漏掉一條更危險的路**:真正會誘發沖銷之沖銷的不只是 P2B44,是**連線類失敗**(不知道成功沒)。若那句話寫成無條件的「再試一次」,員工會去沖**列表上新出現的那列負數**(沖銷紀錄本身)⇒ 原款被加回帳上。⇒ 核可句 C 做成**條件式雙分支**:有「已沖銷」標記→停手;沒有→**回到原本那一筆**再沖一次;並逐字寫「不要去沖列表上新出現的那一列負數」。
  - ⚠️ **反過來也不能修過頭**:入口片 v2 一度全面禁止重試字眼,結果把上面那個負分支唯一正確的指令一起封死了(關卡1 R3 Fable F1 抓到)。禁的只能是**無條件重試句**。
- **OP-A13 退款態單的沖銷與重登入口**;失效條件=OP6 淨額與狀態重算上線。
- **OP-A14 已收款單的取消守門**:A8a2 允許集合只看 unpaid+attempts、**不看 order_payments** ⇒ 已收人工款的單目前仍可被取消(收了錢的取消單)。歸 OP6 或 A8 線收,不在 OP5 片內。🔴 **A12 開權後此壞態「開權後可達」**(Sean 08-10 拍 C 照現狀開權不加守門;否決 A 案理由=會推翻 07-26「已付款可取消」拍板,逐字在 A12 migration 檔頭 :47-51)。
- **OP-A15 待認領款項暫存帳**:OP5 每一道 fail-closed 拒絕在正式站=**錢收到了但記不進去**;OP-A15 上線前值班唯一手段=人工銀行對帳。**接 UI 硬前置**。
- **不修會痛在哪**:開權後才發現=登錯帳不能更正(A12)/退款態的真實入帳永遠記不進(A13)/收款與取消互相矛盾的單(A14)/記不進的錢無處可放(A15)。
- **排程**:A12=B 線 OP5 後下一片(開權前置檢查表全表);A13 掛 OP6;A14 歸 OP6/A8 線;A15 排接 UI 前。
- **編號註**:立案當下最大=#371(grep repo+信箱兩邊實查)。

### #373. 🔐 備註線 / 退款線的 token 產生點:各自判教義,再決定要不要跟進 #363 的 server-only 機制(#363 立案)

- **來源**:#363(取消線 token 產生點升級 server-only)實作時的範圍界線。#363 原文寫著「這不是取消線專屬:備註線、退款線的 token 產生點吃同一個形狀」——**實查後那句要修正:形狀相同,但備註線有一條刻意的 client 端換鍵路徑,而那條路徑的必要性尚未重新驗證** ⇒ 不能搭同一片。
  🔴 **字面紀律(codex 關卡2 must-fix 更正我的第一版)**:我原本寫「教義**不同**」——那是**封口式斷言、我證不到**。實檔只能證明「備註線**目前**這樣實作 + 它當初的理由」,**證不到「那個必要性今天仍然成立」**(~~取消線是用「渲染期鑄 + 每次整頁重繪換新」解掉同一題的~~ 🔴 **這個括號的前提是錯的、08-10 判斷時被實檔推翻,見下 §0;刪除線保留原字面,讓讀過舊版的人認得出自己看到的是哪一句**)。本條要判的就是這件事。
- **實查(#363 偵察 pass)**:
  - **退款線**:`generateRefundRequestToken` 的呼叫點(**08-10 複查:非測試檔共 7 處、不是原記的「三處」**——`app/orders/refund-exceptions/page.tsx:131`、`components/orders/order-detail.tsx:411`、`lib/payment/refund-action-state.ts:190`、`refund-actions.ts:84/96`、`refund-recovery-actions.ts:227/236`)**沒有任何 client 呼叫端**(7 個點分佈在 **5** 個檔:`page.tsx` / `order-detail.tsx` 無 `'use client'` 指令、`refund-actions.ts` / `refund-recovery-actions.ts` 第一行 `'use server'`;🔴 **第 5 支 `refund-action-state.ts` 兩者皆非**——它被 `'use client'` 的 `refund-section.tsx` import ⇒ **實際在 client bundle 內**,只是那顆呼叫點所在的 `refundFailure` 目前只被 `'use server'` 檔呼叫)⇒ 今天沒有洞,跟進 #363 是**純加固**,成本與取消線同形(拆模組 + 逐檔 `vi.mock('server-only')`)。
  - 🔴 **備註線不一樣,它今天就有一條 client 端鑄鍵路徑、而且是刻意的**:`components/orders/note-compose-form.tsx`(`'use client'`)有自己的 `regenerateToken()`(inline `crypto.randomUUID()` + 非 secure context 的 `Math.random` 退路),用途是 **bfcache 復原時換鍵**(取消線 `cancel-order-forms.tsx` 檔頭逐字記為「備註線把同一件事列成債④、用 client 端 `pageshow` 換鍵解決」)。
    ⚠️ **精確範圍(opus nit;別讀成全線 client 鑄)**:該元件**另收一顆 `serverToken` prop** ⇒ **主鍵仍然是 server 鑄的**,client 只鑄「bfcache 換鍵」那一把。本條要判的是**那一把**,不是整條線。
- **要做什麼**:**先判教義、後動手**。逐條回答:①備註線的 bfcache 換鍵是不是仍然必要 ②若必要,那條線的正確守門形狀是什麼(機制層擋不到 inline,只能靠文字層掃描 + 明寫例外)③退款線要不要單獨跟進。
  ⚠️ **原題目①括號裡寫「取消線是用『渲染期鑄 + 每次整頁重繪換新』解掉同一題的」——那個前提是錯的,08-10 判斷時實檔推翻**(詳下「教義判斷」§0)。留這句是為了讓讀過舊版的人知道自己看到的是被推翻的前提。

#### 🏁 教義判斷(2026-08-10 E 窗三代;**判斷完成、機制跟進不排期**)

**§0 先更正題目自帶的假前提** — 「取消線已用渲染期鑄解掉 bfcache 這題」**不成立**。
主論是**定義層、不依賴任何實測**:**bfcache 還原的定義就是不重新渲染** ⇒「渲染期鑄」對它零覆蓋。
旁證:取消線自己的檔頭把這條路列為**已知未解**(`components/orders/cancel-order-forms.tsx:67-80` 逐字「返回鍵帶回來的是上一次那顆 token…撞 `payload_hash`(`20260805100000:195-198`)⇒ 回 `rejected`」)。
🔴 **證據強度要收窄(審查抓到我引超過)**:`cancel-forms-browser.test.tsx` 證的是「**返回鍵 + hidden 維持 markup 值**」,**不是 bfcache** —— 該檔自陳④「送出後的回應是本 harness 自己回的一頁普通 200、不是 `redirect(303)`+PRG ⇒ 返回鍵走到的 history 條目與正式站不同,**不主張**返回鍵在正式站的行為與這裡一致」,且全檔零 `event.persisted` 斷言。⇒ 我原本寫「D6-a 真瀏覽器實測證實 bfcache」是**宣稱大於來源**,已收窄成上面這句。
⇒ 不能拿取消線當「已有更好解法」的依據;真相是**取消線是這幾條線裡唯一沒處理這條路的**。

**§1 答①:必要,保留備註線的 client 換鍵。** 撤掉 = 把備註線退回取消線今天的已知 bug:同鍵不同內容 ⇒ RPC **RAISE fail-loud**(實作逐字在 `20260802150000_m4b_e10_a6_admin_append_order_note.sql:172` `RAISE EXCEPTION 'admin_append_order_note: request_id 已被使用但無對應備註或內容不符…'`;同檔 `:33` 是它的檔頭說明——**引註解不算行為證據,審查抓到後改引實作那行**)⇒ 員工正常操作看到「系統狀態異常」。
🔴 **它與 #363 教義沒有真衝突**,理由是機制邊界而非慣例:token 是 **hidden input**,而**真正吃進 RPC 的那顆是直接從 FormData 讀的、只驗形狀不驗來歷**(`lib/orders/note-form.ts:83-84`、`lib/payment/refund-form.ts:72-73` 逐字 `readString(form, …_REQUEST_TOKEN_FIELD)` + `isNoteRequestToken` / `isRefundRequestToken` 形狀檢查)⇒ **送出的那顆 token 本來就由 client 完全掌控,與誰鑄無關**;server 端沒有任何「這顆 token 必須是我發過的」查驗。
(⚠️ 審查更正:我原本引 `note-actions.ts:86` / `refund-actions.ts:84` —— 那兩行在**失敗回帶 state** 的 `carryBack` 路徑上,不是吃進 RPC 的那條路,證的是另一件事。結論不變、引證已換。)#363 的機制保證的是「不可能**經由 import 共用產生器**在 client 產生」,**不是**「token 由 server 權威產生」。備註線那把只削弱「產生點統一」這個可讀性目標,沒有削弱 #363 真正保證的東西。(同一句話備註線檔頭 `note-compose-form.tsx:37-38` 早已寫過:「繞過畫面者本就能自選 token,server 權威只保 honest path」。)

**§2 答②:守門不該追求「全站統一」,而是「每條線的例外具名登記 + 可被發現」。** 因為實檔顯示**這是四條線、四種刻意不同的教義,不是一種教義加一個例外**:
| 線 | 冪等鍵怎麼來 / bfcache 還原時 | 為什麼 | 出處 |
|---|---|---|---|
| 備註 | server 鑄主鍵;bfcache 還原時 **client 換新鍵** | 多一筆備註可用「更正」修;沿用舊鍵撞 C9 = 死巷 | `note-compose-form.tsx:29-38`、`:110-118` |
| 退款 | server 鑄;**絕不換鍵,改 `router.refresh()`** | 多一筆是**錢**;舊鍵撞 G4 → DUPLICATE 才是重送保護 | `refund-section.tsx:30-33`、`:83-88` |
| 取消 | server 渲染期鑄;bfcache **沒有處理**(已知未解) | 卡在 E1 不變式(i):client 重鑄就離開 server 渲染期 | `cancel-order-forms.tsx:67-80` |
| **出貨** | 🔴 **100% client 鑄**(按下去/開窗那一刻 `crypto.randomUUID()`) | 刻意:「冪等鍵在按下去那一刻生成一次,重試沿用同一把」 | `shipment-void-button.tsx:8-10`、`:36`;`shipment-launcher.tsx:10`、`:101` |
🔴 **出貨線是審查抓出來的,我原本漏了它**,而它正是 #363 痛點(假前提擴散)最大的一面:~~全站 client 端真正鑄鍵的檔就是 `shipment-void-button.tsx` 與 `shipment-launcher.tsx` 這兩支~~ 🔴 **這句本身是假的(2026-08-11 補齊片的關卡2 審查打掉)**:當時只看 `apps/admin`,而備註線 `note-compose-form.tsx`(bfcache 換鍵)與 storefront 的 `CartContext.tsx`(`cart_session_id`,3DS-7 雙扣去重把手)都在 client 鑄。當時成立的只有「**出貨線那兩支是 100% client 鑄鍵、而且沒被登記**」,而 `cancel-request-token.ts` 的例外登記段**只點名了備註線**。⇒ **具名登記那條義務已於 2026-08-11 落實**(E 窗補齊片):不是補一段散文,而是**升成機制** —— `cancel-request-token.test.ts` 掃 **`apps/` 與 `packages/`** 全部 `'use client'` 檔的亂數字面,與登記表比對 **`路徑 → 命中數`**,多一個檔、或同一檔多一顆,都紅。枚舉結果 = **9 處 / 5 檔**(結帳線 `CartContext.tsx` 3、備註線 3、出貨線 2、`ui/sidebar.tsx` 1 非 token;3+3+1+1+1)。⚠️ 守門有**五條能力邊界**(範圍 / 只認第一行 `'use client'` / 只認三種亂數字面 / 只認 `.ts|.tsx` / 只看原始碼字面),逐字寫在守門檔頭 —— 別讀成「client 不可能鑄鍵」。
⇒ 守門形狀:機制層(`server-only`)擋 import、文字層擋 inline,兩層守不同的面(#363 檔頭已寫);**本判斷不新增守門**。誠實邊界:文字層掃描對「換個寫法」全盲(#363 檔頭自列四種繞法)⇒ 它的價值是**讓例外可被發現**,不是**防止新增 inline**。真要防得靠 lint 規則(對 `'use client'` 檔禁 `crypto.randomUUID`),那是另一件事、本判斷不排期。
🏁 **2026-08-11 更新**:登記面補齊片做的**正是**這句所指的方向,但落在**測試層**而不是 lint 層 —— 掃描 + 登記表比對,新增未登記的 client 亂數點就紅。它防的是「**新增了沒人知道**」,仍**不防**「刻意新增並登記」;上面「文字層對換個寫法全盲」那條**依然成立**(守門只認三種亂數字面,自己刻 LCG 掃不到,能力邊界逐字寫在守門檔頭)。

⚠️ **本判斷用的方法有一個結構性邊界(審查提,誠實記)**:我判「某支是不是 client」是**逐檔看第一行指令**(不是 grep 關鍵字,那會把註解算進去)。但**第一行沒有 `'use client'` ≠ 該檔不進 client bundle**——`refund-action-state.ts` 就是活例(無指令,卻被 `'use client'` 的 `refund-section.tsx` import ⇒ 實際打進 client bundle)。要答「有沒有洞」嚴格上得看**模組圖**,而那正是 #363 選 `server-only`(機制)而非文字掃描的理由。本判斷的三個結論不依賴這個邊界(§3 另以「呼叫端是誰」補證),但下一個人別把「看指令」當成充分方法。

**§3 答③:退款線不跟進 #363 機制片。** ①今天零洞(呼叫點全 server,見上「實查」段複查數字)②`lib/payment/refund-action-state.ts` **有 client importer**(`components/orders/refund-section.tsx` 第一行 `'use client'`)⇒ 直接加 `server-only` 會當場 build 紅、**必須拆模組**,與取消線同形的成本(取消線那片實花一整片 + 雙線審查)③#363 的痛點是**假前提擴散**,那個痛用**文字**就解得掉,不需要再做一次機制片。

**§4 🔴 本判斷的附帶產出(對 `#357` 有用,但不在本片動手)**:取消線檔頭說擋路的是「client 重鑄 ⇒ 離開 server 渲染期」——**退款線示範了第三條路:`pageshow` 時只 `router.refresh()`、不鑄鍵**(`refund-section.tsx:83-88`)。那條路**不牴觸**「渲染期鑄」義務(新鍵仍由 server 在 refresh 的那次 render 產),所以取消線的 bfcache 死巷**未必需要 client 鑄鍵才能修**。⇒ 修 `#357`/取消線 bfcache 時先評估這個候選。⚠️ **兩條未驗邊界,別把這段當已驗結論**:
①**空窗**:refresh 完成前重送在取消線語意下是否安全(退款線靠 G4 承接;取消線對應的是 `payload_hash`)。
②**結構差異(審查補)**:取消線失敗走 **PRG + 結果頁**,而結果頁有 `cancelFormsAllowedOnResultPage` 閘(`lib/orders/cancel-action-state.ts:91`)⇒ **結果頁根本不渲染表單**,`pageshow` listener 只能掛在表單渲染時存在的元件上;退款線沒有這一層(`useActionState` 原地失敗、同頁)。⇒ 套用前要先解這個掛載點問題。(好消息:兩者同掛 `order-detail.tsx`、頁層快取條件相同,這一項不構成障礙。)
- **不修會痛在哪**:#363 之後**只有取消線**有機制層守門。若有人讀了 #363 就以為「全站 token 都不可能在 client 產生」,他會拿這個假前提去審備註線(而備註線是刻意 inline)或去設計新的線。⇒ 痛點是**假前提擴散**,不是今天有 bug。
- **不修的現行緩解**:`lib/orders/cancel-request-token.ts` 檔頭已逐字寫死能力邊界(「不可能**經由 import 這支共用產生器**在 client 產生」,並點名備註線是刻意 inline 的活例),`cancel-order-forms.test.tsx` 的 inline 守門也明寫只掃取消線。
- **編號註**:立案當下最大=**#372**(三邊實查:`grep '^### #'` repo 端最大 372、`grep '#373\|#374'` 信箱零命中、`git log -60 dev` 零命中)。

### #374. 📦 訂單外純備貨進貨無入口(Phase 2/藍圖層;Sean 08-10 拍「要立」)

- **來源**:#352(現貨補記到貨鈕)拍板時 Sean 問「有進貨的話是有另外的頁面要填寫嗎?訂單有的商品跟訂單沒有的商品」。主視窗實查:**訂單品項的進貨=訂單頁採購區塊(唯一入口,無獨立進貨管理頁);訂單外的純備貨進貨=系統零入口**——整個 M-4b 是訂單閉環設計,所有採購/到貨紀錄掛在 `order_item_procurements`/`order_item_procurement_receipts`(皆以 order_item 為鍵),沒有「不掛訂單的庫存」這個概念。
- **要做什麼(日後;Sean 08-10 逐字定調)**:「就會需要延伸到**庫存清單、該商品庫存**,基本上就是 **ERP 系統的流程,但是走簡化版本**」——獨立的進貨/庫存管理面(供應商進貨單、不掛訂單的庫存量、庫存清單頁、商品頁庫存數、出貨時從庫存扣帳),屬 9 大藍圖的庫存管理塊,**不在 Phase 1 範圍**(鐵則:不做 9 大藍圖)。設計時以「簡化版 ERP」為上限口徑,不做完整 ERP(批號/儲位/多倉等不在內)。**且需與報價單系統整合**(Sean 08-10 逐字「會需要跟報價單那邊做整合」;報價單=獨立 repo pcm-quote-v2、真身在 mac mini(memory `reference_quote-repo-truth-moved-to-mac-mini`),含九家供應商 fetcher 與供應商價格資料——整合面預期=供應商/商品主檔與進貨成本的對接,細節屆時開規格)。#352 的「現貨/自有庫存」虛擬供應商(memory `project_m4b-352-spot-stock-supplier-decision`)是它的過渡貼片:現貨仍要等訂單成立後才能以該單品項名義補記。
- **不修會痛在哪**:先進一批貨放著(展會備貨、熱門款囤貨)在系統裡是隱形的——帳上看不到庫存資產、出貨時要靠 #352 逐單補記、盤點無從盤起。訂單量走大或開始主動備貨時會痛。
- **排程**:不排(Phase 2/藍圖)。前置=內容模型與 DB 都要新概念(庫存實體),非現有表加欄可解。
- **編號註**:立案當下最大=#373(grep repo `^### #` 最大 373、信箱 `#374` 僅 #373 編號註內的命令字面、非真引用)。

### #375. 🛒 購物車角標數量與實際內容脫鉤(Sean 08-10 晚正式站實測)

- **來源**:Sean 於 shop.pcmmotorsports.com(正式站=main 分支)實測:登入後購物車原有 3 品項 → 刪除全部 3 項 → 重新加入 1 項 ⇒ **右上角角標仍顯示 3**;但結帳頁品項與金額**正確**(1×補差額用賣場 NT$1、總額 101)⇒ 錢面安全、純顯示層殘留。
- **嫌疑面(未診斷,立案時點的候選)**:header 角標的資料源與購物車本體不同步——候選=client 端快取/localStorage 殘值、server component 快取(unstable_cache 族,參 #287 segment cache 碰撞前科)、刪除/加入 action 後角標未 revalidate。⚠️ 正式站 main 落後 dev 755+ 顆,診斷時必須對 **main 的部署版** code 查(version-fingerprint 紀律),不可拿 dev 工作樹推論。
- **不修會痛在哪**:客人看到的數量與實際不符 ⇒ 對「我到底買了什麼」失去信任;若角標進一步被別處引用(徽章、提示)會擴散假數。
- **排程**:待派(D 或 E 手上片收完後);診斷片=唯讀先行,修法照片型分級。
- **編號註**:立案當下最大=#374(grep repo 0 命中、信箱 0 命中)。
- **08-10 晚診斷結案(S-003,主視窗裁)**:根因=角標數 localStorage 原始行(`CartContext.tsx:298-301` 零過濾)、購物車/結帳頁數 `found:true` 行(`useResolvedCart.tsx:105-113` 過濾)⇒ 幽靈行(`cart/actions.ts:127/:151/:174` 三來源)畫面看不到刪不掉、角標永遠多算=**與 #455(購物車 `found:false` 幽靈行清不掉)同一顆 bug**。修法裁 **B=resolve 成功後自動移除明確 `found:false` 的行**(A 遮症狀不修 #455 否決;C 顯示+手動移除=之後可補)。🔴 **硬約束=`.catch()` 分支一行都不准刪**(`useResolvedCart.tsx:88-91` action 失敗會讓整車形同幽靈,誤刪=網路抖動清空客人購物車);驗收硬條件=負向測試「reject ⇒ 一筆不少」+突變靶。片型=標準片、①擦邊從嚴:code-reviewer+codex 窄化雙審。S 窗施工。
- **✅ 已修(08-10 `999ebb54`,S 窗)**:審查鏈=code-reviewer R1 1MF4nit+codex R2 2MF(跨實例競態 healSeq 守衛/折 R1 補 fixture 掏空另一半=補 BARE_GHOST 格)全折;突變 7 靶×7 格 kill-set 逐格量測;主視窗親驗四錨+marker;收割 root 431 檔 6733 綠。**待推送+Sean 肉眼驗**(購物車頁停一下、角標自回正)。「付不了款」窄版字面=只對 `:174` 類成立、另兩類 server 拒未查證(→ #377 查證步涵蓋)。

### #376. ✅ 已完成(2026-08-13,B 窗)backlog 撞號重編號:#308/#342/#343 三組全解,本檔零撞號

- **狀態:** ✅ **已完成**。改號對照表(權威版同步寫在**本檔檔頭**):

  | 原撞號 | 保留原號(標題關鍵字) | 改號(標題關鍵字) | 新號 |
  |---|---|---|---|
  | `#308` | 品牌頁 band logo 的 alt 與 h1 重複 | 採購表單的供應商選單沒有 typeahead | **#453** |
  | `#341` | `products-url-state.tsx` 479 行拆檔 | W 線靶族零靶欠款 | **#420**(2026-08-11 先行解決,非本片) |
  | `#342` | 卡片快速加購「只會導頁、不能直接加」 | 冪等層「部分接線」維度全線零覆蓋 | **#454** |
  | `#343` | `customer_addresses` 可被客人直接寫入 | 購物車 `found:false` 幽靈行清不掉 | **#455** |

- **保留/改號的判準**:不是「哪條比較重要」,而是「**哪一條的引用面動不得**」——`#308` a11y 那條有 7 處 `.tsx`/`.test.tsx` 引用(含 2 個測試名;數法=`grep -rn --include='*.tsx' -E '#308([^0-9a-z]|$)' apps packages | wc -l`,2026-08-13 實測 7)+ #309-#312 同族交叉網;`#342` 加購鈕那條有 `ProductCard.tsx` 引用 + `docs/handoff/CURRENT.md` 未結拍板;`#343` DB 那條被**已 apply 的 migration** `20260809004000_m4b_line3ds_address_email.sql` 引用,**已跑過的 migration 不得竄改**(既存裁決見 `docs/specs/2026-08-10-352-receipt-recording-plan-v3.md`,本片沿用未推翻)。`#342` 的改號方向也與 08-11 解 `#341` 時一致(同樣是 W 線那條讓號)。
- **來源**:S 窗 backlog 全掃(381 條親數、89 條開內文)抓到四組同號異文;主視窗複驗屬實,且 STATUS 08-04 曾有第三個 #308(設計稿瑕疵,已結案)=同號被回收三次。
- **實際改動面**:18 個**行級**精準改號(不用全域 sed —— 同一個 `#343` 在不同行指不同條目,全域替換必錯),橫跨 `PROGRESS.md` / `docs/handoff/` / `docs/reviews/` / `docs/specs/` ×2 / `docs/design-storefront-manifest.yaml` / `useResolvedCart.tsx` / `useResolvedCart.test.tsx` / 本檔。歷史檔沿用 08-11 `#420〔原 #341〕` 的標註格式;程式碼註解直接換號不加噪音。
- **不回改的範圍(誠實邊界)**:①`~/pcm-mailbox/` 已送出的信件(10+ 檔)——通訊紀錄不竄改,與「不改已 apply 的 migration」同一條立場;②`docs/archive/`(規則明令不動)。⇒ 🔴 **引用舊信件時要「對照本表讀」,不要假設信裡的號還有效** —— 2026-08-13 之前的信寫 `#308`/`#342`/`#343`,有一半指的是已改號的那條。
- **止血已升級為長效**:檔頭改成對照表 + **釘標題關鍵字、拔掉全部行號**(原本釘的六個行號到 08-13 已全數過期,是實錘);`#220`/`#220b`/`#220c` 的量具坑警告保留。
- **編號註**:改號當下實查最大=#452,本片用掉 #453/#454/#455,收尾另立 #456 ⇒ **下一個可用號 = #457**。
- **本片衍生**:見 **#456**(釘死 backlog 行號的 22 處引用)—— 同一種「指標指到別的東西」的病,本片只殺了編號那一半。

### #456. 📌 全樹 22 處把 `phase-1-backlog.md` 的**行號**釘死在程式碼/文件裡,抽驗三發全爛

- **來源**:2026-08-13 #376 撞號重編號片的零殘留複掃順帶挖到(B 窗)。主視窗 Q1 裁 A 准立案。
- **現況(實測,非推論)**:
  - 數法與數字:`grep -rho --exclude-dir=.git 'phase-1-backlog\.md:[0-9]' . | wc -l` ⇒ **22 處**;`grep -rl` ⇒ **17 個檔**,其中 **5 個是 `.ts`/`.tsx`**(`apps/admin/src/components/ui/sidebar.tsx`、`apps/admin/src/lib/layout/workspace-panel.ts`、`apps/storefront/src/app/brands/[slug]/page.test.tsx`、`apps/storefront/src/components/brand/BrandPageRoot.tsx` 與 `BrandPageRoot.test.tsx`),其餘在 `docs/specs/` ×10、`docs/handoff/` ×2。
  - **抽驗三發、三發全爛**(2026-08-13 實測,`sed -n 'Np'` 讀該行對照宣稱):
    | 釘的行號 | 宣稱指向 | 實際該行內容 |
    |---|---|---|
    | `:8125` | band logo alt 與 h1 重複 | `- **問題:**`(不相干) |
    | `:8403` | 「`.bp-page` scope 上機制」那條前置 | 突變 4 個全轉紅的驗證紀錄(不相干) |
    | `:9406` | Sean 2026-08-09 逐字 | 「分辨 props 沒 commit 與舊 handler 仍綁」(不相干) |
  - ⇒ 這**不是「可能會漂」,是已經爛了**。本檔 2026-08-13 為 12,000+ 行且每片都在長,任何釘死的行號都會過期。
- **要做什麼**:把這 22 處的 `phase-1-backlog.md:NNNN` 換成 **`#編號` + 標題關鍵字**(本檔檔頭已立此紀律)。逐處要**開原始檔核對它當初想指的是哪一條**,不能照行號機械換 —— 行號已經爛了,照爛值換只會把錯誤固化。
- **不修未來會痛在哪**:每一處都是**指向錯誤內容的權威引用**。`.ts`/`.tsx` 那 5 處尤其毒 —— 它們寫在「真權威 = …」「前置 = …」的句型裡,下一個改那支元件的人會照著行號去讀、讀到不相干的段落,然後**以為自己找到了契約**。#376 殺的是「同一個編號指兩條」,這條是「同一個指標指到別的東西」,同一種病的另一半。
- **排程**:純文字片(但動到 5 個 `.ts`/`.tsx` 註解 ⇒ **要跑三綠、不是純 docs 片**);不擋任何施工線。

### #377. 🛒 無變體商品「快速加購」後結不了帳:client 閘擋所有無 variantId 的行(375-B 審查線揭出,主視窗親驗立案)

- **來源**:#375-B code-reviewer 範圍外發現;主視窗親驗兩端字面:`useChargePayment.tsx:139-144` 對 raw items 逐筆 `if (!it.variantId)` ⇒ 整張單擋下+「缺少規格資訊,請返回購物車重新確認」;`ProductCard.tsx:262` 對 `variantCount === 0` 商品**刻意不帶 variantId**(檔頭註解明文=契約退回 productId key)。兩端各自有理、合起來=快速加購的無變體商品**永遠過不了結帳閘**。
- **⚠️ 未確認兩件**:①正式庫是否存在 `variantCount === 0` 的真商品(RPC 面 variantCount=undefined 會導頁、不落此路);②PDP 無變體路徑(`ProductPage.tsx:139` `selectedVariant?.id`)是否同樣落 undefined=同一顆閘——若是,則無變體商品**任何入口**都買不到,嚴重度升級。查證=下手前第一步。
- **修法方向(未拍)**:A=charge payload 支援 productId-only 行(動 server schema=鐵則 12 面)/B=無變體商品在 resolve/加購時補真變體 id(若 DB 層每商品必有至少一列 variant)/C=快速加購對無變體也導頁(最小但把 08-08 接線的價值砍半)。
- **不修會痛在哪**:客人快速加購後在結帳頁被神祕訊息擋死、回購物車又看不出哪裡有問題=棄單;且與 #375 幽靈行症狀同文案、值班會誤歸因。
- **排程**:S 窗 #375-B 收工後接查證步;修片待查證後拍。
- **編號註**:立案當下最大=#376(grep repo+信箱 #377 兩邊 0 命中)。

### #378. 📝 錯誤不隨輸入清除:auth 四張已修、同形狀還有三張表單(S 窗片 #5 審查 nit-8 立案)

- **來源**:S 窗 auth 錯誤清除片(S-008)code-reviewer nit-8;同一個 08-08 掃測 B 級 bug 的完整面=7 張表單,本片只修 auth 四張。
- **剩餘三張**:`account/InlineAddressForm.tsx:132`、`account/InlineVehicleForm.tsx:263`、`account/tabs/ProfileTab.tsx:105`(同形狀:local state、錯誤只在下次送出更新)。
- **要做什麼**:比照 auth 片的三條行為判準(逐欄清/頂部 formError 一律清/checkbox 看有無自己的 fieldError)各自加 clearErr;每欄配突變靶。
- **不修會痛在哪**:掃測結論會被誤讀成「錯誤清除已修好」而實際只修 4/7;會員中心是高頻頁。
- **排程**:S 窗前台佇列;輕量-標準之間照片型定義逐字判(account 非 auth、單檔可拆=可逐張輕量片)。
- **編號註**:立案當下最大=#377(grep repo+信箱 #378 兩邊 0 命中)。

### #379. 🎨 admin 訂單明細視窗切換體感不佳(Sean 2026-08-10 深夜正式站肉眼驗回饋)

- **來源**:Sean 驗熱修時回饋「訂單明細 OK,唯獨視窗切換體感不好」。體感=品味題 ⇒ **交前端設計 skill(Claude Design)出方案**,Claude Code 只把題轉需求(分工照 CLAUDE.md)。
- **要做什麼**:先由施工窗把「切換」的具體路徑釘清楚(列表→明細面板?分頁切換?)+ 現況行為錄影/描述 → 轉 Design 需求 → Sean 挑 → 照做。
- **排程**:D 線 a2 後或 E 線佇列;需求文先行。
- **編號註**:立案當下最大=#378(grep repo+信箱兩邊 0 命中)。

### #380. 🔧 admin 側欄收合改 offcanvas(整條收起)—— **已改、待 Sean 肉眼驗**,2026-08-11 E 窗

- **來源**:Sean 實測「側邊欄位原本可隱藏按鈕現在不見,請補回」。
- 🔴 **立案字面是錯的,真相如下(S-010 唯讀診斷 + Sean 對症狀的回報,經主視窗轉述)**:
  **那顆鈕從來沒有消失過,也沒有被 CSS 蓋掉**。`git log -S "SidebarTrigger" -- apps/admin/src`
  只吐後台骨架那一顆 commit ⇒ 加進去之後從沒被刪、沒被改寫。Sean 按得到它,
  問題是**按下去只收成一條 3rem 的窄圖示列**(`collapsible='icon'`),他要的是**整條收起**
  (Sean 逐字:「鈕在、按了只收成窄圖示條」)。
  ⇒ 這不是「補回按鈕」型的 bug,是**收合模式選錯**。原本寫的兩個假設(刪了 / CSS 蓋掉)都不成立。
- **做了什麼**:`components/layout/app-sidebar.tsx` 的 `<Sidebar collapsible>` 由 `'icon'` 改
  `'offcanvas'` ⇒ gap 收成 `w-0`、面板整條滑出畫面左側,內容區拿回整整 9rem。**一個字**。
  收起後仍開得回來:`SidebarTrigger` 住在 `layout/header.tsx`、header 在 `<SidebarInset>` 內
  = 側欄的兄弟節點,不在被收起的那棵子樹裡。
- **守門**:`app-sidebar.test.ts` 的 `#380` 兩格(模式字面 + 「重新展開入口不得搬進側欄子樹」),
  四條突變各紅一格。⚠️ 文字層斷言,**收合動畫 / 內容區真的變寬 / 鈕沒被蓋住三條只有肉眼驗算數**。
- **順帶更正**:同檔「圖示態寬度不變(⌘B 收合仍是既有行為)」那格的理由被本片弄過期,
  已同步改寫 —— 圖示態在後台已走不到,那顆常數只剩 fork 元件的通用能力。
- **編號註**:立案當下最大=#379(同 commit 立案,序在其後)。

### #385. 🚪 `/dev-preview/*` 內部預覽頁在正式站**沒有任何 gate**、公開可達

- **狀態:** ✅ **已修(2026-08-11 E 窗,A 案的 layout 版)** —— 新增
  `apps/storefront/src/app/dev-preview/layout.tsx`:巢狀 layout 包住整個 segment(今天 8 區 + 以後新增的
  自動繼承),正式環境 `notFound()`。**沒動 `middleware.ts` / `next.config` / `vercel.json`**(不落鐵則 12④)。
  **仍待 Sean 肉眼驗**:正式站開 `https://shop.pcmmotorsports.com/dev-preview/brands` 應為 404。
  - **判準 fail-closed**:`VERCEL_ENV` 有值 ⇒ 只有 `preview`/`development` 白名單放行(未知值一律關);
    讀不到 ⇒ 退看 `NODE_ENV`,production build 一律關。⇒ **任何「讀不到系統變數」的情況都倒向 404**,
    不會出現「以為擋住其實沒擋」。守門 6 格 + 突變三靶(fallback 改放行 / 白名單改黑名單 / 拿掉
    `notFound()`)實跑**各只紅自己那一格**。
  - ⚠️ **preview 會不會被連坐 = 未確認**:量到 `/dev-preview/*` 在加 layout **之前就是** `ƒ`(dynamic,
    移開本檔重跑 build 對照過)⇒ 理論上讀 runtime env、preview 正常;但若 Next 在 build 期固定該值,
    Turborepo 2 預設 Strict env mode 會濾掉 `VERCEL_ENV`(不在 `turbo.json` build `env` 清單)⇒ preview 也 404。
    **兩條路的正式站結果都是 404**,差別只在 preview。要讓 preview 一定回得來 = `turbo.json` 的
    `build.env` 加一筆 `"VERCEL_ENV"`(平台設定、本片刻意不動,判準不必跟著改)。**第一次 preview 部署當場揭曉。**
  - 🔴 **本閘擋不住**:fixtures 裡的字面仍在 git 與 JS bundle 內 ⇒ 下面 C 案(fixtures 檔頭寫明「視同公開」)
    **不因本片作廢**,兩者不互斥;也擋不住已被抓走的舊快照。
- **優先級:** 🟡 低(**現況**無敏感內容);🔴 **但失效條件明確,見下** —— 這條的價值在防未來,不在修現在。
- **現況(實測,不是推論)**:
  - `curl` 等效實測 `https://shop.pcmmotorsports.com/dev-preview/brands` → **真的回內容**
    (品牌展示索引、11 個品牌與分類群數),**不是 404**。
  - 程式面零 gate:`apps/storefront` **沒有 `middleware.ts`**;`dev-preview/brands/[slug]/page.tsx` 與
    `brand-page/[slug]/page.tsx` 的 `notFound()` 只擋**未知 slug**,不擋環境;
    `next.config.ts` / `vercel.json` 對 `/dev-preview` 零設定。
  - 目錄下共 8 個預覽區:`brands` / `brand-page` / `filter-drawer` / `filter-side` / `filter-top` /
    `mobile-catalog-ux` / `sound-clips` / `_components`。
- **✅ 已經有的那一半防護(不要重複做)**:`/dev-preview` **已在 robots disallow 清單**
  (`apps/storefront/src/lib/seo.ts` 的 `CRAWLER_DISALLOW_PATHS`)⇒ 不會被搜尋引擎索引。
  所以這**不是** SEO / 曝光問題,是「知道網址就進得去」。
- 🔴 **失效條件(什麼時候這條會從低變高)**:今天 fixture 裡的品牌(lightech / k-speed / extreme)
  都**已經上線**,所以沒有洩漏。但**沒有任何機制**擋住下一個人把「還沒上架的品牌 / 還沒拍板的價格 /
  內部命名」寫進 `dev-preview/*/fixtures.ts` —— 那一刻它就是對外公開的。
  ⇒ 要嘛加 gate,要嘛在 fixtures 檔頭寫死「這裡的內容等同公開」。
- **預期解法(未拍)**:A=`middleware.ts` 對 `/dev-preview` 在 production 回 404(最小、一處守門)/
  B=改用 Vercel preview-only 部署或密碼保護 / C=不加 gate,只在每個 fixtures 檔頭與 PR 模板寫明
  「本目錄內容視同公開,不得放未上架資料」。
- **不修會痛在哪**:可追蹤性 —— 半成品 UI 掛在客人網域上,客服或客人偶然拿到連結時沒人知道那是什麼;
  且「內部頁」這個心智模型是錯的,會讓人放心把不該公開的東西放進去。
- **順帶(不值得單開一條)**:`dev-preview/brands/fixtures.ts` 還留一個 `http://` 圖片網址
  (lightech 舊 host)⇒ 該預覽頁在 https 下那張圖是破的。#275 收官後它是全 repo 最後一個 `http://` 圖。
- **編號註**:立案當下最大=#380;#381-#384 已被其他窗在信箱佔號(backlog 尚未落條目)⇒ 取 #385;
  `grep` repo 與信箱兩邊對 #385 皆 0 命中。

### #386. 📥 到貨被額度擋下時,畫面要把員工導到「溢收」—— DB 出口已存在,UI 沒接

- **狀態:** ⏳ 待執行(2026-08-11 D 窗立案;#352 甲片 commit `772ecaeb` 當下就知道的具名缺口,非事後發現)
- **優先級:** 🟡 中 —— 不擋 #352 上線(擋下來本身是對的、資料不會壞),但它是**員工撞牆後沒有下一步**的那一格。
- **現象**:訂單品項被取消後供應商仍出貨 ⇒ `admin_record_item_receipt` 回
  `EXCEEDS_ROOM_AFTER_CANCELLATION`(`supabase/migrations/20260811010000_..._item_level_room_guard.sql:254`)。
  這是 Sean Q9=A 拍板的正確行為。**問題不在擋,在擋完之後畫面沒說要做什麼。**
- ✅ **DB 層的出口已經有了(先讀這條,別把本條做成「新增一條路」)**:
  用「到貨 0 件 / 溢收 N 件」登記即可 —— a1 `20260810230000:82` 逐字:
  「訂單已收滿之後才到的貨 = `quantity=0 / surplus=N`」;
  兩道額度守門(採購列層 `:193`、品項層 `:245`)**都只看 `p_quantity`、不看 surplus**
  ⇒ 到貨填 0 就通得過,輸入驗證也允許(`:106-110`,兩者和 ≥1 即可)。
  ⇒ **本條 = UI 接線 + 文案**,不是新 migration、不是新 RPC。
- 🔴 **不要提供的繞路**(反面規格,寫在這裡免得下一個人「順手」做出來):
  改小取消數量 / 改大訂購量 / 另開一筆採購列硬塞。額度是**品項層**的(同檔 `:231-241`),
  換採購列一樣被擋;而動取消數量會讓客人的取消紀錄與退款對不上。
- **預期解法(未拍,給 Sean 挑)**:
  A=最小解 —— 被擋時訊息直接寫「請把到貨件數改成 0、把多的填進溢收」,員工手動改欄位;
  B=訊息旁一顆「改記為溢收」按鈕,自動把到貨歸 0、溢收帶入差額,員工只需確認;
  C=表單層預防 —— 開窗時就算出剩餘可登錄額度並顯示,超過時即時把差額移到溢收欄(不等 RPC 回錯)。
- **與 #374 的分界**(別把兩條做成同一條):**#386** 讓那批貨**記得進來**(帳查得到);
  **#374** 讓它**變成可以賣的庫存**(獨立庫存、要跟報價單 `pcm-quote-v2` 整合)= Phase 2、藍圖層。
  在 #374 之前,溢收紀錄只是查得到的帳、不加進可出量(Sean Q1=A 已知情)。
- **不修會痛在哪**:可追蹤性 —— 出口存在但沒人找得到,員工會退回「記在紙上」,
  於是貨進了倉庫而系統零紀錄;更糟的是有人會去動取消數量來讓數字「過得去」,那會污染退款對帳。
- **連動**:值班處置寫在 `docs/runbooks/order-receipt-recording-duty.md` §1 ——
  本條做完要回頭把「員工自己改欄位」那段改成實際做出來的形狀。
- **編號註**:號由主視窗在 D-468 議定時發放(信箱 `D-468-STOP` §D、`REV-352c-opus` 有引用),
  backlog 條目一直沒落 ⇒ 本次補;立案前 `grep` repo 與信箱兩邊確認 #386 無其他佔用。
- 🔴 **立案過程的更正紀錄**(留著,因為它是本條最容易被重犯的錯):本條初稿寫的是
  「系統裡根本沒有地方收這批貨、員工只能記在系統外」—— **假的**。
  病根 = 拿手上現成的東西(擋下來的那條守門)判斷可能性,沒去讀旁邊 a1 的欄位語意;
  是 `p_surplus_quantity` 這個參數的存在把它戳破的。寫「沒有路」之前先讀鄰居的實作。

### #387. 🗣️ 取消區「刷卡還在進行中」文案對已成功付款的單說謊(誤導值班)
- **現象**(2026-08-11 Sean 實測):已付款單(attempt=charged)在後台取消區看到「這張單有一筆刷卡還在
  進行中,等結束才能取消」——付款早已成功,不存在「進行中」。
- **根因**(實讀):`packages/adapters/src/supabase/mappers/order.ts` `mapChargeAttemptGate` 把
  「任何非 failed」的 attempt 一律判 `blocked`,charged(成功終態)與 pending(真在途)同碼;
  `cancel-review-section.tsx` 的 `charge_attempt_blocked` 文案只寫了 pending 那種語意。
- **擋人是對的**(已付款單本就不可在此取消=payment_not_unpaid 那條),錯的只有理由文案 ⇒ 純可讀性。
- **狀態:** ✅ **已修(B 案,2026-08-11 E 窗)** —— `cancel-view.ts` 的 `charge_attempt_blocked`
  收窄成只在 `paymentStatus === 'unpaid'` 時發出;已付款單只剩「這期還不能在這裡取消」那一句。
  **仍待 Sean 肉眼驗**(進任一張已付款單的取消區,確認看不到「還在進行中」)。
  - **抑制的是碼、不是實質**:抑制條件與 `payment_not_unpaid` 的觸發條件**互補**,兩者恆有一條在擋
    ⇒ `canCancel` 不變;守門逐條在 `cancel-view.test.ts` / `cancel-review-section.test.tsx`,
    突變三靶實跑皆紅(拿掉 `&& unpaid` / 刪整條 push / 拿掉 `payment_not_unpaid` 那行)。
  - **順帶換掉一格的 fixture**:`cancel-review-section.test.tsx` 那格「逐條都畫出來」原本用
    `paid + blocked` 湊三碼,收窄後只剩兩碼 ⇒ 改用 `paid + unknown + truncated`,本格原本要守的事不變。
- 🔴 **根治(A 案)未做,且它有明確的失效條件觸發點**:gate 仍把 `charged` 與 `pending` 併成一碼。
  今天無害是因為「已付款單上再開一筆真 pending 扣款」不可達;**L5b 重新付款線一旦讓它可達,
  B 案就會把那筆真在途一起藏掉** ⇒ 屆時要走 A 案(gate 拆四態,動 `packages/adapters` 共用 mapper、另片另審)。
  失效條件同字面寫在 `cancel-view.ts` 該行的註解裡,不只留在本條目。
- **不修會痛在哪**:員工看到「進行中」會去等/重新整理/懷疑系統,永遠等不到變化;第一次遇到的人會當成故障回報。

### #388. 🍪 actor cookie 欄名為裸字面(兩處)— 打錯字=靜默不寫 cookie、typecheck 與測試全盲
- **來源**:#365 片③ 審查 nit-7(2026-08-11);E 刻意不順手修(動第三檔、離題)。
- **形狀**:`actorId` 欄名字面散落兩處,無共用常數;typo 症狀=cookie 靜默未寫、無任何紅燈。
- **修法**:抽單一常數+兩處引用;順手一格「錯欄名必失敗」負測。體積=輕量片。
- **不修會痛在哪**:未來重構誰動到那兩個字面,後台操作者身分追蹤斷線且無聲(audit actor 來源)。

### #389. 🚗 車輛下拉的正解:`vehicle_taxonomy_public` 改 materialized view(#277 B1 的技術債)

- **狀態:** ⏳ 待執行(2026-08-11 隨 #277 B1 一起立案;B1 是取捨、本條是正解)
- **優先級:** 🟠 中(B1 已讓 198 台熱門車看得到;本條修的是 B1 付出的那個代價)
- **背景**:#277 的 view 為了避開 anon 逾時,**刻意不排除下架商品的車款**
  (`security_invoker = false` + 不 join `products`)。實測數字:

  ```text
  DISTINCT + EXISTS(母商品未下架)   3,047 ms   ❌ 超過 anon 的 statement_timeout = 3s
  DISTINCT 四欄、不看下架             52 ms     ✅(走 ix_pfe_lookup 的 Index Only Scan)
  ```

  代價 = 會出現「下拉選得到、點進去 0 結果」的**幽靈項**;2026-08-11 四欄實測 **37 組**(13,133 vs 13,096,0.28%),
  其中僅 1 組是整個車型、其餘 36 組是**車型還在、但某個年份區間空手**。
  🔴 **這個數字被更正過**:第一版用兩欄 `(moto_brand, model_code)` 對帳報成「1 組」,
  粒度與 view 的四欄唯一性不一致 ⇒ 漏掉幽靈年份區間;由 codex 對抗審查抓出、實查更正為 37。
  **B1 的取捨是在「1」這個錯數字上拍的,已回報主視窗重新確認。**
- 🔴 **失效條件(這條就是為它而立)**:那個 37 是**時點觀察**。大量下架(換供應商、清目錄)時
  幽靈數會跟著長,而症狀是**客人選得到、結果 0 筆 —— 客人看得到、系統不會叫、測試不會紅**。
  對帳查詢(**四欄版**)寫在 `supabase/migrations/20260811020000_…_vehicle_taxonomy_effective_view.sql` §3,
  任何人都可以跑;數字明顯變大就該把本條排上來。
- **預期解法**:把該 view 改成 **materialized view**,內容是**正確的 join 版**(排除下架)。
  讀取近乎零成本 ⇒ 正確與速度同時拿到,代價是 refresh。
- 🎁 **refresh 掛點是現成的**(2026-08-11 查 `lib/products.ts` 檔頭發現,省下一輪偵察):
  報價單側已有**台灣 11:30 的 `sync_storefront_fitments`** 每日寫網站庫 `product_fitments_effective`
  ⇒ 那就是天然的 `REFRESH MATERIALIZED VIEW` 位置。
- ⚠️ **歸屬跨 repo**:寫入方在報價單(PCM_Quote)的 ingest 鏈,不在本 repo
  ⇒ 開工前要先跟那側對齊誰負責 refresh、失敗了誰會知道(refresh 靜默失敗 = 清單凍在舊資料)。
- **不修會痛在哪**:可追蹤性 —— 幽靈車型的症狀對客人可見、對系統不可見,只有人工跑對帳查詢才看得到;
  拖越久、目錄異動越多,那個數字就越可能已經不是 1 了而沒人知道。
- **編號註**:立案當下最大=#387;#388 由主視窗保留、#389 由主視窗核發給本條
  (repo 內 `#389` grep 0 命中)。

### #390. 🏷️ 「特價」功能 —— 入口已移除,等商品編輯後台能設優惠價才做

- 🔴 **落地時走 `orders.discount_total`,不是改 `unit_price` —— 動手前先讀 `#513`**
  (Sean 2026-08-15 拍;那個決定目前唯一的載體是一句對話,`#513` 記著它與依據)。
- **狀態:** ⏳ 待前置(**硬前置 = 商品編輯後台**;前置沒到之前不排)
- **優先級:** 🟡 低(不是壞掉,是**還沒有這個東西**)
- 🔴 **Sean 2026-08-11 逐字**:**特價這個概念還不存在** —— 要等商品編輯後台能設優惠價才有。
  據此拍板:**把特價入口從前台全部拿掉**,不要留一顆按了沒反應的鈕。
- **當時的實況(#269-a 移除前)**:那些連結指 `/products?filter=sale`,而 `filter` 這個 query key
  **全站零個地方在讀**(`lib/catalog-query.ts` 的 `parseCatalogQuery` 只認
  page/per/sort/pbrand/category/pmin/pmax/price/vehicle)⇒ 客人按下去拿到**未篩選的全目錄**,
  畫面上沒有任何跡象說它沒生效。而「特價」那顆在**全站每一頁**的導覽與頁尾都有。
  ⚠️ `HomeFooter.tsx:11` 的註解**早就寫著**「🔴 `?filter=` 全站未接、backlog」——
  那句話躺在那裡沒有變成行動,客人照樣每天看得到。
- **#269-a 移除了什麼(要恢復就照這張清單反著做)**:
  - `Header.tsx` navItems 的 `{ id: 'sale', … , sale: true }` 一列
    (桌機導覽 + `MobileMenu` 共用同一份 props ⇒ 一處改、兩處消失)
  - `HomeFooter.tsx` 的「特價專區」連結
  - `ProductBreadcrumb.tsx` 的 `from === 'sale'` 分支
  - 🔴 **`lib/sort-options.ts` 的 `{ value: 'sale', label: '折扣優先' }`**
    —— 這條**不在 Sean 原本看過的清單裡**,是折 code-reviewer findings 時發現的:
    它同樣不在 `CATALOG_SORT_VALUES` 白名單 ⇒ 客人在**桌機商品頁排序下拉與手機排序面板**
    選「折扣優先」,排序完全沒變、靜默回退成 recommend = 與特價鈕**同型的假入口**。
    主視窗 2026-08-11 裁「一併拿掉,留它=修一半」;**晨報追認行已標「超出原清單、同原則延伸,可否決」**。
  - 測試三處:`Header.test.tsx` 兩張導覽對照表(**留成註解行**,恢復者必先讀到前提)、
    `HomeFooter.test.tsx` 購物欄、`ProductPage.test.tsx` 的 `from=sale` 那一格
- ✅ **刻意保留、不要重做的**:`sale?: boolean` → `pcm-nav-sale` / `is-sale` 樣式鉤子還在
  (`Header.tsx` 已把該欄位**寫進型別**而非靠某一列推導 —— 移除唯一帶 `sale: true` 的那列之後
  TS 就推不到它、`item.sale` 會編譯失敗)。⇒ 恢復時加回 navItems 那一行即可,不必重接樣式。
  🔴 **這句話一度是假的,記在這裡**:第一版我寫「`MobileMenu.test.tsx` 的 fixture 仍帶一列 sale
  ⇒ 鉤子仍有測試覆蓋」—— code-reviewer 實查打回:全 repo 對 `is-sale` / `pcm-nav-sale` 的斷言
  當時**只剩**「沒有任何項掛 is-sale」那個 `toEqual([])`,也就是**把 `className={item.sale ? …}`
  整段刪掉,6876 案照樣全綠** ⇒「不必重接樣式」這個承諾當時無人守。
  已在 `MobileMenu.test.tsx` 補一格(用既有 `REAL_NAV` fixture + 反面斷言),突變「拿掉那個三元」只紅它。
  ⚠️ 教訓:**「保留鉤子」與「鉤子有守門」是兩件事**;保留而沒守門的東西,下一次清理會被當死碼刪掉,
  而且刪掉零成本、零紅燈。
  另 `Header.test.tsx` 有一格釘「目前沒有任何選單項掛 is-sale」——**偷偷加回入口會讓它轉紅**,
  逼恢復的人回來讀這條目與 OD 驗收 #4 原本要求什麼。
- **不修會痛在哪**:這條的價值不在「修」,在**記住為什麼拿掉**。沒有它,下一個看到
  「頁尾少一條連結」的人會當成回歸把它加回去,於是客人又拿到一顆按了沒反應的鈕。
- **編號註**:立案當下最大=#389(同 commit 立案,序在其後);repo 與信箱對 `#390` 皆 0 命中。

### #391. ✅ 排序清單對帳守門:UI 的 `SORT_OPTIONS` × server 的 `CATALOG_SORT_VALUES`

- **狀態:** ✅ 完成(2026-08-11;主視窗指派、輕量片)
- **問題(#269-a 實錘)**:兩份清單之間**沒有任何守門在比對** ——
  `SORT_OPTIONS`(UI 下拉顯示什麼)與 `CATALOG_SORT_VALUES`(`parseCatalogQuery` 認什麼)。
  列在 UI、卻不在白名單裡的值會被**靜默回退成 `recommend`** ⇒ **客人選了那個排序,畫面完全沒變、
  也沒有任何錯誤訊息**。發現當下五個選項裡**有兩個**是這種假的:
  `sale`(折扣優先,已於 #269-a 移除)、`new`(最新上架,等 #269-b 做成真的)。
  ⚠️ `sort-options.ts` 檔頭原本就有一段「兩處各寫一份清單會出事」的警語 —— 但那講的是
  **手機面板 vs 桌機下拉**兩份 UI 清單,**不是** UI 對 server 這一組。**警語存在 ≠ 這個面被守著。**
- **做了什麼**:`lib/catalog-query.test.ts` 加三格 ——
  1. 每個 UI 選項要嘛在 server 白名單、要嘛在**顯式登記**的「已知是假的」清單裡;
  2. 🔴 **反向**:登記清單不得殘留 —— 登記的值必須真的不在白名單裡
     (#269-b 把 `new` 做成真的之後,**這個集合要歸零**,否則這一格會紅、逼人回來清);
  3. 前提:兩份清單都非空(空集合會讓上面兩條變恆真)。
- **突變(三靶全部實跑量到)**:①新增一個沒登記的假選項 → 紅第 1 格
  ②把 `new` 加進白名單卻忘了從登記清單移除 → 紅第 2 格
  ③把登記清單放寬成「什麼都算已登記」→ **仍紅第 2 格**(反向那條同時擋住逃生清單被濫用)。
- **設計取捨**:這一格**不禁止**「暫時是假的」選項 —— 先放 UI、後補 server 是正當做法(`new` 正是如此)。
  它要求的是:**假的必須被顯式登記**,不能只是「剛好沒人發現」。
- **不修會痛在哪**:這類 bug 不會 crash、不會紅、客人也不會回報(他只覺得「這網站排序怪怪的」)——
  唯一能抓到它的就是把兩份清單放在同一個斷言裡。
- **編號註**:立案當下最大=#390(同 commit)。
- 🔴 **一條我自己寫錯、事後更正的話(留著當教訓,不刪)**:
  本條目第一版寫「主視窗說 backlog 已有條目,但實查 `#391` 在 repo **0 命中**」——
  **那是視角差,不是誰講錯**。主視窗確實在 `dev` 的 `1e142936` 立過存根,
  而我的分支基底 `e39864f5` **在它之前** ⇒ 我 grep 不到是必然的。
  ⇒ 我的「0 命中」在**我的分支上為真**,卻被我寫成了**全域的事實**,語氣還指向對方講錯。
  **判準**:跨分支引用 backlog(或任何 repo 內容)時,「查無」只對**你站的那顆 commit** 成立;
  要嘛先對齊基底再查,要嘛把 commit 寫進句子裡(「在 `<sha>` 上查無」)。
  收 runbook:**跨分支引用 backlog 要先講清楚在哪顆 commit 上。**

### #392. 📥 `payment_webhook_events.processed=false` 全場 7/7 —— inbox 疑似從未被消化

- **狀態:** ⏳ 待調查(2026-08-11 主視窗立案;OP4 盤點時 B 窗點名、主視窗親測)
- **優先級:** 🟡 中低(現行金流不依賴它;但欄位語意已在說謊)
- **事實(主視窗 2026-08-11 正式庫親測)**:有 `rec_trade_id` 的 7 張單,其 `payment_webhook_events` 列
  **`processed` 全=false**(含 06-23 最舊單)⇒ 若有 sweeper/consumer,它從沒動過任何一列;
  若本來就沒有消化者,`processed` 是死欄。兩種都成立不了「processed=已處理」的字面。
- **不修未來會痛在哪**:①未來任何人拿 `processed` 當「已對帳/已處理」訊號會**恆假**(欄位字面≠事實);
  ②若 sweeper 該存在而壞了,inbox 積壓無人察覺,webhook 側的異常(如金額不符)永遠不會浮上來;
  ③OP4 已把「webhook amount 相符」寫進回填前提 —— 這個佐證面的健康度沒有任何守門在看。
- **下一步**:查 repo 有無 webhook 消化路徑(grep `processed` 寫入面);有=修或補監控,無=把欄位語意
  改註解為「保留欄、現無消化者」或排消化片。B 窗刻意不診斷(非其片),立案即止。

- **調查結論(2026-08-11 E 窗 #392 調查段,C 案;主視窗補實測)**:消化鏈完整且已上庫
  (pg_cron `pcm-settle-sweep` 每 2 分 → `/api/cron/settle-sweep` → `sweepSettlements` → `mark_webhook_processed`),
  卡在 route `:105` 的 `CRON_SWEEPER_ENABLED` gate(**gate 在建 deps 之前** ⇒ 連 DB 連線都不建);
  該旗標依 S2 片 Sean Q1=A **刻意留給 S4**,而 S4 隨 M-3 S3 起暫緩 ⇒ **`processed` 全 false=休眠態、不是壞掉**。
  全樹 `SET processed` 恰 1 命中、呼叫鏈單線(E 枚舉非推測)。
- **欄位語意正確講法**:不是「已處理」,是「已被 sweeper 處理」——而 sweeper 尚未啟用;拿它當對帳訊號先看旗標。
- 🔴 **開旗標=金流動作**(主視窗 2026-08-11 正式庫實測,推論已轉事實):inbox 全表 **39 列**全部
  `processed=false / needs_manual_review=false / attempt_count=0 / next_retry_at=NULL` ⇒ **全部立即到期**,
  開啟後第一輪(2 分內)就對 39 列逐筆真打 TapPay Record API 反查、可能改 `payment_status`。
  排片時與 S4 一起看,不當「補監控」。
- **未確認兩件**:①正式站 `CRON_SWEEPER_ENABLED` 實際值(Vercel env,Sean 看一眼)②pg_cron job 現在仍 active 否
  (`cron.job_run_details`;不影響結論——旗標關著時皆 no-op)。

### #393. 📄 型錄分頁用 `OFFSET` 沒有跨請求快照 + `total` 在超尾頁會回 0

- **狀態:** 🔶 **2026-08-11 Sean 拍 A:只修第 2 條(total),第 1 條(OFFSET 快照)不修**
  - **第 2 條 = ✅ 完成**(app 層輕量片):把 `filter=new` 已有的探查解推廣到一般型錄路徑。
    守門 = `products-new-arrivals.test.ts` 的 `#393-A` describe(3 格,3 個突變逐格驗過)。
  - **第 1 條 = ❌ 不做**,理由見下方「為什麼不改 keyset」。
  - 🔴 **偵察發現的關鍵約束(這才是 A 案被選中的真原因)**:
    **keyset 分頁與 design 的分頁 UI 不相容。**
    `design-reference/components/ProductsPage.jsx:392-462` 明文畫的是
    「顯示第 X–Y 筆,共 N 筆」+ 頁碼按鈕 `1 … [page±2] … totalPages`;
    **keyset 這兩樣都給不了**(它只有上一頁/下一頁,沒有總頁數、不能跳第 N 頁)。
    依**鐵則 1**(design 是成品、不反向遷就),改 keyset ⇒ 必須先改 design ⇒ Sean 拍板題。
  - **落選的三案與理由(留檔,免得下次重問)**:
    - **B 資料快照**(server 端短期快照 + URL 帶 token):頁碼與總數都保得住、也解決重複漏列,
      但要新做一整套快照機制 + 快取層要一起想 ⇒ 成本遠大於 🟡 低優先的收益。
    - **C 混合**(頁碼走 OFFSET、上下頁走 keyset):兩套分頁邏輯並存,
      以後每次改都要顧兩邊 ⇒ **維護債**,S 窗明確不推薦。
    - **D 改 design 成無限捲動**:keyset 就完全合用、問題根治,但那是**產品外觀改變**,
      桌機與行動版都要重畫 ⇒ 不為一個 🟡 低優先問題動 design。
  - ⚠️ **第 1 條的殘留風險照舊存在**:翻頁期間若剛好有匯入寫入,仍會重複/漏列。
    踩到要「客人正在翻頁」與「匯入正在寫入」時間重疊(匯入 = 每日 16:10 一次 + 供應商批次日,
    全歷史只有 6 天 ≥186 件)⇒ 窗很窄。**⚠️ 這是從匯入頻率推的,沒有量過真實併發。**
  - **技術面備查(若哪天要重啟第 1 條)**:必要條件**已經滿足** ——
    `20260811040000:328-332` 的 `ORDER BY` 每一支都以 `f.id ASC` 收尾、`id` 是 PK
    ⇒ 四種排序都已是**嚴格全序**(這是 keyset 最常卡住的地方,我們沒卡)。
    游標形狀:`recommend`=`(id)` / `price-asc|desc`=`(price_general, id)`+NULL 旗標 /
    `new`=`(created_at, id)`;`NULLS LAST` 要用 `(x IS NULL, x, id)` 三段式比較。
    連動面:**會撞 #287**(同樣改 URL 契約)與 **#289**(`?page=N` 深連結還原波)⇒ 不可並行。
  - 偵察與四案完整比較 = `S-037-PLAN`(信箱)。
- **立案脈絡:** **先於 #269-b 存在**,由 #269-b 的 codex R2 對抗審查掃出並立案。
- **優先級:** 🟡 低(客人看得到但不致命;要換分頁機制,不是補丁)
- **問題(兩條,同一支 RPC `search_catalog_by_vehicle`):**
  1. **OFFSET 分頁沒有跨請求快照。** 每一頁是一個獨立請求、各自的快照。翻頁期間若有新商品進來
     (或某天跨過 #269-b 的批次日門檻而整天消失),後面幾頁會**重複、漏列或整頁位移**。
     `ORDER BY created_at DESC, id ASC` 是穩定的 tie-break,但它只保證**單一快照內**的順序,
     擋不住「底下的資料集在兩次請求之間換了」。
  2. ✅ **已修(2026-08-11 A 案)** —— 原文保留供追溯:
     **`total` 只搭在回傳列上。** RPC 用 `count(*) OVER ()` 把總數黏在每一列;
     OFFSET 超過最後一頁時回 **0 列** ⇒ 呼叫端
     `apps/storefront/src/lib/products.ts` 的 `rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0`
     會把「其實還有 19,000 件商品」讀成**總數 0**,畫面變成「找不到商品」。
     手動改網址 `?page=999` 或翻頁時資料集縮水,都會踩到。
     🔴 **修法不是改 RPC**(原「修法方向」寫的是改 RPC 保證回一列;實際採用 app 層探查,
     因為 `filter=new` 已經有同形狀的解可以直接推廣、且不必動 DB)⇒ **輕量片、零 migration**。
     ⚠️ 原文引的行號 `:386` 已因後續編輯位移,故上面把行號拿掉、只留字面。
- **不修未來會痛在哪:** 這兩條都**不會 crash、不會紅、測試也抓不到**(單一快照下全部正確),
  客人只會覺得「這網站翻頁怪怪的/明明有商品卻說沒有」而默默離開,我們永遠不會收到回報。
  商品數越多、匯入越頻繁,踩到的機率越高;#269-b 的「新品」讓第 1 條更容易被看到
  (新品資料集本來就會隨匯入變動)。
- **修法方向(⚠️ 以下寫於 2026-08-11 裁定之前,當歷史讀;現行結論看最上方「狀態」):**
  - 第 1 條治本 = 改 **keyset / cursor 分頁**(以 `(created_at, id)` 為游標),不是加參數能解的。
    🔴 **2026-08-11 偵察推翻了「這是個可以直接做的修法」**:keyset 與 design 的頁碼 UI 不相容,
    要先改 design ⇒ Sean 拍 A 不做。詳見「狀態」段。
  - 第 2 條可獨立先修 = RPC 改回 `RETURNS TABLE(item, total)` 但**保證至少回一列**
    (或另開一支只回 total 的輕量 RPC),讓呼叫端不必從「有沒有列」反推總數。
- **編號註:** 立案當下 `dev`(`eb97167e`)最大 = **#392**(`payment_webhook_events` inbox),
  我的分支基底只到 #391 ⇒ 依 `dev` 取號為 **#393**,不是依自己分支。
  (這正是 #391 條目結尾那條教訓的正面套用:跨分支取號要先對齊 `dev`,否則必撞號。)

### #395. 🏷️ 「新品」批次排除改為寫入端標記(Q19=B 拍板的後半)

- **狀態:** ⏳ 待排(2026-08-11 Sean 拍 Q19=B:先上日計數版、本條為換穩定做法的債)
- **優先級:** 🟠 中(缺陷已知且已在 040000 檔頭具名;真實資料分佈 18↔186 無中間值=短期低風險)
- **問題**:#269-b 段一的批次日排除是「查詢時即時數當天可見列數 ≥100」的 heuristic ——
  邊界翻面(99↔100 反覆出現消失)、下架改變歷史判定、`created_at`=建列時間非上架時間、部分匯入曝光,
  四者同根:**用讀取時的日計數去猜寫入意圖**。
- **修法方向(S 窗 R3 議、Sean 拍 B 認可)**:在**寫入端記錄意圖**——import run 標
  `is_catalog_backfill`(或商品加 `new_arrival_eligible_at`),RPC 只讀穩定欄位;一併解決上列四症。
- **不修未來會痛在哪**:某天進貨量落在 100 邊界時,客人看到商品在新品頁反覆閃現閃退且無人察覺;
  供應商補文件式的小量回填會誤算成「新品」;heuristic 的 N 每次調整都要重找突變切點(見 040000 檔頭)。
  另(R4 Fable 觀察):**18↔186 空隙是經驗分佈不是不變量**——新供應商第一次 20-99 件的中型匯入
  會整批進新品頁(低於門檻=不被排除),客人看到的「新品」是一整批同供應商商品;**復架商品永不再現為新品**
  (created_at 不因復架更新)同屬此語意的固有結果,兩者都由寫入端標記一併解。
- **依賴**:動 schema+匯入器+RPC ⇒ 鐵則 8+12③;排片時與商品編輯後台線對時序。

### #398. 🎲 `BrandPageRoot.test.tsx`「20 家逐一驗」在並行負載下週期性逾時假紅

- **狀態:** ✅ **已修(2026-08-11 / E 窗;選「拆多格」不選「提 testTimeout」)**
  - **量測先行(條目要求的那一步,結果推翻了「誰貴」這個問法)**:
    逐家量 render 耗時 ⇒ **沒有哪一家貴**。20 家 16-26ms 均勻(節點數 443-538、內容 2251-3616 字元
    也都同一量級);唯一離群值是**第一家 85ms**,而**把陣列反轉後那 83ms 跟著跑到新的第一家**
    (`akrapovic` → `wrs`)⇒ 那是 **JIT 暖機、不是那家的成本**。
    ⚠️ 也不是 fixture:`PRODUCTS` / `ALL_SLUGS` 建在迴圈外、只建一次,迴圈內只有 render + 斷言。
  - **真正的成本結構**:四格各自 `for` 迴圈跑完 20 家 ⇒ 單格 676 / 423 / 412 / 281ms,
    合計 1792ms = 該檔 tests 時間(2060ms)的大部分。**而 `testTimeout` 是每格算的** ——
    所以「一格裡跑 20 次 render」等於把 20 家的成本壓在同一個 5s 門檻上。
  - **修法**:四格改成 `it.each(BRAND_CONTENT)` ⇒ 每家一格。格數 14 → 91。
    **最慢單格 676ms → 92ms**(那 92 還是暖機那家,其餘 ≤28ms)⇒ 離 5000ms 門檻從 7.4 倍拉到 54 倍。
    ⚠️ 沒有選「提 testTimeout」:那是把門檻搬開、讓它繼續貼著跑,而且會連帶放寬同檔其他格。
  - **附帶好處**:失敗時**格名直接是品牌 slug**(原本 20 家共用一格,壞哪家要讀斷言訊息才知道)。
  - **守門**:同檔新增一格「20 家不得收回成單格迴圈」——掃自己的原始碼,
    `for (… of BRAND_CONTENT)` 命中數必須為 0。突變實跑:把其中一格收回成迴圈
    ⇒ **只紅這一格**(`1 failed | 71 passed`,格數同時 91 → 72)。
  - 🔴 **守門的邊界(寫在測試檔裡,不假裝守住了逾時)**:它擋得住「有人把迴圈收回來」,
    **擋不住「單家 render 自己變慢到 5 秒」**。後者今天沒有任何東西在看。
  - ⚠️ **本片不宣稱「偶發紅從此消失」**:它拔掉的是**三次觀測都指向的那個嫌疑源**,
    但我沒有能力證明那三次紅(含我自己 #331 那筆**未指認**的)都是這一格。
    要證得等它一段時間沒再犯 —— 那是觀察不是結論。
- ~~**狀態:** ⏳ 待修(2026-08-11 主視窗立案;E/D/reviewer 三方同日各撞一次)~~
- **優先級(立案時):** 🟡 中低(單跑恆綠;只在多窗並行、load 高時逾時 5-6s > vitest 預設 5s)
- **事實**:同日三次觀測(E 全套 3 紅其一/主視窗 21 紅批其一/b-2 reviewer 第一次跑 2 紅)全部單獨重跑即綠;
  耗時 5116-6984ms 貼著 5s 門檻。同族=#334(已修的兩支 browser harness afterAll timeout)。
- **不修未來會痛在哪**:三綠會週期性假紅 ⇒ 每次都要人工重跑判讀,「紅=有問題」的訊號被稀釋;
  哪天真回歸混在爭用紅裡會被當 flake 放過。
- ~~**修法方向**:該格拆 20 家為多格或提高該檔 testTimeout(照 #334 前例);先量單格耗時組成再選。~~

### #396. ✅ `scripts/op1p-verify.sh` 已過期 —— 對 OP2b 之後的世界零覆蓋(已改寫)

- **狀態:** ✅ 已修(2026-08-11 B 窗八代改寫成「OP2b 之後」版;關卡1 codex 4 must-fix 全折)
  - 🔴 **立案時漏看的事**:本檔檔頭在 **2026-08-10** 已被寫上「**本檔已退役**,後繼者 = `op2b-verify.sh`」,
    理由是「本檔證的三件事由更強的守門接手」。⇒ 本次先驗這句話:
    `grep -rn 'reversal_shape' scripts/*.sh` **只命中 op1p-verify.sh 自己** ⇒
    OP1 的交付物 `order_payments_reversal_shape`(A10 放寬後那條 CHECK)在 OP2b 之後
    **沒有第二個 harness 在看**。A9 反號律管的是沖銷列金額,**管不到**「非沖銷收款列不得為負」(G3),
    也不會在有人把 CHECK 改回舊版時指名道姓(G1/G5)。⇒ 退役決定**收回過寬的那一半**、保留正確的那一半。
  - **改寫內容**:①前置閘反轉(gate 必須**不在** + A9 三支 trigger 在崗且**是活的**:逐支綁
    `(tgname, tgfoid)` + `tgenabled='O'` + WHEN 逐支釘)②`FIXTURE_PRELUDE` 拿掉 `DROP CONSTRAINT dormant gate`
    ③**G4 自環格退役**(它驗的雙態世界已被 OP2b 消滅、接不了手;「環寫不進去」由 OP2b migration 的
    N1/N2/N3 與 `op2b-verify.sh:251-269` 逐字比 `P2B32` 守著)④G6 收尾改驗「gate 仍不在 + A9 三支仍在崗」。
  - **實測**:`PORT=54373 bash scripts/op1p-verify.sh all /tmp/op1p396` → `PASS=7 FAIL=0` exit 0
    (`run` 模式 = `PASS=6`,差在 provision 那格);前置閘四發負測全部 `exit 2`:
    ①gate 又出現 ②A9 一支被 DISABLE ③打空埠(⚠️ 這發實際是被更前面的**身分閘** `cluster_identity` 攔下的,
    不是新加的 rc 分支)④DROP 掉 `pcm_op2b_reversal_amount()` 讓 A9 那句查詢自己失敗(rc=1、輸出空)
    —— **④才是新 rc 分支的負測**。
  - 🔴 **WHEN 條件的實測更正**:`order_payments_reversal_amount_bi` **本來就帶**
    `WHEN ((new.reverses_payment_id IS NOT NULL))`(OP2b 建它時就寫了)⇒ 前置閘第一版一律要求
    `tgqual IS NULL`,實跑當場得 2/3。現改成帶 WHEN 那支**逐字比定義**(`WHEN (false)` 掏空一樣抓得到)。
  - **仍未做**:收編 w7 覆蓋帳(動 `EXPECT_TOTAL`/`KEYS_FROZEN`/全帳,歸 P 的 record 輪;主視窗 B-451-A ②)。
- ~~**狀態:** ⏳ 待修(2026-08-11 B 窗實跑發現;W-a 收編前置盤點)~~
- **優先級:** 🟡 中(不影響正式站;但它現在是一支**看起來像測試、實際上一格都跑不到**的檔)
  ⚠️ **2026-08-11 修完後的正確講法**(比照 #399 的護欄,別再照抄下面立案當時的字面):
  現在是「**手動可跑**(`all` 模式 7/0、`run` 模式 6/0)、**W7 自動覆蓋仍為 0**(未收編)」;
  ~~「一格都跑不到」~~、~~「收進去就是一格恆紅」~~、~~修法方向「**G4 改驗 A9 擋環**」~~ 三處**皆已過期**
  —— 實際做法是 **G4 退役**(理由:它驗的 gate 雙態世界已被 OP2b 消滅,接不了手),
  擋環的覆蓋留在 OP2b 側,詳見上面「改寫內容」③。
- **事實(實跑,不是讀出來的)**:`PORT=54358 bash scripts/op1p-verify.sh all /tmp/op1pcov` → **exit=2**,
  fail-closed 在「dormant gate 不在(查得 count=0)」。它自己的錯誤訊息逐字寫著:
  「本檔已過期,請改寫成 A9 版(正測改由 A9 守、G4 改驗 A9 擋環),**不要硬跑**」。
  成因正當:它驗的是 **OP1 補丁片(A10 放寬)在 OP2b 之前**的行為,而 `order_payments_dormant_until_triggers`
  已被 OP2b 同交易 DROP ⇒ 前置條件永遠不成立。
- **不修未來會痛在哪**:①它**收編不進 w7 覆蓋帳**(收進去就是一格恆紅)⇒ OP1 的沖銷形狀
  (A10 放寬後「沖銷列 = 被沖列反號」那一族)**目前沒有任何自動化在看**;
  ②檔案留在 repo 裡會讓下一個人以為那條線有測試覆蓋,而它一格都跑不到 —— 這比沒有檔案更糟,
  因為它提供的是**假的安心感**;③愈晚改,A9/OP2b 的實作細節愈難回想。
- **修法方向**:照它自己的指示改寫成 A9 版 —— 正測改由 A9 trigger 守(沖銷金額必為被沖列反號)、
  G4 改驗 A9 擋環(自環與多列互指,見 OP1 檔頭 A10 實測真值表)。改完再收編 w7。
- **依賴**:純 harness 改寫,不動 migration ⇒ 標準片;與 #399 同屬「harness 對不上現況」族,可同批排。
- **🔗 共同根因**:見 **#401** 族譜條目(重放式 harness vs 非冪等 migration);同族另有 **#394**(a7-verify,最早立案)與 **#399**。

### #399. ✅ A7-t migration 的 trigger 數量斷言過期 ⇒ A7-t 零可跑回歸覆蓋(已修)

- **狀態:** ✅ 已修(2026-08-11 B 窗八代;主視窗 B-445-A 裁 B 案=改包含式+關卡1 codex 審 plan)
  - 修法**不是新增一段包含式**,而是**刪掉 5.1 兩條相等斷言** —— 5.2 早就逐支綁 `(tgrelid, tgname)` 查
    並 `IF NOT FOUND THEN RAISE`,「這四支具名 trigger 都在且屬性正確」就是包含式語意本身;
    再寫一段 `@>` 只是與 5.2 重複的第二把。
  - `scripts/a7t-verify.sh` 同批改兩處:①「刪一支 TRUNCATE 攔截」的 want 改成帶完整 trigger 名的唯一字面
    (原字面是 5.1 的訊息;只寫「找不到 trigger」會被四支共用模板矇混)②`reapply` 終態複驗由
    「兩表 user trigger 一個不多一個不少=6」改成**逐對綁 `(relname, tgname)`** 的 `4|2|0` 三數字分開比。
  - 新增 3b **正向靶**:同表加一支第三方 trigger 必須放行;判別力用消融證(同一靶餵舊版 DO block ⇒ 必紅)。
  - 實測(可重跑):`PORT=54371 bash scripts/a7t-verify.sh all /tmp/a7tv399` → `PASS=28 FAIL=0`、exit 0。
    改前同一條命令的輸出:`grep -c '🔴 S:'` = **15**(s1 全數紅在錯的斷言)、4/7 `reapply 失敗(fail-closed)` 中止、
    總結行未印出(基線與修後輸出各留一份在 B 窗 scratchpad)。
  - **未 apply、未 push**;正式站影響=零的依據:`supabase_migrations.schema_migrations` 查得
    `20260730140000`(本窗唯讀 SQL 實查)⇒ 該 DO block 早已執行完,改檔案不會回頭重跑。
- **優先級:** 🟠 中高(正式站不受影響,但**一條已上線守門鏈的回歸覆蓋現在是 0**)
  ⚠️ **2026-08-11 修完後的正確講法**(關卡2 codex nit):現在是「**手動可跑**(`a7t-verify.sh` 實跑 28/0)、
  **W7 自動覆蓋仍為 0**(未收編)」;「回歸覆蓋是 0」是立案當下的狀態,別再照抄。
- **事實(乾淨全套 migration 庫實測;⚠️ 本段所有行號都是 **改前**的座標,現行檔已無這些斷言 —— 要看原文用 `git show 9a5174b5:supabase/migrations/20260730140000_*.sql`)**:
  `20260730140000_…a7t_cancellation_consistency_triggers.sql:284`(改前)斷言
  「表 `order_cancellation_items` 的 user trigger 數 **恰 2**(一支 presence + 一支 truncate 攔截)」。
  實測現況 **3 支**:`order_cancellation_items_block_truncate_bt` / `..._presence_ac` /
  **`..._summary_recompute_ac`**(第三支由 A4a `20260803140000` 後來新增)。
  ⇒ **正向 apply 不受影響**(A7-t 跑在 A4a 之前,當時確實只有 2 支);
  但**在 HEAD 重放該檔必紅**,而 `scripts/a7t-verify.sh` 的突變測試正是靠重放該檔做的
  ⇒ 該 harness 現在跑不完(`exit=1`、連總結行都到不了)。
- **不修未來會痛在哪**:①A7-t 那四支一致性 trigger(取消單與品項的存在性/截斷攔截)
  **現在沒有任何可跑的回歸測試** —— 有人改壞它不會有東西紅;
  ②w7 帳上那格 `RECEIPT-a7t` 綠**只代表併發探針跑過**(w7-coverage 自己的註解已寫明),
  讀帳的人會以為 A7-t 有覆蓋;③下次有人再往這張表加 trigger(完全合理的演進),
  同一條斷言會再擋一次,而擋的是**別人的無辜片**。
- **🔴 要改的是兩條斷言,不是一條**(2026-08-11 code-reviewer 抓到我原本只點名一條;以下 `:283`/`:288`/`:268` **全是改前行號**):
  · `:283`(改前)`IF v_cnt <> 2` —— 數量斷言
  · `:288`(改前)`IF v_actual IS DISTINCT FROM (…v_expected…)` —— **名稱集合精確相等**
  只放寬 `:283` 的話,第三支 trigger 照樣會在 `:288` 打紅 ⇒ **重放依舊失敗、等於沒修**。
- **修法方向**:兩條都從「精確相等」改成**包含式**(「這兩支具名 trigger 都在、且屬性正確」),
  不對總數與集合設上限 —— 後來者往同一張表加 trigger 是合法演進,不該被前片綁死。
  🔴 **病因要講準**:不是「數量詞 vs 逐項列舉」——`:288` **已經是**逐項列舉,而它一樣壞;
  真正的病是 **精確集合(相等)vs 包含**。逐項列舉只有在「== 這個集合」時才會被未來的合法新增打紅,
  改成「⊇ 這兩支」才免疫。(`:268` 明寫集合相等是刻意設計 ⇒ 這是**設計決策的重估**,不是筆誤修正。)
  改完 a7t-verify 才跑得起來、才談得上收編。
  🔴 **剩餘(不在本次範圍)**:`a7t-verify.sh` **仍未收編進 w7 跑過帳**(`grep -c a7t-verify.sh scripts/w7-receipts.tsv` = 0)
  ⇒ 覆蓋是「跑得起來了」,不是「有人每天在跑」;痛點①要等收編(W 線 / #401 族)才真正解除。
- **依賴**:動已上線 migration 的斷言段 ⇒ 鐵則 12④ 邊緣,建議配 codex;與 #396 同批排。
- **🔗 共同根因**:見 **#401** 族譜條目(重放式 harness vs 非冪等 migration);同族另有 **#394**(a7-verify,最早立案)與 **#396**。

### #401. 🧨 族譜:「重放式 harness」對上「非冪等 migration」(成員 #394/#396/#399)

- **狀態:** ⏳ 待決策(2026-08-11 B 窗連續實跑撞出;主視窗發號,建議帶上 Sean 桌)
- **優先級:** 🟠 中高(不影響正式站;但**三條已上線守門鏈零可跑回歸覆蓋**,且會繼續擴散)
- **本條是族譜,不是個案**:三個 bug 的細節各自有單,**這裡只寫共同根因與決策點**。
  🔴 個案診斷一律以各自的單為準,本條不重述(重述=同一份事實兩處維護,遲早分岔)。

#### 成員與各自的不冪等形式

| 單號 | harness | 不冪等的形式 | 診斷權威 |
|---|---|---|---|
| **#394** | `a7-verify.sh` | `reapply()` 的 **DROP 沒 CASCADE 且錯誤被吞** ⇒ 表殘存 ⇒ 重套撞 already exists | **見 #394**(E 窗 2026-08-11 立,附重現指令) |
| **#396** ✅已修 | `op1p-verify.sh` | 依賴一個**後來被 DROP 的物件**(dormant gate,OP2b 移除)—— 2026-08-11 改寫成「OP2b 之後」版、G4 退役 | 見 #396 |
| **#399** ✅已修 | `a7t-verify.sh` | 對世界的**精確集合斷言**(trigger 數恰 2 + 名稱集合相等)—— 2026-08-11 撤掉集合相等、改包含式 | 見 #399 |

#### 根因(共同點)

三支都用同一種手段:`provision 全套 migration` → **再重放某支 migration**(零突變當基準、改壞它當突變靶)。
(⚠️ 2026-08-11 更新:**#399 已個別修掉**〔撤集合相等〕⇒ 這段「三支」是立案當下的狀態,現況為 **#394 一支未修**(#396 已於同日改寫);
族譜的決策題本身不受影響 —— 手段的結構性問題還在,下一支新 harness 照樣會踩。)
這個手段的前提是**那支 migration 可以重放**,而它們驗的 migration 都不冪等 —— 形式各異(見上表)。

🔴 **共同點不是「這三支寫壞了」**:它們當初都對,而且每一支在自己那一刻都跑得綠。
殺死它們的是**後來的合法演進**(OP2b DROP gate、A4a 加第三支 trigger、a7b_m 加了一條指向
`order_cancellations` 的 FK)。⇒ **重放式 harness 的壽命綁在被重放那支 migration 的「世界假設」上**;
世界一動就死,而且**死得很安靜** —— 它們不在 w7 帳上,沒有任何東西會紅。

#### 不修未來會痛在哪

- **三條守門鏈現在零可跑回歸**:OP1 沖銷形狀(A10 反號族)、A7-t 四支一致性 trigger、A7-1 結構契約。
  有人改壞它們**不會有東西紅**。
- **會繼續擴散**:只要還有人用「重放 migration」寫新 harness,下一次合法演進就再殺一支。
- **收編被無限期擋住**:三支都收不進 w7(收進去就是恆紅格),而「不在帳上」正是它們壞了沒人發現的原因
  —— **自我維持的盲區**。
- 🔴 **最貴的一條**:w7 帳面現在 43/0 全綠,但那個綠**不包含**這三條線 ⇒ 讀帳的人會高估守門覆蓋率。

#### 修法方向:兩案,**本條不拍**(建議 Sean 決策)

- **A 案:harness 改「驗現況形狀」,不重放。** 用 catalog 斷言終態(trigger/constraint/ACL 是否符合契約),
  突變靶改成「在現況上動手腳再驗它被抓到」。
  · 好處:與 migration 的冪等性**徹底解耦**,不再被後來的合法演進殺死。
  · 代價:三支都要重寫;「重放整支」原本順帶驗到的**執行期行為**(斷言段自己會不會紅)失去覆蓋。
- **B 案:讓被重放的那支可以重放。** ⚠️ **這一案要逐支設計,沒有通解**:
  · #399 可行:精確集合斷言改包含式(見該單,兩條斷言都要改)。
  · #396 可行:gate 檢查改條件式。
  · 🔴 **#394 不適用 `IF NOT EXISTS`** —— 那張表是 provision 建的、本來就存在,`IF NOT EXISTS`
    只會讓 CREATE 靜默跳過,而真正壞掉的是**前一步的 DROP**。而且 **#394 已明文警告不要順手加 CASCADE**
    (會無聲拆掉 a7b_m 那條 FK、**改變後面 36 道檢查的意思**)⇒ 它的正解是按依賴序 drop 或整庫重建。
  · 代價:動的是已上線 migration / harness(鐵則 12③④),每支都要對抗審查;
    且「讓已上線 migration 可重放」是一個**新的長期承諾**,以後每支都要守。
- ⚠️ 兩案不互斥,但**混著做最糟**(一半解耦一半冪等 ⇒ 下一個人不知道該遵哪條)。

- **依賴**:A 案=三支 harness 重寫(標準片×3);B 案=逐支設計、其中 #394 需另想解法。
  🔗 個案見 **#394**(a7,診斷權威)、**#396**(op1p)、**#399**(a7t)。

### #402. ✅ `scripts/a7bt-*` **整族七支**是孤兒 —— 它們的目標 migration 已被**刻意刪除**(已整族刪除)

- **狀態:** ✅ 完成(2026-08-11,B 窗七代;主視窗 `B-443-A` 裁 **B 案=整族七支刪**)
- **優先級:** 🟡 中(不影響正式站,也**不是** #401 族 —— 見下)

- **🔴 範圍更正(立案時寫窄了)**:本條原本只點名 `scripts/a7bt-verify.sh` **一支**。
  動手前盤「誰死」才發現是**七檔 / 311,275 bytes 的一整族**,其中**五支**的 `MIG=` 指向同一支死 migration:

  | 檔 | bytes | `MIG=` 指向死 migration |
  |---|---|---|
  | `a7bt-negative-state.sh` | 104,683 | ✅ |
  | `a7bt-negative-money.sh` | 41,846 | ✅ |
  | `a7bt-fixtures.sh` | 41,822 | ✗(共用 fixture 函式庫,被下面五支 source) |
  | `a7bt-verify.sh` | 34,984 | ✅(立案時只寫了這一支) |
  | `a7bt-acl-rollback-lock.sh` | 34,316 | ✅ |
  | `a7bt-rollback.sql` | 27,305 | ✗(SQL,依賴同一支不存在的 migration) |
  | `a7bt-mutation.sh` | 26,319 | ✅ |

  ⇒ 只刪一支的話,剩四支照樣是孤兒、fixtures 變成只服務孤兒的函式庫
  ⇒ 本條自己寫的兩條痛點對那四支**逐字成立**,單修完病還在。**故整族刪。**

- **🔴 刪除前的依賴盤點(全部可重跑)**:
  · 家族內:五支 `.sh` 全部 source 同一支 `a7bt-fixtures.sh`
    (`grep -n 'shellcheck source=scripts/a7bt-fixtures.sh' scripts/a7bt-*.sh` 當時 = 5 行)。
  · 家族外:`grep -rln 'a7bt-' --include='*.sh' scripts/` 家族外只命中 `a7c-rw1b-verify.sh`,
    且逐行看完**只有 `:22` 一處指到檔名**(`a7bt-mutation.sh`),另兩處(`:239`/`:1473`)引用的是
    **A7b-T 的紀律**(「紅對地方」「數量閘同款」)而非檔案 ⇒ 那兩處刪檔後仍成立、不改。
    `:22` 已加註「原出處…已整族刪除,座標見本條」。**沒有任何活著的 harness 因此壞掉**
    (三處皆註解,無 `source`、無呼叫)。
  · w7:`grep -n 'a7bt' scripts/w7-coverage.sh scripts/w7-receipts.tsv` = 零命中
    ⇒ 七支既未收編也未登記排除 ⇒ 刪除不動格數。**但** `a7c-rw1b-verify.sh` 因 `:22` 那行改動
    sha 變了、收據 stale 閘當場紅(`RECEIPT-a7c`)⇒ 已重錄(57/0),全 w7 回 46/0。

- **🔑 贖回座標(A7b-T 回線時取回;兩式並存,①短但會鏽、②長但不依賴任何寫死的 sha)**
  · ① 定錨式:七支在 **`3704b756`** 全部還在 ⇒ `git show 3704b756:scripts/a7bt-verify.sh`
    (逐支 `git cat-file -e 3704b756:scripts/<檔>` 當時七支皆通)。
  · ② 自尋式:`git log --all --diff-filter=D -- scripts/a7bt-verify.sh` → `git show <該顆>^:<路徑>`。
  · **migration 另有座標**(與 harness 不同顆,別搞混):刪它的是
    `0190bcee chore(schema): 移除未 apply 的 A7b-T migration — 拆掉 db push 地雷 [M-4b]`
    ⇒ `git show 0190bcee^:supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql`。
- **🔁 A7b-T 回線時的重啟條件**:①先把上面那支 migration 取回並 apply(它當初被移除的理由是
  「未 apply 的 db push 地雷」,回線=那個理由消失)②再整族取回七支(它們本來就要一起用:
  五支 harness + 共用 fixtures + rollback SQL)③`a7bt-verify.sh` 的自我測試②會驗四支 constraint
  trigger 存在,migration 沒 apply 就會紅在那裡 ⇒ **順序不可顛倒**。
  ④ 那時才談收編 w7(現在不收:恆紅的東西進帳只會稀釋訊號)。
- **⚠️ 刻意沒動的**:`docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md` 與 `STATUS.md` 仍有數處提到
  這七支 —— 那是 A7b-T 的規格與歷史紀錄,**本來就該保留當時的字面**;回線時照本條座標取回即可。

- **事實(立案時原文,保留)**:
  · `scripts/a7bt-verify.sh:197` 逐字 `MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"`,
    而**該檔不存在**。`git log --diff-filter=D` 查到它被 **`0190bcee`** 刪除,commit subject 逐字:
    「移除未 apply 的 A7b-T migration — 拆掉 db push 地雷」⇒ **是刻意移除,不是遺失**。
  · 實跑(未改動原檔、專用埠)`exit=1`,死在自我測試②:
    「期望紅在 `a7bt_c1_job_has_no_items`,實為 `[]`」—— `[]` 表示 `T2-RED|` 標記**從未印出**,
    也就是 SQL 在更早的地方就失敗了(目標 migration 不存在 ⇒ 那四支 constraint trigger 根本沒被建過)。
  · 該常數名 `a7bt_c1_job_has_no_items` 全 repo **只出現在這支 harness 裡**,任何 migration 都沒有。
- **🔴 不是 #401 族**(附證據;**2026-08-11 W-c1 R1 nit 更正 —— 原本的取證太窄**):
  #401 族的共同手段是「重放 migration」,而本支**沒有 apply 路徑**。結論沒變,證據換掉:
  · 🔴 原文只拿 `grep -cE '-f "\$MIG"'` = 0 就下結論。那條 pattern **擋不住 `-f "$變數"` 的寫法**,
    而本支剛好就有一個(`scripts/a7bt-verify.sh:219`,`run_chain` 的 `-f "$file"`)
    ⇒ 那個「0」當時證不到它被拿來證的事。順帶:原文語感像「零引用」,也不對(見下)。
  · 改成**逐項列舉**(範圍小到列得完,就不要猜 pattern):
    `$MIG` 在本檔只出現 **2 次** —— `:197` 賦值、`:203` 被 `sed` 讀去抽七個函式指紋;
    **是讀取,不是套用**。
    `psql … -f` 在本檔共 **4 處** —— `:147`/`:174`/`:550` 各讀 `$WORK/` 下自己產生的 SQL;
    `:219` 吃變數 `$file`,其呼叫端 **7 處全是** `$WORK/chain-{a,b,c,d,e,f,g}.sql`
    (`:247`/`:271`/`:286`/`:309`/`:313`/`:327`/`:368`)。
    ⇒ 沒有任何一條路徑會套用 `$MIG`。
  它的病是**目標物本身不存在**,屬另一類:**孤兒 harness**(被驗的東西下線了,驗它的東西沒跟著下線)。
- **不修未來會痛在哪**:
  ① 一支指向不存在檔案的 harness 留在 repo ⇒ 看起來這條線有覆蓋,**實際上零覆蓋**
     (與 #396 的假安心感同型,但成因不同)。
  ② 它 `exit=1`,任何「把 scripts/*-verify.sh 跑一輪」的人都會看到紅,而那個紅
     **與任何現存 code 無關** ⇒ 訊號稀釋(同 #398 那族的病理)。
  ③ 它收編不進 w7(恆紅),而不在帳上又正是它壞了沒人發現的原因。
- **修法方向(立案時兩案,已裁定;原文保留供對照)**
  · **A 案:刪掉 harness。**〔**✅ 已採用**,並由主視窗 `B-443-A` 把範圍從一支擴成整族七支〕
    好處:repo 不留指向不存在檔案的東西;代價:A7b-T 復活時要記得取回(靠人記)
    → **這個代價已用機制補掉**:贖回座標雙寫進本條與刪除 commit body,並附「回線重啟條件」四步。
    🔴 **立案時這句寫錯,一併更正**:原文寫「從 git 取回即可(`0190bcee^` 有完整版)」——
    `0190bcee^` 有的是 **migration**,不是 harness。**兩者是不同顆、不同路徑**,
    當時把它們混成一句。正確座標見上面「贖回座標」段(harness=`3704b756` 或自尋式;
    migration=`0190bcee^`)。同一種病:**把「查到的那顆」當成「所有東西都在的那顆」**。
  · **B 案:保留但明確 skip**(偵測到 `$MIG` 不存在 ⇒ 印「目標 migration 未上線,本支略過」+ `exit 0`)。
    〔**未採用**〕理由(主視窗裁定逐字):留下的是一支恆綠零斷言檔=**假安心感**,
    正是 #396 那型病的變體;而「靠人記得取回」的坑改用機制補(贖回座標+重啟條件),不需要靠留檔。
- **依賴**:純 harness,不動 migration ⇒ 輕量片。與 #396(op1p 過期)同屬「harness 對不上現況」大類,
  但**成因不同**(#396 是前置條件被移除、本條是**目標物被移除**)⇒ 不併入 #401 族譜。
### #403. 🔗 `strong_key` 只驗前綴、不驗它與 `rec_trade_id` 的等式(條款掛 2g)

- **狀態:** ⏳ 待排(2026-08-11 L5b-2 片 2c 的 R3=C2;**主視窗裁「不擴 2c、立編號條款掛 2g」**)
- **優先級:** 🟠 中(現況零 writer 造得出該形狀 ⇒ 尚不可達;2g 一落地即轉高)
- **問題**:2c 的 `pr_strong_key_domain_chk` 只保證 `strong_key` 有 `rec:`/`bank:` 前綴,
  **不保證 `'rec:' || rec_trade_id` 真的等於同一列的 `rec_trade_id`**。
  writer 若寫出 `(strong_key='rec:D123', rec_trade_id=NULL)`,該列照樣入庫 ——
  而母 plan §3a-5 的共同否決條件是拿 `rec_trade_id` 去 join 的 ⇒ **那筆退款會從否決面隱形**
  (看得到帳、對不到單,而它正是用來防重複退款的那道)。
- **修法方向**:等式 CHECK 隨 **2g 的 migration 同批**上,並在 2g 的關卡1 被釘住:
  `CHECK (strong_key = 'rec:' || rec_trade_id OR strong_key LIKE 'bank:%')` 之類的行內結構(細節待 2g 定 writer 形狀)。
- **不修未來會痛在哪**:2g 的 writer 一個欄位打錯,退款帳本就會長出「否決條件看不見的列」,
  而它的症狀是**重複退款**(錢真的多出去),不是報錯。
- **依賴**:2g 的 writer RPC;動已上線帳本 schema ⇒ 鐵則 12③。
- **編號註**:號由主視窗配(#403-#405 保留給 P 窗),不是我自己依分支取的。

### #404. 💱 `record.amount` 單位=整數元:把依據從「生產行為背書」升級成正式站直接觀測

- **狀態:** ⏳ 待排(2026-08-11 L5b-2 片 2c 的 R3=C3;R3 逐字「100 倍級金額錯的面不留在註解裡」)
- **優先級:** 🔴 高(金額尺度錯 = 100 倍級,且錯了不會報錯、只會算出錯的退款額)
- **問題**:2c 把 `record.amount` 定死成整數元,依據鏈五節裡最強的兩節是
  ④ 生產行為背書(charge 回應被直接餵進 `toMoneyAmount()`,該路徑正在收真實信用卡款)與
  ⑤ sandbox 直接觀測(`docs/reference/tappay-reference.md:116`/`:167`,6 元交易讀到 `amount=6`)。
  **兩節都不是「正式站一筆真 Record 的 `amount` 與該單 `orders.total` 並排比對」。**
  現況這個前提只寫在 migration 檔頭註解裡 —— 註解不會在前提失效時變紅。
- **修法方向**:取得任一筆正式站 Record 回應後,把 ⑤ 升級成正式站觀測;
  並把「尺度=整數元」做成**具名硬前置**(2g/2k 的驗收條款或一格斷言),不只留在註解。
- **不修未來會痛在哪**:哪天 TapPay 換 API 版本或新增一條回應路徑改用分為單位,
  現行程式不會報錯,只會把每一筆退款算成 100 倍或 1/100 —— 而且是在**錢已經退出去之後**才發現。
- **依賴**:需要一筆正式站 Record 實例(Sean 或主視窗代取);與 2k 對帳 RPC 同線。
- **編號註**:號由主視窗配。

### #405. 📝 `manual` 事件填錯目前只能靠 owner 裸改資料庫(無 runbook、無稽核設計)

> 「只能」的數法(⚠️ 我第一版寫的數法是錯的,範圍抓太寬,留著當戒):
> `grep -rn "沖銷\|reversal" supabase/migrations/*.sql` → **214 命中**,但那些幾乎都是
> `order_payments` 的沖銷機制(`reverses_payment_id`,`20260810110000` 內 5 處)—— **另一張表**。
> 收窄到退款帳本自己:`grep -n "沖銷\|reversal\|reverses" supabase/migrations/20260810140000_*.sql`
> → **1 命中,且是 `:32` 提到別支 migration 的檔名**,不是機制。
> ⇒ 精確的話是:**沖銷語意在 repo 裡存在,但不存在於 `payment_refund_events`**。
> 第二筆 manual 被擋的座標 = `20260810140000:137`(`CREATE UNIQUE INDEX pre_one_terminal_uniq … (refund_id)`)。

- **狀態:** ⏳ 待排(2026-08-11 L5b-2 片 2c 的 R3=C4)
- **優先級:** 🟠 中(需要人為誤填才觸發;但觸發時的處置目前完全沒有設計)
- **問題**:2c 保證 `manual` 事件帶得出 boolean verdict,**但擋不住人填錯**。
  而填錯之後沒有修正路徑:①`20260810140000:137` 的單一 terminal 唯一索引會擋掉第二筆 manual;
  ②「沖銷事件」的計算語意在 repo 內尚未存在(R3 覆核同結論)。
  ⇒ 實務上只能由 owner 直接 UPDATE/DELETE 資料庫,而那**繞過 append-only trigger**、
  且沒有任何 runbook 規定誰能做、要留什麼證據。
- **修法方向**:二擇一 —— ①定義沖銷事件語意(放寬唯一索引 + 定義它如何抵銷前一筆),
  或 ②寫一份 owner 裸改 runbook(誰授權、改前快照、改後對帳、留稽核列)。①較貴但可稽核。
  🔴 ①**有現成先例可抄**,比我原本估的便宜:`order_payments` 已經有一整套沖銷機制
  (`reverses_payment_id` + `reversal_reason`,見 `20260810110000` 與 `20260810130000_*_op2b_reversal_invariants.sql`),
  含「沖銷列不得寫未來日期」這類已被實測釘住的不變量 ⇒ 形制可直接沿用到 `payment_refund_events`。
  ⚠️ 沿用前要先查它的權限邊界與稽核語意對不對得上(memory `feedback_plan-method-must-be-walked-through-reality`:
  「有現成的可沿用」是最容易出事的那句)。
- **不修未來會痛在哪**:第一次有人填錯 `refunded` 時,現場沒有人知道能不能改、改了要不要留紀錄,
  最可能的結果是**有人直接連線改掉、沒有任何痕跡** —— 而這張表存在的理由就是留痕。
- **依賴**:①屬 2k 對帳線;②可獨立先寫。
- 🔴 **與 #417 是同一個決策**(2026-08-11 晚 P 線排程整理時發現):#417 是 2d 回退的資料閘
  叫人「先處理那幾筆 `result_confirmed`」而 append-only 擋死;本條是 `manual` 填錯之後只能 owner 裸改。
  **兩條的修法出口是同一個**:退款帳本的人工處置要走哪條合法路徑(沖銷事件 vs owner 裸改 + runbook)。
  ⇒ 排程上**兩條一起排、一次問 Sean**;分開排會讓同一題被問兩次,而第一次的答案會綁死第二次。
- **編號註**:號由主視窗配。

### #406. ✅ 「清空自訂日期 ⇒ 跳回近半年」**不是 bug**,是 3c-1 刻意設計(Sean 08-11 複確認可接受)

> ⚠️ **本條的登記本身遲到了**:主視窗 2026-08-11 在 D-485-A 配了 #406 這個號,
> 但**登記進本檔是我的責任而我沒做**,還在後續兩封信裡把它當成「已登記」在引用。
> 病癥可見於編號:本條補上之前,清單從 **#405 直接跳到 #407**。
> ⇒ 教訓:**配到號 ≠ 立了案**;引用一個編號之前先 `grep` 它在不在檔裡。

- **狀態:** ✅ 收案不改 code(2026-08-11 Sean 拍 **C**)
- **優先級:** —(非缺陷)
- **回報原文**(Sean,驗正式站推點 `2f91f942`):
  「這個目前自己輸入日期不會變,其他預設建立日期有變動」;追問後補充逐字
  「**我一開始自己填日期都很正常,可以正常運作,清除後會跳回近半年**」;
  理解機制後逐字「**不知道問題點在哪?我起來還可以**」。
- **實際機制**:`apps/admin/src/components/orders/order-filter-controls.tsx:185-206`。
  兩格日期都空的那一刻,`applyCustomDate` **刻意**退回預設那一格(近半年)並把日期補上。
  該處註解逐字寫了理由:不這樣做的話畫面會停在「自訂 + 兩格空白」(員工讀成不限期間)、
  而列表實際仍篩近半年,**且永不自癒** —— 那才是真正危險的狀態
  (「找不到舊單 → 清空日期想看全部 → 看到 0 筆 → 判定沒這張單」)。
  ⇒ 根因是**本系統沒有「不限期間」這個選項**(3c-1 plan §1-1 認列過的誠實代價)。
- **落選方案(留檔,免得下次重問)**:
  · **A 加「不限期間」選項** —— 直接消滅症狀,但推翻 3c-1 §1-1 的認列,且全表掃描要先評效能。
  · **B 不加選項、把跳回變成看得懂的告知** —— 症狀還在,只是不再像壞掉。
  · **C(採用)** 維持現況 + 值班須知寫明。理由:Sean 理解機制後認為現狀可接受。
- 🔴 **有一半的推導維持未證**:我曾推「`<input type="date">` 打字**中途**吐空字串
  ⇒ 每個中途狀態都觸發 fallback」。Sean 實測「一開始自己填都很正常」**不重現**它。
  ⇒ **未證實、也未證偽**(他可能走日曆選、或另一格有值走另一條路);**現狀無症狀,不追**。
  真要追,決定性實驗是真瀏覽器逐段輸入 + 觀察 `router.replace` 的呼叫序列。
- **不修未來會痛在哪**:不痛(已是刻意行為且有告知)。但**日後若要加「不限期間」**,
  必須連同 `applyCustomDate` 的 fallback 一起改 —— 只加選項而不改 fallback,
  會出現「選了不限期間、一清空又跳回近半年」的自相矛盾。

### #407. 🛂 扣款**入站**路徑從頭到尾沒有人驗 `rec_trade_id` 的形狀

- **狀態:** ⏳ 待排(2026-08-11 L5b-2 片 2c 的 R3=C1 **反轉**後浮出來的真缺口;主視窗 P-366-A 配號)
- **優先級:** 🟠 中(髒 rec 進得了庫,但送退款時會被 adapter 擋 ⇒ 不會直接賠錢,會卡住流程)
- **問題**:一顆 `rec_trade_id` 從 TapPay 回應走到 `payment_charge_attempts`,**沿路沒有任何形狀驗證**:
  - `TapPayChargeAdapter.ts:145-148`(扣款成功解析)**只檢查 rec 存不存在**,不檢查形狀;
  - DB 層 RPC 閘(`20260612150000:256`/`:369` 等)只擋 `btrim(...)=''` 與 `length > 64`;
  - 欄本身(`20260612150000:93`)是**裸 text、無 CHECK**。
  ⇒ 內部含空白/tab/控制字元的 rec **進得了 attempts**。
- **對照(為什麼現在不算緊急)**:退款**送出前**那道 adapter 閘會擋 ——
  `TapPayChargeAdapter.ts:267` 對 transactionId 跑 `/^\S{1,20}$/`(`:66`),不合即 `TapPayRefundNotSentError`、未送出。
  ⇒ 髒 rec 不會變成「錢動了卻對不上帳」,會變成「**該退的退不掉**」。
- **修法方向**:把 `REC_TRADE_ID_RE` 那道形狀閘**往入站移**(charge 成功解析處也跑一次),
  或在 DB 的 RPC 閘補同一條形狀。兩者都動金流路徑 ⇒ 鐵則 12①。
- **不修未來會痛在哪**:某天 TapPay 回一顆帶空白的 rec,扣款會**成功**、錢收了,
  然後那張單**永遠退不了款**(adapter 拒送),而現場只會看到一個 `未送出` 的錯誤訊息,
  沒有人會想到根因在三個月前的入站解析。
- **依賴**:動 adapter 或已上線 RPC ⇒ 鐵則 12①;可獨立輕量片,不必綁 2d。
- **編號註**:#407 由主視窗配(P-366-A);#403-#405 同批。
### #421. 🧹 三處註解還在說 `--shell-header-h` 的 ≤1079 值是 69px(實為 60px)

- **狀態:** ⏳ 待執行(2026-08-11 #408 R1 nit;**非 #408 引入**、主視窗發號)
- **數法**:`grep -rn "69px" apps/storefront/src/styles/*.css` = **7 命中**,逐條開檔分類:
  - **過期 3 處**:`home.css:137`(「`tokens.css:226` ≤1079 改 69px」——**行號與值都過期**,現在是 `:242` 的 60px)、
    `home.css:279`、`products-mobile.css:39`。
  - **不過期 2 處**:`products-page.css:36`(講的是**設計稿**的頁首 69,不是 token)、
    `home.css:136`(講的是「第一版曾把 OD 的 69 寫死」的歷史)。
  - **已處理 1 處**:`account.css:510`(#408③ 已改寫並標刪除線)。
  - 🔴 **分類更正(施工當下發現)**:第 7 處 `tokens.css:17` **不是**「變更說明/正確歷史」——
    它是**現在式的主推導**(「≤1079 的 padding 是 12 ⇒ …= 69」),前提與 `account.css` 那句**同源同病**
    ⇒ **一併修**。⇒ 實際處置 = **過期 4 / 不過期 2 / 已處理 1**。
    (**條目是我自己寫的,一樣要開檔複驗** —— 這次就是照抄自己的分類會漏掉一處。)
- **不修會痛在哪**:`--shell-header-h` 是單一來源,但**註解裡的舊值**會讓下一個人以為 ≤1079 還是 69
  ⇒ 他推導出來的合成值會少 9px,而**守門只禁 `69/73/64/65` 出現在 `top:` 宣告裡、對註解全盲**。
  這正是 #408③ 那句過期推導的同族(前提變了、結論沒重算)。

### #422. 🔴 webhook inbox 的 claim 不濾訂單狀態 —— 已退款的單照樣重試到 ceiling 轉人工

- **狀態:** ⏳ 待執行(2026-08-11 RF7-recon §5 發現;主視窗發號)
- **實查**:`grep -c payment_status supabase/migrations/20260615120000_m3_3ds_4a1_webhook_sweeper_rpc.sql` = **0**
  ⇒ inbox 的 claim **完全不看訂單狀態**;對照 attempt 那支(`20260615120001:16`)有 `o.payment_status='unpaid'`。
- **症狀**:訂單已 `refunded` / `partiallyRefunded` 時,只要 inbox 還有它的事件,
  每輪照樣 claim → `settleCharge` → Record 回 2/3 → `refund_anomaly` → pending → 退避重試
  → **達 ceiling(≥8)轉 `needs_manual_review`** ⇒ 一筆已經退掉的單出現在人工待審佇列。
- 🔴 **這可能是 inbox 自己的 bug、不是 RF7 的範圍** —— **待 RF7-fix plan 裁定歸屬或獨立成片**。
  兩支 claim RPC 是同一天、同一組人寫的(`20260615120000` / `120001`),而**只有一支加了訂單狀態閘**
  ⇒ 「另一支是刻意不加」與「另一支漏了」目前**分不出來**(未查當時的 plan/commit body)。
- **矩陣座標**:`docs/specs/2026-08-11-rf7-recon-settle-trigger-matrix.md` §5 路 1、§7-2。

### #408. 📐 checkout 側欄的「斷點縫隙」+ 兩處 scroll-margin 合成寫死 + 一句過期註解

- **狀態:** 🏁 **①②③ 全數收工(2026-08-11 夜,E 窗)**
  —— ① Sean 委主視窗裁 **B**(維持 sticky、top 改吃 token,901-1079 由 96 → 83px、位移 13px);
  ②③ 隨 ① 的重算一併解:兩處 `scroll-margin-top: 76px` → `calc(var(--shell-header-h) + 3px)`,
  `account.css` 那段過期推導改寫。**守門翻面**:`shell-detail.test.ts` 的兩條 #331 回歸鎖
  由「維持寫死 96px」改成「必須吃 token」(拍板驅動的期望值變更、非為了讓測試過),
  另新增一條**掃全 styles 的 `scroll-margin-top` 守門**(含前提斷言防恆綠)。
  三靶突變各紅自己那條;三綠全過。
  🔴 **R1(code-reviewer opus)FAIL 1C+4I,已全折**:①守門母體是寫死 12 檔清單而非全 CSS
  (reviewer 在 `error.css` 塞探針全綠、作者自己重跑複製同結果)⇒ 改 `readdirSync` 掃 28 支;
  ②`checkout.css` 併入 CONSUMERS(舊註解說它「還寫死 96px」已被自己的 diff 打成假);
  ③鐵則 1 前置補做(submodule 原為空目錄、物理上 grep 不到 design 真權威);
  ④manifest bump + `business_overrides` 登記拍板偏離;⑤本條 ② 的證據句改真(見上)。
  **原條目全文保留於下,供追溯決策脈絡。**
- **一條裝三件**,共通根因都是「某個數字其實是**兩個東西加起來**,而那兩個東西各自會動」。

**① 🔴 `.co-aside` 的 901-1079 縫隙(#331 刻意沒收的那一處)**

- `checkout.css` 的 `.co-aside` 轉 `position: static` 的斷點是 **`@media (max-width: 900px)`**,
  但 `--shell-header-h` 換值的斷點是 **1079**(`tokens.css`:桌機 73px、≤1079 為 60px)。
- ⇒ **901-1079 這段** `.co-aside` 仍然 sticky,而頁首在那裡只有 60px,
  它卻用寫死的 `top: 96px`(= 桌機 73 + 呼吸 23)⇒ 實際上留了 **36px** 的空隙、比桌機多 13px。
- **#331 為什麼不順手改**:改成 `calc(var(--shell-header-h) + 23px)` 會讓該區間變成 83px
  ——**那是視覺變化**,不該在一個「收斂 token」的片裡沉默決定。**要 Sean 看過再定。**
- **三個候選**(不預選,列給拍板用):
  A. 把 `.co-aside` 的 static 斷點從 900 改成 1079(與另三處一致)⇒ 901-1079 變成不 sticky。
  B. 維持 sticky,`top` 改吃 token ⇒ 該區間 96 → 83px。
  C. 維持現狀,只把「這是刻意的」寫在檔裡(**#331 已經做了這一半**,含回歸鎖)。
- **守門現況**:`shell-detail.test.ts` 的 #331 describe 有兩條**回歸鎖** ——
  `.co-aside` 維持 96px、且其 static 仍在 ≤900。本條動它時那兩條**會紅,而且該紅**:
  紅了代表有人正在改這個決定,要連帶重讀本條。
- **不修會痛在哪**:今天沒有人看得出 901-1079 的空隙比桌機大 13px(三綠與全套測試對它全盲,
  只有真瀏覽器 + 剛好把視窗拉到那個寬度才看得到);而下一次有人「順手把四處補齊」時,
  它會被靜默改掉、且沒有任何紀錄說明那 13px 原本是刻意的。

**② `scroll-margin-top: 76px` 的合成寫死家族(兩處)**

- `account.css:513` 與 `product-page.css:1531`(`.pd-sec`)各有一個寫死的 `76px`。
- 它是 **73(桌機頁首)+ 3(緩衝)** 的合成值 ⇒ 與 #331 修掉的那三處**同一個病**:
  合成值裡沒有任何一個被 `shell-detail.test.ts` CONSUMERS 禁的數字(69/73/64/65)⇒ 守門看不見。
- ⚠️ `account.css:511` 自己已經誠實寫了「`.pd-sec` 那顆 76 的推導過程沒留在檔裡
  ⇒ 這裡是『數值一致』,不是『查證過它同源』」——**兩處是不是真的同源,本條要先答這題**,
  答完才知道能不能一起改成 `calc(var(--shell-header-h) + 3px)`。
  🏁 **答案(2026-08-11 查)**:**不同源**。`.pd-sec` 那顆 76 引入於 `e8a3c150`(#270、2026-07-10)。
  🔴 **證據句更正(#408 R1 抓;原句只讀 commit body 就下判斷)**:該 commit 的 **diff 裡確實有推導** ——
  但推的是**被它刪掉的舊值 116**(舊註解逐字「sticky Header(~60px)+ 跳轉列(~50px)」)。
  **新值 76 沒有任何推導**:作者把 116 換成 76 的同時把舊註解整段刪了、沒補新的。
  ⇒ 結論(不同源)不變,但**成立的理由是「新值無推導」,不是「commit body 沒寫」**。
  ⇒ 修法不是「因為同源所以一起改」,是**兩處各自都該吃 token**,而吃了之後同源問題**由構造消失**。
- ⚠️ 而且 `scroll-margin` 的正確值與 sticky 的 `top` **未必同一個**(它要讓捲動停點避開頁首,
  多留一點無害、少留就會被遮)⇒ 不能照抄 #331 的做法,要各自想。

**③ `account.css:509` 的過期註解(一行)**

- 該段推導逐字寫「手機 `@media (max-width: 1079px)` 把該 padding 覆寫成 12px ⇒ 12×2+44+1 = **69px**」,
  但 `--shell-header-h` 在 ≤1079 **2026-08-09 已改成 60px**(Sean 看過四張梯度截圖後挑的;
  `tokens.css` 與 `shell-detail.test.ts` 都是 60)。⇒ 那句推導的結論已過期。
- 🔴 它不只是「數字舊了」:**整段是在論證 76px 這個值怎麼來的**,前提變了、結論卻沒重算
  ⇒ 下一個人會拿一個站不住的推導去支持一個寫死的值。修這條時要**連 ① 一起重算**,不是改個數字。



---

### #409. 🔤 `Panigale V4` / `panigale v4` 雙字面:同一台車兩個大小寫版本,顯示名與寫入驗證都受影響

- **狀態:** ✅ **結案(2026-08-13 下午實查四句全 0)。🔴 但不是我方做的 —— 照實記,不搶功。**

  | 結案驗收句 | 結果 |
  |---|---|
  | `product_fitments_effective` | **0** |
  | `product_fitments` | **0** |
  | `vehicle_taxonomy_public` | **0** |
  | `products.fitments`(**真源頭**) | **0** |

  三個目標商品的 `products.updated_at` = **2026-08-13 14:04:37 / 14:04:37 / 14:06:27**(台北),
  現值已是 `Panigale V4` / `Forza 250`。**主視窗從未 apply 任何 migration** ——
  全程只跑交易模擬,且每次跑完都複驗回滾(兩次都量到源頭 3 / 索引 3 = 零留痕)。
  ⇒ 是**外部寫入**清掉的,時間點與 Sean 轉信給報價單側之後吻合(未向對方確認,標**未確認**)。

  **寫好的 migration 已移除、未 commit**:`20260813120000_m4b_409_fitment_model_code_cleanup.sql`
  與 `scripts/409-fitment-cleanup-rollback.sql`。理由=它的前置閘 P3 釘死「髒元素 = 3」,
  現況 0 ⇒ **它已經永遠跑不了**,留在 migration 目錄是純風險。**閘擋下來是正確行為,不是缺陷。**

  ### 🔴 本條真正的價值在這些教訓,不在那 3 筆資料

  1. **清錯資料層(v1,codex 關卡 FAIL 攔下)**:主視窗寫了一支去清 `product_fitments` 的 migration。
     **那是衍生索引** —— `products` 上掛著 `trg_pf_sync_ins` / `trg_pf_sync_upd`
     (函式 `sync_product_fitments()`),`products.fitments` 一變就整批重建那張表。
     ⇒ v1 清掉的東西,**那個商品下次被編輯就原樣長回來**;而真正的單一真相沒被碰,商品頁照樣顯示髒字面。
  2. 🔴 **「repo 內查無寫入路徑」是假的** —— 主視窗**只 grep 了 TypeScript、沒查 DB trigger**。
     `零命中` 只證明「我用的量具沒找到」,不證明「不存在」。(同族第 N 次)
  3. 🔴 **驗源頭時欄位名打錯**:查 `products.fitments` 用了 `model`/`brand`,
     實際 key 是 `modelCode`/`motoBrand` ⇒ 查出來是空的,**差點拿它當「源頭是乾淨的」的證據**。
     量具比目標窄,結果長得跟「沒問題」一模一樣。
  4. **驗收式三句混寫 = 讓兩種原因長得一樣**(「同步沒跑」vs「管線碰不到這張表」)。
     已改成逐句標明驗的是哪條管線的產物 —— 這條**通用**,不只 #409。
  5. **假設「同步是 upsert 不刪除」機制錯**:`pfe_sync_commit` 實為
     `DELETE ... WHERE true` 之後從 staging 整批 INSERT(函式定義親撈讀過)。猜對的只有結果,推導是錯的。
  6. v2(改源頭 jsonb、讓 trigger 自動重建)交易模擬全綠,codex 仍判 FAIL 5 must-fix,
     其中一條是**主視窗的邏輯錯**:前置閘量詞寫反(寫成「沒有任何髒元素有孿生才擋」,
     正確是「只要有一個髒元素沒孿生就擋」)。**同一支檔被兩輪對抗審查各抓到一個真缺陷。**

  ### 歷史(定案前的分流過程,保留備查)

  🔴 **驗收式必須拆成三句、逐句標明驗的是哪條管線的產物** —— 原本三句混寫,
  會讓「同步沒跑」與「管線根本碰不到這張表」兩種完全不同的原因**長得一模一樣**,
  主視窗 08-13 上午就是這樣誤判成「報價單側沒修好」的(報價單側 3c 也認同步交接不完整,雙方各一半)。

  | 驗收句 | 同步前 11:22 | 同步後 11:35 | 歸屬 |
  |---|---|---|---|
  | ① `product_fitments_effective` | 2 | **0 ✅** | 報價單管線產物(`pfe_sync_commit` 整表重建)⇒ **報價單側已交差** |
  | ② `product_fitments` | 3 | **3** | **我方直接表,不在同步管線裡** ⇒ 自己不會好 |
  | ③ `vehicle_taxonomy_public` | 2 | **2** | **VIEW,衍生自 ②**(`20260811100000:120-131`)⇒ 清 ② 它自動消失、不必也不能單獨清 |

  當日同步實跑紀錄:`product_fitments_effective_sync_log` = `2026-08-13 11:31:10 success`、149,286 列。
  🔴 **主視窗自記**:上一版假設寫「同步是 upsert 不刪除」,**機制錯**(`pfe_sync_commit` 實為
  `DELETE ... WHERE true` + 整批 INSERT,函式定義親撈讀過)。猜對的只有「同步不會清掉它」這個結果。
  ⇒ **我方待辦(要 Sean 點頭、走 migration)**:`product_fitments` 三列 ——
  `id 266581 / 266610`(Ducati `panigale v4`,年份空)改對大小寫**會與已存在的正確列撞重複**
  ⇒ **刪除**;`id 105925`(Honda `Forza 250 `,2018-2020)不撞、且是唯一一列 ⇒ **UPDATE 去尾空格**。
  (撞重複與否為實測,非推論;查法=對每列算出目標字面後 EXISTS 比對同 product/brand/model/年份。)
  ⚠️ 本 repo 內 `product_fitments` **只查到一處讀取**(`packages/adapters/src/supabase/helpers/fitment-queries.ts:51`)
  、零寫入路徑 ⇒ 清了應不會長回來;但「查無寫入者」**不等於**沒有,標**未確認**。
  ~~🔶 源頭已修、待 08-13 同步後驗收即可結案~~(2026-08-12 報價單側交接 `pcm-quote-v2@4d63acc` `docs/handoff/2026-08-12-409-model-name-cleanup-for-website.md`:小寫 2 筆=審核卡手填未正規化,程式+資料雙修、重複列已刪、正寫法 2,547 筆未動;`Forza 250 ` 尾空格=字典源頭修+全庫三輪掃歸零;皆非刻意保留)。原狀態:⏳ 待排(2026-08-11 #277 C 案實作時量到;主視窗 S-033-A 配號、Sean §3 拍 A)
- **⚠️ 驗收式已被報價單側修正**(我方原式尾空格那半跑錯表——effective 管線本來就 TRIM,該表今天就是 0=零判別力):08-13 我方 import 跑完後,三句**全部=0** 才結案:
  ```sql
  SELECT count(*) FROM product_fitments_effective WHERE model_code = 'panigale v4';
  SELECT count(*) FROM product_fitments        WHERE model_code = 'panigale v4' OR model_code LIKE '% ';
  SELECT count(*) FROM vehicle_taxonomy_public WHERE model_code = 'panigale v4' OR model_code LIKE '% ';
  ```
- 防再犯(報價單側,實作中):手填通道自動對齊字典寫法。
- **優先級:** 🟡 低-中(**今天零客人受影響**,但會讓下拉顯示一個小寫的車名,且有潛在拒寫風險)
- **問題**:資料裡同一台 Ducati 有兩個只差大小寫的字面 —— `"Panigale V4"` 與 `"panigale v4"`,
  **兩張表都各有兩種**,而且小寫版是**極少數**(2026-08-11 實查):

  | 表 | `panigale v4` | `Panigale V4` |
  |---|---|---|
  | `product_fitments` | **2 列** | 930 列 |
  | `product_fitments_effective` | **2 列** | 877 列 |

  🔴 **2 列打贏 930 列** —— 顯示名不是多數決,是排序決定的
  (`ORDER BY model_code` 下 `"panigale v4"` 排在 `"Panigale V4"` 前面)。
  這也讓修法變得很便宜:**每張表各改 2 列**。

  車輛下拉的節點鍵是 `normalizeVehicleQuery`(NFKC+trim+lower)⇒ 兩者會併成同一台車,
  但**顯示名取 first-seen**(`vehicle-taxonomy.ts:80,85`)⇒ 誰先被掃到誰就成為畫面上的名字。
- **#277 C 案換源後的實測**:用 app 真正的排序(`ORDER BY moto_brand, model_code, year_start, year_end`)
  比對換源前後的 first-seen 贏家,**全部 2,192 組裡只有這 1 組翻面**:
  `ducati "Panigale V4"` → `"panigale v4"` ⇒ **下拉會顯示小寫車名**。
- **潛在的第二個後果(比顯示更重要)**:`app/account/vehicle/actions.ts:41-53` 的 `validateDictPair`
  拿這份 taxonomy 當**寫入路徑的 fail-closed 字典**,而 `:47` 是**嚴格字串比對**
  ⇒ 存了輸家字面的客人,編輯愛車時會被判「所選車款不在清單中」。
- **現況量測(2026-08-11,決定它為什麼不緊急)**:
  ```sql
  SELECT count(*) AS total_dict_vehicles,
         count(*) FILTER (WHERE lower(btrim(dict_model_name)) = 'panigale v4') AS any_case_variant
  FROM customer_vehicles WHERE dict_model_name IS NOT NULL;
  -- 2026-08-11:total_dict_vehicles = 1、any_case_variant = 0
  ```
  ⇒ 全表只有 **1 筆**用字典的愛車,且**沒有任何一筆**命中這台車 ⇒ **今天 0 客人受影響**。
  ⚠️ 這是**時點觀察**:字典愛車功能被用起來之後,曝險會跟著長。
- **修法方向**:清資料 —— 把 `"panigale v4"` 統一成 `"Panigale V4"`。
  ⚠️ 要動的是**正式站資料**(`product_fitments` / `product_fitments_effective`,
  且 effective 每日 16:10 會被報價單側整表覆寫 ⇒ **只改網站庫會被蓋回去**,
  根治要在報價單側或匯入端)。⇒ 停點 = Sean;不是前台自己能收的。
- **順帶**:同族還有 `Honda "Forza 250 "`(尾端空格)—— 那個目前不會造成翻面,但同樣是字面不一致。
  一起清比較划算。
- **不修未來會痛在哪**:
  - 擴充性:任何「拿 taxonomy 的 name 當鍵去比對」的新功能都會踩到同一顆地雷(今天已有一個=寫入驗證)。
  - 可維護性:顯示名由「資料掃描順序」決定 ⇒ 換資料來源、換排序、甚至新增一筆別名,
    都可能讓畫面上的車名無聲改變,而**沒有任何測試會紅**。
  - bug 可追蹤性:客訴會長成「我明明有這台車,系統說不在清單中」,
    根因在兩個看起來一樣的字串,現場肉眼分辨不出來。
- **依賴**:#277 C 案(`20260811100000`)已把翻面量化;本條可獨立排。相關 = #389(matview 正解)。
- **發現於**:2026-08-11 / #277 C 案 關卡2 折 finding 時的 first-seen 贏家逐筆比對

### #410. 🧾 W7 收據的「新鮮度」鍵綁全域最新 migration ts ⇒ 一支新 migration 作廢全部收據;而**改既有 migration 零訊號**

- **狀態:** ⏳ 待決策(2026-08-11 立案:B 窗七代 §2 提出結構性代價、主視窗 B-447-A ④ 發號;
  第二個面向由 B 窗八代做 #399 時實查補上)
- **優先級:** 🟡 中(不影響正式站;影響的是**跑帳的成本**與**帳的判別力**兩頭)
- **同一把鍵、兩個方向都錯**:
  - **太嚴(七代提的)**:`scripts/w7-coverage.sh:179` `newest_ts()` = `ls supabase/migrations/*.sql | … | tail -1`
    = **全域**最新 migration 時戳,寫進每一支收據(`:253`)。任何人新增一支 migration,
    **全部**收據的 ts 立刻對不上 ⇒ 整本帳判 stale ⇒ 得重錄。每支都要 initdb + 重放全套 migration
    (`:45` 自己寫的組成:b2s2b 約 26 秒、op2b 約 15 秒、a7t 約 2 秒、其餘各約 10 秒上下;
    `:46` 已自註「別把組成式當精算」),
    重錄成本隨收編的 harness 數線性成長。**現況 34 支;整輪耗時未量**(檔頭那串是逐支估值,不是實測總時)。
  - **太鬆(#399 實作時實查)**:同一把鍵**看不見「既有 migration 被改內容」**——
    `newest_ts()` 只看檔名、收據第 6 欄的 sha 只覆蓋 harness 檔本身(`:180` `sha_of()` 吃 `$SCRIPTS/$1`)。
    每支 harness 都在 provision 時重放全套 migration(`d1t2-rehearsal.sh:65-74`:只跳過 pg_cron 相關兩支
    `20260723120000`/`20260809170000`),所以改一支舊 migration 是真的會改變它們跑的世界,
    而帳面**不會有任何一格變色**。#399 就是這個形狀的活例:它改了 `20260730140000`,
    全帳收據的判定一格都沒動。收據數的數法:`grep -vc '^#' scripts/w7-receipts.tsv` = **34**
    (與 `harness_set()` 實算的 34 支一致;`grep -c ''` 會多算兩行檔頭註解 = 36)。
- **不修未來會痛在哪**:
  - 擴充性:收編越多 harness,新增一支 migration 的「稅」越重 ⇒ 反過來變成**不敢收編**的誘因
    (而不收編的症狀就是 #402/#396/#399 這條線一直在治的「沒人跑的守門」)。
  - 可維護性:重錄一輪要人盯著跑,越貴越容易被跳過,跳過就退化成「帳面全綠但沒人真的跑過」。
  - bug 可追蹤性:改舊 migration 沒有任何訊號 ⇒ 一支 harness 從「真的驗過」變成「驗的是舊世界」,
    在帳上與正常狀態**完全同形**,只有實跑才分得出來。
- **修法方向(列案不拍,要 Sean 或主視窗選)**:
  - **A|per-harness 影響面釘值**:每支收據記「我這支會重放到哪些 migration」的集合雜湊,
    只有集合內的檔(新增**或內容改動**)才作廢它。判別力最好、實作最重(要先定義每支的影響面)。
  - **B|分層 ts**:把 migration 依前綴分層(例如 e10/l5b/op),收據記所屬層的最新 ts;跨層新增互不作廢。
    比 A 便宜,但層的邊界要人維護,且**仍看不見內容改動**。
  - **C|鍵改成「全部 migration 檔內容的 sha」**:一行就能改(`newest_ts` → 對 `supabase/migrations/*.sql`
    做 `shasum | shasum`),兩個方向一次解決 —— 代價是**變得更嚴**:任何一支 migration 改一個字元也全帳作廢。
- **依賴**:與 **#401**(重放式 harness vs 非冪等 migration)同家族**不同條** —— #401 治的是「harness 怎麼重放」,
  本條治的是「跑過帳怎麼判新鮮」。可各自獨立排。
- **發現於**:2026-08-11 / #402 重錄收據時量到成本(七代)+ #399 改既有 migration 時實查到零訊號(八代)
### #413. 🧪 `20260811100000` 檔尾守門擋得住「分支消失」、擋不住「anti-join 語意寫反」

- **狀態:** ⏳ 待排(2026-08-11 / S 窗三代留下、四代立案;主視窗 `S-049-A` 配號並裁「A=不做,落條目當已知邊界」)
- **優先級:** 🟡 低(**已 apply 的那一版語意本身經過兩輪對抗審查 + 實印對照**;本條是守門覆蓋率缺口,不是已知錯誤)
- **問題:**
  - `supabase/migrations/20260811100000_*.sql` 檔尾的斷言在**空庫重放**時會把「view 空」誤判成
    「view 壞掉」,故三代加了讓路(view 空**且**兩張底表也空才跳過)。讓路打開了一個新洞:
    空庫路徑上,view 定義被改壞也會靜默通過。
  - 三代補的是**與資料量無關的結構檢查**(view 定義必須含 `product_fitments_effective` 與 `UNION ALL`)
    —— 它擋得住「整個 UNION 分支消失」(實測情境 D:空庫 + 刪掉 effective 分支 → 退出碼 3 開火),
    **但擋不住 anti-join 的語意寫反**(例如 `NOT EXISTS` 寫成 `EXISTS`、或 join 條件少一欄):
    文字層看得到「分支還在」,看不到「它現在選出的是相反的集合」。
- **為什麼不補(2026-08-11 裁定,不是漏想):**
  - 要驗語意就得在空庫塞 fixture ⇒ 等於**讓 migration 寫底表**。那是拿「migration 只改結構」
    這條可審查的性質去換一格守門覆蓋,代價比洞大(而且 fixture 本身也會變成要維護的假資料)。
  - 替代覆蓋來源:真實庫上的重放不走讓路那條路(底表有資料 ⇒ 斷言照常開火,實測情境 B/C 涵蓋)。
    ⇒ 缺口只存在於**空庫重放**這一個場景,而空庫重放的目的是驗 harness、不是驗資料語意。
- **觸發事件:** (任一)①重放 harness 開始被當成語意回歸的依據 ②同型讓路被複製到別的 migration
  ③這支 view 的 anti-join 條件真的要改(屆時語意驗證要另找觀測點,不能靠這道守門)。
- **不修未來會痛在哪:**
  - 可追蹤性:守門的名字讓人以為「view 有被驗過」,而它只驗了形狀 —— 沒有本條,下一個人會把
    「重放全綠」當成語意背書。
  - 擴充性:同型讓路(「空庫就跳過」)只要被複製,同一個盲點就跟著複製。
- **依賴:** 無。相關 = #401(重放式 harness × 非冪等 migration 族譜)/ #277 C 案。
- **發現於:** 2026-08-11 / S 窗三代修「空庫讓路」時自己標出的誠實邊界(`S-047-STOP` §2)

### #415. 🧹 重 gen 之後,五個「文件化窄 cast」的存在理由已經消失(cast 還在、typecheck 被繞過)

- **狀態:** ⏳ 待排(2026-08-11 晚 `dd3cf733` 重 gen 的 R1 nit;主視窗發號)
- **優先級:** P2(不是缺陷,是**防護力被自己繞過**:每一處都讓 typecheck 對那條路徑失效)
- **背景**:這些 cast 當初都有正當理由 —— 對應的表/RPC 真的不在 `database.types.ts` 裡,
  具名呼叫過不了 typecheck。**2026-08-11 晚重 gen 之後那個前提整批消失**,
  但 cast 與註解留在原地 ⇒ 註解變成假的、cast 變成純粹的防護漏洞。
- **實查(重 gen 後,逐一 `grep '^      <名>: {' packages/adapters/src/supabase/database.types.ts` 皆 1)**:

  (**五個 cast、六個檔案位置** —— `EmailOutboxClient` 那一個的宣告與注入端分居兩檔。)

  | 檔案 | cast | 生成型別裡的對應物 |
  |---|---|---|
  | `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts` | `EmailOutboxClient` | `email_outbox` |
  | `apps/storefront/src/lib/email/composition.ts:49` | 同上(注入端) | 同上 |
  | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` | `AdminSearchOrdersRpcClient` | `admin_search_orders` |
  | `apps/admin/src/lib/customers/customer-repository.ts:139` | `TierRpcClient` | `admin_set_customer_tier` |
  | `packages/adapters/src/supabase/helpers/fitment-queries.ts:133/187` | `VehicleRpcClient` / `EffectiveFitmentsClient` | `search_products_by_vehicle` / `product_fitments_effective` |

  ⚠️ **不含** `SupabaseOrderAdapter` 的 `data as unknown as CreateOrderRpcResult` ——
  那支 RPC 的生成型別是 `Returns: Json`,Json→DTO 是**正當的邊界投射**,不在本條範圍。
- **這一條為什麼不當場做掉**:拆 cast 會**改變型別檢查的形狀**,每一處要配自己的行為驗證 ——
  · `admin_search_orders`:POST-only 那組原始碼掃描測試的**理由**會變(現在它是唯一守門,
    拆 cast 後 typecheck 接手一半)⇒ 要同步改測試註解、確認那組仍有判別力;
  · `admin_set_customer_tier`:tier 是權限面,參數名/回傳碼漂一個字就是 404/42501;
  · `email_outbox`:窄介面的方法簽章與生成型別逐欄對得上才行,且 mark* 三出口的世代柵欄
    不能因為型別放寬而失守。
  ⇒ 不是「順手改字面」那種工作,所以 2026-08-11 那顆只更正註解、不拆。
- **不修未來會痛在哪**:
  - 擴充性:每多一個呼叫端就多一處被 cast 繞過的路徑,而它們**看起來**是型別安全的。
  - 可維護性:註解已經被更正成「可拆」,但下一個人若只讀 cast 不讀註解,會以為那是必要之惡而照抄。
  - bug 可追蹤性:參數名或欄位漂移的症狀是**執行期 404/42501**,typecheck 全綠 ——
    也就是說,今天這幾條路的迴歸只能靠原始碼掃描測試接住,少寫一組就是全裸。
- **依賴**:無;`dd3cf733`(重 gen)之後隨時可排。建議一次做完五處,免得又留下一半。
- **發現於**:2026-08-11 / `dd3cf733` R1 nit(reviewer 點名三處;D 窗 grep 全樹後補出另兩處同族)

### #416. ✅ `a7t-verify.sh` 的 fail-closed 離場不收叢集 ⇒ 留下孤兒 PG(已修)

- **狀態:** ✅ 已修(2026-08-11 P 窗立案〔STATUS 72〕、B 窗八代施工;主視窗 B-455-A 派工)
  🔴 立案當下**只有號碼進 STATUS、沒有條目落 backlog** —— 本條由施工者補寫(內容=STATUS 那句 + 實查)。
- **優先級:** 🟡 中(不影響正式站;影響的是**下一個跑 harness 的人**會靜默連到孤兒庫)
- **事實(實查)**:`teardown` 原本只寫在**快樂路徑的尾巴**(`if [ "$MODE" = "all" ]` 那段),
  而旗標之後有 **14 條** fail-closed 離場(數法:
  `P=$(grep -n '^  PROVISIONED=1$' scripts/a7t-verify.sh | cut -d: -f1) && grep -n 'exit [12]' scripts/a7t-verify.sh | awk -F: -v p=$P '$1 > p' | grep -v ':[[:space:]]*#'`
  = 15 行,扣掉最後那條 `[ "$FAIL" -eq 0 ] || exit 1`〔在快樂路徑之後〕= **14**)。
  任一條走到,PG 就留著繼續聽那個埠 —— 2026-08-11 的 **54352 孤兒叢集**就是這個形狀。
  🔴 **數法的錨點刻意寫成 `^  PROVISIONED=1$`**:裸 `PROVISIONED=1` 會命中**寫這句話的註解自己**
  ⇒ 照著跑會拿到註解行號、整組數字錯位(code-reviewer 抓到;形狀=偵測字串同時存在於自己的輸入)。
- **不修未來會痛在哪**:
  - bug 可追蹤性:歷史上「後續 psql **靜默**連到孤兒庫」是真的發生過的事故(`d1t2-rehearsal.sh` 的
    埠佔用閘註解逐字寫著);⚠️ **今天已經不是靜默的** —— d1t2 的埠佔用閘是硬 `die`、a7t `run` 模式
    另有 CIDFILE 身分閘 ⇒ 現況是**吵的 fail-closed**。真痛點剩「埠被佔住、要人肉 `lsof` 找出來收」。
  - 可維護性:孤兒要人肉 `lsof` 找、手動 teardown;跑得越勤留得越多。
- **修法(本片)**:改用 **EXIT trap**(`cleanup_cluster`),條件 = `all` 模式且 `PROVISIONED=1`
  (`run` 模式的叢集是別人的、絕不碰;provision 之前的 exit 沒有東西要收);
  快樂路徑那段自己的 teardown 刪掉,兩條路走同一個出口。
  🔴 **只掛 EXIT、不掛 INT/TERM**(實測教訓在 `w7-coverage.sh`,數法=`grep -n '130→0' scripts/w7-coverage.sh`
  ⇒ 落筆當下 `:325`:掛上 INT/TERM 會把 130/143 洗成 0 = fail-open);
  trap 內不呼叫 `exit`、teardown 失敗一律 `|| true`,免得蓋掉真正的離場碼。
- **驗證(實跑)**:
  · 快樂路徑:`PORT=54375 … all /tmp/a7tv416` → `PASS=28 FAIL=0`、exit 0、埠空、workdir 已清。
  · 負測 A:在 provision 之後注入一發 `exit 1` ⇒ **exit 碼仍是 1**(沒被 trap 洗掉)、埠空、workdir 已清。
  · 負測 B(**真構造、非注入**;code-reviewer MF1 逼出來的):`chmod 000 scripts/d1-supabase-shim.sql`
    讓 provision 在 **`pg_ctl start` 之後**失敗 ⇒ `54377` 已收、workdir 已清、exit 1。
    旗標若照第一版設在「provision 回傳成功之後」,這一條收不到 —— 而它正是最會留孤兒的一條。
  · **消融**:同一發注入 + 把 `trap` 拿掉 ⇒ `54376` **仍在聽** = 舊行為真的會留孤兒(這格有判別力)。
    ⚠️ 第一次消融用 `/tmp` 的副本跑,`cd "$(dirname $0)/.."` 落到 `/` ⇒ provision 失敗、什麼都沒證到;
    改在 repo 內做才成立 —— **「腳本的副本」不等於「腳本」**,cd 相對路徑會換一個世界。
  · 收據:`bash scripts/w7-coverage.sh record a7t-verify.sh` 重錄(sha 過期)、`check` = **49/0**。
- **發現於**:2026-08-11 / P 窗 record 輪(54352 孤兒叢集查明)

### #417. 🧯 退款帳本「人工處置」沒有合法路徑 —— 回退閘叫人做的事被 append-only 擋死

- **狀態:** ⏳ 待排(2026-08-11 晚 L5b-2 片 2d 的 R3-Fable consider;主視窗 P-507-A 立案)
- **優先級:** P2(不是資料錯誤,是**災難日可用性**:3am 的 operator 會卡在兩道自家守門中間)
- **背景**:`scripts/l5b2-2d-rollback.sql` 的資料閘在表內已有 `result_confirmed` 事件時拒退,
  訊息逐字要求「要回退必須先由人處理這 % 筆」。但 `payment_refund_events` 是 **append-only**
  (`20260810140000:183-184` 兩個 trigger 擋 UPDATE / DELETE / TRUNCATE,SQLSTATE P5B01)
  ⇒ **訊息指示的動作沒有任何合法路徑**,而檔頭與 runbook 都沒寫逃逸法(誰、以什麼身分、怎麼處置)。
- **同族**:`scripts/l5b2-2c-rollback.sql` 的 `force_nonempty` 逃逸只覆蓋「快照非空」,
  不覆蓋「形狀不符」;形狀漂移時唯一出路是手寫 DDL。
- **要決定什麼(Sean 停點)**:①誰有權處置(owner? 只有 Sean 在場才准?)②動作是什麼
  (補一筆沖銷事件 vs owner 身分直接改資料 vs 只記錄不處置)③怎麼留稽核痕跡。
  **這三題都不是工程可以自己拍的**,所以本條不寫修法、只寫要決定的東西。
- **不修未來會痛在哪**:退款真的出事的那一天,回退腳本會把人停在一個「照著訊息做也做不到」的狀態,
  而那時的選擇通常是**繞過守門**(DISABLE TRIGGER / 直連 owner 改資料)——
  也就是說,沒有逃逸路徑的守門,實務上會訓練出「繞過守門」這個習慣。
- 🔴 **與 #405 是同一個決策**:#405(`manual` 填錯只能 owner 裸改)問的是同一件事 ——
  退款帳本的人工處置合法路徑。**兩條一起排、一次問 Sean**;#405 已經找到可抄的先例
  (`order_payments` 的 `reverses_payment_id` 沖銷機制,`20260810110000` / `20260810130000_*_op2b_reversal_invariants.sql`)
  ⇒ 若採沖銷事件路線,本條會**跟著一起解掉**(回退閘就能叫人補一筆沖銷,而不是叫人做做不到的事)。
- **發現於**:2026-08-11 / 片 2d R3(Fable)consider;`scripts/l5b2-2d-rollback.sql` 資料閘那段

### #418. ✅ 註解引用生成型別寫死行號 ⇒ 每次重 gen 就整批過期(五處已清、通則已寫)

- **狀態:** ✅ 已修(2026-08-11 B 窗八代;主視窗 B-455-A 發號、由 #415 的實查逼出來)
- **優先級:** 🟢 低(不影響行為;影響的是「照著座標去看」的人會看到不相干的行)
- **事實(#415 收工時實查,五處**在本片之前就已經過期**)**:

  | 引用處 | 寫的 | 實際(2026-08-11 實查) |
  |---|---|---|
  | `apps/admin/src/lib/payment/composition.ts:41` | `database.types.ts:11`(重 gen 命令) | `:38` |
  | `apps/admin/src/lib/orders/note-repository.ts:14` | `:19-22`(14 固定碼) | `:170` |
  | `packages/adapters/src/supabase/mappers/order.ts:588` | `:1456-1458`(`isOneToOne: false`) | `:1684-1686` |
  | `packages/adapters/src/supabase/mappers/order.test.ts:640` | 同上 | 同上 |
  | `packages/adapters/src/supabase/mappers/order.test.ts:391` | `:1268` / `:1273` | `:1487` / `:1492` |

  數法(可重跑):`grep -n "gen types typescript --project-id" …` / `grep -n "回 14 固定碼" …` /
  `grep -n -A 2 "payment_charge_attempts_order_id_fkey" …` / `grep -n "^          invoice_status: string" …`。
- **根因**:`database.types.ts` 是**生成檔**,每次重 gen(或補一組手動校正)整份行號就位移 ——
  它與「自己的編輯推移自己的行號」是同族,但更嚴重:**推移的人與被推移的人不是同一片**,
  所以寫的人當下是對的、也不會有人回頭看。
- **修法(本片做的)**:五處全部改成「**可重跑數法 + 落筆當下行號**」的形狀,例如
  `(數法=grep -n '^      admin_search_orders: {' …,落筆當下 :2898)`。
  ⇒ 行號變成**參考值**,錨點是那條命令;讀者跑一次就拿到現值。
- **通則(往後照做)**:引用生成檔(`database.types.ts`、未來任何 codegen 產物)一律附數法;
  ~~只寫 `檔案:行號`~~ 對生成檔不成立。**引用手寫檔仍可寫行號**(它們不會被機器整份重排)。
- **不修未來會痛在哪**:
  - 可維護性:座標指到不相干的行,讀的人要嘛白花時間、要嘛以為註解在講別的事。
  - bug 可追蹤性:註解是承重的(例:`isOneToOne: false` 是「必為陣列」那條推論的唯一依據),
    座標爛掉等於推論斷鏈,而**沒有任何守門看得到**(行號漂移不會讓任何測試變紅)。
- **發現於**:2026-08-11 / #415 code-reviewer MF3(我自己的編輯推移了行號)→ 回頭盤點全樹發現另五處早已過期

### #423. 🔒 手動收款登錄(OP5)**零稽核**:錢進帳了,但系統沒有任何「誰登的」的稽核紀錄

- **狀態:** ✅ 已修(`20260812150000_m4b_e10_423_payment_audit.sql`,與本條目同一批 commit;
  ⛔ **尚未 apply 到正式庫** —— apply 是主視窗的停點)。立案=2026-08-11 深夜 #15-B2-b2 關卡2、主視窗發號、P1
- **🔴 已修之後仍在的缺口(2026-08-12 關卡2 R2 實測,別讀成全清)**:三道稽核筆數守擋的是「寫不進去」,
  **擋不到「寫進去又被 AFTER INSERT trigger 刪掉」**(ROW_COUNT 仍為 1、函式回 `recorded: true`、稽核零列)。
  根因不在函式在表:`admin_audit_log` 的 append-only **只靠 GRANT**(該表 trigger 數實查=0),
  而 SECURITY DEFINER 是用**表 owner** 身分寫的、owner 刪得掉;對照 `order_payments` 早有
  `order_payments_no_delete_bd` 等四支 trigger 把這條路封死。⇒ 正確的面是**表層 append-only trigger**,
  不是在每支函式裡補檢查(函式內檢查擋不到 `CONSTRAINT TRIGGER ... INITIALLY DEFERRED`,那種在 COMMIT 才跑)。
  同族第二條:重放路徑的稽核若拋 `unique_violation`,會被函式尾 handler 收成通用訊息「收款登錄失敗」,
  而那時錢已在帳上 ⇒ 可能誘發換鍵重登=重複入帳;**今日不可構造**(該表唯一索引只有 uuid 主鍵、
  其餘四支非 unique),但有人替它加 unique 索引時就活了。⇒ 兩條歸 **#439**(表層 append-only),
  它同時保護 A6 備註線 / A9d2 取消線 / A7 等既有寫入者、不只本片兩支。
- **優先級:** **P1**(錢的路徑、且唯一的追人欄位其來源自陳「不是授權邊界」)
- **實查(兩層都證過,不只文字掃描)**:
  - 檔案層:`grep -c admin_audit_log supabase/migrations/20260810200000_m4b_e10_op5_record_manual_payment.sql` = **0**
  - 正式庫層(主視窗 catalog 唯讀實查,2026-08-11):`admin_record_manual_payment` 的 `prosrc`
    對 `admin_audit_log` **零命中**;`order_payments` 上**恰四支 trigger**
    (immutable / no_delete / received_at / reversal)**無一支寫稽核**
    ⇒ 缺口在**正式庫層面成立**,不是「migration 沒寫但 trigger 有補」。
- 🔴 **原本這裡寫「OP5 是這一族裡唯一的例外」—— 那是錯的**(2026-08-12 D 窗偵察,catalog 全掃):
  `admin_*` 的 volatile 函式共 19 支,**零稽核的有 7 支**:
  `admin_add_shipment_items` / `admin_create_shipment` / `admin_mark_shipment_shipped` /
  `admin_record_manual_payment`(本條)/ `admin_reverse_manual_payment`(**沖銷,也在錢的路徑上**)/
  `admin_unvoid_shipment` / `admin_void_shipment`。
  間接路徑已排除:非 `admin_` 開頭而會 `INSERT INTO admin_audit_log` 的函式**零支**、
  那七支的 prosrc 連 `audit` 字樣都沒有、app 層也不補(全 repo 立場一致:稽核由 RPC 同交易寫)。
  ⚠️ 原句引的是**檔案層 grep**(含註解與多次敘述),與 catalog 的 prosrc 命中數不可直接比;
  方向沒錯(那幾支確實有寫),錯的是「唯一」兩個字造成的**範圍印象**。
- **處置**:主視窗裁 Q-D13=B ⇒ **本條 = OP5 + 沖銷兩支一片**(同表/同 actor 來源/同 audit 欄位);
  出貨那五支另立 **#435**。
- 🔴 **落地後 `payment.*` 三個 action 的 `request_id` 全部不是 correlation id(讀稽核的人要知道)**
  ——原本這裡寫「有**一個**語意例外」,R3 Fable C2 指出那是**錯的範圍**:例外不是一個、是三個。
  - `payment.reverse` = **沖銷列自己的 id**(F1 裁定)—— 因為 `admin_reverse_manual_payment` 的介面
    只收 (payment_id, actor, reason)、**沒有 request_id 參數**,而 F1 要的是「這列指得回那筆沖銷」。
  - `payment.record` / `payment.record.replay` = **表單送來的冪等鍵 uuid**,由呼叫端產生、
    用途是「同一次互動重送要認得出來」,同樣**不是**貫穿 middleware→handler→audit 的那把 id。
  ⇒ 三者都與欄位 COMMENT 的 correlation id 語意(`20260712210000:63-64`)**不同**。
  數法(可覆驗):`20260812150000` 全檔兩處 audit INSERT 的 `request_id` 位置分別寫
  `p_request_id::text`(record / replay)與 `v_reversal_id::text`(reverse),
  **沒有一處**讀 middleware 產的那把 id ⇒ 拿 `req_` 那把去查這三個 action 是零命中。
  ⇒ 跨層追蹤時 `payment.*` **整族**要另外處理,不是只有 `payment.reverse` 一個。
- **今天唯一追得到「誰」的東西**:`order_payments.actor`(RPC 的 G2 只驗它存在且啟用)。
  🔴 而 `actor` 來自 picker cookie,`apps/admin/src/lib/session/actor.ts:6-7` **逐字自陳
  「這不是登入 / 授權邊界」** ⇒ 它記的是「畫面上被選的人」,**不得單獨作為責任歸屬證據**。
- **不修未來會痛在哪**:
  - bug 可追蹤性:對帳對不起來的那天,「這筆 3 萬是誰登的、什麼時候登的、從哪台機器」
    —— 只有一個可被任意選擇的字串,連「是不是同一個人連登五筆」都要靠猜。
  - 擴充性:沖銷(OP-A12)、退款態重登(OP-A13)接上來之後,錢的動作會更多,
    稽核缺口會跟著長大;等到那時候補,歷史資料永遠補不回來。
  - 可維護性:四支姊妹 RPC 都有寫,只有這支沒有 ⇒ 讀 code 的人會**預設它有**
    (我自己就在 `payment-actions.ts` 檔頭寫了「RPC 在同交易寫 admin_audit_log」這句假話,
     被關卡2 抓到;這條就是那個誤解的證據)。
- **修法方向**:在 OP5 的 G9 之後補一筆 `admin_audit_log`(同交易),欄位對齊姊妹片
  (action / actor / request_id / 目標 id / payload 摘要)。⚠️ **動 RPC = 鐵則 12 ①③**
  ⇒ 要新開 migration 片、走完整審查鏈,不可夾帶在 UI 片裡。
- **依賴**:與 B2-c 無關,可獨立排;但**排在 OP-A12(沖銷入口)之前**比較划算 ——
  沖銷那片本來就要動這一族 RPC 的權限與行為,一起做省一次審查鏈。
- **發現於**:2026-08-11 / #15-B2-b2 關卡2(codex)—— 它是對著我的**註解宣稱**去查 migration 才發現的

### #424. 🔁 重放 harness 的交易邊界:`d1t2-rehearsal.sh` 的 `psql -f` 該不該改成 `psql -1 -f`

- **狀態:** ⏳ 待排(2026-08-11 / S 窗四代由 #412 帶出;主視窗 `S-072-A` §3 配號並裁「屬 #401 族共用
  harness、不由 #412 那片發動」)。**掛 B 線。**
- **優先級:** 🟡 低-中(今天沒壞;是「假設不一致」的債,踩到時的症狀是重放假紅/部分套用)
- **問題:**
  - `scripts/d1t2-rehearsal.sh:79` 逐支 migration 跑 `psql "$(url)" -v ON_ERROR_STOP=1 -q -f "$f"`
    —— **沒有 `-1`** ⇒ 每一句自成一個交易(autocommit)。
  - 於是任何「假設整支跑在一個交易裡」的 migration,在重放時會**部分套用**:前半提交、後半炸掉,
    而 harness 的 `|| die` 讓整支重放死掉。#412 的第一版就真的踩到(檔尾斷言用 `TEMP TABLE …
    ON COMMIT DROP`,跨句消失 → `42P01` → 改名與子類已提交)。
  - repo 對「`supabase db push` 到底是不是單一交易」有**兩種互相矛盾的字面**:
    `20260810100000_m4b_e10_op1_order_payments_m.sql:152-157`(說逐句)vs
    `20260714120000_*.sql:41-45`(說同一隱式交易)。**這個分岔沒有被收斂過。**
- **codex 的論點(2026-08-11 關卡2 R4,轉述):** 由**執行端**提供交易邊界才對 ——
  檔內自己寫 `BEGIN/COMMIT` 會在 `psql -1 -f` 或「runner 自己包交易」時**提前提交外層**,
  讓後續的 ledger 記帳不再與 schema 同生共死。
- **要先量什麼(不是直接改):**
  - `psql -1 -f` 對**既有全部 migration** 的影響:哪幾支含「不能在交易內執行」的語句
    (`CREATE INDEX CONCURRENTLY`、`ALTER TYPE … ADD VALUE` 舊版、`VACUUM` 等)——有的話改 `-1` 會**炸**。
    數法:重放清單逐支掃這些關鍵字,再實跑一輪對照。
  - 已帶檔內顯式交易框的 migration(如 `20260811050000` / `060000`)在 `-1` 下的行為。
- **#412 怎麼繞過的(可當範式):** 把寫入與斷言收進**單一 `DO` 區塊** = 單一語句 ⇒
  不論執行端怎麼包都原子,**完全不依賴這個分岔的答案**。見
  `supabase/migrations/20260811120000_m4b_storefront_412_service_other_category.sql` 檔頭。
- **不修未來會痛在哪:**
  - 可追蹤性:重放紅掉時,分不出「migration 真的壞了」與「harness 的交易語意不同」。
  - 擴充性:每支新 migration 都要自己猜執行端的交易語意;猜錯的症狀是**部分套用**,而不是編譯錯。
- **依賴:** 無;相關 = #401(重放式 harness × 非冪等 migration 族譜)/ #412。
- **發現於:** 2026-08-11 / #412 關卡2 R3 M1(重放路徑實跑重現)+ R4 對修法的反對

### #426. 🕰️ `settings/suppliers` 的註解說「`is_active` 零下游消費者」—— 今天是假的,而它正在約束畫面文案

- **狀態:** ⏳ 待排(2026-08-12 / E 窗七代做完成地圖 §-8 例行時撞到;主視窗 `E-338-A` §3 裁定立案)。
  ⚠️ **#425 仍保留未寫**(=paid 短路格,隨 E 窗首顆實作 commit 帶)⇒ 本檔 #424 → #426 的跳號**不是遺漏**。
- **優先級:** 🟡 中(今天不會壞資料;痛在「員工看著假前提改文案」,而文案是對客承諾)
- **問題:**
  - `apps/admin/src/app/settings/suppliers/page.tsx:75` 的註解逐字:
    「🔴 也不得寫『停用後不會出現在新單的選單裡』:`is_active` 目前**零下游消費者**
    (`listSuppliers()` 全 repo 無生產呼叫端,採購表單 A10b 還沒做)⇒ 那是對未來的承諾」。
  - **兩條實查都推翻它**(2026-08-12 00:0x 現量):
    - 生產呼叫端存在:`apps/admin/src/components/orders/order-detail-route.tsx:115`
      `(async () => listSuppliers())()` —— 非 test 檔、非註解。
    - 它確實吃 `is_active`:`apps/admin/src/lib/supplier.ts:29`
      `rows.filter((row) => row.is_active).map(…)`。
    - 對照組:`supplier.ts:69` 的 `listSuppliersForSettings()` **刻意不過濾**(設定頁要看得到停用列)
      ⇒ 兩支的差別本來就只有這一條,**過濾行為不是推論、是該檔自己寫的契約**。
  - ⇒ `is_active` **已經有下游消費者**,那段註解是**過期的全稱句**(「全 repo 無…」型)。
- **為什麼不當場改(這也是本條要保留的判斷):** 那段註解不是純說明,它**正在約束畫面文案**
  (明文「不得寫『停用後不會出現在新單的選單裡』」)。改它 = 連帶重估 UI 對客承諾,
  而該承諾來自供應商線 plan §6「不得說停用功能已生效」+ 該片 R1 findings ⇒ **另一片、另一層審查**,
  不屬完成地圖維護的範圍(E 窗七代 §-8.5 只報不改)。
- **這片要做什麼(不是只改註解):**
  1. 量清楚 `is_active` 現在**實際**影響哪些畫面(目前只證了訂單明細路由那一跳,**沒窮舉**)。
  2. 依量到的結果決定文案能講到哪 —— 「停用後不出現在新單選單」現在**可能為真**,但要逐面驗過才准寫。
  3. 同步更正 `page.tsx:75` 的註解,並把它從全稱句改成**帶失效條件**的寫法
     (對齊 memory `feedback_withdrawal-reason-needs-expiry-condition`)。
- **不修未來會痛在哪:**
  - 可追蹤性:註解與實況相反時,下一個人會**照註解**推理 —— 他會以為停用功能還沒接通,
    於是不去查為什麼停用的供應商沒出現在某張單上,把真 bug 讀成「本來就還沒做」。
  - 擴充性:那句註解同時是**文案的守門**;它過期 ⇒ 守門擋的是一個已經不存在的理由,
    而真正該擋的(哪些面驗過、哪些沒驗)沒有人在擋。
  - 對外面:文案是對客/對員工承諾,**把假前提寫進畫面**的成本高於改一行註解。
- **依賴:** 無;相關 = 供應商線 S3a/S3b(`docs/specs/2026-08-01-e10-supplier-master-plan.md:123-124`)、
  A10b 採購表單(該註解引用的「還沒做」那片,現況未查)。
- **發現於:** 2026-08-12 / E 窗七代完成地圖 §-8 例行(`2e36d9c2` §-8.5);
  病型 = 本 repo 記過三次的「全稱句有保鮮期」,**差別是這次那句話住在 code 裡**(前兩次在完成地圖 §-2.1 / §-3.1)

### #427. 🛡️ `w6b3` 的守門用 `strpos(prosrc, 碼名)` 認「守門還在」—— 而那個碼名在註解裡也有一份

- **狀態:** ✅ **已修(2026-08-12,P 窗九代;沖銷片收尾 record 輪同批)**。
  修法落在 `scripts/w6b3-cancel-vs-receipt.sh:320-336`:①偵測前先剝 `--` 行註解 ②加**數量錨 `GUARD_N` 必須恰為 1**
  (原本的 `> 0` 對「碼名還在但守門變成別的形狀」仍過寬)。
  **判別力實證**(正式庫唯讀 `pg_proc` SELECT + 合成字串對照,2026-08-12):

  | 情境 | 舊寫法 `strpos>0` | 新寫法 `GUARD_N` |
  |---|---|---|
  | 現況(code 1 + 註解 1) | true | **1** ✅ |
  | 突變:拔掉 code、註解留著 | **true(恆真)** | **0 ⇒ 紅** ✅ |

  正式庫實測:`raw_hits=2` / 剝註解後 `guard_n=1` / `has_block_comment=false`
  ⇒ 檔內誠實邊界(「本式子擋不到 `/* */` 區塊註解」)當下成立、但那是**時點觀察**,不是恆真。
  <details><summary>原始立案內容(已完成,留存備查)</summary>

  ⏳ 待排(2026-08-12 / P 窗八代做 2e/2f 前置實查、查「母 plan `:296` 的 strpos 式子有沒有被抄到別處」時掃到;主視窗 `P-534-A` §3 裁定立案)。
  修法排程已定:歸沖銷片收尾的 **record 輪**(那輪本來就要動 `l5b2-2d-verify.sh` 19 處 + 重釘 LINE_TIP 錨)⇒ 同批做、單一寫者=P 窗,不另派人。

  </details>
- **優先級:** 🟠 中(今天不會壞資料、本格現在是真綠;痛在「它宣稱的職責是抓守門被拔掉,而守門被拔掉時它抓不到」)
- **問題:**
  - `scripts/w6b3-cancel-vs-receipt.sh:310` 的絆線:
    `SELECT (pg_catalog.strpos(prosrc, 'EXCEEDS_ROOM_AFTER_CANCELLATION') > 0) FROM pg_proc WHERE proname='admin_record_item_receipt'`
  - 它宣稱的職責逐字(`:306`):「**甲片的品項層守門仍在**(被拔掉 ⇒ 紅)」。
  - **實測**(2026-08-12,對正式庫 `admin_record_item_receipt` 的 `prosrc` 唯讀查;專案 `bmpnplmnldofgaohnaok`):

    | 量的東西 | 值 |
    |---|---|
    | `EXCEEDS_ROOM_AFTER_CANCELLATION` 原樣命中 | **2** |
    | 剝掉 `--` 註解後命中(`regexp_replace(prosrc,'--[^'\|\|chr(10)\|\|']*','','g')`) | **1** |

  - ⇒ 那個碼名在**程式碼 1 處(真守門)+ 註解 1 處**。有人把真守門拿掉、而註解留著
    (拔守門時留一句「原本這裡擋 EXCEEDS_ROOM_AFTER_CANCELLATION」是很自然的事)
    ⇒ `strpos` 仍 `> 0` ⇒ **本格照樣綠**,而那正是它唯一的職責。
  - ⚠️ **誠實邊界**:上表兩個數字是實測;「拿掉 code 那處、留註解 ⇒ 仍綠」是從 `strpos(x) > 0` 推的
    **一步機械推論、沒有真的跑那個突變**(該函式在正式庫上,不為了驗守門去動它)。
- **不修未來會痛在哪:**
  - **可追蹤性**:它是絆線,價值全在「狀態變了要叫」。恆綠的絆線比沒有絆線更糟 ——
    沒有絆線時人會去查,有一條假的絆線時人會**引用它的綠**當證據。
  - **擴充性**:同一招(`strpos(prosrc, 字串)`)在本 repo 至少還有一個實例會出同樣的錯
    (母 plan `docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md:296` 給 2f 的順序守門,
    已驗證它在 `admin_initiate_order_refund` 上量到的是註解)⇒ 這是**招式層的病**,值得一次修對兩處。
  - **bug 可追蹤性**:守門失效**零症狀** —— 不會紅、不會慢、不會噴錯,只會在真的出事那天沒有叫。
- **這片要做什麼:**
  1. 偵測前先剝註解:`regexp_replace(prosrc, '--[^'||chr(10)||']*', '', 'g')` 再 `strpos`(已驗證有效)。
  2. **配一發突變**:把 code 裡那一處拿掉、註解留著 ⇒ 本格**必須轉紅**(沒有這發就只是換了個寫法,證明不了判別力)。
  3. 順帶評估改成量「它做了什麼」(構造一筆超額到貨、斷言真的被那個碼擋下)—— 存在性斷言對「還在但失效」全盲。
  4. 改完照紀律 `record` 該支 + `check` 回帳(w7 收據 sha 會變),record 前確認沒有別窗在跑 harness。
- **依賴:** 無(可獨立做);排程綁沖銷片收尾的 record 輪只是為了共用同一次 record/check。
- **相關:** `docs/specs/2026-08-12-2e2f-precheck-recon.md` §3(母 plan `:296` 那條的完整實測)+ §4(本條);
  memory `feedback_guard-checks-existence-not-effect`(只檢查規則存在、沒檢查它做了什麼)、
  `reference_grep-keyword-count-includes-comments`(這次的載體是 `prosrc` 不是檔案)、
  `feedback_assertion-measures-the-wrong-thing`(偵測字串同時存在於自己的輸入)。
- **發現於:** 2026-08-12 / P 窗八代 2e/2f 前置實查(`535097a8`);
  病型 = 本 repo 記過多次的「守門只檢查規則存在」,**這次的新變形是那個字串被自己的說明文字複製了一份**。

### #428. 🟥 `refund-wiring.test.tsx:306` 的「帳本讀取失敗」斷言**恆綠** —— 拿整頁字串驗一個區塊專屬的宣稱

- **狀態:** ⏳ 待排(2026-08-12 / D 窗七代 #15-B2-c 片1a 的 code-reviewer R1 實測發現;
  主視窗 `D-539-A` §立案 配號 #428,**與本片無責、隨片1a 那顆 commit 帶進來**)。
- **優先級:** 🟡 中(不會壞正式站;壞的是**守門本身**——它承諾守的那件事今天沒人在守)
- **問題:**
  - `apps/admin/src/app/orders/[id]/refund-wiring.test.tsx:306` 逐字
    `expect(container.textContent).toContain('讀取失敗')`,意圖是驗「未登記額讀取失敗 ⇒ 帳本區塊顯錯誤態」。
  - 但 `讀取失敗` 這四個字在**同一頁的多個元件**都會出現。實查(`grep -rn '讀取失敗' apps/admin/src/components/orders/`)
    非測試檔命中:`refund-ledger-section.tsx` / `cancel-review-section.tsx` / `cancel-result-panel.tsx` /
    `notes-timeline.tsx` / `order-detail.tsx` / `order-detail-route.tsx` / `payment-list.tsx`(**片1a 新增的第七個來源**)。
  - ⇒ 斷言吃得到**第三方餵的字串**,與帳本區塊有沒有正確顯示無關。
- **reviewer 的突變證據(2026-08-12 實跑,轉述):** 把 `refund-ledger-section.tsx:75` 的文案改壞
  **並且**把 `<PaymentList>` 拿掉,該檔 **13 格照樣全綠** ⇒ 這條斷言從來沒有守住過任何東西。
- **修法(與片1a 用的同一招):** 把斷言鎖進帳本區塊那個 `section`(用它的標題當錨、找不到就 throw、不回 null),
  不要拿 `container.textContent` 整頁比對。片1a 的
  `app/orders/[id]/payment-list-wiring.test.tsx` 的 `paymentSection()` / `paymentText()` 可直接抄。
- **三視角:**
  - 可維護性:同一形狀在本 repo 已出現兩次(這條 + 片1a 第一版被自己抓到的那條)⇒ 值得在頁層測試的
    共用 helper 裡提供「取某區塊」的標準寫法,而不是每支自己 `container.textContent`。
  - bug 可追蹤性:這族錯的症狀是**永遠不紅**,不會有人來報。只能靠突變或 review 抓
    ⇒ 不修的代價是「帳本錯誤態」這條路日後被改壞時零告警,而它正是「勿依本頁發起退款」那句話的載體。
- **依賴:** 無。相關 = memory `feedback_assertion-measures-the-wrong-thing`(斷言量錯東西七形狀)。
- **發現於:** 2026-08-12 / #15-B2-c 片1a code-reviewer R1(opus)

### #429. 🧬 年份「無資料=通吃」有 **5 個判定點**,其中兩份是平行實作、彼此無一致性機制

- **狀態:** ⏳ 待排(2026-08-12 / S 窗五代由「年份 R2 選邊題」帶出;主視窗 `S-094-A` §2 批准配號)。
- **優先級:** 🟡 低-中(**今天五處方向一致、零客人可見問題**;債的形狀是「碰巧一致」而非「被綁住」)
- **問題:**
  - 「`year_start` 與 `year_end` 皆 NULL = 沒有年份資料」在我方**一律當通吃**(任何年份都命中),
    與報價單側 `COALESCE(ys,0)/COALESCE(ye,9999)` 同邊(2026-08-12 兩側對齊、已結案)。
  - 但寫著這條語意的地方有 **5 個**,其中兩個是**同一段邏輯的兩份實作**:
    ① `search_catalog_by_vehicle`(catalog 實查)② `search_products_by_vehicle`(述詞逐字相同)
    ③ `packages/adapters/src/supabase/helpers/fitment-queries.ts:31`(PostgREST `year_start.is.null,…`)
    ④ `packages/domain/src/catalog/year-range.ts` `matchFitmentYear`(`yearStart === undefined` 早退 true)
    🔴 ⑤ `packages/adapters/src/in-memory/InMemoryProductRepository.ts:220-226` ——
       **把 ④ 的外層三行自己抄了一份**(只 `import { resolveEnd }`,判斷式沒有呼叫 domain)。
  - ④ 能成立還壓在**一個對映**上:`fitment-queries.ts:169-171` 只在 `row.year_start != null` 時
    才寫入 `yearStart`/`yearEnd`,否則兩欄都省略 ⇒ `undefined` ⇒ 早退。
    寫成 `yearStart: row.year_start ?? null` 就會讓 ④ 倒向另一邊,而 ①②③⑤ 不動 = **同站內部不一致**。
    **這一跳目前沒有任何守門。**
- **預期解法(兩件,可同片):**
  1. 讓 ⑤ 呼叫 domain `matchFitmentYear`,而不是自己抄(消掉平行實作)。
  2. 補兩格測試,各配一個突變靶(**驗收就用這兩靶,不接受「測試有寫」**):
     - 靶 A:把 `fitment-queries.ts:169-171` 改成 `yearStart: row.year_start ?? null` → **必須有測試紅**。
     - 靶 B:拿掉 domain `matchFitmentYear` 的 `=== undefined` 早退 →
       **⑤ 那條路徑也必須有測試紅**(現況:不會紅,因為它跑的是自己那份)。
- **不修未來會痛在哪:**
  - **bug 可追蹤性**:改 domain 年份語意時,走 InMemory 的測試**照樣全綠** —— 綠燈與正式站行為脫鉤,
    正是本 repo 記過的假綠形狀(靶 B 就是為了讓它紅)。
  - **可維護性**:哪天要改「無年份」的語意(例如從通吃改成排除),必須**同時找到 5 個點**;
    而第 5 個在**測試 adapter** 裡 —— grep「年份篩選」時沒有人會直覺想到那裡,漏掉它的症狀是
    「正式站改了、測試還在用舊語意驗」。
  - **擴充性**:報價單側若哪天改邊(不再 `COALESCE(ys,0)`),我方要一次改 5 處;
    **沒有這張清單就會漏**,而漏掉的那處症狀是「同一商品報價單搜得到、網站搜不到」(或反過來)。
- **估時:** 30-45 分(⑤ 改呼叫 domain + 兩格測試 + 兩靶各實跑一次)
- **依賴:** 無(**不擋年份線任何一片**);Sean 決策不需要。
- **發現於:** 2026-08-12 / S 窗五代 年份 R2 選邊題實查 —— `S-091` 原本寫「四條路徑」,
  是**對 grep 結果的分類判斷、非實讀**(app 側 15 檔只開了 2 檔);全稱句守門攔下後補讀才找到第 5 個
  (更正見 `S-093-NOTE`)。
- **相關:** #277(車型/年份下拉 C 案)
- **分流標籤:** `P2-later`

### #431. 🕳️ 大批下架的 bypass **只留在執行者的 stdout** —— 正式庫零可事後查的紀錄(7/9 的 663 列就是這樣被找出來的)

- **狀態:** ⏳ 待排(2026-08-12 / S 窗五代由「bonamici 798 診斷」帶出;主視窗 `S-099-A` §2 批准配號)。
- **優先級:** 🟠 中(不是邏輯錯,是**事後查不出來**;下次再發生一樣要靠鑑識才知道)
- **問題:**
  - 🔴 **先更正一件事**:我原本向主視窗提的是「補一條 active 數變動閾值告警」——
    **那條守門其實已經存在**:`scripts/rpm-reconcile.ts:31` `DELIST_RATIO_ABORT = 0.1`,
    `:83-85` 待下架比例 >10% **硬 abort**,除非顯式帶 `--allow-large-delist`;
    來源集合為空時 `:80-82` **不可 bypass** 硬 abort。守門是好的、當天也一定擋過。
  - **真正的缺口在 audit**:被 bypass 時只設 `largeDelistBypassed=true`(`:87`)→
    `printReconcileReport` 印 loud log(`:266`)。**那行 log 只存在於執行者的 stdout**。
  - 2026-07-09 20:05:56 UTC 有一次 `applyDelist` 一口氣下架 **663 列**(佔當時 active 1,253 的 **52.9%**)
    —— 遠超 10% ⇒ **必然帶了 `--allow-large-delist`**。而 `gh run list --created 2026-07-09` 當天
    只有 3 次 CI(push)+ 20:41 的排程,**沒有任何一次落在 20:05** ⇒ 那次執行不在 CI,
    它的 stdout **沒有任何地方留著**。
  - 結果:要弄清楚「誰在什麼時候下架了 663 列」,唯一能用的證據是**時戳精度**
    (663 列共用毫秒級 `.966` = JS 側 `now`;另 135 列是微秒級 = 鏡射來源值)。**靠鑑識,不是靠紀錄。**
- **預期解法(擇一或並行,實作片再定):**
  1. `largeDelistBypassed` 為真時**寫一列到正式庫的稽核表**(誰/何時/供應商/比例/筆數/是否 CI),
     不只印 stdout。
  2. 排程 workflow 帶 `--expect-groups`:現況 `grep -c 'expect-groups' .github/workflows/rpm-sync.yml`
     = **0**(`:100` 實際只有 `--confirm-write --supplier=`)⇒ M2 群數指紋 gate 在每日排程裡**從未生效**
     (8/11 那輪 log 逐字:「未帶 --expect-groups…不強制」)。
     🔴 **但不能只寫「帶上 `--expect-groups`」——必須方向不對稱**:2026-08-12 bonamici 輪
     (run `31568037161`)active `455 → 1146`(+152%)是**正確且期望的復架行為**,
     若當時排程帶了以昨日群數為基線的 `--expect-groups`,這一輪**會被誤擋**。
     ⇒ 縮的方向硬擋(已有 `DELIST_RATIO_ABORT`),漲的方向只告警不 abort;
     或基線改取**來源側群數**而非我方 active 數。(出處:今日輪 + `S-124-NOTE` §「真正值得補進 #431 的一件新東西」)
  3. 評估是否禁止「非 CI 環境帶 `--allow-large-delist`」(要先確認人工救火場景不會被鎖死)。
- **不修未來會痛在哪:**
  - **bug 可追蹤性**:下一次大批商品消失,值班第一個問題是「是來源掉了還是有人跑了什麼」——
    現在**回答不了**,只能像這次一樣去比對時戳精度、再逐一排除 Actions run。這次花掉的是一整輪診斷。
  - **可維護性**:守門的 bypass 是**刻意設計**(救火要用),但 bypass 沒有帳 ⇒
    等於這個逃生口每被用一次,系統就失憶一次。
  - **擴充性**:未來要回答「這批下架是誰授權的」(對帳/客訴/供應商爭議)時,沒有任何欄位可查。
- **估時:** 45-60 分(稽核表 + 寫入點 + 一格負測:bypass 為真但沒寫稽核列必須紅)
- **依賴:** 無;**不擋每日同步**。相關 = #429 無(不同線)。
- **發現於:** 2026-08-12 / S 窗五代 bonamici 798 診斷(`S-098-NOTE`);
  🔴 條目本身經過一次自我更正:原提案「補閾值告警」在開檔實查後發現守門已存在,
  才收斂成現在的「bypass 無稽核」——**記在這裡免得下一個人又提一次已經存在的東西**。
- **分流標籤:** `P1-before-launch`

### #430. 💸 收款登錄的重複入帳:確認閘擋掉最常見那條路,**但擋不掉「員工看了明細仍誤判」**

- **現況(片2 落地後的實況,不是推測):**
  - `payment-record-form.tsx` 的印章(冪等鍵 `request_id` + 現金軌 `cash_received_at`)只有兩個來源:
    server 每次 render 鑄的新章、或失敗態帶回的舊章。**換鍵只由「開始下一筆」那顆鈕觸發**
    (九個突變靶逐條驗過,見 `payment-lifecycle.test.tsx`)。
  - 真正擋不住的那條路 = **表單全新掛載**。全新掛載時表單**無從知道**「上一次送出發生了什麼」——
    那正是重掛丟掉的資訊。此時唯一還在場的人是員工。
  - ⇒ Sean 2026-08-12 拍 **Q-D8=B**:全新掛載時送出鈕預設停用,要先勾
    「我已看過上方的收款明細,確認要登錄的是一筆新的收款」才啟用。
- **殘餘風險(本條目就是它):** 員工**勾了、也真的看了**,但
  ①收款明細那一次剛好慢一步 / 漏顯示,或 ②他把「上一筆別人登的」誤認成自己剛登的
  ⇒ 仍會登出第二筆。這條**在 UI 層擋不掉**:確認閘能做的只有「叫他去看」,
  看不看得懂、看的那一眼是不是最新的,程式無從驗證。
- **預期解法(擇一或並行,實作片再定):**
  1. **同單同金額近時窗提示**:送出前若同一張單在近 N 分鐘內已有「同軌別 + 同金額」的收款,
     跳一則具名確認(不是擋下,是逼他看見那一列)。
  2. **明細載入狀態進閘**:確認格的啟用條件從「`status === 'ok'`」收緊成
     「`ok` 且這一次的資料確實比表單掛載時間新」——擋掉①那半。
  3. 走事後面:沖銷流程(P 線 OP-A12)已能更正誤登,補一份「同單多筆同額收款」的對帳清單。
- **不修未來會痛在哪:**
  - **bug 可追蹤性**:重複入帳在畫面上與「客人真的付了兩次」**長得一模一樣**,
    今天要分辨只能靠人回憶。訂單量是每月 100-300 筆(memory `project_m4b-admin-preview-decisions`),
    不是「量小所以看得完」的規模。
  - **可維護性**:確認閘是**每次登錄都要多勾一格**的成本,而它擋的只有一半;
    不把另一半補上,遲早有人提「這格很煩、拿掉吧」——而那時沒有東西可以拿來反駁。
  - **擴充性**:第 1 案那種「近時窗同額提示」之後在退款、到貨兩條線都用得上,
    現在不做,將來就是三份各自手刻。
- **估時:** 40-60 分(第 1 案:查詢 + 確認 UI + 兩格負測:同額在窗內必提示、跨窗不得提示)
- **依賴:** 需要 `order_payments` 的讀取路徑(片1a 已通)。**不擋任何既有流程**。
- **發現於:** 2026-08-12 / D 窗 #15-B2-c 片2 plan v3 §5(`D-542-PLAN`);
  號碼由主視窗 `D-543-A:2` 配(我原寫 #429,當晚已被 S 用掉)。
  🔴 **R6 那關**:這個取捨是 **Sean 2026-08-12 拍 Q-D8=B**,不是我自宣接受殘餘風險。
- **分流標籤:** `P1-before-launch`

### #433. ⏳ `flag_non_unpaid_active_attempts` 的兩個「Phase 1 不可達」盲點 —— **當初的不可達論證前提已被退款 RPC 上線推翻**

- **狀態:** ⏳ 待排(2026-08-12 / E 窗八代寫 ④-a plan 草稿時順手量到;主視窗 `E-352-A` §3 批准配號)。
- **優先級:** 🟠 中(**不是已知正在漏,是「當初證明它不會漏的理由已經過期、沒人重估過」**)
- **問題:**
  - `supabase/migrations/20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql:27-35` 有一段 forward note〔F〕,
    誠實揭示同一根因的**兩面**盲點:
    ① `flag_non_unpaid_active_attempts` 的 `a.status IN ('pending','charged')` 閘 ⇒ **不收 `released`**;
    ② `mark_attempt_settle_retry` 的 order-`unpaid` 閘使其永不 fire ⇒ **12h `released_manual_review_at` marker 永不寫**
    (marker 唯一寫者=`mark_retry`)⇒ 該 `released` **完全隱形:不對帳、不掛人工**。
  - 🔴 它當初宣告「兩面皆不可達」的**理由**逐字是:
    「Phase 1 `released` 僅由 R1a3 CAS(order unpaid)產生、其 order **無正常路徑變 refunded/partiallyPaid**
     (…**Phase 1 無退款流程**)」,並自己註明「**Phase II 開退款前置**須一併處理」。
  - **那個前提今天不成立了**:M3 退款寫入 RPC(`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql`)
    已上線,訂單**確實有路徑**變 `partiallyRefunded` / `refunded`。
    ⇒ 〔F〕**自己寫下的失效條件已經到了**,但沒有人回來重估。
- **🔴 誠實界(這條**不**宣稱什麼):**
  - **沒有量過「是否真的存在同時有 `released` attempt 且已退款的單」** ⇒ **不宣稱它正在漏**,
    只宣稱**不可達論證已過期、需要重估**。要立案的是「重估」這件事,不是「修一個已證實的 bug」。
  - 難得的是原作者**寫了失效條件**,所以這條撿得起來
    (對照 memory `feedback_withdrawal-reason-needs-expiry-condition`:多數撤回理由沒寫到期日,過期了也沒人知道)。
- **不修未來會痛在哪:**
  退款單若殘留 `released` attempt,今天是**零告警、零標記、零對帳** —— 它不會出現在任何人工佇列裡。
  ⇒ 發現它的路徑只剩「客人打電話來」,而那時已經是客訴,且要靠鑑識回推(同 #431 的形狀:**沒紀錄,只能靠鑑識**)。
- **預期解法(重估後再定,不預先拍):**
  1. 先**量**:正式庫有沒有「`status='released'` 且其 order `payment_status` 非 unpaid」的列(catalog/資料面問,不是數 CREATE 敘述)。
  2. 若有 ⇒ 照〔F〕自己開的方子:`flag` 納 `released` + 12h marker 脫鉤 `unpaid` 閘(**兩面同一根因、同一片修**)。
  3. 若沒有 ⇒ 仍要把〔F〕那段的「Phase 1 不可達」改寫成**現況成立的理由**,不能留著已過期的論證(它會再騙下一個人一次)。
- **估時:** 量 15-20 分;若要修=高風險片(動 sweeper RPC 與 attempt 狀態機、鐵則 12③),另估。
- **依賴:** 無;不擋 ④ 線任何一片。
- **發現於:** 2026-08-12 / E 窗八代寫 ④-a plan 草稿(`docs/specs/2026-08-12-4a-paid-cancel-rpc-plan.md` §8)時,
  為了查清 `flag_non_unpaid_active_attempts` 的真實掃描條件而讀到 `20260624120008`。
  🔴 同一次查證還翻掉了 ④ 母 plan 的一條錯斷言(`paid` 不在該 RPC 射程,同 commit 已修)。
- **分流標籤:** `P1-before-launch`

### #434. 🧹 Next 16.3.0 `next dev` 自動產 app 層 `AGENTS.md`/`CLAUDE.md` —— 治本=`agentRules: false`(現行只用 .gitignore 擋)

- **現況:** Next 16.3.0 起 `next dev` 啟動即在 app 目錄產 `AGENTS.md` + `CLAUDE.md`(後者內容=`@AGENTS.md` 一行 @import;D 窗 08-12 實測於 `apps/admin/`,storefront 未測、同版推測相同)。Claude Code 對目錄層 `CLAUDE.md` 自動載入 ⇒ Next 的規則被注入每個在該目錄工作的視窗 context,與常載規則「永不加 @import」牴觸。
- **已做(治標):** `.gitignore` 加 `apps/*/AGENTS.md` + `apps/*/CLAUDE.md`(Sean 2026-08-12 拍 Q-D11=A)——只解樹髒,**擋不住自動載入**(檔案仍會被產出、仍在磁碟上)。
- **治本做法:** `next.config` 設 `agentRules: false`(啟動訊息自帶提示)。動 next.config=鐵則 8+12④ ⇒ 要小 plan+對抗審查,**隨下一個動 next.config 的片一起帶**、不單獨開片。
- **不修未來會痛在哪:** 可維護性=每個開 dev server 的視窗都被塞一份外來 agent 規則,與 PCM 制度檔打架時無人察覺;bug 可追蹤性=視窗行為異常時多一個看不見的規則來源要排除。
- **估時:** 併片 5 分(單一 config 鍵)。
- **依賴:** 無;等任一動 next.config 的片。
- **發現於:** 2026-08-12 / D 窗八代(`D-545-NOTE` §4)。
- **分流標籤:** `P2-after-launch-ok`

### #436. 🎭 admin RPC 的 `p_actor` 是**存在性驗證**,不是身分驗證 —— 稽核痕跡可被同一個 service_role 呼叫者冒名

- **狀態:** ⏳ 待排(2026-08-12 / 沖銷片關卡2 codex 抓到;**不是沖銷片引入的**,是整條 admin RPC 線的既有性質 ⇒ 沖銷片照先例做,不在本片射程)。
- **優先級:** 🟠 中(今天後台只有 Sean 在用、且尚未啟用 ⇒ 實際風險為零;痛在「等員工上工那天,帳本上的『誰做的』不可信」)
- **問題:**
  - `admin_correct_refund_manual_verdict` 的 G2(`supabase/migrations/20260812140000_*.sql:604`)只驗
    `p_actor` **存在且 `is_active`**,沒有把它綁到**實際呼叫者**。
  - 寫進帳本的 `actor` 欄(`:690`、`:739`)因此是「呼叫端說他是誰」,不是「他是誰」。
  - **同一形制在全線至少 5 支 migration 上一模一樣**(數法:
    `grep -rln "s.id = p_actor AND s.is_active" supabase/migrations/*.sql | wc -l` → **5**;
    `grep -rl "p_actor" supabase/migrations/*.sql | wc -l` → **17**)。
    最直接的先例=`admin_reverse_manual_payment`(`20260810210000` 的 G2)**逐字相同**。
  - 失敗情境:任何拿得到 `service_role` 的人(或後台的任一支 server action)呼叫時把 `p_actor`
    填成另一位在職員工的代號 ⇒ 沖銷列與新判定列都會**錯記成那個人做的**,而且帳本 append-only、改不掉。
- **不修未來會痛在哪:**
  - **bug 可追蹤性**:退款判定被改錯時,第一個問題一定是「誰改的」。這欄現在**答不了**那個問題,
    而它看起來像答得了 —— 比沒有這欄更糟。
  - **擴充性**:員工上工後每支 admin RPC 都會需要「真的是他」;越晚做,要回頭改的 RPC 越多(今天 17 支引用)。
  - **可維護性**:修法不是改一支 —— 要決定身分從哪來(Supabase JWT 的 `auth.uid()` / server action 帶簽章 /
    後台 session),那是**跨線的架構決定**,不該塞進任何一個功能片。
- **這片要做什麼:**
  1. 先決定身分來源(需 Sean 拍板:後台登入模型現況=E8-B 真認證線的射程)。
  2. 定案後,`p_actor` 改成「從身分推導」或「與身分交叉驗證」,失敗一律具名拒。
  3. 既有 17 支引用逐支評估(有些是 backfill/系統寫入,不適用)。
- **不修的話**:apply 檢查表 §六(知情缺口)已明寫這條,操作程序不得宣稱 `actor` 欄可當稽核依據。

### #437. 🎨 收款卡 UI 精簡+溢收標示(Sean 2026-08-12 肉眼驗四點拍板)

- **狀態:** ✅ **四點主體完工**(2026-08-12,`76aff2e3` 已入 dev,`git merge-base --is-ancestor 76aff2e3 dev` 驗過)。
  🔴 **殘題(還在 Sean 桌上的是這一題,不是四點)**:條目②尾的「訂單層已收足徽章」與④的已收足徽章被
  實作者讀成**同一顆**、只畫在收款卡頂彙總行,並逐字申報「若 Sean 要的是訂單標頭另外一顆,那是另一片」
  (`D-598-NOTE.md:73`)⇒ 待決 = **訂單標頭要不要再一顆**(選項:就一顆 / 標頭再一顆;
  已成題交主視窗排隊給 Sean,見信箱 `D-632-STOP`)。
- **內容(Sean 逐點):** ①標題「已登錄的收款」→「收款」②每筆列精簡單行(`信用卡 08/11 02:10 340元`),其餘(登錄於/憑證)收合點開看;訂單層「已收足」徽章(應收=已收時)③「登錄一筆收款」→「新增收款」,預設收合、點開才展開欄位 ④卡頂彙總行「應收 X/已收 Y」,三態標示:**已收足**徽章/**還差 N 元**(少收,Sean 08-12 補「少收也要注意」)/**溢收 N 元**(紅字)——**Q-溢收=A 只標不擋**(收兩筆定金等情境不被卡;DB 層實查 G3 只擋 ≤0、不擋超額=`20260810200000:168`)。
- **不修未來會痛在哪:** 可維護性=員工看到超收零提示,對帳靠人腦;bug 可追蹤性=溢收單靜默混在正常單裡;擴充性=「已收足」語意未來退款線(已收-已退)要重算,彙總行是它的掛載點。
- **估時:** 30-45 分(顯示層+收合互動+彙總計算;零 schema)。
- **依賴:** 無;片型預估=輕量-標準(不碰 packages/ui 行為則輕量)。
- **發現於:** 2026-08-12 Sean 肉眼驗 M-4a-15。
- **分流標籤:** `P1-before-launch`
### #435. 🔒 出貨線**五支** RPC 零稽核:箱子建了、作廢了、復原了,都沒有「誰做的」

- **狀態:** ⏳ 待排(2026-08-12 D 窗 #423 偵察時 catalog 全掃抓到;主視窗 `D-567-A:2` 裁定立案)
- **優先級:** P2(不是錢,但**是可對外的動作**:出貨影響客人收不收得到貨)
- **實查(catalog,不是掃 migration 檔)**:全掃 `public` 底下 `admin_*` 的 volatile 函式,
  比 `pg_proc.prosrc` 對 `admin_audit_log` 的命中數 —— 19 支裡 **7 支為 0**,其中五支是出貨線:
  - `admin_create_shipment`(建箱)
  - `admin_add_shipment_items`(加品項)
  - `admin_mark_shipment_shipped`(標記出貨)
  - `admin_void_shipment`(作廢)
  - `admin_unvoid_shipment`(復原)
  另兩支是 `admin_record_manual_payment` + `admin_reverse_manual_payment` ⇒ 已由 **#423** 處理。
- 🔴 **間接路徑已排除**(不是「透過 helper 寫」):
  - 非 `admin_` 開頭而會 `INSERT INTO admin_audit_log` 的函式:**零支**。
  - 那五支的 prosrc **連 `audit` 字樣都沒有**(逐支 `~* 'audit'` = false)。
  - app 層也不補 —— 但**理由不是「app 層從不寫稽核」**(2026-08-12 關卡2 R2 更正:原本這裡逐字寫
    「全樹 grep `admin_audit_log` 只有註解」,那句是**假的**)。實況:`apps/admin/src/lib/audit/`
    底下有活的 `SupabaseAuditLogRepository`(`supabase-repository.ts:22` 真的 `.insert(...)`),
    工廠在 `orders/order-repository.ts:39`。**但它的呼叫端只有一個**:`staff-actions.ts:61`(人員 CRUD)。
    ⇒ 逐支查過:出貨那五支**沒有任何 app 層呼叫端**在旁邊補寫稽核,結論不變、證據換成真的。
    錢與出貨這類有交易邊界的路徑,立場仍一致走 RPC 同交易寫
    (`supplier-repository.ts:101` 逐字「稽核由 RPC 同交易寫,本層不碰」)。
- **為什麼不併進 #423**:出貨的語意(建箱 / 加品項 / 出貨 / 作廢 / 復原)與收款不同 ——
  `action` 命名、`before`/`after` 要放什麼、哪些欄位算敏感,都要各自設計。
  硬併會讓那一片遠超 15-45 分(鐵則 4),而且審查焦點會被稀釋。
- **不修未來會痛在哪:**
  - **bug 可追蹤性**:客人說「我的東西被拆成兩箱寄」或「這箱怎麼被作廢了」,
    今天**答不出是誰、什麼時候做的**。作廢/復原尤其:那是一組可以互相抵銷的動作,
    沒有紀錄的話連「有沒有人反覆作廢又復原」都看不出來。
  - **可維護性**:#423 落地後,錢的兩支有稽核、出貨五支沒有 ⇒
    「這個系統到底有沒有稽核」變成要逐支查的問題,而不是一句話能回答的。
  - **擴充性**:未來要做「今天員工做了什麼」的檢視器(#423 的 `has_*` 設計已為它留縱深),
    出貨這一大塊會是空白。
- **預期解法**:照 #423 的形狀逐支補(同交易 INSERT + 筆數守恰 1 + 檔尾碼錨),
  但 `action`/`before`/`after` 各自設計;可拆兩片(建箱族三支 / 作廢復原兩支)。
- **估時:** 60-90 分(五支 + harness),**建議拆兩片**。
- **依賴:** 無。可在 #423 之後任何時間做;兩者不共用程式碼,只共用形狀。
- **發現於:** 2026-08-12 / D 窗 #423 偵察 pass(`D-566-NOTE` §3);
  🔴 這條的存在本身是個教訓:#423 原本逐字寫「OP5 是這一族裡唯一的例外」,
  **那句話是照檔案層 grep 寫的**;改用 catalog 全掃才看到真正的範圍。
- **分流標籤:** `P2-post-launch`

### #441. 🕳️ `admin_add_shipment_items` 形狀契約:**②③ 已補(2026-08-12)、① `W3B2-SHAPE-3` 恆綠仍缺**

- **狀態:** 🔶 **部分完成**(2026-08-12 B 窗:②③ 已補格+補靶並落 commit;① 仍待排)
  - ✅ **②非陣列 `p_items`** → 新增 `W3B2-SHAPE-12`(payload `'5'::jsonb`)+ 對應突變發;
    ✅ **③`quantity` 非數字** → 新增 `W3B2-SHAPE-13`(payload `{"quantity":"3"}`)+ 對應突變發。
    `EXPECT_TOTAL` 32→34、`KEYS_FROZEN` 同批補;清潔跑 `PASS=36 FAIL=0`。
  - ⏳ **① `W3B2-SHAPE-3` 對「元素須為物件」無判別力** —— **仍然成立、仍未修**。
    主視窗 2026-08-12 裁定:①要選路(讓該格多斷言訊息 / 換一個只會被物件檢查擋住的 payload),
    屬「動既有格驗收面」的決策,不順手拍 ⇒ 留在本條等排。
- **優先級:** P2(今日行為正確、無使用者可見症狀;它是**改約束那一天**才會咬人的地雷)
- **現況(拋棄式 PG17 叢集實跑,不是讀 code 推論)**:
  `scripts/w3b2-verify.sh` 的 `TMUT-SHAPE`(#420-4 新增,#441②③ 擴到 13 發)逐子條件放寬形狀契約,其中：
  - **① `W3B2-SHAPE-3` 對它宣稱守的規則沒有判別力。** 把
    `pg_catalog.jsonb_typeof(e.value) <> 'object'` 整條拿掉,`'[1,2]'::jsonb` 照樣被同閘的
    **下一個**子條件擋住 —— `?&` 對非物件回 false ⇒ `NOT (...)` 為真 ⇒ SQLSTATE 與
    CONSTRAINT **完全不變**(仍是 `P2B26|pcm_b2_w3b2_items_shape`)⇒ 該格**照樣綠**。
    唯一會變的是**訊息文字**,而該格不斷言訊息。
    (`TMUT-SHAPE` 因此對這一發改用「訊息換人」自證突變真的生效,並在 `ok` 訊息裡逐字寫明
     「第 3 發紅格為空」——**沒有拿空紅格充數**,但那只是誠實標註,不是修好。)
  - **② `pg_catalog.jsonb_typeof(p_items) <> 'array'` 當時沒有任何格對應**(✅ 2026-08-12 已補 `W3B2-SHAPE-12`)。發現當時 11 個 payload 裡
    `NULL` 打的是 `p_items IS NULL`、`'[]'` 打的是 `jsonb_array_length = 0`、`'[1,2]'` 是**陣列**
    ⇒ 「非陣列的 jsonb」(例如 `'5'::jsonb` / `'{}'::jsonb`)一個都沒送過。
  - **③ `pg_catalog.jsonb_typeof(e.value -> 'quantity') <> 'number'` 當時沒有任何格對應**(✅ 2026-08-12 已補 `W3B2-SHAPE-13`)。
    三個 quantity 格(`0` / `1.5` / `10000000000`)全是數字,打的是 `<= 0` / `floor` / `> 10000`
    三個**後續**子條件 ⇒ 型別那半從未被觀察。
- **預期解法**(原為三件;②③ 已於 2026-08-12 完成,**現僅剩 ①**):
  - ① 讓 `W3B2-SHAPE-3` 多斷言訊息(或改送一個**只**會被物件檢查擋住的 payload——需先確認
    這種 payload 是否存在;若不存在,則該子條件在現行條件順序下本來就是純訊息層的東西,
    結論要寫進 migration 檔頭而不是留在測試裡)。
  - ✅ **②③ 已於 2026-08-12 完成**:`'5'::jsonb` 與 `{"order_item_id":"<uuid>","quantity":"3"}`
    兩格,期望 `P2B26|pcm_b2_w3b2_items_shape`;`EXPECT_TOTAL` 與 `KEYS_FROZEN` 同批更新,
    兩發對應突變同批補(等價替換元突變證過:needle 換掉但守門沒放寬 ⇒ 該發必紅)。
  - ⚠️ 補格的同時要把 `TMUT-SHAPE` 的突變表一起補到對應發次,否則新格又是零靶。
- **不修未來會痛在哪**(2026-08-12 ②③ 補完後**收斂到 ① 這一個面**):`W3B2-SHAPE-3` 現在**不會因為「元素須為物件」那條規則壞掉而變紅**。
  形狀契約是 `admin_add_shipment_items` 唯一的入口驗證,而它擋的是「髒 payload 落到取鎖/歸屬/
  INSERT 才炸成 raw 23502 / 22P02 / 22003」——那些 raw 錯誤對員工是天書、對 app 層是未分類例外。
  真正的引爆點是**有人改動這段條件順序或條件本身的那一天**:
  改壞 **①**(把「元素須為物件」那條刪掉或改壞),`w3b2-verify.sh` 全綠、CI 全綠、審查看不到。
  「測試全綠」在 ① 這個面上**不構成任何保證**,而條目沒寫的話沒人知道 —— 這才是要修的東西。
  (②③ 自 2026-08-12 起已各有一格 + 一發突變承重,不再屬於本段。)
- **依賴:** 無。可獨立做。動的是 `scripts/w3b2-verify.sh` 與(若走 ① 的第二條路)
  `supabase/migrations/20260807230000_*.sql` 的檔頭說明,不動函式行為。
- **估時:** ①**剩約 15-20 分**(視採哪條路再定);②③ 已完成(實際約 25 分)。
- **發現於:** 2026-08-12 / B 窗 #420-4(`TMUT-SHAPE` 補靶)。🔴 值得記的是**發現方式**:
  這三條不是讀 code 讀出來的,是**補靶時被靶自己逼出來的** —— 「拿掉這條規則,哪一格會紅?」
  問到第 3 發時答案是「沒有」。零靶的族不只是「缺一發突變」,它同時也在**掩蓋自己有多少格是恆真的**。
- **分流標籤:** `P2-post-launch`

### #439. 🔒 `admin_audit_log` 的 append-only 只靠 GRANT:表 owner 刪得掉,所有稽核筆數守都繞得過

- **狀態:** ⏳ 待排(2026-08-12 D 窗 #423 關卡2 R2 codex 抓到 + 拋棄式叢集實測;D 窗立案、號碼待主視窗確認)
- **優先級:** P1(它是**所有**稽核保證的地基:錢的兩支 #423、備註線 A6、取消線 A9d2 全躺在上面)
- **現況(實測,不是推論)**:
  - 掛一支 `AFTER INSERT ... FOR EACH ROW` 刪掉剛寫的列之後,`admin_record_manual_payment(...)`
    回 `{"recorded": true, ...}`、`order_payments` 有 1 列、`admin_audit_log` **0 列** ——
    筆數守沒發火,因為 `GET DIAGNOSTICS ROW_COUNT` 看到的仍是 1。
  - `SELECT count(*) FROM pg_trigger WHERE tgrelid='public.admin_audit_log'::regclass AND NOT tgisinternal` = **0**。
  - 對照組:`order_payments` 有四支 trigger,其中 `order_payments_no_delete_bd` / `order_payments_immutable_bu`
    把刪改整條封死(實測刪列被擋、錯誤訊息逐字「收款帳本不得刪列」)。
  - 該表現行 append-only 只到 GRANT 層(service_role 無 UPDATE/DELETE),而 SECURITY DEFINER
    是用**表 owner** 身分寫的 ⇒ owner 這條路沒人擋。
- **預期解法**:照 `order_payments` 的形狀,在 `admin_audit_log` 上加 BEFORE UPDATE / BEFORE DELETE
  的 RAISE trigger(一支或兩支)。⚠️ 這是**表層**修法、刻意不在每支函式裡補「寫完再 SELECT 確認還在」——
  後者擋不到 `CONSTRAINT TRIGGER ... INITIALLY DEFERRED`(COMMIT 才跑,函式內看不到),補了是半套。
- **同批一起收的第二條**:重放路徑的稽核 INSERT 若拋 `unique_violation`,會被 OP5 函式尾的
  `WHEN unique_violation` handler 收成通用訊息「收款登錄失敗」—— 而那時錢**已經在帳上**,
  員工可能換一把 `request_id` 重登 = 重複入帳。**今日不可構造**(該表唯一索引只有 `admin_audit_log_pkey`、
  uuid 預設值;其餘四支索引皆非 unique,實查)⇒ 它是**未來替該表加 unique 索引時才會活**的地雷。
  處置=加 unique 索引的那一片必須同時收窄 handler,或本片就先把 handler 收窄到只包 `order_payments` 那段。
- **不修未來會痛在哪**:稽核的價值全部建立在「有寫就一定在」。這道沒補之前,
  「查不到那列」與「本來就沒發生」在事後**分不出來**,而稽核存在的唯一理由就是分辨這兩件事。
  且它是靜默的:出事當下零錯誤、函式回成功。
- 🔴 **本案上 trigger 的同一片必須一起收的第三條(R3 Fable C1)**:OP5 重放路徑的稽核筆數守
  (`20260812150000` 的 `pcm_op5_audit_replay_row_count`)觸發時,**錢早已在前一個交易 commit**,
  它回滾的只有本次重送。但 app 層 `payment-action-state.ts` 對這一路的文案逐字是「已整筆回滾」
  —— 對重放這一案**是假的**(回滾的不是那筆錢)。今日不可達(該表 trigger=0 ⇒ 稽核不會被吞),
  **本案上 trigger 之後就可達**。⇒ 驗收條款:本案同片要把重放守換成**專屬 SQLSTATE**
  (不與正常路徑共用 `P2B40`),並讓 app 層對它給「這筆收款先前已入帳、請勿重新登錄」的文案。
  ⚠️ 這條是「修 A 開了 B」的典型:沒有本案的 trigger,C1 永遠不會發生;有了 trigger,它就成真。
- **依賴:** 無。可獨立做;做完 #423 檔頭與 COMMENT 裡的「擋不到刪列」那段申報要一起撤。
- **估時:** 30-45 分(一支 migration + 負測:掛刪列 trigger 後應被表層擋下、且 #423 的三道守門行為不變)
  + C1 的 SQLSTATE 與文案(含一格負測:重放守觸發時員工看到的字不得是「已整筆回滾」)。
- **發現於:** 2026-08-12 / D 窗 #423 關卡2 R2(codex 小包 P1 ①②③)+ D 窗拋棄式叢集實測驗證;
  C1 由 R3 Fable 補。🔴 **#438 為作廢號**(S 線上午提案佔號、中午自查發現與 #431 重複而退號,
  主視窗裁作廢封存不回收,`S-127-A §1`)—— 本案原誤取 #438 後依 `D-591-A:9` 改 **#439**。
  誤取的成因值得記:我的取號數法是「worktree backlog 最大 + `dev` 端 backlog 最大」,
  而**退號不會在任何一份 backlog 留下條目** ⇒ 那個數法對已退號永遠盲。取號要另外問主視窗台帳。
- **分流標籤:** `P1-pre-launch`

### #440. 🔒 結案否決未涵蓋在途的 `order_refunds`(訂單層退款單處理中,結案照樣成功)

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2e 之 codex R2 折疊時實測量出;Sean 同日拍 **Q-2e-D2b=A**=2e 照現況收、缺口另片補)。
- **實測(P-573-NOTE §2):** 先 paid → 登記 `processing` 的 `order_refunds` → 把 orders 改回 unpaid ⇒ `close` 回 `{"closed": true}` 零攔阻。2e 的否決只查 `payment_refunds`(attempt 尺度)。
- **為什麼不併進 2e:** 擴否決到 `order_refunds` = **改述詞**、觸母 plan `:268`;`P-561-A` 裁 Q-2e-2=A 的理由正是「加否決非改述詞」——擴了就不是同一件事,要自己一輪關卡1+審查。
- **既有契約:** harness **D2b 格**期望值刻意=「缺口存在」;**本案補好那天 D2b 會變紅=改 plan §9-1 的申報、不要改期望值**(P-573-NOTE §2 逐字)。
- **不修未來會痛在哪:** bug 可追蹤性=結案後退款單還在跑,帳目狀態互相矛盾時答不出哪個是真;可維護性=值班要人腦記「結案≠退款結清」。
- **估時:** 30-45 分(否決述詞+負測;高風險片=錢,鐵則 12①)。
- **分流標籤:** `P2`

### #442. 🔒 卡住的補償退款在 Q-2f-2=B 之下**永久隱形**(不擋單、也不顯示,沒人會去處理)

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2f 之 R2 Opus MF-C / R3 Fable F2 抓出;**2g 硬前置**)。
- **形狀在 Sean 拍 B 之後反轉了,而且變嚴重:** A(擋)之下,一筆卡住的補償退款會**擋住該單後續退款** —— 很吵、**一定會被發現**;B(放行)之下它**不擋也不顯示** ⇒ 零訊號,沒有人會去跑 `admin_correct_refund_manual_verdict`(`20260812140000:572`)。**B 拿掉的正是「卡住」唯一的生命週期壓力。**
- **怎麼卡住的:** 退款寫了 `result_success`(TapPay 已受理)但 `result_confirmed` 永遠沒到(對帳沒跑/跑了判不出)。終局集合逐字 = `result_confirmed / result_failed / manual`(`20260811110000:201`)。
- **🔴 範圍更正(2026-08-12 diff 層 R1;原句把範圍寫大了):** 原本寫「或停在 `result_unknown`/`reconcile` 沒人補判定」也算隱形 —— **那是錯的**。停在那兩態的退款**仍然會擋單**:2f 的三條 `NOT EXISTS` 對它們全為真(無有效終局、未被沿鏈接手、無 `result_success`)⇒ 它們走的是「很吵、一定會被發現」那條路。**隱形的必要條件是身上有 `result_success`。** 本條 backlog 的範圍以此為準,別照舊句去找那兩態。
- **修法:** 值班要看得見「已受理但久未確認」與「無終局且未被沿鏈接手」的 `payment_refunds`;現行退款異常清單只讀 `order_refunds`(見 #443),看不到這本帳。
- **不修未來會痛在哪:** bug 可追蹤性=那筆錢的狀態永遠停在未確認,帳面上像沒事,客訴進來才發現、查起來要翻 DB;可維護性=沒有任何畫面能回答「有沒有卡住的補償退款」。
- **估時:** 60-90 分(查詢 + 清單頁;高風險=錢,鐵則 12①)。
- **分流標籤:** `P1`

### #443. 🔒 退款異常清單只讀 `order_refunds`,看不到 `payment_refunds` ⇒ 員工看到的文案承諾不會兌現

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2f 自查 + R2 Opus IMP-19 獨立命中同一處;**2g 硬前置**)。
- **文案 vs 程式是同一條不變式,現在兩邊各自綠:** `REFUND_IN_FLIGHT` → `apps/admin/src/lib/payment/refund-actions.ts:290-291` → 文案 `refund-action-state.ts:123-124` 逐字「…**若超過 30 分鐘未完成,會出現在異常清單**」;而異常清單的 `listRefundExceptions`(`apps/admin/src/lib/payment/refund-read.ts`)**兩支查詢都是 `.from('order_refunds')`** ⇒ **對 `payment_refunds` 零可見度**。
  ⚠️ **2026-08-14 行號更正**:原句釘 `:121` / `:126`,`473b-2` 改成兩支查詢後那兩個行號已失效;**本條結論不受影響**(換的是查詢結構,不是查哪張表)。此處刻意改成不寫死行號。
- **2g 之後就會發生:** 阻擋源是 `payment_refunds` 那半時,員工照文案等,**那筆永遠不會出現在清單裡**;而且 caller 把 `blocking_payment_refund_id` 丟掉(`refund-repository.ts`),員工也**無從分辨兩種阻擋源**。
- **修法二擇一:** ①清單擴到兩本帳(與 #442 同一個式子,建議合併做)②改文案、並把 blocking id 帶到畫面。
- **不修未來會痛在哪:** 可維護性=文案承諾一件系統做不到的事,員工的等待是白等;bug 可追蹤性=值班分不出被擋的原因來自哪本帳。
- **估時:** 45-60 分(與 #442 合併做可省一半)。
- **分流標籤:** `P1`

### #444. 🔒 `payment_charge_attempts.order_id` 無 immutable 守門 ⇒ 2e 與 2f 的鎖鍵與否決尺度會**靜默**認錯單

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2f 之 R1 codex MF2 抓出;母 plan §3a-5 `:264-266` 對 2e 已認過同一假設)。
- **兩片共用同一個假設:** 2e 用它算 advisory 鍵(無鎖預讀 `order_id`)、2f 用它定否決尺度(`JOIN attempts ON ... WHERE a.order_id = p_order_id`)。該欄**沒有 CHECK、沒有 trigger 擋 UPDATE** ⇒ 只是「目前沒有人改」的**時點觀察**,不是 schema 不變量。
- **失敗情境:** 某退款父列原屬訂單 A,其 attempt 的 `order_id` 被改成 B ⇒ A 的在途退款**漏擋**(A 可以再開一筆)、B **被誤擋**。兩個方向都錯,而且**無聲**(不報錯)。
- **修法:** 加 BEFORE UPDATE trigger 或 generated-column 化,禁止 `order_id` 變更;附負測(改它必須 RAISE)。
- **不修未來會痛在哪:** 擴充性=任何人日後加一條會 UPDATE 該欄的路徑,**兩片同時失效**且沒有任何守門會叫;bug 可追蹤性=症狀是「退款偶爾擋錯單」,根因在另一張表的一次 UPDATE,幾乎追不到。
- **估時:** 30-45 分(trigger + 負測;動 schema=鐵則 12③)。
- **分流標籤:** `P2`

### #445. 🔒 本地零超退防護:100 元的單可以送出 99999(Sean 2026-08-12 **知情推翻拍板⑤**,決定要做)

- **狀態:** ⏳ 待排(**排 2g 之前**;Sean 2026-08-12 拍 `Q-超退閘=做`)。🔴 **與 #442/#443/#444 不同:那三條 2g 前不可達,本條今天就是活的。**
- **現況三層都不擋(全部實查):** ①RPC 明文零守門 —— `20260803150000:25` 逐字「拍板⑤:**零超退守門**(金額上界不設;TapPay 10051 是權威)」、`:298` 逐字「不含任何超退檢查」②輸入端唯一上界是 PG int32 約 21 億 —— `apps/admin/src/lib/payment/refund-form.ts:35,107`,**不是那張單的剩餘額** ③`v_frozen := p_amount`(`20260803150000:485`)partial 完全不查帳。
- **有一個式子會扣在途,但它不是閘:** `pcm_order_refundable_remaining`(`20260803150000:394-408`)SUM 含 `processing`,**但** `:410` 逐字「**不是守門、沒有 trigger 讀它**」;全 repo 唯一呼叫點是顯示路徑 `refund-read.ts:95`。而且它**只算 `order_refunds`**,`payment_refunds` 一毛不扣。
- **為什麼現在才做:** Q-2f-2=B(受理即放行)之後,**TapPay 成為唯一防線**,而它①只有 sandbox 實證(母 plan `:339-341`)②partial 路徑我方完全不查帳 ⇒ 兩個洞疊加。
- **要做的四件事:** ①式子擴成兩本帳都算在途 ②從顯示升格為守門,**明確決定 fail-open / fail-closed 方向** ③輸入端上界改成該單剩餘額 ④順帶把 #442 的隱形卡單可見化(同一個式子)。
- **🔴 做完也不得宣稱「本地擋得住超退」:** Sean 在 TapPay Portal 場外退的錢**永遠在帳本之外**(`20260803150000:410` 逐字「真實剩餘額 ≤ 本值」)⇒ 只能宣稱「**擋得住本系統自己造成的超退**」。名字大於實力的防護比沒有防護更危險。
- **不修未來會痛在哪:** 錢=員工手滑或客服口誤就送得出超額退款,擋不擋全看 TapPay,而我們對正式環境的拒絕行為只有 sandbox 證據;可追蹤性=被拒之後才知道超額,偵測時點永遠在送出之後。
- **估時:** 90-120 分(高風險=錢,鐵則 12①;含 fail 方向決策題)。
- **分流標籤:** `P1`
### #446. 🎭 沖銷之沖銷後,被沖那列的「已沖銷」徽章**退不回去** —— 列上的字與彙總行互相矛盾

- **現象:** 收款列 A 被沖銷(產生沖銷列 B)⇒ A 掛「已沖銷」徽章。若接著沖掉 B(沖銷之沖銷,
  Sean 2026-08-10 拍板的誤沖更正路徑),帳上 A 的錢**已經回到「已收」裡**(`SUM(amount)`:
  6800 − 6800 + 6800 = 6800),但 **A 那列仍然掛著「已沖銷」**。
  判定用的是 `reversedPaymentIds`(`payment-list-view.ts`),它只問「有沒有任何列的
  `reverses_payment_id` 指向我」——**沖銷列自己被沖掉了,那個指向仍然存在**。
- **為什麼是設計題不是 bug:** 「A 被沖過」在歷史上是**真的**,徽章沒說謊;
  說謊的是它暗示的**現值**。要修就得決定徽章講的是歷史還是現況,而那會連動
  「已沖銷的列要不要能再沖一次」(現在 `canReverseByRow` 拿它當否決條件)。
  兩種讀法都自洽,**要 Sean 拍**,不是實作可自行決定的。
- **不修未來會痛在哪:** 員工看列信徽章、彙總行才說真話 ⇒ **同一張卡上兩個面互相矛盾**。
  最具體的誤操作誘因:他看到 A 標「已沖銷」而彙總說「已收 6,800」,
  會以為帳算錯了,於是再登一筆收款 ⇒ **重複入帳**。這正是 #430 那一族的形狀。
- **選項(給 Sean 的雛形,實作前要成題):** ①徽章改講現況(A 的沖銷被沖掉就撤下徽章)
  ②徽章維持歷史、但加一行「這筆沖銷後來被更正了」③彙總行旁邊標「本單有沖銷之沖銷」。
- **估時:** 語意層 15 分 + 元件與測試 15 分 + 決策題往返(Sean 拍板後才動)。
- **發現於:** 2026-08-12 / D 窗 #372-A12 沖銷入口片 關卡2 R2(fresh Opus,nit6);
  主視窗當場裁「設計題不在本片,開 backlog 發號 #446」。
- **分流標籤:** `P1-pre-launch`

### #447. 🧱 訂單列表的**雙 markup 到期日** —— 桌機表格與手機卡片各寫一份,每加一欄就多欠一份

- **現象:** `orders-table.tsx` 同時維護兩份 markup(桌機 `<table>` 的 rowSpan 列 + 手機 `<ul>` 卡片),
  同一個欄位要寫兩次、兩份各有自己的槽位規則。檔頭 `:50-53` 與共用元件
  `shared/admin-data-table.tsx:16-22` 兩處都已寫死警告,逐字:「**A13 的操作欄(取消鈕)一落地
  就會重現重複表單與重複 client 狀態** ⇒ 屆時改成單一 markup + CSS reflow,或讓帶互動的欄位
  只在主標/靠右槽出現一次」。
- **A13(訂單列表操作欄)落地後的實況(2026-08-12):** 到期日**還沒到,但更近了**。
  本片刻意只放**連結**(零 client 狀態)⇒ 重複的只是一個 `<a>`,沒有重複表單、沒有重複 state。
  代價是那一欄的**每一條紀律都要寫兩遍**:`relative z-10`(否則被 stretched link 蓋住)、
  已取消不給入口、目的地各自沿用同槽 —— 現在靠 `orders-table.test.tsx` 的 A13 那組
  與 `shipping-selection.test.tsx` 的 z-10 分類格**兩邊各釘一次**才擋得住。
- **要做什麼:** 決定並執行其一 —— ①單一 markup + CSS reflow(`<table>` 改 grid/flex、桌機手機共用一份 DOM)
  ②維持兩份,但把「帶互動的欄位」約束成只在一個槽出現(要一條機械守門,不是口頭約定)。
  ⚠️ 這是**設計題**:兩案都動 `shared/admin-data-table.tsx` 的定位(共用元件行為 = 鐵則 12⑥)、
  且會重排整張列表的視覺 ⇒ 視覺凍結期不動,要 Sean 點頭。
  **順帶**:`orders-table.tsx` 越線也掛在這題底下 —— 鐵則 6 的拆檔就是在決定「兩份 markup 怎麼切」,
  分開做等於同一件事決定兩次。
- **不修未來會痛在哪:** 🔴 **每加一欄就越陷越深,而且是複利**。出貨欄(A11a-6)還沒做,
  之後每個「操作」類入口(退款/重寄通知/沖銷)都會再欠一份。更難的是**下一個帶互動的欄位** ——
  那時就不是多寫一個 `<a>`,而是兩份 client 表單、兩份 state,任何一份漏改都會出現
  「桌機好了、手機沒好,而桌機測試全綠」(2b-1 已經實錘過一次)。等它自然到期,重構面積
  比現在大得多,而且會混在一個「順便加個欄位」的片裡被順手決定。
- **附註(A13 收官 R2 F4,本片刻意不改):** 已取消的單,操作欄那一格顯示「—」而**仍帶 `relative z-10`**
  ⇒ 它浮在整列 stretched link 之上,但自己沒有任何連結 ⇒ **點那一格不會有反應**(同一列其他格會進面板)
  = 一個很小的「死區」。修法有兩條(只在已取消時拿掉 `z-10`、或把「—」也包成連結進面板),
  都要連同上面那條「兩份 markup 各寫一次」一起想,不然又是改兩處。留在這裡不假裝沒有。
- **估時:** 案①約 2-3 片(重寫表格 markup + 兩套響應式驗收 + 視覺回歸);案②約 1 片(守門 + 收斂現況)。
- **發現於:** 2026-08-12 / D 窗 A13(訂單列表操作欄)plan §6;主視窗裁「本片先做完、拆檔另立一片、發號 #447」。
  附註那條 = 同片 R2(fresh Opus)F4。
- **分流標籤:** `P1-pre-launch`

### #448. 🔒 死結消融實證 —— 2f 的**唯一未達成驗收條件**,在 repo 內一直沒有追蹤載體

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2f 之 §13-4 標 ❌;主視窗 `P-599-A` 裁「另立條目承接」,**條目號拖到 2026-08-13 才發 = 主視窗欠的帳**,code-reviewer 點名)。
- **2f 現在宣稱到哪:** `docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md:1061` 逐字「❌ **本片未達成**」;對外宣稱維持「**結構前哨、未證消融**」(同檔 `:1066`)。**本片從未宣稱死結已消除**,所以不是不實宣稱,是驗收條件當初寫得比片界大。
- **要做什麼(判準已寫死、照抄即可):** 把 advisory **移回步 3 之後**(同檔 `:311`),跑消融靶,**必須實跑觀察到 `40P01`**;`55P03` 一律不算紅(同檔 `:323` 逐字 v2 判準)。等長同形、紅格數以實跑輸出入表、不預測(`:654`)。
- **為什麼它不是「順手補一下」:** 要真的構造出雙連線死結,不是加一條斷言。這正是它被移出 2f 的理由。
- **🔴 後續任何一代不得自行改回或悄悄打勾**(`:1067` 逐字)。這是把錯置的驗收項移到對的片,不是降低標準。
- **不修未來會痛在哪:** bug 可追蹤性=2f 的鎖設計**唯一沒被行為證明的那一面**沒有任何載體記著,下一代讀 plan 只會看到滿頁 ☑,很容易把「結構前哨」當成「已證消融」引用出去;而 2g 會直接騎在這個假設上。
- **估時:** 60-90 分(臨時叢集雙連線構造 + 靶入 harness)。
- **分流標籤:** `P2`

### #449. 🧱 `shipment-dialog.tsx` **463 行**越過鐵則 6 的 400 行線(與 #447 同一批做)

- **狀態:** ⏳ 待排(2026-08-12 D 窗;`wc -l apps/admin/src/components/orders/shipment-dialog.tsx` 實測 **463**)。
- **為什麼綁 #447:** #447 要決定「桌機表格與手機卡片兩份 markup 怎麼切」,本檔的拆法會被那個決定牽動 ⇒ **分開做等於同一件事決定兩次**。兩條合併排一批。
- **不修未來會痛在哪:** 可維護性=出貨對話框是「建立包裹→出貨」改名之後還要再動的檔(Sean 2026-08-12 需求),越晚拆、動它的人越怕;擴充性=新竹物流的批次上限(一次 5 筆)遲早要進這裡,那段邏輯沒有地方放。
- **估時:** 45-60 分(純拆檔 + smoke test 跟著切;與 #447 合併時另計)。
- **分流標籤:** `P1-pre-launch`

### #450. 🎭 到貨「**事後**」撤銷(A 案)—— 現在只撤得掉「剛剛登錄的那一筆」

- **狀態:** ⏳ 待排(B 案已上線 = `4d774876`,commit subject 自己逐字寫「**只命中一半**」)。
- **Sean 的原始需求是 A 案不是 B 案**(2026-08-12 逐字):「畢竟可能原本以為這個商品要給這個訂單,其實要先給另外一個訂單」⇒ 要撤的是**幾天前登錄錯的那一筆**,不是手滑那一筆。B 案(撤掉本次操作)只接住手滑。
- **要做什麼:** 逐筆到貨投影 + 列表(每一筆到貨紀錄各自可撤),= 第 2 批被推遲的批次到貨 UI。RPC `admin_delete_item_receipt` **在 DB 已經就緒**,缺的是前端入口。
- **不修未來會痛在哪:** 員工遇到「登錄到錯的訂單」時**現行零救濟**,唯一出路是找人下 SQL —— 而後台北極星是「員工(非工程師)能獨立跑完一天」。這一格直接打在北極星上。
- **估時:** 90-120 分(投影 + 列表 + 撤銷入口 + 守門格)。
- **分流標籤:** `P1`

### #451. 🔒 P4A03 訊息的**雙向指標只做到單向** —— SQL 那頭沒有回指前端 fixture

- **狀態:** ⏳ 待排(2026-08-12 D 窗到貨撤銷片自查;**已 apply 的 migration 是凍結檔、動不了**,所以只做得到單向)。
- **現況逐字:** `apps/admin/src/lib/orders/receipt-repository.ts:197` 寫「🔴 **fixture 的回指住在這裡,不在 SQL 檔裡**」、`:201`「P4A03 的原文在測試裡有兩份**手抄副本**當 fixture」、`:205`「**若日後有新 migration 改動此訊息,必須同步本檔 fixture 與三層守門格**」。
- **殘留的那條路徑:** 已 apply 那支動不了(APPLIED.tsv 釘 sha256),但**新 migration 改得到這段訊息** ⇒ 改的人站在 SQL 側,而提醒句只在 TS 側,他看不到。
- **修法二擇一:** ①下一支動到該訊息的 migration 檔頭放回指(順路做、零成本)②寫一條機械守門:比對 DB 內訊息字面與 TS fixture,不同就紅。
- **不修未來會痛在哪:** bug 可追蹤性=訊息一改,三層守門格全部靜默轉為「守著一句不存在的話」—— 恆綠、零判別力,而且**症狀是測試繼續全綠**。
- **估時:** ①0 分(順路)②30-45 分。
- **分流標籤:** `P2`

### #452. 🔒 守門保鮮期:前置閘 P1-P8 的保證**只活到 COMMIT 那一瞬**,之後零偵測

- **狀態:** ⏳ 待排(2026-08-12 P 窗 2f 之 diff 層 R3 IMP;plan `docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md:715-722` 列為 §9 假設第 11 條,**本片刻意不做**、主視窗裁定不塞進去)。
- **失效情境(plan `:716-717` 逐字):** apply 之後 canonical view 被換、狀態機 trigger 被停、single-flight 索引被砍 —— **全部零偵測**,直到下一支 migration 跑過或事故爆開為止;**而 2f 的否決語意整個騎在這些物件上**。
- **要做什麼:** 把 apply 當下那批唯讀檢查抽成**可排程探針**(plan `:720` 逐字:比在 apply 再加第九道閘值錢)。
- **🔴 這條同時是一句引用紀律:**「**apply 當天全綠」不等於「明天還綠**」(`:721`)—— 任何人引用 2f 的守門結論都要帶上這個時效。
- **不修未來會痛在哪:** 擴充性=2g 以後每一片都會繼續往這批物件上疊語意,而沒有任何東西在看它們還在不在;bug 可追蹤性=真的被動掉的那天,症狀會是「退款偶爾擋錯/不擋」,根因在三個月前某支不相干的 migration。
- **估時:** 60-90 分(探針 + 排程掛載;排程平台選擇見 memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro`,**別預設綁 Vercel**)。
- **分流標籤:** `P2`

### #457. 🔒 `AdminOrderSummary.customerUserId` 型別謊言 + 同客人閘誤判(**零症狀直到有人按下去**)

- **來源:** 2026-08-13 OD 片 2(S 窗)實查;codex 關卡2 抓出、主視窗裁「本片不修、立案追」。
- **現況(實測):** `packages/domain/src/order/types.ts:459` 宣告 `customerUserId: string`(非 nullable)、mapper `packages/adapters/src/supabase/mappers/order.ts:352` 直送。但 DB 的 `uuid NOT NULL`(建表 `20260604120000:95`)保證的是「**列裡**有值」,**不是**「**wire row 裡**有這個鍵」—— 投影退版時整個鍵消失,該欄實際值為 `undefined`,而型別說它是 `string`。
- **不修未來會痛在哪:** 活消費端 `apps/admin/src/components/shipping/shipping-selection.tsx:95` 的同客人閘寫 `state.customerUserId === null || state.customerUserId === customerUserId`;投影退版時兩邊都是 `undefined` ⇒ `undefined === undefined` 為真 ⇒ **兩位不同客人的訂單被判成同一位、裝進同一箱**,之後被 DB 的 `pcm_b2_w3b2_item_not_customers` 退件。而 `types.ts:452-456` 自己就寫過「**這個 bug 零症狀**直到有人按下去」。
- **對照修法(已完成的那一半):** `AdminOrderDetail.customerUserId` 已收斂成 `string | null` + 機制在 `order-detail-view.ts` 的 `customerDetailHref()`(片 2/3b)。
- **本片不修的理由:** 非本片造成,且動它會碰**出貨閘的活路徑**,超出片界。
- **分流標籤:** `P2`

### #458. 🔒 投影禁止清單的作用域過寬(字串比對守不住層級)

- **來源:** 2026-08-13 OD 片 2 三輪審查(codex 雙 alias / R2 巢狀·別的內嵌·hint 修飾)各找到一種新繞法。
- **現況:** `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts` 那格「`payment_charge_attempts` 內嵌只取 status」的禁止 token 清單,守法是對**整條投影字串** `not.toContain`。`rec_trade_id` 同時存在多張付款/退款表、`bank_transaction_id` 也存在 `payment_webhook_events` ⇒ 日後若有**合法**投影需要那些表的同名欄,會再次逼人削弱這張清單(就像 `customer_user_id` 這次)。
- **不修未來會痛在哪:** 每被逼一次就削弱一次,而**削弱的人正是被它擋住的人**。三輪審查各找到一種新繞法就是證據。
- **🔴 真正的解法不是再補一條字串斷言:** 字串比對本質上守不住所有構造。要根治得把**投影字串解析成結構**(頂層欄 / 各內嵌及其 hint / 巢狀層級)再對結構斷言。片 2 已在 `assertNoCustomerIdLeak` 做了三條軸的近似(總量 / 位置 / 內嵌內容,各有突變實測),但那是**針對單一欄名**的近似,不是通用解。
- **分流標籤:** `P2`

### #459. ♿ 訂單列表:多品項單第二列之後,螢幕閱讀器讀不到單號

- **來源:** 2026-08-13 #447 雙 markup 收斂(E 窗)的必要代價;R1 code-reviewer 抓、主視窗裁本片不做。
- **可測描述(不是「語意掉了」這種感想):** 收斂前 `<td rowspan>` 屬於它跨到的**每一列**;收斂後那些位置是**空格** ⇒ 螢幕閱讀器逐列念第 2 個品項時,**念不出這是哪一張單**。
- **現況緩解:** `<tbody aria-label>` 已掛,但 **實作支援未確認**(規範允許已親讀 ARIA 1.2 §5.2.8.4;NVDA/VoiceOver 是否念 `rowgroup` 的 aria-label **查無權威資料**,NVDA 另有不念 `th` aria-label 的開放 issue `nvaccess/nvda#17213`)。
- **🔴 為什麼不能用 `sr-only` 補:** `sr-only` 是 clip/position 隱藏、元素**仍有子節點** ⇒ `td:empty` 不再成立 ⇒ 手機卡片會冒出一排只有標籤沒有值的空行。**要先換整套「手機隱藏訂單層重複欄」的機制才做得了。**
- **不修未來會痛在哪:** 用螢幕閱讀器的員工在多品項單上會**分不清楚現在念的是哪一張單的第幾個品項**。
- **分流標籤:** `P2`

### #460. 🧱 `orders-table.tsx` 越過鐵則 6 的 400 行線,`#447` 的拆檔部分未做

- **來源:** 2026-08-13 #447 收斂片(E 窗)。
- **現況:** 收斂後 458 行(收斂前 476;`wc -l` 實跑,本數字在折 findings 過程中變動過四次,以 commit `025a7e7e` body 為準)。
- **不拆的理由:** L3(欄序 + 單價欄 + 狀態欄)會再動同一批區域,現在拆等於拆兩次;`#447`/`#449` 的 backlog 條目本身就寫著拆檔與「兩份 markup 怎麼切」是同一個決定。
- **不修未來會痛在哪:** 檔案持續長大,而鐵則 6 的警戒線存在的理由是「一個檔大到沒人願意整個讀」——那正是舊字面殘留(本片踩過兩次)最容易發生的環境。
- **分流標籤:** `P3`

### #461. 💰 `sweep-settlements` 的 reason 碼守門沒有數量保證 —— 今天剛好對、不是被守住

- **來源:** 2026-08-13 OD 片 2 的 R2 點名、S 窗判定後立案。
- **現況(實測,兩支函式各自的函式體,切法 `FUNCTION public.<fn>(` → `$fn$;`):** `mark_attempt_settle_retry`(`20260810220000`)與 `mark_webhook_retry`(`20260809140000`)函式體內 `p_reason_code IN (` **各出現 1 次**、無 `IN (SELECT` ⇒ 守門用 `exec` 取第一個在**目前的資料下**等於「取唯一那個」⇒ **現行無誤判**。
- **🔴 但缺的是那一行:** 對照 `admin-search-orders-post-only.test.ts:120` 的 `countRpcCalls` 用 `/g` **釘死「恰一處」**,`sweep-settlements.test.ts` **沒有對應的那一格** ⇒ **沒有任何測試保證那個次數維持 1**。
- **不修未來會痛在哪:** 日後有人在函式體內加第二處 `p_reason_code IN (…)`(例如不同分支不同碼集),守門只驗第一處 ⇒ 第二處漏碼不會被抓到 ⇒ 該檔 `:414-418` 自己寫過的後果:**碼不對齊 ⇒ 值被靜默正規化成 `unknown` ⇒ L5 判別條件恆假、自動裁定不生效、測試全綠**。**它守的是錢。**
- **修法:** 加一格 `expect(occurrences).toBe(1)`,抄 `admin-search-orders-post-only.test.ts:118-121` 的 idiom。
- **分流標籤:** `P2`

### #462. 📦 撤到貨之後,那批實體已在倉庫的貨在系統裡沒有去處

- **來源:** Sean 2026-08-13 拍板 Q3 的附加條件,逐字「**到貨的商品要可以轉去庫存那邊**」。
- **現況:** 採購撤銷(`#452` 案 E)遇到已登錄到貨的列會擋下、要員工先撤到貨。撤完之後,那批貨**實體還在倉庫**,但系統認為它不存在 —— **系統裡沒有承接它的位置**。
- **🏁 落點已定(Sean 2026-08-14 拍 `Q-462` = A):** **先記著,等庫存功能真的做出來再接。** 撤到貨時系統留下紀錄,但**不自動轉去任何地方**。
  ⇒ 這解掉了三句拉扯:08-11 Q11「要做也是做在報價單那邊」/ 08-12 Q6=A「不做庫存」/ 08-13「到貨的商品要可以轉去庫存那邊」——**第三句的前提(有個『庫存那邊』)今天不存在,所以先掛帳不實作。**
  ⇒ **本條不再擋任何線**;`#452` 採購線照原計畫走,`G7` 誠實缺口維持。
  ⚠️ **代價 Sean 知情**:這段期間盤點要人工對,工程成本 0。理由=此情境頻率極低(要「登記到貨 → 又撤掉」才遇到),而選 B 會讓整條採購線停下來等報價單 repo。
- **不修未來會痛在哪:** 員工撤了到貨之後,系統認為那批貨不存在、但它在倉庫裡 ⇒ **盤點會對不上**,而且對不上的量會隨每次撤到貨**累積**,事後查不出是哪幾筆造成的。
- **進度:** 未開工(採購作廢片刻意不做,見 `docs/specs/2026-08-13-procurement-undo-plan.md` §5 G7)。
- **分流標籤:** `P2`

### #463. ♿ 訂單列表手機卡片:欄名只剩 `td::before` 生成文字,沒有可靠的欄頭關係

- **來源:** 2026-08-13 #447 收斂片 R3(codex 換角度)抓、E 窗判本片不做。
- **可測描述:** 卡片模式 `thead` 被隱藏,欄名改由 `td::before{content:attr(data-l)}` 生成 ⇒ 螢幕閱讀器可能**只讀裸值**(「Brembo」)、讀不到「這格是廠牌」。WAI 要求 responsive table 在**所有格式**保留結構關係(`https://www.w3.org/WAI/tutorials/tables/tips/`)。
- **⚠️ 與 `#459` 同族不同洞:** `#459` 是「**哪張單**」,本條是「**這格是什麼欄**」。
- **不修的理由:** 動到的是卡片模式的**整套資訊架構**,而 L3 會重排欄序 ⇒ 現在改等於改兩次。
- **分流標籤:** `P3`

### #464. ♿ 訂單列表手機卡片:CSS `order` 造成視覺順序與 DOM 順序不一致

- **來源:** 同 `#463`。
- **可測描述:** 卡片上讀到的順序是 單號→日期→客戶→發票→金額→取消→品項,但 DOM 仍是桌機欄序 ⇒ **語音朗讀與鍵盤 Tab 走 DOM 順序**,兩者不同。CSS Display 3 明文 `order` 不得用於邏輯重排(`https://www.w3.org/TR/css-display-3/#order-accessibility`)。
- **🔴 真正的修法是改 DOM 順序**,而 DOM 順序**同時服務桌機表格** ⇒ 這是 L3 欄序重排的一部分,不是收斂片。
- **分流標籤:** `P3`

### #465. 🧪 訂單列表手機卡片:負向 hit-test 在 CI 零覆蓋

- **來源:** 2026-08-13 #447 收斂片 R3 important;E 窗同意但本片不補,主視窗發號。
- **可測描述:** 「不該可點的地方會不會誤觸」(卡片間隙 / 相鄰訂單邊界 / 控件附近是否被 overlay 吃掉)**CI 零覆蓋**。E 窗本片手動用 `elementFromPoint` 量過四點 + 補量三點,全部無誤觸;**但那是手動的,下一個人不會重跑。**
- **🔴 這是真缺口,不是判它不重要:** 補在單元測試裡做不到(要真瀏覽器),補在手動驗證裡則不會被重跑。**那個兩難本身就是條目的價值。**
- **為什麼特別重要:** R3 的 M-C 突變(整個視窗變成訂單連結)**只在負向觀察點顯形** —— 現有正向 hit test 對它完全盲。
- **分流標籤:** `P2`

### #466. ✅(已完成)訂單列表手機:取消入口觸控目標 24×16,低於 WCAG 2.2 的 44×44

- **來源:** 2026-08-13 E 窗實測發現(`getBoundingClientRect` @430);Sean 當日拍 A(放大)。
- **原始問題:** 手機上 24×16 的「取消」鈕,**離開它 6px 就落入整列連結** ⇒ 誤觸會**開啟訂單而非取消**。⚠️ 不是收斂片新增的(收斂前同尺寸),但收斂後兩槽共用同一個 `<td>`、周圍全是 stretched link ⇒ 誤觸代價更明確。
- **🔴 修法(已做,commit `025a7e7e`):** **視覺尺寸與觸控尺寸分開** —— 視覺維持 24×16(一像素沒動)、觸控熱區用 `::after` 絕對定位擴到 **48×44**、**卡片高度零變化**(493px → 493px)。⇒ 「符合無障礙」與「Sean 嫌手機太鬆」**本來就不對立**,對立的是「把視覺尺寸當成觸控尺寸」這個前提。
- **驗證:** 幾何不重疊(勾選框)、熱區未溢出本卡、三個 hit point 重量(舊結論作廢)、桌機 `::after` computed `content: none`、守門四靶全紅。
- **未做:** 勾選框仍 16×16(旁邊 6px 是死區、無「差 6px 做了另一件事」的風險)⇒ **刻意不擴大到 Sean 沒拍的東西**;要做請另立號。
- **分流標籤:** `已完成`

### #467. 📋 訂單面板切到客人卡時,8 支表單的未送出內容會清空(Sean 知情拍 A)

- **來源:** 2026-08-13 OD 片 3b;S 窗實查 8 支表單、Sean 逐字拍 `a`(問題含完整清單)。
- **會被清空的 8 支:** 退款(TapPay,動錢)/ 收款登錄(動錢)/ 取消訂單兩支(不可逆)/ **到貨登錄(逐品項)** / 到貨撤銷 / **採購 upsert(逐品項)** / 備註與更正 / 訂單編輯。
- **🔴 最痛的不是退款,是那兩支「逐品項」的:** 一張多品項單可能**同時開著好幾格輸入**,切過去**全部清空**,而**員工不會預期「看一下客人是誰」會清掉它們**。
- **不修未來會痛在哪:** 若員工回報踩到,修法是 B 案(切換前跳確認),而 B 案要動面板的 server-only 架構(`@panel/orders/page.tsx:21-22` 逐字「本檔沒有 `'use client'`」)⇒ **那時的成本比現在做高**。這是知情的取捨,不是遺漏。
- **分流標籤:** `P3`

### #468. 📋 客人面板為唯讀:儲值金調整與會員等級變更兩支表單不出現(主視窗裁,Sean 有權推翻)

- **來源:** 2026-08-13 OD 片 3b;S 窗開工後實查發現客人卡**自己帶著兩支動錢/動權限的表單**。
- **現況:** `wallet-adjust-form.tsx:26`(儲值金調整,**動錢**)與 `tier-edit-form.tsx:28`(會員等級變更,**動權限** —— tier 決定經銷價可見性)被 `customer-detail.tsx:20-21` 直接 import ⇒ 只要渲染 `<CustomerDetail>` 就會出現。片 3b 傳 `readOnly` 讓兩者在面板版不渲染(codex 關卡2 覆核:面板內無第二個呼叫端、無繞道)。
- **裁決理由:** Sean 的原話全句都是「**看**」(「點客人變成**看**向訂單一樣…回去變成**看**訂單」);面板版能力**比整頁版少 = 縮減不是擴張**;另兩案分別要動 `returnTo` 白名單(別人刻意收窄過的安全邊界)或製造員工不會預期的資料遺失。
- **不修未來會痛在哪:** 員工在面板看到客人、想調儲值金必須另開整頁版,**而面板裡沒有捷徑**(OD 成品也沒有那個連結 ⇒ 不自行新增)。若日後常用,會變成每天多兩次點擊。
- **分流標籤:** `P3`

### #469. 📋 客人面板的 `customer` param 未驗證是否隸屬 `panel` 訂單

- **來源:** 2026-08-13 OD 片 3b codex 關卡2 important;S 窗與主視窗判斷一致:本片不修。
- **現況:** `app/@panel/orders/page.tsx` 只要 `panel` 與 `customer` **都長得像 UUID** 就早退渲染客人卡,**不檢查該客人是否為該訂單的客人** ⇒ `?panel=A&customer=B` 會顯示 B 的客人卡、同時隱藏 A 的所有表單(8 支,見 `#467`)。
- **不是越權**(codex 明判:員工本來就能開 B 的整頁版),**是錯誤情境綁定**。
- **不修的三條理由:** ①非越權 ②守門要每次開卡都多一次查詢 ③🔴 **加了之後失敗要顯示什麼?**「這個客人不屬於這張單」對員工**比現況更難懂**,而他手上還有「← 回訂單」一鍵可回,現況代價只是看到一張不相干的卡。**守門不是越多越好,要問它擋下來之後那個人怎麼辦。**
- **🔴 不修未來會痛在哪(這個判斷什麼時候會失效):** 若之後客人卡要顯示「**這張單的**」脈絡資訊(例如「本單的儲值金折抵」),那個綁定就從「不相干」變成「**顯示錯誤的關聯**」⇒ 屆時必須補這道守門,而那時的資料面比現在複雜。
- **分流標籤:** `P3`

### #470. 🧪 訂單列表守門群的突變靶全在「被守的 code」上,零個在「守門本身」上

- **來源:** 2026-08-13 #447 L0 片 code-reviewer 點名;E 窗自報並判本片不補。
- **現況:** 八靶全在被守的 code 上,而**這片改的正是守門的期望值**(L2 兩條 byte-equal + L0 三處同步)。
- **不補的理由(E 窗逐字):** 那類靶要「**改測試檔本身再看它會不會紅**」,而**測試檔改了就不是原來那個測試了** —— **還沒想出不繞圈的做法**。
- **不修未來會痛在哪:** 守門的期望值已被「合法擴大」過三次,每次都靠**人判**「這是擴大不是放寬」;**沒有靶盯著這件事本身** ⇒ 哪天有人把 `toBe` 改成 `toContain`、或把期望值改成前綴,**現有八靶一個都不會紅**。
- **分流標籤:** `P2`

### #472. 🧱 `order-list-view.ts` 越過鐵則 6 的 400 行線 268 行,L3 又要往裡面加

- **來源:** 2026-08-14 L3 開工前,主視窗裁「不拆、立條目記債」(E 九代要求把鐵則 6 判斷單獨提出來)。號碼由**主視窗直接指派**(`E-407`):`#471` 同時被 D 窗需要(`#452` 撞號的另一側),兩窗各自跑「查最大號 +1」會同時挑中 `471` ⇒ 改由主視窗集中發號。
- **現況:** **668 行**(`wc -l` 實跑於 `1a65b46b`),400 警戒線 **+268**;`export` **41 個**(`grep -c '^export '`)。
- **不拆的理由(主視窗裁決逐字兩條):** ①拆檔與欄序重排混在同一片,**回退面會糊掉** —— 出事時分不出是拆壞的還是排壞的;②`#460` 已在記 `orders-table.tsx`(**458 行**,同次實跑)的拆檔債,**同族債合併處理成本較低**。
- **不修未來會痛在哪:** 這個檔是訂單列表的**單一入口**——篩選 param 解析、URL 往返(`buildOrderListHref` 的編譯期窮舉守門在 `:554-596`)、日期預設、四張標籤表、金額與車款格式化**全擠在一份**。它已經是「沒人願意整個讀」的尺寸,而**它同時是那道窮舉守門的家**:那道守門保護的是「翻頁不掉篩選」,靠的是有人願意讀懂 `byFilterKey` 為什麼長那樣。檔案再長下去,下一個人的實際行為會是**只 grep 到自己那一段就動手** ⇒ 守門的意圖失傳,而它失效的症狀是**靜默的**(畫面上的選擇還在、篩的東西已經變了),不會有任何測試自己紅起來。
- **🔴 何時必須動(這個「不拆」什麼時候失效):** L3 片4 的密度 `?den=` 若走「不進 `AdminOrderFilter`」那條(E-406-Q §2 案 A),這個檔會多一組**不受窮舉守門保護**的 URL 狀態 ⇒ 屆時「誰保證翻頁不掉密度」得靠另寫的往返測試,**拆檔的收益從整潔變成正確性**。
- **分流標籤:** `P3`

### #473. 💰 RW4 人工判定是單向不可逆:判成 `manual_failed` 之後,後台沒有任何入口能再判一次

- **狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(**今天實害 0,但 `#445b` 上線前會升級成 🔴,見「不修會痛在」**)
- **問題:** `apps/admin/src/lib/payment/refund-recovery-actions.ts:87` 逐字 `if (row.status !== 'processing') return { ok: false, code: 'already_finalized' };` ⇒ RW4 只吃 `processing` 列。而 `manual_failed` / `recovered_confirmed` 都是終態(`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:211-215` 狀態機逐字「唯三合法轉移」`processing → confirmed/failed/deferred`,**終態不可再轉**)。⇒ **人判錯一次,後台沒有任何按鈕能更正**。唯一救濟 = 手動 SQL。
  🏁 **2026-08-14 更正**:原句還寫「異常清單也看不到它(`refund-read.ts:109-110` 只查 `status='processing'`)」—— **`473b-2` 已把那半解掉**,卡住的列現在會出現在異常清單(零按鈕 + 誠實文案)。**本條的核心(沒有更正入口)不變**,只是「看不見」那一半不再成立。
- **員工會看到什麼:** 🏁 **(a) 已於 2026-08-14 修掉**(commit 見下)。~~舊文案 `refund-recovery-state.ts:61-62` 逐字「這筆退款已不在『處理中』(可能剛被結案),沒有執行任何動作。請重新整理清單確認現況。」—— 訊息把它講成「別人剛處理掉了」,而實際情況是**這個狀態本身就沒有出口**,員工重新整理幾次都一樣。~~
  🔴 **現行文案 = v4**(Sean 2026-08-14 逐字指示「沒有別的解決方法的話,文字就要改成請工程師處理之類」):結案 +「要看結果請打開該筆訂單頁的退款紀錄」+「若判定有誤需更正,這裡沒有可以改的地方,請聯絡工程師處理」。同片並補上該早退路徑的 `revalidatePath`(原本不重整,畫面會停在舊狀態)。
  ⚠️ **v3 曾有、v4 已刪的那句 =「這一列會從異常清單消失」** —— `#473b-2` 之後那句**只對 `confirmed`/`deferred` 成立**,`manual_failed` 的列**留在清單上** ⇒ 一句文案不能對不同結案結果一真一假,故整句拿掉。**本行原本照抄 v3、把已刪的句子當成現行文案**(`#483` 的 code-reviewer must-fix 抓到:我在 `#483` 自稱掃過過期字面,卻漏掉同一個檔裡最像的那一處)。
  ⚠️ **本條沒有被 (a) 解掉** —— 出口本身仍不存在,(a) 只讓員工不再被誤導、知道要找人。`#445b` 的硬前置**維持**,要解掉要做 (b),見「預期解法」。
- **觸發事件:** 2026-08-14 R 窗跑 `#445` plan v3 的 R3 對抗審查(codex 時間軸 D + Fable F5 獨立收斂);兩者都在找「`manual_failed` 佔額度之後怎麼解開」時撞到同一行。
- **🔴 今天為什麼還沒出事(兩條,缺一都不成立):**
  1. 後台尚未啟用、只有 Sean 在測(memory `project_admin-preprod-planning-posture`)⇒ 沒有員工會按到。
  2. **今天 `manual_failed` 不佔任何額度** —— 顯示式 `pcm_order_refundable_remaining`(`20260803150000:401-405`)只算 `processing + confirmed`,而 `admin_initiate_order_refund` 現況**零金額守門**(拍板⑤,同檔 `:25` / `:298` 逐字)⇒ 那一列結案之後不擋任何後續退款,「不可逆」目前只是「紀錄改不了」。
- **不修會痛在:**
  - **可維護性/正確性(員工上工後):** 只要有人對一筆退款按錯 RW4(把真的動過錢的判成沒動、或反過來),那筆帳本列就**永遠停在錯的狀態**,對帳時查到它也改不動 —— 而 RW4 的判定依據是「Record 差額」(`:758` 逐字),那是人看數字做的判斷,**按錯是可預期的,不是意外**。
  - **🔴 與 `#445` 硬綁(這是真正的時限):** `#445` plan(v3 起、v4 維持並升級成 apply 硬前置)§4-2 把 `manual_failed` 算成**佔額度**(保守方向,為了不漏掉「人判錯、錢其實動了」的情形)。**一旦 `#445b` 上線,這條就從「紀錄改不了」升級成「那張訂單之後永遠退不了款」** —— 而解鎖入口不存在。⇒ **`#445b` 的 apply 停點之前必須先有出口**,否則等於拿一個永久卡單換一道超退防線。
  - ~~**bug 可追蹤性:** 卡住的列不在異常清單裡(只查 `processing`)⇒ 沒有任何畫面會告訴值班「這張單被一列 `manual_failed` 擋住了」~~ 🏁 **2026-08-14 `#473b-2`+`#483` 已解掉這一項**:卡住的列進了異常清單,訂單頁也掛徽章。**其餘各項不變。**
- **預期解法(方案 3 已做,方案 1/2 二選一仍未拍板):**
  1. 新增一支 RW4 逆向 RPC:`manual_failed → processing`(需同時放寬 `20260803150000:211-215` 狀態機,**動的是已 apply 的 migration ⇒ 鐵則 12③**)。
  2. 不動狀態機,改在 `#445` 守門式加「同單另有一列 `recovered_*` 覆寫」的沖銷語意(與 `#442` 同族)。
  3. ✅ **已做(`#473b-2` + `#483`,2026-08-14)** —— 只做「唯讀救濟」:異常清單納入 `manual_failed`、訂單頁也掛徽章,讓值班至少看得到、由工程師手動 SQL 解。**這條不解卡單,只解看不見** ⇒ **`#445b` 的硬前置仍然維持**,還是要做 1 或 2。
- **📄 (b) 的 plan(2026-08-14 R 窗,等 Sean 批):** `docs/specs/2026-08-14-473b-manual-verdict-correction-plan.md`。結論 = **不動狀態機**(`20260803150000:211-215` 只讀 `status`、放寬會連 `rejected_out_of_range`/`not_sent` 一起打開),抄姊妹 `admin_correct_refund_manual_verdict`(`20260812140000:572`)的**形狀**:append-only、舊列不動、CAS、員工面一個動作。**兩題待拍**:`Q-473-1`(有效判定=最新一筆 vs 只准更正一次)、`Q-473-2`(新表 vs 加欄 vs 就地改 `failed_reason`)。
- **估時:** 方案 1 = 90-150 分(動 schema + 對抗審查 + 回退);方案 3 = 30-45 分。⚠️ plan v1 重估:`473b-1` 90-140 分 + `473b-2` 35-50 分 + `473c` 60-90 分。
- **依賴:** `#445b` 的 apply 停點(硬前置,見上);方案 1 命中鐵則 12③ ⇒ 需 Sean 批准 plan。
- **發現於:** 2026-08-14 · R 窗 · `#445` plan v3 R3 對抗審查(findings 見 `~/pcm-mailbox/附件-R-445-R3-findings.md` E1)
- **🏁 2026-08-14 v7 複核(R 窗;不改本條結論、只補現況):** `#445` plan 已推進到 **v7**(`Q-445-R4-1`=A:守門式再減「已取消金額」)。
  **本條的硬前置地位不變** —— v7 §5-445b-8 仍逐字「`#473` 沒有出口之前不得 apply 445b」,§4-2 仍把 `manual_failed` 算成佔額度。
  ⚠️ v7 把 `blocked_by` 判定寫成「凡帳本佔額度合計來自非 `processing` 的列一律走 `in_flight` 文案並點名該列狀態」
  ⇒ 卡住時**訊息會把員工指向帳本區塊**,但 **`#473` 不修的話那裡仍然無事可做**(R3 findings E3 同一根)。
  ⇒ **訊息變準了不等於出口出現了**,本條不因 v7 降級。
- **相關:** `#445`(超退閘,硬綁)/ `#442`(卡住的補償退款永久隱形,同族)/ `#443`(異常清單只讀一本帳)/ `#479` `#480`(2026-08-14 同批由 `#445` R4 帶出,同屬「`orders.total` 不等於該退的錢」家族)

### #474. 🧪 測試檔全域被 lint 豁免:本專案主要靠測試守門,而守門本身零 lint 訊號

- **狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(不是會壞掉的東西,是**看不見的東西**;先量再決定範圍)
- **問題:** `eslint.config.js:41-44` 的全域 `ignores` 含四條 glob:`**/*.test.ts` / `**/*.test.tsx` / `**/*.spec.ts` / `**/*.spec.tsx` ⇒ **所有測試檔完全不進 lint**。實測(主視窗跑,R 窗未複跑):`npx eslint src/components/orders/orders-table.test.tsx --max-warnings 0` 回 `File ignored because of a matching ignore pattern`。
- **🔴 豁免的來由本身就是形狀:** 同檔 `:116` 註解逐字「test / spec 已在全域 ignores(L41-44)豁免(**測試需動態存取 env 做 setup/teardown**)」—— 為了豁免 **`no-restricted-syntax` 那一條**(擋 `process.env[...]` computed access),做法卻是把**整個檔案排除在所有規則之外**。想關一盞燈、拉了總電閘。
- **實錘(不是假設):** 2026-08-14 E 窗 L3 片1,`apps/admin/src/components/orders/orders-table.test.tsx:30` 留下一個未使用的 `STATUS_CAPSULE` import(量法:`grep -c "STATUS_CAPSULE" <該檔>` = 1,而該行就是 import),而該片自報 `LINT_EXIT=0`。**兩者都是真的** —— 因為那個檔根本沒被 lint。它同時也是 R 窗審查抓到的 F1(那個 import 是一條被刪掉的斷言留下的化石)。
- **不修會痛在:**
  - **bug 可追蹤性(主因):** 本專案的安全機制**重度依賴測試**(三綠、突變測試、oracle、負向格)。守門本身零 lint ⇒ 死 import、沒清掉的 mock、打錯的 import 路徑、`await` 漏掉、`only` 忘了拿掉…**全部要等人肉眼看到才發現**,而審查者看的是 diff、看不到整檔。
  - **可維護性:** 測試檔是本 repo **改動量最大**的一類檔(單這一片就 428 行)。改動量最大 × 訊號為零 = 最容易長出無人知道的殘留。
  - **擴充性:** 未來要加任何「測試檔專屬」的 lint 規則(例如禁 `it.only`、禁 `expect` 出現在 `describe` 外),現行結構下**加了也不會生效** —— 得先把這條 ignore 處理掉才有地方掛。
- **可能解法(未拍板,不要自己選):**
  1. 拿掉全域 ignore,改成**只對 `no-restricted-syntax` 那一條**加 `files: ['**/*.test.*', '**/*.spec.*']` 的 override 關掉。範圍最小、方向最正。
  2. 保留 ignore,另加一支專跑測試檔的 lint task(較笨,但不動既有設定的行為面)。
- **🔴 先量再決定,不要寫成「改個設定就好」:** 兩條解法都會讓所有測試檔**第一次**被 lint ⇒ 可能一次噴出大量既有違規。
  **量法(先跑這個,拿到數字再談範圍與工時):** `npx eslint '**/*.test.tsx' '**/*.test.ts' --no-ignore --format compact | tail -5`
  **目前受影響的檔數:** `find apps packages \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) | grep -v node_modules | wc -l` = **433**(R 窗實測,worktree `pcm-refund-guard` @ `ca858336`)。
  ⚠️ E 窗同日的 vitest 報 `Test Files 456 passed` —— **兩個數的母體不同**(find 只掃 `apps/`+`packages/` 四個副檔名;vitest 的收集範圍由它自己的 config 決定),**未對齊、不要混用**。
- **估時:** 量的那一步 15-30 分;修的那一步**未知**(取決於噴出幾條)。
- **依賴:** 🔴 動 `eslint.config.js` = **根層設定 ⇒ 鐵則 12④**(平台設定)⇒ 需 plan + 對抗審查 + Sean 批准。本條目只立案、**不動設定**。
- **發現於:** 2026-08-14 · R 窗審 E 窗 L3 片1(`~/pcm-mailbox/附件-R-E408-review.md` F1/F5);F5 由 R 窗標【未確認】、主視窗實跑關掉。
- **相關:** `#470`(訂單列表守門群的突變靶全在被守的 code 上、零個在守門本身)—— **同族:守門沒有人守**。

### #475. 🧪 卡片 CSS 落點守門只驗「有沒有」——不驗值、不驗唯一、不驗殘留,而清單是硬寫的

- **狀態:** ⏳ 待執行
- **分流:** `P3`
- **優先級:** 🟡 低(今天實害 0;它是**看不見的東西**,不是會壞掉的東西)
- **問題:** `apps/admin/src/components/orders/orders-table.test.tsx:954-975` 那格對每個 `col-*` 只斷言「卡片化 media 內**有一條選擇器提到它**」(`[...inCard].some((s) => s.includes(\`.${col}\`))`)。三件事它一件都不驗:①那條規則的 `order` **值**是多少 ②同一個 `order` 值有沒有被**兩個欄共用**(重號)③清單**之外**還有沒有殘留規則。而且清單本身是**硬寫的 13 個字串**(`:961-975`),不是從 TSX 的 `CELL` 常數推導 ⇒ 兩邊漂掉時也不會紅。
- **實錘(不是假設):** 2026-08-14 E 窗 L3 片1 一次踩中兩個盲區:`.col-ordered` 的規則刪漏了、而且它與 `.col-qty` **同為 `order: 13`(重號)**,`vitest` 全綠 456 檔 7622 格**沒有一格會紅**。抓到它的是 R 窗人工逐行列 `order`(`附件-R-E408-review.md` F2),不是任何守門。
- **🔴 不修未來會痛在哪:** 卡片模式的縱向順序**完全由 `order` 決定**,而它的失效是**靜默的** —— 重號時順序退回 DOM 順序,畫面看起來「就是這樣」,沒有錯誤訊息、沒有紅測試。L3 片2/片3 還要再動這組數字兩次(新增單價欄 + 14 欄欄寬與 container query),**每動一次就多一次踩中的機會**,而現在守門只會說「有提到就好」。
- **修法(建議,未實作):** 把那格從「有沒有提到」改成**解析出 `{col: order}` 對照表**,然後驗:①每個 `col-*` 恰一條規則 ②`order` 值兩兩相異 ③解析出的 key 集合 **等於** TSX `CELL` 的 value 集合(不是硬寫清單)。第三條同時解掉「清單會漂」那半。
- **依賴:** 無(只動測試檔,不動 `eslint.config.js`、不動 CSS 規則本身)。
- **發現於:** 2026-08-14 · R 窗審 E 窗 L3 片1(`~/pcm-mailbox/附件-R-E408-review.md` F4)。號碼由主視窗指派(`E-414`)。
- **相關:** `#470`(突變靶全在被守的 code 上、零個在守門本身)、`#474`(測試檔零 lint 訊號)—— **三條同族:守門沒有人守**。

### #476. 🔴 採購作廢上線後,**編輯表單會用已作廢的舊資料覆寫生效中的採購**(靜默資料損壞);兼 14 個讀者面不認得「已作廢」

> 🔴🔴 **2026-08-14 嚴重度上修 —— 原標題只寫「員工看到一筆還在的採購」= 低估。**
> R3 換模型換角度(`gpt-5.6-terra`)抓到,D 窗與主視窗**各自開檔複核過**這兩處:
> - `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` 的 `ADMIN_ORDER_DETAIL_SELECT`,
>   內嵌 `order_item_procurement(...)` 欄位清單**沒有 `voided_at`**,且**無 filter、無 order**
> - `apps/admin/src/lib/orders/procurement-view.ts` 的 `hydrateFormValues`
>   = `find((p) => p.supplierId === supplierId)` ⇒ **同供應商取第一筆**
>
> **失敗鏈(每一步都是已拍板的正常操作,沒有一步是異常)**:
> 作廢 A 家 → `Q-S1=A` 允許對 A 家重下單 ⇒ **同鍵兩列** → 員工點開 A 家採購編輯表單
> ⇒ 可能 hydrate 出**作廢那列**的舊值 → 按儲存 → A5a(2a-2 甲改的)跳過作廢列、命中**生效列**
> ⇒ **舊資料寫進新列**。**零錯誤、零固定碼、稽核看起來完全正常。**
>
> 🔴 **所以本條是「採購作廢 RPC(`#452` 片 2a-2 乙)」的【硬前置】,不只是「同批上線」。**
> 🔴 **2a-2 甲(相鄰 writer 分流)不受影響**:甲片不產生任何 voided 列
>   ⇒ 正式庫零 voided 列 ⇒ `find()` 只可能命中一列 ⇒ **這條路徑在甲片單獨上線時不可達**。
>   該不可達性已寫成甲片的 **apply preflight P5**(正式庫 `voided_at IS NOT NULL` 列數 = 0,非 0 即停)。
> ⚠️ **三個成因各自無害**(允許同鍵兩列 / 投影少一欄 / `find` 取第一筆)—— 它是被**湊**出來的,
>   **不是任何一輪 line-level review 抓得到的**。修的時候三個面都要看,只補投影不夠。

**(原標題保留;🔴 「13 支」已由下方 V 窗重數更正為 14 個面/8 支檔)👁️ 採購作廢上線後,後台讀者面一個都不認得「已作廢」—— 員工看到的是一筆還在的採購**
- **來源:** `#452` 片 2a-2 對抗審查(R2 opus 2026-08-14)點名「12 個讀者面只證了 3 支」;D 窗實查後為 **13 支**(🔴 該數字 2026-08-14 由 V 窗重數更正,見下)。號由主視窗指派。
- ~~**數法(2026-08-14 實跑,可重數):** `grep -rln "order_item_procurement\|voided_at" apps packages` = **13 支**~~
  **🔴 2026-08-14 V 窗開工前重數 —— 這條數法有三個錯,方向都是「低估」。原句加刪除線保留備查。**
- **🔴 更正後的數法(V 窗 2026-08-14 實跑):**
  `grep -rln --exclude-dir=.next "order_item_procurement\|voided_at\|AdminOrderItemProcurement" apps packages` = **16**
  - **錯 1 · 原命令現在重跑吐 28、不是 13** —— 它會撈進 `.next/` 建置產物(15 個 `.js` / `.js.map`)。
    加 `--exclude-dir=.next` 後 = 13 ⇒ **原數字是真的,但那條命令已經重數不出來**。
  - **錯 2 · 🔴 13 支名單漏了三支非 test 原始碼,漏的正好是最會出事的三支:**
    `apps/admin/src/components/orders/item-procurement-form.tsx`(表單「新建 vs 編輯」判定)/
    `apps/admin/src/lib/orders/procurement-suppliers.ts`(供應商下拉合併)/
    `apps/admin/src/components/orders/item-procurement-section.tsx`(採購表格本體)。
    **病因**:原 grep 認的是**資料表名**,而下游消費端引用的是 domain 型別 `AdminOrderItemProcurement`
    或只用 `item.procurements` —— **兩者都不出現表名** ⇒ 撈不到。
    🔴 **通則**:「grep 不到」只證明「這個名字不存在」,**不證明「這件事沒被做過」**。
  - **錯 3(次要)**:原句「`apps/admin/src/lib/orders/` 四支」實為**六支**(漏 `receipt-repository.ts` + `.test.ts`)。
- **✅ 真實讀者面 = 14 個面 / 8 支要動的檔**(V 窗 2026-08-14 **逐一開檔**數,每條附行號;
  原句「真實顯示點只會比 13 多、未逐一開檔數」由本節取代):

  | 群 | 面 | 位置 |
  |---|---|---|
  | 投影/型別/mapper | R1-R4 | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` 的 `ADMIN_ORDER_DETAIL_SELECT`(🔴 **認字面不認行號** —— 片1 加的註解讓它從 `:326` 漂到 `:363`)/ `mappers/order-procurement.ts` / `packages/domain/src/order/types.ts` |
  | 顯示 | D1 空狀態 · D2 表格 · D3 到貨鈕 | `apps/admin/src/components/orders/item-procurement-section.tsx:94` · `:114-133` · `:134` |
  | 顯示 | D4 供應商下拉 | `apps/admin/src/lib/orders/procurement-suppliers.ts:36-45`(**原名單漏列**) |
  | 顯示 | D5「貨到了」採購選單 | `apps/admin/src/lib/orders/receipt-repository.ts:374-393`(**原條目未點到**;`.eq('order_item_id')` 無 voided filter) |
  | 寫入前置 | W1 hydrate · W2 新建/編輯判定 · W3 原送出時間 | `apps/admin/src/lib/orders/procurement-view.ts:91` · `components/orders/item-procurement-form.tsx:226` · 同檔 `:162`/`:219`(**W2/W3 原名單漏列**) |
  | 判定 | J1 取消上限推導 | `apps/admin/src/lib/orders/cancel-view.ts:448` |
  | 判定 | J2 receipt 歸屬 | `apps/admin/src/lib/orders/receipt-repository.ts:305-312` —— **判斷不用改**(歸屬與作廢無關);列出是為了證明沒漏 |

- **✅ 片界(主視窗 2026-08-14 核可;方向 = B「帶回來 + 標示 + 分流」,抄 shipments 樣板):**
  **片1** R1-R4 帶欄(30-40 分)→ **片2** W1-W3 挑列分流(**本條目「靜默資料損壞」的真正修復**,30-45 分)
  → **片3** D1-D4 顯示標示(30-45 分)→ **片4** D5+J1(20-30 分)。四片零同檔重疊;**片1 為硬前置**。
  🔴 **不選 A(投影直接加 filter)的理由**:一行就能讓下游絕大多數面自動正確,但員工按下「作廢」後
  畫面上什麼都不留 —— **動作後沒有回饋**是最容易讓人重複操作的形狀(Sean 常設準則「操作直覺化」);
  樣板 `apps/admin/src/lib/shipping/order-shipments.ts:11` 逐字「否則畫面上會變成貨憑空消失」。
- **進度(2026-08-14 · 每片收工當下更新,不要抄上一版):**
  - ✅ **片1 已完工並 merge**(`d6a18e38`):投影+型別+mapper 帶兩欄。兩關 FAIL 全折;六發定向突變全紅。
  - ✅ **片2 已完工並 merge**(`8dfad824`):`findActiveProcurement` 單一挑列入口,三個呼叫點全走它
    ⇒ 🔴 **本條目標題那件事(編輯表單用作廢舊值覆寫生效採購)已修**。兩關 FAIL 全折。
  - ✅ **拆檔片**(`d591c6b5`):`item-procurement-form.tsx` 410→394 行過鐵則 6;零行為,四道證據。
  - ✅ **片3 顯示面**(本次):作廢列標示 + 不給到貨入口 + 選單排除。兩關 FAIL 全折。
  - ✅ **片4 已完工**(本次,`#476` 最後一片):「貨到了」選單排除作廢列 + **作廢原因**顯示
    (跨欄第二列、`null` 誠實顯示缺、過長收進原生 `<details>` 可展開)。兩關 FAIL 全折。
    🔴 **`cancel-view.ts` 的取消上限推導【刻意不改】** —— 實查後判定改它會**放寬**一道 fail-closed:
    A4a 的 `instock` 軸**沒有**排除作廢列(`20260813120000:495` 只改了 `ordered` 軸,行內註解逐字
    「本片唯一改動」)⇒「採購全作廢但掛著到貨」時 `instock > 0`,改成只算生效列會推出
    `maxCancellable = quantity` 這種謊話。理由與失效條件寫在該檔註解。
  ⚠️ 片1 種下一筆**已標記**的還債:生成型別落後兩支 migration ⇒ 見 `#489`。
- **✅ 四片蓋完 `V-001` 盤的 14 個面 / 8 支檔。本條目的病灶已解:**
  ①編輯表單不會再用作廢舊值覆寫生效採購(片2)②作廢列在畫面上看得出來、也說得出**為什麼**撤(片3+片4)
  ③到貨入口與供應商選單都不再列出作廢列(片3+片4)。
  🔴 **但【不等於採購作廢功能可以上線】** —— 那還要:乙片(作廢 RPC)+ 甲片 `20260814100000` **apply**
  (`grep -c 20260814100000 supabase/APPLIED.tsv` = 0)。本條目是那件事的**硬前置**,不是它本身。
  ⚠️ **四件視覺改動至今零人眼驗過**(worktree 跑不起 admin)⇒ 清單在 `~/pcm-mailbox/V-007-CHECKLIST.md`,
  其中「作廢列長怎樣」那件**要等作廢功能上線才驗得了**。
- ~~**現況:** 2a-2 只做 DB 層…**`voided_at` 沒有進任何投影、沒有任何列表或詳情會標示它。**~~
  **🔴 2026-08-14 片1 之後這句過期(codex 關卡2 must-fix:與上面「片1 已完工」自相矛盾)。現況改寫:**
  - **`voided_at` / `void_reason` 已進明細投影與 domain 讀模型**(片1)⇒ 兩欄拿得到了。
  - **但沒有任何一個顯示面或挑列邏輯在用它** —— `find` / `some` / `length` 全部原封未動
    ⇒ 🔴 **「編輯表單用作廢資料覆寫生效採購」這個靜默資料損壞,片1 之後【仍然存在】。修它的是片2。**
  - ⇒ **本條目【未結案】。** 片1 只是把分流所需的資料備齊。
- **🔴 不修的話員工看到什麼(具體,不是抽象):**
  一筆已經作廢的採購,在採購區塊裡**長得跟生效中的一模一樣** —— 有供應商、有數量、有回覆狀態。
  而「訂購數」(`ordered_quantity`)**已經把它扣掉了** ⇒ 畫面上**列出 3 件、總數說 0 件**,兩個數字互相矛盾而沒有任何一行字解釋。
  員工合理的反應是「系統壞了」或「我少下了一單」⇒ **會再下一次**(而 Q-S1=A 讓那次真的會建出第二列)。
- **不修未來會痛在哪:** 這是**已知洞而非未知洞** —— 2a-2 上線那一刻它就存在。
  沒有這條 backlog,它會變成「沒有載體的已知洞」:下一個人看畫面矛盾會先去懷疑 `#452` 的算式有 bug,
  而真正該做的是補顯示。**查錯方向的成本比補顯示高。**
- **關係:** 上游 = `#452`(2a-2 不含應用層顯示,片界由主視窗 2026-08-14 裁定維持不長大)。
  ⚠️ 與 `#462`(撤到貨之後貨沒去處)是**不同的兩件事**,不要合併。
- ~~**進度:** 未開工。~~ 🔴 **過期字面(兩關審查各自抓到)** —— 同一條目**兩個進度欄**,
  上面那個已更新、這個沒有。**以上面那個「進度(2026-08-14…)」為準**;
  本行不刪、留著當「一條目只該有一個進度欄」的實例。
- **分流標籤:** `P2`

### #477. 🏷️ 包裹單號與訂單號**肉眼分不出來**(同產號器、同字母表、同 6 碼、皆無前綴)

- **狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(**現在改幾乎零成本;員工開始出貨後會變成資料遷移**,見「時間窗」)
- **觸發事件:** 2026-08-14 Sean 在正式站操作後回報逐字:「我發現包裹單號 也跟我們訂單號碼一樣採取五位數,這個會造成混淆,換一個編號模式。」(實際是 **6 碼**,非五位數;混淆的判斷成立)
- **現況(實查):**
  - `shipment_reference` 格式 CHECK = `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`(`supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:98-99`)
  - 訂單 `display_id` 用**同一支**產號器 `pcm_generate_display_id`(`20260730120000...:124` COMMENT 逐字「固定 6 碼、無前綴…消費端:create_order(N3b)、**日後 shipment_reference**」)
  - ⇒ 兩者**字母表相同、長度相同、皆無前綴** ⇒ 除了上下文之外沒有任何判別點
- **不修未來會痛在哪:**
  - **操作直覺化(Sean 常設準則)**:員工把一組碼貼進搜尋框,**系統不知道他要找訂單還是包裹**;貼錯了畫面只會說「查無」,不會說「你貼的是包裹單號」
  - **對外**:客服對客人唸單號時無法口頭區分,客人回報的碼我方要猜是哪一種
  - **bug 可追蹤性**:log 裡兩種碼長得一樣,事後對帳分不出來
- **🏁 拍板(2026-08-14 Sean,Q=B,推翻主視窗推薦的 A):**
  - **B = 換不同長度(例如 8 碼)**,不是加前綴
  - 主視窗原推薦 A(加前綴 `P-`),理由=一眼可辨且搜尋不會撈錯;**Sean 選 B,已知代價=要數字元才分得出來**
- **🔴 時間窗(這條是本條目最重要的部分):**
  - 實查 `select count(*) from shipments` = **3 筆**,全部在最近 30 天 = **測試資料**(後台尚未啟用)
  - 該 migration `:467` 逐字「**一旦有真實包裹就不要 DROP**:`shipment_reference` 的『永不重用』保證由本表的存在承擔」
  - ⇒ **現在改 = 改一條 CHECK + 產號器參數;員工上工後改 = 資料遷移 + 永不重用保證的處理**
- **⚠️ 實作時必須先處理的一件:** 現存 3 筆是 6 碼 ⇒ CHECK 改成 `{8}` 會讓它們違反約束。
  處置(刪測試列 / 放寬成 `{6}|{8}` / 其他)**需 Sean 拍板**,屬正式庫資料刪除 ⇒ 不可自行決定。
- **連動面:** `pcm_generate_display_id`(共用產號器,改動會影響訂單號 ⇒ **不可直接改它,要另開或加參數**)/ `shipment-dialog.tsx:432` 顯示面 / 出貨線 harness 的釘值
- **發現於:** 2026-08-14 · Sean 正式站實測 · 主視窗實查佐證
### #478. 🧪 退款帳本的其餘六個員工字面零守門:改字面不會有任何一格紅

- **狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(不會壞掉,是**改壞了沒人會叫**)
- **問題:** `apps/admin/src/lib/payment/refund-ledger-view.ts` 的兩張表,除了 `confirmed` 之外**全部沒有守門**:
  - `REFUND_STATUS_LABEL` 的 `processing`(`:12`)/ `deferred` / `failed`
  - `REFUND_FAILED_REASON_LABEL` 的 `rejected_out_of_range` / `not_sent` / `manual_failed`(`:19-23`)
  現有測試(`refund-ledger-section.test.tsx:72,75`、`app/orders/refund-exceptions/page.tsx:112`)一律走
  `refundStatusLabel(...)` / `refundFailedReasonLabel(...)` **間接引用** ⇒ 把字面改成任何東西,測試照樣綠。
- **🔴 一句實證(不是推論):** 2026-08-14 的文案片改 `confirmed` 字面時,**補上 `[4b]` 那格之前**,
  把它改回舊字面(突變 M3)**是綠的**;補上之後才 `EXIT=1 · Tests 1 failed | 17 passed (18)`。
  ⇒ **同一個檔、同一個形狀,已經實測過一次「改字面零守門」是真的。**
- **不修會痛在:**
  - **bug 可追蹤性(主因):** 這六個字面是**值班看著它決定要做什麼**的字(例:`deferred` 逐字「尚未請款、本筆已作廢(請款完成後可重新發起)」——
    改錯成「已退款」會讓值班以為錢退了而不再重發)。它們**寫在金流面**,而**零守門**。
  - **可維護性:** 2026-08-14 已經證明「改文案會掏空守門」在這個檔真的會發生;下次有人改那三態,**沒有東西會叫**,
    而審查者看的是 diff、看不到「這一改讓哪一格失去判別力」。
  - **擴充性:** 想加任何「文案不得含 X」的規則(例如不得寫死時長/時點,`confirmed` 那格已經有了),
    現行結構下**只能一格一格手加**,沒有共用的形狀。
- **預期解法(未拍板,兩條):**
  1. 照 `[4b]` 的形狀逐態補(正向 + 負向成對、只取狀態格、先釘表頭索引)—— 六格,約 60-90 行測試。
  2. 改成一張表驅動的參數化測試(`it.each` 走 `REFUND_STATUS_LABEL` 全鍵),再對每個字面掛共用的負向規則
     (不得含「還能退/剩餘可退」、不得寫死時長時點)。**較省行數,但要小心「表自己漂了測試也跟著漂」** ——
     參數化測試吃的是同一張表 ⇒ 必須另外釘住**鍵的集合**(否則有人刪一個鍵,測試會少跑一格而不是變紅)。
- **估時:** 方案 1 = 45-60 分;方案 2 = 60-90 分(多的是「釘鍵集合」那道)。
- **依賴:** 無(純測試層;不動 production code)。⚠️ 與 `#474`(測試檔全域被 lint 豁免)同族但**不互相阻塞**。
- **發現於:** 2026-08-14 · R 窗做 `confirmed` 文案換口徑片時實測(`~/pcm-mailbox/R-011-STOP.md` §⑥);號由主視窗指派。
- **相關:** `#470`(守門本身零突變靶)/ `#474`(測試檔零 lint)/ `#475`(卡片 CSS 落點守門只驗有沒有)—— **同族:守門沒有人守**。

### #479. ⛔ 【不可達,存查】整張單取消時,退款守門線剩下的是「運費 − 折扣」殘值,可能為負而擋死所有退款

- **狀態:** ⛔ **不可達(2026-08-14 當日複核推翻,立案後約 1 小時)—— 不刪,存查用**
- **🔴 為什麼不可達(逐字證據):** 本條的前提是「一張已付款的單身上有取消紀錄」。**經由 RPC 那不可能:**
  - **取消端**只收未付款單:`supabase/migrations/20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:199-203` 與 `20260805100000_m4b_e10_a8a2_partial_cancel.sql:360-364` 逐字 `IF v_order.payment_status <> 'unpaid'::public.payment_status OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN RAISE EXCEPTION`(連「有一筆非 failed 的刷卡嘗試」都擋)。
  - **付款端**拒收有取消紀錄的單:`confirm_order_payment` 三代 `20260804150000:93-97` / `20260810160000:403-404` / **`20260810170000:369-370`(時間戳最大=live)** 逐字 `IF v_order.cancelled_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN RAISE EXCEPTION`;`20260810160000:569-585` 另把該閘字面釘進結構斷言。
  - ⚠️ **強度**:是「**經由 RPC 互斥**」不是絕對 —— `20260611120000:230` 逐字寫著 service_role「可繞過 `confirm_order_payment` 直接 UPDATE」。與 `#445` §8 第 1 條同層級。
- **🔴 誤判經過(這條才是本條目留著的價值):** 2026-08-14 R 窗跑 `#445` R4 對抗審查,A 軸(adversarial-reviewer / opus,fresh context)構造出「1000 元的單刷卡全額、取消 700 ⇒ 多退 300」並標成**【已量到】**;R 窗主對話**獨立重量三條**(`orders.total` 有 CHECK / 全樹零 `UPDATE ... SET total` / `admin_cancel_order` 只寫三欄)、**三條全部是真的**,於是判為 BLOCKER 呈給 Sean,Sean 據此拍 `Q-445-R4-1`=A 並擴大片界。**約 1 小時後主視窗質疑式子方向,追查才發現場景不可達。**
  - **病根:** 量的是**機制**(total 永不下修 —— 真的),沒問**可達性**(這條路走得到嗎)。
  - 🔴 **同一天 R 窗用「這格紅的時候是誰讓它紅的」審了 41 個驗收格,卻沒對自己的 BLOCKER 問對稱那句「這個場景是誰讓它發生的」** ⇒ **恆綠格 = 紅不起來的守門;假 BLOCKER = 發生不了的災難,同一形狀的正反面。**
  - 🔴 **四輪對抗審查、三個模型(codex / opus / Fable)沒有一輪問過可達性** ⇒ 這是**審查角度的缺口**,不是個人疏失。制度條文由主視窗執筆。
- **後續:** 若日後放寬取消端或付款端任一道閘(例如允許已付款單走取消流程退貨),**本條立即復活**,請連同 `#480` 一起重估。
- **相關:** `#445`(母片)/ `#480`(同一次誤判的雙生條)
- **(以下為立案當時原文,保留備查)**
- **原狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(**fail-closed,不會多退錢;但會擋掉合法退款,而且是在「整單取消」這個最需要退款的場景**)
- **問題:** `#445` plan v7 依 `Q-445-R4-1`=A 把守門式改成 `(orders.total − Σ(cancelled_quantity × unit_price)) − GREATEST(...)`。但 `orders.total` 的定義是 `subtotal + shipping_fee − discount_total`(`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:26` 逐字 CHECK),而 `subtotal = Σ line_total`(同檔 `:101` 逐字)⇒ **被減數與減項不是同一個尺度**:扣掉的是品項那一側,運費與折扣**不隨取消縮放**。⇒ 整張單取消時 `guard = shipping_fee − discount_total`,**不是 0**。
- **員工會看到什麼:** `discount_total > shipping_fee` 的單整張取消後,`guard` 為負 ⇒ 任何金額都撞 `REFUND_EXCEEDS_REMAINING` ⇒ 面板顯示的上限是負數或 0、退款按了就被擋,而**客人的錢還在我們這裡**。訊息會說「金額超過上限」,但員工把金額降到 1 元仍被擋 —— 訊息把它講成金額問題,實際是**式子的尺度問題**。
- **觸發事件:** 2026-08-14 · R 窗折 `Q-445-R4-1`=A 進 plan v7 時,查 `orders.total` 的 CHECK 定義撞到;**不是 R4 兩軸的 finding,是 A 案本身帶出來的新問題**。
- **🔴 今天為什麼還沒出事:** `#445b` 尚未 apply ⇒ **守門式還不存在**,`admin_initiate_order_refund` 現況零金額守門(`20260803150000:25` / `:298` 逐字「零超退守門」)。本條的實害隨 `#445b` 上線同時誕生。
- **不修會痛在:**
  - **正確性(退款方向反了):** 整單取消 = 最典型的「該全額退」情境,而守門在這個情境下最嚴。**防超退的機制在最該放行的時候擋得最死。**
  - **可追蹤性:** 症狀是「退款鈕按了說金額超過上限,但上限顯示 0 或負數」,員工無從得知那是運費/折扣的殘值 —— 與 `#473` 同型(畫面說的原因不是真原因)。
  - **🔴 靜默放寬的風險比不修更高:** 這條若不明文定案,日後有人看到負數「順手」`GREATEST(guard, 0)` clamp 掉 —— 那是**放寬守門**,而放寬會讓格子綠、沒人會發現(交接檔 2026-08-14 §5-4)。⇒ plan v7 已配**驗收格 46** 把現況(為負就擋)釘住,**改它必須先改格 46**。
- **預期解法(三選一,未拍板 = `Q-445-R4-2`,寫在 plan v7 §2-9a):**
  1. **現況(v7 採用)** — 算多少是多少、為負就擋。fail-closed,但擋到「連運費一起退」。
  2. **全取消時 `guard = orders.total`** — 運費也可退。要多一條「是不是全取消」的判斷(Σ cancelled_quantity 是否等於 Σ order_items.quantity)。
  3. **運費永不退** — `guard` 再減 `shipping_fee`。語意最單純,但對客人不利,屬商業政策。
- **估時:** 方案 2 = 40-60 分(含新增「全取消」判斷 + 驗收格 + 對抗審查);方案 3 = 20-30 分。
- **依賴:** `#445b`(守門式本體;本條是它的後續調整,**不擋 `#445b` 上線** —— 三個方案都不影響 `#445` §1「100 元的訂單退不出 99999」)。屬 **Sean 商業拍板**,不是工程可自決。
- **發現於:** 2026-08-14 · R 窗 · `#445` plan v6→v7 折 `Q-445-R4-1`=A 時(`~/pcm-mailbox/R-104-STOP.md`);號由主視窗指派。
- **相關:** `#445`(超退閘,本條的母片)/ `#480`(finalize 標籤偏差,**同一個「總額不等於該退的錢」根因**)/ `#473`(畫面說的原因不是真原因,同型)

### #480. ⛔ 【不可達,存查】部分取消的單退到「該退的錢」時會被標成 `partiallyRefunded` 而不是 `refunded`(錢對、標籤錯)

- **狀態:** ⛔ **不可達(2026-08-14 當日複核推翻)—— 不刪,存查用**
- **🔴 為什麼不可達:** 與 `#479` **同一個根因**。本條要成立必須有「已付款 + 有取消紀錄」的單,而**取消端只收未付款單**(`20260804180000_..._a8a1:199-203` / `20260805100000_..._a8a2:360-364`)、**付款端拒收有取消紀錄的單**(`confirm_order_payment` 三代:`20260804150000:93-97` / `20260810160000:403-404` / **`20260810170000:369-370` = live**)⇒ `admin_finalize_order_refund` 永遠遇不到這種單。**逐字證據與強度收斂(「經由 RPC 互斥」非絕對)見 `#479`,不在此重複。**
- **🔴 誤判經過(本條特有,`#479` 沒有的一段):** 本條由 **R 窗**在 R4 對抗審查中提出,**主視窗開檔複核過** `20260803150000:772-782` 並**修正了 R 窗的措辭**(把「finalize 也拿 `orders.total` 當上界」更正為「它是**狀態分類器**不是擋門」——**那個更正本身是對的**)。
  - 🔴 **但兩個人都只核了「這段 code 在做什麼」,沒有人問「這個場景走得到嗎」。** 主視窗已明白表示這一條記在它頭上,不是 R 窗單方疏失。
  - ⇒ **教訓不是「複核不夠」,是複核問錯了問題**:一份 finding 被第二個人開檔核過,只證明**引用正確**,不證明**場景可達**。這兩件事需要**兩道不同的檢查**。
- **後續:** 若日後放寬取消端或付款端任一道閘,**本條與 `#479` 一起復活**。
- **相關:** `#445`(母片)/ `#479`(同一次誤判的雙生條,逐字證據在那)/ `#481`(狀態閘表 —— 就是為了讓「這條路走得到嗎」有地方查而開的)
- **(以下為立案當時原文,保留備查)**
- **原狀態:** ⏳ 待執行
- **分流:** `P1-before-launch`
- **優先級:** 🟠 中(**不動錢、不影響退款金額;錯的是訂單的付款狀態標籤,而那個標籤有下游讀者**)
- **問題:** `admin_finalize_order_refund` 用 `v_sum >= v_total` 決定把 `orders.payment_status` 標成 `refunded` 還是 `partiallyRefunded`(`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:772-782`)。`v_total` 取的是 `orders.total` = **原始**總額,而部分取消**不下修 `orders.total`**(`admin_cancel_order` 對 `orders` 只寫 `cancelled_at / cancelled_reason / updated_at`,`20260805100000_m4b_e10_a8a2_partial_cancel.sql:462-467` 親讀;全樹零 `UPDATE ... SET total`,量法 `grep -rniE "set[^;]*\btotal[[:space:]]*=" supabase/migrations/*.sql` = 0 行)。⇒ 1000 元的單取消 700 後退掉該退的 300,`v_sum(300) >= v_total(1000)` **為假** ⇒ 標成 `partiallyRefunded`,而**這張單其實已經退完了**。
  - 🔴 **這是分類器不是擋門** —— 它不會放行任何超額退款(那是 `#445` 步 6b 的職責)。**錢是對的,標籤是錯的。**
- **員工會看到什麼:** 訂單狀態永遠停在「部分退款」,而帳上沒有任何餘額可退。`#445b` 上線後更矛盾:**狀態說「部分退款」、按退款卻回「已無可退額度」** —— 兩個畫面互相打臉,員工無從判斷哪個是真的。
- **觸發事件:** 2026-08-14 · R 窗 R4 對抗審查(A 軸 S1 的旁證)。⚠️ **我第一版把它寫成「finalize 也拿 `orders.total` 當上界」,那句比事實強** —— 主視窗開檔核 `:772-782` 更正為「狀態分類器」,已採納。
- **🔴 今天為什麼還沒出事:** 需要「部分取消 + 退款退到剩餘額」同時發生;後台尚未啟用、只有 Sean 在測(memory `project_admin-preprod-planning-posture`)。
- **不修會痛在:**
  - **正確性(下游讀者):** `payment_status` 不是只給人看的 —— `admin_initiate_order_refund` 步 5 就拿它當業務閘(`20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql:595-599`:`refunded` 硬擋、非 `paid/partiallyRefunded` 擋)。標籤錯 ⇒ **一張已退完的單仍被視為可再發起退款**,只是會被 `#445` 的金額閘擋下來 —— 兩道閘互相遮蔽,而遮蔽會讓其中一道的負測構造不出來(同族教訓:`feedback_unconstructible-negative-test-means-noop-guard`)。
  - **對帳:** 訂單列表/報表用 `payment_status` 分堆時,退完的單會落在「部分退款」那一堆,數字對不起來。
  - **🔴 與 `#445` 的關係:** `#445` plan v7 已把它列進 §8 誠實邊界具名條 `finalize 標籤`。**若與 `#445b` 同批修就沒有這個缺口;不同批修,它就是 `#445b` 上線後的新缺口**,必須寫在明處、不得宣稱「退款狀態已正確」。
- **預期解法(兩選一,未拍板):**
  1. **與 `#445b` 同批** — `admin_finalize_order_refund` 的 `v_total` 改成「總額 − 已取消金額」,與 `#445` 步 6b 共用同一支 helper(`pcm_order_refund_guard_remaining` 的被減數那一半)⇒ **單一真相**,不養第二份會漂移的算式。⚠️ 動的是已 apply 的 migration ⇒ **鐵則 12③**。
  2. **另片** — 先在 `#445b` 的 migration 檔頭與 §8 寫明缺口,標籤偏差留到 `#445` 全線收尾後單獨處理。
- **估時:** 方案 1 = 60-90 分(含回歸:finalize 的既有語意/`recovered_confirmed` 路徑/回退腳本指紋);方案 2 = 10 分(只寫檔頭與誠實邊界)。
- **依賴:** `#445b`(共用被減數的話,必須在它之後或同批)。**方案 1 命中鐵則 12③ ⇒ 需 Sean 批准 plan。**
- **發現於:** 2026-08-14 · R 窗 · `#445` R4 對抗審查 A 軸(`~/pcm-mailbox/R-104-STOP.md`);號由主視窗指派。
- **相關:** `#445`(超退閘,同一根因)/ `#479`(運費折扣殘值,**同一個「`orders.total` 不等於該退的錢」根因**)/ `#442` `#443`(帳本語意同族)

### #481. 🧭 【已完成】訂單狀態閘表 —— 讓「這條路走得到嗎」有地方查

- **狀態:** ✅ **已完成**(2026-08-14,R 窗)。產物 = `scripts/state-gates.sh` + `docs/reference/order-state-gates.md`
- ⚠️ **「完成」指產物存在且可重跑(主視窗獨立驗過:重跑後 sha256 逐字相同),不指「已被證明有用」** —— 兩次派 code-reviewer 都提供了它,兩次工具回報欄都沒列到它 ⇒ **實際使用驗證仍為零**。
- **起因(這條的價值全在這裡):** 2026-08-14 R 窗在 `#445` R4 對抗審查中呈了一條 BLOCKER,Sean 據此拍板並擴大片界;約 1 小時後發現**那個場景經由 RPC 根本走不到**。誤判的三條機制證據**全部是真的**,錯在**沒問可達性** —— 而「哪支 RPC 在什麼條件下才允許」這件事,當時**沒有任何地方查得到**。
- **為什麼不用 graphify(主視窗 2026-08-14 實跑):** `graphify query "已付款的訂單還可以取消品項嗎 admin_cancel_order 的允許條件"` → 4 nodes、**全部來自 `docs/specs/*-prd.md`**、允許條件**零命中**。graphify 答「誰跟誰有關係」,不答「什麼條件下才允許」;而且它的答案來源是**文件**,而今天的病根正是「**文件寫的 ≠ 程式碼實際擋的**」。
- **做了什麼:**
  - `scripts/state-gates.sh`:唯讀掃 `supabase/migrations/*.sql`,產出兩段 —— ①**同名函式的世代表**(誰被 `CREATE OR REPLACE` 過、**哪一代才是 live**)②**每支會改訂單狀態的函式 × 它的允許集合逐字 × 行號**。
  - 範圍限訂單狀態:`payment_status` / `cancelled_at` / 取消列 / 退款帳本。**刻意不擴到全庫。**
  - 🔴 **只認 migration 程式碼,不吃 `docs/`。**
- **兩道自我守門(機制優先律,不是寫規則):**
  1. **編碼閘** —— 產物必須是 UTF-8。起因:第一版用 awk `substr()` 截字串(**數位元組不數字元**)把中文剖半 ⇒ 產出的檔 markdown 看起來正常、`sed` 印得出來,**但 `grep` 對整個檔失效**(`file` 說 `Non-ISO extended-ASCII … NEL line terminators`)⇒ **一張拿來查東西的表變成查不動的表,而且看起來是好的。** ⚠️ 量具實測換過一次:`iconv -f UTF-8 -t UTF-8` 在 macOS **對合法檔也失敗**(`Inappropriate ioctl for device`)= 一道恆紅的閘 ⇒ 改用 `file(1)`,並用真的壞掉的位元組序列做過負測。
  2. **自測閘** —— 表裡查無 `confirm_order_payment` / `admin_cancel_order` / `admin_initiate_order_refund` 任一支就拒絕覆蓋。起因:第一版的 pattern 真的漏掉 `confirm_order_payment`,而那正是本表要回答的核心問題。
- **驗收(已跑):** 表能回答「已付款的單能不能取消品項」—— `admin_cancel_order` 的允許集合看得到 `payment_status <> 'unpaid' … RAISE`(不能),`confirm_order_payment` 看得到 `cancelled_at IS NOT NULL OR EXISTS(order_cancellations) … RAISE`(反向也封死)⇒ **兩者經由 RPC 互斥**。連跑兩次 sha256 一致(冪等)。
- **🔴 掃描限度(表裡也印一份,不只寫在這):**
  1. 範圍 = `supabase/migrations/*.sql` ⇒ 強度是「**經由 RPC**」不是「絕對」;service_role 直接 UPDATE 繞得過(`20260611120000_m3_s2c_confirm_payment_rpc.sql:230` 自己就寫著)。
  2. 閘是**字面比對**不是 SQL 語意分析 ⇒ 會漏掉「用變數繞一手」寫的閘。**每格都給行號,下判斷前開檔看。**
  3. 函式歸屬用「最近一個 `CREATE FUNCTION` 在我上面」推定 ⇒ 函式後面 DO block 的結構斷言可能被歸進來(已知雜訊,不影響結論)。
- **不修會痛在:** 沒有這張表,下一次「這會導致 X」的斷言仍然只能靠人記得去開五支 RPC ——**而今天證明了那個「記得」會失效,連續四輪對抗審查、三個模型都沒問。**
- **後續(未做,不擋):** 擴到出貨/採購狀態;把「docs 有述、code 未見」做成自動比對(現在只在表頭寫了規則,沒有自動抓)。
- **發現於:** 2026-08-14 · R 窗 · `#445` R4 誤判複盤;號由主視窗指派。
- **相關:** `#479` `#480`(那次誤判的兩條 backlog)/ `#445`(母片)
### #482. 🧪 `docs/probes/452-2a2-lockprobe.sh` 不是可重跑的 —— 它假設 `probe_fx` 已存在

- **狀態:** ✅ 已修(2026-08-14 R 窗)
- **來源:** 2026-08-14 D 窗寫姊妹探針 `452-2a2-void-lockprobe.sh` 時實查發現。號由主視窗指派。
- **數法(可重數):** `grep -rn 'CREATE TABLE.*probe_fx' .` = **零命中**,而 `452-2a2-lockprobe.sh` 的 fixture 直接 `DELETE FROM public.probe_fx` / `INSERT INTO public.probe_fx` ⇒ 上一代是**手動建表**之後才跑的。
- **現況:** 那支是 `#452` 死結證據的**唯一載體**(發② 的 `40P01=1` + `CONTEXT` 逐字索引名 `order_item_procurement_business_key`),但今天任何人拿它重跑會**當場紅在 relation 不存在**。
- **🔴 它證的那件事【今天仍然成立】:** 「**`unvoid × A5a` 會死結**」**沒有被推翻,只是被 C 案繞開** —— Sean 2026-08-14 拍 `Q-452-換路 = C`(只做作廢、不做取消作廢)⇒ 那條死結的**一條邊不存在,不是那條死結不見了**。⚠️ 不寫這一行的話,下一個人會以為結論隨 C 案一起作廢了。
- **不修未來會痛在哪:** 這份證據唯一會被調閱的時機,就是**有人提議把「取消作廢」加回來**的那一刻。而那時他會發現它跑不動,於是**很可能改成相信檔頭的文字**而不是重新量。⇒ **一份不能重跑的證據,壽命只到下一個人願意相信它為止。**
- **修法(≈5 行):** 照 `452-2a2-void-lockprobe.sh` 的做法,fixture 開頭加 `CREATE TABLE IF NOT EXISTS public.probe_fx(item uuid, sup uuid);` 即自足。
- **✅ 怎麼驗的(2026-08-14 R 窗;實跑三次,不是宣稱):** 改在 `docs/probes/452-2a2-lockprobe.sh:68-71`。
  - **先做負向對照**:`DROP TABLE public.probe_fx` 後跑**未修版** ⇒ `exit=1` + `relation "public.probe_fx" does not exist`。⇒ **檔頭 `:34-38` 那幾道 fail-closed 斷言真的擋住了**,沒有退化成「假通過 1」(印 40P01=0 卻長得像沒死結)。
  - **修後從零跑**(先確認 `to_regclass('public.probe_fx')` 為空)⇒ `exit=0`,三發 = **`0 / 1 / 1`** + `23505 命中 = 1` + `索引名出現 = 1` ⇒ **與檔頭 `:11-19` 記載的原始數字逐字相同**(⇒ 修的是可重跑性,沒有動到它證的東西)。
  - **連續第二跑**(中間不清任何東西)⇒ `exit=0`,同樣 `0 / 1 / 1`。🔴 **只跑一次證得到「能跑」、證不到「可重跑」** —— 第二跑才是驗收條件本身。
  - ⚠️ **限度**:跑的是當時**還活著**的拋棄式庫(PORT `54461` / `/tmp/452-lockprobe`)。**這不證明它在一台乾淨機器上跑得起來** —— 建庫那段(`PORT=54461 bash scripts/452-verify.sh provision /tmp/452-lockprobe`)本次**沒有重跑**。
- **分流標籤:** `P3`

### #483. 👁 訂單頁不說「這筆退款已被列管」—— 只有異常清單看得見(`#473b-2` 產生的單向可見)

- **狀態:** ✅ 已修(2026-08-14 R 窗,與 `#473b-2` 同日;號由主視窗指派)
- **來源:** `#473b-2` 的 code-reviewer nit。**是那一片自己產生的不一致**,不是既有債。
- **問題:** `#473b-2` 讓「已人工判定結案、但判定改不了」的退款列進了異常清單,但訂單頁帳本區塊的徽章掛在 `isRefundException`(processing-only)⇒ **那些列在清單裡、訂單頁卻一個字都不說**。
- **🔴 不修未來會痛在哪:** **訂單頁是員工每天在看的那頁,異常清單是值班才會開的頁面** ⇒ 兩邊說法不一致時他會相信訂單頁。他會以為這筆退款一切正常、沒有被列管,於是不會去問任何人。
- **修法(已做):** 訂單頁對卡住的列掛**第二顆徽章**,措辭與可處理那顆**刻意不同** —— 那顆說「勿重複發起,待對帳處理」(有事可做),這顆說「這裡沒有可以改的動作,需要更正請聯絡工程師」(沒事可做、講下一步找誰)。
- **🔴 兩個判定式刻意不合併:** `isRefundException` = 「這列**可以按**對帳判定」;`isStuckManualVerdict` = 「這列**沒有動作可按**」。併成一顆 boolean 會讓兩種列長得一樣,而它們該做的事完全相反。
- **怎麼驗的(3 發突變,每發單獨跑、`shasum` 核對還原):** **突變位置都在元件呼叫端 `refund-ledger-section.tsx`,不是 `isStuckManualVerdict` 本體** —— 格數只對這個位置成立(改本體會連帶紅到清單頁與 `refund-read.test.ts` 的判定式專格,≥4 格)。徽章整顆不掛 ⇒ 2 格紅;兩顆徽章文案抄同一句 ⇒ 3 格紅;呼叫端寫死 `failedReason: 'manual_failed'`(所有 failed 都掛)⇒ 1 格紅。
- **順手更正的過期字面(同族病:改 A 讓 B 變成謊話):** ①`refund-recovery-actions.test.ts` 的註解仍寫「結案後這一列會從異常清單消失」;②**本檔 `#473` 條目的「現行文案」整段照抄 v3、含已刪的那句** —— ②**是 code-reviewer 抓的,不是我掃到的**:我在本條自稱掃過過期字面,卻漏掉同一個檔裡最像的那一處。**量法**:`grep -rn '會從異常清單消失' docs/ apps/src` 一次就到(4 個載體),我當時只掃了 code 沒掃 docs。
- **分流標籤:** `P2`


### #484. 🧱 訂單列表工具列 chip 排的殼 + 「全部」「未到貨」兩顆

- **狀態:** 🔀 **已拆三片,原本這條的範圍不再成立**(2026-08-14 主視窗裁):
  - **`#484a` 片 A1 = 貨品軸 view + 回退 + runbook** ⇒ ✅ **已 commit `ce5f4c86`,等 Sean apply**
    (plan `docs/specs/2026-08-14-484a-order-goods-axis-view-plan.md`)
  - **片 A2 = adapter 換源 + admin + 測試** ⇒ ⏸ **等 A1 apply 後 `supabase gen types` 才能開工**(型別雞生蛋)
  - **片 B = chip 排 UI(本條原本的內容)** ⇒ ⏸ 等 A2
  ⚠️ 舊 plan `2026-08-14-484-orders-toolbar-chips-plan.md` **仍在 repo,但它的結論是「先別開工」**;
     現行權威是上面那支 `484a` plan。**不要照舊那份動手。**
- **起因:** Sean 2026-08-14 對照 OD 指出四項殼差異之一。OD 真權威 `overview-desktop.html:610-614`(`.bar` + 4 顆 `.fchip`)/ CSS `:91-99`;我們現在**沒有 chip 排**,篩選只有 `<select>` 下拉(`order-filter-controls.tsx:186-204`)。
- **範圍:** 只做「全部」與「未到貨」——「待處理」歸 `#485`(定義未拍)、「退貨中」歸 `#487`(資料面不存在)。
- **🔴 不是純樣式:** 「未到貨」= `FULFILLMENT_STATUS_LABEL`(`order-list-view.ts:160-165`)前兩值(`notOrdered` + `ordered`)的**聯集**,而現行 `fulfillment_status` param 是**單值** ⇒ 要動白名單解析。
- **已知坑(OD 自己記的):** `overview-desktop.html:479-480` —— 加了退貨中 chip 後,面板開著(658)時工具列被壓到換行、高度 41px 撐破 34px 的列。
- **不修會痛在:** 篩「還沒到貨的單」現在要開下拉選兩次(而且選不出聯集)⇒ 員工每天最常做的分堆動作沒有一鍵入口。
- **估時:** 40 分(看 diff 面積估的,**沒拆到步驟級**)。命中鐵則 8(4 檔)⇒ 先提 plan 等批。
- **發現於:** 2026-08-14 · E 窗 · OD 殼盤點(`docs/specs/2026-08-14-od-page-shell-scope.md` §1-2);號由主視窗指派。
- **相關:** `#485` `#486` `#487`(同一批殼)

### #485. 🧭 訂單列表「待處理」chip

- **狀態:** 🏁 **定義已拍板(2026-08-14 Sean = C 案:兩者聯集)** —— 不再卡定義,改為**卡前置**:
  它要吃片 B 的 chip 殼,而那個殼 = `#484` 片 **B-1**。
- 🔴🔴 **拍板之後才浮出的三個缺口(E 十六代收工交接 `E-532-HANDOFF`;主視窗判「定義解了不代表題解了」)**:
  1. **chip 是互斥的,而「待處理」與「未到貨」母體大量重疊** ⇒ 員工按了一顆就看不到另一顆的內容,
     而兩顆講的是同一批單的不同面向。**這是 UI 形狀的問題,不是定義的問題,C 案沒有解它。**
  2. 🔴 **「還沒收錢」要不要含 `partiallyPaid` / `partiallyRefunded`?——Sean 沒有被問過這題。**
     照抄現行收款軸(`order-status-axes.ts:145` 逐字 `order.paymentStatus === 'paid' ? 'paid' : 'unpaid'`
     ⇒ 非 paid 全收斂成 unpaid)會讓
     <!-- 2026-08-15 更正:原寫「`:117` 的 `!== 'paid'`」= 假字面。實查 `grep -n "!== 'paid'"` 零命中、
          `:117` 是 `label: string;`。語意同、位置與字面都不同。C 窗自查抓到,主視窗複跑對上。 -->
     **已退款的單出現在「待處理」** ⇒ 那正是 `#494` 剛修掉的病在新地方復發。**開工前必問。**
  3. **`.or()` 與關鍵字那條 `.in('id',…)` 疊起來的括號優先序沒查** ⇒ **可能讓 L6 隱藏規則失效**。
     ⚠️ 這比「兩個 `.or()` 疊起來」那條更具體:兩者是不同的組合,**要各自查**。
- 🔴 **開工第一件事是查 PostgREST 的 OR 語意,不是寫 code**(聯集 ≠ 把兩個 filter 疊起來,那是交集;
  現行 adapter 全 `.eq`/`.in` = AND)。
- **🏁 拍板(2026-08-14,經主視窗轉達)**:**C = 兩者聯集** ——
  「**還沒收錢 _或_ 還沒跟供應商訂貨,只要有一件事沒做完就算**」。
  🔴 **「聯集」是 OR、不是把兩個 filter 疊起來**(疊起來是 AND = 交集)。這一點做反了
  **畫面看起來一樣正常**,而篩出來的是「兩件事都沒做完」的那一小撮。
  ⚠️ **實作前第一個要驗的不是 UI**:現行 adapter 各軸是 `.eq`/`.in` 下推 = AND;要 OR 得用
  PostgREST 的 `.or()`,而**該檔已經被 M-4b 生命週期 L6 的隱藏規則用掉一次 `.or()`**
  ⇒ **兩個 `.or()` 疊起來的語意我沒查過**(`SupabaseOrderAdapter.ts` 的 `HIDE` 那段)。
  這是本條真正的風險,不是「加一顆按鈕」。
- ⏸ **範圍歸屬未定**:backlog 原寫「定義拍板後 20 分」,但那是在 AND/OR 這件事被看見之前寫的。
  **它是不是 B-1 之後那一片,要重新判鐵則 8**,不吃 B-1 的批准。
- **起因:** OD `overview-desktop.html:612` 只給了一顆 `<button class="fchip">待處理</button>` —— **沒有 data-\*、沒有說明、沒有定義它篩什麼**。
- **🔴 擋住的是定義不是實作:** 現有白名單是 `payment_status` / `goods_axis`(`#484a` A2 起取代 `fulfillment_status`)/ `order_source` / `payment_channel`,「待處理」對不到其中任何單一值。**要 Sean 說它是什麼**(候選:未收款?未訂貨?兩者聯集?)。
- **🔴 2026-08-14 片 B 偵察補的兩條新證據(E 窗,唯讀實查):**
  1. **需求檔從頭到尾沒有定義過它。** 數法:
     `grep -c '待處理' docs/specs/2026-08-12-admin-order-ui-design-brief.md` = **1**,
     而那一行(`:256`)是在講**顏色矛盾**、不是定義 ⇒ **不是「寫在別處我沒找到」,是真的沒有。**
  2. 🔴 **同名不同義(本條原本沒有的一條)**:repo 裡「未到貨」這個詞**只出現在出貨對話框的品項層**
     (`apps/admin/src/components/orders/shipment-dialog-copy.ts:24`、`shipment-launcher.tsx:41` 等),
     語意是「**這一件貨到了沒**」。而 chip 排要的是**訂單層**的軸。
     ⇒ **兩個同名的東西在不同層**;若有人拿品項層那份去定義 chip,會做出一顆
     「按了之後篩掉的東西與員工預期不同」的按鈕 —— 而那正是本條要防的病,只是換了個入口。
     ⚠️ 這條對「待處理」同樣成立:**先問「它是訂單層還是品項層的概念」,再問它篩什麼。**
- **不修會痛在:** 不修沒有痛 —— 這顆的價值完全取決於定義。**定義不清就做出來,會做出一顆按了不知道篩掉什麼的按鈕。**
- **估時:** 定義拍板後 20 分(輕量片,`#484` 的殼做完就是加一顆)。
- **依賴:** `#484`(殼)+ Sean 的定義。
- **發現於:** 2026-08-14 · E 窗 · OD 殼盤點 §1-2;號由主視窗指派。

### #486. 🏁 【已完成 · 乙案】訂單列表操作欄改「⋯」

- **狀態:** ✅ **2026-08-14 完工(乙案)** —— Sean 本人拍板選乙:**不做彈出選單**,
  ⋯ 改成一顆連結直接進面板的操作區(仍是 `#cancel` 錨點)。
  他是在知道代價之後選的:**OD 的意圖(所有訂單層操作進同一顆選單)不會兌現、而且他幾乎看不出變化**;
  甲案要破零 JS、丙案遠超估時。⚠️ **後續片不得「順手」朝甲/丙靠攏。**
- **🔴 交件時真瀏覽器實測(不是算的)**:容器 400px(卡片檔)⇒ ⋯ 視覺 **36×36**、觸控命中區 **44×44**、
  桌機那槽 `display:none`;容器 1200px(桌機檔)⇒ 視覺 **26×26**、命中區 **26×26**、手機那槽 `display:none`。
- **🔴 施工中被 code-reviewer 用真瀏覽器抓到的三件(都是「CSS 字面對、用值錯」)**:
  ①卡片模式的 `width:36px` **從未生效**(`.orders-grid .col-ops{width:34px}` 特異性壓過 `td{width:auto}`,實測 30px);
  ②因此熱區實測 **36×42**,比改版前的 50×48 **更小** —— 我原本是在「把手機觸控目標改小」而畫面看不出來;
  ③`display:inline-flex` 被 `a[data-nav='page']{display:inline}` 同特異性、後出現而蓋掉 ⇒ ⋯ 沒有置中。
  ⇒ 三條都修了,並各補一格守門 + 突變(共 10 發全紅)。
- **原始證偽紀錄(保留,因為它是「乙案為什麼是乙案」的理由)**:2026-08-14 動手前 hit test
  **證偽了原規格**(零 JS `<details>` 彈出選單)。4px 前置那條已於同日撤回(實測推翻),
  但**冒出一個更根本的**:**選單在這張表裡點不到。**
- **🔴 量到什麼(`elementFromPoint` 逐顆按鈕,不是截圖)**:
  | 情況 | 三顆選項 |
  |---|---|
  | 現況直接放 | ❌ 3/3 點不到 —— 命中的是**下面幾列的 stretched link** |
  | 加 `td.col-ops{overflow:visible}`,第一列 | ✅ 3/3 點得到(其他欄不受影響,`col-sku` 截斷 0/18 不變) |
  | 同上,**最後一列** | ❌ 3/3 點不到 —— 選單底部 904 > `.orders-grid` 底部 825,被 `overflow-x-auto`(連帶 y)夾掉 |
  ⇒ **兩道夾子**:①`td{overflow:hidden}`(片3 為 ellipsis 加的)可解 ②`.orders-grid` 自己的 overflow **解不掉**(窄版橫向捲軸要用)。
- **三條路(Sean 拍,主視窗已排進他的隊列)**:
  - **甲** `overflow:visible` + 靠底部的列讓選單**往上開** ⇒ 純 CSS 判不準「哪幾列算靠底部」(`tbody` 分組、列高隨密度變)**多半要 JS ⇒ 破「零 JS」**
  - **乙** 放棄彈出選單,⋯ 改成一顆**連結**直接進面板操作區 ⇒ 零風險 10 分鐘,**但 OD 的意圖沒兌現**(`orders-list-directions.html:243`:「未來的退款/沖銷/重寄通知**全部進同一顆選單**」),而且 Sean 幾乎看不出變化
  - **丙** client component + portal ⇒ 破「零 JS / server component」,且 `.orders-grid` 有 `container-type: inline-size`(`globals.css` 片3 檔頭警告過會影響 `position:fixed` 子孫)⇒ **遠超 45 分**
- **不修會痛在:** 每加一個訂單層操作(退款/沖銷/重寄通知)就要再加一欄,而欄寬已經零和 ⇒ **不解決這題,下一個功能沒地方放。**
- **⚠️ 沒量的:** 甲案「往上開」能不能純 CSS 判斷(停在證偽、沒往下試補丁)/ 手機卡片模式 / 鍵盤與 `Esc` 關閉。
- **起因:** Sean 2026-08-14 點名的四項之一。OD:列表列 `overview-desktop.html:985`(`<button class="kb">⋯</button>`、CSS `:214-216`)、選單本體 `:1052`(`<details class="km"><summary class="k">⋯</summary>`、CSS `:401`)。意圖見說明稿 `orders-list-directions.html:243` 逐字:「未來的退款／沖銷／重寄通知**全部進同一顆選單,不必再加欄**」。
- **我們現況:** `orders-table.tsx:375-398` 渲染**兩顆**「取消」`<Link>`(桌機/手機由 CSS 分流),已取消顯示「—」。
- **🔴 原本登記的「要多 4px、得 Sean 再拍一次」已作廢(2026-08-14 同日實測推翻,是我引錯表):** `:1047` 在**客戶卡/供應商那塊**(`.k-cell`),不是訂單列表列。**訂單列表列在 OD 自己就是 `:124` `.k-ops{width:34px}` + `:127` 內距 2px,與我們一模一樣。** 實測:OD `.kb`(26×26、`:214-216` 逐字)放進我們 34px 的格子 ⇒ **0/15 被截**、整表不溢位;改 38px 反而讓總寬 1412→1416 **造出橫向捲軸**。⇒ **本片不需要動欄寬、沒有前置拍板。**
- **不修會痛在:** 每加一個訂單層操作(退款/沖銷/重寄通知)就要再加一欄,而欄寬已經沒有空間 ⇒ **不改成選單,下一個功能就沒有地方放。**
- **估時:** 45 分(標準片;`orders-table.tsx` + `globals.css` + 測試 = 3 檔,**剛好在鐵則 8 的線上**,體積超過就拆)。
- **依賴:** 無前置拍板;**排在 `#484` `#485` 之後**(它與欄寬片同檔,`#484` 不同檔)。
- **發現於:** 2026-08-14 · E 窗 · OD 殼盤點 §1-4 與 §3;號由主視窗指派。

### #491. 🧭 訂單列表「車種」欄 2/11 被截 —— **確認屬實,但修不掉(欄寬零和)**

- **狀態:** ⏸ **等 Sean 取捨**(不是待開工:程式面沒有東西可修,只有寬度可搬)。號**由主視窗指派**。
- **事實(2026-08-14 用正確量法複驗)**:`col-vehicle` 180px、content box 164px。
  `2012 Ducati Hypermotard 1100 Evo` 文字寬 **213**(需欄寬 **229**)⇒ **被截**;`2020 Kawasaki Z400` = 128 ✅。
  **2/11 格被截**(兩個獨立 oracle 一致:`Range` 文字寬法、`scrollWidth` 法)。
- **🔴 取捨表(實測,同一份字體與現場)**:補滿要 **+49**,只能從品名扣。

  | 品名欄寬 | 可用 | 裝得下 | 現有 10 個品名會被截 |
  |---|---|---|---|
  | **154(現況)** | 138 | 9 個中文字 | **0/10** |
  | 131 | 115 | 8 | 0/10 |
  | **105(車種補滿)** | 89 | 6 | **4/10** ← `E8 認證方向燈組`/`品牌貼紙（白色）`/`防爆水管 6件組`/`引擎防泥濺護板` |

  ⇒ **修好 1 格車種 = 弄壞 4 格品名。** 而且**中間值買不到東西**:車種 203 仍放不下那個 Ducati(需 229)。
- **不修會痛在:** 那一列看不出是哪台車的下半段(`…Hypermotard 1100` 之後被切)。**只影響車名很長的車**;
  今天正式站只有 1 個車種值命中。
- **⚠️ 量具教訓(同日 `col-pick` 誤報的反面)**:對**文字**用「文字寬 vs content box」或 `scrollWidth` 都有效;
  **`elementFromPoint` 在這裡是錯的量具** —— 整列被單號的 stretched link 蓋住,每一格都回 false。
- **發現於:** 2026-08-14 · E 窗 · 片5 欄寬量測;2026-08-14 同日複驗。
- **相關:** `Q-E2`=A(維持固定寬)/ `#486`(同樣卡在欄寬零和)

### #487. 🧭 「退貨中」chip 的資料面前置 —— 退貨流程未實作

- **狀態:** **不排片**(登記缺口,不是待辦工)。
- **起因:** OD 工具列有一顆 `退貨中 <b>0</b>`(`overview-desktop.html:614`、`.fchip-ret` CSS `:477`)。**我們沒有「退貨」這個狀態** —— `cancel-review-section.tsx:101` 逐字「已到貨的部分要**走退貨流程**」、`:155` 註明「那是**第 3 批**」。
- **🔴 所以這顆 chip 不是前端工:** 沒有可篩的狀態、也沒有可數的數字。硬做只能得到一顆**永遠顯示 0** 的按鈕 —— 那比沒有更糟,員工會以為「真的沒有退貨中的單」。
- **⚠️ 一條 OD 內部矛盾(引用前先看):** 說明稿 `index.html:162` 說退貨中的單在列表上有「整組**琥珀色左邊條**」—— 在會被執行的 `overview-desktop.html` 裡**不存在**:`grep -c 'border-left'` = **2**(`:87` 面板分隔線、`:488` 「尚未實作」標籤塊),`data-ret`/`tr.ret`/`.ret-row` **0 命中**。已記進 `design-brief` §0-D。
- **不修會痛在:** 退貨是真實業務(已到貨的部分不能走取消)。現在員工唯一的指引是取消頁上的一句文字,**列表上完全看不出哪些單卡在退貨**。
- **估時:** 未估 —— 要先有退貨流程的 PRD/片界,不是一片的量體。
- **發現於:** 2026-08-14 · E 窗 · OD 殼盤點 §1-2;號由主視窗指派。
- **相關:** `#484`(同一排 chip)

### #488. 🔍 `orders.fulfillment_status` 13/13 實測為 `notOrdered`,而列表膠囊算得出 `ordered`

- **狀態:** 🔀 **修法已併進 `#484a` 片 A1**(2026-08-14 主視窗裁:「那不是附帶發現,那是本片真正的價值」)——
  A1 的 view 算出 `goods_axis`,A2 起「出貨狀態」下拉改吃它 ⇒ **那個「篩已到貨永遠零筆」的症狀由 A2 收掉**。
  ⚠️ **本條不因此結案** —— 還沒答的是「**這個欄位是死欄位,還是某條路徑漏寫**」:
  它仍被 `20260714120000_m4a_order_workflow_status.sql:142-148` 的 `workflow_status` 推導式吃著,**那條路徑沒查**。
- **事實(2026-08-14 正式站唯讀查證,13 張單全掃):** `orders.fulfillment_status` **13/13 都是 `notOrdered`**;用列表狀態膠囊那份算法(`order_item_quantity_summary` 彙總,`order-status-axes.ts:126-133`)算,**`PCM-2026-0104` 是 `ordered`** ⇒ **1/13 兩邊不一致,且欄位那一側從沒被推進過。**
- **數法(可整段重跑):**
  ```sql
  select o.fulfillment_status::text,
   case when bool_and(coalesce(s.shipped_quantity,0)>=oi.quantity) then 'shipped'
        when bool_and(coalesce(s.instock_quantity,0)>=oi.quantity) then 'instock'
        when bool_and(coalesce(s.ordered_quantity,0)>=oi.quantity) then 'ordered'
        else 'none' end as ui_axis, o.display_id
  from orders o join order_items oi on oi.order_id=o.id
  left join order_item_quantity_summary s on s.order_item_id=oi.id
  group by o.id, o.fulfillment_status, o.display_id;
  ```
- **🔴 為什麼這條要查而不是無害:** 這個欄位**現在就有消費端** —— 訂單列表的「出貨狀態」`<select>` 篩選走的正是它(`SupabaseOrderAdapter.ts:582` `.eq('fulfillment_status', …)`)⇒ **員工用那個下拉篩「已到貨」,今天必定回零筆**,而畫面上明明有膠囊寫著別的。它不是沉睡欄位,是**一個正在誤導人的篩選軸**。
- **不修會痛在:** ①員工篩不到東西會判「系統壞了」或改用眼睛掃 ②`20260714120000_m4a_order_workflow_status.sql:142-148` 的 `workflow_status` 推導式**吃這個欄位**,它若不準,那一整組推導值跟著不準。
- **估時:** 未估 —— 要先判「該由誰寫」(哪支 RPC 應該推進它),那是查的工不是修的工。
- **發現於:** 2026-08-14 · E 窗 · `#484` 技術前置調查;號由主視窗指派。
- **相關:** `#484`(因為這條而不能接 A 資料源)
### #489. 🏁 【已完成】生成型別 `database.types.ts` 落後兩支 migration —— 採購作廢兩欄不在裡面

- **狀態:** ✅ **2026-08-14 結案(`#484a` 片 A2 順手做完兩個結案動作)**
  ①`order_item_procurement.Row` 實查 **17 欄**、`voided_at`/`void_reason` 都在(數法 = 下面那條 awk,可重跑)
  ②`mappers/order-procurement.ts` 兩欄已從交集側**搬回 `Pick<>`**、還債註解已刪
  ⇒ **DB 改這兩欄的可空性,現在會有一格轉紅。**
  🔴 只做①不做② = 「有 typecheck 保護」是假的(消費端還是手寫的)—— 這兩件必須成對,寫在這裡免得下次拆開做。
  ⚠️ 重 gen 順帶的其他漂移:`graphql_public` schema 整段從生成輸出消失(TS 消費端 0 命中,已在生成檔檔頭記)。
- **分流:** `P2`
- **優先級:** 🟡 低(不會壞、不擋任何片;它是一筆**已標記的還債**,不是缺口)
- **問題(實查 2026-08-14):**
  - `packages/adapters/src/supabase/database.types.ts` 的 `order_item_procurement.Row` = **15 欄**,
    `voided_at` / `void_reason` **兩欄都不在**
    (數法可重跑:`awk '/^      order_item_procurement: \{/{f=1} f&&/^        Row: \{/{r=1;next} r&&/^        \}/{exit} r' packages/adapters/src/supabase/database.types.ts | wc -l`)
  - 建那兩欄的 `supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql:342-343`
    是 **2026-08-13 才 apply**;該生成檔檔頭 `:42` 逐字記著最後一次重 gen = **2026-08-11 晚** ⇒ 生成器沒跑過。
- **現況(`#476` 片 1 的處置,是還債標記不是解法):**
  `packages/adapters/src/supabase/mappers/order-procurement.ts` 把兩欄手寫在
  `Pick<Database[...]['Row'], …> & { … }` 的**交集側**、附還債註解。
  🔴 **刻意不手改生成檔** —— 該檔 `:1` 逐字「勿手改」,且已累積十個函式二十六處手動校正(`:2`),
  主視窗 2026-08-14 明令不准加第十一筆。
- **🔴 結案動作(本條的重點,不要自己動手):**
  **等 E 窗 `#484a` 片 A1 apply 之後 Sean 跑的那次 `supabase gen types`** —— 那一次會**順便**把這兩欄生出來。
  屆時要做兩件:①確認兩欄真的進來了 ②把 `order-procurement.ts` 的兩欄從交集側**搬回 `Pick<>` 清單**、刪還債註解。
  ⇒ **不要為本條單獨跑一次重 gen** —— 那會拉進 2026-08-11 之後**所有表**的漂移,是獨立範圍。
- **不修未來會痛在哪:**
  - **可維護性(主因):** 這兩欄的型別現在**不由生成器背書** —— DB 改掉它們的可空性,**不會有任何一格轉紅**。
    型別會對呼叫端說謊,而說謊的方向是「以為它可空/不可空」這種最難在 code review 看出來的。
  - **擴充性:** 片 2/3/4 都要讀這兩欄;交集側手寫每多一個消費端,搬回去的成本就多一分。
  - **bug 可追蹤性:** 下一個人看到 `Pick<>` 與交集側**兩種寫法並存**,若沒讀註解會以為那是刻意的設計慣例,
    然後照抄 —— 一筆還債就會變成一種風格。
- **重 gen 的既有流程(給結案的人,不是要你現在跑):** 生成檔檔頭 `:37-38` 的 `--project-id` 指令
  (走 Management API、不讀 `.env.local`)+ `scripts/regen-types-merge.py` + 二十六處校正的機械比對。
- **相關:** `#476`(片 1 種下這筆債)/ `#484a`(它的 apply 會觸發那次 gen types)
- **發現於:** 2026-08-14 · V 窗做 `#476` 片 1 時被 typecheck 擋下(`Type '"void_reason"' is not assignable`)· 號由主視窗指派

### #490. 🛠 「先列載體再掃」做成機制 —— `scripts/literal-sweep.sh`

- **狀態:** ✅ 已做(2026-08-14 R 窗;號由主視窗指派)
- **🔴 為什麼是機制而不是規則:** 「改了 A、讓 B 的文案變成謊話」這個病,規則寫過、教訓記過(memory `feedback_claimed-sync-but-only-patched-touched-lines`),2026-08-14 一天內仍復發 **3 次**。第三次最能說明問題:**我明明列了五類載體(元件/文案常數/測試/backlog/plan),執行時只掃了兩類**(code 掃了、docs 沒掃)⇒ 漏掉的那一處是 code-reviewer 抓的,不是我掃到的。⇒ `~/.claude/rules/00-work-rules.md` §4 機制優先律:**規則寫了會再犯,機制不會**;而「寫成規則」這條路已經走到底了。
- **核心設計(只有一件事重要):** **七類載體全部印出來,即使 0 命中,而且印出「這一類掃了幾個檔」。** ——「**這一類我掃了、沒有**」與「**這一類我忘了掃**」長得必須不一樣。那個差別就是上面那次漏掃的全部病因。
- **用法(一個參數,可寫進收工檢查表):** `bash scripts/literal-sweep.sh '<舊字面>'`;要正規式加 `--regex`。實測 2074 個文字檔約 1.2 秒。
- **七類:** ①`supabase/migrations/**`(含 `COMMENT ON`)②`scripts/*-down.sql` ③`docs/runbooks/**` ④`docs/specs/**` ⑤`**/*.test.*`+`docs/probes/**` ⑥`docs/phase-1-backlog.md`+`STATUS.md`+`docs/handoff/**` ⑦其餘一切(**沒有任何檔會被靜默丟掉**)。
- **🔴 驗收 = 真的負向對照,不是自我實現:** 拿**我今天實際漏掉的那一處**當測資 —— `git show 208102b0:docs/phase-1-backlog.md` 實查 `:12232` 確有「會從異常清單消失」(`208102b0` = 我做那次漏掃時的 HEAD),而本工具對該字面在 **⑥ 待辦與現況** 印出命中。⇒ **當時跑這支就會抓到。**
- **工具自己的負測(6 發,每發跑完 `shasum` 核對還原):** ①把 `docs/runbooks` 判準改成不存在的路徑 ⇒ 印出 `🔴🔴 這幾類一個檔都沒掃到`(盲區自我守門會紅,不是恆綠)②全大寫 ASCII 字面照樣命中 camelCase 原始碼 ③全形/半形括號等價(`NFKC` 直接驗:`normalize('（x）') == normalize('(x)')` 為 `True`)④純字串模式下 `.` 不當萬用字元(0 命中)⑤`--regex` 模式同一條 pattern 得 7 命中 ⑥壞旗標與空參數各 `exit=2`。
- **⚠️ 已印在輸出裡的限度(不要只當它掃過了):** 只掃**檔案裡的字面** ⇒ 組出來的字串、i18n key、DB 資料列、已 apply 但檔案已改的 migration 一律掃不到;跳過建置產物目錄;**它告訴你哪裡還有這個字面,不告訴你那句話現在是真是假** —— 那要人開檔判斷。
- **實作註記:** 比對本體走 `python3` 不走 `grep` —— 本機 `grep` 實為 **ugrep 7.5.0**(`grep --version` 自證),而本 repo 已記過多次 BSD/GNU/ugrep 方言互咬(memory `reference_measure-tool-dialect-and-silence-traps`)。跳過的 284 個檔**逐副檔名印出來**(全是 `.jpg`/`.png`/`.webp`/`.mp4`)——只印數字的話,「跳過的全是圖片」與「跳過了一份壞掉編碼的 `.md`」長得一樣。
- **⏳ 待 Sean 點頭的一行(本窗不自行改 `CLAUDE.md` 本體):** 建議把「**改了任何對外字面或守門述詞 → 拿舊字面跑 `literal-sweep`,逐類看完再 commit**」加進快速自檢清單的「slice 結束前」。路由表那一行也建議由主視窗統一寫。
- **分流標籤:** `P2`

### #492. 🏁 【已完成】backlog 發號改用 `scripts/next-backlog-number.sh`(三層掃描)

- **狀態:** ✅ **已完成**(2026-08-14,E 窗;號由主視窗指派)。產物 = `scripts/next-backlog-number.sh` + playbook `§F`
- **病(不是「忘記」,這點是關鍵):** 主視窗發號時查「**主樹當下最大 + 1**」⇒ 已配出、還在別窗 branch 沒 merge 的號**看不到** ⇒ 兩窗各自都以為拿到唯一的號,而**發現時機是收割**。當天 `#489` 真的撞了(V 窗已寫入 / E 窗拿去佔位)—— 🔴 **接住它的是「E 主動請主視窗確認」,不是機制。**
- **🔴 為什麼要一支有名字的腳本、而不是一行寫在文件裡的指令(主視窗自述,逐字):**
  「**我就是會寫出較窄版本的那個人 —— 不是忘了跑,是當場想了一個較窄的查法然後跑了它。**」
  ⇒ 文件擋不住「現想一個」;腳本擋得住,因為它**讓現想變成不必要**。
  ⚠️ 同族設計原則(今天三支工具共用):`literal-sweep.sh` 印**零命中**的類別、`state-gates.sh` 印**自己的限度**、本支印**三層** —— 都在防「使用者自己現想一個更簡單的做法」。
- **做了什麼:** 三層掃描並**各自印出**(主樹工作區檔 / 所有 worktree 工作區檔〔抓得到還沒 commit 的〕/ 所有本機 branch〔關掉的窗也涵蓋〕)。**三個數字不一致本身就是資訊** = 有號還沒回到主樹。掃描限度**每次都印**。
- **驗收(端到端負測,拿病發當下的狀態當測資):**
  `NEXT_BACKLOG_REFS='b185e3e0^ d6a18e38' NEXT_BACKLOG_SKIP_LIVE=1 bash scripts/next-backlog-number.sh` ⇒ **`#490`** ✅
  對照:當天的窄查法(只看自己 branch 父 commit)⇒ **488 ⇒ 發 `#489` ⇒ 正是撞掉的那個號。**
  兩個 env 是**測試接縫**(檔頭標明只給負測用、不出現在說明輸出裡)—— 沒有它們,負測只能驗第三層。
- **🔴 評估過 hook / CI,判定【不做】(主視窗 2026-08-14 拍板,理由要留著免得下一個人以為我們沒想到):**
  ①發生頻率低(今天 2 次,而今天是史上最多窗的一天)②**收割當下必然發現**(`uniq -d` 一跑就出來)③修復成本 5 分鐘
  ④**hook 的代價是掛在每一顆 commit 上** ⇒ 每個窗每天每顆 commit 都付稅
  ⑤🔴 **最關鍵**:真正沒被機制接住的是「發號的人現想一個窄查法」,**那發生在 commit 之前很久** ⇒ **hook 掛在 commit 上根本擋不到它。**
- **掃描限度(腳本每次都印):** 只存在於 remote、本機沒有對應 branch 的號 / 還沒寫進 `docs/phase-1-backlog.md`、只存在於某封信裡的號。⇒ **這支給的是下限**;號仍然跟主視窗要,真要佔位**必須標明「佔位、請主視窗確認」**。
- **發現於:** 2026-08-14 · `#489` 撞號 · E 窗與主視窗共同複盤
- **相關:** `#490`(`literal-sweep.sh`,同族機制)/ `#481`(`state-gates.sh`,同族)
### #493. 📅 日期欄預設值 —— 「已發生」預設當下、「預計/期限」一律留空

- **狀態:** ⏳ 待執行
- **分流:** `P2`
- **優先級:** 🟠 中(不會壞資料,但它是「欄位存在卻沒人填」的直接原因)
- **🏁 Sean 2026-08-14 拍板 `Q-日期預設` = A**(逐字起因:「因為我都沒有填寫送出時間,**我以為會預設好要填表的當下日期時間**..」)
- **實測起因(這條的證據不是推的):** 主視窗查正式庫
  `select count(*) from order_item_procurement where submitted_at is not null and voided_at is null` = **0 列**
  ⇒ **這個欄位存在、有 `保秒` 邏輯、有單元測試守著,而正式庫從來沒有人填過它。**
  🔴 **「沒人用」不是因為沒用,是因為它不會自己帶值** —— Sean 以為會、所以他沒填。
- **拍板內容:**
  - **「記錄已經發生的事」的欄位 → 預設當下**(例:採購「送出時間」= 我已經把單送給供應商了)
  - **「預計 / 期限」類 → 一律留空**(例:採購「預計到貨」= 我猜它哪天會到)
  - **判準寫死成一句給下一個人:「這格填的是【已經發生的】,還是【還沒發生的】?」**
- **🔴 為什麼不是「全部日期欄都預設當下」(選項 B,已否決):**
  「預計到貨」預設成今天 = **系統替員工說了一句他沒說過的話**,而那句話幾乎一定是錯的(今天送單、今天到貨?)。
  更糟的是**它看起來像有人填的** ⇒ 之後所有「快到貨了嗎」的判斷都建立在一個沒人講過的日期上。
  ⇒ 同族於 `docs/patterns/guard-and-instrument-traps.md` 的母題:**填錯的那次和填對的那次長得一樣。**
- **⚠️ 副作用要一起承擔(拍板時已講,不是事後補):** 預設之後,**員工就算沒想過也會存進一個時間**。
  對「送出時間」可接受(他按存檔就是因為他真的送了);**但不得把這個理由套用到別的欄位** —— 每一格都要重新問那句判準。
- **不修未來會痛在哪:** 現況是**一個欄位空著、而沒有人知道它是空的**。
  到貨追蹤、供應商回覆時效、異常統計全都要靠這個時間,而它至今零筆 ⇒ **那些功能日後做出來會是空的,而且查不出是從哪一天開始空的。**
- **範圍(未逐檔盤,估):** `apps/admin/src/components/orders/item-procurement-form.tsx:321`(送出時間 `datetime-local`)
  與 `:289`(預計到貨 `type='date'`)為第一批;**其他表單的日期欄未盤點**,開工第一動是用判準逐欄過一次。
- **發現於:** 2026-08-14 · Sean 肉眼驗 `#476` 時提出 · 號由主視窗用 `scripts/next-backlog-number.sh` 取得(三層皆 492 ⇒ 493)


### #494. 🔴 已退款的單在列表顯示「未收未定」、點取消被擋、而訊息說它「已付款」

- **狀態:** ✅ **完成**(2026-08-14 傍晚 V 窗兩片 `73b383bd` 片A 列表膠囊 + `f1ad5a3c` 片B 取消閘拒因分流;
  主視窗獨立三綠 **exit 分開收**、`TSC 0 / LINT 0` 皆 `0 cached` 真跑、`vitest 458 檔 7733 過`,與 V 回報逐字相同)。
  拍板 = **Sean 2026-08-14 傍晚 `Q-取消`=B / `Q-494-1`=A 確認推翻 08-13「照 OD 兩態」/ `Q-494-2`=B 矩陣外單一膠囊 / `Q-494-3`=A 開工**(6 檔 ⇒ 鐵則 8,Sean 本人批)。
  🔴 **codex 關卡2 不降級,抓 4 must-fix + 1 nit,V 自曝「抓得對的四條裡有三條是我自己種的」**
  (①`payment_refunded` 文案自相矛盾、還發明一個不存在的「通知系統維護結案」流程
   ②測試只驗「四句 title 不同」⇒ **兩碼文案整組互換仍全綠** ③把表格守門改弱成只數字面次數)。全折並加突變證明。
  六發定向突變各紅該紅的格。以下數字為 **V 窗回報、主視窗未逐條複驗**(主視窗複驗的範圍=三綠與格數):`未收未定` 全樹 32 命中 / 2086 檔、逐條看完 11 個原始碼命中 ⇒ 已退款路徑上 0 —— 量法 `grep -rn 未收未定 apps packages | grep -v node_modules | wc -l`(分類與分母見 `scripts/literal-sweep.sh`,它會把沒命中的載體類別也印出來)。
  🔴 **誠實缺口(不得當已驗)**:「已退款」膠囊的 class 是 V 挑的(**OD 沒有這一態**)、**視覺零人眼驗**;
  `partiallyRefunded` / `partiallyPaid` 在正式庫的筆數 —— 主視窗 2026-08-14 傍晚實查
  (`select payment_status, count(*) from public.orders group by 1` ⇒ 只回 `unpaid` 6 / `paid` 4 / `refunded` 3,**該兩態未出現**)
  ⇒ 分流行為只讀 code 推得、**不宣稱實地驗過**;13/4/3 三數字由主視窗提供、**V 窗未複驗**(worktree 無 `.env.local`)。
- **分流:** `P1`
- **優先級:** 🔴 高(不會壞資料,但**畫面對同一張單講兩句相反的話**,而且指路指錯)
- **🔴 起因 = Sean 肉眼撞到,不是掃出來的:** 他點所有「未收未定」的單要取消,一律跳
  「已付款的單這期還不能在這裡取消 / 現在請走人工退款流程」。
- **實測(正式庫,主視窗當場查):** 全庫 13 張。**顯示「未收未定」且尚未取消的共 4 張,其中 3 張真實狀態是 `refunded`**
  (`5HGMC5` / `PCM-2026-0102` / `RCPVVJ`);只有 `2SQH2P` 是真的 `unpaid`。
  ⇒ 他點到的幾乎必然是那三張。**這不是偶發,是多數。**
- **兩份規格在同一張單上打架(各附行號):**
  | 層 | 檔案:行號 | 邏輯 | 對 `refunded` 的結果 |
  |---|---|---|---|
  | 顯示 | `apps/admin/src/lib/orders/order-status-axes.ts:145` | `paymentStatus === 'paid' ? 'paid' : 'unpaid'` | 印成**未收** |
  | 取消閘 | `apps/admin/src/lib/orders/cancel-view.ts:543` | `paymentStatus !== 'unpaid'` ⇒ `payment_not_unpaid` | **擋住** |
- **🔴 那行早就自己寫過了:** `order-status-axes.ts:112` 逐字「**`refunded`(已退款)會落進「未收」並吃到紅框**」
  ⇒ **這個後果被寫下來過,但沒有人把它接到取消那一側。** 病灶不是沒想到,是**想到了只記在原地**。
- **文案三處皆假**(`cancel-review-section.tsx:64-65`):①說「已付款」——它是已退款 ②叫人「走人工退款流程」——**這張單已經退過了**
  ③與同頁膠囊的「未收」互相矛盾。
- **要做什麼(B 案):**
  1. **列表標籤把已退款分出來**,不再併進「未收未定」。⚠️ 動 `ORDER_STATUS_LABEL` 的 2×4 矩陣 = 動 Sean 拍過的八值
     ⇒ **開工前先確認新值怎麼叫、放在哪一軸**,不要自己發明第九個詞。
  2. **取消閘的訊息按真實 `paymentStatus` 分流**:`refunded` / `partiallyRefunded` / `partiallyPaid` 各自的下一步不同,
     不得共用「已付款」那一句(同族於 `ledger_unhealthy` 三病共用一碼被 R1 F5 抓過的形狀)。
  3. `BLOCK_REASON_TEXT` 是 `Record<OrderCancelBlockReason, …>`(`cancel-review-section.tsx:51`)⇒ 新增碼會編譯期紅,**這是既有守門、要利用不要繞過**。
- **⚠️ 沒量的:** `partiallyPaid` / `partiallyRefunded` 在正式庫**目前零筆**(13 張只有 unpaid/paid/refunded)
  ⇒ 它們的顯示與擋法**構造不出來、只能靠讀 code 推**,交件要標成誠實缺口、不得寫「已驗」。
- **不修未來會痛在哪:** 訂單量上來以後,列表上「未收未定」會同時混著「要去催客人付錢」與「已經退完款、什麼都不用做」兩種單,
  而**它們長得一模一樣** ⇒ 員工每天要逐張點進去才知道哪張要做事。這正是 `#493` 同一個母題:**錯的那次和對的那次長得一樣。**
- **依賴:** 無前置拍板(B 已拍)。與 `#495`(隱藏已結案)是**兩件事**:本條讓它看得出來,`#495` 讓它不用一直看到。
- **發現於:** 2026-08-14 · Sean 肉眼驗取消功能時撞到 · 主視窗實查正式庫證實 · 號由 `scripts/next-backlog-number.sh` 取得(三層皆 493 ⇒ 494)

### #495. 🗂 已結案的訂單收進「隱藏」,不要一直佔在主列表

- **狀態:** ⏳ 待執行(**第一段**);第二段 ⏸ 硬等退貨線
- **分流:** `P2`
- **優先級:** 🟠 中
- **🏁 Sean 2026-08-14 傍晚逐字:** 「那取消並且退款 + 退貨(如果有出貨)的訂單,是可以放到隱藏裡面。這樣也不會太混亂。」
- **🏁 拍板 `Q-隱藏` = A,而且明說 B 之後也要做**(逐字「A 然後 B 也要做出來‥」)⇒ **本條分兩段,不是二選一**:
  - **第一段(現在做)**:隱藏條件 = 「已取消」∪「已退款」。做得到,不依賴任何未開的線。
  - **第二段(退貨線做出來之後)**:把「已退貨」也納入條件。
    🔴 **這一段不是 nice-to-have,是 Sean 明文要的** —— 退貨線開工時要回來接這條,不要當它已結案。
- **🔴 這條**目前只做得了一半** —— 實查後回報 Sean:**
  「退貨」這個狀態**在系統裡不存在**。實查字集與範圍(不是印象):
  | 掃描目標 | pattern | 命中 |
  |---|---|---|
  | `apps/admin/src` + `packages/domain/src` + `packages/adapters/src` + `supabase/migrations` | `return_status` / `'returned'` | **0** |
  | 同上 | `退貨` | 7 —— **全部是指向未來的話**,例:`20260730150000:119`「已到貨不可取消、只能走退貨」、`20260803160000:84`「根治歸**第 3 批採購退貨線**」 |
  ⇒ **沒有退貨表、沒有退貨狀態、沒有退貨 RPC。** 現在能拿來當「結案」判準的只有 `cancelled_at` 與 `payment_status='refunded'`。
- **待 Sean 定的:** 隱藏條件先用哪一組?(A=只收「已取消」/ B=收「已取消 ∪ 已退款」/ C=等退貨線做完再一起做)
- **要做什麼(條件定了之後):** 主列表預設不顯示結案單 + 一個看得見的出口(**不是把單弄不見**),
  ⚠️ 出口本身**不得只靠網址參數** —— 員工找不到的功能等於不存在(`project_admin-ux-operation-intuitiveness`)。
- **不修未來會痛在哪:** 每月 100-300 筆的量(`project_m4b-admin-preview-decisions`),結案單只會累積、永不減少
  ⇒ 半年後主列表大多數是「不用做事」的單,而真正要做事的那幾張埋在裡面。
- **依賴:** 「退貨」那半**硬依賴退貨線**(尚未開線)。`#494` 先做完,分得出「已退款」才篩得動。
- **發現於:** 2026-08-14 · Sean 在 `#494` 的討論裡順帶提出 · 主視窗實查「退貨不存在」並回報 · 號由 `scripts/next-backlog-number.sh` 取得

### #496. 🎬 後台動畫與視覺特效(**刻意排在最後**)

- **狀態:** ⏸ 已立案、**刻意不排程**(Sean 2026-08-14 傍晚拍 `Q-動畫` = B,並自己加了「可以放到最後再做沒關係」)
- **分流:** `P3`
- **優先級:** 🔵 低(但**不是不重要** —— 見下方 Sean 的理由)
- **🏁 Sean 逐字:** 「動畫跟特效與 OD 設計的欄位與顯示方式會**大大優化看後台訂單容易度**,這一點在**訂單量體大的時候,視覺勞累程度差很多**。」
  ⇒ 🔴 **這條的驗收標準是「久看不累」,不是「好看」** —— 寫規格與審查時不得把它當裝飾片處理。
- **🔴 立案前實查(零命中要附字集):** 字集 = `動畫` / `特效` / `transition` / `animation` / `hover` / `過場`,
  掃 `docs/phase-1-backlog.md` + `docs/specs/` ⇒ **與後台相關者零命中**。
  唯一相關立案是 `#318`(`docs/phase-1-backlog.md:8931`)`prefers-reduced-motion` 未統一,**但範圍是前台**。
  `transition` 另 12 處命中皆為 `PAYMENT_TRANSITIONS` / `FULFILLMENT_TRANSITIONS` 狀態機字面,**不是 UI 動畫**。
  ⇒ **在本條之前,後台動畫從來沒有進過任何待辦。**
- **開工前必須先有的(不是實作片,是前置):** OD 出一版**帶動畫的**後台設計稿讓 Sean 直接看
  (品味題不給文字選項 —— `docs/working-style.md`)。視覺由 Design session 產出,Claude Code 只把題目轉成需求。
- **⚠️ 開工時要一起帶進來的既有債:** `#318` 的 `prefers-reduced-motion`
  ⇒ **後台動畫不得重蹈前台覆轍**(做完才想到無障礙)。
- **不修未來會痛在哪:** 訂單量上來以後,員工一天要掃幾百列;**掃描負荷是實際成本**,不是美感偏好。
  現在不立案,它就會永遠被更急的功能擠掉 —— 而它變重要的那一天(量大時)剛好是最沒空做的那一天。
- **依賴:** 排在後台功能完整化之後。與 `#484`/`#485`/`#486`/`#491` 的 OD 殼線同源但**不同層**(那些是版面,這條是動態)。
- **發現於:** 2026-08-14 · Sean 主動提出 · 主視窗實查確認零立案 · 號由 `scripts/next-backlog-number.sh` 取得

### #497. 🔴 退款判錯之後,客人的訂單頁會永遠停在「處理中」——`payment_status` 走不到 `refunded`

- **狀態:** ⏳ 待執行(**與 `#473` 是兩件事;`473b-1` 送批時要一起講,不得寫成「未來優化」**)
- **分流:** `P1`
- **優先級:** 🔴 高(**對外可見** —— 客人看得到的字面與事實不符)

> ### 🔴 E 窗查證結論(2026-08-16;**I 窗只負責搬運**)
>
> **以下三行為 E 窗原檔逐字**(`docs/security/2026-08-16-issue-497-paste-ready.md:3-5`):
>
> > **來源**：E 窗（安全稽核）2026-08-16　**依據 commit**：`b3fe104c`（分支 `customers`，當時未推）
> > **完整論證**：`docs/security/2026-08-16-security-audit-run1-phase2-hunt.md` §6.8 / §6.9
> > **搬運者不是判斷者**：本段由 E 窗查證撰寫；貼上此單的窗只負責搬運。
>
> 📎 **I 窗註(唯一的加註,與 E 窗原文分開放)**:`b3fe104c` 當時未推,**現已隨 `856032ac` 進 `origin/dev`**。
> ⚠️ **我第一版把上面三行改寫過**(合併成一行、加了「(I 窗)」),同時卻在標題寫「一字未改寫」——
> **那句話當下是假的**;逐字比對工具抓到後已還原成原檔字面。
> 📎 形狀:**署名行看起來像格式、不像內容,所以最容易被順手重排** —— 而它正是「這是誰說的」的唯一載體。
>
> **經查不是不一致;統一它們會製造 bug。要補的是註解與值域斷言,不是統一。**
>
> `#497` 指的兩套 `SUM` 是:
>
> | | 它回答的問題 | 統計的集合 |
> |---|---|---|
> | `pcm_order_refundable_remaining` | 「**這張單還能再退多少?**」 | `processing` + `confirmed` |
> | `admin_finalize_order_refund` 步 7 | 「**這張單真的退掉了嗎?**」 | 只有 `confirmed` |
>
> **兩邊都是保守方向,而且方向不同是必要的:**
>
> - 額度**必須**算進 `processing`(在途的先佔住),否則**在途期間可以把同一筆錢再退一次**。
> - `payment_status` **必須不**算進 `processing`,否則**一筆最後失敗的退款會把單子錯標成已退清**。
>
> ⇒ **把它們統一成同一個集合,兩個方向各壞一邊:**
>
> ```
> 額度改成只算 confirmed          ⇒ 在途期間可重複退（賠錢）
> payment_status 改成含 processing ⇒ 退款失敗後單子錯標已退清（帳目錯）
> ```
>
> #### 🔴 真正該補的:同一個 fail-open 出現在**兩處**,只有一處有警告
>
> `pcm_order_refundable_remaining` 的 `COMMENT` 逐字寫著:
> 「**未來新增任何 status 值預設不佔額度 —— 新增狀態時必須回訪本函式。**」
>
> **而 `admin_finalize_order_refund` 步 7 的 `status = 'confirmed'` 是裸字面,零註解。**
>
> 新增一個退款狀態(例如 `confirmed_manual`)之後:
>
> | | 後果 | 有警告嗎 |
> |---|---|---|
> | 額度那套 | 新值不佔額度 ⇒ **可以多退** | 有,**但在函式 COMMENT 裡** |
> | 步 7 那套 | 新值不算進 `v_sum` ⇒ **單子永遠標不到 `refunded`** | **零** |
>
> **兩處都會靜默出錯,其中一處連提醒都沒有。**
>
> #### 建議的修法(機制,不是「記得回訪」)
>
> 隨每次 `db push` 跑一道斷言:**釘住 `order_refunds.status` 的值域集合,新增任何值當場紅**。
> 完整規格見 `…-phase2-hunt.md` §6.9,其中兩點是重點:
>
> 1. **值域取自 `CHECK` 約束,不是取自資料** —— 取資料的話,**表是空的就恆綠**。
> 2. 🔴 **錯誤訊息本身就是回訪清單**(標記為**不可簡化**)—— 必須逐字指名上面那兩處
>    以及各自會怎麼壞。縮成 `RAISE EXCEPTION 'unknown status'` **等於退回原病**。
>
> ⚠️ 斷言裡 `c_known` 的實際值域,**E 窗沒有逐字核對**(只讀到約束名 `order_refunds_status_check`
> 存在,以及程式碼用到的四個值)⇒ **實作者要先 `pg_get_constraintdef` 讀出真值再填。**
- **🔴 怎麼被抓到的:** R 窗做 `473b-1` plan 的**反向盤點**(從 code 列出所有回答「已退/還能退」的地方,
  **不是**從新入口找誰用它)時撞到。**從新入口回推絕對看不到這條** —— 這正是主視窗當初指定反向方向的原因。
- **機制(主視窗開檔複驗過,不是轉抄 R 的話):**
  1. `supabase/migrations/20260803150000_*.sql:772-784` —— `admin_finalize_order_refund` 步 7
     **只在 `v_after.status = 'confirmed'` 時**才重算,且**自己 `SUM(refund_amount) WHERE status='confirmed'`**,
     **不呼叫** `pcm_order_refundable_remaining`。
  2. ⇒ 一筆被**判錯成 `failed`** 的退款(錢其實有動)**永遠不會被算進去** ⇒ `v_target` 算不到 `refunded`
     ⇒ `orders.payment_status` 停在 `paid`。
  3. `apps/storefront/src/lib/orders/order-display.ts` 的對照表逐字:`'paid'` → **「處理中」**、`'refunded'` → 「已退款」。
     ⚠️ **字面更正**:R 的信寫「客人會看到『已付款』」,**實查的字面是「處理中」** —— 機制正確、字面不精確,依 `#494` 同一條紀律在此釘死。
- **對客人的實際後果:** 錢已經退回去了,他的訂單頁卻寫**「處理中」**,而且**不會再變**
  ⇒ 他會來問「我的退款呢」,而客服打開後台看到的是「已付款」。**兩邊都看不出錢已經退了。**
- **🔴 為什麼不併進 `#473`:** `#473` 的拍板範圍是「更正的顯示與佔額度判準」,Sean 明確接受了「帳上金額不變」。
  本條要動的是 **`orders.payment_status` 這個對外狀態怎麼跟上更正** —— 那是**另一個方向題**,
  改法(讓 finalize 改吃更正後的數 / 另開一支重算 / 人工出口)各有不同代價,**要 Sean 拍**。
- **不修未來會痛在哪:** 這是**唯一一條會讓客人自己發現我們算錯錢**的路徑。
  判錯本身很少見,但它一旦發生,**錯的狀態是永久的**,而且沒有任何守門會叫。
- **⚠️ 沒量的:** 正式庫目前**零筆**被判錯的退款 ⇒ 本條的場景**構造不出來、只能讀 code 推**
  (依 `feedback_blocker-must-prove-scenario-reachable-first`:機制為真 ≠ 場景已發生;
  但**可達性成立** —— `admin_finalize_order_refund` 的 `failed` 分支是真實可走的路,不是恆假)。
- **依賴:** 無前置。但**排在 `473b-1` apply 之後**比較省事(那時「更正後的數」才有地方拿)。
- **發現於:** 2026-08-14 傍晚 · R 窗反向盤點 · 主視窗開 migration 與 storefront 兩檔複驗並更正一處字面 · 號由 `scripts/next-backlog-number.sh` 取得

### #498. 🧱 兩支 RPC 對「作廢」完全看不見 —— 正確性靠乙片的 V7 守門承重

- **狀態:** ⏳ 待執行(**不是現行 bug** —— 現況走得到的路徑上不會發生;它是**潛伏依賴**,見下)
- **分流:** `P2`
- **優先級:** 🟠 中(不修不會壞,但**放寬 V7 的人不會知道自己在拆什麼**)
- **🔴 起因:** V 窗做乙片 plan 附錄 A(DB 端反向盤點)時發現;主視窗開檔複驗過,不是轉抄。
- **兩支盲的 RPC(逐條實查)**
  | RPC | 定義所在 | `grep -c voided` |
  |---|---|---|
  | `admin_cancel_order` | `supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql` | **0** |
  | `admin_delete_item_receipt` | `supabase/migrations/20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql` | **0** |
  (量法 = `for f in $(grep -rln "FUNCTION public.admin_delete_item_receipt" supabase/migrations/); do grep -c voided $f; done`)
  ⚠️ 已 apply 的甲片 `20260814100000` 檔名雖是 `adjacent_writers_voided_split`,
  但它 `CREATE OR REPLACE` 的是 `admin_upsert_item_procurement`(`:168`)與 `admin_record_item_receipt`(`:608`)兩支,
  **`admin_delete_item_receipt` 只在 `:812`/`:935` 的註解裡被提到、本體未被改** —— 檔名容易讓人以為它涵蓋了。
- **🔴 為什麼現在沒事(缺口是潛伏的,不是不存在)**
  `admin_cancel_order` 算可取消量用的是 **receipts 的 `sum(r.quantity)`**、不是 `allocated_quantity`
  (`20260805100000:379-382` 逐字,JOIN `order_item_procurement_receipts`)
  ⇒ **一筆作廢採購只要沒有到貨紀錄,那個 JOIN 就貢獻 0 ⇒ 行為零差異。**
  而「**作廢的採購不會有到貨**」正是乙片 **V7 守門**(`HAS_RECEIPTS_UNDO_FIRST`)在保證的事。
  ⇒ **V7 不只是 UX 前置,它是 `admin_cancel_order` 正確性的承重點。**
- **放寬 V7 或繞過 RPC 直接 UPDATE 標作廢會怎樣(逐字取自 V 窗,已複驗因果)**
  掛在已作廢採購上的到貨會被算進已收量 ⇒ **可取消量被低估** ⇒
  **員工取消不了本來可以取消的量,而畫面不會說為什麼。**
- **要做什麼(擇一,開工前先定):** ①兩支 RPC 各自加 `voided_at IS NULL` 述詞(治本,但動已上線的取消線 = 鐵則 12①)
  ②維持現狀 + 在兩支 RPC 檔頭寫下「本函式的正確性依賴 V7」的反向指標(便宜,但仍靠人讀)
  ③等第 3 批退貨/撤到貨線一起處理。
- **不修未來會痛在哪:** 這條依賴目前**只寫在乙片 V7 的註解裡**,而會踩到它的人是**去改那兩支 RPC 的人** ——
  他們不會經過 V7 的註解。⇒ 依賴寫在被依賴方看不到的地方 = 遲早被拆掉而沒人知道。
- **⚠️ 沒量的:** 缺口的可達性**只論證到「經由 RPC 不可達」** —— `service_role` 直接 UPDATE 不在此範圍
  (同 `docs/reference/order-state-gates.md` 的強度自陳)。正式庫目前**零筆已作廢採購**
  (量法 `select count(*) from public.order_item_procurement where voided_at is not null`,乙片尚未上線)
  ⇒ 場景至今**未發生過**,本條是機制推論、不是事故。
- **相鄰但刻意不做的一條:** `admin_search_orders:370` 的模糊搜尋**含作廢列** —— **這是刻意的**
  (`Q-S1`=A 逐字「舊的作廢紀錄留著查帳」)。**日後想「修」它的人先回來讀這行。**
- **依賴:** 乙片(`admin_void_item_procurement`)上線後這條才真的有意義 —— 在那之前沒有任何作廢列存在。
- **發現於:** 2026-08-14 傍晚 · V 窗乙片 plan 附錄 A · 主視窗開兩支 migration 複驗 `grep -c voided` 皆 0 並更正「甲片檔名涵蓋範圍」一處誤解 · 號由 `scripts/next-backlog-number.sh` 取得
### #499. 🔗 貨品軸有**三份字面/兩套判序**,而它們之間一格守門都沒有

- **狀態:** ⏳ 待執行(號已由主視窗確認)
  🔴 **本條原本掛在 `#498`,2026-08-14 撞號改為 `#499`** —— `#498` 已由 V 窗用掉(`daedc47c`)。
  病根不在發號腳本:它自己就寫了「**只存在於某封信裡的號掃不到**」,而我照規矩標了「佔位、請主視窗確認」、
  主視窗發下一個號時**沒有先掃信箱裡的佔位宣告** ⇒ **兩邊都照規矩走,號還是撞了**。
  ⇒ 這是「掃描限度」那一段從文字變成實例的第二次(第一次是 `#489`/`#491`)。
- **分流:** `P2`
- **優先級:** 🟡 中(不會壞、也不擋任何片;但它壞掉的時候**沒有任何一格會紅**)
- **問題(`#484a` 片 A2 的 code-reviewer R1 抓到,我確認屬實):**
  同一組「貨品軸」現在同時存在於三個地方,**兩兩之間都沒有守門**:
  1. **TS 常數** `ORDER_GOODS_AXIS_VALUES`(`packages/domain/src/order/types.ts:234`)
  2. **SQL CASE** `admin_order_list_v.goods_axis`(`supabase/migrations/20260814140000_…view.sql`)
  3. **JS 判定式** `orderGoodsAxis()`(`apps/admin/src/lib/orders/order-status-axes.ts`)
  - 1↔2:四值字面靠**人工比對**(2026-08-14 A2 當下手工比過、逐字一致)。SQL 改一個字,TS 不會紅。
  - 2↔3:**兩套獨立手寫的判序**(`shipped ⊆ instock ⊆ ordered`)。任一邊倒過來寫,
    **列表篩出來的單與它自己那一列的膠囊會對不起來**,而兩邊各自的測試都是綠的。
- **🔴 已知的第一個真實不一致(不是假設):** 已取消的單 —— view 照樣算得出四值之一,
  `orderStatusView()` 卻早退成「已取消」。A1 把它寫成 A2 的硬條款(下推時加 `.is('cancelled_at', null)`),
  **A2 已照做**;但那是「這一個已知差異被個別處理掉」,**不是「兩邊被綁在一起」**。
- **不修未來會痛在哪:**
  - **bug 可追蹤性(主因):** 症狀是「篩選結果與畫面膠囊不一致」——
    員工只會說「這張單怎麼跑到這裡來」,而三份實作各自看起來都對。
  - **擴充性:** 收款軸第三值(`cod`,Sean Q22=A 已預留)進來時,要改的是**三個地方**,
    而漏改一個沒有任何訊號。
- **可能的修法(未定案,擇一):** ①拿 view 的實際輸出對 TS 四值做一格整合測試(需連線,不進 CI)
  ②把判序寫成一份 SQL 函式、JS 端改吃 view 的 `goods_axis`(= 讓 2 吃掉 3,但列表要多投影一欄)
  ③至少加一格「SQL CASE 的四個字面出現在 migration 檔內」的原始碼掃描(擋字面漂移、擋不了判序倒置)。
- **估時:** 未估。
- **發現於:** 2026-08-14 · E 窗 · `#484a` 片 A2 的 code-reviewer R1(M4/M5)· 號由 `scripts/next-backlog-number.sh` 取得
- **相關:** `#484a`(本條的來源)/ `#488`(`fulfillment_status` 死欄位,**不同題**:那條問「誰該寫那個欄」,本條問「三份實作誰綁誰」)

### #500. 🔁 訂單列表「退貨中」chip —— **資料面沒有這個狀態,而且它要一個數字**

- **狀態:** ⏸ **等 Sean 決定要不要做**(不是待開工:它不是 chip 片的一部分,是一條新能力)。
  號由主視窗發(2026-08-14;發號跑了三道:`scripts/next-backlog-number.sh` + 掃信箱佔位宣告 + 掃三個 worktree 未 commit 的新條目)。
- **分流:** `P2`
- **起因:** OD `overview-desktop.html:611-614` 與 `:647-649`(兩處)畫了第四顆 chip:
  `<button class="fchip fchip-ret" data-retchip>退貨中 <b>0</b></button>`,琥珀色(`:477`)。
  `#484` 片 B-1 只做「全部 / 未到貨」兩顆,這一顆被切出來 = 本條。
- **🔴 兩個硬前提,兩個都不是前端能解的(2026-08-14 E 窗唯讀實查):**
  1. **資料面沒有「退款進行中」這個狀態。** `AdminOrderSummary` **15 個欄位**裡沒有它
     (數法 `sed -n '/export type AdminOrderSummary = {/,/^};/p' packages/domain/src/order/types.ts | grep -cE '^\s+[a-zA-Z]+'`);
     `paymentStatus` 只有 `refunded` / `partiallyRefunded`,兩個都是**退完了**,沒有「退到一半」。
     ⇒ 要嘛從 `order_refunds` 那側取狀態(= 列表投影要多一層 embed 或多一個 view 欄),
     要嘛在訂單層新增一個衍生欄。**兩條路都不是 UI 片。**
  2. **那顆 chip 要顯示 count。** OD `:1947`/`:1951` 有 JS 在餵那個數字。
     ⇒ 對我們而言是**第二次查詢**(現行列表只有一個 `count: 'exact'`,而且它是「符合當前篩選的筆數」,
     不是「退貨中的筆數」)。**不是純前端。**
- **不修未來會痛在哪:**
  - **可維護性:** 每次有人照 OD 補 chip 排,都會再撞一次這兩個前提;寫成條目才不用重查。
  - **bug 可追蹤性:** 若有人「先做出來再說」——最可能的作法是拿 `partiallyRefunded` 充當「退貨中」
    ⇒ **那顆 chip 會篩出一批已經退完的單**,而員工以為它們還在處理中。
    這與 `#485` 要防的病同型(**按了不知道篩掉什麼**),但更糟:它有一個**看起來很確定的數字**。
- **⚠️ 沒查的:** `order_refunds` 現行狀態機有哪幾態、哪幾態該算「進行中」(`processing` / `deferred` / hold?);
  count 要不要含已取消單;要不要與 `#495` 的「已結案隱藏」互斥。
- **估時:** 未估 —— 前提未定之前估不出來。
- **相關:** `#484`(片 B 的殼)/ `#485`(「待處理」定義題,同族)/
  `#495`(已結案收進隱藏 —— 母體會互相影響)/ `#497`(判錯的退款走不到 `refunded` —— **同一個資料源**,
  那條若成立,「退貨中」的判定也會跟著錯)
- **發現於:** 2026-08-14 · E 窗 · `#484` 片 B 讀 OD 真權威時

### #503. 🔴 出貨包裹的收件人可以是三個空字串 —— DB CHECK 擋不住,而下游把它當「實際寄達的收件資料」

- **狀態:** 🔴 **待開工**(不是「有空再說」:它會讓一張沒有收件人的出貨單被印出來)。
  號由主視窗發(2026-08-15);本窗另掃過 repo 與信箱確認沒撞號
  (`grep -c '#503' docs/phase-1-backlog.md` ⇒ 0;信箱命中的 `503` 都是 commit hash 不是佔位宣告)。
- **分流:** `P1`(資料完整性 + 對客可見)
- **起因:** `#10` 片2a 把 `recipient_snapshot` 接進讀取面時,先查寫入端才發現。
- **🔴 現象:`shipments.recipient_snapshot` 的三個鍵可以全是空字串,而且那是合法寫入、不是髒資料。**
  **寫入鏈四層,沒有一層擋空**(逐層實查,2026-08-15):
  1. `apps/admin/src/components/orders/shipment-launcher.tsx:135`
     —— `recipient={open.data.recipient ?? { name: null, phone: null, line: null }}`,缺資料時給三個 `null`。
  2. `apps/admin/src/components/orders/shipment-dialog.tsx:186`
     —— `recipient: { name: recipient.name ?? '', phone: recipient.phone ?? '', line: recipient.line ?? '' }`。
     🔴 **這一跳最毒:它不是漏擋,是主動把「不知道」轉成「空字串」。**
  3. `apps/admin/src/lib/shipping/shipment-actions.ts:71,100` —— 原封轉送,對 recipient **零驗證、零 trim**
     (數法 `grep -n "recipient\|trim\|zod\|parse" apps/admin/src/lib/shipping/shipment-actions.ts`
     只命中型別宣告與轉送兩行)。
  4. `supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:120-125`
     —— CHECK `shipments_recipient_snapshot_shape` 只驗「物件 + 恰三鍵 + `m3_jsonb_values_all_string`」。
     🔴 **`''` 是 string ⇒ 過關。CHECK 保證的是鍵存在,不保證值有內容。**
     ⚠️ **這句是讀函式本體確認的、不是照名字推的**(修這條的人會需要知道它到底做什麼):
     `m3_jsonb_values_all_string`(`20260604120000_m3_s2a_orders_order_items.sql:73-87`)的本體是
     「逐個 top-level value 檢查 `jsonb_typeof(v) <> 'string'` 就回 false」——
     **它管的是型別、完全不看長度**,空字串是合法的 JSON string scalar。
     ⇒ 修法②(收嚴 CHECK)**不能只換這支函式的呼叫方式**,要另外加一條非空判斷。
- **🔴 不修未來會痛在哪(鐵則 10):**
  1. **出貨單印出來沒有收件人,而員工會真的拿去寄。** `#10` 片2b 那張紙就是印這個欄位。
     (片2b 會自己判空 fail-closed,但那是**下游擋**,不是把洞補起來 —— 下一個下游還會再踩一次。)
  2. **同檔 `:181-184` 的 COLUMN COMMENT 第一句逐字寫它是「本包裹實際寄達的收件資料」**
     ⇒ 讀的人會信它有內容,而它可能是空的。
     ⚠️ **要講精確,不要把那段註解講成整個錯**:它的**最後一行**(`:184`)逐字是
     「鍵集合恰等 {name, phone, line} **且值皆 string**」—— **那句完全準確**,它從來沒宣稱非空。
     ⇒ 真正誤導的是**第一句的語意**(「實際寄達的收件資料」聽起來像一定填了)。
     修 `#503` 時把第一句改成不會被讀成保證的講法即可,**不要整段重寫**。
  3. **這是歷史資料問題,不只是新資料** —— 已經建好的箱子可能就是空的。
     ⇒ 修法不只是加驗證,還要**盤點既有列**(本窗未查正式庫,分佈未知)。
- **🔴 為什麼 `#10` 片2a/2b 不修:** 洞在**建箱動線**(dialog → action → RPC),修它要動 writer 線,
  而 `#10` 是列印線、明文只讀不寫。動 writer 線可能命中鐵則 12 ⇒ **另開一片、另提 plan**。
  這不是「之後有空再說」,是**範圍判斷**。
- **可能的修法(未評估、未拍板):** ①`shipment-actions` 加輸入驗證(最淺,但只擋新的)
  ②DB CHECK 收嚴成「三鍵皆非空白字串」(擋得徹底,但**會擋掉既有列的更新**,要先盤點)
  ③建箱 UI 在缺收件資料時直接不讓建。
  ⚠️ 三條都要先知道正式庫現有分佈,否則 ② 可能一 apply 就炸。
- **估時:** 未估 —— 要先盤點正式庫既有列。
- **相關:** `#10`(發現於此;片2b 會在顯示端 fail-closed)/ `#359`(建箱與掛品項不是原子單位 —— 同一條動線的另一個缺口)
- **發現於:** 2026-08-15 · D 窗 · `#10` 片2a 依主視窗指示「撈 jsonb 之前先查誰寫它」時

### #504. 📌 假行號 `supplier-config.ts:249` 住在 07-24 歷史交接檔 —— 照它去核會落在別家

- **狀態:** ⏸ **待修**(一行的事,但**不是我可以改的檔**:別窗 07-24 的歷史交接檔,
  「已投遞的紀錄不回改」)。號由主視窗發(2026-08-15;發號跑了兩道:
  `scripts/next-backlog-number.sh` ⇒ 下限 `#504`,加掃信箱佔位宣告 `#489`/`#498`/`#501` 全部低於 504;
  正向對照 `grep -rn "#503"` ⇒ 12 命中,證明 pattern 抓得到、那個 0 是真的 0)。
- **分流:** `P3`
- **起因:** `#20` 片1b-2 的 R3 F6。`.github/workflows/rpm-sync.yml` 的 matrix 註解引
  `supplier-config.ts:249` 說那是 `extreme` 的條目 —— **實際 `:249` 是 ebc 區**,
  `extreme` 在 `:275-286`(`:275` 逐字「Extreme Components…靜態 fixture、不接每日排程」、
  `:282` `supplierSlug: 'extreme'`)。
- **已修 / 未修:**
  - ✅ `rpm-sync.yml:72` 與 `:25` **兩處**都改成 `:275-286`(**`:25` 那處 reviewer 沒指名,
    是用 `bash scripts/literal-sweep.sh 'supplier-config.ts:249'` 掃出來的**)。
  - ❌ **`docs/handoff/2026-07-24-brand-rollout-handoff.md:14` 仍是假行號** ⇒ 本條。
- **🔴 不修未來會痛在哪(鐵則 10):**
  那份交接檔是 07-24 品牌上架線的紀錄,而 `extreme` 是**唯一不排每日同步**的供應商 ——
  也就是**每次有人要確認「哪家不跑每日同步」都會查到它**。照 `:249` 去開檔的人會落在 **ebc 區**,
  看到一個 `syncInstallResources: true` 的正常供應商,**得出「extreme 也是每日同步」的相反結論** ——
  而且**他會以為自己核過了**(開了檔、看到內容、沒有任何東西告訴他行號是錯的)。
  這正是「假的『已驗證』」的生成方式。
- **修法:** 把該行 `supplier-config.ts:249` 改成 `supplier-config.ts:275-286`,
  或加一句「(行號為 07-24 當時,現況見 `supplierSlug: 'extreme'` 錨點)」。
  **建議後者** —— 歷史檔的行號本來就會漂,釘錨點比釘行號耐用。
- **估時:** 5 分鐘。
- **相關:** `#20`(片1b-2 R3 F6 的出處)/ `scripts/literal-sweep.sh`(`#490`,掃出第二處的工具)
- **發現於:** 2026-08-15 · B 窗 · `#20` 片1b-2 折 R3 F6 時

### #506. 🔁 全頁 `textContent` 子字串斷言 —— 一種會自我複製的假覆蓋

- **狀態:** ⏸ **待盤**(既有債,不是任何單一片造成的)。號由主視窗發(2026-08-15)。
  🔴 **發號過程本身要記**:`scripts/next-backlog-number.sh` ⇒ `#505`,但 `#505` **兩小時前已給 C 窗**
  (C 尚未寫進本檔,所以腳本看不到)。主視窗加掃信箱(`grep -rn "#505" ~/pcm-mailbox/*.md` ⇒ **16 命中**)
  才發現,改發 `#506`(`#506-#515` 掃 ⇒ 0 命中;正向對照 `#505` ⇒ 16 命中,證明 pattern 有效)。
  ⇒ **腳本給的是下限不是保留鎖 —— 這句逐字寫在腳本自己的輸出裡。**
- **分流:** `P2`
- **起因:** `#20` 片1b-2 的 R3 F1 / R4 M2·M3·n6。同一形狀在**四輪審查裡出現五次**。
- **🔴 病的形狀(兩種,不是同一種的粗細):**
  1. **碰撞**:斷言宇宙(整頁 `textContent`)**恆大於**意圖宇宙(單一欄位/儲存格)
     ⇒ 頁面別處剛好含同一串字,斷言就過。例:`toContain('2')` 被日期 `2026-…` 滿足。
  2. 🔴 **量錯東西**:斷言的字面出現在**無條件渲染的靜態文案**裡 ⇒ **它宣稱要驗的行為整個壞掉也不會紅。**
     實例(本片實測):`app/products/page.test.tsx` 的 `toContain('已下架')` 被
     `app/products/page.tsx:63` 的靜態說明「這裡列出所有商品,**含已下架的**」滿足
     ⇒ 把狀態欄改成恆回「上架中」(**下架品全部被標成上架**)⇒ **整支測試 10/10 全綠。**
  ⇒ **第一種靠「能不能 scope 到欄位」這把尺找得到;第二種找不到** ——
    第二種要問的是「**這格什麼狀態會紅?**」。**兩把尺量到的是不同的病。**
- **🔴 分母:三種量法三個數字,全部列出,不挑一個填**(這正是本條要傳的方法):
  ```
  grep -rlE 'expect\(text\)|text\.includes' apps/admin/src --include='*.test.tsx' --include='*.test.ts'
    ⇒ 10 支
  grep -rlE 'container\.textContent|expect\(text\)|text\.includes' apps/admin/src --include='*.test.*'
    ⇒ 29 支
  grep -rlE 'container\.textContent|expect\(text\)|text\.includes' apps packages --include='*.test.*'
    ⇒ 54 支
  ```
  E 窗另報 **27 支**(量法未取得)。⇒ **四個數字都不是錯的,差在量法。**
  **引用前先決定你要問的是哪個範圍,再挑對應那條命令重跑。**
- **已做 / 未做:**
  - ✅ 本片 2 支(`app/products/page.test.tsx`、`app/products/[id]/page.test.tsx`)已治:
    新增 `fieldValue()`(按 `dt`/`dd`)與 `cellTexts()`(按 `thead th` 索引取 `td`,
    寫法沿用 `components/orders/orders-table.test.tsx:219`)。
  - ❌ 其餘同型檔**未盤**(數量見上,取決於量法)。
- **🔴 不修未來會痛在哪(鐵則 10):**
  **下一個人看到那批檔裡的全頁子字串斷言,會以為那是這個 repo 的慣例而照抄** ——
  而每一次照抄都產生一個「**看起來有守、實際量錯東西**」的格子。
  **這種債會自我複製**,而且複製出來的東西**在 CI 上是綠的**、在 code review 裡**看起來像有測試覆蓋**。
  最貴的情況是它落在承重牆上:本片那格守的正是「這一頁存在的理由(分辨哪些商品下架了)」。
- **修法:** 逐檔問兩個問題 —— ①這格的意圖宇宙是不是單一欄位?②**這格什麼狀態會紅?**
  ②答不出來就是恆綠格。**不要只問①**(本片就是只問①,結果第二種病全數漏掉)。
- **估時:** 未估(取決於選哪個分母)。
- **相關:** `#20`(出處)/ `#490` `scripts/literal-sweep.sh`(同族的「宣稱 vs 量過」工具)
- **發現於:** 2026-08-15 · B 窗 · `#20` 片1b-2 的 R3/R4

### #501. 🔍 客人基本資料改了誰、改成什麼,**沒有任何紀錄**;而且「改到誰」只靠一個隱藏欄

- **狀態:** ⏳ 待開工(不是決策題:要做什麼已經確定,只是不在 `#25` 片 C1 的範圍內)。
  號由主視窗發(2026-08-15;跑了兩道:`scripts/next-backlog-number.sh` ⇒ `#501`,`#500` 已被 E 線佔用;
  `grep -rn '佔位' ~/pcm-mailbox/*.md` 與 `grep -rnE '#(49[5-9]|50[0-9])'` 全掃 ⇒ `#501` 零命中、無人佔位)。
- **分流:** `P2`
- **起因:** `#25` 片 C1(`b69904b1`)讓員工能在後台改客人的**姓名 / 電話 / 生日**。
  同一張卡上的**會員等級**與**儲值金**走 owner RPC、**在同一筆交易裡寫 `admin_audit_log`**;
  基本資料這條走 adapter(`getAdminCustomerRepository().update()`)⇒ **那條路上沒有稽核**。
  片 C1 的 plan 8 檔與 9 條驗收都沒有這一項,依「不自行擴張」切出來 = 本條。

- **要做的兩件事(可同片,分兩點寫是因為它們的性質不同):**
  1. **補寫稽核**:app 層 `getAdminAuditLogRepository().record(...)`,先例逐字在
     `apps/admin/src/lib/staff/staff-actions.ts:61`。⚠️ **非交易性** —— 寫入成功但稽核失敗是可能的,
     要決定失敗時是吞掉還是讓整個動作紅(tier / 儲值金那條走 RPC 所以不用面對這題)。
  2. **「改到誰」加一道確認**:目前決定改哪個客人的,是表單裡的隱藏欄 `customer_id`,
     防線**只有 UUID 形狀驗**(`profile-form.ts:42`)。admin 注 service_role = **BYPASSRLS**
     ⇒ storefront 那條「RLS 守自己那列」的防線在這條路徑**不存在**(逐字寫在 `profile-actions.ts:19-22`)。
     ⚠️ **這不是提權** —— 員工本來就能編輯任何客人;風險是**打錯客人**,而現在**零確認步驟**。
     🔴 這條殘餘風險主視窗**明文不替 Sean 接受**、也**不自己加保險**,原樣掛在這裡等 Sean 看見。

- **不修未來會痛在哪:**
  - **可追蹤性(這條最痛):** 客人打電話說「我的電話被改錯了」,現在**查不出是誰改的、什麼時候改的、原本是什麼**。
    tier 與儲值金查得到,基本資料查不到 ⇒ **同一張卡上,一半有帳一半沒帳**,而看的人不會知道分界在哪。
  - **可維護性:** 之後每一片碰客人欄位的(C3 地址 / C4 愛車)都會再撞一次「這條路沒稽核」,
    每次都要重新查一遍「為什麼 tier 有我沒有」。寫成條目才不用重查。
  - **擴充性:** 第 2 點若一直不做,等到有一天真的打錯客人,補救要面對的是「**沒有紀錄可以回溯**」——
    也就是第 1 點沒做會讓第 2 點的傷害不可還原。兩點互相加乘,不是各自獨立。

- **⚠️ 沒查的:** `admin_audit_log` 的 `action` 命名慣例(現有值有哪些、基本資料該叫什麼);
  要不要記 before/after 值(記了就是**把客人 PII 複製進另一張表**,那是新的一題,不是順手做);
  稽核寫入失敗時的分流(見上面第 1 點)。
- **估時:** 未估 —— 上面兩個未查項會改變片的形狀。
- **相關:** `#25`(母題:改客人資料)/ 片 C1 已完工的部分在 `b69904b1` + `9f1c4b59`
- **發現於:** 2026-08-14 深夜 · C 窗片 C1 的 code-reviewer 對抗審查 · 逐字警告「只寫『另立案』= 會蒸發」

### #508. 🔀 稽核紀錄同一時刻的兩筆,翻頁時可能重複或消失 —— 而畫面不會有任何異常

- **狀態:** ⏳ 待開工(不是決策題)。**硬前置 = `20260815020000` 已 apply**(否則這條路跑起來是 `42501`)。
  號由主視窗發(2026-08-15)。🔴 **發號跑了兩條,而腳本這次是錯的**:
  `scripts/next-backlog-number.sh` ⇒ `#507`,**但 `#507` 兩小時前已配給 A 窗、只是還沒寫進本檔**
  (`grep -rn '#507' ~/pcm-mailbox/*.md` ⇒ 20 命中);`#508`–`#515` 信箱掃 ⇒ **0 命中**,
  正向對照 `#507` ⇒ 20 命中(pattern 有效、那個 0 是真的 0)。
  ⚠️ **腳本看不到「已配號但還沒寫進檔案」的號** —— 這句話印在它自己的輸出裡。
- **分流:** `P2`
- **起因:** `#27` D1a-2 的讀取投影排序是 `created_at DESC` 再加 `id DESC` 次鍵
  (`apps/admin/src/lib/orders/order-repository.ts` 的 `getAdminAuditLogReader`)。
  **次鍵是刻意加的**(形狀同 `SupabaseOrderAdapter` 那條「次鍵防同秒單分頁跨頁重複/漏單」),
  **但它零測試覆蓋**(E 窗 2026-08-15 R1 F3)。
- **🔴 為什麼現在補不了(這是真的多一階,不是十幾行):**
  - **投影那半邊有守門了** —— R1 F1 刪掉那個多餘的 `as` 之後,少一欄就 `TS2322`(已實測)。
  - **次鍵那半邊型別看不到** —— `.order()` 的參數對不對、有沒有第二個 `.order()`,**型別層完全無感**;
    要驗它得**接真 PostgREST + 造出 `created_at` 相同的多筆**,那是整合測試。
- **🔴 不修未來會痛在哪:**
  - **bug 可追蹤性(這條最痛)**:`created_at` 相同的兩筆稽核紀錄,排序在 PostgREST 端不穩定
    ⇒ **員工翻頁時同一筆可能出現兩次、或消失一次,而畫面不會有任何異常** ——
    沒有錯誤、沒有空白、沒有任何訊號。**要靠人記得「我剛剛好像看過這筆」才會發現。**
  - **可維護性**:日後有人「順手清理」把第二個 `.order()` 拿掉,**沒有任何守門會叫**。
- **⚠️ 沒查的:** 同一毫秒寫入多筆稽核在真實使用下多常見(**與訂單量相關,而 Sean 說每月 100-300 筆**);
  PostgREST 在 `created_at` 完全相同時的實際回傳順序是否真的不穩定(**未量,repo 內是從既有 adapter 的形狀推的**)。
- **估時:** 未估 —— 要先有一座接 `20260815020000` schema 的整合測試環境。
- **相關:** `#27`(母題)/ `#505`(同片的另一個已知缺口:角色繼承只被看過一次)
- **發現於:** 2026-08-15 · E 窗 D1a-2 R1 審查 F3 · 主視窗裁「登記為已知缺口,不要當成已守」

### #511. 🤫 員工名單讀不到時,操作紀錄的「操作人」靜靜退化成內部代號 —— 畫面完全正常

- **狀態:** ⏳ 待開工(不是決策題)。號由主視窗發(2026-08-15)。
  **我方複驗過再落筆**:本檔 `### #511.` 條目 ⇒ 0;`grep -rl '#511' ~/pcm-mailbox/*.md` ⇒ **0 封**,
  正向對照 `#508` ⇒ **7 封**(pattern 有效、那個 0 是真的 0);本檔條目最大號 = `#508`
  (`#515` 只出現在別條的**掃描範圍字串**裡,不是條目)。
  ⚠️ **我看不到的**:別窗「已配號但還沒 commit 進本檔」的號。
  ~~(`#510` 據主視窗已配給商品線,本檔查無)~~ **← 已作廢 2026-08-15**:`#510` 現已落在**本檔的 `### #510.` 條目**
  (**不寫行號 —— 行號會漂**)。**觸發**:B 窗更新 `#510` 時跑全樹掃描撞到這句。
  **原句留痕不刪**:它記錄了「當時查無」是真的,不是誤判 —— 那時 `#510` 確實還沒 commit 進來。
- **分流:** `P2`
- **起因:** `apps/admin/src/lib/staff.ts:31-34` 逐字 `catch → console.error → return []`。
  `#27` D1c-2a 的操作紀錄頁用 `listActiveStaff()` 把 `actor` slug 轉成中文姓名
  (`lib/audit/audit-list-view.ts` 的 `formatAuditActor`),而該函式**查不到人就原樣回 slug**
  —— 那是**刻意的**(稽核是歷史紀錄,當時那個人可能已離職 ⇒ 查不到是預期,不是異常)。
  🔴 **兩個各自合理的設計疊起來變成一個沉默失效**:名單整批讀不到 ⇒ `[]` ⇒ **每一列都查不到**
  ⇒ **整頁的操作人全部顯示成 `sean` / `amy` 這種內部代號,而畫面沒有任何異常。**
- **🔴 為什麼難發現:**
  - **沒有錯誤、沒有空白、沒有任何訊號** —— 頁面正常渲染,表格有資料,只是那一欄變成代號。
  - **「查不到單一個人」與「整份名單讀不到」在畫面上長得一模一樣** ——
    前者是預期行為(離職員工),後者是故障。**畫面分不出來,看的人也分不出來。**
  - 本片(D1c-2a)守住的是**另一條**:`AuditLogReader` 讀取失敗會 throw、頁面顯示「載入失敗」。
    **同一頁上,兩條失敗路徑一條會喊、一條不會。**
- **🔴 不修未來會痛在哪:**
  - **可追蹤性(這條最痛)**:操作紀錄的核心價值是回答「**誰**做的」。
    退化之後那一欄仍然「有值」,只是值變成內部代號 ⇒ **看的人會以為那就是答案**,
    不會知道自己看到的是降級後的畫面。**錯誤的信心比空白更貴。**
  - **可維護性**:日後有人依「操作人欄一定是中文姓名」做下游處理(匯出、篩選、統計),
    在名單故障時會拿到混著代號的資料,而**上游不會有任何紀錄說明那天發生過什麼**。
- **⚠️ 沒查的:** `listStaffRows()` 實際失敗頻率(**未量**);
  是否該改成讓頁面知道「名單這次沒讀到」(例如回 `null` 與 `[]` 分流),
  **那會動到 `staff.ts` 的既有呼叫端** —— 呼叫端有幾個、各自怎麼處理,**未盤點**。
- **估時:** 未估 —— 修法選擇未定(頁面層標註 vs `staff.ts` 改回傳形狀),而後者要先盤呼叫端。
- **相關:** `#27`(母題)/ `#508`(同片的另一個已知缺口)/ 同一形狀的家族:**「失敗被兜成一個看起來正常的值」**
- **發現於:** 2026-08-15 · C 窗 D1c-2a 自報誠實邊界 · 主視窗裁「登記不處理,不在本片修」
### #502. 🔴 `admin_today_payment_total` 的錢口徑 —— **DB 端行為零可執行驗證(apply 後必做)**

- **狀態:** 🔴 **apply 後必做,不是「有空再說」**。前置 = Sean apply `20260815010000`。
  號由主視窗發(2026-08-15;跑了兩道:`scripts/next-backlog-number.sh` + 掃信箱佔位宣告,
  A 窗自行複驗 `docs/phase-1-backlog.md` 與 `~/pcm-mailbox/*.md` 皆零命中,正向對照 `#49x` 命中 22 檔)。
- **分流:** `P1`(它守的是「今天收了多少錢」這個數字本身)
- **起因:** `#16` MF-A 把「已收 = SUM(amount)」的加總從 TS 搬進 SQL(新 RPC
  `public.admin_today_payment_total`,migration `20260815010000`)。
  搬完之後 `apps/admin/src/lib/dashboard/today-view.ts` 的 `sumReceived` 成為死碼被刪,
  **連同它的 6 格測試**:鏈式沖銷(`+500/-500/+500 ⇒ 500`)/ 濾負列會變 1000 的負向對照 /
  改用筆數會變 3 的負向對照 / 全額沖銷回 0 / 零筆回 0 / **MF5 跨日沖銷的可執行版本**。
- **現存守門只有源碼契約測試**(`today-read.test.ts` 末段):`readFileSync` 讀 migration 檔,
  斷言 SQL **含** `COALESCE(SUM(p.amount), 0)`、**不含** `ABS(`、不含 `amount > 0`、
  不含 `reverses_payment_id IS NULL`、半開區間不得用 `<=`,外加授權四件套與一格正向對照。
  🔴 **它只證那句 SQL 還在檔裡,不證 DB 真的那樣算。** 兩者不等價,不得互相充當。
- **apply 之後必跑的四條(對正式庫實跑,不是讀檔):**
  1. `select has_table_privilege('service_role','public.order_payments','SELECT');` ⇒ 應為 **false**。
     🔴 這條最重要 —— **MF-A 那個結論至今唯一沒被實跑證明過的一環**(現有依據是五份 migration
     字面互相支持 + apply-time 閘,不是「DB 這樣答」)。跑掉它,那個誠實缺口就真的補起來了。
  2. 以 `+500 / -500 / +500` 同日測資呼叫 RPC ⇒ 應得 **500**(證沖銷照加、沒被濾掉)。
  3. 零筆區間呼叫 ⇒ 應得 **0 不是 NULL**(證 `COALESCE` 真的生效;零筆是每天早上的常態)。
  4. 查 `pg_proc` 核 `prosecdef` / `proconfig` / `provolatile` 三欄
     (證 SECDEF / `search_path=""` / `STABLE` 三件事在 DB 上為真,不只在檔裡)。
- **不修未來會痛在哪:**
  - **bug 可追蹤性:** 這格壞掉的形狀是**安靜的** —— SECDEF fail-open 會讓查詢回空,
    而 `COALESCE` 把它變成 `0` ⇒ 畫面顯示「今日實收 NT$ 0」,**看起來就是一個還沒收到錢的早上**,
    零錯誤、零紅。沒有 DB 端驗證就沒有任何東西會告訴你它壞了。
  - **可維護性:** 日後有人改那支 RPC(加篩選、改成 `ABS`、改用 `count`),
    源碼契約測試只擋得住**字面**;真正的行為回歸沒有人守。
- **⚠️ 沒查的:** 本條全程零正式庫查詢(施工端無 DB 連線);RPC 從未被實際呼叫過一次;
  `42501` 沒有實際看過。
- **✅ 已有可執行版本:** `docs/runbooks/2026-08-15-16-payment-total-apply-checks.md`
  —— 上面那四條(加另外四道)已寫成**可直接貼進 SQL Editor 的唯讀查詢**,每條附「預期值」與
  「不是預期值代表什麼」,並分成 **apply 前 4 道 / apply 後 5 道**(共 9 道)。
  🔴 第 1 道(`has_table_privilege` 應為 `false`)排在 **apply 前** —— 它驗的是「這片存在的理由還成立」,
  **那道不過就不該 apply**。
  ⚠️ 該 runbook **全部未在正式庫執行過**,它是清單不是紀錄;**跑完才算本條目關閉**。
- **相關:** `#16`(母片)/ plan `docs/specs/2026-08-15-e10-16-payment-total-rpc-plan.md` §7 誠實缺口
- **發現於:** 2026-08-15 · A 窗 · `#16` MF-A 實作時自陳(不是別人指出的)

### #509. 🔴 `admin_today_payment_total` 的守門釘的是**函式的形狀**,不是**函式做的事**

- **來源:** 2026-08-15 codex 關卡2(`#16` migration,判定 `PASS` 零 must-fix)的兩個 nit。
  🔴 **兩個都刻意不折進 `20260815010000`**,理由不是規矩:**那支已經 apply 了,而閘只在
  `db push` 那一刻跑一次** ⇒ 現在往檔裡加第六道閘,**它永遠不會再跑** = 恆綠格,
  **比不加更糟,因為它產生「已修復」的外觀**(同族 memory `feedback_absence-read-as-verified`)。
  ⇒ 主視窗裁「開號另排」,本條目即該號。

- **A · `prosrc` 沒有任何守門(codex nit 2,兩個 nit 裡較重的一個)**
  檔尾五道閘驗的是 `prosecdef` / `proconfig` / `provolatile` / `lanname` / owner 與 FORCE RLS,
  **全部是函式的「屬性」**。⇒ **有人把 body 改成 `SELECT 0,0`,五道閘全部照過。**
  而那個壞法的症狀是**安靜的**:畫面顯示「今日實收 NT$ 0」= 一個看起來完全正常的、
  還沒收到錢的早上。零錯誤、零紅。
  - **兩個面要分開做,不要以為做了一個就好:**
    1. **repo 字面面(便宜、每次 `vitest` 都跑)**:`today-read.test.ts` 已有一格
       `readFileSync` 源碼契約測試釘 `COALESCE`(plan §6 第 10 條)⇒ **同手法擴充**,
       釘 `SUM(p.amount)` / `received_at >= p_from` / `received_at < p_to` 三個關鍵字面。
    2. **DB 實體面(要新 migration)**:對 `pg_proc.prosrc` 做 apply-time 斷言。
       🔴 **這一面才守得住「DB 上那支被人改了」** —— 第 1 面只證 repo 裡的檔沒被改。
  - ⚠️ **只做第 1 面就宣稱守住了,正是 memory `feedback_guards-pin-repo-text-not-real-world-fact`
    那條**:守門釘的是 repo 的**字面**,不是真實世界的**事實**。

- **B · 有效權限閘只列三個角色(codex nit 1)**
  閘 ③b 逐字枚舉 `anon` / `authenticated` / `authenticator`。
  ⇒ 未來若新增一個能 `SET ROLE` 到 `service_role`、或達得到 owner 的 login role,**這道閘攔不到**。
  - **修法** = 改成**閉世界枚舉**:掃 `pg_roles` 裡所有 `rolcanlogin` 的角色,而不是寫死三個。
  - ⚠️ **嚴重度我判得比字面低,理由寫出來讓人可以反駁**:那三個是 Supabase 平台的**固定內建角色**,
    而「新增一個能 `SET ROLE` 到 `service_role` 的 login role」**本身就命中鐵則 12②**、會走自己的審查。
    🔴 **但這是「另一道流程會擋」的論證,不是「這道閘沒漏」** —— 兩者不等價,別合併成一句。

- **不修未來會痛在哪:**
  - **bug 可追蹤性:** A 的壞法**沒有任何訊號** —— 金額安靜地變成 0 或變小,
    而每一道現有守門都是綠的。**發現它的方式只剩「員工覺得數字怪怪的」。**
  - **可維護性:** 現在「這支函式該算什麼」的唯一權威是 migration 檔頭的散文 + COMMENT;
    **沒有任何可執行的東西**在講它。下一個改它的人不會知道自己踩到什麼。
  - **擴充性:** 退款那格重做時(Sean 2026-08-15 拍板走「正確版」)會長出**第二支同構的 RPC**
    ⇒ **A 的修法要能同時套用兩支**,不要寫成只釘 `admin_today_payment_total` 的一次性斷言。

- **⚠️ 沒查的:** 本條全程零正式庫查詢。**「有人改 body 五道閘照過」是我讀閘的定義推的,
  沒有實際構造一次去看**(要構造就得再 apply 一次)。方向有把握,**但它是推的。**
- **相關:** `#16`(母片)/ `#502`(同一支 RPC 的 DB 端行為驗證清單,兩條互補不重疊)/
  plan `docs/specs/2026-08-15-e10-16-payment-total-rpc-plan.md` §0 /
  codex 關卡2 判定 `PASS`、兩 nit 原文轉錄在 `~/pcm-mailbox/A-048-STOP.md`
- **發現於:** 2026-08-15 · codex 關卡2 · 由 A 窗評估後判「不折進已 apply 的檔」、主視窗裁「另排號」

---

### #512. 🧪 滿載時會自己消失的紅(**已知兩個成員,不只 `order-panel-wiring.test.ts`**)

🔴 **2026-08-15 12:2x 擴充範圍(主視窗補;原標題只點名一支,而它不是唯一成員)**:
- **成員 1** `apps/admin/src/app/@panel/order-panel-wiring.test.ts` —— 5050ms(整 5 秒,像 timeout)。
  **三次獨立觀察**(訂單線 2 次、列印線 1 次),單獨重跑皆全過。
- **成員 2** `cancel-forms-browser.test.tsx` —— `net::ERR_EMPTY_RESPONSE at localhost:54546`。
  客人線 2026-08-15 於併 dev 後全測撞到;**單獨重跑 7 passed;在它的 diff 裡命中 0(正向對照 audit ⇒ 5)** ⇒ 與它的改動無關。
- ⚠️ **兩個成員的表面症狀不同**(一個逾時、一個連線空回應)⇒ **是不是同一個根因,沒有人查過。**
  **現在把它們放同一條,是因為「滿載才現形、單獨重跑就消失」這個行為相同,不是因為證明了同源。**

🔴 **回報者自己的觀察,逐字留著(它比症狀本身值錢)**:
> **`#512` 自己就寫了「一個會自己消失的紅,會訓練所有人養成『紅了先重跑』的反射」——**
> **我剛剛就是這樣做的。我重跑、它綠了,但我沒有能力區分「滿載偶發」與「只在滿載才現形的真 bug」。**

⇒ **這條的危險不在那兩支測試,在它正在改變所有人面對紅色的預設反應。**

- **狀態:** ⏳ 待執行
- **症狀(現場觀測,2026-08-15):**
  - 跑 `pnpm exec vitest run apps/admin`(整套 134 檔)時,
    `apps/admin/src/app/@panel/order-panel-wiring.test.ts` 的
    「`#350c` 守門 4:槽頁只在 panel 是合法 UUID 時才開 > 沒帶 panel → null」**紅**,
    耗時 **5050ms** —— **整整 5 秒,像逾時不像斷言錯**(失敗輸出沒有 Expected/Received)。
  - **單獨重跑那一支** ⇒ `48 passed`。
  - **整套重跑一次** ⇒ `134 passed / 2720 passed`,**沒有復現**。
- **🔴 為什麼難處理(這條的重點,不是症狀本身):**
  **它是間歇的,而且重跑會過。**
  ⇒ 下一個人看到它紅,第一反應會是「重跑一下」——**然後它就消失了,看起來像沒事發生過。**
- **🔴 不修未來會痛在哪(鐵則 10):**
  **一個會自己消失的紅,會訓練所有人養成「紅了先重跑」的反射。**
  **而那個反射會吃掉真的紅** —— 下一次某格是真的壞了、剛好也在滿載時紅,
  同一個反射會把它一併重跑掉,而它第二次可能剛好過。
  ⇒ 代價不是這一格,是**整個三綠的可信度被稀釋**。
- **已經排除的(不用重查):**
  - **不是本次改動造成的**:發現當下 `git status --porcelain -uall | grep -c panel` = **0**,
    該輪只有 `app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx` 的內容變動,
    其餘三支與凍結 baseline 逐字元相同(`shasum -a 256` 對過)。
- **🔴 沒有被證明的(不要當成已知):**
  - **沒有復現條件** —— 只觀測到一次。**「重跑會過」不等於「它以後不會再紅」。**
  - **沒查根因** —— 5 秒整像預設 timeout,但**我沒去讀該檔的 timeout 設定、也沒量它平常耗時**。
    ⇒ 「逾時」目前是**推論**,不是量出來的。
- **可能的修法(未評估、未拍板):**
  ① 量它在整套與單跑下的耗時分佈,先確認是不是真的貼著 timeout 線
  ② 若是,找出那 5 秒花在哪(該格 mock 了什麼、有沒有真的等 promise)
  ③ **不要用「調高 timeout」當第一選擇** —— 那會讓症狀消失而病還在,
     且動測試期望值本身是 R4 換路訊號(`~/.claude/rules/00-work-rules.md` §2)。
- **估時:** 未估 —— 要先能復現。
- **相關:** `#10` 片2b-1(發現於此;非該片造成)
- **發現於:** 2026-08-15 · D 窗 · `#10` 片2b-1 折完 must-fix 後重跑三綠時

---

### #510. 🔴🔴 **後台現在沒有任何方法可以把商品下架**(誰都不能,不只是同步不做了)

> **🔴 標題 2026-08-15 改過。原標題:「空窗期:同步不再下架,而員工手動下架的入口還沒做」。**
> **為什麼改**:原標題讓人以為修法是「**把同步的下架邏輯接回來**」——**方向是反的**。
> 正確修法是「**做一個下架入口**」。同步不下架是 Sean 要的結果,不是要修的病。
> **觸發**:做 `#20` 欄位歸屬盤點時撞到欄位級證據(見下)。**原句留痕,不刪。**

- **狀態:** 🔴 未處理 —— **這是 Sean 2026-08-15 明示接受的代價,不是疏漏**
- **背景:** `#20` 片2b 起,同步管線**完全不寫 `delisted_at`**(推翻合約 §10;拍板 `Q-B-2=甲` / `Q-關哪一條=乙`)。
  員工手動上下架的**寫入入口在後續片**(`Q3=乙`)。
- 🔴 **欄位級證據(2026-08-15 盤點補上,原本只有推論)**:
  - **`delisted_at` 零寫入端** —— 全樹 pattern 命中 2 筆,**逐筆開檔皆為型別宣告與註解,零筆是寫入**
    (量法與逐筆判讀見 `docs/specs/2026-08-15-product-field-ownership.md` §0/§1)。
  - **`listing_set_by` 亦零寫入** ⇒ 後台「手動」chip **恆為 0 筆**,全表恆為 DB DEFAULT `'sync'`。
  ⇒ **不是「同步不下架了」,是「連改都沒有人能改」。** 原本那句比事實弱。
- ⏱️ **時態(不要讀成現在正在燒)**:**現在沒有人能改,也沒有人在改** ——
  後台唯讀,員工碰不到這兩欄。**痛在「有商品真的該下架」的那一天**,而那天沒有人擋得住。
- **不修未來會痛在哪:** 客人下單買到我們拿不到的東西 ⇒ 要道歉、退款、且**我們不會主動發現**。
- **⚠️ 緩解現況(2026-08-15 更正,原句過度樂觀)**:
  片2c 的「原廠已無此品」標記從第一天就有真資料(`source_missing_at` 由 `rpm-reconcile` 維護)
  ⇒ **員工看得到 —— 但看到之後沒有任何按鈕可以按。**
  🔴 **原句寫「可以人工處理」是錯的**:人工處理的入口正是本條在等的東西。
  **Sean 接受的「看得見且可補救」目前只兌現了前半。**
- ✅ **落點已定(Sean 2026-08-15 `Q-下架=乙`,逐字「一次完整做好,不要做一半」)**:
  **下架功能排進「商品編輯線」,不單獨開一片。** ⇒ 本條的關閉時間 = 商品編輯線的排程,不是另一條獨立排程。
- **關閉條件:** 員工手動上下架的後台入口上線。**在那之前這條不得標為已解決。**
- **相關:** `docs/specs/2026-08-15-products-manual-listing-override-plan.md` §7-2 / §5 `Q3=乙`
- **發現於:** 2026-08-15 · B 窗 · `#20` 片2 plan v3 撰寫時(codex 關卡1 R1 折 finding 過程中具體化)

### #525. 🧭 後台客戶頁沒有搜尋 —— 零訂單的客人只能用眼睛翻

- **狀態:** 🟡 **程式已完成、【等 apply】**(2026-08-16)——
  RPC migration `20260816010000_m4b_525_admin_search_customers.sql` **尚未 apply 正式庫**
  ⇒ **正式站按下搜尋會 `PGRST202`(找不到函式)**。
  🔴 **「已完成」指的是 repo,不是線上** —— apply 是 Sean 的獨立停點,不是收尾步驟。
  已驗:本機拋棄式 PG 叢集 36/36、全套 8159 測試綠、typecheck/lint/build 20/20 全跑。
- **一句話:** 後台客戶頁沒有任何搜尋(唯一篩選是會員等級)。有訂單的客人可從訂單搜尋繞道找到並點進客戶頁;
  **零訂單的客人只能用眼睛翻列表**,一頁 20 筆、依註冊日期新到舊排。
- ⚠️ **下面「現況」整段描述的是【2026-08-16 開工前】,不是今天** ——
  保留不刪(它記錄的是當初為什麼要做),但**不得當成現在的事實**:
  搜尋元件已存在(`components/customers/customer-keyword-search.tsx`)、
  `AdminCustomerFilter` 已有 `keyword` 欄、RPC migration 已寫好但**未 apply**。
  🔴 **要改的是它的狀態,不是它的存在。**
- **現況(座標皆開檔驗過;⚠️ 時間點 = 開工前):**
  - 篩選只有一個:`AdminCustomerFilter`(`packages/domain/src/identity/types.ts:42-44`)= `{ tier? }`;
    UI 唯一控件 = 會員等級下拉(`apps/admin/src/components/customers/customer-filter-bar.tsx:16-17`)
  - **零搜尋元件**:`ls apps/admin/src/components/customers/ | grep -i search` ⇒ 空
    (**正向對照**:訂單側有 `components/orders/order-keyword-search.tsx` ⇒ 這種東西搜得到,客戶側是真的沒有)
  - 分頁 `CUSTOMERS_PAGE_SIZE = 20`(`apps/admin/src/lib/customers/customer-list-view.ts:10`);
    排序 `.order('created_at', { ascending: false })`(`packages/adapters/src/supabase/SupabaseCustomerAdapter.ts:133`)
- **繞道存在,但有一個尖角:**
  - 訂單搜尋是 **12 維度、含會員姓名與會員電話**
    (`supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql` 的 `COMMENT` 逐字;
    述詞本體 `:283-284` 姓名〔子字串 LIKE **OR 詞相似度模糊**〕/ `:292-293` 電話〔去非數字後子字串,不套模糊〕)
  - 搜到訂單後走得到客戶頁:`apps/admin/src/components/orders/order-detail.tsx:303` 逐字
    「面板版 = `?panel=<單>&customer=<客>`;整頁版 = `/customers/<客>`」
  - 🔴 **尖角:** 那條 RPC 的形狀是 `SELECT o.id FROM orders o JOIN customers c ON c.user_id = o.customer_user_id`
    ⇒ 回的是 **order id** ⇒ **零訂單的客人在這條路上完全不存在 —— 不是排後面,是 `JOIN` 就掉了。**
- **⇒ 具體風險(兩個時間尺度,刻意分開寫):**
  1. **今天:** 正式庫 11 位客戶中 **零訂單 7 位(64%)、有訂單 4 位**(主視窗 2026-08-16 實查 `left join` 計數)
     ⇒ **繞道對多數客人無效。**
  2. **趨勢:** 這個比例**會隨時間下降**(老客戶陸續累積訂單)⇒ **今天的 64% 不是常態值,不得拿它當長期論據。**
     ⚠️ **兩句不可合寫** —— 合寫讀起來會像「64% 是這系統的常態」,那是**用一個會過期的數字論證一個長期缺陷**。
  - 另一條**與筆數無關**的惡化:排序**新到舊** ⇒ **越老的客人排越後面**,而老客人正是「打電話來說我以前買過」那種
    ⇒ **失效不是在某個筆數突然發生,是隨頁數線性變差,且對老客人先發作。**(100 位 = 5 頁 / 1100 位 = 55 頁)
- **不修未來會痛在哪:** 🔴 **受害者不是隨機一群,是【新註冊、客服正在接洽、還沒下單】的客人**
  —— **那正是最需要被當場找到的那群**(要確認資料、要回電、要接續對話),
  而他們**恰好就是繞道撈不到的那群**,因為繞道的入口是訂單、而他們還沒有訂單。
  ⇒ 症狀不是「慢」,是**客服在通話中找不到對方**;
  🔴 且**沒有任何錯誤訊息**(列表正常顯示、那個人只是在第 N 頁)⇒ **不會有人回報,只會累積成「後台很難用」。**
- **未查(照實登記,不得讀成「不會發生」):**
  1. 員工實際會不會使用那條繞道(要不要教、直不直覺)—— **Sean/員工側的事實,不在 repo 裡**
  2. 常見姓名會不會觸頂:訂單搜尋候選集硬上限 100(同上 `COMMENT`,超過回 `truncated=true`)
     —— **11 位客戶構造不出來 ⇒ 維持未量**
  3. 零訂單客人的成長曲線 —— 上面 64% **只有單一時點,沒有第二點可看趨勢**
  4. `/customers/[id]` 路由存在但**需知道 UUID** ⇒ 實務上等於沒有直達;是否有人用書籤補這塊,**未查**
- **相關:** 由 `#519` 那條線在盤點客戶頁 LINE 合成信箱時翻出。
  ⚠️ **與「客戶頁 Email 顯示合成位址」是同一次盤點的兩個產物、但不同題** ——
  **藏 Email 不會讓本條變好也不會變壞**(兩者都不影響「找不找得到」,因為本來就沒有搜尋)
  ⇒ **不得綁在一起做,也不得以為修了一個就緩解了另一個。**
- **依賴:** 無前置拍板。**加搜尋是另一片、要 plan**(會動 `AdminCustomerFilter` 共用型別 + adapter 查詢 ⇒ 預期中鐵則 8)。
- **發現於:** 2026-08-16 · C 窗 · `#519` 盤點客戶頁假信箱時(查「藏掉之後員工靠什麼認人」延伸出來)

### #534. 🔴🔴 沒選具名身分 ⇒ 後台**所有寫入動作靜默失效**,而畫面完全正常

- **狀態:** 🔴 未處理 —— **這是【預設狀態】,不是邊界情況**(見下方「為什麼不是『只影響某個人』」)
- **一句話:** 員工登入後若**沒有先去總覽頁選「具名身分」**,他按下的**任何**寫入動作
  (搜尋、備註、儲值金、會員等級、取消單…)都會**什麼都不做**,
  **沒有訊息、沒有錯誤、沒有 console 警告,畫面看起來完全正常**。
- **座標(皆開檔驗過,`origin/dev` 版本):**
  - `apps/admin/src/lib/session/authorize.ts` `authorizeAdminMutation()` 三道閘:
    ①`verifySession` ②`isAllowedOrigin` ③**`getSessionActor()`,缺 actor cookie ⇒ 回 `null`**
  - `apps/admin/src/lib/session/actor.ts:32-35` — actor 純粹讀 `pcm_admin_actor` cookie,
    **沒有預設值** ⇒ **沒選過 = `null`**
  - 呼叫端一律 `if ((await authorizeAdminMutation()) === null) redirect('<列表頁>')`
    —— 例:`lib/orders/keyword-search-action.ts:62`、`lib/customers/keyword-search-action.ts:57`
  - 🔴 **那個 `redirect` 不帶任何訊息碼** ⇒ `ResultBanner` 也不會亮
    (對照:同頁的 `denied` / `invalid` 出口**有**帶 `?r=…`,所以員工看得到橫幅)
- **⚠️ 2026-08-16 補一個限定:並非全站一致 —— 至少有一處已明確處理 `null`。**
  `apps/admin/src/components/orders/order-detail-route.tsx:126-129` 逐字:
  > 「取消面板要拿它比對『這筆是不是你送的』。**不是授權邊界** ——
  > 只做顯示層比對;`null`(尚未選人)時 D3 會 **fail-closed** 走 `match_other_actor`。」
  🔴 **不寫這條的話,下一個人會以為【所有】`null` actor 路徑都靜默,然後照那個前提去設計修法。**
  ✅ **而它對修法有實質影響:甲/乙/丙之外多了一個【既有先例可以抄】** ——
  那條路徑證明「`null` 時明確走一個看得見的分支」在本 repo 是做得出來的。
  ⚠️ **本條【不推翻】上面的缺陷** —— 搜尋、儲值金、會員等級那些路徑仍然是靜默的。
- **🔴 正式站實證(2026-08-16,真瀏覽器,主視窗量測):**
  ```
  搜尋前  URL /orders?date_from=2026-02-16&date_to=2026-08-16
          form 的 return_to 逐字相同
  真人填 zzqq + 真人點「搜尋」
  搜尋後  URL /orders          ← 日期參數消失 = 走了未授權出口，不是成功路徑
          chip 無 / 筆數不變 / console 錯誤 0 / 警告 0
  總覽頁逐字印著「目前身分:尚未選擇」
  ```
  ✅ 排除 CSRF 那道:`location.origin === 'https://admin.pcmmotorsports.com'` **逐字相符**。
- **🔴 為什麼不是「只影響某個人」:**
  `getSessionActor()` **沒有預設身分** ⇒ **「尚未選擇」是每一個沒選過的人的初始狀態**
  ⇒ **新員工第一天登入,按的第一個動作就靜默失效。**
  ⚠️ **而那段解釋文字住在【總覽頁】** —— 員工若直接進訂單頁,**連那段解釋都看不到**。
- **🔴 為什麼這條的優先級高於它看起來的樣子:**
  Sean 的後台北極星逐字是「**員工(非工程師)能獨立跑完一天**」
  (memory `project_admin-backend-staff-ready-goal`)。
  **這個預設狀態下,他跑不完第一件事,而且不會知道為什麼** ——
  他會以為系統壞了,或以為自己不會用。**兩種歸因都不會讓他去選身分。**
- **不修未來會痛在哪:** 員工上工第一天就會撞,而**症狀是「沒反應」** ——
  那是最難回報、也最容易被歸咎成「他不會用」的一種故障。
  等到有人查出真因,中間所有「我按了沒用」的回報都會被當成雜訊。
- **可能的修法方向(未拍板,列出來給 Sean 挑,不是建議):**
  - 甲:未選身分時,**寫入 action 導回時帶 `?r=no_actor`**,`ResultBanner` 印
    「請先在總覽頁選擇具名身分」+ 連結。**改動最小、不碰授權邏輯本身。**
  - 乙:未選身分時,**在每一頁**(不只總覽)頂端常駐一條提示。**保證看得到,但要動版面。**
  - 丙:登入後**強制先選身分**才能進其他頁。**最徹底,但改動最大、且會擋住只想看資料的人。**
- **🔴 依賴與紀律:** **碰 `auth` ⇒ 中鐵則 12②** ⇒ **要 plan、要對抗審查、要 Sean 批,不得順手修。**
  ⚠️ **本條只記錄事實與方向,【沒有】選定修法。**
- **發現於:** 2026-08-16 · C 窗(code 閱讀)+ 主視窗(正式站真瀏覽器量測)
  —— 起點是查 `#525` 搜尋線的一個 cookie 缺陷,**這條是查那件時撞出來的,不是同一件事**。
- **🔴🔴 必讀連動 `#536`(同一顆 cookie 的【另一端】,不要分開排程):**
  ```
  #534  身分【沒設】   ⇒ 所有寫入靜默失效   ⇒ 事情做不成，而他不知道為什麼
  #536  身分【清不掉】 ⇒ 寫入成功但記錯人   ⇒ 事情做成了，而【紀錄】是錯的
  ```
  **修 `#534` 的人一定會碰到 `pcm_admin_actor` 這顆 cookie** ⇒ 兩條一起看才看得出設計缺口在哪。
  🔴🔴 **而反過來更危險**:**只修 `#536`(加一個「清除身分」出口)而沒修 `#534`**
  ⇒ **員工清掉身分之後,立刻掉回「所有寫入靜默失效」而畫面完全正常。**
  ⇒ **兩條分開修,第二條會把第一條的修法【變成陷阱】** —— 我們親手做一個新的無聲故障給員工踩。
- **相關:** 同一趟還確認了一個**已上線**的獨立缺陷:
  cookie `delete()` 未帶 `Path` ⇒ 「清除搜尋」清不掉(已於 `2448a780` 修,**未 push**)。
  ⚠️ **兩者不得混為一談** —— 那條是「清不掉」,本條是「根本沒設進去」。
  🔴 **那條已於 2026-08-16 在正式站【真瀏覽器實證】,而且比原本推的嚴重一級** —— 見 `#535`。

### #535. ✅ cookie `delete()` 未帶 `Path` ⇒ 「清除搜尋」**假裝成功**(已修未 push;正式站已實證)

- **狀態:** ✅ **程式已修**(`2448a780`,客戶側 + 訂單側同時)—— 🔴 **未 push、正式站仍是壞的**
- **一句話:** cookie 用 `path: '/orders'` **設**、卻用 `delete(name)` **刪**,而後者**不帶 `Path`**
  ⇒ 瀏覽器算出的 default-path 是 `/`,與 `/orders` 不匹配 ⇒ **原 cookie 活著。**
- **🔴 真實後果比「按了沒反應」嚴重一級(正式站實測,2026-08-16 主視窗):**
  ```
  搜尋 zzqq        ⇒ chip「目前搜尋:zzqq」／共 0 筆        （正常）
  按「清除搜尋」    ⇒ 🔴 chip 消失、筆數回到共 7 筆          ← 畫面【看起來成功了】
                      ⚠️ 唯一異常訊號：搜尋框裡還留著 "zzqq"（極易被忽略）
  完全重新載入      ⇒ 🔴 chip 回來、共 0 筆、搜尋框 "zzqq"   ← cookie 從沒被刪掉
  ```
  ⇒ **員工按了清除、看到清單回到全部 ⇒ 他認為成功了 ⇒ 離開這一頁**
  ⇒ **下次回到訂單頁又被篩著,而他不知道為什麼 ⇒ 他會以為「單子不見了」。**
  🔴 **「假裝成功」比「沒反應」難察覺得多** —— **沒反應會讓人再按一次;假裝成功會讓人走開。**
- **🔴 第二層(更毒):** `invalid`(超長 / 含 NUL)也走同一個刪除出口
  ⇒ **fail-closed 其實沒有 closed** —— 舊搜尋詞繼續生效,而
  **畫面顯示的搜尋詞與實際查詢的不是同一個**(該檔註解自己逐字說那是「更糟」的形狀)。
- **根因座標:** `next/dist/compiled/@edge-runtime/cookies/index.js:302-305`
  —— `delete(...args)` 展開成 `set({ ...options, name, value: '', expires: new Date(0) })`,
  **呼叫端只傳字串時 `options` 是 `undefined` ⇒ 完全不帶 `Path`**。
- **修法(已做):** `store.delete({ name: <COOKIE>, path: <與 set 相同> })`,兩側同時。
  ⚠️ **但目前是「兩邊各自寫對字面」,【不是】repo 標準形狀** ——
  🔴 **標準是「兩端引用同一顆常數」**(正面實例 `LINE_OAUTH_COOKIE_PATH`,全文見 `#536` 修法方向節)。
  **兩邊各自寫死時,改一邊忘另一邊不會有任何東西紅。**
  ⇒ **本條目前只是「這次改對了」,收成常數形狀那一步在 `#536` 一起做。**
- **🔴🔴 為什麼它活了幾個月:** 訂單側**本來就有守門**,而它逐字寫著
  `expect(cookieDelete).toHaveBeenCalledWith(ORDER_KEYWORD_COOKIE)`
  ⇒ **它斷言的是「`delete` 被呼叫了」,不是「`delete` 會生效」** ——
  **綠了幾個月,而且任何人把它修對,這格會紅。**
  > **判別句**:**這格如果綠了,證明的是「我方送出了正確的請求」,還是「對方會照我方期望反應」?**
  ⇒ 三處已訂正,並新增 `keyword-search-action.test.ts`(客戶 7 格 / 訂單 5 格,兩側各突變驗過)。
- **🔴 證據強度(三段【分開】記,不得一起升格):**
  1. ✅ **「`set` 用 `Path=/orders`」= 實測**(playwright context cookies API,繞過 httpOnly):
     ```
     清除前  admin_order_keyword   path=/orders      ← 逐字
             __Host-pcm_sess       path=/
             __Host-pcm_admin_sess path=/
             pcm_admin_actor       path=/
     ```
  2. ✅ **「清除之後 cookie 仍在、重載後搜尋詞回來」= 實測**(正式站畫面三段觀測)。
  3. ⚠️ **「`delete` 不帶 `Path`」仍是【讀 Next 原始碼 + RFC 6265 推的】** ——
     那一行的 Set-Cookie header 沒有被直接看到。**這半不得說成已實測。**
  ⚠️ **而以上全部證的是【bug 存在】,不是【修法有效】** ——
  **修法只在本機驗過,上線後要回頭再確認一次。這兩件事在報告上長得一樣。**
  📎 附帶實測:`pcm_admin_actor` 在選身分後才出現 ⇒ **坐實 `#534` 的根因**。
- **發現於:** 2026-08-16 · codex `gpt-5.6-sol` 對抗審查(指出**客戶側**)
  → C 窗查病的邊界時發現**訂單側同病且已上線** → 主視窗正式站實證
- **相關:** 查這條時撞出 `#534`(沒選具名身分 ⇒ 所有寫入靜默失效)。**兩者是不同的病。**

### #536. 🔴🔴 具名身分**設得進去、清不掉** ⇒ 共用終端機時**稽核紀錄會記錯人**,而畫面一切正常

- **狀態:** 🔴 未處理 —— **碰 `auth` 與稽核 ⇒ 鐵則 12② ⇒ 要 plan、要對抗審查、要 Sean 批**
- **🔴 與 `#534` 是【同一顆 cookie 的兩端】,並排看才看得懂:**
  ```
  #534  身分【沒設】   ⇒ 所有寫入靜默失效   ⇒ 事情做不成，而他不知道為什麼
  #536  身分【清不掉】 ⇒ 寫入成功但記錯人   ⇒ 事情做成了，而【紀錄】是錯的
  ```
  🔴 **後者難發現一個量級**:前者當場沒反應(至少會被回報成「按了沒用」);
  **後者當場一切正常,錯誤只存在於【事後的稽核紀錄】裡** ——
  而稽核紀錄正是「**事後要用來查是誰做的**」那個東西。
  ⚠️ **兩條不要分開排程** —— 修 `#534` 的人一定會碰到這顆 cookie。
- **座標(皆開檔驗過):**
  - `apps/admin/src/lib/session/actor-actions.ts:28`
    `store.set(ACTOR_COOKIE, staff.id, { httpOnly, sameSite:'lax', secure, path:'/', maxAge: 60*60*12 })`
  - 🔴 **全樹 `ACTOR_COOKIE` 的 `delete` = 零**(`git grep ACTOR_COOKIE -- 'apps/*' | grep -i delete` ⇒ 空)
  - `apps/admin/src/app/page.tsx:75-97` picker UI **只有「選擇身分…」與「切換」**,
    🔴 **沒有「清除 / 我不是這個人」**
  - `apps/admin/src/lib/audit/context.ts:24` —— 那顆 cookie 決定 `admin_audit_log.actor` 是誰
    (逐字:「actor 未選(null)→ 拋錯(fail-closed:**不以未知身分寫稽核**,PRD §6.1)」)
- **失敗情境(具體):**
  ```
  員工 A 選「員工1」→ 做事 → 走開（沒有登出，因為沒有登出這個動作）
  員工 B 用同一台、同一個瀏覽器
  ⇒ 🔴 稽核 log 把 B 做的每一件事記成【員工1】，持續到 maxAge 12 小時後自然過期
  ```
  ⚠️ B **可以**按「切換」,**但那要他記得** —— **預設(什麼都不做)是「繼續當 A」。**
- **⚠️🔴 嚴重度取決於一件【我查不到】的現場事實:後台是不是共用終端機?**
  **維修廠後台很可能是,但那是猜的。只有 Sean 答得出來。**
  - **是共用** ⇒ 稽核歸屬日常性地錯 ⇒ **嚴重**
  - **每人一台專屬** ⇒ 大幅下降,但仍有**離職 / 換人 / 借用**的長尾
  🔴 **這一條照留,不因為「聽起來像推託」就淡化** —— **未查就是未查。**
- **⚠️ 另一件未查:`maxAge` 為什麼是 12 小時?**
  **可能就是刻意為了緩解這件事**(一個工作天後自然失效)。**沒查到拍板紀錄,標未確認。**
  ⇒ **若是刻意的,那本條的修法可能只是「補一個明確出口」而不是「改設計」。**

#### 🔴 修法方向必須採用的形狀(2026-08-16 主視窗批准立為 repo 標準)

**不要「兩邊各自寫死一個相同的字面」,要「兩端引用同一顆常數」。**

**正面實例就在本 repo**(`#535` 盤點時撈到的,做對的那一處):
```
storefront/…/line/start/route.ts:43      const cookieOptions = { …, path: LINE_OAUTH_COOKIE_PATH }
storefront/…/line/callback/route.ts:89   cookieStore.delete({ name: …, path: LINE_OAUTH_COOKIE_PATH })
storefront/src/lib/auth/line.ts:32       export const LINE_OAUTH_COOKIE_PATH = '/api/auth/line'
```
🔴 **兩邊各自寫死時,改一邊忘另一邊【不會有任何東西紅】;**
**引用同一顆常數時,那個錯誤在 code 層就構造不出來。**
> **⇒ 比任何守門都強,因為它不是「會抓到」,是「寫不出來」。**

⚠️ **`#535` 已修的那兩處目前是「兩邊都寫對字面」,不是這個形狀**
⇒ **它只是「這次改對了」,下次還會錯** ⇒ **本條的修法要順手把那兩處也收成常數形狀。**

#### 連帶未掃項(`#535` 盤點的 §5,刻意不另開號)

**這次只比對了「有沒有帶 `path`」,沒有比對 `domain` / `sameSite` / `secure` 的對稱性。**
**那三個不匹配時,瀏覽器行為與 `path` 不匹配【不完全相同】,但同樣可能刪不掉。**
⚠️ **風險是【理論上的】** —— cookie 那半已經證明「沒有第二個 `#535`」
⇒ **排在本條後面做,不另開號、也不當成獨立缺口。**

- **不修未來會痛在哪:** 稽核紀錄的價值**完全建立在「它記的是對的人」之上**。
  一旦有一次歸屬錯誤被發現,**整份稽核 log 的可信度就要被重新評估** ——
  而那時候沒有辦法回頭分辨哪些是對的。**這種損害不可回溯修復。**
- **發現於:** 2026-08-16 · C 窗 · 盤點「`#535` 那個病全樹還有沒有第二個」時撈到
  (盤點全文 `~/pcm-mailbox/C-SWEEP-cookie-lifecycle-2026-08-16.md`)
  —— 🔴 **它不是我要找的那個病**(那個是「刪的時候參數不對」),
  **本條是「根本沒有刪」** ⇒ **同一族、不同病。**

### #537. 🔴 client 產物裡到底有沒有 `priceByTier` —— **這題只在【產物】上成立,repo 內怎麼掃都不算**

- **狀態:** 🔴 未處理 —— **只開號,現在不做。** 要先想清楚觀察點放哪(見下)。
- **鐵則:** `CLAUDE.md` Server 端鐵則逐字 —— **「經銷價絕不傳到一般會員瀏覽器」**。
- **🔴 為什麼 repo 內的守門與 grep【全部答不了它】:**
  它們證的是「**我們的原始碼有沒有寫出洩漏**」,而鐵則問的是
  「**送到客人瀏覽器的那包東西裡有沒有那個值**」。
  中間隔著:build、tree-shaking、RSC payload 序列化、CDN 快取、以及**部署本身**。
  📎 **memory 有一條直接同構的實錘**(`feedback_vercel-build-cache-served-stale-css`):
  > **Vercel 建置快取送舊 CSS ⇒ 同一顆 commit,線上與本機產物【不同】,而 repo 內守門全看不到。**
  ⇒ **同一個道理:這題的觀察點必須在【產物那一端】。**
- **現況(C 窗 2026-08-16 查,附分母):**
  ```
  ⚠️ 假分母：git grep -iE "dealerPrice|dealer_price|經銷價"  ⇒ 70 檔
             （大半誤中：「經銷【商】」tier 標籤 + 大量註解）⇒ 這個 pattern 不能用
  ✅ 真識別字：priceByTier（domain 層對 dealerPrice / dealer_price 零命中）
     storefront 全樹（排測試）：20 行【註解】（都在說「已 strip、不帶」）
                                🔴 1 行【真的使用】：apps/storefront/src/lib/products.ts:212
                                   price: v.priceByTier.general.amount
                                   ← 而那一處正是 server-side strip 的出口（逐欄白名單，只留 general）
  ```
  ⇒ **設計上是對的。**
  🔴🔴 **但「設計上對」與「產物裡真的沒有」是兩件事,而後者【沒有人量過】。**
- **⚠️ 未查(照實留,不淡化):**
  12 支測試命中 `priceByTier`(cart / CartView / CheckoutStep2 / CheckoutView / product-jsonld /
  products / rule-based-engine / 三支 adapter / pricing)——
  🔴 **我沒有逐支開檔確認它們各自在驗什麼。12 支命中【不等於】12 道守門。**
- **可能的觀察點(未拍板,列給下一個人挑):**
  - 甲:build 後掃 `.next` 產物(client chunks + RSC payload)有沒有 `priceByTier` / `price_store`
    ⚠️ **本機 build 的產物 ≠ 線上產物**(上面那條 memory 就是這件事)⇒ 只能當第一道
  - 乙:對**線上**真 API / 頁面回應抓一次,看 payload
    🔴 **這才是鐵則真正要的觀察點**,但要有人在瀏覽器那端做
  - 丙:CI 加一格「產物字串掃描」⇒ 動 CI ⇒ **鐵則 12④**
- **🔴 不修未來會痛在哪:** **外洩對象是【一般客人】,而且不可回收** ——
  價格結構一旦進了誰的瀏覽器,就沒有辦法收回來,也沒有辦法知道有多少人拿到過。
  ⚠️ **而這條與內部的 `#534` / `#536` 不同級**:那兩條最壞是內部困擾,**這條是對外的。**
- **相關:** 由 `#535` 盤點延伸的工具設計討論撈出來 ——
  🔴 **本條之所以獨立成一件,是因為 `scripts/display-site-guard-audit.sh` 【答不了它】**:
  那支工具問「N 個顯示點各自有沒有被釘」,**而本題的正確答案是【零個顯示點】**
  ⇒ 形狀不同,硬跑只會產出**有數字而沒有意義**的報告。

- **🔴 2026-08-16 D 窗實測補充(最小重現,假資料,探針已刪;主視窗複核。以下整段照貼、口徑未改):**
  ```
  【一】RSC payload 會夾帶【沒被渲染】的 props 欄位 —— 實測，不是推論
    server component 把整顆 product 傳給 client component、而它只渲染 price ⇒
    flight data 逐字：{"product":{"price":1000,"priceByTier":{...,"store":{"amount":7717717},
                      "premiumStore":{"amount":8828828}}}}
    ⇒ lib/products.ts:212 那道 server-side strip 是【承重】的，不是縱深防禦 ——
      它是 DB 列與瀏覽器之間唯一的東西。任何 client component 拿到整顆 product，三層價全部上船，
      而畫面上看不出來。

  【二】而 strip 這個機制本身【有效】（附正向對照）
    只傳純量 ⇒ payload 只有 {"price":1000}，旁邊那顆完整物件沒有跟著。
    正向對照：把 canary 5555555 當 price 傳進同一條路 ⇒ 抓得到 ⇒「乾淨」不是量具壞掉。
    ⚠️ 這證的是【機制有效】，不是【真實商品頁只傳純量】。後者仍未量（需 env + 兩個身分）。

  【三】順手撞到：「這個路由回 404」≠「這個 render 的資料沒出去」
    探針頁回 HTTP 404（dev-preview/layout.tsx 刻意擋 production build，那道守門本身是好的），
    而 404 的 body 裡就帶著整串 payload。
    ⚠️ 只觀察到這一種 404（layout 層 / production build / 本機）。【不是通則，別的擋法沒驗。】

  【四】型別層調研（D 窗唯讀，2026-08-16）
    apps/storefront/src/data/mock-products.ts:41 UIVariant / :119-138 UIProduct
      兩者【都沒有 priceByTier 欄】；索引簽章 / [key:string] / Record<string,unknown> 共 0 處
    ⇒ 型別層【已經】不帶經銷欄，且沒有寬鬆欄位可夾帶。
    🔴 所以「釘型別」的價值不是新增約束，是把【現在成立的事實】變成【會紅的東西】——
      現在沒有任何東西擋住有人日後往 UIProduct 加一個 priceByTier?。
    ⚠️ 而真正的洞不在型別，在【傳什麼進去】：型別封閉擋不住
      「有人新寫一個 client component 收 domain 的原始物件」。那才是本輪實測到的形狀。
  ```
  ⚠️ **【二】的口徑刻意分成兩半,不得合寫** —— 「機制有效」與「真實商品頁只傳純量」是兩件事,
  **後者仍未量**,合起來寫會變成一句**沒人量過的安全宣稱**。
  📎 **本段由 D 窗實測、主視窗複核,C 窗照貼未改寫。**
  🔴 **D 窗刻意不自己寫進 backlog**,理由:「我在自己樹裡寫一個 `### #537`,
  就是親手製造我上一份收割報告抓到的那個【同號不同內容】衝突。」
- **發現於:** 2026-08-16 · C 窗 · 主視窗指派用新工具驗經銷價時,判定工具不適用而延伸出來

### #538. 🔴 兩張 tier 標籤表**值逐字相同、各自獨立定義**,而**沒有東西守它們一致**

- **狀態:** 🔴 未處理 —— **跨 `apps/admin` 與 `apps/storefront` 兩包 ⇒ 至少中鐵則 8,要 plan 等 Sean 批**
- **座標:**
  ```
  apps/admin/src/lib/customers/customer-list-view.ts:68   TIER_LABEL         一般會員 / 店家會員 / PREMIUM STORE
  apps/storefront/src/components/TierBadge.tsx:27         TIER_LABEL（區域）  一般會員 / 店家會員 / PREMIUM STORE
  ⇒ 值【逐字相同】，而兩張表【毫無關聯】
  ```
- **各自都有守門,而🔴 沒有任何東西在守「這兩張要一致」:**
  `customer-list-view.test.ts`(5 處命中)/ `TierBadge.test.tsx`(6 處命中)
  ⇒ **每一張都在守自己那一份的值對不對,沒有人在守它們相不相同。**
- **失敗情境(2026-08-16 突變實測,不是推的):**
  ```
  突變：把 admin 的 store 值改成 '車行會員'
  ⇒ admin      customer-list-view.test.ts  精準紅 1 格   ✅
  ⇒ storefront TierBadge.test.tsx          🔴 照樣綠
  ```
- **🔴🔴 而真正的後果比「沒有守門」糟,糟在一個很特別的地方:**
  **兩張表各自釘死自己的字面** ⇒ 有人改 admin 的值,**admin 那格會紅**
  ⇒ 他看到紅,**順手把測試也改成新值** ⇒ **兩邊都綠,而值已經分岔了。**
  ⚠️ **守門不但沒擋住分岔,還【提示了改法】** —— 它給了那個人**一條回到綠色的最短路徑**,
  **而那條路徑正好繞過真正的問題。**
  > 🔴 **判別句:這格紅的時候,它給的【最短修復路徑】,會不會剛好【繞過它想擋的東西】?**
  📎 **與 house 那條「mock 掉信任邊界 ⇒ 測試在替 bug 站崗」是近親但不同**:
  那條是**測試把 bug 寫成規格**(被動);**本條是測試【引導人去製造 bug】**(主動)。
  ⚠️ **沒有守門反而不會這樣** —— 那個人不知道有另一張表,他會改一邊然後走開;
  **有這個守門,他是【被打斷的】,而打斷他的東西給了他錯的出口。**
- **📎 這正是 `#536` 剛立的標準要禁的形狀:兩邊各自寫死同一個字面。**
  ⚠️ **但難度不同**:`#536` 是**同一個 app 內**(抽一顆常數即可);
  **本條是跨兩包** ⇒ 要共用就得放進 `packages/`(domain 或 ui)⇒ **動兩包 + 動共用位置 ⇒ 鐵則 8。**
- **⚠️ 不是 `order-list-view.ts:244` 那張(`MEMBER_TIER_LABEL` = 一般/車行/車行):**
  🔴 **那張的「不一致」是刻意的,契約就寫在 `:239-241`** ——
  > 「Sean 需求二分:一般 / 車行 —— store 與 premiumStore 皆歸『車行』(進階經銷仍是車行客)。」
  **兩個等級壓成同一個字看起來就是缺陷,而沒開檔就會報一個假 finding。**
- **🔴 而本條是用 `scripts/display-site-guard-audit.sh` 跑出來的,順帶暴露了那支工具的一條限度:**
  `--id 'TIER_LABEL'` **抓到第三張是運氣** —— 它叫 `MEMBER_TIER_LABEL`,**只是剛好含子字串**。
  **換個名字(例 `TierText`)整張漏掉,而報告上看不出少了東西。**
  ⇒ **那個「N 個顯示點」是【pattern 的產物】,不是【事實】** —— 已補進工具的每次輸出。
- **不修未來會痛在哪:** 文案不一致的損害不是「看起來不專業」,是**員工與客人對不上話** ——
  客服說「你是店家會員」,客人在自己頁面看到別的字,**雙方都會以為對方在講另一件事**。
- **發現於:** 2026-08-16 · C 窗 · 用 `display-site-guard-audit.sh` 跑 `TIER_LABEL` 時撈到

### #539. 🔴 tier 標籤的**四個顯示點,零守門** —— 而我第一次分類時把它們判成「大多是假警報」

- **狀態:** 🔴 未處理(補守門是輕量片,但**先確認 `#538` 要不要一起做** —— 抽共用常數會改動同一批檔)
- **四個顯示點,各自零守門(逐一開檔數過,附命中數):**
  ```
  components/customers/customer-detail.tsx:155,165   TIER_LABEL[customer.tier]
      候選測試 customer-detail-email.test.tsx / customer-detail-view.test.ts / load-customer-detail.test.ts
      ⇒ 三支對「一般會員|店家會員|PREMIUM STORE」的命中數：0 / 0 / 0
  components/customers/customers-table.tsx:44        TIER_LABEL[c.tier]
      候選 app/customers/page.test.tsx ⇒ 命中數 0
  components/customers/tier-edit-form.tsx:41         TIER_LABEL[tier]
      候選 components/shared/admin-form-consumers.test.tsx ⇒ 命中數 0
  lib/orders/order-list-view.ts:244                  MEMBER_TIER_LABEL
      order-list-view.test.ts 存在，但對 tier 標籤命中數 0
  ```
  ⚠️ **有守門的是另外六支**(orders-table / customer-list-view / TierBadge / CheckoutView /
  AccountView / OverviewTab)—— **它們守的是【別的顯示點】或【常數本身】,不是上面這四個。**

- **🔴🔴 而本條的價值有一半在【我怎麼判錯的】,那要留著:**
  工具標了 4 個 ❓,我回報「**1 個真缺口、3 個假警報**」。**實際是 4 個全真、零假警報。**
  **病因:我問的是「哪些測試【提到這個檔】」,不是「哪些測試【在驗 tier 文案】」。**
  > 🔴 **判別句:我數的是「這個檔有沒有被人提起」,還是「這件事有沒有被人驗」?**
  ⇒ 前者恆大於後者,而**它會把「有人碰過」讀成「有人守著」** ——
  **那正是這支工具存在的理由,而我在解讀它的輸出時犯了同一個錯。**
  ⚠️ **後果具體**:主視窗依我的錯誤分類下令「修工具的 basename bug」,
  **而那個 bug 不存在** —— `order-list-view.test.ts` 只是根本沒進候選名單。
  🔴 **工具沒有錯,錯的是我讀它的方式。**

- **不修未來會痛在哪:** tier 文案改動時,**畫面上四個地方會靜默不同步**,
  而 `#538` 講的「兩張表不一致」是**更上游**的同一件事 ⇒ 兩條合起來看才是完整的圖。
- **發現於:** 2026-08-16 · C 窗 · 跑 `display-site-guard-audit.sh` 之後**重新逐一開檔**才發現
- **相關:** `#538`(兩張表各自定義)、`scripts/display-site-guard-audit.sh`

- **相關:** `docs/specs/2026-08-15-products-manual-listing-override-plan.md` §7-2 / §5 `Q3=乙`;
  欄位級證據 `docs/specs/2026-08-15-product-field-ownership.md` §1/§4
- **發現於:** 2026-08-15 · B 窗 · `#20` 片2 plan v3 撰寫時(codex 關卡1 R1 折 finding 過程中具體化);
  **2026-08-15 同日以欄位歸屬盤點補上證據並更正方向與緩解句**

### #540 · 動效 token 有宣告、零消費端 —— 「BMW M 動效規範」目前是一段文字

> ⚠️ **號碼佔位,待主視窗確認**(`scripts/next-backlog-number.sh` 給的是**下限**;
> 已另跑第二道 `grep -rn 佔位 ~/pcm-mailbox/*.md` ⇒ 命中號全部 < #540)。

- **狀態:** 未開工
- **現況(2026-08-16 全後台合規盤點實測,B 窗)**:
  - 宣告端 ✅ `apps/admin/src/app/globals.css:80-82` 三顆,**且編譯產物裡查得到**
    `--motion-fast:.13s` / `--motion-base:.22s` / `--ease-standard:cubic-bezier(.16,1,.3,1)`
  - 消費端 ❌ **0**
    數法(可重跑):`grep -rn 'var(--motion\|var(--ease-standard' apps/admin/src | wc -l` → 0;
    `C=$(find apps/admin/.next/static/chunks -name '*.css'|head -1); grep -c 'var(--motion' "$C"` → 0
    🔴 **第二條數的是【編譯產物】** —— 原始碼零命中可能是寫法問題,產物零命中才是「沒有規則吃它」
  - 現有動效 14 處 `transition`,**全部是 shadcn 預設**(`duration-200 ease-linear` 或不指定),
    其中 11 處在 `components/ui/`(沒被碰過的原件)
- 🔴 **為什麼守門沒叫:** `apps/admin/src/app/design-tokens.test.ts:51-71` 那一格是綠的,
  而**它釘的是「token 住在 `:root` 而不是 `@theme inline`」,不是「token 被用」**。
  ⇒ **守門在,而它守的不是這件事。** 補這條時要**同時**加一格斷言消費端 > 0,否則下次照樣綠。
- **不修會痛在:**
  - **擴充性:** 下一片寫動效時沒有現成消費端可抄,會各自寫 `duration-*`,
    ⇒ 三顆 token 永遠停在「宣告了但沒人用」,而每多一片就多一組不一致的時間值
  - **可維護性:** 設計參照 §5 若不標現況,讀的人會以為「動效規範已套用」——
    **2026-08-16 修訂前那一節的「陰影」列真的寫著現況「無」,而實測有 12 處** ⇒ 已是實錘,不是假設
  - **bug 可追蹤性:** 「減少動態」那段(`globals.css` 的 `prefers-reduced-motion`)已落地且有守門,
    但它管的是**關掉**動效;**開啟**那半沒有任何觀測點 ⇒ 壞了不會有人發現
- **落點:** 併進「按鈕與輸入框」那一片(§6.5.6 同時要補 `active:` 與 `input` 的 `hover:`)——
  那一片本來就要改 `components/ui/button.tsx` 與 `input.tsx`,是唯一自然的消費端。
- **關閉條件:** 編譯產物裡 `var(--motion` 命中 > 0 **且** 有一格測試斷言它 > 0。
  🔴 **只改 code 不加那格 = 這條不得標為已解決**(理由見上一段)。
- **估時:** 20-30 min(併片時的增量)
- **相關:** `docs/design/admin-design-system.md` §5 與檔頭「落地狀態」表;
  完整量法與逐頁盤點 `~/pcm-mailbox/B-後台BMW-M合規盤點-20260816.md`
- **發現於:** 2026-08-16 · B 窗 · 全後台 BMW M 合規盤點

### #541 · 「無陰影」是 BMW M 的核心手段,而全站按鈕與輸入框都有陰影

> ⚠️ **號碼佔位,待主視窗確認**(`sh scripts/next-backlog-number.sh` → 541,腳本自印這是下限;
> 第二道 `grep -rn 佔位 ~/pcm-mailbox/*.md | grep -oE '#5[0-9]{2}'` → #500 #501 #507 #508,皆 < 541)。

- **狀態:** 未開工
- **現況(2026-08-16 合規盤點,B 窗)**:12 處 `shadow-*`(非 `shadow-none`)
  數法:剝註解、排除 `*.test.tsx` 後掃 `apps/admin/src/**/*.tsx`,pattern `shadow-(?!none)[-\w\[]`
  ```
  components/ui/button.tsx:13,15,17,18   shadow-xs × 4 variant   ← 全站每一顆按鈕
  components/ui/input.tsx:11             shadow-xs               ← 全站每一個輸入框
  components/ui/sidebar.tsx:252,314,471  shadow-sm / shadow-[0_0_0_1px_…]
  components/ui/sheet.tsx:52             shadow-lg
  components/orders/shipment-dialog.tsx:217        shadow-xl
  components/shared/multi-check-filter.tsx:52      shadow-md
  ```
  🔴 **前兩支住 layout 共用閉包 ⇒ 15 條路由每一條都吃到。**
- **依據:** 設計參照 §1「無陰影、以 hairline 分隔」,**【抄】自 OD `--elev-flat: none` `:57`**。
  ⚠️ **這些陰影不是有人決定要的,是 shadcn 原件的預設,從來沒被碰過。**
- **不修會痛在:**
  - **擴充性:** 每加一個 shadcn 元件就多帶一組預設陰影進來,而沒有任何東西會提醒
  - **可維護性:** 設計參照說「無陰影」而 code 全是陰影 ⇒ 下一個人不知道哪邊是對的
  - **bug 可追蹤性:** 本條 + `#540`(動效)是同一種病的兩個實例 —— **原件層沒有被納入設計語言**
- **落點未定,候選兩個:**
  - **甲**|併進「按鈕與輸入框」那一片(同 `#540`):那片本來就要改 `button.tsx` / `input.tsx`,
    但它只涵蓋 12 處裡的 5 處
  - **乙**|獨立一片掃 `components/ui/` 全部原件:涵蓋完整,但會動到 6 支共用元件 ⇒ **命中鐵則 12 ⑥**
  🔴 **兩案都要先答一題:`shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` 是【陰影】還是【描邊】?**
  OD 自己有 `--elev-ring: 0 0 0 1px var(--border)` `:58` ⇒ **那一處可能是合規的,不能一律刪。**
- **關閉條件:** `apps/admin/src` 掃出的 `shadow-*`(非 none)命中數 = 0,**或**每個殘留命中都在條目裡
  寫明「它是描邊不是陰影,依據 OD `:58`」。**且**有一格測試釘住這個數。
  🔴 **觀測點問題,誠實回答:目前【沒有】任何東西會在有人加回陰影時紅。**
  **`design-tokens.test.ts` 只釘圓角與 token 值,不釘陰影** ⇒ **補這條時必須一起加,否則會復發而無症狀。**
- **估時:** 甲 20 min / 乙 60-90 min(含共用元件回歸)
- **相關:** `docs/design/admin-design-system.md` 檔頭落地狀態表 + §5;`#540`
- **發現於:** 2026-08-16 · B 窗 · 全後台 BMW M 合規盤點

### #542 · 語意色沒收斂:70 處直接寫 Tailwind 調色盤色

> ⚠️ **號碼佔位,待主視窗確認**(同 `#541` 兩道)。

- **狀態:** 未開工
- **現況(2026-08-16 合規盤點,B 窗)**:70 處 / 13 檔
  數法:剝註解、排除 `*.test.tsx`,pattern `(?:text|bg|border|ring)-(?:red|green|blue|…|fuchsia)-[0-9]{2,3}`
  ```
  12  components/orders/notes-timeline.tsx        9  app/orders/page.tsx
   6  cancel-result-panel / item-procurement-section / payment-list / result-banner / settings-result-banner
   4  payment-record-form / print/picking-doc / print/shipping-doc
   3  note-compose-form / shipment-section         1  item-procurement-form
  ```
  ✅ **layout 共用閉包 = 0 處** ⇒ **骨架乾淨,70 處全在功能元件裡。**
- **依據:** 設計參照 §6.5.4「語意色只用 `success` / `warn` / `danger` 三個,不自己發明第四個」**【抄】** OD `:25-27`。
- 🔴 **其中 4 處會【印在紙上】,而它們沒有 `print:` 抑制**:
  `print/picking-doc.tsx:63,174` 與 `print/shipping-doc.tsx:209,297` 的 `text-amber-800` 系
  ⇒ 黑白雷射印出來變同階灰(設計參照 §7 的 CIE L\* 表:五個語意色全落在 L\* 42–50)。
  ✅ **而「不得只靠顏色區分」那條【沒有】違反 —— 開檔讀過,文字自己寫著「數量資料尚未就緒 / 這一項不要揀」。**
  **⇒ 違反的只是 token 規則。兩件事要分開,不然嚴重度會報高。**
- **不修會痛在:**
  - **擴充性:** 沒有 `success`/`warn` 的 token 落地 ⇒ 下一個人只能繼續挑調色盤色,數字只會變大
  - **可維護性:** 同一個「警告」在不同檔用了不同的 amber 階,改調性時要逐檔找
  - **bug 可追蹤性:** 列印那 4 處是**跨媒介**的,螢幕上永遠正常 ⇒ 只有印出來才看得到
- **落點未定,候選兩個:**
  **甲**|先定義 `--success` / `--warn` 三顆 token(`--destructive` 已有),再逐檔換 —— 順序不能反
  **乙**|只先處理列印那 4 處(跨媒介、風險最高),其餘留著
  🔴 **甲的前置是一道設計題:三顆語意色在【純灰階 admin】上要用什麼值?** OD 的原值是彩色。**要 Sean 看。**
- **關閉條件:** 上述 pattern 命中數 = 0,**且**有一格測試釘住它。
  🔴 **觀測點問題,誠實回答:目前沒有任何東西會紅。** 補這條時要一起加守門格。
- **估時:** 甲 90 min+(含 Sean 定值往返)/ 乙 20 min
- **相關:** 設計參照 §1 / §6.5.4 / §7;`~/pcm-mailbox/B-後台BMW-M合規盤點-20260816.md` §1-4
- **發現於:** 2026-08-16 · B 窗 · 全後台 BMW M 合規盤點

### #543 · 空狀態:26 塊裡「做不了找誰」= 0,另有 2 塊【什麼都不顯示】

> ⚠️ **號碼佔位,待主視窗確認**(同 `#541` 兩道)。

- **狀態:** 未開工
- **依據:** 設計參照 §6.5.5 —— 每個空狀態要回答 ①為什麼空 ②可以做什麼 ③做不了找誰。
  Sean 北極星「員工不用人教能獨立跑完一天」;**空狀態是員工第一次用某功能時看到的畫面**。
- **現況(2026-08-16 合規盤點第二版,單位 = 畫面/區塊)**:
  ```
  ① 講清楚 17／26      ⚠️ 成因分不出 7／26      ❌ 整塊消失 2／26
  ② 有      8／26      ⬜ 本來就沒動作 4／26     ❌ 14／26
  ③ 有      0／26
  ```
- 🔴 **③ 的意思要講精確,不然會被誤解成「這個後台不會寫 ③」**:
  全樹「找誰」的字面有 **27 處**(通知系統維護 / 找工程師 / 聯絡工程師 / 到供應商管理確認)。
  🔴 **數法要剝註解且排除測試檔,三種算法會給三個數**(落筆前實跑過):
  `grep -rn … --include='*.tsx' | wc -l` → **39**(行數 × 含測試檔);含註解不含測試 → **30**;
  **剝註解不含測試 → 27** ← **本條用這個**。
  ⚠️ **寫下「27」而附一條會印出 39 的命令,比不附命令更糟** —— 下一個人核不出來,會以為條目在唬爛。
  **27 處全部在錯誤態、截斷態、結果橫幅,零處在空狀態。**
  **⇒ 不是不會寫,是從來沒把 ③ 用在空狀態上。這是【搬過去】不是【從頭教】。**
- 🔴🔴 **兩塊「什麼都不顯示」,而任何找文案的盤點都零命中**:
  **分母:全樹 `if (….length === 0) return null;` 共 4 處**
  (`grep -rn 'length === 0) return null' apps/admin/src --include='*.tsx'`),**其中 2 處是問題**:
  ```
  🔴 refund-ledger-section.tsx:84   rows.length === 0        ← 區段層級，整個「退款紀錄」區塊消失
  🔴 cancel-order-forms.tsx:220     selectable.length === 0  ← 區段層級，「取消部分品項」表單消失
  ⬜ shipping-selection.tsx:150     選取列為空 ⇒ 隱藏浮動選取列   = 正確，那不是「一個區塊空了」
  ⬜ admin-data-table.tsx:57        helper 回傳節點陣列為空 ⇒ 不渲染分隔點  = 正確，不是使用者面的區塊
  ```
  **員工看到的是【那個區塊不見了】。** ⚠️ `cancel-order-forms` 那塊可能是對的
  (沒有可取消品項 ⇒ 不顯示該表單合理),**但那要有人判,不能因為它靜悄悄就當作沒事。**
- ✅ **值得抄的三處(不要從零設計)**:
  `shipment-section.tsx:45`(兩條路徑 + 確切 UI 位置)/ `receipt-panel.tsx:112`(兩種成因 + 確切位置)/
  `customer-panel.tsx:65,70`(把「讀取失敗」與「查無此人」拆成兩句,逐字寫「這**不是**『查無此人』」)
- **不修會痛在:**
  - **擴充性:** 沒有共用的空狀態元件 ⇒ 每個新區塊各寫一句,26 塊會繼續變多
  - **可維護性:** 7 塊的成因分不出來(「目前沒有商品」讀不出是真的沒有還是篩選篩掉了)——
    §6.5.5 逐字寫「①的三種成因不可共用一句文案」,而它們共用了
  - **bug 可追蹤性:** 那 2 塊 `return null` 在畫面上與「元件壞掉不渲染」**完全相同**
- **落點未定,候選兩個:**
  **甲**|一片做完 26 塊 —— 涵蓋完整,但跨十幾檔,**體積遠超 15-45 分鐘,必拆**
  **乙**|先做那 2 塊 `return null` + 7 塊成因分不出的 ⇒ 9 塊,其餘隨各自功能片順手補
  🔴 **推薦乙,理由**:③ 是**逐塊的文案**,沒有共用抽象可做;**而那 2 塊 `return null` 是【缺陷】不是【文案不足】。**
- **關閉條件:** 26 塊逐塊在 §6.5.5 的三問上有明確答案(含「這裡本來就沒有動作可做」這種 ⬜)。
  🔴 **觀測點問題,誠實回答:這一條【做不出機械守門】** ——
  「有沒有回答三件事」是語意判斷,不是字面比對。**寫死關鍵字會退化成假守門(釘字面不釘事實)。**
  **⇒ 本條的關閉只能靠人工逐塊複核,而那份清單就是盤點 §3-1 的表。不要假裝它可以自動化。**
- **估時:** 乙 45-60 min(9 塊)
- **相關:** 設計參照 §6.5.5;`~/pcm-mailbox/B-後台BMW-M合規盤點-20260816.md` §3(含第一版分母錯在哪)
- **發現於:** 2026-08-16 · B 窗 · 全後台 BMW M 合規盤點(第一版分母錯,D 窗 MF1 打回後重算)

### #544 · 對【真 build 產物】斷言圓角值集合 —— 原始碼層的定位器涵蓋不了全站

> ⚠️ **號碼佔位,待主視窗確認**(`sh scripts/next-backlog-number.sh` → 544,腳本自印這是下限;
> 第二道 `grep -rln '#544' ~/pcm-mailbox/*.md` → 零命中)。

- **狀態:** 未開工
- **由來(2026-08-16,B 窗,四輪審查之後的 R4 換路)**:
  `apps/admin/src/app/design-tokens.test.ts` 那格「禁裸圓角類別」**掃的是原始碼**,
  而它宣稱要保護的是「編譯出來的 CSS 裡沒有 `--radius` 蓋不掉的圓角」。
  🔴 **三輪的 must-fix 全部是同一件事的症狀:原始碼層永遠只是 Tailwind 的近似。**
  ```
  R1  正規式的字面本身命中它自己 ⇒ 該檔在結構上無法改成 .tsx
  R2  剝註解 ⇒ 把真陽性重新分類成誤攔（被註解掉的 class 從攔變放行）
  R3  只看引號 ⇒ 同一個錯換方向再犯（真 build 實測：無引號的註解散文照樣產出規則）
      ＋ 掃描範圍只吃 .tsx（153 支）而 .ts 有 221 支且 class 常數住在裡面
  ```
- 🔴 **而正解早就寫在同一支檔的檔頭**:「要確認全站,唯一可靠的做法是編譯 CSS 之後數
  `border-radius` 分佈」。**不是沒想到,是想到了、寫下了,然後順著手邊最像測試的那個形狀走。**
- **要做的**:斷言**真 build 產物**裡 `border-radius` 的值集合 ⊆ `{0, var(--radius), calc(infinity*1px)}`
  (最後一項 = 狀態膠囊,待 Sean 裁方/圓之後可能收掉)。
  數法(本 session 跑過五次,五次成功):
  ```
  C=$(find apps/admin/.next/static/chunks -name '*.css' | head -1)
  grep -oE 'border-radius:[^;}]*' "$C" | sort | uniq -c
  ```
- 🔴🔴 **明文禁止的做法:不要在測試裡自建 Tailwind 管線。**
  **本 session 自建探針三次(postcss `source(none)` 四種寫法 / 換路徑 / 指紋迴圈),三次都是死量具,
  而三次都印出長得完全正常的結果。** 讀真 build 產物則五次五次成功。
  ⇒ **這條是實測出來的風險數字,不是偏好。**
- ⚠️ **前提(不解決就不能開工)**:它**需要先 build** ⇒ **不能住在一般 `vitest` 裡**。
  候選位置:CI 的 build 後步驟,或 `scripts/` 下一支檢查。**那是這條的第一個決策題,不是實作細節。**
- **不修會痛在:**
  - **擴充性:** 定位器的範圍不含 `.css` / `packages/` / 其他 app;每多一個來源就多一個看不到的面
  - **可維護性:** 現行那格已 ~140 行註解 + 24 案例,而它做的是一件檔頭說了不用做的事
  - **bug 可追蹤性:** 產物髒掉時沒有任何東西會紅 —— 本 session 那條 `.rounded{border-radius:.25rem}`
    在 bundle 裡活了數小時,而三綠全綠
- **關閉條件:** 有一格在 build 之後跑的斷言,且**用突變驗過它紅得起來**(把一個違規類別寫進任一來源 ⇒ 它必須紅)。
  🔴 **定位器那格【不得】因為本條完成而刪除** —— 它的價值是「指出哪支檔」,產物格說不出來。
  **兩格是分工不是重複。**
- **估時:** 45-60 min(含 CI 位置決策往返)
- **相關:** `apps/admin/src/app/design-tokens.test.ts`(定位器本體與四輪軌跡);`#540`(動效 token 同族:有宣告零消費)
- **發現於:** 2026-08-16 · B 窗 · R3 對抗審查 MF5(換 agent 換角度才問出來的層級題)

### #545 · 建表時自動開 RLS 的 event trigger **吞掉自己的失敗** —— 守門是 fail-open

> ✅ **號碼已確認**(主視窗 2026-08-16;確認前複跑撞號檢查:`grep -rn '#54[5-9]' ~/pcm-mailbox/*.md` 零命中、
> `git show dev:docs/phase-1-backlog.md | grep -nE '^### #54[5-9] '` 顯示 dev 上 `#545`/`#546`/`#547`/`#549` 皆為本窗條目、
> `#548` 為 I 窗條目 ⇒ **零撞號**)。

- **狀態:** 未開工
- **由來(2026-08-16,E 窗 SECDEF 全樹稽核順手撿到,B 窗立案)**
- **在哪:** `supabase/migrations/20260531142534_govern_rls_auto_enable.sql:59-63`
  ```sql
  EXCEPTION
    WHEN OTHERS THEN
      RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
  ```
- **問題:** 這支 event trigger 在建表時自動開 RLS。**開失敗時它只寫 server log,然後繼續。**
  ⇒ 表建出來了、migration `exit 0`、**沒有任何東西紅**,而那張表沒有 RLS。
- 🔴 **這正是「壞掉而看起來成功了」那個形狀** —— 而它守的是**建新表**,
  失敗當下不會有人知道,要到有人從外面讀到那張表才會發現。
- **⚠️ 不是活洞:** 真實表 43 支**全部**在樹裡有明文 `ENABLE ROW LEVEL SECURITY`
  (量法見 `~/pcm-mailbox/E-670-SECDEF全樹稽核.md` §3)⇒ 現況安全。
  **壞的是守門本身,不是資料。**
- **要做的:** 改 `RAISE EXCEPTION`(fail-loud),或在 migration 尾巴加一條
  「本檔新建的表 RLS 全開」的斷言。**兩案擇一要先判**:fail-loud 會讓既有的
  「建表順序踩到 schema 權限」那類情境當場炸,**改之前要先量會不會誤傷**。
- **三視角:**
  - **擴充性:** 真登入線(E8-B)大概率建新表,而它正好走這條路徑
  - **可維護性:** 現在無法用「migration 綠了」推論「RLS 開了」,兩件事被解耦而沒人知道
  - **bug 可追蹤性:** 失敗只在 server log,**repo 內零訊號**
- **關閉條件:** 有一格**紅得起來**的負測(故意讓 enable 失敗 ⇒ migration 必須失敗),
  不是「改成 RAISE EXCEPTION 就算做完」。
- 🔴 **動 migration ⇒ 鐵則 12 ③,要 Sean 批 + 對抗審查。現在只記,不做。**
- **相關:** `docs/patterns/revoking-function-execute-in-supabase.md`;`#525`;`#546`

### #546 · 正式庫 ACL 對帳 —— **A 庫已做(2026-08-16),報價單庫仍完全沒查**

> ✅ **號碼已確認**(主視窗 2026-08-16,撞號檢查見 `#545`)。

- **狀態:** 🟡 **部分完成(2026-08-16 當日縮小範圍,未關閉)**
  > **✅ 已關的那一半 —— A 庫**(`pcm-website-v2`):E 窗以唯讀帳號 `pcm_audit_ro` 實查 production
  > (`~/pcm-mailbox/E-682-正式庫實測結果.md`)。`#525` 那個洞**由 production 背書是關的**;
  > 六張客戶資料表對 `anon` 零外露(逐項 + 控制組,控制組回 true ⇒ 探針不恆假)。
  > 🔴 **同一次實測也證明 repo 側分析是【少報】**:repo 說 `anon` 在 `public` 碰得到 **9** 個、
  > 正式庫說 **11**(多出 `brands` / `categories` / `product_fitments_effective` /
  > `customer_wallet_balance_check`);跨所有 schema 則是 **26**。
  > **⇒ 少報比多報危險:多報會有人來查,少報聽起來像已經收斂了。**
  >
  > **🔴 仍然開著的兩半(不要用上面那半去蓋掉):**
  > - **報價單庫完全沒查** —— 該庫唯讀帳號還沒建 ⇒ **那邊的所有權限結論仍只證到 repo 文字**。
  > - **A 庫也只查了被問到的維度** —— 平台自己裝的擴充的完整 ACL 仍未逐項盤。
- **由來(2026-08-16,E 窗稽核 §6 第 1 條誠實缺口,B 窗立案讓它有編號)**
- **問題:** 2026-08-16 的 SECDEF 全樹稽核結論(80 支存活、`anon` 執行得到 0 支)
  讀的是 `supabase/migrations` 的**文字**,不是正式庫的**現況**。
  🔴 **守門釘的是 repo 裡的字面,不是真實世界的事實。**
- **為什麼這不是杞人憂天:** `#525` 本身就是實錘 —— 那次 apply 被守門擋下時,
  正式庫的 ACL 形狀是 repo 讀不出來的(`[anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE]`)。
- **要做的:** 對正式庫跑一次 catalog 查詢,逐支 SECDEF 函式問
  `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')`,與 repo 文字結論對帳。
  🔴 **判準用 `has_function_privilege` 不用 `proacl` 字面**(前者算有效權限、含繼承)。
- **同批可一起關掉的三條未驗**(都在同一次連線裡問得完):
  - 正式庫 `anon.rolinherit` 的真值
  - Supabase 真實的 `ALTER DEFAULT PRIVILEGES` 設定(目前是**模擬**的)
  - `NOINHERIT` 角色 `SET ROLE service_role` 那條路徑
- **⚠️ 這條不擋任何人**(所以沒放進 Sean 2026-08-16 的待辦清單),
  **但它必須有編號,不能只活在一封信裡。**
- **三視角:**
  - **擴充性:** 真登入線會大量新增 `anon`/`authenticated` 判斷,那時這個缺口的代價變高
  - **可維護性:** 現在每一份權限報告都要附「只證到 repo 文字」這個限定,而那句話會被磨掉
  - **bug 可追蹤性:** repo 與正式庫分歧時,**零訊號**
- **關閉條件:** 有一份對帳輸出(正式庫實查 vs repo 文字),差異逐條有歸屬。
- **相關:** `docs/patterns/revoking-function-execute-in-supabase.md` §6;`#525`;`#545`

### #547 · 後台**讀**路徑只有一層授權,**寫**路徑有三層 —— 不對稱本身是風險

> ✅ **號碼已確認**(主視窗 2026-08-16,撞號檢查見 `#545`)。

- **狀態:** 未開工(**觀察,不是活洞**)
- **由來(2026-08-16,E 窗 `FINDING E671-2`,B 窗複驗後立案)**
- **現況(B 窗實查):**
  ```
  寫路徑  三層  apps/admin/src/lib/session/authorize.ts:24-34
                ①verifySession 自驗 ②isAllowedOrigin fail-closed ③getSessionActor 具名 actor
                任一失敗 → null,caller redirect denied、不以未知身分寫稽核
  讀路徑  一層  只有 apps/admin/src/proxy.ts
                量法:grep -nE 'authorize|getSession|verifySession' apps/admin/src/app/customers/page.tsx → 零命中
                      (該頁自己不做授權檢查,完全依賴 proxy)
  ```
- **⚠️ `proxy.ts` 本身寫得好**,所以現在不是洞:預設擋(`:38` 未登入導 `/start`)、
  dev bypass 要顯式、SSO 入口是精確白名單、`matcher`(`:64`)涵蓋全部非靜態路徑。
- 🔴 **不修未來會痛在哪(鐵則 10):**
  **`matcher` 哪天被改窄 —— 為了讓某個新頁面繞過登入閘、或為了修一個 redirect 迴圈 ——
  讀路徑沒有第二道會攔下來,而寫路徑有。**
  ⇒ 那次改動的 diff 會長得像一行路由設定,**而它實際上是把客戶資料變成公開頁**。
  ⇒ 而且**不會有任何東西紅**:頁面照常渲染、測試照常綠、稽核軌不會記下「這次是誰看的」。
- **要做的(兩案,未選):**
  - (a) 讀路徑補第二道:敏感頁(customers / orders 明細)在 server component 內自驗 session
  - (b) 不補第二道,改成**釘住 `matcher`**:一格會紅的守門,`matcher` 被改窄就失敗
  🔴 **(b) 便宜很多而且擋的正是那個情境;(a) 涵蓋面廣但要逐頁加、且容易漏新頁。**
  **選 (b) 的話要先答:守門怎麼知道「哪些路徑必須被涵蓋」——那份清單本身會不會過期。**
- **三視角:**
  - **擴充性:** 真登入線(E8-B)會讓「讀到的人是誰」第一次變成真證據,那時這個不對稱的代價變高
  - **可維護性:** 現在「這頁受不受保護」的答案不在頁面裡,要跨檔去讀 proxy 的 matcher 正規式
  - **bug 可追蹤性:** 保護失效時零訊號(頁面正常渲染),**屬於「壞掉而看起來成功了」那一族**
- **關閉條件:** 選定 (a) 或 (b) 並實作,且**用突變驗過它紅得起來**
  (把 `matcher` 改窄一條 / 拿掉某頁的自驗 ⇒ 必須有東西失敗)。
- **相關:** `apps/admin/src/proxy.ts`;`apps/admin/src/lib/session/authorize.ts`;`#546`;E8-B 真登入線

### #549 · ADR-0005 §8.4 對自己下的「重新評估」義務**已被觸發而無人接**

> ✅ **號碼已確認**(主視窗 2026-08-16,撞號檢查見 `#545`)。

- **狀態:** 未開工(**制度債,不是活洞**)
- **由來(2026-08-16,code-reviewer 審 `6a25da43` 的 must-fix 5,B 窗立案)**
- **原文(`docs/decisions/0005-custom-supabase-direct.md`「與既有例外的區別」段末)逐字:**
  > 日後若有第二個 storefront service_role 需求、須重新評估是否該抽 `apps/api/`(決策1 選項 B)、**不可逕援本例外擴張**。
- **問題:** 第二、三、四道門**已經存在**,而那次「重新評估」**沒有發生過**。
  ```
  量法:git grep -nE "^// eslint-disable-next-line no-restricted-imports" -- 'apps/storefront/src/**'
  2026-08-16 實跑 = 4 處,分佈在
    apps/storefront/src/lib/auth/composition.ts
    apps/storefront/src/lib/auth/line-admin.ts        ← §8.4 拍板的那一道
    apps/storefront/src/lib/email/composition.ts
    apps/storefront/src/lib/payment/composition.ts
  🔴 行號故意不列(會漂);^ 錨定不可省 —— 不錨定的話,提到這個 pattern 的【文件本身】
     會自己命中,實跑變 5 不是 4,而且每多一份文件提到它就再 +1。
  ```
- 🔴 **不是說那三道門違規** —— 它們各自可能都有拍板、都合法。
  **壞的是:ADR 寫了一句「再有下一個就要回來重評」,然後有了三個,而那句話沒有任何機制會叫。**
  ⇒ 這正是**「寫下來就當成處置完畢」**那個形狀:條款存在、零訊號、100% 不會被執行。
- **要做的:**
  - (a) 逐道門查它的拍板來源(有沒有 ADR / Sean 拍板 / 只是當時順手開的),補齊或補立 ADR 條目
  - (b) 執行那次被欠的重評:**現在四道門了,還要不要抽 `apps/api/`**(決策1 選項 B)
  - (c) 🔴 **把「幾道門」這件事做成會紅的東西** —— 一格測試釘住上面那條**行首錨定**命令的
    **出現次數**,新增一道就紅、逼人回來看 ADR。**沒有 (c),(a)(b) 做完還會再過期一次。**
    ⚠️ **寫那格時務必用錨定版** —— 不錨定的話,**那格測試自己的原始碼會被自己數進去**,
    寫完當下就是錯的基準(本條立案當天實錘:不錨定 5、錨定 4)。
- **三視角:**
  - **擴充性:** 真登入線與後續會員相關片都可能想再開一道,現在沒有任何東西會攔下來問「你評估過了嗎」
  - **可維護性:** ADR 是最權威的載體,而它現在有一句**已被違反卻仍讀起來有效**的條款
  - **bug 可追蹤性:** service_role 多一個持有點就多一條可能外洩到 client bundle 的路徑,而**目前每道門各自只有 `import 'server-only'` 這一道自保**
- **關閉條件:** (a)(b) 有書面結論寫回 ADR-0005 §8.4,且 (c) 那格**用突變驗過會紅**(新增第五道 disable ⇒ 必須失敗)。
- **相關:** `docs/decisions/0005-custom-supabase-direct.md` §8.4;`docs/patterns/revoking-function-execute-in-supabase.md`;`#545`;`#546`;`#547`

### #552 · Excel 匯入開工時**不要直接把 `xlsx` 裝回來** —— 它是被刻意移除的

> ✅ **號碼已跑兩道閘**(`bash scripts/next-backlog-number.sh` → 下一個可用 `#552`;
> `grep -rn '#55[0-9]' ~/pcm-mailbox/*.md` 取出 `#551`;`git show dev:… | grep '^### #552 '` 回 0)。

- **狀態:** 未開工(**這是一條防復發的備忘,不是缺陷**)
- **由來(2026-08-16,B 窗移除 `xlsx` 時主視窗指出的下游風險)**
- **事實:** `xlsx@0.18.5` 已於 2026-08-16 從 root `package.json` 的 `devDependencies` 移除
  (commit `13e8c26e`,Sean 逐字批准「移除吧」)。
  **原因**:帶 2 個 HIGH 且**官方無修補版**(`patched` 欄空)。移除當下**全樹零程式碼引用**
  (四種 pattern 變體皆 0、分母 1173 檔、正向對照 `react` 168 檔)。
- 🔴 **為什麼會踩:全 repo 有 18 個 docs 提到 `xlsx`**,而它們在描述**規劃中的供應商 Excel 匯入**。
  ⇒ 那條功能開工的第一天,有人讀到那些 spec 會以為「本來就有」,
  **然後很可能直接 `pnpm add xlsx` 裝回來** —— 裝回一個帶兩個 HIGH、官方不修的解析器,
  **而且那條路正好是「拿它去吃外部檔案」**。
- **要做的(開工那天的第一件事,不是最後一件):**
  1. **先選解析器**,把「為什麼不是 `xlsx`」寫進那片的 plan
  2. 候選要看:**有沒有在維護、CVE 修補紀錄、是否需要處理不受信任的檔**
  3. ⚠️ **`papaparse`(CSV)目前也在 `devDependencies` 且零引用** ——
     若匯入改走 CSV,那個現成的比裝回 `xlsx` 安全得多。
     **但它今天沒有被批准移除或保留,不要順手處置。**
- **三視角:**
  - **擴充性:** 匯入是規劃中的功能,現在留一句比那天現想便宜
  - **可維護性:** 18 個 docs 說「有」、repo 說「沒有」,**而沒有任何一處解釋為什麼**
  - **bug 可追蹤性:** 裝回來不會有任何東西紅 —— `pnpm add` 是綠的,三綠也是綠的
- **關閉條件:** 匯入片的 plan 裡有一段寫明選了什麼解析器、為什麼不是 `xlsx`。
- **相關:** commit `13e8c26e`;E 窗 Phase 2 獵洞

### #513. 🏷️ 「經銷價與商品特價都走 `discount_total`」—— 這個設計決定目前唯一的載體是一句對話

- **狀態:** ⏳ 待執行(**不是缺陷,是缺載體**)
- **優先級:** 🟠 中(做經銷價或特價的那一刻才會痛,**而那時已經來不及問**)
> 🔴🔴 **讀這條之前先看這裡:下面有兩種來源,強度不同,不要混著讀。**
> **「Sean 說的」= 他要什麼(意圖)。「repo 現況」= 它現在是什麼(事實)。**
> **這兩者在本條目裡刻意分行寫並標來源 —— 因為它們現在指向不同方向。**

- **【Sean 說的 · 意圖】** 2026-08-15 逐字:
  > 「你忘記**經銷商跟商品特價優惠都屬於折扣**。那這兩個地方在報價單顯示 都是 折扣 沒錯。」

  ⇒ 他要的是:兩個未來功能(**經銷價** / **商品特價**)**都走 `orders.discount_total`**。

- 🔴🔴 **【repo 現況 · 事實】而 schema 目前往另一個方向長 —— 這裡有兩條路**
  (2026-08-15 D 窗開檔查證,`D-030-STOP`):
  - **經銷價在本 repo 是「另一個價格欄」,不是折扣**:
    `supabase/migrations/20260531142533_init_product_variants.sql:45` 逐字
    `price_store   integer,  -- 🔴 經銷敏感(view 永遠排除、僅 service_role)`
  - **而且已經有一個欄位是為了凍結「這單用哪個價」而存在的**:
    `20260604120000_m3_s2a_orders_order_items.sql:98` 逐字
    `tier_at_checkout    member_tier NOT NULL,  -- 結帳當下等級凍結(S2 恆 general、**定價階段才有 store**)`
  - ⇒ **照現有 schema 最順的實作是 `v_unit_price := price_store`**(tier = store 時),而那樣的話:
    ```
    subtotal       = 經銷價 × 數量   ← 已經是折後的
    discount_total = 0
    紙上「折扣」    = 0              ← 經銷商拿了折扣，紙上完全看不出來
    ```
  🔴 **⇒ 下一個做經銷價的人手上的 code,會把他推向與 Sean 意圖相反的那條路。**

- ⚠️ **本條目「不能」下的三個結論(原樣保留,它們就是這條的價值)**:
  1. **不能說「Sean 錯了」** —— 他講的是**報價單**的呈現方式,而報價單正本在 mac mini,**本 repo 驗不到**。
  2. **不能說「一定會做成 `price_store`」** —— 那是**還沒發生的決定**;
     能證明的只有「**schema 往那邊傾斜**」。
  3. **兩者可以並存**(報價單顯示折扣、網站存兩個價)—— **但沒有人明確決定的話,實作者會照 schema 走。**
  ⇒ **這條記的不是「該走哪條」,是「這裡有兩條路,而且它們不會自己收斂」。**
  🔴 **這是生意判斷,要 Sean 拍,不是工程師在實作當下順手決定的。**
- ⚠️ **「報價單那邊已經是這樣做的」這句是 Sean 說的,本 repo 無法驗證。**
  報價單正本在 mac mini(memory `reference_quote-repo-truth-moved-to-mac-mini`)⇒
  **做的人要自己去對報價單那邊的實際形狀,不要把這一條讀成「我們驗過了」。**
- 🔴 **為什麼要立這一條:repo 裡沒有任何地方寫著它。**
  現況查得到的只有「還沒做」,查不到「將來會做成什麼形狀」:
  - `supabase/migrations/20260604130000_m3_s2b1_create_order_rpc.sql:10` 逐字
    「① 不查 `customers.tier` 做價格分支 ② `unit_price` 恆取 `variant.price_general`」
  - 同檔 `:228` 逐字 `v_total := v_subtotal + v_shipping_fee;  -- discount_total Phase 1 = 0`
  ⇒ **`discount_total` 現在恆為 0,沒有任何路徑寫非 0。**
- ⚠️ **不寫它會怎樣(鐵則 10):**
  下一個做經銷價的人打開 code,只會看到「tier 分支被**刻意**排除」,
  **最自然的實作是「給經銷商不同的 `unit_price`」** —— 那條路 code 沒有擋,而且更好寫。
  🔴 **一旦那樣做,`discount_total` 永遠是 0,經銷優惠在出貨單、對帳、報價單三邊都對不起來。**
- 🔴 **而且回頭補不了 —— 這句有依據,不是形容詞:**
  - 金額四欄**只在 `create_order` 寫一次**;**之後沒有任何路徑改它們。**
    數法:`grep -rnE "\b(total|subtotal|discount_total|shipping_fee)\s*=" supabase/migrations/*.sql`
    → 濾掉 `CHECK`/`CONSTRAINT`/註解/`v_` 區域變數/`:=`/比較運算子後 **命中 7 筆,全部是比較**
    (`v_order.total = p_amount`、`o1.total = o2.total`)、**零賦值**;**分母 = 173 支 migration**。
  - 而 `20260604120000_m3_s2a_orders_order_items.sql:112` 的
    `CONSTRAINT orders_total_balances CHECK (total = subtotal + shipping_fee - discount_total)`
    ⇒ **想事後補 `discount_total`,就得同時改 `total`** —— 而 `total` 是**客人當初實際被收的錢**。
  ⇒ **不是「補一個欄位」,是「改一筆已經發生的收款紀錄」。**
- **已經依賴它的東西:** `#10` 片2b-2 出貨單結算區印「折扣」那一行。
  **Sean 要那一行的理由就是這個決定**,而**那張紙會寄給客人**。
- **相關:** `#390`(特價功能)/ `#215`(經銷價前置)/ `#47`(Phase 2 三層折扣疊加)
- **發現於:** 2026-08-15 · D 窗 · `#10` 片2b-2 查「折扣那一行恆為 0」時

---

### #516. 🖨️ 對外印刷品上的 `www.` 網址形式,會被未來的「網址一致性整理」掃掉

- **狀態:** ⏳ 待執行(**不是決策題** —— `Q-D-17` 已拍板出貨單印哪個形式)
- **分流:** P2
- **優先級:** 🟡 低(不會壞掉,但**壞的時候紙已經寄出去了**)
- **起因:** `Q-D-17` 拍板對外出貨單印 `www.pcmmotorsports.com`。
  **那是「對外顯示形式」,與 API base URL / email 網域是兩種東西 ——
  但在 repo 的字面層它們長得一模一樣,而 `www.` 形式是少數派。**
- **量法(綁 commit、只算追蹤檔,可重現):**
  ```
  git grep -hoE "(www\.)?pcmmotorsports\.com" HEAD -- . | sed 's/^HEAD://' | sort | uniq -c
  @ 5d10d372 ⇒  146  pcmmotorsports.com
                  7  www.pcmmotorsports.com
  正向對照:printf 'www.pcmmotorsports.com' | grep -coE "(www\.)?pcmmotorsports\.com" ⇒ 1（量具是活的）
  ```
  ⚠️ **這組數字與 E 窗同日回報的 `117 : 6` 不同。**
  **差異本身先記著,不要當成四捨五入**:最可能的原因是**測量時的樹狀態不同**
  (本窗在量之前剛 `git merge origin/dev`,快轉 84 顆)。
  🔴 **結論不受影響**(兩組都是 ~5% 的少數派),**但「幾比幾」這個數字只有綁 commit 才成立** ——
  **要引用請自己重跑上面那條,不要抄這裡的數。**
- 🔴 **為什麼這條會發生,而且會由「好人」觸發:**
  **未來任何一次「網址寫法不一致,統一一下」的清理,會把那幾處一起改掉。**
  **做清理的人會覺得自己在改善,不會意識到自己在改一張要寄給客人的紙。**
  **改完 typecheck 綠、測試綠、零守門會叫。**
- **不修未來會痛在哪(鐵則 10):**
  **已經寄到客人手上的紙,與之後印的紙網址形式不一致。而紙收不回來。**
- **修法(採甲;主視窗 2026-08-15 裁):** 在印刷元件那一行上方加註解。
  🔴 **措辭要寫給「未來做清理的那個人」看,不是寫給現在的我們看:**
  ```
  🔴 這是 Q-D-17 拍板的「對外顯示形式」，不是 API base URL。
     它在 repo 裡是少數派 —— 那是刻意的，不是漏改。
     為「一致性」把它改掉 ⇒ 已經寄到客人手上的紙會與新印的不一致。
  ```
  **理由(主視窗補):「不要改它」擋不住一個正在做全域統一的人 —— 他要知道的是「改了會怎樣」。**
- 🔴 **本條的守門是【一句話】,不是機制 —— 不要讀成已經有東西擋著。**
  **乙案(加一格守門釘住那個字面)已評估後不採**:
  **釘 repo 字面的守門擋得住「有人改了字」,擋不住「那個形式本來就選錯」。**
  **兩者是不同的事,不要用一個假裝解決另一個。**
- **相關:** `#10` 片2b-2(對外出貨單抬頭)
- **發現於:** 2026-08-15 · E 窗(專職審查)審 `#10` 片2b-2 plan 時量出比例;D 窗複驗後落檔

### #519. 🔴🔴 訂單列表有一段「死區」:欄位全放出來了但放不下,而員工的螢幕整段落在裡面

- **狀態:** ⏳ 待執行(**是決策題** —— 四個正解形狀代價不同,見下)
- **分流:** P1
- **優先級:** 🔴 高(**員工看不到「金額」與「操作」按鈕,而畫面零提示**)
- **起因(兩個獨立來源,方法不同):**
  C 窗從 `globals.css` 欄寬累加算出總寬 **1412**;主視窗在真站(登入瀏覽器)實測 `table` 寬 **1412** ——
  **兩邊逐字相同,而方法互相獨立(CSS 靜態推算 vs 瀏覽器 computed 值)。**
- **量法(真站實測,可重跑):**
  ```
  容器 = 視窗 − 144(側欄 SIDEBAR_WIDTH='9rem') − 48(p-6) − 2(邊框) = 視窗 − 194
  ⇒ 五筆逐字命中,零例外:1024→830 / 1280→1086 / 1440→1246 / 1600→1406 / 1920→1726

  視窗   容器   欄數  表格寬  藏
  1024    830    8     830     0    ✅ 健康窄版(看得到「金額」與「操作」)
  1280   1086   14    1412   326    🔴 看不到 金額/客戶/狀態/發票/操作
  1440   1246   14    1412   166    🔴 看不到 狀態/發票/操作
  1600   1406   14    1412     6    🔴 差 6px
  1920   1726   14    1726     0    ✅
  ```
  🔴 **`document.scrollWidth == clientWidth` 在全部寬度皆成立 ⇒ 頁面本身沒有橫捲軸、畫面零提示。**
- 🔴 **病灶(這不是「表太寬」):**
  `globals.css:514-532` 6 欄基底 `display:none`,`@container (min-width: 900px)` 才放出來;
  `globals.css:270` `table-layout: fixed` + 14 欄全固定 px ⇒ 總寬**恆為 1412、不會縮**。
  ⇒ **「什麼時候放欄位」設在 900,「放出來要多少」是 1412 ⇒ 死區 [900, 1412),寬 512px。**
  **在容器剛好 900 的那一刻,它一次放出 646px 的欄位,而它只有 900 可用。**
- 🔴🔴 **900 不是拍腦袋定的 —— 它當時是對的,是表格後來長大把它推出有效範圍:**
  `90febbf4`(L3 片3)引進 900 時,commit body 記 14 欄總寬 **1362**、容器 1414 ⇒ 零溢位。
  片5 把總寬抬到 **1412**(`globals.css:166` 逐字列出 14 個加項、`:174` 逐字「刻意吃掉原本 50px 的鬆弛」)。
  ⇒ **沒有任何人犯錯,而東西壞了。這種缺陷沒有作者,所以沒有人會回來看它。**
- 🔴 **給讀者的反直覺結論(給非工程師看的一句):**
  **在 1024 的小筆電看得到「金額」和「操作」;換到 1280 就不見了。而 1280 是更大的螢幕。**
  ⇒ **問題不是螢幕太小,是螢幕變大時系統做了錯的決定。**
- **四個正解形狀(只列不挑,代價已查):**
  | | 做法 | 代價 |
  |---|---|---|
  | 甲 | 門檻 900 → 1412 | 死區消失,但 900–1412 之間**現在看得到的 6 欄會消失**;Sean 2026-08-14 看畫面後**親自要求要看得到**過一次(`globals.css:167`) |
  | 乙 | 分段釋放(900 放幾欄、1200 再放幾欄) | 死區縮小;**要新拍板「每段放哪幾欄」**——現行 6 欄清單是 Sean 逐字定的(`:509-511`) |
  | 丙 | 死區內保留橫捲但**加可見提示** | 不解根因,零欄位風險;現況是**完全沒有訊號** |
  | 丁 | 降總寬(從欄扣) | 🔴 **已登記為不可行**:`globals.css:352` 逐字「品名現在是全表最緊的一欄,**任何新增欄位都不得再從這裡扣**」 |
- **不修未來會痛在哪(鐵則 10):**
  **員工在 Air 13 上看不到金額,會切去別的畫面查;看不到「操作」欄會以為那張單不能操作。**
  **而這兩件都不會產生任何錯誤訊息 —— 他只會覺得系統很難用,不會回報成 bug。**
- 🔴 **OD 改版後還成不成立:取決於 OD 範圍,未定(C 窗判不出、不猜)。**
  但兩件對誰做都成立:**①會被吸收的是「900 這個數字」;②不會被吸收的是「釋放門檻要與釋放後的總寬對齊」那條約束** ——
  重畫一張表照樣要回答它。**③6 欄收哪些是 Sean 逐字定的內容決策(`:509-511` 引 OD `:129-131`),不是版面副產品,重畫時要帶著走。**
- **相關:** `#520`(同一張表的 sticky 表頭)/ OD 後台視覺線(B 窗)
- **發現於:** 2026-08-15 夜 · 主視窗真站實測 + C 窗 CSS 推算,兩法獨立而一致

### #520. sticky 表頭會蓋住捲到接近頂端的可點元素 —— 在那個位置是「必定」點不到,不是「可能」

- **狀態:** ⏳ 待執行(不是決策題)
- **分流:** P2
- **優先級:** 🟡 中
- **量法(真瀏覽器,B 窗實測):**
  ```
  box.click()                        false → true    ⇒ 元素本身正常
  document.elementFromPoint(cx, cy) ⇒ DIV.hint       ⇒ 命中的不是那個 checkbox
  rect.top = 51                                      ⇒ 卡在 sticky 表頭底下
  scrollIntoView 之後再量           ⇒ INPUT          ⇒ 是它自己（正向對照）
  ```
- 🔴 **不要寫成「快速捲動時可能點不到」** —— 上面已經量到在那個捲動位置**必定**命中錯的元素。
  **降級成「可能」會讓下一個人以為這是偶發 flake,而它是確定性的。**
- 🔴 **這條的發現過程本身是教訓:** B 窗的工具兩次回 `Successfully clicked`,而勾選狀態始終 `false`,
  它**差點把這寫成產品 bug 送出退稿報告**。⇒ memory `feedback_verify-the-result-not-that-the-action-ran` 第五個動作。
- **不修未來會痛在哪:** 員工在該捲動位置點不到勾選框,會**重複點**;而每次點擊都「成功」,沒有任何錯誤。
- **相關:** `#519`(同一張表)
- **發現於:** 2026-08-15 夜 · B 窗自核 OD 商品畫面時,以 chrome-devtools 真瀏覽器量出

### #521. ⚠️ **2026-08-16 收窄(A 窗實查)** · 真瀏覽器守門的觸發面 —— **零觸發的只有 2 支,不是「playwright 測試不會被跑到」**

> 🔴 **原標題與內文把兩個家族當成同一件,而它們命運完全不同**(A 窗附分母):
> ```
> .spec.ts 共 3 支（storefront e2e ×2、e2e-prod ×1）
> 另有 3 支【不是 .spec 但用 playwright 函式庫】的 admin 測試 → 走 vitest ⇒ 🔴 有在跑
>          實跑：3 passed / 23 tests ⇒ CI 裝 chromium 不是浪費，就是給它們用的
> pnpm test = vitest run，而 vitest.config.ts:45,51 【刻意排除】 **/e2e/** 與 **/e2e-prod/**
>          註解清楚（含 #288-a：**/e2e/** 不匹配 e2e-prod 這個 segment）⇒ 不是漏掉，是設計
> 觸發面掃 .github/.husky/package.json：'test:e2e' ⇒ 1 命中（e2e-prod.yml:77）
>          'playwright test' ⇒ 0 ／ 'e2e/' ⇒ 0
> ```
> ⇒ **6 支相關檔案裡,零觸發的只有 2 支**:`e2e/account-guard` 與 `e2e/home`。
>
> 🔴🔴 **而收窄之後後果反而更清楚**:
> **`account-guard.spec.ts` 是 storefront 【唯一】自動驗證「未登入不能進 `/account`」的東西,而沒有人跑它**
> ⇒ **那道守門壞了,不會有任何東西紅。**
>
> **⚠️ 不能直接掛 CI(A 窗判,理由成立)**:它要 `next dev`(`playwright.config.ts:27-29` 的 webServer)
> **且要 Supabase 憑證才不會在 server 就炸** ⇒ **CI 要拿到 storefront 的 env = secret 面 = Sean 的停點。**
> **且掛上去前要先在有 env 的地方確認那 2 支現在是綠的** —— 否則第一天就紅,**而那會變成「大家學會忽略的紅」。**
> ⇒ **兩步**:①先在有 env 的環境跑一次確認綠 ②綠了再談掛 CI(要 Sean 拍 env)。
>
> ⚠️ **A 窗另外自標一句,照留不放大**:它把孤兒測試跑起來時 `account-guard` 紅了,
> **查證是它的 worktree 沒有 `.env.local`(只驗存在、沒看內容)⇒ 那頁在 server 就炸、沒走到 redirect。**
> 🔴 **它明說:「我證的是【我的紅是環境造成的】,我【沒有】證【正式站那道守門是好的】。」**
> **不要把這條讀成 storefront 權限沒問題。**

> ✅ **2026-08-16 I 窗:第①步【已完成】—— 在有 env 的主樹跑起來了,而且是綠的,而且紅得起來。**
> ```
> 正向  pnpm --filter @pcm/storefront exec playwright test e2e/account-guard.spec.ts
>       => EXIT=0 / 1 passed (4.9s)
> 負向  把 account/page.tsx:54 的 redirect 註解掉(cp 備份、非 git checkout)
>       => EXIT=1,且紅在【對的那一格】:
>          toHaveURL failed — unexpected value "http://localhost:3100/account"
>       (不是意外崩掉的紅 —— 它斷言的就是「沒有導向」這件事)
> 還原  cp 回存 + shasum -a 256 -c 逐字 OK + git status 空 + 突變字串 0 命中
> ```
> 🔴 **A 窗那次紅【確認是環境造成的】,不是防護破了** —— 差別就是 `.env.local`:
> 主樹有(`test -e` 過、`2803` bytes,未讀內容),A 窗的 worktree 沒有。**它的自我判斷是對的。**
>
> ⚠️ **三條誠實邊界(不要放大這個綠)**:
> ① 這證的是**本機對真 Supabase** 的行為,**不證正式站**(env 與部署都不同)。
> ② 突變只做了**一種**:整條 redirect 拿掉。**沒測**「`getUser()` 被換成可偽造的 `getSession()`」
>    —— 而那正是 `page.tsx:10-11` 註解點名的風險。**未登入時兩者都回 null ⇒ 這格很可能分不出來(未測,推論)。**
> ③ 它仍然**零觸發** —— 跑起來是因為**我手動跑**,不是因為有東西會叫它。**第②步(掛 CI)未做。**

**(以下為原始條目,保留不改)**

- **狀態:** ⏳ 待執行(不是決策題)
- **分流:** P2
- **優先級:** 🟡 中(**它是一格恆綠格,而我們以為它在守**)
- **起因(C 窗實測,兩層):**
  ```
  第一次跑 ⇒ 11 skipped、suite 層炸:chromium_headless_shell-1223 執行檔不存在
  修它又踩一層:pnpm exec playwright install 在【根】解析到 1.59.0(裝 1217)
               而測試實際用 apps/admin 的 1.60.0(要 1223)⇒ 裝完照樣跑不起來
  正解 = 在 apps/admin 底下裝
  ```
- 🔴 **C 窗是看到 `1217 ≠ 1223` 才發現的** —— 兩個版本號差 6,而症狀是「skipped」。
- 🔴 **為什麼這條要修(不是潔癖):** 一支「換機器就跑不起來、而且失敗長得像 skip」的守門 = **恆綠格**。
  它存在會讓人以為那一面被守著。**「檔案在」不等於「守門有效」**(memory `feedback_warning-carrier-must-outlive-what-it-warns-about`)。
- **修法(未定,兩個方向):** 進 CI / 加前置腳本檢查版本一致。**主視窗裁「要做」,做法未定。**
- **不修未來會痛在哪:** 下一個改訂單列表版面的人,會相信一格從來沒跑過的守門。
- **發現於:** 2026-08-15 夜 · C 窗量 iPhone 390/393 時撞到

### #522. ✅ **已修(2026-08-16;軸 = A 窗 `02dd510e`,小字 = C 窗同日續章)** · 貨品軸與它的解釋小字**都不扣已取消數量**

> 🔴🔴 **本條在 2026-08-16 白天被標成 ✅ 時,標題講的兩半【只修好一半】** ——
> `02dd510e` 修的是**軸**(SQL + TS `goodsAxisOfLines`),**解釋小字那半原封不動**。
> **而這不是誰漏看**:兩半當時**分屬兩條分支**,在任何一條線上都看不到對方
> ⇒ 直到收割把它們併在一起,「軸扣了、小字沒扣」才第一次同時存在。
> ⚠️ **關閉條目時要對的是【標題涵蓋的範圍】,不是【那顆 commit 做了什麼】** ——
> 這兩者在本條上差了一半,而 ✅ 讓它看起來已經整條結清。
>
> ✅ **小字那半 2026-08-16 傍晚由 C 窗補完**(`order-status-axes.ts` `lineNeed()`,軸與小字共用同一個分母)。
>
> 🔴 **守門盤點(撤銷本條 ⇒ 全套 500 檔 9 紅 / 3 檔,重跑過的數字)**:
> | 檔 | 紅幾格 | 誰加的 |
> |---|---:|---|
> | `goods-axis-cases.test.ts` | 5 | A 窗 `02dd510e` 的真值表 ⇒ **軸那半一直有守門** |
> | `order-status-axes.test.ts` | 3 | 本次補 |
> | `refund-wiring.test.tsx` | 1 | 本次補(頁級,員工真的看得到的字) |
> ⇒ **軸有守門、小字零守門** —— 補的是小字那半,以及一格「分子不得大於分母」的迴歸格。
>
> ⚠️⚠️ **本段第一版寫「repo 零守門」,是錯的,更正留著**:當時撤銷本條之後**只跑了一支檔**、
> 拿到「42 格零紅」就外推成整個 repo。**「本檔 42 格零紅」是真的;「repo 零守門」是我沒跑過的範圍。**
> 🔴 **兩者的輸出長得一模一樣(都只是一個數字)** —— 分母寫在命令裡,不寫在結論裡就分不出來。
> 📎 codex 對抗審查第二輪抓到的(它是靠 `goods-axis-cases.json` 的存在反駁我,不是靠推理)。
>
> ✅ **關閉紀錄**:A 窗實跑證成立,**而比本條原文嚴重一級** ——
> 不是「數字少扣」,是**判定用錯分母**:分母用 `quantity`,而 `ordered_quantity` 有守門
> `SUM(allocated) ≤ quantity − SUM(cancelled)`(`20260803130000:164`)⇒ **只要有取消,數學上到不了**
> ⇒ **任何部分取消的單,貨品軸恆為「未訂購」** ⇒ 員工會去重新採購一批已經出貨的東西(實體動作)。
>
> 🔴🔴 **上面這兩行是【全稱句,而它不成立】——2026-08-16 傍晚更正,原文刻意不刪**
> (codex 對抗審查舉反例,我開那支守門的 COMMENT 逐字查證後接受):
> 那條守門的 COMMENT 自己寫著「**只守 INSERT/調升/換 parent**」⇒ **它不守取消**。
> ⇒ **先訂滿 6、再取消 3**,會留下 `ordered 6 > quantity − cancelled = 3`,
> 舊分母 `quantity = 6` 之下 `6 >= 6` 成立 ⇒ **舊 code 在那條路上答 `ordered`,不是 `none`**。
> ⇒ **正確講法**:錯的是**分母**;`none` 這個症狀只出現在「**先取消、再採購**」那條路上。
> ⚠️ **為什麼要更正它**:原文讀起來像「有取消就一定看得出來」,
> 而實際上**另一條路的單在螢幕上完全正常** —— **下一個人會照原文判斷「這張單沒事」。**
> **SQL(`20260814140000_…484a_view.sql:118/124/130`)與 TS(`order-status-axes.ts` `goodsAxisOfLines()`)兩邊同款錯。**
> **修法**:兩邊同片改 + **共用真值表 + 人寫期望值當第三方**(14 案 / 7 案含取消),突變各紅 5 案。
> 🔴 **原條目由主視窗從【畫面】猜的,不是從 code 量的** —— 症狀方向對、嚴重度低估一級。
> ⚠️ **`#499` 不因此關閉**:只綁上 2↔3(判定結果)。
> 🔴 **而「仍是人工比對」這個講法太輕(E 窗 2026-08-16 更正)** —— **正確講法是【零守門】**:
> `SupabaseOrderAdapter.test.ts:272-273` 是 `expect(ADMIN_ORDER_LIST_SELECT).toBe(<測試裡手寫字面>)`,
> **釘得很死、期望值也是人寫的,但它綁的是 TS ↔ TS —— 而真值在【資料庫】,資料庫沒有出現在那一格裡。**
> ⇒ **select 寫了資料庫沒有的欄(或漏一欄)⇒ 測試裡的手寫字面照抄同一個錯 ⇒ byte-equal 照樣通過。**
> 🔴 **那正是 08-07 那次正式站 8 小時事故的形狀**(無條件 SELECT 未 apply 的欄 ⇒ `42703`,而三綠全綠)。
> ⚠️ **「人工比對」讀起來像「有做,只是手動」;實際是沒有人在做,而那一格看起來很硬(byte-equal)。**
> 📎 衍生:`#532`(probe 沒有觸發器)、`#533`(互比只證一致不證對)。

**(以下為原始條目,保留不改)**

- **狀態:** ⏳ 待執行(不是決策題,但修法中鐵則 8)
- **分流:** P2
- **優先級:** 🟢 低(**正式庫目前構造不出來**,見量法)
- **起因:** `#514` 片與其解釋小字(`78974379`)都以 `quantity` 為分母,不減 `cancelled_quantity`。
  6 件裡 3 件取消 + 3 件已訂 ⇒ 軸仍 `none`(「未訂貨」)、小字「本單 6 件中已訂 3 件」。
  **小字忠實反映軸,但兩者一起偏。**
- **量法(主視窗 2026-08-15 夜親跑正式庫):**
  ```sql
  select count(*), coalesce(sum(cancelled_quantity),0)
    from order_item_quantity_summary where cancelled_quantity > 0;
  ⇒ 0 筆 / 0 件
  ```
  ⇒ **現況構造不出來,不是「已處理」。**
- 🔴 **為什麼當時刻意不修(C 窗判,主視窗同意):**
  讓小字自己扣掉取消 ⇒ 小字寫「3/3」配軸「未訂貨」= **修一個矛盾造出兩個**,
  **正好是 `#514` 那片在修的病。** 要修得**連軸一起改** ⇒ 動 `ORDER_GOODS_AXIS_VALUES` / `GOODS_AXIS_LABEL` /
  篩選 chip / adapter 下推 ⇒ **跨 3+ package,中鐵則 8。**
- **不修未來會痛在哪:** 第一張有取消品項的單出現時,員工會看到「未訂貨」並重新下單。
  **而那一天不會有任何東西紅。**
- **相關:** `#514`
- **發現於:** 2026-08-15 夜 · C 窗實作解釋小字時登記為已知限制

### #514. 🔴🔴 後台明細頁的「出貨狀態」永遠顯示「未訂購」——13/13 恆假,而它讀的是一個已停止維護的欄位

- 🔴 **這條最該被抄走的一句(放最前面,不是放在原因分析裡)**:
  > **「不得讀取本欄做判斷」這句話,對「把它 render 到畫面上」零約束力 —— 因為 render 不是判斷。**
  **下一個人想用註解擋人使用某個欄位時會照抄那句,而它擋不住。** 要擋就要有機制(型別移除 / 守門測試 / mapper 不映射)。

- **症狀(正式庫實測,2026-08-15 · 主視窗跑 · 唯讀)**:
  ```sql
  select fulfillment_status, count(*) from public.orders group by 1 order by 2 desc;
  ⇒ notOrdered  13   （只有這一列）
  ```
  🔴 **13 筆訂單、13 筆 `notOrdered`、零其他值** ⇒ **不是「新單才有問題」,是那格從來沒有正確過一次。**
  而正式庫裡有已出貨的單(貨品軸算得出來)⇒ **畫面與事實長期不符,且無任何訊號。**

- **事實鏈(每一環開檔查過)**:
  1. **欄位已死**:`20260729010000_m4b_e10_d0_display_id_expand.sql:87` COLUMN COMMENT 逐字
     「**E10 起停止維護、值為 legacy stale、不得當現況真相。Sean 2026-07-28 拍 Q1=B**…
     🔴 **任何新程式不得讀取本欄做判斷。**」
  2. **沒有 writer**:全 migrations 掃 `fulfillment_status` 的非註解命中 = 建型別 / 建欄(`DEFAULT 'notOrdered'`)/
     索引 / 舊 view 的 `CASE` / COMMENT。兩支寫入 RPC **明文排除**:
     `20260714130000:18`「**絕不含** … `fulfillment_status`」、`20260611120000:16`「零 `fulfillment_status`」。
  3. **但它被直送**:`packages/adapters/src/supabase/mappers/order.ts:180`(另 `:360` / `:706`)
     `fulfillmentStatus: row.fulfillment_status`。
  4. **而且畫在畫面上**:`apps/admin/src/components/orders/order-detail.tsx:368`
     `<Field label='出貨狀態' value={FULFILLMENT_STATUS_LABEL[detail.fulfillmentStatus]} />`;
     `apps/admin/src/components/customers/customer-detail-sections.tsx:82` 同型。

- 🔴 **這條的形狀(值得單獨記)**:同一條 COMMENT 逐字寫著
  > 「**措辭不得寫成『衍生顯示』—— 沒有 writer 在維護的欄位叫衍生顯示,會讓後人以為它跟得上真相。**」
  ⇒ **寫的人擔心的是「措辭被誤解」,實際發生的是「有人把它畫到畫面上」。**
  **他預測了誤解的方向,但沒預測到誤解會發生在哪一層。**

- **處置分兩件,刻意不混(主視窗 2026-08-15 裁定)**:
  - **短期**:那格從畫面拿掉,**或**改讀真相式(貨品軸 = `shipment_items JOIN shipments`,
    `20260806180000:17`)。~~⚠️ 排在 `#13` 片1 之後,不插隊。~~ **← 已作廢:C 窗先做了(見下)。**
  - **長期**:欄位本體怎麼處置(DROP?保留但從型別移除?)⇒ **碰 schema,要 Sean。**
  🔴 **兩件不要合成一片做** —— 短期是 UI 片,長期碰 schema 命中鐵則 12③。

- ### ✅🔴 **狀態:短期已修、長期未動 —— 【不得標為已解決】**(2026-08-15 更新)

  🔴 **為什麼不標已解決**:**欄位本體還在**,還是 `DEFAULT 'notOrdered'`,
  **`packages/adapters/.../mappers/order.ts:180` 的直送也還在**。
  標成已解決 ⇒ 下一個人會以為那個 stale 欄位已經被處理掉了,而它就在那裡等著被再引用一次。

  **短期那半由 C 窗完成**:commit `5e63de69`(`fix(admin): #514 — 出貨狀態改讀真相（明細頁）＋拿掉客戶頁那一欄`)。
  ⚠️ **本條目所在的分支(`void-readers`)沒有那顆 commit** —— 以下是我開 `git show 5e63de69` 逐條讀出來的,不是轉述。

  **🔴 兩個顯示點,而修法【不同】—— 理由不是「一致性沒做好」,是【手上有沒有真相】**:

  | 顯示點 | 修法 | 為什麼 |
  |---|---|---|
  | `apps/admin/src/components/orders/order-detail.tsx:368` | **改讀貨品軸真相**(`GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]`) | `AdminOrderDetail.items[]` **已經帶著三軸數量摘要** ⇒ **零新查詢**就算得出來 |
  | `apps/admin/src/components/customers/customer-detail-sections.tsx:82` | **整欄拿掉** | 那張表吃 `OrderListItem`,**只有 7 欄、零數量資料**;要補真相得改 `OrderListItem` 本身,**而它橫跨 12 個非測試檔**(storefront 會員頁 4 + admin 3 + `packages/ports` 共用契約)⇒ 中鐵則 8+12,不成比例 |

  🔴 **C 那句判別句值得抄走**:**「在沒有真相的地方硬留一格,只能留一個永遠錯的值。」**
  ⚠️ **文案一個字都沒變** —— `GOODS_AXIS_LABEL` 與 `FULFILLMENT_STATUS_LABEL` 字面逐字相同
  ⇒ **變的只有資料從哪來**。**⇒ 這也代表肉眼看不出改沒改,必須靠測試釘。**

  ✅ **`沒查的 ①` 已解**:兩個顯示點都經 C 實查並處置。
  ✅ **storefront 那兩處是【假警報】**:`orderStatusLabel(payment, _fulfillment)` **第二參數帶底線、根本沒讀**
  (A9f 已中和,`order-display.ts` 檔頭逐字寫著)⇒ **不是漏修,是本來就沒讀。**

  - 🔴🔴 **而 C 補了一層值得記進本條目的**(交辦只要求函式級,它自己判不夠):
    > **函式級測試證明 `orderDetailGoodsAxis()` 算得對 ⇒ 但不證明【畫面真的改讀了它】。**
    > **有人把那行改回舊來源,函式那族一格都不會紅。**
    ⇒ 它補了**頁級測試**,並用突變證明:改回舊來源 ⇒ **只有那格紅(1 failed / 58 passed)**。
    🔴 **判別句:「算得對」與「真的走那條路」是兩件事,而後者才是這種修法要證的。**
    ⚠️ 同型:`#13` 片1a 的 `create_order` 那三格,補的也正是「真的走那條路」。

- **不修未來會痛在哪**:
  - **bug 可追蹤性**:這格壞掉**沒有任何訊號** —— 它一直顯示一個合法的 enum 值,不是 `undefined`、不是空白。
    **發現它的唯一方式是有人剛好知道那張單已經出貨了。**
  - **可維護性**:`FULFILLMENT_STATUS_LABEL` 與那個 enum 都還在 ⇒ **下一個人會很自然地再引用一次。**
  - **擴充性**:`#13` 改單矩陣用的是**貨品軸**(真動作),而畫面上並排著一個**舊軸**
    ⇒ **員工會看到兩個講出貨的東西給出不同答案。**

- **⚠️ 沒查的**:~~①`customer-detail-sections.tsx:82` 那處的實際顯示未肉眼驗~~(**已解,見上方狀態段**)②`FULFILLMENT_STATUS_LABEL`
  是否還有第三個消費者未全樹掃 ③ 舊 view(`20260714120000:142-148` 的 `CASE`)是否仍被查詢。
- **相關**:`#13`(改單矩陣;`docs/specs/2026-08-15-e10-13-order-edit-matrix-order-level.md` §1-2 / §3-5)/
  電商後台調研 `~/pcm-mailbox/主-ALL-006` 概念 6、7(「改資料不等於改現實」的我方變體:**顯示的資料從來就不是現實**)
- **發現於**:2026-08-15 · A 窗 · 讀調研原文後回頭驗自己的矩陣軸時順帶查到(不是別人指出的)

### #515. 訂單 Log 只有一種,而它需要三種:系統事件 / 對客訊息 / 內部限定

- **來源**:電商後台調研 `~/pcm-mailbox/主-ALL-006` 概念 9(原文逐字):
  > **訂單 Log 分「系統自動事件」與「人工留言」,人工留言再分「客戶看得到」與「內部限定」。**
  > **缺了 → 一個 timeline 混著系統事件、內部吐槽、對客訊息,員工不敢寫真心話 ⇒ 有記錄但沒人敢用。**
- 🔴 **兩個窗獨立指到同一格**:B 窗(商品線)讀同一份原文後也點名這條,並轉給訂單線
  ⇒ **不是一個人的解讀。**
- **業界做法(原文第一節,官方文件級)**:
  - **WooCommerce** Order Notes:**系統自動事件紫色 / 私訊灰色**,與「給客戶看的訊息(**會寄信**)」明確分兩種顏色兩種語意
  - **Shopify**:訂單頁 Order timeline 分 **Fulfillment / Payment / Customer-initiated** 三類;
    另有店鋪級 Store Activity Log(含操作者身分,上限 250 筆)⇒ **訂單層與店鋪層是兩份不同的 log**
  - ⚠️ **蝦皮 / 露天**:原文明列**查無**官方文件描述「訂單修改歷程獨立頁面」⇒ **不得引用它們當依據**

- **我們的現況(未查完,見下)**:
  - `#27` 的**操作紀錄頁 2026-08-15 剛上線**,目前**只有一種**(稽核 `admin_audit_log`,系統事件性質)
  - **另有** `order_notes` 表,帶 `note_type` / `occurred_at` / `corrects_note_id`
    ⇒ 🔴 **可能已經有一半的形狀**
- 🔴 **第一個待查項**:**`order_notes.note_type` 的值域是什麼、它與 `admin_audit_log` 的關係是什麼。**
  **兩者是不是已經構成「系統事件 vs 人工留言」的分工?還是各做各的?**
  **這條沒查清楚之前,不要設計第三層(對客 vs 內部)** —— 可能只差一個旗標,也可能是兩套並行。

- **不修未來會痛在哪**:
  - **可維護性**:員工若不確定「這句話客人看不看得到」,**理性反應是不寫** ⇒ 系統有欄位、沒內容。
  - **bug 可追蹤性**:出事回頭查時,**分不出「系統做的」與「人寫的」** ⇒ 責任歸屬要靠人記憶。
  - **對外風險**:🔴 **最貴的一種是反過來** —— 內部備註若哪天被接到對客介面,**那是不可回收的外洩**。
    ⇒ **分類要在寫入時就決定,不是顯示時才過濾。**

- **⚠️ 沒查的**:①`order_notes` 現行有沒有任何「對客可見」的概念 ②操作紀錄頁與 `order_notes` 在 UI 上是不是兩個地方
  ③ 我們有沒有任何「會寄給客人」的訂單訊息路徑(M-4a Email 線的關係未查)
- **相關**:`#27`(操作紀錄頁)/ `#13`(改單;改單歷程要落在哪一種 log 是同一題)/ `#514`(同樣是「畫面上的東西不等於事實」族)
- **發現於**:2026-08-15 · 電商後台調研 · A 窗與 B 窗獨立各自指到

### #527. 🔴 已出貨的箱**改不了單號** —— 而 DB 明文說可以改,兩層意圖不一致

- **狀態:** ⏳ 待執行(**不是決策題** —— DB 那層已經表態過了)
- **分流:** P2
- **優先級:** 🟡 中(不會壞畫面,**壞的時候是資料層與意圖層各說各話,而沒有東西會叫**)
- **起因:** 2026-08-16 做「填單號並標記出貨」入口(`0d3dd154`)時發現。
- **兩層說的話不一樣:**
  - **DB 層說【可以改】** —— 凍結守門 X8
    (`supabase/migrations/20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:94-96` 逐字)
    凍結集**恰 3 欄**:`recipient_snapshot` / `carrier_code` / `carrier_note`,
    並明寫「**不凍結** `tracking_number`(**Q2=A 單號可改**)」。
  - **RPC 層說【不可以】** —— `admin_mark_shipment_shipped`
    (`supabase/migrations/20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql`)
    `:153` 已出貨直接 `RAISE`「已經寄出了…不需要再出一次」;
    `:184` `UPDATE … AND shipped_at IS NULL` 是 **write-once**。
  - ⇒ **全 repo 沒有任何一條路徑能改已出貨那箱的單號。**
- **量法(可重現):**
  ```bash
  grep -n "AND shipped_at IS NULL" supabase/migrations/20260807190000_*.sql   # ⇒ 1 行（:184）
  grep -n "不凍結" supabase/migrations/20260805170100_*.sql                     # ⇒ 2 行
  #    :96 是「不凍結 tracking_number（Q2=A 單號可改）」= 本條目引的那句
  #    另一行是同段的延伸說明 ⇒ 🔴 這條命令回 2，本條目講的是【其中一行】，不要抄成 1
  git grep -ln "p_tracking_number" -- supabase/migrations                     # ⇒ 4 檔（全是建/出貨路徑）
  ```
- 🔴 **不修未來會痛在哪(鐵則 10,這條是本條目的核心):**
  **員工從 UI 改不到,但直接動 DB 的人改得到** —— 而 **RPC 那層的 write-once
  是【唯一寫下「不該改」這個意圖】的地方**。
  ⇒ 哪天有人繞過 RPC 批次修單號(修資料、匯入、手動 SQL 救火),
  **沒有任何守門會叫** —— X8 不擋它,CHECK `shipments_shipped_needs_tracking` 也只要求「非空」。
  ⇒ 症狀會出現在**客人那一端**:他拿著紙上的舊單號去查,查到別的貨或查無。
- **現行唯一救濟:** 作廢重開新箱 —— 而**那會換箱號,已經印出去、跟著貨走的那張紙就白印了**。
- **要決定的(修之前先答,不要直接開工):**
  **意圖到底是哪一個?** ①單號可改(那要新 RPC + 對應守門)②單號寫死(那 X8 的註解要改掉,
  並補一條擋「繞過 RPC 直改」的守門)。**兩層的字面同時存在,就是還沒有人決定過。**
- **相關:** `#503`(收件快照可以全空,同樣是「寫入鏈沒有一層擋」)/ `#359`(建箱與掛品項非原子)
- **發現於:** 2026-08-16 · D 窗 · 做回填單號入口時開檔查 RPC 語意撞到

### #528. 🕐 `OPENING_HOURS.days` 三處硬寫 —— 加開一天,法律頁會變、畫面不會

- **狀態:** ⏳ 待執行
- **分流:** P2
- **優先級:** 🟡 中(**其中一個載體是法律頁**)
- **起因:** 2026-08-16 折 E 窗 R3 finding 時擴掃撞到(`2b67a547` 只修了**時段**那半)。
- **現況:**
  - **只有一處從 SSoT 推導星期** —— `apps/storefront/src/data/legal-content.ts:57`
    用 `[...OPENING_HOURS.days]` 產出「週一至週六」(推導邏輯在 `:40-66`,含英→中對照)。
  - **而「週一-週六」在【三個】顯示點硬寫**:
    `components/HomeFooter.tsx` / `components/ComingSoon.tsx` /
    🔴 `components/MobileMenu.tsx:73` —— **這支吃了【時段】卻沒吃【星期】**。
- **量法(可重現):**
  ```bash
  git grep -nE '週一[-–]週六' -- apps/storefront/src | grep -v '\.test\.'
  # ⇒ 6 行。🔴 6 不是「顯示點數」——【逐行分類】後才是:
  #    渲染 3:ComingSoon.tsx:199 / HomeFooter.tsx:138 / MobileMenu.tsx:73
  #    註解 3:ComingSoon.tsx:198,:217 / HomeFooter.tsx:135（2026-08-16 本窗自己寫的說明）
  git grep -n 'OPENING_HOURS\.days' -- apps/storefront/src/data/legal-content.ts
  # ⇒ 2 行,其中 :40 是註解、:57 `const days = [...OPENING_HOURS.days]` 才是推導本體
  printf '<p>週一-週六</p>' | grep -cE '週一[-–]週六'                        # 正向對照 ⇒ 1
  ```
  ⚠️ **上面兩條命令的輸出行數(6 / 2)都不等於本條目講的數字(3 / 1)** ——
  **差別是註解行。引用前照上面的分類自己走一遍,不要直接抄命令後面的數字。**
- 🔴 **不修未來會痛在哪(鐵則 10):**
  Sean 哪天加開週日 ⇒ **法律頁(服務條款正文)與 JSON-LD(餵搜尋引擎)會跟著變,
  三個顯示點不會** ⇒ **同一個站對營業日講兩種話,而其中一份有法律效力。**
  ⚠️ 而 `2b67a547` 新增的接線守門(`apps/storefront/src/lib/site-config-wiring.test.ts`)
  **只驗「有沒有取用 `opens`/`closes`/`days` 任一欄」** ⇒ **只吃時段、不吃星期的檔照樣通過**。
  **本條不修的話,那支守門會給人「已經接上了」的錯覺。**
- **為什麼沒有順手修:** 要共用得把 `legal-content.ts:40-66` 的英→中星期推導**抽成共用模組** ——
  那是重構,不是同一片的收尾(主視窗 2026-08-16 裁「另開一片」)。
- **同族未量項(一併記,不另開號):**
  🔴 **`STORE_ADDRESS` 的消費端側完全沒量過。** 2026-08-16 那輪盤點**只涵蓋 `OPENING_HOURS`**;
  地址有沒有同款「一處吃 SSoT、多處硬寫」的落差,**未知**。做本條時一併掃。
- **相關:** `#514`(畫面上的東西不等於事實)/ 2026-08-16 `2b67a547`(時段那半已修)
- **發現於:** 2026-08-16 · D 窗 · E 窗 R3 突變挖出時段問題後,擴掃字集時撞到星期這半

### #517. 🔢 改金額 RPC 沒有驗「整數」——TS 的 `number` 不保證整數,而 DB 參數是 `integer`

- **狀態:** ⏳ 待執行(`#13` 片1b 開工當下發現、**刻意不在 1b 修**)
- **分流:** P2
- **優先級:** 🟡 中(不會靜默算錯錢,但**失敗訊息會是技術碼**,員工看不懂)
- **起因:** `#13` 片1b codex 關卡2 R2 角度①(2026-08-15)。
  `admin_update_order_item_amount` 的 `p_unit_price` 在 DB 是 `integer`,
  RPC 只驗 **`IS NULL OR < 0`**(migration `20260815040000:361`)—— **沒有驗整數**。
  而應用層型別是 TypeScript 的 `number`,**它不保證整數**
  (`packages/domain/src/order/types.ts` 的 `AdminOrderItemAmountPatch.unitPrice`)。
- 🔴 **本片沒有實測、不宣稱**:非整數值(例 `10.5`)經 PostgREST 送進 `integer` 參數會被
  拒絕、四捨五入、還是截斷,**我沒測過**。⇒ 這是**誠實缺口**,不是「應該沒事」。
- **量法(可重現,落地時先跑這條再決定修法):**
  ```
  grep -n "p_unit_price IS NULL OR p_unit_price < 0" \
    supabase/migrations/20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql
  ⇒ :361（只有這一道;整支檔 grep -c "p_unit_price" 可看全部引用點）
  ```
- **不修未來會痛在哪:** 表單層若讓非整數進來,**最好的情況是拿到 PostgREST 的技術錯誤碼**
  (員工看到亂碼、不知道要改什麼);最壞的情況是被靜默轉換成另一個金額而**沒有任何一道閘會紅**
  —— 而這支 RPC 改的就是訂單金額。
- **歸屬:** `#13` **片1c 的輸入層責任**(表單解析 + server action)。
  🔴 片1b 只在 adapter docstring 寫了這個缺口 ⇒ 依 `feedback_writing-down-a-gap-is-not-closing-it`,
  **寫下來不算處置**,所以另立本條釘住。
- 🔴🔴 **2026-08-15 片1c-1 進度:入口已擋,而本條【仍未解】。**
  `apps/admin/src/lib/orders/amount-form.ts` 的 `parseNonNegativeInt` 擋掉非整數
  (`/^\d+$/` + `Number.isSafeInteger` + int4 上限;測試 `amount-form.test.ts` 有 13 格,
  含小數 / 負號 / 千分位 / 指數 / Unicode 數字 / 前後空白 / 30 位失精度)。
  ⇒ **那是「關掉那條路」,不是「答出 RPC 端會怎樣」。**
  本條問的是:**非整數真的送進 PostgREST 的 `integer` 參數會被拒絕、四捨五入還是截斷?**
  —— 換一個呼叫端(或以後有人繞過這支解析器)就會走到那條沒人量過的路。
  ⚠️ **不得因為表單層擋住了就標為已解。**

### #518. 🧱 RPC 呼叫契約直接吃「生成型別」,而生成型別每次重 gen 都會變形

> 🔴 **本條內含【兩個主題】,標題只講了第一個** ——
> ① **標題那件**:`.rpc()` 契約吃生成型別、`Required<>` 的三條失效路徑(全條目主軸);
> ② **RPC 錯誤在客戶端分不分得開**(下方「實測補充」那幾段)。
> ⚠️ **有人只憑編號來找,會找到第一個而以為那就是全部** ——
> 2026-08-15/16 整晚互相引「`#518` 逐字」時,講的其實是②。**引用時請指明是哪一個。**
> 📌 暫不切成兩條:②的結論會直接改變①要不要做、怎麼做(見②的 `DETAIL` 那段)。

- **狀態:** ⏳ 待執行(**設計題,不是 bug**;`#13` 片1b 沿用現行做法、未擴大範圍)
- **分流:** P2
- **優先級:** 🟡 中(現況會擋,但**擋的理由建立在一個每次 apply 都被重寫的檔上**)
- **起因:** `#13` 片1b codex 關卡2 **R3 換角度審查**(2026-08-15)。
  片1b 為了讓「呼叫端漏帶鍵」變編譯錯誤,寫了
  `const args: Required<Database['public']['Functions'][…]['Args']> = {…}`
  (`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`)。
  R3 逐字總評:**「應該換;`Required<>` 適合當局部防呆,不適合承擔需要反覆人工校正生成檔的長期 RPC 契約。」**
- **R3 指出的三種失效路徑(逐條,原文轉述):**
  1. `Required<>` **只約束建立當下**:`const rest = {...args}` 去掉某鍵、或 `delete` 之後再傳原物件,
     因為原始生成型別把該鍵列為 optional ⇒ **照樣編譯**。
  2. **重 gen 之後意義會變**:既有參數若由 required 改成 optional,`Required<>` 會把它**拉回必填**
     ⇒ **不會紅**,只是靜默遮住「DB 已允許省略」這件事。
     (反向是好的:RPC 新增一個 DEFAULT 參數 ⇒ `Required<>` 讓它變必填 ⇒ 現有物件 **TS2741 會紅**。)
  3. `any` / `as` / 關掉 `strictNullChecks` 一律穿透。
- ✅ **有一件本片實測、對現況有利,記下來免得被誤讀成全面失效:**
  模擬「重 gen 把第 ⑪ 處手動校正 `| null` 沖掉」⇒ `tsc` **真的紅**
  (`TS2322: Type 'string | null' is not assignable to type 'string'`)。
  🔴 原因是**呼叫端傳的是 `string | null`** ⇒ **這個呼叫點本身就是校正 ⑪ 的守門**。
  ⚠️ 這只對「呼叫端會傳 null」的校正成立,**其餘 26 處沒有這層保護**。
- **R3 建議的方向(未採用,留給本條):** adapter 自有的穩定 `CallArgs` 型別(明列所有必帶鍵與 `| null`)
  + 「`CallArgs` 與生成型別鍵集合完全相同」的**編譯期 drift assertion**;
  更強的版本再加 runtime `Object.hasOwn()` 檢查。
- **不修未來會痛在哪:** 每次 apply 後重 gen,**27 處手動校正靠人重貼**;
  漏貼的那一處**不一定會有東西紅**(只有「呼叫端傳 null」那種才紅)。
  這條沒做之前,「重貼對了沒」的唯一防線是人 + 一支非 repo 內的檢查腳本。
- **範圍警告:** 這條會影響**所有** `.rpc()` 呼叫點,不是只有訂單線 ⇒ **中鐵則 8**,要先提 plan。
- 🔴🔴 **2026-08-15 實測補充(主視窗對正式庫一次呼叫,走 PostgREST 不是 psql)**:
  「能不能在客戶端分辨 RPC 的錯誤」**現在有答案了 —— 可以。**
  回傳逐字:`HTTP 400` +
  `{"code":"P0001","details":null,"hint":null,"message":"admin_update_order_item_amount: 訂單不存在"}`
  ⇒ **`code` 與完整的中文 `message` 都會抵達客戶端。**
  ⚠️ ~~**但只證了一半**:…**「`USING ERRCODE='P2C13'` 會不會逐字出現在 `code`」仍未實測** ——
  要觸發帶 ERRCODE 的那 7 條得用**一張真訂單**,風險等級不同。~~
  🔴🔴 **← 2026-08-16 兩句都作廢,見下方「已實測」。**
  ⚠️ **第二句尤其要記著怎麼錯的**:它寫「**得用一張真訂單**」而 E 窗**用拋棄式 PG 就測完了**
  ⇒ **那是「構造不出來」的又一例** —— 我把「要那個環境的**狀態**」與「只要那個引擎的**行為**」搞混了。
  (house 判別刀:問「要**狀態**還是要**行為**?」後者幾乎都測得出。)

- ✅ **2026-08-16 E 窗實測(拋棄式 PG + PostgREST,零真訂單、零寫入)——上面那兩句的答案**:
  - **`P2C13` 逐字出現在 `code`。**
  - 🔴 **`constraint` 欄【永遠不會】出現** —— 兩層獨立確認,**不是「這次剛好沒出現」**:
    ① PostgREST 的 error body 只有 `code` / `details` / `hint` / `message` **四鍵**,
       而**有宣告 `CONSTRAINT` 與沒宣告的兩發,鍵集完全相同**;
    ② `postgrest-js` 的型別只宣告三鍵,而它是 `JSON.parse(body)` **原樣搬、零轉換**。
    ⇒ **「拿 `constraint` 分派」這條路是死的,不要再去試。**
  - ✅ **`DETAIL` / `HINT` 逐字到得了客戶端** ⇒ **解鎖形狀 = 七條 `RAISE` 各加一行
    `DETAIL='<同名字串>'`,應用層以 `error.details` 分派。**
    ⚠️ **那要動 migration ⇒ 鐵則 12③ ⇒ 另一片。**
  - ⚠️ **E 窗自標兩條誠實邊界(不得省略)**:
    ①**正式站 Supabase 的 PostgREST 版本沒查** ⇒ 上線前對正式站打一次同款 probe;
    ②**`DETAIL` 過長 / 換行 / 非 ASCII 會不會被截斷或轉義沒測** —— 只證了純 ASCII 短字串。

- 🔴🔴 **而分不分得開之外,還有一件更難的:【事後也沒有人查得出是哪一條】**(R3/fable F4)
  - `amount-actions.ts` 的 catch **只記 `{ code, request_id }`**;
  - `constraint` 過不了 PostgREST(見上);
  - `message` **刻意不記**(它會內插員工打的原因字串 —— 那個決定是對的,不要為了診斷把它加回去);
  - 🔴 **`admin_audit_log` 隨交易回滾** ⇒ 失敗的那一次**在稽核表裡不存在**。
  ⇒ **主管接到員工求助時,server log 上只有一個 `P2C13`。**
  唯一出路是去翻 Supabase 的 Postgres log 靠時間戳對 —— **保留期短,而且沒有人把它寫進任何 runbook。**
  - **不修未來會痛在哪**:員工說「改不了」,而**沒有人查得出為什麼** ⇒ 只能靠猜或請他重現一次。
  - ⚠️ **`DETAIL` 那條解鎖形狀順便解掉這一件**(`details` 會進 error 物件 ⇒ 可以記進 log)
    ⇒ **兩件事同一個修法,不要各做各的。**
  ✅ 連帶量到:那條路**零寫入**(呼叫前後 `orders` / `order_items` / `admin_audit_log`
  三張表的 `count` 與 `max` 逐字相同)—— 從「讀 code 推的」變成「量到的」。
  ⚠️ 本條的三條 `Required<>` 失效路徑**不受影響**,那是另一件事。

### #523. 🧮 `database.types.ts` 手動校正處數**沒有第二個來源** —— 驗它的腳本與它同源

- **狀態:** ⏳ 待執行(2026-08-15 E 窗審 `433bcf26` 判 must-fix;A 窗實測後**確認成立**)
- **分流:** P2
- **優先級:** 🟡 中(不會立刻壞,但**壞的時候四綠全綠**)
- **起因:** 檔頭 `:2` 自稱「計數的唯一權威」,而**驗證用的期望值也是讀那一行** ⇒ 兩個載體不會互相反駁。
  - 第 28 處校正若從來沒被寫進檔頭 ⇒ 檔頭不知道、腳本也不會去找它 ⇒ **一起說 OK**。
  - 有人拿掉一處**並且**把檔頭改小 ⇒ 照樣全綠。
  - 🔴 E 的判別句逐字:**「負向對照證的是【偵測力】,不是【分母正確】。」**
- **E 提的方向(從 migration 推分母)⇒ A 窗實測【不可行】,逐條量過(可重跑):**
  ```
  cd supabase/migrations
  grep -rhoE "p_[a-z_]+ +[a-z ]*(text|integer|uuid|jsonb|boolean|numeric)[a-z\[\] ]* +DEFAULT NULL" *.sql \
    | awk '{print $1}' | sort -u        ⇒ 15 個名（E 原式）
  加上 timestamptz/int/date/bigint… 再掃 ⇒ 19 個名（字集一放寬就多 4 個：p_from p_to p_new_since p_transaction_time_millis）
  與「被校正的 26 個去重參數名」取交集 ⇒ 6；只在校正側 ⇒ 20；只在掃描側 ⇒ 13
  ```
  - **掃不到那 20 個**:①-⑧ 是「**必填但可為 null**」—— 簽章**沒有** DEFAULT,
    補不補取決於**函式體是不是 fail-closed 拒 NULL**。**那不是簽章的性質。**
  - **多出的 13 個是誤報候選**:有 `DEFAULT NULL` 但**不該補**(補了會讓非法呼叫變合法;
    檔頭 ⑩ 逐字「p_limit 不補:呼叫端一律帶值,沒有送 null 的路徑」)。
  - 🔴 **鍵就不對**:掃出來是**裸參數名**,而校正的單位是 **(函式, 參數)**。
    實例:`p_from`/`p_to` 的命中來自 `admin_today_payment_total`,**不是**被校正的 `admin_search_orders`。
  - 🔴 **repo 不是那個世界的權威**:⑨⑩ 的 DEFAULT 值檔頭逐字寫「**正式站實查**」
    ⇒ 拿 migrations 當分母是**量錯世界**。
- **做得到的那半(本條真正要做的):** **不是算出正確處數,是「有新候選出現時讓某格紅」** ——
  對 **(函式, 參數)** 鍵、只涵蓋 `DEFAULT NULL` 那一族,新出現而不在檔頭清單裡 ⇒ **紅,要人去判**。
  🔴 **它涵蓋不到 ①-⑧,而那個限度必須寫在守門旁邊** —— 否則下一個人會以為「有守門 ⇒ 都被涵蓋了」。
- **不修未來會痛在哪:** 每次 apply 後重 gen,漏貼一處**不一定有東西紅**
  (只有「呼叫端會傳 null」那種才紅,見 `#518`);而漏的那一處會在**呼叫端第一次送 null** 時才爆,
  通常是另一條線的人在改別的東西時撞到。
- **與 `#518` 的分界(別折在一起):** `#518` = 呼叫端契約吃生成型別;
  本條 = **生成型別自己的校正清單沒有外部分母**。E 逐字提醒「折進 #518 就算處理掉 = 本檔母題的又一例」。

### #524. 🔴🔴 turbo 的 `typecheck` 沒有 `inputs` ⇒ 改根層設定會 replay 出假綠,而「三綠」抓不到

- **狀態:** ⏳ 待執行(**只立案,不在本條修** —— 修法動 `turbo.json` = **鐵則 12④ 平台設定** ⇒ 要 plan + Sean 批)
- **分流:** P1
- **優先級:** 🔴🔴 高(2026-08-16 升級:**三個 task 全中** —— 不是「typecheck 可能騙人」,是**整組三綠都可能騙人**)
- **起因:** 2026-08-16 A 窗追 `typecheck 3 vs 2` 時構造出來的(見 `~/pcm-mailbox/A-47-STOP.md` / `A-48-STOP.md`)。

#### 成因 —— 🔴 **分兩句寫:機制句 + 清單句。不要寫成「所有根層檔都盲」**

**機制句(E 窗 2026-08-16 用 `--dry=json` 直接印出來的結構性證據)**:
```bash
npx turbo run typecheck --dry=json --filter=@pcm/admin
#   globalCacheInputs.files ⇒ {}（長度 0）
#   其餘鍵 ⇒ rootKey / hashOfExternalDependencies / hashOfInternalDependencies
#            / environmentVariables / engines
```
> **turbo 的全域雜湊【不吃檔案,吃它自己解析出來的四個欄位】** ——
> `engines` / 外部依賴圖 / 內部依賴圖 / 環境變數。
> ⇒ **一個根層檔會不會被偵測到,不取決於它是不是根層檔,取決於它的內容有沒有落進那四個欄位。**

而各 task 的 input 集合 = **該 package 目錄內的檔**
(`grep -n "globalDependencies\|inputs" turbo.json` ⇒ **零命中**,三個 task 都沒設)。
⇒ **兩邊都沒接到根層設定檔。**

**清單句(逐檔實測,baseline `@pcm/admin#typecheck` hash `4392b41c0b782586`)**:

| 根層檔 | 進 hash? | 證據 |
|---|---|---|
| `tsconfig.base.json` | ❌ **已證盲** | typecheck / lint / build 三個 hash 全不變 |
| `tsconfig.scripts.json` | ❌ **已證盲** | hash 不變 |
| `eslint.config.js` | ❌ **已證盲** | hash 不變 |
| `vitest.config.ts` | ❌ **已證盲** | hash 不變 |
| `pnpm-workspace.yaml` | ❌ **已證盲** | hash 不變 |
| **`package.json` 的 `engines.node`** | ✅ **已證非盲** | `>=22.0.0`→`>=22.1.0` ⇒ hash 變 `0b14c202b0b30eb2` 🔴 **反例** |
| `pnpm-lock.yaml` | ⚠️ **未確認** | E 加的是 YAML 註解,而該欄位從**解析後的依賴圖**算 ⇒ **那一發本來就不可能讓它變**。🔴 **這是「沒量到」,不是「它是盲的」** |
| `turbo.json` | ⚠️ **未測** | 主視窗禁令,沒人量過。🔴 **不要把「未測」讀成「盲」** |

🔴🔴 **為什麼要拆成機制句 + 清單句(E 窗的判準,原封收)**:
> **一個【有反例的全稱句】比一個範圍小但準確的句子傷害大得多** ——
> 下一個人會拿它去推論別的根層檔,而那個推論會錯。

📌 **E 自曝**:它帶著「所有根層檔都盲」的預期去量,**量到第六發才被 `engines` 打臉;前五發全部符合預期。**
⚠️ **沒去量的話,那句全稱會以「E 窗獨立複驗過」的外觀進本條目。**

#### 這一片為什麼是 typecheck / lint / build 一起中

`apps/admin/tsconfig.json:2` 逐字 `"extends": "../../tsconfig.base.json"`;
`apps/admin/package.json` 的 lint script 逐字 `eslint . --max-warnings 0 --no-error-on-unmatched-pattern`
⇒ 往上找到根層唯一那份 `eslint.config.js`
(分母 `find . -maxdepth 3 -name "eslint.config.*" -not -path "*/node_modules/*"` ⇒ **1 份**)。
⇒ **它們決定那三個 task 判什麼,而它們都在已證盲的清單裡。**

🔴 **`vitest.config.ts` 也在已證盲那五個裡** —— 但 **`pnpm vitest run` 不走 turbo**
⇒ **它「盲」的意義與前三個不同**(沒有 replay 機制在騙人,只是那份設定不影響 turbo 的 hash)。
**本條目不把它算進「三綠假綠」那一族**,列在這裡是因為下一個人會問。

#### 實錘(2026-08-16,`cp` 備份 + 還原後 shasum 逐字相同 `a9936413…`)

在 `tsconfig.base.json` 加 `noUnusedLocals` / `noUnusedParameters`,**同一刻、同一棵樹**:

| 路徑 | exit | `error TS` 行數 | 逐包那行 |
|---|---|---|---|
| `npx tsc --noEmit -p apps/admin/tsconfig.json` | **2** | **13** | (無 turbo) |
| `turbo run typecheck` | — | **0** | 🔴 `@pcm/admin:typecheck: cache hit, replaying logs 53dad03f9cff3b70` |

🔴 **那個 hash 與「乾淨綠樹」那次完全相同** ⇒ **replay 了綠,而此刻真的紅 13 條。**
🔴 **八個包全部 cache hit**,turbo 印 `Tasks: 8 successful, 8 total` / `Cached: 8 cached, 8 total`。

#### 🔴 第二層:`pnpm typecheck` 的後半 —— **結構性 vs 運氣**

`package.json` 逐字:`"typecheck": "turbo run typecheck && tsc -p tsconfig.scripts.json --noEmit"`

⚠️ **本條目第一版把這裡的理由寫錯了(2026-08-16 E 窗更正)**:
原文寫「`include` 逐字 `["scripts/*.ts"]` ⇒ **由設定本身可證** `apps/admin` 抓不到」。
🔴 **實際覆蓋 = `include` 的檔 ＋ 它們 import 到的傳遞閉包** ——
實錘:那次突變下第二段的 3 個錯,**有 2 個在 `packages/ports/src/IOrderRepository.ts`,不在 `scripts/` 底下**。

**正確的說法(兩層要分開講)**:
- 🔴 **第一層(turbo)失效是【結構性】的** —— 根層設定檔不在 hash 裡(見上方清單),**必定 replay**。
- ⚠️ **第二層會不會救你是【看運氣】的** —— 取決於那個根層改動有沒有**剛好**弄紅
  「`scripts/` 的 import 傳遞閉包」。
  **2026-08-16 那次救到我們的是巧合**(`noUnusedLocals` 剛好也打到 ports);
  換一個**只影響 JSX / React 的根層改動**(`scripts/` 是 node、無 JSX)⇒ **整條全綠。**

🔴 **⇒ 「看運氣的第二層」不得當防線寫進任何驗收條件。**
⚠️ 而 `lint` / `build` 的第二段更弱:`pnpm lint` 的後半只掃 `scripts/*.ts`、`pnpm build` **沒有後半**
⇒ 2026-08-16 那兩發**實測就是 exit 0 全綠**。

#### 三條判準(現在就可以用,不必等本條修好)

⚠️ **這三條對 `typecheck` / `lint` / `build` 一體適用**(2026-08-16 三個都構造過)。

1. `Cached: N/M` **總結行零判別力** —— 它在「真跑」與「replay」下完全相同。
2. **`Tasks: N successful` 也可能整排是 replay。**
3. 🔴🔴 **逐包行說 `cache hit` 也可能是對的 —— 分辨不了的是「該不該 hit」。**
   ⇒ **改過根層設定之後,turbo 的綠一律不算數,要 `npx tsc --noEmit -p <該包 tsconfig>` 直跑一次。**

#### ⚠️ 四條未驗(不要讀成已排除)

1. **跨 worktree replay 只有 log 字面、沒做實驗**:log 印 `Remote caching disabled, using shared worktree cache`,
   且 `ls -d node_modules/.cache/turbo` 在該 worktree 內查無 ⇒ 快取不在那棵樹裡。**但沒有跨樹構造。**
2. ~~🔴 **`lint` / `build` 沒測**~~ **← 2026-08-16 已構造,見下方「三個 task 全中」。原判「未驗」作廢。**
3. **還有哪些根層檔屬於這一類**(eslint 設定 / `vitest.config.ts` / `package.json` overrides…)
   —— **只證了 `tsconfig.base.json` 一個。**
4. **修法沒設計** —— 見下。

#### 🔴🔴 2026-08-16 續章:**三個 task 全中,而 lint / build 比 typecheck 更嚴重**

`turbo.json` 的三個 task **都沒有 `inputs`**(量法同上,`grep -n "globalDependencies\|inputs" turbo.json` ⇒ 零命中):
`"lint": { "dependsOn": ["^build"] }` / `"build": { "dependsOn": ["^build"], "outputs": […], "env": […] }`。

**各構造一發,同一刻、同一棵樹、`cp` 備份 + 還原後 shasum 逐字相同:**

| task | 改的根層檔 | 直跑 | turbo 路徑 | 逐包那行 |
|---|---|---|---|---|
| typecheck | `tsconfig.base.json` | `npx tsc -p apps/admin` **exit 2 / 13 error** | `turbo run typecheck` **0 error** | `cache hit, replaying logs 53dad03f…` |
| **lint** | `eslint.config.js`(**根層唯一一份**) | `npx eslint .` in `apps/admin` **exit 1 / 71 error** | 🔴 **`pnpm lint` exit 0、完全綠** | `cache hit, replaying logs 808f63d3…` |
| **build** | `tsconfig.base.json` | `npx next build` in `apps/admin` **exit 1 / 13 error** | 🔴 **`pnpm build` exit 0、完全綠** | `cache hit, replaying logs 3bd53db8…` |

🔴 **三個 hash 都與各自「乾淨綠樹」那次完全相同** ⇒ **replay 了綠,而當下真的紅。**
🔴🔴 **lint 與 build 比 typecheck 更嚴重**:typecheck 那次 `pnpm typecheck` 整體還是 exit 2
(靠**非 turbo** 的 `tsc -p tsconfig.scripts.json` 撿到 4 條);
而 **lint 與 build 沒有那個補償段** ⇒ **`pnpm lint` / `pnpm build` 報【全綠】,而錯是真的。**

📌 lint 的分母:`find . -maxdepth 3 -name "eslint.config.*" -not -path "*/node_modules/*"` ⇒ **只有 `./eslint.config.js` 一份**,
而 `apps/admin/package.json` 的 lint script 逐字 `eslint . --max-warnings 0 --no-error-on-unmatched-pattern`
⇒ **它往上找到根層那份** ⇒ 根層設定決定 admin 紅不紅,而它不在 admin 的 input 集合裡。

⇒ **本條的嚴重度隨之升級:不是「typecheck 可能騙人」,是【整組三綠都可能騙人】。**
⚠️ 適用條件仍是「**改過根層設定之後**」;沒動根層設定時,三綠照常成立。

#### 修法方向(**不在本條做**)

加 `inputs` 或 `globalDependencies` 到 `turbo.json`。
🔴 **那是動平台設定 = 鐵則 12④ ⇒ 要 plan + Sean 批 + 對抗審查。**
⚠️ 而且**改壞的代價是反向的**:設太寬 ⇒ 每次都 cache miss、CI 變慢;設太窄 ⇒ 假綠照舊。
⇒ **本條只立案 + 留判準,不順手改。**

#### 不修未來會痛在哪

- **擴充性:** 之後每加一個 package,同一個洞自動複製一份。
- **可維護性:** 「三綠」是本 repo 的收工條件,而它在這個情境下**會給出綠**;
  下一個人不會懷疑它,因為**綠就是他要的答案**。
- 🔴 **bug 可追蹤性:** 假綠**零訊號** —— 沒有紅、沒有 warning、`Tasks: N successful` 讀起來完全正常。
  唯一會發現的時機是**別人在另一個情境下真跑了一次 tsc**,而那可能是好幾天以後。

### #526. 🔴 apps 拿 **Node 25** 的型別在 typecheck,而 runtime 是 **Node 22.22.3**

- **狀態:** ⏳ 待執行(2026-08-16 A 窗版本漂移盤點時撈到;**形狀存在,未構造反例**)
- **分流:** P2
- **優先級:** 🟠 中(**typecheck 過而真實環境會壞** —— 但今天沒有已知的實際事故)
- **起因:** 主視窗派工「盤點宣告版本 vs 實際版本」,清單裡沒有這一項,**是量的過程中撈到的**。

#### 實查(可重跑)

```bash
ls -d node_modules/.pnpm/@types+node@* | sed 's|.*@types+node@||' | sort -u   # ⇒ 3 個版本
python3 -c "import json;print(json.load(open('node_modules/@types/node/package.json'))['version'])"
for p in apps/admin apps/storefront packages/adapters; do
  python3 -c "import json;print('$p',json.load(open('$p/node_modules/@types/node/package.json'))['version'])"
done
node --version
python3 -c "import json;print(json.load(open('package.json'))['engines'])"
```
| 位置 | 宣告 | 實際 |
|---|---|---|
| root | `^22` | **22.19.19** |
| `apps/admin` | `^25.6.2` | **25.6.2** |
| `apps/storefront` | `^25.6.2` | **25.6.2** |
| `packages/adapters` | `^25.6.0` | **25.6.0** |
| `engines.node` | `>=22.0.0` | runtime **v22.22.3** |

🔴 **不是「解析錯」** —— 各自都宣告了、pnpm 給對了。**問題是這個組合本身。**

#### 病

**apps 是拿 Node 25 的型別定義在 typecheck 的,而跑的是 22.22.3。**
⇒ **一支 Node 25 才有的 API:typecheck 會過,執行時會炸。**

📌 **另一半**:`scripts/*.ts` 走 root 的 `^22`
⇒ **同一個 repo 裡,`scripts/` 對著 Node 22 的型別、`apps/` 對著 Node 25 的型別。**

#### ⚠️ 強度:**形狀存在,不是事故**

🔴 **沒有構造反例** —— 我**沒有證明**現在真的有人用到 Node 25 才有的 API。
**⇒ 不得讀成「已發生」,也不得因為「還沒出事」就降級成不用管。**
(要收它的人:構造方式 = 找一支 25 有而 22 沒有的 API,寫進 `apps/` 看 typecheck 過不過、再實跑。)

#### 與 `#524` 的關係:**同族,成因不同**

| | `#524` | 本條 |
|---|---|---|
| 共同點 | **typecheck 過,而真實環境會壞** | 同左 |
| 成因 | turbo 快取對根層設定**盲** ⇒ replay 出舊的綠 | **型別定義的版本與 runtime 對不上** |
| 症狀時機 | 改過根層設定之後 | 用到跨版本 API 時 |

⇒ **不要把它折進 `#524`** —— 修好其中一個,另一個原封不動。

#### 🔴 兩個查法上的坑(順手記著,它們會再咬人)

1. **`catalog:` 讓版本在 `package.json` 裡看不見**:`typescript` / `eslint` / `vitest` 三支的
   `package.json` 欄位值逐字就是 `catalog:`,**真身在 `pnpm-workspace.yaml` 的 `catalog:` 區塊**。
   ⚠️ **第一次查差點漏掉** —— 只看 `package.json` 會得到「沒宣告版本」的錯誤印象。
2. 🔴 **單棵 worktree 的 backlog `grep` 看不到全貌**:五棵樹的最大號各不相同
   (2026-08-16 主視窗實查:`void-readers` 524 / `products` 512 / `customers` 525 / `print` 516 / `dev` 522)
   ⇒ **在某一棵樹 `grep '#525'` 回 0,不代表沒人佔** —— 那個號可能寫在別棵樹上。
   **`scripts/next-backlog-number.sh` 掃分支,所以它是對的;單樹 grep 才是錯的那個。**

#### ⏳ 待查(本條開立時明列,不要讀成已排除)

- **TypeScript 5.7 → 5.9.3 的行為差異**:catalog 宣告 `^5.7.0`、實際 5.9.3。
  🔴 **刻意不去讀 release note 補** —— 那是個沒有邊界的任務。**標未驗,等有具體症狀再查。**
- **那 6 個「照文件做」的候選檔沒逐檔開**(`docs/` 632 檔中,提到官方文件的 55 檔 ∩ 提到工具名的)。
  ⚠️ 其中至少 2 檔在 `docs/archive/` 下 ⇒ **本來就不該當現行依據。**
- **`packages/` 底下其他包沒逐一量** —— 只量了 `adapters`。

#### 🔴🔴 最重要的一條待查:**我們今晚所有版本量測都是【本機】的**

`node --version`、`node_modules/**` 讀到的、`pnpm --version` —— **全部是這台 Mac 上的值**。
**而真正決定線上行為的是 CI / Vercel 建置環境的版本。**
⇒ **本條(以及 `#524` 的所有量測)在 CI 上成不成立,沒有人查過。**
**這一條不修完,上面所有結論的作用域都只到「本機」為止。**

---

## #529 · `docs/runbooks/` 絕大多數沒有進入點、零 index ⇒ 孤兒檔(數字用量法,不寫死)

> 🔴 **標題刻意不放數字(E 窗 MF2)**:初版標題寫「18 支僅 **3** 支」,
> **而同一批改動裡主視窗自己加了第 4 支路由 ⇒ 那個 3 生下來就過期。**
> **那條 backlog 自己就是它在講的那個病**(數字沒有量法、過期而沒有東西會紅)。
> **落筆當下重跑這兩條,不要引用下面的歷史數字**:
> ```
> ls docs/runbooks/*.md | wc -l
> grep -o "runbooks/[a-z0-9-]*\.md" CLAUDE.md | sort -u | wc -l
> ```

- **實測(2026-08-16 E 窗;⚠️ 這是【當時】的值,不是現況)**:
  ```
  ls docs/runbooks/*.md | wc -l                          ⇒ 18
  grep -o "runbooks/[a-z0-9-]*\.md" CLAUDE.md | sort -u   ⇒ 3
  docs/runbooks/ 有沒有 index/README                       ⇒ 0
  AGENTS.md 提到 runbooks/                                ⇒ 0
  ```
- **不修未來會痛在哪**:🔴 **知識寫了但沒有觸發載體 ⇒ 同一個坑會被寫第三次、第四次。**
  **實錘(2026-08-16)**:macOS 起拋棄式 PG 的三個坑早在 `docs/handoff/2026-07-30-*:69-72` 與
  memory 裡寫過,**E 窗今晚仍從頭踩了其中兩個** —— 因為「我現在要起一個拋棄式 PG」那一刻**沒有任何東西會叫**。
- **解法先例**:`docs/patterns/` 11 支 → 9 支直接路由 + `docs/patterns/index.md` 當總入口(`CLAUDE.md:68`)。
  ⇒ 補 `docs/runbooks/index.md` + 路由表一行。
- **⚠️ 這是實工不是一行**:18 支各要寫「什麼時候該讀它」。
- **發現於**:2026-08-16 · E 窗實測 · 主視窗裁「開號、不現在做」

---

## #530 · 🔴 `supabase db push` 到底包不包交易 —— **86 支 migration 的「失敗即整片回滾」全部靠這個前提,而沒有人驗過**

- **現況**:repo 有**三處宣稱**、**零處量測**:
  - `20260811040000_…_catalog_new_arrivals.sql:160` 逐字「本 repo 的 migration 以交易執行」(出處標的是 codex R2 MF-6 = **審查意見**)
  - `20260811110000_…_result_confirmed_event.sql:210`「非 CONCURRENTLY ⇒ 與本片其餘 DDL 同一交易,失敗即整片回滾」
  - `20260812130000_…_fuzzy_admin_search_orders.sql:81`「11 支 GIN 都在單一交易內建」
- **規模**:`supabase/migrations/*.sql` **175 支**,其中自己寫 `BEGIN`/`COMMIT` 的 **86 支**。
- 🔴 **E 窗(2026-08-16)用 `psql -1` 當模型證了兩種情境,第三種證不到**:
  ```
  有包 + 無內層 COMMIT ⇒ 整片回滾           ✅ 實測（負向對照 zz_c/zz_d ⇒ 0/0）
  有包 + 有內層 COMMIT ⇒ 全部落地           ✅ 實測（zz_a/zz_b ⇒ 1/1）
  沒包                 ⇒ 不在範圍           ❌ 未證
  ```
  **`supabase db push` 是不是 `psql -1` 這個形狀,沒有人查過。**
- **不修未來會痛在哪**:**擴充性**=之後每一支 migration 都會繼續把「原子性」當成免費的前提來設計;
  **bug 可追蹤性**=🔴 **若前提不成立,失敗的 apply 會留下半套 schema,而畫面回報的是「失敗」** ⇒
  **人以為整片沒生效,實際上半支已經落地**,而下一次 apply 會撞到「物件已存在」這種看似無關的錯。
- **怎麼查**:①`supabase db push --debug` 看它下的實際 SQL ②Supabase CLI 原始碼 ③對拋棄式庫實跑一支故意失敗的 migration。

### ✅ 2026-08-16 已查 —— **前提成立,但有一組例外。🔴 結論由【兩個不同來源】各撐一半,不要混引**

> 🔴 **修正紀錄(E 窗 MF1)**:本節原本標「主視窗實讀 Supabase CLI 原始碼」**一個來源**,
> 而結論的後半(pipeline = 隱式交易)**讀不出於那份 Go 原始碼** —— 它在 PG 協定層。
> **不是沒查,是【標的證據來源】與【結論】對不上** ⇒ 下一個人去讀那份原始碼讀不到那句,會以為是編的。
> **同族**:D 窗 `288` 那件(數字對,而它掛在產不出它的來源上)。**已拆成 ① ② 兩段。**

**① `ExecBatch` 把 statement 與 `schema_migrations` 收進同一個 batch —— 來源:Supabase CLI 原始碼**
**取得方式(可重跑)**:`gh api repos/supabase/cli/contents/apps/cli-go/pkg/migration/file.go --jq .content | base64 -d`

```
:119  func (m *MigrationFile) ExecBatch(...)   → batch := &pgconn.Batch{}
:171  batch.ExecParams(line, ...)              → 每個 statement 進【同一個 batch】
:176-182  insertVersionSQL(conn, batch)        → 🔴 schema_migrations 登記【附在同一個 batch】
:184  return flushBatch()                      → 一次送出
```
⚠️ **這份原始碼只證到「它們進同一個 batch」。「batch = 一個交易」不在這份檔裡。**

**② pipeline = 隱式交易 —— 來源:E 窗 2026-08-16 實測(`E-643`),不是原始碼**
```
環境 PG 17.10 server + psql 18.4 client（🔴 psql 17 不支援 \startpipeline，先用 17 那發已作廢重跑）
\startpipeline / CREATE TABLE zz_pipe_a / SELECT 1/0 / \endpipeline
⇒ 新連線查 zz_pipe_a ⇒ 0        🔴 CREATE 被回滾 = pipeline 確實是一個隱式交易
負向對照 同 pipeline 但無錯誤 ⇒ zz_pipe_ok ⇒ 1      （量具分得開）
正向對照 pipeline 模式確實啟動（SELECT 1 有回值）
```
⇒ 🔴 **① + ② 合起來,那 11 支「刻意無顯式 `BEGIN`/`COMMIT`」的檔頭宣稱【成立】,含「schema 落地與 history 登記在同一交易」那半。**

**🔴 而有一組例外,是四處宣稱都沒提的**:
```
:80-87  isPipelineIncompatible(sql) → 命中就先 flushBatch() 再單獨 conn.PgConn().Exec()
:32  ^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY(\s|\z)
:33  ^REINDEX(\s|\().*\sCONCURRENTLY(\s|\z)
:34  ^VACUUM(\s|\(|\z)      :35  ^ALTER\s+SYSTEM(\s|\z)      :36  ^CLUSTER(\s|\z)
```
⇒ **這五類會【沖掉批次】** ⇒ **它之前的 statement 提前提交** ⇒ **原子性在那一刀斷掉。**
⚠️ **注意 `:32` 只匹配 `CONCURRENTLY`** —— 一般 `CREATE INDEX` **不受影響**(本 repo 31 支檔有 `CREATE INDEX`,全部安全)。
✅ **本 repo `CONCURRENTLY` 目前零命中** ⇒ **現在沒踩到,而【這條規則從來沒有人寫下來】。**

### ✅ 2026-08-16 補證(D 窗讀 pgx 原始碼)—— **地基從「類比」換成「原始碼」,而且多量到一條範圍**

**版本鏈先釘**(版本對不上的原始碼不算數):本機跑 `db push` 的是 supabase CLI **`2.98.1`**,
其 `go.mod:35` = `github.com/jackc/pgconn` **v1.14.3**(🔴 **獨立 v1,不是 `pgx/v5/pgconn`;查 v5 會查到不同的東西**)。

**`Sync` 是整批最後一次,不是每句一次**(`jackc/pgconn` v1.14.3 `pgconn.go`):
```
:1730 起 Batch.ExecParams 只 append 四種訊息：Parse / Bind / Describe / Execute —— 一個 Sync 都沒有
:1799    (&pgproto3.Sync{}).Encode(batch.buf)   ← 唯一一處，【不在任何迴圈裡】
:1814    pgConn.conn.Write(batch.buf)           ← 整個 buffer 一次寫出
分母：全檔 1,901 行，pgproto3.Sync{} 只出現三次（:852 Prepare / :1219 非 batch 路徑 / :1799 ExecBatch）
```
⇒ 🔴 **E 窗擔心的「每句一個 `Sync` ⇒ 每句各自一個隱式交易」【不成立】。**
⚠️ `pkg/migration/file.go:87` 的註解「ExecBatch is implicitly transactional」**是 CLI 自己的宣稱,不是證據** —— 上面那幾行才是。
⚠️ **仍未重驗的那半**:**「一個 `Sync` = 一個隱式交易」** 仍靠 PG 協定 + D 窗先前那發 psql 實測。
**本輪只證了【CLI 送幾個 Sync】,沒有重證【PG 怎麼解讀它】。**

### 🔴🔴 而交易邊界是【每一支檔】,不是【整次 apply】
```
apply.go:62   for _, path := range pending {        ← 每一支 pending migration 一圈
apply.go:67       conn.Exec(ctx, "RESET ALL")        ← 🔴 在 batch 之【外】
apply.go:72       migration.ExecBatch(ctx, conn)     ← 這一支自己一個隱式交易
apply.go:75   }
```
⇒ **`db push` 推 5 支、第 3 支炸掉 ⇒ 第 1、2 支【已經提交了】,不會回滾。**
✅ **本條與 `#531` 既有文字裡的「整片」一律指【一支 migration 檔】,不是整次 push —— 核過,沒有寫錯。**
🔴 **但「整片」這個詞有歧義,引用時請寫成「整支檔」。**

### ⚠️ D 窗明說沒做到的(照留)
- **讀原始碼,沒有抓封包** ⇒ 證的是「這份原始碼會送幾個 `Sync`」,**不是「線上那條連線實際送了幾個」**。
- 🔴 **沒有排除 middleware**:走 Supavisor / pgbouncer 時,**pooler 會不會改寫或切分 pipeline,沒查** ——
  **這條對正式站是實際存在的路徑,值得單獨開一問。**
- pgx v4 → pgconn v1 的型別對應是從 `go.mod` 直接釘的,**沒另外驗 pgx v4.18.3 內部有沒有第二條 batch 路徑。**

**⇒ 本條剩下的工作**:①把這組例外寫進 migration 撰寫規範 ②`#531` 的守門一併涵蓋這五類

### ✅ 2026-08-16 pooler 那條已答(D 窗讀 CLI 原始碼 + 親讀官方文件)—— **`#530`/`#531` 結論【不用改】**

🔴 **關鍵不是「有沒有走 pooler」,是 CLI 【強制把它降成 session mode】**:
```
supabase/cli v2.98.1  internal/link/link.go:227-228
  PoolMode 無條件設成 session；若 API 回報的不是 session ⇒ 把 port 從 :6543 改成 :5432
官方文件（親讀 https://supabase.com/docs/guides/database/connecting-to-postgres）：
  Shared pooler (Supavisor) - session mode      → …:5432
  Shared pooler (Supavisor) - transaction mode  → …:6543
```
🔴 **而官方同一頁對那個痛點寫著**:**"Transaction mode does not support prepared statements."**
⇒ `ExecBatch` 的 `Parse`/`Bind` **正是 prepared-statement 那條路** ⇒
**若真走 transaction mode,它會【直接壞掉報錯】,不是「靜默切分交易」** ⇒ **最壞情境(靜默失效)在這裡不成立。**

**走不走 pooler 是【執行時】決定的**(`internal/utils/flags/db_url.go:132-154`):
每次 `db push` 先對直連 host 撥 5 秒 TCP,**通 ⇒ 直連;不通 ⇒ 退到 pooler**。
官方同頁:**"Direct connections are on IPv6, or on IPv4 if the project has the IPv4 add-on."**
⇒ **一般 IPv4-only 網路撥不通 ⇒ 實務上很可能一直在走 pooler。🔴 但因為上面那條,不改變結論。**

### 🔴 而這條是唯一能讓結論翻掉的路:**快取檔可能是舊版 CLI 寫的**
```
GetPoolerConfig 讀的是【快取】不是每次重問 API：
  internal/utils/connect.go:67   Config.Db.Pooler.ConnectionString 為空才回 nil
  internal/utils/misc.go:76,79   supabase/.temp/pooler-url
🔴 link.go:228 的改寫【只在 supabase link 那一刻發生】，不會在每次 db push 重跑
⇒ 若那個檔是【舊版 CLI】寫的，裡面可能仍是 :6543
```
**🔧 一秒檢查(只看 port,不印內容;該檔已被 `link.go:225` 剝掉密碼,但仍不要整份貼)**:
```bash
grep -o ':[0-9]\{4\}/' supabase/.temp/pooler-url
```
**預期 `:5432/`。若是 `:6543/` ⇒ 快取過期,跑一次 `supabase link --project-ref <ref>` 重寫,本條即關。**

### ⚠️ D 窗明說不在它結論裡的三件(判別器=讀原始碼+讀文件)
1. 🔴 **Supavisor 在 session mode 下的【位元組層】行為沒查** —— 證的是「CLI 連到 session mode 那個 port」,
   **不是「Supavisor session mode 保證不動 pipeline」**;**官方文件對 pipeline / extended protocol 一個字都沒提。**
2. **沒抓封包、沒對正式庫做任何事。**
3. **Sean 的網路實際撥不撥得通直連,沒問也沒測**(不影響答案,但仍是未知)。
**要從「很可能」變「量過」**:`supabase db push --debug` 看它印 `Resolved DNS:` 還是走 pooler 分支
(`db_url.go:139` 那行 debug log 就是為此存在)⚠️ **它會真的推 migration,要挑沒有 pending 的時候。**

**⚠️ 兩條未確認,按「離地基遠近」排**:
1. 🔴🔴 **最靠近地基(E 窗 2026-08-16 指出,而主視窗原本沒標)**:
   **CLI 用的是 pgx 的 `pgconn.Batch`,而 ② 那發實測用的是 psql 的 pipeline。**
   **`Batch` 會不會在 statement 之間送 `Sync`?會的話每一句就是各自的隱式交易,整條結論不成立。**
   **主視窗沒驗、E 窗也沒驗** —— 要讀 pgx 原始碼或抓封包。
2. `db push` 走的是不是這條 Go 路徑(`file.go` 檔頭註解提到部分路徑已改 TypeScript native port)。
- **發現於**:2026-08-16 · E 窗 `E-639` 自標缺口 · 主視窗查證「宣稱四處、量測零處」→ 同日實讀原始碼補上證據

---

## #531 · 🔴 migration 的 `COMMIT;` 之後不得再有 DDL —— 現在無人踩到,而**踩到不會有任何東西叫**

- **失效形狀(E 窗 2026-08-16 實測,`E-640`)**:
  ```
  zz_inner.sql:1  WARNING: there is already a transaction in progress   ← 內層 BEGIN 是 no-op
  zz_inner.sql:5  ERROR:   zz:模擬斷言失敗
                  WARNING: there is no transaction in progress          ← 🔴 收尾時已無交易
  ```
  內層 `COMMIT` **結束了外層交易** ⇒ **之後每一句都在 autocommit 下各自提交** ⇒ 斷言失敗時**沒有交易可回滾**。
  🔴 **失效形狀不是「少一層保護」,是「`COMMIT` 之後每一句各自提交」** ——
  **而 migration 仍會回報失敗 ⇒ 人以為整片沒生效,實際上半支已經落地。**
- **本 repo 現況(主視窗 2026-08-16 逐支查完,不是抽樣)**:
  ```
  自己寫 BEGIN/COMMIT 的                        86 支（分母 175）
  「最後一個 COMMIT 之後仍有 DDL/DML」的          🟢 0 支
  正向對照：拿 staff_table.sql 的 BEGIN 行(:9)當假的 COMMIT 位置 ⇒ 其後 DDL 行數 = 13
            （⇒ 那個 0 是真的零，不是 pattern 沒對上）
  ```
- **不修未來會痛在哪**:🔴 **下一個人在 `COMMIT;` 後面加一行 `COMMENT ON …` 就踩進去,而沒有任何東西會叫。**
  三綠看不到、審查未必看得到(它長得完全正常)、**只有 apply 失敗的那一天才會現形,而那天在正式庫。**
- **機制修法(優先於寫規則)**:pre-commit 或語法守門加一條 ——
  **對每支 migration 取最後一個 `^\s*COMMIT\s*;` 的行號,其後不得有 `CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|INSERT|UPDATE|DELETE` 開頭的行。**
  ⚠️ **裝守門時必附負向對照**(把行號換成 `BEGIN` 那行 ⇒ 必須紅),否則它會是恆綠格。
- **依賴**:🔴 **本條的前提是 `#530`** —— 若 `supabase db push` 根本不包交易,本條的危害分析要重寫(會更糟,不是更好)。
- **發現於**:2026-08-16 · E 窗實測失效形狀 · 主視窗逐支盤點現況

---

## #532 · 🔴 `docs/probes/*.sh` 沒有任何東西會叫它跑 —— 改了 view 不跑 probe 不會紅

- **實查(2026-08-16;A 窗查、主視窗補查環境)**:
  ```
  docs/probes/*.sh                                  4 支
  .husky/ .github/ package.json 提到 docs/probes     ⇒ 三個各 0（A 窗查，主視窗複核）
  .github/workflows/                                 ci.yml / e2e-prod.yml / rpm-sync.yml
  ci.yml 跑                                          pnpm typecheck / lint / test + playwright install chromium
  ci.yml 有沒有 postgres service                      ⇒ 【沒有】
  ```
  ⇒ **CI 在、但沒有 DB、也沒有人叫 probe。**
  > 🔴 **更正紀錄**:本條初版寫「而『CI 不存在』不成立」,**把一句 A 窗從來沒說過的話算在它頭上** ——
  > 它寫的是「三個載體零命中」,那句逐字成立。**是主視窗把它讀成「沒有 CI」再去反駁那個讀法。**
  > ⚠️ **而 A 窗自己判「你的更正仍然更有用」**:原句**讀起來像**「沒有 CI」,
  > **而差別會改變下一個人的動作** —— 讀成「沒有 CI」會去建一條(重工),讀成「CI 沒有資料庫」才會去加 DB。
  > ⇒ **原句與精確版兩句都留,不改寫。**
- **不修未來會痛在哪**:🔴 **兩側觸發不對稱** —— TS 側每次 `vitest` 都跑,**SQL 側只有人想到時才跑。**
  ⇒ **改了 view 而沒跑 probe,不會有任何東西紅。** 而 `#522` 正是「SQL 與 TS 兩邊同款錯」——
  **兩邊同款錯能存活,靠的就是沒有東西在比對它們。**
- **裁決(主視窗 2026-08-16)**:**掛 CI,不掛 pre-commit。**
  🔴 **pre-commit 要起一個 postgres ⇒ 每次 commit 幾十秒到分鐘級 ⇒ 會逼所有人用 `--no-verify`。**
  **一個會被繞過的守門比沒有守門更糟(它給人已守護的錯覺)。**
- **做法:🔴 開工第一動是【量四支各自需要什麼】,不是直接加 `services: postgres`。**
  > **A 窗更正主視窗**:`order-goods-axis-parity-probe.sh` 與 `admin-customer-list-view-probe.sh`
  > **根本不吃外部 postgres —— 它們自己 `initdb` 起拋棄式叢集。**
  > **它們要的不是 service,是【runner image 上有 `initdb` / `pg_ctl` 這兩個執行檔】。那是另一件事。**
  > **另外兩支(`452-2a2-*`)當時沒讀,不知道要什麼。**
  ⇒ **先量「四支各自的需求 × runner image 內建了什麼」,量完才寫 plan。**
  ⚠️ **動 CI ⇒ 鐵則 12④(平台設定)⇒ 對抗審查必跑。**
- **現況的替代**:A 窗已把這條寫進三處檔頭 —— ⚠️ **那是註解不是機制,在 CI 落地前是唯一的東西。**
- **發現於**:2026-08-16 · A 窗修 `#522` 時自標「這是裁量不是遺漏」· 主視窗查環境後裁 CI

---

## #533 · 🔴 兩個實作互比,只能證明它們【一致】,不能證明它們【對】

- **由來**:主視窗給 `#522` 的守門規格寫「兩邊各跑一次,**比結果**」——**A 窗當場更正,而它對。**
  > **`#522` 正是兩邊【一起】用錯分母,同一組輸入會給出【同一個錯答案】,互比一致通過。**
  > **互比只能抓「抄漏」,抓不到「一起錯」。**
- 🔴 **而主視窗在【同一封信】裡寫過「不要只釘兩邊字面相同,字面相同擋不住兩邊一起用錯分母」**
  ⇒ **看穿了字面層的那一版,沒看穿它在行為層的變體。**
- **正解(A 窗實作)**:**共用真值表 + 【人寫的期望值】當第三方**,兩邊各自對它比(14 案 / 7 案含取消);
  突變兩邊各改回舊分母 ⇒ **各紅 5 案**(證明有判別力)。
- **本條要做什麼**:**盤點 repo 裡所有「兩個實作互比」型的守門**,逐條問
  **「這一格能不能同時放行兩個都錯的實作?」** 能 ⇒ 補一個獨立的期望值來源。
  📎 已知同型候選:`#499`(`ADMIN_ORDER_LIST_SELECT` 四值字面與 view 的對應仍是人工比對)。
- **發現於**:2026-08-16 · A 窗更正主視窗的守門規格

### #548 · CI 只跑「每次 push 的 tip」,不逐顆跑 ⇒ 出事 bisect 不到

> 🔴 **本條原為 `#547`,2026-08-16 撞號後由主視窗裁定改為 `#548`(原號讓給 B 窗)。**
> **裁定判準不是「先到先得」是「誰照協定走」** —— B 窗標了「佔位、待主視窗確認」,I 窗沒標;
> 讓沒標的一方靠早四分鐘保住號碼,那個協定就沒有價值了。
>
> ⚠️ **而 I 窗發號時的第二道檢查【是壞的】,這裡照實記,因為它比撞號本身值錢**:
> ```
> 跑的是   grep -rn 佔位 ~/pcm-mailbox/*.md | head -10
> 真實命中  76 筆        ⇒ 只看了 13% 就寫下「零個真佔位宣告」
> ```
> 🔴 **截斷處看起來像自然結尾 ⇒ 它偽裝成「我看過了」。**
> 與「量具回 0」那一族**相反**:回 0 至少「什麼都沒有」還是個異常長相;**本條沒有任何訊號。**
> ⚠️ **但它不是這次撞號的原因**(兩者都成立、方向相反,不合報):
> I 窗 commit `15:32:29` / B 窗 `B-548-STOP.md` 建於 `15:37` ⇒ **掃描當下那封信還不存在。**
> **⇒ 通則(所有窗適用)**:`grep` 的工作是**定位**不是**回答**;接了 `head`/`cut` 的輸出
> **不准拿來下全稱結論**,要下結論**先取分母**(`| wc -l`),分母 > 你看的行數 ⇒ 結論還沒成立。

- **狀態:** 未開工。**現在不修**(主視窗 2026-08-16 裁:修法=每顆都跑,成本要先算給 Sean 看)。
- **由來(2026-08-16,I 窗查「push 繞過分支保護」時挖到的副產品)**:
  原題是「早上那次 push 帶了 `Bypassed rule violations` ⇒ CI 到底有沒有跑」。
  答案是**跑了而且綠**,但量的過程露出這個:
  ```
  量法(可重跑):
    R=pcmmotorsports/pcm-website-v2
    for s in $(git log --format=%H origin/dev -12); do
      gh api repos/$R/commits/$s/check-runs --jq '[.check_runs[]|select(.name=="check")]|length'
    done
  2026-08-16 實跑:最近 12 顆,有 check run 的 = 3 顆
  沒有 run 的 9 顆:對 `gh run list --branch dev` 的 headSha 集合逐顆比對
                   ⇒ 9 顆【全部從未當過任何一次 push 的 tip】(已驗,非推論)
  ```
  沒被逐顆跑到的包含:**四支收割 merge**(`4accacef`/`578a616f`/`15a65864`/`a35900f3`)
  與 **`f90670b3`(`#525` REVOKE 權限修)**。
- ✅ **不是沒驗,是沒逐顆驗**:後續 `055137f9` 與 `d35f7602` 兩次 green run 跑的樹已含那五顆。
- 🔴 **不修未來會痛在哪**(鐵則 10):
  **哪一顆 merge 引入問題、又被後一顆蓋掉,CI 不會留下任何痕跡。**
  出事時要回答「是哪一次收割弄壞的」,`git bisect` 拿不到 CI 訊號,只能重跑每一顆
  —— 而重跑要的環境(真 postgres + playwright chromium)**本機三綠沒有**(見
  `docs/patterns/slice-checkpoint.md` §6.5)⇒ **代價從「查 log」升級成「重建 CI 環境」**。
  ⚠️ 這一段是**推論**,未實際 bisect 驗證過。
- 💰 **成本已算(2026-08-16 I 窗;主視窗要的那份)**:
  ```
  CI 單次        中位數 228s（n=18)
  近 7 天        1093 commit / 110 run  ⇒ 約 10 顆 commit 共用 1 次 CI
  逐顆跑         1093 × 228s ≈ 69 小時 / 週   ← 乘出來的，併行度與佇列上限【未量】，標推算
  金錢           $0
  ```
  🔴 **`$0` 的前提是【repo 為 public】(public repo 的 Actions 免費)。**
  **Sean 2026-08-16 裁【丙】:上線後才改 private** ⇒ **前提現在成立,而它有明確的到期日。**
  ⚠️ **改 private 當天本條的成本結論同時失效** —— 那時 Actions 開始吃 2,000 分/月額度,
  而**當時實測半個月已用約 2,548 分** ⇒ **逐顆跑等於直接把額度燒穿**。
> 🔴🔴 **2026-08-16 稍晚【自我更正:上面那個「約每月中用完」的推論,基準選錯了】**
> ```
> 按日分佈（ci.yml，8/1 起）
>   08-09 一天 146 次  ← 佔本期 426 次的 34%
>   08-10 之後每天只有 3–10 次
> 照近 7 天速率外推 ≈ 180–210 run/月 ≈ 750–850 分/月  ⇒ 遠低於 2000 額度
> ```
> **`2548` 是本期【已發生】的事實(不可改變),但它不代表未來月份的速率。**
> ⇒ **判「以後會不會超」要用近 7 天,不是本期平均。上線那天請重跑【按日分佈】再下結論。**
> ⚠️ **未查:`08-09` 那天為何 146 次,因此無法判斷那種尖峰會不會再來 —— 那才是決定性的一題。**
> 📎 **本條保留原推論不刪**,因為「同一組數字用不同基準得到相反結論」本身就是要留給下一個人的東西。

  📎 到期動作已掛在 `docs/PHASE-1-NORTHSTAR.md` §5 上線清單(不是只留在這裡)。
  ⇒ 🔴 **限制不是錢,是 wall-clock 與佇列** —— 決策題應收窄成
  「**要不要為了 bisect 能力,讓每次 push 排 10 倍的 CI 佇列**」。
- **可能修法(未評估成本)**:①收割 merge 改走 PR(PR 事件會逐顆觸發)②push 後對每顆
  `gh workflow run` 補跑 ③接受現況、只要求收割者本機逐支驗(= 現行紀律)。
- 📎 **現行緩解**:收割紀律「每併一支就跑一次完整驗證,不是全部併完才跑」
  ——**那條沒有被 CI 取代,是它現在唯一的替代品。**
- **發現於**:2026-08-16 · I 窗 · 主視窗開工令任務 1

### #550 · `vehicle_taxonomy_public` 是全樹唯一一支「底表 RLS 對它無效」的 view

> ✅ **號碼已確認、佔位標記已拿掉**(2026-08-17 I 窗覆核;**兩道閘都重跑,且第二道不接 `head`、不吞 stderr**):
> ① `sh scripts/next-backlog-number.sh` ⇒ 三層(主樹工作區 / 11 個 worktree / 36 個 branch)最大號**皆為 550**、下一個可用 `#551`
> (腳本自印這是**下限不是保留鎖**,所以第二道非跑不可);
> ② `grep -rn '#55[0-9]' ~/pcm-mailbox/*.md` ⇒ **零命中**。
> 🔴 **零命中附正向對照與分母**:同一支 grep、同一批檔換成 `#54[0-9]` ⇒ **7 個檔命中**
> (`A-214` / `B-548` / `B-550` / `B-551` / `B-572` / `B-573` / `B-578`),分母 `ls ~/pcm-mailbox/*.md | wc -l` ⇒ **2918 檔**
> ⇒ 那個 0 是量出來的,不是 pattern 沒對上。
> ③ 本檔內 `grep -cE '^### #550 ' docs/phase-1-backlog.md` ⇒ **1**、`'^### #551 '` ⇒ **0**。
> 📎 **前一輪照協定標佔位的理由留著** —— 2026-08-16 我曾因**沒標佔位**而在 `#547` 撞號,
> 主視窗裁定判準是「**誰照協定走**」不是「先到先得」,我改號讓給 B 窗。

- **狀態:** 未開工。**來源=E 窗稽核 `E685-1`,該檔標「待派」** ⇒ 本條把它從一格表格變成有編號、可被派的東西。
- **出處**:`docs/security/2026-08-16-external-exposure-audit.md`(結論表第 10 條 + `E685-1` 明細)
- **事實(production 側全查,非抽驗)**:
  ```
  public 的 9 支 view：8 支 security_invoker=true、1 支 false
  那一支 = vehicle_taxonomy_public，view owner = postgres
  而 product_fitments / product_fitments_effective 的 relforcerowsecurity = false
  ⇒ owner 繞過 RLS ⇒ 這支 view 看得到【已下架商品】的車型資料，而 anon 讀得到它
  ```
- **目前嚴重度:低** —— 曝露欄位只有 `moto_brand` / `model_code` / `year_start` / `year_end`,
  **零 PII、零價格**。⇒ **現在不是 Blocker,不要當成正在外洩。**
- 🔴 **不修未來會痛在哪**(鐵則 10,而這條的痛點在【時間】不在【現在】):
  **它是全樹唯一一支底表 RLS 對它無效的 view。**
  `product_fitments*` 日後只要**加上任何敏感欄、或收緊任何 policy**,
  **這支會直接漏過去,而且不會有任何東西紅** —— 沒有測試、沒有守門、沒有 migration 斷言在看它。
  ⇒ **它是一顆延遲觸發的地雷:今天無害,而【引爆它的那次改動看起來會完全無關】**
  (改的人在動 `product_fitments`,不會想到有一支 view 繞過了他剛加的 policy)。
- **可能修法(未評估)**:①把該 view 改成 `security_invoker=true`(要先確認前台車型選單不會因此變空)
  ②對 `product_fitments*` 開 `FORCE ROW LEVEL SECURITY` ③兩者都不做,改為**加一道目錄層守門**
  釘住「9 支 view 全部 `security_invoker=true`」,讓下一個人加敏感欄時會紅。
  🔴 **③ 單獨做不夠**(它只讓問題【被看見】,不讓問題消失),但**③ 最便宜且零行為風險** ⇒ 可先做。
- ⚠️ **驗這條要 production 側**:`repo 側必然偏低`(授權可以不經過任何 `GRANT` 語句,見該稽核檔 §2.1)
  ⇒ **不要用 grep migrations 來判斷它修好了沒。**
- **發現於**:2026-08-16 · E 窗外部曝險稽核 · 由 I 窗立案

---

### #551 · 追蹤碼格式驗證裝錯層:現在**沒有任何一層**驗貨號的檢查碼

> ✅ **號碼已確認**(主視窗 2026-08-16 覆核,逐字「`#551` 號碼:**確認可用**」)。兩道閘都跑了:
> ① `sh scripts/next-backlog-number.sh` ⇒ 三層(主樹 / 12 個 worktree / 37 個 ref)最大號皆 550、下一個可用 `#551`
> (腳本自印這是**下限不是保留鎖**,故第二道非跑不可);
> ② `grep -rn '#55[1-9]' ~/pcm-mailbox/*.md` ⇒ **0 命中**。
> 🔴 **那個 0 附正向對照與分母**:同一支 grep 同一批檔換成 `#54[0-9]` ⇒ **7 個檔**命中,
> 分母 `ls ~/pcm-mailbox/*.md | wc -l` ⇒ **2921 檔** ⇒ 0 是量出來的,不是 pattern 沒對上。
> ③ 本檔 `grep -cE '^### #551 ' docs/phase-1-backlog.md` ⇒ 落筆前 **0**。

- **狀態:** 🟡 **部分落地**(2026-08-16 C 窗)。**不要標成已修。**
  🔴🔴 **2026-08-16 深夜 Sean `Q-C551` 把【規則本身】推翻了,本條整段重寫過一次:**
  ```
  舊（來自那份標著「版本未確認」的 HCT PDF）  長度必須 = 10，不合就【擋】
  Sean 逐字（老闆權威，未見書面來源）        「我們每一家貨運都不一樣，
                                              不限制多少數字或者號碼，最長 39位數」
  ```
  ```
  ✅ 已做：上限 39【只警告】（全部貨運商共用）
           hct 檢查碼【只警告】（僅在恰好 10 位純數字時才驗）
           兩個入口都接上（建箱彈窗 / 標記出貨鈕），且【一條都不擋】
  ❌ 已刪除（不是沒做）：長度 = 10、必須純數字 —— 兩條都被 Sean 的事實推翻
  ❌ 沒做：sf（順豐）不驗檢查碼 —— 規則我方未查證，【不是】刻意豁免
  ```
- **🔴 升級點(有人拿真託運單對過之後才做):**
  ```
  ① hct 檢查碼 warn → block。升級當下 lib/shipping/tracking-number.test.ts
     那格「只 warn 不 block」與那格「4 貨運商 × 13 輸入沒有一組回 block」都會紅 —— 那是對的，改它。
  🔴 ⚠️ 升級前必補一格：`level:'block'` 現在【零渲染測試】（三處消費端的 block 管線不可達）
        ⇒ 真要升級，先補「block 被渲染成什麼顏色 / 有沒有真的 disable 按鈕」那一格。
  🔴 ② 而在那之前，先用這條【便宜的證偽器】驗規則本身：
        MOD(x,7) 值域 0-6 ⇒ 照規則，真貨號【尾碼永遠不會是 7/8/9】。
        Sean 手上任何一張真託運單尾碼是 7/8/9 ⇒ 規則錯了，整條重查，不要升級。
     ⚠️ 若規則錯，現況會對【約九成】的正確貨號跳警告（不是三成 —— 30% 那個算法只數了尾碼 7/8/9；
        實算：命中 = 7/(10×7) = 1/10 ⇒ 誤報 90%）⇒ 員工學會無視 ⇒ warn-only 等於零。
     📎 而 90% 不是純災難：它讓這道守門【會自曝】，公式錯的話上工第一小時就有人來罵。
  ③ sf 的貨號規則要向順豐索取文件；在那之前 code 註解必須維持
     「不驗的理由是【未查證】不是【不需要】」那句話。
  ```
- **裝在哪一層(這條的重點)**:🔴 **不裝在列印端** —— 那是最後一刻才發現,而那時貨已經要出門了。
  ⇒ 裝在建箱 / 標記出貨的表單,員工還在鍵盤前面的那一刻。
  ⚠️ **但【不進 `shipBlocker`】** —— 本 lib 一條都不擋,它走的是另一顆獨立的警告顯示。
- **由來:** `docs/specs/2026-08-16-shipping-doc-carrier-tracking-plan.md` §5(Sean 已批的 plan)
  逐字登記成 backlog 候選,而 **plan 落地時它只活在那份 plan 裡** ⇒ C-212 補立案。
- **事實:** 新竹物流貨號 = 10 碼 = 前 9 碼 + `MOD(前9碼, 7)` 當檢查碼,**可自行驗證**
  (來源:memory `reference_hct-logistics-api`;⚠️ **我方沒跟 HCT 申請過服務、沒看過真實貨號**
  ⇒ 這條規則是文件讀來的,**未經實物驗證**)。
- **現況量法(可重跑)**:
  ```
  git grep -nE 'MOD|checksum|檢查碼' -- 'apps/admin/src/**/*ship*' ⇒ 零命中
  mark_shipped 只擋【空白】不擋【格式】:supabase/migrations/20260805170100_*_shipments_guards.sql
    錨點 pcm_b2_is_blank(tracking_number)
  ```
  ⇒ 員工把貨號打錯一碼,**四層都放行**,而症狀是客人查不到貨。
- **不修未來會痛在哪:** 打錯一碼的紙**印得出來、看起來完全正常**,而客人拿去 HCT 網站查
  得到「查無此件」⇒ 他會以為我們沒出貨。**症狀出現在客人那邊,回饋要繞一整圈才回到我們**。
- **⚠️ 這條只驗得了 hct**:`sf` 的貨號規則我方**未查證**、`other` 本來就沒有貨號
  ⇒ 落地時要先答「非 hct 的代碼怎麼辦」,否則守門會對 sf 誤報。
- **發現於**:2026-08-16 · C 窗 #10 片3(貨運商/追蹤碼/出貨日)· 由 C 窗立案
