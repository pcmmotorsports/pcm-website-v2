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

### 禁止寫法

| 禁 | 為什麼 |
|---|---|
| 「待 Sean 決定」 | 空泛、Sean 不知道要決定什麼 |
| 「未來考慮」 | 沒明確時機 |
| 「需評估」 | 評估什麼?標準是什麼? |
| 「建議改進」 | 不修會怎樣? |

詳細範例見 `docs/patterns/pcm-specific.md` §8。

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

### #9. ⏳ STATUS.md 30 行上限政策待 Sean 重新拍板

- **狀態:** ⏳ 待執行
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

---

### #10. ⏳ IShopAdapter Phase 1 補一個 slice 候選

- **狀態:** ⏳ 待執行
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

### #24. ⏳ dependency-rules.md §6.2 補 apps→apps 預設禁的維運說明

- **狀態:** ⏳ 待執行
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

### #25. ⏳ dependency-rules.md §5.3 字面前後一致統一

- **狀態:** ⏳ 待執行
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

### #75. ⏳ 4 空殼 packages JSDoc 格式對稱化

- **狀態:** ⏳ 待執行
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
- **優先級:** 🔴 高(M-1-13 ProductPage 啟動前必修、本 slice 推延)
- **問題:**
  - Sean 2026-05-04 業務訊號:同個商品多規格(顏色 × 材質 × 年式對應)、員工後台自行新增、1-20 種選項、雙層或三層巢狀
  - design ProductPage.jsx 字面只 hardcode `state: color / size / qty`、size options 依 product.category 字串(排氣 / 碳纖 / 避震 / 卡鉗)分支動態算、color options 主色 + 額外 2 色從 pool slice
  - design 字面遠遠不夠覆蓋 Sean 業務需求(1-20 種規格、巢狀)
  - M-1-13 ProductPage 直接搬時、必踩此 gap
- **觸發事件:**
  - 2026-05-04 / M-1-02 拍板 Q1=A2 推延 variants(本 slice 不補)
- **預期解法:**
  - **候選 A:** Medusa v2 內建 product_option + product_variant(spike 驗證能否蓋雙層 / 三層)
  - **候選 B:** PCM 自家 schema、走 metadata.variants jsonb(完全自由、設計成本高、Medusa Admin UI 不支援)
  - **候選 C:** 混合(產品基本層 Medusa option / variant、複雜層 PCM 自家 metadata 補)
  - 啟動順序:M-1-13 啟動前獨立 slice 跑 spike + 拍板候選、估時 60-90 min
  - 配合 Claude Design 補設計(design 字面不足、需擴 ProductPage UI 顯示 1-20 種規格)
- **不修會痛在:**
  - 擴充性:M-1-13 ProductPage 直接搬時撞 gap、design 字面不夠;Phase 2 vendor crawler 抓變體資料、schema 不就位無法落地
  - 可維護性:design 字面 hardcode color + size、sync-engine 上架 pipeline(M-5-03)無法寫變體、員工手動 admin 上架走 ad-hoc
  - bug 可追蹤性:客人「我要紅色不鏽鋼長 200mm」、Order 看不到完整變體選擇、客服回溯困難
- **估時:** spike 60-90 min + 落地 90-120 min(獨立 slice)
- **依賴:** M-1-02 完成、M-1-13 啟動前獨立 slice 處理
- **發現於:** 2026-05-04 / M-1-02 拍板 Q1
- **相關:** `packages/domain/src/catalog/types.ts` Product variants 推延欄位、`design-reference/components/ProductPage.jsx`(state color / size / qty)、`docs/PHASE-1-MILESTONES.md` M-1-13

### #82. ⏳ design `inStock: boolean` ↔ domain `ProductAvailability` mapper(M-1-13 ProductPage 啟動前)

- **狀態:** ⏳ 待執行
- **優先級:** 🟠 中(M-1-13 ProductPage 直接搬時必撞、之前不阻)
- **問題:**
  - design 真權威字面用 `inStock: boolean`(design-reference/components/{ProductCard,ProductPage,FilterTop,FilterSide,FilterDrawer,Pages,ProductsPage}.jsx + data/PRODUCTS-README.md)
  - M-1-02-audit L1 立即修把 domain 改 `ProductAvailability = 'in-stock' | 'out-of-stock'` string union type alias
  - **跨層 mapping 缺位:** M-1-13 ProductPage 直接搬 design 時、storefront component 必須 map domain enum ↔ design boolean、否則 component 散寫 ternary (`product.availability === 'in-stock' ? ... : ...`)
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit reuse agent R1 抓出
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
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts` createFakeProduct、backlog #19 / #84(同 trigger 哲學「撞重複再抽」)

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

### #93. ⏳ matchFitment 補 8 個 boundary case test

- **狀態:** ⏳ 待執行
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

### #99. ⏳ lessons-learned.md 結構整理(「偵察 slice 方法論」段歸位)

- **狀態:** ⏳ 待執行
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

### #100. ⏳ 全 catalog 表 §10.1 vs .sql drift(brands / categories / products / 未來 variants)

- **狀態:** ⏳ 待執行
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

### #106. ⏳ Supabase typed Database schema(supabase gen-types)— 解 adapter 雙 cast escape hatch

- **狀態:** ⏳ 待執行
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

### #112. ⏳ PRD M-1-03-main-b §8 第 4 條 @TODO 字面 vs sub-slice 5 Code 字面偏離 PRD 同步

- **狀態:** ⏳ 待執行
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

## 紀錄模板

```markdown
### #N. <Emoji> 標題

- **狀態:** ⏳ 待執行 / 🔴 立即啟動 / ✅ 完成 / ❌ 棄用
- **優先級:** 🔴 高 / 🟠 中 / 🟡 低 / 🟢 觀察
- **問題:**
  - (描述)
- **觸發事件:**
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
