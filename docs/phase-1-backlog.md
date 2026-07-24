# Phase 1 Backlog

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

### #26. ⏳ partiallyRefunded transition 評估

- **狀態:** ⏳ 待執行
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
  - `apps/storefront/src/components/ProductCard.tsx:34-42` `PRODUCT_IMG_POOL[seed % n] ?? ''` 若 seed === NaN → NaN % n = NaN → array index NaN → undefined → '' → broken URL
  - `apps/storefront/src/components/ProductCard.tsx:129` `seed={p.id}` 三處字面互關(page L65 `data-tier` + ProductCard L129 + lib L77)、debug 鏈未明示
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
  - ProductCard.tsx 已有 PRODUCT_IMG_POOL + productGallery(M-1-04-mini-slice 搬入)
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

### #195. ⏳ /vehicle-search 路由建立(MobileTabBar 找車 tab disabled 解除)

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低(M-1-15 或 Phase 2 處理)
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
- **相關:** apps/storefront/src/lib/products.ts `fetchFeaturedProducts` / HomeSelect N°04 編輯精選 / SupabaseProductAdapter

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
  - **下架權威**:來源側(報價單)單一裁判 —— 報價單跑 N=3 去抖 + `delisted_at` + 明星品 keep 卡;網站 `rpm-reconcile` 改「信任來源、不自己再判一輪」。最乾淨 = 報價單 view 投影 `delisted_at` 欄、網站直接鏡射(不從「缺席」自己重推),消雙重去抖延遲 + 避免網站獨留來源已下架品。
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

### #220c. 🏷️ /products 品牌篩選側欄仍用 MOCK_BRANDS — 真資料單一品牌、選其他 chip 0 結果

- **狀態:** ⏳ 待排(#220 衍生、非靜默壞篩選〔本條即揭示〕;不阻結帳/逛街)
- **優先級:** 🟡 低(真資料現只 RPM CARBON 單一品牌、品牌篩選實質無用、不阻 #220 逛街動線)
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

### #242. 🔁 Google/LINE 登入 OAuth redirect 指向舊 `localhost:3001`

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(上線前必補;社群登入是主要入口之一)
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

### #259. 🔴 prod 殘留 `supplier_slug='test'` 測試商品 **正在 live 首頁精選第 1 格對客人展示**

- **狀態:** ⏳ 待 Sean 點頭清除(prod DB 寫入、Claude 不自行動)
- **優先級:** 🔴 高(2026-07-03 Playwright production build 實證升級:**不是躺在 DB,而是公開可見**)
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

### #269. 🔗 首頁殘餘死連結:/install /stores + ?filter=new|sale

- **狀態:** ⏳ 待執行
- **優先級:** 🟡 低
- **問題:**
  - Q4-S5(2026-07-05)修首頁「分類卡無過濾 + 品牌牆 404」時順帶掃出**其餘死連結**(本輪 scope 外、未動):
    - `/install`(HomeFooter 安裝預約)、`/stores`(HomeFooter 合作店家)→ 路由不存在 = 404。
    - `?filter=new`(HomeHero/HomeSelect/HomeFooter 新品上架)、`?filter=sale`(特價專區)→ 全站無人讀 `?filter=`(products-url-state 只讀 sort)→ 點了無效果。
- **觸發事件:** 上線前完整首頁點擊審(或 Sean 指定)。多品牌上線後瀏覽量增、踩到機率上升。
- **預期解法:**
  - `/install`、`/stores`:建對應資訊頁(仿 `/info/shipping`)或暫移除連結(需 Sean 定內容)。
  - `?filter=new|sale`:products-url-state 加 `?filter=` 解析 → 對映 SortBar 'new'/'sale' 或 isNew/isSale extra filter(與 sort/vehicle/category/brand 入站 idiom 一致)。
- **不修會痛在:**
  - 擴充性:未接的 `?filter=` 是半成品 URL 契約,新頁面沿用會複製壞連結。
  - 可維護性:死連結散落多元件,愈晚修愈難盤點(本條已列全)。
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

### #275. 🖼 lightech 變體圖大宗 http://(mixed content、寫入後前台破圖風險)

- **狀態:** ⏳ 待執行(lightech confirm-write 前評估)
- **優先級:** 🟠 中
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

- **狀態:** ⏳ 待執行
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

- **狀態:** ⏳ 待執行
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
  - 涉及檔:前台寫出端 `products-url-state.tsx`、讀取端 `parseBrandFiltersFromUrl`、
    server 端 `lib/catalog-query.ts:64-66`(現用 `getAll('pbrand')`)+ 對應測試。
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
- **順帶記錄(既有漂移、非本次引入):** `products-url-state.tsx:82` 註解寫「產品品牌深連結改獨立
  key…見 backlog #269」,但 #269 實際標題為「首頁殘餘死連結:/install /stores + `?filter=new|sale`」
  (`docs/phase-1-backlog.md:6712`),且全檔查無「`?brand=` 命名空間消歧」條目 → 該引用是 dangling。
  本條(#287)實作時順手把該註解一併修正或補建對應條目。

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

## 紀錄模板

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
